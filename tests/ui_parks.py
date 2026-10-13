"""Parks tab: opens full window, lists every park, builds a park in 3D (terrain, water, paths, items, tracks, people)
and shows its information tabs. usage: python tests/ui_parks.py <base> <out> [park file ...]"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
want = sys.argv[3:] or ['Campaigns\\Base\\VanillaHills.dat']
os.makedirs(out, exist_ok=True)
DONE = 'window.__pkdebug.loaded === f'           # set when the park has finished loading
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1600, 'height': 920})
    errors = []
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.on('response', lambda r: r.status >= 400 and 'favicon' not in r.url and errors.append(f'HTTP {r.status} {r.url}'))
    pg.goto(base + '/')
    pg.evaluate("localStorage.clear(); [`main`, `mixmaster`, `afe`, `laser-designer`, `jet-designer`, `parks`].forEach(k => localStorage.setItem(`rct3ovl.tour.` + k, `1`))")
    pg.reload(); pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=180000)
    pg.screenshot(path=f'{out}/0_tabs.png', clip={'x': 0, 'y': 0, 'width': 320, 'height': 170})
    pg.click('#b-parks'); pg.wait_for_selector('#pk .pk', timeout=60000)
    print('parks listed:', pg.eval_on_selector_all('#pk .pk', 'es => es.length'), '| groups:', pg.eval_on_selector_all('#pk .grp', 'es => es.map(e => e.textContent)'))
    for i, f in enumerate(want):
        pg.evaluate('f => [...document.querySelectorAll("#pk .pk")].find(e => e.dataset.f === f).click()', f)
        pg.wait_for_function('f => ' + DONE, arg=f, timeout=300000); pg.wait_for_timeout(1500)
        st = pg.evaluate("""() => { const D = window.__pkdebug, n = g => { let k = 0; g.traverse(o => { if (o.isInstancedMesh) k += o.count; else if (o.isMesh) k++; }); return k; };
          return { title: document.getElementById('pk-title').textContent, items: D.world.items.length, scenery: n(D.layers.scenery), rides: n(D.layers.rides),
                   paths: D.layers.paths.children.length, water: D.layers.water.children.length, people: D.world.people.length, tracks: D.world.tracks.length }; }""")
        print(f, st)
        tag = os.path.basename(f)[:-4]
        pg.screenshot(path=f'{out}/{tag}_home.png')
        pg.click('#pk-itabs button[data-t="goals"]'); pg.wait_for_timeout(300)
        print('  goals:', pg.inner_text('#pk-ibody').replace('\n', ' | ')[:700])
        pg.screenshot(path=f'{out}/{tag}_goals.png')
        for t in ('rides', 'shops', 'people', 'money', 'research', 'scenery', 'data', 'overview'):
            pg.click(f'#pk-itabs button[data-t="{t}"]'); pg.wait_for_timeout(150)
        print('  overview:', pg.inner_text('#pk-ibody').replace('\n', ' | ')[:500])
        if i == 0:
            pg.click('#pk-itabs button[data-t="rides"]'); pg.wait_for_timeout(200)
            if pg.query_selector('#pk-ibody [data-ride]'):
                pg.click('#pk-ibody [data-ride]'); pg.wait_for_timeout(1500)
                pg.screenshot(path=f'{out}/{tag}_ride.png')
            pg.click('#pk-itabs button[data-t="overview"]')
    pg.click('#pk-back'); pg.wait_for_timeout(500)
    print('after back: pk', pg.evaluate("getComputedStyle(document.getElementById('pk')).display"), '| app', repr(pg.evaluate("document.getElementById('app').style.display")))
    print('errors:', errors[:8])
    b.close()
