// Fireworks editor: the Advanced Laser Designer and Advanced WaterJet Designer, as in RCT3 Soaked!. Settings at the
// top; below them timelines of control points (colour, rotation speed, elevation, beam width / pressure, elevation,
// jet radius, colour): click an empty spot to add a point, drag a point to move it, right-click to delete it, and
// edit the selected point's value underneath. Persisting-image lasers draw frames made on a sketch pad.
// The effect plays on a laser dome / water jet base in the scene while you edit.
import { blenderAt } from './fw_effects.js';

const RENDER = ['Cone of Light', 'Plane of Light', 'Persisting Image'];
const css = `
  #fw .fwd-win { position: fixed; top: 58px; right: 14px; width: min(600px, 96vw); max-height: calc(100vh - 72px); overflow: auto; z-index: 60;
    background: var(--panel); border: 1px solid var(--accent); border-radius: 10px; box-shadow: 0 10px 40px #000a; font-size: 12px; }
  #fw .fwd-win header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--panel2);
    border-bottom: 1px solid var(--line); cursor: move; }
  #fw .fwd-win header b { color: var(--accent); font-size: 14px; flex: 1; }
  #fw .fwd-win .body { padding: 10px 12px; display: grid; gap: 10px; }
  #fw .fwd-win .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; }
  #fw .fwd-win label { display: grid; grid-template-columns: 110px 1fr; align-items: center; gap: 6px; color: var(--dim); }
  #fw .fwd-win input[type=number], #fw .fwd-win input[type=text], #fw .fwd-win select { width: 100%; min-width: 0; background: var(--bg); color: var(--text);
    border: 1px solid var(--line); border-radius: 6px; padding: 4px 6px; font: inherit; }
  #fw .fwd-win .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  #fw .fwd-win .kt { border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; background: var(--bg); }
  #fw .fwd-win .kt .hd { display: flex; justify-content: space-between; color: var(--dim); margin-bottom: 4px; }
  #fw .fwd-win .kt canvas { width: 100%; height: 46px; display: block; cursor: copy; border-radius: 4px; }
  #fw .fwd-win .kt .ed { display: flex; gap: 8px; align-items: center; margin-top: 5px; color: var(--dim); flex-wrap: wrap; }
  #fw .fwd-win .kt .ed input[type=number] { width: 80px; }
  #fw .fwd-win .frames { display: flex; gap: 6px; flex-wrap: wrap; }
  #fw .fwd-win .frames .fr { width: 58px; height: 58px; border: 1px solid var(--line); border-radius: 6px; background: #000; cursor: pointer; position: relative; }
  #fw .fwd-win .frames .fr span { position: absolute; left: 3px; bottom: 1px; font-size: 10px; color: #aaa; }
  #fw .fwd-win .frames .add { display: flex; align-items: center; justify-content: center; color: var(--dim); font-size: 22px; background: var(--bg); }
  #fw .fwd-win .hint { color: var(--dim); font-size: 11px; }
  #fw .sketch canvas { background: #020308; border: 1px solid var(--line); border-radius: 6px; touch-action: none; cursor: crosshair; }
`;
let styled = false;

// ---- a window inside the editor -------------------------------------------------------------------------------
function makeWindow(ctx, title, onClose) {
  if (!styled) { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); styled = true; }
  ctx.root.querySelectorAll('.fwd-win').forEach(w => w._close?.());
  const w = document.createElement('div'); w.className = 'fwd-win';
  w.innerHTML = `<header><b>${ctx.esc(title)}</b><button data-w="close" title="Close">✕</button></header><div class="body"></div>`;
  ctx.root.appendChild(w);
  const hd = w.querySelector('header');
  hd.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = w.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
    hd.setPointerCapture(e.pointerId);
    hd.onpointermove = ev => { w.style.left = Math.max(0, r.left + ev.clientX - x0) + 'px'; w.style.top = Math.max(0, r.top + ev.clientY - y0) + 'px'; w.style.right = 'auto'; };
    hd.onpointerup = () => { hd.onpointermove = null; };
  });
  w._close = () => { onClose?.(); w.remove(); };
  hd.querySelector('[data-w=close]').onclick = () => w._close();
  return w;
}

