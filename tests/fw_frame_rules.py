"""Fireworks preview: the new particle's frame as RCT3plus.exe builds it (emitter 0x9cbdf0, update 0x9c8390 / 0x9c75e0),
on made-up fireworks:
- a non-relative emitter fires along world +Y turned about the WORLD axes in the game's sense (0xbedee0: SpinOffsetX a
  takes +Y to (0, cos a, -sin a));
- a relative emitter turns its parent's frame about the parent's OWN axes (0xbedd30: travel' = cos a travel + sin a up),
  so a parent flying sideways tilts its child towards its own up, not about world X;
- a ParticleBaseDesc ('base') never moves; a ParticleDesc with gravity falls;
- a still ParticleDesc's later children leave along +Z (its frame rebuilt from a zero velocity, 0xbed6e0).
usage: python tests/fw_frame_rules.py http://127.0.0.1:8768"""
import math
import sys

from playwright.sync_api import sync_playwright

base = sys.argv[1]
problems = []


def check(name, got, want, tol=0.03):
    ok = all(abs(g - w) <= tol for g, w in zip(got, want))
    print(f'{name}: {[round(g, 3) for g in got]} (want {[round(w, 3) for w in want]})')
    if not ok:
        problems.append(name)


JS = r'''(spec) => { const D = window.__fwdebug;
  const nodes = {}, key = 'zz-rules-' + Math.random();
  // spec: list of [id, kind, fields, emitters: [[emitterId, fields, childId]]]
  for (const [id, kind, f, ems] of spec) {
    nodes[id] = Object.assign({ kind, Lifetime: 1 }, f, { ParticleEmitterDescs: ems.map(e => e[0]) });
    for (const [eid, ef, child] of ems) nodes[eid] = Object.assign({ kind: 'emitter', NumParticles: 1, StartTime: 0, EndTime: 1 }, ef, { ParticleDesc: child });
  }
  const fw = { key, root: spec[0][0], nodes };
  D.parts().length = 0; D.ctx.previewEffect('firework', fw);
  const idOf = new Map(Object.entries(nodes).map(([k, v]) => [v, k])), seen = {};
  for (let i = 0; i < 90; i++) { D.step(1 / 60);
    for (const p of D.parts()) { const id = idOf.get(p.d.n); const s = seen[id] ??= { v: [p.vx, p.vy, p.vz], p0: [p.x, p.y, p.z] }; s.p = [p.x, p.y, p.z]; } }
  return seen; }'''

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(base + '/')
    pg.evaluate('[`main`, `mixmaster`, `afe`].forEach(k => localStorage.setItem(`rct3ovl.tour.` + k, `1`))')
    pg.goto(base + '/#fireworks'); pg.wait_for_selector('#fw .fwk', timeout=300000); pg.wait_for_timeout(1000)
    a = 0.5
    # 1. non-relative, SpinOffsetX a, speed 10: (0, 10 cos a, -10 sin a)
    r = pg.evaluate(JS, [['1', 'base', {}, [['2', {'ParticleSpeed': 10, 'SpinOffsetX': a}, '3']]], ['3', 'particle', {'Lifetime': 2}, []]])
    check('world X turn (non-relative)', r['3']['v'], [0, 10 * math.cos(a), -10 * math.sin(a)])
    # 2. a parent flying along +X (world Z turn of pi/2 on a non-relative emitter: +Y -> +X), then a relative child with
    #    SpinOffsetX a: about the parent's own side axis, travel' = cos a travel + sin a up (up stays +Z)
    r = pg.evaluate(JS, [['1', 'base', {}, [['2', {'ParticleSpeed': 10, 'SpinOffsetZ': math.pi / 2}, '3']]],
                         ['3', 'particle', {'Lifetime': 0.5}, [['4', {'ParticleSpeed': 10, 'SpinOffsetX': a, 'ParticleRelative': 1, 'StartTime': 0.5, 'EndTime': 0.5}, '5']]],
                         ['5', 'particle', {'Lifetime': 1}, []]])
    check('parent along +X (world Z turn)', r['3']['v'], [10, 0, 0])
    check('own X turn (relative)', r['5']['v'], [10 * math.cos(a), 0, 10 * math.sin(a)])
    # 3. a base particle given a speed does not move; a ParticleDesc with gravity falls
    r = pg.evaluate(JS, [['1', 'base', {}, [['2', {'ParticleSpeed': 10}, '3'], ['4', {'ParticleSpeed': 0}, '5']]],
                         ['3', 'base', {'Lifetime': 2}, []], ['5', 'particle', {'Lifetime': 2, 'GravityScale': 1}, []]])
    check('base particle stays put', [r['3']['p'][i] - r['3']['p0'][i] for i in range(3)], [0, 0, 0], 1e-6)
    print('ParticleDesc with gravity fell', round(r['5']['p0'][1] - r['5']['p'][1], 2), 'm')
    if not r['5']['p0'][1] - r['5']['p'][1] > 1:
        problems.append('gravity')
    # 4. a still ParticleDesc (no speed, no gravity) releasing late in its life: along +Z
    r = pg.evaluate(JS, [['1', 'base', {}, [['2', {}, '3']]],
                         ['3', 'particle', {'Lifetime': 1}, [['4', {'ParticleSpeed': 10, 'ParticleRelative': 1, 'StartTime': 0.6, 'EndTime': 0.6}, '5']]],
                         ['5', 'particle', {'Lifetime': 1}, []]])
    check('still ParticleDesc fires along +Z', r['5']['v'], [0, 0, 10])
    b.close()
print('page errors', errs[:3])
print('problems:', problems or 'none')
sys.exit(1 if problems or errs else 0)
