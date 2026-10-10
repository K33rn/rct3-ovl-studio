import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1300, 'height': 800})
    logs = []
    pg.on('console', lambda m: m.type in ('error', 'warning') and logs.append(m.text[:400]))
    pg.goto(sys.argv[1] + '/'); pg.evaluate('localStorage.clear(); [`main`, `mixmaster`, `afe`, `laser-designer`, `jet-designer`].forEach(k => localStorage.setItem(`rct3ovl.tour.` + k, `1`))'); pg.goto(sys.argv[1] + '/#fireworks')
    pg.wait_for_selector('#fw .fwk', timeout=180000); pg.select_option('#fw-show', label='Stratosphere'); pg.wait_for_selector('#fw .ent', timeout=60000); pg.wait_for_timeout(1500)
    pg.evaluate("window.__fwdebug.ctx.previewEffect('laser', window.__fwdebug.REG.laser['SpinMaster.las'], {loop: true})")
    pg.wait_for_timeout(3000)
    print(pg.evaluate("""() => { const R = window.__fwdebug.ribbons, g = R.mesh.geometry;
       return { n: R.count(), vis: R.mesh.visible, range: g.drawRange, px: R.mesh.material.uniforms.px.value,
                a0: Array.from(g.attributes.aA.array.slice(0, 6)), b0: Array.from(g.attributes.aB.array.slice(0, 6)), w: Array.from(g.attributes.aW.array.slice(0, 4)),
                col: Array.from(g.attributes.aCol.array.slice(0, 4)), f: Array.from(g.attributes.aFade.array.slice(0, 2)), c: Array.from(g.attributes.aCorner.array.slice(0, 8)) }; }"""))
    print('logs:', logs[:6])
    pg.screenshot(path=sys.argv[2])
    b.close()
