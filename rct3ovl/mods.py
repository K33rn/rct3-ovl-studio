"""Mod Loader: the custom content in the game - scenery sets, paths, custom tracked rides and their cars, station
platforms, fireworks / lasers / water jets, coaster designs, scenarios, parks, structures, billboards, music - listed,
installed from a downloaded archive (.zip / .rar / .7z) or loose files, disabled / enabled and uninstalled.

Where each kind goes (the game folder: lib.root; the user folder: My Documents\\RCT3):
  scenery set (a folder with Style.ovl)   game  Style\\Themed\\<set>  (Style\\Custom\\<set> when its readme says so)
  path set (a 'ptd' resource)             game  Path\\<set>
  custom tracked ride (a 'trr')           game  Tracks\\TrackedRides\\<set>;  its cars ('rit' / 'ric'): Cars\\TrackedRideCars\\<set>
  station platforms (PlatformHeight...)   game  tracks\\Platforms\\Vanilla
  coaster designs .trk                    user  Coasters          fireworks .frw     user  FireworkEffects
  lasers .las                             user  LaserEffects      water jets .wjt    user  WaterJetEffects
  firework shows .fwd                     user  Fireworks         structures .dat    user  Structures
  scenarios .dat                          user  Start New Scenarios   saved parks .dat  user  Parks
  billboards (pictures)                   My Pictures\\RCT3\\Billboards   music  My Music\\RCT3
  pictures a park / design names          My Pictures\\RCT3\\<the folder the save names>
A folder laid out like the game folder (Cars, Tracks, Style, Path...) or like the user folder (Coasters, Structures...)
keeps its layout. Files replaced by an install are copied first and put back when it is uninstalled; disabling moves a
package's files out of the game (and puts back what they replaced) without deleting anything.
Custom content already in the game is told from the game's own files by a list of the stock files
(data/stock_files.txt.gz: RollerCoaster Tycoon 3 Platinum / Gold, Steam)."""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
import uuid
import zipfile

from . import fireworks as fw
from .container import Ovl
from .library import Library
from .trk import Trk

KINDS = {   # kind: (label, area, viewer tab that shows it)
    'scenery': ('Scenery sets', 'game', 'scenery'),
    'path': ('Paths', 'game', None),
    'ride': ('Custom tracked rides', 'game', 'designs'),
    'cars': ('Ride cars', 'game', None),
    'station': ('Station platforms', 'game', None),
    'plugin': ('Code mods', 'game', None),
    'game': ('Other game files', 'game', None),
    'design': ('Coaster designs', 'user', 'designs'),
    'firework': ('Fireworks', 'user', 'fireworks'),
    'laser': ('Lasers', 'user', 'fireworks'),
    'waterjet': ('Water jets', 'user', 'fireworks'),
    'show': ('Firework shows', 'user', 'fireworks'),
    'scenario': ('Scenarios', 'user', None),
    'park': ('Saved parks', 'user', None),
    'structure': ('Structures', 'user', None),
    'peep': ('Peeps', 'user', None),
    'billboard': ('Billboards', 'pictures', None),
    'picture': ('Pictures', 'pictures', None),
    'music': ('Music', 'music', None),
}
USER_SUB = {'design': 'Coasters', 'firework': 'FireworkEffects', 'laser': 'LaserEffects', 'waterjet': 'WaterJetEffects',
            'show': 'Fireworks', 'scenario': 'Start New Scenarios', 'park': 'Parks', 'structure': 'Structures', 'peep': 'Peeps'}
# folders in a download named like the user folder's (or the readmes' spellings of them)
USER_NAMES = {'coasters': 'design', 'fireworkeffects': 'firework', 'fireworkseffects': 'firework', 'lasereffects': 'laser',
              'waterjeteffects': 'waterjet', 'structures': 'structure', 'start new scenarios': 'scenario', 'scenarios': 'scenario',
              'parks': 'park', 'peeps': 'peep', 'billboards': 'billboard', 'music': 'music', 'soundtracks': 'music'}
EXT_KIND = {'.trk': 'design', '.frw': 'firework', '.las': 'laser', '.wjt': 'waterjet', '.fwd': 'show'}
AUDIO = ('.mp3', '.ogg', '.wav', '.wma')
PICTURES = ('.jpg', '.jpeg', '.png', '.bmp', '.tga')
ARCHIVES = ('.zip', '.rar', '.7z', '.tar', '.gz', '.tgz')
GAME_FILES_SKIP = ('.chk', '.log', '.bak')          # made by the game or left behind by tools
# code mods: a DLL named like one the game loads (RCT3plus.exe imports d3d9, dinput8, dsound, winmm, version...) placed
# beside the exe is loaded instead of Windows' own; its settings (.ini) go with it
PLUGIN_DLLS = {'d3d9.dll', 'dinput8.dll', 'dsound.dll', 'winmm.dll', 'version.dll', 'd3d8.dll', 'ddraw.dll', 'dxgi.dll'}
USER_SKIP = {'rct3.fc', 'desktop.ini', 'thumbs.db'}


# ---- places -----------------------------------------------------------------------------------------------------
def _shell_folder(csidl: int, fallback: str) -> str:
    if os.name == 'nt':
        try:
            import ctypes
            buf = ctypes.create_unicode_buffer(260)
            if ctypes.windll.shell32.SHGetFolderPathW(None, csidl, None, 0, buf) == 0:
                return buf.value
        except Exception:
            pass
    return os.path.join(os.path.expanduser('~'), fallback)


def areas(lib: Library) -> dict:
    """Where content goes: the game folder, the user folder, and the picture / music folders the game reads."""
    return {'game': lib.root, 'user': fw.user_dir(),
            'pictures': os.path.join(_shell_folder(0x27, 'Pictures'), 'RCT3'),     # CSIDL_MYPICTURES
            'music': os.path.join(_shell_folder(0x0d, 'Music'), 'RCT3')}           # CSIDL_MYMUSIC


def _store(lib: Library) -> str:
    key = ''.join(c if c.isalnum() else '_' for c in lib.root)[-80:]
    d = os.path.join(lib.cache_dir, 'mods', key)
    os.makedirs(d, exist_ok=True)
    return d


def _tmp(lib: Library, tok: str) -> str:
    """Where a download is unpacked while it is planned: short (not below the game folder's store), so the deep
    folders of a pack stay under Windows' 260-character path limit."""
    return os.path.join(lib.cache_dir, 'mods', 'tmp', tok)


