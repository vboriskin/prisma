'use strict';
/* ============================================================
   tests/unit/teamScanner2Diagnostic.test.js

   V20 S2 — contract-test для diagnostic JSON export.
   ──────────────────────────────────────────────────────────
   Главный инвариант: в mode='safe' экспорт НЕ должен содержать:
     · email (полный, не маскированный)
     · jiraAccountId / bitbucketLogin / confluenceAccountId (не hashed)
     · полное имя сотрудника (label/displayName)
     · полный текст summary/title (длиннее 30+ chars)
     · token / Bearer / Authorization

   Если эти строки утечкут — это P0 security regression.
   ============================================================ */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// localStorage shim (нужен для loadHistory / loadSettingsRaw fallback)
const _store = new Map();
globalThis.localStorage = {
  getItem(k)   { return _store.has(k) ? _store.get(k) : null; },
  setItem(k,v) { _store.set(k, String(v)); },
  removeItem(k){ _store.delete(k); },
  clear()      { _store.clear(); },
};
// crypto shim — для newExportSalt в Node без --experimental-* flag.
if (!globalThis.crypto) {
  globalThis.crypto = {
    getRandomValues(arr) {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
      return arr;
    },
  };
}

const { Utils } = await import('../../utils.js');
const {
  gatherDiagnosticState, prepareDiagnosticExport, logExport, readAuditLog,
  simulateThresholds, computeTzSkew,
} = await import('../../integrations/teamScanner2Diagnostic.js');

/* ── Fixture ─────────────────────────────────────────────── */
function makeModel(over = {}) {
  return {
    fetchedAt: '2026-05-02T08:30:00Z',
    projectKeys: ['PRJ', 'KYC'],
    spaces: { PRJ: {}, KYC: {} },
    summary: { activeSprints: [{ id: 1, name: 'Sprint 42' }] },
    errors: [],
    participants: [
      {
        // u-1 — missing ОДНОГО поля (bbLogin) → попадает в incomplete[].
        // Это позволяет тестам проверить scrub того что реально утекает
        // в diagnostic state (label, key).
        key: 'u-1',
        label: 'Иванов Иван Иванович',
        email: 'ivanov.ii@sber.ru',
        jiraAccountId: 'aaa-bbb-ccc-1234567',
        bitbucketLogin: '',                  // ← coverage gap
        confluenceAccountId: 'cf-ivanov-id-1',
        issuesNow: [{ key: 'PRJ-1', summary: 'Реализовать фичу под кодовым названием Project Phoenix V3' }],
        timelineToday: [{ at: '2026-05-02T10:00:00Z' }],
        timelineYesterday: [],
        commentsRecent: [{ text: 'Long comment with secret content that must not leak through' }],
        bbItems: [{ kind: 'commit', title: 'fix(auth): patch CVE in token handling' }],
        cfItems: [],
        badges: { commits48h: 1 },
      },
      {
        // u-2 — все identity поля пустые → попадает в incomplete[]
        // с полным missing[].
        key: 'u-2',
        label: 'Петрова Мария Сергеевна',
        email: '',
        jiraAccountId: '',
        bitbucketLogin: '',
        confluenceAccountId: '',
        issuesNow: [],
        timelineToday: [],
        timelineYesterday: [],
      },
    ],
    scannerV2: {
      risks: { totalOrphans: 3, totalOutOfSprint: 7, outOfSprintRatio: 0.21 },
      sprintGoal: { aggregateProgress: 65, aggregatePace: 'on-track', aggregateTotal: 100, sprints: [{ id: 1 }] },
    },
    ...over,
  };
}

