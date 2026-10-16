"""GUI Editor: the in-park screen (top bar and left buttons) and the animation editor.
usage: python tests/ui_hud_anims.py http://127.0.0.1:8768 <out folder>
Run it against a viewer on a SCRATCH copy of the game folder (it saves an imported animation into Main.common.ovl and
restores it at the end)."""
import io
import os
import sys

from PIL import Image, ImageDraw
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
    pg.click('#tg-modes button[data-m=gui]')
    pg.wait_for_selector('#gu-tabs button[data-v=hud].on', timeout=120000)
    pg.wait_for_timeout(2500)
    pg.screenshot(path=f'{out}/1_hud.png')

    def canvas_xy(x, y):   # a point of the 1280 x 800 screen -> page coordinates
        return pg.evaluate("""([x, y]) => { const c = document.querySelector('#hud-cv'), b = c.getBoundingClientRect();
            const W = c.clientWidth, H = c.clientHeight, v = document.querySelector('#hud-view').value;
            const V = { all: [0, 0, 1280, 800], top: [290, 0, 700, 40], left: [0, 145, 120, 480] }[v];
            const s = Math.min(W / V[2], H / V[3]), ox = (W - V[2] * s) / 2 - V[0] * s, oy = (H - V[3] * s) / 2 - V[1] * s;
            return [b.left + ox + x * s, b.top + oy + y * s]; }""", [x, y])

    # the top bar, zoomed; the pause button
    pg.select_option('#hud-view', 'top'); pg.wait_for_timeout(400)
    pg.screenshot(path=f'{out}/2_top.png')
    x, y = canvas_xy(352, 11); pg.mouse.click(x, y); pg.wait_for_timeout(500)
    h3 = pg.inner_text('#gu-right h3'); nv = pg.eval_on_selector_all('#hud-vars .state', 'e => e.length')
    print('clicked pause ->', h3, '| pictures', nv, '| icon', pg.evaluate("document.querySelector('#gu-right .kv b')?.textContent"))
    if h3.strip().lower() != 'pause' or nv != 2: problems.append(f'pause selection: {h3} {nv}')
    pg.select_option('#hud-speed', '0'); pg.select_option('#hud-weather', 'IconThunderstorm'); pg.check('#hud-fw'); pg.wait_for_timeout(400)
    pg.screenshot(path=f'{out}/3_top_states.png')
    # the bar's stretched piece, the weather icon
    for (px, py, want) in [(450, 20, 'top bar, left half'), (687, 11, 'weather'), (620, 4, 'top bar, middle')]:
        x, y = canvas_xy(px, py); pg.mouse.click(x, y); pg.wait_for_timeout(300)
        got = pg.inner_text('#gu-right h3').strip().lower(); print(f'click {px},{py} ->', got)
        if got != want: problems.append(f'click {px},{py}: {got} (wanted {want})')
    # left buttons
    pg.select_option('#hud-view', 'left'); pg.check('#hud-career'); pg.wait_for_timeout(400)
    pg.screenshot(path=f'{out}/4_left.png')
    x, y = canvas_xy(28, 520); pg.mouse.click(x, y); pg.wait_for_timeout(300)
    got = pg.inner_text('#gu-right h3').strip(); print('left button ->', got)
    if got.lower() != 'paths button': problems.append(f'left button: {got}')
    pg.select_option('#hud-view', 'all'); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{out}/5_all.png')

    # animations: reorder, then undo
    pg.click('#gu-tabs button[data-v=anims]'); pg.wait_for_timeout(2500)
    sec = pg.locator('#gu-anims .anim[data-name="MassiveWaiting"]')
    print('MassiveWaiting section:', sec.count())
    sec.locator('.row2 .state').first.locator('button[data-k=r]').click(); pg.wait_for_timeout(800)
    sec = pg.locator('#gu-anims .anim[data-name="MassiveWaiting"]')
    moved = pg.evaluate("document.querySelector('#gu-right').innerText.match(/(\\d+) rectangles? moved/)?.[1]")
    print('after moving frame 1 later: moved rectangles', moved, '| not saved mark', sec.locator('.mod').count())
    if moved != '2': problems.append(f'reorder: {moved}')
    sec.scroll_into_view_if_needed(); pg.screenshot(path=f'{out}/6_anims_reordered.png')
    pg.click('#gu-undo'); pg.wait_for_timeout(800)

    # import a strip: six coloured squares numbered 1-6, saved into the scratch copy
    strip = Image.new('RGBA', (240, 40))
    d = ImageDraw.Draw(strip)
    for i in range(6):
        d.rectangle([i * 40 + 2, 2, i * 40 + 37, 37], fill=(40 * i, 200 - 30 * i, 255, 255)); d.text((i * 40 + 15, 12), str(i + 1), fill=(0, 0, 0, 255))
    sp = os.path.join(out, 'strip.png'); strip.save(sp)
    sec = pg.locator('#gu-anims .anim[data-name="MassiveWaiting"]')
    with pg.expect_file_chooser() as fc:
        sec.locator('button.imp').click()
    fc.value.set_files(sp)
    pg.wait_for_selector('#tg .dlg button.primary', timeout=20000); pg.click('#tg .dlg button.primary')
    pg.wait_for_function("document.querySelector('#tg-toast')?.textContent.includes('Saved')", timeout=60000)
    print('toast:', pg.text_content('#tg-toast'))
    pg.wait_for_timeout(2000)
    sec = pg.locator('#gu-anims .anim[data-name="MassiveWaiting"]'); sec.scroll_into_view_if_needed()
    pg.screenshot(path=f'{out}/7_anims_imported.png')
    # what the game file now holds at frame 3's place
    png = pg.evaluate("""async () => { const r = await fetch('/api/tx/image?path=Main.common.ovl&name=GUI2LargeIcons4:tex&t=' + Date.now()); const b = await r.arrayBuffer(); return Array.from(new Uint8Array(b)); }""")
    im = Image.open(io.BytesIO(bytes(png))).convert('RGBA')
    px = im.getpixel((80 + 5, 120 + 5)); print('frame 3 place now', px, '(wanted about', (80, 140, 255), ')')
    if abs(px[0] - 80) > 20 or abs(px[1] - 140) > 20 or px[2] < 220: problems.append(f'imported pixel {px}')
    edits = pg.evaluate("fetch('/api/tx/gui').then(r => r.json()).then(j => Object.keys(j.edits))")
    print('changed files:', edits)
    r = pg.evaluate("fetch('/api/tx/restore', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({path: 'Main.common.ovl'})}).then(r => r.json())")
    print('restored; changed files now', list(r.get('edits', {}).keys()))
    b.close()
print('problems:', problems or 'none')
