'use strict';
/* ============================================================
   INTEGRATIONS VIEW — v10_0
   Orchestrates the Integrations tab: render + sync + settings.
   Read-only for data rows — all mutations go through applyUpdates().
   ============================================================ */

import { state, notify }             from '../state.js';
import { Storage }                   from '../dataStore.js';
import { loadSettings, loadSettingsForUI, saveSettings, getConnectionStatus } from '../integrations/integrationsStore.js';
import { syncAllRows, fullPullFromSystems, verifyJira, verifyBitbucket, verifyConfluence } from '../integrations/integrationsSync.js';
import { RowFactory } from '../rowFactory.js';
import { RiskEngine } from '../riskEngine.js';
import {
  renderIntegrationsPage, renderIntegrationsEmpty,
  renderSettingsModal,
} from '../integrations/integrationsRenderer.js';
import { PortfolioPulse } from '../integrations/portfolioPulse.js';
import { TeamScanner2 } from '../integrations/teamScanner2.js';
import { BlackDashboard } from '../integrations/blackDashboard.js';
// V17 P4 — new sub-tab «Производительность сотрудников».
import { EmployeePerformance } from '../integrations/employeePerformance.js';

/* ── Apply sync updates back to state.rows ────────────────── */
function applyUpdates(updates) {
  if (!updates || !updates.length) return 0;
  let changed = 0;
  updates.forEach(upd => {
    const row = state.rows.find(r => r.id === upd.id);
    if (!row) return;
    const KEYS = ['jiraStatus','jiraAssignee','jiraUpdatedAt','prUrl','prStatus','prUpdatedAt','docUrl','docTitle'];
    KEYS.forEach(k => { if (k in upd && upd[k] !== undefined) row[k] = upd[k]; });
    row.updatedAt = new Date().toISOString();
    changed++;
  });
  return changed;
}

/* ── Apply cross-filter ───────────────────────────────────── */
function applyCrossFilter(crossKey) {
  const f = state.filters;
  const activeRows = state.rows.filter(r => !r.isDone);
  const inRelease  = activeRows.filter(r => r.hasRelease120 || r.hasRelease121 || r.hasRelease122);
  const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
  let ids = [];

  if (crossKey === 'no-jira-assignee') ids = inRelease.filter(r => r.jiraKey && !r.jiraAssignee).map(r => r.id);
  if (crossKey === 'no-pr')            ids = inRelease.filter(r => r.jiraKey && !r.prUrl).map(r => r.id);
  if (crossKey === 'no-doc')           ids = inRelease.filter(r => r.jiraKey && !r.docUrl).map(r => r.id);
  if (crossKey === 'stalled')          ids = activeRows.filter(r => {
    if (!r.jiraKey || !r.jiraUpdatedAt) return false;
    try { return new Date(r.jiraUpdatedAt).getTime() < sevenDaysAgo; } catch(_) { return false; }
  }).map(r => r.id);

  if (!ids.length) { window.showToast?.('Нет задач для этого фильтра', 'info'); return; }

  // Store filtered ids as a search note and go to registry
  // Use the search to highlight — simplest cross-section approach
  f.search = ''; f.team = ''; f.scope = ''; f.release = '';
  f.onlyBlocking = false; f.onlyRisky = false; f.onlyDone = false;
  window.App?.goTo?.('registry');
  window.notify?.('cross_filter');
  window.showToast?.(`Показано ${ids.length} задач`);
}

