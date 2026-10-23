// Textures & GUI: the game's pictures and interface, editable and saved back into the game.
// - Texture Editor: every texture in the game (tex and the 256-colour ftx, animated ones frame by frame): paint,
//   fill, shapes, text, selections, colour adjustments, import / export PNG; "Save into game" writes the picture
//   back into its OVL in the same size and format (texedit.py), the original files are backed up first.
// - GUI Editor: the interface built from those pictures: icon sheets with every icon's rectangle (move and resize
//   them, edit their pixels), the in-park screen (top bar and left buttons) drawn from those icons, all icons as a
//   gallery, button states played as a button (normal / hover / pressed / disabled), numbered icon sets played and
//   edited as animations, window frame pieces stretched like a window, the menu screens and fonts, and every menu
//   text of each language.
// Opened full-window from the viewer's "Textures & GUI" tab; "Back" returns to the viewer.
import { runTour, tourRunning } from './tour.js';

let ui = null;
export async function openTexGui({ onBack, open }) {
  if (!ui) ui = build();
  ui.onBack = onBack;
  ui.root.style.display = 'grid';
  history.replaceState(null, '', '#textures');
  await ui.ready;
  if (open) ui.openTexture(open.path, open.name);
  setTimeout(() => ui.tour(false), 900);
}

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const spaced = s => String(s ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').replace(/_/g, ' ');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const imgUrl = (path, name, frame = 0, colors) => `/api/tx/image?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}&frame=${frame}` +
  (colors ? '&colors=' + colors.map(c => c.slice(1)).join(',') : '');
const folderOf = p => p.includes('\\') ? p.split('\\')[0] : '(game folder)';
const hex2rgba = (h, a = 255) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];
const rgba2hex = c => '#' + c.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: 'bad reply' }));
  if (!r.ok || j.error) throw new Error(j.error || r.statusText);
  return j;
}
function loadImage(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('could not load ' + url)); i.src = url; });
}
function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const blobB64 = blob => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

// ---- a zoomable, pannable picture --------------------------------------------------------------------------------
// draw(ctx, view) paints the picture; overlays in image pixels go through view.sx / view.sy (image -> screen)
class View {
  constructor(canvas, draw) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.draw = draw;
    this.z = 1; this.ox = 0; this.oy = 0; this.w = 1; this.h = 1; this.pending = false;
    this.checker = null;
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      this.zoomAt(this.z * (e.deltaY < 0 ? 1.25 : 0.8), mx, my);
    }, { passive: false });
    new ResizeObserver(() => this.redraw()).observe(canvas.parentElement);
  }
  setSize(w, h) { this.w = w; this.h = h; }
  fit() {
    const r = this.c.parentElement.getBoundingClientRect();
    const z = Math.min((r.width - 40) / this.w, (r.height - 40) / this.h);
    this.z = z >= 1 ? Math.max(1, Math.floor(z)) : z;
    this.ox = (r.width - this.w * this.z) / 2; this.oy = (r.height - this.h * this.z) / 2;
    this.redraw();
  }
  zoomAt(z, mx, my) {
    z = clamp(z, 0.05, 64);
    const ix = (mx - this.ox) / this.z, iy = (my - this.oy) / this.z;
    this.z = z; this.ox = mx - ix * z; this.oy = my - iy * z; this.redraw();
  }
  zoomTo(rect, pad = 0.15, max = 32) {           // [l, t, r, b] (right / bottom exclusive) fills the view
    const r = this.c.parentElement.getBoundingClientRect(), w = Math.max(1, rect[2] - rect[0]), h = Math.max(1, rect[3] - rect[1]);
    this.z = clamp(Math.min(r.width * (1 - pad) / w, r.height * (1 - pad) / h), 0.05, max);
    this.ox = r.width / 2 - (rect[0] + w / 2) * this.z; this.oy = r.height / 2 - (rect[1] + h / 2) * this.z; this.redraw();
  }
  toImage(e) { const r = this.c.getBoundingClientRect(); return [(e.clientX - r.left - this.ox) / this.z, (e.clientY - r.top - this.oy) / this.z]; }
  sx(x) { return this.ox + x * this.z; }
  sy(y) { return this.oy + y * this.z; }
  redraw() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      const r = this.c.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      if (this.c.width !== Math.round(r.width * dpr) || this.c.height !== Math.round(r.height * dpr)) {
        this.c.width = Math.round(r.width * dpr); this.c.height = Math.round(r.height * dpr);
        this.c.style.width = r.width + 'px'; this.c.style.height = r.height + 'px';
      }
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      // checkerboard under the picture: transparency shows
      if (!this.checker) {
        const p = canvasOf(16, 16), g = p.getContext('2d');
        g.fillStyle = '#3a3d45'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#2b2e35'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
        this.checker = ctx.createPattern(p, 'repeat');
      }
      ctx.fillStyle = this.checker; ctx.fillRect(this.ox, this.oy, this.w * this.z, this.h * this.z);
      ctx.imageSmoothingEnabled = this.z < 1;
      this.draw(ctx, this);
      if (this.z >= 8) {                      // pixel grid when zoomed in
        ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.beginPath();
        const x0 = Math.max(0, Math.floor(-this.ox / this.z)), x1 = Math.min(this.w, Math.ceil((r.width - this.ox) / this.z));
        const y0 = Math.max(0, Math.floor(-this.oy / this.z)), y1 = Math.min(this.h, Math.ceil((r.height - this.oy) / this.z));
        for (let x = x0; x <= x1; x++) { ctx.moveTo(Math.round(this.sx(x)) + .5, this.sy(y0)); ctx.lineTo(Math.round(this.sx(x)) + .5, this.sy(y1)); }
        for (let y = y0; y <= y1; y++) { ctx.moveTo(this.sx(x0), Math.round(this.sy(y)) + .5); ctx.lineTo(this.sx(x1), Math.round(this.sy(y)) + .5); }
        ctx.stroke();
      }
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(Math.round(this.ox) - .5, Math.round(this.oy) - .5, Math.round(this.w * this.z) + 1, Math.round(this.h * this.z) + 1);
    });
  }
}

// pan with the middle / right button or Space + drag; returns true when it took the event
function panner(view, canvas, spaceHeld) {
  let pan = null;
  canvas.addEventListener('pointerdown', e => {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceHeld())) {
      pan = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy }; canvas.setPointerCapture(e.pointerId); e.stopImmediatePropagation(); e.preventDefault();
    }
  }, true);
  canvas.addEventListener('pointermove', e => {
    if (!pan) return;
    view.ox = pan.ox + e.clientX - pan.x; view.oy = pan.oy + e.clientY - pan.y; view.redraw(); e.stopImmediatePropagation();
  }, true);
  canvas.addEventListener('pointerup', e => { if (pan) { pan = null; e.stopImmediatePropagation(); } }, true);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

// ---- colour helpers ---------------------------------------------------------------------------------------------
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hsl2rgb(h, s, l) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t % 1 + 1) % 1; return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p); };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

// ================================================================================================================
function build() {
  const css = document.createElement('style');
  css.textContent = `
  #tg { position: fixed; inset: 0; z-index: 50; display: none; background: var(--bg); color: var(--text);
        grid-template-columns: var(--tgl, 290px) minmax(0, 1fr) var(--tgr, 320px); grid-template-rows: auto minmax(0, 1fr); font-size: 13px; }
  #tg .bar { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--panel2); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  #tg .bar h2 { margin: 0 6px 0 4px; font-size: 15px; color: var(--accent); white-space: nowrap; }
  #tg .bar .grow { flex: 1; }
  #tg .bar .sep { width: 1px; align-self: stretch; background: var(--line); margin: 0 2px; }
  #tg .back { border-color: var(--accent); color: var(--accent); }
  #tg .modes { display: flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  #tg .modes button { border: 0; border-radius: 0; padding: 6px 14px; font-weight: 600; background: transparent; }
  #tg .modes button.on { background: var(--sel); color: var(--accent); }
  #tg .side { background: var(--panel); display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  #tg .side.left { border-right: 1px solid var(--line); }
  #tg .side.right { border-left: 1px solid var(--line); overflow: auto; }
  #tg .scroll { overflow: auto; flex: 1; min-height: 0; }
  #tg .filters { padding: 10px 10px 6px; display: grid; gap: 6px; }
  #tg .filters input, #tg .filters select, #tg .right input[type=text], #tg .right input[type=number], #tg .right select, #tg textarea {
    width: 100%; box-sizing: border-box; background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 5px 7px; font: inherit; }
  #tg .count { color: var(--dim); font-size: 11px; padding: 0 12px 6px; }
  #tg .grp { padding: 10px 12px 3px; color: var(--accent); font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  #tg .it { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 8px; padding: 3px 10px; cursor: pointer; align-items: center; }
  #tg .it:hover { background: #ffffff0a; } #tg .it.sel { background: var(--sel); }
  #tg .it img, #tg .it .ph { width: 34px; height: 34px; object-fit: contain; background: #0003; border-radius: 4px; image-rendering: pixelated; }
  #tg .it .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #tg .it small { display: block; color: var(--dim); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #tg .mod { color: var(--accent); font-weight: 700; }
  #tg .li { padding: 4px 12px 4px 18px; cursor: pointer; display: flex; gap: 6px; align-items: baseline; }
  #tg .li:hover { background: #ffffff0a; } #tg .li.sel { background: var(--sel); color: var(--accent); }
  #tg .li small { color: var(--dim); margin-left: auto; white-space: nowrap; }
  #tg .centre { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  #tg .ctool { display: flex; gap: 6px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--line); background: var(--panel); flex-wrap: wrap; min-height: 34px; }
  #tg .ctool .title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40ch; }
  #tg .ctool small { color: var(--dim); }
  #tg .stage { position: relative; flex: 1; min-height: 0; overflow: hidden; }
  #tg .stage canvas { position: absolute; inset: 0; display: block; touch-action: none; }
  #tg .tools { position: absolute; left: 8px; top: 8px; display: grid; gap: 3px; z-index: 2; background: #1d2027e6; padding: 4px; border-radius: 8px; border: 1px solid var(--line); }
  #tg .tools button { width: 34px; height: 30px; padding: 0; font-size: 15px; }
  #tg .tools button.on { background: var(--sel); border-color: var(--accent); color: var(--accent); }
  #tg .status { position: absolute; left: 0; right: 0; bottom: 0; padding: 3px 10px; font: 11px ui-monospace, Consolas, monospace; color: var(--dim); background: #15171cd0; pointer-events: none; z-index: 2; }
  #tg .empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--dim); text-align: center; padding: 30px; pointer-events: none; }
  #tg .right h3 { margin: 0; padding: 12px 12px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--accent); }
  #tg .right .sec { padding: 0 12px 10px; display: grid; gap: 7px; }
  #tg .right label.row { display: grid; grid-template-columns: 82px minmax(0, 1fr) 38px; gap: 6px; align-items: center; color: var(--dim); }
  #tg .right label.row output { color: var(--text); font: 11px ui-monospace, Consolas, monospace; text-align: right; }
  #tg .right .btns { display: flex; gap: 5px; flex-wrap: wrap; }
  #tg .right .btns button { flex: 1 1 auto; font-size: 12px; padding: 4px 6px; }
  #tg .right .kv { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px 10px; color: var(--dim); }
  #tg .right .kv b { color: var(--text); font-weight: 500; overflow-wrap: anywhere; }
  #tg .right .note { color: var(--dim); font-size: 11px; line-height: 1.45; }
  #tg button.primary { background: var(--accent); color: #111; border-color: var(--accent); font-weight: 600; }
  #tg button.warn { border-color: #c96; color: #fc9; }
  #tg .cols { display: flex; gap: 8px; align-items: center; }
  #tg .swatch { width: 38px; height: 30px; border-radius: 6px; border: 1px solid var(--line); padding: 0; cursor: pointer; }
  #tg .recent { display: flex; gap: 3px; flex-wrap: wrap; }
  #tg .recent i { width: 16px; height: 16px; border-radius: 3px; border: 1px solid #0006; cursor: pointer; display: inline-block; }
  #tg .frames { display: flex; gap: 4px; flex-wrap: wrap; }
  #tg .frames button { min-width: 30px; padding: 3px 6px; font-size: 12px; }
  #tg .frames button.on { background: var(--sel); border-color: var(--accent); color: var(--accent); }
  #tg .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; padding: 12px; overflow: auto; position: absolute; inset: 0; align-content: start; }
  #tg .gallery .g { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 6px; cursor: pointer; text-align: center; min-width: 0; }
  #tg .gallery .g:hover, #tg .gallery .g.sel { border-color: var(--accent); }
  #tg .gallery .g canvas { max-width: 100%; max-height: 72px; image-rendering: pixelated; position: static; display: inline-block; }
  #tg .gallery .g div { font-size: 10px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 3px; }
  #tg .panelview { position: absolute; inset: 0; overflow: auto; padding: 16px; }
  #tg .state { display: inline-grid; gap: 4px; text-align: center; margin: 0 10px 12px 0; vertical-align: top; cursor: pointer; }
  #tg .state canvas { position: static; image-rendering: pixelated; background: #0003; border-radius: 6px; border: 1px solid var(--line); }
  #tg .state small { color: var(--dim); font-size: 11px; }
  #tg .mock { display: inline-block; padding: 18px; background: #0002; border-radius: 10px; border: 1px dashed var(--line); }
  #tg .mock canvas { position: static; image-rendering: pixelated; cursor: pointer; }
  #tg .texts { position: absolute; inset: 0; overflow: auto; }
  #tg .texts table { width: 100%; border-collapse: collapse; }
  #tg .texts td { border-bottom: 1px solid var(--line); padding: 4px 8px; vertical-align: top; }
  #tg .texts td.k { color: var(--dim); font: 11px ui-monospace, Consolas, monospace; width: 28%; overflow-wrap: anywhere; }
  #tg .texts textarea { min-height: 30px; resize: vertical; font-size: 12px; }
  #tg .texts tr.dirty textarea { border-color: var(--accent); }
  #tg .texts .cnt { color: var(--dim); font-size: 10px; text-align: right; } #tg .texts .cnt.over { color: var(--err); }
  #tg .dlg { position: fixed; inset: 0; background: #0009; display: flex; align-items: center; justify-content: center; z-index: 90; }
  #tg .dlg .box { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; width: min(560px, 92vw); max-height: 80vh; overflow: auto; display: grid; gap: 10px; }
  #tg .dlg h4 { margin: 0; color: var(--accent); font-size: 15px; }
  #tg .dlg .row { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
  #tg .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: var(--panel2); border: 1px solid var(--accent); padding: 8px 14px; border-radius: 8px; z-index: 95; opacity: 0; transition: opacity .2s; pointer-events: none; max-width: 70vw; }
  #tg .toast.show { opacity: 1; } #tg .toast.err { border-color: var(--err); color: #fbb; }
  #tg .textin { position: absolute; z-index: 3; background: var(--panel); border: 1px solid var(--accent); border-radius: 6px; padding: 6px; display: grid; gap: 4px; width: 220px; }
  #tg .textin input { background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 4px; padding: 3px 5px; font: inherit; }
  `;
  document.head.appendChild(css);
  const root = document.createElement('div'); root.id = 'tg';
  root.innerHTML = `
  <div class="bar">
    <button class="back" id="tg-back" title="Back to the viewer (Esc)">← Back</button>
    <h2>Textures &amp; GUI</h2>
    <button id="tg-tour" title="A guided walkthrough" style="font-size:11px;padding:2px 8px">? Tour</button>
    <div class="modes" id="tg-modes"><button data-m="tex" class="on" title="Paint and edit any texture in the game">🎨 Texture Editor</button><button data-m="gui" title="Menus, icons, button states and icon animations">🖥 GUI Editor</button></div>
    <span class="grow"></span>
    <button id="tg-changes" title="Game files changed by this editor: restore their originals">Changed files: 0</button>
  </div>
  <div class="side left" id="tg-left"></div>
  <div class="centre" id="tg-centre"></div>
  <div class="side right" id="tg-right"></div>
  <div class="toast" id="tg-toast"></div>`;
  document.body.appendChild(root);

  const S = { mode: 'tex', cat: [], edits: {}, gui: null };
  let toastT = 0;
  function toast(msg, err) {
    const t = $('#tg-toast', root); t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), err ? 6000 : 2600);
  }
  function confirmBox(title, html, ok = 'OK') {
    return new Promise(res => {
      const d = document.createElement('div'); d.className = 'dlg';
      d.innerHTML = `<div class="box"><h4>${esc(title)}</h4><div>${html}</div><div class="row"><button data-a="no">Cancel</button><button class="primary" data-a="ok">${esc(ok)}</button></div></div>`;
      d.onclick = e => { const a = e.target.dataset?.a; if (a || e.target === d) { d.remove(); res(a === 'ok'); } };
      root.appendChild(d);
    });
  }
  function setEdits(e) { S.edits = e || {}; $('#tg-changes', root).textContent = 'Changed files: ' + Object.keys(S.edits).length; }

  // ---- panes: each mode builds its own left / centre / right contents, kept while the other mode is shown -----
  const panes = { tex: {}, gui: {} };
  for (const m of ['tex', 'gui']) for (const k of ['left', 'centre', 'right']) {
    const el = document.createElement('div'); el.style.cssText = 'display:none;flex-direction:column;min-height:0;min-width:0;flex:1;position:relative';
    $('#tg-' + k, root).appendChild(el); panes[m][k] = el;
  }
  $('#tg-left', root).style.display = 'flex'; $('#tg-centre', root).style.display = 'flex'; $('#tg-right', root).style.display = 'flex';
  function setMode(m) {
    S.mode = m;
    for (const [k, p] of Object.entries(panes)) for (const el of Object.values(p)) el.style.display = k === m ? 'flex' : 'none';
    root.querySelectorAll('#tg-modes button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
    (m === 'tex' ? tex : gui).shown();
  }
  $('#tg-modes', root).onclick = e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); };
  $('#tg-back', root).onclick = async () => {
    if (tex.dirty() && !await confirmBox('Unsaved changes', 'The picture you are editing has changes that are not saved into the game. Leave anyway? (They stay here until you open another picture.)', 'Leave')) return;
    root.style.display = 'none'; ui.onBack && ui.onBack();
  };
  $('#tg-changes', root).onclick = () => changesDialog();
  async function changesDialog() {
    const ent = Object.entries(S.edits);
    const d = document.createElement('div'); d.className = 'dlg';
    d.innerHTML = `<div class="box"><h4>Game files changed by this editor</h4>
      ${ent.length ? `<div class="note" style="color:var(--dim)">Each file was copied before its first change (into your user folder, .rct3ovl\\backups). Restore puts the original back and undoes every change made to that file.</div>` +
        ent.map(([p, v]) => `<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;border-top:1px solid var(--line);padding-top:8px">
          <div><b>${esc(p)}</b><div style="color:var(--dim);font-size:11px">${esc(v.time || '')} · ${v.changes.length} change${v.changes.length > 1 ? 's' : ''}: ${esc(v.changes.slice(0, 12).map(c => c.split(':')[0]).join(', '))}${v.changes.length > 12 ? '…' : ''}</div></div>
          <button class="warn" data-p="${esc(p)}">Restore original</button></div>`).join('')
        : '<div style="color:var(--dim)">No game files have been changed.</div>'}
      <div class="row"><button data-a="close">Close</button></div></div>`;
    d.onclick = async e => {
      if (e.target.dataset?.a === 'close' || e.target === d) { d.remove(); return; }
      const p = e.target.dataset?.p; if (!p) return;
      if (!await confirmBox('Restore original', `Put the original <b>${esc(p)}</b> back? Every change made to it here is lost.`, 'Restore')) return;
      try { const r = await post('/api/tx/restore', { path: p }); setEdits(r.edits); toast('Restored ' + p); d.remove(); tex.afterRestore(p); gui.afterRestore(p); }
      catch (err) { toast(err.message, true); }
    };
    root.appendChild(d);
  }

  const spaceHeld = (() => { let s = false; addEventListener('keydown', e => { if (e.code === 'Space' && root.style.display !== 'none' && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { s = true; e.preventDefault(); } });
    addEventListener('keyup', e => { if (e.code === 'Space') s = false; }); return () => s; })();

  const tex = texEditor({ root, panes: panes.tex, S, toast, confirmBox, setEdits, spaceHeld });
  const gui = guiEditor({ root, panes: panes.gui, S, toast, confirmBox, setEdits, spaceHeld,
    openTexture: async (path, name, opts) => { setMode('tex'); await tex.open(path, name, opts); } });
  addEventListener('keydown', e => {
    if (root.style.display === 'none' || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || document.querySelector('#tour')) return;
    if (e.key === 'Escape' && S.mode === 'gui' && !root.querySelector('.dlg') && gui.escape()) return;
    if (e.key === 'Escape' && !root.querySelector('.dlg') && !(S.mode === 'tex' && tex.hasSelection())) { $('#tg-back', root).click(); return; }
    (S.mode === 'tex' ? tex : gui).key(e);
  });
  root.addEventListener('paste', e => S.mode === 'tex' && tex.paste(e));
  document.addEventListener('paste', e => root.style.display !== 'none' && S.mode === 'tex' && !/INPUT|TEXTAREA/.test(e.target.tagName) && tex.paste(e));

  const ready = (async () => {
    $('#tx-empty', panes.tex.centre).textContent = 'Reading every texture in the game… (the first time this takes about a minute)';
    const r = await fetch('/api/tx/catalogue').then(r => r.json());
    S.cat = r.textures; setEdits(r.edits);
    tex.init(); setMode('tex');
  })();

  const TOUR = [
    { title: 'Textures & GUI', html: `<p>Every picture in RollerCoaster Tycoon 3, and the interface made from them, editable and saved back into the game.</p><p>Two editors, switched at the top: the <b>Texture Editor</b> and the <b>GUI Editor</b>.</p>` },
    { target: '#tg-modes', title: 'Two editors', html: `<ul><li><b>Texture Editor</b>: any texture (ground, buildings, rides, people, signs, the menus…) to paint on.</li><li><b>GUI Editor</b>: icon sheets with each icon's rectangle, button states, icon animations, window frames, menu screens, fonts and menu texts.</li></ul>`, before: () => setMode('tex') },
    { target: '#tg-left', title: 'Every texture', html: `<p>All the textures of the game. Search by name, or filter by folder and kind (animated, recolourable, interface). A ● marks pictures you have changed.</p>` },
    { target: '#tg-centre', title: 'The canvas', html: `<p>Tools on the left: <kbd>B</kbd> brush, <kbd>P</kbd> pencil, <kbd>E</kbd> eraser, <kbd>G</kbd> fill, <kbd>I</kbd> colour picker, <kbd>L</kbd> line, <kbd>R</kbd> rectangle, <kbd>O</kbd> ellipse, <kbd>M</kbd> select (drag inside to move), <kbd>T</kbd> text.</p><p>Wheel zooms, right-drag or <kbd>Space</kbd>-drag pans, <kbd>0</kbd> fits. <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> undo and redo, <kbd>Ctrl+C</kbd> / <kbd>Ctrl+V</kbd> copy and paste (also pictures from other programs).</p>` },
    { target: '#tg-right', title: 'Colours, adjustments, saving', html: `<p>Colours and brush, then adjustments (brightness, contrast, hue, saturation, invert, flips…) for the selection or the whole picture, frames of animated textures, and the recolour preview of recolourable ones.</p><p><b>Save into game</b> writes the picture into its game file in the same size and format; the original file is copied first and <b>Changed files</b> (top right) restores it.</p>` },
    { target: '#tg-modes', title: 'GUI Editor', html: `<p>The interface: open <b>Game interface</b> for the main icon sheets. <b>In-park screen</b> shows the top bar and the left buttons you see in a park, built from your icons: click a piece to change its picture. Drag an icon's rectangle to move it, its handles to resize it, or edit its pixels. <b>Button states</b> plays them as a real button, <b>Animations</b> plays and edits numbered icon sets (frame order, single frames, a whole strip or GIF), <b>Menu text</b> edits what the menus say.</p>`, before: () => setMode('gui') },
    { target: '#tg-modes', title: 'Front screen designer', html: `<p><b>Main menus › Front screen designer</b> lays out the game's front screen (the Play / Tools / Options menus): drag any button anywhere, remove buttons or add any of the game's menu buttons to any menu, set the badge size and bar colour, change the menu words and the pictures, or apply a whole theme like <b>Neon Nights</b>. The layout is saved into the game's program (RCT3plus.exe), copied first and restorable like every other file.</p>`, before: () => setMode('gui') },
  ];
  function tour(force) { if (root.style.display === 'none' || tourRunning()) return; runTour('texgui', TOUR, { force }); }
  $('#tg-tour', root).onclick = () => tour(true);

  return { root, ready, onBack: null, tour, openTexture: (p, n) => { setMode('tex'); return tex.open(p, n); } };
}

