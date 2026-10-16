"""Premade ride designs ('Coaster Designs\\[Ride]Name.trk') assembled into one 3D model.

The design lists its track pieces as a chain (TrackPiece.Next) with grid data (POSX/POSZ tiles of 4 m, HEIGHT in 1 m
steps, DIRECTION 0-3). Each piece is placed as the game does: turned by (DIRECTION + 2) % 4, its stored tile the
lowest corner of its footprint (its sid's squares, swapped when turned a quarter) and its origin the footprint's
centre, HEIGHT its base. Each piece's ends come from its rail splines (the train's 'joinSpline' on lift pieces); the
gaps between consecutive pieces and round each circuit are the check (build_design info['joint_gap'],
info['closure_gap']).
"""
from __future__ import annotations

import glob
import math
import os
import re

import numpy as np

from .container import OvlError
from .gltf import shape_to_glb
from .library import Library
from .meshes import Shape, SubMesh, load_shape
from .rides import _imports, track_sets
from .structs import load_spline, spline_points
from .trk import Trk, TrkError


def design_files(lib: Library) -> list[dict]:
    """[{file, ride_type, name}] for every .trk in the game's 'Coaster Designs' folder."""
    out = []
    for f in sorted(glob.glob(os.path.join(lib.root, 'Coaster Designs', '*.trk'))):
        base = os.path.basename(f)[:-4]
        m = re.match(r'\[(.*?)\](.*)', base)
        out.append({'file': f, 'ride_type': m.group(1) if m else '', 'name': (m.group(2) if m else base).strip()})
    return out


def _rail_splines(o, r) -> list:
    """The two splines the train rides along. Lift pieces (Sky Swinger, ThrillLift) list the lift car's own rails
    first and the train's track as '...joinSpline'."""
    spl = [n for n in _imports(o, r) if n.lower().endswith(':spl')]
    join = [n for n in spl if 'joinspline' in n.lower()]
    return (join or spl)[:2]


def _piece_geometry(lib, o, r):
    """Rail-spline ends and headings of a piece in its own space: (start, start_dir, end, end_dir)."""
    spl = _rail_splines(o, r)
    starts, ends, sd, ed = [], [], [], []
    for s in spl:
        h = lib.find_near(s, o)
        if not h:
            continue
        d = load_spline(h[0], h[1])
        n0, n1 = d['nodes'][0], d['nodes'][-1]
        starts.append(np.array(n0['pos'])); ends.append(np.array(n1['pos']))
        sd.append(np.array(n0['cp2'])); ed.append(-np.array(n1['cp1']))
    if not starts:
        return None
    unit = lambda v: v / max(np.linalg.norm(v), 1e-9)
    return np.mean(starts, 0), unit(np.mean(sd, 0)), np.mean(ends, 0), unit(np.mean(ed, 0))


def _piece_path(lib, o, r):
    """The piece's centreline in its own space, sampled along its two rail splines: (points (n, 3), across (n, 3)
    from the left rail to the right one, or None for a single spline)."""
    spl = _rail_splines(o, r)
    lines = []
    for s in spl:
        h = lib.find_near(s, o)
        if h:
            lines.append(np.array(spline_points(load_spline(h[0], h[1]), 8), float))
    if not lines:
        return None
    if len(lines) == 2 and len(lines[0]) == len(lines[1]):
        return (lines[0] + lines[1]) / 2, lines[1] - lines[0]
    return lines[0], None


def _roty(k: int) -> np.ndarray:
    a = k * math.pi / 2
    c, s = round(math.cos(a)), round(math.sin(a))
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], float)


def load_design(path: str) -> dict:
    t = Trk(open(path, 'rb').read())
    hdr = t.of_type('TrackedRideInstanceSaveHeader')[0][1]
    inst = t.of_type('TrackedRideInstance')
    inst = inst[0][1] if inst else {}
    pieces = {oid: v for oid, v in t.of_type('TrackPiece')}
    chains = piece_chains(pieces)
    tr = hdr.get('TestResults', {})
    return {'ride': hdr.get('TrackedRideSymbolName', ''), 'name': inst.get('Name', ''), 'cost': hdr.get('Cost'),
            'ratings': hdr.get('RideAssessmentResults', {}).get('AssessmentRatings'),
            'stats': {k: tr.get(k) for k in ('MaxSpeed', 'AverageSpeed', 'RideLength', 'RideTime', 'HighestDropHeight',
                                             'NInversions', 'NDrops', 'AirTime', 'MaxPositiveVerticalG', 'MaxLateralG')},
            'trains': inst.get('NTrains'), 'cars_per_train': inst.get('NCarsPerTrain'),
            'chains': [([pieces[o] for o in c], closed) for c, closed in chains],
            'pieces': [pieces[o] for c, _ in chains for o in c], 'closed': any(cl for _, cl in chains)}


