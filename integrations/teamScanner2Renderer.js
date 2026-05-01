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

/** Product-language вместо "0 событий" — снимаем обвиняющий тон (HR-роль). */
function emptyDayLanguage(p, day) {
  // day = 'today' | 'yesterday'
  const reviewSig = (p.badges?.reviews || 0) + (p.badges?.approves || 0);
  if (reviewSig > 0)                return 'Фокус на ревью';
  if ((p.cfItems || []).length > 0) return 'Документация / комментарии';
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

  // Idle: совсем нет signal'ов. Сворачиваемая группа.
  if (today === 0 && yest === 0 && wip === 0 && stuck === 0 && prs48 === 0 && com48 === 0) {
    return 'idle';
  }
  // Stop: stuck без движения.
  if (stuck > 0 && today === 0) return 'stop';
  // Watch: триггеры.
  if (wip >= 3) return 'watch';
  if (stuck > 0 && today > 0) return 'watch';
  if (today === 0 && yest > 0) return 'watch';
  // Moving: остальное (есть today, без флагов).
  return 'moving';
}

/** Pretty-name + a11y description per group. */
const GROUP_META = {
  stop:   { label: 'Стоп',           desc: 'Висят без движения — нужен разговор сегодня' },
  watch:  { label: 'Под наблюдением', desc: 'Триггеры: перегрузка, тишина или старое тянется' },
  moving: { label: 'Движется',       desc: 'Есть активность сегодня, без красных флагов' },
  idle:   { label: 'Без активности',  desc: 'Нет следов в Jira / BB / CF' },
};

/* ── Top bar ─────────────────────────────────────────── */

