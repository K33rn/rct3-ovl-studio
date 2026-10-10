// Fireworks editor: lasers (.las) and water jets (.wjt). Both are driven by "blenders": control points over the
// effect's run time (colour, elevation, rotation speed, beam width / pressure, nozzle size), interpolated linearly
// and held before the first and after the last point. A laser at a moment depends only on how long it has run (its
// spin is the integral of rotation speed), so scrubbing the show is exact. Beams are drawn as camera-facing glowing
// ribbons; water jets feed the particle system.
import * as THREE from 'three';

// ---- blenders --------------------------------------------------------------------------------------------------
function times(bl, duration) {
  const k = bl.scale && bl.max > 0 && duration > 0 ? duration / bl.max : 1;    // "scale settings with duration"
  return bl.pts.map(p => p.t * k);
}
export function blenderAt(bl, tau, duration) {
  const pts = bl?.pts || [];
  if (!pts.length) return 0;
  const T = times(bl, duration);
  const lerp = (a, b, k) => Array.isArray(a) ? a.map((x, i) => x + (b[i] - x) * k) : a + (b - a) * k;
  if (tau <= T[0]) return pts[0].v;
  for (let i = 1; i < pts.length; i++) if (tau <= T[i]) return lerp(pts[i - 1].v, pts[i].v, (tau - T[i - 1]) / Math.max(1e-6, T[i] - T[i - 1]));
  return pts[pts.length - 1].v;
}
export function blenderIntegral(bl, tau, duration) {   // ∫0..tau of a number blender (rotation angle from speed)
  const pts = bl?.pts || [];
  if (!pts.length || tau <= 0) return 0;
  const T = times(bl, duration);
  let s = 0, t = 0, v = pts[0].v;
  const seg = (t1, v1) => { const e = Math.min(t1, tau); if (e > t) { const ve = v + (v1 - v) * ((e - t) / Math.max(1e-6, t1 - t)); s += (v + ve) / 2 * (e - t); t = e; v = ve; } };
  seg(T[0], pts[0].v);                                   // flat before the first point
  for (let i = 1; i < pts.length && t < tau; i++) seg(T[i], pts[i].v);
  if (t < tau) s += v * (tau - t);                       // flat after the last
  return s;
}

// ---- ribbons: glowing camera-facing strips from A to B --------------------------------------------------------
export function createRibbons(scene, max = 8000) {
  const g = new THREE.BufferGeometry();
  const A = (name, n) => { const a = new THREE.BufferAttribute(new Float32Array(max * 4 * n), n); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
  const at = { a: A('aA', 3), b: A('aB', 3), c: A('aCorner', 2), w: A('aW', 2), col: A('aCol', 4), f: A('aFade', 2) };
  g.setAttribute('position', at.a);                      // three needs one; aA doubles as it
  const idx = new Uint32Array(max * 6);
  for (let i = 0; i < max; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const corners = [[0, -1], [1, -1], [1, 1], [0, 1]];
  for (let i = 0; i < max; i++) for (let k = 0; k < 4; k++) at.c.array.set(corners[k], (i * 4 + k) * 2);
  at.c.needsUpdate = true;
  const vs = `attribute vec3 aA; attribute vec3 aB; attribute vec2 aCorner; attribute vec2 aW; attribute vec4 aCol; attribute vec2 aFade;
    uniform float level; uniform float px; varying float vSide; varying vec4 vCol; varying float vA;
    void main() {
      vec3 a = aA, b = aB;
    #ifdef MIRROR
      a.y = 2.0 * level - a.y; b.y = 2.0 * level - b.y;
    #endif
      vec3 Av = (modelViewMatrix * vec4(a, 1.0)).xyz, Bv = (modelViewMatrix * vec4(b, 1.0)).xyz;
      vec3 P = mix(Av, Bv, aCorner.x);
      vec3 d = Bv - Av; d = length(d) > 1e-5 ? normalize(d) : vec3(0.0, 1.0, 0.0);
      vec3 n = cross(d, normalize(-P)); n = length(n) > 1e-5 ? normalize(n) : vec3(1.0, 0.0, 0.0);
      // at least ~3 pixels wide, so thin beams still read from the crowd (px = view height of one pixel at depth 1)
      P += n * aCorner.y * max(mix(aW.x, aW.y, aCorner.x), -P.z * px * 3.0) * 0.5;
      gl_Position = projectionMatrix * vec4(P, 1.0);
      vSide = aCorner.y; vCol = aCol; vA = mix(aFade.x, aFade.y, aCorner.x);
    }`;
  const fs = `uniform float gain; varying float vSide; varying vec4 vCol; varying float vA;
    void main() { float e = 1.0 - vSide * vSide; e *= e; gl_FragColor = vec4(vCol.rgb * vCol.a * vA * e * gain, 1.0); }`;
  const mat = (mirror) => new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: { level: { value: 0 }, px: { value: 0.001 }, gain: { value: mirror ? 0.35 : 1.8 } },
    defines: mirror ? { MIRROR: 1 } : {}, transparent: true, depthWrite: false, depthTest: !mirror, side: THREE.DoubleSide,  // quads face either way
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
    ...(mirror ? { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilZPass: THREE.KeepStencilOp, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp } : {}) });
  const mesh = new THREE.Mesh(g, mat(false)); mesh.frustumCulled = false; mesh.renderOrder = 5; scene.add(mesh);
  const mirror = new THREE.Mesh(g, mat(true)); mirror.frustumCulled = false; mirror.renderOrder = 2; mirror.visible = false; scene.add(mirror);
  let n = 0;
  return {
    mesh, mirror,
    begin() { n = 0; },
    add(ax, ay, az, bx, by, bz, w0, w1, r, gg, b, al, f0 = 1, f1 = 1) {
      if (n >= max) return;
      for (let k = 0; k < 4; k++) {
        const v = n * 4 + k;
        at.a.array.set([ax, ay, az], v * 3); at.b.array.set([bx, by, bz], v * 3);
        at.w.array.set([w0, w1], v * 2); at.col.array.set([r, gg, b, al], v * 4); at.f.array.set([f0, f1], v * 2);
      }
      n++;
    },
    end() {
      g.setDrawRange(0, n * 6);
      for (const k of ['a', 'b', 'w', 'col', 'f']) { const a = at[k]; a.needsUpdate = true; a.clearUpdateRanges?.(); a.addUpdateRange?.(0, n * 4 * a.itemSize); }
    },
    count: () => n,
    setPixel(camera, heightPx) { const v = 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, heightPx); mesh.material.uniforms.px.value = v; mirror.material.uniforms.px.value = v; },
  };
}

