'use strict';
/* ============================================================
   INTEGRATIONS SYNC — v10_0
   Fetches Jira / Bitbucket / Confluence data for rows.
   Updates row fields via proxy endpoints.
   Never mutates rows directly — returns update objects.
   Caller applies to state.rows and calls notify().
   ============================================================ */

import { loadSettingsRaw, saveSettings, isConfigured } from './integrationsStore.js';
import { Utils } from '../utils.js';

/* ── proxy call helper ────────────────────────────────────── */
// V17.2 I4 — клиентский timeout раньше был 15с, серверный per-PK budget —
//   90с. На медленной корп Jira клиент абортил запрос пока сервер ещё
//   работал → orphaned server work + UI «ошибка синхронизации». Теперь
//   90с (matches PER_PK_TIMEOUT_MS на сервере).
async function proxyPost(endpoint, body) {
  const res = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(90000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // V18 P6 — централизованный redact на error path. Сервер обычно отдаёт
    //   `{error: ...}` без token-leak (token-redact уже на сервере), но если
    //   proxy вернул что-то ещё — пробуем парсить как text + redact.
    let errMsg;
    const text = await res.text().catch(() => '');
    try {
      const parsed = JSON.parse(text);
      errMsg = parsed.error || `HTTP ${res.status}: ${Utils.redactSecretsInText(text)}`;
    } catch (_) {
      errMsg = `HTTP ${res.status}: ${Utils.redactSecretsInText(text)}`;
    }
    throw new Error(errMsg);
  }
  return res.json();
}

/* ── Jira: sync a single row ──────────────────────────────── */
export async function syncJiraRow(row) {
  const key = String(row.jiraKey || '').trim();
  if (!key) return null;
  try {
    const data = await proxyPost('/api/integrations/jira-issue', { key });
    return {
      id:           row.id,
      jiraStatus:   data.status   || '',
      jiraAssignee: data.assignee || '',
      jiraUpdatedAt:data.updatedAt|| '',
    };
  } catch(e) {
    console.warn('[IntSync] Jira issue fetch failed:', key, e.message);
    return null;
  }
}

/* ── Bitbucket: sync a single row ─────────────────────────── */
export async function syncBitbucketRow(row) {
  const key = String(row.jiraKey || '').trim();
  if (!key) return null;
  try {
    const data = await proxyPost('/api/integrations/bitbucket-prs', { jiraKey: key });
    const pr = data.prs?.[0] || null;
    if (!pr) return null;
    return {
      id:         row.id,
      prUrl:      pr.url       || '',
      prStatus:   pr.status    || '',
      prUpdatedAt:pr.updatedAt || '',
    };
  } catch(e) {
    console.warn('[IntSync] Bitbucket PR fetch failed:', key, e.message);
    return null;
  }
}

/* ── Confluence: sync a single row ───────────────────────── */
export async function syncConfluenceRow(row, { sinceDate } = {}) {
  const key = String(row.jiraKey || row.epic || '').trim();
  if (!key) return null;
  try {
    const body = { query: key, ...(sinceDate ? { sinceDate } : {}) };
    const data = await proxyPost('/api/integrations/confluence-search', body);
    const page = data.pages?.[0] || null;
    if (!page) return null;
    return {
      id:       row.id,
      docUrl:   page.url   || '',
      docTitle: page.title || '',
    };
  } catch(e) {
    console.warn('[IntSync] Confluence search failed:', key, e.message);
    return null;
  }
}

/* ── Bulk fetch: pull ALL issues from Jira (uses configured projects) ─ */
export async function fetchAllFromJira({ onProgress, sinceDate } = {}) {
  // Use server-truth "configured" check — falls back to localStorage if
  // server hydration hasn't run yet. Fixes F5-after-clean-storage where
  // server has tokens but localStorage doesn't.
  if (!isConfigured('jira')) return { issues: [], error: 'Jira не настроена' };
  try {
    const body = sinceDate ? { sinceDate } : {};
    const data = await proxyPost('/api/integrations/jira-fetch-all', body);
    return { issues: Array.isArray(data.issues) ? data.issues : [], jql: data.jql, count: data.count };
  } catch(e) {
    return { issues: [], error: e.message };
  }
}

/* ── Master sync: all rows with jiraKey ───────────────────── */
export async function syncAllRows(rows, { onProgress } = {}) {
  const withKey = rows.filter(r => r.jiraKey);
  if (!withKey.length) return { updates: [], skipped: rows.length, noKey: rows.length };

  const updates = [];
  let done = 0;

  // Server-truth: server may have tokens even if localStorage doesn't (clean
  // browser / cleared site data after admin set up jira_config.json).
  const jiraOK   = isConfigured('jira');
  const bbOK     = isConfigured('bitbucket');
  const cfOK     = isConfigured('confluence');

  for (const row of withKey) {
    const promises = [];
    if (jiraOK) promises.push(syncJiraRow(row));
    if (bbOK)   promises.push(syncBitbucketRow(row));
    if (cfOK)   promises.push(syncConfluenceRow(row));

    const results = await Promise.all(promises);
    const merged = results
      .filter(Boolean)
      .reduce((acc, upd) => ({ ...acc, ...upd }), { id: row.id });

    if (Object.keys(merged).length > 1) updates.push(merged);

    done++;
    onProgress?.(done, withKey.length);
  }

  saveSettings({ lastSync: new Date().toISOString() });
  return { updates, synced: withKey.length, total: rows.length };
}

