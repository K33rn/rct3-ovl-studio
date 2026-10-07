"""Models whose textures don't exist anywhere in the game folder (the copy is incomplete, or the texture is built in).
usage: python tests/missing_textures.py "<game folder>"
"""
import collections
import sys

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl.library import Library  # noqa: E402
from rct3ovl.meshes import load_shape  # noqa: E402

lib = Library(sys.argv[1])
names = lib.index['names']
missing = collections.defaultdict(set)
models = 0
for ov in lib.index['ovls']:
    c = ov.get('counts', {})
    if not (c.get('shs') or c.get('bsh')):
        continue
    o, _ = lib.open(ov['path'])
    for r in o.resources:
        if r.loader.tag not in ('shs', 'bsh'):
            continue
        models += 1
        for m in load_shape(o, r).meshes:
            if m.texture and m.texture.lower() not in names:
                missing[m.texture].add(f'{ov["path"]} :: {r.name}')
print(f'{models} models; {len(missing)} texture names are referenced but not in this game folder')
for t, users in sorted(missing.items(), key=lambda kv: -len(kv[1])):
    u = sorted(users)
    print(f'  {t:28} used by {len(u):3}: {", ".join(x.split(" :: ")[1] for x in u[:5])}{" …" if len(u) > 5 else ""}')
