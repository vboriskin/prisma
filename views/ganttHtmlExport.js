'use strict';
/* ============================================================
   GANTT HTML EXPORT — V15
   --
   Builds a self-contained HTML file from the currently rendered
   Gantt view. Output is a static read-only viewer:
     · all CSS inlined (fetched from /styles.css)
     · all interactive bindings stripped (drag, drop, +, ctx menu,
       resize handles, plan-lock, edit mode buttons removed)
     · expand/collapse for team headers preserved (small inline JS)
     · light/dark theme toggle in the export header
     · per-assignee summary table beneath the gantt
   File is sendable as a single .html — opens in any browser, no
   network or server required.
   ============================================================ */

import { state } from '../state.js';
import { GANTT_LEGEND } from './gantt/legendContent.js';

/* HTML-escape helper — needed for the export header where we
   stitch user-controlled text directly into innerHTML. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* V21 Wave-3 — inline-SVG glyphs (Lucide-derived, 1.5px stroke).
   Self-contained: файл шарится наружу и не имеет доступа к /app/icons.js.
   Поэтому SVG-фрагменты дублируются здесь. Размер по умолчанию 14px,
   `currentColor` → наследует цвет родителя. */
function gexIcon(name, size = 14) {
  const paths = {
    'check':         '<polyline points="20 6 9 17 4 12"/>',
    'check-circle':  '<circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/>',
    'lock':          '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    'moon':          '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    'sun':           '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
    'calendar':      '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    'clipboard':     '<rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    'users':         '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    'flag-off':      '<path d="M2 22V4"/><path d="M5 4h12l-2 4 2 4H5"/>', // unplanned (флаг с отметкой)
  };
  const p = paths[name];
  if (!p) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.18em;display:inline-block">${p}</svg>`;
}

/* Pipe-or-comma split — same shape as views/employees.js so multi-assignee
   strings on rows tokenize the same way the rest of the app expects. */
function _splitTags(raw) {
  return String(raw || '').split(/[|,]/).map(s => s.trim()).filter(Boolean);
}

/** Drop the «Бэклог» column entirely from the cloned subtree.
 *  See user request 2026-04-30 — backlog is for planning workflow only,
 *  external recipients of the share-file don't care about it. */
function _dropBacklogColumn(root) {
  // 1. body cells
  root.querySelectorAll('.gantt-cell[data-col="backlog"]').forEach(el => el.remove());
  // 2. team-header cells (the first .gantt-team-header-cell is the team
  //    label; the second is the backlog count → that's what we drop).
  root.querySelectorAll('.gantt-team-header').forEach(hdr => {
    const cells = hdr.querySelectorAll('.gantt-team-header-cell');
    if (cells.length >= 2) cells[1].remove();
  });
  // 3. header column — first child is `.gantt-header-label`, second is the
  //    first bucket header (= backlog).
  root.querySelectorAll('.gantt-header').forEach(hdr => {
    const cols = hdr.querySelectorAll('.gantt-header-col');
    if (cols.length) cols[0].remove();
  });
  // 4. patch `grid-template-columns` on every row that has it inline.
  root.querySelectorAll('[style*="grid-template-columns"]').forEach(el => {
    const style = el.getAttribute('style') || '';
    const fixed = style.replace(/grid-template-columns\s*:\s*([^;]+)/, (_m, value) => {
      const tracks = value.trim().split(/\s+/);
      if (tracks.length <= 2) return _m;
      tracks.splice(1, 1);                    // drop the 2nd track (backlog)
      return `grid-template-columns: ${tracks.join(' ')}`;
    });
    el.setAttribute('style', fixed);
  });
}

/** Distribute remaining bucket columns evenly using `1fr` so the gantt
 *  fills the available width with no empty space on the right. The label
 *  column keeps its explicit pixel width (left-most track). */
function _equalizeBucketWidths(root) {
  root.querySelectorAll('[style*="grid-template-columns"]').forEach(el => {
    const style = el.getAttribute('style') || '';
    const fixed = style.replace(/grid-template-columns\s*:\s*([^;]+)/, (_m, value) => {
      const tracks = value.trim().split(/\s+/);
      if (tracks.length < 2) return _m;
      const labelTrack = tracks[0];
      const bucketCount = tracks.length - 1;
      const evenly = `${labelTrack} ${'1fr '.repeat(bucketCount).trim()}`;
      return `grid-template-columns: ${evenly}`;
    });
    el.setAttribute('style', fixed);
  });
}

/** Strip everything that requires JS bindings or could be misinterpreted
 *  as editable. Operates on a CLONED node — never on the live DOM. */
function _stripInteractive(root) {
  _dropBacklogColumn(root);
  _equalizeBucketWidths(root);              // V15 — even bucket widths

  // V15 Spine 2026-04-30 — strip the live-app's pre-rendered arrow SVG.
  // The SVG was sized against the ORIGINAL pixel-width grid; after we
  // drop the backlog column and convert tracks to `1fr`, those coordinates
  // become stale (arrows hang in empty space, point to wrong pills). The
  // exported HTML re-draws them via `_REDRAW_ARROWS_JS` after the browser
  // settles the new layout.
  root.querySelectorAll('.gdt-arrows-svg').forEach(el => el.remove());

  root.querySelectorAll(
    '.gdt-add-type-btn, .gantt-team-vis-btn, ' +
    '.gantt-row-resize, .gdt-resize-handle, .gdt-col-resize, ' +
    '.gdt-drag-handle'
  ).forEach(el => el.remove());
  root.querySelectorAll('[draggable]').forEach(el => el.removeAttribute('draggable'));
  // Wipe data-* attrs that were used purely for events.
  // KEEP `data-wt` (paints pill colours via CSS), `data-team-key` (used by
  // the static expand/collapse script) and `data-arrow-at` (pairs ghost
  // src/dst across trail rows).
  root.querySelectorAll('[data-row-id], [data-src-col], [data-dst-col]').forEach(el => {
    el.removeAttribute('data-row-id');
    el.removeAttribute('data-src-col');
    el.removeAttribute('data-dst-col');
  });
  root.querySelectorAll('.gantt-cell-dragover').forEach(el => el.classList.remove('gantt-cell-dragover'));
  root.querySelectorAll('[style*="cursor:pointer"]').forEach(el => {
    el.setAttribute('style', el.getAttribute('style').replace(/cursor:\s*pointer\s*;?/g, ''));
  });
  return root;
}

