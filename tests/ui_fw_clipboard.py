"""Fireworks editor: box-select, Ctrl-click, group move, copy/cut/paste (also into another show), bulk edits, undo.
usage: python tests/ui_fw_clipboard.py http://127.0.0.1:8799 <out folder>
"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1500, 'height': 900})
    errors = []
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.goto(base + '/')
    pg.evaluate('localStorage.clear()')
    pg.goto(base + '/#fireworks')
    pg.wait_for_selector('#fw .ent', timeout=180000); pg.wait_for_timeout(1500)
    n = lambda: pg.eval_on_selector_all('#fw .ent', 'es => es.length')
    nsel = lambda: pg.eval_on_selector_all('#fw .ent.sel, #fw .ent.multi', 'es => es.length')
    head = lambda: pg.inner_text('#fw-entry').split('\n')[0]
    lb = pg.locator('#fw-lanes').bounding_box()
    print('start: launches', n())
    # box-select: drag across tracks 1-4, 0.5 s .. 9 s (40 px per second)
    # (starts on empty space: track 9 at 9 s; ends on track 1 at 1 s)
    pg.mouse.move(lb['x'] + 360, lb['y'] + 8 * 26 + 13); pg.mouse.down()
    pg.mouse.move(lb['x'] + 200, lb['y'] + 100, steps=5); pg.mouse.move(lb['x'] + 40, lb['y'] + 4, steps=5)
    pg.screenshot(path=f'{out}/1_band.png'); pg.mouse.up()
    print('box-selected:', nsel(), '| inspector:', head())
    pg.screenshot(path=f'{out}/2_selected.png')
    # copy, move playhead to 40 s, paste
    pg.keyboard.press('Control+c')
    rb = pg.locator('#fw-ruler').bounding_box()
    pg.locator('#fw-lanes').evaluate('e => e.scrollLeft = 0')
    pg.evaluate("window.__fwdebug.S.t = 0")
    pg.mouse.click(rb['x'] + 40 * 25, rb['y'] + 10)          # playhead at 25 s
    before = n(); pg.keyboard.press('Control+v')
    print('pasted:', n() - before, 'launches at', pg.inner_text('#fw-time').split(' /')[0], '| now selected', nsel(), '|', head())
    pg.screenshot(path=f'{out}/3_pasted.png')
    times = pg.evaluate("[...window.__fwdebug.S.multi].map(e => e.time).sort((a,b)=>a-b).slice(0,4)")
    print('pasted times start at', times)
    # nudge right 1 s with Shift+Arrow, then bulk colour, then undo twice
    pg.keyboard.press('Shift+ArrowRight')
    print('after nudge:', pg.evaluate("[...window.__fwdebug.S.multi].map(e => e.time).sort((a,b)=>a-b)[0]"))
    pg.eval_on_selector('#fw-entry input[data-k="b-tint"]', "e => { e.value = '#ff2060'; e.dispatchEvent(new Event('change', {bubbles: true})); }")
    print('tinted:', pg.evaluate("[...window.__fwdebug.S.multi].every(e => e.tint && e.tint[0] === 1)"))
    pg.keyboard.press('Control+z'); pg.keyboard.press('Control+z'); pg.keyboard.press('Control+z')
    print('after 3 undos:', n(), 'launches (expect', before, ')')
    # ctrl-click two launches, cut, paste into a different show
    els = pg.locator('#fw .ent')
    els.nth(0).click(); els.nth(5).click(modifiers=['Control'])
    print('ctrl-click selected:', nsel(), '|', head())
    pg.keyboard.press('Control+x'); print('after cut:', n())
    pg.select_option('#fw-show', label='Haunted Skies'); pg.wait_for_timeout(1500)
    m0 = n(); pg.keyboard.press('Control+v')
    print('pasted into Haunted Skies:', n() - m0, '|', head())
    # select all, delete, undo
    pg.keyboard.press('Control+a'); print('select all:', nsel()); pg.keyboard.press('Delete'); print('after delete:', n())
    pg.keyboard.press('Control+z'); print('after undo:', n())
    pg.keyboard.press('Escape'); print('esc clears selection:', nsel(), '| editor still open:', pg.evaluate("getComputedStyle(document.getElementById('fw')).display"))
    print('errors:', errors)
    b.close()