def _long(p: str) -> str:
    """A path Windows opens even past 260 characters (the \\\\?\\ form)."""
    p = os.path.abspath(p)
    return '\\\\?\\' + p if os.name == 'nt' and len(p) >= 240 and not p.startswith('\\\\?\\') else p


def _records_path(lib: Library) -> str:
    return os.path.join(_store(lib), 'packages.json')


def _records(lib: Library) -> list:
    try:
        return json.load(open(_records_path(lib), encoding='utf-8'))
    except Exception:
        return []


def _save_records(lib: Library, recs: list):
    tmp = _records_path(lib) + '.tmp'
    json.dump(recs, open(tmp, 'w', encoding='utf-8'), indent=1)
    os.replace(tmp, _records_path(lib))


_STOCK = None


def stock() -> set:
    """The stock game's files (relative, lower case, '/')."""
    global _STOCK
    if _STOCK is None:
        p = os.path.join(os.path.dirname(__file__), 'data', 'stock_files.txt.gz')
        _STOCK = set(gzip.open(p, 'rt', encoding='utf-8').read().split('\n')) - {''}
    return _STOCK


def _norm(rel: str) -> str:
    return rel.replace('\\', '/').lower().strip('/')


def _existing_case(root: str, rel: str) -> str:
    """rel with each folder spelled as it already is under root (Windows ignores case; this keeps folders single)."""
    parts, cur, out = rel.replace('\\', '/').split('/'), root, []
    for i, p in enumerate(parts):
        hit = None
        if os.path.isdir(cur):
            low = p.lower()
            hit = next((n for n in os.listdir(cur) if n.lower() == low), None)
        out.append(hit or p)
        cur = os.path.join(cur, hit or p)
    return '/'.join(out)


# ---- archives -----------------------------------------------------------------------------------------------------
def _seven_zip() -> str | None:
    for p in (shutil.which('7z'), shutil.which('7za'), r'C:\Program Files\7-Zip\7z.exe', r'C:\Program Files (x86)\7-Zip\7z.exe'):
        if p and os.path.isfile(p):
            return p
    return None


def extract(path: str, out: str):
    """Unpack an archive into out (an empty folder). .zip natively (names with backslashes become folders, nothing
    escapes out); .rar / .7z / others through 7-Zip."""
    os.makedirs(out, exist_ok=True)
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            for info in z.infolist():
                name = info.filename
                try:
                    if info.flag_bits & 0x800 == 0:
                        name = name.encode('cp437').decode('cp1252')   # old zips: Windows names stored as cp437 bytes
                except Exception:
                    pass
                rel = [p for p in name.replace('\\', '/').split('/') if p not in ('', '.', '..')]
                if not rel or info.is_dir():
                    continue
                dst = os.path.join(out, *rel)
                if not os.path.abspath(dst).startswith(os.path.abspath(out) + os.sep):
                    continue
                os.makedirs(_long(os.path.dirname(dst)), exist_ok=True)
                with z.open(info) as src, open(_long(dst), 'wb') as f:
                    shutil.copyfileobj(src, f)
        return
    sz = _seven_zip()
    if not sz:
        raise ValueError(f'{os.path.basename(path)}: unpacking .rar / .7z needs 7-Zip (7-zip.org) - or unpack it yourself and '
                         'install the folder')
    r = subprocess.run([sz, 'x', '-y', '-o' + out, path], capture_output=True, text=True)
    if r.returncode != 0:
        raise ValueError(f'7-Zip could not unpack {os.path.basename(path)}: {(r.stderr or r.stdout).strip()[-300:]}')


# ---- what a folder of OVLs is ---------------------------------------------------------------------------------------
def _pairs_in(d: str, deep: bool) -> list:
    out = []
    for dp, dn, fn in os.walk(d):
        for f in fn:
            if f.lower().endswith('.common.ovl'):
                out.append(os.path.join(dp, f))
        if not deep:
            break
    return out


def _style_home(d: str) -> str | None:
    """Where a scenery set (a folder with Style.ovl) has to be, by its own Style.ovl: it names the OVLs of its items
    by path from the game folder ('Style\\Custom\\VTR\\Twister\\Twister' for Twister\\Twister.common.ovl -> the
    set is Style/Custom/VTR/Twister). The game looks only there: a custom flat ride put anywhere else stops the game
    with 'No :svd for :sid' when it is placed. None when the Style.ovl names none of the set's OVLs."""
    style = next((p for p in _pairs_in(d, False) if os.path.basename(p).lower() == 'style.common.ovl'), None)
    if not style:
        return None
    own = {os.path.relpath(p, d)[:-len('.common.ovl')].replace('\\', '/').lower() for p in _pairs_in(d, True)}
    try:
        data = open(style, 'rb').read()
    except OSError:
        return None
    for m in re.finditer(rb'style[\\/](?:custom|themed)[\\/][\x20-\x7e]+', data, re.IGNORECASE):
        parts = m.group().decode('latin1').replace('\\', '/').split('/')
        for k in range(1, len(parts) - 2):
            if '/'.join(parts[-k:]).lower() in own:
                return '/'.join(parts[:-k])
    return None


# ---- custom flat rides the game leaves undrawn ----------------------------------------------------------------------
# A placed custom flat ride whose model box (bsh bbox) is its real size is not drawn: only its shadow shows, though the
# ghost before placing is drawn whole (VTR Twister, Zodi's Power Twist; checked in the game 2026-10-22). The CFRs that
# do draw (CFH Kamikaze, Cinipaes Mega Disko) carry a never-drawn mesh hundreds of metres tall that makes the box
# that tall. Making the box CFH Kamikaze's height (x / z kept) draws both. Widening x / z too (+-500) crashed the game.
# The game's own flat rides (Style\Themed\Adventure Phoenix Twister...) have boxes their size and are drawn: what
# else lets them be drawn is not known, so only custom sets are changed.
CULL_Y = (-2827.0, 2831.0)
CULL_MIN_HEIGHT = 100.0


