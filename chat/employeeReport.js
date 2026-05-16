'use strict';
/* ============================================================
   chat/employeeReport.js — V22+ Week 2 (LP-01..LP-08)

   Comprehensive employee deep-dive: cross-source отчёт за любой период.
   Главная новая фича чата за квартал/год.

   Public API:
     buildEmployeeReport(target, period, opts?) → Promise<structured>
       · target — output от resolveTarget() (имеет .employee + .period)
       · period — { from, to, label } (или target.period)
       · opts   — { signal?, sources?, includeComparison?, preset? }
       · returns structured response: { text, cards, actions, drilldown, _meta }

   Structured-response секции:
     1. Summary block (LP-05) — top-3 highlights + composite счёт активности
     2. Jira section (LP-02) — closed/in-progress, by-type, by-project
     3. BB section (LP-03) — PRs created/merged/reviewed, top repos
     4. CF section (LP-04) — pages created/edited, by space
     5. Trend (LP-07) — per-week breakdown SVG sparkline (для длинных периодов)
     6. Period-over-period (LP-06) — comparison toggle (если includeComparison)

   Preset modes (LP-08):
     · 'review'    — performance review template (achievements, growth, recs)
     · 'standup'   — short morning brief
     · 'weekly'    — weekly highlights
     · default     — full report

   Контракты:
     · Если employee пустой — возвращает err-structured «нужно указать сотрудника».
     · Sources guard через checkSourcesAvailable.
     · Не зависит от LLM — все секции rule-based.
     · Период >30 дней → fetcher (I-09); ≤30 дней → может использовать
       snapshots (I-10) для скорости.
   ============================================================ */

import {
  fetchEmployeeAllSources,
  summarizeJiraItems,
  summarizeBBItems,
  summarizeCFItems,
} from './historicalFetcher.js';
import { checkSourcesAvailable } from './resolveTarget.js';
import { linkTo, buildDefaultLinks, externalJiraLink } from './linkTo.js';
import { periodDays, previousPeriod } from './periodParser.js';
// V22+ Week 4 — LP-08 (review preset) + LP-09 (AI narrative).
import { buildReviewSections } from './reviewPreset.js';
import { generateAINarrative, injectNarrative } from './aiNarrative.js';

const DAY_MS = 86400_000;

/* ─────────────────────────────────────────────────────────────
   Main builder — LP-01
   ───────────────────────────────────────────────────────────── */

/**
 * @param {object} target — resolveTarget output (employee, period, sources)
 * @param {object} period — optional override
 * @param {object} opts   — { signal?, sources?, includeComparison?, preset?, prefetched? }
 * @returns {Promise<structured>}
 */
