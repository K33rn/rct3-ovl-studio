"""Viewer: Ride Designs tab - list and two designs.
usage: python tests/ui_designs.py http://127.0.0.1:8799 <out folder>
"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
ready = "document.getElementById('msg').textContent === '' && document.getElementById('info').style.display === 'block'"
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1400, 'height': 850})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(base + '/')
    pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=180000)
    print('buttons:', pg.eval_on_selector_all('.head h1 button', 'bs => bs.map(b => b.textContent)'))
    pg.click('#b-designs'); pg.wait_for_selector('.res[data-design]', timeout=180000)
    groups = pg.eval_on_selector_all('#res .group', 'gs => gs.map(g => g.textContent)')
    print('design groups:', len(groups), groups[:8], '| designs:', pg.eval_on_selector_all('.res[data-design]', 'ds => ds.length'))
    for f, shot in (('[AirPoweredRC]Twin Thunder.trk', 'twin'), ('[BodySlide]Crossover.trk', 'crossover'), ('[WoodenRC]', 'wooden')):
        sel = f'.res[data-design="{f}"]' if f.endswith('.trk') else f'.res[data-design^="{f}"]'
        pg.eval_on_selector(sel, 'e => e.click()')
        pg.wait_for_function(ready, timeout=180000); pg.wait_for_timeout(1500)
        print(shot, '|', pg.inner_text('#vtitle'), '|', pg.inner_text('#info').replace('\n', ' | ')[:330])
        pg.screenshot(path=f'{out}/{shot}.png')
    print('page errors:', errors)
    b.close()
