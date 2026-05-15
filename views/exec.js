'use strict';
/* ============================================================
   ExecView — i3 (codebase-04 audit) — CEO-режим: 1 экран KPI.

   Цель: CEO открывает Призму перед стендапом и видит за 5 секунд:
     1. Какие релизы под риском.
     2. Кто перегружен / недозагружен (capacity heatmap).
     3. Главные dependency hotspots (cross-team зависимости).
     4. Burn-down per release.
     5. Сегодняшние блокеры.
     6. Plan stability — сколько мутаций за 7 дней.

   Read-only: все интерактивные операции — из других секций.
   Каждый тайл имеет drill-кнопку, ведущую в нужную секцию с фильтром.

   AUDIT-ART #23 (high) — reading layout как primary, tile-grid как
     fallback. Hero-line + 1 column со story вместо 6 KPI-плиток.
     Toggle снизу страницы. localStorage `prizma.exec.layout`.
   AUDIT-ART #24 (medium) — subhero-line с временем/датой/контекстом
     стендапа после h1, до основного содержимого.
   ============================================================ */

import { state } from '../state.js';
import { Utils } from '../utils.js';
import { renderHero } from '../app/prizmaUI.js';
import { SlideDeck } from '../app/exportSlideDeck.js';
import { AIPipeline } from '../ai/AIPipeline.js';
import { computeCeoActionFeed, computeProjectHealth, computeRiskNarrative } from '../ai/UnifiedFallbackEngine.js';
import { Services } from '../app/services.js';
// AUDIT_HOLISTIC O6 — TODO: вместо ручного _buildExecData можно подписаться
//   на `AIPipeline.run('exec_aggregate', { rows })` (см. ai/blockConfig.js).
//   Пока оставлено как есть, чтобы не менять поведение exec-tile'ов.
// renderPageHeader не используем — у exec view свой компактный header,
// чтобы не тратить вертикаль (CEO открывает «один экран без скролла»).

const RELEASES = [
  { key: '120', label: '1.20', flag: 'hasRelease120', types: 'release120Types' },
  { key: '121', label: '1.21', flag: 'hasRelease121', types: 'release121Types' },
  { key: '122', label: '1.22', flag: 'hasRelease122', types: 'release122Types' },
  { key: 'ot',  label: 'Овертайм', flag: 'hasOvertime', types: 'overtimeTypes' },
];

const LAYOUT_STORAGE_KEY = 'prizma.exec.layout';
const LAYOUT_DEFAULT = 'reading';

function _readLayout() {
  try {
    const v = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return v === 'tiles' || v === 'reading' || v === 'steerco-brief' ? v : LAYOUT_DEFAULT;
  } catch (_) { return LAYOUT_DEFAULT; }
}
function _writeLayout(v) {
  try { localStorage.setItem(LAYOUT_STORAGE_KEY, v); } catch (_) {}
}

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _signalClass(level) {
  // level: 'critical' | 'warning' | 'info' | 'success'
  return ({
    critical: 'exec-tile-critical',
    warning:  'exec-tile-warning',
    info:     'exec-tile-info',
    success:  'exec-tile-success',
  })[level] || '';
}

function _tile({ title, value, sub, drill, level }) {
  const drillBtn = drill
    ? `<button class="exec-tile-drill" data-section="${_esc(drill.section)}" data-filter='${_esc(JSON.stringify(drill.filter || {}))}' aria-label="${_esc(drill.label)}">${_esc(drill.label)} →</button>`
    : '';
  return `<div class="exec-tile ${_signalClass(level)}">
    <div class="exec-tile-eyebrow">${_esc(title)}</div>
    <div class="exec-tile-value">${value}</div>
    ${sub ? `<div class="exec-tile-sub">${sub}</div>` : ''}
    ${drillBtn}
  </div>`;
}

/* ── Data builders (общая часть для tile + reading layout) ───── */

