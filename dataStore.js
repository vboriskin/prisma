'use strict';
/* ============================================================
   DATA STORE — v8_0 ES module
   ============================================================ */

import { state, notify, syncColumnSettings, getAllCols } from './state.js';
import { RowFactory, EmployeeFactory } from './rowFactory.js';
import { RiskEngine } from './riskEngine.js';
import { FilterEngine } from './filters.js';
import { Utils, nextId } from './utils.js';
import { STORAGE_KEY, STORAGE_KEYS, SETTINGS_KEY, SETTINGS_KEYS } from './constants.js';
import { Reactive } from './reactiveStore.js';
// V22 (AUDIT_HOLISTIC паттерн 17 / Идея 15) — cross-tab notify после save.
// `notifyChange` no-op до `CrossTabSync.init()` (вызывается из app.js на
// DOMContentLoaded), поэтому импорт безопасен и не создаёт side-effects.
import { CrossTabSync } from './app/crossTabSync.js';
import { Services } from './app/services.js';

// ============================================================
// LOCAL STORAGE
// ============================================================

/**
 * V18 O2 (AUDIT_HOLISTIC O2) — `Storage` участвует в семействе backend'ов
 * `app/storage/StorageRouter.js`. Контракт `Storage.save() / load() / clear()`
 * предоставляет localStorage-канал; обёртка `localBackend` в StorageRouter
 * нормализует API под `StorageInterface` (см. app/storage/StorageInterface.js).
 *
 * НЕ менять сигнатуру `Storage.save()` — это публичный контракт V15+,
 * вызывается из 100+ мест.
 *
 * V15 (audit #1, system analyst Critical 1 + fullstack Medium 3) — single
 * source of truth for the SETTINGS_KEY payload shape. Both `Storage.save()`
 * (debounced) and `Storage.flushNow()` (synchronous) MUST use this exact
 * shape. Before the V15 audit, save() was missing `planLocked` /
 * `ganttEditMode`, so the entire V14 plan-lock feature failed to persist
 * across F5. Adding new persisted state in the future = add the field
 * here once, both save paths pick it up automatically.
 */
function _buildSettingsPayload() {
  return {
    colOrder:         state.colOrder,
    colWidths:        state.colWidths,
    colVisibility:    state.colVisibility,
    sidebarCollapsed: state.sidebarCollapsed,
    pinnedCols:       state.pinnedCols,
    rowHeight:        state.rowHeight,
    colLabels:        state.colLabels,
    customCols:       state.customCols,
    colTypes:         state.colTypes,
    epicDeps:         state.epicDeps,
    ganttMode:        state.ganttMode,
    ganttEpicsWell:   state.ganttEpicsWell,
    podlozhkaMode:    state.podlozhkaMode,
    // V21 W (AUDIT_HOLISTIC O3) — summaryMode dropped: см. state.js + app/migrations.js
    presetsCollapsed: state.presetsCollapsed,
    theme:            state.theme,
    // V14: gantt2* retired (B2 in V14 changelog)
    // V14 (B3+B4) — plan-lock state. Audit #1 (system analyst C1) caught
    // that omitting these from save() left them un-persisted across F5.
    planLocked:       state.planLocked,
    ganttEditMode:    state.ganttEditMode,
    // AUDIT_HOLISTIC F4 — единый центр уведомлений (app/notifyCenter.js).
    // Persistent FIFO 100, чистится по age 30d при добавлении.
    notifications:    Array.isArray(state.notifications) ? state.notifications : [],
    // AUDIT_HOLISTIC P3 + Идея 1 — `state.meta` (user / permissions /
    // featureFlags / version / lastSeenVersion / lastActiveAt / focus).
    // См. state.js + app/migrations.js (q2_settings_v3 2→3).
    meta:             state.meta,
    // #1 — пользовательские релизы (CRUD через Настройки) + локальный «глаз»
    // в Гант (state.ganttHiddenReleases). Legacy 5 релизов (r120/r121/r122/
    // overtime/backlog) не редактируются — они в constants.LEGACY_RELEASE_LIST.
    releases:            Array.isArray(state.releases) ? state.releases : [],
    ganttHiddenReleases: Array.isArray(state.ganttHiddenReleases) ? state.ganttHiddenReleases : [],
    // V21 W — settings payload version.
    // 0→1: drop summaryMode. 1→2: notifications. 2→3: meta. 3→4: releases + ganttHiddenReleases + filters.release массив.
    version:          4,
  };
}

// V21 Q (audit-2026-05-03 §H Top-15 #14) — dirty-indicator. Topbar Save
// button показывает dot пока Storage._t (debounce timer) активен → юзер
// видит «сохранение pending» вместо догадок. На flushNow / setTimeout
// finally — гасим.
function _setDirtyDot(visible) {
  if (typeof document === 'undefined') return;
  const dot = document.getElementById('btn-save-dirty-dot');
  if (!dot) return;
  dot.classList.toggle('hidden', !visible);
}

