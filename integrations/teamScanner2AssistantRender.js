'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — ASSISTANT RENDER (v2, 2026-06-03)
   --
   Чистый renderer для structured-output из rule-engine
   (teamScanner2AssistantRules.js) + LLM-narrative.

   Изменения 2026-06-03 (user feedback):
     • Убраны verdict-плашки (В плане / Отстаёт / Перевыполнил)
     • Убраны volume-chips (commits/PR/reviews/closed)
     • «Почему?» свёрнуто по умолчанию (details без open)
     • Per-task LLM extras удалены — теперь narrative-блок
       один на всю секцию сверху (как standup-status)
     • Под Jira-задачей вместо списка «Почему факт?» —
       timeline-визуализация событий в стиле «Лента 72ч»

   Public API:
     renderPlanHTML(planArtifact, opts) → string
     renderFactHTML(factArtifact, opts) → string
     renderSummary72hHTML(summary72hArtifact, opts) → string

   opts.narrativeHTML — готовый HTML для «Сводка ассистента»
                        блока сверху секции (от LLM)
   ============================================================ */

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _shortAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso);
  return d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function _kindLabel(kind, src) {
  if (src === 'bb' || kind === 'commit')  return 'commit';
  if (kind === 'pr')                       return 'PR';
  if (kind === 'review')                   return 'review';
  if (kind === 'edit' || src === 'cf')     return 'правка';
  if (kind === 'comment' || kind === 'commented') return 'comment';
  if (kind === 'closed')                   return 'закрытие';
  if (kind === 'transitioned')             return 'статус';
  return String(kind || 'event');
}

/** «Почему?» — два списка (Правила / Дополнительно от LLM), свёрнуто по умолчанию. */
function _rationaleHTML(rules, llm) {
  const ruleItems = (rules || []).map(r => `<li>${_esc(r)}</li>`).join('');
  const llmItems  = (llm  || []).map(r => `<li>${_esc(r)}</li>`).join('');
  if (!ruleItems && !llmItems) return '';
  return `
    <details class="ts2-asst-why">
      <summary>Почему?</summary>
      <div class="ts2-asst-why-body">
        ${ruleItems ? `<div class="ts2-asst-why-group"><div class="ts2-asst-why-grp-title">Правила:</div><ul>${ruleItems}</ul></div>` : ''}
        ${llmItems  ? `<div class="ts2-asst-why-group ts2-asst-why-llm"><div class="ts2-asst-why-grp-title">Дополнительно (LLM):</div><ul>${llmItems}</ul></div>` : ''}
      </div>
    </details>`;
}

/** Timeline-визуализация массива активностей — стиль «Лента 72ч» (light fork). */
function _timelineHTML(activities) {
  if (!Array.isArray(activities) || !activities.length) return '';
  // Группируем по дню в МСК (DD.MM)
  const byDay = new Map();
  for (const a of activities) {
    const ts = a.at ? Date.parse(a.at) : 0;
    if (!ts) continue;
    const dayKey = new Date(ts).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit' });
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey).push({ ...a, _ts: ts });
  }
  // Сортируем дни по убыванию времени (внутри тоже)
  const sortedDays = Array.from(byDay.entries())
    .map(([day, items]) => [day, items.sort((x, y) => y._ts - x._ts)])
    .sort((a, b) => b[1][0]._ts - a[1][0]._ts);

  const buckets = sortedDays.map(([day, items]) => {
    const lines = items.map(a => {
      const time = new Date(a._ts).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
      const text = String(a.text || a.title || '').slice(0, 140);
      const src = a._src || 'jira';
      const kind = _kindLabel(a.kind, src);
      const llmTag = a._llmAttributedTo ? `<span class="ts2-asst-tl-llm" title="${_esc(a._llmReason || '')}">LLM ${Math.round((a._llmConfidence || 0)*100)}%</span>` : '';
      return `
        <li class="ts2-asst-tl-item">
          <span class="ts2-asst-tl-time">${_esc(time)}</span>
          <span class="ts2-asst-tl-src ts2-asst-tl-src-${_esc(src)}">${_esc(src)}</span>
          <span class="ts2-asst-tl-kind">${_esc(kind)}</span>
          ${llmTag}
          <span class="ts2-asst-tl-text">${_esc(text)}</span>
        </li>`;
    }).join('');
    return `
      <div class="ts2-asst-tl-bucket">
        <div class="ts2-asst-tl-day">${_esc(day)}</div>
        <ul class="ts2-asst-tl-list">${lines}</ul>
      </div>`;
  }).join('');

  return `<div class="ts2-asst-timeline">${buckets}</div>`;
}

