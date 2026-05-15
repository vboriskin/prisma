'use strict';
/* ============================================================
   tests/unit/shared-pii.test.js
   --
   V22 holistic-P4 — unit tests для shared/pii.js (единый PII-scrubber).
   Контракт: модуль зеркалит / расширяет Utils.scrubPiiInText +
   Utils.redactSecretsInText из utils.js. Любая регрессия здесь = leak
   в LLM-payload, telemetry, server logs или error toasts.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// shared/pii.js — CJS UMD. Используем createRequire (как в serverLogger.test.js).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PII = require('../../shared/pii.js');

describe('PII.scrubString — basic patterns', () => {
  test('email маскируется в [email]', () => {
    const out = PII.scrubString('Contact ivanov@sber.ru asap');
    assert.match(out, /\[email\]/);
    assert.doesNotMatch(out, /ivanov/);
  });

  test('Bearer token маскируется', () => {
    // Bare Bearer без Authorization-prefix — должен быть `Bearer ***`.
    const out1 = PII.scrubString('see Bearer eyJhbGciOiJIUzI1NiJ9 inline');
    assert.match(out1, /Bearer \*\*\*/);
    assert.doesNotMatch(out1, /eyJ/);
    // С Authorization-prefix — обе regex применяются, итог: токен не утёк.
    const out2 = PII.scrubString('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9');
    assert.doesNotMatch(out2, /eyJ/);
    assert.match(out2, /\*\*\*/);
  });

  test('СНИЛС маскируется в [snils]', () => {
    const out = PII.scrubString('СНИЛС: 123-456-789 12 проверка');
    assert.match(out, /\[snils\]/);
    assert.doesNotMatch(out, /123-456-789/);
  });

  test('паспорт маскируется в [passport]', () => {
    const out = PII.scrubString('паспорт 1234 567890 серия');
    assert.match(out, /\[passport\]/);
  });

  test('phone маскируется в [phone]', () => {
    const out = PII.scrubString('Тел +7 (999) 123-45-67 звоните');
    assert.match(out, /\[phone\]/);
    assert.doesNotMatch(out, /999/);
  });

  test('JWT-pattern (eyJ.x.y) маскируется', () => {
    const long = 'X'.repeat(25);
    const out = PII.scrubString(`token=eyJ${long}.payload123.signature456`);
    // generic-secret regex срабатывает первым (`token=` поле) — это OK,
    // важно что raw JWT не утёк.
    assert.doesNotMatch(out, /eyJ/);
  });
});

describe('PII.scrubString — edge cases', () => {
  test('null/undefined → пустая строка', () => {
    assert.equal(PII.scrubString(null), '');
    assert.equal(PII.scrubString(undefined), '');
  });

  test('truncate до maxLen', () => {
    const out = PII.scrubString('a'.repeat(500), 50);
    assert.equal(out.length, 50);
  });

  test('non-string input — coerce', () => {
    assert.equal(typeof PII.scrubString(42), 'string');
    assert.equal(typeof PII.scrubString({foo:1}), 'string');
  });

  test('multiple patterns в одной строке — все маскированы', () => {
    const out = PII.scrubString('Иванов <ivan@a.ru> (8 999 1234567) Bearer abc123', 500);
    assert.match(out, /\[email\]/);
    assert.match(out, /Bearer \*\*\*/);
    // phone должен быть тоже
    assert.doesNotMatch(out, /ivan@a\.ru/);
    assert.doesNotMatch(out, /abc123/);
  });
});

describe('PII.scrubObject — recursive', () => {
  test('строки в плоском object — scrub каждой', () => {
    const o = { name: 'Иван', email: 'a@b.ru', age: 30 };
    const out = PII.scrubObject(o);
    assert.match(out.email, /\[email\]/);
    assert.equal(out.age, 30);
  });

  test('nested + arrays — обходятся', () => {
    const o = {
      user: { mail: 'x@y.ru' },
      log: ['Bearer abc', 'normal text', { msg: 'phone +7 999 1234567' }],
    };
    const out = PII.scrubObject(o);
    assert.match(out.user.mail, /\[email\]/);
    assert.match(out.log[0], /Bearer \*\*\*/);
    assert.match(out.log[2].msg, /\[phone\]/);
  });

  test('cycle / deep — защита через maxDepth', () => {
    const a = {};
    a.self = a;
    // Не должно зацикливаться.
    const out = PII.scrubObject(a, { maxDepth: 3 });
    assert.ok(out);
  });
});

describe('PII.isLikelyPii — heuristic', () => {
  test('email → true', () => {
    assert.equal(PII.isLikelyPii('email me at a@b.ru'), true);
  });
  test('phone → true', () => {
    assert.equal(PII.isLikelyPii('+7 999 1234567'), true);
  });
  test('plain text → false', () => {
    assert.equal(PII.isLikelyPii('просто текст без PII'), false);
  });
  test('пустое/null → false', () => {
    assert.equal(PII.isLikelyPii(''), false);
    assert.equal(PII.isLikelyPii(null), false);
  });
});

describe('chat/scrubChatSecrets — wrapper compat (example phase-2 migration)', () => {
  const scrubChatSecrets = require('../../chat/scrubChatSecrets.js');

  test('Bearer scrub — то же что в legacy', () => {
    const out = scrubChatSecrets('user shared Bearer eyJfoobarbaz12345 with me');
    assert.match(out, /Bearer \*\*\*/);
  });

  test('authorization=token — то же что в legacy', () => {
    const out = scrubChatSecrets('try authorization=secret123 here');
    assert.doesNotMatch(out, /secret123/);
  });

  test('JWT pattern — то же что в legacy', () => {
    const long = 'X'.repeat(25);
    const out = scrubChatSecrets(`use eyJ${long}.payload.sig now`);
    assert.doesNotMatch(out, /eyJX/);
  });

  test('null/empty — пустая строка', () => {
    assert.equal(scrubChatSecrets(null), '');
    assert.equal(scrubChatSecrets(undefined), '');
    assert.equal(scrubChatSecrets(''), '');
  });
});

describe('PII.maskEmail — domain-preserving', () => {
  test('typical email — local stripped', () => {
    const out = PII.maskEmail('ivanov.ii@sber.ru');
    assert.match(out, /^i\*+@sber\.ru$/);
  });

  test('1-symbol local — не маскируем', () => {
    assert.equal(PII.maskEmail('x@a.b'), 'x@a.b');
  });

  test('bad input → ***', () => {
    assert.equal(PII.maskEmail(null), '');
    assert.equal(PII.maskEmail(''), '');
    assert.equal(PII.maskEmail('not-an-email'), '***');
  });
});
