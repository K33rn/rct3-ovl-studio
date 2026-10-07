"""Write the biggest mms of each given OVL (frame 0 of a chosen animation) into one OBJ for a visual check."""
import os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from rct3ovl import Ovl
from rct3ovl.morph import load_morph

out, want = sys.argv[1], sys.argv[2]
with open(out, 'w') as f:
    base = 1
    for p in sys.argv[3:]:
        o = Ovl(p)
        refs = o.by_tag('mms')
        sizes = [(o.u32(r.data), r) for r in refs]
        r = max(sizes, key=lambda t: t[0])[1]
        m = load_morph(o, r)
        ai = next((i for i, a in enumerate(m.anims) if want.lower() in a.name.lower()), 0)
        P = m.positions(ai, 0)
        print(r.name, 'verts', len(P), 'tris', len(m.indices) // 3, 'anim', m.anims[ai].name, 'frames', len(m.anims[ai].times),
              'bbox', P.min(0).round(2), P.max(0).round(2), 'anims', len(m.anims))
        f.write(f'o {r.name.replace(":", "_")}\n')
        for v in P: f.write(f'v {v[0]} {v[1]} {-v[2]}\n')
        T = m.indices.reshape(-1, 3)
        for a, b, c in T: f.write(f'f {a + base} {c + base} {b + base}\n')
        base += len(P)