def flat_ride_boxes(d: str) -> list:
    """The models of the flat rides ('ride' sids in the set's Style.ovl) in scenery set folder d whose box is short:
    [{'ovl': common.ovl path, 'model': bsh name, 'vaddr', 'bbox'}]."""
    import struct
    from .anims import load_svd
    from .structs import load_sid
    pairs = _pairs_in(d, True)
    style = next((p for p in pairs if os.path.basename(p).lower() == 'style.common.ovl'), None)
    if not style:
        return []
    try:
        so = Ovl(style)
        visuals = {v.lower() for r in so.resources if r.loader.tag == 'sid'
                   for s in [load_sid(so, r)] if s['type'] == 'ride' for v in s['visuals'] if v}
    except Exception:
        return []
    if not visuals:
        return []
    ovls = []
    for p in pairs:
        if p != style:
            try:
                ovls.append((p, Ovl(p)))
            except Exception:
                pass
    models = set()
    for p, o in ovls:
        for r in o.resources:
            if r.loader.tag == 'svd' and r.name.lower() in visuals:
                models.update(l.model.lower() for l in load_svd(o, r).lods if l.model.lower().endswith(':bsh'))
    out = []
    for p, o in ovls:
        for r in o.resources:
            if r.loader.tag == 'bsh' and r.name.lower() in models:
                bb = struct.unpack('<6f', o.read(r.data, 24))
                if bb[4] - bb[1] < CULL_MIN_HEIGHT:
                    out.append({'ovl': p, 'model': r.name, 'vaddr': r.data, 'bbox': bb})
    return out


def fix_flat_rides(d: str) -> list:
    """Give the short flat-ride models of set folder d the tall box (in place). Returns the model names fixed."""
    import struct
    done = []
    for m in flat_ride_boxes(d):
        o = Ovl(m['ovl'])
        f, _b, off = o.locate(m['vaddr'])
        bb = list(m['bbox'])
        bb[1], bb[4] = min(bb[1], CULL_Y[0]), max(bb[4], CULL_Y[1])
        with open(_long(f.path), 'r+b') as fh:
            fh.seek(off)
            fh.write(struct.pack('<6f', *bb))
        done.append(m['model'])
    return done


def _style_sets(root: str) -> list:
    """Every scenery set folder (one with a Style.ovl) under root\\Style\\Custom and Style\\Themed."""
    out = []
    for top in ('Custom', 'Themed'):
        base = _existing_case(root, f'Style/{top}')
        for dp, dn, fn in os.walk(os.path.join(root, *base.split('/'))):
            if any(f.lower() == 'style.common.ovl' for f in fn):
                out.append(dp)
    return out


def ride_fixes(lib: Library) -> list:
    """Flat rides in the game that would not be drawn: [{'set': folder from the game folder, 'models': [...]}]."""
    out, st = [], stock()
    for d in _style_sets(lib.root):
        if _norm(os.path.relpath(os.path.join(d, 'Style.common.ovl'), lib.root)) in st:
            continue            # the game's own flat rides have boxes their size and are drawn
        ms = flat_ride_boxes(d)
        if ms:
            out.append({'set': os.path.relpath(d, lib.root).replace('\\', '/'), 'models': [m['model'] for m in ms]})
    return out


def apply_ride_fixes(lib: Library) -> dict:
    """Fix every flat ride ride_fixes() lists. The files are copied to the store first (backups/ridefix)."""
    bdir = os.path.join(_store(lib), 'backups', 'ridefix')
    fixed = []
    for it in ride_fixes(lib):
        d = os.path.join(lib.root, *it['set'].split('/'))
        for m in flat_ride_boxes(d):
            for p in (m['ovl'], m['ovl'][:-len('.common.ovl')] + '.unique.ovl'):
                b = os.path.join(bdir, os.path.relpath(p, lib.root))
                if os.path.exists(_long(p)) and not os.path.exists(_long(b)):
                    os.makedirs(_long(os.path.dirname(b)), exist_ok=True)
                    shutil.copy2(_long(p), _long(b))
        fixed.append({'set': it['set'], 'models': fix_flat_rides(d)})
    if fixed:
        lib.refresh_index()
    return {'fixed': fixed}


def _ovl_facts(pairs: list) -> dict:
    """{'types': {resource type: n}, 'symbols': set of symbol names, 'names': [resource names]} over OVL pairs."""
    types, syms, names = {}, set(), []
    for c in pairs:
        try:
            o = Ovl(c)
        except Exception:
            continue
        for r in o.resources:
            t = r.name.rsplit(':', 1)[-1].lower() if ':' in r.name else ''
            types[t] = types.get(t, 0) + 1
            names.append(r.name)
        syms.update(s.name.split(':')[0].lower() for s in o.symbols.values())
    return {'types': types, 'symbols': syms, 'names': names}


def classify_ovl_folder(d: str) -> str | None:
    """What a folder of OVLs is: 'scenery' (Style.ovl at its top), 'path', 'ride', 'cars', 'station', or None."""
    top = _pairs_in(d, False)
    if any(os.path.basename(p).lower() == 'style.common.ovl' for p in top):
        return 'scenery'
    facts = _ovl_facts(top or _pairs_in(d, True))
    t = facts['types']
    if 'ptd' in t:
        return 'path'
    if 'trr' in t or 'tks' in t:           # a custom track, or a set of track sections ('tks') other tracks use
        return 'ride'
    if 'rit' in t or 'ric' in t:
        return 'cars'
    if {'platformheight', 'platformoffset'} & facts['symbols']:
        return 'station'
    if 'sid' in t:
        return 'scenery'
    return None


def _dat_kind(path: str, hint: str | None) -> str:
    """A .dat: a structure (a saved selection only), else a scenario or a saved park (by its folder, else a park)."""
    if hint in ('structure', 'scenario', 'park'):
        return hint
    try:
        names = {n for n, _ in Trk(open(path, 'rb').read()).objects.values()}
    except Exception:
        return hint or 'park'
    if 'Park' not in names:
        return 'structure'
    return 'scenario' if 'scenario' in path.lower() else 'park'


def _readme_style(text: str) -> str:
    """'Custom' when a readme sends scenery to Style\\Custom, else 'Themed' (what most sets and the game's saves use)."""
    t = text.lower().replace('/', '\\')
    if re.search(r'style\\custom', t) and not re.search(r'style\\themed', t):
        return 'Custom'
    return 'Themed'


