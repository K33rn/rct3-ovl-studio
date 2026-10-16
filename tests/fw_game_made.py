"""Fireworks made in the game's Advanced firework editor (My Documents\\RCT3\\FireworkEffects) run in the viewer as in the
game. Checked in the game (Steam RCT3 Platinum, 2026-10-16):
- ZZSimpleBurst: one emitter, Start 0 / End 0, 89 particles - the game's preview shows nothing (an emitter fires only
  while the parent's previous time is before the window's end, 0x9cbdf0, and a particle's first step starts at 0);
- ZZ5End005: the same with End 0.05 - an 89-star white burst (empty colour curves draw white);
- ZZComplex: burst -> star (2 s) -> 55 orange (R 1, G 0.37, B 0.05) trail sparks per star over its life.
usage: python tests/fw_game_made.py http://127.0.0.1:8770"""
import base64
import os
import sys

from playwright.sync_api import sync_playwright

base = sys.argv[1]
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
problems = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1200, 'height': 760})
    pg.on('pageerror', lambda e: problems.append(f'pageerror {e}'))
    pg.add_init_script("try { ['main','mixmaster'].forEach(k => localStorage.setItem('rct3ovl.tour.' + k, '1')); } catch (e) {}")
    pg.goto(base + '/#fireworks'); pg.wait_for_selector('#fw .fwk', timeout=180000); pg.wait_for_timeout(1500)
    files = {n: base64.b64encode(open(os.path.join(DATA, n + '.frw'), 'rb').read()).decode() for n in ('ZZSimpleBurst', 'ZZ5End005', 'ZZComplex')}
    r = pg.evaluate("""async files => {
      const D = window.__fwdebug, out = {};
      for (const [name, b64] of Object.entries(files)) {
        // opened as the MixMaster's Open... does (POST /api/fw/parse)
        const res = await (await fetch('/api/fw/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name + '.frw', b64 }) })).json();
        if (!res.def) { out[name] = null; continue; }
        const key = 'test_' + name; D.FW[key] = Object.assign(res.def, { key });
        const fw = D.FW[key], root = fw.nodes[fw.root];
        const first = String(fw.nodes[root.ParticleEmitterDescs[0]].ParticleDesc);
        D.parts().length = 0;
        D.launch({ kind: 'firework', firework: key, launcher: null, slot: 0 }, true);
        let stars = 0, sparks = 0, colour = null;
        for (let i = 0; i < 60; i++) {
          D.step(1 / 60);
          const P = D.parts();
          stars = Math.max(stars, P.filter(q => q.d.n === fw.nodes[first]).length);
          const sp = P.filter(q => q.d.n !== fw.nodes[first] && q.d.n !== root);
          sparks = Math.max(sparks, sp.length);
        }
        out[name] = { stars, sparks };
      }
      D.parts().length = 0;
      return out; }""", files)
    print(r)
    if r.get('ZZSimpleBurst') is None or r['ZZSimpleBurst']['stars'] != 0:
        problems.append(f"End 0 burst should release nothing: {r.get('ZZSimpleBurst')}")
    if r.get('ZZ5End005') is None or r['ZZ5End005']['stars'] != 89:
        problems.append(f"End 0.05 burst should release 89: {r.get('ZZ5End005')}")
    if r.get('ZZComplex') is None or r['ZZComplex']['stars'] != 89 or r['ZZComplex']['sparks'] < 50:
        problems.append(f"complex: {r.get('ZZComplex')}")
    b.close()
print('problems:', problems or 'none')
