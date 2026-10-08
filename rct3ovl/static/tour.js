// Guided walkthroughs: a spotlight on one part of the screen at a time with a card explaining it (Back / Next / Skip,
// ← → Enter Esc). A tour runs by itself the first time its part of the program is opened; "? Tour" buttons replay it.
// Each step: { target: selector or () => element (none: a card in the middle), title, html, before: async () => {...}
// (opens the right tab or panel first), action: { label, run } (an extra button on the last step) }.

const CSS = `
  #tour { position: fixed; inset: 0; z-index: 3000; font: 13px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
  #tour .tblock { position: absolute; inset: 0; }
  #tour .thole { position: absolute; border-radius: 9px; box-shadow: 0 0 0 9999px rgba(4, 6, 12, 0.72); border: 2px solid var(--accent, #ffb02e);
                 pointer-events: none; transition: opacity .18s; }
  #tour .thole.none { border: 0; left: 50% !important; top: 50% !important; width: 0 !important; height: 0 !important; }
  #tour .tcard { position: absolute; width: min(400px, calc(100vw - 24px)); background: var(--panel, #171a21); color: var(--text, #e6e9ef);
                 border: 1px solid var(--accent, #ffb02e); border-radius: 12px; padding: 14px 16px 12px; box-shadow: 0 14px 50px #000c;
                 transition: opacity .18s; }
  #tour .tcard h4 { margin: 0 0 6px; color: var(--accent, #ffb02e); font-size: 15px; }
  #tour .tcard .tbody { color: var(--text, #e6e9ef); }
  #tour .tcard .tbody p { margin: 0 0 7px; } #tour .tcard .tbody ul { margin: 2px 0 8px; padding-left: 18px; } #tour .tcard .tbody li { margin: 2px 0; }
  #tour .tcard kbd { font: 11px ui-monospace, Consolas, monospace; background: #0004; border: 1px solid #fff3; border-radius: 4px; padding: 0 4px; }
  #tour .tcard b { color: #fff; }
  #tour .tfoot { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  #tour .tfoot .tcount { color: var(--dim, #8a93a3); font-size: 11px; margin-right: auto; }
  #tour .tfoot button { background: var(--panel2, #1f232c); color: var(--text, #e6e9ef); border: 1px solid var(--line, #2c313c); border-radius: 6px; padding: 4px 11px; cursor: pointer; font: inherit; }
  #tour .tfoot button:hover { border-color: var(--accent, #ffb02e); }
  #tour .tfoot button.tnext { background: var(--accent, #ffb02e); color: #111; border-color: var(--accent, #ffb02e); font-weight: 600; }
  #tour .tbar { height: 3px; background: var(--line, #2c313c); border-radius: 2px; margin-top: 10px; overflow: hidden; }
  #tour .tbar i { display: block; height: 100%; background: var(--accent, #ffb02e); transition: width .25s; }
`;
let styled = false, running = null;

const key = id => 'rct3ovl.tour.' + id;
export function tourSeen(id) { try { return !!localStorage.getItem(key(id)); } catch (e) { return true; } }
export function markSeen(id) { try { localStorage.setItem(key(id), '1'); } catch (e) {} }
export const tourRunning = () => !!running;

