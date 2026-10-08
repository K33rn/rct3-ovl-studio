"""Viewer: Scenery tab - list, filter, an animated item and two static ones.
usage: python tests/ui_scenery.py http://127.0.0.1:8799 <out folder>
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
    pg.evaluate("localStorage.clear(); [`main`, `mixmaster`, `afe`, `laser-designer`, `jet-designer`].forEach(k => localStorage.setItem(`rct3ovl.tour.` + k, `1`))")
    pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=180000)
    print('tabs:', pg.eval_on_selector_all('.tabs button', 'bs => bs.map(b => b.textContent)'))
    pg.click('#b-scenery'); pg.wait_for_selector('.res[data-scenery]', timeout=600000)
    print('groups:', pg.eval_on_selector_all('#res .group', 'gs => gs.map(g => g.textContent)'))
    print('items:', pg.eval_on_selector_all('.res[data-scenery]', 'ds => ds.length'),
          '| animated:', pg.eval_on_selector_all('.res[data-scenery]', "ds => ds.filter(d => d.textContent.includes('⟳')).length"))
    pg.screenshot(path=f'{out}/list.png')
    pg.fill('#resfilter', 'rex'); pg.dispatch_event('#resfilter', 'input')
    vis = pg.eval_on_selector_all('.res[data-scenery]', "ds => ds.filter(d => d.style.display !== 'none').map(d => d.textContent)")
    print('filter "rex":', vis[:10])
    for name, shot in (('trex:sid', 'trex'), ('van_wall_1a:sid', 'wall'), ('ash_1:sid', 'tree')):
        pg.evaluate(f"showScenery('{name}')") if False else pg.eval_on_selector(f'.res[data-scenery="{name}"]', 'e => e.click()')
        pg.wait_for_function(ready, timeout=180000); pg.wait_for_timeout(1500)
        print(shot, '|', pg.inner_text('#vtitle'), '|', pg.inner_text('#info').replace('\n', ' | ')[:300],
              '| anim select:', pg.eval_on_selector_all('#anim option', 'os => os.map(o => o.textContent)'))
        pg.screenshot(path=f'{out}/{shot}.png')
        pg.fill('#resfilter', ''); pg.dispatch_event('#resfilter', 'input')
    print('page errors:', errors)
    b.close()
