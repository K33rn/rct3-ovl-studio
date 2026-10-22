"""Every park opens in the Parks tab: no page errors, no failed requests, every model and track built, every raised
path support reaching up to the first path piece above it with no pieces overlapping. Given parts of file names, only
those parks, each with a screenshot in the working folder.
usage: python tests/ui_parks_all.py <base> [<part of a park's file name> ...]"""
import sys
import time

from playwright.sync_api import sync_playwright

base, only = sys.argv[1], [a.lower() for a in sys.argv[2:]]
DONE = 'window.__pkdebug.loaded === f'           # set when the park has finished loading
STATS = """() => { const D = window.__pkdebug, n = g => { let k = 0; g.traverse(o => { if (o.isInstancedMesh) k += o.count; else if (o.isMesh) k++; }); return k; };
  const tracks = D.world.tracks.length, built = Object.keys(D.rideSpots()).filter(k => D.world.tracks.some(t => String(t.id) === k)).length;
  return [D.world.items.length, n(D.layers.scenery) + n(D.layers.rides), tracks, built, (D.world.animals || []).length]; }"""
# path supports: each column (pieces that touch) must end on the first path surface straight above its bottom
SUPPORTS = """async () => { const THREE = await import('three'), D = window.__pkdebug, W = D.world;
  const H = {}; for (const p of Object.values(W.support_parts || {})) { if (p.bottom) H[p.bottom] = 1; for (const [k, v] of Object.entries(p.middle || {})) H[v] = +k; }
  const end = p => p[2] + (H[p[0]] ?? 1) * (p[5] || 1), cols = new Map();
  for (const s of D.pathSupports()) { const k = s[1] + ',' + s[3]; if (!cols.has(k)) cols.set(k, []); cols.get(k).push(s); }
  const own = o => { while (o) { if (o.userData.items) return o.userData.items; o = o.parent; } }, pm = [], sides = new Map();
  D.layers.scenery.traverse(o => { if (o.isMesh && own(o)?.[0]?.[6] === 1) pm.push(o); });
  for (const o of pm) for (const m of [o.material].flat()) if (!sides.has(m)) { sides.set(m, m.side); m.side = THREE.DoubleSide; }
  const ray = new THREE.Raycaster(); let n = 0, overlap = 0; const bad = [];
  for (const [k, ps] of cols) { const [x, z] = k.split(',').map(Number); ps.sort((a, b) => a[2] - b[2]);
    const st = [[ps[0]]];
    for (let i = 1; i < ps.length; i++) { const e = end(ps[i - 1]); if (ps[i][2] > e + 0.02) st.push([ps[i]]); else { if (ps[i][2] < e - 0.01) overlap++; st[st.length - 1].push(ps[i]); } }
    for (const s of st) { n++; const top = end(s[s.length - 1]);
      ray.set(new THREE.Vector3(x, s[0][2] + 0.05, -z), new THREE.Vector3(0, 1, 0)); ray.far = 60;
      const y = ray.intersectObjects(pm, false)[0]?.point.y;
      if (y == null || Math.abs(y - top) > 0.1) bad.push([x, z, +top.toFixed(2), y == null ? null : +y.toFixed(2)]); } }
  for (const [m, side] of sides) m.side = side;
  return [n, overlap, bad.slice(0, 4), bad.length]; }"""
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
    if only:
        files = [f for f in files if any(o in f.lower() for o in only)]
    bad = []
    for f in files:
        before = len(errors); t0 = time.time()
        pg.evaluate('f => [...document.querySelectorAll("#pk .pk")].find(e => e.dataset.f === f).click()', f)
        try:
            pg.wait_for_function('f => ' + DONE, arg=f, timeout=300000)
        except Exception:
            bad.append((f, 'timeout', pg.inner_text('#pk-load'))); continue
        items, meshes, tracks, built, animals = pg.evaluate(STATS)
        cols, overlap, off, n_off = pg.evaluate(SUPPORTS)
        if only:
            pg.wait_for_timeout(1500); pg.screenshot(path='park_' + ''.join(c if c.isalnum() else '_' for c in f)[-40:] + '.png')
        print(f'{f[10:50]:40} {time.time() - t0:5.1f}s items {items:5} meshes {meshes:6} tracks {built}/{tracks} animals {animals} path supports {cols}')
        if built != tracks or len(errors) > before or overlap or n_off:
            bad.append((f, errors[before:][:3], f'tracks {built}/{tracks}', f'supports overlapping {overlap}, not meeting their path {n_off} {off}'))
    print('parks:', len(files), '| problems:', bad or 'none')
    b.close()
