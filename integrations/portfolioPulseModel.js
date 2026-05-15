'use strict';
/* ============================================================
   PORTFOLIO PULSE — MODEL ANALYSER
   Turns raw Jira reports into a structured pulse model.
   ============================================================ */

import {
  isTerminalStatus, isInitialStatus, isWipActive, ts,
  todayStart, yesterdayStart, twoDaysAgoStart, hoursAgo, daysAgo,
  userKey, userNameKey, userLabel, userAvatar, slimIssue, typeBucket, statusBucket,
  zephyrKind,
} from './portfolioPulseUtils.js';
import { Utils } from '../utils.js';
import { EmployeeFactory } from '../rowFactory.js';

const STALE_DAYS_DEFAULT = 7;

/**
 * @param  {object} rawReports - { reports: [{ projectKey, issues, error?, sprintKeys?, ... }], fetchedAt, projectKeys }
 * @param  {object} opts       - { staleDays: number }
 * @return {PulseModel}
 *
 * PulseModel = {
 *   fetchedAt, projectKeys[], errors[{pk, error}],
 *   participants[{ key, label, avatar, projects[],
 *                 issuesNow[], doneYesterday[], doneDayBefore[],
 *                 commentsRecent[], confluenceEdits[],
 *                 stale[], loggedYesterdaySec,
 *                 timelineYesterday[], timelinePrev[],
 *                 badges:{commits48h,pr48h,conf48h} }],
 *   unassignedByPk: { [pk]: issues[] },
 *   spaces: { [pk]: { issues[], sprintIssues[], backlogIssues[], wipIssues[],
 *                     activeSprintName, hasError, errorMsg } },
 *   summary: { totalIssues, wip, done, notStarted, unassigned, blockers,
 *              bugs, commits48h, pr48h, conf48h },
 * }
 */
/* V21 Y3 (audit-09 §F sleeping data) — собрать агрегаты которые УЖЕ есть
   в issue.fields, но никто их раньше не показывал. Вызывается per-issue
   в основном цикле analysePulse'а. Все аккумуляции в out.summary.* —
   читаются renderer'ом и AI-агентами без новых HTTP-вызовов. */
function _accumulateSleepingData(out, f, slim, pk, terminal) {
  // 1) Resolution split (Done / Won't Do / Duplicate / Cannot Reproduce / ...).
  if (terminal && f.resolution?.name) {
    const name = String(f.resolution.name).slice(0, 40);
    out.summary.resolutionSplit[name] = (out.summary.resolutionSplit[name] || 0) + 1;
  }
  // 2) Subtasks completion ratio per parent epic. epic key — поле parent.key.
  // Если у issue есть subtasks[] и issue сам — epic, считаем сколько из них Done.
  const subtasks = Array.isArray(f.subtasks) ? f.subtasks : [];
  if (subtasks.length) {
    const epicKey = slim.key || f.key || '';
    if (epicKey) {
      const sb = (out.summary.subtasksByEpic[epicKey] ||= { total: 0, done: 0, ratio: 0 });
      for (const st of subtasks) {
        sb.total++;
        const stCat = st?.fields?.status?.statusCategory?.key || '';
        if (stCat === 'done') sb.done++;
      }
      sb.ratio = sb.total ? sb.done / sb.total : 0;
    }
  }
  // 3) Per-author worklog breakdown — `worklog.worklogs[]`.
  const worklogs = f.worklog?.worklogs;
  if (Array.isArray(worklogs) && worklogs.length) {
    for (const w of worklogs) {
      const author = w.author?.displayName || w.author?.name || w.author?.emailAddress || '';
      if (!author) continue;
      const sec = Number(w.timeSpentSeconds) || 0;
      if (!sec) continue;
      const k = String(author).toLowerCase().trim();
      const e = (out.summary.worklogByAuthor[k] ||= { secondsTotal: 0, displayName: author });
      e.secondsTotal += sec;
    }
  }
  // 4) Issue-link graph («blocks» / «is blocked by» / depends-on).
  const links = Array.isArray(f.issuelinks) ? f.issuelinks : [];
  if (links.length) {
    const fromKey = slim.key || '';
    if (fromKey) {
      const arr = (out.summary.issueLinkGraph[fromKey] ||= []);
      for (const l of links) {
        const kind = l?.type?.name || l?.type?.outward || l?.type?.inward || '';
        const to   = l?.outwardIssue?.key || l?.inwardIssue?.key || '';
        if (kind && to) arr.push({ kind, toKey: to, dir: l?.outwardIssue ? 'out' : 'in' });
      }
    }
  }
  // 5) Component owner load.
  const comps = Array.isArray(f.components) ? f.components : [];
  for (const c of comps) {
    // QA A9.1 — нормализация: пустое и «—» одинаково не должно создавать
    // отдельный bucket. До фикса `""` и `"—"` могли стать двумя разными
    // ключами в `componentOwnerLoad` и портить топ-30 компонентов.
    const name = String(c?.name || '').trim();
    if (!name || name === '—') continue;
    const e = (out.summary.componentOwnerLoad[name] ||= { issueCount: 0, openCount: 0, lead: c.lead?.displayName || '' });
    e.issueCount++;
    if (!terminal) e.openCount++;
  }
  // 6) Fix-version coverage.
  const versions = Array.isArray(f.fixVersions) ? f.fixVersions : [];
  for (const v of versions) {
    const name = v?.name;
    if (!name) continue;
    const e = (out.summary.fixVersionCoverage[name] ||= { total: 0, done: 0, released: !!v.released });
    e.total++;
    if (terminal) e.done++;
  }
  // 7) Attachments — DoR-completeness proxy.
  if (Array.isArray(f.attachment) && f.attachment.length) out.summary.attachmentsCount++;
}

