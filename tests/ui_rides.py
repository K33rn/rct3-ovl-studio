"""Viewer: Peeps button label, Thrill Rides list, open two rides and play their loop.
usage: python tests/ui_rides.py http://127.0.0.1:8799 <out folder>
"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1400, 'height': 850})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.add_init_script("try { localStorage.setItem('rct3ovl.tour.main', '1'); } catch (e) {}")
    pg.goto(base + '/')
    pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=120000)
    print('buttons:', pg.eval_on_selector_all('.head h1 button', 'bs => bs.map(b => b.textContent)'))
    pg.click('#b-rides'); pg.wait_for_selector('.res[data-ride]', timeout=120000)
    print('ride groups:', pg.eval_on_selector_all('#res .group', 'gs => gs.map(g => g.textContent)'))
    for name, shot in (('pirateship:anr', 'pirate'), ('topspin:anr', 'topspin')):
        pg.click(f'.res[data-ride="{name}"]')
        pg.wait_for_function("document.getElementById('msg').textContent === '' && document.getElementById('info').style.display === 'block'", timeout=120000)
        pg.wait_for_timeout(2500)
        print(name, '| menu:', pg.eval_on_selector_all('#anim option', 'os => os.map(o => o.textContent)'),
              '| playing:', pg.eval_on_selector('#anim', 'e => e.value'))
        pg.screenshot(path=f'{out}/{shot}.png')
    print('page errors:', errors)
    b.close()
