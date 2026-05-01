'use strict';
/* ============================================================
   PORTFOLIO PULSE — API LAYER
   Talks to /api/integrations/portfolio-pulse only. Server does
   the actual Jira / Bitbucket / Confluence aggregation.

   - Composes user signal with a timeout signal so request can't hang.
   - Surfaces server "errors" array unchanged (per-PK fallback).
   ============================================================ */

const ENDPOINT = '/api/integrations/portfolio-pulse';

export async function fetchPulseData({ projectKeys, signal, timeoutMs = 90000, employees } = {}) {
  // V17.2 I2c — отправляем сокращённый identity-payload сотрудников чтобы
  //   сервер мог построить per-employee CQL `contributor in (...)` для
  //   Confluence (а в будущем — то же для Bitbucket / audit log).
  //   Шлём ТОЛЬКО identity-поля (никаких ot-days, comments etc) — чтобы
  //   payload оставался компактным.
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

  // Compose abort signals: external + internal timeout
  const inner = new AbortController();
  let timer = null;
  if (timeoutMs > 0) timer = setTimeout(() => inner.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);
  if (signal) {
    if (signal.aborted) inner.abort(signal.reason);
    else signal.addEventListener('abort', () => inner.abort(signal.reason));
  }

  try {
    const res = await fetch(ENDPOINT, {
      method:  'POST',
      signal:  inner.signal,
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
