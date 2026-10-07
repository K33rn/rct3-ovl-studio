"""Probe the Wild! 'mdl' model blob (extra data 0): bones, parent table, names, mesh headers, then per mesh a vertex
buffer (44 B: pos, normal, 4 bone bytes, 4 weight bytes, colour, uv) and u16 indices.
usage: python tests/mdl_probe.py "<game folder>"
"""
import struct
import sys

import numpy as np

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl.library import Library  # noqa: E402

lib = Library(sys.argv[1])
o, _ = lib.open(r'Cars\TrackedRideCars\Elephant\Elephant.common.ovl')
r = next(x for x in o.resources if x.loader.tag == 'mdl')
A, B = r.extra
bbmin = np.array(struct.unpack('<3f', o.read(r.data + 0x18, 12))); bbmax = np.array(struct.unpack('<3f', o.read(r.data + 0x24, 12)))
print('bbox', bbmin.round(2), bbmax.round(2))
nb = struct.unpack_from('<I', A, 0)[0]
p = 16 + 96 * nb
# parent table: u16 (parent, child) pairs until the child index sequence ends
pairs = []
while True:
    par, ch = struct.unpack_from('<HH', A, p)
    if ch != len(pairs) + 1:
        break
    pairs.append(par); p += 4
print('bones', nb, 'parent entries', len(pairs), 'ends at', p)
# find the mesh headers: records starting with 0x1305
hdrs = []
q = p
while q < 8000:
    if struct.unpack_from('<I', A, q)[0] == 4869:
        hdrs.append(q)
    q += 4
print('mesh header offsets', hdrs)
secs = []
for h in hdrs:
    fmt, n1, a, b = struct.unpack_from('<IIHH', A, h)
    secs.append((n1, b)); print('  header', fmt, 'n1', n1, 'a', a, 'b', b)
vstart = hdrs[-1] + 32
VT = np.dtype([('p', '<f4', 3), ('n', '<f4', 3), ('bi', 'u1', 4), ('bw', 'u1', 4), ('c', '<u4'), ('uv', '<f4', 2)])
pos = vstart
for k, (nidx, nvert) in enumerate(secs):
    v = np.frombuffer(A, VT, nvert, pos); pos += VT.itemsize * nvert
    idx = np.frombuffer(A, '<u2', nidx, pos); pos += 2 * nidx
    inside = float(((v['p'] >= bbmin - 0.05) & (v['p'] <= bbmax + 0.05)).all(1).mean())
    nl = np.linalg.norm(v['n'], axis=1)
    print(f'mesh {k}: verts {nvert} idx {nidx} -> inside bbox {inside:.2f}, |n|~1 {float((abs(nl-1)<0.02).mean()):.2f}, '
          f'weights sum255 {float((v["bw"].astype(int).sum(1)==255).mean()):.2f}, idx max {idx.max()} (<{nvert}: {idx.max() < nvert}), '
          f'uv range {v["uv"].min(0).round(2)}..{v["uv"].max(0).round(2)}, ends at {pos}')
print('blob size', len(A), 'leftover', len(A) - pos)
print('next bytes', A[pos:pos + 48].hex(' '))
