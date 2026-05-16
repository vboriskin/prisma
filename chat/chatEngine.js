'use strict';
/* ============================================================
   CHAT ENGINE — v10_0
   Main orchestrator for the Planning Assistant.
   Handles rule-based intents + LLM calls.

   Public API:
     ChatEngine.process(text, contextOverride)  — main entry point
     ChatEngine.buildLLMPrompt(intent, params, ctx) — for LLM path

   TODO AUDIT_ARCHITECTURE #16 — `app/llmAssistant.js` (i drugie vneshnie
   callsite'y) dolzhny import'it' eti funkcii cherez `../chat/index.js`
   (public facade), a ne napryamuyu iz `../chat/chatEngine.js`. Migraciya
   postepennaya: snachala perevodyatsya novye callsite'y, potom ratchet'om
   migrirovat' starye i zapret no-restricted-imports v eslint.
   ============================================================ */

import { state } from '../state.js';
import { Utils } from '../utils.js';
import { parseIntent, parseIntentCategory, isRuleBased, INTENTS } from './chatIntentParser.js';
import { buildContextForIntent } from './chatContextBuilder.js';
import { parseStructuredFromLLM } from './chatUIRenderer.js';
import { buildBatchPreview, matchRowsByFilter } from './chatActions.js';
import { buildDailyReport, readChangeLog } from './chatReports.js';
import { explainMetric, explainRelease, explainTeamOverload, explainRow } from './chatExplain.js';
import { getPrompt, PROMPTS } from './chatPrompts.js';
// V13 — activity intent handling. Imported separately so existing flow stays
// untouched; activity queries are routed BEFORE parseIntent() classification.
import { handleActivityQuery } from './chatActivityHandler.js';
import { classifyActivityIntent } from './chatActivityIntents.js';
import { Services } from '../app/services.js';

// V22+ Week 2 (LP-01) — Long-period employee deep-dive builder.
import { buildEmployeeReport } from './employeeReport.js';
// V22+ Week 1 (I-01) — Universal resolver: один target для всех builder'ов.
import { resolveTarget, rememberTarget } from './resolveTarget.js';
// V22+ Week 3 — domain-specific query builders.
import { buildSourceQueryResponse } from './sourceQueries.js';
import { buildBlackDashQueryResponse } from './blackDashQueries.js';
import { buildGanttQueryResponse } from './ganttQueries.js';
// V22+ Phase 4 (K-K1, K-K6) — cross-source CEO update + explain engine.
import { buildCEOUpdate } from './ceoUpdate.js';
import { buildExplainResponse as buildWhyExplainResponse } from './explainEngine.js';

/* ── Helpers ─────────────────────────────────────────────── */

function pct(n, d) { return d ? Math.round(n / d * 100) : 0; }
// V21 L (audit-2026-05-03 §I, Quick win 1) — делегирует в Utils.plural,
// сохраняя `${n} ${form}` совместимость для существующих call-sites.
function plural(n, one, few, many) {
  return `${n} ${Utils.plural(n, one, few, many)}`;
}
// V21 T — shortcut для самых частых форм («задача/задачи/задач»,
// «блокер/блокера/блокеров»). Сделано чтобы строки в reports'ах не
// превращались в нечитаемые `plural(n, 'задача','задачи','задач')`.
const _pl_task    = (n) => plural(n, 'задача', 'задачи', 'задач');
const _pl_blocker = (n) => plural(n, 'блокер', 'блокера', 'блокеров');
const _pl_risk    = (n) => plural(n, 'риск', 'риска', 'рисков');
function relLabel(key) {
  const map = { r120:'1.20', r121:'1.21', r122:'1.22', overtime:'Овертайм', backlog:'Бэклог' };
  return map[key] || key;
}
function teamRows(rows, team) {
  return team ? rows.filter(r => r.team && r.team.toLowerCase().includes(team.toLowerCase())) : rows;
}

/* ── Rule-based response builders ────────────────────────── */

function buildExecutiveSummaryResponse(ctx) {
  const s = ctx.stats;
  const text = `## Сводка по проекту\n\n**Всего задач:** ${s.total} · **Сделано:** ${s.done} (${s.donePct}%) · **Блокеры:** ${s.blockers} · **Риски:** ${s.risky}\n\n**Релизные окна:** 1.20 — ${_pl_task(s.r120)}, 1.21 — ${s.r121}, 1.22 — ${s.r122}, Овертайм — ${s.overtime}\n\n**В скоупе:** ${s.inScope}, без релиза: ${s.unassigned}`;

  const cards = ctx.teams.slice(0, 5).map(t => ({
    title: t.team, iconKey: 'users',
    body: `${_pl_task(t.total)} · ${t.done} сделано · ${_pl_blocker(t.blockers)} · ${_pl_risk(t.risky)}`,
    badge: t.blockers > 0 ? `${t.blockers} блок.` : (t.done === t.total && t.total > 0 ? '' : null),
    badgeColor: t.blockers > 0 ? 'red' : 'green',
  }));

  // F13 fix (chat-04 audit) — actions передают контекст (фильтр блокеров),
  // если в summary были блокеры/риски. Иначе юзер шёл в чистый Реестр и
  // снова искал то, что чат уже подсветил.
  const hasBlockers = s?.blockers > 0;
  const hasRisks    = s?.risky > 0;
  const actions = [
    hasBlockers
      ? { label: `Реестр · только блокеры (${s.blockers})`, type: 'apply_filter', payload: { onlyBlocking: true } }
      : { label: 'Открыть реестр', type: 'navigate', payload: { section: 'registry' } },
    hasRisks
      ? { label: `Реестр · только риски (${s.risky})`, type: 'apply_filter', payload: { onlyRisky: true } }
      : { label: 'Перейти к Гант', type: 'navigate', payload: { section: 'gantt' } },
    { label: 'Экспорт сводки', type: 'export_summary', payload: { text: text }, primary: false },
  ];

  const drilldown = [
    { text: 'Показать блокеры', prompt: 'Перечисли все блокеры и их влияние на релизы.' },
    { text: 'Главные риски', prompt: 'Какие главные риски сейчас и почему они критичны?' },
    { text: 'План действий', prompt: 'Составь план действий по устранению блокеров и рисков.' },
  ];

  return { text, cards, actions, drilldown };
}

