"""A vertical loop for the Heartline Coaster, made from the game's own pieces.

The Heartline Coaster (tracks/coasters/Heartline, track style Track7) has only straights, slopes, inline twists and
the transfer pieces. This adds two track sections, Loopleft and Loopright, built from data in the user's own game:

- Path: the Looping Roller Coaster's loops (Track11 Loopleft/Loopright: entered from a medium slope up, left on a
  medium slope down, one tile to the side). Every track style's medium-slope rails lie on a line of slope 1/2;
  Heartline's lies 0.957 m (perpendicular) above Track11's, and its joints sit a little further along it. So the
  Heartline rail centre line is Track11's offset by that much along the track's up vector, trimmed to end exactly
  on Heartline's medium-slope joints; the rails are 1.35 m either side of it (Heartline's gauge). Splines get the
  game's per-segment speed table (the curve parameter at 14 equal steps of length, x255, rounded up).
- Look: Heartline's straight track (Track7 Straight_data, its three levels of detail) cut into 1 m slices (2 m at lower
  detail) and bent along the loop; the support frames and the ground shadow are left out (the game's loops carry none).
- Names: exactly as every track style names its loops (Loopleft:tks, Loopleft:sid, LoopleftL_spline:spl,
  Loopleft_data with Loopleft:svd / Loopleft_HI:shs...), each ride resolving them in its own track folder as it does
  Straight:tks: the builder shows the game's "Loop" (SceneryItem_Loopleft:txt, translated) and the price list finds
  them. Unique names (HLLoopLeft:tks with internal name Loopleft) crashed the game when the builder offered the loop;
  with internal name HLLoopLeft they worked but were listed as "HLLoopLeft" and not priced.
- Section and scenery item: Heartline's own layout (vanilla TrackSection / SceneryItem) with the loop's values
  (curve 7/7, special 12, direction, entry slope 1 = medium up, exit 2 = medium down) and the Looping Coaster
  loop's footprint (4 x 2 tiles, the heights each tile blocks), Heartline's supports (ts5).
- Files: the sections, scenery items and rail splines go into Track7's own pair (beside Heartline's other pieces: a
  separate OVL referenced from the ride crashed the game when the builder first offered the loop); the models are
  new Loopleft_data / Loopright_data pairs; Heartline's ride lists the two sections and their price (the loop's
  at Heartline's rates: 1.5 x the Looping Coaster's).
"""
from __future__ import annotations

import math
import os
import struct

import numpy as np

from .container import Ovl
from .ovlwrite import Model

T7 = 'tracks/coasters/Track7'
T11 = 'tracks/coasters/Track11'
HEARTLINE = 'tracks/coasters/Heartline/Heartline'
WHAT = 'Vertical loops (Loop left, Loop right)'
PIECES = {'Loopleft': 'Loopleft', 'Loopright': 'Loopright'}        # new section -> Looping Coaster piece it follows
COST = 50700                                                         # Looping Coaster 33,800 x Heartline's 1.5
HALF_GAUGE = 1.35
SLICE = 1.0


def _p(lib, rel):
    return os.path.join(lib.root, *rel.split('/'))


# ---- splines -------------------------------------------------------------------------------------------------
def _bez(P, t):
    t = np.asarray(t, float)[..., None]
    p1, p2, p3, p4 = P
    return (1 - t) ** 3 * p1 + 3 * (1 - t) ** 2 * t * p2 + 3 * (1 - t) * t * t * p3 + t ** 3 * p4


def _read_spline(o: Ovl, name: str) -> np.ndarray:
    r = next(x for x in o.by_tag('spl') if x.name.lower() == name.lower())
    n, nodes_p = struct.unpack('<II', o.read(r.data, 8))
    return np.frombuffer(o.read(nodes_p, 36 * n), '<f4').reshape(n, 3, 3).astype(float)


