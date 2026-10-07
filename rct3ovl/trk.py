"""Premade ride designs (.trk in 'Coaster Designs'): RCT3's self-describing save format.

Layout (worked out from the game's own designs):
  24-byte header, ... u32 type count, then the schema: per type {u16-len name, u32 field count, fields}, a field being
  {u16-len name, u16-len type name, u32 byte size, u32 child count, children}. Then u32 object count and the objects,
  each {u32 type index, u64 object id, the type's fields in schema order}.
Field encodings: int32/uint32/float32 4 B, bool/uint8 1 B, vector3 12 B, managedobjectptr/reference 8 B (an object
id; 0 = none), struct = its members, string = u32 byte count + that many bytes (0xEFEFEFEF + UTF-16LE),
array/list = u32 count + elements (each element = the child fields), graphedValue: see _read.
"""
from __future__ import annotations

import struct


class TrkError(Exception):
    pass


class _Field:
    __slots__ = ('name', 'type', 'size', 'children')

    def __init__(self, name, typ, size, children):
        self.name, self.type, self.size, self.children = name, typ, size, children


class Trk:
    def __init__(self, data: bytes):
        self.b = data
        self.types: list[tuple[str, list[_Field]]] = []
        self.objects: dict[int, tuple[str, dict]] = {}
        self.order: list[int] = []
        self._parse()

    # -- primitives --
    def _u16(self, p):
        return struct.unpack_from('<H', self.b, p)[0]

    def _u32(self, p):
        return struct.unpack_from('<I', self.b, p)[0]

    def _lstr(self, p):
        n = self._u16(p)
        return self.b[p + 2:p + 2 + n].decode('latin-1'), p + 2 + n

    def _field(self, p):
        name, p = self._lstr(p); typ, p = self._lstr(p)
        size, nch = struct.unpack_from('<II', self.b, p); p += 8
        ch = []
        for _ in range(nch):
            f, p = self._field(p); ch.append(f)
        return _Field(name, typ, size, ch), p

    def _parse(self):
        b = self.b
        p = 84
        ntypes = self._u32(p - 4)
        if not 0 < ntypes < 200:
            raise TrkError('not a design file')
        for _ in range(ntypes):
            name, p = self._lstr(p)
            nf = self._u32(p); p += 4
            fields = []
            for _ in range(nf):
                f, p = self._field(p); fields.append(f)
            self.types.append((name, fields))
        nobj = self._u32(p); p += 4
        for _ in range(nobj):
            if p + 12 > len(b):
                break
            t = self._u32(p); oid = struct.unpack_from('<Q', b, p + 4)[0]; p += 12
            if t >= len(self.types):
                raise TrkError(f'bad object type {t} at {p - 12}')
            name, fields = self.types[t]
            vals, p = self._read_fields(fields, p)
            self.objects[oid] = (name, vals)
            self.order.append(oid)
        self.end = p

    def _read_fields(self, fields, p):
        out = {}
        for f in fields:
            out[f.name], p = self._read(f, p)
        return out, p

    def _read(self, f: _Field, p):
        b, t = self.b, f.type
        if t in ('int32',):
            return struct.unpack_from('<i', b, p)[0], p + 4
        if t in ('uint32',):
            return self._u32(p), p + 4
        if t == 'float32':
            return struct.unpack_from('<f', b, p)[0], p + 4
        if t in ('bool', 'uint8'):
            return b[p], p + 1
        if t == 'vector3':
            return list(struct.unpack_from('<3f', b, p)), p + 12
        if t in ('managedobjectptr', 'reference'):
            return struct.unpack_from('<Q', b, p)[0], p + 8
        if t == 'string':
            n = self._u32(p)
            raw = b[p + 4:p + 4 + n]
            if raw[:4] == b'\xef\xef\xef\xef':
                s = raw[4:].decode('utf-16-le', 'replace').rstrip('\0')
            else:
                s = raw.decode('latin-1').rstrip('\0')
            return s, p + 4 + n
        if t in ('struct', 'struct4'):
            if f.size:                                    # fixed-size struct: members back to back
                return self._read_fields(f.children, p)
            nbytes = self._u32(p)                         # variable-size struct (holds arrays): u32 byte length first
            v, _ = self._read_fields(f.children, p + 4)
            return v, p + 4 + nbytes
        if t in ('array', 'list'):
            # u32 byte length of what follows, then u32 element count and the elements
            nbytes = self._u32(p); end = p + 4 + nbytes
            if end > len(b):
                raise TrkError(f'{f.name}: array runs past the end ({nbytes} B at {p})')
            n = self._u32(p + 4); q = p + 8
            if len(f.children) == 1 and f.children[0].type in ('uint8', 'bool'):
                return bytes(b[q:q + n]), end            # images etc.
            items = []
            for _ in range(n):
                if len(f.children) == 1:
                    v, q = self._read(f.children[0], q)
                else:
                    v, q = self._read_fields(f.children, q)
                items.append(v)
            return items, end
        if f.size and not f.children:                     # unknown fixed-size type: keep the raw bytes
            return bytes(b[p:p + f.size]), p + f.size
        if not f.size and not f.children:                 # variable-size leaf (graphedValue): u32 byte length + data
            n = self._u32(p)
            if p + 4 + n > len(b):
                raise TrkError(f'{f.name}: {n} B at {p} run past the end')
            return bytes(b[p + 4:p + 4 + n]), p + 4 + n
        raise TrkError(f'unknown field type {t!r} ({f.name}) at {p}')

    # -- convenience --
    def of_type(self, name: str):
        return [(oid, v) for oid, (n, v) in ((o, self.objects[o]) for o in self.order) if n == name]