export function runTour(id, steps, { force = false, onEnd } = {}) {
  if (running || (!force && tourSeen(id))) return false;
  if (!styled) { const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); styled = true; }
  const el = document.createElement('div'); el.id = 'tour';
  el.innerHTML = `<div class="tblock"></div><div class="thole none"></div><div class="tcard"><h4></h4><div class="tbody"></div><div class="tbar"><i></i></div>
    <div class="tfoot"><span class="tcount"></span><button class="tskip">Skip tour</button><button class="tback">← Back</button><button class="tact" style="display:none"></button><button class="tnext">Next →</button></div></div>`;
  document.body.appendChild(el);
  const hole = el.querySelector('.thole'), card = el.querySelector('.tcard');
  let i = 0, target = null, raf = 0, seq = 0;
  running = { id };

  const find = s => typeof s.target === 'function' ? s.target() : s.target ? document.querySelector(s.target) : null;
  const visible = e => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  async function waitFor(s) {
    if (!s.target) return null;
    for (let k = 0; k < 80; k++) { const e = find(s); if (visible(e)) return e; await new Promise(r => setTimeout(r, 100)); }
    return null;
  }
  function place() {
    const W = innerWidth, H = innerHeight, cw = card.offsetWidth, ch = card.offsetHeight, m = 12;
    if (!target || !document.body.contains(target)) {
      hole.classList.add('none');
      card.style.left = (W - cw) / 2 + 'px'; card.style.top = Math.max(m, (H - ch) / 2) + 'px';
      return;
    }
    const r = target.getBoundingClientRect(), pad = 6;
    const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad), w = Math.min(W - 8, r.width + pad * 2), h = Math.min(H - 8, r.height + pad * 2);
    hole.classList.remove('none');
    Object.assign(hole.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    // beside the spotlight where there is room: below, above, right, left, else over it
    const opts = [[x + w / 2 - cw / 2, y + h + m, y + h + m + ch < H], [x + w / 2 - cw / 2, y - m - ch, y - m - ch > 0],
                  [x + w + m, y, x + w + m + cw < W], [x - m - cw, y, x - m - cw > 0]];
    let [l, t] = (opts.find(o => o[2]) || [W / 2 - cw / 2, H - ch - m]);
    l = Math.max(m, Math.min(W - cw - m, l)); t = Math.max(m, Math.min(H - ch - m, t));
    card.style.left = l + 'px'; card.style.top = t + 'px';
  }
  const loop = () => { place(); raf = requestAnimationFrame(loop); };
  // wait until the target stops moving (lists filling in, panels opening), so the spotlight lands once, in the right place
  async function settle(e) {
    let last = '';
    for (let k = 0; k < 15; k++) {
      const r = e.getBoundingClientRect(), s = [r.left, r.top, r.width, r.height].map(Math.round).join();
      if (s === last) return;
      last = s; await new Promise(res => setTimeout(res, 70));
    }
  }
  async function show(n) {
    const my = ++seq; i = n;
    const s = steps[i];
    // fade out and let go of the old target while the next step gets its tab / panel / editor ready
    target = null; hole.style.opacity = 0; card.style.opacity = 0;
    card.querySelector('h4').textContent = s.title;
    card.querySelector('.tbody').innerHTML = '<p style="color:var(--dim,#8a93a3)">…</p>';
    card.querySelector('.tcount').textContent = `${i + 1} / ${steps.length}`;
    card.querySelector('.tbar i').style.width = ((i + 1) / steps.length * 100) + '%';
    card.querySelector('.tback').style.visibility = i ? 'visible' : 'hidden';
    card.querySelector('.tnext').textContent = i === steps.length - 1 ? 'Finish' : 'Next →';
    const act = card.querySelector('.tact');
    act.style.display = s.action ? '' : 'none'; if (s.action) act.textContent = s.action.label;
    try { await s.before?.(); } catch (e) {}
    if (my !== seq) return;
    let tg = await waitFor(s);
    if (my !== seq) return;
    if (tg) { tg.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); await settle(tg); }
    if (my !== seq) return;
    card.querySelector('.tbody').innerHTML = s.html;
    target = tg; place();
    hole.style.opacity = 1; card.style.opacity = 1;
  }
  function end() {
    cancelAnimationFrame(raf); el.remove(); window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', place);
    markSeen(id); running = null; onEnd?.();
  }
  const next = () => (i < steps.length - 1 ? show(i + 1) : end());
  const back = () => { if (i > 0) show(i - 1); };
  card.querySelector('.tnext').onclick = next;
  card.querySelector('.tback').onclick = back;
  card.querySelector('.tskip').onclick = end;
  card.querySelector('.tact').onclick = () => { const s = steps[i]; end(); s.action?.run(); };
  function onKey(e) {   // the tour owns the keyboard while it is open (no app shortcuts underneath)
    e.stopImmediatePropagation(); e.preventDefault();
    if (e.key === 'ArrowRight' || e.key === 'Enter') next();
    else if (e.key === 'ArrowLeft') back();
    else if (e.key === 'Escape') end();
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);
  raf = requestAnimationFrame(loop);
  show(0);
  return true;
}
