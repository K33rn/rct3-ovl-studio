import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1900, 'height': 1000})
    pg.goto(sys.argv[1] + '/#fireworks'); pg.wait_for_selector('#fw .ent', timeout=180000); pg.wait_for_timeout(1500)
    m = """() => { const v = document.getElementById('fw-view').getBoundingClientRect(), c = document.querySelector('#fw-view canvas'), cam = window.__fwdebug.ctx.camera;
       return { view: [Math.round(v.width), Math.round(v.height)], canvas: [c.width, c.height], css: [c.clientWidth, c.clientHeight], aspect: +cam.aspect.toFixed(3), real: +(v.width / v.height).toFixed(3) }; }"""
    print('mixmaster', pg.evaluate(m))
    pg.click('#fw-create button'); pg.wait_for_selector('#fw .afe-tree .afe-node', timeout=20000); pg.wait_for_timeout(1500)
    print('afe      ', pg.evaluate(m))
    pg.click('#fw .afe-top button[data-a="close"]'); pg.wait_for_timeout(800)
    print('back     ', pg.evaluate(m))
    b.close()
