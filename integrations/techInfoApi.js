'use strict';
/* ============================================================
   TECH INFO — API LAYER
   Single endpoint: POST /api/integrations/tech-info
   --
   Mirrors the pattern in `portfolioPulseApi.js`:
     · composes external + internal timeout abort signals,
     · throws on non-2xx with the server's `error` field,
     · returns the parsed JSON payload otherwise.
   ============================================================ */

const ENDPOINT = '/api/integrations/tech-info';

export async function fetchTechInfo({ signal, timeoutMs = 60000, source = 'all', forceRefresh = false } = {}) {
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
      body:    JSON.stringify({ source, forceRefresh }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
