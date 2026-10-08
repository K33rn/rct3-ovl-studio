"""Parse -> dump every save-format file the game ships (designs, fireworks, shows, lasers, water jets, laser
writing) and check the bytes come back identical. usage: python tests/trk_roundtrip.py "<game folder>"
"""
import glob
import os
import struct
import sys

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl.trk import Trk  # noqa: E402

G = sys.argv[1]
pats = ['Coaster Designs/*.trk', 'Fireworks/*.frw', 'ParticleEffects/*.frw', 'FireworkDisplays/*.fwd', 'Lasers/*.las',
        'WaterJets/*.wjt', 'LaserWriting/*.lwr']
for pat in pats:
    ok = bad = 0; first = None
    for f in sorted(glob.glob(os.path.join(G, pat))):
        b = open(f, 'rb').read()
        start = 64 if f.lower().endswith('.lwr') else None
        try:
            t = Trk(b, start=start)
        except Exception as e:
            bad += 1; first = first or (os.path.basename(f), 'parse: ' + str(e)); continue
        d = t.dump()
        if d == b:
            ok += 1
        else:
            bad += 1
            i = next((i for i in range(min(len(d), len(b))) if d[i] != b[i]), min(len(d), len(b)))
            first = first or (os.path.basename(f), f'differs at {i} of {len(b)} (ours {len(d)}): ours {d[i-8:i+24].hex(" ")} | file {b[i-8:i+24].hex(" ")}')
    print(f'{pat:28} identical {ok}  different {bad}', first or '')
