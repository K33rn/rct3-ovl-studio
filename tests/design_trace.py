"""Trace how a design's pieces get placed: chosen rotation vs stored DIRECTION, placed tile vs stored tile.
usage: python tests/design_trace.py "<game folder>" "<design name>"
"""
import sys

import numpy as np

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
import rct3ovl.designs as D  # noqa: E402
from rct3ovl.library import Library  # noqa: E402

lib = Library(sys.argv[1])
f = next(x for x in D.design_files(lib) if x['name'] == sys.argv[2])
log = []
orig = D._append


def app(dst, src, R, T):
    log.append((R.copy(), T.copy()))
    return orig(dst, src, R, T)


D._append = app
glb, info = D.build_design(lib, f['file'])
d = D.load_design(f['file'])
pcs = [v for c, _ in d['chains'] for v in c]
print(info['closure_gap'], 'm gap;', len(d['chains']), 'chain(s)')
for i, (v, (R, T)) in enumerate(zip(pcs, log)):
    gd = v['SceneryItemDataField']
    k = [k for k in range(4) if np.allclose(D._roty(k), R)][0]
    print(f"{i:2} {v['SYMBOLNAME']:26} grid ({gd['POSX']},{gd['POSZ']}) h{gd['HEIGHT']:3} dir{gd['DIRECTION']} "
          f"| rot {k} (grid {(gd['DIRECTION'] + 2) % 4}) placed tile {np.round(T[[0, 2]] / 4, 2)} y {T[1]:.1f}")
