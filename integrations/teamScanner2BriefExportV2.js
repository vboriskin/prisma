'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — BRIEF EXPORT v2.0
   --
   Decision artefact, не «PDF-дамп интерактивного экрана».
   Inverted pyramid: TL;DR → KPI band → attention/блокеры → roster.

   Реализация рекомендаций экспертной панели (workflow
   brief-html-utility-audit от 2026-06-01, 6 экспертов + синтез):
     · Executive TL;DR с auto-attention queue (buildActionQueue)
     · Status sentence + Spine-pill курса (sprintConfidence)
     · Diff-vs-yesterday (buildYesterdayDigest)
     · Блокеры наверх — не в детали
     · Team KPI band (6 ячеек)
     · Idle/Stop отдельной секцией
     · PR review queue из CRV
     · Roster с дельта-стрелками, bullet-charts vs team median,
       чек-боксами «разрулил» (state в localStorage + URL hash)
     · Detail в inverted pyramid: status line → WIP → events
       collapsed → heatmap collapsed
     · Brand: звезда + wordmark, signal-цвета только для курса
     · Audience-mode (TL/Exec/HR/Direct) через CSS-классы видимости
     · Anonymize toggle (Engineer N от sorted email)
     · Copy markdown для TG/Slack (composeDailyBriefMarkdown)
     · Кнопка «Распечатать» + @media print с разворотом details
     · Snapshot age badge (JS пересчёт) + metadata-блок с источниками
     · Footer с тимлид-подписью и disclaimer о misuse
   ============================================================ */

import { renderEmployeeDetailPanel } from './teamScanner2Renderer.js';
import { renderPersonRows } from './teamScanner2RendererPersonRows.js';
import { classifyPerson } from './teamScanner2Classifier.js';
import {
  buildActionQueue, buildYesterdayDigest, composeDailyBriefMarkdown,
  computeSprintConfidence, computeTeamHealthScore, computeBlockerMTTR,
  buildCrossTeamDeps, computeCrQueueDepth, computePrCycleTime,
  buildYesterdayGroupMap, composePersonNarrative,
} from './teamScanner2Insights.js';
import { computeSprintGoalSlope } from './teamScanner2Enrichment.js';
import { loadHistory } from './teamScanner2History.js';
import { emit as telemetryEmit } from './telemetry.js';
import { loadSettings } from './integrationsStore.js';

const ALL_SRC_FILTERS = { j: true, b: true, c: true, zc: true, ze: true };

const CSS_KEEP_TOKENS = [
  'ts2-', 'pz-', 'pp-', 'briefv2-', 'brief-', 'btn-icon',
  '.ts2', '.pz', '.pp', '.brief',
];

const PRIZMA_STAR_SVG = `<svg class="briefv2-star" viewBox="0 0 120 120" role="img" aria-label="Призма">
  <g transform="translate(60,60)" fill="currentColor">
    <polygon points="0,-50 4,-4 0,0 -4,-4"/>
    <polygon points="0,50 4,4 0,0 -4,4"/>
    <polygon points="-50,0 -4,-4 0,0 -4,4" opacity="0.7"/>
    <polygon points="50,0 4,-4 0,0 4,4" opacity="0.7"/>
    <polygon points="-32,-32 -3,-5 0,0 -5,-3" opacity="0.45"/>
    <polygon points="32,-32 3,-5 0,0 5,-3" opacity="0.45"/>
    <polygon points="-32,32 -3,5 0,0 -5,3" opacity="0.45"/>
    <polygon points="32,32 3,5 0,0 5,3" opacity="0.45"/>
    <circle r="4"/>
  </g>
</svg>`;

/**
 * Основная точка входа v2. Sync — мгновенный экспорт без LLM.
 *
 * @param {object} model — pulse-model (с participants, scannerV2, spaces)
 * @param {object} [opts]
 * @param {string} [opts.teamLabel]
 * @param {object} [opts.context] — { history, prev, employees, settings, userEmail }
 */
export function exportTeamBriefV2(model, opts = {}) {
  if (!model || !Array.isArray(model.participants) || model.participants.length === 0) {
    throw new Error('Нет данных для выгрузки — сначала обновите Сканнер.');
  }
  const teamLabel = opts.teamLabel || (model.projectKeys || []).join(', ') || 'команда';
  const generatedAt = new Date();
  const ctx = _buildContext(model, opts);
  // Карта pre-rendered HTML «Сводка ассистента» для каждого сотрудника.
  // Передаётся вызывающим кодом после параллельных LLM-вызовов.
  // Если ключ отсутствует — рисуется «Сводка недоступна».
  const assistantByKey = opts.assistantByKey instanceof Map
    ? opts.assistantByKey
    : new Map();

  const dateStr = generatedAt.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const peopleN = model.participants.length;
  const headerHtml = `
    <header class="briefv2-header briefv2-header-slim">
      <div class="briefv2-header-row">
        <h1 class="briefv2-title">Бриф · ${_esc(teamLabel)}</h1>
        <button class="briefv2-theme-toggle" id="briefv2-theme-toggle" type="button" title="Переключить тему">Тема</button>
      </div>
      <div class="briefv2-meta-line">
        <span>${_esc(dateStr)}</span>
        <span> · </span>
        <span>${peopleN} ${_plural(peopleN, ['сотрудник','сотрудника','сотрудников'])}</span>
      </div>
    </header>`;

  const rosterHtml = _buildSlimRoster(model, ctx, assistantByKey);

  const bodyHtml = `
    <div class="briefv2-shell ts2-root">
      ${headerHtml}
      <main class="briefv2-main">
        <section class="briefv2-roster briefv2-roster-slim" aria-label="Сотрудники">
          ${rosterHtml}
        </section>
      </main>
    </div>
  `;

  const css = _collectScopedCss();
  const documentHtml = _assembleHtmlDocument({
    title: `Бриф команды ${teamLabel}`,
    css,
    bodyHtml,
    inlineJs: _briefInlineJsSlim(),
  });
  const filename = `team-brief-v2-${_slug(teamLabel)}-${_dateStamp(generatedAt)}.html`;
  _downloadFile(documentHtml, filename);
  try {
    telemetryEmit('scanner2.brief_export_v2', {
      teamLabel,
      peopleCount: peopleN,
      sizeBytes: documentHtml.length,
      assistantCount: assistantByKey.size,
    });
  } catch (_) { /* best effort */ }
}

/* ── Slim roster (2026-06-03 redesign) ─────────────────────
   Только список ФИО → раскрывашка. Внутри:
   Сегодня · Вчера · События 72ч · Активность по источникам · Сводка ассистента.
*/

function _buildSlimRoster(model, ctx, assistantByKey) {
  const blocks = [];
  for (const p of model.participants) {
    blocks.push(_buildSlimPersonBlock(p, model, ctx, assistantByKey.get(p.key)));
  }
  return blocks.join('');
}

function _buildSlimPersonBlock(p, model, ctx, assistantHtml) {
  const name = _esc(p.label || p.key);
  // 2026-06-04 — используем рендереры основного приложения 1-в-1
  // (renderPersonNarrative для Сегодня/Вчера, renderEventsFeed для 72ч,
  //  renderHeatmap72x4 для активности по источникам). Извлекаем нужные
  //  секции через DOMParser из полной панели + стрипаем интерактивные
  //  controls (кнопки копирования, фильтры — они не работают в standalone).
  const extracted = _extractPanelSections(p, model);
  const narrativeSection = extracted.narrative;       // Сегодня: / Вчера: / Confluence: …
  const eventsSection    = extracted.events;          // События за 72 часа
  const heatmapSection   = extracted.heatmap;         // Heatmap 72×4
  const assistantSection = `
    <section class="briefv2-section briefv2-assistant">
      <h3 class="briefv2-section-title">Сводка ассистента</h3>
      <div class="briefv2-assistant-mount">
        ${assistantHtml || `<div class="ts2-assistant-error">Сводка недоступна — LLM не ответил или не настроен.</div>`}
      </div>
    </section>`;

  return `
    <article class="briefv2-person" data-key="${_esc(p.key)}">
      <button class="briefv2-person-row" type="button" data-toggle-person="${_esc(p.key)}" aria-expanded="false">
        <span class="briefv2-person-name">${name}</span>
        <span class="briefv2-person-chev" aria-hidden="true">▾</span>
      </button>
      <div class="briefv2-person-detail" hidden>
        ${narrativeSection}
        ${eventsSection}
        ${heatmapSection}
        ${assistantSection}
      </div>
    </article>`;
}

/**
 * Извлекает HTML секций narrative / events / heatmap из renderEmployeeDetailPanel.
 * Возвращает { narrative, events, heatmap } — каждая = готовая HTML-секция (или fallback).
 * Стрипает interactive (copy-buttons, filters, retry-buttons) — они не работают в standalone HTML.
 */
function _extractPanelSections(p, model) {
  const fallback = { narrative: '', events: '', heatmap: '' };
  if (typeof DOMParser === 'undefined') return fallback;
  try {
    const full = renderEmployeeDetailPanel({ participants: [p], ...model, spaces: model?.spaces, scannerV2: model?.scannerV2 }, p.key, { filters: { j: true, b: true, c: true, zc: true, ze: true } });
    const doc = new DOMParser().parseFromString(`<!DOCTYPE html><body>${full}</body>`, 'text/html');

    // Narrative section: ts2-narrative-section
    let narrativeNode = doc.querySelector('.ts2-narrative-section');
    if (narrativeNode) {
      // Удаляем интерактивные controls
      narrativeNode.querySelectorAll('.ts2-narrative-copy, .ts2-narrative-stale').forEach(n => n.remove());
    }

    // Events section: ts2-events-section (details — раскрываем по умолчанию через open)
    let eventsNode = doc.querySelector('.ts2-events-section');
    if (eventsNode) {
      eventsNode.setAttribute('open', '');
      eventsNode.querySelectorAll('button, .ts2-narrative-copy').forEach(n => n.remove());
    }

    // Heatmap section: первая .ts2-panel-section с заголовком «Heatmap»
    let heatNode = null;
    const sections = Array.from(doc.querySelectorAll('.ts2-panel-section'));
    for (const s of sections) {
      const title = s.querySelector('.ts2-panel-section-title');
      if (title && /Heatmap/i.test(title.textContent || '')) { heatNode = s; break; }
    }
    if (heatNode) {
      heatNode.querySelectorAll('button').forEach(n => n.remove());
    }

    return {
      narrative: narrativeNode
        ? `<section class="briefv2-section">${narrativeNode.outerHTML}</section>`
        : `<section class="briefv2-section"><h3 class="briefv2-section-title">Сводка</h3><div class="briefv2-empty">Нет нарратива.</div></section>`,
      events: eventsNode
        ? `<section class="briefv2-section briefv2-events-wrap">${eventsNode.outerHTML}</section>`
        : `<section class="briefv2-section"><h3 class="briefv2-section-title">События за 72 часа</h3><div class="briefv2-empty">Нет событий.</div></section>`,
      heatmap: heatNode
        ? `<section class="briefv2-section briefv2-heatmap-wrap"><h3 class="briefv2-section-title">Активность по источникам</h3>${heatNode.outerHTML}</section>`
        : `<section class="briefv2-section"><h3 class="briefv2-section-title">Активность по источникам</h3><div class="briefv2-empty">Heatmap недоступен.</div></section>`,
    };
  } catch (e) {
    try { console.warn('[briefv2] extract panel sections failed:', e); } catch (_) {}
    return fallback;
  }
}

