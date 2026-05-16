'use strict';
/* ============================================================
   integrations/release2/release2Renderer.js — V22+ (Release 2.0)

   HTML rendering для list-view + expand-panel.

   Не side-effects'ный — pure HTML string builder. Event-handling
   живёт в release2.js orchestrator'е через delegation.

   Public API:
     renderRelease2View(analysed, state, opts?) → string (full view HTML)
     renderExpandPanel(release, opts?) → string (expand-content HTML)
     escapeHtml(s) → string
   ============================================================ */

import { SECTIONS, FIELD_BY_KEY, STATUS_ORDER, STATUS_PHASES, RISK_LEVELS, RELEASE_TYPES } from './release2Fields.js';

/* ─────────────────────────────────────────────────────────────
   Escape / helpers
   ───────────────────────────────────────────────────────────── */

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _fmtDate(iso, opts = {}) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const mo  = String(d.getMonth() + 1).padStart(2, '0');
  if (opts.withTime) {
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${day}.${mo}.${d.getFullYear()} ${h}:${m}`;
  }
  return `${day}.${mo}.${d.getFullYear()}`;
}

function _daysLeft(iso) {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  return Math.ceil((ts - Date.now()) / 86400_000);
}

function _userLabel(u) {
  if (!u) return '—';
  return u.displayName || u.name || u.email || '—';
}

function _phaseColor(phase) {
  switch (phase) {
    case 'creation':  return 'r2-phase-neutral';
    case 'stabilize': return 'r2-phase-stabilize';
    case 'uat':       return 'r2-phase-uat';
    case 'approve':   return 'r2-phase-approve';
    case 'deploy':    return 'r2-phase-deploy';
    case 'cancel':    return 'r2-phase-cancel';
    default:          return 'r2-phase-neutral';
  }
}

function _riskClass(level) {
  if (!level) return 'r2-risk-none';
  if (level === 'Низкий') return 'r2-risk-low';
  if (level === 'Средний') return 'r2-risk-mid';
  if (level === 'Высокий') return 'r2-risk-high';
  if (level === 'Высокий+') return 'r2-risk-high-plus';
  if (level === 'Неприемлемый') return 'r2-risk-block';
  return 'r2-risk-none';
}

/* ─────────────────────────────────────────────────────────────
   Top-level view
   ───────────────────────────────────────────────────────────── */

/**
 * @param {object} analysed — output analyseRelease2List + extras (jql, projectKeys)
 * @param {object} state    — release2State current
 * @param {object} opts     — { jiraBaseUrl?, prevList? }
 */
export function renderRelease2View(analysed, state, opts = {}) {
  const parts = [];
  parts.push(_renderToolbar(analysed, state));
  // V22+ Phase 5 (Доп #9) — diff-banner подаётся в opts.prevDiff из
  // orchestrator'а (он вычисляет через diffRelease2Lists). Если null —
  // banner не рендерится.
  parts.push(_renderDiffBanner(opts.prevDiff, analysed?.fetchedAt));
  parts.push(_renderStatBar(analysed));
  parts.push(_renderOwnersCard(analysed, state));
  parts.push(_renderSmartPresets(state));
  parts.push(_renderFilters(analysed, state));
  parts.push(_renderListBody(analysed, state, opts));
  parts.push(_renderFooter(analysed));
  return `<div class="r2-view">${parts.join('')}</div>`;
}

/* ─────────────────────────────────────────────────────────────
   Toolbar (refresh button + last-fetched + group-by)
   ───────────────────────────────────────────────────────────── */

function _renderToolbar(analysed, state) {
  const fetched = analysed?.fetchedAt
    ? `<span class="r2-toolbar-fetched">обновлено: ${_fmtDate(analysed.fetchedAt, { withTime: true })}</span>`
    : '';
  const total = analysed?.stats?.total || 0;

  return `
    <div class="r2-toolbar">
      <div class="r2-toolbar-left">
        <h2 class="r2-toolbar-title">Release 2.0</h2>
        <span class="r2-toolbar-count">${total} ${_pl(total, ['релиз','релиза','релизов'])}</span>
        ${fetched}
      </div>
      <div class="r2-toolbar-right">
        <div class="r2-groupby">
          ${_groupByChip('project', 'По проекту', state.groupBy)}
          ${_groupByChip('status',  'По статусу', state.groupBy)}
          ${_groupByChip('owner',   'По владельцу', state.groupBy)}
          ${_groupByChip('flat',    'Плоский', state.groupBy)}
        </div>
        <button class="r2-btn r2-btn-secondary" data-r2-action="export-md" title="Экспорт текущего вида в Markdown">⤓ MD</button>
        <button class="r2-btn r2-btn-primary" data-r2-action="refresh">↻ Обновить</button>
      </div>
    </div>`;
}

function _groupByChip(value, label, current) {
  const active = current === value;
  return `<button class="r2-groupby-chip${active ? ' r2-groupby-chip-active' : ''}" data-r2-groupby="${value}">${escapeHtml(label)}</button>`;
}

/* ─────────────────────────────────────────────────────────────
   Stat-bar (Доп предложение #1)
   ───────────────────────────────────────────────────────────── */

function _renderStatBar(analysed) {
  const s = analysed?.stats;
  if (!s || !s.total) return '';
  return `
    <div class="r2-statbar">
      <div class="r2-stat r2-stat-total"          data-r2-filter-phase="">
        <div class="r2-stat-num">${s.total}</div>
        <div class="r2-stat-label">всего</div>
      </div>
      <div class="r2-stat r2-stat-deploy"          data-r2-filter-phase="deploy">
        <div class="r2-stat-num">${s.byPhase.deploy || 0}</div>
        <div class="r2-stat-label">готов к ПРОМ</div>
      </div>
      <div class="r2-stat r2-stat-approve"         data-r2-filter-phase="approve">
        <div class="r2-stat-num">${s.byPhase.approve || 0}</div>
        <div class="r2-stat-label">ППСИ</div>
      </div>
      <div class="r2-stat r2-stat-uat"             data-r2-filter-phase="uat">
        <div class="r2-stat-num">${s.byPhase.uat || 0}</div>
        <div class="r2-stat-label">ПСИ</div>
      </div>
      <div class="r2-stat r2-stat-stabilize"       data-r2-filter-phase="stabilize">
        <div class="r2-stat-num">${s.byPhase.stabilize || 0}</div>
        <div class="r2-stat-label">стабилизация</div>
      </div>
      <div class="r2-stat r2-stat-creation"        data-r2-filter-phase="creation">
        <div class="r2-stat-num">${s.byPhase.creation || 0}</div>
        <div class="r2-stat-label">в работе</div>
      </div>
      ${s.upcomingUAT ? `<div class="r2-stat r2-stat-alert">
        <div class="r2-stat-num">${s.upcomingUAT}</div>
        <div class="r2-stat-label">скоро ПСИ (≤3д)</div>
      </div>` : ''}
      ${s.upcomingProd ? `<div class="r2-stat r2-stat-alert">
        <div class="r2-stat-num">${s.upcomingProd}</div>
        <div class="r2-stat-label">скоро ПРОМ (≤7д)</div>
      </div>` : ''}
    </div>`;
}

/* ─────────────────────────────────────────────────────────────
   Smart presets (Доп. предложение #10)
   ───────────────────────────────────────────────────────────── */

function _renderSmartPresets(state) {
  const cur = state.filters.smartPreset || '';
  const presets = [
    { id: '',                label: 'Все' },
    { id: 'uat-soon',        label: 'Скоро ПСИ (≤3д)' },
    { id: 'prod-soon',       label: 'Скоро ПРОМ (≤7д)' },
    { id: 'high-risk',       label: 'Высокий риск' },
    { id: 'high-risk-plus',  label: 'Высокий+/Неприемлемый' },
    { id: 'no-rov',          label: 'Без РоВ' },
  ];
  return `
    <div class="r2-presets">
      <span class="r2-presets-label">Быстро:</span>
      ${presets.map(p => `<button class="r2-preset${cur === p.id ? ' r2-preset-active' : ''}" data-r2-preset="${p.id}">${escapeHtml(p.label)}</button>`).join('')}
    </div>`;
}

/* ─────────────────────────────────────────────────────────────
   Filters
   ───────────────────────────────────────────────────────────── */

function _renderFilters(analysed, state) {
  const projects = Array.from(analysed.byProject?.keys() || []).sort();
  const statuses = STATUS_ORDER;
  const types = RELEASE_TYPES;
  const risks = RISK_LEVELS;
  const f = state.filters;

  return `
    <div class="r2-filters">
      <input type="search" class="r2-filter-search" placeholder="Поиск по теме, ключу, КЭ…" value="${escapeHtml(f.searchText || '')}" data-r2-search>

      <select class="r2-filter-select" data-r2-filter="projects" multiple title="Проектные области">
        ${projects.map(p => `<option value="${escapeHtml(p)}" ${(f.projectKeys || []).includes(p) ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('')}
      </select>

      <select class="r2-filter-select" data-r2-filter="statuses" multiple title="Статус">
        ${statuses.map(s => `<option value="${escapeHtml(s)}" ${(f.statuses || []).includes(s) ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
      </select>

      <select class="r2-filter-select" data-r2-filter="types" multiple title="Тип релиза">
        ${types.map(t => `<option value="${escapeHtml(t)}" ${(f.types || []).includes(t) ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
      </select>

      <select class="r2-filter-select" data-r2-filter="risks" multiple title="Риск">
        ${risks.map(r => `<option value="${escapeHtml(r)}" ${(f.risks || []).includes(r) ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('')}
      </select>

      <button class="r2-btn r2-btn-ghost" data-r2-action="filters-reset" title="Сбросить фильтры">×</button>
    </div>`;
}

/* ─────────────────────────────────────────────────────────────
   Diff banner (Доп. #9)
   ───────────────────────────────────────────────────────────── */

/**
 * @param {object|null} diff — output diffRelease2Lists (added/removed/changed)
 * @param {string} fetchedAt — для dismiss-tracking (banner закрывается per-fetch)
 */
function _renderDiffBanner(diff, fetchedAt) {
  if (!diff) return '';
  const total = (diff.added?.length || 0) + (diff.removed?.length || 0) + (diff.changed?.length || 0);
  if (!total) return '';

  // Top-level summary
  const summaryParts = [];
  if (diff.added?.length)   summaryParts.push(`<strong class="r2-diff-num r2-diff-added">+${diff.added.length}</strong> ${_pl(diff.added.length, ['новый', 'новых', 'новых'])}`);
  if (diff.changed?.length) summaryParts.push(`<strong class="r2-diff-num r2-diff-changed">~${diff.changed.length}</strong> ${_pl(diff.changed.length, ['изменён', 'изменено', 'изменено'])}`);
  if (diff.removed?.length) summaryParts.push(`<strong class="r2-diff-num r2-diff-removed">−${diff.removed.length}</strong> ${_pl(diff.removed.length, ['удалён', 'удалено', 'удалено'])}`);

  // Detail lines
  const lines = [];

  // ADDED — список новых
  if (diff.added?.length) {
    const sample = diff.added.slice(0, 5).map(r => `<span class="r2-diff-item r2-diff-item-added"><span class="r2-key">${escapeHtml(r.key)}</span> ${escapeHtml((r.summary || '').slice(0, 60))} <span class="r2-diff-tag">${escapeHtml(r.status)}</span></span>`).join('');
    const more = diff.added.length > 5 ? ` <span class="r2-diff-more">и ещё ${diff.added.length - 5}</span>` : '';
    lines.push(`<div class="r2-diff-section"><div class="r2-diff-label">Новые:</div><div class="r2-diff-items">${sample}${more}</div></div>`);
  }

  // CHANGED — по типу изменения
  if (diff.changed?.length) {
    // Группируем по полю
    const byField = new Map();
    for (const c of diff.changed) {
      for (const d of c.deltas) {
        const arr = byField.get(d.field) || [];
        arr.push({ key: c.key, summary: c.current?.summary || '', delta: d });
        byField.set(d.field, arr);
      }
    }
    const fieldLabels = {
      status: 'Сменился статус',
      priority: 'Изменился приоритет',
      riskAuto: 'Пересчитан риск',
      planProdEnd: 'Изменена дата ПРОМ',
      partOfCount: 'Изменился состав (Stories)',
    };
    for (const [field, items] of byField) {
      const label = fieldLabels[field] || field;
      const sample = items.slice(0, 4).map(it => {
        const fromTo = `<span class="r2-diff-fromto">${escapeHtml(String(it.delta.from || '—'))} → ${escapeHtml(String(it.delta.to || '—'))}</span>`;
        return `<span class="r2-diff-item r2-diff-item-changed"><span class="r2-key">${escapeHtml(it.key)}</span> ${fromTo}</span>`;
      }).join('');
      const more = items.length > 4 ? ` <span class="r2-diff-more">и ещё ${items.length - 4}</span>` : '';
      lines.push(`<div class="r2-diff-section"><div class="r2-diff-label">${escapeHtml(label)}:</div><div class="r2-diff-items">${sample}${more}</div></div>`);
    }
  }

  // REMOVED — список удалённых
  if (diff.removed?.length) {
    const sample = diff.removed.slice(0, 5).map(r => `<span class="r2-diff-item r2-diff-item-removed"><span class="r2-key">${escapeHtml(r.key)}</span> ${escapeHtml((r.summary || '').slice(0, 60))}</span>`).join('');
    const more = diff.removed.length > 5 ? ` <span class="r2-diff-more">и ещё ${diff.removed.length - 5}</span>` : '';
    lines.push(`<div class="r2-diff-section"><div class="r2-diff-label">Удалены / перешли в терминальный статус:</div><div class="r2-diff-items">${sample}${more}</div></div>`);
  }

  return `
    <div class="r2-diff-banner" data-r2-fetched-at="${escapeHtml(fetchedAt || '')}">
      <div class="r2-diff-header">
        <div class="r2-diff-summary">
          <span class="r2-diff-icon" aria-hidden="true">↻</span>
          <span class="r2-diff-title">За последний refresh:</span>
          ${summaryParts.join(' · ')}
        </div>
        <button class="r2-diff-dismiss" data-r2-action="diff-dismiss" title="Скрыть до следующего обновления" aria-label="Скрыть">×</button>
      </div>
      <details class="r2-diff-details" open>
        <summary class="r2-diff-details-summary">Подробнее</summary>
        <div class="r2-diff-body">${lines.join('')}</div>
      </details>
    </div>`;
}

/* ─────────────────────────────────────────────────────────────
   Owners card (Доп. #7)
   ───────────────────────────────────────────────────────────── */

function _renderOwnersCard(analysed, state) {
  if (!analysed?.releases?.length) return '';
  // Аггрегируем по «владельцу» — Организатор ПСИ (приоритетно) или Assignee.
  const byOwner = new Map();
  for (const r of analysed.releases) {
    const owner = r.organizer || r.assignee;
    if (!owner) continue;
    const name = owner.displayName || owner.name || owner.email || '—';
    const email = owner.email || '';
    const key = email || name;
    const entry = byOwner.get(key) || { key, name, email, total: 0, byPhase: {} };
    entry.total++;
    entry.byPhase[r._phase] = (entry.byPhase[r._phase] || 0) + 1;
    byOwner.set(key, entry);
  }
  if (!byOwner.size) return '';

  // Top-6 по количеству
  const sorted = Array.from(byOwner.values()).sort((a, b) => b.total - a.total).slice(0, 6);
  const currentActive = (state.filters?.owner || '') === '__active__';   // Reserved для будущего

  // Group-by=owner shortcut
  const ownersGroupActive = state.groupBy === 'owner';

  return `
    <div class="r2-owners-card">
      <div class="r2-owners-header">
        <div class="r2-owners-title">Владельцы релизов</div>
        <button class="r2-btn r2-btn-ghost r2-owners-group-toggle${ownersGroupActive ? ' r2-owners-group-active' : ''}" data-r2-groupby="owner" title="Перейти на группировку по владельцу">
          ${ownersGroupActive ? '· По владельцу ·' : 'Группировать'}
        </button>
      </div>
      <div class="r2-owners-list">
        ${sorted.map(o => _renderOwnerChip(o)).join('')}
      </div>
    </div>`;
}

function _renderOwnerChip(o) {
  const initials = _initials(o.name);
  // mini phase-distribution dots (max 4 phases)
  const phaseDots = ['creation', 'stabilize', 'uat', 'approve', 'deploy'].map(ph => {
    const n = o.byPhase[ph] || 0;
    if (!n) return '';
    return `<span class="r2-owner-phase-dot r2-phase-dot-${ph}" title="${escapeHtml(_phaseLabel(ph))}: ${n}">${n}</span>`;
  }).join('');
  return `
    <div class="r2-owner-chip" title="${escapeHtml(o.email || o.name)}">
      <span class="r2-owner-avatar">${escapeHtml(initials)}</span>
      <span class="r2-owner-body">
        <span class="r2-owner-name">${escapeHtml(o.name)}</span>
        <span class="r2-owner-stats">${o.total} ${_pl(o.total, ['релиз', 'релиза', 'релизов'])}</span>
      </span>
      <span class="r2-owner-phases">${phaseDots}</span>
    </div>`;
}

function _initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function _phaseLabel(ph) {
  return {
    creation:  'Создание',
    stabilize: 'Стабилизация',
    uat:       'ПСИ',
    approve:   'ППСИ',
    deploy:    'К ПРОМ',
    cancel:    'Отменено',
  }[ph] || ph;
}

/* ─────────────────────────────────────────────────────────────
   List body — c учётом filtering / sorting / grouping
   ───────────────────────────────────────────────────────────── */

function _renderListBody(analysed, state, opts = {}) {
  const filtered = _applyFilters(analysed.releases || [], state.filters);
  if (!filtered.length) {
    return `<div class="r2-empty">Нет релизов под текущие фильтры. Попробуйте сбросить.</div>`;
  }

  // Sort
  const sorted = _sortList(filtered, state.sort);

  // Group
  if (state.groupBy === 'flat') {
    return `<div class="r2-list">${sorted.map(r => _renderReleaseRow(r, state, opts)).join('')}</div>`;
  }
  const groups = _groupList(sorted, state.groupBy);
  const groupKeys = Array.from(groups.keys()).sort((a, b) => _sortGroupKeys(a, b, state.groupBy));

  return `<div class="r2-list">${groupKeys.map(gk => _renderGroup(gk, groups.get(gk), state, opts)).join('')}</div>`;
}

function _applyFilters(list, f) {
  const text = (f.searchText || '').toLowerCase().trim();
  const projects = new Set(f.projectKeys || []);
  const statuses = new Set(f.statuses || []);
  const types = new Set(f.types || []);
  const risks = new Set(f.risks || []);
  const preset = f.smartPreset || '';

  return list.filter(r => {
    if (projects.size && !projects.has(r.project?.name || r.project?.key)) return false;
    if (statuses.size && !statuses.has(r.status)) return false;
    if (types.size && !types.has(r.type)) return false;
    if (risks.size) {
      const k = r.riskAuto || r.riskLevel;
      if (!k || !risks.has(k)) return false;
    }
    if (text) {
      const haystack = [
        r.key, r.summary, r.project?.name,
        ...(r.configElement || []).map(c => c.value),
        ...(r.service || []).map(s => s.value),
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    if (preset === 'uat-soon') {
      if (!(r._flags || []).some(fl => fl.kind === 'uat-soon')) return false;
    } else if (preset === 'prod-soon') {
      if (!(r._flags || []).some(fl => fl.kind === 'prod-soon')) return false;
    } else if (preset === 'high-risk') {
      if ((r._riskRank || 0) < 3) return false;
    } else if (preset === 'high-risk-plus') {
      if ((r._riskRank || 0) < 4) return false;
    } else if (preset === 'no-rov') {
      // У релиза нет РоВ-связи (Introduction Order)
      const outward = r._links?.outward || [];
      const hasROV = outward.some(o => /Introduction Order/i.test(o.linkType));
      if (hasROV) return false;
    }
    return true;
  });
}

function _sortList(list, sort) {
  const arr = list.slice();
  if (sort === 'priority') {
    const order = ['Blocker', 'Critical', 'Major', 'Minor', 'Trivial'];
    arr.sort((a, b) => (order.indexOf(a.priority) - order.indexOf(b.priority)) || (a._statusOrderIndex - b._statusOrderIndex));
  } else if (sort === 'planProdEnd') {
    arr.sort((a, b) => {
      const ta = Date.parse(a.dates?.planProdEnd || '') || Infinity;
      const tb = Date.parse(b.dates?.planProdEnd || '') || Infinity;
      return ta - tb;
    });
  } else if (sort === 'updated') {
    arr.sort((a, b) => Date.parse(b.updated || '') - Date.parse(a.updated || ''));
  } else if (sort === 'status') {
    arr.sort((a, b) => a._statusOrderIndex - b._statusOrderIndex);
  }
  return arr;
}

function _groupList(list, groupBy) {
  const out = new Map();
  const keyFn = (r) => {
    if (groupBy === 'project') return r.project?.name || r.project?.key || '—';
    if (groupBy === 'status')  return r.status || '—';
    if (groupBy === 'owner')   return r.organizer?.displayName || r.assignee?.displayName || '—';
    return '—';
  };
  for (const r of list) {
    const k = keyFn(r);
    const arr = out.get(k) || [];
    arr.push(r);
    out.set(k, arr);
  }
  return out;
}

function _sortGroupKeys(a, b, groupBy) {
  if (groupBy === 'status') {
    return STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b);
  }
  return a.localeCompare(b, 'ru');
}

function _renderGroup(key, items, state, opts) {
  return `
    <div class="r2-group">
      <div class="r2-group-header">
        <span class="r2-group-name">${escapeHtml(key)}</span>
        <span class="r2-group-count">${items.length}</span>
      </div>
      <div class="r2-group-body">
        ${items.map(r => _renderReleaseRow(r, state, opts)).join('')}
      </div>
    </div>`;
}

/* ─────────────────────────────────────────────────────────────
   Release row (collapsed + expanded)
   ───────────────────────────────────────────────────────────── */

function _renderReleaseRow(r, state, opts) {
  const expanded = state.expandedKeys.has(r.key);
  const phaseClass = _phaseColor(r._phase);
  const riskClass  = _riskClass(r.riskAuto || r.riskLevel);
  const planProd = _fmtDate(r.dates?.planProdEnd);
  const flagsHtml = (r._flags || []).map(f => {
    if (f.kind === 'uat-soon') return `<span class="r2-flag r2-flag-uat">скоро ПСИ ${f.daysLeft}д</span>`;
    if (f.kind === 'prod-soon') return `<span class="r2-flag r2-flag-prod">скоро ПРОМ ${f.daysLeft}д</span>`;
    if (f.kind === 'fpd-blocked') return `<span class="r2-flag r2-flag-fpd">ждёт ФПД</span>`;
    return '';
  }).join('');

  const kg = (r.configElement || []).map(c => c.value).join(', ') || '—';

  return `
    <div class="r2-row ${phaseClass}${expanded ? ' r2-row-expanded' : ''}" data-r2-key="${escapeHtml(r.key)}">
      <div class="r2-row-head" data-r2-toggle="${escapeHtml(r.key)}">
        <span class="r2-risk-dot ${riskClass}" title="Риск: ${escapeHtml(r.riskAuto || r.riskLevel || '—')}"></span>
        <span class="r2-key">${escapeHtml(r.key)}</span>
        <span class="r2-summary">${escapeHtml(r.summary)}</span>
        <span class="r2-status r2-status-${r._phase}">${escapeHtml(r.status)}</span>
        <span class="r2-priority r2-priority-${escapeHtml((r.priority || '').toLowerCase())}">${escapeHtml(r.priority || '—')}</span>
        <span class="r2-ke" title="${escapeHtml(kg)}">${escapeHtml(kg.length > 40 ? kg.slice(0, 40) + '…' : kg)}</span>
        <span class="r2-date">${escapeHtml(planProd)}</span>
        ${flagsHtml}
        <span class="r2-row-chevron" aria-hidden="true">${expanded ? '▾' : '▸'}</span>
      </div>
      ${expanded ? `<div class="r2-row-body" data-r2-key="${escapeHtml(r.key)}">${renderExpandPanel(r, state, opts)}</div>` : ''}
    </div>`;
}

/* ─────────────────────────────────────────────────────────────
   Expand panel — 6 tabs
   ───────────────────────────────────────────────────────────── */

const TABS = [
  { id: 'attrs',    label: 'Атрибуты' },
  { id: 'compose',  label: 'Состав' },
  { id: 'ppsi',     label: 'ПСИ' },
  { id: 'rov',      label: 'РоВ' },
  { id: 'dates',    label: 'Даты' },
  { id: 'attach',   label: 'Вложения' },
];

export function renderExpandPanel(r, state, opts = {}) {
  const tab = state.getExpandedTab ? state.getExpandedTab(r.key) : 'attrs';
  const tabsHtml = TABS.map(t => `
    <button class="r2-tab${t.id === tab ? ' r2-tab-active' : ''}" data-r2-tab="${t.id}" data-r2-key="${escapeHtml(r.key)}">${escapeHtml(t.label)}</button>
  `).join('');

  let bodyHtml;
  switch (tab) {
    case 'compose': bodyHtml = _renderTabCompose(r, state); break;
    case 'ppsi':    bodyHtml = _renderTabPpsi(r); break;
    case 'rov':     bodyHtml = _renderTabRov(r); break;
    case 'dates':   bodyHtml = _renderTabDates(r); break;
    case 'attach':  bodyHtml = _renderTabAttachments(r); break;
    default:        bodyHtml = _renderTabAttrs(r);
  }

  const jiraUrl = opts.jiraBaseUrl ? `${opts.jiraBaseUrl.replace(/\/$/, '')}/browse/${encodeURIComponent(r.key)}` : '';
  const externalLink = jiraUrl
    ? `<a class="r2-external-link" href="${escapeHtml(jiraUrl)}" target="_blank" rel="noopener noreferrer">Открыть в Jira ↗</a>`
    : '';

  return `
    <div class="r2-expand">
      <div class="r2-tabs">
        ${tabsHtml}
        <div class="r2-tabs-spacer"></div>
        ${externalLink}
      </div>
      <div class="r2-tab-body">${bodyHtml}</div>
    </div>`;
}

function _renderTabAttrs(r) {
  // 4 секции: main / general / testing / risk
  const sectionsToShow = ['main', 'general', 'testing', 'risk'];
  return sectionsToShow.map(sk => {
    const meta = SECTIONS.find(s => s.key === sk);
    return _renderSection(r, meta);
  }).filter(Boolean).join('');
}

function _renderSection(r, sectionMeta) {
  if (!sectionMeta) return '';
  const fields = Object.values(FIELD_BY_KEY).filter(f => f.section === sectionMeta.key);
  const rows = fields.map(f => {
    const v = r[f.key];
    if (v === null || v === undefined || v === '' ||
        (Array.isArray(v) && v.length === 0)) return null;
    return `<div class="r2-field"><span class="r2-field-label">${escapeHtml(f.label)}</span><span class="r2-field-value">${_renderValue(v, f.kind)}</span></div>`;
  }).filter(Boolean);
  if (!rows.length) return '';
  return `<div class="r2-section"><div class="r2-section-title">${escapeHtml(sectionMeta.label)}</div>${rows.join('')}</div>`;
}

function _renderTabPpsi(r) {
  const meta = SECTIONS.find(s => s.key === 'ppsi');
  const fpd  = SECTIONS.find(s => s.key === 'fpd');
  return _renderSection(r, meta) + _renderSection(r, fpd);
}

function _renderTabCompose(r, state) {
  const partOf = r._links?.partOf || [];
  const bugs = r._links?.bugs || [];
  const cloners = r._links?.cloners || [];
  const subtasks = r._subtasks || [];

  const lazyHint = state?.getRelated && !state.getRelated(r.key)
    ? `<button class="r2-btn r2-btn-ghost" data-r2-action="related-load" data-r2-key="${escapeHtml(r.key)}">↻ Подгрузить детали</button>`
    : '';

  return `
    ${_renderLinkedList('Состав (Stories)', partOf)}
    ${_renderLinkedList('Дефекты (Bugs)', bugs)}
    ${cloners.length ? _renderLinkedList('Клоны (Cloners)', cloners) : ''}
    ${subtasks.length ? `<div class="r2-section">
      <div class="r2-section-title">Подзадачи ПСИ</div>
      ${subtasks.map(s => `
        <div class="r2-sublink">
          <span class="r2-sublink-key">${escapeHtml(s.key)}</span>
          <span class="r2-sublink-summary">${escapeHtml(s.summary)}</span>
          <span class="r2-sublink-status">${escapeHtml(s.status)}</span>
          ${s.assignee ? `<span class="r2-sublink-assignee">${escapeHtml(_userLabel(s.assignee))}</span>` : ''}
        </div>
      `).join('')}
    </div>` : ''}
    ${lazyHint}
  `;
}

function _renderLinkedList(title, items) {
  if (!items?.length) return '';
  return `<div class="r2-section">
    <div class="r2-section-title">${escapeHtml(title)} (${items.length})</div>
    ${items.map(i => `
      <div class="r2-sublink">
        <span class="r2-sublink-key">${escapeHtml(i.key)}</span>
        <span class="r2-sublink-summary">${escapeHtml(i.summary || '')}</span>
        <span class="r2-sublink-status">${escapeHtml(i.status || '')}</span>
        ${i.priority ? `<span class="r2-sublink-priority">${escapeHtml(i.priority)}</span>` : ''}
      </div>
    `).join('')}
  </div>`;
}

function _renderTabRov(r) {
  const out = (r._links?.outward || []).filter(l => /Introduction Order/i.test(l.linkType));
  if (!out.length) {
    return `<div class="r2-empty-tab">РоВ ещё не создан или не привязан к этому релизу.</div>`;
  }
  return _renderLinkedList('РоВ (Introduction Order)', out);
}

function _renderTabDates(r) {
  const d = r.dates || {};
  const items = [
    { k: 'planFixation',    label: 'Фиксация релиза' },
    { k: 'planIFTStart',    label: 'Начало ИФТ (план)' },
    { k: 'planIFTEnd',      label: 'Окончание ИФТ (план)' },
    { k: 'planNTStart',     label: 'НТ начало (план)' },
    { k: 'planNTEnd',       label: 'НТ окончание (план)' },
    { k: 'planRegression',  label: 'Начало регресса (план)' },
    { k: 'planUATStart',    label: 'Начало ПСИ (план)' },
    { k: 'planUATEnd',      label: 'Окончание ПСИ (план)' },
    { k: 'planDeployStart', label: 'Начало внедрения (план)' },
    { k: 'planProdEnd',     label: 'Завершение в ПРОМ (план)' },
    { k: 'factUATStart',    label: 'Начало ПСИ (факт)' },
    { k: 'factUATEnd',      label: 'Окончание ПСИ (факт)' },
    { k: 'factProdDate',    label: 'Установка в ПРОМ (факт)' },
  ];
  return `<div class="r2-section"><div class="r2-section-title">Сроки</div>
    ${items.map(it => `
      <div class="r2-field">
        <span class="r2-field-label">${escapeHtml(it.label)}</span>
        <span class="r2-field-value">${escapeHtml(_fmtDate(d[it.k], { withTime: /UAT/i.test(it.k) || /Fixation/i.test(it.k) }))}</span>
      </div>
    `).join('')}
  </div>`;
}

function _renderTabAttachments(r) {
  const items = r._attachments || [];
  if (!items.length) return `<div class="r2-empty-tab">Нет вложений.</div>`;
  return `<div class="r2-section"><div class="r2-section-title">Файлы (${items.length})</div>
    ${items.map(a => `
      <div class="r2-attach">
        <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.filename)}</a>
        <span class="r2-attach-meta">${_fmtBytes(a.size)} · ${escapeHtml(_fmtDate(a.created))}${a.author ? ' · ' + escapeHtml(_userLabel(a.author)) : ''}</span>
      </div>
    `).join('')}
  </div>`;
}

/* ─────────────────────────────────────────────────────────────
   Value rendering by kind
   ───────────────────────────────────────────────────────────── */

function _renderValue(v, kind) {
  if (v === null || v === undefined || v === '') return '—';
  switch (kind) {
    case 'date':
    case 'datetime':
      return escapeHtml(_fmtDate(v, { withTime: kind === 'datetime' }));
    case 'user':
      return escapeHtml(_userLabel(v));
    case 'users[]':
      return (v || []).map(u => escapeHtml(_userLabel(u))).join(', ');
    case 'option':
    case 'string':
      return escapeHtml(String(v));
    case 'rich':
      return `<pre class="r2-rich">${escapeHtml(String(v))}</pre>`;
    case 'options[]':
      return (v || []).map(x => escapeHtml(String(x))).join(', ');
    case 'kg[]':
    case 'distrib[]':
    case 'service[]':
      return (v || []).map(item => {
        const main = escapeHtml(item.value || item.name || '');
        const sub = item.version ? ` <span class="r2-field-sub">v${escapeHtml(item.version)}</span>` : '';
        const status = item.statusDetailed ? ` <span class="r2-field-sub">${escapeHtml(item.statusDetailed)}</span>` : '';
        return `<div class="r2-kg-item">${main}${sub}${status}</div>`;
      }).join('');
    default:
      return escapeHtml(String(v));
  }
}

/* ─────────────────────────────────────────────────────────────
   Footer + helpers
   ───────────────────────────────────────────────────────────── */

function _renderFooter(analysed) {
  if (!analysed?.jql) return '';
  return `<details class="r2-footer">
    <summary>JQL</summary>
    <pre class="r2-jql">${escapeHtml(analysed.jql)}</pre>
  </details>`;
}

function _fmtBytes(n) {
  if (!n || !Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function _pl(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
