"""Fireworks: the game's firework types (Fireworks\\*.frw), premade displays (FireworkDisplays\\*.fwd), the launchers
they fire from, and the sprites, sounds and music they use - served to the viewer's Fireworks editor.

.frw and .fwd use the same self-describing save format as ride designs (trk.py), without the header.
- .frw: ParticleBaseDesc -> ParticleEmitterDescs -> ParticleDesc -> ParticleEmitterDescs -> ... a tree of
  particles. Emitters release NumParticles over [StartTime, EndTime] (fractions of the parent's life) at
  ParticleSpeed along the parent's heading, plus SpeedRandom (sphere) / SpeedRandomCircle (ring) scatter and
  ParentSpeedFactor of the parent's velocity. Particles: Lifetime, Start/EndSize, Drag, GravityScale, VelStretch,
  colour curves R/G/B (A: 0 = additive glow, 1 = blended), TextureNameReduced (a psi sprite), SoundName.
- .fwd: SavedFireworkDisplay {Entries [{Name (frw path), SceneryEntry, SlotIndex, Time, Track}], SceneryEntries
  [{Row, Col, Dir, Corner, SID -> SIDDatabaseEntry.SYMBOLNAME}], MusicSelection, StartTimeMinutes, MonthMask}.
  Track is an int stored in a float32 field.
- psi (ParticleSkin): u32 1, rect* {ptr, u0, v0, u1, v1} (v from the bottom), texture import (ParticlePage01).
- Launchers (Mortarx1/x16, MortarWallx8, CWFW, LazerDome, WaterJet): tube N runs from effect point
  'fireworkstartNN' to 'fireworkendNN' (bones on the animated Catherine wheel).
"""
from __future__ import annotations

import glob
import io
import os
import shutil
import struct
import subprocess

from .anims import load_svd
from .container import OvlError
from .gltf import shape_to_glb
from .library import Library
from .media import sound_wav, text
from .meshes import load_shape
from .trk import Trk

LAUNCHERS = ['Mortarx1', 'Mortarx16', 'MortarWallx8', 'CWFW', 'LazerDome', 'WaterJet']


def _f2i(x: float) -> int:
    return struct.unpack('<i', struct.pack('<f', x))[0]


def _clean(v):
    if isinstance(v, (bytes, bytearray)):
        return None
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_clean(x) for x in v]
    return v


def _title(lib: Library, name: str, fallback: str) -> str:
    if name.startswith('%%'):
        h = lib.find(name[2:] + ':txt')
        if h:
            try:
                return text(h[0], h[1])
            except OvlError:
                pass
    return name if name and not name.startswith('%%') else fallback


def load_firework(lib: Library, path: str) -> dict:
    """{name, title, cost, colour, root, nodes: {id: {kind, ...fields}}} - the particle tree by object id."""
    t = Trk(open(path, 'rb').read())
    nodes, root = {}, None
    for oid, (n, v) in t.objects.items():
        if n not in ('ParticleBaseDesc', 'ParticleEmitterDesc', 'ParticleDesc'):
            continue
        d = _clean(v)
        d['kind'] = {'ParticleBaseDesc': 'base', 'ParticleEmitterDesc': 'emitter', 'ParticleDesc': 'particle'}[n]
        # drop what the editor doesn't use (live-instance lists, ref counts, the per-particle identifying colours);
        # an emitter's NumParticles is how many it releases and must stay
        for k in [k for k in d if k in ('Particles', 'RefCount') or (k.startswith('Identifying') and d['kind'] != 'base')
                  or (k == 'NumParticles' and d['kind'] != 'emitter')]:
            d.pop(k, None)
        nodes[str(oid)] = d
        if n == 'ParticleBaseDesc':
            root = str(oid)
    base = nodes[root]
    file = os.path.basename(path)
    return {'file': file, 'title': _title(lib, base.get('Name', ''), file[:-4]), 'cost': base.get('Cost'),
            'colour': [base.get('IdentifyingColourR', 1), base.get('IdentifyingColourG', 1), base.get('IdentifyingColourB', 1)],
            'root': root, 'nodes': nodes}