def piece_chains(pieces: dict) -> list:
    """{oid: TrackPiece} -> [([oid...], closed)]."""
    prev = {v['Next']: oid for oid, v in pieces.items() if v['Next'] in pieces}
    # a design can hold several separate tracks (Twin Thunder: two circuits): walk each chain on its own. Open
    # chains start at a piece nothing points to; circuits at a station piece (straight, one tile: its grid position
    # is exact, and every later piece is placed relative to it)
    chains, seen = [], set()

    def walk(start):
        out, cur = [], start
        while cur in pieces and cur not in seen:
            seen.add(cur); out.append(cur); cur = pieces[cur]['Next']
        return out, cur == start
    for oid in pieces:
        if oid not in prev and oid not in seen:
            c, _ = walk(oid); chains.append((c, False))
    while len(seen) < len(pieces):
        left = [o for o in pieces if o not in seen]
        start = next((o for o in left if 'stationmiddle' in pieces[o]['SYMBOLNAME'].lower()),
                     next((o for o in left if 'station' in pieces[o]['SYMBOLNAME'].lower()), left[0]))
        c, closed = walk(start); chains.append((c, closed))
    return chains


def build_design(lib: Library, path: str) -> tuple[bytes, dict]:
    d = load_design(path)
    merged, placed, gaps, missing, ts = lay_track(lib, d['ride'], d['chains'], os.path.basename(path)[:-4])
    # move the ride from its park coordinates to the origin, lowest point at ground level. Pieces sit on 4 m tiles
    # centred on multiples of 4 m (edges at 4n+2), so shift by a whole number of tiles plus half a tile: tile edges
    # then land on multiples of 4 m, where the viewer draws its tile grid
    allp = np.concatenate([m.positions for m in merged.meshes])
    cx, cz = (allp[:, 0].min() + allp[:, 0].max()) / 2, (allp[:, 2].min() + allp[:, 2].max()) / 2
    shift = np.array([-(4 * round(cx / 4) + 2), -allp[:, 1].min(), -(4 * round(cz / 4) + 2)], np.float32)
    for m in merged.meshes:
        m.positions = m.positions + shift
    info = {k: d[k] for k in ('ride', 'name', 'cost', 'ratings', 'stats', 'trains', 'cars_per_train', 'closed')}
    footprint = (allp[:, [0, 2]].max(0) - allp[:, [0, 2]].min(0)) / 4
    info['footprint_tiles'] = f'{int(np.ceil(footprint[0] - 1e-3))} x {int(np.ceil(footprint[1] - 1e-3))}'
    info['closure_gap'] = round(max(gaps), 3) if gaps else None
    js = merged.joints
    info['joint_gap'] = round(max(j[0] for j in js), 3) if js else None
    info['bad_joints'] = [(i, n, round(g, 2)) for g, i, n in js if g > 0.1][:12]
    info['joints'] = [(i, n, round(g, 2)) for g, i, n in js]
    info.update({'pieces': len(d['pieces']), 'placed': placed, 'tracks': len(d['chains']),
                 'missing_pieces': sorted(missing), 'track_files': ts['track_ovls']})
    return track_glb(lib, merged), info


def track_glb(lib: Library, merged: Shape, colors=None) -> bytes:
    """colors: the ride's three track colours (r, g, b) for its recolourable textures."""
    lookup_ovl = {}

    def tex(n):
        return lib.texture_image(n, prefer=lookup_ovl.get(n), colors=colors)
    for m in merged.meshes:
        lookup_ovl.setdefault(m.texture, getattr(m, '_ovl', None))
    return shape_to_glb(merged, tex)


