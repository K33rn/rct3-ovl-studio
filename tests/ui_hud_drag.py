"""GUI Editor > In-park screen > Simulate: the message console opens and closes by dragging its handle, test messages
show newest at the bottom and the arrows page through them; windows and build lists move by their title strip and
still work where they were dropped; the editing view shows the console's pieces to pick. Read-only.
usage: python tests/ui_hud_drag.py http://127.0.0.1:8791 <out folder>"""
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
    pg.click('#tg-modes button[data-m=gui]')
    pg.wait_for_selector('#gu-tabs button[data-v=hud].on', timeout=120000); pg.wait_for_timeout(2500)

    def at(x, y):
        return pg.evaluate("""([x, y]) => { const c = document.querySelector('#hud-cv'), b = c.getBoundingClientRect();
            const W = c.clientWidth, H = c.clientHeight, s = Math.min(W / 1280, H / 800), ox = (W - 1280 * s) / 2, oy = (H - 800 * s) / 2;
            return [b.left + ox + x * s, b.top + oy + y * s]; }""", [x, y])

    def px(x, y):
        return pg.evaluate("""([x, y]) => { const c = document.querySelector('#hud-cv'), b = c.getBoundingClientRect();
            return [...c.getContext('2d').getImageData(Math.round((x - b.left) * c.width / b.width),
              Math.round((y - b.top) * c.height / b.height), 1, 1).data].slice(0, 3); }""", at(x, y))

    def drag(x0, y0, x1, y1):
        pg.mouse.move(*at(x0, y0)); pg.mouse.down()
        for k in range(1, 9):
            pg.mouse.move(*at(x0 + (x1 - x0) * k / 8, y0 + (y1 - y0) * k / 8))
        pg.mouse.up(); pg.wait_for_timeout(250)

    def click(x, y, wait=300):
        pg.mouse.click(*at(x, y)); pg.wait_for_timeout(wait)
    pale = lambda c: min(c) > 215  # noqa: E731  the console's rows / a window's inside
    grass = lambda c: c[1] > c[0] + 20 and c[1] > c[2] + 20  # noqa: E731

    pg.click('#hud-sim'); pg.wait_for_timeout(400)
    print('closed, under the bar:', px(500, 100))
    if not grass(px(500, 100)): problems.append('console not closed at the start')
    pg.click('#hud-msg5'); pg.wait_for_timeout(200)
    note = pg.inner_text('#gu-right')
    if '5' not in note.split('while it is closed')[1][:20]: problems.append('message count not shown')
    drag(619, 12, 619, 250)
    pg.screenshot(path=f'{out}/1_console_open.png')
    print('open:', px(500, 100), px(500, 238))
    if not pale(px(500, 100)): problems.append(f'console did not open: {px(500, 100)}')
    if not grass(px(500, 290)): problems.append('console opened past where it was let go')
    # the newest message is in the bottom row: dark text pixels there
    dark = pg.evaluate("""([a, b]) => { const c = document.querySelector('#hud-cv'), r = c.getBoundingClientRect(), k = c.width / r.width;
        const d = c.getContext('2d').getImageData(Math.round((a[0] - r.left) * k), Math.round((a[1] - r.top) * k), Math.round((b[0] - a[0]) * k), Math.round((b[1] - a[1]) * k)).data;
        let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 150) n++; return n; }""", [at(420, 207), at(840, 225)])
    print('dark pixels in the bottom row:', dark)
    if dark < 20: problems.append('no message in the bottom row')
    # 5 messages fit in the rows: the up arrow (earlier) is grey; send 10 more, it works and changes the rows
    pg.click('#hud-msg5'); pg.click('#hud-msg5'); pg.wait_for_timeout(200)
    before = pg.evaluate("document.querySelector('#hud-cv').toDataURL().length")
    click(743, 238)
    after = pg.evaluate("document.querySelector('#hud-cv').toDataURL().length")
    pg.screenshot(path=f'{out}/2_console_scrolled.png')
    if before == after: problems.append('Previous messages did not change the rows')
    drag(619, 245, 619, 5)
    print('closed again:', px(500, 100))
    if not grass(px(500, 100)): problems.append('console did not close')
    # Park management > Park: a window; drag its title strip by (+150, +120); its close button works there
    click(28, 353); click(68, 54, 500)
    print('window inside before:', px(640, 300))
    drag(600, 177, 750, 297)
    pg.screenshot(path=f'{out}/3_window_moved.png')
    print('window inside after:', px(790, 420), 'old place:', px(420, 190))
    if not pale(px(790, 420)) or pale(px(420, 190)): problems.append('window did not move')
    click(400 + 477 - 13 + 150, 170 + 9 + 120)
    if pale(px(790, 420)): problems.append('close did not work where the window was dropped')
    # Rides > roller coasters: the list moves by its header
    click(28, 393); click(68, 24, 500)
    drag(250, 20, 550, 320)
    pg.screenshot(path=f'{out}/4_list_moved.png')
    blue = lambda c: c[2] > 180 and c[0] < 120  # noqa: E731
    print('list header at its new place:', px(550, 330), 'old:', px(250, 30))
    if not blue(px(550, 330)) or blue(px(250, 30)): problems.append('list did not move')
    pg.keyboard.press('Escape'); pg.keyboard.press('Escape'); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # editing view: console open, its pieces can be picked
    pg.select_option('#hud-con', 'open'); pg.wait_for_timeout(300)
    click(400, 185)
    h3 = pg.eval_on_selector_all('#gu-right h3', 'e => e.map(x => x.textContent)')
    print('picked:', h3[:2])
    if not any('Message console' in t for t in h3): problems.append(f'console piece not picked: {h3}')
    pg.screenshot(path=f'{out}/5_edit_console.png')
    b.close()
print('PROBLEMS:', problems or 'none')
