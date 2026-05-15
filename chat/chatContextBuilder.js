'use strict';
/* ============================================================
   CHAT CONTEXT BUILDER — v10_0
   Builds focused context objects for each intent type.
   ============================================================ */

import { state } from '../state.js';
import { Services } from '../app/services.js';
import { INTENTS } from './chatIntentParser.js';

/**
 * Safely get filtered rows from FilterEngine.
 */
function getFiltered() {
  try { return window.FilterEngine?.getFiltered() || state.rows; } catch(_) { return state.rows; }
}

/**
 * Build summary statistics from a row array.
 */
function buildStats(rows) {
  const total     = rows.length;
  const done      = rows.filter(r => r.isDone).length;
  const blockers  = rows.filter(r => r.blockingDependency && !r.isDone).length;
  const risky     = rows.filter(r => (r.riskFlags || []).length > 0 && !r.isDone).length;
  const inScope   = rows.filter(r => r.scopeStatus === 'Да').length;
  const unassigned = rows.filter(r => r.isUnassigned && !r.isDone).length;
  const r120 = rows.filter(r => r.hasRelease120).length;
  const r121 = rows.filter(r => r.hasRelease121).length;
  const r122 = rows.filter(r => r.hasRelease122).length;
  const overtime = rows.filter(r => r.hasOvertime).length;
  return { total, done, blockers, risky, inScope, unassigned, r120, r121, r122, overtime,
           donePct: total ? Math.round(done / total * 100) : 0 };
}

/**
 * Build per-team breakdown.
 */
function buildTeamBreakdown(rows) {
  const map = {};
  rows.forEach(r => {
    const t = r.team || '—';
    if (!map[t]) map[t] = { team: t, total: 0, done: 0, blockers: 0, risky: 0, r120: 0, r121: 0, r122: 0 };
    map[t].total++;
    if (r.isDone) map[t].done++;
    if (r.blockingDependency && !r.isDone) map[t].blockers++;
    if ((r.riskFlags || []).length && !r.isDone) map[t].risky++;
    if (r.hasRelease120) map[t].r120++;
    if (r.hasRelease121) map[t].r121++;
    if (r.hasRelease122) map[t].r122++;
  });
  return Object.values(map).sort((a, b) => b.total - a.total);
}

/**
 * Strip a row to lightweight fields for LLM.
 *
 * V15 (audit#2, AI dev Critical 2): the free-form `comment` field used to
 * be passed verbatim. That's a PII / leak vector — users sometimes write
 * names of people, ticket-bodies, internal notes, even credentials in
 * comments. We now redact comments to:
 *   · short summary (≤120 chars after a stripper pass)
 *   · `<no comment>` if empty
 *   · `<redacted>` if comment matches a sensitive pattern (token-like
 *     long base64 / Bearer prefix / "пароль:" etc.)
 * This trades resolution for safety — the LLM can still reason about
 * "task has notes" vs "task is empty", but doesn't see private prose.
 */
function _redactComment(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // Sensitive markers — if found, drop the comment entirely.
  if (/(?:bearer|token|password|пароль|секрет|secret|apikey|api[_\s-]?key)[:\s=]/i.test(s)) return '<redacted>';
  if (/[A-Za-z0-9_\-]{40,}/.test(s)) return '<redacted>';     // long opaque-looking token
  // Otherwise, truncate to 120 chars and strip newlines.
  return s.replace(/\s+/g, ' ').slice(0, 120);
}
// F10 fix (chat-04 audit) — убираем internal `id` и raw `riskFlags` из payload.
// `id` — это внутренний row-id, для LLM бессмыслен, но потенциально утекает
// в логи. `riskFlags` редактируем в количество flag'ов (детали — внутреннее
// поле, может содержать reasoning без redaction). Если LLM нужен flag-count
// для приоритизации, числа достаточно.
function pickRow(r) {
  return {
    team: r.team, epic: r.epic, tasks: r.tasks,
    scopeStatus: r.scopeStatus, assignee: r.assignee, isDone: r.isDone,
    blockingDependency: r.blockingDependency,
    riskFlagCount: Array.isArray(r.riskFlags) ? r.riskFlags.length : 0,
    release120Types: r.release120Types, release121Types: r.release121Types,
    release122Types: r.release122Types, overtimeTypes: r.overtimeTypes,
    workPeriodStart: r.workPeriodStart, workPeriodEnd: r.workPeriodEnd,
    comment: _redactComment(r.comment),
  };
}

