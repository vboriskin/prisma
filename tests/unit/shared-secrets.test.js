'use strict';
/* ============================================================
   tests/unit/shared-secrets.test.js
   --
   V22 holistic-P4 — unit tests для shared/secrets.js (единый scrubber
   для structured-объектов: bundle export, telemetry payload, headers).
   Контракт: модуль зеркалит / расширяет CSV._scrubSecrets из dataStore.js.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Secrets = require('../../shared/secrets.js');

describe('Secrets.isSecretFieldName', () => {
  test('точные имена — true', () => {
    assert.equal(Secrets.isSecretFieldName('token'), true);
    assert.equal(Secrets.isSecretFieldName('password'), true);
    assert.equal(Secrets.isSecretFieldName('secret'), true);
    assert.equal(Secrets.isSecretFieldName('apiKey'), true);
    assert.equal(Secrets.isSecretFieldName('bearer'), true);
  });

  test('case-insensitive + substring (CSV._scrubSecrets совместимость)', () => {
    assert.equal(Secrets.isSecretFieldName('jiraToken'), true);
    assert.equal(Secrets.isSecretFieldName('GIGACHATAUTHKEY'), true);
    assert.equal(Secrets.isSecretFieldName('myPasswordField'), true);
  });

  test('safe имена — false', () => {
    assert.equal(Secrets.isSecretFieldName('email'), false);
    assert.equal(Secrets.isSecretFieldName('name'), false);
    assert.equal(Secrets.isSecretFieldName(''), false);
    assert.equal(Secrets.isSecretFieldName(null), false);
  });

  test('новые имена V22 (accessToken/refreshToken/clientSecret) — true', () => {
    assert.equal(Secrets.isSecretFieldName('accessToken'), true);
    assert.equal(Secrets.isSecretFieldName('refreshToken'), true);
    assert.equal(Secrets.isSecretFieldName('clientSecret'), true);
  });
});

describe('Secrets.scrubObject — совместимость с CSV._scrubSecrets', () => {
  test('flat object — secret-поля удаляются', () => {
    const o = { user: 'ivan', token: 'abc123', email: 'a@b.ru' };
    const out = Secrets.scrubObject(o);
    assert.equal(out.user, 'ivan');
    assert.equal(out.email, 'a@b.ru');
    assert.equal('token' in out, false);
  });

  test('nested object — рекурсивно', () => {
    const o = {
      jira: { url: 'http://j', jiraToken: 'xxx' },
      bb:   { url: 'http://b', bitbucketToken: 'yyy' },
    };
    const out = Secrets.scrubObject(o);
    assert.equal(out.jira.url, 'http://j');
    assert.equal('jiraToken' in out.jira, false);
    assert.equal('bitbucketToken' in out.bb, false);
  });

  test('arrays — рекурсивно', () => {
    const o = { items: [{ token: 'a' }, { name: 'x' }] };
    const out = Secrets.scrubObject(o);
    assert.equal(out.items.length, 2);
    assert.equal('token' in out.items[0], false);
    assert.equal(out.items[1].name, 'x');
  });

  test('redactInsteadOfDelete — *** вместо удаления', () => {
    const o = { token: 'abc', name: 'x' };
    const out = Secrets.scrubObject(o, { redactInsteadOfDelete: true });
    assert.equal(out.token, '***');
    assert.equal(out.name, 'x');
  });

  test('formulaPrefix — ZWSP перед =/+/-/@', () => {
    const o = { cell: '=HYPERLINK(...)', plain: 'hello', neg: '-bad' };
    const out = Secrets.scrubObject(o, { formulaPrefix: true });
    // ZWSP-prefix добавлен.
    assert.notEqual(out.cell[0], '=');
    assert.notEqual(out.neg[0], '-');
    assert.equal(out.plain, 'hello');
  });

  test('null/primitives — passthrough', () => {
    assert.equal(Secrets.scrubObject(null), null);
    assert.equal(Secrets.scrubObject('str'), 'str');
    assert.equal(Secrets.scrubObject(42), 42);
  });
});

describe('Secrets.scrubHeaders', () => {
  test('Authorization → ***', () => {
    const out = Secrets.scrubHeaders({ Authorization: 'Bearer xxx', 'Content-Type': 'application/json' });
    assert.equal(out.Authorization, '***');
    assert.equal(out['Content-Type'], 'application/json');
  });

  test('Cookie / X-API-Key — тоже scrub', () => {
    const out = Secrets.scrubHeaders({ Cookie: 'JSESSIONID=...', 'X-API-Key': 'abc' });
    assert.equal(out.Cookie, '***');
    assert.equal(out['X-API-Key'], '***');
  });

  test('case-insensitive', () => {
    const out = Secrets.scrubHeaders({ AUTHORIZATION: 'x', authorization: 'y' });
    assert.equal(out.AUTHORIZATION, '***');
    assert.equal(out.authorization, '***');
  });

  test('null/empty → {}', () => {
    assert.deepEqual(Secrets.scrubHeaders(null), {});
    assert.deepEqual(Secrets.scrubHeaders(undefined), {});
  });

  test('Map — поддерживается', () => {
    const m = new Map([['Authorization', 'x'], ['x-foo', 'bar']]);
    const out = Secrets.scrubHeaders(m);
    assert.equal(out.Authorization, '***');
    assert.equal(out['x-foo'], 'bar');
  });
});

describe('Secrets.scrubFormulaPrefix', () => {
  test('= prefix → ZWSP', () => {
    const out = Secrets.scrubFormulaPrefix('=SUM(A1)');
    assert.notEqual(out[0], '=');
    assert.match(out, /SUM\(A1\)/);
  });

  test('+ - @ \\t \\r prefixes — все pre-prended', () => {
    for (const ch of ['+', '-', '@', '\t', '\r']) {
      const out = Secrets.scrubFormulaPrefix(ch + 'rest');
      assert.notEqual(out[0], ch, `failed for ${JSON.stringify(ch)}`);
    }
  });

  test('safe значения — без изменений', () => {
    assert.equal(Secrets.scrubFormulaPrefix('hello'), 'hello');
    assert.equal(Secrets.scrubFormulaPrefix(''), '');
    assert.equal(Secrets.scrubFormulaPrefix(null), '');
  });
});