def _sample(nodes: np.ndarray, per: int = 400) -> np.ndarray:
    out = []
    for i in range(len(nodes) - 1):
        a, b = nodes[i], nodes[i + 1]
        P = (a[0], a[0] + a[2], b[0] + b[1], b[0])
        ts = np.linspace(0, 1, per + 1)[:-1] if i < len(nodes) - 2 else np.linspace(0, 1, per + 1)
        out.append(_bez(P, ts))
    return np.concatenate(out)


def _unit(v):
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def _arclen(p):
    return np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]


def segment_data(P) -> tuple[float, bytes]:
    """Length of one Bezier segment and the game's 14-byte table: the curve parameter at 1/15 .. 14/15 of the
    length, x255, rounded up (matches the game's own splines to within rounding)."""
    ts = np.linspace(0, 1, 101)
    pts = _bez(P, ts)
    d = _arclen(pts)
    L = float(d[-1])
    data = bytes(min(255, int(math.ceil(255 * float(np.interp(k / 15 * L, d, ts)) - 1e-9))) for k in range(1, 15))
    return L, data


def spline_bytes(nodes: np.ndarray) -> tuple[bytes, list[int]]:
    """A Spline structure followed by its nodes, lengths and tables: (bytes, offsets of its 3 pointers' targets)."""
    n = len(nodes)
    lens, datas = [], []
    for i in range(n - 1):
        a, b = nodes[i], nodes[i + 1]
        L, d = segment_data((a[0], a[0] + a[2], b[0] + b[1], b[0]))
        lens.append(L); datas.append(d)
    total = float(sum(lens))
    max_y = float(max(nodes[:, 0, 1]))
    nodes_off = 32
    lens_off = nodes_off + 36 * n
    data_off = lens_off + 4 * len(lens)
    head = struct.pack('<IIIffIIf', n, 0, 0, total, 1 / total, 0, 0, max_y)
    body = nodes.astype('<f4').tobytes() + struct.pack(f'<{len(lens)}f', *lens) + b''.join(datas)
    pad = (-(32 + len(body))) % 4
    return head + body + b'\0' * pad, [nodes_off, lens_off, data_off]


def _fit(points: np.ndarray, count: int, t0: np.ndarray, t1: np.ndarray) -> np.ndarray:
    """Spline nodes through a dense polyline: count+1 nodes evenly spaced by length, control points along the
    local direction (a third of the neighbouring gap); the end directions are given exactly."""
    d = _arclen(points)
    s = np.linspace(0, d[-1], count + 1)
    pos = np.stack([np.interp(s, d, points[:, k]) for k in range(3)], 1)
    pos[0], pos[-1] = points[0], points[-1]
    nodes = np.zeros((count + 1, 3, 3))
    for i in range(count + 1):
        if i == 0:
            tan = t0
        elif i == count:
            tan = t1
        else:
            j = np.searchsorted(d, s[i])
            tan = _unit(points[min(j + 1, len(points) - 1)] - points[max(j - 1, 0)])
        gp = np.linalg.norm(pos[i] - pos[i - 1]) / 3 if i else 0
        gn = np.linalg.norm(pos[i + 1] - pos[i]) / 3 if i < count else 0
        nodes[i, 0] = pos[i]
        nodes[i, 1] = -tan * gp
        nodes[i, 2] = tan * gn
    return nodes


def _joint(o7: Ovl, o11: Ovl):
    """Where Heartline's medium-slope joint lies relative to Track11's: (perpendicular offset of the rail centre
    lines, Heartline's joint centre relative to the tile edge at the bottom of a medium slope, the L/R height
    split)."""
    def start(o, nm):
        return _read_spline(o, nm)[0, 0]
    l7, r7 = start(o7, 'MedslopeL_spline:spl'), start(o7, 'MedslopeR_spline:spl')
    l11, r11 = start(o11, 'MedslopeL_spline:spl'), start(o11, 'MedslopeR_spline:spl')
    c7, c11 = (l7 + r7) / 2, (l11 + r11) / 2
    n = np.array([1, 2, 0]) / math.sqrt(5)              # up vector of a medium slope climbing towards -x
    off = float(np.dot(c7 - c11, n))
    split = float(np.dot(l7 - r7, n)) / 2
    return off, c7 - np.array([2.0, 0, c7[2]]), split


