'use strict';
/* ============================================================
   integrations/release2/release2Api.js — V22+ (Release 2.0)

   Клиентский фетчер для /api/integrations/release2-fetch и
   /api/integrations/release2-related (lazy).

   Public API:
     fetchRelease2List(opts?) → Promise<{releases, byProject, byStatus, byOwner, stats, jql, fetchedAt}>
       opts: { projectKeys?, statusesToExclude?, sinceDate?, includeAllStatuses?, signal? }

     fetchRelease2Related(keys, opts?) → Promise<Array>
       opts: { signal?, timeoutMs? }

   Контракты:
     · НЕ зависит от UI/DOM — чистый async-fetch.
     · Передаёт AbortSignal во все fetch'и.
     · 60s timeout по умолчанию (60 активных Release 2.0 = ~5 секунд).
     · Прозрачно обрабатывает 4xx/5xx, бросает Error с server-message.
   ============================================================ */

import { buildFieldList } from './release2Fields.js';
import { analyseRelease2List } from './release2Model.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const RELATED_TIMEOUT_MS = 30_000;

function _withTimeout(signal, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'TimeoutError')), ms);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  }
  return { signal: ctrl.signal, _timer: t };
}

async function _postJson(url, body, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal,
  });
  const text = await res.text().catch(() => '');
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/**
 * @param {object} opts
 *   · projectKeys?: string[]       — override (иначе из cfg.jiraProjectKeys)
 *   · statusesToExclude?: string[] — статусы для exclude (default: 3 терминальных)
 *   · sinceDate?: string           — YYYY-MM-DD, default из cfg.sinceDate
 *   · includeAllStatuses?: bool    — игнорировать exclude-фильтр
 *   · signal?: AbortSignal
 *   · timeoutMs?: number
 * @returns {Promise<object>} analysed list
 */
export async function fetchRelease2List(opts = {}) {
  const tw = _withTimeout(opts.signal, opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const body = {
      projectKeys: opts.projectKeys,
      statuses: opts.statusesToExclude,
      sinceDate: opts.sinceDate,
      includeAllStatuses: opts.includeAllStatuses,
      maxResults: opts.maxResults,
      // Запрашиваем custom-fields из release2Fields registry + стандартные.
      fields: buildFieldList(),
    };
    const data = await _postJson('/api/integrations/release2-fetch', body, tw.signal);
    if (!Array.isArray(data.issues)) {
      throw new Error('Invalid response: expected issues[] array');
    }
    // Normalize on client (model layer)
    const analysed = analyseRelease2List(data.issues, {
      fetchedAt: data.fetchedAt,
      jql: data.jql,
    });
    return {
      ...analysed,
      jql: data.jql,
      fetchedAt: data.fetchedAt || analysed.fetchedAt,
      projectKeys: data.projectKeys || [],
      statusesExcluded: data.statusesExcluded || [],
      since: data.since || '',
      jiraBaseUrl: data.jiraBaseUrl || '',
    };
  } finally {
    clearTimeout(tw._timer);
  }
}

/**
 * Lazy-fetch связанных issue (Story/Bug) для конкретного релиза.
 * @param {string[]} keys
 * @param {object} opts — { signal?, timeoutMs? }
 * @returns {Promise<Array>} raw issues
 */
export async function fetchRelease2Related(keys, opts = {}) {
  if (!Array.isArray(keys) || !keys.length) return [];
  const tw = _withTimeout(opts.signal, opts.timeoutMs || RELATED_TIMEOUT_MS);
  try {
    const data = await _postJson('/api/integrations/release2-related', { keys }, tw.signal);
    return Array.isArray(data?.issues) ? data.issues : [];
  } finally {
    clearTimeout(tw._timer);
  }
}
