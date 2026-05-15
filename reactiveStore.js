'use strict';
/* ============================================================
   AUDIT_ARCHITECTURE #4 — Reactive vs legacy event-bus.

   PROEKTE SOSUSHCHESTVUYUT DVA mexanizma podpiski na izmeneniya state'a:

   1. Reactive.subscribe (etot fail) — auto-flush. Lyubaya mutation
      `state.x = y` cherez Proxy => debounced (100ms) notification
      vsem podpischikam. Reason ne peredaetsya — "chto-to izmenilos'".
      Ispol'zovat' dlya: Storage.save, App.refreshAll, vidov-listener'ov.

   2. subscribe / notify v state.js — explicit named-event bus
      ('chat_filter', 'import', 'restore'). Caller dolzhen ruchno
      vyzvat' notify('reason').
      Ispol'zovat' dlya: scenarios gde tip sobytiya vazhen.

   PRAVILO: NE ispol'zuyte oba odnovremenno dlya odnogo i togo zhe
   sobytiya — eto pridet k dvoynoy notifikacii (i double-render).
   Predpochitayte Reactive dlya novogo koda; legacy notify()
   ostavlen iz-za sushchestvuyushchix specificheskix podpischikov.
   ============================================================ */

/* ============================================================
   reactiveStore.js — minimal Proxy-based reactive layer over `state`.
   --
   Goal (audit #6): remove manual `App.refreshAll()` / `Storage.save()`
   after every mutation. Wraps state in a Proxy that:

     · Catches `set` / `deleteProperty` on any nested path
     · Debounces (100 ms) and notifies subscribers — they decide what to
       do (save, refresh, or both)
     · Provides `silent(fn)` to bypass — for HistoryManager.apply,
       Storage.load and other "internal restorations" that must not
       trigger a save loop
     · Preserves object identity via WeakMap cache so `state.rows[0] ===
       state.rows[0]` holds across accesses

   What it does NOT do:
     · Doesn't track per-property dependencies (no Vue-style fine-grained
       reactivity). One subscriber = "something changed". Good enough.
     · Doesn't intercept Set / Map mutations (`state.bulkSelected.add()`).
       Caller must `Reactive.flushNow()` after Set ops. Documented.
     · Doesn't auto-save on EVERY change — subscriber decides via opts.

   API:
     Reactive.wrap(obj)            → Proxy (idempotent — re-wrapping is no-op)
     Reactive.silent(fn)           → run fn without firing notifications
     Reactive.subscribe(fn)        → fn() called debounced after a batch
     Reactive.flushNow()           → cancel debounce, fire subscribers now
     Reactive.isReactive(obj)      → boolean

   Coexists with the existing notify/subscribe in state.js — that one is
   for explicit reason-based events (import-csv, restore, chat_filter, …).
   This one is for the "something mutated" auto-flush.
   ============================================================ */

import { Services } from './app/services.js';

const REACTIVE_MARK = Symbol.for('q2.reactive.mark');
const RAW_TARGET    = Symbol.for('q2.reactive.raw');
const PROXY_CACHE   = new WeakMap();   // raw object → its proxy

// Globals: silent counter (re-entrant), debounce timer, subscriber list,
// and a `_dirty` flag so `flushNow()` only fires when there were ACTUAL
// mutations since the last flush. Without `_dirty`, calling flushNow()
// after a silent() block would still fire subscribers spuriously.
let _silentDepth = 0;
let _flushTimer  = null;
let _dirty       = false;
// P6 fix (codebase-02 audit) — debounce 100ms был слишком агрессивен для
// bulk-операций: 50 строк × 1 mutate = 50 микро-перерисовок в bursty path.
// 200ms объединяет всю серию в один render и при этом не ощутим как
// «задержка» на UI (humanly: <250ms imperceptible).
const _DEBOUNCE_MS = 200;
const _subscribers = [];

