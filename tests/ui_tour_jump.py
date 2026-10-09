"""Walkthrough step changes: the spotlight goes straight from one step's place to the next (sampled every frame,
nothing in between, never the middle of the screen). usage: python tests/ui_tour_jump.py <base>"""
import sys

from playwright.sync_api import sync_playwright

base = sys.argv[1]
SAMPLE = """() => { window.__holes = []; const f = () => { const h = document.querySelector('#tour .thole');
  if (!h) return; const r = h.getBoundingClientRect(); window.__holes.push([r.x, r.y, r.width, r.height].map(Math.round).join());
  window.__hraf = requestAnimationFrame(f); }; f(); }"""
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1600, 'height': 920})
    pg.goto(base + '/'); pg.evaluate('localStorage.clear()'); pg.goto(base + '/')
    bad, steps = [], 0
    for tour in ('main', 'mix'):
        if tour == 'mix':
            pg.click('#b-fireworks'); pg.wait_for_selector('#fw .ent', timeout=180000)
        pg.wait_for_selector('#tour .tcard', timeout=60000)
        while pg.query_selector('#tour'):
            pg.wait_for_function("document.querySelector('#tour .tcard')?.style.opacity === '1'", timeout=60000); pg.wait_for_timeout(300)
            before = pg.evaluate("(() => { const r = document.querySelector('#tour .thole').getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(); })()")
            last = pg.inner_text('#tour .tnext') == 'Finish'
            pg.evaluate(SAMPLE); pg.click('#tour .tnext')
            if last:
                break
            pg.wait_for_function("document.querySelector('#tour .tcard')?.style.opacity === '1'", timeout=60000); pg.wait_for_timeout(300)
            after = pg.evaluate("(() => { const r = document.querySelector('#tour .thole').getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(); })()")
            seen = pg.evaluate('cancelAnimationFrame(window.__hraf), [...new Set(window.__holes)]')
            other = [s for s in seen if s not in (before, after)]
            steps += 1
            if other:
                bad.append((tour, pg.inner_text('#tour h4'), before, after, other[:3]))
    print('step changes checked:', steps, '| spotlight positions other than the old and new place:', bad or 'none')
    b.close()
