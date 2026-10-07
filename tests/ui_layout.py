"""Viewer: tab bar + column dividers. usage: python tests/ui_layout.py http://127.0.0.1:8799 <out folder>"""
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
    pg.goto(base + '/')
    pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=180000)
    pg.click('#b-designs'); pg.wait_for_selector('.res[data-design]', timeout=180000)
    print('active tab:', pg.eval_on_selector_all('.tabs button.active', 'bs => bs.map(b => b.textContent)'))
    pg.screenshot(path=f'{out}/tabs.png')
    w = lambda: pg.eval_on_selector_all('#app > .col', 'cs => cs.map(c => Math.round(c.getBoundingClientRect().width))')
    print('widths before', w())
    for sel, dx in (('.resizer[data-col="1"]', 100), ('.resizer[data-col="2"]', 140)):
        bb = pg.locator(sel).bounding_box(); x, y = bb['x'] + bb['width'] / 2, bb['y'] + 300
        pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x + dx / 2, y); pg.mouse.move(x + dx, y); pg.mouse.up()
    print('widths after drag', w())
    pg.screenshot(path=f'{out}/resized.png')
    pg.reload(); pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=180000)
    print('widths after reload (remembered)', w())
    pg.dblclick('.resizer[data-col="1"]'); print('after double-click reset', w())
    print('page errors:', errors)
    b.close()