def lay_track(lib: Library, ride_symbol: str, chains: list, name: str):
    """Track pieces placed from their stored grid data, chain by chain, in the grid's own coordinates (tile n centred
    on 4n m); the joints between consecutive pieces and each circuit's closing joint are measured as the check.
    chains: [([TrackPiece fields], closed)]. -> (merged Shape, pieces placed, circuit gaps, missing pieces, track set)"""
    ride = ride_symbol.lower()
    ts = next((s for s in track_sets(lib) if s['ride'] == ride), None)
    if not ts:
        raise OvlError(f'no track pieces found for {ride_symbol}')
    where = {n.lower(): (o, n) for o, n in ts['pieces']}
    merged = Shape(name, 'shs', ((0, 0, 0), (0, 0, 0)))
    merged.path = []                                  # the centreline, piece by piece: [(points, across)]
    geo_cache, shape_cache, path_cache, half_cache, missing = {}, {}, {}, {}, set()
    placed, gaps = 0, []

    def geometry(name):
        key = name.lower()
        if key not in where:
            return None
        if key not in geo_cache:
            ovl, real = where[key]
            o, _ = lib.open(ovl); r = next(x for x in o.resources if x.name == real)
            geo_cache[key] = _piece_geometry(lib, o, r)
            shape_cache[key] = _piece_shape(lib, o, r)
            path_cache[key] = _piece_path(lib, o, r)
            half_cache[key] = _half_footprint(lib, o, r)
        if geo_cache[key] is None or shape_cache[key] is None:
            return None
        return geo_cache[key], shape_cache[key]

    joints = []                                       # (gap m, piece index, name) between consecutive pieces
    for chain, closed in chains:                      # each separate track on its own
        prev = first = None
        for ci, v in enumerate(chain):
            got = geometry(v['SYMBOLNAME'])
            if got is None:
                missing.add(v['SYMBOLNAME']); prev = None; continue
            (s, _sd, e, _ed), shp = got
            # the game's own placement: turned by DIRECTION, the stored tile is the lowest corner of the footprint
            # (the piece's sid squares), the piece's origin the footprint's centre and HEIGHT its base
            gd = v['SceneryItemDataField']
            k = (gd['DIRECTION'] + 2) % 4
            hx, hz = half_cache[v['SYMBOLNAME'].lower()]
            if k % 2:
                hx, hz = hz, hx
            R, T = _roty(k), np.array([gd['POSX'] * 4.0 + hx, gd['HEIGHT'] * 1.0, gd['POSZ'] * 4.0 + hz])
            _append(merged, shp, R, T)
            pp = path_cache.get(v['SYMBOLNAME'].lower())
            if pp is not None:
                C, L = pp
                merged.path.append((C @ R.T + T, None if L is None else L @ R.T))
            here = (R @ s + T, R @ e + T)
            if prev is not None:
                joints.append((_gap(prev, here), ci, v['SYMBOLNAME']))
            first = first or here
            prev = here
            placed += 1
        if closed and first is not None and prev is not None and len(chain) > 1:
            gaps.append(_gap(prev, first))
    merged.joints = joints
    return merged, placed, gaps, missing, ts


def _gap(a, b) -> float:
    """How far apart two pieces' nearest ends are: (start, end) each."""
    return float(min(np.linalg.norm(p - q) for p in a for q in b))


def _half_footprint(lib, o, r) -> tuple:
    """A piece's origin from its footprint's lowest tile centre (x, z): the origin is the centre of the footprint its
    sid gives in squares (4 m tiles)."""
    from .structs import load_sid
    sid = next((n for n in _imports(o, r) if n.lower().endswith(':sid')), None)
    h = lib.find_near(sid, o) if sid else None
    if not h:
        return 0.0, 0.0
    sq = load_sid(h[0], h[1])['squares']
    return max(0, sq[0] - 1) * 2.0, max(0, sq[1] - 1) * 2.0


def _piece_shape(lib, o, r):
    """The piece's highest-detail model (sid -> svd -> LOD 0), resolved in its own track folder."""
    from .anims import load_svd
    from .structs import load_sid
    sid = next((n for n in _imports(o, r) if n.lower().endswith(':sid')), None)
    h = lib.find_near(sid, o) if sid else None
    if not h:
        return None
    for vis in load_sid(h[0], h[1])['visuals']:
        hv = lib.find_near(vis, h[0]) if vis else None
        if not hv:
            continue
        lods = [l for l in load_svd(hv[0], hv[1]).lods if l.model.lower().endswith((':shs', ':bsh'))]
        if lods:
            hm = lib.find_near(lods[0].model, hv[0])
            if hm:
                s = load_shape(hm[0], hm[1])
                for m in s.meshes:
                    m._ovl = hm[0]
                return s
    return None


def _append(dst: Shape, src: Shape, R: np.ndarray, T: np.ndarray):
    for m in src.meshes:
        n = SubMesh(m.texture, m.style, m.transparency, m.flags, m.sides,
                    (m.positions.astype(np.float64) @ R.T + T).astype(np.float32),
                    (m.normals.astype(np.float64) @ R.T).astype(np.float32), m.uvs, m.colors, m.indices)
        n._ovl = getattr(m, '_ovl', None)
        dst.meshes.append(n)
