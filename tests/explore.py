"""Pointer-following structure explorer for reverse engineering.
Usage: explore.py <ovl> <tag> [index] [words] [depth]
Prints the struct's words; each pointer field is followed (depth levels) and shown as a string or its first words."""
import os, sys, struct
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from rct3ovl import Ovl

path, tag = sys.argv[1], sys.argv[2]
idx = int(sys.argv[3]) if len(sys.argv) > 3 else 0
nwords = int(sys.argv[4]) if len(sys.argv) > 4 else 16
depth = int(sys.argv[5]) if len(sys.argv) > 5 else 2
o = Ovl(path)
imports = {site: name for name, site in o.symbol_refs}
names = {}
for r in o.resources:
    names[r.data] = r.name or r.loader.tag
r = o.by_tag(tag)[idx]
print(f'{tag}[{idx}] {r.name} @0x{r.data:X} extra={[len(e) for e in r.extra]}')


def as_string(a):
    try:
        s = o.cstr(a, 80)
    except Exception:
        return None
    if len(s) >= 2 and all(32 <= ord(c) < 127 for c in s):
        return s
    try:
        b = o.read(a, 40)
        u = b.decode('utf-16le').split('\0')[0]
        if len(u) >= 2 and all(32 <= ord(c) < 127 for c in u):
            return 'U"' + u + '"'
    except Exception:
        pass
    return None


def show(a, n, d, ind):
    for i in range(n):
        p = a + 4 * i
        try:
            v = o.u32(p)
        except Exception:
            print(ind + '  <end of block>'); return
        f = struct.unpack('<f', struct.pack('<I', v))[0]
        tag_ = ''
        if p in imports:
            tag_ = 'IMP ' + imports[p]
        elif o.is_pointer(p):
            tag_ = '-> ' + (names.get(v, '') or '')
            s = as_string(v)
            if s:
                tag_ += f' "{s}"'
        fs = f'{f:11.4g}' if 1e-6 < abs(f) < 1e7 else ''
        print(f'{ind}+0x{4*i:02X} {v:08X} {v:10d} {fs:>11} {tag_}')
        if o.is_pointer(p) and d > 0 and v and not as_string(v) and v not in names:
            show(v, min(n, 10), d - 1, ind + '      ')


show(r.data, nwords, depth, '')
