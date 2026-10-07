"""Do decoded morph-mesh normals point outwards? For each connected piece (a leg, an arm, a head) compare every
vertex normal with the direction from the piece's centre to the vertex. Outward-facing data gives a clearly positive
mean; inside-out data a clearly negative one.
usage: python tests/mms_outward.py "<game folder>" name:mms ...
"""
import sys

import numpy as np

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl.library import Library  # noqa: E402
from rct3ovl.morph import load_morph  # noqa: E402


def pieces(tris, n):
    parent = list(range(n))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for a, b, c in tris:
        for x, y in ((a, b), (b, c)):
            rx, ry = find(x), find(y)
            if rx != ry:
                parent[rx] = ry
    return np.array([find(i) for i in range(n)])


lib = Library(sys.argv[1])
for name in sys.argv[2:]:
    h = lib.find(name.lower()); mm = load_morph(h[0], h[1])
    P = mm.positions(0, 0); N = mm.normals(0, 0)
    t = mm.indices.reshape(-1, 3)
    # render vertices sharing a position belong together
    comp = pieces([(mm.remap[a], mm.remap[b], mm.remap[c]) for a, b, c in t], int(mm.remap.max()) + 1)[mm.remap]
    dots = []
    for c in np.unique(comp):
        m = comp == c
        if m.sum() < 4:
            continue
        d = P[m] - P[m].mean(0)
        d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
        dots.append(float(np.einsum('ij,ij->i', d, N[m]).mean()))
    # stored winding: face normal (right-handed cross product) vs vertex normals
    fn = np.cross(P[t[:, 1]] - P[t[:, 0]], P[t[:, 2]] - P[t[:, 0]])
    w = float((np.einsum('ij,ij->i', fn, N[t].mean(1)) > 0).mean())
    print(f'{name:28} pieces {len(dots):2}  normals-vs-outward mean {np.mean(dots):+.2f} '
          f'(per piece {", ".join(f"{x:+.2f}" for x in dots[:8])})  stored winding agrees with normals {w:.2f}')
