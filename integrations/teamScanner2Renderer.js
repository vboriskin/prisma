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

const esc = (v) => Utils.escapeHtml(String(v == null ? '' : v));

/* V18.1 P7-S1.4 — render-context для построения кликабельных URL'ов
   к внешним системам (Jira /browse/KEY). Устанавливается orchestrator'ом
   через setRenderContext({ jiraBaseUrl }) перед каждым _renderFull. */
let _renderContext = { jiraBaseUrl: '' };
export function setRenderContext(ctx) {
  _renderContext = { ..._renderContext, ...(ctx || {}) };
}
function jiraIssueLink(key) {
  if (!key) return '';
  const base = _renderContext.jiraBaseUrl || '';
  if (!base) return `<strong>${esc(key)}</strong>`;
  // Внешняя ссылка с rel=noopener — не передаём referrer внутрь Jira.
  return `<a class="ts2-issue-link" href="${esc(base)}/browse/${esc(key)}" target="_blank" rel="noopener noreferrer" title="Открыть ${esc(key)} в Jira">${esc(key)}</a>`;
}

/* ── helpers ─────────────────────────────────────────── */

function plural(n, forms) {
  // forms = ['человек', 'человека', 'человек']
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5)   return forms[1];
  if (b === 1)          return forms[0];
  return forms[2];
}

function fmtHours(seconds) {
  if (!seconds || seconds <= 0) return '0';
  const h = seconds / 3600;
  return h < 10 ? h.toFixed(1) : Math.round(h).toString();
}

/**
 * V19 C2 — Mini-sparkline для history-серии (14 дней).
 * Pure inline-SVG, ~12 LOC SVG. Не использует external charting library.
 *
 * @param {number[]} series — values, ASC-by-day
 * @param {object}   [opts] — { width=80, height=18, lastIsBad?: bool }
 */
function renderSparkline(series, opts = {}) {
  if (!Array.isArray(series) || series.length < 2) return '';
  const w = Number(opts.width)  || 80;
  const h = Number(opts.height) || 18;
  const max = Math.max(1, Math.max(...series));
  const min = Math.min(0, Math.min(...series));
  const range = max - min || 1;
  const stepX = w / (series.length - 1);
  const points = series.map((v, i) => {
    const x = Math.round(i * stepX);
    const y = Math.round(h - ((v - min) / range) * (h - 2) - 1);
    return `${x},${y}`;
  }).join(' ');
  // Цвет последней точки: lastIsBad → red если возрастает, иначе accent.
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const trendUp = last > prev;
  const dotCls = (opts.lastIsBad && trendUp) ? 'ts2-spark-dot-bad'
              : (opts.lastIsBad && !trendUp) ? 'ts2-spark-dot-good'
              : 'ts2-spark-dot';
  const lastX = Math.round((series.length - 1) * stepX);
  const lastY = Math.round(h - ((last - min) / range) * (h - 2) - 1);
  return `
    <svg class="ts2-sparkline-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <polyline class="ts2-sparkline-line" fill="none" points="${points}"/>
      <circle class="${dotCls}" cx="${lastX}" cy="${lastY}" r="2"/>
    </svg>
  `;
}

/** V18.1 P7-S4.2 — render trend-delta arrow для PO/руководителя.
 *  positiveIsBad=true → ↑ red (orphans, stop), ↑ green (moving, progress).
 *  Returns '' если нет prev или delta=0.
 */
function renderDelta(curr, prev, opts = {}) {
  if (typeof prev !== 'number') return '';
  const delta = curr - prev;
  if (delta === 0) return '';
  const positiveIsBad = !!opts.positiveIsBad;
  const arrow = delta > 0 ? '↑' : '↓';
  const cls = positiveIsBad
    ? (delta > 0 ? 'ts2-delta-bad'  : 'ts2-delta-good')
    : (delta > 0 ? 'ts2-delta-good' : 'ts2-delta-bad');
  return `<span class="ts2-delta ${cls}" title="вчера было ${prev}">${arrow}${Math.abs(delta)}</span>`;
}

/**
 * Bucket events by local hour-of-day (0..23). Each bucket = number of events
 * starting in that hour. Returns Int8Array(24).
 *
 * NB: в P1 используем server local time (как и весь Pulse). TZ-skew issue
 * подсветим в P3 — нужно решение по browser TZ vs server TZ.
 */
function bucketByHour(events) {
  const out = new Array(24).fill(0);
  for (const e of (events || [])) {
    const t = String(e?.at || '');
    if (!t) continue;
    // ISO «2026-05-01T14:23:45.123Z» → парсим Date, берём local hour.
    const d = new Date(t);
    if (isNaN(d.getTime())) continue;
    const h = d.getHours();
    if (h >= 0 && h < 24) out[h]++;
  }
  return out;
}

/** 24 cells × 14px высоты strip. Каждый bucket — 4×4 dot с opacity по плотности. */
function dotStrip(hourBuckets, ariaLabel) {
  const cells = hourBuckets.map((n, h) => {
    let opacity;
    if (n === 0)      opacity = 0.10;     // пустой час — почти прозрачный точечный
    else if (n === 1) opacity = 0.45;
    else if (n === 2) opacity = 0.70;
    else if (n === 3) opacity = 0.90;
    else              opacity = 1.0;       // 4+
    const cls = n >= 4 ? 'ts2-dot ts2-dot-busy' : 'ts2-dot';
    return `<span class="ts2-cell" title="${h.toString().padStart(2, '0')}:00 — ${n} ${plural(n, ['событие', 'события', 'событий'])}"><span class="${cls}" style="opacity:${opacity}"></span></span>`;
  }).join('');
  return `<span class="ts2-strip" role="img" aria-label="${esc(ariaLabel || '')}">${cells}</span>`;
}

/** Product-language вместо "0 событий" — снимаем обвиняющий тон (HR-роль).
 *  V18.1 P7-S1.3 — учитывает все 4 источника, не только Jira+CF.
 *  Это критично для тимлидов / senior'ов / архитекторов: их активность
 *  часто ВНЕ Jira changelog'а (PR-ревью, коммиты без транзишенов, CF-доки).
 *  До фикса: senior с 0 jira-events + 5 PR-reviews видел «Нет следа», что
 *  ложно и унизительно.
 */
function emptyDayLanguage(p, day) {
  // day = 'today' | 'yesterday' (пока не используется — P3 будет per-day language)
  const reviewSig = (p.badges?.reviews || 0) + (p.badges?.approves || 0);
  const commits   = p.badges?.commits48h || 0;
  const prs       = p.badges?.pr48h || 0;
  const cfN       = (p.cfItems || []).length;
  const bbN       = (p.bbItems || []).length;
  const zephyrN   = ((p.zephyrTestsCreatedRecent  || []).length
                  +  (p.zephyrTestsExecutedRecent || []).length);

  // Order matters — самый специфичный сигнал выигрывает.
  if (reviewSig > 0)               return 'Фокус на код-ревью';
  if (commits > 0 && prs === 0)    return 'Коммиты без транзишенов';
  if (prs > 0)                     return 'Работа с PR';
  if (zephyrN > 0)                 return 'Тестовые прогоны';
  if (cfN > 0)                     return 'Документация / комментарии';
  if (bbN > 0)                     return 'Активность в Bitbucket';
  return 'Нет следа в Jira / BB / CF';
}

/** P3 helper: единый «stuck-list» для участника — blockers (если P3
    enrichment запущен) ИЛИ stale (P1/P2 fallback). Это позволяет
    classifier'у работать одинаково для enriched и non-enriched model. */
// V20 S8 #15 — extracted to teamScanner2Classifier.js (single source of truth).
import { classifyPerson as _classifyPerson, stuckListOf as _stuckListOf, statusOfPerson as _statusOfPerson } from './teamScanner2Classifier.js';
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

/** V18.1 P7-S3.2 — HR-language: «Стоп» → «Требует разговора»
 *  (HR panel: «Стоп» = приговор; «Требует разговора» = операционный
 *  сигнал, не оценка человека). */
const GROUP_META = {
  stop:   { label: 'Требует разговора', desc: 'Висят без движения — нужен разговор сегодня' },
  watch:  { label: 'Под наблюдением',   desc: 'Триггеры: перегрузка, тишина или старое тянется' },
  moving: { label: 'Движется',          desc: 'Есть активность сегодня, без красных флагов' },
  idle:   { label: 'Без активности',     desc: 'Нет следов в Jira / BB / CF' },
};

/* ── Top bar ─────────────────────────────────────────── */

export function renderTopBar(model, ctx = {}) {
  const fetchedAt = model?.fetchedAt
    ? new Date(model.fetchedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const pkCount = (model?.projectKeys || []).length;
  // V18.1 P6 — graduated из preview, pill «v2 preview» убран. v1 живёт
  // как «legacy» сабтаб рядом, переключение через subtab-bar.
  // V18.1 P7-S2.1 — Sprint Goal gauge (правее заголовка). Сигнал #1 из
  // synthesis-плана: PO защищает у CTO «где квартальные цели».
  const sg = model?.scannerV2?.sprintGoal;
  const prevSprint = ctx.prev?.sprintGoal;
  // V20 S7 A4 — slope из history (если ≥3 точек). ctx.history уже прокидывается из orchestrator.
  const sprintSlope = ctx.sprintGoalSlope || null;
  const sprintGauge = sg && sg.aggregateTotal > 0 ? renderSprintGauge(sg, prevSprint, sprintSlope) : '';
  // V20 S1.5 — stale-banner: cache > 5min → подсветить fetchedAt + CTA.
  const staleBanner = ctx.isStale
    ? `<div class="ts2-stale-banner" role="status">
         <span class="ts2-stale-icon" aria-hidden="true">⏱</span>
         <span class="ts2-stale-text">Данные ${esc(_humanizeAge(ctx.cacheAgeMs))} назад</span>
         <button class="ts2-btn ts2-btn-ghost ts2-stale-refresh-btn" id="ts2-stale-refresh" type="button">обновить</button>
       </div>`
    : '';
  return `
    <div class="ts2-topbar">
      <div class="ts2-topbar-title">
        <span class="ts2-h1">Сканнер команд</span>
        ${sprintGauge}
      </div>
      <div class="ts2-topbar-meta">
        <span class="ts2-meta-item">${pkCount} ${plural(pkCount, ['проект', 'проекта', 'проектов'])}</span>
        <span class="ts2-meta-sep">·</span>
        <span class="ts2-meta-item ${ctx.isStale ? 'ts2-meta-stale' : ''}" title="${ctx.isStale ? 'Кэш устарел (> 5 мин)' : 'Свежие данные'}">обновлено ${esc(fetchedAt)}</span>
        <!-- V20 S8 #5 — Kebab overflow. Pилот feedback: «7 кнопок, использую 3».
             В прямой видимости: 📋 Диагностика, ↻ Обновить (всегда).
             В kebab: ❓ Как считается, ⚙ Настройка команд, 👥 По командам. -->
        <!-- V20 S8.5 #19 — badge с числом known-issues. Тимлид заходит в diag
             раз в 2 недели, может пропустить свежие проблемы (CF=0%, jobId expired).
             ctx.knownIssuesCount передаётся orchestrator'ом. -->
        <button class="ts2-btn ts2-btn-ghost ts2-diag-btn-with-badge" id="ts2-diag-btn" type="button" title="Диагностика: почему по BB / Conf / Jira нет данных + JSON-экспорт для разработчика" aria-label="Диагностика">📋 Диагностика${ctx.knownIssuesCount > 0 ? `<span class="ts2-diag-btn-badge" title="${ctx.knownIssuesCount} известных проблем требуют внимания">${ctx.knownIssuesCount}</span>` : ''}</button>
        <button class="ts2-btn ts2-btn-primary" id="ts2-refresh-btn" type="button" title="Перезагрузить данные с серверов">↻ Обновить</button>
        <div class="ts2-kebab-wrap">
          <button class="ts2-btn ts2-btn-ghost ts2-kebab-btn" id="ts2-kebab-btn" type="button"
                  title="Дополнительные действия" aria-label="Меню" aria-haspopup="menu" aria-expanded="false">⋯</button>
          <div class="ts2-kebab-menu" id="ts2-kebab-menu" role="menu" hidden>
            <button class="ts2-kebab-item" id="ts2-how-btn" type="button" role="menuitem">❓ Как считается</button>
            <button class="ts2-kebab-item" id="ts2-config-btn" type="button" role="menuitem">⚙ Настройка команд</button>
            ${pkCount >= 2 ? `<button class="ts2-kebab-item ${ctx.activeView === 'multi' ? 'ts2-kebab-item-active' : ''}" id="ts2-view-toggle" type="button" role="menuitem">👥 ${ctx.activeView === 'multi' ? 'Одна команда' : 'По командам'}</button>` : ''}
          </div>
        </div>
      </div>
      ${staleBanner}
    </div>
  `;
}

/** V20 S1.5 — humanize cache age для stale-banner: «3 мин», «12 мин», «1 ч». */
function _humanizeAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} сек`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} мин`;
  const hr = Math.round(min / 60);
  return `${hr} ч`;
}

const PACE_LABEL = {
  'ahead':    'опережает',
  'on-track': 'по плану',
  'behind':   'отстаёт',
  'no-data':  'нет дат',
};

/** V18.1 P7-S2.1 + S4.4 — Sprint Goal gauge: aggregate + per-pk pills.
 *  Anna PO pilot finding: «aggregate скрывает асимметрию, если Backend
 *  behind а Platform ahead — aggregatePace='behind' и я не понимаю кого
 *  тянуть. Per-pk breakdown в gauge'е нет — приходится открывать
 *  tooltip и копать sg.sprints[]».
 *
 *  S4.4 fix: если несколько спринтов → показываем per-pk пилюли рядом
 *  с aggregate. Если один — старое поведение (одиночный gauge).
 */