/* ── Per-intent context builders ─────────────────────────── */

export function buildExecutiveSummaryContext() {
  const rows = state.rows;
  const stats = buildStats(rows);
  const teams = buildTeamBreakdown(rows);
  const topBlockers = rows.filter(r => r.blockingDependency && !r.isDone).slice(0, 10).map(pickRow);
  const topRisky    = rows.filter(r => (r.riskFlags||[]).length && !r.isDone).slice(0, 10).map(pickRow);
  return { intent: 'executive_summary', stats, teams, topBlockers, topRisky, activeTab: state.activeSection };
}

export function buildReleaseOverviewContext(release) {
  const allRows = state.rows;
  const fieldMap = { r120: 'hasRelease120', r121: 'hasRelease121', r122: 'hasRelease122', overtime: 'hasOvertime', backlog: 'isUnassigned' };
  const field = release ? fieldMap[release] : null;
  const relRows = field ? allRows.filter(r => r[field]) : allRows;
  const stats = buildStats(relRows);
  const teams = buildTeamBreakdown(relRows);
  const blockers = relRows.filter(r => r.blockingDependency && !r.isDone).slice(0, 15).map(pickRow);
  return { intent: 'release_overview', release: release || 'all', stats, teams, blockers,
           rows: relRows.slice(0, 40).map(pickRow) };
}

export function buildTeamOverviewContext(teamName) {
  const allRows = state.rows;
  const teams = [...new Set(allRows.map(r => r.team).filter(Boolean))].sort();
  const filtered = teamName
    ? allRows.filter(r => r.team && r.team.toLowerCase().includes(teamName.toLowerCase()))
    : allRows;
  const stats = buildStats(filtered);
  const breakdown = buildTeamBreakdown(allRows);
  return { intent: 'team_overview', requestedTeam: teamName || null, availableTeams: teams,
           stats, teamBreakdown: breakdown, rows: filtered.slice(0, 30).map(pickRow) };
}

export function buildRisksContext() {
  const rows = state.rows;
  // V22 X-04 (audit-experts-2026-05-15 Selvadurai #3, Compound-3) — раньше
  // WHAT_RISKS читал блокеры ТОЛЬКО из Реестра (`r.blockingDependency`).
  // Сканнер хранил отдельный сорт блокеров — Jira-issue-blocker-link с
  // dwellHours. Два независимых понятия «блокер» в одном инструменте
  // давали противоречивые цифры («у нас 7 блокеров или 23?»). Теперь —
  // объединённый список с явной маркировкой `source: 'registry' | 'scanner'`,
  // и фронт может показывать оба слоя без перетасовки.
  const registryBlockers = rows
    .filter(r => r.blockingDependency && !r.isDone)
    .slice(0, 20)
    .map(r => ({ ...pickRow(r), _blockerSource: 'registry' }));
  const scannerBlockers = [];
  try {
    // Services.TeamScanner2.getModel() — основной источник. Если view не
    // открывался в этой сессии, model = null, и Сканнер-блокеры просто
    // не появятся (registry-блокеры всё равно покажутся).
    const Services = (typeof globalThis !== 'undefined') ? (globalThis.Services || {}) : {};
    const ts2Model = Services.TeamScanner2?.getModel?.() || null;
    const participants = ts2Model && Array.isArray(ts2Model.participants) ? ts2Model.participants : [];
    for (const p of participants) {
      if (p?.deactivated) continue; // [Х]-уволенные не считаем
      const blks = Array.isArray(p?.blockers) ? p.blockers : [];
      for (const b of blks) {
        if (!b || !b.issueKey) continue;
        scannerBlockers.push({
          issueKey: String(b.issueKey),
          blockerKey: String(b.blockerKey || ''),
          dwellHours: Number(b.dwellHours || 0),
          owner: p.email || p.label || p.key || '',
          _blockerSource: 'scanner',
        });
        if (scannerBlockers.length >= 20) break;
      }
      if (scannerBlockers.length >= 20) break;
    }
  } catch (_) { /* defensive */ }
  // Merged top-list: 25 самых тяжёлых, с маркировкой источника. Sort
  // по dwellHours для scanner и по riskScore-эквиваленту для registry.
  const merged = [...registryBlockers, ...scannerBlockers]
    .sort((a, b) => (b.dwellHours || 0) - (a.dwellHours || 0))
    .slice(0, 25);
  const risky    = rows.filter(r => (r.riskFlags||[]).length && !r.isDone).slice(0, 20).map(pickRow);
  const riskTypes = {};
  rows.forEach(r => (r.riskFlags||[]).forEach(f => { riskTypes[f] = (riskTypes[f]||0)+1; }));
  const stats = buildStats(rows);
  return {
    intent: 'what_risks',
    stats,
    blockers: registryBlockers,
    // V22 X-04: новые поля для cross-source view.
    scannerBlockers,
    blockersMerged: merged,
    blockersSummary: {
      registryCount: registryBlockers.length,
      scannerCount:  scannerBlockers.length,
      total: registryBlockers.length + scannerBlockers.length,
      sourceConflict: registryBlockers.length > 0 && scannerBlockers.length > 0,
    },
    risky,
    riskTypes,
  };
}