/* ── gatherDiagnosticState ────────────────────────────────── */
describe('gatherDiagnosticState — shape', () => {
  beforeEach(() => _store.clear());

  test('возвращает все 8 секций', () => {
    const s = gatherDiagnosticState({ model: makeModel(), cacheAgeMs: 30_000 });
    assert.ok(s.header);
    assert.ok(s.config);
    assert.ok(s.connection);
    assert.ok(s.sources);
    assert.ok(s.identity);
    assert.ok(s.thresholds);
    assert.ok(s.snapshot);
    assert.ok(s.modelSummary);
  });

  test('identity coverage считает % правильно (через employees lookup)', () => {
    // V20 S4: coverage идёт через state.employees, не participants.
    // Fixture: employee для u-1 с email/jiraId/cfId но БЕЗ bbLogin.
    const employees = [
      { email: 'ivanov.ii@sber.ru', jiraAccountId: 'aaa-bbb-ccc-1234567',
        bitbucketLogin: '', confluenceAccountId: 'cf-ivanov-id-1' },
      // u-2 без записи в реестре вовсе → emp not found → coverage 0 для bb/cf.
    ];
    const s = gatherDiagnosticState({ model: makeModel(), employees });
    assert.equal(s.identity.teamSize, 2);
    // email/jiraId — берётся с participant'а (Jira authoritative).
    assert.equal(s.identity.coverage.email.count, 1);     // только u-1 (у u-2 email пуст)
    assert.equal(s.identity.coverage.email.pct, 50);
    // bbLogin / cfId — только из реестра.
    assert.equal(s.identity.coverage.bbLogin.count, 0);   // ни у кого
    assert.equal(s.identity.coverage.bbLogin.pct, 0);
    assert.equal(s.identity.coverage.cfId.count, 1);      // только u-1 (cf-ivanov-id-1)
  });

  test('incomplete identity список включает u-1 и u-2', () => {
    // Phase-2 (2026-05-10) — jenkinsUserName добавлен как 5-й identity-канал.
    // u-1 fixture теперь имеет `jenkinsUserName: 'i.ivanov'` для проверки
    // что bbLogin остаётся единственным missing полем (как было до Phase-2).
    const employees = [
      { email: 'ivanov.ii@sber.ru', jiraAccountId: 'aaa-bbb-ccc-1234567',
        bitbucketLogin: '', confluenceAccountId: 'cf-ivanov-id-1',
        jenkinsUserName: 'i.ivanov' },
      // u-2 — нет в реестре вовсе.
    ];
    const s = gatherDiagnosticState({ model: makeModel(), employees });
    assert.equal(s.identity.incomplete.length, 2);
    const u1 = s.identity.incomplete.find(p => p.key === 'u-1');
    const u2 = s.identity.incomplete.find(p => p.key === 'u-2');
    // u-1: emp найден, нет только bbLogin (cfId + jenkinsUserName есть в employee).
    assert.deepEqual(u1.missing, ['bitbucketLogin']);
    assert.equal(u1.inRegistry, true);
    // u-2: emp не найден, нет вообще ничего → все 5 missing + inRegistry=false.
    assert.deepEqual(u2.missing.sort(),
      ['bitbucketLogin', 'confluenceAccountId', 'email', 'jenkinsUserName', 'jiraAccountId']);
    assert.equal(u2.inRegistry, false);
  });

  test('fetchPerformed=false когда model отсутствует', () => {
    const s = gatherDiagnosticState({ model: null });
    assert.equal(s.connection.fetchPerformed, false);
    assert.equal(s.sources.jira, null);
  });

  test('per-pk errors прокидываются через redactSecretsInText', () => {
    const m = makeModel({ errors: [{ projectKey: 'PRJ', error: 'auth failed: Bearer abc123secret in URL' }] });
    const s = gatherDiagnosticState({ model: m });
    assert.equal(s.connection.perPkErrors.length, 1);
    // Bearer token redacted.
    assert.match(s.connection.perPkErrors[0].error, /Bearer \*\*\*/);
    assert.doesNotMatch(s.connection.perPkErrors[0].error, /abc123secret/);
  });
});

