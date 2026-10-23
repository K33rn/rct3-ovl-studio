"""MixMaster palette: water effects made as fireworks (.frw from water effects packs: AQUA, WW = Waltzing Waters) are
listed under Water Jets, not Fireworks; the game's own pyrotechnic fountains stay with the fireworks. A water effect
from the Water Jets tab previews and goes onto the timeline as the firework file it is. Read-only (nothing saved).
usage: python tests/ui_fw_water_list.py http://127.0.0.1:8790 <out folder>"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
problems = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1700, 'height': 1000})
    pg.on('pageerror', lambda e: problems.append(f'pageerror {e}'))
    pg.goto(base + '/')
    pg.evaluate("localStorage.clear(); ['main','mixmaster','afe','texgui','tex','gui'].forEach(k => localStorage.setItem('rct3ovl.tour.' + k, '1'))")
    pg.goto(base + '/#fireworks')
    pg.wait_for_selector('#fw .fwk', timeout=240000); pg.wait_for_timeout(1500)
    pg.click('#fw-new'); pg.wait_for_timeout(2500)
    data = pg.evaluate("fetch('/api/fw/data').then(r => r.json()).then(d => d.fireworks.map(f => [f.file, f.water]))")
    water = {f for f, w in data if w}
    print('fireworks:', len(data), 'water:', len(water))
    pg.click('#fw-ptabs button[data-k="firework"]'); pg.wait_for_timeout(500)
    fw_rows = pg.eval_on_selector_all('#fw-lib .fwk', 'e => e.map(x => x.dataset.f)')
    groups = pg.eval_on_selector_all('#fw-lib .libgrp', 'e => e.map(x => x.textContent)')
    print('Fireworks tab:', len(fw_rows), groups)
    if water & set(fw_rows): problems.append(f'water effects in the Fireworks tab: {sorted(water & set(fw_rows))[:3]}')
    for f in ('Fountain.frw', 'FairyFountain.frw', 'GreenPeony.frw'):
        if f not in fw_rows: problems.append(f'{f} missing from the Fireworks tab')
    if any('AQUA' in f or f.startswith('001 WW') for f in fw_rows): problems.append('AQUA / WW in the Fireworks tab')
    pg.screenshot(path=f'{out}/1_fireworks.png')
    pg.click('#fw-ptabs button[data-k="jet"]'); pg.wait_for_timeout(500)
    rows = pg.eval_on_selector_all('#fw-lib .fwk', 'e => e.map(x => [x.dataset.f, x.dataset.k])')
    groups = pg.eval_on_selector_all('#fw-lib .libgrp', 'e => e.map(x => x.textContent)')
    print('Water Jets tab:', len(rows), groups)
    wrows = {f for f, k in rows if k == 'firework'}
    if wrows != water: problems.append(f'Water Jets tab has {len(wrows)} water effects, expected {len(water)}')
    if not any(k == 'jet' for _, k in rows): problems.append('the game water jets are gone from the Water Jets tab')
    pg.screenshot(path=f'{out}/2_water.png')
    # preview one, then put it on the timeline by double-clicking an empty spot
    aqua = next(f for f in sorted(wrows) if 'AQUA' in f)
    sel = f'#fw-lib .fwk[data-f="{aqua}"]'
    pg.click(sel + ' .pv'); pg.wait_for_timeout(2500)
    pg.screenshot(path=f'{out}/3_preview.png')
    n0 = pg.eval_on_selector_all('#fw .ent', 'e => e.length')
    tl = pg.eval_on_selector('#fw-tl, #fw .tl, #fw-timeline', 'e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }')
    x, y = tl[0] + tl[2] * 0.6, tl[1] + tl[3] * 0.5
    pg.mouse.click(x, y); pg.wait_for_timeout(100); pg.mouse.click(x, y); pg.wait_for_timeout(800)
    n1 = pg.eval_on_selector_all('#fw .ent', 'e => e.length')
    print('timeline entries:', n0, '->', n1)
    if n1 != n0 + 1: problems.append('double-click did not add the water effect')
    b.close()
print('PROBLEMS:', problems or 'none')
