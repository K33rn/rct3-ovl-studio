"""The tree's "No new folders or files" answers the Refresh button only: the automatic check when you come back to the
window says nothing unless it found something. The Mod Loader lists the Heartline loop under Additions. Read-only.
usage: python tests/ui_refresh_quiet.py http://127.0.0.1:8790 <out folder>"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
problems = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1600, 'height': 950})
    pg.on('pageerror', lambda e: problems.append(f'pageerror {e}'))
    pg.goto(base + '/')
    pg.evaluate("localStorage.clear(); ['main','mods'].forEach(k => localStorage.setItem('rct3ovl.tour.' + k, '1'))")
    pg.goto(base + '/')
    pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=240000)
    pg.wait_for_timeout(1000)
    idle = pg.inner_text('#msg')
    print('idle:', idle)
    # coming back to the window (the automatic check runs at most every 15 s: pretend the last was long ago)
    pg.evaluate("lastCheck = 0; window.dispatchEvent(new Event('focus'))")
    pg.wait_for_timeout(4000)
    after_focus = pg.inner_text('#msg')
    print('after focus:', after_focus)
    if 'No new folders or files' in after_focus:
        problems.append('the automatic check shows "No new folders or files"')
    pg.click('#treerefresh'); pg.wait_for_timeout(4000)
    after_btn = pg.inner_text('#msg')
    print('after Refresh:', after_btn)
    if 'No new folders or files' not in after_btn and 'Found' not in after_btn and 'removed' not in after_btn:
        problems.append('the Refresh button gave no answer')
    pg.screenshot(path=f'{out}/1_refresh.png')
    pg.goto(base + '/#mods')
    pg.wait_for_selector('#md-list h3.sec', timeout=240000); pg.wait_for_timeout(1000)
    secs = pg.eval_on_selector_all('#md-list h3.sec', 'e => e.map(x => x.textContent)')
    adds = pg.eval_on_selector_all('#md-list button[data-add]', 'e => e.map(x => [x.dataset.add, x.textContent])')
    print('sections:', secs, 'additions:', adds)
    if not any(a == 'heartline-loop' for a, _ in adds):
        problems.append('no Heartline loop under Additions')
    found = pg.eval_on_selector_all('#md-list .pkg b', 'e => e.map(x => x.textContent)')
    if any('loop' in f.lower() for f in found):
        problems.append(f'the loop files listed as found content: {found}')
    pg.screenshot(path=f'{out}/2_additions.png')
    b.close()
print('PROBLEMS:', problems or 'none')