/** Build the per-assignee summary table HTML. Beneath the gantt, this
 *  table groups all rows by ASSIGNEE → lists their tasks (epic, wt, bucket,
 *  period, status) and an aggregate row at the top of each group.
 *  V15 Spine 2026-04-30 — only pills WITH at least one assigned ФИО are
 *  included. Pills with no assignee are skipped entirely (per user request:
 *  «надо сводную только по задачам где исполнитель назначен»). Per-pill
 *  assignment via `row.assigneePills[col__wt]` wins over the row-level
 *  fallback `row.assignee` so a pill explicitly assigned to «Иванов» on a
 *  row with row.assignee='' still counts under Иванов. Multi-assignee
 *  pills duplicate under each FIO (one task with 2 assignees → counted
 *  under both — semantically «who needs to act»). */
function _buildAssigneeSummary(rows) {
  if (!rows || !rows.length) return '';

  const buckets = [
    { key: 'release120Types', label: '1.20', colKey: 'r120'     },
    { key: 'release121Types', label: '1.21', colKey: 'r121'     },
    { key: 'release122Types', label: '1.22', colKey: 'r122'     },
    { key: 'overtimeTypes',   label: 'OT',   colKey: 'overtime' },
  ];

  const flat = [];
  for (const r of rows) {
    const rowAssignees = _splitTags(r.assignee);
    const ap = (r.assigneePills && typeof r.assigneePills === 'object') ? r.assigneePills : {};
    for (const b of buckets) {
      const types = Array.isArray(r[b.key]) ? r[b.key] : [];
      if (!types.length) continue;
      for (const wt of types) {
        // Per-pill ФИО wins; row-level used as fallback for legacy rows.
        const pillKey = `${b.colKey}__${wt}`;
        const perPill = (typeof ap[pillKey] === 'string' && ap[pillKey].trim())
          ? _splitTags(ap[pillKey])
          : null;
        const pillAssignees = perPill || rowAssignees;
        if (!pillAssignees.length) continue;     // skip — no assignee on this pill

        const isDone      = !!(r.donePills      && r.donePills[pillKey]);
        const isUnplanned = !!(r.unplannedPills && r.unplannedPills[pillKey]);
        for (const fio of pillAssignees) {
          flat.push({
            fio,
            epic:    r.epic || r.tasks || '(без эпика)',
            team:    r.team || '',
            bucket:  b.label,
            wt,
            workStart: r.workStartDate || '',
            workEnd:   r.workEndDate || '',
            isDone, isUnplanned,
          });
        }
      }
    }
  }
  if (!flat.length) return '';

  // Group by assignee.
  const byFio = new Map();
  for (const t of flat) {
    if (!byFio.has(t.fio)) byFio.set(t.fio, []);
    byFio.get(t.fio).push(t);
  }

  // Order: by task-count desc, ties broken alphabetically.
  const fios = [...byFio.keys()].sort((a, b) => {
    const delta = byFio.get(b).length - byFio.get(a).length;
    return delta !== 0 ? delta : a.localeCompare(b, 'ru');
  });

  const statusLabel = (t) => {
    if (t.isDone)      return `<span class="gex-status gex-status-done">${gexIcon("check-circle")} Завершено</span>`;
    if (t.isUnplanned) return `<span class="gex-status gex-status-unplanned">${gexIcon("flag-off")} Не запланирована</span>`;
    return '<span class="gex-status gex-status-active">● В работе</span>';
  };
  const periodLabel = (t) => {
    if (!t.workStart && !t.workEnd) return '<span style="opacity:.4">—</span>';
    return `${esc(t.workStart || '?')} → ${esc(t.workEnd || '?')}`;
  };

  const groupRows = (fio) => {
    const tasks = byFio.get(fio);
    // Aggregates per bucket.
    const totals = { '1.20': 0, '1.21': 0, '1.22': 0, 'OT': 0 };
    let done = 0, unplanned = 0;
    for (const t of tasks) {
      totals[t.bucket] = (totals[t.bucket] || 0) + 1;
      if (t.isDone)      done++;
      if (t.isUnplanned) unplanned++;
    }
    const aggSparks = Object.entries(totals)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `<span class="gex-agg-pill">${esc(k)}: ${v}</span>`).join(' ');
    const aggStatus = `${tasks.length} задач${done ? ` · ${done} завершено` : ''}${unplanned ? ` · ${unplanned} не запланировано` : ''}`;

    const rowsHtml = tasks.map(t => `
      <tr>
        <td class="gex-cell-team">${esc(t.team || '')}</td>
        <td class="gex-cell-epic">${esc(t.epic)}</td>
        <td class="gex-cell-wt">${esc(t.wt)}</td>
        <td class="gex-cell-bucket"><span class="gex-bucket-pill gex-bucket-${esc(t.bucket.replace(/\./g, ''))}">${esc(t.bucket)}</span></td>
        <td class="gex-cell-period">${periodLabel(t)}</td>
        <td class="gex-cell-status">${statusLabel(t)}</td>
      </tr>`).join('');

    return `<div class="gex-fio-group">
      <div class="gex-fio-header">
        <span class="gex-fio-name">${esc(fio)}</span>
        <span class="gex-fio-agg">${aggSparks} <span class="gex-fio-agg-meta">${esc(aggStatus)}</span></span>
      </div>
      <table class="gex-table">
        <thead>
          <tr>
            <th>Команда</th>
            <th>Эпик</th>
            <th>Тип работы</th>
            <th>Колодец</th>
            <th>Период</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
  };

  return `<div class="gex-summary">
    <h2 class="gex-summary-title">Сводка по исполнителям</h2>
    <div class="gex-summary-meta">${flat.length} назначений · ${byFio.size} ${byFio.size === 1 ? 'исполнитель' : 'исполнителей'}</div>
    ${fios.map(groupRows).join('')}
  </div>`;
}

/** Companion block to `_buildAssigneeSummary` — lists pills WITHOUT any
 *  assignee. Surfaced as a separate card beneath the per-FIO summary so
 *  the manager can see at a glance «what still needs an owner». Returns
 *  '' when every pill is already assigned. */
function _buildUnassignedSummary(rows) {
  if (!rows || !rows.length) return '';
  const buckets = [
    { key: 'release120Types', label: '1.20', colKey: 'r120'     },
    { key: 'release121Types', label: '1.21', colKey: 'r121'     },
    { key: 'release122Types', label: '1.22', colKey: 'r122'     },
    { key: 'overtimeTypes',   label: 'OT',   colKey: 'overtime' },
  ];

  const orphans = [];
  for (const r of rows) {
    const rowAssignees = _splitTags(r.assignee);
    const ap = (r.assigneePills && typeof r.assigneePills === 'object') ? r.assigneePills : {};
    for (const b of buckets) {
      const types = Array.isArray(r[b.key]) ? r[b.key] : [];
      if (!types.length) continue;
      for (const wt of types) {
        const pillKey = `${b.colKey}__${wt}`;
        const perPill = (typeof ap[pillKey] === 'string' && ap[pillKey].trim())
          ? _splitTags(ap[pillKey])
          : null;
        const pillAssignees = perPill || rowAssignees;
        if (pillAssignees.length) continue;       // assigned — belongs to other block

        orphans.push({
          epic:    r.epic || r.tasks || '(без эпика)',
          team:    r.team || '',
          bucket:  b.label,
          wt,
          workStart: r.workStartDate || '',
          workEnd:   r.workEndDate || '',
          isDone:      !!(r.donePills      && r.donePills[pillKey]),
          isUnplanned: !!(r.unplannedPills && r.unplannedPills[pillKey]),
        });
      }
    }
  }
  if (!orphans.length) return '';

  // Per-bucket aggregate sparks at the header.
  const totals = { '1.20': 0, '1.21': 0, '1.22': 0, 'OT': 0 };
  let done = 0, unplanned = 0;
  for (const t of orphans) {
    totals[t.bucket] = (totals[t.bucket] || 0) + 1;
    if (t.isDone)      done++;
    if (t.isUnplanned) unplanned++;
  }
  const aggSparks = Object.entries(totals)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `<span class="gex-agg-pill">${esc(k)}: ${v}</span>`).join(' ');
  const aggStatus = `${orphans.length} задач${done ? ` · ${done} завершено` : ''}${unplanned ? ` · ${unplanned} не запланировано` : ''}`;

  const periodLabel = (t) => {
    if (!t.workStart && !t.workEnd) return '<span style="opacity:.4">—</span>';
    return `${esc(t.workStart || '?')} → ${esc(t.workEnd || '?')}`;
  };
  const statusLabel = (t) => {
    if (t.isDone)      return `<span class="gex-status gex-status-done">${gexIcon("check-circle")} Завершено</span>`;
    if (t.isUnplanned) return `<span class="gex-status gex-status-unplanned">${gexIcon("flag-off")} Не запланирована</span>`;
    return '<span class="gex-status gex-status-active">● В работе</span>';
  };

  // Sort by bucket order, then by team, then by epic — so similar work clusters.
  const bucketOrder = { '1.20': 0, '1.21': 1, '1.22': 2, 'OT': 3 };
  orphans.sort((a, b) => {
    const db = (bucketOrder[a.bucket] ?? 9) - (bucketOrder[b.bucket] ?? 9);
    if (db) return db;
    const dt = a.team.localeCompare(b.team, 'ru');
    if (dt) return dt;
    return a.epic.localeCompare(b.epic, 'ru');
  });

  const rowsHtml = orphans.map(t => `
    <tr>
      <td class="gex-cell-team">${esc(t.team)}</td>
      <td class="gex-cell-epic">${esc(t.epic)}</td>
      <td class="gex-cell-wt">${esc(t.wt)}</td>
      <td class="gex-cell-bucket"><span class="gex-bucket-pill gex-bucket-${esc(t.bucket.replace(/\./g, ''))}">${esc(t.bucket)}</span></td>
      <td class="gex-cell-period">${periodLabel(t)}</td>
      <td class="gex-cell-status">${statusLabel(t)}</td>
    </tr>`).join('');

  return `<div class="gex-summary gex-summary-unassigned">
    <div class="gex-fio-header">
      <span class="gex-fio-name">Без исполнителя</span>
      <span class="gex-fio-agg">${aggSparks} <span class="gex-fio-agg-meta">${esc(aggStatus)}</span></span>
    </div>
    <table class="gex-table">
      <thead>
        <tr>
          <th>Команда</th>
          <th>Эпик</th>
          <th>Тип работы</th>
          <th>Колодец</th>
          <th>Период</th>
          <th>Статус</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;
}

