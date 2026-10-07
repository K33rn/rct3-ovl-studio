"""Find the grid units of .trk designs: each piece's rail-spline end (in its own space), placed with the piece's
grid transform, should land on the next piece's start. Tries tile sizes, height steps, rotation directions and
origin offsets; prints the best.
usage: python tests/trk_fit.py "<game folder>" [design substring]
"""
import glob
import itertools
import math
import os
import sys

import numpy as np

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl.library import Library  # noqa: E402
from rct3ovl.rides import track_sets  # noqa: E402
from rct3ovl.structs import load_spline  # noqa: E402
from rct3ovl.trk import Trk  # noqa: E402
from rct3ovl.rides import _imports  # noqa: E402

lib = Library(sys.argv[1])
want = sys.argv[2].lower() if len(sys.argv) > 2 else 'twin thunder'
f = next(x for x in sorted(glob.glob(os.path.join(sys.argv[1], 'Coaster Designs', '*.trk'))) if want in x.lower())
t = Trk(open(f, 'rb').read())
ride = t.of_type('TrackedRideInstanceSaveHeader')[0][1]['TrackedRideSymbolName'].lower()
ts = next(s for s in track_sets(lib) if s['ride'] == ride)
where = {n.lower(): o for o, n in ts['pieces']}


def ends(name):
    """start/end of the piece centreline (mean of its L/R rail splines), piece space."""
    o, _ = lib.open(where[name.lower()])
    r = next(x for x in o.resources if x.name.lower() == name.lower())
    spl = [n for n in _imports(o, r) if n.lower().endswith(':spl')][:2]
    pts = []
    for s in spl:
        h = lib.find_near(s, o)
        d = load_spline(h[0], h[1]); pts.append((np.array(d['nodes'][0]['pos']), np.array(d['nodes'][-1]['pos'])))
    a = np.mean([p[0] for p in pts], 0); b = np.mean([p[1] for p in pts], 0)
    return a, b


pieces = {oid: v for oid, v in t.of_type('TrackPiece')}
pairs = [(v, pieces[v['Next']]) for v in pieces.values() if v['Next'] in pieces]
cache = {}
best = []
for tile, hstep, rsign, rot0 in itertools.product((4.0, 2.0, 1.0), (0.25, 0.5, 1.0, 4.0 / 3, 2.0), (1, -1), (0, 1, 2, 3)):
    errs = []
    for a, b2 in pairs:
        na = a['SYMBOLNAME']
        if na not in cache:
            cache[na] = ends(na)
        sa, ea = cache[na]
        if b2['SYMBOLNAME'] not in cache:
            cache[b2['SYMBOLNAME']] = ends(b2['SYMBOLNAME'])
        sb, _ = cache[b2['SYMBOLNAME']]

        def place(p, v):
            d = v['SceneryItemDataField']
            ang = rsign * (d['DIRECTION'] + rot0) * math.pi / 2
            c, s = math.cos(ang), math.sin(ang)
            x, y, z = p
            return np.array([c * x + s * z + d['POSX'] * tile, y + d['HEIGHT'] * hstep, -s * x + c * z + d['POSZ'] * tile])
        eb = cache[b2['SYMBOLNAME']][1]
        A = (place(sa, a), place(ea, a)); B = (place(sb, b2), place(eb, b2))
        errs.append(min(np.linalg.norm(x - y) for x in A for y in B))   # pieces can be ridden backwards
    best.append((float(np.median(errs)), float(np.mean(np.array(errs) < 0.05)), tile, hstep, rsign, rot0))
best.sort()
print(os.path.basename(f), ride, len(pairs), 'links')
for x in best[:6]:
    print(f'  median gap {x[0]:.3f} m, {x[1]*100:.0f}% joined | tile {x[2]} height step {x[3]} rot sign {x[4]} rot offset {x[5]}')

