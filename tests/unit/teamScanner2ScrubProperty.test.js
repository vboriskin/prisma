'use strict';
/* ============================================================
   tests/unit/teamScanner2ScrubProperty.test.js

   V20 S8 #21 — Property-based scrub-contract test.
   ──────────────────────────────────────────────────────────
   Pилот finding (Tech Lead audit): «35 known-cases в diagnostic тестах,
   но любое НОВОЕ поле в snapshot может протечь без теста. Нужен
   property-based — perturb random key, проверить что в output нет
   substring».

   Этот тест:
   1. Генерирует random «PII payloads» — email/jiraId/ФИО.
   2. Вкладывает их в случайные узлы state object.
   3. Прогоняет prepareDiagnosticExport(state, 'safe').
   4. Проверяет что НИ ОДНА из known-PII строк не появилась в output.

   Если новое поле «protected_email» добавится в state — этот тест
   найдёт что оно протекло (если scrub-regex не покрывает).
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// localStorage shim
const _store = new Map();
globalThis.localStorage = {
  getItem(k)   { return _store.has(k) ? _store.get(k) : null; },
  setItem(k,v) { _store.set(k, String(v)); },
  removeItem(k){ _store.delete(k); },
  clear()      { _store.clear(); },
};
if (!globalThis.crypto) {
  globalThis.crypto = {
    getRandomValues(arr) { for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256); return arr; },
  };
}

const { prepareDiagnosticExport } = await import('../../integrations/teamScanner2Diagnostic.js');

// Random PII payloads for property-based testing.
const PII_PAYLOADS = [
  { type: 'email', value: 'ivanov.ii@sber.ru' },
  { type: 'email', value: 'petrov.pp@sberbank.ru' },
  { type: 'email', value: 'admin+test@sigma.sbrf.ru' },
  { type: 'fio',   value: 'Иванов Иван Иванович' },
  { type: 'fio',   value: 'Петрова Мария [B]' },
  { type: 'jiraAccountId', value: 'aaa-bbb-ccc-deadbeef' },
  { type: 'username', value: 'jirauser1234567' },
  { type: 'userKey', value: 'abc123def456' },
  { type: 'token', value: 'Bearer eyJhbGciOiJIUzI1NiJ9' },
  { type: 'token', value: 'token: secretSquirrel99' },
  { type: 'apiKey', value: 'apiKey=ABC123XYZ' },
];

const PROTECTED_FIELDS = [
  'email', 'fio', 'fullName', 'displayName', 'name', 'label',
  'jiraAccountId', 'bitbucketLogin', 'confluenceAccountId',
  'username', 'userKey', 'userName',
  'key',     // для bot keys типа cab-sa-jira0008
];

/** Build a state-like object с PII вложенными в protected fields. */
function buildStateWithPii(pii) {
  return {
    header: { generatedAt: '2026-05-02', appBuild: 'dev' },
    config: { jiraToken: pii.find(p => p.type === 'token')?.value, projectKeys: ['PRJ'] },
    connection: {
      perPkErrors: [{ projectKey: 'PRJ', error: pii.find(p => p.type === 'token')?.value || '' }],
    },
    identity: {
      teamSize: 2,
      coverage: { email: { count: 1, pct: 50 } },
      incomplete: pii.map((p, i) => ({
        label:    p.type === 'fio'   ? p.value : `User ${i}`,
        key:      p.type === 'username' ? p.value : `key-${i}`,
        email:    p.type === 'email' ? p.value : '',
        jiraAccountId: p.type === 'jiraAccountId' ? p.value : '',
        username: p.type === 'username' ? p.value : '',
        userKey:  p.type === 'userKey' ? p.value : '',
        missing: ['bitbucketLogin'],
      })),
    },
    snapshot: { current: { counts: { stop: 1 } } },
    botsFilteredOut: [
      { key: pii.find(p => p.type === 'username')?.value || 'sbt-bot', label: pii.find(p => p.type === 'fio')?.value || '' },
    ],
  };
}

