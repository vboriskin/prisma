'use strict';
/* ============================================================
   tests/unit/portfolioPulseInsights.test.js
   --
   Tests for the rule-based insights engine. We hand-craft minimal
   model objects that exercise one rule at a time, then assert the
   insights array contains the expected entry.

   Design choice: we DON'T go through analysePulse() — these are
   targeted unit tests for buildInsights itself, so we feed it the
   already-shaped model. This keeps tests fast and the failure mode
   "rule X did/didn't fire" pinpoints the regression precisely.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildInsights, filterInsightsByPk } from '../../integrations/portfolioPulseInsights.js';

/** Minimal model factory — fields buildInsights actually reads. */
function makeModel(over = {}) {
  return {
    errors: [],
    spaces: {},
    unassignedByPk: {},
    participants: [],
    ...over,
  };
}

function makeIssue(over = {}) {
  return {
    key: 'PAY-1', pk: 'PAY',
    summary: '', description: 'Some description',
    type: 'Story', typeKey: 'story',
    priority: 'Medium',
    status: 'In Progress', statusCat: 'indeterminate',
    assignee: 'Иван Иванов',
    parentKey: '',
    duedate: '', created: new Date().toISOString(), updated: new Date().toISOString(),
    labels: [],
    ...over,
  };
}

function findInsight(insights, predicate) {
  return insights.find(predicate);
}

describe('buildInsights — error / empty space rules', () => {
  test('per-PK fetch error becomes a critical insight with target=pk', () => {
    const m = makeModel({ errors: [{ projectKey: 'PAY', error: 'timeout 45000ms' }] });
    const ins = buildInsights(m);
    const i = findInsight(ins, x => x.severity === 'critical' && x.target === 'PAY');
    assert.ok(i, 'expected a critical insight for PAY error');
    assert.match(i.title, /Сбой/);
    assert.match(i.explanation, /timeout/);
  });

  test('empty space (no issues) → warning', () => {
    const m = makeModel({
      spaces: { PAY: { hasError: false, issues: [], sprintIssues: [], wipIssues: [], backlogIssues: [], activeSprintName: '' } },
    });
    const ins = buildInsights(m);
    const i = findInsight(ins, x => x.severity === 'warning' && x.target === 'PAY' && /пустое/.test(x.title));
    assert.ok(i, 'expected warning for empty space');
  });

  test('no active sprint → info insight', () => {
    const m = makeModel({
      spaces: { PAY: { hasError: false, issues: [makeIssue()], sprintIssues: [], wipIssues: [], backlogIssues: [], activeSprintName: '' } },
    });
    const ins = buildInsights(m);
    assert.ok(findInsight(ins, x => x.severity === 'info' && /активного спринта/.test(x.title)));
  });

  test('hasError on space → no spurious "empty" or "no sprint" insight', () => {
    const m = makeModel({
      spaces: { PAY: { hasError: true, errorMsg: 'boom', issues: [], sprintIssues: [], wipIssues: [], backlogIssues: [], activeSprintName: '' } },
    });
    const ins = buildInsights(m);
    assert.equal(findInsight(ins, x => /пустое/.test(x.title)), undefined);
  });
});

describe('buildInsights — unassigned aggregate', () => {
  test('flat list across PKs surfaces as a single warning', () => {
    const m = makeModel({
      unassignedByPk: { PAY: [makeIssue({ key: 'PAY-1', assignee: '' })], KYC: [makeIssue({ key: 'KYC-1', pk: 'KYC', assignee: '' })] },
    });
    const ins = buildInsights(m);
    const i = findInsight(ins, x => /без исполнителя/.test(x.title));
    assert.ok(i);
    assert.equal(i.count, 2);
    assert.equal(i.severity, 'warning');
  });

  test('zero unassigned across PKs → no insight at all', () => {
    const m = makeModel({ unassignedByPk: { PAY: [], KYC: [] } });
    const ins = buildInsights(m);
    assert.equal(findInsight(ins, x => /без исполнителя/.test(x.title)), undefined);
  });
});

