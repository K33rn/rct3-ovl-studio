"""Splines (spl), GUI skin items (gsi) and a generic, relocation-aware structure dumper for every other type.

The generic dumper turns any resource into JSON without knowing its layout: each 32-bit field becomes an
import (name of a resource in another OVL), a pointer (followed: string, named resource, or a nested record
up to the next known structure start), a float (if it looks like one) or an integer. That makes scenery items,
rides, cars, paths, terrain types etc. readable even where field names are unknown.
"""
from __future__ import annotations

import bisect
import struct

import numpy as np

from .container import LoaderRef, Ovl, OvlError


# ---- splines ------------------------------------------------------------------------------------------------
def load_spline(ovl: Ovl, ref: LoaderRef) -> dict:
    """Spline: node count, nodes* (pos, cp1, cp2 - control points relative to pos), cyclic, total length,
    1/length, segment lengths*, segment data* (14 B each), max y."""
    o = ovl
    n, nodes_p, cyclic, total, _inv, _lens_p, _data_p, max_y = struct.unpack('<IIIffIIf', o.read(ref.data, 32))
    if n > 100_000:
        raise OvlError(f'{ref.name}: implausible spline')
    nodes = np.frombuffer(o.read(nodes_p, 36 * n), '<f4').reshape(n, 3, 3).astype(float) if n else np.zeros((0, 3, 3))
    return {'name': ref.name, 'cyclic': bool(cyclic), 'length': round(total, 5), 'max_y': round(max_y, 5),
            'nodes': [{'pos': p[0].round(5).tolist(), 'cp1': p[1].round(5).tolist(), 'cp2': p[2].round(5).tolist()}
                      for p in nodes]}


