// Fireworks show editor (MixMaster): RCT3's firework displays (FireworkDisplays\*.fwd), fireworks (Fireworks\*.frw),
// lasers (Lasers\*.las) and water jets (WaterJets\*.wjt), simulated from the game's own descriptions and drawn with
// its sprites and sounds. Opened full-window from the viewer's Fireworks tab; "Back" returns to the viewer.
// Modules: fw_terrain.js (landscape, water), fw_effects.js (lasers, water jets), fw_designers.js (Advanced Laser /
// WaterJet Designer), fw_afe.js (Advanced Firework Editor, unlocked with the game's cheat name).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { createTerrain } from './fw_terrain.js';
import { createRibbons, drawLaser, jetState, jetDir, defaultLaser, defaultJet } from './fw_effects.js';

const TILE = 4, GRAVITY = 9.81, MAX_PARTICLES = 40000, MAX_VOICES = 40, D2R = Math.PI / 180;
const LAUNCHER_NAMES = { Mortarx1: 'Mortar ×1', Mortarx16: 'Mortar ×16', MortarWallx8: 'Wall ×8',
  CWFW: 'Cath. wheel', LazerDome: 'Laser dome', WaterJet: 'Water jet' };
const KINDS = { firework: { tab: 'Fireworks', one: 'firework', icon: '' }, laser: { tab: 'Lasers', one: 'laser', icon: '✦ ' },
                jet: { tab: 'Water Jets', one: 'water jet', icon: '≈ ' } };
