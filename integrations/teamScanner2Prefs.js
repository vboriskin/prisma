'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — REMOTE PREFS  (V21 V1 — POC)

   Client-side helper для sync user preferences между устройствами.
   Server endpoint: /api/integrations/scanner-prefs?user=<key>.

   POC scope: только non-blocking «опциональный backup». Чтение —
   merge с localStorage; запись — fire-and-forget. Если server упал
   или user не задан — все toggle'ы продолжают работать через
   localStorage.

   ВАЖНО: server-side identity сейчас trust-by-query (no auth). Это
   POC для пилота 1 команды. CTO sign-off + SAML claim — required для
   full rollout (см. docs/v20-scanner2-handoff.md V21 V1).
   ============================================================ */

let _userKey = '';

/** Set the user key (email) для sync. Если empty — sync выключен. */
export function setRemotePrefsUser(email) {
  _userKey = String(email || '').trim().toLowerCase();
}

/**
 * Pull remote prefs (non-blocking, best-effort). Возвращает Promise<{...}> или {}.
 * Если sync выключен — возвращает {}.
 */
export async function pullRemotePrefs() {
  if (!_userKey) return {};
  try {
    const res = await fetch(`/api/integrations/scanner-prefs?user=${encodeURIComponent(_userKey)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return {};
    return await res.json();
  } catch (_) {
    return {};
  }
}

/**
 * Push partial pref update (fire-and-forget). Не блокирует UI.
 * Если sync выключен / network упал — silent.
 */
export function pushRemotePrefs(partial) {
  if (!_userKey || !partial || typeof partial !== 'object') return;
  // Fire-and-forget. Errors are swallowed — degraded gracefully to localStorage-only.
  fetch(`/api/integrations/scanner-prefs?user=${encodeURIComponent(_userKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
    signal: AbortSignal.timeout(5000),
  }).catch(() => { /* silent */ });
}

/**
 * Apply remote prefs to localStorage if remote-side is newer than local.
 * Compares lastViewedAt timestamps.
 */
export async function syncFromRemote(localKeys) {
  if (!_userKey) return;
  const remote = await pullRemotePrefs();
  if (!remote || typeof remote !== 'object') return;
  // Only apply if remote.lastViewedAt > localStorage timestamp.
  let localTs = 0;
  try {
    const v = localStorage.getItem('q2_scanner2_prefs_synced_at');
    if (v) localTs = Number(v) || 0;
  } catch (_) {}
  if (!remote.lastViewedAt || remote.lastViewedAt <= localTs) return;
  // Map remote fields → localStorage keys (whitelist).
  const map = {
    team:            'q2_scanner2_selectedTeam',
    sprintFilter:    'q2_scanner_active_sprint_only',
    showBlocked:     'q2_scanner_show_blocked',
    velocityCompare: 'q2_scanner_velocity_compare',
    velocityView:    'q2_scanner_velocity_view',
  };
  try {
    for (const [src, dst] of Object.entries(map)) {
      if (src in remote) {
        const v = remote[src];
        if (typeof v === 'boolean') localStorage.setItem(dst, v ? '1' : '0');
        else if (typeof v === 'string') localStorage.setItem(dst, v);
      }
    }
    localStorage.setItem('q2_scanner2_prefs_synced_at', String(remote.lastViewedAt));
  } catch (_) { /* quota / disabled */ }
}
