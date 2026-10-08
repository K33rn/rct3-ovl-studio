import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1500, 'height': 900})
    pg.goto(sys.argv[1] + '/'); pg.evaluate('localStorage.clear(); [`main`, `mixmaster`, `afe`, `laser-designer`, `jet-designer`].forEach(k => localStorage.setItem(`rct3ovl.tour.` + k, `1`))'); pg.goto(sys.argv[1] + '/#fireworks')
    pg.wait_for_selector('#fw .ent', timeout=180000); pg.wait_for_timeout(1500)
    js = """() => { const T = window.__fwdebug.terrain, g = T.ground.geometry;
      const bad = a => { let n = 0; for (const x of a.array) if (!Number.isFinite(x)) n++; return n; };
      return { pos: bad(g.attributes.position), nor: bad(g.attributes.normal), col: bad(g.attributes.color), h: T.heightAt(10, 10) }; }"""
    print('before', pg.evaluate(js))
    for tool in ('raise', 'lower', 'smooth', 'flatten', 'water'):
        pg.evaluate(f"window.__fwdebug.terrain.brush('{tool}', 8, 8, 4, 1, 0.5, {{level: 0.5, flatten: 2}})")
        print(tool, pg.evaluate(js))
    pg.wait_for_timeout(500)
    print('pixel sample', pg.evaluate("""() => { const c = document.querySelector('#fw-view canvas'); const g = document.createElement('canvas'); g.width = c.width; g.height = c.height;
       const x = g.getContext('2d'); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, g.width, g.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i+1] + d[i+2]; return s / (d.length / 4); }"""))
    pg.screenshot(path=sys.argv[2])
    b.close()