// ---- lasers -----------------------------------------------------------------------------------------------------
const _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function dirLocal(elev, phi) { return new THREE.Vector3(Math.cos(elev) * Math.cos(phi), Math.sin(elev), Math.cos(elev) * Math.sin(phi)); }

// Draw a laser `tau` seconds after it started, from origin O with the emitter's orientation q.
// ground(x, z) -> terrain height (beams stop there and leave a spot). opts: {tint, trail (bool)}
export function drawLaser(R, def, tau, O, q, ground, opts = {}) {
  const dur = def.duration || 5;
  if (tau < 0 || tau > dur) return;
  let col = blenderAt(def.colour, tau, dur);
  if (!Array.isArray(col)) col = [1, 1, 1, 1];
  let [r, g, b, a] = col;
  if (opts.tint) { r *= opts.tint[0]; g *= opts.tint[1]; b *= opts.tint[2]; }
  if (a < 0.01 || r + g + b < 0.01) return;
  const elev = +blenderAt(def.elevation, tau, dur) || 0, rot = blenderIntegral(def.rotvel, tau, dur);
  const width = Math.max(0.05, +blenderAt(def.width, tau, dur) || 1);
  const N = Math.max(1, Math.min(200, def.beams | 0)), L = Math.max(1, Math.min(900, def.power || 100));
  const fade = opts.fade ?? 1;
  const beam = (d) => {
    d.applyQuaternion(q);
    let len = L, hit = false;
    if (d.y < 0.02) {                                            // stop at the ground
      const steps = 24;
      for (let s = 1; s <= steps; s++) {
        const t = L * s / steps;
        if (O.y + d.y * t < ground(O.x + d.x * t, O.z + d.z * t)) {
          let lo = L * (s - 1) / steps, hi = t;
          for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (O.y + d.y * m < ground(O.x + d.x * m, O.z + d.z * m)) hi = m; else lo = m; }
          len = hi; hit = true; break;
        }
      }
    }
    const ex = O.x + d.x * len, ey = O.y + d.y * len, ez = O.z + d.z * len;
    // a beam `width` metres across that spreads a little with distance (width is the game's Spread: 1 = normal)
    R.add(O.x, O.y, O.z, ex, ey, ez, 0.35 * width, width * (1 + len * 0.006), r, g, b, a, fade, hit ? fade * 0.9 : fade * 0.05);
    if (hit) {                                                    // glowing spot where it lands
      const s = 0.6 + width * 0.6;
      R.add(ex - s, ey + 0.05, ez, ex + s, ey + 0.05, ez, s, s, r, g, b, a * 1.4, fade, fade);
      R.add(ex, ey + 0.05, ez - s, ex, ey + 0.05, ez + s, s, s, r, g, b, a * 1.4, fade, fade);
    }
  };
  const images = def.images || [];
  if (def.render === 2 && images.some(im => im.points?.length > 1)) {
    // persisting image: frames drawn one after another; the whole frame glows where the beam has drawn it
    const total = images.reduce((s, im) => s + Math.max(0.05, im.duration || 1), 0);
    let lt = tau % total, fi = 0;
    while (fi < images.length - 1 && lt > Math.max(0.05, images[fi].duration || 1)) { lt -= Math.max(0.05, images[fi].duration || 1); fi++; }
    const im = images[fi], pts = im.points || [];
    if (pts.length > 1) {
      const fwd = dirLocal(elev, rot).applyQuaternion(q).normalize();
      const right = new THREE.Vector3().crossVectors(fwd, _up); if (right.lengthSq() < 1e-6) right.set(1, 0, 0); right.normalize();
      const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
      const D = Math.max(15, Math.min(150, L * 0.5)), k = (def.image_scale || 10) / 10 * D / 40;
      // centred: around the drawing's own middle; otherwise around the middle of the game's 32 x 24 drawing pad
      let cx = 16, cy = 12;
      if (def.centre) { cx = cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length; }
      const P = p => new THREE.Vector3().copy(O).addScaledVector(fwd, D).addScaledVector(right, (p[0] - cx) * k).addScaledVector(up, (p[1] - cy) * k);
      const prog = Math.min(1, lt / Math.max(0.05, im.duration || 1)), cur = Math.max(1, Math.floor(prog * (pts.length - 1)) + 1);
      const lw = 0.22 * width * D / 60;
      let prev = P(pts[0]);
      for (let i = 1; i < pts.length; i++) {
        const p = P(pts[i]);
        if (im.solid?.[i] ?? 1) R.add(prev.x, prev.y, prev.z, p.x, p.y, p.z, lw, lw, r, g, b, a * (i <= cur ? 1 : 0.55), fade, fade);
        prev = p;
      }
      const tip = P(pts[Math.min(cur, pts.length - 1)]);
      R.add(O.x, O.y, O.z, tip.x, tip.y, tip.z, 0.05 * width, 0.12 * width, r, g, b, a * 0.6, fade, fade * 0.4);
    }
  } else if (def.render === 1) {
    // plane of light: beams fanned across the sky in one plane, the plane turning with the rotation
    for (let i = 0; i < N; i++) {
      const e = N === 1 ? elev : elev + (Math.PI - 2 * elev) * i / (N - 1);
      beam(dirLocal(e, rot));
    }
  } else {
    // cone of light: N beams around the emitter's axis at the elevation, turning with the rotation
    for (let i = 0; i < N; i++) beam(dirLocal(elev, rot + 2 * Math.PI * i / N));
  }
  if (opts.trail !== false && (def.trail || 0) > 0.04) {        // afterglow: earlier positions, fading
    for (let j = 1; j <= 4; j++) drawLaser(R, def, tau - j * def.trail / 4, O, q, ground, { ...opts, trail: false, fade: fade * (1 - j / 5) * 0.6 });
  }
}

