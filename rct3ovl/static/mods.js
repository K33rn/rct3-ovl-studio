// Mod Loader: all the custom content in the game in one place - scenery sets, paths, custom rides and their cars,
// station platforms, fireworks, lasers, water jets, coaster designs, scenarios, structures, billboards, music - with
// where each piece is, what designs and scenarios still need, and installing a download (.zip / .rar / .7z or loose
// files) to the right folders without going through each tab. Opened full-window from the viewer's Mod Loader tab.
import { runTour } from './tour.js';

let ui = null;
export async function openMods({ onBack, openTab }) {
  if (!ui) ui = build();
  Object.assign(ui, { onBack, openTab, changed: false });
  ui.root.style.display = 'grid';
  await ui.refresh();
  setTimeout(() => ui.tour(false), 600);
}

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const size = n => n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B';
const plural = (n, one, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const ICON = { scenery: '🌳', path: '🧱', ride: '🎢', cars: '🚃', station: '🚉', plugin: '🧩', game: '📦', design: '📐', firework: '🎆', laser: '🔦',
               waterjet: '⛲', show: '🎇', scenario: '🗺', park: '🏞', structure: '🏗', peep: '🧍', billboard: '🖼', picture: '🖼', music: '🎵' };
const TAB_LABEL = { scenery: 'Scenery tab', designs: 'Ride Designs tab', fireworks: 'MixMaster' };
const AREA_LABEL = { game: 'game folder', user: 'your RCT3 folder', pictures: 'Pictures\\RCT3', music: 'Music\\RCT3' };

function build() {
  const css = document.createElement('style');
  css.textContent = `
  #md { position: fixed; inset: 0; z-index: 50; display: none; background: var(--bg); color: var(--text);
        grid-template-columns: 230px minmax(0, 1fr) minmax(380px, 34%); grid-template-rows: auto minmax(0, 1fr); }
  #md .bar { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--panel2);
             border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  #md .bar h2 { margin: 0 6px 0 4px; font-size: 15px; color: var(--accent); white-space: nowrap; }
  #md .bar .grow { flex: 1; }
  #md .bar input[type=search] { background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; width: 200px; }
  #md .back { border-color: var(--accent); color: var(--accent); }
  #md .primary { background: var(--accent); color: #111; border-color: var(--accent); font-weight: 600; }
  #md .side { background: var(--panel); min-height: 0; overflow: auto; }
  #md .side.left { border-right: 1px solid var(--line); padding: 6px 0 16px; }
  #md .side.right { border-left: 1px solid var(--line); }
  #md .mid { min-height: 0; overflow: auto; padding: 10px 14px 30px; }
  #md .grp { padding: 12px 12px 4px; color: var(--accent); font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  #md .cat { display: flex; gap: 8px; padding: 5px 12px; cursor: pointer; align-items: center; }
  #md .cat:hover { background: var(--panel2); } #md .cat.sel { background: var(--sel); }
  #md .cat .n { margin-left: auto; color: var(--dim); font-size: 11px; font-variant-numeric: tabular-nums; }
  #md .cat .i { width: 20px; text-align: center; }
  #md h3.sec { margin: 16px 0 8px; font-size: 12px; color: var(--accent); text-transform: uppercase; letter-spacing: .5px; display: flex; gap: 8px; align-items: baseline; }
  #md h3.sec:first-child { margin-top: 4px; } #md h3.sec small { color: var(--dim); text-transform: none; letter-spacing: 0; font-weight: 400; }
  #md .pkg { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 9px 12px; margin-bottom: 8px; cursor: pointer; }
  #md .pkg:hover { border-color: var(--dim); } #md .pkg.sel { border-color: var(--accent); background: var(--sel); }
  #md .pkg.off { opacity: .55; }
  #md .pkg .t { display: flex; gap: 8px; align-items: baseline; }
  #md .pkg .t b { font-size: 14px; } #md .pkg .t .r { margin-left: auto; color: var(--dim); font-size: 11px; white-space: nowrap; }
  #md .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  #md .chip { font-size: 11px; background: var(--panel2); border: 1px solid var(--line); border-radius: 10px; padding: 1px 8px; white-space: nowrap; }
  #md .badge { font-size: 10px; border-radius: 4px; padding: 0 5px; border: 1px solid var(--line); color: var(--dim); text-transform: uppercase; letter-spacing: .4px; }
  #md .badge.on { color: #7fd17f; border-color: #3d6b3d; } #md .badge.off { color: #e0a050; border-color: #6b5530; }
  #md .badge.new { color: #7fd17f; border-color: #3d6b3d; } #md .badge.replace { color: #e0a050; border-color: #6b5530; }
  #md .det { padding: 12px 14px 30px; }
  #md .det h2 { margin: 0 0 4px; font-size: 17px; }
  #md .det .sub { color: var(--dim); font-size: 12px; margin-bottom: 10px; }
  #md .det .acts { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }
  #md .det h4 { margin: 16px 0 6px; font-size: 12px; color: var(--accent); text-transform: uppercase; letter-spacing: .5px; }
  #md table.sets { width: 100%; border-collapse: collapse; font-size: 12px; }
  #md table.sets td { padding: 5px 4px; border-top: 1px solid var(--line); vertical-align: top; }
  #md table.sets td.r { text-align: right; white-space: nowrap; color: var(--dim); font-variant-numeric: tabular-nums; }
  #md table.sets .where { color: var(--dim); font-size: 11px; word-break: break-all; }
  #md .ok { color: #7fd17f; } #md .warn { color: #e0a050; } #md .bad { color: #ef6b6b; }
  #md .need { border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; margin-bottom: 6px; font-size: 12px; background: var(--bg); }
  #md .need ul { margin: 4px 0 0 18px; padding: 0; } #md .need li { margin: 1px 0; }
  #md pre.readme { white-space: pre-wrap; font: 12px/1.45 ui-monospace, Consolas, monospace; background: var(--bg); border: 1px solid var(--line);
                   border-radius: 8px; padding: 8px 10px; max-height: 340px; overflow: auto; margin: 0 0 8px; }
  #md details { margin: 6px 0; } #md summary { cursor: pointer; color: var(--dim); font-size: 12px; }
  #md .files { font: 11px/1.5 ui-monospace, Consolas, monospace; color: var(--dim); max-height: 300px; overflow: auto; word-break: break-all; }
  #md .empty { color: var(--dim); padding: 30px 10px; text-align: center; line-height: 1.6; }
  #md .drop { position: absolute; inset: 0; z-index: 5; display: none; place-items: center; background: #0a0d14d8; border: 3px dashed var(--accent);
              color: var(--accent); font-size: 22px; font-weight: 600; pointer-events: none; }
  #md.dragging .drop { display: grid; }
  #md .modal { position: fixed; inset: 0; z-index: 60; background: #0008; display: none; place-items: center; }
  #md .modal.open { display: grid; }
  #md .dlg { width: min(900px, 94vw); max-height: 88vh; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line);
             border-radius: 10px; box-shadow: 0 10px 40px #0009; }
  #md .dlg .hd { padding: 12px 16px; border-bottom: 1px solid var(--line); display: flex; gap: 10px; align-items: center; }
  #md .dlg .hd h3 { margin: 0; font-size: 15px; color: var(--accent); }
  #md .dlg .hd input { flex: 1; background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; font-size: 14px; }
  #md .dlg .bd { padding: 10px 16px; overflow: auto; flex: 1; }
  #md .dlg .ft { padding: 10px 16px; border-top: 1px solid var(--line); display: flex; gap: 8px; align-items: center; }
  #md .dlg .ft .grow { flex: 1; color: var(--dim); font-size: 12px; }
  #md .dlg table.sets td:first-child { width: 22px; }
  #md .toast { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); background: #0a0d14ee; color: #fff; padding: 8px 14px;
               border-radius: 8px; z-index: 70; font-size: 13px; display: none; max-width: 80vw; }
  #md .toast.err { background: #5a1c1c; }
  `;
  document.head.appendChild(css);
  const root = document.createElement('div'); root.id = 'md';
  root.innerHTML = `
    <div class="bar">
      <button class="back" id="md-back" title="Back to the viewer (Esc)">◀ Back</button>
      <h2>Mod Loader</h2><span class="sub" id="md-where" style="color:var(--dim);font-size:12px"></span>
      <span class="grow"></span>
      <input type="search" id="md-filter" placeholder="Find content">
      <button class="primary" id="md-add" title="Install a download: .zip, .rar or .7z, or loose .trk / .frw / .dat / .ovl files (or drop them on this window)">＋ Install content…</button>
      <button id="md-path" title="Install a download that is already unpacked in a folder on this computer">From a folder…</button>
      <button id="md-reload" title="Look at the game's folders again">⟳</button>
      <button id="md-tour" title="Walkthrough of the Mod Loader">? Tour</button>
      <input type="file" id="md-file" multiple hidden>
    </div>
    <div class="side left" id="md-cats"></div>
    <div class="mid" id="md-list"></div>
    <div class="side right"><div class="det" id="md-det"></div></div>
    <div class="drop">Drop downloads here to install them</div>
    <div class="modal" id="md-modal"><div class="dlg">
      <div class="hd"><h3>Install</h3><input id="md-name" title="The name this package is listed under"></div>
      <div class="bd" id="md-plan"></div>
      <div class="ft"><span class="grow" id="md-plansum"></span><button id="md-cancel">Cancel</button><button class="primary" id="md-go">Install</button></div>
    </div></div>
    <div class="toast" id="md-toast"></div>`;
  document.body.appendChild(root);

  const S = { data: null, cat: 'all', sel: null, queue: [], plan: null };
  const toast = (t, err) => { const el = $('#md-toast', root); el.textContent = t; el.classList.toggle('err', !!err); el.style.display = 'block';
    clearTimeout(toast.t); toast.t = setTimeout(() => { el.style.display = 'none'; }, err ? 7000 : 3500); };
  const api = async (url, body) => {
    const r = await fetch(url, body === undefined ? undefined : { method: 'POST', body: body instanceof Blob ? body : JSON.stringify(body) });
    const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.statusText); return j;
  };
  const kindLabel = k => S.data?.kinds[k]?.label || k;

  async function refresh(keep = true) {
    try { S.data = await api('/api/mods'); } catch (e) { toast('Could not read the game folders: ' + e.message, true); return; }
    const a = S.data.areas;
    $('#md-where', root).textContent = `game folder: ${a.game} · your folder: ${a.user}`;
    if (!keep || !all().some(p => p.id === S.sel)) S.sel = null;
    renderCats(); renderList(); renderDetails();
  }
  const all = () => [...(S.data?.packages || []), ...(S.data?.found || [])];
  const matches = p => {
    const f = $('#md-filter', root).value.trim().toLowerCase();
    if (S.cat === 'installed' && p.origin === 'found' && !S.data.packages.includes(p)) return false;
    if (S.cat === 'found' && S.data.packages.includes(p)) return false;
    if (S.cat === 'off' && p.enabled) return false;
    if (S.cat in (S.data?.kinds || {}) && !p.kinds[S.cat]) return false;
    return !f || p.name.toLowerCase().includes(f) || p.sets.some(s => s.set.toLowerCase().includes(f)) || p.source.toLowerCase().includes(f);
  };

  function renderCats() {
    const ps = all(), n = k => ps.filter(p => p.kinds[k]).reduce((t, p) => t + p.sets.filter(s => s.kind === k).length, 0);
    const row = (id, icon, label, count) => `<div class="cat${S.cat === id ? ' sel' : ''}" data-c="${id}"><span class="i">${icon}</span>${esc(label)}<span class="n">${count}</span></div>`;
    let h = '<div class="grp">Show</div>' + row('all', '★', 'Everything', ps.length) +
      row('installed', '⬇', 'Installed here', S.data.packages.length) + row('found', '🔍', 'Found in the game', S.data.found.length) +
      row('off', '⏸', 'Disabled', ps.filter(p => !p.enabled).length) + '<div class="grp">By kind <small style="text-transform:none;color:var(--dim)">(sets)</small></div>';
    for (const k of Object.keys(S.data.kinds)) { const c = n(k); if (c) h += row(k, ICON[k] || '•', S.data.kinds[k].label, c); }
    $('#md-cats', root).innerHTML = h;
  }

  function card(p) {
    const kinds = Object.entries(p.kinds).map(([k, c]) => `<span class="chip">${ICON[k] || ''} ${esc(kindLabel(k))}${c > 1 ? ' × ' + c : ''}</span>`).join('');
    return `<div class="pkg${p.id === S.sel ? ' sel' : ''}${p.enabled ? '' : ' off'}" data-id="${esc(p.id)}">
      <div class="t"><b>${esc(p.name)}</b>${p.enabled ? '' : '<span class="badge off">disabled</span>'}
        <span class="r">${plural(p.files, 'file')} · ${size(p.size)}</span></div>
      <div class="chips">${kinds}</div></div>`;
  }
  function renderList() {
    const mine = S.data.packages.filter(matches), found = S.data.found.filter(matches);
    let h = '';
    const fx = S.data.ride_fixes || [];
    if (fx.length) h += `<div class="need" id="md-fixbox"><div class="warn">⚠ ${plural(fx.length, 'custom flat ride')} won't be drawn in the game once placed
      (only ${fx.length === 1 ? 'its' : 'their'} shadow shows): ${fx.map(f => `<b>${esc(f.set.split('/').pop())}</b>`).join(', ')}.</div>
      <div style="font-size:12px;color:var(--dim);margin:4px 0">${fx.length === 1 ? 'Its model is' : 'Their models are'} marked as only as tall as the ride; the game needs a much taller box
      to draw a placed flat ride (as CFH's Kamikaze and Cinipaes' Mega Disko have). The files are copied to the Mod Loader's store first.</div>
      <button data-fix="1">Fix ${fx.length === 1 ? 'it' : 'them'}</button></div>`;
    const ad = S.data.additions || [];
    if (ad.length && S.cat === 'all') h += `<h3 class="sec">Additions <small>new pieces for the game's own rides, built from your game's files</small></h3>` +
      ad.map(a => `<div class="need"><b>${esc(a.name)}</b> ${a.installed ? '<span class="badge on">added</span>' : ''}
        <div style="color:var(--dim);margin:3px 0 6px">${esc(a.about)}</div>
        <button data-add="${esc(a.id)}" data-on="${a.installed ? 0 : 1}" title="${a.installed ? 'Put the changed game files back as they were and remove the new ones'
          : 'Back up the files it changes, then add it (close RollerCoaster Tycoon 3 first)'}">${a.installed ? 'Remove' : 'Add to the game'}</button></div>`).join('');
    if (S.cat !== 'found') h += `<h3 class="sec">Installed with the Mod Loader <small>${mine.length ? '' : 'nothing yet'}</small></h3>` + mine.map(card).join('');
    if (S.cat !== 'installed') h += `<h3 class="sec">Found in the game <small>custom content put there some other way - it can be disabled or removed here too</small></h3>` +
      (found.length ? found.map(card).join('') : '<div class="empty">No other custom content in the game folders.</div>');
    if (!S.data.packages.length && !S.data.found.length)
      h = `<div class="empty">No custom content yet.<br>Press <b>＋ Install content…</b> or drop a download (.zip, .rar, .7z, .trk, .frw…) on this window.</div>`;
    $('#md-list', root).innerHTML = h;
  }

  async function renderDetails() {
    const det = $('#md-det', root), p = all().find(x => x.id === S.sel);
    if (!p) {
      det.innerHTML = `<div class="empty">Pick a package to see what it holds, where its files are, and what its designs and scenarios need.<br><br>
        <b>Installing:</b> ＋ Install content… (or drop files here). Each file goes where the game looks for it: scenery sets into Style\\Themed,
        paths into Path, custom rides into Tracks and Cars, station platforms into tracks\\Platforms, fireworks, designs, scenarios and structures
        into your RCT3 folder, billboards into Pictures\\RCT3 and music into Music\\RCT3.</div>`;
      return;
    }
    det.innerHTML = '<div class="empty">Loading…</div>';
    let d;
    try { d = await api('/api/mods/package?id=' + encodeURIComponent(p.id)); } catch (e) { det.innerHTML = `<div class="empty bad">${esc(e.message)}</div>`; return; }
    if (S.sel !== p.id) return;
    const s = d.summary, found = s.origin === 'found' && !S.data.packages.some(x => x.id === s.id);
    const tabs = [...new Set(s.sets.map(x => S.data.kinds[x.kind]?.tab).filter(Boolean))];
    const sets = s.sets.map(x => `<tr><td>${ICON[x.kind] || ''}</td><td><b>${esc(x.set)}</b><br><span class="where">${esc(x.where)}</span></td>
      <td>${esc(kindLabel(x.kind))}</td><td class="r">${plural(x.files, 'file')}<br>${size(x.size)}</td></tr>`).join('');
    const needs = (d.needs || []).map(n => {
      if (n.error) return `<div class="need"><b>${esc(n.file)}</b>: <span class="bad">could not be read (${esc(n.error)})</span></div>`;
      const ok = !n.missing_sets.length && !n.missing_rides.length;
      return `<div class="need"><b>${esc(n.file)}</b> ${ok ? `<span class="ok">✓ everything it uses is in the game${n.custom_sets ? ` (${plural(n.custom_sets, 'custom set')})` : ''}</span>` : ''}
        ${n.missing_rides.length ? `<div class="bad">✗ needs the custom ride ${n.missing_rides.map(r => `<b>${esc(r.replace(/:trr$/i, ''))}</b>`).join(', ')} - not installed: the ride won't load</div>` : ''}
        ${n.missing_sets.length ? `<div class="warn">⚠ ${plural(n.missing_sets.length, 'custom set')} not installed - the game leaves those pieces out:</div>
          <ul>${n.missing_sets.slice(0, 30).map(m => `<li>${esc(m.set)} <span style="color:var(--dim)">(${plural(m.items, 'item')}, e.g. ${esc(m.examples.slice(0, 2).join(', '))})</span></li>`).join('')}
          ${n.missing_sets.length > 30 ? `<li>…and ${n.missing_sets.length - 30} more</li>` : ''}</ul>` : ''}</div>`;
    }).join('');
    const readme = (d.readme || []).map(r => `<details ${d.readme.length === 1 ? 'open' : ''}><summary>${esc(r.file)}</summary><pre class="readme">${esc(r.text)}</pre></details>`).join('');
    const missing = d.files.filter(f => !f.present).length;
    det.innerHTML = `<h2>${esc(s.name)}</h2>
      <div class="sub">${found ? 'Found in the game (not installed with the Mod Loader)' : s.origin === 'found' ? 'Was in the game; managed here since'
        : `Installed ${esc(s.installed)} from <b>${esc(s.source)}</b>`} · ${plural(s.files, 'file')} · ${size(s.size)}
        · <span class="badge ${s.enabled ? 'on' : 'off'}">${s.enabled ? 'enabled' : 'disabled'}</span></div>
      <div class="acts">
        ${tabs.map(t => `<button data-tab="${t}" ${s.enabled ? '' : 'disabled'} title="Look at it in the viewer">Show in the ${esc(TAB_LABEL[t] || t)}</button>`).join('')}
        <button data-act="toggle" title="${s.enabled ? 'Take its files out of the game for now (they are kept, and anything they replaced comes back)' : 'Put its files back into the game'}">${s.enabled ? '⏸ Disable' : '▶ Enable'}</button>
        <button data-act="remove" title="${s.origin === 'found' ? 'Take it out of the game: its files are moved to the Mod Loader\'s removed folder, not deleted' : 'Delete its files from the game and put back anything they replaced (your download still has them)'}">🗑 ${s.origin === 'found' ? 'Remove' : 'Uninstall'}</button>
      </div>
      ${missing && s.enabled ? `<div class="warn" style="font-size:12px">⚠ ${plural(missing, 'file')} of this package ${missing === 1 ? 'is' : 'are'} no longer where ${missing === 1 ? 'it was' : 'they were'} put.</div>` : ''}
      ${needs ? `<h4>What its designs and scenarios need</h4>${needs}` : ''}
      <h4>What it holds</h4><table class="sets">${sets}</table>
      ${readme ? `<h4>Readme</h4>${readme}` : ''}
      <details><summary>All ${plural(d.files.length, 'file')}</summary><div class="files">${d.files.slice(0, 2000).map(f => `${f.present ? '' : '✗ '}${esc(f.path)}`).join('<br>')}</div></details>`;
  }

  // ---- installing ------------------------------------------------------------------------------------------------
  async function addFiles(files) {
    for (const f of files) S.queue.push(f);
    if (!S.plan) next();
  }
  async function next() {
    const f = S.queue.shift();
    if (!f) return;
    toast(`Unpacking ${f.name} (${size(f.size)})…`);
    try { showPlan(await api('/api/mods/upload?name=' + encodeURIComponent(f.name), f)); }
    catch (e) { toast(`${f.name}: ${e.message}`, true); next(); }
  }
  function showPlan(plan) {
    S.plan = plan; $('#md-toast', root).style.display = 'none';
    $('#md-name', root).value = plan.name;
    const groups = {};
    for (const it of plan.items) {
      const g = groups[it.kind + '/' + it.set] ??= { kind: it.kind, set: it.set, area: it.area, dirs: new Set(), n: 0, size: 0, st: {} };
      g.n++; g.size += it.size; g.st[it.state] = (g.st[it.state] || 0) + 1; g.dirs.add(it.rel.includes('/') ? it.rel.slice(0, it.rel.lastIndexOf('/')) : '');
    }
    const where = g => {
      const base = plan.areas[g.area], ds = [...g.dirs].sort();
      const top = ds.length > 1 ? ds.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, a.slice(0, i).lastIndexOf('/') + 1 || i); }) : ds[0];
      return base + (top ? '\\' + top.replace(/\/$/, '').replace(/\//g, '\\') : '');
    };
    const rows = Object.entries(groups).map(([key, g]) => `<tr><td><input type="checkbox" data-g="${esc(key)}" checked></td>
      <td>${ICON[g.kind] || ''} <b>${esc(g.set)}</b> · ${esc(kindLabel(g.kind))}<br><span class="where">→ ${esc(where(g))}</span></td>
      <td class="r">${plural(g.n, 'file')}<br>${size(g.size)}</td>
      <td class="r">${g.st.new ? `<span class="badge new">${g.st.new} new</span> ` : ''}${g.st.replace ? `<span class="badge replace" title="A different file of the same name is there now; it is copied first and put back if you uninstall">${g.st.replace} replace</span> ` : ''}${g.st.same ? `<span class="badge" title="Exactly this file is already there">${g.st.same} already there</span>` : ''}</td></tr>`).join('');
    const needs = (plan.needs || []).filter(n => n.error || n.missing_sets?.length || n.missing_rides?.length).map(n => `<div class="need"><b>${esc(n.file)}</b>
      ${n.error ? `<span class="bad">could not be read</span>` : ''}
      ${n.missing_rides?.length ? `<div class="bad">✗ needs the custom ride ${n.missing_rides.map(r => `<b>${esc(r.replace(/:trr$/i, ''))}</b>`).join(', ')}, which isn't in the game or this download</div>` : ''}
      ${n.missing_sets?.length ? `<div class="warn">⚠ uses ${plural(n.missing_sets.length, 'custom set')} that ${n.missing_sets.length === 1 ? "isn't" : "aren't"} installed: ${n.missing_sets.slice(0, 12).map(m => esc(m.set.split('/').pop())).join(', ')}${n.missing_sets.length > 12 ? '…' : ''}</div>` : ''}</div>`).join('');
    const skipped = plan.skipped.length ? `<details><summary>${plural(plan.skipped.length, 'file')} not installed (readmes, pictures, duplicates)</summary>
      <div class="files">${plan.skipped.map(s => `${esc(s.rel)} - ${esc(s.why)}`).join('<br>')}</div></details>` : '';
    const fixed = (plan.fixed || []).length ? `<div class="need"><span class="ok">✓ ${plural(plan.fixed.length, 'flat ride')} made drawable:</span>
      ${plan.fixed.map(f => `<b>${esc(f.set)}</b>`).join(', ')} <span style="color:var(--dim)">(the game leaves a placed flat ride undrawn unless its model's box is very tall;
      the copy installed has that box)</span></div>` : '';
    const readme = plan.readme.map(r => `<details><summary>Readme:${esc(r.file)}</summary><pre class="readme">${esc(r.text)}</pre></details>`).join('');
    $('#md-plan', root).innerHTML = plan.items.length ? `<table class="sets">${rows}</table>
      ${needs ? `<h4 style="margin:14px 0 6px;font-size:12px;color:var(--accent);text-transform:uppercase">Still needed</h4>
        <div style="font-size:12px;color:var(--dim);margin-bottom:6px">Designs and scenarios in this download use content that isn't in the game. They install anyway; the game leaves out what it can't find. The readme usually says where to get it.</div>${needs}` : ''}
      ${fixed}${skipped}${readme}` : `<div class="empty">Nothing in <b>${esc(plan.source)}</b> is content the game uses.</div>${skipped}${readme}`;
    const upd = () => {
      const on = [...root.querySelectorAll('#md-plan input[data-g]')].filter(c => c.checked).map(c => groups[c.dataset.g]);
      const n = on.reduce((t, g) => t + g.n - (g.st.same || 0), 0);
      $('#md-plansum', root).textContent = n ? `${plural(n, 'file')} to copy (${plural(on.length, 'group')})` : 'nothing to copy';
      $('#md-go', root).disabled = !n;
    };
    root.querySelectorAll('#md-plan input[data-g]').forEach(c => c.onchange = upd);
    upd();
    $('#md-modal', root).classList.add('open');
  }
  async function closePlan(cancelled) {
    const p = S.plan; S.plan = null; $('#md-modal', root).classList.remove('open');
    if (cancelled && p) api('/api/mods/cancel', { token: p.token }).catch(() => {});
    next();
  }
  $('#md-cancel', root).onclick = () => closePlan(true);
  $('#md-go', root).onclick = async () => {
    const p = S.plan, btn = $('#md-go', root);
    const leave = [...root.querySelectorAll('#md-plan input[data-g]')].filter(c => !c.checked).map(c => c.dataset.g);
    btn.disabled = true; btn.textContent = 'Installing…';
    try {
      const rec = await api('/api/mods/install', { token: p.token, name: $('#md-name', root).value, leave_out: leave });
      ui.changed = true; S.sel = rec.id; S.cat = 'all';
      toast(`Installed ${rec.name}: ${plural(rec.files, 'file')}`);
      S.plan = null; $('#md-modal', root).classList.remove('open');
      await refresh(); next();
    } catch (e) { toast(e.message, true); }
    btn.disabled = false; btn.textContent = 'Install';
  };

  // ---- events ----------------------------------------------------------------------------------------------------
  $('#md-back', root).onclick = () => { root.style.display = 'none'; ui.onBack?.(ui.changed); };
  $('#md-reload', root).onclick = () => refresh();
  $('#md-tour', root).onclick = () => ui.tour(true);
  $('#md-filter', root).oninput = () => renderList();
  $('#md-add', root).onclick = () => $('#md-file', root).click();
  $('#md-file', root).onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
  $('#md-path', root).onclick = async () => {
    const path = prompt('A download on this computer: a folder (already unpacked), an archive or a single file - paste its full path');
    if (!path) return;
    toast('Reading ' + path + '…');
    try { showPlan(await api('/api/mods/plan', { path: path.trim().replace(/^"|"$/g, '') })); } catch (e) { toast(e.message, true); }
  };
  $('#md-cats', root).onclick = e => { const c = e.target.closest('.cat'); if (!c) return; S.cat = c.dataset.c; renderCats(); renderList(); };
  $('#md-list', root).onclick = async e => {
    const fb = e.target.closest('button[data-fix]');
    if (fb) {
      fb.disabled = true;
      try { const r = await api('/api/mods/fixrides', {}); toast(`Fixed ${plural(r.fixed.length, 'flat ride')}`); ui.changed = true; await refresh(); }
      catch (err) { toast(err.message, true); fb.disabled = false; }
      return;
    }
    const ab = e.target.closest('button[data-add]');
    if (ab) {
      const on = ab.dataset.on === '1';
      ab.disabled = true; toast(on ? 'Building it from your game files…' : 'Putting the game files back…');
      try { S.data = await api('/api/mods/addition', { id: ab.dataset.add, on }); toast(on ? 'Added - start the game to build with it' : 'Removed');
            ui.changed = true; renderCats(); renderList(); renderDetails(); }
      catch (err) { toast(err.message, true); ab.disabled = false; }
      return;
    }
    const p = e.target.closest('.pkg'); if (!p) return;
    S.sel = p.dataset.id; root.querySelectorAll('.pkg').forEach(x => x.classList.toggle('sel', x === p)); renderDetails();
  };
  $('#md-det', root).onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    const p = all().find(x => x.id === S.sel); if (!p) return;
    if (b.dataset.tab) {
      const set = p.sets.find(s => S.data.kinds[s.kind]?.tab === b.dataset.tab);
      root.style.display = 'none'; ui.onBack?.(ui.changed); ui.changed = false;
      return ui.openTab?.(b.dataset.tab, set?.set);
    }
    const act = b.dataset.act;
    if (act === 'remove' && !confirm(p.origin === 'found'
      ? `Remove "${p.name}" from the game? Its ${plural(p.files, 'file')} are moved to the Mod Loader's removed folder, not deleted.`
      : `Uninstall "${p.name}"? Its ${plural(p.files, 'file')} are deleted from the game (your download still has them).`)) return;
    b.disabled = true;
    try {
      if (act === 'toggle') { const r = await api('/api/mods/enable', { id: p.id, on: !p.enabled }); S.sel = r.id; toast(`${r.name} ${r.enabled ? 'enabled' : 'disabled'}`); }
      if (act === 'remove') { await api('/api/mods/uninstall', { id: p.id }); S.sel = null; toast(`${p.name} ${p.origin === 'found' ? 'removed' : 'uninstalled'}`); }
      ui.changed = true; await refresh();
    } catch (err) { toast(err.message, true); b.disabled = false; }
  };
  // drop downloads anywhere on the window
  let depth = 0;
  root.addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { depth++; root.classList.add('dragging'); e.preventDefault(); } });
  root.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; root.classList.remove('dragging'); } });
  root.addEventListener('dragover', e => e.preventDefault());
  root.addEventListener('drop', e => { e.preventDefault(); depth = 0; root.classList.remove('dragging'); addFiles([...e.dataTransfer.files]); });
  document.addEventListener('keydown', e => {
    if (root.style.display !== 'grid' || e.key !== 'Escape') return;
    if (S.plan) return closePlan(true);
    $('#md-back', root).click();
  });

  // ---- walkthrough --------------------------------------------------------------------------------------------------
  const TOUR = [
    { title: 'The Mod Loader', html: `<p>Everything custom in the game in one place: scenery sets, paths, custom rides and their cars, station platforms,
      fireworks, lasers, water jets, coaster designs, scenarios, structures, billboards and music.</p><p>You can install a download here
      instead of copying its files around by hand, and turn content off and on again.</p>` },
    { target: '#md-add', title: 'Installing a download', html: `<p>Pick the file you downloaded - <b>.zip</b>, <b>.rar</b> or <b>.7z</b>, or loose
      <b>.trk</b>, <b>.frw</b>, <b>.dat</b> files - or drop it on this window. Several at once is fine.</p><p>The Mod Loader looks inside each file
      to see what it is, whatever the readme says, and shows where everything will go before anything is copied.</p>` },
    { target: '#md-cats', title: 'What is installed', html: `<p>Packages installed here, content found in the game that was put there some
      other way, disabled packages, and every kind of content with how many sets of it there are.</p>` },
    { target: '#md-list', title: 'Packages', html: `<p>Each download is one package. Pick one to see its sets, where each is in the game, its readme,
      and for designs and scenarios, which custom sets or rides they need that the game doesn't have.</p>` },
    { target: '#md-det', title: 'Disable, uninstall, look at it', html: `<p><b>Disable</b> takes a package's files out of the game without
      deleting them (and puts back anything they replaced); <b>Enable</b> brings them back. <b>Uninstall</b> deletes them from the game.
      Content you didn't install here is <b>removed</b> to a safe folder instead of being deleted.</p><p><b>Show in…</b> opens the tab that
      shows it: scenery sets, ride designs, fireworks.</p>` },
  ];
  return { root, refresh, tour: force => runTour('mods', TOUR, { force }) };
}