export async function buildEmployeeReport(target, period, opts = {}) {
  const emp = target?.employee || opts.employee;
  if (!emp) {
    return _errResponse('Не указан сотрудник. Например: «Иванов за квартал», «расскажи про Сидорову за год».');
  }
  const _period = period || target?.period;
  if (!_period?.from || !_period?.to) {
    return _errResponse('Не указан период. Попробуйте: «Иванов за месяц», «в марте 2026», «с 1 марта по 15 апреля».');
  }

  // Source-availability guard (I-04)
  const requestedSources = (opts.sources && opts.sources.length)
    ? opts.sources
    : (target?.sources && target.sources.length ? target.sources : ['jira', 'bb', 'cf']);
  const missing = checkSourcesAvailable(requestedSources);
  const availableSources = requestedSources.filter(s => !missing.includes(s));
  if (!availableSources.length) {
    return _errResponse(
      `Запрашиваемые источники не настроены: ${missing.join(', ')}. Откройте Настройки → Интеграции.`,
      { type: 'open_settings', label: 'Открыть настройки', payload: { tab: 'integrations' }, primary: true }
    );
  }

  // Fetch — параллельно по доступным источникам.
  const fetchResult = opts.prefetched || await fetchEmployeeAllSources(
    _resolveEmpForFetch(emp),
    _period,
    { signal: opts.signal, sources: availableSources }
  );

  // Summarize per-source.
  const sJira = fetchResult.jira ? summarizeJiraItems(fetchResult.jira.items) : null;
  const sBB   = fetchResult.bb   ? summarizeBBItems(fetchResult.bb.items)     : null;
  const sCF   = fetchResult.cf   ? summarizeCFItems(fetchResult.cf.items)     : null;

  // Comparison (LP-06)
  let comparison = null;
  if (opts.includeComparison) {
    const prevPeriod = previousPeriod(_period);
    if (prevPeriod) {
      const prevFetch = await fetchEmployeeAllSources(
        _resolveEmpForFetch(emp), prevPeriod,
        { signal: opts.signal, sources: availableSources }
      );
      comparison = {
        period: prevPeriod,
        jira: prevFetch.jira ? summarizeJiraItems(prevFetch.jira.items) : null,
        bb:   prevFetch.bb   ? summarizeBBItems(prevFetch.bb.items)     : null,
        cf:   prevFetch.cf   ? summarizeCFItems(prevFetch.cf.items)     : null,
      };
    }
  }

  // Preset-routing (LP-08).
  const preset = opts.preset || 'full';

  // Build structured response.
  const periodLabel = _period.label || `${_fmtDate(_period.from)} → ${_fmtDate(_period.to)}`;
  const days = periodDays(_period);

  // Header
  const headerLines = [
    `## Сводка по сотруднику: ${emp.label || emp.id}`,
    `**Период:** ${periodLabel} (${days} дн.)`,
  ];
  if (missing.length) {
    headerLines.push(`> ⚠ Не подключено: ${missing.join(', ')}. Показано из доступных источников.`);
  }
  if (fetchResult.errors?.length) {
    headerLines.push(`> ⚠ Ошибки источников: ${fetchResult.errors.map(e => e.source).join(', ')}`);
  }

  // Summary block (LP-05)
  const summary = _buildSummaryBlock(emp, sJira, sBB, sCF, _period);

  // Per-source sections (LP-02..LP-04)
  const sections = [];
  if (sJira) sections.push(_renderJiraSection(sJira, _period, comparison?.jira));
  if (sBB)   sections.push(_renderBBSection(sBB,   _period, comparison?.bb));
  if (sCF)   sections.push(_renderCFSection(sCF,   _period, comparison?.cf));

  // Cards (LP-05 stat-cards)
  const cards = [
    _statCard('Jira',         _safeTotal(sJira), 'задач за период'),
    _statCard('Bitbucket',    _safeTotal(sBB),   _bbHint(sBB)),
    _statCard('Confluence',   _safeTotal(sCF),   'страниц/правок'),
    _statCard('Composite',    _composite(sJira, sBB, sCF), 'общая активность'),
  ];

  // Trend (LP-07) — только для периодов >14 дней.
  let trendSection = '';
  if (days > 14) {
    trendSection = _renderTrendSection(fetchResult, _period);
  }

  // Actions (deep-links to Сканнер + Гант)
  const actions = [
    linkTo({ kind: 'employee', id: emp.id, label: emp.label },
      { primary: true, label: `→ Сканнер: ${emp.label || emp.id}` }),
    ...(target?.team ? [linkTo({ kind: 'team', name: target.team.name || target.team },
      { section: 'scanner2', label: `→ Команда: ${target.team.name || target.team}` })] : []),
  ].filter(Boolean);

  // Comparison toggle (LP-06)
  if (!opts.includeComparison) {
    actions.push({
      type: 'send_prompt',
      label: '↻ Сравнить с предыдущим периодом',
      payload: { prompt: `сравни ${emp.label || emp.id} ${_period.label || ''} vs предыдущий` },
    });
  }

  // Drilldown prompts (LP-08 preset-aware)
  const drilldown = _buildDrilldown(emp, _period, sJira, sBB, sCF, preset);

  // V22+ Week 4 (LP-08) — Performance Review preset:
  // достраиваем 3 секции (Achievements / Growth / Recommendations)
  // и вставляем СРАЗУ ПОСЛЕ header'а — выше всего остального, чтобы
  // тимлид мог скопировать в HR-документ только эти первые блоки.
  let reviewBlock = '';
  if (preset === 'review') {
    const review = buildReviewSections(
      { employee: emp },
      _period,
      { jira: sJira, bb: sBB, cf: sCF },
      comparison
    );
    reviewBlock = review.markdown;
  }

  // Compose text
  const textParts = [
    headerLines.join('\n'),
    '',
    reviewBlock,                  // V22+ Week 4 (LP-08) — review preset вверху
    reviewBlock ? '\n---\n' : '', // визуальная граница если есть review-секции
    summary,
    '',
    ...sections,
    trendSection,
  ];
  if (comparison) {
    textParts.push('', _renderComparisonSection(comparison, sJira, sBB, sCF));
  }

  // V22+ Week 4 (LP-08) — для review-preset добавляем CTA «Скачать MD»
  // как primary (готовый review-документ).
  if (preset === 'review') {
    actions.unshift({
      type: 'export_md',
      label: '↓ Скачать review (MD)',
      payload: { includeHeader: true },
      primary: true,
    });
  }

  let structured = {
    text:  textParts.filter(Boolean).join('\n'),
    cards,
    actions,
    drilldown,
    responseSource: 'rule',
    _meta: {
      kind: 'employee_report',
      preset,
      employee: emp.id,
      employeeLabel: emp.label || emp.id,   // V22+ Week 4 — для AI narrative prompt
      period: { from: _period.from?.toISOString(), to: _period.to?.toISOString(), label: _period.label },
      sources: availableSources,
      missing,
      totals: {
        jira: _safeTotal(sJira),
        bb:   _safeTotal(sBB),
        cf:   _safeTotal(sCF),
      },
    },
  };

  // V22+ Week 4 (LP-09) — AI narrative. Включается через opts.aiNarrative=true
  // или автоматически для preset='review' (если LLM настроен).
  // Soft-fallback: если LLM unavailable → возвращаем report БЕЗ narrative.
  const wantNarrative = opts.aiNarrative === true
    || (preset === 'review' && opts.aiNarrative !== false);
  if (wantNarrative) {
    try {
      const narrative = await generateAINarrative(structured, { signal: opts.signal });
      if (narrative) {
        structured = injectNarrative(structured, narrative);
      }
    } catch (_) { /* silent — report без narrative valid */ }
  }

  return structured;
}

