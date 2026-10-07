"""Wild!'s 'mdl' models (walking animals; in this install the elephant transport ride's elephant).

Nobody had documented this layout; worked out from ElephantTransport:mdl and checked mesh by mesh (every vertex
inside the record's bounding box, unit normals, bone weights summing to 255, every index in range).

Record (in the OVL): 0x10000, flags, 3 floats, bbox centre? / min xyz / max xyz, ..., a chain of detail settings.
Extra data 1: NUL-separated names: the bones/nodes (Bip01…, WheelFR…, CameraRear, Peep01…) then ''.
Extra data 0, the model:
  u32 bone count, 12 bytes 0
  bones: count x 96 B {position xyz 1, rotation quaternion xyzw, 4x4 inverse bind matrix}
  parent table: (count-1) x {u16 parent (0xFFFF = none), u16 bone}, then an end marker {u16, 0xFFFF}
  u32 material name lengths (incl. NUL), then the names - mesh n of a detail level uses material n
  per detail level (4: high, medium, low, ultra-low): a small table, then per mesh a 32 B header
      {u32 0x1305 vertex format, u32 index count, u16 1, u16 vertex count, 0xFFFF0000, 16 B 0},
  followed by each mesh's vertices (44 B: position, normal, 4 bone bytes, 4 weight bytes (sum 255), colour, uv)
  and u16 triangle indices.
UVs count v from the bottom like the rest of RCT3.
"""
from __future__ import annotations

import struct

import numpy as np

from .container import LoaderRef, Ovl, OvlError
from .meshes import Bone, Shape, SubMesh

VERTEX = np.dtype([('p', '<f4', 3), ('n', '<f4', 3), ('bi', 'u1', 4), ('bw', 'u1', 4), ('c', 'u1', 4), ('uv', '<f4', 2)])
_FORMAT = 0x1305


def _lods(blob: bytes, start: int) -> list[list[tuple[int, int, int]]]:
    """[[(header offset, index count, vertex count) per mesh] per detail level], found by their 0x1305 headers;
    consecutive headers 32 B apart form one level."""
    hdrs = [q for q in range(start, len(blob) - 32, 4)
            if struct.unpack_from('<I', blob, q)[0] == _FORMAT and struct.unpack_from('<I', blob, q + 12)[0] == 0xFFFF0000]
    levels, cur = [], []
    for q in hdrs:
        if cur and q != cur[-1][0] + 32:
            levels.append(cur); cur = []
        _, nidx, _, nvert = struct.unpack_from('<IIHH', blob, q)
        cur.append((q, nidx, nvert))
    if cur:
        levels.append(cur)
    return levels


def _qmat(q) -> np.ndarray:
    """quaternion (x, y, z, w) -> 3x3 rotation (column vectors)."""
    x, y, z, w = (float(c) for c in q)
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def _axis_angle(q) -> np.ndarray:
    """quaternion -> axis * angle (the form the bone-animation exporter takes; axis_angle_to_matrix inverts it)."""
    q = np.asarray(q, np.float64)
    q = q / (np.linalg.norm(q) or 1.0)
    if q[3] < 0:
        q = -q
    s = np.linalg.norm(q[:3])
    if s < 1e-9:
        return np.zeros(3)
    return q[:3] / s * (2.0 * np.arctan2(s, q[3]))


