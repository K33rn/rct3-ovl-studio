"""MixMaster: prices toggle, scene (day / ground / backdrop), bases tab, drag & drop into 3D (grid and free), moving launchers.
usage: python tests/ui_place.py <base> <out folder>"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1700, 'height': 950})
    errors = []
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.on('response', lambda r: r.status >= 400 and 'favicon' not in r.url and errors.append(f'{r.status} {r.url}'))
    pg.goto(base + '/'); pg.evaluate('localStorage.clear()'); pg.goto(base + '/#fireworks')
    pg.wait_for_selector('#fw .ent', timeout=180000); pg.wait_for_timeout(1500)
    D = 'window.__fwdebug'
    pg.once('dialog', lambda d: d.accept()); pg.click('#fw-new'); pg.wait_for_timeout(2000)
    # prices
    vis = lambda: pg.eval_on_selector_all('#fw-lib .price', "es => es.filter(e => e.offsetParent).length")
    print('prices visible:', vis()); pg.click('#fw-prices'); print('after toggle:', vis()); pg.click('#fw-prices'); print('back on:', vis())
    # scene: day + game ground + backdrop
    pg.click('#fw-scenebtn'); pg.click('#fw-sky button[data-s="day"]'); pg.click('#fw-grounds button[data-g="6"]'); pg.select_option('#fw-backdrop', 'Hill')
    pg.wait_for_timeout(1500); print('scene:', pg.evaluate(f'JSON.stringify({D}.S.show.scene)'))
    pg.screenshot(path=f'{out}/1_day.png'); pg.click('#fw-scenebtn')
    # bases tab
    pg.click('#fw-ptabs button[data-k="base"]'); pg.wait_for_timeout(3000)
    print('bases:', pg.eval_on_selector_all('#fw-lib .base', 'bs => bs.map(b => b.dataset.base + (b.querySelector("img").src.startsWith("data:") ? "+pic" : ""))'))
    pg.screenshot(path=f'{out}/2_bases.png')
    vb = pg.locator('#fw-view').bounding_box()
    n0 = pg.evaluate(f'{D}.S.show.launchers.length')
    pg.drag_and_drop('#fw-lib .base[data-base="CWFW"]', '#fw-view', target_position={'x': vb['width'] * 0.3, 'y': vb['height'] * 0.75})
    pg.wait_for_timeout(1500)
    print('after grid drop:', pg.evaluate(f'{D}.S.show.launchers.length'), '(was', n0, ')', pg.evaluate(f'JSON.stringify({D}.S.show.launchers.at(-1))'))
    # free placement
    pg.click('#fw-grid')
    pg.drag_and_drop('#fw-lib .base[data-base="LazerDome"]', '#fw-view', target_position={'x': vb['width'] * 0.62, 'y': vb['height'] * 0.78})
    pg.wait_for_timeout(1500)
    print('after free drop:', pg.evaluate(f'JSON.stringify({D}.S.show.launchers.at(-1))'))
    # effect dropped on the ground -> new base + entry at the playhead
    pg.click('#fw-ptabs button[data-k="laser"]')
    pg.drag_and_drop('#fw-lib .fwk[data-f="SpinMaster.las"]', '#fw-view', target_position={'x': vb['width'] * 0.75, 'y': vb['height'] * 0.85})
    pg.wait_for_timeout(1500)
    print('laser drop:', pg.evaluate(f"JSON.stringify({D}.S.show.entries.at(-1))"), '| launchers', pg.evaluate(f'{D}.S.show.launchers.length'))
    pg.click('#fw-ptabs button[data-k="firework"]')
    pg.drag_and_drop('#fw-lib .fwk[data-f="GreenPeony.frw"]', '#fw-view', target_position={'x': vb['width'] * 0.45, 'y': vb['height'] * 0.8})
    pg.wait_for_timeout(2500)
    print('firework drop:', pg.evaluate(f"JSON.stringify({D}.S.show.entries.at(-1))"))
    pg.screenshot(path=f'{out}/3_dropped.png')
    # move a launcher by dragging it in 3D (free mode) and turn it with R
    li = pg.evaluate(f'{D}.S.show.launchers.length - 1')
    pos = pg.evaluate(f"""() => {{ const o = {D}.ctx.scene.getObjectByProperty ? null : null; const v = new {D}.ctx.THREE.Vector3(); const D2 = {D};
        let obj = null; D2.ctx.scene.traverse(x => {{ if (!obj && x.userData.launcher === {li} && x.isMesh) obj = x; }});
        obj.getWorldPosition(v); v.project(D2.ctx.camera); const r = document.querySelector('#fw-view canvas').getBoundingClientRect();
        return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }}""")
    before = pg.evaluate(f'JSON.stringify({D}.S.show.launchers[{li}])')
    pg.mouse.move(pos[0], pos[1]); pg.mouse.down(); pg.mouse.move(pos[0] - 60, pos[1] + 10, steps=8); pg.mouse.up()
    pg.keyboard.press('r')
    print('moved launcher', li, before, '->', pg.evaluate(f'JSON.stringify({D}.S.show.launchers[{li}])'))
    pg.click('#fw-grid')
    # night again for a show look
    pg.click('#fw-scenebtn'); pg.click('#fw-sky button[data-s="night"]'); pg.click('#fw-scenebtn')
    pg.click('#fw-play'); pg.wait_for_timeout(3000); pg.screenshot(path=f'{out}/4_night.png')
    print('errors:', errors[:8])
    b.close()
