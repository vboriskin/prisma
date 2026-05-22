'use strict';
/* ============================================================
   STATE — v11 ES module
   --
   The exported `state` is a reactive Proxy (audit #6) — direct mutations
   like `state.rows[0].team = 'X'` automatically schedule a debounced
   flush (Storage.save + App.refreshAll) via Reactive.subscribe in app.js.

   For mass-mutation paths that should NOT trigger the flush (snapshot
   restoration, Storage.load, syncColumnSettings on bootstrap), wrap
   the work in `Reactive.silent(() => { ... })`.
   ============================================================ */

import { REGISTRY_COLS, COL_TYPES } from './constants.js';
import { Reactive } from './reactiveStore.js';

const _rawState = {
  rows: [],
  employees: [],
  // #1 — пользовательские релизы поверх 5 legacy (r120/r121/r122/overtime/backlog).
  // Каждый: { key, label, short, dates, barCls, winCls, order }. Persist'ится в
  // SETTINGS_KEY. Legacy 5 — захардкожены в constants.js (RELEASE_WINDOWS) и
  // не редактируются через этот список (мигрировать всех readers — отдельная задача).
  releases: [],
  // #1.1 — локальный «глаз» в Гант: список релиз-key, которые скрыты в Гант'е
  // (показ продолжается во всех других views). Persist'ится с settings.
  ganttHiddenReleases: [],
  filters: {
    // V22 #1.1 — `release` теперь массив (мульти-выбор). Старые строковые
    // значения адаптируются через FilterEngine.normalize'ом.
    search:'', team:'', scope:'', release:[], workType:'', role:'', assignee:'', tag:'',
    onlyBlocking:false, onlyRisky:false, onlyDone:false, preset:null,
  },
  activeSection: 'dashboard',
  diagnostics: {
    sources:[], sheets:[], rowsPerSheet:{}, detectedColumns:{}, missingColumns:{}, warnings:[],
    registryCount:0, csvImportCount:0, localStorageCount:0,
  },
  sort: { col:null, dir:'asc' },
  ganttMode: 'detailedTasks',     // V14: only mode now (B2 retired GanttV2)
  ganttEpicsWell: 'none',
  epicDeps: {},
  // V14: gantt2Zoom / gantt2ShowDeps / gantt2Team removed (B2)
  // V14 (B4): plan-lock state. `null` = план редактируется свободно.
  // `{ at: ISO, by: 'user' }` = план зафиксирован — все переносы
  // между колодцами требуют обязательный комментарий (см. B5).
  planLocked: null,
  // V14 (B3): bypass plan-lock comment requirement temporarily without
  // unlocking the plan. Sticky so users don't accidentally re-lose it on
  // navigation; clearing happens via the same toggle in the Gantt header.
  ganttEditMode: false,
  lastClickedRowId: null,
  timelineMode: 'summary',
  podlozhkaGroup: 'team',
  podlozhkaMode: 'summary',
  // П4-MS Wave 1: Сводная удалена (audit-2026-05-04/summary-metrics-redesign).
  // V21 W (AUDIT_HOLISTIC O3) — `summaryMode` field полностью удалён.
  // Миграция стрипает поле из старых q2_settings_v3 payload'ов
  // (см. app/migrations.js, key=q2_settings_v3, 0→1).
  presetsCollapsed: false,
  theme: 'light',
  colVisibility: {},
  colOrder: REGISTRY_COLS.map(c => c.key),
  colWidths: {},
  colLabels: {},
  pinnedCols: [],
  rowHeight: 36,
  customCols: [],
  colTypes: {},
  sidebarCollapsed: false,
  _idCounter: 1,
  _dataVersion: 0,
  llm: {},
  simMode: false,
  bulkSelected: new Set(),
  actionLog: [],
  // AUDIT_HOLISTIC F4 — единый центр уведомлений (app/notifyCenter.js).
  // Persistent FIFO-список (cap 100), пишется через Reactive proxy →
  // SETTINGS_KEY (см. dataStore._buildSettingsPayload + loadSettings).
  // Записи: { id, kind, title, body, actor, ts, severity, read,
  //           actionUrl, actionLabel }.
  notifications: [],
  // AUDIT_HOLISTIC P3 + Идея 1 — единый context-объект для:
  //   · идентификации текущего пользователя (email — primary identity,
  //     CLAUDE.md контракт #2);
  //   · permissions matrix (LLM S1: до этого любой клик мог удалить
  //     блокеры всем — теперь Permissions.guard);
  //   · feature flags (P5 — позволяет «выключить feature X у всех»);
  //   · version-tracking для «Что нового» onboarding (MASCOT I5);
  //   · `focus` — узкий контекст «утра тимлида» (последний просмотренный
  //     эпик/команда/период), который читают разные view'и.
  // Реактивен на тех же правилах, что весь `state` — мутации
  // `state.meta.user.email = '...'` идут через Proxy → debounced flush →
  // SETTINGS_KEY. Mass-mutation (например, hydrate из payload) ОБЯЗАН
  // быть в `Reactive.silent`.
  meta: {
    user:        { email: '', name: '', avatar: '' },
    permissions: {
      canBulkEdit:      true,
      canChangeScope:   true,
      canMarkDone:      true,
      canExport:        true,
      canEditEmployees: false,
    },
    featureFlags: {
      ai:            true,
      mascotMood:    true,
      notifications: true,
      explainScreen: true,
    },
    version:         '17.0.0',
    lastSeenVersion: '',
    lastActiveAt:    null,
    focus:           null,    // { kind, id, period } — для сценария «Утро тимлида»
  },
};
REGISTRY_COLS.forEach(c => { _rawState.colVisibility[c.key] = c.visible; });

