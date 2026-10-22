"""Custom flat rides (Kamikaze, Mega Disko) next to a stock one: each opens in the Thrill Rides list at its size and
standing on the grid, not shrunk to a speck above it by the invisible anti-culling mesh these rides carry.
usage: python tests/ui_cfr.py http://127.0.0.1:8799 <out folder>"""
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
    pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=300000)
    pg.click('#b-rides'); pg.wait_for_selector('.res[data-ride]', timeout=300000)
    for name in ('cfhkamikaze:anr', 'cfhkamikazeclassic:anr', 'cinipaesmegadiskocfr:anr', 'cinipaesmegadiskoreccfr:anr', 'chairswing:anr'):
        if not pg.query_selector(f'.res[data-ride="{name}"]'):
            print(name, 'NOT LISTED'); continue
        pg.click(f'.res[data-ride="{name}"]')
        pg.wait_for_function("document.getElementById('msg').textContent === '' && document.getElementById('info').style.display === 'block'", timeout=300000)
        pg.wait_for_timeout(2500)
        print(name, '| group:', pg.eval_on_selector(f'.res[data-ride="{name}"]', 'e => e.closest("#res").querySelector(".group") && e.textContent'),
              '| info:', pg.inner_text('#info').replace('\n', ' / ')[:200])
        pg.screenshot(path=f'{out}/{name.split(":")[0]}.png')
    print('page errors:', errors)
    b.close()
