"""Terrain blend as the game draws it: a lone tile of another texture is a 25% plateau over the tile, fading linearly to
nothing one tile out (measured in the game by painting single tiles, 2026-10-21). Finds a lone tile on flat ground in a
park, looks straight down on it with only the ground shown, and prints the tint profile across it (tile units).
usage: python tests/terrain_blend.py <base> [park title]"""
import sys

from playwright.sync_api import sync_playwright

base = sys.argv[1]
title = sys.argv[2] if len(sys.argv) > 2 else 'Cosmic Craggs'
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=d3d11', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1000, 'height': 800})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(base + '/')
    pg.evaluate("[`main`, `mixmaster`, `afe`, `parks`].forEach(k => localStorage.setItem(`rct3ovl.tour.` + k, `1`))")
    pg.reload(); pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=300000)
    pg.click('#b-parks'); pg.wait_for_selector('#pk .pk', timeout=60000)
    f = pg.evaluate('t => [...document.querySelectorAll("#pk .pk")].find(e => e.textContent.trim().replace(/^\\d+\\s*/, "") === t)?.dataset.f', title)
    pg.evaluate('f => [...document.querySelectorAll("#pk .pk")].find(e => e.dataset.f === f).click()', f)
    pg.wait_for_function('f => window.__pkdebug.loaded === f', arg=f, timeout=600000); pg.wait_for_timeout(4000)
    # a lone tile whose 5 x 3 surroundings (5 along x) are flat and all one other texture
    spot = pg.evaluate('''() => { const W = window.__pkdebug.world, C = W.cols, R = W.rows, t = W.tex, h = W.heights;
      const flat = i => h[4 * i] === h[4 * i + 1] && h[4 * i] === h[4 * i + 2] && h[4 * i] === h[4 * i + 3];
      for (let r = 2; r < R - 2; r++) for (let c = 2; c < C - 2; c++) {
        const i = r * C + c, o = t[i - 1]; if (t[i] === o) continue; let ok = true;
        for (let dr = -1; dr <= 1 && ok; dr++) for (let dc = -2; dc <= 2; dc++) {
          const j = (r + dr) * C + c + dc; if (!flat(j) || h[4 * j] !== h[4 * i] || (j !== i && t[j] !== o)) { ok = false; break; } }
        if (ok) return { c, r, tex: t[i], other: o, h: h[4 * i] / 100 };
      } return null; }''')
    print('lone tile', spot)
    if not spot:
        sys.exit('no lone tile on flat ground in ' + title)
    # only the ground; camera straight down on the tile centre (parks.js mirrors z)
    pg.evaluate('''s => { const D = window.__pkdebug, W = D.world;
      for (const k in D.layers) D.layers[k].visible = k === 'terrain';
      const x = W.x0 + W.tile * (s.c + 0.5), z = -(W.z0 + W.tile * (s.r + 0.5));
      D.controls.target.set(x, s.h, z); D.camera.position.set(x, s.h + 40, z + 0.001); D.camera.up.set(0, 0, -1);
      D.camera.lookAt(x, s.h, z); D.controls.update(); D.renderer.render(D.scene, D.camera);
      return { x, z }; }''', spot)
    # the camera looks straight down (screen right = +x, screen down = +z): metres -> canvas fractions by hand
    r = pg.evaluate('''() => { const D = window.__pkdebug, c = D.camera, e = D.renderer.domElement.getBoundingClientRect();
      return { x: e.x, y: e.y, w: e.width, h: e.height, perM: e.height / (2 * 40 * Math.tan(c.fov * Math.PI / 360)), T: D.world.tile }; }''')
    clip = {'x': r['x'], 'y': r['y'], 'width': r['w'], 'height': r['h']}

    def paint(only):
        """Every ground texture flat grey (dark enough not to clip once lit), or only the lone tile's (the rest black):
        the ratio of the two renders is the blend weight with the detail texture and lighting divided out."""
        pg.evaluate('''([tex, only]) => { const D = window.__pkdebug, W = D.world;
          const g = D.layers.terrain.children.find(m => m.userData.ground), L = g.material.userData.textures[1];
          const used = [...new Set(W.tex)].sort((a, b) => a - b), n = 256 * 256 * 4;
          used.forEach((t, k) => L.image.data.fill(!only || t === tex ? 90 : 0, k * n, (k + 1) * n));
          L.needsUpdate = true; D.renderer.render(D.scene, D.camera); }''', [spot['tex'], only])
        pg.wait_for_timeout(1500)
        return pg.screenshot(clip=clip)
    shots = paint(True), paint(False)
    print('errors', errors[:5])
    b.close()

import io

import numpy as np
from PIL import Image


def linear(png):                                     # screen values are sRGB: back to linear light before dividing
    c = np.asarray(Image.open(io.BytesIO(png)).convert('L'), float) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


one, every = (linear(x) for x in shots)
H, W = one.shape
ppt = r['T'] * r['perM']                               # pixels per tile
cx, cy, band = W / 2, H / 2, int(ppt * 0.3)


def weight(u):
    x = int(cx + u * ppt)
    a = one[int(cy) - band:int(cy) + band, x - 1:x + 2].mean()
    e = every[int(cy) - band:int(cy) + band, x - 1:x + 2].mean()
    return a / max(e, 1e-6)


# expected from the game: 0.25 plateau over the tile, linear to 0 one tile out
expect = lambda u: 0.25 if abs(u) <= 0.5 else max(0.0, 0.25 * (1.5 - abs(u)))
worst = 0.0
print('u (tiles)  weight  expected')
for k in range(-16, 17):
    u = k / 8
    w = weight(u)
    if abs(u) <= 1.5:                                  # further out other tiles of that texture may show
        worst = max(worst, abs(w - expect(u)))
    print(f'{u:+.3f}  {w:5.3f}  {expect(u):5.3f} ' + '#' * int(w * 160))
print('worst difference from the game model:', round(worst, 3))
