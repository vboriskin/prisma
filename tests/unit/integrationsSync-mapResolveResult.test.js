'use strict';
/* ============================================================
   integrationsSync-mapResolveResult.test.js — V22 B1+B2
   --
   Юнит-тест на pure mapResolveResultToIdentity — единственный
   адаптер между server-shape /api/integrations/resolve-identities
   и UI-mutation `state.employees[].{bitbucketLogin,confluenceAccountId}`.
   --
   Покрывает:
     · BB Stash success → slug
     · BB fallback на name (когда server вернул только `name` без `slug`)
     · BB error → ok=false, slug=''
     · CF DC success → accountId (из `accountId`)
     · CF fallback на `username` (LDAP-numeric DC ответ)
     · CF error / missing → ok=false, accountId=''
     · null/undefined input — defensive
   Без сетевых вызовов, без мутаций — pure data transform.
   ============================================================ */

const { test } = require('node:test');
const assert   = require('node:assert/strict');

let _mod;
function load() {
  if (!_mod) _mod = import('../../integrations/integrationsSync.js');
  return _mod;
}

test('mapResolveResultToIdentity: BB success → slug', async () => {
  const { mapResolveResultToIdentity } = await load();
  const r = { key: 'k1', email: 'a@b.c', bb: { ok: true, slug: 'a.user', displayName: 'A User' }, cf: { ok: false, error: 'не найден' } };
  const m = mapResolveResultToIdentity(r);
  assert.equal(m.bb.ok,    true);
  assert.equal(m.bb.slug,  'a.user');
  assert.equal(m.bb.error, null);
  assert.equal(m.cf.ok,    false);
  assert.equal(m.cf.accountId, '');
  assert.equal(m.cf.error, 'не найден');
});

test('mapResolveResultToIdentity: BB fallback на name когда нет slug', async () => {
  const { mapResolveResultToIdentity } = await load();
  // Некоторые Stash-инстансы возвращают `name` вместо `slug`.
  const r = { bb: { ok: true, name: 'a.user' }, cf: { ok: false } };
  const m = mapResolveResultToIdentity(r);
  assert.equal(m.bb.slug, 'a.user');
});

test('mapResolveResultToIdentity: BB error preserved', async () => {
  const { mapResolveResultToIdentity } = await load();
  const r = { bb: { ok: false, error: 'HTTP 401' }, cf: { ok: false } };
  const m = mapResolveResultToIdentity(r);
  assert.equal(m.bb.ok,    false);
  assert.equal(m.bb.slug,  '');
  assert.equal(m.bb.error, 'HTTP 401');
});

test('mapResolveResultToIdentity: CF DC success → accountId', async () => {
  const { mapResolveResultToIdentity } = await load();
  const r = { cf: { ok: true, accountId: '19468503', displayName: 'Иванов И.И.' }, bb: { ok: false } };
  const m = mapResolveResultToIdentity(r);
  assert.equal(m.cf.ok,        true);
  assert.equal(m.cf.accountId, '19468503');
  assert.equal(m.cf.error,     null);
});

test('mapResolveResultToIdentity: CF fallback на username (DC drift)', async () => {
  const { mapResolveResultToIdentity } = await load();
  // Если server-response drift — поле может прийти как `username` без `accountId`.
  const r = { cf: { ok: true, username: '19468503' }, bb: { ok: false } };
  const m = mapResolveResultToIdentity(r);
  assert.equal(m.cf.accountId, '19468503');
});

test('mapResolveResultToIdentity: CF not-found → empty accountId', async () => {
  const { mapResolveResultToIdentity } = await load();
  const r = { cf: { ok: false, error: 'ambiguous: 2 тёзок' }, bb: { ok: false, error: 'не найден' } };
  const m = mapResolveResultToIdentity(r);
  assert.equal(m.cf.ok,        false);
  assert.equal(m.cf.accountId, '');
  assert.equal(m.cf.error,     'ambiguous: 2 тёзок');
});

test('mapResolveResultToIdentity: missing bb/cf objects → defensive defaults', async () => {
  const { mapResolveResultToIdentity } = await load();
  const m = mapResolveResultToIdentity({});
  assert.equal(m.bb.ok,        false);
  assert.equal(m.bb.slug,      '');
  assert.equal(m.bb.error,     'не найден');
  assert.equal(m.cf.ok,        false);
  assert.equal(m.cf.accountId, '');
  assert.equal(m.cf.error,     'не найден');
});

test('mapResolveResultToIdentity: null input — не падает', async () => {
  const { mapResolveResultToIdentity } = await load();
  const m = mapResolveResultToIdentity(null);
  assert.equal(m.bb.ok, false);
  assert.equal(m.cf.ok, false);
});

test('mapResolveResultToIdentity: never returns email/PII в error', async () => {
  const { mapResolveResultToIdentity } = await load();
  // Контракт scrub-policy: error-строка не должна содержать email
  // (server должен был это сделать через _ppRedactSecretsInText).
  // Здесь проверяем что mapper не *добавляет* email/PII случайно.
  const r = { key: 'k', email: 'leak@example.com', bb: { ok: false, error: 'HTTP 500' }, cf: { ok: false, error: 'timeout' } };
  const m = mapResolveResultToIdentity(r);
  assert.ok(!m.bb.error.includes('@'), 'BB error не должен содержать email');
  assert.ok(!m.cf.error.includes('@'), 'CF error не должен содержать email');
});

/* ============================================================
   Phase-2 Jenkins (2026-05-10) — jenkins-shape support.
   ============================================================ */
test('mapResolveResultToIdentity: Jenkins success → name из jenkinsUserName', async () => {
  const { mapResolveResultToIdentity } = await load();
  const r = {
    bb: { ok: false }, cf: { ok: false },
    jenkins: { ok: true, jenkinsUserName: 'i.ivanov', fullName: 'Иванов И.И.' },
  };
  const m = mapResolveResultToIdentity(r);
  assert.equal(m.jenkins.ok,    true);
  assert.equal(m.jenkins.name,  'i.ivanov');
  assert.equal(m.jenkins.error, null);
});

test('mapResolveResultToIdentity: Jenkins fallback на id при отсутствии jenkinsUserName', async () => {
  const { mapResolveResultToIdentity } = await load();
  // Server-shape drift: иногда приходит `id` без `jenkinsUserName`.
  const r = { bb: { ok: false }, cf: { ok: false }, jenkins: { ok: true, id: '19468503' } };
  const m = mapResolveResultToIdentity(r);
  assert.equal(m.jenkins.name, '19468503');
});

test('mapResolveResultToIdentity: Jenkins error preserved', async () => {
  const { mapResolveResultToIdentity } = await load();
  const r = { bb: { ok: false }, cf: { ok: false }, jenkins: { ok: false, error: 'HTTP 401' } };
  const m = mapResolveResultToIdentity(r);
  assert.equal(m.jenkins.ok,    false);
  assert.equal(m.jenkins.name,  '');
  assert.equal(m.jenkins.error, 'HTTP 401');
});

test('mapResolveResultToIdentity: missing jenkins object → defensive defaults', async () => {
  const { mapResolveResultToIdentity } = await load();
  const m = mapResolveResultToIdentity({ bb: { ok: false }, cf: { ok: false } });
  assert.equal(m.jenkins.ok,    false);
  assert.equal(m.jenkins.name,  '');
  assert.equal(m.jenkins.error, 'не найден');
});
