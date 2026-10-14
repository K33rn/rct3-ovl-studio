"""RollerCoaster Tycoon 3 OVL container reader (versions 1, 4 and 5).

An OVL comes as a pair: NAME.common.ovl + NAME.unique.ovl. Both hold 9 'chunks' of data blocks; laid end to end
(common first, then unique) they form one virtual address space. Pointers stored inside the data are offsets into
that space, and the relocation table lists every pointer site. Names come from the string table (chunk 0 block 0)
via the symbol table (chunk 2 block 0); the loader table (chunk 2 block 1) says which loader (texture, mesh, ...)
owns each data structure.
"""
from __future__ import annotations

import os
import struct
from dataclasses import dataclass, field


class OvlError(Exception):
    pass


@dataclass
class Loader:
    loader: str     # 'FGDK' / 'RCT3'
    name: str       # 'StaticShape', 'Texture', ...
    type: int
    tag: str        # 'shs', 'tex', ...


@dataclass
class Block:
    chunk: int
    index: int
    size: int
    file_offset: int
    vaddr: int      # start in the virtual address space


@dataclass
class Symbol:
    name: str
    data: int       # vaddr (if is_pointer) or a plain value
    is_pointer: bool
    hash: int = 0


@dataclass
class LoaderRef:
    loader: Loader
    data: int                       # vaddr of the structure
    symbol: Symbol | None
    extra: list[bytes] = field(default_factory=list)
    part: str = 'common'            # which file the loader table entry lives in
    extra_at: list[int] = field(default_factory=list)   # file offset of each extra blob (in that part's file)

    @property
    def name(self) -> str:
        return self.symbol.name if self.symbol else ''


@dataclass
class OvlFile:
    """One half of a pair (common or unique)."""
    path: str
    part: str
    data: bytes
    version: int = 0
    subversion: int = 0
    references: list[str] = field(default_factory=list)
    loaders: list[Loader] = field(default_factory=list)
    chunks: list[list[Block]] = field(default_factory=list)
    relocations: list[int] = field(default_factory=list)
    data_end: int = 0


class _R:
    def __init__(self, data: bytes, pos: int = 0):
        self.d, self.p = data, pos

    def u32(self) -> int:
        if self.p + 4 > len(self.d):
            raise OvlError(f'unexpected end of file at 0x{self.p:X}')
        v = struct.unpack_from('<I', self.d, self.p)[0]; self.p += 4; return v

    def u16(self) -> int:
        v = struct.unpack_from('<H', self.d, self.p)[0]; self.p += 2; return v

    def lstr(self) -> str:
        n = self.u16(); s = self.d[self.p:self.p + n]; self.p += n
        return s.decode('latin-1')

    def bytes(self, n: int) -> bytes:
        b = self.d[self.p:self.p + n]; self.p += n; return b


