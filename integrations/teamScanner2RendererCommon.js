'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — RENDERER (COMMON)
   Extracted 2026-05-12 — Tier 0 Renderer split phase 2.

   Common utility helpers used by all renderer modules:
     · esc / plural — string utilities
     · fmtHours / fmtDuration — time formatting
     · renderSparkline / renderDelta — pure SVG helpers
     · bucketByHour / dotStrip — 24h activity visualization
     · emptyDayLanguage — neutral wording for no-activity

   Import as: import { esc, plural, fmtDuration, ... } from './teamScanner2RendererCommon.js';
   ============================================================ */

import { Utils } from '../utils.js';

export const esc = (v) => Utils.escapeHtml(String(v == null ? '' : v));
export const plural = (n, forms) => Utils.plural(n, forms);

export function fmtHours(seconds) {
  if (!seconds || seconds <= 0) return '0';
  const h = seconds / 3600;
  return h < 10 ? h.toFixed(1) : Math.round(h).toString();
}

/**
 * V20 S10.2 — Format dwell-duration (input: hours, not seconds).
 * Format table:
 *   < 24ч       → «18ч»          (округление, как было)
 *   24..999ч    → «Xд Yч» / «Xд» (если Y=0)
 *   ≥ 1000ч     → «Xд»           (часы не дописываем)
 *   < 0 / NaN   → «—»            (defensive: clock-skew)
 * NB: не использовать в snapshot/diagnostic serialization paths.
 */
export function fmtDuration(h) {
  const n = Number(h);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 24) return `${Math.round(n)}ч`;
  const days = Math.floor(n / 24);
  if (n >= 1000) return `${days}д`;
  const rem = Math.round(n - days * 24);
  if (rem === 0) return `${days}д`;
  if (rem === 24) return `${days + 1}д`;
  return `${days}д ${rem}ч`;
}

/**
 * V19 C2 — Mini-sparkline для history-серии (14 дней).
 * Pure inline-SVG, ~12 LOC SVG. Не использует external charting library.
 * 2026-05-11 — EMA overlay (dashed) поверх raw series.
 */
export function renderSparkline(series, opts = {}) {
  if (!Array.isArray(series) || series.length < 2) return '';
  const w = Number(opts.width)  || 80;
  const h = Number(opts.height) || 18;
  // V22 K-06 (audit-experts-2026-05-15 Heinz C2) — раньше baseline был
  // прибит к нулю: `Math.min(0, …)`. Для убывающих серий ([12,11,10,9,8,7,5,4,3])
  // max=12, min=0 → линия занимает 4/18px по вертикали — тренд визуально
  // занижен в 2.5×. Tufte (Beautiful Evidence) и Cleveland: sparkline
  // кодирует ЛОКАЛЬНОЕ движение, baseline должен быть data-min с padding'ом.
  //
  // Теперь: min = data_min - 10% (padding), max = data_max + 10%. Для
  // процентных метрик (когда нужен 0-anchor) caller передаёт opts.anchorZero=true.
  let min, max;
  if (opts.anchorZero === true) {
    max = Math.max(1, Math.max(...series));
    min = Math.min(0, Math.min(...series));
  } else {
    const dMin = Math.min(...series);
    const dMax = Math.max(...series);
    const pad = (dMax - dMin) * 0.10 || 1;
    min = dMin - pad;
    max = dMax + pad;
  }
  const range = max - min || 1;
  const stepX = w / (series.length - 1);
  const points = series.map((v, i) => {
    const x = Math.round(i * stepX);
    const y = Math.round(h - ((v - min) / range) * (h - 2) - 1);
    return `${x},${y}`;
  }).join(' ');
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const trendUp = last > prev;
  const dotCls = (opts.lastIsBad && trendUp) ? 'ts2-spark-dot-bad'
              : (opts.lastIsBad && !trendUp) ? 'ts2-spark-dot-good'
              : 'ts2-spark-dot';
  const lastX = Math.round((series.length - 1) * stepX);
  const lastY = Math.round(h - ((last - min) / range) * (h - 2) - 1);
  let emaPath = '';
  if (series.length >= 4 && opts.showEma !== false) {
    const alpha = 0.3;
    const ema = [series[0]];
    for (let i = 1; i < series.length; i++) {
      ema.push(alpha * series[i] + (1 - alpha) * ema[i - 1]);
    }
    const emaPoints = ema.map((v, i) => {
      const x = Math.round(i * stepX);
      const y = Math.round(h - ((v - min) / range) * (h - 2) - 1);
      return `${x},${y}`;
    }).join(' ');
    emaPath = `<polyline class="ts2-sparkline-ema" fill="none" stroke-dasharray="2,2" points="${emaPoints}"/>`;
  }
  return `
    <svg class="ts2-sparkline-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <polyline class="ts2-sparkline-line" fill="none" points="${points}"/>
      ${emaPath}
      <circle class="${dotCls}" cx="${lastX}" cy="${lastY}" r="2"/>
    </svg>
  `;
}

