'use strict';
/* tests/unit/teamScanner2Insights.test.js — V20 S12 PR-F insights */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDailyBrief,
  buildActionQueue,
  detectZombies,
  buildYesterdayGroupMap,
  extractPersonGroups,
} from '../../integrations/teamScanner2Insights.js';

function mkP(over = {}) {
  return {
    key: 'u1',
    label: 'User',
    timelineToday: [],
    timelineYesterday: [],
    timelinePrev: [],
    blockers: [],
    issuesNow: [],
    ...over,
  };
}

describe('I7 — detectZombies', () => {
  test('фильтрует blockers с dwell ≥30д', () => {
    const model = { participants: [
      mkP({ blockers: [{ key: 'X-1', status: 'In Progress', dwellHours: 24 }] }),
      mkP({ key: 'u2', label: 'B', blockers: [{ key: 'X-2', status: 'To Do', dwellHours: 800 }] }),
      mkP({ key: 'u3', label: 'C', blockers: [{ key: 'X-3', status: 'Code Review', dwellHours: 50 * 24 }] }),
    ] };
    const z = detectZombies(model);
    assert.equal(z.length, 2);
    assert.equal(z[0].key, 'X-3'); // sorted desc by dwell
    assert.equal(z[1].key, 'X-2');
  });

  test('дедуплицирует по issue.key', () => {
    const model = { participants: [
      mkP({ key: 'u1', blockers: [{ key: 'X-1', dwellHours: 1000 }] }),
      mkP({ key: 'u2', blockers: [{ key: 'X-1', dwellHours: 800 }] }), // тот же ключ
    ] };
    const z = detectZombies(model);
    assert.equal(z.length, 1);
  });

  test('пустой ввод → []', () => {
    assert.deepEqual(detectZombies({}), []);
    assert.deepEqual(detectZombies(null), []);
  });
});

describe('I2 — buildActionQueue', () => {
  test('priority: stop с блокерами на топе', () => {
    const model = { participants: [
      // stop: блокеры есть, активности нет
      mkP({ key: 'a', label: 'Иванов', timelineToday: [], blockers: [{ dwellHours: 50 }, { dwellHours: 100 }] }),
      mkP({ key: 'b', label: 'Петров', timelineToday: [{ at: 'x', issue: { key: 'A' } }, { at: 'y', issue: { key: 'B' } }] }),
    ] };
    const q = buildActionQueue(model);
    assert.ok(q.length >= 1, `expected ≥1 in queue, got ${q.length}`);
    assert.equal(q[0].label, 'Иванов');
    assert.match(q[0].reason, /Стоп/i);
  });

  test('moving/clean → не в очереди', () => {
    const model = { participants: [
      mkP({ key: 'a', timelineToday: [{ at: 'x', issue: { key: 'A' } }, { at: 'y', issue: { key: 'B' } }] }),
    ] };
    assert.equal(buildActionQueue(model).length, 0);
  });

  test('top-5 cap', () => {
    const parts = Array.from({ length: 10 }, (_, i) => mkP({
      key: `u${i}`, label: `U${i}`,
      timelineToday: [{}], blockers: [{ dwellHours: 50 + i }],
    }));
    assert.equal(buildActionQueue({ participants: parts }).length, 5);
  });
});

describe('I1 — buildDailyBrief', () => {
  test('пустая команда → одно предложение', () => {
    const r = buildDailyBrief({ participants: [] }, []);
    assert.equal(r.sentences.length, 1);
    assert.match(r.sentences[0], /пустая/i);
  });

  test('базовый вывод содержит counts + brief', () => {
    const model = {
      participants: [
        mkP({ key: 'a', timelineToday: [{ at: 'x', issue: { key: 'A' } }, { at: 'y', issue: { key: 'B' } }] }),
        mkP({ key: 'b', timelineToday: [{}], blockers: [{ dwellHours: 100 }] }),
      ],
      scannerV2: { sprintGoal: { aggregateProgress: 60, aggregateDone: 6, aggregateTotal: 10, aggregatePace: 'on-track', sprints: [] } },
    };
    const r = buildDailyBrief(model, []);
    assert.ok(r.sentences.length >= 2);
    assert.match(r.sentences.join(' '), /движутся/i);
    assert.match(r.sentences.join(' '), /Спринт.*60%/);
  });
});

describe('I3 — extractPersonGroups / buildYesterdayGroupMap', () => {
  test('extractPersonGroups → {key:group}', () => {
    const parts = [
      mkP({ key: 'a', timelineToday: [{ at: 'x', issue: { key: 'A' } }, { at: 'y', issue: { key: 'B' } }] }),
      mkP({ key: 'b', timelineToday: [{}], blockers: [{ dwellHours: 50 }] }),
    ];
    const g = extractPersonGroups(parts);
    assert.ok('a' in g);
    assert.ok('b' in g);
  });

  test('buildYesterdayGroupMap пустой prev → пустая Map', () => {
    const m = buildYesterdayGroupMap(null);
    assert.equal(m.size, 0);
  });

  test('buildYesterdayGroupMap из prev.personGroups', () => {
    const m = buildYesterdayGroupMap({ personGroups: { 'a': 'stop', 'b': 'moving' } });
    assert.equal(m.get('a'), 'stop');
    assert.equal(m.get('b'), 'moving');
  });
});
