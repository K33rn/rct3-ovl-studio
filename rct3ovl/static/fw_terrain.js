// Fireworks editor: landscape and water. A height grid of park tiles (4 m) the launchers stand on, shaped with
// raise / lower / smooth / flatten brushes, and water painted onto tiles at a chosen level. Water also marks where the
// show's reflections are drawn (stencil 1: the editor draws mirrored fireworks and lasers only there).
import * as THREE from 'three';

export const N = 100, TILE = 4, HALF = N * TILE / 2;   // 100 x 100 tiles = 400 m square around the show

const b64 = {
  enc(arr) { const u = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); },
  dec(str, Type) { const s = atob(str), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Type(u.buffer); },
};

export function createTerrain(scene) {
  const V = N + 1;
  let h = new Float32Array(V * V);                 // vertex heights, m
  let water = new Float32Array(N * N).fill(NaN);   // per tile water level, m (NaN: none)

  // ---- ground mesh: tile grid texture, colour by height and slope ----
  const geo = new THREE.PlaneGeometry(N * TILE, N * TILE, N, N); geo.rotateX(-Math.PI / 2);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(V * V * 3), 3));
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c2 = cv.getContext('2d'); c2.fillStyle = '#ffffff'; c2.fillRect(0, 0, 64, 64);
  c2.strokeStyle = 'rgba(0,0,0,0.28)'; c2.lineWidth = 2; c2.strokeRect(0, 0, 64, 64);
  const gridTex = new THREE.CanvasTexture(cv); gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping; gridTex.repeat.set(N, N);
  gridTex.anisotropy = 8; gridTex.colorSpace = THREE.SRGBColorSpace;
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: gridTex });
  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = false; ground.name = 'terrain';
  scene.add(ground);
  // tile lines drawn over a textured ground (switchable)
  const lc = document.createElement('canvas'); lc.width = lc.height = 64;
  const l2 = lc.getContext('2d'); l2.strokeStyle = 'rgba(255,255,255,0.55)'; l2.lineWidth = 2; l2.strokeRect(0, 0, 64, 64);
  const lineTex = new THREE.CanvasTexture(lc); lineTex.wrapS = lineTex.wrapT = THREE.RepeatWrapping; lineTex.repeat.set(N, N); lineTex.anisotropy = 8;
  const lines = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: lineTex, transparent: true, opacity: 0.35, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  lines.renderOrder = 0.5; lines.visible = false; scene.add(lines);
  let textured = false;
  const outerMat = new THREE.MeshLambertMaterial({ color: 0x0a130d });
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), outerMat);
  outer.position.y = -0.05; scene.add(outer);

  // ---- water: a mask (stencil 1 where water is) and the surface ----
  const wGeo = new THREE.BufferGeometry();
  const mask = new THREE.Mesh(wGeo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp }));
  mask.renderOrder = 1; scene.add(mask);
  const surface = new THREE.Mesh(wGeo, new THREE.MeshPhongMaterial({ color: 0x0d2a44, emissive: 0x020812, specular: 0x6688aa,
    shininess: 90, transparent: true, opacity: 0.62, depthWrite: false }));
  surface.renderOrder = 3; scene.add(surface);

  const vi = (i, j) => j * V + i;                 // vertex (column i, row j)
  const tileOf = (x, z) => [Math.floor((x + HALF) / TILE), Math.floor((z + HALF) / TILE)];
  function heightAt(x, z) {
    const fx = clamp((x + HALF) / TILE, 0, N - 1e-4), fz = clamp((z + HALF) / TILE, 0, N - 1e-4);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = h[vi(i, j)], b = h[vi(i + 1, j)], c = h[vi(i, j + 1)], d = h[vi(i + 1, j + 1)];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
  function waterAt(x, z) { const [i, j] = tileOf(x, z); return i >= 0 && j >= 0 && i < N && j < N ? water[j * N + i] : NaN; }

  function refreshGround() {
    const pos = geo.attributes.position, col = geo.attributes.color;
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const k = vi(i, j), y = h[k];
      pos.setY(k, y);
      const sl = Math.min(1, (Math.abs(h[vi(Math.min(i + 1, N), j)] - h[vi(Math.max(i - 1, 0), j)]) + Math.abs(h[vi(i, Math.min(j + 1, N))] - h[vi(i, Math.max(j - 1, 0))])) / 6);
      let r, g, b;
      if (textured) { const s = 1 - sl * 0.35; r = g = b = s; }                 // a game ground texture: light shading only
      else {
        r = 0.05; g = 0.11; b = 0.06;                                          // plain night grass
        r += sl * 0.08; g += sl * 0.02; b += sl * 0.02;                        // steeper: earth
        if (y > 12) { const k2 = Math.min(1, (y - 12) / 20); r += k2 * 0.08; g += k2 * 0.06; b += k2 * 0.07; }   // high: rock
        if (y < -0.5) { r = 0.09; g = 0.08; b = 0.05; }                        // dug out: mud / sand
      }
      col.setXYZ(k, r, g, b);
    }
    pos.needsUpdate = col.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
  }
  function refreshWater() {
    const P = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const L = water[j * N + i]; if (Number.isNaN(L)) continue;
      const x0 = i * TILE - HALF, z0 = j * TILE - HALF, x1 = x0 + TILE, z1 = z0 + TILE;
      P.push(x0, L, z0, x0, L, z1, x1, L, z1, x0, L, z0, x1, L, z1, x1, L, z0);
    }
    wGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    // drop the old normals first: computeVertexNormals reuses an existing (now too short) normal buffer, leaving NaN
    // normals on new tiles - NaN lighting then spreads through the glow pass and blacks out the view
    wGeo.deleteAttribute('normal');
    wGeo.computeVertexNormals(); wGeo.computeBoundingSphere();
    mask.visible = surface.visible = P.length > 0;
  }
  function mirrorLevel() {   // the most common water level (reflections are mirrored about one plane)
    const c = new Map(); for (const L of water) if (!Number.isNaN(L)) c.set(L, (c.get(L) || 0) + 1);
    let best = null, n = 0; for (const [L, k] of c) if (k > n) { best = L; n = k; }
    return best;
  }

  // ---- brushes ----
  function brush(tool, x, z, radius, strength, dt, opt = {}) {
    const ci = (x + HALF) / TILE, cj = (z + HALF) / TILE, R = Math.max(0.5, radius);
    let changedH = false, changedW = false;
    if (tool === 'water' || tool === 'dry') {
      const lvl = opt.level ?? 0;
      for (let j = Math.floor(cj - R); j <= Math.ceil(cj + R); j++) for (let i = Math.floor(ci - R); i <= Math.ceil(ci + R); i++) {
        if (i < 0 || j < 0 || i >= N || j >= N || Math.hypot(i + 0.5 - ci, j + 0.5 - cj) > R) continue;
        const k = j * N + i;
        if (tool === 'dry') { if (!Number.isNaN(water[k])) { water[k] = NaN; changedW = true; } }
        else {
          const low = Math.min(h[vi(i, j)], h[vi(i + 1, j)], h[vi(i, j + 1)], h[vi(i + 1, j + 1)]);
          if (low < lvl && water[k] !== lvl) { water[k] = lvl; changedW = true; }   // only where the ground is lower
        }
      }
      if (changedW) refreshWater();
      return changedW;
    }
    const target = opt.flatten ?? 0, src = tool === 'smooth' ? h.slice() : null;
    for (let j = Math.floor(cj - R) - 1; j <= Math.ceil(cj + R) + 1; j++) for (let i = Math.floor(ci - R) - 1; i <= Math.ceil(ci + R) + 1; i++) {
      if (i < 0 || j < 0 || i > N || j > N) continue;
      const d = Math.hypot(i - ci, j - cj); if (d > R) continue;
      const fall = 0.5 + 0.5 * Math.cos(Math.PI * d / R), k = vi(i, j), amt = strength * dt * fall;
      if (tool === 'raise') h[k] = Math.min(80, h[k] + amt * 8);
      else if (tool === 'lower') h[k] = Math.max(-20, h[k] - amt * 8);
      else if (tool === 'flatten') h[k] += (target - h[k]) * Math.min(1, amt * 3);
      else if (tool === 'smooth') {
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a <= N && b <= N) { s += src[vi(a, b)]; n++; } }
        h[k] += (s / n - h[k]) * Math.min(1, amt * 3);
      }
      changedH = true;
    }
    if (changedH) refreshGround();
    return changedH;
  }

  function getData() {
    const hi = new Int16Array(h.length); for (let k = 0; k < h.length; k++) hi[k] = Math.round(h[k] * 20);
    const wi = new Int16Array(water.length); for (let k = 0; k < water.length; k++) wi[k] = Number.isNaN(water[k]) ? -32768 : Math.round(water[k] * 20);
    const flat = hi.every(x => x === 0), dry = wi.every(x => x === -32768);
    return flat && dry ? null : { n: N, heights: flat ? null : b64.enc(hi), water: dry ? null : b64.enc(wi) };
  }
  function setData(d) {
    h = new Float32Array(V * V); water = new Float32Array(N * N).fill(NaN);
    if (d && d.n === N) {
      if (d.heights) { const a = b64.dec(d.heights, Int16Array); for (let k = 0; k < h.length && k < a.length; k++) h[k] = a[k] / 20; }
      if (d.water) { const a = b64.dec(d.water, Int16Array); for (let k = 0; k < water.length && k < a.length; k++) water[k] = a[k] === -32768 ? NaN : a[k] / 20; }
    }
    refreshGround(); refreshWater();
  }
  setData(null);

  // brush outline shown under the pointer while a tool is active
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffb02e, transparent: true, opacity: 0.85, depthTest: false }));
  ring.renderOrder = 10; ring.visible = false; scene.add(ring);
  function showRing(x, z, radiusTiles) {
    if (x == null) { ring.visible = false; return; }
    ring.visible = true; ring.scale.setScalar(radiusTiles * TILE); ring.position.set(x, heightAt(x, z) + 0.3, z);
  }

  // ground look: tex = a THREE.Texture of the game's ground (repeating every 2 tiles) or null for plain night grass
  // with tile lines; gridLines draws tile lines over a textured ground
  function setGround(tex, gridLines) {
    textured = !!tex;
    if (tex) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(N / 2, N / 2); tex.anisotropy = 8; tex.colorSpace = THREE.SRGBColorSpace; }
    groundMat.map = tex || gridTex; groundMat.needsUpdate = true;
    // the ground beyond the landscape: the same texture (no seam at the edge), or plain dark grass
    if (tex) { const o = tex.clone(); o.repeat.set(500, 500); o.needsUpdate = true; outerMat.map = o; outerMat.color.setScalar(0.9); }
    else { outerMat.map = null; outerMat.color.set(0x0a130d); }
    outerMat.needsUpdate = true;
    lines.visible = !!tex && gridLines;
    // the plain ground's own tile lines follow the same switch
    c2.fillStyle = '#ffffff'; c2.fillRect(0, 0, 64, 64);
    if (gridLines) { c2.strokeStyle = 'rgba(0,0,0,0.28)'; c2.strokeRect(0, 0, 64, 64); }
    gridTex.needsUpdate = true;
    refreshGround();
  }

  // where a ray meets the ground, worked out from the height grid (much cheaper than testing the 20,000-triangle mesh,
  // which made dragging things over the view lag): march along the ray, then halve the last step a few times
  function raycast(ray) {
    const o = ray.origin, d = ray.direction, above = t => o.y + d.y * t - heightAt(o.x + d.x * t, o.z + d.z * t);
    // the stretch of the ray over the landscape square
    let t0 = 0, t1 = 3000;
    for (const [p, v] of [[o.x, d.x], [o.z, d.z]]) {
      if (Math.abs(v) < 1e-9) { if (p < -HALF || p > HALF) { t1 = -1; break; } continue; }
      let a = (-HALF - p) / v, b = (HALF - p) / v; if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    }
    if (t1 > t0 && above(t0) > 0) {
      let prev = t0;
      for (let t = t0 + 1; t <= t1 + 1; t += 1) {
        if (above(Math.min(t, t1)) <= 0) {
          let lo = prev, hi = Math.min(t, t1);
          for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (above(m) > 0) lo = m; else hi = m; }
          return new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
        }
        prev = t;
      }
    }
    if (d.y < -1e-6) { const t = -o.y / d.y; if (t > 0 && t < 3000) return new THREE.Vector3(o.x + d.x * t, 0, o.z + d.z * t); }   // the flat ground beyond
    return null;
  }

  return { ground, heightAt, raycast, setGround, waterAt, brush, getData, setData, mirrorLevel, showRing, hasWater: () => mask.visible };
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