describe('buildInsights — per-participant rules', () => {
  test('WIP > wipMax fires warning targeted at participant', () => {
    const m = makeModel({
      participants: [{
        key: 'ivan', label: 'Иван',
        issuesNow: [makeIssue({key:'A-1'}), makeIssue({key:'A-2'}), makeIssue({key:'A-3'}), makeIssue({key:'A-4'})],
        doneYesterday: [], doneDayBefore: [], stale: [],
        commentsRecent: [], loggedYesterdaySec: 0, loggedDayBeforeSec: 0,
      }],
    });
    const ins = buildInsights(m, { wipMax: 3 });
    const i = findInsight(ins, x => /WIP > 3/.test(x.title));
    assert.ok(i);
    assert.equal(i.target, 'ivan');
    assert.equal(i.count, 4);
  });

  test('48h silence with WIP — info "тишина 48ч"', () => {
    const m = makeModel({
      participants: [{
        key: 'ivan', label: 'Иван',
        issuesNow: [makeIssue()], doneYesterday: [], doneDayBefore: [], stale: [],
        commentsRecent: [], loggedYesterdaySec: 0, loggedDayBeforeSec: 0,
      }],
    });
    const ins = buildInsights(m);
    assert.ok(findInsight(ins, x => /тишина 48ч/.test(x.title)));
  });

  test('any activity (worklog) suppresses "тишина"', () => {
    const m = makeModel({
      participants: [{
        key: 'ivan', label: 'Иван',
        issuesNow: [makeIssue()], doneYesterday: [], doneDayBefore: [], stale: [],
        commentsRecent: [], loggedYesterdaySec: 3600, loggedDayBeforeSec: 0,
      }],
    });
    const ins = buildInsights(m);
    assert.equal(findInsight(ins, x => /тишина/.test(x.title)), undefined);
  });

  test('empty WIP + activity → "пустой WIP"', () => {
    const m = makeModel({
      participants: [{
        key: 'ivan', label: 'Иван',
        issuesNow: [], doneYesterday: [], doneDayBefore: [], stale: [],
        commentsRecent: [{ kind: 'comment', issue: makeIssue(), at: '', text: '' }],
        loggedYesterdaySec: 0, loggedDayBeforeSec: 0,
      }],
    });
    const ins = buildInsights(m);
    assert.ok(findInsight(ins, x => /пустой WIP/.test(x.title)));
  });

  test('stale issues → info with count', () => {
    const m = makeModel({
      participants: [{
        key: 'ivan', label: 'Иван',
        issuesNow: [], doneYesterday: [], doneDayBefore: [],
        stale: [makeIssue({key:'A-1'}), makeIssue({key:'A-2'})],
        commentsRecent: [], loggedYesterdaySec: 0, loggedDayBeforeSec: 0,
      }],
    });
    const ins = buildInsights(m, { staleDays: 7 });
    const i = findInsight(ins, x => /зависших/.test(x.title));
    assert.ok(i);
    assert.equal(i.count, 2);
    assert.match(i.title, /> 7д/);
  });
});

describe('buildInsights — issue-wide signals', () => {
  test('high-prio not started fires warning across spaces', () => {
    const m = makeModel({
      spaces: {
        PAY: { hasError: false, issues: [makeIssue({ key:'PAY-1', priority: 'Highest', status: 'Open', statusCat: 'new' })],
               sprintIssues: [], wipIssues: [], backlogIssues: [], activeSprintName: '' },
      },
    });
    const ins = buildInsights(m);
    assert.ok(findInsight(ins, x => /Высокий приоритет в очереди/.test(x.title)));
  });

  test('blocker stale 48h → critical', () => {
    const old = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const m = makeModel({
      spaces: {
        PAY: { hasError: false, issues: [makeIssue({ priority: 'Blocker', updated: old })],
               sprintIssues: [], wipIssues: [], backlogIssues: [], activeSprintName: '' },
      },
    });
    const ins = buildInsights(m);
    assert.ok(findInsight(ins, x => x.severity === 'critical' && /Блокеры без апдейта/.test(x.title)));
  });

  test('overdue (duedate in past, non-terminal) → warning', () => {
    const past = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const m = makeModel({
      spaces: {
        PAY: { hasError: false, issues: [makeIssue({ duedate: past })],
               sprintIssues: [], wipIssues: [], backlogIssues: [], activeSprintName: '' },
      },
    });
    const ins = buildInsights(m);
    const i = findInsight(ins, x => /Просроченные/.test(x.title));
    assert.ok(i);
    assert.equal(i.count, 1);
  });

  test('terminal status with past duedate is NOT overdue', () => {
    const past = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const m = makeModel({
      spaces: {
        PAY: { hasError: false, issues: [makeIssue({ duedate: past, status: 'Closed', statusCat: 'done' })],
               sprintIssues: [], wipIssues: [], backlogIssues: [], activeSprintName: '' },
      },
    });
    const ins = buildInsights(m);
    assert.equal(findInsight(ins, x => /Просроченные/.test(x.title)), undefined);
  });

  test('orphan sub-task → warning', () => {
    const m = makeModel({
      spaces: {
        PAY: { hasError: false, issues: [makeIssue({ type: 'Sub-task', typeKey: 'sub-task', parentKey: '' })],
               sprintIssues: [], wipIssues: [], backlogIssues: [], activeSprintName: '' },
      },
    });
    const ins = buildInsights(m);
    assert.ok(findInsight(ins, x => /Sub-task без parent/.test(x.title)));
  });

  test('parent done + sub-task open → warning', () => {
    const parent = makeIssue({ key: 'PAY-1', status: 'Closed', statusCat: 'done', type: 'Story' });
    const sub = makeIssue({ key: 'PAY-2', type: 'Sub-task', typeKey: 'sub-task', parentKey: 'PAY-1', status: 'Open', statusCat: 'new' });
    const m = makeModel({
      spaces: {
        PAY: { hasError: false, issues: [parent, sub], sprintIssues: [], wipIssues: [], backlogIssues: [], activeSprintName: '' },
      },
    });
    const ins = buildInsights(m);
    assert.ok(findInsight(ins, x => /Parent done, sub-task open/.test(x.title)));
  });

  test('"no description" only fires above threshold (>5)', () => {
    const issues = Array.from({ length: 6 }, (_, i) => makeIssue({ key: `PAY-${i+1}`, description: '' }));
    const m = makeModel({
      spaces: {
        PAY: { hasError: false, issues, sprintIssues: [], wipIssues: [], backlogIssues: [], activeSprintName: '' },
      },
    });
    const ins = buildInsights(m);
    assert.ok(findInsight(ins, x => /Без описания/.test(x.title)));
  });

  test('"no description" with only 5 issues — does NOT fire', () => {
    const issues = Array.from({ length: 5 }, (_, i) => makeIssue({ key: `PAY-${i+1}`, description: '' }));
    const m = makeModel({
      spaces: {
        PAY: { hasError: false, issues, sprintIssues: [], wipIssues: [], backlogIssues: [], activeSprintName: '' },
      },
    });
    const ins = buildInsights(m);
    assert.equal(findInsight(ins, x => /Без описания/.test(x.title)), undefined);
  });
});