// The exported `state` IS the reactive proxy. All existing imports of
// `state` now operate against it transparently — direct mutations fire
// the debounced flush. To bypass: `Reactive.silent(() => { state.x = y; })`.
export const state = Reactive.wrap(_rawState);

export function getAllCols() {
  return [...REGISTRY_COLS, ...state.customCols].map(col => ({
    ...col,
    // `type` reflects the user-selected display type (controls renderer choice).
    type:        state.colTypes[col.key] || col.type || 'text',
    // `naturalType` is the column's underlying storage format (controls how to read/write).
    // E.g. release120Types is naturally 'multiselect' (array) — even if user picks 'tags'
    // for display, we must keep the array storage so gantt / dashboard / risk engine work.
    naturalType: col.type || 'text',
  }));
}

export function toBool(value, fallback=false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true','1','yes','on','да'].includes(v)) return true;
    if (['false','0','no','off','нет',''].includes(v)) return false;
  }
  return !!fallback;
}

export function syncColumnSettings() {
  // Sanitize custom columns first (old localStorage could contain half-broken objects).
  const seenCustom = new Set();
  state.customCols = (Array.isArray(state.customCols) ? state.customCols : []).map((col, idx) => {
    if (!col || typeof col !== 'object') return null;
    const key = String(col.key || '').trim() || ('custom_' + idx);
    if (seenCustom.has(key)) return null;
    seenCustom.add(key);
    const widthRaw = Number.parseInt(col.width, 10);
    return {
      key,
      label: String(col.label || key).trim() || key,
      type: COL_TYPES.includes(col.type) ? col.type : 'text',
      visible: toBool(col.visible, true),
      width: Math.max(70, Math.min(420, Number.isFinite(widthRaw) ? widthRaw : 150)),
    };
  }).filter(Boolean);

  const all=[...REGISTRY_COLS, ...state.customCols];
  const allSet=new Set(all.map(c=>c.key));

  // Order: keep only existing keys, unique, then append missing.
  const orderRaw=Array.isArray(state.colOrder)?state.colOrder:[];
  const order=[];
  orderRaw.forEach(k=>{ if(allSet.has(k)&&!order.includes(k)) order.push(k); });
  all.forEach(col=>{ if(!order.includes(col.key)) order.push(col.key); });
  state.colOrder=order;

  // Visibility coercion: accept booleans and legacy "true"/"false" strings.
  const vis={};
  all.forEach(col=>{ vis[col.key]=toBool(state.colVisibility?.[col.key], col.visible!==false); });
  state.colVisibility=vis;

  // Widths with sane caps to avoid "everything moved away" UI.
  const widths={};
  all.forEach(col=>{
    const raw=state.colWidths?.[col.key];
    const n=Number.parseInt(raw,10);
    if (Number.isFinite(n)) widths[col.key]=Math.max(70,Math.min(420,n));
  });
  state.colWidths=widths;

  // Labels.
  const labels={};
  all.forEach(col=>{
    const v=state.colLabels?.[col.key];
    if (typeof v==='string' && v.trim()) labels[col.key]=v.trim();
  });
  state.colLabels=labels;

  // Type overrides.
  const types={};
  all.forEach(col=>{
    const t=state.colTypes?.[col.key];
    if (COL_TYPES.includes(t)) types[col.key]=t;
  });
  state.colTypes=types;

  // Pinned columns must exist and be visible.
  state.pinnedCols=[...new Set((Array.isArray(state.pinnedCols)?state.pinnedCols:[]).filter(key=>allSet.has(key)&&state.colVisibility[key]!==false))].slice(0,6);

  // Row height hard clamp.
  const rh=Number.parseInt(state.rowHeight,10);
  state.rowHeight=Math.max(28,Math.min(44,Number.isFinite(rh)?rh:36));

  // Sidebar collapsed flag could be stored as string in older snapshots.
  state.sidebarCollapsed=toBool(state.sidebarCollapsed,false);
  state.presetsCollapsed=toBool(state.presetsCollapsed,false);

  // Epic dependencies cleanup.
  const deps={};
  Object.entries(state.epicDeps||{}).forEach(([a,b])=>{
    const from=String(a||'').trim();
    const to=String(b||'').trim();
    if (!from||!to||from===to) return;
    deps[from]=to;
  });
  state.epicDeps=deps;
}

