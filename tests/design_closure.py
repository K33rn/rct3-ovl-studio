"""Build every premade design and report how many circuits close.
usage: python tests/design_closure.py "<game folder>"
"""
import sys

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl.designs import build_design, design_files  # noqa: E402
from rct3ovl.library import Library  # noqa: E402

lib = Library(sys.argv[1])
res = []
for f in [x for x in design_files(lib) if not x["yours"]]:   # the game's own designs
    glb, info = build_design(lib, f['file'])
    res.append((f['ride_type'], f['name'], info))
closed = [r for r in res if r[2]['closure_gap'] is not None]
print('circuits close (<10 cm):', sum(1 for r in closed if r[2]['closure_gap'] < 0.1), 'of', len(closed))
print('worst', sorted([(round(r[2]['closure_gap'], 1), r[0], r[1]) for r in closed if r[2]['closure_gap'] >= 0.1],
                      reverse=True)[:30])
