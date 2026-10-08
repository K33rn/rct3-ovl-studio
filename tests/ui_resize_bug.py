"""Reproduce: dragging a column divider far makes the 3D view vanish. usage: python tests/ui_resize_bug.py <base> <out>"""
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
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.goto(base + '/')
    pg.evaluate("localStorage.clear()")
    pg.reload()
    pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=180000)
    pg.click('#b-rides'); pg.wait_for_selector('.res[data-ride]', timeout=180000)
    pg.eval_on_selector('.res[data-ride]', 'e => e.click()')
    pg.wait_for_function("document.getElementById('msg').textContent === ''", timeout=180000); pg.wait_for_timeout(1500)
    st = lambda: pg.evaluate("""() => { const c = document.querySelector('#stage canvas'), s = document.getElementById('stage').getBoundingClientRect();
        return {cols: [...document.querySelectorAll('#app > .col')].map(c => Math.round(c.getBoundingClientRect().width)),
                stage: [Math.round(s.width), Math.round(s.height)], canvas: [c.width, c.height], css: [c.clientWidth, c.clientHeight]}; }""")
    print('start', st())

    def drag(col, dx, steps=10):
        bb = pg.locator(f'.resizer[data-col="{col}"]').bounding_box(); x, y = bb['x'] + bb['width'] / 2, bb['y'] + 300
        pg.mouse.move(x, y); pg.mouse.down()
        for i in range(1, steps + 1):
            pg.mouse.move(x + dx * i / steps, y)
        pg.mouse.up(); pg.wait_for_timeout(500)
    drag(2, 1200); print('col2 far right', st()); pg.screenshot(path=f'{out}/a_far.png')
    drag(2, -1200); print('col2 back left', st()); pg.screenshot(path=f'{out}/b_back.png')
    drag(1, 1200); print('col1 far right', st()); pg.screenshot(path=f'{out}/c_col1.png')
    drag(1, -1200); print('col1 back', st()); pg.screenshot(path=f'{out}/d_col1back.png')
    print('errors', errors)
    b.close()
