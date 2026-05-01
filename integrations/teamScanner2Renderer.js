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

function statusOfPerson(p) {
  // P1 эвристика — не классификатор Движется/Под наблюдением/Стоп (это P2),
  // только blocker-маркер «есть stale issues + нет активности сегодня».
  const today  = (p.timelineToday || []).length;
  const stale  = (p.stale || []).length;
  if (stale > 0 && today === 0) return 'blocked';
  return 'normal';
}

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
  const active = parts.filter(p => (p.timelineToday?.length || 0) > 0).length;
  let commits48h = 0, prs48h = 0, blocked = 0;
  for (const p of parts) {
    commits48h += p.badges?.commits48h || 0;
    prs48h     += p.badges?.pr48h      || 0;
    if (statusOfPerson(p) === 'blocked') blocked++;
  }
  // P1: «застряли >24ч» считаем приближённо как participants со stale issues
  // и без активности сегодня. Полный age-in-status в P3.
  const stuckLine = blocked > 0
    ? `<span class="ts2-glance-stuck">▌ ${blocked} ${plural(blocked, ['застрял', 'застряли', 'застряли'])}</span>`
    : '';

  return `
    <div class="ts2-glance">
      <span class="ts2-glance-num">${active}</span>
      <span class="ts2-glance-lab">${plural(active, ['человек активен', 'человека активны', 'человек активны'])}</span>
      <span class="ts2-glance-sep">·</span>
      <span class="ts2-glance-num">${commits48h}</span>
      <span class="ts2-glance-lab">${plural(commits48h, ['коммит', 'коммита', 'коммитов'])} (48ч)</span>
      <span class="ts2-glance-sep">·</span>
      <span class="ts2-glance-num">${prs48h}</span>
      <span class="ts2-glance-lab">PR (48ч)</span>
      ${stuckLine ? `<span class="ts2-glance-sep">·</span>${stuckLine}` : ''}
    </div>
  `;
}

/* ── Per-person rows ──────────────────────────────────── */

export function renderPersonRows(model, ctx = {}) {
  const parts = model?.participants || [];
  if (!parts.length) {
    return `<div class="ts2-empty">Нет данных по участникам за выбранные проекты.</div>`;
  }
  // Sort: у кого активность сегодня — выше; внутри — по timelineToday.length desc.
  const sorted = parts.slice().sort((a, b) => {
    const aT = (a.timelineToday?.length || 0);
    const bT = (b.timelineToday?.length || 0);
    if (aT !== bT) return bT - aT;
    const aY = (a.timelineYesterday?.length || 0);
    const bY = (b.timelineYesterday?.length || 0);
    return bY - aY;
  });

  const expandedKey = ctx.expandedKey || '';
  const rows = sorted.map(p => renderRow(p, expandedKey === p.key)).join('');
  return `<div class="ts2-rows">${rows}</div>`;
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
  const tasksTouchN = new Set([...(p.timelineToday || []), ...(p.timelineYesterday || [])]
    .map(e => e?.issue?.key).filter(Boolean)).size;
  const hoursToday  = fmtHours(p.loggedTodaySec || 0);

  return `
    <div class="ts2-row ${isExpanded ? 'ts2-row-expanded' : ''}" data-key="${esc(p.key)}" tabindex="0" role="button" aria-expanded="${isExpanded}">
      ${blockerMark}
      <span class="ts2-name" title="${esc(p.label)}${p.email ? ' · ' + esc(p.email) : ''}">${esc(p.label || '—')}</span>
      <span class="ts2-strip-wrap ts2-strip-wrap-today">${todayBlock}</span>
      <span class="ts2-strip-wrap ts2-strip-wrap-yest">${yestBlock}</span>
      <span class="ts2-counters">
        <span class="ts2-counter" title="PR за 48ч"><span class="ts2-counter-num">${prsCount}</span><span class="ts2-counter-lab">PR</span></span>
        <span class="ts2-counter" title="Задач затронуто за 48ч"><span class="ts2-counter-num">${tasksTouchN}</span><span class="ts2-counter-lab">задач</span></span>
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
  // События последних 3 событий — показать как teaser для будущей панели.
  const recent = (p.timelineToday || [])
    .concat(p.timelineYesterday || [])
    .slice(0, 5)
    .map(e => {
      const at = e?.at ? new Date(e.at).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
      const issue = e?.issue?.key ? `<strong>${esc(e.issue.key)}</strong>` : '';
      const text  = esc(e.text || e.kind || '');
      return `<li class="ts2-recent-li"><span class="ts2-recent-at">${esc(at)}</span> ${issue} <span class="ts2-recent-text">${text}</span></li>`;
    }).join('');
  return `
    <div class="ts2-detail">
      <div class="ts2-detail-head">
        <div class="ts2-detail-title">
          <span class="ts2-detail-name">${esc(p.label || '—')}</span>
          <span class="ts2-pill ts2-pill-muted">сегодня ${tToday} · вчера ${tYest} · позавчера ${tPrev}</span>
        </div>
        <button class="ts2-btn ts2-btn-ghost" id="ts2-detail-close" type="button">закрыть</button>
      </div>
      <div class="ts2-detail-stub">
        <div class="ts2-detail-stub-title">72-часовая детализация — появится в P5</div>
        <div class="ts2-detail-stub-text">
          В будущей фазе здесь будет hourly heatmap 72×4 (Jira / BB / CF / Zephyr),
          sparkline загрузки в часах, фильтрованная лента событий и blockers-shelf
          с dwell-time. Пока показываем последние 5 событий как teaser:
        </div>
        ${recent ? `<ul class="ts2-recent">${recent}</ul>` : '<div class="ts2-detail-stub-text">Нет событий за окно «сегодня/вчера».</div>'}
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