def _parse_file(path: str, part: str, vbase: int) -> OvlFile:
    data = open(path, 'rb').read()
    f = OvlFile(path, part, data)
    r = _R(data)
    if r.bytes(4) != b'FGRK':
        raise OvlError(f'{path}: not an OVL (no FGRK magic)')
    headerversion = r.u32()
    f.version = r.u32()
    if f.version not in (1, 4, 5):
        raise OvlError(f'{path}: unsupported OVL version {f.version}')
    if f.version == 1:
        nrefs = r.u32()
    else:
        if headerversion != 2 or r.u32() != 16:
            raise OvlError(f'{path}: unexpected v{f.version} header')
        if f.version == 4:
            nrefs = r.u32()
        else:
            f.subversion = r.u32()
            if f.subversion:
                r.bytes(12)
                n = 0
                while True:                     # NUL-terminated bytes, padded to 4
                    c = r.bytes(1); n += 1
                    if c == b'\0':
                        break
                r.bytes((4 - n % 4) % 4)
            nrefs = r.u32()
    f.references = [r.lstr() for _ in range(nrefs)]
    r.u32()                                     # unknown
    nloaders = r.u32()
    for _ in range(nloaders):
        ldr, name = r.lstr(), r.lstr()
        typ = r.u32()
        f.loaders.append(Loader(ldr, name, typ, r.lstr()))
    if f.version == 5:
        r.bytes(8 * nloaders)                   # per loader: index, symbol count
    counts, sizes = [], []
    for _ in range(9):
        n = r.u32(); counts.append(n)
        if f.version > 1:
            r.u32()
            if f.version == 5 and f.subversion:
                r.u32()
            sizes.append([r.u32() for _ in range(n)])
    if f.version == 4:
        r.bytes(8)
    elif f.version == 5:
        r.bytes(r.u32())
        r.bytes(4 * r.u32())
    vaddr = vbase
    for ci in range(9):
        blocks = []
        for bi in range(counts[ci]):
            size = r.u32() if f.version == 1 else sizes[ci][bi]
            blocks.append(Block(ci, bi, size, r.p, vaddr))
            r.p += size; vaddr += size
            if r.p > len(data):
                raise OvlError(f'{path}: block {ci}/{bi} runs past end of file')
        f.chunks.append(blocks)
    f.relocations = [r.u32() for _ in range(r.u32())]
    if f.version == 4 or (f.version == 5 and f.subversion):
        r.u32()
    f.data_end = r.p
    return f


def pair_paths(path: str) -> tuple[str, str]:
    """Any of NAME, NAME.common.ovl, NAME.unique.ovl -> (common, unique)."""
    base = path
    for suf in ('.common.ovl', '.unique.ovl'):
        if base.lower().endswith(suf):
            base = base[:-len(suf)]
    return base + '.common.ovl', base + '.unique.ovl'


