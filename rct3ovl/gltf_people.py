"""glTF export for people: morph meshes (bodies, legs, low-detail heads) and simple skins (detailed heads),
combined in one file with shared animation names."""
from __future__ import annotations

import numpy as np

from .gltf import _Builder, _png, _quat_from_matrix
from .morph import MorphMesh
from .people import SimpleClip, SimpleSkin

_Z = np.array([1, 1, -1], np.float32)


def _material(b: _Builder, name: str, img, double=False) -> int:
    g = b.g
    m = {'name': name or 'untextured', 'pbrMetallicRoughness': {'metallicFactor': 0.0, 'roughnessFactor': 0.85},
         'doubleSided': double}
    if img is not None:
        g.setdefault('images', []).append({'bufferView': b.view(_png(img)), 'mimeType': 'image/png', 'name': name})
        g.setdefault('samplers', [{'magFilter': 9729, 'minFilter': 9987}])
        g.setdefault('textures', []).append({'source': len(g['images']) - 1, 'sampler': 0})
        m['pbrMetallicRoughness']['baseColorTexture'] = {'index': len(g['textures']) - 1}
        if 'A' in img.getbands() and img.getchannel('A').getextrema()[0] < 128:
            m['alphaMode'] = 'MASK'; m['alphaCutoff'] = 0.5
    g.setdefault('materials', []).append(m)
    return len(g['materials']) - 1


def _sparse_onehot(b: _Builder, frames: int, ntargets: int, hot: list[int]) -> int:
    """Weights output (frames x ntargets) that is zero except 1 at (k, hot[k]): a sparse accessor."""
    idx = np.array([k * ntargets + h for k, h in enumerate(hot)], np.uint32)
    vals = np.ones(len(hot), np.float32)
    acc = {'componentType': 5126, 'count': frames * ntargets, 'type': 'SCALAR',
           'sparse': {'count': len(hot), 'indices': {'bufferView': b.view(idx.tobytes()), 'componentType': 5125},
                      'values': {'bufferView': b.view(vals.tobytes())}}}
    b.g['accessors'].append(acc)
    return len(b.g['accessors']) - 1


def _times(t: np.ndarray, n: int) -> np.ndarray:
    if len(t) >= n and n:
        return np.ascontiguousarray(t[:n] - t[0], np.float32)
    return np.arange(n, dtype=np.float32) / 30.0


def _add_morph(b: _Builder, root: dict, mm: MorphMesh, img, anim_names, anims: dict):
    g = b.g
    if not mm.anims or not len(mm.indices):
        return
    sel = [a for a in mm.anims if anim_names is None or a.name in anim_names] or mm.anims[:1]
    a0 = mm.anims.index(sel[0])
    base = mm.positions(a0, 0) * _Z
    nbase = mm.normals(a0, 0)
    tri = mm.indices.astype(np.uint32)      # morph meshes: the z mirror alone gives outward faces (see morph.py)
    targets, hots = [], {}
    for a in sel:
        hots[a.name] = []
        for f in range(len(a.frames)):
            d = (a.frames[f][mm.remap] * _Z - base).astype(np.float32)
            targets.append({'POSITION': b.accessor(np.ascontiguousarray(d), 5126, 'VEC3', 34962, minmax=True)})
            hots[a.name].append(len(targets) - 1)
    attrs = {'POSITION': b.accessor(np.ascontiguousarray(base, np.float32), 5126, 'VEC3', 34962, minmax=True),
             'TEXCOORD_0': b.accessor(np.ascontiguousarray(mm.uvs, np.float32), 5126, 'VEC2', 34962)}
    if nbase is not None:
        attrs['NORMAL'] = b.accessor(np.ascontiguousarray(nbase * _Z, np.float32), 5126, 'VEC3', 34962)
    prim = {'attributes': attrs, 'indices': b.accessor(tri, 5125, 'SCALAR', 34963),
            'material': _material(b, mm.texture or mm.name, img), 'targets': targets}
    g['meshes'].append({'name': mm.name, 'primitives': [prim], 'weights': [0.0] * len(targets)})
    g['nodes'].append({'name': mm.name.split(':')[0], 'mesh': len(g['meshes']) - 1})
    node = len(g['nodes']) - 1; root.setdefault('children', []).append(node)
    for a in sel:
        ent = anims.setdefault(a.name, {'name': a.name, 'samplers': [], 'channels': []})
        t = _times(a.times, len(hots[a.name]))
        ent['samplers'].append({'input': b.accessor(t, 5126, 'SCALAR', minmax=True),
                                'output': _sparse_onehot(b, len(t), len(targets), hots[a.name]), 'interpolation': 'LINEAR'})
        ent['channels'].append({'sampler': len(ent['samplers']) - 1, 'target': {'node': node, 'path': 'weights'}})


def _conv_rot(R_row: np.ndarray) -> np.ndarray:
    S = np.diag([1.0, 1.0, -1.0])
    return S @ R_row.T @ S