/* ── Full pull: fetch all issues from systems + enrich via Bitbucket / Confluence ─ */
/* Returns { fetchedIssues, newRowsToAdd, updates } — caller applies them. */
export async function fullPullFromSystems(existingRows, { onProgress } = {}) {
  const cfg = loadSettingsRaw();
  const sinceDate = cfg.sinceDate || '2025-01-01';
  const result = { fetchedIssues: 0, newRowsToAdd: [], updates: [], errors: [], sinceDate };

  // Step 1: pull issues from Jira
  if (isConfigured('jira')) {
    onProgress?.({ phase: 'jira-fetch', current: 0, total: 1 });
    const { issues, error } = await fetchAllFromJira({ sinceDate });
    if (error) result.errors.push(`Jira: ${error}`);
    result.fetchedIssues = issues.length;

    // Index existing rows by jiraKey (lowercased)
    const byKey = new Map();
    existingRows.forEach(r => {
      const k = String(r.jiraKey || '').trim().toLowerCase();
      if (k) byKey.set(k, r);
    });

    issues.forEach(iss => {
      const key = String(iss.key || '').trim();
      if (!key) return;
      const existing = byKey.get(key.toLowerCase());
      if (existing) {
        // Update existing
        result.updates.push({
          id: existing.id,
          jiraStatus:    iss.status,
          jiraAssignee:  iss.assignee,
          jiraUpdatedAt: iss.updatedAt,
          // Optional: pull team from components if row has none
          ...(existing.team ? {} : (iss.team ? { team: iss.team } : {})),
        });
      } else {
        // New row — caller will RowFactory.create + push
        result.newRowsToAdd.push({
          jiraKey:      key,
          jiraStatus:   iss.status,
          jiraAssignee: iss.assignee,
          jiraUpdatedAt:iss.updatedAt,
          assignee:     iss.assignee,
          team:         iss.team || '',
          epic:         iss.summary,                      // епик — это short summary
          tasks:        iss.summary,                      // task name
          taskComment:  iss.priority ? `Priority: ${iss.priority}` : '',
          tags:         (iss.labels || []).join(', '),
          blockingDeadline: iss.dueDate || '',
        });
      }
    });
  } else {
    result.errors.push('Jira: не настроена (нет endpoint или токена)');
  }

  // Step 2: enrich with Bitbucket / Confluence per row that has a jiraKey
  // (use combined list of existing rows + newly proposed rows)
  const allWithKey = [
    ...existingRows.filter(r => r.jiraKey),
    ...result.newRowsToAdd.map(r => ({ ...r, _isNew: true })),
  ];

  const bbOK = isConfigured('bitbucket');
  const cfOK = isConfigured('confluence');
  if (bbOK || cfOK) {
    let done = 0;
    for (const row of allWithKey) {
      const enrichments = [];
      if (bbOK) enrichments.push(syncBitbucketRow(row));
      if (cfOK) enrichments.push(syncConfluenceRow(row, { sinceDate }));
      const merged = (await Promise.all(enrichments))
        .filter(Boolean)
        .reduce((acc, upd) => ({ ...acc, ...upd }), {});

      if (Object.keys(merged).length) {
        if (row._isNew) {
          // Apply to the proposed new row in-place
          const target = result.newRowsToAdd.find(n => n.jiraKey === row.jiraKey);
          if (target) Object.assign(target, merged);
        } else {
          // Merge into an existing update or add a new one
          const upd = result.updates.find(u => u.id === row.id);
          if (upd) Object.assign(upd, merged);
          else     result.updates.push({ id: row.id, ...merged });
        }
      }
      done++;
      onProgress?.({ phase: 'enrich', current: done, total: allWithKey.length });
    }
  }

  saveSettings({ lastSync: new Date().toISOString() });
  return result;
}

/* ── Verify connections (via server endpoints) ────────────── */
export async function verifyJira() {
  const res = await fetch('/api/jira/verify', {
    method: 'POST', signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: !!data.ok, who: data.who, error: data.error };
}

export async function verifyBitbucket() {
  try {
    const data = await proxyPost('/api/integrations/verify-bitbucket', {});
    return { ok: !!data.ok, error: data.error };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

export async function verifyConfluence() {
  try {
    const data = await proxyPost('/api/integrations/verify-confluence', {});
    return { ok: !!data.ok, error: data.error };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}
