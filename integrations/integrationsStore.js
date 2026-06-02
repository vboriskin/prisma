'use strict';
/* ============================================================
   INTEGRATIONS STORE — v10_0
   Manages API settings in localStorage.
   Tokens are NEVER logged, NEVER sent to LLM.
   ============================================================ */

import { Services } from '../app/services.js';

export const INT_SETTINGS_KEY = 'q2_integrations_v1';

const DEFAULTS = {
  jiraBaseUrl:        '',
  jiraProjectKeys:    '',  // comma-separated, e.g. "PAY,SBOF,KYC"
  // jiraToken: stored but never returned to UI in full

  // ── Sigma Jira (Чёрный дашборд) ───────────────────────────
  // Second Jira instance used as the source of "quarterly goal" epics.
  // Linked to Delta tasks via the "Domain link" custom field on each goal.
  // Token is stored alongside `sigmaJiraToken` (raw only) — same pattern as jiraToken.
  sigmaJiraBaseUrl:   '',
  sigmaGoalEpicKeys:  '',  // comma-separated goal epic keys, e.g. "GOAL-1, GOAL-2"

  bitbucketBaseUrl:   '',
  bitbucketProjectKeys: '', // comma-separated repo slugs / project keys
  // bitbucketToken: stored but never returned to UI in full

  confluenceBaseUrl:    '',
  confluenceSpaceKeys:  '',  // V17.2 I2c — comma-separated space keys (e.g. "DEV, PAY, SBOF")
  // confluenceToken: stored but never returned to UI in full

  // 2026-05-11 — Jenkins добавлен в persistence layer. До этого фикса значения
  // визуально сбрасывались на ре-рендере (server-side jira_config.json держал,
  // localStorage — нет, т.к. Jenkins не было в ALLOWED_STRINGS / loadSettings).
  jenkinsBaseUrl:       '',
  jenkinsFolder:        '',
  // jenkinsToken: stored but never returned to UI in full

  // V17.2 I2c — окно активности для Pulse / Confluence aggregations.
  //   72h = 3 рабочих дня, default из плана.
  activityWindowHours:  72,

  // 2026-06-02 — лимит issues на проект для Jira-fetch (per query stage).
  // 500 — backward-compat default (был hardcoded в jira-helpers.js). На
  // больших командах (SMECIS 896 sprint-issues) поднимать до 1000-2000.
  // Server clamp'ит до [200, 2000].
  jiraScanLimit:        500,

  allowInsecureTls:   false, // global — applies to all integrations
  sinceDate:          '2025-01-01', // cut-off date for Jira / Confluence
  lastSync:           null,
};

/* Load raw settings (includes tokens — only for internal use) */
export function loadSettingsRaw() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(INT_SETTINGS_KEY) || '{}') };
  } catch(_) {
    return { ...DEFAULTS };
  }
}

/* Load settings safe for UI (tokens masked as boolean).
   `hasXxxToken` is OR'd with server-known state so the overview UI
   reflects "configured" even when localStorage is empty (post-F5 fresh
   browser scenario). Token-presence booleans are not secrets. */
export function loadSettings() {
  const raw = loadSettingsRaw();
  const srv = _serverState || {};
  return {
    jiraBaseUrl:        raw.jiraBaseUrl       || srv.jira?.baseUrl       || '',
    jiraProjectKeys:    raw.jiraProjectKeys   || '',
    hasJiraToken:       !!(raw.jiraToken)        || !!srv.jira?.hasToken,

    sigmaJiraBaseUrl:   raw.sigmaJiraBaseUrl  || srv.sigmaJira?.baseUrl  || '',
    sigmaGoalEpicKeys:  raw.sigmaGoalEpicKeys || '',
    hasSigmaJiraToken:  !!(raw.sigmaJiraToken)   || !!srv.sigmaJira?.hasToken,

    bitbucketBaseUrl:   raw.bitbucketBaseUrl  || srv.bitbucket?.baseUrl  || '',
    bitbucketProjectKeys: raw.bitbucketProjectKeys || '',
    hasBitbucketToken:  !!(raw.bitbucketToken)   || !!srv.bitbucket?.hasToken,

    confluenceBaseUrl:   raw.confluenceBaseUrl || srv.confluence?.baseUrl || '',
    confluenceSpaceKeys: raw.confluenceSpaceKeys || srv.confluence?.spaceKeys || '',
    hasConfluenceToken: !!(raw.confluenceToken)  || !!srv.confluence?.hasToken,

    jenkinsBaseUrl:     raw.jenkinsBaseUrl    || srv.jenkins?.baseUrl    || '',
    jenkinsFolder:      raw.jenkinsFolder     || srv.jenkins?.folder     || '',
    hasJenkinsToken:    !!(raw.jenkinsToken)     || !!srv.jenkins?.hasToken,

    activityWindowHours: Number(raw.activityWindowHours) || 72,

    // 2026-06-02 — scan limit с clamp [200, 2000].
    jiraScanLimit:      Math.min(2000, Math.max(200, Number(raw.jiraScanLimit) || 500)),

    allowInsecureTls:   !!raw.allowInsecureTls,
    sinceDate:          raw.sinceDate || '2025-01-01',
    lastSync:           raw.lastSync,
  };
}