function buildReleaseOverviewResponse(ctx) {
  const rel = relLabel(ctx.release);
  const s = ctx.stats;
  const text = `## Релиз ${rel}\n\n**Задач:** ${s.total} · **Готово:** ${s.done} (${s.donePct}%) · **Блокеры:** ${s.blockers} · **Риски:** ${s.risky}\n\n${s.blockers > 0 ? `${plural(s.blockers,'блокер','блокера','блокеров')} могут задержать релиз.` : 'Блокеров нет.'}`;

  const cards = ctx.teams.slice(0, 6).map(t => ({
    title: t.team, iconKey: 'tag',
    body: `${_pl_task(t.total)} · ${t.done} готово`,
    badge: t.blockers > 0 ? `${t.blockers} блок.` : null,
    badgeColor: 'red',
  }));

  const drellRels = ['r120','r121','r122'].filter(r => r !== ctx.release);
  const drilldown = [
    ...drellRels.map(r => ({ text: `Релиз ${relLabel(r)}`, prompt: `Покажи статус по релизу ${relLabel(r)}.` })),
    { text: 'Блокеры этого релиза', prompt: `Перечисли блокеры для релиза ${rel}.` },
  ];

  const actions = [
    { label: `Фильтр по ${rel}`, type: 'apply_filter', payload: { release: rel.replace('.',''), noNavigate: false } },
    { label: 'Открыть Гант', type: 'navigate', payload: { section: 'gantt' } },
  ];

  return { text, cards, actions, drilldown };
}

function buildTeamOverviewResponse(ctx) {
  const teams = ctx.teamBreakdown || [];
  const header = ctx.requestedTeam
    ? `## Команда: ${ctx.requestedTeam}\n\n**Задач:** ${ctx.stats.total} · **Готово:** ${ctx.stats.done} · **Блокеры:** ${ctx.stats.blockers}`
    : `## Обзор команд\n\n**Всего команд:** ${teams.length}`;

  const cards = teams.slice(0, 6).map(t => ({
    title: t.team, iconKey: 'users',
    body: `${_pl_task(t.total)} · ${t.done} готово · ${_pl_blocker(t.blockers)} · ${_pl_risk(t.risky)}`,
    badge: t.blockers > 0 ? '' : (pct(t.done, t.total) > 70 ? '' : null),
    badgeColor: t.blockers > 0 ? 'red' : 'green',
  }));

  const topTeam = teams[0];
  const drilldown = [
    topTeam && { text: `Детали: ${topTeam.team}`, prompt: `Расскажи подробнее о статусе команды ${topTeam.team}.` },
    { text: 'Кто перегружен?', prompt: 'Кто из исполнителей перегружен сейчас?' },
    { text: 'Риски по командам', prompt: 'Перечисли риски по каждой команде.' },
  ].filter(Boolean);

  return { text: header, cards, drilldown, actions: [] };
}

function buildRisksResponse(ctx) {
  const s = ctx.stats;
  const riskTypes = ctx.riskTypes || {};
  const riskLines = Object.entries(riskTypes)
    .sort((a,b) => b[1] - a[1])
    .map(([k, v]) => `- **${k}**: ${v}`)
    .join('\n');

  const text = `## Риски и блокеры\n\n**Блокеров:** ${s.blockers} · **Рискованных задач:** ${s.risky}\n\n${riskLines ? `### Типы рисков:\n${riskLines}` : ''}`;

  const cards = ctx.blockers.slice(0, 4).map(r => ({
    title: r.epic || r.tasks || '—', iconKey: 'no-symbol',
    body: `${r.team || '—'} · ${(r.riskFlags||[]).join(', ') || 'блокер'}`,
    badge: 'БЛОКЕР', badgeColor: 'red',
  }));

  const drilldown = [
    { text: 'Как снять блокеры?', prompt: 'Предложи конкретные шаги для снятия текущих блокеров.' },
    { text: 'Что критично для 1.20?', prompt: 'Что критично для релиза 1.20 и может его задержать?' },
    { text: 'Plan действий', prompt: 'Составь план устранения топ-5 рисков.' },
  ];

  const actions = [
    { label: 'Только блокеры', type: 'apply_filter', payload: { onlyBlocking: true }, primary: true },
    { label: 'Только риски',   type: 'apply_filter', payload: { onlyRisky: true } },
    { label: 'Сбросить',        type: 'clear_filters', payload: {} },
  ];

  return { text, cards, actions, drilldown };
}

function buildOverloadResponse(ctx) {
  const top5 = (ctx.assignees || []).slice(0, 5);
  const lines = top5.map(a => `- **${a.name}**: ${_pl_task(a.total)} (r120:${a.r120}, r121:${a.r121}, r122:${a.r122}${a.blockers ? `, блокеров: ${a.blockers}` : ''})`).join('\n');
  const text = `## Нагрузка исполнителей\n\n${lines || 'Данных об исполнителях нет.'}`;

  const cards = top5.map(a => ({
    title: a.name, iconKey: 'user',
    body: `Всего: ${a.total} · 1.20: ${a.r120} · 1.21: ${a.r121} · 1.22: ${a.r122}`,
    badge: a.total > 5 ? 'Высокая' : (a.total > 2 ? 'Средняя' : 'Норма'),
    badgeColor: a.total > 5 ? 'red' : (a.total > 2 ? 'orange' : 'green'),
  }));

  const drilldown = [
    { text: 'Перегруженные команды', prompt: 'Какие команды сейчас перегружены?' },
    { text: 'Перераспределение задач', prompt: 'Как перераспределить задачи, чтобы снизить перегруз?' },
  ];

  return { text, cards, actions: [], drilldown };
}