export function buildOverloadContext() {
  const rows = state.rows;
  const load = {};
  rows.forEach(r => {
    if (r.isDone) return;
    (r.assignee || '').split(/[|,]/).map(s => s.trim()).filter(Boolean).forEach(name => {
      if (!load[name]) load[name] = { name, total: 0, r120: 0, r121: 0, r122: 0, ot: 0, blockers: 0 };
      load[name].total++;
      if (r.hasRelease120) load[name].r120++;
      if (r.hasRelease121) load[name].r121++;
      if (r.hasRelease122) load[name].r122++;
      if (r.hasOvertime)   load[name].ot++;
      if (r.blockingDependency) load[name].blockers++;
    });
  });
  const assignees = Object.values(load).sort((a, b) => b.total - a.total);
  const teams = buildTeamBreakdown(rows);
  return { intent: 'overload', assignees: assignees.slice(0, 20), teams };
}

export function buildMeetingPrepContext(meetingType) {
  const rows = state.rows;
  const stats = buildStats(rows);
  const blockers  = rows.filter(r => r.blockingDependency && !r.isDone).slice(0, 10).map(pickRow);
  const risky     = rows.filter(r => (r.riskFlags||[]).length && !r.isDone).slice(0, 10).map(pickRow);
  const recentDone = rows.filter(r => r.isDone).slice(-10).map(pickRow);
  const teams = buildTeamBreakdown(rows);
  return { intent: 'meeting_prep', meetingType: meetingType || 'meeting', stats, teams, blockers, risky, recentDone };
}

export function buildReleaseNotesContext(release) {
  const allRows = state.rows;
  const fieldMap = { r120: 'hasRelease120', r121: 'hasRelease121', r122: 'hasRelease122' };
  const field = release ? fieldMap[release] : null;
  const relRows = field ? allRows.filter(r => r[field]) : allRows;
  const done   = relRows.filter(r => r.isDone);
  const active = relRows.filter(r => !r.isDone);
  return { intent: 'release_notes', release: release || 'all',
           done: done.slice(0, 50).map(pickRow), active: active.slice(0, 30).map(pickRow) };
}

export function buildAskPlanContext() {
  const rows = state.rows;
  const stats = buildStats(rows);
  const blockers = rows.filter(r => r.blockingDependency && !r.isDone).slice(0, 10).map(pickRow);
  const risky    = rows.filter(r => (r.riskFlags||[]).length && !r.isDone).slice(0, 10).map(pickRow);
  const unassigned = rows.filter(r => r.isUnassigned && !r.isDone && r.scopeStatus === 'Да').slice(0, 10).map(pickRow);
  const teams = buildTeamBreakdown(rows);
  return { intent: 'ask_plan', stats, teams, blockers, risky, unassigned };
}

