"""Which way do a guest's body and detailed head face? (game space, degrees in the x-z plane, 0 = +x, 90 = +z)
Body: toes point forward from the ankles (legs part). Head: the ponytail hangs behind the head.
usage: python tests/facing.py "<game folder>" af01 [anim]
"""
import math
import sys

import numpy as np

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl.characters import assemble, variants  # noqa: E402
from rct3ovl.library import Library  # noqa: E402


def ang(v):
    return round(math.degrees(math.atan2(v[2], v[0])), 1)


lib = Library(sys.argv[1]); v = sys.argv[2]; anim = sys.argv[3] if len(sys.argv) > 3 else 'Idle1'
vs = variants(lib)
groups = [g for g in vs[v] if any(g.endswith(f'_{p}:ppg') for p in ('body', 'legs', 'head'))]
m, s, _ = assemble(lib, groups, 0, [anim])
legs = next(mm for mm, _ in m if mm.name.lower().startswith('legs_'))
a = next(i for i, x in enumerate(legs.anims) if x.name == anim)
P = legs.anims[a].frames[0]; y = P[:, 1]
toes = P[y < y.min() + 0.06].mean(0); ankle = P[(y > y.min() + 0.10) & (y < y.min() + 0.25)].mean(0)
print('body forward (toes - ankles)  ', ang(toes - ankle))
sk, clips, _ = s[0]
c = clips.get(anim) or next(iter(clips.values()))
W = []
for i in range(len(sk.bones)):
    L = np.eye(4); L[:3, :3] = c.rotations[0, i]; L[3, :3] = c.positions[0, i]
    W.append(L if sk.parents[i] < 0 else L @ W[sk.parents[i]])
names = [b.lower() for b in sk.bones]
hi = next(i for i, b in enumerate(names) if b.endswith('head'))
pi = next((i for i, b in enumerate(names) if 'ponytail' in b), None)
if pi is not None:
    print('head forward (head - ponytail)', ang(W[hi][3, :3] - W[pi][3, :3]))
# also: head-local axes in world (which local axis is "forward")
for k, lab in enumerate('xyz'):
    print(f'head local {lab} axis -> world', np.round(W[hi][k, :3], 2), 'angle', ang(W[hi][k, :3]))
# skin vertices: nose = head vertex furthest in front, measured relative to the ponytail direction
hv = sk.positions[sk.vertex_bone == hi] @ W[hi][:3, :3] + W[hi][3, :3]
print('head vertices centre', np.round(hv.mean(0), 2), ' body toes', np.round(toes, 2))
