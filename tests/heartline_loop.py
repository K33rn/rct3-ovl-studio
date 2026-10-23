"""The Heartline Coaster's vertical loop (trackloop.py), on a scratch copy of the files it reads and changes: built and
installed, read back (sections, scenery items, splines, models, the ride's section and price lists), the rails meet
Heartline's medium-slope joints, removed again byte-identical. Also the OVL writer: game pairs written back unchanged.
usage: heartline_loop.py <game folder> <scratch folder>"""
import hashlib
import os
import random
import shutil
import struct
import sys
import tempfile
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np

from rct3ovl import trackloop as tl, texedit as tx, rides
from rct3ovl.container import Ovl, pair_paths
from rct3ovl.library import Library, find_pairs
from rct3ovl.meshes import load_shape
from rct3ovl.ovlwrite import Model
from rct3ovl.structs import load_spline, load_sid

game, scratch = sys.argv[1], sys.argv[2]
problems = []
shutil.rmtree(scratch, ignore_errors=True)
# the game's own files: where the loop is already in the game, its changed pairs come from the editor's backups
bdir = tx._backup_dir(types.SimpleNamespace(root=os.path.abspath(game), cache_dir=os.path.join(os.path.expanduser('~'), '.rct3ovl')))
for p in [f'{tl.T7}/Track7', f'{tl.T7}/Straight_data', f'{tl.T7}/Medslope_data', f'{tl.T11}/Track11', tl.HEARTLINE]:
    for q in pair_paths(os.path.join(game, *p.split('/'))):
        d = os.path.join(scratch, os.path.relpath(q, game))
        b = os.path.join(bdir, os.path.relpath(q, game))
        q = b if p in tl.CHANGED and os.path.exists(b) else q
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copy2(q, d)
md5 = lambda: {os.path.relpath(f, scratch): hashlib.md5(open(f, 'rb').read()).hexdigest() for f in
               (os.path.join(dp, x) for dp, _, fs in os.walk(scratch) for x in fs)}
before = md5()
lib = Library(scratch, cache_dir=tempfile.mkdtemp())

info = tl.install(lib)
print('installed:', info)
for new, g in info.items():
    if max(g['joint_error_m']) > 0.03:
        problems.append(f'{new}: joints {g["joint_error_m"]} m from the Looping Coaster loop path')
o7 = Ovl(os.path.join(scratch, *tl.T7.split('/'), 'Track7'))
names = {r.name for r in o7.resources}
imports = {n for n, _ in o7.symbol_refs}
for new in tl.PIECES:
    for want in (f'{new}:tks', f'{new}:sid', f'{new}L_spline:spl', f'{new}R_spline:spl'):
        if want not in names:
            problems.append(f'{want} missing from Track7')
    for want in (f'{new}:svd', f'SceneryItem_{new}:txt'):
        if want not in imports:
            problems.append(f'Track7 does not import {want}')
    tks = next(r for r in o7.by_tag('tks') if r.name == f'{new}:tks')
    v = struct.unpack('<6I', o7.read(tks.data + 8, 24))
    if v[:4] != (7, 7, 12, 1 if new == 'Loopleft' else 2) or o7.u32(tks.data + 0x48) != 1 or o7.u32(tks.data + 0x64) != 2:
        problems.append(f'{new}: section values {v}')
    if o7.str_field(tks.data) != new:
        problems.append(f'{new}: internal name {o7.str_field(tks.data)!r} (must match the model OVL, or the game crashes)')
    sid = load_sid(o7, next(r for r in o7.by_tag('sid') if r.name == f'{new}:sid'))
    if sid['squares'] != [4, 2] or sid['visuals'] != [f'{new}:svd'] or sid['supports'] != 'ts5':
        problems.append(f'{new}: scenery item {sid}')
    # rails start and end on Heartline's medium-slope joints (Track7 Medslope rails, the second one mirrored)
    ms = {s: load_spline(o7, next(r for r in o7.by_tag('spl') if r.name == f'Medslope{s}_spline:spl'))['nodes'][0]['pos'] for s in 'LR'}
    for s in 'LR':
        sp = load_spline(o7, next(r for r in o7.by_tag('spl') if r.name == f'{new}{s}_spline:spl'))
        a, b = np.array(sp['nodes'][0]['pos']), np.array(sp['nodes'][-1]['pos'])
        if abs(a[0] - 2 - ms[s][0]) > 0.03 or abs(a[1] - ms[s][1]) > 0.03 or abs(b[1] - a[1]) > 0.03:
            problems.append(f'{new}{s}: rail ends {a.round(3)} {b.round(3)}, Heartline medium slope starts at {ms[s]}')
    d = Ovl(os.path.join(scratch, *tl.T7.split('/'), f'{new}_data'))
    for r in d.by_tag('shs'):
        s = load_shape(d, r)
        lo, hi = np.array(s.bbox[0]), np.array(s.bbox[1])
        if len(s.meshes) < 1 or not (17 < hi[1] < 21) or len(s.meshes[0].positions) < 1000:
            problems.append(f'{r.name}: bbox {lo.round(2)} {hi.round(2)}, {len(s.meshes[0].positions)} vertices')
        print(r.name, lo.round(2), hi.round(2), len(s.meshes[0].positions), 'vertices')
h = Ovl(os.path.join(scratch, *tl.HEARTLINE.split('/')))
trr = next(r for r in h.by_tag('trr'))
imp = {s: n for n, s in h.symbol_refs}
n, arr = struct.unpack('<II', h.read(trr.data + 0x50, 8))
pn, parr = struct.unpack('<II', h.read(trr.data + 0x150, 8))
secs = [imp.get(arr + 4 * k) for k in range(n)]
prices = [(h.str_field(parr + 8 * k), h.u32(parr + 8 * k + 4)) for k in range(pn)]
print('sections', n, secs[-2:], 'prices', prices[-2:])
if secs[-2:] != ['Loopleft:tks', 'Loopright:tks'] or prices[-2:] != [('loopleft', tl.COST), ('loopright', tl.COST)] or n != pn:
    problems.append('Heartline does not list the loops')
t = next(t for t in rides.track_sets(lib) if t['ride'] == 'heartline:trr')
if t['missing'] or len(t['pieces']) != 21:
    problems.append(f'track set: {len(t["pieces"])} pieces, missing {t["missing"]}')
lib.refresh_index()
if not tl.status(lib)['installed']:
    problems.append('status() does not see it installed')
# again: built from the originals, not stacked
tl.install(lib)
h = Ovl(os.path.join(scratch, *tl.HEARTLINE.split('/')))
if struct.unpack('<I', h.read(next(r for r in h.by_tag('trr')).data + 0x50, 4))[0] != 21:
    problems.append('installing twice stacked the loops')
tl.uninstall(lib)
after = md5()
changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
print('after removing, differences:', changed)
if changed:
    problems.append(f'not back to the originals: {changed}')

# the writer: game pairs (version 1) written back byte for byte
pairs = [p for p in find_pairs(game) if open(p, 'rb').read(12)[8:12] == b'\x01\0\0\0']
random.seed(7)
out = os.path.join(scratch, 'rt', 'x')
bad = 0
for p in random.sample(pairs, min(150, len(pairs))):
    Model.read(p).write(out)
    if any(open(a, 'rb').read() != open(b, 'rb').read() for a, b in zip(pair_paths(p), pair_paths(out)) if os.path.exists(a)):
        bad += 1; problems.append(f'writer changed {os.path.relpath(p, game)}')
print('writer round trip:', min(150, len(pairs)) - bad, 'of', min(150, len(pairs)), 'identical')
print('PROBLEMS:', problems or 'none')
