'use strict';
/* ============================================================
   DependencyGraphView — «Граф зависимостей» (редизайн под lab-скетч 09
   «Линза зависимостей»).

   Эпики сгруппированы по командам в карточки. Наведение/клик по эпику:
   несвязанное гаснет, проявляется цепочка — предки (зависит от · information),
   потомки (блокирует · off-course), крит-путь (drift). Провода рисуются от
   фокуса к членам цепочки в SVG-overlay. Справа — readout-плашка. Клик =
   зафиксировать; повторный клик/Esc/клик по фону = снять.

   Public API: open() / close() / toggle()
   ============================================================ */

import { state } from '../state.js';
import { Services } from '../app/services.js';
import { Storage } from '../dataStore.js';
import { ConfirmDialog } from '../app/uxKit.js';

const OVERLAY_ID = 'dep-graph-overlay';
const STYLE_ID = 'dep-graph-style-v2';

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function _short(s) { return String(s || '').split(/\s+/).slice(0, 2).join(' '); }

/** Удалить зависимость: dependent больше не зависит от dependency. */
function _removeDep(dependent, dependency) {
  const map = { ...(state.epicDeps || {}) };
  const v = map[dependent];
  if (Array.isArray(v)) {
    const next = v.filter(x => String(x) !== String(dependency));
    if (next.length) map[dependent] = next; else delete map[dependent];
  } else if (String(v) === String(dependency)) {
    delete map[dependent];
  }
  state.epicDeps = map;
  try { Storage.save(); } catch (_) {}
}

/** Граф зависимостей: предки/потомки (транзитивно, cycle-safe) + крит-путь. */
function _graph(deps, rows) {
  const epics = []; const seen = new Set();
  const add = (n) => { n = String(n || '').trim(); if (n && !seen.has(n)) { seen.add(n); epics.push(n); } };
  (rows || []).forEach(r => add(r.epic || r.tasks));
  Object.keys(deps).forEach(add);
  Object.values(deps).forEach(v => (Array.isArray(v) ? v : [v]).forEach(add));
  const depsOf = (k) => { const v = deps[k]; return (Array.isArray(v) ? v : (v ? [v] : [])).map(String).filter(Boolean); };
  const directChildren = Object.create(null); epics.forEach(k => directChildren[k] = []);
  epics.forEach(k => depsOf(k).forEach(d => { (directChildren[d] ||= []).push(k); }));
  const ancestorsOf = {}, descendantsOf = {};
  const ca = (k, acc) => depsOf(k).forEach(d => { if (!acc.has(d)) { acc.add(d); ca(d, acc); } });
  const cd = (k, acc) => (directChildren[k] || []).forEach(c => { if (!acc.has(c)) { acc.add(c); cd(c, acc); } });
  epics.forEach(k => { const a = new Set(); ca(k, a); a.delete(k); ancestorsOf[k] = a; const d = new Set(); cd(k, d); d.delete(k); descendantsOf[k] = d; });
  const upM = {}, dnM = {};
  const lUp = (k, st) => { if (upM[k]) return upM[k]; st = st || new Set(); if (st.has(k)) return []; st.add(k); let best = []; depsOf(k).forEach(d => { const ch = lUp(d, st).concat([d]); if (ch.length > best.length) best = ch; }); st.delete(k); return upM[k] = best; };
  const lDn = (k, st) => { if (dnM[k]) return dnM[k]; st = st || new Set(); if (st.has(k)) return []; st.add(k); let best = []; (directChildren[k] || []).forEach(c => { const ch = [c].concat(lDn(c, st)); if (ch.length > best.length) best = ch; }); st.delete(k); return dnM[k] = best; };
  const criticalPath = (k) => lUp(k).concat([k]).concat(lDn(k));
  return { epics, depsOf, directChildren, ancestorsOf, descendantsOf, criticalPath };
}

