'use strict';
/* ============================================================
   server/integrations/blackDashboard.js — V13 (extracted from server.js, audit #19).

   BLACK DASHBOARD — Sigma Jira integration.
   Sigma is a SECOND Jira instance that holds quarterly "goal" epics.
   Each goal epic has a custom field «Domain link» — an array of Delta
   issue keys. The Чёрный дашборд cross-references those Delta keys
   against all Delta epics+stories to compute "linked vs unlinked"
   coverage per team.

   Reuses the existing `jiraRequest` infrastructure by composing a
   "shadow" cfg that points jiraBaseUrl/jiraToken at Sigma. Deps come
   in via `createBlackDashboard({ jiraRequest, jiraSearchAll })`.

   Public surface: `buildBlackDashboard(cfg)`.
   ============================================================ */

function sigmaCfgView(cfg) {
  return {
    jiraBaseUrl: cfg.sigmaJiraBaseUrl || '',
    jiraToken:   cfg.sigmaJiraToken   || '',
    allowInsecureTls: !!cfg.allowInsecureTls,
  };
}

/** Parse the «Domain link» field value into a unique array of issue keys.
 *  Handles every shape Jira may return for an array-of-keys custom field:
 *  - array of strings: ["KEY-1","KEY-2"]
 *  - array of objects: [{value:"KEY-1"}, {key:"KEY-1"}, {name:"KEY-1"}]
 *  - JSON string (rare): "[\"KEY-1\",\"KEY-2\"]"
 *  - comma/whitespace-separated text: "KEY-1, KEY-2"
 *  Anything not matching JIRA-KEY-NUMBER pattern is dropped. */
function _parseDomainLink(raw) {
  if (raw == null) return [];
  let arr = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try { arr = JSON.parse(trimmed); } catch (_) { arr = trimmed.split(/[\s,;]+/); }
    } else {
      arr = trimmed.split(/[\s,;]+/);
    }
  }
  if (!Array.isArray(arr)) return [];
  const out = new Set();
  // V15 (audit #1, fullstack Medium 9): forbid mixed-script project keys
  // — e.g. `АBC-1` (cyrillic А + latin BC) used to slip through and waste
  // Jira retry budget on guaranteed 404s. Allow either ALL-latin or
  // ALL-cyrillic uppercase prefixes, not a mix.
  const KEY_RX_LAT = /^[A-Z][A-Z0-9]+-\d+$/;
  const KEY_RX_CYR = /^[А-Я][А-Я0-9]+-\d+$/;
  for (const item of arr) {
    let candidate = '';
    if (typeof item === 'string') candidate = item;
    else if (item && typeof item === 'object') {
      candidate = String(item.value || item.key || item.name || item.id || '');
    }
    candidate = candidate.trim().toUpperCase();
    if (KEY_RX_LAT.test(candidate) || KEY_RX_CYR.test(candidate)) out.add(candidate);
  }
  return Array.from(out);
}

/** Parse a Jira fixVersion-style quarter label into the UTC start date
 *  of that quarter. Accepts the project's typical `2026_Q1` shape plus
 *  tolerant variations: `2026 Q1`, `2026-Q1`, `Q1 2026`, `Q1/2026`.
 *  Returns `null` if the label doesn't look like a quarter — caller
 *  should treat null as "no constraint" and skip the rule for that goal.
 *
 *  V13 (13th pass): added for the «exclude Done tasks finished before
 *  the goal's quarter» rule. We use UTC to avoid timezone surprises
 *  near quarter boundaries.
 */
function _parseQuarterStart(versionName) {
  const s = String(versionName || '').trim();
  if (!s) return null;
  let year, q;
  // Form A: "<YEAR><sep>Q<n>", e.g., "2026_Q1", "2026 Q1", "2026-Q1"
  let m = s.match(/^(\d{4})[_\s\-/.]?Q([1-4])\b/i);
  if (m) { year = +m[1]; q = +m[2]; }
  // Form B: "Q<n><sep><YEAR>", e.g., "Q1 2026", "Q1/2026"
  if (!m) {
    m = s.match(/^Q([1-4])[_\s\-/.]?(\d{4})\b/i);
    if (m) { q = +m[1]; year = +m[2]; }
  }
  if (!m) return null;
  const month = (q - 1) * 3;       // Q1=0(Jan), Q2=3(Apr), Q3=6(Jul), Q4=9(Oct)
  return new Date(Date.UTC(year, month, 1));
}

/** Normalise a Jira statusCategory.key into our tri-state. Anything not
 *  recognised collapses to 'new' so unknown statuses still render. */
function _statusCatBucket(catKey) {
  const k = String(catKey || '').toLowerCase();
  if (k === 'done') return 'done';
  if (k === 'indeterminate') return 'indeterminate';
  return 'new';
}

/**
 * Walk the Epic Link parent/child tree downward starting from `seedKeys`,
 * collecting every issue whose `"Epic Link"` is one of the keys we already
 * know about. Sub-tasks are intentionally excluded — coverage in the
 * Чёрный дашборд should not promote sub-tasks into the linked-to-goal set
 * (per user requirement).
 *
 * Pure async helper — depends only on the injected `searchByJql` so it's
 * trivially testable. Not called from any UI directly; used inside
 * `buildBlackDashboard`.
 *
 * Defensive defaults — the dashboard endpoint as a whole has a 90 s client-side
 * timeout (see integrations/blackDashboardApi.js), so this helper budgets
 * a generous-but-bounded slice of that for the expansion phase. On budget
 * exhaustion we exit with `truncated: true` and the caller falls back to
 * the partial set instead of throwing.
 *
 * @param {object}   opts
 * @param {string[]} opts.seedKeys           - starting keys (literally what's in Domain link)
 * @param {Function} opts.searchByJql        - async (jql:string) → Array<{key, fields:{...}}>
 * @param {number}   [opts.maxDepth=4]       - hard cap on traversal depth
 * @param {number}   [opts.maxKeys=5000]     - safety cap on total expanded set
 * @param {number}   [opts.timeBudgetMs=180000] - overall expansion budget; on exceed → exit early
 * @param {number}   [opts.maxConsecutiveFailures=2] - on N JQL failures in a row → exit early
 * @param {number}   [opts.chunkConcurrency=2]  - parallel chunks per level (lower = gentler on Jira → fewer 429s)
 * @returns {Promise<{keys: Set<string>, levels: number, batches: number,
 *                    truncated: boolean, exitReason: string}>}
 */
