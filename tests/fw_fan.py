"""Fireworks preview: an emitter whose spin turns fast releases its particles fanned out, not stacked in one ball.
The game (RCT3plus.exe 0x9cbdf0) turns each particle by SpinRate x its own release time in the window, so 11 stars
released over 0.02 s by an emitter spinning at 100 rad/s leave 0.2 rad apart. Also: every shipped firework 6 s
without NaN.
usage: python tests/fw_fan.py http://127.0.0.1:8768 <screenshot.png>"""
import sys

from playwright.sync_api import sync_playwright

base, shot = sys.argv[1], sys.argv[2]
errs = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1200, 'height': 760})
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.add_init_script("try { ['main','mixmaster'].forEach(k => localStorage.setItem('rct3ovl.tour.' + k, '1')); } catch (e) {}")
    pg.goto(base + '/#fireworks'); pg.wait_for_selector('#fw .fwk', timeout=180000); pg.wait_for_timeout(1500)
    r = pg.evaluate("""() => {
      const D = window.__fwdebug, FW = D.FW;
      const any = Object.values(FW)[0], star = Object.values(any.nodes).find(n => n.kind === 'particle');
      const fan = { key: 'zzfan', file: 'zzfan.frw', title: 'Fan test', root: '1', nodes: {
        1: { kind: 'base', Lifetime: 1, ParticleEmitterDescs: [2] },
        2: { kind: 'emitter', NumParticles: 11, StartTime: 0, EndTime: 0.02, ParticleRelative: 1, ParticleSpeed: 25, ParticleDesc: 3,
             SpinOffsetX: -1, SpinRateX: 100, ParentSpeedFactor: 0 },
        3: { ...star, kind: 'particle', Lifetime: 1.5, LifetimeRandom: 0, GravityScale: 0.2, Drag: 0, UpScale: 0, SpinRateX: 0, SpinRateY: 0, ParticleEmitterDescs: [] } } };
      FW.zzfan = fan;
      D.parts().length = 0;
      D.launch({ kind: 'firework', firework: 'zzfan', launcher: null, slot: 0 }, true);
      for (let i = 0; i < 48; i++) D.step(1 / 60);
      const P = D.parts().filter(p => p.d.fw === fan && p.d.n === fan.nodes[3]);
      const o = P.length ? [0, 0, 0] : null;
      const ang = P.map(p => Math.atan2(p.vz, p.vy)).sort((a, b) => a - b);
      const dist = new Set(ang.map(a => a.toFixed(2))).size;
      return { n: P.length, distinct: dist, spread: ang.length ? +(ang[ang.length - 1] - ang[0]).toFixed(2) : 0 };
    }""")
    print('fan test: stars', r['n'], '| distinct directions', r['distinct'], '| spread', r['spread'], 'rad (wanted 11, 11, ~2)')
    if r['n'] != 11 or r['distinct'] < 10 or not 1.6 < r['spread'] < 2.2: errs.append(f'fan {r}')
    pg.wait_for_timeout(300); pg.screenshot(path=shot)
    # every firework 6 s without NaN, and its top height
    tops = pg.evaluate("""() => {
      const D = window.__fwdebug, out = {};
      for (const [k, fw] of Object.entries(D.FW)) {
        if (k === 'zzfan') continue;
        D.parts().length = 0; D.launch({ kind: 'firework', firework: k, launcher: null, slot: 0 }, true);
        let top = 0, nan = 0;
        for (let i = 0; i < 360; i++) { D.step(1 / 60); for (const p of D.parts()) { if (!isFinite(p.x + p.y + p.z)) nan++; else top = Math.max(top, p.y); } }
        out[fw.title || k] = [Math.round(top * 10) / 10, nan];
      }
      D.parts().length = 0; return out; }""")
    for k, (top, nan) in tops.items():
        print(f'  {k[:24]:24s} top {top:6.1f} m' + (f'  NaN {nan}' if nan else ''))
        if nan: errs.append(f'NaN {k}')
    b.close()
print('problems:', errs or 'none')
