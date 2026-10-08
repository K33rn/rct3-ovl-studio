"""List all scenery and build a sample of each category. usage: python tests/scenery_check.py "<game folder>" [out dir]"""
import collections
import os
import sys
import time

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl.library import Library  # noqa: E402
from rct3ovl.scenery import build_scenery, list_scenery  # noqa: E402

lib = Library(sys.argv[1])
t0 = time.time(); items = list_scenery(lib); print(len(items), 'scenery items in', round(time.time() - t0), 's')
print('categories', collections.Counter(d['category'] for d in items).most_common())
print('themes', collections.Counter(d['theme'] for d in items).most_common())
print('animated', sum(1 for d in items if d['animations']))
fails = []; t0 = time.time(); built = 0
for d in items:
    try:
        r = build_scenery(lib, d['name'])
        if r is None:
            fails.append((d['name'], 'None'))
        else:
            built += 1
            if len(sys.argv) > 2 and d['name'].split(':')[0] in ('trex', 'van_wall_1a', 'oak_bush_1', 'bench', 'waterjet'):
                os.makedirs(sys.argv[2], exist_ok=True); open(os.path.join(sys.argv[2], d['name'].split(':')[0] + '.glb'), 'wb').write(r[0])
    except Exception as e:
        fails.append((d['name'], repr(e)[:100]))
print('built', built, 'failed', len(fails), 'in', round(time.time() - t0), 's'); print(fails[:15])