/** Compact legend strip placed ABOVE the gantt — explains the visual
 *  vocabulary of the V15 Spine-redesigned pills so a recipient who's
 *  never seen the app can decode the diagram without a tour. Sectioned:
 *    · анатомия пилюли (stripe, name, state, comment marker, meta)
 *    · колодцы (релиз-buckets)
 *    · состояния (active / done / unplanned, как читается на пилюле)
 *    · переносы (↗ / ↘ строки-следа) */
function _buildLegend() {
  // V17.1 D1 — подсказки экспортного гантa теперь сворачиваемые
  // (<details open>): по умолчанию раскрыты, юзер может схлопнуть.
  // Тексты — из shared `legendContent.js`, чтобы экспорт не расходился
  // с живой панелью «Как читать?» (см. views/gantt.js#renderPillLegend).
  const T = GANTT_LEGEND;
  return `<details class="gex-legend-details" open>
  <summary class="gex-legend-summary">Подсказки по визуализации</summary>
  <div class="gex-legend">
    <div class="gex-legend-section gex-legend-anatomy">
      <div class="gex-legend-title">${T.sectionTitle.anatomy}</div>
      <div class="gex-legend-items">
        <span class="gex-legend-pill-demo">
          <span class="gex-legend-stripe"></span>
          <span class="gex-legend-pill-body">
            <span class="gex-legend-pill-row1">
              <span class="gex-legend-pill-name">${T.anatomy.demoName}</span>
              <span class="gex-legend-pill-state-active"></span>
              <span class="gex-legend-pill-cmt"></span>
            </span>
            <span class="gex-legend-pill-row2">${T.anatomy.demoMeta}</span>
          </span>
        </span>
        <span class="gex-legend-meta">${T.anatomy.description}</span>
      </div>
    </div>
    <div class="gex-legend-section">
      <div class="gex-legend-title">${T.sectionTitle.buckets}</div>
      <div class="gex-legend-items">
        <span class="gex-legend-item"><span class="gex-legend-stripe-sample" style="background:var(--prizma-information)"></span> ${T.bucket.r120}</span>
        <span class="gex-legend-item"><span class="gex-legend-stripe-sample" style="background:var(--prizma-on-course)"></span> ${T.bucket.r121}</span>
        <span class="gex-legend-item"><span class="gex-legend-stripe-sample" style="background:var(--prizma-drift)"></span> ${T.bucket.r122}</span>
        <span class="gex-legend-item"><span class="gex-legend-stripe-sample" style="background:var(--prizma-off-course)"></span> ${T.bucket.ot}</span>
      </div>
    </div>
    <div class="gex-legend-section">
      <div class="gex-legend-title">${T.sectionTitle.states}</div>
      <div class="gex-legend-items">
        <span class="gex-legend-item"><span class="gex-legend-state gex-legend-state-active"></span> ${T.state.active}</span>
        <span class="gex-legend-item"><span class="gex-legend-state gex-legend-state-done">✓</span> ${T.state.done}</span>
        <span class="gex-legend-item"><span class="gex-legend-state gex-legend-state-unplanned"></span> ${T.state.unplanned}</span>
        <span class="gex-legend-item"><span class="gex-legend-cmt-square gex-legend-cmt-transfer"></span> ${T.state.transferComment}</span>
        <span class="gex-legend-item"><span class="gex-legend-cmt-square gex-legend-cmt-add"></span> ${T.state.addedAfterLock}</span>
      </div>
    </div>
    <div class="gex-legend-section">
      <div class="gex-legend-title">${T.sectionTitle.transfers}</div>
      <div class="gex-legend-items">
        <span class="gex-legend-item"><span class="gex-legend-icon">↗</span> ${T.transfer.from}</span>
        <span class="gex-legend-item"><span class="gex-legend-icon">↘</span> ${T.transfer.to}</span>
        <span class="gex-legend-item gex-legend-meta">${T.transfer.meta}</span>
      </div>
    </div>
  </div>
  </details>`;
}