/* ─────────────────────────────────────────────────────────────
   LP-05 — Summary block (top-3 highlights)
   ───────────────────────────────────────────────────────────── */

function _buildSummaryBlock(emp, sJira, sBB, sCF, period) {
  const highlights = [];

  // Highlight 1: основная работа из Jira (closed-tickets).
  if (sJira && sJira.closed > 0) {
    const topType = _topKey(sJira.byType);
    highlights.push(
      `**Закрыто задач:** ${sJira.closed}` +
      (topType ? ` (преим. ${topType})` : '')
    );
  }

  // Highlight 2: BB-вклад.
  if (sBB && sBB.merged > 0) {
    const topRepo = _topKey(sBB.repos);
    highlights.push(
      `**Слил PR:** ${sBB.merged}` +
      (topRepo ? ` (преим. в ${topRepo})` : '')
    );
  }

  // Highlight 3: CF-вклад.
  if (sCF && sCF.total > 0) {
    const topSpace = _topKey(sCF.spaces);
    highlights.push(
      `**Confluence:** ${sCF.total} страниц/правок` +
      (topSpace && topSpace !== 'unknown' ? ` (${topSpace})` : '')
    );
  }

  if (!highlights.length) {
    return '### Кратко\n\n_Активность за период не зафиксирована._';
  }
  return '### Кратко\n\n- ' + highlights.slice(0, 3).join('\n- ');
}

/* ─────────────────────────────────────────────────────────────
   LP-02 — Jira section
   ───────────────────────────────────────────────────────────── */