/**
 * Карточка одной задачи — общая для plan и fact.
 * Опции:
 *   withTimeline: показывать ли блок timeline-событий (используется в fact)
 *   isFact: вид для блока «Что делал вчера» (счётчик активностей)
 *
 * Поддержка sub-task / technical-task: t.parent = { key, summary } —
 * рисуется отдельной строкой под названием задачи.
 */
function _renderTaskCard(t, opts = {}) {
  if (!t) return '';
  const status = t.status ? `<span class="ts2-asst-task-meta">${_esc(t.status)}</span>` : '';
  const outsideWipBadge = t.outsideWip ? `<span class="ts2-asst-outside-wip">не в WIP</span>` : '';
  const cnt = (t.activities || []).length;
  const cntMeta = opts.isFact ? `<span class="ts2-asst-task-meta">${cnt} актив.</span>` : '';
  const parentLine = (t.parent && t.parent.key)
    ? `<div class="ts2-asst-task-parent">↳ родитель <span class="ts2-asst-task-key">${_esc(t.parent.key)}</span> <span class="ts2-asst-task-parent-title">${_esc(t.parent.summary || '')}</span></div>`
    : '';
  return `
    <div class="ts2-asst-task${opts.isFact ? ' ts2-asst-fact-task' : ''}">
      <div class="ts2-asst-task-head">
        <span class="ts2-asst-task-key">${_esc(t.key)}</span>
        <span class="ts2-asst-task-title">${_esc(t.title || t.summary || '(без названия)')}</span>
        ${outsideWipBadge}${status}${cntMeta}
      </div>
      ${parentLine}
      ${_rationaleHTML(t.rationale, t.rationaleLLM)}
      ${opts.withTimeline ? _timelineHTML(t.activities) : ''}
    </div>`;
}

/** LLM narrative-блок «Сводка ассистента» сверху секции. */
function _narrativeHTML(narrativeHTML, opts = {}) {
  if (!narrativeHTML) return '';
  if (narrativeHTML === '__loading__') {
    return `<div class="ts2-asst-narrative ts2-asst-narrative-loading"><div class="ts2-assistant-skeleton" aria-busy="true"><div class="ts2-assistant-skeleton-line"></div><div class="ts2-assistant-skeleton-line"></div></div></div>`;
  }
  if (narrativeHTML === '__unavailable__') {
    return `<div class="ts2-asst-narrative ts2-asst-narrative-unavailable">Сводка недоступна.</div>`;
  }
  return `<div class="ts2-asst-narrative">${narrativeHTML}</div>`;
}

/* ── Plan Today ───────────────────────────────────────────── */

export function renderPlanHTML(plan, opts = {}) {
  if (!plan) return `<div class="ts2-assistant-error">Нет данных для плана.</div>`;
  const tasks = (plan.tasks || []).slice(0, 12);
  const tasksHTML = tasks.length
    ? tasks.map(t => _renderTaskCard(t, { withTimeline: false })).join('')
    : `<div class="ts2-asst-empty">Нет активных задач в работе или в спринте.</div>`;

  return `
    <div class="ts2-asst-block">
      ${_narrativeHTML(opts.narrativeHTML)}
      <div class="ts2-asst-tasks">${tasksHTML}</div>
    </div>`;
}

/* ── Fact Yesterday ───────────────────────────────────────── */

export function renderFactHTML(fact, opts = {}) {
  if (!fact) return `<div class="ts2-assistant-error">Нет данных за вчера.</div>`;

  const tasks = (fact.jiraTasks || []).slice(0, 15);
  const tasksHTML = tasks.length
    ? tasks.map(t => _renderTaskCard(t, { withTimeline: true, isFact: true })).join('')
    : `<div class="ts2-asst-empty">Привязанных к Jira активностей за вчера нет.</div>`;

  const orphans = (fact.orphans || []).slice(0, 30);
  const orphansHTML = orphans.length ? `
    <details class="ts2-asst-orphans">
      <summary>Активности без привязки к задачам (${orphans.length})</summary>
      <div class="ts2-asst-orphans-hint">Не нашли JIRA-XX в заголовке, ветке/репо и поле issueKey. Возможно — инфра-репо, общее обсуждение, либо неучтённый формат.</div>
      <ul>
        ${orphans.map(o => `
          <li>
            <span class="ts2-asst-tl-src ts2-asst-tl-src-${_esc(o._src)}">${_esc(o._src || '—')}</span>
            <span class="ts2-asst-tl-time">${_esc(_shortAt(o.at))}</span>
            <span class="ts2-asst-tl-text">${_esc((o.title || o.text || '').slice(0, 200))}</span>
          </li>`).join('')}
      </ul>
    </details>` : '';

  return `
    <div class="ts2-asst-block">
      ${_narrativeHTML(opts.narrativeHTML)}
      <div class="ts2-asst-tasks">${tasksHTML}</div>
      ${orphansHTML}
    </div>`;
}

