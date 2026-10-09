"""Every park opens in the Parks tab: no page errors, no failed requests, every model and track built.
usage: python tests/ui_parks_all.py <base>"""
import sys
import time

from playwright.sync_api import sync_playwright

base = sys.argv[1]
DONE = "getComputedStyle(document.getElementById('pk-load')).opacity === '0'"
STATS = """() => { const D = window.__pkdebug, n = g => { let k = 0; g.traverse(o => { if (o.isInstancedMesh) k += o.count; else if (o.isMesh) k++; }); return k; };
  const tracks = D.world.tracks.length, built = Object.keys(D.rideSpots()).filter(k => D.world.tracks.some(t => String(t.id) === k)).length;
  return [D.world.items.length, n(D.layers.scenery) + n(D.layers.rides), tracks, built, (D.world.animals || []).length]; }"""
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1400, 'height': 860})
    errors = []
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.on('response', lambda r: r.status >= 400 and 'favicon' not in r.url and errors.append(f'HTTP {r.status} {r.url}'))
    pg.goto(base + '/')
    pg.evaluate("[`main`, `parks`].forEach(k => localStorage.setItem(`rct3ovl.tour.` + k, `1`))")
    pg.reload(); pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=180000)
    pg.click('#b-parks'); pg.wait_for_selector('#pk .pk', timeout=60000)
    files = pg.eval_on_selector_all('#pk .pk', 'es => es.map(e => e.dataset.f)')
    bad = []
    for f in files:
        before = len(errors); t0 = time.time()
        pg.evaluate('f => [...document.querySelectorAll("#pk .pk")].find(e => e.dataset.f === f).click()', f)
        try:
            pg.wait_for_function('f => window.__pkdebug.world?.file === f && ' + DONE, arg=f, timeout=300000)
        except Exception:
            bad.append((f, 'timeout', pg.inner_text('#pk-load'))); continue
        items, meshes, tracks, built, animals = pg.evaluate(STATS)
        print(f'{f[10:50]:40} {time.time() - t0:5.1f}s items {items:5} meshes {meshes:6} tracks {built}/{tracks} animals {animals}')
        if built != tracks or len(errors) > before:
            bad.append((f, errors[before:][:3], f'tracks {built}/{tracks}'))
    print('parks:', len(files), '| problems:', bad or 'none')
    b.close()
