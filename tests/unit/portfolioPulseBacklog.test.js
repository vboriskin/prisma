'use strict';
/* ============================================================
   tests/unit/portfolioPulseBacklog.test.js
   --
   Unit tests for buildBacklogModel + buildBacklogInsights. Same
   "hand-crafted minimal model" pattern as the insights tests.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildBacklogModel, buildBacklogInsights } from '../../integrations/portfolioPulseBacklog.js';

function makeIssue(over = {}) {
  return {
    key: 'PAY-1', pk: 'PAY',
    summary: '', description: 'desc',
    type: 'Story', typeKey: 'story',
    priority: 'Medium',
    status: 'Open', statusCat: 'new',
    assignee: 'Иван',
    parentKey: '',
    duedate: '', created: new Date().toISOString(), updated: '',
    labels: [],
    ...over,
  };
}

function makeModel(spaces) {
  return {
    spaces,
    participants: [], errors: [], unassignedByPk: {},
  };
}

describe('buildBacklogModel — basic counters', () => {
  test('aggregates totals across PKs', () => {
    const m = makeModel({
      PAY: { hasError: false, backlogIssues: [makeIssue({ key: 'PAY-1' }), makeIssue({ key: 'PAY-2' })] },
      KYC: { hasError: false, backlogIssues: [makeIssue({ key: 'KYC-1', pk: 'KYC' })] },
    });
    const bl = buildBacklogModel(m);
    assert.equal(bl.total, 3);
    assert.deepEqual(bl.totalsByPk, { PAY: 2, KYC: 1 });
  });

  test('errored space contributes 0', () => {
    const m = makeModel({
      PAY: { hasError: false, backlogIssues: [makeIssue()] },
      KYC: { hasError: true,  errorMsg: 'timeout', backlogIssues: [] },
    });
    const bl = buildBacklogModel(m);
    assert.equal(bl.total, 1);
    assert.equal(bl.totalsByPk.KYC, undefined);
  });

  test('counts noAssignee / noDescription / bugs / orphanSubs / overdue / older90d / noPriority', () => {
    const old = new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString();
    const past = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const m = makeModel({
      PAY: { hasError: false, backlogIssues: [
        makeIssue({ key: 'PAY-1', assignee: '' }),                                   // noAssignee
        makeIssue({ key: 'PAY-2', description: '' }),                                // noDescription
        makeIssue({ key: 'PAY-3', type: 'Bug', typeKey: 'bug' }),                    // bug
        makeIssue({ key: 'PAY-4', type: 'Sub-task', typeKey: 'sub-task', parentKey: '' }), // orphanSub
        makeIssue({ key: 'PAY-5', duedate: past }),                                  // overdue
        makeIssue({ key: 'PAY-6', created: old }),                                   // older90d
        makeIssue({ key: 'PAY-7', priority: '' }),                                   // noPriority
      ]},
    });
    const bl = buildBacklogModel(m);
    assert.equal(bl.noAssignee, 1);
    assert.equal(bl.noDescription, 1);
    assert.equal(bl.bugs, 1);
    assert.equal(bl.orphanSubs, 1);
    assert.equal(bl.overdue, 1);
    assert.equal(bl.older90d, 1);
    assert.equal(bl.noPriority, 1);
  });

  test('topOldest sorts by created ascending and caps at 30', () => {
    const issues = Array.from({ length: 40 }, (_, i) => makeIssue({
      key: `PAY-${i+1}`,
      created: new Date(Date.now() - (40 - i) * 24 * 3600 * 1000).toISOString(),
    }));
    const m = makeModel({ PAY: { hasError: false, backlogIssues: issues } });
    const bl = buildBacklogModel(m);
    assert.equal(bl.topOldest.length, 30);
    // Oldest first.
    assert.equal(bl.topOldest[0].key, 'PAY-1');
    assert.equal(bl.topOldest[29].key, 'PAY-30');
  });

  test('topHighPriority filters by Blocker/Critical/High keywords (RU+EN)', () => {
    const m = makeModel({
      PAY: { hasError: false, backlogIssues: [
        makeIssue({ key: 'PAY-1', priority: 'High' }),
        makeIssue({ key: 'PAY-2', priority: 'Critical' }),
        makeIssue({ key: 'PAY-3', priority: 'Высокий' }),
        makeIssue({ key: 'PAY-4', priority: 'Medium' }),
        makeIssue({ key: 'PAY-5', priority: '' }),
      ]},
    });
    const bl = buildBacklogModel(m);
    assert.equal(bl.topHighPriority.length, 3);
    assert.deepEqual(bl.topHighPriority.map(i => i.key).sort(), ['PAY-1','PAY-2','PAY-3']);
  });

  test('empty model produces zero counters', () => {
    const m = makeModel({});
    const bl = buildBacklogModel(m);
    assert.equal(bl.total, 0);
    assert.equal(bl.noAssignee, 0);
    assert.equal(bl.bugs, 0);
    assert.deepEqual(bl.topOldest, []);
  });
});

describe('buildBacklogInsights', () => {
  test('total ≥ 200 → warning "Бэклог большой"', () => {
    const bl = { total: 250, totalsByPk: { PAY: 250 }, topOldest: [], topHighPriority: [],
      noAssignee: 0, noDescription: 0, bugs: 0, orphanSubs: 0, overdue: 0, older90d: 0, noPriority: 0 };
    const ins = buildBacklogInsights(bl, {});
    assert.ok(ins.some(i => /Бэклог ≥ 250/.test(i.title)));
  });

  test('total < 200 → no "Бэклог" warning', () => {
    const bl = { total: 50, totalsByPk: { PAY: 50 }, topOldest: [], topHighPriority: [],
      noAssignee: 0, noDescription: 0, bugs: 0, orphanSubs: 0, overdue: 0, older90d: 0, noPriority: 0 };
    const ins = buildBacklogInsights(bl, {});
    assert.equal(ins.find(i => /Бэклог/.test(i.title)), undefined);
  });

  test('older90d > 0 → info', () => {
    const bl = { total: 10, totalsByPk: { PAY: 10 }, topOldest: [], topHighPriority: [],
      noAssignee: 0, noDescription: 0, bugs: 0, orphanSubs: 0, overdue: 0, older90d: 3, noPriority: 0 };
    const ins = buildBacklogInsights(bl, {});
    const i = ins.find(x => /Старше 90/.test(x.title));
    assert.ok(i);
    assert.equal(i.severity, 'info');
  });

  test('noPriority > 5 fires; ≤ 5 stays silent', () => {
    const ins5 = buildBacklogInsights({
      total: 10, totalsByPk: {}, topOldest: [], topHighPriority: [],
      noAssignee: 0, noDescription: 0, bugs: 0, orphanSubs: 0, overdue: 0, older90d: 0, noPriority: 5,
    }, {});
    const ins6 = buildBacklogInsights({
      total: 10, totalsByPk: {}, topOldest: [], topHighPriority: [],
      noAssignee: 0, noDescription: 0, bugs: 0, orphanSubs: 0, overdue: 0, older90d: 0, noPriority: 6,
    }, {});
    assert.equal(ins5.find(i => /Без приоритета/.test(i.title)), undefined);
    assert.ok(ins6.find(i => /Без приоритета: 6/.test(i.title)));
  });

  test('high-priority items in backlog → warning with items[]', () => {
    const items = [{ key: 'PAY-1', priority: 'Blocker' }];
    const bl = { total: 10, totalsByPk: {}, topOldest: [], topHighPriority: items,
      noAssignee: 0, noDescription: 0, bugs: 0, orphanSubs: 0, overdue: 0, older90d: 0, noPriority: 0 };
    const ins = buildBacklogInsights(bl, {});
    const i = ins.find(x => /High priority в backlog/.test(x.title));
    assert.ok(i);
    assert.equal(i.count, 1);
    assert.equal(i.items[0].key, 'PAY-1');
  });

  test('bug ratio > 40% with total ≥ 10 → warning; < 10 stays silent', () => {
    const high = buildBacklogInsights({
      total: 10, totalsByPk: {}, topOldest: [], topHighPriority: [],
      noAssignee: 0, noDescription: 0, bugs: 5, orphanSubs: 0, overdue: 0, older90d: 0, noPriority: 0,
    }, {});
    const low = buildBacklogInsights({
      total: 8, totalsByPk: {}, topOldest: [], topHighPriority: [],
      noAssignee: 0, noDescription: 0, bugs: 5, orphanSubs: 0, overdue: 0, older90d: 0, noPriority: 0,
    }, {});
    assert.ok(high.find(i => /Высокая доля bugs/.test(i.title)));
    assert.equal(low.find(i => /Высокая доля bugs/.test(i.title)), undefined);
  });

  test('skew between PKs (≥ 3× and ≥20 absolute diff) → info', () => {
    const bl = {
      total: 100, totalsByPk: { PAY: 100, KYC: 5 },
      topOldest: [], topHighPriority: [],
      noAssignee: 0, noDescription: 0, bugs: 0, orphanSubs: 0, overdue: 0, older90d: 0, noPriority: 0,
    };
    const ins = buildBacklogInsights(bl, {});
    const i = ins.find(x => /Перекос backlog/.test(x.title));
    assert.ok(i);
    assert.match(i.explanation, /PAY/);
    assert.match(i.explanation, /100/);
  });

  test('skew threshold not met (diff < 20 absolute) → no insight', () => {
    // diff = 24 - 5 = 19 → strictly below the `>=20` threshold so no insight.
    const bl = {
      total: 29, totalsByPk: { PAY: 24, KYC: 5 },
      topOldest: [], topHighPriority: [],
      noAssignee: 0, noDescription: 0, bugs: 0, orphanSubs: 0, overdue: 0, older90d: 0, noPriority: 0,
    };
    const ins = buildBacklogInsights(bl, {});
    assert.equal(ins.find(i => /Перекос/.test(i.title)), undefined);
  });
});
