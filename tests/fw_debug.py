"""Debug the firework simulation in the page. usage: python tests/fw_debug.py http://127.0.0.1:8799"""
import sys

from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page()
    pg.on('pageerror', lambda e: print('pageerror', e))
    pg.goto(sys.argv[1] + '/#fireworks')
    pg.wait_for_selector('#fw .fwk', timeout=180000); pg.wait_for_timeout(2000)
    print(pg.evaluate("""() => {
      const D = window.__fwdebug; const out = [];
      D.parts().length = 0;
      D.launch({ firework: 'GreenPeony.frw', launcher: 0, slot: 0 }, true);
      for (let i = 0; i < 240; i++) {
        D.step(1 / 60);
        if (i % 20 == 0) {
          const ps = D.parts();
          const kinds = {}; for (const q of ps) { const k = (q.d.n.TextureNameReduced || 'base') + ' life ' + q.life.toFixed(2); kinds[k] = (kinds[k] || 0) + 1; }
          out.push(`t=${((i + 1) / 60).toFixed(2)} n=${ps.length} ` + JSON.stringify(kinds) + (ps[0] ? ` y=${ps[0].y.toFixed(1)} v=${ps[0].vy.toFixed(1)}` : ''));
        }
      }
      const fw = D.FW['GreenPeony.frw'], d = D.descInfo(fw, fw.root);
      out.push('root emitters ' + JSON.stringify(d.emitters));
      return out.join(' ## ');
    }"""))
    b.close()
