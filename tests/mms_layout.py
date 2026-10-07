"""Find the bit layout of morph-mesh vertex positions by minimising triangle edge length."""
import os, sys, struct, itertools
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from rct3ovl import Ovl

o = Ovl(sys.argv[1]); r = o.by_tag('mms')[int(sys.argv[2]) if len(sys.argv) > 2 else 0]
vc, ic, u3, u4, u5, mc, uvp, ip, u9, mp = struct.unpack('<10I', o.read(r.data, 40))
print(r.name, 'verts', vc, 'indices', ic, 'u3/u4/u5', u3, u4, u5, 'morphs', mc)
idx = np.frombuffer(o.read(ip, 2 * ic), '<u2').astype(int)
m = struct.unpack('<3fI3fIIIIIIIII', o.read(mp, 64))
off, scale, tc, dp = np.array(m[0:3]), np.array(m[4:7]), m[9], m[11]
print('morph0', o.cstr(m[8]), 'times', tc, 'offset', off, 'scale', scale, 'tail', m[12:])
uv = [struct.unpack('<HHff', o.read(uvp + 12 * i, 12)) for i in range(vc)]
remap = np.array([u[0] for u in uv]); print('remap max', remap.max(), 'b field set', sorted({u[1] for u in uv})[:8])
npos = remap.max() + 1
raw = np.frombuffer(o.read(dp, 4 * npos), '<u4').astype(np.int64)
T = idx.reshape(-1, 3)
best = []
for bits in [(11, 10, 11), (11, 11, 10), (10, 11, 11), (10, 10, 12)]:
    for order in itertools.permutations(range(3)):
        sh = 0; q = [None] * 3
        for axis in order:
            q[axis] = (raw >> sh) & ((1 << bits[axis]) - 1); sh += bits[axis]
        P = (off + scale * np.stack(q, 1))[remap]
        e = np.linalg.norm(P[T[:, 0]] - P[T[:, 1]], axis=1).mean() + np.linalg.norm(P[T[:, 1]] - P[T[:, 2]], axis=1).mean()
        best.append((e, bits, order, P.min(0).round(3), P.max(0).round(3)))
for b in sorted(best, key=lambda t: t[0])[:5]:
    print(b)
