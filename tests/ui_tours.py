"""Walkthroughs: the main tour starts on a first visit and every step finds its target; it hands over to the MixMaster
tour; the AFE and designer tours start on their first opening; "? Tour" replays. usage: python tests/ui_tours.py <base> <out>"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
snapped = []
os.makedirs(out, exist_ok=True)


def walk(pg, name, shots=()):
    pg.wait_for_selector('#tour .tcard', timeout=60000)
    seen, missing = 0, []
    global snapped
    while pg.query_selector('#tour'):
        pg.wait_for_function("!document.querySelector('#tour .tbody') || !document.querySelector('#tour .tbody').textContent.startsWith('…')", timeout=60000)
        pg.wait_for_timeout(350)
        if not pg.query_selector('#tour'):
            break
        pg.wait_for_function("document.querySelector('#tour .tcard')?.style.opacity === '1'", timeout=60000)
        title = pg.inner_text('#tour h4'); count = pg.inner_text('#tour .tcount')
        centred = pg.evaluate("document.querySelector('#tour .thole').classList.contains('none')")
        r1 = pg.evaluate("(() => { const r = document.querySelector('#tour .thole').getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); })()")
        pg.wait_for_timeout(450)
        r2 = pg.evaluate("(() => { const r = document.querySelector('#tour .thole')?.getBoundingClientRect(); return r ? [r.x, r.y, r.width, r.height].map(Math.round) : null; })()")
        if not centred and r2 and max(abs(a - b) for a, b in zip(r1, r2)) > 3:
            snapped.append((title, r1, r2))
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
    n, centred = walk(pg, 'mix', shots=(7, 11, 14, 21, 25, 30))
    print('mixmaster tour steps:', n, '| cards without a spotlight:', centred)
    print('spotlights that moved after appearing:', snapped)
    # "? Tour" while an editor is open runs that editor's tour
    pg.click('#fw-ptabs button[data-k="firework"]'); pg.click('#fw-create button'); pg.wait_for_selector('#fw .afe-tree .afe-node')
    pg.wait_for_timeout(1200); print('AFE opened after the MixMaster tour: its own tour again?', bool(pg.query_selector('#tour')))
    pg.click('#fw-tour'); n, c = walk(pg, 'afe', shots=(4,)); print('? Tour in the AFE ->', n, 'steps')
    pg.click('#fw .afe-top button[data-a="close"]'); pg.wait_for_timeout(500)
    pg.click('#fw-ptabs button[data-k="jet"]'); pg.click('#fw-create button'); pg.wait_for_selector('#fw .fwd-win .kt'); pg.wait_for_timeout(1000)
    pg.click('#fw-tour'); n, c = walk(pg, 'jetdesigner', shots=(3,)); print('? Tour in the jet designer ->', n, 'steps')
    pg.click('#fw .fwd-win header button')
    pg.click('#fw-tour'); pg.wait_for_selector('#tour .tcard'); print('? Tour replays the MixMaster tour:', pg.inner_text('#tour h4'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300); print('Esc closes it:', not pg.query_selector('#tour'))
    # the drag-preview hit test: height grid vs the old whole-mesh test
    print('ground hit, ms per call (new / old):', pg.evaluate("""() => { const D = window.__fwdebug, T = D.ctx.THREE, cam = D.ctx.camera, ray = new T.Raycaster();
      ray.setFromCamera(new T.Vector2(0.1, -0.4), cam); let t0 = performance.now(); for (let i = 0; i < 200; i++) D.terrain.raycast(ray.ray);
      const a = (performance.now() - t0) / 200; t0 = performance.now(); for (let i = 0; i < 200; i++) ray.intersectObject(D.terrain.ground);
      return [a.toFixed(3), ((performance.now() - t0) / 200).toFixed(3)]; }"""))
    print('errors:', errors[:6])
    b.close()
