"""GUI Editor front screen designer: simulating the menus, and picking several buttons to move or remove.
usage: python tests/ui_front_sim.py http://127.0.0.1:8768 <out folder>
Nothing is saved into the game (the removals are undone at the end)."""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
problems = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1600, 'height': 950})
    pg.on('pageerror', lambda e: problems.append(f'pageerror {e}'))
    pg.goto(base + '/')
    pg.evaluate("localStorage.clear(); ['main','mixmaster','afe','texgui','tex','gui'].forEach(k => localStorage.setItem('rct3ovl.tour.' + k, '1'))")
    pg.reload(); pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=240000)
    pg.click('#b-texgui'); pg.wait_for_timeout(1500)
    pg.click('#tg-modes button[data-m=gui]'); pg.wait_for_selector('#gu-list [data-front]', timeout=120000)
    pg.click('#gu-list [data-front]')
    pg.wait_for_selector('#fs-sim', timeout=60000); pg.wait_for_timeout(1500)

    def places():
        return [[float(pg.input_value(f'#gu-right input[data-pl="{n},{c}"]')) for c in (0, 1)] for n in range(5)]

    def at(x, y):          # a point of the game's 1024 x 768 layout -> page coordinates
        r = pg.eval_on_selector('#fs-stage canvas', 'c => { const b = c.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }')
        return r[0] + x * r[2] / 1024, r[1] + y * r[3] / 768

    def h3():
        return pg.text_content('#gu-right h3').strip()

    P = places()
    # ---- simulate: Main -> Play -> Sandbox, a button that leaves, Back, Esc
    pg.click('#fs-sim'); pg.wait_for_timeout(700)
    print('simulating:', h3())
    if 'Main menu' not in h3(): problems.append(f'sim start: {h3()}')
    pg.screenshot(path=f'{out}/1_sim_main.png')
    pg.mouse.click(*at(P[0][0] + 60, P[0][1])); pg.wait_for_timeout(200)   # Play (place 1), mid slide-in
    pg.screenshot(path=f'{out}/2_sim_play_sliding.png'); pg.wait_for_timeout(800)
    print('after Play:', h3(), '|', pg.inner_text('#fs-hint'))
    if 'Play' not in h3(): problems.append(f'play: {h3()}')
    pg.mouse.click(*at(P[2][0] + 60, P[2][1])); pg.wait_for_timeout(900)  # Sandbox (Play's place 3)
    print('after Sandbox:', h3(), '|', pg.inner_text('#fs-hint'))
    if 'Sandbox' not in h3() or 'Main menu › Play › Sandbox' not in pg.inner_text('#fs-hint'): problems.append(f'sandbox: {h3()}')
    pg.mouse.click(*at(P[0][0] + 60, P[0][1])); pg.wait_for_timeout(300)  # New sandbox: leaves the front screen
    pg.screenshot(path=f'{out}/3_sim_leaves.png')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)                # closes the note
    pg.keyboard.press('Escape'); pg.wait_for_timeout(900)                # back to Play
    print('after Esc, Esc:', h3())
    if 'Play' not in h3(): problems.append(f'esc back: {h3()}')
    pg.click('#fs-sback'); pg.wait_for_timeout(900)
    print('after Back:', h3())
    if 'Main menu' not in h3(): problems.append(f'back: {h3()}')
    if not pg.locator('#tg').is_visible(): problems.append('Esc left the editor')
    pg.click('#fs-sstop'); pg.wait_for_timeout(300)

    # ---- pick several: Play menu, Shift-click places 1 and 3, drag them together, then Delete
    pg.click('#gu-panel button[data-m=play]'); pg.wait_for_timeout(400)
    n0 = pg.locator('#gu-right input[data-pick]').count()
    pg.mouse.click(*at(P[0][0] + 60, P[0][1]))
    pg.keyboard.down('Shift'); pg.mouse.click(*at(P[2][0] + 60, P[2][1])); pg.keyboard.up('Shift'); pg.wait_for_timeout(300)
    picked = pg.eval_on_selector_all('#gu-right input[data-pick]:checked', 'e => e.map(i => +i.dataset.pick)')
    print('Play buttons', n0, '| picked', picked, '|', pg.inner_text('#fs-delpicked'))
    if picked != [0, 2]: problems.append(f'picked {picked}')
    x, y = at(P[0][0] + 60, P[0][1]); pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x + 30, y + 40, steps=5); pg.mouse.up(); pg.wait_for_timeout(300)
    Q = places(); d0, d2, d1 = [round(Q[n][0] - P[n][0]) for n in (0, 2, 1)]
    print('dragged together: dx place1', d0, 'place3', d2, 'place2 (not picked)', d1)
    if not (d0 == d2 and d0 > 15 and d1 == 0): problems.append(f'group drag {d0} {d2} {d1}')
    pg.screenshot(path=f'{out}/4_picked.png')
    pg.keyboard.press('Delete'); pg.wait_for_timeout(400)
    n1 = pg.locator('#gu-right input[data-pick]').count(); left = pg.inner_text('#gu-right .sec >> nth=1')
    print('after Delete:', n1, 'buttons')
    if n1 != n0 - 2: problems.append(f'delete: {n0} -> {n1}')
    # a box round every place picks them all; the main menu keeps at least one button
    pg.click('#fs-undo'); pg.wait_for_timeout(300)
    pg.click('#gu-panel button[data-m=main]'); pg.wait_for_timeout(300)
    x0, y0 = at(2, 2); x1, y1 = at(1020, 760)
    pg.mouse.move(x0 + 2, y0 + 2); pg.mouse.down(); pg.mouse.move(x1 - 2, y1 - 2, steps=8); pg.mouse.up(); pg.wait_for_timeout(300)
    allp = pg.eval_on_selector_all('#gu-right input[data-pick]:checked', 'e => e.length')
    print('box picked', allp, 'of', pg.locator('#gu-right input[data-pick]').count())
    pg.screenshot(path=f'{out}/5_box.png')
    pg.click('#fs-delpicked'); pg.wait_for_timeout(300)
    print('toast:', pg.text_content('#tg-toast'))
    if 'at least one' not in (pg.text_content('#tg-toast') or ''): problems.append('main menu emptied')
    pg.click('#gu-right input[data-pick="0"]'); pg.wait_for_timeout(200)   # un-pick the first: the rest go
    pg.click('#fs-delpicked'); pg.wait_for_timeout(300)
    n2 = pg.locator('#gu-right input[data-pick]').count(); print('main menu after removing the rest:', n2)
    if n2 != 1: problems.append(f'main remove: {n2}')
    pg.click('#fs-undo'); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{out}/6_undone.png')
    b.close()
print('problems:', problems or 'none')