/* Load settings for the settings UI form — includes actual tokens so password
   fields can pre-populate (user does NOT have to retype tokens after reload).
   Tokens are still masked visually by `<input type="password">`.
   This MUST NOT be used for any LLM payload or anywhere it could leak. */
export function loadSettingsForUI() {
  const raw = loadSettingsRaw();
  return {
    ...loadSettings(),
    jiraToken:       raw.jiraToken || '',
    sigmaJiraToken:  raw.sigmaJiraToken || '',
    bitbucketToken:  raw.bitbucketToken || '',
    confluenceToken: raw.confluenceToken || '',
    jenkinsToken:    raw.jenkinsToken || '',
  };
}

/* Save a patch — only accepts known keys, never logs tokens */
export function saveSettings(patch) {
  const raw = loadSettingsRaw();
  const ALLOWED_STRINGS = [
    'jiraBaseUrl', 'jiraProjectKeys', 'jiraToken',
    'sigmaJiraBaseUrl', 'sigmaGoalEpicKeys', 'sigmaJiraToken',
    'bitbucketBaseUrl', 'bitbucketProjectKeys', 'bitbucketToken',
    'confluenceBaseUrl', 'confluenceSpaceKeys', 'confluenceToken',
    'jenkinsBaseUrl', 'jenkinsFolder', 'jenkinsToken',
    'sinceDate',
  ];
  const next = { ...raw };
  for (const k of ALLOWED_STRINGS) {
    if (k in patch && typeof patch[k] === 'string') next[k] = patch[k];
  }
  if ('allowInsecureTls' in patch) next.allowInsecureTls = !!patch.allowInsecureTls;
  // V17.2 I2c — activityWindowHours: clamp [1, 168] (1 неделя max).
  if ('activityWindowHours' in patch) {
    const n = Number(patch.activityWindowHours);
    if (Number.isFinite(n) && n > 0) next.activityWindowHours = Math.min(168, Math.max(1, Math.round(n)));
  }
  // 2026-06-02 — jiraScanLimit: clamp [200, 2000].
  if ('jiraScanLimit' in patch) {
    const n = Number(patch.jiraScanLimit);
    if (Number.isFinite(n) && n > 0) next.jiraScanLimit = Math.min(2000, Math.max(200, Math.round(n)));
  }
  if (patch.lastSync !== undefined) next.lastSync = patch.lastSync;
  // QA A16.6 — guard от QuotaExceededError. На больших проектах
  // localStorage может быть забит другими ключами (state, snapshots),
  // и попытка save без try бросит unhandled и пользователь увидит «save
  // не сработал» без подсказки. Серверная копия (jira_config.json) —
  // основной источник для токенов, localStorage здесь только как cache.
  try {
    localStorage.setItem(INT_SETTINGS_KEY, JSON.stringify(next));
  } catch (e) {
    try {
      const isQuota = e?.name === 'QuotaExceededError' || /quota/i.test(String(e?.message || ''));
      // AUDIT_HOLISTIC Идея 14 — Toast.warn (canonical).
      if (typeof window !== 'undefined') {
        const msg = isQuota
          ? 'Хранилище заполнено — настройки не сохранены локально. Они хранятся на сервере, настройка не потеряна.'
          : 'Не удалось локально сохранить настройки интеграций. Они хранятся на сервере.';
        if (Services.Toast?.warn) Services.Toast.warn(msg, { timeoutMs: 5000 });
        else window.showToast?.(msg, 'warning', 5000);
      }
    } catch (_) {}
  }
  return loadSettings(); // return masked version
}

