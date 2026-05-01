'use strict';
/* ============================================================
   tests/unit/portfolioPulseMetrics.test.js
   --
   Tests for buildMetrics (pure aggregation) AND the render helpers
   (renderDonut / renderBars / renderAgeHistogram). Render helpers
   produce HTML strings — we assert on structure & escape, not pixel
   layout.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMetrics, renderDonut, renderBars, renderAgeHistogram,
} from '../../integrations/portfolioPulseMetrics.js';

function makeIssue(over = {}) {
  return {
    key: 'PAY-1', pk: 'PAY',
    summary: '', description: '',
    type: 'Story', typeKey: 'story',
    priority: 'Medium',
    status: 'In Progress', statusCat: 'indeterminate',
    assignee: 'Иван',
    parentKey: '',
    duedate: '', created: new Date().toISOString(), updated: '',
    labels: [],
    ...over,
  };
}

describe('buildMetrics — donuts', () => {
  test('donutTypes counts each `type` exactly once, falls back to "—" for empty', () => {
    const m = {
      participants: [],
      spaces: {
        PAY: { issues: [
          makeIssue({ type: 'Story' }),
          makeIssue({ type: 'Story' }),
          makeIssue({ type: 'Bug' }),
          makeIssue({ type: '' }),
        ], wipIssues: [], backlogIssues: [] },
      },
    };
    const r = buildMetrics(m);
    assert.equal(r.donutTypes.Story, 2);
    assert.equal(r.donutTypes.Bug, 1);
    assert.equal(r.donutTypes['—'], 1);
  });

  test('donutPriorities and donutStatuses behave the same way', () => {
    const m = {
      participants: [],
      spaces: {
        PAY: { issues: [
          makeIssue({ priority: 'Highest', status: 'Open' }),
          makeIssue({ priority: '',        status: 'Open' }),
        ], wipIssues: [], backlogIssues: [] },
      },
    };
    const r = buildMetrics(m);
    assert.equal(r.donutPriorities.Highest, 1);
    assert.equal(r.donutPriorities['—'], 1);
    assert.equal(r.donutStatuses.Open, 2);
  });
});

describe('buildMetrics — wip aggregations', () => {
  test('wipByPerson uses assignee, skipping null assignees', () => {
    const m = {
      participants: [],
      spaces: {
        PAY: { issues: [], wipIssues: [
          makeIssue({ assignee: 'Иван' }),
          makeIssue({ assignee: 'Иван' }),
          makeIssue({ assignee: 'Анна' }),
          makeIssue({ assignee: '' }),
        ], backlogIssues: [] },
      },
    };
    const r = buildMetrics(m);
    assert.equal(r.wipByPerson['Иван'], 2);
    assert.equal(r.wipByPerson['Анна'], 1);
    assert.equal(r.wipByPerson[''], undefined, 'empty-string assignee must not appear');
  });

  test('wipBySpace counts WIP issues per pk', () => {
    const m = {
      participants: [],
      spaces: {
        PAY: { issues: [], wipIssues: [makeIssue(), makeIssue()], backlogIssues: [] },
        KYC: { issues: [], wipIssues: [makeIssue({ pk: 'KYC' })],   backlogIssues: [] },
      },
    };
    const r = buildMetrics(m);
    assert.deepEqual(r.wipBySpace, { PAY: 2, KYC: 1 });
  });

  test('wipByType groups by type', () => {
    const m = {
      participants: [],
      spaces: {
        PAY: { issues: [], wipIssues: [
          makeIssue({ type: 'Story' }),
          makeIssue({ type: 'Bug' }),
          makeIssue({ type: 'Bug' }),
        ], backlogIssues: [] },
      },
    };
    const r = buildMetrics(m);
    assert.equal(r.wipByType.Story, 1);
    assert.equal(r.wipByType.Bug, 2);
  });
});

describe('buildMetrics — flagged lists', () => {
  test('highPrioNotStarted picks priority=blocker/highest/critical AND status=initial', () => {
    const m = {
      participants: [],
      spaces: {
        PAY: { issues: [
          makeIssue({ priority: 'Blocker', status: 'Open',         statusCat: 'new' }),
          makeIssue({ priority: 'Highest', status: 'In Progress',  statusCat: 'indeterminate' }), // not initial
          makeIssue({ priority: 'Medium',  status: 'Open',         statusCat: 'new' }),           // not high prio
          makeIssue({ priority: 'Критич',  status: 'To Do',        statusCat: 'new' }),
        ], wipIssues: [], backlogIssues: [] },
      },
    };
    const r = buildMetrics(m);
    assert.equal(r.highPrioNotStarted.length, 2);
  });

  test('bugsBySpace counts only bugs', () => {
    const m = {
      participants: [],
      spaces: {
        PAY: { issues: [
          makeIssue({ type: 'Story' }),
          makeIssue({ type: 'Bug', typeKey: 'bug' }),
          makeIssue({ type: 'Bug', typeKey: 'bug' }),
        ], wipIssues: [], backlogIssues: [] },
      },
    };
    const r = buildMetrics(m);
    assert.equal(r.bugsBySpace.PAY, 2);
  });

  test('unassignedBySpace excludes terminal-status issues without assignee', () => {
    const m = {
      participants: [],
      spaces: {
        PAY: { issues: [
          makeIssue({ assignee: '' }),                                // counted
          makeIssue({ assignee: '', status: 'Closed', statusCat: 'done' }), // NOT counted (terminal)
        ], wipIssues: [], backlogIssues: [] },
      },
    };
    const r = buildMetrics(m);
    assert.equal(r.unassignedBySpace.PAY, 1);
  });

  test('backlogBySpace returns 0 for spaces with no backlog and absent space gives undefined', () => {
    const m = {
      participants: [],
      spaces: {
        PAY: { issues: [], wipIssues: [], backlogIssues: [] },
        KYC: { issues: [], wipIssues: [], backlogIssues: [makeIssue({ pk: 'KYC' })] },
      },
    };
    const r = buildMetrics(m);
    assert.equal(r.backlogBySpace.PAY, 0);
    assert.equal(r.backlogBySpace.KYC, 1);
  });
});

describe('buildMetrics — participant aggregations', () => {
  test('loggedByPerson rounds seconds to nearest 0.1h', () => {
    const m = {
      participants: [
        { label: 'Иван', loggedYesterdaySec: 5400, stale: [] },
        { label: 'Анна', loggedYesterdaySec: 0,    stale: [] },   // skipped (truthy guard)
      ],
      spaces: {},
    };
    const r = buildMetrics(m);
    assert.equal(r.loggedByPerson['Иван'], 1.5);
    assert.equal(r.loggedByPerson['Анна'], undefined);
  });

  test('staleByPerson reflects stale.length', () => {
    const m = {
      participants: [
        { label: 'Иван', loggedYesterdaySec: 0, stale: [makeIssue(), makeIssue(), makeIssue()] },
        { label: 'Анна', loggedYesterdaySec: 0, stale: [] },
      ],
      spaces: {},
    };
    const r = buildMetrics(m);
    assert.equal(r.staleByPerson['Иван'], 3);
    assert.equal(r.staleByPerson['Анна'], undefined);
  });
});

describe('buildMetrics — empty model', () => {
  test('every output exists with zero entries', () => {
    const r = buildMetrics({ participants: [], spaces: {} });
    assert.deepEqual(r.donutTypes, {});
    assert.deepEqual(r.wipByPerson, {});
    assert.deepEqual(r.bugsBySpace, {});
    assert.deepEqual(r.allIssues, []);
    assert.deepEqual(r.wipIssues, []);
  });
});

describe('renderDonut', () => {
  test('zero data shows "нет данных"', () => {
    const html = String(renderDonut('My donut', {}));
    assert.match(html, /нет данных/);
  });

  test('non-zero entries render counts + percentages', () => {
    const html = String(renderDonut('Types', { Story: 8, Bug: 2 }));
    assert.match(html, /Story/);
    assert.match(html, /Bug/);
    assert.match(html, />8</);
    assert.match(html, />2</);
    assert.match(html, /80%/);
    assert.match(html, /20%/);
  });

  test('escapes special characters in keys (XSS guard)', () => {
    const html = String(renderDonut('t', { '<script>': 1 }));
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
  });
});

describe('renderBars', () => {
  test('zero data shows "нет данных"', () => {
    const html = String(renderBars('Bars', {}));
    assert.match(html, /нет данных/);
  });

  test('renders bar widths proportionally to max', () => {
    const html = String(renderBars('Bars', { A: 10, B: 5 }, { limit: 5 }));
    assert.match(html, /width:100%/);
    assert.match(html, /width:50%/);
  });

  test('respects opts.limit cap', () => {
    const data = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`K${i}`, 20 - i]));
    const html = String(renderBars('B', data, { limit: 5 }));
    // Only first 5 entries render bars — count `pp-bar-row` divs.
    const matches = html.match(/pp-bar-row/g) || [];
    assert.equal(matches.length, 5);
  });

  test('appends suffix when provided', () => {
    const html = String(renderBars('Hours', { A: 4 }, { suffix: 'ч' }));
    assert.match(html, /4ч/);
  });
});

describe('renderAgeHistogram', () => {
  test('age buckets aggregate correctly', () => {
    const now = Date.now();
    const issues = [
      { created: new Date(now - 1 * 24 * 3600 * 1000).toISOString() },   // <7д
      { created: new Date(now - 1 * 24 * 3600 * 1000).toISOString() },   // <7д
      { created: new Date(now - 30 * 24 * 3600 * 1000).toISOString() },  // 14–30д
      { created: new Date(now - 100 * 24 * 3600 * 1000).toISOString() }, // >90д
    ];
    const html = String(renderAgeHistogram('Возраст', issues, 'created'));
    // Bucket labels contain "<" and ">" — they're HTML-escaped in output.
    assert.match(html, /&lt;7д/);
    assert.match(html, /&gt;90д/);
    // Two issues land in the <7д bucket; verify count token appears.
    assert.match(html, /<span class="pp-bar-val">2<\/span>/);
  });

  test('issues with empty `created` fall into >90д bucket (epoch-zero math)', () => {
    // ts('') returns 0 → age = (Date.now() - 0) / day_ms ≈ today's epoch days,
    // which is enormous and lands in `>90д`. Documented invariant — not the
    // most user-friendly behaviour but the renderer doesn't lose data.
    const html = String(renderAgeHistogram('Возраст', [{ created: '' }], 'created'));
    assert.match(html, /&gt;90д/);
    assert.match(html, /<span class="pp-bar-val">1<\/span>/);
  });
});
