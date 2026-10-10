import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1300, 'height': 800})
    pg.goto(sys.argv[1] + '/'); pg.evaluate('localStorage.clear(); [`main`, `mixmaster`, `afe`, `laser-designer`, `jet-designer`].forEach(k => localStorage.setItem(`rct3ovl.tour.` + k, `1`))'); pg.goto(sys.argv[1] + '/#fireworks')
    pg.wait_for_selector('#fw .fwk', timeout=180000); pg.select_option('#fw-show', label='Stratosphere'); pg.wait_for_selector('#fw .ent', timeout=60000); pg.wait_for_timeout(1500)
    print(pg.evaluate("""() => { const D = window.__fwdebug, R = D.ribbons, cam = D.ctx.camera;
      const end = R.end; R.begin(); R.add(-30, 20, 0, 30, 40, 0, 4, 4, 1, 0.2, 0.2, 1, 1, 1); end();
      R.begin = () => {}; R.end = () => {}; R.add = () => {};
      const ren = D.ctx.renderer; ren.debug.checkShaderErrors = true;
      return { cam: cam.position.toArray().map(x => x.toFixed(1)), tgt: D.ctx.controls.target.toArray(), progs: ren.info.programs.length,
               mat: R.mesh.material.type, uni: Object.keys(R.mesh.material.uniforms) }; }"""))
    pg.wait_for_timeout(800)
    gl = pg.evaluate("""() => { const ren = window.__fwdebug.ctx.renderer, gl = ren.getContext(); const p = ren.info.programs.map(x => x.name + ':' + (x.diagnostics ? JSON.stringify(x.diagnostics).slice(0, 300) : 'ok')); return { err: gl.getError(), progs: p.slice(-8) }; }""")
    print(gl)
    pg.screenshot(path=sys.argv[2])
    b.close()