function buildMeetingPrepResponse(ctx) {
  const typeLabels = { grooming: 'груминга', demo: 'демо', retro: 'ретро', sprint_review: 'sprint review', meeting: 'встречи' };
  const typeLabel = typeLabels[ctx.meetingType] || 'встречи';
  const s = ctx.stats;

  let agenda = '';
  if (ctx.meetingType === 'grooming') {
    agenda = `**Повестка груминга:**\n- Бэклог без релиза: ${_pl_task(s.unassigned)}\n- Разобрать блокеры: ${s.blockers}\n- Уточнить scope: задач "Требует подтверждения"`;
  } else if (ctx.meetingType === 'demo') {
    agenda = `**Повестка демо:**\n- Готовые задачи: ${s.done}\n- Демонстрируем: ${s.done} фич\n- Следующий релиз: ${_pl_task(s.r121)}`;
  } else if (ctx.meetingType === 'retro') {
    agenda = `**Повестка ретро:**\n- Что хорошо: ${_pl_task(s.done)} закрыто\n- Что мешало: ${_pl_blocker(s.blockers)}\n- Что улучшить: ${_pl_risk(s.risky)}`;
  } else {
    agenda = `**Повестка встречи:**\n- Статус: ${s.done}/${s.total} задач готово\n- Блокеры: ${s.blockers}\n- Риски: ${s.risky}`;
  }

  const text = `## Подготовка к ${typeLabel}\n\n${agenda}`;

  const drilldown = [
    { text: 'Добавить детали', prompt: `Расширь повестку ${typeLabel} — добавь конкретные задачи и имена.` },
    { text: 'Какие вопросы задать?', prompt: `Какие вопросы стоит поднять на ${typeLabel}?` },
  ];

  const actions = [
    { label: 'Открыть реестр',   type: 'navigate', payload: { section: 'registry' } },
    { label: 'Экспорт повестки', type: 'export_summary', payload: { text: `${text}\n\nДата: ${new Date().toLocaleDateString('ru')}` } },
  ];

  return { text, cards: [], actions, drilldown };
}

function buildReleaseNotesResponse(ctx) {
  const rel = relLabel(ctx.release);
  const doneItems = (ctx.done || []).slice(0, 20);
  const lines = doneItems.map(r => `- ${r.epic || r.tasks || '—'} (${r.team || '—'})`).join('\n');
  const text = `## Release Notes: ${rel}\n\n**Готово:** ${doneItems.length} задач\n\n${lines || 'Выполненных задач не найдено.'}`;

  const actions = [
    { label: 'Скачать release notes', type: 'export_summary',
      payload: { text: `Release Notes — ${rel}\n${new Date().toLocaleDateString('ru')}\n\n${lines}` }, primary: true },
  ];

  const drilldown = [
    { text: 'Добавить описания', prompt: `Добавь краткие описания к каждой задаче в release notes для ${rel}.` },
    { text: 'Что ещё в активной разработке?', prompt: `Что ещё не готово для ${rel}?` },
  ];

  return { text, cards: [], actions, drilldown };
}

function buildAskPlanResponse(ctx) {
  const s = ctx.stats;
  const plan = [
    { step: 1, title: `Снять ${s.blockers} блокеров`, detail: 'Назначить ответственных, уточнить сроки', done: s.blockers === 0 },
    { step: 2, title: `Закрыть ${s.risky} рискованных задач`, detail: 'Проверить статус, эскалировать при необходимости', done: s.risky === 0 },
    { step: 3, title: `Распределить ${s.unassigned} задач без релиза`, detail: 'Приоритезировать бэклог, назначить в релизные окна', done: s.unassigned === 0 },
    { step: 4, title: 'Проверить загрузку команд', detail: 'Убедиться что нет перегруза по исполнителям', done: false },
    { step: 5, title: 'Подготовить статус для stakeholders', detail: 'Сформировать CEO-update на следующую встречу', done: false },
  ];

  const text = `## План действий\n\n**Текущий статус:** ${s.done}/${s.total} задач готово (${s.donePct}%)\nПриоритет: устранение блокеров → риски → распределение бэклога.`;

  const drilldown = [
    { text: 'Детализировать шаг 1', prompt: 'Как именно снять текущие блокеры? Назови конкретные задачи.' },
    { text: 'Добавить сроки', prompt: 'Добавь сроки к каждому шагу плана действий.' },
    { text: 'Распределить по командам', prompt: 'Разбей план действий по командам — кто что делает.' },
  ];

  const actions = [
    { label: 'Показать блокеры', type: 'apply_filter', payload: { onlyBlocking: true }, primary: true },
    { label: 'Экспорт плана', type: 'export_summary',
      payload: { text: plan.map(p => `${p.step}. ${p.title}\n   ${p.detail}`).join('\n') } },
  ];

  return { text, plan, actions, drilldown };
}

function buildFilterTasksResponse(ctx) {
  const p = ctx.appliedParams || {};
  const parts = [];
  if (p.team)         parts.push(`команда "${p.team}"`);
  if (p.release)      parts.push(`релиз ${p.release}`);
  if (p.onlyBlocking) parts.push('только блокеры');
  if (p.onlyRisky)    parts.push('только рискованные');
  if (p.onlyDone)     parts.push('только сделанные');

  const text = `## Фильтрация задач\n\nПрименяю фильтры: ${parts.length ? parts.join(', ') : 'нет параметров'}.\nВидимых задач: ${ctx.visibleCount} из ${ctx.totalCount}.`;

  const actions = [
    { label: 'Применить фильтры', type: 'apply_filter', payload: p, primary: true },
    { label: 'Сбросить',           type: 'clear_filters', payload: {} },
  ];

  const drilldown = [
    { text: 'Уточнить по команде', prompt: 'Покажи задачи конкретной команды.' },
    { text: 'Только риски',        prompt: 'Покажи только рискованные задачи.' },
  ];

  return { text, actions, drilldown, cards: [] };
}

