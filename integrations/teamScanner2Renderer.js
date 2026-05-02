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
function stuckListOf(p) {
  if (Array.isArray(p?.blockers) && p.blockers.length) return p.blockers;
  return p?.stale || [];
}

function statusOfPerson(p) {
  // V18.1 P1 эвристика для row-level blocker-индикатора `▌` слева.
  // P3: вместо stale используем blockers если они посчитаны (точнее).
  const today = (p?.timelineToday || []).length;
  const stuck = stuckListOf(p).length;
  if (stuck > 0 && today === 0) return 'blocked';
  return 'normal';
}

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
export function classifyPerson(p) {
  const today = (p?.timelineToday    || []).length;
  const yest  = (p?.timelineYesterday || []).length;
  const wip   = (p?.issuesNow         || []).length;
  // V18.1 P3 — stuck-сигнал теперь приходит из blockers (precise dwell-time)
  // если P3 enrichment запущен. Иначе fallback на stale (P1/P2 broad signal).
  const stuck = stuckListOf(p).length;
  const prs48 = p?.badges?.pr48h      || 0;
  const com48 = p?.badges?.commits48h || 0;
  // V18.1 P7-S1.3 — расширили idle-проверку на BB/CF/Zephyr-сигналы.
  // Без этого senior/тимлид/архитектор с активностью только в PR-ревью
  // или CF-доках попадали в idle (свёрнутая группа) — это ложь и
  // обидно. Теперь любая активность в любом источнике вытаскивает из idle.
  const reviewSig = (p?.badges?.reviews   || 0) + (p?.badges?.approves || 0);
  const cfN       = (p?.cfItems || []).length;
  const bbN       = (p?.bbItems || []).length;
  const zephyrN   = ((p?.zephyrTestsCreatedRecent  || []).length
                  +  (p?.zephyrTestsExecutedRecent || []).length);
  const anyOtherSig = reviewSig > 0 || cfN > 0 || bbN > 0 || zephyrN > 0;

  // Idle: совсем нет signal'ов нигде (Jira + BB + CF + Zephyr + reviews).
  if (today === 0 && yest === 0 && wip === 0 && stuck === 0
      && prs48 === 0 && com48 === 0 && !anyOtherSig) {
    return 'idle';
  }
  // Stop: stuck без движения.
  if (stuck > 0 && today === 0) return 'stop';
  // Watch: триггеры.
  if (wip >= 3) return 'watch';
  if (stuck > 0 && today > 0) return 'watch';
  if (today === 0 && yest > 0) return 'watch';
  // Moving: остальное — есть today ИЛИ есть other-signal (BB/CF/Zephyr/reviews).
  // Reviewer-heavy роли с 0 today, но активные в PR/CF не должны быть idle.
  return 'moving';
}

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
  const sprintGauge = sg && sg.aggregateTotal > 0 ? renderSprintGauge(sg, prevSprint) : '';
  return `
    <div class="ts2-topbar">
      <div class="ts2-topbar-title">
        <span class="ts2-h1">Сканнер команд</span>
        ${sprintGauge}
      </div>
      <div class="ts2-topbar-meta">
        <span class="ts2-meta-item">${pkCount} ${plural(pkCount, ['проект', 'проекта', 'проектов'])}</span>
        <span class="ts2-meta-sep">·</span>
        <span class="ts2-meta-item">обновлено ${esc(fetchedAt)}</span>
        ${pkCount >= 2 ? `<button class="ts2-btn ts2-btn-ghost ts2-view-toggle ${ctx.activeView === 'multi' ? 'ts2-view-toggle-active' : ''}" id="ts2-view-toggle" type="button" title="Переключить вид: одна команда / все команды">${ctx.activeView === 'multi' ? '👥 По командам' : '👥 По командам'}</button>` : ''}
        <button class="ts2-btn ts2-btn-primary" id="ts2-refresh-btn" type="button" title="Перезагрузить данные с серверов">↻ Обновить данные</button>
      </div>
    </div>
  `;
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
function renderSprintGauge(sg, prevSg) {
  const pct = sg.aggregateProgress;
  const pace = sg.aggregatePace;
  const paceLabel = PACE_LABEL[pace] || '—';
  const firstSprint = sg.sprints[0];
  const daysLeft    = firstSprint?.daysLeft;
  const daysSuffix  = (typeof daysLeft === 'number')
    ? ` · ${daysLeft} ${plural(daysLeft, ['день', 'дня', 'дней'])}`
    : '';
  // V18.1 P7-S4.2 — sprint progress delta vs previous snapshot.
  const dProgress = prevSg ? renderDelta(pct, prevSg.aggregateProgress) : '';

  // Один sprint — без перегрузки UI, оставляем legacy single-gauge.
  if (sg.sprints.length <= 1) {
    const sprintName  = firstSprint?.name ? esc(firstSprint.name) : '';
    return `
      <div class="ts2-sprint-gauge ts2-sprint-pace-${pace}" title="Sprint Goal: ${sg.aggregateDone}/${sg.aggregateTotal} done · pace: ${paceLabel}${daysSuffix}">
        <span class="ts2-sprint-label">Спринт</span>
        <span class="ts2-sprint-name">${sprintName}</span>
        <span class="ts2-sprint-bar">
          <span class="ts2-sprint-bar-fill" style="width:${Math.min(100, pct)}%"></span>
        </span>
        <span class="ts2-sprint-pct">${pct}%</span>${dProgress}
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
      <div class="ts2-sprint-gauge ts2-sprint-pace-${pace}" title="Aggregate Sprint Goal: ${sg.aggregateDone}/${sg.aggregateTotal} done · pace: ${paceLabel}${daysSuffix}">
        <span class="ts2-sprint-label">Спринты</span>
        <span class="ts2-sprint-name">${sg.sprints.length}×</span>
        <span class="ts2-sprint-bar">
          <span class="ts2-sprint-bar-fill" style="width:${Math.min(100, pct)}%"></span>
        </span>
        <span class="ts2-sprint-pct">${pct}%</span>${dProgress}
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

  const segs = [];
  if (counts.moving > 0) segs.push(`<span class="ts2-glance-num">${counts.moving}</span>${dMoving}<span class="ts2-glance-lab">движется</span>`);
  if (counts.watch  > 0) segs.push(`<span class="ts2-glance-num ts2-glance-num-watch">${counts.watch}</span>${dWatch}<span class="ts2-glance-lab">наблюдение</span>`);
  if (counts.stop   > 0) segs.push(`<span class="ts2-glance-stuck">▌<span class="ts2-glance-num-stop">${counts.stop}</span>${dStop} ${plural(counts.stop, ['стоп', 'стоп', 'стоп'])}</span>`);
  if (counts.idle   > 0) segs.push(`<span class="ts2-glance-num ts2-glance-num-muted">${counts.idle}</span><span class="ts2-glance-lab">без активности</span>`);
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

  return `
    <div class="ts2-glance">
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
    </div>
  `;
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

  const expandedKey = ctx.expandedKey || '';
  const renderGroup = (key) => {
    const arr = groups[key];
    if (!arr.length) return '';
    const meta = GROUP_META[key];
    const rows = arr.map(p => renderRow(p, expandedKey === p.key)).join('');
    const head = `
      <div class="ts2-group-head">
        <span class="ts2-group-label">${esc(meta.label)}</span>
        <span class="ts2-group-count" title="${esc(meta.desc)}">${arr.length}</span>
      </div>`;
    if (key === 'idle') {
      // Сворачиваемая, по умолчанию закрыта — снимает шум с главного экрана.
      return `
        <details class="ts2-group ts2-group-${key}">
          <summary class="ts2-group-summary">${head}</summary>
          <div class="ts2-rows-inner">${rows}</div>
        </details>`;
    }
    return `
      <div class="ts2-group ts2-group-${key}">
        ${head}
        <div class="ts2-rows-inner">${rows}</div>
      </div>`;
  };

  // Порядок групп = приоритет внимания тимлида утром.
  return `
    <div class="ts2-rows">
      ${renderGroup('stop')}
      ${renderGroup('watch')}
      ${renderGroup('moving')}
      ${renderGroup('idle')}
    </div>
  `;
}

function renderRow(p, isExpanded) {
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
  const badges = (switchBadge || dwellBadge)
    ? `<span class="ts2-row-badges">${dwellBadge}${switchBadge}</span>`
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
  return `
    <div class="ts2-panel" id="ts2-panel-main" role="dialog" aria-modal="true"
         aria-labelledby="ts2-panel-title" tabindex="-1">
      ${renderPanelHeader(p, tToday, tYest, tPrev)}
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

function renderPanelHeader(p, tToday, tYest, tPrev) {
  const emailFull = p.email || '';
  const emailMasked = maskEmail(emailFull);
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
      </div>
      <div class="ts2-panel-head-actions">
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

export function renderEmpty() {
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
