'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — RENDERER  (V18.1 P1)

   Чистый renderer для v2.0. НЕ трогает .pp-* (v1 styles живут
   отдельно). Использует Spine-pill: solid surfaces, без gradients,
   без эмодзи, mono-tabular numerals на счётчиках.

   Public exports:
     renderTopBar(model)       — заголовок + кнопка обновления
     renderTeamGlance(model)   — single-line summary поверх per-person rows
     renderPersonRows(model, ctx)  — список participants с 24h dot-strip
     renderDetailStub(model, key)  — заглушка детального вида (P5 placeholder)
     renderSkeleton(initialMsg) / renderEmpty() / renderError(msg, retryable)
   ============================================================ */

import { Utils } from '../utils.js';
import { Icons } from '../app/icons.js';
import { Services } from '../app/services.js';
import { prizmaLoaderMark } from '../app/prizmaUI.js';
// 2026-05-11 — Jira Hygiene Engine (V23). 12 правил качества данных.
import { runHygieneRules } from './jiraHygiene.js';
// 2026-05-12 — Tier 0 phase 2: Common helpers extracted to dedicated file.
// Re-export fmtDuration for backward-compat (existing consumers).
import {
  esc,
  plural,
  fmtHours,
  fmtDuration,
  renderSparkline,
  renderDelta,
  bucketByHour,
  dotStrip,
  emptyDayLanguage,
} from './teamScanner2RendererCommon.js';
export { fmtDuration } from './teamScanner2RendererCommon.js';
// V21 identity-coverage banner — нужен EmployeeFactory.detectBlocked/Ghost
// и state для подсчёта incomplete identity.
import { EmployeeFactory } from '../rowFactory.js';
import { state } from '../state.js';

// 2026-05-12 — `esc` импортирован из ./teamScanner2RendererCommon.js (Tier 0 phase 2).

/* V18.1 P7-S1.4 — render-context перенесён в teamScanner2RendererCommon.js
   2026-05-12 (Tier 0 phase 5). Re-export сохранён для back-compat
   с orchestrator'ом teamScanner2.js, который зовёт setRenderContext. */
export {
  setRenderContext,
  getRenderContext as _getRenderContext,
} from './teamScanner2RendererCommon.js';
import { getRenderContext } from './teamScanner2RendererCommon.js';

/* Phase 3 C2 — Inverted pyramid sub-tab «Сегодня» / «Глубже».
   V21 — добавлена 3-я подвкладка «Тренды» с ECharts-дашбордом
   (внутренний data-scanner-tab="metrics" сохранён для совместимости —
   именно метрик-команд во времени; AUDIT_HOLISTIC O7 — переименование
   visible-label, отделение от top-level views/metrics.js portfolio-метрик).
   Брендбук §1 — компас/курс/ориентир: front-page = здесь и сейчас, drill-down
   = «Глубже», метрики = «глубокий вид». Tab-state хранится на уровне
   renderer-модуля (один Сканнер на странице). Сбрасывается на 'today' при
   смене команды (см. resetScannerTab).
   Click-handler делегирован в `_bindEvents` (через global click listener). */
let _scannerTab = 'today'; // 'today' | 'deeper' | 'metrics' | 'hygiene'
export function getScannerTab()        { return _scannerTab; }
export function setScannerTab(tab) {
  if (tab === 'deeper' || tab === 'metrics' || tab === 'hygiene') _scannerTab = tab;
  else _scannerTab = 'today';
}
export function resetScannerTab() { _scannerTab = 'today'; }

// AUDIT_SCANNER #01 — sub-tab registry DSL. Регистрировать новые tab'ы через
// единый API, не trogать switch/case в render. Пока — shim, постепенная миграция.
// Visible-label «Графики» (F-DUP-1) применяется ТОЛЬКО в registry; legacy
// _renderScannerTabBar по-прежнему рендерит «Тренды» (см. строку выше).
const SUB_TAB_REGISTRY = [
  { id: 'today',   label: 'Сегодня',  render: null /* legacy: inline в renderTeamGlance */ },
  { id: 'deeper',  label: 'Глубже',   render: null },
  { id: 'metrics', label: 'Графики',  render: null },  // F-DUP-1 — переименовано из «Метрики»
  // 2026-05-11 — V23 Jira Hygiene Engine. 12 правил качества данных:
  // без assignee / без эстимейта / без эпика / >5 дней In-Progress / zombie review / etc.
  // Render через registered helper в renderHygieneTab (см. renderer ниже).
  { id: 'hygiene', label: 'Гигиена',  render: null },
];
export function registerScannerSubTab(entry) {
  if (!entry || !entry.id) return;
  if (!SUB_TAB_REGISTRY.find(t => t.id === entry.id)) SUB_TAB_REGISTRY.push(entry);
}
export function getScannerSubTabRegistry() { return SUB_TAB_REGISTRY.slice(); }

/* Tab-bar markup. Кнопки — `data-scanner-tab="today|deeper|metrics"`. */
/* 2026-05-11 — V23 Jira Hygiene Engine renderer. Запускает runHygieneRules,
   отображает score 0-100 + список violations grouped by rule. Каждое violation —
   collapsible <details> со списком issue'ов. Issue → ссылка на Jira.

   Score color:
     90-100: green (отлично)
     70-89:  amber (norm)
     50-69:  warning
     <50:    danger (требует разговора)
*/
export function renderHygieneView(model) {
  if (!model) {
    return `<div class="ts2-hygiene-empty"><i>Сначала запустите fetch — гигиена считается по active issues.</i></div>`;
  }
  const result = runHygieneRules(model);
  const { score, violations } = result;
  const tier = score >= 90 ? 'good' : score >= 70 ? 'mid' : score >= 50 ? 'warn' : 'bad';
  const tierLabel = score >= 90 ? 'отлично' : score >= 70 ? 'норма' : score >= 50 ? 'требует внимания' : 'требует разговора';
  const totalViolations = violations.reduce((s, v) => s + v.count, 0);
  const _ctx = getRenderContext();
  const jiraBase = (_ctx?.jiraBaseUrl) ? String(_ctx.jiraBaseUrl).replace(/\/+$/, '') : '';

  const violationBlocks = violations
    .sort((a, b) => (b.weight * b.count) - (a.weight * a.count))
    .map(v => {
      const issueRows = v.items.map(it => {
        const keyLink = jiraBase
          ? `<a class="ts2-hyg-issue-key" href="${esc(jiraBase)}/browse/${esc(it.key)}" target="_blank" rel="noopener noreferrer">${esc(it.key)}</a>`
          : `<span class="ts2-hyg-issue-key">${esc(it.key)}</span>`;
        return `<li class="ts2-hyg-issue-row">
          ${keyLink}
          <span class="ts2-hyg-issue-summary" title="${esc(it.summary)}">${esc((it.summary || '').slice(0, 80))}</span>
          <span class="ts2-hyg-issue-meta">${esc(it.type || '')} · ${esc(it.status || '')}${it.assignee ? ' · ' + esc(it.assignee) : ''}</span>
        </li>`;
      }).join('');
      const sevClass = v.severity === 'warn' ? 'ts2-hyg-rule-warn' : 'ts2-hyg-rule-info';
      const moreLine = v.truncated ? `<li class="ts2-hyg-issue-more">…ещё ${v.items.length} (всего ${v.count}, показано 50)</li>` : '';
      return `<details class="ts2-hyg-rule ${sevClass}">
        <summary class="ts2-hyg-rule-summary">
          <span class="ts2-hyg-rule-id">${esc(v.rule)}</span>
          <span class="ts2-hyg-rule-label">${esc(v.label)}</span>
          <span class="ts2-hyg-rule-count">${v.count}</span>
        </summary>
        <ul class="ts2-hyg-issue-list">${issueRows}${moreLine}</ul>
      </details>`;
    }).join('');

  return `
    <div class="ts2-hygiene-howto" role="note">
      <div class="ts2-hygiene-howto-title">Гигиена данных Jira</div>
      <div class="ts2-hygiene-howto-text">
        12 правил качества данных: без assignee, без эстимейта, zombie в review, carry-over между спринтами и др.
        Score 100 = всё чисто. Под каждым правилом — список затронутых задач со ссылками в Jira.
      </div>
    </div>
    <div class="ts2-hyg-score-block ts2-hyg-score-${tier}">
      <div class="ts2-hyg-score-num">${score}</div>
      <div class="ts2-hyg-score-side">
        <div class="ts2-hyg-score-lab">/ 100 — ${tierLabel}</div>
        <div class="ts2-hyg-score-sub">${totalViolations} ${plural(totalViolations, ['нарушение', 'нарушения', 'нарушений'])} в ${violations.length} ${plural(violations.length, ['правиле', 'правилах', 'правилах'])}</div>
      </div>
    </div>
    <div class="ts2-hyg-rules-list">
      ${violations.length ? violationBlocks : '<div class="ts2-hygiene-empty">✓ Все правила пройдены. Команда — образец.</div>'}
    </div>
  `;
}

export function _renderScannerTabBar() {
  const t = _scannerTab;
  return `
    <div class="ts2-tab-bar" role="tablist" aria-label="Уровни Сканнера команд">
      <button class="ts2-tab-bar-btn ${t==='today'?'is-active':''}" type="button"
              role="tab" aria-selected="${t==='today'}"
              data-scanner-tab="today">Сегодня</button>
      <button class="ts2-tab-bar-btn ${t==='deeper'?'is-active':''}" type="button"
              role="tab" aria-selected="${t==='deeper'}"
              data-scanner-tab="deeper">Глубже</button>
      <button class="ts2-tab-bar-btn ${t==='metrics'?'is-active':''}" type="button"
              role="tab" aria-selected="${t==='metrics'}"
              aria-label="Тренды команд (графики во времени)"
              data-scanner-tab="metrics">Тренды</button>
      <button class="ts2-tab-bar-btn ${t==='hygiene'?'is-active':''}" type="button"
              role="tab" aria-selected="${t==='hygiene'}"
              aria-label="Гигиена данных Jira (без assignee, без эстимейта, и т.п.)"
              data-scanner-tab="hygiene">Гигиена</button>
    </div>
  `;
}
/* V22 — linkifyIssueKeys/jiraIssueLink + BB-popover hover-listener
   перенесены в teamScanner2RendererCommon.js 2026-05-12 (Tier 0 phase 5)
   чтобы Hero/Insights/PersonRows могли использовать без circular import.
   Импорт ниже сохраняет внутренние вызовы внутри main renderer'а. */
import { linkifyIssueKeys, jiraIssueLink } from './teamScanner2RendererCommon.js';

// AUDIT_SCANNER #35 + UX-feedback 2026-05-09/2026-05-10 — print to PDF.
// История проблемы:
//   v1: @media print + body.is-printing-scanner с display:none на parents
//       → печатался белый лист (parent #int-root скрывался каскадно).
//   v2 (текущая): открываем NEW WINDOW с inline HTML+CSS только из #int-root,
//       вызываем window.print() в новом окне. Plus: парент-цепочка не мешает,
//       минус: всё ещё print-dialog (без vendored PDF lib иначе нельзя).
// Кнопке оставлен title «Сохранить как PDF (откроется print-dialog → Save as PDF)».
function _printScanner() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const root = document.getElementById('int-root');
  if (!root) {
    try { window.print(); } catch (_) { /* ignore */ }
    return;
  }
  // Собираем все <link rel="stylesheet"> и <style> из исходного документа,
  // чтобы новое окно унаследовало визуал Сканнера.
  let cssBlock = '';
  try {
    const heads = document.querySelectorAll('link[rel="stylesheet"], style');
    cssBlock = Array.from(heads).map(node => {
      if (node.tagName === 'LINK' && node.href) {
        return `<link rel="stylesheet" href="${node.href}">`;
      }
      if (node.tagName === 'STYLE') {
        return `<style>${node.textContent || ''}</style>`;
      }
      return '';
    }).join('\n');
  } catch (_) { cssBlock = ''; }
  const printOnly = `
    <style>
      @page { margin: 12mm; }
      body { background: #fff !important; padding: 0 !important; margin: 0 !important; }
      .ts2-btn-print, .ts2-btn, .ts2-kebab-wrap, #ts2-refresh-btn,
      .ts2-tab-bar, .ts2-stale-banner, .ts2-search-wrap,
      .ts2-fab, .assistant-fab, #obsidian-fab-mascot { display: none !important; }
      .ts2-glance { box-shadow: none !important; }
      a { color: inherit !important; text-decoration: none !important; }
      .ts2-panel, .ts2-glance, .ts2-row { page-break-inside: avoid; }
    </style>
  `;
  let html;
  try {
    html = `<!doctype html><html><head><meta charset="utf-8"><title>Сканнер команд — PDF</title>${cssBlock}${printOnly}</head><body><div id="int-root">${root.innerHTML}</div><script>window.addEventListener('load', function(){ setTimeout(function(){ try { window.focus(); window.print(); } catch(e){} }, 250); });<\/script></body></html>`;
  } catch (_) { return; }
  let win;
  try { win = window.open('', '_blank', 'width=1200,height=800'); }
  catch (_) { win = null; }
  if (!win) {
    // Pop-up заблокирован → fallback на legacy in-place print.
    try { window.print(); } catch (_) { /* ignore */ }
    return;
  }
  try {
    win.document.open();
    win.document.write(html);
    win.document.close();
  } catch (_) { /* ignore */ }
}
if (typeof window !== 'undefined') window._ts2PrintScanner = _printScanner;

/* ── helpers ─────────────────────────────────────────── */

// 2026-05-12 — `plural`, `fmtHours` импортированы из ./teamScanner2RendererCommon.js

/**
 * V20 S10.2 — Format dwell-duration (input: hours, not seconds).
 *
 * Pilot finding (тимлид, S10): «1642ч» нечитаемо — мозг не парсит большие
 * часы. После ~24ч переходим на «дни», после ~1000ч (≈42 дня) часы теряют
 * смысл, оставляем только дни.
 *
 * Format table:
 *   < 24ч       → «18ч»          (округление, как было)
 *   24..999ч    → «Xд Yч» / «Xд» (если Y=0)
 *   ≥ 1000ч     → «Xд»           (часы не дописываем)
 *   < 0 / NaN   → «—»            (defensive: clock-skew)
 *
 * Граница ровно 24.0 → «1д» (>=, не >).
 *
 * V20 S11.1 BUG-9 — ВНИМАНИЕ: НЕ использовать fmtDuration() в путях
 * сериализации (snapshot/history/diagnostic JSON export). История и
 * diagnostic должны хранить **raw часы (число)**, иначе:
 *   · смена UI-формата ломает snapshot diff (ложно-positive «изменения»)
 *   · scrub-policy/A11y readers не разбирают «68д»
 * Если нужно показать форматированно в diagnostic — вычисляй на чтении,
 * не на записи. Этот комментарий — barrier для будущих PR.
 *
 * @param {number} h — часы (integer или float)
 * @returns {string}
 */
// 2026-05-12 — fmtDuration импортируется и re-export'ится сверху (Common).

/**
 * V19 C2 — Mini-sparkline для history-серии (14 дней).
 * Pure inline-SVG, ~12 LOC SVG. Не использует external charting library.
 *
 * @param {number[]} series — values, ASC-by-day
 * @param {object}   [opts] — { width=80, height=18, lastIsBad?: bool }
 */
// 2026-05-12 — renderSparkline импортируется из Common.

/** V18.1 P7-S4.2 — render trend-delta arrow для PO/руководителя.
 *  positiveIsBad=true → ↑ red (orphans, stop), ↑ green (moving, progress).
 *  Returns '' если нет prev или delta=0.
 */
// 2026-05-12 — renderDelta импортируется из Common.

/**
 * Bucket events by local hour-of-day (0..23). Each bucket = number of events
 * starting in that hour. Returns Int8Array(24).
 *
 * NB: в P1 используем server local time (как и весь Pulse). TZ-skew issue
 * подсветим в P3 — нужно решение по browser TZ vs server TZ.
 */
// 2026-05-12 — bucketByHour + dotStrip импортируются из Common.

/** Product-language вместо "0 событий" — снимаем обвиняющий тон (HR-роль).
 *  V18.1 P7-S1.3 — учитывает все 4 источника, не только Jira+CF.
 *  Это критично для тимлидов / senior'ов / архитекторов: их активность
 *  часто ВНЕ Jira changelog'а (PR-ревью, коммиты без транзишенов, CF-доки).
 *  До фикса: senior с 0 jira-events + 5 PR-reviews видел «Нет следа», что
 *  ложно и унизительно.
 */
