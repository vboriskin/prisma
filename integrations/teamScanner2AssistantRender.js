'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — ASSISTANT RENDER
   --
   Чистый renderer для structured-output из rule-engine
   (teamScanner2AssistantRules.js) + опц. LLM-обогащения
   (teamScanner2AssistantLLM.js).

   Public API:
     renderPlanHTML(planArtifact, opts) → string
     renderFactHTML(factArtifact, opts) → string
     renderSummary72hHTML(summary72hArtifact, opts) → string
   ============================================================ */

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _verdictToneClass(code) {
  switch (code) {
    case 'overperforming': return 'on-course';
    case 'on_plan':        return 'on-course';
    case 'behind':         return 'off-course';
    case 'unknown':        return 'drift';
    default:               return 'drift';
  }
}

function _verdictBanner(verdict, drivers) {
  if (!verdict) return '';
  const tone = _verdictToneClass(verdict.code);
  const conf = verdict.confidence === 'low' ? '<span class="ts2-asst-conf">оценочно</span>' : '';
  const driversHTML = (drivers || []).slice(0, 5).map(d => `<li>${_esc(d)}</li>`).join('');
  return `
    <div class="ts2-asst-verdict ts2-asst-verdict-${tone}">
      <div class="ts2-asst-verdict-top">
        <span class="ts2-asst-verdict-label">${_esc(verdict.label || '')}</span>
        ${conf}
      </div>
      ${driversHTML ? `<ul class="ts2-asst-verdict-drivers">${driversHTML}</ul>` : ''}
    </div>`;
}

function _rationaleHTML(rules, llm) {
  const ruleItems = (rules || []).map(r => `<li>${_esc(r)}</li>`).join('');
  const llmItems  = (llm  || []).map(r => `<li>${_esc(r)}</li>`).join('');
  if (!ruleItems && !llmItems) return '';
  return `
    <details class="ts2-asst-why" open>
      <summary>Почему?</summary>
      <div class="ts2-asst-why-body">
        ${ruleItems ? `<div class="ts2-asst-why-group"><div class="ts2-asst-why-grp-title">Правила:</div><ul>${ruleItems}</ul></div>` : ''}
        ${llmItems  ? `<div class="ts2-asst-why-group ts2-asst-why-llm"><div class="ts2-asst-why-grp-title">Дополнительно (LLM):</div><ul>${llmItems}</ul></div>` : ''}
      </div>
    </details>`;
}

function _volumeChips(volume) {
  if (!volume) return '';
  const chips = [];
  const order = [
    { k: 'commits', l: 'коммиты' },
    { k: 'prs',     l: 'PR' },
    { k: 'reviews', l: 'ревью' },
    { k: 'closed',  l: 'закрытых' },
  ];
  for (const { k, l } of order) {
    const v = volume[k];
    if (!v) continue;
    const raw = volume.raw?.[k] ?? 0;
    const tone = v.label === 'много' ? 'on-course' : v.label === 'мало' ? 'off-course' : 'drift';
    const base = (v.baseline != null) ? ` · средн. ${v.baseline}` : '';
    const conf = v.confidence === 'heuristic' ? ' (по нормам)' : (v.confidence === 'low' ? ' (мало истории)' : '');
    chips.push(`<span class="ts2-asst-vol-chip ts2-asst-vol-${tone}" title="${_esc(l)}: ${raw}${base}${conf}">${_esc(l)}: <b>${raw}</b> · ${_esc(v.label)}</span>`);
  }
  return `<div class="ts2-asst-vol-row">${chips.join('')}</div>`;
}

/* ── Plan Today ───────────────────────────────────────────── */

export function renderPlanHTML(plan, opts = {}) {
  if (!plan) return `<div class="ts2-assistant-error">Нет данных для плана.</div>`;
  const verdict = _verdictBanner(plan.verdict, [
    `Задач в плане: ${plan.counts?.total ?? plan.tasks?.length ?? 0}`,
    plan.verdict?.warnings?.[0] || '',
  ].filter(Boolean));
  const tasks = (plan.tasks || []).slice(0, 12);
  const tasksHTML = tasks.length
    ? tasks.map(t => {
        const status = t.status ? `<span class="ts2-asst-task-meta">${_esc(t.status)}</span>` : '';
        const src = t._source === 'wip' ? 'WIP' : (t._source === 'sprint' ? 'спринт' : '');
        const srcChip = src ? `<span class="ts2-asst-src-chip">${_esc(src)}</span>` : '';
        return `
          <div class="ts2-asst-task">
            <div class="ts2-asst-task-head">
              <span class="ts2-asst-task-key">${_esc(t.key)}</span>
              <span class="ts2-asst-task-title">${_esc(t.title || t.summary || '(без названия)')}</span>
              ${srcChip}${status}
            </div>
            ${_rationaleHTML(t.rationale, t.rationaleLLM)}
          </div>`;
      }).join('')
    : `<div class="ts2-asst-empty">Нет активных задач в WIP / спринте.</div>`;

  return `
    <div class="ts2-asst-block">
      ${verdict}
      <div class="ts2-asst-tasks">${tasksHTML}</div>
    </div>`;
}

