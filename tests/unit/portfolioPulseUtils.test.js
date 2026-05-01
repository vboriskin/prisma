'use strict';
/* ============================================================
   tests/unit/portfolioPulseUtils.test.js
   --
   Sample style — pure helpers tested with `node:test`. No mocks;
   every util is a deterministic pure function. We import the REAL
   module, not an inline mirror, so any drift is caught immediately.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  isTerminalStatus, isInitialStatus, isWipActive,
  typeBucket, typeBucketLabel, statusBucket,
  userKey, userLabel, userAvatar,
  slimIssue, formatHrs,
} from '../../integrations/portfolioPulseUtils.js';

describe('portfolioPulseUtils — status classification', () => {
  test('isTerminalStatus: Done category is terminal regardless of name', () => {
    assert.equal(isTerminalStatus('Whatever', 'done'), true);
  });

  test('isTerminalStatus: terminal name is terminal even without category', () => {
    assert.equal(isTerminalStatus('Closed'), true);
    assert.equal(isTerminalStatus('Готово'), true);
    assert.equal(isTerminalStatus('Отменён'), true);
  });

  test('isTerminalStatus: in-progress name is not terminal', () => {
    assert.equal(isTerminalStatus('In Progress', 'indeterminate'), false);
  });

  test('isTerminalStatus: empty input does not throw, returns false', () => {
    assert.equal(isTerminalStatus(''), false);
    assert.equal(isTerminalStatus(undefined, undefined), false);
  });

  test('isInitialStatus: Open / To Do / Backlog mapped to initial', () => {
    assert.equal(isInitialStatus('Open', 'new'), true);
    assert.equal(isInitialStatus('To Do', 'new'), true);
    assert.equal(isInitialStatus('Backlog'), true);
    assert.equal(isInitialStatus('Создан'), true);
  });

  test('isInitialStatus: indeterminate category is NOT initial', () => {
    assert.equal(isInitialStatus('In Progress', 'indeterminate'), false);
  });
});

describe('portfolioPulseUtils — typeBucket', () => {
  test('English: Story / Task / Bug / Sub-task mapped correctly', () => {
    assert.equal(typeBucket('Story'),     'story');
    assert.equal(typeBucket('Task'),      'task');
    assert.equal(typeBucket('Bug'),       'bug');
    assert.equal(typeBucket('Sub-task'),  'subtask');
  });

  test('"Epic" (English) currently maps to "other" (see FOUND_BUGS.md #3)', () => {
    // V12 fix (FOUND_BUGS.md #3): English "Epic" now correctly buckets as 'story'.
    assert.equal(typeBucket('Epic'), 'story');
  });

  test('Russian variants are normalised to the same buckets', () => {
    assert.equal(typeBucket('Баг'),       'bug');
    assert.equal(typeBucket('Дефект'),    'bug');
    assert.equal(typeBucket('Задача'),    'task');
    assert.equal(typeBucket('Подзадача'), 'subtask');
  });

  test('Unknown type collapses to "other"', () => {
    assert.equal(typeBucket('SomethingExotic'), 'other');
    assert.equal(typeBucket(''),                'other');
    assert.equal(typeBucket(null),              'other');
  });

  test('typeBucket accepts both string and {type} object', () => {
    assert.equal(typeBucket({ type: 'Bug' }), 'bug');
    assert.equal(typeBucket({ type: '' }),    'other');
    assert.equal(typeBucket({}),              'other');
  });

  test('typeBucketLabel maps internal codes back to labels', () => {
    assert.equal(typeBucketLabel('story'),   'Story');
    assert.equal(typeBucketLabel('subtask'), 'Sub-task');
    assert.equal(typeBucketLabel('other'),   'Прочее');
    assert.equal(typeBucketLabel('unknown'), 'unknown');  // pass-through fallback
  });
});

describe('portfolioPulseUtils — user identity', () => {
  test('userKey prefers email when available', () => {
    const u = { displayName: 'Иван Иванов', emailAddress: 'ivan@example.com' };
    assert.match(userKey(u), /^ivan@example\.com$/i);
  });

  test('userKey falls back to displayName lowercased', () => {
    const u = { displayName: 'Иван Иванов' };
    assert.equal(userKey(u), 'иван иванов');
  });

  test('userKey returns empty string for null/undefined', () => {
    assert.equal(userKey(null),      '');
    assert.equal(userKey(undefined), '');
    assert.equal(userKey({}),        '');
  });

  test('userLabel prefers displayName, then name, then email, then "Аноним"', () => {
    assert.equal(userLabel({ displayName: 'Иван Иванов', emailAddress: 'i@x' }), 'Иван Иванов');
    assert.equal(userLabel({ name: 'ivan' }),         'ivan');
    assert.equal(userLabel({ emailAddress: 'i@x' }),  'i@x');
    assert.equal(userLabel({}),                       'Аноним');
    assert.equal(userLabel(null),                     '—');
  });

  test('userAvatar reads avatarUrls map (24x24 / 32x32 / 16x16)', () => {
    assert.equal(userAvatar({ avatarUrls: { '24x24': 'https://j/24.png' } }), 'https://j/24.png');
    assert.equal(userAvatar({ avatarUrls: { '32x32': 'https://j/32.png' } }), 'https://j/32.png');
    assert.equal(userAvatar({ avatarUrls: {} }),  '');
    assert.equal(userAvatar({}),                  '');
    assert.equal(userAvatar(null),                '');
  });
});

describe('portfolioPulseUtils — slimIssue', () => {
  test('extracts fields and derives pk from key when projectKey omitted', () => {
    const slim = slimIssue({
      key: 'PAY-100',
      fields: {
        summary:  'X',
        priority: { name: 'High' },
        status:   { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        assignee: { displayName: 'Ivan' },
        issuetype:{ name: 'Story' },
      },
    });
    assert.equal(slim.key,       'PAY-100');
    assert.equal(slim.pk,        'PAY');
    assert.equal(slim.priority,  'High');
    assert.equal(slim.status,    'In Progress');
    assert.equal(slim.statusCat, 'indeterminate');
    assert.equal(slim.assignee,  'Ivan');
    assert.equal(slim.type,      'Story');
  });

  test('uses explicit projectKey when provided', () => {
    const slim = slimIssue({ key: 'X-1', fields: { summary: '' } }, 'PROJ');
    assert.equal(slim.pk, 'PROJ');
  });

  test('truncates description to 800 chars', () => {
    const long = 'a'.repeat(2000);
    const slim = slimIssue({ key: 'PAY-1', fields: { description: long } });
    assert.equal(slim.description.length, 800);
  });

  test('returns empty assignee when null', () => {
    const slim = slimIssue({ key: 'PAY-1', fields: { assignee: null } });
    assert.equal(slim.assignee, '');
  });
});

describe('portfolioPulseUtils — formatHrs', () => {
  test('falsy seconds returns "0ч" (cyrillic — V12 fix for FOUND_BUGS.md #1)', () => {
    assert.equal(formatHrs(0),         '0ч');
    assert.equal(formatHrs(null),      '0ч');
    assert.equal(formatHrs(undefined), '0ч');
    assert.equal(formatHrs(NaN),       '0ч');
  });

  test('< 1 hour returns rounded minutes with cyrillic "м"', () => {
    assert.equal(formatHrs(60),    '1м');
    assert.equal(formatHrs(540),   '9м');
    assert.equal(formatHrs(3540),  '59м');
  });

  test('≥ 1 hour returns rounded hours with cyrillic "ч"', () => {
    assert.equal(formatHrs(3600),  '1ч');     // exact 1
    assert.equal(formatHrs(5400),  '1.5ч');
    assert.equal(formatHrs(36000), '10ч');
  });
});

describe('portfolioPulseUtils — isWipActive', () => {
  test('issue in indeterminate category is WIP', () => {
    const issue = { fields: { status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } } };
    assert.equal(isWipActive(issue), true);
  });

  test('issue with comments+changelog activity is WIP even if status is initial', () => {
    const issue = {
      fields: {
        status:  { name: 'Open', statusCategory: { key: 'new' } },
        comment: { comments: [{ created: '2026-04-27T00:00:00Z', author: {}, body: 'x' }] },
      },
      changelog: { histories: [{ created: '2026-04-27T00:00:00Z', items: [{ field: 'assignee' }] }] },
    };
    assert.equal(isWipActive(issue), true);
  });

  test('terminal status is never WIP', () => {
    const issue = { fields: { status: { name: 'Done', statusCategory: { key: 'done' } } } };
    assert.equal(isWipActive(issue), false);
  });

  test('plain Open status with no activity is NOT WIP', () => {
    const issue = { fields: { status: { name: 'Open', statusCategory: { key: 'new' } } } };
    assert.equal(isWipActive(issue), false);
  });
});

describe('portfolioPulseUtils — statusBucket', () => {
  test('Done → done', () => {
    assert.equal(statusBucket('Closed', 'done'), 'done');
  });
  test('In Progress → wip', () => {
    assert.equal(statusBucket('In Progress', 'indeterminate'), 'wip');
  });
  test('Initial → todo', () => {
    assert.equal(statusBucket('Open', 'new'), 'todo');
  });
});
