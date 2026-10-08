"""Scenery: every placeable scenery item (sid) -> visual (svd) -> highest-detail model (shs/bsh) + its bone animations.

Two sid layouts exist. Most use the RCT3 Importer's layout (structs.load_sid: type at word 18). The base game's
Style\\Vanilla\\Scenery.common.ovl items use an older, shorter one: no position/box floats, cost at word 9, type at
word 12, numbered like SID_TYPES except 6 (all path extras) and one lower from 19 up. Both import their visual
(svd) and name (txt) directly, so those are taken from the imports. Ride track, rides, supports and paths have
their own tabs or aren't scenery and are left out.

Resolving ~3,400 items takes minutes, so the list is cached next to the library index (~/.rct3ovl).
"""
from __future__ import annotations

import json
import os
import struct

from .anims import load_ban, load_svd
from .container import OvlError
from .gltf import shape_to_glb
from .library import Library
from .media import text
from .meshes import load_shape
from .rides import _group, _imports, _short
from .structs import SID_TYPES, load_sid

CACHE_VERSION = 2

# sid type -> category shown in the viewer (None: not scenery)
CATEGORY = {
    'tree': 'Trees & plants', 'plant': 'Trees & plants', 'shrub': 'Trees & plants', 'flowers': 'Trees & plants',
    'fence': 'Fences', 'keep clear fence': 'Fences',
    'wall misc': 'Walls & roofs', 'wall straight': 'Walls & roofs', 'wall roof': 'Walls & roofs',
    'wall corner': 'Walls & roofs',
    'path lamp': 'Path extras', 'litter bin': 'Path extras', 'bench': 'Path extras', 'sign': 'Path extras',
    'photo point': 'Path extras',
    'scenery small': 'Scenery', 'scenery medium': 'Scenery', 'scenery large': 'Scenery', 'scenery misc': 'Scenery',
    'animatronic': 'Animatronics', 'ride event': 'Ride events', 'stall': 'Shops & stalls',
    'park entrance': 'Entrances & exits', 'ride entrance': 'Entrances & exits', 'ride exit': 'Entrances & exits',
    'pool piece': 'Pools & water', 'pool extra': 'Pools & water', 'changing room': 'Pools & water',
    'water cannon': 'Pools & water', 'water jet': 'Pools & water',
    'terrain piece': 'Terrain', 'animal fence': 'Enclosures', 'animal misc': 'Enclosures',
    'firework': 'Effects & fireworks', 'particle effect': 'Effects & fireworks', 'laser dome': 'Effects & fireworks',
}
CATEGORY_ORDER = ['Trees & plants', 'Scenery', 'Animatronics', 'Walls & roofs', 'Fences', 'Path extras',
                  'Shops & stalls', 'Entrances & exits', 'Ride events', 'Pools & water', 'Enclosures', 'Terrain',
                  'Effects & fireworks']


def _sid_type(o, r) -> tuple[str, int | None]:
    """(type name, cost in cents) for either sid layout."""
    v = struct.unpack('<31I', o.read(r.data, 124))
    if v[12] < 64:                                       # old base-game layout
        t = v[12]
        name = 'path lamp' if t == 6 else (SID_TYPES[t] if t <= 18 else SID_TYPES[t + 1] if t + 1 < len(SID_TYPES) else str(t))
        return name, v[9]
    d = load_sid(o, r)
    cost = d['cost']
    return str(d['type']), cost