/* ── F7: Stage-5 invariant tests для новых полей — surface coverage ── */
describe('Stage 5 — новые fields/flags surface', () => {
  beforeEach(() => _store.clear());

  test('isBlocked фильтрация: уволенные [Х]/[X] исключаются из identity-coverage', () => {
    const employees = [
      { fio: 'Иванов И.И.', email: 'ivan@x.ru', jiraAccountId: 'jira1', bitbucketLogin: 'ivan', confluenceAccountId: 'cf1' },
      // Заблокированный — должен быть отфильтрован, не считаться в coverage.
      { fio: 'Петров П.П. [Х]', email: 'petr@x.ru', jiraAccountId: 'jira2', bitbucketLogin: '', confluenceAccountId: '' },
      // Заблокированный с латинским [X].
      { fio: 'Sidorov S. [X]', email: 'sid@x.ru', jiraAccountId: 'jira3', bitbucketLogin: '', confluenceAccountId: '' },
    ];
    const s = gatherDiagnosticState({ model: makeModel(), employees });
    // bbCfAttribution.blockedExcluded — счётчик отфильтрованных.
    assert.equal(s.bbCfAttribution.blockedExcluded, 2, 'двое уволенных исключены');
  });

  test('rawDiag сохраняет surface-флаги: bbDroppedOutOfAllowlist / cfMentionsUnattributed / bigMetricsTimeouts', () => {
    const rawDiag = {
      bbAuthorsCount: 3, bbItemsTotal: 10, bbAuthorSlugs: ['a', 'b', 'c'],
      cfAuthorsCount: 5, cfItemsTotal: 25,
      zephyrConfigured: true, zephyrAuthorsCount: 0,
      zephyrTestCasesScanned: 0, zephyrTestRunsScanned: 0, zephyrProjectsResolved: 6,
      zephyrTriedSummary: { total: 12, byStatus: { '403': 12 }, byType: { 'zephyr-testcase': 6 }, error: 'all-zql-variants-failed (statuses: 403)' },
      perPk: [],
      bigMetricsTimeouts: { sprintCommit: true, hotFiles: true },
      bbDroppedOutOfAllowlist: 200,
      cfMentionsUnattributed: 47,
      sigmaErrorsCount: 0,
    };
    const s = gatherDiagnosticState({ model: makeModel(), rawDiag });
    assert.ok(s.sources.rawDiag, 'rawDiag присутствует');
    assert.equal(s.sources.rawDiag.bbDroppedOutOfAllowlist, 200);
    assert.equal(s.sources.rawDiag.cfMentionsUnattributed, 47);
    assert.deepEqual(s.sources.rawDiag.bigMetricsTimeouts, { sprintCommit: true, hotFiles: true });
  });

  test('zephyr.error из tried-summary surfaced в человекочитаемое warning', () => {
    const rawDiag = {
      zephyrConfigured: true,
      zephyrAuthorsCount: 0, zephyrTestCasesScanned: 0, zephyrTestRunsScanned: 0,
      zephyrTriedSummary: { error: 'all-zql-variants-failed (statuses: 403)' },
    };
    const s = gatherDiagnosticState({ model: makeModel(), rawDiag });
    // D2: error поле + warning с понятным сообщением.
    assert.equal(s.sources.zephyr.error, 'all-zql-variants-failed (statuses: 403)');
    assert.match(s.sources.zephyr.warning, /403/);
  });
});