/** Модель: граф + мета по эпикам (команда, релиз, объём, риск) + группировка. */
function _buildModel() {
  const deps = state.epicDeps || {};
  const rows = state.rows || [];
  const g = _graph(deps, rows);
  const REL = [['release120Types', '1.20'], ['release121Types', '1.21'], ['release122Types', '1.22'], ['overtimeTypes', 'ОТ'], ['backlogTypes', 'Бэклог']];
  const meta = {};
  const ensure = (n) => meta[n] || (meta[n] = { name: n, team: '—', total: 0, risk: false, rel: '' });
  rows.forEach(r => {
    const n = String(r.epic || r.tasks || '').trim(); if (!n) return;
    const m = ensure(n);
    if (r.team) m.team = r.team;
    REL.forEach(([f]) => { if (Array.isArray(r[f])) m.total += r[f].length; });
    if ((Array.isArray(r.cellRisks) && r.cellRisks.length) || r.blockingDependency) m.risk = true;
    if (!m.rel) for (const [f, lbl] of REL) { if (Array.isArray(r[f]) && r[f].length) { m.rel = lbl; break; } }
  });
  g.epics.forEach(ensure);
  const teamOrder = []; const teams = {};
  g.epics.forEach(n => { const t = meta[n].team || '—'; if (!teams[t]) { teams[t] = []; teamOrder.push(t); } teams[t].push(n); });
  return { g, meta, teamOrder, teams };
}

