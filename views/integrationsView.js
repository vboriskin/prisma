'use strict';
/* ============================================================
   INTEGRATIONS VIEW — v10_0
   Orchestrates the Integrations tab: sub-tab nav + settings modal.
   ============================================================ */

import { loadSettingsForUI, saveSettings } from '../integrations/integrationsStore.js';
import { verifyJira, verifyBitbucket, verifyConfluence } from '../integrations/integrationsSync.js';
import { renderSettingsModal } from '../integrations/integrationsRenderer.js';
import { TeamScanner2 } from '../integrations/teamScanner2.js';
import { BlackDashboard } from '../integrations/blackDashboard.js';
// Phase 3 C2 — sub-tab «Сегодня» / «Глубже» state живёт в renderer-модуле,
// тут только setter+reset для click-handler.
import { setScannerTab as _setScannerTab, resetScannerTab as _resetScannerTab } from '../integrations/teamScanner2Renderer.js';
import { renderPageHeader } from '../app/prizmaUI.js';
import { Icons } from '../app/icons.js';
import { Utils } from '../utils.js';
import { Services } from '../app/services.js';

/* ── P11.15: helpers ─────────────────────────────────────────
   _statusBadge — единый рендер verify-result через signal-dot
   (brandbook §3 Signal). Эмодзи и текстовые «✓ / ✗ / ⏳» больше не
   используются в UI: точка цветом несёт статусный смысл, текст —
   человеческий, без HTTP-кодов.

   _humanHttp — карта серверных HTTP-кодов в человекочитаемые
   формулировки. Используется и в verify-result, и в toast'ах,
   чтобы пользователь не видел «HTTP 401» / «HTTP 500».
   ────────────────────────────────────────────────────────── */
const _esc = s => Utils.escapeHtml(String(s ?? ''));

/**
 * Форматирует verify-result содержимое как `<signal-dot> + текст`.
 * @param {'pending'|'ok'|'err'} state
 * @param {string} msg  Уже человекочитаемый текст (без HTTP-кодов).
 * @returns {string} innerHTML
 */
function _statusBadge(state, msg) {
  const dotCls =
    state === 'ok'      ? 'signal-on-course'
  : state === 'err'     ? 'signal-off-course'
  : /* pending */         'signal-information';
  // AUDIT_ARTDIRECTION #31 — pending-state «дышит» через signal-dot-pulse
  // (брендбук §11 L1 inline pulse). Унифицирует поведение с bd-team-mini
  // (см. blackDashboardRenderer.js:389) — там тот же класс.
  const pulseCls = state === 'pending' ? ' signal-dot-pulse' : '';
  return `<span class="signal-dot ${dotCls}${pulseCls}" aria-hidden="true"></span> ${_esc(msg)}`;
}

/**
 * Возвращает CSS-класс контейнера verify-result по состоянию.
 * Stripe-left + alpha-tint остаются прежними (см. styles.css P11.15).
 */
function _statusCls(state) {
  if (state === 'ok')  return 'int-verify-result int-verify-ok';
  if (state === 'err') return 'int-verify-result int-verify-err';
  return 'int-verify-result int-verify-pending';
}

/**
 * Превращает сообщение об ошибке (любой источник: throw, fetch, verify-API,
 * postServerConfig) в человеческий язык. Никаких «HTTP 401» в UI/toast'ах.
 *
 * @param {{error?: string, status?: number}|string|Error} src
 * @returns {string}
 */
function _humanHttp(src, service) {
  if (!src) return 'связь прервана';
  // Унифицируем вход в строку + статус-число.
  let text = '';
  let status = 0;
  if (typeof src === 'string')               text = src;
  else if (src instanceof Error)             text = src.message || '';
  else if (typeof src === 'object') {
    text = src.error || src.message || '';
    if (typeof src.status === 'number')      status = src.status;
  }
  // Извлечь HTTP-код из текста, если ещё не задан.
  if (!status) {
    const m = /HTTP\s*(\d{3})/i.exec(text);
    if (m) status = parseInt(m[1], 10);
  }
  // AUDIT-COPY #35 — антропоморф для всех сервисов, не только Jira.
  // service: 'Jira' | 'Bitbucket' | 'Confluence' | 'Sigma' (по умолчанию Jira).
  const svc = (service && typeof service === 'string') ? service : 'Jira';
  switch (status) {
    case 401: return `${svc} не пускает (нужен новый токен)`;
    case 403: return `${svc} закрыла доступ`;
    case 404: return `${svc} не нашла адрес`;
    case 429: return `${svc} просит притормозить`;
    case 500: case 502: case 503: case 504: return `${svc} не отвечает`;
  }
  // Сетевые / generic — без HTTP-кода. Скрываем «сеть» как технарь-слово.
  if (!text || /^сеть$/i.test(text)) return 'связь прервана';
  return text;
}

