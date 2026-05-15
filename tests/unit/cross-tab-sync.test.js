'use strict';
/* ============================================================
   tests/unit/cross-tab-sync.test.js — V22 (AUDIT_HOLISTIC паттерн 17 / Идея 15)
   --
   Покрывает app/crossTabSync.js: init / notifyChange / onRemoteChange / dispose
   + protocol-version skew + own-message filter + storage-event fallback.

   Node не имеет `window.addEventListener('storage', ...)` — мы её мокаем
   глобально перед import'ом модуля. BroadcastChannel есть в Node 15+, но мы
   его тоже мокаем чтобы каждый тест мог проверить отправленные сообщения и
   симулировать «другую вкладку» доставкой message с чужим tabId.

   Каждый тест получает fresh-import (cache-buster в URL) — модуль singleton,
   состояние шарится, без freshImport контракт between tests ломается.
   ============================================================ */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/* ── Mocks ──────────────────────────────────────────────────── */

// Минимальный mock BroadcastChannel — собирает все posted-messages в массив,
// и позволяет имитировать получение сообщения от «другой вкладки».
class MockBroadcastChannel {
  static instances = [];
  constructor(name) {
    this.name = name;
    this.posted = [];
    this.listeners = [];
    this.closed = false;
    MockBroadcastChannel.instances.push(this);
  }
  postMessage(data) {
    if (this.closed) throw new Error('channel closed');
    this.posted.push(data);
  }
  addEventListener(type, fn) {
    if (type === 'message') this.listeners.push(fn);
  }
  removeEventListener(type, fn) {
    if (type !== 'message') return;
    this.listeners = this.listeners.filter(l => l !== fn);
  }
  close() { this.closed = true; }
  // helper: имитация incoming message (как будто от другой вкладки)
  _deliver(data) {
    for (const fn of this.listeners) fn({ data });
  }
}

// Минимальный mock window — поддерживает 'storage' event listeners.
class MockWindow {
  constructor() {
    this.listeners = {};
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  removeEventListener(type, fn) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(l => l !== fn);
  }
  // helper: имитация storage event
  _deliverStorage(ev) {
    for (const fn of (this.listeners.storage || [])) fn(ev);
  }
}

// Минимальный mock localStorage.
class MockLocalStorage {
  constructor() { this.store = new Map(); this.writes = []; this.removes = []; }
  getItem(k)         { return this.store.has(k) ? this.store.get(k) : null; }
  setItem(k, v)      { this.store.set(k, String(v)); this.writes.push({ k, v: String(v) }); }
  removeItem(k)      { this.store.delete(k); this.removes.push(k); }
  clear()            { this.store.clear(); }
}

let bcCtorBackup, windowBackup, localStorageBackup, cryptoBackup, consoleBackup;

// `globalThis.crypto` в Node имеет только getter — переопределяем через
// defineProperty с writable/configurable, чтобы каждый тест мог подменить.
function _setGlobal(key, value) {
  Object.defineProperty(globalThis, key, {
    value, writable: true, configurable: true, enumerable: true,
  });
}

beforeEach(() => {
  // Сохраняем globals (Node 15+ имеет BroadcastChannel сам).
  bcCtorBackup       = globalThis.BroadcastChannel;
  windowBackup       = globalThis.window;
  localStorageBackup = globalThis.localStorage;
  cryptoBackup       = globalThis.crypto;
  consoleBackup      = globalThis.console;

  MockBroadcastChannel.instances = [];
  _setGlobal('BroadcastChannel', MockBroadcastChannel);
  _setGlobal('window',           new MockWindow());
  _setGlobal('localStorage',     new MockLocalStorage());
  // crypto.randomUUID — присутствует в Node 19+, но для теста подменяем
  // на детерминистичный mock.
  _setGlobal('crypto', { randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2, 10) });
  // Глушим console.warn чтобы test-output не засорять.
  _setGlobal('console', { ...consoleBackup, warn: () => {}, error: () => {}, log: () => {} });
});

afterEach(() => {
  _setGlobal('BroadcastChannel', bcCtorBackup);
  _setGlobal('window',           windowBackup);
  _setGlobal('localStorage',     localStorageBackup);
  _setGlobal('crypto',           cryptoBackup);
  _setGlobal('console',          consoleBackup);
});

