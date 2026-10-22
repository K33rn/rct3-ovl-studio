"""A shipped firework simulated in the viewer at a fixed step, measured the way the game's MixMaster picker preview was
(recording, 2026-10-21): launch spacing, shell rise time, and the stars' spread relative to the shell's rise (a ratio,
so the preview camera's framing drops out).
usage: python tests/fw_vs_game.py <base> [file.frw] [burst desc id] [star desc id]"""
import json
import sys

from playwright.sync_api import sync_playwright

base = sys.argv[1]
key = sys.argv[2] if len(sys.argv) > 2 else 'GreenPeony.frw'
burst_id = sys.argv[3] if len(sys.argv) > 3 else '8024'
star_id = sys.argv[4] if len(sys.argv) > 4 else '8026'
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1300, 'height': 800})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(base + '/')
    pg.evaluate('localStorage.clear(); [`main`, `mixmaster`, `afe`].forEach(k => localStorage.setItem(`rct3ovl.tour.` + k, `1`))')
    pg.goto(base + '/#fireworks'); pg.wait_for_selector('#fw .fwk', timeout=180000); pg.wait_for_timeout(1500)
    res = pg.evaluate('''([key, burstId, starId]) => { const D = window.__fwdebug, fw = D.REG.firework[key];
      if (!fw) return { error: 'no ' + key, keys: Object.keys(D.REG.firework).slice(0, 40) };
      D.parts().length = 0;
      D.ctx.previewEffect('firework', fw);
      const dt = 1 / 120, out = { launches: [], bursts: [], samples: [] }, seen = new Set();
      for (let i = 0; i < 120 * 5; i++) {
        D.step(dt); const t = (i + 1) * dt;
        for (const p of D.parts()) {
          if (seen.has(p)) continue; seen.add(p);
          const id = String(p.d.n === fw.nodes[fw.root] ? fw.root : Object.keys(fw.nodes).find(k => fw.nodes[k] === p.d.n));
          if (p.d.n.SoundName === 'Fireworklaunch3' || id === '8018') out.launches.push([t, p.x, p.y, p.z]);
          if (id === burstId) out.bursts.push([t, p.x, p.y, p.z]);
        }
        if (i % 6 === 5) out.samples.push([t, D.parts().filter(p => fw.nodes[starId] === p.d.n).map(p => [p.x, p.y, p.z])]);
      }
      return out; }''', [key, burst_id, star_id])
    print('errors', errors[:5])
    b.close()

if 'error' in res:
    sys.exit(json.dumps(res))
import numpy as np

L = res['launches']
print('launches (s):', [round(x[0], 3) for x in L])
print('bursts (s; x y z from the mortar, m):', [[round(x[0], 3)] + [round(c - l, 1) for c, l in zip(x[1:], L[0][1:])] for x in res['bursts']])
if L and res['bursts']:
    print('rise times:', [round(bt[0] - lt[0], 3) for lt, bt in zip(L, res['bursts'])])
    b0 = np.array(res['bursts'][0][1:]); l0 = np.array(L[0][1:]); rise = np.linalg.norm(b0 - l0)
    t0 = res['bursts'][0][0]
    print(f'first shell rose {rise:.1f} m; stars of the first burst, 90th percentile distance seen side on / rise:')
    for t, pts in res['samples']:
        tau = t - t0
        if 0 < tau <= 1.01:
            P = np.array(pts)
            if not len(P): continue
            d = np.hypot(P[:, 0] - b0[0], P[:, 1] - b0[1])         # seen along z, as the preview looks
            print(f'  {tau:.2f} s  {np.percentile(d, 90) / rise:.3f}  ({len(P)} stars)')