def loop_geometry(lib, piece: str) -> dict:
    """The Heartline loop following Track11's piece: rail splines (nodes) and the centre-line frames for the model."""
    o7, o11 = Ovl(_p(lib, f'{T7}/Track7')), Ovl(_p(lib, f'{T11}/Track11'))
    off, jrel, split = _joint(o7, o11)
    L = _sample(_read_spline(o11, f'{piece}L_spline:spl'))
    R = _sample(_read_spline(o11, f'{piece}R_spline:spl'))
    C = (L + R) / 2
    lat = _unit(R - L)
    T = _unit(np.gradient(C, axis=0))
    up = _unit(np.cross(T, lat))
    lat = _unit(np.cross(up, T))
    D = C + up * off
    # Heartline's joints: the tile edge at x = +-4 (Track11 loops start and end there), on the medium-slope line
    z0, z1 = C[0, 2], C[-1, 2]
    e0 = np.array([4 + jrel[0], jrel[1], z0])
    e1 = np.array([-4 - jrel[0], jrel[1], z1])
    i0 = int(np.argmin(np.linalg.norm(D - e0, axis=1)))
    i1 = int(np.argmin(np.linalg.norm(D - e1, axis=1)))
    err = (float(np.linalg.norm(D[i0] - e0)), float(np.linalg.norm(D[i1] - e1)))
    D, T, up, lat = D[i0:i1 + 1].copy(), T[i0:i1 + 1], up[i0:i1 + 1], lat[i0:i1 + 1]
    D[0], D[-1] = e0, e1
    t_in, t_out = np.array([-2, 1, 0]) / math.sqrt(5), np.array([-2, -1, 0]) / math.sqrt(5)
    T = T.copy(); T[0], T[-1] = t_in, t_out
    up = _unit(np.cross(T, lat)); lat = _unit(np.cross(up, T))
    rails = {}
    segs = 32
    for side, sgn in (('L', -1), ('R', 1)):
        P = D + lat * (sgn * HALF_GAUGE) - up * (sgn * split)
        rails[side] = _fit(P, segs, t_in, t_out)
    return {'centre': D, 'tangent': T, 'up': up, 'lateral': lat, 'length': float(_arclen(D)[-1]),
            'rails': rails, 'joint_error': err}


# ---- model ------------------------------------------------------------------------------------------------------
def _slice(pos, nrm, uv, col, tri, xs):
    """Cut triangles along the planes x = each of xs (new vertices interpolate every attribute)."""
    P, N, U, C = list(pos), list(nrm), list(uv), list(col.astype(float))
    tris = [tuple(t) for t in tri]

    def mid(a, b, t):
        P.append(P[a] + (P[b] - P[a]) * t); N.append(N[a] + (N[b] - N[a]) * t)
        U.append(U[a] + (U[b] - U[a]) * t); C.append(C[a] + (C[b] - C[a]) * t)
        return len(P) - 1
    for x in xs:
        out = []
        cache = {}
        for t in tris:
            side = [P[i][0] - x for i in t]
            if all(s >= -1e-6 for s in side) or all(s <= 1e-6 for s in side):
                out.append(t); continue
            # rotate so vertex 0 is alone on its side
            for k in range(3):
                a, b, c = t[k], t[(k + 1) % 3], t[(k + 2) % 3]
                sa, sb, sc = side[k], side[(k + 1) % 3], side[(k + 2) % 3]
                if (sa > 0) != (sb > 0) and (sa > 0) != (sc > 0) and abs(sb) > 1e-6 and abs(sc) > 1e-6:
                    break
            else:
                out.append(t); continue

            def cut(i, j, si, sj):
                key = (min(i, j), max(i, j))
                if key not in cache:
                    cache[key] = mid(i, j, si / (si - sj))
                return cache[key]
            ab, ac = cut(a, b, sa, sb), cut(a, c, sa, sc)
            out += [(a, ab, ac), (ab, b, c), (ab, c, ac)]
        tris = out
    return np.array(P), np.array(N), np.array(U), np.array(C), np.array(tris)


