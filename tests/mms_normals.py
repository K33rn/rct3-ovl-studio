"""Which byte decoding of morph-mesh normals matches the outward face normals?
Outward = reversed stored winding (the signed volume of the stored winding is negative).
usage: python tests/mms_normals.py "<game folder>" name:mms ...
"""
import itertools
import struct
import sys

import numpy as np

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl.library import Library  # noqa: E402
from rct3ovl.morph import _unpack  # noqa: E402

lib = Library(sys.argv[1])
for n in sys.argv[2:]:
    o, r = lib.find(n.lower())[:2]
    vc, ic, npos, nnrm, _u5, mc, uvp, ip, _u9, mp = struct.unpack('<10I', o.read(r.data, 40))
    uv = np.frombuffer(o.read(uvp, 12 * vc), np.dtype([('pi', '<u2'), ('aux', '<u2'), ('uv', '<f4', 2)]))
    nnrm = max(nnrm, int(uv['aux'].max()) + 1)
    idx = np.frombuffer(o.read(ip, 2 * ic), '<u2').astype(int).reshape(-1, 3)
    fsize = (4 * npos + 3 * nnrm + 3) // 4 * 4
    m = struct.unpack('<3fI3fIIIIIIIII', o.read(mp, 64)); off, sc, dp = np.array(m[0:3]), np.array(m[4:7]), m[11]
    blob = np.frombuffer(o.read(dp, fsize), np.uint8)
    raw = blob[:4 * npos].copy().view('<u4').astype(np.int64)
    P = _unpack(raw, off, sc)[uv['pi']]
    fn = -np.cross(P[idx[:, 1]] - P[idx[:, 0]], P[idx[:, 2]] - P[idx[:, 0]])      # outward
    fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-9)
    nb = blob[4 * npos:4 * npos + 3 * nnrm].reshape(nnrm, 3)
    cands = {'unsigned (b-127.5)/127.5': (nb.astype(float) - 127.5) / 127.5,
             'signed int8 /127': nb.view(np.int8).astype(float) / 127}
    res = []
    for label, N in cands.items():
        for perm in itertools.permutations(range(3)):
            for sign in itertools.product((1, -1), repeat=3):
                M = N[:, perm] * sign
                M = M / np.maximum(np.linalg.norm(M, axis=1, keepdims=True), 1e-9)
                vn = M[uv['aux']][idx].mean(1)
                res.append((float(np.einsum('ij,ij->i', fn, vn).mean()), label, perm, sign))
    res.sort(reverse=True)
    print(n, 'normal count', nnrm)
    for x in res[:4]:
        print(f'   mean cos {x[0]:+.3f}  {x[1]:26} axes {x[2]} signs {x[3]}')
    ident = [x for x in res if x[1].startswith('unsigned') and x[2] == (0, 1, 2) and x[3] == (1, 1, 1)][0]
    print(f'   current decoding: mean cos {ident[0]:+.3f}')