def list_fireworks(lib: Library) -> list[dict]:
    cache = getattr(lib, '_fireworks', None)
    if cache is None:
        cache = []
        for f in sorted(glob.glob(os.path.join(lib.root, 'Fireworks', '*.frw'))):
            try:
                d = load_firework(lib, f)
                d['custom'] = _is_created(lib, f)
                cache.append(d)
            except Exception:
                pass
        cache.sort(key=lambda d: d['title'].lower())
        lib._fireworks = cache
    return cache


def list_displays(lib: Library) -> list[dict]:
    out = []
    for f in sorted(glob.glob(os.path.join(lib.root, 'FireworkDisplays', '*.fwd'))):
        try:
            t = Trk(open(f, 'rb').read())
        except Exception:
            continue
        sids = {oid: v.get('SYMBOLNAME', '') for oid, (n, v) in t.objects.items() if n == 'SIDDatabaseEntry'}
        for oid, (n, v) in t.objects.items():
            if n != 'SavedFireworkDisplay':
                continue
            out.append({
                'file': os.path.basename(f), 'name': v.get('Name') or os.path.basename(f)[:-4],
                'music': v.get('MusicSelection', ''), 'start_minutes': v.get('StartTimeMinutes'),
                'launchers': [{'type': sids.get(s['SID'], ''), 'row': s['Row'], 'col': s['Col'], 'dir': s['Dir'],
                               'corner': s['Corner']} for s in v.get('SceneryEntries', [])],
                'entries': [{'firework': os.path.basename(e['Name'].replace('\\', '/')), 'launcher': e['SceneryEntry'],
                             'slot': e['SlotIndex'], 'time': round(e['Time'], 3), 'track': _f2i(e['Track'])}
                            for e in v.get('Entries', [])]})
    return out


def sprites(lib: Library) -> dict:
    """{psi name: {page, rect: [x0, y0, x1, y1] as fractions from the top-left}} for every particle sprite."""
    out = {}
    for n, rel in lib.index['names'].items():
        if not n.endswith(':psi'):
            continue
        h = lib.find(n)
        if not h:
            continue
        o, r = h[0], h[1]
        imp = {s: x for x, s in o.symbol_refs}
        try:
            if not o.is_pointer(r.data + 4):
                continue
            p = o.u32(r.data + 4)
            u0, v0, u1, v1 = struct.unpack('<4f', o.read(p + 4, 16))
        except OvlError:
            continue
        page = imp.get(r.data + 8, '').split(':')[0]
        out[r.name.split(':')[0]] = {'page': page, 'rect': [min(u0, u1), 1 - max(v0, v1), max(u0, u1), 1 - min(v0, v1)]}
    return out


def page_png(lib: Library, page: str, opaque: bool = False) -> bytes | None:
    """opaque: alpha dropped - for thumbnails (a 2D canvas loses the colour of alpha-0 pixels, and the game's flares
    keep their glow in RGB with alpha 0)."""
    img = lib.texture_image(page + ':tex')
    if img is None:
        return None
    if opaque:
        img = img.convert('RGB')
    b = io.BytesIO(); img.save(b, 'PNG')
    return b.getvalue()


def sound(lib: Library, name: str) -> bytes | None:
    h = lib.find(name + ':snd')
    return sound_wav(h[0], h[1]) if h else None