/**
 * V20 S8 #10 — Narrative builder для PO/CTO meeting. Возвращает 1-2 предложения
 * «say-this-string» которое PO может скопировать в Slack/слайды.
 */
function _buildSprintNarrative(sg, slope) {
  if (!sg || !sg.sprints?.length) return '';
  const pct = sg.aggregateProgress;
  const pace = sg.aggregatePace;
  const lines = [];
  // Pace claim.
  if (pace === 'behind')   lines.push(`Команда отстаёт от плана (${pct}% сделано).`);
  else if (pace === 'ahead')   lines.push(`Команда опережает план (${pct}%).`);
  else if (pace === 'on-track') lines.push(`Команда идёт по плану (${pct}%).`);
  else                          lines.push(`Прогресс ${pct}% (даты спринтов не настроены).`);
  // Asymmetry: most-behind sprint pulls down.
  if (sg.sprints.length > 1) {
    const sorted = [...sg.sprints].sort((a, b) => (a.progressPct || 0) - (b.progressPct || 0));
    const worst = sorted[0];
    const best  = sorted[sorted.length - 1];
    if (worst && best && (best.progressPct - worst.progressPct) >= 25) {
      lines.push(`${worst.pk} тянет вниз (${worst.progressPct}%), ${best.pk} впереди (${best.progressPct}%).`);
    }
  }
  // Slope.
  if (slope && slope.trend === 'up')   lines.push(`Тренд за ${slope.days} дней — ускорение (+${slope.slope}%/день).`);
  else if (slope && slope.trend === 'down') lines.push(`Тренд за ${slope.days} дней — замедление (${slope.slope}%/день).`);
  return lines.join(' ');
}

function renderSprintGauge(sg, prevSg, slope) {
  const pct = sg.aggregateProgress;
  const pace = sg.aggregatePace;
  const paceLabel = PACE_LABEL[pace] || '—';
  // V20 S8 #10 — narrative for PO. Передаётся в title gauge'а — hover открывает.
  const narrative = _buildSprintNarrative(sg, slope);
  const firstSprint = sg.sprints[0];
  const daysLeft    = firstSprint?.daysLeft;
  const daysSuffix  = (typeof daysLeft === 'number')
    ? ` · ${daysLeft} ${plural(daysLeft, ['день', 'дня', 'дней'])}`
    : '';
  // V18.1 P7-S4.2 — sprint progress delta vs previous snapshot.
  const dProgress = prevSg ? renderDelta(pct, prevSg.aggregateProgress) : '';
  // V20 S7 A4 — slope arrow если есть данные за ≥3 дня.
  // V20 S8 #8 — слово «стагнация» зарезервировано для flat. Падение → «падение».
  // V20 S8.5 #9 — единое слово «→ ровно» для flat (раньше было «стагнация» здесь
  // и «flat» в slopeMini — пилот заметил несогласованность).
  const slopeChip = (slope && slope.trend !== 'no-data')
    ? `<span class="ts2-sprint-slope ts2-sprint-slope-${slope.trend}" title="Тренд за ${slope.days} ${plural(slope.days, ['день', 'дня', 'дней'])} · R²=${slope.r2}">${
        slope.trend === 'up'   ? `↗ +${slope.slope}%/день` :
        slope.trend === 'down' ? `↘ ${slope.slope}%/день — падение` :
                                  '→ ровно'
      }</span>`
    : '';
  // V20 S7 A4 — sprint-mean (sprint-weighted) рядом с aggregate (issue-weighted).
  // Раскрывает асимметрию: spring-200/10% vs sprint-20/90% → mean=50% vs aggregate=18%.
  const meanChip = (sg.sprintMeanProgress != null && sg.sprintMeanProgress !== sg.aggregateProgress && sg.sprints.length > 1)
    ? `<span class="ts2-sprint-mean" title="Sprint-weighted mean (без issue-weighting) — раскрывает асимметрию между большими и малыми спринтами">~${sg.sprintMeanProgress}%</span>`
    : '';

  // Один sprint — без перегрузки UI, оставляем legacy single-gauge.
  if (sg.sprints.length <= 1) {
    const sprintName  = firstSprint?.name ? esc(firstSprint.name) : '';
    const tipShort = narrative
      ? `${narrative}\n— — —\n${sg.aggregateDone}/${sg.aggregateTotal} done · pace: ${paceLabel}${daysSuffix}`
      : `Sprint Goal: ${sg.aggregateDone}/${sg.aggregateTotal} done · pace: ${paceLabel}${daysSuffix}`;
    return `
      <div class="ts2-sprint-gauge ts2-sprint-pace-${pace}" title="${esc(tipShort)}">
        <span class="ts2-sprint-label">Спринт</span>
        <span class="ts2-sprint-name">${sprintName}</span>
        <span class="ts2-sprint-bar">
          <span class="ts2-sprint-bar-fill" style="width:${Math.min(100, pct)}%"></span>
        </span>
        <span class="ts2-sprint-pct">${pct}%</span>${dProgress}${slopeChip}
        <span class="ts2-sprint-pace">${paceLabel}${daysSuffix}</span>
      </div>
    `;
  }

  // Несколько спринтов — aggregate сверху + per-pk пилюли снизу.
  const pkPills = sg.sprints.map(s => {
    const sPace = s.pace || 'no-data';
    const sPaceLabel = PACE_LABEL[sPace] || '—';
    const sDays = (typeof s.daysLeft === 'number')
      ? ` · ${s.daysLeft}д`
      : '';
    return `
      <span class="ts2-sprint-pk-pill ts2-sprint-pace-${sPace}" title="${esc(s.pk)} «${esc(s.name || '')}» · ${s.done}/${s.total} done · ${sPaceLabel}${sDays}">
        <span class="ts2-sprint-pk-pill-key">${esc(s.pk)}</span>
        <span class="ts2-sprint-pk-pill-pct">${s.progressPct}%</span>
      </span>
    `;
  }).join('');

  return `
    <div class="ts2-sprint-gauge-multi">
      <div class="ts2-sprint-gauge ts2-sprint-pace-${pace}" title="${esc(narrative ? narrative + '\n— — —\n' + 'Aggregate: ' + sg.aggregateDone + '/' + sg.aggregateTotal + ' · ' + paceLabel : 'Aggregate Sprint Goal: ' + sg.aggregateDone + '/' + sg.aggregateTotal + ' done · pace: ' + paceLabel + daysSuffix)}">
        <span class="ts2-sprint-label">Спринты</span>
        <span class="ts2-sprint-name">${sg.sprints.length}×</span>
        <span class="ts2-sprint-bar">
          <span class="ts2-sprint-bar-fill" style="width:${Math.min(100, pct)}%"></span>
        </span>
        <span class="ts2-sprint-pct">${pct}%</span>${meanChip}${dProgress}${slopeChip}
        <span class="ts2-sprint-pace">${paceLabel}</span>
      </div>
      <div class="ts2-sprint-pk-pills">${pkPills}</div>
    </div>
  `;
}

/* ── Team glance — single-line summary ─────────────── */

export function renderTeamGlance(model, ctx = {}) {
  const parts = model?.participants || [];
  // V18.1 P2 — counts per classified group. Дают prevailing read'у тимлида
  // за 1 секунду: «куда смотреть в первую очередь?»
  const counts = { stop: 0, watch: 0, moving: 0, idle: 0 };
  let commits48h = 0, prs48h = 0, conf48h = 0;
  for (const p of parts) {
    counts[classifyPerson(p)]++;
    commits48h += p.badges?.commits48h || 0;
    prs48h     += p.badges?.pr48h      || 0;
    // V18.1 P6.2 — Confluence info теперь видна в team-glance.
    conf48h    += p.badges?.conf48h    || 0;
  }
  // V18.1 P7-S4.2 — trend-deltas из prev snapshot (если есть).
  const prev = ctx.prev || null;
  const dMoving = prev ? renderDelta(counts.moving, prev.counts?.moving) : '';
  const dWatch  = prev ? renderDelta(counts.watch,  prev.counts?.watch,  { positiveIsBad: true }) : '';
  const dStop   = prev ? renderDelta(counts.stop,   prev.counts?.stop,   { positiveIsBad: true }) : '';
  // V20 S7 A5 — anomaly badges (Z-score). Если today сильно отличается от
  // среднего за 14 дней (|z| > 2) — подсвечиваем counter с иконкой ⚠.
  const zStop   = ctx.anomalies?.stop;
  const zWatch  = ctx.anomalies?.watch;
  const zMoving = ctx.anomalies?.moving;
  const zIdle   = ctx.anomalies?.idle;
  // V20 S8 #1 — human-language anomaly. «×4 от нормы» вместо «z=+4.2».
  // Z-score сохраняем в title для гиков. Pилот: «не до статистики в 9:30».
  const anomalyBadge = (z) => {
    if (!z?.anomalous) return '';
    const ratio = z.mean > 0 ? (z.today / z.mean) : 0;
    let label;
    if (z.today === 0)               label = 'упало до 0';
    else if (ratio >= 1.5)           label = `×${ratio.toFixed(1)} от нормы`;
    else if (ratio > 0 && ratio < 0.7) label = `−${Math.round((1 - ratio) * 100)}% от нормы`;
    else                              label = `аномально ${z.z > 0 ? 'много' : 'мало'}`;
    // V20 S8.5 #7 + #20 — расширенный tooltip + clickable для mini-chart sparkline.
    return `<button type="button" class="ts2-glance-anomaly ts2-glance-anomaly-${z.z > 0 ? 'up' : 'down'}" data-anomaly-metric="${esc(label)}" title="Сегодня: ${z.today} · Среднее за 14 дней: ${z.mean} ± ${z.std} · Z-score: ${z.z}. Клик → мини-график.">⚠ ${esc(label)}</button>`;
  };

  // V18.3 A5a — group-counts кликабельны → scroll-jump к соответствующей
  // группе. Anna PO finding: «Я вижу «1 требует разговора», но чтобы
  // найти кого — скроллю. Anchor-jump к ts2-group-stop напрашивается».
  const jumpBtn = (groupKey, content) =>
    `<button type="button" class="ts2-glance-jump" data-jump-group="${groupKey}" title="Прыгнуть к группе">${content}</button>`;
  const segs = [];
  if (counts.moving > 0) segs.push(jumpBtn('moving', `<span class="ts2-glance-num">${counts.moving}</span>${dMoving}${anomalyBadge(zMoving)}<span class="ts2-glance-lab">движется</span>`));
  if (counts.watch  > 0) segs.push(jumpBtn('watch',  `<span class="ts2-glance-num ts2-glance-num-watch">${counts.watch}</span>${dWatch}${anomalyBadge(zWatch)}<span class="ts2-glance-lab">наблюдение</span>`));
  if (counts.stop   > 0) segs.push(jumpBtn('stop',   `<span class="ts2-glance-stuck">▌<span class="ts2-glance-num-stop">${counts.stop}</span>${dStop}${anomalyBadge(zStop)} ${plural(counts.stop, ['стоп', 'стоп', 'стоп'])}</span>`));
  if (counts.idle   > 0) segs.push(jumpBtn('idle',   `<span class="ts2-glance-num ts2-glance-num-muted">${counts.idle}</span>${anomalyBadge(zIdle)}<span class="ts2-glance-lab">без активности</span>`));
  const groupLine = segs.length ? segs.join(`<span class="ts2-glance-sep">·</span>`) : `<span class="ts2-glance-lab">Нет данных</span>`;
  // V18.1 P7-S2.1.5 — risk shelf: orphans + out-of-sprint.
  // Закрывает сигналы #6 + #7 из synthesis-плана для PO/SM.
  const risks = model?.scannerV2?.risks;
  const orphans  = risks?.totalOrphans     || 0;
  const oos      = risks?.totalOutOfSprint || 0;
  const oosRatio = risks?.outOfSprintRatio || 0;
  // V18.1 P7-S4.2 — risk-deltas: orphans/oos increasing = bad.
  const dOrphans = prev ? renderDelta(orphans, prev.risks?.totalOrphans, { positiveIsBad: true }) : '';
  const dOos     = prev ? renderDelta(oos,     prev.risks?.totalOutOfSprint, { positiveIsBad: true }) : '';
  const riskBlocks = [];
  if (orphans > 0) {
    riskBlocks.push(`<span class="ts2-glance-risk"><span class="ts2-glance-num-stop">${orphans}</span>${dOrphans} ${plural(orphans, ['без assignee', 'без assignee', 'без assignee'])}</span>`);
  }
  if (oos > 0) {
    const pct = Math.round(oosRatio * 100);
    riskBlocks.push(`<span class="ts2-glance-risk"><span class="ts2-glance-num-watch">${oos}</span>${dOos} out-of-sprint ${pct > 0 ? `(${pct}%)` : ''}</span>`);
  }
  const riskLine = riskBlocks.length ? riskBlocks.join(`<span class="ts2-glance-sep">·</span>`) : '';

  // V18.3 A5b — filter-badge показывает что view filtered по pk + дает
  // кнопку clear filter.
  const pkFilter = ctx.pkFilter || '';
  const filterBadge = pkFilter
    ? `<div class="ts2-pk-filter-badge">
         <span class="ts2-pk-filter-label">Фильтр:</span>
         <span class="ts2-pk-filter-pk">${esc(pkFilter)}</span>
         <button class="ts2-pk-filter-clear" id="ts2-pk-filter-clear" type="button" title="Сбросить фильтр">✕</button>
       </div>`
    : '';
  // V19 C2 — history sparklines (PO ask «какие новости?»).
  // Показываем только если у нас ≥ 2 daily snapshots; иначе скрыто.
  const history = Array.isArray(ctx.history) ? ctx.history : [];
  const trendRow = history.length >= 2 ? renderHistoryTrendRow(history) : '';
  // V20 S7 A1 — CRV aggregate. Median по всем reviewers — даёт «общую скорость
  // ревью команды». Если нет данных (CRV пустой) — не отображаем.
  const crv = model?.scannerV2?.codeReviewVelocity || {};
  const crvKeys = Object.keys(crv);
  const crvMedians = crvKeys.map(k => crv[k].medianHours).filter(Number.isFinite);
  crvMedians.sort((a, b) => a - b);
  const crvMedian = crvMedians.length ? crvMedians[Math.floor(crvMedians.length / 2)] : null;
  // V20 S8 #4 — compact-полоска: «команда: ↗ · CR 6ч · 80% PR»
  // Pилот feedback: «три элемента конкурируют за внимание». Объединяем.
  // CR-badge кликабельный (S8 #2) → drill-down в slow-reviewers.
  const crvBadge = crvMedian != null
    ? `<button type="button" class="ts2-glance-crv ts2-glance-crv-${crvMedian > 24 ? 'slow' : crvMedian > 8 ? 'warn' : 'ok'}" id="ts2-glance-crv-drilldown" title="Медиана времени до первого ревью. Клик — список самых долгих ревью.">CR ${crvMedian}ч</button>`
    : '';
  // V20 S7 A1 — PR throughput aggregate. Подсчитываем sum opened/merged за 7 дней.
  const prT = model?.scannerV2?.prThroughput || {};
  let prOpened = 0, prMerged = 0, prOverloadCount = 0;
  for (const k of Object.keys(prT)) {
    prOpened += prT[k].opened || 0;
    prMerged += prT[k].merged || 0;
    if (prT[k].flag === 'overload') prOverloadCount++;
  }
  const prRate = prOpened > 0 ? Math.round(prMerged / prOpened * 100) : 0;
  const prBadge = prOpened > 0
    ? `<span class="ts2-glance-pr-throughput" title="${prMerged} merged из ${prOpened} opened за 7 дней (${prRate}%). ${prOverloadCount > 0 ? prOverloadCount + ' человек(а) перегружены (>5 PR, mergeRate <0.4)' : 'Все merge-rate в норме'}">${prMerged}/${prOpened} PR · ${prRate}%${prOverloadCount ? ` · ⚠ ${prOverloadCount}` : ''}</span>`
    : '';
  // V20 S8 #4 — slope из ctx (передаётся orchestrator'ом из history).
  const slope = ctx.sprintGoalSlope;
  const slopeMini = (slope && slope.trend !== 'no-data')
    ? `<span class="ts2-glance-slope ts2-glance-slope-${slope.trend}" title="Sprint goal тренд за ${slope.days} дней · R²=${slope.r2}. Клик «Как считается» → секция «Тренды».">${
        slope.trend === 'up'   ? `↗ +${slope.slope}%/день` :
        slope.trend === 'down' ? `↘ ${slope.slope}%/день` :
                                 '→ ровно'
      }</span>`
    : '';

  return `
    <div class="ts2-glance">
      ${filterBadge}
      <div class="ts2-glance-line">
        ${groupLine}
        <span class="ts2-glance-sep">·</span>
        <span class="ts2-glance-num">${commits48h}</span>
        <span class="ts2-glance-lab">${plural(commits48h, ['коммит', 'коммита', 'коммитов'])} (48ч)</span>
        <span class="ts2-glance-sep">·</span>
        <span class="ts2-glance-num">${prs48h}</span>
        <span class="ts2-glance-lab">PR (48ч)</span>
        <span class="ts2-glance-sep">·</span>
        <span class="ts2-glance-num">${conf48h}</span>
        <span class="ts2-glance-lab">${plural(conf48h, ['CF-правка', 'CF-правки', 'CF-правок'])} (48ч)</span>
      </div>
      ${riskLine ? `<div class="ts2-glance-line ts2-glance-risk-row">${riskLine}</div>` : ''}
      ${(crvBadge || prBadge || slopeMini) ? `<div class="ts2-glance-line ts2-glance-velocity-row">
        <span class="ts2-glance-velocity-label">Команда:</span>
        ${slopeMini}
        ${slopeMini && crvBadge ? '<span class="ts2-glance-sep">·</span>' : ''}
        ${crvBadge}
        ${crvBadge && prBadge ? '<span class="ts2-glance-sep">·</span>' : ''}
        ${prBadge}
      </div>` : ''}
      ${trendRow}
    </div>
  `;
}

