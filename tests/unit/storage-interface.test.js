'use strict';
/* ============================================================
   tests/unit/storage-interface.test.js — V18 O2 (AUDIT_HOLISTIC O2)
   --
   Покрытие:
     1. validateStorageInterface — сан-проверка контракта
     2. localStorage backend save+load round-trip + keys + clear
     3. appDataStore backend with mock AppDataStore (rows path)
     4. sqlite backend with mock SQLiteStore (saveRows / getRows)
     5. migration localStorage→sqlite (через mock AppDataStore)
     6. migration sqlite→localStorage (reverse) сохраняет identity-fields
     7. edge case: empty store — keys() возвращает []
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/* ── Mock localStorage ──────────────────────────────────────
   Node не имеет localStorage. Минимальный shim. */
function makeLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key(i) { return Array.from(store.keys())[i] || null; },
    _store: store,
  };
}

/* ── Mock AppDataStore + SQLiteStore (для backend-тестов) ──── */
function makeMockSqliteStore() {
  let _rows = [];
  let _ready = false;
  const _meta = new Map();
  return {
    isReady: () => _ready,
    init: async () => { _ready = true; return true; },
    getRows: () => _rows.slice(),
    saveRows: (rs) => { _rows = Array.isArray(rs) ? rs.slice() : []; },
    clearAll: () => { _rows = []; _meta.clear(); },
    runRaw: (sql, params) => {
      const s = String(sql).toLowerCase();
      if (s.includes('insert or replace into meta')) {
        _meta.set(String(params[0]), String(params[1]));
        return [];
      }
      if (s.includes('select v from meta where k')) {
        const v = _meta.get(String(params[0]));
        return v == null ? [] : [{ v }];
      }
      if (s.includes('select k from meta')) {
        return Array.from(_meta.keys()).map(k => ({ k }));
      }
      if (s.includes('select count(*) as c from rows')) {
        return [{ c: _rows.length }];
      }
      return [];
    },
    persistNow: async () => true,
    lastError: () => '',
    size: () => 0,
    _rows: () => _rows,
  };
}

function makeMockAppDataStore(SQLiteStore, lsRows = [], modeRef = { mode: 'localStorage' }) {
  return {
    get mode() { return modeRef.mode; },
    setMode: (m) => { modeRef.mode = m === 'sqlite' ? 'sqlite' : 'localStorage'; },
    init: async () => { if (modeRef.mode === 'sqlite') await SQLiteStore.init(); },
    getRows: () => (modeRef.mode === 'sqlite' && SQLiteStore.isReady())
      ? SQLiteStore.getRows() : lsRows.slice(),
    saveRows: (rs) => {
      if (modeRef.mode === 'sqlite' && SQLiteStore.isReady()) {
        SQLiteStore.saveRows(rs);
      } else {
        lsRows.length = 0;
        if (Array.isArray(rs)) for (const r of rs) lsRows.push(r);
      }
    },
    migrateFromLocalStorage: async () => {
      if (!SQLiteStore.isReady()) await SQLiteStore.init();
      const rows = lsRows.slice();
      SQLiteStore.saveRows(rows);
      await SQLiteStore.persistNow();
      return { ok: true, rowsCount: rows.length, alreadyMigrated: false };
    },
    migrateToLocalStorage: async () => {
      if (!SQLiteStore.isReady()) await SQLiteStore.init();
      const rows = SQLiteStore.getRows();
      lsRows.length = 0;
      for (const r of rows) lsRows.push(r);
      return { ok: true, rowsCount: rows.length };
    },
    persist: async () => SQLiteStore.persistNow(),
    status: () => ({
      mode: modeRef.mode,
      sqliteReady: SQLiteStore.isReady(),
      dumpSize: 0,
      migrated: false,
    }),
  };
}

/* ── Test 1: interface validation ───────────────────────── */

describe('StorageInterface — validateStorageInterface', () => {
  test('valid object → []', async () => {
    globalThis.localStorage = makeLocalStorage();
    globalThis.window = { addEventListener: () => {}, onerror: null };
    const url = '../../app/storage/StorageInterface.js?t=' + Date.now() + Math.random();
    const { validateStorageInterface, STORAGE_KINDS } = await import(url);
    const ok = {
      kind: 'localStorage',
      save() {}, load() {}, clear() {}, keys() {}, ready() {},
    };
    assert.deepEqual(validateStorageInterface(ok), []);
    assert.ok(Array.isArray(STORAGE_KINDS) && STORAGE_KINDS.length === 3);
  });

  test('missing methods reported', async () => {
    const url = '../../app/storage/StorageInterface.js?t=' + Date.now() + Math.random();
    const { validateStorageInterface } = await import(url);
    const broken = { kind: 'sqlite', save() {}, load() {} };
    const missing = validateStorageInterface(broken);
    assert.ok(missing.includes('clear'));
    assert.ok(missing.includes('keys'));
    assert.ok(missing.includes('ready'));
  });

  test('null / non-object → <not-an-object>', async () => {
    const url = '../../app/storage/StorageInterface.js?t=' + Date.now() + Math.random();
    const { validateStorageInterface } = await import(url);
    assert.deepEqual(validateStorageInterface(null), ['<not-an-object>']);
    assert.deepEqual(validateStorageInterface('str'), ['<not-an-object>']);
  });
});

