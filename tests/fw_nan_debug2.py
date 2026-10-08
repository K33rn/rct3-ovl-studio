import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1200, 'height': 760})
    pg.goto(sys.argv[1] + '/'); pg.evaluate('localStorage.clear(); [`main`, `mixmaster`, `afe`, `laser-designer`, `jet-designer`].forEach(k => localStorage.setItem(`rct3ovl.tour.` + k, `1`))'); pg.goto(sys.argv[1] + '/#fireworks')
    pg.wait_for_selector('#fw .ent', timeout=180000); pg.wait_for_timeout(1500)
    pg.evaluate("window.__fwdebug.terrain.brush('lower', 0, 20, 5, 1, 0.5, {}); window.__fwdebug.terrain.brush('water', 0, 20, 5, 1, 1, {level: 0.5})")
    pg.wait_for_timeout(400); pg.screenshot(path=sys.argv[2] + '_a.png', clip={'x': 280, 'y': 90, 'width': 880, 'height': 540})
    b.close()
