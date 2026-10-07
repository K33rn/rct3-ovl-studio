"""Elephant mdl skeleton: are the stored position/quaternion local (parent-relative) or model space?
Compare with the inverse bind matrices (row-vector D3D convention: translation in the last row).
usage: python tests/mdl_bones.py "<game folder>"
"""
import struct
import sys

import numpy as np

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl.library import Library  # noqa: E402

np.set_printoptions(suppress=True, linewidth=200, precision=3)


def qmat(q):     # quaternion (x, y, z, w) -> 3x3, column-vector convention
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


lib = Library(sys.argv[1])
o, _ = lib.open(r'Cars\TrackedRideCars\Elephant\Elephant.common.ovl')
r = next(x for x in o.resources if x.loader.tag == 'mdl')
A, B = r.extra
names = [n.decode() for n in B.split(b'\0')]
nb = struct.unpack_from('<I', A, 0)[0]
P, Q, IB = [], [], []
for i in range(nb):
    rec = np.frombuffer(A, '<f4', 24, 16 + 96 * i).astype(np.float64)
    P.append(rec[0:3]); Q.append(rec[4:8]); IB.append(rec[8:24].reshape(4, 4))
par = [-1] * nb
p = 16 + 96 * nb
for i in range(nb):                      # entry i = (parent of bone i, i + 1 or 0xFFFF for the last)
    a, _nxt = struct.unpack_from('<HH', A, p)
    par[i] = -1 if a == 0xFFFF else a; p += 4
# model-space bind from the inverse bind matrix (row-vector: v_model = v_bone @ M)
M = [np.linalg.inv(ib) for ib in IB]
bad = 0
for i in range(nb):
    world_t = M[i][3, :3]
    # if P is local: world = parent world applied to P
    if par[i] >= 0:
        pw = M[par[i]]
        local_t = (np.append(P[i], 1) @ pw)[:3]
    else:
        local_t = P[i]
    # rotation too: local rotation (quaternion) composed with the parent's model rotation should give this bone's
    Rl = qmat(Q[i])
    Rw = M[i][:3, :3]                                   # row-vector model rotation
    Rp = M[par[i]][:3, :3] if par[i] >= 0 else np.eye(3)
    rot_err = min(np.abs(Rl.T @ Rp - Rw).max(), np.abs(Rl @ Rp - Rw).max())
    err = np.linalg.norm(local_t - world_t)
    bad += err > 1e-3 or rot_err > 1e-3
    if i < 30 or err > 1e-3:
        print(f'{i:2} {names[i][:24]:24} parent {names[par[i]][:16] if par[i] >= 0 else "-":16}  local pos err {err:.4f}  rot err {rot_err:.4f}')
print('bones not matching:', bad, 'of', nb)