async function expandIssueTree({
  seedKeys,
  searchByJql,
  maxDepth = 4,
  maxKeys = 5000,
  // V13 (2026-04): defaults bumped to absorb 429 rate-limit storms instead of
  // aborting whole levels. timeBudget 35s→180s lets retry-with-backoff at
  // jiraRequest layer run its full 85s/request worst-case across multiple
  // chunks. chunkConcurrency 4→2 halves the simultaneous request pressure
  // (the original cause of cascading 429s — 4 chunks hit Jira at once, all
  // got 429, all failed retry, level fell over).
  timeBudgetMs = 180000,
  maxConsecutiveFailures = 2,
  chunkConcurrency = 2,
  followCloners = false,
}) {
  const all = new Set(seedKeys || []);
  if (!all.size || typeof searchByJql !== 'function') {
    return { keys: all, levels: 0, batches: 0, truncated: false, exitReason: 'no-seed', chunkErrors: [], fellBackNoCloners: 0 };
  }
  let frontier = [...all];
  let level = 0;
  let batches = 0;
  let consecFailures = 0;
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;
  let exitReason = 'completed';
  // V13: collect chunk errors / cloners-fallback events across ALL levels,
  // so the caller can surface root-cause diagnostics in the response. Only
  // the most recent N entries are kept to bound payload size.
  const chunkErrors = [];           // [{level, error}, ...]
  let fellBackNoCloners = 0;        // count of chunks where cloners-fallback rescued
  const ERROR_LOG_CAP = 20;
  // V13 (8th pass): adaptive cloners-disable. After the first chunk that
  // FAILED with cloners-JQL but SUCCEEDED with the no-cloners fallback,
  // we know this Jira instance doesn't accept the cloners clause (most
  // likely 400 — `linkedIssues()` not supported, or JQL too long). All
  // subsequent chunks in this run skip the cloners attempt entirely —
  // saving the wasted first-attempt + retry budget per chunk. Without
  // this guard, with 11 batches × ~5s wasted per cloners-attempt = ~55s
  // burned BEFORE any real work happens, which can blow the time budget.
  let clonersAutoDisabled = false;
  let clonersDisabledAtChunkIdx = -1;     // for diagnostics

  // BFS — each level runs every chunk IN PARALLEL via Promise.allSettled
  // (with bounded concurrency `chunkConcurrency` to avoid hammering corp
  // Jira with 50+ simultaneous requests). Sequential chunks were the
  // bottleneck — one user reported 686 keys in 25s with sequential, where
  // the same data fits in <10s with 4 parallel chunks.
  //
  // Cycles can't form via the Epic Link relation in Jira (an epic can't be
  // an Epic Link target of another epic), but `seen` set provides
  // belt-and-braces protection in case that invariant ever changes.
  // V13 (2026-04, 3rd pass): with 21 seeds there's only 1 chunk per level —
  // a single 429 (which jiraRequest already retried up to 60×30s) used to
  // mean instant abort. Now we tolerate one full-level failure: pause 30s
  // and re-run the SAME level once. If the second pass also goes 0/N, then
  // it's a real outage and we exit with 'failures'.
  const LEVEL_RETRY_PAUSE_MS = 30000;
  let levelRetryPending = false;

  while (level < maxDepth && frontier.length > 0 && all.size < maxKeys) {
    if (elapsed() >= timeBudgetMs) { exitReason = 'time-budget'; break; }
    if (consecFailures >= maxConsecutiveFailures) { exitReason = 'failures'; break; }
    if (!levelRetryPending) level++;
    const CHUNK = 200;

    // Build chunks for this level.
    const chunks = [];
    for (let i = 0; i < frontier.length; i += CHUNK) {
      chunks.push(frontier.slice(i, i + CHUNK));
    }
    batches += chunks.length;

    // Run chunks with bounded concurrency. We deliberately respect the
    // overall timeBudget by short-circuiting BEFORE starting more chunks —
    // already-in-flight chunks finish naturally (they each have their own
    // per-call timeout from searchByJql). Failures accumulate on
    // `consecFailures` only when they happen back-to-back without an
    // intervening success — Promise.allSettled doesn't preserve order, so
    // we count post-hoc on the result array.
    const found = new Set();
    let chunkIdx = 0;
    const runOne = async () => {
      while (chunkIdx < chunks.length) {
        if (elapsed() >= timeBudgetMs) return;   // budget — drop remaining chunks
        const myIdx = chunkIdx++;
        const chunk = chunks[myIdx];
        // Dual-path child lookup. Sber Jira (and most large corp Jiras) is a
        // mix of two epic→story hierarchies after team-managed migrations:
        //   1. Old: kids point at the epic via the `"Epic Link"` custom field.
        //   2. New: kids point via `parent` (replaced Epic Link in newer Jira).
        // Querying ONLY "Epic Link" misses every story that was created/moved
        // under the new model — confirmed by user: half of an epic's children
        // were silently `linkedToGoal: false` though they're explicitly under
        // the right epic. ORing both fields catches both styles.
        //
        // OPTIONAL 3rd path (`followCloners=true`): cross-quarter clone-chains.
        // Sber's SMEAM team uses [Cloners] issue links to chain quarterly
        // versions of the same epic (Q4 → Q1 → Q2 ...). Domain link points
        // at the latest quarter; without Cloners-following, the previous
        // quarters' epics (and their structural children) are invisible to
        // coverage. Limited to `issuetype = Epic` to avoid pulling in
        // arbitrary "duplicates" / "relates" links from non-epic issues.
        // Off by default (set `cfg.followCloners: true` to enable) — risks
        // false-positives if other teams use Cloners for unrelated cloning.
        // `issuetype != Sub-task` still excludes sub-tasks regardless of path.
        const list = chunk.map(k => `"${k}"`).join(',');
        // V13 (8th pass): use cloners only if the flag is on AND we haven't
        // detected the clause as broken on this Jira via an earlier chunk.
        const useClonersThisChunk = followCloners && !clonersAutoDisabled;
        let clonerClause = '';
        if (useClonersThisChunk) {
          // linkedIssues() takes a single key; OR them per chunk-key.
          const cloneOrs = chunk
            .map(k => `issue in linkedIssues("${k}", "Cloners")`)
            .join(' OR ');
          clonerClause = ` OR (issuetype = Epic AND (${cloneOrs}))`;
        }
        const baseJql = `("Epic Link" in (${list}) OR parent in (${list})${clonerClause}) AND issuetype != Sub-task`;
        const noClonersJql = `("Epic Link" in (${list}) OR parent in (${list})) AND issuetype != Sub-task`;
        try {
          const issues = await searchByJql(baseJql);
          for (const it of issues || []) {
            if (it?.key) found.add(it.key);
          }
        } catch (e) {
          // V13 (2026-04, 4th pass): cloners-clause fallback. The combined
          // JQL with N×`linkedIssues("X","Cloners")` ORs can hit corp Jira
          // limits (414 URI Too Long, 400 "function unrecognised", 400 JQL
          // parser limits). Most projects don't actually have Cloners-chains
          // — the clause just adds risk for them. So on ANY failure with
          // followCloners=on, retry the SAME chunk with the cloners-clause
          // stripped. This preserves the main Epic Link / parent expand
          // even when cloners-flavoured Jira chokes.
          //
          // V13 (8th pass): when fallback succeeds → flip `clonersAutoDisabled`
          // so all subsequent chunks SKIP the doomed cloners attempt.
          const initialErr = e?.message || String(e);
          if (useClonersThisChunk) {
            try {
              const issues2 = await searchByJql(noClonersJql);
              for (const it of issues2 || []) {
                if (it?.key) found.add(it.key);
              }
              chunks[myIdx]._fellBackNoCloners = true;
              chunks[myIdx]._fallbackReason    = initialErr;
              if (!clonersAutoDisabled) {
                clonersAutoDisabled = true;
                clonersDisabledAtChunkIdx = myIdx;
                console.warn(`[bd:expand] cloners-JQL not supported on this Jira (chunk ${myIdx} failed: "${initialErr}"). Disabling cloners-clause for the rest of this run.`);
              } else {
                console.warn(`[bd:expand] level ${level} chunk ${myIdx}: cloners-JQL failed (${initialErr}); retried without cloners-clause and got ${issues2?.length||0} issues`);
              }
            } catch (e2) {
              chunks[myIdx]._failed = true;
              chunks[myIdx]._error  = `cloners: ${initialErr} | no-cloners: ${e2?.message || String(e2)}`;
            }
          } else {
            chunks[myIdx]._failed = true;
            chunks[myIdx]._error  = initialErr;
          }
        }
        if (all.size + found.size >= maxKeys) return;
      }
    };

    // Spin up `chunkConcurrency` workers; each pulls chunks off the queue.
    const workerCount = Math.min(chunkConcurrency, chunks.length);
    await Promise.all(Array.from({ length: workerCount }, runOne));

    // Surface per-chunk diagnostics out of this level's chunks array
    // (which is overwritten on the next level — capture before it goes).
    for (const c of chunks) {
      if (c._fellBackNoCloners) fellBackNoCloners++;
      if (c._failed && chunkErrors.length < ERROR_LOG_CAP) {
        chunkErrors.push({ level, error: c._error || 'unknown' });
      }
    }

    // Tally failures: if EVERY chunk this level errored, give the level ONE
    // more shot after a 30s pause (corp Jira may have been rate-limiting
    // beyond what jiraRequest retries could absorb). On second consecutive
    // all-fail → it's a real outage and we exit. Partial failures (some
    // chunks fail, some succeed) are tolerated — we keep what we got.
    const failedChunks  = chunks.filter(c => c._failed).length;
    const allFailed     = failedChunks > 0 && failedChunks === chunks.length;
    if (allFailed) {
      const sample = chunks.find(c => c._failed)?._error || 'unknown';
      if (!levelRetryPending && elapsed() + LEVEL_RETRY_PAUSE_MS < timeBudgetMs) {
        console.warn(`[bd:expand] level ${level}: ALL ${chunks.length} chunks failed. Sample: ${sample}. Pausing ${LEVEL_RETRY_PAUSE_MS}ms then retrying level once.`);
        levelRetryPending = true;
        await new Promise(r => setTimeout(r, LEVEL_RETRY_PAUSE_MS));
        continue; // re-runs this level (level++ skipped via levelRetryPending)
      }
      console.warn(`[bd:expand] level ${level}: ALL ${chunks.length} chunks failed AGAIN after retry. Sample: ${sample}. Giving up.`);
      exitReason = 'failures';
      consecFailures = maxConsecutiveFailures;   // ← short-circuit the outer guard
    } else if (failedChunks > 0) {
      console.warn(`[bd:expand] level ${level}: ${failedChunks}/${chunks.length} chunks failed (partial result)`);
    }
    levelRetryPending = false;   // success or partial — clear retry latch

    // Check budget AFTER level completes — gives us one full level's worth
    // of data even if budget exhausted while parallel chunks were in flight.
    if (elapsed() >= timeBudgetMs) {
      exitReason = 'time-budget';
      // Still merge what we found this level into `all` before exiting.
    }

    const newKeys = [...found].filter(k => !all.has(k));
    if (!newKeys.length) {
      if (exitReason !== 'time-budget') break;   // natural BFS completion
      break;
    }
    for (const k of newKeys) {
      if (all.size >= maxKeys) break;
      all.add(k);
    }
    if (exitReason === 'time-budget') break;
    frontier = newKeys;
  }

  const truncated = exitReason === 'time-budget' || exitReason === 'failures'
                 || (all.size >= maxKeys && exitReason === 'completed');
  return {
    keys: all, levels: level, batches, truncated, exitReason,
    chunkErrors, fellBackNoCloners,
    clonersAutoDisabled, clonersDisabledAtChunkIdx,
  };
}

