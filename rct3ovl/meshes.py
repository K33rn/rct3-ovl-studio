"""Static shapes (shs) and bone shapes (bsh) -> plain mesh data.

Shape header (both): bbox min xyz, bbox max xyz, total verts, total indices, mesh count2, mesh count, mesh**,
then shs: effect count, effect matrices*, effect names**; bsh: bone count, bones* {name*, parent}, matrices1*, matrices2*.
Sub-mesh record (40 B, all versions): support, ftx import, txs import, transparency, texture flags, sides,
vertex count, index count, vertices*, indices*.
Vertices: shs 36 B {pos3, normal3, BGRA colour, uv}; bsh 44 B {pos3, normal3, bone[4] int8, weight[4] u8, colour, uv}.
Indices: u16 or u32 (not tied to the OVL version: Soaked! carried items use u32). The width is detected: the
max index must be < vertex count, and among fitting widths the one with fewest degenerate triangles wins.
Texture names are symbol imports at the record's ftx/txs fields, resolved by name (often in another OVL).
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

import numpy as np

from .container import LoaderRef, Ovl, OvlError


@dataclass
class SubMesh:
    texture: str                # e.g. 'marble:ftx' or '' (untextured)
    style: str                  # texture style, e.g. 'SIOpaqueSpecular100:txs'
    transparency: int
    flags: int
    sides: int                  # 1 = double sided, 3 = single sided
    positions: np.ndarray       # (n, 3) float32, RCT3 space (left-handed, y up)
    normals: np.ndarray
    uvs: np.ndarray             # (n, 2)
    colors: np.ndarray          # (n, 4) uint8 RGBA
    indices: np.ndarray         # (m,) uint32
    joints: np.ndarray | None = None    # (n, 4) uint8 bone indices (bsh)
    weights: np.ndarray | None = None   # (n, 4) float32, sums to 1 (bsh)


@dataclass
class Bone:
    name: str
    parent: int                 # -1 = root
    matrix: np.ndarray          # 4x4 (row-major D3D, translation in the last row)
    matrix2: np.ndarray | None = None


@dataclass
class Shape:
    name: str
    kind: str                   # 'shs' or 'bsh'
    bbox: tuple
    meshes: list[SubMesh] = field(default_factory=list)
    bones: list[Bone] = field(default_factory=list)
    effects: list[tuple[str, np.ndarray]] = field(default_factory=list)   # attachment points


_V1 = np.dtype([('pos', '<f4', 3), ('nrm', '<f4', 3), ('col', 'u1', 4), ('uv', '<f4', 2)])
_V2 = np.dtype([('pos', '<f4', 3), ('nrm', '<f4', 3), ('bone', 'i1', 4), ('w', 'u1', 4), ('col', 'u1', 4),
                ('uv', '<f4', 2)])


def _imports(ovl: Ovl) -> dict[int, str]:
    cache = getattr(ovl, '_import_map', None)
    if cache is None:
        cache = {site: name for name, site in ovl.symbol_refs}
        ovl._import_map = cache
    return cache


def _indices(ovl: Ovl, ptr: int, count: int, vcount: int, prefer32: bool) -> np.ndarray:
    """u16 or u32 index list. Both can be 'in range': u32 data read as u16 interleaves zeros (fans to vertex 0),
    so among the widths that fit, the one with the fewest degenerate triangles wins (ties: prefer32 order)."""
    data, _ = ovl.block_bytes(ptr)
    cands = [4, 2] if prefer32 else [2, 4]
    best = None
    for rank, w in enumerate(cands):
        if len(data) >= w * count:
            a = np.frombuffer(data[:w * count], '<u4' if w == 4 else '<u2').astype(np.uint32)
            if count == 0 or a.max() < vcount:
                t = a[:count - count % 3].reshape(-1, 3)
                degenerate = int(((t[:, 0] == t[:, 1]) | (t[:, 1] == t[:, 2]) | (t[:, 0] == t[:, 2])).sum())
                if best is None or (degenerate, rank) < best[0]:
                    best = ((degenerate, rank), a)
    if best is None:
        raise OvlError(f'indices at 0x{ptr:X} do not fit {vcount} vertices')
    return best[1]


def _matrix(ovl: Ovl, ptr: int) -> np.ndarray:
    return np.frombuffer(ovl.read(ptr, 64), '<f4').reshape(4, 4).copy()


def load_shape(ovl: Ovl, ref: LoaderRef) -> Shape:
    o, kind = ovl, ref.loader.tag
    if kind not in ('shs', 'bsh'):
        raise OvlError(f'{ref.name} is not a shape')
    hdr = struct.unpack('<6f4I', o.read(ref.data, 40))
    bbox = (hdr[0:3], hdr[3:6])
    mesh_count, meshes_p = hdr[9], o.ptr(ref.data + 40)
    shape = Shape(ref.name, kind, bbox)
    imports = _imports(o)
    vdt = _V1 if kind == 'shs' else _V2
    for i in range(mesh_count):
        rec = o.ptr(meshes_p + 4 * i)
        (support, _ftx, _txs, transp, tflags, sides, vcount, icount,
         vptr, iptr) = struct.unpack('<10I', o.read(rec, 40))
        if vcount > 1_000_000 or icount > 3_000_000:
            raise OvlError(f'{ref.name} mesh {i}: implausible counts {vcount}/{icount}')
        vb = np.frombuffer(o.read(vptr, vdt.itemsize * vcount), vdt) if vcount else np.zeros(0, vdt)
        idx = _indices(o, iptr, icount, vcount, prefer32=(kind == 'shs' and o.version == 1)) if icount else \
            np.zeros(0, np.uint32)
        col = vb['col'][:, [2, 1, 0, 3]] if vcount else np.zeros((0, 4), np.uint8)     # BGRA -> RGBA
        sm = SubMesh(imports.get(rec + 4, ''), imports.get(rec + 8, ''), transp, tflags, sides,
                     vb['pos'].astype(np.float32), vb['nrm'].astype(np.float32), vb['uv'].astype(np.float32),
                     np.ascontiguousarray(col), idx)
        if kind == 'bsh' and vcount:
            j = vb['bone'].astype(np.int16)
            w = vb['w'].astype(np.float32)
            w[j < 0] = 0
            j[j < 0] = 0
            s = w.sum(1, keepdims=True)
            w = np.where(s > 0, w / np.maximum(s, 1e-9), np.array([1, 0, 0, 0], np.float32))
            sm.joints, sm.weights = j.astype(np.uint8), w.astype(np.float32)
        shape.meshes.append(sm)
    if kind == 'bsh':
        nb, bones_p, m1_p, m2_p = struct.unpack('<4I', o.read(ref.data + 44, 16))
        for b in range(nb):
            name_p, parent = struct.unpack('<Ii', o.read(bones_p + 8 * b, 8))
            shape.bones.append(Bone(o.str_field(bones_p + 8 * b, f'bone{b}'), parent,
                                    _matrix(o, m1_p + 64 * b), _matrix(o, m2_p + 64 * b) if m2_p else None))
    else:
        ne, mats_p, names_p = struct.unpack('<3I', o.read(ref.data + 44, 12))
        for e in range(ne):
            nm = o.str_field(names_p + 4 * e, f'effect{e}') if names_p else f'effect{e}'
            shape.effects.append((nm, _matrix(o, mats_p + 64 * e)))
    return shape
