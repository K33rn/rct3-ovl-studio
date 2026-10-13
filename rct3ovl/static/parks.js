// Parks: every campaign scenario and the sandbox (Campaigns\*.dat) in full 3D - terrain with the game's ground
// textures, water, paths, every placed scenery item, ride, stall and coaster track, guests and staff - with all the
// park's information beside it: goals for each difficulty, challenges, rides, shops, people, money, research.
// Opened full-window from the viewer's Parks tab; "Back" returns to the viewer.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { runTour, tourRunning } from './tour.js';

let ui = null;
export async function openParks({ onBack, open }) {
  if (!ui) ui = build();
  ui.onBack = onBack;
  ui.root.style.display = 'grid';
  ui.start();
  await ui.ready;
  if (open) ui.load(open);
  else if (!ui.current) ui.load(ui.parks[0]?.file);
  else history.replaceState(null, '', '#park=' + encodeURIComponent(ui.current));
  setTimeout(() => ui.tour(false), 1200);
}

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = c => {
  if (c == null || !isFinite(c)) return '–';
  const d = Math.abs(c) / 100, cents = Math.round(c) % 100 !== 0;
  return (c < 0 ? '−' : '') + '$' + d.toLocaleString(undefined, { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
};
const spaced = s => String(s ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
const hhmm = m => m == null ? '–' : `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const pct = f => f == null ? '–' : Math.round(f * 100) + '%';
const MONEY_KEYS = /Cash|Loan|Fee|Cost|Funds|Price|Profit|Income|Expend|Value|Sales|Stock|Wages|Tickets|Interest$|Construction|Purchase|Landscaping|Marketing|Research|Training|Other/;
const SKY = 0xa9c9e8;

function build() {
  const css = document.createElement('style');
  css.textContent = `
  #pk { position: fixed; inset: 0; z-index: 50; display: none; background: var(--bg); color: var(--text);
        grid-template-columns: var(--pkl, 260px) minmax(0, 1fr) var(--pkr, 410px); grid-template-rows: auto minmax(0, 1fr); }
  #pk .bar { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--panel2);
             border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  #pk .bar h2 { margin: 0 6px 0 4px; font-size: 15px; color: var(--accent); white-space: nowrap; }
  #pk .bar .ptitle { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 32ch; }
  #pk .bar .sep { width: 1px; align-self: stretch; background: var(--line); margin: 0 2px; }
  #pk .bar .grow { flex: 1; }
  #pk .back { border-color: var(--accent); color: var(--accent); }
  #pk .tog { display: flex; gap: 3px; flex-wrap: wrap; }
  #pk .tog button { padding: 3px 8px; font-size: 12px; opacity: .55; }
  #pk .tog button.on { opacity: 1; border-color: var(--accent); color: var(--accent); }
  #pk .side { background: var(--panel); display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  #pk .side.left { border-right: 1px solid var(--line); }
  #pk .side.right { border-left: 1px solid var(--line); }
  #pk .side .scroll { overflow: auto; flex: 1; min-height: 0; }
  #pk .search { margin: 10px 10px 6px; }
  #pk .search input { width: 100%; box-sizing: border-box; background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; }
  #pk .grp { padding: 10px 12px 3px; color: var(--accent); font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  #pk .pk { display: flex; gap: 8px; padding: 4px 12px; cursor: pointer; align-items: baseline; }
  #pk .pk:hover { background: var(--panel2); } #pk .pk.sel { background: var(--sel); }
  #pk .pk .n { color: var(--dim); font-size: 11px; min-width: 18px; text-align: right; font-variant-numeric: tabular-nums; }
  #pk .view { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: #a9c9e8; }
  #pk .view canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  #pk .load { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); background: #0a0d14d0; color: #fff; padding: 8px 14px;
              border-radius: 8px; font-size: 12px; min-width: 240px; text-align: center; pointer-events: none; transition: opacity .3s; }
  #pk .load .pb { height: 4px; background: #ffffff30; border-radius: 2px; margin-top: 6px; overflow: hidden; }
  #pk .load .pb i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .2s; }
  #pk .pick { position: absolute; background: #0a0d14e0; color: #fff; padding: 5px 9px; border-radius: 6px; font-size: 12px; pointer-events: none;
              transform: translate(-50%, calc(-100% - 10px)); white-space: nowrap; display: none; }
  #pk .help { position: absolute; left: 10px; bottom: 10px; background: #0a0d14b0; color: #dde; padding: 5px 9px; border-radius: 6px; font-size: 11px; pointer-events: none; }
  #pk .itabs { display: flex; flex-wrap: wrap; gap: 3px; padding: 8px 8px 6px; border-bottom: 1px solid var(--line); }
  #pk .itabs button { padding: 3px 8px; font-size: 12px; background: transparent; border-color: transparent; color: var(--dim); }
  #pk .itabs button.on { color: var(--accent); background: var(--sel); border-color: var(--accent); }
  #pk .ibody { padding: 10px 12px 20px; }
  #pk .ibody h3 { margin: 14px 0 6px; font-size: 12px; color: var(--accent); text-transform: uppercase; letter-spacing: .5px; }
  #pk .ibody h3:first-child { margin-top: 2px; }
  #pk .ibody p { margin: 0 0 8px; line-height: 1.45; }
  #pk .card { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 9px 11px; margin-bottom: 9px; }
  #pk .card h4 { margin: 0 0 6px; font-size: 14px; display: flex; align-items: center; gap: 8px; }
  #pk .card h4 .tag { font-size: 11px; font-weight: 500; color: var(--dim); margin-left: auto; }
  #pk .card.goal h4 { color: var(--accent); }
  #pk table.kv { width: 100%; border-collapse: collapse; font-size: 12px; }
  #pk table.kv td { padding: 3px 4px; border-top: 1px solid var(--line); vertical-align: top; }
  #pk table.kv tr:first-child td { border-top: 0; }
  #pk table.kv td:first-child { color: var(--dim); width: 45%; }
  #pk table.kv td.r { text-align: right; font-variant-numeric: tabular-nums; }
  #pk ul.cond { margin: 0; padding-left: 0; list-style: none; }
  #pk ul.cond li { padding: 5px 0; border-top: 1px solid var(--line); }
  #pk ul.cond li:first-child { border-top: 0; }
  #pk ul.cond b { color: var(--text); } #pk ul.cond .t { float: right; color: var(--accent); font-weight: 600; }
  #pk ul.cond small { display: block; color: var(--dim); }
  #pk .row { display: flex; justify-content: space-between; gap: 8px; padding: 5px 0; border-top: 1px solid var(--line); cursor: pointer; }
  #pk .row:first-child { border-top: 0; } #pk .row:hover { color: var(--accent); }
  #pk .row small { color: var(--dim); }
  #pk .rate { display: inline-flex; gap: 4px; font-size: 11px; }
  #pk .rate span { background: var(--panel2); border-radius: 4px; padding: 0 5px; }
  #pk .spark { width: 100%; height: 42px; display: block; }
  #pk .muted { color: var(--dim); }
  #pk .stat { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 10px; }
  #pk .stat div { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; }
  #pk .stat b { display: block; font-size: 15px; } #pk .stat small { color: var(--dim); font-size: 11px; }
  #pk .ifilter { width: 100%; box-sizing: border-box; margin-bottom: 8px; background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; }
  @media (max-width: 1100px) { #pk { --pkl: 200px; --pkr: 340px; } }
  `;
  document.head.appendChild(css);
  const root = document.createElement('div'); root.id = 'pk';
  root.innerHTML = `
    <div class="bar">
      <button class="back" id="pk-back" title="Back to the viewer (Esc)">◀ Back</button>
      <h2>Parks</h2><span class="ptitle" id="pk-title"></span>
      <span class="sep"></span>
      <div class="tog" id="pk-tog">
        <button data-l="scenery" class="on" title="Trees, buildings, walls, path extras and every other placed item">Scenery</button>
        <button data-l="rides" class="on" title="Coaster tracks, flat rides and stalls">Rides</button>
        <button data-l="paths" class="on" title="Footpaths and queues">Paths</button>
        <button data-l="water" class="on" title="Lakes, rivers and pools of water">Water</button>
        <button data-l="people" class="on" title="Guests, staff, ducks and the zoo animals">People</button>
        <button data-l="own" class="on" title="Shade land the park doesn't own (yellow: for sale)">Land</button>
        <button data-l="grid" title="Tile grid">Grid</button>
        <button data-l="anim" class="on" title="Play scenery and ride animations">Animate</button>
      </div>
      <span class="grow"></span>
      <button id="pk-home" title="Look at the whole park">⌂ Whole park</button>
      <button id="pk-gamecam" title="Where the park's own camera was when it was saved">🎥 Park camera</button>
      <button id="pk-tour" title="Walkthrough of the Parks tab">? Tour</button>
    </div>
    <div class="side left"><div class="search"><input id="pk-search" type="search" placeholder="Find a park"></div><div class="scroll" id="pk-list"></div></div>
    <div class="view" id="pk-view"><div class="load" id="pk-load">Loading…<div class="pb"><i></i></div></div><div class="pick" id="pk-pick"></div>
      <div class="help">Drag: turn · right-drag: move · wheel: zoom · arrows / WASD: move · click anything to name it</div></div>
    <div class="side right"><div class="itabs" id="pk-itabs"></div><div class="scroll"><div class="ibody" id="pk-ibody"></div></div></div>`;
  document.body.appendChild(root);

  // ---- 3D ------------------------------------------------------------------------------------------------------------
  const view = $('#pk-view', root);
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  view.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(SKY, 600, 1600);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 5000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.12; controls.maxPolarAngle = Math.PI * 0.495; controls.screenSpacePanning = false;
  controls.keyPanSpeed = 22; controls.listenToKeyEvents(window);
  scene.add(new THREE.HemisphereLight(0xdcecff, 0x55603a, 1.25));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.9); sun.position.set(-300, 500, 220); scene.add(sun);
  const gltf = new GLTFLoader();
  const layers = {};
  for (const k of ['terrain', 'water', 'paths', 'scenery', 'rides', 'people', 'grid']) { layers[k] = new THREE.Group(); scene.add(layers[k]); }
  let mixers = [], world = null, info = null, loadSeq = 0, terrainObj = null, rideSpots = {};
  const show = { scenery: true, rides: true, paths: true, water: true, people: true, own: true, grid: false, anim: true };

  function skyTexture() {
    const c = document.createElement('canvas'); c.width = 2; c.height = 256;
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#4f86c6'); gr.addColorStop(0.55, '#a9c9e8'); gr.addColorStop(1, '#dfe9f1');
    g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  // textures and models shared between items, kept from park to park; whatever a park didn't ask for is freed once
  // it has loaded (texUsed / modelUsed collect what this load asked for)
  const texCache = {}, texUsed = new Set(), modelUsed = new Set();
  function parkTex(name) {                         // any game texture by its full name (GroundQueueSet1:ftx)
    texUsed.add(name);
    if (!texCache[name]) {
      const t = new THREE.TextureLoader().load('/api/park_tex?name=' + encodeURIComponent(name));
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; texCache[name] = t;
    }
    return texCache[name];
  }
  function gameTex(name, repeat = true) {
    texUsed.add(name);
    if (!texCache[name]) {
      const t = new THREE.TextureLoader().load('/api/fw/tex?name=' + encodeURIComponent(name));
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      texCache[name] = t;
    }
    return texCache[name];
  }
  // free a mesh's GPU resources, except textures the caches still hold
  const cached = new Set();
  function disposeMesh(x) {
    x.geometry?.dispose(); if (x.isSkinnedMesh) x.skeleton?.dispose();
    for (const m of [x.material].flat()) {
      if (!m) continue;
      for (const v of Object.values(m)) if (v?.isTexture && !cached.has(v)) v.dispose();
      for (const t of m.userData.textures || []) t.dispose();
      m.dispose();
    }
  }
  function clear(group) {
    cached.clear(); Object.values(texCache).forEach(t => cached.add(t));
    for (const o of [...group.children]) {
      group.remove(o);
      o.traverse(x => { if (x.isMesh && !x.userData.shared) disposeMesh(x); });
    }
  }
  function evictUnused() {
    for (const [k, t] of Object.entries(texCache)) if (!texUsed.has(k)) { t.dispose(); delete texCache[k]; }
    for (const [k, pr] of Object.entries(modelCache)) if (!modelUsed.has(k)) {
      delete modelCache[k];
      pr.then(got => got?.g.scene.traverse(o => { if (o.isMesh) disposeMesh(o); }));
    }
  }
  function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(view);
  const clock = new THREE.Clock();
  let running = false;
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.1);
    if (show.anim) for (const m of mixers) m.update(dt);
    controls.update();
    renderer.render(scene, camera);
  }
  function start() { resize(); if (!running) { running = true; clock.getDelta(); loop(); } }
  function stop() { running = false; }

  // ---- the park's world ---------------------------------------------------------------------------------------------
  // The save is in RCT3's own (left-handed) space; the models come as glTF, which mirrors z (gltf.py). Everything built
  // here is mirrored the same way, z -> -z with triangles wound the other way round, so it all lines up.
  const Z = z => -z;
  const tileH = (i, k) => world.heights[i * 4 + k] / 100;
  function heightAt(x, zv) {                      // ground height under a (viewer-space) world point, bilinear on the tile
    const z = -zv, T = world.tile, fc = (x - world.x0) / T, fr = (z - world.z0) / T, c = Math.floor(fc), r = Math.floor(fr);
    if (c < 0 || r < 0 || c >= world.cols || r >= world.rows) return 0;
    const i = r * world.cols + c, u = fc - c, v = fr - r;
    return (tileH(i, 0) * (1 - u) + tileH(i, 1) * u) * (1 - v) + (tileH(i, 2) * (1 - u) + tileH(i, 3) * u) * v;
  }
  // a tile's two triangles: split along its flatter diagonal (corners 0 x0z0, 1 x1z0, 2 x0z1, 3 x1z1), wound to face
  // up once z is mirrored
  const tris = (h) => Math.abs(h[0] - h[3]) <= Math.abs(h[1] - h[2]) ? [[0, 3, 2], [0, 1, 3]] : [[0, 1, 2], [1, 3, 2]];
  function ownColour(o) {
    if (!show.own) return [1, 1, 1];
    if (o & 64) return [1.0, 0.92, 0.55];          // for sale
    if (o & 2) return [1, 1, 1];                   // owned
    if (o & 5) return [0.85, 0.9, 1.0];            // construction rights
    return [0.58, 0.6, 0.62];                      // not the park's
  }
  // The ground, as the game draws it: each tile has one texture (terrain_NN), blended into its neighbours' across the
  // tile (bilinear between tile centres, in the shader), with the game's grey detail texture over it (modulate x2).
  // Where neighbouring tiles' edges are at different heights the game builds a cliff wall, textured with the tile's
  // cliff style (TerrainCliffN).
  const imgData = name => new Promise(res => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0, 256, 256); res(g.getImageData(0, 0, 256, 256).data);
    };
    im.onerror = () => res(null);
    im.src = '/api/fw/tex?name=' + encodeURIComponent(name);
  });
  let detailTex = null;
  function terrainMaterial(used, layerData) {
    const W = world.cols, H = world.rows, idx = new Uint8Array(W * H);
    const layerOf = new Map(used.map((t, k) => [t, k]));
    for (let i = 0; i < W * H; i++) idx[i] = layerOf.get(world.tex[i]) ?? 0;
    const tiles = new THREE.DataTexture(idx, W, H, THREE.RedFormat, THREE.UnsignedByteType); tiles.needsUpdate = true;
    const arr = new Uint8Array(256 * 256 * 4 * used.length);
    layerData.forEach((d, k) => { if (d) arr.set(d, k * 256 * 256 * 4); });
    const layersTex = new THREE.DataArrayTexture(arr, 256, 256, used.length);
    Object.assign(layersTex, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.LinearMipmapLinearFilter,
                               magFilter: THREE.LinearFilter, generateMipmaps: true, colorSpace: THREE.SRGBColorSpace, anisotropy: 8 });
    layersTex.needsUpdate = true;
    if (!detailTex) detailTex = gameTex('terraindetail'), detailTex.colorSpace = THREE.NoColorSpace;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.userData.textures = [tiles, layersTex];
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { uTiles: { value: tiles }, uLayers: { value: layersTex }, uDetail: { value: detailTex },
                                   uGrid: { value: new THREE.Vector4(world.x0, world.z0, world.tile, 0) }, uSize: { value: new THREE.Vector2(W, H) } });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP, vWN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normal;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWP, vWN;
uniform sampler2D uTiles, uDetail;
uniform highp sampler2DArray uLayers;
uniform vec4 uGrid;
uniform vec2 uSize;
float tileLayer(vec2 t) { return floor(texelFetch(uTiles, ivec2(clamp(t, vec2(0.0), uSize - 1.0)), 0).r * 255.0 + 0.5); }
// steep ground takes its texture from the side, as in the game (no streaks down slopes)
vec4 groundTex(float l, vec3 w) {
  vec4 c = texture(uLayers, vec3(vWP.xz / 8.0, l)) * w.y;
  if (w.y < 0.999) c += texture(uLayers, vec3(vWP.zy / 8.0, l)) * w.x + texture(uLayers, vec3(vWP.xy / 8.0, l)) * w.z;
  return c;
}`)
        .replace('#include <map_fragment>', `
{
  vec2 g = vec2((vWP.x - uGrid.x) / uGrid.z, (-vWP.z - uGrid.y) / uGrid.z) - 0.5, i = floor(g), f = fract(g);
  f = f * f * (3.0 - 2.0 * f);
  vec3 w = pow(abs(normalize(vWN)), vec3(4.0)); w /= w.x + w.y + w.z;
  float a = tileLayer(i), b = tileLayer(i + vec2(1.0, 0.0)), c = tileLayer(i + vec2(0.0, 1.0)), d = tileLayer(i + vec2(1.0, 1.0));
  vec4 ta = groundTex(a, w);
  vec4 tb = b == a ? ta : groundTex(b, w);
  vec4 tc = c == a ? ta : groundTex(c, w);
  vec4 td = d == a ? ta : d == b ? tb : d == c ? tc : groundTex(d, w);
  vec4 col = mix(mix(ta, tb, f.x), mix(tc, td, f.x), f.y);
  // the game's detail texture (grey, modulate x2 in gamma space); its ground is lit brighter than the models, flat
  // ground coming out ~1.25x its texture (sand 174 -> 220, grass 124 -> 145 in screenshots)
  col.rgb *= pow(texture2D(uDetail, vWP.xz / 2.0).rgb * 2.0, vec3(2.2)) * 1.6;
  diffuseColor *= col;
}`);
    };
    return mat;
  }
  function buildTerrain() {
    clear(layers.terrain);
    const W = world.cols, H = world.rows, T = world.tile, X0 = world.x0, Z0 = world.z0, seq = loadSeq;
    // smooth normals from the corner heights (averaged where tiles meet)
    const G = new Float32Array((W + 1) * (H + 1)), N = new Float32Array((W + 1) * (H + 1));
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c;
      for (let k = 0; k < 4; k++) { const j = (r + (k >> 1)) * (W + 1) + c + (k & 1); G[j] += tileH(i, k); N[j]++; }
    }
    for (let j = 0; j < G.length; j++) G[j] /= N[j];
    const gh = (r, c) => G[Math.max(0, Math.min(H, r)) * (W + 1) + Math.max(0, Math.min(W, c))];
    const nrm = (r, c) => { const n = new THREE.Vector3(gh(r, c - 1) - gh(r, c + 1), 2 * T, gh(r + 1, c) - gh(r - 1, c)); return n.normalize(); };
    const p = [], n = [], col = [], corner = [[0, 0], [1, 0], [0, 1], [1, 1]];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c, h = [tileH(i, 0), tileH(i, 1), tileH(i, 2), tileH(i, 3)], oc = ownColour(world.own[i]);
      for (const tri of tris(h)) for (const k of tri) {
        p.push(X0 + (c + corner[k][0]) * T, h[k], Z(Z0 + (r + corner[k][1]) * T));
        const v = nrm(r + corner[k][1], c + corner[k][0]); n.push(v.x, v.y, v.z); col.push(...oc);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x8a8a70, vertexColors: true }));
    ground.userData.pick = { title: 'Ground' }; ground.userData.ground = true;
    layers.terrain.add(ground);
    const used = [...new Set(world.tex)].sort((a, b) => a - b);
    Promise.all(used.map(t => imgData('terrain_' + String(t).padStart(2, '0')))).then(data => {
      if (seq === loadSeq && ground.parent) ground.material = terrainMaterial(used, data);
    });
    buildCliffs();
    // the land around the park
    let lo = Infinity;
    for (let i = 0; i < W * H; i++) lo = Math.min(lo, tileH(i, 0));
    // the land around the park: sea when most of the map's edge is under water (island parks), else grass
    const wet = new Map(), edge = [];
    for (const b of world.water) for (let k = 0; k + 3 < b.tiles.length; k += 4) wet.set(b.tiles[k + 1] * W + b.tiles[k], b.h);
    for (let c = 0; c < W; c++) edge.push(c, (H - 1) * W + c);
    for (let r = 0; r < H; r++) edge.push(r * W, r * W + W - 1);
    const seaH = edge.map(i => wet.get(i)).filter(h => h != null);
    const sea = seaH.length > edge.length * 0.4;
    const out = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), sea
      ? new THREE.MeshPhongMaterial({ color: 0x2c6f9c, shininess: 80, specular: 0x6688aa })
      : new THREE.MeshLambertMaterial({ color: 0x5f7a45 }));
    out.rotation.x = -Math.PI / 2;
    out.position.set(X0 + W * T / 2, sea ? seaH.sort((a, b) => a - b)[seaH.length >> 1] - 0.02 : lo - 0.6, Z(Z0 + H * T / 2));
    if (sea) out.userData.pick = { title: 'Water', detail: 'the sea around the park' };
    layers.terrain.add(out);
    terrainObj = layers.terrain;
    buildGrid();
  }
  // cliff walls: along every tile edge whose two sides are at different heights, from the lower side up to the higher,
  // in the higher tile's cliff style
  function buildCliffs() {
    const W = world.cols, H = world.rows, T = world.tile, by = {};
    const wall = (style, ax, az, a0, a1, bx, bz, b0, b1) => {
      if (Math.max(Math.abs(a0 - a1), Math.abs(b0 - b1)) < 0.02) return;
      const g = (by[style] ??= { p: [], uv: [] }), along = (x, z) => (x + z) / 8;
      const A0 = [ax, Math.min(a0, a1), Z(az)], A1 = [ax, Math.max(a0, a1), Z(az)], B0 = [bx, Math.min(b0, b1), Z(bz)], B1 = [bx, Math.max(b0, b1), Z(bz)];
      g.p.push(...A0, ...B0, ...B1, ...A0, ...B1, ...A1);
      const ua = along(ax, az), ub = along(bx, bz);
      g.uv.push(ua, A0[1] / 8, ub, B0[1] / 8, ub, B1[1] / 8, ua, A0[1] / 8, ub, B1[1] / 8, ua, A1[1] / 8);
    };
    const style = (i, j) => { const hi = (tileH(i, 0) + tileH(i, 3)) >= (tileH(j, 0) + tileH(j, 3)) ? i : j; return world.cliff?.[hi] ?? 0; };
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c, x = world.x0 + c * T, z = world.z0 + r * T;
      if (c + 1 < W) wall(style(i, i + 1), x + T, z, tileH(i, 1), tileH(i + 1, 0), x + T, z + T, tileH(i, 3), tileH(i + 1, 2));
      if (r + 1 < H) wall(style(i, i + W), x, z + T, tileH(i, 2), tileH(i + W, 0), x + T, z + T, tileH(i, 3), tileH(i + W, 1));
    }
    for (const [s, g] of Object.entries(by)) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2)); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: gameTex('terraincliff' + s), side: THREE.DoubleSide }));
      m.userData.pick = { title: 'Cliff' };
      layers.terrain.add(m);
    }
  }
  function recolourTerrain() {
    // ownership shading follows the same vertex order as buildTerrain
    const ground = layers.terrain.children.find(m => m.userData.ground);
    if (!ground) return;
    const W = world.cols, H = world.rows, a = ground.geometry.getAttribute('color');
    for (let i = 0; i < W * H; i++) { const oc = ownColour(world.own[i]); for (let k = 0; k < 6; k++) a.array.set(oc, (i * 6 + k) * 3); }
    a.needsUpdate = true;
  }
  function buildGrid() {
    clear(layers.grid);
    const W = world.cols, H = world.rows, T = world.tile, p = [], corner = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const at = (r, c, k) => [world.x0 + (c + corner[k][0]) * T, tileH(r * W + c, k) + 0.05, Z(world.z0 + (r + corner[k][1]) * T)];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      p.push(...at(r, c, 0), ...at(r, c, 1), ...at(r, c, 0), ...at(r, c, 2));
      if (r === H - 1) p.push(...at(r, c, 2), ...at(r, c, 3));
      if (c === W - 1) p.push(...at(r, c, 1), ...at(r, c, 3));
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    layers.grid.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 })));
    layers.grid.visible = show.grid;
  }
  function buildWater() {
    clear(layers.water);
    const W = world.cols, T = world.tile;
    const mat = new THREE.MeshPhongMaterial({ color: 0x2f7fb0, transparent: true, opacity: 0.78, shininess: 90, specular: 0x88aacc, depthWrite: false });
    for (const b of world.water) {
      const p = [];
      for (let k = 0; k + 3 < b.tiles.length; k += 4) {
        const c = b.tiles[k], r = b.tiles[k + 1], half = b.tiles[k + 2], i = r * W + c;
        if (c >= world.cols || r >= world.rows) continue;
        const h = [tileH(i, 0), tileH(i, 1), tileH(i, 2), tileH(i, 3)], tri = tris(h)[half & 1];
        const corner = [[0, 0], [1, 0], [0, 1], [1, 1]];
        for (const q of tri) p.push(world.x0 + (c + corner[q][0]) * T, b.h, Z(world.z0 + (r + corner[q][1]) * T));
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat); m.renderOrder = 2; m.userData.pick = { title: 'Water', detail: `surface at ${b.h.toFixed(1)} m` };
      layers.water.add(m);
    }
  }
  function buildPaths() {
    clear(layers.paths);
    const W = world.cols, T = world.tile, by = {};
    for (const [c, r, s, raisedH, , , qs, qe] of world.paths) {
      if (raisedH !== -9999 || c >= world.cols || r >= world.rows) continue;     // raised queues: their own models
      (by[s] ??= []).push([c, r, qs, qe]);
    }
    for (const [s, tiles] of Object.entries(by)) {
      const style = world.path_styles[s] || '', queue = style.startsWith('queue:'), texName = (world.path_tex || {})[style];
      const pq = (world.path_quarter || {})[style] || [0, 0];
      const p = [], uv = [];
      for (const [c, r, qs, qe] of tiles) {
        const i = r * W + c, h = [tileH(i, 0), tileH(i, 1), tileH(i, 2), tileH(i, 3)], corner = [[0, 0], [1, 0], [0, 1], [1, 1]];
        // paths: the atlas's solid quarter (top left). Queues: the straight piece (bottom left), its stripes along the
        // queue: edges 0/1 (-col/+col) open -> runs along x, else along z
        const alongX = queue && (qs === 0 || qs === 1 || qe === 0 || qe === 1) && !(qs >= 2 && qs <= 3 && qe >= 2 && qe <= 3);
        for (const tri of tris(h)) for (const k of tri) {
          p.push(world.x0 + (c + corner[k][0]) * T, h[k] + 0.07, Z(world.z0 + (r + corner[k][1]) * T));
          const [a, b] = alongX ? [corner[k][1], corner[k][0]] : corner[k];
          if (queue) uv.push(0.01 + 0.48 * a, 0.01 + 0.48 * b);
          else uv.push(0.01 + 0.48 * a + 0.5 * pq[0], 0.51 + 0.48 * b - 0.5 * pq[1]);   // the style's plain-paving quarter
        }
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.computeVertexNormals();
      const map = !texName ? null : queue ? parkTex(texName) : gameTex('path_' + style.toLowerCase() + '_grounda');
      const mat = map ? new THREE.MeshLambertMaterial({ map, polygonOffset: true, polygonOffsetFactor: -2 })
        : new THREE.MeshLambertMaterial({ color: queue ? 0xb59a6a : 0x9a9488, polygonOffset: true, polygonOffsetFactor: -2 });
      const m = new THREE.Mesh(geo, mat);
      m.userData.pick = { title: queue ? 'Queue' : `${spaced(style)} path`, detail: queue ? spaced(style.slice(6)) : '' };
      layers.paths.add(m);
      const rail = queue && (world.queue_rails || {})[style];
      if (queue && style.slice(6).toLowerCase() === 'queueset1') buildPostRails(tiles, style);
      else if (rail) buildRails(tiles, rail, style);
    }
  }
  // the standard queue's railing, as the game draws it (it has no model for it): thin dark posts every 2 m along every
  // edge a queue tile doesn't open on, two grey handrails between them following the ground
  function buildPostRails(tiles, style) {
    const W = world.cols, T = world.tile, inset = 0.12, STEP = 2, HEIGHTS = [0.5, 0.95];
    const EDGE = [[0, 2], [1, 3], [0, 1], [2, 3]], corner = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const posts = new Map(), rails = [];
    for (const [c, r, qs, qe] of tiles) {
      const i = r * W + c, h = [tileH(i, 0), tileH(i, 1), tileH(i, 2), tileH(i, 3)];
      for (let e = 0; e < 4; e++) {
        if (e === qs || e === qe) continue;
        const ix = e === 0 ? inset : e === 1 ? -inset : 0, iz = e === 2 ? inset : e === 3 ? -inset : 0;
        const pt = k => new THREE.Vector3(world.x0 + (c + corner[k][0]) * T + ix, h[k] + 0.07, Z(world.z0 + (r + corner[k][1]) * T + iz));
        const [a, b] = EDGE[e].map(pt), n = Math.max(1, Math.round(T / STEP));
        for (let k = 0; k <= n; k++) {
          const q = a.clone().lerp(b, k / n);
          posts.set(`${q.x.toFixed(2)},${q.z.toFixed(2)}`, q);   // corners shared by neighbouring edges: one post
        }
        for (const y of HEIGHTS) rails.push([a.clone().setY(a.y + y), b.clone().setY(b.y + y)]);
      }
    }
    if (!posts.size) return;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
    const postGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6); postGeo.translate(0, 0.5, 0);
    const pm = new THREE.InstancedMesh(postGeo, new THREE.MeshLambertMaterial({ color: 0x2b2b2e }), posts.size);
    [...posts.values()].forEach((p, j) => pm.setMatrixAt(j, m4.makeTranslation(p.x, p.y, p.z)));
    const rm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.045, 0.045), new THREE.MeshLambertMaterial({ color: 0x9c9fa3 }), rails.length);
    rails.forEach(([a, b], j) => {
      const d = b.clone().sub(a);
      rm.setMatrixAt(j, m4.compose(a.clone().add(b).multiplyScalar(0.5), q.setFromUnitVectors(X, d.clone().normalize()), s.set(d.length(), 1, 1)));
    });
    for (const m of [pm, rm]) {
      m.computeBoundingSphere();
      m.userData.pick = { title: 'Queue railing', detail: spaced(style.slice(6)) };
      layers.paths.add(m);
    }
  }
  // queue railings: a 1 m panel along every edge a queue tile doesn't open on (edges 0 -col, 1 +col, 2 -row,
  // 3 +row), textured with the railing part of the queue type's raised texture
  function buildRails(tiles, [texName, [px0, py0, px1, py1]], style) {
    const W = world.cols, T = world.tile, p = [], uv = [], H = 1.0, inset = 0.12;
    const EDGE = [[0, 2], [1, 3], [0, 1], [2, 3]], corner = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const u0 = px0 / 256, u1 = px1 / 256, vt = 1 - py0 / 256, vb = 1 - py1 / 256;
    for (const [c, r, qs, qe] of tiles) {
      const i = r * W + c, h = [tileH(i, 0), tileH(i, 1), tileH(i, 2), tileH(i, 3)];
      for (let e = 0; e < 4; e++) {
        if (e === qs || e === qe) continue;
        const pt = k => {
          const cx = corner[k][0], cz = corner[k][1];
          // pulled a little into the tile
          const ix = e === 0 ? inset : e === 1 ? -inset : 0, iz = e === 2 ? inset : e === 3 ? -inset : 0;
          return [world.x0 + (c + cx) * T + ix, h[k] + 0.07, Z(world.z0 + (r + cz) * T + iz)];
        };
        const [a, b] = EDGE[e].map(pt);
        p.push(...a, ...b, b[0], b[1] + H, b[2], ...a, b[0], b[1] + H, b[2], a[0], a[1] + H, a[2]);
        uv.push(u0, vb, u1, vb, u1, vt, u0, vb, u1, vt, u0, vt);
      }
    }
    if (!p.length) return;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: parkTex(texName), side: THREE.DoubleSide, alphaTest: 0.5 }));
    m.userData.pick = { title: 'Queue railing', detail: spaced(style.slice(6)) };
    layers.paths.add(m);
  }
  // people: simple figures (the park's guests where they stood when it was saved)
  function buildPeople() {
    clear(layers.people);
    const pal = [0xe8463c, 0x2f7de1, 0xf2c53d, 0x3cb371, 0xb05cd6, 0xff8c2b, 0xf0f0f0, 0x23b5b5];
    const body = new THREE.CapsuleGeometry(0.22, 1.05, 3, 8); body.translate(0, 0.75, 0);
    const duck = new THREE.SphereGeometry(0.22, 10, 8); duck.scale(1.4, 0.8, 1); duck.translate(0, 0.15, 0);
    // stand-ins until the person models arrive (buildPersonModels), and for anyone without part groups
    const stand = p => p[5] == null || p[5] < 0;
    const kinds = { guest: world.people.filter(p => p[0] === 'guest'), staff: world.people.filter(p => p[0] === 'staff'), duck: world.people.filter(p => p[0] === 'duck') };
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    for (const [k, list] of Object.entries(kinds)) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(k === 'duck' ? duck : body, new THREE.MeshLambertMaterial(), list.length);
      list.forEach((p, j) => {
        m4.makeRotationY(-p[4]).setPosition(p[1], p[2], Z(p[3])); im.setMatrixAt(j, m4);
        im.setColorAt(j, col.setHex(k === 'staff' ? 0x1e4fb8 : k === 'duck' ? 0xf4f1e6 : pal[j % pal.length]));
      });
      im.computeBoundingSphere();
      im.userData.pick = { title: k === 'guest' ? 'Guest' : k === 'staff' ? 'Staff member' : 'Duck' };
      if (k !== 'duck') im.userData.standIns = true;
      layers.people.add(im);
    }
  }
  // each part's texture is a grid of colour variants: move the person's UVs to their own tile (upper clothing for the
  // body and its attachments, lower clothing for the legs, skin palette for the skin parts)
  const PERSON_LOD = 0;
  const dressTex = new Map();
  function dress(o, grids, p) {
    o.traverse(m => {
      if (!m.isMesh || !m.material?.map) return;
      const name = m.material.name || '', gr = grids[name];
      if (!gr) return;
      const [cols, rows, c0, r0] = gr, n = cols * rows;
      if (n <= 1) return;
      const pal = /^skin/i.test(name) ? p[9] : /^legs/i.test(name) ? p[8] : p[7];
      const v = (pal || 0) % n, c = v % cols, r = Math.floor(v / cols);
      const key = m.material.map.uuid + '|' + v;
      let t = dressTex.get(key);
      if (!t) { t = m.material.map.clone(); t.offset.set((c - c0) / cols, (r - r0) / rows); t.needsUpdate = true; dressTex.set(key, t); }
      m.material = m.material.clone(); m.material.map = t;
    });
  }
  // the guests and staff themselves: one model per combination of body, legs and head, walking or standing as they
  // were; the stand-in figures go once they're all in
  async function buildPersonModels(seq, progress) {
    const by = new Map();
    world.people.forEach(p => { if (p[5] != null && p[5] >= 0) { if (!by.has(p[5])) by.set(p[5], []); by.get(p[5]).push(p); } });
    const order = [...by.keys()].sort((a, b) => by.get(b).length - by.get(a).length);
    let done = 0;
    const group = new THREE.Group(); group.visible = false; layers.people.add(group);
    const work = async ci => {
      try {
        const r = await fetch(`/api/park_person?lod=${PERSON_LOD}&g=` + encodeURIComponent(world.person_combos[ci].join(',')));
        if (!r.ok || seq !== loadSeq) return;
        const grids = JSON.parse(r.headers.get('X-Info') || '{}').variants || {};
        const g = await gltf.parseAsync(await r.arrayBuffer(), '');
        if (seq !== loadSeq) return;
        const clip = n => g.animations.find(a => a.name.toLowerCase().startsWith(n));
        for (const p of by.get(ci)) {
          const o = cloneSkinned(g.scene);
          dress(o, grids, p);
          if (p[11]) {
            // riding: the seat's matrix (RCT3 row-vector 4x4 -> three's column form, then mirrored like everything else)
            const m = new THREE.Matrix4().fromArray(p[11]), S = new THREE.Matrix4().makeScale(1, 1, -1);
            o.matrixAutoUpdate = false; o.matrix.copy(S).multiply(m).multiply(S);
          } else { o.position.set(p[1], p[2], Z(p[3])); o.rotation.y = -p[4]; }
          o.userData.pick = { title: p[11] ? 'Guest (riding)' : p[0] === 'guest' ? 'Guest' : 'Staff member', detail: world.person_combos[ci].map(s => s.split('_')[0].toUpperCase()).join(' / ') };
          group.add(o);
          // riders: their ride's pose, else any seated ride pose the model has (never standing in a seat)
          const a = (p[10] ? (clip(p[10].toLowerCase()) || clip('ridesit') || clip('ride')) : p[6] ? clip('walk') : clip('idle')) || g.animations[0];
          if (a) { const mx = new THREE.AnimationMixer(o), act = mx.clipAction(a); act.play(); act.time = Math.random() * a.duration; mixers.push(mx); }
        }
      } catch (e) {} finally { done++; progress(done, order.length); }
    };
    const queue = [...order];
    await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length && seq === loadSeq) await work(queue.shift()); }));
    if (seq !== loadSeq) return;
    layers.people.children.filter(o => o.userData.standIns).forEach(o => layers.people.remove(o));
    group.visible = true;
  }
  // ride cars where the trains stood when the park was saved
  async function buildCars(seq) {
    const by = {};
    for (const c of world.cars || []) (by[c[0]] ??= []).push(c);
    for (const [mi, list] of Object.entries(by)) {
      const [rit, overlay, slot, part, col] = world.car_models[mi];
      try {
        const r = await fetch(`/api/park_car?rit=${encodeURIComponent(rit)}&overlay=${encodeURIComponent(overlay)}&slot=${slot}&part=${part || 'main'}${col ? '&col=' + col.join(',') : ''}`);
        if (!r.ok || seq !== loadSeq) continue;
        const g = await gltf.parseAsync(await r.arrayBuffer(), '');
        if (seq !== loadSeq) return;
        for (const c of list) {
          const o = cloneSkinned(g.scene);
          o.position.set(c[1], c[2], Z(c[3])); o.rotation.set(-c[4], -c[5], c[6], 'YXZ');
          if (c[7]) o.position.add(new THREE.Vector3(0, -c[7], 0).applyEuler(o.rotation));   // a swinging car hangs Length below its pivot
          o.userData.pick = { title: spaced(rit.split(':')[0]) + ' car' };
          layers.rides.add(o);
        }
      } catch (e) {}
    }
  }
  // coaster supports, built from the ride's own support style pieces (/api/park_supports: [sid, x, y, z, yaw])
  async function addSupports(list, name, seq, col) {
    const by = new Map();
    for (const s of list || []) { if (!by.has(s[0])) by.set(s[0], []); by.get(s[0]).push(s); }
    for (const [sid, parts] of by) {
      const got = await sidModel({ name: sid, overlay: '', col });   // in the ride's colours
      if (!got || seq !== loadSeq) continue;
      const mats = parts.map(([, x, y, z, yaw]) => new THREE.Matrix4().makeRotationY(-yaw).setPosition(x, y, Z(z)));
      got.g.scene.traverse(o => {
        if (!o.isMesh) return;
        const im = new THREE.InstancedMesh(o.geometry, o.material, mats.length), tmp = new THREE.Matrix4();
        mats.forEach((m, k) => im.setMatrixAt(k, tmp.multiplyMatrices(m, o.matrixWorld)));
        im.computeBoundingSphere(); im.userData.pick = { title: name, detail: 'supports' }; im.userData.shared = true;
        layers.rides.add(im);
      });
    }
  }
  // Wild! animals: the species' model standing where the animal was, playing its standing animation
  async function buildAnimals(seq) {
    const by = {};
    for (const a of world.animals || []) (by[a[0]] ??= []).push(a);
    for (const [mdl, list] of Object.entries(by)) {
      try {
        const r = await fetch('/api/park_animal?mdl=' + encodeURIComponent(mdl));
        if (!r.ok || seq !== loadSeq) continue;
        const g = await gltf.parseAsync(await r.arrayBuffer(), '');
        if (seq !== loadSeq) return;
        for (const a of list) {
          const o = cloneSkinned(g.scene);
          o.position.set(a[1], a[2], Z(a[3])); o.rotation.y = -a[4];
          o.userData.pick = { title: spaced(a[5]).replace(/^./, c => c.toUpperCase()), detail: a[6] ? 'adult' : 'young' };
          layers.people.add(o);
          if (g.animations.length) { const mx = new THREE.AnimationMixer(o), act = mx.clipAction(g.animations[0]); act.play(); act.time = Math.random() * g.animations[0].duration; mixers.push(mx); }
        }
      } catch (e) {}
    }
  }
  // placed items: one model per sid, instanced; animated ones cloned so each plays its animation
  const modelCache = {};
  function sidModel(s) {
    const col = s.col ? s.col.join(',') : '';            // the object's own three colours (recolourable textures)
    const key = s.name + '|' + s.overlay + '|' + col;
    modelUsed.add(key);
    if (!modelCache[key]) modelCache[key] = fetch(`/api/park_model?sid=${encodeURIComponent(s.name)}&overlay=${encodeURIComponent(s.overlay)}${col ? '&col=' + col : ''}`).then(async r => {
      if (!r.ok) return null;
      const meta = JSON.parse(r.headers.get('X-Info') || '{}');
      const g = await gltf.parseAsync(await r.arrayBuffer(), '');
      g.scene.updateMatrixWorld(true);
      g.scene.traverse(o => { if (o.isMesh) o.userData.shared = true; });
      return { g, meta };
    }).catch(() => null);
    return modelCache[key];
  }
  // Placement: tile centre, turned by DIRECTION (0 faces the tile's -column edge, 1 +row, 2 +column, 3 -row; the
  // models have their edge side at +x). Quarter-tile items go to their CORNER; edge items (walls, benches, lamps) out
  // to the edge they face. Bigger items (flat rides, shops) cover squares[0] columns x squares[1] rows (swapped at
  // directions 1 and 3) from the stored tile towards +column / +row, and stand in the middle of that.
  const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const EDGE = { 'wall': 2.0, 'path edge outer': 1.85, 'path edge join': 1.85, 'path edge inner': 1.35, 'half tile': 1.0 };
  const ROT = { off: 2, sign: -1 };       // the same turn as track pieces: checked on raised path slopes (they rise towards -x)
  function itemMatrix(it, meta) {
    const [, c, r, y, dir, corner] = it, T = world.tile;
    let x = world.x0 + c * T + T / 2, z = world.z0 + r * T + T / 2;
    const sq = meta.squares || [1, 1];
    if (sq[0] > 1 || sq[1] > 1) {
      const [w, h] = dir & 1 ? [sq[1], sq[0]] : sq;
      x += (w - 1) * T / 2; z += (h - 1) * T / 2;
    }
    if (meta.size === 'quarter tile' && corner >= 0) { x += CORNERS[corner & 3][0]; z += CORNERS[corner & 3][1]; }
    const a = ROT.sign * ((dir + ROT.off) % 4) * Math.PI / 2, d = EDGE[meta.size] || 0;
    const m = new THREE.Matrix4().makeRotationY(a);
    m.setPosition(x + d * Math.cos(a), y, Z(z) - d * Math.sin(a));
    return m;
  }
  async function buildItems(seq, progress) {
    clear(layers.scenery); clear(layers.rides);
    const by = new Map();
    world.items.forEach(it => { if (!by.has(it[0])) by.set(it[0], []); by.get(it[0]).push(it); });
    const order = [...by.keys()].sort((a, b) => by.get(b).length - by.get(a).length);
    let done = 0;
    const work = async sidIdx => {
      const s = world.sids[sidIdx], items = by.get(sidIdx);
      const got = await sidModel(s);
      if (seq !== loadSeq) return;
      done++; progress(done, order.length);
      if (!got) return;
      const { g, meta } = got;
      const kind = items[0][6], group = kind === 3 || kind === 2 ? layers.rides : layers.scenery;
      const pick = { title: spaced(s.name), detail: s.overlay ? s.overlay.replace(/\\style$/i, '').replace(/^style\\/i, '').replace(/\\/g, ' / ') : '' };
      const animated = g.animations.length > 0;
      let skinned = false; g.scene.traverse(o => { if (o.isSkinnedMesh) skinned = true; });
      if (animated || skinned) {
        for (const it of items) {
          const o = cloneSkinned(g.scene); o.applyMatrix4(itemMatrix(it, meta)); o.userData.pick = pick; o.userData.item = it;
          group.add(o);
          if (animated) {
            const mx = new THREE.AnimationMixer(o), a = mx.clipAction(g.animations[0]);
            a.play(); a.time = Math.random() * g.animations[0].duration; mixers.push(mx);
          }
          if (it[7] >= 0) rideSpots[it[7]] = o.getWorldPosition(new THREE.Vector3());
        }
        return;
      }
      const mats = items.map(it => itemMatrix(it, meta));
      g.scene.traverse(o => {
        if (!o.isMesh) return;
        const im = new THREE.InstancedMesh(o.geometry, o.material, mats.length);
        const tmp = new THREE.Matrix4();
        mats.forEach((m, k) => im.setMatrixAt(k, tmp.multiplyMatrices(m, o.matrixWorld)));
        im.computeBoundingSphere(); im.userData.pick = pick; im.userData.items = items; im.userData.shared = true;
        group.add(im);
      });
      items.forEach((it, k) => { if (it[7] >= 0) rideSpots[it[7]] = new THREE.Vector3().setFromMatrixPosition(mats[k]); });
    };
    const queue = [...order];
    await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length && seq === loadSeq) await work(queue.shift()); }));
  }
  // path supports don't go down through a ride's track: drop the columns whose way to the ground is blocked by one
  let trackScenes = [];
  function clearOfTracks(list) {
    if (!trackScenes.length) return list;
    const cols = new Map();
    for (const s of list) { const k = s[1] + ',' + s[3]; if (!cols.has(k)) cols.set(k, []); cols.get(k).push(s); }
    const ray = new THREE.Raycaster(), out = [];
    for (const parts of cols.values()) {
      const [, x, , z] = parts[0], top = Math.max(...parts.map(p => p[2])) + 1, bottom = Math.min(...parts.map(p => p[2]));
      ray.set(new THREE.Vector3(x, top, Z(z)), new THREE.Vector3(0, -1, 0)); ray.far = top - bottom;
      if (!ray.intersectObjects(trackScenes, true).length) out.push(...parts);
    }
    return out;
  }
  async function buildTracks(seq) {
    trackScenes = [];
    for (const tr of world.tracks) {
      if (seq !== loadSeq) return;
      try {
        const r = await fetch(`/api/park_track?file=${encodeURIComponent(world.file)}&id=${tr.id}`);
        if (!r.ok) continue;
        const meta = JSON.parse(r.headers.get('X-Info') || '{}');
        const g = await gltf.parseAsync(await r.arrayBuffer(), '');
        if (seq !== loadSeq) return;
        g.scene.userData.pick = { title: tr.name, detail: 'coaster / tracked ride' };
        layers.rides.add(g.scene); trackScenes.push(g.scene);
        const box = new THREE.Box3().setFromObject(g.scene); rideSpots[tr.id] = box.getCenter(new THREE.Vector3());
        const sr = await fetch(`/api/park_supports?file=${encodeURIComponent(world.file)}&id=${tr.id}`);
        if (sr.ok) await addSupports(await sr.json(), tr.name, seq, meta.col);
      } catch (e) {}
    }
  }
  function parkBox() {                             // the owned land (else the whole map)
    let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity;
    for (let r = 0; r < world.rows; r++) for (let c = 0; c < world.cols; c++) if (world.own[r * world.cols + c] & 2) {
      c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
    }
    if (c0 === Infinity) { c0 = 0; c1 = world.cols - 1; r0 = 0; r1 = world.rows - 1; }
    const T = world.tile;
    return { x: world.x0 + (c0 + c1 + 1) / 2 * T, z: Z(world.z0 + (r0 + r1 + 1) / 2 * T), w: (c1 - c0 + 1) * T, d: (r1 - r0 + 1) * T };
  }
  function home() {
    const b = parkBox(), R = Math.max(b.w, b.d), y = heightAt(b.x, b.z);
    controls.target.set(b.x, y, b.z);
    camera.position.set(b.x - R * 0.45, y + R * 0.62, b.z + R * 0.78);
    camera.far = Math.max(2000, R * 6); camera.updateProjectionMatrix();
    scene.fog.near = R * 1.4; scene.fog.far = R * 4;
  }
  function flyTo(p, dist = 60) {
    const dir = camera.position.clone().sub(controls.target).normalize();
    controls.target.copy(p); camera.position.copy(p).addScaledVector(dir, dist);
  }

  // ---- park list --------------------------------------------------------------------------------------------------
  const list = $('#pk-list', root);
  let parks = [], current = null;
  const ready = fetch('/api/parks').then(r => r.json()).then(l => { parks = l; ui.parks = l; renderList(); });
  function renderList() {
    const f = $('#pk-search', root).value.toLowerCase();
    let html = '', grp = '';
    for (const p of parks) {
      if (f && !(p.title + ' ' + p.group + ' ' + p.file).toLowerCase().includes(f)) continue;
      if (p.group !== grp) { grp = p.group; html += `<div class="grp">${esc(grp === 'RollerCoaster Tycoon 3' ? 'Campaign' : grp + (grp === 'Sandbox' ? '' : ' campaign'))}</div>`; }
      html += `<div class="pk${p.file === current ? ' sel' : ''}" data-f="${esc(p.file)}" title="${esc(p.file)}"><span class="n">${p.number ?? ''}</span><span>${esc(p.title.trim())}</span></div>`;
    }
    list.innerHTML = html || '<div class="muted" style="padding:12px">No park matches</div>';
  }
  $('#pk-search', root).oninput = renderList;
  list.onclick = e => { const d = e.target.closest('.pk'); if (d) load(d.dataset.f); };

  // ---- loading a park ---------------------------------------------------------------------------------------------
  const loadEl = $('#pk-load', root), bar = $('.pb i', loadEl);
  function status(t, frac) {
    if (t == null) { loadEl.style.opacity = 0; return; }
    loadEl.style.opacity = 1; loadEl.firstChild.textContent = t; bar.style.width = ((frac ?? 0) * 100) + '%';
  }
  async function load(file) {
    if (!file) return;
    const seq = ++loadSeq; current = file; ui.current = file; renderList();
    list.querySelector('.pk.sel')?.scrollIntoView({ block: 'nearest' });
    history.replaceState(null, '', '#park=' + encodeURIComponent(file));
    status('Reading the park…', 0.02);
    for (const m of mixers) m.stopAllAction(); mixers = []; rideSpots = {};
    texUsed.clear(); modelUsed.clear(); dressTex.clear();
    let d;
    try { d = await (await fetch('/api/park?file=' + encodeURIComponent(file))).json(); } catch (e) { d = { error: String(e) }; }
    if (seq !== loadSeq) return;
    if (d.error) { status('Could not read this park: ' + d.error, 0); return; }
    world = d.world; world.file = file; info = d.info;
    $('#pk-title', root).textContent = info.title;
    renderInfo();
    status('Building the landscape…', 0.08);
    await new Promise(r => setTimeout(r, 20));
    buildTerrain(); buildWater(); buildPaths(); buildPeople(); home();
    applyLayers();
    status(`Placing ${world.items.length.toLocaleString()} items…`, 0.1);
    await Promise.all([
      buildItems(seq, (n, of) => status(`Loading models ${n} / ${of} (${world.items.length.toLocaleString()} items)…`, 0.1 + 0.6 * n / of)),
      buildTracks(seq), buildCars(seq), buildAnimals(seq)]);
    if (seq !== loadSeq) return;
    await addSupports(clearOfTracks(world.path_supports || []), 'Path', seq);
    if (seq !== loadSeq) return;
    const np = world.people.filter(p => p[5] >= 0).length;
    await buildPersonModels(seq, (n, of) => status(`Loading people ${n} / ${of} (${np.toLocaleString()} guests and staff)…`, 0.7 + 0.3 * n / of));
    if (seq !== loadSeq) return;
    evictUnused();
    status(null);
  }
  function applyLayers() {
    layers.scenery.visible = show.scenery; layers.rides.visible = show.rides; layers.paths.visible = show.paths;
    layers.water.visible = show.water; layers.people.visible = show.people; layers.grid.visible = show.grid;
  }
  $('#pk-tog', root).onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.dataset.l; show[k] = !show[k]; b.classList.toggle('on', show[k]);
    if (k === 'own' && world) recolourTerrain();
    applyLayers();
  };
  $('#pk-home', root).onclick = () => world && home();
  $('#pk-gamecam', root).onclick = () => {
    if (!world?.camera) return;
    const [x, y, z] = world.camera, b = parkBox();
    camera.position.set(x, y, Z(z));
    // the saved camera holds its position; look towards the middle of the park from there
    controls.target.set(b.x, heightAt(b.x, b.z), b.z);
  };
  $('#pk-back', root).onclick = () => { root.style.display = 'none'; stop(); ui.onBack?.(); };
  window.addEventListener('keydown', e => {
    if (root.style.display === 'none' || tourRunning()) return;
    if (e.key === 'Escape' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) $('#pk-back', root).click();
    // WASD as arrows
    const map = { w: 'ArrowUp', a: 'ArrowLeft', s: 'ArrowDown', d: 'ArrowRight' };
    if (map[e.key?.toLowerCase()] && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: map[e.key.toLowerCase()], code: map[e.key.toLowerCase()] }));
    }
  });

  // click: name what is under the pointer
  const ray = new THREE.Raycaster(), pickEl = $('#pk-pick', root);
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; pickEl.style.display = 'none'; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4 || !world) return;
    const rc = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - rc.left) / rc.width * 2 - 1, -(e.clientY - rc.top) / rc.height * 2 + 1), camera);
    const groups = ['people', 'rides', 'scenery', 'paths', 'water', 'terrain'].filter(k => layers[k].visible).map(k => layers[k]);
    const hit = ray.intersectObjects(groups, true)[0];
    if (!hit) return;
    let o = hit.object; while (o && !o.userData.pick) o = o.parent;
    const p = o?.userData.pick; if (!p) return;
    const T = world.tile, c = Math.floor((hit.point.x - world.x0) / T), r = Math.floor((Z(hit.point.z) - world.z0) / T);
    let extra = '';
    if (p.title === 'Ground' && c >= 0 && r >= 0 && c < world.cols && r < world.rows) {
      const own = world.own[r * world.cols + c];
      extra = own & 64 ? 'land for sale' : own & 2 ? 'park land' : own & 5 ? 'construction rights' : 'not the park\'s';
    }
    pickEl.innerHTML = `<b>${esc(p.title)}</b>${p.detail ? ' · ' + esc(p.detail) : ''}${extra ? ' · ' + extra : ''} <span style="opacity:.6">· tile ${c}, ${r} · ${hit.point.y.toFixed(1)} m</span>`;
    pickEl.style.left = (e.clientX - rc.left) + 'px'; pickEl.style.top = (e.clientY - rc.top) + 'px'; pickEl.style.display = 'block';
  });

  // ---- the information panel --------------------------------------------------------------------------------------
  const TABS = [['overview', 'Overview'], ['goals', 'Goals'], ['rides', 'Rides'], ['shops', 'Shops'], ['people', 'People'],
                ['money', 'Money'], ['research', 'Research'], ['scenery', 'Scenery'], ['data', 'Data']];
  let tab = 'overview';
  const itabs = $('#pk-itabs', root), ibody = $('#pk-ibody', root);
  itabs.innerHTML = TABS.map(([k, l]) => `<button data-t="${k}">${l}</button>`).join('');
  itabs.onclick = e => { const b = e.target.closest('button'); if (b) { tab = b.dataset.t; renderInfo(); } };
  const kv = rows => `<table class="kv">${rows.filter(Boolean).map(([a, b, r]) => `<tr><td>${a}</td><td${r ? ' class="r"' : ''}>${b}</td></tr>`).join('')}</table>`;
  const rate = r => r ? `<span class="rate"><span title="Excitement">E ${r[0].toFixed(2)}</span><span title="Intensity">I ${r[1].toFixed(2)}</span><span title="Nausea">N ${r[2].toFixed(2)}</span></span>` : '';
  function spark(vals, fmt = v => v) {
    if (!vals) return '';
    const v = vals.slice(); while (v.length && v[0] === 0) v.shift();
    if (v.length < 2) return '<div class="muted">no history</div>';
    const lo = Math.min(...v), hi = Math.max(...v), W = 300, H = 40, s = hi - lo || 1;
    const pts = v.map((x, i) => `${(i / (v.length - 1) * W).toFixed(1)},${(H - 3 - (x - lo) / s * (H - 6)).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>
      <div class="muted" style="display:flex;justify-content:space-between;font-size:11px"><span>low ${fmt(lo)}</span><span>now ${fmt(v.at(-1))}</span><span>high ${fmt(hi)}</span></div>`;
  }
  const condList = cs => cs.length ? `<ul class="cond">${cs.map(c => `<li><b>${esc(c.label)}</b>${c.target ? `<span class="t">${esc(c.target)}</span>` : ''}
      ${c.detail ? `<small>${esc(c.detail)}</small>` : ''}${c.held ? `<small>${esc(c.held)}</small>` : ''}</li>`).join('')}</ul>` : '<div class="muted">No goals</div>';
  function renderInfo() {
    itabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    if (!info) { ibody.innerHTML = '<div class="muted">Pick a park</div>'; return; }
    const I = info, P = I.park, M = I.money;
    let h = '';
    if (tab === 'overview') {
      const g = I.park_graphs, rating = g.ParkRating?.filter(x => x).at(-1);
      h += `<h3>${esc(I.group === 'Sandbox' ? 'Sandbox' : `${I.group === 'RollerCoaster Tycoon 3' ? 'Campaign' : I.group} · scenario ${I.number ?? '–'}`)}</h3>
        <p style="font-size:15px"><b>${esc(I.title)}</b></p>${I.description ? `<p>${esc(I.description)}</p>` : ''}
        <div class="stat"><div><b>${(I.guests ?? I.people.guests).toLocaleString()}</b><small>guests</small></div>
          <div><b>${rating != null ? Math.round(rating) : '–'}</b><small>park rating</small></div>
          <div><b>${money(M.Cash)}</b><small>cash</small></div>
          <div><b>${I.rides.length}</b><small>rides</small></div><div><b>${I.shops.length}</b><small>shops &amp; stalls</small></div>
          <div><b>${I.people.staff.length}</b><small>staff</small></div></div>
        ${kv([['Park name', esc(I.park_name || I.title)], ['Saved on', `year ${I.date.year ?? '–'}, month ${(I.date.month ?? 0) + 1}, ${hhmm(I.date.minutes)}`],
              ['Opening hours', `${hhmm(I.opening)} – ${hhmm(I.closing)}`], ['Entrance fee', money(M.EntranceFee)],
              ['Loan', `${money(M.Loan)} of ${money(M.MaxLoan)} (${(M.InterestRate ?? 0).toFixed(1)}%)`],
              ['Land', `${money(M.LandBuyCost)} per tile to buy · rights ${money(M.BuildRitesBuyCost)}`],
              ['Map', `${world.cols} × ${world.rows} tiles (${world.cols * 4} × ${world.rows * 4} m)`],
              ['Park land', `${world.own.filter(o => o & 2).length.toLocaleString()} tiles owned · ${world.own.filter(o => o & 64).length.toLocaleString()} for sale`],
              ['Weather', `${I.weather.Temperature != null ? I.weather.Temperature.toFixed(0) + ' °C' : ''} · wind ${I.weather.WindSpeed?.toFixed(1) ?? '–'}`],
              ['Guest intensity preference', P.GuestRideIntensityPreference != null ? P.GuestRideIntensityPreference.toFixed(2) : '–'],
              ['Starting happiness / hunger / thirst', [P.InitialGuestHappiness, P.InitialGuestHunger, P.InitialGuestThirst].map(pct).join(' / ')],
              P.ObjectiveText && ['Objective note', esc(P.ObjectiveText)]])}
        ${P.ParkRatingBreakdownText ? `<h3>Park rating</h3><div class="card" style="white-space:pre-line;font-size:12px">${esc(P.ParkRatingBreakdownText.trim())}</div>` : ''}
        <h3>Park rating history</h3>${spark(g.ParkRating, Math.round)}
        <h3>Guests in park</h3>${spark(g.GuestsInPark, Math.round)}`;
    } else if (tab === 'goals') {
      const any = I.goals.some(g => g.conditions.length);
      h += any ? I.goals.map(g => `<div class="card goal"><h4>${g.level}${g.prize ? `<span class="tag">prize #${g.prize}</span>` : ''}</h4>${condList(g.conditions)}</div>`).join('')
        : '<p class="muted">This park has no goals (sandbox: build freely).</p>';
      if (I.challenges.length) h += `<h3>Challenges</h3>` + I.challenges.map(c => `<div class="card"><h4>${esc(c.title)}</h4>${c.text ? `<p>${esc(c.text)}</p>` : ''}
          ${condList(c.conditions)}${c.completed ? `<p class="muted" style="margin-top:6px"><i>${esc(c.completed)}</i></p>` : ''}</div>`).join('');
    } else if (tab === 'rides') {
      h += I.rides.length ? `<p class="muted">Click a ride to fly to it.</p>` + I.rides.map(r => `<div class="card" data-ride="${r.id}" style="cursor:pointer"><h4>${esc(r.name)}<span class="tag">${esc(r.type_title)}</span></h4>
          ${rate(r.ratings)}${kv([['Kind', r.kind === 'tracked' ? 'Coaster / tracked ride' : r.kind === 'flat' ? 'Flat ride' : 'Special attraction'],
            ['Ticket price', money(r.price)], ['Guests carried', (r.total_guests ?? 0).toLocaleString()], ['Profit', money(r.total_profit)],
            ['Running cost', money(r.running_cost)], ['Popularity / satisfaction', `${r.popularity ?? '–'} / ${r.satisfaction ?? '–'}`],
            r.trains != null && ['Trains', `${r.trains} × ${r.cars_per_train} cars`], r.platform && ['Station', esc(r.platform)],
            r.music && ['Music', esc(r.music)]])}</div>`).join('') : '<p class="muted">No rides yet.</p>';
    } else if (tab === 'shops') {
      h += I.shops.length ? I.shops.map(s => `<div class="card" data-ride="${s.id}" style="cursor:pointer"><h4>${esc(s.name)}<span class="tag">${esc(s.type_title)}</span></h4>
          ${kv(s.items.map(it => [esc(it.name || '–'), `${money(it.price)} · ${(it.sold ?? 0).toLocaleString()} sold`]))}</div>`).join('') : '<p class="muted">No shops or stalls.</p>';
    } else if (tab === 'people') {
      const p = I.people, st = {};
      p.staff.forEach(s => st[s.type] = (st[s.type] || 0) + 1);
      h += `<div class="stat"><div><b>${p.guests}</b><small>guests</small></div><div><b>${pct(p.avg_happiness)}</b><small>avg happiness</small></div>
          <div><b>${money(p.avg_cash)}</b><small>avg cash</small></div></div>
        <h3>Staff</h3>${kv(Object.entries(st).map(([k, n]) => [k, n, true]))}
        ${p.staff.length ? `<div class="card" style="margin-top:8px">${p.staff.map(s => `<div class="row"><span>${esc(s.name)}</span><small>${esc(s.type)}</small></div>`).join('')}</div>` : ''}
        <h3>Guests</h3><input class="ifilter" id="pk-gf" placeholder="Find a guest">
        <div class="card" id="pk-glist">${p.guest_list.slice(0, 400).map(g => `<div class="row" title="Energy ${pct(g.energy)} · nausea ${pct(g.nausea)} · spent ${money(g.spent)}"><span>${esc(g.name)}</span><small>${pct(g.happiness)} happy · ${money(g.cash)} · ${g.rides ?? 0} rides</small></div>`).join('')}</div>`;
    } else if (tab === 'money') {
      const mk = Object.keys(M).sort();
      h += kv(mk.map(k => [spaced(k), MONEY_KEYS.test(k) && !/Rate|Flags/.test(k) ? money(M[k]) : (typeof M[k] === 'number' ? +M[k].toFixed(3) : M[k]), true]));
      if (I.monthly.length) {
        const cats = Object.keys(I.monthly[0]);
        h += `<h3>Last ${I.monthly.length} months (income negative)</h3><div style="overflow:auto"><table class="kv"><tr><td></td>${I.monthly.map((_, i) => `<td class="r">${i + 1}</td>`).join('')}</tr>
          ${cats.map(c => `<tr><td>${spaced(c)}</td>${I.monthly.map(m => `<td class="r">${m[c] ? money(m[c]) : '·'}</td>`).join('')}</tr>`).join('')}</table></div>`;
      }
      for (const [k, v] of Object.entries(I.money_graphs)) h += `<h3>${spaced(k)}</h3>${spark(v, x => money(x))}`;
    } else if (tab === 'research') {
      h += kv(Object.entries(I.research_settings).map(([k, v]) => [spaced(k), /Budget|Money/.test(k) ? money(v) : v, true]));
      h += `<h3>Categories</h3>` + kv(I.research.map(r => [esc(r.name), `${r.invented ? 'invented' : r.available ? 'researching' : 'not available'} · level ${r.level ?? '–'}`]));
      if (I.available.rides.length) h += `<h3>Available attractions</h3><p class="muted" style="font-size:12px">${I.available.rides.map(spaced).map(esc).join(', ')}</p>`;
    } else if (tab === 'scenery') {
      const n = I.scenery_counts.reduce((a, s) => a + s.count, 0);
      h += `<p>${n.toLocaleString()} scenery items of ${I.scenery_counts.length} kinds.</p>` + kv(I.scenery_counts.map(s => [esc(s.title), s.count, true]));
    } else if (tab === 'data') {
      h += `<p class="muted">Everything the save holds, by type (${Object.values(I.object_counts).reduce((a, b) => a + b, 0).toLocaleString()} objects). Park settings:</p>` +
        kv(Object.entries(P).map(([k, v]) => [spaced(k), esc(typeof v === 'number' ? +v.toFixed(3) : v)])) +
        `<h3>Objects</h3>` + kv(Object.entries(I.object_counts).map(([k, v]) => [spaced(k), v.toLocaleString(), true]));
    }
    ibody.innerHTML = h;
    ibody.parentElement.scrollTop = 0;
    const gf = $('#pk-gf', ibody);
    if (gf) gf.oninput = () => { const f = gf.value.toLowerCase(); $('#pk-glist', ibody).innerHTML = info.people.guest_list.filter(g => g.name.toLowerCase().includes(f)).slice(0, 400)
      .map(g => `<div class="row"><span>${esc(g.name)}</span><small>${pct(g.happiness)} happy · ${money(g.cash)} · ${g.rides ?? 0} rides</small></div>`).join(''); };
  }
  ibody.addEventListener('click', e => {
    const c = e.target.closest('[data-ride]'); if (!c) return;
    const p = rideSpots[+c.dataset.ride];
    if (p) flyTo(p, 70); else status('That one is still loading…', 0.5), setTimeout(() => status(null), 1200);
  });

  // ---- walkthrough --------------------------------------------------------------------------------------------------
  const TOUR = [
    { title: 'Parks', html: `<p>Every park the game ships with: the <b>campaign</b> scenarios, the <b>Soaked!</b> and <b>Wild!</b> campaigns and the
        <b>sandbox</b>, opened from the game's own files and shown in full 3D with everything about them.</p>` },
    { target: '#pk-list', title: 'Pick a park', html: `<p>The parks in campaign order. Type in the box to find one. Picking a park builds it: the landscape first, then every
        tree, building, ride and stall (the first time takes a few seconds per park).</p>` },
    { target: '#pk-view', title: 'The park in 3D', html: `<ul><li><b>Drag</b> to turn, <b>right-drag</b> to move, <b>wheel</b> to zoom</li>
        <li><b>Arrow keys / WASD</b> move around</li><li><b>Click</b> anything to see what it is, which tile it stands on and how high</li></ul>
        <p>Guests, staff and ducks stand where they were when the park was saved.</p>` },
    { target: '#pk-tog', title: 'What to show', html: `<p>Turn parts of the park on and off: scenery, rides, paths, water, people. <b>Land</b> shades ground the park
        doesn't own (yellow: for sale). <b>Grid</b> shows the 4 m tiles, <b>Animate</b> plays the animated scenery and rides.</p>` },
    { target: '#pk-home', title: 'Cameras', html: `<p><b>Whole park</b> frames the park's land. <b>Park camera</b> jumps to where the game's camera was when the park was saved.</p>` },
    { target: '#pk-itabs', title: 'Everything about the park', html: `<ul><li><b>Overview</b>: description, guests, rating, cash, opening hours, land</li>
        <li><b>Goals</b>: what to reach for <b>Apprentice</b>, <b>Entrepreneur</b> and <b>Tycoon</b>, plus the Soaked!/Wild! challenges</li>
        <li><b>Rides</b> and <b>Shops</b>: every attraction with its ratings, prices and takings (click one to fly to it)</li>
        <li><b>People</b>, <b>Money</b> (with monthly figures and history), <b>Research</b>, <b>Scenery</b>, and <b>Data</b> (the raw save)</li></ul>`,
      before: async () => { tab = 'goals'; renderInfo(); } },
    { target: '#pk-back', title: 'Back', html: `<p><b>Back</b> (or <kbd>Esc</kbd>) returns to the viewer. "<b>? Tour</b>" replays this walkthrough.</p>`,
      before: async () => { tab = 'overview'; renderInfo(); } },
  ];
  function tour(force) { if (root.style.display === 'none' || tourRunning()) return; runTour('parks', TOUR, { force }); }
  $('#pk-tour', root).onclick = () => tour(true);

  window.__pkdebug = { scene, renderer, camera, controls, layers, get world() { return world; }, get info() { return info; }, rideSpots: () => rideSpots, load, heightAt, ROT, flyTo, get current() { return current; } };
  return { root, start, stop, load, ready, tour, parks: [], current: null, onBack: null };
}