/** Slim inline JS — только theme toggle + person expand. */
function _briefInlineJsSlim() {
  return `
    (function(){
      'use strict';
      // Theme toggle: dark ↔ light на <html data-theme>, чтобы глобальные
      // [data-theme] селекторы из основного приложения корректно работали.
      var htmlEl = document.documentElement;
      var THEME_KEY = 'briefv2.theme';
      try {
        var saved = localStorage.getItem(THEME_KEY);
        if (saved === 'light' || saved === 'dark') htmlEl.setAttribute('data-theme', saved);
      } catch (_) {}
      var ttBtn = document.getElementById('briefv2-theme-toggle');
      if (ttBtn) ttBtn.addEventListener('click', function(){
        var cur = htmlEl.getAttribute('data-theme') || 'light';
        var next = cur === 'dark' ? 'light' : 'dark';
        htmlEl.setAttribute('data-theme', next);
        try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
      });
      // Person toggles
      document.querySelectorAll('[data-toggle-person]').forEach(function(btn){
        btn.addEventListener('click', function(){
          var article = btn.closest('.briefv2-person');
          if (!article) return;
          var detail = article.querySelector('.briefv2-person-detail');
          if (!detail) return;
          var open = !detail.hidden;
          detail.hidden = open;
          btn.setAttribute('aria-expanded', String(!open));
          article.classList.toggle('is-open', !open);
        });
      });
    })();
  `;
}

/* ── Context bundle: history, prev snapshot, settings, etc ─── */

function _buildContext(model, opts) {
  const ctx = opts.context || {};
  const projectKeys = (model.projectKeys || []).slice();
  let history = [];
  try { history = ctx.history || loadHistory(projectKeys, 14) || []; } catch (_) {}
  let settings = {};
  try { settings = ctx.settings || loadSettings() || {}; } catch (_) {}
  const employees = ctx.employees || [];
  const userEmail = ctx.userEmail || settings.lastUserEmail || '';
  const prev = ctx.prev || (history.length ? history[history.length - 1] : null);
  const yesterdayGroups = (() => {
    try { return buildYesterdayGroupMap(prev); } catch (_) { return new Map(); }
  })();
  let sprintGoalSlope = null;
  try { if (history.length >= 3) sprintGoalSlope = computeSprintGoalSlope(history); } catch (_) {}
  let actionQueue = [];
  try { actionQueue = buildActionQueue(model) || []; } catch (_) {}
  let yesterdayDigest = null;
  try { yesterdayDigest = buildYesterdayDigest(model, history); } catch (_) {}
  let sprintConfidence = null;
  try { sprintConfidence = computeSprintConfidence(model); } catch (_) {}
  let teamHealth = null;
  try { teamHealth = computeTeamHealthScore(model, history); } catch (_) {}
  let blockerMttr = null;
  try { blockerMttr = computeBlockerMTTR(model); } catch (_) {}
  let crossTeam = null;
  try { crossTeam = buildCrossTeamDeps(model); } catch (_) {}
  let crQueue = [];
  try { crQueue = computeCrQueueDepth(model) || []; } catch (_) {}
  let prCycle = null;
  try { prCycle = computePrCycleTime(model); } catch (_) {}
  return {
    history, prev, yesterdayGroups, sprintGoalSlope,
    actionQueue, yesterdayDigest, sprintConfidence, teamHealth, blockerMttr,
    crossTeam, crQueue, prCycle,
    settings, employees, userEmail,
    fetchedAtMs: model._fetchedAtMs || Date.now(),
  };
}

/* ── Header: brand + age badge + metadata ───────────────────── */

function _buildHeader(model, teamLabel, generatedAt, ctx) {
  const settings = ctx.settings;
  const projectKeys = (model.projectKeys || []).join(', ');
  const sourceLines = [
    settings.jiraBaseUrl ? `Jira: ${_hostFromUrl(settings.jiraBaseUrl)}` : null,
    settings.bitbucketBaseUrl ? `Bitbucket: ${_hostFromUrl(settings.bitbucketBaseUrl)}` : null,
    settings.confluenceBaseUrl ? `Confluence: ${_hostFromUrl(settings.confluenceBaseUrl)}` : null,
  ].filter(Boolean).join(' · ');
  const tlEmail = ctx.userEmail || '';
  return `
    <header class="briefv2-header" role="banner">
      <div class="briefv2-brand">
        <span class="briefv2-brand-mark" aria-hidden="true">${PRIZMA_STAR_SVG}</span>
        <span class="briefv2-brand-text">
          <span class="briefv2-brand-wordmark">ПРИЗМА</span>
          <span class="briefv2-brand-sub">Сканнер команд · Бриф</span>
        </span>
      </div>
      <h1 class="briefv2-title">Бриф команды ${_esc(teamLabel)}</h1>
      <div class="briefv2-header-meta">
        <span class="briefv2-age-pill" id="briefv2-age-pill" data-snapshot-ts="${_esc(ctx.fetchedAtMs)}">
          Снимок: <span class="briefv2-age-rel">проверяю…</span>
        </span>
        <span class="briefv2-header-sep">·</span>
        <span class="briefv2-meta-line">${_esc(_formatDate(generatedAt))}</span>
        <span class="briefv2-header-sep">·</span>
        <span class="briefv2-meta-line"><strong>${model.participants.length}</strong> ${_plural(model.participants.length, ['сотрудник','сотрудника','сотрудников'])}</span>
      </div>
      <details class="briefv2-meta-details">
        <summary class="briefv2-meta-summary">О снимке</summary>
        <dl class="briefv2-meta-dl">
          <dt>Команда</dt><dd>${_esc(teamLabel)}</dd>
          <dt>Project keys</dt><dd>${_esc(projectKeys || '—')}</dd>
          <dt>Период данных</dt><dd>72 часа до момента снимка</dd>
          <dt>Снимок сгенерирован</dt><dd>${_esc(_formatDate(generatedAt))}${tlEmail ? ` · ${_esc(tlEmail)}` : ''}</dd>
          <dt>Источники</dt><dd>${_esc(sourceLines || 'не настроены')}</dd>
        </dl>
      </details>
    </header>
  `;
}

/* ── Toolbar ────────────────────────────────────────────────── */

function _buildToolbar() {
  return `
    <div class="briefv2-toolbar" role="toolbar" aria-label="Управление брифом">
      <input type="search" id="briefv2-search" class="briefv2-search" placeholder="Поиск по имени" autocomplete="off" aria-label="Поиск сотрудника">
      <button type="button" class="briefv2-btn" id="briefv2-expand-all">Развернуть всё</button>
      <button type="button" class="briefv2-btn" id="briefv2-collapse-all">Свернуть всё</button>
      <span class="briefv2-toolbar-sep" aria-hidden="true"></span>
      <label class="briefv2-select-wrap" title="Выбрать режим аудитории">
        <span class="briefv2-select-label">Режим:</span>
        <select id="briefv2-audience" class="briefv2-select">
          <option value="lead">Тимлид</option>
          <option value="exec">Руководитель</option>
          <option value="hr">HR (без имён)</option>
          <option value="share">Поделиться</option>
        </select>
      </label>
      <label class="briefv2-check-wrap" title="Скрыть имена сотрудников">
        <input type="checkbox" id="briefv2-anonymize">
        <span>Анонимизация</span>
      </label>
      <div class="briefv2-toolbar-spacer"></div>
      <button type="button" class="briefv2-btn" id="briefv2-copy-md" title="Скопировать сводку в формате markdown для TG/Slack">Копировать для чата</button>
      <button type="button" class="briefv2-btn" id="briefv2-print" title="Распечатать или сохранить как PDF">Распечатать</button>
      <button type="button" class="briefv2-btn briefv2-theme-btn" id="briefv2-theme-toggle" aria-label="Переключить тему">
        <span class="briefv2-theme-icon" aria-hidden="true">☾</span><span class="briefv2-theme-label"> Тёмная</span>
      </button>
    </div>
  `;
}

/* ── Status sentence (Spine-pill курса) ─────────────────────── */

function _buildStatusSentence(model, ctx) {
  const sg = model?.scannerV2?.sprintGoal;
  const sprintInfo = sg?.sprints?.[0];
  const dayN = sprintInfo?.daysTotal || null;
  const daysLeft = (typeof sprintInfo?.daysLeft === 'number') ? sprintInfo.daysLeft : null;
  const dayCur = (dayN && daysLeft != null) ? Math.max(1, dayN - daysLeft) : null;
  const pace = sg?.aggregatePace || 'no-data';
  const courseLabel = pace === 'ahead' ? 'Опережение курса'
                   : pace === 'on-track' ? 'Идём по курсу'
                   : pace === 'behind' ? 'Дрейф от курса'
                   : 'Курс не задан';
  const courseTone = pace === 'ahead' ? 'on-course'
                   : pace === 'on-track' ? 'on-course'
                   : pace === 'behind' ? 'off-course'
                   : 'neutral';
  const done = sg?.aggregateDone || 0;
  const total = sg?.aggregateTotal || 0;
  const progressPct = sg?.aggregateProgress || 0;
  // Ideal % к этому дню — для «отстаём на N задач».
  let lagText = '';
  if (dayN && dayCur && total > 0) {
    const idealPct = Math.round((dayCur / dayN) * 100);
    const idealDone = Math.round((dayCur / dayN) * total);
    const lag = idealDone - done;
    if (lag > 0) lagText = ` · отстаём на ${lag} ${_plural(lag, ['задачу','задачи','задач'])}`;
    else if (lag < 0) lagText = ` · впереди на ${Math.abs(lag)} ${_plural(Math.abs(lag), ['задачу','задачи','задач'])}`;
    else lagText = ' · ровно по плану';
    void idealPct;
  }
  const dayLabel = (dayCur && dayN) ? `день ${dayCur} из ${dayN}` : (typeof daysLeft === 'number' ? `${daysLeft} ${_plural(daysLeft, ['день','дня','дней'])} до конца спринта` : 'спринт не настроен');
  return `
    <div class="briefv2-status briefv2-course-${courseTone}">
      <span class="briefv2-status-pill briefv2-course-pill briefv2-course-${courseTone}" title="Темп спринта по issue-weighted прогрессу">
        ${_esc(courseLabel)}
      </span>
      <span class="briefv2-status-text">
        ${total > 0 ? `<strong>${done}/${total}</strong> закрыто (${progressPct}%) · ` : ''}${_esc(dayLabel)}${_esc(lagText)}
      </span>
    </div>
  `;
}

