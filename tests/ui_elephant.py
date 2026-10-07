"""Viewer: open the elephant, check the animation menu, play Walk and Run, screenshot.
usage: python tests/ui_elephant.py http://127.0.0.1:8799 <out folder>
"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1400, 'height': 850})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(base + '/#ovl=Cars%5CTrackedRideCars%5CElephant%5CElephant.common.ovl&res=ElephantTransport%3Amdl')
    pg.wait_for_function("document.getElementById('msg').textContent === '' && document.getElementById('info').style.display === 'block'", timeout=60000)
    pg.wait_for_timeout(1500)
    opts = pg.eval_on_selector_all('#anim option', 'os => os.map(o => o.textContent)')
    print('animation menu:', opts, '| selected:', pg.eval_on_selector('#anim', 'e => e.value'))
    pg.screenshot(path=f'{out}/walk.png')
    pg.select_option('#anim', 'Run'); pg.wait_for_timeout(1200); pg.screenshot(path=f'{out}/run.png')
    print('info:', pg.inner_text('#info').replace('\n', ' | ')[:300])
    print('page errors:', errors)
    b.close()
