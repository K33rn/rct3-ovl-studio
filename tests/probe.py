"""Dump the raw structure of the first resource with a given tag: words, pointer flags, symbol imports."""
import os, sys, struct
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from rct3ovl import Ovl

path, tag = sys.argv[1], sys.argv[2]
n = int(sys.argv[3]) if len(sys.argv) > 3 else 24
which = int(sys.argv[4]) if len(sys.argv) > 4 else 0
o = Ovl(path)
imports = {site: name for name, site in o.symbol_refs}
refs = o.by_tag(tag)
print(o.summary())
r = refs[which]
print(f'{tag} #{which}: {r.name!r} at 0x{r.data:X} part={r.part} extra={[len(e) for e in r.extra]}')
for i in range(n):
    a = r.data + 4 * i
    try:
        v = o.u32(a)
    except Exception as e:
        print('  end:', e); break
    f = struct.unpack('<f', struct.pack('<I', v))[0]
    flag = 'PTR' if o.is_pointer(a) else ('IMP ' + imports[a] if a in imports else '')
    print(f'  +0x{4 * i:02X}  {v:08X}  {v:11d}  {f:12.4g}  {flag}')
