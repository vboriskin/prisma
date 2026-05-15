'use strict';
/* ============================================================
   app/crossTabSync.js — V22 (AUDIT_HOLISTIC паттерн 17 / Идея 15)
   --
   Cross-tab синхронизация состояния через BroadcastChannel API
   (+ `storage` event как fallback для legacy-браузеров без BC).

   ПРОБЛЕМА (QA AX.2): открыты 2 вкладки → обе пишут в localStorage →
   last-writer-wins → пользователь теряет правки. См. AUDIT_HOLISTIC.md
   строка 40 (паттерн 17, high-priority) + строка 169 (Идея 15).

   КОНТРАКТЫ (НЕ нарушать):
   1. Reactive.silent — мутации state из onmessage запрещены (ничего
      не делаем automatically). Сначала user-confirm (toast c кнопкой).
   2. Identity-deterministic — не генерим employee.email/jiraAccountId
      «свежими» при reload; полагаемся на Storage.load() который уже
      identity-correct.
   3. Никакого auto-merge — merge сложный, как в Notion / Linear
      пользователь сам решает «перезагрузить или продолжить».

   API (singleton):
     CrossTabSync.init()              — на старте приложения.
     CrossTabSync.notifyChange(kind?, payload?) — broadcast после Storage.save.
     CrossTabSync.onRemoteChange(handler) — подписка (returns unsubscribe).
     CrossTabSync.dispose()           — cleanup (используется в тестах).
     CrossTabSync.tabId               — readonly, ID этой вкладки.
     CrossTabSync.lastSavedAt         — ISO timestamp последнего save (для footer).

   Сообщения:
     {
       type: 'state-change' | 'lock-claim' | 'lock-release',
       tabId: string,        // отправитель (фильтруем own messages)
       ts: number,           // Date.now()
       version: number,      // PROTOCOL_VERSION (защита forward-compat)
       kind?: string,        // 'state' | 'settings' | 'rows' | ...
       payload?: any,        // optional, маленький (НЕ весь state).
     }

   Phase-2 (TODO): pessimistic lock-mode — `lock-claim` / `lock-release`
   сообщения частично заложены в протоколе, но в Phase-1 НЕ обрабатываем
   (только определены в типах). Banner «Открыто в другой вкладке (read-only)»
   потребует UX-решения + интеграции с view-layer.
   ============================================================ */

const CHANNEL_NAME    = 'prizma-sync';
const PROTOCOL_VERSION = 1;
const STORAGE_PING_KEY = 'prizma-sync-ping';   // для fallback через `storage` event

/**
 * Tab ID — uuid (если поддержан) или random36 fallback.
 * Стабильный per-tab, не персистится.
 */
function _genTabId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (_) { /* fallthrough */ }
  return 'tab-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * @typedef {Object} SyncMessage
 * @property {'state-change'|'lock-claim'|'lock-release'} type
 * @property {string} tabId
 * @property {number} ts
 * @property {number} version
 * @property {string} [kind]
 * @property {*}      [payload]
 */

const _state = {
  inited: false,
  tabId: _genTabId(),
  bc: null,            // BroadcastChannel | null
  storageHandler: null, // ref для removeEventListener
  bcHandler: null,
  handlers: new Set(),  // Set<(msg: SyncMessage) => void>
  lastSavedAt: null,    // ISO string
};

function _safeParse(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function _isOwnMessage(msg) {
  return msg && msg.tabId === _state.tabId;
}

function _isValidMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (typeof msg.type !== 'string')    return false;
  if (typeof msg.tabId !== 'string')   return false;
  if (typeof msg.ts !== 'number')      return false;
  if (typeof msg.version !== 'number') return false;
  // Protocol version skew → ignore (forward-compat).
  if (msg.version !== PROTOCOL_VERSION) return false;
  return true;
}

function _dispatch(msg) {
  if (!_isValidMessage(msg)) return;
  if (_isOwnMessage(msg))     return;   // не реагируем на свой собственный broadcast
  for (const fn of _state.handlers) {
    try { fn(msg); } catch (e) {
      // Никогда не даём handler'ам поломать друг друга.
      try { console.warn('[crossTabSync] handler threw:', e); } catch (_) {}
    }
  }
}

function _onBcMessage(ev) {
  _dispatch(ev && ev.data);
}

function _onStorageEvent(ev) {
  // Fallback path: ловим запись в STORAGE_PING_KEY от других вкладок.
  if (!ev || ev.key !== STORAGE_PING_KEY || !ev.newValue) return;
  _dispatch(_safeParse(ev.newValue));
}

/**
 * Singleton: cross-tab sync.
 * НЕ создаём class — modulу глобальное состояние нужно (handlers persist),
 * как и в `historyManager.js`.
 */