/**
 * For each seed key, run a tiny per-key JQL to detect "epic-aggregator" seeds
 * — those that have NO structural children (no `Epic Link` and no `parent`
 * pointing at them). These are seeds that exist in Domain link but contribute
 * only themselves to coverage, signalling to the user that the goal references
 * an aggregator-epic rather than a real work-epic.
 *
 * Run as parallel point-queries with bounded concurrency. Each query is
 * narrow (LIMIT 5, project filter applied) so latency is minimal.
 *
 * @param {object}   opts
 * @param {string[]} opts.seedKeys
 * @param {Function} opts.searchByJql        - async (jql:string) → Array<{key,...}>
 * @param {string}   [opts.projectClause=''] - extra `AND project in (...)` clause
 * @param {number}   [opts.concurrency=4]
 * @param {number}   [opts.timeBudgetMs=10000] - overall budget (default 10s)
 * @returns {Promise<{childless: string[], probed: number, partialResult: boolean}>}
 */
async function findChildlessSeeds({
  seedKeys,
  searchByJql,
  projectClause = '',
  concurrency = 4,
  timeBudgetMs = 10000,
}) {
  if (!seedKeys?.length || typeof searchByJql !== 'function') {
    return { childless: [], probed: 0, partialResult: false };
  }
  const t0 = Date.now();
  const childless = [];
  const probedSet = new Set();
  let queueIdx = 0;
  let partialResult = false;

  const runOne = async () => {
    while (queueIdx < seedKeys.length) {
      if (Date.now() - t0 >= timeBudgetMs) { partialResult = true; return; }
      const k = seedKeys[queueIdx++];
      probedSet.add(k);
      const jql = `("Epic Link" = "${k}" OR parent = "${k}")${projectClause}`;
      try {
        const issues = await searchByJql(jql);
        const realChildren = (issues || []).filter(i => i?.key && i.key !== k);
        if (realChildren.length === 0) childless.push(k);
      } catch (e) {
        // Don't classify a key as childless on a query error — that would be
        // false-positive. Log and skip; user can re-run.
        console.warn(`[bd:childless] seed=${k} probe failed:`, e?.message || e);
      }
    }
  };

  const workers = Math.min(concurrency, seedKeys.length);
  await Promise.all(Array.from({ length: workers }, runOne));

  return { childless: childless.sort(), probed: probedSet.size, partialResult };
}

/**
 * Factory — wires deps (`jiraRequest`, `jiraSearchAll`) and returns
 * `{ buildBlackDashboard, sigmaCfgView }`.
 */
