"""Find the smallest OVL pairs containing all given tags. Usage: find.py <root> tag [tag...]"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from rct3ovl import Ovl, pair_paths

root, tags = sys.argv[1], set(sys.argv[2:])
hits = []
for dp, _, fs in os.walk(root):
    for f in fs:
        if f.lower().endswith('.common.ovl'):
            p = os.path.join(dp, f)
            try:
                o = Ovl(p)
            except Exception:
                continue
            if tags <= {r.loader.tag for r in o.resources}:
                hits.append((os.path.getsize(p), o.version, p))
for s, v, p in sorted(hits)[:6]:
    print(f'{s:9d} v{v} {p}')