/**
 * V19 C2 — История 14 дней: 3 sparkline'а в одном ряду.
 * Без зависимостей: pure inline-SVG, ~14×3=42 polyline points max.
 */
function renderHistoryTrendRow(history) {
  // Series ASC-by-day. 3 metrics: stop count, OOS count, sprint progress.
  const stopSeries     = history.map(h => h?.counts?.stop || 0);
  const oosSeries      = history.map(h => h?.risks?.totalOutOfSprint || 0);
  const progressSeries = history.map(h => h?.sprintGoal?.aggregateProgress || 0);
  const days = history.length;
  return `
    <div class="ts2-glance-line ts2-glance-trend-row">
      <span class="ts2-glance-trend-label">${days} ${plural(days, ['день', 'дня', 'дней'])}:</span>
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
            <button class="modal-close-btn" data-close-modal>✕</button>
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
          <button class="modal-close-btn" data-close-modal>✕</button>
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
        <span class="ts2-team-wip" title="Total WIP в команде">${t.wipTotal} WIP</span>
        ${sprintCell}
        <span class="ts2-team-risks">${risks || '—'}</span>
      </div>
    `;
  }).join('');
  return `
    <div class="ts2-multi-team">
      <div class="ts2-multi-team-head">
        <span>Команда</span>
        <span>Контекст</span>
        <span>Группы</span>
        <span>WIP</span>
        <span>Спринт</span>
        <span>Риски</span>
      </div>
      <div class="ts2-multi-team-rows">${rows}</div>
    </div>
  `;
}

/* ── Per-person rows ──────────────────────────────────── */

export function renderPersonRows(model, ctx = {}) {
  const parts = model?.participants || [];
  if (!parts.length) {
    return `<div class="ts2-empty">Нет данных по участникам за выбранные проекты.</div>`;
  }
  // V18.1 P2 — group by classifyPerson. Внутри группы сортируем по
  // timelineToday desc, потом yesterday desc.
  const groups = { stop: [], watch: [], moving: [], idle: [] };
  for (const p of parts) groups[classifyPerson(p)].push(p);
  const sortFn = (a, b) => {
    const aT = (a.timelineToday    || []).length;
    const bT = (b.timelineToday    || []).length;
    if (aT !== bT) return bT - aT;
    return (b.timelineYesterday || []).length - (a.timelineYesterday || []).length;
  };
  groups.stop.sort(sortFn);
  groups.watch.sort(sortFn);
  groups.moving.sort(sortFn);
  groups.idle.sort(sortFn);
  // V20 S8 #3 — Triage-pill для большой stop-группы. Пилот feedback:
  // «79 строк без приоритизации = тимлид теряется». Сортируем stop по
  // максимальному dwellHours (чем дольше висит — тем выше). Топ-3
  // отображаются как pill-row перед списком.
  const stopTriage = groups.stop
    .filter(p => (p.blockers || []).some(b => Number(b.dwellHours) > 0))
    .map(p => ({
      p,
      maxDwell: Math.max(0, ...(p.blockers || []).map(b => Number(b.dwellHours) || 0)),
    }))
    .sort((a, b) => b.maxDwell - a.maxDwell)
    .slice(0, 3);

  const expandedKey = ctx.expandedKey || '';
  // V20 S7 A2 — pass v2 metrics-maps (для chip'ов в row).
  const metricsMaps = {
    crv: model?.scannerV2?.codeReviewVelocity || {},
    prT: model?.scannerV2?.prThroughput || {},
  };
  // V20 S8 #3 + S8.5 #6 — триаж-pill теперь срабатывает по count ≥ 5 OR maxDwell ≥ 48ч.
  // Pилот feedback: «4 stop с одним 96ч — pill спрячется, пропущу самый болезненный кейс».
  const maxAnyDwell = Math.max(0, ...stopTriage.map(t => t.maxDwell));
  const showTriage = stopTriage.length > 0 && (groups.stop.length >= 5 || maxAnyDwell >= 48);
  const triagePillHtml = showTriage ? `
    <div class="ts2-triage-pill" role="region" aria-label="Топ блокеров в Стопе">
      <span class="ts2-triage-pill-label">⚠ Топ ${stopTriage.length} в Стопе сегодня:</span>
      <span class="ts2-triage-pill-items">
        ${stopTriage.map(({ p, maxDwell }) => `
          <span class="ts2-triage-pill-group">
            <button type="button" class="ts2-triage-pill-item" data-jump-key="${esc(p.key)}" title="Перейти к карточке · максимальный dwell ${maxDwell}ч">
              ${esc(p.label || p.key)}
              <span class="ts2-triage-pill-dwell">▌${maxDwell}ч</span>
            </button>
            <!-- V20 S8.5 #18 — inline 1:1 button прямо в pill, без захода в карточку.
                 Pилот: «утром у меня 30 секунд — копирую talking-points за 1 клик». -->
            <button type="button" class="ts2-triage-pill-1on1" data-1on1-key="${esc(p.key)}" title="Скопировать talking-points для разговора 1:1 в TG/Slack" aria-label="Обсудить 1:1">💬</button>
          </span>
        `).join('')}
      </span>
    </div>` : '';
  const renderGroup = (key) => {
    const arr = groups[key];
    if (!arr.length) return '';
    const meta = GROUP_META[key];
    const rows = arr.map(p => renderRow(p, expandedKey === p.key, metricsMaps)).join('');
    const head = `
      <div class="ts2-group-head">
        <span class="ts2-group-label">${esc(meta.label)}</span>
        <span class="ts2-group-count" title="${esc(meta.desc)}">${arr.length}</span>
      </div>`;
    if (key === 'idle') {
      // Сворачиваемая, по умолчанию закрыта — снимает шум с главного экрана.
      return `
        <details class="ts2-group ts2-group-${key}" data-group-anchor="${key}">
          <summary class="ts2-group-summary">${head}</summary>
          <div class="ts2-rows-inner">${rows}</div>
        </details>`;
    }
    return `
      <div class="ts2-group ts2-group-${key}" data-group-anchor="${key}">
        ${head}
        <div class="ts2-rows-inner">${rows}</div>
      </div>`;
  };

  // Порядок групп = приоритет внимания тимлида утром.
  return `
    <div class="ts2-rows">
      ${triagePillHtml}
      ${renderGroup('stop')}
      ${renderGroup('watch')}
      ${renderGroup('moving')}
      ${renderGroup('idle')}
    </div>
  `;
}