def bend(mesh: dict, geo: dict, x0: float = 2.0, length: float = 4.0, yc: float = 1.80672, step: float = SLICE) -> dict:
    """Copies of a straight piece's mesh (running from x0 to x0 - length, rails at height yc) bent along the loop."""
    D, T, up, lat = geo['centre'], geo['tangent'], geo['up'], geo['lateral']
    s_all = _arclen(D)
    total = s_all[-1]
    k = max(1, round(total / length))
    scale = total / (k * length)
    xs = [x0 - step * i for i in range(1, int(round(length / step)))]
    P, N, U, C, tri = _slice(mesh['pos'], mesh['nrm'], mesh['uv'], mesh['col'], mesh['tri'], xs)
    outP, outN, outT = [], [], []
    for c in range(k):
        s = (c * length + (x0 - P[:, 0])) * scale
        s = np.clip(s, 0, total)
        f = lambda A: np.stack([np.interp(s, s_all, A[:, j]) for j in range(3)], 1)
        t_, u_, l_ = _unit(f(T)), _unit(f(up)), _unit(f(lat))
        outP.append(f(D) + u_ * (P[:, 1:2] - yc) + l_ * P[:, 2:3])
        outN.append(_unit(-t_ * N[:, 0:1] + u_ * N[:, 1:2] + l_ * N[:, 2:3] + 1e-12))
        outT.append(tri + c * len(P))
    return {'pos': np.concatenate(outP), 'nrm': np.concatenate(outN), 'uv': np.tile(U, (k, 1)),
            'col': np.tile(C, (k, 1)), 'tri': np.concatenate(outT)}


# ---- writing the files --------------------------------------------------------------------------------------------
_VTX = np.dtype([('pos', '<f4', 3), ('nrm', '<f4', 3), ('col', 'u1', 4), ('uv', '<f4', 2)])


def _shape_records(m: Model, part_blk, off):
    """Header fields of a shs at (block, offset) -> (mesh pointer array target, effect name array target)."""
    return m.target(part_blk, off + 40), m.target(part_blk, off + 52)


def build_data_ovl(lib, name: str, geo: dict, out: str):
    """Clone Track7's Straight_data (svd + three shs), rename it and fill each shs with the bent track mesh."""
    m = Model.read(_p(lib, f'{T7}/Straight_data'))
    src = Ovl(_p(lib, f'{T7}/Straight_data'))
    from .meshes import load_shape
    # locate each shs in the model by its symbol
    for nm, sym_i in m.symbols('unique'):
        if not nm.lower().endswith(':shs'):
            continue
        sym = m.parts['unique'].chunks[2][0]
        blk, off = m.target(sym, 12 * sym_i + 4)
        ref = next(r for r in src.resources if r.name == nm)
        shape = load_shape(src, ref)
        tm = shape.meshes[0]
        mesh = {'pos': tm.positions.astype(float), 'nrm': tm.normals.astype(float), 'uv': tm.uvs.astype(float),
                'col': tm.colors[:, [2, 1, 0, 3]].astype(float), 'tri': tm.indices.reshape(-1, 3)}
        b = bend(mesh, geo, step=SLICE if nm.lower().endswith('_hi:shs') else 2 * SLICE)
        v = np.zeros(len(b['pos']), _VTX)
        v['pos'], v['nrm'], v['uv'] = b['pos'], b['nrm'], b['uv']
        v['col'] = np.clip(np.round(b['col']), 0, 255).astype(np.uint8)
        idx = b['tri'].astype('<u4').ravel()
        vb = m.new_block('common', 4, v.tobytes())
        ib = m.new_block('common', 4, idx.tobytes())
        mesh_arr = m.target(blk, off + 40)
        rec = m.target(mesh_arr[0], mesh_arr[1])            # first sub-mesh: the track
        rb, ro = rec
        struct.pack_into('<II', rb.data, ro + 24, len(v), len(idx))
        m.set_ptr(rb, ro + 32, vb, 0)
        m.set_ptr(rb, ro + 36, ib, 0)
        lo, hi = b['pos'].min(0), b['pos'].max(0)
        struct.pack_into('<6f4I', blk.data, off, *lo, *hi, len(v), len(idx), 1, 1)
        struct.pack_into('<I', blk.data, off + 44, 1)         # keep only the piece's own reference point
    _rename_all(m, 'Straight', name)
    m.write(out)