def launcher(lib: Library, name: str) -> tuple[bytes, dict] | None:
    """A launcher's model (GLB) and its tubes: [{slot, start, end}] in glTF space (z negated). Tubes on an animated
    launcher are bones; their names are listed so the viewer can follow them as the model animates."""
    hv = lib.find(name + ':svd')
    if not hv:
        return None
    lods = [l for l in load_svd(hv[0], hv[1]).lods if l.model.lower().endswith((':shs', ':bsh'))]
    if not lods:
        return None
    hm = lib.find_near(lods[0].model, hv[0]) or lib.find(lods[0].model)
    shape = load_shape(hm[0], hm[1])
    anims = []
    from .anims import load_ban
    for an in lods[0].animations:
        ha = lib.find_near(an, hm[0]) or lib.find(an)
        if ha:
            try:
                anims.append(load_ban(ha[0], ha[1]))
            except OvlError:
                pass
    pts = {}
    for en, m in shape.effects:
        low = en.lower()
        for kind in ('start', 'end'):
            if low.startswith('firework' + kind):
                x, y, z = (float(c) for c in m[3][:3])
                pts.setdefault(int(low[len('firework' + kind):] or 1), {})[kind] = [x, y, -z]
    tubes = [{'slot': k - 1, **v} for k, v in sorted(pts.items()) if 'start' in v and 'end' in v]
    bones = sorted({b.name for b in shape.bones if b.name.lower().startswith('firework')})
    glb = shape_to_glb(shape, lambda n: lib.texture_image(n, prefer=hm[0]), anims if shape.bones else None)
    nb = len([b for b in bones if b.lower().startswith('fireworkstart')])
    return glb, {'name': name, 'tubes': tubes, 'bone_tubes': nb, 'animated': bool(anims and shape.bones)}


def _ffmpeg() -> str | None:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which('ffmpeg')


def sound_names(lib: Library) -> list[str]:
    """Sounds a firework particle can play (the Particles OVL's: launches, bangs, crackles, mixes, whistles)."""
    try:
        o, _ = lib.open('Particles/Particles.common.ovl')
        return sorted(r.name.split(':')[0] for r in o.resources if r.loader.tag == 'snd')
    except Exception:
        return []


def music_list(lib: Library) -> list[str]:
    return sorted(os.path.basename(f) for f in glob.glob(os.path.join(lib.root, 'Music', '*.wma'))
                  if 'ambient' not in os.path.basename(f).lower())


def music(lib: Library, name: str) -> bytes | None:
    """The game's .wma music as Ogg Vorbis (browsers can't play WMA), converted once and cached in ~/.rct3ovl."""
    src = os.path.join(lib.root, 'Music', os.path.basename(name))
    if not os.path.exists(src):
        return None
    dst = os.path.join(lib.cache_dir, 'music', os.path.basename(name)[:-4] + '.ogg')
    if not os.path.exists(dst):
        ff = _ffmpeg()
        if not ff:
            return None
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        r = subprocess.run([ff, '-y', '-v', 'error', '-i', src, '-c:a', 'libvorbis', '-q:a', '4', dst + '.tmp.ogg'],
                           capture_output=True)
        if r.returncode:
            return None
        os.replace(dst + '.tmp.ogg', dst)
    return open(dst, 'rb').read()


# ---- lasers, water jets, laser drawings ---------------------------------------------------------------------------
# .las (LaserDesc / LaserBaseDesc): Name, Duration, Power (beam length, m), NumBeams, RenderType (0 cone of light,
# 1 plane of light, 2 persisting image), TrailDuration (afterglow, s), ImageSpread (image scale), LaserWord -> letters
# (drawn frames) and four Blenders - Colour (ARGB), Elevation (rad above the horizon), RotVel (rad/s), Spread (beam
# width). .wjt (WaterJetDesc / WaterJetBaseDesc): Name, Duration, Type, Blenders Pressure (m/s), Elevation (rad
# from vertical), DiameterDelta (nozzle size) and Colour. A Blender holds 20 FixedPts {BlenderElement, PointTime} of
# which NumPts are used; the rest repeat an element with time 0xCDCDCDCD. DurationTransform: points scale with the
# duration. .lwr: a LaserWritingLetter alone (64-byte header): DragPoints {X, Y}, SolidConnection (1 = beam on from
# the previous point), Duration, Preview (64x64 image).
UNUSED_TIME = struct.unpack('<f', bytes([0xCD] * 4))[0]