/* ── Settings modal binding ───────────────────────────────── */
function bindSettingsModal() {
  const modal = document.getElementById('int-settings-modal');
  if (!modal) return;

  // Inline mode (rendered inside app-settings modal) — no close button / no overlay click-out
  const inline = modal.classList.contains('int-inline');

  // Tab switching
  modal.querySelectorAll('.int-stab').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.int-stab').forEach(b => b.classList.remove('active'));
      modal.querySelectorAll('.int-stab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      modal.querySelector(`[data-panel="${btn.dataset.stab}"]`)?.classList.add('active');
    });
  });

  // Close (only when standalone)
  const close = () => { if (!inline) modal.remove(); };
  if (!inline) {
    modal.querySelector('#int-modal-close')?.addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
  }

  // V20 S1.3 — preset-radio для window-hours: показ/скрытие custom-input
  // и подсветка active-pill.
  modal.querySelectorAll('input[name="int-cf-window-preset"]').forEach(radio => {
    radio.addEventListener('change', () => {
      modal.querySelectorAll('.int-window-preset').forEach(lbl =>
        lbl.classList.toggle('int-window-preset-active',
          lbl.querySelector('input[type="radio"]')?.checked));
      const wrap = modal.querySelector('#int-cf-window-custom-wrap');
      if (wrap) wrap.classList.toggle('hidden', radio.value !== 'custom');
    });
  });

  // helper — reads global TLS checkbox (shared across tabs)
  const getTls = () => !!(modal.querySelector('#int-global-insecure')?.checked);
  const getSince = () => {
    const v = modal.querySelector('#int-global-since-date')?.value?.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '2025-01-01';
  };

  // V17.2 I3 — централизованный POST для server-config с await + ошибкой.
  //   Раньше каждый save handler делал `fetch(...).catch(()=>{})` (тихий
  //   provoke), и тост «✓ сохранено» появлялся даже при network error.
  //   Теперь возвращаем `{ok: bool, status?: number}` и save handler
  //   решает что показать.
  const postServerConfig = async (patch) => {
    try {
      const resp = await fetch('/api/jira/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      return { ok: resp.ok, status: resp.status };
    } catch (e) {
      return { ok: false, error: e?.message || 'сеть' };
    }
  };
  // V17.2 I3 — request-id guard: предотвращает гонку «два verify-клика
  //   быстро подряд» когда первый fresh-fetch успевает отрендерить
  //   результат поверх второго (с другим токеном).
  const _verifyReqIds = new Map();
  const nextReqId = (key) => {
    const n = (_verifyReqIds.get(key) || 0) + 1;
    _verifyReqIds.set(key, n);
    return n;
  };
  const isLatestReq = (key, n) => _verifyReqIds.get(key) === n;

  // ── Jira ──────────────────────────────────────────────────
  // V17.2 I3 — пустой URL не отправляется (как пустой токен) — раньше
  //   случайно очищенный URL стирал серверную копию → интеграция мертва.
  //   Сохранение теперь awaited; toast «✓ сохранено» появляется только
  //   после успешного 2xx от /api/jira/config.
  modal.querySelector('#int-jira-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const url = modal.querySelector('#int-jira-url')?.value?.trim() || '';
      const tok = modal.querySelector('#int-jira-token')?.value?.trim();
      const patch = {
        jiraProjectKeys: modal.querySelector('#int-jira-project-keys')?.value?.trim() || '',
        allowInsecureTls: getTls(), sinceDate: getSince(),
      };
      if (url) patch.jiraBaseUrl = url;       // empty → не пишем (защита от случайной очистки)
      if (tok) patch.jiraToken   = tok;
      saveSettings(patch);
      const serverPatch = {
        jiraProjectKeys: patch.jiraProjectKeys,
        allowInsecureTls: patch.allowInsecureTls, sinceDate: patch.sinceDate,
      };
      if (url) serverPatch.jiraBaseUrl = url;
      if (tok) serverPatch.jiraToken   = tok;
      const r = await postServerConfig(serverPatch);
      if (r.ok) {
        window.showToast?.('Jira настройки сохранены', 'success');
        window.HistoryLog?.settings?.('jira_save', `Jira настройки сохранены (${url||'без endpoint'})`);
        close();
      } else {
        window.showToast?.(`Не удалось сохранить на сервере: ${r.error || 'HTTP ' + r.status}`, 'error', 4000);
      }
    } finally {
      btn.disabled = false;
    }
  });

  modal.querySelector('#int-jira-verify')?.addEventListener('click', async () => {
    const res_el = modal.querySelector('#int-jira-verify-result');
    const url = modal.querySelector('#int-jira-url')?.value?.trim() || '';
    const tok = modal.querySelector('#int-jira-token')?.value?.trim();
    const insecure = getTls();
    const serverPatch = { allowInsecureTls: insecure };
    if (url) serverPatch.jiraBaseUrl = url;
    if (tok) serverPatch.jiraToken   = tok;
    await postServerConfig(serverPatch);
    saveSettings({ allowInsecureTls: insecure, ...(url ? { jiraBaseUrl: url } : {}), ...(tok ? { jiraToken: tok } : {}) });
    res_el?.classList.remove('hidden');
    res_el.textContent = '⏳ Проверяем...';
    // V17.2 I3 — request-id guard: rapid clicks no longer overwrite each other.
    const myId = nextReqId('jira');
    const r = await verifyJira();
    if (!isLatestReq('jira', myId)) return;
    res_el.className = r.ok ? 'int-verify-result int-verify-ok' : 'int-verify-result int-verify-err';
    res_el.textContent = r.ok ? `✓ Подключено (${r.who})` : `✗ Ошибка: ${r.error}`;
  });

  // ── Sigma Jira (для Чёрного дашборда) ─────────────────────
  // V17.2 I3 — same guard pattern as Jira save.
  modal.querySelector('#int-sigma-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const url = modal.querySelector('#int-sigma-url')?.value?.trim() || '';
      const tok = modal.querySelector('#int-sigma-token')?.value?.trim();
      const patch = {
        sigmaGoalEpicKeys: modal.querySelector('#int-sigma-goal-epic-keys')?.value?.trim() || '',
        allowInsecureTls:  getTls(), sinceDate: getSince(),
      };
      if (url) patch.sigmaJiraBaseUrl = url;
      if (tok) patch.sigmaJiraToken   = tok;
      saveSettings(patch);
      const serverPatch = {
        sigmaGoalEpicKeys: patch.sigmaGoalEpicKeys,
        allowInsecureTls: patch.allowInsecureTls, sinceDate: patch.sinceDate,
      };
      if (url) serverPatch.sigmaJiraBaseUrl = url;
      if (tok) serverPatch.sigmaJiraToken   = tok;
      const r = await postServerConfig(serverPatch);
      if (r.ok) {
        try { window.BlackDashboard?.invalidate?.(); } catch(_) {}
        window.showToast?.('Sigma Jira настройки сохранены', 'success');
        window.HistoryLog?.settings?.('sigma_jira_save', `Sigma Jira сохранены (${url||'без endpoint'})`);
        close();
      } else {
        window.showToast?.(`Не удалось сохранить Sigma на сервере: ${r.error || 'HTTP ' + r.status}`, 'error', 4000);
      }
    } finally {
      btn.disabled = false;
    }
  });

  modal.querySelector('#int-sigma-verify')?.addEventListener('click', async () => {
    const res_el = modal.querySelector('#int-sigma-verify-result');
    const url = modal.querySelector('#int-sigma-url')?.value?.trim() || '';
    const tok = modal.querySelector('#int-sigma-token')?.value?.trim();
    const serverPatch = { allowInsecureTls: getTls() };
    if (url) serverPatch.sigmaJiraBaseUrl = url;
    if (tok) serverPatch.sigmaJiraToken   = tok;
    await postServerConfig(serverPatch);
    saveSettings({ allowInsecureTls: getTls(), ...(url ? { sigmaJiraBaseUrl: url } : {}), ...(tok ? { sigmaJiraToken: tok } : {}) });
    res_el?.classList.remove('hidden');
    res_el.textContent = '⏳ Проверяем...';
    const myId = nextReqId('sigma');
    try {
      const resp = await fetch('/api/integrations/sigma-verify', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' });
      const data = await resp.json().catch(() => ({}));
      if (!isLatestReq('sigma', myId)) return;
      if (resp.ok && data.ok) {
        res_el.className = 'int-verify-result int-verify-ok';
        res_el.textContent = `✓ Подключено (${data.who || 'OK'})`;
      } else {
        res_el.className = 'int-verify-result int-verify-err';
        res_el.textContent = `✗ Ошибка: ${data.error || `HTTP ${resp.status}`}`;
      }
    } catch (e) {
      if (!isLatestReq('sigma', myId)) return;
      res_el.className = 'int-verify-result int-verify-err';
      res_el.textContent = `✗ Ошибка: ${e.message || 'сеть'}`;
    }
  });

  // ── Bitbucket ─────────────────────────────────────────────
  // V17.2 I3 — same guards.
  modal.querySelector('#int-bb-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const url = modal.querySelector('#int-bb-url')?.value?.trim() || '';
      const tok = modal.querySelector('#int-bb-token')?.value?.trim();
      const patch = {
        bitbucketProjectKeys: modal.querySelector('#int-bb-project-keys')?.value?.trim() || '',
        allowInsecureTls: getTls(), sinceDate: getSince(),
      };
      if (url) patch.bitbucketBaseUrl = url;
      if (tok) patch.bitbucketToken   = tok;
      saveSettings(patch);
      const serverPatch = {
        bitbucketProjectKeys: patch.bitbucketProjectKeys,
        allowInsecureTls: patch.allowInsecureTls, sinceDate: patch.sinceDate,
      };
      if (url) serverPatch.bitbucketBaseUrl = url;
      if (tok) serverPatch.bitbucketToken   = tok;
      const r = await postServerConfig(serverPatch);
      if (r.ok) {
        window.showToast?.('Bitbucket настройки сохранены', 'success');
        window.HistoryLog?.settings?.('bitbucket_save', `Bitbucket настройки сохранены (${url||'без endpoint'})`);
        close();
      } else {
        window.showToast?.(`Не удалось сохранить Bitbucket на сервере: ${r.error || 'HTTP ' + r.status}`, 'error', 4000);
      }
    } finally {
      btn.disabled = false;
    }
  });

  modal.querySelector('#int-bb-verify')?.addEventListener('click', async () => {
    const bbUrl = modal.querySelector('#int-bb-url')?.value?.trim() || '';
    const bbTok = modal.querySelector('#int-bb-token')?.value?.trim();
    const serverPatch = { allowInsecureTls: getTls(), sinceDate: getSince() };
    if (bbUrl) serverPatch.bitbucketBaseUrl = bbUrl;
    if (bbTok) serverPatch.bitbucketToken   = bbTok;
    await postServerConfig(serverPatch);
    const res_el = modal.querySelector('#int-bb-verify-result');
    res_el?.classList.remove('hidden');
    res_el.textContent = '⏳ Проверяем...';
    const myId = nextReqId('bitbucket');
    const r = await verifyBitbucket();
    if (!isLatestReq('bitbucket', myId)) return;
    res_el.className = r.ok ? 'int-verify-result int-verify-ok' : 'int-verify-result int-verify-err';
    res_el.textContent = r.ok ? `✓ Подключено (${r.who || 'OK'})` : `✗ Ошибка: ${r.error}`;
  });

  // ── Confluence ────────────────────────────────────────────
  // V17.2 I3 — same guards.
  modal.querySelector('#int-cf-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const url = modal.querySelector('#int-cf-url')?.value?.trim() || '';
      const tok = modal.querySelector('#int-cf-token')?.value?.trim();
      // V17.2 I2c — space-keys + activityWindowHours.
      // V20 S1.3 — окно теперь берётся из preset-radio (24/72/168/custom).
      // Если custom — читаем custom input. Любые ошибки → fallback 72.
      const spaceKeys = modal.querySelector('#int-cf-space-keys')?.value?.trim() || '';
      const presetRadio = modal.querySelector('input[name="int-cf-window-preset"]:checked');
      const presetVal = presetRadio?.value || '72';
      let winHours;
      if (presetVal === 'custom') {
        const winRaw = modal.querySelector('#int-cf-window-hours')?.value;
        winHours = Number(winRaw) || 72;
      } else {
        winHours = Number(presetVal) || 72;
      }
      // Server clamps [1,168] in saveSettings; UI redundancy для defense-in-depth.
      if (!Number.isFinite(winHours) || winHours < 1) winHours = 72;
      if (winHours > 168) winHours = 168;
      const patch = {
        allowInsecureTls: getTls(),
        sinceDate: getSince(),
        confluenceSpaceKeys: spaceKeys,    // empty string overwrite OK — это явное «искать везде»
        activityWindowHours: winHours,
      };
      if (url) patch.confluenceBaseUrl = url;
      if (tok) patch.confluenceToken   = tok;
      saveSettings(patch);
      const serverPatch = {
        allowInsecureTls: patch.allowInsecureTls,
        sinceDate: patch.sinceDate,
        confluenceSpaceKeys: spaceKeys,
        activityWindowHours: winHours,
      };
      if (url) serverPatch.confluenceBaseUrl = url;
      if (tok) serverPatch.confluenceToken   = tok;
      const r = await postServerConfig(serverPatch);
      if (r.ok) {
        window.showToast?.('Confluence настройки сохранены', 'success');
        window.HistoryLog?.settings?.('confluence_save', `Confluence настройки сохранены (${url||'без endpoint'}, ${spaceKeys ? 'spaces=' + spaceKeys : 'все пространства'}, окно ${winHours}ч)`);
        close();
      } else {
        window.showToast?.(`Не удалось сохранить Confluence на сервере: ${r.error || 'HTTP ' + r.status}`, 'error', 4000);
      }
    } finally {
      btn.disabled = false;
    }
  });

  modal.querySelector('#int-cf-verify')?.addEventListener('click', async () => {
    const cfUrl = modal.querySelector('#int-cf-url')?.value?.trim() || '';
    const cfTok = modal.querySelector('#int-cf-token')?.value?.trim();
    const serverPatch = { allowInsecureTls: getTls(), sinceDate: getSince() };
    if (cfUrl) serverPatch.confluenceBaseUrl = cfUrl;
    if (cfTok) serverPatch.confluenceToken   = cfTok;
    await postServerConfig(serverPatch);
    const res_el = modal.querySelector('#int-cf-verify-result');
    res_el?.classList.remove('hidden');
    res_el.textContent = '⏳ Проверяем...';
    const myId = nextReqId('confluence');
    const r = await verifyConfluence();
    if (!isLatestReq('confluence', myId)) return;
    res_el.className = r.ok ? 'int-verify-result int-verify-ok' : 'int-verify-result int-verify-err';
    res_el.textContent = r.ok ? `✓ Подключено (${r.who || 'OK'})` : `✗ Ошибка: ${r.error}`;
  });

  // V17.2 I2c (G7) — Audit log probe.
  modal.querySelector('#int-cf-audit-probe')?.addEventListener('click', async () => {
    const res_el = modal.querySelector('#int-cf-verify-result');
    res_el?.classList.remove('hidden');
    res_el.textContent = '⏳ Запрос аудит-лога...';
    try {
      const resp = await fetch('/api/integrations/confluence-audit-logins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await resp.json().catch(() => ({}));
      if (!data.ok) {
        res_el.className = 'int-verify-result int-verify-err';
        res_el.textContent = `✗ Аудит: ${data.error || 'HTTP ' + resp.status}`;
        return;
      }
      const users = Array.isArray(data.users) ? data.users : [];
      const top = users.slice(0, 5).map(u => `${u.displayName || u.username || '?'} (${u.loginCount})`).join(', ');
      res_el.className = 'int-verify-result int-verify-ok';
      res_el.textContent = `✓ Аудит за ${data.windowHours}ч: ${users.length} пользователей, ${data.loginRecords} событий${top ? ' · топ: ' + top : ''}`;
    } catch (e) {
      res_el.className = 'int-verify-result int-verify-err';
      res_el.textContent = `✗ Ошибка: ${e.message || 'сеть'}`;
    }
  });
}

