'use strict';
/* ============================================================
   tests/unit/portfolioPulseModel.test.js
   --
   Sample style for a complex pure module: realistic fixture +
   frozen time + isolated test cases.

   `analysePulse` is the heart of Portfolio Pulse — it takes a raw
   server payload (Jira reports + Bitbucket/Confluence aggregates)
   and produces the model that drives every tab. Time-bucketing
   (today / yesterday / dayBefore) is the most error-prone part,
   so most tests below freeze the clock.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { analysePulse, filterModelByPk } from '../../integrations/portfolioPulseModel.js';
import {
  withFrozenTime,
  ISO_2026_04_28_NOON, ISO_2026_04_27_NOON,
  ISO_2026_04_26_NOON, ISO_2026_04_25_NOON,
  ISO_2026_04_28_EARLY_AM,
} from '../helpers/timeFreeze.js';
import {
  makePulsePayload, makeRawReport,
  inProgressIssue, doneIssue, todoIssue,
  withTransition, withComment, withWorklog,
  makeBitbucketAggregate,
} from '../fixtures/jiraPulseResponse.js';

describe('analysePulse — happy path', () => {
  test('returns model with expected top-level keys', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const m = analysePulse(makePulsePayload());
    assert.ok(m.fetchedAt);
    assert.deepEqual(m.projectKeys, ['PAY']);
    assert.equal(m.jiraBaseUrl, 'https://jira.example.com');
    assert.ok(Array.isArray(m.participants));
    assert.ok(Array.isArray(m.errors));
    assert.ok(typeof m.summary === 'object');
    assert.ok(typeof m.spaces === 'object');
  });

  test('counts a single in-progress issue toward summary.wip', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const m = analysePulse(makePulsePayload({
      reports: [makeRawReport({ pk: 'PAY', issues: [inProgressIssue()] })],
    }));
    assert.equal(m.summary.totalIssues, 1);
    assert.equal(m.summary.wip,         1);
    assert.equal(m.summary.done,        0);
  });

  test('Done issue counts toward summary.done, not wip', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const m = analysePulse(makePulsePayload({
      reports: [makeRawReport({ pk: 'PAY', issues: [doneIssue()] })],
    }));
    assert.equal(m.summary.done, 1);
    assert.equal(m.summary.wip,  0);
  });

  test('initial-status issue counts as notStarted', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const m = analysePulse(makePulsePayload({
      reports: [makeRawReport({ pk: 'PAY', issues: [todoIssue()] })],
    }));
    assert.equal(m.summary.notStarted, 1);
  });

  test('null reports input does not throw, returns empty model', () => {
    const m = analysePulse(null);
    assert.equal(m.summary.totalIssues, 0);
    assert.equal(m.participants.length, 0);
    assert.equal(m.errors.length,        0);
  });

  test('per-PK error in reports[] is collected into errors[] without breaking the rest', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const m = analysePulse(makePulsePayload({
      projectKeys: ['PAY', 'KYC'],
      reports: [
        makeRawReport({ pk: 'PAY', issues: [inProgressIssue()] }),
        { projectKey: 'KYC', error: 'timeout 45000ms' },
      ],
    }));
    assert.equal(m.errors.length,            1);
    assert.equal(m.errors[0].projectKey,     'KYC');
    assert.equal(m.summary.totalIssues,      1);
    // Errored space still gets a placeholder so renderers can show "⚠"
    assert.ok(m.spaces.KYC.hasError);
  });
});

describe('analysePulse — time bucketing (today / yesterday / dayBefore)', () => {
  test('changelog transition timestamped TODAY goes to participant.timelineToday', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const issue = withTransition(
      inProgressIssue(),
      ISO_2026_04_28_EARLY_AM,
      'In Review'
    );
    const m = analysePulse(makePulsePayload({
      reports: [makeRawReport({ pk: 'PAY', issues: [issue] })],
    }));
    const ivan = m.participants.find(p => p.label.includes('Иван'));
    assert.ok(ivan, 'Иван должен попасть в participants');
    assert.equal(ivan.timelineToday.length,    1);
    assert.equal(ivan.timelineYesterday.length,0);
    assert.equal(ivan.timelinePrev.length,     0);
  });

  test('changelog transition timestamped YESTERDAY goes to timelineYesterday only', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const issue = withTransition(inProgressIssue(), ISO_2026_04_27_NOON, 'In Review');
    const m = analysePulse(makePulsePayload({
      reports: [makeRawReport({ pk: 'PAY', issues: [issue] })],
    }));
    const ivan = m.participants.find(p => p.label.includes('Иван'));
    assert.equal(ivan.timelineToday.length,     0);
    assert.equal(ivan.timelineYesterday.length, 1);
    assert.equal(ivan.timelinePrev.length,      0);
  });

  test('changelog transition timestamped DAY-BEFORE goes to timelinePrev only', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const issue = withTransition(inProgressIssue(), ISO_2026_04_26_NOON, 'In Review');
    const m = analysePulse(makePulsePayload({
      reports: [makeRawReport({ pk: 'PAY', issues: [issue] })],
    }));
    const ivan = m.participants.find(p => p.label.includes('Иван'));
    assert.equal(ivan.timelineToday.length,     0);
    assert.equal(ivan.timelineYesterday.length, 0);
    assert.equal(ivan.timelinePrev.length,      1);
  });

  test('worklog seconds aggregate into the right per-day bucket', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const issue = withWorklog(
      withWorklog(
        withWorklog(inProgressIssue(), ISO_2026_04_28_EARLY_AM, 3600),  // today: 1h
        ISO_2026_04_27_NOON, 7200                                       // yesterday: 2h
      ),
      ISO_2026_04_26_NOON, 1800                                         // dayBefore: 0.5h
    );
    const m = analysePulse(makePulsePayload({
      reports: [makeRawReport({ pk: 'PAY', issues: [issue] })],
    }));
    const ivan = m.participants.find(p => p.label.includes('Иван'));
    assert.equal(ivan.loggedTodaySec,     3600);
    assert.equal(ivan.loggedYesterdaySec, 7200);
    assert.equal(ivan.loggedDayBeforeSec, 1800);
  });

  test('comment timestamped TODAY adds to commentsToday AND timelineToday', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const issue = withComment(inProgressIssue(), ISO_2026_04_28_EARLY_AM, 'Сегодняшний коммент');
    const m = analysePulse(makePulsePayload({
      reports: [makeRawReport({ pk: 'PAY', issues: [issue] })],
    }));
    const ivan = m.participants.find(p => p.label.includes('Иван'));
    assert.equal(ivan.commentsToday.length, 1);
    assert.equal(ivan.timelineToday.length, 1);
    assert.equal(ivan.timelineToday[0].kind, 'comment');
  });

  test('issue created TODAY by reporter goes to issuesCreatedToday', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const issue = inProgressIssue({
      fields: {
        created:  ISO_2026_04_28_EARLY_AM,
        reporter: { displayName: 'Иван Иванов', emailAddress: 'ivan@example.com' },
      },
    });
    const m = analysePulse(makePulsePayload({
      reports: [makeRawReport({ pk: 'PAY', issues: [issue] })],
    }));
    const ivan = m.participants.find(p => p.label.includes('Иван'));
    assert.equal(ivan.issuesCreatedToday.length, 1);
  });

  test('events older than dayBefore are ignored entirely', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const issue = withTransition(inProgressIssue(), ISO_2026_04_25_NOON, 'In Review');
    const m = analysePulse(makePulsePayload({
      reports: [makeRawReport({ pk: 'PAY', issues: [issue] })],
    }));
    // Иван still appears as participant via assignee on issuesNow,
    // but timeline buckets stay empty for this old transition.
    const ivan = m.participants.find(p => p.label.includes('Иван'));
    if (ivan) {
      assert.equal(ivan.timelineToday.length,     0);
      assert.equal(ivan.timelineYesterday.length, 0);
      assert.equal(ivan.timelinePrev.length,      0);
    }
  });
});

describe('analysePulse — Bitbucket badge hydration', () => {
  test('matches author by lowercased displayName, hydrates badges', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const m = analysePulse(makePulsePayload({
      reports:  [makeRawReport({ pk: 'PAY', issues: [inProgressIssue()] })],
      bitbucket: makeBitbucketAggregate(),
    }));
    const ivan = m.participants.find(p => p.label.includes('Иван'));
    assert.ok(ivan, 'Иван должен матчиться');
    assert.equal(ivan.badges.commits48h, 5);
    assert.equal(ivan.badges.pr48h,      2);
  });

  test('V17.2 I1c: fuzzy RU↔EN match SUPPRESSED по умолчанию (deterministic identity required)', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    // V17.2 I1c — V12 fuzzy-transliteration отключён в production: чужие
    //   PR раздавались сотрудникам с похожими ФИО. Теперь требуется
    //   email/login/accountId match. Без identity — badges остаются 0.
    const m = analysePulse(makePulsePayload({
      reports: [makeRawReport({ pk: 'PAY', issues: [inProgressIssue()] })],
      bitbucket: {
        configured: true, tried: [],
        authors: {
          'ivanov ivan': { displayName: 'Ivanov Ivan', commits: 3, prs: 1 /* нет email — нет привязки */ },
        },
      },
    }));
    const ivan = m.participants.find(p => p.label.includes('Иван'));
    assert.ok(ivan);
    assert.equal(ivan.badges.commits48h, 0, 'без identity-match commits НЕ должны привязаться');
    assert.equal(ivan.badges.pr48h,      0, 'без identity-match prs НЕ должны привязаться');
  });

  test('V17.2 I1c: identity-match по email (BB author с тем же email что у Jira-участника)', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    // Жизненный кейс: latin login в BB но тот же email что у Jira ассайни.
    const m = analysePulse(makePulsePayload({
      reports: [makeRawReport({ pk: 'PAY', issues: [inProgressIssue()] })],
      bitbucket: {
        configured: true, tried: [],
        authors: {
          'ivanov ivan': { displayName: 'Ivanov Ivan', email: 'ivan@example.com', commits: 3, prs: 1 },
        },
      },
    }));
    const ivan = m.participants.find(p => p.label.includes('Иван'));
    assert.ok(ivan);
    assert.equal(ivan.badges.commits48h, 3);
    assert.equal(ivan.badges.pr48h,      1);
  });

  test('V17.2 I1c: identity-match через state.employees → bitbucketLogin', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    // Жизненный кейс: email в Jira не совпадает с email в BB, но
    // у сотрудника в state.employees есть bitbucketLogin = 'i.ivanov'.
    const m = analysePulse(makePulsePayload({
      reports: [makeRawReport({ pk: 'PAY', issues: [inProgressIssue()] })],
      bitbucket: {
        configured: true, tried: [],
        authors: {
          'i.ivanov': { displayName: 'Ivanov Ivan', commits: 3, prs: 1 },
        },
      },
    }), { employees: [{ fio: 'Иван Иванов', email: 'ivan@example.com', bitbucketLogin: 'i.ivanov' }] });
    const ivan = m.participants.find(p => p.label.includes('Иван'));
    assert.ok(ivan);
    assert.equal(ivan.badges.commits48h, 3);
    assert.equal(ivan.badges.pr48h,      1);
  });

  test('non-matching author does not pollute participant badges', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const m = analysePulse(makePulsePayload({
      reports: [makeRawReport({ pk: 'PAY', issues: [inProgressIssue()] })],
      bitbucket: {
        configured: true, tried: [],
        authors: { 'unknown user': { displayName: 'Unknown User', commits: 99, prs: 99 } },
      },
    }));
    const ivan = m.participants.find(p => p.label.includes('Иван'));
    assert.equal(ivan.badges.commits48h, 0);
  });
});

