"""Orientation of morph-mesh triangles, independent of the stored normals.
- consistency: share of interior edges whose two triangles traverse them in opposite directions (1.0 = coherent)
- volume: signed volume of the triangle soup (positive = faces point outwards, for the closed-ish body parts)
- normals: share of faces whose (game-space, as-stored winding) normal agrees with the decoded vertex normals
usage: python tests/mms_orient.py "<game folder>" name:mms ...
"""
import sys
from collections import Counter

import numpy as np

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl.library import Library  # noqa: E402
from rct3ovl.morph import load_morph  # noqa: E402

lib = Library(sys.argv[1])
for n in sys.argv[2:]:
    h = lib.find(n.lower()); mm = load_morph(h[0], h[1])
    P = mm.anims[0].frames[0]; t = mm.remap[mm.indices.reshape(-1, 3)]     # triangles over position indices
    t = t[(t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])]
    edges = Counter()
    for a, b, c in t:
        for e in ((a, b), (b, c), (c, a)):
            edges[e] += 1
    shared = [(e, edges[e], edges[(e[1], e[0])]) for e in edges if (e[1], e[0]) in edges or edges[e] > 1]
    opp = sum(1 for e, f, r in shared if r > 0 and f == 1)
    same = sum(1 for e, f, r in shared if f > 1)
    vol = float(np.einsum('ij,ij->i', P[t[:, 0]], np.cross(P[t[:, 1]], P[t[:, 2]])).sum() / 6)
    fn = np.cross(P[t[:, 1]] - P[t[:, 0]], P[t[:, 2]] - P[t[:, 0]])
    N = mm.anims[0].normals[0] if mm.anims[0].normals is not None else None
    tri_n = mm.nremap[mm.indices.reshape(-1, 3)]
    nagree = float((np.einsum('ij,ij->i', fn, N[tri_n].mean(1)[:len(fn)]) > 0).mean()) if N is not None and len(N) else None
    print(f'{n:26} tris {len(t):4}  opposite-edge pairs {opp:4}  same-direction duplicates {same:3}  '
          f'volume {vol:+.5f}  normals agree {nagree}')
