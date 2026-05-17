'use strict';
/* ============================================================
   chat/resolveTarget.js — V22+ Week 1 (I-01, I-04)

   Универсальный резолвер сверху для всех чат-builder'ов. Заменяет
   локальные regex'ы в SCANNER_QUERY / chatActivityHandler / chatActions
   единым контрактом.

   Возвращаемый формат:

   {
     employee:  { ref: 'email|jiraId|fio', id, label } | null,
     team:      { name, source: 'extract'|'context' } | null,
     epic:      { id, source } | null,
     release:   { id: '1.20'|'1.21'|'1.22'|'overtime'|'backlog' } | null,
     sources:   string[]              // ['bb', 'cf', 'jira', 'zephyr']
     period:    PeriodObject | null,  // см. periodParser.js
     action:    'show'|'find'|'compare'|'standup'|null,
     ambiguity: { kind:'employee'|'team', candidates:[...] } | null,
     raw:       { text, lc }
   }

   Контракты:
     · Identity-deterministic для employee (email > jiraAccountId > [X]-фильтр).
     · НЕ ищет по подстроке ФИО если есть точное email/jiraId совпадение.
     · Не throw'ает, возвращает { ..., ambiguity: null } для всех полей.
     · Если несколько кандидатов на employee — заполняет ambiguity, оставляет
       employee = first candidate (caller сам решает: рендерить clarify
       или пользоваться first).
   ============================================================ */

import { state } from '../state.js';
import { parsePeriod } from './periodParser.js';
import { loadSettings as _loadIntegrationsSettings } from '../integrations/integrationsStore.js';

// ── Source detection patterns ─────────────────────────────────
const SOURCE_PATTERNS = Object.freeze({
  jira:    /(?:^|[^а-яёa-z])(?:jira|джир[аыеу]|жир[аы])/i,
  bb:      /(?:^|[^а-яёa-z])(?:bitbucket|битбакет|bb|пул(?:л)?\s*-?\s*реквест|pr\b|коммит[ыов]?)/i,
  cf:      /(?:^|[^а-яёa-z])(?:confluence|конфлюенс|cf|стран[а-яё]+|page[s]?)/i,
  zephyr:  /(?:^|[^а-яёa-z])(?:zephyr|зефир|тест-кейс|test\s*case)/i,
});

// ── Action detection patterns ─────────────────────────────────
const ACTION_PATTERNS = Object.freeze({
  compare:  /(?:сравни|сравнить|сопостав|vs\b|против)/i,
  find:     /(?:найди|найти|покажи|показать|выведи|вывести|перечисли|который|которые)/i,
  standup:  /(?:стенд\s*-?\s*ап|стендап|планёрк|летучк)/i,
  show:     /(?:расскажи|расскаж|что|какие|сколько|кто|инфо|информ|сводка|сводку)/i,
});

// ── Release-window patterns ───────────────────────────────────
const RELEASE_PATTERNS = [
  { id: '1.20',    re: /(?:^|[^\d])1[._]20(?:[^\d]|$)/ },
  { id: '1.21',    re: /(?:^|[^\d])1[._]21(?:[^\d]|$)/ },
  { id: '1.22',    re: /(?:^|[^\d])1[._]22(?:[^\d]|$)/ },
  { id: 'overtime', re: /(?:овертайм|overtime|внепланов)/i },
  { id: 'backlog',  re: /(?:бэклог|backlog|очеред[а-яё]+)/i },
];

// ── Jira-key extraction ───────────────────────────────────────
const JIRA_KEY_RE = /(?:^|[^A-Z0-9])([A-Z][A-Z0-9]{1,5}-\d{1,6})(?:[^A-Z0-9]|$)/;

/* ─────────────────────────────────────────────────────────────
   Identity-deterministic employee resolve
   ───────────────────────────────────────────────────────────── */

/**
 * Список employees из state, отфильтрованных от уволенных ([X]/[Х]/[B]/[В]).
 * Идемпотентный — фильтр работает по флагу `deactivated` ИЛИ по суффиксу в фио.
 */
