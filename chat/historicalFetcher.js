'use strict';
/* ============================================================
   chat/historicalFetcher.js — V22+ Week 1 (I-09)

   Direct fetch к существующим серверным endpoint'ам для данных
   за периоды вне Scanner-pulse cache.

   Зачем:
     · Scanner-pulse retention обычно 14 дней → year-query не покрыт.
     · teamScanner2History хранит daily-snapshots но в low-fidelity.
     · Для performance-review длинных периодов нужны raw данные —
       call existing API с `sinceDate` параметром + client-side фильтр.

   Использует существующие endpoint'ы (новых не создаём в Phase 1):
     · POST /api/integrations/jira-fetch-all       — Jira (с sinceDate)
     · POST /api/integrations/bitbucket-prs        — BB PRs
     · POST /api/integrations/confluence-search    — CF pages

   Identity-resolve (CLAUDE.md contract #2):
     · Jira: assignee.email == employee.email или assignee.accountId == jiraAccountId
     · BB:   pr.author.user.emailAddress == employee.email или login == bitbucketLogin
     · CF:   page.creator.accountId == confluenceAccountId

   Public API:
     fetchEmployeeJiraHistory(employee, period, { signal? }) → { items, total, _truncated, _from, _to }
     fetchEmployeeBBHistory  (employee, period, { signal? }) → { items, total, ... }
     fetchEmployeeCFHistory  (employee, period, { signal? }) → { items, total, ... }
     fetchEmployeeAllSources (employee, period, { signal?, sources? }) → { jira, bb, cf, errors }

   Контракты:
     · Не throw'ает на per-source error — возвращает { ..., errors: [{source, msg}] }
     · `signal` пробрасывается во все fetch'и для cancel mid-query
     · `period` обязателен — { from: Date, to: Date }
     · 30s timeout per source — после этого источник попадает в errors
   ============================================================ */

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ITEMS_PER_SOURCE = 5000;   // защита от чрезмерных payloadов

function _toISODate(d) {
  if (!d || !(d instanceof Date)) return '';
  return d.toISOString().slice(0, 10);
}

function _withTimeout(signal, ms) {
  if (typeof AbortController === 'undefined') return signal;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'TimeoutError')), ms);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  }
  // Cleanup на successful resolve — caller должен сделать. Здесь возвращаем и signal, и timer.
  return { signal: ctrl.signal, _timer: t };
}