/** Re-draw trail-arrows inside the exported gantt — original SVG was
 *  stripped because its coordinates became stale after `_dropBacklogColumn`
 *  + `_equalizeBucketWidths`. We use `data-arrow-at` to pair `.gdt-trail-src`
 *  with `.gdt-trail-dst` (same logic as the live `drawPostponeArrows`),
 *  computing positions after the browser settles the new layout — runs on
 *  load + on resize so the arrows track responsive bucket widths. */
const _REDRAW_ARROWS_JS = `
(function () {
  function rebuild() {
    document.querySelectorAll('.gantt-body').forEach(body => {
      // Wipe any stale SVG that survived the strip pass.
      body.querySelectorAll('.gdt-arrows-svg').forEach(el => el.remove());

      // Pair endpoints by data-arrow-at, like the live renderer does.
      const srcs = body.querySelectorAll('.gdt-trail-src[data-arrow-at]');
      if (!srcs.length) return;
      const arrows = [];
      srcs.forEach(srcEl => {
        const at = srcEl.getAttribute('data-arrow-at');
        if (!at) return;
        const dstEl = body.querySelector(
          '.gdt-trail-dst[data-arrow-at="' + (window.CSS && CSS.escape ? CSS.escape(at) : at.replace(/"/g, '\\\\"')) + '"]'
        );
        if (dstEl) arrows.push({ srcEl, dstEl });
      });
      if (!arrows.length) return;

      const NS = 'http://www.w3.org/2000/svg';
      const sw = Math.max(body.scrollWidth,  body.clientWidth);
      const sh = Math.max(body.scrollHeight, body.clientHeight) + 30;
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'gdt-arrows-svg');
      svg.setAttribute('width',  sw);
      svg.setAttribute('height', sh);
      svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:50;overflow:visible';
      const defs = document.createElementNS(NS, 'defs');
      svg.appendChild(defs);

      // V16 (gantt-roadmap #4) — colour the arrow stroke + marker by
      // work-type accent (mirrors live drawPostponeArrows). Palette is
      // inlined here so the exported file is self-contained.
      // AUDIT-ART #11 — values синхронизированы с brand light-палитрой
      // (theme.css [data-theme="light"] --prizma-worktype-*) и с
      // constants.js PHASE_COLORS. Раньше тут жила Tailwind-rainbow
      // (#7c3aed / #0284c7 / #4f46e5 / #059669 / #d97706 / #dc2626 /
      // #db2777 / #65a30d / #ea580c) — это создавало «два разных Ганта»
      // (live: Mist↔Stone, export: tailwind). Любое расхождение здесь =
      // визуальный split-brain — держать в синхроне с theme.css.
      const PHASE_COLORS = {
        'бизнес аналитика':'#6A5E78','аналитика':'#5A5A6E','backend':'#2C5F88','frontend':'#3A8060',
        'тестирование':'#8A6428','внедрение':'#705A40','миграция данных':'#456878',
        'стабилизация':'#3A6850','хотфикс':'#8A4828'
      };
      const markerCache = {};
      function ensureMarker(color) {
        const id = 'gex-ah-' + color.replace(/[^a-z0-9]/gi, '');
        if (markerCache[id]) return id;
        markerCache[id] = true;
        const marker = document.createElementNS(NS, 'marker');
        marker.setAttribute('id', id);
        marker.setAttribute('markerWidth',  '6');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('refX', '5.5');
        marker.setAttribute('refY', '3');
        marker.setAttribute('orient', 'auto');
        marker.innerHTML = '<polygon points="0 0, 6 3, 0 6" fill="' + color + '"/>';
        defs.appendChild(marker);
        return id;
      }

      const cRect = body.getBoundingClientRect();
      arrows.forEach(({ srcEl, dstEl }) => {
        const sR = srcEl.getBoundingClientRect();
        const dR = dstEl.getBoundingClientRect();
        if (!sR.width || !dR.width) return;
        const sx = sR.right - cRect.left - 1;
        const sy = sR.top   + sR.height * 0.5 - cRect.top;
        const dx = dR.left  - cRect.left + 1;
        const dy = dR.top   + dR.height * 0.5 - cRect.top;
        const wt = srcEl.getAttribute('data-wt') || '';
        const color = PHASE_COLORS[wt] || '#94a3b8';
        const markerId = ensureMarker(color);
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', 'M ' + sx + ' ' + sy + ' L ' + dx + ' ' + dy);
        path.setAttribute('stroke',         color);
        path.setAttribute('stroke-width',   '1.2');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('fill',           'none');
        path.setAttribute('marker-end',     'url(#' + markerId + ')');
        path.setAttribute('opacity',        '0.7');
        svg.appendChild(path);
      });

      // Establish a local stacking context so the SVG (z:50) lives inside
      // body and doesn't out-paint the sticky .gantt-header (z:5) on scroll.
      body.style.position = 'relative';
      body.style.zIndex   = '0';
      body.appendChild(svg);
    });
  }
  // Run once on load (after fonts/CSS settle), once on resize.
  // requestAnimationFrame x2 — matches the live renderer's two-frame wait
  // so column widths are final before we measure.
  function schedule() { requestAnimationFrame(() => requestAnimationFrame(rebuild)); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }
  window.addEventListener('resize', schedule);
  // Theme toggle changes layout subtly (border thickness etc.) — rebuild
  // when the user switches themes via the export's #gex-theme-btn too.
  document.addEventListener('click', (e) => {
    if (e.target.closest('#gex-theme-btn')) schedule();
  });
})();
`;