/**
 * AUDIT_ARCHITECTURE #4 — Legacy event-bus (subscribe/notify by reason).
 *
 * Eto staraya named-event shina dlya kross-modul'noy kommunikacii. Ona
 * sushchestvuet ryadom s Reactive (reactiveStore.js) i imeet drugoe
 * naznachenie:
 *
 *   · subscribe(fn) zdes' — slushaet IMENOVANNYE sobytiya
 *     ('chat_filter', 'import', 'restore', ...) kotorye nuzhno YAVNO
 *     emit'it' cherez notify('reason').
 *   · Reactive.subscribe(fn) v reactiveStore.js — auto-flush na lyubuyu
 *     mutation state'a (debounced); reason ne peredaetsya.
 *
 * REKOMENDACIYA: dlya NOVOGO koda predpochitayte Reactive.subscribe.
 * Ostavlennyy zdes' API ispol'zuyte tol'ko esli vam DEYSTVITEL'NO
 * nuzhno znat' tip sobytiya (chat-filter izmenilsya / impotirovan novyy
 * dataset / vosstanovlena snapshot).
 *
 * NE ISPOLZUYTE oba mexanizma odnovremenno dlya odnogo i togo zhe sobytiya
 * — eto privedet k dvoynoy notifikacii i, kak sledstvie, double-render.
 */
const _listeners = [];
export function subscribe(fn) {
  _listeners.push(fn);
  return () => {
    const i = _listeners.indexOf(fn);
    if (i > -1) _listeners.splice(i, 1);
  };
}
export function notify(reason='') {
  _listeners.forEach(fn => { try { fn(reason); } catch(e) {} });
}
