"""Viewer on the full Gold install: a zoo animal (animation menu), a track piece, the elevator car.
usage: python tests/ui_gold.py http://127.0.0.1:8799 <out folder>
"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
cases = [('giraffe', 'WildAnimals%5Cgiraffe%5Cgiraffe_data.common.ovl', 'AdultGiraffe%3Amdl'),
         ('loop', 'tracks%5Ccoasters%5CTrack11%5CTrack11.common.ovl', 'Loopleft%3Atks'),
         ('elevator', 'Cars%5CTrackedRideCars%5CElevatorCar%5CElevatorCar.common.ovl', 'ElevatorCar%3Absh')]
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1400, 'height': 850})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    for tag, ovl, res in cases:
        pg.goto(f'{base}/#ovl={ovl}&res={res}')
        pg.wait_for_function("document.getElementById('msg').textContent === '' && document.getElementById('info').style.display === 'block'", timeout=120000)
        pg.wait_for_timeout(1500)
        opts = pg.eval_on_selector_all('#anim option', 'os => os.map(o => o.textContent)')
        print(f'{tag}: {len(opts)} animations {opts[:8]} | {pg.inner_text("#info").replace(chr(10), " | ")[:200]}')
        pg.screenshot(path=f'{out}/{tag}.png')
    print('page errors:', errors)
    b.close()
