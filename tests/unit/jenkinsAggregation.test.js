'use strict';
/* ============================================================
   tests/unit/jenkinsAggregation.test.js
   --
   Phase-1 Jenkins MVP (2026-05-10) — pure function tests for
   `_aggregateJenkinsBuilds(rawJobs)` extracted из server/jenkins.js.

   Покрывает:
     · perJob counts (builds7d / failures7d / successes7d / abortRate)
     · perAuthor attribution (actions.causes.userName + culprits.fullName)
     · 48h vs 7d window separation
     · summary.failureRatePct rounding
     · summary.deployFreqPer7d (jobs с -deploy в имени, SUCCESS only)
     · summary.mttrHours proxy: mean(time(SUCCESS) - time(prev FAILURE))
     · identity-matching contract: точное case-insensitive whitespace-trim
       (тестируется через perAuthor key normalization в caller'е — здесь
       просто проверяем что aggregator не делает fuzzy-match сам).
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { _aggregateJenkinsBuilds } = require('../../server/jenkins.js');

// Reference NOW для детерминистичных таймштампов.
const NOW = Date.parse('2026-05-10T12:00:00Z');
const HR  = 3600 * 1000;

function build(over = {}) {
  return {
    number: 1,
    timestamp: NOW - 2 * HR,    // by default 2h ago
    duration: 60 * 1000,         // 1 min
    result: 'SUCCESS',
    url: 'http://j/job/x/1/',
    actions: [],
    culprits: [],
    ...over,
  };
}

function makeAuthorAction(name) {
  return { causes: [{ userName: name }] };
}

describe('_aggregateJenkinsBuilds — basic shape', () => {
  test('пустой input → пустые counts', () => {
    const out = _aggregateJenkinsBuilds({ folder: 'sbof', jobs: [], jobBuilds: {} }, { now: NOW });
    assert.equal(out.folder, 'sbof');
    assert.equal(out.totalJobs, 0);
    assert.equal(out.scannedJobs, 0);
    assert.deepEqual(out.perJob, []);
    assert.equal(Object.keys(out.perAuthor).length, 0);
    assert.equal(out.summary.totalBuilds7d, 0);
    assert.equal(out.summary.failureRatePct, 0);
    assert.equal(out.summary.mttrHours, 0);
  });

  test('один job без builds → perJob entry с 0 builds', () => {
    const out = _aggregateJenkinsBuilds({
      folder: 'sbof',
      jobs: [{ name: 'svc-a', url: 'http://j/job/svc-a/', color: 'blue', healthReport: [{ score: 80 }] }],
      jobBuilds: {},
    }, { now: NOW });
    assert.equal(out.scannedJobs, 1);
    assert.equal(out.perJob[0].name, 'svc-a');
    assert.equal(out.perJob[0].healthScore, 80);
    assert.equal(out.perJob[0].builds7d, 0);
  });
});

describe('_aggregateJenkinsBuilds — counts per job + per author', () => {
  test('per-job builds7d / failures7d / successes7d', () => {
    const builds = [
      build({ number: 5, result: 'SUCCESS', timestamp: NOW - 1 * HR }),
      build({ number: 4, result: 'FAILURE', timestamp: NOW - 10 * HR }),
      build({ number: 3, result: 'SUCCESS', timestamp: NOW - 30 * HR }),
      build({ number: 2, result: 'ABORTED', timestamp: NOW - 50 * HR }),
      // Older than 7d — must NOT be counted
      build({ number: 1, result: 'FAILURE', timestamp: NOW - 8 * 24 * HR }),
    ];
    const out = _aggregateJenkinsBuilds({
      folder: 'sbof',
      jobs: [{ name: 'svc-a', url: '', color: 'blue', healthReport: [] }],
      jobBuilds: { 'svc-a': builds },
    }, { now: NOW });
    const j = out.perJob[0];
    assert.equal(j.builds7d, 4, '4 builds within last 7 days (excludes the 8d-old one)');
    assert.equal(j.failures7d, 1);
    assert.equal(j.successes7d, 2);
    assert.equal(j.abortRate, 0.25, 'aborted/total = 1/4');
    assert.ok(j.lastFailure);
    assert.equal(j.lastFailure.n, 4);
  });

  test('perAuthor attribution: actions.causes.userName предпочтительнее culprits', () => {
    const builds = [
      build({
        number: 10, result: 'SUCCESS', timestamp: NOW - 5 * HR,
        actions: [makeAuthorAction('Иванов Иван Иванович')],
        culprits: [{ fullName: 'Должно быть проигнорировано' }],
      }),
      build({
        number: 9, result: 'FAILURE', timestamp: NOW - 12 * HR,
        actions: [],
        culprits: [{ fullName: 'Петров Пётр Петрович' }],
      }),
    ];
    const out = _aggregateJenkinsBuilds({
      folder: 'sbof',
      jobs: [{ name: 'svc-a', url: '', color: 'blue', healthReport: [] }],
      jobBuilds: { 'svc-a': builds },
    }, { now: NOW });
    assert.ok(out.perAuthor['Иванов Иван Иванович']);
    assert.equal(out.perAuthor['Иванов Иван Иванович'].builds7d, 1);
    assert.equal(out.perAuthor['Иванов Иван Иванович'].builds48h, 1);
    assert.ok(out.perAuthor['Петров Пётр Петрович']);
    assert.equal(out.perAuthor['Петров Пётр Петрович'].failures7d, 1);
    assert.equal(out.perAuthor['Петров Пётр Петрович'].failures48h, 1);
    assert.ok(!out.perAuthor['Должно быть проигнорировано'],
      'culprits игнорируются при наличии actions.causes.userName');
  });

  test('48h окно отделено от 7d окна', () => {
    const builds = [
      build({ number: 3, result: 'SUCCESS', timestamp: NOW - 24 * HR, actions: [makeAuthorAction('A')] }),
      build({ number: 2, result: 'FAILURE', timestamp: NOW - 60 * HR, actions: [makeAuthorAction('A')] }),
      // 6 days ago — falls outside 48h but inside 7d
      build({ number: 1, result: 'SUCCESS', timestamp: NOW - 6 * 24 * HR, actions: [makeAuthorAction('A')] }),
    ];
    const out = _aggregateJenkinsBuilds({
      folder: 'sbof',
      jobs: [{ name: 'svc-a' }],
      jobBuilds: { 'svc-a': builds },
    }, { now: NOW });
    assert.equal(out.perAuthor['A'].builds7d, 3);
    assert.equal(out.perAuthor['A'].builds48h, 1, 'только 24h-build попадает в 48h окно');
    assert.equal(out.perAuthor['A'].failures7d, 1);
    assert.equal(out.perAuthor['A'].failures48h, 0, '60h-failure вне 48h окна');
  });
});

describe('_aggregateJenkinsBuilds — summary metrics', () => {
  test('failureRatePct округляется до 1 знака', () => {
    // 3 failures из 10 = 30.0%
    const builds = [];
    for (let i = 0; i < 10; i++) {
      builds.push(build({
        number: i + 1,
        result: i < 3 ? 'FAILURE' : 'SUCCESS',
        timestamp: NOW - (i + 1) * HR,
      }));
    }
    const out = _aggregateJenkinsBuilds({
      folder: 'sbof',
      jobs: [{ name: 'x' }],
      jobBuilds: { 'x': builds },
    }, { now: NOW });
    assert.equal(out.summary.totalBuilds7d, 10);
    assert.equal(out.summary.failures7d, 3);
    assert.equal(out.summary.failureRatePct, 30);
  });

  test('deployFreqPer7d считает только jobs с -deploy в имени и SUCCESS', () => {
    const okSuccess = build({ result: 'SUCCESS', timestamp: NOW - 1 * HR });
    const okFail    = build({ result: 'FAILURE', timestamp: NOW - 2 * HR });
    const out = _aggregateJenkinsBuilds({
      folder: 'sbof',
      jobs: [
        { name: 'svc-a-deploy' },
        { name: 'svc-a-build' },     // не deploy
      ],
      jobBuilds: {
        'svc-a-deploy': [okSuccess, okFail],
        'svc-a-build':  [okSuccess],
      },
    }, { now: NOW });
    assert.equal(out.summary.deployFreqPer7d, 1, 'только 1 SUCCESS на deploy-job');
  });

  test('MTTR proxy: mean(time(SUCCESS) - time(prev FAILURE)) на одном job', () => {
    // Хронология (старые → новые):
    //   t=-50h FAILURE  → SUCCESS at -48h → delta = 2h
    //   t=-30h FAILURE  → SUCCESS at -25h → delta = 5h
    // mean = (2h + 5h) / 2 = 3.5h
    const builds = [
      build({ number: 4, result: 'SUCCESS', timestamp: NOW - 25 * HR }),
      build({ number: 3, result: 'FAILURE', timestamp: NOW - 30 * HR }),
      build({ number: 2, result: 'SUCCESS', timestamp: NOW - 48 * HR }),
      build({ number: 1, result: 'FAILURE', timestamp: NOW - 50 * HR }),
    ];
    const out = _aggregateJenkinsBuilds({
      folder: 'sbof',
      jobs: [{ name: 'svc-a' }],
      jobBuilds: { 'svc-a': builds },
    }, { now: NOW });
    assert.equal(out.summary.mttrHours, 3.5);
  });

  test('MTTR=0 если нет sequence FAILURE→SUCCESS', () => {
    const builds = [
      build({ number: 2, result: 'SUCCESS', timestamp: NOW - 5 * HR }),
      build({ number: 1, result: 'SUCCESS', timestamp: NOW - 10 * HR }),
    ];
    const out = _aggregateJenkinsBuilds({
      folder: 'sbof',
      jobs: [{ name: 'svc-a' }],
      jobBuilds: { 'svc-a': builds },
    }, { now: NOW });
    assert.equal(out.summary.mttrHours, 0);
  });
});

describe('Identity-matching contract (caller-side normalization)', () => {
  // Aggregator сам по себе не делает fuzzy — он использует имя как-есть.
  // Match выполняется в caller'е (frontend orchestrator): точное
  // case-insensitive whitespace-trim. Этот тест проверяет именно ту
  // нормализацию которую делает teamScanner2.js#jenkinsData attach.
  const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');

  test('case-insensitive', () => {
    assert.equal(norm('Иванов Иван'), norm('иванов иван'));
    assert.equal(norm('JOHN DOE'), norm('john doe'));
  });

  test('whitespace-trim + collapse', () => {
    assert.equal(norm('  Иванов   Иван  '), 'иванов иван');
    assert.equal(norm('John\tDoe'), 'john doe');
  });

  test('non-match не нормализуется в одно', () => {
    assert.notEqual(norm('Иванов'), norm('Петров'));
    assert.notEqual(norm('Ivan'), norm('Ivanov'));
  });

  test('empty / null safe', () => {
    assert.equal(norm(null), '');
    assert.equal(norm(undefined), '');
    assert.equal(norm(''), '');
  });
});

/* ============================================================
   Phase-2 Jenkins (2026-05-10) — extended tests:
     · per-row J<N> chip render-logic (pure)
     · cross-team tile rendering tier (good / mid / bad failure-rate)
   ============================================================ */