function renderRow(p, isExpanded, metricsMaps = {}) {
  const hToday = bucketByHour(p.timelineToday);
  const hYest  = bucketByHour(p.timelineYesterday);
  const todayN = (p.timelineToday    || []).length;
  const yestN  = (p.timelineYesterday || []).length;
  // V18.1 P7-S3.2 — убираем red ▌ stripe слева от имени (HR panel:
  // «дублирует функцию dwellBadge ▌Nh справа, один из двух уберите»).
  // Оставляем spacer для grid-выравнивания. Stop-сигнал идёт через
  // принадлежность к группе «Требует разговора» с red stripe-left
  // на уровне группы — это уже сильный визуальный маркер.
  const blockerMark = `<span class="ts2-blocker-spacer"></span>`;

  const todayBlock = todayN > 0
    ? dotStrip(hToday, `Сегодня: ${todayN} событий`)
    : `<span class="ts2-strip-empty">${esc(emptyDayLanguage(p, 'today'))}</span>`;

  const yestBlock = yestN > 0
    ? dotStrip(hYest,  `Вчера: ${yestN} событий`)
    : `<span class="ts2-strip-empty ts2-strip-empty-y">—</span>`;

  const prsCount    = (p.badges?.pr48h || 0);
  // V18.1 P3 — distinct issue keys из enrichment вместо ручного Set'а.
  // Fallback на P1-логику если enrichment не запущен (defensive).
  const tasksTouchN = (p.contextSwitches?.distinctIssueKeys ?? new Set([
    ...(p.timelineToday || []),
    ...(p.timelineYesterday || []),
  ].map(e => e?.issue?.key).filter(Boolean)).size);
  const hoursToday  = fmtHours(p.loggedTodaySec || 0);
  // V18.1 P7-S4.3 — WIP counter (issuesNow). Manager + Anna + Dmitry
  // pilot finding: «Команды равномерно загружены? — не закрыто. WIP-counter
  // в classifier работает (≥3 → watch), но числом не показан».
  // ≥3 → подсвечиваем amber (overcommit signal).
  const wipN  = (p.issuesNow || []).length;
  const wipCls = wipN >= 4 ? 'ts2-counter ts2-counter-warn' : (wipN >= 3 ? 'ts2-counter ts2-counter-amber' : 'ts2-counter');
  // V18.1 P7-S4.5 — B/C/Z source-indicators в row (inline после имени).
  // Pilot finding (Vasiliy + Elena consensus): «multi-source signal должен
  // быть в строке, а не только в side-panel — heatmap 72×4 хорош, но это
  // «уровень 3», а решение принимается на «уровне 2»».
  // Counts из p.bbItems / cfItems / zephyr — все за 72ч окно.
  const bbN = (p.bbItems || []).length;
  const cfN = (p.cfItems || []).length;
  const zN  = ((p.zephyrTestsCreatedRecent || []).length
            + (p.zephyrTestsExecutedRecent || []).length);
  const srcChip = (label, n, cls) => n > 0
    ? `<span class="ts2-row-src-chip ts2-row-src-${cls}" title="${label} активность за 72ч: ${n} событий"><span class="ts2-row-src-chip-key">${cls.toUpperCase()}</span><span class="ts2-row-src-chip-num">${n}</span></span>`
    : '';
  const srcChips = (bbN || cfN || zN)
    ? `<span class="ts2-row-src-chips">${srcChip('Bitbucket', bbN, 'b')}${srcChip('Confluence', cfN, 'c')}${srcChip('Zephyr', zN, 'z')}</span>`
    : '';

  // P3 signals: switch-score → ↻N badge if non-trivial; max blocker dwell → ▌Nh
  const switches = p.contextSwitches?.switchEvents?.length || 0;
  const maxDwell = (p.blockers && p.blockers[0]?.dwellHours) || 0;
  // V18.1 P7-S4.6 — switch-index ↻N теперь опционален через
  // localStorage-флаг q2_scanner_hide_productivity. Pilot finding (Dmitry):
  // «↻N switch-badge выглядит как watchdog, тимлиды учуют». ▌Nh dwell-badge
  // НЕ скрывается — это операционный blocker-сигнал, не productivity-tracking.
  const hideProductivity = (() => {
    try { return localStorage.getItem('q2_scanner_hide_productivity') === '1'; } catch (_) { return false; }
  })();
  const switchBadge = (!hideProductivity && switches >= 3)
    ? `<span class="ts2-badge ts2-badge-switch" title="Переключений между задачами за 72ч (gap < 30 мин). Скрыть: localStorage.q2_scanner_hide_productivity = '1'">↻${switches}</span>`
    : '';
  const dwellBadge = maxDwell >= 24
    ? `<span class="ts2-badge ts2-badge-dwell" title="Максимальный dwell-time блокера (часов в текущем статусе)">▌${maxDwell}ч</span>`
    : '';
  // V20 S7 A2 — CRV + PR throughput chips per-row.
  const myCrv = metricsMaps.crv?.[p.key];
  const crvChip = myCrv && myCrv.count >= 2
    ? `<span class="ts2-badge ts2-badge-crv ts2-badge-crv-${myCrv.threshold}" title="Median time-to-first-review для этого ревьюера за 14 дней (N=${myCrv.count})">CR ${myCrv.medianHours}ч</span>`
    : '';
  const myPrT = metricsMaps.prT?.[p.key];
  const prChip = myPrT && myPrT.opened > 0
    ? `<span class="ts2-badge ts2-badge-prT ts2-badge-prT-${myPrT.flag}" title="${myPrT.merged} merged из ${myPrT.opened} opened за 7 дней (${Math.round(myPrT.mergeRate*100)}%) · flag: ${myPrT.flag}">${myPrT.opened}↗ ${Math.round(myPrT.mergeRate*100)}%</span>`
    : '';
  const badges = (switchBadge || dwellBadge || crvChip || prChip)
    ? `<span class="ts2-row-badges">${dwellBadge}${switchBadge}${crvChip}${prChip}</span>`
    : `<span class="ts2-row-badges-spacer"></span>`;

  // V18.1 P7-S3.1 — aria-controls связывает row с panel id (=ts2-panel-main),
  // SR анонсирует «связан с panel'ью «Детализация по сотруднику»».
  return `
    <div class="ts2-row ${isExpanded ? 'ts2-row-expanded' : ''}" data-key="${esc(p.key)}" tabindex="0" role="button" aria-expanded="${isExpanded}" aria-controls="ts2-panel-main">
      ${blockerMark}
      <span class="ts2-name-block">
        <span class="ts2-name" title="${esc(p.label)}">${esc(p.label || '—')}</span>
        ${srcChips}
      </span>
      <span class="ts2-strip-wrap ts2-strip-wrap-today">${todayBlock}</span>
      <span class="ts2-strip-wrap ts2-strip-wrap-yest">${yestBlock}</span>
      ${badges}
      <span class="ts2-counters">
        <span class="${wipCls}" title="Активные задачи (WIP). Норма ≤2, перегрузка ≥3."><span class="ts2-counter-num">${wipN}</span><span class="ts2-counter-lab">WIP</span></span>
        <span class="ts2-counter" title="PR за 48ч"><span class="ts2-counter-num">${prsCount}</span><span class="ts2-counter-lab">PR</span></span>
        <span class="ts2-counter" title="Задач затронуто за 72ч"><span class="ts2-counter-num">${tasksTouchN}</span><span class="ts2-counter-lab">задач</span></span>
        <span class="ts2-counter" title="Залогировано сегодня (часов)"><span class="ts2-counter-num">${hoursToday}</span><span class="ts2-counter-lab">ч</span></span>
      </span>
      <span class="ts2-chev">${isExpanded ? '▾' : '›'}</span>
    </div>
  `;
}

/* ── Detail panel (V18.1 P5) — slide-in 480px справа ────── */

// V18.3 A2 — Zephyr split на Created (Zc) и Executed (Ze).
// Pilot finding (Ilia QA): семантически разные — план vs прогон.
const SRC_LABELS = ['J',    'B',         'C',          'Zc',             'Ze'];
const SRC_NAMES  = ['Jira', 'Bitbucket', 'Confluence', 'Zephyr-планы',   'Zephyr-прогоны'];
const SRC_KEYS   = ['j',    'b',         'c',          'zc',             'ze'];

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
      <div class="ts2-panel ts2-panel-empty">
        <button class="ts2-btn ts2-btn-ghost ts2-panel-close" id="ts2-detail-close" type="button" aria-label="Закрыть">✕</button>
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
    <div class="ts2-panel" id="ts2-panel-main" role="dialog" aria-modal="true"
         aria-labelledby="ts2-panel-title" tabindex="-1">
      ${renderPanelHeader(p, tToday, tYest, tPrev, ctxMetrics)}
      ${renderCounters(p)}
      ${renderHeatmap72x4(heat72, filters)}
      ${renderFilters(filters, heat72.rowTotals)}
      ${renderBlockersShelf(blockers)}
      ${renderEventsFeed(filteredTl)}
      ${renderSwitchesNote(cs)}
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
  const emailFull = p.email || '';
  const emailMasked = maskEmail(emailFull);
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
              title="Скопировать контекст для разговора 1:1 в TG/Slack">💬 Обсудить 1:1</button>`
    : '';
  const metricRow = (crvChip || prtChip || ctChip || overloadAction)
    ? `<div class="ts2-panel-metrics-row">${crvChip}${prtChip}${ctChip}${overloadAction}</div>`
    : '';
  return `
    <div class="ts2-panel-head">
      <div class="ts2-panel-titleblock">
        <div class="ts2-panel-name" id="ts2-panel-title">${esc(p.label || '—')}</div>
        <div class="ts2-panel-sub">
          <span class="ts2-panel-meta">сегодня ${tToday}</span>
          <span class="ts2-panel-meta">вчера ${tYest}</span>
          <span class="ts2-panel-meta">позавчера ${tPrev}</span>
          ${emailFull ? `
            <button class="ts2-panel-email" data-email-toggle type="button"
                    aria-label="Email сотрудника, нажать чтобы показать целиком"
                    title="Click — показать целиком"
                    data-email-full="${esc(emailFull)}"
                    data-email-masked="${esc(emailMasked)}">${esc(emailMasked)}</button>` : ''}
        </div>
        ${metricRow}
      </div>
      <div class="ts2-panel-head-actions">
        <!-- V20 S8 #7 — Copy-for-TG: 5-7 строк plain-text + permalink.
             Async-тимлид feedback: «копирую вручную в Telegram». -->
        <!-- V20 S8.5 #8 — расширенный hint что попадёт в clipboard. -->
        <button class="ts2-btn ts2-btn-ghost ts2-panel-tgcopy" id="ts2-detail-tgcopy" type="button"
                title="Копирует 5-7 строк plain-text для чата:&#10;• имя сотрудника&#10;• счётчики событий (сегодня/вчера/WIP)&#10;• топ-3 блокера с dwell-time&#10;• активность 48ч (commits / PR / CF)&#10;• ссылка на эту карточку"
                aria-label="Копировать для Telegram">📋 TG</button>
        <button class="ts2-btn ts2-btn-ghost ts2-panel-share" id="ts2-detail-share" type="button"
                title="Скопировать ссылку на этот вид (для async-команды можно отправить в TG/Slack)"
                aria-label="Скопировать ссылку на детализацию">🔗</button>
        <button class="ts2-btn ts2-btn-ghost ts2-panel-close" id="ts2-detail-close" type="button" aria-label="Закрыть">✕</button>
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
  return `
    <div class="ts2-panel-counters">
      ${counterCell(com48, 'коммитов', '48ч')}
      ${counterCell(prs48, 'PR',       '48ч')}
      ${counterCell(tasks, 'задач',    '72ч')}
      ${counterCell(hours.toFixed(1), 'часов', '72ч')}
    </div>
  `;
}
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
    const cells = row.map((n, hourIdx) => {
      // V18.1 P7-S3.3 — density scale rebalanced: 0.06→0.45 был рваный
      // (4× прыжок). Новый: 0.10/0.35/0.60/0.85/1.0 + outline для
      // saturation (>=4 events). Saturation outline решает проблему
      // «при 200 events/час неотличимо от 4-х» (QA finding).
      let op, isHigh = false;
      if (n === 0)      op = 0.10;
      else if (n === 1) op = 0.35;
      else if (n === 2) op = 0.60;
      else if (n === 3) op = 0.85;
      else            { op = 1.0; isHigh = true; }
      const isPeak = h.peakCell && h.peakCell.srcIdx === srcIdx && h.peakCell.hourIndex === hourIdx;
      const classes = ['ts2-hcell'];
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
    const dwellLabel = (threshold && threshold !== 24)
      ? `${b.dwellHours}ч <span class="ts2-blockers-threshold">(порог ${threshold}ч)</span>`
      : `${b.dwellHours}ч`;
    return `
    <li class="ts2-blockers-li">
      <span class="ts2-blockers-stripe"></span>
      <span class="ts2-blockers-key">${jiraIssueLink(b.key)}</span>
      <span class="ts2-blockers-status">${esc(b.status)}</span>
      <span class="ts2-blockers-dwell">${dwellLabel}</span>
      <span class="ts2-blockers-summary">${esc((b.summary || '').slice(0, 80))}</span>
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
        <div class="ts2-panel-section-title">События <span class="ts2-panel-section-hint">72ч</span></div>
        <div class="ts2-empty-text">Нет событий за 72ч (или все источники в фильтре выключены).</div>
      </div>
    `;
  }
  const items = timeline72h.slice(0, 40).map(renderEventLine).join('');
  return `
    <div class="ts2-panel-section ts2-panel-section-tight">
      <div class="ts2-panel-section-title">События <span class="ts2-panel-section-hint">72ч · top 40 · все источники</span></div>
      <ul class="ts2-recent ts2-recent-feed">${items}</ul>
    </div>
  `;
}

