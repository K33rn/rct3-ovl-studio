"""Fireworks added after the list was first made are picked up and sorted (water / firework), and removed ones go.
Works on a scratch game folder: copies a water effect and a firework into its Fireworks folder, removes them after.
usage: python tests/fw_new_files.py <scratch game folder> <a water .frw> <a firework .frw>"""
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from rct3ovl import fireworks as fw          # noqa: E402
from rct3ovl.library import Library        # noqa: E402

root, water_src, fw_src = sys.argv[1:4]
lib = Library(root)
d = os.path.join(root, 'Fireworks')
os.makedirs(d, exist_ok=True)
added = [os.path.join(d, 'ZZ Test AQUA Jet.frw'), os.path.join(d, 'ZZ Test Peony.frw')]
problems = []
try:
    t = time.time(); n0 = len(fw.list_fireworks(lib)); print('first list', n0, f'{time.time() - t:.2f} s')
    t = time.time(); fw.list_fireworks(lib); print('again, nothing changed', f'{time.time() - t:.3f} s')
    shutil.copy(water_src, added[0]); shutil.copy(fw_src, added[1])
    t = time.time(); L = fw.list_fireworks(lib); print('after adding 2:', len(L), f'{time.time() - t:.2f} s')
    by = {x['file']: x for x in L}
    if len(L) != n0 + 2: problems.append(f'expected {n0 + 2}, got {len(L)}')
    if not by.get('ZZ Test AQUA Jet.frw', {}).get('water'): problems.append('new water effect not sorted as water')
    if by.get('ZZ Test Peony.frw', {}).get('water', True): problems.append('new firework sorted as water')
    print('new water:', by.get('ZZ Test AQUA Jet.frw', {}).get('water'), 'new firework water:', by.get('ZZ Test Peony.frw', {}).get('water'))
finally:
    for f in added:
        if os.path.exists(f):
            os.remove(f)
if len(fw.list_fireworks(lib)) != n0: problems.append('removed files still listed')
print('PROBLEMS:', problems or 'none')
