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
from .export import export_resource

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


def extract_pair(lib: Library, base: str, out: str, types: set[str] | None, raw: bool, anims=None,
                 variant: int | None = 0) -> dict:
    o, ts = lib.open(base)
    rel = os.path.relpath(pair_paths(base)[0], lib.root)[:-len('.common.ovl')] if base.startswith(lib.root) \
        else o.name
    dest = os.path.join(out, rel)
    stats = {'files': 0, 'errors': []}
    from collections import Counter
    kinds = Counter()
    manifest = {'ovl': rel, 'version': o.version, 'resources': []}
    texts = {}
    for r in o.resources:
        tag = r.loader.tag
        if types and tag not in types:
            continue
        entry = {'name': r.name, 'tag': tag, 'loader': r.loader.name, 'address': r.data, 'part': r.part}
        try:
            files, info = export_resource(lib, o, ts, r, anims, variant=variant)
            if tag == 'txt':
                texts[r.name.split(':')[0]] = info.pop('text', '')
            entry.update(info)
            for sub, fn, data in files:
                p = os.path.join(dest, sub, fn)
                os.makedirs(os.path.dirname(p), exist_ok=True)
                open(p, 'wb').write(data)
                entry.setdefault('files', []).append(os.path.relpath(p, out))
                stats['files'] += 1; kinds[sub.split('/')[0]] += 1
            if raw and r.extra:
                for i, ex in enumerate(r.extra):
                    p = os.path.join(dest, 'raw', tag, f'{_safe(r.name or hex(r.data))}.extra{i}.bin')
                    os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'wb').write(ex)
        except Exception as e:
            entry['error'] = repr(e); stats['errors'].append(f'{rel}: {r.name}: {e!r}')
        manifest['resources'].append(entry)
    os.makedirs(dest, exist_ok=True)
    if texts:
        json.dump(texts, open(os.path.join(dest, 'text.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    json.dump(manifest, open(os.path.join(dest, 'manifest.json'), 'w'), indent=1)
    stats['kinds'] = kinds
    return stats


def export_people(lib: Library, out: str, anims, scope: str | None = None, outfit: int | None = 0) -> int:
    """Whole characters (body + legs + head groups) per variant, e.g. people/AF01.glb."""
    from .characters import build_person, variants
    vs = variants(lib)
    count = 0
    for v in sorted(variants(lib, scope)):
        try:
            res = build_person(lib, v, anims, vs, outfit=outfit)
            if res is None:
                continue
            p = os.path.join(out, 'people', f'{v.upper()}.glb')
            os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, 'wb').write(res[0]); count += 1
        except Exception as e:
            print('  person', v, 'failed:', repr(e))
    return count

def cmd_extract(a):
    src = os.path.abspath(a.source)
    root = a.root or (src if os.path.isdir(src) else os.path.dirname(src))
    lib = Library(root)
    bases = find_pairs(src) if os.path.isdir(src) else [pair_paths(src)[0]]
    types = set(a.type.split(',')) if a.type else None
    anims = a.anims.split(',') if a.anims else None
    variant = None if a.variant < 0 else a.variant
    from collections import Counter
    t0 = time.time(); tot = Counter(); nfiles = 0; errors = []
    for i, b in enumerate(bases, 1):
        s = extract_pair(lib, b, a.out, types, a.raw, anims, variant)
        tot.update(s['kinds']); nfiles += s['files']
        errors += s['errors']
        if len(bases) > 1 and (i % 200 == 0 or i == len(bases)):
            print(f'  {i}/{len(bases)} OVLs  {nfiles} files', flush=True)
    if not a.no_people and (types is None or 'ppg' in types):
        n = export_people(lib, a.out, a.person_anims.split(','), src if os.path.isdir(src) else None, variant)
        tot['people'] += n
    print(f'done in {time.time() - t0:.1f}s, {len(errors)} errors -> {os.path.abspath(a.out)}')
    print('  ' + ', '.join(f'{k}: {v}' for k, v in sorted(tot.items())))
    for e in errors[:20]:
        print('  ERROR', e)


def cmd_index(a):
    lib = Library(a.root)
    t0 = time.time(); idx = lib.rebuild_index()
    print(f'indexed {len(idx["ovls"])} OVL pairs, {len(idx["names"])} names in {time.time() - t0:.1f}s')


def cmd_view(a):
    from .viewer import serve
    serve(a.root, port=a.port, open_browser=not a.no_browser)


def cmd_person(a):
    from .characters import build_person, variants
    lib = Library(a.root)
    names = sorted(variants(lib)) if a.variant.lower() == 'list' else [a.variant.lower()]
    if a.variant.lower() == 'list':
        print(' '.join(v.upper() for v in names)); return
    res = build_person(lib, names[0], a.anims.split(','), lod=a.lod, expression=a.expression,
                       outfit=None if a.outfit < 0 else a.outfit)
    if res is None:
        sys.exit(f'no person parts found for {a.variant}')
    out = a.out or f'{names[0].upper()}.glb'
    open(out, 'wb').write(res[0])
    print(f'{out}: parts {", ".join(res[1]["parts"])}; head {res[1]["head"]}; '
          f'animations {", ".join(res[1]["exported_animations"] or [])} (of {len(res[1]["animations"])}); '
          f'outfit {a.outfit} of {res[1]["outfits"]}')


def cmd_recolour(a):
    lib = Library(a.root) if a.root else None
    o, ts = lib.open(a.ovl) if lib else (Ovl(a.ovl), None)
    if ts is None:
        from .textures import TextureSet
        ts = TextureSet(o)
    r = next((r for r in o.resources if r.name.lower() in (a.name.lower(), a.name.lower() + ':ftx')), None)
    if r is None or r.loader.tag != 'ftx':
        sys.exit(f'{a.name}: no such FlexiTexture in {a.ovl}')
    cols = [tuple(int(c.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4)) if c else None for c in a.colors.split(',')]
    img = ts.image(r, colors=cols)
    out = a.out or r.name.split(':')[0] + '_recoloured.png'
    img.save(out)
    print(f'{out} (recolourable channels: {ts.recolorable(r):03b})')


def main(argv=None):
    p = argparse.ArgumentParser(prog='rct3ovl', description='RollerCoaster Tycoon 3 OVL extractor and model viewer')
    p.add_argument('--language', help='language for names and text (English, German, French, Spanish, Dutch, Danish, '
                                      'Finnish, Italian, Norwegian, Swedish); default English')
    sp = p.add_subparsers(dest='cmd', required=True)
    s = sp.add_parser('person', help='assemble one guest / staff member / mascot into a GLB ("list" to see all)')
    s.add_argument('root'); s.add_argument('variant', help='e.g. AF01, LG01, PANDA, or list')
    s.add_argument('--anims', default='Walk,Idle', help='comma separated animation names'); s.add_argument('-o', '--out')
    s.add_argument('--lod', type=int, default=0); s.add_argument('--expression', default='', help='Angry, Happy, Sad, Scared, Sick')
    s.add_argument('--outfit', type=int, default=0, help='colour variant (0 = first; -1 = as stored in the file)')
    s.set_defaults(f=cmd_person)
    s = sp.add_parser('recolour', help='preview a recolourable FlexiTexture with your own colours')
    s.add_argument('ovl'); s.add_argument('name'); s.add_argument('--colors', default='c81e1e,1e5adc,f0f0f0',
                                                                  help='up to three hex colours, e.g. ff0000,,00ff00')
    s.add_argument('--root', help='game folder'); s.add_argument('-o', '--out'); s.set_defaults(f=cmd_recolour)
    s = sp.add_parser('info', help='header, loaders and resource counts of one OVL pair'); s.add_argument('ovl'); s.set_defaults(f=cmd_info)
    s = sp.add_parser('list', help='list resources'); s.add_argument('ovl'); s.add_argument('--type', help='e.g. shs,tex'); s.set_defaults(f=cmd_list)
    s = sp.add_parser('extract', help='everything -> PNG / GLB / WAV / JSON (one OVL or a whole folder)')
    s.add_argument('source', help='an .ovl file or a folder'); s.add_argument('-o', '--out', default='rct3_extracted')
    s.add_argument('--root', help='game data folder used to find shared textures (default: source folder)')
    s.add_argument('--type', help='only these tags, e.g. shs,bsh,tex,ftx'); s.add_argument('--raw', action='store_true', help='also dump extra-data blobs')
    s.add_argument('--anims', help='only these animation names in models/morphs/heads (default: all bone animations, first 12 morph animations)')
    s.add_argument('--person-anims', default='Walk,Idle,Applause,Converse', help='animations for whole-person exports')
    s.add_argument('--no-people', action='store_true', help='skip assembling whole people')
    s.add_argument('--variant', type=int, default=0, help='colour variant for people/animal textures '
                                                         '(0 = first; -1 = as stored in the file)')
    s.set_defaults(f=cmd_extract)
    s = sp.add_parser('index', help='rebuild the name index of a game folder'); s.add_argument('root'); s.set_defaults(f=cmd_index)
    s = sp.add_parser('view', help='open the browser-based viewer'); s.add_argument('root')
    s.add_argument('--port', type=int, default=8765); s.add_argument('--no-browser', action='store_true'); s.set_defaults(f=cmd_view)
    a = p.parse_args(argv)
    if a.language:
        os.environ['RCT3OVL_LANGUAGE'] = a.language
    a.f(a)


if __name__ == '__main__':
    main()