/** Render one event row — different per src. V18.1 P6.2. */
function renderEventLine(e) {
  const at = e?.at ? new Date(e.at).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
  const src = e?.src || 'jira';
  const srcBadge = renderSrcBadge(src, e?.kind);
  let body = '';
  // V18.1 P7-S1.4 — все references на issue/PR/page кликабельны через
  // настоящие <a href>. Без этого инструмент только смотрит, не работает.
  if (src === 'jira') {
    const issueKey = e?.issue?.key ? jiraIssueLink(e.issue.key) : '';
    const text = esc(e.text || e.kind || '');
    body = `${issueKey} <span class="ts2-recent-text">${text}</span>`;
  } else if (src === 'bb') {
    // bbItem: { kind: 'pr'|'commit'|'review', title, url, repo, status? }
    const kind = e.kind || '';
    const repo = e.repo ? `<span class="ts2-recent-meta">${esc(e.repo)}</span>` : '';
    const status = e.status ? ` · ${esc(e.status)}` : '';
    const titleText = (e.title || '').slice(0, 80);
    const titleHtml = e.url
      ? `<a class="ts2-issue-link" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(titleText)}</a>`
      : esc(titleText);
    body = `<span class="ts2-recent-kind">${esc(kindLabel('bb', kind))}</span> ${repo} <span class="ts2-recent-text">${titleHtml}${status}</span>`;
  } else if (src === 'cf') {
    // cfItem: { kind: 'edit'|'create'|'comment', title, spaceName, spaceKey, url }
    const kind = e.kind || 'edit';
    const space = e.spaceName || e.spaceKey ? `<span class="ts2-recent-meta">${esc(e.spaceName || e.spaceKey)}</span>` : '';
    const titleText = (e.title || '').slice(0, 80);
    const titleHtml = e.url
      ? `<a class="ts2-issue-link" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(titleText)}</a>`
      : esc(titleText);
    body = `<span class="ts2-recent-kind">${esc(kindLabel('cf', kind))}</span> ${space} <span class="ts2-recent-text">${titleHtml}</span>`;
  } else if (src === 'zephyr') {
    // V18.3 A2 — kind ∈ {test, testSet} → Zc badge; иначе Ze.
    const kind = e.kind || 'testExec';
    const result = e.result ? ` · ${esc(e.result)}` : '';
    const slimKey = e?.slim?.key;
    const titleText = (e?.slim?.summary || e.title || '').slice(0, 80);
    const titleHtml = slimKey
      ? `${jiraIssueLink(slimKey)} <span class="ts2-recent-text">${esc(titleText)}${result}</span>`
      : `<span class="ts2-recent-text">${esc(titleText)}${result}</span>`;
    body = `<span class="ts2-recent-kind">${esc(kindLabel('zephyr', kind))}</span> ${titleHtml}`;
  } else {
    body = esc(e.text || '');
  }
  return `<li class="ts2-recent-li">${srcBadge}<span class="ts2-recent-at">${esc(at)}</span> ${body}</li>`;
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
      <div class="ts2-skel-line ts2-skel-line-lg"></div>
      <div class="ts2-skel-line"></div>
      <div class="ts2-skel-line"></div>
      <div class="ts2-skel-line"></div>
      <div class="ts2-skel-line"></div>
      <div class="ts2-skel-status">
        <span id="ts2-skel-text">${msg}</span>
        <button class="ts2-btn ts2-btn-ghost" id="ts2-skel-cancel" type="button">отмена</button>
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
        <div class="ts2-empty-icon" aria-hidden="true">📡</div>
        <div class="ts2-empty-title">Сканнер готов к работе</div>
        <div class="ts2-empty-text">
          Данные не загружены. Нажмите кнопку чтобы запросить активность
          из Jira / Bitbucket / Confluence — по умолчанию за последние 72ч.
        </div>
        <div class="ts2-empty-actions">
          <button class="ts2-btn ts2-btn-primary ts2-btn-lg" type="button"
                  id="ts2-load-initial">
            ↻ Загрузить данные команды
          </button>
        </div>
        <div class="ts2-empty-hint">
          Окно активности (24 / 72 / 168 ч) и пороги dwell-time можно
          настроить в шестерёнке ⚙ после первой загрузки.
        </div>
        <!-- V20 — secondary actions доступны ДО первой загрузки.
             Особенно «Диагностика» — нужна КОГДА данные не приходят. -->
        <div class="ts2-empty-secondary">
          <button class="ts2-btn ts2-btn-ghost ts2-btn-sm" type="button" id="ts2-empty-how-btn">❓ Как считается</button>
          <button class="ts2-btn ts2-btn-ghost ts2-btn-sm" type="button" id="ts2-empty-diag-btn">📋 Диагностика</button>
        </div>
      </div>
    `;
  }
  // V18.1 P7-S3.3 — CTA button «Открыть настройки» (designer finding:
  // «empty state без CTA = anti-pattern, пользователь сам должен идти
  // в шапку → settings»). Кнопка имеет data-action для глобального
  // settings-modal handler'а.
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

const HOW_SECTIONS = [
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
      Пороги переопределяются per-team в шестерёнке ⚙ (preset «research» — расслабленные пороги,
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
];

/* ════════════════════════════════════════════════════════════
   ─── V20 S8.5 #23: SPLIT BOUNDARY ──────────────────────────
   Всё ниже до конца файла — diagnostic-view функции.
   В будущей итерации (S9) — extract в отдельный файл
   `teamScanner2DiagnosticView.js`. Сейчас логически отделено
   markers, чтобы IDE/grep могли найти границу.

   Files of this section:
     - renderDiagnosticModal + 9 _diagSection* helpers
     - renderDiagnosticDisclaimer
     - renderProbeResults
     - renderSensitivityResults
     - renderIdentityResolvePreview
     - renderHowCalculatedModal
     - renderCrvDrilldownModal      (V20 S8 #2)
     - renderAnomalyMiniChart       (V20 S8.5 #20)
     ~ 1000 строк, можно вырезать целиком в новый файл.
   ════════════════════════════════════════════════════════════ */

/* ── V20 S2.3 — Diagnostic modal ──────────────────────────────
   User finding: «нет артефактов из BB / Conf — почему?»
   Решение — accordion-modal с 5+ секциями + 2-button JSON export
   (B3 consent flow: безопасный по умолчанию, полный с disclaimer'ом).
   ──────────────────────────────────────────────────────── */

export function renderDiagnosticModal(state, opts = {}) {
  const sections = [
    _diagSectionHeader(state.header, state.tzSkew),
    _diagSectionKnownIssues(state),                    // V20 S8 #12 — pilot quick-help
    _diagSectionConfig(state.config),
    _diagSectionConnection(state.connection),
    _diagSectionSources(state.sources),
    _diagSectionIdentity(state.identity),
    _diagSectionThresholds(state.thresholds),
    _diagSectionSnapshot(state.snapshot),
    _diagSectionModelSummary(state.modelSummary),
    _diagSectionBots(state.botsFilteredOut || []),     // V20 S7 B10
  ].join('');

  const auditCount = (opts.auditEntries || []).length;
  const auditHint = auditCount
    ? `За последний период было ${auditCount} ${plural(auditCount, ['экспорт', 'экспорта', 'экспортов'])}. Все логированы.`
    : 'Журнал экспортов пуст.';

  return `
    <div class="ts2-diag-modal-overlay" id="ts2-diag-modal" role="presentation">
      <div class="ts2-diag-modal" role="dialog" aria-modal="true" aria-labelledby="ts2-diag-title">
        <div class="ts2-diag-header">
          <h3 class="ts2-diag-title" id="ts2-diag-title">📋 Диагностика Сканнера команд</h3>
          <button class="ts2-diag-close" type="button" data-close-modal aria-label="Закрыть">✕</button>
        </div>
        <div class="ts2-diag-body">
          <div class="ts2-diag-intro">
            Если по BB / Jira / Confluence не приходят данные — ниже причины и как починить.
            <br>Кликните на заголовок секции чтобы развернуть.
          </div>
          ${sections}
          <div class="ts2-diag-export-section">
            <h4 class="ts2-diag-export-title">Экспортировать для разработчика</h4>
            <p class="ts2-diag-export-hint">
              Если проблему не удалось решить — отправьте JSON с диагностикой.
              Безопасный экспорт скрывает email / accountId / названия задач.
            </p>
            <div class="ts2-diag-export-buttons">
              <button class="ts2-btn ts2-btn-primary" id="ts2-diag-export-safe" type="button">
                📋 Безопасный экспорт
              </button>
              <button class="ts2-btn ts2-btn-warn" id="ts2-diag-export-raw" type="button">
                ⚠️ Полный экспорт (PII)
              </button>
            </div>
            <div class="ts2-diag-audit-hint">
              <span aria-hidden="true">🔒</span> ${esc(auditHint)}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/** V20 S2.3 — disclaimer перед raw-экспортом. B3 consent flow. */
export function renderDiagnosticDisclaimer() {
  return `
    <div class="ts2-diag-disclaimer-overlay" id="ts2-diag-disclaimer" role="presentation">
      <div class="ts2-diag-disclaimer" role="dialog" aria-modal="true" aria-labelledby="ts2-diag-disclaimer-title">
        <div class="ts2-diag-disclaimer-header">
          <span class="ts2-diag-disclaimer-icon" aria-hidden="true">⚠️</span>
          <h3 class="ts2-diag-disclaimer-title" id="ts2-diag-disclaimer-title">Полный экспорт содержит персональные данные</h3>
        </div>
        <div class="ts2-diag-disclaimer-body">
          <p>JSON будет содержать <b>в открытом виде</b>:</p>
          <ul class="ts2-diag-disclaimer-list">
            <li>email сотрудников (полностью, не маскированный)</li>
            <li>jiraAccountId / bitbucketLogin / confluenceAccountId</li>
            <li>имена сотрудников (displayName)</li>
            <li>названия задач Jira и страниц Confluence (полностью)</li>
          </ul>
          <p>Токены интеграций (Bearer / Authorization) <b>всегда</b> скрыты — даже здесь.</p>
          <p class="ts2-diag-disclaimer-warning">
            Отправляйте этот JSON <b>только напрямую разработчику</b>, которому вы доверяете
            (1:1 chat / личная почта). Не загружайте в публичные баги, не пересылайте через
            групповые чаты.
          </p>
          <p class="ts2-diag-disclaimer-audit">
            Факт экспорта будет залогирован в localStorage этого браузера
            (только timestamp + размер, без содержимого).
          </p>
          <!-- V20 S8.5 #21 — counter оставшегося consent (auto-show если ещё активен). -->
          <p class="ts2-diag-disclaimer-counter" id="ts2-diag-consent-counter" style="display:none;"></p>
          <!-- V20 S7 B6 — обязательный consent checkbox перед раскрытием PII.
               Compliance: HR-аудит может запросить доказательство явного согласия.
               V20 S8 #6 — добавлен «запомнить на 24ч» (q2_diag_consent_until). -->
          <label class="ts2-diag-disclaimer-consent">
            <input type="checkbox" id="ts2-diag-disclaimer-consent">
            <span>Я понимаю что JSON содержит персональные данные сотрудников
                  и обязуюсь передать его только конкретному доверенному
                  разработчику. Не буду пересылать в групповые чаты, баги
                  или публичные системы.</span>
          </label>
          <label class="ts2-diag-disclaimer-remember">
            <input type="checkbox" id="ts2-diag-disclaimer-remember">
            <span>Запомнить согласие на 24 часа (для срочных передач без повторного клика). Audit-log сохранит факт автоматического consent'а.</span>
          </label>
        </div>
        <div class="ts2-diag-disclaimer-actions">
          <button class="ts2-btn ts2-btn-ghost" type="button" data-close-modal>Отмена</button>
          <button class="ts2-btn ts2-btn-warn" type="button" id="ts2-diag-disclaimer-confirm" disabled>
            Понял риски — продолжить
          </button>
        </div>
      </div>
    </div>
  `;
}

/* Section helpers — каждая возвращает <div class="ts2-diag-section">…</div> */

function _diagSection(id, head, body, opts = {}) {
  const open = opts.openByDefault ? 'ts2-diag-section-open' : '';
  return `
    <div class="ts2-diag-section ${open}" data-section="${esc(id)}">
      <button class="ts2-diag-section-head" type="button">
        <span class="ts2-diag-section-chev" aria-hidden="true">▸</span>
        <span class="ts2-diag-section-title">${esc(head)}</span>
        ${opts.statusPill ? `<span class="ts2-diag-status-pill ts2-diag-status-${esc(opts.statusKind || 'neutral')}">${esc(opts.statusPill)}</span>` : ''}
      </button>
      <div class="ts2-diag-section-body">${body}</div>
    </div>
  `;
}

function _kv(label, value, hint) {
  const v = (value === null || value === undefined || value === '') ? '—' : String(value);
  return `<div class="ts2-diag-kv"><span class="ts2-diag-kv-label">${esc(label)}</span><span class="ts2-diag-kv-value">${esc(v)}</span>${hint ? `<span class="ts2-diag-kv-hint">${esc(hint)}</span>` : ''}</div>`;
}

function _diagSectionHeader(h, tz) {
  // V20 S3.3 — TZ skew block.
  let tzBlock = '';
  if (tz?.available) {
    const flag = tz.skewSuspicious ? `<span class="ts2-diag-flag">⚠ ${esc(String(tz.skewSeconds))}s skew</span>` : '';
    tzBlock = `
      <div class="ts2-diag-subhead">Time skew (browser ↔ server)</div>
      ${_kv('Browser timezone', tz.browserTzLabel)}
      ${_kv('Server fetchedAt',  tz.serverTs)}
      ${_kv('Browser now',       tz.browserNow)}
      ${_kv('Age кэша (server→now)', `${tz.skewSeconds} сек`, flag)}
      ${tz.skewSuspicious ? `<div class="ts2-diag-callout">
        Расхождение > 5 мин может указывать на:<br>
        1) <b>Часы клиента или сервера ушли</b> — проверьте System Time на обеих сторонах.<br>
        2) <b>VPN маршрутизация</b> — запрос идёт через другой регион/ДЦ.<br>
        3) <b>Старый кэш</b> — нажмите ↻ Обновить, чтобы увидеть свежий fetchedAt.
      </div>` : ''}
    `;
  }
  return _diagSection('header', 'Окружение', `
    ${_kv('Время отчёта', h.generatedAt)}
    ${_kv('Build', h.appBuild)}
    ${_kv('Browser', h.userAgent.slice(0, 80) + (h.userAgent.length > 80 ? '…' : ''))}
    ${_kv('Locale', h.locale)}
    ${_kv('TZ offset (мин)', h.tzOffsetMin)}
    ${tzBlock}
  `, { openByDefault: true, statusPill: tz?.skewSuspicious ? 'TZ skew' : null, statusKind: tz?.skewSuspicious ? 'warn' : null });
}

function _diagSectionConfig(c) {
  const bad = !c.projectKeys.length;
  return _diagSection('config', 'Конфигурация',
    `${_kv('projectKeys (Jira)', c.projectKeys.join(', ') || '—', c.projectKeys.length ? `${c.projectKeys.length} шт.` : 'нет')}
     ${_kv('bbProjectKeys (Bitbucket)', c.bbProjectKeys.join(', ') || '—', c.bbProjectKeys.length ? `${c.bbProjectKeys.length} шт.` : 'будет искать по всем')}
     ${_kv('spaceKeys (Confluence)', c.spaceKeys.join(', ') || '—', c.spaceKeys.length ? `${c.spaceKeys.length} шт.` : 'будет искать по всем доступным')}
     ${_kv('Окно активности', c.activityWindowHours + ' ч')}
     ${_kv('sinceDate', c.sinceDate)}
     ${_kv('Jira токен', c.hasJiraToken ? 'настроен' : 'НЕ настроен', c.jiraBaseUrl)}
     ${_kv('Bitbucket токен', c.hasBitbucketToken ? 'настроен' : 'НЕ настроен', c.bitbucketBaseUrl)}
     ${_kv('Confluence токен', c.hasConfluenceToken ? 'настроен' : 'НЕ настроен', c.confluenceBaseUrl)}
     ${_kv('insecureTls', c.allowInsecureTls ? 'разрешён (self-signed)' : 'строгая проверка')}`,
    { statusPill: bad ? 'нет projectKeys' : null, statusKind: bad ? 'err' : 'ok', openByDefault: bad });
}