function _ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
#${OVERLAY_ID}.dep-graph-overlay { position: fixed; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
#${OVERLAY_ID} .dep-graph-modal { display: flex; flex-direction: column; width: min(1180px, 94vw); height: 88vh; background: var(--prizma-bg, var(--card)); border: 1px solid var(--prizma-border-strong, var(--border)); border-radius: var(--r-lg, 14px); box-shadow: 0 24px 70px rgba(0,0,0,.5); overflow: hidden; }
#${OVERLAY_ID} .dep-graph-header { display: flex; align-items: baseline; gap: 14px; padding: 16px 22px 6px; flex: none; }
#${OVERLAY_ID} .dep-graph-eyebrow { font: 700 10px/1 var(--font, inherit); letter-spacing: .6px; text-transform: uppercase; color: var(--prizma-text-tertiary, var(--text-3)); }
#${OVERLAY_ID} .dep-graph-title { font-weight: 800; font-size: 18px; letter-spacing: -.01em; color: var(--prizma-text-primary, var(--text-1)); }
#${OVERLAY_ID} .dep-graph-actions { margin-left: auto; display: flex; gap: 8px; }
#${OVERLAY_ID} .dep-graph-sub { padding: 0 22px; font-size: 12.5px; color: var(--prizma-text-secondary, var(--text-2)); max-width: 640px; line-height: 1.5; }
#${OVERLAY_ID} .dep-graph-legend { display: flex; gap: 16px; padding: 10px 22px 12px; font-size: 11px; color: var(--prizma-text-tertiary, var(--text-3)); flex: none; }
#${OVERLAY_ID} .dep-graph-legend i { display: inline-block; width: 16px; height: 0; border-top: 2px solid; margin-right: 6px; vertical-align: middle; }
#${OVERLAY_ID} .dep-cycle { margin: 0 22px 8px; padding: 7px 11px; font-size: 12px; border-radius: var(--r-sm, 6px); background: var(--prizma-drift-bg, rgba(176,123,26,.14)); color: var(--prizma-drift); }
#${OVERLAY_ID} .dep-body { position: relative; flex: 1; min-height: 0; display: flex; }
#${OVERLAY_ID} .dep-scene { position: relative; flex: 1; overflow: auto; padding: 18px 22px 60px; }
#${OVERLAY_ID} .dep-wires { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; z-index: 1; }
#${OVERLAY_ID} .dep-teams { position: relative; z-index: 2; display: flex; flex-direction: column; gap: 18px; }
#${OVERLAY_ID} .dep-tname { font: 700 10px/1 var(--font, inherit); letter-spacing: .6px; text-transform: uppercase; color: var(--prizma-text-tertiary, var(--text-3)); margin-bottom: 9px; }
#${OVERLAY_ID} .dep-row { display: flex; flex-wrap: wrap; gap: 10px; }
#${OVERLAY_ID} .dep-epic { position: relative; width: 216px; padding: 12px 14px 11px 16px; background: var(--prizma-bg-elevated, var(--card)); border: 1px solid var(--prizma-border, var(--border)); border-radius: var(--r-md, 10px); cursor: pointer; transition: opacity .22s var(--ease-calm, ease), border-color .18s, transform .18s, box-shadow .18s; }
#${OVERLAY_ID} .dep-epic::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; border-radius: var(--r-md, 10px) 0 0 var(--r-md, 10px); background: var(--prizma-border-strong, var(--border)); transition: background .18s; }
#${OVERLAY_ID} .dep-epic:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,.28); }
#${OVERLAY_ID} .dep-epic .dn { font: 600 12.5px/1.3 var(--font, inherit); color: var(--prizma-text-primary, var(--text-1)); }
#${OVERLAY_ID} .dep-epic .ds { display: flex; align-items: center; gap: 8px; margin-top: 6px; font: 500 10.5px/1 var(--mono, ui-monospace, monospace); color: var(--prizma-text-tertiary, var(--text-3)); flex-wrap: wrap; }
#${OVERLAY_ID} .dep-epic .ds .rdot { width: 7px; height: 7px; border-radius: 50%; background: var(--prizma-off-course); }
#${OVERLAY_ID} .dep-epic .ds .cx { color: var(--prizma-text-secondary, var(--text-2)); }
#${OVERLAY_ID} .dep-scene.focusing .dep-epic:not(.in-chain) { opacity: .14; }
#${OVERLAY_ID} .dep-epic.focused { border-color: var(--prizma-information); }
#${OVERLAY_ID} .dep-epic.is-ancestor::before { background: var(--prizma-information); }
#${OVERLAY_ID} .dep-epic.is-descendant::before { background: var(--prizma-off-course); }
#${OVERLAY_ID} .dep-epic.focused::before { background: var(--prizma-text-primary, var(--text-1)); }
#${OVERLAY_ID} .dep-epic.on-crit::before { background: var(--prizma-drift); }
#${OVERLAY_ID} .dep-epic.on-crit { box-shadow: 0 0 0 1px var(--prizma-drift), 0 4px 14px rgba(0,0,0,.3); }
#${OVERLAY_ID} .dep-role { display: none; font: 700 9px/1 var(--font, inherit); letter-spacing: .5px; text-transform: uppercase; padding: 2px 5px; border-radius: 3px; }
#${OVERLAY_ID} .dep-epic.is-ancestor .dep-role.anc { display: inline-block; color: var(--prizma-information); background: var(--prizma-information-bg); }
#${OVERLAY_ID} .dep-epic.is-descendant .dep-role.desc { display: inline-block; color: var(--prizma-off-course); background: var(--prizma-off-course-bg, rgba(193,56,56,.12)); }
#${OVERLAY_ID} .dep-epic.focused .dep-role.foc { display: inline-block; color: var(--prizma-text-primary, var(--text-1)); background: var(--prizma-bg-tertiary, rgba(0,0,0,.06)); }
#${OVERLAY_ID} .dep-readout { position: absolute; top: 14px; right: 18px; z-index: 3; width: 280px; padding: 13px 15px; background: var(--prizma-bg-elevated, var(--card)); border: 1px solid var(--prizma-border, var(--border)); border-left: 3px solid var(--prizma-border-strong, var(--border)); border-radius: var(--r-md, 10px); box-shadow: 0 10px 30px rgba(0,0,0,.3); font: 12px/1.45 var(--font, inherit); }
#${OVERLAY_ID} .dep-readout.active { border-left-color: var(--prizma-information); }
#${OVERLAY_ID} .dep-readout .ro-empty { font-size: 11.5px; color: var(--prizma-text-tertiary, var(--text-3)); }
#${OVERLAY_ID} .dep-readout .ro-t { font-weight: 700; font-size: 12.5px; color: var(--prizma-text-primary, var(--text-1)); }
#${OVERLAY_ID} .dep-readout .ro-t .muted { color: var(--prizma-text-tertiary, var(--text-3)); font-weight: 500; }
#${OVERLAY_ID} .dep-readout .ro-counts { display: flex; gap: 14px; margin-top: 7px; font: 600 11px/1 var(--mono, ui-monospace, monospace); }
#${OVERLAY_ID} .dep-readout .ro-counts .dep { color: var(--prizma-information); }
#${OVERLAY_ID} .dep-readout .ro-counts .blk { color: var(--prizma-off-course); }
#${OVERLAY_ID} .dep-readout .ro-crit { margin-top: 7px; font: 500 11px/1.45 var(--mono, ui-monospace, monospace); color: var(--prizma-text-secondary, var(--text-2)); }
#${OVERLAY_ID} .dep-readout .ro-crit b { color: var(--prizma-drift); font-weight: 700; }
#${OVERLAY_ID} .dep-readout .ro-deps { margin-top: 9px; padding-top: 8px; border-top: 1px solid var(--prizma-border, var(--border)); }
#${OVERLAY_ID} .dep-readout .ro-dep-chip { display: inline-flex; align-items: center; gap: 5px; margin: 0 5px 5px 0; padding: 3px 5px 3px 8px; font-size: 10.5px; border: 1px solid var(--prizma-border, var(--border)); border-radius: 999px; color: var(--prizma-text-secondary, var(--text-2)); }
#${OVERLAY_ID} .dep-readout .ro-dep-chip button { background: none; border: none; cursor: pointer; color: var(--prizma-text-tertiary, var(--text-3)); font: 700 11px/1 system-ui; padding: 0 2px; }
#${OVERLAY_ID} .dep-readout .ro-dep-chip button:hover { color: var(--prizma-off-course); }
#${OVERLAY_ID} .dep-readout .ro-hint { margin-top: 9px; font-size: 10px; color: var(--prizma-text-tertiary, var(--text-3)); }
#${OVERLAY_ID} .dep-graph-empty { margin: auto; text-align: center; max-width: 420px; padding: 40px; }
#${OVERLAY_ID} .dep-graph-empty-title { font-weight: 700; font-size: 16px; margin: 10px 0 8px; color: var(--prizma-text-primary, var(--text-1)); }
#${OVERLAY_ID} .dep-graph-empty-sub { font-size: 13px; color: var(--prizma-text-tertiary, var(--text-3)); line-height: 1.55; }`;
  const el = document.createElement('style'); el.id = STYLE_ID; el.textContent = css;
  document.head.appendChild(el);
}

