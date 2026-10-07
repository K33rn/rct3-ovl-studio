"""Premade ride designs ('Coaster Designs\\[Ride]Name.trk') assembled into one 3D model.

The design lists its track pieces as a chain (TrackPiece.Next) with grid data (POSX/POSZ tiles of 4 m, HEIGHT in 1 m
steps, DIRECTION 0-3). Single-tile pieces sit on their tile, but the reference tile of multi-tile pieces (curves,
helices) isn't simply their start or footprint corner, so pieces are placed by following the chain instead: the first
piece by its grid position, every next piece joined end-to-end to the previous one, turned to whichever of the four
directions continues the previous exit heading (DIRECTION breaks ties), ridden forwards or backwards - downhill track is
an uphill piece placed reversed. Each piece's ends and headings come from its rail splines. A closed circuit returning
to its start is the check (see build_design info['closure_gap']).
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
from .structs import load_spline
from .trk import Trk, TrkError


def design_files(lib: Library) -> list[dict]:
    """[{file, ride_type, name}] for every .trk in the game's 'Coaster Designs' folder."""
    out = []
    for f in sorted(glob.glob(os.path.join(lib.root, 'Coaster Designs', '*.trk'))):
        base = os.path.basename(f)[:-4]
        m = re.match(r'\[(.*?)\](.*)', base)
        out.append({'file': f, 'ride_type': m.group(1) if m else '', 'name': (m.group(2) if m else base).strip()})
    return out


def _piece_geometry(lib, o, r):
    """Rail-spline ends and headings of a piece in its own space: (start, start_dir, end, end_dir)."""
    spl = [n for n in _imports(o, r) if n.lower().endswith(':spl')][:2]
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
    tr = hdr.get('TestResults', {})
    return {'ride': hdr.get('TrackedRideSymbolName', ''), 'name': inst.get('Name', ''), 'cost': hdr.get('Cost'),
            'ratings': hdr.get('RideAssessmentResults', {}).get('AssessmentRatings'),
            'stats': {k: tr.get(k) for k in ('MaxSpeed', 'AverageSpeed', 'RideLength', 'RideTime', 'HighestDropHeight',
                                             'NInversions', 'NDrops', 'AirTime', 'MaxPositiveVerticalG', 'MaxLateralG')},
            'trains': inst.get('NTrains'), 'cars_per_train': inst.get('NCarsPerTrain'),
            'chains': [([pieces[o] for o in c], closed) for c, closed in chains],
            'pieces': [pieces[o] for c, _ in chains for o in c], 'closed': any(cl for _, cl in chains)}


def build_design(lib: Library, path: str) -> tuple[bytes, dict]:
    d = load_design(path)
    ride = d['ride'].lower()
    ts = next((s for s in track_sets(lib) if s['ride'] == ride), None)
    if not ts:
        raise OvlError(f'no track pieces found for {d["ride"]}')
    where = {n.lower(): (o, n) for o, n in ts['pieces']}
    merged = Shape(os.path.basename(path)[:-4], 'shs', ((0, 0, 0), (0, 0, 0)))
    geo_cache, shape_cache, missing = {}, {}, set()
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
        if geo_cache[key] is None or shape_cache[key] is None:
            return None
        return geo_cache[key], shape_cache[key]

    for chain, closed in d['chains']:                 # each separate track on its own
        cur_pos = cur_dir = None
        first_in = out_first = None
        for ci, v in enumerate(chain):
            got = geometry(v['SYMBOLNAME'])
            if got is None:
                missing.add(v['SYMBOLNAME']); continue
            (s, sdir, e, edir), shp = got
            gd = v['SceneryItemDataField']
            grid_rot = (gd['DIRECTION'] + 2) % 4
            if cur_pos is None:                        # first piece of the track: its own grid position
                R = _roty(grid_rot); T = np.array([gd['POSX'] * 4.0, gd['HEIGHT'] * 1.0, gd['POSZ'] * 4.0])
                out_p, out_d = R @ e + T, R @ edir
            else:
                best = None
                nd = chain[ci + 1]['SceneryItemDataField'] if ci + 1 < len(chain) else None
                nxt = np.array([nd['POSX'] * 4.0, nd['POSZ'] * 4.0]) if nd else None
                grid_xz = np.array([gd['POSX'] * 4.0, gd['POSZ'] * 4.0])
                local_low = min(s[1], e[1])
                for k in range(4):
                    R = _roty(k)
                    for rev in (False, True):
                        ip, idir, op, odir = (e, -edir, s, -sdir) if rev else (s, sdir, e, edir)
                        hd = R @ idir
                        Tc = cur_pos - R @ ip
                        # 1) continue the previous heading; 2) sit at the stored HEIGHT (a slope ridden forwards
                        # climbs, the same slope turned round and ridden backwards falls); 3) stay near its tile
                        low = min((R @ s + Tc)[1], (R @ e + Tc)[1])
                        height_err = abs(low - (gd['HEIGHT'] * 1.0 + local_low))
                        mid = (R @ ((s + e) / 2) + Tc)[[0, 2]]
                        score = 10 * float(np.dot(hd, cur_dir)) - height_err \
                            - 0.02 * float(np.linalg.norm(mid - grid_xz)) + (0.01 if k == grid_rot else 0)
                        if abs(cur_dir[1]) > 0.9 and nxt is not None:
                            # vertical joint (top-hat towers, vertical lifts): every rotation continues straight up
                            # or down; the one whose exit lands nearest the next piece's tile wins
                            score -= 0.5 * float(np.linalg.norm((R @ op + Tc)[[0, 2]] - nxt))
                        if best is None or score > best[0]:
                            best = (score, R, ip, op, odir)
                _, R, ip, op, odir = best
                T = cur_pos - R @ ip
                out_p, out_d = R @ op + T, R @ odir
            _append(merged, shp, R, T)
            if first_in is None:
                first_in, out_first = R @ s + T, R @ e + T   # where a circuit has to come back to
            cur_pos, cur_dir = out_p, out_d
            placed += 1
        if closed and first_in is not None:
            gaps.append(float(min(np.linalg.norm(cur_pos - first_in), np.linalg.norm(cur_pos - out_first))))
    if not merged.meshes:
        raise OvlError('none of the design\'s track pieces could be placed')
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
    info.update({'pieces': len(d['pieces']), 'placed': placed, 'tracks': len(d['chains']),
                 'missing_pieces': sorted(missing), 'track_files': ts['track_ovls']})
    lookup_ovl = {}

    def tex(n):
        return lib.texture_image(n, prefer=lookup_ovl.get(n))
    for m in merged.meshes:
        lookup_ovl.setdefault(m.texture, getattr(m, '_ovl', None))
    return shape_to_glb(merged, tex), info


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
