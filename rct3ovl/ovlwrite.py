"""Writing OVL pairs (version 1, the format of the base game's files).

An OVL is read into a relocatable model: every data block becomes a bytearray, and every pointer (each site the
relocation table lists) becomes a link from (block, offset) to (block, offset). Blocks can then grow, new blocks can
be added and pointers re-aimed; writing lays the blocks out again and fills in every pointer from its link. The
symbol table (chunk 2 block 0: 12 B {name*, data*, is pointer}, sorted by name, case-blind), the loader table
(chunk 2 block 1: 20 B {loader type, data*, extra count, symbol*, symbol reference count}) and the symbol references
(chunk 2 block 2 when there are any: 12 B {pointer site*, name*, loader*}, grouped by loader in table order) are
blocks like any other, edited through the helpers below. Layout as the RCT3 Importer's libOVLng writes it.
"""
from __future__ import annotations

import os
import struct

from .container import pair_paths

PARTS = ('common', 'unique')


class Blk:
    __slots__ = ('part', 'chunk', 'data', 'vaddr')

    def __init__(self, part: str, chunk: int, data: bytes = b''):
        self.part, self.chunk, self.data, self.vaddr = part, chunk, bytearray(data), 0


class Rel:
    """A pointer: the u32 at (blk, off) holds the address of (tblk, toff) - or the fixed value raw."""
    __slots__ = ('blk', 'off', 'tblk', 'toff', 'raw')

    def __init__(self, blk, off, tblk=None, toff=0, raw=None):
        self.blk, self.off, self.tblk, self.toff, self.raw = blk, off, tblk, toff, raw


class Part:
    def __init__(self, name: str):
        self.name = name
        self.headerversion = 0
        self.references: list[str] = []
        self.unknown = 0
        self.loaders: list[tuple[str, str, int, str]] = []    # (loader, name, type, tag)
        self.chunks: list[list[Blk]] = [[] for _ in range(9)]
        self.rels: list[Rel] = []
        self.tail = b''                                       # loader extra data after the relocations


