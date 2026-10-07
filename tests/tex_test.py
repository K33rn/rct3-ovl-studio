"""Decode all tex/ftx of the given OVLs to PNG in an output folder, print a summary."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from rct3ovl import Ovl
from rct3ovl.textures import TextureSet

out = sys.argv[1]; os.makedirs(out, exist_ok=True)
for p in sys.argv[2:]:
    o = Ovl(p); ts = TextureSet(o)
    for r in o.resources:
        if r.loader.tag not in ('tex', 'ftx'):
            continue
        try:
            img = ts.image(r)
        except Exception as e:
            print(f'  {o.name}: {r.name} FAILED {e!r}'); continue
        if img is None:
            print(f'  {o.name}: {r.name} -> no image'); continue
        info = ''
        if r.loader.tag == 'tex':
            bm = ts.tex_bitmap(r); info = f'{bm.format_name} mips {len(bm.mips)}'
        fn = os.path.join(out, f'{o.name}__{r.name.replace(":", "_")}.png')
        img.save(fn)
        print(f'  {o.name}: {r.name} {img.size} {info}')