def _argb(c: int) -> list[float]:
    u = c & 0xFFFFFFFF
    return [((u >> 16) & 255) / 255, ((u >> 8) & 255) / 255, (u & 255) / 255, (u >> 24) / 255]


def _unargb(c) -> int:
    r, g, b, a = (max(0, min(255, round(x * 255))) for x in c)
    u = (a << 24) | (r << 16) | (g << 8) | b
    return u - (1 << 32) if u >= 1 << 31 else u


def _blender(O, bid) -> dict:
    bl = O.get(bid, ('', {}))[1]
    pts = []
    for p in (bl.get('FixedPts') or [])[:bl.get('NumPts', 0)]:
        ev = O.get(p['BlenderElement'], ('', {}))[1]
        pts.append({'t': round(p['PointTime'], 4), 'v': _argb(ev['Colour']) if 'Colour' in ev else ev.get('Float', 0.0)})
    pts.sort(key=lambda x: x['t'])
    return {'scale': bool(bl.get('DurationTransform')), 'max': bl.get('MaxTime', 0), 'pts': pts}


def _letter(v) -> dict:
    n = v.get('NumPts', 0)
    sc = v.get('SolidConnection') or b''
    return {'duration': v.get('Duration', 1), 'points': [[round(p['X'], 3), round(p['Y'], 3)] for p in v.get('DragPoints', [])[:n]],
            'solid': [sc[i] if i < len(sc) else 1 for i in range(n)]}


def _effect_file(path: str, kind: str) -> dict | None:
    t = Trk(open(path, 'rb').read())
    O = t.objects
    main = next(((oid, n, v) for oid, (n, v) in O.items() if n.endswith('Desc')), None)
    if not main:
        return None
    _, n, v = main
    d = {'file': os.path.basename(path), 'name': v.get('Name') or os.path.basename(path)[:-4], 'kind': kind,
         'duration': v.get('Duration', 5)}
    if kind == 'laser':
        word = O.get(v.get('LaserWord'), ('', {}))[1]
        d.update({'render': v.get('RenderType', 0), 'power': v.get('Power', 100), 'beams': v.get('NumBeams', 1),
                  'trail': v.get('TrailDuration', 0.03), 'image_scale': v.get('ImageSpread', 10),
                  'colour': _blender(O, v.get('ColourBlender')), 'elevation': _blender(O, v.get('ElevationBlender')),
                  'rotvel': _blender(O, v.get('RotVelBlender')), 'width': _blender(O, v.get('SpreadBlender')),
                  'images': [_letter(O[i][1]) for i in word.get('Letters', []) if i in O]})
    else:
        d.update({'type': v.get('Type', 1), 'colour': _blender(O, v.get('ColourBlender')),
                  'elevation': _blender(O, v.get('ElevationBlender')), 'pressure': _blender(O, v.get('PressureBlender')),
                  'radius': _blender(O, v.get('DiameterDeltaBlender'))})
    return d


def list_effects(lib: Library, kind: str) -> list[dict]:
    folder, ext = {'laser': ('Lasers', 'las'), 'jet': ('WaterJets', 'wjt')}[kind]
    out = []
    for f in sorted(glob.glob(os.path.join(lib.root, folder, '*.' + ext))):
        try:
            d = _effect_file(f, kind)
        except Exception:
            d = None
        if d:
            d['custom'] = _is_created(lib, f)
            if kind == 'laser':
                h = lib.find('LaserName_' + os.path.basename(f)[:-4] + ':txt')
                if h:
                    try:
                        d['name'] = text(h[0], h[1]) or d['name']
                    except OvlError:
                        pass
            out.append(d)
    return out


