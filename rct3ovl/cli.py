"""Command line: rct3ovl info|list|extract|view|index."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

from .container import Ovl, pair_paths
from .library import Library, find_pairs
from .meshes import load_shape
from .gltf import shape_to_glb

DECODED = {'tex', 'ftx', 'shs', 'bsh'}


def _safe(name: str) -> str:
    return ''.join(c if c.isalnum() or c in '-_.' else '_' for c in name) or 'unnamed'


def cmd_info(a):
    o = Ovl(a.ovl)
    print(json.dumps(o.summary(), indent=2))
    for f in o.files:
        print(f'{os.path.basename(f.path)}: v{f.version} loaders ' +
              ', '.join(f'{l.name}({l.tag})' for l in f.loaders))
        if f.references:
            print('  references:', ', '.join(f.references))


def cmd_list(a):
    o = Ovl(a.ovl)
    for r in o.resources:
        if a.type and r.loader.tag not in a.type.split(','):
            continue
        print(f'{r.loader.tag:6s} {r.name or "(unnamed)":48s} 0x{r.data:08X} {r.part:6s} extra={len(r.extra)}')


def extract_pair(lib: Library, base: str, out: str, types: set[str] | None, raw: bool) -> dict:
    o, ts = lib.open(base)
    rel = os.path.relpath(pair_paths(base)[0], lib.root)[:-len('.common.ovl')] if base.startswith(lib.root) \
        else o.name
    dest = os.path.join(out, rel)
    stats = {'textures': 0, 'models': 0, 'raw': 0, 'errors': []}
    manifest = {'ovl': rel, 'version': o.version, 'resources': []}
    for r in o.resources:
        tag = r.loader.tag
        entry = {'name': r.name, 'tag': tag, 'loader': r.loader.name, 'address': r.data, 'part': r.part}
        if types and tag not in types:
            continue
        try:
            if tag in ('tex', 'ftx'):
                img = ts.image(r)
                if img is not None:
                    fn = os.path.join(dest, 'textures', _safe(r.name.split(':')[0]) + f'.{tag}.png')
                    os.makedirs(os.path.dirname(fn), exist_ok=True); img.save(fn)
                    entry['file'] = os.path.relpath(fn, out); stats['textures'] += 1
            elif tag in ('shs', 'bsh'):
                s = load_shape(o, r)
                fn = os.path.join(dest, 'models', _safe(r.name.split(':')[0]) + f'.{tag}.glb')
                os.makedirs(os.path.dirname(fn), exist_ok=True)
                open(fn, 'wb').write(shape_to_glb(s, lambda n: lib.texture_image(n, prefer=o)))
                entry['file'] = os.path.relpath(fn, out); stats['models'] += 1
                entry['textures'] = sorted({m.texture for m in s.meshes})
                entry['bones'] = len(s.bones)
            if raw and r.extra:
                for i, ex in enumerate(r.extra):
                    fn = os.path.join(dest, 'raw', tag, f'{_safe(r.name or hex(r.data))}.extra{i}.bin')
                    os.makedirs(os.path.dirname(fn), exist_ok=True); open(fn, 'wb').write(ex)
                    stats['raw'] += 1
        except Exception as e:
            entry['error'] = repr(e); stats['errors'].append(f'{rel}: {r.name}: {e!r}')
        manifest['resources'].append(entry)
    os.makedirs(dest, exist_ok=True)
    json.dump(manifest, open(os.path.join(dest, 'manifest.json'), 'w'), indent=1)
    return stats


def cmd_extract(a):
    src = os.path.abspath(a.source)
    root = a.root or (src if os.path.isdir(src) else os.path.dirname(src))
    lib = Library(root)
    bases = find_pairs(src) if os.path.isdir(src) else [pair_paths(src)[0]]
    types = set(a.type.split(',')) if a.type else None
    t0 = time.time(); tot = {'textures': 0, 'models': 0, 'raw': 0}; errors = []
    for i, b in enumerate(bases, 1):
        s = extract_pair(lib, b, a.out, types, a.raw)
        for k in tot:
            tot[k] += s[k]
        errors += s['errors']
        if len(bases) > 1 and (i % 100 == 0 or i == len(bases)):
            print(f'  {i}/{len(bases)} OVLs  {tot["textures"]} textures  {tot["models"]} models', flush=True)
    print(f'done in {time.time() - t0:.1f}s: {tot["textures"]} textures, {tot["models"]} models, '
          f'{tot["raw"]} raw blobs, {len(errors)} errors -> {os.path.abspath(a.out)}')
    for e in errors[:20]:
        print('  ERROR', e)


def cmd_index(a):
    lib = Library(a.root)
    t0 = time.time(); idx = lib.rebuild_index()
    print(f'indexed {len(idx["ovls"])} OVL pairs, {len(idx["names"])} names in {time.time() - t0:.1f}s')


def cmd_view(a):
    from .viewer import serve
    serve(a.root, port=a.port, open_browser=not a.no_browser)


def main(argv=None):
    p = argparse.ArgumentParser(prog='rct3ovl', description='RollerCoaster Tycoon 3 OVL extractor and model viewer')
    sp = p.add_subparsers(dest='cmd', required=True)
    s = sp.add_parser('info', help='header, loaders and resource counts of one OVL pair'); s.add_argument('ovl'); s.set_defaults(f=cmd_info)
    s = sp.add_parser('list', help='list resources'); s.add_argument('ovl'); s.add_argument('--type', help='e.g. shs,tex'); s.set_defaults(f=cmd_list)
    s = sp.add_parser('extract', help='textures -> PNG, models -> GLB (one OVL or a whole folder)')
    s.add_argument('source', help='an .ovl file or a folder'); s.add_argument('-o', '--out', default='rct3_extracted')
    s.add_argument('--root', help='game data folder used to find shared textures (default: source folder)')
    s.add_argument('--type', help='only these tags, e.g. shs,bsh,tex,ftx'); s.add_argument('--raw', action='store_true', help='also dump extra-data blobs')
    s.set_defaults(f=cmd_extract)
    s = sp.add_parser('index', help='rebuild the name index of a game folder'); s.add_argument('root'); s.set_defaults(f=cmd_index)
    s = sp.add_parser('view', help='open the browser-based viewer'); s.add_argument('root')
    s.add_argument('--port', type=int, default=8765); s.add_argument('--no-browser', action='store_true'); s.set_defaults(f=cmd_view)
    a = p.parse_args(argv)
    a.f(a)


if __name__ == '__main__':
    main()