function _renderJiraSection(summary, period, prevSummary) {
  if (!summary || summary.total === 0) return '';
  const lines = ['### Jira'];
  lines.push(`**Всего:** ${summary.total} · **Закрыто:** ${summary.closed}`);

  if (prevSummary) {
    const delta = summary.closed - prevSummary.closed;
    const sign = delta > 0 ? '+' : '';
    lines.push(`_Прошлый период: закрыто ${prevSummary.closed} (${sign}${delta})_`);
  }

  // Types
  const types = Object.entries(summary.byType).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (types.length) {
    lines.push('', '**По типам:**');
    for (const [type, n] of types) {
      lines.push(`- ${type}: ${n}`);
    }
  }

  // Top items
  if (summary.top.length) {
    lines.push('', '**Топ задачи (по обновлению):**');
    for (const it of summary.top.slice(0, 5)) {
      const key = it.key || '?';
      const sum = (it.summary || '').slice(0, 70);
      const status = it.status || '';
      lines.push(`- \`${key}\` ${sum}${status ? ` _(${status})_` : ''}`);
    }
  }
  return lines.join('\n');
}

/* ─────────────────────────────────────────────────────────────
   LP-03 — Bitbucket section
   ───────────────────────────────────────────────────────────── */

function _renderBBSection(summary, period, prevSummary) {
  if (!summary || summary.total === 0) return '';
  const lines = ['### Bitbucket'];
  lines.push(`**PR всего:** ${summary.total} · **Merged:** ${summary.merged} · **Open:** ${summary.open}`);

  if (prevSummary) {
    const delta = summary.merged - prevSummary.merged;
    const sign = delta > 0 ? '+' : '';
    lines.push(`_Прошлый период: merged ${prevSummary.merged} (${sign}${delta})_`);
  }

  const repos = Object.entries(summary.repos).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (repos.length) {
    lines.push('', '**По репозиториям:**');
    for (const [repo, n] of repos) {
      lines.push(`- ${repo}: ${n}`);
    }
  }
  return lines.join('\n');
}

/* ─────────────────────────────────────────────────────────────
   LP-04 — Confluence section
   ───────────────────────────────────────────────────────────── */

function _renderCFSection(summary, period, prevSummary) {
  if (!summary || summary.total === 0) return '';
  const lines = ['### Confluence'];
  lines.push(`**Страниц/правок:** ${summary.total}`);

  if (prevSummary) {
    const delta = summary.total - prevSummary.total;
    const sign = delta > 0 ? '+' : '';
    lines.push(`_Прошлый период: ${prevSummary.total} (${sign}${delta})_`);
  }

  const spaces = Object.entries(summary.spaces).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (spaces.length) {
    lines.push('', '**По пространствам:**');
    for (const [space, n] of spaces) {
      lines.push(`- ${space}: ${n}`);
    }
  }
  return lines.join('\n');
}

/* ─────────────────────────────────────────────────────────────
   LP-07 — Trend section (per-week breakdown SVG)
   ───────────────────────────────────────────────────────────── */

function _renderTrendSection(fetchResult, period) {
  // Считаем weekly counts по всем источникам.
  const weeks = _weeksInPeriod(period);
  if (weeks.length < 2) return '';
  const jiraByWeek = _bucketByWeek(fetchResult.jira?.items || [], 'updatedAt', weeks);
  const bbByWeek   = _bucketByWeek(fetchResult.bb?.items   || [], 'updatedAt', weeks);
  const cfByWeek   = _bucketByWeek(fetchResult.cf?.items   || [], 'lastModified', weeks);

  const lines = [
    '### Тренд по неделям',
    '',
    '| Неделя | Jira | BB | CF |',
    '|--------|------|----|----|',
  ];
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    lines.push(`| ${_fmtDate(w.from)} | ${jiraByWeek[i] || 0} | ${bbByWeek[i] || 0} | ${cfByWeek[i] || 0} |`);
  }
  return lines.join('\n');
}

function _weeksInPeriod(period) {
  if (!period?.from || !period?.to) return [];
  const out = [];
  let cur = new Date(period.from);
  while (cur < period.to) {
    const next = new Date(cur.getTime() + 7 * DAY_MS);
    out.push({ from: cur, to: next > period.to ? period.to : next });
    cur = next;
    if (out.length > 60) break;  // защита от бесконечного цикла
  }
  return out;
}

