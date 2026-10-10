"""MixMaster + AFE + designers end to end in Chrome.
usage: python tests/ui_mixmaster.py http://127.0.0.1:8799 <out folder>
"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1600, 'height': 950}, accept_downloads=True)
    errors = []
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.on('response', lambda r: r.status >= 400 and errors.append(f'{r.status} {r.url}'))
    pg.goto(base + '/')
    pg.evaluate('localStorage.clear(); [`main`, `mixmaster`, `afe`, `laser-designer`, `jet-designer`].forEach(k => localStorage.setItem(`rct3ovl.tour.` + k, `1`))')
    pg.goto(base + '/#fireworks')
    pg.wait_for_selector('#fw .fwk', timeout=180000); pg.select_option('#fw-show', label='Stratosphere'); pg.wait_for_selector('#fw .ent', timeout=60000); pg.wait_for_timeout(2000)
    D = 'window.__fwdebug'
    print('tabs:', pg.eval_on_selector_all('#fw-ptabs button', 'bs => bs.map(b => b.textContent)'))
    for k in ('laser', 'jet', 'firework'):
        pg.click(f'#fw-ptabs button[data-k="{k}"]')
        print(' ', k, 'items:', pg.eval_on_selector_all('#fw-lib .fwk', 'r => r.length'), '| create:', pg.inner_text('#fw-create'))
    # new show (has laser domes and water jet bases)
    pg.once('dialog', lambda d: d.accept())
    pg.click('#fw-new'); pg.wait_for_timeout(2500)
    print('new show launchers:', pg.evaluate(f"{D}.S.show.launchers.map(l => l.type).join(',')"))
    # preview a laser and a water jet
    pg.click('#fw-ptabs button[data-k="laser"]')
    pg.click('#fw-lib .fwk[data-f="SpinMaster.las"] .pv'); pg.wait_for_timeout(2500)
    print('laser preview beams:', pg.evaluate(f'{D}.ribbons.count()'))
    pg.screenshot(path=f'{out}/1_laser.png')
    pg.click('#fw-ptabs button[data-k="jet"]')
    pg.click('#fw-lib .fwk[data-f="Sprinkler.wjt"] .pv'); pg.wait_for_timeout(2500)
    print('jet preview particles:', pg.evaluate(f'{D}.count()'))
    pg.screenshot(path=f'{out}/2_jet.png')
    # add a laser + a firework + a jet to the timeline by double-clicking
    lb = pg.locator('#fw-lanes').bounding_box()
    for k, x, row in (('laser', 80, 0), ('firework', 160, 1), ('jet', 120, 2)):
        pg.click(f'#fw-ptabs button[data-k="{k}"]'); pg.click('#fw-lib .fwk >> nth=0')
        pg.mouse.dblclick(lb['x'] + x, lb['y'] + row * 26 + 12); pg.wait_for_timeout(300)
    print('entries:', pg.evaluate(f"{D}.S.show.entries.map(e => e.kind + ':' + e.firework + '@' + e.time + ' L' + e.launcher).join(' | ')"))
    # aiming control point for the selected launcher
    ab = pg.locator('#fw-aimbar').bounding_box()
    pg.mouse.click(ab['x'] + 100, ab['y'] + 10)
    pg.fill('#fw-aim input[data-k="yaw"]', '60'); pg.dispatch_event('#fw-aim input[data-k="yaw"]', 'input')
    print('aim points:', pg.evaluate(f'JSON.stringify({D}.S.show.aim)'))
    # play into the laser
    pg.click('#fw-play'); pg.wait_for_timeout(4000)
    print('playing:', pg.inner_text('#fw-time'), '| beams', pg.evaluate(f'{D}.ribbons.count()'), '| particles', pg.evaluate(f'{D}.count()'))
    pg.screenshot(path=f'{out}/3_playing.png')
    pg.click('#fw-play')
    # landscape: raise a hill, paint water
    pg.click('#fw-land'); pg.click('#fw-landp button[data-t="raise"]')
    vb = pg.locator('#fw-view').bounding_box()
    cx, cy = vb['x'] + vb['width'] * 0.3, vb['y'] + vb['height'] * 0.82
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.wait_for_timeout(900); pg.mouse.up()
    pg.click('#fw-landp button[data-t="water"]'); pg.fill('#fw-wlevel', '0.5')
    cx2 = vb['x'] + vb['width'] * 0.7
    pg.click('#fw-landp button[data-t="lower"]'); pg.mouse.move(cx2, cy); pg.mouse.down(); pg.wait_for_timeout(700); pg.mouse.up()
    pg.click('#fw-landp button[data-t="water"]'); pg.mouse.move(cx2, cy); pg.mouse.down(); pg.mouse.move(cx2 + 30, cy, steps=5); pg.mouse.up()
    print('terrain saved:', pg.evaluate(f"!!{D}.S.show.terrain && !!{D}.S.show.terrain.heights"), '| water:', pg.evaluate(f"{D}.terrain.mirrorLevel()"))
    pg.click('#fw-land')
    pg.click('#fw-ptabs button[data-k="firework"]'); pg.click('#fw-lib .fwk[data-f="GreenPeony.frw"] .pv'); pg.wait_for_timeout(2600)
    pg.screenshot(path=f'{out}/4_landscape.png')
    # AFE: opens straight away (no name needed)
    print('create button:', pg.inner_text('#fw-create'))
    pg.click('#fw-create button')
    pg.wait_for_selector('#fw .afe-tree .afe-node', timeout=20000); pg.wait_for_timeout(2500)
    print('afe open:', pg.evaluate("document.getElementById('fw').classList.contains('afe')"), '| nodes:', pg.eval_on_selector_all('#fw .afe-node', 'n => n.length'),
          '| particles', pg.evaluate(f'{D}.count()'))
    pg.screenshot(path=f'{out}/5_afe.png')
    # a new firework is only its base: load a game firework (as a copy) to edit
    pg.select_option('#fw .afe-top select[data-a="load"]', 'GreenPeony.frw'); pg.wait_for_timeout(1500)
    print('loaded nodes:', pg.eval_on_selector_all('#fw .afe-node', 'n => n.length'))
    # select the burst emitter, change count + texture + colour stop, add a child emitter, save
    pg.click('#fw .afe-node >> nth=3')
    print('selected:', pg.inner_text('#fw .afe-r h3'))
    pg.fill('#fw .afe-r input[type=number][data-f="NumParticles"]', '400'); pg.dispatch_event('#fw .afe-r input[type=number][data-f="NumParticles"]', 'input')
    pg.click('#fw .afe-texgrid canvas >> nth=5')
    gb = pg.locator('#fw .afe-grad').bounding_box(); pg.mouse.click(gb['x'] + gb['width'] * 0.5, gb['y'] + 20)
    pg.click('#fw .afe-tools button[data-a="add"]')
    pg.click('#fw .afe-top button[data-a="save"]'); pg.wait_for_timeout(2500)
    print('after edits nodes:', pg.eval_on_selector_all('#fw .afe-node', 'n => n.length'), '| yours:', pg.evaluate(f"Object.keys({D}.REG.firework).filter(k => k.startsWith('my:')).length"))
    pg.screenshot(path=f'{out}/6_afe_edit.png')
    with pg.expect_download() as dl:
        pg.click('#fw .afe-top button[data-a="dl"]')
    print('frw download:', dl.value.suggested_filename, os.path.getsize(dl.value.path()))
    pg.click('#fw .afe-top button[data-a="close"]'); pg.wait_for_timeout(500)
    print('back to mixmaster:', not pg.evaluate("document.getElementById('fw').classList.contains('afe')"))
    # laser designer
    pg.click('#fw-ptabs button[data-k="laser"]'); pg.click('#fw-create button'); pg.wait_for_selector('#fw .fwd-win', timeout=20000)
    pg.select_option('#fw .fwd-win select[data-f="render"]', '2'); pg.wait_for_timeout(300)
    pg.click('#fw .fwd-win .frames .add')
    sk = pg.locator('#fw .sketch canvas').bounding_box()
    pg.mouse.move(sk['x'] + 60, sk['y'] + 60); pg.mouse.down()
    for i in range(30):
        pg.mouse.move(sk['x'] + 60 + i * 8, sk['y'] + 60 + (i % 10) * 20)
    pg.mouse.up(); pg.click('#fw .dlg button[data-k="ok"]')
    kt = pg.locator('#fw .fwd-win .kt canvas >> nth=1').bounding_box(); pg.mouse.click(kt['x'] + kt['width'] * 0.6, kt['y'] + 10)
    pg.click('#fw .fwd-win button[data-d="save"]'); pg.wait_for_timeout(2000)
    print('laser designer: images', pg.evaluate("document.querySelectorAll('#fw .fwd-win .frames .fr:not(.add)').length"), '| beams', pg.evaluate(f'{D}.ribbons.count()'),
          '| your lasers', pg.evaluate(f"Object.keys({D}.REG.laser).filter(k => k.startsWith('my:')).length"))
    pg.screenshot(path=f'{out}/7_laserdesigner.png')
    with pg.expect_download() as dl:
        pg.click('#fw .fwd-win button[data-d="dl"]')
    print('las download:', dl.value.suggested_filename, os.path.getsize(dl.value.path()))
    pg.click('#fw .fwd-win header button')
    # water jet designer
    pg.click('#fw-ptabs button[data-k="jet"]'); pg.click('#fw-create button'); pg.wait_for_selector('#fw .fwd-win', timeout=20000); pg.wait_for_timeout(2000)
    print('jet designer timelines:', pg.eval_on_selector_all('#fw .fwd-win .kt', 'k => k.length'), '| particles', pg.evaluate(f'{D}.count()'))
    pg.screenshot(path=f'{out}/8_jetdesigner.png')
    pg.click('#fw .fwd-win header button')
    # export dialog -> download .fwd
    pg.click('#fw-export'); pg.wait_for_selector('#fw .dlg')
    print('export notes:', pg.inner_text('#fw .dlg ul').replace('\n', ' | '))
    with pg.expect_download() as dl:
        pg.click('#fw .dlg button[data-x="dl"]')
    print('fwd download:', dl.value.suggested_filename, os.path.getsize(dl.value.path()))
    import shutil; shutil.copy(dl.value.path(), os.path.join(out, 'export.fwd'))
    print('errors:', errors[:10])
    b.close()
