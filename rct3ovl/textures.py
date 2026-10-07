"""Texture decoding: 'tex' (Texture -> Flic -> DXT1/3/5 or RGBA pixels) and 'ftx' (FlexiTexture, 8-bit paletted).

tex layout (TextureStruct): 8 x 0x70007, unk9, unk10, unk11, txs import, unk12, FlicStruct** flic, ts2*.
The flic loader ref's extra data is FlicHeader {format, width, height, mipcount} followed by, per mip,
FlicMipHeader {width, height, pitch, rows} + pitch*rows bytes. In 'btbl' OVLs the flic extra data is only an
index into a shared bitmap table: btbl extra[0] = 8 bytes + FlicHeader[count], extra[1] = all pixel data.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass

import numpy as np
from PIL import Image

from .container import LoaderRef, Ovl, OvlError

FORMATS = {0x02: 'RGBA', 0x12: 'DXT1', 0x13: 'DXT3', 0x14: 'DXT5'}


@dataclass
class Bitmap:
    format: int
    width: int
    height: int
    mips: list[bytes]          # mip 0 first

    @property
    def format_name(self) -> str:
        return FORMATS.get(self.format, f'0x{self.format:X}')

    def to_image(self, mip: int = 0) -> Image.Image:
        w, h = max(1, self.width >> mip), max(1, self.height >> mip)
        data = self.mips[mip]
        if self.format == 0x02:
            a = np.frombuffer(data[:w * h * 4], np.uint8).reshape(h, w, 4)[..., [2, 1, 0, 3]]   # BGRA -> RGBA
            return Image.fromarray(np.ascontiguousarray(a), 'RGBA')
        n = {0x12: 1, 0x13: 2, 0x14: 3}.get(self.format)
        if not n:
            raise OvlError(f'unsupported pixel format 0x{self.format:X}')
        bw, bh = max(4, (w + 3) // 4 * 4), max(4, (h + 3) // 4 * 4)
        img = Image.frombytes('RGBA', (bw, bh), data, 'bcn', n)
        return img.crop((0, 0, w, h)) if (bw, bh) != (w, h) else img


def _mip_sizes(fmt: int, w: int, h: int, count: int) -> list[int]:
    out = []
    for _ in range(max(count, 1)):
        bw, bh = max(1, (w + 3) // 4), max(1, (h + 3) // 4)
        out.append(w * h * 4 if fmt == 0x02 else bw * bh * (8 if fmt == 0x12 else 16))
        w, h = max(1, w // 2), max(1, h // 2)
    return out


def _bitmap_from_flic_extra(extra: bytes) -> Bitmap:
    fmt, w, h, mipcount = struct.unpack_from('<IIII', extra, 0)
    p, mips = 16, []
    for _ in range(max(mipcount, 1)):
        if p + 16 > len(extra):
            break
        _mw, _mh, pitch, rows = struct.unpack_from('<IIII', extra, p); p += 16
        mips.append(extra[p:p + pitch * rows]); p += pitch * rows
    return Bitmap(fmt, w, h, mips)


class TextureSet:
    """All textures of one OVL pair: name -> Bitmap (tex) and name -> FlexiTexture (ftx)."""

    def __init__(self, ovl: Ovl):
        self.ovl = ovl
        self.flic_bitmaps: dict[int, Bitmap] = {}       # flic struct vaddr -> bitmap
        self._load_flics()

    def _load_flics(self):
        table: list[Bitmap] = []
        for ref in self.ovl.resources:                  # loader order: a btbl precedes the flics that use it
            tag = ref.loader.tag
            if tag == 'btbl' and len(ref.extra) >= 2:
                count = struct.unpack_from('<I', self.ovl.read(ref.data, 8), 4)[0]
                heads, data = ref.extra[0], ref.extra[1]
                table, p = [], 0
                for i in range(count):
                    fmt, w, h, mc = struct.unpack_from('<IIII', heads, 8 + 16 * i)
                    sizes = _mip_sizes(fmt, w, h, mc)
                    mips = []
                    for s in sizes:
                        mips.append(data[p:p + s]); p += s
                    table.append(Bitmap(fmt, w, h, mips))
            elif tag == 'flic' and ref.extra:
                ex = ref.extra[0]
                if len(ex) == 4 and table:
                    idx = struct.unpack('<I', ex)[0]
                    if idx < len(table):
                        self.flic_bitmaps[ref.data] = table[idx]
                elif len(ex) >= 32:
                    self.flic_bitmaps[ref.data] = _bitmap_from_flic_extra(ex)

    def tex_bitmap(self, ref: LoaderRef) -> Bitmap | None:
        o = self.ovl
        flicpp = o.ptr(ref.data + 0x34)
        if not flicpp:
            return None
        flic = o.ptr(flicpp)
        return self.flic_bitmaps.get(flic)

    def ftx_image(self, ref: LoaderRef, frame: int = 0) -> Image.Image | None:
        """FlexiTextureInfoStruct {scale, w, h, fps, recol, offsetCount, offset*, frameCount, frames*};
        frame = FlexiTextureStruct {scale, w, h, recol, palette*, texture*, alpha*}; palette 256 x BGRA."""
        o = self.ovl
        nframes = o.u32(ref.data + 28)
        frames = o.ptr(ref.data + 32)
        if not nframes or not frames:
            return None
        fr = frames + 28 * min(frame, nframes - 1)
        _scale, w, h, _recol, pal_p, tex_p, alpha_p = struct.unpack('<IIIIIII', o.read(fr, 28))
        if not (0 < w <= 4096 and 0 < h <= 4096) or not tex_p:
            return None
        pal = np.frombuffer(o.read(pal_p, 1024), np.uint8).reshape(256, 4)
        idx = np.frombuffer(o.read(tex_p, w * h), np.uint8).reshape(h, w)
        rgba = np.empty((h, w, 4), np.uint8)
        rgba[..., 0:3] = pal[idx][..., [2, 1, 0]]
        if alpha_p:
            rgba[..., 3] = np.frombuffer(o.read(alpha_p, w * h), np.uint8).reshape(h, w)
        else:
            rgba[..., 3] = 255
        return Image.fromarray(rgba, 'RGBA')

    def recolorable(self, ref: LoaderRef) -> int:
        return self.ovl.u32(ref.data + 16)

    def image(self, ref: LoaderRef) -> Image.Image | None:
        if ref.loader.tag == 'tex':
            bm = self.tex_bitmap(ref)
            return bm.to_image() if bm else None
        if ref.loader.tag == 'ftx':
            return self.ftx_image(ref)
        return None
