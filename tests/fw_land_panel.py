"""Landscape panel: every control stays inside the panel. usage: python tests/fw_land_panel.py <base> <screenshot>"""
import sys

from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1900, 'height': 680})
    pg.goto(sys.argv[1] + '/#fireworks'); pg.wait_for_selector('#fw .ent', timeout=180000); pg.wait_for_timeout(1000)
    pg.click('#fw-land'); pg.wait_for_timeout(300)
    print(pg.evaluate("""() => { const P = document.getElementById('fw-landp').getBoundingClientRect();
      return [...document.querySelectorAll('#fw-landp input, #fw-landp button')].map(e => { const r = e.getBoundingClientRect();
        return (e.id || e.dataset.t || e.textContent) + ': ' + (r.right <= P.right - 4 && r.left >= P.left + 4 ? 'inside' : `OUT by ${Math.round(r.right - P.right + 4)}px`); }); }"""))
    pg.screenshot(path=sys.argv[2], clip={'x': 270, 'y': 40, 'width': 320, 'height': 320})
    b.close()