const fits = (kind, type) => kind === 'laser' ? type === 'LazerDome' : kind === 'jet' ? type === 'WaterJet' : type !== 'LazerDome' && type !== 'WaterJet';
const BASE_FOR = { firework: 'Mortarx16', laser: 'LazerDome', jet: 'WaterJet' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fmt = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
const hex = c => '#' + c.slice(0, 3).map(x => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
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
        grid-template-columns: var(--fwl, 280px) minmax(0, 1fr) var(--fwr, 330px); grid-template-rows: auto minmax(0, 1fr) var(--fwt, 260px); }
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
  #fw .ptabs { display: flex; gap: 4px; padding: 10px 10px 6px; }
  #fw .ptabs button { flex: 1; padding: 5px 2px; font-size: 12px; white-space: nowrap; }
  #fw .ptabs button.on { background: var(--sel); border-color: var(--accent); color: var(--accent); }
  #fw .create { padding: 0 10px 6px; display: flex; gap: 6px; } #fw .create button { flex: 1; font-size: 12px; }
  #fw .lib { padding: 2px 6px 10px; }
  #fw .libgrp { padding: 8px 6px 2px; font-size: 10px; text-transform: uppercase; color: var(--dim); letter-spacing: .5px; }
  #fw .fwk { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 6px; cursor: grab; user-select: none; }
  #fw .fwk:hover { background: var(--panel2); } #fw .fwk.sel { background: var(--sel); }
  #fw .sw { width: 12px; height: 12px; border-radius: 3px; flex: none; box-shadow: 0 0 6px currentColor; }
  #fw .fwk .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #fw .fwk .cost { color: var(--dim); font-size: 11px; }
  #fw .fwk .pv, #fw .fwk .ed { padding: 1px 6px; font-size: 11px; }
  #fw .view { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: #03050b; }
  #fw .view canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  #fw .view .lbl { font: 600 11px system-ui; color: #fff; background: #000a; padding: 1px 5px; border-radius: 4px; pointer-events: none; white-space: nowrap; }
  #fw .view .lbl.sel { background: var(--accent); color: #000; }
  #fw .view .lbl.aim { background: #3fbf5f; color: #000; }
  #fw .view .hint { position: absolute; left: 10px; bottom: 8px; color: #8890a0; font-size: 11px; pointer-events: none; }
  #fw .view .stats { position: absolute; right: 10px; top: 8px; color: #8890a0; font: 11px ui-monospace, Consolas, monospace; pointer-events: none; text-align: right; }
  #fw .land { position: absolute; left: 10px; top: 10px; background: #0b0f18ee; border: 1px solid var(--line); border-radius: 8px; padding: 10px;
              display: none; gap: 7px; flex-direction: column; width: 236px; z-index: 4; font-size: 12px; }
  #fw .land.on { display: flex; }
  #fw .land b { color: var(--accent); font-size: 12px; }
  #fw .land .tools { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
  #fw .land .tools button { padding: 4px 2px; font-size: 12px; } #fw .land .tools button.on { background: var(--sel); border-color: var(--accent); }
  #fw .land label { display: grid; grid-template-columns: 74px 1fr; align-items: center; gap: 6px; color: var(--dim); }
  #fw .insp { padding: 4px 12px 14px; display: grid; gap: 7px; }
  #fw .insp label { display: grid; grid-template-columns: 82px 1fr; align-items: center; gap: 6px; color: var(--dim); font-size: 12px; }
  #fw .insp input[type=number], #fw .insp input[type=text], #fw .insp input[type=time], #fw .insp select { width: 100%; min-width: 0; background: var(--bg); color: var(--text);
        border: 1px solid var(--line); border-radius: 6px; padding: 4px 6px; font: inherit; }
  #fw .insp .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  #fw .insp .muted { color: var(--dim); font-size: 12px; }
  #fw .insp .kbd { font: 11px ui-monospace, Consolas, monospace; color: var(--dim); }
  #fw .months { display: grid; grid-template-columns: repeat(6, 1fr); gap: 3px; }
  #fw .months button { padding: 2px 0; font-size: 11px; } #fw .months button.on { background: var(--sel); border-color: var(--accent); color: var(--accent); }
  #fw .lnch { display: grid; grid-template-columns: 22px minmax(92px, 1fr) 42px 42px 48px 22px; gap: 4px; align-items: center; padding: 3px 0; }
  #fw .lnch.sel { background: var(--sel); border-radius: 6px; }
  #fw .lnch input, #fw .lnch select { padding: 2px 4px !important; font-size: 12px !important; }
  #fw .lnch .n { color: var(--dim); text-align: right; font-size: 11px; }
  #fw .x { padding: 0 5px; line-height: 18px; color: var(--dim); }
  #fw .tl { grid-column: 1 / -1; display: grid; grid-template-columns: 74px minmax(0, 1fr); grid-template-rows: 26px 20px minmax(0, 1fr);
            border-top: 1px solid var(--line); background: var(--panel); position: relative; min-height: 0; }
  #fw .tl .grip { position: absolute; left: 0; right: 0; top: -4px; height: 8px; cursor: row-resize; z-index: 5; }
  #fw .tl .grip:hover, #fw .tl .grip.drag { background: linear-gradient(transparent 3px, var(--accent) 3px, var(--accent) 5px, transparent 5px); }
  #fw .tl .corner { background: var(--panel2); border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); display: flex; align-items: center; justify-content: center; gap: 2px; }
  #fw .tl .corner button { padding: 0 5px; font-size: 12px; line-height: 18px; }
  #fw .tl .ruler { position: relative; overflow: hidden; background: var(--panel2); border-bottom: 1px solid var(--line); cursor: ew-resize; }
  #fw .tl .ruler .tick { position: absolute; top: 0; bottom: 0; border-left: 1px solid var(--line); font: 10px ui-monospace, Consolas, monospace; color: var(--dim); padding: 2px 3px; }
  #fw .tl .aimhead { font-size: 10px; color: var(--dim); display: flex; align-items: center; padding-left: 8px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); background: var(--panel2); }
  #fw .tl .aimbar { position: relative; overflow: hidden; border-bottom: 1px solid var(--line); background: #ffffff06; cursor: copy; }
  #fw .tl .aimbar .key { position: absolute; top: 3px; width: 12px; height: 13px; margin-left: -6px; background: #5a6070; clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%); cursor: ew-resize; }
  #fw .tl .aimbar .key.mine { background: #ffd23e; } #fw .tl .aimbar .key.sel { background: #fff; }
  #fw .tl .heads { overflow: hidden; border-right: 1px solid var(--line); }
  #fw .tl .head { height: var(--rowh); display: flex; align-items: center; padding-left: 8px; font-size: 11px; color: var(--dim); border-bottom: 1px solid #ffffff08; }
  #fw .tl .lanes { position: relative; overflow: auto; }
  #fw .tl .canvas { position: relative; }
  #fw .tl .lane { position: absolute; left: 0; right: 0; height: var(--rowh); border-bottom: 1px solid #ffffff08; }
  #fw .tl .lane:nth-child(odd) { background: #ffffff04; }
  #fw .tl .ent { position: absolute; height: calc(var(--rowh) - 6px); margin-top: 3px; border-radius: 5px; font-size: 11px; padding: 0 6px; display: flex; align-items: center;
                 overflow: hidden; white-space: nowrap; cursor: grab; color: #0a0d14; font-weight: 600; box-shadow: inset 0 0 0 1px #0006; user-select: none; }
  #fw .tl .ent.k-laser { border-radius: 2px; background-image: linear-gradient(90deg, #ffffff40, transparent 30%); }
  #fw .tl .ent.k-jet { border-radius: 9px; }
  #fw .tl .ent .tail { position: absolute; right: 0; top: 0; bottom: 0; background: linear-gradient(90deg, transparent, #0005); pointer-events: none; }
  #fw .tl .ent.sel { box-shadow: 0 0 0 2px #fff, 0 0 10px #fff8; z-index: 2; }
  #fw .tl .ent.multi { box-shadow: 0 0 0 2px var(--accent), 0 0 8px #ffb02e88; z-index: 2; }
  #fw .tl .ent.live { filter: brightness(1.35); }
  #fw .tl .playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: #ff5050; pointer-events: none; z-index: 3; box-shadow: 0 0 6px #ff5050; }
  #fw .tl .rplay { position: absolute; top: 0; bottom: 0; width: 2px; background: #ff5050; pointer-events: none; }
  #fw .tl .band { position: absolute; border: 1px solid var(--accent); background: #ffb02e22; pointer-events: none; display: none; z-index: 4; }
  #fw .tl .drop { position: absolute; height: var(--rowh); border: 1px dashed var(--accent); border-radius: 5px; pointer-events: none; display: none; }
  #fw .toast { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); background: #000c; color: #fff; padding: 6px 12px; border-radius: 8px; font-size: 12px; pointer-events: none; opacity: 0; transition: opacity .3s; z-index: 70; }
  #fw .toast.on { opacity: 1; }
  #fw .colresize { position: absolute; top: 0; bottom: 0; width: 8px; cursor: col-resize; z-index: 6; }
  #fw .colresize:hover, #fw .colresize.drag { background: linear-gradient(90deg, transparent 3px, var(--accent) 3px, var(--accent) 5px, transparent 5px); }
  #fw .dlg { position: fixed; inset: 0; background: #0009; display: flex; align-items: center; justify-content: center; z-index: 80; }
  #fw .dlg .box { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; width: min(480px, 92vw); display: grid; gap: 10px; font-size: 13px; }
  #fw .dlg .box h4 { margin: 0; color: var(--accent); font-size: 15px; }
  #fw .dlg .box ul { margin: 0; padding-left: 18px; color: var(--dim); }
  #fw .dlg .box .row { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
  #fw .dlg .box input[type=text] { background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; font: inherit; }
  #fw.afe .side, #fw.afe .tl { display: none !important; }
  @media (max-width: 900px) { #fw { grid-template-columns: 1fr; grid-template-rows: auto 40vh 1fr 1fr 260px; } #fw .side, #fw .side.right { border: 0; } }
  `;
  document.head.appendChild(css);
  const root = document.createElement('div'); root.id = 'fw';
  root.innerHTML = `
  <div class="bar">
    <button class="back" id="fw-back" title="Back to the viewer (Esc)">← Back</button>
    <h2>MixMaster</h2>
    <select id="fw-show" title="Open a show"></select>
    <button id="fw-new" title="Start an empty show">New</button>
    <button id="fw-open" title="Open a show saved from this editor (.json)">Open…</button>
    <button id="fw-save" title="Download this show (.json) to open again later">Save</button>
    <button id="fw-export" title="Save this show for RollerCoaster Tycoon 3 (.fwd)">Export to RCT3…</button>
    <input type="file" id="fw-file" accept=".json,application/json" hidden>
    <span class="sep"></span>
    <button class="big play" id="fw-play" title="Play / pause (Space)">▶ Play</button>
    <button id="fw-stop" title="Stop and rewind (Home)">■</button>
    <span class="time" id="fw-time">0:00.0 / 0:00.0</span>
    <select id="fw-speed" title="Playback speed"><option value="0.25">¼×</option><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select>
    <span class="sep"></span>
    <select id="fw-music" title="Music played with the show"></select>
    <input type="file" id="fw-mfile" accept="audio/*" hidden>
    <label title="Volume" style="display:flex;align-items:center;gap:4px;color:var(--dim);font-size:12px">🔊<input type="range" id="fw-vol" min="0" max="1" step="0.05" value="0.7" style="width:80px"></label>
    <span class="grow"></span>
    <button id="fw-land" title="Shape the ground and add water">Landscape</button>
    <button id="fw-bloom" class="on" title="Glow effect">Glow</button>
    <select id="fw-cam" title="Camera"><option value="crowd">Crowd view</option><option value="auto">Autolook</option><option value="close">Close up</option><option value="top">Top down</option><option value="orbit">Slow orbit</option><option value="free">Freelook</option></select>
  </div>
  <div class="side">
    <div class="ptabs" id="fw-ptabs">${Object.entries(KINDS).map(([k, v]) => `<button data-k="${k}">${v.tab}</button>`).join('')}</div>
    <div class="create" id="fw-create"></div>
    <div style="padding:0 10px 6px"><input type="search" id="fw-search" placeholder="Search" style="width:100%"></div>
    <div class="scroll"><div class="lib" id="fw-lib"></div></div>
    <div style="padding:8px 12px;color:var(--dim);font-size:11px;border-top:1px solid var(--line);display:flex;gap:8px;align-items:center">
      <span style="flex:1">▶ preview · ✎ edit · drag onto the timeline</span><button id="fw-reload" title="Reload all effects (new files in the game folder)" style="font-size:11px;padding:2px 6px">↻ Reload</button></div>
    <div class="colresize" data-v="--fwl" style="right:-4px"></div>
  </div>
  <div class="view" id="fw-view"><div class="stats" id="fw-stats"></div>
    <div class="land" id="fw-landp">
      <b>Landscape</b>
      <div class="tools">
        <button data-t="raise">Raise</button><button data-t="lower">Lower</button><button data-t="smooth">Smooth</button>
        <button data-t="flatten">Flatten</button><button data-t="water">Water</button><button data-t="dry">Dry</button>
      </div>
      <label>Brush<input type="range" id="fw-bsize" min="1" max="14" step="0.5" value="4"></label>
      <label>Strength<input type="range" id="fw-bstr" min="0.1" max="3" step="0.1" value="1"></label>
      <label>Water level<input type="number" id="fw-wlevel" value="0" step="0.5" style="width:100%"></label>
      <div class="row" style="display:flex;gap:6px"><button id="fw-flatall" style="flex:1">Flatten all</button><button id="fw-dryall" style="flex:1">Remove water</button></div>
      <div style="color:var(--dim);font-size:11px">Left-drag on the ground to use the tool · right-drag to pan · click the tool again to stop</div>
    </div>
    <div class="hint" id="fw-hint">Drag to orbit · right-drag to pan · wheel to zoom · click a launcher to select it</div><div class="toast" id="fw-toast"></div></div>
  <div class="side right">
    <div class="colresize" data-v="--fwr" style="left:-4px"></div>
    <div class="scroll">
      <div id="fw-aimsec" style="display:none"><h3>Aiming control point</h3><div class="insp" id="fw-aim"></div></div>
      <h3>Selected effect</h3><div class="insp" id="fw-entry"></div>
      <h3>Show</h3><div class="insp" id="fw-showinfo"></div>
      <h3>Launchers</h3><div class="insp" id="fw-launchers"></div>
    </div>
  </div>
  <div class="tl" id="fw-tl">
    <div class="grip" id="fw-grip" title="Drag to resize the timeline"></div>
    <div class="corner"><button id="fw-zout" title="Decrease the time scale (-)">−</button><button id="fw-zin" title="Increase the time scale (+)">+</button></div>
    <div class="ruler" id="fw-ruler"></div>
    <div class="aimhead" title="Base aiming controls: click to add an angle control point for the selected launcher; right-click one to remove it">Aiming</div>
    <div class="aimbar" id="fw-aimbar"></div>
    <div class="heads" id="fw-heads"></div>
    <div class="lanes" id="fw-lanes"><div class="canvas" id="fw-canvas"></div></div>
  </div>`;
  document.body.appendChild(root);

  // ---- data: the game's effects and yours (kept in this browser, and embedded in shows that use them) -----------
  let data = await (await fetch('/api/fw/data')).json();
  const REG = { firework: {}, laser: {}, jet: {} };
  const FW = REG.firework;
  const mine = Object.assign({ firework: {}, laser: {}, jet: {} }, store.get('rct3fw.mine') || {});
  function prepDef(kind, d, key) {
    d.kind = kind; d.key = key; d.title = d.title || d.name || key;
    if (kind === 'firework') d.duration = fireworkDuration(d);
    else d.colour_sw = (d.colour?.pts?.[Math.floor((d.colour.pts.length - 1) / 2)]?.v || [0.6, 0.5, 1, 1]).slice(0, 3);
    return d;
  }
  function loadRegistry() {
    for (const k of Object.keys(REG)) for (const x of Object.keys(REG[k])) delete REG[k][x];
    for (const f of data.fireworks) REG.firework[f.file] = prepDef('firework', f, f.file);
    for (const d of data.lasers) REG.laser[d.file] = prepDef('laser', d, d.file);
    for (const d of data.jets) REG.jet[d.file] = prepDef('jet', d, d.file);
    for (const k of Object.keys(REG)) for (const [key, d] of Object.entries(mine[k] || {})) REG[k][key] = prepDef(k, d, key);
  }
  loadRegistry();
  const fx = e => REG[e.kind || 'firework']?.[e.firework];
  const fxDur = e => fx(e)?.duration || 3;
  const swatch = d => d ? (d.kind === 'firework' ? d.colour : d.colour_sw) : [0.5, 0.5, 0.5];
  function saveMine(kind, def, key) {
    key = key || 'my:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const clean = JSON.parse(JSON.stringify(def)); delete clean.key; delete clean._flags;
    mine[kind][key] = clean; store.set('rct3fw.mine', mine);
    REG[kind][key] = prepDef(kind, JSON.parse(JSON.stringify(clean)), key);
    descCache.clear(); renderLib(); renderTimeline();
    return key;
  }
  function deleteMine(kind, key) { delete mine[kind][key]; store.set('rct3fw.mine', mine); delete REG[kind][key]; renderLib(); }
  const S = { show: null, sel: null, selLauncher: 0, selAim: null, t: 0, playing: false, speed: 1, pps: 40, rowH: 26, undo: [], redo: [],
              fired: new Set(), multi: new Set(), tab: 'firework' };

  // ---- three.js scene --------------------------------------------------------------------------------------
  const view = $('#fw-view', root);
  const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  view.prepend(renderer.domElement);
  const labels = new CSS2DRenderer(); labels.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  view.appendChild(labels.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03050b);
  scene.fog = new THREE.Fog(0x03050b, 250, 900);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 4000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495;
  scene.add(new THREE.HemisphereLight(0x8090c0, 0x101810, 0.9));
  const moon = new THREE.DirectionalLight(0xbfd0ff, 1.2); moon.position.set(-60, 120, 80); scene.add(moon);
  const terrain = createTerrain(scene);
  {
    const n = 1500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, e = Math.random() * 1.3 + 0.08, r = 1500;
      pos.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xaab4ff, size: 1.6, sizeAttenuation: false, fog: false })));
  }
  // the composer's buffers need a stencil: reflections are drawn only where the water mask wrote 1
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, stencilBuffer: true }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.1, 0.55, 0.12);
  composer.addPass(bloom); composer.addPass(new OutputPass());
  let useBloom = true;
  const ribbons = createRibbons(scene);

  // ---- particle rendering: instanced camera-facing quads, stretched along velocity (+ a mirrored copy on water) ----
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
    const mat = mirror => new THREE.ShaderMaterial({
      // glowing particles: the game's flare sprites keep their glow in RGB with alpha 0, drawn additively (one + one)
      uniforms: { map: { value: page }, level: { value: 0 }, gain: { value: mirror ? 0.35 : 1 } }, transparent: true, depthWrite: false, depthTest: !mirror,
      ...(additive ? { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation }
                   : { blending: THREE.NormalBlending }),
      ...(mirror ? { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp } : {}),
      defines: Object.assign(additive ? { ADDITIVE: 1 } : {}, mirror ? { MIRROR: 1 } : {}),
      vertexShader: `attribute vec3 iPos; attribute vec3 iVel; attribute vec2 iSize; attribute vec4 iCol; attribute vec4 iUV;
        uniform float level; varying vec2 vUv; varying vec4 vCol;
        void main() {
          vec3 P = iPos, V = iVel;
        #ifdef MIRROR
          P.y = 2.0 * level - P.y; V.y = -V.y;
        #endif
          vec4 c = modelViewMatrix * vec4(P, 1.0);
          vec3 v = (modelViewMatrix * vec4(V, 0.0)).xyz;
          float L = length(v.xy);
          vec2 ax = L > 1e-4 ? v.xy / L : vec2(1.0, 0.0);
          vec2 ay = vec2(-ax.y, ax.x);
          c.xy += ax * position.x * (iSize.x + iSize.y) + ay * position.y * iSize.x;
          gl_Position = projectionMatrix * c;
          vUv = mix(iUV.xy, iUV.zw, position.xy + 0.5);
          vCol = iCol;
        }`,
      fragmentShader: `uniform sampler2D map; uniform float gain; varying vec2 vUv; varying vec4 vCol;
        void main() {
          vec4 t = texture2D(map, vUv);
        #ifdef ADDITIVE
          gl_FragColor = vec4(t.rgb * vCol.rgb * vCol.a * gain, 1.0);
        #else
          gl_FragColor = vec4(t.rgb * vCol.rgb, t.a * vCol.a * gain); if (gl_FragColor.a < 0.003) discard;
        #endif
        }`,
    });
    const mesh = new THREE.Mesh(g, mat(false)); mesh.frustumCulled = false; mesh.renderOrder = 4; g.instanceCount = 0; scene.add(mesh);
    const mirror = new THREE.Mesh(g, mat(true)); mirror.frustumCulled = false; mirror.renderOrder = 2; mirror.visible = false; scene.add(mirror);
    return { g, at, mesh, mirror };
  }
  const layers = { add: makeLayer(true), blend: makeLayer(false) };

  // ---- particle simulation (the game's ParticleDesc / ParticleEmitterDesc tree) ------------------------------
  // Per launch: strength scales how many particles emitters release (those marked "Use Strength Modifier"; for
  // fireworks with none marked, every emitter of 8 or more), colour tints the particles marked "Use Color Modifier"
  // (or, for fireworks with none marked, all of them).
  const descCache = new Map();
  function fwFlags(fw) {
    if (!fw._flags) {
      let anyS = false, anyC = false;
      for (const n of Object.values(fw.nodes)) { if (n.kind === 'emitter' && n.NumParticlesModifierEnable) anyS = true; if (n.kind === 'particle' && n.ColourModifierEnable) anyC = true; }
      fw._flags = { anyS, anyC };
    }
    return fw._flags;
  }
  function descInfo(fw, id) {
    const key = fw.key + '/' + id;
    let d = descCache.get(key);
    if (d) return d;
    const n = fw.nodes[id] || {}, fl = fwFlags(fw);
    const sp = n.TextureNameReduced ? data.sprites[n.TextureNameReduced] : null;
    const curve = c => c ? { t: c[Object.keys(c).find(k => k.endsWith('Times'))] || [], v: c[Object.keys(c).find(k => k.endsWith('Values'))] || [] } : { t: [], v: [] };
    const A = curve(n.ColourA);
    d = { n, fw, life: n.Lifetime || 0, lifeR: n.LifetimeRandom || 0, s0: n.StartSize ?? 1, s1: n.EndSize ?? 1, sR: n.SizeRandom || 0,
      drag: n.Drag || 0, grav: n.GravityScale || 0, stretch: n.VelStretch || 0, sound: n.SoundName || '',
      sndMin: n.SoundMinDist || 70, sndMax: n.SoundMaxDist || 300, spin: n.CameraSpinRate || 0,
      R: curve(n.ColourR), G: curve(n.ColourG), B: curve(n.ColourB),
      additive: !A.v.length || Math.max(...A.v) < 0.5,
      useMod: !!n.ColourModifierEnable, anyC: fl.anyC,
      uv: sp ? [sp.rect[0], 1 - sp.rect[3], sp.rect[2], 1 - sp.rect[1]] : null,
      emitters: (n.ParticleEmitterDescs || []).map(eid => fw.nodes[eid]).filter(Boolean).map(e => ({
        N: e.NumParticles || 0, a: e.StartTime ?? 0, b: e.EndTime ?? 1, speed: e.ParticleSpeed || 0, sr: e.SpeedRandom || 0,
        src: e.SpeedRandomCircle || 0, pr: e.PositionRandom || 0, prc: e.PositionRandomCircle || 0, psf: e.ParentSpeedFactor || 0,
        rel: !!e.ParticleRelative, tr: e.TimeRandom || 0, desc: String(e.ParticleDesc),
        useS: !!e.NumParticlesModifierEnable || (!fl.anyS && (e.NumParticles || 0) >= 8),
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
  function spawn(d, x, y, z, vx, vy, vz, h, parent, mods) {
    if (parts.length >= MAX_PARTICLES) return null;
    const p = { d, x, y, z, vx, vy, vz, h, age: 0, life: Math.max(1e-3, d.life + Math.random() * d.lifeR), em: new Float32Array(d.emitters.length),
                r0: Math.random(), parent, mods, delays: d.emitters.map(e => e.tr ? Math.random() * e.tr : 0) };
    parts.push(p);
    if (d.sound && !silent) playSound(d.sound, x, y, z, d.sndMin, d.sndMax);
    return p;
  }
  function emit(p, f) {
    const es = p.d.emitters, strength = p.mods?.strength ?? 1;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      const N = e.useS ? Math.max(0, Math.round(e.N * strength)) : e.N;
      if (!N) continue;
      const ff = f - p.delays[i] / p.life;
      let target = e.b <= e.a ? (ff >= e.a ? N : 0) : N * clamp((ff - e.a) / (e.b - e.a), 0, 1);
      if (f >= 1 && ff >= e.a) target = N;
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
        if (!spawn(cd, x, y, z, vx, vy, vz, h, e.rel ? p : null, p.mods)) return;
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
      if (d.emitters.length) emit(p, Math.min(1, p.age / p.life));
    }
    let j = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.age < p.life && p.y > -40 && !(p.d.water && p.vy < 0 && p.y < terrain.heightAt(p.x, p.z))) parts[j++] = p;
    }
    parts.length = j;
  }
  function draw() {
    const cnt = { add: 0, blend: 0 };
    for (const p of parts) {
      const d = p.d;
      if (!d.uv) continue;
      const k = d.additive ? 'add' : 'blend', l = layers[k], i = cnt[k]++;
      const f = Math.min(1, p.age / p.life);
      const size = (d.s0 + (d.s1 - d.s0) * f) * (1 + d.sR * (p.r0 - 0.5) * 2);
      let r = curveAt(d.R, f), g = curveAt(d.G, f), b = curveAt(d.B, f);
      const m = p.mods;
      if (m) {
        const c = d.useMod ? m.cmod : (!d.anyC ? m.tint : null);
        if (c) { r *= c[0]; g *= c[1]; b *= c[2]; }
      }
      const sp = Math.hypot(p.vx, p.vy, p.vz);
      l.at.pos.array.set([p.x, p.y, p.z], i * 3);
      l.at.vel.array.set([p.vx, p.vy, p.vz], i * 3);
      l.at.size.array.set([size, sp * d.stretch], i * 2);
      l.at.col.array.set([r, g, b, d.additive ? (d.gain ?? 1) : (1 - f * 0.6)], i * 4);
      l.at.uv.array.set(d.uv, i * 4);
    }
    for (const k of ['add', 'blend']) {
      const l = layers[k]; l.g.instanceCount = cnt[k];
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
    const dist = x == null ? 0 : camera.position.distanceTo(new THREE.Vector3(x, y, z));
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
    return [Math.round((x0 + x1) / 2), Math.round((z0 + z1) / 2)];
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
      launcherGroup.add(obj);
      const el = document.createElement('div'); el.className = 'lbl'; el.textContent = '#' + (i + 1);
      const label = new CSS2DObject(el); label.position.set(0, 3.2, 0); obj.add(label);
      let mixer = null;
      if (def?.gltf.animations?.length) { mixer = new THREE.AnimationMixer(obj); mixer.clipAction(def.gltf.animations[0]).play(); }
      obj.traverse(o => { o.userData.launcher = i; });
      return { obj, def, label, mixer };
    });
    placeAll(); obj3dMarkSel();
  }
  function placeLauncher(obj, l) {
    const cx = ((l.corner ?? -1) >= 0 && /mortarx1$|waterjet|lazerdome/i.test(l.type)) ? [[-1, -1], [1, -1], [1, 1], [-1, 1]][l.corner & 3] : [0, 0];
    const x = (l.col - centre[0]) * TILE + cx[0], z = (l.row - centre[1]) * TILE + cx[1];
    obj.position.set(x, terrain.heightAt(x, z), z);
  }
  function placeAll() { launcherObjs.forEach((o, i) => S.show.launchers[i] && placeLauncher(o.obj, S.show.launchers[i])); applyAims(S.t); }
  // base aiming: control points {t, yaw, pitch (degrees), launchers: [indices]} on the aiming bar. A launcher points
  // the way its first control point says until then, follows the points in between, and holds the last one.
  function aimAt(li, t) {
    const ks = (S.show.aim || []).filter(k => k.launchers.includes(li)).sort((a, b) => a.t - b.t);
    if (!ks.length) return { yaw: 0, pitch: 0 };
    if (t <= ks[0].t) return ks[0];
    for (let i = 1; i < ks.length; i++) if (t <= ks[i].t) {
      const k = (t - ks[i - 1].t) / Math.max(1e-6, ks[i].t - ks[i - 1].t);
      return { yaw: ks[i - 1].yaw + (ks[i].yaw - ks[i - 1].yaw) * k, pitch: ks[i - 1].pitch + (ks[i].pitch - ks[i - 1].pitch) * k };
    }
    return ks[ks.length - 1];
  }
  function applyAims(t) {
    launcherObjs.forEach((o, i) => {
      const l = S.show.launchers[i]; if (!l) return;
      const a = aimAt(i, t);
      o.obj.rotation.set(a.pitch * D2R, -(l.dir || 0) * Math.PI / 2 + a.yaw * D2R, 0, 'YXZ');
      o.obj.updateMatrixWorld(true);
    });
  }
  function obj3dMarkSel() {
    const aimed = new Set(S.selAim ? S.selAim.launchers : []);
    launcherObjs.forEach((o, i) => { o.label.element.classList.toggle('sel', i === S.selLauncher); o.label.element.classList.toggle('aim', aimed.has(i)); });
  }
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
  // where a laser / water jet leaves its base, and the base's orientation (including aiming)
  const previewBase = new THREE.Object3D(); scene.add(previewBase);
  function frameOf(li) {
    const o = launcherObjs[li];
    if (!o) {
      previewBase.position.set(0, terrain.heightAt(0, 0) + 1, 0); previewBase.updateMatrixWorld(true);
      return { O: previewBase.position.clone(), q: new THREE.Quaternion() };
    }
    const [p, d] = tubeWorld(li, 0);
    return { O: p.clone().addScaledVector(d, 0.8), q: o.obj.getWorldQuaternion(new THREE.Quaternion()) };
  }
  function modsOf(entry, fw) {
    const base = fw.nodes[fw.root] || {};
    const cmod = entry.tint || (base.ColourModifierR != null ? [base.ColourModifierR, base.ColourModifierG, base.ColourModifierB] : null);
    return { tint: entry.tint || null, cmod, strength: entry.strength ?? base.StrengthModifier ?? 1 };
  }
  function launch(entry, quiet) {   // fireworks fire once; lasers and water jets run from their start time (see frame)
    if ((entry.kind || 'firework') !== 'firework') return;
    const fw = fx(entry);
    if (!fw) return;
    const tw = tubeWorld(entry.launcher, entry.slot) || [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0)];
    const [p, h] = tw;
    silent = !!quiet;
    spawn(descInfo(fw, fw.root), p.x, p.y, p.z, 0, 0, 0, [h.x, h.y, h.z], null, modsOf(entry, fw));
    silent = false;
  }
  // previews: effects fired outside the timeline (palette ▶, designers); they run on their own clock
  let previews = [], pclock = 0;
  function fireNow(entry, opts = {}) {
    const kind = entry.kind || 'firework', def = opts.def || fx(entry);
    if (!def) return null;
    if (kind === 'firework') {
      if (opts.def) {
        const fw = opts.def; const tw = tubeWorld(entry.launcher, entry.slot) || [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0)];
        spawn(descInfo(fw, fw.root), tw[0].x, tw[0].y, tw[0].z, 0, 0, 0, [tw[1].x, tw[1].y, tw[1].z], null, modsOf(entry, fw));
      } else launch(entry);
      return null;
    }
    const pv = { kind, def, entry, t0: pclock, loop: !!opts.loop };
    previews.push(pv);
    return { stop() { previews = previews.filter(x => x !== pv); }, set(d) { pv.def = d; }, restart() { pv.t0 = pclock; }, time: () => pclock - pv.t0 };
  }
  // water jets as particles (a synthetic particle description per colour / size / pressure)
  const jetDescs = new Map(), jetAcc = new WeakMap();
  const flareUV = () => { const sp = data.sprites.Flare_00; return sp ? [sp.rect[0], 1 - sp.rect[3], sp.rect[2], 1 - sp.rect[1]] : null; };
  function jetDesc(col, radius, pressure) {
    const key = col.map(x => Math.round(x * 12)).join(',') + '|' + Math.round(radius * 8) + '|' + Math.round(pressure);
    let d = jetDescs.get(key);
    if (!d) {
      d = { n: {}, fw: null, life: 2 * pressure / GRAVITY + 0.4, lifeR: 0.3, s0: 0.3 + 0.4 * radius, s1: 0.7 + 1.3 * radius, sR: 0.4, drag: 0.15, grav: 1,
            stretch: 0.05, sound: '', R: { t: [], v: [col[0]] }, G: { t: [], v: [col[1]] }, B: { t: [], v: [col[2]] }, additive: true,
            gain: 0.75 * (col[3] ?? 1), useMod: false, anyC: false, uv: flareUV(), emitters: [], water: true };
      jetDescs.set(key, d);
    }
    return d;
  }
  function jetEmit(def, tau, dt, li, holder, tint) {
    const st = jetState(def, tau);
    if (!st || st.pressure < 0.3) return;
    const fr = frameOf(li), dir = jetDir(st.elev, fr.q);
    let acc = (jetAcc.get(holder) || 0) + dt * 240 * Math.min(2.5, st.radius + 0.5);
    const n = Math.floor(acc); jetAcc.set(holder, acc - n);
    let c = st.colour; if (tint) c = [c[0] * tint[0], c[1] * tint[1], c[2] * tint[2], c[3]];
    const d = jetDesc(c, st.radius, st.pressure);
    for (let k = 0; k < n; k++) {
      const s = randUnit(), v = st.pressure * (0.93 + 0.07 * Math.random()), j = 0.25 + 0.4 * st.radius;
      spawn(d, fr.O.x, fr.O.y, fr.O.z, dir.x * v + s[0] * j, dir.y * v + s[1] * j, dir.z * v + s[2] * j, [dir.x, dir.y, dir.z], null, null);
    }
  }
  function effectsStep(t, dt) {   // water jets on the timeline and in previews
    if (S.show) for (const e of S.show.entries) {
      if (e.kind !== 'jet') continue;
      const def = fx(e); if (!def) continue;
      const tau = t - e.time; if (tau < 0 || tau > def.duration) continue;
      jetEmit(def, tau, dt, e.launcher, e, e.tint);
    }
    for (const pv of previews) if (pv.kind === 'jet') jetEmit(pv.def, pclock - pv.t0, dt, pv.entry.launcher ?? -1, pv, pv.entry.tint);
  }
  function drawEffects() {
    ribbons.begin();
    const ground = (x, z) => terrain.heightAt(x, z);
    if (S.show) for (const e of S.show.entries) {
      if (e.kind !== 'laser') continue;
      const def = fx(e); if (!def) continue;
      const tau = S.t - e.time; if (tau < 0 || tau > def.duration) continue;
      const fr = frameOf(e.launcher);
      drawLaser(ribbons, def, tau, fr.O, fr.q, ground, { tint: e.tint });
    }
    for (const pv of previews) if (pv.kind === 'laser') {
      const fr = frameOf(pv.entry.launcher ?? -1);
      drawLaser(ribbons, pv.def, pclock - pv.t0, fr.O, fr.q, ground, { tint: pv.entry.tint });
    }
    ribbons.end();
    const lvl = terrain.mirrorLevel(), on = lvl != null;
    for (const m of [ribbons.mirror, layers.add.mirror, layers.blend.mirror]) { m.visible = on; if (on) m.material.uniforms.level.value = lvl; }
  }

  // ---- show model ---------------------------------------------------------------------------------------------
  const blank = () => ({ name: 'My show', music: '', start_minutes: 1260, months: 65535, aim: [],
    launchers: [{ type: 'Mortarx16', row: 0, col: 0, dir: 0, corner: -1 }, { type: 'Mortarx1', row: 0, col: -3, dir: 0, corner: 0 },
      { type: 'Mortarx1', row: 0, col: 3, dir: 0, corner: 0 }, { type: 'LazerDome', row: -3, col: -6, dir: 0, corner: 0 },
      { type: 'LazerDome', row: -3, col: 6, dir: 0, corner: 0 }, { type: 'WaterJet', row: 3, col: -2, dir: 0, corner: 0 },
      { type: 'WaterJet', row: 3, col: 2, dir: 0, corner: 0 }], entries: [] });
  const clone = o => JSON.parse(JSON.stringify(o));
  function normShow(sh) {
    sh.aim = sh.aim || []; sh.months ??= 65535; sh.start_minutes ??= 1260;
    for (const e of sh.entries) { e.kind = e.kind || 'firework'; }
    for (const k of Object.keys(REG)) for (const [key, d] of Object.entries(sh.custom?.[k] || {})) if (!REG[k][key]) REG[k][key] = prepDef(k, clone(d), key);
    return sh;
  }
  // selection: S.multi holds every selected effect, S.sel the one shown in detail (the last clicked)
  const selList = () => S.show.entries.filter(e => S.multi.has(e));
  function select(list, primary) {
    S.multi = new Set(list);
    S.sel = primary && S.multi.has(primary) ? primary : (S.multi.has(S.sel) ? S.sel : list[list.length - 1] || null);
  }
  const showEnd = () => Math.max(10, ...S.show.entries.map(e => e.time + fxDur(e) + 1));
  const timelineEnd = () => Math.max(30, showEnd() + 10, isFinite(musicEl.duration) ? musicEl.duration : 0);
  const tracks = () => Math.max(12, ...S.show.entries.map(e => e.track + 2));
  function setShow(show, keepT) {
    S.show = normShow(show); select([]); S.selLauncher = 0; S.selAim = null;
    terrain.setData(show.terrain || null);
    if (!keepT) seek(0);
    setMusic(show.music || '');
    rebuildLaunchers(); renderAll();
    fitCamera($('#fw-cam', root).value);
  }
  function withCustom(sh) {   // the show plus the definitions of your own effects it uses (so it opens anywhere)
    const out = clone(sh); out.custom = { firework: {}, laser: {}, jet: {} };
    for (const e of sh.entries) if (String(e.firework).startsWith('my:') && fx(e)) {
      const d = clone(fx(e)); delete d._flags; out.custom[e.kind][e.firework] = d;
    }
    return out;
  }
  function changed(label) { store.set('rct3fw.autosave', withCustom(S.show)); if (label) toast(label); }
  function snapshot() { S.undo.push(clone(S.show)); if (S.undo.length > 120) S.undo.shift(); S.redo = []; }
  function restore(sh) { S.show = normShow(sh); select([]); S.selAim = null; terrain.setData(sh.terrain || null); rebuildLaunchers(); renderAll(); }
  function undo() { if (!S.undo.length) return; S.redo.push(clone(S.show)); restore(S.undo.pop()); changed('Undo'); }
  function redo() { if (!S.redo.length) return; S.undo.push(clone(S.show)); restore(S.redo.pop()); changed('Redo'); }

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
    // replay what is still in the air at t: launches up to 10 s before, simulated silently
    const from = Math.max(0, t - 10), dt = 1 / 30;
    const es = S.show ? S.show.entries.filter(e => e.time <= t && e.time > from - 1e-6).sort((a, b) => a.time - b.time) : [];
    let k = 0, sim = from;
    silent = true;
    while (sim < t - 1e-6) {
      applyAims(sim);
      while (k < es.length && es[k].time <= sim + 1e-6) { launch(es[k], true); S.fired.add(es[k]); k++; }
      const h = Math.min(dt, t - sim); effectsStep(sim, h); step(h); sim += dt;
    }
    while (k < es.length) { launch(es[k], true); S.fired.add(es[k]); k++; }
    silent = false;
    if (S.show) for (const e of S.show.entries) if (e.time <= t) S.fired.add(e);
    S.t = t; applyAims(t);
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
  let camMode = 'crowd';
  function fitCamera(mode) {
    camMode = mode;
    if (mode === 'free') { toast('Freelook: the camera stays where you put it'); return; }
    const ls = S.show?.launchers || [];
    const span = Math.max(24, ...ls.map(l => Math.max(Math.abs((l.col - centre[0]) * TILE), Math.abs((l.row - centre[1]) * TILE)) * 2));
    controls.target.set(0, mode === 'close' ? 22 : 38, 0);
    if (mode === 'top') camera.position.set(0.01, 160 + span, 0.01);
    else if (mode === 'close') camera.position.set(span * 0.3, 8, span + 40);
    else camera.position.set(0, 10, 75 + span * 0.8);
    controls.update();
  }
  function autolook(dt) {   // ease the view towards where things are bursting
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let i = parts.length - 1; i >= 0 && n < 400; i--) { const p = parts[i]; if (p.age < 0.6 && p.y > 6) { sx += p.x; sy += p.y; sz += p.z; n++; } }
    if (!n) return;
    const k = 1 - Math.exp(-dt * 0.8), tg = controls.target;
    tg.x += (sx / n - tg.x) * k; tg.y += (clamp(sy / n, 10, 120) - tg.y) * k; tg.z += (sz / n - tg.z) * k;
  }

  // ---- UI: palette (Fireworks / Lasers / Water Jets) ---------------------------------------------------------------
  const lib = $('#fw-lib', root);
  const afeUnlocked = () => !!store.get('rct3fw.afe');
  function renderLib() {
    const f = $('#fw-search', root).value.toLowerCase(), kind = S.tab;
    root.querySelectorAll('#fw-ptabs button').forEach(b => b.classList.toggle('on', b.dataset.k === kind));
    $('#fw-create', root).innerHTML = kind === 'firework'
      ? `<button data-c="afe" title="Advanced firework editor">${afeUnlocked() ? '✎' : '🔒'} Advanced firework editor</button>`
      : `<button data-c="${kind}" title="Advanced ${KINDS[kind].one} editor">✎ Advanced ${kind === 'laser' ? 'laser' : 'water jet'} designer</button>`;
    const all = Object.values(REG[kind]).filter(x => !f || x.title.toLowerCase().includes(f)).sort((a, b) => a.title.localeCompare(b.title));
    const row = x => `<div class="fwk" draggable="true" data-f="${esc(x.key)}" title="${esc(x.title)}${x.cost != null ? ` · $${(x.cost / 100).toFixed(2)}` : ''} · ${x.duration.toFixed(1)} s">
        <span class="sw" style="background:${hex(swatch(x))};color:${hex(swatch(x))}"></span><span class="nm">${esc(x.title)}</span>
        ${x.cost != null ? `<span class="cost">$${(x.cost / 100).toFixed(2)}</span>` : `<span class="cost">${x.duration.toFixed(0)} s</span>`}
        <button class="ed" title="Edit (makes your own copy of a game ${KINDS[kind].one})">✎</button><button class="pv" title="Preview">▶</button></div>`;
    const yours = all.filter(x => x.key.startsWith('my:')), game = all.filter(x => !x.key.startsWith('my:'));
    lib.innerHTML = (yours.length ? `<div class="libgrp">Yours (${yours.length})</div>` + yours.map(row).join('') : '') +
      `<div class="libgrp">Game ${KINDS[kind].tab.toLowerCase()} (${game.length})</div>` + game.map(row).join('');
  }
  $('#fw-search', root).oninput = renderLib;
  $('#fw-ptabs', root).onclick = e => { const b = e.target.closest('button'); if (b) { S.tab = b.dataset.k; renderLib(); } };
  $('#fw-create', root).onclick = e => { const b = e.target.closest('button'); if (b) openEditor(b.dataset.c === 'afe' ? 'firework' : b.dataset.c, null); };
  lib.addEventListener('click', e => {
    const row = e.target.closest('.fwk'); if (!row) return;
    lib.querySelectorAll('.fwk.sel').forEach(x => x.classList.remove('sel')); row.classList.add('sel');
    if (e.target.closest('.ed')) return openEditor(S.tab, row.dataset.f);
    if (e.target.closest('.pv') || e.detail === 2) preview(S.tab, row.dataset.f);
  });
  lib.addEventListener('dragstart', e => { const row = e.target.closest('.fwk'); if (row) { e.dataTransfer.setData('text/x-firework', S.tab + '|' + row.dataset.f); e.dataTransfer.effectAllowed = 'copy'; } });
  function compatibleLauncher(kind) {
    const ls = S.show.launchers;
    if (ls[S.selLauncher] && fits(kind, ls[S.selLauncher].type)) return S.selLauncher;
    return ls.findIndex(l => fits(kind, l.type));
  }
  function preview(kind, key) {
    audio();
    const li = compatibleLauncher(kind), def = REG[kind][key];
    fireNow({ kind, firework: key, launcher: li, slot: Math.floor(Math.random() * 16), tint: S.sel?.firework === key ? S.sel.tint : null });
    toast(`Preview: ${def?.title} ${li >= 0 ? 'from launcher #' + (li + 1) : '(no ' + LAUNCHER_NAMES[BASE_FOR[kind]] + ' in this show)'}`);
  }
  $('#fw-reload', root).onclick = async () => {
    data = await (await fetch('/api/fw/data')).json(); loadRegistry(); descCache.clear(); renderLib(); renderAll(); toast('Reloaded all effects');
  };

  // ---- editors: Advanced Firework Editor (unlocked with a name, as in the game), laser and water jet designers ----
  async function openEditor(kind, key) {
    if (kind === 'firework' && !afeUnlocked()) {
      const name = await ask('Advanced firework editor', 'The advanced firework editor is hidden. Enter the name that unlocks it:', '', 'Unlock');
      if (name == null) return;
      if (name.trim().toLowerCase() !== 'atari') { toast('Nothing happened: that name doesn\'t unlock anything'); return; }
      store.set('rct3fw.afe', true); renderLib(); toast('Advanced firework editor unlocked!');
    }
    const def = key ? clone(REG[kind][key]) : null;
    if (def && !key.startsWith('my:')) { def.title = def.title + ' (copy)'; if (def.nodes?.[def.root]) def.nodes[def.root].Name = def.title; }
    const mod = await import(kind === 'firework' ? './fw_afe.js' : './fw_designers.js');
    const ownKey = key && key.startsWith('my:') ? key : null;
    if (kind === 'firework') mod.openAFE(ctx, def, ownKey);
    else if (kind === 'laser') mod.openLaserDesigner(ctx, def || defaultLaser(), ownKey);
    else mod.openJetDesigner(ctx, def || defaultJet(), ownKey);
  }
  function ask(title, text, value = '', ok = 'OK') {
    return new Promise(res => {
      const d = document.createElement('div'); d.className = 'dlg';
      d.innerHTML = `<div class="box"><h4>${esc(title)}</h4><div>${esc(text)}</div><input type="text" value="${esc(value)}"><div class="row"><button data-r="0">Cancel</button><button data-r="1" class="big">${esc(ok)}</button></div></div>`;
      root.appendChild(d);
      const inp = $('input', d); inp.focus(); inp.select();
      const done = v => { d.remove(); res(v); };
      d.onclick = e => { const b = e.target.closest('button'); if (b) done(b.dataset.r === '1' ? inp.value : null); else if (e.target === d) done(null); };
      inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value); if (e.key === 'Escape') done(null); e.stopPropagation(); };
    });
  }
  function dialog(html) {   // simple modal: returns the box element and a close function
    const d = document.createElement('div'); d.className = 'dlg'; d.innerHTML = `<div class="box">${html}</div>`;
    root.appendChild(d); d.onclick = e => { if (e.target === d) d.remove(); };
    return [$('.box', d), () => d.remove()];
  }
  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { let m = r.statusText; try { m = (await r.json()).error; } catch (e) {} throw new Error(m); }
    return r;
  }
  async function download(kindExt, payload, name) {
    const r = await post('/api/fw/build', { kind: kindExt, data: payload, name });
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name.replace(/[\\/:*?"<>|]/g, '_') + '.' + kindExt; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Downloaded ' + a.download);
  }
  async function saveToGame(kindExt, payload, name) { return (await post('/api/fw/save', { kind: kindExt, data: payload, name })).json(); }
  const ctx = {
    THREE, root, view, scene, camera, controls, renderer, esc, hex, unhex, clamp, fmt, store, toast, ask, dialog,
    get data() { return data; }, REG, fireworkDuration, descCacheClear: () => descCache.clear(),
    saveMine, deleteMine, download, saveToGame, audio, playSound: n => { audio(); playSound(n); },
    pageUrl: n => '/api/fw/page?name=' + encodeURIComponent(n),
    previewEffect(kind, def, opts = {}) {
      audio();
      const li = compatibleLauncher(kind);
      return fireNow({ kind, firework: null, launcher: li, slot: opts.slot ?? 0, tint: null }, { def, loop: opts.loop });
    },
    previewLauncher: kind => compatibleLauncher(kind),
    setAfeMode(on) { root.classList.toggle('afe', on); resize(); },
    reload: () => $('#fw-reload', root).onclick(),
    newLaser: defaultLaser, newJet: defaultJet,
    particleCount: () => parts.length,
  };

  // ---- UI: inspector ---------------------------------------------------------------------------------------------
  function tubeCount(li) { const o = launcherObjs[li]; const i = o?.def?.info; return i ? (i.bone_tubes || i.tubes.length || 1) : 16; }
  let clip = store.get('rct3fw.clipboard');
  function renderEntry() {
    const box = $('#fw-entry', root), e = S.sel, ls = S.show.launchers;
    const clipRow = `<div class="row"><button data-a="copy" title="Ctrl+C">Copy</button><button data-a="cut" title="Ctrl+X">Cut</button>
      <button data-a="paste" title="Ctrl+V: at the playhead" ${clip?.entries?.length ? '' : 'disabled'}>Paste${clip?.entries?.length ? ` (${clip.entries.length})` : ''}</button></div>`;
    if (!e) {
      box.innerHTML = `<div class="muted">Click an effect to edit it, or drag a box across the timeline to select several (Ctrl/Shift-click adds more; Ctrl-drag clones).
        Drag fireworks, lasers or water jets from the palette onto the timeline to add them.</div>` +
        (clip?.entries?.length ? `<div class="row"><button data-a="paste" title="Ctrl+V">Paste ${clip.entries.length} at the playhead</button></div>` : '') +
        `<div class="kbd">Ctrl+A select all · Ctrl+C/X/V copy, cut, paste · Del delete · ←/→ nudge · ↑/↓ track</div>`;
      return;
    }
    if (S.multi.size > 1) {
      const sel = selList(), t0 = Math.min(...sel.map(x => x.time)), t1 = Math.max(...sel.map(x => x.time));
      const cost = sel.reduce((a, x) => a + (fx(x)?.cost || 0), 0), kinds = new Set(sel.map(x => x.kind));
      const k1 = kinds.size === 1 ? [...kinds][0] : null;
      box.innerHTML = `
        <div><b>${sel.length} effects selected</b><div class="muted">${fmt(t0)} – ${fmt(t1)} · tracks ${Math.min(...sel.map(x => x.track)) + 1}–${Math.max(...sel.map(x => x.track)) + 1} · $${(cost / 100).toFixed(2)}</div></div>
        ${clipRow}
        <div class="row"><button data-a="prev" title="F: fire them with their own timing">▶ Preview</button><button data-a="dup" title="Ctrl+D: copy right after">Duplicate</button><button data-a="del" title="Delete">Delete</button><button data-a="none" title="Esc">Deselect</button></div>
        <label>Move<span class="row"><button data-a="m-1">−1 s</button><button data-a="m-0.1">−0.1</button><button data-a="m0.1">+0.1</button><button data-a="m1">+1 s</button></span></label>
        ${k1 ? `<label>${esc(KINDS[k1].one[0].toUpperCase() + KINDS[k1].one.slice(1))}<select data-k="b-firework"><option value="">(keep each)</option>${Object.values(REG[k1]).map(f => `<option value="${esc(f.key)}">${esc(f.title)}</option>`).join('')}</select></label>
        <label>Launcher<select data-k="b-launcher"><option value="">(keep each)</option>${ls.map((l, i) => fits(k1, l.type) ? `<option value="${i}">#${i + 1} ${esc(LAUNCHER_NAMES[l.type] || l.type)}</option>` : '').join('')}</select></label>` : ''}
        <label>Colour<span class="row"><input type="color" data-k="b-tint" value="#ffffff" title="Colour all selected effects"><button data-a="b-notint">Original</button></span></label>
        <label>Strength<input type="range" data-k="b-strength" min="0.25" max="2" step="0.05" value="1" title="Strength modifier for all selected fireworks"></label>
        <div class="kbd">Drag any selected effect to move them all · Ctrl-drag clones · ←/→ nudge 0.1 s (Shift: 1 s) · ↑/↓ track</div>`;
      return;
    }
    const kind = e.kind || 'firework', def = fx(e);
    box.innerHTML = `
      <label>${esc(KINDS[kind].one[0].toUpperCase() + KINDS[kind].one.slice(1))}<select data-k="firework">${Object.values(REG[kind]).sort((a, b) => a.title.localeCompare(b.title)).map(f => `<option value="${esc(f.key)}"${f.key === e.firework ? ' selected' : ''}>${esc(f.title)}</option>`).join('')}</select></label>
      <label>Launcher<select data-k="launcher">${ls.map((l, i) => fits(kind, l.type) || i === e.launcher ? `<option value="${i}"${i === e.launcher ? ' selected' : ''}>#${i + 1} ${esc(LAUNCHER_NAMES[l.type] || l.type)}</option>` : '').join('')}</select></label>
      ${kind === 'firework' ? `<label>Tube<select data-k="slot">${Array.from({ length: tubeCount(e.launcher) }, (_, i) => `<option value="${i}"${i === e.slot ? ' selected' : ''}>${i + 1}</option>`).join('')}</select></label>` : ''}
      <label>Time (s)<input type="number" data-k="time" min="0" step="0.1" value="${e.time.toFixed(2)}"></label>
      <label>Track<input type="number" data-k="track" min="0" step="1" value="${e.track + 1}"></label>
      <label>Colour<span class="row"><input type="color" data-k="tint" value="${e.tint ? hex(e.tint) : '#ffffff'}" title="Colour modifier for this launch">
        <button data-a="notint" ${e.tint ? '' : 'disabled'}>Original</button></span></label>
      ${kind === 'firework' ? `<label>Strength<span class="row" style="flex-wrap:nowrap"><input type="range" data-k="strength" min="0.25" max="2" step="0.05" value="${e.strength ?? 1}" style="flex:1">
        <span class="muted" style="width:34px">${(e.strength ?? 1).toFixed(2)}</span></span></label>` : ''}
      <div class="row"><button data-a="fire">▶ Fire now</button><button data-a="dup" title="Ctrl+D">Duplicate</button><button data-a="del" title="Delete">Delete</button><button data-a="edit" title="Open in the ${kind === 'firework' ? 'advanced firework editor' : 'designer'}">✎ Edit</button></div>
      ${clipRow}
      <div class="muted">${esc(def?.title)}${def?.cost != null ? ` · $${(def.cost / 100).toFixed(2)}` : ''} · lasts about ${(def?.duration || 0).toFixed(1)} s${!fits(kind, ls[e.launcher]?.type) ? ' · <span class="err">needs a ' + esc(LAUNCHER_NAMES[BASE_FOR[kind]]) + ' launcher</span>' : ''}</div>`;
  }
  $('#fw-entry', root).addEventListener('input', ev => {
    if (ev.target.dataset.k === 'strength' && S.sel) { const sp = ev.target.parentElement.querySelector('.muted'); if (sp) sp.textContent = (+ev.target.value).toFixed(2); }
  });
  $('#fw-entry', root).addEventListener('change', ev => {
    const k = ev.target.dataset.k, e = S.sel; if (!k || !e) return;
    const v = ev.target.value;
    if (k.startsWith('b-')) {   // bulk change of every selected effect
      if (v === '') return;
      snapshot();
      for (const x of selList()) {
        if (k === 'b-firework') x.firework = v;
        if (k === 'b-launcher') { x.launcher = +v; x.slot %= tubeCount(+v); }
        if (k === 'b-tint') x.tint = unhex(v);
        if (k === 'b-strength' && x.kind === 'firework') x.strength = +v;
      }
      changed(`Changed ${S.multi.size} effects`); renderAll(); return;
    }
    snapshot();
    if (k === 'firework') e.firework = v;
    else if (k === 'launcher') { e.launcher = +v; e.slot = Math.min(e.slot || 0, tubeCount(e.launcher) - 1); }
    else if (k === 'slot') e.slot = +v;
    else if (k === 'time') e.time = Math.max(0, +v || 0);
    else if (k === 'track') e.track = Math.max(0, (+v || 1) - 1);
    else if (k === 'tint') e.tint = unhex(v);
    else if (k === 'strength') e.strength = +v;
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
    if (a === 'edit') return openEditor(e.kind || 'firework', e.firework);
    if (a.startsWith('m')) return nudge(+a.slice(1), 0);
    if (a === 'b-notint') { snapshot(); for (const x of selList()) delete x.tint; changed(); renderAll(); return; }
    if (a === 'fire') { audio(); fireNow(e); }
    if (a === 'notint') { snapshot(); delete e.tint; changed(); renderAll(); }
    if (a === 'dup') duplicate();
    if (a === 'del') removeSel();
  });
  function renderShowInfo() {
    const sh = S.show, cost = sh.entries.reduce((a, e) => a + (fx(e)?.cost || 0), 0);
    const hh = String(Math.floor(sh.start_minutes / 60) % 24).padStart(2, '0'), mm = String(sh.start_minutes % 60).padStart(2, '0');
    const counts = Object.keys(KINDS).map(k => [k, sh.entries.filter(e => e.kind === k).length]).filter(x => x[1]);
    $('#fw-showinfo', root).innerHTML = `
      <label>Name<input type="text" id="fw-name" value="${esc(sh.name)}"></label>
      <label>Start time<input type="time" id="fw-start" value="${hh}:${mm}" title="Daily show time in the park"></label>
      <div><div class="muted" style="margin-bottom:4px">Months it plays</div><div class="months" id="fw-months">${MONTHS.map((m, i) => `<button data-m="${i}" class="${sh.months & (1 << i) ? 'on' : ''}">${m}</button>`).join('')}</div></div>
      <div class="muted">${counts.map(([k, n]) => `${n} ${KINDS[k].one}${n > 1 ? 's' : ''}`).join(' · ') || 'empty'} · ${sh.launchers.length} launchers · ${fmt(showEnd())} long · fireworks cost $${(cost / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>`;
    $('#fw-name', root).onchange = ev => { snapshot(); sh.name = ev.target.value || 'My show'; changed(); };
    $('#fw-start', root).onchange = ev => { const [h, m] = ev.target.value.split(':').map(Number); snapshot(); sh.start_minutes = (h || 0) * 60 + (m || 0); changed(); };
    $('#fw-months', root).onclick = ev => { const b = ev.target.closest('button'); if (!b) return; snapshot(); sh.months ^= 1 << +b.dataset.m; if (!(sh.months & 4095)) sh.months |= 1 << +b.dataset.m; changed(); renderShowInfo(); };
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
        <button class="x" data-a="dell" title="Remove launcher (its effects are removed too)">✕</button></div>`).join('') +
      `<div class="row"><button data-a="addl">+ Add launcher</button></div><div class="muted">Col / Row are park tiles (4 m). Mortars and the Catherine wheel fire fireworks, laser domes lasers, water jet bases water jets.</div>`;
  }
  $('#fw-launchers', root).addEventListener('change', ev => {
    const k = ev.target.dataset.k, row = ev.target.closest('.lnch'); if (!k || !row) return;
    snapshot();
    const l = S.show.launchers[+row.dataset.i], v = ev.target.value;
    if (k === 'type') l.type = v; else l[k] = Math.round(+v || 0);
    changed(); rebuildLaunchers().then(renderAll);
  });
  function addLauncher(type) {
    const ls = S.show.launchers, last = ls[ls.length - 1] || { row: 0, col: -2 };
    ls.push({ type, row: last.row, col: last.col + 2, dir: 0, corner: type === 'Mortarx16' || type === 'MortarWallx8' || type === 'CWFW' ? -1 : 0 });
    return ls.length - 1;
  }
  $('#fw-launchers', root).addEventListener('click', ev => {
    const a = ev.target.dataset.a, row = ev.target.closest('.lnch');
    if (row && !a && !ev.target.closest('select,input')) { S.selLauncher = +row.dataset.i; obj3dMarkSel(); renderLaunchers(); renderAimBar(); }
    if (a === 'addl') { snapshot(); S.selLauncher = addLauncher('Mortarx16'); changed('Launcher added'); rebuildLaunchers().then(renderAll); }
    if (a === 'dell' && row) {
      const i = +row.dataset.i;
      snapshot();
      S.show.launchers.splice(i, 1);
      S.show.entries = S.show.entries.filter(e => e.launcher !== i).map(e => (e.launcher > i && e.launcher--, e));
      S.show.aim = S.show.aim.map(k => ({ ...k, launchers: k.launchers.filter(x => x !== i).map(x => x > i ? x - 1 : x) })).filter(k => k.launchers.length);
      select(selList()); S.selAim = null;
      S.selLauncher = Math.max(0, Math.min(S.selLauncher, S.show.launchers.length - 1));
      changed('Launcher removed'); rebuildLaunchers().then(renderAll);
    }
  });

  // ---- UI: aiming control points --------------------------------------------------------------------------------
  const aimbar = $('#fw-aimbar', root);
  function renderAimBar() {
    const w = Math.ceil(timelineEnd() * S.pps) + 200;
    aimbar.innerHTML = `<div id="fw-ain" style="position:absolute;left:0;top:0;bottom:0;width:${w}px;transform:translateX(${-lanes.scrollLeft}px)">` +
      (S.show.aim || []).map((k, i) => `<div class="key${k === S.selAim ? ' sel' : k.launchers.includes(S.selLauncher) ? ' mine' : ''}" data-i="${i}" style="left:${k.t * S.pps}px"
        title="${fmt(k.t)} · yaw ${k.yaw.toFixed(0)}° pitch ${k.pitch.toFixed(0)}° · launchers ${k.launchers.map(x => '#' + (x + 1)).join(', ')} · right-click to remove"></div>`).join('') + '</div>';
  }
  function renderAimPanel() {
    const sec = $('#fw-aimsec', root), k = S.selAim;
    sec.style.display = k ? '' : 'none';
    obj3dMarkSel();
    if (!k) return;
    $('#fw-aim', root).innerHTML = `
      <label>Time (s)<input type="number" data-k="t" step="0.1" min="0" value="${k.t.toFixed(2)}"></label>
      <label>Turn (°)<input type="range" data-k="yaw" min="-180" max="180" step="1" value="${k.yaw}"></label>
      <label>Tilt (°)<input type="range" data-k="pitch" min="-80" max="80" step="1" value="${k.pitch}"></label>
      <div class="muted">Controls: ${S.show.launchers.map((l, i) => `<label style="display:inline-flex;grid-template-columns:none;gap:3px;margin-right:6px"><input type="checkbox" data-l="${i}" ${k.launchers.includes(i) ? 'checked' : ''}>#${i + 1}</label>`).join('')}</div>
      <div class="row"><button data-a="reset">Point straight</button><button data-a="del">Remove</button><button data-a="close">Done</button></div>
      <div class="kbd">Or drag a highlighted (green) launcher in the 3D view to aim it.</div>`;
  }
  $('#fw-aim', root).addEventListener('input', ev => {
    const k = S.selAim, f = ev.target.dataset.k; if (!k || !f) return;
    if (f === 'yaw' || f === 'pitch') { k[f] = +ev.target.value; applyAims(S.t); renderAimBar(); }
  });
  $('#fw-aim', root).addEventListener('change', ev => {
    const k = S.selAim; if (!k) return;
    if (ev.target.dataset.k === 't') k.t = Math.max(0, +ev.target.value || 0);
    if (ev.target.dataset.l != null) {
      const i = +ev.target.dataset.l;
      k.launchers = ev.target.checked ? [...new Set([...k.launchers, i])].sort((a, b) => a - b) : k.launchers.filter(x => x !== i);
      if (!k.launchers.length) k.launchers = [i];
    }
    changed(); applyAims(S.t); renderAimBar(); renderAimPanel();
  });
  $('#fw-aim', root).addEventListener('click', ev => {
    const a = ev.target.dataset.a, k = S.selAim; if (!a || !k) return;
    if (a === 'reset') { snapshot(); k.yaw = 0; k.pitch = 0; }
    if (a === 'del') { snapshot(); S.show.aim = S.show.aim.filter(x => x !== k); S.selAim = null; }
    if (a === 'close') S.selAim = null;
    changed(); applyAims(S.t); renderAimBar(); renderAimPanel();
  });
  aimbar.addEventListener('contextmenu', ev => {
    ev.preventDefault();
    const el = ev.target.closest('.key'); if (!el) return;
    snapshot(); const k = S.show.aim[+el.dataset.i];
    S.show.aim.splice(+el.dataset.i, 1); if (S.selAim === k) S.selAim = null;
    changed('Control point removed'); applyAims(S.t); renderAimBar(); renderAimPanel();
  });
  aimbar.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    const el = ev.target.closest('.key'), r = aimbar.getBoundingClientRect();
    const tAt = x => Math.max(0, Math.round((x - r.left + lanes.scrollLeft) / S.pps * 20) / 20);
    let k;
    if (el) k = S.show.aim[+el.dataset.i];
    else {
      if (!S.show.launchers.length) return;
      snapshot();
      const t = tAt(ev.clientX), cur = aimAt(S.selLauncher, t);
      k = { t, yaw: Math.round(cur.yaw), pitch: Math.round(cur.pitch), launchers: [S.selLauncher] };
      S.show.aim.push(k); changed(`Aiming control point for launcher #${S.selLauncher + 1} at ${fmt(t)}`);
    }
    S.selAim = k; renderAimBar(); renderAimPanel();
    aimbar.setPointerCapture(ev.pointerId);
    let moved = false;
    aimbar.onpointermove = e2 => { if (!moved) { snapshot(); moved = true; } k.t = tAt(e2.clientX); renderAimBar(); applyAims(S.t); };
    aimbar.onpointerup = () => { aimbar.onpointermove = aimbar.onpointerup = null; if (moved) { changed(); renderAimPanel(); } };
  });

  // ---- UI: timeline ---------------------------------------------------------------------------------------------
  const lanes = $('#fw-lanes', root), canvas = $('#fw-canvas', root), ruler = $('#fw-ruler', root), heads = $('#fw-heads', root);
  const ph = document.createElement('div'); ph.className = 'playhead';
  const rph = document.createElement('div'); rph.className = 'rplay';
  const drop = document.createElement('div'); drop.className = 'drop';
  const band = document.createElement('div'); band.className = 'band';
  function renderTimeline() {
    if (!S.show) return;
    const n = tracks(), w = Math.ceil(timelineEnd() * S.pps) + 200;
    root.style.setProperty('--rowh', S.rowH + 'px');
    canvas.style.width = w + 'px'; canvas.style.height = n * S.rowH + 'px';
    heads.innerHTML = Array.from({ length: n }, (_, i) => `<div class="head">Track ${i + 1}</div>`).join('');
    let html = Array.from({ length: n }, (_, i) => `<div class="lane" style="top:${i * S.rowH}px"></div>`).join('');
    S.show.entries.forEach((e, i) => {
      const d = fx(e), kind = e.kind || 'firework';
      const c = e.tint || swatch(d), wpx = Math.max(16, (d?.duration || 3) * S.pps), name = d ? d.title : '(missing ' + KINDS[kind].one + ')';
      html += `<div class="ent k-${kind}${e === S.sel ? ' sel' : S.multi.has(e) ? ' multi' : ''}" data-i="${i}" style="left:${e.time * S.pps}px;top:${e.track * S.rowH}px;width:${wpx}px;background-color:${hex(c)}"
        title="${esc(name)} · ${fmt(e.time)} · launcher #${e.launcher + 1}${kind === 'firework' ? ' tube ' + (e.slot + 1) : ''}">${KINDS[kind].icon}${esc(name)}<span class="tail" style="width:${Math.max(0, wpx - 2.2 * S.pps)}px"></span></div>`;
    });
    canvas.innerHTML = html; canvas.append(ph, drop, band);
    // ruler ticks: a label every 1/2/5/10 s depending on the time scale
    const stepS = [0.5, 1, 2, 5, 10, 15, 30].find(s => s * S.pps >= 46) || 60;
    let r = '';
    for (let t = 0; t <= timelineEnd() + stepS; t += stepS) r += `<div class="tick" style="left:${t * S.pps}px">${fmt(t)}</div>`;
    ruler.innerHTML = `<div style="position:absolute;left:0;top:0;bottom:0;width:${w}px" id="fw-rin">${r}</div>`; ruler.append(rph);
    renderAimBar(); syncScroll(); updateTime();
  }
  function syncScroll() {
    const rin = $('#fw-rin', root); if (rin) rin.style.transform = `translateX(${-lanes.scrollLeft}px)`;
    const ain = $('#fw-ain', root); if (ain) ain.style.transform = `translateX(${-lanes.scrollLeft}px)`;
    heads.scrollTop = lanes.scrollTop; updateTime();
  }
  lanes.addEventListener('scroll', syncScroll);
  function renderAll() { renderTimeline(); renderEntry(); renderShowInfo(); renderLaunchers(); renderAimPanel(); }
  const timeAt = clientX => (clientX - lanes.getBoundingClientRect().left + lanes.scrollLeft) / S.pps;
  const trackAt = clientY => Math.max(0, Math.floor((clientY - lanes.getBoundingClientRect().top + lanes.scrollTop) / S.rowH));
  const snap = (t, free) => free ? t : Math.round(t * 20) / 20;
  ruler.addEventListener('pointerdown', e => {
    ruler.setPointerCapture(e.pointerId);
    const go = ev => seek(timeAt(ev.clientX));
    go(e); ruler.onpointermove = go; ruler.onpointerup = () => { ruler.onpointermove = null; };
  });
  // Empty space: click moves the playhead, drag draws a box that selects the effects it touches (Ctrl/Shift adds),
  // double-click adds the picked palette item. An effect: click selects it, Ctrl/Shift-click adds or removes it,
  // dragging moves every selected effect together, Ctrl-drag clones them (as in the game).
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
      const now = performance.now(), last = lastDown; lastDown = { t: now, x: e.clientX, y: e.clientY };
      if (last && now - last.t < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 6) {
        lastDown = null;
        const f = lib.querySelector('.fwk.sel')?.dataset.f || (S.sel?.kind === S.tab ? S.sel.firework : null) || Object.keys(REG[S.tab])[0];
        addEntry(S.tab, f, snap(timeAt(e.clientX)), trackAt(e.clientY)); return;
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
        const hit = S.show.entries.filter(x => x.track >= r0 && x.track <= r1 && x.time <= t1 && x.time + Math.max(16 / S.pps, fxDur(x)) >= t0);
        select([...new Set([...before, ...hit])]);
        for (const [x, xel] of entryEls()) { xel.classList.toggle('sel', x === S.sel); xel.classList.toggle('multi', S.multi.has(x) && x !== S.sel); }
      };
      canvas.onpointerup = () => {
        canvas.onpointermove = canvas.onpointerup = null; band.style.display = 'none';
        if (banding) { lastDown = null; renderEntry(); if (S.multi.size) toast(`${S.multi.size} effect${S.multi.size > 1 ? 's' : ''} selected`); return; }
        seek(timeAt(e.clientX)); if (!add) select([]); markSel();
      };
      return;
    }
    const ent = S.show.entries[+el.dataset.i], cloneKey = e.ctrlKey || e.metaKey;
    const wasIn = S.multi.has(ent);
    if (!wasIn && !add) select([ent], ent); else if (wasIn) S.sel = ent;
    S.selLauncher = ent.launcher; obj3dMarkSel(); renderLaunchers(); renderAimBar();
    let group = wasIn || !add ? selList() : [...selList(), ent];
    if (!group.includes(ent)) group.push(ent);
    const x0 = e.clientX, y0 = e.clientY, t0 = ent.time; let moved = false, orig = null, els = null, minT = 0, minTr = 0;
    el.setPointerCapture(e.pointerId);
    el.onpointermove = ev => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!moved) {
        snapshot(); moved = true;
        if (cloneKey) {   // Ctrl-drag: drag copies, leave the originals
          const copies = group.map(x => clone(x)); S.show.entries.push(...copies);
          select(copies, copies[group.indexOf(ent)]); group = copies; renderTimeline();
        }
        orig = group.map(x => [x, x.time, x.track]); els = entryEls();
        minT = Math.min(...group.map(x => x.time)); minTr = Math.min(...group.map(x => x.track));
      }
      const dt = Math.max(-minT, snap(t0 + (ev.clientX - x0) / S.pps, ev.altKey) - t0);
      const dtr = Math.max(-minTr, Math.round((ev.clientY - y0) / S.rowH));
      for (const [x, ti, tr] of orig) {
        x.time = Math.max(0, ti + dt); x.track = tr + dtr;
        const xe = els.get(x); if (xe) { xe.style.left = x.time * S.pps + 'px'; xe.style.top = x.track * S.rowH + 'px'; }
      }
    };
    el.onpointerup = () => {
      el.onpointermove = el.onpointerup = null;
      if (moved) { changed(cloneKey ? `Cloned ${group.length}` : group.length > 1 ? `Moved ${group.length} effects` : ''); renderAll(); }
      else if (add) {   // Ctrl/Shift-click: add to or remove from the selection
        if (wasIn) { S.multi.delete(ent); select([...S.multi]); } else select([...S.multi, ent], ent);
        markSel();
      } else if (wasIn && S.multi.size > 1) { select([ent], ent); markSel(); }
      else markSel();
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
    const v = e.dataTransfer.getData('text/x-firework'); drop.style.display = 'none';
    if (v) { e.preventDefault(); const [kind, key] = v.includes('|') ? v.split(/\|(.*)/s) : ['firework', v]; addEntry(kind, key, snap(timeAt(e.clientX)), trackAt(e.clientY)); }
  });
  function addEntry(kind, key, time, track) {
    if (!key || !REG[kind][key]) return;
    snapshot();
    let li = compatibleLauncher(kind);
    if (li < 0) { li = addLauncher(BASE_FOR[kind]); rebuildLaunchers(); toast(`Added a ${LAUNCHER_NAMES[BASE_FOR[kind]]} launcher (#${li + 1}) for it`); }
    // next free tube on that launcher around this time
    const used = new Set(S.show.entries.filter(x => x.launcher === li && Math.abs(x.time - time) < 3).map(x => x.slot));
    let slot = 0; while (used.has(slot) && slot < tubeCount(li) - 1) slot++;
    const e = { kind, firework: key, launcher: li, slot, time, track };
    S.show.entries.push(e); select([e], e);
    changed(`Added ${REG[kind][key].title} at ${fmt(time)}`); renderAll();
  }
  function removeSel() {
    const sel = selList(); if (!sel.length) return;
    snapshot(); S.show.entries = S.show.entries.filter(x => !S.multi.has(x)); select([]);
    changed(sel.length > 1 ? `Deleted ${sel.length} effects` : 'Deleted'); renderAll();
  }
  function duplicate() {
    const sel = selList(); if (!sel.length) return;
    const t0 = Math.min(...sel.map(x => x.time)), t1 = Math.max(...sel.map(x => x.time));
    const off = snap(t1 - t0 + 0.5);
    snapshot();
    const copies = sel.map(x => ({ ...clone(x), time: x.time + off }));
    S.show.entries.push(...copies); select(copies);
    changed(sel.length > 1 ? `Duplicated ${sel.length} effects` : 'Duplicated'); renderAll();
  }
  // clipboard: kept in the browser, so a part of one show can be pasted into another (even after a reload)
  function copySel(cut) {
    const sel = selList().sort((a, b) => a.time - b.time);
    if (!sel.length) { toast('Select effects first: drag a box on the timeline, or Ctrl-click'); return; }
    clip = { entries: clone(sel), launchers: Object.fromEntries(sel.map(x => [x.launcher, S.show.launchers[x.launcher]?.type])),
             custom: withCustom({ ...S.show, entries: sel }).custom };
    store.set('rct3fw.clipboard', clip);
    if (cut) { snapshot(); S.show.entries = S.show.entries.filter(x => !S.multi.has(x)); select([]); changed(); renderAll(); }
    else renderEntry();
    toast(`${cut ? 'Cut' : 'Copied'} ${sel.length} effect${sel.length > 1 ? 's' : ''}${sel.length > 1 ? ` (${fmt(sel[sel.length - 1].time - sel[0].time)} long)` : ''}`);
  }
  function paste() {
    if (!clip?.entries?.length) { toast('Nothing copied yet'); return; }
    if (!S.show.launchers.length) { toast('Add a launcher first'); return; }
    normShow({ entries: [], custom: clip.custom });   // make your own effects in the clipboard known here
    const ls = S.show.launchers, t0 = Math.min(...clip.entries.map(x => x.time)), at = snap(S.t);
    const mapL = (i, kind) => {
      if (ls[i]?.type === clip.launchers[i]) return i;
      const j = ls.findIndex(l => l.type === clip.launchers[i]);
      if (j >= 0) return j;
      const k = compatibleLauncher(kind || 'firework');
      return k >= 0 ? k : clamp(S.selLauncher, 0, ls.length - 1);
    };
    snapshot();
    const add = clip.entries.map(x => { const li = mapL(x.launcher, x.kind); return { ...clone(x), kind: x.kind || 'firework', launcher: li, slot: (x.slot || 0) % tubeCount(li), time: +(at + x.time - t0).toFixed(3) }; });
    S.show.entries.push(...add); select(add);
    changed(`Pasted ${add.length} effect${add.length > 1 ? 's' : ''} at ${fmt(at)}`); renderAll();
  }
  function nudge(dt, dtr) {
    const sel = selList(); if (!sel.length) return;
    const minT = Math.min(...sel.map(x => x.time)), minTr = Math.min(...sel.map(x => x.track));
    dt = Math.max(-minT, dt); dtr = Math.max(-minTr, dtr);
    if (!dt && !dtr) return;
    snapshot(); for (const x of sel) { x.time = +(x.time + dt).toFixed(3); x.track += dtr; } changed(); renderAll();
  }
  function previewSel() {
    const sel = selList().sort((a, b) => a.time - b.time); if (!sel.length) return;
    audio(); const t0 = sel[0].time;
    for (const x of sel) setTimeout(() => fireNow(x), (x.time - t0) * 1000 / S.speed);
  }
  const zoom = k => { const mid = timeAt(lanes.getBoundingClientRect().left + lanes.clientWidth / 2); S.pps = clamp(S.pps * k, 6, 400); renderTimeline(); lanes.scrollLeft = mid * S.pps - lanes.clientWidth / 2; syncScroll(); };
  $('#fw-zin', root).onclick = () => zoom(1.5); $('#fw-zout', root).onclick = () => zoom(1 / 1.5);
  lanes.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.25 : 0.8); } }, { passive: false });

  // ---- 3D: click a launcher to select it; aim with the mouse; landscape brushes ------------------------------------
  const ray = new THREE.Raycaster(); let downAt = null;
  const ndc = e => { const r = renderer.domElement.getBoundingClientRect(); return new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); };
  let tool = null, painting = false, brushPt = null, flatTarget = 0, aimDrag = null;
  const groundHit = e => { ray.setFromCamera(ndc(e), camera); return ray.intersectObject(terrain.ground)[0]?.point || null; };
  view.addEventListener('pointerdown', e => {   // capture phase: before the orbit controls see it
    if (e.target !== renderer.domElement || e.button !== 0) return;
    if (tool) {
      const p = groundHit(e); if (!p) return;
      controls.enabled = false; painting = true; brushPt = p; flatTarget = terrain.heightAt(p.x, p.z); snapshot();
      renderer.domElement.setPointerCapture(e.pointerId); return;
    }
    if (S.selAim) {
      ray.setFromCamera(ndc(e), camera);
      const hit = ray.intersectObjects(launcherGroup.children, true)[0];
      if (hit && S.selAim.launchers.includes(hit.object.userData.launcher)) {
        controls.enabled = false; aimDrag = { x: e.clientX, y: e.clientY, yaw: S.selAim.yaw, pitch: S.selAim.pitch }; snapshot();
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    }
  }, true);
  renderer.domElement.addEventListener('pointermove', e => {
    if (tool) { const p = groundHit(e); terrain.showRing(p?.x, p?.z, +$('#fw-bsize', root).value); if (painting && p) brushPt = p; }
    if (aimDrag && S.selAim) {
      S.selAim.yaw = clamp(Math.round(aimDrag.yaw + (e.clientX - aimDrag.x) * 0.5), -180, 180);
      S.selAim.pitch = clamp(Math.round(aimDrag.pitch - (e.clientY - aimDrag.y) * 0.4), -80, 80);
      applyAims(S.t); renderAimPanel(); renderAimBar();
    }
  });
  renderer.domElement.addEventListener('pointerleave', () => terrain.showRing(null));
  const endDrag = () => {
    if (painting) { painting = false; controls.enabled = true; S.show.terrain = terrain.getData(); placeAll(); changed(); }
    if (aimDrag) { aimDrag = null; controls.enabled = true; changed(); }
  };
  renderer.domElement.addEventListener('pointerup', e => {
    const wasPaint = painting || aimDrag; endDrag();
    if (wasPaint || tool) return;
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
    ray.setFromCamera(ndc(e), camera);
    const hit = ray.intersectObjects(launcherGroup.children, true)[0];
    if (hit && hit.object.userData.launcher != null) { S.selLauncher = hit.object.userData.launcher; obj3dMarkSel(); renderLaunchers(); renderAimBar(); toast(`Launcher #${S.selLauncher + 1} selected`); }
  });
  renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  const landp = $('#fw-landp', root);
  $('#fw-land', root).onclick = ev => {
    const on = !landp.classList.contains('on'); landp.classList.toggle('on', on); ev.target.classList.toggle('on', on);
    if (!on) { tool = null; terrain.showRing(null); landp.querySelectorAll('.tools button').forEach(b => b.classList.remove('on')); }
    $('#fw-hint', root).textContent = on ? 'Pick a tool, then left-drag on the ground · right-drag to pan · wheel to zoom' : 'Drag to orbit · right-drag to pan · wheel to zoom · click a launcher to select it';
  };
  landp.querySelector('.tools').onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    tool = tool === b.dataset.t ? null : b.dataset.t;
    landp.querySelectorAll('.tools button').forEach(x => x.classList.toggle('on', x.dataset.t === tool));
    if (!tool) terrain.showRing(null);
  };
  $('#fw-flatall', root).onclick = () => { snapshot(); const w = terrain.getData(); terrain.setData(w ? { ...w, heights: null } : null); S.show.terrain = terrain.getData(); placeAll(); changed('Ground flattened'); };
  $('#fw-dryall', root).onclick = () => { snapshot(); const w = terrain.getData(); terrain.setData(w ? { ...w, water: null } : null); S.show.terrain = terrain.getData(); changed('Water removed'); };

  // ---- export to RCT3 --------------------------------------------------------------------------------------------
  $('#fw-export', root).onclick = () => {
    const sh = S.show;
    const fw = sh.entries.filter(e => e.kind === 'firework'), other = sh.entries.length - fw.length;
    const myFw = [...new Set(fw.filter(e => String(e.firework).startsWith('my:')).map(e => e.firework))];
    const [box, close] = dialog(`<h4>Export “${esc(sh.name)}” to RCT3</h4>
      <div>Saves the show as a MixMaster display file (.fwd) the game loads from its <b>FireworkDisplays</b> folder: ${fw.length} fireworks on ${sh.launchers.length} launchers, music, start time and months.</div>
      <ul>${other ? `<li>${other} lasers / water jets are left out (the game's display files here have no place for them).</li>` : ''}
        ${sh.aim.length ? '<li>Base aiming is left out.</li>' : ''}${terrain.getData() ? '<li>The landscape and water are left out (shape them in the park).</li>' : ''}
        ${fw.some(e => e.tint || (e.strength ?? 1) !== 1) ? '<li>Colour and strength changes are left out.</li>' : ''}
        ${String(sh.music).startsWith('blob:') ? '<li>The music file you chose is left out (only the game\'s music can be named).</li>' : ''}
        ${myFw.length ? `<li>Your ${myFw.length} own firework${myFw.length > 1 ? 's are' : ' is'} saved into the game's Fireworks folder too.</li>` : ''}</ul>
      <div class="row"><button data-x="cancel">Cancel</button><button data-x="dl">Download .fwd</button><button data-x="game" class="big">Save into the game</button></div>`);
    box.onclick = async ev => {
      const x = ev.target.dataset.x; if (!x) return;
      if (x === 'cancel') return close();
      try {
        const map = {};
        if (x === 'game') for (const key of myFw) map[key] = (await saveToGame('frw', REG.firework[key], REG.firework[key].title)).file;
        const payload = { name: sh.name, music: String(sh.music).startsWith('blob:') ? '' : sh.music, start_minutes: sh.start_minutes, months: sh.months,
          launchers: sh.launchers, entries: fw.map(e => ({ ...e, firework: map[e.firework] || e.firework })) };
        if (x === 'dl') await download('fwd', payload, sh.name);
        else { const r = await saveToGame('fwd', payload, sh.name); toast(`Saved ${r.file} into the game's FireworkDisplays folder`); }
        close();
      } catch (e) { toast('Export failed: ' + e.message); }
    };
  };

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
    else { const d = data.displays[+v.slice(1)]; setShow(clone({ name: d.name, music: d.music, start_minutes: d.start_minutes, launchers: d.launchers, entries: d.entries })); }
    S.undo = []; S.redo = [];
  }
  showSel.onchange = () => openChoice(showSel.value);
  $('#fw-new', root).onclick = () => { if (S.show.entries.length && !confirm('Start a new empty show? (The current one stays in "autosaved" until you change the new one.)')) return; showSel.value = 'new'; openChoice('new'); };
  $('#fw-save', root).onclick = () => {
    const blob = new Blob([JSON.stringify({ format: 'rct3ovl-fireworks', version: 2, ...withCustom(S.show) }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (S.show.name || 'show').replace(/[\\/:*?"<>|]/g, '_') + '.fireworks.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast('Saved ' + a.download);
  };
  $('#fw-open', root).onclick = () => $('#fw-file', root).click();
  $('#fw-file', root).onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!Array.isArray(j.entries) || !Array.isArray(j.launchers)) throw new Error('not a fireworks show');
      const { format, version, ...sh } = j; sh.name = sh.name || f.name;
      setShow(sh); changed('Opened ' + f.name);
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
  function toast(t) { const el = $('#fw-toast', root); el.textContent = t; el.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('on'), 2400); }

  // keyboard
  function onKey(e) {
    if (root.style.display === 'none' || root.classList.contains('afe') || e.target.closest('input,select,textarea') || root.querySelector('.dlg, .fwd-win')) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); play(); }
    else if (k === 'escape') { if (S.selAim) { S.selAim = null; renderAimBar(); renderAimPanel(); } else if (S.multi.size) { select([]); markSel(); } else close(); }
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); removeSel(); }
    else if (k === 'home') { seek(0); lanes.scrollLeft = 0; }
    else if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicate(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'c') { e.preventDefault(); copySel(false); }
    else if ((e.ctrlKey || e.metaKey) && k === 'x') { e.preventDefault(); copySel(true); }
    else if ((e.ctrlKey || e.metaKey) && k === 'v') { e.preventDefault(); paste(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'a') { e.preventDefault(); select(S.show.entries.slice()); markSel(); toast(`All ${S.multi.size} effects selected`); }
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
    grip.onpointermove = ev => { const h = clamp(h0 - (ev.clientY - y0), 120, window.innerHeight * 0.6); root.style.setProperty('--fwt', h + 'px'); store.set('rct3fw--fwt', h); resize(); };
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
      applyAims(S.t);
      for (const e of S.show.entries) if (!S.fired.has(e) && e.time <= S.t && e.time > prev - 0.5) { S.fired.add(e); launch(e); }
      if (S.t >= showEnd()) { play(false); }
      updateTime();
      canvas.querySelectorAll('.ent').forEach(el => { const e = S.show.entries[+el.dataset.i]; el.classList.toggle('live', !!e && e.time <= S.t && S.t < e.time + fxDur(e)); });
    }
    if (painting && brushPt && tool) {
      terrain.brush(tool, brushPt.x, brushPt.z, +$('#fw-bsize', root).value, +$('#fw-bstr', root).value, dt,
        { level: +$('#fw-wlevel', root).value || 0, flatten: flatTarget });
      placeAll();
    }
    // previews run on their own clock (also while paused); looping ones restart, finished ones go
    pclock += dt * S.speed;
    previews = previews.filter(pv => { const d = pv.def?.duration || 5; if (pclock - pv.t0 > d) { if (pv.loop) { pv.t0 = pclock + 0.6; return true; } return pv.kind === 'jet' && pclock - pv.t0 < d + 0.1; } return true; });
    // particles: fixed 1/60 s steps, scaled by playback speed (preview fireworks run even while paused)
    acc += dt * (S.playing ? S.speed : 1);
    let n = 0;
    while (acc >= 1 / 60 && n++ < 8) { if (S.playing) effectsStep(S.t, 1 / 60); else effectsStep(-1e9, 1 / 60); step(1 / 60); acc -= 1 / 60; }
    if (n >= 8) acc = 0;
    for (const o of launcherObjs) o.mixer?.update(dt * (S.playing ? S.speed : 0.3));
    if (camMode === 'orbit') { const a = 0.08 * dt, p = camera.position, c = controls.target; const x = p.x - c.x, z = p.z - c.z; p.x = c.x + x * Math.cos(a) - z * Math.sin(a); p.z = c.z + x * Math.sin(a) + z * Math.cos(a); }
    if (camMode === 'auto') autolook(dt);
    controls.update();
    ribbons.setPixel(camera, view.clientHeight); drawEffects(); draw();
    $('#fw-stats', root).textContent = `${parts.length.toLocaleString()} particles${ribbons.count() ? ' · ' + ribbons.count() + ' beams' : ''}`;
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
  window.__fwdebug = {   // for tests
    count: () => parts.length, parts: () => parts, step, launch, FW, REG, descInfo, S, ribbons, terrain, openEditor, ctx, seek, applyAims, renderAll };
  return { root, resize, start, stop, onBack: null };
}

// how long a firework runs: its lifetime plus the longest chain of particles it releases
export function fireworkDuration(fw) {
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
