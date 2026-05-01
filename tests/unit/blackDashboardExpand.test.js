'use strict';
/* ============================================================
   tests/unit/blackDashboardExpand.test.js
   --
   Tests for `expandIssueTree` — the BFS over the Epic Link
   parent/child tree used by Чёрный дашборд.

   Property tested via mocked `searchByJql`:
     · seed-only when no children
     · one-level expansion (epic → its stories/tasks/bugs)
     · multi-level traversal honours `maxDepth`
     · `maxKeys` cap stops growth even mid-level
     · cycle protection via internal `seen` set (no infinite loops
       even when the mock keeps returning the same key)
     · sub-tasks excluded — verified via the JQL the helper emits
     · empty seed → empty result, zero JQL calls
     · chunked at 200 keys per JQL — verified via batch counter
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { expandIssueTree, findChildlessSeeds } = require('../../server/integrations/blackDashboard.js');

/** Build a `searchByJql` fake from a static map: `{ parentKey: [child keys...] }`.
 *  Returns the union of `rules[parent]` for every parent the helper is
 *  currently asking about (matched as `"PARENT"` quoted-substring so
 *  "DELTA-1" doesn't accidentally match "DELTA-10"). Records every JQL call
 *  so tests can introspect what was sent. */
function makeFakeSearch(rules = {}) {
  const calls = [];
  const search = async (jql) => {
    calls.push(jql);
    const found = new Set();
    for (const [parent, keys] of Object.entries(rules)) {
      if (jql.includes(`"${parent}"`)) {
        for (const k of keys) found.add(k);
      }
    }
    return [...found].map(k => ({ key: k }));
  };
  return { search, calls };
}

describe('expandIssueTree — basic shape', () => {
  test('empty seed → returns empty set, no JQL calls', async () => {
    const { search, calls } = makeFakeSearch();
    const result = await expandIssueTree({ seedKeys: [], searchByJql: search });
    assert.equal(result.keys.size, 0);
    assert.equal(result.levels, 0);
    assert.equal(result.batches, 0);
    assert.equal(calls.length, 0);
  });

  test('searchByJql not a function → returns seed verbatim, no calls', async () => {
    const result = await expandIssueTree({ seedKeys: ['DELTA-1'], searchByJql: null });
    assert.equal(result.keys.size, 1);
    assert.ok(result.keys.has('DELTA-1'));
    assert.equal(result.levels, 0);
    assert.equal(result.batches, 0);
  });

  test('seed with no children → keys = seed, levels stops at 1', async () => {
    // Mock returns nothing for any JQL.
    const { search, calls } = makeFakeSearch({});
    const result = await expandIssueTree({
      seedKeys: ['DELTA-1', 'DELTA-2'],
      searchByJql: search,
    });
    assert.equal(result.keys.size, 2);
    assert.ok(result.keys.has('DELTA-1') && result.keys.has('DELTA-2'));
    assert.equal(result.levels, 1, 'one search attempt was made before exit');
    assert.equal(calls.length, 1, 'one chunked JQL call');
  });
});