const REVIEW_PERSONAS = {
  ceo: {
    badge: 'CEO View',
    prompt: 'Посмотри на данные как CEO. Что вызывает наибольшие вопросы? Дай executive summary на 5 пунктов — только самое важное для принятия решений.',
    drilldown: [
      { text: 'Что докладывать совету?', prompt: 'Что доложить совету директоров по текущему статусу?' },
      { text: 'Ключевые решения', prompt: 'Какие решения нужно принять CEO в ближайшие 7 дней?' },
    ],
  },
  dm: {
    badge: 'DM View',
    prompt: 'Посмотри на данные как Delivery Manager. Что мешает доставке? Оцени риски сроков, блокеры и командную нагрузку.',
    drilldown: [
      { text: 'Риски сроков', prompt: 'Какие задачи могут не успеть к своим дедлайнам?' },
      { text: 'Разблокировка', prompt: 'Как быстрее всего разблокировать критический путь?' },
    ],
  },
  risk: {
    badge: 'Risk Officer',
    prompt: 'Посмотри на данные как Risk Officer. Выдели топ рисков, оцени вероятность и влияние, предложи mitigation.',
    drilldown: [
      { text: 'Митигация рисков', prompt: 'Предложи конкретный план митигации топ-3 рисков.' },
      { text: 'Триггеры эскалации', prompt: 'Какие триггеры должны привести к эскалации?' },
    ],
  },
  lead: {
    badge: 'Team Lead',
    prompt: 'Посмотри на данные как Team Lead. Что стоит обсудить с командой сегодня? Кто перегружен, где нужна помощь?',
    drilldown: [
      { text: 'Кому помочь?', prompt: 'Кому из команды нужна помощь прямо сейчас?' },
      { text: 'Повестка стендапа', prompt: 'Составь повестку для утреннего стендапа.' },
    ],
  },
};

function buildReviewModeResponse(ctx) {
  const persona = REVIEW_PERSONAS[ctx.role] || REVIEW_PERSONAS.ceo;
  const text = `## Режим обзора: ${persona.badge}\n\nКонтекст загружен. Анализирую данные с позиции **${persona.badge}**…`;

  const actions = [
    { label: `Запустить анализ (${persona.badge})`, type: 'send_prompt',
      payload: { prompt: persona.prompt }, primary: true },
    { label: '↩ Обычный режим', type: 'set_review_mode', payload: { role: null } },
  ];

  return {
    text,
    cards: [],
    actions,
    drilldown: persona.drilldown,
    reviewMode: { role: ctx.role, badge: persona.badge },
  };
}

/* ── Operations response builders ───────────────────────── */

function buildFindTasksResponse(params) {
  const filter = params.filters || params.filter || {};
  const matched = matchRowsByFilter(filter);
  const total   = (state.rows || []).length;

  const parts = [];
  if (filter.team)         parts.push(`команда "${filter.team}"`);
  if (filter.release)      parts.push(`релиз ${filter.release}`);
  if (filter.scopeStatus)  parts.push(`scope = "${filter.scopeStatus}"`);
  if (filter.onlyBlocking) parts.push('только блокеры');
  if (filter.onlyRisky)    parts.push('только рискованные');
  if (filter.isUnassigned) parts.push('без релиза');
  if (filter.noAssignee)   parts.push('без исполнителя');

  const filterDesc = parts.length ? parts.join(', ') : 'без ограничений';
  const preview5   = matched.slice(0, 5);
  const moreCount  = matched.length - preview5.length;
  const previewLines = preview5.map(r =>
    `- **${r.epic || r.tasks || '—'}** · ${r.team || '—'}${r.blockingDependency ? ' · _блокер_' : ''}${(r.riskFlags||[]).length ? ' · _риск_' : ''}`
  ).join('\n');

  const text = matched.length === 0
    ? `## Поиск задач\n\nПо критериям (${filterDesc}) **ничего не найдено**.\nПопробуй изменить запрос.`
    : `## Найдено: ${matched.length} из ${total}\n\n**Критерии:** ${filterDesc}\n\n${previewLines}${moreCount > 0 ? `\n- _...и ещё ${moreCount}_` : ''}`;

  const actions = matched.length > 0 ? [
    { label: `Показать в реестре (${matched.length})`, type: 'apply_filter', payload: filter, primary: true },
    { label: 'Сбросить', type: 'clear_filters', payload: {} },
  ] : [
    { label: 'Сбросить фильтры', type: 'clear_filters', payload: {} },
  ];

  const drilldown = [
    matched.length > 0 && { text: 'Кто ответственен?', prompt: `Кто отвечает за эти ${matched.length} задач?` },
    { text: 'Уточнить поиск', prompt: 'Найди задачи с другими критериями.' },
    matched.some(r => r.blockingDependency) && { text: 'Блокеры в результате', prompt: 'Объясни блокеры из этого списка.' },
  ].filter(Boolean);

  return { text, cards: [], actions, drilldown };
}

function buildExplainResponse(params) {
  const target  = params.target  || '';
  const metric  = params.metric  || '';
  const release = params.release || '';
  const team    = params.team    || '';

  let result;

  // Route to the right explainer
  if (metric) {
    result = explainMetric(metric, { release, team });
  } else if (release) {
    result = explainRelease(release);
  } else if (team) {
    result = explainTeamOverload(team);
  } else if (target) {
    // Could be a row id, epic name, or metric name
    result = explainMetric(target, {}) || explainRow(target);
  }

  if (!result || !result.text) {
    return {
      text: `## Объяснение\n\nНе удалось определить, что именно объяснить. Уточни запрос: напиши, например, «объясни healthScore» или «почему релиз 1.20 под угрозой».`,
      cards: [], actions: [], drilldown: [
        { text: 'Объяснить healthScore',   prompt: 'Объясни formula healthScore.' },
        { text: 'Объяснить riskScore',     prompt: 'Объясни как считается riskScore задачи.' },
        { text: 'Объяснить нагрузку команды', prompt: 'Объясни загрузку команды.' },
      ],
    };
  }

  const drilldown = result.drilldown || [
    { text: 'Что улучшить?', prompt: `Как улучшить показатель: ${metric || release || team || target}?` },
    { text: 'Как это считается?', prompt: `Покажи формулу расчёта: ${metric || 'этого показателя'}.` },
  ];

  return {
    text: result.text,
    cards: result.cards || [],
    actions: result.actions || [],
    drilldown,
  };
}