// ---- water jets: the jet's state at a moment; the editor turns it into particles ----------------------------------
export function jetState(def, tau) {
  const dur = def.duration || 10;
  if (tau < 0 || tau > dur) return null;
  let col = blenderAt(def.colour, tau, dur); if (!Array.isArray(col)) col = [0.85, 0.9, 1, 1];
  return { pressure: Math.max(0, +blenderAt(def.pressure, tau, dur) || 0), elev: +blenderAt(def.elevation, tau, dur) || 0,
           radius: Math.max(0.05, +blenderAt(def.radius, tau, dur) || 1), colour: col };
}
export function jetDir(elev, q) { return new THREE.Vector3(Math.sin(elev), Math.cos(elev), 0).applyQuaternion(q); }

export function effectDuration(kind, def) { return kind === 'firework' ? def.duration : def.duration || 5; }
export const defaultLaser = () => ({ kind: 'laser', name: 'My laser', duration: 8, render: 0, power: 200, beams: 12, trail: 0.03, image_scale: 10, centre: true,
  colour: { scale: true, max: 8, pts: [{ t: 0.3, v: [0.2, 0.4, 1, 1] }, { t: 4, v: [1, 0.2, 0.8, 1] }, { t: 7.7, v: [1, 1, 1, 0] }] },
  elevation: { scale: true, max: 8, pts: [{ t: 0.3, v: 1.2 }, { t: 4, v: 0.6 }, { t: 7.7, v: 1.3 }] },
  rotvel: { scale: true, max: 8, pts: [{ t: 0.3, v: 0.5 }, { t: 6, v: 2 }] },
  width: { scale: true, max: 8, pts: [{ t: 0.3, v: 1.0 }] }, images: [] });
export const defaultJet = () => ({ kind: 'jet', name: 'My water jet', duration: 10, type: 1,
  colour: { scale: false, max: 10, pts: [{ t: 0.3, v: [0.85, 0.9, 1, 1] }] },
  elevation: { scale: false, max: 10, pts: [{ t: 0.3, v: 0 }, { t: 5, v: 0.6 }, { t: 9.7, v: 0 }] },
  pressure: { scale: false, max: 10, pts: [{ t: 0.3, v: 14 }, { t: 5, v: 18 }, { t: 9.5, v: 0 }] },
  radius: { scale: false, max: 10, pts: [{ t: 0.3, v: 1.0 }] } });