/** Theme toggle script + initial-theme bootstrap. Persists to localStorage
 *  inside the OPENED file (per-recipient, not the original sender's
 *  preference). Falls back to OS `prefers-color-scheme` on first open. */
const _THEME_JS = `
(function () {
  const KEY = 'q2_gantt_export_theme';
  // V21 Wave-3 — локальные inline-SVG icons для self-contained экспорта.
  const _gexSun  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.18em;display:inline-block"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  const _gexMoon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.18em;display:inline-block"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  function apply(t) {
    const dark = t === 'dark';
    document.body.classList.toggle('theme-dark', dark);
    const btn = document.getElementById('gex-theme-btn');
    if (btn) btn.innerHTML = dark ? (_gexSun + ' Светлая') : (_gexMoon + ' Тёмная');
  }
  let initial = null;
  try { initial = localStorage.getItem(KEY); } catch (_) {}
  if (!initial) {
    initial = (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  apply(initial);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#gex-theme-btn')) return;
    const next = document.body.classList.contains('theme-dark') ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem(KEY, next); } catch (_) {}
  });
})();
`;

/** V17.1 D2 — toggle that hides all wells except the «current» one (the
 *  release whose date-range covers today) plus Овертайм. Click again to
 *  restore. Detection by data-col attribute on header / cells. */
const _CURRENT_RELEASE_JS = `
(function () {
  const btn = document.getElementById('gex-current-release-btn');
  if (!btn) return;
  // Determine the current release by parsing each header cell's
  // .gantt-col-date subtitle (which we render as «20 апреля – 17 мая» — the
  // long Russian form). Fallback: regex on the inline DD.MM–DD.MM format if
  // present in title attributes. Also accept a hard-coded data-col-range
  // attribute if export ever adds one.
  const monthNames = ['янв','фев','март','апр','май','июнь','июль','авг','сент','окт','ноябрь','декабрь'];
  function _matchToday(text) {
    if (!text) return false;
    // Try DD.MM–DD.MM
    const m1 = String(text).match(/(\\d{1,2})\\.(\\d{1,2})\\D+(\\d{1,2})\\.(\\d{1,2})/);
    const today = new Date();
    const tNum = (today.getMonth() + 1) * 100 + today.getDate();
    if (m1) {
      const s = parseInt(m1[2], 10) * 100 + parseInt(m1[1], 10);
      const e = parseInt(m1[4], 10) * 100 + parseInt(m1[3], 10);
      return tNum >= s && tNum <= e;
    }
    // Try long Russian: «20 апреля – 17 мая»
    const m2 = String(text).match(/(\\d{1,2})\\s+([а-яё]+)\\s*[-–—]\\s*(\\d{1,2})\\s+([а-яё]+)/i);
    if (m2) {
      const findM = (name) => {
        const lower = String(name).toLowerCase();
        for (let i = 0; i < monthNames.length; i++) if (lower.startsWith(monthNames[i])) return i + 1;
        return -1;
      };
      const sM = findM(m2[2]); const eM = findM(m2[4]);
      if (sM < 0 || eM < 0) return false;
      const s = sM * 100 + parseInt(m2[1], 10);
      const e = eM * 100 + parseInt(m2[3], 10);
      return tNum >= s && tNum <= e;
    }
    return false;
  }
  let active = false;
  btn.addEventListener('click', function () {
    active = !active;
    btn.classList.toggle('active', active);
    btn.textContent = active ? 'Все колодцы' : 'Текущий релиз';
    if (!active) {
      // Restore: show every column.
      document.querySelectorAll('[data-col]').forEach(el => { el.style.display = ''; });
      return;
    }
    // Detect current bucket via header cell subtitles.
    let currentKey = null;
    document.querySelectorAll('.gantt-header-col[data-col]').forEach(h => {
      if (currentKey) return;
      const meta = h.querySelector('.gdt-rail-meta, .gantt-col-date');
      if (meta && _matchToday(meta.textContent)) currentKey = h.getAttribute('data-col');
    });
    // Hide every cell whose data-col is not currentKey AND not 'overtime'.
    document.querySelectorAll('[data-col]').forEach(el => {
      const k = el.getAttribute('data-col');
      el.style.display = (k === currentKey || k === 'overtime') ? '' : 'none';
    });
    if (!currentKey) {
      btn.title = 'Сегодняшняя дата вне всех релизных окон — показан только Овертайм';
    }
  });
})();
`;

/** Expand/collapse handler for team headers. */
const _COLLAPSE_JS = `
(function () {
  const headers = document.querySelectorAll('.gantt-team-header[data-team-key]');
  headers.forEach(h => {
    const chev = document.createElement('span');
    chev.className = 'gex-chev';
    chev.textContent = '▾';
    chev.style.cssText = 'display:inline-block;margin-right:8px;cursor:pointer;font-size:11px;user-select:none;transition:transform .15s';
    const labelCell = h.querySelector('.gdt-team-label, .gantt-team-header-cell');
    if (labelCell) labelCell.prepend(chev);
    const tk = h.dataset.teamKey;
    const rows = document.querySelectorAll('.gantt-row[data-team-key="' + cssEscape(tk) + '"]');
    let collapsed = false;
    function applyCollapsed() {
      rows.forEach(r => { r.style.display = collapsed ? 'none' : ''; });
      chev.style.transform = collapsed ? 'rotate(-90deg)' : '';
    }
    chev.addEventListener('click', () => { collapsed = !collapsed; applyCollapsed(); });
    h.addEventListener('click', (e) => {
      if (e.target === chev) return;
      collapsed = !collapsed;
      applyCollapsed();
    });
  });
  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\\\' + c.charCodeAt(0).toString(16) + ' ');
  }
})();
`;

