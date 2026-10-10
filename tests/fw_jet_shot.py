import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1300, 'height': 800})
    pg.goto(sys.argv[1] + '/'); pg.evaluate('localStorage.clear(); [`main`, `mixmaster`, `afe`, `laser-designer`, `jet-designer`].forEach(k => localStorage.setItem(`rct3ovl.tour.` + k, `1`))'); pg.goto(sys.argv[1] + '/#fireworks')
    pg.wait_for_selector('#fw .fwk', timeout=180000); pg.select_option('#fw-show', label='Stratosphere'); pg.wait_for_selector('#fw .ent', timeout=60000); pg.wait_for_timeout(1000)
    pg.once('dialog', lambda d: d.accept()); pg.click('#fw-new'); pg.wait_for_timeout(2000)
    pg.select_option('#fw-cam', 'close'); pg.wait_for_timeout(300)
    for k in ('Sprinkler.wjt', 'MultiSpurt.wjt'):
        pg.evaluate(f"window.__fwdebug.ctx.previewEffect('jet', window.__fwdebug.REG.jet['{k}'], {{loop: true}})")
    pg.wait_for_timeout(3500)
    pg.screenshot(path=sys.argv[2])
    pg.click('#fw-create button')
    pg.wait_for_selector('#fw .afe-texgrid canvas', timeout=20000); pg.wait_for_timeout(2500)
    pg.screenshot(path=sys.argv[3])
    b.close()