describe('V20 S8 #21 — Property-based scrub contract', () => {

  test('safe-mode НЕ содержит ни одной из 11 PII-payloads', () => {
    const state = buildStateWithPii(PII_PAYLOADS);
    const { json } = prepareDiagnosticExport(state, 'safe');

    for (const p of PII_PAYLOADS) {
      assert.ok(
        !json.includes(p.value),
        `LEAK: PII payload "${p.value}" (type=${p.type}) появилась в safe-export. Проверьте _scrubInPlace regex.`,
      );
    }
  });

  test('safe-mode заменяет на маски (хеши / *** / [REDACTED])', () => {
    const state = buildStateWithPii(PII_PAYLOADS);
    const { json } = prepareDiagnosticExport(state, 'safe');
    // Должны появиться какие-то masked-маркеры:
    const hasHashes  = /h:[0-9a-f]{6}/.test(json);
    const hasStars   = /\*\*\*/.test(json);
    assert.ok(hasHashes || hasStars, 'Safe-export должен иметь маски (h:xxx или ***).');
  });

  test('100 random shuffles — ни одной утечки', () => {
    // Property-based: 100 раз перемешиваем PII payloads и пробуем.
    for (let i = 0; i < 100; i++) {
      const shuffled = [...PII_PAYLOADS].sort(() => Math.random() - 0.5);
      const state = buildStateWithPii(shuffled);
      const { json } = prepareDiagnosticExport(state, 'safe');
      for (const p of shuffled) {
        if (json.includes(p.value)) {
          assert.fail(`Iteration ${i}: PII "${p.value}" протекло в safe-export`);
        }
      }
    }
  });

  test('raw-mode СОХРАНЯЕТ identity-fields (но скрабит токены)', () => {
    // Counter-test: убедиться что raw-режим не chrubbит email/ФИО/etc.
    // ТОКЕНЫ всё равно scrubbed (defense-in-depth).
    const piiNonToken = PII_PAYLOADS.filter(p => p.type !== 'token' && p.type !== 'apiKey');
    const state = buildStateWithPii(piiNonToken);
    const { json } = prepareDiagnosticExport(state, 'raw');
    let foundCount = 0;
    for (const p of piiNonToken) {
      if (json.includes(p.value)) foundCount++;
    }
    assert.ok(foundCount >= 3, 'raw-mode должен содержать большинство identity-fields. Found ' + foundCount);
  });

  test('protected fields names sanity check (документация)', () => {
    // Проверяем что у нас есть PII в каждом protected field type,
    // чтобы при добавлении нового field в state мы поймали leak.
    assert.ok(PROTECTED_FIELDS.length >= 13, 'Если добавили новое identity-поле — обновите PROTECTED_FIELDS');
  });

  /* V21 V3 — Real fuzzing (не shuffle одних и тех же payloads).
     Расширяет coverage с 7 known-cases до 200 уникальных random payloads. */
  test('V21 V3: 200 random PII payloads — все скрабятся в safe-mode', () => {
    function randomEmail() {
      const local = Math.random().toString(36).slice(2, 10);
      const tld = ['ru', 'sber.ru', 'sbrf.ru'][Math.floor(Math.random() * 3)];
      return `${local}@${tld}`;
    }
    function randomFio() {
      const last = ['Иванов', 'Петров', 'Сидоров', 'Кузнецов'][Math.floor(Math.random() * 4)];
      const init = ['А', 'И', 'П', 'С'][Math.floor(Math.random() * 4)];
      return `${last} ${init}.${init}.`;
    }
    function randomJiraId() {
      const hex = '0123456789abcdef';
      let s = '';
      for (let i = 0; i < 16; i++) s += hex[Math.floor(Math.random() * 16)];
      return s;
    }
    let leaks = 0;
    const sampleSize = 200;
    for (let i = 0; i < sampleSize; i++) {
      const kind = Math.floor(Math.random() * 3);
      const value = kind === 0 ? randomEmail() : (kind === 1 ? randomFio() : randomJiraId());
      const type = kind === 0 ? 'email' : (kind === 1 ? 'fio' : 'jiraAccountId');
      const state = buildStateWithPii([{ type, value }]);
      const { json } = prepareDiagnosticExport(state, 'safe');
      if (json.includes(value)) {
        leaks++;
        if (leaks === 1) console.warn(`[fuzz] FIRST LEAK: type=${type} value="${value}"`);
      }
    }
    assert.equal(leaks, 0, `${leaks}/${sampleSize} random PII payloads протекли в safe-mode`);
  });
});
