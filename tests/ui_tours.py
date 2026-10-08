"""Walkthroughs: the main tour starts on a first visit and every step finds its target; it hands over to the MixMaster
tour; the AFE and designer tours start on their first opening; "? Tour" replays. usage: python tests/ui_tours.py <base> <out>"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)


def walk(pg, name, shots=()):
    pg.wait_for_selector('#tour .tcard', timeout=60000)
    seen, missing = 0, []
    while pg.query_selector('#tour'):
        pg.wait_for_function("!document.querySelector('#tour .tbody') || !document.querySelector('#tour .tbody').textContent.startsWith('…')", timeout=60000)
        pg.wait_for_timeout(350)
        if not pg.query_selector('#tour'):
            break
        title = pg.inner_text('#tour h4'); count = pg.inner_text('#tour .tcount')
        centred = pg.evaluate("document.querySelector('#tour .thole').classList.contains('none')")
        seen += 1
        print(f'  {name} {count:>7} {"(card)" if centred else "spot  "} {title}')
        if centred:
            missing.append(title)
        if seen in shots:
            pg.screenshot(path=f'{out}/{name}_{seen}.png')
        nxt = pg.inner_text('#tour .tnext')
        pg.click('#tour .tnext')
        if nxt == 'Finish':
            break
    return seen, missing


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1600, 'height': 920})
    errors = []
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.goto(base + '/'); pg.evaluate('localStorage.clear()'); pg.goto(base + '/')
    n, centred = walk(pg, 'main', shots=(1, 3, 5, 9, 12))
    print('main tour steps:', n, '| cards without a spotlight:', centred)
    pg.reload(); pg.wait_for_timeout(3000)
    print('main tour again on reload?', bool(pg.query_selector('#tour')))
    pg.click('#b-fireworks'); pg.wait_for_selector('#fw .ent', timeout=180000)
    n, centred = walk(pg, 'mix', shots=(7, 8, 10, 15, 17, 20))
    print('mixmaster tour steps:', n, '| cards without a spotlight:', centred)
    pg.click('#fw-ptabs button[data-k="firework"]'); pg.click('#fw-create button')
    n, centred = walk(pg, 'afe', shots=(4,))
    print('afe tour steps:', n, '| cards without a spotlight:', centred)
    pg.click('#fw .afe-top button[data-a="close"]'); pg.wait_for_timeout(500)
    pg.click('#fw-ptabs button[data-k="laser"]'); pg.click('#fw-create button')
    n, centred = walk(pg, 'designer', shots=(2,))
    print('designer tour steps:', n, '| cards without a spotlight:', centred)
    pg.click('#fw .fwd-win header button')
    pg.click('#fw-tour'); pg.wait_for_selector('#tour .tcard'); print('? Tour replays the MixMaster tour:', pg.inner_text('#tour h4'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300); print('Esc closes it:', not pg.query_selector('#tour'))
    print('errors:', errors[:6])
    b.close()