// ---- control-point timeline -----------------------------------------------------------------------------------
// opts: {label, colour (bool), min, max, step, unit, show(v) -> text, get() -> blender, duration(), time() -> playhead, changed()}
export function keyTimeline(ctx, parent, opts) {
  const box = document.createElement('div'); box.className = 'kt';
  box.innerHTML = `<div class="hd"><span>${ctx.esc(opts.label)}</span><span class="hint">click: add · drag: move · right-click: delete</span></div><canvas></canvas><div class="ed"></div>`;
  parent.appendChild(box);
  const cv = box.querySelector('canvas'), ed = box.querySelector('.ed');
  let sel = 0;
  const bl = () => opts.get(), pts = () => bl().pts;
  const D = () => Math.max(0.1, opts.duration());
  const W = () => cv.clientWidth, H = 46;
  const xOf = t => 8 + (W() - 16) * Math.min(1, t / D()), tOf = x => Math.max(0, Math.min(D(), (x - 8) / (W() - 16) * D()));
  const yOf = v => H - 6 - (H - 12) * Math.max(0, Math.min(1, (v - opts.min) / (opts.max - opts.min)));
  const vOf = y => opts.min + (opts.max - opts.min) * Math.max(0, Math.min(1, (H - 6 - y) / (H - 12)));
  function drawIt() {
    const dpr = devicePixelRatio || 1, w = W();
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0a0d14'; g.fillRect(0, 0, w, H);
    const P = pts();
    if (opts.colour) {
      for (let x = 8; x < w - 8; x += 2) {
        const c = blenderAt(bl(), tOf(x), D()); if (!Array.isArray(c)) continue;
        g.fillStyle = `rgba(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0},${Math.max(0.08, c[3])})`; g.fillRect(x, 14, 2, H - 28);
      }
    } else {
      g.strokeStyle = '#ffffff12'; g.beginPath(); const y0 = yOf(Math.max(opts.min, Math.min(opts.max, 0))); g.moveTo(8, y0); g.lineTo(w - 8, y0); g.stroke();
      g.strokeStyle = '#ffb02e'; g.lineWidth = 1.5; g.beginPath();
      for (let x = 8; x <= w - 8; x += 3) { const y = yOf(+blenderAt(bl(), tOf(x), D())); x === 8 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke();
    }
    P.forEach((p, i) => {
      const x = xOf(p.t), y = opts.colour ? H / 2 : yOf(p.v);
      g.fillStyle = i === sel ? '#ffffff' : opts.colour ? `rgb(${p.v[0] * 255 | 0},${p.v[1] * 255 | 0},${p.v[2] * 255 | 0})` : '#ffd23e';
      g.strokeStyle = '#000'; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 6, y); g.lineTo(x, y + 6); g.lineTo(x - 6, y); g.closePath(); g.fill(); g.stroke();
    });
    const t = opts.time?.();
    if (t != null && t >= 0 && t <= D()) { g.fillStyle = '#ff5050'; g.fillRect(xOf(t) - 1, 0, 2, H); }
  }
  function editor() {
    const p = pts()[sel]; if (!p) { ed.innerHTML = ''; return; }
    ed.innerHTML = `Point ${sel + 1}/${pts().length} · time <input type="number" data-e="t" step="0.05" min="0" value="${p.t.toFixed(2)}"> s ` +
      (opts.colour ? `colour <input type="color" data-e="c" value="${ctx.hex(p.v)}"> brightness <input type="range" data-e="a" min="0" max="1" step="0.01" value="${p.v[3]}">`
        : `value <input type="number" data-e="v" step="${opts.step}" min="${opts.min}" max="${opts.max}" value="${(+p.v).toFixed(3)}"> ${opts.unit || ''} <span>${opts.show ? opts.show(+p.v) : ''}</span>`);
  }
  ed.addEventListener('input', e => {
    const p = pts()[sel]; if (!p) return;
    const k = e.target.dataset.e, v = e.target.value;
    if (k === 't') p.t = Math.max(0, Math.min(D(), +v || 0));
    if (k === 'v') p.v = Math.max(opts.min, Math.min(opts.max, +v || 0));
    if (k === 'c') p.v = [...ctx.unhex(v), p.v[3]];
    if (k === 'a') p.v = [p.v[0], p.v[1], p.v[2], +v];
    pts().sort((a, b) => a.t - b.t); sel = pts().indexOf(p);
    drawIt(); opts.changed();
    if (k === 'v' && opts.show) ed.querySelector('span').textContent = opts.show(+p.v);
  });
  const hit = e => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const i = pts().findIndex(p => Math.abs(xOf(p.t) - x) < 8 && (opts.colour || Math.abs(yOf(p.v) - y) < 10));
    return [i, x, y];
  };
  cv.addEventListener('contextmenu', e => {
    e.preventDefault();
    const [i] = hit(e);
    if (i >= 0 && pts().length > 1) { pts().splice(i, 1); sel = Math.min(sel, pts().length - 1); drawIt(); editor(); opts.changed(); }
  });
  cv.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    let [i, x, y] = hit(e);
    if (i < 0) {
      if (pts().length >= 20) { ctx.toast('A timeline holds at most 20 control points'); return; }
      const t = tOf(x), v = opts.colour ? (Array.isArray(blenderAt(bl(), t, D())) ? [...blenderAt(bl(), t, D())] : [1, 1, 1, 1]) : vOf(y);
      const p = { t, v }; pts().push(p); pts().sort((a, b) => a.t - b.t); i = pts().indexOf(p); opts.changed();
    }
    sel = i; drawIt(); editor();
    const p = pts()[i];
    cv.setPointerCapture(e.pointerId);
    cv.onpointermove = ev => {
      const r = cv.getBoundingClientRect();
      p.t = Math.round(tOf(ev.clientX - r.left) * 100) / 100;
      if (!opts.colour) p.v = Math.round(vOf(ev.clientY - r.top) / opts.step) * opts.step;
      pts().sort((a, b) => a.t - b.t); sel = pts().indexOf(p); drawIt(); editor(); opts.changed();
    };
    cv.onpointerup = () => { cv.onpointermove = cv.onpointerup = null; };
  });
  drawIt(); editor();
  return { draw: drawIt, refresh() { sel = Math.min(sel, pts().length - 1); drawIt(); editor(); } };
}