describe('Phase-2: per-row J<N> chip logic', () => {
  // Чистая функция, копия inline-логики из teamScanner2Renderer.js.
  // Если изменить здесь — поправить и в renderer'е (или вынести в
  // shared util при следующем merge).
  const renderJChip = (jN, jenkinsFailures48h) => {
    if (!jN) return '';
    return `<span class="ts2-row-src-chip ts2-row-src-j" title="Jenkins билдов за 48ч: ${jN}${jenkinsFailures48h ? ` · failures: ${jenkinsFailures48h}` : ''}"><span class="ts2-row-src-chip-key">J</span><span class="ts2-row-src-chip-num">${jN}</span></span>`;
  };

  test('jN=0 → пустая строка (chip скрыт)', () => {
    assert.equal(renderJChip(0, 0), '');
  });

  test('jN=12 → chip с числом и title без failures', () => {
    const html = renderJChip(12, 0);
    assert.match(html, /ts2-row-src-j/);
    assert.match(html, /Jenkins билдов за 48ч: 12/);
    assert.ok(!/failures/.test(html));
    assert.match(html, /<span class="ts2-row-src-chip-num">12<\/span>/);
  });

  test('jN=5, failures=2 → title содержит failures', () => {
    const html = renderJChip(5, 2);
    assert.match(html, /failures: 2/);
  });
});