class Ovl:
    """An opened OVL pair: virtual memory, symbols, and loader references (the resources)."""

    def __init__(self, path: str):
        cpath, upath = pair_paths(path)
        self.name = os.path.basename(cpath)[:-len('.common.ovl')]
        self.files: list[OvlFile] = []
        vbase = 0
        for p, part in ((cpath, 'common'), (upath, 'unique')):
            if not os.path.exists(p):
                continue
            f = _parse_file(p, part, vbase)
            self.files.append(f)
            vbase = max([b.vaddr + b.size for c in f.chunks for b in c] + [vbase])
        if not self.files:
            raise OvlError(f'no OVL files for {path}')
        self.vsize = vbase
        self.version = self.files[0].version
        self._blocks = sorted(((b.vaddr, b, f) for f in self.files for c in f.chunks for b in c if b.size),
                              key=lambda t: t[0])
        self._starts = [t[0] for t in self._blocks]
        self.relocations = set(r for f in self.files for r in f.relocations)
        self._parse_tables()

    # ---- virtual memory -------------------------------------------------------------------------------------
    def locate(self, vaddr: int):
        import bisect
        i = bisect.bisect_right(self._starts, vaddr) - 1
        if i < 0:
            raise OvlError(f'address 0x{vaddr:X} out of range')
        _, b, f = self._blocks[i]
        if vaddr >= b.vaddr + b.size:
            raise OvlError(f'address 0x{vaddr:X} is not inside any block')
        return f, b, b.file_offset + (vaddr - b.vaddr)

    def read(self, vaddr: int, n: int) -> bytes:
        f, b, off = self.locate(vaddr)
        end = b.file_offset + b.size
        if off + n > end:
            raise OvlError(f'read of {n} at 0x{vaddr:X} crosses a block end')
        return f.data[off:off + n]

    def block_bytes(self, vaddr: int) -> tuple[bytes, int]:
        """(bytes from vaddr to the end of its block, block size)."""
        f, b, off = self.locate(vaddr)
        return f.data[off:b.file_offset + b.size], b.size

    def u32(self, vaddr: int) -> int:
        return struct.unpack('<I', self.read(vaddr, 4))[0]

    def f32(self, vaddr: int) -> float:
        return struct.unpack('<f', self.read(vaddr, 4))[0]

    def ptr(self, vaddr: int) -> int:
        """Value of a pointer field (0 = null)."""
        return self.u32(vaddr)

    def is_pointer(self, vaddr: int) -> bool:
        return vaddr in self.relocations

    def str_field(self, field_vaddr: int, default: str = '') -> str:
        """String pointed to by the pointer field at field_vaddr. Offset 0 is a valid string address (start of the
        string table), so null is decided by the relocation table, not by the value."""
        if not self.is_pointer(field_vaddr):
            return default
        try:
            return self.cstr(self.u32(field_vaddr))
        except OvlError:
            return default

    def cstr(self, vaddr: int, maxlen: int = 4096) -> str:
        f, b, off = self.locate(vaddr)
        lim = min(b.file_offset + b.size, off + maxlen)
        end = f.data.find(b'\0', off, lim)
        return f.data[off:end if end >= 0 else lim].decode('latin-1')

    # ---- tables ---------------------------------------------------------------------------------------------
    def _parse_tables(self):
        self.symbols: dict[int, Symbol] = {}            # vaddr of SymbolStruct -> Symbol
        self.symbol_by_name: dict[str, Symbol] = {}
        self.resources: list[LoaderRef] = []
        self.symbol_refs: list[tuple[str, int]] = []    # (name, pointer site) imports from other OVLs
        for f in self.files:
            ch2 = f.chunks[2] if len(f.chunks) > 2 else []
            if ch2 and ch2[0].size:
                b = ch2[0]; size = 12 if f.version == 1 else 16
                for i in range(b.size // size):
                    o = b.file_offset + i * size
                    if f.version == 1:
                        sp, dp, isp = struct.unpack_from('<III', f.data, o); h = 0
                    elif f.version == 4:
                        sp, dp, isp, h = struct.unpack_from('<IIII', f.data, o)
                    else:
                        sp, dp, isp, _ld, h = struct.unpack_from('<IIHHI', f.data, o)
                    s = Symbol(self._safe_str(sp), dp, bool(isp), h)
                    self.symbols[b.vaddr + i * size] = s
                    self.symbol_by_name.setdefault(s.name, s)
            extra_pos = f.data_end
            if len(ch2) > 1 and ch2[1].size:
                b = ch2[1]
                for i in range(b.size // 20):
                    ltype, dp, hx, sym, nres = struct.unpack_from('<IIIII', f.data, b.file_offset + i * 20)
                    if f.version == 5:
                        hx &= 0xFFFF
                    ref = LoaderRef(f.loaders[ltype] if ltype < len(f.loaders) else Loader('?', '?', 0, '?'),
                                    dp, self.symbols.get(sym), part=f.part)
                    for _ in range(hx):
                        if extra_pos + 4 > len(f.data):
                            break
                        n = struct.unpack_from('<I', f.data, extra_pos)[0]
                        ref.extra.append(f.data[extra_pos + 4:extra_pos + 4 + n]); ref.extra_at.append(extra_pos + 4)
                        extra_pos += 4 + n
                    self.resources.append(ref)
            if len(ch2) > 2 and ch2[2].size:
                b = ch2[2]; size = 12 if f.version == 1 else 16
                for i in range(b.size // size):
                    site, sp = struct.unpack_from('<II', f.data, b.file_offset + i * size)
                    self.symbol_refs.append((self._safe_str(sp), site))

    def _safe_str(self, vaddr: int) -> str:
        try:
            return self.cstr(vaddr)
        except OvlError:
            return f'<bad string 0x{vaddr:X}>'

    def file_of(self, part: str) -> OvlFile:
        return next(f for f in self.files if f.part == part)

    def by_tag(self, tag: str) -> list[LoaderRef]:
        return [r for r in self.resources if r.loader.tag == tag]

    def summary(self) -> dict:
        from collections import Counter
        return {'name': self.name, 'version': self.version,
                'files': [os.path.basename(f.path) for f in self.files],
                'resources': dict(Counter(r.loader.tag for r in self.resources)),
                'imports': len(self.symbol_refs)}
