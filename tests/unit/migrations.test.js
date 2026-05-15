'use strict';
/* ============================================================
   tests/unit/migrations.test.js — V21 BF (audit-08 critical-zero-coverage)
   --
   Покрывает Migrations.register / runAll: validation, sequential
   migration application, cleanup, error handling, idempotency.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

function makeLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem:    (k) => (store.has(k) ? store.get(k) : null),
    setItem:    (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear:      () => store.clear(),
    _store: store,
  };
}

async function freshMigrations(initialStorage = {}) {
  globalThis.localStorage = makeLocalStorage(initialStorage);
  globalThis.window = { addEventListener: () => {}, onerror: null };
  const url = '../../app/migrations.js?t=' + Date.now() + Math.random();
  const mod = await import(url);
  mod.Migrations._reset();
  return { Migrations: mod.Migrations, localStorage: globalThis.localStorage };
}

describe('Migrations.register — validation', () => {
  test('valid opts регистрируются', async () => {
    const { Migrations } = await freshMigrations();
    Migrations.register({ key: 'k', fromVersion: 1, toVersion: 2, migrate: x => x });
    assert.equal(Migrations._registry().length, 1);
  });

  test('пустой opts → throws', async () => {
    const { Migrations } = await freshMigrations();
    assert.throws(() => Migrations.register(null), /invalid opts/);
    assert.throws(() => Migrations.register({}), /invalid opts/);
  });

  test('missing migrate function → throws', async () => {
    const { Migrations } = await freshMigrations();
    assert.throws(() => Migrations.register({ key: 'k', fromVersion: 1, toVersion: 2 }), /invalid opts/);
  });

  test('fromVersion >= toVersion → throws', async () => {
    const { Migrations } = await freshMigrations();
    assert.throws(() => Migrations.register({ key: 'k', fromVersion: 2, toVersion: 1, migrate: x => x }), /must be </);
    assert.throws(() => Migrations.register({ key: 'k', fromVersion: 2, toVersion: 2, migrate: x => x }), /must be </);
  });

  test('non-finite versions → throws', async () => {
    const { Migrations } = await freshMigrations();
    assert.throws(() => Migrations.register({ key: 'k', fromVersion: NaN, toVersion: 2, migrate: x => x }), /invalid opts/);
    assert.throws(() => Migrations.register({ key: 'k', fromVersion: 1, toVersion: Infinity, migrate: x => x }), /invalid opts/);
  });
});

describe('Migrations.runAll — basic flow', () => {
  test('no-op если нет ничего в localStorage', async () => {
    const { Migrations, localStorage } = await freshMigrations();
    Migrations.register({ key: 'q2_plan_v3', fromVersion: 1, toVersion: 2, migrate: x => x });
    Migrations.runAll();
    assert.equal(localStorage.getItem('q2_plan_v3'), null);
  });

  test('применяет миграцию когда parsed.version совпадает с fromVersion', async () => {
    const { Migrations, localStorage } = await freshMigrations({
      'k': JSON.stringify({ version: 1, data: 'old' }),
    });
    Migrations.register({
      key: 'k', fromVersion: 1, toVersion: 2,
      migrate: parsed => ({ ...parsed, data: 'migrated' }),
    });
    Migrations.runAll();
    const after = JSON.parse(localStorage.getItem('k'));
    assert.equal(after.version, 2);
    assert.equal(after.data, 'migrated');
  });

  test('sequential v1→v2→v3 применяется по цепочке', async () => {
    const { Migrations, localStorage } = await freshMigrations({
      'k': JSON.stringify({ version: 1, value: 0 }),
    });
    Migrations.register({
      key: 'k', fromVersion: 1, toVersion: 2,
      migrate: parsed => ({ ...parsed, value: parsed.value + 10 }),
    });
    Migrations.register({
      key: 'k', fromVersion: 2, toVersion: 3,
      migrate: parsed => ({ ...parsed, value: parsed.value * 2 }),
    });
    Migrations.runAll();
    const after = JSON.parse(localStorage.getItem('k'));
    assert.equal(after.version, 3);
    assert.equal(after.value, 20, '(0 + 10) * 2 = 20');
  });

  test('пропускается если current version > всех fromVersion', async () => {
    const { Migrations, localStorage } = await freshMigrations({
      'k': JSON.stringify({ version: 5, data: 'fresh' }),
    });
    Migrations.register({
      key: 'k', fromVersion: 1, toVersion: 2,
      migrate: () => { throw new Error('should not run'); },
    });
    Migrations.runAll();
    const after = JSON.parse(localStorage.getItem('k'));
    assert.equal(after.version, 5);
    assert.equal(after.data, 'fresh');
  });

  test('migrate возвращающая null удаляет запись из localStorage', async () => {
    const { Migrations, localStorage } = await freshMigrations({
      'k': JSON.stringify({ version: 1, data: 'kill-me' }),
    });
    Migrations.register({
      key: 'k', fromVersion: 1, toVersion: 2,
      migrate: () => null,
    });
    Migrations.runAll();
    assert.equal(localStorage.getItem('k'), null);
  });
});

describe('Migrations.runAll — error handling', () => {
  test('migrate throws — оставляет старую запись и переходит к следующему ключу', async () => {
    const { Migrations, localStorage } = await freshMigrations({
      'k1': JSON.stringify({ version: 1, data: 'fail' }),
      'k2': JSON.stringify({ version: 1, data: 'ok' }),
    });
    Migrations.register({
      key: 'k1', fromVersion: 1, toVersion: 2,
      migrate: () => { throw new Error('migration boom'); },
    });
    Migrations.register({
      key: 'k2', fromVersion: 1, toVersion: 2,
      migrate: parsed => ({ ...parsed, data: 'migrated' }),
    });
    Migrations.runAll();
    // k1 — failed, должно остаться v1.
    const k1After = JSON.parse(localStorage.getItem('k1'));
    assert.equal(k1After.version, 1);
    // k2 — успешно мигрирован.
    const k2After = JSON.parse(localStorage.getItem('k2'));
    assert.equal(k2After.version, 2);
  });

  test('corrupt JSON — пропускается без throw', async () => {
    const { Migrations, localStorage } = await freshMigrations({
      'k': '{not valid json',
    });
    Migrations.register({
      key: 'k', fromVersion: 1, toVersion: 2,
      migrate: parsed => ({ ...parsed, data: 'migrated' }),
    });
    assert.doesNotThrow(() => Migrations.runAll());
    // Corrupt — оригинал не трогаем.
    assert.equal(localStorage.getItem('k'), '{not valid json');
  });

  test('non-object parsed — пропускается', async () => {
    const { Migrations, localStorage } = await freshMigrations({
      'k': '"just a string"',
    });
    Migrations.register({
      key: 'k', fromVersion: 1, toVersion: 2,
      migrate: () => { throw new Error('should not call'); },
    });
    Migrations.runAll();
    assert.equal(localStorage.getItem('k'), '"just a string"');
  });
});

describe('Migrations.runAll — idempotency', () => {
  test('повторный runAll() после успешной миграции — no-op', async () => {
    const { Migrations, localStorage } = await freshMigrations({
      'k': JSON.stringify({ version: 1, n: 1 }),
    });
    let calls = 0;
    Migrations.register({
      key: 'k', fromVersion: 1, toVersion: 2,
      migrate: parsed => { calls++; return { ...parsed, n: parsed.n + 1 }; },
    });
    Migrations.runAll();
    assert.equal(calls, 1);
    Migrations.runAll();
    Migrations.runAll();
    // После первой миграции version=2, нет registered v2→X — no-op.
    assert.equal(calls, 1);
    const after = JSON.parse(localStorage.getItem('k'));
    assert.equal(after.version, 2);
    assert.equal(after.n, 2);
  });
});
