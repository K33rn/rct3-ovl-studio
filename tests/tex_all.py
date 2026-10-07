"""Decode every tex/ftx in the game (no saving) and report failures by OVL version."""
import os, sys, time
from collections import Counter
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from rct3ovl import Ovl, pair_paths
from rct3ovl.textures import TextureSet

root = sys.argv[1]
bases = sorted({pair_paths(os.path.join(dp, f))[0] for dp, _, fs in os.walk(root) for f in fs if f.lower().endswith('.ovl')})
ok, none, fail, fmts = Counter(), Counter(), Counter(), Counter()
examples = []
t0 = time.time()
for b in bases:
    o = Ovl(b); ts = TextureSet(o)
    for r in o.resources:
        if r.loader.tag not in ('tex', 'ftx'):
            continue
        key = (r.loader.tag, o.version)
        try:
            img = ts.image(r)
            if img is None:
                none[key] += 1; examples.append(('none', o.name, r.name))
            else:
                ok[key] += 1
                if r.loader.tag == 'tex':
                    fmts[ts.tex_bitmap(r).format_name] += 1
        except Exception as e:
            fail[key] += 1; examples.append((repr(e)[:80], o.name, r.name))
print(f'{time.time() - t0:.1f}s  ok {dict(ok)}')
print('no image', dict(none)); print('failed', dict(fail)); print('formats', dict(fmts))
for e in examples[:12]:
    print('  ', e)