def _readme_folders(text: str) -> dict:
    """Folders a readme sends to a Style folder by name: 'Put "CFH-Rides" inside your Style/Custom folder' ->
    {'cfh-rides': 'Custom'}; 'Place the 'SpeedFlip' folder in the 'Zodi' folder' (an author's folder, which custom
    flat rides keep under Style\\Custom) -> {'speedflip': 'Custom/Zodi'}."""
    out = {}
    for m in re.finditer(r'''["'“]([^"'”\r\n]{1,80})["'”][^\r\n]{0,40}?style[\\/ ](custom|themed)''', text, re.IGNORECASE):
        out[m.group(1).strip().lower()] = m.group(2).capitalize()
    for m in re.finditer(r'''["'“]([^"'”\r\n]{1,80})["'”] folder (?:in|into|inside) (?:the |your )?["'“]([^"'”\r\n\\/]{1,40})["'”] folder''',
                         text, re.IGNORECASE):
        sub, into = m.group(1).strip(), m.group(2).strip()
        if into.lower() not in ('style', 'custom', 'themed') and into.lower() not in _game_tops():
            out.setdefault(sub.lower(), 'Custom/' + into)
    return out


def _picture_refs(src: str) -> dict:
    """Pictures the parks / designs of a download name by path (custom walls, floors, signs: the save keeps
    'My Pictures\\RCT3\\<folder>\\<file>.jpg') -> {file name lower: its path below Pictures\\RCT3}."""
    out = {}
    for dp, dn, fn in os.walk(src):
        for f in fn:
            if not f.lower().endswith(('.dat', '.trk')):
                continue
            try:
                data = open(os.path.join(dp, f), 'rb').read()
            except OSError:
                continue
            for m in re.finditer(rb'(?:[\x20-\x7e]\x00){8,}', data):
                r = re.search(r'pictures\\rct3\\(.+?\.(?:jpe?g|png|bmp|tga))', m.group().decode('utf-16le'), re.IGNORECASE)
                if r:
                    rel = r.group(1).replace('\\', '/')
                    out.setdefault(rel.rsplit('/', 1)[-1].lower(), rel)
    return out


# ---- install plan -----------------------------------------------------------------------------------------------------
GAME_TOPS = None


def _game_tops() -> set:
    global GAME_TOPS
    if GAME_TOPS is None:
        GAME_TOPS = {p.split('/', 1)[0] for p in stock() if '/' in p}
    return GAME_TOPS


def plan_folder(lib: Library, src: str, name: str) -> dict:
    """Where every file of an unpacked download goes. {'name', 'items': [{src, area, rel, kind, set, size, state}],
    'skipped': [{rel, why}], 'readme': text, 'needs': [...]}; state: new / same (already there) / replace."""
    items, skipped, readmes = [], [], []
    for dp, dn, fn in os.walk(src):
        for f in fn:
            if f.lower().endswith(('.txt', '.nfo')) and len(readmes) < 8:
                try:
                    readmes.append((os.path.relpath(os.path.join(dp, f), src), open(os.path.join(dp, f), 'rb').read(20000).decode('latin1')))
                except OSError:
                    pass
    style = _readme_style('\n'.join(t for _, t in readmes))
    sent = _readme_folders('\n'.join(t for _, t in readmes))
    pics = _picture_refs(src)

    planned, fixed = {}, []

    def add(path, area, rel, kind, set_):
        rel = rel.replace('\\', '/')
        key = (area, rel.lower())
        if key in planned:               # the same file twice in the download (packs repeat files across folders)
            first = planned[key]
            return skip(path, 'the same file is in the download twice' if _same(first['src'], path) else
                        f"another file of the same name is installed instead ({os.path.relpath(first['src'], src)})")
        planned[key] = it = {'src': path, 'area': area, 'rel': rel, 'kind': kind, 'set': set_, 'size': os.path.getsize(path)}
        items.append(it)

    def skip(path, why):
        skipped.append({'rel': os.path.relpath(path, src).replace('\\', '/'), 'why': why})

    def whole(d, area, base, kind, set_):     # a folder copied as it is to area/base
        if kind == 'scenery':                 # the unpacked copy: flat rides the game would leave undrawn
            fixed.extend({'set': set_, 'model': m} for m in fix_flat_rides(d))
        for dp, dn, fn in os.walk(d):
            for f in fn:
                p = os.path.join(dp, f)
                if f.lower().endswith(('.txt', '.nfo', '.docx', '.pdf', '.url', '.html', '.htm', '.ini', '.db', '.bak')):
                    skip(p, 'readme / not game content')
                    continue
                add(p, area, base + '/' + os.path.relpath(p, d).replace('\\', '/'), kind, set_)

    def loose(p, d, hint=None):               # one file outside a recognised folder
        f = os.path.basename(p)
        ext = os.path.splitext(f)[1].lower()
        set_ = name
        if f.lower() in PLUGIN_DLLS or ext == '.asi':
            return add(p, 'game', f, 'plugin', set_)
        if ext == '.ini' and any(x.lower() in PLUGIN_DLLS or x.lower().endswith('.asi') for x in os.listdir(os.path.dirname(p))):
            return add(p, 'game', f, 'plugin', set_)
        if f.lower() in USER_SKIP or ext in ('.bak',):
            return skip(p, 'not needed by the game')
        if hint == 'billboard' and ext in PICTURES:
            return add(p, 'pictures', 'Billboards/' + f, 'billboard', set_)
        near = next((pics[s.lower()] for s in os.listdir(os.path.dirname(p)) if s.lower() in pics and '/' in pics[s.lower()]), None)
        if ext in PICTURES and (f.lower() in pics or near):    # one the save names, or one beside those
            rel = pics.get(f.lower()) or near.rsplit('/', 1)[0] + '/' + f
            return add(p, 'pictures', rel, 'picture', rel.rsplit('/', 1)[0] if '/' in rel else set_)
        if (hint == 'music' or ext in AUDIO) and ext in AUDIO:
            return add(p, 'music', f, 'music', set_)
        k = EXT_KIND.get(ext)
        if k:
            return add(p, 'user', USER_SUB[k] + '/' + f, k, set_)
        if ext == '.dat':
            k = _dat_kind(p, hint)
            return add(p, 'user', USER_SUB[k] + '/' + f, k, set_)
        if ext in PICTURES:
            return skip(p, 'picture (preview / instructions)')
        return skip(p, 'readme / not game content')

    def walk(d, depth=0):
        low = os.path.basename(d).lower()
        if depth and low in _game_tops() and low not in ('fireworks', 'music'):
            # laid out like the game folder: kept as it is, below the game folder
            for dp, dn, fn in os.walk(d):
                for f in fn:
                    p = os.path.join(dp, f)
                    if f.lower().endswith(('.txt', '.docx', '.pdf', '.bak', '.db', '.ini')):
                        skip(p, 'readme / not game content')
                        continue
                    rel = _existing_case(lib.root, os.path.relpath(p, os.path.dirname(d)).replace('\\', '/'))
                    kind, set_ = _group_game(rel)
                    add(p, 'game', rel, kind, set_.split('/')[-1])
            return
        home = _style_home(d)
        if home:
            # the set's own Style.ovl names its models by path from the game folder: copied there as it is
            whole(d, 'game', _existing_case(lib.root, home), 'scenery', os.path.basename(d) if depth else name)
            return
        # 'Style-Custom' / 'Style Themed' (how downloads often name them) as 'Custom' / 'Themed'
        low_style = re.sub(r'^style[\s_-]*', '', low)
        if depth and low_style in ('themed', 'custom'):
            for sub in sorted(os.listdir(d)):
                sp = os.path.join(d, sub)
                if os.path.isdir(sp):
                    whole(sp, 'game', _existing_case(lib.root, f'Style/{low_style.capitalize()}/{sub}'), 'scenery', sub)
                else:
                    loose(sp, d)
            return
        if depth and low in sent and _pairs_in(d, True):
            # the readme names this folder and where it goes: copied there as it is
            whole(d, 'game', _existing_case(lib.root, f'Style/{sent[low]}/{os.path.basename(d)}'), 'scenery', os.path.basename(d))
            return
        if depth and low in USER_NAMES:
            k = USER_NAMES[low]
            for dp, dn, fn in os.walk(d):
                for f in fn:
                    loose(os.path.join(dp, f), d, k)
            return
        kind = classify_ovl_folder(d) if _pairs_in(d, True) else None
        set_ = os.path.basename(d) if depth else name
        if kind == 'station':
            for dp, dn, fn in os.walk(d):
                for f in fn:
                    p = os.path.join(dp, f)
                    if f.lower().endswith('.ovl'):
                        add(p, 'game', _existing_case(lib.root, 'tracks/Platforms/Vanilla') + '/' + f, 'station', set_)
                    else:
                        loose(p, d)
            return
        if kind and (_pairs_in(d, False) or kind == 'scenery' and not any(os.path.isdir(os.path.join(d, s)) and
                                                                           classify_ovl_folder(os.path.join(d, s)) for s in os.listdir(d))):
            base = {'scenery': f'Style/{style}', 'path': 'Path', 'ride': 'Tracks/TrackedRides', 'cars': 'Cars/TrackedRideCars'}[kind]
            whole(d, 'game', _existing_case(lib.root, f'{base}/{set_}'), kind, set_)
            return
        for e in sorted(os.listdir(d)):
            p = os.path.join(d, e)
            if os.path.isdir(p):
                walk(p, depth + 1)
            else:
                loose(p, d)
    walk(src)
    # a folder repeated inside itself (CTR_Everest/CTR_Everest/...) holding the same files: installed once
    by_name = {}
    for it in items:
        by_name.setdefault((it['area'], it['rel'].rsplit('/', 1)[-1].lower()), []).append(it)
    for group in by_name.values():
        for it in group:
            d = it['rel'].rsplit('/', 1)[0].lower() + '/'
            if any(o is not it and d.startswith(o['rel'].rsplit('/', 1)[0].lower() + '/') and d != o['rel'].rsplit('/', 1)[0].lower() + '/'
                   and _same(o['src'], it['src']) for o in group):
                items.remove(it)
                planned.pop((it['area'], it['rel'].lower()), None)
                skip(it['src'], 'the same file is in the download twice')
    ar = areas(lib)
    for it in items:
        dst = os.path.join(ar[it['area']], *it['rel'].split('/'))
        it['state'] = 'new' if not os.path.exists(dst) else 'same' if _same(dst, it['src']) else 'replace'
    plan = {'name': name, 'items': items, 'skipped': skipped, 'readme': [{'file': f, 'text': t} for f, t in readmes],
            'areas': ar, 'fixed': fixed}
    plan['needs'] = needs(lib, [it['src'] for it in items if it['kind'] in ('design', 'scenario', 'park')], items)
    return plan