function buildDailyReportResponse() {
  const report = buildDailyReport();

  if (!report.hasHistory) {
    return {
      text: `## Ежедневный отчёт\n\nИстории изменений ещё нет — это первый запуск или снимок не сохранялся.\n\nТекущий статус: **${report.stats.done}** из **${report.stats.total}** задач сделано (${report.stats.donePct}%), блокеров: **${report.stats.blockers}**, рисков: **${report.stats.risky}**.`,
      cards: [], actions: [
        { label: '📸 Сохранить снимок', type: 'take_snapshot', payload: {}, primary: true },
      ],
      drilldown: [
        { text: 'Показать риски', prompt: 'Перечисли все текущие риски.' },
        { text: 'Текущие блокеры', prompt: 'Перечисли блокеры.' },
      ],
    };
  }

  const d  = report.diff;
  const s  = report.stats;
  const ha = Math.round(report.hoursAgo);
  const since = ha < 2 ? 'час назад' : ha < 24 ? `${ha} ч. назад` : `${Math.round(ha/24)} дн. назад`;

  const diffLines = [];
  if (d.newlyDone?.length)      diffLines.push(`Закрыто задач: **${d.newlyDone.length}**`);
  if (d.newlyBlocking?.length)  diffLines.push(`Новых блокеров: **${d.newlyBlocking.length}**`);
  if (d.newRisks?.length)       diffLines.push(`Новых рисков: **${d.newRisks.length}**`);
  if (d.releaseChanged?.length) diffLines.push(`🔀 Перенесено между релизами: **${d.releaseChanged.length}**`);
  if (d.scopeChanged?.length)   diffLines.push(`Изменился scope: **${d.scopeChanged.length}**`);
  if (d.newRows?.length)        diffLines.push(`➕ Новых задач: **${d.newRows.length}**`);
  if (d.removedRows?.length)    diffLines.push(`➖ Удалено задач: **${d.removedRows.length}**`);

  const noChanges = diffLines.length === 0;
  const diffBlock = noChanges ? '_Изменений не обнаружено._' : diffLines.join('\n');

  const text = `## Ежедневный отчёт\n\n**Снимок от:** ${since} (${report.snapDate})\n**Статус:** ${s.done}/${s.total} сделано (${s.donePct}%) · блокеров: ${s.blockers} · рисков: ${s.risky}\n\n### Изменения:\n${diffBlock}`;

  const attBlock = (report.attention || []).map(a => `- ${a}`).join('\n');
  const recBlock = (report.recommendations || []).map((r, i) => `${i+1}. ${r}`).join('\n');

  const full = text
    + (attBlock ? `\n\n### Требует внимания:\n${attBlock}` : '')
    + (recBlock ? `\n\n### Рекомендации:\n${recBlock}` : '');

  const cards = [];
  if (d.newlyDone?.length) {
    cards.push(...d.newlyDone.slice(0, 3).map(r => ({
      title: r.epic || r.tasks || '—', iconKey: 'check-circle',
      body: `Закрыто · ${r.team || '—'}`,
      badge: 'Готово', badgeColor: 'green',
    })));
  }
  if (d.newlyBlocking?.length) {
    cards.push(...d.newlyBlocking.slice(0, 3).map(r => ({
      title: r.epic || r.tasks || '—', iconKey: 'no-symbol',
      body: `Новый блокер · ${r.team || '—'}`,
      badge: 'БЛОКЕР', badgeColor: 'red',
    })));
  }

  const actions = [
    { label: '📸 Обновить снимок', type: 'take_snapshot', payload: {} },
    { label: 'Реестр',          type: 'navigate',      payload: { section: 'registry' } },
    { label: 'Экспорт отчёта',  type: 'export_summary', payload: { text: full } },
  ];

  const drilldown = [
    d.newlyBlocking?.length && { text: 'Разобрать новые блокеры', prompt: 'Объясни новые блокеры и как их снять.' },
    d.newRisks?.length      && { text: 'Новые риски подробнее',   prompt: 'Расскажи о новых рисках.' },
    { text: 'Plan действий на сегодня', prompt: 'Составь план действий на основе изменений за последние сутки.' },
  ].filter(Boolean);

  return { text: full, cards, actions, drilldown };
}

/**
 * V22 K-04 (audit-experts-2026-05-15 Zhuravlev killer #10) —
 * Stand-up Generator. Rule-based, мгновенный (без LLM). Текст для
 * тимлида: «Вчера / Сегодня / Блокеры / Не зашло».
 *
 * Источники:
 *  · Вчера сделано — `state.rows[].isDone` + `r.doneAt` за последние 24ч
 *    (если нет doneAt — берём newlyDone из daily-snapshot diff'а).
 *  · Сегодня в работе — `r.inProgress === true` ИЛИ `r.hasReleaseNNN` без `isDone`.
 *  · Блокеры — Registry (`r.blockingDependency`) + Scanner blockers (если loaded).
 *  · «Не зашло» — `r.scopeChanged` к 1.22 или Overtime за последние 7 дней.
 *
 * Identity-resolve по `params.team` (если упомянута).
 */