def load_mdl(ovl: Ovl, ref: LoaderRef, level: int = 0) -> Shape:
    """The model at one detail level (0 = high … 3 = ultra-low), skinned to its skeleton.
    Bones: local position + quaternion (parent-relative; row-vector local rotation = quat matrix transposed) and a
    model-space inverse bind matrix - checked: chaining the locals reproduces every inverse bind matrix exactly."""
    if len(ref.extra) < 2:
        raise OvlError(f'{ref.name}: no model data')
    blob, names_blob = ref.extra[0], ref.extra[1]
    names = [n.decode('latin-1') for n in names_blob.split(b'\0')]
    nb = struct.unpack_from('<I', blob, 0)[0]
    if nb > 512:
        raise OvlError(f'{ref.name}: implausible bone count {nb}')
    bmin = struct.unpack('<3f', ovl.read(ref.data + 0x18, 12)); bmax = struct.unpack('<3f', ovl.read(ref.data + 0x24, 12))
    shape = Shape(ref.name, 'mdl', (bmin, bmax))
    p = 16
    recs = []
    for i in range(nb):
        recs.append(np.frombuffer(blob, '<f4', 24, p).astype(np.float64)); p += 96
    # parent table: entry i = (parent of bone i or 0xFFFF, i + 1 or 0xFFFF after the last)
    parents = []
    for i in range(nb):
        par, _nxt = struct.unpack_from('<HH', blob, p); p += 4
        parents.append(-1 if par == 0xFFFF else par)
    for i, rec in enumerate(recs):
        local = np.eye(4); local[:3, :3] = _qmat(rec[4:8]).T; local[3, :3] = rec[0:3]
        try:
            world = np.linalg.inv(rec[8:24].reshape(4, 4))
        except np.linalg.LinAlgError:
            world = np.eye(4)
        shape.bones.append(Bone(names[i] if i < len(names) else f'bone{i}', parents[i],
                                local.astype(np.float32), world.astype(np.float32)))
    # material names: u32 lengths (incl. NUL) until the first name starts, then the names
    q = p
    lens = []
    while q + 4 <= len(blob) and 1 < struct.unpack_from('<I', blob, q)[0] < 128 and len(lens) < 64:
        lens.append(struct.unpack_from('<I', blob, q)[0]); q += 4
    materials = []
    for ln in lens:
        name = blob[q:q + ln]
        if not name.endswith(b'\0'):
            break
        materials.append(name[:-1].decode('latin-1')); q += ln
    levels = _lods(blob, p)
    if not levels:
        raise OvlError(f'{ref.name}: no meshes found')
    meshes_by_level = [_read_level(blob, lv) for lv in levels]
    level = min(level, len(levels) - 1)
    imports = {n.split(':')[0].lower(): n for n, _ in ovl.symbol_refs if ':' in n}
    own = {r.name.split(':')[0].lower(): r.name for r in ovl.resources if r.loader.tag in ('tex', 'ftx')}
    tex_of = lambda mat: own.get(mat.lower()) or imports.get(mat.lower()) or (mat + ':tex' if mat else '')
    mats = _level_materials(blob, levels[level], len(materials)) or list(range(len(levels[level])))
    for (v, idx), mi in zip(meshes_by_level[level], mats):
        mat = materials[mi] if 0 <= mi < len(materials) else ''
        tex = tex_of(mat)
        alpha = 'alpha' in mat.lower() and 'nonalpha' not in mat.lower()
        w = v['bw'].astype(np.float32)
        w = w / np.maximum(w.sum(1, keepdims=True), 1e-6)
        shape.meshes.append(SubMesh(tex, 'SIAlphaMaskLow:txs' if alpha else 'SIOpaque:txs', 1 if alpha else 0, 0, 1,
                                    v['p'].astype(np.float32), v['n'].astype(np.float32), v['uv'].astype(np.float32),
                                    np.ascontiguousarray(v['c'][:, [2, 1, 0, 3]]), idx,
                                    np.ascontiguousarray(v['bi'], np.uint8), w))
    shape.levels = len(levels)
    shape.effects = []
    return shape


def _read_level(blob: bytes, lv) -> list:
    pos = (lv[-1][0] + 32 + 15) // 16 * 16             # a level's vertex data starts on a 16-byte boundary
    out = []
    for _, nidx, nvert in lv:
        v = np.frombuffer(blob, VERTEX, nvert, pos); pos += VERTEX.itemsize * nvert
        idx = np.frombuffer(blob, '<u2', nidx, pos).astype(np.uint32); pos += 2 * nidx
        out.append((v, idx))
    return out


def _level_end(lv) -> int:
    pos = (lv[-1][0] + 32 + 15) // 16 * 16
    return pos + sum(VERTEX.itemsize * nv + 2 * ni for _, ni, nv in lv)


