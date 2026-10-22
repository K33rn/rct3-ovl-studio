"""Place every design's pieces straight from their stored grid data (rotation (DIRECTION + 2) % 4, the stored tile
being the footprint's lowest corner) and report the worst joint between consecutive pieces per design.
usage: python tests/design_direct.py "<game folder>" [design name]
"""
import sys


sys.path.insert(0, __file__.rsplit('tests', 1)[0])
import rct3ovl.designs as D  # noqa: E402
from rct3ovl.library import Library  # noqa: E402

lib = Library(sys.argv[1])
only = sys.argv[2] if len(sys.argv) > 2 else None
rows = []
for f in [x for x in D.design_files(lib) if not x["yours"]]:   # the game's own designs
    if only and f['name'] != only:
        continue
    try:
        glb, info = D.build_design(lib, f['file'])
    except Exception as e:  # noqa: BLE001
        print('skip', f['name'], e); continue
    rows.append((info['joint_gap'], info['closure_gap'], f['ride_type'], f['name'], info.get('bad_joints')))
    if only:
        for j in info.get('joints', []):
            print(j)
rows.sort(key=lambda r: -(r[0] or 0))
print('designs', len(rows), '| all joints < 10 cm:', sum(1 for r in rows if (r[0] or 0) < 0.1))
for r in rows[:40]:
    print(r)