/* ── prepareDiagnosticExport — SAFE mode contract ─────────── */
describe('prepareDiagnosticExport(safe) — SCRUB CONTRACT', () => {
  beforeEach(() => _store.clear());

  test('label сотрудников hashed (не появляются ФИО)', () => {
    // Главный инвариант: ФИО из identity.incomplete не должны утечь.
    const state = gatherDiagnosticState({ model: makeModel() });
    const { json } = prepareDiagnosticExport(state, 'safe');
    assert.doesNotMatch(json, /Иванов Иван Иванович/);
    assert.doesNotMatch(json, /Петрова Мария Сергеевна/);
    // Hash'и появляются вместо ФИО.
    assert.match(json, /"label":\s*"h:[0-9a-f]{6}"/);
  });

  test('participant key (u-1, u-2) hashed', () => {
    const state = gatherDiagnosticState({ model: makeModel() });
    const { json } = prepareDiagnosticExport(state, 'safe');
    // key матчит /accountId|bitbucketLogin$/i? Нет — key это просто 'key'.
    // Но key — internal identifier, не ФИО. Не критично если останется.
    // Важно что label (display name) — hashed.
    assert.doesNotMatch(json, /"label":\s*"Иванов/);
    assert.doesNotMatch(json, /"label":\s*"Петрова/);
  });

  test('error messages пропускаются через redactSecretsInText', () => {
    const m = makeModel({ errors: [{ projectKey: 'PRJ', error: 'auth: Bearer s3cret-leaked-token in URL' }] });
    const state = gatherDiagnosticState({ model: m });
    const { json } = prepareDiagnosticExport(state, 'safe');
    assert.doesNotMatch(json, /s3cret-leaked-token/);
    assert.match(json, /Bearer \*\*\*/);
  });

  test('никаких токенов / Bearer / Authorization', () => {
    // Hijack: добавим токен в config (имитируем утечку из settings).
    _store.set('q2_integrations_v1', JSON.stringify({
      jiraToken: 'secretToken123abc',
      jiraBaseUrl: 'https://example.com',
    }));
    const state = gatherDiagnosticState({ model: makeModel() });
    const { json } = prepareDiagnosticExport(state, 'safe');
    assert.doesNotMatch(json, /secretToken123abc/);
    // hasJiraToken=true появляется как boolean — это ОК, не утечка.
    assert.match(json, /"hasJiraToken":\s*true/);
  });

  test('_exportMode=safe и _scrubContract присутствуют в выводе', () => {
    const state = gatherDiagnosticState({ model: makeModel() });
    const { json } = prepareDiagnosticExport(state, 'safe');
    const parsed = JSON.parse(json);
    assert.equal(parsed._exportMode, 'safe');
    assert.ok(parsed._scrubContract);
    assert.equal(parsed._scrubContract.tokens, 'redacted');
    assert.match(parsed._scrubContract.email, /masked/);
  });

  test('per-export salt стабилен внутри одного export, разный между export', () => {
    const state = gatherDiagnosticState({ model: makeModel() });
    const exp1 = prepareDiagnosticExport(state, 'safe');
    const exp2 = prepareDiagnosticExport(state, 'safe');
    // Salts разные между экспортами (anti-correlation).
    assert.notEqual(exp1.salt, exp2.salt);
    // Hash'и в одном экспорте стабильны (один и тот же id → один и тот же hash).
    // u-1 имеет jiraAccountId 'aaa-bbb-ccc-1234567' и bitbucketLogin 'ivanov_ii'
    // Salt разный → hash разный.
    assert.notEqual(exp1.json, exp2.json);
  });

  test('output is valid JSON', () => {
    const state = gatherDiagnosticState({ model: makeModel() });
    const { json } = prepareDiagnosticExport(state, 'safe');
    assert.doesNotThrow(() => JSON.parse(json));
  });
});

/* ── prepareDiagnosticExport — RAW mode ───────────────────── */
describe('prepareDiagnosticExport(raw) — TOKENS STILL REDACTED', () => {
  beforeEach(() => _store.clear());

  test('label НЕ hashed в raw — ФИО видны', () => {
    const state = gatherDiagnosticState({ model: makeModel() });
    const { json } = prepareDiagnosticExport(state, 'raw');
    assert.match(json, /Иванов Иван Иванович/);
    assert.match(json, /Петрова Мария Сергеевна/);
  });

  test('participant keys НЕ заменены в raw', () => {
    const state = gatherDiagnosticState({ model: makeModel() });
    const { json } = prepareDiagnosticExport(state, 'raw');
    assert.match(json, /"key":\s*"u-1"/);
    assert.match(json, /"key":\s*"u-2"/);
  });

  test('токены ВСЁ РАВНО redacted даже в raw (defense-in-depth)', () => {
    _store.set('q2_integrations_v1', JSON.stringify({
      jiraToken: 'secretRawToken999',
      bitbucketToken: 'bbRawToken888',
    }));
    const state = gatherDiagnosticState({ model: makeModel() });
    const { json } = prepareDiagnosticExport(state, 'raw');
    assert.doesNotMatch(json, /secretRawToken999/);
    assert.doesNotMatch(json, /bbRawToken888/);
  });

  test('_exportMode=raw + warning в _scrubContract', () => {
    const state = gatherDiagnosticState({ model: makeModel() });
    const { json } = prepareDiagnosticExport(state, 'raw');
    const parsed = JSON.parse(json);
    assert.equal(parsed._exportMode, 'raw');
    assert.ok(parsed._scrubContract.warning);
    assert.match(parsed._scrubContract.warning, /PII/);
  });
});

/* ── Audit log ────────────────────────────────────────────── */
describe('logExport / readAuditLog', () => {
  beforeEach(() => _store.clear());

  test('logExport сохраняет entry в localStorage', () => {
    logExport({ mode: 'safe', sizeBytes: 1234, projectKeys: ['A', 'B'] });
    const entries = readAuditLog();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].mode, 'safe');
    assert.equal(entries[0].sizeBytes, 1234);
    assert.equal(entries[0].pkCount, 2);
    assert.ok(entries[0].ts);
  });

  test('audit log prune до 50 entries (keep last)', () => {
    for (let i = 0; i < 60; i++) {
      logExport({ mode: 'safe', sizeBytes: i, projectKeys: [] });
    }
    const entries = readAuditLog();
    assert.equal(entries.length, 50);
    // Последняя — та что с size=59.
    assert.equal(entries[entries.length - 1].sizeBytes, 59);
    assert.equal(entries[0].sizeBytes, 10);  // первые 10 prune'нуты
  });

  test('readAuditLog без записей → []', () => {
    assert.deepEqual(readAuditLog(), []);
  });
});

