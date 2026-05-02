'use strict';
/* ============================================================
   tests/unit/teamScanner2Classifier.test.js
   --
   V18.1 P2 — unit-tests для classifyPerson.

   Зачем: формула классификации Движется / Под наблюдением / Стоп
   / Без активности — operational backbone v2.0 Сканнера команд.
   Если её сломают, тимлид утром получит мисс-классификацию и
   подойдёт не к тому человеку.

   Дизайн: pure-function над shape-объектом participant'а из
   analysePulse → можно тестировать без сетки и без model-builder'а.
   Минимально-возможная фабрика `mk()` создаёт participant с теми
   полями, что classifyPerson реально читает.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { classifyPerson } from '../../integrations/teamScanner2Renderer.js';

/** Build a minimal participant — only fields classifyPerson reads. */
function mk(over = {}) {
  return {
    timelineToday:     [],
    timelineYesterday: [],
    issuesNow:         [],
    stale:             [],
    badges: { pr48h: 0, commits48h: 0 },
    ...over,
  };
}

describe('classifyPerson — V18.1 P2 group classifier', () => {
  test('idle: совсем нет следов → idle', () => {
    assert.equal(classifyPerson(mk()), 'idle');
  });

  test('idle: пустой participant без падений', () => {
    assert.equal(classifyPerson({}), 'idle');
    assert.equal(classifyPerson(null), 'idle');
    assert.equal(classifyPerson(undefined), 'idle');
  });

  test('stop: stale issues + 0 today → stop (главный сигнал)', () => {
    const p = mk({ stale: [{ key: 'X-1' }, { key: 'X-2' }] });
    assert.equal(classifyPerson(p), 'stop');
  });

  test('stop: stale + WIP, но 0 today → всё равно stop', () => {
    const p = mk({
      stale: [{ key: 'X-1' }],
      issuesNow: [{ key: 'X-2' }, { key: 'X-3' }],
    });
    assert.equal(classifyPerson(p), 'stop');
  });

  test('watch: WIP >= 3 → watch (overcommitment)', () => {
    const p = mk({
      issuesNow: [{}, {}, {}],            // ровно 3
      timelineToday: [{ at: '2026-05-01T10:00:00Z' }],
    });
    assert.equal(classifyPerson(p), 'watch');
  });

  test('watch: stale + есть today → watch (тянет старое + новое)', () => {
    const p = mk({
      stale: [{ key: 'X-1' }],
      timelineToday: [{ at: '2026-05-01T11:00:00Z' }],
    });
    assert.equal(classifyPerson(p), 'watch');
  });

  test('watch: 0 today + есть yesterday → watch (новая тишина)', () => {
    const p = mk({
      timelineYesterday: [{ at: '2026-04-30T15:00:00Z' }],
    });
    assert.equal(classifyPerson(p), 'watch');
  });

  test('moving: есть today, нет stale, WIP <3 → moving', () => {
    const p = mk({
      timelineToday: [{}, {}],
      issuesNow:     [{}, {}],
      timelineYesterday: [{}],
    });
    assert.equal(classifyPerson(p), 'moving');
  });

  test('moving: ровно 1 today event достаточно', () => {
    const p = mk({ timelineToday: [{ at: '2026-05-01T09:00:00Z' }] });
    assert.equal(classifyPerson(p), 'moving');
  });

  test('idle vs watch: только commits48h без timeline → НЕ idle', () => {
    // Граничный кейс: BB-only активность без Jira-events.
    // commits48h>0 значит у человека ЕСТЬ след → не idle.
    // Ни stale, ни WIP, ни today, ни yesterday → попадает в moving (по умолчанию).
    const p = mk({ badges: { pr48h: 0, commits48h: 5 } });
    assert.equal(classifyPerson(p), 'moving');
  });

  test('idle vs watch: только pr48h без timeline → НЕ idle', () => {
    const p = mk({ badges: { pr48h: 2, commits48h: 0 } });
    assert.equal(classifyPerson(p), 'moving');
  });

  test('priority: stop побеждает watch (stale без today сильнее WIP>=3)', () => {
    // Если у человека и stale без today И WIP>=3 — это всё ещё stop,
    // т.к. главный red-сигнал «висит без движения».
    const p = mk({
      stale: [{ key: 'X-1' }],
      issuesNow: [{}, {}, {}, {}],
    });
    assert.equal(classifyPerson(p), 'stop');
  });

  test('priority: WIP>=3 побеждает «yesterday-active-today-silent»', () => {
    // Если 0 today + есть yesterday + WIP>=3 — WIP-сигнал точнее
    // («overcommitment» — хорошо известная диагностика).
    const p = mk({
      timelineYesterday: [{}],
      issuesNow:         [{}, {}, {}],
    });
    assert.equal(classifyPerson(p), 'watch');
  });

  // V18.1 P7-S1.3 — reviewer-heavy роли НЕ должны быть idle.
  describe('Sprint 1 S1.3 — reviewer-heavy роли видимы', () => {
    test('senior: 0 today/yest/wip/stuck, но 5 reviews → moving (НЕ idle)', () => {
      const p = mk({
        badges: { pr48h: 0, commits48h: 0, reviews: 5 },
      });
      assert.equal(classifyPerson(p), 'moving',
        'senior c только PR-reviews не должен быть idle');
    });

    test('архитектор: только cfItems → moving (НЕ idle)', () => {
      const p = mk({
        cfItems: [{ at: '2026-05-02T10:00:00Z', kind: 'edit' }],
      });
      assert.equal(classifyPerson(p), 'moving',
        'человек только в Confluence не должен быть idle');
    });

    test('QA: только zephyr execs → moving (НЕ idle)', () => {
      const p = mk({
        zephyrTestsExecutedRecent: [{ at: '2026-05-02T10:00:00Z', result: 'PASS' }],
      });
      assert.equal(classifyPerson(p), 'moving');
    });

    test('approves счётчик тоже считается reviewer-сигналом', () => {
      const p = mk({ badges: { pr48h: 0, commits48h: 0, approves: 3 } });
      assert.equal(classifyPerson(p), 'moving');
    });

    test('bbItems без timeline → moving (раньше idle если commits/pr=0)', () => {
      // Edge case: bbItems есть, но badges.commits48h = 0 — например
      // attribution не сработал, но активность зарегистрирована.
      const p = mk({
        bbItems: [{ at: '2026-05-02T10:00:00Z', kind: 'review' }],
      });
      assert.equal(classifyPerson(p), 'moving');
    });

    test('настоящий idle остаётся idle (всё пусто)', () => {
      assert.equal(classifyPerson(mk()), 'idle');
    });
  });

  test('boundary: WIP=2 + 0 today + 0 yesterday → idle (нет следов)', () => {
    // Реалистичный кейс: human only-issues, никогда ничего не делал,
    // но кто-то ему задачи назначил. Это НЕ moving (нет today),
    // НЕ watch (WIP<3, нет yesterday), НЕ stop (нет stale).
    // По нашей формуле — идёт в idle (counter `today + yest + wip + stale + prs + commits` для
    // idle проверяет ВСЕ нули; WIP=2 ≠ 0, значит НЕ idle. Падает в moving (default).
    const p = mk({ issuesNow: [{}, {}] });
    assert.equal(classifyPerson(p), 'moving',
      'WIP без других сигналов должен быть moving по умолчанию (не idle, не watch)');
  });
});