// ================================================================================================================
// Texture Editor
function texEditor({ root, panes, S, toast, confirmBox, setEdits, spaceHeld }) {
  const P = panes;
  P.left.innerHTML = `
    <div class="filters">
      <input type="search" id="tx-q" placeholder="Search ${'textures'} by name">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <select id="tx-kind" title="Kind"><option value="">All kinds</option><option value="tex">Textures (DXT / 32-bit)</option><option value="ftx">256-colour (ftx)</option>
          <option value="recol">Recolourable</option><option value="anim">Animated</option><option value="ui">Interface (menus, icons)</option><option value="mod">Changed by you</option></select>
        <select id="tx-folder" title="Folder"><option value="">All folders</option></select>
      </div>
    </div>
    <div class="count" id="tx-count"></div>
    <div class="scroll" id="tx-list"></div>`;
  P.centre.innerHTML = `
    <div class="ctool"><span class="title" id="tx-title">No picture open</span><small id="tx-meta"></small><span style="flex:1"></span>
      <select id="tx-chan" title="Channels shown"><option value="rgba">Colour + transparency</option><option value="rgb">Colour only</option><option value="a">Transparency only</option></select>
      <button id="tx-icons" title="Outline the icons cut from this picture (icon sheets)">Icons</button>
      <button id="tx-fit" title="Fit (0)">Fit</button><button id="tx-100" title="Actual pixels (1)">1:1</button></div>
    <div class="stage" id="tx-stage"><canvas id="tx-cv"></canvas>
      <div class="tools" id="tx-tools"></div>
      <div class="empty" id="tx-empty">Pick a texture on the left</div>
      <div class="status" id="tx-status"></div></div>`;
  P.right.innerHTML = `<div id="tx-panel"></div>`;
  P.left.style.overflow = 'hidden';

  const TOOLS = [['hand', '✋', 'Move the view (H) - or right-drag / Space-drag anytime'], ['brush', '🖌', 'Brush (B)'], ['pencil', '✏', 'Pencil: hard pixels (P)'], ['eraser', '⌫', 'Eraser: to transparent (E)'],
    ['fill', '🪣', 'Fill (G)'], ['pick', '💧', 'Colour picker (I) - or Alt-click with any tool'], ['line', '╱', 'Line (L) - Shift: 45° steps'],
    ['rect', '▭', 'Rectangle (R) - Shift: square'], ['ellipse', '◯', 'Ellipse (O) - Shift: circle'], ['select', '⬚', 'Select (M): drag a box, drag inside it to move, Ctrl+C / Ctrl+V'], ['text', 'T', 'Text (T)']];
  const KEYS = { h: 'hand', b: 'brush', p: 'pencil', e: 'eraser', g: 'fill', i: 'pick', l: 'line', r: 'rect', o: 'ellipse', m: 'select', t: 'text' };
  $('#tx-tools', P.centre).innerHTML = TOOLS.map(([k, ic, t]) => `<button data-t="${k}" title="${esc(t)}">${ic}</button>`).join('');

  const st = {
    tool: 'brush', col: [242, 169, 59, 255], col2: [0, 0, 0, 255], size: 4, hard: 0.8, opacity: 1, tol: 32, contig: true, fillShapes: false,
    font: 'Arial', fontSize: 16, bold: false, recent: [], chan: 'rgba', showIcons: true,
  };
  let doc = null;               // { path, name, info, frames: [{cv, dirty, loaded}], frame, undo: [], redo: [] }
  let sel = null;               // selection [x0, y0, x1, y1) in pixels
  let float = null;             // pasted / moved pixels not yet put down: { cv, x, y }
  let stroke = null;            // what the current tool is drawing: { cv, kind, ... }
  let adjust = null;            // live adjustment preview { base: ImageData, rect }
  let recolPreview = null;      // image of the recolour preview (read-only view)
  let hoverIcon = null, playing = 0;
  const cv = $('#tx-cv', P.centre);
  const view = new View(cv, (ctx, v) => drawDoc(ctx, v));
  panner(view, cv, () => spaceHeld() || st.tool === 'hand');
  const cur = () => doc?.frames[doc.frame];
  const work = () => cur()?.cv;

  // ---- list ------------------------------------------------------------------------------------------------
  const isUI = t => /^(main\.common|gui\\)/i.test(t.p);
  function fillFolders() {
    const fs = [...new Set(S.cat.map(t => folderOf(t.p)))].sort();
    $('#tx-folder', P.left).innerHTML = '<option value="">All folders</option>' + fs.map(f => `<option>${esc(f)}</option>`).join('');
  }
  let shown = [];
  function renderList() {
    const q = $('#tx-q', P.left).value.trim().toLowerCase(), kind = $('#tx-kind', P.left).value, folder = $('#tx-folder', P.left).value;
    shown = S.cat.filter(t => (!q || t.n.toLowerCase().includes(q) || t.p.toLowerCase().includes(q)) && (!folder || folderOf(t.p) === folder) &&
      (!kind || (kind === 'tex' ? t.t === 'tex' : kind === 'ftx' ? t.t === 'ftx' : kind === 'recol' ? !!t.r : kind === 'anim' ? t.t === 'ftx' && t.f > 1 :
        kind === 'ui' ? isUI(t) : kind === 'mod' ? !!S.edits[t.p] : true)));
    shown.sort((a, b) => a.n.localeCompare(b.n, undefined, { sensitivity: 'base' }) || a.p.localeCompare(b.p));
    $('#tx-count', P.left).textContent = `${shown.length.toLocaleString()} of ${S.cat.length.toLocaleString()} textures`;
    const list = $('#tx-list', P.left);
    list.innerHTML = '';
    list.scrollTop = 0;
    renderMore();
  }
  // rows are added as the list scrolls (2,000+ rows with pictures at once is slow to build)
  function renderMore() {
    const list = $('#tx-list', P.left), have = list.children.length;
    if (have >= shown.length) return;
    const frag = document.createDocumentFragment();
    for (const t of shown.slice(have, have + 150)) {
      const d = document.createElement('div'); d.className = 'it' + (doc && doc.path === t.p && doc.name === t.n + ':' + t.t ? ' sel' : '');
      d.dataset.p = t.p; d.dataset.n = t.n + ':' + t.t;
      const kind = t.t === 'ftx' ? (t.f > 1 ? `${t.f} frames` : '256 colours') + (t.r ? ' · recolourable' : '') : t.f;
      d.innerHTML = `<img loading="lazy" alt="" data-src="${esc(imgUrl(t.p, t.n + ':' + t.t))}"><div class="n">${S.edits[t.p] ? '<span class="mod" title="This file was changed">● </span>' : ''}${esc(t.n)}<small>${t.w}×${t.h} · ${esc(kind)} · ${esc(t.p.replace(/\.common\.ovl$/i, ''))}</small></div>`;
      frag.appendChild(d);
    }
    list.appendChild(frag);
    list.querySelectorAll('img[data-src]').forEach(i => thumbs.observe(i));
  }
  const thumbs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { const i = e.target; i.src = i.dataset.src; i.removeAttribute('data-src'); thumbs.unobserve(i); } }),
    { root: null, rootMargin: '200px' });
  $('#tx-list', P.left).addEventListener('scroll', e => { const l = e.target; if (l.scrollTop + l.clientHeight > l.scrollHeight - 400) renderMore(); });
  $('#tx-list', P.left).onclick = e => { const d = e.target.closest('.it'); if (d) open(d.dataset.p, d.dataset.n); };
  for (const id of ['tx-q', 'tx-kind', 'tx-folder']) $('#' + id, P.left).addEventListener('input', renderList);

  // ---- opening and saving ------------------------------------------------------------------------------------
  const dirty = () => !!doc && doc.frames.some(f => f.dirty);
  async function loadFrame(i) {
    const f = doc.frames[i];
    const img = await loadImage(imgUrl(doc.path, doc.name, i) + '&t=' + Date.now());
    f.cv = canvasOf(doc.info.w, doc.info.h); f.cv.getContext('2d').drawImage(img, 0, 0); f.loaded = true; f.dirty = false;
  }
  async function open(path, name, opts = {}) {
    if (doc && !(doc.path === path && doc.name === name) && dirty() &&
        !await confirmBox('Unsaved changes', `<b>${esc(doc.name.split(':')[0])}</b> has changes that are not saved into the game. Open another picture and lose them?`, 'Discard changes')) return;
    stopPlay(); commitFloat(); sel = null; adjust = null; recolPreview = null;
    $('#tx-empty', P.centre).textContent = 'Loading…'; $('#tx-empty', P.centre).style.display = '';
    try {
      const info = await fetch(`/api/tx/info?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`).then(r => r.json());
      if (info.error) throw new Error(info.error);
      doc = { path: info.path, name: info.name, info, frames: Array.from({ length: info.frames }, () => ({ cv: null, dirty: false, loaded: false })), frame: 0, undo: [], redo: [] };
      await loadFrame(0);
      $('#tx-empty', P.centre).style.display = 'none';
      view.setSize(info.w, info.h); view.fit();
      if (opts.rect) { sel = [...opts.rect]; view.zoomTo(opts.rect, 0.5, 16); setTool('select'); }
      if (opts.importFile) setTimeout(() => importPng(opts.importFile), 0);
      $('#tx-title', P.centre).textContent = info.name.split(':')[0];
      $('#tx-meta', P.centre).textContent = `${info.w}×${info.h} · ${info.format}${info.frames > 1 ? ` · ${info.frames} frames` : ''}${info.mips > 1 ? ` · ${info.mips} mipmaps` : ''} · ${info.path.replace(/\.common\.ovl$/i, '')}`;
      $('#tx-icons', P.centre).style.display = info.icons?.length ? '' : 'none';
      $('#tx-list', P.left).querySelectorAll('.it').forEach(d => d.classList.toggle('sel', d.dataset.p === doc.path && d.dataset.n === doc.name));
      renderPanel(); view.redraw();
      history.replaceState(null, '', '#textures=' + encodeURIComponent(doc.path + '|' + doc.name));
    } catch (e) { $('#tx-empty', P.centre).textContent = 'Could not open: ' + e.message; doc = null; renderPanel(); }
  }
  async function save() {
    if (!doc || !doc.info.editable) return;
    commitFloat(); applyAdjust();
    const todo = doc.frames.map((f, i) => [f, i]).filter(([f]) => f.dirty);
    if (!todo.length) { toast('Nothing changed yet'); return; }
    const first = !S.edits[doc.path];
    if (first && !await confirmBox('Save into the game', `This writes <b>${esc(doc.name.split(':')[0])}</b> into <b>${esc(doc.path)}</b> in the game folder (${doc.info.w}×${doc.info.h}, ${esc(doc.info.format)}${doc.info.format.startsWith('DXT') ? ', compressed: colours may shift very slightly' : doc.info.tag === 'ftx' ? (doc.info.recolour ? ', matched to its recolour palette' : ', reduced to 256 colours') : ''}).<br><br>The original file is copied first; <b>Changed files</b> at the top right puts it back. Close the game before saving.`, 'Save into game')) return;
    const btn = $('#tx-save', P.right); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      for (const [f, i] of todo) {
        const blob = await new Promise(r => f.cv.toBlob(r, 'image/png'));
        await post('/api/tx/write', { path: doc.path, name: doc.name, frame: i, b64: await blobB64(blob) });
        await loadFrame(i);          // what the game now has (compression / palette applied)
      }
      const r = await fetch('/api/tx/catalogue').then(r => r.json()); setEdits(r.edits);
      toast(`Saved ${doc.name.split(':')[0]} into ${doc.path}`);
      doc.info.modified = true; renderPanel(); view.redraw(); markRows();
    } catch (e) { toast('Could not save: ' + e.message, true); }
    if (btn) { btn.disabled = false; btn.textContent = 'Save into game'; }
  }
  function markRows() {
    $('#tx-list', P.left).querySelectorAll('.it').forEach(d => {
      const n = d.querySelector('.n'), has = n.querySelector('.mod');
      if (S.edits[d.dataset.p] && !has) n.insertAdjacentHTML('afterbegin', '<span class="mod" title="This file was changed">● </span>');
      if (!S.edits[d.dataset.p] && has) has.remove();
    });
  }
  async function revert() {
    if (!doc) return;
    if (dirty() && !await confirmBox('Revert', 'Throw away the changes not saved yet and reload the picture from the game?', 'Revert')) return;
    for (let i = 0; i < doc.frames.length; i++) if (doc.frames[i].loaded) await loadFrame(i);
    doc.undo = []; doc.redo = []; sel = null; float = null; adjust = null; view.redraw(); renderPanel();
  }
  async function restoreFile() {
    if (!doc) return;
    if (!await confirmBox('Restore original', `Put the original <b>${esc(doc.path)}</b> back? This undoes every change saved into that file (all of its pictures, icons and texts).`, 'Restore')) return;
    try { const r = await post('/api/tx/restore', { path: doc.path }); setEdits(r.edits); toast('Restored ' + doc.path); await afterRestore(doc.path); }
    catch (e) { toast(e.message, true); }
  }
  async function afterRestore(path) {
    markRows();
    if (doc && doc.path === path) {
      for (let i = 0; i < doc.frames.length; i++) if (doc.frames[i].loaded) await loadFrame(i);
      doc.info.modified = false; doc.undo = []; doc.redo = []; renderPanel(); view.redraw();
    }
  }

  // ---- undo ----------------------------------------------------------------------------------------------------
  function snapshot() {
    if (!doc) return;
    doc.undo.push({ frame: doc.frame, data: work().getContext('2d').getImageData(0, 0, doc.info.w, doc.info.h) });
    if (doc.undo.length > 50) doc.undo.shift();
    doc.redo = [];
  }
  function changed() { cur().dirty = true; view.redraw(); updateSaveState(); }
  function undoRedo(from, to) {
    commitFloat();
    const s = from.pop(); if (!s) return;
    const f = doc.frames[s.frame], g = f.cv.getContext('2d');
    to.push({ frame: s.frame, data: g.getImageData(0, 0, doc.info.w, doc.info.h) });
    g.putImageData(s.data, 0, 0); f.dirty = true;
    if (doc.frame !== s.frame) setFrame(s.frame); else { view.redraw(); updateSaveState(); }
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------
  const chanCache = { key: '', cv: null };
  function shownCanvas() {
    let c = work();
    if (recolPreview) return recolPreview;
    if (adjust?.preview) c = adjust.preview;
    if (stroke || float) {             // the stroke / floating pixels on top, as they will be put down
      const t = composite || (composite = canvasOf(doc.info.w, doc.info.h)), g = t.getContext('2d');
      if (t.width !== doc.info.w || t.height !== doc.info.h) { t.width = doc.info.w; t.height = doc.info.h; }
      g.globalCompositeOperation = 'copy'; g.globalAlpha = 1; g.drawImage(c, 0, 0); g.globalCompositeOperation = 'source-over';
      if (stroke) putStroke(g);
      if (float) { if (float.replace) g.clearRect(float.x, float.y, float.cv.width, float.cv.height); g.drawImage(float.cv, float.x, float.y); }
      c = t;
    }
    if (st.chan === 'rgba') return c;
    const w = doc.info.w, h = doc.info.h, d = c.getContext('2d').getImageData(0, 0, w, h), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      if (st.chan === 'a') { p[i] = p[i + 1] = p[i + 2] = p[i + 3]; }
      p[i + 3] = 255;
    }
    const o = chanCache.cv && chanCache.cv.width === w && chanCache.cv.height === h ? chanCache.cv : (chanCache.cv = canvasOf(w, h));
    o.getContext('2d').putImageData(d, 0, 0); return o;
  }
  let composite = null;
  function drawDoc(ctx, v) {
    if (!doc || !work()) return;
    ctx.drawImage(shownCanvas(), v.ox, v.oy, doc.info.w * v.z, doc.info.h * v.z);
    if (st.showIcons && doc.info.icons?.length && !recolPreview) {
      ctx.lineWidth = 1;
      for (const g of doc.info.icons) {
        if (!g.rect) continue;
        const [l, t, r, b] = g.rect, on = hoverIcon === g;
        ctx.strokeStyle = on ? '#f2a93b' : 'rgba(120,200,255,.55)';
        ctx.strokeRect(Math.round(v.sx(l)) + .5, Math.round(v.sy(t)) + .5, Math.round((r - l) * v.z) - 1, Math.round((b - t) * v.z) - 1);
      }
      if (hoverIcon) {
        const [l, t] = hoverIcon.rect; ctx.font = '12px system-ui'; const s = spaced(hoverIcon.name), w = ctx.measureText(s).width + 10;
        ctx.fillStyle = '#000c'; ctx.fillRect(v.sx(l), v.sy(t) - 18, w, 17); ctx.fillStyle = '#f2a93b'; ctx.fillText(s, v.sx(l) + 5, v.sy(t) - 5);
      }
    }
    const s = float ? [float.x, float.y, float.x + float.cv.width, float.y + float.cv.height] : sel;
    if (s) {
      const x = Math.round(v.sx(s[0])) + .5, y = Math.round(v.sy(s[1])) + .5, w = Math.round((s[2] - s[0]) * v.z) - 1, h = Math.round((s[3] - s[1]) * v.z) - 1;
      ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.strokeStyle = '#000'; ctx.strokeRect(x, y, w, h);
      ctx.lineDashOffset = 5; ctx.strokeStyle = '#fff'; ctx.strokeRect(x, y, w, h); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }
    if (cursorAt && ['brush', 'eraser', 'pencil'].includes(st.tool) && !spaceHeld()) {
      ctx.strokeStyle = '#fff8'; ctx.lineWidth = 1; ctx.beginPath();
      if (st.tool === 'pencil') { const s2 = st.size, x0 = Math.floor(cursorAt[0] - (s2 - 1) / 2), y0 = Math.floor(cursorAt[1] - (s2 - 1) / 2); ctx.rect(v.sx(x0), v.sy(y0), s2 * v.z, s2 * v.z); }
      else ctx.arc(v.sx(cursorAt[0]), v.sy(cursorAt[1]), Math.max(1, st.size / 2 * v.z), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const rgbaStr = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255) * a})`;
  // the stroke canvas holds the mark at full strength; it is put down with the tool's opacity (no build-up where a
  // stroke crosses itself), the eraser cuts it out of the picture
  function putStroke(g) {
    g.save();
    if (sel) { g.beginPath(); g.rect(sel[0], sel[1], sel[2] - sel[0], sel[3] - sel[1]); g.clip(); }
    g.globalAlpha = stroke.kind === 'text' ? 1 : st.opacity;
    g.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
    g.drawImage(stroke.cv, 0, 0);
    g.restore();
  }
  function stamp(g, x, y) {
    const r = st.size / 2;
    if (st.hard >= 0.99 || r < 1.2) { g.beginPath(); g.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2); g.fill(); return; }
    const gr = g.createRadialGradient(x, y, 0, x, y, r), c = stroke.erase ? [0, 0, 0, 255] : st.col;
    gr.addColorStop(0, rgbaStr(c)); gr.addColorStop(st.hard, rgbaStr(c)); gr.addColorStop(1, rgbaStr(c, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  function pencilAt(g, x, y) {
    const s = st.size, x0 = Math.floor(x - (s - 1) / 2), y0 = Math.floor(y - (s - 1) / 2);
    g.fillRect(x0, y0, s, s);
  }
  function lineTo(x, y) {
    const g = stroke.cv.getContext('2d'), [px, py] = stroke.last;
    const d = Math.hypot(x - px, y - py), stepLen = st.tool === 'pencil' ? 0.5 : Math.max(0.5, st.size * 0.15), n = Math.max(1, Math.ceil(d / stepLen));
    for (let i = 1; i <= n; i++) {
      const xi = px + (x - px) * i / n, yi = py + (y - py) * i / n;
      if (st.tool === 'pencil') pencilAt(g, xi, yi); else stamp(g, xi, yi);
    }
    stroke.last = [x, y];
  }
  function shape(x0, y0, x1, y1, shift) {
    const g = stroke.cv.getContext('2d');
    g.clearRect(0, 0, stroke.cv.width, stroke.cv.height);
    g.strokeStyle = g.fillStyle = rgbaStr(st.col); g.lineWidth = Math.max(1, st.size); g.lineCap = 'round';
    if (st.tool === 'line') {
      if (shift) { const a = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * Math.PI / 4, d = Math.hypot(x1 - x0, y1 - y0); x1 = x0 + Math.cos(a) * d; y1 = y0 + Math.sin(a) * d; }
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); return;
    }
    if (shift) { const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * s; y1 = y0 + Math.sign(y1 - y0 || 1) * s; }
    const l = Math.min(x0, x1), t = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    g.beginPath();
    if (st.tool === 'rect') g.rect(l, t, w, h); else g.ellipse(l + w / 2, t + h / 2, Math.max(0.5, w / 2), Math.max(0.5, h / 2), 0, 0, Math.PI * 2);
    if (st.fillShapes) g.fill(); else g.stroke();
  }
  function commitStroke() {
    if (!stroke) return;
    snapshot(); putStroke(work().getContext('2d')); stroke = null; changed();
  }
  function pickAt(x, y) {
    if (!doc) return;
    const p = shownCanvas().getContext('2d').getImageData(clamp(Math.floor(x), 0, doc.info.w - 1), clamp(Math.floor(y), 0, doc.info.h - 1), 1, 1).data;
    setColour([p[0], p[1], p[2], p[3]]);
  }
  function floodFill(x, y) {
    const w = doc.info.w, h = doc.info.h; x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    snapshot();
    const g = work().getContext('2d'), d = g.getImageData(0, 0, w, h), p = d.data, i0 = (y * w + x) * 4;
    const t = [p[i0], p[i0 + 1], p[i0 + 2], p[i0 + 3]], tol = st.tol, c = st.col, a = st.opacity;
    const s = sel || [0, 0, w, h];
    const like = i => Math.abs(p[i] - t[0]) <= tol && Math.abs(p[i + 1] - t[1]) <= tol && Math.abs(p[i + 2] - t[2]) <= tol && Math.abs(p[i + 3] - t[3]) <= tol;
    const seen = new Uint8Array(w * h);
    const paint = i => { for (let k = 0; k < 4; k++) p[i + k] = Math.round(p[i + k] * (1 - a) + c[k] * a); };
    if (!st.contig) {
      const todo = [];
      for (let yy = s[1]; yy < s[3]; yy++) for (let xx = s[0]; xx < s[2]; xx++) { const i = (yy * w + xx) * 4; if (like(i)) todo.push(i); }
      todo.forEach(paint);
    } else {
      const stack = [[x, y]], todo = [];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        if (cx < s[0] || cy < s[1] || cx >= s[2] || cy >= s[3]) continue;
        const j = cy * w + cx; if (seen[j]) continue; seen[j] = 1;
        if (!like(j * 4)) continue;
        todo.push(j * 4); stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
      todo.forEach(paint);
    }
    g.putImageData(d, 0, 0); changed();
  }
  // floating pixels (pasted, or lifted by dragging a selection) are put down when you click outside or change tool
  function liftSelection() {
    if (!sel || float) return;
    snapshot();
    const [x0, y0, x1, y1] = sel, c = canvasOf(x1 - x0, y1 - y0);
    c.getContext('2d').drawImage(work(), x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
    work().getContext('2d').clearRect(x0, y0, x1 - x0, y1 - y0);
    float = { cv: c, x: x0, y: y0, lifted: true };
  }
  function commitFloat() {
    if (!float || !doc) return;
    if (!float.lifted) snapshot();
    if (float.replace) work().getContext('2d').clearRect(float.x, float.y, float.cv.width, float.cv.height);   // an imported picture takes the place's transparency too
    work().getContext('2d').drawImage(float.cv, float.x, float.y);
    sel = [float.x, float.y, float.x + float.cv.width, float.y + float.cv.height].map(Math.round);
    float = null; changed();
  }
  function pasteCanvas(c, replace = false) {
    if (!doc) return;
    commitFloat();
    let x = 0, y = 0;
    if (sel) { x = sel[0]; y = sel[1]; } else { x = Math.round((doc.info.w - c.width) / 2); y = Math.round((doc.info.h - c.height) / 2); }
    float = { cv: c, x, y, lifted: false, replace }; setTool('select'); view.redraw();
  }
  let clip = null;
  function copySel(cut) {
    if (!doc) return;
    const s = float ? null : (sel || [0, 0, doc.info.w, doc.info.h]);
    const c = float ? float.cv : canvasOf(s[2] - s[0], s[3] - s[1]);
    if (!float) c.getContext('2d').drawImage(work(), s[0], s[1], c.width, c.height, 0, 0, c.width, c.height);
    clip = c;
    try { c.toBlob(b => navigator.clipboard?.write?.([new ClipboardItem({ 'image/png': b })]).catch(() => {}), 'image/png'); } catch (e) {}
    if (cut) { if (float) { float = null; changed(); } else { snapshot(); work().getContext('2d').clearRect(s[0], s[1], c.width, c.height); changed(); } }
    toast(cut ? 'Cut' : 'Copied');
  }
  async function paste(e) {
    if (!doc) return;
    const item = [...(e?.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      const img = await loadImage(URL.createObjectURL(item.getAsFile()));
      const c = canvasOf(img.width, img.height); c.getContext('2d').drawImage(img, 0, 0); pasteCanvas(c); return;
    }
    if (clip) { e?.preventDefault?.(); const c = canvasOf(clip.width, clip.height); c.getContext('2d').drawImage(clip, 0, 0); pasteCanvas(c); }
  }
  function delSel() {
    if (float) { float = null; if (doc) changed(); return; }
    if (!sel || !doc) return;
    snapshot(); work().getContext('2d').clearRect(sel[0], sel[1], sel[2] - sel[0], sel[3] - sel[1]); changed();
  }

  // ---- pointer -------------------------------------------------------------------------------------------------
  let cursorAt = null, drag = null;
  cv.addEventListener('pointermove', e => {
    if (!doc) return;
    const [x, y] = view.toImage(e); cursorAt = [x, y];
    const px = Math.floor(x), py = Math.floor(y);
    let tip = '';
    if (px >= 0 && py >= 0 && px < doc.info.w && py < doc.info.h && work()) {
      const p = shownCanvas().getContext('2d').getImageData(px, py, 1, 1).data;
      tip = `x ${px}  y ${py}   rgba(${p[0]}, ${p[1]}, ${p[2]}, ${p[3]})  ${rgba2hex([...p])}`;
    }
    const was = hoverIcon;
    hoverIcon = st.showIcons && doc.info.icons ? doc.info.icons.find(g => g.rect && px >= g.rect[0] && px < g.rect[2] && py >= g.rect[1] && py < g.rect[3]) || null : null;
    $('#tx-status', P.centre).textContent = `${tip}${hoverIcon ? '   icon: ' + hoverIcon.name : ''}   zoom ${Math.round(view.z * 100)}%${sel ? `   selection ${sel[2] - sel[0]}×${sel[3] - sel[1]}` : ''}`;
    if (!drag) {
      cv.style.cursor = st.tool === 'hand' ? 'grab' : st.tool === 'select' && (float ? inRect(x, y, [float.x, float.y, float.x + float.cv.width, float.y + float.cv.height]) : sel && inRect(x, y, sel)) ? 'move' : 'crosshair';
      if (['brush', 'eraser', 'pencil'].includes(st.tool) || was !== hoverIcon) view.redraw();
      return;
    }
    if (drag.kind === 'paint') { lineTo(x, y); view.redraw(); }
    else if (drag.kind === 'shape') { shape(drag.x0, drag.y0, x, y, e.shiftKey); view.redraw(); }
    else if (drag.kind === 'marquee') {
      const x0 = clamp(Math.floor(Math.min(drag.x0, x)), 0, doc.info.w), y0 = clamp(Math.floor(Math.min(drag.y0, y)), 0, doc.info.h);
      const x1 = clamp(Math.ceil(Math.max(drag.x0, x)), 0, doc.info.w), y1 = clamp(Math.ceil(Math.max(drag.y0, y)), 0, doc.info.h);
      sel = x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null; view.redraw();
    } else if (drag.kind === 'move') { float.x = Math.round(drag.fx + x - drag.x0); float.y = Math.round(drag.fy + y - drag.y0); view.redraw(); }
  });
  cv.addEventListener('pointerleave', () => { cursorAt = null; hoverIcon = null; view.redraw(); });
  const inRect = (x, y, r) => x >= r[0] && y >= r[1] && x < r[2] && y < r[3];
  cv.addEventListener('pointerdown', e => {
    if (!doc || e.button !== 0 || !work() || recolPreview) return;
    if (!doc.info.editable && st.tool !== 'pick' && st.tool !== 'hand') { toast('This picture can not be written back into the game', true); }
    const [x, y] = view.toImage(e);
    if (e.altKey || st.tool === 'pick') { pickAt(x, y); return; }
    if (adjust) applyAdjust();
    cv.setPointerCapture(e.pointerId);
    if (st.tool === 'select') {
      if (float && inRect(x, y, [float.x, float.y, float.x + float.cv.width, float.y + float.cv.height])) { drag = { kind: 'move', x0: x, y0: y, fx: float.x, fy: float.y }; return; }
      if (!float && sel && inRect(x, y, sel)) { liftSelection(); drag = { kind: 'move', x0: x, y0: y, fx: float.x, fy: float.y }; return; }
      commitFloat(); sel = null; drag = { kind: 'marquee', x0: x, y0: y }; view.redraw(); return;
    }
    commitFloat();
    if (st.tool === 'fill') { floodFill(x, y); return; }
    if (st.tool === 'text') { e.preventDefault(); textAt(x, y, e); return; }   // (no default: the click would take the focus off the text box)
    if (st.tool === 'hand') return;
    stroke = { cv: canvasOf(doc.info.w, doc.info.h), erase: st.tool === 'eraser', last: [x, y] };
    const g = stroke.cv.getContext('2d'); g.fillStyle = rgbaStr(st.col); g.imageSmoothingEnabled = false;
    if (stroke.erase) g.fillStyle = '#000';
    if (['brush', 'eraser', 'pencil'].includes(st.tool)) { drag = { kind: 'paint' }; if (st.tool === 'pencil') pencilAt(g, x, y); else stamp(g, x, y); }
    else { drag = { kind: 'shape', x0: x, y0: y }; shape(x, y, x, y, e.shiftKey); }
    view.redraw();
  });
  addEventListener('pointerup', () => {
    if (!drag) return;
    const k = drag.kind; drag = null;
    if (k === 'paint' || k === 'shape') { commitStroke(); remember(st.col); }
    view.redraw();
  });
  function textAt(x, y, e) {
    root.querySelector('.textin')?.remove();
    const box = document.createElement('div'); box.className = 'textin';
    const r = $('#tx-stage', P.centre).getBoundingClientRect();
    box.style.left = Math.min(e.clientX - r.left, r.width - 230) + 'px'; box.style.top = Math.min(e.clientY - r.top + 8, r.height - 90) + 'px';
    box.innerHTML = `<input type="text" placeholder="Type, then Enter" id="tx-tin"><div style="color:var(--dim);font-size:11px">Font, size and bold in the panel on the right · Esc cancels</div>`;
    $('#tx-stage', P.centre).appendChild(box);
    const inp = $('#tx-tin', box); inp.focus(); setTimeout(() => inp.focus(), 0);
    const draw = () => {
      stroke = { cv: canvasOf(doc.info.w, doc.info.h), kind: 'text' };
      const g = stroke.cv.getContext('2d'); g.fillStyle = rgbaStr(st.col); g.font = `${st.bold ? 'bold ' : ''}${st.fontSize}px ${st.font}`; g.textBaseline = 'top';
      g.fillText(inp.value, Math.round(x), Math.round(y)); view.redraw();
    };
    inp.oninput = draw; draw();
    inp.onkeydown = ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { box.remove(); if (inp.value) { commitStroke(); remember(st.col); } else { stroke = null; view.redraw(); } }
      if (ev.key === 'Escape') { box.remove(); stroke = null; view.redraw(); }
    };
  }

  // ---- adjustments: preview while the sliders move, applied with Apply (or by drawing on) ----------------------
  function adjustRect() { return sel || [0, 0, doc.info.w, doc.info.h]; }
  function previewAdjust() {
    if (!doc) return;
    const v = id => +$('#' + id, P.right).value;
    const B = v('ad-b'), C = v('ad-c'), H = v('ad-h'), Sa = v('ad-s');
    if (!B && !C && !H && !Sa) { adjust = null; view.redraw(); return; }
    if (!adjust) adjust = { base: work().getContext('2d').getImageData(0, 0, doc.info.w, doc.info.h), preview: canvasOf(doc.info.w, doc.info.h) };
    const d = new ImageData(new Uint8ClampedArray(adjust.base.data), doc.info.w, doc.info.h), p = d.data, w = doc.info.w;
    const [x0, y0, x1, y1] = adjustRect(), cf = (259 * (C + 255)) / (255 * (259 - C));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      let r = p[i], g = p[i + 1], b = p[i + 2];
      if (H || Sa) { let [h, s, l] = rgb2hsl(r, g, b); h += H / 360; s = clamp(s * (1 + Sa / 100), 0, 1); [r, g, b] = hsl2rgb(h, s, l); }
      r = cf * (r + B - 128) + 128; g = cf * (g + B - 128) + 128; b = cf * (b + B - 128) + 128;
      p[i] = r; p[i + 1] = g; p[i + 2] = b;
    }
    adjust.preview.getContext('2d').putImageData(d, 0, 0); view.redraw();
  }
  function applyAdjust() {
    if (!adjust) return;
    const g = work().getContext('2d');
    doc.undo.push({ frame: doc.frame, data: adjust.base }); doc.redo = [];
    g.globalCompositeOperation = 'copy'; g.drawImage(adjust.preview, 0, 0); g.globalCompositeOperation = 'source-over';
    adjust = null; resetSliders(); changed();
  }
  function resetSliders() { for (const id of ['ad-b', 'ad-c', 'ad-h', 'ad-s']) { const el = $('#' + id, P.right); if (el) { el.value = 0; el.nextElementSibling.value = 0; } } }
  function pixelOp(fn) {           // per pixel on the selection (or all): fn(p, i)
    if (!doc) return; commitFloat(); applyAdjust(); snapshot();
    const g = work().getContext('2d'), w = doc.info.w, d = g.getImageData(0, 0, w, doc.info.h), p = d.data, [x0, y0, x1, y1] = adjustRect();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) fn(p, (y * w + x) * 4);
    g.putImageData(d, 0, 0); changed();
  }
  function transformOp(kind) {
    if (!doc) return; commitFloat(); applyAdjust();
    const [x0, y0, x1, y1] = adjustRect(), w = x1 - x0, h = y1 - y0;
    if (kind === 'rot90' && w !== h) { toast('Turning by 90° needs a square selection or picture', true); return; }
    snapshot();
    const g = work().getContext('2d'), c = canvasOf(w, h); c.getContext('2d').drawImage(work(), x0, y0, w, h, 0, 0, w, h);
    g.save(); g.clearRect(x0, y0, w, h); g.translate(x0 + w / 2, y0 + h / 2);
    if (kind === 'fliph') g.scale(-1, 1); else if (kind === 'flipv') g.scale(1, -1); else if (kind === 'rot180') g.rotate(Math.PI); else if (kind === 'rot90') g.rotate(Math.PI / 2);
    g.drawImage(c, -w / 2, -h / 2); g.restore(); changed();
  }
  async function importPng(file) {
    if (!doc) return;
    const img = await loadImage(URL.createObjectURL(file));
    if (img.width === doc.info.w && img.height === doc.info.h && !sel) {
      snapshot(); const g = work().getContext('2d'); g.clearRect(0, 0, img.width, img.height); g.drawImage(img, 0, 0); changed(); toast('Imported ' + file.name);
    } else if (sel) {          // into the selection, scaled to it
      const c = canvasOf(sel[2] - sel[0], sel[3] - sel[1]), g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height); pasteCanvas(c, true);
      toast(`Imported ${file.name} into the selection (move it, then click outside)`);
    } else {
      snapshot(); const g = work().getContext('2d'); g.imageSmoothingQuality = 'high'; g.clearRect(0, 0, doc.info.w, doc.info.h); g.drawImage(img, 0, 0, doc.info.w, doc.info.h); changed();
      toast(`Imported ${file.name}, scaled from ${img.width}×${img.height} to ${doc.info.w}×${doc.info.h} (the game's size for this picture)`);
    }
  }
  function exportPng() {
    if (!doc) return;
    commitFloat();
    work().toBlob(b => download(b, doc.name.split(':')[0] + (doc.info.frames > 1 ? '_frame' + (doc.frame + 1) : '') + '.png'), 'image/png');
  }

  // ---- frames of animated textures -------------------------------------------------------------------------------
  async function setFrame(i) {
    if (!doc) return;
    commitFloat(); applyAdjust();
    doc.frame = i;
    if (!doc.frames[i].loaded) await loadFrame(i);
    $('#tx-panel', P.right).querySelectorAll('.frames button[data-f]').forEach(b => b.classList.toggle('on', +b.dataset.f === i));
    view.redraw(); updateSaveState();
  }
  function stopPlay() { if (playing) { clearInterval(playing); playing = 0; const b = $('#tx-play', P.right); if (b) b.textContent = '▶ Play'; } }
  async function togglePlay() {
    if (playing) { stopPlay(); return; }
    for (let i = 0; i < doc.frames.length; i++) if (!doc.frames[i].loaded) await loadFrame(i);
    const fps = doc.info.fps || 8;
    playing = setInterval(() => setFrame((doc.frame + 1) % doc.frames.length), 1000 / fps);
    $('#tx-play', P.right).textContent = '■ Stop';
  }

  // ---- colours -----------------------------------------------------------------------------------------------------
  function setColour(c) { st.col = c; const a = $('#tx-col', P.right), al = $('#tx-alpha', P.right); if (a) { a.value = rgba2hex(c); al.value = c[3]; al.nextElementSibling.value = c[3]; } }
  function remember(c) {
    const k = c.join(','); st.recent = [[...c], ...st.recent.filter(x => x.join(',') !== k)].slice(0, 16);
    renderRecent();
  }
  function renderRecent() {
    const r = $('#tx-recent', P.right); if (r) r.innerHTML = st.recent.map(x => `<i style="background:${rgbaStr(x)}" data-c="${x.join(',')}" title="${rgba2hex(x)}"></i>`).join('');
  }
  function setTool(t) {
    if (t !== 'select' && float) commitFloat();
    st.tool = t; root.querySelectorAll('#tx-tools button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    renderToolOpts(); view.redraw();
  }
  $('#tx-tools', P.centre).onclick = e => { const b = e.target.closest('button'); if (b) setTool(b.dataset.t); };
  $('#tx-fit', P.centre).onclick = () => view.fit();
  $('#tx-100', P.centre).onclick = () => { const r = cv.getBoundingClientRect(); view.zoomAt(1, r.width / 2, r.height / 2); };
  $('#tx-chan', P.centre).onchange = e => { st.chan = e.target.value; view.redraw(); };
  $('#tx-icons', P.centre).onclick = e => { st.showIcons = !st.showIcons; e.target.classList.toggle('on', st.showIcons); view.redraw(); };
  $('#tx-icons', P.centre).classList.add('on');

  // ---- right panel -------------------------------------------------------------------------------------------------
  function updateSaveState() {
    const b = $('#tx-save', P.right); if (!b || !doc) return;
    const n = doc.frames.filter(f => f.dirty).length;
    b.disabled = !doc.info.editable || !n;
    $('#tx-dirty', P.right).textContent = n ? `${n === 1 && doc.frames.length === 1 ? 'Changed' : n + ' frame' + (n > 1 ? 's' : '') + ' changed'} - not saved into the game yet` : (doc.info.modified ? 'Saved changes in the game file' : 'As in the game');
  }
  function renderToolOpts() {
    const el = $('#tx-topts', P.right); if (!el) return;
    const t = st.tool, rows = [];
    const row = (id, label, min, max, step, val) => `<label class="row">${label}<input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><output>${val}</output></label>`;
    if (['brush', 'eraser', 'pencil', 'line', 'rect', 'ellipse'].includes(t)) rows.push(row('to-size', t === 'line' || t === 'rect' || t === 'ellipse' ? 'Line width' : 'Size', 1, 128, 1, st.size));
    if (['brush', 'eraser'].includes(t)) rows.push(row('to-hard', 'Hardness', 0, 1, 0.05, st.hard));
    if (['brush', 'eraser', 'pencil', 'line', 'rect', 'ellipse', 'fill'].includes(t)) rows.push(row('to-op', 'Opacity', 0.05, 1, 0.05, st.opacity));
    if (t === 'fill') rows.push(row('to-tol', 'Tolerance', 0, 255, 1, st.tol), `<label style="color:var(--dim)"><input type="checkbox" id="to-contig" ${st.contig ? 'checked' : ''}> Only touching pixels</label>`);
    if (t === 'rect' || t === 'ellipse') rows.push(`<label style="color:var(--dim)"><input type="checkbox" id="to-fillsh" ${st.fillShapes ? 'checked' : ''}> Filled</label>`);
    if (t === 'text') rows.push(`<label class="row">Font<select id="to-font">${['Arial', 'Verdana', 'Tahoma', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Comic Sans MS', 'Trebuchet MS'].map(f => `<option ${f === st.font ? 'selected' : ''}>${f}</option>`).join('')}</select><span></span></label>`,
      row('to-fs', 'Size', 6, 160, 1, st.fontSize), `<label style="color:var(--dim)"><input type="checkbox" id="to-bold" ${st.bold ? 'checked' : ''}> Bold</label><div class="note">Click on the picture where the text starts.</div>`);
    if (t === 'select') rows.push(`<div class="note">Drag a box to select (painting then stays inside it). Drag inside it to move those pixels; click outside to put them down. <kbd>Ctrl+C</kbd> copy, <kbd>Ctrl+X</kbd> cut, <kbd>Ctrl+V</kbd> paste (also pictures copied in other programs), <kbd>Del</kbd> clear, <kbd>Ctrl+A</kbd> all, <kbd>Esc</kbd> none.</div>`);
    if (t === 'pick') rows.push('<div class="note">Click to take a colour (Alt-click does it with any tool).</div>');
    if (t === 'hand') rows.push('<div class="note">Drag to move around. Right-drag or Space-drag does this with any tool, the wheel zooms.</div>');
    el.innerHTML = rows.join('');
    const bind = (id, k, num = true) => { const i = $('#' + id, el); if (i) i.oninput = () => { st[k] = i.type === 'checkbox' ? i.checked : num ? +i.value : i.value; if (i.nextElementSibling?.tagName === 'OUTPUT') i.nextElementSibling.value = i.value; view.redraw(); }; };
    bind('to-size', 'size'); bind('to-hard', 'hard'); bind('to-op', 'opacity'); bind('to-tol', 'tol'); bind('to-contig', 'contig'); bind('to-fillsh', 'fillShapes');
    bind('to-font', 'font', false); bind('to-fs', 'fontSize'); bind('to-bold', 'bold');
  }
  function renderPanel() {
    const el = $('#tx-panel', P.right);
    if (!doc) { el.innerHTML = '<h3>Texture</h3><div class="sec"><div class="note">Pick a texture on the left to edit it.</div></div>'; return; }
    const I = doc.info;
    el.innerHTML = `
      <h3>Colour</h3>
      <div class="sec">
        <div class="cols"><input type="color" class="swatch" id="tx-col" value="${rgba2hex(st.col)}" title="Colour"><input type="color" class="swatch" id="tx-col2" value="${rgba2hex(st.col2)}" title="Second colour (X swaps)" style="width:26px;height:22px">
          <button id="tx-swap" title="Swap colours (X)" style="padding:2px 6px">⇄</button><span style="flex:1"></span></div>
        <label class="row">Opacity<input type="range" id="tx-alpha" min="0" max="255" value="${st.col[3]}"><output>${st.col[3]}</output></label>
        <div class="recent" id="tx-recent"></div>
      </div>
      <h3>Tool</h3><div class="sec" id="tx-topts"></div>
      ${I.frames > 1 ? `<h3>Frames</h3><div class="sec"><div class="frames">${doc.frames.map((f, i) => `<button data-f="${i}" class="${i === doc.frame ? 'on' : ''}">${i + 1}</button>`).join('')}</div>
        <div class="btns"><button id="tx-play">▶ Play</button></div><div class="note">An animated texture: ${I.frames} frames at ${I.fps || '?'} per second. Each frame is edited and saved on its own.</div></div>` : ''}
      ${I.recolour ? `<h3>Recolour preview</h3><div class="sec"><div class="cols">${[0, 1, 2].filter(k => I.recolour & (1 << k)).map(k => `<input type="color" class="swatch rc" data-k="${k}" value="${['#d02020', '#2060d0', '#e0c020'][k]}" title="Recolour ${k + 1}">`).join('')}
        <label style="color:var(--dim)"><input type="checkbox" id="tx-rc"> Preview</label></div>
        <div class="note">The game paints the blue, magenta and yellow parts in the colours chosen for the object. Edit in the placeholder colours; this only shows the result.</div></div>` : ''}
      <h3>Adjust ${'<small style="text-transform:none;letter-spacing:0;color:var(--dim)">(selection, or the whole picture)</small>'}</h3>
      <div class="sec">
        <label class="row">Brightness<input type="range" id="ad-b" min="-128" max="128" value="0"><output>0</output></label>
        <label class="row">Contrast<input type="range" id="ad-c" min="-128" max="128" value="0"><output>0</output></label>
        <label class="row">Hue<input type="range" id="ad-h" min="-180" max="180" value="0"><output>0</output></label>
        <label class="row">Saturation<input type="range" id="ad-s" min="-100" max="100" value="0"><output>0</output></label>
        <div class="btns"><button id="ad-apply">Apply</button><button id="ad-reset">Reset</button></div>
        <div class="btns"><button data-op="invert">Invert</button><button data-op="gray">Greyscale</button><button data-op="tint" title="Colour it with the current colour, keeping light and dark">Tint</button><button data-op="opaque" title="Make every pixel fully opaque">Opaque</button></div>
        <div class="btns"><button data-op="fliph">Flip ↔</button><button data-op="flipv">Flip ↕</button><button data-op="rot180">Turn 180°</button><button data-op="rot90">Turn 90°</button></div>
      </div>
      <h3>Picture</h3>
      <div class="sec">
        <div class="kv"><span>Name</span><b>${esc(I.name.split(':')[0])}</b><span>Size</span><b>${I.w} × ${I.h}</b><span>Stored as</span><b>${esc(I.format)}${I.mips > 1 ? ` + ${I.mips - 1} smaller copies (made for you)` : ''}</b>
          <span>Game file</span><b>${esc(I.path)}</b>${I.icons?.length ? `<span>Icons</span><b>${I.icons.length} cut from this sheet</b>` : ''}</div>
        <div class="btns"><button id="tx-undo" title="Ctrl+Z">↶ Undo</button><button id="tx-redo" title="Ctrl+Y">↷ Redo</button><button id="tx-revert" title="Reload it from the game">Revert</button></div>
        <div class="btns"><button id="tx-import" title="A PNG / JPG from your computer: scaled to this size (or into the selection)">Import…</button><button id="tx-export" title="Download this picture as a PNG">Export PNG</button></div>
        <input type="file" id="tx-file" accept="image/*" hidden>
        <div class="note" id="tx-dirty"></div>
        <button class="primary" id="tx-save" title="Write it into the game file (Ctrl+S)">Save into game</button>
        ${I.editable ? '' : '<div class="note" style="color:var(--err)">This picture is stored in a way that can not be written back.</div>'}
        ${S.edits[I.path] ? `<button class="warn" id="tx-restore" title="Put the game's original file back">Restore original file</button>` : ''}
      </div>`;
    const P2 = el;
    $('#tx-col', P2).oninput = e => { st.col = hex2rgba(e.target.value, st.col[3]); };
    $('#tx-col2', P2).oninput = e => { st.col2 = hex2rgba(e.target.value, st.col2[3]); };
    $('#tx-alpha', P2).oninput = e => { st.col[3] = +e.target.value; e.target.nextElementSibling.value = e.target.value; };
    $('#tx-swap', P2).onclick = () => { [st.col, st.col2] = [st.col2, st.col]; setColour(st.col); $('#tx-col2', P2).value = rgba2hex(st.col2); };
    $('#tx-recent', P2).onclick = e => { const c = e.target.dataset?.c; if (c) setColour(c.split(',').map(Number)); };
    renderRecent();
    for (const id of ['ad-b', 'ad-c', 'ad-h', 'ad-s']) $('#' + id, P2).oninput = e => { e.target.nextElementSibling.value = e.target.value; previewAdjust(); };
    $('#ad-apply', P2).onclick = applyAdjust;
    $('#ad-reset', P2).onclick = () => { adjust = null; resetSliders(); view.redraw(); };
    P2.querySelectorAll('[data-op]').forEach(b => b.onclick = () => {
      const op = b.dataset.op, c = st.col;
      if (op === 'invert') pixelOp((p, i) => { p[i] = 255 - p[i]; p[i + 1] = 255 - p[i + 1]; p[i + 2] = 255 - p[i + 2]; });
      else if (op === 'gray') pixelOp((p, i) => { const l = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; p[i] = p[i + 1] = p[i + 2] = l; });
      else if (op === 'tint') pixelOp((p, i) => { const l = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255; p[i] = c[0] * l * 1.25; p[i + 1] = c[1] * l * 1.25; p[i + 2] = c[2] * l * 1.25; });
      else if (op === 'opaque') pixelOp((p, i) => { p[i + 3] = 255; });
      else transformOp(op);
    });
    $('#tx-undo', P2).onclick = () => undoRedo(doc.undo, doc.redo);
    $('#tx-redo', P2).onclick = () => undoRedo(doc.redo, doc.undo);
    $('#tx-revert', P2).onclick = revert;
    $('#tx-import', P2).onclick = () => $('#tx-file', P2).click();
    $('#tx-file', P2).onchange = e => { const f = e.target.files[0]; if (f) importPng(f); e.target.value = ''; };
    $('#tx-export', P2).onclick = exportPng;
    $('#tx-save', P2).onclick = save;
    $('#tx-restore', P2)?.addEventListener('click', restoreFile);
    P2.querySelectorAll('.frames button[data-f]').forEach(b => b.onclick = () => { stopPlay(); setFrame(+b.dataset.f); });
    $('#tx-play', P2)?.addEventListener('click', togglePlay);
    const rc = $('#tx-rc', P2);
    if (rc) {
      const upd = async () => {
        if (!rc.checked) { recolPreview = null; view.redraw(); return; }
        const cols = [0, 1, 2].map(k => P2.querySelector(`.rc[data-k="${k}"]`)?.value || '#ffffff');
        const img = await loadImage(imgUrl(doc.path, doc.name, doc.frame, cols) + '&t=' + Date.now());
        recolPreview = canvasOf(img.width, img.height); recolPreview.getContext('2d').drawImage(img, 0, 0); view.redraw();
      };
      rc.onchange = upd; P2.querySelectorAll('.rc').forEach(i => i.onchange = () => rc.checked && upd());
    }
    renderToolOpts(); updateSaveState();
  }

  function key(e) {
    if (!doc) return;
    const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? undoRedo(doc.redo, doc.undo) : undoRedo(doc.undo, doc.redo); return; }
    if (ctrl && k === 'y') { e.preventDefault(); undoRedo(doc.redo, doc.undo); return; }
    if (ctrl && k === 's') { e.preventDefault(); save(); return; }
    if (ctrl && k === 'c') { e.preventDefault(); copySel(false); return; }
    if (ctrl && k === 'x') { e.preventDefault(); copySel(true); return; }
    if (ctrl && k === 'a') { e.preventDefault(); commitFloat(); sel = [0, 0, doc.info.w, doc.info.h]; view.redraw(); return; }
    if (ctrl) return;
    if (k === 'escape') { if (float) commitFloat(); sel = null; view.redraw(); return; }
    if (k === 'enter') { commitFloat(); view.redraw(); return; }
    if (k === 'delete' || k === 'backspace') { delSel(); return; }
    if (KEYS[k]) { setTool(KEYS[k]); return; }
    if (k === 'x') { $('#tx-swap', P.right)?.click(); return; }
    if (k === '[') { st.size = Math.max(1, st.size - (st.size > 10 ? 4 : 1)); renderToolOpts(); view.redraw(); return; }
    if (k === ']') { st.size = Math.min(128, st.size + (st.size >= 10 ? 4 : 1)); renderToolOpts(); view.redraw(); return; }
    if (k === '0') { view.fit(); return; }
    if (k === '1') { const r = cv.getBoundingClientRect(); view.zoomAt(1, r.width / 2, r.height / 2); return; }
    if (k === '+' || k === '=') { const r = cv.getBoundingClientRect(); view.zoomAt(view.z * 1.25, r.width / 2, r.height / 2); return; }
    if (k === '-') { const r = cv.getBoundingClientRect(); view.zoomAt(view.z * 0.8, r.width / 2, r.height / 2); return; }
    if (float && k.startsWith('arrow')) { e.preventDefault(); const s = e.shiftKey ? 10 : 1; float.x += k === 'arrowleft' ? -s : k === 'arrowright' ? s : 0; float.y += k === 'arrowup' ? -s : k === 'arrowdown' ? s : 0; view.redraw(); }
  }

  function init() {
    fillFolders(); renderList(); setTool('brush'); renderPanel();
    $('#tx-empty', P.centre).textContent = 'Pick a texture on the left';
    const m = location.hash.match(/^#textures=(.+)$/);
    if (m) { const [p, n] = decodeURIComponent(m[1]).split('|'); if (p && n) open(p, n); }
  }
  return {
    init, open, key, paste, dirty, afterRestore, shown: () => view.redraw(),
    hasSelection: () => !!(sel || float),
  };
}