function _activeEmployees() {
  const all = (state && state.employees) || [];
  return all.filter(e => {
    if (!e) return false;
    if (e.deactivated === true) return false;
    const fio = String(e.fio || e.name || '');
    if (/\[[XХВB]\]\s*$/i.test(fio)) return false;
    return true;
  });
}

/**
 * Извлечь кандидатов на сотрудника из текста.
 * Возвращает массив матчей; пустой если ничего не найдено.
 *
 * Стратегия (по приоритету):
 *  1. Точный email (Иванов@sber.ru) — identity-deterministic.
 *  2. Точный jiraAccountId.
 *  3. Match по фамилии (≥3 символа) против state.employees[].fio.
 *  4. Match по полному ФИО.
 */
function _extractEmployees(text, lc) {
  const employees = _activeEmployees();
  if (!employees.length) return [];
  const matches = [];

  // 1. Email match
  const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const emailMatches = text.match(emailRe) || [];
  for (const em of emailMatches) {
    const emLc = em.toLowerCase();
    const found = employees.find(e => String(e.email || '').toLowerCase() === emLc);
    if (found) {
      matches.push({ ref: 'email', id: found.email, label: found.fio || found.name || found.email, _emp: found });
    }
  }

  // 2. JiraAccountId — обычно длинные альфанумерические идентификаторы
  // (форма «5b10ac8d82e05b22cc7d4ef5») — берём только если в тексте 24+ hex
  const jaidRe = /\b[a-f0-9]{24,}\b/gi;
  const jaidMatches = text.match(jaidRe) || [];
  for (const j of jaidMatches) {
    const found = employees.find(e => String(e.jiraAccountId || '') === j);
    if (found && !matches.some(m => m.id === found.email)) {
      matches.push({ ref: 'jiraId', id: found.jiraAccountId, label: found.fio || found.name || j, _emp: found });
    }
  }

  // 3. ФИО match — по фамилии (первое слово ФИО), мин. длина 3
  // Identity-deterministic prefix-match: «Иванов»-stem matches «Иванов»,
  // «Иванова» (gen.), «Иванову» (dat.) etc. — все падежи русского.
  // НЕ matches arbitrary substring («Ив»  «Ивановский»). Используем
  // word-boundary с allowance для падежных окончаний.
  for (const e of employees) {
    const fio = String(e.fio || e.name || '').trim();
    if (!fio) continue;
    const lastName = fio.split(/\s+/)[0] || '';
    if (lastName.length < 3) continue;
    const lastNameLc = lastName.toLowerCase();
    // Match stem + optional 1-3 char падежный suffix. Регекс:
    //   (start|non-letter) + last-name + (optional 1-3 русских букв) + (non-letter|end)
    const re = new RegExp(
      `(?:^|[^а-яёa-z])${_escapeRegex(lastNameLc)}[а-яё]{0,3}(?:[^а-яёa-z]|$)`,
      'i'
    );
    if (re.test(lc)) {
      if (!matches.some(m => m._emp === e)) {
        matches.push({ ref: 'fio', id: e.email || e.jiraAccountId || fio, label: fio, _emp: e });
      }
    }
  }

  return matches;
}

function _escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ─────────────────────────────────────────────────────────────
   Team / Epic / Release extraction
   ───────────────────────────────────────────────────────────── */

function _extractTeam(text, lc) {
  const rows = (state && state.rows) || [];
  const teamNames = Array.from(new Set(rows.map(r => r && r.team).filter(Boolean)));
  for (const team of teamNames) {
    const teamLc = String(team).toLowerCase();
    if (teamLc.length < 2) continue;
    const re = new RegExp(`(?:^|[^а-яёa-z0-9])${_escapeRegex(teamLc)}(?:[^а-яёa-z0-9]|$)`, 'i');
    if (re.test(lc)) {
      return { name: team, source: 'extract' };
    }
  }
  return null;
}

