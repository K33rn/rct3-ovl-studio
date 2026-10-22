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
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { createTerrain } from './fw_terrain.js';
import { createRibbons, createTrails, drawLaser, jetState, jetDir, defaultLaser, defaultJet } from './fw_effects.js';
import { runTour, markSeen, tourRunning } from './tour.js';

const TILE = 4, GRAVITY = 9.81, MAX_PARTICLES = 40000, MAX_VOICES = 40, D2R = Math.PI / 180;
const LAUNCHER_NAMES = { Mortarx1: 'Mortar ×1', Mortarx16: 'Mortar ×16', MortarWallx8: 'Wall ×8',
  CWFW: 'Cath. wheel', LazerDome: 'Laser dome', WaterJet: 'Water jet' };
const KINDS = { firework: { tab: 'Fireworks', one: 'firework', icon: '' }, laser: { tab: 'Lasers', one: 'laser', icon: '✦ ' },
                jet: { tab: 'Water Jets', one: 'water jet', icon: '≈ ' }, scenery: { tab: 'Scenery', one: 'scenery cue', icon: '⟳ ' } };
const fits = (kind, type) => kind === 'laser' ? type === 'LazerDome' : kind === 'jet' ? type === 'WaterJet' : type !== 'LazerDome' && type !== 'WaterJet';
const BASE_FOR = { firework: 'Mortarx16', laser: 'LazerDome', jet: 'WaterJet' };
const SMALL_BASES = new Set(['Mortarx1', 'LazerDome', 'WaterJet']);   // quarter-tile items (placed in a tile corner)
const BASE_INFO = { Mortarx16: 'Rack of 16 tubes for fireworks', Mortarx1: 'One firework tube (quarter tile)', MortarWallx8: 'Wall of 8 tubes for fireworks',
  CWFW: 'Spinning Catherine wheel for fireworks', LazerDome: 'Fires lasers (quarter tile)', WaterJet: 'Fires water jets (quarter tile)' };
// the game's 32 ground textures (Terrain_00..31), named by look
const GROUNDS = ['Cracked dirt', 'Patchy grass', 'Sand', 'Dirt', 'Striped lawn', 'Checked lawn', 'Grass', 'Wild grass', 'Moss', 'Brown earth',
  'Daisy meadow', 'Rough grass', 'Dry mud', 'Gravel', 'Rock', 'Pink marble', 'Red earth', 'Grey rock', 'Dark slate', 'Ice', 'Snow', 'Fresh snow',
  'Snowy rock', 'Red brick', 'Paving slabs', 'Cobbles', 'Pebbly sand', 'Crazy paving', 'Stone tiles', 'Rippled sand', 'Beach sand', 'Dark rock'];
const BACKDROPS = ['Hill', 'City', 'Desert', 'Island', 'Mountain', 'Snow', 'Spooky', 'Space'];
// time of day: column of the game's sky colour ramp (night -> day -> sunset -> night across), light levels, glow
const SKIES = { day: { u: 0.2, hemi: 1.9, sun: 2.4, bloom: 0.35, thr: 0.92, stars: 0, fog: null }, sunset: { u: 0.72, hemi: 1.1, sun: 1.3, bloom: 0.7, thr: 0.6, stars: 0.25, fog: null },
                night: { u: 0.985, hemi: 0.9, sun: 1.2, bloom: 1.1, thr: 0.12, stars: 1, fog: 0x03050b } };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fmt = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
const hex = c => '#' + c.slice(0, 3).map(x => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
const unhex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
                set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } } };

let ui = null, building = null;   // built once (two quick opens share the one build: they used to make two editors)