function _diagSectionConnection(c) {
  // V20 S3.1 — connection probe matrix UI. Кнопка вне зависимости от
  // fetchPerformed — даже без cache можно прогнать verify-endpoints.
  const probeUI = `
    <div class="ts2-diag-subhead">Live probe</div>
    <div class="ts2-diag-probe-controls">
      <button class="ts2-btn ts2-btn-ghost ts2-btn-sm" id="ts2-diag-probe-run" type="button">▶ Прогнать все 3 интеграции</button>
      <span class="ts2-diag-probe-hint">Параллельно дёргает /verify-* endpoints, измеряет latency client-side.</span>
    </div>
    <div class="ts2-diag-probe-results" id="ts2-diag-probe-results"></div>
  `;
  if (!c.fetchPerformed) {
    return _diagSection('connection', 'Подключение / fetch',
      `<div class="ts2-diag-empty">Pulse-данные ещё не загружались (lazy mode). Нажмите «Загрузить данные команды» в основном экране — или прогоните live-probe ниже.</div>${probeUI}`,
      { statusPill: 'не запускался', statusKind: 'warn' });
  }
  const errCount = (c.perPkErrors || []).length;
  const errBlock = errCount ? `
    <div class="ts2-diag-subhead">Ошибки по проектам (${errCount}):</div>
    ${c.perPkErrors.map(e => `
      <div class="ts2-diag-err-row">
        <code class="ts2-diag-pk">${esc(e.projectKey)}</code>
        <span class="ts2-diag-err-msg">${esc(e.error)}</span>
      </div>
    `).join('')}
  ` : `<div class="ts2-diag-ok">Все per-PK fetch'и прошли без ошибок.</div>`;
  // V20 S7 B11 — jobId expiration display.
  const jobExpInfo = c.jobExpired
    ? '<span class="ts2-diag-flag">истёк — drill-down не работает</span>'
    : (c.jobExpiresInMs != null ? `осталось ${Math.round(c.jobExpiresInMs / 60000)} мин` : '');
  return _diagSection('connection', 'Подключение / fetch', `
    ${_kv('Время загрузки', c.fetchedAt)}
    ${_kv('Возраст кэша', c.cacheAgeMs != null ? Math.round(c.cacheAgeMs / 1000) + ' сек' : '—')}
    ${_kv('Latency last fetch', c.fetchLatencyMs != null ? c.fetchLatencyMs + ' мс' : '—')}
    ${_kv('jobId (TTL 120 мин)', c.jobId || '—', jobExpInfo)}
    ${errBlock}
    ${probeUI}
  `, { statusPill: errCount ? `${errCount} ошибок` : (c.jobExpired ? 'jobId истёк' : 'OK'), statusKind: errCount ? 'err' : (c.jobExpired ? 'warn' : 'ok'), openByDefault: errCount > 0 || c.jobExpired });
}

/** V20 S3.1 — render probe results после клика «Прогнать». */
export function renderProbeResults(probe) {
  if (!probe) return '<div class="ts2-diag-empty">Нет результатов probe.</div>';
  const row = (r) => {
    const kind = r.ok ? 'ok' : 'err';
    const icon = r.ok ? '✓' : '✗';
    const detail = r.ok
      ? (r.who ? esc(r.who) : 'OK')
      : esc(r.error || 'unknown');
    return `
      <div class="ts2-diag-probe-row ts2-diag-probe-${kind}">
        <span class="ts2-diag-probe-icon" aria-hidden="true">${icon}</span>
        <code class="ts2-diag-probe-source">${esc(r.source)}</code>
        <span class="ts2-diag-probe-latency">${esc(String(r.latencyMs))} мс</span>
        <span class="ts2-diag-probe-detail">${detail}</span>
      </div>`;
  };
  return `
    <div class="ts2-diag-probe-grid">
      ${row(probe.jira)}
      ${row(probe.bitbucket)}
      ${row(probe.confluence)}
    </div>
    <div class="ts2-diag-probe-meta">Probe выполнен ${esc(probe.generatedAt)}</div>
  `;
}

function _diagSectionSources(s) {
  const fmt = (n) => Number.isFinite(n) ? n.toLocaleString('ru-RU') : '—';
  if (!s.jira && !s.bitbucket && !s.confluence) {
    return _diagSection('sources', 'Артефакты по источникам',
      `<div class="ts2-diag-empty">Нет данных — fetch не запускался.</div>`,
      { statusKind: 'neutral' });
  }
  // Highlight «нет данных» по каждому источнику.
  const bbZero = s.bitbucket && s.bitbucket.totalItems === 0;
  const cfZero = s.confluence && s.confluence.totalItems === 0;
  const warnings = [];
  if (bbZero) warnings.push('Bitbucket: 0 артефактов');
  if (cfZero) warnings.push('Confluence: 0 артефактов');
  return _diagSection('sources', 'Артефакты по источникам', `
    <div class="ts2-diag-subhead">Jira</div>
    ${_kv('Назначенные задачи (issuesNow)', fmt(s.jira?.issuesAssignedNow))}
    ${_kv('События timeline 72ч', fmt(s.jira?.timelineEvents72h))}
    ${_kv('Комментарии recent', fmt(s.jira?.commentsRecent))}
    ${_kv('Project spaces в model', fmt(s.jira?.perPkSpaces))}
    <div class="ts2-diag-subhead">Bitbucket ${bbZero ? '<span class="ts2-diag-flag">⚠ нулевые</span>' : ''}</div>
    ${_kv('Всего items', fmt(s.bitbucket?.totalItems))}
    ${_kv('Commits', fmt(s.bitbucket?.commits))}
    ${_kv('Pull Requests', fmt(s.bitbucket?.prs))}
    ${_kv('Reviews', fmt(s.bitbucket?.reviews))}
    <div class="ts2-diag-subhead">Confluence ${cfZero ? '<span class="ts2-diag-flag">⚠ нулевые</span>' : ''}</div>
    ${_kv('Items (правки + страницы + комменты)', fmt(s.confluence?.totalItems))}
    <div class="ts2-diag-subhead">Zephyr</div>
    ${_kv('Тесты создано', fmt(s.zephyr?.testsCreated))}
    ${_kv('Тесты выполнено', fmt(s.zephyr?.testsExecuted))}
    ${(bbZero || cfZero) ? `<div class="ts2-diag-callout">
      Нулевые артефакты обычно означают одну из:<br>
      1) <b>Identity coverage</b> — у сотрудников не заполнены <code>bitbucketLogin</code> / <code>confluenceAccountId</code> в реестре. См. секцию «Identity coverage» ниже.<br>
      2) <b>Окно слишком короткое</b> — попробуйте увеличить «Окно активности» в настройках до 168ч.<br>
      3) <b>Token / permission</b> — проверьте кнопками «Проверить подключение» в настройках.
    </div>` : ''}
    ${s.rawDiag ? `
      <div class="ts2-diag-subhead">RAW counts (до identity-attribution)</div>
      ${_kv('BB authors (raw)', s.rawDiag.bbAuthorsCount, s.rawDiag.bbItemsTotal + ' items total')}
      ${_kv('CF authors (raw)', s.rawDiag.cfAuthorsCount, s.rawDiag.cfItemsTotal + ' items total')}
      ${_kv('Zephyr authors (raw)', s.rawDiag.zephyrAuthorsCount, `${s.rawDiag.zephyrTestCasesScanned} test cases · ${s.rawDiag.zephyrTestRunsScanned} test runs · ${s.rawDiag.zephyrProjectsResolved} projects`)}
      ${s.rawDiag.bbAuthorsCount > 0 && (s.bitbucket?.totalItems || 0) === 0
        ? '<div class="ts2-diag-flag">⚠ BB вернул данные, но 0 attribution — это identity gap</div>'
        : ''}
      ${s.rawDiag.cfAuthorsCount > 0 && (s.confluence?.totalItems || 0) === 0
        ? '<div class="ts2-diag-flag">⚠ CF вернул данные, но 0 attribution — это identity gap</div>'
        : ''}
      ${s.rawDiag.perPk?.length ? `
        <div class="ts2-diag-subhead">Per-PK</div>
        <table class="ts2-diag-table">
          <thead><tr><th>PK</th><th>Issues</th><th>Sprints</th><th>Status</th></tr></thead>
          <tbody>
            ${s.rawDiag.perPk.map(pk => `<tr>
              <td><code>${esc(pk.pk)}</code></td>
              <td>${pk.issuesCount}</td>
              <td>${pk.sprintCount}</td>
              <td>${pk.hasError ? `<span class="ts2-diag-flag">${esc(pk.error || 'error')}</span>` : 'OK'}</td>
            </tr>`).join('')}
          </tbody>
        </table>` : ''}
    ` : ''}
  `, { statusPill: warnings.length ? warnings.length + ' предупр.' : 'OK', statusKind: warnings.length ? 'warn' : 'ok', openByDefault: warnings.length > 0 });
}

function _diagSectionIdentity(i) {
  if (!i.teamSize) {
    return _diagSection('identity', 'Identity coverage',
      `<div class="ts2-diag-empty">Команда пуста — нечего проверять.</div>`);
  }
  const c = i.coverage;
  const bar = (label, c) => `
    <div class="ts2-diag-bar-row">
      <span class="ts2-diag-bar-label">${esc(label)}</span>
      <div class="ts2-diag-bar"><div class="ts2-diag-bar-fill ts2-diag-bar-${c.pct >= 80 ? 'ok' : c.pct >= 50 ? 'warn' : 'err'}" style="width:${c.pct}%"></div></div>
      <span class="ts2-diag-bar-count">${c.count}/${i.teamSize} (${c.pct}%)</span>
    </div>`;
  const incomplete = (i.incomplete || []).slice(0, 20);
  const incompleteHtml = incomplete.length ? `
    <div class="ts2-diag-subhead">Сотрудники с неполной identity (${i.incomplete.length}, показано первые 20):</div>
    <ul class="ts2-diag-incomplete-list">
      ${incomplete.map(p => `<li><b>${esc(p.label || p.key)}</b> — нет: ${(p.missing || []).map(esc).join(', ')}</li>`).join('')}
    </ul>
  ` : `<div class="ts2-diag-ok">У всех сотрудников identity-поля заполнены.</div>`;
  const lowest = Math.min(c.email?.pct ?? 100, c.jiraId?.pct ?? 100, c.bbLogin?.pct ?? 100, c.cfId?.pct ?? 100);
  // V20 S4 — кнопка автo-резолва. Видна только когда есть неполные identity'и
  // И при условии что есть email-coverage > 0 (иначе нечем матчить).
  const canResolve = (i.incomplete || []).length > 0 && (c.email?.pct ?? 0) > 0;
  const resolveUI = canResolve ? `
    <div class="ts2-diag-subhead">Авторазрешение через email</div>
    <div class="ts2-diag-resolve-controls">
      <button class="ts2-btn ts2-btn-primary ts2-btn-sm" id="ts2-diag-resolve-btn" type="button">
        🔍 Авторазрешить bbLogin / cfAccountId по email
      </button>
      <span class="ts2-diag-resolve-hint">
        Ищет каждого сотрудника в Bitbucket и Confluence по его email из реестра.
        Конкурентность 5, до 8 сек на источник на сотрудника.
      </span>
    </div>
    <div class="ts2-diag-resolve-results" id="ts2-diag-resolve-results"></div>
  ` : '';
  return _diagSection('identity', 'Identity coverage', `
    ${bar('email',          c.email)}
    ${bar('jiraAccountId',  c.jiraId)}
    ${bar('bitbucketLogin', c.bbLogin)}
    ${bar('confluenceId',   c.cfId)}
    ${incompleteHtml}
    ${resolveUI}
  `, { statusPill: lowest + '% мин', statusKind: lowest >= 80 ? 'ok' : lowest >= 50 ? 'warn' : 'err', openByDefault: lowest < 80 });
}

/**
 * V20 S4 — Preview-modal для identity-resolve diff'а.
 * Показывает таблицу: ФИО / email / current → proposed для каждого
 * resolved сотрудника. Highlight changed rows. Save / Cancel.
 *
 * @param {object[]} diff — массив { empKey, fio, email, before:{bb,cf}, after:{bb,cf}, status }
 * @param {object} summary — { total, bbResolved, cfResolved, noEmail }
 */
