"""Dump the type schema at the start of a .trk design (RCT3's self-describing save format).
Field = u16-len name, u16-len type, u32 byte size, u32 child count, children (recursive).
usage: python tests/trk_schema.py file.trk
"""
import struct
import sys

b = open(sys.argv[1], 'rb').read()


def lstr(p):
    n = struct.unpack_from('<H', b, p)[0]
    return b[p + 2:p + 2 + n].decode('latin-1'), p + 2 + n


def field(p, depth):
    name, p = lstr(p); typ, p = lstr(p)
    size, nchild = struct.unpack_from('<II', b, p); p += 8
    print('  ' * depth + f'{name}: {typ} (size {size}, children {nchild})')
    for _ in range(nchild):
        p = field(p, depth + 1)
    return p


print('header', b[:24].hex(' '))
p = 24
# probe: find the first type definition by its name length prefix
print('u32s after header', struct.unpack_from('<10I', b, 24))
p = int(sys.argv[2]) if len(sys.argv) > 2 else 0x54
ntypes = struct.unpack_from('<I', b, p - 4)[0]
print('types', ntypes, 'at', p)
for t in range(ntypes):
    name, p = lstr(p)
    nf = struct.unpack_from('<I', b, p)[0]; p += 4
    print(f'== type {t}: {name} ({nf} fields) @{p}')
    for _ in range(nf):
        p = field(p, 1)
print('schema ends at', p, 'of', len(b)); print('next bytes', b[p:p + 96].hex(' '))