// ================================================================================================================
// GUI Editor
function guiEditor({ root, panes, S, toast, confirmBox, setEdits, spaceHeld, openTexture }) {
  const P = panes;
  P.left.innerHTML = `<div class="filters"><input type="search" id="gu-q" placeholder="Search icons, OVLs and texts"></div><div class="scroll" id="gu-list"><div class="empty" style="position:static;padding:20px">Loading…</div></div>`;
  P.centre.innerHTML = `
    <div class="ctool" id="gu-tabs"></div>
    <div class="stage" id="gu-stage"><canvas id="gu-cv"></canvas><div id="gu-panel" style="position:absolute;inset:0;display:none"></div>
      <div class="empty" id="gu-empty">Pick something on the left: the game's interface icons, button states, icon animations, window frames, menu screens, fonts or menu texts.</div>
      <div class="status" id="gu-status"></div></div>`;
  P.right.innerHTML = `<div id="gu-right"></div>`;
  P.left.style.overflow = 'hidden';
  const cv = $('#gu-cv', P.centre);
  const G = { ovl: null, icons: [], sheets: new Map(), sheet: null, sel: null, view: 'sheet', loaded: false, texts: null, lang: null, moved: new Map() };
  const view = new View(cv, (ctx, v) => drawSheet(ctx, v));
  panner(view, cv, spaceHeld);

  // ---- grouping the icons of an OVL: button states and numbered sets ----------------------------------------------
  const STATE = /^(.*?)[_ ]?(Up|Over|Hover|Pressed|Down|Disabled|Active|Inactive|Selected|Highlight(?:ed)?|Normal|On|Off|NoFocus|Focus|Grey|Colour)$/;
  function stateGroups(icons) {
    const m = new Map();
    for (const g of icons) { const r = g.name.match(STATE); if (!r) continue; const k = r[1]; if (!m.has(k)) m.set(k, []); m.get(k).push([r[2], g]); }
    return [...m].filter(([, v]) => v.length >= 2 && v.some(([s]) => /Over|Hover|Pressed|Disabled|Selected|Highlight|NoFocus/.test(s)))
      .map(([k, v]) => ({ name: k, states: Object.fromEntries(v.map(([s, g]) => [s, g])) })).sort((a, b) => a.name.localeCompare(b.name));
  }
  function animGroups(icons) {
    const m = new Map();
    for (const g of icons) { const r = g.name.match(/^(.*?)(\d+)$/); if (!r) continue; if (!m.has(r[1])) m.set(r[1], []); m.get(r[1]).push([+r[2], g]); }
    const real = a => /state|anim|frame|spin|step|stage|phase|turn|rot|load|wait|busy|clock|cycle/i.test(a.name) ? 0 : 1;   // motion first, numbered colour sets after
    return [...m].filter(([, v]) => v.length >= 2).map(([k, v]) => ({ name: k.replace(/[_ ]$/, ''), frames: v.sort((a, b) => a[0] - b[0]).map(x => x[1]) }))
      .sort((a, b) => real(a) - real(b) || a.name.localeCompare(b.name));
  }
  // ---- the in-park screen: the top bar and the buttons down the left -----------------------------------------------
  // Which icon each piece shows comes from RCT3plus.exe (top bar built at 0x655788: Top_WindowFrame_Left / _Middle /
  // _Right, DayNightModeButton, ObjectiveStatusButton, Pause / Play / FastForward / SuperFastForwardButton, Money,
  // PeopleInPark, Top_ThumbsDown, ParkRatingBar, Top_ThumbsUp, Temperature + weather icon, DateAndTime,
  // AvatarNameButton, Fireworks, EscapedAnimals; left toolbar at 0x5f686a: Map, View, File, File_Quit / File_CareerMap,
  // Man, Obj_Rides, Obj_Shops, Obj_Scenery, Obj_Paths, Land, Obj_Delete on MenuButtonSmall discs). The game lays
  // them out at run time; where they sit here was measured in the game at 1280 × 800.
  const HUD_W = 1280, HUD_H = 800;
  const LEFT_BTNS = [['Map', 'Park map'], ['View', 'View options'], ['File', 'File (save, load, options)'], ['File_Quit', 'Quit', 'File_CareerMap'],
    ['Man', 'Park management'], ['Obj_Rides', 'Rides'], ['Obj_Shops', 'Shops and stalls'], ['Obj_Scenery', 'Scenery'], ['Obj_Paths', 'Paths'], ['Land', 'Landscape'], ['Obj_Delete', 'Delete']];
  const LEFT_Y = [157, 197, 237, 277, 337, 377, 417, 457, 497, 537, 577];
  const HUD = [
    { id: 'barL', label: 'Top bar, left half', widget: 'Top_WindowFrame_Left', icons: ['Top_WindowFrame_Left'], box: [301, 0, 299, 23], sliced: true },
    { id: 'barM', label: 'Top bar, middle', widget: 'Top_WindowFrame_Middle', icons: ['Top_WindowFrame_Middle'], box: [600, 0, 38, 23], sliced: true },
    { id: 'barR', label: 'Top bar, right half', widget: 'Top_WindowFrame_Right', icons: ['Top_WindowFrame_Right'], box: [638, 0, 338, 23], sliced: true },
    { id: 'obj', label: 'Objective status (difficulty hat)', widget: 'ObjectiveStatusButton', icons: ['Difficulty_Hat_Apprentice', 'Difficulty_Hat_Entrepreneur', 'Difficulty_Hat_Tycoon'], box: [305, 3, 16, 16] },
    { id: 'dn', label: 'Day / night mode', widget: 'DayNightModeButton', icons: ['GUI2_DayNightCycle_DayNight', 'GUI2_DayNightCycle_Day', 'GUI2_DayNightCycle_Night'], box: [327, 2, 16, 16] },
    { id: 'pause', label: 'Pause', widget: 'PauseButton', icons: ['Top_Pause', 'Top_PauseSelected'], box: [348, 5, 8, 13], speed: 0 },
    { id: 'play', label: 'Play', widget: 'PlayButton', icons: ['Top_Play', 'Top_PlaySelected'], box: [361, 5, 8, 13], speed: 1 },
    { id: 'ff', label: 'Fast forward', widget: 'FastForwardButton', icons: ['Top_FastForward', 'Top_FastForwardSelected'], box: [374, 5, 13, 13], speed: 2 },
    { id: 'sff', label: 'Super fast forward', widget: 'SuperFastForwardButton', icons: ['Top_SuperFastForward', 'Top_SuperFastForwardSelected'], box: [392, 5, 17, 13], speed: 3 },
    { id: 'money', label: 'Money', widget: 'Money', text: '$ unlimited', box: [423, 4, 71, 15] },
    { id: 'guests', label: 'Guests in the park', widget: 'PeopleInPark', text: '20', box: [519, 4, 19, 15], right: true },
    { id: 'down', label: 'Park rating: thumbs down', widget: 'Top_ThumbsDown', icons: ['Top_ThumbsDown'], box: [543, 4, 12, 15] },
    { id: 'rating', label: 'Park rating bar', widget: 'ParkRatingBar', bar: true, box: [557, 6, 25, 10] },
    { id: 'up', label: 'Park rating: thumbs up', widget: 'Top_ThumbsUp', icons: ['Top_ThumbsUp'], box: [584, 4, 12, 15] },
    { id: 'temp', label: 'Temperature', widget: 'Temperature', text: '62 F', box: [645, 4, 29, 15] },
    { id: 'weather', label: 'Weather', widget: 'IconCloudWithSun', icons: ['IconSun', 'IconCloudWithSun', 'IconCloud', 'IconLightRain', 'IconHeavyRain', 'IconThunderstorm', 'IconSnow'], box: [679, 3, 16, 16] },
    { id: 'date', label: 'Date and time', widget: 'DateAndTime', text: '4 March, Year 1   10:47 am', box: [741, 4, 185, 15] },
    { id: 'dart', label: 'Dart cam (when animals escape)', widget: 'EscapedAnimals', icons: ['DartCam_TopButton'], box: [921, 3, 16, 16], dim: 'animals' },
    { id: 'fw', label: 'Watch the firework display', widget: 'Fireworks', icons: ['Firework_Icon'], box: [938, 3, 16, 16], dim: 'fireworks' },
    { id: 'avatar', label: 'Your avatar', widget: 'AvatarNameButton', icons: ['Guest_Group', 'Guest_Group_Disabled'], box: [956, 3, 16, 16] },
    ...LEFT_BTNS.map(([icon, label, alt], i) => ({ id: 'l' + i, label: label + ' button', widget: icon, icons: [icon, ...(alt ? [alt] : []), 'MenuButtonSmall'], box: [12, LEFT_Y[i], 32, 33], disc: true })),
  ];
  const HUD_VIEWS = { all: [0, 0, HUD_W, HUD_H], top: [290, 0, 700, 40], left: [0, 145, 120, 480] };
  const HS = { view: 'all', speed: 1, weather: 'IconSun', hat: 'Difficulty_Hat_Apprentice', dn: 'GUI2_DayNightCycle_DayNight', career: false, fireworks: false, animals: false, sel: null, hover: null, cv: null, icons: new Map(), xf: null,
    sim: false, fly: null, item: null, win: null, dnOpen: false, toggles: new Set(), hits: [], texts: null,
    con: { bottom: 0, msgs: [], scroll: 0, view: 'closed' }, conEls: [], drag: null, dragged: false };
  // ---- the message console (the notification bar), as seen in the game (Steam, sandbox, 1280 x 800) --------------------
  // It hangs from the top bar's notch: drag its handle ("Click and drag open") down and it opens to wherever it is let
  // go, up to MessageConsole_Left's height + 315 (RCT3plus.exe 0x61c1a0). 472 wide at x 385; striped rows (white /
  // #e5e5e5, 18 px, 0x61f353) above a strip with the handle and the Next / Previous arrows; the newest message is the
  // bottom row (a 16 px icon, then the text). Closed, nothing shows: messages wait in it. Drawn from its pieces:
  // MessageConsole_Top stacked down the panel, _Left and _Right side by side along its bottom (0x61f220).
  const CON = { x: 385, w: 472, top: 22, strip: 25, row: 18, max: 22 + 39 + 315 };
  const CON_ICONS = ['MessageConsole_Top', 'MessageConsole_Left', 'MessageConsole_Right', 'MessageConsole_ParkInspector', 'SquareArrowUp', 'SquareArrowDown',
    'SquareArrowUpDisabled', 'SquareArrowDownDisabled', 'Guest_Group', 'Obj_Rides', 'Man_Staff', 'Man_Objectives', 'Man_Research', 'Man_Park'];
  // test messages: the game's own message texts with made-up names, each with the icon of what it is about (the icons
  // are stand-ins except the guest's, seen in the game)
  const TEST_MSGS = [
    ['Guest_Group', () => 'Sheryl H: ' + ['Hey!', 'This park is really tidy!', 'You blinked!', "You've got your thumb over the lens!"][Math.floor(Math.random() * 4)]],
    ['Obj_Rides', t => (t('RideBrokenMessageBrakesFail') || 'The brakes on %NAME% have failed.').replace('%NAME%', 'Air Powered Coaster 1')],
    ['Obj_Rides', t => (t('RideFixedMessage') || '%NAME% has been fixed.').replace('%NAME%', 'Air Powered Coaster 1')],
    ['Man_Staff', t => (t('StaffMessage_WantsToResign') || '%NAME% is thinking about quitting').replace('%NAME%', 'Handyman 3')],
    ['Man_Objectives', t => (t('ObjectiveMessage_MetCondition') || 'You have met the %NAME% condition').replace('%NAME%', 'Park Rating')],
    ['Man_Park', t => (t('Award_Award') || 'You have won an award: %NAME%').replace('%NAME%', t('Award_Tidiest') || 'Tidiest Park')],
    ['Guest_Group', t => (t('MessageConsole_PersonState') || "%NAME%'s state has changed to: %STATE%").replace('%NAME%', 'Sheryl H').replace('%STATE%', t('PersonState_Lost') || 'Lost')],
    ['MessageConsole_ParkInspector', () => 'The park inspector has visited the park'],
  ];
  function conMessage(n = 1) {
    const t = k => HS.texts?.get(k);
    for (let i = 0; i < n; i++) { const [icon, f] = TEST_MSGS[(HS.con.msgs.length + i) % TEST_MSGS.length]; HS.con.msgs.push({ icon, text: f(t) }); }
    HS.con.scroll = 0;
  }
  const conRows = () => Math.max(0, Math.floor((HS.con.bottom - CON.strip - CON.top) / CON.row));
  const conMaxScroll = () => Math.max(0, HS.con.msgs.length - conRows());
  // draws the console (open or closed); its pieces go into els (to select and edit them) and its handles into hits
  function drawConsole(x, hits, els) {
    const c = HS.con, b = c.bottom, X = CON.x, Wd = CON.w;
    const piece = (n, dx, dy, dw, dh, label) => {
      const g = iconByName(n), src = HS.icons.get(n);
      if (g && src) { if (g.xs) drawStretched(x, src, g, dx, dy, dw, dh); else x.drawImage(src, dx, dy, dw, dh); }
      els?.push({ id: 'con_' + n, label, widget: 'MessageConsole', icons: [n], box: [dx, dy, dw, dh].map(Math.round), sliced: !!g?.xs });
    };
    if (b <= CON.top + 6) {            // closed: only its handle in the notch
      x.fillStyle = '#000'; for (let k = 0; k < 3; k++) x.fillRect(616, 14 + 2 * k, 9, 1);
      hits?.push({ id: 'barM', key: 'conHandle', box: [600, 0, 38, 23], label: 'Message console', drag: 'con' });
      return;
    }
    const lh = iconByName('MessageConsole_Left') ? Math.abs(iconByName('MessageConsole_Left').rect[3] - iconByName('MessageConsole_Left').rect[1]) : 39;
    const th = iconByName('MessageConsole_Top') ? Math.abs(iconByName('MessageConsole_Top').rect[3] - iconByName('MessageConsole_Top').rect[1]) : 36;
    x.save(); x.beginPath(); x.rect(X - 6, CON.top, Wd + 12, b - CON.top + 8); x.clip();
    x.fillStyle = '#0003'; x.fillRect(X + 3, CON.top, Wd, b - CON.top + 3);
    let ty = b - lh, first = true;
    while (ty > CON.top - th) { ty -= th; piece('MessageConsole_Top', X, ty, Wd, th, first ? 'Message console (side pieces)' : null); first = false; }
    if (els) els.splice(1, els.length - 1, ...els.slice(1).filter(e => e.label));
    piece('MessageConsole_Left', X, b - lh, Math.round(Wd / 2), lh, 'Message console (bottom left)');
    piece('MessageConsole_Right', X + Math.round(Wd / 2), b - lh, Wd - Math.round(Wd / 2), lh, 'Message console (bottom right)');
    // the rows, from the bottom up: the newest message at the bottom
    const rx = X + 10, rw = Wd - 20, rb = b - CON.strip, n = conRows(), msgs = c.msgs, last = msgs.length - 1 - c.scroll;
    for (let k = 0; k < n + 1; k++) {
      const y = rb - CON.row * (k + 1); if (y + CON.row <= CON.top) break;
      x.fillStyle = k % 2 ? '#e5e5e5' : '#ffffff'; x.fillRect(rx, Math.max(CON.top, y), rw, CON.row - Math.max(0, CON.top - y));
      const m = msgs[last - k];
      if (m && y >= CON.top) {
        const ic = HS.icons.get(m.icon); if (ic) x.drawImage(ic, rx + 1, y + 1, 16, 16);
        x.fillStyle = '#000'; x.font = '12px Verdana, Tahoma, sans-serif'; x.textAlign = 'left'; x.textBaseline = 'middle';
        x.fillText(m.text, rx + 32, y + CON.row / 2 + 0.5, rw - 40);
      }
    }
    x.fillStyle = '#c9c9d0'; x.fillRect(rx + rw - 1, CON.top, 1, rb - CON.top);
    // the bottom strip: the handle in the middle, Next (down) and Previous (up) messages
    x.fillStyle = '#000'; for (let k = 0; k < 3; k++) x.fillRect(616, b - 8 + 2 * k, 9, 1);
    const canUp = c.scroll < conMaxScroll(), canDown = c.scroll > 0;
    for (const [n2, ax, ok, tip, act] of [['SquareArrowDown', 717, canDown, 'TT_GUI2_MessageConsoleNextMessages', () => { c.scroll = Math.max(0, c.scroll - 1); }],
      ['SquareArrowUp', 736, canUp, 'TT_GUI2_MessageConsolePrevoiusMessages', () => { c.scroll = Math.min(conMaxScroll(), c.scroll + 1); }]]) {
      const nm = ok ? n2 : n2 + 'Disabled', ic = HS.icons.get(nm), box = [ax, b - 19, 14, 14];
      if (ic) x.drawImage(ic, ...box);
      els?.push({ id: 'con_' + n2, label: 'Message console: ' + (HS.texts?.get(tip) || tip), widget: 'MessageConsole', icons: [n2, n2 + 'Disabled'], box });
      hits?.push({ id: 'con_' + n2, key: 'con_' + n2, box, label: HS.texts?.get(tip) || tip, widget: nm, icons: [nm], tipKey: tip, act: ok ? act : null });
    }
    x.restore();
    hits?.push({ id: 'barM', key: 'conHandle', box: [X, b - CON.strip, Wd, CON.strip], label: 'Message console', drag: 'con' });
  }
  // ---- simulating the in-park screen: what each button opens, as seen in the game (Steam, sandbox, 1280 x 800) ------
  // A left button opens a column of discs (x 68, 40 apart) ending just above it, pushed down to start at y 24 when it
  // would go off the top; the button being used and the one under the pointer are drawn larger. Its tooltip is the
  // game's own text (<icon>Help in the language file). What a flyout button opens: a list at x 84 centred on the button
  // (kept on screen: rides, shops, scenery, animals, track import), a window (management, file), a round tool panel at
  // the bottom left (paths, terrain, pools, enclosures, MixMaster) or a mode.
  const TIPS = { Map: 'MapHelp', View: 'ViewHelp', File: 'FileHelp', File_Quit: 'File_QuitHelp', File_CareerMap: 'File_CareerMapHelp', Man: 'ManHelp', Obj_Rides: 'Obj_RidesHelp',
    Obj_Shops: 'Obj_ShopsHelp', Obj_Scenery: 'Obj_SceneryHelp', Obj_Paths: 'Obj_PathsHelp', Land: 'Landhelp', Obj_Delete: 'Obj_DeleteHelp', CustomStructions_Icon: 'SavedSelection_SubMenuHelp',
    AnimalWalkingGridOff: 'ToggleEnclosureWalkInfo_TT', ThreeXFireworks: 'Obj_Scenery_FireworkSourcesHelp', Land_Brush_Height: 'Land_Brush_HeightHelp',
    pause: 'Playing_PauseHelp', play: 'Playing_PlayHelp', ff: 'Playing_FastForwardHelp', sff: 'Playing_SuperFastForwardHelp', obj: 'PID_TT_ObjectiveTabPopUp', dn: 'Toolbar_TT_DayNight',
    guests: 'Toolbar_TT_GuestsInPark', rating: 'Toolbar_TT_ParkRating', down: 'Toolbar_TT_ParkRating', up: 'Toolbar_TT_ParkRating', temp: 'Stats_TemperatureHelp', avatar: 'Toolbar_TT_AvatarHighlight', barM: 'MessageConsoleClickDrag',
    IconSun: 'WeatherType_Sunny_TT', IconCloudWithSun: 'WeatherType_SunnyCloudy_TT', IconCloud: 'WeatherType_Cloudy_TT', IconLightRain: 'WeatherType_LightRain_TT', IconHeavyRain: 'WeatherType_HeavyRain_TT',
    IconThunderstorm: 'WeatherType_Thunderstorm_TT', IconSnow: 'WeatherType_Snowstorm_TT' };
  const TIP_EN = { MapHelp: 'Maps', ViewHelp: 'View Controls', FileHelp: 'Files and Options', ManHelp: 'Park Management', Landhelp: 'Terrain tools', Obj_DeleteHelp: 'Delete Objects' };
  const tipOf = n => { const k = TIPS[n] || n + 'Help'; return HS.texts?.get(k) ?? TIP_EN[k] ?? spaced(n.replace(/^(Obj|Man|File|Land)_/, '').replace(/_/g, ' ')); };
  // [icon, what it opens, its other icon when toggled]; order top to bottom as in the game
  const FLY = {
    l1: [['Land_Grid', 'toggle', 'Land_GridOn'], ['Land_Contours', 'toggle', 'Land_ContoursOn'], ['Land_RideHeights', 'toggle', 'Land_RideHeightsOn'], ['Land_PathHeights', 'toggle', 'Land_PathHeightsOn'],
      ['Land_People', 'toggle', 'Land_PeopleOff'], ['Land_Supports', 'toggle', 'Land_SupportsOff'], ['Land_SceneryVisible', 'toggle', 'Land_SceneryVisibleOff'], ['Land_TerrainVisible', 'toggle', 'Land_TerrainVisibleOff'],
      ['AnimalWalkingGridOff', 'toggle', 'AnimalWalkingGridOn']],
    l2: [['File_AboutRCT', 'dialog'], ['File_GameOptions', 'dialog'], ['File_SaveGame', 'dialog'], ['File_LoadGame', 'dialog']],
    l4: [['Man_Park', 'dialog'], ['Man_Finances', 'dialog'], ['Man_Staff', 'dialog'], ['Man_Objectives', 'objectives'], ['Man_Research', 'dialog'], ['Man_Rides', 'dialog'], ['Man_Guests', 'dialog'], ['Man_Challenges', 'dialog']],
    l5: [['Obj_Rides_RollerCoasters', 'picker'], ['Obj_Rides_JuniorCoasters', 'picker'], ['Obj_Rides_ThrillRides', 'picker'], ['Obj_Rides_WaterRides', 'picker'], ['Obj_Rides_GentleRides', 'picker'],
      ['Obj_Rides_TransportRides', 'picker'], ['Obj_Rides_PoolRides', 'picker'], ['Obj_Rides_OtherRides', 'picker'], ['Obj_Rides_TrackImport', 'picker'], ['Obj_Pools', 'tool'], ['Obj_Rides_Animals', 'picker'], ['Obj_Enclosures', 'tool']],
    l6: [['Obj_Shops_FoodShops', 'picker'], ['Obj_Shops_DrinkShops', 'picker'], ['Obj_Shops_Stalls', 'picker'], ['Obj_Shops_Utilities', 'picker']],
    l7: [['Obj_Scenery_TreesNPlants', 'picker'], ['Obj_Scenery_Fences', 'picker'], ['Obj_Scenery_WallsRoofsAndBuildings', 'picker'], ['Obj_Scenery_PathExtras', 'picker'], ['Obj_Scenery_ThemeProps', 'picker'],
      ['Obj_Scenery_RideEvents', 'picker'], ['Obj_Scenery_TerrainSurfaces', 'picker'], ['Obj_Scenery_Adverts', 'picker'], ['CustomStructions_Icon', 'picker'], ['ThreeXFireworks', 'tool']],
    l9: [['Land_Brush_Height', 'tool'], ['Land_Brush_Paint', 'tool'], ['Land_Water', 'tool'], ['Land_Waterfall', 'tool']],
    l10: [['GUI2_DeleteSelection', 'mode'], ['GUI2_DeleteSingleItem', 'mode']],
  };
  const WIN_ICONS = ['WindowBackground', 'GUI2Dialog_Frame', 'GUI2Dialog_IconBackgroundNormal', 'GUI2Dialog_CloseIcon', 'GUI2Dialog_MinimiseIcon', 'GUI2MiniDialog_Frame', 'GUI2MiniDialog_Background', 'GUI2MiniDialog_Confirm', 'GUI2MiniDialog_Cancel',
    'Map_People', 'Map_Attractions', 'Map_Scenery', 'Difficulty_Hat_Apprentice', 'Difficulty_Hat_Entrepreneur', 'Difficulty_Hat_Tycoon'];
  // tool panels' right edges where measured (the others as Paths)
  const TOOL_RIGHT = { Obj_Paths: 362, Obj_Pools: 368, Obj_Enclosures: 332, ThreeXFireworks: 457 };
  const flyBoxes = id => {            // the discs of a left button's flyout, top to bottom
    const items = FLY[id] || [], by = LEFT_Y[+id.slice(1)] + 16;
    let y0 = by - 19 - 40 * (items.length - 1); if (y0 < 24) y0 = 24;
    return items.map((it, k) => [52, y0 + 40 * k - 16, 32, 33]);
  };
  const hudIcon = el => {             // which of its icons an element shows now
    if (el.speed != null) return el.icons[el.speed === HS.speed ? 1 : 0];
    if (el.id === 'weather') return HS.weather;
    if (el.id === 'obj') return HS.hat;
    if (el.id === 'dn') return HS.dn;
    if (el.id === 'l3') return HS.career ? 'File_CareerMap' : 'File_Quit';
    return el.icons[0];
  };
  const iconByName = n => G.icons.find(g => g.name === n);
  const hudScaled = h => { const g = h.icons && iconByName(hudIcon(h)), r = g && rectOf(g); return h.disc || !!(r && (r[2] - r[0] !== h.box[2] || r[3] - r[1] !== h.box[3])); };
  async function hudPrepare() {
    const names = new Set([...HUD.flatMap(el => el.icons || []), ...Object.values(FLY).flat().flatMap(([a, , b]) => b ? [a, b] : [a]), ...WIN_ICONS, ...CON_ICONS]);
    if (!HS.texts) {
      const lang = S.gui?.texts.find(o => /english\.common\.ovl$/i.test(o.path))?.path || S.gui?.texts.find(o => /^gui\\/i.test(o.path))?.path;
      HS.texts = new Map();
      if (lang) try { for (const t of await fetch('/api/tx/texts?path=' + encodeURIComponent(lang)).then(r => r.json())) HS.texts.set(t.name, t.text); } catch (e) {}
    }
    await Promise.all([...names].map(async n => { const g = iconByName(n); HS.icons.set(n, g ? await iconCanvas(g, 1) : null); }));
  }
  // a stretchable piece drawn at a size: the parts between its cuts stretch, the outer ones keep their size
  function stretchSpans(cuts, want) {
    const c = cuts.map(v => v - cuts[0]);
    if (c.length === 2) return { src: [[0, c[1]]], dst: [[0, want]] };
    const keep = c[1] + (c[3] - c[2]), mid = Math.max(0, want - keep);
    return { src: [[0, c[1]], [c[1], Math.max(c[2], c[1] + 1)], [c[2], c[3]]], dst: [[0, c[1]], [c[1], c[1] + mid], [c[1] + mid, c[1] + mid + (c[3] - c[2])]] };
  }
  function drawStretched(x, src, g, dx, dy, dw, dh) {
    const sx = stretchSpans(g.xs, dw), sy = stretchSpans(g.ys, dh);
    sx.src.forEach((a, i) => sy.src.forEach((b, j) => {
      const sw = Math.min(a[1], src.width) - a[0], sh = Math.min(b[1], src.height) - b[0], d = sx.dst[i], e = sy.dst[j];
      if (sw > 0 && sh > 0 && d[1] > d[0] && e[1] > e[0]) x.drawImage(src, a[0], b[0], sw, sh, dx + d[0], dy + e[0], d[1] - d[0], e[1] - e[0]);
    }));
  }
  function showHud(el) {
    el.innerHTML = `<div style="position:absolute;inset:0;display:flex;flex-direction:column">
      <div class="ctool" id="hud-opts" style="gap:10px">
        <label>Show <select id="hud-view"><option value="all">Whole screen</option><option value="top">Top bar (zoomed)</option><option value="left">Left buttons (zoomed)</option></select></label>
        <label>Speed <select id="hud-speed"><option value="0">Paused</option><option value="1">Normal</option><option value="2">Fast</option><option value="3">Super fast</option></select></label>
        <label>Weather <select id="hud-weather">${HUD.find(e => e.id === 'weather').icons.map(n => `<option value="${n}">${esc(spaced(n.replace(/^Icon/, '')))}</option>`).join('')}</select></label>
        <label>Hat <select id="hud-hat">${HUD.find(e => e.id === 'obj').icons.map(n => `<option value="${n}">${esc(n.split('_').pop())}</option>`).join('')}</select></label>
        <label>Day / night <select id="hud-dn">${HUD.find(e => e.id === 'dn').icons.map(n => `<option value="${n}">${esc(spaced(n.split('_').pop()))}</option>`).join('')}</select></label>
        <label title="A career game shows the Career map button where sandbox shows Quit"><input type="checkbox" id="hud-career"> Career</label>
        <label title="The firework button is greyed unless a display is running"><input type="checkbox" id="hud-fw"> Firework display on</label>
        <label title="The dart cam button is greyed unless animals have escaped"><input type="checkbox" id="hud-animals"> Animals escaped</label>
        <label title="The message console hangs from the top bar's notch; open, its pieces can be picked and edited">Messages <select id="hud-con"><option value="closed">Closed</option><option value="open">Open</option></select></label>
        <span style="flex:1"></span><button id="hud-sim" title="Click the buttons as in the game: the left buttons open their menus, the top bar works">▶ Simulate</button>
      </div>
      <div style="position:relative;flex:1;min-height:0"><canvas id="hud-cv" style="position:absolute;inset:0;width:100%;height:100%;cursor:default"></canvas></div>
      <div class="note" style="color:var(--dim);padding:6px 10px;font-size:11px">The game's top bar and left buttons, drawn from the icons in this file as the game draws them (laid out as in the game at 1280 × 800). Click a piece to edit its picture on the right; double-click to paint it. Texts are drawn by the game in its own font (their words come from the game, not from these icons).</div>
    </div>`;
    HS.cv = $('#hud-cv', el);
    const bind = (id, key, conv = v => v) => { const s = $('#' + id, el); s.value = String(HS[key]); s.onchange = () => { HS[key] = conv(s.value); drawHud(); }; };
    bind('hud-view', 'view'); bind('hud-speed', 'speed', Number); bind('hud-weather', 'weather'); bind('hud-hat', 'hat'); bind('hud-dn', 'dn');
    const cs = $('#hud-con', el); cs.value = HS.con.view;
    cs.onchange = () => { HS.con.view = cs.value; if (cs.value === 'open') { if (HS.con.msgs.length < 4) conMessage(4); HS.con.bottom = Math.max(HS.con.bottom, 200); } else HS.con.bottom = 0; drawHud(); };
    for (const [id, key] of [['hud-career', 'career'], ['hud-fw', 'fireworks'], ['hud-animals', 'animals']]) { const c = $('#' + id, el); c.checked = HS[key]; c.onchange = () => { HS[key] = c.checked; drawHud(); renderRight(); }; }
    const at = e => { const b = HS.cv.getBoundingClientRect(), t = HS.xf; if (!t) return null; const x = (e.clientX - b.left - t.ox) / t.s, y = (e.clientY - b.top - t.oy) / t.s;
      return [...HS.conEls].reverse().find(h => x >= h.box[0] && x < h.box[0] + h.box[2] && y >= h.box[1] && y < h.box[1] + h.box[3]) ||
        [...HUD].reverse().find(h => !h.sliced && x >= h.box[0] && x < h.box[0] + h.box[2] && y >= h.box[1] && y < h.box[1] + h.box[3]) ||
        HUD.find(h => h.sliced && x >= h.box[0] && x < h.box[0] + h.box[2] && y >= h.box[1] && y < h.box[1] + h.box[3]) || null; };
    const simAt = e => { const b = HS.cv.getBoundingClientRect(), t = HS.xf; if (!t) return null; const x = (e.clientX - b.left - t.ox) / t.s, y = (e.clientY - b.top - t.oy) / t.s;
      return [...HS.hits].reverse().find(h => x >= h.box[0] && x < h.box[0] + h.box[2] && y >= h.box[1] && y < h.box[1] + h.box[3]) || null; };
    const layoutXY = e => { const b = HS.cv.getBoundingClientRect(), t = HS.xf; return [(e.clientX - b.left - t.ox) / t.s, (e.clientY - b.top - t.oy) / t.s]; };
    HS.cv.onpointerdown = e => {
      if (!HS.sim || !HS.xf) return;
      const h = simAt(e); if (!h?.drag) return;
      const [x, y] = layoutXY(e);
      HS.drag = { kind: h.drag, x, y, dx: HS.win?.dx || 0, dy: HS.win?.dy || 0, bottom: HS.con.bottom, moved: false };
      HS.cv.setPointerCapture(e.pointerId);
    };
    HS.cv.onpointerup = () => { if (HS.drag) { HS.dragged = HS.drag.moved; HS.drag = null; drawHud(); } };
    HS.cv.onpointermove = e => {
      if (HS.drag) {
        const [x, y] = layoutXY(e), d = HS.drag, mx = x - d.x, my = y - d.y;
        if (Math.abs(mx) + Math.abs(my) > 2) d.moved = true;
        if (d.kind === 'con') HS.con.bottom = Math.max(0, Math.min(CON.max, (d.bottom > CON.top + 6 ? d.bottom : 22) + my));
        else if (HS.win) { HS.win.dx = Math.round(d.dx + mx); HS.win.dy = Math.round(d.dy + my); }
        HS.cv.style.cursor = 'grabbing'; drawHud(); return;
      }
      const h = HS.sim ? simAt(e) : at(e);
      const same = HS.sim ? !!h === !!HS.hover && h?.key === HS.hover?.key : h === HS.hover;
      if (!same) { HS.hover = h; HS.cv.style.cursor = h?.drag ? 'grab' : h && (!HS.sim || h.act) ? 'pointer' : 'default'; HS.cv.title = h && !HS.sim ? h.label : ''; drawHud(); }
    };
    HS.cv.onpointerleave = () => { HS.hover = null; drawHud(); };
    HS.cv.onclick = e => {
      if (!HS.sim) { selectHud(at(e)); return; }
      if (HS.dragged) { HS.dragged = false; return; }        // the end of a drag, not a click
      const h = simAt(e);
      if (!h) { HS.dnOpen = false; drawHud(); return; }
      if (h.act) h.act();
      if (h.icons) selectHud(h); else drawHud();          // what was clicked is also the piece shown on the right
    };
    $('#hud-sim', el).onclick = () => hudSimulate(!HS.sim);
    hudSimMark();
    HS.cv.ondblclick = e => { const h = at(e); if (h && G.sel && h.icons) openTexture(G.sel.sheet, G.sel.texture, { rect: rectOf(G.sel) }); };
    new ResizeObserver(() => drawHud()).observe(HS.cv);
    hudPrepare().then(drawHud);
  }
  function selectHud(h) {
    HS.sel = h;
    G.sel = h?.icons ? iconByName(hudIcon(h)) || null : null;
    drawHud(); renderRight();
  }
  function drawHud() {
    const c = HS.cv; if (!c || G.view !== 'hud') return;
    const W = c.clientWidth, Hh = c.clientHeight; if (!W || !Hh) return;
    const dpr = devicePixelRatio || 1; c.width = Math.round(W * dpr); c.height = Math.round(Hh * dpr);
    const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, Hh);
    const [vx, vy, vw, vh] = HUD_VIEWS[HS.view], s = Math.min(W / vw, Hh / vh), ox = (W - vw * s) / 2 - vx * s, oy = (Hh - vh * s) / 2 - vy * s;
    HS.xf = { s, ox, oy };
    x.save(); x.beginPath(); x.rect((W - vw * s) / 2, (Hh - vh * s) / 2, vw * s, vh * s); x.clip();
    x.translate(ox, oy); x.scale(s, s); x.imageSmoothingEnabled = s < 1.5;
    const gr = x.createLinearGradient(0, 0, 0, HUD_H); gr.addColorStop(0, '#6f9a24'); gr.addColorStop(1, '#5d8a1c');   // a park's grass
    x.fillStyle = gr; x.fillRect(0, 0, HUD_W, HUD_H);
    x.fillStyle = '#ffffff10'; for (let i = 0; i < 400; i++) { const a = (i * 7919) % HUD_W, b = (i * 104729) % HUD_H; x.fillRect(a, b, 3, 2); }
    for (const h of HUD) {
      const [bx, by, bw, bh] = h.box;
      if (h.sliced) { const g = iconByName(h.icons[0]), src = HS.icons.get(h.icons[0]); if (g && src) { if (g.xs) drawStretched(x, src, g, bx, by, bw, bh); else x.drawImage(src, bx, by, bw, bh); } continue; }
      if (h.disc) { const d = HS.icons.get('MenuButtonSmall'); if (d) x.drawImage(d, bx, by, bw, bh); const ic = HS.icons.get(hudIcon(h)); if (ic) x.drawImage(ic, bx + 3, by + 3, 27, 27); continue; }
      if (h.text) {
        x.font = 'bold 11px Verdana, Tahoma, sans-serif'; x.textBaseline = 'middle'; x.textAlign = h.right ? 'right' : 'left';
        const tx = h.right ? bx + bw : bx, ty = by + bh / 2 + 0.5;
        x.fillStyle = '#0008'; x.fillText(h.text, tx + 1, ty + 1); x.fillStyle = '#fff'; x.fillText(h.text, tx, ty); continue;
      }
      if (h.bar) { x.fillStyle = '#cfe6f7'; x.fillRect(bx, by, bw, bh); x.fillStyle = '#1fbf2f'; x.fillRect(bx + 1, by + 1, Math.round((bw - 2) * 0.62), bh - 2); x.strokeStyle = '#2d6f9e'; x.lineWidth = 1; x.strokeRect(bx + .5, by + .5, bw - 1, bh - 1); continue; }
      const ic = HS.icons.get(hudIcon(h)); if (!ic) continue;
      x.globalAlpha = h.dim && !HS[h.dim] ? 0.3 : 1; x.drawImage(ic, bx, by, bw, bh); x.globalAlpha = 1;
    }
    HS.conEls = [];
    if (!HS.sim && HS.con.view === 'open') drawConsole(x, null, HS.conEls);
    if (HS.sim) drawHudSim(x, s);
    else for (const [h, col] of [[HS.hover, '#ffffffb0'], [HS.sel, '#f2a93b']]) if (h) { x.strokeStyle = col; x.lineWidth = 1.5 / s; x.strokeRect(h.box[0] - 1, h.box[1] - 1, h.box[2] + 2, h.box[3] + 2); }
    x.restore();
  }
  function hudSimMark() {
    const b = $('#hud-sim'); if (!b) return;
    b.textContent = HS.sim ? '■ Stop simulating' : '▶ Simulate'; b.style.cssText = HS.sim ? 'border-color:var(--accent);color:var(--accent)' : '';
  }
  function hudSimulate(on) {
    Object.assign(HS, { sim: on, fly: null, item: null, win: null, dnOpen: false, hover: null, hits: [], drag: null });
    HS.con.bottom = on || HS.con.view !== 'open' ? 0 : Math.max(HS.con.bottom, 200); HS.con.scroll = 0;
    if (on && HS.view !== 'all') { HS.view = 'all'; const v = $('#hud-view'); if (v) v.value = 'all'; }
    hudSimMark(); drawHud(); renderRight();
  }
  function hudEscape() {          // Esc: the window, then the day / night list, then the flyout
    if (!HS.sim) return false;
    if (HS.win) HS.win = null; else if (HS.dnOpen) HS.dnOpen = false; else if (HS.fly) { HS.fly = null; HS.item = null; } else { hudSimulate(false); return true; }
    drawHud(); return true;
  }
  // a window drawn as the game draws it: its inside filled with WindowBackground (white), then the game's frame
  // (GUI2Dialog_Frame, stretched: the blue title strip, the round header disc at the top left, the shadow), the
  // window's icon on that disc and the close button
  function hudWindow(x, [wx, wy, ww, wh], icon, title, sub, hits) {
    const fr = iconByName('GUI2Dialog_Frame'), src = HS.icons.get('GUI2Dialog_Frame'), bg = HS.icons.get('WindowBackground');
    if (bg) x.drawImage(bg, 1, 1, Math.max(1, bg.width - 2), Math.max(1, bg.height - 2), wx + 2, wy + 8, ww - 6, wh - 12); else { x.fillStyle = '#fff'; x.fillRect(wx + 2, wy + 8, ww - 6, wh - 12); }
    if (fr && src) drawStretched(x, src, fr, wx, wy, ww, wh); else { x.fillStyle = '#2b86c5'; x.fillRect(wx, wy, ww, 16); }
    const close = HS.icons.get('GUI2Dialog_CloseIcon'), cb = [wx + ww - 20, wy + 2, 14, 14];
    if (close) x.drawImage(close, ...cb);
    hits.push({ box: cb, label: 'Close', widget: 'GUI2Dialog_CloseIcon', icons: ['GUI2Dialog_CloseIcon'], act: () => { HS.win = null; } });
    if (title) {
      const ic = icon && HS.icons.get(icon);
      if (ic) x.drawImage(ic, wx + 11, wy + 21, 36, 36);
      if (icon) hits.push({ box: [wx + 6, wy + 16, 46, 46], label: title + ' (window icon)', widget: icon, icons: [icon] });
      x.fillStyle = '#000'; x.font = 'bold 18px Verdana, Tahoma, sans-serif'; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(title, wx + 67, wy + 29);
      x.fillRect(wx + 60, wy + 41, ww - 70, 2);
      if (sub) { x.fillStyle = '#2b86c5'; x.font = '12px Verdana, Tahoma, sans-serif'; x.fillText(sub, wx + 66, wy + 54); }
    }
  }
  const hudNote = (x, text, cx, cy, w) => {
    x.fillStyle = '#7a8a99'; x.font = 'italic 12px Verdana, Tahoma, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const words = text.split(' '); let line = '', y = cy;
    for (const wd of words) { if (x.measureText(line + wd).width > w && line) { x.fillText(line.trim(), cx, y); line = ''; y += 16; } line += wd + ' '; }
    x.fillText(line.trim(), cx, y);
  };
  function drawHudSim(x, s) {
    const hits = [];
    const disc = (box, icon, big) => {
      const [bx, by, bw, bh] = box, k = big ? 1.35 : 1, cx = bx + bw / 2, cy = by + bh / 2, d = HS.icons.get('MenuButtonSmall'), ic = HS.icons.get(icon);
      if (d) x.drawImage(d, cx - bw * k / 2, cy - bh * k / 2, bw * k, bh * k);
      if (ic) x.drawImage(ic, cx - 13.5 * k, cy - 13.5 * k - 0.5, 27 * k, 27 * k);
    };
    // the top bar's pieces and the left buttons are the screen's own (drawn already); here they get their actions
    for (const h of HUD) {
      const act = h.speed != null ? () => { HS.speed = h.speed; const v = $('#hud-speed'); if (v) v.value = String(h.speed); }
        : h.id === 'dn' ? () => { HS.dnOpen = !HS.dnOpen; }
        : h.id === 'obj' ? () => { HS.win = { kind: 'objectives' }; }
        : h.id === 'avatar' ? () => { HS.toggles.has('avatar') ? HS.toggles.delete('avatar') : HS.toggles.add('avatar'); }
        : h.disc ? () => {
          const id = h.id;
          if (id === 'l0') { HS.fly = null; HS.win = HS.win?.kind === 'map' ? null : { kind: 'map' }; return; }
          if (id === 'l3') { HS.fly = null; HS.win = { kind: 'quit' }; return; }
          if (id === 'l8') { HS.fly = HS.fly === id ? null : id; HS.item = null; HS.win = HS.fly ? { kind: 'tool', icon: 'Obj_Paths', title: tipOf('Obj_Paths') } : null; return; }
          HS.fly = HS.fly === id ? null : id; HS.item = null;
        } : null;
      hits.push(Object.assign(Object.create(h), { act }));
    }
    // the left button in use, larger
    const open = HUD.find(h => h.id === HS.fly);
    if (open) disc(open.box, hudIcon(open), true);
    // its flyout
    if (HS.fly && FLY[HS.fly]) flyBoxes(HS.fly).forEach((box, k) => {
      const [icon, kind, alt] = FLY[HS.fly][k], shown = kind === 'toggle' && HS.toggles.has(icon) ? alt : icon;
      disc(box, shown, HS.item === k || HS.hover?.key === 'f' + k);
      hits.push({ box, label: tipOf(icon), widget: shown, icons: alt ? [shown, shown === icon ? alt : icon, 'MenuButtonSmall'] : [icon, 'MenuButtonSmall'], flyK: k, act: () => {
        if (kind === 'toggle') { HS.toggles.has(icon) ? HS.toggles.delete(icon) : HS.toggles.add(icon); return; }
        HS.item = HS.item === k && kind === 'mode' ? null : k;
        HS.win = kind === 'mode' ? null : HS.item == null ? null : { kind, icon, title: tipOf(icon), at: box[1] + box[3] / 2 };
      } });
    });
    // the day / night list under its button
    if (HS.dnOpen) HUD.find(h => h.id === 'dn').icons.forEach((n, k) => {
      const box = [327 - 8 * k, 24 + 16 * k, 16, 16], ic = HS.icons.get(n);
      if (ic) x.drawImage(ic, ...box);
      hits.push({ box, label: spaced(n.split('_').pop()), widget: n, icons: [n], act: () => { HS.dn = n; HS.dnOpen = false; const v = $('#hud-dn'); if (v) v.value = n; } });
    });
    // the message console (under the windows)
    drawConsole(x, hits, null);
    // the window it opened, where it was dragged to (windows, the quit dialog and the build lists move by their blue
    // title strip in the game; the round tool panels stay put)
    const w = HS.win, wdx = w?.dx || 0, wdy = w?.dy || 0, h0 = hits.length;
    const strip = (box, label) => hits.push({ key: 'winDrag', box, label: label || 'Drag to move', drag: 'win' });
    x.save(); x.translate(wdx, wdy);
    if (w?.kind === 'picker') {
      // centred on its button, kept on screen (Track import 185-500 for its button at 344, Animals 265-582 at 424)
      const oy = w.at == null ? 0 : Math.max(0, Math.min(800 - 318, Math.round(w.at - 159)));
      strip([84, oy, 260, 44]);
      x.save(); x.translate(0, oy);
      x.fillStyle = '#0004'; x.beginPath(); x.roundRect(88, 4, 288, 318, 10); x.fill();
      x.fillStyle = '#4aa8e0'; x.beginPath(); x.roundRect(84, 0, 288, 318, 10); x.fill();
      const close = HS.icons.get('GUI2Dialog_CloseIcon'); if (close) x.drawImage(close, 350, 6, 14, 14);
      hits.push({ box: [350, 6 + oy, 14, 14], label: 'Close', widget: 'GUI2Dialog_CloseIcon', icons: ['GUI2Dialog_CloseIcon'], act: () => { HS.win = null; HS.item = null; } });
      x.fillStyle = '#fff'; x.fillRect(90, 46, 258, 224); x.fillStyle = '#efe9f2'; for (let r = 0; r < 4; r += 2) x.fillRect(90, 46 + 68 * r, 258, 68);
      x.fillStyle = '#4aa8e0'; x.fillRect(352, 46, 13, 224);
      const ic = HS.icons.get(w.icon); if (ic) x.drawImage(ic, 92, 6, 32, 32);
      x.fillStyle = '#000'; x.font = 'bold 13px Verdana, Tahoma, sans-serif'; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(w.title, 130, 22);
      hudNote(x, w.icon === 'Obj_Rides_TrackImport'
        ? 'The game lists track designs from earlier RollerCoaster Tycoon games here, from the drive picked at the top.'
        : `The game lists the ${w.title.toLowerCase()} you can build here: a picture, name, designs and price for each.`, 219, 140, 230);
      x.restore();
    } else if (w?.kind === 'dialog') {
      strip([400, 170, 440, 16]);
      hudWindow(x, [400, 170, 477, 335], w.icon, w.title, null, hits);
      hudNote(x, `The game's ${w.title} window: its tabs, lists and settings are drawn by the game's code here.`, 638, 340, 400);
    } else if (w?.kind === 'objectives') {
      strip([400, 170, 440, 16]);
      hudWindow(x, [400, 170, 477, 460], 'Man_Objectives', tipOf('obj'), null, hits);
      x.fillStyle = '#000'; x.font = 'bold 22px Verdana, Tahoma, sans-serif'; x.textAlign = 'left'; x.fillText(HS.career ? 'Career scenario' : 'Sandbox', 409, 256);
      HUD.find(h => h.id === 'obj').icons.forEach((n, k) => {
        const y = 320 + 33 * k; x.fillStyle = '#e4e4e4'; x.fillRect(409, y, 456, 31);
        const ic = HS.icons.get(n); if (ic) x.drawImage(ic, 420, y + 1, 30, 30);
        x.fillStyle = '#000'; x.font = 'bold 17px Verdana, Tahoma, sans-serif'; x.fillText(n.split('_').pop(), 456, y + 16);
        hits.push({ box: [420, y + 1, 30, 30], label: n.split('_').pop() + ' hat', widget: n, icons: [n], act: () => { HS.hat = n; const v = $('#hud-hat'); if (v) v.value = n; } });
      });
    } else if (w?.kind === 'map') {
      strip([64, 0, 330, 16]);
      hudWindow(x, [64, 0, 370, 368], 'Map', HS.texts?.get('MapDialog_Title') ?? 'Maps', HS.texts?.get('MapDialog_PeopleTabTitle') ?? 'Peeps', hits);
      x.fillStyle = '#8fae44'; x.fillRect(135, 70, 288, 288);
      x.fillStyle = '#aaa'; x.fillRect(274, 280, 6, 70);
      ['Map_Scenery', 'Map_Attractions', 'Map_People'].forEach((n, k) => {
        const box = [81, 245 + 40 * k, 32, 32], ic = HS.icons.get(n); if (ic) x.drawImage(ic, ...box);
        hits.push({ box, label: 'Map tab: ' + n.split('_').pop(), widget: n, icons: [n] });
      });
    } else if (w?.kind === 'tool') {
      x.fillStyle = '#2b86c5'; x.beginPath(); x.arc(78, 718, 66, 0, 7); x.fill();
      const right = TOOL_RIGHT[w.icon] ?? 362;
      x.fillStyle = '#4aa8e0'; x.beginPath(); x.roundRect(70, 655, right - 70, 128, 12); x.fill();
      x.fillStyle = '#f4f2f7'; x.beginPath(); x.roundRect(172, 672, right - 190, 106, 10); x.fill();
      x.fillStyle = '#8a8a8a'; x.beginPath(); x.arc(78, 718, 54, 0, 7); x.fill();
      const ic = HS.icons.get(w.icon); if (ic) x.drawImage(ic, 62, 702, 32, 32);
      x.fillStyle = '#000'; x.font = 'bold 12px Verdana, Tahoma, sans-serif'; x.textAlign = 'left'; x.fillText(w.title, 180, 686);
      hudNote(x, 'The game puts this tool\'s buttons here.', 258, 728, 150);
      hits.push({ box: [12, 652, 132, 132], label: w.title + ' panel', widget: w.icon, icons: [w.icon] });
    } else if (w?.kind === 'quit') {
      const fr = iconByName('GUI2MiniDialog_Frame'), src = HS.icons.get('GUI2MiniDialog_Frame'), b = [490, 340, 300, 110];
      strip([490, 340, 270, 17]);
      x.fillStyle = '#0005'; x.fillRect(b[0] + 4, b[1] + 4, b[2], b[3]);
      const mb = iconByName('GUI2MiniDialog_Background'), msrc = HS.icons.get('GUI2MiniDialog_Background');
      if (mb && msrc && mb.xs) drawStretched(x, msrc, mb, b[0] + 2, b[1] + 2, b[2] - 4, b[3] - 4); else { x.fillStyle = '#fff'; x.fillRect(b[0] + 2, b[1] + 2, b[2] - 4, b[3] - 4); }
      if (fr && src && fr.xs) drawStretched(x, src, fr, ...b);
      x.fillStyle = '#000'; x.font = 'bold 14px Verdana, Tahoma, sans-serif'; x.textAlign = 'center'; x.fillText(tipOf(HS.career ? 'File_CareerMap' : 'File_Quit') + '?', 640, 375);
      for (const [n, bx, act] of [['GUI2MiniDialog_Confirm', 600, () => { HS.win = { kind: 'left', title: tipOf(HS.career ? 'File_CareerMap' : 'File_Quit') }; }], ['GUI2MiniDialog_Cancel', 665, () => { HS.win = null; }]]) {
        const ic = HS.icons.get(n); if (ic) x.drawImage(ic, bx, 405, 15 * 1.6, 12 * 1.6);
        hits.push({ box: [bx - 4, 400, 32, 28], label: n.split('_').pop(), widget: n, icons: [n], act });
      }
    } else if (w?.kind === 'left') {
      x.fillStyle = '#000b'; x.fillRect(0, 0, HUD_W, HUD_H);
      x.fillStyle = '#fff'; x.font = 'bold 24px Verdana, Tahoma, sans-serif'; x.textAlign = 'center'; x.fillText(w.title, 640, 380);
      x.fillStyle = '#ccc'; x.font = '14px Verdana, Tahoma, sans-serif'; x.fillText('(the game leaves the park here) · click or press Esc to go back', 640, 412);
      hits.push({ box: [0, 0, HUD_W, HUD_H], label: '', act: () => { HS.win = null; } });
    }
    x.restore();
    if (w?.kind === 'tool' || w?.kind === 'left') { if (wdx || wdy) { w.dx = 0; w.dy = 0; } }   // tool panels don't move
    else for (const t of hits.slice(h0)) t.box = [t.box[0] + wdx, t.box[1] + wdy, t.box[2], t.box[3]];
    HS.hits = hits;
    // the tooltip of what is under the pointer, below and to the right of it as the game draws it
    for (const t of hits) t.key = t.key || (t.flyK != null ? 'f' + t.flyK : t.id || t.label + t.box.join());
    const h = HS.hover && hits.find(t => t.key === HS.hover.key);
    const tip = !h ? '' : h.flyK != null ? tipOf(FLY[HS.fly][h.flyK][0]) : h.disc ? tipOf(hudIcon(h)) : h.id === 'weather' ? tipOf(HS.weather) : h.tipKey ? (HS.texts?.get(h.tipKey) || h.label) : h.id && TIPS[h.id] ? tipOf(h.id) : '';
    if (tip) {
      x.font = '11px Verdana, Tahoma, sans-serif'; const tw = x.measureText(tip).width + 14, tx = Math.min(HUD_W - tw - 4, h.box[0] + h.box[2] / 2 + 2), ty = h.box[1] + h.box[3] + 4;
      x.fillStyle = '#1e6aa8'; x.beginPath(); x.roundRect(tx - 1, ty - 1, tw + 4, 22, 9); x.fill();
      x.fillStyle = '#fff'; x.beginPath(); x.roundRect(tx, ty, tw, 18, 8); x.fill();
      x.fillStyle = '#000'; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(tip, tx + 7, ty + 9.5);
    }
    if (HS.toggles.has('avatar')) { const a = HUD.find(e => e.id === 'avatar'); x.strokeStyle = '#ffe14a'; x.lineWidth = 2; x.strokeRect(a.box[0] - 1, a.box[1] - 1, a.box[2] + 2, a.box[3] + 2); }
  }

  const FRAME_TYPES = { 2: 'Panel (3 × 3 parts)', 3: 'Window frame (3 × 3 parts)', 4: 'Bar (3 parts across)', 5: 'Bar (3 parts down)', 1: 'Solid colour' };
  const sliced = g => !!g.xs;     // panels, frames and bars: they move with all their cuts, only plain icons resize

  // ---- left list --------------------------------------------------------------------------------------------------
  const ifaceTex = t => /^(FrontEnd|GUI|Loading|Banner|AOP_Glyph|SystemFont|StaffIcons|TerrainIcons|CrossHair|StandardAd)/i.test(t.n) || /^gui\\/i.test(t.p);
  function renderLeft() {
    const q = $('#gu-q', P.left).value.trim().toLowerCase(), cat = S.gui;
    if (!cat) return;
    const main = cat.icons.filter(o => /^main\.common/i.test(o.path) || /^gui\\/i.test(o.path));
    const objs = cat.icons.filter(o => !main.includes(o));
    const sel = p => G.ovl === p ? ' sel' : '';
    let h = '<div class="grp">Main menus</div>';
    if (!q || 'front screen main menu designer layout buttons'.includes(q))
      h += `<div class="li${G.front ? ' sel' : ''}" data-front="1">🎛 Front screen designer<small>menus</small></div>`;
    h += '<div class="grp">Game interface</div>';
    for (const o of main) if (!q || o.path.toLowerCase().includes(q) || 'interface menus icons'.includes(q))
      h += `<div class="li${sel(o.path)}" data-ovl="${esc(o.path)}">${o.path.startsWith('Main') ? '🖥 Main interface' : esc(o.path.replace(/^gui\\/, '').replace(/\\[^\\]*\.common\.ovl$/i, '').replace(/\\/g, ' › '))}<small>${o.n} icons</small></div>`;
    const screens = S.cat.filter(t => ifaceTex(t) && (!q || t.n.toLowerCase().includes(q)));
    h += '<div class="grp">Menu screens, sheets &amp; fonts</div>';
    h += screens.slice(0, q ? 200 : 80).map(t => `<div class="li" data-tex="${esc(t.p)}|${esc(t.n + ':' + t.t)}">🖼 ${esc(t.n)}<small>${t.w}×${t.h}</small></div>`).join('');
    h += '<div class="grp">Menu text</div>';
    h += cat.texts.filter(o => !q || o.path.toLowerCase().includes(q)).map(o => `<div class="li${G.lang === o.path ? ' sel' : ''}" data-lang="${esc(o.path)}">🔤 ${esc(o.path.replace(/^gui\\/, '').replace(/\.common\.ovl$/i, ''))}<small>${o.n.toLocaleString()} texts</small></div>`).join('');
    h += `<div class="grp">Object icons <span style="text-transform:none;color:var(--dim)">(${objs.length.toLocaleString()} files)</span></div>`;
    const shownObjs = objs.filter(o => !q || o.path.toLowerCase().includes(q));
    let folder = '';
    for (const o of shownObjs.slice(0, q ? 400 : 250)) {
      const f = folderOf(o.path); if (f !== folder) { folder = f; h += `<div style="padding:6px 12px 2px;color:var(--dim);font-size:11px">${esc(f)}</div>`; }
      h += `<div class="li${sel(o.path)}" data-ovl="${esc(o.path)}">${esc(o.path.replace(/\.common\.ovl$/i, '').split('\\').slice(1).join(' › ') || o.path)}<small>${o.n}</small></div>`;
    }
    if (shownObjs.length > (q ? 400 : 250)) h += `<div class="note" style="padding:6px 12px;color:var(--dim)">${shownObjs.length - (q ? 400 : 250)} more - search to narrow</div>`;
    $('#gu-list', P.left).innerHTML = h;
  }
  $('#gu-q', P.left).addEventListener('input', renderLeft);
  $('#gu-list', P.left).onclick = e => {
    const d = e.target.closest('.li'); if (!d) return;
    if (d.dataset.front) openFront();
    else if (d.dataset.ovl) openOvl(d.dataset.ovl);
    else if (d.dataset.tex) { const [p, n] = d.dataset.tex.split('|'); openTexture(p, n); }
    else if (d.dataset.lang) openTexts(d.dataset.lang);
  };

  // ---- an OVL's icons -----------------------------------------------------------------------------------------------
  async function sheetCanvas(path, name) {
    const k = path + '|' + name.toLowerCase();
    if (!G.sheets.has(k)) G.sheets.set(k, (async () => {
      const img = await loadImage(imgUrl(path, name) + '&t=' + Date.now());
      const c = canvasOf(img.width, img.height); c.getContext('2d').drawImage(img, 0, 0); return c;
    })());
    return G.sheets.get(k);
  }
  function sheetsOf(icons) {
    const m = new Map();
    for (const g of icons) { if (!g.texture || !g.sheet) continue; const k = g.sheet + '|' + g.texture; if (!m.has(k)) m.set(k, { path: g.sheet, name: g.texture, icons: [] }); m.get(k).icons.push(g); }
    return [...m.values()].sort((a, b) => b.icons.length - a.icons.length);
  }
  async function openOvl(path, focus) {
    if (G.moved.size && !await confirmBox('Unsaved rectangles', 'Some icon rectangles were moved but not saved. Leave them?', 'Leave')) return;
    G.moved.clear();
    G.ovl = path; G.lang = null; G.texts = null; G.front = false; renderLeft();
    $('#gu-empty', P.centre).style.display = ''; $('#gu-empty', P.centre).textContent = 'Loading icons…';
    const icons = await fetch('/api/tx/icons?path=' + encodeURIComponent(path)).then(r => r.json());
    if (G.ovl !== path) return;                        // something else was opened meanwhile
    G.icons = icons;
    G.groups = { sheets: sheetsOf(G.icons), states: stateGroups(G.icons), anims: animGroups(G.icons), frames: G.icons.filter(g => g.type >= 2 && g.type <= 5) };
    G.sheet = G.groups.sheets[0] || null;
    $('#gu-empty', P.centre).style.display = G.sheet ? 'none' : '';
    if (!G.sheet) $('#gu-empty', P.centre).textContent = 'No icons with a picture in this file.';
    G.sel = focus ? G.icons.find(g => g.name === focus) || null : null;
    if (G.sel) G.sheet = G.groups.sheets.find(s => s.icons.includes(G.sel)) || G.sheet;
    HS.sel = null; HS.icons.clear();
    setView(isMain() && !focus ? 'hud' : 'sheet');
  }
  const isMain = () => /^main\.common\.ovl$/i.test(G.ovl || '');
  function renderTabs() {
    const t = $('#gu-tabs', P.centre);
    if (G.lang) { t.innerHTML = `<span class="title">Menu text · ${esc(G.lang.replace(/^gui\\/, '').replace(/\.common\.ovl$/i, ''))}</span>`; return; }
    if (G.front || !G.ovl) { t.innerHTML = ''; t.style.display = G.front ? 'none' : ''; return; }
    t.style.display = '';
    const g = G.groups, b = (v, label, n) => `<button data-v="${v}" class="${G.view === v ? 'on' : ''}" ${n === 0 ? 'disabled' : ''}>${label}${n != null ? ` <small>${n}</small>` : ''}</button>`;
    t.innerHTML = `<span class="title">${esc(G.ovl.replace(/\.common\.ovl$/i, ''))}</span>
      ${isMain() ? b('hud', 'In-park screen') : ''}${b('sheet', 'Icon sheets', g.sheets.length)}${b('gallery', 'All icons', G.icons.length)}${b('states', 'Button states', g.states.length)}${b('anims', 'Animations', g.anims.length)}${b('frames', 'Window frames', g.frames.length)}
      <span style="flex:1"></span>${G.view === 'sheet' && g.sheets.length > 1 ? `<select id="gu-sheet">${g.sheets.map((s, i) => `<option value="${i}" ${s === G.sheet ? 'selected' : ''}>${esc(s.name.split(':')[0])} (${s.icons.length})</option>`).join('')}</select>` : ''}
      ${G.view === 'sheet' ? '<button id="gu-fit">Fit</button>' : ''}`;
    t.querySelectorAll('button[data-v]').forEach(x => { x.style.cssText = x.classList.contains('on') ? 'border-color:var(--accent);color:var(--accent)' : ''; x.onclick = () => setView(x.dataset.v); });
    $('#gu-sheet', t)?.addEventListener('change', e => { G.sheet = g.sheets[+e.target.value]; showSheet(); });
    $('#gu-fit', t)?.addEventListener('click', () => view.fit());
  }
  function setView(v) {
    G.view = v; renderTabs();
    const panel = $('#gu-panel', P.centre);
    stopAnim();
    if (v === 'sheet') { panel.style.display = 'none'; cv.style.display = ''; showSheet(); }
    else { cv.style.display = 'none'; panel.style.display = ''; panel.innerHTML = ''; ({ hud: showHud, gallery: showGallery, states: showStates, anims: showAnims, frames: showFrames })[v](panel); }
    renderRight();
  }

  // ---- sheet view: every icon's rectangle, drag to move, handles to resize -----------------------------------------
  let sheetCv = null;
  async function showSheet(keepView) {
    if (!G.sheet) return;
    sheetCv = await sheetCanvas(G.sheet.path, G.sheet.name);
    view.setSize(sheetCv.width, sheetCv.height);
    if (!keepView) { view.fit(); if (G.sel && G.sheet.icons.includes(G.sel)) view.zoomTo(rectOf(G.sel), 0.6, 6); }
    view.redraw(); renderRight();
  }
  const rectOf = g => G.moved.get(g.name) || g.rect;
  let hover = null, drag = null;
  function drawSheet(ctx, v) {
    if (!sheetCv || G.view !== 'sheet') return;
    ctx.drawImage(sheetCv, v.ox, v.oy, sheetCv.width * v.z, sheetCv.height * v.z);
    ctx.lineWidth = 1;
    for (const g of G.sheet.icons) {
      const r = rectOf(g); if (!r) continue;
      const s = g === G.sel, h = g === hover;
      ctx.strokeStyle = s ? '#f2a93b' : h ? '#fff' : G.moved.has(g.name) ? '#7f7' : 'rgba(120,200,255,.5)';
      ctx.lineWidth = s ? 2 : 1;
      ctx.strokeRect(Math.round(v.sx(r[0])) + .5, Math.round(v.sy(r[1])) + .5, Math.round((r[2] - r[0]) * v.z) - 1, Math.round((r[3] - r[1]) * v.z) - 1);
      if (s && sliced(g)) {             // where the game cuts it
        const dx = r[0] - g.rect[0], dy = r[1] - g.rect[1];
        ctx.setLineDash([3, 3]); ctx.strokeStyle = '#f2a93bb0'; ctx.lineWidth = 1; ctx.beginPath();
        for (const x of g.xs.slice(1, -1)) { ctx.moveTo(Math.round(v.sx(x + dx)) + .5, v.sy(r[1])); ctx.lineTo(Math.round(v.sx(x + dx)) + .5, v.sy(r[3])); }
        for (const y of g.ys.slice(1, -1)) { ctx.moveTo(v.sx(r[0]), Math.round(v.sy(y + dy)) + .5); ctx.lineTo(v.sx(r[2]), Math.round(v.sy(y + dy)) + .5); }
        ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if (G.sel && G.sheet.icons.includes(G.sel) && !sliced(G.sel)) for (const [hx, hy] of handles(rectOf(G.sel))) {
      ctx.fillStyle = '#f2a93b'; ctx.fillRect(v.sx(hx) - 4, v.sy(hy) - 4, 8, 8);
    }
    const t = hover || G.sel;
    if (t) {
      const r = rectOf(t), s = spaced(t.name); ctx.font = '12px system-ui'; const w = ctx.measureText(s).width + 10;
      ctx.fillStyle = '#000c'; ctx.fillRect(v.sx(r[0]), v.sy(r[1]) - 18, w, 17); ctx.fillStyle = '#f2a93b'; ctx.fillText(s, v.sx(r[0]) + 5, v.sy(r[1]) - 5);
    }
  }
  const handles = r => { const [l, t, rr, b] = r, mx = (l + rr) / 2, my = (t + b) / 2; return [[l, t], [mx, t], [rr, t], [rr, my], [rr, b], [mx, b], [l, b], [l, my]]; };
  const HANDLE_EDGES = ['lt', 't', 'rt', 'r', 'rb', 'b', 'lb', 'l'];
  function hit(x, y) {
    if (G.sel && G.sheet.icons.includes(G.sel) && !sliced(G.sel)) {
      const hs = handles(rectOf(G.sel)), k = hs.findIndex(([hx, hy]) => Math.abs(view.sx(hx) - view.sx(x)) < 7 && Math.abs(view.sy(hy) - view.sy(y)) < 7);
      if (k >= 0) return { g: G.sel, edge: HANDLE_EDGES[k] };
    }
    const inside = G.sheet.icons.filter(g => { const r = rectOf(g); return r && x >= r[0] && x < r[2] && y >= r[1] && y < r[3]; });
    inside.sort((a, b) => { const ra = rectOf(a), rb = rectOf(b); return (ra[2] - ra[0]) * (ra[3] - ra[1]) - (rb[2] - rb[0]) * (rb[3] - rb[1]); });
    return inside[0] ? { g: inside[0], edge: 'move' } : null;
  }
  cv.addEventListener('pointermove', e => {
    if (!sheetCv || G.view !== 'sheet') return;
    const [x, y] = view.toImage(e);
    $('#gu-status', P.centre).textContent = `x ${Math.floor(x)}  y ${Math.floor(y)}   ${hover ? hover.name + ' ' + rectOf(hover).join(', ') : ''}   zoom ${Math.round(view.z * 100)}%`;
    if (drag) {
      const dx = Math.round(x - drag.x0), dy = Math.round(y - drag.y0), r0 = drag.r0, r = [...r0], e2 = drag.edge;
      if (e2 === 'move') { r[0] += dx; r[2] += dx; r[1] += dy; r[3] += dy; }
      if (e2.includes('l')) r[0] = Math.min(r0[0] + dx, r0[2] - 1); if (e2.includes('r')) r[2] = Math.max(r0[2] + dx, r0[0] + 1);
      if (e2.includes('t')) r[1] = Math.min(r0[1] + dy, r0[3] - 1); if (e2.includes('b')) r[3] = Math.max(r0[3] + dy, r0[1] + 1);
      const W = sheetCv.width, H = sheetCv.height;
      if (e2 === 'move') { const sx = clamp(r[0], 0, W - (r0[2] - r0[0])) - r[0], sy = clamp(r[1], 0, H - (r0[3] - r0[1])) - r[1]; r[0] += sx; r[2] += sx; r[1] += sy; r[3] += sy; }
      else { r[0] = clamp(r[0], 0, W); r[2] = clamp(r[2], 0, W); r[1] = clamp(r[1], 0, H); r[3] = clamp(r[3], 0, H); }
      if (r.join() !== drag.g.rect.join()) G.moved.set(drag.g.name, r); else G.moved.delete(drag.g.name);
      view.redraw(); renderRight(); return;
    }
    const h = hit(x, y);
    const nh = h?.g || null; if (nh !== hover) { hover = nh; view.redraw(); }
    cv.style.cursor = !h ? 'default' : h.edge === 'move' ? (h.g === G.sel ? 'move' : 'pointer') : ({ lt: 'nwse', rb: 'nwse', rt: 'nesw', lb: 'nesw', l: 'ew', r: 'ew', t: 'ns', b: 'ns' })[h.edge] + '-resize';
  });
  cv.addEventListener('pointerdown', e => {
    if (!sheetCv || G.view !== 'sheet' || e.button !== 0) return;
    const [x, y] = view.toImage(e), h = hit(x, y);
    if (!h) { G.sel = null; view.redraw(); renderRight(); return; }
    if (h.g !== G.sel) { G.sel = h.g; view.redraw(); renderRight(); return; }
    drag = { g: h.g, edge: sliced(h.g) ? 'move' : h.edge, x0: x, y0: y, r0: [...rectOf(h.g)] }; cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('dblclick', e => { if (G.sel) openTexture(G.sheet.path, G.sheet.name, { rect: rectOf(G.sel) }); });
  addEventListener('pointerup', () => { drag = null; });
  async function saveRects() {
    const list = [...G.moved];
    if (!list.length) return;
    if (!S.edits[G.ovl] && !await confirmBox('Save into the game', `This writes ${list.length} icon rectangle${list.length > 1 ? 's' : ''} into <b>${esc(G.ovl)}</b>. The original file is copied first; <b>Changed files</b> at the top right puts it back. Close the game before saving.`, 'Save into game')) return;
    try {
      for (const [name, rect] of list) {
        const r = await post('/api/tx/rect', { path: G.ovl, name, rect });
        const g = G.icons.find(x => x.name === name); if (g) { g.rect = r.rect; if (r.xs) { g.xs = r.xs; g.ys = r.ys; } }
        G.moved.delete(name);
      }
      const r = await fetch('/api/tx/gui').then(r => r.json()); setEdits(r.edits);
      toast(`Saved ${list.length} rectangle${list.length > 1 ? 's' : ''} into ${G.ovl}`);
    } catch (e) { toast('Could not save: ' + e.message, true); }
    view.redraw(); renderRight();
  }

  // ---- gallery / states / animations / frames ------------------------------------------------------------------
  async function iconCanvas(g, scale = 1) {
    const r = rectOf(g); if (!r || !g.sheet) return canvasOf(1, 1);
    const sh = await sheetCanvas(g.sheet, g.texture), w = Math.max(1, r[2] - r[0]), h = Math.max(1, r[3] - r[1]), c = canvasOf(w * scale, h * scale), x = c.getContext('2d');
    x.imageSmoothingEnabled = false; x.drawImage(sh, r[0], r[1], w, h, 0, 0, w * scale, h * scale); return c;
  }
  function showGallery(el) {
    el.innerHTML = '<div class="gallery" id="gu-gal"></div>';
    const gal = $('#gu-gal', el);
    const q = $('#gu-q', P.left).value.trim().toLowerCase();
    for (const g of G.icons.filter(g => !q || g.name.toLowerCase().includes(q)).slice(0, 1500)) {
      const d = document.createElement('div'); d.className = 'g' + (g === G.sel ? ' sel' : ''); d.title = g.name + (g.rect ? ` (${g.rect.join(', ')})` : '');
      d.innerHTML = `<div style="height:72px;display:flex;align-items:center;justify-content:center"></div><div>${esc(spaced(g.name))}</div>`;
      iconCanvas(g).then(c => d.firstChild.appendChild(c));
      d.onclick = () => { G.sel = g; gal.querySelectorAll('.g').forEach(x => x.classList.toggle('sel', x === d)); renderRight(); };
      d.ondblclick = () => { G.sheet = G.groups.sheets.find(s => s.icons.includes(g)) || G.sheet; setView('sheet'); };
      gal.appendChild(d);
    }
  }
  function showStates(el) {
    const ORDER = ['Up', 'Normal', 'Over', 'Hover', 'Highlight', 'Highlighted', 'Pressed', 'Down', 'Selected', 'Active', 'On', 'Off', 'Inactive', 'Focus', 'NoFocus', 'Disabled', 'Grey', 'Colour'];
    el.innerHTML = `<div class="panelview"><div class="note" style="color:var(--dim);margin-bottom:12px">Each button below is played with its own pictures: point at it (hover), press it, and tick <b>Disabled</b> to see that state. Click a state picture to select it.</div><div id="gu-states"></div></div>`;
    const box = $('#gu-states', el);
    for (const grp of G.groups.states) {
      const sec = document.createElement('div'); sec.style.cssText = 'border-bottom:1px solid var(--line);padding:10px 0 14px';
      const names = Object.keys(grp.states).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
      sec.innerHTML = `<div style="font-weight:600;margin-bottom:8px">${esc(spaced(grp.name))} <label style="color:var(--dim);font-weight:400;margin-left:10px"><input type="checkbox" class="dis"> Disabled</label></div>
        <div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap"><div class="mock"></div><div class="row2"></div></div>`;
      box.appendChild(sec);
      const pick = s => grp.states[s];
      const normal = pick('Up') || pick('Normal') || pick('Off') || pick('Inactive') || grp.states[names[0]];
      const over = pick('Over') || pick('Hover') || pick('Highlight') || pick('Highlighted') || normal;
      const press = pick('Pressed') || pick('Down') || pick('Selected') || pick('Active') || pick('On') || over;
      const dis = pick('Disabled') || pick('Grey');
      if (!dis) sec.querySelector('.dis').parentElement.style.display = 'none';
      const mock = sec.querySelector('.mock');
      Promise.all([normal, over, press, dis].map(g => g ? iconCanvas(g, 2) : null)).then(([n, o, p, d]) => {
        const c = canvasOf(n.width, n.height), x = c.getContext('2d'); mock.appendChild(c);
        let state = n; const show = s => { state = s || n; c.width = state.width; c.height = state.height; x.drawImage(state, 0, 0); };
        const disabled = () => sec.querySelector('.dis').checked && d;
        show(n);
        c.onpointerenter = () => !disabled() && show(o); c.onpointerleave = () => show(disabled() ? d : n);
        c.onpointerdown = () => !disabled() && show(p); c.onpointerup = () => !disabled() && show(o);
        sec.querySelector('.dis').onchange = () => show(disabled() ? d : n);
      });
      const row = sec.querySelector('.row2');
      for (const s of names) {
        const g = grp.states[s], d = document.createElement('div'); d.className = 'state'; d.title = g.name;
        iconCanvas(g, 1).then(c => d.prepend(c)); d.insertAdjacentHTML('beforeend', `<small>${esc(s)}</small>`);
        d.onclick = () => { G.sel = g; renderRight(); };
        row.appendChild(d);
      }
    }
  }
  let animT = 0;
  function stopAnim() { if (animT) { clearInterval(animT); animT = 0; } }
  // ---- animations: numbered icon sets, played and edited ------------------------------------------------------
  // The game shows frame N by the icon named <set>N, so the order is changed by giving each frame another frame's
  // rectangle (saved like any moved rectangle), and a frame can show the same picture as another. Pixels are painted
  // into the frames' places on their sheets (a PNG strip, an animated GIF or one picture per frame). How fast a set
  // plays is up to the game's code, not the file: the speed here is only for the preview.
  const animPrefs = new Map();
  function setAnimRects(a, rects) {
    a.frames.forEach((g, i) => { const r = rects[i]; if (r.join() !== g.rect.join()) G.moved.set(g.name, [...r]); else G.moved.delete(g.name); });
    const sc = $('#gu-panel .panelview', P.centre)?.scrollTop || 0; setView('anims'); const pv = $('#gu-panel .panelview', P.centre); if (pv) pv.scrollTop = sc;
  }
  function placeRect(r) { return { x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]), w: Math.abs(r[2] - r[0]), h: Math.abs(r[3] - r[1]), fx: r[2] < r[0], fy: r[3] < r[1] }; }
  // paint pictures into icons' places on their sheets and save the sheets into the game
  async function writeIcons(items, what) {
    if (items.some(it => G.moved.has(it.g.name))) { toast('Save or undo the moved rectangles of these frames first', true); return false; }
    const bySheet = new Map();
    for (const it of items) { if (!it.g.sheet || !it.g.texture) continue; const k = it.g.sheet + '|' + it.g.texture; if (!bySheet.has(k)) bySheet.set(k, []); bySheet.get(k).push(it); }
    const files = [...new Set([...bySheet.keys()].map(k => k.split('|')[0]))];
    if (files.some(f => !S.edits[f]) && !await confirmBox('Save into the game', `This paints ${esc(what)} into ${files.map(f => '<b>' + esc(f) + '</b>').join(', ')} (${[...bySheet.keys()].map(k => esc(k.split('|')[1].split(':')[0])).join(', ')}). Compressed sheets may shift colours very slightly.<br><br>The original file is copied first; <b>Changed files</b> at the top right puts it back. Close the game before saving.`, 'Save into game')) return false;
    try {
      for (const [k, list] of bySheet) {
        const [path, name] = k.split('|');
        const img = await loadImage(imgUrl(path, name) + '&t=' + Date.now());
        const c = canvasOf(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0);
        for (const { g, src } of list) {
          const q = placeRect(g.rect); if (!q.w || !q.h) continue;
          x.clearRect(q.x, q.y, q.w, q.h); x.save(); x.translate(q.x + (q.fx ? q.w : 0), q.y + (q.fy ? q.h : 0)); x.scale(q.fx ? -1 : 1, q.fy ? -1 : 1);
          x.imageSmoothingEnabled = src.width !== q.w || src.height !== q.h; x.drawImage(src, 0, 0, q.w, q.h); x.restore();
        }
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        await post('/api/tx/write', { path, name, frame: 0, b64: await blobB64(blob) });
        G.sheets.delete(path + '|' + name.toLowerCase());
      }
      const r = await fetch('/api/tx/gui').then(r => r.json()); setEdits(r.edits);
      toast(`Saved ${what} into the game`); return true;
    } catch (e) { toast('Could not save: ' + e.message, true); return false; }
  }
  // an animated GIF / WebP / APNG as frames (null for a still picture)
  async function decodeFrames(file) {
    if (!('ImageDecoder' in window) || !/gif|webp|png/i.test(file.type)) return null;
    try {
      const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
      await dec.tracks.ready;
      const n = dec.tracks.selectedTrack?.frameCount || 1; if (n < 2) return null;
      const out = [];
      for (let i = 0; i < n; i++) { const { image } = await dec.decode({ frameIndex: i }); const c = canvasOf(image.displayWidth, image.displayHeight); c.getContext('2d').drawImage(image, 0, 0); image.close(); out.push(c); }
      return out;
    } catch (e) { return null; }
  }
  // a still picture cut into n frames: side by side or one above the other, whichever fits the frames' shape
  function cutStrip(img, n, fw, fh) {
    const want = fw / fh, across = (img.width / n) / img.height, down = img.width / (img.height / n);
    const horiz = Math.abs(Math.log(across / want)) <= Math.abs(Math.log(down / want));
    return Array.from({ length: n }, (_, i) => { const w = horiz ? img.width / n : img.width, h = horiz ? img.height : img.height / n;
      const c = canvasOf(Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); c.getContext('2d').drawImage(img, horiz ? i * w : 0, horiz ? 0 : i * h, w, h, 0, 0, c.width, c.height); return c; });
  }
  const pickFile = accept => new Promise(res => { const f = document.createElement('input'); f.type = 'file'; f.accept = accept; f.onchange = () => res(f.files[0] || null); f.click(); });
  async function importAnim(a, file) {
    file = file || await pickFile('image/png,image/gif,image/webp'); if (!file) return;
    let frames = await decodeFrames(file);
    if (!frames) { const img = await loadImage(URL.createObjectURL(file)); const q = placeRect(a.frames[0].rect); frames = cutStrip(img, a.frames.length, q.w || 1, q.h || 1); }
    const n = Math.min(frames.length, a.frames.length);
    const shared = new Set(), seen = new Set();
    a.frames.slice(0, n).forEach((g, i) => { const k = g.rect.join(); if (seen.has(k)) shared.add(i + 1); seen.add(k); });
    if (shared.size && !await confirmBox('Frames share a picture', `Frame${shared.size > 1 ? 's' : ''} ${[...shared].join(', ')} use${shared.size > 1 ? '' : 's'} the same place on the sheet as an earlier frame, so only one of those pictures can be kept. Go on?`, 'Go on')) return;
    if (await writeIcons(a.frames.slice(0, n).map((g, i) => ({ g, src: frames[i] })), `${n} frame${n > 1 ? 's' : ''} of ${spaced(a.name)}`)) {
      if (frames.length !== a.frames.length) toast(`${file.name} has ${frames.length} frames and the set ${a.frames.length}: the first ${n} were used`);
      setView('anims');
    }
  }
  function showAnims(el) {
    el.innerHTML = `<div class="panelview"><div class="note" style="color:var(--dim);margin-bottom:12px">Icons numbered in order (State0, State1, …) that the game shows one after another. Change the order with ◀ ▶ (or drag a frame onto another), make a frame show another frame's picture, paint a frame (✎), replace it with a picture (🖼), or import the whole animation from a PNG strip (frames side by side or stacked) or an animated GIF. A new order and shared pictures are saved with <b>Save into game</b> on the right; painted pictures are saved straight away. The speed is only for this preview: the game decides how fast each set plays.</div><div id="gu-anims"></div></div>`;
    const box = $('#gu-anims', el), players = [];
    for (const a of G.groups.anims) {
      const pref = animPrefs.get(a.name) || { fps: 6, on: true, bounce: false }; animPrefs.set(a.name, pref);
      const changed = a.frames.some(g => G.moved.has(g.name));
      const sec = document.createElement('div'); sec.className = 'anim'; sec.dataset.name = a.name; sec.style.cssText = 'border-bottom:1px solid var(--line);padding:10px 0 14px';
      sec.innerHTML = `<div style="font-weight:600;margin-bottom:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">${esc(spaced(a.name))} <small style="color:var(--dim);font-weight:400">${a.frames.length} frames</small>${changed ? ' <span class="mod" title="A new order or shared pictures, not saved yet">● not saved</span>' : ''}
        <label style="color:var(--dim);font-weight:400">Speed <input type="range" min="1" max="30" value="${pref.fps}" class="fps" style="vertical-align:middle;width:90px"> <output>${pref.fps}</output>/s</label>
        <label style="color:var(--dim);font-weight:400" title="Play forwards then backwards"><input type="checkbox" class="bounce" ${pref.bounce ? 'checked' : ''}> Back and forth</label>
        <button class="pp" style="font-size:12px;padding:2px 8px">${pref.on ? '❚❚' : '▶'}</button>
        <button class="rev" style="font-size:12px;padding:2px 8px" title="Play the frames the other way round">Reverse</button>
        <button class="imp" style="font-size:12px;padding:2px 8px" title="Paint every frame from a PNG strip or an animated GIF">Import animation…</button>
        <button class="strip" style="font-size:12px;padding:2px 8px" title="Download the frames side by side as one PNG">Export strip</button></div>
        <div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap"><div class="mock"></div><div class="row2" style="display:flex;flex-wrap:wrap"></div></div>`;
      box.appendChild(sec);
      Promise.all(a.frames.map(g => iconCanvas(g, 1))).then(cs => {
        const W = Math.max(...cs.map(c => c.width)), Hh = Math.max(...cs.map(c => c.height)), sc = Math.max(1, Math.min(4, Math.floor(128 / Math.max(W, Hh))));
        const c = canvasOf(W * sc, Hh * sc), x = c.getContext('2d'); x.imageSmoothingEnabled = false; sec.querySelector('.mock').appendChild(c);
        const pl = { i: 0, dir: 1, t: 0, pref, frames: cs.length, draw() { x.clearRect(0, 0, c.width, c.height); const f = cs[this.i]; x.drawImage(f, 0, 0, f.width * sc, f.height * sc); } };
        pl.draw(); players.push(pl);
        sec.querySelector('.fps').oninput = e => { pref.fps = +e.target.value; e.target.nextElementSibling.value = e.target.value; };
        sec.querySelector('.bounce').onchange = e => { pref.bounce = e.target.checked; };
        sec.querySelector('.pp').onclick = e => { pref.on = !pref.on; e.target.textContent = pref.on ? '❚❚' : '▶'; };
        sec.querySelector('.strip').onclick = () => { const s = canvasOf(W * cs.length, Hh); cs.forEach((f, i) => s.getContext('2d').drawImage(f, i * W, 0)); s.toBlob(b => download(b, a.name + '_strip.png')); };
        const rects = () => a.frames.map(g => rectOf(g));
        sec.querySelector('.rev').onclick = () => setAnimRects(a, rects().reverse());
        sec.querySelector('.imp').onclick = () => importAnim(a);
        const row = sec.querySelector('.row2');
        const move = (i, j) => { if (j < 0 || j >= cs.length || i === j) return; const r = rects(); const [m] = r.splice(i, 1); r.splice(j, 0, m); setAnimRects(a, r); };
        cs.forEach((f, i) => {
          const g = a.frames[i], d = document.createElement('div'); d.className = 'state'; d.draggable = true; d.title = g.name + (G.moved.has(g.name) ? ' (changed, not saved)' : '');
          const k2 = Math.min(2, sc), fv = canvasOf(f.width * k2, f.height * k2), fx = fv.getContext('2d'); fx.imageSmoothingEnabled = false; fx.drawImage(f, 0, 0, fv.width, fv.height);
          d.appendChild(fv);
          const same = a.frames.findIndex(o => rectOf(o).join() === rectOf(g).join());
          d.insertAdjacentHTML('beforeend', `<small>${i + 1}${G.moved.has(g.name) ? ' <span class="mod">●</span>' : ''}</small>
            <div style="display:flex;gap:2px;justify-content:center">${[['l', '◀', 'Earlier'], ['r', '▶', 'Later'], ['e', '✎', 'Paint this frame'], ['p', '🖼', 'Replace with a picture']].map(([k, t, ti]) => `<button data-k="${k}" title="${ti}" style="font-size:10px;padding:1px 4px">${t}</button>`).join('')}</div>
            <select data-k="s" title="Show the picture of another frame" style="font-size:10px;max-width:96px"><option value="-1">Own picture</option>${a.frames.map((o, k) => k === i ? '' : `<option value="${k}" ${same === k && same < i ? 'selected' : ''}>Same as ${k + 1}</option>`).join('')}</select>`);
          d.onclick = e => {
            const k = e.target.dataset?.k;
            if (k === 'l') move(i, i - 1); else if (k === 'r') move(i, i + 1);
            else if (k === 'e') openTexture(g.sheet, g.texture, { rect: rectOf(g) });
            else if (k === 'p') pickFile('image/*').then(async file => { if (!file) return; const img = await loadImage(URL.createObjectURL(file)); if (await writeIcons([{ g, src: img }], `frame ${i + 1} of ${spaced(a.name)}`)) setView('anims'); });
            else if (k !== 's') { G.sel = g; pl.i = i; pl.draw(); renderRight(); }
          };
          d.querySelector('select').onchange = e => { const k = +e.target.value, r = rects(); r[i] = k < 0 ? [...g.rect] : [...rectOf(a.frames[k])]; setAnimRects(a, r); };
          d.ondragstart = e => { e.dataTransfer.setData('text/plain', a.name + '|' + i); };
          d.ondragover = e => e.preventDefault();
          d.ondrop = e => { e.preventDefault(); const [n, from] = e.dataTransfer.getData('text/plain').split('|'); if (n === a.name) move(+from, i); };
          row.appendChild(d);
        });
      });
    }
    let last = performance.now();
    animT = setInterval(() => {
      const now = performance.now(), dt = (now - last) / 1000; last = now;
      for (const p of players) if (p.pref.on && p.frames > 1) {
        p.t += dt; if (p.t < 1 / p.pref.fps) continue; p.t = 0;
        if (p.pref.bounce) { if (p.i + p.dir >= p.frames || p.i + p.dir < 0) p.dir = -p.dir; p.i += p.dir; } else p.i = (p.i + 1) % p.frames;
        p.draw();
      }
    }, 30);
  }
  function showFrames(el) {
    el.innerHTML = `<div class="panelview"><div class="note" style="color:var(--dim);margin-bottom:12px">Pieces the game stretches to draw windows, panels and scroll bars, cut where the game cuts them (the dashed lines on the sheet): the corners (or ends) stay as they are, the parts between are stretched. Change the size to see a window of that size.</div>
      <div style="display:flex;gap:16px;margin-bottom:12px;flex-wrap:wrap;color:var(--dim)"><label>Width <input type="range" id="fr-w" min="20" max="900" value="360"></label><label>Height <input type="range" id="fr-h" min="20" max="600" value="160"></label></div>
      <div id="gu-frames"></div></div>`;
    const box = $('#gu-frames', el), items = [];
    for (const g of G.groups.frames) {
      const r = rectOf(g), sec = document.createElement('div'); sec.style.cssText = 'border-bottom:1px solid var(--line);padding:10px 0 14px';
      sec.innerHTML = `<div style="font-weight:600;margin-bottom:8px">${esc(spaced(g.name))} <small style="color:var(--dim);font-weight:400">${esc(FRAME_TYPES[g.type] || 'type ' + g.type)} · ${r ? (r[2] - r[0]) + '×' + (r[3] - r[1]) : ''}</small></div><div class="mock"></div>`;
      box.appendChild(sec); sec.onclick = () => { G.sel = g; renderRight(); };
      iconCanvas(g, 1).then(src => { const c = canvasOf(10, 10); sec.querySelector('.mock').appendChild(c); const it = { g, src, c }; items.push(it); redraw1(it); });
    }
    // per axis: the source spans between the cuts (a middle of no width takes the pixel at the cut) and where they go
    const spans = (cuts, want) => {
      const c = cuts.map(v => v - cuts[0]);
      if (c.length === 2) return { src: [[0, c[1]]], dst: [[0, c[1]]], total: c[1] };
      const keep = c[1] + (c[3] - c[2]), t = Math.max(want, keep + 1);
      return { src: [[0, c[1]], [c[1], Math.max(c[2], c[1] + 1)], [c[2], c[3]]], dst: [[0, c[1]], [c[1], t - (c[3] - c[2])], [t - (c[3] - c[2]), t]], total: t };
    };
    const redraw1 = it => {
      const { src, c, g } = it, sx = spans(g.xs, +$('#fr-w', el).value), sy = spans(g.ys, +$('#fr-h', el).value);
      c.width = sx.total; c.height = sy.total;
      const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
      sx.src.forEach((a, i) => sy.src.forEach((b, j) => {
        const sw = Math.min(a[1], src.width) - a[0], sh = Math.min(b[1], src.height) - b[0], d = sx.dst[i], e = sy.dst[j];
        if (sw > 0 && sh > 0 && d[1] > d[0] && e[1] > e[0]) x.drawImage(src, a[0], b[0], sw, sh, d[0], e[0], d[1] - d[0], e[1] - e[0]);
      }));
    };
    for (const id of ['fr-w', 'fr-h']) $('#' + id, el).oninput = () => items.forEach(redraw1);
  }

  // ---- right panel: the selected icon ----------------------------------------------------------------------------
  async function renderRight() {
    const el = $('#gu-right', P.right);
    if (G.front) { frontRight(el); return; }
    if (G.lang) { el.innerHTML = `<h3>Menu text</h3><div class="sec"><div class="note">Every text the game shows in menus, messages and tips, in this language. Edit a text and press <b>Save changes</b>. A text can only be as long as the one it replaces (the counter shows how many characters fit), because it is written into the game file in its place.</div></div>`; return; }
    if (!G.ovl) { el.innerHTML = `<h3>GUI Editor</h3><div class="sec"><div class="note">The game's interface is made of icon sheets (big pictures) and icons cut out of them. Open <b>Main interface</b> on the left for the menus and toolbars, or any object's file for its build-menu icon.<br><br>Menu screens and fonts open in the Texture Editor; menu texts are under <b>Menu text</b>.</div></div>`; return; }
    const g = G.sel, moved = G.moved.size;
    let h = '';
    const hs = G.view === 'hud' ? HS.sel : null;
    if (G.view === 'hud' && HS.sim) h += `<h3>Simulating</h3><div class="sec"><div class="note">Click the buttons as in the game: a left button opens its menu (click it again to close it), a menu button opens what it opens in the game - a list of things to build, a window or a tool panel - and the top bar's speed, day / night, objectives and family buttons work. Point at a button for its tooltip (the game's own text). What you click is shown below to edit. Esc closes the window, then the menu, then stops simulating.<br><br>Inside the windows, the game's code draws lists and settings; they are left as notes here. Windows, the quit question and the build lists move by their blue title strip, as in the game (the round tool panels stay put).</div><div class="btns"><button id="hud-simstop">Stop simulating</button></div></div>
      <h3>Message console</h3><div class="sec"><div class="note">The game's notification bar hangs from the notch in the top bar: drag its handle down to open it as far as you like, and back up to close it. The newest message is at the bottom; the arrows show earlier and later ones. Messages wait in it while it is closed (<b>${HS.con.msgs.length}</b> now).</div>
        <div class="btns"><button id="hud-msg">Send a test message</button><button id="hud-msg5">Send 5</button><button id="hud-msgclr" ${HS.con.msgs.length ? '' : 'disabled'}>Clear</button></div>
        <div class="btns"><button id="hud-conopen">${HS.con.bottom > CON.top + 6 ? 'Close it' : 'Open it'}</button></div></div>`;
    if (G.view === 'hud' && !hs && !HS.sim) h += `<h3>In-park screen</h3><div class="sec"><div class="note">The bar along the top of the screen and the buttons down the left, as the game shows them in a park. Click any piece to change its picture: edit its pixels, replace it with a picture of your own, or move its rectangle on the icon sheet. The options above the picture show the other states (speed buttons, weather, career mode, greyed buttons).</div></div>`;
    if (hs) {
      h += `<h3>${esc(hs.label)}</h3><div class="sec"><div class="kv"><span>In the game</span><b>${esc(hs.widget)}</b><span>Where</span><b>${hs.box[0]}, ${hs.box[1]} · ${hs.box[2]} × ${hs.box[3]}${hs.sliced ? ' (stretched)' : hudScaled(hs) ? ' (scaled)' : ''}</b></div>
        ${hs.icons ? `<div class="note">${hs.icons.length > 1 ? 'Its pictures (click one to edit it):' : 'Its picture:'}</div><div id="hud-vars" style="display:flex;flex-wrap:wrap;gap:6px"></div>` : ''}
        ${hs.text ? `<div class="note">Text the game writes in its own font (the AOP glyph textures under <b>Menu screens, sheets &amp; fonts</b>); the words and numbers come from the park, not from a picture.</div>` : ''}
        ${hs.bar ? `<div class="note">Drawn by the game as a filled bar (no picture): green for the part of the park rating reached.</div>` : ''}
        ${hs.sliced ? `<div class="note">A stretchable piece: the game stretches the parts between its cuts (dashed on the sheet) to fit the bar; the rounded ends keep their size.</div>` : ''}
        ${hs.disc ? `<div class="note">The blue disc (<b>MenuButtonSmall</b>) is shared by all eleven left buttons; the icon is drawn 27 × 27 on top of it.</div>` : ''}
        ${hs.icons ? `<div class="btns"><button id="hud-sheet" title="Its rectangle on the icon sheet (move or resize it there)">Show on its sheet</button></div>` : ''}</div>`;
    }
    if (g) {
      const r = rectOf(g);
      h += `<h3>Icon</h3><div class="sec"><div id="gu-prev" style="background:#0003;border-radius:8px;padding:10px;text-align:center;min-height:60px"></div>
        <div class="kv"><span>Name</span><b>${esc(g.name)}</b><span>Kind</span><b>${esc(g.type === 0 ? 'Icon' : FRAME_TYPES[g.type] || 'type ' + g.type)}</b><span>Sheet</span><b>${esc((g.texture || '').split(':')[0])}</b>
        <span>Size</span><b>${r ? (r[2] - r[0]) + ' × ' + (r[3] - r[1]) : '-'}</b>${sliced(g) ? `<span>Cuts</span><b>x ${g.xs.join(', ')} · y ${g.ys.join(', ')}</b>` : ''}</div>
        ${r ? `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px">${['Left', 'Top', 'Right', 'Bottom'].map((k, i) => `<label style="color:var(--dim);font-size:11px">${k}<input type="number" class="rc" data-i="${i}" value="${r[i]}" min="0" ${sliced(g) && i > 1 ? 'disabled' : ''}></label>`).join('')}</div>` : ''}
        <div class="btns"><button id="gu-edit" title="Open its sheet in the Texture Editor with this icon selected (or double-click it)">✎ Edit pixels</button><button id="gu-png">Export PNG</button></div>
        <div class="btns"><button id="gu-imp" title="Put a picture from your computer into this icon's place (opens it in the Texture Editor to save)">Replace with picture…</button></div>
        <input type="file" id="gu-file" accept="image/*" hidden>
        <div class="note">${sliced(g) ? 'Drag it on the sheet (or type Left / Top) to move it with its cuts; its size and cuts stay.' : "Drag the icon's box on the sheet to move it, its handles to resize it, or type the numbers (right and bottom are the edges after the last pixel)."} The game then shows that part of the sheet for it.</div></div>`;
    }
    h += `<h3>Rectangles</h3><div class="sec"><div class="note">${moved ? `${moved} rectangle${moved > 1 ? 's' : ''} moved, not saved yet.` : 'No rectangles changed.'}</div>
      <div class="btns"><button class="primary" id="gu-save" ${moved ? '' : 'disabled'}>Save into game</button><button id="gu-undo" ${moved ? '' : 'disabled'}>Undo moves</button></div>
      ${S.edits[G.ovl] ? '<button class="warn" id="gu-restore">Restore original file</button>' : ''}</div>`;
    if (G.view === 'sheet' && G.sheet) {
      h += `<h3>Icons on this sheet (${G.sheet.icons.length})</h3><div class="sec"><input type="text" id="gu-iq" placeholder="Find an icon"><div id="gu-ilist" style="max-height:340px;overflow:auto"></div>
        <div class="btns"><button id="gu-sheetedit">✎ Edit the whole sheet</button></div></div>`;
    }
    el.innerHTML = h;
    $('#hud-simstop', el)?.addEventListener('click', () => hudSimulate(false));
    const msgDone = () => { drawHud(); renderRight(); };
    $('#hud-msg', el)?.addEventListener('click', () => { conMessage(1); msgDone(); });
    $('#hud-msg5', el)?.addEventListener('click', () => { conMessage(5); msgDone(); });
    $('#hud-msgclr', el)?.addEventListener('click', () => { HS.con.msgs = []; HS.con.scroll = 0; msgDone(); });
    $('#hud-conopen', el)?.addEventListener('click', () => { HS.con.bottom = HS.con.bottom > CON.top + 6 ? 0 : 22 + CON.strip + CON.row * 6 + 3; msgDone(); });
    if (hs?.icons) {
      const box = $('#hud-vars', el);
      for (const n of hs.icons) {
        const ig = iconByName(n); if (!ig) continue;
        const d = document.createElement('div'); d.className = 'state'; d.title = n; d.style.margin = '0'; if (ig === g) d.style.outline = '2px solid var(--accent)';
        iconCanvas(ig, 1).then(c => { const k = Math.max(1, Math.min(3, Math.floor(40 / Math.max(c.width, c.height)))); const z = canvasOf(c.width * k, c.height * k), zx = z.getContext('2d'); zx.imageSmoothingEnabled = false; zx.drawImage(c, 0, 0, z.width, z.height); d.prepend(z); });
        d.insertAdjacentHTML('beforeend', `<small>${esc(spaced(n))}</small>`);
        d.onclick = () => { G.sel = ig; renderRight(); };
        box.appendChild(d);
      }
      $('#hud-sheet', el).onclick = () => { if (!G.sel) return; G.sheet = G.groups.sheets.find(s => s.icons.includes(G.sel)) || G.sheet; setView('sheet'); };
    }
    if (g) {
      iconCanvas(g, 1).then(c => { const sc = Math.max(1, Math.min(4, Math.floor(160 / Math.max(c.width, c.height)))); const d = canvasOf(c.width * sc, c.height * sc), x = d.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(c, 0, 0, d.width, d.height); d.style.imageRendering = 'pixelated'; $('#gu-prev', el)?.appendChild(d); });
      el.querySelectorAll('input.rc').forEach(i => i.onchange = () => {
        const r = [...rectOf(g)], k = +i.dataset.i, v = Math.max(0, Math.round(+i.value));
        if (sliced(g)) { const d = v - r[k]; r[k] += d; r[k + 2] += d; } else r[k] = v;
        if (r[2] <= r[0] || r[3] <= r[1]) { toast('Right must be more than Left and Bottom more than Top', true); renderRight(); return; }
        if (r.join() !== g.rect.join()) G.moved.set(g.name, r); else G.moved.delete(g.name);
        view.redraw(); renderRight(); if (G.view === 'hud') hudPrepare().then(drawHud);
      });
      $('#gu-edit', el).onclick = () => openTexture(g.sheet, g.texture, { rect: rectOf(g) });
      $('#gu-png', el).onclick = () => iconCanvas(g, 1).then(c => c.toBlob(b => download(b, g.name + '.png')));
      $('#gu-imp', el).onclick = () => $('#gu-file', el).click();
      $('#gu-file', el).onchange = async e => {
        const f = e.target.files[0]; if (!f) return;
        await openTexture(g.sheet, g.texture, { rect: rectOf(g), importFile: f });
      };
    }
    $('#gu-save', el).onclick = saveRects;
    $('#gu-undo', el).onclick = () => { G.moved.clear(); view.redraw(); renderRight(); if (G.view === 'hud') hudPrepare().then(drawHud); if (G.view === 'anims') setView('anims'); };
    $('#gu-restore', el)?.addEventListener('click', async () => {
      if (!await confirmBox('Restore original', `Put the original <b>${esc(G.ovl)}</b> back? Every change made to it here is lost.`, 'Restore')) return;
      try { const r = await post('/api/tx/restore', { path: G.ovl }); setEdits(r.edits); toast('Restored ' + G.ovl); afterRestore(G.ovl); } catch (e) { toast(e.message, true); }
    });
    const il = $('#gu-ilist', el);
    if (il) {
      const fill = () => { const q = $('#gu-iq', el).value.toLowerCase(); il.innerHTML = G.sheet.icons.filter(x => !q || x.name.toLowerCase().includes(q)).map(x => `<div class="li${x === G.sel ? ' sel' : ''}" data-n="${esc(x.name)}" style="padding-left:6px">${esc(x.name)}${G.moved.has(x.name) ? ' <span class="mod">●</span>' : ''}</div>`).join(''); };
      fill(); $('#gu-iq', el).oninput = fill;
      il.onclick = e => { const d = e.target.closest('.li'); if (!d) return; G.sel = G.sheet.icons.find(x => x.name === d.dataset.n); view.zoomTo(rectOf(G.sel), 0.6, 6); renderRight(); };
      il.querySelector('.li.sel')?.scrollIntoView({ block: 'nearest' });
      $('#gu-sheetedit', el).onclick = () => openTexture(G.sheet.path, G.sheet.name);
    }
  }
  async function afterRestore(path) {
    if (G.front && (path === MAIN || path === 'RCT3plus.exe' || path === F.lang)) { F.texts = null; await openFront(); }
    if (path === G.ovl) { const v = G.view; G.moved.clear(); G.sheets.clear(); await openOvl(path, v === 'hud' ? null : G.sel?.name); if (v !== G.view && v !== 'sheet') setView(v); }
    if (path === G.lang) openTexts(path);
    G.sheets.clear();
  }

  // ---- menu texts ----------------------------------------------------------------------------------------------------
  async function openTexts(path) {
    G.lang = path; G.ovl = null; G.front = false; renderLeft(); renderTabs(); renderRight();
    cv.style.display = 'none'; $('#gu-empty', P.centre).style.display = 'none';
    const panel = $('#gu-panel', P.centre); panel.style.display = ''; panel.innerHTML = '<div class="empty">Loading texts…</div>';
    G.texts = await fetch('/api/tx/texts?path=' + encodeURIComponent(path)).then(r => r.json());
    G.textDirty = new Map();
    panel.innerHTML = `<div class="texts"><div class="ctool" style="position:sticky;top:0;z-index:1"><input type="search" id="tt-q" placeholder="Find a text (name or words)" style="flex:1;max-width:420px;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:5px 7px">
      <small id="tt-n"></small><span style="flex:1"></span><button class="primary" id="tt-save" disabled>Save changes</button></div><table><tbody id="tt-body"></tbody></table></div>`;
    const body = $('#tt-body', panel);
    const render = () => {
      const q = $('#tt-q', panel).value.trim().toLowerCase();
      const rows = G.texts.filter(t => !q || t.name.toLowerCase().includes(q) || t.text.toLowerCase().includes(q));
      $('#tt-n', panel).textContent = `${rows.length.toLocaleString()} of ${G.texts.length.toLocaleString()}`;
      body.innerHTML = rows.slice(0, 400).map(t => { const v = G.textDirty.get(t.name) ?? t.text; return `<tr class="${G.textDirty.has(t.name) ? 'dirty' : ''}" data-n="${esc(t.name)}"><td class="k">${esc(t.name)}</td><td><textarea rows="${Math.min(6, Math.max(1, Math.ceil(v.length / 70)))}">${esc(v)}</textarea><div class="cnt ${v.length > t.max ? 'over' : ''}">${v.length} / ${t.max}</div></td></tr>`; }).join('') +
        (rows.length > 400 ? `<tr><td colspan="2" style="color:var(--dim)">${rows.length - 400} more - search to narrow</td></tr>` : '');
    };
    render();
    $('#tt-q', panel).oninput = render;
    body.oninput = e => {
      const tr = e.target.closest('tr'); if (!tr) return;
      const t = G.texts.find(x => x.name === tr.dataset.n), v = e.target.value.replace(/\r/g, '');
      if (v === t.text) G.textDirty.delete(t.name); else G.textDirty.set(t.name, v);
      tr.classList.toggle('dirty', G.textDirty.has(t.name));
      const c = tr.querySelector('.cnt'); c.textContent = `${v.length} / ${t.max}`; c.classList.toggle('over', v.length > t.max);
      $('#tt-save', panel).disabled = !G.textDirty.size; $('#tt-save', panel).textContent = G.textDirty.size ? `Save ${G.textDirty.size} change${G.textDirty.size > 1 ? 's' : ''}` : 'Save changes';
    };
    $('#tt-save', panel).onclick = async () => {
      const list = [...G.textDirty], over = list.filter(([n, v]) => v.length > G.texts.find(x => x.name === n).max);
      if (over.length) { toast(`${over.length} text${over.length > 1 ? 's are' : ' is'} too long to fit: ${over.map(o => o[0]).slice(0, 3).join(', ')}`, true); return; }
      if (!S.edits[path] && !await confirmBox('Save into the game', `This writes ${list.length} text${list.length > 1 ? 's' : ''} into <b>${esc(path)}</b>. The original file is copied first; <b>Changed files</b> at the top right puts it back. Close the game before saving.`, 'Save into game')) return;
      try {
        for (const [n, v] of list) { const r = await post('/api/tx/text', { path, name: n, text: v }); const t = G.texts.find(x => x.name === n); t.text = r.text; t.max = r.max; G.textDirty.delete(n); }
        const r = await fetch('/api/tx/gui').then(r => r.json()); setEdits(r.edits);
        toast(`Saved ${list.length} text${list.length > 1 ? 's' : ''} into ${path}`); render(); $('#tt-save', panel).disabled = true; $('#tt-save', panel).textContent = 'Save changes';
      } catch (e) { toast('Could not save: ' + e.message, true); }
    };
  }

  // ---- front screen designer: the game's main menus ------------------------------------------------------------------
  // The front screen is drawn by code (RCT3plus.exe). Every menu shows its buttons on the game's 5 places (slot n:
  // the badge, the bar with its words behind it and the slide-in all follow the place), shared by every menu. With the
  // designer's code cave each place can be anywhere and each menu can hold any of the game's 15 menu buttons (see
  // frontscreen.py). Coordinates are the game's 1024 x 768 layout.
  const MAIN = 'Main.common.ovl';
  const TITLES = { main: 'FrontScreen_MainMenu', play: 'FrontScreen_PlayMenu', tools: 'FrontScreen_ToolMenu', sandbox: 'FrontScreen_SandboxMenu', custom: 'FrontScreen_SandboxMenu' };
  const MENU_NAMES = { main: 'Main menu', play: 'Play', tools: 'Tools', sandbox: 'Sandbox', custom: 'Custom scenario' };
  const PICTURES = [['FrontEndBG1', 'Background (left, main menu)'], ['FrontEndBG1b', 'Background (left, other menus)'], ['FrontEndBG2', 'Bottom bar'],
    ['FrontEndBG3', 'Circle quarters'], ['FrontEndBG4', 'Pieces over the circle'], ['FrontEndLogo', 'The big picture'], ['FrontEndParts', 'Logo, badges, bar ends, crowd'],
    ['FrontEndIcons', 'Button icons'], ['GUI2Main2', 'Expansion badges']];
  const W = 1280, H = 800, SX = W / 1024, SY = H / 768, NPL = 5, CX = 734, CY = 239.5;
  const F = { menu: 'main', L: null, vals: {}, colour: 0, places: [], lists: {}, tex: {}, icons: null, texts: null, lang: null, words: new Map(), drag: null,
    sel: new Set(), box: null, sim: false, hist: [], hover: -1, anim: 0, note: null, pieces: null, pdrag: null, psel: null };
  // the other pieces of the front screen: widgets of their own placed by code, not part of the background pictures
  // (frontscreen.py 'pieces'). Badges and the logo by their top-left corner, Back / Quit by their centre.
  const PIECES = [['b0', 'Soaked badge (shark)', 'FrontScreen_AOPBadge_0'], ['b1', 'Wild badge (tiger)', 'FrontScreen_AOPBadge_1'],
    ['back', 'Back button (other menus)', 'File_CareerMap'], ['quit', 'Quit button', 'File_Quit'], ['logo', 'RCT3 logo', 'FrontScreen_RCT3Logo']];
  const FRONT_SHEETS = ['GUI2MainIcons', 'GUI2LargeIcons', 'GUI2LargeIcons2'];      // Back / Quit's disc and icons
  const pieceXY = k => k[0] === 'b' && k.length === 2 ? F.pieces.badges[+k[1]] : k === 'logo' ? F.pieces.logo : F.pieces.corners[k];
  const pieceGame = k => k[0] === 'b' && k.length === 2 ? F.L.pieces.game.badges[+k[1]] : k === 'logo' ? F.L.pieces.game.logo : F.L.pieces.game.corners[k];
  const pieceSaved = k => k[0] === 'b' && k.length === 2 ? F.L.pieces.badges[+k[1]] : k === 'logo' ? F.L.pieces.logo : F.L.pieces.corners[k];
  function pieceBox(k) {        // [x, y, w, h] on the 1024 x 768 layout
    const [x, y] = pieceXY(k), ic = PIECES.find(q => q[0] === k)[2];
    if (k === 'b0' || k === 'b1') { const [w, h] = F.L.pieces.badge_sizes[+k[1]]; return [x, y, w, h]; }
    if (k === 'logo') { const r = iconRect(ic) || [275, 0, 512, 140]; return [x, y, Math.abs(r[2] - r[0]), Math.abs(r[3] - r[1])]; }
    const r = iconRect('MenuButtonSmall') || [0, 0, 32, 33], w = Math.abs(r[2] - r[0]), h = Math.abs(r[3] - r[1]);
    return [x - w / 2, y - h / 2, w, h];
  }
  const piecesShown = () => PIECES.map(q => q[0]).filter(k => k !== 'back' || F.menu !== 'main');   // Back is not on the main menu
  function pieceAt(x, y) {
    for (const k of [...piecesShown()].reverse()) { const [bx, by, bw, bh] = pieceBox(k); if (x >= bx && x < bx + bw && y >= by && y < by + bh) return k; }
    return null;
  }
  // simulating: what each game button does wherever it sits (the four that open another front-screen menu, the rest
  // leave the front screen for a screen of their own)
  const OPENS = { play: 'play', tools: 'tools', sandbox: 'sandbox', custom: 'custom' };
  const LEAVES = { options: 'the Options screen', tutorial: 'the tutorial pages', career: 'the career scenarios', people: 'the People designer',
    scenario_ed: 'the Scenario editor', coaster: 'the Coaster designer', building: 'the Building designer', new: 'the sandbox parks to start',
    load: 'the saved sandbox parks', custom_new: 'the custom scenarios to start', custom_load: 'the saved custom scenario parks' };
  const SLIDE = 380, STAGGER = 70, PARKED = 1.885;     // ms; the animator's resting angle (frontscreen.py)
  // not '#tg .stage canvas' (absolute at the top left, over the menu tabs): sized to fit its box, kept 1280:800
  const fcv = document.createElement('canvas'); fcv.width = W; fcv.height = H;
  fcv.style.cssText = 'position:static;inset:auto;margin:auto;display:block;flex:none;cursor:default;border-radius:6px;box-shadow:0 2px 16px #0008';
  const fitFront = new ResizeObserver(es => { for (const e of es) { const { width: w, height: h } = e.contentRect, k = Math.max(0.05, Math.min(w / W, h / H)); fcv.style.width = W * k + 'px'; fcv.style.height = H * k + 'px'; } });
  const deg = r => r * 180 / Math.PI, rad = d => d * Math.PI / 180;
  const argbCss = c => '#' + ((c >>> 0) & 0xffffff).toString(16).padStart(6, '0');
  const M = () => F.L.menus;
  const sameLists = (a, b) => Object.keys(MENU_NAMES).every(m => (a[m] || []).join() === (b[m] || []).join());
  const placesDirty = () => F.places.some((p, n) => Math.hypot(p[0] - M().places[n][0], p[1] - M().places[n][1]) > 0.05);
  const menusDirty = () => placesDirty() || !sameLists(F.lists, M().menus);
  const piecesDirty = () => !!F.pieces && PIECES.some(([k]) => { const a = pieceXY(k), b = pieceSaved(k); return Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.05; });
  const fdirty = () => F.L && (F.L.params.some(p => Math.abs(F.vals[p.key] - p.value) > 1e-6) || F.colour !== F.L.colour || menusDirty() || piecesDirty());
  function takeLayout() {
    F.vals = Object.fromEntries(F.L.params.map(p => [p.key, p.value])); F.colour = F.L.colour >>> 0;
    F.pieces = JSON.parse(JSON.stringify({ badges: F.L.pieces.badges, corners: F.L.pieces.corners, logo: F.L.pieces.logo }));
    F.places = M().places.map(p => [...p]); F.lists = Object.fromEntries(Object.keys(MENU_NAMES).map(m => [m, [...(M().menus[m] || [])]]));
  }

  async function openFront() {
    G.front = true; G.ovl = null; G.lang = null; renderLeft(); renderTabs();
    cv.style.display = 'none'; $('#gu-empty', P.centre).style.display = 'none';
    const panel = $('#gu-panel', P.centre); panel.style.display = '';
    panel.innerHTML = '<div class="empty">Loading the front screen…</div>';
    try {
      F.L = await fetch('/api/tx/menu').then(r => r.json());
      if (F.L.error) throw new Error(F.L.error);
    } catch (e) { panel.innerHTML = `<div class="empty">The front screen designer needs the game's program (RCT3plus.exe) in the game folder: ${esc(e.message)}</div>`; renderRight(); return; }
    takeLayout();
    if (!F.icons) F.icons = await fetch('/api/tx/icons?path=' + encodeURIComponent(MAIN)).then(r => r.json());
    F.lang = S.gui?.texts.find(o => /english\.common\.ovl$/i.test(o.path))?.path || S.gui?.texts[0]?.path;
    if (F.lang && !F.texts) F.texts = await fetch('/api/tx/texts?path=' + encodeURIComponent(F.lang)).then(r => r.json());
    await loadFrontTextures();
    panel.innerHTML = `<div style="position:absolute;inset:0;display:flex;flex-direction:column">
      <div class="ctool"><span class="title">Front screen</span>${Object.entries(MENU_NAMES).map(([k, v]) => `<button data-m="${k}">${v}</button>`).join('')}<span style="flex:1"></span><small style="color:var(--dim)">drag a button (or an empty place) anywhere · places are shared by every menu</small></div>
      <div style="flex:1;min-height:0;padding:12px;display:flex;overflow:hidden" id="fs-stage"></div></div>`;
    $('#fs-stage', panel).appendChild(fcv); fitFront.disconnect(); fitFront.observe($('#fs-stage', panel));
    const tool = $('.ctool', panel);
    tool.insertAdjacentHTML('beforeend', '<button id="fs-sim" title="Click through the menus as in the game">▶ Simulate</button>');
    tool.querySelector('small').id = 'fs-hint';
    panel.querySelectorAll('button[data-m]').forEach(b => b.onclick = () => { F.hist = []; goMenu(b.dataset.m); });
    $('#fs-sim', panel).onclick = () => simulate(!F.sim);
    F.sim = false; F.sel.clear(); markMenu(); drawFront(); renderRight();
  }
  function markMenu() {
    const panel = $('#gu-panel', P.centre);
    panel.querySelectorAll('button[data-m]').forEach(b => b.style.cssText = b.dataset.m === F.menu ? 'border-color:var(--accent);color:var(--accent)' : '');
    const sim = $('#fs-sim', panel), hint = $('#fs-hint', panel); if (!sim) return;
    sim.textContent = F.sim ? '■ Stop simulating' : '▶ Simulate'; sim.style.cssText = F.sim ? 'border-color:var(--accent);color:var(--accent)' : '';
    hint.textContent = F.sim ? [...F.hist, F.menu].map(m => MENU_NAMES[m]).join(' › ') + ' · click a button · Back / Esc goes back'
      : 'drag to move · Shift-click or drag a box to pick several · Delete removes';
  }
  function goMenu(m, slide = F.sim) {
    F.menu = m; F.sel.clear(); F.note = null; F.hover = -1;
    if (slide) { F.anim = performance.now(); requestAnimationFrame(tick); }
    drawFront(); markMenu(); renderRight();
  }
  function tick() {
    if (!F.anim || !G.front) return;
    if (performance.now() - F.anim > SLIDE + STAGGER * NPL) F.anim = 0; else requestAnimationFrame(tick);
    drawFront();
  }
  function simulate(on) {
    F.sim = on; F.hist = []; F.note = null; F.drag = null; F.box = null; F.sel.clear();
    if (on) goMenu('main'); else { F.anim = 0; drawFront(); markMenu(); renderRight(); }
  }
  function simBack() {          // Back (or Quit on the main menu)
    if (F.note) { F.note = null; drawFront(); return; }
    if (F.hist.length) { goMenu(F.hist.pop()); return; }
    if (F.menu !== 'main') { goMenu('main'); return; }
    F.note = 'Quit: the game asks whether to quit to Windows'; drawFront();
  }
  // where place n's badge is drawn: while a menu opens in the simulation the buttons slide round the circle from the
  // animator's resting angle to their place, one after another, as the game does
  function placeAt(n) {
    const [x, y] = F.places[n]; if (!F.anim) return [x, y];
    const t = Math.min(1, Math.max(0, (performance.now() - F.anim - STAGGER * n) / SLIDE)), e = 1 - (1 - t) ** 3;
    const r = Math.hypot(x - CX, y - CY); let a = Math.atan2(CY - y, x - CX);
    while (a - PARKED > Math.PI) a -= 2 * Math.PI; while (a - PARKED < -Math.PI) a += 2 * Math.PI;
    const b = PARKED + (a - PARKED) * e;
    return [CX + r * Math.cos(b), CY - r * Math.sin(b)];
  }
  async function loadFrontTextures() {
    F.tex = {};
    await Promise.all([...PICTURES.map(([n]) => n), ...FRONT_SHEETS].map(async n => { try { F.tex[n] = await loadImage(imgUrl(MAIN, n + ':tex') + '&t=' + Date.now()); } catch (e) {} }));
  }
  const iconRect = n => F.icons?.find(g => g.name === n)?.rect;
  const word = k => F.words.get(k) ?? F.texts?.find(t => t.name === k)?.text ?? '';
  const btn = k => M().buttons[k];
  // an icon of Main drawn by its name (its sheet and rectangle; a rectangle given backwards is drawn mirrored)
  function iconDraw(g, n, dx, dy, dw, dh) {
    const ic = F.icons?.find(q => q.name === n), T = ic && F.tex[ic.texture.replace(/:tex$/, '')]; if (!T) return;
    const [l, t, r, b] = ic.rect;
    g.save(); g.translate(dx + (r < l ? dw : 0), dy + (b < t ? dh : 0)); g.scale(r < l ? -1 : 1, b < t ? -1 : 1);
    g.drawImage(T, Math.min(l, r), Math.min(t, b), Math.abs(r - l), Math.abs(b - t), 0, 0, dw, dh); g.restore();
  }
  function drawPiece(g, k) {
    const [x, y, w, h] = pieceBox(k), ic = PIECES.find(q => q[0] === k)[2];
    if (k === 'back' || k === 'quit') {      // a type-4 button: the MenuButtonSmall disc, its icon at 0.684 of it
      const big = F.sim && F.hover === k ? 1.15 : 1, cx = x + w / 2, cy = y + h / 2, i = w * 0.6842 * big;
      iconDraw(g, 'MenuButtonSmall', cx - w * big / 2, cy - h * big / 2, w * big, h * big);
      iconDraw(g, ic, cx - i / 2, cy - i / 2, i, i);
    } else iconDraw(g, ic, x, y, w, h);
    if (F.sim) return;
    if (F.psel === k || F.pdrag?.k === k) { g.strokeStyle = '#3cf'; g.lineWidth = 2; g.setLineDash([5, 3]); g.strokeRect(x - 2, y - 2, w + 4, h + 4); g.setLineDash([]); }
  }
  function drawFront() {
    const g = fcv.getContext('2d'), T = F.tex;
    g.setTransform(1, 0, 0, 1, 0, 0);
    // the live 3D park (a stand-in: the game shows a moving park here)
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#6aa6d8'); sky.addColorStop(0.55, '#cfe3ef'); sky.addColorStop(0.56, '#6f9a52'); sky.addColorStop(1, '#3f6a32');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = '#0006'; g.font = '600 15px system-ui'; g.textAlign = 'center'; g.fillText('(the game shows a moving 3D park here)', 900, 420);
    g.scale(SX, SY);
    const img = (n, sx, sy, sw, sh, dx, dy, dw, dh) => { if (T[n]) g.drawImage(T[n], sx, sy, sw, sh, dx, dy, dw, dh); };
    img(F.menu === 'main' ? 'FrontEndBG1' : 'FrontEndBG1b', 0, 0, 512, 512, 0, 0, 512, 512);
    img('FrontEndBG2', 0, 0, 512, 256, 0, 512, 512, 256);
    img('FrontEndBG2', 0, 257, 512, 255, 512, 512, 512, 256);
    if (F.menu === 'main') img('FrontEndLogo', 0, 0, 512, 512, -4, 298, 389, 430);
    // the logo, the expansion badges, Back / Quit: widgets of their own, where the program puts them
    for (const k of piecesShown()) drawPiece(g, k);
    // the menu's title in the bottom bar
    g.fillStyle = '#000'; g.font = '700 22px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(word(TITLES[F.menu]), 512, 724);
    // the 5 places: an empty one is a numbered marker (still draggable - other menus use it)
    const size = F.vals.menu_size, items = F.lists[F.menu];
    F.places.forEach(([x, y], n) => {
      if (items[n] || F.sim) return;
      if (F.sel.has(n)) { g.strokeStyle = '#3cf'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, size / 2 + 5, 0, 7); g.stroke(); }
      g.strokeStyle = '#fffa'; g.setLineDash([5, 5]); g.lineWidth = 2; g.beginPath(); g.arc(x, y, size / 2, 0, 7); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#fffc'; g.font = '700 20px Arial'; g.fillText(n + 1, x, y);
    });
    // the menu's buttons: bar (the code's colour), its rounded end and slant (FrontEndParts), the badge and the icon
    items.forEach((key, n) => {
      const [x, y] = placeAt(n), h = 94, bw = 226, b = btn(key), text = b.text;
      g.fillStyle = argbCss(F.colour);
      if (F.sim && F.hover === n && !F.anim) { g.save(); g.shadowColor = '#fff'; g.shadowBlur = 18; }
      g.beginPath(); g.moveTo(x, y - h / 2); g.lineTo(x + bw, y - h / 2); g.lineTo(x + bw + 22, y + h / 2); g.lineTo(x, y + h / 2); g.fill();
      img('FrontEndParts', 90, 2, 95, 97, x - size * 0.6, y - h / 2, 95 * h / 97, h);
      img('FrontEndParts', 186, 2, 78, 80, x - size / 2, y - size / 2, size, size);
      const r = iconRect('FrontScreen_Icon_' + b.icon), k = size * 0.684;
      if (r) img('FrontEndIcons', r[0], r[1], r[2] - r[0], r[3] - r[1], x - k / 2, y - k / 2, k, k);
      g.fillStyle = '#000'; g.font = '700 22px Arial';
      const lines = word(text).split(/\s+/), two = lines.length > 1 && word(text).length > 9;
      if (two) { const m = Math.ceil(lines.length / 2); g.fillText(lines.slice(0, m).join(' '), x + 130, y - 13); g.fillText(lines.slice(m).join(' '), x + 130, y + 13); }
      else g.fillText(word(text), x + 130, y);
      if (F.sim) { if (F.hover === n && !F.anim) g.restore(); return; }
      g.fillStyle = '#000a'; g.beginPath(); g.arc(x - size / 2 + 8, y - size / 2 + 8, 10, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.font = '700 13px Arial'; g.fillText(n + 1, x - size / 2 + 8, y - size / 2 + 8);
      if (F.sel.has(n)) { g.strokeStyle = '#3cf'; g.lineWidth = 3; g.strokeRect(x - size / 2 - 6, y - h / 2 - 2, size / 2 + bw + 34, h + 4); }
      if (F.drag?.n === n) { g.strokeStyle = '#fff'; g.setLineDash([6, 4]); g.lineWidth = 2; g.strokeRect(x - size / 2 - 4, y - size / 2 - 4, size + 8, size + 8); g.setLineDash([]); }
    });
    if (F.box) {           // the selection box being dragged
      const [x0, y0, x1, y1] = F.box, bx = Math.min(x0, x1), by = Math.min(y0, y1), bw = Math.abs(x1 - x0), bh = Math.abs(y1 - y0);
      g.fillStyle = '#33ccff22'; g.strokeStyle = '#3cf'; g.lineWidth = 1.5; g.setLineDash([5, 3]); g.fillRect(bx, by, bw, bh); g.strokeRect(bx, by, bw, bh); g.setLineDash([]);
    }
    if (F.note) {          // a button that leaves the front screen
      g.fillStyle = '#000b'; g.fillRect(0, 0, 1024, 768);
      g.fillStyle = '#fff'; g.font = '700 26px Arial'; g.fillText(F.note, 512, 360);
      g.fillStyle = '#ccc'; g.font = '16px Arial'; g.fillText('(not part of the front screen) · click or press Esc to go back', 512, 400);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  function fpos(e) { const b = fcv.getBoundingClientRect(); return [(e.clientX - b.left) * W / b.width / SX, (e.clientY - b.top) * H / b.height / SY]; }
  function fhit(x, y) {
    const items = F.lists[F.menu], half = F.vals.menu_size / 2;
    for (let n = NPL - 1; n >= 0; n--) {
      const [bx, by] = F.places[n];
      if (items[n] ? x > bx - half && x < bx + 250 && Math.abs(y - by) < 47 : Math.hypot(x - bx, y - by) < half) return n;
    }
    return -1;
  }
  function simClick(x, y) {
    if (F.note) { F.note = null; drawFront(); return; }
    const pc = fhit(x, y) < 0 ? pieceAt(x, y) : null;
    if (pc === 'back') { simBack(); return; }
    if (pc === 'quit') { F.note = 'Quit: the game asks whether to quit to Windows'; drawFront(); return; }
    if (pc) return;
    const k = F.lists[F.menu][fhit(x, y)]; if (!k) return;
    if (OPENS[k]) { F.hist.push(F.menu); goMenu(OPENS[k]); }
    else { F.note = btn(k).label + ' opens ' + LEAVES[k]; drawFront(); }
  }
  fcv.addEventListener('pointerdown', e => {
    const [x, y] = fpos(e);
    if (F.sim) { simClick(x, y); return; }
    const n = fhit(x, y), add = e.shiftKey || e.ctrlKey || e.metaKey;
    fcv.setPointerCapture(e.pointerId);
    const pc = n < 0 && !add ? pieceAt(x, y) : null;
    if (pc) { F.sel.clear(); F.psel = pc; F.pdrag = { k: pc, x, y, from: [...pieceXY(pc)] }; drawFront(); renderRight(); return; }
    if (F.psel) { F.psel = null; renderRight(); }
    if (n < 0) { if (!add) F.sel.clear(); F.box = [x, y, x, y, new Set(F.sel)]; drawFront(); renderRight(); return; }
    if (add) { F.sel.has(n) ? F.sel.delete(n) : F.sel.add(n); drawFront(); renderRight(); if (!F.sel.has(n)) return; }
    else if (!F.sel.has(n)) { F.sel.clear(); F.sel.add(n); }
    // drag every picked place together
    F.drag = { n, x, y, from: new Map([...F.sel].map(m => [m, [...F.places[m]]])) }; drawFront(); renderRight();
  });
  fcv.addEventListener('pointermove', e => {
    const [x, y] = fpos(e);
    if (F.pdrag) {
      const xy = pieceXY(F.pdrag.k), [fx, fy] = F.pdrag.from;
      xy[0] = Math.round(Math.min(1124, Math.max(-100, fx + x - F.pdrag.x))); xy[1] = Math.round(Math.min(868, Math.max(-100, fy + y - F.pdrag.y)));
      drawFront(); syncFrontInputs(); return;
    }
    if (F.sim) {
      const n = fhit(x, y), pc = n < 0 ? pieceAt(x, y) : null, h = F.note ? -1 : pc === 'back' || pc === 'quit' ? pc : F.lists[F.menu][n] ? n : -1;
      fcv.style.cursor = h === -1 && !F.note ? 'default' : 'pointer'; if (h !== F.hover) { F.hover = h; drawFront(); } return;
    }
    if (F.box) {
      F.box[2] = x; F.box[3] = y; const [x0, y0, x1, y1, keep] = F.box;
      F.sel = new Set(keep); F.places.forEach(([px, py], m) => { if (px >= Math.min(x0, x1) && px <= Math.max(x0, x1) && py >= Math.min(y0, y1) && py <= Math.max(y0, y1)) F.sel.add(m); });
      drawFront(); return;
    }
    if (!F.drag) { fcv.style.cursor = fhit(x, y) >= 0 || pieceAt(x, y) ? 'grab' : 'crosshair'; fcv.title = fhit(x, y) < 0 ? PIECES.find(q => q[0] === pieceAt(x, y))?.[1] || '' : ''; return; }
    const dx = x - F.drag.x, dy = y - F.drag.y;
    for (const [m, [px, py]] of F.drag.from) F.places[m] = [Math.round(Math.min(1124, Math.max(-100, px + dx))), Math.round(Math.min(868, Math.max(-100, py + dy)))];
    drawFront(); syncFrontInputs();
  });
  fcv.addEventListener('pointerup', () => {
    if (F.pdrag) { F.pdrag = null; drawFront(); renderRight(); }
    if (F.box) { F.box = null; drawFront(); renderRight(); }
    if (F.drag) { F.drag = null; drawFront(); renderRight(); }
  });
  fcv.addEventListener('pointerleave', () => { if (F.sim && F.hover !== -1) { F.hover = -1; drawFront(); } });
  // take the picked buttons out of this menu (the places stay; the buttons after them move up)
  function removePicked() {
    const l = F.lists[F.menu], gone = [...F.sel].filter(n => l[n]);
    if (!gone.length) return toast('Pick buttons of this menu first (an empty place has nothing to remove)', true);
    if (F.menu === 'main' && gone.length >= l.length) return toast('The main menu needs at least one button', true);
    F.lists[F.menu] = l.filter((_, n) => !gone.includes(n)); F.sel.clear();
    toast(`Removed ${gone.length} button${gone.length > 1 ? 's' : ''} from ${MENU_NAMES[F.menu]}`);
    drawFront(); renderRight();
  }
  function pickAll() { F.sel = new Set(F.lists[F.menu].map((_, n) => n)); drawFront(); renderRight(); }

  function syncFrontInputs() {
    const el = $('#gu-right', P.right);
    el.querySelectorAll('input[data-k]').forEach(i => { const p = F.L.params.find(q => q.key === i.dataset.k); const v = p.angle ? deg(F.vals[p.key]) : F.vals[p.key]; if (document.activeElement !== i) i.value = +v.toFixed(p.angle ? 2 : 1); });
    el.querySelectorAll('input[data-pl]').forEach(i => { const [n, c] = i.dataset.pl.split(',').map(Number); if (document.activeElement !== i) i.value = Math.round(F.places[n][c]); });
    el.querySelectorAll('input[data-pc]').forEach(i => { const [k, c] = i.dataset.pc.split(','); if (document.activeElement !== i) i.value = Math.round(pieceXY(k)[+c]); });
    const s = $('#fs-state', el); if (s) s.textContent = fdirty() ? 'Changed - not saved into the game yet.' : (F.L.changed ? 'Saved in the game.' : "The game's own layout.");
    const b = $('#fs-save', el); if (b) b.disabled = !fdirty();
  }
  function frontRight(el) {
    if (!F.L) { el.innerHTML = '<h3>Front screen</h3>'; return; }
    if (F.sim) {
      const items = F.lists[F.menu];
      el.innerHTML = `<h3>Simulating · ${esc(MENU_NAMES[F.menu])}</h3><div class="sec">
        <div class="note">Click the buttons on the screen to go through the menus as the game does, with your layout and buttons (saved or not). <b>Back</b> (the round button by the circle, Backspace or Esc) goes to the menu before.</div>
        ${items.map((k, n) => `<div class="li" data-go="${n}" style="padding-left:6px">${n + 1}. ${esc(btn(k).label)}<small>${OPENS[k] ? 'opens ' + esc(MENU_NAMES[OPENS[k]]) : 'leaves the front screen'}</small></div>`).join('') || '<div class="note">This menu has no buttons: Back is the only way out.</div>'}
        <div class="btns"><button id="fs-sback">${F.menu === 'main' && !F.hist.length ? 'Quit' : 'Back'}</button><button id="fs-shome">Main menu</button><button id="fs-sstop">Stop simulating</button></div></div>`;
      el.querySelectorAll('[data-go]').forEach(d => d.onclick = () => { const [x, y] = F.places[+d.dataset.go]; simClick(x, y); });
      $('#fs-sback', el).onclick = simBack; $('#fs-shome', el).onclick = () => { F.hist = []; goMenu('main'); }; $('#fs-sstop', el).onclick = () => simulate(false);
      return;
    }
    const row = p => `<label class="fs-row" title="the game's own: ${p.angle ? deg(p.orig).toFixed(2) + '°' : p.orig}">
      <span>${esc(p.label)}</span><input type="number" data-k="${p.key}" step="${p.angle ? 0.5 : 1}" value="${+(p.angle ? deg(F.vals[p.key]) : F.vals[p.key]).toFixed(p.angle ? 2 : 1)}">${p.angle ? '°' : ''}</label>`;
    const grp = gk => F.L.params.filter(p => p.group === gk).map(row).join('');
    const par = k => row(F.L.params.find(p => p.key === k));
    const items = F.lists[F.menu], where = k => Object.keys(MENU_NAMES).find(m => F.lists[m].includes(k));
    const addable = Object.keys(M().buttons).filter(k => !items.includes(k));
    el.innerHTML = `<style>#gu-right .fs-row{display:grid;grid-template-columns:1fr 84px 12px;gap:6px;align-items:center;margin:3px 0;font-size:12px}#gu-right .fs-row input{width:100%}
      #gu-right .fs-item{display:grid;grid-template-columns:16px 18px 1fr auto;gap:6px;align-items:center;margin:3px 0;font-size:12px}#gu-right .fs-item .n{color:var(--dim);text-align:right}
      #gu-right .fs-item button{padding:1px 6px;min-width:0}#gu-right .fs-pl{display:grid;grid-template-columns:1fr 70px 70px;gap:6px;align-items:center;margin:3px 0;font-size:12px}#gu-right .fs-pl input{width:100%}</style>
      <h3>Layout</h3><div class="sec"><div class="note" id="fs-state"></div>
        <div class="btns"><button class="primary" id="fs-save">Save into game</button><button id="fs-undo">Undo changes</button></div>
        <div class="btns"><button id="fs-reset" title="Every place, menu, number and the bar colour back to the game's own (saved into the game)">Game's own layout</button></div>
        <div class="note">Saved into the game's program (RCT3plus.exe); it is copied first and <b>Changed files</b> puts it back. Close the game before saving.</div></div>
      <h3>Buttons · ${esc(MENU_NAMES[F.menu])}</h3><div class="sec">
        ${items.map((k, n) => `<div class="fs-item"><input type="checkbox" data-pick="${n}" ${F.sel.has(n) ? 'checked' : ''} title="Pick (Shift / Ctrl-click on the screen picks several)"><span class="n">${n + 1}</span><span>${esc(btn(k).label)}</span><span><button data-up="${n}" ${n ? '' : 'disabled'} title="Earlier (place ${n})">↑</button><button data-down="${n}" ${n < items.length - 1 ? '' : 'disabled'} title="Later (place ${n + 2})">↓</button><button data-del="${n}" title="Remove from this menu">✕</button></span></div>`).join('') || '<div class="note">No buttons in this menu.</div>'}
        ${items.length ? `<div class="btns"><button id="fs-pickall">${[...F.sel].filter(n => items[n]).length === items.length ? 'Pick none' : 'Pick all'}</button><button id="fs-delpicked" ${[...F.sel].some(n => items[n]) ? '' : 'disabled'}>Remove picked (${[...F.sel].filter(n => items[n]).length})</button></div>` : ''}
        <div class="fs-item" style="grid-template-columns:1fr auto;margin-top:8px"><select id="fs-addk" ${items.length >= NPL ? 'disabled' : ''}>${addable.map(k => { const m = where(k); return `<option value="${k}">${esc(btn(k).label)}${m ? ` (moves from ${MENU_NAMES[m]})` : ' (removed)'}</option>`; }).join('')}</select><button id="fs-add" ${items.length >= NPL || !addable.length ? 'disabled' : ''}>Add button</button></div>
        <div class="note">A button works as it does in the game wherever it sits: <b>Play</b> opens the Play menu, <b>Coaster designer</b> starts the coaster designer, and so on. Each game button can be in one menu at a time (adding it here takes it out of the other menu), and a menu holds up to ${NPL} (the game's ${NPL} places). A removed button is not shown anywhere.</div></div>
      <h3>Places</h3><div class="sec">
        ${F.places.map(([x, y], n) => `<div class="fs-pl"><span>Place ${n + 1}</span><input type="number" data-pl="${n},0" value="${Math.round(x)}" title="x (0-1024)"><input type="number" data-pl="${n},1" value="${Math.round(y)}" title="y (0-768)"></div>`).join('')}
        <div class="note">Where each place's badge sits (x 0-1024, y 0-768: the game stretches this to the window). Every menu puts its first button on place 1, its second on place 2 and so on; the bar with the button's words follows its badge.</div>
        ${par('menu_size')}
        <label class="fs-row"><span>Bar colour</span><input type="color" id="fs-colour" value="${argbCss(F.colour)}"><span></span></label>
        <details style="margin-top:6px"><summary style="cursor:pointer;color:var(--dim)">Put the places on an arc</summary>${par('menu_r')}${par('menu_start')}${par('menu_step')}
          <div class="btns"><button id="fs-arc">Put the 5 places on this arc</button></div><div class="note">The game's own way: an arc round the big circle. Angles count anticlockwise from the right (180° = straight left of the circle's centre). The arc numbers also place profile and tutorial lists past place ${NPL}.</div></details></div>
      <h3>Other pieces</h3><div class="sec">
        ${PIECES.map(([k, label]) => `<div class="fs-pl" style="${F.psel === k ? 'color:var(--accent)' : ''}"><span>${esc(label)}</span><input type="number" data-pc="${k},0" value="${Math.round(pieceXY(k)[0])}" title="x"><input type="number" data-pc="${k},1" value="${Math.round(pieceXY(k)[1])}" title="y"></div>`).join('')}
        <div class="btns"><button id="fs-pgame" title="The badges, Back / Quit and the logo where the game puts them (not saved yet)">Game's own places</button></div>
        <div class="note">Drag them on the screen. None of these is part of the background: the expansion badges (shown for the expansions installed), <b>Back</b> (in every menu but the main one), <b>Quit</b> and the RCT3 logo are each their own piece, placed by the game's code (badges and the logo by the top-left corner, Back / Quit by the centre). The kids' picture is laid out by the game from the window's size and can't be moved. Pictures: <b>Expansion badges</b> and <b>Logo…</b> below.</div></div>
      <h3>Menu words · ${esc(MENU_NAMES[F.menu])}</h3><div class="sec">${[...new Set([TITLES[F.menu], ...items.map(k => btn(k).text)])].map(k => { const t = F.texts?.find(x => x.name === k); return t ? `<label class="fs-row" style="grid-template-columns:1fr 130px 32px"><span style="color:var(--dim);font-size:11px">${esc(k.replace(/^FrontScreen_/, '').replace(/_TT$/, ''))}</span><input type="text" data-w="${k}" maxlength="${t.max}" value="${esc(word(k))}"><small>${t.max}</small></label>` : ''; }).join('')}
        <div class="btns"><button id="fs-words" ${F.words.size ? '' : 'disabled'}>Save words</button></div><div class="note">A word can be as long as the game's own (the number). Help lines and other texts: <b>Menu text</b> on the left.</div></div>
      <h3>Pictures</h3><div class="sec">${PICTURES.map(([n, label]) => `<div class="li" data-pic="${n}" style="padding-left:6px">🖼 ${esc(label)}<small>${n}</small></div>`).join('')}
        <div class="note">Opens it in the Texture Editor (paint, import a picture, save). The pieces keep their size and place.</div></div>
      <h3>Themes</h3><div class="sec">${(F.L.themes || []).map(t => `<div style="margin:4px 0"><b>${esc(t.title)}</b><div class="note">${esc(t.about)}</div><div class="btns"><button data-theme="${t.name}">Apply ${esc(t.title)}</button></div></div>`).join('')}</div>
      <h3>${esc(F.L.groups.corner)}, lists, tutorial</h3><div class="sec"><details><summary style="cursor:pointer;color:var(--dim)">More numbers</summary>${grp('corner')}<div class="grp" style="margin-top:6px">${esc(F.L.groups.list)}</div>${grp('list')}<div class="grp" style="margin-top:6px">${esc(F.L.groups.tutorial)}</div>${grp('tutorial')}</details></div>`;
    el.querySelectorAll('input[data-k]').forEach(i => i.oninput = () => { const p = F.L.params.find(q => q.key === i.dataset.k); const v = +i.value; if (!isFinite(v)) return; F.vals[p.key] = p.angle ? rad(v) : v; drawFront(); syncFrontInputs(); });
    el.querySelectorAll('input[data-pl]').forEach(i => i.oninput = () => { const [n, c] = i.dataset.pl.split(',').map(Number), v = +i.value; if (!isFinite(v) || i.value === '') return; F.places[n][c] = v; drawFront(); syncFrontInputs(); });
    el.querySelectorAll('input[data-pc]').forEach(i => i.oninput = () => { const [k, c] = i.dataset.pc.split(','), v = +i.value; if (!isFinite(v) || i.value === '') return; pieceXY(k)[+c] = v; F.psel = k; drawFront(); syncFrontInputs(); });
    $('#fs-pgame', el).onclick = () => { for (const [k] of PIECES) { const xy = pieceXY(k), g = pieceGame(k); xy[0] = g[0]; xy[1] = g[1]; } drawFront(); renderRight(); };
    const relist = fn => { fn(F.lists[F.menu]); F.sel.clear(); drawFront(); renderRight(); };
    el.querySelectorAll('input[data-pick]').forEach(i => i.onchange = () => { const n = +i.dataset.pick; i.checked ? F.sel.add(n) : F.sel.delete(n); drawFront(); renderRight(); });
    const pa = $('#fs-pickall', el); if (pa) pa.onclick = () => { if (pa.textContent === 'Pick none') { F.sel.clear(); drawFront(); renderRight(); } else pickAll(); };
    const dp = $('#fs-delpicked', el); if (dp) dp.onclick = removePicked;
    el.querySelectorAll('[data-up]').forEach(b => b.onclick = () => relist(l => { const n = +b.dataset.up; [l[n - 1], l[n]] = [l[n], l[n - 1]]; }));
    el.querySelectorAll('[data-down]').forEach(b => b.onclick = () => relist(l => { const n = +b.dataset.down; [l[n + 1], l[n]] = [l[n], l[n + 1]]; }));
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      if (F.menu === 'main' && F.lists.main.length === 1) return toast('The main menu needs at least one button', true);
      relist(l => l.splice(+b.dataset.del, 1));
    });
    $('#fs-add', el).onclick = () => {
      const k = $('#fs-addk', el).value; if (!k) return;
      const from = where(k);
      if (from === 'main' && F.lists.main.length === 1) return toast('The main menu needs at least one button', true);
      if (from) F.lists[from] = F.lists[from].filter(x => x !== k);
      relist(l => l.push(k));
      if (from) toast(`${btn(k).label} moved here from ${MENU_NAMES[from]}`);
    };
    $('#fs-arc', el).onclick = () => { for (let n = 0; n < NPL; n++) { const a = F.vals.menu_start + F.vals.menu_step * n; F.places[n] = [+(CX + F.vals.menu_r * Math.cos(a)).toFixed(2), +(CY - F.vals.menu_r * Math.sin(a)).toFixed(2)]; } drawFront(); renderRight(); };
    $('#fs-colour', el).oninput = e => { F.colour = (0xff000000 | parseInt(e.target.value.slice(1), 16)) >>> 0; drawFront(); syncFrontInputs(); };
    el.querySelectorAll('input[data-w]').forEach(i => i.oninput = () => { const t = F.texts.find(x => x.name === i.dataset.w); if (i.value === t.text) F.words.delete(t.name); else F.words.set(t.name, i.value); $('#fs-words', el).disabled = !F.words.size; drawFront(); });
    $('#fs-words', el).onclick = async () => {
      if (!S.edits[F.lang] && !await confirmBox('Save into the game', `This writes ${F.words.size} word${F.words.size > 1 ? 's' : ''} into <b>${esc(F.lang)}</b>. The original is copied first; <b>Changed files</b> puts it back.`, 'Save into game')) return;
      try { for (const [k, v] of [...F.words]) { const r = await post('/api/tx/text', { path: F.lang, name: k, text: v }); F.texts.find(x => x.name === k).text = r.text; F.words.delete(k); } setEdits((await fetch('/api/tx/gui').then(r => r.json())).edits); toast('Saved the menu words'); renderRight(); drawFront(); }
      catch (e) { toast('Could not save: ' + e.message, true); }
    };
    $('#fs-save', el).onclick = async () => {
      if (!S.edits['RCT3plus.exe'] && !await confirmBox('Save into the game', "This writes the menus' layout, their buttons and the bar colour into the game's program, <b>RCT3plus.exe</b>. The original is copied first; <b>Changed files</b> puts it back. Close the game before saving.", 'Save into game')) return;
      const values = Object.fromEntries(F.L.params.filter(p => Math.abs(F.vals[p.key] - p.value) > 1e-6).map(p => [p.key, F.vals[p.key]]));
      const body = { values, colour: F.colour !== F.L.colour ? F.colour : null };
      if (menusDirty()) Object.assign(body, { places: F.places, menus: F.lists });
      if (piecesDirty()) body.pieces = F.pieces;
      try { const r = await post('/api/tx/menu', body); F.L = { ...F.L, ...r }; takeLayout(); setEdits((await fetch('/api/tx/gui').then(r => r.json())).edits); toast('Saved the layout into RCT3plus.exe'); drawFront(); renderRight(); }
      catch (e) { toast('Could not save: ' + e.message, true); }
    };
    $('#fs-undo', el).onclick = () => { takeLayout(); F.sel.clear(); F.psel = null; drawFront(); renderRight(); };
    $('#fs-reset', el).onclick = async () => {
      if (!await confirmBox("Game's own layout", "Put every place, every menu's buttons, every number and the bar colour back to the game's own, in RCT3plus.exe?", 'Reset')) return;
      try { const r = await post('/api/tx/menu/reset', {}); F.L = { ...F.L, ...r }; takeLayout(); setEdits((await fetch('/api/tx/gui').then(r => r.json())).edits); toast("The game's own layout is back"); drawFront(); renderRight(); }
      catch (e) { toast(e.message, true); }
    };
    el.querySelectorAll('[data-pic]').forEach(d => d.onclick = () => openTexture(MAIN, d.dataset.pic + ':tex'));
    el.querySelectorAll('button[data-theme]').forEach(b => b.onclick = async () => {
      const t = F.L.themes.find(x => x.name === b.dataset.theme);
      const changed = (S.edits[MAIN]?.changes || []).some(c => PICTURES.some(([n]) => c.startsWith(n + ':')));
      if (!await confirmBox('Apply ' + t.title, `${esc(t.about)}<br><br>This draws the theme from the game's own pictures and saves the front-screen pictures, the menu words and the layout into the game (each file is copied first; <b>Changed files</b> puts them back).${changed ? '<br><br><b>The front-screen pictures are already changed:</b> Main is restored first, so every change made to it is replaced.' : ''} Close the game first.`, 'Apply theme')) return;
      b.disabled = true; b.textContent = 'Drawing…';
      try { const r = await post('/api/tx/menu/theme', { name: t.name, restore_main: changed }); setEdits(r.edits); toast(t.title + ' saved into the game'); F.texts = null; F.words.clear(); await openFront(); }
      catch (e) { toast('Could not apply: ' + e.message, true); b.disabled = false; b.textContent = 'Apply ' + t.title; }
    });
    syncFrontInputs();
  }

  function key(e) {
    if (G.front && F.L) {
      const k = e.key.toLowerCase();
      if (F.sim) { if (k === 'backspace') simBack(); return; }
      if ((k === 'delete' || k === 'backspace') && F.sel.size) { e.preventDefault(); removePicked(); }
      if (k === 'a' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); pickAll(); }
      return;
    }
    if (G.front || G.view === 'hud') return;
    const k = e.key.toLowerCase();
    if (G.view !== 'sheet' || !G.sel || !G.sheet?.icons.includes(G.sel)) { if (k === '0') view.fit(); return; }
    if (k.startsWith('arrow')) {
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1, r = [...rectOf(G.sel)], dx = k === 'arrowleft' ? -s : k === 'arrowright' ? s : 0, dy = k === 'arrowup' ? -s : k === 'arrowdown' ? s : 0;
      if (e.altKey && !sliced(G.sel)) { r[2] = Math.max(r[0] + 1, r[2] + dx); r[3] = Math.max(r[1] + 1, r[3] + dy); } else { r[0] += dx; r[2] += dx; r[1] += dy; r[3] += dy; }
      if (r[0] < 0 || r[1] < 0 || r[2] > sheetCv.width || r[3] > sheetCv.height) return;
      if (r.join() !== G.sel.rect.join()) G.moved.set(G.sel.name, r); else G.moved.delete(G.sel.name);
      view.redraw(); renderRight();
    }
    if (k === '0') view.fit();
    if (k === 'enter') openTexture(G.sheet.path, G.sheet.name, { rect: rectOf(G.sel) });
  }

  let loading = null;
  async function shown() {
    G.sheets.clear();                                  // sheets may have been painted in the Texture Editor
    if (G.ovl && G.view === 'sheet') showSheet(true);
    if (G.ovl && G.view === 'hud') { HS.icons.clear(); hudPrepare().then(drawHud); renderRight(); }
    if (G.front) loadFrontTextures().then(drawFront);       // pictures may have been painted in the Texture Editor
    if (!S.gui && !loading) loading = fetch('/api/tx/gui').then(r => r.json()).then(c => { S.gui = c; setEdits(c.edits); renderLeft(); if (!G.ovl && !G.lang && !G.front) openOvl(c.icons.find(o => /^main\.common/i.test(o.path))?.path || c.icons[0]?.path); });
    view.redraw();
  }
  // Esc in the simulation goes back a menu instead of leaving the editor
  const escape = () => { if (G.view === 'hud' && !G.front && G.ovl) return hudEscape(); if (!G.front || !F.sim) return false; simBack(); return true; };
  return { shown, key, escape, afterRestore };
}