describe('expandIssueTree — tree traversal', () => {
  test('one-level: epic → 3 stories', async () => {
    const { search } = makeFakeSearch({
      'DELTA-1': ['DELTA-10', 'DELTA-11', 'DELTA-12'],
    });
    const result = await expandIssueTree({
      seedKeys: ['DELTA-1'],
      searchByJql: search,
    });
    assert.equal(result.keys.size, 4);   // seed + 3 children
    for (const k of ['DELTA-1','DELTA-10','DELTA-11','DELTA-12']) {
      assert.ok(result.keys.has(k), `missing ${k}`);
    }
  });

  test('two-level: epic → story → grandchild (rare but supported)', async () => {
    const { search, calls } = makeFakeSearch({
      'DELTA-1': ['DELTA-10'],     // epic → story
      'DELTA-10': ['DELTA-100'],   // story → ??? (would only happen if
                                   // a story were itself an Epic Link target,
                                   // unusual but the helper should handle it)
    });
    const result = await expandIssueTree({
      seedKeys: ['DELTA-1'],
      searchByJql: search,
      maxDepth: 4,
    });
    assert.equal(result.keys.size, 3);
    assert.ok(result.keys.has('DELTA-100'));
    assert.equal(result.levels, 3, 'level 1 (epic→story), 2 (story→grandchild), 3 (grandchild→nothing)');
    assert.ok(calls.length >= 2);
  });

  test('respects maxDepth=1', async () => {
    const { search, calls } = makeFakeSearch({
      'DELTA-1': ['DELTA-10'],
      'DELTA-10': ['DELTA-100'],   // would be picked up if depth allowed
    });
    const result = await expandIssueTree({
      seedKeys: ['DELTA-1'],
      searchByJql: search,
      maxDepth: 1,
    });
    assert.equal(result.keys.size, 2, 'epic + one level');
    assert.ok(result.keys.has('DELTA-10'));
    assert.ok(!result.keys.has('DELTA-100'), 'level 2 must not be reached');
    assert.equal(result.levels, 1);
    assert.equal(calls.length, 1);
  });
});

describe('expandIssueTree — safety nets', () => {
  test('cycle protection: returning seed key as child does not loop', async () => {
    const { search, calls } = makeFakeSearch({
      'DELTA-1': ['DELTA-1', 'DELTA-2'],   // self-reference
      'DELTA-2': ['DELTA-1'],               // back-edge
    });
    const result = await expandIssueTree({
      seedKeys: ['DELTA-1'],
      searchByJql: search,
      maxDepth: 4,
    });
    assert.equal(result.keys.size, 2, 'no duplicates, no infinite growth');
    assert.ok(result.keys.has('DELTA-1') && result.keys.has('DELTA-2'));
    assert.ok(calls.length <= 4, 'must terminate within maxDepth, not loop');
  });

  test('maxKeys cap halts growth even when more children exist', async () => {
    const { search } = makeFakeSearch({
      'DELTA-1': ['D-10', 'D-11', 'D-12', 'D-13', 'D-14', 'D-15'],
    });
    const result = await expandIssueTree({
      seedKeys: ['DELTA-1'],
      searchByJql: search,
      maxKeys: 3,
    });
    assert.equal(result.keys.size, 3, 'capped at 3');
    assert.ok(result.keys.has('DELTA-1'));
  });

  test('searchByJql throws → caught, traversal continues with what it has', async () => {
    let calls = 0;
    const search = async (_jql) => {
      calls++;
      throw new Error('Jira 503');
    };
    // V13: tight timeBudgetMs disables the level-retry path (30s pause
    // would exceed budget) — keeps this assertion about "errors swallowed,
    // seeds returned unchanged" deterministic and fast.
    const result = await expandIssueTree({
      seedKeys: ['DELTA-1', 'DELTA-2'],
      searchByJql: search,
      maxDepth: 4,
      timeBudgetMs: 1000,
    });
    // Errors are warned-and-swallowed; helper returns seed unchanged.
    assert.equal(result.keys.size, 2);
    assert.ok(result.keys.has('DELTA-1') && result.keys.has('DELTA-2'));
    assert.ok(calls >= 1);
  });
});

