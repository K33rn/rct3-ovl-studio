"""Shape -> binary glTF 2.0 (.glb) with embedded PNG textures, skins for bone shapes and attachment points.

RCT3 is Direct3D style: left-handed, y up, row-vector matrices (translation in the last row). glTF is
right-handed, y up, column vectors. Conversion: negate z, reverse triangle winding, and for matrices
C = S @ M.T @ S with S = diag(1, 1, -1, 1).
"""
from __future__ import annotations

import io
import json
import struct

import numpy as np

from .meshes import Shape

_S = np.diag([1.0, 1.0, -1.0, 1.0])


# Texture names the game engine fills in while running (reflections, water, glass, ads, terrain): they are never
# stored in an OVL. (colour rgba, metallic, roughness, blended)
_CHROME = ((0.75, 0.76, 0.78, 1.0), 1.0, 0.25, False)
_WATER = ((0.25, 0.5, 0.7, 0.55), 0.0, 0.1, True)
_GLASS = ((0.7, 0.85, 0.95, 0.35), 0.0, 0.05, True)
ENGINE_TEXTURES = {
    'chrome:ftx': _CHROME, 'mirrorchrome:ftx': _CHROME,
    'water:ftx': _WATER, 'siwater:ftx': _WATER, 'watermask:ftx': _WATER, 'watemask:ftx': _WATER,
    'fakeglass:ftx': _GLASS, 'fakeglass2sided:ftx': _GLASS,
    'useadtexture:ftx': ((0.9, 0.9, 0.85, 1.0), 0.0, 0.8, False),
    'useterraintexture:ftx': ((0.35, 0.5, 0.25, 1.0), 0.0, 0.9, False),
    'useclifftexture:ftx': ((0.5, 0.45, 0.4, 1.0), 0.0, 0.9, False),
}


def texture_note(name: str, found: bool) -> str | None:
    """Why a model's texture can't be shown (None if it can)."""
    if found:
        return None
    if name.lower() in ENGINE_TEXTURES:
        return 'made by the game engine while running (shown with a stand-in colour)'
    return 'not in this game folder (the copy may be missing files, e.g. the tracks folder)'


def gl_uv(uvs: np.ndarray) -> np.ndarray:
    """RCT3 v counts from the bottom row (images are stored bottom-up); textures are exported upright, so v' = 1 - v."""
    out = np.array(uvs, np.float32, copy=True)
    out[:, 1] = 1.0 - out[:, 1]
    return np.ascontiguousarray(out)


def _conv_matrix(m: np.ndarray) -> np.ndarray:
    return _S @ m.T.astype(np.float64) @ _S


def _png(img) -> bytes:
    b = io.BytesIO(); img.save(b, 'PNG'); return b.getvalue()


class _Builder:
    def __init__(self):
        self.bin = bytearray()
        self.g = {'asset': {'version': '2.0', 'generator': 'rct3ovl'}, 'buffers': [], 'bufferViews': [],
                  'accessors': [], 'meshes': [], 'nodes': [], 'scenes': [{'nodes': []}], 'scene': 0}

    def view(self, data: bytes, target: int | None = None) -> int:
        while len(self.bin) % 4:
            self.bin.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target:
            v['target'] = target
        self.bin += data
        self.g['bufferViews'].append(v)
        return len(self.g['bufferViews']) - 1

    def accessor(self, arr: np.ndarray, ctype: int, typ: str, target: int | None = None, minmax=False,
                 normalized=False) -> int:
        a = {'bufferView': self.view(arr.tobytes(), target), 'componentType': ctype, 'count': int(arr.shape[0]),
             'type': typ}
        if normalized:
            a['normalized'] = True
        if minmax and len(arr):
            a['min'] = [float(x) for x in np.atleast_1d(arr.min(0))]; a['max'] = [float(x) for x in np.atleast_1d(arr.max(0))]
        self.g['accessors'].append(a)
        return len(self.g['accessors']) - 1

    def glb(self) -> bytes:
        while len(self.bin) % 4:
            self.bin.append(0)
        self.g['buffers'] = [{'byteLength': len(self.bin)}]
        js = json.dumps(self.g, separators=(',', ':')).encode()
        js += b' ' * ((4 - len(js) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        return (struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js +
                struct.pack('<II', len(self.bin), 0x004E4942) + bytes(self.bin))


def _norm_bone(n: str) -> str:
    import re
    n = n.lower().lstrip('!').strip()
    return re.sub(r'0+(\d)', r'\1', n)


def _quat_from_matrix(R: np.ndarray) -> np.ndarray:
    """3x3 rotation -> quaternion (x, y, z, w)."""
    t = np.trace(R)
    if t > 0:
        s = np.sqrt(t + 1.0) * 2; w = 0.25 * s
        x = (R[2, 1] - R[1, 2]) / s; y = (R[0, 2] - R[2, 0]) / s; z = (R[1, 0] - R[0, 1]) / s
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = np.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2]) * 2; w = (R[2, 1] - R[1, 2]) / s
        x = 0.25 * s; y = (R[0, 1] + R[1, 0]) / s; z = (R[0, 2] + R[2, 0]) / s
    elif R[1, 1] > R[2, 2]:
        s = np.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2]) * 2; w = (R[0, 2] - R[2, 0]) / s
        x = (R[0, 1] + R[1, 0]) / s; y = 0.25 * s; z = (R[1, 2] + R[2, 1]) / s
    else:
        s = np.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1]) * 2; w = (R[1, 0] - R[0, 1]) / s
        x = (R[0, 2] + R[2, 0]) / s; y = (R[1, 2] + R[2, 1]) / s; z = 0.25 * s
    q = np.array([x, y, z, w]); return q / np.linalg.norm(q)


