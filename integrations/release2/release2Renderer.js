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

/**
 * V22+ Phase 5.2 (Birman date policy):
 *   - withTime: true ТОЛЬКО для содержательных дат-времени
 *     (fact-*, updated, fetchedAt, planFixation) — где время реально вводится.
 *   - Для plan-UAT/Prod/etc — только день; Jira-default «00:00» создаёт
 *     ложную точность.
 *   - withTime: 'auto' — показываем HH:MM если время != 00:00.
 *   - withYear: 'auto' — рендерим год только если != текущий (квартальный scope).
 */
function _fmtDate(iso, opts = {}) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const mo  = String(d.getMonth() + 1).padStart(2, '0');
  const yr  = d.getFullYear();
  const h   = d.getHours();
  const m   = d.getMinutes();
  const hasTime = (opts.withTime === true)
                || (opts.withTime === 'auto' && (h !== 0 || m !== 0));
  const wantYear = opts.withYear === false
                ? false
                : (opts.withYear === 'auto' ? yr !== new Date().getFullYear() : true);
  const datePart = wantYear
    ? `${day}.${mo}.${yr}`
    : `${day}.${mo}`;
  if (hasTime) {
    return `${datePart} ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }
  return datePart;
}

/** Поля-даты где имеет смысл время. Используется в _renderTabDates. */
const _DATETIME_KEYS = new Set([
  'planFixation', 'factUATStart', 'factUATEnd', 'factProdDate',
  'updated', 'created',
]);

function _daysLeft(iso) {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  return Math.ceil((ts - Date.now()) / 86400_000);
}

/** Дельта в днях между двумя датами (план vs факт). null если хотя бы одна пустая. */
function _deltaDays(planIso, factIso) {
  if (!planIso || !factIso) return null;
  const p = Date.parse(planIso), f = Date.parse(factIso);
  if (!Number.isFinite(p) || !Number.isFinite(f)) return null;
  return Math.round((f - p) / 86400_000);
}

/**
 * V22+ Phase 5.2 — _userLabel с поддержкой isBlocked (muted-render policy).
 * Уволенные ([В]/[B]) рендерятся прозрачнее + line-through + tooltip.
 */
function _userLabel(u, opts = {}) {
  if (!u) return '—';
  const name = u.displayName || u.name || u.email || '—';
  if (u.isBlocked && !opts.plain) {
    return `<span class="r2-user-blocked" title="Сотрудник заблокирован (уволен)">${escapeHtml(name)}</span>`;
  }
  return escapeHtml(name);
}

/**
 * V22+ Phase 5.2 — Status-shortener (Birman микрокопия).
 * Длинные статусы Jira ломают grid-layout в row. Map даёт короткие
 * читаемые синонимы; full-name остаётся в title="" для context.
 */
const _STATUS_SHORT = {
  'Установлен на ПРОМ':        'В ПРОМ',
  'Установка на ПРОМ':         'Уст. ПРОМ',
  'Готов к установке на ПРОМ': 'К ПРОМ',
  'Готов к стабилизации':      'К стаб.',
  'Согласование ППСИ':         'Согл. ППСИ',
  'Утверждение ППСИ':          'Утв. ППСИ',
  'Готов к ППСИ':              'К ППСИ',
  'Стабилизация':              'Стаб.',
  'Формирование':              'Форм.',
};
function _statusShort(s) {
  if (!s) return '—';
  return _STATUS_SHORT[s] || s;
}

/**
 * V22+ Phase 5.2 — URL chip-list. Длинные URL (особенно через `;`-separator)
 * рендерятся как ужасная портянка. Здесь — chip per URL с host-only label
 * + external-icon, full URL в href + title.
 */
function _renderUrlChips(value) {
  if (!value || typeof value !== 'string') return '—';
  const urls = value.split(/[;,\s]+/).map(s => s.trim()).filter(u => /^https?:\/\//i.test(u));
  if (!urls.length) return escapeHtml(value);
  return urls.map(url => {
    let host = url;
    try { host = new URL(url).host.replace(/^www\./, ''); } catch (_) {}
    return `<a class="r2-url-chip" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(url)}">${ICONS.external}<span class="r2-url-host">${escapeHtml(host)}</span></a>`;
  }).join(' ');
}

/**
 * V22+ Phase 5.2 — Heuristic-split для «Состав ТС и СПО»-подобных полей,
 * где Jira отдаёт плоскую строку «RedHat OpenShift Container Platform СУБД Pangolin Kafka Corax»
 * без переносов. Делим по известным SPO-tokens.
 */
const _SPO_TOKENS = [
  'RedHat', 'OpenShift', 'СУБД', 'Pangolin', 'Kafka', 'Corax',
  'PostgreSQL', 'Tarantool', 'Hadoop', 'Elastic', 'Kubernetes',
  'Docker', 'Java', 'NodeJS', 'Python', 'Spring', 'Camel',
  'Sber', 'СБОФ', 'СБЕР',
];
function _splitSpoString(s) {
  if (typeof s !== 'string') return null;
  if (/\n|\r|<br>/i.test(s)) return s.split(/\s*(?:\r?\n|<br\s*\/?>)\s*/).filter(Boolean);
  // Считаем сколько SPO-tokens найдено. Если ≥2 — split по boundaries.
  const matches = _SPO_TOKENS.filter(t => s.includes(t));
  if (matches.length < 2) return null;
  // Простая стратегия: каждый token = начало нового item.
  // Сортируем матчи по позиции, нарезаем строку.
  const positions = matches
    .map(t => ({ t, pos: s.indexOf(t) }))
    .sort((a, b) => a.pos - b.pos);
  const items = [];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].pos;
    const end = i + 1 < positions.length ? positions[i + 1].pos : s.length;
    items.push(s.slice(start, end).trim());
  }
  return items.filter(Boolean);
}

/**
 * V22+ Phase 5.2 — Data-quality check для одного релиза.
 * Возвращает массив проблем для health-chip и для diagnostic-баннера.
 */
