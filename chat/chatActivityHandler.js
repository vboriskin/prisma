'use strict';
/* ============================================================
   CHAT ACTIVITY HANDLER — V13
   --
   High-level orchestrator for activity queries about IT engineers.

   Public surface:
     handleActivityQuery(text, deps) → { systemPrompt, userPrompt, mode,
                                          intent, params, needsClarification?, dataBlock }

   `deps` is an object so the handler stays testable:
     { pulseModel, knownEmployees, llm? }

   Pipeline:
     1. classifyActivityIntent(text) → which scenario
     2. extractParams (employee, date, issueKey)
     3. classifyActivityMode(text) → which system prompt to use
     4. If params insufficient → return { needsClarification: '...' }
     5. Build dataBlock from pulseModel
     6. Pick userTemplate, render with params + dataBlock
     7. Caller is responsible for sending {system, user} to LLM
   ============================================================ */

import {
  classifyActivityIntent, extractIssueKey, extractRelativeDate,
  extractEmployees, resolveDateRange, ACTIVITY_INTENTS,
} from './chatActivityIntents.js';
import {
  ACTIVITY_MODES, classifyActivityMode, buildActivitySystemPrompt,
  USER_TEMPLATES,
} from './chatActivityPrompts.js';

/* ────────────────────────────────────────────────────────────
   Data block builders — собирают строку с фактами для подстановки
   в user-prompt template.
   ──────────────────────────────────────────────────────────── */

/** "Что сейчас делает" — last event + сегодняшняя лента (top-5). */
function buildNowDataBlock(participant) {
  if (!participant) return '— участник не найден в данных Pulse';
  const today = participant.timelineToday || [];
  if (!today.length) return `Сегодня событий не зафиксировано. Назначенных WIP-задач: ${(participant.issuesNow || []).length}.`;
  const last = today[0];
  const lines = [];
  lines.push(`Последнее событие: ${last.at} — ${last.text}${last.issue?.key ? ' ('+last.issue.key+')' : ''}`);
  lines.push(`Назначенные WIP-задачи: ${(participant.issuesNow || []).map(i => i.key).slice(0, 5).join(', ') || '—'}`);
  lines.push(`Сегодня всего событий: ${today.length}`);
  if (participant.loggedTodaySec) lines.push(`Залогировано сегодня: ${Math.round(participant.loggedTodaySec/3600*10)/10}ч`);
  return lines.join('\n');
}

/** "Что делал вчера/сегодня/позавчера" — полная сводка дня. */
function buildDayDataBlock(participant, dateLabel) {
  if (!participant) return '— участник не найден';
  let timeline = [];
  let logged = 0;
  let done = [];
  if (dateLabel === 'today')           { timeline = participant.timelineToday      || []; logged = participant.loggedTodaySec      || 0; done = participant.doneToday      || []; }
  else if (dateLabel === 'yesterday')  { timeline = participant.timelineYesterday  || []; logged = participant.loggedYesterdaySec  || 0; done = participant.doneYesterday  || []; }
  else if (dateLabel === 'dayBefore')  { timeline = participant.timelinePrev       || []; logged = participant.loggedDayBeforeSec  || 0; done = participant.doneDayBefore  || []; }
  else return `Запрошенная дата (${dateLabel}) выходит за окно 48 часов — доступны только сегодня / вчера / позавчера.`;

  if (!timeline.length) return `За ${dateLabel} событий не зафиксировано в источниках.`;

  const eventsByKind = timeline.reduce((acc, e) => { acc[e.kind] = (acc[e.kind] || 0) + 1; return acc; }, {});
  const touched = [...new Set(timeline.map(e => e.issue?.key).filter(Boolean))];
  const focusKey = touched.reduce((best, k) => {
    const cnt = timeline.filter(e => e.issue?.key === k).length;
    if (cnt > (best.cnt || 0)) return { key: k, cnt };
    return best;
  }, {}).key;

  const lines = [];
  lines.push(`Всего событий: ${timeline.length}, разбивка по типам: ${Object.entries(eventsByKind).map(([k,v]) => `${k}=${v}`).join(', ')}`);
  lines.push(`Касался ${touched.length} задач: ${touched.slice(0,8).join(', ')}${touched.length > 8 ? ' +' + (touched.length - 8) : ''}`);
  if (focusKey) lines.push(`Основной фокус: ${focusKey} (${timeline.filter(e => e.issue?.key === focusKey).length} событий)`);
  if (logged) lines.push(`Залогировано: ${Math.round(logged/3600*10)/10}ч`);
  if (done.length) lines.push(`Завершено задач: ${done.map(i => i.key).join(', ')}`);
  // Top-5 events as a sample
  lines.push('');
  lines.push('Топ-5 событий:');
  for (const e of timeline.slice(0, 5)) {
    lines.push(`  ${e.at?.slice(11,16) || '—'} · ${e.kind} · ${e.issue?.key || ''} — ${(e.text || '').slice(0, 80)}`);
  }
  return lines.join('\n');
}

