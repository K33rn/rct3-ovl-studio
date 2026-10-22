"""GUI Editor > Main interface > In-park screen > Simulate: the left buttons open their menus as in the game, the menu
buttons open their list / window / tool panel, the top bar works; tooltips are the game's texts. Read-only.
usage: python tests/ui_hud_sim.py http://127.0.0.1:8768 <out folder>"""
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

    def at(x, y):          # a point of the 1280 x 800 screen -> page coordinates (whole-screen view)
        return pg.evaluate("""([x, y]) => { const c = document.querySelector('#hud-cv'), b = c.getBoundingClientRect();
            const W = c.clientWidth, H = c.clientHeight, s = Math.min(W / 1280, H / 800), ox = (W - 1280 * s) / 2, oy = (H - 800 * s) / 2;
            return [b.left + ox + x * s, b.top + oy + y * s]; }""", [x, y])

    def click(x, y, wait=300):
        pg.mouse.click(*at(x, y)); pg.wait_for_timeout(wait)

    def h3():
        return [t.strip() for t in pg.eval_on_selector_all('#gu-right h3', 'e => e.map(x => x.textContent)')]

    pg.click('#hud-sim'); pg.wait_for_timeout(400)
    print('simulating:', pg.inner_text('#hud-sim'), '|', h3()[:2])
    # Rides: 12 discs from y 24, the first opens the roller coaster list
    click(28, 393)
    pg.mouse.move(*at(68, 64)); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{out}/1_rides.png')
    print('after Rides:', h3()[:2])
    click(68, 24)
    pg.screenshot(path=f'{out}/2_coasters.png')
    print('after the first Rides item:', h3()[:2])
    if not any('Rides button' in t for t in h3()) and not any('RollerCoasters' in t for t in h3()): problems.append(f'rides item: {h3()}')

    def px(x, y):          # the simulated screen's colour at a 1280 x 800 point (through at(): the screen is letterboxed)
        return pg.evaluate("""([x, y]) => { const c = document.querySelector('#hud-cv'), b = c.getBoundingClientRect();
            return [...c.getContext('2d').getImageData(Math.round((x - b.left) * c.width / b.width),
              Math.round((y - b.top) * c.height / b.height), 1, 1).data].slice(0, 3); }""", at(x, y))
    blue = lambda c: c[2] > 180 and c[0] < 120  # noqa: E731  the list / panel frame #4aa8e0
    # lists centred on their button as in the game (Track import 185-500, Animals 265-582); MixMaster is a tool panel
    for y, top, name in ((344, 185, 'track import'), (424, 265, 'animals')):
        click(68, y)
        pg.screenshot(path=f'{out}/2_{name.replace(" ", "_")}.png')
        if not blue(px(300, top + 3)) or blue(px(300, top - 6)): problems.append(f'{name} list not at y {top}: {px(300, top + 3)} {px(300, top - 6)}')
    click(28, 473); click(68, 454)
    pg.screenshot(path=f'{out}/2_mixmaster.png')
    if not blue(px(440, 700)): problems.append(f'MixMaster tool panel not out to x 457: {px(440, 700)}')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    # Park management > Park Operations window
    click(28, 353); click(68, 54)
    pg.screenshot(path=f'{out}/3_park.png')
    print('Park management > first:', h3()[:2])
    if not any('Park Operations' in t for t in h3()): problems.append(f'park operations: {h3()}')
    # the window's close button
    click(877 - 20 + 7, 170 + 2 + 7)
    # View: toggle the grid
    click(28, 213); click(68, 24)
    print('View > grid toggled:', h3()[:2])
    pg.screenshot(path=f'{out}/4_view.png')
    # top bar: fast forward, the hat (objectives), day / night list
    click(380, 11); click(313, 11)
    pg.screenshot(path=f'{out}/5_objectives.png')
    sp = pg.input_value('#hud-speed'); print('speed after clicking fast forward:', sp)
    if sp != '2': problems.append(f'speed {sp}')
    click(335, 10); click(327 - 16 + 8, 24 + 32 + 8)
    dn = pg.input_value('#hud-dn'); print('day / night picked:', dn)
    if dn != 'GUI2_DayNightCycle_Night': problems.append(f'day/night {dn}')
    # Map window, Quit dialog
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    click(28, 173)
    pg.screenshot(path=f'{out}/6_map.png')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    click(28, 293)
    pg.screenshot(path=f'{out}/7_quit.png')
    # Esc closes the window, then the menu, then stops simulating - and stays in the editor
    for _ in range(2): pg.keyboard.press('Escape'); pg.wait_for_timeout(200)   # the window, then simulating
    print('after Esc x2:', pg.inner_text('#hud-sim'), '| editor open', pg.locator('#tg').is_visible())
    if 'Simulate' not in pg.inner_text('#hud-sim') or 'Stop' in pg.inner_text('#hud-sim'): problems.append('esc did not stop')
    if not pg.locator('#tg').is_visible(): problems.append('Esc left the editor')
    # tooltip text from the game's language file
    pg.click('#hud-sim'); pg.wait_for_timeout(300)
    pg.mouse.move(*at(28, 473)); pg.wait_for_timeout(400)
    pg.screenshot(path=f'{out}/8_tooltip.png')
    b.close()
print('problems:', problems or 'none')
