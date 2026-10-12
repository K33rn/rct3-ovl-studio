// Fireworks editor: the Advanced Firework Editor (RCT3's "Firework Designer", unlocked in the game by a guest named
// Atari). A firework is a tree: the base releases particles through emitters, each particle can carry emitters of
// its own (trails while it flies, bursts when it ends). Left: the tree (add child emitter, duplicate, move, remove,
// expand / collapse). Right: the selected emitter and its particle with the game's groups - emitter rate, speed,
// rotation; particle basics, life, motion, special effects, modifiers. Bottom: the particle's colour over its life and
// its texture. The firework fires in the 3D view while you edit.
import { runTour } from './tour.js';

const css = `
  #fw .afe-l, #fw .afe-r, #fw .afe-b { background: var(--panel); min-height: 0; min-width: 0; display: flex; flex-direction: column; font-size: 12px; }
  #fw .afe-l { grid-column: 1; grid-row: 2; border-right: 1px solid var(--line); }
  #fw .afe-r { grid-column: 3; grid-row: 2; border-left: 1px solid var(--line); }
  #fw .afe-b { grid-column: 1 / -1; grid-row: 3; border-top: 1px solid var(--line); flex-direction: row; gap: 0; }
  #fw .afe-l h3, #fw .afe-r h3, #fw .afe-b h3 { margin: 0; padding: 10px 12px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--accent); }
  #fw .afe-scroll { overflow: auto; flex: 1; min-height: 0; }
  #fw .afe-top { padding: 8px 10px; display: flex; gap: 6px; flex-wrap: wrap; border-bottom: 1px solid var(--line); }
  #fw .afe-top select, #fw .afe-r input, #fw .afe-r select { background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 3px 5px; font: inherit; min-width: 0; }
  #fw .afe-tree { padding: 4px 6px 10px; }
  #fw .afe-node { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 6px; cursor: pointer; white-space: nowrap; }
  #fw .afe-node:hover { background: var(--panel2); } #fw .afe-node.sel { background: var(--sel); }
  #fw .afe-node .tw { width: 14px; color: var(--dim); text-align: center; flex: none; }
  #fw .afe-node .sp { width: 18px; height: 18px; border-radius: 4px; background: #000; flex: none; }
  #fw .afe-node .nm { overflow: hidden; text-overflow: ellipsis; }
  #fw .afe-node small { color: var(--dim); }
  #fw .afe-tools { display: flex; gap: 4px; flex-wrap: wrap; padding: 6px 10px; border-top: 1px solid var(--line); }
  #fw .afe-tools button { font-size: 11px; padding: 3px 6px; }
  #fw .afe-grp { margin: 6px 10px; border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px 8px; }
  #fw .afe-grp > b { display: block; color: var(--accent); font-size: 11px; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 4px; }
  #fw .afe-f { display: grid; grid-template-columns: 96px 1fr 64px; gap: 6px; align-items: center; color: var(--dim); padding: 2px 0; }
  #fw .afe-f input[type=range] { width: 100%; }
  #fw .afe-f.wide { grid-template-columns: 96px 1fr; }
  #fw .afe-col { flex: 1.3; display: flex; flex-direction: column; min-width: 0; border-right: 1px solid var(--line); }
  #fw .afe-tex { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  #fw .afe-gwrap { margin: 2px 18px 0; position: relative; padding-bottom: 22px; cursor: copy; touch-action: none; }
  #fw .afe-grad { height: 34px; border-radius: 6px; border: 1px solid var(--line); display: block; width: 100%; }
  #fw .afe-marks { position: absolute; left: 0; right: 0; top: 34px; height: 22px; }
  #fw .afe-mk { position: absolute; top: 0; width: 16px; height: 20px; margin-left: -8px; cursor: ew-resize; }
  #fw .afe-mk::before { content: ''; position: absolute; left: 3px; top: 0; border: 5px solid transparent; border-bottom: 6px solid #9aa3b5; border-top: 0; }
  #fw .afe-mk i { position: absolute; left: 1px; top: 6px; width: 14px; height: 12px; border: 1px solid #9aa3b5; border-radius: 3px; box-sizing: border-box; }
  #fw .afe-mk.sel::before { border-bottom-color: var(--accent); } #fw .afe-mk.sel i { border: 2px solid var(--accent); }
  #fw .afe-mk.gone { opacity: .25; }
  #fw .afe-stopbar { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; padding: 6px 12px; color: var(--dim); font-size: 12px; }
  #fw .afe-stopbar input[type=color] { width: 38px; height: 24px; padding: 0 2px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); vertical-align: middle; cursor: pointer; }
  #fw .afe-stopbar input[type=number] { background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 2px 4px; }
  #fw .afe-stopbar button { font-size: 11px; padding: 3px 7px; }
  #fw .afe-sw { display: inline-flex; gap: 3px; } #fw .afe-sw button { width: 16px; height: 16px; padding: 0; border-radius: 4px; border: 1px solid #0008; }
  #fw .afe-col.off .afe-gwrap, #fw .afe-col.off .afe-stopbar > :not([data-s=n]) { opacity: .35; pointer-events: none; }
  #fw .afe-texgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(46px, 1fr)); gap: 5px; padding: 4px 12px 12px; overflow: auto; }
  #fw .afe-texgrid canvas { width: 46px; height: 46px; border-radius: 6px; border: 1px solid var(--line); background: #000; cursor: pointer; }
  #fw .afe-texgrid canvas.sel { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
  #fw .afe-hint { color: var(--dim); font-size: 11px; padding: 2px 12px; }
`;
let styled = false;