/* ── Summary 72h (Вчера + Сегодня) ──────────────────────────
   Структура (2026-06-04):
     ── ЧТО ДЕЛАЛ ВЧЕРА  (Сгенерировано GigaChat) ──
     [LLM narrative]
     > Подробнее ▾  (свёрнуто) → задачи + timeline + orphans
     ── ЧТО ДЕЛАЕТ СЕГОДНЯ  (Сгенерировано GigaChat) ──
     [LLM narrative]
     > Подробнее ▾  (свёрнуто) → задачи + rationale
*/

export function renderSummary72hHTML(summary72h, opts = {}) {
  if (!summary72h) return `<div class="ts2-assistant-error">Нет данных.</div>`;
  const factNarrative = _narrativeHTML(opts.factNarrativeHTML);
  const planNarrative = _narrativeHTML(opts.planNarrativeHTML);
  const factDetailsHTML = _renderFactDetails(summary72h.fact);
  const planDetailsHTML = _renderPlanDetails(summary72h.plan);

  return `
    <div class="ts2-asst-72h">
      <section class="ts2-asst-72h-section">
        <h3 class="ts2-asst-72h-title">Что делал вчера <span class="ts2-asst-72h-llm-tag">(Сгенерировано GigaChat)</span></h3>
        ${factNarrative}
        <details class="ts2-asst-details">
          <summary>Подробнее</summary>
          <div class="ts2-asst-details-body">${factDetailsHTML}</div>
        </details>
      </section>
      <section class="ts2-asst-72h-section">
        <h3 class="ts2-asst-72h-title">Что делает сегодня <span class="ts2-asst-72h-llm-tag">(Сгенерировано GigaChat)</span></h3>
        ${planNarrative}
        <details class="ts2-asst-details">
          <summary>Подробнее</summary>
          <div class="ts2-asst-details-body">${planDetailsHTML}</div>
        </details>
      </section>
    </div>`;
}

function _renderFactDetails(fact) {
  if (!fact) return `<div class="ts2-asst-empty">Нет данных за вчера.</div>`;
  const tasks = (fact.jiraTasks || []).slice(0, 15);
  const tasksHTML = tasks.length
    ? tasks.map(t => _renderTaskCard(t, { withTimeline: true, isFact: true })).join('')
    : `<div class="ts2-asst-empty">Привязанных к Jira активностей за вчера нет.</div>`;
  const orphans = (fact.orphans || []).slice(0, 30);
  const orphansHTML = orphans.length ? `
    <details class="ts2-asst-orphans">
      <summary>Активности без привязки к задачам (${orphans.length})</summary>
      <div class="ts2-asst-orphans-hint">Не нашли JIRA-XX в заголовке, ветке/репо и поле issueKey.</div>
      <ul>
        ${orphans.map(o => `
          <li>
            <span class="ts2-asst-tl-src ts2-asst-tl-src-${_esc(o._src)}">${_esc(o._src || '—')}</span>
            <span class="ts2-asst-tl-time">${_esc(_shortAt(o.at))}</span>
            <span class="ts2-asst-tl-text">${_esc((o.title || o.text || '').slice(0, 200))}</span>
          </li>`).join('')}
      </ul>
    </details>` : '';
  return `<div class="ts2-asst-tasks">${tasksHTML}</div>${orphansHTML}`;
}

function _renderPlanDetails(plan) {
  if (!plan) return `<div class="ts2-asst-empty">Нет данных для плана.</div>`;
  const tasks = (plan.tasks || []).slice(0, 12);
  const tasksHTML = tasks.length
    ? tasks.map(t => _renderTaskCard(t, { withTimeline: false })).join('')
    : `<div class="ts2-asst-empty">Нет активных задач в работе или в спринте.</div>`;
  return `<div class="ts2-asst-tasks">${tasksHTML}</div>`;
}