describe('expandIssueTree — graceful degradation (timeout / failures)', () => {
  test('time-budget exceeded → exits early with truncated:true', async () => {
    // Slow search: each call takes 50ms. With budget=80ms and ~5 chunks
    // we expect early exit after the first or second batch.
    const slowSearch = async (jql) => {
      await new Promise(r => setTimeout(r, 50));
      // Each parent yields 200 fresh children → forces a deeper level.
      const m = jql.match(/"DELTA-(\d+)"/);
      const seed = m ? Number(m[1]) : 0;
      return Array.from({ length: 200 }, (_, i) => ({ key: `DELTA-${seed * 1000 + i + 1}` }));
    };
    const result = await expandIssueTree({
      seedKeys: ['DELTA-1', 'DELTA-2'],
      searchByJql: slowSearch,
      maxDepth: 4,
      timeBudgetMs: 80,
    });
    assert.equal(result.truncated, true);
    assert.equal(result.exitReason, 'time-budget');
    assert.ok(result.keys.size > 2, 'some children were collected before budget ran out');
  });

  test('all-fail level triggers exitReason:failures', async () => {
    // Multi-chunk frontier so we exercise the parallel-chunk path.
    const seedKeys = [];
    for (let i = 1; i <= 600; i++) seedKeys.push(`DELTA-${i}`);
    let calls = 0;
    const alwaysFail = async (_jql) => {
      calls++;
      throw new Error('Jira 503');
    };
    // V13: expandIssueTree now waits 30s and retries the level once on
    // all-fail. Pass a tight timeBudgetMs so the retry path is skipped
    // (elapsed + 30s pause would exceed budget) → exits on first all-fail.
    const result = await expandIssueTree({
      seedKeys,
      searchByJql: alwaysFail,
      timeBudgetMs: 1000,
    });
    assert.equal(result.truncated, true);
    assert.equal(result.exitReason, 'failures');
    // 600 seeds → 3 chunks. With concurrency=2 (V13 default), 3 chunks all
    // get attempted at level 1. After ALL fail and budget too tight for the
    // 30s retry-pause, BFS exits.
    assert.equal(calls, 3, `every level-1 chunk attempted exactly once, got ${calls}`);
  });

  test('all-fail level retries once after pause when budget allows', async () => {
    // With sufficient budget, expandIssueTree should retry the failed
    // level once after a 30s pause. We test deterministically by stubbing
    // the pause to 0ms via fake timers.
    const seedKeys = [];
    for (let i = 1; i <= 600; i++) seedKeys.push(`DELTA-${i}`);
    let calls = 0;
    const alwaysFail = async (_jql) => {
      calls++;
      throw new Error('Jira 429 rate limit');
    };
    // Stub setTimeout to fire immediately so the 30s level-retry pause
    // doesn't actually slow the test down. (jiraRequest's own retries
    // aren't involved — alwaysFail throws directly without going through
    // the proxy.)
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn, _ms) => realSetTimeout(fn, 0);
    try {
      const result = await expandIssueTree({
        seedKeys,
        searchByJql: alwaysFail,
        timeBudgetMs: 600000, // generous — allows the retry
      });
      assert.equal(result.exitReason, 'failures');
      // First pass: 3 chunks all fail → retry pending.
      // Second pass (same level): 3 chunks all fail again → give up.
      // Total: 6 calls.
      assert.equal(calls, 6, `level retried once after all-fail, expected 6 calls, got ${calls}`);
    } finally {
      global.setTimeout = realSetTimeout;
    }
  });

  test('partial failures (some chunks fail) keep going with what succeeded', async () => {
    // 3 chunks on level 1: chunks 1 + 3 succeed, chunk 2 fails.
    let chunkN = 0;
    const seedKeys = [];
    for (let i = 1; i <= 600; i++) seedKeys.push(`DELTA-${i}`);
    const flaky = async (jql) => {
      chunkN++;
      // Fail only the chunk containing DELTA-300 (the middle 200 keys).
      if (jql.includes('"DELTA-300"')) throw new Error('flaky');
      // Otherwise return one fresh child per request.
      const m = jql.match(/"DELTA-(\d+)"/);
      const seed = m ? Number(m[1]) : 0;
      return [{ key: `CHILD-${seed}` }];
    };
    const result = await expandIssueTree({ seedKeys, searchByJql: flaky });
    assert.notEqual(result.exitReason, 'failures', 'partial failures should not trip exit');
    assert.ok(result.keys.size > seedKeys.length, 'we got SOME children from successful chunks');
    assert.ok(chunkN >= 3, 'all chunks were attempted');
  });

  test('truncated:false for normal completion', async () => {
    const { search } = makeFakeSearch({});
    const result = await expandIssueTree({
      seedKeys: ['DELTA-1'],
      searchByJql: search,
    });
    assert.equal(result.truncated, false);
    assert.equal(result.exitReason, 'completed');
  });

  test('truncated:true when maxKeys cap saturates', async () => {
    const { search } = makeFakeSearch({
      'DELTA-1': ['D-10', 'D-11', 'D-12', 'D-13', 'D-14'],
    });
    const result = await expandIssueTree({
      seedKeys: ['DELTA-1'],
      searchByJql: search,
      maxKeys: 3,
    });
    assert.equal(result.truncated, true);
    // exitReason is 'completed' because we exited the loop normally — but
    // the size constraint flips truncated. This split lets the dashboard
    // distinguish "ran out of time" from "had way more data than we'd show".
  });

});

