"""Morph meshes (mms): vertex-animated meshes used for guests, staff bodies and some animals.

MorphMesh (40 B): render vertex count, index count, position count, unk, unk, morph (animation) count,
render vertices* {u16 position index, u16 normal/aux index, f32 u, f32 v}, indices* (u16), unk, morphs*.
Morph (64 B): offset xyz, 0, scale xyz, 0, name*, frame count, times* (f32), frames*, 4 x unk.
Each frame = positions (position count x u32, packed x:11 | y:10 | z:11 bits, x in the low bits;
position = offset + scale * quantised) followed by normals (normal count x 3 u8, (b - 127.5) / 127.5),
padded to 4 bytes. A render vertex picks its position and its normal by index ({u16 position, u16 normal, uv}).
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

import numpy as np

from .container import LoaderRef, Ovl, OvlError


@dataclass
class MorphAnim:
    name: str
    times: np.ndarray                     # (frames,)
    frames: np.ndarray                    # (frames, positions, 3) float32
    normals: np.ndarray | None = None     # (frames, normal count, 3)


@dataclass
class MorphMesh:
    name: str
    texture: str
    uvs: np.ndarray                       # (n, 2)
    remap: np.ndarray                     # (n,) render vertex -> position index
    indices: np.ndarray                   # (m,)
    nremap: np.ndarray | None = None      # (n,) render vertex -> normal index
    anims: list[MorphAnim] = field(default_factory=list)

    def positions(self, anim: int = 0, frame: int = 0) -> np.ndarray:
        return self.anims[anim].frames[frame][self.remap]

    def normals(self, anim: int = 0, frame: int = 0) -> np.ndarray | None:
        a = self.anims[anim]
        if a.normals is None or self.nremap is None or not a.normals.shape[1]:
            return None
        n = a.normals[frame][self.nremap]
        return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-6)

    # colour variants: people and animal textures are grids of variants (AF01's outfit texture is 4 x 4 outfits,
    # the duck's is 2 x 2: mallard drake / plain duck ...). The UVs as stored point into one tile (usually the
    # bottom-left); the game shifts them to pick the variant for each individual.
    def variant_grid(self) -> tuple[int, int, int, int]:
        """-> (columns, rows, stored column, stored row) of the tile grid the UVs live in."""
        if not len(self.uvs):
            return 1, 1, 0, 0
        out = []
        for c in (0, 1):
            x = np.clip(self.uvs[:, c], 0, 1 - 1e-6)
            k = next((k for k in (8, 4, 2) if np.ptp(np.floor(x * k)) == 0), 1)
            out += [k, int(np.floor(x[0] * k))]
        return out[0], out[2], out[1], out[3]

    def variant_count(self) -> int:
        cols, rows, _, _ = self.variant_grid()
        return cols * rows

    def with_variant(self, variant: int | None) -> 'MorphMesh':
        """Copy with UVs moved to tile `variant` (0 = top-left, row by row). None keeps the stored tile."""
        if variant is None:
            return self
        cols, rows, c0, r0 = self.variant_grid()
        v = variant % (cols * rows)
        c, r = v % cols, v // cols
        uvs = self.uvs + np.array([(c - c0) / cols, (r - r0) / rows], np.float32)
        return MorphMesh(self.name, self.texture, uvs, self.remap, self.indices, self.nremap, self.anims)


def _unpack(raw: np.ndarray, off, scale) -> np.ndarray:
    raw = raw.astype(np.uint32)
    q = np.stack([raw & 0x7FF, (raw >> 11) & 0x3FF, raw >> 21], -1).astype(np.float32)
    return (np.asarray(off, np.float32) + np.asarray(scale, np.float32) * q).astype(np.float32)


def load_morph(ovl: Ovl, ref: LoaderRef, max_anims: int | None = None) -> MorphMesh:
    o = ovl
    vc, ic, npos, nnrm, _u5, mc, uvp, ip, _u9, mp = struct.unpack('<10I', o.read(ref.data, 40))
    if vc > 200_000 or ic > 600_000:
        raise OvlError(f'{ref.name}: implausible morph mesh counts')
    uv = np.frombuffer(o.read(uvp, 12 * vc), np.dtype([('pi', '<u2'), ('aux', '<u2'), ('uv', '<f4', 2)]))
    remap = uv['pi'].astype(np.int64)
    npos = max(npos, int(remap.max()) + 1 if vc else 0)
    idx = np.frombuffer(o.read(ip, 2 * ic), '<u2').astype(np.uint32)
    imports = {site: name for name, site in o.symbol_refs}
    tex = next((imports[a] for a in range(ref.data, ref.data + 40, 4) if a in imports), '')
    mm = MorphMesh(ref.name, tex, uv['uv'].astype(np.float32), remap, idx, uv['aux'].astype(np.int64))
    nnrm = max(nnrm, int(uv['aux'].max()) + 1 if vc else 0)
    fsize = (4 * npos + 3 * nnrm + 3) // 4 * 4
    for a in range(mc if max_anims is None else min(mc, max_anims)):
        m = struct.unpack('<3fI3fIIIIIIIII', o.read(mp + 64 * a, 64))
        off, scale, name_p, tc, tp, dp = m[0:3], m[4:7], m[8], m[9], m[10], m[11]
        times = np.frombuffer(o.read(tp, 4 * tc), '<f4').copy() if tc else np.zeros(0, np.float32)
        n = max(tc, 1)
        blob = np.frombuffer(o.read(dp, fsize * n), np.uint8).reshape(n, fsize)
        raw = blob[:, :4 * npos].copy().view('<u4')
        nrm = (blob[:, 4 * npos:4 * npos + 3 * nnrm].reshape(n, nnrm, 3).astype(np.float32) - 127.5) / 127.5
        mm.anims.append(MorphAnim(o.str_field(mp + 64 * a + 32, f'anim{a}'), times, _unpack(raw, off, scale), nrm))
    return mm