/* ── Open settings modal ──────────────────────────────────── */
function openSettingsModal(activeTab) {
  document.getElementById('int-settings-modal')?.remove();
  const settings = loadSettingsForUI();
  const html = renderSettingsModal(settings);
  document.body.insertAdjacentHTML('beforeend', html);
  // Activate requested tab.
  // V17.1.3 — после разделения Jira (Delta + Sigma) на две вкладки дефолт стал
  //   `jira-delta`. Старое значение `'jira'` мапим на `jira-delta` для backward
  //   compatibility (callers могут ещё передавать 'jira').
  let target = activeTab;
  if (target === 'jira') target = 'jira-delta';
  if (target && target !== 'jira-delta') {
    const modal = document.getElementById('int-settings-modal');
    modal?.querySelectorAll('.int-stab').forEach(b => b.classList.remove('active'));
    modal?.querySelectorAll('.int-stab-panel').forEach(p => p.classList.remove('active'));
    modal?.querySelector(`[data-stab="${target}"]`)?.classList.add('active');
    modal?.querySelector(`[data-panel="${target}"]`)?.classList.add('active');
  }
  bindSettingsModal();
}

/* ═══════════════════════════════════════════════════════════
   MAIN VIEW
   ═══════════════════════════════════════════════════════════ */