/** "Сравни" — несколько сотрудников, общая статистика. */
function buildCompareDataBlock(participants, period) {
  if (!participants.length) return '— нет данных по запрошенным сотрудникам';
  const rows = participants.map(p => {
    const today  = (p.timelineToday      || []).length;
    const yest   = (p.timelineYesterday  || []).length;
    const prev   = (p.timelinePrev       || []).length;
    const commits = p.badges?.commits48h || 0;
    const prs     = p.badges?.pr48h      || 0;
    const reviews = p.badges?.prReviews48h || 0;
    const tests   = p.badges?.testsExecuted48h || 0;
    return `${p.label}: сегодня=${today} событий · вчера=${yest} · позавчера=${prev} · commits=${commits} · PR=${prs} · ревью=${reviews} · прогонов тестов=${tests}`;
  });
  return `Период: ${period}\n` + rows.join('\n');
}

/** "По задаче" — список participants, у которых есть события на этом ключе. */
function buildByIssueDataBlock(participants, issueKey, period) {
  const matches = [];
  for (const p of participants) {
    const inToday  = (p.timelineToday      || []).filter(e => e.issue?.key === issueKey);
    const inYest   = (p.timelineYesterday  || []).filter(e => e.issue?.key === issueKey);
    const inPrev   = (p.timelinePrev       || []).filter(e => e.issue?.key === issueKey);
    const total = inToday.length + inYest.length + inPrev.length;
    if (total) matches.push({ label: p.label, total, today: inToday.length, yest: inYest.length, prev: inPrev.length });
  }
  if (!matches.length) return `По задаче ${issueKey} событий за ${period} не зафиксировано.`;
  const lines = [`Задача: ${issueKey}, период: ${period}`, ''];
  for (const m of matches) {
    lines.push(`  ${m.label}: всего ${m.total} событий (сегодня=${m.today}, вчера=${m.yest}, позавчера=${m.prev})`);
  }
  return lines.join('\n');
}

/** "Лента событий" — детальная хронология одного дня. */
function buildFeedDataBlock(participant, dateLabel) {
  if (!participant) return '— участник не найден';
  let timeline = [];
  if (dateLabel === 'today')          timeline = participant.timelineToday      || [];
  else if (dateLabel === 'yesterday') timeline = participant.timelineYesterday  || [];
  else if (dateLabel === 'dayBefore') timeline = participant.timelinePrev       || [];
  else return `Период ${dateLabel} вне окна 48ч.`;
  if (!timeline.length) return `За ${dateLabel} событий нет.`;
  // Хронологический порядок (raw timeline уже sorted newest-first; реверсим).
  return timeline.slice().reverse().map(e => {
    const time = (e.at || '').slice(11, 16);
    const key  = e.issue?.key ? `[${e.issue.key}] ` : '';
    return `${time} · ${e.kind} · ${key}${(e.text || '').slice(0, 100)}`;
  }).join('\n');
}

/** "Сводка по команде" — несколько сотрудников + дата. */
function buildTeamSummaryDataBlock(participants, dateLabel) {
  if (!participants.length) return '— нет участников в команде за указанный период';
  const lines = [`Команда: ${participants.length} человек, период: ${dateLabel}`, ''];
  for (const p of participants) {
    const block = buildDayDataBlock(p, dateLabel);
    lines.push(`### ${p.label}`);
    lines.push(block);
    lines.push('');
  }
  return lines.join('\n');
}

/* ────────────────────────────────────────────────────────────
   Главный хендлер
   ──────────────────────────────────────────────────────────── */

/**
 * @param {string} text — raw user message
 * @param {object} deps
 * @param {object} deps.pulseModel — analysePulse() output (.participants, etc)
 * @returns {object} { intent, mode, systemPrompt, userPrompt, dataBlock,
 *                     params, needsClarification? }
 */