describe('filterModelByPk — recompute summary + filter scope', () => {
  test('empty pk returns the original model unchanged', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const m = analysePulse(makePulsePayload());
    assert.strictEqual(filterModelByPk(m, ''), m);
  });

  test('filtered model contains only the requested PK in spaces', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const m = analysePulse(makePulsePayload({
      projectKeys: ['PAY', 'KYC'],
      reports: [
        makeRawReport({ pk: 'PAY', issues: [inProgressIssue({ key: 'PAY-1' })] }),
        makeRawReport({ pk: 'KYC', issues: [inProgressIssue({ key: 'KYC-1', fields: { assignee: { displayName: 'Анна Петрова', emailAddress: 'anna@x' } } })] }),
      ],
    }));
    const filtered = filterModelByPk(m, 'PAY');
    assert.deepEqual(Object.keys(filtered.spaces), ['PAY']);
    assert.equal(filtered.summary.totalIssues, 1);
  });

  test('participants without items in active PK are dropped', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const m = analysePulse(makePulsePayload({
      projectKeys: ['PAY', 'KYC'],
      reports: [
        makeRawReport({ pk: 'PAY', issues: [inProgressIssue({ key: 'PAY-1' })] }),
        makeRawReport({
          pk: 'KYC',
          issues: [inProgressIssue({ key: 'KYC-1', fields: { assignee: { displayName: 'Анна Петрова', emailAddress: 'anna@x' } } })],
        }),
      ],
    }));
    const filtered = filterModelByPk(m, 'PAY');
    assert.equal(filtered.participants.length, 1);
    assert.match(filtered.participants[0].label, /Иван/);
  });

  test('summary.wip recomputes correctly for filtered subset', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const m = analysePulse(makePulsePayload({
      projectKeys: ['PAY', 'KYC'],
      reports: [
        makeRawReport({ pk: 'PAY', issues: [inProgressIssue({ key: 'PAY-1' })] }),
        makeRawReport({ pk: 'KYC', issues: [doneIssue({ key: 'KYC-1' })] }),
      ],
    }));
    assert.equal(m.summary.wip,  1);
    assert.equal(m.summary.done, 1);
    const onlyPay = filterModelByPk(m, 'PAY');
    assert.equal(onlyPay.summary.wip,  1);
    assert.equal(onlyPay.summary.done, 0);
  });

  test('does not mutate the original model', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const m = analysePulse(makePulsePayload({
      projectKeys: ['PAY', 'KYC'],
      reports: [
        makeRawReport({ pk: 'PAY', issues: [inProgressIssue({ key: 'PAY-1' })] }),
        makeRawReport({ pk: 'KYC', issues: [doneIssue({ key: 'KYC-1' })] }),
      ],
    }));
    const beforePks = Object.keys(m.spaces).sort();
    filterModelByPk(m, 'PAY');
    const afterPks = Object.keys(m.spaces).sort();
    assert.deepEqual(beforePks, afterPks);
    assert.equal(m.summary.totalIssues, 2); // original summary untouched
  });
});