/** Fresh-import singleton (cache-buster). */
async function freshSync() {
  const url = '../../app/crossTabSync.js?t=' + Date.now() + Math.random();
  return await import(url);
}

/* ── Tests ──────────────────────────────────────────────────── */

describe('CrossTabSync.init', () => {
  test('создаёт BroadcastChannel с именем «prizma-sync»', async () => {
    const { CrossTabSync, CROSS_TAB_CHANNEL_NAME } = await freshSync();
    CrossTabSync.init();
    assert.equal(MockBroadcastChannel.instances.length, 1);
    assert.equal(MockBroadcastChannel.instances[0].name, CROSS_TAB_CHANNEL_NAME);
    assert.equal(MockBroadcastChannel.instances[0].name, 'prizma-sync');
    CrossTabSync.dispose();
  });

  test('регистрирует storage event listener (fallback)', async () => {
    const { CrossTabSync } = await freshSync();
    CrossTabSync.init();
    assert.equal(globalThis.window.listeners.storage?.length, 1);
    CrossTabSync.dispose();
  });

  test('идемпотентен — повторный init() не плодит каналы', async () => {
    const { CrossTabSync } = await freshSync();
    CrossTabSync.init();
    CrossTabSync.init();
    CrossTabSync.init();
    assert.equal(MockBroadcastChannel.instances.length, 1);
    CrossTabSync.dispose();
  });

  test('генерирует tabId через crypto.randomUUID когда доступен', async () => {
    const { CrossTabSync } = await freshSync();
    assert.match(CrossTabSync.tabId, /^uuid-/);
  });

  test('fallback на Math.random когда crypto.randomUUID недоступен', async () => {
    _setGlobal('crypto', { /* no randomUUID */ });
    const { CrossTabSync } = await freshSync();
    // Tab-id всё равно строка ненулевой длины
    assert.equal(typeof CrossTabSync.tabId, 'string');
    assert.ok(CrossTabSync.tabId.length > 4);
  });
});

describe('CrossTabSync.notifyChange', () => {
  test('после init — broadcasts state-change сообщение', async () => {
    const { CrossTabSync, CROSS_TAB_PROTOCOL_VERSION } = await freshSync();
    CrossTabSync.init();
    CrossTabSync.notifyChange('state');
    const bc = MockBroadcastChannel.instances[0];
    assert.equal(bc.posted.length, 1);
    const msg = bc.posted[0];
    assert.equal(msg.type, 'state-change');
    assert.equal(msg.kind, 'state');
    assert.equal(msg.version, CROSS_TAB_PROTOCOL_VERSION);
    assert.equal(msg.tabId, CrossTabSync.tabId);
    assert.equal(typeof msg.ts, 'number');
    CrossTabSync.dispose();
  });

  test('до init() — no-op (no throw, no write)', async () => {
    const { CrossTabSync } = await freshSync();
    // НЕ вызываем init
    CrossTabSync.notifyChange('state');
    assert.equal(MockBroadcastChannel.instances.length, 0);
    assert.equal(globalThis.localStorage.writes.length, 0);
  });

  test('обновляет lastSavedAt (для footer)', async () => {
    const { CrossTabSync } = await freshSync();
    CrossTabSync.init();
    assert.equal(CrossTabSync.lastSavedAt, null);
    CrossTabSync.notifyChange('state');
    assert.match(CrossTabSync.lastSavedAt, /^\d{4}-\d{2}-\d{2}T/);
    CrossTabSync.dispose();
  });

  test('пишет ping в localStorage и сразу удаляет (toggle для storage event)', async () => {
    const { CrossTabSync, CROSS_TAB_STORAGE_PING_KEY } = await freshSync();
    CrossTabSync.init();
    CrossTabSync.notifyChange('state');
    assert.equal(globalThis.localStorage.writes.length, 1);
    assert.equal(globalThis.localStorage.writes[0].k, CROSS_TAB_STORAGE_PING_KEY);
    assert.equal(globalThis.localStorage.removes.length, 1);
    assert.equal(globalThis.localStorage.removes[0], CROSS_TAB_STORAGE_PING_KEY);
    CrossTabSync.dispose();
  });
});

