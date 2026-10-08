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
                cache.append(load_firework(lib, f))
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


def page_png(lib: Library, page: str) -> bytes | None:
    img = lib.texture_image(page + ':tex')
    if img is None:
        return None
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
