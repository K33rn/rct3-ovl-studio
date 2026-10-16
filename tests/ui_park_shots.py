"""Open parks in the Parks tab and screenshot each from its opening view (and optionally fly the camera to a point).
usage: python tests/ui_park_shots.py <base> <out> <park title> [<park title> ...]
A title may end with @cam (the park's saved camera) or @x,y,z,dist (or @tCOL,ROW,dist) to look at that park point (metres, park coordinates) from dist metres away."""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=d3d11', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1600, 'height': 900})
    errors = []
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: m.type == 'error' and errors.append('console: ' + m.text[:200]))
    pg.goto(base + '/')
    pg.evaluate("[`main`, `mixmaster`, `afe`, `parks`].forEach(k => localStorage.setItem(`rct3ovl.tour.` + k, `1`))")
    pg.reload(); pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=300000)
    pg.click('#b-parks'); pg.wait_for_selector('#pk .pk', timeout=60000)
    for arg in sys.argv[3:]:
        title, _, at = arg.partition('@')
        f = pg.evaluate('t => [...document.querySelectorAll("#pk .pk")].find(e => e.textContent.trim().replace(/^\\d+\\s*/, "") === t)?.dataset.f', title)
        if not f:
            print('no park', title); continue
        pg.evaluate('f => [...document.querySelectorAll("#pk .pk")].find(e => e.dataset.f === f).click()', f)
        pg.wait_for_function('f => window.__pkdebug.loaded === f', arg=f, timeout=600000); pg.wait_for_timeout(4000)
        if at == 'cam':                               # the park's own saved camera
            pg.click('#pk-gamecam'); pg.wait_for_timeout(3000)
        elif at:
            yaw = 0.0
            if at.startswith('t'):                    # tC,R,dist[,yaw]: tile column / row, camera bearing (rad)
                c, r, d, *rest = map(float, at[1:].split(','))
                yaw = rest[0] if rest else 0.75
                x, z, y = pg.evaluate('''([c, r]) => { const W = window.__pkdebug.world;
                    const x = W.x0 + 4 * c + 2, z = W.z0 + 4 * r + 2; return [x, z, window.__pkdebug.heightAt(x, -z) || 0]; }''', [c, r])
            else:
                x, y, z, d = map(float, at.split(',')); yaw = 0.75
            pg.evaluate("""([x, y, z, d, a]) => { const D = window.__pkdebug; D.controls.target.set(x, y, -z);
                D.camera.position.set(x + d * 0.8 * Math.cos(a), y + d * 0.6, -z + d * 0.8 * Math.sin(a)); D.controls.update(); }""", [x, y, z, d, yaw])
            pg.wait_for_timeout(2500)
        tag = title.replace(' ', '_').replace('!', '') + ('_' + at.replace(',', '_') if at else '')
        pg.screenshot(path=f'{out}/{tag}.png', clip={'x': 250, 'y': 40, 'width': 1100, 'height': 860})
        print('shot', tag)
    print('errors:', errors[:10])
    b.close()