if '--show' in sys.argv:
    seen = set()
    for oid in t.order:
        n, v = t.objects[oid]
        if n != 'TrackPiece' or v['SYMBOLNAME'] in seen:
            continue
        seen.add(v['SYMBOLNAME'])
        a, b = cache.get(v['SYMBOLNAME']) or ends(v['SYMBOLNAME'])
        print(f"{v['SYMBOLNAME']:28} start {np.round(a, 2)} end {np.round(b, 2)} | {v['SceneryItemDataField']}")
        if len(seen) > 14:
            break
    for i, (a, b2) in enumerate(pairs[:12]):
        print('link', a['SYMBOLNAME'], a['SceneryItemDataField'], '->', b2['SYMBOLNAME'], b2['SceneryItemDataField'])

if '--fails' in sys.argv:
    import collections
    for rsign in (1, -1):
        bad = collections.Counter(); gaps = collections.defaultdict(list)
        for a, b2 in pairs:
            def place(p, v, rsign=rsign):
                d = v['SceneryItemDataField']; ang = rsign * (d['DIRECTION'] + 2) * math.pi / 2
                c, s = math.cos(ang), math.sin(ang); x, y, z = p
                return np.array([c * x + s * z + d['POSX'] * 4, y + d['HEIGHT'] * 1.0, -s * x + c * z + d['POSZ'] * 4])
            sa, ea = cache[a['SYMBOLNAME']]; sb, eb = cache[b2['SYMBOLNAME']]
            A = (place(sa, a), place(ea, a)); B = (place(sb, b2), place(eb, b2))
            g = min((np.linalg.norm(x - y), tuple(np.round(x - y, 1))) for x in A for y in B)
            if g[0] > 0.05:
                bad[a['SYMBOLNAME']] += 1; bad[b2['SYMBOLNAME']] += 1; gaps[a['SYMBOLNAME'] + ' -> ' + b2['SYMBOLNAME']].append((g[1], a['SceneryItemDataField']['DIRECTION'], b2['SceneryItemDataField']['DIRECTION']))
        print('rot sign', rsign, 'failing pieces:', bad.most_common(8))
        for k, v in list(gaps.items())[:8]:
            print('   ', k, v[:3])

if '--corner' in sys.argv:
    from rct3ovl.structs import spline_points
    foot = {}
    def footprint(name):
        if name not in foot:
            o, _ = lib.open(where[name.lower()]); r = next(x for x in o.resources if x.name.lower() == name.lower())
            P = []
            for s in [n for n in _imports(o, r) if n.lower().endswith(':spl')][:2]:
                h = lib.find_near(s, o); d = load_spline(h[0], h[1]); P += spline_points(d, 8)
            P = np.array(P)
            lo = np.floor((P[:, [0, 2]].min(0) + 2 - 1e-3) / 4) * 4 - 2
            hi = np.ceil((P[:, [0, 2]].max(0) - 2 + 1e-3) / 4) * 4 + 2
            foot[name] = (lo, hi)
        return foot[name]
    for rsign in (1, -1):
        for rot0 in range(4):
            ok = 0
            def place(p, v):
                d = v['SceneryItemDataField']; k = (d['DIRECTION'] + rot0) % 4; ang = rsign * k * math.pi / 2
                c, s = math.cos(ang), math.sin(ang)
                rot = lambda x, z: (c * x + s * z, -s * x + c * z)
                lo, hi = footprint(v['SYMBOLNAME'])
                cx = [rot(x, z) for x in (lo[0], hi[0]) for z in (lo[1], hi[1])]
                mnx = min(q[0] for q in cx); mnz = min(q[1] for q in cx)
                x, z = rot(p[0], p[2])
                return np.array([x - mnx - 2 + d['POSX'] * 4, p[1] + d['HEIGHT'], z - mnz - 2 + d['POSZ'] * 4])
            for a, b2 in pairs:
                sa, ea = cache[a['SYMBOLNAME']]; sb, eb = cache[b2['SYMBOLNAME']]
                A = (place(sa, a), place(ea, a)); B = (place(sb, b2), place(eb, b2))
                ok += min(np.linalg.norm(x - y) for x in A for y in B) < 0.05
            print(f'corner anchoring: rot sign {rsign} offset {rot0}: {ok}/{len(pairs)} joined')

