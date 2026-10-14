"""Texture & GUI editor back end: every texture in the game, written back into its OVL in place.

Edits keep each resource's size and layout, so only bytes inside the OVL change (no pointers, no relocations):
- tex: the pixels of every mip (DXT1/3/5 re-encoded, or BGRA), at the file offsets of the flic's extra data or of
  its slot in the OVL's bitmap table (btbl);
- ftx: per frame the 256-colour palette, the 8-bit pixels and the alpha (recolourable ones keep their palette,
  so the three recolour ranges still work; others get a new palette);
- gsi: an icon's rectangle on its sheet (4 x u32);
- txt: a text (UTF-16), up to the length of the one it replaces.
Before the first change to an OVL pair both of its files are copied to ~/.rct3ovl/backups/<game>/<path>, and
restore() puts them back.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import struct
import time

import numpy as np
from PIL import Image

from .container import Ovl, OvlError, pair_paths
from .library import _mtime
from .media import text as read_text
from .structs import load_gsi

DXT = {0x12: 1, 0x13: 2, 0x14: 3}
FORMAT_NAMES = {0x02: 'BGRA 32-bit', 0x12: 'DXT1', 0x13: 'DXT3', 0x14: 'DXT5'}


# ---- catalogue ------------------------------------------------------------------------------------------------
def _key(lib) -> str:
    return ''.join(c if c.isalnum() else '_' for c in lib.root)[-80:]


def catalogue(lib) -> list[dict]:
    """Every tex / ftx in the game: {n: name, t: tag, p: OVL pair (relative), w, h, f: format / frames, r: recolour}.
    Built once (it opens every OVL with pictures) and kept on disk until an OVL changes."""
    cached = getattr(lib, '_texcat', None)
    if cached is not None:
        return cached
    ovls = [o for o in lib.index['ovls'] if not o.get('error') and (o.get('counts', {}).get('tex') or o.get('counts', {}).get('ftx'))]
    sig = hashlib.md5(json.dumps([(o['path'], o.get('mtime')) for o in ovls]).encode()).hexdigest()
    path = os.path.join(lib.cache_dir, f'texcat_{_key(lib)}.json')
    try:
        d = json.load(open(path))
        if d.get('sig') == sig:
            lib._texcat = d['items']
            return lib._texcat
    except Exception:
        pass
    items = []
    for ov in ovls:
        try:
            o, ts = lib.open(ov['path'])
        except Exception:
            continue
        for r in o.resources:
            if r.loader.tag not in ('tex', 'ftx') or not r.name:
                continue
            it = {'n': r.name.split(':')[0], 't': r.loader.tag, 'p': ov['path']}
            try:
                if r.loader.tag == 'tex':
                    bm = ts.tex_bitmap(r)
                    if bm is None or bm.format == 0x01:
                        continue
                    it.update(w=bm.width, h=bm.height, f=FORMAT_NAMES.get(bm.format, hex(bm.format)))
                else:
                    n = o.u32(r.data + 28); fr = o.ptr(r.data + 32)
                    if not n or not fr:
                        continue
                    _s, w, h = struct.unpack('<III', o.read(fr, 12))
                    it.update(w=w, h=h, f=n, r=o.u32(r.data + 16))
            except OvlError:
                continue
            items.append(it)
    json.dump({'sig': sig, 'items': items}, open(path, 'w'))
    lib._texcat = items
    return items


def norm(lib, rel: str) -> str:
    """'Main', 'Main.unique.ovl', 'Main.common.ovl' -> 'Main.common.ovl' (the pair, as the index names it)."""
    return os.path.relpath(pair_paths(os.path.join(lib.root, rel))[0], lib.root)


def _ref(lib, rel: str, name: str, tag: str | None = None):
    o, ts = lib.open(rel)
    want = name.lower()
    for r in o.resources:
        if r.name.lower() == want or (tag and r.name.lower() == f'{want}:{tag}'):
            return o, ts, r
    raise KeyError(f'{name} is not in {rel}')


def info(lib, rel: str, name: str) -> dict:
    o, ts, r = _ref(lib, rel, name)
    d = {'name': r.name, 'tag': r.loader.tag, 'path': norm(lib, rel), 'modified': norm(lib, rel) in edits(lib)}
    if r.loader.tag == 'tex':
        bm = ts.tex_bitmap(r)
        flic = ts.tex_flic(r)
        where = ts.flic_where.get(flic) if flic is not None else None
        d.update(w=bm.width, h=bm.height, format=FORMAT_NAMES.get(bm.format, hex(bm.format)), mips=len(bm.mips),
                 frames=1, editable=bool(where and all(x is not None for x in where[1]) and bm.format in (0x02, *DXT)))
    elif r.loader.tag == 'ftx':
        n = o.u32(r.data + 28); fr = o.ptr(r.data + 32)
        _s, w, h = struct.unpack('<III', o.read(fr, 12))
        d.update(w=w, h=h, format='256 colours', mips=1, frames=n, recolour=o.u32(r.data + 16),
                 fps=o.u32(r.data + 12), editable=True)
    # icons cut from this picture (an icon sheet), from the same OVL
    if r.loader.tag == 'tex':
        d['icons'] = [g for g in icons(lib, rel) if g['texture'].lower() == r.name.lower()]
    return d


# ---- encoding -------------------------------------------------------------------------------------------------
def _fit(img: Image.Image, w: int, h: int) -> Image.Image:
    img = img.convert('RGBA')
    return img if img.size == (w, h) else img.resize((w, h), Image.Resampling.LANCZOS)


def _encode_mips(img: Image.Image, fmt: int, w: int, h: int, sizes: list[int]) -> list[bytes]:
    """Upright RGBA picture -> the stored mips (bottom row first), each exactly as long as the one it replaces."""
    base = _fit(img, w, h).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    out = []
    for i, size in enumerate(sizes):
        mw, mh = max(1, w >> i), max(1, h >> i)
        m = base if i == 0 else base.resize((mw, mh), Image.Resampling.BOX)
        if fmt == 0x02:
            data = np.asarray(m, np.uint8)[..., [2, 1, 0, 3]].tobytes()
        else:
            bw, bh = max(4, (mw + 3) // 4 * 4), max(4, (mh + 3) // 4 * 4)
            if (bw, bh) != (mw, mh):                 # small mips: a whole 4 x 4 block, edges repeated
                a = np.asarray(m, np.uint8)
                a = np.pad(a, ((0, bh - mh), (0, bw - mw), (0, 0)), mode='edge')
                m = Image.fromarray(a, 'RGBA')
            data = m.tobytes('bcn', DXT[fmt])
        if len(data) != size:
            raise ValueError(f'mip {i}: {len(data)} bytes encoded, {size} stored')
        out.append(data)
    return out


def _ftx_frame(o: Ovl, r, frame: int):
    n = o.u32(r.data + 28)
    fr = o.ptr(r.data + 32) + 28 * min(frame, n - 1)
    _s, w, h, _rc, pal_p, tex_p, alpha_p = struct.unpack('<IIIIIII', o.read(fr, 28))
    return w, h, pal_p, tex_p, alpha_p


def _encode_ftx(o: Ovl, r, img: Image.Image, frame: int) -> list[tuple[int, bytes]]:
    """(vaddr, bytes) to write: palette (unless kept), pixels, alpha."""
    w, h, pal_p, tex_p, alpha_p = _ftx_frame(o, r, frame)
    a = np.asarray(_fit(img, w, h).transpose(Image.Transpose.FLIP_TOP_BOTTOM), np.uint8)
    rgb = a[..., :3].reshape(-1, 3).astype(np.int32)
    out = []
    pal = np.frombuffer(o.read(pal_p, 1024), np.uint8).reshape(256, 4)
    if o.u32(r.data + 16):
        # recolourable: keep the palette (its 1-85 / 86-170 / 171-255 ranges are what the game recolours) and
        # match each pixel to the nearest entry
        prgb = pal[:, [2, 1, 0]].astype(np.int32)
        idx = np.empty(len(rgb), np.uint8)
        for s in range(0, len(rgb), 4096):
            d = ((rgb[s:s + 4096, None, :] - prgb[None, :, :]) ** 2).sum(-1)
            idx[s:s + 4096] = d.argmin(1)
    else:
        q = Image.fromarray(a[..., :3]).quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        p = np.array(q.getpalette()[:768] + [0] * (768 - len(q.getpalette()[:768])), np.uint8).reshape(256, 3)
        newpal = pal.copy(); newpal[:, 0:3] = p[:, ::-1]
        out.append((pal_p, newpal.tobytes()))
        idx = np.asarray(q, np.uint8).reshape(-1)
    out.append((tex_p, idx.tobytes()))
    if alpha_p:
        out.append((alpha_p, a[..., 3].tobytes()))
    return out


# ---- writing --------------------------------------------------------------------------------------------------
def _backup_dir(lib) -> str:
    return os.path.join(lib.cache_dir, 'backups', hashlib.md5(lib.root.lower().encode()).hexdigest()[:10])


def _lp(p: str) -> str:
    """Long-path form on Windows (game paths plus the backup folder can pass 260 characters)."""
    p = os.path.abspath(p)
    return '\\\\?\\' + p if os.name == 'nt' and not p.startswith('\\\\') else p


def _manifest_path(lib) -> str:
    return os.path.join(_backup_dir(lib), 'edits.json')


def edits(lib) -> dict:
    """OVL pairs changed by the editor: {rel: {'changes': [resource names], 'time': ...}}."""
    try:
        return json.load(open(_manifest_path(lib)))
    except Exception:
        return {}


def _save_edits(lib, d: dict):
    os.makedirs(_backup_dir(lib), exist_ok=True)
    json.dump(d, open(_manifest_path(lib), 'w'), indent=1)


def _reload(lib, rel: str):
    """The pair changed on disk: forget the open copy and everything built from it."""
    base = pair_paths(os.path.join(lib.root, rel))[0]
    lib._open.pop(base, None)
    for o in lib.index['ovls']:
        if o['path'] == rel:
            o['mtime'] = _mtime(base)
    for k in [k for k in vars(lib) if k.startswith('_') and k not in ('_open', '_texcat')]:
        delattr(lib, k)
    json.dump(lib.index, open(lib._index_path(), 'w'))


def _patch(lib, rel: str, o: Ovl, writes: list[tuple[str, int, bytes]], what: str):
    """writes: (part, file offset, bytes). Backs the pair up (first time only), writes, checks it still reads."""
    files = {f.part: f.path for f in o.files}
    bdir = _backup_dir(lib)
    for part, p in files.items():
        dst = os.path.join(bdir, os.path.relpath(p, lib.root))
        if not os.path.exists(_lp(dst)):
            os.makedirs(_lp(os.path.dirname(dst)), exist_ok=True)
            shutil.copy2(_lp(p), _lp(dst))
    data = {part: bytearray(open(p, 'rb').read()) for part, p in files.items()}
    for part, off, b in writes:
        buf = data[part]
        if off < 0 or off + len(b) > len(buf):
            raise ValueError('write outside the file')
        buf[off:off + len(b)] = b
    for part, p in files.items():
        tmp = p + '.rct3ovl-tmp'
        open(tmp, 'wb').write(data[part])
        try:
            os.replace(tmp, p)
        except PermissionError:
            os.remove(tmp)
            raise PermissionError(f'{os.path.basename(p)} is in use - close RollerCoaster Tycoon 3 and try again')
    Ovl(files['common'] if 'common' in files else next(iter(files.values())))      # still a readable OVL
    rel = norm(lib, rel)
    e = edits(lib)
    ent = e.setdefault(rel, {'changes': []})
    if what not in ent['changes']:
        ent['changes'].append(what)
    ent['time'] = time.strftime('%Y-%m-%d %H:%M')
    _save_edits(lib, e)
    _reload(lib, rel)


def _vwrite(o: Ovl, vaddr: int, b: bytes) -> tuple[str, int, bytes]:
    f, blk, off = o.locate(vaddr)
    if off + len(b) > blk.file_offset + blk.size:
        raise ValueError('write crosses a block end')
    return f.part, off, b


def write_texture(lib, rel: str, name: str, png: bytes, frame: int = 0) -> dict:
    """Replace a tex / ftx picture with an upright PNG (scaled to its size if it differs)."""
    o, ts, r = _ref(lib, rel, name)
    img = Image.open(io.BytesIO(png))
    if r.loader.tag == 'tex':
        bm = ts.tex_bitmap(r)
        part, offs = ts.flic_where[ts.tex_flic(r)]
        if bm.format not in (0x02, *DXT) or any(x is None for x in offs):
            raise ValueError(f'{bm.format_name} pictures can not be written')
        mips = _encode_mips(img, bm.format, bm.width, bm.height, [len(m) for m in bm.mips])
        writes = [(part, off, m) for off, m in zip(offs, mips)]
    elif r.loader.tag == 'ftx':
        writes = [_vwrite(o, v, b) for v, b in _encode_ftx(o, r, img, frame)]
    else:
        raise ValueError('not a picture')
    _patch(lib, rel, o, writes, r.name)
    return info(lib, rel, name)


def restore(lib, rel: str) -> None:
    rel = norm(lib, rel)
    e = edits(lib)
    bdir = _backup_dir(lib)
    for p in pair_paths(os.path.join(lib.root, rel)):
        src = os.path.join(bdir, os.path.relpath(p, lib.root))
        if os.path.exists(_lp(src)):
            try:
                shutil.copy2(_lp(src), _lp(p))
            except PermissionError:
                raise PermissionError(f'{os.path.basename(p)} is in use - close RollerCoaster Tycoon 3 and try again')
            os.remove(_lp(src))
    e.pop(rel, None)
    _save_edits(lib, e)
    _reload(lib, rel)


# ---- GUI: icons and texts -------------------------------------------------------------------------------------
def icons(lib, rel: str) -> list[dict]:
    """An OVL's icons: {name, type, texture (the sheet), sheet (the OVL holding it), rect [l, t, r, b]}."""
    o, _ = lib.open(rel)
    out, where = [], {}
    for r in o.by_tag('gsi'):
        try:
            g = load_gsi(o, r)
        except Exception:
            continue
        g['name'] = g['name'].split(':')[0]
        t = g['texture'].lower()
        if t and t not in where:
            hit = lib.find(t, prefer=o)
            where[t] = norm(lib, os.path.relpath(hit[0].files[0].path, lib.root)) if hit else None
        g['sheet'] = where.get(t)
        out.append(g)
    return out