// ---- shared designer frame ------------------------------------------------------------------------------------
function designer(ctx, kind, def, key, cfg) {
  const ext = kind === 'laser' ? 'las' : 'wjt';
  let handle = ctx.previewEffect(kind, def, { loop: true }), raf = 0;
  const w = makeWindow(ctx, cfg.title, () => { handle?.stop(); cancelAnimationFrame(raf); });
  const body = w.querySelector('.body');
  const list = () => Object.values(ctx.REG[kind]).sort((a, b) => a.title.localeCompare(b.title));
  body.innerHTML = `
    <div class="row">
      <select data-d="load" title="Load ${cfg.one}"><option value="">Load ${cfg.one}…</option>${list().map(d => `<option value="${ctx.esc(d.key)}">${ctx.esc(d.title)}${d.key.startsWith('my:') ? ' (yours)' : ''}</option>`).join('')}</select>
      <button data-d="new">New</button>
      <button data-d="save" class="big" title="Save into your ${cfg.one}s (palette)">Save ${cfg.one}</button>
      <button data-d="game" title="Save as a .${ext} file in the game's ${kind === 'laser' ? 'Lasers' : 'WaterJets'} folder">Save to game</button>
      <button data-d="dl" title="Download the .${ext} file">Download .${ext}</button>
      <button data-d="del" title="Delete this ${cfg.one} from your ${cfg.one}s">Delete selected ${cfg.one}</button>
    </div>
    <div class="grid2" data-d="fields"></div>
    <div data-d="extra"></div>
    <div data-d="lines" style="display:grid;gap:8px"></div>
    <div class="row"><label style="grid-template-columns:auto auto;gap:6px"><input type="checkbox" data-d="loop" checked> Preview in the scene (loops)</label>
      <span class="hint" data-d="where"></span></div>`;
  const $ = s => body.querySelector(`[data-d="${s}"]`);
  const where = () => { const li = ctx.previewLauncher(kind); $('where').textContent = li >= 0 ? `on launcher #${li + 1}` : `(add a ${kind === 'laser' ? 'laser dome' : 'water jet base'} to the show to see it there)`; };
  where();
  let lines = [];
  function changed() { handle?.set(def); }
  function build() {
    $('fields').innerHTML = cfg.fields(def);
    $('extra').innerHTML = ''; cfg.extra?.(def, $('extra'), changed);
    $('lines').innerHTML = '';
    lines = cfg.lines.map(L => keyTimeline(ctx, $('lines'), { ...L, get: () => def[L.key], duration: () => def.duration, time: () => handle?.time?.(), changed }));
  }
  build();
  $('fields').addEventListener('input', e => {
    const k = e.target.dataset.f; if (!k) return;
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' || e.target.type === 'range' ? +e.target.value : e.target.value;
    if (k === 'duration') {
      const old = def.duration, nd = Math.max(0.5, Math.min(120, v || 0.5));
      for (const L of cfg.lines) { const b = def[L.key]; if (b.scale && old > 0) for (const p of b.pts) p.t *= nd / old; b.max = nd; }
      def.duration = nd; lines.forEach(l => l.refresh());
    } else if (k === 'scale') { for (const L of cfg.lines) def[L.key].scale = v; }
    else def[k] = k === 'render' || k === 'beams' || k === 'type' ? Math.round(v) : v;
    if (k === 'render') { build(); }
    cfg.after?.(def, body); changed();
  });
  $('loop').onchange = e => { if (e.target.checked) { handle = ctx.previewEffect(kind, def, { loop: true }); where(); } else { handle?.stop(); handle = null; } };
  $('load').onchange = e => {
    const k = e.target.value; if (!k) return;
    const src = JSON.parse(JSON.stringify(ctx.REG[kind][k]));
    Object.keys(def).forEach(x => delete def[x]); Object.assign(def, src);
    key = k.startsWith('my:') ? k : null;
    if (!key) def.name = def.title = (src.title || src.name) + ' (copy)';
    e.target.value = ''; build(); changed(); handle?.restart?.(); ctx.toast('Loaded ' + src.title);
  };
  $('new').onclick = () => { const d = cfg.fresh(); Object.keys(def).forEach(x => delete def[x]); Object.assign(def, d); key = null; build(); changed(); handle?.restart?.(); };
  $('save').onclick = () => { def.title = def.name; key = ctx.saveMine(kind, def, key); ctx.toast(`Saved “${def.name}” in your ${cfg.one}s`); };
  $('game').onclick = async () => {
    try { const r = await ctx.saveToGame(ext, def, def.name); ctx.toast(`Saved ${r.file} into the game folder`); ctx.reload(); }
    catch (e) { ctx.toast('Could not save: ' + e.message); }
  };
  $('dl').onclick = () => ctx.download(ext, def, def.name).catch(e => ctx.toast('Could not build: ' + e.message));
  $('del').onclick = () => {
    if (!key) { ctx.toast(`Only your own ${cfg.one}s can be deleted (the game's stay)`); return; }
    if (!confirm(`Delete “${def.name}” from your ${cfg.one}s?`)) return;
    ctx.deleteMine(kind, key); key = null; ctx.toast('Deleted');
  };
  const tick = () => { lines.forEach(l => l.draw()); cfg.tick?.(def, body, handle); raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick);
  cfg.after?.(def, body);
  return w;
}