function buildStandUpResponse(params = {}) {
  const allRows = state.rows || [];
  const team = params.team || null;
  const rows = team
    ? allRows.filter(r => String(r.team || '').toLowerCase() === String(team).toLowerCase())
    : allRows;
  const teamLabel = team ? `команда «${team}»` : 'весь портфель';

  // ── Вчера: newlyDone (за <24h) ──
  const cutoff24 = Date.now() - 24 * 3600 * 1000;
  const doneYesterday = rows.filter(r => {
    if (!r.isDone) return false;
    const at = r.doneAt || r.updatedAt;
    if (!at) return false;
    const ts = Date.parse(at);
    return Number.isFinite(ts) && ts >= cutoff24;
  }).slice(0, 8);

  // ── Сегодня в работе ──
  const inProgress = rows.filter(r => !r.isDone && (r.inProgress || (r.assignee && (r.hasRelease120 || r.hasRelease121 || r.hasRelease122))));
  const top = inProgress.slice(0, 8);

  // ── Блокеры (registry) ──
  const blockers = rows.filter(r => !r.isDone && r.blockingDependency).slice(0, 6);

  // ── «Не зашло» — переносы в OT / 1.22 за неделю ──
  const cutoff7d = Date.now() - 7 * 24 * 3600 * 1000;
  const punted = rows.filter(r => {
    if (r.isDone) return false;
    if (!r.hasOvertime && !r.hasRelease122) return false;
    const at = r.updatedAt;
    if (!at) return false;
    const ts = Date.parse(at);
    return Number.isFinite(ts) && ts >= cutoff7d;
  }).slice(0, 5);

  const lines = [
    `## Стенд-ап · ${teamLabel}`,
    '',
    `**Вчера:** ${doneYesterday.length} закрыто${doneYesterday.length ? ' (' + doneYesterday.map(r => r.epic || r.tasks || '—').slice(0, 3).join(', ') + (doneYesterday.length > 3 ? '…' : '') + ')' : ''}.`,
    `**Сегодня в работе:** ${top.length}${top.length ? ' · ' + top.map(r => r.epic || r.tasks || '—').slice(0, 3).join(', ') + (top.length > 3 ? '…' : '') : ''}.`,
    blockers.length
      ? `**Блокеры:** ${blockers.length}${blockers.length ? ' (' + blockers.map(r => r.epic || r.tasks || '—').slice(0, 3).join(', ') + (blockers.length > 3 ? '…' : '') + ')' : ''}.`
      : `**Блокеры:** нет.`,
    punted.length
      ? `**Не зашло:** ${punted.length} (отложены на 1.22/Овертайм за неделю).`
      : '',
  ].filter(Boolean);

  const cards = [
    { title: 'Закрыто вчера',     value: String(doneYesterday.length), hint: doneYesterday.length ? 'за последние 24 часа' : 'нет завершённых задач' },
    { title: 'В работе сегодня',  value: String(top.length), hint: 'активных задач' },
    { title: 'Блокеры',           value: String(blockers.length), hint: blockers.length ? 'требуют внимания' : 'нет открытых блокеров' },
    { title: 'Перенесено',        value: String(punted.length), hint: 'в 1.22 / Овертайм за 7 дней' },
  ];

  const actions = [];
  if (blockers.length) {
    actions.push({ label: `Только блокеры (${blockers.length})`, type: 'apply_filter', payload: { onlyBlocking: true }, primary: true });
  }
  if (team) {
    actions.push({ label: `Открыть Реестр команды`, type: 'apply_filter', payload: { team } });
  }

  const drilldown = [
    blockers.length      && { text: 'Объясни блокеры',      prompt: 'Перечисли каждый блокер с обоснованием.' },
    punted.length        && { text: 'Что перенесли?',       prompt: 'Объясни почему задачи переносятся в 1.22 / Овертайм.' },
    doneYesterday.length && { text: 'Кто закрыл задачи?',   prompt: 'Перечисли вчерашние закрытия с исполнителями.' },
    { text: 'Полный ежедневный отчёт', prompt: 'Сформируй ежедневный отчёт.' },
  ].filter(Boolean);

  return { text: lines.join('\n'), cards, actions, drilldown };
}

function buildHistoryResponse(params) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const dateFilter = params.today ? todayStr : (params.date || null);
  const entries = readChangeLog({
    date:  dateFilter,
    rowId: params.rowId,
    field: params.field,
    limit: params.limit || 20,
  });

  if (!entries || entries.length === 0) {
    return {
      text: `## История изменений\n\nЗаписей не найдено${dateFilter ? ` за ${dateFilter}` : ''}.\n\nИстория пишется при каждом применении пакетных действий через чат.`,
      cards: [], actions: [], drilldown: [
        { text: 'Ежедневный отчёт', prompt: 'Сформируй ежедневный отчёт.' },
      ],
    };
  }

  const lines = entries.slice(0, 15).map(e => {
    const ts = e.at ? new Date(e.at).toLocaleString('ru', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
    return `- \`${ts}\` · **${e.label || e.type}** · ${e.count ? `${e.count} задач` : ''} ${e.simMode ? '_(sim)_' : ''}`;
  }).join('\n');

  const moreCount = entries.length - 15;
  const text = `## История изменений${dateFilter ? ` за ${dateFilter}` : ''}\n\n**Записей:** ${entries.length}\n\n${lines}${moreCount > 0 ? `\n- _...и ещё ${moreCount}_` : ''}`;

  const actions = [
    { label: 'Экспорт истории', type: 'export_summary',
      payload: { text: `История изменений\n\n${lines}` } },
  ];

  const drilldown = [
    { text: 'Показать за сегодня', prompt: 'Покажи историю изменений за сегодня.' },
    { text: 'Ежедневный отчёт',    prompt: 'Сформируй ежедневный отчёт.' },
  ];

  return { text, cards: [], actions, drilldown };
}

function buildClearFiltersResponse() {
  return {
    text: `## Фильтры сброшены\n\nПоказываю все задачи без ограничений.`,
    cards: [],
    actions: [
      { label: 'Сбросить фильтры', type: 'clear_filters', payload: {}, primary: true },
    ],
    drilldown: [
      { text: 'Показать только блокеры', prompt: 'Показать задачи с блокерами.' },
      { text: 'Показать только риски',   prompt: 'Показать рискованные задачи.' },
    ],
  };
}

function buildConfirmBatchResponse() {
  const pending = state.llm?.pendingBatch;
  if (!pending) {
    return {
      text: `Нет ожидающего действия для применения. Сначала задай команду, например: «перенеси задачи без релиза в 1.22».`,
      cards: [], actions: [], drilldown: [
        { text: 'Перенести задачи', prompt: 'Перенеси задачи без релиза в 1.22.' },
      ],
    };
  }
  // Delegate to action executor — return a confirm_batch action so bindActionClicks picks it up
  return {
    text: `Применяю: **${pending.label}** (${pending.rowIds?.length} задач)…`,
    cards: [],
    actions: [
      // L3 fix: убран `autoExecute: true`. Поле — пережиток, реально не
      // выполняется (`bindActionClicks` игнорирует), но может быть скопировано
      // LLM в свои ответы и стать auto-click-vector в будущем.
      { label: `Применить (${pending.rowIds?.length})`, type: 'confirm_batch',
        payload: { batchId: pending.id }, primary: true },
      // C15 fix (chat-03 audit §13 reversibility) — парная «Отмена» рядом
      // с Apply, чтобы юзер мог свернуть preview одним кликом без поиска
      // drilldown'а. type=cancel_batch уже зарегистрирован в action executor'е.
      { label: 'Отмена', type: 'cancel_batch', payload: { batchId: pending.id } },
    ],
    drilldown: [],
  };
}

function buildCancelBatchResponse() {
  const pending = state.llm?.pendingBatch;
  const label   = pending?.label || 'действие';
  if (state.llm) state.llm.pendingBatch = null;

  return {
    text: `Отменено: ${label}. Никаких изменений не внесено.`,
    cards: [],
    actions: [
      { label: 'Реестр', type: 'navigate', payload: { section: 'registry' } },
    ],
    drilldown: [
      { text: 'Новый запрос', prompt: 'Что нужно сделать с задачами?' },
    ],
  };
}