export const Storage = {
  _t: null,
  save() {
    clearTimeout(Storage._t);
    // Bumping the data-version is internal book-keeping; don't let it
    // re-trigger the reactive flush we're already inside.
    Reactive.silent(() => { state._dataVersion++; });
    _setDirtyDot(true);
    Storage._t=setTimeout(()=>{
      // CRITICAL: the entire body MUST run inside Reactive.silent. Without this,
      // `syncColumnSettings()` rewrites `state.colOrder/colWidths/colVisibility/…`
      // with newly-allocated arrays/objects, which triggers the reactive proxy →
      // dirty flag → 100 ms later auto-flush calls Storage.save → setTimeout
      // fires → infinite loop. The save body is internal bookkeeping, never
      // user-driven mutation; no subscriber should ever observe it.
      Reactive.silent(() => {
        syncColumnSettings();
        try {
          localStorage.setItem(STORAGE_KEY,JSON.stringify({rows:state.rows,employees:state.employees,savedAt:new Date().toISOString(),version:3}));
        } catch(e){
          if (e && e.name === 'QuotaExceededError') window.showToast?.('Память браузера заполнена — экспортируйте данные в CSV', 'error', 4200);
        }
        // V11: also mirror rows into SQLite when the user enabled that mode.
        // SQLite path is async / debounced internally; we just hand off and forget.
        try {
          if (Services.AppDataStore && Services.AppDataStore.mode === 'sqlite') {
            Services.AppDataStore.saveRows(state.rows);
          }
        } catch(_) { /* never let storage mirror break the app */ }
        // F11 fix (codebase-01 audit) — settings setItem отдельно через
        // requestIdleCallback. Это не критичные данные (col-order, theme),
        // их потеря на F5 в худшем случае откатит UI-state, не данные.
        // Перенос снимает 50-200ms блок main thread в hot-path Storage.save.
        const settingsWrite = () => {
          try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(_buildSettingsPayload()));
          } catch(e){
            if (e && e.name === 'QuotaExceededError') window.showToast?.('Курс не сверен · переполнено локальное хранилище', 'error', 4200);
          }
        };
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(settingsWrite, { timeout: 1500 });
        } else {
          settingsWrite();
        }
      });
      Storage._t = null;
      _setDirtyDot(false);
      // V22 (AUDIT_HOLISTIC паттерн 17) — cross-tab broadcast.
      // notifyChange — fire-and-forget, не throw'ает; никаких prerequisites.
      try { CrossTabSync.notifyChange('state'); } catch (_) { /* defensive */ }
    },400);
  },
  saveSetting(k,v) { state[k]=v; Storage.save(); },
  /**
   * V12 (FOUND_BUGS #6) — synchronous flush. The 400 ms debounced save can
   * lose data if the user hits F5 inside the window (typical after CSV/XLSX
   * import). Call `flushNow()` from import paths to force an immediate
   * localStorage write. Idempotent — no-op when no timer is queued.
   */
  flushNow() {
    if (!Storage._t) return;
    clearTimeout(Storage._t);
    Storage._t = null;
    _setDirtyDot(false);
    Reactive.silent(() => {
      try {
        syncColumnSettings();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({rows:state.rows,employees:state.employees,savedAt:new Date().toISOString(),version:3}));
      } catch(e){
        if (e && e.name === 'QuotaExceededError') window.showToast?.('Память браузера заполнена — экспортируйте данные в CSV', 'error', 4200);
      }
      try {
        if (Services.AppDataStore && Services.AppDataStore.mode === 'sqlite') {
          Services.AppDataStore.saveRows(state.rows);
        }
      } catch(_) { /* mirror is best-effort */ }
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(_buildSettingsPayload()));
      } catch(e) {
        // V21 J #68 — не молчим при quota exceeded в flushNow path.
        if (e && e.name === 'QuotaExceededError') {
          window.showToast?.('Курс не сверен · переполнено локальное хранилище', 'error', 4200);
        }
      }
    });
    // V22 (AUDIT_HOLISTIC паттерн 17) — cross-tab broadcast после flushNow тоже.
    try { CrossTabSync.notifyChange('state'); } catch (_) { /* defensive */ }
  },
  load() {
    // V21 J #61+#78 — Не молчим при corrupt JSON: пишем в errorsLog +
    // отдаём индикатор `_corrupted` чтобы caller мог показать toast.
    // Защищаемся от ситуации «какой-то ключ битый, но другой ОК» — данные
    // не теряем, но факт corruption фиксируем.
    let firstCorruption = null;
    for (const key of STORAGE_KEYS) {
      try {
        const raw=localStorage.getItem(key);
        if (!raw) continue;
        const parsed=JSON.parse(raw);
        if (parsed && Array.isArray(parsed.rows)) return parsed;
      } catch(e){
        if (!firstCorruption) firstCorruption = { key, msg: String(e?.message || e).slice(0, 120) };
      }
    }
    if (firstCorruption) {
      try {
        if (typeof ErrorsLog !== 'undefined' && ErrorsLog?.add) {
          // V21 — fix позиционного вызова. ErrorsLog.add ждёт object-form
          // `{ level, source, message, details? }`. Раньше передавалось
          // позиционно ('warn', 'msg', {...}) и в журнал писался
          // `{level:'error', source:'unknown', message:'undefined'}`,
          // т.е. corruption-warning терялся (audit-2026-05-04 § functional #1).
          ErrorsLog.add({
            level:   'warn',
            source:  'dataStore.load',
            message: `Хранилище: повреждены данные в ключе ${firstCorruption.key}. Использован пустой план.`,
            details: { key: firstCorruption.key, msg: firstCorruption.msg },
          });
        }
        // AUDIT_HOLISTIC Идея 14 — Toast.warn (canonical), back-compat на showToast.
        if (typeof window !== 'undefined') {
          if (Services.Toast?.warn) Services.Toast.warn('Часть данных повреждена и была сброшена. См. журнал ошибок.');
          else window.showToast?.('Часть данных повреждена и была сброшена. См. журнал ошибок.', 'warning');
        }
      } catch (_) { /* defensive */ }
    }
    return null;
  },
  loadSettings() {
    // Bulk hydration of saved settings — must NOT trigger reactive auto-flush
    // (we just loaded these, no point saving them right back).
    Reactive.silent(() => {
      let s=null;
      for (const key of SETTINGS_KEYS) {
        try {
          const raw=localStorage.getItem(key);
          if (!raw) continue;
          s=JSON.parse(raw);
          if (s) break;
        } catch(e){}
      }
      if (!s) return;
      if (s.colOrder) state.colOrder=s.colOrder;
      if (s.colWidths) state.colWidths=s.colWidths;
      if (s.colVisibility) state.colVisibility=s.colVisibility;
      if (Object.prototype.hasOwnProperty.call(s,'sidebarCollapsed')) state.sidebarCollapsed=s.sidebarCollapsed;
      if (s.pinnedCols) state.pinnedCols=s.pinnedCols;
      if (Object.prototype.hasOwnProperty.call(s,'rowHeight')) state.rowHeight=s.rowHeight;
      if (s.colLabels) state.colLabels=s.colLabels;
      if (s.colTypes) state.colTypes=s.colTypes;
      if (s.customCols) state.customCols=s.customCols;
      if (s.epicDeps) state.epicDeps=s.epicDeps;
      if (s.ganttMode) state.ganttMode=s.ganttMode;
      if (s.ganttEpicsWell) state.ganttEpicsWell=s.ganttEpicsWell;
      if (s.podlozhkaMode) state.podlozhkaMode=s.podlozhkaMode;
      // V21 W (AUDIT_HOLISTIC O3) — summaryMode dropped (см. app/migrations.js).
      if (Object.prototype.hasOwnProperty.call(s,'presetsCollapsed')) state.presetsCollapsed=s.presetsCollapsed;
      if (s.theme) state.theme=s.theme;
      // V14: gantt2* state retired with GanttV2; old persisted entries silently
      // ignored — `state.gantt2Zoom` / `gantt2ShowDeps` / `gantt2Team` no longer exist.
      // V14 (B3 + B4): plan-lock and gantt edit-mode state.
      if (Object.prototype.hasOwnProperty.call(s,'planLocked'))   state.planLocked    = s.planLocked || null;
      if (Object.prototype.hasOwnProperty.call(s,'ganttEditMode')) state.ganttEditMode = !!s.ganttEditMode;
      // AUDIT_HOLISTIC F4 — Notification Center: hydrate из SETTINGS_KEY.
      if (Array.isArray(s.notifications)) state.notifications = s.notifications;
      // AUDIT_HOLISTIC P3 + Идея 1 — hydrate `state.meta`. Глубокий merge
      // с дефолтами из state.js: legacy payload без `meta` оставит
      // дефолтную форму нетронутой; payload с частичным `meta` (только
      // user) — заполняет user, остальное defaults.
      if (s.meta && typeof s.meta === 'object') {
        const m = s.meta;
        if (m.user && typeof m.user === 'object') {
          if (typeof m.user.email  === 'string') state.meta.user.email  = m.user.email;
          if (typeof m.user.name   === 'string') state.meta.user.name   = m.user.name;
          if (typeof m.user.avatar === 'string') state.meta.user.avatar = m.user.avatar;
        }
        if (m.permissions && typeof m.permissions === 'object') {
          for (const [k, v] of Object.entries(m.permissions)) {
            if (typeof v === 'boolean') state.meta.permissions[k] = v;
          }
        }
        if (m.featureFlags && typeof m.featureFlags === 'object') {
          for (const [k, v] of Object.entries(m.featureFlags)) {
            if (typeof v === 'boolean') state.meta.featureFlags[k] = v;
          }
        }
        if (typeof m.version         === 'string') state.meta.version         = m.version;
        if (typeof m.lastSeenVersion === 'string') state.meta.lastSeenVersion = m.lastSeenVersion;
        if (m.lastActiveAt == null || typeof m.lastActiveAt === 'string' || typeof m.lastActiveAt === 'number') {
          state.meta.lastActiveAt = m.lastActiveAt;
        }
        if (m.focus == null || (typeof m.focus === 'object')) state.meta.focus = m.focus;
      }
      // #1 — пользовательские релизы + локальный «глаз» Ганта.
      if (Array.isArray(s.releases)) state.releases = s.releases;
      if (Array.isArray(s.ganttHiddenReleases)) state.ganttHiddenReleases = s.ganttHiddenReleases;
      syncColumnSettings();
    });
  },
  clear() {
    STORAGE_KEYS.forEach(k=>localStorage.removeItem(k));
    SETTINGS_KEYS.forEach(k=>localStorage.removeItem(k));
  },
  restore(data) {
    // Restoring from a saved snapshot is a bulk hydrate — wrap silent so the
    // reactive layer doesn't interpret each property write as a user edit.
    // The caller is expected to call notify('restore') to drive UI refresh.
    // V17 P2 (H4) — runs every row through RowFactory.create() so legacy
    // snapshots automatically gain new defaults (assigneePills /
    // unplannedPills / inProgressPills / transferComments / workStartDate
    // etc). Earlier ad-hoc normalisation only handled a few fields, so
    // older saves crashed on first click in gantt («Object.entries(undefined)»).
    // Audit 2026-05 (system analyst M3 + QA R1).
    Reactive.silent(() => {
      state.rows = (data.rows || []).map(r => RowFactory.create(r));
      state.employees=(data.employees||[]).map(e=>EmployeeFactory.create(e));
      state.diagnostics.localStorageCount=state.rows.length;
      state.diagnostics.registryCount=state.rows.length;
      state.diagnostics.sources=['localStorage'];
      // V17 P9 (sys-analyst Quick win 2) — drop orphan ids from
      // `bulkSelected` so the bulk-panel doesn't try to mutate rows that
      // were removed by import / restore. Also clears `lastClickedRowId`
      // if it's stale — protects addRow's «insert after selected» path
      // (QA 1.3).
      if (state.bulkSelected && typeof state.bulkSelected.forEach === 'function') {
        const live = new Set(state.rows.map(r => r.id));
        const survive = [...state.bulkSelected].filter(id => live.has(id));
        state.bulkSelected = new Set(survive);
      }
      if (state.lastClickedRowId && !state.rows.some(r => r.id === state.lastClickedRowId)) {
        state.lastClickedRowId = null;
      }
    });
  },
};