/* ── Fact Yesterday ───────────────────────────────────────── */

export function renderFactHTML(fact, opts = {}) {
  if (!fact) return `<div class="ts2-assistant-error">Нет данных за вчера.</div>`;
  const drivers = [
    `Задач в работе: ${fact.jiraTasks?.length ?? 0}`,
    `Коммитов: ${fact.volume?.raw?.commits ?? 0} (${fact.volume?.commits?.label ?? '—'})`,
    `Закрытых: ${fact.volume?.raw?.closed ?? 0} (${fact.volume?.closed?.label ?? '—'})`,
    fact.orphans?.length ? `Активностей без привязки: ${fact.orphans.length}` : '',
  ].filter(Boolean);
  const verdict = _verdictBanner(fact.verdict, drivers);
  const volume = _volumeChips(fact.volume);

  const tasks = (fact.jiraTasks || []).slice(0, 15);
  const tasksHTML = tasks.length
    ? tasks.map(t => {
        const activitiesHTML = (t.activities || []).map(a => {
          const at = a.at ? `<span class="ts2-asst-act-at">${_esc(_shortAt(a.at))}</span>` : '';
          const src = a._src ? `<span class="ts2-asst-act-src ts2-asst-act-src-${a._src}">${_esc(a._src)}</span>` : '';
          return `
            <li class="ts2-asst-act">
              <div class="ts2-asst-act-head">
                ${src} ${at}
                <span class="ts2-asst-act-text">${_esc((a.text || '').slice(0, 200))}</span>
              </div>
              ${a.rationale ? `<details class="ts2-asst-act-why" open><summary>Почему факт?</summary><ul>${a.rationale.map(r => `<li>${_esc(r)}</li>`).join('')}</ul></details>` : ''}
            </li>`;
        }).join('');
        const outsideWipBadge = t.outsideWip ? `<span class="ts2-asst-outside-wip">не в WIP</span>` : '';
        return `
          <div class="ts2-asst-task ts2-asst-fact-task">
            <div class="ts2-asst-task-head">
              <span class="ts2-asst-task-key">${_esc(t.key)}</span>
              <span class="ts2-asst-task-title">${_esc(t.title || '(без названия)')}</span>
              ${outsideWipBadge}
              <span class="ts2-asst-task-meta">${(t.activities || []).length} актив.</span>
            </div>
            ${_rationaleHTML(t.rationale, t.rationaleLLM)}
            ${activitiesHTML ? `<ol class="ts2-asst-acts">${activitiesHTML}</ol>` : ''}
          </div>`;
      }).join('')
    : `<div class="ts2-asst-empty">Привязанных к Jira активностей за вчера нет.</div>`;

  const orphans = (fact.orphans || []).slice(0, 30);
  const orphansHTML = orphans.length ? `
    <details class="ts2-asst-orphans" open>
      <summary>Активности без привязки к задачам (${orphans.length})</summary>
      <div class="ts2-asst-orphans-hint">Не нашли JIRA-XX ни в заголовке, ни в ветке/репо, ни в поле issueKey. Возможно — инфра-репозиторий, общее обсуждение, либо неучтённый формат.</div>
      <ul>
        ${orphans.map(o => `
          <li>
            <span class="ts2-asst-act-src ts2-asst-act-src-${_esc(o._src)}">${_esc(o._src || '—')}</span>
            <span class="ts2-asst-act-at">${_esc(_shortAt(o.at))}</span>
            <span class="ts2-asst-act-text">${_esc((o.title || o.text || '').slice(0, 200))}</span>
            ${o._llmAttributedTo ? `<span class="ts2-asst-llm-link" title="${_esc(o._llmReason || '')}">→ ${_esc(o._llmAttributedTo)} (LLM ${Math.round((o._llmConfidence || 0) * 100)}%)</span>` : ''}
          </li>`).join('')}
      </ul>
    </details>` : '';

  return `
    <div class="ts2-asst-block">
      ${verdict}
      ${volume}
      <div class="ts2-asst-tasks">${tasksHTML}</div>
      ${orphansHTML}
    </div>`;
}

/* ── Summary 72h ──────────────────────────────────────────── */

export function renderSummary72hHTML(summary72h, opts = {}) {
  if (!summary72h) return `<div class="ts2-assistant-error">Нет данных.</div>`;
  const overall = _verdictBanner(
    { label: summary72h.overall?.label, code: summary72h.overall?.code, confidence: 'medium' },
    summary72h.overall?.drivers || []
  );
  const factHTML = renderFactHTML(summary72h.fact, opts);
  const planHTML = renderPlanHTML(summary72h.plan, opts);
  return `
    <div class="ts2-asst-72h">
      <div class="ts2-asst-72h-header">${overall}</div>
      <div class="ts2-asst-72h-section">
        <div class="ts2-asst-72h-title">Что делал вчера</div>
        ${factHTML}
      </div>
      <div class="ts2-asst-72h-section">
        <div class="ts2-asst-72h-title">Что делает сегодня</div>
        ${planHTML}
      </div>
    </div>`;
}

function _shortAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso);
  const fmt = d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return fmt;
}