function createBlackDashboard(deps) {
  const { jiraRequest, jiraSearchAll } = deps;

  // Domain-link field id cache (1h, keyed by Sigma URL).
  const _SIGMA_DOMAIN_FIELD_TTL = 60 * 60 * 1000;
  let _sigmaDomainFieldCache = { url: '', id: '', at: 0 };

  // V13 (added 2026-04, 7th pass): Epic Link field id cache for the Delta
  // Jira instance. Needed to build the epic→children map for coverage
  // exclusion rules:
  //   1. Epics with NO children — excluded from coverage (administrative
  //      artifacts that would otherwise drag the percentage down).
  //   2. Epics whose children are ALL in `new` status (not in active or
  //      done backlog) — excluded along with those children. Reason: the
  //      epic is provisional, work hasn't started.
  // Discovered by scanning `/rest/api/2/field` for a field named
  // "Epic Link" (custom field id varies per Jira version: 10014 on Cloud,
  // 10008/10010 on Server). Falls back to '' (no Epic Link discovery) —
  // in which case child detection uses `parent` field only (still works
  // for team-managed projects, the modern Sber default).
  const _DELTA_EPICLINK_FIELD_TTL = 60 * 60 * 1000;
  let _deltaEpicLinkFieldCache = { url: '', id: '', at: 0 };

  async function deltaResolveEpicLinkFieldId(cfg) {
    const now = Date.now();
    if (_deltaEpicLinkFieldCache.url === cfg.jiraBaseUrl
        && now - _deltaEpicLinkFieldCache.at < _DELTA_EPICLINK_FIELD_TTL) {
      return _deltaEpicLinkFieldCache.id;
    }
    try {
      const fields = await jiraRequest(cfg, 'GET', '/rest/api/2/field');
      if (Array.isArray(fields)) {
        const candidates = fields.filter(f =>
          (f.name || '').toLowerCase().trim() === 'epic link'
        );
        const found = candidates.find(c => c.id && c.id.startsWith('customfield_')) || candidates[0];
        const id = found?.id || '';
        _deltaEpicLinkFieldCache = { url: cfg.jiraBaseUrl, id, at: now };
        return id;
      }
    } catch (e) {
      console.warn('[delta] epic link field auto-discovery failed:', e.message);
    }
    _deltaEpicLinkFieldCache = { url: cfg.jiraBaseUrl, id: '', at: now };
    return '';
  }

  async function sigmaResolveDomainLinkFieldId(cfg) {
    const sigCfg = sigmaCfgView(cfg);
    const now = Date.now();
    if (_sigmaDomainFieldCache.url === sigCfg.jiraBaseUrl
        && now - _sigmaDomainFieldCache.at < _SIGMA_DOMAIN_FIELD_TTL
        && _sigmaDomainFieldCache.id) {
      return _sigmaDomainFieldCache.id;
    }
    try {
      const fields = await jiraRequest(sigCfg, 'GET', '/rest/api/2/field');
      if (Array.isArray(fields)) {
        const candidates = fields.filter(f =>
          (f.name || '').toLowerCase().trim() === 'domain link'
        );
        const found = candidates.find(c => c.id && c.id.startsWith('customfield_')) || candidates[0];
        if (found?.id) {
          _sigmaDomainFieldCache = { url: sigCfg.jiraBaseUrl, id: found.id, at: now };
          return found.id;
        }
      }
    } catch (e) {
      console.warn('[sigma] domain link field auto-discovery failed:', e.message);
    }
    _sigmaDomainFieldCache = { url: sigCfg.jiraBaseUrl, id: '', at: now };
    return '';
  }

  async function sigmaFetchGoal(cfg, key, domainFieldId) {
    const sigCfg = sigmaCfgView(cfg);
    try {
      // V13 (13th pass): also fetch `fixVersions` — drives the «исключаем
      // задачу в Done, завершённую до начала квартала цели» rule.
      const fields = ['summary', 'status', 'fixVersions'];
      if (domainFieldId) fields.push(domainFieldId);
      const path = `/rest/api/2/issue/${encodeURIComponent(key)}?fields=${encodeURIComponent(fields.join(','))}`;
      const issue = await jiraRequest(sigCfg, 'GET', path);
      const fixVersions = Array.isArray(issue.fields?.fixVersions)
        ? issue.fields.fixVersions.map(v => String(v?.name || '').trim()).filter(Boolean)
        : [];
      return {
        key:         issue.key || key,
        summary:     issue.fields?.summary || '',
        status:      issue.fields?.status?.name || '',
        statusCat:   _statusCatBucket(issue.fields?.status?.statusCategory?.key),
        domainLinks: domainFieldId ? _parseDomainLink(issue.fields?.[domainFieldId]) : [],
        fixVersions,
      };
    } catch (e) {
      return { key, error: e.message || String(e) };
    }
  }

  async function sigmaFetchDeltaIssuesByKeys(cfg, keys) {
    if (!keys.length) return new Map();
    const fields = ['summary', 'status', 'issuetype', 'project'];
    const out = new Map();
    const CHUNK = 200;
    for (let i = 0; i < keys.length; i += CHUNK) {
      const chunk = keys.slice(i, i + CHUNK);
      const jql = `key in (${chunk.map(k => `"${k}"`).join(',')})`;
      try {
        const issues = await jiraSearchAll(cfg, jql, fields, [], chunk.length, 30000);
        for (const it of issues) {
          out.set(it.key, {
            key:        it.key,
            summary:    it.fields?.summary || '',
            status:     it.fields?.status?.name || '',
            statusCat:  _statusCatBucket(it.fields?.status?.statusCategory?.key),
            type:       it.fields?.issuetype?.name || '',
            pk:         it.fields?.project?.key || (it.key || '').split('-')[0],
            projectName:it.fields?.project?.name || '',
          });
        }
      } catch (e) {
        console.warn(`[sigma] delta-batch chunk failed (${chunk.length} keys):`, e.message);
      }
    }
    return out;
  }

  /** Build the full Чёрный дашборд payload. Pure data, no rendering. */
  async function buildBlackDashboard(cfg) {
    const t0 = Date.now();
    const out = {
      fetchedAt: new Date().toISOString(),
      sigmaConfigured: !!(cfg.sigmaJiraBaseUrl && cfg.sigmaJiraToken),
      sigmaBaseUrl: cfg.sigmaJiraBaseUrl || '',
      deltaBaseUrl: cfg.jiraBaseUrl || '',
      goals: [],
      teamIssues: [],
      summary: { totalGoals: 0, linkedCount: 0, unlinkedCount: 0, coveragePct: 0 },
      errors: [],
      diagnostics: { totalMs: 0 },
    };
    if (!out.sigmaConfigured) {
      out.errors.push({ scope: 'sigma', message: 'Sigma Jira не настроена (URL или токен пусты)' });
      out.diagnostics.totalMs = Date.now() - t0;
      return out;
    }
    const goalKeys = String(cfg.sigmaGoalEpicKeys || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!goalKeys.length) {
      out.errors.push({ scope: 'sigma', message: 'Не задан ни один ключ эпика-цели' });
      out.diagnostics.totalMs = Date.now() - t0;
      return out;
    }
    // 1) Resolve "Domain link" field id on Sigma.
    const domainFieldId = await sigmaResolveDomainLinkFieldId(cfg);
    if (!domainFieldId) {
      out.errors.push({ scope: 'sigma', message: 'Не удалось найти поле «Domain link» в Sigma (нужны права на /rest/api/2/field)' });
    }
    // 2) Fetch each goal in parallel (allSettled — partial results win).
    const goalResults = await Promise.allSettled(
      goalKeys.map(k => sigmaFetchGoal(cfg, k, domainFieldId))
    );
    const goals = goalResults.map((r, i) => r.status === 'fulfilled'
      ? r.value
      : { key: goalKeys[i], error: r.reason?.message || 'rejected' }
    );
    out.summary.totalGoals = goals.length;

    // 3) Resolve the configured Delta project list once — used to filter
    //    seed keys, expand JQL, and final coverage set.
    const deltaProjectKeys = String(cfg.jiraProjectKeys || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const projectPrefixes  = new Set(deltaProjectKeys);
    const inDeltaProjects  = (key) =>
      !projectPrefixes.size || projectPrefixes.has(String(key || '').split('-')[0]);
    const projectClause = deltaProjectKeys.length
      ? ` AND project in (${deltaProjectKeys.map(k => `"${k}"`).join(',')})`
      : '';

    // 3a) Collect SEED Delta keys — what's literally in Domain link on each
    //     goal, BUT filtered to delta-projects only. User-confirmed: keys
    //     from projects outside `cfg.jiraProjectKeys` are noise — they
    //     polluted goal.linkedIssues display ("задачи остальных команд тоже
    //     учитываются") AND seeded the expand BFS with irrelevant epics
    //     whose children were then chasing the project-clause filter for
    //     nothing. Drop them at intake.
    const seedDeltaKeysAll = new Set();
    for (const g of goals) for (const k of (g.domainLinks || [])) seedDeltaKeysAll.add(k);
    const seedDeltaKeys      = new Set([...seedDeltaKeysAll].filter(inDeltaProjects));
    const seedDroppedAtIntake = seedDeltaKeysAll.size - seedDeltaKeys.size;

    // 3b) Walk the Epic Link tree downward (story/task/bug under epics, up to
    //     4 levels deep; sub-tasks excluded). The `expandedDeltaKeys` superset
    //     is what we use to flag `linkedToGoal: true` in step 6 — so a story
    //     under an epic that's literally listed in Domain link counts as
    //     covered, even though only the epic key itself is on the goal.
    let expandedDeltaKeys = new Set(seedDeltaKeys);
    out.diagnostics.expand = {
      seedCountTotal:        seedDeltaKeysAll.size,    // raw keys in Domain link
      seedDroppedAtIntake,                              // outside delta-projects
      seedCount:             seedDeltaKeys.size,        // after delta-projects filter
      expandedCount:         seedDeltaKeys.size,
      levelsReached:         0,
      batches:               0,
      truncated:             false,
      exitReason:            'no-expand',
    };
    if (seedDeltaKeys.size && cfg.jiraBaseUrl && cfg.jiraToken) {
      try {
        // V13 (2026-04): retry/backoff hardening for 429 rate-limit storms.
        // Endpoint client timeout: 240s. Expand budget: 180s (was 35s).
        // Per-chunk jiraSearchAll budget: 90s (was 10s) — long enough for
        // jiraRequest's full 5-retry / 85s ladder to absorb sustained 429s.
        // Concurrency 2 (was 4) halves request pressure on Jira to PREVENT
        // 429s in the first place.
        // V13 (8th pass): added upfront cloners-support probe to avoid
        // burning expand-budget on 11 doomed cloners-attempts before
        // hitting the time-budget. Bumped budget 180s → 240s as belt-and-
        // braces for instances where larger seed sets legitimately need
        // more BFS work.
        const followCloners = !!cfg.followCloners;

        // ── Cloners-support probe ────────────────────────────────
        // ONE small JQL with `linkedIssues()` on a real seed. If Jira
        // returns 200 (even 0 results) — the function is supported and
        // we keep cloners-clause active. If it 400s — the function is
        // unrecognised on this Jira (common on Sber team-managed) — we
        // turn cloners off for the entire run, saving the wasted first
        // attempt × N chunks pattern that was burning ~55s last run.
        let effectiveFollowCloners = followCloners;
        let clonersProbeStatus = 'skipped';     // 'supported' | 'unsupported' | 'skipped' | 'probe-error'
        if (followCloners) {
          const sampleSeed = [...seedDeltaKeys][0];
          try {
            await jiraSearchAll(
              cfg,
              `issue in linkedIssues("${sampleSeed}", "Cloners")${projectClause}`,
              ['issuetype'], [], 1, 8000
            );
            clonersProbeStatus = 'supported';
          } catch (e) {
            const msg = e?.message || '';
            // 400 / unrecognised / parser error → unsupported. Retain the
            // flag for any other class of error (network, 5xx) so we don't
            // silently drop cloners on a transient blip.
            const looksUnsupported = e?.status === 400
              || /unrecognised|unrecognized|invalid|parse/i.test(msg);
            if (looksUnsupported) {
              effectiveFollowCloners = false;
              clonersProbeStatus = 'unsupported';
              console.warn(`[bd:probe] linkedIssues() not supported on this Jira: ${msg}. Disabling cloners.`);
            } else {
              clonersProbeStatus = 'probe-error';
              console.warn(`[bd:probe] cloners-probe inconclusive: ${msg}. Keeping cloners-flag as-is; expandIssueTree will adapt.`);
            }
          }
        }

        // ── Per-project parallel BFS ─────────────────────────────
        // V13 (8th pass, addendum): split seeds by project key and run a
        // separate `expandIssueTree` per project IN PARALLEL. Reasons:
        //   · Narrower JQL per project (`project = "X"` vs `project in (X,Y,Z)`)
        //     — Jira evaluates faster, smaller response payload.
        //   · Failure isolation — one project's 429-storm or JQL-quirk
        //     doesn't block the others.
        //   · Wall-clock speed-up — slowest project sets the floor instead
        //     of the sum.
        // Total in-flight requests against Delta Jira ≈ N projects × 1.
        // (Per-project chunkConcurrency lowered to 1 so we don't blow up
        // the rate limiter; with 3-5 typical delta projects, total ≈ 3-5
        // simultaneous which the shared 429 gate handles fine.)
        const seedsByProject = new Map();
        for (const k of seedDeltaKeys) {
          const pk = String(k).split('-')[0];
          if (!seedsByProject.has(pk)) seedsByProject.set(pk, []);
          seedsByProject.get(pk).push(k);
        }

        // Single-project shortcut: skip the parallel infrastructure to
        // keep the simple-case path identical to before.
        let result;
        // V17 P6 — multi-project fix: per-project time-budget bumped 240s → 600s,
        // search-budget 90s → 180s, multi-project chunkConcurrency 1 → 2.
        // User-side: «если несколько проектов — не по всем грузятся».
        // Audit 2026-05-V17 pt 6.
        if (seedsByProject.size <= 1) {
          result = await expandIssueTree({
            seedKeys:         [...seedDeltaKeys],
            searchByJql:      (jql) => jiraSearchAll(cfg, jql + projectClause, ['issuetype'], [], 5000, 180000),
            maxDepth:         4,
            maxKeys:          5000,
            timeBudgetMs:     600000,
            chunkConcurrency: 2,
            followCloners:    effectiveFollowCloners,
          });
        } else {
          const perProjectResults = await Promise.allSettled(
            [...seedsByProject.entries()].map(async ([pk, seeds]) => {
              const projectClauseLocal = ` AND project = "${pk}"`;
              const r = await expandIssueTree({
                seedKeys:         seeds,
                searchByJql:      (jql) => jiraSearchAll(cfg, jql + projectClauseLocal, ['issuetype'], [], 5000, 180000),
                maxDepth:         4,
                maxKeys:          5000,
                timeBudgetMs:     600000,
                chunkConcurrency: 2,    // was 1; corp Jira tolerates 2 from a single client
                followCloners:    effectiveFollowCloners,
              });
              return { pk, ...r };
            })
          );

          // Merge per-project results into a single `result` shape compatible
          // with the existing diagnostic codepath below. Truncated if ANY
          // project truncated; exitReason aggregated.
          const mergedKeys      = new Set(seedDeltaKeys);
          let mergedLevels      = 0;
          let mergedBatches     = 0;
          let mergedFellBack    = 0;
          const mergedChunkErrs = [];
          let mergedTruncated   = false;
          const exitReasons     = new Set();
          let anyClonersAutoDisabled = false;
          const perProjectSummary = [];

          for (const pr of perProjectResults) {
            if (pr.status === 'fulfilled') {
              const r = pr.value;
              for (const k of r.keys) mergedKeys.add(k);
              mergedLevels      = Math.max(mergedLevels, r.levels);
              mergedBatches    += r.batches;
              mergedFellBack   += r.fellBackNoCloners || 0;
              if (Array.isArray(r.chunkErrors)) mergedChunkErrs.push(...r.chunkErrors.map(e => ({ ...e, pk: r.pk })));
              if (r.truncated) mergedTruncated = true;
              if (r.clonersAutoDisabled) anyClonersAutoDisabled = true;
              exitReasons.add(r.exitReason);
              perProjectSummary.push({
                pk: r.pk, seedCount: seedsByProject.get(r.pk).length,
                expandedCount: r.keys.size, levels: r.levels, batches: r.batches,
                truncated: r.truncated, exitReason: r.exitReason,
                fellBackNoCloners: r.fellBackNoCloners || 0,
              });
            } else {
              const errMsg = pr.reason?.message || String(pr.reason || 'rejected');
              mergedChunkErrs.push({ level: 0, error: `project-failed: ${errMsg}` });
              mergedTruncated = true;
              exitReasons.add('project-error');
              perProjectSummary.push({ pk: '?', error: errMsg });
            }
          }

          // Prefer the most-severe exit reason for the top-level field.
          const exitReason = exitReasons.has('failures')      ? 'failures'
                           : exitReasons.has('time-budget')   ? 'time-budget'
                           : exitReasons.has('project-error') ? 'project-error'
                           : exitReasons.has('completed')     ? 'completed'
                           : [...exitReasons][0] || 'completed';

          result = {
            keys:               mergedKeys,
            levels:             mergedLevels,
            batches:            mergedBatches,
            truncated:          mergedTruncated,
            exitReason,
            chunkErrors:        mergedChunkErrs.slice(0, 20),
            fellBackNoCloners:  mergedFellBack,
            clonersAutoDisabled: anyClonersAutoDisabled,
            perProjectSummary,         // surfaced in diagnostics for transparency
            parallelProjects:   seedsByProject.size,
          };
        }
        expandedDeltaKeys = result.keys;
        // Post-filter: drop any seed key that's outside the configured Delta
        // projects (server-side filter only catches children, not seeds).
        if (deltaProjectKeys.length) {
          const before = expandedDeltaKeys.size;
          expandedDeltaKeys = new Set([...expandedDeltaKeys].filter(inDeltaProjects));
          out.diagnostics.expand.droppedOutOfDelta = before - expandedDeltaKeys.size;
        }
        out.diagnostics.expand = {
          seedCountTotal:        seedDeltaKeysAll.size,
          seedDroppedAtIntake,
          seedCount:             seedDeltaKeys.size,
          expandedCount:         expandedDeltaKeys.size,
          droppedOutOfDelta:     out.diagnostics.expand.droppedOutOfDelta || 0,
          levelsReached:         result.levels,
          batches:               result.batches,
          followCloners,
          effectiveFollowCloners,
          clonersProbeStatus,
          clonersAutoDisabled:   !!result.clonersAutoDisabled,
          fellBackNoCloners:     result.fellBackNoCloners || 0,
          parallelProjects:      result.parallelProjects || 1,
          perProjectSummary:     result.perProjectSummary || null,
          chunkErrors:           result.chunkErrors || [],
          truncated:             result.truncated,
          exitReason:            result.exitReason,
        };
        if (result.truncated) {
          // Surface the actual root-cause string (first chunk error) inline
          // in the error message — without it, "все JQL уровня упали" was
          // opaque and forced users to dig in server logs to debug.
          const firstErr = result.chunkErrors?.[0]?.error || '';
          const errSuffix = firstErr ? ` Причина: ${firstErr}.` : '';
          out.errors.push({
            scope:   'expand',
            message: `Раскрытие дерева задач прервано (${result.exitReason === 'time-budget' ? 'превышен бюджет 240с' : result.exitReason === 'failures' ? 'все JQL уровня упали' : 'cap по числу задач'}).${errSuffix} Покрытие посчитано по ${expandedDeltaKeys.size} ключам из частично раскрытого дерева.`,
          });
        }
      } catch (e) {
        // Helper itself shouldn't throw (try/catch inside), but belt-and-braces.
        out.errors.push({
          scope: 'expand',
          message: 'Не удалось раскрыть дерево задач: ' + (e?.message || String(e)) + '. Покрытие посчитано только по seed-ключам из Domain link.',
        });
        // Even fallback respects the project filter.
        expandedDeltaKeys = new Set([...seedDeltaKeys].filter(inDeltaProjects));
        out.diagnostics.expand.exitReason = 'thrown';
      }
    }

    // 3c) Detect "aggregator-epics" — seed keys that have NO structural
    //     children at all. These contribute only themselves to coverage and
    //     usually mean Domain link points at a reporting/aggregator epic,
    //     not a real work-epic. Surfacing this gives the user actionable
    //     signal: "rewrite Domain link to point at concrete work-epics".
    //     Skipped if expand failed or no seeds.
    out.diagnostics.childlessSeeds = { keys: [], probed: 0, partialResult: false };
    if (seedDeltaKeys.size && cfg.jiraBaseUrl && cfg.jiraToken) {
      try {
        const probe = await findChildlessSeeds({
          seedKeys:    [...seedDeltaKeys],
          // Per-seed mini-search: small payload (5 issues max), don't exclude
          // sub-tasks (we want ANY sign of children — sub-tasks count as
          // "has structure"). V13: per-probe budget 5s→60s and overall budget
          // 10s→90s so the probe can ride out 429 retries (jiraRequest now
          // waits up to ~85s on sustained rate-limit).
          searchByJql: (jql) => jiraSearchAll(cfg, jql + projectClause, ['issuetype'], [], 5, 60000),
          projectClause,
          concurrency: 2,
          timeBudgetMs: 90000,
        });
        out.diagnostics.childlessSeeds = probe;
      } catch (e) {
        // Don't surface a hard error — diagnostics is nice-to-have.
        console.warn('[bd] childless-seeds probe failed:', e?.message || e);
      }
    }

    // 4) Batch-resolve SEED keys from Delta (used by `goal.linkedIssues` —
    //    UI surface stays «what's literally in Domain link»).
    const deltaMap = await sigmaFetchDeltaIssuesByKeys(cfg, Array.from(seedDeltaKeys));

    // 5) Hydrate each goal with linked issue details. Filter the goal's
    //    `domainLinks` to delta-projects only — keys outside scope get a
    //    soft `outOfScope:true` flag so the UI can group/grey them, instead
    //    of mixing them with real issues. Also flag aggregator-epics with
    //    `isAggregator: true` so UI can show "no structural children" badge.
    const childlessSet = new Set(out.diagnostics.childlessSeeds.keys);
    for (const g of goals) {
      if (g.error) { out.goals.push(g); continue; }
      g.linkedIssues = (g.domainLinks || [])
        .filter(inDeltaProjects)
        .map(k => {
          const issue = deltaMap.get(k) || { key: k, notFound: true };
          if (childlessSet.has(k)) issue.isAggregator = true;
          return issue;
        });
      g.outOfScopeKeys = (g.domainLinks || []).filter(k => !inDeltaProjects(k));
      out.goals.push(g);
    }

    // 6) Build per-team unlinked split.
    //    V13 (7th pass) — broadened scope + new exclusion rules + per-type
    //    breakdown:
    //
    //      a) Fetch ALL issue types in delta projects (was Epic+Story only).
    //         Need stories/tasks/bugs/sub-tasks to compute children of each
    //         epic. Sub-tasks were previously excluded from coverage at the
    //         flag level — they still are, but they DO count as evidence
    //         that an epic has children.
    //
    //      b) Resolve Delta's Epic Link custom field id (best-effort; may
    //         return ''). With it, we catch classic-Jira children whose
    //         link is via Epic Link rather than `parent`.
    //
    //      c) Build epic → [children] map from `parent` and Epic Link.
    //
    //      d) Apply exclusion rules per epic:
    //           · No children at all      → excludedReason: 'no-children'
    //           · All children in `new`   → excludedReason: 'all-new-status'
    //         Excluded epics drop from team.total / linked. Their excluded
    //         children also drop. Reason is surfaced on the issue object so
    //         the UI can grey-render with a tooltip.
    //
    //      e) Per-team `byType` aggregation: { Epic, Story, Task, Bug,
    //         'Sub-task' } → { total, linked, excluded } for the Coverage tab.
    if (deltaProjectKeys.length && cfg.jiraBaseUrl && cfg.jiraToken) {
      try {
        // (b) Best-effort Epic Link field discovery.
        const deltaEpicLinkFieldId = await deltaResolveEpicLinkFieldId(cfg);

        // V13 (13th pass): compute the global "quarter cutoff" from goals'
        // Fix Version/s. Any Story/Task in `Done` resolved BEFORE this
        // cutoff is considered pre-quarter work and excluded from coverage.
        // We pick the EARLIEST goal-quarter (most permissive) — tasks done
        // before that earliest quarter are clearly old work for ALL goals.
        // If no goal has a parsable quarter version, the rule is silently
        // disabled (`globalQuarterCutoff = null`).
        const goalQuarterStarts = [];
        const perGoalQuarter = {};       // for diagnostics: { goalKey: 'YYYY-MM-DD' or 'no-version' }
        for (const g of goals) {
          if (g.error) continue;
          const versions = Array.isArray(g.fixVersions) ? g.fixVersions : [];
          let earliest = null;
          for (const v of versions) {
            const d = _parseQuarterStart(v);
            if (d && (!earliest || d < earliest)) earliest = d;
          }
          if (earliest) {
            goalQuarterStarts.push(earliest);
            perGoalQuarter[g.key] = earliest.toISOString().slice(0, 10);
          } else {
            perGoalQuarter[g.key] = versions.length ? `no-quarter-in:${versions.join('|')}` : 'no-version';
          }
        }
        const globalQuarterCutoff = goalQuarterStarts.length
          ? new Date(Math.min(...goalQuarterStarts.map(d => d.getTime())))
          : null;

        // (a) Broadened fetch — include every issue type that can be a child.
        // Also include `resolutiondate` for the «done-before-quarter» rule.
        const fields = ['summary', 'status', 'issuetype', 'project', 'parent', 'resolutiondate'];
        if (deltaEpicLinkFieldId) fields.push(deltaEpicLinkFieldId);
        const jql = `project in (${deltaProjectKeys.map(k => `"${k}"`).join(',')})`;
        // 120s budget (was 60s) — matches the V13 retry-tolerant policy.
        // jiraRequest now waits up to ~85s on sustained 429; coverage scan
        // pages through up to 5000 issues, so generous budget is needed.
        const issues = await jiraSearchAll(cfg, jql, fields, [], 5000, 120000);

        // ── V13 (10th pass): typed-exclusion rules ──────────────
        // User-defined "should-not-count-toward-coverage" issuetypes,
        // statuses, and (type, status) pairs. Defaults match the user's
        // 10-rule list:
        //   1-2. Story/Task with status `Cancelled`
        //   3-5,8-10. Bug, Change Request, Ops Task, "Задача на утверждение
        //            ППСИ", Introduction Order, UX Research issue types
        //   6-7. Statuses "Release 2.0" / "Release UAT Approval"
        // Override via `cfg.bdExclusions = { excludedTypes, excludedStatuses,
        // excludedTypeStatusPairs }` in jira_config.json. All matching is
        // case-insensitive; whitespace is tolerated.
        const EX_DEFAULTS = {
          excludedTypes: [
            // п.3-5, 8-10
            'Bug', 'Change Request', 'Ops Task',
            'Задача на утверждение ППСИ', 'Introduction Order', 'UX Research',
            // п.6-7 — это тоже типы задач, не статусы (исправлено по уточнению пользователя).
            'Release 2.0', 'Release UAT Approval',
            // Sub-tasks тоже исключаем из покрытия. Раньше они отсекались
            // отдельным early-continue в агрегаторе (легаси), теперь идут
            // через единый rule:type-путь и попадают в diagnostics/UI как
            // обычные исключения. Указываем оба варианта написания —
            // на разных Jira встречаются и `Sub-task`, и `Subtask`.
            'Sub-task', 'Subtask',
          ],
          excludedStatuses: [
            // На текущий момент чистых "по-статусу" правил нет — все
            // статус-зависимые исключения идут через type+status пары ниже.
          ],
          excludedTypeStatusPairs: [
            // п.1-2
            { type: 'Story', status: 'Cancelled' },
            { type: 'Task',  status: 'Cancelled' },
            // Task в статусе To Do — задача в начале воронки, ещё не
            // подтверждена и не запланирована, не должна снижать покрытие.
            { type: 'Task',  status: 'To Do' },
          ],
        };
        const exCfg     = cfg.bdExclusions || {};
        const exTypes   = (Array.isArray(exCfg.excludedTypes)            ? exCfg.excludedTypes            : EX_DEFAULTS.excludedTypes).map(s => String(s || '').trim().toLowerCase()).filter(Boolean);
        const exStatuses= (Array.isArray(exCfg.excludedStatuses)         ? exCfg.excludedStatuses         : EX_DEFAULTS.excludedStatuses).map(s => String(s || '').trim().toLowerCase()).filter(Boolean);
        const exPairs   = (Array.isArray(exCfg.excludedTypeStatusPairs)  ? exCfg.excludedTypeStatusPairs  : EX_DEFAULTS.excludedTypeStatusPairs)
                            .map(p => ({ type: String(p?.type || '').trim().toLowerCase(), status: String(p?.status || '').trim().toLowerCase() }))
                            .filter(p => p.type && p.status);

        function classifyByRules(typeName, statusName, statusCat, resolutionDateStr) {
          const tL = String(typeName || '').trim().toLowerCase();
          const sL = String(statusName || '').trim().toLowerCase();
          // Type+status pairs first (more specific than plain type/status).
          for (const p of exPairs) {
            if (p.type === tL && p.status === sL) return { excluded: true, reason: `rule:cancelled:${typeName}`, ruleKey: `pair:${typeName}:${statusName}` };
          }
          if (exTypes.includes(tL))     return { excluded: true, reason: `rule:type:${typeName}`,     ruleKey: `type:${typeName}` };
          if (exStatuses.includes(sL))  return { excluded: true, reason: `rule:status:${statusName}`, ruleKey: `status:${statusName}` };
          // V13 (13th pass): «done before goal's quarter» rule. Applies to
          // Story / Task / equivalents in `done` statusCategory whose
          // `resolutiondate` is strictly EARLIER than the earliest goal-quarter
          // start. The set of types this rule applies to is intentionally
          // narrow — we don't want to retroactively exclude ancient closed
          // bugs (which are already excluded by the type-rule above) or
          // sub-tasks (also already excluded). Stories and Tasks are the
          // typical "real work" carriers.
          const PRE_QUARTER_TYPES = new Set(['story', 'task']);
          if (globalQuarterCutoff
              && statusCat === 'done'
              && PRE_QUARTER_TYPES.has(tL)
              && resolutionDateStr) {
            const resolved = new Date(resolutionDateStr);
            if (!isNaN(resolved) && resolved < globalQuarterCutoff) {
              return {
                excluded: true,
                reason:   `rule:done-before-quarter:${resolutionDateStr.slice(0,10)}`,
                ruleKey:  'done-before-quarter',
              };
            }
          }
          return { excluded: false, reason: '', ruleKey: '' };
        }

        // (c) Two passes:
        //   Pass 1: index ALL issues by key + collect epic keys + classify
        //           by rules (typed exclusions stick to the issue).
        //   Pass 2: for every non-epic issue, link it to its parent epic
        //           via parent.key OR Epic Link → build children-of-epic map.
        const allByKey = new Map();
        const epicKeys = new Set();
        // Track typed-exclusion counts per rule for diagnostics surface.
        const excludedByRule = {};
        for (const it of issues) {
          allByKey.set(it.key, it);
          const tName = (it.fields?.issuetype?.name || '').toLowerCase();
          if (tName === 'epic') epicKeys.add(it.key);
          // Classify and stash on the issue object — used in pass 2 + aggregate.
          const cls = classifyByRules(
            it.fields?.issuetype?.name,
            it.fields?.status?.name,
            _statusCatBucket(it.fields?.status?.statusCategory?.key),
            it.fields?.resolutiondate
          );
          it._typedExcluded = cls.excluded;
          it._typedExcludedReason = cls.reason;
          it._typedExcludedRuleKey = cls.ruleKey;
          if (cls.excluded) excludedByRule[cls.ruleKey] = (excludedByRule[cls.ruleKey] || 0) + 1;
        }
        const childrenByEpic = new Map();    // epicKey → [childIssue, ...]
        const epicOfChild   = new Map();     // childKey → epicKey  (first wins)
        for (const it of issues) {
          const tName = (it.fields?.issuetype?.name || '').toLowerCase();
          if (tName === 'epic') continue;
          let epicKey = '';
          // a) Modern team-managed: parent points at the epic directly.
          const parentKey = it.fields?.parent?.key || '';
          if (parentKey && epicKeys.has(parentKey)) epicKey = parentKey;
          // b) Classic Jira: Epic Link custom field → epic key string.
          if (!epicKey && deltaEpicLinkFieldId) {
            const linkVal = it.fields?.[deltaEpicLinkFieldId];
            const linkKey = typeof linkVal === 'string' ? linkVal : (linkVal?.key || '');
            if (linkKey && epicKeys.has(linkKey)) epicKey = linkKey;
          }
          if (!epicKey) continue;
          if (!childrenByEpic.has(epicKey)) childrenByEpic.set(epicKey, []);
          childrenByEpic.get(epicKey).push(it);
          epicOfChild.set(it.key, epicKey);
        }

        // (d) Decide exclusion per epic.
        // Normalised status — `new` bucket means "not in active/done backlog".
        // V13 (10th pass): when computing "all children in new", consider
        // ONLY children NOT excluded by type/status rules. Reason: a rule-
        // excluded child (e.g., a Bug) should not "rescue" an epic whose
        // remaining (real, non-excluded) children are all in the To Do
        // bucket — that epic is still a provisional one.
        // New reason: 'all-children-excluded' — all children excluded by
        // rule, treated as effectively no-children.
        const epicExclusion = new Map();   // epicKey → { excluded, reason, childCount, activeChildCount }
        for (const ek of epicKeys) {
          const kids = childrenByEpic.get(ek) || [];
          const activeKids = kids.filter(c => !c._typedExcluded);
          if (kids.length === 0) {
            epicExclusion.set(ek, { excluded: true, reason: 'no-children', childCount: 0, activeChildCount: 0 });
            continue;
          }
          if (activeKids.length === 0) {
            // Children exist but all of them are excluded by typed rules.
            epicExclusion.set(ek, { excluded: true, reason: 'all-children-excluded', childCount: kids.length, activeChildCount: 0 });
            continue;
          }
          const allNew = activeKids.every(c =>
            _statusCatBucket(c.fields?.status?.statusCategory?.key) === 'new'
          );
          if (allNew) {
            epicExclusion.set(ek, { excluded: true, reason: 'all-new-status', childCount: kids.length, activeChildCount: activeKids.length });
          } else {
            epicExclusion.set(ek, { excluded: false, reason: '', childCount: kids.length, activeChildCount: activeKids.length });
          }
        }

        // (e) Aggregate by team. We DO render every issue (excluded ones
        // get the flag), but excluded ones don't count toward total/linked.
        const byPk = new Map();
        const ensureTeam = (pk, name) => {
          if (!byPk.has(pk)) byPk.set(pk, {
            pk, name: name || pk,
            total: 0, linked: 0, excluded: 0, issues: [],
            // V13: per-type breakdown for the Покрытие tab. Structure
            // matches what the renderer expects — `byType[name] = {total, linked, excluded}`.
            byType: {},
          });
          return byPk.get(pk);
        };
        for (const pk of deltaProjectKeys) ensureTeam(pk, pk);

        for (const it of issues) {
          const pk = it.fields?.project?.key || (it.key || '').split('-')[0];
          const team = ensureTeam(pk, it.fields?.project?.name || pk);
          if (it.fields?.project?.name) team.name = it.fields.project.name;

          const tName  = it.fields?.issuetype?.name || '';
          const tLower = tName.toLowerCase();
          const isEpic = tLower === 'epic';

          // V13 (10th pass) priority order:
          //   1. Typed exclusion (rule:type / rule:status / rule:cancelled)
          //      — applies to the issue ITSELF, regardless of whether it's
          //      a child of some other epic. Most specific reason wins.
          //   2. Epic-children exclusion (no-children / all-new-status /
          //      all-children-excluded) for epics.
          //   3. Inherited from parent epic (parent-epic-<reason>) for non-epics.
          let excluded = false;
          let excludedReason = '';
          let childCount = 0;
          if (it._typedExcluded) {
            excluded = true;
            excludedReason = it._typedExcludedReason;
          } else if (isEpic) {
            const ex = epicExclusion.get(it.key);
            if (ex) {
              excluded = ex.excluded;
              excludedReason = ex.reason;
              childCount = ex.childCount;
            }
          } else {
            const parentEpic = epicOfChild.get(it.key);
            const ex = parentEpic ? epicExclusion.get(parentEpic) : null;
            if (ex && ex.excluded) {
              excluded = true;
              excludedReason = `parent-epic-${ex.reason}`;
            }
          }

          const slim = {
            key:       it.key,
            summary:   it.fields?.summary || '',
            status:    it.fields?.status?.name || '',
            statusCat: _statusCatBucket(it.fields?.status?.statusCategory?.key),
            type:      tName,
            pk,
            // Use the EXPANDED set: covers stories/tasks/bugs whose Epic Link
            // points at an epic that's literally in Domain link.
            linkedToGoal: expandedDeltaKeys.has(it.key),
            // V13 (7th pass) — exclusion metadata.
            excluded,
            excludedReason,
            ...(isEpic ? { childCount } : {}),
          };
          team.issues.push(slim);

          // V13 (10th pass, follow-up): legacy `if (isSubTask) continue`
          // removed. Sub-tasks now flow through the standard excluded-by-
          // rule path (added to excludedTypes defaults) so they show up in
          // diagnostics + the «Исключено из покрытия» section consistently
          // with all other type-excluded issues.

          if (excluded) {
            team.excluded++;
            continue;
          }
          team.total++;
          if (slim.linkedToGoal) team.linked++;

          // Per-type breakdown (excluded issues skipped — same rule as above).
          // V13 (8th pass): added statusCat aggregate ({done, wip, todo}) and
          // an `exampleKey` so the UI can deep-link one issue per type for
          // a quick spot-check. Example prefers a LINKED-to-goal issue (more
          // useful for the user) and falls back to the first encountered.
          const t = team.byType[tName] || (team.byType[tName] = {
            total: 0, linked: 0, excluded: 0,
            statuses: { done: 0, wip: 0, todo: 0 },
            // V13 (9th pass): detailed per-status-NAME breakdown. The bucketed
            // {done,wip,todo} loses fidelity — user wants to see "Code Review:
            // 5, In Testing: 3, Ready for Release: 2" etc. Stored as
            //   { '<status name>': { count, cat } }
            // where cat is the statusCategory bucket so the renderer can
            // colour each pill by category. Excluded issues are NOT counted
            // here (same rule as `total`/`linked`).
            statusDetail: {},
            exampleKey: '', exampleSummary: '', exampleStatus: '', exampleStatusCat: '', exampleLinked: false,
          });
          t.total++;
          if (slim.linkedToGoal) t.linked++;
          // Status bucket: 'done' | 'indeterminate' (wip) | 'new' (todo).
          if (slim.statusCat === 'done')              t.statuses.done++;
          else if (slim.statusCat === 'indeterminate') t.statuses.wip++;
          else                                         t.statuses.todo++;
          // Detailed per-name aggregate.
          const stName = slim.status || '—';
          if (!t.statusDetail[stName]) t.statusDetail[stName] = { count: 0, cat: slim.statusCat || 'new' };
          t.statusDetail[stName].count++;

          // Pick example: prefer first LINKED-to-goal issue (showcases coverage);
          // otherwise first encountered. Skip if we already have a linked example.
          const haveLinkedExample = t.exampleKey && t.exampleLinked;
          if (!haveLinkedExample && (slim.linkedToGoal || !t.exampleKey)) {
            t.exampleKey       = slim.key;
            t.exampleSummary   = slim.summary;
            t.exampleStatus    = slim.status;
            t.exampleStatusCat = slim.statusCat;
            t.exampleLinked    = !!slim.linkedToGoal;
          }
        }

        // Roll excluded counters into byType too, for renderer transparency.
        for (const team of byPk.values()) {
          for (const it of team.issues) {
            if (!it.excluded) continue;
            const tn = it.type || '—';
            const t = team.byType[tn] || (team.byType[tn] = {
              total: 0, linked: 0, excluded: 0,
              statuses: { done: 0, wip: 0, todo: 0 },
              statusDetail: {},
              exampleKey: '', exampleSummary: '', exampleStatus: '', exampleStatusCat: '', exampleLinked: false,
            });
            t.excluded++;
          }
        }

        out.teamIssues = Array.from(byPk.values()).sort((a, b) => b.total - a.total);
        for (const team of out.teamIssues) {
          out.summary.linkedCount   += team.linked;
          out.summary.unlinkedCount += (team.total - team.linked);
        }
        const denom = out.summary.linkedCount + out.summary.unlinkedCount;
        out.summary.coveragePct = denom ? Math.round(out.summary.linkedCount / denom * 100) : 0;

        // Diagnostics: how many epics dropped via each rule, for transparency.
        let exNoChildren = 0, exAllNew = 0, exAllChildrenExcluded = 0;
        for (const v of epicExclusion.values()) {
          if (!v.excluded) continue;
          if (v.reason === 'no-children')             exNoChildren++;
          else if (v.reason === 'all-new-status')     exAllNew++;
          else if (v.reason === 'all-children-excluded') exAllChildrenExcluded++;
        }
        // Sort rule counts DESC for readability.
        const sortedExcludedByRule = Object.fromEntries(
          Object.entries(excludedByRule).sort((a, b) => b[1] - a[1])
        );
        out.diagnostics.coverage = {
          deltaEpicLinkFieldId: deltaEpicLinkFieldId || '(not found)',
          totalIssuesScanned:   issues.length,
          totalEpicsScanned:    epicKeys.size,
          excludedEpicsNoChildren:        exNoChildren,
          excludedEpicsAllNewStatus:      exAllNew,
          excludedEpicsAllChildrenExcluded: exAllChildrenExcluded,
          // V13 (10th pass): per-rule counts for typed exclusions.
          excludedByRule: sortedExcludedByRule,
          activeRules: {
            excludedTypes:    exTypes,
            excludedStatuses: exStatuses,
            excludedTypeStatusPairs: exPairs,
          },
          // V13 (13th pass): per-goal Fix Version/s parse + the global
          // cutoff used by «done-before-quarter» rule.
          quarterCutoff:   globalQuarterCutoff ? globalQuarterCutoff.toISOString().slice(0, 10) : null,
          perGoalQuarter,
        };
      } catch (e) {
        out.errors.push({ scope: 'delta', message: e.message || String(e) });
      }
    } else {
      out.errors.push({ scope: 'delta', message: 'Delta Jira не настроена — покрытие по командам не построено' });
    }

    out.diagnostics.totalMs = Date.now() - t0;
    return out;
  }

  return { buildBlackDashboard, sigmaCfgView };
}

module.exports = { createBlackDashboard, expandIssueTree, findChildlessSeeds };