function _computeHealth(r) {
  const issues = [];
  // Status «Установлен на ПРОМ» но fact-pROM date пустая
  if (r.status === 'Установлен на ПРОМ' && !r.dates?.factProdDate) {
    issues.push({ k: 'missing-fact-prod', text: 'нет даты установки в ПРОМ' });
  }
  // Plan-ПРОМ пустой при !cancel
  if (r._phase !== 'cancel' && !r.dates?.planProdEnd) {
    issues.push({ k: 'no-plan-prod', text: 'нет плана ПРОМ' });
  }
  // Заблокированный организатор (silent в owners, явный в health)
  if (r.organizer?.isBlocked || r.approver?.isBlocked) {
    issues.push({ k: 'blocked-owner', text: 'владелец заблокирован' });
  }
  // КЭ пустой
  if (!r.configElement?.length) {
    issues.push({ k: 'no-ke', text: 'нет КЭ' });
  }
  return issues;
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
   Inline SVG icons (V22+ Phase 5.1 — заменяют unicode-glyphs ↻ ⤓ ▾ ▸ ↗)
   Spine-pill §6: «иконки — inline SVG 12–16 px, stroke=currentColor».
   ───────────────────────────────────────────────────────────── */

const ICONS = {
  refresh: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  chevronDown:  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>',
  external: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  close:    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
};

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
  // V22+ Phase 5.1 — diff-banner понижен по громкости (transparent + stripe-left)
  // + 7-day sparkline (Доп #22). open снят: подробности раскрываются по клику.
  parts.push(_renderDiffBanner(opts.prevDiff, analysed?.fetchedAt, opts.diffHistory));
  // Phase 5.2 (Vrba U1) — phase-bar + owners в один horizontal hero-block.
  parts.push(_renderHeroBlock(analysed, state));
  // Phase 5.2 (Vrba U2) — sticky filter strip + breadcrumb of active filters.
  parts.push(_renderFilters(analysed, state));
  parts.push(_renderActiveFiltersBreadcrumb(state));
  parts.push(_renderListBody(analysed, state, opts));
  parts.push(_renderFooter(analysed));
  return `<div class="r2-view">${parts.join('')}</div>`;
}

/**
 * Hero-block (Vrba U1): объединяет phase-bar и owners-card в один
 * horizontal-card. Экономит 24px вертикали + смысловая группировка
 * «distribution by» в одном месте.
 */
function _renderHeroBlock(analysed, state) {
  return `<div class="r2-hero">
    ${_renderPhaseBar(analysed, state)}
    ${_renderOwnersCard(analysed, state)}
  </div>`;
}

/**
 * Breadcrumb активных фильтров (Vrba U2) — dismissable chips под filter-strip.
 * Сразу видно «что отфильтровано», легко снять по одному.
 */
function _renderActiveFiltersBreadcrumb(state) {
  const f = state.filters || {};
  const chips = [];
  if (f.phase) {
    chips.push(`<button class="r2-fchip" data-r2-clear-filter="phase" title="Снять фильтр">${ICONS.close}<span>фаза: ${escapeHtml(_phaseLabel(f.phase))}</span></button>`);
  }
  for (const v of (f.projectKeys || [])) {
    chips.push(`<button class="r2-fchip" data-r2-clear-filter="projectKeys" data-r2-value="${escapeHtml(v)}" title="Снять">${ICONS.close}<span>проект: ${escapeHtml(v)}</span></button>`);
  }
  for (const v of (f.statuses || [])) {
    chips.push(`<button class="r2-fchip" data-r2-clear-filter="statuses" data-r2-value="${escapeHtml(v)}" title="Снять">${ICONS.close}<span>статус: ${escapeHtml(v)}</span></button>`);
  }
  for (const v of (f.types || [])) {
    chips.push(`<button class="r2-fchip" data-r2-clear-filter="types" data-r2-value="${escapeHtml(v)}" title="Снять">${ICONS.close}<span>тип: ${escapeHtml(v)}</span></button>`);
  }
  for (const v of (f.risks || [])) {
    chips.push(`<button class="r2-fchip" data-r2-clear-filter="risks" data-r2-value="${escapeHtml(v)}" title="Снять">${ICONS.close}<span>риск: ${escapeHtml(v)}</span></button>`);
  }
  if (f.searchText) {
    chips.push(`<button class="r2-fchip" data-r2-clear-filter="searchText" title="Снять">${ICONS.close}<span>поиск: «${escapeHtml(f.searchText.slice(0, 30))}»</span></button>`);
  }
  if (!chips.length) return '';
  return `<div class="r2-fchips">${chips.join('')}<button class="r2-fchip r2-fchip-reset" data-r2-action="filters-reset">сбросить всё</button></div>`;
}

/* ─────────────────────────────────────────────────────────────
   Toolbar (refresh button + last-fetched + group-by)
   ───────────────────────────────────────────────────────────── */

/**
 * V22+ Phase 5.2 (Birman A) — relative time для последнего обновления.
 * До 60 секунд — «только что», до 60 минут — «N мин назад», до 24ч — «Nч назад»,
 * дальше — обычная дата без времени.
 */