/* ============================================================
   SERVER-SIDE STATE HYDRATION (F5 token loss fix)
   ──────────────────────────────────────────────────────────
   The server (`jira_config.json`) is the source of truth for tokens —
   all integration API calls go through `/api/integrations/*` which
   read tokens from disk server-side. localStorage is only a client-side
   convenience copy for pre-populating the settings form and for "is
   configured?" UI checks.

   Before this fix, `getConnectionStatus()` and the sync helpers
   decided "configured" based on localStorage alone. If the user
   cleared site data, opened a fresh browser, or relied on a server
   admin pre-filling `jira_config.json`, then F5 showed "Jira не
   настроена" everywhere — even though API calls would have worked
   fine. Saving in the modal repopulated localStorage and the warnings
   went away.

   Now we hydrate `_serverState` once at app boot from `GET /api/jira/
   config` (which exposes only `hasJiraToken`-style booleans, never the
   raw tokens). `isConfigured()` prefers server-known state; falls back
   to localStorage if hydration hasn't happened (or failed).
   ============================================================ */

let _serverState = null; // null = not yet hydrated

/* Fire-and-forget on app boot. Returns the sanitized config on success,
   null on any failure (network, non-OK response, parse error). */
export async function hydrateFromServer() {
  try {
    const res = await fetch('/api/jira/config', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const cfg = await res.json();
    _serverState = {
      jira:       { hasToken: !!cfg.hasJiraToken,       baseUrl: cfg.jiraBaseUrl       || '' },
      sigmaJira:  { hasToken: !!cfg.hasSigmaJiraToken,  baseUrl: cfg.sigmaJiraBaseUrl  || '' },
      bitbucket:  { hasToken: !!cfg.hasBitbucketToken,  baseUrl: cfg.bitbucketBaseUrl  || '' },
      confluence: { hasToken: !!cfg.hasConfluenceToken, baseUrl: cfg.confluenceBaseUrl || '' },
      jenkins:    { hasToken: !!cfg.hasJenkinsToken,    baseUrl: cfg.jenkinsBaseUrl    || '', folder: cfg.jenkinsFolder || '' },
    };
    return cfg;
  } catch(_) {
    return null;
  }
}

/* Read-only access to the cached server state (or null if never hydrated). */
export function getServerState() { return _serverState; }

/* Returns true if a service is configured. Prefers server-side state
   (source of truth) when hydrated; falls back to localStorage tokens.
   service ∈ 'jira' | 'sigmaJira' | 'bitbucket' | 'confluence'. */
export function isConfigured(service) {
  const raw = loadSettingsRaw();
  const map = {
    jira:       { url: 'jiraBaseUrl',       tok: 'jiraToken' },
    sigmaJira:  { url: 'sigmaJiraBaseUrl',  tok: 'sigmaJiraToken' },
    bitbucket:  { url: 'bitbucketBaseUrl',  tok: 'bitbucketToken' },
    confluence: { url: 'confluenceBaseUrl', tok: 'confluenceToken' },
    jenkins:    { url: 'jenkinsBaseUrl',    tok: 'jenkinsToken' },
  };
  const m = map[service];
  if (!m) return false;
  const srv = _serverState?.[service];
  const haveUrl = !!(raw[m.url] || srv?.baseUrl);
  const haveTok = !!(raw[m.tok] || srv?.hasToken);
  return haveUrl && haveTok;
}

/* Check which services are configured. Uses server-truth via isConfigured(). */
export function getConnectionStatus() {
  const raw = loadSettingsRaw();
  const srv = _serverState || {};
  return {
    jira:       { configured: isConfigured('jira'),       url: raw.jiraBaseUrl       || srv.jira?.baseUrl       || '' },
    sigmaJira:  { configured: isConfigured('sigmaJira'),  url: raw.sigmaJiraBaseUrl  || srv.sigmaJira?.baseUrl  || '' },
    bitbucket:  { configured: isConfigured('bitbucket'),  url: raw.bitbucketBaseUrl  || srv.bitbucket?.baseUrl  || '' },
    confluence: { configured: isConfigured('confluence'), url: raw.confluenceBaseUrl || srv.confluence?.baseUrl || '' },
    jenkins:    { configured: isConfigured('jenkins'),    url: raw.jenkinsBaseUrl    || srv.jenkins?.baseUrl    || '' },
    lastSync:   raw.lastSync,
  };
}