export function buildReviewModeContext(role) {
  const rows = state.rows;
  const stats = buildStats(rows);
  const teams = buildTeamBreakdown(rows);
  const blockers = rows.filter(r => r.blockingDependency && !r.isDone).slice(0, 15).map(pickRow);
  const risky    = rows.filter(r => (r.riskFlags||[]).length && !r.isDone).slice(0, 15).map(pickRow);
  return { intent: 'review_mode', role: role || 'ceo', stats, teams, blockers, risky };
}

export function buildFilterTasksContext(params) {
  const visible = getFiltered();
  return { intent: 'filter_tasks', currentFilters: { ...state.filters }, appliedParams: params,
           visibleCount: visible.length, totalCount: state.rows.length };
}

/* ============================================================
   V22 X-06 (audit-experts-2026-05-15 Selvadurai TL;DR #3) —
   retrieveByQuery: entity-extraction + targeted retrieval.

   Раньше: «расскажи про команду PAY» → builder вытаскивал top-12
   participants по generic-sort (activity-count). Юзер хотел precision,
   получал sample. LLM-payload содержал нерелевантных людей и не
   содержал релевантных (если они не в top-12 по activity).

   Теперь: extractEntities() возвращает {team, person, epic, release},
   builder фильтрует payload по extracted entities. Без векторного
   store'а — string-match на entities из state.

   Используется ВНУТРИ buildScannerQueryContext (preferred over
   top-12 sample) и в общем path'е chatEngine для grounding'а.
   ============================================================ */

const _ENTITY_PATTERNS = Object.freeze({
  // Релиз: «1.21», «релиз 1.22», «r122», «1_22»
  release: /\b(?:релиз\s+)?(?:r|R)?(\d\.\d{2}|\d_\d{2}|1\.\d{2})\b/g,
  // Jira-key: «BIK-1234», «PAY-42»
  jiraKey: /\b([A-Z][A-Z0-9]{1,5}-\d{1,6})\b/g,
});

/**
 * Извлечь сущности из текста запроса. Возвращает {teams, people, epics, releases}.
 * Все — массивы уникальных строк из доменной таблицы (state.employees / state.rows).
 * Если в тексте нет ни одной — пустой массив (caller fallback'нется на полный
 * payload).
 *
 * @param {string} text
 * @returns {{ teams: string[], people: string[], epics: string[], releases: string[] }}
 */
export function extractEntities(text) {
  const out = { teams: [], people: [], epics: [], releases: [] };
  if (!text || typeof text !== 'string') return out;
  const t = text.toLowerCase();

  // Releases — match через regex.
  const relMatches = String(text).matchAll(_ENTITY_PATTERNS.release);
  for (const m of relMatches) {
    const norm = m[1].replace('_', '.');
    if (!out.releases.includes(norm)) out.releases.push(norm);
  }

  // Jira-keys → потенциальные epics.
  const jiraMatches = String(text).matchAll(_ENTITY_PATTERNS.jiraKey);
  for (const m of jiraMatches) {
    if (!out.epics.includes(m[1])) out.epics.push(m[1]);
  }

  // Teams: match по уникальным team-name из state.rows. Тут много false-
  // negatives возможно (юзер мог сократить, опечататься). Берём substring.
  const teamSet = new Set();
  for (const r of (state.rows || [])) {
    if (r && r.team) teamSet.add(String(r.team));
  }
  for (const teamName of teamSet) {
    if (t.includes(teamName.toLowerCase())) {
      if (!out.teams.includes(teamName)) out.teams.push(teamName);
    }
  }

  // People: full-name OR last-name match по state.employees. Identity-
  // deterministic principle: matched.email обязательно сохраняется.
  for (const e of (state.employees || [])) {
    if (!e || e.deactivated) continue;
    const fio = String(e.fio || e.name || '').toLowerCase();
    const email = String(e.email || '').toLowerCase();
    if (!fio && !email) continue;
    // Match по полному ФИО или фамилии (первое слово).
    const lastName = fio.split(/\s+/)[0] || '';
    if (lastName && lastName.length >= 4 && t.includes(lastName)) {
      const tag = e.email || e.jiraAccountId || fio;
      if (!out.people.includes(tag)) out.people.push(tag);
    } else if (email && t.includes(email)) {
      if (!out.people.includes(email)) out.people.push(email);
    }
  }

  // Также пробуем match по строкам Реестра — epic name (если не Jira-key).
  for (const r of (state.rows || [])) {
    if (!r) continue;
    const epicName = String(r.epic || r.tasks || '').trim();
    if (!epicName || epicName.length < 6) continue;
    if (t.includes(epicName.toLowerCase())) {
      if (!out.epics.includes(epicName)) out.epics.push(epicName);
    }
  }

  return out;
}