def _rename_all(m: Model, old: str, new: str):
    """Every pointer to a string starting with old (any case; symbol names, level-of-detail names, effect names -
    which live in the mesh blocks, not the string table) is re-aimed at the renamed string."""
    for r in m.rels():
        b = r.tblk
        if b is None:
            continue
        end = b.data.find(0, r.toff)
        if end < 0 or end - r.toff > 200:
            continue
        raw = bytes(b.data[r.toff:end])
        if not raw[:len(old)].lower() == old.lower().encode() or not all(32 <= c < 127 for c in raw):
            continue
        st = raw.decode('latin-1')
        r.tblk, r.toff = m.add_string((new if st[0].isupper() else new.lower()) + st[len(old):])


def _tks_bytes(o7: Ovl, piece: str) -> bytearray:
    r = next(x for x in o7.by_tag('tks') if x.name == 'Inlinetwistleft:tks')
    d = bytearray(o7.read(r.data, 0xe4))
    left = piece == 'Loopleft'
    # loop values, as every track style's Loopleft / Loopright: curves 7/7, special 12, direction 1 / 2,
    # entry slope 1 (medium up), exit slope 2 (medium down); flags and the 25s as Heartline's own pieces
    struct.pack_into('<6I', d, 8, 7, 7, 12, 1 if left else 2, 4, 4)
    struct.pack_into('<I', d, 0x48, 1)
    struct.pack_into('<I', d, 0x64, 2)
    return d