export function renderIdentityResolvePreview(diff, summary) {
  const changed = diff.filter(d => d.status === 'change');
  const unchanged = diff.filter(d => d.status === 'unchanged');
  const failed = diff.filter(d => d.status === 'failed');
  const noEmail = diff.filter(d => d.status === 'no-email');

  const row = (d) => {
    const bbChanged = d.before.bb !== d.after.bb;
    const cfChanged = d.before.cf !== d.after.cf;
    return `
      <tr class="ts2-resolve-row ts2-resolve-row-${d.status}">
        <td class="ts2-resolve-fio">${esc(d.fio || '')}</td>
        <td class="ts2-resolve-email">${esc(d.email || '—')}</td>
        <td class="${bbChanged ? 'ts2-resolve-cell-changed' : ''}">
          ${d.before.bb ? `<s class="ts2-resolve-old">${esc(d.before.bb)}</s>` : '<span class="ts2-resolve-empty">—</span>'}
          ${bbChanged ? '→' : ''}
          ${d.after.bb ? `<b class="ts2-resolve-new">${esc(d.after.bb)}</b>` : (bbChanged ? '<span class="ts2-resolve-empty">не найден</span>' : '')}
        </td>
        <td class="${cfChanged ? 'ts2-resolve-cell-changed' : ''}">
          ${d.before.cf ? `<s class="ts2-resolve-old">${esc(d.before.cf)}</s>` : '<span class="ts2-resolve-empty">—</span>'}
          ${cfChanged ? '→' : ''}
          ${d.after.cf ? `<b class="ts2-resolve-new">${esc(d.after.cf)}</b>` : (cfChanged ? '<span class="ts2-resolve-empty">не найден</span>' : '')}
        </td>
      </tr>
    `;
  };

  return `
    <div class="ts2-resolve-modal-overlay" id="ts2-resolve-modal" role="presentation">
      <div class="ts2-resolve-modal" role="dialog" aria-modal="true" aria-labelledby="ts2-resolve-title">
        <div class="ts2-resolve-header">
          <h3 class="ts2-resolve-title" id="ts2-resolve-title">🔍 Identity Auto-Resolve — preview</h3>
          <button class="ts2-resolve-close" type="button" data-close-modal aria-label="Закрыть">✕</button>
        </div>
        <div class="ts2-resolve-summary">
          <span class="ts2-resolve-stat ts2-resolve-stat-ok">✓ <b>${changed.length}</b> изменений</span>
          <span class="ts2-resolve-stat">≡ ${unchanged.length} без изменений</span>
          <span class="ts2-resolve-stat ${failed.length > changed.length ? 'ts2-resolve-stat-err' : 'ts2-resolve-stat-warn'}">✗ <b>${failed.length}</b> не найдено</span>
          ${noEmail.length ? `<span class="ts2-resolve-stat ts2-resolve-stat-muted">⊘ ${noEmail.length} без email</span>` : ''}
          <span class="ts2-resolve-stat-meta">BB: ${summary.bbResolved}/${summary.total} · CF: ${summary.cfResolved}/${summary.total}</span>
        </div>
        ${failed.length > changed.length ? `<div class="ts2-resolve-warn-banner">
          ⚠️ Найдено меньше чем не найдено (${changed.length} vs ${failed.length}).
          Возможные причины: неправильный фокус ФИО (см. раздел «не найдено» ниже),
          CF не индексирует email/fullname, или нет прав у токена.
        </div>` : ''}
        <div class="ts2-resolve-body">
          ${changed.length ? `
            <table class="ts2-resolve-table">
              <thead><tr>
                <th>ФИО</th><th>email</th><th>bitbucketLogin</th><th>confluenceAccountId</th>
              </tr></thead>
              <tbody>${changed.map(row).join('')}</tbody>
            </table>
          ` : `<div class="ts2-diag-empty">Нет изменений — всё уже сматчено.</div>`}
          ${failed.length ? `
            <details class="ts2-resolve-details" ${failed.length > changed.length ? 'open' : ''}>
              <summary>Не найдено в API (${failed.length}) — раскрыть</summary>
              <ul class="ts2-resolve-failed-list">
                ${failed.slice(0, 30).map(d => `<li><b>${esc(d.fio || d.empKey)}</b> · ${esc(d.email)} — bb: ${esc(d.bbError || '?')} / cf: ${esc(d.cfError || '?')}</li>`).join('')}
              </ul>
            </details>
          ` : ''}
        </div>
        <div class="ts2-resolve-actions">
          <button class="ts2-btn ts2-btn-ghost" type="button" data-close-modal>Отмена</button>
          <button class="ts2-btn ts2-btn-primary" type="button" id="ts2-resolve-save"${changed.length ? '' : ' disabled'}>
            ✓ Сохранить ${changed.length} изменений
          </button>
        </div>
      </div>
    </div>
  `;
}