def _same(a: str, b: str) -> bool:
    if os.path.getsize(a) != os.path.getsize(b):
        return False
    return _sha(a) == _sha(b)


def _sha(p: str) -> str:
    h = hashlib.sha1()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


# ---- what designs and scenarios need --------------------------------------------------------------------------------
def _available_ovls(lib: Library, planned: list) -> set:
    """Every OVL the game will have, as 'folder/name' (lower case, no .common.ovl): stock, in the game folder now,
    and about to be installed."""
    have = {p[:-len('.common.ovl')] for p in stock() if p.endswith('.common.ovl')}
    for dp, dn, fn in os.walk(lib.root):
        for f in fn:
            if f.lower().endswith('.common.ovl'):
                have.add(_norm(os.path.relpath(os.path.join(dp, f), lib.root))[:-len('.common.ovl')])
    for it in planned:
        if it['area'] == 'game' and it['rel'].lower().endswith('.common.ovl'):
            have.add(_norm(it['rel'])[:-len('.common.ovl')])
    return have


def needs(lib: Library, files: list, planned: list | None = None) -> list:
    """For coaster designs / scenarios / parks: the custom scenery and ride types they use that the game does not
    have (nor this install). Each scenery item names the OVL it comes from (SIDDatabaseEntry.OVERLAYFILENAME: a
    set's Style for custom scenery, the item's own OVL otherwise). In a park only the entries something placed uses
    count (its database also lists everything the author had installed); a design counts all of its entries.
    [{file, custom_sets, missing_sets: [{set, items, examples}], missing_rides: [name]}]"""
    planned = planned or []
    if not files:
        return []
    have = _available_ovls(lib, planned)
    names = set(lib.index['names'])
    for it in planned:
        if it['area'] == 'game' and it['rel'].lower().endswith('.common.ovl') and it['kind'] == 'ride':
            try:
                names.update(r.name.lower() for r in Ovl(it['src']).resources)
            except Exception:
                pass
    stock_ovls = {p[:-len('.common.ovl')] for p in stock() if p.endswith('.common.ovl')}
    out = []
    for f in files:
        try:
            t = Trk(open(f, 'rb').read())
        except Exception as e:
            out.append({'file': os.path.basename(f), 'error': str(e)}); continue
        O = t.objects
        used = {v.get('DATABASEENTRY') for n, v in O.values() if n == 'SceneryItem'}
        used |= {v.get('SIDDatabaseEntry') for n, v in O.values() if n == 'SceneryItemPlacementSingle'}
        used.discard(None)
        sets, rides = {}, set()
        for oid, (n, v) in O.items():
            if n == 'SIDDatabaseEntry' and isinstance(v, dict) and (oid in used if used else v.get('IsAvailable', 1)):
                ov = _norm(str(v.get('OVERLAYFILENAME', '')))
                if not ov or ov in stock_ovls:
                    continue
                folder = ov.rsplit('/', 1)[0]           # the set: a Style's folder, else the item OVL's folder
                s = sets.setdefault(folder, {'ovls': set(), 'items': []})
                s['ovls'].add(ov)
                s['items'].append(v.get('SYMBOLNAME', ''))
            if n in ('TrackedRideInstance', 'Track'):
                for x in (v.values() if isinstance(v, dict) else []):
                    if isinstance(x, str) and x.lower().endswith(':trr'):
                        rides.add(x)
        # a design names its ride type in its file name too: [CTR_X]Name.trk
        m = re.match(r'\[(.+?)\]', os.path.basename(f))
        if m and f.lower().endswith('.trk'):
            try:
                from .designs import load_design
                rides.add(load_design(f)['ride'])
            except Exception:
                pass
        missing = [{'set': s, 'items': len(d['items']), 'examples': d['items'][:4]} for s, d in sorted(sets.items())
                   if not d['ovls'] <= have]
        missing_rides = sorted(r for r in rides if r.lower() not in names)
        out.append({'file': os.path.basename(f), 'custom_sets': len(sets), 'missing_sets': missing, 'missing_rides': missing_rides})
    return out