function _extractEpic(text) {
  // Сначала Jira-key (BIK-1234)
  const jiraMatch = text.match(JIRA_KEY_RE);
  if (jiraMatch) return { id: jiraMatch[1], source: 'jira-key' };

  // Затем — точное вхождение epic-name из state.rows[].epic
  const rows = (state && state.rows) || [];
  const lc = text.toLowerCase();
  for (const r of rows) {
    if (!r) continue;
    const epicName = String(r.epic || r.tasks || '').trim();
    if (!epicName || epicName.length < 6) continue;
    if (lc.includes(epicName.toLowerCase())) {
      return { id: epicName, source: 'epic-name' };
    }
  }
  return null;
}

function _extractRelease(text) {
  const lc = text.toLowerCase();
  for (const r of RELEASE_PATTERNS) {
    if (r.re.test(lc)) return { id: r.id };
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────
   Source / Action extraction
   ───────────────────────────────────────────────────────────── */

function _extractSources(text) {
  const found = [];
  for (const [src, re] of Object.entries(SOURCE_PATTERNS)) {
    if (re.test(text)) found.push(src);
  }
  return found;
}

function _extractAction(text) {
  // Priority order matters — compare > standup > find > show.
  if (ACTION_PATTERNS.compare.test(text)) return 'compare';
  if (ACTION_PATTERNS.standup.test(text)) return 'standup';
  if (ACTION_PATTERNS.find.test(text))    return 'find';
  if (ACTION_PATTERNS.show.test(text))    return 'show';
  return null;
}

/* ─────────────────────────────────────────────────────────────
   I-04: Source-availability guard
   ───────────────────────────────────────────────────────────── */

/**
 * Проверить настроены ли запрашиваемые источники.
 * Возвращает массив unavailable-источников; пустой если всё OK.
 *
 * V22+ Phase 5.2 fix — раньше читало state.integrations[*].hasXxxToken,
 * но в state.js поля integrations НЕТ. Поэтому метод всегда возвращал
 * все источники как missing → chat-bot говорил «не настроены» при
 * рабочих интеграциях. Та же бага была в Release 2.0 — fixed earlier.
 *
 * Теперь идём в integrationsStore.loadSettings() — единый source-of-truth,
 * который сам мерджит localStorage + server-state (hasXxxToken флаги).
 *
 * Caller использует:
 *   const missing = checkSourcesAvailable(target.sources);
 *   if (missing.length) return renderSourceUnavailable(missing);
 */
export function checkSourcesAvailable(sources) {
  if (!Array.isArray(sources) || !sources.length) return [];
  // Dual-read стратегия:
  //  · state.integrations[{src}] — для unit-тестов (mock-friendly)
  //  · integrationsStore.loadSettings() — production source-of-truth
  // Тесты ставят state.integrations.jira.hasToken, мы это уважаем;
  // в production state.integrations отсутствует, читаем store.
  const testState = (state && state.integrations) || null;
  let storeCfg = null;
  try { storeCfg = _loadIntegrationsSettings(); } catch (_) {}

  const flagMap = {
    jira:    'hasJiraToken',
    bb:      'hasBitbucketToken',
    cf:      'hasConfluenceToken',
    sigma:   'hasSigmaJiraToken',
    zephyr:  'hasJiraToken',    // Zephyr использует тот же Jira-инстанс
    jenkins: 'hasJenkinsToken',
  };
  const stateKeyMap = { jira: 'jira', bb: 'bitbucket', cf: 'confluence',
                        sigma: 'sigma', zephyr: 'zephyr', jenkins: 'jenkins' };

  const missing = [];
  for (const src of sources) {
    // 1. Test-state mock
    if (testState) {
      const cfg = testState[stateKeyMap[src]];
      if (cfg && (cfg.hasToken || cfg.hasJiraToken || cfg.hasBitbucketToken ||
                  cfg.hasConfluenceToken || cfg.hasZephyrToken || cfg.token)) {
        continue;
      }
      if (cfg && (cfg.hasToken === false || cfg.token === false)) {
        missing.push(src);
        continue;
      }
      // testState exists но конкретного src нет → пробуем store
    }
    // 2. Production store
    if (storeCfg) {
      const flag = flagMap[src];
      if (flag && storeCfg[flag]) continue;
    }
    missing.push(src);
  }
  return missing;
}

/* ─────────────────────────────────────────────────────────────
   I-01: Главный экспорт — resolveTarget
   ───────────────────────────────────────────────────────────── */

/**
 * @param {string} text — original user message
 * @param {object} opts — { now?: Date } для тестов
 * @returns {object} target — см. JSDoc сверху
 */
export function resolveTarget(text, opts = {}) {
  const out = {
    employee:  null,
    team:      null,
    epic:      null,
    release:   null,
    sources:   [],
    period:    null,
    action:    null,
    ambiguity: null,
    raw:       { text: String(text || ''), lc: String(text || '').toLowerCase() },
  };
  if (!text || typeof text !== 'string') return out;

  const lc = out.raw.lc;

  // Период
  out.period = parsePeriod(text, opts);

  // Источники (multi-source allowed)
  out.sources = _extractSources(text);

  // Action
  out.action = _extractAction(text);

  // Release / Epic — порядок: epic ПЕРЕД release, иначе «релиз 1.21» матчит и
  // как release-id и могло бы попасть в epic-name search'е. Сейчас не пересекаются.
  out.epic = _extractEpic(text);
  out.release = _extractRelease(text);

  // Team
  out.team = _extractTeam(text, lc);

  // Employee + disambiguation
  const empCandidates = _extractEmployees(text, lc);
  if (empCandidates.length === 1) {
    out.employee = empCandidates[0];
  } else if (empCandidates.length > 1) {
    // Несколько матчей → ставим первого + ambiguity.
    out.employee = empCandidates[0];
    out.ambiguity = {
      kind: 'employee',
      candidates: empCandidates.map(c => ({
        id: c.id,
        label: c.label,
        team: c._emp?.team || c._emp?.teamName || '',
        ref: c.ref,
      })),
    };
  }

  return out;
}

/* ─────────────────────────────────────────────────────────────
   Last-target memo (I-07)
   ───────────────────────────────────────────────────────────── */

const MEMO_TTL_MS = 5 * 60 * 1000;   // 5 минут
let _lastTarget = null;
let _lastTargetAt = 0;

/**
 * Сохранить target как «last» для conversation continuity.
 * Caller вызывает после успешного render'а ответа.
 */
export function rememberTarget(target) {
  if (!target) return;
  // Не запоминаем пустые target'ы — иначе «А Петров?» наследовать нечего.
  const hasAnything = target.employee || target.team || target.epic
                   || target.release || (target.sources && target.sources.length);
  if (!hasAnything) return;
  _lastTarget = target;
  _lastTargetAt = Date.now();
}

/**
 * Достать last target если ещё свеж. Возвращает null если истёк TTL или
 * пустой.
 */
export function recallLastTarget() {
  if (!_lastTarget) return null;
  if (Date.now() - _lastTargetAt > MEMO_TTL_MS) {
    _lastTarget = null;
    return null;
  }
  return _lastTarget;
}

/**
 * Resolve с fallback на last-target. Использует caller когда новый target
 * пустой — например «А Петров?» содержит только employee, источник/период
 * берутся из предыдущего turn'а.
 */
export function resolveTargetWithMemo(text, opts = {}) {
  const fresh = resolveTarget(text, opts);
  const last = recallLastTarget();
  if (!last) return fresh;
  // Merge — fresh overrides last для непустых полей.
  return {
    ...fresh,
    employee: fresh.employee || last.employee,
    team:     fresh.team     || last.team,
    epic:     fresh.epic     || last.epic,
    release:  fresh.release  || last.release,
    sources:  (fresh.sources && fresh.sources.length) ? fresh.sources : last.sources,
    period:   fresh.period   || last.period,
    action:   fresh.action   || last.action,
    // ambiguity всегда от fresh (старая — устарела).
    raw:      fresh.raw,
    _inheritedFromMemo: true,
  };
}

/** Для тестов. */
export function _clearTargetMemo() {
  _lastTarget = null;
  _lastTargetAt = 0;
}