class Model:
    def __init__(self):
        self.parts = {p: Part(p) for p in PARTS}

    # ---- reading ---------------------------------------------------------------------------------------------
    @classmethod
    def read(cls, path: str) -> 'Model':
        m = cls()
        raw = {}
        vbase = 0
        for part, p in zip(PARTS, pair_paths(path)):
            d = open(p, 'rb').read()
            P = m.parts[part]
            pos = 0

            def u32():
                nonlocal pos
                v = struct.unpack_from('<I', d, pos)[0]; pos += 4; return v

            def lstr():
                nonlocal pos
                n = struct.unpack_from('<H', d, pos)[0]; s = d[pos + 2:pos + 2 + n].decode('latin-1'); pos += 2 + n
                return s
            if d[:4] != b'FGRK':
                raise ValueError(f'{p}: not an OVL')
            pos = 4
            P.headerversion = u32()
            if u32() != 1:
                raise ValueError(f'{p}: only version 1 OVLs can be written')
            P.references = [lstr() for _ in range(u32())]
            P.unknown = u32()
            for _ in range(u32()):
                a, b = lstr(), lstr(); t = u32(); P.loaders.append((a, b, t, lstr()))
            counts = [u32() for _ in range(9)]
            for ci in range(9):
                for _ in range(counts[ci]):
                    n = u32()
                    b = Blk(part, ci, d[pos:pos + n]); b.vaddr = vbase; vbase += n; pos += n
                    P.chunks[ci].append(b)
            relocs = [u32() for _ in range(u32())]
            P.tail = d[pos:]
            raw[part] = relocs
        blocks = m.blocks()
        starts = sorted(((b.vaddr, i) for i, b in enumerate(blocks) if b.data), key=lambda t: t[0])
        import bisect
        keys = [s for s, _ in starts]

        def find(v, inside=True):
            i = bisect.bisect_right(keys, v) - 1
            if i >= 0:
                b = blocks[starts[i][1]]
                if v < b.vaddr + len(b.data):
                    return b, v - b.vaddr
            for b in blocks:                                  # a pointer just past a block's end
                if b.data and b.vaddr + len(b.data) == v:
                    return b, len(b.data)
            return None, 0
        for part in PARTS:
            P = m.parts[part]
            for site in raw[part]:
                sb, so = find(site)
                if sb is None:
                    raise ValueError(f'relocation site 0x{site:X} outside the data')
                v = struct.unpack_from('<I', sb.data, so)[0]
                tb, to = find(v)
                P.rels.append(Rel(sb, so, tb, to) if tb is not None else Rel(sb, so, raw=v))
        return m

    # ---- layout ----------------------------------------------------------------------------------------------
    def blocks(self) -> list[Blk]:
        return [b for p in PARTS for c in self.parts[p].chunks for b in c]

    def layout(self):
        v = 0
        for b in self.blocks():
            b.vaddr = v; v += len(b.data)

    def addr(self, blk: Blk, off: int) -> int:
        return blk.vaddr + off

    def write(self, path: str):
        self.layout()
        for p in PARTS:
            for r in self.parts[p].rels:
                struct.pack_into('<I', r.blk.data, r.off, r.raw if r.tblk is None else r.tblk.vaddr + r.toff)
        for part, fp in zip(PARTS, pair_paths(path)):
            P = self.parts[part]
            out = [b'FGRK', struct.pack('<III', P.headerversion, 1, len(P.references))]
            for s in P.references:
                e = s.encode('latin-1'); out.append(struct.pack('<H', len(e)) + e)
            out.append(struct.pack('<II', P.unknown, len(P.loaders)))
            for a, b, t, tag in P.loaders:
                for s in (a, b):
                    e = s.encode('latin-1'); out.append(struct.pack('<H', len(e)) + e)
                e = tag.encode('latin-1'); out.append(struct.pack('<I', t) + struct.pack('<H', len(e)) + e)
            out.append(struct.pack('<9I', *[len(c) for c in P.chunks]))
            for c in P.chunks:
                for b in c:
                    out.append(struct.pack('<I', len(b.data)) + bytes(b.data))
            out.append(struct.pack('<I', len(P.rels)))
            out.append(struct.pack(f'<{len(P.rels)}I', *[r.blk.vaddr + r.off for r in P.rels]))
            out.append(P.tail)
            os.makedirs(os.path.dirname(os.path.abspath(fp)), exist_ok=True)
            with open(fp, 'wb') as f:
                f.write(b''.join(out))

    # ---- editing: bytes and pointers ---------------------------------------------------------------------------
    def rels(self):
        return [r for p in PARTS for r in self.parts[p].rels]

    def rel_at(self, blk: Blk, off: int) -> Rel | None:
        return next((r for r in self.parts[blk.part].rels if r.blk is blk and r.off == off), None)

    def target(self, blk: Blk, off: int):
        r = self.rel_at(blk, off)
        return (r.tblk, r.toff) if r and r.tblk is not None else None

    def insert(self, blk: Blk, off: int, data: bytes):
        """Insert bytes inside a block: pointer sites and targets at or after off move along (a target exactly at
        the end of the block stays, so appending never re-aims a pointer to the block's end)."""
        n = len(data)
        end = len(blk.data)
        blk.data[off:off] = data
        for r in self.rels():
            if r.blk is blk and r.off >= off:
                r.off += n
            if r.tblk is blk and r.toff >= off and not (off == end and r.toff == end):
                r.toff += n

    def append(self, blk: Blk, data: bytes) -> int:
        off = len(blk.data)
        self.insert(blk, off, data)
        return off

    def set_ptr(self, blk: Blk, off: int, tblk: Blk, toff: int = 0):
        r = self.rel_at(blk, off)
        if r:
            r.tblk, r.toff, r.raw = tblk, toff, None
        else:
            self.parts[blk.part].rels.append(Rel(blk, off, tblk, toff))

    def new_block(self, part: str, chunk: int, data: bytes = b'', index: int | None = None) -> Blk:
        b = Blk(part, chunk, data)
        c = self.parts[part].chunks[chunk]
        c.insert(len(c) if index is None else index, b)
        return b

    # ---- strings -------------------------------------------------------------------------------------------------
    def strings(self) -> Blk:
        c = self.parts['common'].chunks[0]
        return c[0] if c else self.new_block('common', 0)

    def add_string(self, s: str) -> tuple[Blk, int]:
        """A NUL-terminated string in the string table (an existing equal one is reused)."""
        b = self.strings()
        e = s.encode('latin-1') + b'\0'
        i = 0
        while True:
            i = b.data.find(e, i)
            if i < 0:
                break
            if i == 0 or b.data[i - 1] == 0:
                return b, i
            i += 1
        return b, self.append(b, e)

    def cstr(self, blk: Blk, off: int) -> str:
        end = blk.data.index(0, off)
        return blk.data[off:end].decode('latin-1')

    # ---- symbols, loaders, symbol references -------------------------------------------------------------------
    def _tables(self, part: str):
        c = self.parts[part].chunks[2]
        while len(c) < 2:
            self.new_block(part, 2, index=len(c))
        return c[0], c[1]

    def loader_type(self, part: str, loader: str, name: str, tag: str, ltype: int = 1) -> int:
        """Index of a loader in BOTH halves' headers (they list the same loaders), added if missing."""
        idx = None
        for p in PARTS:
            L = self.parts[p].loaders
            i = next((k for k, l in enumerate(L) if l[3] == tag), None)
            if i is None:
                L.append((loader, name, ltype, tag)); i = len(L) - 1
            if idx is not None and i != idx:
                raise ValueError(f'loader {tag} has different numbers in the two halves')
            idx = i
        return idx

    def symbols(self, part: str) -> list[tuple[str, int]]:
        sym, _ = self._tables(part)
        out = []
        for i in range(len(sym.data) // 12):
            t = self.target(sym, 12 * i)
            out.append((self.cstr(*t) if t else '', i))
        return out

    def add_symbol(self, part: str, name: str, tblk: Blk, toff: int = 0) -> int:
        """A pointer symbol 'name:tag' for data at (tblk, toff), kept in sorted place; -> offset in the table."""
        sym, _ = self._tables(part)
        names = [n.lower() for n, _ in self.symbols(part)]
        key = name.lower()
        i = sum(1 for n in names if n.encode('latin-1') < key.encode('latin-1'))
        off = 12 * i
        self.insert(sym, off, struct.pack('<III', 0, 0, 1))
        self.set_ptr(sym, off, *self.add_string(name))
        self.set_ptr(sym, off + 4, tblk, toff)
        return off

    def symref_block(self, part: str) -> Blk:
        _, ldr = self._tables(part)
        c = self.parts[part].chunks[2]
        nrefs = sum(struct.unpack_from('<I', ldr.data, 20 * i + 16)[0] for i in range(len(ldr.data) // 20))
        if nrefs == 0 and (len(c) < 3 or self._is_data(c[2])):
            return self.new_block(part, 2, index=2)
        return c[2]

    def _is_data(self, blk: Blk) -> bool:
        return any(r.tblk is not None and r.blk is not blk and r.tblk is blk for r in self.rels()) or not blk.data

    def add_loader(self, part: str, ltype: int, tblk: Blk, toff: int, sym_off: int) -> int:
        """A loader table entry (a resource) for the data at (tblk, toff) named by the symbol at sym_off."""
        sym, ldr = self._tables(part)
        # the game's files keep the table grouped by loader type, by name within a type
        name = self.cstr(*self.target(sym, sym_off)).lower()
        i = 0
        for i in range(len(ldr.data) // 20 + 1):
            if i == len(ldr.data) // 20:
                break
            t = struct.unpack_from('<I', ldr.data, 20 * i)[0]
            s = self.target(ldr, 20 * i + 12)
            n = self.cstr(*self.target(*s)).lower() if s and self.target(*s) else ''
            if (t, n.encode('latin-1')) > (ltype, name.encode('latin-1')):
                break
        off = 20 * i
        self.insert(ldr, off, struct.pack('<5I', ltype, 0, 0, 0, 0))
        self.set_ptr(ldr, off + 4, tblk, toff)
        self.set_ptr(ldr, off + 12, sym, sym_off)
        return i

    def loader_index(self, part: str, tblk: Blk, toff: int = 0) -> int:
        _, ldr = self._tables(part)
        for i in range(len(ldr.data) // 20):
            if self.target(ldr, 20 * i + 4) == (tblk, toff):
                return i
        raise KeyError('no loader entry for that data')

    def add_symref(self, part: str, loader: int, blk: Blk, off: int, name: str):
        """Make the pointer at (blk, off) an import of 'name:tag', resolved by the game when it loads the OVL."""
        _, ldr = self._tables(part)
        sr = self.symref_block(part)
        before = sum(struct.unpack_from('<I', ldr.data, 20 * i + 16)[0] for i in range(loader + 1))
        pos = 12 * before
        self.insert(sr, pos, struct.pack('<III', 0, 0, 0))
        self.set_ptr(sr, pos, blk, off)
        self.set_ptr(sr, pos + 4, *self.add_string(name))
        self.set_ptr(sr, pos + 8, ldr, 20 * loader)
        cnt = struct.unpack_from('<I', ldr.data, 20 * loader + 16)[0]
        struct.pack_into('<I', ldr.data, 20 * loader + 16, cnt + 1)
        struct.pack_into('<I', blk.data, off, 0)

    def symrefs(self, part: str) -> list[tuple[str, Blk, int]]:
        c = self.parts[part].chunks[2]
        _, ldr = self._tables(part)
        n = sum(struct.unpack_from('<I', ldr.data, 20 * i + 16)[0] for i in range(len(ldr.data) // 20))
        if not n:
            return []
        sr = c[2]
        out = []
        for i in range(n):
            site, name = self.target(sr, 12 * i), self.target(sr, 12 * i + 4)
            out.append((self.cstr(*name), site[0], site[1]))
        return out

    def rename_symbol_strings(self, mapping: dict[str, str]):
        """Re-aim every pointer to a string listed in mapping (old -> new) at the new string."""
        sb = self.strings()
        for r in self.rels():
            if r.tblk is sb:
                try:
                    s = self.cstr(sb, r.toff)
                except ValueError:
                    continue
                if s in mapping:
                    r.tblk, r.toff = self.add_string(mapping[s])
