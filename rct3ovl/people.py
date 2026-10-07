"""People: person part groups (ppg), person parts (prt), heads (phd), simple skins (ssk), simple animations
(san) and simple animation lists (sal).

ppg: flags..., then per level of detail a list of prt imports (body, skin, attachments, optional extras).
prt: u32, then entries of 20 B {u32, texture import, mms import, u32, u32} - one per level of detail.
ssk (44 B): bone count, bone names**, per-bone vertex counts*, triangle count, indices* (u16 triangle list), vertex count,
     vertices* (32 B: position, normal, uv - in the owning bone's space; vertices are grouped by bone).
san: clips of 16 B {key count, bone count, times*, keys*} then name*, prt*, ...; a key holds, per bone,
     a local position (3 f32) and two rows of the rotation matrix as int16/32767 (third row = cross product).
sal: bone count, bone names**, animation entries* {.., name*, group name*, key count, bone count, times*, keys*}.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

import numpy as np

from .container import LoaderRef, Ovl, OvlError


def _imports(o: Ovl) -> dict[int, str]:
    m = getattr(o, '_import_map', None)
    if m is None:
        m = {site: n for n, site in o.symbol_refs}; o._import_map = m
    return m


# ---- parts -------------------------------------------------------------------------------------------------
@dataclass
class PartLOD:
    texture: str
    mesh: str


def load_prt(ovl: Ovl, ref: LoaderRef) -> list[PartLOD]:
    imp = _imports(ovl)
    _, size = ovl.block_bytes(ref.data)
    out, a = [], ref.data + 4
    while True:
        tex, mesh = imp.get(a + 4), imp.get(a + 8)
        if not (tex or mesh):
            break
        out.append(PartLOD(tex or '', mesh or ''))
        a += 20
    return out


def load_ppg(ovl: Ovl, ref: LoaderRef) -> list[list[str]]:
    """Levels of detail -> part names. Lists are runs of consecutive prt imports inside the ppg block."""
    imp = _imports(ovl)
    lods = []
    for f in range(0, 0x60, 4):                         # pointer fields of the ppg -> arrays of prt imports
        a = ref.data + f
        try:
            if not ovl.is_pointer(a):
                continue
            arr = ovl.u32(a)
        except OvlError:
            break
        cur = []
        for k in range(32):
            n = imp.get(arr + 4 * k)
            if n and n.endswith(':prt'):
                if n != ':prt':
                    cur.append(n)
            elif k > 0 or n is None:
                break
        if cur and cur not in lods:
            lods.append(cur)
    if not lods:
        return []
    # the longest list holds every level of detail back to back: start a new level when a role repeats
    full = max(lods, key=len)
    out, cur, seen = [], [], set()
    for n in full:
        role = n.split('_')[0]
        if role in seen:
            out.append(cur); cur, seen = [], set()
        cur.append(n); seen.add(role)
    if cur:
        out.append(cur)
    return out


def load_phd(ovl: Ovl, ref: LoaderRef) -> dict:
    """Person head: a set of 4x4 matrices (head/hat/glasses attachment frames) - exposed raw."""
    data, _ = ovl.block_bytes(ref.data)
    n = min(len(data) // 64, 8)
    mats = [np.frombuffer(data[64 * i:64 * i + 64], '<f4').reshape(4, 4).round(5).tolist() for i in range(n)]
    return {'matrices': mats}


# ---- simple skins (heads) -----------------------------------------------------------------------------------
_PARENT_RULES = [('head', 'neck'), ('glasses', 'head'), ('ponytail1', 'head')]


def bone_parent(names: list[str]) -> list[int]:
    low = [n.lower().replace('bip01 ', '') for n in names]
    par = []
    for i, n in enumerate(low):
        p = -1
        for child, parent in _PARENT_RULES:
            if n == child and parent in low:
                p = low.index(parent)
        if n.startswith('ponytail') and len(n) > len('ponytail1'):         # Ponytail11 -> Ponytail1
            if n[:-1] in low:
                p = low.index(n[:-1])
        if p < 0 and i > 0 and n not in ('neck',):
            p = 0
        par.append(p)
    return par


@dataclass
class SimpleSkin:
    name: str
    bones: list[str]
    parents: list[int]
    vertex_bone: np.ndarray         # (n,) bone index of each vertex
    positions: np.ndarray           # bone-local
    normals: np.ndarray
    uvs: np.ndarray
    indices: np.ndarray


def load_ssk(ovl: Ovl, ref: LoaderRef) -> SimpleSkin:
    o = ovl
    nb, names_p, counts_p, tc, ip, vc, vp = struct.unpack('<7I', o.read(ref.data, 28))
    if nb > 64 or vc > 100_000 or tc > 100_000:
        raise OvlError(f'{ref.name}: implausible simple skin')
    names = [o.str_field(names_p + 4 * i, f'bone{i}') for i in range(nb)]
    counts = struct.unpack(f'<{nb}I', o.read(counts_p, 4 * nb))
    vb = np.frombuffer(o.read(vp, 32 * vc), np.dtype([('p', '<f4', 3), ('n', '<f4', 3), ('uv', '<f4', 2)]))
    idx = np.frombuffer(o.read(ip, 6 * tc), '<u2').astype(np.uint32)       # triangle list, tc triangles
    vbone = np.repeat(np.arange(nb), counts)[:vc]
    if len(vbone) < vc:
        vbone = np.concatenate([vbone, np.full(vc - len(vbone), nb - 1)])
    return SimpleSkin(ref.name, names, bone_parent(names), vbone, vb['p'].copy(), vb['n'].copy(), vb['uv'].copy(), idx)


@dataclass
class SimpleClip:
    name: str
    times: np.ndarray               # (k,)
    positions: np.ndarray           # (k, bones, 3) local
    rotations: np.ndarray           # (k, bones, 3, 3) local, row-vector convention (v' = v @ R + t)


def _clip(o: Ovl, base: int, name: str) -> SimpleClip | None:
    kc, nb, tp, kp = struct.unpack('<4I', o.read(base, 16))
    if not kc or not nb or kc > 100_000 or nb > 64 or not o.is_pointer(base + 8):
        return None
    times = np.frombuffer(o.read(tp, 4 * kc), '<f4').copy()
    raw = np.frombuffer(o.read(kp, 24 * kc * nb), np.dtype([('p', '<f4', 3), ('r', '<i2', 6)])).reshape(kc, nb)
    r = raw['r'].astype(np.float32) / 32767.0
    r1, r2 = r[..., 0:3], r[..., 3:6]
    r3 = np.cross(r1, r2)
    return SimpleClip(name, times, raw['p'].copy(), np.stack([r1, r2, r3], -2))


def load_san(ovl: Ovl, ref: LoaderRef) -> list[SimpleClip]:
    base = ref.name.split(':')[0]
    clips = []
    for i, off in enumerate((0, 16)):
        c = _clip(ovl, ref.data + off, base if i == 0 else base + '_b')
        if c:
            clips.append(c)
    return clips


def load_sal(ovl: Ovl, ref: LoaderRef) -> dict:
    o = ovl
    nb, names_p = struct.unpack('<II', o.read(ref.data, 8))
    return {'bones': [o.str_field(names_p + 4 * i) for i in range(nb)]}