describe('buildInsights — bugs ratio', () => {
  test('bugs > 40% in active sprint with ≥8 issues → warning', () => {
    const sprint = [
      ...Array.from({ length: 4 }, (_, i) => makeIssue({ key: `B-${i}`, type: 'Bug', typeKey: 'bug' })),
      ...Array.from({ length: 5 }, (_, i) => makeIssue({ key: `S-${i}`, type: 'Story' })),
    ];
    const m = makeModel({
      spaces: { PAY: { hasError: false, issues: sprint, sprintIssues: sprint, wipIssues: [], backlogIssues: [], activeSprintName: 'Sprint 1' } },
    });
    const ins = buildInsights(m);
    assert.ok(findInsight(ins, x => /много багов в спринте/.test(x.title)));
  });

  test('< 8 issues in sprint → no bug-ratio insight even at 50%', () => {
    const sprint = [
      makeIssue({ key: 'B-1', type: 'Bug', typeKey: 'bug' }),
      makeIssue({ key: 'B-2', type: 'Bug', typeKey: 'bug' }),
      makeIssue({ key: 'S-1', type: 'Story' }),
    ];
    const m = makeModel({
      spaces: { PAY: { hasError: false, issues: sprint, sprintIssues: sprint, wipIssues: [], backlogIssues: [], activeSprintName: 'Sprint' } },
    });
    const ins = buildInsights(m);
    assert.equal(findInsight(ins, x => /много багов/.test(x.title)), undefined);
  });
});

describe('buildInsights — ordering', () => {
  test('critical → warning → info', () => {
    const old = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const m = makeModel({
      errors: [{ projectKey: 'PAY', error: 'boom' }],     // critical
      unassignedByPk: { PAY: [makeIssue({ assignee: '' })] }, // warning
      spaces: {
        PAY: { hasError: false, issues: [makeIssue({ priority: 'Blocker', updated: old })],
               sprintIssues: [], wipIssues: [], backlogIssues: [], activeSprintName: 'Sprint' },
      },
    });
    const ins = buildInsights(m);
    const sevs = ins.map(i => i.severity);
    // every "critical" must come before any "warning"; every "warning" before any "info".
    const firstWarning = sevs.indexOf('warning');
    const lastCritical = sevs.lastIndexOf('critical');
    if (firstWarning >= 0 && lastCritical >= 0) {
      assert.ok(lastCritical < firstWarning, 'criticals must precede warnings');
    }
    const firstInfo = sevs.indexOf('info');
    const lastWarning = sevs.lastIndexOf('warning');
    if (firstInfo >= 0 && lastWarning >= 0) {
      assert.ok(lastWarning < firstInfo, 'warnings must precede infos');
    }
  });
});

describe('filterInsightsByPk', () => {
  test('empty pk returns insights unchanged', () => {
    const ins = [{ target: 'PAY', items: [] }, { target: null, items: [] }];
    assert.deepEqual(filterInsightsByPk(ins, ''), ins);
  });

  test('keeps insights with target===pk', () => {
    const ins = [
      { target: 'PAY', items: [] },
      { target: 'KYC', items: [] },
    ];
    const got = filterInsightsByPk(ins, 'PAY');
    assert.equal(got.length, 1);
    assert.equal(got[0].target, 'PAY');
  });

  test('keeps insights with item.pk===pk even if target=null', () => {
    const ins = [
      { target: null, items: [{ pk: 'KYC' }] },
      { target: null, items: [{ pk: 'PAY' }] },
    ];
    const got = filterInsightsByPk(ins, 'PAY');
    assert.equal(got.length, 1);
  });

  test('drops insights with neither target nor matching items', () => {
    const ins = [{ target: null, items: [{ pk: 'OTHER' }] }];
    assert.equal(filterInsightsByPk(ins, 'PAY').length, 0);
  });
});
