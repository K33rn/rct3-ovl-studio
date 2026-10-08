"""Exported show parses like the game's; save_to_game writes new files and refuses to overwrite shipped ones.
Runs against a temporary copy of the game's firework folders. usage: python tests/fw_save_check.py "<game>" <export.fwd>"""
import os
import shutil
import sys
import tempfile

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl import fireworks as F  # noqa: E402
from rct3ovl.container import OvlError  # noqa: E402
from rct3ovl.library import Library  # noqa: E402
from rct3ovl.trk import Trk  # noqa: E402

lib = Library(sys.argv[1])
t = Trk(open(sys.argv[2], 'rb').read())
show = next(v for n, v in t.objects.values() if n == 'SavedFireworkDisplay')
print('export.fwd parses:', show['Name'], '|', len(show['Entries']), 'entries,', len(show['SceneryEntries']), 'launchers | SIDs',
      sorted(v['SYMBOLNAME'] for n, v in t.objects.values() if n == 'SIDDatabaseEntry'))
fw = F.list_fireworks(lib)[0]
lz = F.list_effects(lib, 'laser')[0]
jt = F.list_effects(lib, 'jet')[0]
tmp = tempfile.mkdtemp()
for d in ('Fireworks', 'Lasers', 'WaterJets', 'FireworkDisplays'):
    shutil.copytree(os.path.join(lib.root, d), os.path.join(tmp, d))
real = lib.root
lib.root = tmp
lib.cache_dir = tmp
p = F.save_to_game(lib, 'frw', 'My Test Firework', fw)
print('saved:', os.path.relpath(p, tmp), os.path.getsize(p), '| recorded as ours:', F._is_created(lib, p), '| parses back:', len(F.load_firework.__defaults__ or ()) == 0 and Trk(open(p, 'rb').read()) is not None)
p2 = F.save_to_game(lib, 'frw', 'My Test Firework', fw)
print('overwrite own file ok:', p2 == p)
try:
    F.save_to_game(lib, 'frw', 'GreenPeony', fw); print('PROBLEM: overwrote a game file')
except OvlError as e:
    print('refuses game file:', e)
print('laser saved:', os.path.basename(F.save_to_game(lib, 'las', 'Mine', lz)), '| jets:', os.path.basename(F.save_to_game(lib, 'wjt', 'Mine', jt)))
lib.root = real
shutil.rmtree(tmp)