/* ── Test 2: localStorage backend round-trip ────────────── */

async function freshRouter({ ls, mockApp = null, mockSqlite = null } = {}) {
  globalThis.localStorage = ls || makeLocalStorage();
  globalThis.window = {
    AppDataStore: mockApp,
    SQLiteStore: mockSqlite,
    addEventListener: () => {}, onerror: null,
  };
  const url = '../../app/storage/StorageRouter.js?t=' + Date.now() + Math.random();
  const mod = await import(url);
  return mod.StorageRouter;
}

describe('StorageRouter — localStorage backend', () => {
  test('save+load round-trip (object)', async () => {
    const ls = makeLocalStorage();
    const Router = await freshRouter({ ls });
    const local = Router.get('localStorage');
    assert.ok(local && local.kind === 'localStorage');

    local.save('q2_test_v1', { a: 1, b: 'x' });
    const back = local.load('q2_test_v1');
    assert.deepEqual(back, { a: 1, b: 'x' });
  });

  test('keys() lists q2_* prefixed only', async () => {
    const ls = makeLocalStorage({
      q2_one: '1', q2_two: '2', other: '3',
    });
    const Router = await freshRouter({ ls });
    const local = Router.get('localStorage');
    const ks = await local.keys();
    assert.ok(ks.includes('q2_one'));
    assert.ok(ks.includes('q2_two'));
    assert.ok(!ks.includes('other'));
  });

  test('clear() removes only q2_* keys', async () => {
    const ls = makeLocalStorage({
      q2_one: '1', other: 'keep',
    });
    const Router = await freshRouter({ ls });
    const local = Router.get('localStorage');
    local.clear();
    assert.equal(ls.getItem('q2_one'), null);
    assert.equal(ls.getItem('other'), 'keep');
  });

  test('load() returns null for missing key', async () => {
    const Router = await freshRouter();
    const local = Router.get('localStorage');
    assert.equal(local.load('q2_missing'), null);
  });

  test('ready() resolves true', async () => {
    const Router = await freshRouter();
    assert.equal(await Router.get('localStorage').ready(), true);
  });
});

/* ── Test 3: sqlite backend with mock SQLiteStore ───────── */

describe('StorageRouter — sqlite backend', () => {
  test('save+load rows round-trip', async () => {
    const SQLiteStore = makeMockSqliteStore();
    const ls = makeLocalStorage();
    const Router = await freshRouter({ ls, mockSqlite: SQLiteStore });
    const sqlite = Router.get('sqlite');

    const rows = [
      { id: 'r1', team: 'Pay', epic: 'E1', isDone: false },
      { id: 'r2', team: 'Risk', epic: 'E2', isDone: true  },
    ];
    await sqlite.save('rows', rows);
    const back = await sqlite.load('rows');
    assert.equal(back.length, 2);
    assert.equal(back[0].id, 'r1');
    assert.equal(back[1].team, 'Risk');
  });

  test('save+load meta-key round-trip', async () => {
    const SQLiteStore = makeMockSqliteStore();
    const ls = makeLocalStorage();
    const Router = await freshRouter({ ls, mockSqlite: SQLiteStore });
    const sqlite = Router.get('sqlite');

    await sqlite.save('q2_some_meta', { foo: 42 });
    const back = await sqlite.load('q2_some_meta');
    assert.deepEqual(back, { foo: 42 });
  });

  test('keys() empty when no rows', async () => {
    const SQLiteStore = makeMockSqliteStore();
    await SQLiteStore.init();
    const ls = makeLocalStorage();
    const Router = await freshRouter({ ls, mockSqlite: SQLiteStore });
    const sqlite = Router.get('sqlite');
    const ks = await sqlite.keys();
    assert.ok(Array.isArray(ks));
    assert.equal(ks.length, 0);
  });

  test('ready() initialises lazily', async () => {
    const SQLiteStore = makeMockSqliteStore();
    const ls = makeLocalStorage();
    const Router = await freshRouter({ ls, mockSqlite: SQLiteStore });
    assert.equal(SQLiteStore.isReady(), false);
    const ok = await Router.get('sqlite').ready();
    assert.equal(ok, true);
    assert.equal(SQLiteStore.isReady(), true);
  });
});

/* ── Test 4: backend migrations (with skipConfirm) ──────── */

async function freshMigrations({ mockApp, mockSqlite, ls }) {
  globalThis.localStorage = ls || makeLocalStorage();
  globalThis.window = {
    AppDataStore: mockApp,
    SQLiteStore: mockSqlite,
    addEventListener: () => {}, onerror: null,
  };
  const url = '../../app/migrations.js?t=' + Date.now() + Math.random();
  const mod = await import(url);
  mod.Migrations._reset();
  return mod.Migrations;
}