// ============================================================
// CSV IMPORT / EXPORT
// ============================================================
export const CSV = {
  COLS: [
    'id','sourceType','sourceSheet','team','category','epic',
    'backend','frontend','analytics_estimate','testing_estimate','total_estimate',
    'tasks','taskComment','teamDependency','risks',
    'release120Types','release121Types','release122Types','overtimeTypes',
    'scopeStatus','role','blockingDependency','blockingDeadline',
    'commitToCounterparty','commitDate',
    'isDone','doneDate','comment','tags','dirty','createdAt','updatedAt',
    'workPeriodStart','workPeriodEnd','assignee','rowColor',
    // Integration fields
    'jiraKey','jiraStatus','jiraAssignee','jiraUpdatedAt',
    'prUrl','prStatus','prUpdatedAt',
    'docUrl','docTitle',
  ],
  SETTINGS_MARKER:  '__Q2SETTINGS__',
  BUNDLE_MARKER:    '__Q2BUNDLE__',
  EMPLOYEES_MARKER: '__Q2EMPLOYEES__',     // V14 (A3) — employees inlined as JSON

  // V17 P2 → V17.1 F1 → V21+ — история token-leak фикса.
  // Текущее решение (по запросу пилот-юзера): токены интеграций и LLM
  // СОХРАНЯЮТСЯ в bundle при экспорте, чтобы тимлид не вводил их заново
  // на каждом import. Остальные ключи (chat history, action log, etc.)
  // продолжают scrub'иться через `_scrubSecrets`.
  //
  // ⚠ ВАЖНО: bundle с токенами — это личный backup. Не расшаривать!
  // UI должен показать warning при export'е (см. _buildSettingsBundle).
  STORAGE_KEYS_FOR_EXPORT: [
    'q2_settings_v3',           // SETTINGS_KEY
    'q2_llm_settings_v1',       // LLM_SETTINGS_KEY — токены сохраняются
    'q2_integrations_v1',       // токены интеграций сохраняются
    'q2_onboarding_v1',         // OB_KEY
    'sbof_app_settings_v1',     // APP_SETTINGS_KEY
    'q2_llm_conv_v1',           // LLMAssistant.CONV_KEY (chat history) — scrub'ится
    'q2_action_log_v1',         // audit log — scrub'ится
  ],

  // Ключи где scrub НЕ применяется (токены сохраняются для personal backup).
  // Если пользователь делится файлом — он осознанно делится credentials.
  KEYS_PRESERVE_SECRETS: [
    'q2_integrations_v1',       // jiraToken, sigmaJiraToken, bitbucketToken, confluenceToken
    'q2_llm_settings_v1',       // GigaChat token, clientId, clientSecret
  ],

  // Defence-in-depth: scrub применяется только к ключам ВНЕ KEYS_PRESERVE_SECRETS.
  // Защищает от утечки через chat-history / action-log, где token-shaped строки
  // могут оказаться случайно (например, юзер вставил Bearer в чат).
  _SECRET_FIELD_NAMES: [
    'token', 'jiratoken', 'bitbuckettoken', 'confluencetoken', 'sigmatoken',
    'gigachatauthkey', 'authkey', 'apikey', 'password', 'secret', 'bearer',
  ],
  _scrubSecrets(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(v => CSV._scrubSecrets(v));
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const lower = String(k).toLowerCase();
      if (CSV._SECRET_FIELD_NAMES.some(s => lower.includes(s))) continue;
      out[k] = (v && typeof v === 'object') ? CSV._scrubSecrets(v) : v;
    }
    return out;
  },

  // Build the full settings bundle (state view + all localStorage keys, minus tokens)
  _buildSettingsBundle() {
    const stateView = {
      colOrder:state.colOrder, colWidths:state.colWidths, colVisibility:state.colVisibility,
      pinnedCols:state.pinnedCols, rowHeight:state.rowHeight, colLabels:state.colLabels,
      customCols:state.customCols, colTypes:state.colTypes, epicDeps:state.epicDeps,
      ganttMode:state.ganttMode, ganttEpicsWell:state.ganttEpicsWell,
      // V21 W (AUDIT_HOLISTIC O3) — summaryMode dropped.
      podlozhkaMode:state.podlozhkaMode, presetsCollapsed:state.presetsCollapsed,
      theme:state.theme,
      // V14: gantt2* fields retired (B2)
      simMode:state.simMode, sidebarCollapsed:state.sidebarCollapsed,
      activeSection:state.activeSection,
      filters:state.filters,
    };
    const localStorageBundle = {};
    CSV.STORAGE_KEYS_FOR_EXPORT.forEach(k => {
      const raw = localStorage.getItem(k);
      if (raw == null) return;
      try {
        const parsed = JSON.parse(raw);
        // Для KEYS_PRESERVE_SECRETS токены сохраняются как есть (personal backup).
        // Для остальных — scrub защищает от случайных утечек в chat/log.
        localStorageBundle[k] = CSV.KEYS_PRESERVE_SECRETS.includes(k)
          ? parsed
          : CSV._scrubSecrets(parsed);
      } catch(_) {
        localStorageBundle[k] = raw;
      }
    });
    return {
      stateView,
      localStorage: localStorageBundle,
      _exportedAt: new Date().toISOString(),
      _includesSecrets: true,    // marker для UI чтобы показать warning
    };
  },

  async export() {
    const bom='\uFEFF';
    const customKeys=state.customCols.map(c=>c.key);
    const allCols=[...CSV.COLS,...customKeys];
    const header=allCols.join(',');
    const rowToLine=(row)=>allCols.map(col=>{
      let v=row[col];
      if (Array.isArray(v)) v=Utils.serializePipe(v);
      if (typeof v==='boolean') v=v?'true':'false';
      return Utils.escapeCSV(v==null?'':v);
    }).join(',');
    // Build full bundle (state view + all localStorage settings, including tokens)
    const bundle = CSV._buildSettingsBundle();
    // Legacy settings row (state view only) — kept so older importers still pick up table view
    const settingsRow =CSV.SETTINGS_MARKER+','+Utils.escapeCSV(JSON.stringify(bundle.stateView));
    const bundleRow   =CSV.BUNDLE_MARKER  +','+Utils.escapeCSV(JSON.stringify(bundle));
    // V14 (A3): inline employees as JSON. Avoids ambiguity with row parsing
    // and round-trips cleanly through CSV escaping. Empty array if no
    // employees yet — readers must tolerate `[]`.
    const employeesRow=CSV.EMPLOYEES_MARKER+','+Utils.escapeCSV(JSON.stringify(state.employees || []));
    const onProgress=(done,total)=>{
      if (total>=2500 && done>0 && done%2000===0) window.showToast?.(`Экспорт CSV: ${done}/${total}`, 'success', 900);
    };
    let blob;
    if (window.CSVStreamExporter && typeof window.CSVStreamExporter.buildBlob === 'function') {
      blob=await window.CSVStreamExporter.buildBlob({
        bom,
        header,
        rows: state.rows,
        rowToLine,
        tailLines: [settingsRow, bundleRow, employeesRow],
        batchSize: 700,
        onProgress,
      });
    } else {
      const parts=[bom, header, '\n'];
      for (let i=0;i<state.rows.length;i++) {
        parts.push(rowToLine(state.rows[i]), '\n');
        if ((i+1)%700===0) await Utils.yieldToBrowser();
      }
      parts.push(settingsRow, '\n');
      parts.push(bundleRow, '\n');
      parts.push(employeesRow, '\n');
      blob=new Blob(parts,{type:'text/csv;charset=utf-8;'});
    }
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=`q2_plan_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    if (state.rows.length>=2500) window.showToast?.(`CSV экспортирован: ${state.rows.length} строк`);
  },

  import(text) {
    if (text.charCodeAt(0)===0xFEFF) text=text.slice(1);
    const allRows=Utils.parseFullCSV(text);
    if (allRows.length<2) {
      Services.Toast?.error?.('CSV пустой') || window.showToast?.('CSV пустой', 'error', 4000);
      return;
    }
    Services.HistoryManager?.checkpoint('импорт CSV');
    const headers=allRows[0].map(h=>h.trim());
    const newRows=[]; let count=0;
    for (let i=1;i<allRows.length;i++) {
      const cells=allRows[i];
      if (cells.every(c=>!c.trim())) continue;
      if (cells[0]===CSV.SETTINGS_MARKER) {
        try {
          const s=JSON.parse(cells[1]);
          if (s.colOrder) state.colOrder=s.colOrder;
          if (s.colWidths) state.colWidths=s.colWidths;
          if (s.colVisibility) state.colVisibility=s.colVisibility;
          if (s.pinnedCols) state.pinnedCols=s.pinnedCols;
          if (Object.prototype.hasOwnProperty.call(s,'rowHeight')) state.rowHeight=s.rowHeight;
          if (s.colLabels) state.colLabels=s.colLabels;
          if (s.colTypes) state.colTypes=s.colTypes;
          if (s.customCols) state.customCols=s.customCols;
          if (s.epicDeps) state.epicDeps=s.epicDeps;
          if (s.ganttMode) state.ganttMode=s.ganttMode;
          if (s.ganttEpicsWell) state.ganttEpicsWell=s.ganttEpicsWell;
          if (s.podlozhkaMode) state.podlozhkaMode=s.podlozhkaMode;
          // V21 W (AUDIT_HOLISTIC O3) — summaryMode dropped.
          if (Object.prototype.hasOwnProperty.call(s,'presetsCollapsed')) state.presetsCollapsed=s.presetsCollapsed;
          if (s.theme) state.theme=s.theme;
          // V14: gantt2* state retired (B2) — old export entries silently ignored.
          if (Object.prototype.hasOwnProperty.call(s,'simMode')) state.simMode=!!s.simMode;
          if (Object.prototype.hasOwnProperty.call(s,'sidebarCollapsed')) state.sidebarCollapsed=!!s.sidebarCollapsed;
          if (s.activeSection) state.activeSection=s.activeSection;
          // V15 (audit #1, fullstack Critical 3) — prototype-pollution guard.
          // A malicious bundle CSV with `filters: { __proto__: { x: 1 } }`
          // would mutate Object.prototype on import via Object.assign. Whitelist
          // exact keys we care about + reject __proto__/constructor/prototype.
          if (s.filters && typeof s.filters === 'object') {
            const ALLOWED_FILTER_KEYS = ['search', 'team', 'scope', 'release', 'onlyBlocking', 'onlyRisky', 'onlyDone'];
            for (const k of ALLOWED_FILTER_KEYS) {
              if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
              if (Object.prototype.hasOwnProperty.call(s.filters, k)) {
                state.filters[k] = s.filters[k];
              }
            }
          }
          syncColumnSettings();
          if (Services.App?.applyPresetsCollapsed) Services.App.applyPresetsCollapsed();
          if (Services.ThemeUI?.apply) Services.ThemeUI.apply();
        } catch(e) {}
        continue;
      }
      // V14 (A3): employees inline section. Independent from rows so old
      // CSVs (without this marker) still load — `state.employees` just
      // stays whatever was already in memory in that case.
      if (cells[0]===CSV.EMPLOYEES_MARKER) {
        try {
          const arr = JSON.parse(cells[1]);
          if (Array.isArray(arr)) {
            state.employees = arr.map(e => EmployeeFactory.create(e));
          }
        } catch(e) { console.warn('CSV employees parse failed:', e); }
        continue;
      }
      if (cells[0]===CSV.BUNDLE_MARKER) {
        try {
          const bundle=JSON.parse(cells[1]);
          // V12 audit recommendation #7 (FOUND_BUGS NEW-13) — bundle restore
          // previously wrote ANY key from the CSV directly to localStorage,
          // including `q2_integrations_v1` with auth tokens. A malicious
          // CSV could replace the user's tokens with attacker's. We now
          // allowlist only the registry/settings/onboarding keys; integration
          // tokens, LLM credentials, and chat prompts NEVER come back via
          // bundle import — they must be re-entered through Settings.
          const ALLOWED_BUNDLE_KEYS = new Set([
            'q2_plan_v3', 'q2_plan_v2', 'q2_plan',          // current data + legacy
            'q2_settings_v3', 'q2_settings_v2', 'q2_settings',
            'q2_onboarding_v1',
            'sbof_app_settings_v1',
            'welcomeShown',
            'dataStorageMode',
            'q2_action_log_v1',
          ]);
          // Restore every localStorage key (writing JSON back) — but only if allowlisted.
          if (bundle.localStorage && typeof bundle.localStorage === 'object') {
            let restored=0, skipped=0;
            for (const [k,v] of Object.entries(bundle.localStorage)) {
              if (!ALLOWED_BUNDLE_KEYS.has(k)) { skipped++; continue; }   // V12 — drop tokens etc.
              try {
                const value = (typeof v === 'string') ? v : JSON.stringify(v);
                localStorage.setItem(k, value);
                restored++;
              } catch(_) { /* quota / SecurityError */ }
            }
            if (restored) {
              const skipNote = skipped ? ` Пропущено ${skipped} (токены/LLM ключи).` : '';
              window.showToast?.(`Восстановлено ${restored} групп настроек.${skipNote} Перезагрузите страницу.`, 'success', 5000);
            }
          }
        } catch(e) { console.warn('CSV bundle parse failed:', e); }
        continue;
      }
      const obj={};
      headers.forEach((h,idx)=>{ obj[h]=cells[idx]!==undefined?cells[idx]:''; });
      ['release120Types','release121Types','release122Types','overtimeTypes'].forEach(f=>{
        obj[f]=Utils.parsePipe(obj[f]);
      });
      obj.blockingDependency=obj.blockingDependency==='true';
      obj.isDone=obj.isDone==='true';
      obj.dirty=obj.dirty==='true';
      obj.commitToCounterparty=obj.commitToCounterparty==='true';
      const row=RowFactory.create({...obj, id:obj.id||nextId()});
      newRows.push(row); count++;
    }
    // V15 (audit #1, QA Critical 3) — guard: a CSV with header-only or
    // all-empty data lines used to silently wipe `state.rows`. Now we
    // refuse the import explicitly; checkpoint stays for safety so the
    // user can still Ctrl+Z if they did want the wipe.
    if (!newRows.length) {
      Services.Toast?.warning?.('Не найдено валидных строк', { hint: 'Импорт отменён' })
        || window.showToast?.('Не найдено валидных строк. Импорт отменён.', 'warning', 4000);
      return;
    }
    state.rows=newRows;
    state.diagnostics.csvImportCount=count; state.diagnostics.sources=['csv'];
    RiskEngine.computeAll();
    // V12 (FOUND_BUGS #6): sync flush before notify, so the imported data is
    // already on disk before any UI re-render — protects against fast F5.
    Storage.save(); Storage.flushNow();
    notify('import-csv');
    setTimeout(()=>{ if(state.activeSection==='registry') Services.RegistryView?.autoFitColWidths(); }, 120);
  },

  // UX скв.2 — `importUpdate` стал async, чтобы дождаться ConfirmDialog
  // перед применением. Caller (app.js bindImports/csvUpdate handler) внутри
  // FileReader.onload, который не ждёт результата → безопасно.
  async importUpdate(text) {
    if (text.charCodeAt(0)===0xFEFF) text=text.slice(1);
    const allRows=Utils.parseFullCSV(text);
    if (allRows.length<2) {
      Services.Toast?.error?.('CSV пустой') || window.showToast?.('CSV пустой', 'error', 4000);
      return;
    }
    const headers=allRows[0].map(h=>h.trim()).filter(Boolean);
    if (!headers.length) {
      Services.Toast?.error?.('Нет заголовков в CSV') || window.showToast?.('Нет заголовков в CSV', 'error', 4000);
      return;
    }

    const boolKeys=new Set(['blockingDependency','isDone','dirty','commitToCounterparty']);
    const pipeKeys=new Set(['release120Types','release121Types','release122Types','overtimeTypes']);
    const skipKeys=new Set([CSV.SETTINGS_MARKER, CSV.BUNDLE_MARKER]);
    const keyOf=(r)=>[r.team,r.epic,r.tasks].map(v=>String(v||'').trim().toLowerCase()).join('||');

    const byId=new Map(state.rows.map(r=>[String(r.id),r]));
    const byKey=new Map();
    state.rows.forEach(r=>{
      const k=keyOf(r);
      if(!byKey.has(k)) byKey.set(k,[]);
      byKey.get(k).push(r);
    });

    const staged=[];
    let parsed=0, matched=0, changed=0, unchanged=0, notFound=0;

    for (let i=1;i<allRows.length;i++) {
      const cells=allRows[i];
      if (!cells || cells.every(c=>!String(c||'').trim())) continue;
      if (cells[0]===CSV.SETTINGS_MARKER || cells[0]===CSV.BUNDLE_MARKER) continue;
      parsed++;

      const obj={};
      headers.forEach((h,idx)=>{ obj[h]=cells[idx]!==undefined?cells[idx]:''; });
      const id=String(obj.id||'').trim();
      let row=id&&byId.has(id)?byId.get(id):null;
      if(!row){
        const k=keyOf(obj);
        const pool=byKey.get(k)||[];
        row=pool.length?pool[0]:null;
      }
      if(!row){ notFound++; continue; }
      matched++;

      const changes={};
      headers.forEach(h=>{
        if (!h || skipKeys.has(h) || h==='id') return;
        if (!Object.prototype.hasOwnProperty.call(row,h)) return;
        let incoming=obj[h];
        let current=row[h];

        if (pipeKeys.has(h)) {
          incoming=Utils.parsePipe(incoming);
          current=Array.isArray(current)?current:Utils.parsePipe(current);
          if (incoming.join('|')!==current.join('|')) changes[h]=incoming;
          return;
        }
        if (boolKeys.has(h)) {
          incoming=Utils.toBool(incoming,false);
          current=Utils.toBool(current,false);
          if (incoming!==current) changes[h]=incoming;
          return;
        }
        incoming=String(incoming==null?'':incoming).trim();
        current=String(current==null?'':current).trim();
        if (incoming!==current) changes[h]=incoming;
      });

      const changeKeys=Object.keys(changes);
      if (!changeKeys.length) { unchanged++; continue; }
      changed++;
      staged.push({ row, changes, changeKeys });
    }

    if (!matched) {
      Services.Toast?.warning?.('Не найдено совпадающих строк для обновления', { hint: 'Нужны id или совпадение team+epic+tasks' })
        || window.showToast?.('Не найдено совпадающих строк для обновления. Нужны id или совпадение team+epic+tasks.', 'warning', 4500);
      return;
    }
    if (!changed) {
      Services.Toast?.info?.(`Совпадения найдены (${matched}), но изменений нет`)
        || window.showToast?.(`Совпадения найдены (${matched}), но изменений нет.`, 'info', 3500);
      return;
    }

    const preview = `Найдено строк: ${parsed}\nСовпало: ${matched}\nИз них изменится: ${changed}\nБез изменений: ${unchanged}\nНе найдено: ${notFound}`;
    const ok = Services.ConfirmDialog?.show
      ? await Services.ConfirmDialog.show({
          title: 'Применить CSV update?',
          message: `${preview}\n\nПрименить обновление только изменённых полей?`,
          confirmLabel: 'Применить',
        })
      : (typeof window.confirm === 'function' ? window.confirm(`${preview}\n\nПрименить обновление только изменённых полей?`) : true);
    if (!ok) return;
    // V15 (audit #1, system analyst Medium 4) — checkpoint AFTER user
    // confirms; cancel used to leave a no-op entry on the undo stack.
    Services.HistoryManager?.checkpoint('CSV update');

    staged.forEach(({row,changes})=>{
      Object.entries(changes).forEach(([k,v])=>{ row[k]=v; });
      row.dirty=true;
      row.updatedAt=new Date().toISOString();
      RowFactory.updateDerived(row);
    });
    RiskEngine.computeAll();
    Storage.save();
    Storage.flushNow();              // V15 (audit #1, system analyst H4) — F5 within 400ms could lose updates
    notify('import-csv-update');
    window.showToast?.(`CSV update: обновлено ${changed} строк`);
  },
};

// ============================================================
// JSON IMPORT / EXPORT (V15)
// ============================================================
//
// Atomic single-file format for save/restore. Cleaner than CSV:
//   · No quote/comma/newline escaping bugs.
//   · No magic markers — `data`, `settings`, `bundle` are first-class keys.
//   · Versioned via `$schema` so future migrations have a hook.
//   · Smaller file (no double-quotes overhead, no marker rows).
//
// Security mirrors CSV:
//   · `bundle.localStorage` keys passed through the same allowlist.
//   · `settings.filters` whitelisted to known keys (prototype-pollution guard).
//   · `HistoryManager.checkpoint` runs AFTER the user confirms.
//
// CSV / XLSX flows are untouched — JSON is an additional path, not a replacement.
const JSON_SCHEMA = 'q2-plan/v1';
// V17.1 F1 — `q2_llm_settings_v1` и `q2_integrations_v1` добавлены в
//   allowlist чтобы JSON import восстанавливал их из bundle. Токены при
//   импорте заранее уже были вычищены экспортом (_scrubSecrets), поэтому
//   во время import просто пишем то что есть.
const JSON_ALLOWED_BUNDLE_KEYS = new Set([
  'q2_plan_v3', 'q2_plan_v2', 'q2_plan',
  'q2_settings_v3', 'q2_settings_v2', 'q2_settings',
  'q2_llm_settings_v1',
  'q2_integrations_v1',
  'q2_onboarding_v1',
  'sbof_app_settings_v1',
  'welcomeShown',
  'dataStorageMode',
  'q2_action_log_v1',
]);
const JSON_ALLOWED_FILTER_KEYS = ['search', 'team', 'scope', 'release', 'onlyBlocking', 'onlyRisky', 'onlyDone'];

export const JSONExport = {
  /** Build a snapshot object (does NOT touch the DOM). Useful for tests. */
  buildSnapshot() {
    const stateView = _buildSettingsPayload();
    const bundle = {};
    CSV.STORAGE_KEYS_FOR_EXPORT.forEach(k => {
      const raw = localStorage.getItem(k);
      if (raw == null) return;
      try {
        const parsed = JSON.parse(raw);
        // Токены интеграций / LLM сохраняются (personal backup, см. dataStore.js
        // CSV.KEYS_PRESERVE_SECRETS). Остальные ключи — scrub'ятся.
        bundle[k] = CSV.KEYS_PRESERVE_SECRETS.includes(k)
          ? parsed
          : CSV._scrubSecrets(parsed);
      } catch (_) { bundle[k] = raw; }
    });
    return {
      $schema:     JSON_SCHEMA,
      appVersion:  (typeof window !== 'undefined' && window.Q2_APP_VERSION) || '15.0.0',
      exportedAt:  new Date().toISOString(),
      data: {
        rows:      state.rows,
        employees: state.employees,
      },
      settings:    stateView,
      bundle,
      _includesSecrets: true,    // marker для UI
    };
  },

  // UX скв.2 — `download` стал async для ConfirmDialog (token-warning).
  // Caller — click-handler на btn-export-json, не ждёт результата → ок.
  async download() {
    if (!state.rows.length && !state.employees.length) {
      Services.Toast?.warning?.('Нет данных для экспорта')
        || window.showToast?.('Нет данных для экспорта', 'warning', 3000);
      return;
    }
    const snapshot = JSONExport.buildSnapshot();
    // Bundle содержит токены интеграций / LLM (KEYS_PRESERVE_SECRETS).
    // Спрашиваем явное подтверждение перед download'ом — иначе файл уйдёт
    // куда-нибудь в Slack-thread или email и токены утекут.
    const hasTokens = snapshot._includesSecrets && snapshot.bundle &&
      Object.keys(snapshot.bundle).some(k => CSV.KEYS_PRESERVE_SECRETS.includes(k) && snapshot.bundle[k]);
    if (hasTokens) {
      const tokenWarn =
        'Файл будет содержать токены интеграций (Jira / Bitbucket / Confluence / Sigma / GigaChat).\n\n' +
        'Это удобно для personal backup — после импорта не нужно вводить токены заново.\n' +
        'НО НЕ РАСШАРИВАЙТЕ файл с коллегами / в slack / email — там credentials.\n\n' +
        'Продолжить экспорт с токенами?';
      const ok = Services.ConfirmDialog?.show
        ? await Services.ConfirmDialog.show({
            title: 'Экспорт с токенами?',
            message: tokenWarn,
            confirmLabel: 'Экспортировать',
            danger: true,
          })
        : (typeof window.confirm === 'function' ? window.confirm(tokenWarn) : true);
      if (!ok) return;
    }
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `q2_plan_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const tail = hasTokens ? ' (с токенами — личный backup)' : '';
    window.showToast?.(`JSON экспортирован: ${state.rows.length} строк, ${state.employees.length} сотрудников${tail}`);
  },
};

