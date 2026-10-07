"""Draw each mesh of the elephant mdl's first detail level over each candidate texture (UV as stored and flipped)
to see which texture each mesh uses.
usage: python tests/mdl_uvmatch.py "<game folder>" <out.png>
"""
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl.library import Library  # noqa: E402

lib = Library(sys.argv[1])
o, ts = lib.open(r'Cars\TrackedRideCars\Elephant\Elephant.common.ovl')
r = next(x for x in o.resources if x.loader.tag == 'mdl')
A = r.extra[0]
VT = np.dtype([('p', '<f4', 3), ('n', '<f4', 3), ('bi', 'u1', 4), ('bw', 'u1', 4), ('c', '<u4'), ('uv', '<f4', 2)])
hdr = [5456 + 32 * k for k in range(5)]
pos, meshes = hdr[-1] + 32, []
for h in hdr:
    _, nidx, _, nvert = struct.unpack_from('<IIHH', A, h)
    v = np.frombuffer(A, VT, nvert, pos); pos += VT.itemsize * nvert
    idx = np.frombuffer(A, '<u2', nidx, pos).reshape(-1, 3); pos += 2 * nidx
    meshes.append((v, idx))
texs = ['SpecMap:tex', 'Alpha:tex', 'NonAlpha:tex', 'FlexiElephant:tex']
S = 220
sheet = Image.new('RGB', (len(texs) * 2 * (S + 4), len(meshes) * (S + 4)), (30, 30, 30))
for ti, tn in enumerate(texs):
    img = ts.image(next(x for x in o.resources if x.name == tn)).convert('RGB').resize((S, S))
    for mi, (v, idx) in enumerate(meshes):
        for fi, flip in enumerate((False, True)):
            im = img.copy(); d = ImageDraw.Draw(im)
            uv = v['uv'] % 1.0
            for t in idx:
                pts = [(uv[i, 0] * S, ((1 - uv[i, 1]) if flip else uv[i, 1]) * S) for i in t]
                d.polygon(pts, outline=(0, 255, 0))
            d.text((3, 3), f'm{mi} {tn.split(":")[0]} {"v-flip" if flip else "as is"}', fill='yellow')
            sheet.paste(im, ((ti * 2 + fi) * (S + 4), mi * (S + 4)))
sheet.save(sys.argv[2])