export const IntegrationsView = {
  _root: null,

  // V18.1 P6 — Сканнер 2.0 graduated из preview и теперь дефолт. v1
  // (PortfolioPulse) остаётся доступен как «legacy» fallback. После
  // ~2-3 итераций без жалоб v1 будет удалён.
  _activeSubtab: 'scanner2',  // 'scanner2' | 'pulse' | 'black' | 'perf' | 'overview'

  // Pulse data is cached after first load. Subsequent tab switches restore
  // the cached UI without refetching. The user explicitly refreshes via the
  // "↻ Обновить данные" button in the Pulse header.
  _pulseLoaded: false,
  // V18.1 P1 — TeamScanner 2.0 (preview) cache flag, mirror of _pulseLoaded.
  _scanner2Loaded: false,
  // BlackDashboard caches its model internally — we just track whether the
  // user has explicitly triggered a load yet (vs first-open of the sub-tab).

  render() {
    const root = document.getElementById('section-integrations');
    if (!root) return;
    this._root = root;

    const rows = state.rows;
    const status   = getConnectionStatus();
    const settings = loadSettings();

    // Sub-tab nav (Portfolio Pulse first per user request).
    // V17 P4 — added «Производительность сотрудников» sub-tab.
    // V18.1 P6 — порядок subtab'ов отражает graduation: scanner2 первый
    // (default), legacy-v1 в конце с muted-pill «legacy».
    const subtabsHtml = `
      <div class="int-subtabs">
        <button class="int-subtab ${this._activeSubtab==='scanner2'?'int-subtab-active':''}" data-subtab="scanner2">Сканнер команд</button>
        <button class="int-subtab ${this._activeSubtab==='black'?'int-subtab-active':''}"    data-subtab="black">⚫ Чёрный дашборд</button>
        <button class="int-subtab ${this._activeSubtab==='perf'?'int-subtab-active':''}"     data-subtab="perf">👥 Производительность сотрудников</button>
        <button class="int-subtab ${this._activeSubtab==='overview'?'int-subtab-active':''}" data-subtab="overview">Сводная</button>
        <button class="int-subtab int-subtab-legacy ${this._activeSubtab==='pulse'?'int-subtab-active':''}" data-subtab="pulse" title="Старая версия Сканнера. Будет удалена в одной из следующих итераций.">📡 Сканнер команд <span class="int-subtab-pill int-subtab-pill-legacy">legacy</span></button>
      </div>`;

    let bodyHtml;
    if (this._activeSubtab === 'pulse') {
      bodyHtml = `<div id="pp-root" class="pp-root"></div>`;
    } else if (this._activeSubtab === 'scanner2') {
      // V18.1 P1 — TeamScanner 2.0 preview tab.
      bodyHtml = `<div id="ts2-root" class="ts2-mount"></div>`;
    } else if (this._activeSubtab === 'black') {
      bodyHtml = `<div id="bd-root" class="bd-root"></div>`;
    } else if (this._activeSubtab === 'perf') {
      // V17 P4 — employee performance dashboard.
      bodyHtml = `<div id="ep-root" class="ep-root"></div>`;
    } else if (!rows || !rows.length) {
      bodyHtml = renderIntegrationsEmpty();
    } else {
      bodyHtml = renderIntegrationsPage(rows, status, settings);
    }

    root.innerHTML = `<div id="int-root" class="view-root">${subtabsHtml}${bodyHtml}</div>`;

    // Sub-tab clicks
    root.querySelectorAll('.int-subtab').forEach(b => {
      b.addEventListener('click', () => {
        const next = b.dataset.subtab;
        // V18.1 P7-S1.1 — unmount lifecycle для scanner2: убираем
        // orphan-листенер `_escHandler` с `document` при уходе со
        // вкладки. Без этого через несколько переключений subtab'ов
        // Esc в чужой вкладке дёргал _closePanel() на детачнутом
        // scanner2-контейнере (race + DOM operations on detached node).
        if (this._activeSubtab === 'scanner2' && next !== 'scanner2') {
          try { TeamScanner2.unmount?.(); } catch (_) {}
        }
        this._activeSubtab = next;
        this.render();
      });
    });

    this._bindEvents(root);

    if (this._activeSubtab === 'pulse') {
      const ppRoot = document.getElementById('pp-root');
      if (ppRoot) {
        // Re-mount the (possibly destroyed) container reference so progress
        // events repaint into the right node. Five states (priority order):
        //  · loading   → re-show the loader (fetch still running)
        //  · cancelled → repaint cancel UI (do NOT auto-restart)
        //  · errored   → repaint error UI (do NOT auto-retry)
        //  · cached    → repaint dashboard from cached _model
        //  · cold      → first-time fetch
        PortfolioPulse._container = ppRoot;
        if (PortfolioPulse.isLoading?.()) {
          PortfolioPulse._showLoader?.();
        } else if (PortfolioPulse._cancelled) {
          PortfolioPulse._paintCancelled?.();
        } else if (PortfolioPulse._errorMsg) {
          PortfolioPulse._paintError?.(PortfolioPulse._errorMsg);
        } else if (this._pulseLoaded && PortfolioPulse._model) {
          PortfolioPulse._renderFull();
        } else {
          PortfolioPulse.render(ppRoot);
          this._pulseLoaded = true;
        }
      }
    } else if (this._activeSubtab === 'scanner2') {
      // V18.1 P1 — TeamScanner 2.0 mount. Mirror of pulse handoff:
      // orchestrator сам решает какое состояние рисовать (cancelled /
      // errored / loading / cached / cold) — render() идемпотентен.
      // V20 S1.1 — cold mount теперь не auto-fetch'ит: render() рисует
      // empty-hero с CTA «Загрузить данные». На subtab-возврате с cache
      // (`_scanner2Loaded && _model`) — instant re-paint через _renderFull.
      const ts2Root = document.getElementById('ts2-root');
      if (ts2Root) {
        TeamScanner2._container = ts2Root;
        if (TeamScanner2.isLoading?.()) {
          TeamScanner2._showLoader?.();
        } else if (TeamScanner2._cancelled) {
          TeamScanner2._paintCancelled?.();
        } else if (TeamScanner2._errorMsg) {
          TeamScanner2._paintError?.(TeamScanner2._errorMsg);
        } else if (this._scanner2Loaded && TeamScanner2._model) {
          TeamScanner2._renderFull();
        } else {
          TeamScanner2.render(ts2Root);
          this._scanner2Loaded = true;
        }
      }
    } else if (this._activeSubtab === 'black') {
      // BlackDashboard mirrors the Pulse-style container handoff. The orchestrator
      // chooses the right state itself (not-configured / not-loaded / loading /
      // cached / fresh-fetch) — render() is idempotent and safe to call on each
      // sub-tab switch.
      const bdRoot = document.getElementById('bd-root');
      if (bdRoot) BlackDashboard.render(bdRoot);
    } else if (this._activeSubtab === 'perf') {
      // V17 P4 — Employee Performance render handoff.
      const epRoot = document.getElementById('ep-root');
      if (epRoot) EmployeePerformance.render(epRoot);
    }
  },

  /* Force a full Pulse refetch — invoked from the "↻ Обновить данные" button. */
  refreshPulse() {
    this._pulseLoaded = true;        // reset flag stays true so cache holds
    if (this._activeSubtab === 'pulse') {
      const ppRoot = document.getElementById('pp-root');
      if (ppRoot) PortfolioPulse.refresh();
    }
  },

  /* V18.1 P1 — TeamScanner 2.0 refresh, mirror of refreshPulse. Invoked from
     the «↻ Обновить» кнопки внутри ts2-topbar. */
  refreshScanner2() {
    this._scanner2Loaded = true;
    if (this._activeSubtab === 'scanner2') {
      const ts2Root = document.getElementById('ts2-root');
      if (ts2Root) TeamScanner2.refresh();
    }
  },

  /* ── event delegation ──────────────────────────────────── */
  _bindEvents(root) {
    root.addEventListener('click', async e => {
      // ── Sync / Fetch buttons FIRST — they DON'T carry data-int-action,
      //    so we must check them before the early-return below.
      if (e.target.closest('#int-sync-all-btn')) {
        await this._syncAll();
        return;
      }
      if (e.target.closest('#int-fetch-all-btn')) {
        await this._fetchAll();
        return;
      }

      // Everything else uses the [data-int-action] convention
      const el = e.target.closest('[data-int-action]');
      if (!el) return;
      const action = el.dataset.intAction;

      if (action === 'settings') {
        openSettingsModal(el.dataset.tab || 'jira');
        return;
      }
      if (action === 'filter') {
        this._applyIntFilter(el.dataset.filter);
        return;
      }
      if (action === 'cross-filter') {
        applyCrossFilter(el.dataset.cross);
        return;
      }
      if (action === 'cross-explain') {
        const msg = {
          'no-jira-assignee': 'Объясни риски задач в релизе без Jira Assignee',
          'no-pr':            'Объясни риски задач в релизе без Pull Request',
          'no-doc':           'Объясни риски задач без документации в Confluence',
          'stalled':          'Объясни что делать с задачами которые давно не обновлялись в Jira',
        }[el.dataset.cross] || 'Объясни эту проблему';
        try {
          const input = document.getElementById('assistant-input');
          if (input) { input.value = msg; input.dispatchEvent(new Event('input')); document.getElementById('assistant-btn-send')?.click(); }
          else document.getElementById('assistant-fab')?.click();
        } catch(_) {}
        return;
      }
    });
  },

  /* ── Registry filter helper ───────────────────────────── */
  _applyIntFilter(type) {
    const f = state.filters;
    f.search = ''; f.team = ''; f.scope = ''; f.release = '';
    f.onlyBlocking = false; f.onlyRisky = false; f.onlyDone = false;
    if (type === 'jira')       f.search = 'jira:';        // registry search handles this
    if (type === 'bitbucket')  f.search = '';
    if (type === 'confluence') f.search = '';
    window.App?.goTo?.('registry');
    notify('int_filter');
    window.showToast?.('Переход в реестр');
  },

  /* ── Inline loader (lives inside #int-sync-progress) ───────
     Non-blocking: rest of the app stays interactive while sync runs. */
  _inlineLoader(initialText) {
    const el = document.getElementById('int-sync-progress');
    if (!el) return null;
    el.classList.remove('hidden');
    el.classList.add('int-loader');
    el.innerHTML = `
      <div class="int-loader-spinner" aria-hidden="true"></div>
      <div class="int-loader-text">
        <div class="int-loader-title" id="int-loader-title">${(initialText||'Обработка…').replace(/[<>&]/g, '')}</div>
        <div class="int-loader-phrase" id="int-loader-phrase"></div>
      </div>`;
    const phrases = [
      '🤖 Дёргаем Jira за галстук…',
      '☕ Завариваю кофе для синка…',
      '🐌 Тащим тикеты по сети…',
      '📡 Звоним в Bitbucket, ищем PR…',
      '☁️ Стучимся в Confluence…',
      '🧩 Сшиваем эпики с jira-ключами…',
      '🔎 Ищем то, чего не хватает…',
      '🐙 Связываем всё со всем (8 рук)…',
      '⏳ Ещё чуть-чуть. Серьёзно.',
      '🥷 Ниндзя-менеджер обходит блокеры…',
    ];
    const phraseEl = document.getElementById('int-loader-phrase');
    const used = new Set();
    const tick = () => {
      const pool = phrases.filter(p => !used.has(p));
      if (!pool.length) used.clear();
      const next = (pool.length ? pool : phrases)[Math.floor(Math.random() * (pool.length || phrases.length))];
      used.add(next);
      if (phraseEl) {
        phraseEl.classList.remove('int-loader-phrase-in');
        void phraseEl.offsetWidth;
        phraseEl.textContent = next;
        phraseEl.classList.add('int-loader-phrase-in');
      }
    };
    tick();
    const interval = setInterval(tick, 2200);
    return {
      update(t) {
        const titleEl = document.getElementById('int-loader-title');
        if (titleEl) titleEl.textContent = String(t || '').slice(0, 200);
      },
      close() {
        clearInterval(interval);
        el.classList.remove('int-loader');
        el.classList.add('hidden');
        el.innerHTML = '';
      },
    };
  },

  /* ── Sync all rows ────────────────────────────────────── */
  async _syncAll() {
    const btn = document.getElementById('int-sync-all-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Синхронизация...'; }
    const loader = this._inlineLoader('Обновляю существующие задачи…');

    try {
      const result = await syncAllRows(state.rows, {
        onProgress: (done, total) => {
          loader?.update(`Обработано ${done} / ${total} задач`);
        },
      });

      if (result.updates.length) {
        const changed = applyUpdates(result.updates);
        Storage.save();
        notify('integrations_sync');
        window.showToast?.(`✓ Синхронизировано: ${changed} задач обновлено`);
        window.HistoryLog?.integrations?.('sync_existing', `Обновлено ${changed} задач из Jira/Bitbucket/Confluence`, { count: changed });
        this.render(); // re-render with fresh data
      } else if (!result.synced) {
        window.showToast?.('Нет задач с Jira Key — нечего синхронизировать', 'info');
      } else {
        window.showToast?.('Данные актуальны', 'info');
        window.HistoryLog?.integrations?.('sync_no_changes', 'Синхронизация: данные уже актуальны');
      }
    } catch(e) {
      console.warn('[IntegrationsView] Sync error:', e);
      window.showToast?.(`Ошибка синхронизации: ${e.message}`, 'error');
    } finally {
      loader?.close();
      if (btn) { btn.disabled = false; btn.textContent = '↺ Обновить существующие'; }
    }
  },

  /* ── Full pull: fetch everything from systems and create new rows ─ */
  async _fetchAll() {
    const btn = document.getElementById('int-fetch-all-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Загрузка...'; }
    const loader = this._inlineLoader('Тяну всё из Jira / Bitbucket / Confluence…');

    try {
      window.HistoryManager?.checkpoint('Полная загрузка из интеграций');
      const result = await fullPullFromSystems(state.rows, {
        onProgress: ({ phase, current, total }) => {
          if (phase === 'jira-fetch') loader?.update('Запрашиваю задачи из Jira…');
          else if (phase === 'enrich') loader?.update(`Обогащение Bitbucket / Confluence: ${current} / ${total}`);
        },
      });

      // Apply updates to existing rows
      const updatedCount = applyUpdates(result.updates);

      // Add brand-new rows
      let createdCount = 0;
      result.newRowsToAdd.forEach(seed => {
        const row = RowFactory.create({ ...seed, sourceType: 'jira-fetch' });
        if (row.fio == null && seed.assignee) row.fio = seed.assignee; // best-effort
        state.rows.push(row);
        createdCount++;
      });
      if (createdCount) {
        // Re-derive risk flags & metrics
        try { state.rows.forEach(r => RowFactory.updateDerived?.(r)); } catch(_) {}
        try { RiskEngine.computeAll?.(); } catch(_) {}
      }

      Storage.save();
      notify('integrations_full_pull');

      const errs = (result.errors || []).join(' · ');
      const summary = `Загрузка завершена: ${result.fetchedIssues} задач из Jira • +${createdCount} новых • обновлено ${updatedCount}`;
      window.showToast?.(summary + (errs ? ' | ' + errs : ''), errs ? 'warning' : 'success', 4500);
      window.HistoryLog?.integrations?.('fetch_all', summary, { count: result.fetchedIssues, details: errs });
      this.render();
    } catch(e) {
      console.warn('[IntegrationsView] Full pull error:', e);
      window.showToast?.(`Ошибка полной загрузки: ${e.message}`, 'error');
    } finally {
      loader?.close();
      if (btn) { btn.disabled = false; btn.textContent = '⤓ Загрузить всё из систем'; }
    }
  },
};

/* ── Expose settings modal globally ────────────────────────
   So the topbar "Интеграции" button can open it without
   requiring a full view render. ─────────────────────────── */
export function openIntegrationsSettings(tab) {
  openSettingsModal(tab || 'jira');
}

/* Expose helpers so AppSettings can render the form inline inside the unified Settings modal */
if (typeof window !== 'undefined') {
  // Use loadSettingsForUI so password inputs pre-populate (user doesn't have to retype tokens)
  window.IntegrationsLoadSettings = loadSettingsForUI;
  window.IntegrationsRenderModal  = renderSettingsModal;
  window.IntegrationsBindModal    = bindSettingsModal;
}
