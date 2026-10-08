"""Viewer: Fireworks editor - opens full window, plays a show, previews, edits the timeline, goes back.
usage: python tests/ui_fireworks.py http://127.0.0.1:8799 <out folder>
"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1500, 'height': 900})
    errors = []
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: m.type == 'error' and errors.append('console: ' + m.text))
    pg.goto(base + '/')
    pg.evaluate("localStorage.clear(); [`main`, `mixmaster`, `afe`, `laser-designer`, `jet-designer`].forEach(k => localStorage.setItem(`rct3ovl.tour.` + k, `1`))")
    pg.reload()
    pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=180000)
    print('tabs:', pg.eval_on_selector_all('.tabs button', 'bs => bs.map(b => b.textContent)'))
    pg.screenshot(path=f'{out}/0_tabs.png', clip={'x': 0, 'y': 0, 'width': 320, 'height': 160})
    pg.click('#b-fireworks')
    pg.wait_for_selector('#fw .fwk', timeout=180000)
    pg.wait_for_timeout(3000)
    print('fw visible:', pg.evaluate("getComputedStyle(document.getElementById('fw')).display"), '| app hidden:',
          pg.evaluate("document.getElementById('app').style.display"), '| hash', pg.evaluate('location.hash'))
    print('show:', pg.eval_on_selector('#fw-show', 'e => e.options[e.selectedIndex].text'), '| launches on timeline:',
          pg.eval_on_selector_all('#fw .ent', 'es => es.length'), '| fireworks:', pg.eval_on_selector_all('#fw .fwk', 'es => es.length'))
    print('show info:', pg.inner_text('#fw-showinfo').replace('\n', ' | '))
    pg.screenshot(path=f'{out}/1_open.png')
    # play the show for a while (set speed 2x to reach the busy part)
    pg.click('#fw-play'); pg.wait_for_timeout(6000)
    print('time:', pg.inner_text('#fw-time'), '|', pg.inner_text('#fw-stats'))
    pg.screenshot(path=f'{out}/2_playing.png')
    # seek into the show via the ruler
    pg.click('#fw-play')
    rb = pg.locator('#fw-ruler').bounding_box()
    pg.mouse.click(rb['x'] + 22 * 40, rb['y'] + 10)
    pg.wait_for_timeout(800)
    print('after seek:', pg.inner_text('#fw-time'), '|', pg.inner_text('#fw-stats'))
    pg.screenshot(path=f'{out}/3_seek.png')
    # preview one firework
    pg.click('#fw .fwk[data-f="GreenPeony.frw"] .pv'); pg.wait_for_timeout(1800)
    print('preview:', pg.inner_text('#fw-stats'))
    pg.screenshot(path=f'{out}/4_preview.png')
    # add a launch by double-clicking the timeline, then undo
    n0 = pg.eval_on_selector_all('#fw .ent', 'es => es.length')
    lb = pg.locator('#fw-lanes').bounding_box()
    pg.mouse.dblclick(lb['x'] + 300, lb['y'] + 12)
    n1 = pg.eval_on_selector_all('#fw .ent', 'es => es.length')
    print('selected after add:', pg.inner_text('#fw-entry').replace('\n', ' | ')[:200])
    pg.keyboard.press('Control+z')
    print('entries before/after add/after undo:', n0, n1, pg.eval_on_selector_all('#fw .ent', 'es => es.length'))
    # back
    pg.click('#fw-back'); pg.wait_for_timeout(500)
    print('after back: fw', pg.evaluate("getComputedStyle(document.getElementById('fw')).display"), '| app', repr(pg.evaluate("document.getElementById('app').style.display")))
    pg.screenshot(path=f'{out}/5_back.png')
    print('errors:', errors[:8])
    b.close()
