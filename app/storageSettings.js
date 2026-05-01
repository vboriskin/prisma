'use strict';
/* ============================================================
   app/storageSettings.js — V13 (extracted from app.js, audit #18).

   StorageSettings UI: lets the user pick the data-storage backend
   (localStorage / SQLite), run migration, view DB size, clear local data.
   Mounts into #app-settings-storage-host (in the unified Settings modal).

   Why a deps object instead of imports? Same DI pattern as
   `app/init.js` — the orchestrator object lives in `app.js`-land but
   the UI helpers don't need module imports of `Storage` / `state` /
   `notify`. Caller passes the references in.

   Public surface:
     · render(host, deps)      — paint into host element
     · _wire(host, deps)       — bind events (called from render)
     · _formatBytes(n)         — utility (also used by call sites)
   ============================================================ */

import { Utils } from '../utils.js';

export const StorageSettings = {
  _formatBytes(n) {
    if (!n) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024*1024) return `${(n/1024).toFixed(1)} KB`;
    return `${(n/1024/1024).toFixed(2)} MB`;
  },

  /**
   * @param {HTMLElement} host
   * @param {object} deps
   * @param {object} deps.AppDataStore
   * @param {object} deps.Storage          - dataStore.Storage
   * @param {object} deps.state
   * @param {object} deps.HistoryLog
   * @param {Function} deps.notify         - state.notify
   */
  render(host, deps) {
    if (!host) return;
    const { AppDataStore } = deps;
    const st = AppDataStore.status();
    const sqliteOn  = st.mode === 'sqlite';
    const sqliteOk  = st.sqliteReady;
    const sqliteErrRaw = (window.SQLiteStore && window.SQLiteStore.lastError && window.SQLiteStore.lastError()) || '';
    const sqliteErr = Utils.escapeHtml(String(sqliteErrRaw));
    let sqliteStatusLabel;
    if (sqliteOk)              sqliteStatusLabel = '✓ загружен';
    else if (sqliteOn && sqliteErrRaw) sqliteStatusLabel = '✗ ошибка загрузки';
    else if (sqliteOn)         sqliteStatusLabel = '⏳ инициализация…';
    else                       sqliteStatusLabel = '— не используется';
    host.innerHTML = `
      <div class="app-storage-row">
        <label class="app-storage-radio">
          <input type="radio" name="app-storage-mode" value="localStorage" ${!sqliteOn ? 'checked' : ''}>
          <div>
            <div class="app-storage-radio-title">localStorage <span class="app-storage-pill">по умолчанию</span></div>
            <div class="app-storage-radio-sub">Быстро, надёжно, лимит ~5 MB. Текущий рабочий вариант.</div>
          </div>
        </label>
        <label class="app-storage-radio">
          <input type="radio" name="app-storage-mode" value="sqlite" ${sqliteOn ? 'checked' : ''}>
          <div>
            <div class="app-storage-radio-title">SQLite (sql.js / WASM) <span class="app-storage-pill app-storage-pill-exp">эксперимент</span></div>
            <div class="app-storage-radio-sub">База в браузере, дамп в IndexedDB. SQL-запросы, отдельные таблицы для комментов / change-log / интеграций.</div>
          </div>
        </label>
      </div>

      <div class="app-storage-status" id="app-storage-status">
        <span><b>Режим:</b> ${st.mode}</span>
        <span><b>SQLite:</b> ${sqliteStatusLabel}</span>
        <span><b>Размер БД:</b> ${StorageSettings._formatBytes(st.dumpSize)}</span>
        <span><b>Миграция:</b> ${st.migrated ? '✓ выполнена' : '— не выполнена'}</span>
      </div>
      ${(sqliteOn && !sqliteOk && sqliteErrRaw) ? `
        <div class="app-storage-error" style="margin:8px 0;padding:10px 12px;border-radius:8px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);font-size:12.5px;line-height:1.5;color:#b91c1c">
          <b>Не удалось загрузить sql.js.</b> ${sqliteErr}<br>
          <span style="opacity:.85">Положите файлы <code>libs/sql-wasm.js</code> и <code>libs/sql-wasm.wasm</code> в проект, либо проверьте доступ к <code>cdn.jsdelivr.net</code>.</span>
          <button class="btn btn-ghost btn-xs" id="app-storage-retry-init" style="margin-left:6px">↻ Повторить</button>
        </div>` : ''}

      <div class="app-storage-actions">
        <button class="btn btn-outline btn-sm" id="app-storage-migrate" ${!sqliteOk ? 'disabled' : ''} title="${!sqliteOk ? 'SQLite ещё не загружен' : 'Перенести строки из localStorage в SQLite'}">↻ Перенести данные из localStorage</button>
        <button class="btn btn-outline btn-sm" id="app-storage-export"  ${!sqliteOk ? 'disabled' : ''}>⤓ Скачать .sqlite</button>
        <label class="btn btn-outline btn-sm" ${!sqliteOk ? 'style="opacity:.45;pointer-events:none"' : ''}>
          ⤒ Загрузить .sqlite
          <input type="file" id="app-storage-import" accept=".sqlite,.db,application/octet-stream" hidden>
        </label>
        <button class="btn btn-ghost btn-sm" id="app-storage-clear" ${!sqliteOk ? 'disabled' : ''}>🗑 Очистить SQLite</button>
      </div>

      <div class="app-storage-section-divider"></div>

      <div class="app-storage-row" style="margin-top:8px">
        <div class="app-storage-info">
          <div class="app-storage-info-title">Экран приветствия</div>
          <div class="app-storage-info-sub">Сбросить флаг «уже видел приветствие» — splash «Привет 👋» снова появится при следующей загрузке.</div>
        </div>
        <button class="btn btn-outline btn-sm" id="app-storage-reset-welcome">🔄 Сбросить экран приветствия</button>
      </div>
    `;
    StorageSettings._wire(host, deps);
  },

  _wire(host, deps) {
    const { AppDataStore, Storage, state, HistoryLog, notify } = deps;
    const re = host.querySelector('#app-storage-migrate');
    host.querySelectorAll('input[name="app-storage-mode"]').forEach(r => {
      r.addEventListener('change', async () => {
        AppDataStore.setMode(r.value);
        if (r.value === 'sqlite') {
          await AppDataStore.init();
        }
        StorageSettings.render(host, deps); // re-render with new status
        const ok = (r.value !== 'sqlite') || AppDataStore.status().sqliteReady;
        if (ok) window.showToast?.(`Хранилище: ${r.value}`);
        else    window.showToast?.('SQLite не загрузился — режим выбран, но фактически работает localStorage', 'error', 4500);
        try { HistoryLog.settings('storage_mode', `Хранилище: ${r.value}`); } catch(_) {}
      });
    });
    host.querySelector('#app-storage-retry-init')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = '⏳ Загружаю…';
      const ok = await window.SQLiteStore?.init?.();
      if (ok) window.showToast?.('SQLite загружен');
      else    window.showToast?.('Снова не получилось: ' + (window.SQLiteStore?.lastError?.() || 'unknown'), 'error', 4500);
      StorageSettings.render(host, deps);
    });
    re?.addEventListener('click', async () => {
      re.disabled = true; re.textContent = '⏳ Перенос…';
      const res = await AppDataStore.migrateFromLocalStorage();
      if (res.ok) {
        window.showToast?.(`Перенесено ${res.rowsCount} строк в SQLite`);
        try { HistoryLog.settings('storage_migrate', `Migration: ${res.rowsCount} rows → SQLite`); } catch(_) {}
      } else {
        window.showToast?.('Не удалось мигрировать: ' + (res.error || 'unknown'), 'error', 3500);
      }
      StorageSettings.render(host, deps);
    });
    host.querySelector('#app-storage-export')?.addEventListener('click', async () => {
      try {
        await AppDataStore.persist();
        const bytes = window.SQLiteStore?.exportDump?.();
        if (!bytes) { window.showToast?.('БД пустая', 'info'); return; }
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `q2_data_${new Date().toISOString().slice(0,10)}.sqlite`; a.click();
        URL.revokeObjectURL(url);
      } catch(e) { window.showToast?.('Экспорт не удался: ' + e.message, 'error'); }
    });
    host.querySelector('#app-storage-import')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      try {
        const buf = await f.arrayBuffer();
        if (!window.SQLiteStore) throw new Error('SQLite не загружен');
        if (!window.SQLiteStore.isReady()) await window.SQLiteStore.init();
        window.SQLiteStore.importDump(new Uint8Array(buf));
        // Pull rows into state.rows so UI sees them
        try { state.rows = window.SQLiteStore.getRows(); } catch(_) {}
        Storage.save();
        notify('storage-import');
        window.showToast?.(`Импортирована БД: ${StorageSettings._formatBytes(buf.byteLength)}`);
        StorageSettings.render(host, deps);
      } catch(err) { window.showToast?.('Импорт не удался: ' + err.message, 'error'); }
      e.target.value = '';
    });
    host.querySelector('#app-storage-clear')?.addEventListener('click', async () => {
      if (!confirm('Удалить все данные в SQLite? localStorage НЕ затрагивается.')) return;
      try { window.SQLiteStore?.clearAll(); await window.SQLiteStore?.clearPersistence(); }
      catch(_) {}
      window.showToast?.('SQLite очищен');
      StorageSettings.render(host, deps);
    });
    host.querySelector('#app-storage-reset-welcome')?.addEventListener('click', () => {
      try { localStorage.removeItem('welcomeShown'); } catch(_) {}
      // Also reset the V11 onboarding flag so the demo/setup welcome reopens too,
      // giving the user a clean first-run experience next time.
      try { localStorage.removeItem('q2_onboarding_v1'); } catch(_) {}
      window.showToast?.('Экран приветствия сброшен — появится при следующей загрузке', 'success', 3500);
      try { HistoryLog.settings('welcome_reset', 'Сброшен флаг welcomeShown'); } catch(_) {}
    });
  },
};