// 2026-05-12 — emptyDayLanguage импортируется из Common.

/** P3 helper: единый «stuck-list» для участника — blockers (если P3
    enrichment запущен) ИЛИ stale (P1/P2 fallback). Это позволяет
    classifier'у работать одинаково для enriched и non-enriched model. */
// V20 S8 #15 — extracted to teamScanner2Classifier.js (single source of truth).
import { classifyPerson as _classifyPerson, stuckListOf as _stuckListOf, statusOfPerson as _statusOfPerson } from './teamScanner2Classifier.js';
// AUDIT_SCANNER #22 — hygiene thresholds (config), #28 — components как hygiene-критерий.
import { HYGIENE_THRESHOLDS } from './teamScanner2Config.js';
// V20 S12 — Insights pure-helpers (I1, I2, I7).
import { buildDailyBrief, buildActionQueue, detectZombies, buildYesterdayGroupMap, composePersonNarrative, composeNarrativeMarkdown, buildBurnupData, buildYesterdayDigest, buildScopeChurnDetail, computePrCycleTime, computeCrQueueDepth, computeCrLoadGini, weekdayAdjustedAnomaly, detectStalePrs, detectStaleBranches, analyzeChangelogPatterns, computeEstimateAccuracy, detectSoloAuthorFiles, computeOnboardingRamp, computeBlockerMTTR, computeTeamHealthScore, composeDailyBriefMarkdown, buildCrossTeamDeps, computeSprintConfidence, computeCarryOverRate, computeBugInjectionRate, computeUnplannedWork, computeBlockedTimeAggregate } from './teamScanner2Insights.js';
const stuckListOf = _stuckListOf;

// V20 S8 #15 — statusOfPerson переехал в teamScanner2Classifier.js.

/**
 * V18.1 P2 — Classify participant into one of 4 groups.
 *
 * Synthesised from panel: SM (sprint-goal alignment), PO (release risk),
 * тимлид (stand-up triage). Pure function над участником из analysePulse,
 * никаких side-effects, легко тестируется.
 *
 * Возвращает:
 *  - 'stop'    — есть stale issues (>=7d без update в WIP) И нет активности сегодня.
 *                Это самый красный сигнал: «висит и не движется».
 *  - 'watch'   — один из триггеров «может стать стоп»:
 *                · WIP >=3 (overcommitment, человек переключается)
 *                · есть stale но есть today (тянет старое + новое)
 *                · был активен вчера, тишина сегодня (новая тишина)
 *  - 'moving'  — есть активность сегодня и нет красных флагов.
 *  - 'idle'    — совсем нет следов нигде (свернётся в отдельную секцию,
 *                не зашумляет основной экран).
 *
 * Намеренно НЕ учитывает (требует расширения данных в P3):
 *  - PR-aging (age в Code Review > 24ч) — нужен server-side dwell-time
 *  - context-switch index — нужен computed signal в model'и
 */
// V20 S8 #15 — classifyPerson вынесен в teamScanner2Classifier.js.
// Re-export сохраняет публичный API для existing consumers.
export const classifyPerson = _classifyPerson;

/** V18.1 P7-S3.2 / V22 (2026-05-09) — HR-language: «Стоп» → «Требует разговора»
 *  → «Требует внимания» (operational signal, без HR-конотации). Person-row тип
 *  stop остаётся в classify; меняется только presentational layer. */
// 2026-05-12 — GROUP_META перенесён в teamScanner2RendererPersonRows.js
// (используется только renderGroup внутри renderPersonRows). После
// Phase 4 extract'а main больше не нуждается в этой константе.

/* ── Hero block extracted 2026-05-12 (Tier 0 phase 5) ───────
   1306 LOC → integrations/teamScanner2RendererHero.js. Здесь:
     · re-export public API для orchestrator'а (renderTopBar etc.)
     · import internal helpers, используемых в renderSprintHealth
       и renderMultiTeamView ниже (renderBurnupSparkline,
       _ensureScannerRoomStyles).
   ──────────────────────────────────────────────────────── */
export {
  renderTopBar,
  renderVelocityComparison,
  renderTeamSwitcher,
  renderSprintLagBreakdown,
  renderTeamGlance,
  renderConfluenceSsoBanner,
  _ensureSsoBannerStyles,
} from './teamScanner2RendererHero.js';
import {
  renderBurnupSparkline,
  _ensureScannerRoomStyles,
  renderSprintLagBreakdown,
  renderVelocityComparison,
} from './teamScanner2RendererHero.js';


/**
 * V20 S14 I9 — Stale PR list (>3д без активности).
 */
/* PR-CQ — Sankey зависимостей между командами.
   Изменения: палитра 8-цветная per-source PK (узлы и потоки одного цвета),
   градиент потока от source-цвета к target-цвету, hover подсвечивает связь
   и тушит остальные, метки PK снаружи узлов (не наезжают), легенда снизу. */

/* 2026-05-12 — Tier 0 phase 3: insights tile renderers выделены в
   teamScanner2RendererInsights.js (~1030 LOC). Здесь re-imports для
   internal usage (renderSleepingDataInsights вызывается из renderTeamGlance
   ниже). _renderDeeperEmptyState тоже доступен через локальный alias. */
import {
  renderSleepingDataInsights,
  renderTile_componentLoad,
  _renderDependencySankey,
  _renderDeeperEmptyState,
} from './teamScanner2RendererInsights.js';


function renderStalePrs(model) {
  const stale = detectStalePrs(model);
  if (stale.length === 0) return '';
  const items = stale.map(s => `
    <li class="ts2-stale-pr-row">
      <span class="ts2-stale-pr-id">PR #${esc(String(s.prId))}</span>
      <span class="ts2-stale-pr-age">▌${s.ageDays}д</span>
      <span class="ts2-stale-pr-author">${esc(s.author)}</span>
      <span class="ts2-stale-pr-title">${esc(s.title || '—')}</span>
    </li>
  `).join('');
  return `
    <details class="ts2-stale-pr">
      <summary class="ts2-stale-pr-summary">
        <span>PR без сигнала <span class="ts2-stale-pr-count">${stale.length}</span></span>
        <span class="ts2-stale-pr-hint">— открыты >3д без активности</span>
      </summary>
      <ul class="ts2-stale-pr-list">${items}</ul>
    </details>
  `;
}

/* 2026-05-12 — Jira changelog pattern surface.
   Patterns: frequent reassign / severity-downgrade / sprint-hopping / scope-flip.
   Used in Operations section. */
function renderChangelogPatterns(model) {
  const patterns = analyzeChangelogPatterns(model);
  if (!patterns.length) return '';
  const labelOf = (p) => ({
    'churn-frequent-reassign': 'Частая смена assignee',
    'severity-downgrade':      'Severity понижена без resolution',
    'sprint-hopping':           'Переходит между спринтами',
    'scope-flip':               'Выкинута из scope',
  })[p] || p;
  const items = patterns.map(p => `
    <li class="ts2-stale-pr-row">
      <span class="ts2-stale-pr-id">${esc(p.key)}</span>
      <span class="ts2-stale-pr-author">${esc(labelOf(p.pattern))}</span>
      <span class="ts2-stale-pr-title">${esc(p.evidence)}</span>
    </li>
  `).join('');
  return `
    <details class="ts2-stale-pr ts2-changelog-patterns">
      <summary class="ts2-stale-pr-summary">
        <span>Подозрительные паттерны changelog <span class="ts2-stale-pr-count">${patterns.length}</span></span>
        <span class="ts2-stale-pr-hint">— churn / sprint-hopping / scope-flip / severity-downgrade</span>
      </summary>
      <ul class="ts2-stale-pr-list">${items}</ul>
    </details>
  `;
}

/* 2026-05-12 — Stale branches detector (BB untapped data). Surface long-living
   feature branches (>14d без commits) — risk merge-conflict + забытая работа. */
function renderStaleBranches(model) {
  const stale = detectStaleBranches(model, 14);
  if (!stale.length) return '';
  const items = stale.map(s => `
    <li class="ts2-stale-pr-row">
      <span class="ts2-stale-pr-id" title="${esc(s.repo || '')}">${esc(s.branch.slice(0, 40))}</span>
      <span class="ts2-stale-pr-age">▌${s.daysStale}д</span>
      <span class="ts2-stale-pr-author">${esc(s.author)}</span>
      <span class="ts2-stale-pr-title">last commit: ${esc(s.lastCommitAt || '?')}</span>
    </li>
  `).join('');
  return `
    <details class="ts2-stale-pr ts2-stale-branches">
      <summary class="ts2-stale-pr-summary">
        <span>Долгоживущие branches <span class="ts2-stale-pr-count">${stale.length}</span></span>
        <span class="ts2-stale-pr-hint">— нет коммитов >14 дней (риск merge-conflict)</span>
      </summary>
      <ul class="ts2-stale-pr-list">${items}</ul>
    </details>
  `;
}

/**
 * V20 S14 I10 — Estimate accuracy rolling 30d.
 */
function renderEstimateAccuracy(model) {
  const arr = computeEstimateAccuracy(model);
  if (arr.length === 0) return '';
  const items = arr.slice(0, 6).map(e => {
    const cls = e.tendency === 'good' ? 'ts2-est-good'
              : e.tendency === 'underestimate' ? 'ts2-est-under'
              : 'ts2-est-over';
    const txt = e.tendency === 'good' ? 'точно'
              : e.tendency === 'underestimate' ? 'недооценивает'
              : 'переоценивает';
    return `
      <li class="ts2-est-row ${cls}">
        <button type="button" class="ts2-lag-person-link" data-jump-key="${esc(e.key)}">${esc(e.label)}</button>
        <span class="ts2-est-ratio">${e.medianRatio}×</span>
        <span class="ts2-est-tendency">${txt}</span>
        <span class="ts2-est-n">N=${e.sampleSize}</span>
      </li>
    `;
  }).join('');
  return `
    <details class="ts2-est">
      <summary class="ts2-est-summary"><span>Estimate accuracy <span class="ts2-est-count">${arr.length}</span></span> <span class="ts2-est-hint">— median actual/estimate за 30д</span></summary>
      <ul class="ts2-est-list">${items}</ul>
    </details>
  `;
}

/**
 * V20 S14 I12 — Onboarding ramp (для новичков <90д).
 */
function renderOnboardingRamp(model) {
  const arr = computeOnboardingRamp(model);
  if (arr.length === 0) return '';
  const items = arr.map(o => `
    <li class="ts2-onb-row">
      <button type="button" class="ts2-lag-person-link" data-jump-key="${esc(o.key)}">${esc(o.label)}</button>
      <span class="ts2-onb-tenure">${o.tenureDays}д tenure</span>
      <span class="ts2-onb-stat">commit: ${o.daysToFirstCommit ?? '—'}д</span>
      <span class="ts2-onb-stat">PR: ${o.daysToFirstPr ?? '—'}д</span>
      <span class="ts2-onb-stat">review: ${o.daysToFirstReview ?? '—'}д</span>
    </li>
  `).join('');
  return `
    <details class="ts2-onb">
      <summary class="ts2-onb-summary"><span>Онбординг <span class="ts2-onb-count">${arr.length}</span></span> <span class="ts2-onb-hint">— новички &lt;90д · дни до первого commit / PR / review</span></summary>
      <ul class="ts2-onb-list">${items}</ul>
    </details>
  `;
}

/**
 * V20 S14 I11 — Solo-author files / bus-factor.
 */
function renderSoloAuthorFiles(model) {
  const solo = detectSoloAuthorFiles(model);
  if (solo.length === 0) return '';
  const items = solo.map(s => `
    <li class="ts2-solo-row">
      <code class="ts2-solo-path">${esc(s.path)}</code>
      <span class="ts2-solo-author">${esc(s.author)}</span>
    </li>
  `).join('');
  return `
    <details class="ts2-solo">
      <summary class="ts2-solo-summary"><span>Bus-factor 1 <span class="ts2-solo-count">${solo.length}</span></span> <span class="ts2-solo-hint">— файлы с одним автором за 90д</span></summary>
      <ul class="ts2-solo-list">${items}</ul>
    </details>
  `;
}

/**
 * V20 S13 I4 — Scope churn detail: раскрываемый список added/removed
 * по каждому pk. Показывается только если есть изменения.
 */
function renderScopeChurnDetail(model, history) {
  const churns = buildScopeChurnDetail(model, history);
  if (churns.length === 0) return '';
  const blocks = churns.map(c => {
    const addedList = c.added.length > 0
      ? `<div class="ts2-churn-list ts2-churn-added"><span class="ts2-churn-key">+ ${c.added.length}:</span> ${c.added.map(k => jiraIssueLink(k)).join(', ')}</div>`
      : '';
    const removedList = c.removed.length > 0
      ? `<div class="ts2-churn-list ts2-churn-removed"><span class="ts2-churn-key">− ${c.removed.length}:</span> ${c.removed.map(k => jiraIssueLink(k)).join(', ')}</div>`
      : '';
    return `
      <div class="ts2-churn-block">
        <div class="ts2-churn-head">
          <span class="ts2-churn-pk">${esc(c.pk)}</span>
          <span class="ts2-churn-name" title="${esc(c.sprintName || '')}">${esc(c.sprintName || '')}</span>
          <span class="ts2-churn-ratio ts2-churn-ratio-${c.ratio >= 20 ? 'high' : c.ratio >= 10 ? 'mid' : 'low'}">${c.ratio}% churn</span>
          <span class="ts2-churn-meta">из ${c.initialSize} initial</span>
        </div>
        ${addedList}
        ${removedList}
      </div>
    `;
  }).join('');
  return `
    <details class="ts2-churn">
      <summary class="ts2-churn-summary-toggle">
        <span>Scope churn спринта <span class="ts2-churn-count">${churns.length}</span></span>
        <span class="ts2-churn-hint">— что добавлено / удалено после старта спринта</span>
      </summary>
      ${blocks}
    </details>
  `;
}

/**
 * V20 S12 I7 — Zombie issue detector: задачи открыты >30д без транзишенов.
 *
 * Раскрывается через <details>. Не отвлекает в default-state, но даёт
 * массовое actionable «можно закрыть N тикетов на retro».
 */
function renderZombieIssues(model) {
  const zombies = detectZombies(model);
  if (zombies.length === 0) return '';
  const items = zombies.slice(0, 8).map(z => `
    <li class="ts2-zombie-row">
      <span class="ts2-zombie-key">${jiraIssueLink(z.key)}</span>
      <span class="ts2-zombie-status">${esc(z.status)}</span>
      <span class="ts2-zombie-dwell" title="dwell-time = в текущем статусе">▌${fmtDuration(z.dwellHours)}</span>
      <span class="ts2-zombie-owner">${esc(z.owner)}</span>
      <span class="ts2-zombie-summary">${esc(z.summary)}</span>
    </li>
  `).join('');
  return `
    <details class="ts2-zombie-block">
      <summary class="ts2-zombie-summary-toggle">
        <span>Зомби-задачи <span class="ts2-zombie-count">${zombies.length}</span></span>
        <span class="ts2-zombie-hint">— открыты >30 дней без движения, кандидаты на закрытие</span>
      </summary>
      <ul class="ts2-zombie-list">${items}</ul>
    </details>
  `;
}

/**
 * V20 S12 — Sprint health composite block:
 *   · S1 Sprint Goal narrative (из Jira sprint description/goal)
 *   · S3 Mid-sprint checkpoint (на каком % спринта, expected vs actual)
 *   · S4 Scope churn (diff vs первый snapshot после старта)
 *   · S6 Hygiene flags (без assignee/priority/description)
 *
 * Рендерится только если есть >=1 спринт. Под team-glance — это второй
 * приоритет после group-counts.
 */