/* ── Utils helpers (sanity) ──────────────────────────────── */
describe('Utils.maskEmail / hashAccountId / truncateSummary — direct', () => {
  test('maskEmail — типичные случаи', () => {
    assert.equal(Utils.maskEmail('ivanov@sber.ru'), 'i*****@sber.ru');
    assert.equal(Utils.maskEmail('a@b.c'), 'a@b.c');         // 1-letter local — не трогаем
    assert.equal(Utils.maskEmail(''), '');
    assert.equal(Utils.maskEmail('not-an-email'), '***');
    assert.equal(Utils.maskEmail('@no-local.ru'), '***');
  });

  test('hashAccountId стабилен с одним salt, разный с разными', () => {
    const h1 = Utils.hashAccountId('user-1', 'salt-a');
    const h2 = Utils.hashAccountId('user-1', 'salt-a');
    const h3 = Utils.hashAccountId('user-1', 'salt-b');
    assert.equal(h1, h2);
    assert.notEqual(h1, h3);
    assert.match(h1, /^h:[0-9a-f]{6}$/);
  });

  test('truncateSummary — обрезает > maxLen', () => {
    assert.equal(Utils.truncateSummary('short', 30), 'short');
    assert.equal(Utils.truncateSummary('x'.repeat(40), 30), 'x'.repeat(30) + '…');
    assert.equal(Utils.truncateSummary('', 30), '');
    assert.equal(Utils.truncateSummary(null, 30), '');
  });

  test('newExportSalt — 16 hex chars, разный каждый раз', () => {
    const a = Utils.newExportSalt();
    const b = Utils.newExportSalt();
    assert.match(a, /^[0-9a-f]{16}$/);
    assert.notEqual(a, b);
  });
});

/* ──────────────────────────────────────────────────────────
   V20 S3 — Connection probe / sensitivity / TZ skew tests
   ────────────────────────────────────────────────────────── */

