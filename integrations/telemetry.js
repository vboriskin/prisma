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

/* ── Throttled event emit (8.6) ──────────────────────────────
   Игнорирует подряд идущие emit'ы с одинаковым eventName, если
   с прошлого раза прошло меньше throttleMs. Защита от noisy
   high-frequency хуков (e.g. setChatPhase каждый animation frame).
   ─────────────────────────────────────────────────────────── */
const _throttleLastAt = new Map();
export function trackThrottled(eventName, payload, throttleMs = 200) {
  if (!eventName || typeof eventName !== 'string') return;
  const now = Date.now();
  const prev = _throttleLastAt.get(eventName) || 0;
  if (now - prev < throttleMs) return;
  _throttleLastAt.set(eventName, now);
  emit(eventName, payload || {});
}

/* ============================================================
   V22 — расширение телеметрии (codebase-04 audit §6).
   Hooks для long-task, filter-funnel, bulk-cancel, TTI, LLM accept-rate,
   errors batch, plan-lock bypass, integration sync failures.
   ============================================================ */

/* ── Long-task / frame-drop через PerformanceObserver ─────── */
let _longTaskObs = null;
export function startLongTaskObserver() {
  if (_longTaskObs || typeof PerformanceObserver === 'undefined') return;
  try {
    _longTaskObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // Любой long-task >50ms — interesting; >100ms — серьёзный.
        emit('perf.long_task', {
          durationMs: Math.round(entry.duration),
          startMs: Math.round(entry.startTime),
          // Source unavailable for cross-origin tasks; only own-origin name.
          name: String(entry.name || 'self').slice(0, 40),
        });
      }
    });
    _longTaskObs.observe({ entryTypes: ['longtask'] });
  } catch (_) { /* longtask может быть unsupported (Safari < 16) */ }
}

/* ── Time-to-interactive ─────────────────────────────────── */
let _ttiSent = false;
export function markInteractive(label = 'app') {
  if (_ttiSent) return;
  _ttiSent = true;
  try {
    const navTime = performance.getEntriesByType?.('navigation')?.[0];
    const tti = navTime ? Math.round(performance.now()) : Math.round(Date.now() - (window.__BOOT_T0 || Date.now()));
    emit('perf.tti', { label, ms: tti });
  } catch (_) {}
}

/* ── Filter funnel ───────────────────────────────────────── */
const _filterFunnel = { opened: 0, applied: 0, cleared: 0, lastEmitAt: 0 };
export function trackFilter(action /* 'open' | 'apply' | 'clear' */, key) {
  if (action === 'open')  _filterFunnel.opened++;
  if (action === 'apply') _filterFunnel.applied++;
  if (action === 'clear') _filterFunnel.cleared++;
  emit('filter.action', { action, key: String(key || '').slice(0, 40) });
  // Daily roll-up каждые 5 минут (idle), чтобы видеть funnel-shape.
  const now = Date.now();
  if (now - _filterFunnel.lastEmitAt > 300000) {
    _filterFunnel.lastEmitAt = now;
    emit('filter.funnel', { ..._filterFunnel });
  }
}

/* ── Bulk-edit cancel rate ───────────────────────────────── */
const _bulk = { previewed: 0, applied: 0, cancelled: 0 };
export function trackBulk(action /* 'preview' | 'apply' | 'cancel' */, payload) {
  if (action === 'preview')  _bulk.previewed++;
  if (action === 'apply')    _bulk.applied++;
  if (action === 'cancel')   _bulk.cancelled++;
  const cancelRate = _bulk.previewed > 0 ? Math.round((_bulk.cancelled / _bulk.previewed) * 100) : 0;
  emit('bulk.action', {
    action,
    rowsCount: Number(payload?.rowsCount) || 0,
    actionType: String(payload?.actionType || '').slice(0, 40),
    cancelRatePct: cancelRate,
  });
}

/* ── LLM accept/reject ───────────────────────────────────── */
export function trackLLM(action /* 'sent' | 'accepted' | 'rejected' | 'aborted' */, payload) {
  emit('llm.feedback', {
    action,
    intent: String(payload?.intent || '').slice(0, 40),
    category: String(payload?.category || '').slice(0, 24),
    actionType: String(payload?.actionType || '').slice(0, 40),
  });
}

/* ── Errors batch (errorsLog.js → server) ───────────────── */
let _errBuf = [];
let _errFlushTimer = null;
export function pushError(entry) {
  if (_isDisabled()) return;
  if (!entry || typeof entry !== 'object') return;
  // Sanitize — никаких PII / токенов.
  _errBuf.push({
    level:   String(entry.level   || 'error').slice(0, 16),
    source:  String(entry.source  || '').slice(0, 80),
    message: String(entry.message || '').slice(0, 300),
    stack:   String(entry.stack   || '').slice(0, 800),
    at:      entry.at || new Date().toISOString(),
  });
  if (_errBuf.length >= 10) _flushErrors();
  else if (!_errFlushTimer) {
    _errFlushTimer = setTimeout(_flushErrors, 5000);
  }
}
function _flushErrors() {
  if (_errFlushTimer) { clearTimeout(_errFlushTimer); _errFlushTimer = null; }
  if (!_errBuf.length) return;
  const batch = _errBuf.splice(0, 30);
  emit('errors.batch', { count: batch.length, items: batch });
}

/* ── Plan-lock bypass tracker ────────────────────────────── */
export function trackPlanLockBypass(reason, who) {
  emit('planlock.bypass', {
    reason: String(reason || 'unknown').slice(0, 60),
    who:    String(who || '').slice(0, 60),
  });
}

/* ── Integration sync failures ───────────────────────────── */
export function trackIntegrationFailure(source, errorType, payload) {
  emit('integration.failure', {
    source: String(source || '').slice(0, 32),       // pulse | scanner2 | jira | bitbucket | confluence | zephyr
    errorType: String(errorType || '').slice(0, 40), // timeout | auth | network | parse | http_4xx | http_5xx
    pks: Array.isArray(payload?.pks) ? payload.pks.slice(0, 12).map(String) : [],
    httpStatus: Number(payload?.status) || 0,
    durationMs: Number(payload?.durationMs) || 0,
  });
}

// V22 — globalize pushError для errorsLog.js (no-cycle). Lazy hook,
// errorsLog не должен напрямую импортировать telemetry (cycle через app.js).
if (typeof window !== 'undefined') {
  window.__telemetryPushError = pushError;
}

// Auto-flush on page unload (browser-only).
// Guard на typeof addEventListener — node:test'ы могут shim'ить window
// как пустой object без addEventListener (см. teamScanner2Lifecycle.test).
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', () => _flush());
  window.addEventListener('pagehide',     () => _flush());
}