const num = (ctx, k, label, v, min, max, step, title = '') => `<label title="${ctx.esc(title)}">${label}<input type="number" data-f="${k}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
const deg = r => (r * 180 / Math.PI).toFixed(0) + '°';

// ---- Advanced Laser Designer -------------------------------------------------------------------------------------
export function openLaserDesigner(ctx, def, key) {
  def.name = def.name || def.title || 'My laser'; def.images = def.images || []; def.centre ??= true;
  def.colour.scale ??= true;
  return designer(ctx, 'laser', def, key, {
    title: 'Advanced Laser Designer', one: 'laser', fresh: () => ({ ...JSON.parse(JSON.stringify(ctx.newLaser())) }),
    fields: d => `
      <label>Name:<input type="text" data-f="name" value="${ctx.esc(d.name)}"></label>
      <label>Type:<select data-f="render">${RENDER.map((r, i) => `<option value="${i}"${i === d.render ? ' selected' : ''}>${r}</option>`).join('')}</select></label>
      ${num(ctx, 'duration', 'Duration:', d.duration, 0.5, 120, 0.5, 'Seconds the laser runs')}
      ${num(ctx, 'power', 'Power:', d.power, 5, 900, 5, 'How far the beams travel before becoming invisible (m)')}
      ${num(ctx, 'trail', 'Trail Persist.:', d.trail, 0, 1, 0.01, "How much 'afterglow' appears behind each beam as it moves (s)")}
      ${d.render === 2 ? num(ctx, 'image_scale', 'Scale:', d.image_scale, 1, 60, 0.5, 'Image size') : num(ctx, 'beams', 'No. beams:', d.beams, 1, 100, 1, 'Beams fired from the emitter')}
      <label title="Point times stretch when the duration changes"><span>Scale settings with duration</span><input type="checkbox" data-f="scale" ${d.colour.scale ? 'checked' : ''}></label>
      ${d.render === 2 ? `<label><span>Centralise image projection</span><input type="checkbox" data-f="centre" ${d.centre ? 'checked' : ''}></label>` : '<span></span>'}
      <label>Cost:<span data-cost></span></label>`,
    after(d, body) { const c = body.querySelector('[data-cost]'); if (c) c.textContent = '$' + laserCost(d).toFixed(2); },
    extra(d, el, changed) {
      if (d.render !== 2) return;
      el.innerHTML = `<div style="color:var(--dim);margin-bottom:4px">Images: <span class="hint">the laser draws each frame in turn, left to right · click to edit · right-click to delete</span></div><div class="frames"></div>`;
      const fr = el.querySelector('.frames');
      const paint = () => {
        fr.innerHTML = '';
        d.images.forEach((im, i) => {
          const c = document.createElement('canvas'); c.width = c.height = 58; c.className = 'fr'; drawFrame(c, im, 58, d.colour.pts[0]?.v);
          const wrap = document.createElement('div'); wrap.className = 'fr'; wrap.appendChild(c); c.style.border = 0;
          const s = document.createElement('span'); s.textContent = `${i + 1} · ${(im.duration || 1).toFixed(1)}s`; wrap.appendChild(s);
          wrap.onclick = () => sketchPad(ctx, im, () => { paint(); changed(); });
          wrap.oncontextmenu = e => { e.preventDefault(); d.images.splice(i, 1); paint(); changed(); };
          fr.appendChild(wrap);
        });
        const add = document.createElement('div'); add.className = 'fr add'; add.textContent = '+'; add.title = 'Add a frame';
        add.onclick = () => { const im = { duration: 1.2, points: [], solid: [] }; d.images.push(im); paint(); sketchPad(ctx, im, () => { paint(); changed(); }); };
        fr.appendChild(add);
      };
      paint();
    },
    lines: [
      { key: 'colour', label: 'Color', colour: true },
      { key: 'rotvel', label: 'Rotation speed', min: -15, max: 15, step: 0.01, unit: 'rad/s', show: v => (v * 180 / Math.PI).toFixed(0) + '°/s' },
      { key: 'elevation', label: 'Elevation', min: -0.2, max: Math.PI / 2, step: 0.01, unit: 'rad', show: deg },
      { key: 'width', label: 'Beam width', min: 0.1, max: 4, step: 0.01, unit: '' },
    ],
  });
}
function laserCost(d) { return 50 + (d.render === 2 ? 40 * (d.images?.length || 1) : (d.beams || 1) * 6) + (d.power || 0) * 0.25 + (d.duration || 0) * 8; }

// ---- Advanced WaterJet Designer ----------------------------------------------------------------------------------
export function openJetDesigner(ctx, def, key) {
  def.name = def.name || def.title || 'My water jet';
  return designer(ctx, 'jet', def, key, {
    title: 'Advanced WaterJet Designer', one: 'water jet', fresh: () => JSON.parse(JSON.stringify(ctx.newJet())),
    fields: d => `
      <label>Name:<input type="text" data-f="name" value="${ctx.esc(d.name)}"></label>
      ${num(ctx, 'duration', 'Duration:', d.duration, 0.5, 120, 0.5, 'Seconds the jet runs')}
      <label title="Point times stretch when the duration changes"><span>Scale settings with duration</span><input type="checkbox" data-f="scale" ${d.pressure.scale ? 'checked' : ''}></label>
      <label>Type:<select data-f="type"><option value="1"${d.type === 1 ? ' selected' : ''}>Jet</option><option value="0"${d.type === 0 ? ' selected' : ''}>Spray</option></select></label>`,
    lines: [
      { key: 'pressure', label: 'Pressure: the speed at which water leaves the nozzle', min: 0, max: 35, step: 0.1, unit: 'm/s', show: v => `about ${(v * v / 19.6).toFixed(1)} m high` },
      { key: 'elevation', label: 'Elevation (tilt from straight up)', min: -1.6, max: 1.6, step: 0.01, unit: 'rad', show: deg },
      { key: 'radius', label: 'Jet radius: the width of the nozzle', min: 0.05, max: 3, step: 0.01, unit: '' },
      { key: 'colour', label: 'Color', colour: true },
    ],
  });
}

// ---- sketch pad for persisting-image frames -------------------------------------------------------------------------
function drawFrame(c, im, size, col) {
  const g = c.getContext('2d'); g.fillStyle = '#020308'; g.fillRect(0, 0, size, size);
  const P = im.points || [], k = size / 22, cx = size / 2;
  const rgb = col && Array.isArray(col) ? `rgb(${col[0] * 255 | 0},${col[1] * 255 | 0},${col[2] * 255 | 0})` : '#ff4a4a';
  g.strokeStyle = rgb; g.lineWidth = Math.max(1, size / 120); g.shadowColor = rgb; g.shadowBlur = size / 40;
  g.beginPath();
  P.forEach((p, i) => { const x = cx + p[0] * k, y = cx - p[1] * k; if (!i || !(im.solid?.[i] ?? 1)) g.moveTo(x, y); else g.lineTo(x, y); });
  g.stroke();
}
function sketchPad(ctx, im, done) {
  const work = { duration: im.duration || 1.2, points: (im.points || []).map(p => [...p]), solid: [...(im.solid || [])] };
  const [box, close] = ctx.dialog(`<h4>Laser image frame</h4>
    <div class="sketch" style="display:grid;gap:8px;justify-items:center"><canvas width="360" height="360" style="width:360px;height:360px"></canvas></div>
    <div class="row" style="justify-content:flex-start"><span style="color:var(--dim)">Frame duration</span><input type="number" data-k="dur" min="0.1" max="20" step="0.1" value="${work.duration}" style="width:70px;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:4px">
      <select data-k="load" style="background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:4px"><option value="">Load drawing…</option>${(ctx.data.drawings || []).map((d, i) => `<option value="${i}">${ctx.esc(d.name)}</option>`).join('')}</select>
      <span class="hint" data-k="n"></span></div>
    <div class="row"><button data-k="undo">Undo stroke</button><button data-k="clear" title="Erase the image">🗑 Clear</button><span style="flex:1"></span><button data-k="cancel">Cancel</button><button data-k="ok" class="big">✔ OK</button></div>`);
  const cv = box.querySelector('canvas'), S = 360, k = S / 22, max = 1000;
  const toPad = e => { const r = cv.getBoundingClientRect(); return [Math.max(-10, Math.min(10, ((e.clientX - r.left) * S / r.width - S / 2) / k)), Math.max(-10, Math.min(10, (S / 2 - (e.clientY - r.top) * S / r.height) / k))]; };
  const paint = () => {
    drawFrame(cv, work, S);
    const g = cv.getContext('2d'); g.shadowBlur = 0; g.strokeStyle = '#ffffff10'; g.lineWidth = 1;
    for (let i = -10; i <= 10; i += 5) { g.beginPath(); g.moveTo(S / 2 + i * k, 0); g.lineTo(S / 2 + i * k, S); g.moveTo(0, S / 2 - i * k); g.lineTo(S, S / 2 - i * k); g.stroke(); }
    box.querySelector('[data-k=n]').textContent = `${work.points.length} / ${max} points`;
  };
  const strokes = [];
  cv.addEventListener('pointerdown', e => {
    if (work.points.length >= max) { ctx.toast('A frame holds at most 1000 points'); return; }
    strokes.push(work.points.length);
    work.points.push(toPad(e)); work.solid.push(0);
    cv.setPointerCapture(e.pointerId);
    cv.onpointermove = ev => {
      const p = toPad(ev), q = work.points[work.points.length - 1];
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.18 && work.points.length < max) { work.points.push(p); work.solid.push(1); paint(); }
    };
    cv.onpointerup = () => { cv.onpointermove = cv.onpointerup = null; paint(); };
    paint();
  });
  box.addEventListener('change', e => {
    if (e.target.dataset.k === 'dur') work.duration = Math.max(0.1, +e.target.value || 1);
    if (e.target.dataset.k === 'load' && e.target.value !== '') {
      const d = ctx.data.drawings[+e.target.value]; work.points = d.points.map(p => [...p]); work.solid = [...d.solid]; work.duration = d.duration || work.duration;
      box.querySelector('[data-k=dur]').value = work.duration; strokes.length = 0; paint();
    }
  });
  box.addEventListener('click', e => {
    const a = e.target.dataset.k;
    if (a === 'clear') { work.points = []; work.solid = []; strokes.length = 0; paint(); }
    if (a === 'undo' && strokes.length) { const n = strokes.pop(); work.points.length = n; work.solid.length = n; paint(); }
    if (a === 'cancel') close();
    if (a === 'ok') { Object.assign(im, work); close(); done(); }
  });
  paint();
}
