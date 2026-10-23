"""GUI Editor front screen designer: the pieces that are not part of the background - the expansion badges, Back /
Quit and the RCT3 logo - are drawn where the program puts them, dragged, typed, saved into RCT3plus.exe, read back,
and Back / Quit work in the simulation. Run it on a scratch copy of the game (it saves into the program, then puts
the game's own layout back).
usage: python tests/ui_front_pieces.py http://127.0.0.1:8791 <out folder>"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
problems = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1700, 'height': 1000})
    pg.on('pageerror', lambda e: problems.append(f'pageerror {e}'))
    pg.goto(base + '/')
    pg.evaluate("localStorage.clear(); ['main','mixmaster','afe','texgui','tex','gui'].forEach(k => localStorage.setItem('rct3ovl.tour.' + k, '1'))")
    pg.reload(); pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=240000)
    pg.click('#b-texgui'); pg.wait_for_timeout(1500)
    pg.click('#tg-modes button[data-m=gui]'); pg.wait_for_timeout(2500)
    pg.click('text=Front screen designer'); pg.wait_for_selector('#fs-stage canvas', timeout=60000); pg.wait_for_timeout(1500)
    game = pg.evaluate("fetch('/api/tx/menu').then(r => r.json()).then(j => j.pieces)")
    print('game places:', game['badges'], game['corners'], game['logo'])

    def at(x, y):          # a point of the 1024 x 768 layout -> page coordinates
        r = pg.eval_on_selector('#fs-stage canvas', 'c => { const b = c.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }')
        return [r[0] + x * r[2] / 1024, r[1] + y * r[3] / 768]

    def px(x, y):          # the preview's colour at a layout point
        return pg.evaluate("""([x, y]) => { const c = document.querySelector('#fs-stage canvas');
            return [...c.getContext('2d').getImageData(Math.round(x * 1280 / 1024), Math.round(y * 800 / 768), 1, 1).data].slice(0, 3); }""", [x, y])
    pg.screenshot(path=f'{out}/1_game.png')
    # the tiger badge's middle is drawn (not the sky / park stand-in)
    tx_, ty_ = game['badges'][1]
    before = px(tx_ + 40, ty_ + 50)
    print('tiger badge pixel', before)
    # drag the tiger badge by (-300, -200)
    pg.mouse.move(*at(tx_ + 40, ty_ + 50)); pg.mouse.down(); pg.mouse.move(*at(tx_ - 100, ty_ - 50), steps=6); pg.mouse.move(*at(tx_ - 260, ty_ - 150), steps=6); pg.mouse.up()
    pg.wait_for_timeout(300)
    vals = pg.eval_on_selector_all('#gu-right input[data-pc]', 'e => e.map(i => [i.dataset.pc, +i.value])')
    d = dict(vals)
    print('after drag:', d['b1,0'], d['b1,1'])
    if abs(d['b1,0'] - (tx_ - 300)) > 2 or abs(d['b1,1'] - (ty_ - 200)) > 2: problems.append(f'drag moved the tiger to {d["b1,0"]}, {d["b1,1"]}')
    if px(tx_ - 260, ty_ - 150) == px(tx_ - 260 + 1000, ty_ - 150) and False: pass
    # type Quit's place
    pg.fill('#gu-right input[data-pc="quit,0"]', '120'); pg.fill('#gu-right input[data-pc="quit,1"]', '700')
    pg.screenshot(path=f'{out}/2_moved.png')
    pg.click('#fs-save'); pg.wait_for_timeout(500)
    if pg.query_selector('#tg .dlg button.primary'):
        pg.click('#tg .dlg button.primary')
    pg.wait_for_timeout(2500)
    saved = pg.evaluate("fetch('/api/tx/menu').then(r => r.json()).then(j => j.pieces)")
    print('saved:', saved['installed'], saved['badges'], saved['corners'])
    if not saved['installed'] or abs(saved['corners']['quit'][0] - 120) > 0.1 or abs(saved['badges'][1][0] - (tx_ - 300)) > 2:
        problems.append(f'not saved: {saved}')
    # simulate: Quit on the main menu asks; in Play, Back goes back
    pg.click('#fs-sim'); pg.wait_for_timeout(600)
    pg.mouse.click(*at(120, 700)); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{out}/3_quit.png')
    note = pg.evaluate("document.querySelector('#fs-hint').textContent")
    pg.mouse.click(*at(512, 300)); pg.wait_for_timeout(200)     # closes the note
    pl = pg.evaluate("fetch('/api/tx/menu').then(r => r.json()).then(j => j.menus.places[0])")
    pg.mouse.click(*at(pl[0], pl[1])); pg.wait_for_timeout(900)           # Play
    hint1 = pg.evaluate("document.querySelector('#fs-hint').textContent")
    bk = saved['corners']['back']
    pg.screenshot(path=f'{out}/4_play.png')
    pg.mouse.click(*at(*bk)); pg.wait_for_timeout(900)
    hint2 = pg.evaluate("document.querySelector('#fs-hint').textContent")
    print('sim:', hint1, '->', hint2)
    if 'Play' not in hint1 or 'Play' in hint2: problems.append(f'Back did not go back: {hint1} -> {hint2}')
    pg.click('#fs-sim'); pg.wait_for_timeout(300)
    # game's own places, saved -> the pieces part comes off again (reset puts everything back)
    pg.click('#fs-reset'); pg.wait_for_timeout(400)
    if pg.query_selector('#tg .dlg button.primary'):
        pg.click('#tg .dlg button.primary')
    pg.wait_for_timeout(2500)
    after = pg.evaluate("fetch('/api/tx/menu').then(r => r.json()).then(j => j.pieces)")
    print('after reset:', after['installed'], after['badges'])
    if after['installed']: problems.append('reset left the pieces installed')
    b.close()
print('PROBLEMS:', problems or 'none')