function renderSprintHealth(model, history) {
  const sg = model?.scannerV2?.sprintGoal;
  if (!sg?.sprints?.length) return '';
  const blocks = sg.sprints.map(s => {
    // S1 — goal narrative (если у sprint есть goal field)
    const goalBlock = s.goal
      ? `<div class="ts2-sh-goal" title="Sprint Goal из Jira sprint description"><span class="ts2-sh-goal-prefix">Цель:</span> ${esc(s.goal.slice(0, 200))}${s.goal.length > 200 ? '…' : ''}</div>`
      : '';
    // S3 — mid-sprint checkpoint
    let checkpoint = '';
    if (Number.isFinite(s.daysTotal) && Number.isFinite(s.daysLeft) && s.daysTotal > 0) {
      const dayIdx  = Math.max(0, s.daysTotal - s.daysLeft);
      const pctTime = Math.round((dayIdx / s.daysTotal) * 100);
      // Mid-sprint = 40-60% времени. На 50%-метке — особый сигнал.
      const isMid = pctTime >= 40 && pctTime <= 60;
      const cls = isMid ? 'ts2-sh-checkpoint ts2-sh-checkpoint-mid' : 'ts2-sh-checkpoint';
      checkpoint = `<span class="${cls}" title="Прошло ${dayIdx} из ${s.daysTotal} дней спринта (${pctTime}%). Mid-sprint = good time для review scope.">
        День ${dayIdx}/${s.daysTotal} (${pctTime}%)${isMid ? ' · MID' : ''}
      </span>`;
    }
    // S4 — scope churn vs first snapshot
    let churn = '';
    if (Array.isArray(history) && history.length >= 2 && Array.isArray(s.sprintIssueKeys)) {
      // Найти первый snapshot за текущий спринт. Берём snapshot с тем же
      // sprintsByPk[pk].name == s.name (если name изменился — не сравниваем).
      const firstSnap = history.find(h =>
        h?.sprintGoal?.sprintsByPk?.[s.pk]?.name === s.name
      );
      const initialKeys = firstSnap?.sprintGoal?.sprintsByPk?.[s.pk]?.keys || [];
      if (initialKeys.length > 0) {
        const initialSet = new Set(initialKeys);
        const currentSet = new Set(s.sprintIssueKeys);
        const added   = s.sprintIssueKeys.filter(k => !initialSet.has(k)).length;
        const removed = initialKeys.filter(k => !currentSet.has(k)).length;
        if (added > 0 || removed > 0) {
          const churnRatio = Math.round(((added + removed) / initialKeys.length) * 100);
          const cls = churnRatio >= 20 ? 'ts2-sh-churn ts2-sh-churn-high' : 'ts2-sh-churn';
          churn = `<span class="${cls}" title="Scope churn: ${added} добавлено + ${removed} удалено / ${initialKeys.length} initial = ${churnRatio}%. Норма ≤15%.">
            scope: <span class="ts2-sh-churn-add">+${added}</span> · <span class="ts2-sh-churn-rem">−${removed}</span> · <span class="ts2-sh-churn-pct">${churnRatio}%</span>
          </span>`;
        }
      }
    }
    // S6 — hygiene flags. AUDIT_SCANNER #22 — пороги вынесены в HYGIENE_THRESHOLDS.
    // AUDIT_SCANNER #28 — добавлен chip "Без компонента" (если model отдаёт hy.noComponent).
    const hy = s.hygiene || {};
    const hygieneItems = [];
    if (hy.noAssignee > HYGIENE_THRESHOLDS.noAssignee)
      hygieneItems.push(`<span class="ts2-sh-hy ts2-sh-hy-warn" title="Задач без assignee — назначить до stand-up'а">${hy.noAssignee} без assignee</span>`);
    if (hy.noPriority > HYGIENE_THRESHOLDS.noPriority)
      hygieneItems.push(`<span class="ts2-sh-hy" title="Задач без priority — обсудить на planning">${hy.noPriority} без приоритета</span>`);
    if (hy.noDescription > HYGIENE_THRESHOLDS.noDescription)
      hygieneItems.push(`<span class="ts2-sh-hy" title="Задач с короткой/пустой description (<30 chars) — нет AC?">${hy.noDescription} без описания</span>`);
    if (hy.noEpic > HYGIENE_THRESHOLDS.noEpic)
      hygieneItems.push(`<span class="ts2-sh-hy" title="Задач без эпика — нет привязки к цели">${hy.noEpic} без эпика</span>`);
    if (hy.noComponent > HYGIENE_THRESHOLDS.noEpic) // AUDIT_SCANNER #28
      hygieneItems.push(`<span class="ts2-sh-hy" title="Задач без компонента — теряется ownership при cross-team триаже">${hy.noComponent} без компонента</span>`);
    const hygieneBlock = hygieneItems.length > 0
      ? `<div class="ts2-sh-hygiene">${hygieneItems.join(' · ')}</div>`
      : '';

    // V20 S13 S2 — goal-critical progress separately.
    let goalCriticalBlock = '';
    const gc = s.goalCritical || {};
    if (gc.total > 0) {
      const cls = gc.progressPct === 100 ? 'ts2-sh-gc-done' : (gc.progressPct >= 50 ? 'ts2-sh-gc-mid' : 'ts2-sh-gc-low');
      goalCriticalBlock = `<div class="ts2-sh-gc ${cls}" title="Issues с label «goal-critical» — прогресс по ним важнее общего %.">
        <span class="ts2-sh-gc-key">Goal-critical:</span>
        <span class="ts2-sh-gc-num">${gc.done}/${gc.total}</span>
        <span class="ts2-sh-gc-pct">(${gc.progressPct}%)</span>
      </div>`;
    }
    if (!goalBlock && !checkpoint && !churn && !hygieneBlock && !goalCriticalBlock) return '';
    // V20 S13 S5 — Burnup sparkline (scope/done/ideal). Mini-version рядом с head.
    const burnup = buildBurnupData(history, s.pk, s);
    const burnupBlock = burnup.status === 'ok'
      ? `<span class="ts2-sh-burnup" title="Burnup за ${burnup.points.length} дней. Линии: ideal (тонкая) · scope · done.">${renderBurnupSparkline(burnup)}</span>`
      : '';
    return `
      <div class="ts2-sh-block">
        <div class="ts2-sh-head">
          <span class="ts2-sh-pk">${esc(s.pk)}</span>
          <span class="ts2-sh-name">${esc(s.name || '')}</span>
          ${checkpoint}
          ${churn}
          ${burnupBlock}
        </div>
        ${goalBlock}
        ${goalCriticalBlock}
        ${hygieneBlock}
      </div>
    `;
  }).filter(Boolean).join('');

  if (!blocks) return '';
  // V21 S15 S8-S11 — sprint quality metrics row (один общий summary).
  const carry = computeCarryOverRate(model, history);
  const bugInj = computeBugInjectionRate(model);
  const unplan = computeUnplannedWork(model);
  const blockedTime = computeBlockedTimeAggregate(model);
  const qChips = [];
  if (carry.ratio != null) {
    const cls = carry.ratio >= 0.3 ? 'ts2-sh-q-warn' : '';
    qChips.push(`<span class="ts2-sh-q ${cls}" title="Carry-over: задачи перешли из предыдущего спринта (${carry.count}/${carry.total} = ${Math.round(carry.ratio*100)}%). Норма ≤30%, выше = chronic over-commitment.">${Icons.get('rotate-cw', { cls: 'btn-icon', size: 12 })} carry: ${Math.round(carry.ratio*100)}%</span>`);
  }
  if (bugInj.count > 0) {
    qChips.push(`<span class="ts2-sh-q ts2-sh-q-warn" title="Bug injection rate: ${bugInj.count} баг(ов) создано в ходе спринта. Сигнал качества DoD.">▌ bugs in: ${bugInj.count}</span>`);
  }
  if (unplan.ratio != null) {
    const cls = unplan.ratio >= 0.2 ? 'ts2-sh-q-warn' : '';
    qChips.push(`<span class="ts2-sh-q ${cls}" title="Unplanned work: задачи созданные после старта спринта (${unplan.count}/${unplan.total} = ${Math.round(unplan.ratio*100)}%). Защита фокуса.">+ unplanned: ${Math.round(unplan.ratio*100)}%</span>`);
  }
  if (blockedTime.totalHours > 0) {
    qChips.push(`<span class="ts2-sh-q" title="Blocked-time aggregate: сумма dwellHours всех блокеров (${blockedTime.count} штук). Системный impediment-сигнал.">σ blocked: ${fmtDuration(blockedTime.totalHours)}</span>`);
  }
  const qualityRow = qChips.length > 0
    ? `<div class="ts2-sh-quality">${qChips.join('')}</div>`
    : '';
  return `
    <details class="ts2-sprint-health" open>
      <summary class="ts2-sh-summary"><span class="ts2-sh-toggle-label">Курс спринта</span> <span class="ts2-sh-toggle-hint">— цель, checkpoint, churn, гигиена, качество</span></summary>
      ${blocks}
      ${qualityRow}
    </details>
  `;
}

// PR-CP — `renderWhoNeedsHelp` (compact top-3 в glance) удалён: дублировал
// `renderActionQueue` (полный список) ниже, в feedback-обзоре назван
// «два блока с одинаковым названием».

/**
 * V19 C2 — История 14 дней: 3 sparkline'а в одном ряду.
 * Без зависимостей: pure inline-SVG, ~14×3=42 polyline points max.
 */
export function renderHistoryTrendRow(history) {
  // Series ASC-by-day. 3 metrics: stop count, OOS count, sprint progress.
  const stopSeries     = history.map(h => h?.counts?.stop || 0);
  const oosSeries      = history.map(h => h?.risks?.totalOutOfSprint || 0);
  const progressSeries = history.map(h => h?.sprintGoal?.aggregateProgress || 0);
  const days = history.length;
  // 2026-05-12 — Date-picker для просмотра «что было N дней назад».
  // Min/max — from history.day diapason. Onchange — emit event для orchestrator
  // (`ts2-history-date-change`), который перерисует с loadHistoryAtDate(date).
  const minDay = history[0]?.day || '';
  const maxDay = history[history.length - 1]?.day || '';
  const datePicker = (minDay && maxDay) ? `
      <span class="ts2-glance-trend-datepicker" title="Просмотреть состояние на конкретную дату из истории">
        <label for="ts2-history-date" class="ts2-sr-only">Дата для history snapshot</label>
        <input type="date" id="ts2-history-date" class="ts2-history-date-input"
               min="${minDay}" max="${maxDay}" value="${maxDay}"
               data-ts2-history-date title="Загрузить snapshot на эту дату" />
      </span>` : '';
  return `
    <div class="ts2-glance-line ts2-glance-trend-row">
      <span class="ts2-glance-trend-label">${days} ${plural(days, ['день', 'дня', 'дней'])}:</span>
      ${datePicker}
      <span class="ts2-glance-trend-item" title="Stop count за ${days} дней — должен снижаться">
        <span class="ts2-glance-trend-mini-lab">▌stop</span>
        ${renderSparkline(stopSeries, { lastIsBad: true })}
      </span>
      <span class="ts2-glance-trend-item" title="Out-of-sprint events за ${days} дней — должен снижаться">
        <span class="ts2-glance-trend-mini-lab">OOS</span>
        ${renderSparkline(oosSeries, { lastIsBad: true })}
      </span>
      <span class="ts2-glance-trend-item" title="Sprint Goal progress % за ${days} дней — должен расти">
        <span class="ts2-glance-trend-mini-lab">spr</span>
        ${renderSparkline(progressSeries)}
      </span>
    </div>
  `;
}

/* ── Team config modal (V18.3 A1) ───────────────────────── */

const PRESET_LABELS = {
  default:  'По умолчанию',
  research: 'Research / ML',
  hotfix:   'Hotfix / SRE',
};

const THRESHOLD_FIELDS = [
  { key: 'codeReview', label: 'Code Review' },
  { key: 'qa',         label: 'QA / Testing' },
  { key: 'inProgress', label: 'In Progress' },
  { key: 'todo',       label: 'To Do' },
  { key: 'default',    label: 'Default (другие статусы)' },
];

/**
 * Pilot finding (Olga, ML-research):
 * «CR > 8ч порог не подходит, нужен per-team override через UI, не JSON».
 *
 * Modal со списком всех известных pk + поля для thresholds + presets.
 *
 * @param {object} model — current pulse model (источник списка pk)
 * @param {object} currentConfig — { [pk]: { mode, dwellHours: {...} } }
 * @param {object} presets — PRESET_THRESHOLDS map
 */