if '--entry' in sys.argv:
    def entry_centre(name):
        s, e = cache[name]
        o, _ = lib.open(where[name.lower()]); r = next(x for x in o.resources if x.name.lower() == name.lower())
        h = lib.find_near([n for n in _imports(o, r) if n.lower().endswith(':spl')][0], o); d = load_spline(h[0], h[1])
        n0 = d['nodes'][0]; tangent = np.array(n0['cp2'], float); tangent[1] = 0
        tangent /= max(np.linalg.norm(tangent), 1e-9)
        c = s + tangent * 2; c[1] = 0
        return np.round(c / 2) * 2                                    # snap to the half-tile grid
    for rsign in (1, -1):
        for rot0 in (0, 2):
            ok = 0
            def place(p, v):
                d = v['SceneryItemDataField']; ang = rsign * (d['DIRECTION'] + rot0) * math.pi / 2
                c, s = math.cos(ang), math.sin(ang)
                q = p - entry_centre(v['SYMBOLNAME'])
                return np.array([c * q[0] + s * q[2] + d['POSX'] * 4, q[1] + d['HEIGHT'], -s * q[0] + c * q[2] + d['POSZ'] * 4])
            fails = []
            for a, b2 in pairs:
                sa, ea = cache[a['SYMBOLNAME']]; sb, eb = cache[b2['SYMBOLNAME']]
                A = (place(sa, a), place(ea, a)); B = (place(sb, b2), place(eb, b2))
                g = min(np.linalg.norm(x - y) for x in A for y in B)
                ok += g < 0.05
                if g >= 0.05: fails.append(a['SYMBOLNAME'] + '->' + b2['SYMBOLNAME'])
            print(f'entry anchoring: rot sign {rsign} offset {rot0}: {ok}/{len(pairs)} joined; fails e.g. {fails[:4]}')

if '--solve' in sys.argv:
    names = sorted({v['SYMBOLNAME'] for v in pieces.values()})
    L = {n: np.zeros(3) for n in names}
    def place(p, v, rsign=1, rot0=2):
        d = v['SceneryItemDataField']; ang = rsign * (d['DIRECTION'] + rot0) * math.pi / 2
        c, s = math.cos(ang), math.sin(ang); q = p - L[v['SYMBOLNAME']]
        return np.array([c * q[0] + s * q[2] + d['POSX'] * 4, q[1] + d['HEIGHT'], -s * q[0] + c * q[2] + d['POSZ'] * 4])
    def joined(subset=None):
        k = 0
        for a, b2 in pairs:
            if subset and a['SYMBOLNAME'] not in subset and b2['SYMBOLNAME'] not in subset: continue
            sa, ea = cache[a['SYMBOLNAME']]; sb, eb = cache[b2['SYMBOLNAME']]
            A = (place(sa, a), place(ea, a)); B = (place(sb, b2), place(eb, b2))
            k += min(np.linalg.norm(x - y) for x in A for y in B) < 0.05
        return k
    grid = [np.array([x, 0, z], float) for x in range(-8, 9, 2) for z in range(-8, 9, 2)]
    for it in range(4):
        for n in names:
            best = max(grid, key=lambda g: (L.__setitem__(n, g), joined({n}))[1]); L[n] = best
    print('joined after solving:', joined(), '/', len(pairs))
    for n in names:
        s, e = cache[n]
        print(f'  {n:34} offset {L[n][[0, 2]]}  start {np.round(s[[0, 2]], 1)} end {np.round(e[[0, 2]], 1)}')