/** Reset/reset-ish baseline + summary table styling. Light + dark themes
 *  via `body.theme-dark`. */
const _BASELINE_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 14px; }

/* V21 — inject Prизма-токены в standalone document. Раньше токены брались
   из theme.css (не подключается в export), и var()-references фолбекались
   на light hex даже в dark theme. Теперь токены доступны в обоих темах. */
:root {
  --prizma-bg: #FAFAF8;
  --prizma-bg-elevated: #FFFFFF;
  --prizma-bg-tertiary: #F0EDE5;
  --prizma-text-primary: #1A1A22;
  --prizma-text-secondary: #7A7A82;
  --prizma-text-tertiary: #5A5A64;
  --prizma-border: rgba(26, 26, 34, 0.08);
  --prizma-border-strong: rgba(26, 26, 34, 0.15);
  --prizma-on-course: #0F8A5F;
  --prizma-on-course-bg: rgba(15, 138, 95, 0.1);
  --prizma-drift: #B5670A;
  --prizma-drift-bg: rgba(181, 103, 10, 0.1);
  --prizma-off-course: #C13838;
  --prizma-off-course-bg: rgba(193, 56, 56, 0.1);
  --prizma-information: #1F6B96;
  --prizma-information-bg: rgba(31, 107, 150, 0.1);
}
body.theme-dark {
  --prizma-bg: #0A0A0F;
  --prizma-bg-elevated: #1A1A22;
  --prizma-bg-tertiary: #2A2A30;
  --prizma-text-primary: #FFFFFF;
  --prizma-text-secondary: #8E8E96;
  --prizma-text-tertiary: #8A8A92;
  --prizma-border: rgba(255, 255, 255, 0.08);
  --prizma-border-strong: rgba(255, 255, 255, 0.15);
  --prizma-on-course: #7FE8B5;
  --prizma-on-course-bg: rgba(127, 232, 181, 0.12);
  --prizma-drift: #FFB347;
  --prizma-drift-bg: rgba(255, 179, 71, 0.12);
  --prizma-off-course: #FF6B6B;
  --prizma-off-course-bg: rgba(255, 107, 107, 0.12);
  --prizma-information: #6EC1E4;
  --prizma-information-bg: rgba(110, 193, 228, 0.12);
}

body {
  font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
  background: var(--prizma-bg); color: var(--prizma-text-primary); line-height: 1.5;
  padding: 20px; min-height: 100vh;
  transition: background-color .15s, color .15s;
}