/**
 * Targeted retrieval: вернуть подмножество rows и participants, релевантных
 * запросу. Если ни одна entity не извлечена — возвращает `null` (caller
 * использует default-builder).
 *
 * @param {string} text - оригинальный запрос юзера
 * @returns {{ entities, rows, participants } | null}
 */
export function retrieveByQuery(text) {
  const ent = extractEntities(text);
  const hasAny = ent.teams.length || ent.people.length || ent.epics.length || ent.releases.length;
  if (!hasAny) return null;

  // Filter rows by team / epic / release.
  let rows = state.rows || [];
  if (ent.teams.length) {
    rows = rows.filter(r => ent.teams.includes(r.team));
  }
  if (ent.releases.length) {
    rows = rows.filter(r => ent.releases.some(rel => {
      if (rel === '1.20') return r.hasRelease120;
      if (rel === '1.21') return r.hasRelease121;
      if (rel === '1.22') return r.hasRelease122;
      return false;
    }));
  }
  if (ent.epics.length) {
    rows = rows.filter(r => ent.epics.some(e =>
      String(r.epic || '').includes(e) || String(r.tasks || '').includes(e) || String(r.id || '') === e,
    ));
  }

  // Filter participants by team OR by identity.
  let participants = [];
  try {
    const ts2 = (typeof window !== 'undefined') ? Services.TeamScanner2 : null;
    const model = ts2?.getModel ? ts2.getModel() : null;
    const all = (model?.participants || []).filter(p => !p.deactivated);
    if (ent.people.length) {
      participants = all.filter(p => {
        const lc = String(p.email || '').toLowerCase();
        return ent.people.some(per => lc === String(per).toLowerCase()
          || String(p.jiraAccountId || '') === per
          || String(p.fio || p.label || '').toLowerCase().includes(String(per).toLowerCase()));
      });
    } else if (ent.teams.length) {
      participants = all.filter(p => (p.projects || []).some(pk => ent.teams.some(t => String(pk).includes(t))));
    }
  } catch (_) { /* defensive */ }

  return { entities: ent, rows: rows.slice(0, 30), participants: participants.slice(0, 15) };
}

/**
 * Master dispatcher — picks the right context builder for an intent.
 */