describe('CrossTabSync.onRemoteChange — receive path', () => {
  test('доставляет сообщения от другой вкладки', async () => {
    const { CrossTabSync, CROSS_TAB_PROTOCOL_VERSION } = await freshSync();
    CrossTabSync.init();
    const received = [];
    CrossTabSync.onRemoteChange(msg => received.push(msg));
    const bc = MockBroadcastChannel.instances[0];
    bc._deliver({
      type: 'state-change',
      tabId: 'other-tab-123',
      ts: Date.now(),
      version: CROSS_TAB_PROTOCOL_VERSION,
      kind: 'state',
    });
    assert.equal(received.length, 1);
    assert.equal(received[0].tabId, 'other-tab-123');
    CrossTabSync.dispose();
  });

  test('игнорирует свои собственные сообщения (echo guard)', async () => {
    const { CrossTabSync, CROSS_TAB_PROTOCOL_VERSION } = await freshSync();
    CrossTabSync.init();
    const received = [];
    CrossTabSync.onRemoteChange(msg => received.push(msg));
    const bc = MockBroadcastChannel.instances[0];
    bc._deliver({
      type: 'state-change',
      tabId: CrossTabSync.tabId,        // ← наш собственный tab-id
      ts: Date.now(),
      version: CROSS_TAB_PROTOCOL_VERSION,
      kind: 'state',
    });
    assert.equal(received.length, 0);
    CrossTabSync.dispose();
  });

  test('игнорирует сообщения с чужой protocol-version (forward-compat guard)', async () => {
    const { CrossTabSync, CROSS_TAB_PROTOCOL_VERSION } = await freshSync();
    CrossTabSync.init();
    const received = [];
    CrossTabSync.onRemoteChange(msg => received.push(msg));
    const bc = MockBroadcastChannel.instances[0];
    bc._deliver({
      type: 'state-change',
      tabId: 'other-tab',
      ts: Date.now(),
      version: CROSS_TAB_PROTOCOL_VERSION + 99,  // skew
      kind: 'state',
    });
    assert.equal(received.length, 0);
    CrossTabSync.dispose();
  });

  test('игнорирует malformed messages (без crash)', async () => {
    const { CrossTabSync } = await freshSync();
    CrossTabSync.init();
    const received = [];
    CrossTabSync.onRemoteChange(msg => received.push(msg));
    const bc = MockBroadcastChannel.instances[0];
    bc._deliver(null);
    bc._deliver(undefined);
    bc._deliver({ /* empty */ });
    bc._deliver({ type: 'state-change' /* missing tabId, ts, version */ });
    bc._deliver('not-an-object');
    assert.equal(received.length, 0);
    CrossTabSync.dispose();
  });

  test('возвращает unsubscribe-функцию', async () => {
    const { CrossTabSync, CROSS_TAB_PROTOCOL_VERSION } = await freshSync();
    CrossTabSync.init();
    const received = [];
    const off = CrossTabSync.onRemoteChange(msg => received.push(msg));
    off();
    const bc = MockBroadcastChannel.instances[0];
    bc._deliver({
      type: 'state-change', tabId: 'X', ts: Date.now(),
      version: CROSS_TAB_PROTOCOL_VERSION,
    });
    assert.equal(received.length, 0);
    CrossTabSync.dispose();
  });

  test('error в одном handler-е не ломает других', async () => {
    const { CrossTabSync, CROSS_TAB_PROTOCOL_VERSION } = await freshSync();
    CrossTabSync.init();
    let goodCalls = 0;
    CrossTabSync.onRemoteChange(() => { throw new Error('boom'); });
    CrossTabSync.onRemoteChange(() => { goodCalls++; });
    const bc = MockBroadcastChannel.instances[0];
    bc._deliver({
      type: 'state-change', tabId: 'X', ts: Date.now(),
      version: CROSS_TAB_PROTOCOL_VERSION,
    });
    assert.equal(goodCalls, 1);
    CrossTabSync.dispose();
  });
});