/** V18.1 P7-S4.2 — render trend-delta arrow. */
export function renderDelta(curr, prev, opts = {}) {
  if (typeof prev !== 'number') return '';
  const delta = curr - prev;
  if (delta === 0) return '';
  const positiveIsBad = !!opts.positiveIsBad;
  const arrow = delta > 0 ? '↑' : '↓';
  const cls = positiveIsBad
    ? (delta > 0 ? 'ts2-delta-bad'  : 'ts2-delta-good')
    : (delta > 0 ? 'ts2-delta-good' : 'ts2-delta-bad');
  const absDelta = Math.round(Math.abs(delta) * 10) / 10;
  return `<span class="ts2-delta ${cls}" title="вчера было ${prev}">${arrow}${absDelta}</span>`;
}

/**
 * Bucket events by local hour-of-day (0..23). Each bucket = number of events
 * starting in that hour.
 * 2026-05-11 — guard от future-in-time (clock skew).
 */
export function bucketByHour(events) {
  const out = new Array(24).fill(0);
  for (const e of (events || [])) {
    const t = String(e?.at || '');
    if (!t) continue;
    const d = new Date(t);
    if (isNaN(d.getTime())) continue;
    if (d.getTime() > Date.now() + 60 * 60 * 1000) continue;
    const h = d.getHours();
    if (h >= 0 && h < 24) out[h]++;
  }
  return out;
}

/** 24 cells × 14px высоты strip. */
export function dotStrip(hourBuckets, ariaLabel) {
  // V22 S-16 (audit-experts-2026-05-15 Heinz C4 / H5) — sqrt-нормировка
  // против row-max. Step-jumps старой шкалы (0.10/0.45/0.70/0.90/1.0)
  // были перцептивно инвертированы по Stevens' law: 0→1 — огромный jump,
  // 3→4 — почти невидим. Развзодим разрешение «2 vs 4 vs 10 events» через
  // квадратный корень от ratio к maxN строки.
  const rowMax = Math.max(4, hourBuckets.length ? Math.max(...hourBuckets) : 4);
  const cells = hourBuckets.map((n, h) => {
    let opacity;
    if (n === 0) {
      opacity = 0.10;
    } else {
      const ratio = Math.min(1, n / rowMax);
      opacity = 0.25 + 0.75 * Math.sqrt(ratio);
    }
    const cls = n >= Math.ceil(rowMax * 0.85) ? 'ts2-dot ts2-dot-busy' : 'ts2-dot';
    return `<span class="ts2-cell" title="${h.toString().padStart(2, '0')}:00 — ${n} ${plural(n, ['событие', 'события', 'событий'])}"><span class="${cls}" style="opacity:${opacity}"></span></span>`;
  }).join('');
  return `<span class="ts2-strip" role="img" aria-label="${esc(ariaLabel || '')}">${cells}</span>`;
}

/* V18.1 P7-S1.4 — render-context для построения кликабельных URL'ов
   к внешним системам (Jira /browse/KEY). Устанавливается orchestrator'ом
   через setRenderContext({ jiraBaseUrl }) перед каждым _renderFull.
   Перенесено в Common 2026-05-12 (Tier 0 phase 5) чтобы Hero/PersonRows/
   Insights могли использовать без circular import на main renderer. */