/* ── Phase 3 G1 — Per-subtab state preservation ─────────────
   Между переключениями Сканнер ↔ Чёрный дашборд сохраняем:
   · window.scrollY страницы
   · search-input value
   · открытые <details> по data-key
   На re-render восстанавливаем через queueMicrotask (DOM уже на месте).
   Лежит на module-level (Map не меняет identity между render'ами).
   ────────────────────────────────────────────────────────── */
const _subtabStateCache = new Map();
function _captureSubtabState(tab) {
  if (!tab) return;
  const root = document.getElementById('section-integrations');
  if (!root) return;
  const expanded = [];
  root.querySelectorAll('details[open]').forEach(d => {
    const k = d.dataset?.key || d.id;
    if (k) expanded.push(k);
  });
  _subtabStateCache.set(tab, {
    scrollY: window.scrollY || 0,
    query:   root.querySelector('.ts2-search-input')?.value || '',
    expanded,
  });
}
function _restoreSubtabState(tab) {
  if (!tab) return;
  const restore = _subtabStateCache.get(tab);
  if (!restore) return;
  // queueMicrotask — даём render() закончить innerHTML+wire, и только потом
  // трогаем DOM, иначе nodes ещё не существуют.
  queueMicrotask(() => {
    try {
      if (Number.isFinite(restore.scrollY)) window.scrollTo(0, restore.scrollY);
      const root = document.getElementById('section-integrations');
      if (!root) return;
      const q = root.querySelector('.ts2-search-input');
      if (q && restore.query) {
        q.value = restore.query;
        q.dispatchEvent(new Event('input', { bubbles: true }));
      }
      restore.expanded?.forEach(k => {
        const el = root.querySelector(`details[data-key="${CSS.escape(k)}"]`)
                || root.querySelector(`#${CSS.escape(k)}`);
        if (el && el.tagName === 'DETAILS') el.open = true;
      });
    } catch (_) { /* defensive — best-effort restore */ }
  });
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
        window.showToast?.('Настройки Jira сохранены', 'success');
        window.HistoryLog?.settings?.('jira_save', `Jira настройки сохранены (${url||'без endpoint'})`);
        close();
      } else {
        // P11.15 ToV — без HTTP-кодов в toast'е.
        window.showToast?.(`Не сохранено · Jira: ${_humanHttp(r, 'Jira')}`, 'error', 4000);
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
    res_el.className = _statusCls('pending');
    res_el.innerHTML = _statusBadge('pending', 'Проверяем…');
    // V17.2 I3 — request-id guard: rapid clicks no longer overwrite each other.
    const myId = nextReqId('jira');
    const r = await verifyJira();
    if (!isLatestReq('jira', myId)) return;
    if (r.ok) {
      res_el.className = _statusCls('ok');
      res_el.innerHTML = _statusBadge('ok', `Подключено (${r.who})`);
    } else {
      res_el.className = _statusCls('err');
      res_el.innerHTML = _statusBadge('err', _humanHttp(r, 'Jira'));
    }
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
        try { Services.BlackDashboard?.invalidate?.(); } catch(_) {}
        window.showToast?.('Настройки Sigma Jira сохранены', 'success');
        window.HistoryLog?.settings?.('sigma_jira_save', `Sigma Jira сохранены (${url||'без endpoint'})`);
        close();
      } else {
        window.showToast?.(`Не сохранено · Sigma: ${_humanHttp(r, 'Sigma')}`, 'error', 4000);
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
    res_el.className = _statusCls('pending');
    res_el.innerHTML = _statusBadge('pending', 'Проверяем…');
    const myId = nextReqId('sigma');
    try {
      const resp = await fetch('/api/integrations/sigma-verify', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' });
      const data = await resp.json().catch(() => ({}));
      if (!isLatestReq('sigma', myId)) return;
      if (resp.ok && data.ok) {
        res_el.className = _statusCls('ok');
        res_el.innerHTML = _statusBadge('ok', `Подключено (${data.who || 'OK'})`);
      } else {
        res_el.className = _statusCls('err');
        res_el.innerHTML = _statusBadge('err', _humanHttp({ error: data.error, status: resp.status }, 'Sigma'));
      }
    } catch (e) {
      if (!isLatestReq('sigma', myId)) return;
      res_el.className = _statusCls('err');
      res_el.innerHTML = _statusBadge('err', _humanHttp(e, 'Sigma'));
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
        window.showToast?.('Настройки Bitbucket сохранены', 'success');
        window.HistoryLog?.settings?.('bitbucket_save', `Bitbucket настройки сохранены (${url||'без endpoint'})`);
        close();
      } else {
        window.showToast?.(`Не сохранено · Bitbucket: ${_humanHttp(r, 'Bitbucket')}`, 'error', 4000);
      }
    } finally {
      btn.disabled = false;
    }
  });

  // V22 P-allowlist — «Добавить выбранные» в дополнительные BB-проекты.
  // Не сохраняет сразу — обновляет input #int-bb-project-keys, чтобы
  // пользователь увидел итоговую строку и нажал «Сохранить» (явный
  // commit-flow + одна точка persist'а).
  modal.querySelector('#int-bb-allowlist-add')?.addEventListener('click', () => {
    const checks = modal.querySelectorAll('.int-bb-allowlist-checkbox:checked');
    const status = modal.querySelector('#int-bb-allowlist-status');
    if (!checks.length) {
      if (status) status.textContent = 'Ничего не выбрано';
      return;
    }
    const input = modal.querySelector('#int-bb-project-keys');
    if (!input) return;
    const cur = String(input.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const have = new Set(cur.map(s => s.toLowerCase()));
    const added = [];
    checks.forEach(ch => {
      const v = String(ch.value || '').trim();
      if (!v) return;
      if (have.has(v.toLowerCase())) return;
      cur.push(v);
      have.add(v.toLowerCase());
      added.push(v);
      // Скрываем chip визуально — он уже в input'е.
      ch.closest('.int-bb-allowlist-chip')?.classList.add('hidden');
      ch.checked = false;
    });
    input.value = cur.join(', ');
    if (status) {
      status.textContent = added.length
        ? `Добавлено в поле: ${added.join(', ')}. Нажмите «Сохранить» и затем рефреш Сканнера.`
        : 'Все выбранные уже в списке';
    }
    window.showToast?.(
      added.length
        ? `Allowlist расширен: ${added.join(', ')}. Нажмите «Сохранить» и затем рефреш Сканнера.`
        : 'Все выбранные уже в списке',
      added.length ? 'success' : 'info',
      4000,
    );
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
    res_el.className = _statusCls('pending');
    res_el.innerHTML = _statusBadge('pending', 'Проверяем…');
    const myId = nextReqId('bitbucket');
    const r = await verifyBitbucket();
    if (!isLatestReq('bitbucket', myId)) return;
    if (r.ok) {
      res_el.className = _statusCls('ok');
      res_el.innerHTML = _statusBadge('ok', `Подключено (${r.who || 'OK'})`);
    } else {
      res_el.className = _statusCls('err');
      res_el.innerHTML = _statusBadge('err', _humanHttp(r, 'Bitbucket'));
    }
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
        window.showToast?.('Настройки Confluence сохранены', 'success');
        window.HistoryLog?.settings?.('confluence_save', `Confluence настройки сохранены (${url||'без endpoint'}, ${spaceKeys ? 'spaces=' + spaceKeys : 'все пространства'}, окно ${winHours}ч)`);
        close();
      } else {
        window.showToast?.(`Не сохранено · Confluence: ${_humanHttp(r, 'Confluence')}`, 'error', 4000);
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
    res_el.className = _statusCls('pending');
    res_el.innerHTML = _statusBadge('pending', 'Проверяем…');
    const myId = nextReqId('confluence');
    const r = await verifyConfluence();
    if (!isLatestReq('confluence', myId)) return;
    if (r.ok) {
      res_el.className = _statusCls('ok');
      res_el.innerHTML = _statusBadge('ok', `Подключено (${r.who || 'OK'})`);
    } else {
      res_el.className = _statusCls('err');
      res_el.innerHTML = _statusBadge('err', _humanHttp(r, 'Confluence'));
    }
  });

  // V17.2 I2c (G7) — Audit log probe.
  modal.querySelector('#int-cf-audit-probe')?.addEventListener('click', async () => {
    const res_el = modal.querySelector('#int-cf-verify-result');
    res_el?.classList.remove('hidden');
    res_el.className = _statusCls('pending');
    res_el.innerHTML = _statusBadge('pending', 'Запрашиваем аудит-лог…');
    try {
      const resp = await fetch('/api/integrations/confluence-audit-logins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await resp.json().catch(() => ({}));
      if (!data.ok) {
        res_el.className = _statusCls('err');
        res_el.innerHTML = _statusBadge('err', `Аудит: ${_humanHttp({ error: data.error, status: resp.status })}`);
        return;
      }
      const users = Array.isArray(data.users) ? data.users : [];
      const top = users.slice(0, 5).map(u => `${u.displayName || u.username || '?'} (${u.loginCount})`).join(', ');
      res_el.className = _statusCls('ok');
      // mono-tabular numerals для счётчиков (P11.15) — оборачиваем числа в <span class="num-tnum">.
      const meta = `Аудит за <span class="num-tnum">${data.windowHours}</span>ч: <span class="num-tnum">${users.length}</span> пользователей, <span class="num-tnum">${data.loginRecords}</span> событий${top ? ' · топ: ' + _esc(top) : ''}`;
      res_el.innerHTML = `<span class="signal-dot signal-on-course" aria-hidden="true"></span> ${meta}`;
    } catch (e) {
      res_el.className = _statusCls('err');
      res_el.innerHTML = _statusBadge('err', _humanHttp(e));
    }
  });

  // ── V21 Jenkins ────────────────────────────────────────────
  modal.querySelector('#int-jenkins-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const url    = modal.querySelector('#int-jenkins-url')?.value?.trim() || '';
      const tok    = modal.querySelector('#int-jenkins-token')?.value?.trim();
      const folder = modal.querySelector('#int-jenkins-folder')?.value?.trim() || '';
      const patch = {
        jenkinsFolder: folder,
        allowInsecureTls: getTls(), sinceDate: getSince(),
      };
      if (url) patch.jenkinsBaseUrl = url;
      if (tok) patch.jenkinsToken   = tok;
      saveSettings(patch);
      const serverPatch = {
        jenkinsFolder: folder,
        allowInsecureTls: patch.allowInsecureTls, sinceDate: patch.sinceDate,
      };
      if (url) serverPatch.jenkinsBaseUrl = url;
      if (tok) serverPatch.jenkinsToken   = tok;
      const r = await postServerConfig(serverPatch);
      if (r.ok) {
        window.showToast?.('Курс сверен · Jenkins', 'success');
        window.HistoryLog?.settings?.('jenkins_save', `Jenkins настройки сохранены (${url||'без endpoint'}, folder=${folder||'(root)'})`);
        close();
      } else {
        window.showToast?.(`Курс не сверен · Jenkins: ${_humanHttp(r)}`, 'error', 4000);
      }
    } finally {
      btn.disabled = false;
    }
  });

  modal.querySelector('#int-jenkins-verify')?.addEventListener('click', async () => {
    const url    = modal.querySelector('#int-jenkins-url')?.value?.trim() || '';
    const tok    = modal.querySelector('#int-jenkins-token')?.value?.trim();
    const folder = modal.querySelector('#int-jenkins-folder')?.value?.trim() || '';
    const insecure = getTls();
    const serverPatch = { allowInsecureTls: insecure, jenkinsFolder: folder };
    if (url) serverPatch.jenkinsBaseUrl = url;
    if (tok) serverPatch.jenkinsToken   = tok;
    await postServerConfig(serverPatch);
    saveSettings({ allowInsecureTls: insecure, jenkinsFolder: folder, ...(url ? { jenkinsBaseUrl: url } : {}), ...(tok ? { jenkinsToken: tok } : {}) });
    const res_el = modal.querySelector('#int-jenkins-verify-result');
    res_el?.classList.remove('hidden');
    res_el.className = _statusCls('pending');
    res_el.innerHTML = _statusBadge('pending', 'Проверяем…');
    const myId = nextReqId('jenkins');
    try {
      const resp = await fetch('/api/integrations/jenkins-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await resp.json().catch(() => ({}));
      if (!isLatestReq('jenkins', myId)) return;
      if (data.ok) {
        res_el.className = _statusCls('ok');
        const samples = Array.isArray(data.cultritsSample) && data.cultritsSample.length
          ? ` · culprits sample: <code>${data.cultritsSample.slice(0, 5).map(x => _esc(x)).join(', ')}</code>`
          : '';
        const reachedNote = data.reachedJenkins ? ' · X-Jenkins получен ✓' : '';
        res_el.innerHTML = `<span class="signal-dot signal-on-course" aria-hidden="true"></span> Подключено${data.who ? ` (<strong>${_esc(data.who)}</strong>)` : ''} · jobs: <span class="num-tnum">${data.jobsCount || 0}</span>${reachedNote}${samples}`;
      } else {
        res_el.className = _statusCls('err');
        // V21 расширенная диагностика — показываем причину + suggestion от probe v2.
        const lines = [];
        const errLine = data.error || _humanHttp({ status: resp.status });
        lines.push(`<strong>${_esc(errLine)}</strong>`);
        if (data.diagnosis) lines.push(`<div style="margin-top:6px"><em>Причина:</em> ${_esc(data.diagnosis)}</div>`);
        if (data.suggestion) lines.push(`<div style="margin-top:4px"><em>Что попробовать:</em> ${_esc(data.suggestion)}</div>`);
        // Quick visual indicators.
        const indicators = [];
        if (data.reachedJenkins) indicators.push('✓ Дошли до Jenkins (X-Jenkins header)');
        else                     indicators.push('✗ Не дошли до Jenkins (нет X-Jenkins header)');
        if (data.ssoDetected)    indicators.push('⚠ SSO/прокси перехват');
        if (data.proxyDetected)  indicators.push('⚠ SiteMinder/SMSESSION cookie');
        if (data.authScheme)     indicators.push(`auth: ${data.authScheme}`);
        lines.push(`<div style="margin-top:6px;font-size:11px;color:var(--text-3)">${indicators.join(' · ')}</div>`);
        res_el.innerHTML = `<span class="signal-dot signal-off-course" aria-hidden="true"></span> ${lines.join('')}`;
      }
    } catch (e) {
      if (!isLatestReq('jenkins', myId)) return;
      res_el.className = _statusCls('err');
      res_el.innerHTML = _statusBadge('err', _humanHttp(e));
    }
  });

  // ── P11.15: token-input show/hide toggle ───────────────────
  // Renderer уже задаёт type="password" для всех 4 token-полей
  // (#int-jira-token / #int-sigma-token / #int-bb-token / #int-cf-token).
  // Здесь добавляем рядом с каждым полем «глаз» toggle. Кнопка
  // динамическая — не ломает HTML-разметку renderer'а.
  const _tokenIds = ['int-jira-token', 'int-sigma-token', 'int-bb-token', 'int-cf-token', 'int-jenkins-token'];
  for (const id of _tokenIds) {
    const inp = modal.querySelector('#' + id);
    if (!inp || inp.dataset.p1115Toggle === '1') continue;
    // Защита: не вешаем дважды.
    inp.dataset.p1115Toggle = '1';
    // Оборачиваем в .intg-token-wrap, чтобы кнопка визуально лежала рядом.
    const wrap = document.createElement('span');
    wrap.className = 'intg-token-wrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'intg-token-toggle';
    btn.setAttribute('aria-label', 'Показать токен');
    btn.setAttribute('title', 'Показать / скрыть токен');
    btn.innerHTML = Icons.get('eye', { size: 14 });
    wrap.appendChild(btn);
    btn.addEventListener('click', () => {
      const showing = inp.type === 'text';
      inp.type = showing ? 'password' : 'text';
      btn.innerHTML = Icons.get(showing ? 'eye' : 'eye-off', { size: 14 });
      btn.setAttribute('aria-label', showing ? 'Показать токен' : 'Скрыть токен');
    });
  }

  // ── P11.15: collapse-сегменты для интеграций ──────────────
  // Каждая `.int-stab-panel` (Jira-Delta / Sigma / BB / Confluence)
  // оборачивается в `<details class="intg-section" open>` с `<summary>`
  // подзаголовком — длинная портянка теперь сворачиваемая, активная
  // вкладка остаётся `open` (default).
  const _panelTitles = {
    'jira-delta': 'Jira Delta',
    'jira-sigma': 'Jira Sigma',
    'bitbucket':  'Bitbucket',
    'confluence': 'Confluence',
  };
  modal.querySelectorAll('.int-stab-panel').forEach(panel => {
    if (panel.dataset.p1115Collapsed === '1') return;
    panel.dataset.p1115Collapsed = '1';
    const key   = panel.getAttribute('data-panel') || '';
    const title = _panelTitles[key] || key || 'Интеграция';
    // Перемещаем существующий контент панели внутрь <details>.
    const det = document.createElement('details');
    det.className = 'intg-section';
    if (panel.classList.contains('active')) det.setAttribute('open', '');
    const sum = document.createElement('summary');
    sum.className = 'intg-section-summary';
    sum.textContent = title;
    det.appendChild(sum);
    while (panel.firstChild) det.appendChild(panel.firstChild);
    panel.appendChild(det);
  });
}