def gui_catalogue(lib) -> dict:
    """The OVLs with icons (gsi) and the language files (txt), for the GUI editor."""
    gsi = [{'path': o['path'], 'n': o['counts']['gsi']} for o in lib.index['ovls'] if o.get('counts', {}).get('gsi')]
    langs = [{'path': o['path'], 'n': o['counts']['txt']} for o in lib.index['ovls']
             if o.get('counts', {}).get('txt', 0) > 1000]
    return {'icons': gsi, 'texts': langs, 'edits': edits(lib)}


def set_icon_rect(lib, rel: str, name: str, rect: list[int]) -> dict:
    """Move (any icon) or resize (plain icons, type 0) to rect [left, top, right, bottom]; panels, frames and bars
    move with all their cuts."""
    o, ts, r = _ref(lib, rel, name, 'gsi')
    g = load_gsi(o, r)
    if not g['rect']:
        raise ValueError('this icon has no rectangle')
    l, t, rr, b = (int(x) for x in rect)
    if not (0 <= l < rr and 0 <= t < b):
        raise ValueError('bad rectangle')
    if 'xs' in g:
        ol, ot, orr, ob = g['rect']
        if (rr - l, b - t) != (orr - ol, ob - ot):
            raise ValueError('panels, frames and bars can be moved but not resized')
        dx, dy = l - ol, t - ot
        vals = [x + dx for x in g['xs']] + [y + dy for y in g['ys']]
    else:
        vals = [l, t, rr, b]
    pos = o.ptr(r.data + 8)
    _patch(lib, rel, o, [_vwrite(o, pos, struct.pack(f'<{len(vals)}i', *vals))], r.name)
    o, _ = lib.open(rel)
    out = load_gsi(o, next(x for x in o.resources if x.name == r.name))
    out['name'] = out['name'].split(':')[0]
    return out


def _text_room(o: Ovl, r) -> int:
    """Characters that fit where a text is: up to the next text (its own NULs and any padding after it)."""
    data, _ = o.block_bytes(r.data)
    end = 0
    while end + 1 < len(data) and data[end:end + 2] != b'\0\0':
        end += 2
    pad = end + 2
    while pad + 1 < len(data) and data[pad:pad + 2] == b'\0\0':
        pad += 2
    return (pad - 2) // 2                 # leave one NUL to end it


def texts(lib, rel: str) -> list[dict]:
    o, _ = lib.open(rel)
    return [{'name': r.name.split(':')[0], 'text': read_text(o, r), 'max': _text_room(o, r)} for r in o.by_tag('txt')]


def set_text(lib, rel: str, name: str, value: str) -> dict:
    o, ts, r = _ref(lib, rel, name, 'txt')
    room = _text_room(o, r)
    new = value.encode('utf-16le')
    if len(value) > room or len(new) != 2 * len(value):
        raise ValueError(f'too long: at most {room} characters fit in place of this text')
    _patch(lib, rel, o, [_vwrite(o, r.data, new + b'\0' * (2 * (room - len(value)) + 2))], r.name)
    return {'name': name, 'text': value, 'max': room}
