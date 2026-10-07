"""Which bit split of the packed morph positions gives the smoothest motion between frames? A wrong split leaks low
bits of one axis into the high bits of the next, so vertices jump. Prints the best split per animation.
usage: python tests/mms_bits.py "<game folder>" name:mms ... [--anims 4]
"""
import struct
import sys

import numpy as np

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl.library import Library  # noqa: E402

SPLITS = [(11, 10, 11), (10, 11, 11), (11, 11, 10)]
args = [a for a in sys.argv[2:] if not a.startswith('--')]
maxa = int(sys.argv[sys.argv.index('--anims') + 1]) if '--anims' in sys.argv else 4
if '--anims' in sys.argv:
    args.remove(str(maxa))
lib = Library(sys.argv[1])
for n in args:
    o, r = lib.find(n.lower())[:2]
    vc, ic, npos, nnrm, _u5, mc, uvp, ip, _u9, mp = struct.unpack('<10I', o.read(r.data, 40))
    uv = np.frombuffer(o.read(uvp, 12 * vc), np.dtype([('pi', '<u2'), ('aux', '<u2'), ('uv', '<f4', 2)]))
    nnrm = max(nnrm, int(uv['aux'].max()) + 1)
    fsize = (4 * npos + 3 * nnrm + 3) // 4 * 4
    print(f'{n}: positions {npos}, normals {nnrm}, header {struct.unpack("<10I", o.read(r.data, 40))[:6]}')
    for a in range(min(mc, maxa)):
        m = struct.unpack('<3fI3fIIIIIIIII', o.read(mp + 64 * a, 64))
        sc, tc, dp = np.array(m[4:7]), m[9], m[11]
        blob = np.frombuffer(o.read(dp, fsize * max(tc, 1)), np.uint8).reshape(-1, fsize)
        raw = blob[:, :4 * npos].copy().view('<u4').astype(np.int64)
        res = []
        for bits in SPLITS:
            sh = [0, bits[0], bits[0] + bits[1]]
            q = np.stack([(raw >> sh[i]) & ((1 << bits[i]) - 1) for i in range(3)], -1) / np.array([(1 << b) - 1 for b in bits])
            res.append((round(float(np.abs(np.diff(q, axis=0)).mean()), 4) if len(q) > 1 else 0, bits))
        res.sort()
        print(f'   {o.str_field(mp + 64 * a + 32):18} frames {tc:3}  range {np.round(sc * [2047, 1023, 2047], 3)}  best {res[0][1]} {res}')