/**
 * V22 P-allowlist — extract unique BB project keys from Сканнер diagnostic
 * (bbDroppedSamples). Каждый sample имеет `repo` (typed `PROJECT/repo`) или
 * `project`. Извлекаем prefix до первого `/`. Возвращаем плоский массив
 * (могут быть duplicates — рендерер агрегирует counts).
 */
function _collectBbSuggestedProjects() {
  try {
    const samples = window.TeamScanner2?._lastRawDiag?.bbDroppedSamples;
    if (!Array.isArray(samples) || !samples.length) return [];
    const out = [];
    for (const it of samples) {
      const proj = String(it?.project || '').trim();
      if (proj) { out.push(proj); continue; }
      const repo = String(it?.repo || '').trim();
      if (!repo) continue;
      const slash = repo.indexOf('/');
      const key = slash > 0 ? repo.slice(0, slash) : repo;
      if (key) out.push(key);
    }
    return out;
  } catch (_) { return []; }
}

/* ── Open settings modal ──────────────────────────────────── */
function openSettingsModal(activeTab) {
  document.getElementById('int-settings-modal')?.remove();
  const settings = loadSettingsForUI();
  const html = renderSettingsModal(settings, {
    bbSuggestedProjects: _collectBbSuggestedProjects(),
  });
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

  _activeSubtab: 'scanner2',  // 'scanner2' | 'black'

  _scanner2Loaded: false,

  render() {
    const root = document.getElementById('section-integrations');
    if (!root) return;
    this._root = root;

    const subtabsHtml = `
      <div class="int-subtabs">
        <button class="int-subtab ${this._activeSubtab==='scanner2'?'int-subtab-active':''}" data-subtab="scanner2">Сканнер команд</button>
        <button class="int-subtab ${this._activeSubtab==='black'?'int-subtab-active':''}"    data-subtab="black"><span class="signal-dot signal-off-course" aria-hidden="true"></span> Чёрный дашборд</button>
        <button class="int-subtab ${this._activeSubtab==='release2'?'int-subtab-active':''}" data-subtab="release2">Release 2.0</button>
        <button class="int-subtab ${this._activeSubtab==='hygiene'?'int-subtab-active':''}"  data-subtab="hygiene">Гигиена</button>
      </div>`;

    let bodyHtml;
    if (this._activeSubtab === 'black') {
      bodyHtml = `<div id="bd-root" class="bd-root"></div>`;
    } else if (this._activeSubtab === 'release2') {
      // V22+ Phase 5 (Release 2.0 sub-tab) — list view с group-by + filters + lazy expand.
      bodyHtml = `<div id="r2-root" class="r2-mount"></div>`;
    } else if (this._activeSubtab === 'hygiene') {
      // V22+ Гигиена sub-tab (2026-05-17) — перенос из Scanner. 20 правил + team-switcher.
      bodyHtml = `<div id="hyg-root" class="hyg-mount"></div>`;
    } else {
      this._activeSubtab = 'scanner2';
      bodyHtml = `<div id="ts2-root" class="ts2-mount"></div>`;
    }

    // V21 π3 Ф1 — page-header (eyebrow + h1 + hairline) единым ритмом
    // как в остальных секциях. Subtabs остаются ниже header'а.
    // v22 — sub-text «Подключение Jira/Bitbucket/Confluence — где смотреть
    // курс команды» убран по запросу: дублировал контекст подвкладок.
    const headerHtml = renderPageHeader('integrations', {});
    root.innerHTML = `<div id="int-root" class="view-root">${headerHtml}${subtabsHtml}${bodyHtml}</div>`;

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
        // V22+ Hygiene sub-tab unmount: остановить scanner-poller и cleanup listener'ы.
        if (this._activeSubtab === 'hygiene' && next !== 'hygiene') {
          try {
            const HygieneView = window.HygieneView;
            HygieneView?.unmount?.();
          } catch (_) {}
        }
        // Phase 3 G1 — сохраняем scroll/search/expanded state перед switch'ем,
        // чтобы возврат на ту же вкладку восстанавливал «где я был».
        // Раньше root.innerHTML=... в render() терял всё. Не идеальное
        // решение (всё равно re-render), но scroll и expanded — на месте.
        try { _captureSubtabState(this._activeSubtab); } catch (_) {}
        this._activeSubtab = next;
        this.render();
        try { _restoreSubtabState(next); } catch (_) {}
      });
    });

    this._bindEvents(root);

    if (this._activeSubtab === 'black') {
      const bdRoot = document.getElementById('bd-root');
      if (bdRoot) BlackDashboard.render(bdRoot);
    } else if (this._activeSubtab === 'release2') {
      // V22+ Phase 5 — Release 2.0 sub-tab. Lazy-import чтобы не загружать
      // модуль если юзер никогда не откроет вкладку.
      const r2Root = document.getElementById('r2-root');
      if (r2Root) {
        import('../integrations/release2/release2.js')
          .then(m => m.Release2View.render(r2Root))
          .catch(e => {
            console.error('[Release2] failed to load:', e);
            r2Root.innerHTML = `<div class="r2-error">Не удалось загрузить модуль Release 2.0: ${(e?.message || e)}</div>`;
          });
      }
    } else if (this._activeSubtab === 'hygiene') {
      // V22+ (2026-05-17) — Гигиена sub-tab, перенос из Scanner.
      const hygRoot = document.getElementById('hyg-root');
      if (hygRoot) {
        import('../integrations/hygiene/hygiene.js')
          .then(m => m.HygieneView.render(hygRoot))
          .catch(e => {
            console.error('[Hygiene] failed to load:', e);
            hygRoot.innerHTML = `<div class="hyg-state hyg-state-empty">Не удалось загрузить модуль «Гигиена»: ${(e?.message || e)}</div>`;
          });
      }
    } else {
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
    }
  },

  refreshScanner2() {
    this._scanner2Loaded = true;
    if (this._activeSubtab === 'scanner2') {
      const ts2Root = document.getElementById('ts2-root');
      if (ts2Root) TeamScanner2.refresh();
    }
  },

  /* ── event delegation: только settings — остальные actions жили на overview-странице ── */
  _bindEvents(root) {
    root.addEventListener('click', e => {
      const el = e.target.closest('[data-int-action]');
      if (!el) return;
      if (el.dataset.intAction === 'settings') {
        openSettingsModal(el.dataset.tab || 'jira');
      }
    });
    // Phase 3 D3 (TODO carry-over) — share-link на удалённого сотрудника.
    // В `integrations/teamScanner2.js:914` _pendingShareKey мolчанiе
    // обрабатывается без feedback'а если participant не найден. Нужен toast
    // «Сотрудник по этой ссылке больше не работает в команде». Файл занят
    // Phase 4 — переносим вызов в Phase 4 / next pass:
    //   if (this._pendingShareKey && !exists) {
    //     window.showToast?.('Сотрудник по этой ссылке больше не работает в команде', 'warn', 4000);
    //   }

    // Phase 3 C2 — sub-tab «Сегодня» / «Глубже» внутри Сканнера команд.
    // Switch обновляет module-level state в renderer'е и триггерит TeamScanner2.refresh()
    // (мягкий re-render без fetch'а). При смене команды state сбрасывается на 'today'.
    root.addEventListener('click', e => {
      // Only match actual tab-bar buttons (tagName=BUTTON). The content pane
      // wrapper divs also carry data-scanner-tab for historical reasons; matching
      // them caused every <details> click inside «Глубже» to trigger a full
      // paint() rewrite — closing all expanded tiles.
      const btn = e.target.closest('button[data-scanner-tab]');
      if (!btn) return;
      e.stopPropagation();
      const requested = btn.dataset.scannerTab;
      // 2026-05-11 — V23: добавлен `hygiene` tab (Jira Hygiene Engine).
      const next = (requested === 'deeper' || requested === 'metrics' || requested === 'hygiene') ? requested : 'today';
      try { _setScannerTab(next); } catch (_) {}
      try {
        // Не делаем fetch — просто перерисовка. paint() — публичный repaint API
        // у TeamScanner2 (см. teamScanner2.js:255). Если нет — fallback на
        // приватный _renderFull (старая сигнатура).
        if (typeof TeamScanner2.paint === 'function') TeamScanner2.paint();
        else if (typeof TeamScanner2._renderFull === 'function') TeamScanner2._renderFull();
      } catch (_) { /* defensive — re-render не должен ломать клик */ }
    });
    root.addEventListener('click', e => {
      // Сброс sub-tab на 'today' при смене команды (см. C2 spec).
      if (e.target.closest('[data-switch-team]')) {
        try { _resetScannerTab(); } catch (_) {}
      }
    }, true);
    // V21 — Align жест на content-зоне при смене team-tab.
    // Раньше было spring 1600ms с visible scale-out → пользователь
    // воспринимал как «экран отдаляется и встаёт». Теперь — короткий
    // opacity-fade 320ms (см. styles.css `.ts2-content-root.is-aligning`).
    root.addEventListener('click', e => {
      const tab = e.target.closest('[data-switch-team]');
      if (!tab) return;
      try {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const target = root.querySelector('.ts2-mount')
                    || root.querySelector('.ts2-content-root')
                    || root.querySelector('#ts2-root');
        if (!target) return;
        target.classList.remove('is-aligning');
        // eslint-disable-next-line no-unused-expressions
        target.offsetHeight;
        target.classList.add('is-aligning');
        setTimeout(() => target.classList.remove('is-aligning'), 320);
      } catch (_) { /* defensive — анимация не должна ломать switch */ }
    }, true);
  },
};

/* ── Expose settings modal globally ────────────────────────
   So the topbar "Интеграции" button can open it without
   requiring a full view render. ─────────────────────────── */
export function openIntegrationsSettings(tab) {
  openSettingsModal(tab || 'jira');
}

/* Expose helpers so AppSettings can render the form inline inside the unified Settings modal */
Services.register('IntegrationsLoadSettings', loadSettingsForUI);
Services.register('IntegrationsRenderModal',  renderSettingsModal);
Services.register('IntegrationsBindModal',    bindSettingsModal);
if (typeof window !== 'undefined') {
  // Use loadSettingsForUI so password inputs pre-populate (user doesn't have to retype tokens)
  window.IntegrationsLoadSettings = loadSettingsForUI;
  window.IntegrationsRenderModal  = renderSettingsModal;
  window.IntegrationsBindModal    = bindSettingsModal;
}