function _renderOverlay(model) {
  const { g, meta, teamOrder, teams } = model;
  if (!g.epics.length) {
    return `<div class="dep-graph-modal"><div class="dep-graph-empty">
      <div class="dep-graph-eyebrow">PRIZMA · ЗАВИСИМОСТИ</div>
      <div class="dep-graph-empty-title">Зависимости не заданы</div>
      <div class="dep-graph-empty-sub">Чтобы увидеть граф, задайте связи: в Ганте на строке эпика нажмите иконку зависимостей рядом с категорией и отметьте, от каких эпиков он зависит.</div>
      <button class="btn btn-outline btn-xs" id="dep-graph-close" style="margin-top:16px">Закрыть</button>
    </div></div>`;
  }
  const critCount = new Set();
  // глобальный крит-путь (для счётчика в заголовке) — самый длинный среди всех.
  let longest = [];
  g.epics.forEach(n => { const c = g.criticalPath(n); if (c.length > longest.length) longest = c; });
  longest.forEach(n => critCount.add(n));

  const card = (n) => {
    const m = meta[n];
    const out = g.depsOf(n).length, inn = g.directChildren[n].length;
    const cx = [out ? `←${out}` : '', inn ? `→${inn}` : ''].filter(Boolean).join(' ');
    return `<div class="dep-epic" data-epic="${_esc(n)}" tabindex="0">
      <div class="dn">${_esc(_truncate(n, 40))}</div>
      <div class="ds">${m.rel ? `<span>${_esc(m.rel)}</span>` : ''}${m.total ? `<span>${m.total} зад</span>` : ''}${cx ? `<span class="cx">${cx}</span>` : ''}${m.risk ? '<span class="rdot" title="есть риск"></span>' : ''}
        <span class="dep-role anc">предок</span><span class="dep-role desc">потомок</span><span class="dep-role foc">фокус</span>
      </div></div>`;
  };
  const teamsHtml = teamOrder.map(t =>
    `<div class="dep-teamblock"><div class="dep-tname">${_esc(t)}</div><div class="dep-row">${teams[t].map(card).join('')}</div></div>`
  ).join('');

  return `<div class="dep-graph-modal" role="dialog" aria-label="Граф зависимостей эпиков">
    <div class="dep-graph-header">
      <div><div class="dep-graph-eyebrow">PRIZMA · ЗАВИСИМОСТИ ЭПИКОВ</div><div class="dep-graph-title">Граф зависимостей</div></div>
      <div class="dep-graph-actions"><button class="btn btn-ghost btn-xs" id="dep-graph-close" aria-label="Закрыть">Закрыть · Esc</button></div>
    </div>
    <div class="dep-graph-sub">Наведите или кликните эпик — несвязанное гаснет, проявляется цепочка: предки (от кого зависит) и потомки (кто зависит). Жёлтым — критический путь через эпик.</div>
    <div class="dep-graph-legend">
      <span><i style="border-color:var(--prizma-information)"></i>зависит от (предки)</span>
      <span><i style="border-color:var(--prizma-off-course)"></i>блокирует (потомки)</span>
      <span><i style="border-color:var(--prizma-drift)"></i>крит-путь</span>
    </div>
    <div class="dep-body">
      <div class="dep-scene" id="dep-scene">
        <svg class="dep-wires" id="dep-wires" aria-hidden="true"></svg>
        <div class="dep-teams">${teamsHtml}</div>
      </div>
      <div class="dep-readout" id="dep-readout"><div class="ro-empty">Наведите эпик, чтобы увидеть его цепочку зависимостей. Клик — зафиксировать.</div></div>
    </div>
  </div>`;
}