export const JSONImport = {
  /** Parse + validate a JSON string. Throws on hard errors; returns a parsed
   *  snapshot ready for `apply()`. Visible in tests / fixtures. */
  parse(text) {
    let raw;
    try {
      raw = JSON.parse(typeof text === 'string' ? text : '');
    } catch (e) {
      throw new Error('Файл не является валидным JSON');
    }
    if (!raw || typeof raw !== 'object') throw new Error('JSON-файл пуст или неверной формы');
    if (!raw.data || typeof raw.data !== 'object') throw new Error('Отсутствует поле data');
    if (!Array.isArray(raw.data.rows)) throw new Error('data.rows должен быть массивом');
    return raw;
  },

  /** Apply a parsed snapshot to live state. Mirrors CSV.import semantics
   *  (rows replace, employees replace, settings selectively merged). */
  apply(snapshot) {
    Services.HistoryManager?.checkpoint('импорт JSON');
    // Rows — replace.
    const newRows = (snapshot.data.rows || []).map(r => RowFactory.create({ ...r, id: r.id || nextId() }));
    state.rows = newRows;
    state.diagnostics.csvImportCount = newRows.length;
    state.diagnostics.sources = ['json'];
    // Employees — replace.
    if (Array.isArray(snapshot.data.employees)) {
      state.employees = snapshot.data.employees.map(e => EmployeeFactory.create(e));
    }
    // Settings (state view) — selective merge with the same key-set as CSV.
    const s = snapshot.settings || {};
    if (s && typeof s === 'object') {
      if (s.colOrder)      state.colOrder      = s.colOrder;
      if (s.colWidths)     state.colWidths     = s.colWidths;
      if (s.colVisibility) state.colVisibility = s.colVisibility;
      if (s.pinnedCols)    state.pinnedCols    = s.pinnedCols;
      if (Object.prototype.hasOwnProperty.call(s, 'rowHeight')) state.rowHeight = s.rowHeight;
      if (s.colLabels)     state.colLabels     = s.colLabels;
      if (s.colTypes)      state.colTypes      = s.colTypes;
      if (s.customCols)    state.customCols    = s.customCols;
      if (s.epicDeps)      state.epicDeps      = s.epicDeps;
      if (s.ganttMode)     state.ganttMode     = s.ganttMode;
      if (s.ganttEpicsWell) state.ganttEpicsWell = s.ganttEpicsWell;
      if (s.podlozhkaMode)  state.podlozhkaMode  = s.podlozhkaMode;
      // V21 W (AUDIT_HOLISTIC O3) — summaryMode dropped.
      if (Object.prototype.hasOwnProperty.call(s, 'presetsCollapsed')) state.presetsCollapsed = s.presetsCollapsed;
      if (s.theme) state.theme = s.theme;
      // V14 plan-lock + edit-mode (paired audit#1 fix).
      if (Object.prototype.hasOwnProperty.call(s, 'planLocked'))    state.planLocked    = s.planLocked || null;
      if (Object.prototype.hasOwnProperty.call(s, 'ganttEditMode')) state.ganttEditMode = !!s.ganttEditMode;
    }
    // Bundle — same allowlist as CSV bundle import (prevents prototype pollution).
    const b = snapshot.bundle || {};
    if (b && typeof b === 'object') {
      let restored = 0, skipped = 0;
      let integrationsRestored = null;
      for (const [k, v] of Object.entries(b)) {
        if (!JSON_ALLOWED_BUNDLE_KEYS.has(k)) { skipped++; continue; }
        try {
          const value = (typeof v === 'string') ? v : JSON.stringify(v);
          localStorage.setItem(k, value);
          if (k === 'q2_integrations_v1') {
            // Сохраняем для sync с сервером ниже.
            integrationsRestored = (typeof v === 'object') ? v : (() => { try { return JSON.parse(value); } catch(_) { return null; } })();
          }
          restored++;
        } catch (_) {}
      }
      // Sync токенов на сервер (jira_config.json) чтобы integrations работали
      // сразу после импорта, без необходимости открывать settings и нажимать save.
      if (integrationsRestored && (integrationsRestored.jiraToken || integrationsRestored.sigmaJiraToken
                                    || integrationsRestored.bitbucketToken || integrationsRestored.confluenceToken)) {
        const serverPatch = {};
        const TOKEN_FIELDS = [
          'jiraBaseUrl', 'jiraToken', 'jiraProjectKeys',
          'sigmaJiraBaseUrl', 'sigmaJiraToken', 'sigmaGoalEpicKeys',
          'bitbucketBaseUrl', 'bitbucketToken', 'bitbucketProjectKeys',
          'confluenceBaseUrl', 'confluenceToken', 'confluenceSpaceKeys',
          'allowInsecureTls', 'sinceDate', 'activityWindowHours',
        ];
        for (const k of TOKEN_FIELDS) {
          if (k in integrationsRestored) serverPatch[k] = integrationsRestored[k];
        }
        fetch('/api/jira/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(serverPatch),
        }).catch((e) => {
          console.warn('[JSONImport] не удалось синхронизировать токены с сервером:', e?.message || e);
        });
      }
      if (restored) {
        const tail = skipped ? ` (${skipped} пропущено)` : '';
        window.showToast?.(`Восстановлено ${restored} групп настроек${tail}.`, 'success', 4500);
      }
    }
    syncColumnSettings();
    if (Services.App?.applyPresetsCollapsed) Services.App.applyPresetsCollapsed();
    if (Services.ThemeUI?.apply) Services.ThemeUI.apply();
    RiskEngine.computeAll();
    Storage.save();
    Storage.flushNow();   // F5-resilience (audit#1)
    notify('import-json');
    window.showToast?.(`JSON импортирован: ${state.rows.length} строк, ${state.employees.length} сотрудников`);
  },

  /** Top-level entry — read text + parse + confirm + apply. Errors surface
   *  via Toast.error and a one-line ErrorsLog entry.
   *  UX скв.2 — стал async для ConfirmDialog. Caller — FileReader.onload,
   *  не ждёт результата → безопасно. */
  async import(text) {
    let snapshot;
    try {
      snapshot = JSONImport.parse(text);
    } catch (e) {
      Services.Toast?.error?.('Импорт JSON прерван', { hint: e.message })
        || window.showToast?.(`Импорт JSON: ${e.message}`, 'error', 4500);
      try { Services.ErrorsLog?.add?.({ level: 'error', source: 'JSONImport', message: e.message }); } catch (_) {}
      return;
    }
    const summary = [
      `Schema: ${snapshot.$schema || '(не указана)'}`,
      `Версия приложения: ${snapshot.appVersion || '(не указана)'}`,
      `Экспортировано: ${snapshot.exportedAt || '(нет даты)'}`,
      `Строк: ${(snapshot.data.rows || []).length}`,
      `Сотрудников: ${(snapshot.data.employees || []).length}`,
      '',
      'Применить импорт? Текущие данные будут заменены (Ctrl+Z для отката).',
    ].join('\n');
    const schemaMismatch = snapshot.$schema && snapshot.$schema !== JSON_SCHEMA;
    const dlgMessage = schemaMismatch
      ? `Внимание: схема файла "${snapshot.$schema}" отличается от ожидаемой "${JSON_SCHEMA}". Импорт может работать некорректно.\n\n${summary}`
      : summary;
    const ok = Services.ConfirmDialog?.show
      ? await Services.ConfirmDialog.show({
          title: schemaMismatch ? 'Импорт JSON (схема не совпадает)' : 'Импорт JSON',
          message: dlgMessage,
          confirmLabel: 'Применить',
          danger: schemaMismatch,
        })
      : (typeof window.confirm === 'function' ? window.confirm(dlgMessage) : true);
    if (!ok) return;
    try {
      JSONImport.apply(snapshot);
    } catch (e) {
      Services.Toast?.error?.('Ошибка применения JSON', { hint: e.message })
        || window.showToast?.(`Ошибка применения JSON: ${e.message}`, 'error', 4500);
      try { Services.ErrorsLog?.add?.({ level: 'error', source: 'JSONImport.apply', message: e.message, stack: e.stack }); } catch (_) {}
    }
  },
};