export async function openFireworks({ onBack, open }) {
  if (!ui) ui = await (building ??= build());
  ui.onBack = onBack;
  ui.root.style.display = 'grid';
  ui.resize(); ui.start();
  history.replaceState(null, '', '#fireworks');
  if (open) ui.openFile(open);              // a file picked in the main file list
  else setTimeout(() => ui.tour(false), 900);   // the MixMaster walkthrough, the first time
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
  #fw .land label { display: grid; grid-template-columns: 74px minmax(0, 1fr); align-items: center; gap: 6px; color: var(--dim); }
  #fw .scenep { left: auto; right: 10px; width: 300px; max-height: calc(100% - 20px); overflow: auto; }
  #fw .grounds { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
  #fw .grounds button { padding: 0; height: 36px; border-radius: 6px; background-size: cover; background-position: center; border: 2px solid transparent; }
  #fw .grounds button.on { border-color: var(--accent); box-shadow: 0 0 6px var(--accent); }
  #fw .grounds button.plain { background: #0d1a10; color: var(--dim); font-size: 10px; }
  #fw .segs { display: flex; gap: 4px; } #fw .segs button { flex: 1; padding: 4px 2px; font-size: 12px; } #fw .segs button.on { background: var(--sel); border-color: var(--accent); color: var(--accent); }
  #fw.noprices .price { display: none !important; }
  #fw .base { display: grid; grid-template-columns: 64px 1fr; gap: 8px; align-items: center; padding: 6px; border-radius: 8px; cursor: grab; user-select: none; border: 1px solid transparent; }
  #fw .base:hover { background: var(--panel2); border-color: var(--line); }
  #fw .base img { width: 64px; height: 64px; border-radius: 6px; background: radial-gradient(#2a3242, #0c0f16); }
  #fw .base b { display: block; } #fw .base small { color: var(--dim); }
  #fw .dragcard { position: fixed; z-index: 90; pointer-events: none; background: #0b0f18ee; border: 1px solid var(--accent); border-radius: 8px; padding: 4px 8px; font-size: 12px; display: none; white-space: nowrap; }
  #fw .land label > input { width: 100%; min-width: 0; margin: 0; box-sizing: border-box; }   /* sliders stay inside the panel */
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
  #fw .tl .ent.k-scenery { border-radius: 3px; background-image: repeating-linear-gradient(135deg, #ffffff30 0 6px, transparent 6px 12px); }
  #fw .fwk .tag { color: var(--dim); font-size: 10px; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #fw .tl .ent .tail { position: absolute; right: 0; top: 0; bottom: 0; background: linear-gradient(90deg, transparent, #0005); pointer-events: none; }
  #fw .tl .ent.sel { box-shadow: 0 0 0 2px #fff, 0 0 10px #fff8; z-index: 2; }
  #fw .tl .ent.multi { box-shadow: 0 0 0 2px var(--accent), 0 0 8px #ffb02e88; z-index: 2; }
  #fw .tl .ent.live { filter: brightness(1.35); }
  #fw .tl .playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: #ff5050; z-index: 3; box-shadow: 0 0 6px #ff5050; cursor: ew-resize; }
  #fw .tl .playhead::before { content: ''; position: absolute; left: -5px; right: -5px; top: 0; bottom: 0; }   /* easier to grab */
  #fw .tl .rplay { position: absolute; top: 0; bottom: 0; width: 2px; background: #ff5050; pointer-events: none; }
  #fw .tl .rplay::after { content: ''; position: absolute; left: -5px; bottom: 0; border: 6px solid transparent; border-top: 7px solid #ff5050; border-bottom: 0; }
  #fw .tl .ruler { cursor: ew-resize; }
  #fw .tl .ent .ev { position: absolute; top: 2px; bottom: 2px; width: 2px; margin-left: -1px; background: #0a0d14b0; box-shadow: 0 0 0 1px #ffffff55; pointer-events: none; border-radius: 1px; }
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
    <button id="fw-tour" title="A guided walkthrough of the MixMaster" style="font-size:11px;padding:2px 8px">? Tour</button>
    <select id="fw-show" title="Open a show"></select>
    <button id="fw-new" title="Start an empty show">New</button>
    <button id="fw-open" title="Open a show saved from this editor (.json), or a firework (.frw), laser (.las) or water jet (.wjt) file from anywhere (or drop files here)">Open…</button>
    <button id="fw-save" title="Download this show (.json) to open again later">Save</button>
    <button id="fw-export" title="Save this show for RollerCoaster Tycoon 3 (.fwd)">Export to RCT3…</button>
    <input type="file" id="fw-file" accept=".json,application/json,.frw,.las,.wjt" multiple hidden>
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
    <button id="fw-grid" class="on" title="Grid placement: launchers snap to park tiles (off: place anywhere, turn freely)">Grid snap</button>
    <button id="fw-land" title="Shape the ground and add water">Landscape</button>
    <button id="fw-scenebtn" title="Time of day, backdrop, ground texture and grid lines">Scene</button>
    <button id="fw-bloom" class="on" title="Glow effect">Glow</button>
    <select id="fw-cam" title="Camera"><option value="crowd">Crowd view</option><option value="auto">Autolook</option><option value="close">Close up</option><option value="top">Top down</option><option value="orbit">Slow orbit</option><option value="free">Freelook</option></select>
  </div>
  <div class="side">
    <div class="ptabs" id="fw-ptabs">${Object.entries(KINDS).map(([k, v]) => `<button data-k="${k}">${v.tab}</button>`).join('')}<button data-k="base" title="MixMaster bases: drag one into the 3D view to place it">Bases</button></div>
    <div class="create" id="fw-create"></div>
    <div style="padding:0 10px 6px"><input type="search" id="fw-search" placeholder="Search" style="width:100%"></div>
    <div class="scroll"><div class="lib" id="fw-lib"></div></div>
    <div style="padding:8px 12px;color:var(--dim);font-size:11px;border-top:1px solid var(--line);display:flex;gap:8px;align-items:center">
      <span style="flex:1">▶ preview · ✎ edit · drag onto the timeline or into the 3D view</span><button id="fw-prices" class="on" title="Show or hide prices" style="font-size:11px;padding:2px 6px">$</button><button id="fw-reload" title="Reload all effects (new files in the game folder)" style="font-size:11px;padding:2px 6px">↻ Reload</button></div>
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
    <div class="land scenep" id="fw-scenep">
      <b>Scene</b>
      <div><div style="color:var(--dim);margin-bottom:4px">Time of day</div><div class="segs" id="fw-sky"><button data-s="day">☀ Day</button><button data-s="sunset">Sunset</button><button data-s="night">☾ Night</button></div></div>
      <label>Backdrop<select id="fw-backdrop"><option value="">None</option>${BACKDROPS.map(b => `<option>${b}</option>`).join('')}</select></label>
      <label style="grid-template-columns:auto 1fr"><input type="checkbox" id="fw-gridlines" checked> Show tile grid lines</label>
      <div><div style="color:var(--dim);margin-bottom:4px">Ground <span id="fw-groundname"></span></div><div class="grounds" id="fw-grounds"></div></div>
    </div>
    <div class="hint" id="fw-hint">Drag to orbit · right-drag to pan · wheel to zoom · click a launcher to select it · Shift-drag a launcher or scenery to raise or lower it</div><div class="toast" id="fw-toast"></div></div>
  <div class="side right">
    <div class="colresize" data-v="--fwr" style="left:-4px"></div>
    <div class="scroll">
      <div id="fw-aimsec" style="display:none"><h3>Aiming control point</h3><div class="insp" id="fw-aim"></div></div>
      <div id="fw-scnsec" style="display:none"><h3>Scenery piece</h3><div class="insp" id="fw-scn"></div></div>
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
  </div>
  <div class="dragcard" id="fw-dragcard"></div>`;
  document.body.appendChild(root);

  // ---- data: the game's effects and yours (kept in this browser, and embedded in shows that use them) -----------
  let data = await (await fetch('/api/fw/data')).json();
  const REG = { firework: {}, laser: {}, jet: {} };
  const FW = REG.firework;
  // your own effects: in this browser and on disk (~/.rct3ovl/my_effects.json, through the viewer), merged
  const mine = Object.assign({ firework: {}, laser: {}, jet: {} }, store.get('rct3fw.mine') || {});
  try {
    const disk = await (await fetch('/api/fw/mine')).json();
    for (const k of ['firework', 'laser', 'jet']) mine[k] = Object.assign({}, disk[k] || {}, mine[k] || {});
  } catch (e) {}
  function keepMine() {   // -> a message if it could not be kept anywhere
    const local = store.set('rct3fw.mine', mine);
    return fetch('/api/fw/mine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mine) })
      .then(r => r.ok ? null : 'the viewer could not write it').catch(() => 'the viewer is not reachable')
      .then(err => err && !local ? 'Could not save: ' + err + ' and the browser storage is full' : err ? 'Saved in this browser only (' + err + ')' : null)
      .then(m => { if (m) toast(m); });
  }
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
  const fx = e => e.kind === 'scenery' ? cueDef(e) : REG[e.kind || 'firework']?.[e.firework];
  const fxDur = e => fx(e)?.duration || 3;
  const swatch = d => d ? (d.kind === 'firework' ? d.colour : d.colour_sw) : [0.5, 0.5, 0.5];
  function saveMine(kind, def, key) {
    key = key || 'my:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const clean = JSON.parse(JSON.stringify(def)); delete clean.key; delete clean._flags;
    mine[kind][key] = clean; keepMine();
    REG[kind][key] = prepDef(kind, JSON.parse(JSON.stringify(clean)), key);
    descCache.clear(); renderLib(); renderTimeline();
    return key;
  }
  function deleteMine(kind, key) { delete mine[kind][key]; keepMine(); delete REG[kind][key]; renderLib(); }
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
  const hemi = new THREE.HemisphereLight(0x8090c0, 0x101810, 0.9); scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xbfd0ff, 1.2); moon.position.set(-60, 120, 80); scene.add(moon);
  const terrain = createTerrain(scene);
  // ---- sky: the game's sky colour ramp, clouds, stars and skyline backdrops ------------------------------------------
  const texLoader = new THREE.TextureLoader(), gameTex = {};
  function gtex(name, repeat) {
    if (!gameTex[name]) { const tx = texLoader.load('/api/fw/tex?name=' + encodeURIComponent(name)); tx.colorSpace = THREE.SRGBColorSpace; gameTex[name] = tx; }
    if (repeat) gameTex[name].wrapS = gameTex[name].wrapT = THREE.RepeatWrapping;   // (clamped, stars / clouds smeared into bright bands)
    return gameTex[name];
  }
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { ramp: { value: gtex('skycolour') }, stars: { value: gtex('stars', true) }, clouds: { value: gtex('clouds', true) }, u: { value: 0.985 }, starAmt: { value: 1 }, cloudAmt: { value: 0 }, time: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform sampler2D ramp, stars, clouds; uniform float u, starAmt, cloudAmt, time; varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = texture2D(ramp, vec2(u, mix(0.02, 0.98, sqrt(h)))).rgb;   // sqrt: the blue reaches lower, as in the game
        vec2 su = vec2(atan(vDir.z, vDir.x) / 6.2832, h) * vec2(6.0, 3.0);
        c += texture2D(stars, su).rgb * starAmt * smoothstep(0.0, 0.15, h);
        if (vDir.y > 0.02) { vec2 cu = vDir.xz / (vDir.y + 0.25) * 1.6 + vec2(time * 0.004, 0.0); vec4 cl = texture2D(clouds, cu);
          c = mix(c, mix(c, vec3(1.0), 0.85), cl.a * cloudAmt * smoothstep(0.02, 0.25, vDir.y)); }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), skyMat); sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
  const backdrop = new THREE.Group(); scene.add(backdrop);
  // skyline backdrop: the game's two halves (background<name>1, 2) joined into one strip, wrapped around a cylinder
  let backdropSeq = 0;
  async function setBackdrop(name) {
    const my = ++backdropSeq;
    backdrop.clear();
    if (!name) return;
    const load = n => fetch('/api/fw/tex?name=background' + name.toLowerCase() + n).then(r => r.blob()).then(createImageBitmap);
    const [a, b] = await Promise.all([load(1), load(2)]).catch(() => [null, null]);
    if (my !== backdropSeq || !a || !b) return;
    const cv = document.createElement('canvas'); cv.width = a.width + b.width; cv.height = a.height;
    const g = cv.getContext('2d'); g.drawImage(a, 0, 0); g.drawImage(b, a.width, 0);
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.wrapS = THREE.RepeatWrapping; tx.repeat.set(5, 1);
    const R = 1400, H = 420;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 96, 1, true),
      new THREE.MeshBasicMaterial({ map: tx, transparent: true, alphaTest: 0.05, fog: false, depthWrite: false, side: THREE.BackSide }));
    cyl.position.y = H / 2 - 60; cyl.renderOrder = -9;
    backdrop.add(cyl);
    backdrop.children.forEach(m => m.material.color.setScalar(S.show?.scene?.sky === 'night' ? 0.18 : S.show?.scene?.sky === 'sunset' ? 0.6 : 1));
  }

  // the composer's buffers need a stencil: reflections are drawn only where the water mask wrote 1
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, stencilBuffer: true }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.1, 0.55, 0.12);
  composer.addPass(bloom); composer.addPass(new OutputPass());
  let useBloom = true;
  const ribbons = createRibbons(scene);

  // ---- particle rendering: instanced camera-facing quads, stretched along velocity (+ a mirrored copy on water) ----
  // VelStretch as the game does it (RCT3plus.exe 0x9cf24f): the quad stays facing the camera (turned by its spin) and
  // each corner moves by half of VelStretch x velocity, forward if it lies ahead of the centre along the velocity,
  // back if behind - in 3D, so a particle flying at the camera hardly stretches on screen
  const pages = {};
  function pageTexture(name) {
    if (!pages[name]) {
      const tex = new THREE.TextureLoader().load('/api/fw/page?name=' + encodeURIComponent(name));
      tex.colorSpace = THREE.SRGBColorSpace; pages[name] = tex;
    }
    return pages[name];
  }
  // one layer per sheet, drawn as the game draws that sheet (its texture style): 'add' (ParticleAdditive, LensFlares):
  // sheet RGB x colour x alpha curve, added; 'pre' (ParticlePreMultipliedAlpha, ParticlePage01): sheet RGB x colour
  // added, what is behind dimmed by sheet alpha x alpha curve - flares and fire have alpha 0 there and simply glow,
  // smoke dims the sky, FWFlares01_07's off-centre alpha blob shows dark under a star glow
  const layers = {};
  function layerFor(pageName) {
    if (!layers[pageName]) {
      const sp = Object.values(data.sprites).find(s => s.page === pageName);
      layers[pageName] = makeLayer(pageTexture(pageName), sp?.blend === 'add');
    }
    return layers[pageName];
  }
  function makeLayer(page, additive) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const A = (name, n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * n), n); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    const at = { pos: A('iPos', 3), vel: A('iVel', 3), size: A('iSize', 2), col: A('iCol', 4), uv: A('iUV', 4), rot: A('iRot', 1) };
    const mat = mirror => new THREE.ShaderMaterial({
      uniforms: { map: { value: page }, level: { value: 0 }, gain: { value: mirror ? 0.35 : 1 } }, transparent: true, depthWrite: false, depthTest: !mirror,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
      ...(mirror ? { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp } : {}),
      defines: Object.assign(additive ? { ADDITIVE: 1 } : {}, mirror ? { MIRROR: 1 } : {}),
      vertexShader: `attribute vec3 iPos; attribute vec3 iVel; attribute vec2 iSize; attribute vec4 iCol; attribute vec4 iUV; attribute float iRot;
        uniform float level; varying vec2 vUv; varying vec4 vCol;
        void main() {
          vec3 P = iPos, V = iVel;
        #ifdef MIRROR
          P.y = 2.0 * level - P.y; V.y = -V.y;
        #endif
          vec4 c = modelViewMatrix * vec4(P, 1.0);
          vec3 v = (modelViewMatrix * vec4(V, 0.0)).xyz;               // velocity x VelStretch
          float cr = cos(iRot), sr = sin(iRot);
          vec3 o = vec3(cr * position.x - sr * position.y, sr * position.x + cr * position.y, 0.0) * iSize.x;
          c.xyz += o + (dot(o, v) < 0.0 ? -0.5 : 0.5) * v;
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
          gl_FragColor = vec4(t.rgb * vCol.rgb * gain, t.a * vCol.a * gain);
        #endif
        }`,
    });
    const mesh = new THREE.Mesh(g, mat(false)); mesh.frustumCulled = false; mesh.renderOrder = 4; g.instanceCount = 0; scene.add(mesh);
    const mirror = new THREE.Mesh(g, mat(true)); mirror.frustumCulled = false; mirror.renderOrder = 2; mirror.visible = false; scene.add(mirror);
    return { g, at, mesh, mirror, n: 0 };
  }

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
      pspin: (n.SpinRateX || n.SpinRateY) ? [n.SpinRateX || 0, n.SpinRateY || 0] : null,       // the particle turns: its bursts spin
      up: n.UpScale || 0, spinY: n.SpinRateY || 0,     // a push of UpScale g along its own up, turning about its path (corkscrews)
      burnN: (n.BurnLength | 0) > 1 ? Math.min(256, n.BurnLength | 0) : 0, burnS: n.BurnSize ?? 0.2,   // a burn trail
      R: curve(n.ColourR), G: curve(n.ColourG), B: curve(n.ColourB),
      page: sp?.page || 'ParticlePage01', A,                                        // drawn by its sheet's layer
      covers: !sp || sp.blend === 'add' || sp.solid,   // on ParticlePage01 only sprites whose alpha is their own picture dim what is behind
      useMod: !!n.ColourModifierEnable, anyC: fl.anyC,
      uv: sp ? toUV(sp.rect) : null,
      frames: sp?.frames ? sp.frames.map(toUV) : null, anim: n.AnimTimeScale ?? 1,   // animated sheets: a frame per moment of life
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
  const toUV = r => [r[0], 1 - r[3], r[2], 1 - r[1]];
  const curveAt = (c, f) => {
    const t = c.t, v = c.v;
    if (!v.length) return 1;
    if (v.length === 1 || !t.length || f <= t[0]) return v[0];
    for (let i = 1; i < t.length && i < v.length; i++) if (f <= t[i]) { const k = (f - t[i - 1]) / Math.max(1e-6, t[i] - t[i - 1]); return v[i - 1] + (v[i] - v[i - 1]) * k; }
    return v[Math.min(t.length, v.length) - 1];
  };
  function randUnit() { const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z); return [r * Math.cos(a), z, r * Math.sin(a)]; }
  function randCubeDir() {   // the game's random direction: a point of the cube [-0.5, 0.5]^3, normalised (corners favoured)
    for (;;) { const x = Math.random() - 0.5, y = Math.random() - 0.5, z = Math.random() - 0.5, l = Math.hypot(x, y, z); if (l > 1e-6) return [x / l, y / l, z / l]; }
  }
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
  let parts = [], ghosts = [], silent = false;   // ghosts: dead particles whose burn trail is still fading
  // Burn Length (RCT3plus.exe 0x9c8930): a particle with more than 1 gets a trail of its last Burn Length positions,
  // one a frame (0x9cdba0, with the colour it had there); when it dies the trail loses a point a frame until under 2.
  // The game records at its frame rate; the viewer at a steady 40 a second.
  const BURN_DT = 1 / 40;
  const trails = createTrails(scene, pageTexture('BurnTrail')), trailPts = new Float32Array(256 * 6);
  function colourOf(p, f) {
    const d = p.d, gain = d.gain ?? 1;
    let r = curveAt(d.R, f) * gain, g = curveAt(d.G, f) * gain, b = curveAt(d.B, f) * gain;
    const m = p.mods;
    if (m) {
      const c = d.useMod ? m.cmod : (!d.anyC ? m.tint : null);
      if (c) { r *= c[0]; g *= c[1]; b *= c[2]; }
    }
    return [r, g, b];
  }
  function burnRecord(p, k) {   // the point it passed BURN_DT ago, k of the way through this step
    const N = p.d.burnN, o = p.th * 6, f = Math.min(1, p.tnext / p.life);
    p.tr.set([p.ox + (p.x - p.ox) * k, p.oy + (p.y - p.oy) * k, p.oz + (p.z - p.oz) * k, ...colourOf(p, f)], o);
    p.th = (p.th + 1) % N; p.tn = Math.min(N, p.tn + 1);
  }
  // emitters that are not ParticleRelative fire in the world's frame (up +Y, its up +Z), whatever their parent is doing
  // and however the tube leans: from the game's Mortar wall x 8 (tubes 20 deg off vertical) Gemini Rockets' shells
  // (a non-relative emitter) climb almost straight up
  const WORLD_DIR = [0, 1, 0], WORLD_UP = [0, 0, 1];
  function spawn(d, x, y, z, vx, vy, vz, h, parent, mods, u) {
    if (parts.length >= MAX_PARTICLES) return null;
    const p = { d, x, y, z, vx, vy, vz, h, u: u || [0, 0, 1], age: 0, life: Math.max(1e-3, d.life + Math.random() * d.lifeR), em: new Float32Array(d.emitters.length),
                r0: Math.random(), mods, delays: d.emitters.map(e => e.tr ? Math.random() * e.tr : 0) };
    if (d.burnN) Object.assign(p, { tr: new Float32Array(d.burnN * 6), th: 0, tn: 0, tnext: 0, ox: x, oy: y, oz: z });
    parts.push(p);
    if (d.sound && !silent) playSound(d.sound, x, y, z, d.sndMin, d.sndMax);
    return p;
  }
  function emit(p, f, dt) {
    const es = p.d.emitters, strength = p.mods?.strength ?? 1;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      const N = e.useS ? Math.max(0, Math.round(e.N * strength)) : e.N;
      // the game releases particles only while the parent's previous time is before the window's end (0x9cbdf0:
      // t0 < end and t1 >= start); a particle's first step starts at 0, so an emitter whose End Time is 0 never fires
      // (seen in the game: a Start 0 / End 0 burst made in its Advanced firework editor shows nothing; End 0.05 bursts)
      if (!N || e.b <= 0) continue;
      const ff = f - p.delays[i] / p.life;
      // the first particle leaves at the window's start, the rest spread evenly over it (the game's Titan Missile
      // stars release one glow at 1% that lives as long as they do; leaving at the window's end, a 1-particle shell
      // over 0-63% of a 4 s base left 2.5 s late)
      let target = ff < e.a ? 0 : e.b <= e.a ? N : Math.min(N, Math.floor(N * (ff - e.a) / (e.b - e.a)) + 1);
      if (f >= 1 && ff >= e.a) target = N;
      const n = Math.floor(target + 1e-6) - p.em[i], j0 = p.em[i];
      if (n <= 0) continue;
      p.em[i] += n;
      const cd = descInfo(p.d.fw, e.desc);
      const sp = Math.hypot(p.vx, p.vy, p.vz);
      const h0 = e.rel ? (sp > 0.05 ? [p.vx / sp, p.vy / sp, p.vz / sp] : p.h) : WORLD_DIR, u0 = e.rel ? p.u : WORLD_UP;
      const spun = e.spin[0] || e.spin[1] || e.spin[2] || e.spin0[0] || e.spin0[1] || e.spin0[2];
      for (let k = 0; k < n; k++) {
        // each particle leaves at its own time in the window (RCT3plus.exe 0x9cbdf0: t = start + k x (window / N), the
        // parent's state interpolated to t within the step), and the emitter's spin turns it by SpinRate x t - so a fast
        // spin fans the particles of one step out instead of stacking them into one ball
        const tj = (e.b <= e.a ? e.a : e.a + (e.b - e.a) * (j0 + k) / N) * p.life + p.delays[i];
        const back = clamp(p.age - tj, 0, dt);
        const ta = p.age - back;
        // the new particle's frame: its parent's when ParticleRelative - along the parent's travel, with its up - else
        // the world's (straight up); then turned by the emitter's spin
        let h = h0, u = u0;
        if (e.rel && p.d.pspin) { h = rotXYZ(h, p.d.pspin[0] * ta, p.d.pspin[1] * ta, 0); u = rotXYZ(u, p.d.pspin[0] * ta, p.d.pspin[1] * ta, 0); }
        if (spun) { const a = [e.spin0[0] + e.spin[0] * ta, e.spin0[1] + e.spin[1] * ta, e.spin0[2] + e.spin[2] * ta]; h = rotXYZ(h, ...a); u = rotXYZ(u, ...a); }
        // as RCT3plus.exe 0x9cc5c4-0x9cc8f9 draws them: SpeedRandom x a direction (a point of the unit cube, normalised),
        // SpeedRandomCircle x a direction in the frame's ring; PositionRandom a point inside a ball of radius 1/2
        // (a cube point kept when |p| <= 0.5), PositionRandomCircle one inside a disk of radius 1/2
        const s = randCubeDir(), c = randPerp(h), ps = randUnit(), pc = e.prc ? randPerp(h) : null;
        const sr = e.sr, pr = e.pr * 0.5 * Math.cbrt(Math.random());
        if (pc) { const k = 0.5 * Math.sqrt(Math.random()); pc[0] *= k; pc[1] *= k; pc[2] *= k; }
        const vx = h[0] * e.speed + s[0] * sr + c[0] * e.src + p.vx * e.psf;
        const vy = h[1] * e.speed + s[1] * sr + c[1] * e.src + p.vy * e.psf;
        const vz = h[2] * e.speed + s[2] * sr + c[2] * e.src + p.vz * e.psf;
        // where the parent was at its time, then moved on by its own velocity for the rest of the step
        let x = p.x - p.vx * back + ps[0] * pr + vx * back, y = p.y - p.vy * back + ps[1] * pr + vy * back, z = p.z - p.vz * back + ps[2] * pr + vz * back;
        if (pc) { x += pc[0] * e.prc; y += pc[1] * e.prc; z += pc[2] * e.prc; }
        const q = spawn(cd, x, y, z, vx, vy, vz, h, e.rel ? p : null, p.mods, u);
        if (!q) return;
        q.age = back; q.fresh = true;
      }
    }
  }
  // UpScale (RCT3plus.exe 0x9c8390, the particle update): each particle carries a frame whose second axis is its direction
  // of travel (realigned to the velocity every step) and whose third, its 'up', stays across it; the up turns about the
  // path by SpinRateY x dt and the particle is pushed along it by UpScale x 9.81 m/s2 - a sideways pull that bends the
  // path, and with SpinRateY a corkscrew
  // The code reads 9.81 x UpScale, but in the game the push is weaker: a test firework in the MixMaster picker's
  // preview (plain star, UpScale 20 without spin, Thunder Blitz's star) rises 0.42 as high as the plain star without
  // spin and 0.94 with it - 0.64 x the push (fitted with fine steps; 1.0 gives 0.31) matches both. Measured, not derived.
  const UP_SEEN = 0.64;
  function upPush(p, d, dt) {
    let u = p.u;
    const sp = Math.hypot(p.vx, p.vy, p.vz);
    if (sp > 1e-4) {
      const n = [p.vx / sp, p.vy / sp, p.vz / sp], k = u[0] * n[0] + u[1] * n[1] + u[2] * n[2];
      u = [u[0] - k * n[0], u[1] - k * n[1], u[2] - k * n[2]];
      let l = Math.hypot(...u);
      if (l < 1e-4) { u = randPerp(n); l = 1; }
      u = u.map(x => x / l);
      if (d.spinY) {
        const a = d.spinY * dt, c = Math.cos(a), s = Math.sin(a);
        const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
        u = [u[0] * c + w[0] * s, u[1] * c + w[1] * s, u[2] * c + w[2] * s];
      }
      p.u = u;
    }
    const a = GRAVITY * d.up * UP_SEEN * dt;
    p.vx += u[0] * a; p.vy += u[1] * a; p.vz += u[2] * a;
  }
  function step(dt) {
    const g = GRAVITY * dt;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], d = p.d;
      if (p.fresh) { p.fresh = false; continue; }   // born during this step: already moved to now
      p.age += dt;
      if (p.tr) { p.ox = p.x; p.oy = p.y; p.oz = p.z; }
      // a pushed particle whose up turns fast (Thunder Blitz: 31 rad/s) is moved in steps of at most 0.1 rad of
      // turn: at 1/60 s the push no longer averages out round the path and the stars drift and climb far too much
      const n = d.up && d.spinY ? Math.min(16, Math.ceil(Math.abs(d.spinY) * dt / 0.1)) : 1, h = dt / n;
      for (let s = 0; s < n; s++) {
        if (d.grav) p.vy -= g / n * d.grav;
        if (d.up) upPush(p, d, h);
        if (d.drag) { const k = Math.max(0, 1 - d.drag * h); p.vx *= k; p.vy *= k; p.vz *= k; }
        p.x += p.vx * h; p.y += p.vy * h; p.z += p.vz * h;
      }
      // no carrying along with the parent: the game's update (0x9c8390) only moves a particle by its own velocity - a
      // child follows its parent through Parent Speed Factor at birth (moved as well, the Comet's trail ran ahead of
      // its head at twice its speed and its 4 s tail stayed balled up round it)
      if (p.tr) for (; p.tnext <= p.age; p.tnext += BURN_DT) burnRecord(p, clamp(1 - (p.age - p.tnext) / dt, 0, 1));
      if (d.emitters.length) emit(p, Math.min(1, p.age / p.life), dt);
    }
    let j = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.age < p.life && p.y > -40 && !(p.d.water && p.vy < 0 && p.y < terrain.heightAt(p.x, p.z))) parts[j++] = p;
      else if (p.tr && p.tn >= 2) { p.gacc = 0; ghosts.push(p); }
    }
    parts.length = j;
    ghosts = ghosts.filter(p => { for (p.gacc += dt; p.gacc >= BURN_DT; p.gacc -= BURN_DT) p.tn--; return p.tn >= 2; });
  }
  function draw() {
    for (const l of Object.values(layers)) l.n = 0;
    for (const p of parts) {
      const d = p.d;
      if (!d.uv) continue;
      const l = layerFor(d.page);
      if (l.n >= MAX_PARTICLES) continue;
      const i = l.n++;
      const f = Math.min(1, p.age / p.life);
      // the game's sprite reaches +-size from the particle (RCT3plus.exe 0x9cf3b7: corners (cos - sin) x size along the
      // camera's unit axes), a square 2 x size across - the quad here is 1 x 1, so firework particles are drawn at twice
      // their size (water jet drops are the viewer's own, sized for the 1 x 1 quad)
      const size = (d.s0 + (d.s1 - d.s0) * f) * (1 + d.sR * (p.r0 - 0.5) * 2) * (d.fw ? 2 : 1);
      const [r, g, b] = colourOf(p, f);
      const k = d.stretch;
      l.at.pos.array.set([p.x, p.y, p.z], i * 3);
      l.at.vel.array.set([p.vx * k, p.vy * k, p.vz * k], i * 3);
      l.at.size.array.set([size, 0], i * 2);
      const op = d.A && d.covers ? clamp(curveAt(d.A, f), 0, 1) : 0;   // water jet drops (no alpha curve) glow
      l.at.col.array.set([r, g, b, op], i * 4);
      const uv = d.frames ? d.frames[Math.min(d.frames.length - 1, Math.floor((f * d.anim % 1) * d.frames.length))] : d.uv;
      l.at.uv.array.set(uv, i * 4);
      l.at.rot.array[i] = d.spin ? p.r0 * 6.2832 + d.spin * p.age : 0;
    }
    // burn trails: the live particle at the front, then the points it left (a dead particle's trail shrinks away)
    trails.begin();
    for (const list of [parts, ghosts]) for (const p of list) {
      if (!p.tr || !p.d.uv) continue;
      const N = p.d.burnN, live = list === parts;
      let m = 0;
      if (live) { trailPts.set([p.x, p.y, p.z, ...colourOf(p, Math.min(1, p.age / p.life))], 0); m = 1; }
      for (let q = 0; q < p.tn && m < N; q++, m++) trailPts.set(p.tr.subarray(((p.th - 1 - q + N) % N) * 6, ((p.th - 1 - q + N) % N) * 6 + 6), m * 6);
      if (m >= 2) trails.add(trailPts, m, p.d.burnS);
    }
    trails.end();
    for (const l of Object.values(layers)) {
      l.g.instanceCount = l.n;
      for (const a of Object.values(l.at)) { a.needsUpdate = true; a.clearUpdateRanges?.(); a.addUpdateRange?.(0, l.n * a.itemSize); }
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
  let launcherObjs = [], pickers = [];
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
  async function rebuildLaunchers(recentre = false) {
    const my = ++buildSeq;
    if (recentre) centre = layoutCentre();   // only when a show is opened: placing or moving a launcher keeps the view still
    const defs = await Promise.all(S.show.launchers.map(l => launcherDef(l.type)));
    if (my !== buildSeq) return;
    for (const o of launcherObjs) { launcherGroup.remove(o.obj); o.label?.element.remove(); o.mixer?.stopAllAction(); if (o.arrow) scene.remove(o.arrow); }
    launcherObjs = S.show.launchers.map((l, i) => {
      const def = defs[i];
      const obj = def ? def.gltf.scene.clone(true) : new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0x884422 }));
      launcherGroup.add(obj);
      const el = document.createElement('div'); el.className = 'lbl'; el.textContent = '#' + (i + 1);
      const label = new CSS2DObject(el); label.position.set(0, 3.2, 0); obj.add(label);
      let mixer = null;
      if (def?.gltf.animations?.length) { mixer = new THREE.AnimationMixer(obj); mixer.clipAction(def.gltf.animations[0]).play(); }
      obj.traverse(o => { o.userData.launcher = i; });
      // an invisible box around it for picking (testing the model's own triangles made dragging over the view lag)
      const bb = new THREE.Box3().setFromObject(obj), size = bb.getSize(new THREE.Vector3()).max(new THREE.Vector3(1.2, 1.2, 1.2));
      const pick = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial({ visible: false }));
      bb.getCenter(pick.position); pick.userData.launcher = i; obj.add(pick); pick.updateMatrixWorld(true);
      return { obj, def, label, mixer };
    });
    pickers = launcherObjs.map(o => o.obj.children.find(c => c.isMesh && c.material.visible === false)).filter(Boolean);
    placeAll(); obj3dMarkSel();
  }
  function placeLauncher(obj, l) {
    const [x, z] = worldOf(l);
    obj.position.set(x, surfaceAt(x, z) + (l.lift || 0), z);   // on the ground, or on top of the scenery there (+ raised)
  }
  // world point -> launcher placement. Grid on: big bases on tile centres, small ones in a tile corner (as the game
  // places them); grid off: anywhere (fractional tiles, no corner)
  function placementAt(type, x, z) {
    const tx = x / TILE + centre[0], tz = z / TILE + centre[1];
    if (!S.grid) return { col: +tx.toFixed(3), row: +tz.toFixed(3), corner: -1 };
    if (!SMALL_BASES.has(type)) return { col: Math.round(tx), row: Math.round(tz), corner: -1 };
    const col = Math.round(tx), row = Math.round(tz), dx = tx - col, dz = tz - row;
    return { col, row, corner: dz < 0 ? (dx < 0 ? 0 : 1) : (dx < 0 ? 3 : 2) };
  }
  function worldOf(l) {
    const cx = ((l.corner ?? -1) >= 0 && SMALL_BASES.has(l.type)) ? [[-1, -1], [1, -1], [1, 1], [-1, 1]][l.corner & 3] : [0, 0];
    const x = (l.col - centre[0]) * TILE + cx[0], z = (l.row - centre[1]) * TILE + cx[1];
    return [x, z];
  }
  // ---- scenery pieces: any of the game's scenery, placed in the show, animated (looping, cued on the timeline, or still) --
  let sceneryList = null;                      // the game's scenery items for the palette (loaded when the tab opens)
  const sceneryModels = {};
  const sceneryGroup = new THREE.Group(); scene.add(sceneryGroup);
  let sceneryObjs = [], scnSeq = 0;
  const selBox = new THREE.BoxHelper(undefined, 0xffb02e); selBox.visible = false; selBox.material.depthTest = false; selBox.renderOrder = 12; scene.add(selBox);
  function sceneryModel(name) {
    if (!sceneryModels[name]) sceneryModels[name] = fetch('/api/scenery_item?name=' + encodeURIComponent(name)).then(async r => {
      if (!r.ok) return null;
      const info = JSON.parse(r.headers.get('X-Info') || '{}');
      return { gltf: await gltf.parseAsync(await r.arrayBuffer(), ''), info };
    }).catch(() => null);
    return sceneryModels[name];
  }
  async function rebuildScenery() {
    const my = ++scnSeq, list = S.show.scenery || [];
    const defs = await Promise.all(list.map(s => sceneryModel(s.name)));
    if (my !== scnSeq) return;
    for (const o of sceneryObjs) { sceneryGroup.remove(o.obj); o.mixer?.stopAllAction(); }
    sceneryObjs = list.map((s, i) => {
      const def = defs[i];
      const obj = def ? cloneSkinned(def.gltf.scene) : new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshLambertMaterial({ color: 0x666666 }));
      obj.traverse(o => { o.userData.scenery = i; });
      sceneryGroup.add(obj);
      const clips = def?.gltf.animations || [];
      return { obj, def, clips, mixer: clips.length ? new THREE.AnimationMixer(obj) : null, action: null, clip: null, free: 0 };
    });
    sceneryObjs.forEach((o, i) => placeScenery(i));
    placeAll(); markScenery(); renderTimeline(); renderSceneryPanel();
  }
  function placeScenery(i) { kick();
    const s = S.show.scenery?.[i], o = sceneryObjs[i]; if (!s || !o) return;
    const [x, z] = worldOf({ col: s.col, row: s.row, corner: -1, type: '' });
    o.obj.position.set(x, surfaceAt(x, z, o.obj) + (s.lift || 0), z);
    o.obj.rotation.set(0, -(s.dir || 0) * Math.PI / 2 + (s.angle || 0) * D2R, 0);
    o.obj.updateMatrixWorld(true);
  }
  const downRay = new THREE.Raycaster();
  function surfaceAt(x, z, exclude) {   // the highest ground or scenery surface under (x, z): things stand on top of scenery
    let y = terrain.heightAt(x, z);
    if (!sceneryGroup.children.length) return y;
    downRay.set(new THREE.Vector3(x, 600, z), new THREE.Vector3(0, -1, 0));
    for (const h of downRay.intersectObjects(sceneryGroup.children, true)) {
      let o = h.object, mine = false;
      while (o) { if (o === exclude) { mine = true; break; } o = o.parent; }
      if (!mine) { y = Math.max(y, h.point.y); break; }   // nearest from above = highest
    }
    return y;
  }
  function markScenery() { kick();
    const o = S.selScenery != null ? sceneryObjs[S.selScenery] : null;
    selBox.visible = !!o && S.pick === 'scenery';
    if (o) selBox.setFromObject(o.obj);
  }
  // animation: the latest cue at or before the playhead plays its clip from the cue's time (once: then holds, or goes
  // back to looping; repeat: loops for the cue's length); otherwise the piece loops its clip, or stands still
  function animateScenery(dt) {
    sceneryObjs.forEach((o, i) => {
      if (!o.mixer || !o.clips.length) return;
      const s = S.show.scenery[i]; if (!s) return;
      const own = o.clips.find(c => c.name === s.clip) || o.clips[0];
      let cue = null;
      for (const e of S.show.entries) if (e.kind === 'scenery' && e.scenery === i && e.time <= S.t && (!cue || e.time >= cue.time)) cue = e;
      let clip = null, time = 0;
      if (cue) {
        const c = o.clips.find(x => x.name === cue.clip) || o.clips[0], tt = S.t - cue.time;
        if (cue.repeat ? tt <= (cue.length || 10) : tt <= c.duration) { clip = c; time = cue.repeat ? tt % c.duration : tt; }
        else if ((s.anim || 'loop') !== 'loop') { clip = c; time = cue.repeat ? (cue.length || 10) % c.duration : c.duration; }
      }
      if (!clip) {
        clip = own;
        if ((s.anim || 'loop') === 'loop') { o.free += dt * (S.playing ? S.speed : 1); time = o.free % own.duration; }
      }
      if (o.clip !== clip) { o.mixer.stopAllAction(); o.action = o.mixer.clipAction(clip); o.action.play(); o.clip = clip; }
      o.action.time = Math.min(time, clip.duration - 1e-4); o.mixer.update(0);
    });
    if (selBox.visible) markScenery();
  }
  function cueDef(e) {   // a scenery cue on the timeline, shaped like an effect
    const s = S.show?.scenery?.[e.scenery], o = sceneryObjs[e.scenery];
    const c = o?.clips.find(x => x.name === e.clip) || o?.clips[0];
    return { kind: 'scenery', key: 'cue', title: `${s ? s.title || s.name.split(':')[0] : '(removed piece)'} #${(e.scenery ?? 0) + 1}: ${e.clip || c?.name || 'animation'}${e.repeat ? ' ↻' : ''}`,
             duration: e.repeat ? (e.length || 10) : (c?.duration || 5), colour_sw: [0.55, 0.85, 0.55] };
  }
  function placeAll() { kick(); launcherObjs.forEach((o, i) => S.show.launchers[i] && placeLauncher(o.obj, S.show.launchers[i])); applyAims(S.t); }
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
  // Aiming turns where a launcher fires, not the launcher: the base stays put (turning the whole model made mortars
  // swing about during a show). aimQ: the aim in the base's own frame, applied to its tubes' directions.
  const _e = new THREE.Euler(), _q = new THREE.Quaternion();
  function applyAims(t) { kick();
    launcherObjs.forEach((o, i) => {
      const l = S.show.launchers[i]; if (!l) return;
      const a = aimAt(i, t);
      o.obj.rotation.set(0, -(l.dir || 0) * Math.PI / 2 + (l.angle || 0) * D2R, 0);
      o.obj.updateMatrixWorld(true);
      o.aimQ = (o.aimQ || new THREE.Quaternion()).setFromEuler(_e.set(a.pitch * D2R, a.yaw * D2R, 0, 'YXZ'));
      // while an aim is being edited: an arrow shows where its launchers fire
      const show = !!S.selAim?.launchers?.includes(i);
      if (show && !o.arrow) { o.arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 14, 0xffb02e, 2.5, 1.4); o.arrow.renderOrder = 11; scene.add(o.arrow); }
      if (o.arrow) {
        o.arrow.visible = show;
        if (show) { const tw = tubeWorld(i, 0); if (tw) { o.arrow.position.copy(tw[0]); o.arrow.setDirection(tw[1]); } }
      }
    });
  }
  function aimDir(o, d) {   // a world direction from the base, turned by the base's aim
    if (!o.aimQ) return d;
    const bq = o.obj.getWorldQuaternion(_q);
    return d.applyQuaternion(bq.clone().invert()).applyQuaternion(o.aimQ).applyQuaternion(bq).normalize();
  }
  function obj3dMarkSel() { kick();
    const aimed = new Set(S.selAim ? S.selAim.launchers : []);
    launcherObjs.forEach((o, i) => { o.label.element.classList.toggle('sel', i === S.selLauncher); o.label.element.classList.toggle('aim', aimed.has(i)); if (o.arrow && !aimed.has(i)) o.arrow.visible = false; });
    if (aimed.size) applyAims(S.t);
  }
  function tubeWorld(li, slot) {   // [start, dir] of a launcher's tube in world space
    const o = launcherObjs[li];
    if (!o) return null;
    o.obj.updateMatrixWorld(true);
    const info = o.def?.info;
    if (info?.bone_tubes) {
      const n = info.bone_tubes, k = String((slot % n) + 1).padStart(2, '0');
      const a = o.obj.getObjectByName('fireworkstart' + k), b = o.obj.getObjectByName('fireworkend' + k);
      if (a && b) { const pa = a.getWorldPosition(new THREE.Vector3()), pb = b.getWorldPosition(new THREE.Vector3()); return [pa, aimDir(o, pb.sub(pa).normalize())]; }
    }
    const tubes = info?.tubes || [];
    if (tubes.length) {
      const t = tubes[slot % tubes.length];
      const pa = o.obj.localToWorld(new THREE.Vector3(...t.start)), pb = o.obj.localToWorld(new THREE.Vector3(...t.end));
      return [pa, aimDir(o, pb.sub(pa).normalize())];
    }
    return [o.obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1, 0)), aimDir(o, new THREE.Vector3(0, 1, 0))];
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
    const q = o.obj.getWorldQuaternion(new THREE.Quaternion()); if (o.aimQ) q.multiply(o.aimQ);
    return { O: p.clone().addScaledVector(d, 0.8), q };
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
            stretch: 0.05, sound: '', R: { t: [], v: [col[0]] }, G: { t: [], v: [col[1]] }, B: { t: [], v: [col[2]] }, page: 'ParticlePage01',
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
    for (const m of [ribbons.mirror, trails.mirror, ...Object.values(layers).map(l => l.mirror)]) { m.visible = on; if (on) m.material.uniforms.level.value = lvl; }
  }

  // ---- scene: time of day, backdrop, ground, grid lines (kept with the show) ------------------------------------------
  const defScene = () => ({ sky: 'night', backdrop: '', ground: -1, gridLines: true });
  function applyScene() { kick();
    const sc = S.show.scene = Object.assign(defScene(), S.show.scene || {}), k = SKIES[sc.sky] || SKIES.night;
    skyMat.uniforms.u.value = k.u; skyMat.uniforms.starAmt.value = k.stars; skyMat.uniforms.cloudAmt.value = sc.sky === 'night' ? 0 : 1;
    hemi.intensity = k.hemi; moon.intensity = k.sun;
    hemi.color.set(sc.sky === 'day' ? 0xdfe8ff : sc.sky === 'sunset' ? 0xffc89a : 0x8090c0);
    moon.color.set(sc.sky === 'day' ? 0xfff4e0 : sc.sky === 'sunset' ? 0xffa060 : 0xbfd0ff);
    bloom.strength = k.bloom; bloom.threshold = k.thr;
    scene.fog = k.fog ? new THREE.Fog(k.fog, 250, 900) : new THREE.Fog(sc.sky === 'day' ? 0xb8cce4 : 0x8a6a70, 400, 2200);
    setBackdrop(sc.backdrop);
    backdrop.children.forEach(m => m.material.color.setScalar(sc.sky === 'night' ? 0.18 : sc.sky === 'sunset' ? 0.6 : 1));
    terrain.setGround(sc.ground >= 0 ? gtex('terrain_' + String(sc.ground).padStart(2, '0')) : null, sc.gridLines);
    root.querySelectorAll('#fw-sky button').forEach(b => b.classList.toggle('on', b.dataset.s === sc.sky));
    $('#fw-backdrop', root).value = sc.backdrop; $('#fw-gridlines', root).checked = sc.gridLines;
    root.querySelectorAll('#fw-grounds button').forEach(b => b.classList.toggle('on', +b.dataset.g === sc.ground));
    $('#fw-groundname', root).textContent = '(' + (sc.ground >= 0 ? GROUNDS[sc.ground] : 'plain night grass') + ')';
  }
  $('#fw-grounds', root).innerHTML = `<button class="plain" data-g="-1" title="Plain night grass">plain</button>` +
    GROUNDS.map((g, i) => `<button data-g="${i}" title="${g}" style="background-image:url('/api/fw/tex?name=terrain_${String(i).padStart(2, '0')}')"></button>`).join('');
  const setSceneVal = (k, v) => { snapshot(); S.show.scene = { ...(S.show.scene || defScene()), [k]: v }; applyScene(); changed(); };
  $('#fw-sky', root).onclick = e => { const b = e.target.closest('button'); if (b) setSceneVal('sky', b.dataset.s); };
  $('#fw-backdrop', root).onchange = e => setSceneVal('backdrop', e.target.value);
  $('#fw-gridlines', root).onchange = e => setSceneVal('gridLines', e.target.checked);
  $('#fw-grounds', root).onclick = e => { const b = e.target.closest('button'); if (b) setSceneVal('ground', +b.dataset.g); };
  $('#fw-scenebtn', root).onclick = ev => { const on = !$('#fw-scenep', root).classList.contains('on'); $('#fw-scenep', root).classList.toggle('on', on); ev.target.classList.toggle('on', on); };

  // ---- show model ---------------------------------------------------------------------------------------------
  const blank = () => ({ name: 'My show', music: '', start_minutes: 1260, months: 65535, aim: [], scenery: [],
    launchers: [{ type: 'Mortarx16', row: 0, col: 0, dir: 0, corner: -1 }, { type: 'Mortarx1', row: 0, col: -3, dir: 0, corner: 0 },
      { type: 'Mortarx1', row: 0, col: 3, dir: 0, corner: 0 }, { type: 'LazerDome', row: -3, col: -6, dir: 0, corner: 0 },
      { type: 'LazerDome', row: -3, col: 6, dir: 0, corner: 0 }, { type: 'WaterJet', row: 3, col: -2, dir: 0, corner: 0 },
      { type: 'WaterJet', row: 3, col: 2, dir: 0, corner: 0 }], entries: [] });
  const clone = o => JSON.parse(JSON.stringify(o));
  function normShow(sh) {
    sh.aim = sh.aim || []; sh.scenery = sh.scenery || []; sh.months ??= 65535; sh.start_minutes ??= 1260;
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
    terrain.setData(show.terrain || null); applyScene();
    if (!keepT) seek(0);
    setMusic(show.music || '');
    rebuildLaunchers(true).then(rebuildScenery); S.selScenery = null; renderAll();
    fitCamera($('#fw-cam', root).value);
  }
  function withCustom(sh) {   // the show plus the definitions of your own effects it uses (so it opens anywhere)
    const out = clone(sh); out.custom = { firework: {}, laser: {}, jet: {} };
    for (const e of sh.entries) if (String(e.firework).startsWith('my:') && !out.custom[e.kind]?.[e.firework] && fx(e)) {
      const d = clone(fx(e)); delete d._flags; out.custom[e.kind][e.firework] = d;
    }
    return out;
  }
  let autosaveT = 0;   // the autosave waits for a pause in editing (it copies the whole show)
  function changed(label) {
    clearTimeout(autosaveT); autosaveT = setTimeout(() => { autosaveT = 0; store.set('rct3fw.autosave', withCustom(S.show)); }, 400);
    if (label) toast(label);
  }
  function snapshot() { S.undo.push(clone(S.show)); if (S.undo.length > 120) S.undo.shift(); S.redo = []; }
  function restore(sh) {
    const key = x => JSON.stringify([x.launchers, x.scenery, x.terrain || null, x.scene || null]);
    const same = S.show && key(S.show) === key(sh);
    S.show = normShow(sh); select([]); S.selAim = null;
    if (same) applyAims(S.t);   // only the timeline changed: keep the 3D launchers as they are
    else { terrain.setData(sh.terrain || null); applyScene(); rebuildLaunchers(false).then(rebuildScenery); }
    renderAll();
  }
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
  function seek(t) { kick();
    t = clamp(t, 0, timelineEnd());
    parts = []; ghosts = []; S.fired.clear();
    // replay what is still in the air at t: only the launches still running then (each from its own start), silently
    const dt = 1 / 20;   // coarse steps: only where things are at t matters, not every frame on the way
    const es = S.show ? S.show.entries.filter(e => e.time <= t && e.time > t - 10 && (e.kind || 'firework') === 'firework' && e.time + fxDur(e) + 0.5 > t)
      .sort((a, b) => a.time - b.time) : [];
    let from = es.length ? es[0].time : t;
    // a water jet running at t: its last few seconds of water are still in the air
    if (S.show?.entries.some(e => e.kind === 'jet' && e.time <= t && e.time + fxDur(e) > t - 3)) from = Math.min(from, Math.max(0, t - 3));
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
      if (musicEl.src) {   // from the playhead (once the music's length is known: earlier seeks are dropped)
        const go = () => { musicEl.playbackRate = S.speed; try { musicEl.currentTime = Math.min(S.t, musicEl.duration || S.t); } catch (e) {} musicEl.play().catch(() => {}); };
        if (musicEl.readyState >= 1) go(); else musicEl.addEventListener('loadedmetadata', () => { if (S.playing) go(); }, { once: true });
      }
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
  const afeUnlocked = () => true;
  let prices = store.get('rct3fw.prices') ?? true;
  root.classList.toggle('noprices', !prices); $('#fw-prices', root).classList.toggle('on', prices);
  $('#fw-prices', root).onclick = ev => { prices = !prices; store.set('rct3fw.prices', prices); root.classList.toggle('noprices', !prices); ev.target.classList.toggle('on', prices); renderLib(); toast(prices ? 'Prices shown' : 'Prices hidden'); };
  function renderLib() {
    const f = $('#fw-search', root).value.toLowerCase(), kind = S.tab;
    root.querySelectorAll('#fw-ptabs button').forEach(b => b.classList.toggle('on', b.dataset.k === kind));
    if (kind === 'scenery') {   // any scenery piece: drag into the 3D view
      if (!sceneryList) {
        $('#fw-create', root).innerHTML = '';
        lib.innerHTML = '<div class="libgrp">Loading scenery… (the first time takes a little while)</div>';
        if (!renderLib.loading) renderLib.loading = fetch('/api/scenery').then(r => r.json()).then(l => { sceneryList = l; if (S.tab === 'scenery') renderLib(); });
        return;
      }
      const cats = [...new Set(sceneryList.map(s => s.category))];
      $('#fw-create', root).innerHTML = `<select id="fw-scat" style="flex:1;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:4px">
        <option value="">All categories (${sceneryList.length})</option>${cats.map(c => `<option${c === S.scat ? ' selected' : ''}>${esc(c)}</option>`).join('')}
        <option value="__anim"${S.scat === '__anim' ? ' selected' : ''}>⟳ Animated only</option></select>`;
      $('#fw-scat', root).onchange = ev => { S.scat = ev.target.value; renderLib(); };
      const all = sceneryList.filter(s => (!S.scat || (S.scat === '__anim' ? s.animations.length : s.category === S.scat)) && (!f || s.title.toLowerCase().includes(f) || s.theme.toLowerCase().includes(f)));
      const shown = all.slice(0, 400);
      lib.innerHTML = `<div class="libgrp">Drag into the 3D view · ${all.length} pieces${all.length > shown.length ? ' (first 400: search to narrow)' : ''}</div>` +
        shown.map(s => `<div class="fwk" draggable="true" data-scn="${esc(s.name)}" title="${esc(s.title)} · ${esc(s.category)} · ${esc(s.theme)}${s.animations.length ? ' · animated' : ''}">
          <span class="sw" style="background:#7a8a7a;color:#0000"></span><span class="nm">${esc(s.title)}${s.animations.length ? ' ⟳' : ''}</span><span class="tag">${esc(s.theme.replace('Themed: ', ''))}</span></div>`).join('');
      return;
    }
    if (kind === 'base') {   // MixMaster bases: drag into the 3D view to place
      $('#fw-create', root).innerHTML = `<button disabled style="opacity:.8">Drag a base into the 3D view · ${S.grid ? 'snaps to the grid' : 'free placement'}</button>`;
      lib.innerHTML = data.launchers.filter(b => !f || (LAUNCHER_NAMES[b] || b).toLowerCase().includes(f)).map(b =>
        `<div class="base" draggable="true" data-base="${esc(b)}" title="Drag into the 3D view"><img src="${baseThumbs[b] || ''}" alt="" data-thumb="${esc(b)}"><div><b>${esc(LAUNCHER_NAMES[b] || b)}</b><small>${esc(BASE_INFO[b] || '')}</small></div></div>`).join('');
      makeThumbs();
      return;
    }
    $('#fw-create', root).innerHTML = kind === 'firework'
      ? `<button data-c="afe" title="Advanced firework editor">${afeUnlocked() ? '✎' : '🔒'} Advanced firework editor</button>`
      : `<button data-c="${kind}" title="Advanced ${KINDS[kind].one} editor">✎ Advanced ${kind === 'laser' ? 'laser' : 'water jet'} designer</button>`;
    const all = Object.values(REG[kind]).filter(x => !f || x.title.toLowerCase().includes(f)).sort((a, b) => a.title.localeCompare(b.title));
    const row = x => `<div class="fwk" draggable="true" data-f="${esc(x.key)}" title="${esc(x.title)}${x.cost != null && prices ? ` · $${(x.cost / 100).toFixed(2)}` : ''} · ${x.duration.toFixed(1)} s">
        <span class="sw" style="background:${hex(swatch(x))};color:${hex(swatch(x))}"></span><span class="nm">${esc(x.title)}</span>${x.ingame ? '<span class="tag" title="made in the game’s own designer (My Documents, RCT3)">made in game</span>' : ''}
        ${x.cost != null ? `<span class="cost price">$${(x.cost / 100).toFixed(2)}</span>` : `<span class="cost">${x.duration.toFixed(0)} s</span>`}
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
    if (row.dataset.scn) return;
    if (e.target.closest('.ed')) return openEditor(S.tab, row.dataset.f);
    if (e.target.closest('.pv') || e.detail === 2) preview(S.tab, row.dataset.f);
  });
  lib.addEventListener('dragstart', e => {
    const scn = e.target.closest('[data-scn]');
    if (scn) { const s = sceneryList.find(x => x.name === scn.dataset.scn); dragState = { scenery: s.name, title: s.title }; e.dataTransfer.setData('text/x-scenery', s.name); e.dataTransfer.effectAllowed = 'copy'; dragImage(e); return; }
    const base = e.target.closest('.base');
    if (base) { dragState = { base: base.dataset.base }; e.dataTransfer.setData('text/x-base', base.dataset.base); e.dataTransfer.effectAllowed = 'copy'; dragImage(e); return; }
    const row = e.target.closest('.fwk');
    if (row) { dragState = { kind: S.tab, key: row.dataset.f }; e.dataTransfer.setData('text/x-firework', S.tab + '|' + row.dataset.f); e.dataTransfer.effectAllowed = 'copy'; dragImage(e); }
  });
  lib.addEventListener('dragend', () => endDrag3d());
  // the browser's drag picture: a small card with the item's colour / picture and name
  function dragImage(e) {
    const c = document.createElement('div');
    c.style.cssText = 'position:fixed;left:-500px;top:0;padding:6px 10px;border-radius:8px;background:#0b0f18;border:1px solid #ffb02e;color:#fff;font:600 12px system-ui;display:flex;gap:8px;align-items:center';
    if (dragState.scenery) c.innerHTML = `⟳ ${esc(dragState.title)}`;
    else if (dragState.base) c.innerHTML = `<img src="${baseThumbs[dragState.base] || ''}" style="width:40px;height:40px">${esc(LAUNCHER_NAMES[dragState.base])}`;
    else { const d = REG[dragState.kind][dragState.key]; c.innerHTML = `<span style="width:14px;height:14px;border-radius:3px;background:${hex(swatch(d))};box-shadow:0 0 8px ${hex(swatch(d))}"></span>${KINDS[dragState.kind].icon}${esc(d?.title)}`; }
    document.body.appendChild(c); e.dataTransfer.setDragImage(c, 20, 20); setTimeout(() => c.remove(), 0);
  }
  // pictures of the bases, rendered once from their models
  const baseThumbs = {};
  let thumbing = null;
  function makeThumbs() {
    if (thumbing || data.launchers.every(b => baseThumbs[b])) return;
    thumbing = (async () => {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); r.setSize(128, 128); r.outputColorSpace = THREE.SRGBColorSpace;
      const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2)); const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(3, 5, 4); sc.add(dl);
      const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
      for (const b of data.launchers) {
        const def = await launcherDef(b); if (!def) continue;
        const o = def.gltf.scene.clone(true); sc.add(o);
        const box = new THREE.Box3().setFromObject(o), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()).length();
        cam.position.copy(c).add(new THREE.Vector3(0.9, 0.7, 1.2).normalize().multiplyScalar(s * 1.5)); cam.lookAt(c);
        r.render(sc, cam); baseThumbs[b] = r.domElement.toDataURL(); sc.remove(o);
        lib.querySelectorAll(`img[data-thumb="${b}"]`).forEach(im => { im.src = baseThumbs[b]; });
      }
      r.dispose(); r.forceContextLoss?.();
    })();
  }
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

  // ---- editors: Advanced Firework Editor (always available here; the game hides it behind a guest name), laser and
  // water jet designers ----
  async function openEditor(kind, key, given) {   // given: a definition from outside the palette (a file from the file list)
    const def = given ? clone(given) : key ? clone(REG[kind][key]) : null;
    if (def && !(key || '').startsWith('my:')) { def.title = def.title + ' (copy)'; if (def.nodes?.[def.root]) def.nodes[def.root].Name = def.title; }
    const mod = await import(kind === 'firework' ? './fw_afe.js' : './fw_designers.js');
    // the editor's preview plays alone: stop the show and any palette previews (they drew on top of it)
    play(false); previews = []; parts = []; ghosts = [];
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
  let afeCam = null;
  let renderUntil = 0;
  function kick(ms = 700) { renderUntil = Math.max(renderUntil, performance.now() + ms); }
  controls.addEventListener('change', () => kick());
  for (const ev of ['pointerdown', 'pointermove', 'wheel']) view.addEventListener(ev, () => kick(), { passive: true });
  window.addEventListener('resize', () => kick());
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
    // resize once the AFE's own panels are in place: in between, the view briefly sits in the narrow left column, and
    // as it ends up the same size as before, the resize observer never fires (the view stayed squeezed: stretched look)
    setAfeMode(on) {
      root.classList.toggle('afe', on); requestAnimationFrame(() => requestAnimationFrame(resize));
      // frame the launcher the firework is fired from, close enough to see it (crowd view showed it tiny); restore after
      if (on) {
        afeCam = { p: camera.position.clone(), t: controls.target.clone() };
        const li = compatibleLauncher('firework'), tw = li >= 0 ? tubeWorld(li, 0) : null, O = tw ? tw[0] : new THREE.Vector3(0, terrain.heightAt(0, 0), 0);
        controls.target.set(O.x, O.y + 24, O.z); camera.position.set(O.x + 12, O.y + 12, O.z + 52); controls.update();
      } else if (afeCam) { camera.position.copy(afeCam.p); controls.target.copy(afeCam.t); controls.update(); afeCam = null; }
    },
    reload: () => $('#fw-reload', root).onclick(),
    newLaser: defaultLaser, newJet: defaultJet,
    particleCount: () => parts.length,
    clearParticles: test => { parts = parts.filter(p => !test(p.d.fw)); ghosts = ghosts.filter(p => !test(p.d.fw)); },   // e.g. the editor's earlier versions
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
        <div><b>${sel.length} effects selected</b><div class="muted">${fmt(t0)} – ${fmt(t1)} · tracks ${Math.min(...sel.map(x => x.track)) + 1}–${Math.max(...sel.map(x => x.track)) + 1}<span class="price"> · $${(cost / 100).toFixed(2)}</span></div></div>
        ${clipRow}
        <div class="row"><button data-a="prev" title="F: fire them with their own timing">▶ Preview</button><button data-a="dup" title="Ctrl+D: copy right after">Duplicate</button><button data-a="del" title="Delete">Delete</button><button data-a="none" title="Esc">Deselect</button></div>
        <label>Move<span class="row"><button data-a="m-1">−1 s</button><button data-a="m-0.1">−0.1</button><button data-a="m0.1">+0.1</button><button data-a="m1">+1 s</button></span></label>
        ${k1 && REG[k1] ? `<label>${esc(KINDS[k1].one[0].toUpperCase() + KINDS[k1].one.slice(1))}<select data-k="b-firework"><option value="">(keep each)</option>${Object.values(REG[k1]).map(f => `<option value="${esc(f.key)}">${esc(f.title)}</option>`).join('')}</select></label>
        <label>Launcher<select data-k="b-launcher"><option value="">(keep each)</option>${ls.map((l, i) => fits(k1, l.type) ? `<option value="${i}">#${i + 1} ${esc(LAUNCHER_NAMES[l.type] || l.type)}</option>` : '').join('')}</select></label>` : ''}
        <label>Colour<span class="row"><input type="color" data-k="b-tint" value="#ffffff" title="Colour all selected effects"><button data-a="b-notint">Original</button></span></label>
        <label>Strength<input type="range" data-k="b-strength" min="0.25" max="2" step="0.05" value="1" title="Strength modifier for all selected fireworks"></label>
        <div class="kbd">Drag any selected effect to move them all · Ctrl-drag clones · ←/→ nudge 0.1 s (Shift: 1 s) · ↑/↓ track</div>`;
      return;
    }
    const kind = e.kind || 'firework', def = fx(e);
    if (kind === 'scenery') {   // a scenery animation cue
      const o = sceneryObjs[e.scenery], clips = o?.clips || [];
      box.innerHTML = `
        <label>Scenery<select data-k="scenery">${(S.show.scenery || []).map((s, i) => `<option value="${i}"${i === e.scenery ? ' selected' : ''}>#${i + 1} ${esc(s.title)}</option>`).join('')}</select></label>
        <label>Animation<select data-k="clip">${clips.map(c => `<option${c.name === e.clip ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label>Time (s)<input type="number" data-k="time" min="0" step="0.1" value="${e.time.toFixed(2)}"></label>
        <label>Track<input type="number" data-k="track" min="0" step="1" value="${e.track + 1}"></label>
        <label>Repeat<span class="row"><input type="checkbox" data-k="repeat" ${e.repeat ? 'checked' : ''}>${e.repeat ? `for <input type="number" data-k="length" min="0.5" step="0.5" value="${e.length || 10}" style="width:70px"> s` : '<span class="muted">plays once</span>'}</span></label>
        <div class="row"><button data-a="dup" title="Ctrl+D">Duplicate</button><button data-a="del">Delete</button><button data-a="piece">Select the piece</button></div>
        ${clipRow}
        <div class="muted">${esc(def.title)} · ${def.duration.toFixed(1)} s. Line fireworks up with this block to time them with the scenery.</div>`;
      return;
    }
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
      <div class="muted">${esc(def?.title)}${def?.cost != null ? `<span class="price"> · $${(def.cost / 100).toFixed(2)}</span>` : ''} · lasts about ${(def?.duration || 0).toFixed(1)} s${!fits(kind, ls[e.launcher]?.type) ? ' · <span class="err">needs a ' + esc(LAUNCHER_NAMES[BASE_FOR[kind]]) + ' launcher</span>' : ''}</div>`;
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
    else if (k === 'scenery') e.scenery = +v;
    else if (k === 'clip') e.clip = v;
    else if (k === 'repeat') { e.repeat = ev.target.checked; e.length = e.length || 10; }
    else if (k === 'length') e.length = Math.max(0.5, +v || 10);
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
    if (a === 'piece') { S.selScenery = e.scenery; S.pick = 'scenery'; markScenery(); return renderSceneryPanel(); }
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
      <div class="muted">${counts.map(([k, n]) => `${n} ${KINDS[k].one}${n > 1 ? 's' : ''}`).join(' · ') || 'empty'} · ${sh.launchers.length} launchers · ${fmt(showEnd())} long<span class="price"> · fireworks cost $${(cost / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>`;
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
        <input type="number" data-k="col" value="${l.col}" step="${S.grid ? 1 : 0.25}"><input type="number" data-k="row" value="${l.row}" step="${S.grid ? 1 : 0.25}">
        <select data-k="dir">${['N', 'E', 'S', 'W'].map((d, k) => `<option value="${k}"${k === (l.dir || 0) ? ' selected' : ''}>${d}</option>`).join('')}</select>
        <button class="x" data-a="dell" title="Remove launcher (its effects are removed too)">✕</button></div>`).join('') +
      `<div class="row"><button data-a="addl">+ Add launcher</button></div><div class="muted">Col / Row are park tiles (4 m). Drag bases from the Bases tab into the 3D view, drag a launcher to move it, Shift-drag (or PageUp / PageDown) raises or lowers it, R turns the selected one. Mortars and the Catherine wheel fire fireworks, laser domes lasers, water jet bases water jets.</div>`;
  }
  $('#fw-launchers', root).addEventListener('change', ev => {
    const k = ev.target.dataset.k, row = ev.target.closest('.lnch'); if (!k || !row) return;
    snapshot();
    const l = S.show.launchers[+row.dataset.i], v = ev.target.value;
    if (k === 'type') l.type = v; else if (k === 'dir') l.dir = +v; else l[k] = S.grid ? Math.round(+v || 0) : +(+v || 0).toFixed(3);
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

  // ---- UI: the selected scenery piece -------------------------------------------------------------------------------
  function renderSceneryPanel() {
    const sec = $('#fw-scnsec', root), i = S.selScenery, s = i != null ? S.show.scenery?.[i] : null, o = sceneryObjs[i];
    sec.style.display = s ? '' : 'none';
    if (!s) return;
    const clips = o?.clips || [], cues = S.show.entries.filter(e => e.kind === 'scenery' && e.scenery === i).length;
    $('#fw-scn', root).innerHTML = `
      <div><b>${esc(s.title)}</b> <span class="muted">#${i + 1}${clips.length ? ` · ${clips.length} animation${clips.length > 1 ? 's' : ''}` : ' · not animated'}</span></div>
      ${clips.length ? `<label>Animation<select data-k="anim"><option value="loop"${(s.anim || 'loop') === 'loop' ? ' selected' : ''}>Loops all the time</option>
        <option value="cues"${s.anim === 'cues' ? ' selected' : ''}>Only when cued</option><option value="still"${s.anim === 'still' ? ' selected' : ''}>Still (except cues)</option></select></label>
      <label>Clip<select data-k="clip">${clips.map(c => `<option${c.name === (s.clip || clips[0].name) ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <div class="row"><button data-a="cue" title="Start the animation at the playhead (a block on the timeline you can line fireworks up with)">⟳ Cue at playhead</button><span class="muted">${cues} cue${cues === 1 ? '' : 's'} · ${(o.clips.find(c => c.name === (s.clip || clips[0].name))?.duration || 0).toFixed(1)} s</span></div>` : ''}
      <label>Turn<span class="row"><button data-a="l">⟲</button><button data-a="r">⟳</button><span class="muted">${S.grid ? 'quarter turns' : '15° steps'} (R)</span></span></label>
      <label>Raise (m)<input type="number" data-k="lift" step="0.5" value="${s.lift || 0}"></label>
      <div class="row"><button data-a="dup">Duplicate</button><button data-a="del">Delete</button><button data-a="done">Done</button></div>
      <div class="kbd">Drag it in the 3D view to move it; launchers standing on it move with it. Drop launchers or effects on top of it to put them there.</div>`;
  }
  $('#fw-scn', root).addEventListener('change', ev => {
    const s = S.show.scenery[S.selScenery], k = ev.target.dataset.k; if (!s || !k) return;
    snapshot();
    if (k === 'lift') { s.lift = +ev.target.value || 0; placeScenery(S.selScenery); placeAll(); }
    else s[k] = ev.target.value;
    if (k === 'clip' || k === 'anim') { const o = sceneryObjs[S.selScenery]; if (o) o.clip = null; }
    changed(); renderSceneryPanel(); renderTimeline();
  });
  $('#fw-scn', root).addEventListener('click', ev => {
    const a = ev.target.dataset.a, i = S.selScenery, s = S.show.scenery[i]; if (!a || !s) return;
    if (a === 'done') { S.selScenery = null; markScenery(); return renderSceneryPanel(); }
    if (a === 'l' || a === 'r') return turnScenery(a === 'l' ? -1 : 1);
    if (a === 'cue') return addCue(i);
    snapshot();
    if (a === 'dup') {
      S.show.scenery.push({ ...clone(s), col: s.col + (S.grid ? 2 : 1.5) }); S.selScenery = S.show.scenery.length - 1;
      changed('Duplicated'); rebuildScenery(); return;
    }
    if (a === 'del') {
      S.show.scenery.splice(i, 1);
      S.show.entries = S.show.entries.filter(e => !(e.kind === 'scenery' && e.scenery === i)).map(e => (e.kind === 'scenery' && e.scenery > i && e.scenery--, e));
      select(selList()); S.selScenery = null; S.pick = null;
      changed(`Removed ${s.title}`); rebuildScenery(); renderAll();
    }
  });
  function turnScenery(sign) {
    const s = S.show.scenery[S.selScenery]; if (!s) return;
    snapshot();
    if (S.grid) { s.dir = ((s.dir || 0) + (sign > 0 ? 1 : 3)) & 3; s.angle = 0; } else s.angle = ((s.angle || 0) + sign * 15) % 360;
    placeScenery(S.selScenery); placeAll(); markScenery(); changed(`${s.title} turned`);
  }
  function addCue(i) {
    const o = sceneryObjs[i], s = S.show.scenery[i]; if (!o?.clips.length) return;
    const clip = s.clip || o.clips[0].name, dur = o.clips.find(c => c.name === clip)?.duration || 5, time = snap(S.t);
    snapshot();
    let track = 0; while (S.show.entries.some(x => x.track === track && x.time < time + dur && x.time + fxDur(x) > time)) track++;
    const e = { kind: 'scenery', scenery: i, clip, time, track, launcher: 0, slot: 0 };
    S.show.entries.push(e); select([e], e);
    changed(`Cued ${s.title}: ${clip} at ${fmt(time)} (track ${track + 1})`); renderAll(); renderSceneryPanel();
  }

  // ---- UI: aiming control points --------------------------------------------------------------------------------
  const aimbar = $('#fw-aimbar', root);
  function renderAimBar() {
    const w = Math.ceil(timelineEnd() * S.pps) + 200;
    aimbar.innerHTML = `<div id="fw-ain" style="position:absolute;left:0;top:0;bottom:0;width:${w}px;transform:translateX(${-lanes.scrollLeft}px)">` +
      (S.show.aim || []).map((k, i) => `<div class="key${k === S.selAim ? ' sel' : k.launchers.includes(S.selLauncher) ? ' mine' : ''}" data-i="${i}" style="left:${k.t * S.pps}px"
        title="${fmt(k.t)} · yaw ${k.yaw.toFixed(0)}° pitch ${k.pitch.toFixed(0)}° · launchers ${k.launchers.map(x => '#' + (x + 1)).join(', ')} · right-click to remove"></div>`).join('') + '</div>';
  }
  // editing an aim point shows it: the playhead goes to its time (elsewhere the launchers point between points, so
  // with several points an edit barely moved them)
  function focusAim(k) { if (k && Math.abs(S.t - k.t) > 1e-3) { play(false); seek(k.t); } }
  function renderAimPanel() {
    applyAims(S.t);   // shows or hides the aim arrows
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
    if (ev.target.dataset.k === 't') { k.t = Math.max(0, +ev.target.value || 0); focusAim(k); }
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
    S.selAim = k; focusAim(k); renderAimBar(); renderAimPanel();
    aimbar.setPointerCapture(ev.pointerId);
    let moved = false;
    const x0 = ev.clientX;
    aimbar.onpointermove = e2 => {
      if (!moved && Math.abs(e2.clientX - x0) < 4) return;   // a click selects; only a real drag moves the point
      if (!moved) { snapshot(); moved = true; }
      k.t = tAt(e2.clientX); renderAimBar();
    };
    aimbar.onpointerup = () => { aimbar.onpointermove = aimbar.onpointerup = null; if (moved) { focusAim(k); changed(); renderAimPanel(); } };
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
        title="${esc(name)} · ${fmt(e.time)} · launcher #${e.launcher + 1}${kind === 'firework' ? ' tube ' + (e.slot + 1) : ''}${kind === 'firework' && d ? fxEvents(d).map(t => ' · bursts at +' + t.toFixed(2) + ' s').join('') : ''}">${KINDS[kind].icon}${esc(name)}<span class="tail" style="width:${Math.max(0, wpx - 2.2 * S.pps)}px"></span>${kind === 'firework' && d ? fxEvents(d).map(t => `<i class="ev" style="left:${t * S.pps}px"></i>`).join('') : ''}</div>`;
    });
    canvas.innerHTML = html; canvas.append(ph, drop, band);
    // ruler ticks: a label every 1/2/5/10 s depending on the time scale
    const stepS = [0.5, 1, 2, 5, 10, 15, 30].find(s => s * S.pps >= 46) || 60;
    let r = '';
    for (let t = 0; t <= timelineEnd() + stepS; t += stepS) r += `<div class="tick" style="left:${t * S.pps}px">${fmt(t)}</div>`;
    ruler.innerHTML = `<div style="position:absolute;left:0;top:0;bottom:0;width:${w}px" id="fw-rin">${r}</div>`; ruler.append(rph);
    renderAimBar(); syncScroll(); updateTime();
  }
  // when a firework bursts (as the game's MixMaster marks it on the bar): an emitter that releases many particles
  // within a moment (its window in seconds, or the whole life of a short-lived particle) - following the chain of
  // shells (emitters of 1-3 particles; the first leaves at the start of their window)
  const evCache = new WeakMap();
  function fxEvents(fw) {
    if (evCache.has(fw)) return evCache.get(fw);
    const out = [];
    const walk = (id, t0, depth) => {
      const n = fw.nodes?.[id]; if (!n || depth > 6) return;
      const life = (n.Lifetime || 0) + (n.LifetimeRandom || 0) / 2;
      for (const eid of n.ParticleEmitterDescs || []) {
        const e = fw.nodes[eid]; if (!e) continue;
        const a = e.StartTime ?? 0, b = Math.max(a, e.EndTime ?? 1), N = e.NumParticles || 0, tr = (e.TimeRandom || 0) / 2;
        if (N >= 8 && (b - a) * life <= 0.15 && t0 + a * life + tr > 0.05) out.push(t0 + a * life + tr);
        else if (N >= 1 && N <= 3) walk(String(e.ParticleDesc), t0 + a * life + tr, depth + 1);
      }
    };
    walk(String(fw.root), 0, 0);
    const ev = [...new Set(out.map(t => Math.round(t * 20) / 20))].sort((a, b) => a - b).slice(0, 8);
    evCache.set(fw, ev);
    return ev;
  }
  function syncScroll() {
    const rin = $('#fw-rin', root); if (rin) rin.style.transform = `translateX(${-lanes.scrollLeft}px)`;
    const ain = $('#fw-ain', root); if (ain) ain.style.transform = `translateX(${-lanes.scrollLeft}px)`;
    heads.scrollTop = lanes.scrollTop; updateTime();
  }
  lanes.addEventListener('scroll', syncScroll);
  function renderAll() { kick(); renderTimeline(); renderEntry(); renderShowInfo(); renderLaunchers(); renderAimPanel(); renderSceneryPanel(); }
  function renderEdits() { renderTimeline(); renderEntry(); renderShowInfo(); }   // after timeline-only edits
  const timeAt = clientX => (clientX - lanes.getBoundingClientRect().left + lanes.scrollLeft) / S.pps;
  const trackAt = clientY => Math.max(0, Math.floor((clientY - lanes.getBoundingClientRect().top + lanes.scrollTop) / S.rowH));
  const snap = (t, free) => free ? t : Math.round(t * 20) / 20;
  // scrubbing: drag the time ruler or the playhead; the show follows (and a snippet of the music plays at each spot)
  let scrubT = 0;
  function scrub(e, el) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const wasPlaying = S.playing; if (wasPlaying) play(false);
    el.setPointerCapture(e.pointerId);
    let want = timeAt(e.clientX), busy = false;
    const go = () => {
      busy = false; seek(want);
      if (musicEl.src && musicEl.readyState >= 1) {
        try { musicEl.currentTime = Math.min(S.t, musicEl.duration || S.t); } catch (err) {}
        musicEl.play().catch(() => {}); clearTimeout(scrubT); scrubT = setTimeout(() => { if (!S.playing) musicEl.pause(); }, 140);
      }
    };
    go();
    el.onpointermove = ev => { want = timeAt(ev.clientX); if (!busy) { busy = true; requestAnimationFrame(go); } };
    el.onpointerup = () => { el.onpointermove = el.onpointerup = null; if (wasPlaying) play(true); };
  }
  ruler.addEventListener('pointerdown', e => scrub(e, ruler));
  ph.addEventListener('pointerdown', e => {
    // the second click of a double-click lands on the playhead the first click moved there: let the timeline have it
    if (lastDown && performance.now() - lastDown.t < 450 && Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 6) return;
    scrub(e, ph);
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
      let banding = false, bandEls = null, lastHit = '';
      canvas.setPointerCapture(e.pointerId);
      canvas.onpointermove = ev => {
        const [x1, y1] = contentXY(ev);
        if (!banding && Math.hypot(x1 - x0, y1 - y0) < 5) return;
        banding = true;
        const L = Math.min(x0, x1), T = Math.min(y0, y1), W = Math.abs(x1 - x0), H = Math.abs(y1 - y0);
        Object.assign(band.style, { display: 'block', left: L + 'px', top: T + 'px', width: W + 'px', height: H + 'px' });
        const t0 = L / S.pps, t1 = (L + W) / S.pps, r0 = Math.floor(T / S.rowH), r1 = Math.floor((T + H) / S.rowH);
        const hit = S.show.entries.filter(x => x.track >= r0 && x.track <= r1 && x.time <= t1 && x.time + Math.max(16 / S.pps, fxDur(x)) >= t0);
        const key = hit.length + ':' + hit.map(x => S.show.entries.indexOf(x)).join(',');
        if (key === lastHit) return;   // only restyle the blocks when the set under the box changes
        lastHit = key; bandEls ??= entryEls();
        select([...new Set([...before, ...hit])]);
        for (const [x, xel] of bandEls) { xel.classList.toggle('sel', x === S.sel); xel.classList.toggle('multi', S.multi.has(x) && x !== S.sel); }
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
    // Ctrl-drag on an effect outside the selection clones just that one
    let group = cloneKey && !wasIn ? [ent] : wasIn || !add ? selList() : [...selList(), ent];
    if (!group.includes(ent)) group.push(ent);
    const x0 = e.clientX, y0 = e.clientY, t0 = ent.time; let moved = false, orig = null, els = null, minT = 0, minTr = 0;
    // capture on the timeline itself: cloning redraws the blocks, and a removed block loses the pointer (the copies
    // stayed on top of the originals)
    canvas.setPointerCapture(e.pointerId);
    canvas.onpointermove = ev => {
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
    canvas.onpointerup = () => {
      canvas.onpointermove = canvas.onpointerup = null;
      if (moved) { changed(cloneKey ? `Cloned ${group.length}` : group.length > 1 ? `Moved ${group.length} effects` : ''); renderEdits(); }
      else if (add) {   // Ctrl/Shift-click: add to or remove from the selection
        if (wasIn) { S.multi.delete(ent); select([...S.multi]); } else select([...S.multi, ent], ent);
        markSel();
      } else if (wasIn && S.multi.size > 1) { select([ent], ent); markSel(); }
      else markSel();
    };
  });
  canvas.addEventListener('contextmenu', e => {   // right-click an effect: remove it (as elsewhere in the viewer)
    const el = e.target.closest('.ent'); if (!el) return;
    e.preventDefault();
    const ent = S.show.entries[+el.dataset.i]; if (!ent) return;
    if (S.multi.has(ent) && S.multi.size > 1) { removeSel(); return; }   // part of a selection: remove the whole selection
    snapshot(); S.show.entries = S.show.entries.filter(x => x !== ent); S.multi.delete(ent); select([...S.multi]);
    changed(`Removed ${fx(ent)?.title || 'the effect'} (Ctrl+Z brings it back)`); renderEdits();
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
    let li = compatibleLauncher(kind); const li0 = li;
    if (li < 0) { li = addLauncher(BASE_FOR[kind]); rebuildLaunchers(); toast(`Added a ${LAUNCHER_NAMES[BASE_FOR[kind]]} launcher (#${li + 1}) for it`); }
    // next free tube on that launcher around this time
    const used = new Set(S.show.entries.filter(x => x.launcher === li && Math.abs(x.time - time) < 3).map(x => x.slot));
    let slot = 0; while (used.has(slot) && slot < tubeCount(li) - 1) slot++;
    const e = { kind, firework: key, launcher: li, slot, time, track };
    S.show.entries.push(e); select([e], e);
    changed(`Added ${REG[kind][key].title} at ${fmt(time)}`); li === li0 ? renderEdits() : renderAll();
  }
  function removeSel() {
    const sel = selList(); if (!sel.length) return;
    snapshot(); S.show.entries = S.show.entries.filter(x => !S.multi.has(x)); select([]);
    changed(sel.length > 1 ? `Deleted ${sel.length} effects` : 'Deleted'); renderEdits();
  }
  function duplicate() {
    const sel = selList(); if (!sel.length) return;
    const t0 = Math.min(...sel.map(x => x.time)), t1 = Math.max(...sel.map(x => x.time));
    const off = snap(t1 - t0 + 0.5);
    snapshot();
    const copies = sel.map(x => ({ ...clone(x), time: x.time + off }));
    S.show.entries.push(...copies); select(copies);
    changed(sel.length > 1 ? `Duplicated ${sel.length} effects` : 'Duplicated'); renderEdits();
  }
  // clipboard: kept in the browser, so a part of one show can be pasted into another (even after a reload)
  function copySel(cut) {
    const sel = selList().sort((a, b) => a.time - b.time);
    if (!sel.length) { toast('Select effects first: drag a box on the timeline, or Ctrl-click'); return; }
    clip = { entries: clone(sel), launchers: Object.fromEntries(sel.map(x => [x.launcher, S.show.launchers[x.launcher]?.type])),
             custom: withCustom({ ...S.show, entries: sel }).custom };
    store.set('rct3fw.clipboard', clip);
    if (cut) { snapshot(); S.show.entries = S.show.entries.filter(x => !S.multi.has(x)); select([]); changed(); renderEdits(); }
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
    changed(`Pasted ${add.length} effect${add.length > 1 ? 's' : ''} at ${fmt(at)}`); renderEdits();
  }
  function nudge(dt, dtr) {
    const sel = selList(); if (!sel.length) return;
    const minT = Math.min(...sel.map(x => x.time)), minTr = Math.min(...sel.map(x => x.track));
    dt = Math.max(-minT, dt); dtr = Math.max(-minTr, dtr);
    if (!dt && !dtr) return;
    snapshot(); for (const x of sel) { x.time = +(x.time + dt).toFixed(3); x.track += dtr; } changed(); renderEdits();
  }
  function previewSel() {
    const sel = selList().sort((a, b) => a.time - b.time); if (!sel.length) return;
    audio(); const t0 = sel[0].time;
    for (const x of sel) setTimeout(() => fireNow(x), (x.time - t0) * 1000 / S.speed);
  }
  const zoom = k => { const mid = timeAt(lanes.getBoundingClientRect().left + lanes.clientWidth / 2); S.pps = clamp(S.pps * k, 6, 400); renderTimeline(); lanes.scrollLeft = mid * S.pps - lanes.clientWidth / 2; syncScroll(); };
  $('#fw-zin', root).onclick = () => zoom(1.5); $('#fw-zout', root).onclick = () => zoom(1 / 1.5);
  lanes.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.25 : 0.8); } }, { passive: false });

  // ---- 3D: drop bases and effects into the scene (with a see-through preview), move launchers --------------------------
  let dragState = null, ghost = null, ghostType = null, dropTarget = -1;
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.45, depthWrite: false });
  async function setGhost(type) {
    if (ghostType === type) return;
    ghostType = type;
    if (ghost) { scene.remove(ghost); ghost = null; }
    if (!type) return;
    const scn = type.startsWith('scn:'), def = await (scn ? sceneryModel(type.slice(4)) : launcherDef(type)); if (ghostType !== type) return;
    ghost = def ? (scn ? cloneSkinned(def.gltf.scene) : def.gltf.scene.clone(true)) : new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    ghost.traverse(o => { if (o.isMesh) { o.material = ghostMat; o.raycast = () => {}; } });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.9, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.8, depthTest: false }));
    ring.position.y = 0.15; ring.renderOrder = 11; ghost.add(ring);
    scene.add(ghost);
  }
  function launcherUnder(e) {
    ray.setFromCamera(ndc(e), camera);
    const hit = ray.intersectObjects(pickers, false)[0];
    return hit ? hit.object.userData.launcher ?? -1 : -1;
  }
  const card = $('#fw-dragcard', root);
  let cardHtml = '';
  function showCard(e, html) {
    if (!html) { card.style.display = 'none'; cardHtml = ''; return; }
    if (html !== cardHtml) { card.innerHTML = html; cardHtml = html; }
    card.style.display = 'block'; card.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 14}px)`; card.style.left = '0'; card.style.top = '0';
  }
  function endDrag3d() { dragState = null; dragEv = null; cancelAnimationFrame(dragRaf); dragRaf = 0; dragMove.lastTarget = undefined; setGhost(null); showCard(null); dropTarget = -1; obj3dMarkSel(); }
  let dragEv = null, dragRaf = 0;
  view.addEventListener('dragover', e => {
    if (!dragState) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    dragEv = { clientX: e.clientX, clientY: e.clientY };
    if (!dragRaf) dragRaf = requestAnimationFrame(() => { dragRaf = 0; if (dragState && dragEv) dragMove(dragEv); });
  });
  function dragMove(e) {   // the drop preview: ghost model, target launcher, card (at most once per frame)
    const p = pointHit(e);
    if (dragState.scenery) {
      if (!p) return;
      setGhost('scn:' + dragState.scenery);
      const pl = placementAt('', p.x, p.z), [x, z] = worldOf({ ...pl, corner: -1 });
      if (ghost) ghost.position.set(x, surfaceAt(x, z), z);
      showCard(e, `Place <b>${esc(dragState.title)}</b> · ${S.grid ? `tile ${pl.col}, ${pl.row}` : 'free'}`);
      return;
    }
    if (dragState.base) {
      if (!p) return;
      setGhost(dragState.base);
      const pl = placementAt(dragState.base, p.x, p.z), [x, z] = worldOf(pl);
      if (ghost) { ghost.position.set(x, surfaceAt(x, z), z); ghost.rotation.y = 0; }
      showCard(e, `Place <b>${esc(LAUNCHER_NAMES[dragState.base])}</b> · ${S.grid ? `tile ${pl.col}, ${pl.row}` : 'free'}`);
      return;
    }
    // an effect: onto a matching launcher, or onto the ground (a new matching base is placed there)
    const kind = dragState.kind, li = launcherUnder(e), d = REG[kind][dragState.key];
    const ok = li >= 0 && fits(kind, S.show.launchers[li]?.type);
    dropTarget = ok ? li : -1;
    if (dropTarget !== dragMove.lastTarget) { dragMove.lastTarget = dropTarget; launcherObjs.forEach((o, i) => o.label.element.classList.toggle('sel', i === dropTarget)); }
    if (ok) { setGhost(null); showCard(e, `${KINDS[kind].icon}<b>${esc(d?.title)}</b> → launcher #${li + 1} at ${fmt(S.t)}`); return; }
    if (!p) return;
    setGhost(BASE_FOR[kind]);
    const pl = placementAt(BASE_FOR[kind], p.x, p.z), [x, z] = worldOf(pl);
    if (ghost) ghost.position.set(x, surfaceAt(x, z), z);
    showCard(e, `${KINDS[kind].icon}<b>${esc(d?.title)}</b> on a new ${esc(LAUNCHER_NAMES[BASE_FOR[kind]])} at ${fmt(S.t)}`);
  }
  view.addEventListener('dragleave', e => { if (!view.contains(e.relatedTarget)) { setGhost(null); showCard(null); } });
  view.addEventListener('drop', async e => {
    if (!dragState) return;
    e.preventDefault();
    const st = dragState, p = pointHit(e), target = dropTarget;
    endDrag3d();
    if (st.scenery) {
      if (!p) return;
      const pl = placementAt('', p.x, p.z);
      snapshot(); S.show.scenery.push({ name: st.scenery, title: st.title, col: pl.col, row: pl.row, dir: 0, anim: 'loop' });
      S.selScenery = S.show.scenery.length - 1; S.pick = 'scenery';
      changed(`Placed ${st.title} (scenery #${S.selScenery + 1})`); await rebuildScenery(); renderAll(); return;
    }
    if (st.base) {
      if (!p) return;
      snapshot(); S.show.launchers.push({ type: st.base, dir: 0, ...placementAt(st.base, p.x, p.z) });
      S.selLauncher = S.show.launchers.length - 1;
      changed(`Placed ${LAUNCHER_NAMES[st.base]} (#${S.selLauncher + 1})`); await rebuildLaunchers(); renderAll(); return;
    }
    let li = target;
    snapshot();
    if (li < 0) {
      if (!p) return;
      S.show.launchers.push({ type: BASE_FOR[st.kind], dir: 0, ...placementAt(BASE_FOR[st.kind], p.x, p.z) });
      li = S.show.launchers.length - 1; await rebuildLaunchers();
    }
    S.selLauncher = li;
    const d = REG[st.kind][st.key], time = snap(S.t), dur = d?.duration || 3;
    let track = 0; while (S.show.entries.some(x => x.track === track && x.time < time + dur && x.time + fxDur(x) > time)) track++;
    const used = new Set(S.show.entries.filter(x => x.launcher === li && Math.abs(x.time - time) < 3).map(x => x.slot));
    let slot = 0; while (used.has(slot) && slot < tubeCount(li) - 1) slot++;
    const ent = { kind: st.kind, firework: st.key, launcher: li, slot, time, track };
    S.show.entries.push(ent); select([ent], ent);
    changed(`Added ${d?.title} on launcher #${li + 1} at ${fmt(time)} (track ${track + 1})`); renderAll(); fireNow(ent);
  });

  // ---- 3D: click a launcher to select it; drag it to move it; aim with the mouse; landscape brushes --------------------
  const ray = new THREE.Raycaster(); let downAt = null;
  const ndc = e => { const r = renderer.domElement.getBoundingClientRect(); return new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); };
  let tool = null, painting = false, brushPt = null, flatTarget = 0, aimDrag = null, moveDrag = null;
  const groundHit = e => { ray.setFromCamera(ndc(e), camera); return terrain.raycast(ray.ray); };
  // the point under the mouse on scenery or the ground (so things can be put on top of scenery); `exclude`: a piece being moved
  function pointHit(e, exclude) {
    ray.setFromCamera(ndc(e), camera);
    const g = terrain.raycast(ray.ray), gd = g ? g.distanceTo(ray.ray.origin) : Infinity;
    if (sceneryGroup.children.length) for (const h of ray.intersectObjects(sceneryGroup.children, true)) {
      if (h.distance > gd) break;
      let o = h.object, mine = false; while (o) { if (o === exclude) { mine = true; break; } o = o.parent; }
      if (!mine) return h.point;
    }
    return g;
  }
  const sceneryUnder = e => { ray.setFromCamera(ndc(e), camera); const h = ray.intersectObjects(sceneryGroup.children, true)[0]; return h ? h.object.userData.scenery ?? null : null; };
  view.addEventListener('pointerdown', e => {   // capture phase: before the orbit controls see it
    if (e.target !== renderer.domElement || e.button !== 0) return;
    if (tool) {
      const p = groundHit(e); if (!p) return;
      controls.enabled = false; painting = true; brushPt = p; flatTarget = terrain.heightAt(p.x, p.z); snapshot();
      renderer.domElement.setPointerCapture(e.pointerId); return;
    }
    ray.setFromCamera(ndc(e), camera);
    const hit = ray.intersectObjects(pickers, false)[0], li = hit ? hit.object.userData.launcher : null;
    if (S.selAim && li != null && S.selAim.launchers.includes(li)) {
      focusAim(S.selAim);
      controls.enabled = false; aimDrag = { x: e.clientX, y: e.clientY, yaw: S.selAim.yaw, pitch: S.selAim.pitch }; snapshot();
      renderer.domElement.setPointerCapture(e.pointerId); return;
    }
    if (li != null && S.show.launchers[li]) {   // press on a launcher: drag to move it (a click still just selects it)
      controls.enabled = false; moveDrag = { li, x: e.clientX, y: e.clientY, moved: false, lift: e.shiftKey, lift0: S.show.launchers[li].lift || 0 };
      renderer.domElement.setPointerCapture(e.pointerId); return;
    }
    const si = sceneryUnder(e);
    if (si != null && S.show.scenery[si]) {   // press on a scenery piece: drag to move it, with the launchers standing on it
      controls.enabled = false; moveDrag = { si, x: e.clientX, y: e.clientY, moved: false, lift: e.shiftKey, lift0: S.show.scenery[si].lift || 0 };
      renderer.domElement.setPointerCapture(e.pointerId);
    }
  }, true);
  renderer.domElement.addEventListener('pointermove', e => {
    if (tool) { const p = groundHit(e); terrain.showRing(p?.x, p?.z, +$('#fw-bsize', root).value); if (painting && p) brushPt = p; }
    if (moveDrag?.lift) {   // Shift-drag: raise / lower the launcher or scenery piece (up = higher)
      if (!moveDrag.moved && Math.abs(e.clientY - moveDrag.y) < 3) return;
      const it = moveDrag.si != null ? S.show.scenery[moveDrag.si] : S.show.launchers[moveDrag.li];
      const obj = moveDrag.si != null ? sceneryObjs[moveDrag.si]?.obj : launcherObjs[moveDrag.li]?.obj; if (!it || !obj) return;
      if (!moveDrag.moved) { snapshot(); moveDrag.moved = true; }
      const mPerPx = 2 * Math.tan(camera.fov * D2R / 2) * camera.position.distanceTo(obj.getWorldPosition(new THREE.Vector3())) / Math.max(1, view.clientHeight);
      it.lift = clamp(Math.round((moveDrag.lift0 + (moveDrag.y - e.clientY) * mPerPx) * 10) / 10, -30, 200);
      if (moveDrag.si != null) placeScenery(moveDrag.si);
      placeAll();
      showCard(e, `${esc(moveDrag.si != null ? it.title : '#' + (moveDrag.li + 1) + ' ' + LAUNCHER_NAMES[it.type])} · raised ${it.lift.toFixed(1)} m`);
      return;
    }
    if (moveDrag && moveDrag.si != null) {
      if (!moveDrag.moved && Math.hypot(e.clientX - moveDrag.x, e.clientY - moveDrag.y) < 5) return;
      const o = sceneryObjs[moveDrag.si], s = S.show.scenery[moveDrag.si]; if (!o || !s) return;
      const p = pointHit(e, o.obj); if (!p) return;
      if (!moveDrag.moved) {
        snapshot(); moveDrag.moved = true; S.selScenery = moveDrag.si; S.pick = 'scenery';
        // launchers standing on this piece ride along
        moveDrag.riders = S.show.launchers.map((l, i) => i).filter(i => { const [x, z] = worldOf(S.show.launchers[i]); return surfaceAt(x, z, o.obj) < surfaceAt(x, z) - 0.05; });
        moveDrag.c0 = s.col; moveDrag.r0 = s.row; moveDrag.lpos = moveDrag.riders.map(i => [S.show.launchers[i].col, S.show.launchers[i].row]);
      }
      const pl = placementAt('', p.x, p.z); s.col = pl.col; s.row = pl.row;
      moveDrag.riders.forEach((i, k) => { const l = S.show.launchers[i]; l.col = +(moveDrag.lpos[k][0] + s.col - moveDrag.c0).toFixed(3); l.row = +(moveDrag.lpos[k][1] + s.row - moveDrag.r0).toFixed(3); });
      placeScenery(moveDrag.si); placeAll(); markScenery();
      showCard(e, `${esc(s.title)} · ${S.grid ? `tile ${s.col}, ${s.row}` : 'free'}${moveDrag.riders.length ? ` · carrying ${moveDrag.riders.length} launcher${moveDrag.riders.length > 1 ? 's' : ''}` : ''}`);
      return;
    }
    if (moveDrag) {
      if (!moveDrag.moved && Math.hypot(e.clientX - moveDrag.x, e.clientY - moveDrag.y) < 5) return;
      const p = pointHit(e); if (!p) return;
      if (!moveDrag.moved) { snapshot(); moveDrag.moved = true; S.selLauncher = moveDrag.li; obj3dMarkSel(); }
      const l = S.show.launchers[moveDrag.li]; Object.assign(l, placementAt(l.type, p.x, p.z));
      placeLauncher(launcherObjs[moveDrag.li].obj, l); applyAims(S.t);
      showCard(e, `#${moveDrag.li + 1} ${esc(LAUNCHER_NAMES[l.type])} · ${S.grid ? `tile ${l.col}, ${l.row}` : 'free'}`);
    }
    if (aimDrag && S.selAim) {
      S.selAim.yaw = clamp(Math.round(aimDrag.yaw + (e.clientX - aimDrag.x) * 0.5), -180, 180);
      S.selAim.pitch = clamp(Math.round(aimDrag.pitch - (e.clientY - aimDrag.y) * 0.4), -80, 80);
      applyAims(S.t);   // the panel's sliders follow (rebuilding the panel on every move was wasted work)
      for (const f of ['yaw', 'pitch']) { const inp = $(`#fw-aim [data-k="${f}"]`, root); if (inp) inp.value = S.selAim[f]; }
    }
  });
  renderer.domElement.addEventListener('pointerleave', () => terrain.showRing(null));
  const endDrag = () => {
    if (painting) { painting = false; controls.enabled = true; S.show.terrain = terrain.getData(); placeAll(); changed(); }
    if (aimDrag) { aimDrag = null; controls.enabled = true; changed(); renderAimBar(); }
    if (moveDrag) {
      const m = moveDrag; moveDrag = null; controls.enabled = true; showCard(null);
      if (m.moved) { changed(m.lift ? 'Raised to ' + ((m.si != null ? S.show.scenery[m.si] : S.show.launchers[m.li])?.lift || 0).toFixed(1) + ' m' : m.si != null ? `Moved ${S.show.scenery[m.si]?.title}` : `Moved launcher #${m.li + 1}`); renderLaunchers(); renderSceneryPanel(); return 'moved'; }
    }
  };
  renderer.domElement.addEventListener('pointerup', e => {
    const wasPaint = painting || aimDrag; const res = endDrag();
    if (wasPaint || tool || res === 'moved') return;
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
    ray.setFromCamera(ndc(e), camera);
    const hit = ray.intersectObjects(pickers, false)[0];
    if (hit && hit.object.userData.launcher != null) { S.selLauncher = hit.object.userData.launcher; S.pick = 'launcher'; obj3dMarkSel(); markScenery(); renderLaunchers(); renderAimBar(); toast(`Launcher #${S.selLauncher + 1} selected`); return; }
    const si = sceneryUnder(e);
    S.selScenery = si; S.pick = si != null ? 'scenery' : null; markScenery(); renderSceneryPanel();
    if (si != null) toast(`${S.show.scenery[si]?.title} selected · drag to move · Shift-drag to raise or lower · R to turn · Delete to remove`);
  });
  renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  S.grid = store.get('rct3fw.grid') ?? true;
  $('#fw-grid', root).classList.toggle('on', S.grid);
  $('#fw-grid', root).onclick = ev => { S.grid = !S.grid; store.set('rct3fw.grid', S.grid); ev.target.classList.toggle('on', S.grid); renderLib(); renderLaunchers();
    toast(S.grid ? 'Grid placement: bases snap to park tiles (small ones to tile corners)' : 'Free placement: put bases anywhere; R turns the selected one 15°'); };
  const landp = $('#fw-landp', root);
  $('#fw-land', root).onclick = ev => {
    const on = !landp.classList.contains('on'); landp.classList.toggle('on', on); ev.target.classList.toggle('on', on);
    if (!on) { tool = null; terrain.showRing(null); landp.querySelectorAll('.tools button').forEach(b => b.classList.remove('on')); }
    $('#fw-hint', root).textContent = on ? 'Pick a tool, then left-drag on the ground · right-drag to pan · wheel to zoom' : 'Drag to orbit · right-drag to pan · wheel to zoom · click a launcher to select it · Shift-drag a launcher or scenery to raise or lower it';
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
        ${sh.scenery?.length ? `<li>The ${sh.scenery.length} scenery piece${sh.scenery.length > 1 ? 's' : ''} and their cues stay here (a display has no scenery: place it in the park).</li>` : ''}
        ${sh.launchers.some(l => l.col % 1 || l.row % 1 || l.angle) ? '<li>Freely placed or turned launchers are snapped to the nearest tile and facing.</li>' : ''}
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
          launchers: sh.launchers.map(l => ({ ...l, col: Math.round(l.col), row: Math.round(l.row), dir: ((l.dir || 0) + Math.round((l.angle || 0) / 90)) & 3 })), entries: fw.map(e => ({ ...e, firework: map[e.firework] || e.firework })) };
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
    else { const d = data.displays[+v.slice(1)]; if (!d) { setShow(blank()); return; } setShow(clone({ name: d.name, music: d.music, start_minutes: d.start_minutes, launchers: d.launchers, entries: d.entries })); }
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
  // Open… / files dropped on the MixMaster: a show saved from this editor (.json), or a firework (.frw), laser (.las)
  // or water jet (.wjt) file from anywhere (downloaded, made in the game) - added to your effects and previewed
  async function openLocal(f) {
    try {
      if (/\.(frw|las|wjt)$/i.test(f.name)) {
        const buf = new Uint8Array(await f.arrayBuffer());
        let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        const r = await fetch('/api/fw/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, b64: btoa(bin) }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText);
        const { kind, def } = j;
        def.title = def.title || def.name || f.name.replace(/\.[^.]+$/, ''); def.file = f.name;
        const same = Object.entries(mine[kind]).find(([, d]) => d.file === f.name)?.[0];   // opened again: replaced
        const key = saveMine(kind, def, same);
        S.tab = kind; $('#fw-search', root).value = ''; renderLib();
        lib.querySelectorAll('.fwk.sel').forEach(x => x.classList.remove('sel'));
        const row = [...lib.querySelectorAll('.fwk')].find(x => x.dataset.f === key);
        if (row) { row.classList.add('sel'); row.scrollIntoView({ block: 'center' }); }
        preview(kind, key);
        toast(`Opened ${f.name}: added to your ${kind === 'jet' ? 'water jets' : kind + 's'}`);
        return;
      }
      const j = JSON.parse(await f.text());
      if (!Array.isArray(j.entries) || !Array.isArray(j.launchers)) throw new Error('not a fireworks show');
      const { format, version, ...sh } = j; sh.name = sh.name || f.name;
      setShow(sh); changed('Opened ' + f.name);
    } catch (e) { toast('Could not open ' + f.name + ': ' + e.message); }
  }
  $('#fw-file', root).onchange = async ev => {
    for (const f of ev.target.files) await openLocal(f);
    ev.target.value = '';
  };
  root.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  root.addEventListener('drop', e => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    (async () => { for (const f of e.dataTransfer.files) await openLocal(f); })();
  });
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
    else if ((k === 'delete' || k === 'backspace') && S.pick === 'scenery' && S.selScenery != null && !S.multi.size) { e.preventDefault(); $('#fw-scn [data-a="del"]', root)?.click(); }
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
    else if (k === 'pageup' || k === 'pagedown') {   // raise / lower the selected scenery piece or launcher by 0.5 m (Shift: 2 m)
      const it = S.pick === 'scenery' && S.selScenery != null ? S.show.scenery[S.selScenery] : S.show.launchers[S.selLauncher]; if (!it) return;
      e.preventDefault(); snapshot();
      it.lift = clamp(+((it.lift || 0) + (k === 'pageup' ? 1 : -1) * (e.shiftKey ? 2 : 0.5)).toFixed(1), -30, 200);
      if (S.pick === 'scenery' && S.selScenery != null) placeScenery(S.selScenery);
      placeAll(); renderSceneryPanel(); changed('Raised to ' + it.lift.toFixed(1) + ' m');
    }
    else if (k === '+' || k === '=') zoom(1.5);
    else if (k === '-') zoom(1 / 1.5);
    else if (k === 'f' && S.multi.size) previewSel();
    else if (k === 'r' && S.pick === 'scenery' && S.selScenery != null && !e.ctrlKey) turnScenery(e.shiftKey ? -1 : 1);
    else if (k === 'r' && S.show.launchers[S.selLauncher] && !e.ctrlKey) {   // turn the selected launcher: a quarter on the grid, 15° free
      const l = S.show.launchers[S.selLauncher]; snapshot();
      if (S.grid) { l.dir = ((l.dir || 0) + (e.shiftKey ? 3 : 1)) & 3; l.angle = 0; } else l.angle = ((l.angle || 0) + (e.shiftKey ? -15 : 15)) % 360;
      applyAims(S.t); changed(`Launcher #${S.selLauncher + 1} turned`); renderLaunchers();
    }
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
  let running = false, acc = 0, lastRender = 0;
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
    pclock += dt * S.speed; skyMat.uniforms.time.value += dt;
    previews = previews.filter(pv => { const d = pv.def?.duration || 5; if (pclock - pv.t0 > d) { if (pv.loop) { pv.t0 = pclock + 0.6; return true; } return pv.kind === 'jet' && pclock - pv.t0 < d + 0.1; } return true; });
    // particles: fixed 1/60 s steps, scaled by playback speed (preview fireworks run even while paused)
    acc += dt * (S.playing ? S.speed : 1);
    let n = 0;
    while (acc >= 1 / 60 && n++ < 8) { if (S.playing) effectsStep(S.t, 1 / 60); else effectsStep(-1e9, 1 / 60); step(1 / 60); acc -= 1 / 60; }
    if (n >= 8) acc = 0;
    for (const o of launcherObjs) o.mixer?.update(dt * (S.playing ? S.speed : 0.3));
    animateScenery(dt);
    if (camMode === 'orbit') { const a = 0.08 * dt, p = camera.position, c = controls.target; const x = p.x - c.x, z = p.z - c.z; p.x = c.x + x * Math.cos(a) - z * Math.sin(a); p.z = c.z + x * Math.sin(a) + z * Math.cos(a); }
    if (camMode === 'auto') autolook(dt);
    controls.update();
    ribbons.setPixel(camera, view.clientHeight); drawEffects(); draw();
    $('#fw-stats', root).textContent = `${parts.length.toLocaleString()} particles${ribbons.count() ? ' · ' + ribbons.count() + ' beams' : ''}`;
    // draw the 3D view only when something in it can have changed: an idle scene at full rate (with glow) competed
    // with the timeline for the computer, making drags and selections there laggy on slower machines
    const now = performance.now();
    const busy = S.playing || parts.length || ghosts.length || ribbons.count() || previews.length || camMode === 'orbit' || camMode === 'auto' || painting
      || dragState || moveDrag || aimDrag || now < renderUntil || now - lastRender > 1000
      || launcherObjs.some(o => o.mixer) || sceneryObjs.some(o => o.mixer);
    if (!busy) return;
    lastRender = now;
    if (useBloom) composer.render(); else renderer.render(scene, camera);
    labels.render(scene, camera);
  }
  function start() { if (!running) { running = true; clock.getDelta(); renderer.setAnimationLoop(frame); } }
  function stop() { running = false; renderer.setAnimationLoop(null); play(false); }
  function flushAutosave() { if (autosaveT) { clearTimeout(autosaveT); autosaveT = 0; store.set('rct3fw.autosave', withCustom(S.show)); } }
  window.addEventListener('pagehide', flushAutosave);
  function close() { flushAutosave(); stop(); root.style.display = 'none'; ui.onBack?.(); }

  // ---- go ---------------------------------------------------------------------------------------------------------------
  renderLib(); fillShows();
  const auto = store.get('rct3fw.autosave');
  // start on your autosaved show, or a new empty one (no game show needed: any of them may have been removed)
  if (auto) { showSel.value = 'auto'; setShow(auto); } else { showSel.value = 'new'; openChoice('new'); }
  // ---- the MixMaster walkthrough -----------------------------------------------------------------------------------
  const wait = (ms = 300) => new Promise(r => setTimeout(r, ms));
  const tab = async k => { S.tab = k; $('#fw-search', root).value = ''; renderLib(); await wait(250); };
  const panel = (id, btn, on) => { const p = $(id, root); if (p.classList.contains('on') !== on) $(btn, root).click(); };
  const closePanels = () => { panel('#fw-landp', '#fw-land', false); panel('#fw-scenep', '#fw-scenebtn', false); };
  const FW_TOUR = [
    { title: 'Welcome to the MixMaster',
      html: `<p>The MixMaster is a show editor like the one in RCT3 Soaked!: fireworks, lasers and water jets on a timeline, set to music, on
        launchers you place in a 3D park. Everything is simulated from the game's own files.</p>
        <p>This tour covers every part of it. <b>← Back</b> (top left) or <kbd>Esc</kbd> returns to the viewer; <b>? Tour</b> replays this.</p>`,
      before: async () => { closePanels(); } },
    { target: '#fw-show', title: 'Shows',
      html: `<p>Open one of the game's shows (Haunted Skies, Lunar Lights, Pirate Pyrotechnics, Stratosphere: whichever are in your game folder), your autosaved show, or a new empty one. The MixMaster starts on your autosaved show, or an empty one.</p>
        <ul><li><b>New</b> starts an empty show with a few launchers.</li><li><b>Save</b> downloads your show as a file; <b>Open…</b> loads it again.</li>
        <li>Your work is also autosaved in the browser all the time.</li></ul>` },
    { target: '#fw-export', title: 'Export to RCT3',
      html: `<p>Turns the show into a MixMaster display file (<code>.fwd</code>) for the game: download it, or save it straight into the game's
        <b>FireworkDisplays</b> folder, together with any fireworks you made yourself.</p>
        <p>The window tells you what the game's display format can't hold (lasers, water jets, aiming, landscape, scenery, colour and strength changes).
        The game's own files are never overwritten.</p>` },
    { target: '#fw-play', title: 'Playing the show',
      html: `<ul><li><b>Play / Pause</b> (<kbd>Space</kbd>) and <b>■</b> to stop and rewind (<kbd>Home</kbd>).</li>
        <li>The clock shows where you are and how long the show runs.</li>
        <li>The speed menu plays it at ¼×, ½×, 1× or 2× (slow motion helps timing).</li></ul>` },
    { target: '#fw-music', title: 'Music and volume',
      html: `<p>Pick one of the game's music tracks, or <b>Choose a music file…</b> to use any song on your computer. The show and music stay in step,
        also when you jump around the timeline. The slider sets the volume of the music and the effects' sounds.</p>` },
    { target: '#fw-grid', title: 'Grid snap',
      html: `<p><b>On:</b> launchers and scenery snap to the park's 4 m tiles (small bases to tile corners, as in the game), and <kbd>R</kbd> turns a quarter.</p>
        <p><b>Off:</b> place things anywhere, and <kbd>R</kbd> turns 15° at a time.</p>` },
    { target: '#fw-landp', title: 'Landscape',
      before: async () => { closePanels(); panel('#fw-landp', '#fw-land', true); await wait(200); },
      html: `<p>Shape the ground around the show: <b>Raise</b>, <b>Lower</b>, <b>Smooth</b> and <b>Flatten</b>, and paint <b>Water</b> at the level you set
        (<b>Dry</b> removes it). Pick a tool, then left-drag on the ground; the ring shows the brush size.</p>
        <p>Fireworks and lasers reflect in the water. <b>Flatten all</b> and <b>Remove water</b> reset it. The button <b>Landscape</b> opens and closes this panel.</p>` },
    { target: '#fw-scenep', title: 'Scene: day, night, backdrop, ground',
      before: async () => { closePanels(); panel('#fw-scenep', '#fw-scenebtn', true); await wait(200); },
      html: `<ul><li><b>Time of day:</b> Day, Sunset or Night, with the game's own sky colours, clouds and stars. Day makes placing things easy; night
        is how the show looks in the park.</li><li><b>Backdrop:</b> the game's skylines (Hill, City, Desert…).</li>
        <li><b>Tile grid lines</b> on or off, and the <b>ground</b>: plain night grass or any of the game's 32 ground textures.</li></ul>
        <p>These are kept with the show.</p>` },
    { target: '#fw-cam', title: 'Camera and glow',
      before: async () => { closePanels(); },
      html: `<p>Camera views: <b>Crowd view</b>, <b>Autolook</b> (follows the bursts), <b>Close up</b>, <b>Top down</b>, <b>Slow orbit</b> and <b>Freelook</b>.
        <b>Glow</b> switches the bloom effect.</p>` },
    { target: '#fw-ptabs', title: 'The palette',
      before: async () => { await tab('firework'); },
      html: `<p>Everything you can add: <b>Fireworks</b>, <b>Lasers</b>, <b>Water Jets</b>, <b>Scenery</b> and <b>Bases</b> (the launchers).</p>
        <ul><li><b>▶</b> previews an effect in the 3D view, <b>✎</b> edits it (a game effect is copied first).</li>
        <li><b>Drag</b> an effect onto the timeline, or into the 3D view onto a launcher (or onto open ground: a matching launcher is placed there).</li>
        <li>The search box filters the list; <b>$</b> at the bottom shows or hides prices; <b>↻ Reload</b> picks up new files in the game folder.</li></ul>` },
    'EDITORS',
    { target: '#fw-lib', title: 'Scenery',
      before: async () => { await tab('scenery'); await wait(800); },
      html: `<p>Any of the game's 1,330 scenery pieces. Drag one into the 3D view to place it (a see-through preview follows the mouse). Filter by category or
        <b>animated only</b>.</p><ul><li>Click a piece to select it, drag to move it, <kbd>R</kbd> turns it, <kbd>Delete</kbd> removes it.</li>
        <li>Put launchers on top of scenery: they stand on the highest surface and move with the piece.</li>
        <li>Animated pieces loop, play only when cued, or stand still. <b>Cue at playhead</b> (in the piece's panel) adds a block to the timeline to
        time fireworks with the animation.</li></ul>` },
    { target: '#fw-lib', title: 'Bases (launchers)',
      before: async () => { await tab('base'); await wait(300); },
      html: `<p>The six MixMaster bases: mortars, the mortar wall and Catherine wheel fire <b>fireworks</b>, the laser dome fires <b>lasers</b>, the water jet
        base fires <b>water jets</b>. Drag one into the 3D view to place it.</p>` },
    { target: '#fw-view', title: 'The 3D view',
      before: async () => { await tab('firework'); },
      html: `<ul><li>Drag to orbit, right-drag to pan, scroll to zoom.</li><li>Click a launcher (numbered labels) or scenery piece to select it;
        drag it to move it; <kbd>R</kbd> turns it.</li><li>Drop palette items here to place them.</li>
        <li>The numbers at the top right count particles and laser beams.</li></ul>` },
    { target: '#fw-lanes', title: 'The timeline',
      html: `<p>Each block is one firework, laser, water jet or scenery cue, starting where its left edge is and as long as it runs. Tracks are just rows to
        keep things tidy.</p><ul><li><b>Add:</b> drag from the palette, or double-click an empty spot to add the item picked in the palette.</li>
        <li><b>Move:</b> drag a block (sideways = time, up/down = track). <kbd>Alt</kbd> turns snapping off.</li>
        <li><b>Remove:</b> right-click a block (or select it and press <kbd>Delete</kbd>).</li>
        <li>Thin lines on a firework's block mark the moments it bursts.</li>
        <li><b>Select several:</b> drag a box over empty space, or <kbd>Ctrl</kbd>/<kbd>Shift</kbd>-click. <kbd>Ctrl+A</kbd> selects all.</li>
        <li><b>Ctrl-drag</b> clones; <kbd>Ctrl+C</kbd> <kbd>Ctrl+X</kbd> <kbd>Ctrl+V</kbd> copy, cut and paste at the playhead (also into another show);
        <kbd>Ctrl+D</kbd> duplicates; <kbd>Delete</kbd> removes; <kbd>←</kbd> <kbd>→</kbd> nudge, <kbd>↑</kbd> <kbd>↓</kbd> change track.</li></ul>` },
    { target: '#fw-ruler', title: 'Time ruler and time scale',
      html: `<p>Click or drag on the ruler (or drag the red playhead) to scrub: the sky shows exactly what would be in the air then, and a snippet of the
        music plays. Play starts the music from the playhead (pastes and drops go there too). <b>−</b> / <b>+</b> on the left (or <kbd>Ctrl</kbd>+scroll) change the time scale.</p>` },
    { target: '#fw-aimbar', title: 'Base aiming controls',
      html: `<p>Click this bar to add an <b>angle control point</b> for the selected launcher at that time; turn and tilt it in the right-hand panel, or
        drag the green-highlighted launcher in the 3D view. The launcher turns smoothly from point to point during the show.</p>
        <p>One point can control several launchers; right-click a point to remove it.</p>` },
    { target: '#fw-entry', title: 'The selected effect',
      html: `<p>Click a block to edit it here: which firework / laser / jet, its launcher and tube, time and track, its <b>colour</b> and, for fireworks,
        its <b>strength</b> (more or fewer particles), as RCT3's colour and strength modifiers do. <b>Fire now</b> previews it, <b>✎ Edit</b> opens it in
        its editor.</p><p>With several selected, change them all at once or move them together.</p>` },
    { target: '#fw-showinfo', title: 'Show settings',
      html: `<p>The show's name, the time of day it starts in the park, and the months it plays. Below: how many effects and launchers it has, how long it
        runs and what the fireworks cost.</p>` },
    { target: '#fw-launchers', title: 'Launchers',
      html: `<p>Every launcher in the show: its type, tile column and row, and facing. Edit them here or move them in the 3D view; <b>✕</b> removes one
        (with its effects). Click a row to select that launcher.</p>` },
    { title: 'Keyboard shortcuts',
      html: `<ul><li><kbd>Space</kbd> play / pause · <kbd>Home</kbd> rewind · <kbd>F</kbd> fire the selection</li>
        <li><kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> undo / redo (everything can be undone)</li>
        <li><kbd>Ctrl+C</kbd> <kbd>Ctrl+X</kbd> <kbd>Ctrl+V</kbd> <kbd>Ctrl+D</kbd> <kbd>Ctrl+A</kbd> · <kbd>Delete</kbd></li>
        <li><kbd>←</kbd> <kbd>→</kbd> nudge 0.1 s (<kbd>Shift</kbd>: 1 s) · <kbd>↑</kbd> <kbd>↓</kbd> track · <kbd>+</kbd> <kbd>−</kbd> time scale</li>
        <li><kbd>R</kbd> turn the selected launcher or scenery piece · <kbd>Esc</kbd> deselect, then back to the viewer</li></ul>` },
    { title: 'Ready',
      html: `<p>A good first try: press <b>Play</b> on a game show, or start a <b>New</b> show, drag a few fireworks onto the timeline and press Play.</p>
        <p><b>? Tour</b> at the top replays this walkthrough.</p>` },
  ];
  // open / close the advanced editors as the tour needs them (each step makes sure the right one is open, also going back)
  const waitSel = async (sel, ms = 8000) => { for (let k = 0; k < ms; k += 100) { if (root.querySelector(sel)) return; await wait(100); } };
  async function ensureEditor(kind) {
    const afeOpen = root.classList.contains('afe'), win = root.querySelector('.fwd-win');
    if (kind === 'firework') {
      win?._close();
      if (!afeOpen) { await openEditor('firework', null); await waitSel('.afe-tree .afe-node'); await wait(300); }
      return;
    }
    if (afeOpen) { root.querySelector('.afe-top [data-a="close"]')?.click(); await wait(250); }
    if (kind === 'laser' || kind === 'jet') {
      if (win && win.dataset.kind !== kind) win._close();
      if (!root.querySelector('.fwd-win')) { await tab(kind); await openEditor(kind, null); await waitSel('.fwd-win .kt'); await wait(300); }
      return;
    }
    win?._close();
  }
  const inEditor = (kind, steps) => steps.map(s => ({ ...s, inside: true, before: async () => { closePanels(); await ensureEditor(kind); await s.before?.(); } }));
  const outside = s => ({ ...s, before: async () => { await ensureEditor(null); await s.before?.(); } });
  async function fullTour() {
    const [afe, des] = await Promise.all([import('./fw_afe.js'), import('./fw_designers.js')]);
    const editors = [
      { target: '#fw-create', title: 'The Advanced Firework Editor', before: async () => { await tab('firework'); },
        html: `<p>RCT3's hidden firework designer. Next the tour opens it and goes through it. You open it with this button, or <b>✎</b> on any firework
          (a game firework is copied first).</p>` },
      ...inEditor('firework', afe.afeTourSteps()),
      { target: '#fw-create', title: 'Lasers', before: async () => { await tab('laser'); },
        html: `<p>The game's lasers: cones of light, planes of light and drawn images. They fire from <b>laser domes</b>. Next: the
          <b>Advanced laser designer</b>, opened with this button or <b>✎</b> on a laser.</p>` },
      ...inEditor('laser', des.designerTourSteps('laser')),
      { target: '#fw-create', title: 'Water jets', before: async () => { await tab('jet'); },
        html: `<p>The game's water jets fire from <b>water jet bases</b>. Next: the <b>Advanced water jet designer</b>.</p>` },
      ...inEditor('jet', des.designerTourSteps('jet')),
    ];
    return FW_TOUR.flatMap(s => s === 'EDITORS' ? editors.map(e => e.inside ? e : outside(e)) : [outside(s)]);   // editor steps keep their editor open
  }
  // "? Tour": the walkthrough of what is open (the firework editor, a designer, or the whole MixMaster)
  async function tour(force) {
    if (root.style.display === 'none' || tourRunning()) return;
    const des = root.querySelector('.fwd-win');
    if (root.classList.contains('afe')) { const m = await import('./fw_afe.js'); runTour('afe', m.afeTourSteps(), { force }); return; }
    if (des) { const m = await import('./fw_designers.js'); runTour(des.dataset.kind + '-designer', m.designerTourSteps(des.dataset.kind), { force }); return; }
    runTour('mixmaster', await fullTour(), { force, onEnd: async () => {
      closePanels(); await ensureEditor(null);
      ['afe', 'laser-designer', 'jet-designer'].forEach(markSeen);   // covered by this tour
    } });
  }
  $('#fw-tour', root).onclick = () => tour(true);

  // a file picked in the main file list: { type, file, def, action: 'preview' | 'edit' }. Shows load into the
  // timeline; fireworks, lasers and jets are picked in the palette and previewed (or opened in their editor);
  // the game's other particle effects (ParticleEffects\*.frw) aren't palette items, so they fire from their definition
  async function openFile(o) {
    if (o.type === 'show') {
      const i = data.displays.findIndex(d => d.file === o.file);
      if (i >= 0) { showSel.value = 'd' + i; openChoice(showSel.value); toast('Opened the show ' + data.displays[i].name); }
      return;
    }
    const kind = o.type === 'effect' ? 'firework' : o.type, key = REG[kind]?.[o.file] ? o.file : null;
    const def = key ? null : o.def && prepDef(kind, clone(o.def), o.file);
    if (!key && !def) return;
    if (key) {
      S.tab = kind; $('#fw-search', root).value = ''; renderLib();
      const row = [...lib.querySelectorAll('.fwk')].find(r => r.dataset.f === key);
      if (row) { lib.querySelectorAll('.fwk.sel').forEach(x => x.classList.remove('sel')); row.classList.add('sel'); row.scrollIntoView({ block: 'center' }); }
    }
    if (o.action === 'edit') return openEditor(kind, key, def);
    await new Promise(r => setTimeout(r, 700));             // the launchers are still being placed on a first open
    if (key) return preview(kind, key);
    audio();
    const li = compatibleLauncher(kind);
    fireNow({ kind, firework: null, launcher: li, slot: 0, tint: null }, { def });
    toast(`Preview: ${def.title}`);
  }

  window.__fwdebug = {   // for tests
    count: () => parts.length, parts: () => parts, step, launch, FW, REG, descInfo, S, ribbons, terrain, openEditor, ctx, seek, applyAims, renderAll,
    sceneryObjs: () => sceneryObjs, music: () => musicEl, launcherObjs: () => launcherObjs, tubeWorld, camera, controls, kick, applyScene,
    // frame-by-frame captures: stop the loop, step the particles by hand, draw one frame
    stop: () => renderer.setAnimationLoop(null), scene, labels,
    drawNow: () => { ribbons.setPixel(camera, view.clientHeight); drawEffects(); draw(); if (useBloom) composer.render(); else renderer.render(scene, camera); } };
  return { root, resize, start, stop, tour, openFile, onBack: null };
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