/* ── LLM prompt builder ──────────────────────────────────── */

const STRUCTURED_SUFFIX = `

В конце ответа ОБЯЗАТЕЛЬНО добавь блок JSON в формате:
\`\`\`json
{
  "cards": [],
  "actions": [],
  "drilldown": [{"text":"...", "prompt":"..."}],
  "plan": []
}
\`\`\`
Массивы могут быть пустыми. Добавь 2-3 follow-up вопроса в drilldown.`;

export function buildLLMPrompt(intent, params, ctx) {
  const ctxStr = JSON.stringify(ctx, null, 0).slice(0, 6000); // limit size
  const intentHints = {
    [INTENTS.EXECUTIVE_SUMMARY]: 'Сформируй краткий executive summary. Выдели топ-5 пунктов.',
    [INTENTS.RELEASE_NOTES]: 'Сформируй release notes для указанного релиза.',
    [INTENTS.WHAT_RISKS]: 'Перечисли главные риски и блокеры. Оцени их влияние.',
    [INTENTS.ASK_PLAN]: 'Составь конкретный план действий по приоритетам.',
    [INTENTS.MEETING_PREP]: 'Подготовь повестку встречи с конкретными пунктами.',
    [INTENTS.OVERLOAD]: 'Проанализируй нагрузку исполнителей и команд.',
    [INTENTS.GENERIC]: 'Ответь на вопрос пользователя, опираясь на данные контекста.',
  };
  const hint = intentHints[intent] || intentHints[INTENTS.GENERIC];
  return `${hint}\n\nКонтекст данных:\n${ctxStr}${STRUCTURED_SUFFIX}`;
}

/* ============================================================
   Intent-based prompt parts (system + user) for LLM path.
   Selects a category via parseIntentCategory and delegates
   to PROMPTS[category]. Falls back to PROMPTS.general.
   ============================================================ */
export function buildPromptParts(intent, params, ctx, userText) {
  const { category, source } = parseIntentCategory(userText, intent);
  const prompt = getPrompt(category);   // never throws; falls back to general
  const system = prompt.system;
  const user   = prompt.buildUserPrompt(ctx, String(userText || ''));
  return { category, source, label: prompt.label, system, user };
}

/* Optional dev-mode logging — toggled by window.__CHAT_DEBUG === true.
   We log intent + category + truncated prompts. Tokens are NEVER read here. */
function _devLogPrompt(parts, intent) {
  try {
    if (typeof window === 'undefined' || window.__CHAT_DEBUG !== true) return;
    /* eslint-disable no-console */
    const cap = (s, n) => (s && s.length > n ? s.slice(0, n) + `…(+${s.length - n} chars)` : (s || ''));
    console.groupCollapsed(`%c[chat] intent=${intent} · category=${parts.category} (${parts.source})`, 'color:#7c3aed;font-weight:700');
    console.log('label:', parts.label);
    console.log('system (trim):', cap(parts.system, 400));
    console.log('user (trim):',   cap(parts.user,   500));
    console.groupEnd();
    /* eslint-enable no-console */
  } catch(_) {}
}

/* ── Main process function ───────────────────────────────── */

/**
 * Process a user message.
 * Returns either a structured response (for rule-based) or
 * triggers LLM streaming (via the provided callbacks).
 *
 * @param {string}   userText
 * @param {object}   opts
 * @param {Function} opts.onRuleBased  - called with { structured } for immediate response
 * @param {Function} opts.onLLMPrompt  - called with { messages, structured: false } for LLM path
 * @param {string}   [opts.contextOverride] - force context mode
 */
