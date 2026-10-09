"""The Parks walkthrough starts on the first opening and every step finds its target; "? Tour" replays it.
usage: python tests/ui_parks_tour.py <base> <out>"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1600, 'height': 920})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(base + '/')
    pg.evaluate("localStorage.clear(); localStorage.setItem(`rct3ovl.tour.main`, `1`)")
    pg.reload(); pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=180000)
    pg.click('#b-parks'); pg.wait_for_selector('#tour .tcard', timeout=60000)
    steps, spot = 0, []
    while pg.query_selector('#tour'):
        pg.wait_for_function("document.querySelector('#tour .tcard')?.style.opacity === '1'", timeout=60000); pg.wait_for_timeout(300)
        steps += 1
        title = pg.inner_text('#tour h4')
        spot.append((title, not pg.evaluate("document.querySelector('#tour .thole').classList.contains('none')")))
        pg.screenshot(path=f'{out}/parks_tour_{steps}.png')
        last = pg.inner_text('#tour .tnext') == 'Finish'
        pg.click('#tour .tnext')
        if last:
            break
    print('parks tour steps:', steps, '|', spot)
    pg.wait_for_timeout(500)
    print('tour again on reopening?', bool(pg.query_selector('#tour')))
    pg.click('#pk-tour'); pg.wait_for_selector('#tour .tcard'); print('? Tour replays:', pg.inner_text('#tour h4'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    print('errors:', errors)
    b.close()
