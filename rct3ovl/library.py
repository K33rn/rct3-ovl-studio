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


class Library:
    """Lazily opens OVLs; resolves 'name:tag' to (Ovl, LoaderRef) across the whole game folder."""

    def __init__(self, root: str, cache_dir: str | None = None, max_open: int = 64):
        self.root = os.path.abspath(root)
        self.cache_dir = cache_dir or os.path.join(os.path.expanduser('~'), '.rct3ovl')
        os.makedirs(self.cache_dir, exist_ok=True)
        self._open: OrderedDict[str, tuple[Ovl, TextureSet | None]] = OrderedDict()
        self.max_open = max_open
        self.index: dict = self._load_index()

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
            ovls.append({'path': rel, 'version': o.version, 'counts': counts})
        idx = {'version': INDEX_VERSION, 'root': self.root, 'language': lang, 'ovls': ovls, 'names': names}
        json.dump(idx, open(self._index_path(), 'w'))
        return idx

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

    def texture_image(self, name: str, prefer: Ovl | None = None):
        hit = self.find(name, prefer)
        if not hit:
            return None
        o, r, ts = hit
        try:
            return ts.image(r)
        except Exception:
            return None