def _add_animations(b: '_Builder', animations, joint_nodes: dict, bind: dict):
    """animations: list of BoneAnimation; joint_nodes: normalised bone name -> node index;
    bind: node index -> (translation, quaternion) of the bind pose (glTF space)."""
    from .anims import axis_angle_to_matrix
    S3 = np.diag([1.0, 1.0, -1.0])
    out = []
    for anim in animations:
        samplers, channels = [], []
        for tr in anim.bones:
            node = joint_nodes.get(_norm_bone(tr.name))
            if node is None:
                continue
            if len(tr.translations):
                t = np.ascontiguousarray(tr.translations[:, 0], np.float32)
                v = np.ascontiguousarray(tr.translations[:, 1:] * np.array([1, 1, -1], np.float32), np.float32)
                samplers.append({'input': b.accessor(t, 5126, 'SCALAR', minmax=True), 'output': b.accessor(v, 5126, 'VEC3'),
                                 'interpolation': 'LINEAR'})
                channels.append({'sampler': len(samplers) - 1, 'target': {'node': node, 'path': 'translation'}})
            if len(tr.rotations):
                t = np.ascontiguousarray(tr.rotations[:, 0], np.float32)
                qs, prev = [], None
                for v in tr.rotations[:, 1:].astype(np.float64):
                    q = _quat_from_matrix(S3 @ axis_angle_to_matrix(v) @ S3)
                    if prev is not None and np.dot(q, prev) < 0:
                        q = -q                              # keep the shortest path for slerp
                    qs.append(q); prev = q
                samplers.append({'input': b.accessor(t, 5126, 'SCALAR', minmax=True),
                                 'output': b.accessor(np.array(qs, np.float32), 5126, 'VEC4'), 'interpolation': 'LINEAR'})
                channels.append({'sampler': len(samplers) - 1, 'target': {'node': node, 'path': 'rotation'}})
        if channels:
            out.append({'name': anim.name.split(':')[0], 'samplers': samplers, 'channels': channels})
    if out:
        b.g['animations'] = out