def _level_materials(blob: bytes, lv, nmat: int) -> list[int] | None:
    """The material table that follows a level's mesh data: nmat x 16 B {u16 material, u16 used by this level, 0…},
    then per mesh {u16 slot in the list of used materials, u16 1}. -> material index of each mesh."""
    p = _level_end(lv)
    if p + 16 * nmat + 4 * len(lv) > len(blob):
        return None
    used = []
    for m in range(nmat):
        mid, flag = struct.unpack_from('<HH', blob, p + 16 * m)
        if mid != m:
            return None
        if flag:
            used.append(m)
    q = p + 16 * nmat
    out = []
    for k in range(len(lv)):
        slot, one = struct.unpack_from('<HH', blob, q + 4 * k)
        if one != 1 or slot >= len(used):
            return None
        out.append(used[slot])
    return out


# ---- animations ---------------------------------------------------------------------------------------------
def load_modelanim(ovl: Ovl, ref: LoaderRef):
    """Wild! model animation (30 frames per second, frame-major):
    record: f32 duration, u32 frame count, 2 x name-pointer arrays (0 on disk), 0, 0, u32 position tracks,
            u32 rotation tracks, 0, 0, ptr positions (frames x tracks x xyz), ptr rotations (frames x tracks x xyzw)
    extra data: the bone names, position tracks first, then rotation tracks.
    -> BoneAnimation (positions and rotations replace the bone's local transform)."""
    from .anims import BoneAnimation, BoneTrack
    dur, nf, _a, _b, _c, _d, nt, nr = struct.unpack('<fIIIIIII', ovl.read(ref.data, 32))
    pt, pr = struct.unpack('<II', ovl.read(ref.data + 0x28, 8))
    if nf > 100_000 or nt > 1024 or nr > 1024:
        raise OvlError(f'{ref.name}: implausible animation header')
    names = [n.decode('latin-1') for n in (ref.extra[0] if ref.extra else b'').split(b'\0')]
    times = np.arange(nf, dtype=np.float64) / 30.0
    T = np.frombuffer(ovl.read(pt, 12 * nf * nt), '<f4').reshape(nf, nt, 3).astype(np.float64) if nt else np.zeros((nf, 0, 3))
    R = np.frombuffer(ovl.read(pr, 16 * nf * nr), '<f4').reshape(nf, nr, 4).astype(np.float64) if nr else np.zeros((nf, 0, 4))
    tracks = {}
    for k in range(nt):
        nm = names[k] if k < len(names) else f'track{k}'
        tracks.setdefault(nm, [None, None])[0] = np.column_stack([times, T[:, k]])
    for k in range(nr):
        nm = names[nt + k] if nt + k < len(names) else f'track{nt + k}'
        aa = np.array([_axis_angle(q) for q in R[:, k]])
        tracks.setdefault(nm, [None, None])[1] = np.column_stack([times, aa])
    anim = BoneAnimation(ref.name, float(dur))
    for nm, (tr, rot) in tracks.items():
        anim.bones.append(BoneTrack(nm, tr if tr is not None else np.zeros((0, 4)),
                                    rot if rot is not None else np.zeros((0, 4))))
    return anim


def animations_for_mdl(lib, ref: LoaderRef) -> list:
    """The model's animations: modelanim resources named after it (ElephantTransportWalk, …Run, …Stand, …Idle1/2)."""
    base = ref.name.split(':')[0].lower()
    out = []
    for n in sorted(lib.index['names']):
        if n.endswith(':modelanim') and n.startswith(base):
            h = lib.find(n)
            if h:
                try:
                    out.append(load_modelanim(h[0], h[1]))
                except OvlError:
                    pass
    return out


def mdl_info(ovl: Ovl, ref: LoaderRef) -> dict:
    blob, names_blob = ref.extra[0], ref.extra[1]
    lv = _lods(blob, 16)
    return {'bones': struct.unpack_from('<I', blob, 0)[0], 'levels_of_detail': [[(n, v) for _, n, v in l] for l in lv],
            'names': [n.decode('latin-1') for n in names_blob.split(b'\0') if n]}