export const CrossTabSync = {
  /** Readonly — ID этой вкладки (для дебага / UI). */
  get tabId() { return _state.tabId; },

  /** Readonly — ISO timestamp последнего notifyChange (для footer). */
  get lastSavedAt() { return _state.lastSavedAt; },

  /** Readonly — `true` если init() уже отработал. */
  get isInited() { return _state.inited; },

  /** Readonly — `true` если BroadcastChannel поддерживается. */
  get hasBroadcastChannel() { return _state.bc !== null; },

  /**
   * Инициализация. Вызывается один раз на старте приложения
   * (DOMContentLoaded в app.js, после App.init).
   * Идемпотентна — повторный вызов no-op.
   */
  init() {
    if (_state.inited) return;
    _state.inited = true;

    // 1) BroadcastChannel — primary канал (Chrome 54+, FF 38+, Safari 15.4+).
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        _state.bc = new BroadcastChannel(CHANNEL_NAME);
        _state.bcHandler = _onBcMessage;
        _state.bc.addEventListener('message', _state.bcHandler);
      }
    } catch (e) {
      try { console.warn('[crossTabSync] BroadcastChannel init failed:', e); } catch (_) {}
      _state.bc = null;
    }

    // 2) `storage` event — fallback. Работает ВСЕГДА (даже когда BC поддержан),
    // потому что он бесплатный и даёт «второй источник правды» — если BC
    // поломается из-за расширения / SW, мы всё равно увидим ping.
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      _state.storageHandler = _onStorageEvent;
      try { window.addEventListener('storage', _state.storageHandler); } catch (_) {}
    }
  },

  /**
   * Broadcast «state changed» — вызывается из dataStore.js после Storage.save.
   * Не блокирующий, не throwing.
   *
   * @param {string} [kind='state']  — 'state' | 'settings' | 'rows' | 'employees'.
   * @param {*}      [payload]       — optional, диагностический. НЕ кладите весь state.
   */
  notifyChange(kind = 'state', payload = undefined) {
    if (!_state.inited) return;
    const ts = Date.now();
    _state.lastSavedAt = new Date(ts).toISOString();
    /** @type {SyncMessage} */
    const msg = {
      type: 'state-change',
      tabId: _state.tabId,
      ts,
      version: PROTOCOL_VERSION,
      kind,
    };
    if (payload !== undefined) msg.payload = payload;

    // BroadcastChannel.
    if (_state.bc) {
      try { _state.bc.postMessage(msg); } catch (_) { /* defensive */ }
    }

    // `storage` event ping — пишем И стираем (toggle), чтобы каждый
    // notify был «новый». Без `removeItem` повторное `setItem` с тем же
    // value не триггерит storage event.
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_PING_KEY, JSON.stringify(msg));
        localStorage.removeItem(STORAGE_PING_KEY);
      } catch (_) { /* quota / private mode — fine */ }
    }
  },

  /**
   * Подписка на сообщения от других вкладок. Returns unsubscribe-fn.
   * Handler НЕ должен мутировать state напрямую (см. контракты выше).
   *
   * @param {(msg: SyncMessage) => void} handler
   * @returns {() => void} unsubscribe
   */
  onRemoteChange(handler) {
    if (typeof handler !== 'function') return () => {};
    _state.handlers.add(handler);
    return () => { _state.handlers.delete(handler); };
  },

  /**
   * Cleanup. Используется в тестах + теоретически на teardown SPA
   * (пока приложение не делает teardown, но контракт держим).
   */
  dispose() {
    if (_state.bc && _state.bcHandler) {
      try { _state.bc.removeEventListener('message', _state.bcHandler); } catch (_) {}
      try { _state.bc.close(); } catch (_) {}
    }
    if (typeof window !== 'undefined' && _state.storageHandler) {
      try { window.removeEventListener('storage', _state.storageHandler); } catch (_) {}
    }
    _state.bc = null;
    _state.bcHandler = null;
    _state.storageHandler = null;
    _state.handlers.clear();
    _state.inited = false;
    _state.lastSavedAt = null;
  },

  // Phase-2 (TODO): pessimistic lock-mode.
  // claimLock()    — broadcast {type:'lock-claim'}, ждём ack от других вкладок.
  // releaseLock()  — broadcast {type:'lock-release'} на unload.
  // isLocked       — readonly, true если другая вкладка claim'нула lock.
  // Banner «Открыто в другой вкладке (read-only)» — UX-решение,
  // потребует интеграции с view-layer (disabled-state у кнопок save).
  // Пока НЕ реализуем — Phase-1 сужен до conflict-detection + user-confirm.
};

/** @internal — для тестов: получить число активных handler'ов. */
export function _debugHandlerCount() { return _state.handlers.size; }

/** @internal — для тестов: подменить tab-id (имитация другой вкладки). */
export function _debugSetTabId(id) { _state.tabId = String(id); }

/** Константы — экспорт для тестов и читаемости вызовов. */
export const CROSS_TAB_PROTOCOL_VERSION = PROTOCOL_VERSION;
export const CROSS_TAB_CHANNEL_NAME     = CHANNEL_NAME;
export const CROSS_TAB_STORAGE_PING_KEY = STORAGE_PING_KEY;
