"""Thrill rides (flat rides, 'anr'): ride record -> scenery item (sid) -> visual (svd) -> the highest-detail model
(bsh/shs) and the bone animations (ban) that visual lists for it (typically Static, Start, Loop, Stop)."""
from __future__ import annotations

import os

from .anims import load_ban, load_svd
from .container import OvlError
from .gltf import shape_to_glb
from .library import Library
from .media import text
from .meshes import load_shape
from .structs import load_sid

# Style\<...> folder -> group shown in the viewer
_THEMES = {'vanilla': 'Standard', 'safari': 'Wild!', 'capetyphoon': 'Soaked!'}


def _imports(o, r) -> list[str]:
    starts = sorted({x.data for x in o.resources if x.data > r.data})
    end = starts[0] if starts else r.data + 4096
    return [n for n, s in sorted(o.symbol_refs, key=lambda x: x[1]) if r.data <= s < end]


def _group(rel: str) -> str:
    parts = rel.replace('/', '\\').lower().split('\\')
    if len(parts) > 2 and parts[1] == 'themed':
        return 'Themed: ' + rel.replace('/', '\\').split('\\')[2]
    if len(parts) > 2 and parts[1] == 'vanilla' and parts[2] in _THEMES:
        return _THEMES[parts[2]]
    return 'Standard'


def _resolve(lib: Library, anr: str) -> dict | None:
    h = lib.find(anr)
    if not h:
        return None
    imps = _imports(h[0], h[1])
    sid = next((i for i in imps if i.lower().endswith(':sid')), None)
    txt = next((i for i in imps if i.lower().endswith(':txt')), None)
    ht = lib.find(txt) if txt else None
    try:
        title = text(ht[0], ht[1]) if ht else ''
    except OvlError:
        title = ''
    model, anims = None, []
    hs = lib.find(sid) if sid else None
    if hs:
        visuals = load_sid(hs[0], hs[1])['visuals']
        # the standard rides' scenery items (Style\Vanilla\Scenery) list no visuals; the visual has the same name
        # and sits in the ride's own folder (chairswing:sid -> Style\Vanilla\Rides\ChairSwing\chairswing:svd)
        visuals = [v for v in visuals if v] or [sid.split(':')[0] + ':svd']
        for vis in visuals:
            hv = lib.find(vis) if vis else None
            if not hv:
                continue
            lods = [l for l in load_svd(hv[0], hv[1]).lods if l.model.lower().endswith((':bsh', ':shs'))]
            if lods:
                model, anims = lods[0].model, list(lods[0].animations)
                break
    return {'name': anr, 'title': title or anr.split(':')[0], 'group': _group(lib.index['names'].get(anr.lower(), '')),
            'scenery_item': sid or '', 'model': model or '', 'animations': anims}


def list_rides(lib: Library) -> list[dict]:
    cache = getattr(lib, '_rides', None)
    if cache is None:
        cache = []
        for n in sorted(k for k in lib.index['names'] if k.endswith(':anr')):
            try:
                d = _resolve(lib, n)
            except Exception:                           # one broken record shouldn't hide the rest
                d = None
            if d and d['model']:
                cache.append(d)
        lib._rides = cache
    return cache


def track_sets(lib: Library) -> list[dict]:
    """Which track pieces each tracked ride (trr: coasters, tracked rides) is built from, and where they live.
    The ride record lists its pieces by name (Medcurve:tks, Straight:tks…) - names many coasters share - and
    some records name their track OVL ('../Track1/Track1'); for the rest, the track OVL holding all their
    pieces is found by matching names (Stormrunner needs two). -> [{ride, title, folder, pieces: [(ovl, name)]}]"""
    cache = getattr(lib, '_track_sets', None)
    if cache is not None:
        return cache
    names = lib.index['names']
    holders = {}
    for ov in lib.index['ovls']:
        if ov.get('counts', {}).get('tks'):
            try:
                o, _ = lib.open(ov['path'])
            except Exception:
                continue
            holders[ov['path']] = {r.name.lower(): r.name for r in o.by_tag('tks')}
    out = []
    for t in sorted(k for k in names if k.endswith(':trr')):
        h = lib.find(t)
        if not h:
            continue
        o, r = h[0], h[1]
        imps = _imports(o, r)
        want = list(dict.fromkeys(x.lower() for x in imps if x.lower().endswith(':tks')))
        if not want:
            continue
        own = os.path.dirname(names[t])
        first = None
        for i in range(0, 0x400, 4):
            try:
                if o.is_pointer(r.data + i):
                    s = o.str_field(r.data + i)
                    if '/' in s and 'track' in s.lower():
                        first = os.path.normpath(os.path.join(own, s)) + '.common.ovl'
                        break
            except OvlError:
                pass
        chosen, left, pool = [], set(want), list(holders)
        if first:
            first = next((k for k in holders if k.lower() == first.lower()), None)
        if not first:
            # a style whose pieces are split over several OVLs of one track folder (Stormrunner: Track9 +
            # Track9_CT) beats a big shared set holding most of the names in another style (Track5's
            # Straight2Steepslope is a tile shorter): use the folder that holds every piece, the smallest such
            folders = {}
            for k in holders:
                folders.setdefault(os.path.dirname(k).lower(), []).append(k)
            whole = [ks for ks in folders.values() if not left - set().union(*(holders[k].keys() for k in ks))]
            if whole:
                best = min(whole, key=lambda ks: sum(len(holders[k]) for k in ks))
                first, pool = max(best, key=lambda k: len(left & holders[k].keys())), best
        while left:
            pick = first if first and first not in chosen else max(
                (k for k in pool if k not in chosen), key=lambda k: (len(left & holders[k].keys()), -len(holders[k])),
                default=None)
            first = None
            if not pick or not left & holders[pick].keys():
                break
            chosen.append(pick)
            left -= holders[pick].keys()
        pieces = []
        for n in want:
            src = next((c for c in chosen if n in holders[c]), None)
            if src:
                pieces.append((src, holders[src][n]))
        ht = None
        txt = next((i for i in imps if i.lower().endswith(':txt') and 'name' in i.lower()), None)
        if txt:
            ht = lib.find(txt)
        try:
            title = text(ht[0], ht[1]) if ht else ''
        except OvlError:
            title = ''
        out.append({'ride': t, 'title': title or t.split(':')[0], 'folder': own, 'track_ovls': chosen,
                    'pieces': pieces, 'missing': sorted(left)})
    lib._track_sets = out
    return out


def _short(names: list[str]) -> list[str]:
    """pirateshipstart, pirateshiploop -> start, loop (drop the shared prefix)."""
    if len(names) < 2:
        return names
    p = os.path.commonprefix([n.lower() for n in names])
    return [n[len(p):] or n for n in names]


def build_ride(lib: Library, name: str) -> tuple[bytes, dict] | None:
    d = next((r for r in list_rides(lib) if r['name'].lower() == name.lower()), None) or _resolve(lib, name)
    if not d or not d['model']:
        return None
    hm = lib.find(d['model'])
    if not hm:
        return None
    shape = load_shape(hm[0], hm[1])
    anims = []
    for an in d['animations']:
        ha = lib.find(an)
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