describe('Phase-2: cross-team tile failure-rate tier', () => {
  // Pure helper, копия логики из renderSleepingDataInsights.
  const tierClass = (frPct) => frPct >= 20 ? 'ts2-sd-bad' : (frPct >= 10 ? 'ts2-sd-mid' : 'ts2-sd-good');

  test('failureRate <10% → good', () => {
    assert.equal(tierClass(0), 'ts2-sd-good');
    assert.equal(tierClass(5), 'ts2-sd-good');
    assert.equal(tierClass(9.9), 'ts2-sd-good');
  });

  test('failureRate 10-19% → mid', () => {
    assert.equal(tierClass(10), 'ts2-sd-mid');
    assert.equal(tierClass(15), 'ts2-sd-mid');
    assert.equal(tierClass(19.9), 'ts2-sd-mid');
  });

  test('failureRate ≥20% → bad', () => {
    assert.equal(tierClass(20), 'ts2-sd-bad');
    assert.equal(tierClass(50), 'ts2-sd-bad');
    assert.equal(tierClass(100), 'ts2-sd-bad');
  });

  test('aggregation summary feeds tier через failureRatePct', () => {
    // 4 builds, 1 failure → 25% → bad
    const builds = [
      build({ number: 4, result: 'FAILURE', timestamp: NOW - 1 * HR }),
      build({ number: 3, result: 'SUCCESS', timestamp: NOW - 2 * HR }),
      build({ number: 2, result: 'SUCCESS', timestamp: NOW - 3 * HR }),
      build({ number: 1, result: 'SUCCESS', timestamp: NOW - 4 * HR }),
    ];
    const out = _aggregateJenkinsBuilds({
      folder: 'sbof',
      jobs: [{ name: 'svc-a' }],
      jobBuilds: { 'svc-a': builds },
    }, { now: NOW });
    assert.equal(out.summary.failureRatePct, 25);
    assert.equal(tierClass(out.summary.failureRatePct), 'ts2-sd-bad');
  });
});
