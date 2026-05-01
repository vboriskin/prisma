'use strict';
/* ============================================================
   tests/fixtures/jiraPulseResponse.js
   --
   Realistic snapshots of /api/integrations/portfolio-pulse server
   responses. Used as input to `analysePulse()` so unit tests don't
   need a live Jira / Bitbucket / Confluence backend.

   Two builders:
     · makeRawReport(opts)     — single per-PK report (issues array + sprint/inProgress/backlog keys)
     · makePulsePayload(opts)  — full payload with reports[], bitbucket, confluence, diagnostics

   Times in fixtures are anchored to ISO_2026_04_28_NOON so they line
   up with the time-frozen tests (today/yesterday/dayBefore windows).
   ============================================================ */

import {
  ISO_2026_04_28_NOON, ISO_2026_04_27_NOON,
  ISO_2026_04_26_NOON, ISO_2026_04_25_NOON,
} from '../helpers/timeFreeze.js';

/** Realistic Jira issue. Override any field via `over` for individual cases. */
export function makeJiraIssue(over = {}) {
  return {
    key: 'PAY-100',
    fields: {
      summary:    'Реализовать список платежей',
      description:'Полное описание задачи',
      status:     { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      assignee:   { displayName: 'Иван Иванов', emailAddress: 'ivan@example.com' },
      reporter:   { displayName: 'Мария Менеджер', emailAddress: 'maria@example.com' },
      priority:   { name: 'High' },
      issuetype:  { name: 'Story' },
      labels:     ['frontend'],
      duedate:    null,
      created:    '2026-04-15T09:00:00.000Z',
      updated:    ISO_2026_04_28_NOON,
      worklog:    { worklogs: [] },
      comment:    { comments: [] },
      parent:     null,
      ...over.fields,
    },
    changelog: { histories: over.histories || [] },
    ...over,
  };
}

/** Single per-PK report payload. */
export function makeRawReport(opts = {}) {
  const pk = opts.pk || 'PAY';
  const issues = opts.issues || [makeJiraIssue({ key: `${pk}-1` })];
  return {
    projectKey:      pk,
    issues,
    sprintKeys:      opts.sprintKeys      || [],
    inProgressKeys:  opts.inProgressKeys  || issues.map(i => i.key),
    backlogKeys:     opts.backlogKeys     || [],
    _ms:             opts._ms ?? 1234,
    error:           opts.error || undefined,
  };
}

/** Full /api/integrations/portfolio-pulse payload. */
export function makePulsePayload(opts = {}) {
  const projectKeys = opts.projectKeys || ['PAY'];
  const reports = opts.reports || projectKeys.map(pk => makeRawReport({ pk }));
  return {
    fetchedAt:   opts.fetchedAt   || ISO_2026_04_28_NOON,
    projectKeys,
    jiraBaseUrl: opts.jiraBaseUrl || 'https://jira.example.com',
    reports,
    bitbucket:   opts.bitbucket  || { authors: {}, configured: true, tried: [] },
    confluence:  opts.confluence || { authors: {}, configured: true, tried: [] },
    diagnostics: opts.diagnostics || { totalMs: 1500, perPk: [], log: [] },
  };
}

/* ── Reusable issue templates ─────────────────────────────── */

export function inProgressIssue(over = {}) {
  return makeJiraIssue({
    key: over.key || 'PAY-1',
    fields: {
      status:    { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Story' },
      priority:  { name: 'High' },
      assignee:  { displayName: 'Иван Иванов', emailAddress: 'ivan@example.com' },
      ...over.fields,
    },
    histories: over.histories,
  });
}

export function doneIssue(over = {}) {
  return makeJiraIssue({
    key: over.key || 'PAY-2',
    fields: {
      status:    { name: 'Done', statusCategory: { key: 'done' } },
      issuetype: { name: 'Bug' },
      assignee:  { displayName: 'Пётр Петров', emailAddress: 'petr@example.com' },
      ...over.fields,
    },
    histories: over.histories,
  });
}

export function todoIssue(over = {}) {
  return makeJiraIssue({
    key: over.key || 'PAY-3',
    fields: {
      status:    { name: 'Open', statusCategory: { key: 'new' } },
      issuetype: { name: 'Task' },
      assignee:  null,
      ...over.fields,
    },
    histories: over.histories,
  });
}

/** Default author used by withTransition/withComment/withWorklog so the
 *  changelog/comment/worklog author resolves to the SAME `userKey` as the
 *  issue's assignee — otherwise analysePulse splits one human into two
 *  participants (see FOUND_BUGS.md #2). */
export const DEFAULT_AUTHOR = { displayName: 'Иван Иванов', emailAddress: 'ivan@example.com' };

/** Issue with status transition (changelog) at a given timestamp.
 *  Used to test today / yesterday / dayBefore time-bucketing in analysePulse. */
export function withTransition(issue, atIso, toStatus = 'In Review', who = DEFAULT_AUTHOR) {
  const histories = (issue.changelog?.histories || []).concat([{
    created: atIso,
    author:  who,
    items:   [{ field: 'status', toString: toStatus }],
  }]);
  return { ...issue, changelog: { histories } };
}

/** Issue with comment by `author` at `atIso`. */
export function withComment(issue, atIso, body, author = DEFAULT_AUTHOR) {
  const fields = { ...issue.fields };
  fields.comment = {
    comments: [
      ...(fields.comment?.comments || []),
      { created: atIso, author, body },
    ],
  };
  return { ...issue, fields };
}

/** Issue with worklog entry. `seconds` accumulates into loggedTodaySec/etc. */
export function withWorklog(issue, atIso, seconds, author = DEFAULT_AUTHOR) {
  const fields = { ...issue.fields };
  fields.worklog = {
    worklogs: [
      ...(fields.worklog?.worklogs || []),
      { started: atIso, timeSpentSeconds: seconds, author },
    ],
  };
  return { ...issue, fields };
}

/* ── Bitbucket / Confluence aggregates ──────────────────── */

export function makeBitbucketAggregate(authors = {}) {
  // Default Иван Иванов matches the assignee in inProgressIssue() so badges hydrate.
  const defaultAuthors = {
    'иван иванов': {
      displayName: 'Иван Иванов',
      email:       'ivan@example.com',
      commits:     5,
      prs:         2,
      items: [
        { kind: 'commit', title: 'fix: tests',   url: 'https://bb/c1', repo: 'frontend', at: ISO_2026_04_28_EARLY_AM(), hash: 'abc' },
        { kind: 'pr',     title: 'PR: Refactor', url: 'https://bb/p1', repo: 'frontend', at: ISO_2026_04_27_NOON,        status: 'merged' },
      ],
    },
  };
  return { authors: { ...defaultAuthors, ...authors }, configured: true, tried: [] };
}

function ISO_2026_04_28_EARLY_AM() { return '2026-04-28T03:15:00.000Z'; }

export function makeConfluenceAggregate(authors = {}) {
  return { authors, configured: true, tried: [] };
}

/** Convenient tiny payload for "happy path" tests. */
export function happyPathPayload() {
  const issue = withWorklog(
    withComment(
      withTransition(inProgressIssue({ key: 'PAY-1' }), ISO_2026_04_27_NOON, 'In Progress'),
      ISO_2026_04_28_EARLY_AM(),
      'Работаю над задачей'
    ),
    ISO_2026_04_28_EARLY_AM(),
    3600
  );
  return makePulsePayload({
    projectKeys: ['PAY'],
    reports: [makeRawReport({ pk: 'PAY', issues: [issue], sprintKeys: ['PAY-1'] })],
    bitbucket: makeBitbucketAggregate(),
  });
}
