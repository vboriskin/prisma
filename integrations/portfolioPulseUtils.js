'use strict';
/* ============================================================
   PORTFOLIO PULSE — UTILS  (v11+)
   Pure helpers: terminal/initial status detection, WIP heuristics,
   time windows, user identity, formatting.
   ============================================================ */

import { Utils } from '../utils.js';

export const esc   = (s) => Utils.escapeHtml(String(s ?? ''));
export const trunc = (s, n) => Utils.truncate(String(s||''), n||60);

/* ── Time windows ────────────────────────────────────────── */
export function todayStart()       { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }
export function yesterdayStart()   { return todayStart() - 24*3600*1000; }
export function twoDaysAgoStart()  { return todayStart() - 48*3600*1000; }
export function hoursAgo(h)        { return Date.now() - h*3600*1000; }
export function daysAgo(d)         { return Date.now() - d*24*3600*1000; }

export function ts(s) {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

/* ── Terminal-status detection (RU + EN, statusCategory aware) ── */
const TERMINAL_RX = /^(done|closed|resolved|complete|completed|finished|cancell?ed|won['’]?t.?do|rejected|готово|закрыт|закрыто|выполнен|выполнено|завершен|завершено|решен|решено|снят|снято|отмен|отменен|отменено|отклонен|отклонено)/i;

export function isTerminalStatus(statusName, statusCategoryKey) {
  if (statusCategoryKey && /^(done|complete)/i.test(String(statusCategoryKey))) return true;
  if (!statusName) return false;
  return TERMINAL_RX.test(String(statusName).trim());
}

/* ── Initial-status detection (heuristic for "не приступали") ─── */
const INITIAL_RX = /^(to.?do|backlog|open|new|created|reopened|создан|новый|новая|бэклог|к.?выполнению|открыт|открыта|готов.{0,3}к.?работе)/i;

export function isInitialStatus(statusName, statusCategoryKey) {
  if (statusCategoryKey && /^(new|todo|undefined|to.?do)/i.test(String(statusCategoryKey))) return true;
  if (!statusName) return false;
  return INITIAL_RX.test(String(statusName).trim());
}

/* ── WIP-active detection ───────────────────────────────────
   A task is "actively WIP" when:
   - status is NOT terminal
   AND at least one of:
     - status changed at least once (changelog has status item)
     - has worklog
     - has comments
     - has commits/PR (carried via slim flags)
     - updated within 48h
   ──────────────────────────────────────────────────────────── */
export function isWipActive(issue) {
  const f = issue.fields || {};
  if (isTerminalStatus(f.status?.name, f.status?.statusCategory?.key)) return false;
  // Updated in last 48h
  if (ts(f.updated) >= hoursAgo(48)) return true;
  // Has worklog
  if (f.worklog?.worklogs?.length) return true;
  // Has comments
  if (f.comment?.comments?.length) return true;
  // Status changed at least once
  const histories = issue.changelog?.histories || [];
  if (histories.some(h => (h.items || []).some(it => it.field === 'status'))) return true;
  // Default: not initial → consider WIP
  if (!isInitialStatus(f.status?.name, f.status?.statusCategory?.key)) return true;
  return false;
}

/* ── User identity ──────────────────────────────────────── */
export function userKey(u) {
  if (!u) return '';
  return String(u.accountId || u.key || u.name || u.emailAddress || u.displayName || '').toLowerCase();
}
/**
 * V12 (FOUND_BUGS #2) — secondary lookup key for fuzzy de-duplication.
 * Jira sometimes returns the same person with `{displayName, emailAddress}`
 * in `assignee` but only `{displayName}` in `changelog.author`. The two
 * `userKey()` calls then return different strings (email vs displayName)
 * and the model creates two separate participants for one human.
 *
 * `userNameKey()` returns just the lowercased displayName so callers can
 * keep a `nameKey → primaryKey` map and merge late comers into the
 * existing participant. Returns '' when displayName is absent — caller
 * MUST then fall back to userKey().
 */
export function userNameKey(u) {
  if (!u) return '';
  return String(u.displayName || u.name || '').trim().toLowerCase();
}
export function userLabel(u) {
  if (!u) return '—';
  return u.displayName || u.name || u.emailAddress || 'Аноним';
}
export function userAvatar(u) {
  return u?.avatarUrls?.['24x24'] || u?.avatarUrls?.['32x32'] || u?.avatarUrls?.['16x16'] || '';
}

/* ── Issue slim view (compact summary for cards) ──────────── */
export function slimIssue(issue, projectKey) {
  const f = issue.fields || {};
  return {
    key:        issue.key,
    pk:         projectKey || (issue.key || '').split('-')[0] || '',
    summary:    f.summary || '',
    description: f.description ? String(f.description).slice(0, 800) : '',
    type:       f.issuetype?.name || '',
    typeKey:    String(f.issuetype?.name || '').toLowerCase(),
    priority:   f.priority?.name || '',
    status:     f.status?.name || '',
    statusCat:  f.status?.statusCategory?.key || '',
    assignee:   f.assignee?.displayName || '',
    parentKey:  f.parent?.key || '',
    parentSum:  f.parent?.fields?.summary || '',
    parentStatus: f.parent?.fields?.status?.name || '',
    duedate:    f.duedate || '',
    updated:    f.updated || '',
    created:    f.created || '',
    labels:     Array.isArray(f.labels) ? f.labels : [],
    sprint:     '', // populated by caller if it knows
    hasWorklog: !!(f.worklog?.worklogs?.length),
    hasComments:!!(f.comment?.comments?.length),
    // 2026-06-01 — extra fields для AI-ассистента (panel «Сводка ассистента»).
    // Все три поля уже приходят в JIRA_FIELDS (timetracking,
    // timeoriginalestimate, aggregatetimespent — см. server/jira-helpers.js
    // ~L36), но раньше отбрасывались в slim. timetracking может быть пустым
    // — fallback на отдельные поля.
    originalEstimateSeconds:
      Number(f.timetracking?.originalEstimateSeconds)
      || Number(f.timeoriginalestimate)
      || 0,
    timeSpentSeconds:
      Number(f.timetracking?.timeSpentSeconds)
      || Number(f.aggregatetimespent)
      || 0,
  };
}

/* ── Issue type bucketing ─────────────────────────────────── */
export function typeBucket(typeOrIssue) {
  const t = (typeof typeOrIssue === 'string' ? typeOrIssue : (typeOrIssue?.type || '')).toLowerCase();
  if (t.includes('bug') || t.includes('баг') || t.includes('дефект')) return 'bug';
  // V12 fix (FOUND_BUGS #3): English "Epic" was missing — only cyrillic «эпик»
  // was matched, so typeBucket('Epic') returned 'other'.
  if (t.includes('story') || t.includes('эпик') || t.includes('epic') || t.includes('feature')) return 'story';
  if (t.includes('sub') || t.includes('подзадача')) return 'subtask';
  if (t.includes('task') || t.includes('задача')) return 'task';
  return 'other';
}

/* ── Wave 4c: Zephyr classification ─────────────────────────
   Zephyr / Xray store test artefacts as Jira issuetypes named
   "Test", "Test Case", "Test Execution", "Test Set", "Test Cycle",
   "Test Plan" etc. Classified into a separate dimension orthogonal
   to typeBucket (Stories/Bugs/etc). Returns one of:
     · 'test'      — definition (Test / Test Case)
     · 'testExec'  — single execution / run
     · 'testSet'   — group / cycle / plan
     · ''          — not a test artefact
   ──────────────────────────────────────────────────────────── */
export function zephyrKind(typeOrIssue) {
  const t = (typeof typeOrIssue === 'string' ? typeOrIssue : (typeOrIssue?.type || '')).toLowerCase().trim();
  if (!t.includes('test') && !t.includes('тест')) return '';
  // Order matters: more specific first.
  if (t.includes('execution') || t.includes('exec') || t.includes('run') || t.includes('прогон')) return 'testExec';
  if (t.includes('set') || t.includes('cycle') || t.includes('plan') || t.includes('cuite') || t.includes('наб') || t.includes('цикл')) return 'testSet';
  if (t.includes('case') || t === 'test' || t === 'тест' || t.includes('тест-кейс')) return 'test';
  return 'test'; // default — "Test*" without specific suffix
}

export function typeBucketLabel(b) {
  return ({ bug:'Bug', story:'Story', task:'Task', subtask:'Sub-task', other:'Прочее' })[b] || b;
}

export function groupByBucket(issues) {
  const out = { story:[], task:[], bug:[], subtask:[], other:[] };
  for (const it of (issues || [])) {
    const b = typeBucket(it);
    out[b].push(it);
  }
  return out;
}

/* ── Formatting ─────────────────────────────────────────── */
export function formatHrs(sec) {
  // V12 fix (FOUND_BUGS #1): zero / null / NaN previously returned '0h' (latin
  // h) while non-zero values returned cyrillic 'ч'. Unified to cyrillic.
  if (!sec) return '0ч';
  const h = sec / 3600;
  if (h < 1) return Math.round(sec / 60) + 'м';
  return Math.round(h * 10) / 10 + 'ч';
}

export function formatDuration(d) {
  // d in days
  if (d < 1) return '<1д';
  if (d < 30) return Math.floor(d) + 'д';
  return Math.floor(d / 30) + 'мес';
}

export function pct(n, total) {
  if (!total) return 0;
  return Math.round(n / total * 100);
}

/* ── Status normalisation for grouping ──────────────────── */
export function statusBucket(statusName, statusCategoryKey) {
  if (isTerminalStatus(statusName, statusCategoryKey)) return 'done';
  if (isInitialStatus(statusName, statusCategoryKey))  return 'todo';
  return 'wip';
}

/* ── Project keys parsing ──────────────────────────────── */
export function parseProjectKeys(s) {
  return String(s || '').split(/[,\n;]/).map(x => x.trim()).filter(Boolean);
}