/* ── Diff line (yesterday digest) ───────────────────────────── */

function _buildDiffLine(model, ctx) {
  const dig = ctx.yesterdayDigest;
  if (!dig || (typeof dig.summary !== 'string' && !dig.closedCount && !dig.startedCount && !dig.newBlockerCount)) {
    return `
      <div class="briefv2-diff" role="status">
        <span class="briefv2-diff-label">Со вчера:</span>
        <span class="briefv2-diff-text briefv2-diff-text-empty">нет ночных изменений или нет предыдущего снимка</span>
      </div>
    `;
  }
  const parts = [];
  if (typeof dig.closedCount === 'number' && dig.closedCount > 0)
    parts.push(`<strong>+${dig.closedCount}</strong> в Done`);
  if (typeof dig.startedCount === 'number' && dig.startedCount > 0)
    parts.push(`<strong>+${dig.startedCount}</strong> взято в работу`);
  if (typeof dig.newBlockerCount === 'number' && dig.newBlockerCount > 0)
    parts.push(`<strong>+${dig.newBlockerCount}</strong> ${_plural(dig.newBlockerCount, ['новый блокер','новых блокера','новых блокеров'])}`);
  const inner = parts.length ? parts.join(' · ') : _esc(String(dig.summary || ''));
  return `
    <div class="briefv2-diff" role="status">
      <span class="briefv2-diff-label">Со вчера:</span>
      <span class="briefv2-diff-text">${inner}</span>
    </div>
  `;
}

/* ── Attention Required (auto-attention queue) ──────────────── */

function _buildAttentionQueue(model, ctx) {
  const queue = (ctx.actionQueue || []).slice(0, 5);
  if (!queue.length) {
    return `
      <section class="briefv2-attention briefv2-attention-empty" aria-label="Внимание">
        <h2 class="briefv2-section-title">Требует внимания сегодня</h2>
        <p class="briefv2-attention-msg">Чисто, рисков на радарах нет.</p>
      </section>
    `;
  }
  const items = queue.map((it, idx) => {
    const sev = it.severity === 'high' ? 'high' : it.severity === 'medium' ? 'medium' : 'low';
    const action = _esc(it.action || '');
    const reason = _esc(it.reason || '');
    const label = _esc(it.label || '');
    const anchor = it.key ? `#person-${_anchorId(it.key)}` : null;
    return `
      <li class="briefv2-attention-item briefv2-sev-${sev}">
        <input type="checkbox" class="briefv2-done" data-done-id="att-${idx}" aria-label="Отметить как разрулил">
        <div class="briefv2-attention-body">
          <div class="briefv2-attention-head">
            <span class="briefv2-attention-name" data-real-name="${label}">${label}</span>
            ${anchor ? `<a class="briefv2-anchor" href="${anchor}">в карточку →</a>` : ''}
          </div>
          <div class="briefv2-attention-reason">${reason}</div>
          ${action ? `<div class="briefv2-attention-action"><span class="briefv2-action-lab">→ </span>${action}</div>` : ''}
        </div>
      </li>
    `;
  }).join('');
  return `
    <section class="briefv2-attention" aria-label="Внимание">
      <h2 class="briefv2-section-title">Требует внимания сегодня <span class="briefv2-section-count">${queue.length}</span></h2>
      <ul class="briefv2-attention-list">${items}</ul>
    </section>
  `;
}

/* ── Блокеры наверх ─────────────────────────────────────────── */

function _buildBlockersSection(model, ctx) {
  // Собираем уникальные блокеры по всем сотрудникам, сортируем по dwellHours.
  const seen = new Set();
  const blockers = [];
  for (const p of (model.participants || [])) {
    for (const b of (p.blockers || [])) {
      if (!b?.key || seen.has(b.key)) continue;
      seen.add(b.key);
      blockers.push({ ...b, owner: p.label || p.key, ownerKey: p.key });
    }
  }
  blockers.sort((a, b) => (b.dwellHours || 0) - (a.dwellHours || 0));
  if (!blockers.length) {
    return `
      <section class="briefv2-blockers briefv2-blockers-empty" aria-label="Блокеры">
        <h2 class="briefv2-section-title">Блокеры</h2>
        <p class="briefv2-blockers-msg">Активных блокеров нет.</p>
      </section>
    `;
  }
  const top = blockers.slice(0, 6);
  const settings = ctx.settings || {};
  const jiraBase = settings.jiraBaseUrl ? String(settings.jiraBaseUrl).replace(/\/+$/, '') : '';
  const items = top.map((b, i) => {
    const dwellH = Number(b.dwellHours) || 0;
    const isHot = dwellH >= 48;
    const dwellStr = dwellH >= 24 ? `${Math.floor(dwellH / 24)}д ${dwellH % 24}ч` : `${dwellH}ч`;
    const link = jiraBase && b.key ? `${jiraBase}/browse/${encodeURIComponent(b.key)}` : null;
    const keyHtml = link
      ? `<a class="briefv2-blocker-key" href="${_esc(link)}" target="_blank" rel="noopener noreferrer">${_esc(b.key)}</a>`
      : `<span class="briefv2-blocker-key">${_esc(b.key)}</span>`;
    return `
      <li class="briefv2-blocker-item ${isHot ? 'briefv2-blocker-hot' : ''}">
        <input type="checkbox" class="briefv2-done" data-done-id="block-${i}-${_esc(b.key)}" aria-label="Отметить как разрулил">
        ${keyHtml}
        <span class="briefv2-blocker-summary">${_esc(_truncate(b.summary || '', 80))}</span>
        <span class="briefv2-blocker-status">${_esc(b.status || '')}</span>
        <span class="briefv2-blocker-dwell">▌${_esc(dwellStr)}</span>
        <span class="briefv2-blocker-owner" data-real-name="${_esc(b.owner)}">${_esc(b.owner)}</span>
      </li>
    `;
  }).join('');
  return `
    <section class="briefv2-blockers" aria-label="Блокеры">
      <h2 class="briefv2-section-title">Блокеры <span class="briefv2-section-count">${blockers.length}</span></h2>
      <ul class="briefv2-blockers-list">${items}</ul>
      ${blockers.length > top.length ? `<div class="briefv2-blockers-rest">+${blockers.length - top.length} остальных в карточках сотрудников.</div>` : ''}
    </section>
  `;
}

/* ── Team KPI band ──────────────────────────────────────────── */