// ============================================================
// XLSX IMPORTER
// ============================================================
export const XLSXImporter = {
  import(buffer) {
    if (typeof window.XLSX==='undefined') {
      Services.Toast?.error?.('Не удалось загрузить XLSX-парсер', { hint: 'Проверьте файл libs/xlsx.full.min.js рядом с index.html' })
        || window.showToast?.('Положите libs/xlsx.full.min.js рядом с index.html', 'error', 5000);
      return;
    }
    Services.HistoryManager?.checkpoint('импорт XLSX');
    // V21 J #71 — `cellDates: true` заставляет XLSX отдавать JS Date вместо
    // Excel serial number. Это устраняет 1900-leap-bug (Excel ошибочно
    // считает 1900 leap year → off-by-1 для дат до Mar 1, 1900) и убирает
    // ручную арифметику serial→Date. `dateNF: 'yyyy-mm-dd'` гарантирует
    // ISO-формат при дальнейшем `raw:false` rendering.
    const wb = window.XLSX.read(buffer, {type:'array', cellDates:true, dateNF:'yyyy-mm-dd'});
    const newRows=[], diag={sources:['xlsx'],sheets:wb.SheetNames.slice(),rowsPerSheet:{},detectedColumns:{},missingColumns:{},warnings:[]};
    wb.SheetNames.forEach(sheetName => {
      const ws = wb.Sheets[sheetName];
      const raw = window.XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
      if (!raw||raw.length<2) { diag.warnings.push(`Лист "${sheetName}": < 2 строк`); diag.rowsPerSheet[sheetName]=0; return; }
      let headerIdx=0;
      for (let i=0;i<Math.min(6,raw.length);i++) {
        if (raw[i].some(h=>Utils.mapHeader(Utils.normalizeHeader(h))!==null)) { headerIdx=i; break; }
      }
      const headerRow=raw[headerIdx], colMap={}, mapped={};
      headerRow.forEach((h,i) => {
        const n=Utils.normalizeHeader(h), f=Utils.mapHeader(n);
        if (f) { colMap[f]=i; mapped[f]={index:i,originalHeader:String(h).trim()}; }
      });
      diag.detectedColumns[sheetName]=mapped;
      const missing=['tasks'].filter(k=>!(k in colMap));
      if (missing.length) { diag.missingColumns[sheetName]=missing; diag.warnings.push(`Лист "${sheetName}": не найдены: ${missing.join(', ')}`); }
      const get=(f,cells)=>{ const i=colMap[f]; return i==null?'':String(cells[i]||'').trim(); };
      let cnt=0;
      for (let ri=headerIdx+1;ri<raw.length;ri++) {
        const cells=raw[ri];
        if (cells.every(c=>!String(c).trim())) continue;
        const r120=get('release120',cells), r121=get('release121',cells), scope=get('scope',cells);
        const period=Utils.parseDateRange(get('work_period',cells));
        const row=RowFactory.create({
          sourceType:'xlsx', sourceSheet:sheetName, team:sheetName,
          category:get('category',cells), tags:get('tags',cells), epic:get('epic',cells),
          total_estimate:get('estimation_legacy',cells),
          tasks:get('tasks',cells), taskComment:get('task_comment',cells),
          teamDependency:get('team_dependency',cells), risks:get('risks',cells),
          release120Raw:r120, release121Raw:r121,
          release120Types:Utils.parseLegacyRelease(r120), release121Types:Utils.parseLegacyRelease(r121),
          release122Types:[], overtimeTypes:[],
          scopeStatus:Utils.scopeFromRaw(scope), role:get('role',cells), assignee:get('assignee',cells),
          workPeriodStart:period.start, workPeriodEnd:period.end,
          comment:get('comment',cells), dirty:false,
        });
        newRows.push(row); cnt++;
      }
      diag.rowsPerSheet[sheetName]=cnt;
    });
    state.rows=newRows;
    state.diagnostics={...state.diagnostics,...diag,registryCount:newRows.length};
    RiskEngine.computeAll();
    // V12 (FOUND_BUGS #6) — see CSV.import for rationale.
    Storage.save(); Storage.flushNow();
    notify('import-xlsx');
    // Auto-fit columns to new content
    setTimeout(()=>{ if(state.activeSection==='registry') Services.RegistryView?.autoFitColWidths(); }, 120);
  },

  // Headers in the exact order expected by `XLSXImporter.import` — row order
  // is meaningful only for legibility; the importer keys headers by name.
  // Keeping this mirror in one place makes round-trip (export → import) safe.
  EXPORT_HEADERS: [
    'Категория', 'Теги', 'Эпик', 'Роли', 'Исполнители', 'Период работ',
    'Оценка', 'Задачи', 'Коммент к задачам', 'Зависимость от команд',
    'Риски', 'Релиз 1.20', 'Релиз 1.21', 'Релиз 1.22',
    'Входит в скоуп', 'Комментарий',
  ],

  /**
   * Build a workbook that mirrors the import format and trigger a download.
   * One sheet per team. Uses the SAME canonical headers `XLSXImporter.import`
   * recognises, so the produced file is round-trip-safe.
   */
  export() {
    if (typeof window.XLSX === 'undefined') {
      window.showToast?.('libs/xlsx.full.min.js не загружен', 'error', 3500);
      return;
    }
    if (!state.rows.length) { window.showToast?.('Нет данных для экспорта', 'info', 2000); return; }

    const wb = window.XLSX.utils.book_new();
    // Group rows by team (= sheet name). Rows without a team go to "Без команды".
    const byTeam = new Map();
    for (const r of state.rows) {
      const team = String(r.team || '').trim() || 'Без команды';
      if (!byTeam.has(team)) byTeam.set(team, []);
      byTeam.get(team).push(r);
    }

    // Joiner for release-type cells — importer's `parseLegacyRelease` accepts
    // comma-separated work-type names. We never went through `release120Raw`
    // because that field is purely a legacy mirror.
    const joinTypes = (arr) => Array.isArray(arr) ? arr.filter(Boolean).join(', ') : '';

    // Period column: "yyyy-mm-dd – yyyy-mm-dd" or just start if no end.
    const fmtPeriod = (start, end) => {
      const s = String(start || '').trim();
      const e = String(end   || '').trim();
      if (s && e) return `${s} – ${e}`;
      return s || e || '';
    };

    // Build a sheet per team. Sanitise sheet names — XLSX disallows certain
    // characters (\/?*[]:) and caps name length at 31.
    const cleanSheetName = (name) => {
      let n = String(name || 'Лист').replace(/[\\/?*[\]:]/g, '_').trim() || 'Лист';
      if (n.length > 31) n = n.slice(0, 31);
      return n;
    };
    const usedNames = new Set();

    byTeam.forEach((rows, team) => {
      let sheetName = cleanSheetName(team);
      // Disambiguate duplicates after truncation
      if (usedNames.has(sheetName)) {
        let i = 2;
        while (usedNames.has(sheetName + '_' + i)) i++;
        sheetName = (sheetName + '_' + i).slice(0, 31);
      }
      usedNames.add(sheetName);

      const aoa = [this.EXPORT_HEADERS.slice()];
      for (const r of rows) {
        aoa.push([
          r.category   || '',
          r.tags       || '',
          r.epic       || '',
          r.role       || '',
          r.assignee   || '',
          fmtPeriod(r.workPeriodStart, r.workPeriodEnd),
          r.total_estimate || '',
          r.tasks      || '',
          r.taskComment    || '',
          r.teamDependency || '',
          r.risks      || '',
          joinTypes(r.release120Types),
          joinTypes(r.release121Types),
          joinTypes(r.release122Types),
          r.scopeStatus || '',
          r.comment    || '',
        ]);
      }
      const ws = window.XLSX.utils.aoa_to_sheet(aoa);
      // Reasonable column widths — readability when opened manually.
      ws['!cols'] = this.EXPORT_HEADERS.map((h, i) => ({ wch: i === 7 /* Задачи */ ? 32 : Math.max(12, h.length + 2) }));
      window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    // Trigger download. writeFile uses anchor + ObjectURL internally.
    const filename = `q2_plan_${new Date().toISOString().slice(0,10)}.xlsx`;
    window.XLSX.writeFile(wb, filename);
  },

  /**
   * Merge an XLSX file into existing state.rows. User flow:
   *   · Rows whose Эпик ALREADY exists → leave existing row untouched.
   *   · Rows whose Эпик is NEW         → append as new row.
   * Settings, column order, custom columns — all preserved (Storage.save
   * only persists state.rows + state.employees in the data key).
   */
  importUpdate(buffer) {
    if (typeof window.XLSX === 'undefined') {
      window.showToast?.('libs/xlsx.full.min.js не загружен', 'error', 3500);
      return;
    }
    const wb = window.XLSX.read(buffer, { type: 'array' });

    // Index existing epics for O(1) collision detection. Trim + lowercase
    // to be lenient with whitespace and case (matches the user's intent —
    // "Auth" and "auth " would be treated as the same epic).
    const existingEpics = new Set();
    for (const r of state.rows) {
      const k = String(r.epic || '').trim().toLowerCase();
      if (k) existingEpics.add(k);
    }

    const added = [];
    const skippedExisting = [];
    const skippedNoEpic   = [];

    wb.SheetNames.forEach(sheetName => {
      const ws = wb.Sheets[sheetName];
      const raw = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      if (!raw || raw.length < 2) return;

      // Detect header row (same heuristic as the regular importer).
      let headerIdx = 0;
      for (let i = 0; i < Math.min(6, raw.length); i++) {
        if (raw[i].some(h => Utils.mapHeader(Utils.normalizeHeader(h)) !== null)) { headerIdx = i; break; }
      }
      const colMap = {};
      raw[headerIdx].forEach((h, i) => {
        const f = Utils.mapHeader(Utils.normalizeHeader(h));
        if (f) colMap[f] = i;
      });
      const get = (f, cells) => { const i = colMap[f]; return i == null ? '' : String(cells[i] || '').trim(); };

      for (let ri = headerIdx + 1; ri < raw.length; ri++) {
        const cells = raw[ri];
        if (!cells || cells.every(c => !String(c).trim())) continue;
        const epic = get('epic', cells);
        const epicKey = epic.trim().toLowerCase();
        if (!epicKey) { skippedNoEpic.push({ sheet: sheetName, row: ri }); continue; }
        if (existingEpics.has(epicKey)) { skippedExisting.push(epic); continue; }

        const r120 = get('release120', cells);
        const r121 = get('release121', cells);
        const period = Utils.parseDateRange(get('work_period', cells));
        const row = RowFactory.create({
          sourceType: 'xlsx-update', sourceSheet: sheetName, team: sheetName,
          category: get('category', cells), tags: get('tags', cells), epic,
          total_estimate: get('estimation_legacy', cells),
          tasks: get('tasks', cells), taskComment: get('task_comment', cells),
          teamDependency: get('team_dependency', cells), risks: get('risks', cells),
          release120Raw: r120, release121Raw: r121,
          release120Types: Utils.parseLegacyRelease(r120),
          release121Types: Utils.parseLegacyRelease(r121),
          release122Types: [], overtimeTypes: [],
          scopeStatus: Utils.scopeFromRaw(get('scope', cells)),
          role: get('role', cells), assignee: get('assignee', cells),
          workPeriodStart: period.start, workPeriodEnd: period.end,
          comment: get('comment', cells), dirty: false,
        });
        added.push(row);
        existingEpics.add(epicKey);   // protect against same epic appearing twice in the same file
      }
    });

    if (!added.length) {
      const msg = skippedExisting.length
        ? `Все эпики уже есть в реестре (${skippedExisting.length} совпадений). Новых строк не добавлено.`
        : 'В файле нет данных для добавления.';
      window.showToast?.(msg, 'info', 3500);
      return;
    }

    Services.HistoryManager?.checkpoint(`XLSX update: +${added.length} строк`);
    state.rows.push(...added);
    state.diagnostics = { ...state.diagnostics, registryCount: state.rows.length };
    RiskEngine.computeAll();
    Storage.save();
    notify('import-xlsx-update');
    const detail = skippedExisting.length ? ` (пропущено уже существующих: ${skippedExisting.length})` : '';
    window.showToast?.(`XLSX update: +${added.length} новых строк${detail}`, 'success', 3000);
  },
};

// ============================================================
// BULK ACTIONS
// ============================================================
export function applyBulkAction(rowIds, actionType, payload={}) {
  const ids = new Set(rowIds);
  const targets = state.rows.filter(r => ids.has(r.id));
  if (!targets.length) return;
  Services.HistoryManager?.checkpoint(`bulk:${actionType}`);
  // QA A3.6 / AS.4 — критично: без Reactive.silent каждое row.x=y
  // через Proxy триггерит Storage.save+App.refreshAll. На 1000 строк ×
  // ~4 присваивания = 4000 flush'ей → UI замораживается на 30+ сек.
  // Один Storage.save() выполняется явно ниже (строка с notify),
  // вместе с одним refreshAll через notify('bulk-action').
  Reactive.silent(() => {
  targets.forEach(row => {
    switch (actionType) {
      case 'assign_release': {
        const rel = payload.release;
        if (rel === '120') { row.release120Types = payload.types||['backend']; }
        else if (rel === '121') { row.release121Types = payload.types||['backend']; }
        else if (rel === '122') { row.release122Types = payload.types||['backend']; }
        else if (rel === 'ot')  { row.overtimeTypes = payload.types||['backend']; }
        row.dirty = true; row.updatedAt = new Date().toISOString();
        RowFactory.updateDerived(row); RiskEngine.computeFlags(row); RiskEngine.computeRiskScore(row);
        break;
      }
      case 'clear_release': {
        row.release120Types=[]; row.release121Types=[]; row.release122Types=[]; row.overtimeTypes=[];
        row.dirty = true; row.updatedAt = new Date().toISOString();
        RowFactory.updateDerived(row); RiskEngine.computeFlags(row); RiskEngine.computeRiskScore(row);
        break;
      }
      case 'set_scope': {
        row.scopeStatus = payload.scope||'Да';
        row.dirty = true; row.updatedAt = new Date().toISOString();
        RowFactory.updateDerived(row); RiskEngine.computeFlags(row); RiskEngine.computeRiskScore(row);
        break;
      }
      case 'set_assignee': {
        if (payload.assignee) { row.assignee = payload.assignee; row.dirty = true; row.updatedAt = new Date().toISOString(); }
        break;
      }
      case 'set_priority': {
        row.priority = payload.priority||'medium';
        row.dirty = true; row.updatedAt = new Date().toISOString();
        break;
      }
      case 'clear_blocker': {
        row.blockingDependency = false; row.blockingDeadline = '';
        row.dirty = true; row.updatedAt = new Date().toISOString();
        RiskEngine.computeFlags(row); RiskEngine.computeRiskScore(row);
        break;
      }
      case 'mark_done': {
        row.isDone = payload.done !== false;
        // QA A4.3 — локальная дата, не UTC (см. Utils.localDateString).
        if (row.isDone && !row.doneDate) row.doneDate = Utils.localDateString();
        row.dirty = true; row.updatedAt = new Date().toISOString();
        break;
      }
      case 'unmark_done': {
        row.isDone = false; row.doneDate = '';
        row.dirty = true; row.updatedAt = new Date().toISOString();
        break;
      }
      case 'set_done_date': {
        if (payload.date) { row.doneDate = payload.date; row.dirty = true; row.updatedAt = new Date().toISOString(); }
        break;
      }
      case 'set_business_value': {
        row.businessValue = Number(payload.value) || 0;
        row.dirty = true; row.updatedAt = new Date().toISOString();
        break;
      }
      case 'set_comment': {
        if (payload.append) {
          row.comment = row.comment ? row.comment + '\n' + payload.comment : payload.comment;
        } else {
          row.comment = payload.comment || '';
        }
        row.dirty = true; row.updatedAt = new Date().toISOString();
        break;
      }
      case 'flag_review': {
        row._reviewFlag = payload.flag !== false;
        row._reviewNote = payload.note || '';
        row.dirty = true; row.updatedAt = new Date().toISOString();
        break;
      }
      case 'unflag_review': {
        row._reviewFlag = false; row._reviewNote = '';
        row.dirty = true; row.updatedAt = new Date().toISOString();
        break;
      }
      case 'add_risk_flag': {
        const flag = payload.flag;
        if (flag && !(row.riskFlags||[]).includes(flag)) {
          row.riskFlags = [...(row.riskFlags||[]), flag];
          row.dirty = true; row.updatedAt = new Date().toISOString();
          RiskEngine.computeRiskScore(row);
        }
        break;
      }
      case 'remove_risk_flags': {
        row.riskFlags = payload.flag ? (row.riskFlags||[]).filter(f=>f!==payload.flag) : [];
        row.dirty = true; row.updatedAt = new Date().toISOString();
        RiskEngine.computeRiskScore(row);
        break;
      }
      case 'set_release_type': {
        const rel = payload.release, types = payload.types||[];
        if (rel === '120') row.release120Types = types;
        else if (rel === '121') row.release121Types = types;
        else if (rel === '122') row.release122Types = types;
        else if (rel === 'ot')  row.overtimeTypes = types;
        row.dirty = true; row.updatedAt = new Date().toISOString();
        RowFactory.updateDerived(row);
        break;
      }
      case 'reset_row': {
        row.blockingDependency = false; row.blockingDeadline = '';
        row._reviewFlag = false; row._reviewNote = '';
        row.riskFlags = []; row.priority = 'medium'; row.businessValue = 0;
        row.isDone = false; row.doneDate = '';
        row.dirty = true; row.updatedAt = new Date().toISOString();
        RiskEngine.computeFlags(row); RiskEngine.computeRiskScore(row);
        break;
      }
    }
  });
  }); // QA A3.6 — конец Reactive.silent блока
  // Log action
  const logEntry = {
    id: Date.now() + Math.random(),
    type: actionType,
    label: payload._label || actionType,
    count: targets.length,
    at: new Date().toISOString(),
    simMode: state.simMode,
  };
  // F4 fix (codebase-01 audit) — лимит был 200, в historyLog.js — 1000.
  // dataStore.js обрезал общий лог до 200 → удалял ~800 entries историки.
  // Теперь — единый MAX (1000) и через Reactive.silent (F3 контракт).
  Reactive.silent(() => {
    state.actionLog.unshift(logEntry);
    if (state.actionLog.length > 1000) state.actionLog.length = 1000;
  });

  if (state.simMode) {
    window.showToast?.(`[Симуляция] ${actionType} — ${targets.length} задач`, 'info');
  } else {
    Storage.save();
    window.showToast?.(`Курс скорректирован — ${targets.length} задач`, 'success');
  }
  notify('bulk-action');
  Services.ActionLayer?.renderLog?.();
}

export function autoAssignRelease(release, overwrite=false) {
  const candidates = state.rows.filter(r => {
    if (r.isDone) return false;
    const hasRelease = r.release120Types?.length || r.release121Types?.length || r.release122Types?.length || r.overtimeTypes?.length;
    return overwrite || !hasRelease;
  });
  if (!candidates.length) return 0;
  const types = ['backend'];
  applyBulkAction(candidates.map(r=>r.id), 'assign_release', { release, types, _label:`Авто-назначение в ${release}` });
  return candidates.length;
}

// F1 fix (codebase-01 audit, CLAUDE.md контракт #1) — mass-mutation
// должна идти в Reactive.silent, иначе на каждой строке Proxy-set триггерит
// markDirty → debounce → subscriber → Storage.save + App.refreshAll.
// На 500 строк = 500 мини-сейвов вместо одного финального.
export function normalizeAssignees() {
  Services.HistoryManager?.checkpoint('normalize_assignees');
  let count = 0;
  Reactive.silent(() => {
    state.rows.forEach(row => {
      const raw = row.assignee || '';
      const norm = raw.trim().replace(/\s+/g,' ');
      if (norm !== raw) { row.assignee = norm; row.dirty = true; count++; }
    });
  });
  if (count && !state.simMode) Storage.save();
  return count;
}

export function batchRiskRecompute() {
  Reactive.silent(() => {
    state.rows.forEach(r => { RiskEngine.computeFlags(r); RiskEngine.computeRiskScore(r); });
  });
  if (!state.simMode) Storage.save();
  return state.rows.length;
}

export function exportSelectedCSV(rowIds) {
  const ids = new Set(rowIds);
  const rows = rowIds.length ? state.rows.filter(r => ids.has(r.id)) : state.rows;
  const cols = getAllCols().filter(c => c.visible);
  // V21 J #72 — formula-injection guard. ZWSP prefix для `=+-@\t\r`,
  // потом quote всегда (excel-consistency для legacy callers).
  const escape = v => {
    let s = String(v ?? '');
    if (s && /^[=+\-@\t\r]/.test(s)) s = '​' + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = cols.map(c => escape(c.label)).join(',');
  const lines = rows.map(r => cols.map(c => escape(r[c.key]??'')).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`q2_actions_export_${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
  return rows.length;
}