let _renderContext = { jiraBaseUrl: '' };
export function setRenderContext(ctx) {
  _renderContext = { ..._renderContext, ...(ctx || {}) };
}
export function getRenderContext() { return _renderContext; }

/** V22 fix (2026-05-09 UX) — превращаем все JIRA-style ключи (PROJ-123)
 *  в теле уже-escape'нутого HTML в кликабельные ссылки. Используем для
 *  narrative-текста, события feed'а, summary блокеров — везде где ключ
 *  встречается inline в свободном тексте.
 *
 *  Принимает УЖЕ-escape'нутый HTML (после `esc(...)`). Совпадение
 *  — `[A-Z][A-Z0-9]{1,9}-\d+` без захвата соседних букв (lookbehind/ahead). */
export function linkifyIssueKeys(escapedHtml) {
  if (!escapedHtml) return '';
  return String(escapedHtml).replace(/(^|[^A-Za-z0-9_-])([A-Z][A-Z0-9]{1,9}-\d{1,7})(?![A-Za-z0-9_-])/g,
    (_m, prefix, key) => `${prefix}${jiraIssueLink(key)}`);
}

export function jiraIssueLink(key) {
  if (!key) return '';
  const base = _renderContext.jiraBaseUrl || '';
  const bbByIssue = _renderContext.bbByIssue || null;
  const entry = bbByIssue ? bbByIssue[key] : null;
  const popData = entry ? { commits: entry.commits || 0, prs: entry.prs || 0 } : null;
  const popAttr = popData
    ? ` data-bb-popover="${esc(JSON.stringify(popData))}"`
    : '';
  const dataKey = ` data-jira-key="${esc(key)}"`;
  if (!base) return `<strong class="jira-key-link"${dataKey}${popAttr}>${esc(key)}</strong>`;
  return `<a class="ts2-issue-link jira-key-link" href="${esc(base)}/browse/${esc(key)}" target="_blank" rel="noopener noreferrer" title="Открыть ${esc(key)} в Jira"${dataKey}${popAttr}>${esc(key)}</a>`;
}

// AUDIT_SCANNER #47 — delegated hover-listener для BB-popover на jira-key
// links. Устанавливаем один раз (idempotent), читаем data-bb-popover, ставим
// title-attr.
if (typeof document !== 'undefined'
    && typeof document.addEventListener === 'function'
    && !document.__ts2BbPopoverBound) {
  document.__ts2BbPopoverBound = true;
  document.addEventListener('mouseover', (e) => {
    const link = e.target?.closest?.('.jira-key-link[data-bb-popover]');
    if (!link) return;
    if (link.dataset.bbTitleApplied === '1') return;
    try {
      const data = JSON.parse(link.dataset.bbPopover || '{}');
      const c = data.commits || 0;
      const p = data.prs || 0;
      if (c || p) {
        const prevTitle = link.getAttribute('title') || '';
        const bbText = `${c} commits · ${p} PRs`;
        link.setAttribute('title', prevTitle ? `${prevTitle}\n${bbText}` : bbText);
        link.dataset.bbTitleApplied = '1';
      }
    } catch (_) { /* malformed JSON — ignore */ }
  }, { passive: true });
}

/** Product-language вместо "0 событий" — снимаем обвиняющий тон.
 *  2026-05-11 — унифицированный empty-state "Без активности". */
export function emptyDayLanguage(p) {
  const reviewSig = (p.badges?.reviews || 0) + (p.badges?.approves || 0);
  const commits   = p.badges?.commits48h || 0;
  const prs       = p.badges?.pr48h || 0;
  const cfN       = (p.cfItems || []).length;
  const bbN       = (p.bbItems || []).length;
  const zephyrN   = ((p.zephyrTestsCreatedRecent  || []).length
                  +  (p.zephyrTestsExecutedRecent || []).length);
  if (reviewSig > 0)               return 'Фокус на код-ревью';
  if (commits > 0 && prs === 0)    return 'Коммиты без транзишенов';
  if (prs > 0)                     return 'Работа с PR';
  if (zephyrN > 0)                 return 'Тестовые прогоны';
  if (cfN > 0)                     return 'Документация / комментарии';
  if (bbN > 0)                     return 'Активность в Bitbucket';
  return 'Без активности';
}