function _buildKPIBand(model, ctx) {
  const sg = model?.scannerV2?.sprintGoal;
  const conf = ctx.sprintConfidence;
  const health = ctx.teamHealth;
  const mttr = ctx.blockerMttr;
  const crossTeam = ctx.crossTeam;
  const prCycle = ctx.prCycle;
  const prT = model?.scannerV2?.prThroughput || {};
  let prOpened = 0, prMerged = 0;
  for (const k of Object.keys(prT)) {
    prOpened += prT[k].opened || 0;
    prMerged += prT[k].merged || 0;
  }
  const prRate = prOpened > 0 ? Math.round(prMerged / prOpened * 100) : null;
  const cells = [
    {
      label: 'Спринт',
      value: sg?.aggregateTotal ? `${sg.aggregateDone}/${sg.aggregateTotal}` : '—',
      sub:   sg?.aggregateTotal ? `${sg.aggregateProgress}%` : 'нет данных',
      tone:  _paceTone(sg?.aggregatePace),
    },
    {
      label: 'Уверенность',
      value: (conf && typeof conf.confidence === 'number') ? `${conf.confidence}%` : '—',
      sub:   conf?.rSquared != null ? `R² ${conf.rSquared}` : 'нет данных',
      tone:  conf?.confidence >= 70 ? 'on-course' : conf?.confidence >= 50 ? 'drift' : conf?.confidence != null ? 'off-course' : 'neutral',
    },
    {
      label: 'PR за неделю',
      value: prRate != null ? `${prRate}%` : '—',
      sub:   prOpened > 0 ? `${prMerged}/${prOpened} merged` : 'нет данных',
      tone:  prRate == null ? 'neutral' : prRate >= 70 ? 'on-course' : prRate >= 40 ? 'drift' : 'off-course',
    },
    {
      label: 'Блокеры',
      value: (mttr && typeof mttr.mttrHours === 'number') ? `${Math.round(mttr.mttrHours)}ч` : '—',
      sub:   mttr ? `${mttr.openCount || mttr.count || 0} активных` : 'нет данных',
      tone:  mttr?.mttrHours == null ? 'neutral' : mttr.mttrHours <= 24 ? 'on-course' : mttr.mttrHours <= 72 ? 'drift' : 'off-course',
    },
    {
      label: 'PR cycle',
      value: prCycle?.p50Hours != null ? `${Math.round(prCycle.p50Hours)}ч` : '—',
      sub:   prCycle?.count > 0 ? `P90 ${Math.round(prCycle.p90Hours)}ч · N=${prCycle.count}` : 'нет данных',
      tone:  'neutral',
    },
    {
      label: 'Cross-team',
      value: crossTeam ? String((crossTeam.incoming || []).reduce((s, x) => s + (x.count || 0), 0) + (crossTeam.outgoing || []).reduce((s, x) => s + (x.count || 0), 0)) : '—',
      sub:   crossTeam ? 'зависимостей' : 'нет данных',
      tone:  'neutral',
    },
    {
      label: 'Здоровье',
      value: (health && typeof health.score === 'number') ? `${health.score}/100` : '—',
      sub:   health?.components ? `${health.components.length} метрик` : 'нет данных',
      tone:  health?.score == null ? 'neutral' : health.score >= 75 ? 'on-course' : health.score >= 50 ? 'drift' : 'off-course',
    },
  ];
  return `
    <section class="briefv2-kpi" aria-label="KPI команды">
      <h2 class="briefv2-section-title">Курс команды</h2>
      <div class="briefv2-kpi-grid">
        ${cells.map(c => `
          <div class="briefv2-kpi-cell briefv2-tone-${c.tone}">
            <div class="briefv2-kpi-label">${_esc(c.label)}</div>
            <div class="briefv2-kpi-value">${_esc(c.value)}</div>
            <div class="briefv2-kpi-sub">${_esc(c.sub)}</div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

/* ── Idle/Stop секция ───────────────────────────────────────── */

function _buildIdleSection(model, ctx) {
  const idle = (model.participants || []).filter(p => classifyPerson(p) === 'idle');
  if (!idle.length) return '';
  const items = idle.slice(0, 12).map(p => {
    const narr = (() => { try { return composePersonNarrative(p); } catch (_) { return null; } })();
    const hypothesis = narr?.hypothesis || '';
    const lastEvent = _findLastActivityAt(p);
    return `
      <li class="briefv2-idle-item">
        <span class="briefv2-idle-name" data-real-name="${_esc(p.label || p.key)}">${_esc(p.label || p.key)}</span>
        ${lastEvent ? `<span class="briefv2-idle-last">последняя активность: ${_esc(lastEvent)}</span>` : `<span class="briefv2-idle-last">нет следов за 72ч</span>`}
        ${hypothesis ? `<span class="briefv2-idle-hyp">${_esc(hypothesis)}</span>` : ''}
        <a class="briefv2-anchor" href="#person-${_anchorId(p.key)}">в карточку →</a>
      </li>
    `;
  }).join('');
  return `
    <section class="briefv2-idle" aria-label="Без активности">
      <details>
        <summary class="briefv2-section-title">
          Нет активности 48ч+ <span class="briefv2-section-count">${idle.length}</span>
        </summary>
        <ul class="briefv2-idle-list">${items}</ul>
      </details>
    </section>
  `;
}

function _findLastActivityAt(p) {
  let lastIso = '';
  const pools = [p.timelineToday, p.timelineYesterday, p.timelinePrev, p.bbItems, p.cfItems];
  for (const arr of pools) {
    for (const e of (arr || [])) {
      const ts = e?.at || e?.created || '';
      if (ts && ts > lastIso) lastIso = ts;
    }
  }
  if (!lastIso) return '';
  try {
    const d = new Date(lastIso);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch (_) { return ''; }
}

/* ── PR review queue ───────────────────────────────────────── */

function _buildPRReviewQueue(model, ctx) {
  const queue = ctx.crQueue || [];
  if (!queue.length) return '';
  const rows = queue.slice(0, 5).map(r => `
    <li class="briefv2-prq-item briefv2-prq-${r.flag || 'ok'}">
      <span class="briefv2-prq-name" data-real-name="${_esc(r.label || r.key)}">${_esc(r.label || r.key)}</span>
      <span class="briefv2-prq-count"><strong>${r.openPrCount || 0}</strong> PR ждут</span>
      ${r.flag ? `<span class="briefv2-prq-flag">${_esc(r.flag === 'overload' ? 'перегрузка' : r.flag === 'warn' ? 'граница' : 'норма')}</span>` : ''}
    </li>
  `).join('');
  return `
    <section class="briefv2-prqueue" aria-label="Очередь ревью">
      <h2 class="briefv2-section-title">Очередь к ревьюерам</h2>
      <ul class="briefv2-prq-list">${rows}</ul>
    </section>
  `;
}

/* ── Roster (плоский список людей с delta + checkbox) ───────── */

function _buildRoster(model, ctx) {
  const rawRowsHtml = renderPersonRows(model, { expandedKey: '', prev: ctx.prev });
  if (typeof DOMParser === 'undefined') return rawRowsHtml;
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<!DOCTYPE html><body><div id="wrap">${rawRowsHtml}</div></body>`, 'text/html');
  const wrap = doc.getElementById('wrap');
  if (!wrap) return rawRowsHtml;
  const byKey = new Map();
  for (const p of model.participants) byKey.set(p.key, p);
  const teamMedians = _computeTeamMedians(model.participants);
  const allRows = Array.from(wrap.querySelectorAll('.ts2-row[data-key]'));
  const flat = doc.createElement('div');
  flat.className = 'ts2-rows briefv2-people-flat';
  for (const row of allRows) {
    const key = row.getAttribute('data-key');
    const p = byKey.get(key);
    if (!p) continue;
    row.classList.add('briefv2-row');
    row.id = `person-${_anchorId(key)}`;
    row.setAttribute('aria-expanded', 'false');
    row.dataset.briefKey = key;
    row.dataset.briefName = (p.label || '').toLowerCase();
    row.dataset.sortName = (p.label || '');
    row.dataset.sortToday = String((p.timelineToday || []).length);
    row.dataset.sortYest = String((p.timelineYesterday || []).length);
    row.dataset.sortWip = String((p.issuesNow || []).length);
    row.dataset.sortPr = String(p.badges?.pr48h || 0);
    row.dataset.sortTasks = String(p.contextSwitches?.distinctIssueKeys || 0);
    row.dataset.sortHours = String(((p.loggedTodaySec || 0) / 3600).toFixed(2));
    // Помечаем имя для anonymize
    const nameEl = row.querySelector('.ts2-name');
    if (nameEl) nameEl.setAttribute('data-real-name', p.label || p.key);
    // Чек-бокс «разрулил» в начало строки
    const cb = doc.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'briefv2-done briefv2-row-done';
    cb.setAttribute('data-done-id', `row-${key}`);
    cb.setAttribute('aria-label', 'Отметить как разрулил');
    row.insertBefore(cb, row.firstChild);
    // Delta-стрелки к counter'ам
    const prevP = _findPrevParticipant(ctx.prev, key);
    _attachDeltas(row, p, prevP, teamMedians, doc);
    // Detail-блок: inverted pyramid (status line → WIP → events collapsed → heatmap collapsed)
    const detailRawHtml = renderEmployeeDetailPanel(model, key, { filters: { ...ALL_SRC_FILTERS } });
    const detailWrap = doc.createElement('div');
    detailWrap.className = 'briefv2-detail brief-detail';
    detailWrap.hidden = true;
    detailWrap.dataset.detailFor = key;
    detailWrap.innerHTML = detailRawHtml;
    _stripRuntimeArtifacts(detailWrap);
    _reorderDetailForPyramid(detailWrap, p);
    flat.appendChild(row);
    flat.appendChild(detailWrap);
  }
  return flat.outerHTML;
}

function _findPrevParticipant(prev, key) {
  if (!prev || !Array.isArray(prev.participants)) return null;
  return prev.participants.find(x => x.key === key) || null;
}

function _attachDeltas(row, p, prevP, medians, doc) {
  const counters = row.querySelector('.ts2-counters');
  if (!counters) return;
  // p.badges.pr48h vs prev
  const def = [
    { selectorIdx: 1, current: p.badges?.pr48h || 0,                 prev: prevP?.badges?.pr48h || 0,                 medianKey: 'pr' },
    { selectorIdx: 2, current: p.contextSwitches?.distinctIssueKeys || 0, prev: prevP?.contextSwitches?.distinctIssueKeys || 0, medianKey: 'tasks' },
    { selectorIdx: 3, current: ((p.loggedTodaySec || 0) / 3600),     prev: ((prevP?.loggedTodaySec || 0) / 3600),     medianKey: 'hours' },
  ];
  const cells = Array.from(counters.children);
  for (const d of def) {
    const cell = cells[d.selectorIdx];
    if (!cell) continue;
    if (prevP) {
      const delta = d.current - d.prev;
      if (Math.abs(delta) >= 0.01) {
        const dEl = doc.createElement('span');
        dEl.className = `briefv2-delta ${delta > 0 ? 'briefv2-delta-up' : 'briefv2-delta-down'}`;
        dEl.textContent = (delta > 0 ? '+' : '') + (Number.isInteger(delta) ? delta : delta.toFixed(1));
        cell.appendChild(dEl);
      }
    }
    // Bullet chart vs медианы
    const med = medians[d.medianKey] || 0;
    if (med > 0) {
      const max = Math.max(med * 2.5, d.current * 1.2, 1);
      const valPct = Math.min(100, Math.round((d.current / max) * 100));
      const medPct = Math.min(100, Math.round((med / max) * 100));
      const bullet = doc.createElement('span');
      bullet.className = 'briefv2-bullet';
      bullet.setAttribute('title', `Медиана команды: ${Number.isInteger(med) ? med : med.toFixed(1)}`);
      bullet.innerHTML = `<span class="briefv2-bullet-track"><span class="briefv2-bullet-fill" style="width:${valPct}%"></span><span class="briefv2-bullet-median" style="left:${medPct}%"></span></span>`;
      cell.appendChild(bullet);
    }
  }
}

function _computeTeamMedians(parts) {
  const _median = (arr) => {
    const a = arr.filter(Number.isFinite).slice().sort((x, y) => x - y);
    if (!a.length) return 0;
    const mid = a.length >>> 1;
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  };
  return {
    pr: _median((parts || []).map(p => p.badges?.pr48h || 0)),
    tasks: _median((parts || []).map(p => p.contextSwitches?.distinctIssueKeys || 0)),
    hours: _median((parts || []).map(p => (p.loggedTodaySec || 0) / 3600)),
    wip: _median((parts || []).map(p => (p.issuesNow || []).length)),
  };
}

/* ── Detail в inverted pyramid ──────────────────────────────── */

function _reorderDetailForPyramid(root, p) {
  // Удаляем шапку (как в v1) — ФИО, чипы CR/PR/CT, email, 3д тренд.
  root.querySelectorAll('.ts2-panel-head').forEach(el => el.remove());
  // Сводка ассистента (live-only) — нет смысла в брифе.
  root.querySelectorAll('.ts2-assistant-section').forEach(el => el.remove());
  // Метрики сотрудника (PROD/АКТИВ/CF/Z/J).
  root.querySelectorAll('.ts2-pm-section').forEach(el => el.remove());
  // «Старые задачи» / blockers shelf — у нас глобальная секция блокеров.
  root.querySelectorAll('.ts2-blockers-details').forEach(el => el.remove());
  root.querySelectorAll('.ts2-panel-section').forEach(sec => {
    const title = sec.querySelector('.ts2-panel-section-title');
    if (title && /старые задачи/i.test(title.textContent || '')) sec.remove();
  });
  // Narrative предложение про блокеры — убираем (есть глобальный блок).
  root.querySelectorAll('.ts2-narrative-item').forEach(li => {
    const lab = li.querySelector('.ts2-narrative-label');
    if (lab && /блокер/i.test(lab.textContent || '')) li.remove();
  });
  // Heatmap и filter pills — в самый низ под details-closed.
  const panel = root.querySelector('.ts2-panel') || root;
  const heatmapSec = root.querySelector('.ts2-panel-section .ts2-heatmap')?.closest('.ts2-panel-section');
  const filtersSec = root.querySelector('.ts2-panel-filters');
  if (heatmapSec || filtersSec) {
    const wrap = root.ownerDocument.createElement('details');
    wrap.className = 'briefv2-detail-deep';
    const sum = root.ownerDocument.createElement('summary');
    sum.className = 'briefv2-detail-deep-summary';
    sum.textContent = 'Активность по источникам · heatmap 72×4';
    wrap.appendChild(sum);
    if (heatmapSec) {
      heatmapSec.parentNode.removeChild(heatmapSec);
      wrap.appendChild(heatmapSec);
    }
    if (filtersSec) {
      filtersSec.parentNode.removeChild(filtersSec);
      wrap.appendChild(filtersSec);
    }
    panel.appendChild(wrap);
  }
  // События 72ч — оборачиваем в details-closed, если ещё не details.
  const eventsSec = Array.from(root.querySelectorAll('.ts2-panel-section, details')).find(el => {
    const t = el.querySelector('.ts2-panel-section-title');
    return t && /событ/i.test(t.textContent || '');
  });
  if (eventsSec && eventsSec.tagName !== 'DETAILS') {
    const det = root.ownerDocument.createElement('details');
    det.className = 'briefv2-detail-events';
    const ds = root.ownerDocument.createElement('summary');
    ds.className = 'briefv2-detail-deep-summary';
    const tEl = eventsSec.querySelector('.ts2-panel-section-title');
    ds.textContent = tEl?.textContent?.replace(/\s+/g, ' ').trim() || 'События 72ч';
    if (tEl) tEl.remove();
    det.appendChild(ds);
    eventsSec.parentNode.replaceChild(det, eventsSec);
    det.appendChild(eventsSec);
  }
  // Status line наверху — одно предложение «в работе X, блокеров Y, …».
  const wipN = (p.issuesNow || []).length;
  const blockN = (p.blockers || []).length;
  const prN = p.badges?.pr48h || 0;
  const hoursToday = ((p.loggedTodaySec || 0) / 3600).toFixed(1);
  const parts = [];
  if (wipN > 0) parts.push(`в работе ${wipN}`);
  if (blockN > 0) parts.push(`блокеров ${blockN}`);
  if (prN > 0) parts.push(`PR за 48ч: ${prN}`);
  if (hoursToday > 0) parts.push(`залогировано ${hoursToday}ч`);
  if (parts.length === 0) parts.push('тишина за 72ч');
  const statusEl = root.ownerDocument.createElement('div');
  statusEl.className = 'briefv2-status-line';
  statusEl.innerHTML = `<span class="briefv2-status-line-label">Сейчас:</span> ${_esc(parts.join(' · '))}`;
  panel.insertBefore(statusEl, panel.firstChild);
}

function _stripRuntimeArtifacts(root) {
  root.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  const killSelectors = [
    '.ts2-panel-close', '.ts2-panel-tgcopy', '.ts2-panel-share', '.ts2-panel-back',
    '.ts2-narrative-copy', '.ts2-detail-spawn-1on1', '.ts2-panel-metric-action',
    '[data-jump-key]', '[data-close-modal]', '[data-narrative-md]',
  ];
  for (const sel of killSelectors) root.querySelectorAll(sel).forEach(el => el.remove());
  root.querySelectorAll('.ts2-panel').forEach(el => {
    el.removeAttribute('role');
    el.removeAttribute('aria-modal');
    el.removeAttribute('aria-labelledby');
    el.removeAttribute('tabindex');
    el.classList.add('brief-panel-inline');
  });
}

/* ── Footer ─────────────────────────────────────────────────── */

function _buildFooter(model, teamLabel, generatedAt, ctx) {
  const tlEmail = ctx.userEmail || '';
  return `
    <footer class="briefv2-footer">
      <div class="briefv2-footer-mark">${PRIZMA_STAR_SVG}<span class="briefv2-footer-wordmark">ПРИЗМА</span> · Сканнер команд</div>
      <p class="briefv2-footer-text">
        Это автоматический снимок команды <strong>${_esc(teamLabel)}</strong> на ${_esc(_formatDate(generatedAt))}.
        Цифры — что происходило в Jira / Bitbucket / Confluence / Zephyr за 72 часа.
        <strong>Не оценка людей.</strong> Если показалось странным — лучше обсудить с тимлидом напрямую.
        Полная картина — в Призме у тимлида.
      </p>
      ${tlEmail ? `<p class="briefv2-footer-sig">Сгенерировал: ${_esc(tlEmail)}</p>` : ''}
    </footer>
  `;
}

/* ── Daily brief md (для clipboard copy) ────────────────────── */

function _composeDailyBriefMd(model, ctx) {
  try {
    return composeDailyBriefMarkdown(model, ctx.history) || '';
  } catch (_) { return ''; }
}

/* ── Per-person dataset (для anonymize) ─────────────────────── */

function _buildPersonDataset(model, ctx) {
  const employees = ctx.employees || [];
  // Сортируем emails для детерминированной нумерации Engineer N.
  const allEmails = [];
  for (const p of (model.participants || [])) {
    const em = String(p.email || '').toLowerCase().trim();
    if (em) allEmails.push(em);
  }
  allEmails.sort();
  const engineerNoByEmail = new Map();
  allEmails.forEach((em, i) => engineerNoByEmail.set(em, i + 1));
  const out = {};
  for (const p of (model.participants || [])) {
    const em = String(p.email || '').toLowerCase().trim();
    const idx = em ? engineerNoByEmail.get(em) : 0;
    out[p.label || p.key] = idx ? `Engineer ${idx}` : 'Engineer ?';
  }
  return out;
}

/* ── CSS collection (reuse v1 approach) ─────────────────────── */

function _collectScopedCss() {
  if (typeof document === 'undefined' || !document.styleSheets) return '';
  const chunks = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules = null;
    try { rules = sheet.cssRules; } catch (_) { rules = null; }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      const text = _ruleTextFiltered(rule);
      if (text) chunks.push(text);
    }
  }
  return chunks.join('\n');
}

function _ruleTextFiltered(rule) {
  const T = (typeof CSSRule !== 'undefined') ? CSSRule : null;
  if (T && rule.type === T.KEYFRAMES_RULE)  return rule.cssText;
  if (T && rule.type === T.FONT_FACE_RULE)  return rule.cssText;
  if (T && rule.type === T.SUPPORTS_RULE)   return rule.cssText;
  if (T && rule.type === T.MEDIA_RULE) {
    const inner = Array.from(rule.cssRules).map(_ruleTextFiltered).filter(Boolean).join('\n');
    if (!inner) return '';
    return `@media ${rule.media.mediaText} {\n${inner}\n}`;
  }
  if (T && rule.type === T.STYLE_RULE) {
    const sel = String(rule.selectorText || '');
    if (!sel) return '';
    if (_isRootSelector(sel)) return rule.cssText;
    for (const t of CSS_KEEP_TOKENS) {
      if (sel.includes(t)) return rule.cssText;
    }
    return '';
  }
  return '';
}

function _isRootSelector(sel) {
  const s = sel.trim();
  if (s === ':root' || s === 'html' || s === 'body' || s === '*' || s === ':root, body') return true;
  if (/^:root\b/.test(s)) return true;
  if (/^html\b/.test(s) && !s.includes(' ')) return true;
  if (/^body\b/.test(s) && !s.includes(' ')) return true;
  if (s.includes('[data-theme=')) return true;
  return false;
}

/* ── Document assembly ──────────────────────────────────────── */

function _assembleHtmlDocument({ title, css, bodyHtml, inlineJs }) {
  const own = _ownCss();
  // 2026-06-04 — наследуем тему из основного приложения. Если document не
  // доступен (server-side) — fallback на light.
  const initialTheme = (() => {
    try {
      const t = (typeof document !== 'undefined') && document.documentElement.getAttribute('data-theme');
      return (t === 'dark' || t === 'light') ? t : 'light';
    } catch (_) { return 'light'; }
  })();
  return `<!DOCTYPE html>
<html lang="ru" data-theme="${initialTheme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${_esc(title)}</title>
<style>
${css}
${own}
</style>
</head>
<body>
${bodyHtml}
<script>
${inlineJs}
</script>
</body>
</html>
`;
}

function _ownCss() {
  return `
    /* ── Global ───────────────────────────────────────────── */
    html, body { margin: 0; padding: 0; }
    body {
      background: var(--prizma-bg, #FAFAF8); color: var(--prizma-text-primary, #1A1A22);
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      font-feature-settings: "tnum" 1, "lnum" 1;
      font-variant-numeric: tabular-nums lining-nums;
      -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
    }
    .briefv2-shell { max-width: 1280px; margin: 0 auto; padding: 16px 28px 80px; }
    a { color: var(--prizma-information, #1F6B96); }
    a:hover { text-decoration: underline; }

    /* ── Header ───────────────────────────────────────────── */
    .briefv2-header { padding: 4px 0 18px; border-bottom: 1px solid var(--prizma-border, rgba(0,0,0,.08)); margin-bottom: 18px; }
    .briefv2-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; color: var(--prizma-mark, currentColor); }
    .briefv2-star { width: 28px; height: 28px; flex: 0 0 28px; }
    .briefv2-brand-text { display: inline-flex; flex-direction: column; line-height: 1.05; }
    .briefv2-brand-wordmark { font-weight: 800; letter-spacing: .12em; font-size: 11px; }
    .briefv2-brand-sub { font-size: 10px; opacity: .65; letter-spacing: .04em; }
    .briefv2-title { font-size: 26px; font-weight: 700; letter-spacing: -.01em; margin: 0 0 8px; }
    .briefv2-header-meta { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; font-size: 13px; color: var(--prizma-text-secondary); }
    .briefv2-header-meta strong { color: var(--prizma-text-primary); font-weight: 600; }
    .briefv2-header-sep { opacity: .35; }
    .briefv2-age-pill { padding: 3px 10px; border-radius: 12px; background: var(--prizma-bg-tertiary, #F0EDE5); font-size: 12px; }
    .briefv2-age-pill[data-stale="medium"] { background: var(--prizma-drift-bg, rgba(181,103,10,.12)); color: var(--prizma-drift, #B5670A); }
    .briefv2-age-pill[data-stale="high"]   { background: var(--prizma-off-course-bg, rgba(193,56,56,.12)); color: var(--prizma-off-course, #C13838); }
    .briefv2-meta-details { margin-top: 8px; font-size: 12px; color: var(--prizma-text-secondary); }
    .briefv2-meta-summary { cursor: pointer; list-style: none; }
    .briefv2-meta-summary::-webkit-details-marker { display: none; }
    .briefv2-meta-summary::before { content: "▸ "; opacity: .5; }
    .briefv2-meta-details[open] .briefv2-meta-summary::before { content: "▾ "; opacity: 1; }
    .briefv2-meta-dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 6px 0 0; padding-left: 12px; }
    .briefv2-meta-dl dt { font-weight: 600; opacity: .75; }
    .briefv2-meta-dl dd { margin: 0; }

    /* ── Toolbar ──────────────────────────────────────────── */
    .briefv2-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 10px 0 16px; }
    .briefv2-toolbar-spacer { flex: 1 1 auto; }
    .briefv2-toolbar-sep { width: 1px; height: 22px; background: var(--prizma-border, rgba(0,0,0,.12)); }
    .briefv2-search {
      padding: 7px 12px; border: 1px solid var(--prizma-border-strong, var(--prizma-border));
      border-radius: 8px; min-width: 220px; font-size: 13px;
      background: var(--prizma-bg-elevated, #fff); color: inherit;
      transition: border-color .15s, box-shadow .15s;
    }
    .briefv2-search:focus { outline: none; border-color: var(--prizma-information); box-shadow: 0 0 0 3px var(--prizma-information-bg, rgba(31,107,150,.12)); }
    .briefv2-btn {
      padding: 6px 12px; border: 1px solid var(--prizma-border-strong, var(--prizma-border));
      border-radius: 8px; background: var(--prizma-bg-elevated, #fff);
      font-size: 12px; font-weight: 500; cursor: pointer; color: inherit;
      transition: background .15s;
    }
    .briefv2-btn:hover { background: var(--prizma-bg-tertiary, #F0EDE5); }
    .briefv2-select-wrap, .briefv2-check-wrap { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
    .briefv2-select { padding: 6px 8px; border: 1px solid var(--prizma-border-strong, var(--prizma-border)); border-radius: 8px; background: var(--prizma-bg-elevated, #fff); color: inherit; font-size: 12px; }
    .briefv2-select-label { color: var(--prizma-text-secondary); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; }
    .briefv2-check-wrap input { margin: 0; }
    .briefv2-theme-btn { display: inline-flex; align-items: center; gap: 4px; }

    /* ── Main / Sections ─────────────────────────────────── */
    .briefv2-main { display: flex; flex-direction: column; gap: 22px; }
    .briefv2-section-title { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--prizma-text-tertiary, #5A5A64); margin: 0 0 10px; display: flex; align-items: center; gap: 8px; }
    .briefv2-section-count { padding: 1px 7px; border-radius: 8px; background: var(--prizma-bg-tertiary, #F0EDE5); color: var(--prizma-text-primary); font-size: 11px; font-weight: 700; }
    .briefv2-section-hint { font-size: 11px; font-weight: 400; letter-spacing: 0; text-transform: none; color: var(--prizma-text-tertiary); font-style: italic; }
    .briefv2-section-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 8px; }

    /* ── TL;DR strip ─────────────────────────────────────── */
    .briefv2-tldr { display: flex; flex-direction: column; gap: 12px; }
    .briefv2-status { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 10px; background: var(--prizma-bg-elevated, #fff); border-left: 3px solid var(--prizma-information); }
    .briefv2-status.briefv2-course-off-course { border-left-color: var(--prizma-off-course); }
    .briefv2-status.briefv2-course-drift { border-left-color: var(--prizma-drift); }
    .briefv2-status.briefv2-course-on-course { border-left-color: var(--prizma-on-course); }
    .briefv2-status-pill { padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; background: var(--prizma-bg-tertiary); }
    .briefv2-status-pill.briefv2-course-on-course { background: var(--prizma-on-course-bg); color: var(--prizma-on-course); }
    .briefv2-status-pill.briefv2-course-drift { background: var(--prizma-drift-bg); color: var(--prizma-drift); }
    .briefv2-status-pill.briefv2-course-off-course { background: var(--prizma-off-course-bg); color: var(--prizma-off-course); }
    .briefv2-status-text { font-size: 14px; line-height: 1.4; }

    .briefv2-diff { display: flex; align-items: baseline; gap: 8px; padding: 4px 0 4px 14px; font-size: 13px; }
    .briefv2-diff-label { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--prizma-text-tertiary); }
    .briefv2-diff-text strong { color: var(--prizma-information); font-weight: 700; }
    .briefv2-diff-text-empty { color: var(--prizma-text-tertiary); font-style: italic; }

    /* ── Attention queue ─────────────────────────────────── */
    .briefv2-attention { padding: 14px 16px; background: var(--prizma-bg-elevated, #fff); border-radius: 10px; border: 1px solid var(--prizma-border, rgba(0,0,0,.06)); }
    .briefv2-attention.briefv2-attention-empty { color: var(--prizma-text-tertiary); }
    .briefv2-attention-msg { margin: 4px 0 0; font-style: italic; }
    .briefv2-attention-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
    .briefv2-attention-item { display: flex; gap: 10px; padding: 8px 10px; border-left: 3px solid var(--prizma-text-tertiary); border-radius: 0 6px 6px 0; background: var(--prizma-bg, transparent); }
    .briefv2-attention-item.briefv2-sev-high { border-left-color: var(--prizma-off-course); background: var(--prizma-off-course-bg); }
    .briefv2-attention-item.briefv2-sev-medium { border-left-color: var(--prizma-drift); background: var(--prizma-drift-bg); }
    .briefv2-attention-item.briefv2-sev-low { border-left-color: var(--prizma-information); }
    .briefv2-attention-item.briefv2-row-done-on, .briefv2-attention-item.briefv2-done-on { opacity: .55; }
    .briefv2-attention-item.briefv2-done-on .briefv2-attention-body { text-decoration: line-through; }
    .briefv2-attention-body { flex: 1 1 auto; }
    .briefv2-attention-head { display: flex; gap: 8px; align-items: baseline; }
    .briefv2-attention-name { font-weight: 600; font-size: 13px; }
    .briefv2-anchor { font-size: 11px; }
    .briefv2-attention-reason { font-size: 12px; color: var(--prizma-text-secondary); margin-top: 2px; }
    .briefv2-attention-action { font-size: 12px; margin-top: 4px; }
    .briefv2-action-lab { color: var(--prizma-information); font-weight: 700; }

    /* ── Blockers ────────────────────────────────────────── */
    .briefv2-blockers { padding: 14px 16px; background: var(--prizma-bg-elevated, #fff); border-radius: 10px; border: 1px solid var(--prizma-border, rgba(0,0,0,.06)); }
    .briefv2-blockers.briefv2-blockers-empty { color: var(--prizma-text-tertiary); }
    .briefv2-blockers-msg { margin: 4px 0 0; font-style: italic; }
    .briefv2-blockers-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
    .briefv2-blocker-item { display: grid; grid-template-columns: auto auto 1fr auto auto auto; gap: 10px; align-items: baseline; padding: 6px 8px; border-radius: 6px; font-size: 13px; }
    .briefv2-blocker-item:nth-child(odd) { background: var(--prizma-bg-tertiary); }
    .briefv2-blocker-item.briefv2-blocker-hot { box-shadow: inset 3px 0 0 var(--prizma-off-course); }
    .briefv2-blocker-item.briefv2-done-on { opacity: .55; text-decoration: line-through; }
    .briefv2-blocker-key { font-weight: 700; }
    .briefv2-blocker-summary { color: var(--prizma-text-primary); }
    .briefv2-blocker-status { font-size: 11px; color: var(--prizma-text-secondary); padding: 1px 6px; border-radius: 8px; background: var(--prizma-bg); }
    .briefv2-blocker-dwell { font-feature-settings: "tnum" 1; font-weight: 600; color: var(--prizma-off-course); }
    .briefv2-blocker-owner { font-size: 12px; color: var(--prizma-text-secondary); }
    .briefv2-blockers-rest { margin-top: 8px; font-size: 11px; color: var(--prizma-text-tertiary); font-style: italic; }

    /* ── KPI band ────────────────────────────────────────── */
    .briefv2-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
    .briefv2-kpi-cell { padding: 12px; border-radius: 10px; background: var(--prizma-bg-elevated, #fff); border-top: 3px solid var(--prizma-border); }
    .briefv2-kpi-cell.briefv2-tone-on-course { border-top-color: var(--prizma-on-course); }
    .briefv2-kpi-cell.briefv2-tone-drift { border-top-color: var(--prizma-drift); }
    .briefv2-kpi-cell.briefv2-tone-off-course { border-top-color: var(--prizma-off-course); }
    .briefv2-kpi-label { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--prizma-text-tertiary); margin-bottom: 4px; }
    .briefv2-kpi-value { font-size: 22px; font-weight: 700; font-feature-settings: "tnum" 1; }
    .briefv2-kpi-sub { font-size: 11px; color: var(--prizma-text-secondary); margin-top: 2px; }

    /* ── Idle / PR queue ─────────────────────────────────── */
    .briefv2-idle { padding: 12px 16px; background: var(--prizma-bg-elevated, #fff); border-radius: 10px; border: 1px solid var(--prizma-border, rgba(0,0,0,.06)); }
    .briefv2-idle > details > summary { list-style: none; cursor: pointer; }
    .briefv2-idle > details > summary::-webkit-details-marker { display: none; }
    .briefv2-idle > details > summary::after { content: "▾"; float: right; opacity: .5; transition: transform .15s; }
    .briefv2-idle > details[open] > summary::after { content: "▴"; }
    .briefv2-idle-list { margin: 8px 0 0; padding: 0; list-style: none; }
    .briefv2-idle-item { display: flex; gap: 12px; padding: 4px 0; font-size: 13px; align-items: baseline; }
    .briefv2-idle-name { font-weight: 600; min-width: 140px; }
    .briefv2-idle-last { color: var(--prizma-text-secondary); font-size: 12px; }
    .briefv2-idle-hyp { color: var(--prizma-text-tertiary); font-size: 12px; font-style: italic; flex: 1; }

    .briefv2-prqueue { padding: 12px 16px; background: var(--prizma-bg-elevated, #fff); border-radius: 10px; border: 1px solid var(--prizma-border, rgba(0,0,0,.06)); }
    .briefv2-prq-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
    .briefv2-prq-item { display: flex; gap: 14px; padding: 4px 0; font-size: 13px; align-items: baseline; }
    .briefv2-prq-item.briefv2-prq-overload { color: var(--prizma-off-course); }
    .briefv2-prq-item.briefv2-prq-warn { color: var(--prizma-drift); }
    .briefv2-prq-name { font-weight: 600; min-width: 140px; }
    .briefv2-prq-count strong { font-size: 16px; }
    .briefv2-prq-flag { font-size: 11px; padding: 1px 6px; border-radius: 8px; background: currentColor; color: var(--prizma-bg); }

    /* ── Roster + row deltas + bullet ─────────────────────── */
    .briefv2-row { cursor: pointer; position: relative; transition: background .15s; padding-left: 26px; }
    .briefv2-row > .briefv2-row-done { position: absolute; left: 6px; top: 50%; transform: translateY(-50%); }
    .briefv2-row:hover { background: var(--prizma-bg-tertiary, #F0EDE5); }
    .briefv2-row[aria-expanded="true"] { background: var(--prizma-bg-tertiary, #F0EDE5); box-shadow: inset 3px 0 0 var(--prizma-information); }
    .briefv2-row.briefv2-row-done-on { opacity: .55; }
    .briefv2-row.briefv2-row-done-on .ts2-name { text-decoration: line-through; }
    .briefv2-row .ts2-chev { transition: transform .15s; color: var(--prizma-text-tertiary); }
    .briefv2-row.brief-row-expanded .ts2-chev { transform: rotate(90deg); color: var(--prizma-information); }
    .briefv2-row .ts2-counters > :first-child { display: none !important; }
    .briefv2-row .ts2-strip-empty-y { display: none !important; }
    .briefv2-row .ts2-strip-empty { opacity: .55; font-size: 12px; font-style: italic; }
    .briefv2-row .ts2-strip-label { opacity: .55; }
    .briefv2-people-flat > .briefv2-row + .briefv2-row,
    .briefv2-people-flat > .briefv2-detail + .briefv2-row { border-top: 1px solid var(--prizma-border, rgba(0,0,0,.06)); }
    .briefv2-delta { display: inline-block; margin-left: 4px; font-size: 10px; font-weight: 700; padding: 0 4px; border-radius: 6px; }
    .briefv2-delta-up { color: var(--prizma-on-course); background: var(--prizma-on-course-bg); }
    .briefv2-delta-down { color: var(--prizma-off-course); background: var(--prizma-off-course-bg); }
    .briefv2-bullet { display: inline-block; margin-left: 6px; vertical-align: middle; }
    .briefv2-bullet-track { display: inline-block; position: relative; width: 40px; height: 6px; border-radius: 3px; background: var(--prizma-bg-tertiary); overflow: visible; }
    .briefv2-bullet-fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--prizma-information); border-radius: 3px; }
    .briefv2-bullet-median { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--prizma-drift); }

    /* ── Detail block ────────────────────────────────────── */
    .briefv2-detail { margin: 0 0 14px; padding: 8px 16px 18px; border-left: 3px solid var(--prizma-information); background: var(--prizma-bg-elevated, #fff); border-radius: 0 8px 8px 0; }
    .briefv2-detail[hidden] { display: none; }
    .briefv2-detail .ts2-panel.ts2-panel-modal.brief-panel-inline,
    .briefv2-detail .brief-panel-inline {
      position: static !important; transform: none !important;
      box-shadow: none !important;
      max-width: none !important; width: auto !important; height: auto !important; max-height: none !important;
      padding: 0 !important; overflow: visible !important;
      background: transparent !important; border: none !important;
    }
    .briefv2-detail .ts2-panel-section,
    .briefv2-detail .ts2-panel-section-tight {
      padding: 12px 0 !important;
      border-top: 1px solid var(--prizma-border, rgba(0,0,0,.06)) !important;
      background: transparent !important;
    }
    .briefv2-detail .ts2-panel-section:first-child,
    .briefv2-detail .ts2-narrative-section:first-child { border-top: none !important; padding-top: 4px !important; }
    .briefv2-detail .ts2-panel-section-title { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--prizma-text-tertiary); margin-bottom: 8px; }
    .briefv2-status-line { padding: 6px 10px; margin-bottom: 10px; background: var(--prizma-bg-tertiary); border-radius: 6px; font-size: 13px; }
    .briefv2-status-line-label { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--prizma-text-tertiary); margin-right: 6px; }
    .briefv2-detail-deep, .briefv2-detail-events { margin-top: 12px; }
    .briefv2-detail-deep-summary { cursor: pointer; list-style: none; padding: 6px 0; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--prizma-text-tertiary); border-top: 1px solid var(--prizma-border); }
    .briefv2-detail-deep-summary::-webkit-details-marker { display: none; }
    .briefv2-detail-deep-summary::before { content: "▸ "; opacity: .5; }
    .briefv2-detail-deep[open] .briefv2-detail-deep-summary::before,
    .briefv2-detail-events[open] .briefv2-detail-deep-summary::before { content: "▾ "; opacity: 1; }
    .briefv2-detail .ts2-hcell { opacity: .06 !important; }
    .briefv2-detail .ts2-filter-pill { pointer-events: none !important; opacity: .82; cursor: default !important; }

    /* ── Footer ──────────────────────────────────────────── */
    .briefv2-footer { margin-top: 32px; padding-top: 18px; border-top: 1px solid var(--prizma-border, rgba(0,0,0,.06)); font-size: 12px; color: var(--prizma-text-secondary); line-height: 1.55; }
    .briefv2-footer-mark { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; color: var(--prizma-mark); }
    .briefv2-footer-mark .briefv2-star { width: 16px; height: 16px; opacity: .65; }
    .briefv2-footer-wordmark { font-weight: 800; letter-spacing: .12em; font-size: 11px; }
    .briefv2-footer-text { margin: 0 0 6px; }
    .briefv2-footer-sig { margin: 0; opacity: .65; font-size: 11px; }

    /* ── Audience modes (CSS visibility) ─────────────────── */
    .briefv2-shell[data-audience="exec"] .briefv2-prqueue,
    .briefv2-shell[data-audience="exec"] .briefv2-idle,
    .briefv2-shell[data-audience="exec"] .briefv2-roster .briefv2-detail,
    .briefv2-shell[data-audience="exec"] .briefv2-detail-events,
    .briefv2-shell[data-audience="exec"] .briefv2-detail-deep { display: none; }
    .briefv2-shell[data-audience="hr"] .briefv2-attention-name,
    .briefv2-shell[data-audience="hr"] .briefv2-blocker-owner,
    .briefv2-shell[data-audience="hr"] .briefv2-idle-name,
    .briefv2-shell[data-audience="hr"] .briefv2-prq-name,
    .briefv2-shell[data-audience="hr"] .briefv2-row .ts2-name { visibility: hidden; position: relative; }
    .briefv2-shell[data-audience="hr"] .briefv2-attention-name::after,
    .briefv2-shell[data-audience="hr"] .briefv2-blocker-owner::after,
    .briefv2-shell[data-audience="hr"] .briefv2-idle-name::after,
    .briefv2-shell[data-audience="hr"] .briefv2-prq-name::after,
    .briefv2-shell[data-audience="hr"] .briefv2-row .ts2-name::after {
      content: attr(data-engineer-id); visibility: visible; position: absolute; left: 0; color: var(--prizma-text-primary);
    }
    .briefv2-shell[data-audience="share"] .briefv2-footer-sig,
    .briefv2-shell[data-audience="share"] .briefv2-meta-details { display: none; }

    /* ── Anonymize (apply via JS data-real-name → engineer N) ─ */
    .briefv2-shell[data-anonymize="1"] [data-real-name] { visibility: hidden; position: relative; }
    .briefv2-shell[data-anonymize="1"] [data-real-name]::after {
      content: attr(data-engineer-id); visibility: visible; position: absolute; left: 0; color: var(--prizma-text-primary);
    }

    /* ── Print styles ────────────────────────────────────── */
    @media print {
      :root { color-scheme: light !important; }
      html, body { background: #fff !important; color: #000 !important; }
      .briefv2-toolbar, .briefv2-search, .briefv2-btn, .briefv2-select-wrap, .briefv2-check-wrap,
      .briefv2-theme-btn, .briefv2-anchor, .briefv2-done, .briefv2-row > input[type="checkbox"],
      .ts2-chev { display: none !important; }
      .briefv2-detail[hidden] { display: block !important; }
      details, .briefv2-detail-deep, .briefv2-detail-events, .briefv2-meta-details, .briefv2-idle details { open: true; }
      details > summary { list-style: none !important; }
      details > summary::after, details > summary::before { content: "" !important; }
      .briefv2-row, .briefv2-detail, .briefv2-attention-item, .briefv2-blocker-item, .briefv2-kpi-cell {
        page-break-inside: avoid;
      }
      .briefv2-shell { max-width: none !important; padding: 0 !important; }
      @page { margin: 16mm 14mm; }
      .briefv2-detail .ts2-hcell { opacity: 1 !important; background: currentColor !important; }
    }

    /* ── 2026-06-03 Slim Brief V2 (roster-only redesign) ───────── */
    .briefv2-header-slim { padding: 14px 0; border-bottom: 1px solid var(--prizma-border, rgba(0,0,0,.08)); margin-bottom: 16px; }
    .briefv2-header-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .briefv2-title { margin: 0; font-size: 18px; font-weight: 700; color: var(--prizma-text-primary, #333); }
    .briefv2-meta-line { margin-top: 4px; font-size: 12px; color: var(--prizma-text-secondary, #666); }
    .briefv2-theme-toggle {
      padding: 6px 14px; border: 1px solid var(--prizma-border, rgba(0,0,0,.12));
      background: transparent; border-radius: 6px; cursor: pointer; font-size: 12px; color: inherit;
    }
    .briefv2-theme-toggle:hover { background: var(--prizma-bg-tertiary, rgba(0,0,0,.05)); }

    .briefv2-roster-slim { display: flex; flex-direction: column; gap: 6px; }
    .briefv2-person {
      border: 1px solid var(--prizma-border, rgba(0,0,0,.08));
      border-radius: 8px; overflow: hidden;
      background: var(--prizma-bg-card, var(--card, #fff));
    }
    .briefv2-person-row {
      width: 100%; display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border: 0; background: transparent; cursor: pointer;
      font-size: 14px; font-weight: 500; color: inherit; text-align: left;
    }
    .briefv2-person-row:hover { background: var(--prizma-bg-tertiary, rgba(0,0,0,.04)); }
    .briefv2-person.is-open .briefv2-person-row { border-bottom: 1px solid var(--prizma-border, rgba(0,0,0,.06)); }
    .briefv2-person-chev { color: var(--prizma-text-secondary, #888); transition: transform .15s ease; }
    .briefv2-person.is-open .briefv2-person-chev { transform: rotate(180deg); }
    .briefv2-person-detail { padding: 12px 16px 18px; display: flex; flex-direction: column; gap: 18px; }
    .briefv2-person-detail[hidden] { display: none; }

    .briefv2-section { display: flex; flex-direction: column; gap: 6px; }
    .briefv2-section-title { font-size: 11px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: var(--prizma-text-secondary, #777); margin: 0; }
    .briefv2-section-hint { font-size: 10px; font-weight: 500; color: var(--prizma-text-tertiary, #999); text-transform: none; letter-spacing: 0; }
    .briefv2-empty { font-size: 12px; color: var(--prizma-text-tertiary, #999); font-style: italic; padding: 4px 0; }

    .briefv2-task-list { margin: 0; padding-left: 20px; list-style: none; }
    .briefv2-task-list li { padding: 3px 0; font-size: 13px; line-height: 1.5; display: flex; align-items: baseline; gap: 8px; }
    .briefv2-task-key { font-family: ui-monospace, SFMono-Regular, monospace; font-weight: 700; color: var(--prizma-information, #2A6FB3); font-size: 11px; }
    .briefv2-task-title { color: var(--prizma-text-primary, #333); flex: 1; }
    .briefv2-task-meta { font-size: 11px; color: var(--prizma-text-tertiary, #999); }

    .briefv2-evt-list { margin: 0; padding: 0; list-style: none; }
    .briefv2-evt {
      display: flex; align-items: baseline; gap: 8px;
      padding: 4px 0; font-size: 12px; line-height: 1.5;
      border-bottom: 1px dashed var(--prizma-border, rgba(0,0,0,.05));
    }
    .briefv2-evt:last-child { border-bottom: 0; }
    .briefv2-evt-time { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; color: var(--prizma-text-tertiary, #999); min-width: 80px; }
    .briefv2-evt-src {
      font-size: 10px; font-weight: 600; padding: 1px 5px; border-radius: 5px;
      background: var(--prizma-bg-tertiary, rgba(0,0,0,.05)); text-transform: uppercase;
    }
    .briefv2-evt-src-jira { color: var(--prizma-information, #2A6FB3); }
    .briefv2-evt-src-bb { color: var(--prizma-insight, #B084CC); }
    .briefv2-evt-src-cf { color: var(--prizma-on-course, #2C8C5F); }
    .briefv2-evt-key { font-family: ui-monospace; font-weight: 700; font-size: 11px; color: var(--prizma-information, #2A6FB3); }
    .briefv2-evt-text { flex: 1; color: var(--prizma-text-primary, #333); }

    .briefv2-heatmap-wrap .ts2-panel-section-title { display: none; }
    .briefv2-heatmap-wrap .ts2-panel-section { padding: 0; }

    .briefv2-assistant-mount { font-size: 13px; }

    /* 2026-06-04 — theme fix: body и shell используют theme-aware токены,
       чтобы при переключении [data-theme] на <html> весь slim brief
       перекрашивался корректно (как embedded .ts2-* секции, так и наши
       .briefv2-* блоки). Раньше body был unstyled → в dark-теме браузер
       подставлял дефолтный белый фон под dark .ts2-content внутри.
       Глобальные prizma-tokens определены в основном CSS приложения
       и наследуются — здесь только связываем их с body / shell. */
    html, body {
      background: var(--prizma-bg, var(--bg, #fff));
      color: var(--prizma-text-primary, var(--text-1, #111));
    }
    .briefv2-shell {
      background: var(--prizma-bg, var(--bg, transparent));
      color: var(--prizma-text-primary, var(--text-1, inherit));
    }
  `;
}

/* ── Inline JS ──────────────────────────────────────────────── */

function _briefInlineJs() {
  return `(function () {
  'use strict';
  var doc = document;
  var root = doc.documentElement;
  var shell = doc.querySelector('.briefv2-shell');
  function $(s, c) { return (c || doc).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }

  /* ── Snapshot age badge ─────────────────────────────── */
  var agePill = $('#briefv2-age-pill');
  if (agePill) {
    var ts = parseInt(agePill.getAttribute('data-snapshot-ts'), 10);
    function updAge() {
      if (!Number.isFinite(ts)) return;
      var diff = Date.now() - ts;
      var min = Math.round(diff / 60000);
      var rel;
      if (diff < 60000) rel = 'только что';
      else if (min < 60) rel = min + ' мин назад';
      else if (min < 1440) rel = Math.round(min / 60) + ' ч назад';
      else rel = Math.round(min / 1440) + ' д назад';
      var lab = agePill.querySelector('.briefv2-age-rel');
      if (lab) lab.textContent = rel;
      if (min > 24 * 60 * 7) agePill.setAttribute('data-stale', 'high');
      else if (min > 24 * 60) agePill.setAttribute('data-stale', 'medium');
      else agePill.removeAttribute('data-stale');
    }
    updAge();
    setInterval(updAge, 60000);
  }

  /* ── People dataset for anonymize ───────────────────── */
  var peopleData = {};
  try { peopleData = JSON.parse($('#briefv2-people-data').textContent || '{}'); } catch (_) {}
  function applyEngineerIds() {
    $$('[data-real-name]').forEach(function (el) {
      var name = el.getAttribute('data-real-name') || '';
      var eng = peopleData[name] || 'Engineer ?';
      el.setAttribute('data-engineer-id', eng);
    });
  }
  applyEngineerIds();

  /* ── Toggle row → detail ────────────────────────────── */
  function detailFor(key) {
    var all = $$('.briefv2-detail');
    for (var i = 0; i < all.length; i++) if (all[i].dataset.detailFor === key) return all[i];
    return null;
  }
  function setRowOpen(row, open) {
    var det = detailFor(row.dataset.briefKey);
    if (!det) return;
    det.hidden = !open;
    if (open) row.classList.add('brief-row-expanded'); else row.classList.remove('brief-row-expanded');
    row.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  $$('.briefv2-row').forEach(function (row) {
    row.addEventListener('click', function (e) {
      if (e.target.closest('a, button, input, textarea, select, summary')) return;
      setRowOpen(row, !!detailFor(row.dataset.briefKey)?.hidden);
    });
  });

  /* ── Search ─────────────────────────────────────────── */
  var search = $('#briefv2-search');
  if (search) search.addEventListener('input', function () {
    var q = (search.value || '').toLowerCase().trim();
    $$('.briefv2-row').forEach(function (r) {
      var name = r.dataset.briefName || '';
      var match = !q || name.indexOf(q) !== -1;
      r.style.display = match ? '' : 'none';
      var det = detailFor(r.dataset.briefKey);
      if (det && !match) { det.hidden = true; r.classList.remove('brief-row-expanded'); }
    });
  });

  /* ── Expand-all / Collapse-all ──────────────────────── */
  var ea = $('#briefv2-expand-all'); if (ea) ea.addEventListener('click', function () { $$('.briefv2-row').forEach(function (r) { setRowOpen(r, true); }); });
  var ca = $('#briefv2-collapse-all'); if (ca) ca.addEventListener('click', function () { $$('.briefv2-row').forEach(function (r) { setRowOpen(r, false); }); });

  /* ── Theme toggle ───────────────────────────────────── */
  var themeBtn = $('#briefv2-theme-toggle');
  function updateThemeBtn(theme) {
    if (!themeBtn) return;
    var isLight = theme === 'light';
    var icon = themeBtn.querySelector('.briefv2-theme-icon');
    var label = themeBtn.querySelector('.briefv2-theme-label');
    if (icon) icon.textContent = isLight ? '\\u263E' : '\\u2600';
    if (label) label.textContent = isLight ? ' Тёмная' : ' Светлая';
  }
  try {
    var saved = localStorage.getItem('briefv2Theme');
    if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
  } catch (_) {}
  updateThemeBtn(root.getAttribute('data-theme') || 'light');
  if (themeBtn) themeBtn.addEventListener('click', function () {
    var current = root.getAttribute('data-theme') || 'light';
    var next = current === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('briefv2Theme', next); } catch (_) {}
    updateThemeBtn(next);
  });

  /* ── Audience selector ──────────────────────────────── */
  var audSel = $('#briefv2-audience');
  if (audSel) audSel.addEventListener('change', function () { shell.setAttribute('data-audience', audSel.value); });

  /* ── Anonymize toggle ───────────────────────────────── */
  var anonChk = $('#briefv2-anonymize');
  if (anonChk) anonChk.addEventListener('change', function () { shell.setAttribute('data-anonymize', anonChk.checked ? '1' : '0'); });

  /* ── Checkboxes «разрулил» с localStorage + URL hash ─ */
  var storageKey = 'briefv2-done-' + (location.pathname || 'p') + '-' + (doc.title || '');
  var done = new Set();
  try {
    var rawLs = localStorage.getItem(storageKey);
    if (rawLs) JSON.parse(rawLs).forEach(function (k) { done.add(k); });
  } catch (_) {}
  function parseHash() {
    var m = (location.hash || '').match(/done=([^&]*)/);
    if (m) m[1].split(',').forEach(function (k) { if (k) done.add(decodeURIComponent(k)); });
  }
  parseHash();
  function applyDone() {
    $$('.briefv2-done').forEach(function (cb) {
      var id = cb.getAttribute('data-done-id');
      if (!id) return;
      cb.checked = done.has(id);
      var parent = cb.closest('.briefv2-attention-item, .briefv2-blocker-item, .briefv2-row');
      if (parent) parent.classList.toggle('briefv2-row-done-on', cb.checked);
      if (parent && parent.classList.contains('briefv2-attention-item')) parent.classList.toggle('briefv2-done-on', cb.checked);
      if (parent && parent.classList.contains('briefv2-blocker-item')) parent.classList.toggle('briefv2-done-on', cb.checked);
    });
  }
  function syncHash() {
    var arr = Array.from(done);
    if (arr.length) location.hash = 'done=' + arr.map(encodeURIComponent).join(',');
    else if (location.hash) history.replaceState(null, '', location.pathname);
  }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(Array.from(done))); } catch (_) {}
    syncHash();
  }
  applyDone();
  doc.addEventListener('change', function (e) {
    var cb = e.target;
    if (!cb || !cb.classList || !cb.classList.contains('briefv2-done')) return;
    var id = cb.getAttribute('data-done-id'); if (!id) return;
    if (cb.checked) done.add(id); else done.delete(id);
    persist(); applyDone();
  });

  /* ── Copy markdown for chat ─────────────────────────── */
  var copyBtn = $('#briefv2-copy-md');
  if (copyBtn) copyBtn.addEventListener('click', function () {
    var md = ($('#briefv2-daily-md') || {}).textContent || '';
    if (!md) { copyBtn.textContent = 'Нет данных'; setTimeout(function () { copyBtn.textContent = 'Копировать для чата'; }, 1500); return; }
    try {
      navigator.clipboard.writeText(md).then(function () {
        copyBtn.textContent = 'Скопировано';
        setTimeout(function () { copyBtn.textContent = 'Копировать для чата'; }, 1500);
      });
    } catch (_) {
      var ta = doc.createElement('textarea'); ta.value = md; doc.body.appendChild(ta); ta.select();
      try { doc.execCommand('copy'); } finally { doc.body.removeChild(ta); }
      copyBtn.textContent = 'Скопировано';
      setTimeout(function () { copyBtn.textContent = 'Копировать для чата'; }, 1500);
    }
  });

  /* ── Print ──────────────────────────────────────────── */
  var printBtn = $('#briefv2-print');
  if (printBtn) printBtn.addEventListener('click', function () {
    $$('.briefv2-row').forEach(function (r) { setRowOpen(r, true); });
    $$('details').forEach(function (d) { d.setAttribute('open', ''); });
    setTimeout(function () { window.print(); }, 200);
  });
})();
`;
}

/* ── Utils ──────────────────────────────────────────────────── */

function _downloadFile(html, filename) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function _paceTone(pace) {
  if (pace === 'ahead' || pace === 'on-track') return 'on-course';
  if (pace === 'behind') return 'off-course';
  return 'neutral';
}

function _anchorId(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 60) || 'x';
}

function _hostFromUrl(u) {
  try { return new URL(u).host; } catch (_) { return String(u || '').replace(/^https?:\/\//, '').split('/')[0]; }
}

function _slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'team';
}

function _dateStamp(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function _formatDate(d) {
  return d.toLocaleString('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function _truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function _esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _jsonScriptSafe(obj) {
  // Сэйфим JSON для <script type="application/json"> — нельзя </script инлайн.
  return JSON.stringify(obj || {}).replace(/<\//g, '<\\/');
}

function _plural(n, forms) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}
