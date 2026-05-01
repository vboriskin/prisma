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
    },
    todoToday: [],          // 8.2 plan-for-today candidates
    yesterdayActivity: [],  // 8.3 what was done yesterday (transitions/worklog/comments)
    // Pass-through diagnostic blocks from server (so the renderer can show
    // status pills "Bitbucket: ✓/настр-н/ошибка" in the header).
    bitbucket:    rawReports?.bitbucket  || { authors: {}, configured: false },
    confluence:   rawReports?.confluence || { authors: {}, configured: false },
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
  const bbAuthors = (rawReports?.bitbucket?.authors)  || {};
  const cfAuthors = (rawReports?.confluence?.authors) || {};
  const employees = Array.isArray(opts?.employees) ? opts.employees : [];
  const allowFuzzy = !!opts?.allowFuzzyAuthorMatch;

  // Build reverse identity indexes from state.employees.
  const empByEmail   = new Map();
  const empByJiraId  = new Map();
  const empByBbLogin = new Map();
  const empByCfId    = new Map();
  for (const e of employees) {
    if (!e) continue;
    if (e.email)               empByEmail  .set(String(e.email              ).toLowerCase().trim(), e);
    if (e.jiraAccountId)       empByJiraId .set(String(e.jiraAccountId      ).toLowerCase().trim(), e);
    if (e.bitbucketLogin)      empByBbLogin.set(String(e.bitbucketLogin     ).toLowerCase().trim(), e);
    if (e.confluenceAccountId) empByCfId   .set(String(e.confluenceAccountId).toLowerCase().trim(), e);
  }

  // BB authors are keyed by `(displayName || email).toLowerCase()` on the
  // server (server.js _ppKeyForAuthor). To find by login we need a
  // reverse-build: scan once and index by every recognizable identifier the
  // entry exposes (email, displayName, the key itself = bitbucket login in
  // most cases when displayName is missing).
  const _buildAuthorLookups = (authorsMap) => {
    const byEmail = new Map();
    const byKey   = new Map();      // raw lookup key (displayName / login lowercase)
    for (const [k, v] of Object.entries(authorsMap || {})) {
      byKey.set(String(k).toLowerCase().trim(), v);
      const em = String(v?.email || '').toLowerCase().trim();
      if (em) byEmail.set(em, v);
    }
    return { byEmail, byKey };
  };
  const bbLookup = _buildAuthorLookups(bbAuthors);
  const cfLookup = _buildAuthorLookups(cfAuthors);

  for (const p of userMap.values()) {
    // 1) Find this participant in state.employees by identity.
    let emp = null;
    if (p.email && empByEmail.has(p.email)) emp = empByEmail.get(p.email);
    if (!emp && p.jiraAccountId && empByJiraId.has(p.jiraAccountId.toLowerCase())) {
      emp = empByJiraId.get(p.jiraAccountId.toLowerCase());
    }

    // 2) Bitbucket: prefer employee.bitbucketLogin lookup. If employee
    //    has no BB login, do NOT attribute (this is the user's complaint:
    //    «сотрудник без BB получает чужие PR»).
    let bb = null;
    if (emp) {
      if (emp.bitbucketLogin) {
        bb = bbLookup.byKey.get(String(emp.bitbucketLogin).toLowerCase().trim()) || null;
      }
      if (!bb && emp.email) {
        bb = bbLookup.byEmail.get(String(emp.email).toLowerCase().trim()) || null;
      }
    } else if (p.email) {
      // Participant not in state.employees but BB has author with same email — still safe to attribute.
      bb = bbLookup.byEmail.get(p.email) || null;
    }
    // Dev-only fuzzy fallback (off by default).
    if (!bb && allowFuzzy) {
      const labelLower = String(p.label || '').toLowerCase().trim();
      bb = _ppFindByPartial(bbAuthors, labelLower, Object.keys(bbAuthors));
    }
    if (bb) {
      p.badges.commits48h = bb.commits || 0;
      p.badges.pr48h      = bb.prs     || 0;
      p.badges.prReviews48h  = bb.reviews    || 0;
      p.badges.prApproves48h = bb.approves   || 0;
      p.badges.prNeedsWork48h= bb.needsWork  || 0;
      p.badges.prDeclined48h = bb.declined   || 0;
      p.bbItems = Array.isArray(bb.items) ? bb.items.slice() : [];
      p.bbItems.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    }

    // 3) Confluence — same identity-first approach.
    let cf = null;
    if (emp) {
      if (emp.confluenceAccountId) {
        cf = cfLookup.byKey.get(String(emp.confluenceAccountId).toLowerCase().trim()) || null;
      }
      if (!cf && emp.email) {
        cf = cfLookup.byEmail.get(String(emp.email).toLowerCase().trim()) || null;
      }
    } else if (p.email) {
      cf = cfLookup.byEmail.get(p.email) || null;
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
  }
  // Aggregate totals on summary
  for (const a of Object.values(bbAuthors)) {
    out.summary.commits48h += (a.commits || 0);
    out.summary.pr48h      += (a.prs     || 0);
  }
  for (const a of Object.values(cfAuthors)) out.summary.conf48h += (a.edits || 0);

  // Convert sets to arrays + sort participants
  for (const p of userMap.values()) {
    p.projects = Array.from(p.projects);
    // Newest-first within each day window — keeps the timeline UI consistent.
    p.timelineToday    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    p.timelineYesterday.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    p.timelinePrev     .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
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

  return out;
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