def add_sections(m: Model, lib, geos: dict):
    """Into Track7's own pair (as the game's pieces are, so the ride loads their models the same way): per loop
    two rail splines (common), a name text (common), a scenery item and a track section (unique)."""
    o7 = Ovl(_p(lib, f'{T7}/Track7'))
    o11 = Ovl(_p(lib, f'{T11}/Track11'))
    sid_t = m.loader_type('unique', 'RCT3', 'SceneryItem', 'sid')
    spl_t = m.loader_type('common', 'FGDK', 'Spline', 'spl')
    tks_t = m.loader_type('unique', 'FGDK', 'TrackSection', 'tks')
    cdata = m.new_block('common', 2)
    udata = m.new_block('unique', 2)
    t7sid = next(x for x in o7.by_tag('sid') if x.name == 'Inlinetwistleft:sid')
    t11sid = next(x for x in o11.by_tag('sid') if x.name == 'Loopleft:sid')
    for new, piece in PIECES.items():
        geo = geos[new]
        # splines (common)
        for side in ('L', 'R'):
            raw, offs = spline_bytes(geo['rails'][side])
            at = m.append(cdata, raw)
            for k, o in enumerate(offs):
                m.set_ptr(cdata, at + [4, 20, 24][k], cdata, at + o)
            so = m.add_symbol('common', f'{new}{side}_spline:spl', cdata, at)
            m.add_loader('common', spl_t, cdata, at, so)
        # scenery item (unique): Heartline's layout, the loop's footprint and box
        sid = bytearray(o7.read(t7sid.data, 0xd4))
        struct.pack_into('<I', sid, 8, 0)
        sx, sz, sq_p = struct.unpack('<3I', o11.read(t11sid.data + 16, 12))
        struct.pack_into('<II', sid, 16, sx, sz)
        sid[0x28:0x34] = o11.read(t11sid.data + 0x28, 12)       # placement box 16 x 20 x 8
        sid_at = m.append(udata, bytes(sid))
        sq = bytearray(o11.read(sq_p, 20 * sx * sz))
        sq_at = m.append(udata, b'\0' * len(sq))
        m.set_ptr(udata, sid_at + 0x18, udata, sq_at)
        for i in range(sx * sz):
            fl, mn, mx, bp, _sup = struct.unpack_from('<IiiII', sq, 20 * i)
            struct.pack_into('<IiiII', udata.data, sq_at + 20 * i, fl, mn, mx, 0, 6)
            if o11.is_pointer(sq_p + 20 * i + 12):
                nb = max(1, (mx - mn + 31) // 32)
                bits_at = m.append(udata, o11.read(bp, 4 * nb))
                m.set_ptr(udata, sq_at + 20 * i + 12, udata, bits_at)
        m.set_ptr(udata, sid_at + 0x4c, *m.add_string('ts5'))
        svd_arr = m.append(udata, b'\0' * 4)
        m.set_ptr(udata, sid_at + 0x54, udata, svd_arr)
        m.set_ptr(udata, sid_at + 0x64, *m.add_string(f'tracks\\coasters\\Track7\\{new}_data'))
        sid_ldr = m.add_loader('unique', sid_t, udata, sid_at, m.add_symbol('unique', f'{new}:sid', udata, sid_at))
        m.add_symref('unique', sid_ldr, udata, svd_arr, f'{new}:svd')
        m.add_symref('unique', sid_ldr, udata, sid_at + 0x78, f'SceneryItem_{new}:txt')
        # track section (unique)
        tks_at = m.append(udata, bytes(_tks_bytes(o7, piece)))
        m.set_ptr(udata, tks_at, *m.add_string(new))
        tks_ldr = m.add_loader('unique', tks_t, udata, tks_at, m.add_symbol('unique', f'{new}:tks', udata, tks_at))
        m.add_symref('unique', tks_ldr, udata, tks_at + 4, f'{new}:sid')
        for k, side in enumerate('LRLR'):
            m.add_symref('unique', tks_ldr, udata, tks_at + 0x20 + 4 * k, f'{new}{side}_spline:spl')


def patch_heartline(m: Model):
    """Heartline's ride: the two loops appended to its sections and its price list."""
    sym = m.parts['unique'].chunks[2][0]
    (nm, i), = [(n, i) for n, i in m.symbols('unique') if n.lower().endswith(':trr')]
    blk, off = m.target(sym, 12 * i + 4)
    n = struct.unpack_from('<I', blk.data, off + 0x50)[0]
    ldr = m.loader_index('unique', blk, off)
    # sections: the pointer array (right after the ride) grows by two imports
    ab, ao = m.target(blk, off + 0x54)
    at = ao + 4 * n
    m.insert(ab, at, b'\0' * 8)
    for k, new in enumerate(PIECES):
        m.add_symref('unique', ldr, ab, at + 4 * k, f'{new}:tks')
    struct.pack_into('<I', blk.data, off + 0x50, n + 2)
    # prices: {name*, cost} per section, in the same order (the name is the section's kind: chain lifts use the
    # plain piece's name)
    pn = struct.unpack_from('<I', blk.data, off + 0x150)[0]
    pb, po = m.target(blk, off + 0x154)
    pat = po + 8 * pn
    m.insert(pb, pat, b'\0' * 16)
    for k, piece in enumerate(PIECES.values()):
        struct.pack_into('<I', pb.data, pat + 8 * k + 4, COST)
        m.set_ptr(pb, pat + 8 * k, *m.add_string(piece.lower()))
    struct.pack_into('<I', blk.data, off + 0x150, pn + 2)


def build(src_root: str, out_root: str) -> dict:
    """Read the game's files from src_root (originals), write the changed and new ones into out_root (laid out like
    the game folder)."""
    class Src:
        root = src_root
    geos = {new: loop_geometry(Src, piece) for new, piece in PIECES.items()}
    for new in PIECES:
        build_data_ovl(Src, new, geos[new], os.path.join(out_root, *T7.split('/'), f'{new}_data'))
    m = Model.read(_p(Src, f'{T7}/Track7'))
    add_sections(m, Src, geos)
    m.write(os.path.join(out_root, *T7.split('/'), 'Track7'))
    m = Model.read(_p(Src, HEARTLINE))
    patch_heartline(m)
    m.write(os.path.join(out_root, *HEARTLINE.split('/')))
    return {new: {'length_m': round(g['length'], 2), 'joint_error_m': [round(e, 4) for e in g['joint_error']]}
            for new, g in geos.items()}


# ---- installing -------------------------------------------------------------------------------------------------
CHANGED = [HEARTLINE, f'{T7}/Track7']
ADDED = [f'{T7}/{p}_data' for p in PIECES]


def _rel(p: str, part: str = 'common') -> str:
    return os.path.join(*p.split('/')) + f'.{part}.ovl'


def installed(lib) -> bool:
    return all(os.path.exists(os.path.join(lib.root, _rel(p))) for p in ADDED)


def install(lib) -> dict:
    """Write the loops into the game. Heartline's and Track7's pairs are backed up first and the build always starts
    from those originals (installing again never stacks a second pair); Textures & GUI > Changed files puts both back
    and removes the new model files."""
    import shutil
    import time
    from . import texedit as tx
    bdir = tx._backup_dir(lib)
    for p in CHANGED:
        for part in ('common', 'unique'):
            src, dst = os.path.join(lib.root, _rel(p, part)), os.path.join(bdir, _rel(p, part))
            if not os.path.exists(tx._lp(dst)):
                os.makedirs(tx._lp(os.path.dirname(dst)), exist_ok=True)
                shutil.copy2(tx._lp(src), tx._lp(dst))
    # the originals (backups) of the changed pairs, the pieces it borrows from read from the game folder
    src = os.path.join(bdir, 'loop-src')
    stage = os.path.join(bdir, 'loop-stage')
    for d in (src, stage):
        shutil.rmtree(d, ignore_errors=True)
    for p in [f'{T7}/Straight_data', f'{T11}/Track11'] + CHANGED:
        for part in ('common', 'unique'):
            frm = os.path.join(bdir if p in CHANGED else lib.root, _rel(p, part))
            os.makedirs(os.path.dirname(os.path.join(src, _rel(p, part))), exist_ok=True)
            shutil.copy2(tx._lp(frm), os.path.join(src, _rel(p, part)))
    info = build(src, stage)
    for p in CHANGED + ADDED:
        for part in ('common', 'unique'):
            try:
                shutil.copyfile(os.path.join(stage, _rel(p, part)), os.path.join(lib.root, _rel(p, part)))
            except PermissionError:
                raise PermissionError(f'{os.path.basename(p)} is in use - close RollerCoaster Tycoon 3 and try again')
    for d in (src, stage):
        shutil.rmtree(d, ignore_errors=True)
    e = tx.edits(lib)
    for p in CHANGED:
        key = tx.norm(lib, _rel(p))
        ent = e.setdefault(key, {'changes': []})
        if WHAT not in ent['changes']:
            ent['changes'].append(WHAT)
        if p == f'{T7}/Track7':
            ent['added'] = [_rel(a, part) for a in ADDED for part in ('common', 'unique')]
        ent['time'] = time.strftime('%Y-%m-%d %H:%M')
    tx._save_edits(lib, e)
    for p in CHANGED:
        tx._reload(lib, tx.norm(lib, _rel(p)))
    if hasattr(lib, 'refresh_index'):
        lib.refresh_index()
    return info


def uninstall(lib):
    """Both pairs back as they were, the model files removed."""
    from . import texedit as tx
    for p in CHANGED:
        if tx.norm(lib, _rel(p)) in tx.edits(lib):
            tx.restore(lib, _rel(p))


def status(lib) -> dict:
    """For the Mod Loader's additions list."""
    from . import texedit as tx
    ent = tx.edits(lib).get(tx.norm(lib, _rel(f'{T7}/Track7')), {})
    return {'id': 'heartline-loop', 'name': 'Heartline Coaster: vertical loop',
            'about': 'A vertical loop (left and right) for the Heartline Coaster, made from its own track and the '
                     "Looping Coaster's loop path. Built from a medium slope up, like every coaster's loop.",
            'installed': installed(lib) and WHAT in ent.get('changes', [])}
