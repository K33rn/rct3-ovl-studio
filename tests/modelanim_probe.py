"""Probe Wild! 'modelanim' records (the elephant's animations).
usage: python tests/modelanim_probe.py "<game folder>" [anim name]
"""
import struct
import sys

import numpy as np

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl.library import Library  # noqa: E402

np.set_printoptions(suppress=True, linewidth=220, precision=4)
lib = Library(sys.argv[1])
o, _ = lib.open(r'Cars\TrackedRideCars\Elephant\elephant_anims.common.ovl')
want = sys.argv[2] if len(sys.argv) > 2 else 'ElephantTransportWalk:modelanim'
imp = {s: n for n, s in o.symbol_refs}
for r in o.resources:
    blk, _ = o.block_bytes(r.data)
    print(f'{r.loader.tag:10} {r.name:36} data@0x{r.data:X} block bytes left {len(blk)} extra {[len(e) for e in r.extra]}')
r = next(x for x in o.resources if x.name == want)
print('\n== record', r.name)
ptrs = []
for i in range(0, 0x60, 4):
    a = r.data + i; v = o.u32(a); f = struct.unpack('<f', struct.pack('<I', v))[0]
    isp = o.is_pointer(a)
    if isp:
        ptrs.append((i, v))
    print(f'+0x{i:02X} {v:08X} {v:11d} {f:12.5g}', 'PTR' if isp else '', imp.get(a, ''))
for off, target in ptrs:
    print(f'\n-> +0x{off:02X} points at 0x{target:X}:')
    raw = o.read(target, 128)
    print('   u32', np.frombuffer(raw, '<u4')[:16]); print('   f32', np.frombuffer(raw, '<f4')[:32])
    print('   u16', np.frombuffer(raw, '<u2')[:32])
ex = r.extra[0] if r.extra else b''
print('\nextra', len(ex)); print('  u32', np.frombuffer(ex[:len(ex) // 4 * 4], '<u4')[:48]); print('  u16', np.frombuffer(ex[:len(ex) // 2 * 2], '<u2')[:64])
