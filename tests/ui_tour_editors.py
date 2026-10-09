"""MixMaster walkthrough inside the advanced editors: going from one editor step to the next keeps that editor open
(sampled every frame; no flash back to the MixMaster). usage: python tests/ui_tour_editors.py <base>"""
import sys

from playwright.sync_api import sync_playwright

base = sys.argv[1]
VIEW = "(() => { const r = document.getElementById('fw'); return r.classList.contains('afe') ? 'afe' : r.querySelector('.fwd-win')?.dataset.kind || 'mix'; })()"
SAMPLE = "() => { window.__views = []; const f = () => { window.__views.push(" + VIEW + "); window.__vraf = requestAnimationFrame(f); }; f(); }"
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1600, 'height': 920})
    pg.goto(base + '/')
    pg.evaluate("localStorage.clear(); localStorage.setItem(`rct3ovl.tour.main`, `1`)")
    pg.reload(); pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=180000)
    pg.click('#b-fireworks'); pg.wait_for_selector('#fw .ent', timeout=180000)
    pg.wait_for_selector('#tour .tcard', timeout=60000)
    bad, inside = [], 0
    while pg.query_selector('#tour'):
        pg.wait_for_function("document.querySelector('#tour .tcard')?.style.opacity === '1'", timeout=60000); pg.wait_for_timeout(250)
        v0 = pg.evaluate(VIEW); last = pg.inner_text('#tour .tnext') == 'Finish'
        pg.evaluate(SAMPLE); pg.click('#tour .tnext')
        if last:
            break
        pg.wait_for_function("document.querySelector('#tour .tcard')?.style.opacity === '1'", timeout=60000); pg.wait_for_timeout(250)
        v1 = pg.evaluate(VIEW)
        seen = pg.evaluate('cancelAnimationFrame(window.__vraf), [...new Set(window.__views)]')
        if v0 == v1 and v0 != 'mix':
            inside += 1
        if any(v not in (v0, v1) for v in seen):
            bad.append((pg.inner_text('#tour h4'), v0, v1, seen))
    print('editor-to-editor step changes:', inside, '| step changes that showed another view in between:', bad or 'none')
    b.close()
