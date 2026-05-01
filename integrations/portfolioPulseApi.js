'use strict';
/* ============================================================
   PORTFOLIO PULSE — API LAYER
   --
   V18 P7: переключено с sync POST /portfolio-pulse на async-job
   pattern (POST /start → GET /status, polling каждые 2с). Это даёт:
     • progress feedback (job.phase) → UI может показать «что сейчас делает»
     • lightweight HTTP requests (poll < 1s vs sync до 10 минут)
     • устойчивость к network drops — abort просто перестаёт poll'ить
     • легко добавить cancel'ить через DELETE /jobs/<id> в будущем
   --
   Sync POST /portfolio-pulse оставлен на сервере для backward-compat.
   Если async-job почему-то недоступен (старый сервер) — `fetchPulseData`
   автоматически fall back на sync через `forceSync: true` опцию.
   ============================================================ */

const START_EP   = '/api/integrations/portfolio-pulse/start';
const STATUS_EP  = '/api/integrations/portfolio-pulse/status';
const DETAIL_EP  = '/api/integrations/portfolio-pulse/employee-detail';
const SYNC_EP    = '/api/integrations/portfolio-pulse';
const POLL_INTERVAL_MS = 2000;     // Black-Dashboard tested with 2s — same here

export async function fetchPulseData({ projectKeys, signal, timeoutMs = 600000, employees, forceSync = false, onPhase, onJobId } = {}) {
  // V17.2 I2c — отправляем сокращённый identity-payload сотрудников чтобы
  //   сервер мог построить per-employee CQL `contributor in (...)`.
  //   Шлём ТОЛЬКО identity-поля (без ot-days/comments) — payload компактный.
  const slimEmployees = Array.isArray(employees)
    ? employees
        .filter(e => e && (e.email || e.confluenceAccountId || e.bitbucketLogin || e.jiraAccountId))
        .map(e => ({
          fio: String(e.fio || '').trim(),
          email: String(e.email || '').trim(),
          jiraAccountId: String(e.jiraAccountId || '').trim(),
          bitbucketLogin: String(e.bitbucketLogin || '').trim(),
          confluenceAccountId: String(e.confluenceAccountId || '').trim(),
        }))
    : [];
  const body = {
    ...(projectKeys && projectKeys.length ? { projectKeys } : {}),
    ...(slimEmployees.length ? { employees: slimEmployees } : {}),
  };

  // Compose abort: external user signal + overall timeout.
  const inner = new AbortController();
  let timer = null;
  if (timeoutMs > 0) timer = setTimeout(() => inner.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);
  if (signal) {
    if (signal.aborted) inner.abort(signal.reason);
    else signal.addEventListener('abort', () => inner.abort(signal.reason));
  }
  const reportPhase = typeof onPhase === 'function' ? onPhase : () => {};

  try {
    if (forceSync) return await _fetchSync(body, inner.signal);
    // Try async-job first; if /start вернул 404 (старый сервер) — auto-fallback на sync.
    let startResp;
    try {
      startResp = await fetch(START_EP, {
        method: 'POST',
        signal: inner.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      // Network-level failure → fall back to sync as last resort
      return await _fetchSync(body, inner.signal);
    }
    if (startResp.status === 404) {
      // Сервер старый, async-job не реализован → fall back
      return await _fetchSync(body, inner.signal);
    }
    const startData = await startResp.json().catch(() => ({}));
    if (!startResp.ok) throw new Error(startData.error || `HTTP ${startResp.status}`);
    const jobId = startData.jobId;
    if (!jobId) throw new Error('Server did not return jobId');
    // V18.1 P4 — notify caller of jobId so v2.0 Сканнер может позже
    // запросить /employee-detail для drill-down. v1 не передаёт onJobId
    // → callback no-op, ничего не ломается.
    if (typeof onJobId === 'function') {
      try { onJobId(jobId); } catch (_) {}
    }
    reportPhase('starting');

    // Poll loop. Каждый poll - lightweight; общий timeout идёт через inner.signal.
    while (true) {
      if (inner.signal.aborted) throw inner.signal.reason || new DOMException('Aborted', 'AbortError');
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, POLL_INTERVAL_MS);
        const onAbort = () => { clearTimeout(t); reject(inner.signal.reason || new DOMException('Aborted', 'AbortError')); };
        inner.signal.addEventListener('abort', onAbort, { once: true });
      });
      const r = await fetch(`${STATUS_EP}?jobId=${encodeURIComponent(jobId)}`, { signal: inner.signal });
      if (!r.ok) {
        if (r.status === 404) throw new Error('Pulse job expired (TTL 30 min). Запустите заново.');
        throw new Error(`Pulse status HTTP ${r.status}`);
      }
      const data = await r.json().catch(() => ({}));
      if (data.phase) reportPhase(data.phase);
      if (data.status === 'done') return data.result;
      if (data.status === 'error') throw new Error(data.error || 'Pulse failed');
      // status === 'running' → continue polling
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Legacy sync path. Used as fallback if /start не реализован. */
async function _fetchSync(body, signal) {
  const res = await fetch(SYNC_EP, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

/**
 * V18.1 P4 — drill-down per-employee endpoint.
 * Lazy server-side enrichment: переиспользует cached pulse-job (TTL 30 мин)
 * и пересчитывает analysePulse + enrichForScanner2 для одного участника.
 *
 * @returns {Promise<{employee, enrichment, aggregates, meta}>}
 *
 * Throws:
 *   - 'jobId expired' (404) — клиент должен запустить fresh pulse
 *   - 'employeeKey not found' (404) — несовпадение, клиент использует local data
 *   - 'job not done' (409) — pulse ещё running, повторить позже
 */
export async function fetchEmployeeDetail({ jobId, employeeKey, dwellHours, signal, timeoutMs = 30000 } = {}) {
  if (!jobId)       throw new Error('jobId required');
  if (!employeeKey) throw new Error('employeeKey required');
  // Compose abort: external + timeout.
  const inner = new AbortController();
  let timer = null;
  if (timeoutMs > 0) timer = setTimeout(() => inner.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);
  if (signal) {
    if (signal.aborted) inner.abort(signal.reason);
    else signal.addEventListener('abort', () => inner.abort(signal.reason));
  }
  try {
    const res = await fetch(DETAIL_EP, {
      method: 'POST',
      signal: inner.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, employeeKey, ...(dwellHours ? { dwellHours } : {}) }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(json.error || `HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return json;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