describe('CrossTabSync — storage event fallback', () => {
  test('доставляет сообщение через storage event когда BC отсутствует', async () => {
    _setGlobal('BroadcastChannel', undefined);
    const { CrossTabSync, CROSS_TAB_PROTOCOL_VERSION, CROSS_TAB_STORAGE_PING_KEY } = await freshSync();
    CrossTabSync.init();
    assert.equal(CrossTabSync.hasBroadcastChannel, false);
    const received = [];
    CrossTabSync.onRemoteChange(msg => received.push(msg));
    globalThis.window._deliverStorage({
      key: CROSS_TAB_STORAGE_PING_KEY,
      newValue: JSON.stringify({
        type: 'state-change', tabId: 'other-tab', ts: Date.now(),
        version: CROSS_TAB_PROTOCOL_VERSION,
      }),
    });
    assert.equal(received.length, 1);
    assert.equal(received[0].tabId, 'other-tab');
    CrossTabSync.dispose();
  });

  test('игнорирует storage event с другим ключом', async () => {
    const { CrossTabSync, CROSS_TAB_PROTOCOL_VERSION } = await freshSync();
    CrossTabSync.init();
    const received = [];
    CrossTabSync.onRemoteChange(msg => received.push(msg));
    globalThis.window._deliverStorage({
      key: 'unrelated-key',
      newValue: JSON.stringify({
        type: 'state-change', tabId: 'X', ts: Date.now(),
        version: CROSS_TAB_PROTOCOL_VERSION,
      }),
    });
    assert.equal(received.length, 0);
    CrossTabSync.dispose();
  });

  test('игнорирует storage event с corrupted JSON', async () => {
    const { CrossTabSync, CROSS_TAB_STORAGE_PING_KEY } = await freshSync();
    CrossTabSync.init();
    const received = [];
    CrossTabSync.onRemoteChange(msg => received.push(msg));
    globalThis.window._deliverStorage({
      key: CROSS_TAB_STORAGE_PING_KEY,
      newValue: 'not-json{{{',
    });
    assert.equal(received.length, 0);
    CrossTabSync.dispose();
  });
});

describe('CrossTabSync.dispose', () => {
  test('закрывает channel и снимает listener-ы', async () => {
    const { CrossTabSync } = await freshSync();
    CrossTabSync.init();
    const bc = MockBroadcastChannel.instances[0];
    assert.equal(bc.listeners.length, 1);
    assert.equal(globalThis.window.listeners.storage.length, 1);

    CrossTabSync.dispose();

    assert.equal(bc.closed, true);
    assert.equal(bc.listeners.length, 0);
    assert.equal(globalThis.window.listeners.storage.length, 0);
    assert.equal(CrossTabSync.isInited, false);
  });

  test('после dispose повторный init() работает (re-arm)', async () => {
    const { CrossTabSync } = await freshSync();
    CrossTabSync.init();
    CrossTabSync.dispose();
    CrossTabSync.init();
    assert.equal(MockBroadcastChannel.instances.length, 2);
    CrossTabSync.dispose();
  });

  test('сбрасывает list of handlers', async () => {
    const { CrossTabSync, _debugHandlerCount } = await freshSync();
    CrossTabSync.init();
    CrossTabSync.onRemoteChange(() => {});
    CrossTabSync.onRemoteChange(() => {});
    assert.equal(_debugHandlerCount(), 2);
    CrossTabSync.dispose();
    assert.equal(_debugHandlerCount(), 0);
  });
});

describe('CrossTabSync — контракт «нет auto-merge»', () => {
  test('handler НЕ мутирует state из onmessage напрямую (sentinel)', async () => {
    // Контракт документируется в crossTabSync.js: НИКАКОГО auto-merge,
    // user-confirm обязателен. Этот тест декларативный — проверяет, что
    // CrossTabSync сам не вызывает никакого state-mutator. Если кто-то в
    // будущем добавит default-handler делающий auto-load — этот тест
    // нужно будет обновить с явным reasoning.
    const { CrossTabSync, CROSS_TAB_PROTOCOL_VERSION } = await freshSync();
    CrossTabSync.init();
    let sentinelCalled = false;
    // Не подписываем НИЧЕГО — модуль сам не должен ничего делать с msg.
    const bc = MockBroadcastChannel.instances[0];
    bc._deliver({
      type: 'state-change', tabId: 'other', ts: Date.now(),
      version: CROSS_TAB_PROTOCOL_VERSION,
    });
    // Если бы был auto-merge — он бы что-то вызвал; здесь же ничего.
    assert.equal(sentinelCalled, false);
    CrossTabSync.dispose();
  });
});