describe('expandIssueTree — JQL shape', () => {
  test('emitted JQL excludes Sub-task issuetype', async () => {
    const { search, calls } = makeFakeSearch({});
    await expandIssueTree({
      seedKeys: ['DELTA-1', 'DELTA-2'],
      searchByJql: search,
    });
    assert.equal(calls.length, 1);
    // Dual-path: covers both old-style "Epic Link" AND new-style parent.
    // After Sber's team-managed migration, half of an epic's children
    // moved to `parent` while the other half stayed on Epic Link — only
    // querying both fields catches everyone.
    assert.match(calls[0], /"Epic Link" in/, 'queries Epic Link field for old-style hierarchy');
    assert.match(calls[0], /parent in/, 'queries parent field for new-style hierarchy');
    assert.match(calls[0], /issuetype != Sub-task/, 'excludes sub-tasks per requirement');
    assert.match(calls[0], /"DELTA-1"/, 'includes the seed keys');
    assert.match(calls[0], /"DELTA-2"/);
  });

  test('chunks frontier at 200 keys per JQL', async () => {
    const seedKeys = [];
    for (let i = 1; i <= 350; i++) seedKeys.push(`DELTA-${i}`);
    const { search, calls } = makeFakeSearch({});
    await expandIssueTree({ seedKeys, searchByJql: search });
    // 350 keys → ceil(350/200) = 2 chunks → 2 JQL calls at level 1.
    assert.equal(calls.length, 2);
    // First chunk has the first 200 keys; second has the rest.
    assert.match(calls[0], /"DELTA-1"/);
    assert.match(calls[0], /"DELTA-200"/);
    assert.match(calls[1], /"DELTA-201"/);
    assert.match(calls[1], /"DELTA-350"/);
  });

  test('reports `batches` count = total JQL calls across all levels', async () => {
    const { search } = makeFakeSearch({
      'DELTA-1': ['DELTA-10'],
      'DELTA-10': [],
    });
    const result = await expandIssueTree({
      seedKeys: ['DELTA-1'],
      searchByJql: search,
      maxDepth: 4,
    });
    // Level 1: 1 batch (DELTA-1 chunk). Level 2: 1 batch (DELTA-10 chunk).
    assert.equal(result.batches, 2);
  });
});

// ──────────────────────────────────────────────────────────────────────
// followCloners — opt-in 3rd path through [Cloners] issue links (epics
// only). Sber's SMEAM team uses Cloners to chain quarterly epic versions;
// without this flag, those clone-chains are invisible to coverage.
// ──────────────────────────────────────────────────────────────────────

