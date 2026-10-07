"""Open every OVL pair under a folder; report failures and resource tag counts."""
import os, sys, time, traceback
from collections import Counter
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from rct3ovl import Ovl, pair_paths

root = sys.argv[1]
bases = set()
for dp, _, fs in os.walk(root):
    for f in fs:
        if f.lower().endswith('.ovl'):
            bases.add(pair_paths(os.path.join(dp, f))[0])
t0 = time.time(); ok = 0; fails = []; tags = Counter(); vers = Counter(); unnamed = 0; extra_missing = 0
for b in sorted(bases):
    try:
        o = Ovl(b); ok += 1; vers[o.version] += 1
        for r in o.resources:
            tags[r.loader.tag] += 1
            if not r.symbol: unnamed += 1
        for f in o.files:                       # did we consume exactly the file? (extra data ends at EOF)
            pass
    except Exception as e:
        fails.append((b, repr(e)))
print(f'pairs {len(bases)}  ok {ok}  failed {len(fails)}  in {time.time() - t0:.1f}s  versions {dict(vers)}')
print('unnamed loader refs', unnamed)
for b, e in fails[:15]:
    print('FAIL', os.path.relpath(b, root), e)
print('tags:', ', '.join(f'{t}:{n}' for t, n in tags.most_common()))
