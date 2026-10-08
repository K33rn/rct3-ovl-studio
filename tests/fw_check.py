"""Server side of the Fireworks editor: fireworks, displays, sprites, launchers, sounds, music.
usage: python tests/fw_check.py "<game folder>"
"""
import json
import sys

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl import fireworks as F  # noqa: E402
from rct3ovl.library import Library  # noqa: E402

lib = Library(sys.argv[1])
fw = F.list_fireworks(lib)
print(len(fw), 'fireworks:', [f['title'] for f in fw][:8], '| json size', len(json.dumps(fw)) // 1024, 'KB')
ds = F.list_displays(lib)
for d in ds:
    print('display', d['name'], d['music'], len(d['entries']), 'entries', len(d['launchers']), 'launchers',
          sorted({l['type'] for l in d['launchers']}), 'tracks', sorted({e['track'] for e in d['entries']})[:12],
          'rows/cols', sorted({(l['row'], l['col'], l['dir']) for l in d['launchers']})[:4])
sp = F.sprites(lib)
print(len(sp), 'sprites', {k: sp[k] for k in ('Flare_00', 'FWFlares01_10') if k in sp})
print('page png', len(F.page_png(lib, 'ParticlePage01') or b''))
for n in F.LAUNCHERS:
    r = F.launcher(lib, n)
    print('launcher', n, None if r is None else (len(r[0]), len(r[1]['tubes']), r[1]['bone_tubes'], r[1]['animated'], r[1]['tubes'][:1]))
print('sound', len(F.sound(lib, 'Fireworklaunch3') or b''))
print('music list', F.music_list(lib)[:5])