def shape_to_glb(shape: Shape, texture_lookup, animations=None) -> bytes:
    """texture_lookup(name) -> PIL image or None. animations: BoneAnimation list for bone shapes."""
    b = _Builder(); g = b.g
    materials, mat_index, tex_cache = [], {}, {}

    def material(sm) -> int:
        key = (sm.texture.lower(), sm.style.lower(), sm.transparency, sm.sides)
        if key in mat_index:
            return mat_index[key]
        m = {'name': sm.texture or 'untextured', 'pbrMetallicRoughness': {'metallicFactor': 0.0, 'roughnessFactor': 0.8},
             'doubleSided': sm.sides == 1}
        if sm.texture:
            if sm.texture.lower() not in tex_cache:
                img = texture_lookup(sm.texture)
                if img is not None:
                    g.setdefault('images', []).append({'bufferView': b.view(_png(img)), 'mimeType': 'image/png',
                                                       'name': sm.texture})
                    g.setdefault('samplers', [{'magFilter': 9729, 'minFilter': 9987}])
                    g.setdefault('textures', []).append({'source': len(g['images']) - 1, 'sampler': 0})
                    tex_cache[sm.texture.lower()] = (len(g['textures']) - 1, 'A' in img.getbands() and
                                                     img.getchannel('A').getextrema()[0] < 250)
                else:
                    tex_cache[sm.texture.lower()] = (None, False)
            ti, has_alpha = tex_cache[sm.texture.lower()]
            if ti is not None:
                m['pbrMetallicRoughness']['baseColorTexture'] = {'index': ti}
            else:
                # no picture: engine-made textures get a stand-in look, missing ones a neutral grey (not white)
                colour, metal, rough, blend = ENGINE_TEXTURES.get(sm.texture.lower(), ((0.55, 0.55, 0.58, 1.0), 0.0, 0.8, False))
                m['pbrMetallicRoughness'].update({'baseColorFactor': list(colour), 'metallicFactor': metal,
                                                  'roughnessFactor': rough})
                if blend:
                    m['alphaMode'] = 'BLEND'
        # RCT3 decides transparency per mesh (the texture style), not from the texture: 0 opaque (alpha ignored),
        # 1 alpha-mask cut-out ('Low' variants use a lower threshold), 2 blended (glass, water, SIAlpha*).
        style = sm.style.lower()
        if sm.transparency == 2:
            m['alphaMode'] = 'BLEND'
        elif sm.transparency == 1:
            m['alphaMode'] = 'MASK'; m['alphaCutoff'] = 0.25 if 'masklow' in style else 0.5
        if 'unlit' in style:
            m['extensions'] = {'KHR_materials_unlit': {}}
            g.setdefault('extensionsUsed', []).count('KHR_materials_unlit') or \
                g['extensionsUsed'].append('KHR_materials_unlit')
        if 'glass' in style or 'water' in style:
            m['pbrMetallicRoughness']['roughnessFactor'] = 0.1
        materials.append(m); mat_index[key] = len(materials) - 1
        return mat_index[key]

    prims = []
    for sm in shape.meshes:
        if not len(sm.indices) or 'fillz' in sm.style.lower():     # SIFillZ = invisible depth-only occluder
            continue
        pos = sm.positions * np.array([1, 1, -1], np.float32)
        nrm = sm.normals * np.array([1, 1, -1], np.float32)
        tri = sm.indices.reshape(-1, 3)[:, [0, 2, 1]].astype(np.uint32).reshape(-1)
        attrs = {'POSITION': b.accessor(np.ascontiguousarray(pos, np.float32), 5126, 'VEC3', 34962, minmax=True),
                 'NORMAL': b.accessor(np.ascontiguousarray(nrm, np.float32), 5126, 'VEC3', 34962),
                 'TEXCOORD_0': b.accessor(gl_uv(sm.uvs), 5126, 'VEC2', 34962)}
        if sm.joints is not None and shape.bones:
            attrs['JOINTS_0'] = b.accessor(np.ascontiguousarray(sm.joints, np.uint8), 5121, 'VEC4', 34962)
            attrs['WEIGHTS_0'] = b.accessor(np.ascontiguousarray(sm.weights, np.float32), 5126, 'VEC4', 34962)
        prims.append({'attributes': attrs, 'indices': b.accessor(tri, 5125, 'SCALAR', 34963), 'material': material(sm)})
    g['materials'] = materials
    g['meshes'].append({'name': shape.name, 'primitives': prims})

    root = {'name': shape.name, 'mesh': 0}
    g['nodes'].append(root)
    g['scenes'][0]['nodes'].append(0)
    if shape.bones:
        base = len(g['nodes'])
        for bn in shape.bones:
            local = _conv_matrix(bn.matrix)
            g['nodes'].append({'name': bn.name, 'matrix': [float(x) for x in local.T.reshape(-1)]})
        for i, bn in enumerate(shape.bones):
            if bn.parent >= 0:
                g['nodes'][base + bn.parent].setdefault('children', []).append(base + i)
            else:
                g['scenes'][0]['nodes'].append(base + i)
        ibm = np.stack([np.linalg.inv(_conv_matrix(bn.matrix2 if bn.matrix2 is not None else bn.matrix)).T
                        for bn in shape.bones]).astype(np.float32)
        g['skins'] = [{'joints': list(range(base, base + len(shape.bones))),
                       'inverseBindMatrices': b.accessor(ibm.reshape(len(shape.bones), 16), 5126, 'MAT4')}]
        root['skin'] = 0
        if animations:
            # animated joints need TRS instead of a matrix
            for i, bn in enumerate(shape.bones):
                n = g['nodes'][base + i]
                M = _conv_matrix(bn.matrix)
                n.pop('matrix', None)
                n['translation'] = [float(x) for x in M[:3, 3]]
                A = M[:3, :3]; sc = np.linalg.norm(A, axis=0)
                if np.linalg.det(A) < 0:
                    sc[0] = -sc[0]                          # mirrored bone: negative scale, proper rotation
                n['rotation'] = [float(x) for x in _quat_from_matrix(A / sc)]
                if not np.allclose(sc, 1, atol=1e-4):
                    n['scale'] = [float(x) for x in sc]
            _add_animations(b, animations, {_norm_bone(bn.name): base + i for i, bn in enumerate(shape.bones)}, {})
    for name, m in shape.effects:
        g['nodes'].append({'name': f'effect:{name}', 'matrix': [float(x) for x in _conv_matrix(m).T.reshape(-1)]})
        g['scenes'][0]['nodes'].append(len(g['nodes']) - 1)
    return b.glb()