export function process(userText, opts = {}) {
  // V13 — short-circuit on activity queries BEFORE the legacy classifier.
  // Activity intents have their own pipeline (chatActivityHandler), so we
  // ask first if the user is asking about engineer activity. If yes, the
  // handler returns either a clarification request or a {systemPrompt,
  // userPrompt} pair the LLM path can use directly.
  const activityProbe = classifyActivityIntent(userText);
  if (activityProbe.intent) {
    // F11 fix (chat-04 audit) — public getModel() с fallback на приватное
    // _model для совместимости с тестами/старыми сборками.
    const pp = (typeof window !== 'undefined') ? Services.PortfolioPulse : null;
    const pulseModel = (pp?.getModel?.() ?? pp?._model) || null;
    const result = handleActivityQuery(userText, { pulseModel });
    if (result.needsClarification) {
      opts.onRuleBased?.({
        structured: { text: result.needsClarification, cards: [], actions: [], drilldown: [] },
        intent: 'activity_clarify', ctx: null,
      });
      return;
    }
    if (result.systemPrompt && result.userPrompt) {
      // Hand off to LLM with the activity-specific prompts. We DO NOT call
      // getPrompt(category) here — activity has its own prompt registry in
      // chatActivityPrompts.js, so the existing system prompts don't apply.
      opts.onLLMPrompt?.({
        messages: [
          { role: 'system', content: result.systemPrompt },
          { role: 'user',   content: result.userPrompt },
        ],
        structured: false,
        intent: result.intent,
        ctx: { mode: result.mode, params: result.params, dataBlock: result.dataBlock },
      });
      return;
    }
    // Fallthrough: activity probe matched but handler had nothing → fall to legacy.
  }

  let { intent, confidence, params } = parseIntent(userText);
  // L12 fix (chat-01 audit): low-confidence rule-match → fallback в LLM-маршрут.
  // Шаблонные ответы при шумном regex-match создают «уверенный мусор», лучше
  // отдать в LLM с general-категорией. Telemetry для последующего тюнинга rules.
  if (isRuleBased(intent) && intent !== INTENTS.GENERIC && confidence < 0.6) {
    if (typeof window !== 'undefined' && window.HistoryLog?.event) {
      try { window.HistoryLog.event('chat.intent.misroute', { intent, confidence, len: userText.length }); } catch (_) {}
    }
    intent = INTENTS.GENERIC;
    params = {};
  }
  const ctx = buildContextForIntent(intent, params);

  if (isRuleBased(intent)) {
    let structured;
    switch (intent) {
      case INTENTS.EXECUTIVE_SUMMARY: structured = buildExecutiveSummaryResponse(ctx); break;
      case INTENTS.RELEASE_OVERVIEW:  structured = buildReleaseOverviewResponse(ctx); break;
      case INTENTS.TEAM_OVERVIEW:     structured = buildTeamOverviewResponse(ctx); break;
      case INTENTS.WHAT_RISKS:        structured = buildRisksResponse(ctx); break;
      case INTENTS.OVERLOAD:          structured = buildOverloadResponse(ctx); break;
      case INTENTS.MEETING_PREP:      structured = buildMeetingPrepResponse(ctx); break;
      case INTENTS.RELEASE_NOTES:     structured = buildReleaseNotesResponse(ctx); break;
      case INTENTS.ASK_PLAN:          structured = buildAskPlanResponse(ctx); break;
      case INTENTS.FILTER_TASKS:      structured = buildFilterTasksResponse(ctx); break;
      case INTENTS.REVIEW_MODE:       structured = buildReviewModeResponse(ctx); break;
      // ── Operations ──
      case INTENTS.BATCH_ACTION:      structured = buildBatchPreview(params); break;
      case INTENTS.FIND_TASKS:        structured = buildFindTasksResponse(params); break;
      case INTENTS.EXPLAIN:           structured = buildExplainResponse(params); break;
      case INTENTS.DAILY_REPORT:      structured = buildDailyReportResponse(); break;
      case INTENTS.STAND_UP:          structured = buildStandUpResponse(params); break;  // V22 K-04
      // V22+ Week 2 (LP-01) — Employee deep-dive: async fetcher, путь
      // отдельный (см. ниже после switch'а).
      case INTENTS.EMPLOYEE_REPORT:   structured = null; break;
      // V22+ Week 3 — domain queries (sync, через resolveTarget).
      case INTENTS.SOURCE_QUERY: {
        const t = resolveTarget(userText);
        structured = buildSourceQueryResponse(t);
        try { rememberTarget(t); } catch (_) {}
        break;
      }
      case INTENTS.BD_QUERY: {
        const t = resolveTarget(userText);
        structured = buildBlackDashQueryResponse(t);
        try { rememberTarget(t); } catch (_) {}
        break;
      }
      case INTENTS.GANTT_QUERY: {
        const t = resolveTarget(userText);
        structured = buildGanttQueryResponse(t);
        try { rememberTarget(t); } catch (_) {}
        break;
      }
      // V22+ Phase 4 (K-K1) — Cross-source CEO update.
      case INTENTS.CEO_UPDATE: {
        const t = resolveTarget(userText);
        structured = buildCEOUpdate(t, { releaseId: params.releaseId });
        try { rememberTarget(t); } catch (_) {}
        break;
      }
      // V22+ Phase 4 (K-K6) — Why/explain engine.
      case INTENTS.WHY_QUERY: {
        const t = resolveTarget(userText);
        structured = buildWhyExplainResponse(t, params);
        try { rememberTarget(t); } catch (_) {}
        break;
      }
      case INTENTS.HISTORY:           structured = buildHistoryResponse(params); break;
      case INTENTS.CLEAR_FILTERS:     structured = buildClearFiltersResponse(); break;
      case INTENTS.CONFIRM_BATCH:     structured = buildConfirmBatchResponse(); break;
      case INTENTS.CANCEL_BATCH:      structured = buildCancelBatchResponse(); break;
      default:                        structured = { text: '…', cards: [], actions: [], drilldown: [] };
    }
    // V22+ Week 2 (LP-01) — Employee deep-dive: async путь.
    // buildEmployeeReport нуждается в fetcher'е (Jira/BB/CF API calls).
    // Используем resolveTarget для извлечения employee+period+sources,
    // потом async build → onRuleBased.
    if (intent === INTENTS.EMPLOYEE_REPORT) {
      const target = resolveTarget(userText);
      // Если employee не извлёкся — возвращаем err sync (без fetch).
      if (!target.employee) {
        const errStructured = {
          text: 'Не удалось найти сотрудника в запросе. Попробуйте: «Иванов за квартал», «Сидорова за год», «Петров в марте 2026».',
          cards: [], actions: [], drilldown: [],
          responseSource: 'rule',
        };
        opts.onRuleBased?.({ structured: errStructured, intent, ctx });
        return;
      }
      // Async fetch + build. Не блокируем sync return.
      (async () => {
        try {
          const built = await buildEmployeeReport(target, target.period, {
            preset: params.preset || 'full',
            includeComparison: !!params.includeComparison,
            // V22+ Week 4 (LP-09) — undefined (не false) если не явно set,
            // чтобы preset='review' мог auto-enable narrative.
            aiNarrative: params.aiNarrative,
            signal: opts.signal,
          });
          try { rememberTarget(target); } catch (_) {}
          opts.onRuleBased?.({ structured: built, intent, ctx });
        } catch (e) {
          console.warn('[chatEngine] employee_report failed:', e);
          opts.onRuleBased?.({
            structured: {
              text: `Не удалось собрать отчёт: ${String(e?.message || e).slice(0, 120)}`,
              cards: [], actions: [], drilldown: [],
              isError: true,
              responseSource: 'rule',
            },
            intent, ctx,
          });
        }
      })();
      return;
    }
    opts.onRuleBased?.({ structured, intent, ctx });
    return;
  }

  // LLM path — build focused prompt parts (system + user, intent-category-aware)
  const llmPrompt = buildLLMPrompt(intent, params, ctx);   // legacy single-blob prompt — kept for backward compat
  const parts     = buildPromptParts(intent, params, ctx, userText);
  _devLogPrompt(parts, intent);
  opts.onLLMPrompt?.({
    llmPrompt,                    // backward compat: existing single-blob form
    system:    parts.system,      // new: separate system prompt
    user:      parts.user,        // new: separate user prompt
    category:  parts.category,    // 'search' | 'explain' | 'action' | 'analysis' | 'planning' | 'report' | 'general'
    label:     parts.label,       // human-readable badge for UI
    intent,
    ctx,
  });
}

/**
 * Parse streaming LLM text into structured response.
 * Returns the structured object (possibly with empty arrays if no JSON block yet).
 */
export function parseLLMResponse(fullText) {
  return parseStructuredFromLLM(fullText);
}