// fields as the game groups them: [field, label, min, max, step] (step 0: checkbox / int flag). Ranges and steps are the
// game's own (the Firework Designer's slider set-up in RCT3plus.exe: step, max, min per slider); fields the game edits
// without a slider (# particles, burn length, cost, base life, anim speed) keep generous ranges.
const TAU = 2 * Math.PI;
const BASE_GROUPS = [
  ['Firework', [['Name', 'Label', 'text'], ['Cost', 'Cost (cents)', 0, 99999, 1], ['Lifetime', 'Lifetime', 0.05, 20, 0.05], ['LifetimeRandom', 'Time Rand', 0, 1, 0.01]]],
  ['Sound', [['SoundName', 'Sound', 'sound'], ['SoundMinDist', 'Min Dist', 0, 1000, 5], ['SoundMaxDist', 'Max Dist', 0, 1000, 5], ['SoundPlayTime', 'Sound Time', 0, 1, 0.01]]],
  ['Modifiers', [['_cmod', 'Color Modifier', 'rgb:ColourModifier'], ['_cmodd', 'Default Color Modifier', 'rgb:ColourModifierDefault'],
    ['StrengthModifier', 'Strength Modifier', 0, 1, 0.01], ['StrengthModifierDefault', 'Default Strength Modifier', 0, 1, 0.01],
    ['_ident', 'Identifying color', 'rgb:IdentifyingColour']]],
];
const EMITTER_GROUPS = [
  ['Emitter rate', [['NumParticles', '# Particles', 0, 1000, 1], ['NumParticlesModifierEnable', 'Use Strength Modifier', 0, 1, 0],
    ['StartTime', 'Start Time', 0, 1, 0.01], ['EndTime', 'End Time', 0, 1, 0.01], ['TimeRandom', 'Random', 0, 1, 0.01]]],
  ['Emitter speed', [['ParticleSpeed', 'Speed', 0, 100, 0.01], ['SpeedRandom', 'Sphere', 0, 100, 0.01], ['SpeedRandomCircle', 'Circle', 0, 100, 0.01],
    ['ParentSpeedFactor', 'Parent', 0, 1, 0.01], ['PositionRandom', 'Pos Sphere', 0, 100, 0.01], ['PositionRandomCircle', 'Pos Circle', 0, 100, 0.01],
    ['ParticleRelative', 'Move with parent', 0, 1, 0]]],
  ['Emitter rotation', [['SpinRateX', 'SpinRateX', -20 * Math.PI, 20 * Math.PI, 0.12566], ['SpinRateY', 'SpinRateY', -20 * Math.PI, 20 * Math.PI, 0.12566],
    ['SpinRateZ', 'SpinRateZ', -20 * Math.PI, 20 * Math.PI, 0.12566],
    ['SpinOffsetX', 'SpinOffsetX', 0, TAU, 0.00628], ['SpinOffsetY', 'SpinOffsetY', 0, TAU, 0.00628], ['SpinOffsetZ', 'SpinOffsetZ', 0, TAU, 0.00628]]],
];
const PARTICLE_GROUPS = [
  ['Particle basics', [['Name', 'Label', 'text'], ['StartSize', 'Start Size', 0, 50, 0.01], ['EndSize', 'End Size', 0, 50, 0.01], ['SizeRandom', 'Random', 0, 1, 0.01]]],
  ['Particle life', [['Lifetime', 'Lifetime', 0.05, 20, 0.05], ['LifetimeRandom', 'Time Rand', 0, 1, 0.01]]],
  ['Particle motion', [['Drag', 'Drag', 0, 5, 0.01], ['GravityScale', 'Gravity', -2, 2, 0.005], ['VelStretch', 'Stretch', 0, 1, 0.01], ['UpScale', 'UpScale', 0, 100, 0.1]]],
  ['Special effects', [['CameraSpinRate', 'Spin Rate', -TAU, TAU, 0.01257], ['SpinRateX', 'SpinRateX', -20 * Math.PI, 20 * Math.PI, 0.12566],
    ['SpinRateY', 'SpinRateY', -20 * Math.PI, 20 * Math.PI, 0.12566],
    ['BurnLength', 'Burn Length', 0, 50, 1], ['BurnSize', 'Burn Size', 0, 50, 0.01], ['AnimTimeScale', 'Anim speed', 0, 5, 0.01],
    ['SoundName', 'Sound', 'sound'], ['SoundMinDist', 'Min Dist', 0, 1000, 5], ['SoundMaxDist', 'Max Dist', 0, 1000, 5], ['SoundPlayTime', 'Sound Time', 0, 1, 0.01]]],
  ['Modifiers', [['ColourModifierEnable', 'Use Color Modifier', 0, 1, 0]]],
];

const curve = (times, values) => ({ times, values });
function particle(over = {}) {
  const c = (n, t, v) => ({ [`Colour${n}Times`]: t, [`Colour${n}Values`]: v, wrap: 0 });
  return Object.assign({ kind: 'particle', Name: '', AnimTimeScale: 1, BurnLength: 0, BurnSize: 0.2, CameraSpinRate: 0,
    ColourR: c('R', [0, 1], [1, 1]), ColourG: c('G', [0, 1], [1, 0.4]), ColourB: c('B', [0, 1], [1, 0.2]), ColourA: c('A', [0, 1], [1, 1]),
    ColourModifierA: 1, ColourModifierB: 1, ColourModifierG: 1, ColourModifierR: 1, ColourModifierDefaultA: 1, ColourModifierDefaultB: 1,
    ColourModifierDefaultG: 1, ColourModifierDefaultR: 1, ColourModifierEnable: 0, Cost: -1, Drag: 0, EndSize: 1, GravityScale: 0,
    Lifetime: 1, LifetimeRandom: 0, ParticleEmitterDescs: [], SizeRandom: 0, SoundMaxDist: 300, SoundMinDist: 70, SoundName: '', SoundPlayTime: 0,
    SpinRateX: 0, SpinRateY: 0, StartSize: 1, StrengthModifier: 1, StrengthModifierDefault: 1, TextureNameReduced: 'Flare_00', TextureTileIndex: -1,
    UpScale: 0, VelStretch: 0 }, over);
}
function emitter(pd, over = {}) {
  return Object.assign({ kind: 'emitter', EndTime: 1, NumParticles: 20, NumParticlesModifierEnable: 0, ParentSpeedFactor: 0, ParticleDesc: pd,
    ParticleRelative: 0, ParticleSpeed: 0, PositionRandom: 0, PositionRandomCircle: 0, SpeedRandom: 10, SpeedRandomCircle: 0,
    SpinOffsetX: 0, SpinOffsetY: 0, SpinOffsetZ: 0, SpinRateX: 0, SpinRateY: 0, SpinRateZ: 0, StartTime: 0, TimeRandom: 0 }, over);
}
function newFirework() {   // just the base, no emitters yet: add them with "+ Child emitter"
  const n = {
    1: { kind: 'base', Name: 'My firework', Cost: 599, Lifetime: 1, LifetimeRandom: 0, NumParticles: 0, ParticleEmitterDescs: [], SoundName: 'Fireworklaunch2',
      SoundMinDist: 70, SoundMaxDist: 300, SoundPlayTime: 0, StrengthModifier: 1, StrengthModifierDefault: 1,
      ColourModifierR: 1, ColourModifierG: 1, ColourModifierB: 1, ColourModifierA: 1, ColourModifierDefaultR: 1, ColourModifierDefaultG: 1,
      ColourModifierDefaultB: 1, ColourModifierDefaultA: 1, IdentifyingColourR: 1, IdentifyingColourG: 0.55, IdentifyingColourB: 0.3,
      IdentifyingColourDarkR: 0.75, IdentifyingColourDarkG: 0.41, IdentifyingColourDarkB: 0.22, IdentifyingIcon: 0 },
  };
  return { title: 'My firework', cost: 599, colour: [1, 0.55, 0.3], root: '1', nodes: n };
}