def list_drawings(lib: Library) -> list[dict]:
    out = []
    for f in sorted(glob.glob(os.path.join(lib.root, 'LaserWriting', '*.lwr'))):
        try:
            t = Trk(open(f, 'rb').read(), start=64)
            v = next(v for n, v in t.objects.values() if n == 'LaserWritingLetter')
            out.append({'file': os.path.basename(f), 'name': os.path.basename(f)[:-4], **_letter(v)})
        except Exception:
            pass
    return out


# ---- writing game files ----------------------------------------------------------------------------------------------
# New files are built from one of the game's own files of the same kind (its header, schema and trailer kept), so
# they load like the originals; tests/trk_roundtrip.py checks the writer reproduces every shipped file byte for byte.
TEMPLATES = {'frw': ('Fireworks', 'GreenPeony.frw'), 'las': ('Lasers', 'CrabLaser.las'),
             'wjt': ('WaterJets', 'MultiSpurt.wjt'), 'fwd': ('FireworkDisplays', 'Stratosphere.fwd')}
FOLDERS = {'frw': 'Fireworks', 'las': 'Lasers', 'wjt': 'WaterJets', 'fwd': 'FireworkDisplays'}
EXT = {'frw': '.frw', 'las': '.las', 'wjt': '.wjt', 'fwd': '.fwd'}


def _template(lib: Library, kind: str) -> Trk:
    folder, name = TEMPLATES[kind]
    return Trk(open(os.path.join(lib.root, folder, name), 'rb').read())


def _defaults(t: Trk) -> dict:
    out = {}
    for n, v in t.objects.values():
        out.setdefault(n, v)
    return out


class _Ids:
    def __init__(self, start=900000):
        self.n = start

    def __call__(self):
        self.n += 1
        return self.n


def build_frw(lib: Library, fw: dict) -> bytes:
    """A .frw from the editor's firework {title, cost, colour, root, nodes: {id: {kind, ...fields}}}."""
    t = _template(lib, 'frw')
    D = _defaults(t)
    kinds = {'base': 'ParticleBaseDesc', 'emitter': 'ParticleEmitterDesc', 'particle': 'ParticleDesc'}
    nodes = {str(k): v for k, v in fw['nodes'].items()}
    ids, new = {}, _Ids()
    for k in nodes:
        ids[k] = int(k) if k.isdigit() and int(k) < 2 ** 62 else new()
    objs, seen = [], set()

    def add(k):
        k = str(k)
        if k in seen or k not in nodes:
            return
        seen.add(k)
        n = nodes[k]
        typ = kinds[n['kind']]
        v = dict(D[typ])
        v.update({f: x for f, x in n.items() if f in D[typ] and f not in ('ParticleEmitterDescs', 'ParticleDesc', 'Particles')})
        if typ == 'ParticleEmitterDesc':
            v['ParticleDesc'] = ids.get(str(n.get('ParticleDesc')), 0)
        else:
            v['ParticleEmitterDescs'] = [ids[str(e)] for e in n.get('ParticleEmitterDescs', []) if str(e) in ids]
            v['Particles'] = []
        v['RefCount'] = 1 if typ == 'ParticleBaseDesc' else 2
        if typ == 'ParticleBaseDesc':
            # the node's own fields win (Name may be a translated '%%FireworkNameNN'); the summary fills gaps
            if 'Name' not in n:
                v['Name'] = fw.get('title') or v.get('Name', '')
            if 'Cost' not in n and fw.get('cost') is not None:
                v['Cost'] = int(fw['cost'])
            if 'IdentifyingColourR' not in n and fw.get('colour'):
                for c, x in zip('RGB', fw['colour']):
                    v['IdentifyingColour' + c] = float(x)
                    v['IdentifyingColourDark' + c] = float(x) * 0.75
        objs.append((typ, ids[k], v))
        kids = [n.get('ParticleDesc')] if typ == 'ParticleEmitterDesc' else n.get('ParticleEmitterDescs', [])
        for e in kids:
            add(e)
    add(fw['root'])
    return t.dump(objs)


