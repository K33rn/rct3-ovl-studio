"""Viewer: peep eating/drinking with a held item; a coaster's track-piece folder.
usage: python tests/ui_hold.py http://127.0.0.1:8799 <out folder>
"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
ready = "document.getElementById('msg').textContent === '' && document.getElementById('info').style.display === 'block'"
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1400, 'height': 850})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(base + '/#person=am01&anim=WalkDrinkRHand')
    pg.wait_for_function(ready, timeout=180000); pg.wait_for_timeout(3000)
    print('anim:', pg.eval_on_selector('#anim', 'e => e.value'), '| hold visible:', pg.is_visible('#g-hold'),
          '| holding:', pg.eval_on_selector('#hold', 'e => e.value'), '| options:', pg.eval_on_selector_all('#hold option', 'os => os.length'))
    pg.screenshot(path=f'{out}/drink.png')
    pg.select_option('#hold', index=5); pg.wait_for_timeout(2500)
    print('switched to:', pg.eval_on_selector('#hold', 'e => e.options[e.selectedIndex].text'))
    pg.screenshot(path=f'{out}/drink2.png')
    pg.select_option('#anim', 'WalkEatLHand'); pg.wait_for_timeout(4000)
    print('eat L | holding:', pg.eval_on_selector('#hold', 'e => e.options[e.selectedIndex].text'))
    pg.screenshot(path=f'{out}/eat.png')
    pg.select_option('#anim', 'Walk'); pg.wait_for_timeout(2000)
    print('walk | hold visible:', pg.is_visible('#g-hold'))
    # track pieces under the coaster's own folder
    pg.goto(base + '/'); pg.wait_for_function("document.querySelector('.ovl.trackset')", timeout=300000)
    n = pg.eval_on_selector_all('.ovl.trackset', 'ds => ds.length')
    pg.eval_on_selector('.ovl.trackset[data-p="trackset:woodenrc:trr"]', 'e => e.click()'); pg.wait_for_function(ready, timeout=120000); pg.wait_for_timeout(1500)
    print('track sets in tree:', n, '|', pg.inner_text('#ovltitle'), '|', pg.inner_text('#ovlsub'))
    pg.screenshot(path=f'{out}/woodenrc.png')
    print('page errors:', errors)
    b.close()
