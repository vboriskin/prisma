'use strict';
/* ============================================================
   FRONTEND TELEMETRY HELPER  (V19 C4)

   Lightweight client → server emit для usage events. Server-side
   logger.event() (V19 E4) сериализует в structured log.

   Public API:
     emit(eventName, data?)    fire-and-forget event
     time(label, fn)           wrapper для measure latency блока работы

   Design:
     - Использует navigator.sendBeacon если available (не блокирует UI,
       работает on page-unload). Fallback на fetch с keepalive.
     - Batched (через micro-buffer + 1 sec flush) для high-frequency
       events. На low-frequency — instant emit.
     - User opt-out: localStorage `q2_telemetry_disabled = '1'` отключает
       все emits (для DSGVO compliance / power-user privacy).
     - Никаких PII не отправляется — caller отвечает.
   ============================================================ */

const TELEMETRY_EP = '/api/telemetry';
const FLUSH_INTERVAL_MS = 1000;
const MAX_BATCH = 30;

let _buffer = [];
let _flushTimer = null;

/** Check if telemetry disabled by user. */
function _isDisabled() {
  try { return localStorage.getItem('q2_telemetry_disabled') === '1'; } catch (_) { return false; }
}

/** Schedule flush через 1 сек, если ещё не scheduled. */
function _scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    _flush();
  }, FLUSH_INTERVAL_MS);
}

/** Sync flush буфера. Вызывается timer'ом или явно (page unload). */
function _flush() {
  if (!_buffer.length) return;
  const batch = _buffer.splice(0, MAX_BATCH);
  const payload = JSON.stringify({ events: batch });
  try {
    if (navigator?.sendBeacon) {
      // sendBeacon работает on unload — главная причина использовать.
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(TELEMETRY_EP, blob);
    } else if (typeof fetch === 'function') {
      // keepalive: позволяет request пережить page-unload.
      fetch(TELEMETRY_EP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch (_) { /* swallow — telemetry никогда не должна ломать UI */ }
  // Если буфер всё ещё длинный — повторим flush.
  if (_buffer.length > 0) _scheduleFlush();
}

/**
 * Public: emit telemetry event.
 * @param {string} eventName формат `<ns>.<action>` (e.g., `scanner2.detail_open`)
 * @param {object} [data] sanitized server-side, only primitives + plain object
 */
export function emit(eventName, data) {
  if (_isDisabled()) return;
  if (!eventName || typeof eventName !== 'string') return;
  // Reject events с invalid name format на client'е тоже (early-rejection).
  if (!/^[a-z][a-z0-9_]{0,30}\.[a-z][a-z0-9_]{0,40}$/.test(eventName)) return;
  _buffer.push({ event: eventName, data: data || {} });
  if (_buffer.length >= MAX_BATCH) {
    _flush();
  } else {
    _scheduleFlush();
  }
}

/**
 * Public: measure latency блока работы. Wraps async/sync function.
 * @param {string} label `<ns>.<action>`
 * @param {Function} fn function to time
 * @param {object} [extra] additional fields for the emit
 */
export function time(label, fn, extra) {
  const t0 = Date.now();
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        (v) => { emit(label, { ...(extra || {}), latencyMs: Date.now() - t0, ok: true }); return v; },
        (e) => { emit(label, { ...(extra || {}), latencyMs: Date.now() - t0, ok: false, errMsg: String(e?.message || '').slice(0, 100) }); throw e; },
      );
    }
    emit(label, { ...(extra || {}), latencyMs: Date.now() - t0, ok: true });
    return result;
  } catch (e) {
    emit(label, { ...(extra || {}), latencyMs: Date.now() - t0, ok: false, errMsg: String(e?.message || '').slice(0, 100) });
    throw e;
  }
}

/** Force flush — вызывается на page-unload через addEventListener. */
export function flush() { _flush(); }

// Auto-flush on page unload (browser-only).
// Guard на typeof addEventListener — node:test'ы могут shim'ить window
// как пустой object без addEventListener (см. teamScanner2Lifecycle.test).
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', () => _flush());
  window.addEventListener('pagehide',     () => _flush());
}