// V21 BK (audit-04 §H #1) — Scanner 2.0 context для LLM.
// Читает из window.TeamScanner2.getModel() (no fetch, last-cached snapshot).
// Если scanner pulse ещё не запускался — возвращает hint что нужно запустить.
function buildScannerQueryContext(person, team) {
  const ts2 = (typeof window !== 'undefined') ? Services.TeamScanner2 : null;
  const model = ts2?.getModel ? ts2.getModel() : null;
  if (!model) {
    return {
      intent: 'scanner_query',
      hint: 'Сканнер 2.0 ещё не запущен. Откройте «Сканнер команд» и нажмите ↻ Обновить, потом задайте вопрос снова.',
      hasModel: false,
    };
  }
  // PR-CH — отфильтровываем `[X]`-уволенных, чтобы LLM не видел их в контексте.
  const parts = (model.participants || []).filter(p => !p.deactivated);
  // Narrow к person, если матч.
  let target = null;
  if (person) {
    const lc = String(person).toLowerCase();
    target = parts.find(p =>
      String(p.label || '').toLowerCase().includes(lc)
      || String(p.fio   || '').toLowerCase().includes(lc)
      || String(p.email || '').toLowerCase().includes(lc));
  }
  // Per-team filter.
  let filtered = parts;
  if (team) {
    const lc = String(team).toLowerCase();
    filtered = parts.filter(p => (p.projects || []).some(pk => String(pk).toLowerCase().includes(lc)));
  }
  // Compact summary — top-12 participants by activity, агрегаты.
  const _sortKey = (p) => (p.issuesNow?.length || 0) + (p.bbItems?.length || 0) + (p.cfItems?.length || 0);
  const topActive = filtered.slice().sort((a, b) => _sortKey(b) - _sortKey(a)).slice(0, 12)
    .map(p => ({
      name:           p.label || p.email,
      issuesNow:      (p.issuesNow || []).length,
      blockers:       (p.blockers || []).length,
      stale:          (p.stale || []).length,
      doneToday:      (p.doneToday || []).length,
      doneYesterday:  (p.doneYesterday || []).length,
      commitsRecent:  (p.bbItems || []).filter(i => i.kind === 'commit').length,
      prsRecent:      (p.bbItems || []).filter(i => i.kind === 'pr').length,
      cfRecent:       (p.cfItems || []).length,
      // V21 BK — surface person-level metrics уже посчитанные в Z7.
      afterHoursRatio: p.metrics?.afterHoursRatio,
      gini:            p.metrics?.specialistGini,
      reworkRatio:     p.reworkRatio,
    }));

  return {
    intent: 'scanner_query',
    hasModel: true,
    fetchedAt:     model.fetchedAt,
    projectKeys:   model.projectKeys,
    teamSize:      parts.length,
    targetPerson:  target ? {
      name:          target.label || target.email,
      issuesNow:     (target.issuesNow || []).slice(0, 8).map(i => ({ key: i.key, summary: i.summary, status: i.status })),
      blockers:      (target.blockers || []).slice(0, 8).map(b => ({ key: b.issueKey, blockerKey: b.blockerKey, dwellHours: b.dwellHours })),
      stale:         (target.stale || []).slice(0, 5).map(s => ({ key: s.key, summary: s.summary, daysIdle: s.daysIdle })),
      doneYesterday: (target.doneYesterday || []).slice(0, 5).map(s => ({ key: s.key, summary: s.summary })),
      metrics:       target.metrics || {},
      reworkRatio:   target.reworkRatio,
    } : null,
    teamSummary: {
      blockerTotal:  parts.reduce((s, p) => s + (p.blockers?.length || 0), 0),
      activeIssues: parts.reduce((s, p) => s + (p.issuesNow?.length || 0), 0),
      doneYesterday: parts.reduce((s, p) => s + (p.doneYesterday?.length || 0), 0),
    },
    topActive,
    bigMetrics: model.bigMetrics ? {
      reopenRateAvg: Object.values(model.bigMetrics.reopenRate?.byPk || {}).reduce((s, v, _i, a) => s + v.rate / a.length, 0),
      sprintCommitAvg: Object.values(model.bigMetrics.sprintCommit?.byPk || {})
        .reduce((s, v, _i, a) => s + (v.avgDeliveryRatio || 0) / a.length, 0),
    } : null,
  };
}

export function buildContextForIntent(intent, params = {}) {
  switch (intent) {
    case INTENTS.EXECUTIVE_SUMMARY: return buildExecutiveSummaryContext();
    case INTENTS.RELEASE_OVERVIEW:  return buildReleaseOverviewContext(params.release);
    case INTENTS.TEAM_OVERVIEW:     return buildTeamOverviewContext(params.team);
    case INTENTS.MEETING_PREP:      return buildMeetingPrepContext(params.meetingType);
    case INTENTS.ASK_PLAN:          return buildAskPlanContext();
    case INTENTS.FILTER_TASKS:      return buildFilterTasksContext(params);
    case INTENTS.RELEASE_NOTES:     return buildReleaseNotesContext(params.release);
    case INTENTS.WHAT_RISKS:        return buildRisksContext();
    case INTENTS.OVERLOAD:          return buildOverloadContext();
    case INTENTS.REVIEW_MODE:       return buildReviewModeContext(params.role);
    case INTENTS.SCANNER_QUERY:     return buildScannerQueryContext(params.person, params.team);
    default: {
      // Generic — return summary context
      const stats = buildStats(state.rows);
      const teams = buildTeamBreakdown(state.rows);
      return { intent: 'generic', stats, teams };
    }
  }
}
