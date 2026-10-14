"""Viewer checks in the installed Chrome: no recolour pickers, missing-texture notes, rotate buttons, mdl model, heads.
usage: python tests/ui_checks.py http://127.0.0.1:8799 <out folder>
"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)


def open_res(pg, ovl, res):
    pg.goto(f'{base}/#ovl={ovl}&res={res}')
    pg.wait_for_function("document.getElementById('msg').textContent === '' && document.getElementById('info').style.display === 'block'",
                         timeout=60000)
    pg.wait_for_timeout(800)


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1400, 'height': 850})
    pg.add_init_script("try { localStorage.setItem('rct3ovl.tour.main', '1'); } catch (e) {}")
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    open_res(pg, 'Cars%5CCoasterCars%5CMineRide%5CMineRide.common.ovl', 'MineTrainflex%3Aftx')
    print('recolour pickers present:', pg.locator('#c0').count() > 0, '| zoom bar visible:', pg.is_visible('#g-zoom'))
    open_res(pg, 'Cars%5CTrackedRideCars%5CElevatorCar%5CElevatorCar.common.ovl', 'ElevatorCar%3Absh')
    print('elevator info:', pg.inner_text('#info').replace('\n', ' | ')[:400])
    pg.screenshot(path=f'{out}/elevator.png')
    pg.click('#b-rotx'); pg.wait_for_timeout(500); pg.screenshot(path=f'{out}/elevator_rotx.png')
    open_res(pg, 'Cars%5CTrackedRideCars%5CElephant%5CElephant.common.ovl', 'ElephantTransport%3Amdl')
    print('elephant info:', pg.inner_text('#info').replace('\n', ' | ')[:300])
    pg.screenshot(path=f'{out}/elephant.png')
    open_res(pg, 'Characters%5CMovieStar%5CPopstar01_Head_Main.common.ovl', 'Head_PF01_L2_Happy%3Assk')
    pg.screenshot(path=f'{out}/head_l2.png')
    open_res(pg, 'Characters%5CMovieStar%5CPopstar01_Head_Main.common.ovl', 'SS_Head_VF01_L1_Sick%3Assk')
    pg.screenshot(path=f'{out}/head_ss.png')
    print('page errors:', errors)
    b.close()
