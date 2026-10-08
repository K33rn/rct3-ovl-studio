"""MixMaster scenery: place pieces, stack a launcher on one, move it (launcher rides along), cue an animation and scrub.
usage: python tests/ui_scenery_mix.py <base> <out folder>"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
D = 'window.__fwdebug'
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1700, 'height': 950})
    errors = []
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.on('response', lambda r: r.status >= 400 and 'favicon' not in r.url and errors.append(f'{r.status} {r.url}'))
    pg.goto(base + '/'); pg.evaluate('localStorage.clear()'); pg.goto(base + '/#fireworks')
    pg.wait_for_selector('#fw .ent', timeout=180000); pg.wait_for_timeout(1000)
    pg.once('dialog', lambda d: d.accept()); pg.click('#fw-new'); pg.wait_for_timeout(1500)
    pg.click('#fw-scenebtn'); pg.click('#fw-sky button[data-s="day"]'); pg.click('#fw-grounds button[data-g="6"]'); pg.click('#fw-scenebtn')
    pg.click('#fw-ptabs button[data-k="scenery"]')
    pg.wait_for_selector('#fw-lib [data-scn]', timeout=240000)
    print('scenery rows:', pg.eval_on_selector_all('#fw-lib [data-scn]', 'r => r.length'), '|', pg.inner_text('#fw-lib .libgrp'))
    vb = pg.locator('#fw-view').bounding_box()
    # an animated piece
    pg.fill('#fw-search', 'rex'); pg.dispatch_event('#fw-search', 'input'); pg.wait_for_timeout(300)
    names = pg.eval_on_selector_all('#fw-lib [data-scn]', 'r => r.map(x => x.dataset.scn + "|" + x.textContent.trim())')
    print('rex search:', names[:6])
    trex = next(n.split('|')[0] for n in names if 'Tyrannosaurus' in n)
    pg.drag_and_drop(f'#fw-lib [data-scn="{trex}"]', '#fw-view', target_position={'x': vb['width'] * 0.35, 'y': vb['height'] * 0.75})
    pg.wait_for_timeout(4000)
    # a solid block to stand a launcher on: dropped from the palette, then a 16-mortar rack on its middle
    pg.fill('#fw-search', 'block'); pg.dispatch_event('#fw-search', 'input'); pg.wait_for_timeout(300)
    blocks = pg.eval_on_selector_all('#fw-lib [data-scn]', 'r => r.map(x => x.dataset.scn + "|" + x.textContent.trim())')
    blk = next((n.split('|')[0] for n in blocks if n.split('|')[0] in ('van_wall_block:sid', 'van_brick_wall_block:sid')), blocks[0].split('|')[0])
    print('block:', blk)
    pg.drag_and_drop(f'#fw-lib [data-scn="{blk}"]', '#fw-view', target_position={'x': vb['width'] * 0.62, 'y': vb['height'] * 0.78})
    pg.wait_for_timeout(3500)
    print('scenery in show:', pg.evaluate(f'JSON.stringify({D}.S.show.scenery)'))
    screen = lambda frac: pg.evaluate(f"""() => {{ const D2 = {D}, T = D2.ctx.THREE; const o = D2.sceneryObjs()[1].obj;
        const box = new T.Box3().setFromObject(o), c = box.getCenter(new T.Vector3()); c.y = box.min.y + (box.max.y - box.min.y) * {frac};
        const v = c.clone().project(D2.ctx.camera), r = document.querySelector('#fw-view canvas').getBoundingClientRect();
        return {{ x: (v.x + 1) / 2 * r.width, y: (1 - v.y) / 2 * r.height, top: box.max.y, size: box.getSize(new T.Vector3()).toArray().map(x => +x.toFixed(1)) }}; }}""")
    pos = screen(0.98); print('block top at', pos)
    pg.fill('#fw-search', ''); pg.click('#fw-ptabs button[data-k="base"]'); pg.wait_for_timeout(800)
    pg.drag_and_drop('#fw-lib .base[data-base="Mortarx16"]', '#fw-view', target_position={'x': pos['x'], 'y': pos['y']})
    pg.wait_for_timeout(2500)
    li = pg.evaluate(f'{D}.S.show.launchers.length - 1')
    ly = lambda: pg.evaluate(f"""() => {{ let o = null; {D}.ctx.scene.traverse(x => {{ if (!o && x.userData.launcher === {li}) o = x; }});
        while (o.parent && o.parent.userData.launcher === {li}) o = o.parent; return [+o.position.x.toFixed(2), +o.position.y.toFixed(2), +o.position.z.toFixed(2)]; }}""")
    print('rack on the block: launcher', li, 'at', ly(), '(block top', round(pos['top'], 2), ')')
    pg.screenshot(path=f'{out}/1_placed.png')
    side = pg.evaluate(f"""() => {{ const D2 = {D}, T = D2.ctx.THREE; const o = D2.sceneryObjs()[1].obj;
        const box = new T.Box3().setFromObject(o), c = new T.Vector3(box.getCenter(new T.Vector3()).x, (box.min.y + box.max.y) / 2, box.max.z - 0.05);
        const v = c.clone().project(D2.ctx.camera), r = document.querySelector('#fw-view canvas').getBoundingClientRect();
        const ray = new T.Raycaster(); ray.setFromCamera(new T.Vector2(v.x, v.y), D2.ctx.camera);
        const h = ray.intersectObjects(D2.ctx.scene.children, true).find(x => x.object.isMesh && (x.object.userData.scenery != null || x.object.userData.launcher != null));
        return {{ x: (v.x + 1) / 2 * r.width, y: (1 - v.y) / 2 * r.height, under: h ? (h.object.userData.scenery != null ? 'scenery ' + h.object.userData.scenery : 'launcher ' + h.object.userData.launcher) : 'nothing' }}; }}""")
    print('grabbing the block side at', side)
    vr = pg.locator('#fw-view canvas').bounding_box()
    sx, sy = vr['x'] + side['x'], vr['y'] + side['y']
    pg.mouse.move(sx, sy); pg.mouse.down(); pg.mouse.move(sx + 260, sy + 20, steps=15); pg.mouse.up()
    pg.wait_for_timeout(800)
    print('after moving the block: rack at', ly(), '| block', pg.evaluate(f'JSON.stringify({D}.S.show.scenery[1])'))
    # cue the T-rex animation at 2 s, scrub, check the clip time follows the timeline
    pg.evaluate(f"{D}.seek(2)"); pg.wait_for_timeout(200)
    pg.evaluate(f"""() => {{ const D2 = {D}; D2.S.selScenery = 0; D2.S.pick = 'scenery'; D2.renderAll(); }}""")
    pg.wait_for_timeout(300)
    print('scenery panel:', pg.inner_text('#fw-scn').replace('\n', ' | ')[:200])
    pg.select_option('#fw-scn select[data-k="anim"]', 'cues'); pg.wait_for_timeout(200)
    pg.click('#fw-scn button[data-a="cue"]'); pg.wait_for_timeout(300)
    cue = pg.evaluate(f"JSON.stringify({D}.S.show.entries.find(e => e.kind === 'scenery'))")
    print('cue:', cue, '| timeline block:', pg.eval_on_selector_all('#fw .ent.k-scenery', 'e => e.map(x => x.textContent)'))
    for t in (1.0, 2.0, 3.5, 5.0):
        pg.evaluate(f'{D}.seek({t})'); pg.wait_for_timeout(250)
        print(f'  t={t}: clip time', pg.evaluate(f"""() => {{ const o = {D}.sceneryObjs?.()?.[0]; return o && o.action ? +o.action.time.toFixed(2) : null; }}"""))
    pg.click('#fw-play'); pg.wait_for_timeout(2500); pg.click('#fw-play')
    pg.screenshot(path=f'{out}/2_cued.png')
    # turn + duplicate + delete
    pg.keyboard.press('r'); pg.wait_for_timeout(200)
    print('turned:', pg.evaluate(f'JSON.stringify({D}.S.show.scenery[0])'))
    pg.click('#fw-scn button[data-a="dup"]'); pg.wait_for_timeout(2500)
    print('after duplicate:', pg.evaluate(f'{D}.S.show.scenery.length'))
    pg.click('#fw-scn button[data-a="del"]'); pg.wait_for_timeout(1500)
    print('after delete:', pg.evaluate(f'{D}.S.show.scenery.length'), '| cues', pg.evaluate(f"{D}.S.show.entries.filter(e => e.kind === 'scenery').length"))
    print('errors:', errors[:8])
    b.close()