def _resolve(lib: Library, sid: str) -> dict | None:
    h = lib.find(sid)
    if not h:
        return None
    o, r = h[0], h[1]
    typ, cost = _sid_type(o, r)
    cat = CATEGORY.get(typ)
    if not cat:
        return None
    imps = _imports(o, r)
    title = ''
    txt = next((i for i in imps if i.lower().endswith(':txt')), None)
    ht = lib.find(txt) if txt else None
    if ht:
        try:
            title = text(ht[0], ht[1])
        except OvlError:
            pass
    visuals = [i for i in imps if i.lower().endswith(':svd')]
    if not visuals:
        try:
            visuals = [v for v in load_sid(o, r)['visuals'] if v]
        except Exception:
            visuals = []
    visuals = visuals or [sid.split(':')[0] + ':svd']
    for vis in visuals:
        hv = lib.find_near(vis, o) or lib.find(vis)
        if not hv:
            continue
        lods = [l for l in load_svd(hv[0], hv[1]).lods if l.model.lower().endswith((':bsh', ':shs'))]
        if not lods:
            continue
        hm = lib.find_near(lods[0].model, hv[0]) or lib.find(lods[0].model)
        if not hm:
            continue
        return {'name': sid, 'title': title or sid.split(':')[0], 'type': typ, 'category': cat,
                'theme': _theme(lib, sid, lods[0].model, vis),
                'cost': cost, 'visual': vis, 'model': lods[0].model, 'animations': list(lods[0].animations),
                'icon': next((i for i in imps if i.lower().endswith(':gsi')), '')}
    return None


def _theme(lib, *names) -> str:
    """Standard / Wild! / Soaked! / Themed: X, from wherever the item, its model or its visual lives (the expansion
    packs define their items under Style/Vanilla/Safari or CapeTyphoon but may keep models elsewhere)."""
    idx = lib.index['names']
    for n in names:
        g = _group(idx.get(n.lower(), ''))
        if g != 'Standard':
            return g.replace('Themed: IslandParadise', 'Themed: Island Paradise').replace('Themed: WildWest', 'Themed: Wild West')
    return 'Standard'


def _cache_path(lib: Library) -> str:
    return lib._index_path().replace('index_', f'scenery{CACHE_VERSION}_')


def list_scenery(lib: Library) -> list[dict]:
    cache = getattr(lib, '_scenery', None)
    if cache is not None:
        return cache
    p = _cache_path(lib)
    stamp = os.path.getmtime(lib._index_path()) if os.path.exists(lib._index_path()) else 0
    try:
        saved = json.load(open(p, encoding='utf-8'))
        if saved.get('stamp') == stamp:
            lib._scenery = saved['items']
            return lib._scenery
    except Exception:
        pass
    out = []
    for n in sorted(k for k in lib.index['names'] if k.endswith(':sid')):
        try:
            d = _resolve(lib, n)
        except Exception:                               # one broken record shouldn't hide the rest
            d = None
        if d:
            out.append(d)
    out.sort(key=lambda d: (CATEGORY_ORDER.index(d['category']), d['theme'] != 'Standard', d['theme'], d['title'].lower()))
    try:
        json.dump({'stamp': stamp, 'items': out}, open(p, 'w', encoding='utf-8'))
    except OSError:
        pass
    lib._scenery = out
    return out


def build_scenery(lib: Library, name: str) -> tuple[bytes, dict] | None:
    d = next((s for s in list_scenery(lib) if s['name'].lower() == name.lower()), None) or _resolve(lib, name)
    if not d:
        return None
    hv = lib.find(d['visual'])
    hm = (lib.find_near(d['model'], hv[0]) if hv else None) or lib.find(d['model'])
    if not hm:
        return None
    shape = load_shape(hm[0], hm[1])
    anims = []
    for an in d['animations']:
        ha = lib.find_near(an, hm[0]) or lib.find(an)
        if ha:
            try:
                anims.append(load_ban(ha[0], ha[1]))
            except OvlError:
                pass
    for a, short in zip(anims, _short([a.name.split(':')[0] for a in anims])):
        a.name = short[:1].upper() + short[1:]
    glb = shape_to_glb(shape, lambda n: lib.texture_image(n, prefer=hm[0]), anims if shape.bones else None)
    info = dict(d, animations=[a.name for a in anims] if shape.bones else [],
                textures=sorted({m.texture for m in shape.meshes if m.texture}), bones=len(shape.bones))
    return glb, info