def spline_points(sp: dict, steps: int = 12) -> list[list[float]]:
    """Sample the cubic Bezier segments: node i -> node i+1 uses pos_i, pos_i + cp2_i, pos_j + cp1_j, pos_j."""
    nodes = sp['nodes']
    if len(nodes) < 2:
        return [n['pos'] for n in nodes]
    pts = []
    segs = len(nodes) if sp['cyclic'] else len(nodes) - 1
    for i in range(segs):
        a, b = nodes[i], nodes[(i + 1) % len(nodes)]
        p0 = np.array(a['pos']); p1 = p0 + a['cp2']; p3 = np.array(b['pos']); p2 = p3 + b['cp1']
        for k in range(steps + (1 if i == segs - 1 else 0)):
            t = k / steps
            pts.append(((1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3).round(5).tolist())
    return pts


# ---- scenery items ------------------------------------------------------------------------------------------
SID_TYPES = ['tree', 'plant', 'shrub', 'flowers', 'fence', 'wall misc', 'path lamp', 'scenery small', 'scenery medium',
             'scenery large', 'animatronic', 'scenery misc', 'support middle', 'support top', 'support bottom',
             'support bottom extra', 'support girder', 'support cap', 'ride track', 'path', 'park entrance', 'litter',
             'guest injection point', 'ride', 'ride entrance', 'ride exit', 'keep clear fence', 'stall', 'ride event',
             'firework', 'litter bin', 'bench', 'sign', 'photo point', 'wall straight', 'wall roof', 'wall corner',
             'water cannon', 'pool piece', 'pool extra', 'changing room', 'laser dome', 'water jet', 'terrain piece',
             'particle effect', 'animal fence', 'animal misc']
SID_SIZES = ['full tile', 'path edge inner', 'path edge outer', 'wall', 'quarter tile', 'half tile', 'path centre',
             'corner', 'path edge join']


def load_sid(ovl: Ovl, ref: LoaderRef) -> dict:
    """SceneryItem (layout from the RCT3 Importer's scenery.h): footprint, placement box, cost, type, visuals,
    icon, name and the special-behaviour parameters (bench, litter bin, sign, ride event, ...)."""
    o = ovl
    imp = {s: n for n, s in o.symbol_refs}
    d = ref.data
    v = struct.unpack('<31I', o.read(d, 124))
    f = lambda i: struct.unpack('<f', struct.pack('<I', v[i]))[0]
    s32 = lambda i: v[i] - (1 << 32) if v[i] >= 1 << 31 else v[i]

    def wstr(off):
        if off in imp:
            return {'import': imp[off]}
        if not o.is_pointer(off):
            return ''
        a, out = o.u32(off), []
        try:
            while len(out) < 400:
                c = struct.unpack('<H', o.read(a + 2 * len(out), 2))[0]
                if not c:
                    break
                out.append(chr(c))
        except OvlError:
            pass
        return ''.join(out)

    svds = []
    if o.is_pointer(d + 84):
        arr = o.u32(d + 84)
        svds = [imp.get(arr + 4 * i, '') for i in range(min(v[20], 64))]
    params = []
    if o.is_pointer(d + 108):
        arr = o.u32(d + 108)
        for i in range(min(v[26], 64)):
            params.append({'type': o.str_field(arr + 8 * i), 'params': o.str_field(arr + 8 * i + 4)})
    typ, size = v[18], v[2]
    return {'name': ref.name, 'display_name': wstr(d + 120),
            'type': SID_TYPES[typ] if typ < len(SID_TYPES) else typ,
            'size': SID_SIZES[size] if size < len(SID_SIZES) else size,
            'flags': f'0x{v[1]:08X}', 'squares': [v[4], v[5]],
            'position': [round(f(7), 4), round(f(8), 4), round(f(9), 4)],
            'box_size': [round(f(10), 4), round(f(11), 4), round(f(12), 4)],
            'cost': s32(15), 'refund': s32(16),
            'supports': o.str_field(d + 76), 'visuals': svds,
            'icon': imp.get(d + 88, ''), 'wall_set_icon': imp.get(d + 92, ''), 'wall_set_name': wstr(d + 96),
            'ovl_name': o.str_field(d + 100), 'parameters': params, 'sound_sets': v[28]}


# ---- GUI skin items (icons) ---------------------------------------------------------------------------------
def load_gsi(ovl: Ovl, ref: LoaderRef) -> dict:
    """GUISkinItem: type, texture import, rect* {left, top, right, bottom} (pixels in the texture), unk."""
    imp = {s: n for n, s in ovl.symbol_refs}
    typ, _tex, pos_p, _u = struct.unpack('<4I', ovl.read(ref.data, 16))
    rect = list(struct.unpack('<4I', ovl.read(pos_p, 16))) if ovl.is_pointer(ref.data + 8) else None
    return {'name': ref.name, 'type': typ, 'texture': imp.get(ref.data + 4, ''), 'rect': rect}


def gsi_image(lib, ovl: Ovl, ref: LoaderRef):
    g = load_gsi(ovl, ref)
    if not g['texture'] or not g['rect']:
        return None
    img = lib.texture_image(g['texture'], prefer=ovl)
    if img is None:
        return None
    l, t, r, b = g['rect']
    if r <= l or b <= t:
        return None
    return img.crop((l, t, min(r + 1, img.width), min(b + 1, img.height)))


# ---- generic ------------------------------------------------------------------------------------------------
def _boundaries(o: Ovl) -> list[int]:
    b = getattr(o, '_struct_bounds', None)
    if b is None:
        s = set()
        for site in o.relocations:
            try:
                s.add(o.u32(site))
            except OvlError:
                pass
        s.update(r.data for r in o.resources)
        for f in o.files:
            for ch in f.chunks:
                for blk in ch:
                    s.add(blk.vaddr); s.add(blk.vaddr + blk.size)
        b = sorted(s); o._struct_bounds = b
    return b


def _res_bounds(o: Ovl) -> list[int]:
    b = getattr(o, '_res_bounds_cache', None)
    if b is None:
        b = sorted({r.data for r in o.resources}); o._res_bounds_cache = b
    return b


def struct_size(o: Ovl, addr: int, cap: int = 512, top: bool = False) -> int:
    """Bytes from addr to the next address that something points at (or the block end). Top-level records
    only stop at the next resource, since other records may legitimately point into them."""
    bounds = _res_bounds(o) if top else _boundaries(o)
    i = bisect.bisect_right(bounds, addr)
    nxt = bounds[i] if i < len(bounds) else addr + cap
    try:
        _, blk_end_size = o.block_bytes(addr)
        _, b, off = o.locate(addr)
        end = b.vaddr + b.size
    except OvlError:
        return 0
    return max(0, min(nxt, end, addr + cap) - addr)


def _value(v: int):
    f = struct.unpack('<f', struct.pack('<I', v))[0]
    if v == 0:
        return 0
    if 1e-4 < abs(f) < 1e6 and (v >> 23) & 0xFF not in (0, 0xFF):
        return round(f, 6)
    return v if v < 0x80000000 else v - 0x100000000


def _ascii(o: Ovl, a: int) -> str | None:
    try:
        s = o.cstr(a, 200)
    except OvlError:
        return None
    if len(s) >= 1 and all(32 <= ord(c) < 127 for c in s):
        try:
            if o.read(a + len(s), 1) == b'\0':
                return s
        except OvlError:
            return s
    return None


def dump(o: Ovl, addr: int, depth: int = 2, cap: int = 256, _seen=None, top: bool = False) -> list:
    """Fields of the record at addr as a JSON-able list."""
    imp = getattr(o, '_import_map', None)
    if imp is None:
        imp = {s: n for n, s in o.symbol_refs}; o._import_map = imp
    names = getattr(o, '_res_by_addr', None)
    if names is None:
        names = {r.data: (r.name or f'({r.loader.tag})') for r in o.resources}; o._res_by_addr = names
    _seen = _seen if _seen is not None else set()
    size = struct_size(o, addr, cap, top)
    out = []
    for off in range(0, size - size % 4, 4):
        a = addr + off
        v = o.u32(a)
        key = f'+0x{off:02X}'
        if a in imp:
            out.append({key: {'import': imp[a]}})
        elif o.is_pointer(a):
            ent = {'ptr': v}
            if v in names and v != addr:
                ent['resource'] = names[v]
            else:
                s = _ascii(o, v)
                if s is not None:
                    ent['string'] = s
                elif depth > 0 and v not in _seen:
                    _seen.add(v)
                    try:
                        ent['data'] = dump(o, v, depth - 1, cap, _seen)
                    except OvlError:
                        pass
            out.append({key: ent})
        else:
            out.append({key: _value(v)})
    return out


def describe(o: Ovl, ref: LoaderRef) -> dict:
    return {'name': ref.name, 'type': ref.loader.name, 'tag': ref.loader.tag, 'address': ref.data,
            'stored_in': ref.part, 'extra_data_bytes': [len(e) for e in ref.extra],
            'fields': dump(o, ref.data, cap=1024, top=True)}