function _buildExecData(rows) {
  // 1. At-risk releases
  const atRiskList = RELEASES.filter(rel => {
    const inRel = rows.filter(r => r[rel.flag] && !r.isDone);
    return inRel.some(r => r.blockingDependency || (r.riskFlags || []).length);
  });

  // 2. Capacity (top loaded)
  const load = new Map();
  for (const r of rows) {
    if (r.isDone) continue;
    const a = (r.assignee || '').trim();
    if (!a) continue;
    load.set(a, (load.get(a) || 0) + 1);
  }
  const sortedLoad = [...load.entries()].sort((a, b) => b[1] - a[1]);
  const top3Load = sortedLoad.slice(0, 3);
  const overloaded = sortedLoad.filter(([, n]) => n >= 8);

  // 3. Dependency hotspots
  const hotspots = rows
    .filter(r => !r.isDone && r.teamDependency)
    .map(r => {
      const deps = String(r.teamDependency).split(/[,;]/).map(s => s.trim()).filter(Boolean);
      const otherTeams = deps.filter(d => d.toLowerCase() !== String(r.team || '').toLowerCase()).length;
      return { row: r, count: otherTeams };
    })
    .filter(h => h.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // 4. Burn-down per release
  const burnStats = RELEASES.map(rel => {
    const inRel = rows.filter(r => r[rel.flag]);
    if (!inRel.length) return null;
    const done = inRel.filter(r => r.isDone).length;
    const pct = Math.round((done / inRel.length) * 100);
    return { label: rel.label, total: inRel.length, done, pct };
  }).filter(Boolean);
  const overallPct = burnStats.length
    ? Math.round(burnStats.reduce((a, s) => a + s.pct, 0) / burnStats.length)
    : 0;
  const laggingRelease = burnStats
    .filter(s => s.pct < 60)
    .sort((a, b) => a.pct - b.pct)[0] || null;

  // 5. Today's blockers
  const blockers = rows.filter(r => r.blockingDependency && !r.isDone);
  const blockerTeams = new Set(blockers.map(b => b.team).filter(Boolean));

  // 6. Plan stability (7d)
  const log = Array.isArray(state.actionLog) ? state.actionLog : [];
  const since = Date.now() - 7 * 24 * 3600 * 1000;
  const mutations = log.filter(e => {
    const ts = Date.parse(e.at || '') || 0;
    return ts >= since && (e.category === 'data' || e.category === 'ai');
  });

  return {
    atRiskList,
    sortedLoad, top3Load, overloaded,
    hotspots,
    burnStats, overallPct, laggingRelease,
    blockers, blockerTeams,
    mutations,
  };
}

/* ── Worst-state for hero ────────────────────────────────────── */

function _worstState(data) {
  // Возвращает объект для hero: { kpi, caption, signal, state }
  // Логика приоритета (хуже к лучше):
  //   1. ≥2 релиза под риском → off-course
  //   2. ≥5 блокеров сегодня → off-course
  //   3. 1 релиз под риском → drift
  //   4. ≥2 человека перегружены → drift
  //   5. лаг релиза (< 60% при общем средне < 70%) → drift
  //   6. mutations > 60 за 7д → drift (волатильно)
  //   7. иначе → on-course
  const atRisk = data.atRiskList.length;
  const blockers = data.blockers.length;
  const overloaded = data.overloaded.length;
  const lagging = data.laggingRelease;
  const overall = data.overallPct;
  const muts = data.mutations.length;

  if (atRisk >= 2) {
    return {
      kpi: `${atRisk} релиза в дрейфе`,
      caption: 'Несколько релизов одновременно отклонились от курса — нужна коррекция',
      signal: 'off-course',
      state: 'off-course',
    };
  }
  if (blockers >= 5) {
    return {
      kpi: `${blockers} блокеров сегодня`,
      caption: `Утро будет плотным — задачи стоят в ${data.blockerTeams.size} команд${data.blockerTeams.size === 1 ? 'е' : 'ах'}`,
      signal: 'off-course',
      state: 'off-course',
    };
  }
  if (atRisk >= 1) {
    const r = data.atRiskList[0];
    return {
      kpi: `Релиз ${r.label} в дрейфе`,
      caption: 'Один релиз требует внимания — проверить блокеры и риск-флаги',
      signal: 'drift',
      state: 'drift',
    };
  }
  if (overloaded >= 2) {
    return {
      kpi: `${overloaded} человека перегружены`,
      caption: 'Капасити сместился — стоит обсудить перераспределение',
      signal: 'drift',
      state: 'drift',
    };
  }
  if (lagging && overall < 70) {
    return {
      kpi: `Релиз ${lagging.label} ${lagging.pct}%`,
      caption: 'Один релиз отстаёт от плана — burn-down ниже среднего',
      signal: 'drift',
      state: 'drift',
    };
  }
  if (muts > 60) {
    return {
      kpi: 'План волатилен',
      caption: `${muts} изменений за 7 дней — много движения, возможна неустойчивость`,
      signal: 'drift',
      state: 'drift',
    };
  }
  return {
    kpi: 'Курс ровный',
    caption: 'Релизы в графике, перегрузов нет, блокеры под контролем',
    signal: 'on-course',
    state: 'on-course',
  };
}

/* ── Tile builders ───────────────────────────────────────── */

function _atRiskReleasesTile(data) {
  const total = data.atRiskList.length;
  const detail = data.atRiskList.length
    ? data.atRiskList.map(r => `<span class="exec-pill">${_esc(r.label)}</span>`).join(' ')
    : '<span class="empty-inline">Тревожных зон нет</span>';
  const level = total >= 2 ? 'critical' : total >= 1 ? 'warning' : 'success';
  return _tile({
    title: 'Релизы под риском',
    value: `<span class="exec-num">${total}</span> <span class="exec-num-of">из ${RELEASES.length}</span>`,
    sub: detail,
    drill: total ? { section: 'gantt', filter: { onlyRisky: true }, label: 'Открыть Гант' } : null,
    level,
  });
}

function _capacityHeatmapTile(data) {
  const total = data.sortedLoad.length;
  const level = data.overloaded.length >= 2 ? 'warning' : 'info';
  const sub = data.top3Load.length
    ? data.top3Load.map(([name, n]) => `<div class="exec-row"><span>${_esc(Utils.truncate(name, 22))}</span><span class="exec-num${n >= 8 ? ' exec-num-warn' : ''}">${n}</span></div>`).join('')
    : '<span class="empty-inline">Нет назначений</span>';
  return _tile({
    title: 'Загрузка · топ-3',
    value: `<span class="exec-num">${total}</span> <span class="exec-num-of">исполнителей</span>`,
    sub,
    drill: { section: 'employees', filter: {}, label: 'Все исполнители' },
    level,
  });
}

function _dependencyHotspotsTile(data) {
  const hotspots = data.hotspots;
  const level = hotspots.length >= 2 ? 'warning' : hotspots.length >= 1 ? 'info' : 'success';
  const sub = hotspots.length
    ? hotspots.map(h => `<div class="exec-row"><span>${_esc(Utils.truncate(h.row.epic || h.row.tasks || '—', 28))}</span><span class="exec-num">${h.count}</span></div>`).join('')
    : '<span class="empty-inline">Тревожных зон нет</span>';
  return _tile({
    title: 'Dependency hotspots',
    value: `<span class="exec-num">${hotspots.length}</span> <span class="exec-num-of">эпик${hotspots.length === 1 ? '' : 'ов'}</span>`,
    sub,
    drill: hotspots.length ? { section: 'gantt', filter: {}, label: 'В Гант' } : null,
    level,
  });
}

function _burnDownPerReleaseTile(data) {
  const overall = data.overallPct;
  const level = overall >= 70 ? 'success' : overall >= 40 ? 'info' : 'warning';
  const sub = data.burnStats.length
    ? data.burnStats.map(s => `<div class="exec-row"><span>${_esc(s.label)}</span><span class="exec-num">${s.pct}%</span><span class="exec-bar"><i style="--p:${s.pct}"></i></span></div>`).join('')
    : '<span class="empty-inline">Нет данных</span>';
  return _tile({
    title: 'Burn-down · релизы',
    value: `<span class="exec-num">${overall}</span><span class="exec-num-of">% средне</span>`,
    sub,
    drill: { section: 'metrics', filter: {}, label: 'Метрики' },
    level,
  });
}

function _todayBlockersTile(data) {
  const total = data.blockers.length;
  const teams = data.blockerTeams;
  const level = total >= 5 ? 'critical' : total >= 1 ? 'warning' : 'success';
  const sub = total
    ? data.blockers.slice(0, 3).map(b => `<div class="exec-row"><span>${_esc(Utils.truncate(b.epic || b.tasks || '—', 28))}</span><span class="exec-num-tag">${_esc(Utils.truncate(b.team || '—', 10))}</span></div>`).join('')
      + (total > 3 ? `<div class="exec-row exec-row-more">+${total - 3} ещё…</div>` : '')
    : '<span class="empty-inline">Блокеров нет</span>';
  return _tile({
    title: 'Блокеры сегодня',
    value: `<span class="exec-num">${total}</span> <span class="exec-num-of">в ${teams.size} команд${teams.size === 1 ? 'е' : 'ах'}</span>`,
    sub,
    drill: total ? { section: 'registry', filter: { onlyBlocking: true }, label: 'В Реестр' } : null,
    level,
  });
}

function _planStabilityTile(data) {
  const total = data.mutations.length;
  const level = total < 20 ? 'success' : total <= 60 ? 'info' : 'warning';
  const stabilityLabel = total < 20 ? 'стабильно' : total <= 60 ? 'активно' : 'волатильно';
  return _tile({
    title: 'Стабильность плана · 7д',
    value: `<span class="exec-num">${total}</span> <span class="exec-num-of">${stabilityLabel}</span>`,
    sub: `<span class="empty-inline">Изменений в данных за неделю</span>`,
    drill: { section: 'history', filter: {}, label: 'История' },
    level,
  });
}

function renderTileGrid(data) {
  return `<div class="exec-grid">
    ${_atRiskReleasesTile(data)}
    ${_capacityHeatmapTile(data)}
    ${_dependencyHotspotsTile(data)}
    ${_burnDownPerReleaseTile(data)}
    ${_todayBlockersTile(data)}
    ${_planStabilityTile(data)}
  </div>`;
}

/* ── Reading layout (AUDIT-ART #23) ──────────────────────────── */

function _storyItem({ eyebrow, headline, hint, drill }) {
  const drillBtn = drill
    ? `<button class="exec-story-drill" data-section="${_esc(drill.section)}" data-filter='${_esc(JSON.stringify(drill.filter || {}))}'>${_esc(drill.label)} →</button>`
    : '';
  return `<div class="exec-story-item">
    <div class="exec-story-eyebrow">${_esc(eyebrow)}</div>
    <div class="exec-story-headline">${headline}</div>
    ${hint ? `<div class="exec-story-hint">${_esc(hint)}</div>` : ''}
    ${drillBtn}
  </div>`;
}

function _storyHumans(data) {
  if (!data.overloaded.length && !data.top3Load.length) {
    return _storyItem({
      eyebrow: 'ЛЮДИ',
      headline: '<span class="exec-story-num">Назначений пока нет</span>',
      hint: 'Реестр пуст или поле «исполнитель» не заполнено',
    });
  }
  if (data.overloaded.length) {
    const main = data.overloaded[0];
    const rest = data.overloaded.length - 1;
    const headline = rest > 0
      ? `<span class="exec-story-num">${data.overloaded.length}</span> человек${data.overloaded.length === 1 ? '' : 'а'} перегружены, главный — ${_esc(Utils.truncate(main[0], 28))}`
      : `<span class="exec-story-num">${main[1]}</span> задач у ${_esc(Utils.truncate(main[0], 28))} — перегруз`;
    return _storyItem({
      eyebrow: 'ЛЮДИ',
      headline,
      hint: 'Капасити сместился. Стоит обсудить перераспределение или сдвинуть дедлайны.',
      drill: { section: 'employees', filter: {}, label: 'Открыть исполнителей' },
    });
  }
  const main = data.top3Load[0];
  return _storyItem({
    eyebrow: 'ЛЮДИ',
    headline: `Загрузка ровная, лидер — <span class="exec-story-num">${main[1]}</span> задач у ${_esc(Utils.truncate(main[0], 28))}`,
    hint: 'Перегрузов нет, можно работать в штатном темпе.',
    drill: { section: 'employees', filter: {}, label: 'Открыть исполнителей' },
  });
}

function _storyReleases(data) {
  if (!data.burnStats.length) {
    return _storyItem({
      eyebrow: 'РЕЛИЗЫ',
      headline: '<span class="exec-story-num">Нет данных</span>',
      hint: 'У задач не проставлены релизные флаги.',
    });
  }
  if (data.atRiskList.length >= 1) {
    const r = data.atRiskList[0];
    const stat = data.burnStats.find(s => s.label === r.label);
    const pct = stat ? stat.pct : null;
    const headline = pct !== null
      ? `Релиз <span class="exec-story-num">${_esc(r.label)}</span> · <span class="exec-story-num">${pct}%</span> — отстаёт от плана`
      : `Релиз <span class="exec-story-num">${_esc(r.label)}</span> — под риском`;
    return _storyItem({
      eyebrow: 'РЕЛИЗЫ',
      headline,
      hint: data.atRiskList.length > 1
        ? `Ещё ${data.atRiskList.length - 1} релиз${data.atRiskList.length - 1 === 1 ? '' : 'а'} в дрейфе.`
        : 'Проверьте блокеры и риск-флаги в Ганте.',
      drill: { section: 'gantt', filter: { onlyRisky: true }, label: 'Открыть Гант' },
    });
  }
  if (data.laggingRelease && data.overallPct < 70) {
    const r = data.laggingRelease;
    return _storyItem({
      eyebrow: 'РЕЛИЗЫ',
      headline: `Релиз <span class="exec-story-num">${_esc(r.label)}</span> · <span class="exec-story-num">${r.pct}%</span> — отстаёт от плана`,
      hint: `Среднее по портфелю — ${data.overallPct}%, этот релиз ниже.`,
      drill: { section: 'metrics', filter: {}, label: 'В Метрики' },
    });
  }
  return _storyItem({
    eyebrow: 'РЕЛИЗЫ',
    headline: `Все релизы в графике · среднее <span class="exec-story-num">${data.overallPct}%</span>`,
    hint: 'Burn-down ровный, отстающих нет.',
    drill: { section: 'metrics', filter: {}, label: 'В Метрики' },
  });
}

function _storyBlockers(data) {
  const total = data.blockers.length;
  if (!total) {
    return _storyItem({
      eyebrow: 'БЛОКЕРЫ',
      headline: '<span class="exec-story-num">Блокеров нет</span>',
      hint: 'Сегодня ничего не стоит на ожидании другой команды.',
    });
  }
  const tCount = data.blockerTeams.size;
  return _storyItem({
    eyebrow: 'БЛОКЕРЫ',
    headline: `Завтра <span class="exec-story-num">${total}</span> блокер${total === 1 ? '' : total < 5 ? 'а' : 'ов'} в ${tCount} команд${tCount === 1 ? 'е' : 'ах'}`,
    hint: total >= 5
      ? 'Утро будет плотным — стоит начать стендап с этих задач.'
      : 'Эти задачи стоят в ожидании другой команды.',
    drill: { section: 'registry', filter: { onlyBlocking: true }, label: 'В Реестр' },
  });
}

function renderReadingLayout(data) {
  const worst = _worstState(data);
  const hero = renderHero({
    kpi: worst.kpi,
    caption: worst.caption,
    signal: worst.signal,
    state: worst.state,
  });
  return `<div class="exec-reading">
    ${hero}
    <div class="exec-story-column">
      ${_storyHumans(data)}
      ${_storyReleases(data)}
      ${_storyBlockers(data)}
    </div>
  </div>`;
}

/* ── SteerCo brief aggregator (AUDIT_HOLISTIC §5.2) ──────────── */

/**
 * Безопасный getter для BlackDashboard модели — он опционально
 * хранится во `window.BlackDashboard._model` (заполнен после
 * первого открытия чёрного дашборда). Если не загружен — возвращаем
 * пустую sigma-структуру (renderer/exporter показывают «данных нет»).
 */
function _readBlackDashboardData() {
  try {
    const m = (typeof window !== 'undefined' && Services.BlackDashboard?._model) || null;
    if (!m) return null;
    return {
      summary:        m.summary || { totalGoals: 0, linkedCount: 0, unlinkedCount: 0, coveragePct: 0 },
      coverageByTeam: Array.isArray(m.coverageByTeam) ? m.coverageByTeam.slice(0, 8) : [],
      goalsCount:     Array.isArray(m.goals) ? m.goals.length : 0,
      fetchedAt:      m.fetchedAt || null,
    };
  } catch (_) { return null; }
}

/**
 * Top-N hygiene/action items: пытаемся прочитать через ActionLayer
 * (window.ActionLayer.getTop?), иначе строим эвристически из rows
 * (блокеры + неподтверждённый scope + без релиза).
 */
function _readActionLayerTop(rows, n = 5) {
  try {
    const fn = (typeof window !== 'undefined' && Services.ActionLayer?.getTop);
    if (typeof fn === 'function') {
      const arr = fn(n);
      if (Array.isArray(arr) && arr.length) return arr.slice(0, n);
    }
  } catch (_) { /* fall through */ }
  // Heuristic fallback — строим из rows.
  const items = [];
  const blockers = rows.filter(r => r.blockingDependency && !r.isDone);
  if (blockers.length) {
    items.push({ id: 'fix_blockers', title: `Разблокировать ${blockers.length} задач`, kind: 'hygiene' });
  }
  const unconfirmed = rows.filter(r => !r.isDone && r.scopeStatus === 'Требует подтверждения');
  if (unconfirmed.length >= 2) {
    items.push({ id: 'confirm_scope', title: `Подтвердить scope у ${unconfirmed.length} задач`, kind: 'hygiene' });
  }
  const noRel = rows.filter(r => !r.isDone && r.scopeStatus === 'Да' && !r.hasRelease120 && !r.hasRelease121 && !r.hasRelease122 && !r.hasOvertime);
  if (noRel.length >= 3) {
    items.push({ id: 'distribute_no_release', title: `Распределить ${noRel.length} задач по релизам`, kind: 'hygiene' });
  }
  return items.slice(0, n);
}

/**
 * Главный нарратив для hero — выбираем 1 фразу из всех источников
 * по приоритету (worst → best). Используем уже посчитанный _worstState.
 */
function _composeOverallNarrative(data, healthBlock) {
  const worst = _worstState(data);
  const summary = healthBlock?.summary ? String(healthBlock.summary) : '';
  // worst.caption уже содержит story-формулировку; здоровье добавляем
  // как факт, если оно отличается от worst.
  if (summary && worst.state === 'on-course') return summary;
  if (summary) return `${worst.caption}. ${summary}`;
  return worst.caption;
}

/**
 * Собрать SteerCo brief из 4 источников: AI Health, AI Risk, BlackDashboard,
 * AI CEO action feed. Identity-deterministic — никаких fuzzy-name-matches.
 *
 * @param {Array} rows
 * @param {Array} [employees]
 * @returns {Promise<object>} brief
 */
async function _buildSteerCoBrief(rows, employees) {
  const _rows = Array.isArray(rows) ? rows : [];
  const _employees = Array.isArray(employees) ? employees : [];
  const data = _buildExecData(_rows);

  // 1. Portfolio health через AIPipeline (с fallback на прямую функцию,
  //    если pipeline не зарегистрирован — например в node-тестах без bootstrap).
  let healthBlock;
  try {
    const r = await AIPipeline.run('health', { rows: _rows, employees: _employees }, { skipLLM: true });
    healthBlock = (r && r.data) || computeProjectHealth(_rows);
  } catch (_) {
    healthBlock = computeProjectHealth(_rows);
  }

  // 2. Risk narrative через AIPipeline (fallback так же).
  let riskBlock;
  try {
    const r = await AIPipeline.run('risk_narrative', { rows: _rows, employees: _employees }, { skipLLM: true });
    riskBlock = (r && r.data) || computeRiskNarrative(_rows);
  } catch (_) {
    riskBlock = computeRiskNarrative(_rows);
  }

  // 3. BlackDashboard data (read-only getter).
  const blackDashboardData = _readBlackDashboardData();

  // 4. CEO action feed — через UnifiedFallback, без LLM (он же и backing
  //    для AIPipeline.run('ceo_action_feed'), но нам нужен синхронный shape).
  const actionFeed = computeCeoActionFeed(_rows);
  const feedItems = Array.isArray(actionFeed?.items) ? actionFeed.items : [];

  // 5. Top-3 risks: top off-course rows (blocking + scope-unconfirmed
  //    + risk flags). Берём из data.atRiskList + blockers как row-источников.
  const top3Risks = [];
  data.atRiskList.slice(0, 3).forEach(rel => {
    const stat = data.burnStats.find(s => s.label === rel.label);
    top3Risks.push({
      title: `Релиз ${rel.label} в дрейфе`,
      reason: stat ? `burn-down ${stat.pct}%` : 'риск-флаги',
      kind: 'release',
    });
  });
  if (top3Risks.length < 3) {
    data.blockers.slice(0, 3 - top3Risks.length).forEach(b => {
      top3Risks.push({
        title: b.epic || b.tasks || '—',
        reason: b.team || 'блокер',
        kind: 'blocker',
        epic: b.epic, team: b.team,
      });
    });
  }

  // 6. Overall: worst signal + 1 phrase narrative.
  const worst = _worstState(data);
  const narrative = _composeOverallNarrative(data, healthBlock);

  // 7. Top-5 actions из ActionLayer (или эвристика).
  const top5Actions = _readActionLayerTop(_rows, 5);

  // 8. KPI портфеля (3 главных).
  const totalActive = _rows.filter(r => !r.isDone).length;
  const totalDone   = _rows.filter(r => r.isDone).length;
  const total       = _rows.length;
  const donePct     = total ? Math.round((totalDone / total) * 100) : 0;

  // 9. Overload count (5+ задач у одного исполнителя).
  const overloadCount = data.sortedLoad.filter(([, n]) => n >= 5).length;

  return {
    meta: {
      date:    new Date().toISOString().slice(0, 10),
      builtAt: new Date().toISOString(),
      rowsCount: total,
    },
    overall: {
      state:     worst.state,
      narrative: narrative,
    },
    portfolio: {
      kpi: {
        total,
        done:     totalDone,
        donePct,
        blockers: data.blockers.length,
        risks:    _rows.filter(r => !r.isDone && (r.riskFlags || []).length).length,
      },
      health: healthBlock,
    },
    risks: {
      top3:      top3Risks,
      narrative: riskBlock,
    },
    coverage: {
      sigmaJira: blackDashboardData,
    },
    teams: {
      overload:   overloadCount,
      actionFeed: feedItems,
    },
    actions: {
      top5: top5Actions,
    },
  };
}

/* ── SteerCo brief layout ────────────────────────────────────── */

function _briefSection({ eyebrow, title, bodyHtml }) {
  return `<section class="exec-brief-section">
    <div class="exec-brief-eyebrow">${_esc(eyebrow)}</div>
    <h2 class="exec-brief-title">${_esc(title)}</h2>
    <div class="exec-brief-body">${bodyHtml}</div>
  </section>`;
}

function _briefBullets(arr, fmt) {
  const items = Array.isArray(arr) ? arr : [];
  if (!items.length) return `<div class="exec-brief-empty">Нет данных</div>`;
  return `<ul class="exec-brief-list">${items.map(i => `<li>${fmt(i)}</li>`).join('')}</ul>`;
}

function renderSteerCoBriefLayout(brief) {
  const stateLabel = ({ 'on-course': 'ровный', 'drift': 'дрейф', 'off-course': 'off-course' })[brief.overall.state] || '—';
  const heroSignal = brief.overall.state === 'off-course' ? 'off-course' : brief.overall.state === 'drift' ? 'drift' : 'on-course';
  const hero = renderHero({
    kpi:     `Курс: ${stateLabel}`,
    caption: brief.overall.narrative || '',
    signal:  heroSignal,
    state:   brief.overall.state,
  });

  const portfolioBody = `
    <div class="exec-brief-kpi-row">
      <div class="exec-brief-kpi"><span class="exec-brief-kpi-num">${brief.portfolio.kpi.total}</span><span class="exec-brief-kpi-lbl">всего</span></div>
      <div class="exec-brief-kpi"><span class="exec-brief-kpi-num">${brief.portfolio.kpi.donePct}%</span><span class="exec-brief-kpi-lbl">готово</span></div>
      <div class="exec-brief-kpi"><span class="exec-brief-kpi-num">${brief.portfolio.kpi.blockers}</span><span class="exec-brief-kpi-lbl">блокеры</span></div>
    </div>
    ${brief.portfolio.health?.summary ? `<p class="exec-brief-narrative">${_esc(brief.portfolio.health.summary)}</p>` : ''}
  `;

  const risksBody = _briefBullets(brief.risks.top3, r =>
    `<span class="exec-brief-risk-title">${_esc(r.title)}</span>` +
    (r.reason ? ` <span class="exec-brief-risk-reason">${_esc(r.reason)}</span>` : '')
  );

  let coverageBody;
  const sj = brief.coverage.sigmaJira;
  if (!sj) {
    coverageBody = `<div class="exec-brief-empty">Чёрный дашборд не загружен</div>`;
  } else {
    const s = sj.summary || {};
    coverageBody = `
      <div class="exec-brief-kpi-row">
        <div class="exec-brief-kpi"><span class="exec-brief-kpi-num">${s.totalGoals || 0}</span><span class="exec-brief-kpi-lbl">целей</span></div>
        <div class="exec-brief-kpi"><span class="exec-brief-kpi-num">${s.linkedCount || 0}</span><span class="exec-brief-kpi-lbl">привязано</span></div>
        <div class="exec-brief-kpi"><span class="exec-brief-kpi-num">${s.coveragePct || 0}%</span><span class="exec-brief-kpi-lbl">покрытие</span></div>
      </div>
      ${_briefBullets((sj.coverageByTeam || []).slice(0, 3), t =>
        `${_esc(t.name || t.pk)} · ${t.linked}/${t.total} (${t.pct}%)`)}
    `;
  }

  const teamsBody = `
    <p class="exec-brief-narrative">Перегруженных исполнителей: <span class="exec-brief-num">${brief.teams.overload}</span></p>
    ${_briefBullets((brief.teams.actionFeed || []).slice(0, 4), a => _esc(a.title || ''))}
  `;

  const actionsBody = _briefBullets(brief.actions.top5, a => _esc(a.title || a.name || a.epic || '—'));

  const exportBtn = `<div class="exec-brief-export">
    <button type="button" class="exec-brief-export-btn" data-action="exec-export-toggle" aria-expanded="false" aria-haspopup="menu">Экспорт ▾</button>
    <div class="exec-brief-export-menu" role="menu" hidden>
      <button type="button" role="menuitem" data-export="copy-md">Скопировать markdown</button>
      <button type="button" role="menuitem" data-export="download-md">Скачать .md</button>
      <button type="button" role="menuitem" data-export="download-pptx">Outline для PowerPoint</button>
    </div>
  </div>`;

  return `<div class="exec-brief">
    <div class="exec-brief-hero-row">
      ${hero}
      ${exportBtn}
    </div>
    ${_briefSection({ eyebrow: 'СЕКЦИЯ 1', title: 'Здоровье портфеля',         bodyHtml: portfolioBody })}
    ${_briefSection({ eyebrow: 'СЕКЦИЯ 2', title: 'Топ-3 риска',                bodyHtml: risksBody })}
    ${_briefSection({ eyebrow: 'СЕКЦИЯ 3', title: 'Покрытие квартальных целей', bodyHtml: coverageBody })}
    ${_briefSection({ eyebrow: 'СЕКЦИЯ 4', title: 'Команды и нагрузка',         bodyHtml: teamsBody })}
    ${_briefSection({ eyebrow: 'СЕКЦИЯ 5', title: 'Действия на неделю',         bodyHtml: actionsBody })}
  </div>`;
}

/* ── Subhero (AUDIT-ART #24) ─────────────────────────────────── */

const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                   'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function _pad2(n) { return n < 10 ? '0' + n : String(n); }

function _renderSubhero() {
  const now = new Date();
  const hh = _pad2(now.getHours());
  const mm = _pad2(now.getMinutes());
  const dateStr = `${now.getDate()} ${RU_MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  // Calendar-mode (минут до стендапа) — TODO: интегрировать с calendar-источником
  // когда он появится. Сейчас просто показываем «Сводка свежая на HH:MM».
  const fetchTs = state?.metadata?.fetchedAt || state?.metadata?.lastFetch;
  let freshPart = `Сводка свежая на ${hh}:${mm}`;
  if (fetchTs) {
    const f = new Date(fetchTs);
    if (!Number.isNaN(f.getTime())) {
      freshPart = `Сводка свежая на ${_pad2(f.getHours())}:${_pad2(f.getMinutes())}`;
    }
  }
  return `<div class="exec-subhero">${hh}:${mm} · ${_esc(dateStr)} · ${_esc(freshPart)}</div>`;
}

/* ── Layout toggle ───────────────────────────────────────────── */

function _renderLayoutToggle(active) {
  return `<div class="exec-layout-toggle" role="group" aria-label="Раскладка">
    <button class="exec-layout-btn${active === 'reading' ? ' active' : ''}" data-layout="reading">Чтение</button>
    <button class="exec-layout-btn${active === 'tiles' ? ' active' : ''}" data-layout="tiles">Плитки</button>
    <button class="exec-layout-btn${active === 'steerco-brief' ? ' active' : ''}" data-layout="steerco-brief">Brief</button>
  </div>`;
}

/* ── Runtime style inject ────────────────────────────────────── */

function _injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('audit-art-exec-style')) return;
  const style = document.createElement('style');
  style.id = 'audit-art-exec-style';
  style.textContent = `
    /* AUDIT-ART #24 — subhero */
    .exec-subhero {
      font-size: 13px;
      color: var(--prizma-text-secondary, var(--text-3));
      margin: 4px 0 16px;
      font-variant-numeric: tabular-nums;
      font-feature-settings: "tnum" 1, "lnum" 1;
      letter-spacing: 0.1px;
    }

    /* AUDIT-ART #23 — reading layout */
    .exec-reading {
      max-width: 720px;
      margin: 0 auto;
      padding: 8px 0 24px;
    }
    .exec-reading .prizma-hero {
      margin-bottom: 32px;
    }
    .exec-story-column {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .exec-story-item {
      background: var(--card);
      border: 1px solid var(--border-light, var(--border));
      border-radius: var(--radius, 8px);
      padding: 16px 20px;
      position: relative;
    }
    .exec-story-eyebrow {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
      color: var(--prizma-text-tertiary, var(--text-3));
      margin-bottom: 8px;
    }
    .exec-story-headline {
      font-size: 17px;
      line-height: 1.4;
      color: var(--text-1);
      margin-bottom: 6px;
    }
    .exec-story-num {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-variant-numeric: tabular-nums;
      font-feature-settings: "tnum" 1, "lnum" 1;
      font-weight: 600;
      color: var(--text-1);
    }
    .exec-story-hint {
      font-size: 13px;
      color: var(--prizma-text-secondary, var(--text-3));
      line-height: 1.45;
      margin-bottom: 8px;
    }
    .exec-story-drill {
      background: transparent;
      border: none;
      padding: 4px 0;
      font-size: 12px;
      color: var(--accent);
      cursor: pointer;
      letter-spacing: 0.2px;
    }
    .exec-story-drill:hover { text-decoration: underline; }

    /* Layout toggle */
    .exec-layout-toggle {
      display: flex;
      gap: 4px;
      justify-content: center;
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid var(--border-light, var(--border));
    }
    .exec-layout-btn {
      background: transparent;
      border: none;
      padding: 6px 14px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--prizma-text-tertiary, var(--text-3));
      cursor: pointer;
      border-bottom: 3px solid transparent;
      transition: color var(--motion-fast, 140ms) var(--ease-standard, ease);
    }
    .exec-layout-btn:hover { color: var(--text-1); }
    .exec-layout-btn.active {
      color: var(--text-1);
      border-bottom-color: var(--prizma-information, var(--accent));
    }

    /* AUDIT_HOLISTIC §5.2 — SteerCo brief layout */
    .exec-brief {
      max-width: 760px;
      margin: 0 auto;
      padding: 8px 0 24px;
    }
    .exec-brief-hero-row {
      position: relative;
      margin-bottom: 32px;
    }
    .exec-brief-export {
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 2;
    }
    .exec-brief-export-btn {
      background: var(--card);
      border: 1px solid var(--border-light, var(--border));
      border-radius: var(--radius, 8px);
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-1);
      cursor: pointer;
      letter-spacing: 0.3px;
    }
    .exec-brief-export-btn:hover {
      border-color: var(--prizma-information, var(--accent));
    }
    .exec-brief-export-menu {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      background: var(--card);
      border: 1px solid var(--border-light, var(--border));
      border-radius: var(--radius, 8px);
      box-shadow: 0 6px 24px rgba(0,0,0,0.08);
      padding: 4px;
      min-width: 220px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .exec-brief-export-menu[hidden] { display: none; }
    .exec-brief-export-menu button {
      background: transparent;
      border: none;
      padding: 8px 12px;
      text-align: left;
      font-size: 13px;
      color: var(--text-1);
      cursor: pointer;
      border-radius: 4px;
    }
    .exec-brief-export-menu button:hover {
      background: var(--surface-2, rgba(0,0,0,0.04));
    }
    .exec-brief-section {
      margin-bottom: 28px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border-light, var(--border));
    }
    .exec-brief-section:last-of-type {
      border-bottom: none;
    }
    .exec-brief-eyebrow {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
      color: var(--prizma-text-tertiary, var(--text-3));
      margin-bottom: 6px;
    }
    .exec-brief-title {
      font-size: 18px;
      font-weight: 600;
      margin: 0 0 12px;
      color: var(--text-1);
    }
    .exec-brief-body { font-size: 14px; line-height: 1.5; color: var(--text-1); }
    .exec-brief-empty {
      color: var(--prizma-text-tertiary, var(--text-3));
      font-size: 13px;
      font-style: italic;
    }
    .exec-brief-kpi-row {
      display: flex;
      gap: 24px;
      margin-bottom: 12px;
    }
    .exec-brief-kpi { display: flex; flex-direction: column; gap: 2px; }
    .exec-brief-kpi-num {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-variant-numeric: tabular-nums;
      font-feature-settings: "tnum" 1, "lnum" 1;
      font-size: 22px;
      font-weight: 600;
      color: var(--text-1);
    }
    .exec-brief-kpi-lbl {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--prizma-text-tertiary, var(--text-3));
    }
    .exec-brief-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .exec-brief-list li {
      padding-left: 14px;
      position: relative;
    }
    .exec-brief-list li::before {
      content: '';
      position: absolute;
      left: 0;
      top: 9px;
      width: 6px;
      height: 1px;
      background: var(--prizma-text-tertiary, var(--text-3));
    }
    .exec-brief-risk-title { font-weight: 600; }
    .exec-brief-risk-reason {
      color: var(--prizma-text-secondary, var(--text-3));
      font-size: 13px;
    }
    .exec-brief-narrative {
      margin: 0 0 8px;
      color: var(--prizma-text-secondary, var(--text-2, var(--text-1)));
    }
    .exec-brief-num {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
  `;
  document.head.appendChild(style);
}

/* ── Public API ──────────────────────────────────────────── */

export const ExecView = {
  // public: тестам и интеграциям нужен прямой доступ к aggregator
  // (без DOM/state-side-effect'ов).
  buildSteerCoBrief: _buildSteerCoBrief,

  render() {
    // F10/sj3 — отметить рендер.
    try { Services.App?.markRenderedNow?.(); } catch (_) {}
    _injectStyles();
    const section = document.getElementById('section-exec');
    if (!section) return;

    const layout = _readLayout();
    const data = _buildExecData(state.rows);

    if (layout === 'steerco-brief') {
      // Сначала рендерим placeholder + toggle, потом async-обновляем body.
      section.innerHTML = `
        <div class="exec-header">
          <div class="prizma-card-eyebrow">PRIZMA · CEO-РЕЖИМ</div>
          <h1 class="exec-title">SteerCo · сводный брифинг</h1>
          <div class="exec-sub">Готовый материал для квартальной встречи</div>
          ${_renderSubhero()}
          <div class="prizma-page-hairline"></div>
        </div>
        <div class="exec-brief-loading">Собираю сводку…</div>
        ${_renderLayoutToggle(layout)}
        <div class="exec-footer">
          Один экран — один нарратив. Экспорт в slide-deck markdown / pptx outline.
        </div>`;
      ExecView._bindLayoutToggle(section);
      // Async-build brief.
      _buildSteerCoBrief(state.rows, state.employees).then(brief => {
        // Защита: если пользователь успел переключить layout, не перерисовываем.
        if (_readLayout() !== 'steerco-brief') return;
        const placeholder = section.querySelector('.exec-brief-loading');
        if (!placeholder) return;
        placeholder.outerHTML = renderSteerCoBriefLayout(brief);
        ExecView._bindBriefExport(section, brief);
      }).catch(err => {
        const placeholder = section.querySelector('.exec-brief-loading');
        if (placeholder) placeholder.textContent = 'Не удалось собрать сводку: ' + (err?.message || err);
      });
      return;
    }

    const body = layout === 'tiles' ? renderTileGrid(data) : renderReadingLayout(data);

    section.innerHTML = `
      <div class="exec-header">
        <div class="prizma-card-eyebrow">PRIZMA · CEO-РЕЖИМ</div>
        <h1 class="exec-title">Курс одним экраном</h1>
        <div class="exec-sub">Что важно знать перед стендапом</div>
        ${_renderSubhero()}
        <div class="prizma-page-hairline"></div>
      </div>
      ${body}
      ${_renderLayoutToggle(layout)}
      <div class="exec-footer">
        Обновляется автоматически. Для деталей — клик по кнопке тайла.
      </div>`;
    ExecView._bindDrills(section);
    ExecView._bindStoryDrills(section);
    ExecView._bindLayoutToggle(section);
  },
  _bindDrills(root) {
    root.querySelectorAll('.exec-tile-drill').forEach(btn => {
      btn.addEventListener('click', () => {
        ExecView._drillTo(btn);
      });
    });
  },
  _bindStoryDrills(root) {
    root.querySelectorAll('.exec-story-drill').forEach(btn => {
      btn.addEventListener('click', () => {
        ExecView._drillTo(btn);
      });
    });
  },
  _drillTo(btn) {
    const section = btn.dataset.section;
    let filter = {};
    try { filter = JSON.parse(btn.dataset.filter || '{}'); } catch (_) {}
    if (filter && Object.keys(filter).length) {
      if (filter.onlyBlocking) state.filters.onlyBlocking = true;
      if (filter.onlyRisky)    state.filters.onlyRisky    = true;
      state.filters._source = 'exec';
    }
    try { Services.Nav?.goTo?.(section); } catch (_) {}
  },
  _bindLayoutToggle(root) {
    root.querySelectorAll('.exec-layout-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.layout;
        if (next !== 'reading' && next !== 'tiles' && next !== 'steerco-brief') return;
        _writeLayout(next);
        ExecView.render();
      });
    });
  },
  _bindBriefExport(root, brief) {
    const toggle = root.querySelector('.exec-brief-export-btn');
    const menu   = root.querySelector('.exec-brief-export-menu');
    if (!toggle || !menu) return;

    const closeMenu = () => {
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    };
    const openMenu = () => {
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
    };
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.hidden) openMenu(); else closeMenu();
    });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== toggle) closeMenu();
    }, { once: true });

    menu.querySelectorAll('button[data-export]').forEach(btn => {
      btn.addEventListener('click', async () => {
        closeMenu();
        const kind = btn.dataset.export;
        const date = brief?.meta?.date || new Date().toISOString().slice(0, 10);
        try {
          if (kind === 'copy-md') {
            const md = SlideDeck.exportMarkdown(brief);
            const ok = await SlideDeck.copyToClipboard(md);
            ExecView._toast(ok ? 'Markdown скопирован в буфер' : 'Не удалось скопировать', ok ? 'success' : 'error');
          } else if (kind === 'download-md') {
            const md = SlideDeck.exportMarkdown(brief);
            const ok = SlideDeck.download(`prizma-steerco-${date}.md`, md, 'text/markdown;charset=utf-8');
            ExecView._toast(ok ? 'Markdown скачан' : 'Не удалось скачать', ok ? 'success' : 'error');
          } else if (kind === 'download-pptx') {
            const txt = SlideDeck.exportPptxOutline(brief);
            const ok = SlideDeck.download(`prizma-steerco-${date}.txt`, txt, 'text/plain;charset=utf-8');
            ExecView._toast(ok ? 'Outline скачан' : 'Не удалось скачать', ok ? 'success' : 'error');
          }
        } catch (err) {
          ExecView._toast('Ошибка экспорта: ' + (err?.message || err), 'error');
        }
      });
    });
  },
  _toast(msg, type) {
    try {
      if (typeof window !== 'undefined' && Services.ToastQueue?.show) {
        Services.ToastQueue.show({ msg, type: type || 'success', ms: 2400 });
      }
    } catch (_) { /* toast best-effort */ }
  },
};

Services.register('ExecView', ExecView);
if (typeof window !== 'undefined') window.ExecView = ExecView;