export function analysePulse(rawReports, opts = {}) {
  const staleDays = opts.staleDays || STALE_DAYS_DEFAULT;
  const yStart  = yesterdayStart();
  const tStart  = todayStart();
  const dbStart = twoDaysAgoStart();
  const win48   = hoursAgo(48);

  const out = {
    fetchedAt:    rawReports?.fetchedAt || new Date().toISOString(),
    projectKeys:  rawReports?.projectKeys || [],
    // Pass-through for renderIssueRow → "{base}/browse/{key}" links.
    jiraBaseUrl:  String(rawReports?.jiraBaseUrl || '').replace(/\/+$/, ''),
    errors:       [],
    participants: [],
    unassignedByPk: {},
    spaces:       {},
    summary: {
      totalIssues: 0, wip: 0, done: 0, notStarted: 0,
      unassigned: 0, blockers: 0, bugs: 0,
      commits48h: 0, pr48h: 0, conf48h: 0,
      // Wave 4c: Zephyr aggregate counters across all PKs.
      // testCases     — total test-case definitions in scope
      // testExecs     — total test execution issues
      // testsCreated48h / testsExecuted48h — windowed activity
      testCases: 0, testExecs: 0, testSets: 0,
      testsCreated48h: 0, testsExecuted48h: 0,
      testsPassed48h: 0,  testsFailed48h: 0,
      // Phase 3: precise per-day buckets (Yesterday / Today / DayBefore).
      // Useful for the «Делал вчера»/«Делал позавчера» secondary blocks.
      testsPassedToday: 0, testsFailedToday: 0,
      testsPassedYesterday: 0, testsFailedYesterday: 0,
      testsPassedDayBefore: 0, testsFailedDayBefore: 0,
      activeSprints: [],
      // V21 Y3 (audit-09 §F + §B #4-#15) — sleeping-data aggregates.
      //   resolutionSplit — { Done, "Won't Do", Duplicate, "Cannot Reproduce", ... }
      //   subtasksByEpic  — { epicKey: { total, done, ratio } } для completion-ratio
      //   worklogByAuthor — { authorKey: { secondsTotal, displayName } }
      //   issueLinkGraph  — { fromKey: [{ kind, toKey }, ...] } для dep graph
      //   componentOwnerLoad — { componentName: { issueCount, openCount } }
      //   fixVersionCoverage — { version: { total, done } } для release readiness
      //   attachmentsCount — total с приложениями (DoR-completeness proxy)
      resolutionSplit:    {},
      subtasksByEpic:     {},
      worklogByAuthor:    {},
      issueLinkGraph:     {},
      componentOwnerLoad: {},
      fixVersionCoverage: {},
      attachmentsCount:   0,
    },
    todoToday: [],          // 8.2 plan-for-today candidates
    yesterdayActivity: [],  // 8.3 what was done yesterday (transitions/worklog/comments)
    // Pass-through diagnostic blocks from server (so the renderer can show
    // status pills "Bitbucket: ✓/настр-н/ошибка" in the header).
    bitbucket:    rawReports?.bitbucket  || { authors: {}, configured: false },
    confluence:   rawReports?.confluence || { authors: {}, configured: false },
    zephyr:       rawReports?.zephyr     || { authors: {}, configured: false },     // V20 S9
    // V21 Y4 — big metrics passthrough.
    bigMetrics:   rawReports?.bigMetrics || { reopenRate: { byPk: {} }, sprintCommit: { byPk: {} }, staleBranches: { byRepo: {} }, staleConfluence: { bySpace: {} } },
    // Per-PK timing log + log buffer from server (#2.3 — surface why one team
    // sometimes times out so the user has actionable info).
    diagnostics:  rawReports?.diagnostics || { totalMs: 0, perPk: [], log: [] },
  };

  const userMap = new Map();
  // V12 (FOUND_BUGS #2): a secondary `nameKey → primaryKey` lookup so the
  // SAME human encountered with `{displayName, emailAddress}` (assignee path)
  // and later with `{displayName}` only (changelog.author) merges into one
  // participant. Without this map, userKey() returns email then displayName
  // — different strings — and the model creates a duplicate.
  const nameToPrimaryKey = new Map();
  // Wave 4b: collected mentions resolved AFTER the main walk so we only create
  // events for participants that actually exist (assignees / commenters /
  // changelog authors). Unknown usernames are dropped silently — better than
  // surfacing a ghost participant with no displayName.
  const _pendingMentions = [];
  const ensureUser = (u, projectKey) => {
    let k = userKey(u);
    if (!k) return null;
    // V12 secondary lookup: if we've seen this displayName before under a
    // richer key (e.g. email-based), redirect this call to that participant.
    const nameK = userNameKey(u);
    if (nameK && !userMap.has(k) && nameToPrimaryKey.has(nameK)) {
      k = nameToPrimaryKey.get(nameK);
    }
    let p = userMap.get(k);
    if (!p) {
      p = {
        key: k, label: userLabel(u), avatar: userAvatar(u),
        // V17.2 I1c — capture explicit identity from Jira user object.
        //   These are used for deterministic matching against
        //   state.employees[].{email, jiraAccountId, bitbucketLogin}.
        //   Fuzzy-name fallback больше НЕ используется — если ни один из
        //   этих полей не сматчился с employee, то BB/CF данные просто не
        //   привязываются (раньше fuzzy 2-token overlap раздавал чужие PR).
        email:           String(u.emailAddress || u.email || '').toLowerCase().trim(),
        jiraAccountId:   String(u.accountId    || u.key   || u.name || '').trim(),
        projects: new Set(),
        issuesNow: [], doneYesterday: [], doneDayBefore: [], stale: [],
        commentsRecent: [], confluenceEdits: [],
        // Three timelines per user (today / yesterday / day-before-yesterday)
        // each holds [{kind, issue, at, text?}] in chronological order.
        timelineToday:     [],   // wave 2: events with `at >= tStart`
        timelineYesterday: [],
        timelinePrev:      [],
        // Per-day rollups so the renderer doesn't have to re-scan timelines.
        doneToday:    [],        // issues moved to terminal status today
        commentsToday: [],       // {kind:'comment', issue, at, text}
        issuesCreatedToday: [],  // slim issues created today, where reporter is this user
        loggedTodaySec: 0,
        loggedYesterdaySec: 0, loggedDayBeforeSec: 0,
        badges: { commits48h: 0, pr48h: 0, conf48h: 0,
                  testsCreated48h: 0, testsExecuted48h: 0,
                  testsPassed48h: 0, testsFailed48h: 0 },
        bbItems: [],   // hydrated below from rawReports.bitbucket.authors[*].items
        cfItems: [],   // wave 2: hydrated from rawReports.confluence.authors[*].items
        // Wave 4c: per-user Zephyr buckets — Test/Test-Exec issues this person
        // created or whose result they recorded in the 48h window.
        zephyrTestsCreatedRecent:  [],   // [{slim, kind:'test'|'testSet', at}]
        zephyrTestsExecutedRecent: [],   // [{slim, result:'PASS'|'FAIL'|...., at}]
      };
      userMap.set(k, p);
      // V12: register displayName → this primaryKey so a later author seen
      // with only `{displayName}` (no email) finds us instead of creating a dup.
      if (nameK && !nameToPrimaryKey.has(nameK)) nameToPrimaryKey.set(nameK, k);
    }
    if (projectKey) p.projects.add(projectKey);
    return p;
  };

  // Walk per-project reports
  for (const report of (rawReports?.reports || [])) {
    if (report.error) {
      out.errors.push({ projectKey: report.projectKey, error: report.error });
      out.spaces[report.projectKey] = { hasError: true, errorMsg: report.error, issues: [], sprintIssues: [], backlogIssues: [], wipIssues: [], activeSprintName: '', activeSprintInfo: null };
      continue;
    }
    const pk = report.projectKey;
    const sprintKeys = new Set(report.sprintKeys || []);
    const inProgressKeys = new Set(report.inProgressKeys || []);
    const backlogKeys = new Set(report.backlogKeys || []);

    const space = {
      hasError: false, errorMsg: '',
      issues: [], sprintIssues: [], backlogIssues: [], wipIssues: [],
      activeSprintName: '', activeSprintInfo: null,
      stats: { byBucket: { story:0, task:0, bug:0, subtask:0, other:0 }, byStatus: { todo:0, wip:0, done:0 } },
    };
    out.spaces[pk] = space;
    out.unassignedByPk[pk] = [];

    for (const issue of (report.issues || [])) {
      const f = issue.fields || {};
      const status   = f.status?.name || '';
      const statusCat= f.status?.statusCategory?.key || '';
      const terminal = isTerminalStatus(status, statusCat);
      const initial  = isInitialStatus(status, statusCat);
      const slim = slimIssue(issue, pk);
      space.issues.push(slim);
      out.summary.totalIssues++;

      // Sprint / backlog / wip classification
      if (sprintKeys.has(issue.key)) space.sprintIssues.push(slim);
      if (backlogKeys.has(issue.key)) space.backlogIssues.push(slim);
      if (!terminal && isWipActive(issue)) space.wipIssues.push(slim);

      // Try to capture active sprint name from sprint fields. Sprint info can live
      // under customfield_10020 (Cloud) / customfield_10010 (Server) / customfield_10007
      // OR under the alias "sprint" (newer Jira). Each entry is either an object
      // {name, state, startDate, endDate} or a legacy string "...,name=Foo,state=ACTIVE,...".
      // Strategy:
      //  1) prefer entries with state===active (canonical case);
      //  2) if the current issue is in sprintKeys (came from `sprint in openSprints()` JQL)
      //     and we still have no name, take ANY sprint name from it — that sprint is
      //     active by JQL definition, just lacking explicit state in the response.
      if (!space.activeSprintName) {
        const isInOpenSprint = sprintKeys.has(issue.key);
        const candidates = [];
        for (const k of Object.keys(f)) {
          if (k !== 'sprint' && !k.startsWith('customfield_')) continue;
          const v = f[k];
          const arr = Array.isArray(v) ? v : (v ? [v] : []);
          for (const sp of arr) {
            const sName  = sp?.name  || (typeof sp === 'string' ? extractSprintName(sp)  : '');
            const sState = sp?.state || (typeof sp === 'string' ? extractSprintState(sp) : '');
            if (!sName) continue;
            candidates.push({ name: sName, state: sState, raw: sp });
          }
        }
        // 1) explicit active
        const active = candidates.find(c => /active/i.test(c.state || ''));
        if (active) {
          space.activeSprintName = active.name;
          space.activeSprintInfo = active.raw;
        } else if (isInOpenSprint && candidates.length) {
          // 2) fallback: issue came from openSprints() JQL — first non-closed candidate
          const fallback = candidates.find(c => !/closed/i.test(c.state || '')) || candidates[0];
          space.activeSprintName = fallback.name;
          space.activeSprintInfo = fallback.raw;
        }
      }

      // Stats
      space.stats.byBucket[typeBucket(slim)] += 1;
      const sb = statusBucket(status, statusCat);
      space.stats.byStatus[sb] += 1;

      // Summary aggregates
      if (terminal) out.summary.done++;
      else if (initial) out.summary.notStarted++;
      else out.summary.wip++;
      if (typeBucket(slim) === 'bug') out.summary.bugs++;
      if (f.priority?.name && /blocker|highest|критич/i.test(f.priority.name) && !terminal) out.summary.blockers++;

      // V21 Y3 (audit-09 §F + #1-#3 sleeping data) — surface aggregates from
      // данных, которые УЖЕ едут в payload, но никем не используются.
      _accumulateSleepingData(out, f, slim, pk, terminal);

      // ── Wave 4c: Zephyr classification + per-issue counters ──
      const zKind = zephyrKind(slim);
      if (zKind === 'test')     out.summary.testCases++;
      if (zKind === 'testExec') out.summary.testExecs++;
      if (zKind === 'testSet')  out.summary.testSets++;
      // 48h window: created? terminal-status (PASS/FAIL) attribution comes
      // later in the changelog walk, so we do NOT add here for testsExecuted48h.
      const tCreated = ts(f.created);
      if (zKind && tCreated && tCreated >= win48) out.summary.testsCreated48h++;

      const assignee = f.assignee || null;
      if (!assignee && !terminal) {
        out.unassignedByPk[pk].push(slim);
        out.summary.unassigned++;
      }

      const user = assignee ? ensureUser(assignee, pk) : null;

      // 3.1 In progress now
      if (user && !terminal) user.issuesNow.push(slim);

      // 3.6 Stale (active, not updated for >= staleDays)
      if (user && !terminal) {
        const upd = ts(f.updated);
        if (upd && (Date.now() - upd) >= staleDays * 24 * 3600 * 1000) {
          user.stale.push({ ...slim, daysIdle: Math.floor((Date.now() - upd) / (24*3600*1000)) });
        }
      }

      // V21 AT (audit-09 §H Person #18) — per-issue reopen tracker.
      // Если на любом шаге changelog видим Done→non-Done (или status
      // переехал с terminal на active), помечаем issue. После цикла
      // attribute'им rework к assignee (если он есть).
      let issueHadReopen = false;
      // V21 BB (audit-09 §H Sprint #17) — Carry-over age = кол-во раз
      // когда issue перемещался между спринтами.
      let issueSprintMoves = 0;

      // Walk changelog: status transitions + ALL field-change events (wave 4a).
      // Every history item now produces an event of one of these kinds:
      //   transition / closed  — `field === 'status'` (kept verbatim from wave 1)
      //   assignee-change      — `field === 'assignee'`
      //   attachment           — `field === 'Attachment'` (Jira capitalises this)
      //   link                 — `field === 'Link'`
      //   field-change         — anything else worth surfacing (description,
      //                          summary, priority, labels, fixVersions,
      //                          Story Points, Sprint, …)
      // Fields explicitly ignored: Rank (Jira reorder noise), timeestimate,
      // resolution (covered by status), Workflow.
      const histories = issue.changelog?.histories || [];
      for (const h of histories) {
        const tH = ts(h.created);
        if (!tH) continue;
        const moverU = h.author && ensureUser(h.author, pk);
        if (!moverU) continue;
        for (const it of (h.items || [])) {
          const event = _changelogItemToEvent(it, slim, h.created);
          if (!event) continue;
          // V21 AT — detect rework: status changed FROM terminal TO non-terminal.
          if ((it.field || '').toLowerCase() === 'status') {
            const fromS = it.fromString || it.from || '';
            const toS   = it.toString   || it.to   || '';
            if (fromS && toS && isTerminalStatus(fromS) && !isTerminalStatus(toS)) {
              issueHadReopen = true;
            }
          }
          // V21 BA/BB (audit-09 §H Sprint #16, #17) — Sprint field changes:
          // scope churn (per-sprint added/removed) + carry-over age (per-issue moves).
          if ((it.field || '').toLowerCase() === 'sprint') {
            const fromList = String(it.fromString || '').split(/\s*,\s*/).filter(Boolean);
            const toList   = String(it.toString   || '').split(/\s*,\s*/).filter(Boolean);
            const added   = toList.filter(s => !fromList.includes(s));
            const removed = fromList.filter(s => !toList.includes(s));
            if (added.length || removed.length) issueSprintMoves++;
            if (!out.summary.scopeChurn) out.summary.scopeChurn = {};
            for (const sprintName of added) {
              const e = (out.summary.scopeChurn[sprintName] ||= { added: [], removed: [] });
              e.added.push({ key: slim.key, at: h.created, by: h.author?.displayName || h.author?.name || '' });
            }
            for (const sprintName of removed) {
              const e = (out.summary.scopeChurn[sprintName] ||= { added: [], removed: [] });
              e.removed.push({ key: slim.key, at: h.created, by: h.author?.displayName || h.author?.name || '' });
            }
          }

          // Wave 4c + Phase 3: Zephyr execution attribution. When a Test Execution
          // issue moves to a PASS/FAIL/BLOCKED state, attribute it to the mover.
          // Two sources of "result":
          //   1) status.name    — works for simple Zephyr setups (status === result)
          //   2) customfield_X  — Zephyr Scale / Xray store result in a separate field.
          //                        Field ID auto-discovered by server, passed in
          //                        rawReports.zephyrResultFieldId.
          if (zKind === 'testExec' && (event.kind === 'transition' || event.kind === 'closed')) {
            // Try the explicit customfield first if both we have an id AND the
            // changelog item targets that field. Otherwise infer from new status.
            let result = '';
            if (rawReports?.zephyrResultFieldId && it.fieldId === rawReports.zephyrResultFieldId) {
              result = _zephyrResultFromStatus(it.toString || it.to || '');
            }
            if (!result) result = _zephyrResultFromStatus(event.to);
            if (result) {
              if (tH >= win48) {
                out.summary.testsExecuted48h++;
                if (result === 'PASS') out.summary.testsPassed48h++;
                if (result === 'FAIL') out.summary.testsFailed48h++;
                moverU.zephyrTestsExecutedRecent.push({
                  slim, result, at: h.created,
                });
                moverU.badges.testsExecuted48h++;
                if (result === 'PASS') moverU.badges.testsPassed48h++;
                if (result === 'FAIL') moverU.badges.testsFailed48h++;
              }
              // Phase 3: split into precise per-day buckets so the renderer
              // can show "Прогнал вчера: 5 (✓3/✗2)" without re-filtering by hand.
              if (tH >= tStart) {
                if (result === 'PASS') out.summary.testsPassedToday++;
                if (result === 'FAIL') out.summary.testsFailedToday++;
              } else if (tH >= yStart && tH < tStart) {
                if (result === 'PASS') out.summary.testsPassedYesterday++;
                if (result === 'FAIL') out.summary.testsFailedYesterday++;
              } else if (tH >= dbStart && tH < yStart) {
                if (result === 'PASS') out.summary.testsPassedDayBefore++;
                if (result === 'FAIL') out.summary.testsFailedDayBefore++;
              }
            }
          }

          // Time-bucket the event into today / yesterday / dayBefore.
          if (tH >= tStart) {
            moverU.timelineToday.push(event);
            if (event.kind === 'closed') moverU.doneToday.push(slim);
          } else if (tH >= yStart && tH < tStart) {
            moverU.timelineYesterday.push(event);
            if (event.kind === 'closed') moverU.doneYesterday.push(slim);
            // yesterdayActivity feed is the «Что делали вчера» list on the
            // Сводка tab — surface ALL kinds, not just status transitions.
            out.yesterdayActivity.push({ kind: event.kind, issue: slim, at: h.created, who: moverU.label, text: event.text });
          } else if (tH >= dbStart && tH < yStart) {
            moverU.timelinePrev.push(event);
            if (event.kind === 'closed') moverU.doneDayBefore.push(slim);
          }
        }
      }

      // V21 AT — после полного walk'а changelog: если был хоть один reopen,
      // attribute к текущему assignee (если есть). Это per-issue events count
      // — issue с 5 reopens'ами = 5 punches by current assignee.
      if (issueHadReopen && user) {
        user.reworkCount = (user.reworkCount || 0) + 1;
      }
      // V21 BB — Carry-over age: сохраняем для post-aggregation.
      if (issueSprintMoves > 0) {
        if (!out.summary.carryOverAges) out.summary.carryOverAges = [];
        out.summary.carryOverAges.push({
          key: slim.key,
          summary: (f.summary || '').slice(0, 60),
          moves: issueSprintMoves,
          assignee: assignee?.displayName || assignee?.name || '',
        });
      }

      // Walk comments: 48h window. Wave 4b adds mention extraction:
      // any `[~username]` token in the body produces a separate `mention`
      // event for the receiving user (not the author). Both events live in
      // the SAME issue but in different participants' timelines.
      const comments = f.comment?.comments || [];
      for (const c of comments) {
        const tC = ts(c.created);
        if (!tC || tC < win48) continue;
        const author = c.author && ensureUser(c.author, pk);
        if (!author) continue;
        const body = String(c.body || '');
        const evt = { kind: 'comment', issue: slim, at: c.created, text: body.slice(0, 220) };
        author.commentsRecent.push(evt);
        if (tC >= tStart) {
          author.timelineToday.push(evt);
          author.commentsToday.push(evt);
        } else if (tC >= yStart && tC < tStart) {
          author.timelineYesterday.push(evt);
          out.yesterdayActivity.push({ kind: 'comment', issue: slim, at: c.created, who: author.label, text: evt.text });
        } else if (tC >= dbStart && tC < yStart) {
          author.timelinePrev.push(evt);
        }

        // Wave 4b: mentions. Match `[~accountId]` (Cloud) and `[~name.surname]` (Server).
        // Each mention pushes an event to the MENTIONED user's timeline so they see
        // "📣 Иван упомянул вас в PAY-12". Resolution happens AFTER the main walk
        // (deferred to avoid creating ghost participants for unknown usernames) —
        // we just collect raw {mentionedKey, evt, when} tuples here.
        const mentioned = _extractMentions(body);
        if (mentioned.size) {
          for (const userKeyOrName of mentioned) {
            _pendingMentions.push({
              key: userKeyOrName, pk,
              evt: {
                kind:  'mention',
                issue: slim, at: c.created,
                text:  `${author.label} упомянул в комментарии: ${body.slice(0, 140)}`,
                who:   author.label,
              },
              tC, authorKey: author.key,
            });
          }
        }
      }

      // Walk worklog: today / yesterday / dayBefore aggregation
      const wls = f.worklog?.worklogs || [];
      for (const wl of wls) {
        const tW = ts(wl.started);
        if (!tW) continue;
        const author = wl.author && ensureUser(wl.author, pk);
        if (!author) continue;
        const sec = Number(wl.timeSpentSeconds || 0);
        if (tW >= tStart) {
          author.loggedTodaySec += sec;
          author.timelineToday.push({ kind: 'worklog', issue: slim, at: wl.started, text: `Залогировано ${Math.round(sec/3600*10)/10}ч` });
        } else if (tW >= yStart && tW < tStart) {
          author.loggedYesterdaySec += sec;
          author.timelineYesterday.push({ kind: 'worklog', issue: slim, at: wl.started, text: `Залогировано ${Math.round(sec/3600*10)/10}ч` });
          out.yesterdayActivity.push({ kind: 'worklog', issue: slim, at: wl.started, who: author.label, text: `${Math.round(sec/3600*10)/10}ч` });
        } else if (tW >= dbStart && tW < yStart) {
          author.loggedDayBeforeSec += sec;
        }
      }

      // Issue created today by this user → counts toward "Багов заведено" / generic created list.
      // (note: tCreated already computed earlier for the testsCreated48h aggregate; reuse it.)
      if (tCreated && tCreated >= tStart && f.reporter) {
        const reporter = ensureUser(f.reporter, pk);
        if (reporter) {
          reporter.issuesCreatedToday.push(slim);
          // Also surface in today's timeline so the chronological feed has the event.
          reporter.timelineToday.push({ kind: 'created', issue: slim, at: f.created, text: `Создал задачу ${slim.key}` });
        }
      }
      // Wave 4c: Zephyr "test created" attribution — broader window (48h, not just today).
      if (zKind && tCreated && tCreated >= win48 && f.reporter) {
        const reporter = ensureUser(f.reporter, pk);
        if (reporter) {
          reporter.zephyrTestsCreatedRecent.push({ slim, kind: zKind, at: f.created });
          reporter.badges.testsCreated48h++;
        }
      }

      // 8.2 Plan for today: heuristic — assigned, in WIP/sprint, not terminal,
      // not just-updated yesterday (recently-active issues likely continue today).
      if (assignee && !terminal && (sprintKeys.has(issue.key) || isWipActive(issue))) {
        out.todoToday.push(slim);
      }
    }
  }

  // ── Wave 4b: resolve pending mentions against KNOWN participants ──
  // For each [~user] mention collected during comment walk, try to find a
  // matching participant by:
  //   1) exact userKey match (rare — would only match if assignee uses .name field)
  //   2) prefix match against label (e.g. "anna.petrova" matches "Anna Petrova")
  //   3) substring match against label tokens
  // If no match — drop silently (don't create a ghost participant).
  for (const pending of _pendingMentions) {
    const wanted = String(pending.key || '').toLowerCase();
    if (!wanted) continue;
    // 1) Exact userKey match (rare but cheapest).
    // 2) Email-username match: "anna.petrova" hits user with email "anna.petrova@whatever".
    //    This is the most common case — Jira Server stores user.name === email-prefix.
    // 3) Fuzzy: split mention by dot/underscore/hyphen, check ALL tokens present in label.
    let target = null;
    for (const u of userMap.values()) {
      if (u.key === pending.authorKey) continue;
      const uKey = String(u.key || '').toLowerCase();
      if (uKey === wanted) { target = u; break; }
      const emailUser = uKey.split('@')[0];                 // anna.petrova@x → anna.petrova
      if (emailUser && emailUser === wanted) { target = u; break; }
    }
    if (!target) {
      const tokens = wanted.split(/[._\s\-]+/).filter(Boolean);
      for (const u of userMap.values()) {
        if (u.key === pending.authorKey) continue;
        const labelLow = String(u.label || '').toLowerCase();
        const keyLow   = String(u.key   || '').toLowerCase();
        const allMatchLabel = tokens.length && tokens.every(t => labelLow.includes(t));
        const allMatchKey   = tokens.length && tokens.every(t => keyLow.includes(t));
        if (allMatchLabel || allMatchKey) { target = u; break; }
      }
    }
    if (!target) continue;                                  // unknown — drop silently
    if (pending.tC >= tStart) target.timelineToday.push(pending.evt);
    else if (pending.tC >= yStart && pending.tC < tStart) target.timelineYesterday.push(pending.evt);
    else if (pending.tC >= dbStart && pending.tC < yStart) target.timelinePrev.push(pending.evt);
  }

  // ── Hydrate badges from Bitbucket / Confluence aggregates (added by server) ──
  // V17.2 I1c — deterministic attribution. Источники сходятся к сотруднику
  //   ТОЛЬКО через explicit identity (email / accountId / login). Fuzzy
  //   2-token-overlap по ФИО (старый _ppFindByPartial) больше НЕ
  //   используется в production — он остался ниже как dev-fallback за
  //   флагом opts.allowFuzzyAuthorMatch=true.
  //
  //   Алгоритм:
  //     1) Из state.employees строим обратные индексы: byEmail / byJiraId
  //        / byBbLogin / byCfId (все lowercase). Они говорят «email X
  //        принадлежит сотруднику Y».
  //     2) Для каждого участника userMap пытаемся найти соответствующего
  //        employee — по `p.email` (1st priority) или `p.jiraAccountId`.
  //     3) Если нашли — используем employee.bitbucketLogin / .email /
  //        .confluenceAccountId для поиска в bbAuthors / cfAuthors.
  //     4) Если не нашли — пробуем напрямую по `p.email` (PR-автор тоже
  //        мог записать тот же email). Это покрывает ситуацию когда
  //        участник Jira не заведён в state.employees.
  //     5) Никогда не используем токены ФИО.
  // V18 P8 — server теперь отдаёт raw `repoAuthors` + `devStatusAuthors`
  //   отдельно. Используем merged (`authors`) как fallback для legacy
  //   ответов, но если есть raw bucket'ы — приоритет за repoAuthors
  //   (authoritative источник: юзер настроил BB).
  //   В будущем UI может различать «PR прошёл через настроенный BB» vs
  //   «PR замечен только через Jira dev-info» (это два разных уровня доверия).
  const bbAuthors        = (rawReports?.bitbucket?.authors)          || {};
  const bbRepoAuthors    = (rawReports?.bitbucket?.repoAuthors)      || {};
  const bbDevStatusAuthors=(rawReports?.bitbucket?.devStatusAuthors) || {};
  const cfAuthors = (rawReports?.confluence?.authors) || {};
  // V20 S9 — Real Zephyr authors (deterministic match by JIRAUSER-key).
  const zephyrAuthors = (rawReports?.zephyr?.authors) || null;
  // V21 Z-attr fix (diagnostic 2026-05-07: 7 zephyrAuthors / 0 attributed).
  // Сервер нормализует ключи через _zephyrNormalizeUserKey: numeric→JIRAUSERxxx,
  // username→lowercase. Клиент должен применить ту же нормализацию к
  // emp.jiraAccountId перед лукапом — иначе registry с raw "1697487" не
  // матчится с серверным ключом "JIRAUSER1697487", и наоборот.
  // Дополнительно строим reverse-index по displayName (case-insensitive,
  // trimmed): authoritative-fallback когда jiraAccountId форматы расходятся.
  const _zephyrNormKey = (raw) => {
    if (raw == null) return '';
    let k = String(raw).trim();
    if (!k) return '';
    if (/^\d{5,}$/.test(k)) return `JIRAUSER${k}`;
    if (/^[A-Za-z][A-Za-z0-9._-]+$/.test(k)) return k.toLowerCase();
    return k;
  };
  const _zephyrByDisplayName = {};
  if (zephyrAuthors) {
    for (const [k, v] of Object.entries(zephyrAuthors)) {
      const dn = String(v?.displayName || '').toLowerCase().trim();
      if (dn) _zephyrByDisplayName[dn] = { key: k, entry: v };
    }
  }
  const employees = Array.isArray(opts?.employees) ? opts.employees : [];
  // V21 — defence-in-depth для fuzzy-matcher (audit-2026-05-04 functional #3,
  // V17 I1c регрессия: случайная утечка флага в config привела к BB/CF
  // attribution не тому сотруднику). Параметр сохранён как DevTools-возможность,
  // но активируется ТОЛЬКО при ОБОИХ условиях:
  //   1. caller передал opts.allowFuzzyAuthorMatch === true (явный opt-in)
  //   2. в среде установлен dev-флаг:
  //      - browser: `localStorage._prizma_dev_fuzzy_match === '1'`
  //        (выставляется вручную через DevTools, не через UI)
  //      - node:    `process.env.PRIZMA_DEV_FUZZY === '1'`
  //        (тесты / CLI-debug)
  // В production оба отсутствуют → allowFuzzy всегда false, даже если
  // opts.allowFuzzyAuthorMatch=true случайно попадёт в config.
  let allowFuzzy = false;
  if (opts?.allowFuzzyAuthorMatch === true) {
    const localDev = (typeof localStorage !== 'undefined')
      && localStorage.getItem('_prizma_dev_fuzzy_match') === '1';
    const nodeDev  = (typeof process !== 'undefined')
      && process.env && process.env.PRIZMA_DEV_FUZZY === '1';
    allowFuzzy = localDev || nodeDev;
  }

  // Build reverse identity indexes from state.employees.
  // R5: единый detectBlocked из EmployeeFactory вместо локального regex.
  const empByEmail   = new Map();
  const empByJiraId  = new Map();
  const empByBbLogin = new Map();
  const empByCfId    = new Map();
  for (const e of employees) {
    if (!e) continue;
    if (e.isBlocked || EmployeeFactory.detectBlocked(e)) continue;
    // V21 ghost-filter — auto-created без identity-полей и без ФИО
    // (diagnostic 2026-05-07: 6 призраков с label==key). Не индексируем
    // их — они не должны получать BB/CF-attribution и не считаются
    // в team-coverage метриках.
    if (EmployeeFactory.detectGhost(e)) continue;
    if (e.email)               empByEmail  .set(String(e.email              ).toLowerCase().trim(), e);
    if (e.jiraAccountId)       empByJiraId .set(String(e.jiraAccountId      ).toLowerCase().trim(), e);
    if (e.bitbucketLogin)      empByBbLogin.set(String(e.bitbucketLogin     ).toLowerCase().trim(), e);
    if (e.confluenceAccountId) empByCfId   .set(String(e.confluenceAccountId).toLowerCase().trim(), e);
    // QD4: aliasEmails — все альтернативные адреса этого человека резолвятся
    // в одну запись emp. Например work@sber + personal@gmail оба ведут к одному.
    if (e.aliasEmails) {
      for (const a of String(e.aliasEmails).split(/[|,]/).map(s => s.trim().toLowerCase()).filter(Boolean)) {
        if (!empByEmail.has(a)) empByEmail.set(a, e);
      }
    }
  }

  // BB authors are keyed by `(displayName || email).toLowerCase()` on the
  // server (server.js _ppKeyForAuthor). To find by login we need a
  // reverse-build: scan once and index by every recognizable identifier the
  // entry exposes (email, displayName, the key itself = bitbucket login in
  // most cases when displayName is missing).
  // H5: Russian-only Stash-профили дают key = русский displayName ("Иванов И.И."),
  // pустой slug, пустой email. Бывает что bb-login сотрудника НЕ заполнен —
  // тогда атрибуция падает. Fingerprint = "lastname + firstInitial" в
  // нижнем регистре, без пробелов/точек: "Иванов И.И." → "ивановии",
  // "Иванов Иван Иванович" → "ивановии" — оба нормализуются одинаково
  // и сравниваются с emp.fio таким же fingerprint'ом.
  const _fioFingerprint = (raw) => {
    const s = String(raw || '').toLowerCase().replace(/[.\s]+/g, ' ').trim();
    if (!s) return '';
    const parts = s.split(' ').filter(Boolean);
    if (!parts.length) return '';
    const last = parts[0] || '';
    const firstInitial = (parts[1] || '')[0] || '';
    const middleInitial = (parts[2] || '')[0] || '';
    return `${last}${firstInitial}${middleInitial}`;
  };
  // R4: маркер коллизии fingerprint'а — два разных «Иванов И.А.» из разных
  // команд имеют одинаковый fp. Раньше последний перетирал первого →
  // забирал чужие коммиты. Теперь при коллизии помечаем ambiguous и при
  // lookup возвращаем null (лучше потерять атрибуцию чем приписать чужому).
  const FIO_FP_AMBIGUOUS = Symbol('fio-fp-ambiguous');
  const _buildAuthorLookups = (authorsMap) => {
    const byEmail = new Map();
    const byKey   = new Map();      // raw lookup key (displayName / login lowercase)
    const bySlug  = new Map();      // Stash login slug (author.name from API)
    const byFioFp = new Map();      // H5: fingerprint "ивановии" → entry | AMBIGUOUS
    if (!authorsMap) return { byEmail, byKey, bySlug, byFioFp };
    for (const [k, v] of Object.entries(authorsMap)) {
      byKey.set(String(k).toLowerCase().trim(), v);
      const em = String(v?.email || '').toLowerCase().trim();
      if (em) byEmail.set(em, v);
      const sl = String(v?.slug || '').toLowerCase().trim();
      if (sl) bySlug.set(sl, v);
      // Индексируем по fingerprint'у displayName (Russian-friendly).
      const fp = _fioFingerprint(v?.displayName || k);
      if (fp && /[а-яё]/i.test(v?.displayName || k)) {
        if (byFioFp.has(fp)) {
          byFioFp.set(fp, FIO_FP_AMBIGUOUS);
        } else {
          byFioFp.set(fp, v);
        }
      }
    }
    return { byEmail, byKey, bySlug, byFioFp };
  };
  // Helper: безопасное чтение fingerprint-lookup с защитой от collision'а.
  // QD3: дополнительно проверяет cross-bucket-ambiguous set.
  const _fpLookup = (fpMap, fp) => {
    if (!fpMap || !fp) return null;
    if (_fpCrossBucketAmbiguous && _fpCrossBucketAmbiguous.has(fp)) return null;
    const v = fpMap.get(fp);
    return (v === FIO_FP_AMBIGUOUS || v === undefined) ? null : v;
  };
  // V18 P8 — раздельные lookup'ы для repo-authors и dev-status authors.
  //   Priority: repo-walk authors (authoritative) → dev-status (supplementary)
  //   Если raw bucket'ов нет (legacy server) — используем merged `authors`.
  const bbRepoLookup      = _buildAuthorLookups(Object.keys(bbRepoAuthors).length      ? bbRepoAuthors      : null);
  const bbDevStatusLookup = _buildAuthorLookups(Object.keys(bbDevStatusAuthors).length ? bbDevStatusAuthors : null);
  const bbLookup          = _buildAuthorLookups(bbAuthors);   // legacy fallback
  // QD3: cross-bucket fingerprint collision detect. Раньше collision
  // ловилась только внутри одного lookup'а. Если «Иванов И.А.» из repo-walk
  // и другой «Иванов И.А.» из merged-bucket — оба попали бы в свои Map'ы
  // как single entry, fingerprint-fallback вернул бы случайного. Теперь
  // вычисляем set fp'ов которые встречаются в >1 buckets — для них
  // attribution всегда null.
  const _fpCrossBucketAmbiguous = new Set();
  {
    const seenIn = new Map();   // fp → Set<bucketName>
    const collect = (lookup, name) => {
      for (const [fp, v] of lookup.byFioFp) {
        if (v === FIO_FP_AMBIGUOUS) { _fpCrossBucketAmbiguous.add(fp); continue; }
        if (!seenIn.has(fp)) seenIn.set(fp, new Set());
        seenIn.get(fp).add(name);
      }
    };
    collect(bbRepoLookup, 'repo');
    collect(bbDevStatusLookup, 'devStatus');
    collect(bbLookup, 'merged');
    for (const [fp, buckets] of seenIn) {
      if (buckets.size > 1) _fpCrossBucketAmbiguous.add(fp);
    }
  }
  const cfLookup          = _buildAuthorLookups(cfAuthors);

  // Helper: ищет автора через несколько lookup'ов в порядке приоритета.
  // Возвращает {entry, source: 'repo'|'devStatus'|'merged'} или null.
  const _resolveBbAuthor = (key, email) => {
    const k = key ? String(key).toLowerCase().trim() : '';
    const e = email ? String(email).toLowerCase().trim() : '';
    if (Object.keys(bbRepoAuthors).length) {
      const v = (k && (bbRepoLookup.byKey.get(k) || bbRepoLookup.bySlug.get(k)))
             || (e && bbRepoLookup.byEmail.get(e));
      if (v) return { entry: v, source: 'repo' };
      const d = (k && (bbDevStatusLookup.byKey.get(k) || bbDevStatusLookup.bySlug.get(k)))
             || (e && bbDevStatusLookup.byEmail.get(e));
      if (d) return { entry: d, source: 'devStatus' };
      // Fallback to merged map — covers the case where repo walk has commit-only
      // entries keyed by git display name (Russian), but dev-status is keyed by
      // login (Latin). Previously returned null here, breaking all attribution
      // whenever ANY commit existed in the repo walk window.
      const fb = (k && (bbLookup.byKey.get(k) || bbLookup.bySlug.get(k)))
              || (e && bbLookup.byEmail.get(e));
      return fb ? { entry: fb, source: 'merged' } : null;
    }
    const v = (k && (bbLookup.byKey.get(k) || bbLookup.bySlug.get(k)))
           || (e && bbLookup.byEmail.get(e));
    return v ? { entry: v, source: 'merged' } : null;
  };

  for (const p of userMap.values()) {
    // 1) Find this participant in state.employees by identity.
    let emp = null;
    // V21 J #65 — identity case-sensitivity fix: empByEmail хранит ключи
    // lowercased+trimmed, p.email сырой → 30% misses на `User@x.ru` vs
    // `user@x.ru`. Нормализуем на query-time.
    const pEmailNorm = p.email ? String(p.email).toLowerCase().trim() : '';
    if (pEmailNorm && empByEmail.has(pEmailNorm)) emp = empByEmail.get(pEmailNorm);
    if (!emp && p.jiraAccountId && empByJiraId.has(String(p.jiraAccountId).toLowerCase().trim())) {
      emp = empByJiraId.get(String(p.jiraAccountId).toLowerCase().trim());
    }
    // V20 S4 — propagate service-account flag (если включен в реестре).
    // Auto-detect happens в EmployeeFactory.normalize() при загрузке employees.
    p.isServiceAccount = !!(emp?.isServiceAccount);

    // 2) Bitbucket: prefer employee.bitbucketLogin lookup. If employee
    //    has no BB login, do NOT attribute (this is the user's complaint:
    //    «сотрудник без BB получает чужие PR»).
    let bbResolved = null;
    if (emp) {
      if (emp.bitbucketLogin) bbResolved = _resolveBbAuthor(emp.bitbucketLogin, '');
      if (!bbResolved && emp.email) bbResolved = _resolveBbAuthor('', emp.email);
      // H5 + QD1: Russian-only Stash-профиль (нет email/slug) — пробуем fingerprint
      // по emp.fio. Identity-deterministic контракт CLAUDE.md §3:
      //   «нет bbLogin → не должен получать BB-данные».
      // Поэтому fingerprint срабатывает ТОЛЬКО если у emp есть email но нет
      // bbLogin (тимлид сознательно завёл сотрудника без BB-логина — пытаемся
      // помочь через ФИО). Если bbLogin есть и не дал резолва — это значит
      // login неправильный, fingerprint лезть не должен (R4 защита от cross-attribution).
      // Также — если у emp вообще нет ни email, ни bbLogin (incomplete identity),
      // fingerprint не пускаем чтоб не приписать чужие коммиты.
      const fingerprintAllowed = emp.email && !emp.bitbucketLogin;
      if (!bbResolved && fingerprintAllowed && emp.fio) {
        const fp = _fioFingerprint(emp.fio);
        if (fp) {
          // R4: _fpLookup возвращает null при collision'е — лучше потерять
          // атрибуцию чем приписать чужому.
          const fromRepo = _fpLookup(bbRepoLookup.byFioFp, fp);
          if (fromRepo) bbResolved = { entry: fromRepo, source: 'repo-fio' };
          else {
            const fromMerged = _fpLookup(bbLookup.byFioFp, fp);
            if (fromMerged) bbResolved = { entry: fromMerged, source: 'merged-fio' };
          }
        }
      }
    } else if (p.email) {
      bbResolved = _resolveBbAuthor('', p.email);
    }
    // Dev-only fuzzy fallback (off by default).
    if (!bbResolved && allowFuzzy) {
      const labelLower = String(p.label || '').toLowerCase().trim();
      const bb = _ppFindByPartial(bbAuthors, labelLower, Object.keys(bbAuthors));
      if (bb) bbResolved = { entry: bb, source: 'fuzzy' };
    }
    if (bbResolved) {
      const bb = bbResolved.entry;
      p.badges.commits48h = bb.commits || 0;
      p.badges.pr48h      = bb.prs     || 0;
      p.badges.prReviews48h  = bb.reviews    || 0;
      p.badges.prApproves48h = bb.approves   || 0;
      p.badges.prNeedsWork48h= bb.needsWork  || 0;
      p.badges.prDeclined48h = bb.declined   || 0;
      p.bbItems = Array.isArray(bb.items) ? bb.items.slice() : [];
      p.bbItems.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
      // V18 P8 — provenance для UI (можно показать "PR прошёл через настроенный BB"
      //   vs "PR замечен только через Jira dev-info"). Renderer пока не использует.
      p.bbSource = bbResolved.source;
    }

    // 3) Confluence — same identity-first approach.
    //    byKey = display name (Russian), bySlug = DC username / Cloud accountId,
    //    byEmail = work email. Try all three paths for confluenceAccountId so that
    //    both DC (username) and Cloud (accountId) setups work without explicit
    //    per-deployment config.
    let cf = null;
    if (emp) {
      if (emp.confluenceAccountId) {
        const cfId = String(emp.confluenceAccountId).toLowerCase().trim();
        cf = cfLookup.byKey.get(cfId) || cfLookup.bySlug.get(cfId) || null;
      }
      if (!cf && emp.email) {
        cf = cfLookup.byEmail.get(String(emp.email).toLowerCase().trim()) || null;
      }
    } else if (p.email) {
      // V21 J #65 — нормализуем как и в byEmail-builder
      cf = cfLookup.byEmail.get(String(p.email).toLowerCase().trim()) || null;
    }
    if (!cf && allowFuzzy) {
      const labelLower = String(p.label || '').toLowerCase().trim();
      cf = _ppFindByPartial(cfAuthors, labelLower, Object.keys(cfAuthors));
    }
    if (cf) {
      p.badges.conf48h = cf.edits || 0;
      p.cfItems = Array.isArray(cf.items) ? cf.items.slice() : [];
      p.cfItems.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    }

    // 4) V20 S9 — Real Zephyr attribution. Zephyr DC возвращает userKey
    //    в JIRAUSERnnn-формате — это ровно то же что Jira accountId
    //    (у Sber DC). Match deterministic по emp.jiraAccountId / p.jiraAccountId.
    //    Старая heuristic (zephyrKind по типу issue) НЕ удалена — она
    //    остаётся для legacy-флоу (test executions через Jira changelog),
    //    но на pilot data zephyrKind возвращал 0/0 потому что test cases
    //    в Sber Zephyr — отдельные сущности, не Jira issues.
    if (zephyrAuthors) {
      // V21 Z-attr fix — двусторонний normalize (см. _zephyrNormKey выше) +
      // fallback по displayName. Раньше: 7 авторов в zephyrAuthors, 0
      // attributed на пилоте 110 человек, потому что emp.jiraAccountId
      // в registry хранился без префикса JIRAUSER, а сервер нормализовал.
      const rawZKey = String(emp?.jiraAccountId || p.jiraAccountId || '').trim();
      const normZKey = _zephyrNormKey(rawZKey);
      let zEntry = null;
      if (rawZKey) {
        zEntry = zephyrAuthors[rawZKey]
              || zephyrAuthors[rawZKey.toUpperCase()]
              || zephyrAuthors[rawZKey.toLowerCase()]
              || (normZKey ? zephyrAuthors[normZKey] : null);
      }
      // Fallback by displayName — authoritative match когда format jiraAccountId
      // расходится между registry и Zephyr (например registry хранит email
      // как accountId, а Zephyr возвращает JIRAUSER-форму).
      if (!zEntry) {
        const dnCandidates = [
          String(emp?.fio || '').toLowerCase().trim(),
          String(emp?.displayName || '').toLowerCase().trim(),
          String(p.label || '').toLowerCase().trim(),
        ].filter(Boolean);
        for (const dn of dnCandidates) {
          if (_zephyrByDisplayName[dn]) {
            zEntry = _zephyrByDisplayName[dn].entry;
            break;
          }
        }
      }
      if (zEntry) {
        p.badges.testsCreated48h  = zEntry.testsCreated || 0;
        p.badges.testsExecuted48h = (p.badges.testsExecuted48h || 0) + (zEntry.testsExecuted || 0);
        // Конвертим Zephyr-items → формат zephyrTestsCreatedRecent / Executed
        // (renderer ожидает { slim, kind, at } / { slim, result, at }).
        let pushedCreated = 0, pushedExecuted = 0;
        for (const it of (zEntry.items || [])) {
          const slimItem = { key: it.key, type: it.kind === 'test-run' ? 'TestExecution' : 'Test', summary: it.name || '' };
          if (it.kind === 'test-run') {
            const result = it.status === 'Done' ? 'PASS' : 'EXECUTED';
            p.zephyrTestsExecutedRecent.push({ slim: slimItem, result, at: it.at, source: 'zephyr-api' });
            pushedExecuted++;
          } else {
            p.zephyrTestsCreatedRecent.push({ slim: slimItem, kind: 'test', at: it.at, source: 'zephyr-api' });
            pushedCreated++;
          }
        }
        // D2 fix (2026-05-11) — counter/items mismatch fallback. Когда
        // server.items.length < server.testsCreated (item-cap=50, или server
        // отдал counter но not items в каком-то edge case) — synthesize
        // placeholder items для того, чтобы diagnostic
        // (`sources.zephyr.testsCreated` = sum of `p.zephyrTestsCreatedRecent
        // .length`) всё-таки отражал badges. Это нужно для Z-chip отчётности
        // в employee card'ах и для overall coverage telemetry.
        const declaredCreated  = Number(zEntry.testsCreated)  || 0;
        const declaredExecuted = Number(zEntry.testsExecuted) || 0;
        for (let i = pushedCreated; i < declaredCreated; i++) {
          p.zephyrTestsCreatedRecent.push({
            slim: { key: '', type: 'Test', summary: '' },
            kind: 'test', at: '', source: 'zephyr-api-counter',
          });
        }
        for (let i = pushedExecuted; i < declaredExecuted; i++) {
          p.zephyrTestsExecutedRecent.push({
            slim: { key: '', type: 'TestExecution', summary: '' },
            result: 'EXECUTED', at: '', source: 'zephyr-api-counter',
          });
        }
      }
    }
  }
  // Aggregate totals on summary.
  // QD5: разделяем на resolved (атрибуцированные сотрудникам) и raw (всё что
  // вернул сервер). Раньше total суммировался по всему bbAuthors включая
  // unresolved authors → UI показывал «команда сделала 50 коммитов», но
  // по людям выходило 32. Теперь хранятся обе цифры — resolved для team-total,
  // raw для diagnostic'а / explainer'а.
  let _bbRawCommits = 0, _bbRawPrs = 0, _cfRawEdits = 0;
  let _bbResolvedCommits = 0, _bbResolvedPrs = 0, _cfResolvedEdits = 0;
  for (const a of Object.values(bbAuthors)) {
    _bbRawCommits += (a.commits || 0);
    _bbRawPrs     += (a.prs     || 0);
  }
  for (const a of Object.values(cfAuthors)) _cfRawEdits += (a.edits || 0);
  for (const p of userMap.values()) {
    _bbResolvedCommits += (p.badges?.commits48h || 0);
    _bbResolvedPrs     += (p.badges?.pr48h      || 0);
    _cfResolvedEdits   += (p.badges?.conf48h    || 0);
  }
  out.summary.commits48h = _bbResolvedCommits;
  out.summary.pr48h      = _bbResolvedPrs;
  out.summary.conf48h    = _cfResolvedEdits;
  // Diagnostic: raw totals + delta = unresolved.
  out.summary._raw = {
    commits48hRaw: _bbRawCommits,
    pr48hRaw:      _bbRawPrs,
    conf48hRaw:    _cfRawEdits,
    commits48hUnresolved: Math.max(0, _bbRawCommits - _bbResolvedCommits),
    pr48hUnresolved:      Math.max(0, _bbRawPrs     - _bbResolvedPrs),
    conf48hUnresolved:    Math.max(0, _cfRawEdits   - _cfResolvedEdits),
  };

  // Convert sets to arrays + sort participants
  for (const p of userMap.values()) {
    p.projects = Array.from(p.projects);
    // Newest-first within each day window — keeps the timeline UI consistent.
    p.timelineToday    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    p.timelineYesterday.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    p.timelinePrev     .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    // V21 AT — Rework ratio: reopened issues / total assigned issues.
    // Только осмысленно если у юзера ≥3 issues (иначе шум).
    const totalAssigned = (p.issuesNow || []).length + (p.doneYesterday || []).length
                        + (p.doneToday || []).length + (p.doneDayBefore || []).length
                        + (p.stale || []).length;
    p.reworkRatio = totalAssigned >= 3 ? +((p.reworkCount || 0) / totalAssigned).toFixed(3) : null;
    p.reworkTotalAssigned = totalAssigned;
    // PR-CH — пометка [X]-уволенных. Consumers (chat / Black Dashboard / etc)
    // могут отфильтровать по этому флагу.
    p.deactivated = Utils.isDeactivatedAccount(p);
    out.participants.push(p);
  }
  out.participants.sort((a, b) =>
    (b.issuesNow.length + b.doneYesterday.length + b.commentsRecent.length) -
    (a.issuesNow.length + a.doneYesterday.length + a.commentsRecent.length));

  // Sort unassigned per pk by oldest update
  for (const pk of Object.keys(out.unassignedByPk)) {
    out.unassignedByPk[pk].sort((a, b) => ts(a.updated) - ts(b.updated));
  }

  // Active sprint summary
  out.summary.activeSprints = Object.entries(out.spaces)
    .map(([pk, s]) => ({ pk, name: s.activeSprintName }))
    .filter(s => s.name);

  // Yesterday activity sorted desc
  out.yesterdayActivity.sort((a, b) => ts(b.at) - ts(a.at));

  // V21 Z7 (audit-09 §H Person-level #49, #50, #54, #56, #57, #58) —
  // вычисляем 6 person-level метрик из уже собранных данных.
  // Записываем в p.metrics на каждый participant.
  _computePersonLevelMetrics(out);

  // V21 Z8 (audit-09 §H Sprint-level #62, #64, #65, #68) — sprint-aggregates.
  _computeSprintLevelMetrics(out);

  // V21 Z9 (audit-09 §H Team-level + DORA proxy) — team-aggregates.
  _computeTeamLevelMetrics(out);

  // V21 Z10 (audit-09 §H Cross-team) — cross-team aggregates.
  _computeCrossTeamMetrics(out);

  // V21 Z11 (audit-09 §H Org-level) — org-aggregates.
  _computeOrgLevelMetrics(out);

  // V21 Z12 (audit-09 §I new-views) — onboarding tracker + release cockpit summaries.
  _computeNewDashboardData(out);

  // V21 AH (audit-09 §H Cross-team #41) — Knowledge import/export.
  // Proxy: для каждого CF author считаем distribution edits по spaces.
  // Если top-1 space < 70% от total — author активен в нескольких spaces
  // (knowledge spreader). Если >90% — siloed.
  const cfAuthorsForFlow = out.confluence?.authors || {};
  const knowledgeFlow = [];
  for (const [k, a] of Object.entries(cfAuthorsForFlow)) {
    const items = a.items || [];
    if (items.length < 3) continue;
    const bySpace = {};
    for (const it of items) {
      const sp = it.spaceKey || it.space || '?';
      bySpace[sp] = (bySpace[sp] || 0) + 1;
    }
    const total = items.length;
    const sortedSpaces = Object.entries(bySpace).sort((x, y) => y[1] - x[1]);
    const topPct = sortedSpaces[0] ? sortedSpaces[0][1] / total : 1;
    knowledgeFlow.push({
      name:   a.displayName || k,
      spaces: sortedSpaces.length,
      top1:   sortedSpaces[0]?.[0] || '',
      top1Pct: +topPct.toFixed(2),
      role:   topPct > 0.9 ? 'siloed' : topPct > 0.7 ? 'focused' : 'spreader',
    });
  }
  out.summary.knowledgeFlow = {
    spreaders: knowledgeFlow.filter(p => p.role === 'spreader').sort((a, b) => b.spaces - a.spaces).slice(0, 8),
    siloed:    knowledgeFlow.filter(p => p.role === 'siloed').slice(0, 8),
    total:     knowledgeFlow.length,
  };

  // V21 BC (audit-09 §H Sprint #18) — Code churn per sprint.
  // Aggregate commitChurn (с хост-side из ppFetchHotFiles) по sprint windows
  // (start/complete dates из bigMetrics.sprintCommit.byPk).
  const churnEvents = out.bigMetrics?.hotFiles?.commitChurn || [];
  if (churnEvents.length) {
    const codeChurnPerSprint = [];
    const sc = out.bigMetrics?.sprintCommit?.byPk || {};
    for (const [pk, v] of Object.entries(sc)) {
      for (const sp of (v.sprints || [])) {
        const startTs = Date.parse(sp.startDate || '');
        const endTs   = Date.parse(sp.completeDate || sp.endDate || '');
        if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) continue;
        const inWindow = churnEvents.filter(ev => ev.at >= startTs && ev.at <= endTs);
        if (!inWindow.length) continue;
        const additions = inWindow.reduce((s, c) => s + c.additions, 0);
        const deletions = inWindow.reduce((s, c) => s + c.deletions, 0);
        codeChurnPerSprint.push({
          pk,
          sprint:    sp.name,
          additions, deletions,
          churn:     additions + deletions,
          commits:   inWindow.length,
        });
      }
    }
    out.summary.codeChurnPerSprint = codeChurnPerSprint.sort((a, b) => b.churn - a.churn).slice(0, 30);
  }

  // V21 AY (audit-09 §H Person #14) — Bug-induce rate proxy.
  // Per-author: bugs assigned to them / their commits in last 30 days.
  // Caveat: assignee != original author of bug-inducing commit; это proxy
  // через текущего владельца bug'а. Полная blame-correlation требует
  // commit-blame на bug'у — не делаем.
  for (const p of out.participants || []) {
    const bugCount = [...(p.issuesNow || []), ...(p.stale || [])]
      .filter(it => /bug|defect|дефект/i.test(it.type || '')).length;
    const commits = (p.bbItems || []).filter(it => it.kind === 'commit').length;
    p.bugInduceRate = (commits >= 5) ? +(bugCount / commits).toFixed(3) : null;
    p.bugInduceCounts = { bugs: bugCount, commits };
  }

  // V21 AW (audit-09 §E #4) — Untested closed issues.
  // Из coverageByJira (Zephyr traceability) + closed issues в spaces.
  const coverageMap = out.zephyr?.extra?.coverageByJira || {};
  const untestedClosed = [];
  let coveredClosed = 0, totalClosed = 0;
  for (const space of Object.values(out.spaces || {})) {
    for (const issue of (space.issues || [])) {
      const f = issue.fields || {};
      const statusCat = f.status?.statusCategory?.key || '';
      if (statusCat !== 'done') continue;
      totalClosed++;
      const k = issue.key;
      if (coverageMap[k] && coverageMap[k].length) {
        coveredClosed++;
      } else {
        untestedClosed.push({
          key: k,
          summary: (f.summary || '').slice(0, 80),
          resolutionDate: f.resolutiondate || '',
        });
      }
    }
  }
  out.summary.coverageReport = {
    totalClosed,
    coveredClosed,
    coverageRatio: totalClosed > 0 ? +(coveredClosed / totalClosed).toFixed(3) : 0,
    untestedClosed: untestedClosed
      .sort((a, b) => String(b.resolutionDate).localeCompare(String(a.resolutionDate)))
      .slice(0, 30),
    untestedTotal: untestedClosed.length,
  };

  // V21 AU (audit-09 §H Sprint #23) — Doc coverage.
  // Match fixVersions из summary с CF pages по keyword scan в title.
  // Coverage = % версий упомянутых хоть в одной странице.
  const fvNames = Object.keys(out.summary.fixVersionCoverage || {});
  if (fvNames.length) {
    const cfTitles = new Set();
    for (const a of Object.values(out.confluence?.authors || {})) {
      for (const it of (a.items || [])) {
        if (it.title) cfTitles.add(String(it.title).toLowerCase());
      }
    }
    const titlesArr = [...cfTitles];
    const docCoverage = { perVersion: [], totalVersions: fvNames.length, coveredVersions: 0 };
    for (const ver of fvNames) {
      const verLow = ver.toLowerCase();
      // Match: либо title содержит version name, либо version name это substring
      // достаточно distinctive (>=3 символов).
      const matches = titlesArr.filter(t => verLow.length >= 3 && t.includes(verLow));
      docCoverage.perVersion.push({
        version: ver,
        cfPagesCount: matches.length,
        covered: matches.length > 0,
        sampleTitles: matches.slice(0, 3),
      });
      if (matches.length > 0) docCoverage.coveredVersions++;
    }
    docCoverage.coverageRatio = fvNames.length > 0 ? +(docCoverage.coveredVersions / fvNames.length).toFixed(3) : 0;
    out.summary.docCoverage = docCoverage;
  }

  // V21 AB (audit-09 §D #16) — CF page ownership: top authors by edits.
  if (out.bigMetrics?.cfHealth?.ownership) {
    const cfAuthors = out.confluence?.authors || {};
    out.bigMetrics.cfHealth.ownership = Object.entries(cfAuthors)
      .map(([k, a]) => ({ name: a.displayName || k, edits: a.edits || 0, comments: a.comments || 0 }))
      .filter(a => a.edits + a.comments > 0)
      .sort((a, b) => (b.edits + b.comments) - (a.edits + a.comments))
      .slice(0, 10);
  }

  return out;
}