export function renderTopBar(model) {
  const fetchedAt = model?.fetchedAt
    ? new Date(model.fetchedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const pkCount = (model?.projectKeys || []).length;
  return `
    <div class="ts2-topbar">
      <div class="ts2-topbar-title">
        <span class="ts2-h1">Сканнер команд 2.0</span>
        <span class="ts2-pill ts2-pill-preview" title="Превью v2.0 — v1 рядом во вкладке «📡 Сканнер команд»">v2 preview</span>
      </div>
      <div class="ts2-topbar-meta">
        <span class="ts2-meta-item">${pkCount} ${plural(pkCount, ['проект', 'проекта', 'проектов'])}</span>
        <span class="ts2-meta-sep">·</span>
        <span class="ts2-meta-item">обновлено ${esc(fetchedAt)}</span>
        <button class="ts2-btn ts2-btn-ghost" id="ts2-refresh-btn" type="button" title="Обновить данные">↻ Обновить</button>
      </div>
    </div>
  `;
}

/* ── Team glance — single-line summary ─────────────── */

export function renderTeamGlance(model) {
  const parts = model?.participants || [];
  // V18.1 P2 — counts per classified group. Дают prevailing read'у тимлида
  // за 1 секунду: «куда смотреть в первую очередь?»
  const counts = { stop: 0, watch: 0, moving: 0, idle: 0 };
  let commits48h = 0, prs48h = 0;
  for (const p of parts) {
    counts[classifyPerson(p)]++;
    commits48h += p.badges?.commits48h || 0;
    prs48h     += p.badges?.pr48h      || 0;
  }
  const segs = [];
  if (counts.moving > 0) segs.push(`<span class="ts2-glance-num">${counts.moving}</span><span class="ts2-glance-lab">движется</span>`);
  if (counts.watch  > 0) segs.push(`<span class="ts2-glance-num ts2-glance-num-watch">${counts.watch}</span><span class="ts2-glance-lab">наблюдение</span>`);
  if (counts.stop   > 0) segs.push(`<span class="ts2-glance-stuck">▌<span class="ts2-glance-num-stop">${counts.stop}</span> ${plural(counts.stop, ['стоп', 'стоп', 'стоп'])}</span>`);
  if (counts.idle   > 0) segs.push(`<span class="ts2-glance-num ts2-glance-num-muted">${counts.idle}</span><span class="ts2-glance-lab">без активности</span>`);
  const groupLine = segs.length ? segs.join(`<span class="ts2-glance-sep">·</span>`) : `<span class="ts2-glance-lab">Нет данных</span>`;
  return `
    <div class="ts2-glance">
      ${groupLine}
      <span class="ts2-glance-sep">·</span>
      <span class="ts2-glance-num">${commits48h}</span>
      <span class="ts2-glance-lab">${plural(commits48h, ['коммит', 'коммита', 'коммитов'])} (48ч)</span>
      <span class="ts2-glance-sep">·</span>
      <span class="ts2-glance-num">${prs48h}</span>
      <span class="ts2-glance-lab">PR (48ч)</span>
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
  const status = statusOfPerson(p);
  const blockerMark = status === 'blocked' ? `<span class="ts2-blocker" title="Есть задачи без активности и нет следа сегодня">▌</span>` : `<span class="ts2-blocker-spacer"></span>`;

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
  // P3 signals: switch-score → ↻N badge if non-trivial; max blocker dwell → ▌Nh
  const switches = p.contextSwitches?.switchEvents?.length || 0;
  const maxDwell = (p.blockers && p.blockers[0]?.dwellHours) || 0;
  const switchBadge = switches >= 3
    ? `<span class="ts2-badge ts2-badge-switch" title="Переключений между задачами за 72ч (gap < 30 мин)">↻${switches}</span>`
    : '';
  const dwellBadge = maxDwell >= 24
    ? `<span class="ts2-badge ts2-badge-dwell" title="Максимальный dwell-time блокера (часов в текущем статусе)">▌${maxDwell}ч</span>`
    : '';
  const badges = (switchBadge || dwellBadge)
    ? `<span class="ts2-row-badges">${dwellBadge}${switchBadge}</span>`
    : `<span class="ts2-row-badges-spacer"></span>`;

  return `
    <div class="ts2-row ${isExpanded ? 'ts2-row-expanded' : ''}" data-key="${esc(p.key)}" tabindex="0" role="button" aria-expanded="${isExpanded}">
      ${blockerMark}
      <span class="ts2-name" title="${esc(p.label)}${p.email ? ' · ' + esc(p.email) : ''}">${esc(p.label || '—')}</span>
      <span class="ts2-strip-wrap ts2-strip-wrap-today">${todayBlock}</span>
      <span class="ts2-strip-wrap ts2-strip-wrap-yest">${yestBlock}</span>
      ${badges}
      <span class="ts2-counters">
        <span class="ts2-counter" title="PR за 48ч"><span class="ts2-counter-num">${prsCount}</span><span class="ts2-counter-lab">PR</span></span>
        <span class="ts2-counter" title="Задач затронуто за 72ч"><span class="ts2-counter-num">${tasksTouchN}</span><span class="ts2-counter-lab">задач</span></span>
        <span class="ts2-counter" title="Залогировано сегодня (часов)"><span class="ts2-counter-num">${hoursToday}</span><span class="ts2-counter-lab">ч</span></span>
      </span>
      <span class="ts2-chev">${isExpanded ? '▾' : '›'}</span>
    </div>
  `;
}

/* ── Detail stub (P5 will replace with 72h side-panel) ── */

export function renderDetailStub(model, key) {
  const p = (model?.participants || []).find(x => x.key === key);
  if (!p) return '';
  const tToday = (p.timelineToday || []).length;
  const tYest  = (p.timelineYesterday || []).length;
  const tPrev  = (p.timelinePrev || []).length;
  // V18.1 P3 — Используем enriched timeline72h если есть, иначе fallback.
  const tl = (p.timeline72h && p.timeline72h.length) ? p.timeline72h : []
    .concat(p.timelineToday || [])
    .concat(p.timelineYesterday || []);
  const recent = tl.slice(0, 6).map(e => {
    const at = e?.at ? new Date(e.at).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
    const issue = e?.issue?.key ? `<strong>${esc(e.issue.key)}</strong>` : '';
    const text  = esc(e.text || e.kind || '');
    return `<li class="ts2-recent-li"><span class="ts2-recent-at">${esc(at)}</span> ${issue} <span class="ts2-recent-text">${text}</span></li>`;
  }).join('');

  // V18.1 P3 — surface новые сигналы в текстовом виде (визуальный side-panel
  // с heatmap/sparkline — P5).
  const cs = p.contextSwitches || { distinctIssueKeys: 0, switchEvents: [], switchScore: 0 };
  const blockers = Array.isArray(p.blockers) ? p.blockers : [];
  const heat = p.heatmap || { peakHour: -1, peakCount: 0, quietHours: [] };

  const blockersHtml = blockers.length
    ? `<ul class="ts2-blockers-list">
        ${blockers.slice(0, 5).map(b => `
          <li class="ts2-blockers-li">
            <span class="ts2-blockers-stripe"></span>
            <span class="ts2-blockers-key">${esc(b.key)}</span>
            <span class="ts2-blockers-status">${esc(b.status)}</span>
            <span class="ts2-blockers-dwell">${b.dwellHours}ч</span>
            <span class="ts2-blockers-summary">${esc(b.summary || '').slice(0, 80)}</span>
          </li>`).join('')}
       </ul>`
    : `<div class="ts2-detail-stub-text">Нет blocker'ов с dwell-time ≥ 24ч.</div>`;

  const peakLine = heat.peakHour >= 0 && heat.peakCount > 0
    ? `пик активности — <strong>${String(heat.peakHour).padStart(2, '0')}:00</strong> (${heat.peakCount} событий за 72ч)`
    : 'пиковая активность не выявлена';
  const switchLine = cs.switchEvents.length > 0
    ? `${cs.switchEvents.length} переключений (gap < 30 мин), ${cs.distinctIssueKeys} разных задач`
    : `${cs.distinctIssueKeys} разных задач, без частых переключений`;

  return `
    <div class="ts2-detail">
      <div class="ts2-detail-head">
        <div class="ts2-detail-title">
          <span class="ts2-detail-name">${esc(p.label || '—')}</span>
          <span class="ts2-pill ts2-pill-muted">сегодня ${tToday} · вчера ${tYest} · позавчера ${tPrev}</span>
        </div>
        <button class="ts2-btn ts2-btn-ghost" id="ts2-detail-close" type="button">закрыть</button>
      </div>

      <div class="ts2-detail-grid">
        <section class="ts2-detail-section">
          <div class="ts2-detail-section-title">Сигналы 72ч</div>
          <div class="ts2-detail-stub-text">${peakLine}</div>
          <div class="ts2-detail-stub-text">${switchLine}</div>
        </section>

        <section class="ts2-detail-section">
          <div class="ts2-detail-section-title">Blocker'ы (dwell ≥ 24ч)</div>
          ${blockersHtml}
        </section>

        <section class="ts2-detail-section ts2-detail-section-wide">
          <div class="ts2-detail-section-title">Последние события</div>
          ${recent ? `<ul class="ts2-recent">${recent}</ul>` : '<div class="ts2-detail-stub-text">Нет событий за окно 72ч.</div>'}
        </section>
      </div>

      <div class="ts2-detail-stub-footer">
        Полный 72-часовой side-panel с heatmap 72×4, sparkline и фильтрами — в P5.
      </div>
    </div>
  `;
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
  return `
    <div class="ts2-empty-state">
      <div class="ts2-empty-title">Нужны проектные ключи</div>
      <div class="ts2-empty-text">
        В настройках интеграций укажите ключи проектов Jira (поле «projectKeys») —
        Сканнер команд 2.0 опирается на тот же поток данных что и v1.
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