export function handleActivityQuery(text, deps = {}) {
  const pulseModel = deps.pulseModel || null;
  const participants = pulseModel?.participants || [];

  const { intent } = classifyActivityIntent(text);
  if (!intent) return { intent: null };   // not an activity query

  const mode = classifyActivityMode(text);
  const systemPrompt = buildActivitySystemPrompt(mode);

  const knownEmployees = participants.map(p => ({ label: p.label, key: p.key }));
  const employees = extractEmployees(text, knownEmployees);
  const dateRel   = extractRelativeDate(text);
  const issueKey  = extractIssueKey(text);
  const range     = resolveDateRange(dateRel || 'today');
  const periodLbl = range?.label || dateRel || 'сегодня';

  // ── Build response per intent ──
  switch (intent) {
    case ACTIVITY_INTENTS.NOW: {
      if (!employees.length) {
        return { intent, mode, needsClarification: 'Уточните, активность какого сотрудника вас интересует?' };
      }
      const target = participants.find(p => p.label === employees[0]);
      const dataBlock = buildNowDataBlock(target);
      const userPrompt = USER_TEMPLATES.whatNow({
        employee: employees[0], dataBlock,
        lastEventAt: target?.timelineToday?.[0]?.at || '',
      });
      return { intent, mode, systemPrompt, userPrompt, dataBlock, params: { employees } };
    }

    case ACTIVITY_INTENTS.DAY: {
      if (!employees.length) {
        return { intent, mode, needsClarification: 'Какого сотрудника?' };
      }
      const dateForDay = dateRel || 'today';
      const target = participants.find(p => p.label === employees[0]);
      const dataBlock = buildDayDataBlock(target, dateForDay);
      const userPrompt = USER_TEMPLATES.whatOnDay({
        employee: employees[0], date: periodLbl, dataBlock,
        totalEvents: target ? (
          dateForDay === 'today' ? (target.timelineToday || []).length :
          dateForDay === 'yesterday' ? (target.timelineYesterday || []).length :
          (target.timelinePrev || []).length
        ) : 0,
      });
      return { intent, mode, systemPrompt, userPrompt, dataBlock, params: { employees, date: dateForDay } };
    }

    case ACTIVITY_INTENTS.COMPARE: {
      if (employees.length < 1) {
        return { intent, mode, needsClarification: 'Кого сравнить? Укажите хотя бы двух сотрудников.' };
      }
      const targets = employees.length >= 2
        ? participants.filter(p => employees.includes(p.label))
        : participants;   // "топ" без явных имён → все
      const dataBlock = buildCompareDataBlock(targets, periodLbl);
      const userPrompt = USER_TEMPLATES.compareEmployees({ employees: targets.map(t => t.label), period: periodLbl, dataBlock });
      return { intent, mode, systemPrompt, userPrompt, dataBlock, params: { employees: targets.map(t => t.label), period: periodLbl } };
    }

    case ACTIVITY_INTENTS.BY_ISSUE: {
      if (!issueKey) return { intent, mode, needsClarification: 'Не нашёл ключ задачи в запросе. Укажите PROJ-1234.' };
      const dataBlock = buildByIssueDataBlock(participants, issueKey, periodLbl);
      const userPrompt = USER_TEMPLATES.byIssue({ issueKey, period: periodLbl, dataBlock });
      return { intent, mode, systemPrompt, userPrompt, dataBlock, params: { issueKey, period: periodLbl } };
    }

    case ACTIVITY_INTENTS.FEED: {
      if (!employees.length) return { intent, mode, needsClarification: 'Чью ленту событий показать?' };
      const dateForFeed = dateRel || 'today';
      const target = participants.find(p => p.label === employees[0]);
      const dataBlock = buildFeedDataBlock(target, dateForFeed);
      const userPrompt = USER_TEMPLATES.eventFeed({ employee: employees[0], date: periodLbl, source: '', dataBlock });
      return { intent, mode, systemPrompt, userPrompt, dataBlock, params: { employees, date: dateForFeed } };
    }

    case ACTIVITY_INTENTS.TEAM: {
      const targets = employees.length ? participants.filter(p => employees.includes(p.label)) : participants;
      const dateForTeam = dateRel || 'today';
      const dataBlock = buildTeamSummaryDataBlock(targets, dateForTeam);
      const userPrompt = USER_TEMPLATES.teamSummary({ employees: targets.map(t => t.label), date: periodLbl, dataBlock });
      return { intent, mode, systemPrompt, userPrompt, dataBlock, params: { employees: targets.map(t => t.label), date: dateForTeam } };
    }

    case ACTIVITY_INTENTS.GENERIC:
    default: {
      if (!employees.length) return { intent, mode, needsClarification: 'Активность какого сотрудника интересует и за какой день?' };
      const target = participants.find(p => p.label === employees[0]);
      const dataBlock = buildDayDataBlock(target, dateRel || 'today');
      const userPrompt = USER_TEMPLATES.whatOnDay({
        employee: employees[0], date: periodLbl, dataBlock,
        totalEvents: target?.timelineToday?.length || 0,
      });
      return { intent, mode, systemPrompt, userPrompt, dataBlock, params: { employees, date: dateRel || 'today' } };
    }
  }
}