function _bucketByWeek(items, dateField, weeks) {
  const buckets = new Array(weeks.length).fill(0);
  for (const it of items) {
    const ts = Date.parse(it[dateField] || '');
    if (!Number.isFinite(ts)) continue;
    for (let i = 0; i < weeks.length; i++) {
      if (ts >= weeks[i].from.getTime() && ts < weeks[i].to.getTime()) {
        buckets[i]++;
        break;
      }
    }
  }
  return buckets;
}

/* ─────────────────────────────────────────────────────────────
   LP-06 — Period-over-period comparison
   ───────────────────────────────────────────────────────────── */

function _renderComparisonSection(comparison, sJira, sBB, sCF) {
  const lines = [`### Сравнение с предыдущим периодом (${comparison.period.label})`];
  const rows = [];
  if (sJira && comparison.jira) {
    const d = sJira.closed - comparison.jira.closed;
    rows.push(`- **Jira closed:** ${sJira.closed} vs ${comparison.jira.closed} (${_signed(d)})`);
  }
  if (sBB && comparison.bb) {
    const d = sBB.merged - comparison.bb.merged;
    rows.push(`- **BB merged:** ${sBB.merged} vs ${comparison.bb.merged} (${_signed(d)})`);
  }
  if (sCF && comparison.cf) {
    const d = sCF.total - comparison.cf.total;
    rows.push(`- **CF total:** ${sCF.total} vs ${comparison.cf.total} (${_signed(d)})`);
  }
  if (!rows.length) return '';
  return [lines, ...rows].join('\n');
}

/* ─────────────────────────────────────────────────────────────
   LP-08 — Preset-aware drilldown
   ───────────────────────────────────────────────────────────── */

function _buildDrilldown(emp, period, sJira, sBB, sCF, preset) {
  const empLabel = emp.label || emp.id;
  const base = [
    { text: '↻ За другой период', prompt: `${empLabel} за квартал` },
  ];
  if (sJira?.total > 0) {
    base.push({ text: 'Только Jira', prompt: `${empLabel} в Jira ${period.label || ''}` });
  }
  if (sBB?.total > 0) {
    base.push({ text: 'Только Bitbucket', prompt: `${empLabel} в BB ${period.label || ''}` });
  }
  if (sCF?.total > 0) {
    base.push({ text: 'Только Confluence', prompt: `${empLabel} в CF ${period.label || ''}` });
  }
  if (preset !== 'review') {
    base.push({ text: 'Подготовить review-материал', prompt: `Подготовь review для ${empLabel} за ${period.label || 'квартал'}` });
  }
  return base.slice(0, 6);
}

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

function _errResponse(text, extraAction) {
  return {
    text,
    cards: [],
    actions: extraAction ? [extraAction] : [],
    drilldown: [],
    responseSource: 'rule',
    _meta: { kind: 'employee_report_error' },
  };
}

function _resolveEmpForFetch(emp) {
  return {
    email: emp.email || (emp._emp && emp._emp.email) || emp.id,
    fio:   emp.label || (emp._emp && emp._emp.fio) || '',
    jiraAccountId: (emp._emp && emp._emp.jiraAccountId) || emp.jiraAccountId,
    bitbucketLogin: (emp._emp && emp._emp.bitbucketLogin) || emp.bitbucketLogin,
    confluenceAccountId: (emp._emp && emp._emp.confluenceAccountId) || emp.confluenceAccountId,
  };
}

function _statCard(title, value, hint) {
  return { title, value: String(value), hint: hint || '' };
}

function _safeTotal(s) { return s?.total || 0; }
function _bbHint(s) {
  if (!s) return '';
  return `${s.merged} merged · ${s.open} open`;
}

function _composite(sJira, sBB, sCF) {
  return _safeTotal(sJira) + _safeTotal(sBB) + _safeTotal(sCF);
}

function _topKey(obj) {
  if (!obj) return null;
  let topKey = null, topVal = -1;
  for (const [k, v] of Object.entries(obj)) {
    if (v > topVal) { topKey = k; topVal = v; }
  }
  return topKey;
}

function _fmtDate(d) {
  if (!d || !(d instanceof Date)) return '?';
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${day}.${m}.${d.getFullYear()}`;
}

function _signed(n) {
  if (n > 0) return `+${n}`;
  if (n < 0) return String(n);
  return '0';
}