def _add_skin(b: _Builder, root: dict, skin: SimpleSkin, clips: dict, img, anims: dict):
    """Rigid head: each vertex follows one bone. The first clip's first key is the bind pose.
    clips: animation name -> SimpleClip."""
    g = b.g
    nb = len(skin.bones)
    first = next((c for c in clips.values() if c.positions.shape[1] == nb), None)
    if first is not None:
        P0, R0 = first.positions[0].astype(np.float64), first.rotations[0].astype(np.float64)
    else:
        P0, R0 = np.zeros((nb, 3)), np.tile(np.eye(3), (nb, 1, 1))
    W = [None] * nb
    def world(i):                                        # row-vector convention: W = L @ W_parent
        if W[i] is None:
            L = np.eye(4); L[:3, :3] = R0[i]; L[3, :3] = P0[i]
            W[i] = L if skin.parents[i] < 0 else L @ world(skin.parents[i])
        return W[i]
    for i in range(nb):
        world(i)
    pos = np.empty_like(skin.positions); nrm = np.empty_like(skin.normals)
    for i in range(nb):
        m = skin.vertex_bone == i
        pos[m] = skin.positions[m] @ W[i][:3, :3] + W[i][3, :3]
        nrm[m] = skin.normals[m] @ W[i][:3, :3]
    tri = skin.indices.reshape(-1, 3)[:, [0, 2, 1]].reshape(-1).astype(np.uint32)
    joints = np.zeros((len(pos), 4), np.uint8); joints[:, 0] = skin.vertex_bone
    weights = np.zeros((len(pos), 4), np.float32); weights[:, 0] = 1
    prim = {'attributes': {'POSITION': b.accessor(np.ascontiguousarray(pos * _Z, np.float32), 5126, 'VEC3', 34962, minmax=True),
                           'NORMAL': b.accessor(np.ascontiguousarray(nrm * _Z, np.float32), 5126, 'VEC3', 34962),
                           'TEXCOORD_0': b.accessor(np.ascontiguousarray(skin.uvs, np.float32), 5126, 'VEC2', 34962),
                           'JOINTS_0': b.accessor(joints, 5121, 'VEC4', 34962),
                           'WEIGHTS_0': b.accessor(weights, 5126, 'VEC4', 34962)},
            'indices': b.accessor(tri, 5125, 'SCALAR', 34963), 'material': _material(b, skin.name, img)}
    g['meshes'].append({'name': skin.name, 'primitives': [prim]})
    skin_index = len(g.setdefault('skins', []))
    g['nodes'].append({'name': skin.name.split(':')[0], 'mesh': len(g['meshes']) - 1, 'skin': skin_index})
    root.setdefault('children', []).append(len(g['nodes']) - 1)
    base = len(g['nodes'])
    for i in range(nb):
        g['nodes'].append({'name': skin.bones[i], 'translation': [float(x) for x in P0[i] * _Z],
                           'rotation': [float(x) for x in _quat_from_matrix(_conv_rot(R0[i]))]})
    for i, p in enumerate(skin.parents):
        if p >= 0:
            g['nodes'][base + p].setdefault('children', []).append(base + i)
        else:
            root.setdefault('children', []).append(base + i)
    S4 = np.diag([1.0, 1.0, -1.0, 1.0])
    ibm = np.stack([np.linalg.inv(S4 @ W[i].T @ S4).T for i in range(nb)]).astype(np.float32).reshape(nb, 16)
    g['skins'].append({'joints': list(range(base, base + nb)), 'inverseBindMatrices': b.accessor(ibm, 5126, 'MAT4')})
    for name, c in clips.items():
        if c.positions.shape[1] != nb:
            continue
        ent = anims.setdefault(name, {'name': name, 'samplers': [], 'channels': []})
        t = _times(c.times, len(c.positions))
        ti = b.accessor(t, 5126, 'SCALAR', minmax=True)
        for i in range(nb):
            tr = np.ascontiguousarray(c.positions[:, i] * _Z, np.float32)
            qs, prev = [], None
            for k in range(len(t)):
                q = _quat_from_matrix(_conv_rot(c.rotations[k, i].astype(np.float64)))
                if prev is not None and np.dot(q, prev) < 0:
                    q = -q
                qs.append(q); prev = q
            ent['samplers'] += [{'input': ti, 'output': b.accessor(tr, 5126, 'VEC3'), 'interpolation': 'LINEAR'},
                                {'input': ti, 'output': b.accessor(np.array(qs, np.float32), 5126, 'VEC4'), 'interpolation': 'LINEAR'}]
            ent['channels'] += [{'sampler': len(ent['samplers']) - 2, 'target': {'node': base + i, 'path': 'translation'}},
                                {'sampler': len(ent['samplers']) - 1, 'target': {'node': base + i, 'path': 'rotation'}}]


def people_to_glb(morphs: list[tuple[MorphMesh, object]], skins: list[tuple[SimpleSkin, dict, object]] = (),
                  anim_names: list[str] | None = None, name: str = 'person') -> bytes:
    b = _Builder(); g = b.g
    root = {'name': name}
    g['nodes'].append(root); g['scenes'][0]['nodes'].append(0)
    anims: dict[str, dict] = {}
    for mm, img in morphs:
        _add_morph(b, root, mm, img, anim_names, anims)
    for sk, clips, img in skins:
        sel = {k: v for k, v in clips.items() if anim_names is None or k in anim_names}
        _add_skin(b, root, sk, sel or dict(list(clips.items())[:1]), img, anims)
    if anims:
        g['animations'] = [a for a in anims.values() if a['channels']]
    return b.glb()


def morphs_to_glb(parts, anim_names=None) -> bytes:
    return people_to_glb(parts, (), anim_names)


def skin_to_glb(skin: SimpleSkin, clips: list[SimpleClip], img) -> bytes:
    return people_to_glb([], [(skin, {c.name: c for c in clips}, img)], None, skin.name.split(':')[0])
