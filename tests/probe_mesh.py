"""Dump the first sub-mesh record of a shs/bsh: words + pointer/import flags; then the first vertex."""
import os, sys, struct
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from rct3ovl import Ovl

path, tag = sys.argv[1], sys.argv[2]
o = Ovl(path); imports = {site: name for name, site in o.symbol_refs}
r = o.by_tag(tag)[0]
sh = o.ptr(r.data + 0x28)
m = o.ptr(sh)
print(f'v{o.version} {r.name} mesh rec 0x{m:X}')
for i in range(14):
    a = m + 4 * i
    v = o.u32(a); flag = 'PTR' if o.is_pointer(a) else ('IMP ' + imports[a] if a in imports else '')
    print(f'  +0x{4 * i:02X} {v:08X} {v:10d} {struct.unpack("<f", struct.pack("<I", v))[0]:12.4g} {flag}')