describe('expandIssueTree — followCloners flag', () => {
  test('default (off): JQL has no linkedIssues clause', async () => {
    const { search, calls } = makeFakeSearch({});
    await expandIssueTree({
      seedKeys: ['DELTA-1'],
      searchByJql: search,
    });
    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0], /linkedIssues/, 'no Cloners path by default');
  });

  test('on: JQL adds (issuetype = Epic AND issue in linkedIssues(...) clauses', async () => {
    const { search, calls } = makeFakeSearch({});
    await expandIssueTree({
      seedKeys: ['DELTA-1', 'DELTA-2'],
      searchByJql: search,
      followCloners: true,
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /linkedIssues\("DELTA-1", "Cloners"\)/);
    assert.match(calls[0], /linkedIssues\("DELTA-2", "Cloners"\)/);
    // Cloners-clause must be epic-restricted (avoids pulling random duplicates)
    assert.match(calls[0], /issuetype = Epic AND \(/);
    // Sub-task exclusion still present
    assert.match(calls[0], /issuetype != Sub-task/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// findChildlessSeeds — D-diagnostic: detects "aggregator-epics" that
// have NO structural children at all. Used to surface UI signal "this
// goal references a reporting-epic, not real work".
// ──────────────────────────────────────────────────────────────────────

describe('findChildlessSeeds', () => {
  test('empty seed → empty result, no calls', async () => {
    const { search, calls } = makeFakeSearch({});
    const r = await findChildlessSeeds({ seedKeys: [], searchByJql: search });
    assert.deepEqual(r.childless, []);
    assert.equal(r.probed, 0);
    assert.equal(r.partialResult, false);
    assert.equal(calls.length, 0);
  });

  test('seed with children → not classified as childless', async () => {
    const { search } = makeFakeSearch({
      'DELTA-1': ['DELTA-100'],   // has children
      'DELTA-2': [],               // no children
    });
    const r = await findChildlessSeeds({
      seedKeys: ['DELTA-1', 'DELTA-2'],
      searchByJql: search,
    });
    assert.deepEqual(r.childless, ['DELTA-2']);
    assert.equal(r.probed, 2);
  });

  test('seed self-reference does not count as a child', async () => {
    // SMEAM-31267 has Epic Link = SMEAM-31267 (self). The function must
    // NOT treat the self-reference as a real child.
    const { search } = makeFakeSearch({
      'DELTA-1': ['DELTA-1'],   // returns ITSELF, no real children
    });
    const r = await findChildlessSeeds({
      seedKeys: ['DELTA-1'],
      searchByJql: search,
    });
    assert.deepEqual(r.childless, ['DELTA-1'], 'self-ref → still childless');
  });

  test('point-query JQL is correct shape', async () => {
    const { search, calls } = makeFakeSearch({});
    await findChildlessSeeds({
      seedKeys: ['DELTA-99'],
      searchByJql: search,
      projectClause: ' AND project in ("DELTA")',
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /"Epic Link" = "DELTA-99"/);
    assert.match(calls[0], /parent = "DELTA-99"/);
    assert.match(calls[0], /AND project in \("DELTA"\)/);
  });

  test('parallel concurrency: respects concurrency cap', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const slow = async (_jql) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 30));
      inFlight--;
      return [];
    };
    await findChildlessSeeds({
      seedKeys: ['K1','K2','K3','K4','K5','K6','K7','K8'],
      searchByJql: slow,
      concurrency: 3,
    });
    assert.ok(maxInFlight <= 3, `should respect concurrency=3, saw maxInFlight=${maxInFlight}`);
  });

  test('searchByJql throw on a key → that key NOT classified as childless (no false-positive)', async () => {
    let calls = 0;
    const flaky = async (jql) => {
      calls++;
      if (jql.includes('"FAIL-1"')) throw new Error('Jira 503');
      return [{ key: 'CHILD-1' }];   // others have children
    };
    const r = await findChildlessSeeds({
      seedKeys: ['FAIL-1', 'OK-1'],
      searchByJql: flaky,
    });
    // FAIL-1 errored → NOT in childless (we don't classify on error)
    // OK-1 has child → not childless
    assert.deepEqual(r.childless, []);
    assert.equal(r.probed, 2);
  });

  test('time-budget exceeded → partialResult: true', async () => {
    const slow = async () => { await new Promise(r => setTimeout(r, 50)); return []; };
    const seedKeys = [];
    for (let i = 1; i <= 10; i++) seedKeys.push(`K-${i}`);
    const r = await findChildlessSeeds({
      seedKeys,
      searchByJql: slow,
      concurrency: 2,
      timeBudgetMs: 80,    // only ~3 probes can finish
    });
    assert.equal(r.partialResult, true);
    assert.ok(r.probed < seedKeys.length, `probed ${r.probed} of ${seedKeys.length}`);
  });
});