export function renderTeamConfigModal(model, currentConfig, presets) {
  const pks = Object.keys(model?.spaces || {});
  if (!pks.length) {
    return `
      <div class="modal-overlay" id="ts2-config-modal">
        <div class="modal-box">
          <div class="modal-header">
            <h3>Настройка команд</h3>
            <button class="modal-close-btn" data-close-modal>${Icons.get('x', { size: 14 })}</button>
          </div>
          <div class="ae-modal-body">
            <div class="ts2-empty-text">Сначала загрузите данные Сканнера: проектные ключи не известны.</div>
          </div>
        </div>
      </div>`;
  }
  const teamCards = pks.map(pk => {
    const cfg = currentConfig[pk] || {};
    const mode = cfg.mode || 'default';
    const dh = cfg.dwellHours || presets.default;
    const presetOptions = Object.keys(presets).map(p =>
      `<option value="${esc(p)}" ${p === mode ? 'selected' : ''}>${esc(PRESET_LABELS[p] || p)}</option>`
    ).join('');
    const fields = THRESHOLD_FIELDS.map(f => `
      <label class="ts2-config-field">
        <span class="ts2-config-field-label">${esc(f.label)}</span>
        <input type="number" min="1" max="240" class="form-input ts2-config-input"
               data-pk="${esc(pk)}" data-field="${esc(f.key)}"
               value="${esc(dh[f.key] ?? presets.default[f.key])}">
        <span class="ts2-config-field-suffix">ч</span>
      </label>
    `).join('');
    const isCustom = !!cfg.dwellHours;
    return `
      <div class="ts2-config-team-card ${isCustom ? 'ts2-config-team-card-active' : ''}" data-pk="${esc(pk)}">
        <div class="ts2-config-team-head">
          <span class="ts2-config-team-pk">${esc(pk)}</span>
          <select class="form-input ts2-config-preset" data-pk="${esc(pk)}">
            ${presetOptions}
          </select>
          ${isCustom ? `<button class="ts2-btn ts2-btn-ghost ts2-config-reset" data-pk="${esc(pk)}" type="button" title="Сбросить к глобальным дефолтам">сброс</button>` : ''}
        </div>
        <div class="ts2-config-fields">${fields}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="modal-overlay" id="ts2-config-modal">
      <div class="modal-box modal-box-wide">
        <div class="modal-header">
          <h3>Настройка команд — пороги dwell-time</h3>
          <button class="modal-close-btn" data-close-modal>${Icons.get('x', { size: 14 })}</button>
        </div>
        <div class="ae-modal-body">
          <div class="ts2-config-help">
            Per-команда override порогов «висит без движения» по статусам.
            Issue в статусе дольше threshold попадает в «Старые задачи» (blocker-shelf).
            Presets: Research/ML — длинные периоды на ревью моделей; Hotfix/SRE —
            быстрые сроки реакции.
          </div>
          <div class="ts2-config-teams">${teamCards}</div>
        </div>
        <div class="ae-modal-footer">
          <button class="btn btn-outline btn-sm" data-close-modal>Отмена</button>
          <button class="btn btn-primary btn-sm" id="ts2-config-save">Сохранить</button>
        </div>
      </div>
    </div>`;
}

/* ── Multi-team aggregate view (V18.1 P7-S4.1) ──────────── */

/**
 * Pilot finding (Dmitry, руководитель отдела с 4 командами):
 * «v2.0 = single-team view. Для 4 команд я меняю project keys в
 * настройках каждый раз. Срывает «1-2 минуты visit» в 4-минутный quest.»
 *
 * Решение: opt-in режим «По командам» — table-like view со сводкой
 * по каждому pk. Использует уже-загруженный model, не делает новых
 * запросов. Click по строке команды → переключает на single-team
 * view с фильтром по этой pk (V19, сейчас просто scroll).
 */
function computePerTeamSummary(model) {
  if (!model?.spaces) return [];
  const pks = Object.keys(model.spaces);
  const out = [];
  for (const pk of pks) {
    const space = model.spaces[pk] || {};
    if (space.hasError) {
      out.push({ pk, error: space.errorMsg || 'fetch error', partsCount: 0 });
      continue;
    }
    // Participants in this pk: те, у кого pk в projects[].
    const parts = (model.participants || [])
      .filter(p => Array.isArray(p.projects) && p.projects.includes(pk));
    const counts = { stop: 0, watch: 0, moving: 0, idle: 0 };
    let wipTotal = 0;
    for (const p of parts) {
      counts[classifyPerson(p)]++;
      wipTotal += (p.issuesNow || []).length;
    }
    // Sprint per pk:
    const sgPk = (model.scannerV2?.sprintGoal?.sprints || []).find(s => s.pk === pk);
    // Risks per pk:
    const orphans = model.scannerV2?.risks?.orphansByPk?.[pk] || 0;
    // OOS per pk: считаем по participants этой команды.
    let oosCount = 0;
    for (const p of parts) oosCount += p.outOfSprintEvents || 0;
    out.push({
      pk,
      activeSprintName: space.activeSprintName || '',
      partsCount: parts.length,
      counts,
      wipTotal,
      sprintProgress: sgPk?.progressPct ?? null,
      sprintPace:     sgPk?.pace        ?? 'no-data',
      sprintDaysLeft: sgPk?.daysLeft    ?? null,
      orphans,
      oosCount,
    });
  }
  // Sort: команды с stop первые, потом по числу people desc.
  out.sort((a, b) => (b.counts?.stop || 0) - (a.counts?.stop || 0) || (b.partsCount || 0) - (a.partsCount || 0));
  return out;
}

export function renderMultiTeamView(model) {
  const summary = computePerTeamSummary(model);
  if (!summary.length) {
    return `<div class="ts2-empty">Нет данных по командам.</div>`;
  }
  const rows = summary.map(t => {
    if (t.error) {
      return `<div class="ts2-team-row ts2-team-row-error">
        <span class="ts2-team-pk">${esc(t.pk)}</span>
        <span class="ts2-team-error">${esc(t.error)}</span>
      </div>`;
    }
    const sprintCell = (t.sprintProgress != null)
      ? `<span class="ts2-team-sprint ts2-sprint-pace-${t.sprintPace}">
           <span class="ts2-team-sprint-bar"><span class="ts2-team-sprint-bar-fill" style="width:${Math.min(100, t.sprintProgress)}%"></span></span>
           <span class="ts2-team-sprint-pct">${t.sprintProgress}%</span>
           ${typeof t.sprintDaysLeft === 'number' ? `<span class="ts2-team-sprint-days">${t.sprintDaysLeft}д</span>` : ''}
         </span>`
      : `<span class="ts2-team-sprint ts2-team-sprint-empty">—</span>`;
    const groupChips = [
      t.counts.stop > 0   ? `<span class="ts2-team-chip ts2-team-chip-stop">▌${t.counts.stop}</span>` : '',
      t.counts.watch > 0  ? `<span class="ts2-team-chip ts2-team-chip-watch">${t.counts.watch}</span>` : '',
      t.counts.moving > 0 ? `<span class="ts2-team-chip ts2-team-chip-moving">${t.counts.moving}</span>` : '',
    ].join('');
    const risks = [
      t.orphans  > 0 ? `<span class="ts2-team-risk-orphans">${t.orphans} orphans</span>` : '',
      t.oosCount > 0 ? `<span class="ts2-team-risk-oos">${t.oosCount} OOS</span>` : '',
    ].filter(Boolean).join(' · ');
    return `
      <div class="ts2-team-row" data-team-pk="${esc(t.pk)}" tabindex="0" role="button" aria-label="Команда ${esc(t.pk)}, ${t.partsCount} человек">
        <span class="ts2-team-pk">${esc(t.pk)}</span>
        <span class="ts2-team-meta">
          <span class="ts2-team-people">${t.partsCount} ${plural(t.partsCount, ['чел', 'чел', 'чел'])}</span>
          ${t.activeSprintName ? `<span class="ts2-team-sprint-name">«${esc(t.activeSprintName)}»</span>` : ''}
        </span>
        <span class="ts2-team-groups">${groupChips}</span>
        <span class="ts2-team-wip" title="Сколько задач в пути по команде">${t.wipTotal} в пути</span>
        ${sprintCell}
        <span class="ts2-team-risks">${risks || '—'}</span>
      </div>
    `;
  }).join('');
  // V22 (2026-05-09 UX) — секция «Операции» переехала из team-view в multi-view.
  // Tile'ы (sprint health, scope churn, stale PRs, estimate accuracy, onboarding,
  // solo author, zombie issues, sprint lag) агрегируют по всем командам — их
  // место в +Все, не в team-view (где раньше путали отсутствием фильтрации).
  _ensureScannerRoomStyles();
  const operationsBlocks = [
    renderSprintHealth(model, []),
    renderScopeChurnDetail(model, []),
    renderStalePrs(model),
    renderStaleBranches(model),
    renderChangelogPatterns(model),
    renderEstimateAccuracy(model),
    renderOnboardingRamp(model),
    renderSoloAuthorFiles(model),
    renderZombieIssues(model),
    renderSprintLagBreakdown(model?.scannerV2?.sprintGoal, model),
  ].filter(Boolean).join('');
  const operationsSection = operationsBlocks
    ? `<section class="ts2-room ts2-room-ops" aria-labelledby="ts2-multi-room-ops-eyebrow">
         <div class="ts2-room-eyebrow" id="ts2-multi-room-ops-eyebrow">Операции (по всем командам)</div>
         <details class="ts2-section-ops" data-key="ts2-multi-l4-ops">
           <summary class="ts2-section-ops-summary">Раскрыть <span class="ts2-section-ops-hint">— спринт, ревью, гигиена данных по всем PK сразу</span></summary>
           ${operationsBlocks}
         </details>
       </section>`
    : '';
  // V22 fix #11 (2026-05-09 UX) — multi-view получил tab-bar (Сегодня/Глубже/Тренды).
  // Раньше эти вкладки были только в team-view. Теперь в +Все:
  //   · «Сегодня»  — список команд + Операции (как и раньше)
  //   · «Глубже»   — cross-team плитки (Resolution split, Big-metrics, PR, DORA, ...)
  //   · «Тренды»   — cross-team ECharts dashboard
  const teamListBlock = `
    <div class="ts2-multi-team">
      <div class="ts2-multi-team-head">
        <span>Команда</span>
        <span>Контекст</span>
        <span>Группы</span>
        <span>В пути</span>
        <span>Спринт</span>
        <span>Риски</span>
      </div>
      <div class="ts2-multi-team-rows">${rows}</div>
    </div>`;

  // V22 fix #11 — multi-view: team-list рендерится ВСЕГДА (чтобы клик по
  // команде работал на любом tab'е), Глубже/Тренды добавляются снизу.
  let extraPane = '';
  if (_scannerTab === 'deeper') {
    const sleepingHtml = renderSleepingDataInsights(model, { scope: 'multi' });
    const paneBody = sleepingHtml || _renderDeeperEmptyState(model, { scope: 'multi' });
    extraPane = `
      <div class="ts2-multi-deeper">
        <div class="ts2-deeper-howto" role="note">
          <div class="ts2-deeper-howto-title">Что здесь:</div>
          <div class="ts2-deeper-howto-text">
            Cross-team аналитика по всем PK сразу: Resolution split, готовность релизов, метрики PR (cycle-time / first-review), DORA-proxy,
            Big-metrics (reopen-rate, sprint-commit, stale). Для team-specific плиток выберите конкретную команду из таблицы выше.
          </div>
        </div>
        <div class="ts2-deeper-pane">${paneBody}</div>
      </div>`;
  } else if (_scannerTab === 'metrics') {
    extraPane = `
      <div class="ts2-multi-metrics">
        <div class="ts2-metrics-howto" role="note">
          <div class="ts2-metrics-howto-title">Что здесь:</div>
          <div class="ts2-metrics-howto-text">
            Графики динамики метрик по всем командам сразу. Восходящие линии по PR-cycle и stale-задачам = организация замедляется.
            Чтобы посмотреть тренды по конкретной команде — выберите её из таблицы выше.
          </div>
        </div>
        <div class="ts2-metrics-pane" id="ts2-metrics-mount"></div>
      </div>`;
  } else {
    // 'today' tab — добавляется секция Операции
    extraPane = operationsSection;
  }
  return `
    ${_renderScannerTabBar()}
    ${teamListBlock}
    ${extraPane}
  `;
}

/* ── Per-person rows ──────────────────────────────────── */


/* 2026-05-12 — Tier 0 phase 4: PersonRows функции выделены в
   teamScanner2RendererPersonRows.js (~280 LOC). Re-export + SRC_*
   константы для local use в detail panel renderer ниже. */
import { renderPersonRows, SRC_LABELS, SRC_NAMES, SRC_KEYS } from './teamScanner2RendererPersonRows.js';
export { renderPersonRows };


/* ── Detail panel (V18.1 P5) — slide-in 480px справа ────── */

// 2026-05-12 — SRC_LABELS/SRC_NAMES/SRC_KEYS импортируются из PersonRows
// (Tier 0 phase 4). См. начало файла, блок import re-export.

/**
 * Side-panel с heatmap 72×4, sparkline, blockers, событиями и фильтрами.
 * @param {object} model
 * @param {string} key — participant.key
 * @param {object} [ctx] — { filters: {j,b,c,z} }
 */
export function renderEmployeeDetailPanel(model, key, ctx = {}) {
  const p = (model?.participants || []).find(x => x.key === key);
  if (!p) {
    return `
      <div class="ts2-panel ts2-panel-modal ts2-panel-empty">
        <button class="ts2-btn ts2-btn-ghost ts2-panel-close" id="ts2-detail-close" type="button" aria-label="Закрыть">${Icons.get('x', { size: 14 })}</button>
        <div class="ts2-empty-text">Участник не найден.</div>
      </div>
    `;
  }
  const filters = ctx.filters || { j: true, b: true, c: true, zc: true, ze: true };
  const tToday = (p.timelineToday    || []).length;
  const tYest  = (p.timelineYesterday || []).length;
  const tPrev  = (p.timelinePrev      || []).length;
  // V18.3 A2 — heatmap72x4 теперь 5 источников (J/B/C/Zc/Ze). Backward-compat
  // fallback: если raw 4-элементное (старый snapshot/server cached) —
  // дополняем 5-м пустым row.
  let heat72 = p.heatmap72x4 || { grid: [[],[],[],[],[]], rowTotals: [0,0,0,0,0], colTotals: [], peakCell: null };
  if (heat72.grid && heat72.grid.length === 4) {
    heat72 = { ...heat72, grid: [...heat72.grid, []], rowTotals: [...(heat72.rowTotals || [0,0,0,0]), 0] };
  }
  // V18.1 P7-S2.5 — sparkline удалён, peak-hour перенесён в heatmap hint.
  const cs     = p.contextSwitches || { distinctIssueKeys: 0, switchEvents: [], switchScore: 0 };
  const blockers = Array.isArray(p.blockers) ? p.blockers : [];

  const tl = Array.isArray(p.timeline72h) ? p.timeline72h : [];
  // V18.1 P6.2 + V18.3 A2 — фильтр применяется и к events feed.
  // Zephyr split: kind ∈ {test, testSet} → zc (created); kind ∈ {testExec,
  // execution} → ze (executed). Default any zephyr → ze (более частый).
  const isZephyrCreated = (k) => k === 'test' || k === 'testSet';
  const filteredTl = tl.filter(e => {
    const src = e?.src || 'jira';
    let flag;
    if      (src === 'jira') flag = 'j';
    else if (src === 'bb')   flag = 'b';
    else if (src === 'cf')   flag = 'c';
    else if (src === 'zephyr') flag = isZephyrCreated(e?.kind) ? 'zc' : 'ze';
    else flag = 'j';
    return filters[flag] !== false;
  });

  // V18.1 P7-S3.1 — id для aria-controls; aria-modal для focus-trap;
  // tabindex=-1 чтобы можно было программно фокусировать.
  // V20 S7 A3 — cross-team chip и CRV/PR детальные данные передаём в header.
  const ctxMetrics = {
    crv:        model?.scannerV2?.codeReviewVelocity?.[key] || null,
    prT:        model?.scannerV2?.prThroughput?.[key]       || null,
    crossTeam:  model?.scannerV2?.crossTeamDeps?.[key]      || null,
  };
  return `
    <div class="ts2-panel ts2-panel-modal" id="ts2-panel-main" role="dialog" aria-modal="true"
         aria-labelledby="ts2-panel-title" tabindex="-1">
      ${renderPanelHeader(p, tToday, tYest, tPrev, ctxMetrics)}
      ${renderPersonNarrative(p)}
      ${renderCounters(p)}
      ${renderPersonMetricsPanel(p, model)}
      ${renderHeatmap72x4(heat72, filters)}
      ${renderFilters(filters, heat72.rowTotals)}
      ${renderBlockersShelf(blockers)}
      ${renderEventsFeed(filteredTl)}
      ${renderSwitchesNote(cs)}
    </div>
  `;
}

/**
 * V20 S13 N1-N5 — Per-employee narrative (3-5 предложений).
 *
 * Pилот: «5 минут утра — нужны 3-5 предложений «что человек делает / делал»
 * без таблиц». Включает:
 *   N1: 3-5 предложений нарратив
 *   N2: кнопка «скопировать для 1:1» (markdown в clipboard)
 *   N3: 24h rolling по умолчанию
 *   N4: empty-state с гипотезой («возможно отпуск»)
 *   N5: фокус на задачах, не на человеке
 */
function renderPersonNarrative(p) {
  const narrative = composePersonNarrative(p);
  if (narrative.sentences.length === 0) return '';
  // V22 (2026-05-09 UX) — структурированный список вместо одной строки.
  // Каждое предложение нарратива (Сегодня / Блокер / Вчера / Confluence)
  // — отдельный <li> с label-prefix bold для сканируемости.
  const labeledItems = narrative.sentences.map(s => {
    const text = String(s || '');
    const m = text.match(/^([^:]+):\s*(.*)$/);
    if (!m) {
      return `<li class="ts2-narrative-item ts2-narrative-item-plain">${linkifyIssueKeys(esc(text))}</li>`;
    }
    const label = m[1].trim();
    const body = m[2].trim();
    const slug = label.toLowerCase().replace(/[^a-zа-яё0-9]+/g, '-');
    return `
      <li class="ts2-narrative-item ts2-narrative-item-${esc(slug)}">
        <span class="ts2-narrative-label">${esc(label)}:</span>
        <span class="ts2-narrative-text">${linkifyIssueKeys(esc(body))}</span>
      </li>`;
  }).join('');
  const hypothesis = narrative.hypothesis
    ? `<p class="ts2-narrative-hypothesis">${esc(narrative.hypothesis)}</p>`
    : '';
  const stale = narrative.isStaleData
    ? `<span class="ts2-narrative-stale" title="Данные старше суток. Открой кнопку «Обновить».">${Icons.get('alert-triangle', { cls: 'btn-icon', size: 12 })} устаревшие</span>`
    : '';
  // N2: copy button с pre-built markdown в data-attr (escapeHtml защищает).
  const md = composeNarrativeMarkdown(p, narrative);
  return `
    <div class="ts2-panel-section ts2-narrative-section" role="region" aria-label="Сводка по сотруднику">
      <div class="ts2-panel-section-title">
        Сводка за последние 24 часа
        <button type="button" class="ts2-narrative-copy" data-narrative-md="${esc(md)}"
                title="Скопировать сводку для вставки в Telegram/Slack" aria-label="Скопировать">${Icons.get('copy', { cls: 'btn-icon', size: 12 })} Копировать</button>
        ${stale}
      </div>
      <ul class="ts2-narrative-list">${labeledItems}</ul>
      ${hypothesis}
    </div>
  `;
}

/**
 * V20 S11 — Per-person metrics panel (Z1, Z2, Z3, Z6, Z8, Z9, Z10).
 *
 * Все метрики — composite chips в одной секции под counters. Показывается
 * только когда `p.personMetrics` присутствует (после applyPersonMetrics в
 * enrichment). Каждая метрика — chip с tooltip-объяснением формулы.
 *
 * Burnout flag (Z10) подсвечивается ▌ stripe и аккуратно объясняет сигналы.
 */
function renderPersonMetricsPanel(p, model) {
  const m = p?.personMetrics;
  // V22+ Sprint B — engineering-only chips (PROD/SWITCH/LOC) скрыты за флагом.
  // По Birman: для PM productivity-score не интерпретируется без обучения.
  // Включить: localStorage.q2_scanner_show_productivity = '1'
  let _showProductivityChips = false;
  try { _showProductivityChips = (typeof localStorage !== 'undefined' && localStorage.getItem('q2_scanner_show_productivity') === '1'); } catch (_) {}

  // V22 (2026-05-09 UX) — раньше при !m возвращали '' и теряли CF/Z chips.
  // Z1 — productivity score
  const prod = m?.productivity;
  const prodTooltip = prod ? `Сегодня (48ч): ${prod.breakdown.commits}c · ${prod.breakdown.prs}PR · ${prod.breakdown.conf}CF · ${prod.breakdown.reviewsDone}reviews · ${prod.breakdown.testsCreated}+${prod.breakdown.testsExecuted}Z · ${prod.breakdown.closedToday} закрыто. Формула: c×1 + PR×3 + CF×1.5 + reviews×2 + tests_c×2 + tests_e×1 + closed×5.` : '';
  const prodChip = (prod && _showProductivityChips) ? `<span class="ts2-pm-chip ts2-pm-chip-prod" data-pm-formula="${esc(prodTooltip)}" title="Клик — полная формула">
    <span class="ts2-pm-chip-key">PROD</span>
    <span class="ts2-pm-chip-num">${prod.score}</span>
  </span>` : '';

  // Z2 — first/last activity. Sprint B: empty-АКТИВ chip не рендерим (выглядит как ошибка)
  const fl = m?.firstLast;
  const flChip = !fl ? '' : (fl.first && fl.last)
    ? (() => {
        const f = fl.first.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        const l = fl.last.toLocaleTimeString('ru-RU',  { hour: '2-digit', minute: '2-digit' });
        return `<span class="ts2-pm-chip" title="Первая и последняя активность за rolling 24ч (${fl.count} событий, span ${fl.span}ч). Источник: timeline + bb + cf + zephyr. Browser-local TZ.">
          <span class="ts2-pm-chip-key">АКТИВ</span>
          <span class="ts2-pm-chip-num">${esc(f)}–${esc(l)}</span>
          <span class="ts2-pm-chip-lab">${fl.span}ч</span>
        </span>`;
      })()
    : '';  // empty-state НЕ рендерим — прочерк выглядит как ошибка данных

  // Z3 — context switch rate. Sprint B: за productivity-флагом
  const cs = m?.contextSwitches;
  const csChip = (!cs || !_showProductivityChips) ? '' : cs.total > 0
    ? `<span class="ts2-pm-chip" title="Переключений между задачами за 72ч: ${cs.total} (${cs.distinctIssueKeys} уникальных). Норма ≤ 0.5/час.">
        <span class="ts2-pm-chip-key">${Icons.get('rotate-cw', { cls: 'btn-icon', size: 12 })} SWITCH</span>
        <span class="ts2-pm-chip-num">${cs.perHour}</span>
        <span class="ts2-pm-chip-lab">/час</span>
      </span>`
    : '';

  // Z6 — LOC delta. Sprint B: за productivity-флагом
  const loc = m?.loc;
  const locChip = (!loc || !_showProductivityChips) ? '' : loc.estimated
    ? `<span class="ts2-pm-chip ts2-pm-chip-estimated" title="Приближённо ≈ commits × ${50} (нет diff-stats от BB API). Реальные числа доступны при hydration линий из commits diff.">
        <span class="ts2-pm-chip-key">~LOC</span>
        <span class="ts2-pm-chip-num">${loc.added}</span>
        <span class="ts2-pm-chip-lab">≈48ч</span>
      </span>`
    : `<span class="ts2-pm-chip" title="Линии кода за 48ч: +${loc.added} / −${loc.removed}, net ${loc.net}.">
        <span class="ts2-pm-chip-key">LOC</span>
        <span class="ts2-pm-chip-num">+${loc.added} / −${loc.removed}</span>
      </span>`;

  // Z8 — hours logged
  const h = m?.hoursLogged;
  const hoursChip = !h ? '' : (h.todaySec > 0 || h.weekSec > 0)
    ? `<span class="ts2-pm-chip" title="Залогировано в Jira: сегодня ${fmtHours(h.todaySec)}ч · вчера ${fmtHours(h.yesterdaySec)}ч · неделя ${fmtHours(h.weekSec)}ч.">
        <span class="ts2-pm-chip-key">Σ ЛОГ</span>
        <span class="ts2-pm-chip-num">${fmtHours(h.todaySec)}</span>
        <span class="ts2-pm-chip-lab">сегодня</span>
      </span>`
    : '';

  // Z9 — first-response time
  const frt = m?.firstResponse;
  const frtChip = !frt ? '' : (frt.medianHours != null)
    ? `<span class="ts2-pm-chip" title="Медиана dwell-time для issue в open/todo статусе (proxy на FRT). N=${frt.count}.">
        <span class="ts2-pm-chip-key">FRT</span>
        <span class="ts2-pm-chip-num">${fmtDuration(frt.medianHours)}</span>
      </span>`
    : '';

  // Z10 — burnout flag (видит только тимлид; в Сканнере self-view нет → safe)
  const bo = m?.burnout;
  const burnoutChip = !bo ? '' : (bo.level !== 'none')
    ? `<span class="ts2-pm-chip ts2-pm-chip-burnout ts2-pm-chip-burnout-${bo.level}" data-pm-formula="Composite burnout-сигнал: ${bo.signals.map(s => `${s.kind}=${s.value}`).join(' · ')}. Confidence: ${bo.confidence}. Сигналы: weekend>25%, lateNight>15%, WIP≥4, 5+д без коммитов. ВНИМАНИЕ: использовать для разговора, не для performance review." title="${esc('Burnout-композит — клик для подробной формулы')}">
        <span class="ts2-pm-chip-key">▌ BURNOUT</span>
        <span class="ts2-pm-chip-num">${bo.level === 'high' ? 'ВЫСОКИЙ' : 'СРЕДНИЙ'}</span>
        <span class="ts2-pm-chip-lab">${bo.signals.length} сигн.</span>
      </span>`
    : '';

  // V22 (2026-05-09 UX) — добавлены Confluence и Zephyr-chips: тимлиду
  // важно сразу видеть «есть ли активность в документации/тестах» без
  // прокрутки до events feed.
  const cfCount = Array.isArray(p?.cfItems) ? p.cfItems.length : 0;
  const cfChip = `<span class="ts2-pm-chip ${cfCount === 0 ? 'ts2-pm-chip-empty' : ''}" data-pm-formula="Правки в Confluence за 48ч: ${cfCount}. Источник — cfItems (edit + create + comment). Если 0 при наличии активности в Jira/BB — возможно сотрудник не документирует свою работу.">
    <span class="ts2-pm-chip-key">CF</span>
    <span class="ts2-pm-chip-num">${cfCount}</span>
    <span class="ts2-pm-chip-lab">правок 48ч</span>
  </span>`;
  // V22 fix #9 — Z-count из тех же полей, что использует per-row chip:
  // zephyrTestsCreatedRecent + zephyrTestsExecutedRecent. Раньше брали
  // из несуществующего zephyrItems → всегда 0.
  const zCreated  = Array.isArray(p?.zephyrTestsCreatedRecent)  ? p.zephyrTestsCreatedRecent.length  : 0;
  const zExecuted = Array.isArray(p?.zephyrTestsExecutedRecent) ? p.zephyrTestsExecutedRecent.length : 0;
  const zFromTimeline = Array.isArray(p?.timeline72h) ? p.timeline72h.filter(e => e?.src === 'zephyr').length : 0;
  const zCount = (zCreated + zExecuted) || zFromTimeline;
  const zChip = `<span class="ts2-pm-chip ${zCount === 0 ? 'ts2-pm-chip-empty' : ''}" data-pm-formula="Активность в Zephyr за 72ч: ${zCount} (создано тестов: ${zCreated}, прогонов: ${zExecuted}). Источник — zephyrTestsCreatedRecent + zephyrTestsExecutedRecent (fallback: timeline.src='zephyr'). Если 0 при QA-роли — стоит уточнить, где идёт регрессия.">
    <span class="ts2-pm-chip-key">Z</span>
    <span class="ts2-pm-chip-num">${zCount}</span>
    <span class="ts2-pm-chip-lab">тестов 72ч</span>
  </span>`;

  // Phase-1 Jenkins MVP (2026-05-10) — J chip. Источник: model.jenkins.perAuthor
  // → matched по точному name (whitespace-trim, case-insensitive). Если 0 при
  // роли DevOps/SRE — указываем как чинить (jenkinsUserName в Сотрудниках или
  // Auto-Resolve). НЕ использовать для performance review.
  const jBuilds = p?.jenkinsBuilds48h || 0;
  const jFails  = p?.jenkinsFailures48h || 0;
  const jFolder = model?.jenkins?.folder || 'sbof';
  // 2026-05-11 — error-aware variant. Если model.jenkins.error → показываем
  // J⚠ с reason'ом в tooltip вместо misleading 0 builds.
  const jErrPm = (model?.jenkins && model.jenkins.error) ? String(model.jenkins.error) : '';
  const jChip = jErrPm
    ? `<span class="ts2-pm-chip ts2-pm-chip-warn" data-pm-formula="Jenkins недоступен: ${esc(jErrPm)}. Чип отображается с ⚠ потому что мы не можем отличить «нет билдов» от «нет данных» — открывайте Diagnostic-modal → секция Jenkins для деталей.">
    <span class="ts2-pm-chip-key">J</span>
    <span class="ts2-pm-chip-num" aria-label="недоступен">${Icons.get('alert-triangle', { cls: 'btn-icon', size: 11 })}</span>
    <span class="ts2-pm-chip-lab">недоступен</span>
  </span>`
    : `<span class="ts2-pm-chip ${jBuilds === 0 ? 'ts2-pm-chip-empty' : ''}" data-pm-formula="Jenkins за 48ч: ${jBuilds} билдов, ${jFails} fail. Источник — culprits / actions.causes.userName из folder ${esc(jFolder)}. Если 0 при роли DevOps/SRE — проверьте jenkinsUserName в Сотрудниках или запустите Auto-Resolve.">
    <span class="ts2-pm-chip-key">J</span>
    <span class="ts2-pm-chip-num">${jBuilds}</span>
    <span class="ts2-pm-chip-lab">${jFails > 0 ? jFails + ' fail' : 'билдов 48ч'}</span>
  </span>`;

  return `
    <div class="ts2-panel-section ts2-pm-section">
      <div class="ts2-panel-section-title">Метрики сотрудника <span class="ts2-panel-section-hint">клик по chip — формула</span></div>
      <div class="ts2-pm-chips">
        ${prodChip}
        ${flChip}
        ${csChip}
        ${locChip}
        ${hoursChip}
        ${frtChip}
        ${cfChip}
        ${zChip}
        ${jChip}
        ${burnoutChip}
      </div>
    </div>
  `;
}

/**
 * V18.1 P7-S3.5 — email PII masking. Default: «v.b****@sber.ru»;
 * раскрытие по hover/focus (CSS) + click toggles full reveal.
 * Tech panel finding: email surface'ится в panel header без masking,
 * GDPR-vector при shared screenshots / shared screens на статус-митингах.
 */
function maskEmail(email) {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at < 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);   // включая @
  if (local.length <= 1) return email;   // нечего маскировать
  // Берём первый символ локальной части, остальное — звёздочки.
  return `${local[0]}${'*'.repeat(Math.max(3, local.length - 1))}${domain}`;
}

function renderPanelHeader(p, tToday, tYest, tPrev, metrics = {}) {
  // V22 (2026-05-09 UX) — email-masking убран по UX-фидбеку: внутренний
  // tool, всё внутри корп-сети, masking только мешал тимлиду.
  const emailFull = p.email || '';
  // V20 S7 A3 — cross-team chip + CRV/PRT детальные метрики в panel header.
  const m = metrics || {};
  const crvChip = m.crv && m.crv.count >= 2
    ? `<span class="ts2-panel-metric ts2-panel-metric-crv-${m.crv.threshold}" title="Median time-to-first-review за 14 дней (N=${m.crv.count} ревью)">CR ${m.crv.medianHours}ч</span>`
    : '';
  const prtChip = m.prT && m.prT.opened > 0
    ? `<span class="ts2-panel-metric ts2-panel-metric-prT-${m.prT.flag}" title="${m.prT.merged}/${m.prT.opened} мерж за 7 дней (${Math.round(m.prT.mergeRate*100)}%) · flag: ${m.prT.flag}">${m.prT.merged}/${m.prT.opened} PR</span>`
    : '';
  const ctChip = m.crossTeam && m.crossTeam.totalPRs > 0
    ? `<span class="ts2-panel-metric ts2-panel-metric-crossteam" title="Cross-team PR (PR в репозитории других команд) за 7 дней">${m.crossTeam.crossTeamPRs}/${m.crossTeam.totalPRs} cross-team (${Math.round(m.crossTeam.ratio*100)}%)</span>`
    : '';
  // V20 S8 #23 — Spawn-task chip при overload. Pилот feedback: «если warning сработал,
  // дайте кнопку обсудить 1:1 которая копирует контекст в clipboard для Telegram».
  const overloadAction = m.prT?.flag === 'overload'
    ? `<button class="ts2-panel-metric ts2-panel-metric-action" id="ts2-detail-spawn-1on1" type="button"
              title="Скопировать контекст для разговора 1:1 в TG/Slack">${Icons.get('message-circle', { cls: 'btn-icon', size: 12 })} Обсудить 1:1</button>`
    : '';
  const metricRow = (crvChip || prtChip || ctChip || overloadAction)
    ? `<div class="ts2-panel-metrics-row">${crvChip}${prtChip}${ctChip}${overloadAction}</div>`
    : '';
  // 2026-05-11 — breadcrumb с контекстом (команда + sprint). Помогает не
  // потерять «откуда я пришёл» после drill-down в person-row.
  const teamCtx = p.team || p.pk || '';
  const sprintCtx = p.activeSprintName || '';
  const breadcrumb = (teamCtx || sprintCtx)
    ? `<div class="ts2-panel-breadcrumb" aria-label="Контекст">
        <button class="ts2-panel-back" type="button" data-close-modal aria-label="Назад к Сканнеру">← Назад</button>
        ${teamCtx ? `<span class="ts2-panel-bc-sep">·</span><span class="ts2-panel-bc-team">${esc(teamCtx)}</span>` : ''}
        ${sprintCtx ? `<span class="ts2-panel-bc-sep">·</span><span class="ts2-panel-bc-sprint">${esc(sprintCtx)}</span>` : ''}
      </div>`
    : '';
  return `
    <div class="ts2-panel-head">
      ${breadcrumb}
      <div class="ts2-panel-titleblock">
        <div class="ts2-panel-name" id="ts2-panel-title">${esc(p.label || '—')}</div>
        <div class="ts2-panel-sub">
          <span class="ts2-panel-meta">сегодня ${tToday}</span>
          <span class="ts2-panel-meta">вчера ${tYest}</span>
          <span class="ts2-panel-meta">позавчера ${tPrev}</span>
          ${emailFull ? `
            <a class="ts2-panel-email" href="mailto:${esc(emailFull)}"
               data-email-full="${esc(emailFull)}"
               aria-label="Email сотрудника (mailto-ссылка); кликните чтобы раскрыть"
               title="Написать ${esc(maskEmail(emailFull))} (клик — раскрыть полностью)">${esc(maskEmail(emailFull))}</a>` : ''}
        </div>
        ${metricRow}
      </div>
      <div class="ts2-panel-head-actions">
        <!-- V20 S8 #7 — Copy-for-TG: 5-7 строк plain-text + permalink.
             Async-тимлид feedback: «копирую вручную в Telegram». -->
        <!-- V20 S8.5 #8 — расширенный hint что попадёт в clipboard. -->
        <button class="ts2-btn ts2-btn-ghost ts2-panel-tgcopy" id="ts2-detail-tgcopy" type="button"
                title="Копирует 5-7 строк plain-text для чата:&#10;• имя сотрудника&#10;• счётчики событий (сегодня/вчера/WIP)&#10;• топ-3 блокера с dwell-time&#10;• активность 48ч (commits / PR / CF)&#10;• ссылка на эту карточку"
                aria-label="Копировать для Telegram">${Icons.get('send', { cls: 'btn-icon', size: 12 })} TG</button>
        <button class="ts2-btn ts2-btn-ghost ts2-panel-share" id="ts2-detail-share" type="button"
                title="Скопировать ссылку на этот вид (для async-команды можно отправить в TG/Slack)"
                aria-label="Скопировать ссылку на детализацию">${Icons.get('link-2', { size: 14 })}</button>
        <button class="ts2-btn ts2-btn-ghost ts2-panel-close" id="ts2-detail-close" type="button" aria-label="Закрыть">${Icons.get('x', { size: 14 })}</button>
      </div>
    </div>
  `;
}

function renderCounters(p) {
  const prs48 = p.badges?.pr48h || 0;
  const com48 = p.badges?.commits48h || 0;
  const tasks = p.contextSwitches?.distinctIssueKeys || 0;
  const hours = (p.loggedTodaySec     || 0) / 3600 +
                (p.loggedYesterdaySec || 0) / 3600 +
                (p.loggedDayBeforeSec || 0) / 3600;
  // UX feedback 2026-05-10 (Sc4) — большие бледно-коричневые hero-карточки
  // вместо мелких counter cells. Структура та же (4 значения), но визуал
  // заметно крупнее: bronze tint, 28px цифра, CAPS-eyebrow подпись, 16-20px
  // padding. Класс `ts2-panel-counters-hero` отдельный — старый
  // `.ts2-panel-counter` стиль остаётся для backward-compat (не используется
  // здесь, но не удалён, чтобы не сломать другие места).
  return `
    <div class="ts2-panel-counters ts2-panel-counters-hero">
      ${heroCounterCell(com48, 'коммитов', '48ч')}
      ${heroCounterCell(prs48, 'PR',       '48ч')}
      ${heroCounterCell(tasks, 'задач',    '72ч')}
      ${heroCounterCell(hours.toFixed(1), 'часов', '72ч')}
    </div>
  `;
}
function heroCounterCell(num, lab, sub) {
  return `<div class="ts2-panel-counter ts2-panel-counter-hero">
    <div class="ts2-panel-counter-lab">${esc(lab)}</div>
    <div class="ts2-panel-counter-num">${esc(num)}</div>
    <div class="ts2-panel-counter-sub">${esc(sub)}</div>
  </div>`;
}
// Backward-compat: legacy small variant (если где-то ещё вызывается).
// eslint-disable-next-line no-unused-vars
function counterCell(num, lab, sub) {
  return `<div class="ts2-panel-counter">
    <div class="ts2-panel-counter-num">${esc(num)}</div>
    <div class="ts2-panel-counter-lab">${esc(lab)}</div>
    <div class="ts2-panel-counter-sub">${esc(sub)}</div>
  </div>`;
}

function renderHeatmap72x4(h, filters) {
  // V18.1 P7-S2.5 — peak-hour label в hint вместо отдельного sparkline.
  // Sparkline дублировал colTotals heatmap'а 1:1 — Manager+Тимлид+Tech
  // независимо отметили это как балласт. Удалили + перенесли peak в hint.
  let peakHint = 'час × источник';
  if (h.peakCell && h.peakCell.count > 0) {
    const hoursAgo = 71 - h.peakCell.hourIndex;
    const srcName = SRC_NAMES[h.peakCell.srcIdx] || '';
    peakHint = `пик ${srcName} ${hoursAgo}ч назад · ${h.peakCell.count} ${plural(h.peakCell.count, ['событие', 'события', 'событий'])}`;
  }
  // 4 строки × 72 колонки. Каждая клетка — opacity по плотности.
  const rows = h.grid.map((row, srcIdx) => {
    const visible = filters[SRC_KEYS[srcIdx]] !== false;
    const peak = row.length ? Math.max(...row) : 0;
    // V22 S-16 (audit-experts-2026-05-15 Heinz C4) — динамический max + sqrt
    // нормировка. Раньше step-jumps были перцептивно инвертированы:
    //   0→1: +0.25 (+250% яркости) — «было/не было» выглядит огромным
    //   3→4: +0.15 (+18%) — «много/очень много» — почти неразличимо
    // Это нарушает Stevens' power law (perceived ~ stim^0.5).
    // Теперь: sqrt-нормировка против row-max. Шаги 0→1 видно, но НЕ так
    // драматично; 3→4→8→12 различимы благодаря квадратному корню.
    const _saturatedThreshold = Math.max(4, Math.ceil(peak * 0.85));
    const _rowMaxForScale = Math.max(_saturatedThreshold, 1);
    const cells = row.map((n, hourIdx) => {
      // sqrt(n / rowMax) даёт perceptually-linear opacity: 0→0, 1→0.50,
      // 4→0.71, 9→0.94, 16→1.0 (для rowMax=16). На малых rowMax кривая
      // сглаживается. Min 0.08 для n=0 чтобы клетка читалась как «cell»,
      // а не «дыра в ряду».
      let op, isHigh = false;
      if (n === 0) op = 0.08;
      else {
        const ratio = Math.min(1, n / _rowMaxForScale);
        op = 0.20 + 0.80 * Math.sqrt(ratio);
        if (n >= _saturatedThreshold) isHigh = true;
      }
      const isPeak = h.peakCell && h.peakCell.srcIdx === srcIdx && h.peakCell.hourIndex === hourIdx;
      // 2026-05-11 — 5-color palette: per-source цвет вместо единого синего.
      // Раньше все источники J/B/C/Z = одинаковый цвет, на 72×5 grid нельзя
      // быстро увидеть «вторник 0 коммитов, но есть CF» — паттерны замешаны.
      // Теперь каждая строка визуально отличается:
      //   J=Jira (blue), B=Bitbucket (green), C=Confluence (amber),
      //   Zc=Zephyr-tests (purple), Ze=Zephyr-runs (rose).
      const classes = ['ts2-hcell', `ts2-hcell-src-${SRC_KEYS[srcIdx]}`];
      if (isPeak) classes.push('ts2-hcell-peak');
      if (isHigh) classes.push('ts2-hcell-saturated');
      const hoursAgo = 71 - hourIdx;
      // V18.1 P7-S3.1 — aria-hidden на каждой клетке: parent .ts2-heatmap
      // имеет один aria-label с summary; SR не должен читать 288
      // отдельных tooltip'ов. title= оставлен для mouse hover.
      return `<span class="${classes.join(' ')}" style="opacity:${op}" aria-hidden="true" title="${SRC_NAMES[srcIdx]} · ${hoursAgo}ч назад · ${n} ${plural(n, ['событие','события','событий'])}"></span>`;
    }).join('');
    return `
      <div class="ts2-hrow ${visible ? '' : 'ts2-hrow-hidden'}">
        <span class="ts2-hrow-label" title="${SRC_NAMES[srcIdx]} · ${h.rowTotals[srcIdx]} событий">${SRC_LABELS[srcIdx]}</span>
        <span class="ts2-hrow-cells">${cells}</span>
        <span class="ts2-hrow-total">${h.rowTotals[srcIdx]}</span>
      </div>
    `;
  }).join('');
  // V18.1 P7-S3.1 — a11y summary для SR'а: один aria-label на контейнер
  // вместо 288 разрозненных tooltip'ов на каждой клетке.
  const totalEvents = h.rowTotals.reduce((s, n) => s + n, 0);
  const ariaSummary = `Heatmap активности 72 часа × 4 источника (Jira/Bitbucket/Confluence/Zephyr). Всего ${totalEvents} событий за 72ч. ${peakHint}.`;
  return `
    <div class="ts2-panel-section">
      <div class="ts2-panel-section-title">Heatmap 72×4 <span class="ts2-panel-section-hint">${esc(peakHint)}</span></div>
      <div class="ts2-heatmap" role="img" aria-label="${esc(ariaSummary)}">
        ${rows}
        <div class="ts2-haxis" aria-hidden="true">
          <span class="ts2-haxis-tick">−72ч</span>
          <span class="ts2-haxis-tick">−48ч</span>
          <span class="ts2-haxis-tick">−24ч</span>
          <span class="ts2-haxis-tick ts2-haxis-tick-now">сейчас</span>
        </div>
      </div>
    </div>
  `;
}

function renderFilters(filters, rowTotals) {
  // V18.1 P7-S1.6 — aria-pressed для toggle-state, чтобы NVDA/JAWS озвучивал
  // «Jira нажато» / «Confluence не нажато». Закрывает WCAG 4.1.2 (Name,
  // Role, Value).
  const pills = SRC_KEYS.map((k, i) => {
    const active = filters[k] !== false;
    const total = rowTotals[i] || 0;
    return `
      <button class="ts2-filter-pill ${active ? 'ts2-filter-pill-on' : 'ts2-filter-pill-off'}"
              data-filter="${k}" type="button"
              aria-pressed="${active ? 'true' : 'false'}"
              aria-label="${SRC_NAMES[i]} · ${total} событий, ${active ? 'фильтр активен' : 'фильтр выключен'}">
        <span class="ts2-filter-pill-key">${SRC_LABELS[i]}</span>
        <span class="ts2-filter-pill-name">${SRC_NAMES[i]}</span>
        <span class="ts2-filter-pill-num">${total}</span>
      </button>
    `;
  }).join('');
  return `<div class="ts2-panel-filters">${pills}</div>`;
}

function renderBlockersShelf(blockers) {
  // V18.1 P7-S2.2 — пороги status-зависимые: Code Review > 8ч, QA > 16ч,
  // In Progress > 48ч, To Do > 72ч, default > 24ч.
  // V18.1 P7-S3.2 — обёрнуто в <details> (collapsed by default) по
  // запросу HR panel: «снижает persona-pressure», содержимое =
  // персональное досье на конкретного человека, должно открываться
  // осознанным кликом, не маячить в дефолте.
  if (!blockers.length) {
    return `
      <div class="ts2-panel-section ts2-panel-section-tight">
        <div class="ts2-panel-section-title">Старые задачи <span class="ts2-panel-section-hint">пороги: CR ≥ 8ч · QA ≥ 16ч · IP ≥ 48ч</span></div>
        <div class="ts2-empty-text">Все задачи движутся (dwell в пределах нормы).</div>
      </div>
    `;
  }
  // V18.1 P7-S2.2 — показываем «42ч (порог 8ч)» если threshold не дефолт,
  // чтобы PO/SM понимали ПОЧЕМУ задача в blocker'ах.
  const items = blockers.slice(0, 8).map(b => {
    const threshold = b.thresholdHours;
    // V20 S10.2 — fmtDuration: «1642ч» → «68д 10ч». Порог остаётся в часах
    // (всегда small ≤72ч, к тому же threshold-as-hours = терминология).
    const dwellLabel = (threshold && threshold !== 24)
      ? `${fmtDuration(b.dwellHours)} <span class="ts2-blockers-threshold">(порог ${threshold}ч)</span>`
      : fmtDuration(b.dwellHours);
    return `
    <li class="ts2-blockers-li">
      <span class="ts2-blockers-stripe"></span>
      <span class="ts2-blockers-key">${jiraIssueLink(b.key)}</span>
      <span class="ts2-blockers-status">${esc(b.status)}</span>
      <span class="ts2-blockers-dwell">${dwellLabel}</span>
      <span class="ts2-blockers-summary">${linkifyIssueKeys(esc((b.summary || '').slice(0, 80)))}</span>
    </li>`;
  }).join('');
  return `
    <details class="ts2-panel-section ts2-panel-section-tight ts2-blockers-details">
      <summary class="ts2-panel-section-title ts2-blockers-summary-toggle">
        <span>Старые задачи <span class="ts2-blockers-count">${blockers.length}</span></span>
        <span class="ts2-panel-section-hint">пороги: CR ≥ 8ч · QA ≥ 16ч · IP ≥ 48ч</span>
      </summary>
      <ul class="ts2-blockers-list">${items}</ul>
    </details>
  `;
}

function renderEventsFeed(timeline72h) {
  if (!timeline72h.length) {
    return `
      <div class="ts2-panel-section ts2-panel-section-tight">
        <div class="ts2-panel-section-title">События <span class="ts2-panel-section-hint">за 72 часа</span></div>
        <div class="ts2-empty-text">Нет событий за 72 часа (или все источники в фильтре выключены).</div>
      </div>
    `;
  }
  // V22 (2026-05-09 UX) — убран top-40 limit и группировка по дате.
  // Раньше «top 40 · все источники» путало (всё равно невозможно понять
  // что отрезано). Теперь — все события 72ч, сгруппированные по дню.
  const HOUR_MS = 3600 * 1000;
  const now = Date.now();
  const todayStart   = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
  const yestStart    = todayStart - 24 * HOUR_MS;
  const beforeStart  = todayStart - 48 * HOUR_MS;
  const buckets = { today: [], yesterday: [], dayBefore: [], older: [] };
  for (const e of timeline72h) {
    const ms = e?.at ? Date.parse(e.at) : NaN;
    if (!Number.isFinite(ms)) { buckets.older.push(e); continue; }
    if      (ms >= todayStart)  buckets.today.push(e);
    else if (ms >= yestStart)   buckets.yesterday.push(e);
    else if (ms >= beforeStart) buckets.dayBefore.push(e);
    else                         buckets.older.push(e);
  }
  const renderBucket = (label, evs) => {
    if (!evs.length) return '';
    // V22 (2026-05-10 UX) — idx по позиции в timeline72h позволяет click-to-expand
    // надёжно адресовать событие даже если события в bucket пересекаются
    // по времени с другими bucket'ами.
    const items = evs.map((e) => renderEventLine(e, timeline72h.indexOf(e))).join('');
    return `
      <div class="ts2-events-bucket">
        <div class="ts2-events-bucket-head">
          <span class="ts2-events-bucket-label">${esc(label)}</span>
          <span class="ts2-events-bucket-count">${evs.length} ${plural(evs.length, ['событие', 'события', 'событий'])}</span>
        </div>
        <ul class="ts2-recent ts2-recent-feed">${items}</ul>
      </div>
    `;
  };
  const body = [
    renderBucket('Сегодня',     buckets.today),
    renderBucket('Вчера',       buckets.yesterday),
    renderBucket('Позавчера',   buckets.dayBefore),
    renderBucket('Раньше 72ч',  buckets.older),
  ].join('');
  return `
    <div class="ts2-panel-section ts2-panel-section-tight ts2-events-section">
      <div class="ts2-panel-section-title">События <span class="ts2-panel-section-hint">за 72 часа · ${timeline72h.length} ${plural(timeline72h.length, ['запись', 'записи', 'записей'])}</span></div>
      ${body}
    </div>
  `;
}

/** Render one event row — different per src. V18.1 P6.2.
 *  V22 (2026-05-10 UX) — для Jira ВСЕГДА показываем action label после даты,
 *  чтобы пустые e.text не превращали ленту в безмолвные строки. Для
 *  field/attribute изменений показываем badge с именем поля + diff
 *  доступен через click-to-expand (см. data-event-idx). */
function renderEventLine(e, idx) {
  const at = e?.at ? new Date(e.at).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
  const src = e?.src || 'jira';
  const srcBadge = renderSrcBadge(src, e?.kind);
  let body = '';
  let expandable = '';   // если есть details — html для inline-expansion (li > .ts2-recent-detail)
  // V18.1 P7-S1.4 — все references на issue/PR/page кликабельны через
  // настоящие <a href>. Без этого инструмент только смотрит, не работает.
  if (src === 'jira') {
    const issueKey = e?.issue?.key ? jiraIssueLink(e.issue.key) : '';
    const action = _jiraActionLabel(e);
    const actionHtml = `<span class="ts2-recent-action ts2-recent-action-${esc(action.severity)}" title="${esc(action.kind)}">${esc(action.label)}</span>`;
    const fieldName = e.field || e.fieldName || '';
    const isFieldChange = action.kind === 'field-change' || action.kind === 'attribute_change' || action.kind === 'field_change' || !!fieldName;
    const fieldBadge = (isFieldChange && fieldName)
      ? `<span class="ts2-recent-attr-badge" title="Поле Jira">Поле «${esc(fieldName)}»</span>`
      : '';
    // Preview справа — только если есть e.text и он не дублирует action.label.
    const rawText = String(e.text || '').trim();
    const isDup = rawText && (rawText.toLowerCase() === action.label.toLowerCase());
    const previewText = (rawText && !isDup) ? rawText.slice(0, 60) + (rawText.length > 60 ? '…' : '') : '';
    const preview = previewText
      ? ` <span class="ts2-recent-text">${linkifyIssueKeys(esc(previewText))}</span>`
      : '';
    body = `${actionHtml} ${issueKey}${fieldBadge ? ' ' + fieldBadge : ''}${preview}`;
    // Click-to-expand: показываем from→to diff если есть.
    if (isFieldChange && (e.from || e.to)) {
      const fromS = String(e.from || '').slice(0, 200);
      const toS   = String(e.to   || '').slice(0, 200);
      expandable = `<div class="ts2-recent-diff">`
        + (fromS ? `<div class="ts2-recent-diff-from"><span class="ts2-recent-diff-tag">было</span> ${linkifyIssueKeys(esc(fromS))}</div>` : '')
        + (toS   ? `<div class="ts2-recent-diff-to"><span class="ts2-recent-diff-tag">стало</span> ${linkifyIssueKeys(esc(toS))}</div>` : '')
        + (rawText && (fromS || toS) ? `<div class="ts2-recent-diff-text">${linkifyIssueKeys(esc(rawText))}</div>` : '')
        + `</div>`;
    } else if (rawText && rawText.length > 60) {
      // Длинный коммент / описание — показываем полный текст в expansion.
      expandable = `<div class="ts2-recent-fulltext">${linkifyIssueKeys(esc(rawText))}</div>`;
    }
  } else if (src === 'bb') {
    // bbItem: { kind: 'pr'|'commit'|'review', title, url, repo, status? }
    // UX feedback 2026-05-10 (Sc6) — status (open/merged/declined) теперь
    // СЛЕВА от repo/title, как маленький badge. Раньше шёл в конце через
    // « · open» — терялся в длинной строке.
    const kind = e.kind || '';
    const repo = e.repo ? `<span class="ts2-recent-meta">${esc(e.repo)}</span>` : '';
    const status = e.status
      ? `<span class="ts2-recent-status ts2-recent-status-${esc(String(e.status).toLowerCase())}">${esc(e.status)}</span>`
      : '';
    const titleText = (e.title || '').slice(0, 80);
    const titleHtml = e.url
      ? `<a class="ts2-issue-link" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${linkifyIssueKeys(esc(titleText))}</a>`
      : linkifyIssueKeys(esc(titleText));
    body = `<span class="ts2-recent-kind">${esc(kindLabel('bb', kind))}</span> ${status} ${repo} <span class="ts2-recent-text">${titleHtml}</span>`;
  } else if (src === 'cf') {
    // cfItem: { kind: 'edit'|'create'|'comment', title, spaceName, spaceKey, url }
    const kind = e.kind || 'edit';
    const space = e.spaceName || e.spaceKey ? `<span class="ts2-recent-meta">${esc(e.spaceName || e.spaceKey)}</span>` : '';
    const status = e.status
      ? `<span class="ts2-recent-status ts2-recent-status-${esc(String(e.status).toLowerCase())}">${esc(e.status)}</span>`
      : '';
    const titleText = (e.title || '').slice(0, 80);
    const titleHtml = e.url
      ? `<a class="ts2-issue-link" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${linkifyIssueKeys(esc(titleText))}</a>`
      : linkifyIssueKeys(esc(titleText));
    body = `<span class="ts2-recent-kind">${esc(kindLabel('cf', kind))}</span> ${status} ${space} <span class="ts2-recent-text">${titleHtml}</span>`;
    // Click-to-expand: для CF-edit показываем diff URL + space name.
    const cfDetails = [];
    if (e.spaceName || e.spaceKey) cfDetails.push(`<div><span class="ts2-recent-diff-tag">space</span> ${esc(e.spaceName || e.spaceKey)}</div>`);
    if (e.diffUrl) cfDetails.push(`<div><span class="ts2-recent-diff-tag">diff</span> <a class="ts2-issue-link" href="${esc(e.diffUrl)}" target="_blank" rel="noopener noreferrer">открыть в Confluence</a></div>`);
    if (e.title && e.title.length > 80) cfDetails.push(`<div><span class="ts2-recent-diff-tag">title</span> ${esc(e.title)}</div>`);
    if (cfDetails.length) expandable = `<div class="ts2-recent-diff">${cfDetails.join('')}</div>`;
  } else if (src === 'zephyr') {
    // V18.3 A2 — kind ∈ {test, testSet} → Zc badge; иначе Ze.
    // Sc6 — result (PASS/FAIL/etc) перенесён слева от title как badge.
    const kind = e.kind || 'testExec';
    const result = e.result
      ? `<span class="ts2-recent-status ts2-recent-status-${esc(String(e.result).toLowerCase())}">${esc(e.result)}</span>`
      : '';
    const slimKey = e?.slim?.key;
    const titleText = (e?.slim?.summary || e.title || '').slice(0, 80);
    const titleHtml = slimKey
      ? `${jiraIssueLink(slimKey)} <span class="ts2-recent-text">${esc(titleText)}</span>`
      : `<span class="ts2-recent-text">${esc(titleText)}</span>`;
    body = `<span class="ts2-recent-kind">${esc(kindLabel('zephyr', kind))}</span> ${result} ${titleHtml}`;
    // Click-to-expand: для test execution показываем result + comment.
    const zDetails = [];
    if (e.result)  zDetails.push(`<div><span class="ts2-recent-diff-tag">результат</span> ${esc(e.result)}</div>`);
    if (e.comment) zDetails.push(`<div><span class="ts2-recent-diff-tag">коммент</span> ${linkifyIssueKeys(esc(String(e.comment).slice(0, 240)))}</div>`);
    if (e?.slim?.summary && e.slim.summary.length > 80) zDetails.push(`<div><span class="ts2-recent-diff-tag">summary</span> ${esc(e.slim.summary)}</div>`);
    if (zDetails.length) expandable = `<div class="ts2-recent-diff">${zDetails.join('')}</div>`;
  } else {
    body = esc(e.text || '');
  }
  // V22 (2026-05-10 UX) — click-to-expand: если есть expandable details,
  // навешиваем data-event-idx + cursor:pointer + chevron. Handler сидит
  // в _bindPanelEvents (teamScanner2.js) — делегированный click-listener.
  const hasDetail = !!expandable;
  const idxAttr = hasDetail ? ` data-event-idx="${idx}"` : '';
  const liCls = hasDetail ? 'ts2-recent-li ts2-recent-expandable' : 'ts2-recent-li';
  const chevron = hasDetail ? `<span class="ts2-recent-chevron" aria-hidden="true">›</span>` : '';
  const detailHtml = hasDetail
    ? `<div class="ts2-recent-detail" hidden>${expandable}</div>`
    : '';
  return `<li class="${liCls}"${idxAttr}>${srcBadge}<span class="ts2-recent-at">${esc(at)}</span> ${body}${chevron}${detailHtml}</li>`;
}

/** V22 (2026-05-10 UX) — Mapping Jira event → action label + severity.
 *  Обеспечивает что после даты ВСЕГДА есть видимое действие, даже
 *  если e.text пустой (раньше attribute_change рендерились пустыми). */
function _jiraActionLabel(e) {
  const kind = String(e?.kind || '').toLowerCase();
  const text = String(e?.text || '');
  // Поле для field-change — сначала e.field, потом fieldName, потом разбор text.
  const field = e?.field || e?.fieldName || '';
  if (kind === 'comment' || kind === 'mention') {
    return { label: kind === 'mention' ? 'упоминание' : 'комментарий', severity: 'neutral', kind };
  }
  if (kind === 'transition') {
    const to = e?.to || '';
    return { label: to ? `статус → ${String(to).slice(0, 30)}` : 'переход', severity: 'info', kind };
  }
  if (kind === 'closed' || kind === 'resolved') {
    const to = e?.to || '';
    return { label: to ? `закрыл → ${String(to).slice(0, 30)}` : 'закрыл', severity: 'success', kind };
  }
  if (kind === 'reopened') return { label: 'переоткрыл', severity: 'warning', kind };
  if (kind === 'assignee-change' || kind === 'assignment') {
    const to = e?.to || '';
    return { label: to ? `назначен: ${String(to).slice(0, 30)}` : 'снят исполнитель', severity: 'info', kind };
  }
  if (kind === 'created') return { label: 'создал', severity: 'info', kind };
  if (kind === 'worklog') {
    // text вида "Залогировано 1.5ч" — извлечём часы.
    const m = /(\d+(?:[.,]\d+)?)\s*ч/.exec(text);
    return { label: m ? `лог времени: ${m[1]}ч` : 'лог времени', severity: 'neutral', kind };
  }
  if (kind === 'attachment') return { label: 'вложение', severity: 'neutral', kind };
  if (kind === 'link')       return { label: 'связь', severity: 'neutral', kind };
  if (kind === 'field-change' || kind === 'attribute_change' || kind === 'field_change' || kind === 'edit') {
    return { label: field ? `изменил ${String(field).toLowerCase()}` : 'правка', severity: 'warning', kind: kind || 'field-change' };
  }
  // Default fallback: показываем raw kind, чтобы юзер не видел пустую строку.
  return { label: kind || 'событие', severity: 'neutral', kind: kind || 'unknown' };
}

function renderSrcBadge(src, kind) {
  // V18.3 A2 — Zephyr split: kind ∈ {test, testSet} → Zc, иначе Ze.
  const isZc = src === 'zephyr' && (kind === 'test' || kind === 'testSet');
  const map = {
    jira:  { l: 'J',  cls: 'src-j' },
    bb:    { l: 'B',  cls: 'src-b' },
    cf:    { l: 'C',  cls: 'src-c' },
    zc:    { l: 'Zc', cls: 'src-zc' },
    ze:    { l: 'Ze', cls: 'src-ze' },
  };
  const key = src === 'zephyr' ? (isZc ? 'zc' : 'ze') : src;
  const m = map[key] || map.jira;
  return `<span class="ts2-recent-src ts2-recent-${m.cls}" title="${esc(key)}">${m.l}</span>`;
}

function kindLabel(src, kind) {
  if (src === 'bb') {
    if (kind === 'pr')     return 'PR';
    if (kind === 'commit') return 'commit';
    if (kind === 'review') return 'review';
    return kind;
  }
  if (src === 'cf') {
    if (kind === 'create')  return 'создал страницу';
    if (kind === 'edit')    return 'правка';
    if (kind === 'comment') return 'коммент';
    return kind;
  }
  if (src === 'zephyr') {
    if (kind === 'test' || kind === 'testSet') return 'тест-кейс';
    if (kind === 'testExec' || kind === 'execution') return 'прогон';
    return kind;
  }
  return kind;
}

function renderSwitchesNote(cs) {
  if (!cs || cs.distinctIssueKeys === 0) return '';
  const switches = cs.switchEvents?.length || 0;
  const score    = Math.round((cs.switchScore || 0) * 100);
  const note = switches > 0
    ? `<strong>${switches}</strong> переключений между задачами (gap < 30 мин), <strong>${cs.distinctIssueKeys}</strong> разных задач за 72ч · score ${score}%`
    : `<strong>${cs.distinctIssueKeys}</strong> разных задач за 72ч, без частых переключений`;
  return `<div class="ts2-panel-footer-note">${note}</div>`;
}

/** Backward-compat: P3-style inline stub. Сохранён для случаев когда
 *  side-panel не активен (например, в тестах). НЕ вызывается в P5+ UI. */
export function renderDetailStub(model, key) {
  return renderEmployeeDetailPanel(model, key);
}

/* ── Skeleton / empty / error ────────────────────────── */

export function renderSkeleton(initialMsg) {
  const msg = esc(initialMsg || 'Запрашиваю данные из Jira…');
  return `
    <div class="ts2-skeleton">
      ${prizmaLoaderMark()}
      <div class="ts2-skel-phrase phrase-in" id="ts2-skel-phrase"></div>
      <div class="ts2-skel-status">
        <span id="ts2-skel-text">${msg}</span>
        <button class="ts2-btn ts2-btn-ghost" id="ts2-skel-cancel" type="button">Отмена</button>
      </div>
    </div>
  `;
}

export function renderEmpty(mode = 'no-config') {
  // V20 S1.2 — два режима empty-state:
  //   · 'no-config' (legacy default) — нет projectKeys в settings.
  //   · 'no-data'   (new V20 lazy)   — projectKeys есть, данные ещё
  //      не загружались. Single primary CTA «Загрузить данные».
  if (mode === 'no-data') {
    return `
      <div class="ts2-empty-state ts2-empty-hero">
        <div class="ts2-empty-icon" aria-hidden="true"></div>
        <div class="ts2-empty-title">Призма ждёт первый ориентир</div>
        <div class="ts2-empty-sub">Загрузите данные — увидите активность команды.</div>
        <div class="ts2-empty-text">
          Данные не загружены. Нажмите кнопку чтобы запросить активность
          из Jira / Bitbucket / Confluence — по умолчанию за последние 72ч.
        </div>
        <div class="ts2-empty-actions">
          <button class="ts2-btn ts2-btn-primary ts2-btn-lg" type="button"
                  id="ts2-load-initial">
            Загрузить данные команды
          </button>
          <button class="ts2-btn ts2-btn-outline ts2-btn-lg" type="button"
                  id="ts2-load-demo" title="Запустить с локальной демо-фикстурой — никаких запросов в Jira не делается">
            Посмотреть демо
          </button>
        </div>
        <div class="ts2-empty-hint">
          Окно активности (24 / 72 / 168 ч) и пороги dwell-time можно
          настроить в шестерёнке после первой загрузки.
        </div>
        <!-- V20 — secondary actions доступны ДО первой загрузки.
             Особенно «Диагностика» — нужна КОГДА данные не приходят. -->
        <div class="ts2-empty-secondary">
          <button class="ts2-btn ts2-btn-ghost ts2-btn-sm" type="button" id="ts2-empty-how-btn">Как считается</button>
          <button class="ts2-btn ts2-btn-ghost ts2-btn-sm" type="button" id="ts2-empty-diag-btn">Диагностика</button>
        </div>
      </div>
    `;
  }
  // V18.1 P7-S3.3 — CTA button «Открыть настройки» (designer finding:
  // «empty state без CTA = anti-pattern, пользователь сам должен идти
  // в шапку → settings»). Кнопка имеет data-action для глобального
  // settings-modal handler'а.
  // V21 π5 — добавлена secondary CTA «Посмотреть демо» — позволяет показать
  // сканер новому пользователю до того как настроены интеграции.
  return `
    <div class="ts2-empty-state">
      <div class="ts2-empty-title">Нужны проектные ключи</div>
      <div class="ts2-empty-text">
        В настройках интеграций укажите ключи проектов Jira —
        Сканнер команд опирается на тот же поток данных что и legacy-сканер.
      </div>
      <div class="ts2-empty-actions">
        <button class="ts2-btn ts2-btn-primary" type="button"
                data-int-action="settings" data-tab="jira">
          Открыть настройки интеграций
        </button>
        <button class="ts2-btn ts2-btn-outline" type="button"
                id="ts2-load-demo" title="Запустить с локальной демо-фикстурой — никаких запросов в Jira не делается">
          Посмотреть демо
        </button>
      </div>
    </div>
  `;
}

export function renderError(msg, retryable) {
  return `
    <div class="ts2-error">
      <div class="ts2-error-title">Не удалось загрузить</div>
      <div class="ts2-error-text">${esc(msg || 'Неизвестная ошибка')}</div>
      ${retryable ? `<button class="ts2-btn ts2-btn-primary" id="ts2-retry-btn" type="button">Повторить</button>` : ''}
    </div>
  `;
}

/* ── V20 S1.4 — «Как считается» modal ────────────────────────
   PO request: «добавь кнопку как считается — по клику модалка с описанием
   как считаются все метрики».

   Шаблон клонирован из portfolioPulseRenderer.js renderHowModal:
   accordion-секции, esc-close, click-on-overlay close.
   PO panel предоставила формулировки в человекочитаемом виде.
   ──────────────────────────────────────────────────────── */

export const HOW_SECTIONS = [
  {
    id: 'groups',
    head: 'Группы: Стоп / Watch / Движется / Без активности',
    body: `
      Каждый сотрудник попадает в одну из 4 групп по его последней активности:<br><br>
      <b>Стоп</b> — есть «висящие» задачи (stuck/blockers > 0) и при этом 0 активных событий за сегодня.
      Это сигнал: человек либо заблокирован, либо не вышел в работу.<br><br>
      <b>Watch (под наблюдением)</b> — один из трёх флагов:
      перегрузка (issuesNow ≥ 3), либо blockers + сегодня всё-таки что-то делал, либо вчера была активность но сегодня тишина.<br><br>
      <b>Движется</b> — есть события сегодня (Jira/BB/CF), без красных флагов.<br><br>
      <b>Без активности</b> — за окно активности (по умолчанию 72ч) нет следов в Jira / Bitbucket / Confluence /
      Zephyr вообще. Может означать: отпуск, отгул, человек в проекте только числится.
    `,
  },
  {
    id: 'sprint-goal',
    head: 'Sprint Goal — % выполнения цели',
    body: `
      Берутся все активные спринты по проектным ключам (Jira API <code>/sprint?state=active</code>),
      затем агрегируется:<br><br>
      <b>aggregateProgress</b> = Σ done-issues / Σ total-issues × 100% (по всем активным спринтам, без weighted-by-pk).<br><br>
      <b>aggregatePace</b>:<br>
      · <i>ahead</i> — done% > expected% + 10pp<br>
      · <i>on-track</i> — done% в пределах ±10pp от expected<br>
      · <i>behind</i> — done% < expected% − 10pp<br><br>
      <b>expected%</b> = elapsed-days / total-sprint-days. Например, 5/10 дней спринта прошло → ожидаем 50% сделано.<br><br>
      Если спринтов несколько (per-pk) — показываем pills рядом с aggregate gauge'ем.
    `,
  },
  {
    id: 'risks',
    head: 'Риски: Orphan / Out-of-sprint',
    body: `
      <b>Orphan</b> — задачи без assignee. Считаются по всему окну активности.
      <code>totalOrphans</code> = Σ (issues without assignee) per-pk.<br><br>
      <b>Out-of-sprint</b> — задачи в работе, но не в активном спринте. Это:<br>
      · status NOT IN (Done, Closed, Resolved)<br>
      · sprint IS EMPTY OR sprint.state != active<br><br>
      <code>outOfSprintRatio</code> = totalOutOfSprint / totalInProgress. Высокий ratio (> 30%)
      означает что команда тушит пожары вне backlog-планирования.
    `,
  },
  {
    id: 'blockers',
    head: 'Blockers / Stale — «висит долго»',
    body: `
      Задача считается blocker если её dwell-time в текущем статусе превышает порог:<br><br>
      · <b>Code Review</b>: 8 ч (default)<br>
      · <b>QA / In Testing</b>: 16 ч<br>
      · <b>In Progress</b>: 48 ч<br>
      · <b>To Do / Open</b>: 72 ч<br>
      · <b>прочие статусы</b>: 24 ч<br><br>
      Пороги переопределяются per-team в кнопке «Настройка команд» (preset «research» — расслабленные пороги,
      «hotfix» — жёсткие). Per-team config приоритетнее default'ов.
    `,
  },
  {
    id: 'window',
    head: 'Окно активности (часов)',
    body: `
      Период за который собираются артефакты: коммиты, PR, правки в Confluence, события в Jira-таймлайне.
      По умолчанию 72ч (3 рабочих дня).<br><br>
      Настраивается в <b>Настройки интеграций → Confluence → «Окно активности»</b>:
      24 / 72 / 168 ч или произвольное значение [1, 168].<br><br>
      <i>Heatmap 72×4</i> всегда рисует ровно 72 часа — это визуальная константа, не зависящая от окна.
      Окно влияет только на список событий и счётчики «Делал сегодня / вчера / позавчера».
    `,
  },
  {
    id: 'identity',
    head: 'Identity-deterministic attribution',
    body: `
      Артефакты привязываются к сотруднику строго по полям из реестра:
      <code>email</code>, <code>jiraAccountId</code>, <code>bitbucketLogin</code>, <code>confluenceAccountId</code>.<br><br>
      Никакого fuzzy-name-matching — если у сотрудника <code>bitbucketLogin</code> пустой,
      он не получит BB-данных даже если коммиты от его имени есть. Это compliance-требование
      (V17.2 I1c): уменьшает риск ложных attribution в HR-разговорах.<br><br>
      Если человек в группе «Без активности» а вы знаете что он работает — проверьте,
      что в реестре заполнены identity-поля для его проекта.
    `,
  },
  {
    id: 'snapshot',
    head: 'Тренды: вчера / 14 дней',
    body: `
      Каждый успешный fetch сохраняет <b>snapshot</b> в localStorage браузера:
      counts по группам + risks + sprintGoal + размер команды.<br><br>
      <b>Δ vs вчера</b> — если есть snapshot 5 мин – 24 ч давности, показываем дельту в gauge'ах
      и цифрах под счётчиками групп.<br><br>
      <b>14-day sparkline</b> — линия тренда «команда росла/уменьшалась», «stop расширился»
      и т.п. Хранится 30 snapshots (1/день, last-wins за день). Local-only, не синхронизируется
      между браузерами.
    `,
  },
  {
    id: 'hot-files',
    head: 'Hot-files и Bus-factor',
    body: `
      <b>Hot-files</b> — top-15 файлов с наибольшим числом коммитов за окно (по умолчанию 90 дней,
      настраивается через <code>HOT_FILES_DAYS</code>). Источник: Bitbucket commits → diff →
      file paths.<br><br>
      <b>Bus-factor</b> — для каждого файла считается сколько уникальных авторов его трогали.
      Файлы с bus-factor=1 — single-point-of-failure: только один человек знает этот код.<br><br>
      <b>Выборка</b>: top-5 репозиториев × до 1000 коммитов за 90 дней (PR-CZ; раньше было 200/30д).
      Если у вас 50 репозиториев — это ~10% выборка, абсолютные числа стоит читать как «не меньше N».
    `,
  },
  {
    id: 'code-review',
    head: 'Code review: velocity / depth / reciprocity',
    body: `
      <b>Code-review velocity</b> — для каждого ревьюера медиана времени между
      «PR opened» и его первой review-action (approve / comment / needs-work).<br>
      · <i>fast</i> &lt; 8 ч · <i>warn</i> 8–24 ч · <i>slow</i> &gt; 24 ч.<br><br>
      <b>Review depth</b> — среднее число комментариев reviewer'а на один PR.
      Высокий = глубокое ревью, низкий = «approve без чтения».<br><br>
      <b>Reciprocity ratio</b> — для каждого автора: сколько ревью он сделал чужих PR vs
      сколько ревью получил на свои. Близко к 1 = здоровый баланс. Сильно &lt; 1 = автор
      «дёргает других», но сам не ревьюит.
    `,
  },
  {
    id: 'pr-cycle',
    head: 'PR cycle-time / first-review-latency',
    body: `
      <b>cycle-time</b> = (mergedAt − openedAt) для merged PR. Считаем p50 и p90 за окно.<br><br>
      <b>first-review-latency</b> = (firstReviewAt − openedAt). Если PR открыли в 10:00 а первую
      review-action поставили в 14:00 — латентность 4ч.<br><br>
      <b>review depth (avg comments)</b> — среднее число COMMENTED activity по PR из окна.
      Источник для всех трёх — Bitbucket Server <code>/pull-requests/{id}/activities</code> stream
      (cap 30 PR, concurrency 4).
    `,
  },
  {
    id: 'reviewer-load',
    head: 'Reviewer overload / Idle reviewers',
    body: `
      <b>Reviewer overload</b> — top-5 авторов по числу assigned reviews. Если кто-то на 50%+
      ревью — это burnout signal. Cap'ы конфигурируются:
      <code>prOverloadOpenedThreshold=5</code>, <code>prOverloadRateThreshold=40%</code>.<br><br>
      <b>Idle reviewer</b> — человек попал в <code>reviewers[]</code> PR, но за окно не оставил ни
      approve, ни comment, ни needs-work. Сидит на ревью, но не действует — задерживает merge.<br><br>
      Источник — те же Bitbucket activities. Идея: тимлид может перераспределить нагрузку.
    `,
  },
  {
    id: 'after-hours',
    head: 'After-hours ratio / Перегрузка',
    body: `
      Доля коммитов / PR / правок Confluence за «нерабочие часы» (вечер 21:00 – утро 09:00 локального
      времени, выходные включены).<br><br>
      <b>afterHoursRatio</b> = (events outside business hours) / (total events). Высокая ratio (&gt; 30%)
      устойчиво на нескольких неделях — сигнал риска выгорания.<br><br>
      <b>${Icons.get('alert-triangle', { cls: 'btn-icon', size: 12 })} Manager-only</b> — это HR-чувствительная метрика. Используется для анонимной агрегации,
      не для конкретных диалогов с сотрудником без явного его согласия.<br><br>
      <i>Известное ограничение</i> (PR-CE backlog): расчёт идёт по UTC; для Москвы добавляется +3ч офсет.
      DST не учитывается. Будет исправлено передачей <code>tzOffsetMin</code> с клиента.
    `,
  },
  {
    id: 'knowledge',
    head: 'Knowledge breadth / Spreaders / Siloed',
    body: `
      <b>Specialist Gini</b> — для каждого автора смотрим распределение его коммитов по файлам.
      Близко к 0 = пишет везде понемногу (broad). Близко к 1 = весь код в 1–2 файлах (siloed).<br><br>
      <b>Knowledge spreader</b> — автор у которого CF-страницы в ≥3 разных spaces. Распространяет
      знание, не сидит в своей зоне. Promote-кандидат.<br><br>
      <b>Siloed author</b> — большинство коммитов в одном файле / папке за окно. Не плохо само
      по себе, но в сочетании с bus-factor=1 — блокер для succession planning.
    `,
  },
  {
    id: 'doc-debt',
    head: 'Doc-debt: orphan ratio / stale / ACL',
    body: `
      <b>Orphan-страницы</b> — CF-страницы у которых автор больше не в команде (deactivated [X])
      ИЛИ автор не сматчился с identity-таблицей.<br><br>
      <b>Stale &gt; 1 год</b> — страницы которые не обновлялись больше 12 месяцев. Доля в общем
      числе страниц = doc-debt indicator.<br><br>
      <b>ACL anomalies</b> — страницы с пермиссиями anonymous/closed (отличаются от типичного
      space default). Помечаются как требующие ручной review.
    `,
  },
  {
    id: 'sprint-metrics',
    head: 'Sprint: commitment vs delivery / scope churn / carry-over',
    body: `
      <b>Sprint commitment vs delivery</b> — Σ(SP в начале спринта) vs Σ(closed SP в конце).
      Тренд по 6 спринтам показывает консистентность планирования.<br><br>
      <b>Scope churn</b> — разница между sprint at start и sprint at end по 3 категориям:
      <code>added / removed / modified</code> (basis: changelog walk через Jira API).<br><br>
      <b>Carry-over age</b> — сколько раз issue переносилась из спринта в спринт. Issues с
      carry-over ≥ 3 — кандидаты на rework / split / cancel.<br><br>
      <b>Code churn per sprint</b> — Σ(added lines + deleted lines) из BB diff. Высокий churn
      может говорить о rework, refactor или нестабильных требованиях.
    `,
  },
  {
    id: 'estimation',
    head: 'Estimation calibration (CoV)',
    body: `
      <b>CoV (coefficient of variation)</b> = stdev(actual / estimate) / mean(actual / estimate).
      Если разработчик оценивает в 5 SP, а реально получается то 5, то 3, то 8 SP — CoV высокий
      (≥ 0.5). Если стабильно (4–6 SP) — низкий.<br><br>
      Берётся последние 30 closed issues с заполненным <code>customfield_estimate</code> и
      <code>aggregatetimespent</code>. CoV ≥ 0.5 показывается жёлтым, ≥ 0.8 — красным.<br><br>
      <i>Известное ограничение</i> (PR backlog #11): сейчас per-person + per-PK. Team-rollup
      (CoV команды) запрошен PO — отложен.
    `,
  },
  {
    id: 'dora-proxy',
    head: 'DORA proxy: deploy / lead-time / MTTR / change-fail',
    body: `
      «Реальный» DORA требует CI/CD интеграцию (deployment events). У нас её нет, поэтому
      используются <b>proxy</b>:<br><br>
      <b>Deploy frequency</b> ≈ число merged PR в master/main за окно ÷ дни.<br>
      <b>Lead time</b> ≈ медиана (mergedAt − firstCommitAt) для merged PR.<br>
      <b>MTTR</b> ≈ медиана dwell-time в статусе «Blocker» для bug-issues.<br>
      <b>Change-fail rate</b> ≈ доля reverted commits + bug-issues с label
      <code>regression</code> / <code>hotfix</code>.<br><br>
      Числа имеют доверительный интервал ±20%. Для C-level важен <i>тренд</i>, не абсолют.
    `,
  },
];


/* 2026-05-11 — Tier 0 Renderer split phase 1: diagnostic-view функции
   вынесены в `teamScanner2RendererDiag.js` (~1330 LOC). Здесь — только
   re-export'ы для backward-compat (existing imports работают без правок).
   Spec: docs/feature-specs/renderer-split.md. */
export {
  renderDiagnosticModal,
  renderDiagnosticDisclaimer,
  renderProbeResults,
  renderIdentityResolvePreview,
  renderSensitivityResults,
  renderCrvDrilldownModal,
  renderAnomalyMiniChart,
  renderHowCalculatedModal,
} from './teamScanner2RendererDiag.js';
// 2026-05-11 — renderVelocityCompareModal остаётся в main (использует
// renderVelocityComparison локально, чтобы избежать circular import'а с
// diag-extract). Benchmarks helper импортируется обратно из diag.
import { _renderCrossTeamBenchmarks } from './teamScanner2RendererDiag.js';

export function renderVelocityCompareModal(model, history = [], ctx = {}) {
  const velocityInner = renderVelocityComparison(model, history, ctx) ||
    `<div class="ts2-velocity-empty">Нужно ≥ 2 команды с активными спринтами для сравнения.</div>`;
  // 2026-05-11 — V23 Cross-team Benchmarks subtab. Матрица команды × метрики.
  const benchmarksInner = _renderCrossTeamBenchmarks(model, history);
  return `
    <div class="ts2-how-modal-overlay" id="ts2-velocity-modal" role="presentation">
      <div class="ts2-how-modal" role="dialog" aria-modal="true" aria-labelledby="ts2-velocity-title">
        <div class="ts2-how-header">
          <h3 class="ts2-how-title" id="ts2-velocity-title">Сравнение команд</h3>
          <button class="ts2-how-close" type="button" data-close-modal aria-label="Закрыть">${Icons.get('x', { size: 14 })}</button>
        </div>
        <div class="ts2-compare-tabs" role="tablist" aria-label="Виды сравнения">
          <button class="ts2-compare-tab is-active" type="button" role="tab" aria-selected="true" data-compare-tab="velocity">Velocity</button>
          <button class="ts2-compare-tab" type="button" role="tab" aria-selected="false" data-compare-tab="benchmarks">Benchmarks</button>
        </div>
        <div class="ts2-how-body">
          <div class="ts2-compare-pane is-active" data-compare-pane="velocity">
            ${velocityInner}
          </div>
          <div class="ts2-compare-pane" data-compare-pane="benchmarks" hidden>
            ${benchmarksInner}
          </div>
        </div>
      </div>
    </div>
  `;
}


/* ═══════════════════════════════════════════════════════════
   Phase 3 E2 — Anchor-scroll target-highlight helper
   ───────────────────────────────────────────────────────────
   Брендбук §9 #3 (pulse) + готовый класс `.ts2-btn-flash` (1s ease-out 2x).
   Когда Сканнер делает scrollIntoView к якорю (action queue → person row,
   anomaly → mini-chart) — пользователю нужен визуальный «вот сюда я привёл
   взгляд». 1s mostly hidden = почти 2 секунды двойного flash'а.
   Wire — после scrollIntoView в teamScanner2.js (V18.3 A5). Phase 4
   подключит вызов в orchestrator'е, helper уже доступен.
   ═══════════════════════════════════════════════════════════ */
export function flashAnchorTarget(el) {
  if (!el || typeof el.classList?.add !== 'function') return;
  try {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  } catch (_) { /* SSR/test env — игнорируем */ }
  el.classList.remove('ts2-btn-flash');
  // force reflow для restart-анимации, если повторный flash на том же элементе
  // eslint-disable-next-line no-unused-expressions
  el.offsetHeight;
  el.classList.add('ts2-btn-flash');
  setTimeout(() => el.classList.remove('ts2-btn-flash'), 2000);
}
