"""glTF export for people: morph meshes (bodies, legs, low-detail heads) and simple skins (detailed heads),
combined in one file with shared animation names."""
from __future__ import annotations

import numpy as np

from .gltf import _Builder, _png, _quat_from_matrix, gl_uv
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
    tri = mm.indices.reshape(-1, 3)[:, [0, 2, 1]].reshape(-1).astype(np.uint32)
    targets, hots = [], {}
    for a in sel:
        hots[a.name] = []
        for f in range(len(a.frames)):
            d = (a.frames[f][mm.remap] * _Z - base).astype(np.float32)
            targets.append({'POSITION': b.accessor(np.ascontiguousarray(d), 5126, 'VEC3', 34962, minmax=True)})
            hots[a.name].append(len(targets) - 1)
    attrs = {'POSITION': b.accessor(np.ascontiguousarray(base, np.float32), 5126, 'VEC3', 34962, minmax=True),
             'TEXCOORD_0': b.accessor(gl_uv(mm.uvs), 5126, 'VEC2', 34962)}
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
                           'TEXCOORD_0': b.accessor(gl_uv(skin.uvs), 5126, 'VEC2', 34962),
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


def _hand_side(name: str) -> str | None:
    """AttachmentR_AM01_L1:mms -> 'R'. AttachmentH is the hat/head point; only the hands carry food and drink."""
    n = name.lower()
    return 'R' if n.startswith('attachmentr_') else 'L' if n.startswith('attachmentl_') else None


def _tri_order(P: np.ndarray) -> tuple[int, int, int]:
    """(a, b, apex): the attachment triangle's long edge a-b and the corner opposite it. The vertex ORDER differs
    between peeps (AM01 vs AF01), so the frame is built from the shape, not the order."""
    best = max(((0, 1, 2), (1, 2, 0), (0, 2, 1)), key=lambda t: np.linalg.norm(P[t[0]] - P[t[1]]))
    return best


def _hand_frame(P: np.ndarray, order, flip: bool) -> np.ndarray:
    """4x4 (column vectors) from the 3 attachment-triangle points (glTF space): origin at the centroid, Y from the
    apex to the middle of the long edge (an item's up), X along the long edge, Z = X x Y. `flip` reverses X so that
    Z points out of the palm: carried-item models sit on their +Z side (a soda can spans z = +0.02…+0.11)."""
    a, b, c = order
    o = P.mean(0)
    x = P[a] - P[b]; x /= max(np.linalg.norm(x), 1e-9)
    if flip:
        x = -x
    y = (P[a] + P[b]) / 2 - P[c]; y -= x * np.dot(x, y); y /= max(np.linalg.norm(y), 1e-9)
    M = np.eye(4); M[:3, 0] = x; M[:3, 1] = y; M[:3, 2] = np.cross(x, y); M[:3, 3] = o
    return M


def _palm_flip(frames: np.ndarray, body_frames, order) -> bool:
    """True if the unflipped frame's Z points INTO the hand (towards the peep's own hand/arm vertices) in most
    frames of this animation."""
    if body_frames is None:
        return False
    votes = 0
    for f in range(len(frames)):
        P = frames[f][:3].astype(np.float64) * _Z
        Z = _hand_frame(P, order, False)[:3, 2]
        B = body_frames[min(f, len(body_frames) - 1)].astype(np.float64) * _Z
        near = B[np.linalg.norm(B - P.mean(0), axis=1) < 0.09]
        if len(near):
            votes += 1 if np.dot(Z, P.mean(0) - near.mean(0)) < 0 else -1
    return votes > 0


def _add_hand(b: _Builder, root: dict, mm: MorphMesh, side: str, anim_names, anims: dict, body: MorphMesh | None = None):
    """An empty node 'hand_R' / 'hand_L' that follows the hand attachment triangle in every exported animation, so
    a viewer can parent a carried item (burger, drink, balloon…) to it."""
    g = b.g
    if not mm.anims or mm.anims[0].frames.shape[1] < 3:
        return
    sel = [a for a in mm.anims if anim_names is None or a.name in anim_names] or mm.anims[:1]
    order = _tri_order(sel[0].frames[0][:3])
    body_anims = {a.name: a for a in body.anims} if body is not None else {}

    def flip_for(a):
        ba = body_anims.get(a.name)
        return _palm_flip(a.frames, ba.frames[:, body.remap] if ba is not None else None, order)
    M0 = _hand_frame(sel[0].frames[0][:3].astype(np.float64) * _Z, order, flip_for(sel[0]))
    node = {'name': 'hand_' + side, 'translation': [float(v) for v in M0[:3, 3]],
            'rotation': [float(v) for v in _quat_from_matrix(M0[:3, :3])]}
    g['nodes'].append(node)
    ni = len(g['nodes']) - 1
    root.setdefault('children', []).append(ni)
    for a in sel:
        ent = anims.setdefault(a.name, {'name': a.name, 'samplers': [], 'channels': []})
        t = _times(a.times, len(a.frames))
        ti = b.accessor(t, 5126, 'SCALAR', minmax=True)
        tr, qs, prev = [], [], None
        flip = flip_for(a)
        for f in range(len(a.frames)):
            M = _hand_frame(a.frames[f][:3].astype(np.float64) * _Z, order, flip)
            q = _quat_from_matrix(M[:3, :3])
            if prev is not None and np.dot(q, prev) < 0:
                q = -q
            tr.append(M[:3, 3]); qs.append(q); prev = q
        ent['samplers'] += [{'input': ti, 'output': b.accessor(np.array(tr, np.float32), 5126, 'VEC3'), 'interpolation': 'LINEAR'},
                            {'input': ti, 'output': b.accessor(np.array(qs, np.float32), 5126, 'VEC4'), 'interpolation': 'LINEAR'}]
        ent['channels'] += [{'sampler': len(ent['samplers']) - 2, 'target': {'node': ni, 'path': 'translation'}},
                            {'sampler': len(ent['samplers']) - 1, 'target': {'node': ni, 'path': 'rotation'}}]


def people_to_glb(morphs: list[tuple[MorphMesh, object]], skins: list[tuple[SimpleSkin, dict, object]] = (),
                  anim_names: list[str] | None = None, name: str = 'person') -> bytes:
    b = _Builder(); g = b.g
    root = {'name': name}
    g['nodes'].append(root); g['scenes'][0]['nodes'].append(0)
    anims: dict[str, dict] = {}
    # the arms are in the skin part (SkinBody_*) for most peeps, else in the body part
    body = next((mm for mm, _ in morphs if mm.name.lower().startswith('skinbody_')), None) or \
        next((mm for mm, _ in morphs if mm.name.lower().startswith('body_')), None)
    for mm, img in morphs:
        _add_morph(b, root, mm, img, anim_names, anims)
        side = _hand_side(mm.name)
        if side:
            _add_hand(b, root, mm, side, anim_names, anims, body)
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
