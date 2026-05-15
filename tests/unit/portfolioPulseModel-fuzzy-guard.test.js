'use strict';
/* ============================================================
   portfolioPulseModel-fuzzy-guard.test.js — V21
   --
   Контракт-тест на defence-in-depth для fuzzy-author-matcher
   (audit-2026-05-04 functional #3 / V17 I1c regression):

     · `opts.allowFuzzyAuthorMatch === true` САМ ПО СЕБЕ не активирует
       fuzzy-matcher — нужен ещё один dev-flag в среде.
     · В Node-тестах dev-flag — `process.env.PRIZMA_DEV_FUZZY === '1'`.
     · В browser dev-flag — `localStorage._prizma_dev_fuzzy_match === '1'`
       (не проверяется в этом тесте — не Node-окружение).

   Проверяемое поведение:
     · `allowFuzzy: true` БЕЗ env-flag        → BB-attribution = none
       (employee без `bitbucketLogin` НЕ получает данные через fuzzy-FIO).
     · `allowFuzzy: true` + `PRIZMA_DEV_FUZZY=1` → fuzzy сработал → атрибуция через FIO-match.
     · `allowFuzzy: false` (default)           → BB-attribution = none.

   Если fuzzy случайно «утечёт» в production-config — этот тест должен
   мгновенно падать. Identity-deterministic invariant охраняется.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { analysePulse } from '../../integrations/portfolioPulseModel.js';
import { withFrozenTime, ISO_2026_04_28_NOON } from '../helpers/timeFreeze.js';
import { makePulsePayload, makeRawReport, inProgressIssue } from '../fixtures/jiraPulseResponse.js';

/** Build a payload c BB-author по FIO «Иван Иванов» — нет accountId/email,
 *  только displayName-key. Это симулирует случай V17 I1c: BB вернул автора
 *  по login/displayName, но в state.employees `bitbucketLogin` не задан. */
function payloadWithFuzzyOnlyBbAuthor() {
  return makePulsePayload({
    reports: [makeRawReport({ pk: 'PAY', issues: [inProgressIssue()] })],
    bitbucket: {
      configured: true,
      tried: [],
      authors: {
        'иван иванов': { commits: 5, prs: 2, items: [] },
      },
    },
  });
}

/** Найти participant с этим FIO в model. Possible undefined если participant
 *  не появился в model (Jira issue имеет assignee `Иван Иванов`, поэтому
 *  participant создаётся). */
function findIvanov(model) {
  return (model.participants || []).find(p =>
    /иван\s*иванов/i.test(String(p.label || ''))
  );
}

describe('analysePulse — fuzzy-matcher guard (defence-in-depth)', () => {
  test('default: allowFuzzy=undefined → BB authorless остаётся authorless', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const m = analysePulse(payloadWithFuzzyOnlyBbAuthor());
    const ivanov = findIvanov(m);
    assert.ok(ivanov, 'participant Иван Иванов должен появиться через assignee Jira');
    // bitbucketLogin не задан в employees → identity-resolution не сработает.
    // Никаких commits/prs мы НЕ должны атрибутировать через FIO-fuzzy.
    assert.equal(ivanov.badges?.commits48h || 0, 0, 'fuzzy не должен сработать при default');
    assert.equal(ivanov.badges?.pr48h      || 0, 0, 'fuzzy не должен сработать при default');
  });

  test('allowFuzzy=true БЕЗ env-flag → fuzzy НЕ активируется (defence-in-depth)', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    // Гарантируем что env-flag отсутствует
    const prevEnv = process.env.PRIZMA_DEV_FUZZY;
    delete process.env.PRIZMA_DEV_FUZZY;
    t.after(() => { if (prevEnv != null) process.env.PRIZMA_DEV_FUZZY = prevEnv; });

    const m = analysePulse(payloadWithFuzzyOnlyBbAuthor(), { allowFuzzyAuthorMatch: true });
    const ivanov = findIvanov(m);
    assert.ok(ivanov);
    // КЛЮЧЕВАЯ ПРОВЕРКА: даже если caller запросил fuzzy, без env-flag
    // он не активируется → BB-данные не атрибутируются.
    assert.equal(ivanov.badges?.commits48h || 0, 0,
      'allowFuzzy=true БЕЗ PRIZMA_DEV_FUZZY=1 не должен атрибутировать BB');
    assert.equal(ivanov.badges?.pr48h      || 0, 0,
      'allowFuzzy=true БЕЗ PRIZMA_DEV_FUZZY=1 не должен атрибутировать BB');
  });

  test('allowFuzzy=true + PRIZMA_DEV_FUZZY=1 → fuzzy активируется (DevTools-режим)', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const prevEnv = process.env.PRIZMA_DEV_FUZZY;
    process.env.PRIZMA_DEV_FUZZY = '1';
    t.after(() => {
      if (prevEnv != null) process.env.PRIZMA_DEV_FUZZY = prevEnv;
      else                  delete process.env.PRIZMA_DEV_FUZZY;
    });

    const m = analysePulse(payloadWithFuzzyOnlyBbAuthor(), { allowFuzzyAuthorMatch: true });
    const ivanov = findIvanov(m);
    assert.ok(ivanov);
    // Только при ОБОИХ условиях — fuzzy сработает и атрибутирует.
    assert.equal(ivanov.badges?.commits48h, 5, 'fuzzy должен сработать при dev-flag + opt-in');
    assert.equal(ivanov.badges?.pr48h,      2);
  });

  test('allowFuzzy=false (explicit) + PRIZMA_DEV_FUZZY=1 → fuzzy не активируется', (t) => {
    const restore = withFrozenTime(ISO_2026_04_28_NOON);
    t.after(restore);
    const prevEnv = process.env.PRIZMA_DEV_FUZZY;
    process.env.PRIZMA_DEV_FUZZY = '1';
    t.after(() => {
      if (prevEnv != null) process.env.PRIZMA_DEV_FUZZY = prevEnv;
      else                  delete process.env.PRIZMA_DEV_FUZZY;
    });

    // Caller явно опустил флаг → guard вообще не доходит до env-проверки.
    const m = analysePulse(payloadWithFuzzyOnlyBbAuthor(), { allowFuzzyAuthorMatch: false });
    const ivanov = findIvanov(m);
    assert.ok(ivanov);
    assert.equal(ivanov.badges?.commits48h || 0, 0);
  });
});
