"""How often does a people/animal texture's layout repeat? Correlate the edge map with itself shifted by 1/8, 1/4 and
1/2 of the image (colours change between variants, the shapes don't).
usage: python tests/tex_period.py "<game folder>" tex_name ...
"""
import sys

import numpy as np

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl.library import Library  # noqa: E402


def edges(img):
    g = np.asarray(img.convert('L').resize((256, 256)), np.float32)
    gx = np.abs(np.diff(g, axis=1, append=g[:, :1])); gy = np.abs(np.diff(g, axis=0, append=g[:1]))
    e = gx + gy
    return (e - e.mean()) / (e.std() + 1e-6)


def corr(e, dx, dy):
    return float((e * np.roll(np.roll(e, dy, 0), dx, 1)).mean())


lib = Library(sys.argv[1])
for n in sys.argv[2:]:
    img = lib.texture_image(n)
    e = edges(img)
    row = {f: (round(corr(e, int(256 * f), 0), 2), round(corr(e, 0, int(256 * f)), 2)) for f in (1 / 8, 1 / 4, 1 / 2)}
    print(f'{n:22} shift x/y -> ' + '  '.join(f'1/{int(1 / f)}: {v[0]:+.2f}/{v[1]:+.2f}' for f, v in row.items()))