# ---- install / disable / uninstall ----------------------------------------------------------------------------------
_PLANS = {}


def plan_upload(lib: Library, filename: str, data: bytes) -> dict:
    """An uploaded download (archive or a single file) unpacked into the store's tmp folder and planned."""
    tok = uuid.uuid4().hex[:12]
    tmp = _tmp(lib, tok)
    os.makedirs(tmp)
    fname = os.path.basename(filename) or 'download'
    src = os.path.join(tmp, 'src')
    raw = os.path.join(tmp, fname)
    open(raw, 'wb').write(data)
    if fname.lower().endswith(ARCHIVES) or zipfile.is_zipfile(raw):
        extract(raw, src)
    else:
        os.makedirs(src); shutil.move(raw, os.path.join(src, fname))
    return _keep(lib, tok, src, fname)


def plan_path(lib: Library, path: str) -> dict:
    """A download already on disk: an archive, a folder or a single file."""
    tok = uuid.uuid4().hex[:12]
    tmp = _tmp(lib, tok)
    os.makedirs(tmp)
    src = os.path.join(tmp, 'src')
    if os.path.isdir(path):
        shutil.copytree(path, src)
    elif path.lower().endswith(ARCHIVES) or zipfile.is_zipfile(path):
        extract(path, src)
    else:
        os.makedirs(src); shutil.copy2(path, src)
    return _keep(lib, tok, src, os.path.basename(path.rstrip('\\/')))


def _keep(lib, tok, src, fname) -> dict:
    name = re.sub(r'\.(zip|rar|7z|tar|gz|tgz)$', '', fname, flags=re.IGNORECASE)
    plan = plan_folder(lib, src, name)
    plan['token'] = tok
    plan['source'] = fname
    _PLANS[tok] = plan
    return _public(plan)


def _public(plan: dict) -> dict:
    p = dict(plan)
    p['items'] = [{k: v for k, v in it.items() if k != 'src'} for it in plan['items']]
    return p


def cancel(lib: Library, tok: str):
    _PLANS.pop(tok, None)
    shutil.rmtree(_tmp(lib, tok), ignore_errors=True)


def install(lib: Library, tok: str, name: str | None = None, leave_out: list | None = None) -> dict:
    """Copy a plan's files into place (leave_out: [kind/set] groups not to install). Files it replaces are copied
    to the store first. Returns the package record."""
    plan = _PLANS.get(tok)
    if not plan:
        raise ValueError('that install has expired - add the download again')
    leave = set(leave_out or [])
    ar = areas(lib)
    pid = uuid.uuid4().hex[:10]
    bdir = os.path.join(_store(lib), 'backups', pid)
    files, kinds, made = [], {}, []
    try:
        for it in plan['items']:
            if f"{it['kind']}/{it['set']}" in leave or it['state'] == 'same':
                continue
            dst = os.path.join(ar[it['area']], *it['rel'].split('/'))
            made += _makedirs(os.path.dirname(dst), ar[it['area']])
            backup = False
            if os.path.exists(dst):
                b = os.path.join(bdir, it['area'], *it['rel'].split('/'))
                os.makedirs(_long(os.path.dirname(b)), exist_ok=True)
                shutil.copy2(dst, _long(b))
                backup = True
            shutil.copy2(_long(it["src"]), _long(dst))
            files.append({'area': it['area'], 'rel': it['rel'], 'kind': it['kind'], 'set': it['set'], 'size': it['size'], 'backup': backup})
            kinds[it['kind']] = kinds.get(it['kind'], 0) + 1
    except PermissionError as e:
        _undo(lib, {'id': pid, 'files': files, 'made': made})
        raise ValueError(f'Windows would not let this program write to {e.filename} - the game folder may need the program '
                         'to run as administrator, or install the game outside Program Files')
    rec = {'id': pid, 'name': (name or plan['name']).strip() or plan['name'], 'source': plan['source'], 'origin': 'installed',
           'installed': time.strftime('%Y-%m-%d %H:%M'), 'enabled': True, 'files': files, 'made': made,
           'readme': plan['readme'], 'skipped': len(plan['skipped'])}
    recs = _records(lib)
    recs.append(rec)
    _save_records(lib, recs)
    cancel(lib, tok)
    if any(f['area'] == 'game' for f in files):
        lib.refresh_index()
    return summary(rec, ar)


def _undo(lib, rec):
    ar = areas(lib)
    for f in rec['files']:
        dst = os.path.join(ar[f['area']], *f['rel'].split('/'))
        b = os.path.join(_store(lib), 'backups', rec['id'], f['area'], *f['rel'].split('/'))
        if f.get('backup') and os.path.exists(_long(b)):
            shutil.copy2(_long(b), _long(dst))
        elif os.path.exists(dst):
            os.remove(dst)
    _prune(lib, rec)


