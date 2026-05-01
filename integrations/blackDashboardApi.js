'use strict';
/* ============================================================
   BLACK DASHBOARD — API LAYER (async-job + polling)

   V13 (2026-04, 6th pass): replaced single-fetch-with-long-timeout
   with an async-job pattern. Reason: synchronous `fetch` over corp
   networks doesn't survive 5+ min — proxies, OS idle limits, and
   browser TCP timeouts kill the connection regardless of any
   `AbortSignal.timeout` value we pick. Now:

     1. POST /api/integrations/black-dashboard/start
        → { jobId, startedAt }       (returns INSTANTLY, server runs in bg)
     2. GET  /api/integrations/black-dashboard/status?jobId=X
        → { status: 'running'|'done'|'error', elapsedMs, result?, error? }
        Polled every POLL_INTERVAL_MS until terminal.

   Each request is sub-second; no long-lived connection. The server
   can grind for 10+ minutes if needed. Caller can still cancel via
   the external `signal` (refresh button, navigation) — we abort the
   poll loop locally; server-side job is left to finish (no cleanup
   API yet — they're GC'd by TTL, doesn't hurt).

   Public surface preserved: `fetchBlackDashboard({ signal, timeoutMs,
   onProgress })` resolves with the same payload shape as the
   legacy synchronous endpoint.
   ============================================================ */

const START_ENDPOINT  = '/api/integrations/black-dashboard/start';
const STATUS_ENDPOINT = '/api/integrations/black-dashboard/status';

const POLL_INTERVAL_MS  = 2000;             // every 2s — light on the server
const POLL_TIMEOUT_MS   = 15000;            // each /status call's own timeout
const DEFAULT_OVERALL_MS = 20 * 60 * 1000;  // 20 min absolute cap (sanity)

function _sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new DOMException('aborted', 'AbortError'));
    const t = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason || new DOMException('aborted', 'AbortError'));
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

async function _postStart(signal) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new DOMException('start timeout', 'TimeoutError')), POLL_TIMEOUT_MS);
  const onAbort = () => ctrl.abort(signal.reason);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const res = await fetch(START_ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    if (!json.jobId) throw new Error('Сервер не вернул jobId');
    return json;
  } finally {
    clearTimeout(t);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

async function _pollStatus(jobId, signal) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new DOMException('status timeout', 'TimeoutError')), POLL_TIMEOUT_MS);
  const onAbort = () => ctrl.abort(signal.reason);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const res = await fetch(`${STATUS_ENDPOINT}?jobId=${encodeURIComponent(jobId)}`, {
      method: 'GET',
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  } finally {
    clearTimeout(t);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

/**
 * Run a black-dashboard fetch via async-job + polling.
 * @param {object}   opts
 * @param {AbortSignal}  [opts.signal]      - external cancellation
 * @param {number}       [opts.timeoutMs]   - overall sanity cap (default 20 min)
 * @param {Function}     [opts.onProgress]  - ({ elapsedMs, status, phase }) → void
 * @returns {Promise<object>}                payload (same shape as legacy endpoint)
 */
export async function fetchBlackDashboard({ signal, timeoutMs = DEFAULT_OVERALL_MS, onProgress } = {}) {
  // Start the job. If THIS fails, surface immediately (network down,
  // server not running, sigma not configured, etc.).
  const { jobId } = await _postStart(signal);

  const t0 = Date.now();
  // Tolerate transient 5xx / network blips on the polling channel —
  // the JOB is still running on the server. Only bail when the server
  // itself reports `error`, or when the user-aborts/timeout fires.
  let pollErrors = 0;
  const POLL_ERROR_BUDGET = 5;

  while (true) {
    if (signal?.aborted) throw signal.reason || new DOMException('aborted', 'AbortError');
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`Превышен общий лимит ${Math.round(timeoutMs/60000)} мин на загрузку Чёрного дашборда (jobId=${jobId})`);
    }

    let snap;
    try {
      snap = await _pollStatus(jobId, signal);
      pollErrors = 0;
    } catch (e) {
      if (signal?.aborted) throw e;
      pollErrors++;
      if (pollErrors > POLL_ERROR_BUDGET) throw e;
      // Transient — back off and try again.
      await _sleep(POLL_INTERVAL_MS, signal);
      continue;
    }

    onProgress?.({
      elapsedMs: snap.elapsedMs ?? (Date.now() - t0),
      status:    snap.status,
      phase:     snap.phase,
    });

    if (snap.status === 'done')  return snap.result;
    if (snap.status === 'error') throw new Error(snap.error || 'Неизвестная ошибка дашборда');

    // Still running — wait, then poll again.
    await _sleep(POLL_INTERVAL_MS, signal);
  }
}