export const DependencyGraphView = {
  isOpen() { return !!document.getElementById(OVERLAY_ID); },
  open() {
    if (DependencyGraphView.isOpen()) return;
    _ensureStyle();
    const model = _buildModel();
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'dep-graph-overlay';
    overlay.innerHTML = _renderOverlay(model);
    document.body.appendChild(overlay);
    DependencyGraphView._model = model;
    DependencyGraphView._locked = null;
    DependencyGraphView._bind(overlay);
    try { Services.App?.markRenderedNow?.(); } catch (_) {}
    DependencyGraphView._escHandler = (e) => { if (e.key === 'Escape') DependencyGraphView.close(); };
    document.addEventListener('keydown', DependencyGraphView._escHandler);
  },
  close() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
    if (DependencyGraphView._escHandler) { document.removeEventListener('keydown', DependencyGraphView._escHandler); DependencyGraphView._escHandler = null; }
    DependencyGraphView._model = null; DependencyGraphView._locked = null;
  },
  toggle() { if (DependencyGraphView.isOpen()) DependencyGraphView.close(); else DependencyGraphView.open(); },

  _bind(root) {
    root.querySelector('#dep-graph-close')?.addEventListener('click', () => DependencyGraphView.close());
    root.addEventListener('mousedown', (e) => { if (e.target === root) DependencyGraphView.close(); });

    const scene = root.querySelector('#dep-scene');
    const wires = root.querySelector('#dep-wires');
    const readout = root.querySelector('#dep-readout');
    if (!scene) return;
    const g = DependencyGraphView._model.g;
    const meta = DependencyGraphView._model.meta;
    const cardEls = {}; scene.querySelectorAll('.dep-epic').forEach(el => cardEls[el.dataset.epic] = el);

    const center = (el, edge) => {
      const s = scene.getBoundingClientRect(), r = el.getBoundingClientRect();
      const x = r.left - s.left + scene.scrollLeft, y = r.top - s.top + scene.scrollTop;
      if (edge === 'l') return [x, y + r.height / 2];
      if (edge === 'r') return [x + r.width, y + r.height / 2];
      return [x + r.width / 2, y + r.height / 2];
    };
    const drawWires = (focus, anc, desc, critSet) => {
      const fe = cardEls[focus]; if (!fe) { wires.innerHTML = ''; return; }
      let s = '';
      const wire = (toName, color, onCrit) => {
        const te = cardEls[toName]; if (!te) return;
        const a = center(fe), b = center(te);
        const left = a[0] <= b[0];
        const from = left ? center(fe, 'r') : center(fe, 'l');
        const to = left ? center(te, 'l') : center(te, 'r');
        const mx = (from[0] + to[0]) / 2;
        s += '<path d="M' + from[0].toFixed(1) + ' ' + from[1].toFixed(1) + ' C ' + mx.toFixed(1) + ' ' + from[1].toFixed(1) + ', ' + mx.toFixed(1) + ' ' + to[1].toFixed(1) + ', ' + to[0].toFixed(1) + ' ' + to[1].toFixed(1) + '" fill="none" stroke="' + color + '" stroke-width="' + (onCrit ? 2.2 : 1.3) + '"' + (onCrit ? '' : ' stroke-dasharray="4 3"') + ' opacity="' + (onCrit ? 1 : .85) + '"/>';
        s += '<circle cx="' + to[0].toFixed(1) + '" cy="' + to[1].toFixed(1) + '" r="' + (onCrit ? 3 : 2.4) + '" fill="' + color + '"/>';
      };
      anc.forEach(a => wire(a, 'var(--prizma-information)', critSet.has(a)));
      desc.forEach(d => wire(d, 'var(--prizma-off-course)', critSet.has(d)));
      wires.innerHTML = s;
    };
    const renderReadout = (focus, anc, desc, crit) => {
      const m = meta[focus] || {};
      const labels = crit.length > 1
        ? crit.map(c => c === focus ? '<b>' + _esc(_short(c)) + '</b>' : _esc(_short(c))).join(' → ')
        : '— (изолирован)';
      const directDeps = g.depsOf(focus);
      const depsChips = directDeps.length
        ? '<div class="ro-deps"><div class="dep-graph-eyebrow" style="margin-bottom:6px">Прямые зависимости</div>' +
          directDeps.map(d => '<span class="ro-dep-chip">' + _esc(_short(d)) + '<button data-rm-dep="' + _esc(d) + '" title="Убрать зависимость от «' + _esc(d) + '»">×</button></span>').join('') + '</div>'
        : '';
      readout.classList.add('active');
      readout.innerHTML =
        '<div class="ro-t">' + _esc(focus) + ' <span class="muted">· ' + _esc(m.team || '') + '</span></div>' +
        '<div class="ro-counts"><span class="dep">зависит от ' + anc.size + '</span><span class="blk">блокирует ' + desc.size + '</span></div>' +
        '<div class="ro-crit">крит-путь: ' + labels + '</div>' + depsChips +
        '<div class="ro-hint">Клик по эпику — зафиксировать · ещё раз / Esc — снять</div>';
      readout.querySelectorAll('[data-rm-dep]').forEach(btn => btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const dependency = btn.dataset.rmDep;
        const ok = await ConfirmDialog.show({ title: 'Убрать зависимость?', message: `«${focus}» больше не будет зависеть от «${dependency}».`, confirmLabel: 'Убрать', cancelLabel: 'Отмена', danger: true }).catch(() => false);
        if (!ok) return;
        _removeDep(focus, dependency);
        try { Services.GanttView?.renderChart?.() || window.GanttView?.renderChart?.(); } catch (_) {}
        // перерисовать оверлей на месте (модель изменилась).
        DependencyGraphView._model = _buildModel();
        root.innerHTML = _renderOverlay(DependencyGraphView._model);
        DependencyGraphView._locked = null;
        DependencyGraphView._bind(root);
        window.showToast?.('Зависимость убрана', 'success', 1600);
      }));
    };
    const focusEpic = (name) => {
      const anc = g.ancestorsOf[name] || new Set();
      const desc = g.descendantsOf[name] || new Set();
      const crit = g.criticalPath(name);
      const critSet = new Set(crit);
      scene.classList.add('focusing');
      scene.querySelectorAll('.dep-epic').forEach(el => el.classList.remove('in-chain', 'focused', 'is-ancestor', 'is-descendant', 'on-crit'));
      const mark = (nm, ...cls) => { const el = cardEls[nm]; if (el) el.classList.add('in-chain', ...cls); };
      mark(name, 'focused');
      anc.forEach(a => mark(a, 'is-ancestor'));
      desc.forEach(d => mark(d, 'is-descendant'));
      crit.forEach(c => { if (cardEls[c]) cardEls[c].classList.add('in-chain', 'on-crit'); });
      drawWires(name, anc, desc, critSet);
      renderReadout(name, anc, desc, crit);
      DependencyGraphView._focus = name;
    };
    const clearFocus = () => {
      DependencyGraphView._focus = null;
      scene.classList.remove('focusing');
      scene.querySelectorAll('.dep-epic').forEach(el => el.classList.remove('in-chain', 'focused', 'is-ancestor', 'is-descendant', 'on-crit'));
      wires.innerHTML = '';
      readout.classList.remove('active');
      readout.innerHTML = '<div class="ro-empty">Наведите эпик, чтобы увидеть его цепочку зависимостей. Клик — зафиксировать.</div>';
    };

    // hover (sticky, через mouseover-делегирование) — не сбрасывается на зазорах.
    scene.addEventListener('mouseover', (e) => {
      if (DependencyGraphView._locked) return;
      const card = e.target.closest?.('.dep-epic'); if (!card) return;
      const nm = card.dataset.epic;
      if (DependencyGraphView._focus === nm) return;
      focusEpic(nm);
    });
    scene.addEventListener('mouseleave', () => { if (!DependencyGraphView._locked) clearFocus(); });
    // click — зафиксировать/снять фиксацию.
    scene.addEventListener('click', (e) => {
      const card = e.target.closest?.('.dep-epic'); if (!card) return;
      const nm = card.dataset.epic;
      if (DependencyGraphView._locked === nm) { DependencyGraphView._locked = null; clearFocus(); }
      else { DependencyGraphView._locked = nm; focusEpic(nm); }
    });
    // перерисовка проводов при скролле/resize.
    const redraw = () => { const f = DependencyGraphView._focus; if (!f) return; drawWires(f, g.ancestorsOf[f] || new Set(), g.descendantsOf[f] || new Set(), new Set(g.criticalPath(f))); };
    scene.addEventListener('scroll', redraw);
    if (DependencyGraphView._roResize) window.removeEventListener('resize', DependencyGraphView._roResize);
    DependencyGraphView._roResize = redraw;
    window.addEventListener('resize', DependencyGraphView._roResize);
  },
};

Services.register('DependencyGraphView', DependencyGraphView);
if (typeof window !== 'undefined') window.DependencyGraphView = DependencyGraphView;
