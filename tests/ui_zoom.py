"""Drive the viewer's picture zoom/pan with the installed Chrome (Playwright, no browser download).
usage: python tests/ui_zoom.py http://127.0.0.1:8799 <out folder>
"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
link = '#ovl=Main.common.ovl&res=FrontEndLogo%3Atex'
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1400, 'height': 850})
    pg.goto(base + '/' + link)
    pg.wait_for_function("document.getElementById('imgel').style.visibility === 'visible'", timeout=30000)
    pct = lambda: pg.inner_text('#zoompct')
    tf = lambda: pg.eval_on_selector('#imgel', 'e => e.style.transform')
    box = pg.locator('#img').bounding_box()
    print('fit          ', pct(), tf()); pg.screenshot(path=f'{out}/z1_fit.png')
    # wheel-zoom in 6 notches over the left kid's face (about 1/3 across, 40% down)
    x, y = box['x'] + box['width'] * 0.40, box['y'] + box['height'] * 0.40
    pg.mouse.move(x, y)
    for _ in range(6):
        pg.mouse.wheel(0, -240); pg.wait_for_timeout(60)
    print('wheel in     ', pct(), tf()); pg.screenshot(path=f'{out}/z2_wheel.png')
    # drag 300 px left and 150 px up
    pg.mouse.down(); pg.mouse.move(x - 300, y - 150, steps=10); pg.mouse.up()
    print('dragged      ', pct(), tf()); pg.screenshot(path=f'{out}/z3_drag.png')
    pg.click('#z-1'); print('1:1 button   ', pct())
    pg.keyboard.press('+'); print('+ key        ', pct())
    pg.mouse.dblclick(box['x'] + 50, box['y'] + 50); print('double-click ', pct(), tf())
    # a tiny icon: fit should enlarge it (capped at 8x)
    pg.goto(base + '/#ovl=Main.common.ovl&res=Guest_Stats_Calendar%3Agsi')
    pg.wait_for_function("document.getElementById('zoompct').textContent !== '' && document.getElementById('imgel').style.visibility === 'visible'", timeout=30000)
    pg.wait_for_timeout(300)
    print('icon fit     ', pct()); pg.screenshot(path=f'{out}/z4_icon.png')
    b.close()
