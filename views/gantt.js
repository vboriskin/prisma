'use strict';
/* ============================================================
   GANTT VIEW — v14_0 ES module (GanttV2 retired in V14, see B2)
   ============================================================ */

import { state } from '../state.js';
import { FilterEngine } from '../filters.js';
import { Utils } from '../utils.js';
import { RowFactory } from '../rowFactory.js';
import { RiskEngine } from '../riskEngine.js';
import { Storage } from '../dataStore.js';
import {
  SCOPE_OPTIONS, RELEASE_WINDOWS, GANTT_RELEASE_WINDOWS,
  GANTT_TIMELINE_START, GANTT_TIMELINE_END, GANTT_DAY_PX,
  GANTT_RELEASE_BOUNDS, PHASE_ORDER, PHASE_COLORS, PHASE_SHORT,
  WORK_TYPES,
} from '../constants.js';
import { RH } from './renderHelpers.js';
// V18.3 B1 (partial split) — 4 self-contained method'а вынесены в aux.
import {
  openHistoryModal as _auxHistoryModal,
  openAddEpicModal as _auxAddEpicModal,
  bindFastTooltip as _auxBindFastTooltip,
  drawPostponeArrows as _auxDrawPostponeArrows,
} from './gantt/aux.js';

// V17.1 C11+C12 — единый плюрализатор для русских окончаний.
// Пример: pl(1, ['задача','задачи','задач']) → 'задача', pl(3,…) → 'задачи',
// pl(5,…) → 'задач'. Используется в team-counter (C12) и в epic-meta (C11).
function pl(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
const TASK_FORMS = ['задача', 'задачи', 'задач'];
const EPIC_FORMS = ['эпик', 'эпика', 'эпиков'];

// V17.1 C4 — длинный русский формат «20 апреля – 17 мая» для подзаголовка
// колонки релиза. Источник `c.sub` сейчас — `'DD.MM–DD.MM'`; сохраняем
// исходное поле для логики today-pill (parser в well-header), но рендерим
// читаемую версию для пользователя.
const RU_MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function formatLongRange(sub) {
  if (!sub) return '';
  const m = String(sub).match(/^(\d{2})\.(\d{2})\D+(\d{2})\.(\d{2})/);
  if (!m) return sub;
  const [, sd, sm, ed, em] = m.map(x => parseInt(x, 10) || x);
  const left  = `${parseInt(sd,10)} ${RU_MONTHS_GEN[parseInt(sm,10)-1] || ''}`;
  const right = `${parseInt(ed,10)} ${RU_MONTHS_GEN[parseInt(em,10)-1] || ''}`;
  return `${left} – ${right}`;
}

export const GanttView = {
  gf:{ team:'',scope:'',onlyBlocking:false,onlyNoRelease:false,onlyRisky:false },
  _cancelTransientInteractions: null,
  _clearTransientInteractions() {
    if (typeof GanttView._cancelTransientInteractions === 'function') {
      try { GanttView._cancelTransientInteractions(); } catch(_) {}
    }
    GanttView._cancelTransientInteractions = null;
  },
  render() {
    GanttView.applyMode();            // V16 roadmap-2 (A4) — restore overview/default
    GanttView.applyDensity();         // V16 #5 — restore persisted density before chart paints
    GanttView.renderPillLegend();
    GanttView.renderFilters();
    GanttView.renderChart();
    GanttView.bindFullscreen();
    GanttView.bindExpandCollapse();
    GanttView.bindDensity();          // V16 #5
    GanttView.bindMode();             // V16 roadmap-2 (A4)
    GanttView.bindJumpPalette();      // V16 #5
    GanttView.bindKeyboardNav();      // V16 roadmap-2 (B6)
  },
  /** V16 roadmap-2 (B6) — keyboard navigation across the gantt grid.
   *  Roving tabindex; ←/→/↑/↓ between pills; Enter/F2 ctx-menu; Esc blur. */
  bindKeyboardNav() {
    if (GanttView._kbBound) return;
    GanttView._kbBound = true;
    const wrap = document.getElementById('gantt-wrap');
    if (!wrap) { GanttView._kbBound = false; return; }

    const allPills = () => Array.from(wrap.querySelectorAll('.gantt-type-pill[data-wt][data-row-id]:not(.gantt-pill-ghost)'));
    const setRoving = (target) => {
      allPills().forEach(p => { p.tabIndex = (p === target) ? 0 : -1; });
    };
    const focusPill = (target) => {
      if (!target) return;
      setRoving(target);
      target.focus({ preventScroll: false });
    };
    const sibling = (current, dir) => {
      const list = allPills();
      const idx = list.indexOf(current);
      if (idx < 0) return null;
      if (dir === 'left')  return list[idx - 1] || null;
      if (dir === 'right') return list[idx + 1] || null;
      const curRow = current.closest('.gantt-row');
      const allRows = Array.from(wrap.querySelectorAll('.gantt-row[data-row-id]'));
      const rIdx = allRows.indexOf(curRow);
      const targetRow = dir === 'up' ? allRows[rIdx - 1] : allRows[rIdx + 1];
      if (!targetRow) return null;
      const curCol = current.dataset.srcCol;
      const sameCol = targetRow.querySelector(`.gantt-cell[data-col="${window.CSS?.escape ? CSS.escape(curCol) : curCol}"] .gantt-type-pill[data-wt][data-row-id]:not(.gantt-pill-ghost)`);
      if (sameCol) return sameCol;
      return targetRow.querySelector('.gantt-type-pill[data-wt][data-row-id]:not(.gantt-pill-ghost)');
    };

    const setupRoving = () => {
      const list = allPills();
      if (!list.length) return;
      list.forEach((p, i) => { p.tabIndex = (i === 0) ? 0 : -1; });
    };
    setupRoving();
    // Re-establish baseline after every renderChart() rebuild.
    const _origRender = GanttView.renderChart;
    if (!GanttView._kbWrappedRender) {
      GanttView._kbWrappedRender = true;
      GanttView.renderChart = function (...args) {
        const r = _origRender.apply(this, args);
        try { setupRoving(); } catch (_) {}
        return r;
      };
    }

    wrap.addEventListener('focusin', (e) => {
      const pill = e.target.closest?.('.gantt-type-pill[data-wt][data-row-id]:not(.gantt-pill-ghost)');
      if (pill) setRoving(pill);
    });

    wrap.addEventListener('keydown', (e) => {
      const focused = document.activeElement;
      if (!focused || !focused.matches('.gantt-type-pill[data-wt][data-row-id]:not(.gantt-pill-ghost)')) return;
      if (focused.matches('input, textarea, select')) return;
      let next = null;
      switch (e.key) {
        case 'ArrowLeft':  next = sibling(focused, 'left');  break;
        case 'ArrowRight': next = sibling(focused, 'right'); break;
        case 'ArrowUp':    next = sibling(focused, 'up');    break;
        case 'ArrowDown':  next = sibling(focused, 'down');  break;
        case 'Enter':
        case 'F2': {
          e.preventDefault();
          const r = focused.getBoundingClientRect();
          const ev = new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true,
            clientX: r.left + r.width / 2,
            clientY: r.top  + r.height / 2,
          });
          focused.dispatchEvent(ev);
          return;
        }
        case 'Escape':
          document.getElementById('gdt-ctx-menu')?.remove();
          focused.blur();
          return;
        default:
          return;
      }
      if (next) {
        e.preventDefault();
        focusPill(next);
      }
    });
  },
  /** V16 roadmap-2 (A4) — gantt zoom mode. Two states:
   *    'default'  — full detail, pills + epics + trails (what V16 ships now)
   *    'overview' — one row per team, per-bucket stacked bars showing
   *                 work-type distribution. Useful when 100+ teams
   *                 ×30+ tasks turn the screen into texture.
   *  Click on a team row in overview switches back to default + jumps. */
  applyMode() {
    let mode = 'default';
    try {
      const saved = localStorage.getItem('q2_gantt_mode_v16');
      if (saved === 'overview' || saved === 'default') mode = saved;
    } catch (_) {}
    GanttView._dtMode = mode;
    document.body.dataset.gdtMode = mode;
  },
  bindMode() {
    const btn = document.getElementById('btn-gantt-mode');
    if (!btn || btn._gdtModeBound) return;
    btn._gdtModeBound = true;
    btn.addEventListener('click', () => {
      const next = GanttView._dtMode === 'overview' ? 'default' : 'overview';
      GanttView._dtMode = next;
      document.body.dataset.gdtMode = next;
      try { localStorage.setItem('q2_gantt_mode_v16', next); } catch (_) {}
      btn.title = next === 'overview'
        ? 'Режим: Overview (клик → Default)'
        : 'Режим: Default (клик → Overview)';
      window.showToast?.(`Режим: ${next === 'overview' ? 'Overview' : 'Default'}`, 'info', 1400);
      // V16 roadmap-2 (B4) — preserve scroll anchor across re-render.
      GanttView._withScrollAnchor(() => GanttView.renderChart());
    });
  },
  /** V16 roadmap-2 (B4) — scroll-anchor helper. Toggles like density,
   *  mode, collapse-all rebuild the gantt body and the user's scroll
   *  position is lost. We snapshot the topmost-visible team-key just
   *  before the rebuild and re-scroll to its new position after. */
  _withScrollAnchor(fn) {
    const wrap = document.getElementById('gantt-wrap');
    let anchorKey = null;
    if (wrap) {
      const wrapRect = wrap.getBoundingClientRect();
      const teams = wrap.querySelectorAll('.gantt-team-header[data-team-key]');
      for (const el of teams) {
        const r = el.getBoundingClientRect();
        if (r.bottom > wrapRect.top + 4) {
          anchorKey = el.dataset.teamKey;
          break;
        }
      }
    }
    fn();
    if (anchorKey && wrap) {
      requestAnimationFrame(() => {
        const target = wrap.querySelector(`.gantt-team-header[data-team-key="${window.CSS?.escape ? CSS.escape(anchorKey) : anchorKey}"]`);
        if (target?.scrollIntoView) {
          target.scrollIntoView({ behavior: 'instant', block: 'start' });
        }
      });
    }
  },
  /** V16 (gantt-roadmap #5) — density toggle. Two states: «regular» (the
   *  default Spine-pill 2-row layout, ~44 px rows) and «compact» (~32 px,
   *  meta-row hidden). Persisted to localStorage. Dense (24 px) was
   *  rejected by review — would break the Spine pill's two-row anatomy. */
  applyDensity() {
    let mode = 'regular';
    try {
      const saved = localStorage.getItem('q2_gantt_density_v16');
      if (saved === 'compact' || saved === 'regular') mode = saved;
    } catch (_) {}
    document.body.dataset.gdtDensity = mode;
  },
  bindDensity() {
    const btn = document.getElementById('btn-gantt-density');
    if (!btn || btn._gdtDensityBound) return;
    btn._gdtDensityBound = true;
    btn.addEventListener('click', () => {
      // V16 roadmap-2 (B4) — preserve scroll anchor: density attribute
      // change reflows row heights, but our anchor read still works
      // because team-header positions update synchronously.
      GanttView._withScrollAnchor(() => {
        const next = document.body.dataset.gdtDensity === 'compact' ? 'regular' : 'compact';
        document.body.dataset.gdtDensity = next;
        try { localStorage.setItem('q2_gantt_density_v16', next); } catch (_) {}
        btn.title = next === 'compact'
          ? 'Плотность: Compact (клик → Regular)'
          : 'Плотность: Regular (клик → Compact)';
        window.showToast?.(`Плотность: ${next === 'compact' ? 'Compact' : 'Regular'}`, 'info', 1400);
      });
    });
  },
  /** V16 (gantt-roadmap #5) — Cmd+K palette: fuzzy search across teams +
   *  epics. Opens on ⌘K / Ctrl+K (and via the toolbar button). Selecting
   *  a result scrolls to the matching row and pulses a highlight ring. */
  bindJumpPalette() {
    if (GanttView._jumpBound) return;
    GanttView._jumpBound = true;
    document.getElementById('btn-gantt-jump')?.addEventListener('click', () => GanttView.openJumpPalette());
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K' || e.key === 'л' || e.key === 'Л')) {
        // V16 roadmap-2 (S2) — don't swallow ⌘K when the user is typing.
        // Linear-style guard: skip if focus is in an editable element OR if
        // any modal-overlay is currently open (lock-modal, move-comment,
        // assign, complete, dates, etc.). Earlier behaviour ate users'
        // half-typed comments when they reflexively hit ⌘K mid-edit.
        if (state.activeSection !== 'gantt') return;
        const t = e.target;
        const isEditable = t && (
          t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          (t.isContentEditable === true)
        );
        if (isEditable) return;
        const modalOpen = !!document.querySelector('.modal-overlay:not(.hidden), #gdt-jump-palette:not(.hidden)');
        if (modalOpen) return;
        e.preventDefault();
        GanttView.openJumpPalette();
      }
    });
  },
  openJumpPalette() {
    const overlay = document.getElementById('gdt-jump-palette');
    const input   = document.getElementById('gdt-jump-input');
    const results = document.getElementById('gdt-jump-results');
    if (!overlay || !input || !results) return;

    // Build the searchable index every open — cheap, and keeps it fresh
    // after edits / imports without any subscribe wiring.
    const teams = Utils.unique((state.rows || []).map(r => r.team).filter(Boolean));
    const teamKeyFn = t => t.replace(/[^a-zA-Zа-яА-ЯёЁъЪ0-9]/g, '_');
    const items = [];
    for (const team of teams) {
      items.push({ kind: 'team', label: team, sub: 'команда', key: teamKeyFn(team), rowId: null });
    }
    for (const r of (state.rows || [])) {
      const epic = r.epic || r.tasks;
      if (!epic) continue;
      items.push({ kind: 'epic', label: epic, sub: r.team || '—', key: teamKeyFn(r.team || ''), rowId: r.id });
    }

    let active = 0;
    const norm = (s) => String(s || '').toLowerCase();
    const score = (item, q) => {
      if (!q) return 1;
      const lab = norm(item.label);
      const sub = norm(item.sub);
      if (lab.startsWith(q)) return 100;
      if (lab.includes(q))    return 50;
      if (sub.includes(q))    return 20;
      // Cheap subseq match — every char of q appears in order in lab.
      let i = 0;
      for (const ch of lab) { if (i < q.length && ch === q[i]) i++; }
      return i === q.length ? 5 : 0;
    };
    const renderResults = () => {
      const q = norm(input.value).trim();
      const ranked = items
        .map(it => ({ it, s: score(it, q) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 40)
        .map(x => x.it);
      if (!ranked.length) {
        results.innerHTML = '<div class="gdt-jump-empty">Ничего не найдено</div>';
        active = 0;
        return;
      }
      if (active >= ranked.length) active = 0;
      results.innerHTML = ranked.map((it, idx) => `
        <div class="gdt-jump-item${idx === active ? ' is-active' : ''}" data-idx="${idx}" data-kind="${esc(it.kind)}" data-key="${esc(it.key)}" data-row-id="${esc(it.rowId || '')}">
          <span class="gdt-jump-kind gdt-jump-kind-${esc(it.kind)}">${it.kind === 'team' ? 'team' : 'epic'}</span>
          <span class="gdt-jump-label">${esc(it.label)}</span>
          <span class="gdt-jump-sub">${esc(it.sub)}</span>
        </div>`).join('');
      results._items = ranked;
    };
    const close = () => {
      overlay.classList.add('hidden');
      input.value = '';
      results.innerHTML = '';
      document.removeEventListener('keydown', onKey, true);
    };
    const jumpTo = (it) => {
      if (!it) return;
      close();
      // Make sure the team is expanded if collapsed.
      if (!GanttView._dtHiddenTeams) GanttView._dtHiddenTeams = new Set();
      if (it.key && GanttView._dtHiddenTeams.has(it.key)) {
        GanttView._dtHiddenTeams.delete(it.key);
        GanttView.renderChart();
      }
      // Find the target DOM node.
      requestAnimationFrame(() => {
        const wrap = document.getElementById('gantt-wrap');
        if (!wrap) return;
        let target = null;
        if (it.kind === 'team') {
          target = wrap.querySelector(`.gantt-team-header[data-team-key="${cssEscape(it.key)}"]`);
        } else if (it.kind === 'epic' && it.rowId) {
          target = wrap.querySelector(`.gantt-row[data-row-id="${cssEscape(it.rowId)}"]`)
                || wrap.querySelector(`.gantt-cell[data-row-id="${cssEscape(it.rowId)}"]`)?.parentElement;
        }
        if (target?.scrollIntoView) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.add('gdt-jump-pulse');
          setTimeout(() => target.classList.remove('gdt-jump-pulse'), 1400);
        }
      });
    };
    const cssEscape = (s) => (window.CSS?.escape ? window.CSS.escape(String(s)) : String(s).replace(/"/g, '\\"'));

    const onKey = (e) => {
      const list = results._items || [];
      if (e.key === 'Escape')      { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown')   { e.preventDefault(); active = Math.min(list.length - 1, active + 1); renderResults(); return; }
      if (e.key === 'ArrowUp')     { e.preventDefault(); active = Math.max(0, active - 1); renderResults(); return; }
      if (e.key === 'Enter')       { e.preventDefault(); jumpTo(list[active]); return; }
    };
    input.value = '';
    overlay.classList.remove('hidden');
    renderResults();
    setTimeout(() => input.focus(), 30);
    input.oninput = () => { active = 0; renderResults(); };
    document.addEventListener('keydown', onKey, true);

    // Click handlers — delegated to the results container so we don't
    // re-bind on every renderResults() call.
    results.onclick = (ev) => {
      const it = ev.target.closest('.gdt-jump-item');
      if (!it) return;
      const idx = Number(it.dataset.idx);
      jumpTo((results._items || [])[idx]);
    };
    overlay.onclick = (ev) => {
      if (ev.target === overlay) close();
    };
  },
  /** V15 Spine 2026-04-30 — collapsible pill-anatomy legend above the
   *  gantt. Default collapsed (single «💡 Подсказки» button). Click to
   *  expand into the full legend (anatomy demo + colodets + states +
   *  переносы). State persists in localStorage so a user who closes it
   *  doesn't have to close it again on every page load. */
  renderPillLegend() {
    const host = document.getElementById('gantt-pill-legend');
    if (!host) return;
    const STORAGE_KEY = 'q2_gantt_legend_open_v15';
    let openState = false;
    try {
      openState = localStorage.getItem(STORAGE_KEY) === '1';
    } catch (_) { /* private mode → default collapsed */ }

    const fullLegendHtml = `
      <div class="gdt-pill-legend-body">
        <div class="gdt-pill-legend-section gdt-pill-legend-anatomy">
          <div class="gdt-pill-legend-title">Пилюля задачи</div>
          <div class="gdt-pill-legend-items">
            <span class="gdt-pill-legend-demo">
              <span class="gdt-pill-legend-stripe"></span>
              <span class="gdt-pill-legend-demo-body">
                <span class="gdt-pill-legend-demo-row1">
                  <span class="gdt-pill-legend-demo-name">BE-модель</span>
                  <span class="gdt-pill-legend-demo-state-active"></span>
                  <span class="gdt-pill-legend-demo-cmt"></span>
                </span>
                <span class="gdt-pill-legend-demo-row2">Иванов · 01.05—15.05</span>
              </span>
            </span>
            <span class="gdt-pill-legend-meta">слева: цвет = тип работы · справа: статус-точка и маркер коммента · снизу: исполнитель и период</span>
          </div>
        </div>
        <div class="gdt-pill-legend-section">
          <div class="gdt-pill-legend-title">Колодцы (цвет полосы)</div>
          <div class="gdt-pill-legend-items">
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-stripe-sample" style="background:#4f46e5"></span> Релиз 1.20</span>
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-stripe-sample" style="background:#059669"></span> Релиз 1.21</span>
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-stripe-sample" style="background:#d97706"></span> Релиз 1.22</span>
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-stripe-sample" style="background:#dc2626"></span> Овертайм</span>
          </div>
        </div>
        <div class="gdt-pill-legend-section">
          <div class="gdt-pill-legend-title">Состояния</div>
          <div class="gdt-pill-legend-items">
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-state gdt-pill-legend-state-active"></span> В работе</span>
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-state gdt-pill-legend-state-done">✓</span> Завершено (название перечёркнуто)</span>
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-state gdt-pill-legend-state-unplanned"></span> Не запланирована (пунктирные стрипа и кружок, italic)</span>
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-cmt-square gdt-pill-legend-cmt-transfer"></span> Перенос с комментарием (наведи на пилюлю)</span>
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-cmt-square gdt-pill-legend-cmt-add"></span> Добавлено в зафиксированный план</span>
            <span class="gdt-pill-legend-item gdt-pill-legend-meta">На «не запланированной» пилюле маркеры становятся контурными того же цвета</span>
          </div>
        </div>
        <div class="gdt-pill-legend-section">
          <div class="gdt-pill-legend-title">Переносы</div>
          <div class="gdt-pill-legend-items">
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-icon">↗</span> Откуда перенесли</span>
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-icon">↘</span> Куда перенесли</span>
            <span class="gdt-pill-legend-item gdt-pill-legend-meta">Каждая строка-переноса = одно действие; история сохраняется</span>
          </div>
        </div>
      </div>`;

    // V17.1 C8 — внутренняя toggle-кнопка убрана (переехала в section-header
    // как `#btn-gantt-tips-toggle`). Здесь оставляем только тело подсказок;
    // его открытое/закрытое состояние всё ещё хранится в localStorage и
    // переключается из section-header.
    host.dataset.open = openState ? '1' : '0';
    host.innerHTML = `<div class="gdt-pill-legend-content" data-open="${openState ? '1' : '0'}">${fullLegendHtml}</div>`;
    const sectionToggle = document.getElementById('btn-gantt-tips-toggle');
    if (sectionToggle && !sectionToggle._gdtTipsBound) {
      sectionToggle._gdtTipsBound = true;
      sectionToggle.addEventListener('click', () => {
        const cur = host.dataset.open === '1';
        const next = !cur;
        host.dataset.open = next ? '1' : '0';
        const content = host.querySelector('.gdt-pill-legend-content');
        if (content) content.dataset.open = next ? '1' : '0';
        sectionToggle.classList.toggle('active', next);
        try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch (_) {}
      });
      // initial active-class sync
      sectionToggle.classList.toggle('active', openState);
    }
    // V17.1 C9 — History modal: shows action log filtered to gantt-related
    // entries. Idempotent guard prevents stacking listeners on every render.
    const histBtn = document.getElementById('btn-gantt-history');
    if (histBtn && !histBtn._gdtHistBound) {
      histBtn._gdtHistBound = true;
      histBtn.addEventListener('click', () => GanttView._openHistoryModal());
    }
  },
  /** V17.1 C9 — собрать модалку истории изменений Ганта. Источник —
   *  state.actionLog (наполняется HistoryLog.data/.gantt + HistoryManager). */
  // V18.3 B1 — extracted to ./gantt/aux.js (60 LOC moved out).
  _openHistoryModal() { _auxHistoryModal(); },

  /** V17.1 C13 — «Добавить эпик» modal. V18.3 B1 — extracted to
   *  ./gantt/aux.js (110 LOC moved). onCreated callback вызывает
   *  GanttView.renderChart() — это дает aux.js быть pure без circular
   *  GanttView reference. */
  _openAddEpicModal(presetTeam) {
    _auxAddEpicModal(presetTeam, { onCreated: () => GanttView.renderChart() });
  },
  bindFullscreen() {
    const btn = document.getElementById('btn-gantt-fullscreen');
    if (!btn || btn._gdtFsBound) return;
    btn._gdtFsBound = true;
    const section = document.getElementById('section-gantt');
    const toggle = () => {
      const on = section.classList.toggle('gdt-fullscreen');
      btn.textContent = on ? '✕ Выйти' : '⛶';
      btn.title = on ? 'Выйти из полного экрана' : 'Полный экран';
      GanttView._dtColWidths = {};
      GanttView.renderChart();
    };
    btn.addEventListener('click', toggle);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && section.classList.contains('gdt-fullscreen')) toggle();
    });
  },
  bindExpandCollapse() {
    const btn = document.getElementById('btn-gantt-expand-all');
    if (!btn || btn._gdtEcBound) return;
    btn._gdtEcBound = true;
    btn.addEventListener('click', () => {
      // V16 roadmap-2 (B4) — preserve scroll-anchor across the toggle.
      GanttView._withScrollAnchor(() => {
        const teamKey = t => t.replace(/[^a-zA-Zа-яА-ЯёЁъЪ0-9]/g, '_');
        const allTks  = [...new Set(GanttView.getRows().map(r => teamKey(r.team)))];
        const anyVisible = allTks.some(tk => !GanttView._dtHiddenTeams?.has(tk));
        if (!GanttView._dtHiddenTeams) GanttView._dtHiddenTeams = new Set();
        if (anyVisible) allTks.forEach(tk => GanttView._dtHiddenTeams.add(tk));
        else            GanttView._dtHiddenTeams.clear();
        GanttView.renderChart();
      });
    });
  },
  renderFilters() {
    const el = document.getElementById('gantt-filters');
    if (el) { el.innerHTML = ''; el.style.display = 'none'; }
  },
  getRows() {
    let rows=FilterEngine.getFiltered(); const f=GanttView.gf;
    if(f.team)rows=rows.filter(r=>r.team===f.team);
    if(f.scope)rows=rows.filter(r=>r.scopeStatus===f.scope);
    if(f.onlyBlocking)rows=rows.filter(r=>r.blockingDependency);
    if(f.onlyNoRelease)rows=rows.filter(r=>r.isUnassigned);
    if(f.onlyRisky)rows=rows.filter(r=>r.riskFlags&&r.riskFlags.length);
    return rows;
  },
  renderChart() {
    GanttView._clearTransientInteractions();
    if (GanttView._docTipListener) {
      document.removeEventListener('mousemove', GanttView._docTipListener);
      GanttView._docTipListener = null;
    }
    document.querySelectorAll('.gep-tooltip,.gtx-tooltip').forEach(t => t.remove());

    // #7: preserve scroll position across re-renders. Drag-drop / move-next /
    // delete / backlog-edit trigger renderChart() which sets innerHTML — that
    // wipes any scroll state. We capture three independent scrollers because
    // depending on mode the vertical scroll lives on a different element:
    //   · normal mode:     vertical scroll on `window` (gantt-wrap is overflow-y:visible)
    //   · fullscreen mode: vertical scroll on `.gantt-container` (max-height + overflow-y:auto)
    //   · horizontal:      always on `#gantt-wrap` (overflow-x:auto)
    // Capturing only window.scrollY would miss fullscreen; capturing only
    // wrap.scrollTop would miss normal mode. Capture all three.
    const _wrapForScroll = document.getElementById('gantt-wrap');
    const _containerForScroll = _wrapForScroll?.querySelector('.gantt-container');
    if (_wrapForScroll) {
      GanttView._pendingScrollX     = _wrapForScroll.scrollLeft || 0;
      GanttView._pendingScrollY     = _wrapForScroll.scrollTop  || 0;
      GanttView._pendingContainerY  = _containerForScroll?.scrollTop || 0;
      GanttView._pendingDocY        = window.scrollY || 0;
    }

    // V14: legacy Gantt modes ('epics' / 'arrows' / 'ultra' / 'arrowsNew')
    // are all retired — only `detailedTasks` remains. The V13 GanttV2
    // ("Гант 2.0" with ISO-week zoom + dependency arrows) was removed
    // because it duplicated functionality already covered by the main
    // detailed-tasks view, the legacy code was a maintenance tax, and
    // user explicitly requested its removal (B2).
    const wrap=document.getElementById('gantt-wrap');
    if (wrap) { wrap.style.display=''; }
    const rows=GanttView.getRows();
    if (!rows.length){wrap.innerHTML='<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">Нет данных</div></div>';return;}
    // V17.1 C1 — backlog header label removed (was «Бэклог»). Колодец остаётся,
    //   но текст заголовка / подзаголовка скрыт — пользовательский запрос.
    // V17.1 C4 — date sub теперь рендерится длинным русским форматом
    //   («20 апреля – 17 мая») через formatLongRange при сборке header'а;
    //   `sub` оставляем в исходном `DD.MM–DD.MM` потому что parser today-pill
    //   завязан на этот формат.
    const cols=[
      {key:'backlog',label:'',sub:'',cls:'gantt-window-backlog'},
      {key:'r120',label:'1.20',sub:'20.04–17.05',cls:'gantt-window-r120'},
      {key:'r121',label:'1.21',sub:'18.05–14.06',cls:'gantt-window-r121'},
      {key:'r122',label:'1.22',sub:'15.06–14.07',cls:'gantt-window-r122'},
      {key:'overtime',label:'OT',sub:'Овертайм',cls:'gantt-window-overtime'},
    ];
    // Only `detailedTasks` mode is reachable here — `arrowsNew` was handled
    // above (delegates to GanttV2). The legacy `compact` and team-wells
    // modes were removed (audit recommendation #4 / user request).
    return GanttView.renderDetailedTasks(rows, wrap, cols);
  },
  renderDetailedTasks(rows, wrap, cols) {
    /* ---- helpers ---- */
    const esc = Utils.escapeHtml;
    const toTags = v => String(v||'').split(/[|,]/).map(s=>s.trim()).filter(Boolean);
    const wtEmoji = wt => {
      const x = String(wt||'').trim().toLowerCase();
      if (!x) return '🧩';
      if (x.includes('бизнес аналит')) return '📈';
      if (x.includes('аналит')) return '📊';
      if (x.includes('backend')||x.includes('бэкенд')||x.includes('разработ')) return '💻';
      if (x.includes('frontend')||x.includes('фронт')) return '🖥️';
      if (x.includes('qa')||x.includes('тест')) return '🧪';
      if (x.includes('внедр')) return '🚀';
      if (x.includes('миграц')) return '🗃️';
      if (x.includes('стабилиз')) return '🧯';
      if (x.includes('хотфикс')||x.includes('hotfix')) return '🚑';
      if (x.includes('интеграц')) return '🔌';
      if (x.includes('документ')) return '📝';
      return '🧩';
    };

    /* ---- field maps ---- */
    const hasMap    = {backlog:'isUnassigned',r120:'hasRelease120',r121:'hasRelease121',r122:'hasRelease122',overtime:'hasOvertime'};
    const tfMap     = {backlog:'backlogTypes',r120:'release120Types',r121:'release121Types',r122:'release122Types',overtime:'overtimeTypes'};
    const colKeyMap = {backlog:'backlogTypes',r120:'release120Types',r121:'release121Types',r122:'release122Types',overtime:'overtimeTypes'};
    const COL_LABEL_MAP = { backlog:'Бэклог', r120:'1.20', r121:'1.21', r122:'1.22', overtime:'OT' };

    /* V15 Spine redesign 2026-04-30 — emoji-prefix helpers retired
       (avatar circle, 📅, 📬). Pill content is now a two-row layout:
         row 1 = name + state-glyph + comment-marker
         row 2 = «ФИО · 01.05—15.05 · token(s)» (meta footer)
       New helpers below produce the meta string and the state/comment
       markers as plain HTML — no emoji, no inline colours unless required
       (cmt-marker uses a CSS class for amber/blue). */

    /** Compact «01.05—15.05» from ISO-ish dates. Returns '' if either side
     *  is empty. Drops year (always current scope) but keeps day+month. */
    const _shortPeriod = (row) => {
      if (!row || !row.workStartDate || !row.workEndDate) return '';
      const fmt = (s) => {
        const d = new Date(s);
        if (Number.isNaN(d.getTime())) return String(s);
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
      };
      return `${fmt(row.workStartDate)}—${fmt(row.workEndDate)}`;
    };

    /** Compact assignee label for the meta-row. 0 → '—', 1 → fio,
     *  2 → "А, Б", 3+ → "А, Б +N". Falls back to abbreviated last names if
     *  the joined string would be too long for the pill (>22 chars). */
    const _assigneeLabel = (assignees) => {
      if (!assignees || !assignees.length) return '';
      const lasts = assignees.map(s => String(s || '').trim().split(/\s+/)[0] || s);
      if (assignees.length === 1) return lasts[0];
      if (assignees.length === 2) return `${lasts[0]}, ${lasts[1]}`;
      return `${lasts[0]}, ${lasts[1]} +${assignees.length - 2}`;
    };
    /** V16 roadmap-2 (B2) — short initials for the Compact-density badge.
     *  «Иванов Иван» → «ИИ»; single-name «Иванов» → «И». 2 chars max. */
    const _initialsLabel = (assignees) => {
      if (!assignees || !assignees.length) return '';
      const first = String(assignees[0] || '').trim();
      if (!first) return '';
      const parts = first.split(/\s+/).filter(Boolean);
      const init = parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
      const suffix = assignees.length > 1 ? `+${assignees.length - 1}` : '';
      return (init.toUpperCase() + suffix);
    };


    /* ---- shared helpers used by ctx-menu + drag-and-drop ---- */
    // Format ISO timestamp as "dd.mm.yy" — used in ghost-pill labels (#9).
    const fmtMoveDate = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(-2)}`;
    };
    // Move work-type `wt` from `srcCol` to `dstCol` on `row`. Records a ghost
    // arrow with timestamp so renderer leaves a "перенос dd.mm.yy" trail in the
    // source cell. Used by both the context-menu "Перенести в …" action and
    // cross-cell drag-and-drop (#5/#8/#9/#12).
    const moveWtBetweenCols = (row, wt, srcCol, dstCol, opts = {}) => {
      const srcField = colKeyMap[srcCol];
      const dstField = colKeyMap[dstCol];
      if (srcField && Array.isArray(row[srcField])) {
        row[srcField] = row[srcField].filter(t => t !== wt);
      }
      if (dstField) {
        const existing = Array.isArray(row[dstField]) ? row[dstField] : [];
        if (!existing.includes(wt)) existing.push(wt);
        row[dstField] = existing;
      }
      const at = new Date().toISOString();
      if (!Array.isArray(row.ganttArrows)) row.ganttArrows = [];
      // V15 (1.4.2): preserve full history of moves. Earlier we filtered out
      // any prior arrow for the same `wt` ("pill can only have ONE current
      // move-trail") — that erased the trail when the user moved a pill
      // through several columns (1.20 → 1.21 → 1.22 left only the last hop
      // visible). Now we append every move; renderer surfaces each as its
      // own sub-row so the chain reads naturally top-to-bottom.
      row.ganttArrows.push({ wt, srcCol, dstCol, at });
      // V14 (B5): if a comment was supplied (plan-locked move), append to
      // the row's transfer-comment trail. Each entry stores enough context
      // to be useful later: timestamp, what moved, src/dst, free-form text.
      // V17 P2 (CRIT-3): when plan is locked AND edit-mode is on, the
      // comment-modal is bypassed (`requireMoveComment` resolves '' early)
      // — but we MUST still record an audit entry. Otherwise edit-mode
      // becomes a hole in the plan-lock contract: 30 moves under edit-mode
      // produce zero `transferComments`, breaking compliance use-case.
      const planLocked = !!(state.planLocked);
      const editModeOn = !!(state.ganttEditMode);
      if (opts.comment) {
        if (!Array.isArray(row.transferComments)) row.transferComments = [];
        row.transferComments.push({ at, wt, from: srcCol, to: dstCol, text: String(opts.comment) });
      } else if (planLocked && editModeOn) {
        if (!Array.isArray(row.transferComments)) row.transferComments = [];
        row.transferComments.push({ at, wt, from: srcCol, to: dstCol, text: '[edit-mode]' });
      }
      row.dirty = true;
      row.updatedAt = at;
      RowFactory.updateDerived(row);
      Storage.save();
      try { window.HistoryLog?.gantt?.('move_wt', `${wt}: ${srcCol}→${dstCol}${opts.comment ? ' [с комментарием]' : ''}`, { wt, srcCol, dstCol, comment: opts.comment }); } catch(_) {}
    };
    // Inverse of moveWtBetweenCols: revert a moved pill back to its source cell
    // (#6: "Вернуть обратно" in the ctx menu of the destination pill).
    const revertMove = (row, wt, currentCol) => {
      const arrows = row.ganttArrows || [];
      const idx = arrows.findIndex(a => a.dstCol === currentCol && a.wt === wt);
      if (idx < 0) return null;
      const a = arrows[idx];
      const srcField = colKeyMap[a.srcCol];
      const dstField = colKeyMap[a.dstCol];
      if (dstField && Array.isArray(row[dstField])) {
        row[dstField] = row[dstField].filter(t => t !== wt);
      }
      if (srcField) {
        const existing = Array.isArray(row[srcField]) ? row[srcField] : [];
        if (!existing.includes(wt)) existing.push(wt);
        row[srcField] = existing;
      }
      row.ganttArrows = arrows.filter((_, i) => i !== idx);
      row.dirty = true;
      row.updatedAt = new Date().toISOString();
      RowFactory.updateDerived(row);
      Storage.save();
      return a;
    };

    /* ---- per-column widths (persisted across re-renders) ---- */
    if (!GanttView._dtColWidths) GanttView._dtColWidths = {};
    if (!GanttView._dtHiddenTeams) GanttView._dtHiddenTeams = new Set();
    const wrapW      = Math.max(960, wrap.clientWidth || 0);
    const lwDefault  = Math.max(220, Math.min(420, Math.round(wrapW * 0.18)));
    // '_label' key stores user-resized label-column width
    if (!GanttView._dtColWidths['_label']) GanttView._dtColWidths['_label'] = lwDefault;
    const getLW      = () => GanttView._dtColWidths['_label'] || lwDefault;
    const defaultCw  = Math.max(200, Math.floor((wrapW - getLW()) / cols.length));
    const getW       = key => GanttView._dtColWidths[key] || defaultCw;
    // V17.1 C2 — wells растягиваются равномерно на всю доступную ширину.
    //   Если пользователь не менял ширину колодца → выдаём
    //   `minmax(<defaultCw>px, 1fr)` — оставшееся место делится между ними.
    //   Если ширина зафиксирована вручную → конкретные пиксели.
    //   Если все колодцы зафиксированы — поведение прежнее (точные px),
    //   просто без 1fr-наполнения.
    const makeGT     = () => {
      const lw = getLW();
      const segs = cols.map(c => {
        const w = GanttView._dtColWidths[c.key];
        return w ? `${w}px` : `minmax(${defaultCw}px, 1fr)`;
      });
      return `${lw}px ` + segs.join(' ');
    };

    /* ---- build HTML body ---- */
    let body = '';
    const teams   = Utils.unique(rows.map(r => r.team));
    const teamKey = t => t.replace(/[^a-zA-Zа-яА-ЯёЁъЪ0-9]/g,'_');

    /* V16 roadmap-2 (S3) — capacity load-distribution sparkline. We
       precompute (a) per-team per-bucket counts and (b) the global max so
       bars are comparable across teams (one team's «full» bar = another's
       «full» bar). Threshold = 8 per bucket → bar gets a red overload tick
       on top so PMs can spot overcommitted teams in one glance. */
    const BUCKET_KEYS = ['backlog','r120','r121','r122','overtime'];
    const teamCounts = new Map();
    let globalMaxBucket = 0;
    rows.forEach(r => {
      const key = r.team;
      if (!teamCounts.has(key)) teamCounts.set(key, { backlog:0, r120:0, r121:0, r122:0, overtime:0 });
      const c = teamCounts.get(key);
      if (r.hasRelease120)  c.r120++;
      if (r.hasRelease121)  c.r121++;
      if (r.hasRelease122)  c.r122++;
      if (r.hasOvertime)    c.overtime++;
      if (r.isUnassigned)   c.backlog++;
    });
    teamCounts.forEach(c => {
      BUCKET_KEYS.forEach(k => { if (c[k] > globalMaxBucket) globalMaxBucket = c[k]; });
    });
    if (globalMaxBucket < 1) globalMaxBucket = 1;
    const OVERLOAD_THRESHOLD = 8;

    /* V16 roadmap-2 (B1) — per-column distribution sparkline. Aggregates
       work-type counts across ALL teams for each bucket so the column
       header gets a tiny stacked-bar showing the whole-portfolio mix
       («в 1.21 баланс BE/FE/QA сломан?»). Computed once per render. */
    const colWtMix = { backlog:{}, r120:{}, r121:{}, r122:{}, overtime:{} };
    const COL_TO_FIELD = {
      backlog:'backlogTypes', r120:'release120Types', r121:'release121Types',
      r122:'release122Types', overtime:'overtimeTypes',
    };
    rows.forEach(r => {
      Object.entries(COL_TO_FIELD).forEach(([colKey, field]) => {
        (r[field] || []).forEach(wt => {
          colWtMix[colKey][wt] = (colWtMix[colKey][wt] || 0) + 1;
        });
      });
    });

    /* V16 roadmap-2 (S4) — bucket flow badges. Aggregate ganttArrows
       across all rows: «+N» = arrows that LANDED in bucket K, «−N» =
       arrows that LEFT bucket K. Renders on the column header next to
       the release-tag so a PM can see «1.20 lost 7, 1.21 gained 5»
       without scrolling through trail-rows. */
    const flowIn  = { backlog:0, r120:0, r121:0, r122:0, overtime:0 };
    const flowOut = { backlog:0, r120:0, r121:0, r122:0, overtime:0 };
    /* V16 roadmap-2 (A4) — overview mode aggregations.
       For each (team, bucket) collect a frequency map of work-types so we
       can render a horizontal stacked-bar in the team's bucket cell.
       Skipped entirely when mode is 'default'. */
    const _isOverview = GanttView._dtMode === 'overview';
    const teamWtBuckets = new Map();   // team → { backlog: {wt:n}, r120:{wt:n}, ... }
    if (_isOverview) {
      const FIELD_BY_KEY = {
        backlog:  'backlogTypes',
        r120:     'release120Types',
        r121:     'release121Types',
        r122:     'release122Types',
        overtime: 'overtimeTypes',
      };
      rows.forEach(r => {
        const team = r.team || '—';
        if (!teamWtBuckets.has(team)) {
          teamWtBuckets.set(team, { backlog:{}, r120:{}, r121:{}, r122:{}, overtime:{} });
        }
        const slot = teamWtBuckets.get(team);
        Object.entries(FIELD_BY_KEY).forEach(([colKey, field]) => {
          (r[field] || []).forEach(wt => {
            slot[colKey][wt] = (slot[colKey][wt] || 0) + 1;
          });
        });
      });
    }

    rows.forEach(r => {
      const arrows = Array.isArray(r.ganttArrows) ? r.ganttArrows : [];
      arrows.forEach(a => {
        if (a.dstCol in flowIn)  flowIn[a.dstCol]++;
        if (a.srcCol in flowOut) flowOut[a.srcCol]++;
      });
    });

    /* V16 (gantt-roadmap #1) — Linear-style team headers.
       Stable HSL hue per team via FNV-1a-ish hash → 3px rail on the left of
       the row, identifying the team across the gantt without colour-coding
       pills (pills already use type-of-work colour). Used in the new
       team-header HTML below. */
    const teamHue = (s) => {
      let h = 2166136261;
      const str = String(s || '');
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      return h % 360;
    };

    teams.forEach(team => {
      const teamRows = rows.filter(r => r.team === team);
      const tk       = teamKey(team);
      const isHidden = GanttView._dtHiddenTeams.has(tk);
      const hue      = teamHue(team);

      // V16 team-header: full-row sticky-feeling block, 3px coloured rail
      // (hash-hue per team), name 14px/600, total-task count + per-bucket
      // chips with active counts highlighted (empty buckets read as `·`
      // at 40% opacity). The label cell hosts the rail; bucket cells render
      // a chip with bucket-label + count so each cell is a tiny indicator
      // even when the team is collapsed.
      // V16 roadmap-2 (S3) — capacity sparkline: 5 vertical bars (one per
      // bucket), heights proportional to per-team-per-bucket count vs the
      // global max. Bucket > OVERLOAD_THRESHOLD → red top tick so an over-
      // committed team is spottable instantly. Total height 16 px, mounted
      // inside the team-label cell to the right of the «N задач» count.
      const tCounts = teamCounts.get(team) || { backlog:0, r120:0, r121:0, r122:0, overtime:0 };
      const overloadCount = BUCKET_KEYS.reduce((n, k) => n + (tCounts[k] > OVERLOAD_THRESHOLD ? 1 : 0), 0);
      const sparkBars = BUCKET_KEYS.map(k => {
        const v = tCounts[k];
        const heightPct = v === 0 ? 0 : Math.max(8, (v / globalMaxBucket) * 100);
        const overload = v > OVERLOAD_THRESHOLD;
        return `<span class="v16-spark-bar v16-spark-bar-${esc(k)}${overload ? ' v16-spark-bar-overload' : ''}${v === 0 ? ' v16-spark-bar-empty' : ''}"
          style="height:${heightPct.toFixed(0)}%"
          title="${esc(k === 'backlog' ? 'Бэклог' : k === 'r120' ? '1.20' : k === 'r121' ? '1.21' : k === 'r122' ? '1.22' : 'OT')}: ${v}${overload ? ' · перегруз' : ''}"
          aria-label="${v}"></span>`;
      }).join('');
      const sparkHtml = `<span class="v16-team-spark${overloadCount ? ' v16-team-spark-overload' : ''}" aria-label="Загрузка по колодцам">${sparkBars}</span>`;

      // V16 roadmap-2 (A4) — bucket cell renders differently per mode:
      //   default  → count chip («1.20 4»)
      //   overview → horizontal stacked-bar of work-types + total count
      const _bucketCells = cols.map(col => {
        const cnt = teamRows.filter(r => r[hasMap[col.key]]).length;
        const isActive = cnt > 0;
        if (_isOverview) {
          const wtMap = teamWtBuckets.get(team)?.[col.key] || {};
          const wtEntries = Object.entries(wtMap).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
          const wtTotal   = wtEntries.reduce((s, [, n]) => s + n, 0);
          const segs = wtEntries.map(([wt, n]) => {
            const color = (PHASE_COLORS && PHASE_COLORS[wt]) || '#9ca3af';
            const widthPct = (n / wtTotal) * 100;
            return `<span class="gdt-overview-seg" style="background:${color};width:${widthPct.toFixed(2)}%" title="${esc(wt)}: ${n}"></span>`;
          }).join('');
          return `<div class="gantt-team-header-cell v16-team-bucket-cell gdt-overview-cell" data-col="${esc(col.key)}">
            ${wtTotal
              ? `<div class="gdt-overview-bar" aria-label="Распределение типов работ">${segs}</div>
                 <span class="gdt-overview-count">${wtTotal}</span>`
              : `<span class="gdt-overview-empty">·</span>`}
          </div>`;
        }
        // V17.1 C5 — `v16-team-bucket-label` (текст «1.21» / «Бэклог» внутри
        // строки команды) удалён по требованию пользователя. Заголовок уже
        // несёт релиз-тег один раз на колодце; в team-row остаётся только
        // count — это снижает визуальный шум и улучшает density.
        return `<div class="gantt-team-header-cell v16-team-bucket-cell" data-col="${esc(col.key)}">
          <span class="v16-team-bucket${isActive ? ' v16-team-bucket-active' : ' v16-team-bucket-empty'}" data-bucket="${esc(col.key)}">
            <span class="v16-team-bucket-count">${isActive ? cnt : '·'}</span>
          </span>
        </div>`;
      }).join('');

      body += `<div class="gantt-team-header gdt-grid-row v16-team-row${_isOverview ? ' gdt-overview-row' : ''}" data-team-key="${esc(tk)}" style="display:grid;grid-template-columns:${makeGT()}">
        <span class="v16-team-rail" style="background:hsl(${hue},58%,52%)" aria-hidden="true"></span>
        <div class="gantt-team-header-cell gdt-team-label v16-team-label">
          ${_isOverview
            ? `<span class="gdt-overview-chev">▸</span>`
            : `<button class="gantt-team-vis-btn" data-team-key="${esc(tk)}" title="Скрыть/показать строки команды">${isHidden?'▸':'▾'}</button>`}
          <strong class="gdt-team-name v16-team-name">${esc(team||'—')}</strong>
          <!-- V17.1 C12 — заголовок столбца Эпик: «N эпиков» с правильным
               окончанием через pl(). Каждая строка под team-row = один эпик. -->
          <span class="team-count v16-team-total">${teamRows.length} ${pl(teamRows.length, EPIC_FORMS)}</span>
          <!-- V17.1 C13 — «+» добавить эпик в эту команду (модалка с полным
               набором полей: epic / scope / release / типы работ / зависимости /
               комментарий). После сохранения новая строка добавляется в гант. -->
          <button class="gdt-team-add-epic" data-team="${esc(team)}" title="Добавить эпик в команду «${esc(team)}»" aria-label="Добавить эпик в команду ${esc(team)}">+</button>
          ${sparkHtml}
        </div>
        ${_bucketCells}
      </div>`;

      // In overview mode every team shows ONLY the aggregated row above —
      // no epic-rows, no trail-rows. Skip the per-row body to keep the
      // surface dense for at-a-glance distribution.
      if (_isOverview) return;

      teamRows.forEach(row => {
        // #10: don't truncate — render full epic name; CSS handles wrapping/overflow.
        const epicText     = row.epic || row.tasks || '(без эпика)';
        const cats         = toTags(row.category);
        // V16 roadmap-2 (A3) — left epic column adopts mini-spine language:
        // categories rendered as mono-text tags (no chip background), and
        // a counter line «N работ · M переносов» added underneath. The
        // dominant work-type colour drives a 2 px left-stripe on the row
        // label (analogue of the pill stripe) so the left column finally
        // speaks the same Spine dialect as the right side of the screen.
        const catHtml      = cats.length
          ? cats.slice(0,3).map(cat=>`<span class="v16-epic-cat">${esc(Utils.truncate(cat,16))}</span>`).join('<span class="v16-epic-cat-sep">·</span>')
          : '<span class="v16-epic-cat-empty">без категории</span>';
        // Aggregate work-type tally across the row's buckets to pick the
        // dominant accent colour for the row's left-stripe.
        const _wtTally = Object.create(null);
        ['release120Types','release121Types','release122Types','overtimeTypes','backlogTypes'].forEach(field => {
          (row[field] || []).forEach(t => { _wtTally[t] = (_wtTally[t] || 0) + 1; });
        });
        let _domWt = '';
        let _domCount = 0;
        for (const [t, n] of Object.entries(_wtTally)) {
          if (n > _domCount) { _domCount = n; _domWt = t; }
        }
        const _epicStripeColor = (PHASE_COLORS && PHASE_COLORS[_domWt]) || '#6b7280';
        const _totalWorks = Object.values(_wtTally).reduce((n, v) => n + v, 0);
        const _moveCount  = Array.isArray(row.ganttArrows) ? row.ganttArrows.length : 0;
        // V17.1 C11 — «N работ» → «N задач» через pl(). Также корректное
        // окончание для «переносов» (работало частично — pl универсальнее).
        const _epicMeta   = `${_totalWorks} ${pl(_totalWorks, TASK_FORMS)}${_moveCount ? ' · ' + _moveCount + ' ' + pl(_moveCount, ['перенос','переноса','переносов']) : ''}`;
        const assignees    = toTags(row.assignee);
        const hasAssignee  = assignees.length > 0;
        const assigneeText = hasAssignee ? assignees.join(', ') : 'без исполнителя';
        // V15: warn-triangle removed from epic title per user request.
        // The "no assignee" signal stays via the assignee tooltip on pills.
        const dp = row.donePills || {}; // per-pill done map: "${colKey}__${wt}" → true
        const pillDone = (colKey, wt) => !!dp[`${colKey}__${wt}`];
        // V15: per-pill «not planned» flag. Same key shape as donePills.
        const up = row.unplannedPills || {};
        const pillUnplanned = (colKey, wt) => !!up[`${colKey}__${wt}`];
        // Labels for ghost-marker (kept in sync with NEXT_RELEASE/COL_LABEL below)
        const _GHOST_COL_LABEL = { backlog:'Бэклог', r120:'1.20', r121:'1.21', r122:'1.22', overtime:'OT' };
        // V15 (1.4): inline ghost-pills in cells were retired — every move
        // is now rendered as its own dedicated sub-row beneath the parent
        // epic row, so the «↗ ghost» and the destination marker sit on the
        // same y-line and the SVG arrow becomes purely horizontal.
        // Cells stop showing ghost pills entirely; `arrowsBySrc` is gone.

        // V15 — comment lookup for bulk-added pills. When plan was locked
        // and the user added a pill via «+ → bucket + comment», the action
        // lands in `transferComments[]` with `from === '+'`. Render 📬 on
        // each affected pill with the comment in the tooltip.
        const _comments = Array.isArray(row.transferComments) ? row.transferComments : [];
        // V17 P2 (H6) — pre-bucket transferComments into a Map keyed by
        // `<col>__<wt>__<kind>`. Replaces the per-pill O(N×M) scan in
        // `findAddComment` / `findMoveComment` (called for EVERY pill in
        // EVERY render). On 30 pills × 50 comments × 100 teams that was
        // 4.5M iterations per renderChart. Audit 2026-05 (full-stack P2).
        const _addByPill  = new Map();
        const _moveByPill = new Map();
        for (const c of _comments) {
          if (!c || !c.to || !c.wt) continue;
          const key = `${c.to}__${c.wt}`;
          const ts  = Date.parse(c.at) || 0;
          if (c.from === '+') {
            const prev = _addByPill.get(key);
            if (!prev || ts > prev._ts) _addByPill.set(key, Object.assign({ _ts: ts }, c));
          } else {
            const prev = _moveByPill.get(key);
            if (!prev || ts > prev._ts) _moveByPill.set(key, Object.assign({ _ts: ts }, c));
          }
        }
        const findAddComment = (colKey, wt) => _addByPill.get(`${colKey}__${wt}`) || null;
        // V15 Spine 2026-04-30 — `_addCmtIcon` 📬-prefix helper retired;
        // the comment marker now lives inside `_buildPill` as a square
        // (gdt-pill-cmt-marker), rendered from the same `findAddComment`
        // result. Trail ghost-pills use the same marker class — see below.

        /* V15 Spine — per-pill assignee with row-level fallback. Reads the
           per-pill map first; if absent, falls back to row.assignee so legacy
           rows keep displaying ФИО everywhere until per-pill overrides land. */
        const ap = row.assigneePills || {};
        const pillAssignees = (colKey, wt) => {
          const perPill = ap[`${colKey}__${wt}`];
          if (typeof perPill === 'string' && perPill.trim()) return toTags(perPill);
          return assignees;
        };

        /* V17 P2 (H6) — replaced O(N) scan with Map lookup. */
        const findMoveComment = (colKey, wt) => _moveByPill.get(`${colKey}__${wt}`) || null;

        /* Single source of truth for pill HTML. Used by both backlog and
           release/overtime branches below. Two-row Spine layout:
             row 1: name + state-glyph + comment-marker
             row 2: «ФИО · 01.05—15.05 · token(s)» */
        const ip = row.inProgressPills || {};
        const pillInProgress = (colKey, wt) => !!ip[`${colKey}__${wt}`];
        const _buildPill = (colKey, wt) => {
          const isDone       = pillDone(colKey, wt);
          const isUnplanned  = pillUnplanned(colKey, wt);
          const isInProgress = pillInProgress(colKey, wt);
          const moveCmt      = findMoveComment(colKey, wt);
          const addCmt       = findAddComment(colKey, wt);
          const cmt          = addCmt || moveCmt;        // prefer added-marker if both
          const pillAssg     = pillAssignees(colKey, wt);
          const period       = _shortPeriod(row);

          // State priority: done > unplanned > in-progress > todo (default).
          // Only «in-progress» pills get the saturated solid-circle glyph;
          // «todo» (the new default) is a hollow circle so the gantt reads
          // calmer until somebody actively starts work.
          const stateClass =
            isDone       ? 'gdt-pill-state gdt-pill-state-done'
          : isUnplanned  ? 'gdt-pill-state gdt-pill-state-unplanned'
          : isInProgress ? 'gdt-pill-state gdt-pill-state-active'
          :                'gdt-pill-state gdt-pill-state-todo';

          const cmtMarker = cmt && cmt.text
            ? `<span class="gdt-pill-cmt-marker ${addCmt ? 'gdt-pill-cmt-add' : 'gdt-pill-cmt-transfer'}"
                data-tip="${esc(`${addCmt ? 'Добавлено' : 'Перенесено'}${cmt.at ? ' ' + fmtMoveDate(cmt.at) : ''}\nКомментарий: ${cmt.text}`)}"></span>`
            : '';

          // Meta line — strictly «ФИО · 01.05—15.05». Date / status tokens
          // (parked / moved / added) were removed 2026-04-30 because they
          // squeezed the period off the pill at typical widths AND duplicated
          // info that already lives in the cmt-marker tooltip + state-glyph.
          // «Не запланирована» is signalled three times already (left-stripe
          // dashed + state-glyph dashed circle + italic name), no token needed.
          const metaParts = [];
          const assgLabel = _assigneeLabel(pillAssg);
          if (assgLabel) metaParts.push(esc(assgLabel));
          if (period)    metaParts.push(esc(period));

          const metaText  = metaParts.length ? metaParts.join(' · ') : '';
          const metaInner = metaText
            ? `<span class="gdt-pill-meta">${metaText}</span>`
            : '<span class="gdt-pill-meta gdt-pill-meta-empty">—</span>';

          // Tooltip — full ФИО list + period + comment if present.
          const tipFio    = pillAssg.length ? pillAssg.join(', ') : 'без исполнителя';
          const tipParts  = [`${wt} — ${tipFio}`];
          if (period) tipParts.push(`Период: ${row.workStartDate} → ${row.workEndDate}`);
          if (cmt && cmt.text) tipParts.push(`${addCmt ? 'Добавлено' : 'Перенесено'}${cmt.at ? ' ' + fmtMoveDate(cmt.at) : ''}: ${cmt.text}`);
          if (isUnplanned) tipParts.push('Не запланирована');

          const dc = isDone      ? ' gdt-pill-done'      : '';
          const uc = isUnplanned ? ' gdt-pill-unplanned' : '';

          // V15 Spine 2026-04-30 — native `title=` replaced with `data-tip`.
          // Browsers wait ~1.5s before showing native tooltips and there's
          // no web API to shorten that. We render our own tooltip via a
          // delegated mouseover handler attached once in `_bindFastTooltip`
          // (200 ms delay). `aria-label` keeps screen-reader access.
          // V16 roadmap-2 (C1) — progress-underline. When the pill is
          // «в работе» AND the row has both work-period dates, derive a
          // 0-1 progress factor from how far today sits inside that
          // period. Renders as a 2 px bottom-edge bar in the work-type
          // accent. Skipped if no dates or pill not in-progress.
          let progressBar = '';
          if (isInProgress && row.workStartDate && row.workEndDate) {
            const s = new Date(row.workStartDate).getTime();
            const e0 = new Date(row.workEndDate).getTime();
            const n = Date.now();
            if (Number.isFinite(s) && Number.isFinite(e0) && e0 > s) {
              const ratio = Math.max(0, Math.min(1, (n - s) / (e0 - s)));
              progressBar = `<span class="gdt-pill-progress" style="width:${(ratio * 100).toFixed(1)}%" aria-hidden="true"></span>`;
            }
          }
          // V16 roadmap-2 (B6) — `tabindex="-1"` so roving-tabindex
          // keyboard nav can promote one pill at a time.
          // V17 P2 (CONSENSUS-1) — closing `>` added after data-tip. All
          // four audit agents (full-stack, QA, system analyst, gantt-spec)
          // independently flagged the open-tag never closed. Browser HTML5
          // recovery silently fixed it for layout, but inner spans became
          // siblings, breaking `.gantt-type-pill .gdt-pill-row-1` selector
          // semantics and aria-label association.
          return `<span class="gantt-type-pill${dc}${uc}" draggable="true" tabindex="-1" role="button"
            data-wt="${esc(wt)}" data-row-id="${esc(row.id)}" data-src-col="${esc(colKey)}"
            aria-label="${esc(tipParts.join(' · '))}"
            data-tip="${esc(tipParts.join('\n'))}">
            <span class="gdt-pill-row-1">
              <span class="gdt-pill-name">${esc(Utils.truncate(wt, 18))}</span>
              ${pillAssg.length ? `<span class="gdt-pill-initials" aria-hidden="true">${esc(_initialsLabel(pillAssg))}</span>` : ''}
              <span class="${stateClass}"></span>${cmtMarker}
            </span>
            <span class="gdt-pill-row-2">${metaInner}</span>
            ${progressBar}
          </span>`;
        };

        const cells = cols.map(col => {
          const ghosts = '';

          /* ---- backlog cell: always show "+", pills from backlogTypes ---- */
          if (col.key === 'backlog') {
            // V16 roadmap-2 (C2) — sort pills inside the cell by canonical
            // PHASE_ORDER (BA → analytics → BE → FE → QA → внедрение → …).
            // Workflow flows in this order, so the visual reads as a soft
            // left-to-right time gradient inside each cell. Unknown wt's
            // (custom strings) fall to the end, alphabetically.
            const _phaseRank = (t) => {
              const idx = PHASE_ORDER.indexOf(t);
              return idx >= 0 ? idx : 999 + t.localeCompare(' ', 'ru');
            };
            const bTypes = [...(row.backlogTypes || [])].sort((a, b) => _phaseRank(a) - _phaseRank(b));
            const shown  = bTypes.slice(0, 12);
            const more   = bTypes.length - shown.length;
            const pills  = shown.map(t => _buildPill('backlog', t)).join('');
            const moreHtml = more > 0 ? `<span class="gantt-type-pill"><span class="gdt-pill-row-1"><span class="gdt-pill-name">+${more}</span></span></span>` : '';
            const inner = (pills || ghosts) ? `<div class="gantt-bar-multi" data-row-id="${esc(row.id)}" data-src-col="backlog">${pills}${moreHtml}${ghosts}</div>` : '';
            return `<div class="gantt-cell gantt-window-backlog" data-col="backlog" data-row-id="${esc(row.id)}">
              ${inner}
              <button class="gdt-add-type-btn" data-row-id="${esc(row.id)}" title="Добавить тип задачи">+</button>
            </div>`;
          }
          /* ---- release / overtime cells ---- */
          const has   = row[hasMap[col.key]];
          // V16 roadmap-2 (C2) — same PHASE_ORDER sort as backlog above
          // (BA → analytics → BE → FE → QA → внедрение → стабилизация → hotfix).
          const _phaseRankR = (t) => {
            const idx = PHASE_ORDER.indexOf(t);
            return idx >= 0 ? idx : 999 + t.localeCompare(' ', 'ru');
          };
          const types = [...(row[tfMap[col.key]] || [])].sort((a, b) => _phaseRankR(a) - _phaseRankR(b));
          const shown = types.slice(0, 12);
          const more  = types.length - shown.length;
          const pills = shown.map(t => _buildPill(col.key, t)).join('');
          const fallback = `<span class="gantt-type-pill" draggable="true"
            data-wt="задача" data-row-id="${esc(row.id)}" data-src-col="${esc(col.key)}">
            <span class="gdt-pill-row-1"><span class="gdt-pill-name">задача</span></span>
            </span>`;
          const moreHtml = more > 0 ? `<span class="gantt-type-pill"><span class="gdt-pill-row-1"><span class="gdt-pill-name">+${more}</span></span></span>` : '';
          const inner = (has || ghosts)
            ? `<div class="gantt-bar-multi" data-row-id="${esc(row.id)}" data-src-col="${esc(col.key)}">${has ? (pills||fallback) : ''}${moreHtml}${ghosts}</div>`
            : '';
          return `<div class="gantt-cell ${col.cls}" data-col="${esc(col.key)}" data-row-id="${esc(row.id)}">
            ${inner}
          </div>`;
        });

        // #1: risk badges removed from epic-column header — they cluttered
        //   the title and the dedicated risks panel on the dashboard already
        //   surfaces them. Keep the no-assignee triangle.
        body += `<div class="gantt-row gdt-grid-row" data-team-key="${esc(tk)}" data-row-id="${esc(row.id)}" style="display:${isHidden?'none':'grid'};grid-template-columns:${makeGT()}">
          <div class="gantt-row-label v16-epic-label">
            <span class="v16-epic-stripe" style="background:${_epicStripeColor}" aria-hidden="true"></span>
            <div class="v16-epic-name gantt-row-label-name">${esc(epicText)}</div>
            <div class="v16-epic-sub gantt-row-label-sub">
              <span class="v16-epic-meta">${esc(_epicMeta)}</span>
              ${cats.length ? '<span class="v16-epic-cat-sep">·</span>' : ''}
              <span class="v16-epic-cats">${catHtml}</span>
            </div>
          </div>${cells.join('')}</div>`;

        // V15 (1.4) — trail sub-rows: ONE per recorded ganttArrow, in
        // chronological order. Each sub-row has the same grid as the main
        // row. Cells empty except `srcCol` (a ghost-pill «↗ wt») and
        // `dstCol` (a ghost-marker «↘ wt»). They're paired by a unique
        // `data-arrow-at` so `drawPostponeArrows` connects ONLY them
        // (no diagonal to the main row). The actual pill stays on the
        // main row in its current bucket.
        const arrows = Array.isArray(row.ganttArrows) ? row.ganttArrows : [];
        // V15 — comment lookup: transferComments[] is the canonical trail
        // for both moves AND bulk-adds. Find the comment matching this move
        // (same wt + src + dst, closest timestamp). Falls back to undefined.
        const comments = Array.isArray(row.transferComments) ? row.transferComments : [];
        const findComment = (arrow) => {
          // Prefer EXACT timestamp match; otherwise the most-recent earlier
          // entry that matches wt+from+to (5-second tolerance — different
          // setters use different clocks).
          const target = Date.parse(arrow.at) || 0;
          let best = null;
          let bestDelta = Infinity;
          for (const c of comments) {
            if (c.wt !== arrow.wt) continue;
            if (c.from !== arrow.srcCol) continue;
            if (c.to   !== arrow.dstCol) continue;
            const cTs = Date.parse(c.at) || 0;
            const delta = Math.abs(cTs - target);
            if (delta < bestDelta) { bestDelta = delta; best = c; }
          }
          return best;
        };

        arrows.forEach((a) => {
          const dt = fmtMoveDate(a.at);
          const cmt = findComment(a);
          // V15 Spine 2026-04-30 — emoji on trail ghost-pills retired.
          // Use the same square cmt-marker as on main pills so the visual
          // language stays consistent. Hollow Twin cascade auto-applies on
          // unplanned via styles.css.
          const cmtIcon = cmt && cmt.text
            ? `<span class="gdt-pill-cmt-marker gdt-pill-cmt-transfer gdt-trail-cmt" data-tip="${esc(`Перенесено${dt ? ' ' + dt : ''}\nКомментарий: ${cmt.text}`)}"></span>`
            : '';
          // V16 (gantt-roadmap #4) — compact trail-strip. Drops the «↗ wt»
          // and «↘ wt» text duplication (the wt is already on the parent
          // pill above) — src now shows only «↗ DD.MM», dst shows just
          // «↘» as a tiny chip. Left label collapses to an L-connector
          // hairline. Total height ~20 px instead of 26+. Arrow stroke
          // colour switches to the work-type accent (handled in
          // drawPostponeArrows below).
          const trailCells = cols.map(col => {
            if (col.key === a.srcCol) {
              return `<div class="gantt-cell ${col.cls} gdt-trail-cell" data-col="${esc(col.key)}" data-row-id="${esc(row.id)}">
                <span class="gantt-type-pill gantt-pill-ghost gdt-trail-src"
                  data-wt="${esc(a.wt)}" data-row-id="${esc(row.id)}"
                  data-src-col="${esc(a.srcCol)}" data-dst-col="${esc(a.dstCol)}"
                  data-arrow-at="${esc(a.at || '')}"
                  data-tip="↗ ${esc(a.wt)} перенесено${dt ? ' ' + dt : ''}">${cmtIcon}<span class="gdt-trail-arrow">↗</span>${dt ? `<span class="gdt-trail-date">${esc(dt)}</span>` : ''}</span>
              </div>`;
            }
            if (col.key === a.dstCol) {
              return `<div class="gantt-cell ${col.cls} gdt-trail-cell" data-col="${esc(col.key)}" data-row-id="${esc(row.id)}">
                <span class="gantt-type-pill gantt-pill-ghost gdt-trail-dst"
                  data-wt="${esc(a.wt)}" data-row-id="${esc(row.id)}"
                  data-src-col="${esc(a.srcCol)}" data-dst-col="${esc(a.dstCol)}"
                  data-arrow-at="${esc(a.at || '')}"
                  data-tip="↘ ${esc(a.wt)} прибыло в ${esc(_GHOST_COL_LABEL[a.dstCol] || a.dstCol)}${dt ? ' ' + dt : ''}"><span class="gdt-trail-arrow">↘</span></span>
              </div>`;
            }
            return `<div class="gantt-cell ${col.cls} gdt-trail-cell gdt-trail-empty" data-col="${esc(col.key)}"></div>`;
          }).join('');
          body += `<div class="gantt-row gantt-row-trail gdt-grid-row" data-team-key="${esc(tk)}" data-arrow-at="${esc(a.at || '')}" style="display:${isHidden?'none':'grid'};grid-template-columns:${makeGT()}">
            <div class="gantt-row-label gdt-trail-label">
              <span class="gdt-trail-l-connector" aria-hidden="true"></span>
            </div>${trailCells}</div>`;
        });
      });
    });

    /* ---- header with resize handles ---- */
    const gt = makeGT();
    const headerCols =
      `<div class="gantt-header-label" style="position:relative">Эпик / Категория
        <div class="gdt-resize-handle" data-col-key="_label" title="Потяните чтобы изменить ширину столбца задач"></div>
      </div>` +
      cols.map(c => {
        // V16 (gantt-roadmap #3) — Unified Date-Rail. The bucket label
        // becomes a release-tag (16 px weight 800), date-range a quiet
        // meta-line, and we inject a «сегодня DD.MM» pill on the bucket
        // whose date-range covers today. `c.sub` is `DD.MM–DD.MM`; we
        // parse both ends and compare against today's month+day (year-
        // agnostic — the spread of a release window is what matters).
        const today = new Date();
        const todayLabel = `${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}`;
        const isCurrent = (() => {
          if (!c.sub) return false;
          const m = c.sub.match(/^(\d{2})\.(\d{2})\D+(\d{2})\.(\d{2})/);
          if (!m) return false;
          const [, sd, sm, ed, em] = m;
          // Compare as month*100+day so cross-month ranges work correctly.
          const start = parseInt(sm, 10) * 100 + parseInt(sd, 10);
          const end   = parseInt(em, 10) * 100 + parseInt(ed, 10);
          const now   = (today.getMonth() + 1) * 100 + today.getDate();
          return now >= start && now <= end;
        })();
        // V16 roadmap-2 (B5) — simplify today-pill: drop the DD.MM duplicate
        // (the date is already in the meta-line right above + the inset-
        // accent border already says «THIS column is today»).
        const todayPill = isCurrent
          ? `<span class="gdt-rail-today" title="Сегодня ${esc(todayLabel)}">сегодня</span>`
          : '';
        // V17.1 C4 — render long Russian range («20 апреля – 17 мая»);
        // c.sub оставляем DD.MM–DD.MM выше для today-pill parser.
        const subPretty = c.sub && /\d{2}\.\d{2}/.test(c.sub) ? formatLongRange(c.sub) : c.sub;
        const sub = subPretty
          ? `<span class="gdt-rail-meta gantt-col-date">${esc(subPretty)}</span>`
          : (c.key === 'overtime' ? '' : '');
        const label = c.key === 'backlog'
          ? `<span class="gdt-rail-label gdt-rail-label-backlog">${esc(c.label)}</span>`
          : `<span class="gdt-rail-label">${esc(c.label)}</span>`;
        // V16 roadmap-2 (S4) — flow badges. `+N` (came in, blue) and `−N`
        // (left, amber). Both hidden when 0; `±` direction matches the
        // pill cmt-marker semantics (blue = added, amber = transferred).
        const fIn  = flowIn[c.key]  || 0;
        const fOut = flowOut[c.key] || 0;
        const flowBadges = (fIn || fOut)
          ? `<span class="gdt-rail-flow" title="Перенесено в колодец: ${fIn} · из колодца: ${fOut}">
              ${fIn  ? `<span class="gdt-rail-flow-in">+${fIn}</span>`   : ''}
              ${fOut ? `<span class="gdt-rail-flow-out">−${fOut}</span>` : ''}
            </span>`
          : '';
        // V16 roadmap-2 (B1) — distribution sparkline above the header.
        // 4 px-tall stacked bar, segments coloured by work-type from the
        // canonical PHASE_COLORS palette. Empty bucket → no bar. Tooltip
        // on each segment names the work-type and count.
        const _mix = colWtMix[c.key] || {};
        const _mixEntries = Object.entries(_mix).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
        const _mixTotal   = _mixEntries.reduce((s, [, n]) => s + n, 0);
        const distSpark = _mixTotal
          ? `<div class="gdt-rail-dist" aria-label="Распределение типов работ в колодце">
              ${_mixEntries.map(([wt, n]) => {
                const color = (PHASE_COLORS && PHASE_COLORS[wt]) || '#9ca3af';
                const widthPct = (n / _mixTotal) * 100;
                return `<span class="gdt-rail-dist-seg" style="background:${color};width:${widthPct.toFixed(2)}%" title="${esc(wt)}: ${n}"></span>`;
              }).join('')}
            </div>`
          : '';
        return `<div class="gantt-header-col${isCurrent ? ' gdt-rail-current' : ''}" data-col="${esc(c.key)}" style="position:relative">
          ${distSpark}
          <div class="gdt-rail-stack">${label}${sub}${todayPill}${flowBadges}</div>
          <div class="gdt-resize-handle" data-col-key="${esc(c.key)}" title="Потяните чтобы изменить ширину"></div>
        </div>`;
      }).join('');
    const header = `<div class="gantt-header gdt-header gdt-grid-row" style="display:grid;grid-template-columns:${gt}">${headerCols}</div>`;
    const legend = `<div class="gantt-legend">
      ${[['#6b7280','Бэклог'],['#4f46e5','1.20'],['#059669','1.21'],['#d97706','1.22'],['#dc2626','OT']].map(([c,l])=>`<div class="gantt-legend-item"><div class="gantt-legend-dot" style="background:${c}"></div>${l}</div>`).join('')}
    </div>`;

    wrap.innerHTML = `<div class="gantt-container gdt-container">${header}<div class="gantt-body">${body}</div>${legend}</div>`;
    // #2: do NOT force overflow:visible — that killed the horizontal scrollbar
    //   on #gantt-wrap (defined as overflow-x:auto in styles.css). Let CSS win.
    wrap.style.overflow = '';
    // #7: restore the scroll position captured by renderChart() before
    //   re-rendering. Prevents the page jumping to the top + smooth-scroll
    //   "дёргание" effect after every pill action (move / delete / drag-drop /
    //   undo / redo / backlog "+").
    //
    //   Two non-obvious requirements:
    //   (a) `html { scroll-behavior: smooth }` is set globally in styles.css.
    //       `window.scrollTo({top, behavior:'instant'})` is honoured only in
    //       very recent browsers — older Safari treats `'instant'` as `'auto'`,
    //       which then falls back to the CSS smooth → user sees the page
    //       smoothly scrolling away from the row they just edited. Use the
    //       LEGACY 2-arg form `window.scrollTo(x, y)` — it's defined to be
    //       instant regardless of CSS.
    //   (b) After `wrap.innerHTML = ...` the new DOM hasn't been laid out yet,
    //       so the document height is briefly the OLD value (or 0 between
    //       innerHTML write and paint). A synchronous `scrollTo(savedY)` may
    //       be silently clamped if savedY > current document height. Defer
    //       the restore to the next animation frame, when layout is settled.
    if (typeof GanttView._pendingScrollX === 'number') {
      const savedX        = GanttView._pendingScrollX;
      const savedWrapY    = GanttView._pendingScrollY;
      const savedContY    = GanttView._pendingContainerY;
      const savedDocY     = GanttView._pendingDocY;
      GanttView._pendingScrollX = GanttView._pendingScrollY =
        GanttView._pendingContainerY = GanttView._pendingDocY = null;

      const applyScrolls = () => {
        wrap.scrollLeft = savedX;
        if (savedWrapY) wrap.scrollTop = savedWrapY;
        const cont = wrap.querySelector('.gantt-container');
        if (cont && savedContY) cont.scrollTop = savedContY;
        if (typeof savedDocY === 'number') {
          // Legacy form bypasses `scroll-behavior: smooth` from CSS.
          window.scrollTo(0, savedDocY);
        }
      };
      // Apply immediately (covers the common case where layout is already
      // available because the new DOM is similar in size to the old one) AND
      // again on the next frame (covers the edge case where layout hasn't
      // settled and the first call was clamped). Idempotent, costs nothing.
      applyScrolls();
      requestAnimationFrame(applyScrolls);
    }
    // Tell App's reactive auto-flush: we just painted, skip the upcoming
    // ~100 ms-delayed re-render. Without this, the second render would
    // wipe out the scroll restoration above and the user would see the
    // Gantt blink + jump to top after every drag/delete.
    try { window.App?.markRenderedNow?.(); } catch(_) {}

    /* update expand/collapse-all button icon */
    const ecBtn = document.getElementById('btn-gantt-expand-all');
    if (ecBtn) {
      const anyVisible = teams.some(t => !GanttView._dtHiddenTeams?.has(teamKey(t)));
      ecBtn.textContent = anyVisible ? '⊟' : '⊞';
      ecBtn.title       = anyVisible ? 'Свернуть все команды' : 'Развернуть все команды';
    }

    /* ---- helper: update all grid rows to new column widths ---- */
    const updateAllGrids = () => {
      const newGT = makeGT();
      wrap.querySelectorAll('.gdt-grid-row').forEach(el => { el.style.gridTemplateColumns = newGT; });
    };

    /* ---- team visibility toggle — use style.display to override inline display:grid ---- */
    wrap.querySelectorAll('.gantt-team-vis-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const tk2 = btn.dataset.teamKey;
        const nowHidden = !GanttView._dtHiddenTeams.has(tk2);
        if (nowHidden) GanttView._dtHiddenTeams.add(tk2);
        else           GanttView._dtHiddenTeams.delete(tk2);
        wrap.querySelectorAll('.gantt-row').forEach(rowEl => {
          if (rowEl.dataset.teamKey === tk2) rowEl.style.display = nowHidden ? 'none' : 'grid';
        });
        btn.textContent = nowHidden ? '▸' : '▾';
      });
    });

    /* V17.1 C13 — «+» в строке команды → модалка нового эпика. */
    wrap.querySelectorAll('.gdt-team-add-epic').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const teamName = btn.dataset.team || '';
        GanttView._openAddEpicModal(teamName);
      });
    });

    /* V16 roadmap-2 (A4) — Overview row click → switch to default mode +
       jump to that team. Bound only in overview mode; expand-to-detail is
       the one and only action of an overview row. */
    if (_isOverview) {
      wrap.querySelectorAll('.gdt-overview-row').forEach(rowEl => {
        rowEl.addEventListener('click', () => {
          const tk2 = rowEl.dataset.teamKey;
          GanttView._dtMode = 'default';
          document.body.dataset.gdtMode = 'default';
          try { localStorage.setItem('q2_gantt_mode_v16', 'default'); } catch (_) {}
          GanttView.renderChart();
          requestAnimationFrame(() => {
            const target = document.querySelector(`.gantt-team-header[data-team-key="${tk2 ? (window.CSS?.escape ? CSS.escape(tk2) : tk2) : ''}"]`);
            if (target?.scrollIntoView) {
              target.scrollIntoView({ behavior: 'smooth', block: 'center' });
              target.classList.add('gdt-jump-pulse');
              setTimeout(() => target.classList.remove('gdt-jump-pulse'), 1400);
            }
          });
        });
      });
    }

    /* Per-pill DnD setup — fills dataTransfer for the per-cell drop handler.
       NOTE: no `e.stopPropagation()` here. The wrap-level dragstart listener
       must also see this event so it can populate `_dragData`, which the
       wrap-level intra-cell pill→pill reorder relies on. */
    wrap.querySelectorAll('.gantt-type-pill[draggable]').forEach(pill => {
      pill.addEventListener('dragstart', e => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('rowId',  pill.dataset.rowId);
        e.dataTransfer.setData('srcCol', pill.dataset.srcCol);
        e.dataTransfer.setData('wt',     pill.dataset.wt);
        pill.style.opacity = '.4';
      });
      pill.addEventListener('dragend', () => { pill.style.opacity = ''; });
    });
    // Per-cell DnD: works because the per-pill dragstart above sets dataTransfer
    // entries (rowId, srcCol, wt). On drop, route through moveWtBetweenCols so
    // the source cell keeps a ghost trail (#8) — including a timestamped arrow
    // in row.ganttArrows that drawPostponeArrows uses to render the connector.
    wrap.querySelectorAll('.gantt-cell[data-col]').forEach(cell => {
      cell.addEventListener('dragover',  e => { e.preventDefault(); cell.classList.add('gantt-cell-dragover'); });
      cell.addEventListener('dragleave', ()  => cell.classList.remove('gantt-cell-dragover'));
      cell.addEventListener('drop', async e => {
        e.preventDefault();
        cell.classList.remove('gantt-cell-dragover');
        const rowId  = e.dataTransfer.getData('rowId');
        const srcCol = e.dataTransfer.getData('srcCol');
        const wt     = e.dataTransfer.getData('wt');
        const dstCol = cell.dataset.col;
        if (!rowId || !wt) return;
        // V16 roadmap-2 (B7) — explicit feedback instead of silent no-op.
        if (cell.dataset.rowId && cell.dataset.rowId !== rowId) {
          window.showToast?.('Нельзя переносить задачу между разными эпиками', 'warning', 2400);
          return;
        }
        if (srcCol === dstCol) {
          window.showToast?.('Задача уже в этом колодце', 'info', 1400);
          return;
        }
        // V15 (audit#1, QA Critical 4): drop fired AFTER user navigated
        // away — guard so we don't mutate state behind an invisible UI.
        if (state.activeSection && state.activeSection !== 'gantt') return;
        const row = state.rows.find(r => r.id === rowId);
        if (!row) return;
        // V14 (B5): if the plan is locked AND edit mode is off, prompt for
        // a mandatory comment via App.requireMoveComment(). Empty/cancelled
        // → abort the move (no state change). Comment is appended to
        // row.transferComments[] inside moveWtBetweenCols.
        let moveComment = '';
        try {
          const res = await window.App?.requireMoveComment?.({
            rowKey: (row.epic || row.tasks || '(без эпика)'),
            srcCol: COL_LABEL[srcCol], dstCol: COL_LABEL[dstCol], wt,
          });
          if (res === null) {
            // V15 (audit#1, QA H2): explicit feedback so user knows it was cancelled.
            window.showToast?.('Перенос отменён', 'info', 1500);
            return;
          }
          moveComment = res || '';
        } catch (e2) {
          // V15 (audit#1, QA H3): don't fall through silently — that defeats
          // the V14 (B5) plan-lock contract. Surface + abort.
          window.showToast?.('Не удалось показать диалог комментария — перенос отменён', 'error', 3000);
          try { window.ErrorsLog?.add?.({ level:'error', source:'GanttView.drop', message:'requireMoveComment threw', stack: e2?.stack || String(e2) }); } catch(_){}
          return;
        }
        // V15 (audit#1, fullstack Critical 4): re-resolve row by id after
        // await — state.rows could have been replaced by a CSV import while
        // the modal was open, leaving the captured `row` orphaned.
        const fresh = state.rows.find(r => r.id === rowId);
        if (!fresh) {
          window.showToast?.('Задача больше не существует — перенос отменён', 'warning', 2400);
          return;
        }
        window.HistoryManager?.checkpoint(`перенести ${wt}: ${COL_LABEL[srcCol]} → ${COL_LABEL[dstCol]}`);
        moveWtBetweenCols(fresh, wt, srcCol, dstCol, { comment: moveComment });
        GanttView.renderChart();
      });
    });

    /* ---- backlog "+" picker ---- */
    const removeAddPicker = () => document.getElementById('gdt-add-picker')?.remove();
    wrap.querySelectorAll('.gdt-add-type-btn').forEach(plusBtn => {
      plusBtn.addEventListener('click', e => {
        e.stopPropagation();
        removeAddPicker();
        const rowId = plusBtn.dataset.rowId;
        const row   = state.rows.find(r => r.id === rowId);
        if (!row) return;

        /* collect all unique types from the whole dataset (do not filter by what's already in this row) */
        const allDataTypes = new Set(WORK_TYPES);
        state.rows.forEach(r => {
          (r.release120Types||[]).forEach(t=>allDataTypes.add(t));
          (r.release121Types||[]).forEach(t=>allDataTypes.add(t));
          (r.release122Types||[]).forEach(t=>allDataTypes.add(t));
          (r.overtimeTypes||[]).forEach(t=>allDataTypes.add(t));
          (r.backlogTypes||[]).forEach(t=>allDataTypes.add(t));
        });

        /* mark already-added types but show ALL */
        const inWells = new Set([
          ...(row.release120Types||[]),
          ...(row.release121Types||[]),
          ...(row.release122Types||[]),
          ...(row.overtimeTypes||[]),
          ...(row.backlogTypes||[]),
        ]);
        const available = [...allDataTypes].filter(Boolean).sort((a,b)=>a.localeCompare(b,'ru'));

        if (!available.length) {
          window.showToast?.('В системе нет типов задач', 'info', 1800);
          return;
        }

        const picker = document.createElement('div');
        picker.id = 'gdt-add-picker';
        picker.className = 'gdt-add-picker';
        const rect = plusBtn.getBoundingClientRect();
        const px = Math.min(rect.left, window.innerWidth  - 220);
        const py = Math.min(rect.bottom + 4, window.innerHeight - 260);
        picker.style.cssText = `position:fixed;top:${py}px;left:${px}px;z-index:9999`;
        picker.innerHTML = `
          <div class="gdt-add-picker-title">Выберите тип задачи</div>
          <div class="gdt-add-picker-list">
            ${available.map(t => {
              const already = inWells.has(t);
              return `<label class="gdt-add-picker-item${already?' gdt-add-picker-item-used':''}" title="${already?'Этот тип уже есть в строке — можно добавить ещё раз':''}">
                <input type="checkbox" value="${esc(t)}">
                ${wtEmoji(t)} ${esc(t)}${already?' <span class="gdt-add-picker-used-badge">уже добавлен</span>':''}
              </label>`;
            }).join('')}
          </div>
          <div class="gdt-add-picker-footer">
            <button class="btn btn-sm btn-primary gdt-add-picker-ok">Добавить</button>
            <button class="btn btn-sm btn-outline gdt-add-picker-cancel">Отмена</button>
          </div>`;
        document.body.appendChild(picker);

        picker.querySelector('.gdt-add-picker-ok').addEventListener('click', async () => {
          const selected = [...picker.querySelectorAll('input:checked')].map(cb => cb.value);
          if (!selected.length) { removeAddPicker(); return; }
          removeAddPicker();
          // V14 (B8): after the user picks types, ask which bucket and a
          // mandatory comment. Both default-flow (no plan-lock) and
          // plan-locked flow share this single modal — the comment is
          // ALWAYS required for a bulk-add since adding work mid-plan is
          // a tracked decision.
          const summary = `${(row.epic || row.tasks || '(без эпика)')}: добавить ${selected.length} тип(ов): ${selected.slice(0,3).join(', ')}${selected.length>3?'…':''}`;
          const choice = await window.App?.openGanttAddTargetModal?.({ summary });
          if (!choice) return;     // cancelled
          const { bucket, comment } = choice;
          window.HistoryManager?.checkpoint(`добавить ${selected.length} тип(ов) в ${COL_LABEL[bucket] || bucket}`);
          const dstField = colKeyMap[bucket];
          if (dstField) {
            if (!Array.isArray(row[dstField])) row[dstField] = [];
            selected.forEach(t => { if (!row[dstField].includes(t)) row[dstField].push(t); });
          }
          // V14 (B5/B8): record the action in transferComments so the trail
          // is uniform regardless of how a pill landed in a bucket.
          const at = new Date().toISOString();
          if (!Array.isArray(row.transferComments)) row.transferComments = [];
          selected.forEach(t => {
            row.transferComments.push({ at, wt: t, from: '+', to: bucket, text: comment });
          });
          row.dirty = true;
          row.updatedAt = at;
          RowFactory.updateDerived(row);
          Storage.save();
          GanttView.renderChart();
          window.showToast?.(`Добавлено ${selected.length} в ${COL_LABEL[bucket] || bucket}`, 'success', 1800);
          try { window.HistoryLog?.gantt?.('bulk_add', `Добавлено ${selected.length} в ${COL_LABEL[bucket] || bucket}`, { rowId: row.id, bucket, types: selected, comment }); } catch(_) {}
        });
        picker.querySelector('.gdt-add-picker-cancel').addEventListener('click', removeAddPicker);

        const onOutside = ev => {
          if (!picker.contains(ev.target) && ev.target !== plusBtn) {
            removeAddPicker();
            document.removeEventListener('click', onOutside, true);
          }
        };
        setTimeout(() => document.addEventListener('click', onOutside, true), 0);
      });
    });

    /* ---- Fix 1.7 + label column: resize handles ---- */
    wrap.querySelectorAll('.gdt-resize-handle').forEach(handle => {
      handle.addEventListener('mousedown', e => {
        e.preventDefault();
        const colKey  = handle.dataset.colKey;
        const isLabel = colKey === '_label';
        const startX  = e.clientX;
        const startW  = isLabel ? getLW() : getW(colKey);
        const minW    = isLabel ? 140 : 80;
        const maxW    = isLabel ? 600 : 600;
        document.body.style.cursor = 'col-resize';
        // V17.1.2 — стрелки переносов рисуются по pixel-координатам через
        //   getBoundingClientRect (см. drawPostponeArrows). При resize колодца
        //   updateAllGrids меняет grid-template-columns, но SVG-стрелки
        //   остаются на старых координатах. RAF на каждом mousemove дёшево
        //   и даёт live-перерисовку без рывков; на mouseup делаем финальный
        //   draw чтобы гарантировать точное попадание после release.
        let _arrowsRaf = 0;
        const redrawArrows = () => {
          cancelAnimationFrame(_arrowsRaf);
          _arrowsRaf = requestAnimationFrame(() => {
            try { GanttView.drawPostponeArrows(wrap); } catch(_) {}
          });
        };
        const onMove = ev => {
          const newW = Math.max(minW, Math.min(maxW, startW + ev.clientX - startX));
          GanttView._dtColWidths[colKey] = newW;
          updateAllGrids();
          redrawArrows();
        };
        const onUp = () => {
          document.body.style.cursor = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
          // финальная синхронизация уже после того как браузер пересчитал layout
          requestAnimationFrame(() => requestAnimationFrame(() => {
            try { GanttView.drawPostponeArrows(wrap); } catch(_) {}
          }));
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
      });
    });

    /* ---- context menu: per-pill done + перенос в след релиз ---- */
    const NEXT_RELEASE  = { backlog:'r120', r120:'r121', r121:'r122', r122:'overtime' };
    const COL_LABEL     = { backlog:'Бэклог', r120:'1.20', r121:'1.21', r122:'1.22', overtime:'OT' };

    const removeCtxMenu = () => document.getElementById('gdt-ctx-menu')?.remove();
    wrap.addEventListener('contextmenu', e => {
      const pill = e.target.closest('.gantt-type-pill[data-wt][data-row-id]');
      if (!pill) return;
      e.preventDefault();
      removeCtxMenu();
      const rowId  = pill.dataset.rowId;
      const wt     = pill.dataset.wt;
      const srcCol = pill.dataset.srcCol;
      if (!rowId || !wt || wt === 'задача') return;
      const row = state.rows.find(r => r.id === rowId);
      if (!row) return;
      // V15 Spine 2026-04-30 — DO NOT initialize per-pill maps here.
      // The ctx-menu open path was previously assigning `row.donePills = {}`
      // / `row.unplannedPills = {}` / `row.ganttArrows = []` on every right-
      // click, even when fields were already present. Through the Reactive
      // proxy these `set` ops fire observers → Storage.save → renderChart →
      // user perceives the gantt «дёргается» on every right-click. Read
      // through local fallbacks; the action handlers that actually mutate
      // (done / unplan / move / etc.) already lazy-init these fields.
      const donePills       = row.donePills       || {};
      const unplannedPills  = row.unplannedPills  || {};
      const inProgressPills = row.inProgressPills || {};
      const ganttArrows     = row.ganttArrows     || [];

      const doneKey       = `${srcCol}__${wt}`;
      const isDone        = !!donePills[doneKey];
      const isUnplanned   = !!unplannedPills[doneKey];   // same key shape
      const isInProgress  = !!inProgressPills[doneKey];  // V15 — new state
      const isGhost = pill.classList.contains('gantt-pill-ghost');
      const label   = Utils.escapeHtml(Utils.truncate(wt, 18));
      const nextCol = NEXT_RELEASE[srcCol];
      const nextLabel = nextCol ? COL_LABEL[nextCol] : null;

      // Index of this wt within its current column array (for reorder)
      const fieldKey = colKeyMap[srcCol];
      const arr = (fieldKey && Array.isArray(row[fieldKey])) ? row[fieldKey] : [];
      const idxInCol = arr.indexOf(wt);
      const canLeft  = !isGhost && idxInCol > 0;
      const canRight = !isGhost && idxInCol >= 0 && idxInCol < arr.length - 1;

      // #6: pill is "the destination of a recorded move" → show "Вернуть обратно".
      const moveTrail   = (row.ganttArrows || []).find(a => !isGhost && a.dstCol === srcCol && a.wt === wt);
      const isMoveTarget = !!moveTrail;
      const moveSrcLabel = moveTrail ? (COL_LABEL[moveTrail.srcCol] || moveTrail.srcCol) : null;

      const menu = document.createElement('div');
      menu.id = 'gdt-ctx-menu';
      menu.className = 'gdt-ctx-menu';
      // V15 Spine 2026-04-30 — provisional position; the real bounds-fix
      // happens AFTER innerHTML+append, when we know the actual menu size.
      // The hardcoded `-240` reserve was wrong: we added new items («▶ В
      // работе»), and locked-plan + move-target rows can grow even taller,
      // so the bottom of the menu was clipping out of the viewport.
      menu.style.cssText = `position:fixed;top:${e.clientY}px;left:${e.clientX}px;z-index:9999;visibility:hidden`;
      // V15 Spine 2026-04-30 — «Rail / Command Rail» concept (art director +
      // designer review). Sub-headers СТАТУС/ПОЛОЖЕНИЕ/ПАРАМЕТРЫ instead of
      // dividers · stroked-glyph in the right-aligned column instead of
      // emoji prefixes · `data-active` on toggle items paints accent-text +
      // filled dot · destructive items live in their own tinted zone at
      // the bottom · bucket names rendered as mono-chip pills.
      const _bucketChip = (s) => `<span class="gdt-ctx-bucket-chip">${Utils.escapeHtml(s)}</span>`;
      const _row = (cls, action, body, glyph = '') =>
        `<div class="gdt-ctx-item${cls ? ' ' + cls : ''}" data-action="${action}">
          <span class="gdt-ctx-text">${body}</span>
          ${glyph ? `<span class="gdt-ctx-glyph">${glyph}</span>` : ''}
        </div>`;
      const _toggle = (action, isActive, body) =>
        `<div class="gdt-ctx-item gdt-ctx-state-toggle${isActive ? ' is-active' : ''}" data-action="${action}">
          <span class="gdt-ctx-dot"></span>
          <span class="gdt-ctx-text">${body}</span>
        </div>`;

      // Inline values for ПАРАМЕТРЫ — show actual data when set, fall back
      // to the action-name placeholder when empty (designer suggestion).
      const _assigneesForPill = (() => {
        const ap = row.assigneePills && typeof row.assigneePills === 'object' ? row.assigneePills : {};
        const perPill = typeof ap[doneKey] === 'string' && ap[doneKey].trim() ? ap[doneKey] : '';
        const fallback = String(row.assignee || '').trim();
        return perPill || fallback;
      })();
      const _datesLabel = (row.workStartDate && row.workEndDate)
        ? `${Utils.escapeHtml(row.workStartDate)} → ${Utils.escapeHtml(row.workEndDate)}`
        : '';

      menu.innerHTML = isGhost
        ? `
          <div class="gdt-ctx-title">${label} <span class="gdt-ctx-title-meta">след переноса</span></div>
          <div class="gdt-ctx-section gdt-ctx-section-danger">
            ${_row('gdt-ctx-item-danger', 'undo-move', 'Убрать след переноса', '✕')}
          </div>
        `
        : `
          <div class="gdt-ctx-title">${label}${isMoveTarget ? ` <span class="gdt-ctx-title-meta">перенесено из ${_bucketChip(moveSrcLabel)}</span>` : ''}</div>

          <div class="gdt-ctx-section">
            <div class="gdt-ctx-section-head">Статус</div>
            ${_toggle(isDone ? 'undone' : 'done', isDone, isDone ? 'Завершена' : 'Завершить')}
            ${(isDone || isUnplanned)
              ? ''
              : _toggle(isInProgress ? 'stop-work' : 'start-work', isInProgress, isInProgress ? 'В работе' : 'Взять в работу')}
            ${_toggle(isUnplanned ? 'plan' : 'unplan', isUnplanned, isUnplanned ? 'Не запланирована' : 'Снять с плана')}
          </div>

          <div class="gdt-ctx-section">
            <div class="gdt-ctx-section-head">Положение</div>
            ${isMoveTarget ? _row('', 'revert-move', `Вернуть в ${_bucketChip(moveSrcLabel)}`, '↩') : ''}
            ${nextLabel
              ? _row('', 'move-next', `Перенести в ${_bucketChip(nextLabel)}`, '⇥')
              : _row('gdt-ctx-item-disabled', '', 'Последний релиз', '⇥')}
            ${_row(canLeft  ? '' : 'gdt-ctx-item-disabled', 'move-left',  'Сдвинуть влево',  '←')}
            ${_row(canRight ? '' : 'gdt-ctx-item-disabled', 'move-right', 'Сдвинуть вправо', '→')}
          </div>

          <div class="gdt-ctx-section">
            <div class="gdt-ctx-section-head">Параметры</div>
            ${_row('', 'assign',
              _assigneesForPill ? `<span class="gdt-ctx-value">${Utils.escapeHtml(_assigneesForPill)}</span>` : 'Назначить исполнителя',
              _assigneesForPill ? '✎' : '+')}
            ${/* V17.1 C7 — «Снять исполнителя» появляется только когда у пилюли
                 уже назначен исполнитель. Удаляет назначение через тот же
                 mechanism что 'assign' (через empty value). */ ''}
            ${_assigneesForPill ? _row('gdt-ctx-item-subtle', 'unassign', 'Снять назначение', '✕') : ''}
            ${_row('', 'set-dates',
              _datesLabel ? `<span class="gdt-ctx-value">${_datesLabel}</span>` : 'Установить даты работ',
              _datesLabel ? '✎' : '+')}
          </div>

          <div class="gdt-ctx-section gdt-ctx-section-danger">
            ${_row('gdt-ctx-item-danger', 'delete', 'Удалить из колодца', '⌫')}
          </div>
        `;
      document.body.appendChild(menu);

      // Now that the menu is in the DOM, measure it and clamp to viewport.
      // 8 px breathing-room from each viewport edge. If the menu would
      // hang off the BOTTOM, flip it ABOVE the cursor instead of just
      // sliding up — flipping feels more natural and keeps the cursor
      // anchored to the menu, which matters for rapid-fire ctx actions.
      {
        const PAD = 8;
        const mr = menu.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let left = e.clientX;
        let top  = e.clientY;
        if (left + mr.width  + PAD > vw) left = Math.max(PAD, vw - mr.width  - PAD);
        if (top  + mr.height + PAD > vh) {
          // Try flipping above the cursor first; if still doesn't fit, clamp.
          const flipped = e.clientY - mr.height;
          top = flipped >= PAD ? flipped : Math.max(PAD, vh - mr.height - PAD);
        }
        menu.style.left = left + 'px';
        menu.style.top  = top  + 'px';
        menu.style.visibility = 'visible';
      }

      menu.addEventListener('click', ev => {
        const action = ev.target.closest('[data-action]')?.dataset.action;
        if (!action) return;

        if (action === 'undone') {
          window.HistoryManager?.checkpoint(`вернуть ${wt}`);
          if (row.donePills) delete row.donePills[doneKey];
          row.dirty = true;
          Storage.save();
          removeCtxMenu();
          GanttView.renderChart();
          return;
        }
        // V15 (1.1) — toggle «Не запланирована» flag per-pill.
        if (action === 'unplan' || action === 'plan') {
          window.HistoryManager?.checkpoint(action === 'unplan' ? `снять с плана ${wt}` : `вернуть в план ${wt}`);
          if (!row.unplannedPills) row.unplannedPills = {};
          if (action === 'unplan') row.unplannedPills[doneKey] = { at: new Date().toISOString() };
          else                     delete row.unplannedPills[doneKey];
          row.dirty = true;
          row.updatedAt = new Date().toISOString();
          Storage.save();
          removeCtxMenu();
          GanttView.renderChart();
          try { window.HistoryLog?.gantt?.(action, `${wt} (${COL_LABEL[srcCol]})`, { wt, srcCol }); } catch(_) {}
          return;
        }
        // V15 Spine 2026-04-30 — «To Do ↔ В работе» toggle. Pills are
        // born as «To Do» (no entry in `inProgressPills`); the user flips
        // them to «В работе» explicitly. Mirrors the unplan/plan pair so
        // history-log + checkpoint stay symmetrical.
        if (action === 'start-work' || action === 'stop-work') {
          window.HistoryManager?.checkpoint(action === 'start-work' ? `в работу: ${wt}` : `вернуть в to do: ${wt}`);
          if (!row.inProgressPills) row.inProgressPills = {};
          if (action === 'start-work') row.inProgressPills[doneKey] = { at: new Date().toISOString() };
          else                          delete row.inProgressPills[doneKey];
          row.dirty = true;
          row.updatedAt = new Date().toISOString();
          Storage.save();
          removeCtxMenu();
          GanttView.renderChart();
          try { window.HistoryLog?.gantt?.(action, `${wt} (${COL_LABEL[srcCol]})`, { wt, srcCol }); } catch(_) {}
          return;
        }
        if (action === 'done') {
          // V14 (B7): «Завершить» now requires the user to specify the
          // factual completion date and lets them attach an optional
          // comment. donePills[k] becomes an OBJECT {at,comment,ts}
          // (was a bare `true`) — renderer still treats truthy as done so
          // existing data round-trips. row.actualDoneDate / row.doneComment
          // mirror the latest pill-completion for spreadsheet-style access.
          removeCtxMenu();
          (async () => {
            const result = await window.App?.openGanttCompleteModal?.({
              summary: `${(row.epic || row.tasks || '(без эпика)')} · ${wt} · ${COL_LABEL[srcCol]}`,
            });
            if (!result) return;     // cancelled
            window.HistoryManager?.checkpoint(`завершить ${wt}`);
            if (!row.donePills) row.donePills = {};
            row.donePills[doneKey] = { at: result.date, comment: result.comment, ts: new Date().toISOString() };
            row.actualDoneDate = result.date;
            row.doneComment    = result.comment;
            row.dirty = true;
            row.updatedAt = new Date().toISOString();
            Storage.save();
            GanttView.renderChart();
            try { window.HistoryLog?.gantt?.('complete_pill', `Завершено ${wt} (${COL_LABEL[srcCol]}) на ${result.date}`, { wt, srcCol, date: result.date, comment: result.comment }); } catch(_) {}
          })();
          return;
        }

        if (action === 'set-dates') {
          // V14 (B6.2): row-level work-period override.
          removeCtxMenu();
          (async () => {
            const result = await window.App?.openGanttDatesModal?.({
              summary: `${(row.epic || row.tasks || '(без эпика)')} · ${wt}`,
              start: row.workStartDate || '',
              end:   row.workEndDate   || '',
            });
            if (!result) return;
            window.HistoryManager?.checkpoint(`установить даты работ`);
            row.workStartDate = result.start;
            row.workEndDate   = result.end;
            row.dirty = true;
            row.updatedAt = new Date().toISOString();
            RowFactory.updateDerived(row);
            Storage.save();
            GanttView.renderChart();
            try { window.HistoryLog?.gantt?.('set_dates', `${result.start || '—'} → ${result.end || '—'}`, { rowId: row.id, ...result }); } catch(_) {}
          })();
          return;
        }

        if (action === 'assign') {
          // V15 Spine redesign 2026-04-30 — assignment is now PER-PILL, not
          // per-row. Old V14 behaviour silently broadcast «Иванов» to every
          // pill of the row across all colodets; user flagged this as a bug.
          // We now write to row.assigneePills[`${srcCol}__${wt}`]. Renderer
          // reads per-pill first → falls back to row.assignee for legacy rows.
          removeCtxMenu();
          (async () => {
            const taskTags = String(row.tags || '').split(/[|,]/).map(s=>s.trim()).filter(Boolean);
            const result = await window.App?.openGanttAssignModal?.({
              summary: `${(row.epic || row.tasks || '(без эпика)')} · ${wt} · ${COL_LABEL[srcCol]}`,
              taskTags,
              requireOtDays: srcCol === 'overtime',
            });
            if (!result) return;
            window.HistoryManager?.checkpoint(`назначить ${result.fio || 'исполнителя'} на ${wt}`);
            if (!row.assigneePills || typeof row.assigneePills !== 'object') row.assigneePills = {};
            row.assigneePills[`${srcCol}__${wt}`] = result.fio;
            row.assignedAt = new Date().toISOString();
            row.dirty = true;
            row.updatedAt = row.assignedAt;
            RowFactory.updateDerived(row);
            Storage.save();
            window.App?.populateFilterDropdowns?.();
            GanttView.renderChart();
            window.showToast?.(`Назначен ${result.fio} на «${wt}»`,'success',1800);
            try { window.HistoryLog?.gantt?.('assign_pill', `Назначен ${result.fio} на ${wt} в ${srcCol}`, { rowId: row.id, empId: result.id, fio: result.fio, col: srcCol, wt }); } catch(_) {}
          })();
          return;
        }

        // V17.1 C7 — снять назначение с пилюли. Удаляет ключ из
        // row.assigneePills (и пишет '' в legacy row.assignee если pills нет).
        if (action === 'unassign') {
          const pillKey = `${srcCol}__${wt}`;
          window.HistoryManager?.checkpoint(`снять назначение на ${wt}`);
          if (row.assigneePills && typeof row.assigneePills === 'object' && row.assigneePills[pillKey]) {
            const prev = row.assigneePills[pillKey];
            delete row.assigneePills[pillKey];
            row.dirty = true; row.updatedAt = new Date().toISOString();
            RowFactory.updateDerived(row);
            Storage.save();
            removeCtxMenu();
            GanttView.renderChart();
            window.showToast?.(`Снят ${prev} с «${wt}»`, 'info', 1800);
            try { window.HistoryLog?.gantt?.('unassign_pill', `Снят ${prev} с ${wt} в ${srcCol}`, { rowId: row.id, fio: prev, col: srcCol, wt }); } catch(_) {}
          } else {
            // legacy: row.assignee на всю строку — обнуляем только если
            // других пилюль с этим же исполнителем нет (защита от случайного
            // массового снятия).
            row.assignee = '';
            row.dirty = true; row.updatedAt = new Date().toISOString();
            RowFactory.updateDerived(row);
            Storage.save();
            removeCtxMenu();
            GanttView.renderChart();
            window.showToast?.('Назначение снято', 'info', 1600);
          }
          return;
        }

        if (action === 'delete') {
          window.HistoryManager?.checkpoint(`удалить ${wt} из ${COL_LABEL[srcCol]}`);
          if (fieldKey && Array.isArray(row[fieldKey])) {
            row[fieldKey] = row[fieldKey].filter(t => t !== wt);
          }
          // Also drop any "done"-flag and any arrow trail tied to this wt
          if (row.donePills) delete row.donePills[doneKey];
          // V17 P2 (CRIT-4): scope the arrow-trail purge to arrows that
          // ENTERED OR LEFT the source colodet. Earlier `a.wt !== wt` was
          // too wide: deleting `backend` in r122 wiped trails of `backend`
          // in r120↔r121 too. Audit 2026-05 (QA, B2).
          if (Array.isArray(row.ganttArrows)) {
            row.ganttArrows = row.ganttArrows.filter(
              a => !(a.wt === wt && (a.srcCol === srcCol || a.dstCol === srcCol))
            );
          }
          row.dirty = true; row.updatedAt = new Date().toISOString();
          RowFactory.updateDerived(row);
          Storage.save();
          removeCtxMenu();
          GanttView.renderChart();
          window.showToast?.(`«${Utils.truncate(wt, 20)}» удалена из ${COL_LABEL[srcCol]}`, 'info', 1800);
          return;
        }

        if (action === 'undo-move') {
          // V15 (audit#1, system H7): checkpoint so the «убрать след
          // переноса» action is reversible like all other gantt mutations.
          window.HistoryManager?.checkpoint('убрать след переноса');
          if (Array.isArray(row.ganttArrows)) {
            row.ganttArrows = row.ganttArrows.filter(a => !(a.wt === wt && a.srcCol === srcCol));
          }
          row.dirty = true;
          Storage.save();
          removeCtxMenu();
          GanttView.renderChart();
          return;
        }

        if (action === 'move-left' || action === 'move-right') {
          if (!fieldKey || idxInCol < 0) { removeCtxMenu(); return; }
          const targetIdx = action === 'move-left' ? idxInCol - 1 : idxInCol + 1;
          if (targetIdx < 0 || targetIdx >= arr.length) { removeCtxMenu(); return; }
          window.HistoryManager?.checkpoint(`переставить ${wt}`);
          [arr[idxInCol], arr[targetIdx]] = [arr[targetIdx], arr[idxInCol]];
          row[fieldKey] = arr;
          row.dirty = true;
          Storage.save();
          removeCtxMenu();
          GanttView.renderChart();
          return;
        }

        if (action === 'move-next' && nextCol) {
          // V15 (Spine 2026-04-30): the ctx-menu «перенести в …» action
          // previously skipped the V14 (B5) plan-lock comment prompt —
          // only drag-and-drop honored it. User flagged the inconsistency:
          // a move that asks for a comment on drag must also ask on click.
          // We now route through the same `App.requireMoveComment()` flow.
          // When unlocked / edit-mode-on, the helper resolves with `''`
          // immediately (no modal) — keeps the unlocked path zero-friction.
          removeCtxMenu();
          (async () => {
            let moveComment = '';
            try {
              const res = await window.App?.requireMoveComment?.({
                rowKey: (row.epic || row.tasks || '(без эпика)'),
                srcCol: COL_LABEL[srcCol], dstCol: COL_LABEL[nextCol], wt,
              });
              if (res === null) {
                window.showToast?.('Перенос отменён', 'info', 1500);
                return;
              }
              moveComment = res || '';
            } catch (e2) {
              window.showToast?.('Не удалось показать диалог комментария — перенос отменён', 'error', 3000);
              try { window.ErrorsLog?.add?.({ level:'error', source:'GanttView.move-next', message:'requireMoveComment threw', stack: e2?.stack || String(e2) }); } catch(_){}
              return;
            }
            // Re-resolve row by id after await — state.rows could have been
            // replaced by a CSV/JSON import while the modal was open.
            const fresh = state.rows.find(r => r.id === row.id);
            if (!fresh) {
              window.showToast?.('Задача больше не существует — перенос отменён', 'warning', 2400);
              return;
            }
            window.HistoryManager?.checkpoint(`перенести ${wt}: ${COL_LABEL[srcCol]} → ${COL_LABEL[nextCol]}`);

            // ── Visual flight animation ──────────────────────────
            const srcCell = wrap.querySelector(`.gantt-cell[data-col="${srcCol}"][data-row-id="${fresh.id}"]`);
            const dstCell = wrap.querySelector(`.gantt-cell[data-col="${nextCol}"][data-row-id="${fresh.id}"]`);
            const srcPill = pill;
            if (srcCell && dstCell && srcPill && srcPill.isConnected) {
              const startRect = srcPill.getBoundingClientRect();
              const endRect   = dstCell.getBoundingClientRect();
              const ghost = srcPill.cloneNode(true);
              ghost.classList.add('gantt-pill-flying');
              ghost.style.cssText = `
                position:fixed;left:${startRect.left}px;top:${startRect.top}px;
                width:${startRect.width}px;height:${startRect.height}px;
                z-index:10000;pointer-events:none;
                transition:transform .65s cubic-bezier(.45,.05,.25,1.6), opacity .55s .15s ease-out, box-shadow .25s ease-out;
                box-shadow:0 4px 16px rgba(0,0,0,.25);
              `;
              document.body.appendChild(ghost);
              requestAnimationFrame(() => {
                const dx = endRect.left + endRect.width/2  - (startRect.left + startRect.width/2);
                const dy = endRect.top  + endRect.height/2 - (startRect.top  + startRect.height/2);
                ghost.style.transform = `translate(${dx}px, ${dy}px) scale(1.15)`;
                ghost.style.boxShadow = '0 8px 24px rgba(79,70,229,.4)';
              });
              dstCell.classList.add('gantt-cell-receiving');
              setTimeout(() => dstCell.classList.remove('gantt-cell-receiving'), 900);
              setTimeout(() => ghost.remove(), 700);
            }

            // ── Mutate via shared helper (records timestamped arrow). ──
            moveWtBetweenCols(fresh, wt, srcCol, nextCol, { comment: moveComment });
            setTimeout(() => GanttView.renderChart(), 700);
          })();
          return;
        }

        // #6: revert a previously-moved pill back to its original cell.
        if (action === 'revert-move') {
          window.HistoryManager?.checkpoint(`вернуть ${wt} обратно`);
          const reverted = revertMove(row, wt, srcCol);
          removeCtxMenu();
          GanttView.renderChart();
          if (reverted) {
            const fromLbl = COL_LABEL[reverted.dstCol] || reverted.dstCol;
            const toLbl   = COL_LABEL[reverted.srcCol] || reverted.srcCol;
            window.showToast?.(`«${Utils.truncate(wt, 20)}» возвращена: ${fromLbl} → ${toLbl}`, 'info', 2200);
          }
          return;
        }
      });

      const onOutside = ev => {
        if (!menu.contains(ev.target)) { removeCtxMenu(); document.removeEventListener('click', onOutside, true); }
      };
      setTimeout(() => document.addEventListener('click', onOutside, true), 0);
    });

    /* ── Drag-and-drop reorder within the same well ─────── */
    let _dragData = null;
    wrap.addEventListener('dragstart', e => {
      const pill = e.target.closest('.gantt-type-pill[data-wt][data-row-id]');
      if (!pill || pill.classList.contains('gantt-pill-ghost')) return;
      _dragData = {
        rowId:  pill.dataset.rowId,
        srcCol: pill.dataset.srcCol,
        wt:     pill.dataset.wt,
      };
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', _dragData.wt); } catch(_){}
      pill.classList.add('gantt-pill-dragging');

      // V16 roadmap-2 (A2) — pre-highlight drop targets the moment drag
      // starts. Valid = same row (same epic), different col. Invalid =
      // every other cell. Without this advance hint, the user only sees
      // a single highlight on the cell currently under cursor — and
      // dropping near a hatched OT gutter feels especially uncertain.
      // Iterate via dataset comparison rather than CSS selectors (cleaner
      // and avoids cross-scope cssEscape helpers).
      wrap.querySelectorAll('.gantt-cell[data-row-id]').forEach(c => {
        if (c.dataset.rowId === _dragData.rowId) {
          if (c.dataset.col !== _dragData.srcCol) c.classList.add('gdt-drop-valid');
        } else {
          c.classList.add('gdt-drop-invalid');
        }
      });
    });
    wrap.addEventListener('dragend', e => {
      const pill = e.target.closest('.gantt-type-pill');
      if (pill) pill.classList.remove('gantt-pill-dragging');
      wrap.querySelectorAll('.gantt-pill-drop-target,.gantt-cell-drop-target,.gdt-drop-valid,.gdt-drop-invalid')
        .forEach(el => el.classList.remove('gantt-pill-drop-target','gantt-cell-drop-target','gdt-drop-valid','gdt-drop-invalid'));
      _dragData = null;
    });
    // Wrap-level handlers cover ONLY intra-cell pill→pill reorder.
    // Cross-cell DnD is handled by the per-cell drop installed above (which
    // routes through moveWtBetweenCols so a ghost trail is recorded). If we
    // also handled cross-cell here, both handlers would fire on bubble and
    // double-mutate the row.
    wrap.addEventListener('dragover', e => {
      if (!_dragData) return;
      const pillTarget = e.target.closest('.gantt-type-pill[data-wt][data-row-id]');
      if (!pillTarget) return;
      if (pillTarget.classList.contains('gantt-pill-ghost') || pillTarget.classList.contains('gantt-pill-dragging')) return;
      if (pillTarget.dataset.rowId !== _dragData.rowId || pillTarget.dataset.srcCol !== _dragData.srcCol) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      wrap.querySelectorAll('.gantt-pill-drop-target').forEach(el => el.classList.remove('gantt-pill-drop-target'));
      pillTarget.classList.add('gantt-pill-drop-target');
    });
    wrap.addEventListener('drop', e => {
      if (!_dragData) return;
      const target = e.target.closest('.gantt-type-pill[data-wt][data-row-id]');
      if (!target) return;
      if (target.dataset.rowId !== _dragData.rowId || target.dataset.srcCol !== _dragData.srcCol) return;
      e.preventDefault();
      const row = state.rows.find(r => r.id === _dragData.rowId);
      if (!row) { _dragData = null; return; }
      const fieldKey = colKeyMap[_dragData.srcCol];
      if (!fieldKey || !Array.isArray(row[fieldKey])) return;
      const arr = row[fieldKey];
      const fromIdx = arr.indexOf(_dragData.wt);
      const toIdx   = arr.indexOf(target.dataset.wt);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
      window.HistoryManager?.checkpoint(`переставить ${_dragData.wt}`);
      arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, _dragData.wt);
      row[fieldKey] = arr;
      row.dirty = true;
      Storage.save();
      _dragData = null;
      wrap.querySelectorAll('.gantt-pill-drop-target').forEach(el => el.classList.remove('gantt-pill-drop-target'));
      GanttView.renderChart();
    });

    /* Draw postpone arrows after layout is settled. Single rAF was racing the
       browser's layout pass on first render — pill rects came back zero-sized,
       arrows had nothing to anchor to, and the SVG silently rendered nothing.
       Two rAFs guarantee one full paint has happened.
       V17 P2 (M2) — dropped the 750 ms `setTimeout` re-run. Audit found the
       extra paint actually drew arrows over already-removed nodes during
       fast re-renders (e.g. drag-flight animation). Two rAFs are sufficient
       since flight animations finish before next render. */
    requestAnimationFrame(() => requestAnimationFrame(() => GanttView.drawPostponeArrows(wrap)));

    // V17.1.2 — ResizeObserver на gantt-wrap: при любом изменении размера
    //   (resize окна браузера, sidebar collapse/expand, открытие чата,
    //   1fr-перераспределение колодцев из C2) стрелки получают свежие
    //   pixel-координаты. Идемпотентно: если уже привязан к этому wrap'у —
    //   skip. Debounce через RAF чтобы не дёргать на каждом пикселе.
    if (!wrap._gdtArrowsResizeObserver && typeof ResizeObserver !== 'undefined') {
      let _roRaf = 0;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(_roRaf);
        _roRaf = requestAnimationFrame(() => {
          try { GanttView.drawPostponeArrows(wrap); } catch(_) {}
        });
      });
      ro.observe(wrap);
      wrap._gdtArrowsResizeObserver = ro;
    }

    // V15 Spine 2026-04-30 — install the fast custom-tooltip handler once.
    // Idempotent — wrap-level delegation survives every renderChart() since
    // we re-use the same `#gantt-wrap` node.
    GanttView.bindFastTooltip(wrap);
  },
  /** Lightweight body-attached tooltip — replaces native `title=` (which
   *  has a ~1.5 s delay browsers don't expose any API to shorten). 200 ms
   *  hover delay before showing. Multi-line via `\n` in `data-tip`.
   *  V18.3 B1 — extracted to ./gantt/aux.js (50 LOC moved). once-flag
   *  передаётся через mutable boundState reference. */
  _fastTipBoundState: { bound: false },
  bindFastTooltip(wrap) { _auxBindFastTooltip(wrap, GanttView._fastTipBoundState); },
  // V18.3 B1 — extracted to ./gantt/aux.js (132 LOC moved).
  drawPostponeArrows(wrap) { _auxDrawPostponeArrows(wrap); },
  // [removed] renderArrows / renderUltra / renderEpics / renderArrowsNew —
  //   legacy modes retired. Only `detailedTasks` (default) survives in V14.
  //   bindGanttModes() in app.js silently migrates the old state values to
  //   'detailedTasks' so that bookmarked links / persisted state still work.
};