.gex-page-header {
  display: flex; flex-direction: column; gap: 6px;
  margin-bottom: 20px;
  padding: 16px 20px;
  background: var(--prizma-bg-elevated);
  border: 1px solid var(--prizma-border);
  border-radius: 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
}
body.theme-dark .gex-page-header { background: var(--prizma-bg-elevated); border-color: var(--prizma-border); box-shadow: none; }
.gex-page-title { font-size: 18px; font-weight: 700; }
.gex-page-meta { font-size: 12px; color: var(--prizma-text-secondary); display: flex; gap: 14px; flex-wrap: wrap; }
.gex-meta-item { display: inline-flex; gap: 5px; align-items: baseline; }
.gex-meta-num { font-weight: 700; }
.gex-readonly-badge {
  display: inline-block;
  padding: 2px 8px;
  /* Wave1 P-GR §D7 — bare hex (#fef3c7/#78350f/#f59e0b) заменены на брендовые
     токены через CSS-vars с fallback (standalone HTML-export не получает
     prizma-vars из app, поэтому fallback-hex обязателен). */
  background: var(--prizma-drift-bg, #fef3c7);
  color: var(--prizma-drift-fg, #78350f);
  border: 1px solid var(--prizma-drift, #f59e0b);
  border-radius: 4px;
  font-size: 11px; font-weight: 600;
  letter-spacing: .3px;
}
body.theme-dark .gex-readonly-badge { background: var(--prizma-drift-bg, #422006); color: var(--prizma-drift, #fde68a); border-color: var(--prizma-drift, #92400e); }

#gex-theme-btn {
  margin-left: auto;
  padding: 4px 10px;
  font: inherit; font-size: 12px; font-weight: 600;
  background: transparent;
  border: 1px solid var(--prizma-border-strong, var(--prizma-border));
  border-radius: 6px;
  color: inherit;
  cursor: pointer;
  transition: background .15s, border-color .15s;
}
#gex-theme-btn:hover { background: rgba(127,127,127,.1); }

.gex-card {
  background: var(--prizma-bg-elevated);
  border: 1px solid var(--prizma-border);
  border-radius: 12px;
  padding: 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
  overflow: auto;
}
body.theme-dark .gex-card { background: var(--prizma-bg-elevated); border-color: var(--prizma-border); box-shadow: none; }

/* ── Legend strip (above the gantt) ──────────────────── */
.gex-legend {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px 20px;
  margin-bottom: 14px;
  padding: 12px 16px;
  background: var(--prizma-bg-elevated);
  border: 1px solid var(--prizma-border);
  border-radius: 10px;
  box-shadow: 0 1px 4px rgba(0,0,0,.04);
}
body.theme-dark .gex-legend { background: var(--prizma-bg-elevated); border-color: var(--prizma-border); box-shadow: none; }
.gex-legend-section { display: flex; flex-direction: column; gap: 6px; }
.gex-legend-title {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .6px;
  color: var(--prizma-text-secondary);
}
.gex-legend-items {
  display: flex; flex-wrap: wrap; gap: 6px 12px;
  font-size: 11px;
}
.gex-legend-item {
  display: inline-flex; align-items: center; gap: 5px;
  white-space: nowrap;
  color: var(--prizma-text-primary);
}
.gex-legend-icon {
  display: inline-block;
  min-width: 16px; text-align: center;
  font-size: 12px;
  filter: grayscale(.1);
}
.gex-legend-avatar {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: var(--prizma-information); color: #ffffff;
  font-size: 9px; font-weight: 700;
  font-family: 'Inter', system-ui, sans-serif;
  letter-spacing: 0;
}
.gex-legend-meta { color: var(--prizma-text-secondary); font-style: italic; }

/* Spine pill anatomy demo inside the legend (V15 redesign 2026-04-30). */
.gex-legend-anatomy { grid-column: 1 / -1; }
.gex-legend-pill-demo {
  display: inline-flex; align-items: stretch;
  background: var(--prizma-bg-elevated);
  border: 1px solid var(--prizma-border);
  border-left: 3px solid var(--prizma-information);
  border-radius: 6px;
  padding: 4px 7px 4px 6px;
  min-width: 140px;
  font-size: 11px;
  margin-right: 12px;
  vertical-align: middle;
}
body.theme-dark .gex-legend-pill-demo { background: var(--prizma-bg-tertiary); border-color: var(--prizma-border); }
.gex-legend-pill-body { display: flex; flex-direction: column; gap: 1px; }
.gex-legend-pill-row1 {
  display: flex; align-items: center; gap: 4px;
  font-weight: 600;
}
.gex-legend-pill-row2 {
  font-size: 9.5px; color: var(--prizma-text-secondary); font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.gex-legend-pill-state-active {
  display: inline-block; width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--prizma-information);
}
.gex-legend-pill-cmt {
  display: inline-block; width: 7px; height: 7px;
  border-radius: 1.5px;
  background: var(--prizma-drift);
}
.gex-legend-stripe-sample {
  display: inline-block;
  width: 4px; height: 16px;
  border-radius: 1px;
  vertical-align: middle;
  margin-right: 2px;
}
.gex-legend-state {
  display: inline-flex; align-items: center; justify-content: center;
  width: 12px; height: 12px;
  font-size: 8px; font-weight: 800;
  border-radius: 50%;
}
.gex-legend-state-active   { background: var(--prizma-information); }
.gex-legend-state-done     { background: var(--prizma-on-course); color: #fff; }
.gex-legend-state-unplanned {
  background: transparent;
  border: 1.2px dashed var(--prizma-text-secondary);
}
.gex-legend-cmt-square {
  display: inline-block; width: 8px; height: 8px;
  border-radius: 1.5px;
  vertical-align: middle; margin-right: 2px;
}
.gex-legend-cmt-transfer { background: var(--prizma-drift); }
.gex-legend-cmt-add      { background: var(--prizma-information); }

/* ── Per-assignee summary ─────────────────────────────── */
.gex-summary {
  margin-top: 24px;
  background: var(--prizma-bg-elevated);
  border: 1px solid var(--prizma-border);
  border-radius: 12px;
  padding: 20px 24px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
}
/* Companion block for unassigned pills — same shape, muted accent so the
   manager's eye lands on the per-FIO summary first. */
.gex-summary-unassigned {
  margin-top: 16px;
  border-left: 3px solid var(--prizma-drift);
}
body.theme-dark .gex-summary { background: var(--prizma-bg-elevated); border-color: var(--prizma-border); box-shadow: none; }
.gex-summary-title { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
.gex-summary-meta { font-size: 12px; color: var(--prizma-text-secondary); margin-bottom: 16px; }

.gex-fio-group { margin-bottom: 24px; }
.gex-fio-group:last-child { margin-bottom: 0; }
.gex-fio-header {
  display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
  padding: 8px 0;
  border-bottom: 1.5px solid var(--prizma-border);
  margin-bottom: 8px;
}
.gex-fio-name { font-size: 14px; font-weight: 700; }
.gex-fio-agg { font-size: 11px; display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
.gex-fio-agg-meta { color: var(--prizma-text-secondary); }
.gex-agg-pill {
  display: inline-block;
  padding: 1px 7px;
  background: var(--prizma-information-bg); color: var(--prizma-information);
  border-radius: 4px;
  font-size: 11px; font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.gex-table {
  width: 100%; border-collapse: collapse; font-size: 12px;
}
.gex-table th {
  text-align: left;
  padding: 6px 10px;
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .5px;
  color: var(--prizma-text-secondary);
  border-bottom: 1px solid var(--prizma-border);
}
.gex-table td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--prizma-border);
  vertical-align: middle;
}
.gex-table tr:last-child td { border-bottom: none; }
.gex-cell-team { color: var(--prizma-text-secondary); font-size: 11px; white-space: nowrap; }
.gex-cell-epic { font-weight: 600; }
.gex-cell-wt { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--prizma-text-primary); }
.gex-cell-period { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; white-space: nowrap; }
.gex-bucket-pill {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 11px; font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
/* V21 — bucket pills и status colors через signal-tokens с fallback hex
   (export — standalone document, theme.css не инжектируется, var() даёт
   значение когда styles.css доступен, fallback — когда нет). */
.gex-bucket-120 { background: var(--prizma-information-bg, #dbeafe); color: var(--prizma-information, #1e40af); }
.gex-bucket-121 { background: var(--prizma-on-course-bg, #d1fae5); color: var(--prizma-on-course, #065f46); }
.gex-bucket-122 { background: var(--prizma-drift-bg, #fef3c7); color: var(--prizma-drift, #92400e); }
.gex-bucket-OT  { background: var(--prizma-off-course-bg, #fee2e2); color: var(--prizma-off-course, #991b1b); }
.gex-status { font-weight: 600; font-size: 11px; }
.gex-status-done      { color: var(--prizma-on-course, #059669); }
.gex-status-active    { color: var(--prizma-information, #2563eb); }
.gex-status-unplanned { color: var(--prizma-drift, #b45309); }
`;

/* Roadmap-mode overrides: упрощённый pill (только wt-название + stripe),
   без assignee-summary / trail-rows / arrows / state-glyph / progress.
   Применяется через body[data-export-mode="roadmap"]. */
const _ROADMAP_CSS = `
body[data-export-mode="roadmap"] .gdt-pill-row-2,
body[data-export-mode="roadmap"] .gdt-pill-state,
body[data-export-mode="roadmap"] .gdt-pill-initials,
body[data-export-mode="roadmap"] .gdt-pill-cmt-marker,
body[data-export-mode="roadmap"] .gdt-pill-progress,
body[data-export-mode="roadmap"] .gantt-row-trail,
body[data-export-mode="roadmap"] .gdt-arrows-svg,
body[data-export-mode="roadmap"] .gdt-rail-flow,
body[data-export-mode="roadmap"] .gdt-rail-dist,
body[data-export-mode="roadmap"] .v16-epic-deps-badge,
body[data-export-mode="roadmap"] .gdt-pill-legend,
body[data-export-mode="roadmap"] .gantt-legend,
body[data-export-mode="roadmap"] #gex-current-release-btn { display: none !important; }
body[data-export-mode="roadmap"] .gantt-type-pill {
  padding: 4px 8px; font-size: 12px; min-height: 22px;
}
body[data-export-mode="roadmap"] .gantt-row { min-height: 30px; }
body[data-export-mode="roadmap"] .gex-page-title::after { content: ' — Roadmap'; }
`;

async function _buildHtml(opts = {}) {
  const isRoadmap = opts.mode === 'roadmap';
  const wrap = document.getElementById('gantt-wrap');
  if (!wrap || !wrap.firstChild) {
    window.showToast?.('Сначала откройте вкладку «Гант» — экспортируется текущее представление', 'info', 3000);
    return '';
  }
  const cloned = wrap.cloneNode(true);
  _stripInteractive(cloned);
  // Roadmap mode — заодно убираем today-line overlay из клона
  // (он был absolute-positioned и в экспорте теряет привязку к bbox).
  if (isRoadmap) {
    cloned.querySelectorAll('.gdt-today-line, .gantt-row-trail, .gdt-arrows-svg').forEach(el => el.remove());
  }

  let cssText = '';
  try {
    const res = await fetch('styles.css');
    if (res.ok) cssText = await res.text();
  } catch (_) { /* fall back to baseline if styles.css unreachable */ }

  const rows = state.rows || [];
  const teamCount = new Set(rows.map(r => r.team || '—').filter(Boolean)).size || 0;
  const doneCount = rows.filter(r => r.isDone).length;
  const lockBadge = state.planLocked
    ? `<span class="gex-readonly-badge" style="background:var(--prizma-drift-bg,#fef3c7);color:var(--prizma-drift-fg,#78350f);border-color:var(--prizma-drift,#f59e0b);">${gexIcon("lock")} План зафиксирован — ${esc(new Date(state.planLocked.at).toLocaleString('ru'))}</span>`
    : '';
  const summaryHtml    = isRoadmap ? '' : _buildAssigneeSummary(rows);
  const unassignedHtml = isRoadmap ? '' : _buildUnassignedSummary(rows);
  const legendHtml     = isRoadmap ? '' : _buildLegend();
  const title          = isRoadmap ? 'Призма — Roadmap' : 'Призма — Гант';
  const bodyAttr       = isRoadmap ? ' data-export-mode="roadmap"' : '';
  const arrowsScript   = isRoadmap ? '' : `<script>${_REDRAW_ARROWS_JS}</script>`;
  const releaseScript  = isRoadmap ? '' : `<script>${_CURRENT_RELEASE_JS}</script>`;
  const releaseBtn     = isRoadmap ? ''
    : `<button id="gex-current-release-btn" type="button" title="Показать только текущий релиз и Овертайм">Текущий релиз</button>`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(title)} · ${esc(new Date().toLocaleString('ru'))}</title>
<style>${_BASELINE_CSS}</style>
<style>${cssText}</style>
<style>${_ROADMAP_CSS}
.gantt-pill { cursor: default !important; }
.gantt-pill:hover { transform: none !important; }
.gantt-cell { cursor: default !important; }
.gex-chev { color: var(--prizma-text-secondary); }
.gex-chev:hover { color: inherit !important; }

.gex-legend-details { background: var(--prizma-bg-elevated); border: 1px solid var(--prizma-border); border-radius: 10px; margin: 12px 0; overflow: hidden; }
body.theme-dark .gex-legend-details { background: var(--prizma-bg-elevated); border-color: var(--prizma-border); }
.gex-legend-summary {
  cursor: pointer; user-select: none;
  padding: 10px 16px; font-size: 11px; font-weight: 700;
  letter-spacing: .6px; text-transform: uppercase;
  color: var(--prizma-text-secondary); list-style: none;
  display: flex; align-items: center; gap: 8px;
}
.gex-legend-summary::-webkit-details-marker { display: none; }
.gex-legend-summary::before {
  content: '▾'; transition: transform .15s; font-size: 10px;
}
.gex-legend-details:not([open]) .gex-legend-summary::before { transform: rotate(-90deg); }
.gex-legend-details .gex-legend { margin: 0; border: 0; border-top: 1px solid var(--prizma-border); border-radius: 0; }

#gex-current-release-btn {
  margin-left: 4px;
  padding: 6px 12px; border: 1px solid var(--prizma-border-strong, var(--prizma-border)); background: transparent; color: inherit;
  border-radius: 8px; font-size: 12px; cursor: pointer;
  transition: background .14s, border-color .14s, color .14s;
}
#gex-current-release-btn:hover { background: rgba(127,127,127,.1); }
#gex-current-release-btn.active { background: var(--prizma-information); color: #fff; border-color: var(--prizma-information); }
</style>
</head>
<body${bodyAttr}>
<div class="gex-page-header">
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
    <div class="gex-page-title">Призма — Гант</div>
    <span class="gex-readonly-badge">Только просмотр</span>
    ${lockBadge}
    <button id="gex-theme-btn" type="button" title="Переключить тему">${gexIcon("moon")} Тёмная</button>
    ${releaseBtn}
  </div>
  <div class="gex-page-meta">
    <span class="gex-meta-item">${gexIcon("calendar")} ${esc(new Date().toLocaleString('ru'))}</span>
    <span class="gex-meta-item">${gexIcon("clipboard")} <span class="gex-meta-num">${rows.length}</span> задач</span>
    <span class="gex-meta-item">${gexIcon("users")} <span class="gex-meta-num">${teamCount}</span> команд</span>
    <span class="gex-meta-item">${gexIcon("check-circle")} <span class="gex-meta-num">${doneCount}</span> завершено</span>
  </div>
</div>
${legendHtml}
<div class="gex-card">${cloned.outerHTML}</div>
${summaryHtml}
${unassignedHtml}
<script>${_THEME_JS}</script>
<script>${_COLLAPSE_JS}</script>
${arrowsScript}
${releaseScript}
</body>
</html>`;
}

export const GanttHTMLExport = {
  async download() {
    const html = await GanttHTMLExport.build();
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gantt_${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
    window.showToast?.('Гант экспортирован в HTML', 'success', 2200);
  },
  build(opts) { return _buildHtml(opts); },
};

export const GanttRoadmapHTMLExport = {
  async download() {
    const html = await _buildHtml({ mode: 'roadmap' });
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roadmap_${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
    window.showToast?.('Дорожная карта экспортирована в HTML', 'success', 2200);
  },
  build(opts) { return _buildHtml({ ...(opts || {}), mode: 'roadmap' }); },
};

// V15 testing surface — pure helpers exposed for unit tests. Browser code
// continues to use the default `GanttHTMLExport` API.
export const __testing = { _splitTags, _buildAssigneeSummary, _buildUnassignedSummary, _buildLegend };