def _blender_objs(D, bl: dict, colour: bool, new) -> tuple[int, list]:
    """A Blender object and its element objects from {scale, max, pts: [{t, v}]}."""
    pts = sorted(bl.get('pts') or [], key=lambda p: p['t'])[:20] or [{'t': 0, 'v': [1, 1, 1, 1] if colour else 0.0}]
    objs, els = [], []
    for p in pts:
        eid = new()
        if colour:
            objs.append(('ColourBlenderElement', eid, {'Colour': _unargb(p['v'])}))
        else:
            objs.append(('FloatBlenderElement', eid, {'Float': float(p['v'])}))
        els.append((p['t'], eid))
    fixed = [{'BlenderElement': e, 'PointTime': float(tm)} for tm, e in els]
    fixed += [{'BlenderElement': els[-1][1], 'PointTime': UNUSED_TIME}] * (20 - len(fixed))
    bid = new()
    v = dict(D['Blender'])
    v.update({'DurationTransform': int(bool(bl.get('scale'))), 'FixedPts': fixed, 'MaxTime': float(bl.get('max') or 0),
              'NumPts': len(els)})
    return bid, [('Blender', bid, v)] + objs


def build_effect(lib: Library, d: dict) -> bytes:
    """A .las (d['kind'] == 'laser') or .wjt from the editor's effect description."""
    laser = d['kind'] == 'laser'
    t = _template(lib, 'las' if laser else 'wjt')
    D = _defaults(t)
    new = _Ids()
    main_type = next(n for n in D if n.endswith('Desc'))
    v = dict(D[main_type])
    v['Name'] = d.get('name', 'My effect')
    v['Duration'] = float(d.get('duration', 5))
    after = []
    keys = [('ColourBlender', 'colour', True), ('ElevationBlender', 'elevation', False)]
    keys += [('RotVelBlender', 'rotvel', False), ('SpreadBlender', 'width', False)] if laser else \
        [('PressureBlender', 'pressure', False), ('DiameterDeltaBlender', 'radius', False)]
    for field, key, colour in keys:
        bl = dict(d.get(key) or {})
        bl['max'] = v['Duration']
        bid, o = _blender_objs(D, bl, colour, new)
        v[field] = bid
        after += o
    if laser:
        v.update({'Power': float(d.get('power', 100)), 'NumBeams': int(d.get('beams', 1)), 'RenderType': int(d.get('render', 0)),
                  'TrailDuration': float(d.get('trail', 0.03)), 'ImageSpread': float(d.get('image_scale', 10))})
        wid, letters, lets = new(), [], []
        tmpl = D['LaserWritingLetter']
        for im in d.get('images') or []:
            lid = new()
            drag = [{'X': float(x), 'Y': float(y)} for x, y in (im.get('points') or [])][:1022]
            solid = bytes(int(bool(s)) for s in (im.get('solid') or [1] * len(drag)))[:len(drag)]
            lv = dict(tmpl)
            lv.update({'DragPoints': drag + [{'X': 0.0, 'Y': 0.0}] * (len(tmpl['DragPoints']) - len(drag)),
                       'NumPts': len(drag), 'SolidConnection': solid.ljust(len(tmpl['SolidConnection']), bytes(1)),
                       'Duration': float(im.get('duration', 1)), 'Preview': bytes(len(tmpl.get('Preview') or b''))})
            letters.append(lid)
            lets.append(('LaserWritingLetter', lid, lv))
        v['LaserWord'] = wid
        after = [('LaserWritingWord', wid, {'LetterNames': [''] * len(letters), 'Letters': letters})] + after + lets
    else:
        v['Type'] = int(d.get('type', 1))
    return t.dump([(main_type, new(), v)] + after)