function _diagSectionThresholds(t) {
  const d = t.defaultDwell || {};
  const perTeamCount = t.perTeam ? Object.keys(t.perTeam).length : 0;
  // V20 S3.2 — sensitivity preview: 4 input'а + кнопка «пересчитать».
  // Реакция в _bindDiagModalEvents: пересчитываем simulateThresholds()
  // и обновляем span'ы results без перерендера всей модалки.
  const sensitivityUI = `
    <div class="ts2-diag-subhead">«Что если…» — sensitivity preview</div>
    <div class="ts2-diag-sens-controls">
      <label class="ts2-diag-sens-input">Code Review (ч)<input type="number" min="1" max="200" value="${d.codeReview}" data-sens-field="codeReview"></label>
      <label class="ts2-diag-sens-input">QA (ч)<input type="number" min="1" max="200" value="${d.qa}" data-sens-field="qa"></label>
      <label class="ts2-diag-sens-input">In Progress (ч)<input type="number" min="1" max="500" value="${d.inProgress}" data-sens-field="inProgress"></label>
      <label class="ts2-diag-sens-input">To Do (ч)<input type="number" min="1" max="500" value="${d.todo}" data-sens-field="todo"></label>
    </div>
    <div class="ts2-diag-sens-controls">
      <button class="ts2-btn ts2-btn-ghost ts2-btn-sm" id="ts2-diag-sens-run" type="button">▶ Пересчитать blockers</button>
      <span class="ts2-diag-sens-hint">Не сохраняет — только preview эффекта на counts.</span>
    </div>
    <div class="ts2-diag-sens-results" id="ts2-diag-sens-results"></div>
  `;
  return _diagSection('thresholds', 'Пороги (dwell-time)', `
    <div class="ts2-diag-subhead">Default (часы)</div>
    ${_kv('Code Review',  d.codeReview)}
    ${_kv('QA / Testing', d.qa)}
    ${_kv('In Progress',  d.inProgress)}
    ${_kv('To Do / Open', d.todo)}
    ${_kv('Прочие',       d.default)}
    ${perTeamCount ? `<div class="ts2-diag-subhead">Per-team overrides (${perTeamCount})</div>
      <pre class="ts2-diag-pre">${esc(JSON.stringify(t.perTeam, null, 2))}</pre>` : `<div class="ts2-diag-empty">Нет per-team override'ов — используются default.</div>`}
    ${sensitivityUI}
  `, { statusPill: perTeamCount ? `${perTeamCount} команд override` : 'default', statusKind: 'neutral' });
}

/** V20 S3.2 — render результатов sensitivity preview. */
export function renderSensitivityResults(sim, currentCounts) {
  if (!sim) return '<div class="ts2-diag-empty">Нет результатов.</div>';
  const c = sim.counts || {};
  const cur = currentCounts || {};
  const delta = (a, b) => Number.isFinite(a - b) ? (a - b) : 0;
  const fmt = (d) => d > 0 ? `+${d}` : (d < 0 ? `${d}` : '0');
  const cellClass = (d) => d > 0 ? 'ts2-diag-sens-up' : d < 0 ? 'ts2-diag-sens-down' : 'ts2-diag-sens-flat';
  // V20 S6.2.6 — показ warning'а если часть participants ушли в fallback.
  const coverageWarning = sim.coverageInfo
    ? `<div class="ts2-diag-callout">${esc(sim.coverageInfo)}. Гипотетические пороги к ним не применяются — данные показывают default-классификацию.</div>`
    : '';
  return `
    ${coverageWarning}
    <div class="ts2-diag-sens-summary">
      Blockers всего: <b>${sim.blockersTotal}</b>
    </div>
    <table class="ts2-diag-table">
      <thead><tr><th>Группа</th><th>Сейчас</th><th>Симуляция</th><th>Δ</th></tr></thead>
      <tbody>
        ${['stop', 'watch', 'moving', 'idle'].map(k => {
          const d = delta(c[k] || 0, cur[k] || 0);
          return `<tr>
            <td>${esc({ stop: 'Стоп', watch: 'Watch', moving: 'Движется', idle: 'Без активности' }[k])}</td>
            <td>${cur[k] ?? '—'}</td>
            <td><b>${c[k] ?? '—'}</b></td>
            <td class="${cellClass(d)}">${fmt(d)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

function _diagSectionSnapshot(s) {
  const c = s.current?.counts || {};
  const p = s.prev?.counts || {};
  const delta = (a, b) => Number.isFinite(a) && Number.isFinite(b) ? (a - b) : null;
  const fmt = (d) => d == null ? '—' : (d > 0 ? `+${d}` : `${d}`);
  const ageH = s.prev?.ageHours;
  const histStat = s.history?.entries
    ? `${s.history.entries} snap. (${s.history.earliest || '?'} → ${s.history.latest || '?'})`
    : 'нет истории';
  // V20 S7 A6 — EMA / WoW / anomaly блок если есть trends.
  const t = s.trends || {};
  const trendCell = (label, ema, anom) => {
    const wowSign = ema?.wowDelta > 0 ? '+' : '';
    const wowClass = ema?.wowDelta > 0 ? 'ts2-diag-sens-up' : (ema?.wowDelta < 0 ? 'ts2-diag-sens-down' : 'ts2-diag-sens-flat');
    const anomChip = anom?.anomalous ? `<span class="ts2-diag-flag">⚠ z=${anom.z > 0 ? '+' : ''}${anom.z}</span>` : '';
    return `<tr>
      <td>${esc(label)}</td>
      <td>${ema?.emaToday ?? '—'}</td>
      <td>${ema?.emaLastWeek ?? '—'}</td>
      <td class="${wowClass}">${ema?.wowDelta != null ? wowSign + ema.wowDelta : '—'}</td>
      <td>${anomChip}</td>
    </tr>`;
  };
  const trendsBlock = (Object.keys(t).length) ? `
    <div class="ts2-diag-subhead">EMA + Week-over-Week (α=0.3, ≥8 точек)</div>
    <table class="ts2-diag-table">
      <thead><tr><th>Метрика</th><th>EMA today</th><th>EMA 7d ago</th><th>WoW Δ</th><th>Anomaly</th></tr></thead>
      <tbody>
        ${trendCell('Стоп',        t.stopEma,    t.stopAnomaly)}
        ${trendCell('Движется',    t.movingEma,  t.movingAnomaly)}
        ${trendCell('Sprint progress', t.progressEma, null)}
      </tbody>
    </table>
  ` : '';
  return _diagSection('snapshot', 'Snapshot delta vs вчера', `
    ${ageH != null ? `<div class="ts2-diag-subhead">Прошлый snapshot: ${ageH} ч назад</div>` : `<div class="ts2-diag-empty">Прошлый snapshot не найден или старше 24 ч.</div>`}
    <table class="ts2-diag-table">
      <thead><tr><th>Группа</th><th>Сейчас</th><th>Раньше</th><th>Δ</th></tr></thead>
      <tbody>
        <tr><td>Стоп</td><td>${c.stop ?? '—'}</td><td>${p.stop ?? '—'}</td><td>${fmt(delta(c.stop, p.stop))}</td></tr>
        <tr><td>Watch</td><td>${c.watch ?? '—'}</td><td>${p.watch ?? '—'}</td><td>${fmt(delta(c.watch, p.watch))}</td></tr>
        <tr><td>Движется</td><td>${c.moving ?? '—'}</td><td>${p.moving ?? '—'}</td><td>${fmt(delta(c.moving, p.moving))}</td></tr>
        <tr><td>Без активности</td><td>${c.idle ?? '—'}</td><td>${p.idle ?? '—'}</td><td>${fmt(delta(c.idle, p.idle))}</td></tr>
      </tbody>
    </table>
    <div class="ts2-diag-subhead">Multi-day история</div>
    <div class="ts2-diag-kv-row">${esc(histStat)}</div>
    ${trendsBlock}
  `);
}

function _diagSectionModelSummary(ms) {
  if (!ms) {
    return _diagSection('model', 'Model summary',
      `<div class="ts2-diag-empty">Нет model'и — fetch не запускался.</div>`);
  }
  return _diagSection('model', 'Model summary', `
    ${_kv('participants', ms.participantsCount)}
    ${_kv('активных спринтов', ms.activeSprintsCount)}
    ${_kv('spaces в model', ms.spaceKeys.join(', ') || '—')}
    <div class="ts2-diag-subhead">Risks</div>
    ${_kv('orphans (всего)',  ms.risks.totalOrphans)}
    ${_kv('orphans (real)',   ms.risks.totalRealOrphans, 'in-sprint OR fresh+high-priority')}
    ${_kv('out-of-sprint',    ms.risks.totalOutOfSprint)}
    ${_kv('outOfSprintRatio', (ms.risks.outOfSprintRatio * 100).toFixed(1) + '%', 'unique-keys basis')}
    <div class="ts2-diag-subhead">Sprint Goal (агрегат)</div>
    ${_kv('progress',         ms.sprintGoal.aggregateProgress + '%')}
    ${_kv('sprint-mean',      (ms.sprintGoal.sprintMeanProgress ?? 0) + '%')}
    ${_kv('pace',             ms.sprintGoal.aggregatePace, ms.sprintGoal.aggregatePaceSource || '')}
    ${_kv('спринтов',         ms.sprintGoal.sprintsCount)}
  `);
}

/**
 * V20 S8 #12 — Known Issues section. Whitelist типичных проблем пилота +
 * подсветка «ваш случай» если condition сматчился. UX feedback: «нужен
 * actionable next-step «CF=0% это normal in Sber DC»».
 */
function _diagSectionKnownIssues(state) {
  const i = state.identity || {};
  const c = state.config || {};
  const conn = state.connection || {};
  const tz = state.tzSkew || {};
  const issues = [];

  // 1) CF coverage 0% — известная проблема Sber DC.
  if ((i.coverage?.cfId?.pct || 0) === 0 && (i.teamSize || 0) > 0) {
    issues.push({
      severity: 'normal',
      title: 'Confluence coverage 0% — известная проблема Sber DC',
      body: `Sber Confluence DC использует numeric LDAP usernames (не email-prefix). API <code>cql=user.email = "..."</code> не индексируется в DC. После V20 S5 cascade пробует <code>cql=user.fullname = "ФИО"</code> — но ФИО должно быть точно как в CF.<br>
            <b>Что делать:</b> 1) Проверьте что <code>fio</code> у сотрудников совпадает с CF профилем символ-в-символ (включая суффиксы [B] / [external]). 2) Если не помогает — заполнить <code>confluenceAccountId</code> вручную (это numeric LDAP-ID, видно в URL CF при наведении на автора).`,
    });
  }

  // 2) BB coverage низкий.
  if ((i.coverage?.bbLogin?.pct || 100) < 30 && c.hasBitbucketToken) {
    issues.push({
      severity: 'warn',
      title: `BB coverage ${i.coverage?.bbLogin?.pct || 0}% — низко`,
      body: `<b>Что делать:</b> Откройте Identity Auto-Resolve (кнопка ниже в этой секции). Sber Stash возвращает slug по email-фильтру — должен сматчить большинство.`,
    });
  }

  // 3) sinceDate слишком широкий.
  const sinceMs = c.sinceDate ? Date.parse(c.sinceDate) : NaN;
  if (Number.isFinite(sinceMs) && (Date.now() - sinceMs) > 365 * 86400 * 1000) {
    issues.push({
      severity: 'warn',
      title: 'sinceDate шире 1 года → высокая latency + много orphan-issues',
      // V20 S8.5 #1 — XSS guard: sinceDate приходит из user-config (settings UI),
      // нельзя интерполировать в HTML без esc(). Тот же класс что мы фиксили в S6/probe.
      body: `Текущий <code>sinceDate=${esc(c.sinceDate)}</code>. Это влияет на: 1) <code>totalOrphans</code> (пилот 2513 — backlog с 2025); 2) Jira fetch latency (видим 50+ сек). <b>Рекомендация:</b> поднять до текущего квартала (например <code>2026-01-01</code>).`,
    });
  }

  // 4) TZ skew suspicious.
  if (tz?.skewSuspicious) {
    issues.push({
      severity: 'warn',
      title: `TZ skew ${esc(String(tz.skewSeconds))}с — часы расходятся`,
      body: `Browser=${esc(tz.browserTzLabel || '')}, server timestamp ${esc(tz.serverTs || '')}. Если skew > 5 мин и vы не на VPN — проверьте system clock (ntp).`,
    });
  }

  // 5) jobId expired (drill-down не работает).
  if (conn?.jobExpired) {
    issues.push({
      severity: 'err',
      title: 'jobId истёк — нажмите ↻ Обновить',
      body: 'Server pulse-job TTL = 120 мин. После истечения drill-down по сотрудникам не работает — нужен новый fetch.',
    });
  }

  // 6) Нет projectKeys — empty config.
  if (!c.projectKeys?.length) {
    issues.push({
      severity: 'err',
      title: 'projectKeys пустой',
      body: 'Заполните <code>jiraProjectKeys</code> в настройках Jira. Без них fetch не запустится.',
    });
  }

  if (!issues.length) {
    return _diagSection('known-issues', 'Известные проблемы',
      `<div class="ts2-diag-ok">Всё чисто — известных проблем не обнаружено.</div>`,
      { statusPill: 'OK', statusKind: 'ok' });
  }

  const errCount = issues.filter(i => i.severity === 'err').length;
  const warnCount = issues.filter(i => i.severity === 'warn').length;
  const body = issues.map(iss => `
    <div class="ts2-diag-callout ts2-diag-known-${iss.severity}">
      <div class="ts2-diag-known-title">${iss.severity === 'err' ? '🔴' : iss.severity === 'warn' ? '🟡' : 'ℹ️'} ${esc(iss.title)}</div>
      <div class="ts2-diag-known-body">${iss.body}</div>
    </div>
  `).join('');
  return _diagSection('known-issues', 'Известные проблемы (auto-detect)', body, {
    statusPill: errCount ? `${errCount} крит.` : (warnCount ? `${warnCount} предупр.` : 'info'),
    statusKind: errCount ? 'err' : (warnCount ? 'warn' : 'neutral'),
    openByDefault: errCount > 0 || warnCount >= 2,
  });
}

/** V20 S7 B10 — botsFilteredOut section. Тимлид может видеть кого мы исключили
 *  и оспорить ложные срабатывания. */
function _diagSectionBots(bots) {
  const count = (bots || []).length;
  if (!count) {
    return _diagSection('bots', 'Service-аккаунты (исключены из counts)',
      `<div class="ts2-diag-empty">Не найдено сервисных аккаунтов.</div>`,
      { statusPill: '0', statusKind: 'neutral' });
  }
  const groupedBySource = {};
  for (const b of bots) {
    const src = b.source || 'pattern';
    if (!groupedBySource[src]) groupedBySource[src] = [];
    groupedBySource[src].push(b);
  }
  const rows = Object.entries(groupedBySource).map(([src, list]) => `
    <div class="ts2-diag-subhead">Источник: ${esc(src)} (${list.length})</div>
    <ul class="ts2-diag-incomplete-list">
      ${list.slice(0, 30).map(b => `<li><code>${esc(b.key)}</code> — ${esc(b.label || '?')}</li>`).join('')}
    </ul>
  `).join('');
  return _diagSection('bots', 'Service-аккаунты (исключены из counts)', `
    <div class="ts2-diag-callout">
      Pattern auto-detect: cab-sa-*, sbt-*, out-*, svc-*, bot-*, system-*, и infix -api-/-bot-/-svc-.
      Если кто-то попал сюда ошибочно — снимите флаг <code>isServiceAccount</code> в карточке сотрудника.
    </div>
    ${rows}
  `, { statusPill: `${count} excl.`, statusKind: 'neutral' });
}

/**
 * V20 S8 #2 — CR-drill-down modal: список самых долгих ревью per reviewer.
 * Pилот feedback: «6ч медиана для отчёта директору. Мне нужны имена и PR».
 *
 * Сейчас у нас данные по reviewer'ам (codeReviewVelocity), но без per-PR
 * details. Показываем top-15 reviewer'ов с медианой > 8h, sorted by median desc.
 * При наличии prT.openItems — добавим конкретные PR (S9 ext).
 */
export function renderCrvDrilldownModal(crv, employees) {
  const empByKey = new Map((employees || []).map(e => [String(e.jiraAccountId || '').toLowerCase(), e]));
  const rows = Object.entries(crv || {})
    .map(([k, v]) => ({
      key: k,
      median: v.medianHours,
      count: v.count,
      threshold: v.threshold,
      label: empByKey.get(String(k).toLowerCase())?.fio || k,
    }))
    .sort((a, b) => b.median - a.median)
    .slice(0, 15);

  if (!rows.length) {
    return `
      <div class="ts2-crv-modal-overlay" id="ts2-crv-drilldown" role="presentation">
        <div class="ts2-crv-modal" role="dialog" aria-modal="true">
          <div class="ts2-resolve-header">
            <h3 class="ts2-resolve-title">Скорость код-ревью</h3>
            <button class="ts2-resolve-close" type="button" data-close-modal>✕</button>
          </div>
          <div class="ts2-resolve-body"><div class="ts2-diag-empty">Нет данных за последние 14 дней.</div></div>
        </div>
      </div>`;
  }
  const slowCount = rows.filter(r => r.threshold === 'slow').length;
  const warnCount = rows.filter(r => r.threshold === 'warn').length;
  return `
    <div class="ts2-crv-modal-overlay" id="ts2-crv-drilldown" role="presentation">
      <div class="ts2-crv-modal" role="dialog" aria-modal="true" aria-labelledby="ts2-crv-title">
        <div class="ts2-resolve-header">
          <h3 class="ts2-resolve-title" id="ts2-crv-title">Скорость код-ревью — топ-15</h3>
          <button class="ts2-resolve-close" type="button" data-close-modal>✕</button>
        </div>
        <div class="ts2-resolve-summary">
          <span class="ts2-resolve-stat ts2-resolve-stat-warn">⚠ ${slowCount} медленных (>24ч)</span>
          <span class="ts2-resolve-stat">${warnCount} средних (8-24ч)</span>
          <span class="ts2-resolve-stat-meta">14 дней · sorted by median desc</span>
        </div>
        <div class="ts2-resolve-body">
          <table class="ts2-resolve-table">
            <thead><tr><th>Ревьюер</th><th>Медиана</th><th>Ревью</th><th>Статус</th></tr></thead>
            <tbody>
              ${rows.map(r => `
                <tr class="ts2-resolve-row ts2-resolve-row-${r.threshold === 'slow' ? 'failed' : 'change'}">
                  <td class="ts2-resolve-fio">${esc(r.label)}</td>
                  <td><b>${r.median}ч</b></td>
                  <td>${r.count}</td>
                  <td>${r.threshold === 'slow' ? '🔴 медленно' : r.threshold === 'warn' ? '🟡 средне' : '🟢 ок'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="ts2-how-footnote">
            Threshold: &lt;8ч ok / 8-24ч warn / &gt;24ч slow.<br>
            Подробности по конкретным PR — в карточке сотрудника (клик по строке в дашборде).
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * V20 S8.5 #20 — Anomaly mini-chart modal. Показывает sparkline за 14 дней
 * с baseline (μ ± σ) и подсветкой today как outlier.
 *
 * @param {Array<{ts, value}>} series — daily values
 * @param {object} z — z-score результат (mean, std, today, z)
 * @param {string} metricLabel — «stop», «watch», etc.
 */
export function renderAnomalyMiniChart(series, z, metricLabel) {
  if (!Array.isArray(series) || series.length < 2) {
    return `<div class="ts2-anomaly-modal-overlay" id="ts2-anomaly-modal" role="presentation">
      <div class="ts2-anomaly-modal" role="dialog" aria-modal="true">
        <div class="ts2-resolve-header">
          <h3 class="ts2-resolve-title">Аномалия в группе «${esc(metricLabel)}»</h3>
          <button class="ts2-resolve-close" type="button" data-close-modal>✕</button>
        </div>
        <div class="ts2-resolve-body"><div class="ts2-diag-empty">Недостаточно истории для графика (нужно ≥2 точек).</div></div>
      </div>
    </div>`;
  }
  // Inline SVG sparkline: 360×80px, 14 days max.
  const W = 360, H = 80, P = 8;
  const vals = series.slice(-14);
  const minV = Math.min(...vals, z.mean - z.std);
  const maxV = Math.max(...vals, z.mean + z.std);
  const range = Math.max(1, maxV - minV);
  const xStep = (W - 2 * P) / Math.max(1, vals.length - 1);
  const yScale = (v) => H - P - ((v - minV) / range) * (H - 2 * P);
  const points = vals.map((v, i) => `${P + i * xStep},${yScale(v)}`).join(' ');
  const meanY  = yScale(z.mean);
  const upperY = yScale(z.mean + z.std);
  const lowerY = yScale(z.mean - z.std);
  const todayX = P + (vals.length - 1) * xStep;
  const todayY = yScale(z.today);

  return `<div class="ts2-anomaly-modal-overlay" id="ts2-anomaly-modal" role="presentation">
    <div class="ts2-anomaly-modal" role="dialog" aria-modal="true" aria-labelledby="ts2-anomaly-title">
      <div class="ts2-resolve-header">
        <h3 class="ts2-resolve-title" id="ts2-anomaly-title">Аномалия в группе «${esc(metricLabel)}»</h3>
        <button class="ts2-resolve-close" type="button" data-close-modal>✕</button>
      </div>
      <div class="ts2-resolve-body">
        <div class="ts2-anomaly-stats">
          <span><b>Сегодня:</b> ${z.today}</span>
          <span><b>Среднее за ${vals.length} дней:</b> ${z.mean} ± ${z.std}</span>
          <span class="ts2-anomaly-z"><b>Z-score:</b> ${z.z} ${z.anomalous ? '🔴 аномалия' : ''}</span>
        </div>
        <svg class="ts2-anomaly-chart" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" aria-label="Sparkline за 14 дней с baseline">
          <!-- baseline ±σ -->
          <rect x="${P}" y="${upperY}" width="${W - 2 * P}" height="${lowerY - upperY}" fill="rgba(100,100,100,0.07)"/>
          <line x1="${P}" y1="${meanY}" x2="${W - P}" y2="${meanY}" stroke="rgba(100,100,100,0.4)" stroke-dasharray="3,3"/>
          <!-- series polyline -->
          <polyline points="${points}" fill="none" stroke="var(--accent, #2563eb)" stroke-width="2"/>
          <!-- today marker -->
          <circle cx="${todayX}" cy="${todayY}" r="5" fill="${z.anomalous ? 'var(--danger, #dc2626)' : 'var(--accent, #2563eb)'}"/>
        </svg>
        <div class="ts2-anomaly-legend">
          Линия — daily values. Серая зона — μ ± σ (норма). Точка справа — сегодня.
          ${z.anomalous ? '<br><b>Сегодня выходит за σ-зону:</b> z=' + z.z + ', |z|>2 = аномалия.' : ''}
        </div>
      </div>
    </div>
  </div>`;
}

export function renderHowCalculatedModal() {
  const sections = HOW_SECTIONS.map(s => `
    <div class="ts2-how-section" data-section="${esc(s.id)}">
      <button class="ts2-how-section-head" type="button" aria-expanded="false">
        <span class="ts2-how-section-chev" aria-hidden="true">▸</span>
        <span class="ts2-how-section-title">${esc(s.head)}</span>
      </button>
      <div class="ts2-how-section-body">${s.body}</div>
    </div>
  `).join('');
  return `
    <div class="ts2-how-modal-overlay" id="ts2-how-modal" role="presentation">
      <div class="ts2-how-modal" role="dialog" aria-modal="true" aria-labelledby="ts2-how-title">
        <div class="ts2-how-header">
          <h3 class="ts2-how-title" id="ts2-how-title">Как считаются метрики Сканнера команд</h3>
          <button class="ts2-how-close" type="button" data-close-modal aria-label="Закрыть">✕</button>
        </div>
        <div class="ts2-how-body">
          <div class="ts2-how-intro">
            Раздел отвечает на вопрос «откуда взялась эта цифра / почему этот сотрудник в группе X».
            Кликните на заголовок секции чтобы развернуть.
          </div>
          ${sections}
          <div class="ts2-how-footnote">
            Видны странные значения? Откройте кнопку <b>📋 Диагностика</b> (появится в одном из
            следующих обновлений) — там per-PK timing и per-source raw-данные.
          </div>
        </div>
      </div>
    </div>
  `;
}