/* V21 Z12 — Data prep for 3 new dashboards (#100, #103, #98).
   #100 onboardingTracker — для каждого employee: первое появление в данных
        (commit/PR/issue). Если < 90д — новенький, статус ramp.
   #103 releaseCockpit — flatten bigMetrics.sprintCommit.byPk в timeline events.
   #98  dependencyTextGraph — top-20 cross-pk links из issueLinkGraph (text).
*/
function _computeNewDashboardData(out) {
  const dash = (out.summary.newDashboards ||= {});

  // #100 Onboarding tracker — теперь использует PR-AS точные данные (BB
  // historical scan), если они есть. Fallback на 72ч-окно proxy если PR-AS
  // disabled или Bitbucket не настроен.
  const RAMP_WINDOW_DAYS = 90;
  const cutoff = Date.now() - RAMP_WINDOW_DAYS * 24 * 3600 * 1000;
  const tracker = [];
  const precisePerAuthor = out.bigMetrics?.onboarding?.perAuthor || {};
  const hasPrecise = Object.keys(precisePerAuthor).length > 0;

  for (const p of (out.participants || [])) {
    const totalEvents = (p.timelineToday || []).length + (p.timelineYesterday || []).length + (p.timelinePrev || []).length + (p.bbItems || []).length;
    let firstSeenTs = Infinity;
    let preciseHit  = false;
    // Try precise first.
    if (hasPrecise) {
      const candidates = [p.label, p.email, p.fio].filter(Boolean);
      for (const c of candidates) {
        if (precisePerAuthor[c] && precisePerAuthor[c] < firstSeenTs) {
          firstSeenTs = precisePerAuthor[c];
          preciseHit = true;
        }
      }
    }
    // Fallback на 72ч-window timeline.
    if (!preciseHit) {
      for (const it of [...(p.timelineToday || []), ...(p.timelineYesterday || []), ...(p.timelinePrev || []), ...(p.bbItems || [])]) {
        const t = Date.parse(it.at || '');
        if (Number.isFinite(t) && t < firstSeenTs) firstSeenTs = t;
      }
    }
    if (!Number.isFinite(firstSeenTs)) continue;
    if (firstSeenTs > cutoff) {
      const daysActive = Math.floor((Date.now() - firstSeenTs) / 86400000);
      tracker.push({
        name:       p.label || p.email,
        firstSeen:  new Date(firstSeenTs).toISOString().slice(0, 10),
        daysActive,
        totalEvents,
        rampStatus: totalEvents >= 20 ? 'ramped' : totalEvents >= 5 ? 'progressing' : 'starting',
        precise:    preciseHit, // V21 AS — отметка что это точные данные а не proxy
      });
    }
  }
  dash.onboardingTracker = tracker.sort((a, b) => a.daysActive - b.daysActive);

  // #103 Release cockpit — flatten sprint-commit per pk.
  const cockpit = [];
  const sc = out.bigMetrics?.sprintCommit?.byPk || {};
  for (const [pk, v] of Object.entries(sc)) {
    for (const sp of (v.sprints || [])) {
      cockpit.push({
        pk,
        sprintName:   sp.name,
        committed:    sp.committed,
        delivered:    sp.delivered,
        ratio:        sp.ratio,
        completeDate: sp.completeDate,
      });
    }
  }
  dash.releaseCockpit = cockpit.sort((a, b) => String(b.completeDate).localeCompare(String(a.completeDate)));

  // #98 Dependency text-graph — top cross-pk links.
  const ilg = out.summary.issueLinkGraph || {};
  const crossLinks = [];
  for (const [fromKey, links] of Object.entries(ilg)) {
    const fromPk = (fromKey.match(/^([A-Z][A-Z0-9_]*)-/) || [])[1] || '';
    for (const l of links) {
      const toPk = (l.toKey.match(/^([A-Z][A-Z0-9_]*)-/) || [])[1] || '';
      if (fromPk && toPk && fromPk !== toPk) {
        crossLinks.push({ fromKey, toKey: l.toKey, fromPk, toPk, kind: l.kind });
      }
    }
  }
  // Aggregate flow по парам PK.
  const flowByPair = {};
  for (const cl of crossLinks) {
    const pair = `${cl.fromPk} → ${cl.toPk}`;
    flowByPair[pair] = (flowByPair[pair] || 0) + 1;
  }
  dash.dependencyFlow = Object.entries(flowByPair)
    .map(([pair, count]) => ({ pair, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

/* V21 Z11 — Org-level metrics (3 of 6).
   #90 throughputPerFte — done issues / participants count
   #92 innovationRatio  — feature/maintenance/tech-debt mix (proxy by issuetype)
   #94 knowledgeCentralization — Herfindahl index for CF authorship.

   #91, #93, #95 требуют external data (prod incidents, HR, deploy events) —
   carry-over.
*/
function _computeOrgLevelMetrics(out) {
  const om = (out.summary.orgMetrics ||= {});
  const teamSize = (out.participants || []).length;

  // #90 Throughput per FTE.
  om.throughputPerFte = {
    done:    out.summary.done || 0,
    fte:     teamSize,
    perFte:  teamSize > 0 ? +((out.summary.done || 0) / teamSize).toFixed(2) : 0,
  };

  // #92 Innovation ratio (proxy by issuetype).
  // feature: type === 'Story' / 'New Feature' / 'Epic'
  // maintenance: 'Bug' / 'Sub-task' (defects + small fixes)
  // tech-debt: labels include 'tech-debt' OR type === 'Task' AND specific keywords
  let feature = 0, maintenance = 0, techDebt = 0, other = 0;
  for (const space of Object.values(out.spaces || {})) {
    for (const issue of (space.issues || [])) {
      const f = issue.fields || {};
      const type = String(f.issuetype?.name || '').toLowerCase();
      const labels = (Array.isArray(f.labels) ? f.labels : []).map(l => String(l).toLowerCase());
      const isTechDebt = labels.some(l => /tech.?debt|refactor/.test(l));
      if (isTechDebt)                                            techDebt++;
      else if (/bug|defect/.test(type))                          maintenance++;
      else if (/story|feature|epic/.test(type))                  feature++;
      else                                                       other++;
    }
  }
  const totalClassified = feature + maintenance + techDebt + other;
  om.innovationRatio = totalClassified > 0 ? {
    feature, maintenance, techDebt, other,
    featurePct:     +(feature     / totalClassified * 100).toFixed(1),
    maintenancePct: +(maintenance / totalClassified * 100).toFixed(1),
    techDebtPct:    +(techDebt    / totalClassified * 100).toFixed(1),
    otherPct:       +(other       / totalClassified * 100).toFixed(1),
  } : null;

  // #94 Knowledge centralization — Herfindahl index by CF authorship.
  // Если 1 человек пишет все страницы — Herfindahl=1 (max concentration).
  // Если N людей равномерно — Herfindahl=1/N (min). Range 0..1.
  const cfAuthors = out.confluence?.authors || {};
  const cfTotals  = Object.values(cfAuthors)
    .map(a => (a.edits || 0) + (a.comments || 0))
    .filter(n => n > 0);
  let herfindahl = 0;
  if (cfTotals.length) {
    const sum = cfTotals.reduce((s, n) => s + n, 0);
    if (sum > 0) {
      herfindahl = cfTotals.reduce((s, n) => s + (n / sum) ** 2, 0);
    }
  }
  om.knowledgeCentralization = {
    herfindahl: +herfindahl.toFixed(3),
    contributors: cfTotals.length,
    interpretation: herfindahl > 0.5 ? 'concentrated' : herfindahl > 0.2 ? 'mixed' : 'distributed',
  };
}

/* V21 Z10 — Cross-team metrics.
   #84 dependencyDensity — % issues with cross-pk links / total
   #85 blockedByOtherTeamH — суммарные dwellHours блокеров cross-team
   #86 sharedComponents — components shared между >1 team
   #87 reviewSlaCrossTeam — first-review-latency для cross-team PR (proxy:
                            используем общий prMetrics.firstReviewMs)
*/
function _computeCrossTeamMetrics(out) {
  const ct = (out.summary.crossTeamMetrics ||= {});
  // #84 Dependency graph density.
  const issueLinkGraph = out.summary.issueLinkGraph || {};
  let totalIssuesWithLinks = 0;
  let crossPkLinks = 0;
  for (const [fromKey, links] of Object.entries(issueLinkGraph)) {
    if (!links.length) continue;
    totalIssuesWithLinks++;
    const fromPk = (fromKey.match(/^([A-Z][A-Z0-9_]*)-/) || [])[1] || '';
    for (const l of links) {
      const toPk = (l.toKey.match(/^([A-Z][A-Z0-9_]*)-/) || [])[1] || '';
      if (fromPk && toPk && fromPk !== toPk) crossPkLinks++;
    }
  }
  const totalIssues = out.summary.totalIssues || 1;
  ct.dependencyDensity = {
    crossPkLinks,
    totalIssuesWithLinks,
    densityPct: totalIssues > 0 ? +(totalIssuesWithLinks / totalIssues * 100).toFixed(1) : 0,
  };

  // #85 Blocked-by-other-team time — sum of blocker dwellHours where blocker задача в другом pk.
  let crossTeamBlockerSum = 0, crossTeamBlockerN = 0;
  for (const p of (out.participants || [])) {
    for (const b of (p.blockers || [])) {
      const blockerPk = (b.blockerKey?.match(/^([A-Z][A-Z0-9_]*)-/) || [])[1] || '';
      const issuePk  = (b.issueKey?.match(/^([A-Z][A-Z0-9_]*)-/) || [])[1] || '';
      if (blockerPk && issuePk && blockerPk !== issuePk) {
        crossTeamBlockerSum += Number(b.dwellHours) || 0;
        crossTeamBlockerN++;
      }
    }
  }
  ct.blockedByOtherTeam = {
    totalHours: +crossTeamBlockerSum.toFixed(1),
    count:      crossTeamBlockerN,
    avgHours:   crossTeamBlockerN > 0 ? +(crossTeamBlockerSum / crossTeamBlockerN).toFixed(1) : 0,
  };

  // #86 Shared components — comp.issueCount по componentOwnerLoad. Если у компонента
  // open issues из >1 PK — shared.
  // Текущая структура componentOwnerLoad не хранит pk. Proxy: top components by issueCount.
  const cl = out.summary.componentOwnerLoad || {};
  ct.sharedComponentsTop = Object.entries(cl)
    .map(([name, v]) => ({ name, ...v }))
    .filter(c => c.issueCount >= 5)
    .sort((a, b) => b.issueCount - a.issueCount)
    .slice(0, 10);

  // #87 Review SLA cross-team — proxy: используем общий firstReviewMs.
  ct.reviewSlaProxy = out.bitbucket?.prMetrics?.firstReviewMs || { p50: 0, p90: 0, n: 0 };
}

/* V21 Z9 — Team-level metrics + DORA proxies.
   Без CI/CD integration DORA = best-effort proxy:
   #71 deployFreq      — # MERGED PR за окно (proxy)
   #72 leadTimeForChanges — bb.prMetrics.cycleTimeMs (уже посчитано)
   #73 mttr            — sprintMetrics.blockerTime.avgHours (proxy)
   #74 changeFailRate  — reverts в commit messages / total commits (proxy)
   #75 wipLimitCompliance — open issues / WIP threshold (default 5×team)
   #76 throughput      — closed issues за окно
   #77 predictability  — std/mean velocity (если есть bigMetrics.sprintCommit)
   #78 hotFileConcentration — % коммитов в top-5 файлов (из hotFiles)
   #79 truckFactor     — bigMetrics.hotFiles.busFactor.length
   #81 backlogHealth   — % issues с priority+description
*/
function _computeTeamLevelMetrics(out) {
  const tm = (out.summary.teamMetrics ||= {});
  const bbAuthors = out.bitbucket?.authors || {};
  const cutoff7d  = Date.now() - 7 * 24 * 3600 * 1000;
  // Walk через все BB items для подсчёта merged PRs + revert-коммитов.
  let mergedPrs = 0, totalCommits = 0, revertCommits = 0;
  const bbItems = [];
  for (const a of Object.values(bbAuthors)) {
    for (const it of (a.items || [])) bbItems.push(it);
  }
  for (const it of bbItems) {
    const t = Date.parse(it.at || '');
    if (!Number.isFinite(t) || t < cutoff7d) continue;
    if (it.kind === 'pr' && it.status === 'merged') mergedPrs++;
    if (it.kind === 'commit') {
      totalCommits++;
      if (/\brevert\b|hotfix/i.test(it.title || '')) revertCommits++;
    }
  }
  tm.dora = {
    deployFreqPer7d: mergedPrs,
    leadTimeMs:      out.bitbucket?.prMetrics?.cycleTimeMs || { p50: 0, p90: 0, n: 0 },
    mttrHours:       out.summary.sprintMetrics?.blockerTime?.avgHours || 0,
    changeFailRate:  totalCommits > 0 ? +(revertCommits / totalCommits).toFixed(3) : 0,
  };

  // #75 WIP limit compliance — proxy: WIP issues / 5×team_size.
  const teamSize = (out.participants || []).length;
  const wipLimit = Math.max(5, teamSize * 5);
  const wipNow   = out.summary.wip || 0;
  tm.wipCompliance = {
    wip:  wipNow,
    limit: wipLimit,
    overWip: wipNow > wipLimit,
    ratio: wipLimit > 0 ? +(wipNow / wipLimit).toFixed(2) : 0,
  };

  // #76 throughput — closed issues за окно. Используем done counts.
  tm.throughput = {
    donePer7d: out.summary.done || 0,
    teamSize,
    perPerson: teamSize > 0 ? +((out.summary.done || 0) / teamSize).toFixed(1) : 0,
  };

  // #77 predictability — std/mean velocity if sprint-commit data есть.
  const sc = out.bigMetrics?.sprintCommit?.byPk || {};
  const allRatios = [];
  for (const v of Object.values(sc)) {
    for (const sp of (v.sprints || [])) allRatios.push(sp.ratio);
  }
  if (allRatios.length >= 3) {
    const mean = allRatios.reduce((s, n) => s + n, 0) / allRatios.length;
    const variance = allRatios.reduce((s, n) => s + (n - mean) ** 2, 0) / allRatios.length;
    const std = Math.sqrt(variance);
    tm.predictability = { mean: +mean.toFixed(3), std: +std.toFixed(3), cov: mean > 0 ? +(std / mean).toFixed(3) : 0, n: allRatios.length };
  } else {
    tm.predictability = { mean: 0, std: 0, cov: 0, n: allRatios.length };
  }

  // #78 hot-file concentration — % top-5 files из всех hot files.
  const hotFiles = out.bigMetrics?.hotFiles?.hotFiles || [];
  if (hotFiles.length >= 5) {
    const totalChanges = hotFiles.reduce((s, f) => s + f.changes, 0);
    const top5Changes  = hotFiles.slice(0, 5).reduce((s, f) => s + f.changes, 0);
    tm.hotFileConcentration = {
      top5Pct: totalChanges > 0 ? +(top5Changes / totalChanges).toFixed(3) : 0,
      total: totalChanges,
    };
  } else {
    tm.hotFileConcentration = { top5Pct: 0, total: 0 };
  }

  // #79 truck-factor — кол-во файлов с bus-factor=1.
  tm.truckFactor = (out.bigMetrics?.hotFiles?.busFactor || []).length;

  // #81 backlog health — AUDIT_SCANNER #23: расширили с priority+description
  // до multi-criteria score (priority/description/epic/component/estimate +
  // dueDate для bug). Backward-compat: tm.backlogHealth.{healthy,total,ratio}
  // сохранены, добавлены `score` (0-100) и `breakdown`.
  let healthyN = 0, totalChecked = 0;
  let scoreSum = 0;
  const breakdownTotals = {
    hasPriority: 0, hasDescription: 0, hasEpic: 0,
    hasComponent: 0, hasEstimate: 0, hasDueDate: 0,
  };
  let dueDateApplicable = 0; // только для bug
  for (const space of Object.values(out.spaces || {})) {
    for (const issue of (space.backlogIssues || [])) {
      totalChecked++;
      const f = issue.fields || issue;
      const isBug = ((f.issuetype?.name || f.issueType || '') + '').toLowerCase().includes('bug');
      const checks = {
        hasPriority:    !!f.priority?.name || !!issue.priority,
        hasDescription: ((f.description || issue.description || '') + '').length > 30,
        hasEpic:        !!issue.epicLink || !!f.epicLink || !!issue.parent || !!f.parent,
        hasComponent:   Array.isArray(f.components || issue.components) && (f.components || issue.components).length > 0,
        hasEstimate:    !!(f.timeoriginalestimate || f.timeOriginalEstimate || issue.timeOriginalEstimate || issue.storyPoints),
      };
      if (isBug) {
        checks.hasDueDate = !!(f.duedate || issue.duedate);
        dueDateApplicable++;
      }
      for (const [k, v] of Object.entries(checks)) {
        if (v) breakdownTotals[k] = (breakdownTotals[k] || 0) + 1;
      }
      const passed = Object.values(checks).filter(Boolean).length;
      const totalKeys = Object.keys(checks).length;
      const issueScore = totalKeys > 0 ? (passed / totalKeys) * 100 : 0;
      scoreSum += issueScore;
      // Legacy: «healthy» = priority + description (старый критерий).
      if (checks.hasPriority && checks.hasDescription) healthyN++;
    }
  }
  tm.backlogHealth = {
    // backward-compat shape
    healthy: healthyN,
    total:   totalChecked,
    ratio:   totalChecked > 0 ? +(healthyN / totalChecked).toFixed(3) : 0,
    // AUDIT_SCANNER #23 — fractional multi-criteria score (0-100)
    score:        totalChecked > 0 ? +(scoreSum / totalChecked).toFixed(1) : 0,
    breakdown:    breakdownTotals,
    bugTotal:     dueDateApplicable,
  };
}

/* V21 Z8 — Sprint-level metrics (~5 из 12).
   #62 leadTimeMs       — медиан/p90 от createdAt до transition в Done
   #64 bugToStoryRatio  — bugs / non-bug issues
   #65 reviewWipNow     — кол-во open PR (state=OPEN из bb.items)
   #68 blockerTimeMs    — суммарное время в blocked-status за окно.
   Также exposes scope churn approx (per spec). */
function _computeSprintLevelMetrics(out) {
  const sprintM = (out.summary.sprintMetrics ||= {});
  // #64 bug-to-story ratio.
  const bugs = out.summary.bugs || 0;
  const total = out.summary.totalIssues || 0;
  const stories = Math.max(0, total - bugs);
  sprintM.bugToStoryRatio = stories > 0 ? +(bugs / stories).toFixed(3) : null;

  // #62 leadTimeMs — для issues с резолюцией в окне.
  // Подходим аккуратно: используем все participants' yesterdayActivity / done events.
  const leadTimes = [];
  for (const space of Object.values(out.spaces || {})) {
    for (const issue of (space.issues || [])) {
      const f = issue.fields || {};
      if (!f.resolutiondate || !f.created) continue;
      const start = Date.parse(f.created);
      const end   = Date.parse(f.resolutiondate);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        leadTimes.push(end - start);
      }
    }
  }
  if (leadTimes.length) {
    leadTimes.sort((a, b) => a - b);
    sprintM.leadTimeMs = {
      p50: leadTimes[Math.floor(leadTimes.length * 0.5)],
      p90: leadTimes[Math.min(leadTimes.length - 1, Math.floor(leadTimes.length * 0.9))],
      n:   leadTimes.length,
    };
  } else {
    sprintM.leadTimeMs = { p50: 0, p90: 0, n: 0 };
  }

  // #65 reviewWipNow — open PR count из bb.items.
  let openPrs = 0;
  for (const p of (out.participants || [])) {
    for (const it of (p.bbItems || [])) {
      if (it.kind === 'pr' && (it.status === 'open')) openPrs++;
    }
  }
  sprintM.reviewWipNow = openPrs;

  // #68 blockerTimeMs — сумма dwellHours блокеров (proxy для blocked-time agg).
  let blockerSum = 0, blockerN = 0;
  for (const p of (out.participants || [])) {
    for (const b of (p.blockers || [])) {
      const dh = Number(b?.dwellHours) || 0;
      if (dh > 0) { blockerSum += dh; blockerN++; }
    }
  }
  sprintM.blockerTime = {
    totalHours: +blockerSum.toFixed(1),
    avgHours:   blockerN ? +(blockerSum / blockerN).toFixed(1) : 0,
    n:          blockerN,
  };
}

/* V21 Z7 — Person-level metrics aggregator. Все 6 метрик computable из
   данных, которые уже едут в model:
   #49 knowledgeBreadth — # уникальных компонентов где автор коммитил
   #50 specialistGini    — концентрация активности по компонентам (Gini)
   #54 contextSwitchIdx  — # уникальных проектов / задач за окно
   #56 testOwnership     — кол-во test-cases человек создал/обновил (zephyr.authors)
   #57 personalPrCycle   — медианное время cycle для PR где он автор (BB items)
   #58 afterHoursRatio   — % коммитов между 21:00-09:00 либо в выходные */
function _computePersonLevelMetrics(out) {
  if (!Array.isArray(out.participants)) return;
  const zephyrAuthors = out.zephyr?.authors || {};
  const bbAuthors     = out.bitbucket?.repoAuthors || out.bitbucket?.authors || {};
  // Helper: Gini coefficient.
  const gini = (values) => {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const n = sorted.length;
    let sum = 0, cum = 0, total = 0;
    for (let i = 0; i < n; i++) { total += sorted[i]; }
    if (!total) return 0;
    for (let i = 0; i < n; i++) {
      cum += sorted[i];
      sum += (cum / total);
    }
    return Math.max(0, Math.min(1, ((n + 1 - 2 * sum) / n)));
  };

  for (const p of out.participants) {
    const m = p.metrics = p.metrics || {};

    // #49 knowledgeBreadth — кол-во проектов где есть активность.
    m.knowledgeBreadth = (p.projects || []).length;

    // #50 specialistGini — Gini по распределению issues across projects.
    const projCounts = {};
    for (const it of (p.issuesNow || [])) projCounts[it.pk] = (projCounts[it.pk] || 0) + 1;
    for (const it of (p.stale || []))     projCounts[it.pk] = (projCounts[it.pk] || 0) + 1;
    m.specialistGini = +gini(Object.values(projCounts)).toFixed(3);

    // #54 contextSwitchIdx — proxy: уникальных issuetype × projects.
    const types = new Set();
    for (const it of (p.issuesNow || [])) if (it.type) types.add(it.type);
    m.contextSwitchIdx = m.knowledgeBreadth * Math.max(1, types.size);

    // #56 testOwnership — match by displayName в zephyr authors.
    const zKey = Object.keys(zephyrAuthors).find(k => {
      const z = zephyrAuthors[k];
      return (z?.displayName && p.label && String(z.displayName).toLowerCase() === String(p.label).toLowerCase());
    });
    m.testOwnership = zKey ? {
      created:  zephyrAuthors[zKey].testsCreated || 0,
      executed: zephyrAuthors[zKey].testsExecuted || 0,
    } : { created: 0, executed: 0 };

    // #57 personalPrCycleMs — median cycle-time по PR где человек автор.
    const prItems = (p.bbItems || []).filter(i => i.kind === 'pr' && i.at);
    if (prItems.length) {
      // Простая аппроксимация: для merged PR — created/updated as proxy. Без full
      // lifecycle per author мы не имеем точных данных, но это индикативно.
      const ages = prItems.map(i => {
        const at = Date.parse(i.at);
        return Number.isFinite(at) ? Date.now() - at : 0;
      }).filter(n => n > 0).sort((a, b) => a - b);
      m.personalPrCycleMs = ages.length ? ages[Math.floor(ages.length / 2)] : 0;
    } else {
      m.personalPrCycleMs = 0;
    }

    // #58 afterHoursRatio — % timestamps в нерабочие часы (21:00-09:00 или сб/вс).
    const allActivity = [
      ...(p.timelineToday    || []),
      ...(p.timelineYesterday || []),
      ...(p.timelinePrev     || []),
      ...(p.bbItems          || []),
    ];
    let total = 0, afterHours = 0;
    for (const a of allActivity) {
      const t = Date.parse(a.at || '');
      if (!Number.isFinite(t)) continue;
      total++;
      const d = new Date(t);
      const day  = d.getUTCDay();          // 0=Sun, 6=Sat
      const hour = d.getUTCHours();
      const isWeekend  = day === 0 || day === 6;
      const isOffHours = hour < 6 || hour >= 18;  // приблизительно UTC ≈ MSK-3, грубо
      if (isWeekend || isOffHours) afterHours++;
    }
    m.afterHoursRatio = total ? +(afterHours / total).toFixed(3) : 0;
    m.afterHoursTotalEvents = total;
  }
}

/** Filter the model by an active projectKey. Returns a NEW shallow model.
 *  Also rebuilds `spaces`, `summary` and per-PK fields so that downstream
 *  renderers (Сводка, Метрики, …) get numbers consistent with the chosen PK.
 *  The original `model` is left untouched. */
export function filterModelByPk(model, pk) {
  if (!pk) return model;
  const inPk = (it) => it && it.pk === pk;
  const participants = model.participants.map(p => ({
    ...p,
    issuesNow:        p.issuesNow.filter(inPk),
    doneYesterday:    p.doneYesterday.filter(inPk),
    doneDayBefore:    p.doneDayBefore.filter(inPk),
    doneToday:        (p.doneToday||[]).filter(inPk),
    stale:            p.stale.filter(inPk),
    commentsRecent:   p.commentsRecent.filter(c => inPk(c.issue)),
    commentsToday:    (p.commentsToday||[]).filter(c => inPk(c.issue)),
    issuesCreatedToday: (p.issuesCreatedToday||[]).filter(inPk),
    confluenceEdits:  (p.confluenceEdits||[]).filter(c => inPk(c.issue)),
    timelineToday:    (p.timelineToday||[]).filter(e => inPk(e.issue)),
    timelineYesterday: p.timelineYesterday.filter(e => inPk(e.issue)),
    timelinePrev:     p.timelinePrev.filter(e => inPk(e.issue)),
    // Wave 4c — Zephyr per-user activity (48h window, item-level).
    zephyrTestsCreatedRecent:  (p.zephyrTestsCreatedRecent ||[]).filter(it => inPk(it.slim)),
    zephyrTestsExecutedRecent: (p.zephyrTestsExecutedRecent||[]).filter(it => inPk(it.slim)),
  })).filter(p =>
    p.issuesNow.length + p.doneYesterday.length + p.doneDayBefore.length +
    p.stale.length + p.commentsRecent.length +
    (p.timelineToday?.length || 0) > 0);

  const unassignedByPk = { [pk]: model.unassignedByPk[pk] || [] };
  // Filter spaces map so buildMetrics(m) and any code reading model.spaces
  // sees only the active PK (otherwise donuts/bars stay full-portfolio).
  const spaces = { [pk]: model.spaces[pk] || { issues: [], wipIssues: [], backlogIssues: [], sprintIssues: [], stats: { byBucket: {}, byStatus: {} } } };
  // Recompute summary numbers (Сводка tab reads model.summary). Approximation
  // of the same heuristics used by analysePulse, but over the slim per-PK
  // issue list. WIP is by-elimination (not terminal & not initial) — we don't
  // have the raw `issue` object on slim, so we can't call isWipActive() here.
  const summary = _recomputeSummary(spaces, participants);
  return {
    ...model, participants, unassignedByPk, spaces, summary,
    yesterdayActivity: model.yesterdayActivity.filter(a => inPk(a.issue)),
    todoToday: model.todoToday.filter(inPk),
  };
}

/** Build a summary block from a (possibly filtered) spaces map + participants. */
function _recomputeSummary(spaces, participants) {
  const sum = {
    totalIssues: 0, wip: 0, done: 0, notStarted: 0,
    unassigned: 0, blockers: 0, bugs: 0,
    commits48h: 0, pr48h: 0, conf48h: 0,
    testCases: 0, testExecs: 0, testSets: 0,
    testsCreated48h: 0, testsExecuted48h: 0,
    testsPassed48h: 0,  testsFailed48h: 0,
    testsPassedToday: 0, testsFailedToday: 0,
    testsPassedYesterday: 0, testsFailedYesterday: 0,
    testsPassedDayBefore: 0, testsFailedDayBefore: 0,
    activeSprints: [],
  };
  for (const [pk, sp] of Object.entries(spaces)) {
    if (!sp || sp.hasError) continue;
    for (const it of (sp.issues || [])) {
      sum.totalIssues++;
      const terminal = isTerminalStatus(it.status, it.statusCat);
      const initial  = isInitialStatus(it.status, it.statusCat);
      if (terminal) sum.done++;
      else if (initial) sum.notStarted++;
      else sum.wip++;
      if (typeBucket(it) === 'bug') sum.bugs++;
      if (it.priority && /blocker|highest|критич/i.test(it.priority) && !terminal) sum.blockers++;
      if (!it.assignee && !terminal) sum.unassigned++;
    }
    if (sp.activeSprintName) sum.activeSprints.push({ pk, name: sp.activeSprintName });
  }
  for (const p of (participants || [])) {
    sum.commits48h += p.badges?.commits48h || 0;
    sum.pr48h      += p.badges?.pr48h     || 0;
    sum.conf48h    += p.badges?.conf48h   || 0;
    sum.testsCreated48h  += p.badges?.testsCreated48h  || 0;
    sum.testsExecuted48h += p.badges?.testsExecuted48h || 0;
    sum.testsPassed48h   += p.badges?.testsPassed48h   || 0;
    sum.testsFailed48h   += p.badges?.testsFailed48h   || 0;
  }
  // Zephyr issue-type counters (testCases / testExecs / testSets) come from
  // `spaces[*].issues` regardless of assignee — recount here per-PK.
  for (const sp of Object.values(spaces)) {
    if (!sp || sp.hasError) continue;
    for (const it of (sp.issues || [])) {
      const z = zephyrKind(it);
      if (z === 'test')     sum.testCases++;
      if (z === 'testExec') sum.testExecs++;
      if (z === 'testSet')  sum.testSets++;
    }
  }
  return sum;
}

/* ── Sprint name parsing from old Jira customfield_10010 string ── */
function extractSprintName(s) { const m = String(s).match(/name=([^,\]]+)/); return m ? m[1] : ''; }
function extractSprintState(s){ const m = String(s).match(/state=([^,\]]+)/); return m ? m[1] : ''; }

/* ────────────────────────────────────────────────────────────
   Wave 4b — extract `[~user]` mention tokens from a comment/description.
   Returns a Set of normalised lowercased usernames so the caller can
   dedup multiple mentions of the same user in one comment.

   Jira encodings observed:
     · Server / Data Center:  [~name.surname]   or  [~ivanov.i]
     · Jira Cloud:            [~accountId:557058:abc-...]   (we keep raw id)
     · Mention in markup:     {{[~user]}} (rare, treat same)
   ──────────────────────────────────────────────────────────── */
function _extractMentions(text) {
  const out = new Set();
  if (!text) return out;
  // Allow letters/digits/dot/dash/colon/underscore inside the brackets.
  // Cap inner length at 80 chars to skip pathological cases.
  const RX = /\[~([A-Za-zА-Яа-я0-9._:\-]{1,80})\]/g;
  let m;
  while ((m = RX.exec(text)) !== null) {
    const raw = String(m[1] || '').trim();
    if (!raw) continue;
    // Cloud accountId form starts with "accountId:" — strip the prefix so
    // the key matches `userKey({accountId})` shape from ensureUser.
    const norm = raw.replace(/^accountid:/i, '').toLowerCase();
    out.add(norm);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────
   Wave 4a — map a Jira changelog item into a timeline event.
   --
   Returns null for fields we deliberately ignore (Rank, timeestimate,
   Workflow, etc.) so the renderer doesn't drown in noise.

   The trunc helper below caps `from`/`to` strings at 60 chars: long
   description diffs (Jira saves the FULL new description string in
   `toString`) would otherwise blow up the timeline UI.
   ──────────────────────────────────────────────────────────── */
/* ────────────────────────────────────────────────────────────
   Wave 4c — extract Zephyr test result from a status name.
   Test Execution issues move through statuses like:
     · "PASS" / "Pass" / "Passed" / "Прошло"
     · "FAIL" / "Fail" / "Failed" / "Не прошло"
     · "BLOCKED" / "Blocked" / "Заблокирован"
     · "WIP" / "In Progress"
   Returns 'PASS' / 'FAIL' / 'BLOCKED' / '' (anything else).
   ──────────────────────────────────────────────────────────── */
function _zephyrResultFromStatus(name) {
  const s = String(name || '').toLowerCase().trim();
  if (!s) return '';
  if (/^pass(ed)?$|прош/.test(s)) return 'PASS';
  if (/^fail(ed)?$|не прош|провал/.test(s)) return 'FAIL';
  if (/block|заблок/.test(s)) return 'BLOCKED';
  return '';
}

function _changelogTrunc(s, n = 60) {
  const str = String(s == null ? '' : s);
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}
function _changelogItemToEvent(it, slim, atIso) {
  const field = String(it.field || '').trim();
  const fieldLow = field.toLowerCase();
  const from = it.fromString != null ? it.fromString : (it.from != null ? it.from : '');
  const to   = it.toString   != null ? it.toString   : (it.to   != null ? it.to   : '');

  // ── 1. Status transition — same as wave 1 ──
  if (fieldLow === 'status') {
    const isTermTo = isTerminalStatus(to);
    return {
      kind:  isTermTo ? 'closed' : 'transition',
      issue: slim, at: atIso,
      text:  `Перевели в ${to}`,
      from, to,
    };
  }

  // ── 2. Assignee change ──
  if (fieldLow === 'assignee') {
    const text = !to ? `Снял исполнителя` : `Назначил: ${to}`;
    return { kind: 'assignee-change', issue: slim, at: atIso, text, from, to };
  }

  // ── 3. Attachments ──
  if (fieldLow === 'attachment') {
    // Jira: `to` is the attachment id when added; `from` is filled when removed.
    const action = to ? 'Прикрепил' : 'Удалил';
    const fname  = to || from || '';
    return { kind: 'attachment', issue: slim, at: atIso, text: `${action} файл${fname ? ': ' + _changelogTrunc(fname, 60) : ''}` };
  }

  // ── 4. Issue links ──
  if (fieldLow === 'link') {
    // `to` is "This issue X-1 is blocked by ..." or similar — treat as text.
    const text = to
      ? `Создал связь: ${_changelogTrunc(to, 80)}`
      : (from ? `Удалил связь: ${_changelogTrunc(from, 80)}` : 'Изменил связи');
    return { kind: 'link', issue: slim, at: atIso, text };
  }

  // ── 5. Description — only signal that it changed (full diff is too long) ──
  if (fieldLow === 'description') {
    return { kind: 'field-change', issue: slim, at: atIso, text: 'Изменил описание', field };
  }

  // ── 6. Summary, priority, labels, fixVersions, Story Points, Sprint ──
  // For these we show "поле: from → to" — short and informative.
  const SIMPLE_FIELDS_BY_NAME = new Set([
    'summary', 'priority', 'labels', 'fix version', 'fix versions',
    'story points', 'sprint', 'epic link', 'duedate', 'due date',
    'components', 'reporter',
  ]);
  if (SIMPLE_FIELDS_BY_NAME.has(fieldLow)) {
    const fromS = _changelogTrunc(from, 40);
    const toS   = _changelogTrunc(to,   40);
    const text = fromS && toS
      ? `${field}: ${fromS} → ${toS}`
      : toS ? `${field}: ${toS}`
      : fromS ? `${field}: убрано (${fromS})`
      : `${field} изменён`;
    return { kind: 'field-change', issue: slim, at: atIso, text, field, from, to };
  }

  // ── 7. Custom fields by id pattern: customfield_NNNNN ──
  // Many Jira customfields surface only via fieldId; the display name comes
  // through `field`. Whitelist by display name keywords commonly seen.
  if (/^customfield_\d+$/i.test(it.fieldId || '') ||
      /story points|epic|sprint|severity|component|category/i.test(field)) {
    const fromS = _changelogTrunc(from, 40);
    const toS   = _changelogTrunc(to,   40);
    const text = fromS && toS ? `${field}: ${fromS} → ${toS}` : (toS ? `${field}: ${toS}` : `${field} изменён`);
    return { kind: 'field-change', issue: slim, at: atIso, text, field, from, to };
  }

  // ── 8. Ignore noise (Rank, Workflow, timeestimate, environment, …) ──
  return null;
}

/* ── Author name fuzzy-match. Tries:
     1) full-name token-set equality (whitespace/order insensitive),
     2) firstname+lastname permutations ("Иван Иванов" ≡ "Ivanov Ivan"),
     3) V12 (FOUND_BUGS #4): cross-script transliteration via a minimal
        RU↔EN consonant-class lookup so "Иванов Иван" matches "Ivanov Ivan".
   Returns the matching author entry or null. */

// V12 — single-letter Cyrillic → Latin transliteration. Table covers the
// common Russian last-name letters; multi-letter variants (щ, ё) collapse
// to their primary form. Anything else passes through unchanged. This is
// NOT a full transliterator — it's a lossy normaliser whose only goal is
// to make `_ppFindByPartial` see overlap between scripts.
const _CYR_TO_LAT_MAP = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z',
  'и':'i','й':'i','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r',
  'с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sh',
  'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
};
function _translitToken(s) {
  return String(s || '').toLowerCase().replace(/[а-яё]/g, ch => _CYR_TO_LAT_MAP[ch] ?? ch);
}

function _ppFindByPartial(authorsMap, labelLower, keys) {
  if (!labelLower || !keys?.length) return null;
  const tokens = labelLower.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const tokenSet     = new Set(tokens);
  const tokenSetLat  = new Set(tokens.map(_translitToken));   // V12 cross-script set
  for (const k of keys) {
    const ks = k.split(/\s+/).filter(Boolean);
    if (ks.length < 2) continue;
    // intersection size ≥ 2 → likely the same person across systems
    let overlap = 0;
    let overlapLat = 0;
    for (const t of ks) {
      if (tokenSet.has(t)) overlap++;
      const tl = _translitToken(t);
      if (tl && tokenSetLat.has(tl)) overlapLat++;
    }
    if (overlap >= 2 || overlapLat >= 2) return authorsMap[k];
  }
  return null;
}