export function openAFE(ctx, def, key) {
  const { esc, hex, unhex, clamp } = ctx;
  if (!styled) { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); styled = true; }
  let fw = def ? JSON.parse(JSON.stringify(def)) : newFirework();
  fw.nodes = Object.fromEntries(Object.entries(fw.nodes).map(([k, v]) => [String(k), v]));
  fw.root = String(fw.root);
  let perLaunch = 0;
  let sel = fw.root, collapsed = new Set(), version = 0, undo = [], redo = [], auto = true, lastFire = -99, playing = 0;
  ctx.setAfeMode(true);
  const L = document.createElement('div'), R = document.createElement('div'), B = document.createElement('div');
  L.className = 'afe-l'; R.className = 'afe-r'; B.className = 'afe-b';
  ctx.root.append(L, R, B);
  const games = () => Object.values(ctx.REG.firework).sort((a, b) => a.title.localeCompare(b.title));
  L.innerHTML = `<h3>Firework Designer</h3>
    <div class="afe-top">
      <button data-a="new" title="Create new firework">New</button>
      <select data-a="load" title="Load firework" style="flex:1"><option value="">Load firework…</option>${games().map(f => `<option value="${esc(f.key)}">${esc(f.title)}${f.key.startsWith('my:') ? ' (yours)' : ''}</option>`).join('')}</select>
    </div>
    <div class="afe-top">
      <button data-a="save" class="big" title="Save firework (into your fireworks in the palette)">Save firework</button>
      <button data-a="game" title="Save as a .frw in the game's Fireworks folder">Save to game</button>
      <button data-a="dl" title="Download the .frw file">Download .frw</button>
      <button data-a="close" class="back" title="Back to the MixMaster">← MixMaster</button>
    </div>
    <div class="afe-scroll"><div class="afe-tree"></div></div>
    <div class="afe-tools">
      <button data-a="add" title="Add child particle emitter">+ Child emitter</button><button data-a="dup" title="Duplicate this emitter and everything under it">Duplicate</button>
      <button data-a="up" title="Move up">↑</button><button data-a="down" title="Move down">↓</button>
      <button data-a="rm" title="Remove particle emitter">Remove</button><button data-a="expand" title="Expand tree">Expand</button><button data-a="collapse" title="Collapse tree">Collapse</button>
    </div>`;
  R.innerHTML = `<h3 data-r="title">Properties</h3><div class="afe-scroll" data-r="props"></div>`;
  B.innerHTML = `<div class="afe-col"><h3>Particle color <small style="color:var(--dim);text-transform:none;letter-spacing:0">over its life</small></h3>
      <div class="afe-gwrap"><canvas class="afe-grad"></canvas><div class="afe-marks"></div></div>
      <div class="afe-stopbar" data-b="stopbar"></div>
      <div class="afe-hint">click the bar (or under it) to add a colour stop · drag a stop to move it · drag it down off the bar or right-click it to remove it</div>
      <div class="afe-hint" data-b="look"></div>
      <div class="afe-hint" style="margin-top:auto;padding-bottom:10px"><label><input type="checkbox" data-b="auto" checked> Fire again automatically</label>
        <button data-b="fire" style="margin-left:8px">▶ Fire</button> <span data-b="info"></span></div></div>
    <div class="afe-tex"><h3>Particle texture</h3><div class="afe-texgrid"></div></div>`;
  const tree = L.querySelector('.afe-tree'), props = R.querySelector('[data-r=props]'), grad = B.querySelector('.afe-grad'), texgrid = B.querySelector('.afe-texgrid');

  // ---- model helpers ----
  const N = () => fw.nodes;
  const newId = () => String(Math.max(0, ...Object.keys(N()).map(Number).filter(Number.isFinite)) + 1);
  const childrenOf = id => { const n = N()[id]; return n?.kind === 'emitter' ? (N()[n.ParticleDesc]?.ParticleEmitterDescs || []) : (n?.ParticleEmitterDescs || []); };
  const holderOf = id => { const n = N()[id]; return n?.kind === 'emitter' ? N()[n.ParticleDesc] : n; };   // node whose ParticleEmitterDescs grow
  function parentOf(eid) {
    for (const [k, n] of Object.entries(N())) if ((n.ParticleEmitterDescs || []).map(String).includes(String(eid))) return k;
    return null;
  }
  function gc() {   // drop nodes nothing reaches
    const keep = new Set(), walk = id => { id = String(id); if (keep.has(id) || !N()[id]) return; keep.add(id); const n = N()[id];
      if (n.kind === 'emitter') walk(n.ParticleDesc); else (n.ParticleEmitterDescs || []).forEach(walk); };
    walk(fw.root);
    for (const k of Object.keys(N())) if (!keep.has(k)) delete N()[k];
  }
  function deepCopy(eid) {   // an emitter and everything under it, with new ids
    const map = {};
    const cp = id => {
      id = String(id); if (map[id]) return map[id];
      const nid = newId(); map[id] = nid; const n = JSON.parse(JSON.stringify(N()[id])); N()[nid] = n;
      if (n.kind === 'emitter') n.ParticleDesc = +cp(n.ParticleDesc); else n.ParticleEmitterDescs = (n.ParticleEmitterDescs || []).map(x => +cp(x));
      return nid;
    };
    return cp(eid);
  }
  function snap() { undo.push(JSON.stringify(fw)); if (undo.length > 100) undo.shift(); redo = []; }
  function touched(rebuild) {   // after any edit: new identity for the simulation caches, refresh the views
    version++; fw.key = 'afe:' + version; delete fw._flags; ctx.descCacheClear();
    fw.duration = ctx.fireworkDuration(fw);
    const b = N()[fw.root]; fw.title = b.Name || 'My firework'; fw.cost = b.Cost;
    fw.colour = [b.IdentifyingColourR ?? 1, b.IdentifyingColourG ?? 1, b.IdentifyingColourB ?? 1];
    if (rebuild) { renderTree(); renderProps(); }
    renderColour(); renderTex();
    lastFire = -99;   // fire the new version straight away, alone (earlier versions' particles would add to the count)
    ctx.clearParticles(f => String(f?.key || '').startsWith('afe:'));
    perLaunch = launchCount();
  }

  // ---- tree ----
  function label(id) {
    const n = N()[id];
    if (n.kind === 'base') return `<b>${esc(n.Name || 'Firework')}</b> <small>base</small>`;
    const p = N()[n.ParticleDesc] || {};
    const when = n.StartTime === n.EndTime ? `at ${(n.StartTime * 100).toFixed(0)}%` : `${(n.StartTime * 100).toFixed(0)}–${(n.EndTime * 100).toFixed(0)}%`;
    return `<span class="nm">${n.NumParticles}× ${esc(p.Name || p.TextureNameReduced || 'particle')}</span> <small>${when} · ${(+p.Lifetime || 0).toFixed(2)}s</small>`;
  }
  function renderTree() {
    const rows = [];
    const walk = (id, depth) => {
      const kids = childrenOf(id), open = !collapsed.has(id);
      rows.push(`<div class="afe-node${String(id) === String(sel) ? ' sel' : ''}" data-id="${id}" style="padding-left:${6 + depth * 16}px">
        <span class="tw" data-t="${id}">${kids.length ? (open ? '▾' : '▸') : '·'}</span><canvas class="sp" width="18" height="18" data-sp="${id}"></canvas>${label(id)}</div>`);
      if (open) kids.forEach(k => walk(String(k), depth + 1));
    };
    walk(fw.root, 0);
    tree.innerHTML = rows.join('');
    tree.querySelectorAll('canvas[data-sp]').forEach(c => {
      const n = N()[c.dataset.sp], p = n.kind === 'emitter' ? N()[n.ParticleDesc] : null;
      if (p) sprite(p.TextureNameReduced, c, colourAt(p, 0.3));
      else { const g = c.getContext('2d'); g.fillStyle = hex([n.IdentifyingColourR ?? 1, n.IdentifyingColourG ?? 1, n.IdentifyingColourB ?? 1]); g.fillRect(3, 3, 12, 12); }
    });
  }
  tree.addEventListener('click', e => {
    const tw = e.target.closest('[data-t]');
    if (tw) { const id = tw.dataset.t; collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); renderTree(); return; }
    const row = e.target.closest('.afe-node'); if (!row) return;
    sel = row.dataset.id; renderTree(); renderProps(); renderColour(); renderTex();
  });

  // ---- properties ----
  const particleOf = () => { const n = N()[sel]; return n?.kind === 'emitter' ? N()[n.ParticleDesc] : null; };
  function fieldHtml(owner, [f, lab, min, max, step]) {
    const n = owner === 'p' ? particleOf() : N()[sel];
    if (min === 'text') return `<div class="afe-f wide">${lab}<input type="text" data-o="${owner}" data-f="${f}" value="${esc(n[f] ?? '')}"></div>`;
    if (min === 'sound') return `<div class="afe-f">${lab}<select data-o="${owner}" data-f="${f}"><option value="">(none)</option>${(ctx.data.sounds || []).map(s => `<option${s.toLowerCase() === String(n[f] || '').toLowerCase() ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select><button data-play="${owner}">♪</button></div>`;
    if (String(min).startsWith('rgb:')) { const p = min.slice(4); return `<div class="afe-f wide">${lab}<input type="color" data-o="${owner}" data-rgb="${p}" value="${hex([n[p + 'R'] ?? 1, n[p + 'G'] ?? 1, n[p + 'B'] ?? 1])}"></div>`; }
    if (step === 0) return `<div class="afe-f wide">${lab}<input type="checkbox" data-o="${owner}" data-f="${f}" ${n[f] ? 'checked' : ''} style="justify-self:start"></div>`;
    const v = +(n[f] ?? 0);
    const lim = `data-o="${owner}" data-f="${f}" min="${min}" max="${max}" step="${step}"`;
    return `<div class="afe-f" title="${+min.toFixed(3)} to ${+max.toFixed(3)}">${lab}<input type="range" ${lim} value="${v}"><input type="number" ${lim} value="${+v.toFixed(4)}"></div>`;
  }
  function renderProps() {
    const n = N()[sel];
    const title = R.querySelector('[data-r=title]');
    let html = '';
    if (n.kind === 'base') {
      title.textContent = 'Firework (base)';
      html = BASE_GROUPS.map(([g, fs]) => `<div class="afe-grp"><b>${g}</b>${fs.map(f => fieldHtml('n', f)).join('')}</div>`).join('');
      html += `<div class="afe-hint" style="padding:4px 12px 12px">Strength and colour modifiers are what the MixMaster changes per launch: emitters with “Use Strength Modifier” release more or fewer particles, particles with “Use Color Modifier” take the colour.</div>`;
    } else {
      title.textContent = 'Particle emitter and its particle';
      html = EMITTER_GROUPS.map(([g, fs]) => `<div class="afe-grp"><b>${g}</b>${fs.map(f => fieldHtml('n', f)).join('')}</div>`).join('');
      const shared = Object.values(N()).filter(x => x.kind === 'emitter' && String(x.ParticleDesc) === String(n.ParticleDesc)).length;
      html += `<div class="afe-hint" style="padding:6px 12px 0">${shared > 1 ? `This particle is shared by ${shared} emitters: changes show in all of them. <button data-a="unshare">Make its own copy</button>` : 'Start / End Time: when in its parent\'s life (0 = start, 1 = end) the emitter releases its particles.'}</div>`;
      html += PARTICLE_GROUPS.map(([g, fs]) => `<div class="afe-grp"><b>${g}</b>${fs.map(f => fieldHtml('p', f)).join('')}</div>`).join('');
    }
    props.innerHTML = html;
  }
  const target = o => o === 'p' ? particleOf() : N()[sel];
  let snapPending = false;
  props.addEventListener('input', e => {
    const o = e.target.dataset.o; if (!o) return;
    const n = target(o); if (!n) return;
    if (!snapPending) { snap(); snapPending = true; }
    if (e.target.dataset.rgb) {
      const p = e.target.dataset.rgb, c = unhex(e.target.value);
      n[p + 'R'] = c[0]; n[p + 'G'] = c[1]; n[p + 'B'] = c[2];
      if (p === 'IdentifyingColour') { n.IdentifyingColourDarkR = c[0] * 0.75; n.IdentifyingColourDarkG = c[1] * 0.75; n.IdentifyingColourDarkB = c[2] * 0.75; }
    } else {
      const f = e.target.dataset.f;
      if (e.target.type === 'checkbox') n[f] = e.target.checked ? 1 : 0;
      else if (e.target.type === 'text' || e.target.tagName === 'SELECT') n[f] = e.target.value;
      else {
        const x = clamp(+e.target.value || 0, +e.target.min, +e.target.max);   // the game's range for this field
        n[f] = ['NumParticles', 'Cost', 'BurnLength'].includes(f) ? Math.round(x) : x;
        props.querySelectorAll(`[data-o="${o}"][data-f="${f}"]`).forEach(x => { if (x !== e.target) x.value = n[f]; });
      }
    }
    touched(false);
    if (['Name', 'NumParticles', 'StartTime', 'EndTime', 'Lifetime'].includes(e.target.dataset.f)) renderTree();
  });
  props.addEventListener('change', () => { snapPending = false; });
  props.addEventListener('click', e => {
    if (e.target.dataset.play) { const n = target(e.target.dataset.play); if (n?.SoundName) ctx.playSound(n.SoundName); }
    if (e.target.dataset.a === 'unshare') {
      snap(); const n = N()[sel], nid = newId(); N()[nid] = JSON.parse(JSON.stringify(N()[n.ParticleDesc])); n.ParticleDesc = +nid; touched(true);
    }
  });

  // ---- colour over life: a gradient with colour stops, like an image editor's gradient tool -------------------------
  // (stops: R, G, B and A written with the same times; A = opacity, used by textures with transparency - smoke, spray,
  // bubbles, rubble; flares and fire always glow). The stop's inputs are built once and updated in
  // place, so the colour picker stays open while you drag in it.
  let stopSel = 0, stopsBusy = false;
  function stopsOf(p) {
    const ch = ['R', 'G', 'B'].map(c => p['Colour' + c] || {});
    const times = [...new Set(ch.flatMap((c, i) => c[`Colour${'RGB'[i]}Times`] || []))].sort((a, b) => a - b);
    const T = times.length ? times : [0];
    return T.map(t => ({ t, c: ['R', 'G', 'B'].map(k => chanAt(p, k, t)), a: alphaAt(p, t) }));
  }
  const alphaAt = (p, f) => (p.ColourA?.ColourAValues || []).length ? chanAt(p, 'A', f) : 1;
  const solidTex = p => !!ctx.data.sprites[p?.TextureNameReduced]?.solid;
  function chanAt(p, k, f) {
    const c = p['Colour' + k] || {}, t = c[`Colour${k}Times`] || [], v = c[`Colour${k}Values`] || [];
    if (!v.length) return 1;
    if (v.length === 1 || !t.length || f <= t[0]) return v[0];
    for (let i = 1; i < t.length && i < v.length; i++) if (f <= t[i]) return v[i - 1] + (v[i] - v[i - 1]) * (f - t[i - 1]) / Math.max(1e-6, t[i] - t[i - 1]);
    return v[Math.min(t.length, v.length) - 1];
  }
  const colourAt = (p, f) => ['R', 'G', 'B'].map(k => chanAt(p, k, f));
  function writeStops(p, stops) {
    stops.sort((a, b) => a.t - b.t);
    // two stops at one time would merge: keep them a hair apart
    for (let i = 1; i < stops.length; i++) if (stops[i].t <= stops[i - 1].t) stops[i].t = Math.min(1, stops[i - 1].t + 0.001);
    ['R', 'G', 'B'].forEach((k, i) => { p['Colour' + k] = { [`Colour${k}Times`]: stops.map(s => +s.t.toFixed(4)), [`Colour${k}Values`]: stops.map(s => +s.c[i].toFixed(4)), wrap: p['Colour' + k]?.wrap || 0 }; });
    p.ColourA = { ColourATimes: stops.map(s => +s.t.toFixed(4)), ColourAValues: stops.map(s => +clamp(s.a ?? 1, 0, 1).toFixed(4)), wrap: p.ColourA?.wrap || 0 };
  }
  const swatches = ['#ffffff', '#fff2a8', '#ffd23a', '#ff8a1e', '#ff3b2e', '#ff4fb4', '#b44dff', '#4d6bff', '#3ad7ff', '#4dff8a', '#000000'];
  const stopbar = B.querySelector('[data-b=stopbar]'), marks = B.querySelector('.afe-marks');
  stopbar.innerHTML = `<span data-s="n"></span>
    <label>Color <input type="color" data-s="c"></label>
    <span class="afe-sw">${swatches.map(c => `<button data-sw="${c}" style="background:${c}" title="${c}"></button>`).join('')}</span>
    <label>Location <input type="number" data-s="t" min="0" max="100" step="1" style="width:58px">%</label>
    <label data-s="alab">Opacity <input type="range" data-s="a" min="0" max="1" step="0.01" style="width:90px"></label>
    <button data-s="prev" title="Previous stop">◀</button><button data-s="next" title="Next stop">▶</button>
    <button data-s="del" title="Delete this stop (or drag it down off the bar, or right-click it)">Delete</button>
    <button data-s="rev" title="Reverse the gradient">Reverse</button><button data-s="even" title="Spread the stops evenly">Distribute</button>`;
  const S$ = k => stopbar.querySelector(`[data-s=${k}]`);
  function drawGradient(p) {
    const g = grad.getContext('2d'), w = grad.clientWidth || 300, h = grad.clientHeight || 34, dpr = devicePixelRatio || 1;
    if (grad.width !== Math.round(w * dpr) || grad.height !== Math.round(h * dpr)) { grad.width = Math.round(w * dpr); grad.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { g.fillStyle = ((x + y) / 8) % 2 ? '#1a1f2b' : '#10141c'; g.fillRect(x, y, 8, 8); }
    if (!p) return;
    const solid = solidTex(p);   // smoke etc.: show the opacity over the checkerboard; glowing textures: colour only
    for (let x = 0; x < w; x++) {
      const f = x / Math.max(1, w - 1), c = colourAt(p, f);
      g.globalAlpha = solid ? clamp(alphaAt(p, f), 0, 1) : 1; g.fillStyle = hex(c); g.fillRect(x, 0, 1, h);
    }
    g.globalAlpha = 1;
  }
  function renderColour() {
    const p = particleOf(), look = B.querySelector('[data-b=look]');
    drawGradient(p);
    B.querySelector('.afe-col').classList.toggle('off', !p);
    if (!p) { marks.innerHTML = ''; look.textContent = ''; S$('n').textContent = 'Select an emitter to edit its particle\'s colour.'; return; }
    const solid = solidTex(p);
    look.textContent = solid ? `${p.TextureNameReduced} has transparency: drawn solid, each stop's Opacity fades it in and out (as the game's smoke does).`
      : `${p.TextureNameReduced || 'This texture'} glows (drawn additively, like the game's flares and fire): Opacity does not apply.`;
    S$('a').disabled = !solid; S$('alab').style.opacity = solid ? 1 : 0.4;
    const st = stopsOf(p); stopSel = clamp(stopSel, 0, st.length - 1);
    if (marks.childElementCount !== st.length) marks.innerHTML = st.map((_, i) => `<div class="afe-mk" data-i="${i}"><i></i></div>`).join('');
    [...marks.children].forEach((m, i) => {
      m.style.left = (st[i].t * 100) + '%'; m.firstChild.style.background = hex(st[i].c);
      m.classList.toggle('sel', i === stopSel); m.dataset.i = i; m.title = `${Math.round(st[i].t * 100)}% · ${hex(st[i].c)}`;
    });
    const s = st[stopSel];
    S$('n').textContent = `Stop ${stopSel + 1} of ${st.length}`;
    if (document.activeElement !== S$('c') && S$('c').value !== hex(s.c)) S$('c').value = hex(s.c);
    if (document.activeElement !== S$('t')) S$('t').value = Math.round(s.t * 100);
    if (document.activeElement !== S$('a')) S$('a').value = s.a;
    S$('del').disabled = st.length < 2;
  }
  function editStop(fn, label) {   // change the selected stop; one undo step per gesture
    const p = particleOf(); if (!p) return;
    if (!stopsBusy) { snap(); stopsBusy = true; }
    const st = stopsOf(p), s = st[stopSel]; if (!s) return;
    fn(s, st); writeStops(p, st); stopSel = Math.max(0, st.indexOf(s)); touched(false);
    if (label) renderTree();
  }
  const endGesture = () => { stopsBusy = false; };
  stopbar.addEventListener('input', e => {
    const k = e.target.dataset.s;
    if (k === 'c') editStop(s => { s.c = unhex(e.target.value); });
    if (k === 't') editStop(s => { s.t = clamp((+e.target.value || 0) / 100, 0, 1); });
    if (k === 'a') editStop(s => { s.a = clamp(+e.target.value || 0, 0, 1); });
  });
  stopbar.addEventListener('change', () => { endGesture(); renderTree(); });
  stopbar.addEventListener('click', e => {
    const p = particleOf(); if (!p) return;
    const sw = e.target.dataset.sw, k = e.target.dataset.s, n = stopsOf(p).length;
    if (sw) { editStop(s => { s.c = unhex(sw); }, true); endGesture(); }
    if (k === 'prev' || k === 'next') { stopSel = (stopSel + (k === 'next' ? 1 : n - 1)) % n; renderColour(); }
    if (k === 'del') removeStop(stopSel);
    if (k === 'rev') { snap(); const st = stopsOf(p).map(s => ({ t: 1 - s.t, c: s.c, a: s.a })); writeStops(p, st); stopSel = n - 1 - stopSel; touched(false); renderTree(); }
    if (k === 'even') { snap(); const st = stopsOf(p); st.forEach((s, i) => { s.t = n > 1 ? i / (n - 1) : 0; }); writeStops(p, st); touched(false); }
  });
  function removeStop(i) {
    const p = particleOf(); if (!p) return;
    const st = stopsOf(p); if (st.length < 2 || !st[i]) return;
    snap(); st.splice(i, 1); writeStops(p, st); stopSel = Math.min(i, st.length - 1); touched(false); renderTree();
  }
  B.addEventListener('input', e => {
    const p = particleOf(), k = e.target.dataset.b;
    if (k === 'auto') auto = e.target.checked;
  });
  B.querySelector('[data-b=fire]').onclick = () => fire();
  const gwrap = B.querySelector('.afe-gwrap');
  const gx = e => { const r = marks.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); };
  gwrap.addEventListener('contextmenu', e => { e.preventDefault(); const m = e.target.closest('.afe-mk'); if (m) removeStop(+m.dataset.i); });
  gwrap.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const p = particleOf(); if (!p) return;
    const m = e.target.closest('.afe-mk');
    stopsBusy = false;
    let st = stopsOf(p);
    if (m) stopSel = +m.dataset.i;
    else {                                     // a click on the bar or below it: a new stop with the colour already there
      snap(); stopsBusy = true;
      const t = gx(e), s = { t, c: colourAt(p, t), a: alphaAt(p, t) };
      st.push(s); writeStops(p, st); stopSel = stopsOf(p).findIndex(x => Math.abs(x.t - s.t) < 1e-3);
      touched(false); renderTree();
    }
    const y0 = e.clientY, x0 = e.clientX;
    let moved = false, off = false;
    gwrap.setPointerCapture(e.pointerId);
    gwrap.onpointermove = ev => {
      if (!moved && Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return;
      moved = true;
      off = ev.clientY - marks.getBoundingClientRect().bottom > 36 && stopsOf(p).length > 1;   // dragged off: removes on release
      marks.children[stopSel]?.classList.toggle('gone', off);
      if (!off) editStop(s => { s.t = gx(ev); });
    };
    gwrap.onpointerup = () => {
      gwrap.onpointermove = gwrap.onpointerup = null;
      if (off) { if (!stopsBusy) snap(); const st2 = stopsOf(p); st2.splice(stopSel, 1); writeStops(p, st2); stopSel = Math.max(0, stopSel - 1); touched(false); }
      endGesture(); marks.innerHTML = ''; renderColour(); renderTree();
    };
  });

  // ---- textures: the game's particle sprites, from an opaque copy of the sheet (their glow is in RGB with alpha 0) ----
  const pageImgs = {};
  function pageImg(page) {
    if (!pageImgs[page]) pageImgs[page] = new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = ctx.pageUrl(page) + '&opaque=1'; });
    return pageImgs[page];
  }
  function sprite(name, c, tint) {
    const sp = ctx.data.sprites[name]; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
    if (!sp) return;
    pageImg(sp.page).then(im => {
      if (!im) return;
      const [x0, y0, x1, y1] = sp.rect, W = im.width, H = im.height;
      const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
      const t = tmp.getContext('2d'); t.drawImage(im, x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H, 0, 0, c.width, c.height);
      if (tint) {   // the opaque sheet: tint the glow like the particle's colour
        const d = t.getImageData(0, 0, c.width, c.height), a = d.data;
        for (let i = 0; i < a.length; i += 4) { a[i] *= tint[0]; a[i + 1] *= tint[1]; a[i + 2] *= tint[2]; }
        t.putImageData(d, 0, 0);
      }
      g.drawImage(tmp, 0, 0);
    });
  }
  function renderTex() {
    const p = particleOf();
    const names = Object.keys(ctx.data.sprites).sort((a, b) => (b.startsWith('FW') || b.startsWith('Flare')) - (a.startsWith('FW') || a.startsWith('Flare')) || a.localeCompare(b));
    if (!texgrid.childElementCount) {
      texgrid.innerHTML = names.map(n => `<canvas width="46" height="46" data-tex="${esc(n)}" title="${esc(n)}"></canvas>`).join('');
      texgrid.querySelectorAll('canvas').forEach(c => sprite(c.dataset.tex, c));
    }
    texgrid.querySelectorAll('canvas').forEach(c => c.classList.toggle('sel', !!p && c.dataset.tex === p.TextureNameReduced));
    texgrid.style.opacity = p ? 1 : 0.4;
  }
  texgrid.addEventListener('click', e => {
    const c = e.target.closest('canvas'), p = particleOf(); if (!c || !p) return;
    snap(); p.TextureNameReduced = c.dataset.tex; touched(true);
  });

  // ---- tree tools, load / save ----
  L.addEventListener('click', async e => {
    const a = e.target.dataset.a; if (!a || e.target.tagName === 'SELECT') return;
    const n = N()[sel];
    if (a === 'add') {
      // a new emitter starts at the defaults: 1 particle, end time 1, lifetime 1, start / end size 1, everything else
      // at its lowest (no speed or scatter, settings that go both ways at 0): you build it up from there
      snap(); const pid = newId();
      N()[pid] = particle({ Name: 'Particle', Lifetime: 1, StartSize: 1, EndSize: 1, BurnSize: 0, SoundMinDist: 0, SoundMaxDist: 0 });
      const eid = newId(); N()[eid] = emitter(+pid, { NumParticles: 1, SpeedRandom: 0, StartTime: 0, EndTime: 1 });
      const h = holderOf(sel); h.ParticleEmitterDescs = [...(h.ParticleEmitterDescs || []), +eid]; collapsed.delete(String(sel)); sel = eid; touched(true);
    }
    if (a === 'dup' && n.kind === 'emitter') {
      snap(); const par = N()[parentOf(sel)]; const nid = deepCopy(sel);
      const i = par.ParticleEmitterDescs.map(String).indexOf(String(sel)); par.ParticleEmitterDescs.splice(i + 1, 0, +nid); sel = nid; touched(true);
    }
    if ((a === 'up' || a === 'down') && n.kind === 'emitter') {
      const par = N()[parentOf(sel)], L2 = par.ParticleEmitterDescs, i = L2.map(String).indexOf(String(sel)), j = i + (a === 'up' ? -1 : 1);
      if (j >= 0 && j < L2.length) { snap(); [L2[i], L2[j]] = [L2[j], L2[i]]; touched(true); }
    }
    if (a === 'rm' && n.kind === 'emitter') {
      snap(); const pk = parentOf(sel), par = N()[pk];
      par.ParticleEmitterDescs = par.ParticleEmitterDescs.filter(x => String(x) !== String(sel)); gc();
      sel = pk && N()[pk]?.kind === 'particle' ? Object.keys(N()).find(k => N()[k].kind === 'emitter' && String(N()[k].ParticleDesc) === pk) || fw.root : fw.root;
      touched(true);
    }
    if (a === 'expand') { collapsed.clear(); renderTree(); }
    if (a === 'collapse') { collapsed = new Set(Object.keys(N()).filter(k => k !== fw.root)); renderTree(); }
    if (a === 'new') { if (!confirm('Start a new firework? Unsaved changes are lost.')) return; snap(); fw = newFirework(); key = null; sel = fw.root; touched(true); }
    if (a === 'save') {
      const out = clean(); key = ctx.saveMine('firework', out, key);
      ctx.toast(`Saved “${out.title}” in your fireworks (drag it onto the MixMaster timeline)`);
    }
    if (a === 'game') {
      try { const r = await ctx.saveToGame('frw', clean(), fw.title); ctx.toast(`Saved ${r.file} into the game's Fireworks folder`); ctx.reload(); }
      catch (err) { ctx.toast('Could not save: ' + err.message); }
    }
    if (a === 'dl') ctx.download('frw', clean(), fw.title).catch(err => ctx.toast('Could not build: ' + err.message));
    if (a === 'close') close();
  });
  L.querySelector('[data-a=load]').onchange = e => {
    const k = e.target.value; if (!k) return;
    snap(); const src = JSON.parse(JSON.stringify(ctx.REG.firework[k]));
    fw = { title: src.title, cost: src.cost, colour: src.colour, root: String(src.root), nodes: Object.fromEntries(Object.entries(src.nodes).map(([a, b]) => [String(a), b])) };
    key = k.startsWith('my:') ? k : null;
    if (!key) { fw.title = src.title + ' (copy)'; N()[fw.root].Name = fw.title; }
    sel = fw.root; collapsed.clear(); e.target.value = ''; touched(true); ctx.toast('Loaded ' + src.title);
  };
  function clean() {
    const out = JSON.parse(JSON.stringify({ title: fw.title, cost: fw.cost, colour: fw.colour, root: fw.root, nodes: fw.nodes }));
    for (const n of Object.values(out.nodes)) { if (n.kind === 'emitter') n.ParticleDesc = +n.ParticleDesc; else if (n.ParticleEmitterDescs) n.ParticleEmitterDescs = n.ParticleEmitterDescs.map(Number); }
    return out;
  }

  // how many particles one launch releases: the base, and each emitter's # particles for every particle it rides on
  // (strength 1; emitters using the strength modifier scale with it in a show)
  function launchCount() {
    const memo = {}, seen = new Set();
    const of = id => {   // particles released under one particle of this description, itself included
      id = String(id); if (memo[id] != null) return memo[id];
      if (seen.has(id)) return 1; seen.add(id);
      const n = N()[id]; let c = 1;
      for (const eid of n?.ParticleEmitterDescs || []) { const e = N()[String(eid)]; if (e) c += (e.NumParticles || 0) * of(e.ParticleDesc); }
      return (memo[id] = c);
    };
    return of(fw.root);
  }

  // ---- preview loop & keys ----
  function fire() { ctx.previewEffect('firework', fw, {}); playing = performance.now(); }
  let raf = 0;
  const tick = () => {
    const now = performance.now() / 1000;
    if (auto && now - lastFire > (fw.duration || 3) + 0.8) { lastFire = now; fire(); }
    B.querySelector('[data-b=info]').textContent = `${perLaunch.toLocaleString()} particles per launch · lasts about ${(fw.duration || 0).toFixed(1)} s · ${ctx.particleCount().toLocaleString()} on screen now`;
    raf = requestAnimationFrame(tick);
  };
  const onKey = e => {
    if (e.target.closest('input,select,textarea')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      const [from, to] = e.shiftKey ? [redo, undo] : [undo, redo];
      if (!from.length) return;
      to.push(JSON.stringify(fw)); fw = JSON.parse(from.pop()); if (!N()[sel]) sel = fw.root; touched(true);
    }
    if (e.key === 'Escape') close();
    if (e.key.toLowerCase() === 'f') fire();
    if (e.key === 'Delete' && N()[sel]?.kind === 'emitter') L.querySelector('[data-a=rm]').click();
  };
  window.addEventListener('keydown', onKey);
  function close() {
    cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey);
    L.remove(); R.remove(); B.remove(); ctx.setAfeMode(false); ctx.descCacheClear();
  }
  touched(true);
  ctx.toast('Advanced firework editor: edits fire in the 3D view');
  raf = requestAnimationFrame(tick);
  setTimeout(() => runTour('afe', afeTourSteps()), 900);
}