def _makedirs(d: str, area_root: str) -> list:
    """os.makedirs, returning the folders it created (relative to the area: 'area-relative/path') - so that removing a
    package takes away only folders it made, never the game's own (empty Coasters, Structures...)."""
    made, cur = [], os.path.abspath(d)
    root = os.path.abspath(area_root)
    while not os.path.isdir(cur) and cur.startswith(root + os.sep):
        made.append(cur)
        cur = os.path.dirname(cur)
    os.makedirs(d, exist_ok=True)
    return [os.path.relpath(m, root).replace('\\', '/') + '@' + area_root for m in made]


def _prune(lib: Library, rec: dict):
    """Remove the folders a package's install created, deepest first, where they are empty now."""
    for m in sorted(set(rec.get('made', [])), key=lambda x: -x.count('/')):
        rel, _, root = m.partition('@')
        d = os.path.join(root, *rel.split('/'))
        if os.path.isdir(d) and not os.listdir(d):
            os.rmdir(d)


def set_enabled(lib: Library, pid: str, on: bool) -> dict:
    """Disable: the package's files move to the store (what they replaced comes back); enable: they move back."""
    if pid.startswith('found:'):
        pid = adopt(lib, pid)['id']
    recs = _records(lib)
    rec = next(r for r in recs if r['id'] == pid)
    if bool(rec['enabled']) == on:
        return summary(rec, areas(lib))
    ar = areas(lib)
    ddir = os.path.join(_store(lib), 'disabled', pid)
    for f in rec['files']:
        dst = os.path.join(ar[f['area']], *f['rel'].split('/'))
        park = os.path.join(ddir, f['area'], *f['rel'].split('/'))
        b = os.path.join(_store(lib), 'backups', pid, f['area'], *f['rel'].split('/'))
        if on:
            if os.path.exists(_long(park)):
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.move(_long(park), _long(dst))
        else:
            if os.path.exists(dst):
                os.makedirs(_long(os.path.dirname(park)), exist_ok=True)
                shutil.move(_long(dst), _long(park))
            if f.get('backup') and os.path.exists(_long(b)):
                shutil.copy2(_long(b), _long(dst))
    if not on:
        _prune(lib, rec)
    shutil.rmtree(ddir, ignore_errors=True) if on else None
    rec['enabled'] = on
    _save_records(lib, recs)
    if any(f['area'] == 'game' for f in rec['files']):
        lib.refresh_index()
    return summary(rec, ar)


def uninstall(lib: Library, pid: str) -> dict:
    """Take a package out of the game. Installed here: its files are deleted (the download still has them) and what
    they replaced is put back. Found in the game (not installed here): its files are moved to the store's 'removed'
    folder rather than deleted."""
    if pid.startswith('found:'):
        pid = adopt(lib, pid)['id']
    recs = _records(lib)
    rec = next(r for r in recs if r['id'] == pid)
    ar = areas(lib)
    if rec['enabled']:
        if rec['origin'] == 'found':
            keep = os.path.join(_store(lib), 'removed', time.strftime('%Y%m%d-%H%M%S') + '-' + pid)
            for f in rec['files']:
                dst = os.path.join(ar[f['area']], *f['rel'].split('/'))
                if os.path.exists(dst):
                    k = os.path.join(keep, f['area'], *f['rel'].split('/'))
                    os.makedirs(_long(os.path.dirname(k)), exist_ok=True)
                    shutil.move(_long(dst), _long(k))
            # content found in the game: only the set's own folder (a scenery set, path, ride) if it is left empty
            for d in {os.path.dirname(os.path.join(ar[f['area']], *f['rel'].split('/'))) for f in rec['files']
                      if f['area'] == 'game' and f['kind'] in ('scenery', 'path', 'ride', 'cars') and _norm(f['rel']).count('/') >= 3}:
                if os.path.isdir(d) and not os.listdir(d) and _norm(os.path.relpath(d, ar['game'])) not in {p.rsplit('/', 1)[0] for p in stock()}:
                    os.rmdir(d)
        else:
            _undo(lib, rec)
    elif rec['origin'] == 'found':
        keep = os.path.join(_store(lib), 'removed', time.strftime('%Y%m%d-%H%M%S') + '-' + pid)
        if os.path.isdir(os.path.join(_store(lib), 'disabled', pid)):
            shutil.move(os.path.join(_store(lib), 'disabled', pid), keep)
    shutil.rmtree(os.path.join(_store(lib), 'disabled', pid), ignore_errors=True)
    shutil.rmtree(os.path.join(_store(lib), 'backups', pid), ignore_errors=True)
    _save_records(lib, [r for r in recs if r['id'] != pid])
    if any(f['area'] == 'game' for f in rec['files']):
        lib.refresh_index()
    return {'ok': True, 'id': pid}


# ---- what is in the game ---------------------------------------------------------------------------------------------
def _group_game(rel: str) -> tuple:
    """(kind, set) of a custom file in the game folder."""
    p = rel.split('/')
    lp = [x.lower() for x in p]
    if lp[0] == 'style' and len(p) >= 4 and lp[1] in ('themed', 'custom'):
        return 'scenery', f'{p[1]}/{p[2]}'
    if lp[0] == 'style' and len(p) >= 3:
        return 'scenery', p[1]
    if lp[0] == 'path' and len(p) >= 3:
        return 'path', p[1]
    if lp[:2] == ['tracks', 'trackedrides'] and len(p) >= 4:
        return 'ride', p[2]
    if lp[:2] == ['tracks', 'platforms']:
        return 'station', 'tracks/Platforms'
    if lp[0] == 'cars' and len(p) >= 4:
        return 'cars', p[2]
    if lp[0] == 'fireworks':
        return 'firework', 'Fireworks (game folder)'
    if len(p) == 1 and (lp[0] in PLUGIN_DLLS or lp[0].endswith('.asi')):
        return 'plugin', p[0]
    return 'game', '/'.join(p[:2]) if len(p) > 2 else p[0]


