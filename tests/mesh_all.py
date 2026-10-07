"""Load every shs/bsh in the game; check counts vs header totals, bone indices in range, finite data."""
import os, sys, time
from collections import Counter
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from rct3ovl import Ovl, pair_paths
from rct3ovl.meshes import load_shape

root = sys.argv[1]
bases = sorted({pair_paths(os.path.join(dp, f))[0] for dp, _, fs in os.walk(root) for f in fs if f.lower().endswith('.ovl')})
ok, bad, fail = Counter(), Counter(), Counter(); ex = []; t0 = time.time(); notex = 0; tris = 0
for b in bases:
    o = Ovl(b)
    for r in o.resources:
        if r.loader.tag not in ('shs', 'bsh'):
            continue
        key = (r.loader.tag, o.version)
        try:
            s = load_shape(o, r)
        except Exception as e:
            fail[key] += 1; ex.append((repr(e)[:90], o.name, r.name)); continue
        probs = []
        for m in s.meshes:
            if not np.isfinite(m.positions).all(): probs.append('nan pos')
            if len(m.indices) % 3: probs.append('indices%3')
            if m.joints is not None and len(s.bones) and m.joints.max() >= len(s.bones): probs.append('joint>=bones')
            if not m.texture: notex += 1
            tris += len(m.indices) // 3
        if probs:
            bad[key] += 1; ex.append((probs[0], o.name, r.name))
        else:
            ok[key] += 1
print(f'{time.time() - t0:.1f}s ok {dict(ok)}\nsuspicious {dict(bad)}\nfailed {dict(fail)}\nsub-meshes without texture {notex}, total triangles {tris:,}')
for e in ex[:15]:
    print('  ', e)