function _fmtRelative(iso) {
  const ts = Date.parse(iso || '');
  if (!Number.isFinite(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 0)         return _fmtDate(iso, { withTime: 'auto', withYear: 'auto' });
  if (diff < 60_000)    return 'только что';
  if (diff < 3600_000)  return `${Math.floor(diff / 60_000)} мин назад`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч назад`;
  return _fmtDate(iso, { withYear: 'auto' });
}

function _renderToolbar(analysed, state) {
  // Phase 5.2 Birman A — относительное время + точное в title
  const fetched = analysed?.fetchedAt
    ? `<span class="r2-toolbar-fetched" title="${escapeHtml(_fmtDate(analysed.fetchedAt, { withTime: true }))}">обновлено: ${escapeHtml(_fmtRelative(analysed.fetchedAt))}</span>`
    : '';
  const total = analysed?.stats?.total || 0;

  // MD-export — переехал в футер (не daily-action). Toolbar держит primary
  // (Refresh) + group-by chips. Это «один primary action на одну page».
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
        <button class="r2-btn r2-btn-primary" data-r2-action="refresh">${ICONS.refresh} Обновить</button>
      </div>
    </div>`;
}

function _groupByChip(value, label, current) {
  const active = current === value;
  return `<button class="r2-groupby-chip${active ? ' r2-groupby-chip-active' : ''}" data-r2-groupby="${value}">${escapeHtml(label)}</button>`;
}

/* ─────────────────────────────────────────────────────────────
   Phase-bar (V22+ Phase 5.1 — заменил 6 «big numbers» stat-bar)

   Tufte-принцип: phase — ORDINAL шкала (creation→deploy), а
   sum(byPhase) == total. Раньше 6 равноправных big-numbers нарушали
   pre-attentive восприятие «distribution». Теперь — segmented bar
   12px высотой, ширина сегмента ∝ count.

   Side-stats: total + 2 alert-chips (скоро ПСИ / ПРОМ).
   Click на сегменте = toggle filter.phase.
   ───────────────────────────────────────────────────────────── */

/**
 * Phase-bar V2 (Vrba+Tufte fusion):
 * 1. sqrt-grow — честная перцепция при skewed distribution (255 vs 2)
 * 2. filled tint background — color-channel виден (вместо top-stripe 3px)
 * 3. min-width 64px на сегмент — лейбл всегда читается
 * 4. dominant-hero — если фаза > 50%, выносим её в отдельный tile слева
 * 5. lifecycle order: creation→stabilize→uat→approve→deploy→cancel
 *
 * Click на сегменте = toggle filter.phase.
 */
function _renderPhaseBar(analysed, state) {
  const s = analysed?.stats;
  if (!s || !s.total) return '';
  const curPhase = state.filters.phase || '';

  const PHASES = [
    { id: 'creation',  label: 'В работе' },
    { id: 'stabilize', label: 'Стабилизация' },
    { id: 'uat',       label: 'ПСИ' },
    { id: 'approve',   label: 'ППСИ' },
    { id: 'deploy',    label: 'К ПРОМ' },
    { id: 'cancel',    label: 'Отменено' },
  ];

  // Dominant detection: если одна фаза держит ≥50%, выносим в hero
  const nonZero = PHASES.map(p => ({ ...p, n: s.byPhase[p.id] || 0 })).filter(p => p.n > 0);
  if (!nonZero.length) return '';
  const dominant = nonZero.find(p => p.n / s.total >= 0.5);
  const restPhases = dominant ? nonZero.filter(p => p.id !== dominant.id) : nonZero;

  const heroTile = dominant ? (() => {
    const active = curPhase === dominant.id;
    const pct = Math.round(dominant.n / s.total * 100);
    return `<button
      class="r2-phase-hero r2-phase-bg-${dominant.id}${active ? ' r2-phase-hero-active' : ''}"
      data-r2-filter-phase="${dominant.id}"
      aria-pressed="${active}"
      title="${escapeHtml(dominant.label)}: ${dominant.n} (${pct}%)"
    >
      <span class="r2-phase-hero-num">${dominant.n}</span>
      <span class="r2-phase-hero-meta">
        <span class="r2-phase-hero-label">${escapeHtml(dominant.label)}</span>
        <span class="r2-phase-hero-pct">${pct}%</span>
      </span>
    </button>`;
  })() : '';

  // Segments — для оставшихся фаз. Если был dominant — оставшиеся <50%, делим
  // нормально (по sqrt чтобы малые не исчезали).
  const segments = restPhases.map(p => {
    const active = curPhase === p.id;
    const pct = (p.n / s.total * 100).toFixed(1);
    // sqrt-grow для честной перцепции skewed-data
    const growBasis = Math.sqrt(p.n);
    return `<button
      class="r2-phase-seg r2-phase-bg-${p.id}${active ? ' r2-phase-seg-active' : ''}"
      style="flex-grow: ${growBasis.toFixed(3)}"
      data-r2-filter-phase="${p.id}"
      title="${escapeHtml(p.label)}: ${p.n} (${pct}%)"
      aria-pressed="${active}"
    ><span class="r2-phase-seg-label">${escapeHtml(p.label)}</span><span class="r2-phase-seg-num">${p.n}</span></button>`;
  }).join('');

  // Alert-chips — с count/total format (Tufte: count + denominator).
  const total = s.total;
  const alertUat  = s.upcomingUAT  ? `<button class="r2-stat-chip r2-stat-chip-alert${curPhase === 'uat' ? ' r2-stat-chip-active' : ''}" data-r2-filter-phase="uat" aria-pressed="${curPhase === 'uat'}"><span class="r2-stat-chip-num">${s.upcomingUAT}<span class="r2-stat-chip-denom">/${total}</span></span><span class="r2-stat-chip-label">скоро ПСИ ≤3д</span></button>` : '';
  const alertProd = s.upcomingProd ? `<button class="r2-stat-chip r2-stat-chip-alert${curPhase === 'deploy' ? ' r2-stat-chip-active' : ''}" data-r2-filter-phase="deploy" aria-pressed="${curPhase === 'deploy'}"><span class="r2-stat-chip-num">${s.upcomingProd}<span class="r2-stat-chip-denom">/${total}</span></span><span class="r2-stat-chip-label">скоро ПРОМ ≤7д</span></button>` : '';

  return `
    <div class="r2-phase-wrap" role="group" aria-label="Распределение по фазам">
      ${heroTile}
      <div class="r2-phase-bar${dominant ? ' r2-phase-bar-rest' : ''}">
        ${segments}
      </div>
      <div class="r2-phase-side">
        ${alertUat}
        ${alertProd}
      </div>
    </div>`;
}

/* ─────────────────────────────────────────────────────────────
   Filters
   ───────────────────────────────────────────────────────────── */

/**
 * Filters strip — Phase 5.2 (Brand+Vrba):
 * - Native `<select multiple>` заменены на placeholders для components/multiselect.js
 *   (mount происходит в orchestrator после innerHTML).
 * - Sticky-position управляется через CSS .r2-filters-sticky.
 * - Список доступных опций передаётся через data-r2-ms-options (JSON-encoded).
 */
function _renderFilters(analysed, state) {
  const projects = Array.from(analysed.byProject?.keys() || []).sort();
  const statuses = STATUS_ORDER;
  const types = RELEASE_TYPES;
  const risks = RISK_LEVELS;
  const f = state.filters;

  const msPlaceholder = (filterKey, options, selected, label) => {
    return `<div class="r2-ms-slot"
      data-r2-multiselect="${escapeHtml(filterKey)}"
      data-r2-ms-options='${escapeHtml(JSON.stringify(options))}'
      data-r2-ms-selected='${escapeHtml(JSON.stringify(selected || []))}'
      data-r2-ms-label="${escapeHtml(label)}"
    ></div>`;
  };

  return `
    <div class="r2-filters r2-filters-sticky">
      <input type="search" class="r2-filter-search" placeholder="Поиск по теме, ключу, КЭ…" value="${escapeHtml(f.searchText || '')}" data-r2-search>
      ${msPlaceholder('projectKeys', projects, f.projectKeys, 'Проект')}
      ${msPlaceholder('statuses', statuses, f.statuses, 'Статус')}
      ${msPlaceholder('types', types, f.types, 'Тип')}
      ${msPlaceholder('risks', risks, f.risks, 'Риск')}
    </div>`;
}

/* ─────────────────────────────────────────────────────────────
   Diff banner (Доп. #9)
   ───────────────────────────────────────────────────────────── */

/**
 * @param {object|null} diff      — output diffRelease2Lists (added/removed/changed)
 * @param {string} fetchedAt      — для dismiss-tracking (banner закрывается per-fetch)
 * @param {Array}  diffHistory    — last 7 entries для sparkline
 */
function _renderDiffBanner(diff, fetchedAt, diffHistory) {
  if (!diff) return '';
  const total = (diff.added?.length || 0) + (diff.removed?.length || 0) + (diff.changed?.length || 0);
  if (!total) return '';

  // Top-level summary
  const summaryParts = [];
  if (diff.added?.length)   summaryParts.push(`<strong class="r2-diff-num r2-diff-added">+${diff.added.length}</strong> ${_pl(diff.added.length, ['новый', 'новых', 'новых'])}`);
  if (diff.changed?.length) summaryParts.push(`<strong class="r2-diff-num r2-diff-changed">~${diff.changed.length}</strong> ${_pl(diff.changed.length, ['изменён', 'изменено', 'изменено'])}`);
  if (diff.removed?.length) summaryParts.push(`<strong class="r2-diff-num r2-diff-removed">−${diff.removed.length}</strong> ${_pl(diff.removed.length, ['удалён', 'удалено', 'удалено'])}`);

  // V22+ Phase 5.1 (Доп #22) — 7-day mini-sparkline
  const sparkline = _renderDiffSparkline(diffHistory);

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
          <span class="r2-diff-title">За последний refresh:</span>
          ${summaryParts.join(' · ')}
          ${sparkline}
        </div>
        <button class="r2-diff-dismiss" data-r2-action="diff-dismiss" title="Скрыть до следующего обновления" aria-label="Скрыть">${ICONS.close}</button>
      </div>
      <details class="r2-diff-details">
        <summary class="r2-diff-details-summary">Подробнее</summary>
        <div class="r2-diff-body">${lines.join('')}</div>
      </details>
    </div>`;
}

/**
 * Mini 7-day sparkline: 3 stacked color-bars (added/changed/removed) на каждый
 * из последних 7 fetch'ей. CSS-only (без canvas) — 7 × 3 div'а.
 * Если history < 2 точек — sparkline не показываем (тренд бессмысленен).
 */
function _renderDiffSparkline(history) {
  // Tufte: показываем только при >=3 точек (тренд бессмысленен на 2)
  if (!Array.isArray(history) || history.length < 3) return '';
  const recent = history.slice(-7);
  const sums = recent.map(e => (e.added || 0) + (e.changed || 0) + (e.removed || 0));
  const max = Math.max(1, ...sums);
  const last = recent[recent.length - 1];
  const lastLabel = `${last.added || 0}·${last.changed || 0}·${last.removed || 0}`;
  const bars = recent.map(e => {
    const a = (e.added   || 0) / max * 100;
    const c = (e.changed || 0) / max * 100;
    const r = (e.removed || 0) / max * 100;
    const date = String(e.fetchedAt || '').slice(0, 10);
    return `<div class="r2-spark-bar" title="${escapeHtml(date)}: +${e.added || 0} / ~${e.changed || 0} / −${e.removed || 0}">
      <span class="r2-spark-seg r2-spark-removed" style="height:${r}%"></span>
      <span class="r2-spark-seg r2-spark-changed" style="height:${c}%"></span>
      <span class="r2-spark-seg r2-spark-added"   style="height:${a}%"></span>
    </div>`;
  }).join('');
  return `<span class="r2-diff-sparkline" title="История последних 7 refresh'ей">${bars}<span class="r2-diff-sparkline-label">${recent.length}д: ${lastLabel}</span></span>`;
}

/* ─────────────────────────────────────────────────────────────
   Owners card (Доп. #7)
   ───────────────────────────────────────────────────────────── */

function _renderOwnersCard(analysed, state) {
  if (!analysed?.releases?.length) return '';
  // Phase 5.2 — silent-filter: blocked-users НЕ попадают в aggregate (по MEMORY).
  // Aggregate-роль (топ-N) не должна давать сигнал об уволенных — это шум.
  const byOwner = new Map();
  for (const r of analysed.releases) {
    const owner = r.organizer || r.assignee;
    if (!owner) continue;
    if (owner.isBlocked) continue;   // silent-skip
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

  // Phase 5.1 — кнопку «Группировать» убрали (дублировала toolbar-chip).
  // Заголовок самостоятельно подсказывает что owners-карточка ↔ group-by=owner.
  return `
    <details class="r2-owners-card" ${state.groupBy === 'owner' ? 'open' : ''}>
      <summary class="r2-owners-header">
        <span class="r2-owners-title">Топ владельцев</span>
        <span class="r2-owners-count">${byOwner.size} ${_pl(byOwner.size, ['владелец', 'владельца', 'владельцев'])}</span>
      </summary>
      <div class="r2-owners-list">
        ${sorted.map(o => _renderOwnerChip(o, analysed.stats?.total || 1)).join('')}
      </div>
    </details>`;
}

function _renderOwnerChip(o, totalReleases) {
  const initials = _initials(o.name);
  // V22+ Phase 5.1 — заменили 5 цветных dot-chip на micro-phasebar.
  // Сегменты пропорциональны count по фазам. Это меньше ink + сохраняет
  // distribution glanceable (Tufte «small multiples»).
  const PHASE_IDS = ['creation', 'stabilize', 'uat', 'approve', 'deploy', 'cancel'];
  const phaseBar = PHASE_IDS.map(ph => {
    const n = o.byPhase[ph] || 0;
    if (!n) return '';
    return `<span class="r2-owner-phase-seg r2-phase-seg-${ph}" style="flex-grow:${n}" title="${escapeHtml(_phaseLabel(ph))}: ${n}"></span>`;
  }).join('');
  return `
    <div class="r2-owner-chip" title="${escapeHtml(o.email || o.name)}">
      <span class="r2-owner-avatar">${escapeHtml(initials)}</span>
      <span class="r2-owner-body">
        <span class="r2-owner-name">${escapeHtml(o.name)}</span>
        <span class="r2-owner-phasebar" aria-hidden="true">${phaseBar}</span>
      </span>
      <span class="r2-owner-total">${o.total}</span>
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

  // Phase 5.2 (Vrba) — гард для 1-group case. Header дублирует filter-info,
  // занимает лишний этаж когда контента ≤2 row.
  if (groupKeys.length === 1) {
    const items = groups.get(groupKeys[0]);
    return `<div class="r2-list">
      <div class="r2-group r2-group-solo">
        <div class="r2-group-body">${items.map(r => _renderReleaseRow(r, state, opts)).join('')}</div>
      </div>
    </div>`;
  }

  return `<div class="r2-list">${groupKeys.map(gk => _renderGroup(gk, groups.get(gk), state, opts)).join('')}</div>`;
}

function _applyFilters(list, f) {
  const text = (f.searchText || '').toLowerCase().trim();
  const projects = new Set(f.projectKeys || []);
  const statuses = new Set(f.statuses || []);
  const types = new Set(f.types || []);
  const risks = new Set(f.risks || []);
  const phase = f.phase || '';

  return list.filter(r => {
    if (phase && r._phase !== phase) return false;
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
  const planProd   = r.dates?.planProdEnd;
  const factProd   = r.dates?.factProdDate;
  const flagsHtml = (r._flags || []).map(f => {
    if (f.kind === 'uat-soon') return `<span class="r2-flag r2-flag-uat">скоро ПСИ ${f.daysLeft}д</span>`;
    if (f.kind === 'prod-soon') return `<span class="r2-flag r2-flag-prod">скоро ПРОМ ${f.daysLeft}д</span>`;
    if (f.kind === 'fpd-blocked') return `<span class="r2-flag r2-flag-fpd">ждёт ФПД</span>`;
    return '';
  }).join('');

  // V22+ Phase 5.2 — health-chip из data-quality issues.
  const issues = _computeHealth(r);
  const healthChip = issues.length
    ? `<span class="r2-health-chip r2-health-${issues.length === 1 ? 'warn' : 'alert'}" title="${escapeHtml(issues.map(i => i.text).join('; '))}">⚠ ${issues.length}</span>`
    : '';

  // КЭ-chip (Phase 5.2 — короткий count если >1, иначе сам value)
  const kgList = (r.configElement || []).map(c => c.value).filter(Boolean);
  let kgChip = '';
  if (kgList.length === 1) {
    kgChip = `<span class="r2-ke-chip" title="${escapeHtml(kgList[0])}">${escapeHtml(kgList[0].slice(0, 18))}${kgList[0].length > 18 ? '…' : ''}</span>`;
  } else if (kgList.length > 1) {
    kgChip = `<span class="r2-ke-chip" title="${escapeHtml(kgList.join('\n'))}">КЭ <strong>${kgList.length}</strong></span>`;
  }

  // V22+ Phase 5.2 (Tufte A) — date eyebrow + plan-vs-fact sparkline
  const dateEyebrow = `<span class="r2-date-tag">ПРОМ</span>`;
  const dateStr = factProd
    ? _fmtDate(factProd, { withYear: 'auto' })
    : (planProd ? _fmtDate(planProd, { withYear: 'auto' }) : '—');
  const delta = _deltaDays(planProd, factProd);
  const sparkline = (planProd && factProd && delta !== null)
    ? `<span class="r2-pvf" title="План: ${_fmtDate(planProd)}, Факт: ${_fmtDate(factProd)} (${delta >= 0 ? '+' : ''}${delta}д)">
        <span class="r2-pvf-dot r2-pvf-plan"></span>
        <span class="r2-pvf-line${delta > 0 ? ' r2-pvf-late' : delta < 0 ? ' r2-pvf-early' : ''}" style="width:${Math.min(40, Math.abs(delta) * 2)}px"></span>
        <span class="r2-pvf-dot r2-pvf-fact"></span>
        <span class="r2-pvf-delta">${delta >= 0 ? '+' : ''}${delta}д</span>
      </span>`
    : '';

  // V22+ Phase 5.2 — Status-shortener чтобы pill не переносился на 2 строки.
  // Full-name остаётся в title для context.
  const statusText = _statusShort(r.status);

  return `
    <div class="r2-row ${phaseClass}${expanded ? ' r2-row-expanded' : ''}" data-r2-key="${escapeHtml(r.key)}">
      <div class="r2-row-head" data-r2-toggle="${escapeHtml(r.key)}">
        <span class="r2-risk-dot ${riskClass}" title="Риск: ${escapeHtml(r.riskAuto || r.riskLevel || '—')}"></span>
        <span class="r2-key">${escapeHtml(r.key)}</span>
        <span class="r2-summary">${escapeHtml(r.summary)}</span>
        <span class="r2-status r2-status-${r._phase}" title="${escapeHtml(r.status)}">${escapeHtml(statusText)}</span>
        ${kgChip}
        <span class="r2-date">${dateEyebrow} ${escapeHtml(dateStr)}</span>
        <span class="r2-flags">${sparkline}${flagsHtml}${healthChip}</span>
        <span class="r2-row-chevron" aria-hidden="true">${expanded ? ICONS.chevronDown : ICONS.chevronRight}</span>
      </div>
      ${expanded ? `<div class="r2-row-body" data-r2-key="${escapeHtml(r.key)}">${renderExpandPanel(r, state, opts)}</div>` : ''}
    </div>`;
}

/* ─────────────────────────────────────────────────────────────
   Expand panel — 6 tabs
   ───────────────────────────────────────────────────────────── */

// V22+ Phase 5.2 (Maeda U2) — добавлен 4-й таб «Здоровье» с auto-checklist.
// Превращает expand в diagnostic dashboard вместо read-only снимка.
const TABS = [
  { id: 'inside',  label: 'Что внутри' },   // compose + ppsi + subtasks + SPO-list
  { id: 'dates',   label: 'Сроки' },        // mini-Gantt + lifecycle blocks
  { id: 'links',   label: 'Связи' },        // rov + attachments + URLs
  { id: 'health',  label: 'Здоровье' },     // data-quality issues + актуальность
];

export function renderExpandPanel(r, state, opts = {}) {
  const rawTab = state.getExpandedTab ? state.getExpandedTab(r.key) : 'inside';
  // Backward-compat: 6-tab → 4-tab.
  const legacyMap = { attrs: 'inside', compose: 'inside', ppsi: 'inside',
                       rov: 'links', attach: 'links' };
  const tab = legacyMap[rawTab] || rawTab || 'inside';

  // Maeda U1 — status-spine 36px на вершине: lifecycle bar + текущая фаза
  const spine = _renderStatusSpine(r);

  const issues = _computeHealth(r);
  const healthBadge = issues.length ? ` <span class="r2-tab-badge">${issues.length}</span>` : '';

  const tabsHtml = TABS.map(t => {
    const badge = t.id === 'health' ? healthBadge : '';
    return `<button class="r2-tab${t.id === tab ? ' r2-tab-active' : ''}" data-r2-tab="${t.id}" data-r2-key="${escapeHtml(r.key)}">${escapeHtml(t.label)}${badge}</button>`;
  }).join('');

  let bodyHtml;
  switch (tab) {
    case 'dates':  bodyHtml = _renderTabDates(r); break;
    case 'links':  bodyHtml = _renderTabLinks(r); break;
    case 'health': bodyHtml = _renderTabHealth(r, issues); break;
    default:       bodyHtml = _renderTabInside(r, state);
  }

  const jiraUrl = opts.jiraBaseUrl ? `${opts.jiraBaseUrl.replace(/\/$/, '')}/browse/${encodeURIComponent(r.key)}` : '';
  const externalLink = jiraUrl
    ? `<a class="r2-external-link" href="${escapeHtml(jiraUrl)}" target="_blank" rel="noopener noreferrer">${ICONS.external} Открыть в Jira</a>`
    : '';

  return `
    <div class="r2-expand">
      ${spine}
      <div class="r2-tabs">
        ${tabsHtml}
        <div class="r2-tabs-spacer"></div>
        ${externalLink}
      </div>
      <div class="r2-tab-body">${bodyHtml}</div>
    </div>`;
}

/**
 * V22+ Phase 5.2 (Maeda U1) — Status-spine: горизонтальная lifecycle-strip
 * вверху expand. Активный сегмент highlighted. Под ним даты ключевых этапов.
 * Цель: PM видит «где релиз, на сколько отстаёт» за 800ms без переключения табов.
 */
function _renderStatusSpine(r) {
  const STAGES = [
    { id: 'creation',  label: 'Создание',      planKey: null,            factKey: null },
    { id: 'ift',       label: 'ИФТ',           planKey: 'planIFTEnd',    factKey: null },
    { id: 'nt',        label: 'НТ',            planKey: 'planNTEnd',     factKey: null },
    { id: 'uat',       label: 'ПСИ',           planKey: 'planUATEnd',    factKey: 'factUATEnd' },
    { id: 'approve',   label: 'ППСИ',          planKey: null,            factKey: 'ppsiApprovedAt' },
    { id: 'deploy',    label: 'ПРОМ',          planKey: 'planProdEnd',   factKey: 'factProdDate' },
  ];
  // Mapping _phase → активный stage в spine.
  const phaseStage = {
    creation: 'creation', stabilize: 'ift', uat: 'uat',
    approve: 'approve', deploy: 'deploy', cancel: 'deploy',
  }[r._phase] || 'creation';
  const cancelled = r._phase === 'cancel';

  return `<div class="r2-spine">
    ${STAGES.map(st => {
      const active = st.id === phaseStage;
      const past   = STAGES.findIndex(x => x.id === phaseStage) > STAGES.findIndex(x => x.id === st.id);
      const planV  = st.planKey ? r.dates?.[st.planKey] : null;
      const factV  = st.factKey ? r.dates?.[st.factKey] : null;
      const delta  = _deltaDays(planV, factV);
      const stateClass = cancelled && active ? 'r2-spine-stage-cancel'
                       : active ? 'r2-spine-stage-active'
                       : past   ? 'r2-spine-stage-past'
                       : 'r2-spine-stage-future';
      const dateInfo = factV
        ? `<span class="r2-spine-fact">${_fmtDate(factV, { withYear: 'auto' })}</span>${delta !== null ? `<span class="r2-spine-delta r2-spine-delta-${delta > 0 ? 'late' : delta < 0 ? 'early' : 'ontime'}">${delta >= 0 ? '+' : ''}${delta}д</span>` : ''}`
        : planV ? `<span class="r2-spine-plan">${_fmtDate(planV, { withYear: 'auto' })}</span>` : '';
      return `<div class="r2-spine-stage ${stateClass}" title="${escapeHtml(st.label)}${planV ? ` план: ${_fmtDate(planV)}` : ''}${factV ? ` факт: ${_fmtDate(factV)}` : ''}">
        <div class="r2-spine-bar"></div>
        <div class="r2-spine-stage-label">${escapeHtml(st.label)}</div>
        <div class="r2-spine-stage-date">${dateInfo || '<span class="r2-spine-empty">—</span>'}</div>
      </div>`;
    }).join('')}
  </div>`;
}

/**
 * V22+ Phase 5.2 (Maeda U2) — Health tab: data-quality auto-checklist.
 */
function _renderTabHealth(r, issues) {
  const greenItems = [];
  if (r.configElement?.length) greenItems.push(`✓ КЭ заполнены (${r.configElement.length})`);
  if (r.dates?.planProdEnd) greenItems.push(`✓ план ПРОМ есть`);
  if (r.organizer && !r.organizer.isBlocked) greenItems.push(`✓ Организатор ПСИ активен`);
  if (r.dates?.factProdDate) greenItems.push(`✓ факт ПРОМ зафиксирован`);
  if (r._phase === 'deploy' || r._phase === 'cancel') greenItems.push(`✓ релиз вышел из работы`);

  return `<div class="r2-section">
    <div class="r2-section-title">Качество данных (${issues.length} проблем${issues.length === 1 ? 'а' : ''})</div>
    ${issues.length === 0
      ? `<div class="r2-health-ok">Все базовые поля заполнены. Релиз в порядке.</div>`
      : issues.map(i => `<div class="r2-health-issue"><span class="r2-health-marker">⚠</span> ${escapeHtml(i.text)}</div>`).join('')
    }
  </div>
  ${greenItems.length ? `<div class="r2-section">
    <div class="r2-section-title">Что в порядке</div>
    ${greenItems.map(it => `<div class="r2-health-green">${escapeHtml(it)}</div>`).join('')}
  </div>` : ''}`;
}

/** Объединённый таб «Что внутри»: Состав + ПСИ + Подзадачи + collapsed-Атрибуты */
function _renderTabInside(r, state) {
  return `
    ${_renderTabCompose(r, state)}
    ${_renderTabPpsi(r)}
    <details class="r2-attrs-collapsed">
      <summary class="r2-section-title">Все поля релиза</summary>
      ${_renderTabAttrs(r)}
    </details>`;
}

/** Объединённый «Связи»: РоВ + Вложения */
function _renderTabLinks(r) {
  return _renderTabRov(r) + _renderTabAttachments(r);
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

  // Phase 5.2 (#14) — «Подгрузить детали» из button → link-style (icon-only
  // в правом верху первой секции). Раз-в-сессию-action, не должен соревноваться
  // визуально с табами / Открыть-в-Jira.
  const lazyHint = state?.getRelated && !state.getRelated(r.key)
    ? `<a class="r2-related-load" href="#" data-r2-action="related-load" data-r2-key="${escapeHtml(r.key)}" title="Подгрузить связанные Story / Bugs">${ICONS.refresh} подгрузить детали</a>`
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
  // Phase 5.2 (Maeda) — longest-common-prefix detection для борьбы с повторами
  // типа «Проведение ПСИ по КЭ: …» в 4 sub-task'ах подряд.
  const summaries = items.map(i => i.summary || '');
  const commonPrefix = _longestCommonPrefix(summaries);
  const showPrefix = commonPrefix.length >= 15 && items.length >= 3;

  return `<div class="r2-section">
    <div class="r2-section-title">${escapeHtml(title)} (${items.length})</div>
    ${showPrefix ? `<div class="r2-sublink-prefix" title="Общий префикс ${items.length} элементов">${escapeHtml(commonPrefix.trim())}…</div>` : ''}
    ${items.map(i => {
      const displaySummary = showPrefix
        ? (i.summary || '').slice(commonPrefix.length).trim()
        : (i.summary || '');
      return `
      <div class="r2-sublink">
        <span class="r2-sublink-key">${escapeHtml(i.key)}</span>
        <span class="r2-sublink-summary">${escapeHtml(displaySummary || '…')}</span>
        <span class="r2-sublink-status">${escapeHtml(i.status || '')}</span>
        ${i.priority ? `<span class="r2-sublink-priority">${escapeHtml(i.priority)}</span>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

function _longestCommonPrefix(arr) {
  if (!arr?.length) return '';
  let prefix = arr[0];
  for (let i = 1; i < arr.length; i++) {
    while (arr[i].indexOf(prefix) !== 0) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return '';
    }
  }
  return prefix;
}

function _renderTabRov(r) {
  const out = (r._links?.outward || []).filter(l => /Introduction Order/i.test(l.linkType));
  if (!out.length) {
    return `<div class="r2-empty-tab">РоВ ещё не создан или не привязан к этому релизу.</div>`;
  }
  return _renderLinkedList('РоВ (Introduction Order)', out);
}

/**
 * V22+ Phase 5.2 (Maeda + Tufte fusion) — «Сроки» полностью переработаны:
 *
 * 1. Mini-Gantt timeline (горизонтальная полоска) — все 5 фаз
 *    (Фиксация → ИФТ → НТ → ПСИ → ПРОМ) с план/факт-маркерами.
 * 2. Lifecycle-blocks: 5 двухколонных pair'ов «План | Факт» с дельтой в днях.
 * 3. Empty blocks (без план/факт) collapse в <details>.
 * 4. Date-format policy: withTime ТОЛЬКО для _DATETIME_KEYS (Birman).
 */
function _renderTabDates(r) {
  const d = r.dates || {};

  // 5 logical lifecycle blocks
  const BLOCKS = [
    { id: 'fixation', label: 'Фиксация', plan: ['planFixation'],                fact: [] },
    { id: 'ift',      label: 'ИФТ',      plan: ['planIFTStart', 'planIFTEnd'],  fact: [] },
    { id: 'nt',       label: 'НТ',       plan: ['planNTStart', 'planNTEnd'],    fact: [] },
    { id: 'uat',      label: 'ПСИ',      plan: ['planUATStart', 'planUATEnd'],  fact: ['factUATStart', 'factUATEnd'] },
    { id: 'deploy',   label: 'ПРОМ',     plan: ['planDeployStart', 'planProdEnd'], fact: ['factProdDate'] },
  ];

  const labelMap = {
    planFixation: 'Фиксация',
    planIFTStart: 'Начало', planIFTEnd: 'Окончание',
    planNTStart: 'Начало', planNTEnd: 'Окончание',
    planUATStart: 'Начало ПСИ', planUATEnd: 'Окончание ПСИ',
    planDeployStart: 'Начало внедрения', planProdEnd: 'Завершение в ПРОМ',
    factUATStart: 'Начало ПСИ', factUATEnd: 'Окончание ПСИ',
    factProdDate: 'Установка в ПРОМ',
  };

  // Mini-Gantt: horizontal timeline 36px высоты. По X — общий timespan от
  // min(plan-fixation) до max(planProdEnd | factProdDate). По Y — 5 фаз
  // как полоски plan + точки fact.
  const allDates = [];
  for (const b of BLOCKS) {
    for (const k of b.plan) if (d[k]) allDates.push(Date.parse(d[k]));
    for (const k of b.fact) if (d[k]) allDates.push(Date.parse(d[k]));
  }
  let ganttHtml = '';
  if (allDates.length >= 2) {
    const min = Math.min(...allDates), max = Math.max(...allDates);
    const span = max - min || 86400_000;
    const today = Date.now();
    const todayPct = ((today - min) / span * 100).toFixed(1);
    const showToday = today >= min && today <= max;
    ganttHtml = `<div class="r2-mini-gantt">
      ${showToday ? `<span class="r2-mini-today" style="left:${todayPct}%" title="Сегодня"></span>` : ''}
      ${BLOCKS.map(b => {
        const ps = b.plan[0] && d[b.plan[0]] ? Date.parse(d[b.plan[0]]) : null;
        const pe = b.plan[b.plan.length - 1] && d[b.plan[b.plan.length - 1]] ? Date.parse(d[b.plan[b.plan.length - 1]]) : ps;
        if (!ps) return '';
        const left = ((ps - min) / span * 100).toFixed(1);
        const width = Math.max(0.5, ((pe - ps) / span * 100)).toFixed(1);
        const factStart = b.fact[0] && d[b.fact[0]] ? Date.parse(d[b.fact[0]]) : null;
        const factEnd   = b.fact[b.fact.length - 1] && d[b.fact[b.fact.length - 1]] ? Date.parse(d[b.fact[b.fact.length - 1]]) : factStart;
        const factMarker = factEnd ? (() => {
          const fLeft = ((factEnd - min) / span * 100).toFixed(1);
          return `<span class="r2-mini-fact r2-mini-fact-${b.id}" style="left:${fLeft}%" title="Факт ${b.label}: ${_fmtDate(new Date(factEnd).toISOString())}"></span>`;
        })() : '';
        return `<div class="r2-mini-row" title="${escapeHtml(b.label)}">
          <span class="r2-mini-rowlabel">${escapeHtml(b.label)}</span>
          <div class="r2-mini-track">
            <span class="r2-mini-plan r2-phase-bg-${b.id === 'fixation' ? 'creation' : b.id === 'ift' || b.id === 'nt' ? 'stabilize' : b.id === 'uat' ? 'uat' : 'deploy'}" style="left:${left}%; width:${width}%" title="План ${b.label}: ${_fmtDate(new Date(ps).toISOString())} → ${_fmtDate(new Date(pe).toISOString())}"></span>
            ${factMarker}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  // Detail blocks — 2-column Plan/Fact pair с дельтой
  const blockHtmls = BLOCKS.map(b => {
    const allKeys = [...b.plan, ...b.fact];
    const hasAny = allKeys.some(k => d[k]);
    if (!hasAny) return `<details class="r2-lc-block r2-lc-empty"><summary>${escapeHtml(b.label)} — нет данных</summary></details>`;

    const planRows = b.plan.map(k => `
      <div class="r2-lc-cell">
        <span class="r2-lc-key">${escapeHtml(labelMap[k] || k)}</span>
        <span class="r2-lc-val">${escapeHtml(_fmtDate(d[k], { withTime: _DATETIME_KEYS.has(k) ? 'auto' : false, withYear: 'auto' }))}</span>
      </div>`).join('');

    const factRows = b.fact.length
      ? b.fact.map(k => {
          // Пара план→факт: ищем парный план
          const pairPlan = b.plan.find(pk => pk.replace(/^plan/, '') === k.replace(/^fact/, ''));
          const delta = pairPlan ? _deltaDays(d[pairPlan], d[k]) : null;
          const deltaStr = delta !== null
            ? `<span class="r2-lc-delta r2-lc-delta-${delta > 0 ? 'late' : delta < 0 ? 'early' : 'ontime'}" title="${delta > 0 ? 'опоздание' : delta < 0 ? 'раньше срока' : 'в срок'}">${delta >= 0 ? '+' : ''}${delta}д</span>`
            : '';
          return `<div class="r2-lc-cell">
            <span class="r2-lc-key">${escapeHtml(labelMap[k] || k)}</span>
            <span class="r2-lc-val">${escapeHtml(_fmtDate(d[k], { withTime: _DATETIME_KEYS.has(k) ? 'auto' : false, withYear: 'auto' }))}${deltaStr}</span>
          </div>`;
        }).join('')
      : '<div class="r2-lc-cell r2-lc-pending">—</div>';

    return `<div class="r2-lc-block">
      <div class="r2-lc-header">${escapeHtml(b.label)}</div>
      <div class="r2-lc-grid">
        <div class="r2-lc-col">
          <div class="r2-lc-coltitle">План</div>
          ${planRows}
        </div>
        <div class="r2-lc-col">
          <div class="r2-lc-coltitle">Факт</div>
          ${factRows}
        </div>
      </div>
    </div>`;
  }).join('');

  return `<div class="r2-section">
    <div class="r2-section-title">Timeline</div>
    ${ganttHtml || '<div class="r2-empty-tab">Недостаточно дат для timeline</div>'}
  </div>
  <div class="r2-lc-blocks">${blockHtmls}</div>`;
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

/**
 * V22+ Phase 5.2 — policy-driven value rendering.
 * Guards: empty-array → '—'; URL-detection в string; muted-render для blocked users;
 * '·' separator для sub-tags; SPO heuristic-split для rich; download-link для distrib URL.
 */
function _renderValue(v, kind) {
  // Guards (P0 — пустоты)
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v) && v.length === 0) return '—';

  switch (kind) {
    case 'date':
      // Plan-даты — без time (Birman date policy). Год по auto-правилу.
      return escapeHtml(_fmtDate(v, { withYear: 'auto' }));
    case 'datetime':
      // Fact / event-времена — с HH:MM если != 00:00.
      return escapeHtml(_fmtDate(v, { withTime: 'auto', withYear: 'auto' }));
    case 'user':
      return _userLabel(v);
    case 'users[]':
      return (v || []).map(u => _userLabel(u)).join(' · ');
    case 'option':
      return escapeHtml(String(v));
    case 'string': {
      const str = String(v);
      // URL-detection: если содержит http(s), отдаём chip-list
      if (/^https?:\/\//i.test(str.trim()) || /(\s|;|,)https?:\/\//i.test(str)) {
        return _renderUrlChips(str);
      }
      return escapeHtml(str);
    }
    case 'rich': {
      const str = String(v);
      // Heuristic-split для SPO-подобных слипшихся строк
      const items = _splitSpoString(str);
      if (items && items.length > 1) {
        return `<ul class="r2-rich-list">${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
      }
      // Иначе обычный rich-text (не mono, Brand-fix)
      return `<div class="r2-rich">${escapeHtml(str)}</div>`;
    }
    case 'options[]':
      return (v || []).map(x => escapeHtml(String(x))).join(' · ');
    case 'kg[]':
    case 'distrib[]':
    case 'service[]':
      return (v || []).map(item => {
        const main = escapeHtml(item.value || item.name || '');
        const subParts = [];
        if (item.version) subParts.push(`<span class="r2-field-sub">v${escapeHtml(item.version)}</span>`);
        if (item.statusDetailed) subParts.push(`<span class="r2-field-sub">${escapeHtml(item.statusDetailed)}</span>`);
        const sub = subParts.length ? ` · ${subParts.join(' · ')}` : '';
        const urlLink = item.url
          ? ` <a class="r2-url-chip" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(item.url)}">${ICONS.external}</a>`
          : '';
        return `<div class="r2-kg-item">${main}${sub}${urlLink}</div>`;
      }).join('');
    default:
      return escapeHtml(String(v));
  }
}

/* ─────────────────────────────────────────────────────────────
   Footer + helpers
   ───────────────────────────────────────────────────────────── */

function _renderFooter(analysed) {
  if (!analysed) return '';
  // V22+ Phase 5.1 — MD-export переехал сюда из toolbar (раз-в-неделю action,
  // не daily). Plus JQL details рядом.
  return `<div class="r2-footer-bar">
    <button class="r2-btn r2-btn-ghost r2-footer-export" data-r2-action="export-md" title="Экспорт текущего вида в Markdown">${ICONS.download} Экспорт MD</button>
    ${analysed?.jql ? `<details class="r2-footer">
      <summary>JQL</summary>
      <pre class="r2-jql">${escapeHtml(analysed.jql)}</pre>
    </details>` : ''}
  </div>`;
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