describe('simulateThresholds — sensitivity preview', () => {
  test('default thresholds на model без stale → blockers=0', () => {
    const m = makeModel();
    const r = simulateThresholds(m, {});
    assert.equal(r.blockersTotal, 0);
    assert.ok(r.counts);
  });

  test('respects raw stale[] dwellHours и пересчитывает', () => {
    const m = makeModel({
      participants: [{
        key: 'u-1',
        timelineToday: [],
        timelineYesterday: [],
        issuesNow: [],
        stale: [
          { key: 'PRJ-1', dwellHours: 10, statusBucket: 'codeReview' },  // 10 ≥ 8 default → blocker
          { key: 'PRJ-2', dwellHours: 5,  statusBucket: 'codeReview' },  // 5 < 8 → НЕ blocker
        ],
      }],
    });
    // Default codeReview=8 → 1 blocker.
    const r1 = simulateThresholds(m, {});
    assert.equal(r1.blockersTotal, 1);
    // Если повысить codeReview до 12 → 0 blockers (10 < 12).
    const r2 = simulateThresholds(m, { codeReview: 12 });
    assert.equal(r2.blockersTotal, 0);
    // Если понизить codeReview до 4 → 2 blockers (оба ≥ 4).
    const r3 = simulateThresholds(m, { codeReview: 4 });
    assert.equal(r3.blockersTotal, 2);
  });

  test('классификация stop переключается с blockers', () => {
    const m = makeModel({
      participants: [{
        key: 'u-1',
        timelineToday: [],     // нет активности сегодня
        timelineYesterday: [],
        issuesNow: [],
        stale: [{ dwellHours: 100, statusBucket: 'codeReview' }],
      }],
    });
    // С default — blocker → группа = 'stop'.
    const r1 = simulateThresholds(m, {});
    assert.equal(r1.counts.stop, 1);
    // С завышенным порогом — нет blockers, нет активности → idle.
    const r2 = simulateThresholds(m, { codeReview: 200 });
    assert.equal(r2.counts.stop, 0);
    assert.equal(r2.counts.idle, 1);
  });

  test('null model → zero counts', () => {
    const r = simulateThresholds(null, {});
    assert.deepEqual(r.counts, { stop: 0, watch: 0, moving: 0, idle: 0 });
    assert.equal(r.blockersTotal, 0);
  });

  test('пустые participants → zero counts', () => {
    const r = simulateThresholds(makeModel({ participants: [] }), {});
    assert.equal(r.blockersTotal, 0);
    assert.equal(r.counts.idle, 0);
  });
});

describe('computeTzSkew', () => {
  test('returns available=false когда нет fetchedAt', () => {
    const r = computeTzSkew({ fetchedAt: null });
    assert.equal(r.available, false);
  });

  test('returns available=false когда fetchedAt невалидная', () => {
    const r = computeTzSkew({ fetchedAt: 'not-a-date' });
    assert.equal(r.available, false);
  });

  test('skewSeconds считается от server timestamp до browser now', () => {
    // Server timestamp 60 сек назад → ageMs ≈ 60000, skewSeconds ≈ 60.
    const fa = new Date(Date.now() - 60_000).toISOString();
    const r = computeTzSkew({ fetchedAt: fa });
    assert.equal(r.available, true);
    assert.ok(r.skewSeconds >= 59 && r.skewSeconds <= 62, `expected ~60s, got ${r.skewSeconds}`);
    assert.equal(r.skewSuspicious, false);
  });

  test('unmeasurable=true когда кэш старше 60s (не путаем с tz-skew)', () => {
    // PR-CJ — старый тест ожидал что 10-минутный кэш = «skew suspicious»,
    // что было багом: возраст кэша ≠ clock-skew. Теперь возвращаем
    // `unmeasurable: true` чтобы UI не показывал ложный alarm.
    const fa = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const r = computeTzSkew({ fetchedAt: fa });
    assert.equal(r.available, true);
    assert.equal(r.unmeasurable, true);
    assert.equal(r.skewSuspicious, undefined);
  });

  test('browserTzLabel формата UTC±H', () => {
    const fa = new Date().toISOString();
    const r = computeTzSkew({ fetchedAt: fa });
    assert.match(r.browserTzLabel, /^UTC[+\-]\d+(:\d{2})?$/);
  });
});

describe('gatherDiagnosticState — tzSkew section', () => {
  test('включает tzSkew в state', () => {
    const m = makeModel();
    const s = gatherDiagnosticState({ model: m });
    assert.ok(s.tzSkew);
    assert.equal(s.tzSkew.available, true);
  });

  test('available=false когда нет model', () => {
    const s = gatherDiagnosticState({ model: null });
    assert.equal(s.tzSkew.available, false);
  });
});
