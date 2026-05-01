'use strict';
/* ============================================================
   tests/unit/blackDashboardModel.test.js
   --
   Tests for analyseBlackDashboard — the pure shaper that turns the
   raw server payload into the model the renderer eats. Edge cases:
     · empty / null inputs
     · goal with error (preserved verbatim, not silently dropped)
     · linkedIssues with notFound: true preserve issue.key but no status
     · per-team coverage % rounding
     · metricBuckets correctness
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { analyseBlackDashboard } from '../../integrations/blackDashboardModel.js';

const baseRaw = () => ({
  fetchedAt:    '2026-04-28T10:00:00Z',
  sigmaConfigured: true,
  sigmaBaseUrl: 'https://sigma',
  deltaBaseUrl: 'https://delta',
  goals: [],
  teamIssues: [],
  summary: { totalGoals: 0, linkedCount: 0, unlinkedCount: 0, coveragePct: 0 },
  errors: [], diagnostics: { totalMs: 0 },
});

describe('analyseBlackDashboard — graceful inputs', () => {
  test('null input produces empty model with safe defaults', () => {
    const m = analyseBlackDashboard(null);
    assert.deepEqual(m.goals, []);
    assert.deepEqual(m.teamIssues, []);
    assert.deepEqual(m.coverageByTeam, []);
    assert.equal(m.sigmaConfigured, false);
    assert.equal(m.summary.totalGoals, 0);
    assert.ok(m.fetchedAt);
  });

  test('passes through fetchedAt / base URLs / errors verbatim', () => {
    const raw = baseRaw();
    raw.errors = [{ scope: 'sigma', message: 'oops' }];
    const m = analyseBlackDashboard(raw);
    assert.equal(m.fetchedAt, raw.fetchedAt);
    assert.equal(m.sigmaBaseUrl, 'https://sigma');
    assert.equal(m.deltaBaseUrl, 'https://delta');
    assert.deepEqual(m.errors, raw.errors);
    // Errors array is a copy, not the same reference.
    assert.notStrictEqual(m.errors, raw.errors);
  });
});

describe('analyseBlackDashboard — goal normalisation', () => {
  test('error goals preserved verbatim', () => {
    const raw = baseRaw();
    raw.goals = [{ key: 'GOAL-1', error: 'HTTP 404' }];
    const m = analyseBlackDashboard(raw);
    assert.equal(m.goals.length, 1);
    assert.equal(m.goals[0].key, 'GOAL-1');
    assert.equal(m.goals[0].error, 'HTTP 404');
  });

  test('groups linked issues by pk with done/wip/todo counters', () => {
    const raw = baseRaw();
    raw.goals = [{
      key: 'GOAL-1', summary: 'Q2 launch', status: 'In Progress', statusCat: 'indeterminate',
      domainLinks: ['PAY-1','PAY-2','KYC-7'],
      linkedIssues: [
        { key:'PAY-1', summary:'X', status:'Done',         statusCat:'done',          type:'Story', pk:'PAY' },
        { key:'PAY-2', summary:'Y', status:'In Progress',  statusCat:'indeterminate', type:'Story', pk:'PAY' },
        { key:'KYC-7', notFound: true },
      ],
    }];
    const m = analyseBlackDashboard(raw);
    const g = m.goals[0];
    assert.equal(g.linkedByPk.length, 2);
    const pay = g.linkedByPk.find(b => b.pk === 'PAY');
    assert.equal(pay.done, 1);
    assert.equal(pay.wip, 1);
    assert.equal(pay.todo, 0);
    assert.equal(pay.issues.length, 2);
    const kyc = g.linkedByPk.find(b => b.pk === 'KYC');
    assert.equal(kyc.issues.length, 1);
    // notFound issues add to the bucket but don't increment done/wip/todo.
    assert.equal(kyc.done + kyc.wip + kyc.todo, 0);
  });

  test('notFound issue derives pk from key prefix even if pk field missing', () => {
    const raw = baseRaw();
    raw.goals = [{
      key: 'GOAL-1', summary: '', status: '', statusCat: '',
      domainLinks: ['SBOF-99'],
      linkedIssues: [{ key: 'SBOF-99', notFound: true }],
    }];
    const m = analyseBlackDashboard(raw);
    assert.equal(m.goals[0].linkedByPk[0].pk, 'SBOF');
  });

  test('linkedByPk sorted by issues.length desc', () => {
    const raw = baseRaw();
    raw.goals = [{
      key: 'GOAL-1', summary: '', status: '', statusCat: '',
      domainLinks: [], linkedIssues: [
        { key:'KYC-1', pk:'KYC' },
        { key:'PAY-1', pk:'PAY' }, { key:'PAY-2', pk:'PAY' }, { key:'PAY-3', pk:'PAY' },
        { key:'SBOF-1', pk:'SBOF' }, { key:'SBOF-2', pk:'SBOF' },
      ],
    }];
    const m = analyseBlackDashboard(raw);
    assert.deepEqual(m.goals[0].linkedByPk.map(b => b.pk), ['PAY', 'SBOF', 'KYC']);
  });

  test('coverages computed per team — pct rounded to integer', () => {
    const raw = baseRaw();
    raw.teamIssues = [
      { pk: 'PAY',  name: 'Pay',  total: 10, linked: 7, issues: [] },  // 70%
      { pk: 'KYC',  name: 'KYC',  total: 7,  linked: 1, issues: [] },  // 14% (rounded down from 14.28)
    ];
    const m = analyseBlackDashboard(raw);
    const pay = m.coverageByTeam.find(c => c.pk === 'PAY');
    const kyc = m.coverageByTeam.find(c => c.pk === 'KYC');
    assert.equal(pay.pct, 70);
    assert.equal(kyc.pct, 14);
  });

  test('coverage 0/0 is 0% (no NaN)', () => {
    const raw = baseRaw();
    raw.teamIssues = [{ pk: 'X', name: 'X', total: 0, linked: 0, issues: [] }];
    const m = analyseBlackDashboard(raw);
    assert.equal(m.coverageByTeam[0].pct, 0);
  });

  test('coverageByTeam sorted by pct desc, total desc as tiebreak', () => {
    const raw = baseRaw();
    raw.teamIssues = [
      { pk: 'A', name: 'A', total: 10, linked: 5, issues: [] }, // 50%
      { pk: 'B', name: 'B', total: 20, linked: 18, issues: [] }, // 90%
      { pk: 'C', name: 'C', total: 40, linked: 36, issues: [] }, // 90%
    ];
    const m = analyseBlackDashboard(raw);
    // 90%-tied B and C — total desc means C first; A last.
    assert.deepEqual(m.coverageByTeam.map(c => c.pk), ['C', 'B', 'A']);
  });
});

describe('analyseBlackDashboard — metricBuckets', () => {
  test('donutCoverage reflects summary linked vs unlinked', () => {
    const raw = baseRaw();
    raw.summary = { totalGoals: 1, linkedCount: 5, unlinkedCount: 95, coveragePct: 5 };
    const m = analyseBlackDashboard(raw);
    assert.equal(m.metricBuckets.donutCoverage['Привязано к цели'], 5);
    assert.equal(m.metricBuckets.donutCoverage['Без цели'], 95);
  });

  test('donutLinkedStatuses counts statuses across all goals', () => {
    const raw = baseRaw();
    raw.goals = [{
      key:'G-1', summary:'', status:'', statusCat:'', domainLinks:[], linkedIssues: [
        { key:'A-1', pk:'A', statusCat:'done' },
        { key:'A-2', pk:'A', statusCat:'indeterminate' },
        { key:'A-3', pk:'A', statusCat:'new' },
        { key:'A-4', pk:'A', notFound: true },          // skip
      ],
    }];
    const m = analyseBlackDashboard(raw);
    assert.equal(m.metricBuckets.donutLinkedStatuses.Done,         1);
    assert.equal(m.metricBuckets.donutLinkedStatuses['In Progress'],1);
    assert.equal(m.metricBuckets.donutLinkedStatuses['To Do'],     1);
  });

  test('readinessByGoal computes done/total %, ignores notFound items', () => {
    const raw = baseRaw();
    raw.goals = [{
      key:'G-1', summary:'', status:'', statusCat:'', domainLinks:[], linkedIssues: [
        { key:'A-1', pk:'A', statusCat:'done' },
        { key:'A-2', pk:'A', statusCat:'done' },
        { key:'A-3', pk:'A', statusCat:'indeterminate' },
        { key:'A-4', pk:'A', notFound: true },
      ],
    }];
    const m = analyseBlackDashboard(raw);
    // 2 done out of 3 non-notFound → 67%
    assert.equal(m.metricBuckets.barsReadinessByGoal['G-1'], 67);
  });

  test('readinessByGoal omits goals with no real linked issues', () => {
    const raw = baseRaw();
    raw.goals = [
      { key:'G-empty', summary:'', status:'', statusCat:'', domainLinks:[], linkedIssues: [] },
      { key:'G-allnotFound', summary:'', status:'', statusCat:'', domainLinks:[], linkedIssues: [{ key:'X-1', notFound: true }] },
    ];
    const m = analyseBlackDashboard(raw);
    assert.equal(m.metricBuckets.barsReadinessByGoal['G-empty'], undefined);
    assert.equal(m.metricBuckets.barsReadinessByGoal['G-allnotFound'], undefined);
  });

  test('donutTypesUnlinked counts unlinked issues per type', () => {
    const raw = baseRaw();
    raw.teamIssues = [{ pk: 'A', name: 'A', total: 3, linked: 0, issues: [
      { key:'A-1', type:'Story', linkedToGoal: false },
      { key:'A-2', type:'Bug',   linkedToGoal: false },
      { key:'A-3', type:'Story', linkedToGoal: true  },  // ignored — linked
    ]}];
    const m = analyseBlackDashboard(raw);
    assert.equal(m.metricBuckets.donutTypesUnlinked.Story, 1);
    assert.equal(m.metricBuckets.donutTypesUnlinked.Bug, 1);
  });

  test('barsIssuesPerGoal counts linkedIssues incl notFound', () => {
    const raw = baseRaw();
    raw.goals = [{
      key:'G-1', summary:'', status:'', statusCat:'', domainLinks:[], linkedIssues: [
        { key:'A-1', pk:'A' }, { key:'A-2', notFound:true },
      ],
    }];
    const m = analyseBlackDashboard(raw);
    assert.equal(m.metricBuckets.barsIssuesPerGoal['G-1'], 2);
  });
});

describe('analyseBlackDashboard — teamIssues normalisation', () => {
  test('builds unlinkedIssues view from issues[].linkedToGoal=false', () => {
    const raw = baseRaw();
    raw.teamIssues = [{ pk: 'A', name: 'A', total: 3, linked: 1, issues: [
      { key:'A-1', linkedToGoal: true  },
      { key:'A-2', linkedToGoal: false },
      { key:'A-3', linkedToGoal: false },
    ]}];
    const m = analyseBlackDashboard(raw);
    assert.equal(m.teamIssues[0].unlinkedIssues.length, 2);
    assert.deepEqual(m.teamIssues[0].unlinkedIssues.map(i => i.key), ['A-2','A-3']);
  });
});
