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
            a['min'] = [float(x) for x in arr.min(0)]; a['max'] = [float(x) for x in arr.max(0)]
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


def shape_to_glb(shape: Shape, texture_lookup) -> bytes:
    """texture_lookup(name) -> PIL image or None."""
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
                 'TEXCOORD_0': b.accessor(np.ascontiguousarray(sm.uvs, np.float32), 5126, 'VEC2', 34962)}
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
    for name, m in shape.effects:
        g['nodes'].append({'name': f'effect:{name}', 'matrix': [float(x) for x in _conv_matrix(m).T.reshape(-1)]})
        g['scenes'][0]['nodes'].append(len(g['nodes']) - 1)
    return b.glb()