describe('Migrations — backend localStorage → sqlite', () => {
  test('with skipConfirm: copies rows preserving identity-fields', async () => {
    const sqlite = makeMockSqliteStore();
    const lsRows = [
      { id: 'r1', team: 'Pay', epic: 'E1',
        assignee: 'Иванов И.', email: 'iv@example.com',
        jiraAccountId: 'JID:1', bitbucketLogin: 'iv',
        confluenceAccountId: 'CID:1' },
      { id: 'r2', team: 'Risk', epic: 'E2', assignee: 'Петров П.' },
    ];
    const modeRef = { mode: 'sqlite' };
    const app = makeMockAppDataStore(sqlite, lsRows, modeRef);
    const Migrations = await freshMigrations({ mockApp: app, mockSqlite: sqlite });

    const res = await Migrations.migrateLocalToSqlite({ skipConfirm: true });
    assert.equal(res.ok, true);
    assert.equal(res.rowsCount, 2);
    const stored = sqlite.getRows();
    assert.equal(stored.length, 2);
    // Identity-fields preserved 1:1 (CLAUDE.md contract #2):
    assert.equal(stored[0].email, 'iv@example.com');
    assert.equal(stored[0].jiraAccountId, 'JID:1');
    assert.equal(stored[0].bitbucketLogin, 'iv');
    assert.equal(stored[0].confluenceAccountId, 'CID:1');
  });

  test('without confirm + no UI → refuses migration', async () => {
    const sqlite = makeMockSqliteStore();
    const app = makeMockAppDataStore(sqlite, [], { mode: 'sqlite' });
    const Migrations = await freshMigrations({ mockApp: app, mockSqlite: sqlite });

    const res = await Migrations.migrateLocalToSqlite({});
    assert.equal(res.ok, false);
    assert.match(res.error, /No confirm UI/);
  });

  test('confirmFn returning false → cancelled', async () => {
    const sqlite = makeMockSqliteStore();
    const app = makeMockAppDataStore(sqlite, [{ id: 'r1' }], { mode: 'sqlite' });
    const Migrations = await freshMigrations({ mockApp: app, mockSqlite: sqlite });

    const res = await Migrations.migrateLocalToSqlite({
      confirmFn: async () => false,
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /Cancelled/);
  });
});

describe('Migrations — backend sqlite → localStorage (reverse)', () => {
  test('round-trip preserves identity-fields', async () => {
    const sqlite = makeMockSqliteStore();
    const lsRows = [];
    const modeRef = { mode: 'sqlite' };
    const app = makeMockAppDataStore(sqlite, lsRows, modeRef);

    // Pre-populate sqlite with rows including identity-fields
    await sqlite.init();
    const original = [
      { id: 'r1', team: 'Pay', email: 'a@b.c',
        jiraAccountId: 'JID:1', bitbucketLogin: 'a',
        confluenceAccountId: 'CID:1' },
    ];
    sqlite.saveRows(original);

    const Migrations = await freshMigrations({ mockApp: app, mockSqlite: sqlite });

    const res = await Migrations.migrateSqliteToLocal({ skipConfirm: true });
    assert.equal(res.ok, true);
    assert.equal(res.rowsCount, 1);
    assert.equal(lsRows.length, 1);
    assert.equal(lsRows[0].email, 'a@b.c');
    assert.equal(lsRows[0].jiraAccountId, 'JID:1');
    assert.equal(lsRows[0].bitbucketLogin, 'a');
    assert.equal(lsRows[0].confluenceAccountId, 'CID:1');
  });
});

/* ── Test 5: edge cases ─────────────────────────────────── */

describe('StorageRouter — edge cases', () => {
  test('use() throws on unknown kind', async () => {
    const Router = await freshRouter();
    assert.throws(() => Router.use('mongodb'), /unknown kind/);
  });

  test('get() returns null for unknown kind', async () => {
    const Router = await freshRouter();
    assert.equal(Router.get('mongodb'), null);
  });

  test('list() returns 3 backends', async () => {
    const Router = await freshRouter();
    const list = Router.list();
    assert.equal(list.length, 3);
    const kinds = list.map(b => b.kind).sort();
    assert.deepEqual(kinds, ['appDataStore', 'localStorage', 'sqlite']);
  });

  test('active() defaults to localStorage', async () => {
    const Router = await freshRouter();
    assert.equal(Router.active().kind, 'localStorage');
    Router.use('sqlite');
    assert.equal(Router.active().kind, 'sqlite');
  });

  test('appDataStore backend: rows route through facade', async () => {
    const sqlite = makeMockSqliteStore();
    const app = makeMockAppDataStore(sqlite, [], { mode: 'sqlite' });
    await app.init();
    const Router = await freshRouter({ mockApp: app, mockSqlite: sqlite });
    const ad = Router.get('appDataStore');

    const rows = [{ id: 'r1', team: 'X' }];
    await ad.save('rows', rows);
    const back = await ad.load('rows');
    assert.equal(back.length, 1);
    assert.equal(back[0].id, 'r1');
  });
});