def build_fwd(lib: Library, show: dict) -> bytes:
    """A .fwd from the editor's show: fireworks only (the game's display format here has no lasers, water jets,
    aiming, landscape or colour/strength changes), launchers of the types it lists."""
    t = _template(lib, 'fwd')
    D = _defaults(t)
    new = _Ids()
    names = lib.index['names']
    sid_ids, objs = {}, []
    for l in show.get('launchers', []):
        typ = l['type']
        if typ not in sid_ids:
            rel = names.get(typ.lower() + ':sid', 'Style\\Vanilla\\Style.common.ovl')
            sid_ids[typ] = new()
            objs.append(('SIDDatabaseEntry', sid_ids[typ], dict(D['SIDDatabaseEntry'], SYMBOLNAME=typ,
                                                                OVERLAYFILENAME=rel.rsplit('.common.ovl', 1)[0])))
    scen0 = D['SavedFireworkDisplay']['SceneryEntries'][0]
    scen = [dict(scen0, Row=int(l.get('row', 0)), Col=int(l.get('col', 0)), Dir=int(l.get('dir', 0)) & 3,
                 Corner=int(l.get('corner', -1)), SID=sid_ids[l['type']]) for l in show.get('launchers', [])]
    entries = [{'Name': 'Fireworks\\' + e['firework'], 'SceneryEntry': int(e['launcher']), 'SlotIndex': int(e.get('slot', 0)),
                'Time': float(e['time']), 'Track': struct.unpack('<f', struct.pack('<i', int(e.get('track', 0))))[0]}
               for e in sorted(show.get('entries', []), key=lambda e: e['time'])
               if e.get('kind', 'firework') == 'firework' and e.get('firework')]
    v = dict(D['SavedFireworkDisplay'], Name=show.get('name') or 'MixMaster Display', MusicSelection=show.get('music') or '',
             StartTimeMinutes=int(show.get('start_minutes', 1260)), MonthMask=int(show.get('months', 65535)),
             SceneryEntries=scen, Entries=entries)
    return t.dump([('SavedFireworkDisplay', new(), v)] + objs)


def build(lib: Library, kind: str, data: dict) -> bytes:
    if kind == 'frw':
        return build_frw(lib, data)
    if kind in ('las', 'wjt'):
        return build_effect(lib, dict(data, kind='laser' if kind == 'las' else 'jet'))
    if kind == 'fwd':
        return build_fwd(lib, data)
    raise OvlError('unknown kind ' + kind)


def _manifest_path(lib: Library) -> str:
    return os.path.join(lib.cache_dir, 'created_files.json')


def _created(lib: Library) -> set:
    import json
    try:
        return set(json.load(open(_manifest_path(lib))))
    except Exception:
        return set()


def _is_created(lib: Library, path: str) -> bool:
    return os.path.normcase(os.path.abspath(path)) in _created(lib)


def save_to_game(lib: Library, kind: str, filename: str, data: dict) -> str:
    """Write a built file into the game folder (Fireworks, Lasers, WaterJets, FireworkDisplays). Files the game
    shipped (anything not written by this tool) are never overwritten. -> the path written."""
    import json
    import re
    base = re.sub(r'[^\w \-()]+', '', os.path.basename(filename).rsplit('.', 1)[0]).strip()[:60] or 'My ' + kind
    path = os.path.join(lib.root, FOLDERS[kind], base + EXT[kind])
    key = os.path.normcase(os.path.abspath(path))
    made = _created(lib)
    if os.path.exists(path) and key not in made:
        raise OvlError(f"{os.path.basename(path)} is one of the game's own files: choose another name")
    blob = build(lib, kind, data)
    Trk(blob)                                               # must parse back
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + '.tmp', 'wb') as fh:
        fh.write(blob)
    os.replace(path + '.tmp', path)
    made.add(key)
    json.dump(sorted(made), open(_manifest_path(lib), 'w'))
    lib.__dict__.pop('_fireworks', None)
    return path