function _markDirty() {
  if (_silentDepth > 0) return;       // mutations during silent() never set dirty
  _dirty = true;
  _scheduleFlush();
}
function _scheduleFlush() {
  if (_silentDepth > 0) return;
  if (_flushTimer) return;            // already scheduled
  _flushTimer = setTimeout(_flushNow, _DEBOUNCE_MS);
}
function _flushNow() {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  if (_silentDepth > 0) return;
  if (!_dirty) return;                // nothing changed → don't notify
  _dirty = false;
  // Snapshot subscribers — a callback may unsubscribe itself.
  const list = _subscribers.slice();
  for (const fn of list) {
    try { fn(); }
    catch (e) { console.warn('[reactiveStore] subscriber threw:', e); }
  }
  // AUDIT_HOLISTIC P3 — мост в EventBus. Bridge ленивый: если EventBus
  // ещё не доступен (Node-tests без bus, или bus не загружен) — пропуск.
  // Имя 'state-changed' стандартизировано в docs/event-bus.md.
  // Не передаём path/value — реактивный слой не tracks per-property.
  try {
    if (typeof globalThis !== 'undefined' && globalThis.EventBus) {
      globalThis.EventBus.emit('state-changed');
    }
  } catch (_) { /* defensive — bus failure must not break flush */ }
}

const _handler = {
  get(target, key, receiver) {
    if (key === REACTIVE_MARK) return true;
    if (key === RAW_TARGET)    return target;
    const v = Reflect.get(target, key, receiver);
    // Don't proxy primitives / functions / DOM / Sets / Maps / Dates / Promises.
    if (v == null || typeof v !== 'object') return v;
    if (v instanceof Date || v instanceof RegExp) return v;
    if (v instanceof Set || v instanceof Map) return v;
    if (typeof v === 'function')             return v;
    if (v.nodeType !== undefined)            return v; // DOM node
    return _wrapObject(v);
  },
  set(target, key, value, receiver) {
    const prev = Reflect.get(target, key, receiver);
    // Unwrap a value if user is assigning a previously-wrapped one — keep raw
    // identity in the underlying state object so JSON.stringify stays clean.
    const rawValue = (value && value[REACTIVE_MARK]) ? value[RAW_TARGET] : value;
    if (prev === rawValue) return true;
    const ok = Reflect.set(target, key, rawValue, receiver);
    _markDirty();
    return ok;
  },
  deleteProperty(target, key) {
    const had = Reflect.has(target, key);
    const ok  = Reflect.deleteProperty(target, key);
    if (had) _markDirty();
    return ok;
  },
};

function _wrapObject(obj) {
  if (obj == null || typeof obj !== 'object') return obj;
  if (obj[REACTIVE_MARK]) return obj;       // already wrapped
  const cached = PROXY_CACHE.get(obj);
  if (cached) return cached;
  const proxy = new Proxy(obj, _handler);
  PROXY_CACHE.set(obj, proxy);
  return proxy;
}

export const Reactive = {
  /** Wrap an object in the reactive Proxy. Idempotent. */
  wrap(obj) { return _wrapObject(obj); },

  /** Run `fn` without firing reactive notifications. Re-entrant.
   *
   * V21 M (audit-2026-05-03 §B A7) — fix async-in-silent invariant.
   * Раньше `Reactive.silent(async () => ...)` декрементировал depth
   * синхронно (по возврату Promise), и async-работа летела ВНЕ silent
   * guard'а — каждый mutation триггерил debounced flush. Теперь если
   * `fn()` вернул thenable, держим depth до её resolve/reject.
   */
  silent(fn) {
    _silentDepth++;
    let r;
    try { r = fn(); }
    catch (e) { _silentDepth--; throw e; }
    if (r && typeof r.then === 'function') {
      return Promise.resolve(r).finally(() => { _silentDepth--; });
    }
    _silentDepth--;
    return r;
  },

  /** Subscribe to "something changed". Returns an unsubscribe function. */
  subscribe(fn) {
    _subscribers.push(fn);
    return () => {
      const i = _subscribers.indexOf(fn);
      if (i >= 0) _subscribers.splice(i, 1);
    };
  },

  /** Cancel any pending debounce and fire subscribers now. */
  flushNow() { _flushNow(); },

  /**
   * V21 S (audit-2026-05-03 §D F5) — explicitly mark a mutation that
   * Proxy не видит (Set/Map ops, manual reassign with reused reference,
   * direct localStorage write that должен инвалидировать subs).
   * Триггерит дебаунсный flush — те же субы как при обычной мутации.
   */
  notifyManual() { _markDirty(); },

  /** True if `obj` is currently a reactive Proxy. */
  isReactive(obj) { return !!(obj && obj[REACTIVE_MARK]); },

  /** Internal — for tests. */
  _silentDepth: () => _silentDepth,
  _subscriberCount: () => _subscribers.length,
};

Services.register('Reactive', Reactive);
if (typeof window !== 'undefined') window.Reactive = Reactive;
