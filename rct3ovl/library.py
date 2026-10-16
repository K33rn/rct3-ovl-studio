"""Game-wide index: which OVL pair holds each named resource (textures are usually shared across OVLs)."""
from __future__ import annotations

import json
import os
from collections import OrderedDict

from .container import Ovl, pair_paths
from .textures import TextureSet

INDEX_VERSION = 3


def find_pairs(root: str) -> list[str]:
    return sorted({pair_paths(os.path.join(dp, f))[0]
                   for dp, _, fs in os.walk(root) for f in fs if f.lower().endswith('.ovl')})


def _mtime(common: str) -> float:
    """When an OVL pair last changed (the later of its two files)."""
    return max((os.path.getmtime(p) for p in pair_paths(common) if os.path.exists(p)), default=0)


class Library:
    """Lazily opens OVLs; resolves 'name:tag' to (Ovl, LoaderRef) across the whole game folder."""

    def __init__(self, root: str, cache_dir: str | None = None, max_open: int = 64):
        self.root = os.path.abspath(root)
        self.cache_dir = cache_dir or os.path.join(os.path.expanduser('~'), '.rct3ovl')
        os.makedirs(self.cache_dir, exist_ok=True)
        self._open: OrderedDict[str, tuple[Ovl, TextureSet | None]] = OrderedDict()
        self.max_open = max_open
        self.index: dict = self._load_index()
        self.refresh_index()        # OVLs (folders, mods) added or changed since the cached index was made

    # ---- index ---------------------------------------------------------------------------------------------
    def _index_path(self) -> str:
        key = ''.join(c if c.isalnum() else '_' for c in self.root)[-80:]
        return os.path.join(self.cache_dir, f'index_{key}.json')

    def _load_index(self) -> dict:
        p = self._index_path()
        if os.path.exists(p):
            try:
                idx = json.load(open(p))
                if idx.get('version') == INDEX_VERSION and idx.get('root') == self.root and \
                        idx.get('language') == os.environ.get('RCT3OVL_LANGUAGE', 'English').lower():
                    return idx
            except Exception:
                pass
        return self.rebuild_index()

    def rebuild_index(self) -> dict:
        ovls, names = [], {}
        # gui\<Language>.common.ovl all define the same text names: index the chosen language first so that
        # names resolve to it (other languages stay listed and openable)
        lang = os.environ.get('RCT3OVL_LANGUAGE', 'English').lower()

        def order(p):
            rel = os.path.relpath(p, self.root).lower()
            is_lang = rel.startswith('gui' + os.sep) and rel.count(os.sep) == 1
            return (is_lang and not os.path.basename(rel).startswith(lang), p)
        for base in sorted(find_pairs(self.root), key=order):
            rel = os.path.relpath(base, self.root)
            try:
                o = Ovl(base)
            except Exception as e:
                ovls.append({'path': rel, 'error': str(e)})
                continue
            counts = {}
            for r in o.resources:
                counts[r.loader.tag] = counts.get(r.loader.tag, 0) + 1
                if r.name:
                    names.setdefault(r.name.lower(), rel)
            ovls.append({'path': rel, 'version': o.version, 'counts': counts, 'mtime': _mtime(base)})
        idx = {'version': INDEX_VERSION, 'root': self.root, 'language': lang, 'ovls': ovls, 'names': names}
        json.dump(idx, open(self._index_path(), 'w'))
        return idx

    def refresh_index(self) -> dict:
        """Catch up with the game folder: OVLs added (new folders, mods) or changed since the index was built are
        read, removed ones dropped; the rest is kept as it is. {'added': [rel], 'removed': [rel], 'changed': [rel]}.
        Anything built from the old contents (ride, scenery, firework lists...) is rebuilt on its next use."""
        idx = self.index
        have = {o['path']: o for o in idx['ovls']}
        now = {os.path.relpath(b, self.root): b for b in find_pairs(self.root)}
        removed = [p for p in have if p not in now]
        changed = [p for p in now if p in have and have[p].get('mtime') not in (None, _mtime(now[p]))]
        added = [p for p in now if p not in have]
        for p in now:      # entries from before mtimes were kept: take the file as it is now
            if p in have and have[p].get('mtime') is None:
                have[p]['mtime'] = _mtime(now[p])
        if not (added or removed or changed):
            return {'added': [], 'removed': [], 'changed': []}
        gone = set(removed) | set(changed)
        idx['names'] = {n: rel for n, rel in idx['names'].items() if rel not in gone}
        idx['ovls'] = [o for o in idx['ovls'] if o['path'] not in gone]
        for p in sorted(changed + added):
            try:
                o = Ovl(now[p])
            except Exception as e:
                idx['ovls'].append({'path': p, 'error': str(e), 'mtime': _mtime(now[p])})
                continue
            counts = {}
            for r in o.resources:
                counts[r.loader.tag] = counts.get(r.loader.tag, 0) + 1
                if r.name:
                    idx['names'].setdefault(r.name.lower(), p)
            idx['ovls'].append({'path': p, 'version': o.version, 'counts': counts, 'mtime': _mtime(now[p])})
        idx['ovls'].sort(key=lambda o: o['path'].lower())
        for p in gone:
            self._open.pop(pair_paths(os.path.join(self.root, p))[0], None)
        for k in [k for k in vars(self) if k.startswith('_') and k != '_open']:   # lists built from the old contents
            delattr(self, k)
        json.dump(idx, open(self._index_path(), 'w'))
        return {'added': added, 'removed': removed, 'changed': changed}

    # ---- access --------------------------------------------------------------------------------------------
    def open(self, rel_or_abs: str) -> tuple[Ovl, TextureSet]:
        path = rel_or_abs if os.path.isabs(rel_or_abs) else os.path.join(self.root, rel_or_abs)
        key = pair_paths(path)[0]
        if key in self._open:
            self._open.move_to_end(key)
            o, ts = self._open[key]
        else:
            o, ts = Ovl(key), None
            self._open[key] = (o, ts)
            while len(self._open) > self.max_open:
                self._open.popitem(last=False)
        if ts is None:
            ts = TextureSet(o)
            self._open[key] = (o, ts)
        return o, ts

    def find(self, name: str, prefer: Ovl | None = None):
        """'marble:ftx' -> (Ovl, LoaderRef, TextureSet) or None. Looks in `prefer` first."""
        lname = name.lower()
        if prefer is not None:
            for r in prefer.resources:
                if r.name.lower() == lname:
                    return prefer, r, self.open(prefer.files[0].path)[1]
        rel = self.index['names'].get(lname)
        if not rel:
            return None
        o, ts = self.open(rel)
        for r in o.resources:
            if r.name.lower() == lname:
                return o, r, ts
        return None

    def find_near(self, name: str, ovl: Ovl):
        """Like find(), but looks in `ovl`, then in the other OVLs of the same folder (then in its subfolders), before
        the whole game.
        Track styles reuse names (every coaster has a Medcurve): tracks\\coasters\\Track2 keeps each piece's
        visual and model in its own Medcurve_data OVL next to Track2.common.ovl, and the game resolves there."""
        hit = self.find(name, prefer=ovl)
        if hit and hit[0] is ovl:
            return hit
        folder = os.path.dirname(os.path.relpath(ovl.files[0].path, self.root)).lower()
        cache = self.__dict__.setdefault('_folder_names', {})
        names = cache.get(folder)
        if names is None:
            names = {}
            for ov in self.index['ovls']:
                if os.path.dirname(ov['path']).lower() == folder and not ov.get('error'):
                    try:
                        o, _ = self.open(ov['path'])
                    except Exception:
                        continue
                    for r in o.resources:
                        if r.name:
                            names.setdefault(r.name.lower(), ov['path'])
            cache[folder] = names
        rel = names.get(name.lower())
        if not rel and folder:
            # a themed style keeps its sids in Style\Themed\WildWest and each item's visual and model in an OVL
            # named after the item in a subfolder (EntranceExit\MainEntrance\MainEntrance.common.ovl), while
            # every theme calls its entrance MainEntrance: look in the subfolders' OVLs named like the resource
            stem = name.split(':')[0].lower()
            for ov in sorted((ov for ov in self.index['ovls'] if not ov.get('error')
                              and ov['path'].lower().startswith(folder + os.sep)
                              and os.path.basename(ov['path']).lower().startswith(stem + '.')),
                             key=lambda ov: ov['path'].count(os.sep)):
                o, ts = self.open(ov['path'])
                r = next((r for r in o.resources if r.name.lower() == name.lower()), None)
                if r:
                    return o, r, ts
        if rel:
            o, ts = self.open(rel)
            for r in o.resources:
                if r.name.lower() == name.lower():
                    return o, r, ts
        return hit

    def animations_for(self, ovl: Ovl, shape) -> list:
        """Bone animations that drive a bone shape: listed by any scenery visual (svd) LOD that uses the shape,
        else every ban in the same OVL whose bones overlap the shape's bones."""
        from .anims import load_ban, load_svd
        from .gltf import _norm_bone
        names = []
        for r in ovl.resources:
            if r.loader.tag == 'svd':
                try:
                    sv = load_svd(ovl, r)
                except Exception:
                    continue
                for lod in sv.lods:
                    if lod.model.lower() == shape.name.lower():
                        names += [a for a in lod.animations if a not in names]
        out = []
        for n in names:
            hit = self.find(n, prefer=ovl)
            if hit:
                try:
                    out.append(load_ban(hit[0], hit[1]))
                except Exception:
                    pass
        if not out:
            bones = {_norm_bone(b.name) for b in shape.bones}
            for r in ovl.by_tag('ban'):
                try:
                    a = load_ban(ovl, r)
                except Exception:
                    continue
                if bones & {_norm_bone(t.name) for t in a.bones}:
                    out.append(a)
        return out

    def texture_image(self, name: str, prefer: Ovl | None = None, colors=None):
        """colors: up to 3 (r, g, b) for a recolourable FlexiTexture (a placed object's own colours)."""
        hit = self.find(name, prefer)
        if not hit:
            return None
        o, r, ts = hit
        try:
            return ts.image(r, colors=colors)
        except Exception:
            return None