// the walkthrough of this editor (also part of the MixMaster tour)
export const afeTourSteps = () => [
    { title: 'The Advanced Firework Editor',
      html: `<p>A firework is a <b>tree of particles</b>: the base releases particles through <b>emitters</b>, and each particle can have emitters of its own:
        trails while it flies, bursts when it ends. Every number here is a setting from the game's firework files. The firework keeps firing in the 3D view
        as you change things.</p>` },
    { target: '.afe-tree', title: 'The tree',
      html: `<p>The base at the top, then each emitter: how many particles it releases (×), when (in its parent's life, 0–100%) and for how long they live.
        Click one to edit it; ▾ / ▸ fold branches.</p>` },
    { target: '.afe-tools', title: 'Changing the tree',
      html: `<p><b>+ Child emitter</b> adds an emitter (with a new particle) under the selected one; <b>Duplicate</b> copies a branch; <b>↑ ↓</b> reorder;
        <b>Remove</b> deletes a branch; <b>Expand / Collapse</b> open or close everything.</p>` },
    { target: '.afe-r', title: 'Settings',
      html: `<p>For the base: name, cost, sound, and the colour / strength modifiers the MixMaster changes per launch.</p>
        <p>For an emitter and its particle: <b>rate</b> (# particles, start / end time), <b>speed</b> (straight, sphere = round bursts, circle = rings,
        parent = keep the parent's speed), <b>rotation</b>, <b>life</b>, <b>size</b>, <b>motion</b> (drag, gravity, stretch) and <b>special effects</b>.
        Drag a slider or type a number.</p>` },
    { target: '.afe-col', title: 'Colour over its life',
      html: `<p>The particle's colour from birth (left) to death (right), as a gradient. Click the bar (or just under it) to add a colour stop,
        drag a stop to move it, and drag it down off the bar (or right-click it) to remove it. For the selected stop: its <b>Color</b> (picker or a
        quick swatch), its <b>Location</b> in the particle's life, ◀ ▶ to step through the stops, <b>Reverse</b> and <b>Distribute</b>.
        The texture decides how it is drawn: flares and fire glow; smoke, spray, bubbles and rubble are solid, and each stop's <b>Opacity</b>
        fades them in and out.</p>` },
    { target: '.afe-tex', title: 'Texture',
      html: `<p>The game's particle pictures: flares, stars, sparkles, smoke, splashes. Click one to give it to the selected particle.</p>` },
    { target: '.afe-top', title: 'Load and save',
      html: `<p><b>New</b> starts an empty firework (just the base: add emitters with <b>+ Child emitter</b>), <b>Load firework…</b> opens any game firework (as a copy) or one of yours.
        <b>Save firework</b> adds it to your fireworks in the palette; <b>Save to game</b> writes a <code>.frw</code> into the game's Fireworks folder;
        <b>Download .frw</b> saves the file. <b>← MixMaster</b> goes back. <kbd>Ctrl+Z</kbd> undoes, <kbd>F</kbd> fires.</p>` },
];
