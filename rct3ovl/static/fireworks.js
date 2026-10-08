// Fireworks show editor: RCT3's firework displays (FireworkDisplays\*.fwd) and fireworks (Fireworks\*.frw),
// simulated from the game's own particle descriptions and drawn with its sprites and sounds.
// Opened full-window from the viewer's Fireworks tab; "Back" returns to the viewer.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const TILE = 4, GRAVITY = 9.81, MAX_PARTICLES = 40000, MAX_VOICES = 40;
const LAUNCHER_NAMES = { Mortarx1: 'Mortar ×1', Mortarx16: 'Mortar ×16', MortarWallx8: 'Wall ×8',
  CWFW: 'Cath. wheel', LazerDome: 'Laser dome', WaterJet: 'Water jet' };
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fmt = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
const hex = c => '#' + c.map(x => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
const unhex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
                set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

let ui = null;   // built once

export async function openFireworks({ onBack }) {
  if (!ui) ui = await build();
  ui.onBack = onBack;
  ui.root.style.display = 'grid';
  ui.resize(); ui.start();
  history.replaceState(null, '', '#fireworks');
}

// ------------------------------------------------------------------------------------------------------------
async function build() {
  const css = document.createElement('style');
  css.textContent = `
  #fw { position: fixed; inset: 0; z-index: 50; display: none; background: var(--bg); color: var(--text);
        grid-template-columns: var(--fwl, 270px) minmax(0, 1fr) var(--fwr, 330px); grid-template-rows: auto minmax(0, 1fr) var(--fwt, 250px); }
  #fw .bar { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--panel2);
             border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  #fw .bar h2 { margin: 0 6px 0 4px; font-size: 15px; color: var(--accent); white-space: nowrap; }
  #fw .bar .sep { width: 1px; align-self: stretch; background: var(--line); margin: 0 2px; }
  #fw .bar .time { font: 600 13px ui-monospace, Consolas, monospace; min-width: 120px; text-align: center; color: var(--text); }
  #fw .bar .grow { flex: 1; }
  #fw button.big { font-weight: 600; } #fw button.play { min-width: 74px; }
  #fw .back { border-color: var(--accent); color: var(--accent); }
  #fw .side { background: var(--panel); border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; min-width: 0; position: relative; }
  #fw .side.right { border-right: 0; border-left: 1px solid var(--line); }
  #fw .side h3 { margin: 0; padding: 10px 12px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--accent); }
  #fw .side .scroll { overflow: auto; flex: 1; min-height: 0; }
  #fw .lib { padding: 2px 6px 10px; }
  #fw .fwk { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 6px; cursor: grab; user-select: none; }
  #fw .fwk:hover { background: var(--panel2); } #fw .fwk.sel { background: var(--sel); }
  #fw .sw { width: 12px; height: 12px; border-radius: 3px; flex: none; box-shadow: 0 0 6px currentColor; }
  #fw .fwk .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #fw .fwk .cost { color: var(--dim); font-size: 11px; }
  #fw .fwk .pv { padding: 1px 7px; font-size: 11px; }
  #fw .view { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: #03050b; }
  #fw .view canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  #fw .view .lbl { font: 600 11px system-ui; color: #fff; background: #000a; padding: 1px 5px; border-radius: 4px; pointer-events: none; white-space: nowrap; }
  #fw .view .lbl.sel { background: var(--accent); color: #000; }
  #fw .view .hint { position: absolute; left: 10px; bottom: 8px; color: #8890a0; font-size: 11px; pointer-events: none; }
  #fw .view .stats { position: absolute; right: 10px; top: 8px; color: #8890a0; font: 11px ui-monospace, Consolas, monospace; pointer-events: none; text-align: right; }
  #fw .insp { padding: 4px 12px 14px; display: grid; gap: 7px; }
  #fw .insp label { display: grid; grid-template-columns: 82px 1fr; align-items: center; gap: 6px; color: var(--dim); font-size: 12px; }
  #fw .insp input[type=number], #fw .insp input[type=text], #fw .insp select { width: 100%; min-width: 0; background: var(--bg); color: var(--text);
        border: 1px solid var(--line); border-radius: 6px; padding: 4px 6px; font: inherit; }
  #fw .insp .row { display: flex; gap: 6px; flex-wrap: wrap; }
  #fw .insp .muted { color: var(--dim); font-size: 12px; }
  #fw .lnch { display: grid; grid-template-columns: 22px minmax(92px, 1fr) 42px 42px 48px 22px; gap: 4px; align-items: center; padding: 3px 0; }
  #fw .lnch.sel { background: var(--sel); border-radius: 6px; }
  #fw .lnch input, #fw .lnch select { padding: 2px 4px !important; font-size: 12px !important; }
  #fw .lnch .n { color: var(--dim); text-align: right; font-size: 11px; }
  #fw .x { padding: 0 5px; line-height: 18px; color: var(--dim); }
  #fw .tl { grid-column: 1 / -1; display: grid; grid-template-columns: 74px minmax(0, 1fr); grid-template-rows: 26px minmax(0, 1fr);
            border-top: 1px solid var(--line); background: var(--panel); position: relative; min-height: 0; }
  #fw .tl .grip { position: absolute; left: 0; right: 0; top: -4px; height: 8px; cursor: row-resize; z-index: 5; }
  #fw .tl .grip:hover, #fw .tl .grip.drag { background: linear-gradient(transparent 3px, var(--accent) 3px, var(--accent) 5px, transparent 5px); }
  #fw .tl .corner { background: var(--panel2); border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); display: flex; align-items: center; justify-content: center; gap: 2px; }
  #fw .tl .corner button { padding: 0 5px; font-size: 12px; line-height: 18px; }
  #fw .tl .ruler { position: relative; overflow: hidden; background: var(--panel2); border-bottom: 1px solid var(--line); cursor: ew-resize; }
  #fw .tl .ruler .tick { position: absolute; top: 0; bottom: 0; border-left: 1px solid var(--line); font: 10px ui-monospace, Consolas, monospace; color: var(--dim); padding: 2px 3px; }
  #fw .tl .heads { overflow: hidden; border-right: 1px solid var(--line); }
  #fw .tl .head { height: var(--rowh); display: flex; align-items: center; padding-left: 8px; font-size: 11px; color: var(--dim); border-bottom: 1px solid #ffffff08; }
  #fw .tl .lanes { position: relative; overflow: auto; }
  #fw .tl .canvas { position: relative; }
  #fw .tl .lane { position: absolute; left: 0; right: 0; height: var(--rowh); border-bottom: 1px solid #ffffff08; }
  #fw .tl .lane:nth-child(odd) { background: #ffffff04; }
  #fw .tl .ent { position: absolute; height: calc(var(--rowh) - 6px); margin-top: 3px; border-radius: 5px; font-size: 11px; padding: 0 6px; display: flex; align-items: center;
                 overflow: hidden; white-space: nowrap; cursor: grab; color: #0a0d14; font-weight: 600; box-shadow: inset 0 0 0 1px #0006; user-select: none; }
  #fw .tl .ent .tail { position: absolute; right: 0; top: 0; bottom: 0; background: linear-gradient(90deg, transparent, #0005); pointer-events: none; }
  #fw .tl .ent.sel { box-shadow: 0 0 0 2px #fff, 0 0 10px #fff8; z-index: 2; }
  #fw .tl .ent.live { filter: brightness(1.35); }
  #fw .tl .playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: #ff5050; pointer-events: none; z-index: 3; box-shadow: 0 0 6px #ff5050; }
  #fw .tl .rplay { position: absolute; top: 0; bottom: 0; width: 2px; background: #ff5050; pointer-events: none; }
  #fw .tl .band { position: absolute; border: 1px solid var(--accent); background: #ffb02e22; pointer-events: none; display: none; z-index: 4; }
  #fw .tl .ent.multi { box-shadow: 0 0 0 2px var(--accent), 0 0 8px #ffb02e88; z-index: 2; }
  #fw .insp .kbd { font: 11px ui-monospace, Consolas, monospace; color: var(--dim); }
  #fw .tl .drop { position: absolute; height: var(--rowh); border: 1px dashed var(--accent); border-radius: 5px; pointer-events: none; display: none; }
  #fw .toast { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); background: #000c; color: #fff; padding: 6px 12px; border-radius: 8px; font-size: 12px; pointer-events: none; opacity: 0; transition: opacity .3s; }
  #fw .toast.on { opacity: 1; }
  #fw .colresize { position: absolute; top: 0; bottom: 0; width: 8px; cursor: col-resize; z-index: 6; }
  #fw .colresize:hover, #fw .colresize.drag { background: linear-gradient(90deg, transparent 3px, var(--accent) 3px, var(--accent) 5px, transparent 5px); }
  @media (max-width: 900px) { #fw { grid-template-columns: 1fr; grid-template-rows: auto 40vh 1fr 1fr 260px; } #fw .side, #fw .side.right { border: 0; } }
  `;
  document.head.appendChild(css);
  const root = document.createElement('div'); root.id = 'fw';
  root.innerHTML = `
  <div class="bar">
    <button class="back" id="fw-back" title="Back to the viewer (Esc)">← Back</button>
    <h2>Fireworks Show Editor</h2>
    <select id="fw-show" title="Open a show"></select>
    <button id="fw-new" title="Start an empty show">New</button>
    <button id="fw-open" title="Open a show saved from this editor (.json)">Open…</button>
    <button id="fw-save" title="Download this show (.json) to open again later">Save</button>
    <input type="file" id="fw-file" accept=".json,application/json" hidden>
    <span class="sep"></span>
    <button class="big play" id="fw-play" title="Play / pause (Space)">▶ Play</button>
    <button id="fw-stop" title="Back to the start (Home)">■</button>
    <span class="time" id="fw-time">0:00.0 / 0:00.0</span>
    <select id="fw-speed" title="Playback speed"><option value="0.25">¼×</option><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select>
    <span class="sep"></span>
    <select id="fw-music" title="Music played with the show"></select>
    <input type="file" id="fw-mfile" accept="audio/*" hidden>
    <label title="Volume" style="display:flex;align-items:center;gap:4px;color:var(--dim);font-size:12px">🔊<input type="range" id="fw-vol" min="0" max="1" step="0.05" value="0.7" style="width:80px"></label>
    <span class="grow"></span>
    <button id="fw-bloom" class="on" title="Glow effect">Glow</button>
    <select id="fw-cam" title="Camera"><option value="crowd">Crowd view</option><option value="close">Close up</option><option value="top">Top down</option><option value="orbit">Slow orbit</option></select>
  </div>
  <div class="side">
    <h3>Fireworks <small id="fw-libn" style="color:var(--dim)"></small></h3>
    <div style="padding:0 10px 6px"><input type="search" id="fw-search" placeholder="Search fireworks" style="width:100%"></div>
    <div class="scroll"><div class="lib" id="fw-lib"></div></div>
    <div class="muted" style="padding:8px 12px;color:var(--dim);font-size:11px;border-top:1px solid var(--line)">Click ▶ to preview · drag onto the timeline to add</div>
    <div class="colresize" data-v="--fwl" style="right:-4px"></div>
  </div>
  <div class="view" id="fw-view"><div class="stats" id="fw-stats"></div><div class="hint">Drag to orbit · right-drag to pan · wheel to zoom · click a launcher to select it</div><div class="toast" id="fw-toast"></div></div>
  <div class="side right">
    <div class="colresize" data-v="--fwr" style="left:-4px"></div>
    <div class="scroll">
      <h3>Selected launch</h3><div class="insp" id="fw-entry"></div>
      <h3>Show</h3><div class="insp" id="fw-showinfo"></div>
      <h3>Launchers</h3><div class="insp" id="fw-launchers"></div>
    </div>
  </div>
  <div class="tl" id="fw-tl">
    <div class="grip" id="fw-grip" title="Drag to resize the timeline"></div>
    <div class="corner"><button id="fw-zout" title="Zoom out (-)">−</button><button id="fw-zin" title="Zoom in (+)">+</button></div>
    <div class="ruler" id="fw-ruler"></div>
    <div class="heads" id="fw-heads"></div>
    <div class="lanes" id="fw-lanes"><div class="canvas" id="fw-canvas"></div></div>
  </div>`;
  document.body.appendChild(root);

  // ---- data ------------------------------------------------------------------------------------------------
  const data = await (await fetch('/api/fw/data')).json();
  const FW = Object.fromEntries(data.fireworks.map(f => [f.file, f]));
  for (const f of data.fireworks) f.duration = fireworkDuration(f);
  const S = { show: null, sel: null, selLauncher: 0, t: 0, playing: false, speed: 1, pps: 40, rowH: 26, undo: [], redo: [], fired: new Set(), multi: new Set() };

  // ---- three.js scene --------------------------------------------------------------------------------------
  const view = $('#fw-view', root);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  view.prepend(renderer.domElement);
  const labels = new CSS2DRenderer(); labels.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  view.appendChild(labels.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03050b);
  scene.fog = new THREE.Fog(0x03050b, 250, 700);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495;
  scene.add(new THREE.HemisphereLight(0x8090c0, 0x101810, 0.9));
  const moon = new THREE.DirectionalLight(0xbfd0ff, 1.2); moon.position.set(-60, 120, 80); scene.add(moon);
  // ground, park tiles, a few stars
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshLambertMaterial({ color: 0x0c160f }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const grid = new THREE.GridHelper(200, 50, 0x23402c, 0x16261b); grid.position.y = 0.02; scene.add(grid);
  {
    const n = 1500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, e = Math.random() * 1.3 + 0.08, r = 1200;
      pos.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xaab4ff, size: 1.6, sizeAttenuation: false, fog: false })));
  }
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.1, 0.55, 0.12);
  composer.addPass(bloom); composer.addPass(new OutputPass());
  let useBloom = true;

  // ---- particle rendering: instanced camera-facing quads, stretched along velocity --------------------------
  const pages = {};
  function pageTexture(name) {
    if (!pages[name]) {
      const tex = new THREE.TextureLoader().load('/api/fw/page?name=' + encodeURIComponent(name));
      tex.colorSpace = THREE.SRGBColorSpace; pages[name] = tex;
    }
    return pages[name];
  }
  const page = pageTexture('ParticlePage01');
  function makeLayer(additive) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const A = (name, n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * n), n); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    const at = { pos: A('iPos', 3), vel: A('iVel', 3), size: A('iSize', 2), col: A('iCol', 4), uv: A('iUV', 4) };
    const m = new THREE.ShaderMaterial({
      // glowing particles: the game's flare sprites keep their glow in RGB with alpha 0, drawn additively (one + one)
      uniforms: { map: { value: page } }, transparent: true, depthWrite: false,
      ...(additive ? { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation }
                   : { blending: THREE.NormalBlending }),
      defines: additive ? { ADDITIVE: 1 } : {},
      vertexShader: `attribute vec3 iPos; attribute vec3 iVel; attribute vec2 iSize; attribute vec4 iCol; attribute vec4 iUV;
        varying vec2 vUv; varying vec4 vCol;
        void main() {
          vec4 c = modelViewMatrix * vec4(iPos, 1.0);
          vec3 v = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
          float L = length(v.xy);
          vec2 ax = L > 1e-4 ? v.xy / L : vec2(1.0, 0.0);
          vec2 ay = vec2(-ax.y, ax.x);
          c.xy += ax * position.x * (iSize.x + iSize.y) + ay * position.y * iSize.x;
          gl_Position = projectionMatrix * c;
          vUv = mix(iUV.xy, iUV.zw, position.xy + 0.5);
          vCol = iCol;
        }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec4 vCol;
        void main() {
          vec4 t = texture2D(map, vUv);
        #ifdef ADDITIVE
          gl_FragColor = vec4(t.rgb * vCol.rgb * vCol.a, 1.0);
        #else
          gl_FragColor = vec4(t.rgb * vCol.rgb, t.a * vCol.a); if (gl_FragColor.a < 0.003) discard;
        #endif
        }`,
    });
    const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; g.instanceCount = 0; scene.add(mesh);
    return { g, at, mesh };
  }
  const layers = { add: makeLayer(true), blend: makeLayer(false) };

  // ---- particle simulation (the game's ParticleDesc / ParticleEmitterDesc tree) ------------------------------
  const descCache = new Map();
  function descInfo(fw, id) {
    const key = fw.file + '/' + id;
    let d = descCache.get(key);
    if (d) return d;
    const n = fw.nodes[id] || {};
    const sp = n.TextureNameReduced ? data.sprites[n.TextureNameReduced] : null;
    const curve = c => c ? { t: c[Object.keys(c).find(k => k.endsWith('Times'))] || [], v: c[Object.keys(c).find(k => k.endsWith('Values'))] || [] } : { t: [], v: [] };
    const A = curve(n.ColourA);
    d = { n, fw, life: n.Lifetime || 0, lifeR: n.LifetimeRandom || 0, s0: n.StartSize ?? 1, s1: n.EndSize ?? 1, sR: n.SizeRandom || 0,
      drag: n.Drag || 0, grav: n.GravityScale || 0, stretch: n.VelStretch || 0, sound: n.SoundName || '',
      sndMin: n.SoundMinDist || 70, sndMax: n.SoundMaxDist || 300,
      R: curve(n.ColourR), G: curve(n.ColourG), B: curve(n.ColourB),
      additive: !A.v.length || Math.max(...A.v) < 0.5,
      mod: n.ColourModifierEnable ? [n.ColourModifierR ?? 1, n.ColourModifierG ?? 1, n.ColourModifierB ?? 1] : null,
      uv: sp ? [sp.rect[0], 1 - sp.rect[3], sp.rect[2], 1 - sp.rect[1]] : null,
      emitters: (n.ParticleEmitterDescs || []).map(eid => fw.nodes[eid]).filter(Boolean).map(e => ({
        N: e.NumParticles || 0, a: e.StartTime ?? 0, b: e.EndTime ?? 1, speed: e.ParticleSpeed || 0, sr: e.SpeedRandom || 0,
        src: e.SpeedRandomCircle || 0, pr: e.PositionRandom || 0, prc: e.PositionRandomCircle || 0, psf: e.ParentSpeedFactor || 0,
        rel: !!e.ParticleRelative, tr: e.TimeRandom || 0, desc: String(e.ParticleDesc),
        spin: [e.SpinRateX || 0, e.SpinRateY || 0, e.SpinRateZ || 0], spin0: [e.SpinOffsetX || 0, e.SpinOffsetY || 0, e.SpinOffsetZ || 0] })),
    };
    descCache.set(key, d);
    return d;
  }
  const curveAt = (c, f) => {
    const t = c.t, v = c.v;
    if (!v.length) return 1;
    if (v.length === 1 || !t.length || f <= t[0]) return v[0];
    for (let i = 1; i < t.length && i < v.length; i++) if (f <= t[i]) { const k = (f - t[i - 1]) / Math.max(1e-6, t[i] - t[i - 1]); return v[i - 1] + (v[i] - v[i - 1]) * k; }
    return v[Math.min(t.length, v.length) - 1];
  };
  function randUnit() { const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z); return [r * Math.cos(a), z, r * Math.sin(a)]; }
  function randPerp(h) {   // unit vector at a random angle around h
    let ax = Math.abs(h[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = [h[1] * ax[2] - h[2] * ax[1], h[2] * ax[0] - h[0] * ax[2], h[0] * ax[1] - h[1] * ax[0]];
    const ul = Math.hypot(...u) || 1; u = u.map(x => x / ul);
    const w = [h[1] * u[2] - h[2] * u[1], h[2] * u[0] - h[0] * u[2], h[0] * u[1] - h[1] * u[0]];
    const a = Math.random() * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    return [u[0] * c + w[0] * s, u[1] * c + w[1] * s, u[2] * c + w[2] * s];
  }
  function rotXYZ(v, rx, ry, rz) {
    let [x, y, z] = v, c, s;
    if (rx) { c = Math.cos(rx); s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c]; }
    if (ry) { c = Math.cos(ry); s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c]; }
    if (rz) { c = Math.cos(rz); s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c]; }
    return [x, y, z];
  }
  let parts = [], silent = false;
  function spawn(d, x, y, z, vx, vy, vz, h, parent, tint) {
    if (parts.length >= MAX_PARTICLES) return null;
    const p = { d, x, y, z, vx, vy, vz, h, age: 0, life: Math.max(1e-3, d.life + Math.random() * d.lifeR), em: new Float32Array(d.emitters.length),
                r0: Math.random(), parent, tint, delays: d.emitters.map(e => e.tr ? Math.random() * e.tr : 0) };
    parts.push(p);
    if (d.sound && !silent) playSound(d.sound, x, y, z, d.sndMin, d.sndMax);
    return p;
  }
  function emit(p, f) {
    const es = p.d.emitters;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (!e.N) continue;
      const ff = f - p.delays[i] / p.life;
      let target = e.b <= e.a ? (ff >= e.a ? e.N : 0) : e.N * clamp((ff - e.a) / (e.b - e.a), 0, 1);
      if (f >= 1 && ff >= e.a) target = e.N;
      const n = Math.floor(target + 1e-6) - p.em[i];
      if (n <= 0) continue;
      p.em[i] += n;
      const cd = descInfo(p.d.fw, e.desc);
      const sp = Math.hypot(p.vx, p.vy, p.vz);
      let h = sp > 0.05 ? [p.vx / sp, p.vy / sp, p.vz / sp] : p.h;
      if (e.spin[0] || e.spin[1] || e.spin[2] || e.spin0[0] || e.spin0[1] || e.spin0[2])
        h = rotXYZ(h, e.spin0[0] + e.spin[0] * p.age, e.spin0[1] + e.spin[1] * p.age, e.spin0[2] + e.spin[2] * p.age);
      for (let k = 0; k < n; k++) {
        const s = randUnit(), c = randPerp(h), ps = randUnit(), pc = e.prc ? randPerp(h) : null;
        const sr = e.sr * (0.85 + 0.15 * Math.random()), pr = e.pr * Math.random();
        const vx = h[0] * e.speed + s[0] * sr + c[0] * e.src + p.vx * e.psf;
        const vy = h[1] * e.speed + s[1] * sr + c[1] * e.src + p.vy * e.psf;
        const vz = h[2] * e.speed + s[2] * sr + c[2] * e.src + p.vz * e.psf;
        let x = p.x + ps[0] * pr, y = p.y + ps[1] * pr, z = p.z + ps[2] * pr;
        if (pc) { x += pc[0] * e.prc; y += pc[1] * e.prc; z += pc[2] * e.prc; }
        const q = spawn(cd, x, y, z, vx, vy, vz, h, e.rel ? p : null, p.tint);
        if (!q) return;
      }
    }
  }
  function step(dt) {
    const g = GRAVITY * dt;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], d = p.d;
      p.age += dt;
      if (d.grav) p.vy -= g * d.grav;
      if (d.drag) { const k = Math.max(0, 1 - d.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.parent && p.parent.age < p.parent.life) { p.x += p.parent.vx * dt; p.y += p.parent.vy * dt; p.z += p.parent.vz * dt; }
      emit(p, Math.min(1, p.age / p.life));
    }
    let j = 0;
    for (let i = 0; i < parts.length; i++) { const p = parts[i]; if (p.age < p.life && p.y > -2) parts[j++] = p; }
    parts.length = j;
  }
  function draw() {
    const L = { add: layers.add, blend: layers.blend }, cnt = { add: 0, blend: 0 };
    for (const p of parts) {
      const d = p.d;
      if (!d.uv) continue;
      const k = d.additive ? 'add' : 'blend', l = L[k], i = cnt[k]++;
      const f = Math.min(1, p.age / p.life);
      const size = (d.s0 + (d.s1 - d.s0) * f) * (1 + d.sR * (p.r0 - 0.5) * 2);
      let r = curveAt(d.R, f), g = curveAt(d.G, f), b = curveAt(d.B, f);
      if (d.mod) { r *= d.mod[0]; g *= d.mod[1]; b *= d.mod[2]; }
      if (p.tint) { r *= p.tint[0]; g *= p.tint[1]; b *= p.tint[2]; }
      const sp = Math.hypot(p.vx, p.vy, p.vz);
      l.at.pos.array.set([p.x, p.y, p.z], i * 3);
      l.at.vel.array.set([p.vx, p.vy, p.vz], i * 3);
      l.at.size.array.set([size, sp * d.stretch], i * 2);
      l.at.col.array.set([r, g, b, d.additive ? 1 : curveAt({ t: [], v: [1] }, f) * (1 - f * 0.6)], i * 4);
      l.at.uv.array.set(d.uv, i * 4);
    }
    for (const k of ['add', 'blend']) {
      const l = L[k]; l.g.instanceCount = cnt[k];
      for (const a of Object.values(l.at)) { a.needsUpdate = true; a.clearUpdateRanges?.(); a.addUpdateRange?.(0, cnt[k] * a.itemSize); }
    }
  }

  // ---- sound ------------------------------------------------------------------------------------------------
  let actx = null, master = null, voices = 0;
  const buffers = new Map();
  function audio() {
    if (!actx) { actx = new (window.AudioContext || window.webkitAudioContext)(); master = actx.createGain(); master.gain.value = +$('#fw-vol', root).value; master.connect(actx.destination); }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function loadSound(name) {
    if (!buffers.has(name)) buffers.set(name, fetch('/api/fw/sound?name=' + encodeURIComponent(name)).then(r => r.ok ? r.arrayBuffer() : null)
      .then(b => b && audio().decodeAudioData(b)).catch(() => null));
    return buffers.get(name);
  }
  function playSound(name, x, y, z, dmin, dmax) {
    if (!actx || voices >= MAX_VOICES || S.speed < 0.3) return;
    const dist = camera.position.distanceTo(new THREE.Vector3(x, y, z));
    const gain = dist <= dmin ? 1 : clamp((dmax - dist) / Math.max(1, dmax - dmin), 0, 1) * 0.9 + 0.1;
    loadSound(name).then(buf => {
      if (!buf || voices >= MAX_VOICES) return;
      const src = actx.createBufferSource(); src.buffer = buf; src.playbackRate.value = S.speed;
      const g = actx.createGain(); g.gain.value = gain * 0.8;
      src.connect(g).connect(master); voices++; src.onended = () => voices--; src.start();
    });
  }
  const musicEl = new Audio(); musicEl.preload = 'auto';
  let musicUrl = '';

  // ---- launchers ----------------------------------------------------------------------------------------------
  const gltf = new GLTFLoader(), launcherDefs = {}, launcherGroup = new THREE.Group(); scene.add(launcherGroup);
  let launcherObjs = [];
  function launcherDef(type) {
    if (!launcherDefs[type]) launcherDefs[type] = fetch('/api/fw/launcher?name=' + encodeURIComponent(type)).then(async r => {
      if (!r.ok) return null;
      const info = JSON.parse(r.headers.get('X-Info') || '{}');
      const g = await gltf.parseAsync(await r.arrayBuffer(), '');
      return { info, gltf: g };
    }).catch(() => null);
    return launcherDefs[type];
  }
  function layoutCentre() {
    const ls = S.show.launchers;
    if (!ls.length) return [0, 0];
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const l of ls) { x0 = Math.min(x0, l.col); x1 = Math.max(x1, l.col); z0 = Math.min(z0, l.row); z1 = Math.max(z1, l.row); }
    return [(x0 + x1) / 2, (z0 + z1) / 2];
  }
  let centre = [0, 0], buildSeq = 0;
  async function rebuildLaunchers() {
    const my = ++buildSeq;
    centre = layoutCentre();
    const defs = await Promise.all(S.show.launchers.map(l => launcherDef(l.type)));
    if (my !== buildSeq) return;
    for (const o of launcherObjs) { launcherGroup.remove(o.obj); o.label?.element.remove(); o.mixer?.stopAllAction(); }
    launcherObjs = S.show.launchers.map((l, i) => {
      const def = defs[i];
      const obj = def ? def.gltf.scene.clone(true) : new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0x884422 }));
      placeLauncher(obj, l);
      launcherGroup.add(obj);
      const el = document.createElement('div'); el.className = 'lbl'; el.textContent = '#' + (i + 1);
      const label = new CSS2DObject(el); label.position.set(0, 3.2, 0); obj.add(label);
      let mixer = null;
      if (def?.gltf.animations?.length) { mixer = new THREE.AnimationMixer(obj); mixer.clipAction(def.gltf.animations[0]).play(); }
      obj.traverse(o => { o.userData.launcher = i; });
      return { obj, def, label, mixer };
    });
    obj3dMarkSel();
  }
  function placeLauncher(obj, l) {
    const cx = ((l.corner ?? -1) >= 0 && /mortarx1$|waterjet|lazerdome/i.test(l.type)) ? [[-1, -1], [1, -1], [1, 1], [-1, 1]][l.corner & 3] : [0, 0];
    obj.position.set((l.col - centre[0]) * TILE + cx[0], 0, (l.row - centre[1]) * TILE + cx[1]);
    obj.rotation.set(0, -(l.dir || 0) * Math.PI / 2, 0);
    obj.updateMatrixWorld(true);
  }
  function obj3dMarkSel() { launcherObjs.forEach((o, i) => o.label.element.classList.toggle('sel', i === S.selLauncher)); }
  function tubeWorld(li, slot) {   // [start, dir] of a launcher's tube in world space
    const o = launcherObjs[li];
    if (!o) return null;
    o.obj.updateMatrixWorld(true);
    const info = o.def?.info;
    if (info?.bone_tubes) {
      const n = info.bone_tubes, k = String((slot % n) + 1).padStart(2, '0');
      const a = o.obj.getObjectByName('fireworkstart' + k), b = o.obj.getObjectByName('fireworkend' + k);
      if (a && b) { const pa = a.getWorldPosition(new THREE.Vector3()), pb = b.getWorldPosition(new THREE.Vector3()); return [pa, pb.sub(pa).normalize()]; }
    }
    const tubes = info?.tubes || [];
    if (tubes.length) {
      const t = tubes[slot % tubes.length];
      const pa = o.obj.localToWorld(new THREE.Vector3(...t.start)), pb = o.obj.localToWorld(new THREE.Vector3(...t.end));
      return [pa, pb.sub(pa).normalize()];
    }
    return [o.obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3(0, 1, 0)];
  }
  function launch(entry, quiet) {
    const fw = FW[entry.firework];
    if (!fw) return;
    const tw = tubeWorld(entry.launcher, entry.slot) || [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0)];
    const [p, h] = tw;
    silent = !!quiet;
    spawn(descInfo(fw, fw.root), p.x, p.y, p.z, 0, 0, 0, [h.x, h.y, h.z], null, entry.tint || null);
    silent = false;
  }

  // ---- show model ---------------------------------------------------------------------------------------------
  const blank = () => ({ name: 'My show', music: '', launchers: [{ type: 'Mortarx16', row: 0, col: 0, dir: 0, corner: -1 },
    { type: 'Mortarx1', row: 0, col: -3, dir: 0, corner: 0 }, { type: 'Mortarx1', row: 0, col: 3, dir: 0, corner: 0 }], entries: [] });
  const clone = o => JSON.parse(JSON.stringify(o));
  // selection: S.multi holds every selected launch, S.sel the one shown in detail (the last clicked)
  const selList = () => S.show.entries.filter(e => S.multi.has(e));
  function select(list, primary) {
    S.multi = new Set(list);
    S.sel = primary && S.multi.has(primary) ? primary : (S.multi.has(S.sel) ? S.sel : list[list.length - 1] || null);
  }
  const showEnd = () => Math.max(10, ...S.show.entries.map(e => e.time + (FW[e.firework]?.duration || 4) + 1));
  const timelineEnd = () => Math.max(30, showEnd() + 10, isFinite(musicEl.duration) ? musicEl.duration : 0);
  const tracks = () => Math.max(12, ...S.show.entries.map(e => e.track + 2));
  function setShow(show, keepT) {
    S.show = show; select([]); S.selLauncher = 0;
    if (!keepT) seek(0);
    setMusic(show.music || '');
    rebuildLaunchers(); renderAll();
    fitCamera($('#fw-cam', root).value);
  }
  function changed(label) { store.set('rct3fw.autosave', S.show); if (label) toast(label); }
  function snapshot() { S.undo.push(clone(S.show)); if (S.undo.length > 120) S.undo.shift(); S.redo = []; }
  function undo() { if (!S.undo.length) return; S.redo.push(clone(S.show)); S.show = S.undo.pop(); select([]); rebuildLaunchers(); renderAll(); changed('Undo'); }
  function redo() { if (!S.redo.length) return; S.undo.push(clone(S.show)); S.show = S.redo.pop(); select([]); rebuildLaunchers(); renderAll(); changed('Redo'); }

  // ---- music --------------------------------------------------------------------------------------------------
  function setMusic(name) {
    const sel = $('#fw-music', root);
    if (name && ![...sel.options].some(o => o.value === name)) sel.add(new Option(name.replace(/\.wma$/i, ''), name));
    sel.value = name;
    musicEl.pause();
    if (!name) { musicEl.removeAttribute('src'); musicUrl = ''; return; }
    if (name.startsWith('blob:')) { musicEl.src = name; return; }
    if (!data.can_play_music) { toast('Game music needs ffmpeg: start the viewer with rct3ovl-viewer.bat (or choose a music file)'); return; }
    musicUrl = '/api/fw/music?name=' + encodeURIComponent(name);
    toast('Loading music…'); musicEl.src = musicUrl;
    musicEl.oncanplay = () => { toast('Music ready'); musicEl.oncanplay = null; renderTimeline(); };
    musicEl.onerror = () => toast('Could not load that music');
  }

  // ---- playback -----------------------------------------------------------------------------------------------
  function seek(t) {
    t = clamp(t, 0, timelineEnd());
    parts = []; S.fired.clear();
    // replay what is still in the sky at t: launches up to 10 s before, simulated silently
    const from = Math.max(0, t - 10), dt = 1 / 30;
    const es = S.show ? S.show.entries.filter(e => e.time <= t && e.time > from - 1e-6).sort((a, b) => a.time - b.time) : [];
    let k = 0, sim = from;
    while (sim < t - 1e-6) {
      while (k < es.length && es[k].time <= sim + 1e-6) { launch(es[k], true); S.fired.add(es[k]); k++; }
      step(Math.min(dt, t - sim)); sim += dt;
    }
    while (k < es.length) { launch(es[k], true); S.fired.add(es[k]); k++; }
    if (S.show) for (const e of S.show.entries) if (e.time <= t) S.fired.add(e);
    S.t = t;
    if (musicEl.src && !isNaN(musicEl.duration)) try { musicEl.currentTime = Math.min(t, musicEl.duration); } catch (e) {}
    updateTime();
  }
  function play(on) {
    S.playing = on ?? !S.playing;
    $('#fw-play', root).textContent = S.playing ? '❚❚ Pause' : '▶ Play';
    if (S.playing) {
      audio();
      if (S.t >= showEnd() - 0.05) seek(0);
      if (musicEl.src) { musicEl.playbackRate = S.speed; musicEl.currentTime = S.t; musicEl.play().catch(() => {}); }
    } else musicEl.pause();
  }
  function updateTime() {
    $('#fw-time', root).textContent = `${fmt(S.t)} / ${fmt(showEnd())}`;
    const x = S.t * S.pps;
    ph.style.left = x + 'px'; rph.style.left = (x - lanes.scrollLeft) + 'px';
    if (S.playing && (x > lanes.scrollLeft + lanes.clientWidth - 40 || x < lanes.scrollLeft)) lanes.scrollLeft = x - 80;
  }

  // ---- camera -------------------------------------------------------------------------------------------------
  let orbit = false;
  function fitCamera(mode) {
    orbit = mode === 'orbit';
    const ls = S.show?.launchers || [];
    const span = Math.max(24, ...ls.map(l => Math.max(Math.abs((l.col - centre[0]) * TILE), Math.abs((l.row - centre[1]) * TILE)) * 2));
    controls.target.set(0, mode === 'close' ? 22 : 38, 0);
    if (mode === 'top') camera.position.set(0.01, 160 + span, 0.01);
    else if (mode === 'close') camera.position.set(span * 0.3, 8, span + 40);
    else camera.position.set(0, 10, 75 + span * 0.8);
    controls.update();
  }

  // ---- UI: library ---------------------------------------------------------------------------------------------
  const lib = $('#fw-lib', root);
  $('#fw-libn', root).textContent = data.fireworks.length;
  function renderLib() {
    const f = $('#fw-search', root).value.toLowerCase();
    lib.innerHTML = data.fireworks.filter(x => !f || x.title.toLowerCase().includes(f)).map(x =>
      `<div class="fwk" draggable="true" data-f="${esc(x.file)}" title="${esc(x.title)} · $${(x.cost / 100).toFixed(2)} · about ${x.duration.toFixed(1)} s">
        <span class="sw" style="background:${hex(x.colour)};color:${hex(x.colour)}"></span><span class="nm">${esc(x.title)}</span>
        <span class="cost">$${(x.cost / 100).toFixed(2)}</span><button class="pv" title="Preview">▶</button></div>`).join('');
  }
  $('#fw-search', root).oninput = renderLib;
  lib.addEventListener('click', e => {
    const row = e.target.closest('.fwk'); if (!row) return;
    lib.querySelectorAll('.fwk.sel').forEach(x => x.classList.remove('sel')); row.classList.add('sel');
    if (e.target.closest('.pv') || e.detail === 2) preview(row.dataset.f);
  });
  lib.addEventListener('dragstart', e => { const row = e.target.closest('.fwk'); if (row) { e.dataTransfer.setData('text/x-firework', row.dataset.f); e.dataTransfer.effectAllowed = 'copy'; } });
  function preview(file) {
    audio();
    const li = clamp(S.selLauncher, 0, Math.max(0, S.show.launchers.length - 1));
    launch({ firework: file, launcher: li, slot: Math.floor(Math.random() * 16), tint: S.sel?.firework === file ? S.sel.tint : null });
    toast(`Preview: ${FW[file]?.title} from launcher #${li + 1}`);
  }

  // ---- UI: inspector ---------------------------------------------------------------------------------------------
  function tubeCount(li) { const o = launcherObjs[li]; const i = o?.def?.info; return i ? (i.bone_tubes || i.tubes.length || 1) : 16; }
  function renderEntry() {
    const box = $('#fw-entry', root), e = S.sel, ls = S.show.launchers;
    const clipRow = `<div class="row"><button data-a="copy" title="Ctrl+C">Copy</button><button data-a="cut" title="Ctrl+X">Cut</button>
      <button data-a="paste" title="Ctrl+V: at the playhead" ${clip?.entries?.length ? '' : 'disabled'}>Paste${clip?.entries?.length ? ` (${clip.entries.length})` : ''}</button></div>`;
    if (!e) {
      box.innerHTML = `<div class="muted">Click a launch to edit it, or drag a box across the timeline to select several (Ctrl/Shift-click adds more).
        Drag fireworks from the list onto the timeline to add them.</div>` +
        (clip?.entries?.length ? `<div class="row"><button data-a="paste" title="Ctrl+V">Paste ${clip.entries.length} at the playhead</button></div>` : '') +
        `<div class="kbd">Ctrl+A select all · Ctrl+C/X/V copy, cut, paste · Del delete · ←/→ nudge · ↑/↓ track</div>`;
      return;
    }
    if (S.multi.size > 1) {
      const sel = selList(), t0 = Math.min(...sel.map(x => x.time)), t1 = Math.max(...sel.map(x => x.time));
      const cost = sel.reduce((a, x) => a + (FW[x.firework]?.cost || 0), 0);
      box.innerHTML = `
        <div><b>${sel.length} launches selected</b><div class="muted">${fmt(t0)} – ${fmt(t1)} · tracks ${Math.min(...sel.map(x => x.track)) + 1}–${Math.max(...sel.map(x => x.track)) + 1} · $${(cost / 100).toFixed(2)}</div></div>
        ${clipRow}
        <div class="row"><button data-a="prev" title="F: fire them with their own timing">▶ Preview</button><button data-a="dup" title="Ctrl+D: copy right after">Duplicate</button><button data-a="del" title="Delete">Delete</button><button data-a="none" title="Esc">Deselect</button></div>
        <label>Move<span class="row"><button data-a="m-1">−1 s</button><button data-a="m-0.1">−0.1</button><button data-a="m0.1">+0.1</button><button data-a="m1">+1 s</button></span></label>
        <label>Firework<select data-k="b-firework"><option value="">(keep each)</option>${data.fireworks.map(f => `<option value="${esc(f.file)}">${esc(f.title)}</option>`).join('')}</select></label>
        <label>Launcher<select data-k="b-launcher"><option value="">(keep each)</option>${ls.map((l, i) => `<option value="${i}">#${i + 1} ${esc(LAUNCHER_NAMES[l.type] || l.type)}</option>`).join('')}</select></label>
        <label>Colour<span class="row"><input type="color" data-k="b-tint" value="#ffffff" title="Tint all selected launches"><button data-a="b-notint">Original</button></span></label>
        <div class="kbd">Drag any selected launch to move them all · ←/→ nudge 0.1 s (Shift: 1 s) · ↑/↓ track</div>`;
      return;
    }
    box.innerHTML = `
      <label>Firework<select data-k="firework">${data.fireworks.map(f => `<option value="${esc(f.file)}"${f.file === e.firework ? ' selected' : ''}>${esc(f.title)}</option>`).join('')}</select></label>
      <label>Launcher<select data-k="launcher">${ls.map((l, i) => `<option value="${i}"${i === e.launcher ? ' selected' : ''}>#${i + 1} ${esc(LAUNCHER_NAMES[l.type] || l.type)}</option>`).join('')}</select></label>
      <label>Tube<select data-k="slot">${Array.from({ length: tubeCount(e.launcher) }, (_, i) => `<option value="${i}"${i === e.slot ? ' selected' : ''}>${i + 1}</option>`).join('')}</select></label>
      <label>Time (s)<input type="number" data-k="time" min="0" step="0.1" value="${e.time.toFixed(2)}"></label>
      <label>Track<input type="number" data-k="track" min="0" step="1" value="${e.track + 1}"></label>
      <label>Colour<span class="row"><input type="color" data-k="tint" value="${e.tint ? hex(e.tint) : '#ffffff'}" title="Tint this launch (new: the game can't do this)">
        <button data-a="notint" ${e.tint ? '' : 'disabled'}>Original</button></span></label>
      <div class="row"><button data-a="fire">▶ Fire now</button><button data-a="dup" title="Ctrl+D">Duplicate</button><button data-a="del" title="Delete">Delete</button></div>
      ${clipRow}
      <div class="muted">${esc(FW[e.firework]?.title)} · $${((FW[e.firework]?.cost || 0) / 100).toFixed(2)} · lasts about ${(FW[e.firework]?.duration || 0).toFixed(1)} s</div>`;
  }
  $('#fw-entry', root).addEventListener('change', ev => {
    const k = ev.target.dataset.k, e = S.sel; if (!k || !e) return;
    const v = ev.target.value;
    if (k.startsWith('b-')) {   // bulk change of every selected launch
      if (v === '') return;
      snapshot();
      for (const x of selList()) {
        if (k === 'b-firework') x.firework = v;
        if (k === 'b-launcher') { x.launcher = +v; x.slot %= tubeCount(+v); }
        if (k === 'b-tint') x.tint = unhex(v);
      }
      changed(`Changed ${S.multi.size} launches`); renderAll(); return;
    }
    snapshot();
    if (k === 'firework') e.firework = v;
    else if (k === 'launcher') { e.launcher = +v; e.slot = Math.min(e.slot, tubeCount(e.launcher) - 1); }
    else if (k === 'slot') e.slot = +v;
    else if (k === 'time') e.time = Math.max(0, +v || 0);
    else if (k === 'track') e.track = Math.max(0, (+v || 1) - 1);
    else if (k === 'tint') e.tint = unhex(v);
    changed(); renderAll();
  });
  $('#fw-entry', root).addEventListener('click', ev => {
    const a = ev.target.dataset.a, e = S.sel; if (!a) return;
    if (a === 'paste') return paste();
    if (!e) return;
    if (a === 'copy') return copySel(false);
    if (a === 'cut') return copySel(true);
    if (a === 'prev') return previewSel();
    if (a === 'none') { select([]); return markSel(); }
    if (a.startsWith('m')) return nudge(+a.slice(1), 0);
    if (a === 'b-notint') { snapshot(); for (const x of selList()) delete x.tint; changed(); renderAll(); return; }
    if (a === 'fire') { audio(); launch(e); }
    if (a === 'notint') { snapshot(); delete e.tint; changed(); renderAll(); }
    if (a === 'dup') duplicate();
    if (a === 'del') removeSel();
  });
  function renderShowInfo() {
    const sh = S.show, cost = sh.entries.reduce((a, e) => a + (FW[e.firework]?.cost || 0), 0);
    $('#fw-showinfo', root).innerHTML = `
      <label>Name<input type="text" id="fw-name" value="${esc(sh.name)}"></label>
      <div class="muted">${sh.entries.length} launches · ${sh.launchers.length} launchers · ${fmt(showEnd())} long · fireworks cost $${(cost / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>`;
    $('#fw-name', root).onchange = ev => { snapshot(); sh.name = ev.target.value || 'My show'; changed(); };
  }
  function renderLaunchers() {
    const sh = S.show;
    $('#fw-launchers', root).innerHTML = `
      <div class="lnch" style="color:var(--dim);font-size:11px"><span></span><span>Type</span><span>Col</span><span>Row</span><span>Facing</span><span></span></div>` +
      sh.launchers.map((l, i) => `<div class="lnch${i === S.selLauncher ? ' sel' : ''}" data-i="${i}">
        <span class="n">#${i + 1}</span>
        <select data-k="type">${data.launchers.map(t => `<option value="${t}"${t === l.type ? ' selected' : ''}>${esc(LAUNCHER_NAMES[t] || t)}</option>`).join('')}</select>
        <input type="number" data-k="col" value="${l.col}" step="1"><input type="number" data-k="row" value="${l.row}" step="1">
        <select data-k="dir">${['N', 'E', 'S', 'W'].map((d, k) => `<option value="${k}"${k === (l.dir || 0) ? ' selected' : ''}>${d}</option>`).join('')}</select>
        <button class="x" data-a="dell" title="Remove launcher (its launches are removed too)">✕</button></div>`).join('') +
      `<div class="row"><button data-a="addl">+ Add launcher</button></div><div class="muted">Col / Row are park tiles (4 m).</div>`;
  }
  $('#fw-launchers', root).addEventListener('change', ev => {
    const k = ev.target.dataset.k, row = ev.target.closest('.lnch'); if (!k || !row) return;
    snapshot();
    const l = S.show.launchers[+row.dataset.i], v = ev.target.value;
    if (k === 'type') l.type = v; else l[k] = Math.round(+v || 0);
    changed(); rebuildLaunchers().then(renderAll);
  });
  $('#fw-launchers', root).addEventListener('click', ev => {
    const a = ev.target.dataset.a, row = ev.target.closest('.lnch');
    if (row && !a && !ev.target.closest('select,input')) { S.selLauncher = +row.dataset.i; obj3dMarkSel(); renderLaunchers(); }
    if (a === 'addl') {
      snapshot();
      const ls = S.show.launchers, last = ls[ls.length - 1] || { row: 0, col: -2 };
      ls.push({ type: 'Mortarx16', row: last.row, col: last.col + 2, dir: 0, corner: -1 });
      S.selLauncher = ls.length - 1; changed('Launcher added'); rebuildLaunchers().then(renderAll);
    }
    if (a === 'dell' && row) {
      const i = +row.dataset.i;
      snapshot();
      S.show.launchers.splice(i, 1);
      S.show.entries = S.show.entries.filter(e => e.launcher !== i).map(e => (e.launcher > i && e.launcher--, e));
      select(selList());
      S.selLauncher = Math.max(0, Math.min(S.selLauncher, S.show.launchers.length - 1));
      changed('Launcher removed'); rebuildLaunchers().then(renderAll);
    }
  });

  // ---- UI: timeline ---------------------------------------------------------------------------------------------
  const lanes = $('#fw-lanes', root), canvas = $('#fw-canvas', root), ruler = $('#fw-ruler', root), heads = $('#fw-heads', root);
  const ph = document.createElement('div'); ph.className = 'playhead';
  const rph = document.createElement('div'); rph.className = 'rplay';
  const drop = document.createElement('div'); drop.className = 'drop';
  const band = document.createElement('div'); band.className = 'band';
  function renderTimeline() {
    const n = tracks(), w = Math.ceil(timelineEnd() * S.pps) + 200;
    root.style.setProperty('--rowh', S.rowH + 'px');
    canvas.style.width = w + 'px'; canvas.style.height = n * S.rowH + 'px';
    heads.innerHTML = Array.from({ length: n }, (_, i) => `<div class="head">Track ${i + 1}</div>`).join('');
    let html = Array.from({ length: n }, (_, i) => `<div class="lane" style="top:${i * S.rowH}px"></div>`).join('');
    S.show.entries.forEach((e, i) => {
      const fw = FW[e.firework]; if (!fw) return;
      const c = e.tint || fw.colour, wpx = Math.max(16, (fw.duration || 3) * S.pps);
      html += `<div class="ent${e === S.sel ? ' sel' : S.multi.has(e) ? ' multi' : ''}" data-i="${i}" style="left:${e.time * S.pps}px;top:${e.track * S.rowH}px;width:${wpx}px;background:${hex(c)}"
        title="${esc(fw.title)} · ${fmt(e.time)} · launcher #${e.launcher + 1} tube ${e.slot + 1}">${esc(fw.title)}<span class="tail" style="width:${Math.max(0, wpx - 2.2 * S.pps)}px"></span></div>`;
    });
    canvas.innerHTML = html; canvas.append(ph, drop, band);
    // ruler ticks: a label every 1/2/5/10 s depending on zoom
    const stepS = [0.5, 1, 2, 5, 10, 15, 30].find(s => s * S.pps >= 46) || 60;
    let r = '';
    for (let t = 0; t <= timelineEnd() + stepS; t += stepS) r += `<div class="tick" style="left:${t * S.pps}px">${fmt(t)}</div>`;
    ruler.innerHTML = `<div style="position:absolute;left:0;top:0;bottom:0;width:${w}px" id="fw-rin">${r}</div>`; ruler.append(rph);
    syncScroll(); updateTime();
  }
  function syncScroll() { const rin = $('#fw-rin', root); if (rin) rin.style.transform = `translateX(${-lanes.scrollLeft}px)`; heads.scrollTop = lanes.scrollTop; updateTime(); }
  lanes.addEventListener('scroll', syncScroll);
  function renderAll() { renderTimeline(); renderEntry(); renderShowInfo(); renderLaunchers(); }
  const timeAt = clientX => (clientX - lanes.getBoundingClientRect().left + lanes.scrollLeft) / S.pps;
  const trackAt = clientY => Math.max(0, Math.floor((clientY - lanes.getBoundingClientRect().top + lanes.scrollTop) / S.rowH));
  const snap = (t, free) => free ? t : Math.round(t * 20) / 20;
  // seek by dragging the ruler
  ruler.addEventListener('pointerdown', e => {
    ruler.setPointerCapture(e.pointerId);
    const go = ev => seek(timeAt(ev.clientX));
    go(e); ruler.onpointermove = go; ruler.onpointerup = () => { ruler.onpointermove = null; };
  });
  // select / move launches. Empty space: click moves the playhead, drag draws a box that selects the launches it
  // touches (Ctrl/Shift adds to the selection), double-click adds a firework. A launch: click selects it,
  // Ctrl/Shift-click adds or removes it, dragging moves every selected launch together.
  let lastDown = null;
  const contentXY = ev => { const r = lanes.getBoundingClientRect(); return [ev.clientX - r.left + lanes.scrollLeft, ev.clientY - r.top + lanes.scrollTop]; };
  const entryEls = () => { const m = new Map(); canvas.querySelectorAll('.ent').forEach(el => m.set(S.show.entries[+el.dataset.i], el)); return m; };
  function markSel() {
    for (const [e, el] of entryEls()) { el.classList.toggle('sel', e === S.sel); el.classList.toggle('multi', S.multi.has(e) && e !== S.sel); }
    renderEntry();
  }
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const el = e.target.closest('.ent'), add = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!el) {
      // double-click on an empty spot adds the firework picked in the list (detected here: the redraw on the first
      // click replaces the lanes, so the browser's dblclick never fires)
      const now = performance.now(), last = lastDown; lastDown = { t: now, x: e.clientX, y: e.clientY };
      if (last && now - last.t < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 6) {
        lastDown = null;
        const f = lib.querySelector('.fwk.sel')?.dataset.f || S.sel?.firework || data.fireworks[0].file;
        addEntry(f, snap(timeAt(e.clientX)), trackAt(e.clientY)); return;
      }
      const [x0, y0] = contentXY(e), before = add ? selList() : [];
      let banding = false;
      canvas.setPointerCapture(e.pointerId);
      canvas.onpointermove = ev => {
        const [x1, y1] = contentXY(ev);
        if (!banding && Math.hypot(x1 - x0, y1 - y0) < 5) return;
        banding = true;
        const L = Math.min(x0, x1), T = Math.min(y0, y1), W = Math.abs(x1 - x0), H = Math.abs(y1 - y0);
        Object.assign(band.style, { display: 'block', left: L + 'px', top: T + 'px', width: W + 'px', height: H + 'px' });
        const t0 = L / S.pps, t1 = (L + W) / S.pps, r0 = Math.floor(T / S.rowH), r1 = Math.floor((T + H) / S.rowH);
        const hit = S.show.entries.filter(x => x.track >= r0 && x.track <= r1 && x.time <= t1 &&
          x.time + Math.max(16 / S.pps, FW[x.firework]?.duration || 3) >= t0);
        select([...new Set([...before, ...hit])]);
        for (const [x, xel] of entryEls()) { xel.classList.toggle('sel', x === S.sel); xel.classList.toggle('multi', S.multi.has(x) && x !== S.sel); }
      };
      canvas.onpointerup = () => {
        canvas.onpointermove = canvas.onpointerup = null; band.style.display = 'none';
        if (banding) { lastDown = null; renderEntry(); if (S.multi.size) toast(`${S.multi.size} launch${S.multi.size > 1 ? 'es' : ''} selected`); return; }
        seek(timeAt(e.clientX)); if (!add) select([]); markSel();
      };
      return;
    }
    const ent = S.show.entries[+el.dataset.i];
    if (add) {   // Ctrl/Shift-click: add to or remove from the selection
      if (S.multi.has(ent)) { S.multi.delete(ent); select([...S.multi]); } else select([...S.multi, ent], ent);
      markSel(); return;
    }
    const wasIn = S.multi.has(ent);
    if (!wasIn) select([ent], ent); else S.sel = ent;
    S.selLauncher = ent.launcher; obj3dMarkSel(); markSel(); renderLaunchers();
    // drag: move the whole selection by the same time / track offset
    const group = selList(), orig = group.map(x => [x, x.time, x.track]), els = entryEls();
    const minT = Math.min(...group.map(x => x.time)), minTr = Math.min(...group.map(x => x.track));
    const t0 = ent.time, x0 = e.clientX, y0 = e.clientY; let moved = false;
    el.setPointerCapture(e.pointerId);
    el.onpointermove = ev => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!moved) { snapshot(); moved = true; }
      const dt = Math.max(-minT, snap(t0 + (ev.clientX - x0) / S.pps, ev.altKey) - t0);
      const dtr = Math.max(-minTr, Math.round((ev.clientY - y0) / S.rowH));
      for (const [x, ti, tr] of orig) {
        x.time = Math.max(0, ti + dt); x.track = tr + dtr;
        const xe = els.get(x); if (xe) { xe.style.left = x.time * S.pps + 'px'; xe.style.top = x.track * S.rowH + 'px'; }
      }
      el.title = fmt(ent.time);
    };
    el.onpointerup = () => {
      el.onpointermove = el.onpointerup = null;
      if (moved) { changed(group.length > 1 ? `Moved ${group.length} launches` : ''); renderAll(); }
      else if (wasIn && S.multi.size > 1) { select([ent], ent); markSel(); }   // plain click inside a group: just that one
    };
  });
  lanes.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('text/x-firework')) return;
    e.preventDefault();
    const t = snap(timeAt(e.clientX)), tr = trackAt(e.clientY);
    Object.assign(drop.style, { display: 'block', left: t * S.pps + 'px', top: tr * S.rowH + 'px', width: Math.max(16, 3 * S.pps) + 'px' });
  });
  lanes.addEventListener('dragleave', () => { drop.style.display = 'none'; });
  lanes.addEventListener('drop', e => {
    const f = e.dataTransfer.getData('text/x-firework'); drop.style.display = 'none';
    if (f) { e.preventDefault(); addEntry(f, snap(timeAt(e.clientX)), trackAt(e.clientY)); }
  });
  function addEntry(file, time, track) {
    if (!S.show.launchers.length) { toast('Add a launcher first'); return; }
    snapshot();
    const li = clamp(S.selLauncher, 0, S.show.launchers.length - 1);
    // next free tube on that launcher around this time
    const used = new Set(S.show.entries.filter(x => x.launcher === li && Math.abs(x.time - time) < 3).map(x => x.slot));
    let slot = 0; while (used.has(slot) && slot < tubeCount(li) - 1) slot++;
    const e = { firework: file, launcher: li, slot, time, track };
    S.show.entries.push(e); select([e], e);
    changed(`Added ${FW[file]?.title} at ${fmt(time)}`); renderAll();
  }
  function removeSel() {
    const sel = selList(); if (!sel.length) return;
    snapshot(); S.show.entries = S.show.entries.filter(x => !S.multi.has(x)); select([]);
    changed(sel.length > 1 ? `Deleted ${sel.length} launches` : 'Deleted'); renderAll();
  }
  function duplicate() {
    const sel = selList(); if (!sel.length) return;
    const t0 = Math.min(...sel.map(x => x.time)), t1 = Math.max(...sel.map(x => x.time));
    const off = snap(t1 - t0 + 0.5);                      // the copy starts just after the original
    snapshot();
    const copies = sel.map(x => ({ ...clone(x), time: x.time + off }));
    S.show.entries.push(...copies); select(copies);
    changed(sel.length > 1 ? `Duplicated ${sel.length} launches` : 'Duplicated'); renderAll();
  }
  // clipboard: kept in the browser, so a part of one show can be pasted into another (even after a reload)
  let clip = store.get('rct3fw.clipboard');
  function copySel(cut) {
    const sel = selList().sort((a, b) => a.time - b.time);
    if (!sel.length) { toast('Select launches first: drag a box on the timeline, or Ctrl-click'); return; }
    clip = { entries: clone(sel), launchers: Object.fromEntries(sel.map(x => [x.launcher, S.show.launchers[x.launcher]?.type])) };
    store.set('rct3fw.clipboard', clip);
    if (cut) { snapshot(); S.show.entries = S.show.entries.filter(x => !S.multi.has(x)); select([]); changed(); renderAll(); }
    else renderEntry();
    toast(`${cut ? 'Cut' : 'Copied'} ${sel.length} launch${sel.length > 1 ? 'es' : ''}${sel.length > 1 ? ` (${fmt(sel[sel.length - 1].time - sel[0].time)} long)` : ''}`);
  }
  function paste() {
    if (!clip?.entries?.length) { toast('Nothing copied yet'); return; }
    if (!S.show.launchers.length) { toast('Add a launcher first'); return; }
    // keep the launches' spacing and tracks, starting at the playhead; launchers keep their number when that launcher
    // is the same type here, else the first launcher of that type, else the selected one
    const ls = S.show.launchers, t0 = Math.min(...clip.entries.map(x => x.time)), at = snap(S.t);
    const mapL = i => {
      if (ls[i]?.type === clip.launchers[i]) return i;
      const j = ls.findIndex(l => l.type === clip.launchers[i]);
      return j >= 0 ? j : clamp(S.selLauncher, 0, ls.length - 1);
    };
    snapshot();
    const add = clip.entries.map(x => { const li = mapL(x.launcher); return { ...clone(x), launcher: li, slot: x.slot % tubeCount(li), time: +(at + x.time - t0).toFixed(3) }; });
    S.show.entries.push(...add); select(add);
    changed(`Pasted ${add.length} launch${add.length > 1 ? 'es' : ''} at ${fmt(at)}`); renderAll();
  }
  function nudge(dt, dtr) {
    const sel = selList(); if (!sel.length) return;
    const minT = Math.min(...sel.map(x => x.time)), minTr = Math.min(...sel.map(x => x.track));
    dt = Math.max(-minT, dt); dtr = Math.max(-minTr, dtr);
    if (!dt && !dtr) return;
    snapshot(); for (const x of sel) { x.time = +(x.time + dt).toFixed(3); x.track += dtr; } changed(); renderAll();
  }
  function previewSel() {   // fire the selection with its own timing, from now
    const sel = selList().sort((a, b) => a.time - b.time); if (!sel.length) return;
    audio(); const t0 = sel[0].time;
    for (const x of sel) setTimeout(() => launch(x), (x.time - t0) * 1000 / S.speed);
  }
  const zoom = k => { const mid = timeAt(lanes.getBoundingClientRect().left + lanes.clientWidth / 2); S.pps = clamp(S.pps * k, 6, 400); renderTimeline(); lanes.scrollLeft = mid * S.pps - lanes.clientWidth / 2; syncScroll(); };
  $('#fw-zin', root).onclick = () => zoom(1.5); $('#fw-zout', root).onclick = () => zoom(1 / 1.5);
  lanes.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.25 : 0.8); } }, { passive: false });

  // ---- 3D picking: click a launcher to select it ------------------------------------------------------------------
  const ray = new THREE.Raycaster(); let downAt = null;
  renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
    const hit = ray.intersectObjects(launcherGroup.children, true)[0];
    if (hit && hit.object.userData.launcher != null) { S.selLauncher = hit.object.userData.launcher; obj3dMarkSel(); renderLaunchers(); toast(`Launcher #${S.selLauncher + 1} selected`); }
  });

  // ---- bar ------------------------------------------------------------------------------------------------------------
  const showSel = $('#fw-show', root);
  function fillShows() {
    const auto = store.get('rct3fw.autosave');
    showSel.innerHTML = `<optgroup label="Game shows">${data.displays.map((d, i) => `<option value="d${i}">${esc(d.name)}</option>`).join('')}</optgroup>` +
      `<optgroup label="Yours">${auto ? `<option value="auto">${esc(auto.name || 'My show')} (autosaved)</option>` : ''}<option value="new">New empty show</option></optgroup>`;
  }
  function openChoice(v) {
    play(false);
    if (v === 'new') setShow(blank());
    else if (v === 'auto') setShow(store.get('rct3fw.autosave') || blank());
    else { const d = data.displays[+v.slice(1)]; setShow(clone({ name: d.name, music: d.music, launchers: d.launchers, entries: d.entries })); }
    S.undo = []; S.redo = [];
  }
  showSel.onchange = () => openChoice(showSel.value);
  $('#fw-new', root).onclick = () => { if (S.show.entries.length && !confirm('Start a new empty show? (The current one stays in "autosaved" until you change the new one.)')) return; showSel.value = 'new'; openChoice('new'); };
  $('#fw-save', root).onclick = () => {
    const blob = new Blob([JSON.stringify({ format: 'rct3ovl-fireworks', version: 1, ...S.show }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (S.show.name || 'show').replace(/[\\/:*?"<>|]/g, '_') + '.fireworks.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast('Saved ' + a.download);
  };
  $('#fw-open', root).onclick = () => $('#fw-file', root).click();
  $('#fw-file', root).onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!Array.isArray(j.entries) || !Array.isArray(j.launchers)) throw new Error('not a fireworks show');
      setShow({ name: j.name || f.name, music: j.music || '', launchers: j.launchers, entries: j.entries }); changed('Opened ' + f.name);
    } catch (e) { toast('Could not open: ' + e.message); }
    ev.target.value = '';
  };
  const musicSel = $('#fw-music', root);
  musicSel.innerHTML = `<option value="">No music</option>` + data.music.map(m => `<option value="${esc(m)}">♪ ${esc(m.replace(/\.wma$/i, ''))}</option>`).join('') + `<option value="__file">Choose a music file…</option>`;
  musicSel.onchange = () => {
    if (musicSel.value === '__file') { $('#fw-mfile', root).click(); musicSel.value = S.show.music || ''; return; }
    snapshot(); S.show.music = musicSel.value; changed(); setMusic(S.show.music); renderAll();
  };
  $('#fw-mfile', root).onchange = ev => {
    const f = ev.target.files[0]; if (!f) return;
    const url = URL.createObjectURL(f);
    musicSel.add(new Option('♪ ' + f.name, url)); musicSel.value = url; setMusic(url);
    musicEl.onloadedmetadata = () => renderTimeline();
    toast('Playing ' + f.name + ' with the show (not saved with it)');
  };
  $('#fw-vol', root).oninput = ev => { if (master) master.gain.value = +ev.target.value; musicEl.volume = +ev.target.value; };
  musicEl.volume = +$('#fw-vol', root).value;
  $('#fw-play', root).onclick = () => play();
  $('#fw-stop', root).onclick = () => { play(false); seek(0); lanes.scrollLeft = 0; };
  $('#fw-speed', root).onchange = ev => { S.speed = +ev.target.value; musicEl.playbackRate = S.speed; };
  $('#fw-bloom', root).onclick = ev => { useBloom = !useBloom; ev.target.classList.toggle('on', useBloom); };
  $('#fw-cam', root).onchange = ev => fitCamera(ev.target.value);
  $('#fw-back', root).onclick = () => close();
  function toast(t) { const el = $('#fw-toast', root); el.textContent = t; el.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('on'), 2200); }

  // keyboard
  function onKey(e) {
    if (root.style.display === 'none' || e.target.closest('input,select,textarea')) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); play(); }
    else if (k === 'escape') { if (S.multi.size) { select([]); markSel(); } else close(); }
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); removeSel(); }
    else if (k === 'home') { seek(0); lanes.scrollLeft = 0; }
    else if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicate(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'c') { e.preventDefault(); copySel(false); }
    else if ((e.ctrlKey || e.metaKey) && k === 'x') { e.preventDefault(); copySel(true); }
    else if ((e.ctrlKey || e.metaKey) && k === 'v') { e.preventDefault(); paste(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'a') { e.preventDefault(); select(S.show.entries.slice()); markSel(); toast(`All ${S.multi.size} launches selected`); }
    else if (k === 'arrowleft' || k === 'arrowright') { if (S.multi.size) { e.preventDefault(); nudge((k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 1 : 0.1), 0); } }
    else if (k === 'arrowup' || k === 'arrowdown') { if (S.multi.size) { e.preventDefault(); nudge(0, k === 'arrowup' ? -1 : 1); } }
    else if (k === '+' || k === '=') zoom(1.5);
    else if (k === '-') zoom(1 / 1.5);
    else if (k === 'f' && S.multi.size) previewSel();
  }
  window.addEventListener('keydown', onKey);

  // resizable side columns and timeline (remembered)
  for (const v of ['--fwl', '--fwr', '--fwt']) { const w = store.get('rct3fw' + v); if (w) root.style.setProperty(v, w + 'px'); }
  root.querySelectorAll('.colresize').forEach(h => h.addEventListener('pointerdown', e => {
    const v = h.dataset.v, x0 = e.clientX, w0 = h.parentElement.getBoundingClientRect().width, sign = v === '--fwr' ? -1 : 1;
    h.setPointerCapture(e.pointerId); h.classList.add('drag');
    h.onpointermove = ev => { const w = clamp(w0 + sign * (ev.clientX - x0), 200, window.innerWidth * 0.4); root.style.setProperty(v, w + 'px'); store.set('rct3fw' + v, w); resize(); };
    h.onpointerup = () => { h.onpointermove = null; h.classList.remove('drag'); };
  }));
  const grip = $('#fw-grip', root);
  grip.addEventListener('pointerdown', e => {
    const y0 = e.clientY, h0 = $('#fw-tl', root).getBoundingClientRect().height;
    grip.setPointerCapture(e.pointerId); grip.classList.add('drag');
    grip.onpointermove = ev => { const h = clamp(h0 - (ev.clientY - y0), 110, window.innerHeight * 0.6); root.style.setProperty('--fwt', h + 'px'); store.set('rct3fw--fwt', h); resize(); };
    grip.onpointerup = () => { grip.onpointermove = null; grip.classList.remove('drag'); };
  });

  // ---- main loop ----------------------------------------------------------------------------------------------------
  const clock = new THREE.Clock();
  let running = false, acc = 0;
  function resize() {
    const r = view.getBoundingClientRect(); if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false); composer.setSize(r.width, r.height); labels.setSize(r.width, r.height);
    bloom.resolution.set(r.width, r.height);
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(view);
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (S.playing) {
      const prev = S.t;
      S.t = musicEl.src && !musicEl.paused && Math.abs(musicEl.currentTime - (S.t + dt * S.speed)) < 0.25 ? musicEl.currentTime : S.t + dt * S.speed;
      for (const e of S.show.entries) if (!S.fired.has(e) && e.time <= S.t && e.time > prev - 0.5) { S.fired.add(e); launch(e); }
      if (S.t >= showEnd()) { play(false); }
      updateTime();
      canvas.querySelectorAll('.ent').forEach(el => { const e = S.show.entries[+el.dataset.i]; el.classList.toggle('live', !!e && e.time <= S.t && S.t < e.time + (FW[e.firework]?.duration || 3)); });
    }
    // particles: fixed 1/60 s steps, scaled by playback speed (preview fireworks run even while paused)
    acc += dt * (S.playing ? S.speed : 1);
    let n = 0; while (acc >= 1 / 60 && n++ < 8) { step(1 / 60); acc -= 1 / 60; }
    if (n >= 8) acc = 0;
    for (const o of launcherObjs) o.mixer?.update(dt * (S.playing ? S.speed : 0.3));
    if (orbit) { const a = 0.08 * dt, p = camera.position, c = controls.target; const x = p.x - c.x, z = p.z - c.z; p.x = c.x + x * Math.cos(a) - z * Math.sin(a); p.z = c.z + x * Math.sin(a) + z * Math.cos(a); }
    controls.update();
    draw();
    $('#fw-stats', root).textContent = `${parts.length.toLocaleString()} particles`;
    if (useBloom) composer.render(); else renderer.render(scene, camera);
    labels.render(scene, camera);
  }
  function start() { if (!running) { running = true; clock.getDelta(); renderer.setAnimationLoop(frame); } }
  function stop() { running = false; renderer.setAnimationLoop(null); play(false); }
  function close() { stop(); root.style.display = 'none'; ui.onBack?.(); }

  // ---- go ---------------------------------------------------------------------------------------------------------------
  renderLib(); fillShows();
  const auto = store.get('rct3fw.autosave');
  if (auto) { showSel.value = 'auto'; setShow(auto); } else { showSel.value = 'd' + Math.max(0, data.displays.findIndex(d => /stratosphere/i.test(d.name))); openChoice(showSel.value); }
  window.__fwdebug = {   // for tests/fw_debug.py
    count: () => parts.length, parts: () => parts, step, launch, FW, descInfo, S };
  return { root, resize, start, stop, onBack: null };
}

// how long a firework runs: its lifetime plus the longest chain of particles it releases
function fireworkDuration(fw) {
  const memo = {};
  const pd = id => {
    if (memo[id] != null) return memo[id];
    memo[id] = 0;
    const p = fw.nodes[id]; if (!p) return 0;
    const life = (p.Lifetime || 0) + (p.LifetimeRandom || 0);
    let m = life;
    for (const eid of p.ParticleEmitterDescs || []) { const e = fw.nodes[eid]; if (e) m = Math.max(m, (e.EndTime ?? 1) * life + (e.TimeRandom || 0) + pd(String(e.ParticleDesc))); }
    return (memo[id] = m);
  };
  return pd(fw.root);
}
