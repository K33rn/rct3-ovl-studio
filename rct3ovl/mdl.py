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


def load_mdl(ovl: Ovl, ref: LoaderRef, level: int = 0) -> Shape:
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
    inv = []
    for i in range(nb):
        rec = np.frombuffer(blob, '<f4', 24, p); p += 96
        inv.append(rec[8:24].reshape(4, 4).astype(np.float64))
    parents = [-1] * nb
    for _ in range(nb - 1):
        par, ch = struct.unpack_from('<HH', blob, p)
        if ch >= nb:
            break
        parents[ch] = -1 if par == 0xFFFF else par
        p += 4
    for i in range(nb):
        try:
            m = np.linalg.inv(inv[i])                    # bind pose (model space) from the inverse bind matrix
        except np.linalg.LinAlgError:
            m = np.eye(4)
        shape.bones.append(Bone(names[i] if i < len(names) else f'bone{i}', parents[i], m.astype(np.float32)))
    # material names follow the parent table's end marker (u16 x, 0xFFFF): u32 name lengths (incl. NUL) until the
    # first name starts, then the names
    q = p + 4
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
    lv = levels[min(level, len(levels) - 1)]
    pos = lv[-1][0] + 32
    imports = {n.split(':')[0].lower(): n for n, _ in ovl.symbol_refs if ':' in n}
    own = {r.name.split(':')[0].lower(): r.name for r in ovl.resources if r.loader.tag in ('tex', 'ftx')}
    for k, (_, nidx, nvert) in enumerate(lv):
        v = np.frombuffer(blob, VERTEX, nvert, pos); pos += VERTEX.itemsize * nvert
        idx = np.frombuffer(blob, '<u2', nidx, pos).astype(np.uint32); pos += 2 * nidx
        mat = materials[k] if k < len(materials) else ''
        tex = own.get(mat.lower()) or imports.get(mat.lower()) or (mat + ':tex' if mat else '')
        alpha = 'alpha' in mat.lower() and 'nonalpha' not in mat.lower()
        # vertices are stored in the standing (bind) pose, so the model is exported static; the bone links
        # (v['bi'], v['bw']) are kept out until the modelanim animations are decoded
        sm = SubMesh(tex, 'SIAlphaMaskLow:txs' if alpha else 'SIOpaque:txs', 1 if alpha else 0, 0, 1,
                     v['p'].astype(np.float32), v['n'].astype(np.float32), v['uv'].astype(np.float32),
                     np.ascontiguousarray(v['c'][:, [2, 1, 0, 3]]), idx)
        shape.meshes.append(sm)
    shape.bone_names = [b.name for b in shape.bones]
    shape.bones = []
    shape.effects = []
    return shape


def mdl_info(ovl: Ovl, ref: LoaderRef) -> dict:
    blob, names_blob = ref.extra[0], ref.extra[1]
    lv = _lods(blob, 16)
    return {'bones': struct.unpack_from('<I', blob, 0)[0], 'levels_of_detail': [[(n, v) for _, n, v in l] for l in lv],
            'names': [n.decode('latin-1') for n in names_blob.split(b'\0') if n]}