def _found(lib: Library, owned: set) -> list:
    """Custom content not installed here, grouped into sets: game folder files not in the stock list, and
    everything in the user, picture and music folders."""
    ar = areas(lib)
    groups = {}
    st = stock()
    root = ar['game']
    # files the editors added beside a change they made (the Heartline loop's models): part of that change, listed with it
    from . import texedit
    st = st | {f.replace('\\', '/').lower() for e in texedit.edits(lib).values() for f in e.get('added', [])}
    for dp, dn, fn in os.walk(root):
        for f in fn:
            rel = os.path.relpath(os.path.join(dp, f), root).replace('\\', '/')
            low = rel.lower()
            if low in st or low.endswith(GAME_FILES_SKIP) or ('game', low) in owned:
                continue
            kind, set_ = _group_game(rel)
            g = groups.setdefault(('game', kind, set_), [])
            g.append(rel)
    for area, kinds in (('user', None), ('pictures', 'billboard'), ('music', 'music')):
        base = ar[area]
        if not base or not os.path.isdir(base):
            continue
        for dp, dn, fn in os.walk(base):
            for f in fn:
                rel = os.path.relpath(os.path.join(dp, f), base).replace('\\', '/')
                if f.lower() in USER_SKIP or (area, rel.lower()) in owned:
                    continue
                if area == 'user':
                    top = rel.split('/')[0].lower()
                    kind = next((k for k, sub in USER_SUB.items() if sub.lower() == top), None)
                    if not kind or '/' not in rel:
                        continue
                    if kind == 'park' and not f.lower().endswith('.dat'):
                        continue
                    set_ = USER_SUB[kind]
                else:
                    if not f.lower().endswith(PICTURES if area == 'pictures' else AUDIO):
                        continue
                    kind, set_ = kinds, rel.rsplit('/', 1)[0] if '/' in rel else ('Pictures\\RCT3' if area == 'pictures' else 'Music\\RCT3')
                groups.setdefault((area, kind, set_), []).append(rel)
    out = []
    for (area, kind, set_), rels in groups.items():
        files = [{'area': area, 'rel': r, 'kind': kind, 'set': set_,
                  'size': os.path.getsize(os.path.join(ar[area], *r.split('/')))} for r in sorted(rels)]
        out.append({'id': f'found:{area}:{kind}:{set_}', 'name': set_.split('/')[-1], 'origin': 'found', 'enabled': True, 'files': files})
    return out


def adopt(lib: Library, fid: str) -> dict:
    """A found group becomes a package of its own (so it can be disabled / removed and brought back)."""
    owned = _owned(lib)
    grp = next((g for g in _found(lib, owned) if g['id'] == fid), None)
    if not grp:
        raise ValueError('that content is no longer in the game')
    rec = {'id': uuid.uuid4().hex[:10], 'name': grp['name'], 'source': 'already in the game', 'origin': 'found',
           'installed': '', 'enabled': True, 'files': [dict(f, backup=False) for f in grp['files']], 'readme': [], 'skipped': 0}
    recs = _records(lib)
    recs.append(rec)
    _save_records(lib, recs)
    return rec


def _owned(lib: Library) -> set:
    return {(f['area'], f['rel'].lower()) for r in _records(lib) for f in r['files']}


def summary(rec: dict, ar: dict) -> dict:
    """A package for the list: its sets by kind, sizes, where they are."""
    sets, dirs = {}, {}
    for f in rec['files']:
        k = (f['kind'], f['set'])
        s = sets.setdefault(k, {'kind': f['kind'], 'set': f['set'], 'files': 0, 'size': 0, 'area': f['area']})
        s['files'] += 1
        s['size'] += f.get('size', 0)
        dirs.setdefault(k, set()).add(f['rel'].rsplit('/', 1)[0] if '/' in f['rel'] else '')
    for k, s in sets.items():      # where the set is: the folder its files share
        d = '' if '' in dirs[k] else os.path.commonpath(sorted(dirs[k])).replace('\\', '/')
        s['where'] = os.path.join(ar[s['area']], *d.split('/')) if d else ar[s['area']]
    kinds = {}
    for s in sets.values():
        kinds[s['kind']] = kinds.get(s['kind'], 0) + 1
    return {'id': rec['id'], 'name': rec['name'], 'source': rec.get('source', ''), 'origin': rec['origin'], 'installed': rec.get('installed', ''),
            'enabled': rec['enabled'], 'files': len(rec['files']), 'size': sum(f.get('size', 0) for f in rec['files']),
            'sets': sorted(sets.values(), key=lambda s: (list(KINDS).index(s['kind']), s['set'].lower())), 'kinds': kinds,
            'skipped': rec.get('skipped', 0), 'has_readme': bool(rec.get('readme'))}


def scan(lib: Library) -> dict:
    """Everything custom in the game: packages installed here (and found ones disabled or adopted), then content
    found in the game that was put there some other way."""
    ar = areas(lib)
    recs = _records(lib)
    owned = _owned(lib)
    pkgs = [summary(r, ar) for r in recs]
    found = [summary(g, ar) for g in _found(lib, owned)]
    return {'areas': ar, 'kinds': {k: {'label': v[0], 'area': v[1], 'tab': v[2]} for k, v in KINDS.items()},
            'packages': pkgs, 'found': found, 'sevenzip': bool(_seven_zip()), 'ride_fixes': ride_fixes(lib),
            'additions': additions(lib)}


def additions(lib: Library) -> list:
    """New pieces this program can add to the game's own rides (built from the user's game files)."""
    from . import trackloop
    try:
        return [trackloop.status(lib)] if os.path.exists(os.path.join(lib.root, trackloop._rel(f'{trackloop.T7}/Track7'))) else []
    except Exception:
        return []


def set_addition(lib: Library, aid: str, on: bool) -> dict:
    from . import trackloop
    if aid != 'heartline-loop':
        raise ValueError(f'no addition {aid}')
    if on:
        trackloop.install(lib)
    else:
        trackloop.uninstall(lib)
    return scan(lib)


def details(lib: Library, pid: str) -> dict:
    """A package's files, readme, and what its designs / scenarios need."""
    ar = areas(lib)
    if pid.startswith('found:'):
        rec = next((g for g in _found(lib, _owned(lib)) if g['id'] == pid), None)
        if not rec:
            raise ValueError('no such content')
        rec = dict(rec, readme=[])
    else:
        rec = next(r for r in _records(lib) if r['id'] == pid)
    files = []
    for f in rec['files']:
        p = os.path.join(ar[f['area']], *f['rel'].split('/'))
        files.append(dict(f, path=p, present=os.path.exists(p)))
    checks = [f['path'] for f in files if f['kind'] in ('design', 'scenario', 'park') and f['present']]
    return {'summary': summary(rec, ar), 'files': files, 'readme': rec.get('readme', []), 'needs': needs(lib, checks[:40])}
