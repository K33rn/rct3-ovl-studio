"""A firework in the viewer frame by frame, from the game's MixMaster picker preview camera (pane 224 px; fitted to a
recording of the game: 117 deg lens 12.1 m from the mortar, 2 m up, tilted up 23.8 deg).
Saves one 224 x 224 picture per step for side by side comparison with a recording of the game's preview.
usage: python tests/fw_frames.py <base> <out.npy> [file.frw] [seconds] [step s] [nobloom]"""
import io
import sys

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
key = sys.argv[3] if len(sys.argv) > 3 else 'GreenPeony.frw'
secs = float(sys.argv[4]) if len(sys.argv) > 4 else 4.0
every = float(sys.argv[5]) if len(sys.argv) > 5 else 0.1
bloom = 'nobloom' not in sys.argv[6:]
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=d3d11', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1300, 'height': 800})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(base + '/')
    pg.evaluate('localStorage.clear(); [`main`, `mixmaster`, `afe`].forEach(k => localStorage.setItem(`rct3ovl.tour.` + k, `1`))')
    pg.goto(base + '/#fireworks'); pg.wait_for_selector('#fw .fwk', timeout=180000); pg.wait_for_timeout(2500)
    if not bloom:
        pg.click('#fw-bloom')                          # the Glow button: off
    box = pg.evaluate('''key => { const D = window.__fwdebug, fw = D.REG.firework[key]; D.stop(); D.parts().length = 0;
      D.ctx.previewEffect('firework', fw);
      const L = D.parts()[0], c = D.camera, e = c.domElement || document.querySelector('#fw canvas');
      c.up.set(0, 1, 0);
      D.controls.enabled = false;
      // only the particles, on black (the preview's sky); no launcher labels
      for (const o of D.scene.children) o.visible = !!(o.isMesh && o.renderOrder === 4);
      D.scene.background = null; D.labels.domElement.style.display = 'none';
      const r = document.querySelector('#fw canvas').getBoundingClientRect();
      // where the mortar, a point 55 m above it and the horizon come out, in the 224 px square
      const at = (x, y, z) => { c.updateMatrixWorld(); const v = c.position.clone().set(x, y, z).project(c);
        return [(v.x * r.width / 2 / r.height + 0.5) * 224, (0.5 - v.y / 2) * 224]; };
      // the game's preview camera, fitted to a recording (Green Peony's shell climbing at 38.55 m/s, the horizon at y 142,
      // the mortar at 157 - within 1.6 px - and the scatter of its bursts): 117 deg lens, 12.1 m back, 2 m up, 23.8 deg up
      const q = [2.0, 12.1, 23.8 * Math.PI / 180];
      c.fov = 117.4; c.updateProjectionMatrix();
      c.position.set(L.x, L.y + q[0], L.z + q[1]); c.lookAt(L.x, L.y + q[0] + q[1] * Math.tan(q[2]), L.z);
      return { x: r.x, y: r.y, w: r.width, h: r.height, mortar: at(L.x, L.y, L.z).map(Math.round),
               horizon: at(L.x, L.y + q[0], L.z - 1e5).map(Math.round) }; }''', key)
    print('mortar, horizon at', box['mortar'], box['horizon'], '(game: 157, 142)')
    frames = []
    n = round(secs / every)
    for k in range(n + 1):
        if k:
            pg.evaluate('([steps]) => { const D = window.__fwdebug; for (let i = 0; i < steps; i++) D.step(1 / 120); }', [round(every * 120)])
        pg.evaluate('() => window.__fwdebug.drawNow()')
        s = box['h']                                   # the middle square of the view, scaled to the pane's 224 px
        png = pg.screenshot(clip={'x': box['x'] + (box['w'] - s) / 2, 'y': box['y'], 'width': s, 'height': s})
        frames.append(np.asarray(Image.open(io.BytesIO(png)).convert('RGB').resize((224, 224), Image.LANCZOS)))
    print('errors', errors[:5])
    b.close()
np.save(out, np.stack(frames))
print(len(frames), 'frames')