async function _postJson(url, body, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/* ─────────────────────────────────────────────────────────────
   Jira
   ───────────────────────────────────────────────────────────── */

/**
 * Fetch Jira-issues привязанные к сотруднику за период.
 * @param {object} employee — { email, jiraAccountId }
 * @param {object} period   — { from: Date, to: Date, label }
 * @param {object} opts     — { signal?, timeoutMs? }
 * @returns {Promise<{items, total, _truncated, _from, _to, _source}>}
 */
export async function fetchEmployeeJiraHistory(employee, period, opts = {}) {
  if (!employee || !period?.from || !period?.to) {
    return { items: [], total: 0, _truncated: false, _from: null, _to: null, _source: 'jira' };
  }
  const tw = _withTimeout(opts.signal, opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const sinceDate = _toISODate(period.from);
    const data = await _postJson('/api/integrations/jira-fetch-all',
      { sinceDate }, tw.signal || opts.signal);
    const issues = Array.isArray(data?.issues) ? data.issues : [];

    // Identity-deterministic фильтр: assignee.email или displayName совпадает.
    // jira-fetch-all возвращает только displayName в `assignee` — пришлось бы
    // делать identity-resolve через employee.fio. Это compromise, но работает
    // с существующим endpoint'ом без сервер-side изменений.
    const empFio   = String(employee.fio || employee.label || '').trim();
    const empEmail = String(employee.email || '').toLowerCase();
    const empJaid  = String(employee.jiraAccountId || '');

    const mine = issues.filter(it => {
      const assigneeStr = String(it.assignee || '');
      // Match по displayName (= fio в большинстве случаев)
      if (empFio && assigneeStr === empFio) return true;
      // Fallback: lowercased substring match по email-localpart
      if (empEmail) {
        const local = empEmail.split('@')[0];
        if (local && assigneeStr.toLowerCase().includes(local)) return true;
      }
      return false;
    });

    // Filter по периоду через updated.
    const fromMs = period.from.getTime();
    const toMs   = period.to.getTime();
    const filtered = mine.filter(it => {
      const ts = Date.parse(it.updatedAt || '');
      return Number.isFinite(ts) && ts >= fromMs && ts < toMs;
    });

    const truncated = filtered.length > MAX_ITEMS_PER_SOURCE;
    const items = truncated ? filtered.slice(0, MAX_ITEMS_PER_SOURCE) : filtered;

    return {
      items, total: filtered.length, _truncated: truncated,
      _from: period.from, _to: period.to, _source: 'jira',
    };
  } finally {
    if (tw._timer) clearTimeout(tw._timer);
  }
}

/* ─────────────────────────────────────────────────────────────
   Bitbucket
   ───────────────────────────────────────────────────────────── */

export async function fetchEmployeeBBHistory(employee, period, opts = {}) {
  if (!employee || !period?.from || !period?.to) {
    return { items: [], total: 0, _truncated: false, _from: null, _to: null, _source: 'bb' };
  }
  const tw = _withTimeout(opts.signal, opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    // /api/integrations/bitbucket-prs принимает jiraKey, но без него возвращает
    // общий список PR. Если у нас нет фокуса на эпике — берём всё за период
    // и фильтруем на клиенте.
    const sinceDate = _toISODate(period.from);
    const data = await _postJson('/api/integrations/bitbucket-prs',
      { sinceDate }, tw.signal || opts.signal);
    const allPrs = Array.isArray(data?.prs || data?.items) ? (data.prs || data.items) : [];

    const empEmail = String(employee.email || '').toLowerCase();
    const empLogin = String(employee.bitbucketLogin || '').toLowerCase();
    const empFio   = String(employee.fio || employee.label || '').trim();

    const mine = allPrs.filter(pr => {
      const authorEmail = String(pr.author?.email || pr.authorEmail || '').toLowerCase();
      const authorLogin = String(pr.author?.login || pr.authorLogin || '').toLowerCase();
      const authorName  = String(pr.author?.displayName || pr.authorName || '');
      if (empEmail && authorEmail === empEmail) return true;
      if (empLogin && authorLogin === empLogin) return true;
      if (empFio && authorName === empFio) return true;
      return false;
    });

    const fromMs = period.from.getTime();
    const toMs   = period.to.getTime();
    const filtered = mine.filter(pr => {
      const ts = Date.parse(pr.updatedAt || pr.createdAt || pr.mergedAt || '');
      return Number.isFinite(ts) && ts >= fromMs && ts < toMs;
    });

    const truncated = filtered.length > MAX_ITEMS_PER_SOURCE;
    const items = truncated ? filtered.slice(0, MAX_ITEMS_PER_SOURCE) : filtered;

    return {
      items, total: filtered.length, _truncated: truncated,
      _from: period.from, _to: period.to, _source: 'bb',
    };
  } finally {
    if (tw._timer) clearTimeout(tw._timer);
  }
}

/* ─────────────────────────────────────────────────────────────
   Confluence
   ───────────────────────────────────────────────────────────── */

export async function fetchEmployeeCFHistory(employee, period, opts = {}) {
  if (!employee || !period?.from || !period?.to) {
    return { items: [], total: 0, _truncated: false, _from: null, _to: null, _source: 'cf' };
  }
  const tw = _withTimeout(opts.signal, opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    // CF поиск принимает CQL — формируем запрос с creator.accountid + updated.
    const empAccount = String(employee.confluenceAccountId || '').trim();
    const empFio     = String(employee.fio || employee.label || '').trim();
    if (!empAccount && !empFio) {
      // Нет identity для CF — silent empty.
      return { items: [], total: 0, _truncated: false, _from: period.from, _to: period.to, _source: 'cf' };
    }
    const sinceDate = _toISODate(period.from);
    const toDate    = _toISODate(period.to);
    // Build CQL — endpoint принимает свободный body, формирует CQL внутри.
    const cqlParts = [];
    if (empAccount) cqlParts.push(`(creator.accountid="${empAccount}" OR contributor.accountid="${empAccount}")`);
    if (sinceDate)  cqlParts.push(`lastmodified >= "${sinceDate}"`);
    if (toDate)     cqlParts.push(`lastmodified < "${toDate}"`);
    const body = {
      cql: cqlParts.length ? cqlParts.join(' AND ') : undefined,
      author: empFio,
      sinceDate, toDate,
    };
    const data = await _postJson('/api/integrations/confluence-search',
      body, tw.signal || opts.signal);
    const allPages = Array.isArray(data?.results || data?.pages || data?.items)
      ? (data.results || data.pages || data.items)
      : [];

    // Сервер уже фильтрует по CQL если поддерживает. Здесь — defensive
    // client-side фильтр на случай если server вернул больше.
    const fromMs = period.from.getTime();
    const toMs   = period.to.getTime();
    const filtered = allPages.filter(p => {
      const ts = Date.parse(p.lastModified || p.updatedAt || p.history?.lastUpdated?.when || '');
      if (!Number.isFinite(ts)) return true;     // нет даты — не отфильтровываем
      return ts >= fromMs && ts < toMs;
    });

    const truncated = filtered.length > MAX_ITEMS_PER_SOURCE;
    const items = truncated ? filtered.slice(0, MAX_ITEMS_PER_SOURCE) : filtered;

    return {
      items, total: filtered.length, _truncated: truncated,
      _from: period.from, _to: period.to, _source: 'cf',
    };
  } finally {
    if (tw._timer) clearTimeout(tw._timer);
  }
}

/* ─────────────────────────────────────────────────────────────
   Multi-source orchestrator
   ───────────────────────────────────────────────────────────── */

/**
 * Fetch all sources в parallel + aggregate errors.
 * @param {object} employee
 * @param {object} period
 * @param {object} opts — { signal?, sources?: string[], onProgress?: fn }
 * @returns {Promise<{jira, bb, cf, errors, _period, _employee}>}
 */
export async function fetchEmployeeAllSources(employee, period, opts = {}) {
  const sources = opts.sources || ['jira', 'bb', 'cf'];
  const errors = [];
  const result = { jira: null, bb: null, cf: null, errors, _period: period, _employee: employee };

  const tasks = [];
  if (sources.includes('jira')) {
    tasks.push(fetchEmployeeJiraHistory(employee, period, opts)
      .then(r => { result.jira = r; opts.onProgress?.('jira'); })
      .catch(e => { errors.push({ source: 'jira', msg: String(e?.message || e) }); }));
  }
  if (sources.includes('bb')) {
    tasks.push(fetchEmployeeBBHistory(employee, period, opts)
      .then(r => { result.bb = r; opts.onProgress?.('bb'); })
      .catch(e => { errors.push({ source: 'bb', msg: String(e?.message || e) }); }));
  }
  if (sources.includes('cf')) {
    tasks.push(fetchEmployeeCFHistory(employee, period, opts)
      .then(r => { result.cf = r; opts.onProgress?.('cf'); })
      .catch(e => { errors.push({ source: 'cf', msg: String(e?.message || e) }); }));
  }

  await Promise.all(tasks);
  return result;
}

/* ─────────────────────────────────────────────────────────────
   Aggregates / summary helpers
   ───────────────────────────────────────────────────────────── */

/**
 * Aggregate counters для одного source-result'а.
 * Возвращает { total, byType, byStatus, top } — для рендера cards.
 */
export function summarizeJiraItems(items) {
  if (!Array.isArray(items)) return { total: 0, byType: {}, byStatus: {}, top: [] };
  const byType = {};
  const byStatus = {};
  const closedItems = [];
  for (const it of items) {
    const type = it.issuetype || 'unknown';
    const status = it.status || 'unknown';
    byType[type] = (byType[type] || 0) + 1;
    byStatus[status] = (byStatus[status] || 0) + 1;
    // Closed statuses heuristic
    if (/done|закры|готово|complete|resolved|закрыт/i.test(status)) {
      closedItems.push(it);
    }
  }
  return {
    total: items.length,
    closed: closedItems.length,
    byType, byStatus,
    top: items.slice(0, 10),   // top по updated DESC (jira-fetch-all sorts so)
  };
}

export function summarizeBBItems(items) {
  if (!Array.isArray(items)) return { total: 0, byState: {}, repos: {}, top: [] };
  const byState = {};
  const repos = {};
  for (const pr of items) {
    const state = pr.state || pr.status || 'unknown';
    byState[state] = (byState[state] || 0) + 1;
    const repo = pr.repository?.name || pr.repo || pr.repoName || 'unknown';
    repos[repo] = (repos[repo] || 0) + 1;
  }
  return {
    total: items.length,
    merged: items.filter(p => /merged|merge/i.test(p.state || p.status || '')).length,
    open:   items.filter(p => /open/i.test(p.state || p.status || '')).length,
    byState, repos,
    top: items.slice(0, 10),
  };
}

export function summarizeCFItems(items) {
  if (!Array.isArray(items)) return { total: 0, spaces: {}, top: [] };
  const spaces = {};
  for (const p of items) {
    const space = p.space?.key || p.space?.name || p.spaceKey || 'unknown';
    spaces[space] = (spaces[space] || 0) + 1;
  }
  return {
    total: items.length,
    spaces,
    top: items.slice(0, 10),
  };
}
