'use strict';
/* ============================================================
   APP.JS — v8_0 main entry point
   Imports all modules; contains orchestrator objects not yet
   extracted: HistoryManager, BulkEditPanel, SimMode, ThemeUI,
   SidebarUI, FiltersUI, LLMAssistant, Nav, App, AppSettings,
   Onboarding, ActionLayer, JiraPulse.
   ============================================================ */

import { state, getAllCols, syncColumnSettings, subscribe, notify, toBool } from './state.js';
import { STORAGE_KEY, SETTINGS_KEY, LLM_SETTINGS_KEY, DEFAULT_LLM_SYSTEM_PROMPT, REGISTRY_COLS, WORK_TYPES, SCOPE_OPTIONS } from './constants.js';
import { Storage, CSV, XLSXImporter, JSONExport, JSONImport, applyBulkAction, autoAssignRelease, normalizeAssignees, batchRiskRecompute, exportSelectedCSV } from './dataStore.js';
import { FilterEngine } from './filters.js';
import { RiskEngine } from './riskEngine.js';
import { Utils, nextId } from './utils.js';
import { RowFactory, EmployeeFactory } from './rowFactory.js';
import { Multiselect } from './components/multiselect.js';
import { DashboardView } from './views/dashboard.js';
import { RegistryView } from './views/registry.js';
import { GanttView } from './views/gantt.js';   // V14: GanttV2 removed (B2)
import { GanttHTMLExport } from './views/ganttHtmlExport.js';   // V15: standalone HTML viewer
import { KanbanView } from './views/kanban.js';
import { TimelineView, PodlozhkaView } from './views/timeline.js';
import { SummaryView, MetricsView, InsightsView, DiagnosticsView } from './views/metrics.js';
import { EmployeesView } from './views/employees.js';
import { AIView }        from './views/aiView.js';
import { AICeoView }          from './views/aiCeoView.js';
import { IntegrationsView, openIntegrationsSettings } from './views/integrationsView.js';
import { hydrateFromServer as hydrateIntegrationsFromServer } from './integrations/integrationsStore.js';
import { ErrorsView } from './views/errorsView.js';
import { ErrorsLog } from './errorsLog.js';
import { HistoryView }        from './views/history.js';
import { HistoryLog, loadHistoryLog } from './historyLog.js';
import { AppDataStore } from './appDataStore.js';   // V11 unified storage facade (opt-in SQLite)
import { isFirstRun, resetOnboarding } from './onboarding/onboarding.js';
import { initOnboardingUI, showWelcomeScreen, bindWelcomeButtons, updateDemoBanner, showPostLoadInsights } from './onboarding/onboardingUI.js';

// Decomposed app/* modules (audit #7 — was monolithic app.js)
import { HistoryManager } from './app/historyManager.js';
import { Onboarding }     from './app/onboarding.js';
import { ActionLayer }    from './app/actionLayer.js';
import { LLMAssistant }   from './app/llmAssistant.js';
import { setupWelcomeSplash as _setupWelcomeSplash, welcomeHandledRestore } from './app/init.js';
// V13 audit #18 — pulled out of app.js to shrink it below 2000 LOC.
import { StorageSettings } from './app/storageSettings.js';
import { PromptsEditor }   from './app/promptsEditor.js';
import { Nav }             from './app/nav.js';
// V18.1 P9 — UI toggles extracted into app/uiToggles.js
import { SimMode, SidebarUI, ThemeUI } from './app/uiToggles.js';
// V18.1 P9 — Bulk edit panel extracted into app/bulkEditPanel.js
import { BulkEditPanel } from './app/bulkEditPanel.js';
// V18.1 P9 — App settings + nav/blocks/topbar registries extracted
import { AppSettings, NAV_SECTIONS, BLOCKS_PER_SECTION, APP_SETTINGS_KEY, TOPBAR_ITEMS } from './app/appSettings.js';

// Chat modules (v10_0 Planning Assistant)
import { process as chatProcess, parseLLMResponse } from './chat/chatEngine.js';
import { renderStructuredResponse, renderUserMessage, renderThinking, renderError } from './chat/chatUIRenderer.js';
import { executeAction, bindActionClicks } from './chat/chatActions.js';
import { getQuickPrompts, renderQuickPromptsHTML } from './chat/chatTemplates.js';
import { buildAlerts, renderAlertBar, refreshAlerts, saveAlertBaseline } from './chat/chatAlerts.js';
import { takeSnapshot } from './chat/chatReports.js';
import { getAllPrompts, savePromptOverrides, resetPromptOverride, getDefaultPrompt, CATEGORIES as PROMPT_CATEGORIES } from './chat/chatPrompts.js';

// ── Expose globals for chat modules (avoid circular imports) ──
window.applyBulkAction = applyBulkAction;
window.takeSnapshot    = takeSnapshot;

// ============================================================
// HELPERS
// ============================================================
function computeProgress(rows) {
  const releases = ['120','121','122','ot'];
  const result = {};
  releases.forEach(rel => {
    const key = rel === 'ot' ? 'hasOvertime' : `hasRelease${rel}`;
    const inRel = rows.filter(r => r[key]);
    const done = inRel.filter(r => r.isDone).length;
    result[rel] = { total: inRel.length, done, pct: inRel.length ? Math.round(done/inRel.length*100) : 0 };
  });
  const total = rows.length;
  const done = rows.filter(r => r.isDone).length;
  result.all = { total, done, pct: total ? Math.round(done/total*100) : 0 };
  return result;
}

function computeLoad(rows) {
  const load = {};
  rows.forEach(r => {
    const assignees = String(r.assignee||'').split(/[|,]/).map(s=>s.trim()).filter(Boolean);
    assignees.forEach(name => {
      if (!load[name]) load[name] = { total:0, r120:0, r121:0, r122:0, ot:0 };
      load[name].total++;
      if (r.hasRelease120) load[name].r120++;
      if (r.hasRelease121) load[name].r121++;
      if (r.hasRelease122) load[name].r122++;
      if (r.hasOvertime)   load[name].ot++;
    });
  });
  return load;
}

function getFilteredRows() { return FilterEngine.getFiltered(); }

function parseLLMCommand(text) {
  const t = text.toLowerCase().trim();
  const rows = FilterEngine.getFiltered();
  if (/назнач|распредел/.test(t) && /без.*релиз|нераспредел|unassigned/.test(t)) {
    const rel = /1\.21/.test(t) ? '121' : /1\.22/.test(t) ? '122' : '120';
    const targets = rows.filter(r => r.isUnassigned && r.scopeStatus === 'Да');
    return { intent: 'assign_unassigned_to_release', targets, payload: { release: rel }, description: `Назначить ${targets.length} нераспределённых задач в релиз 1.${rel}` };
  }
  if (/убер|удал|сним/.test(t) && /риск|блокер/.test(t)) {
    const targets = rows.filter(r => r.blockingDependency);
    return { intent: 'remove_risks', targets, payload: {}, description: `Снять блокер с ${targets.length} задач` };
  }
  if (/перегруж|нагруз/.test(t)) {
    const load = computeLoad(rows);
    const overloaded = Object.entries(load).filter(([,v]) => v.total >= 6).map(([name]) => name);
    return { intent: 'show_overloaded', targets: [], payload: { overloaded }, description: `Перегруженные исполнители: ${overloaded.join(', ') || 'нет'}` };
  }
  return null;
}

// ============================================================
// TOAST / MODAL
// ============================================================
function showToast(msg, type='success', ms=2000) {
  // Mirror error/warning toasts into the persistent errors log so the user
  // can review what happened later in the «Ошибки» tab. Success/info pass
  // through silently — they're not noise we need to keep.
  if (type === 'error' || type === 'warning') {
    try {
      ErrorsLog.add({
        level:   type === 'error' ? 'error' : 'warn',
        source:  'showToast',
        message: String(msg || ''),
      });
    } catch (_) {}
  }
  const el=document.getElementById('toast');
  if (!el) return;
  el.textContent=msg; el.className=`toast toast-${type}`;
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t=setTimeout(()=>{
    el.classList.add('toast-out');
    setTimeout(()=>el.classList.add('hidden'),160);
  },ms);
  // Refresh the sidebar badge so the user sees there's something new to look at.
  try { updateErrorsBadge(); } catch (_) {}
}

/** Keep #nav-errors-badge in sync with the count of un-cleared errors+warnings. */
function updateErrorsBadge() {
  const el = document.getElementById('nav-errors-badge');
  if (!el) return;
  const c = ErrorsLog.counts();
  const n = (c.error || 0) + (c.warn || 0);
  if (n > 0) {
    el.textContent = n > 99 ? '99+' : String(n);
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function closeModal(el) {
  if (!el || el.classList.contains('hidden')) return;
  el.classList.add('modal-closing');
  setTimeout(() => { el.classList.remove('modal-closing'); el.classList.add('hidden'); }, 140);
}
// V15 (audit#2, QA Critical 1): expose `closeModal` via `window` so external
// modules (notably `app/llmAssistant.js:526,546`) can call it without a
// ReferenceError. Before this fix, the LLM settings modal Save/ESC paths
// crashed silently the first time a user tried to close it.
if (typeof window !== 'undefined') window.closeModal = closeModal;

// ============================================================
// FUNNY LOADER — used during AI / Integrations long operations
// ============================================================
const FUNNY_PHRASES = [
  '🤖 Беру у джуна интервью…',
  '☕ Завариваю кофе для нейронки…',
  '🐌 Ловлю улитку с задачами Jira…',
  '🎯 Целюсь в спринт, не дрогни рукой…',
  '📜 Читаю комменты, ужасаюсь…',
  '🔎 Ищу того, кто двигал дедлайн…',
  '🧠 Греем GPU. Зимой это бонус…',
  '🐘 Втаскиваю слона из бэклога…',
  '🛸 Запускаю CEO-режим, держитесь…',
  '🪄 Умножаю риски на оптимизм…',
  '☁️ Стучусь в Confluence, никто не дома…',
  '🧩 Складываю пазл из эпиков…',
  '⏳ Ещё чуть-чуть. Серьёзно.',
  '🔧 Подкручиваю гайки на гант-стрелках…',
  '📡 Звоню в Bitbucket, длинные гудки…',
  '🥷 Ниндзя-менеджер обходит блокеры…',
  '🦉 Смотрю на план мудро и долго…',
  '🐙 Связываю всё со всем (8 рук помогает)…',
  '🚀 Просчитываю траекторию релиза 1.21…',
  '🎲 Бросаю кубик за того парня…',
];
function _pickFunny(used = new Set()) {
  const pool = FUNNY_PHRASES.filter(p => !used.has(p));
  if (!pool.length) { used.clear(); return FUNNY_PHRASES[Math.floor(Math.random()*FUNNY_PHRASES.length)]; }
  return pool[Math.floor(Math.random() * pool.length)];
}

// Global overlay loader. Returns { update(text), close(), promise }
function showFunnyLoader(initialMsg = 'Загружаю…') {
  let el = document.getElementById('funny-loader');
  if (!el) {
    el = document.createElement('div');
    el.id = 'funny-loader';
    el.className = 'funny-loader';
    el.innerHTML = `
      <div class="funny-loader-card">
        <div class="funny-loader-spinner"></div>
        <div class="funny-loader-title" id="funny-loader-title"></div>
        <div class="funny-loader-phrase" id="funny-loader-phrase"></div>
      </div>`;
    document.body.appendChild(el);
  }
  el.classList.remove('hidden');
  document.getElementById('funny-loader-title').textContent = initialMsg;

  const used = new Set();
  const phraseEl = document.getElementById('funny-loader-phrase');
  const tick = () => {
    const next = _pickFunny(used);
    used.add(next);
    if (phraseEl) {
      phraseEl.classList.remove('funny-loader-phrase-in');
      // restart animation
      void phraseEl.offsetWidth;
      phraseEl.textContent = next;
      phraseEl.classList.add('funny-loader-phrase-in');
    }
  };
  tick();
  const interval = setInterval(tick, 2200);

  return {
    update(text) { const t = document.getElementById('funny-loader-title'); if (t) t.textContent = text; },
    close() {
      clearInterval(interval);
      el.classList.add('hidden');
    },
  };
}

// HistoryManager extracted to ./app/historyManager.js (audit #7 decomposition).

// StorageSettings  → app/storageSettings.js  (audit #18 decomposition).
// PromptsEditor    → app/promptsEditor.js    (audit #18 decomposition, also closes FOUND_BUGS #5).
// Both objects are imported at the top of this file.

// ============================================================
// FORCE SAVE
// ============================================================
function forceSave() {
  state.rows.forEach(r=>RowFactory.updateDerived(r));
  RiskEngine.computeAll();
  syncColumnSettings();
  state._dataVersion++;
  clearTimeout(Storage._t);
  try {
    localStorage.setItem(STORAGE_KEY,JSON.stringify({rows:state.rows,employees:state.employees,savedAt:new Date().toISOString(),version:3}));
    localStorage.setItem(SETTINGS_KEY,JSON.stringify({
      colOrder:state.colOrder,colWidths:state.colWidths,colVisibility:state.colVisibility,
      sidebarCollapsed:state.sidebarCollapsed,pinnedCols:state.pinnedCols,rowHeight:state.rowHeight,
      colLabels:state.colLabels,customCols:state.customCols,colTypes:state.colTypes,
      epicDeps:state.epicDeps,ganttMode:state.ganttMode,ganttEpicsWell:state.ganttEpicsWell,
      podlozhkaMode:state.podlozhkaMode,summaryMode:state.summaryMode,presetsCollapsed:state.presetsCollapsed,
      theme:state.theme,
      // V14: gantt2* keys retired with GanttV2; old persisted entries
      // are silently dropped on next save.
    }));
  } catch(e){
    if (e && e.name === 'QuotaExceededError') {
      showToast('Сохранение не выполнено: переполнен localStorage', 'error', 4200);
      return;
    }
  }
  App.populateFilterDropdowns();
  App.refreshAll();
  App.updateTopbarBadge();
  showToast('✓ Сохранено и пересчитано');
}


// ============================================================
// BULK EDIT PANEL
// ============================================================
// V18.1 P9 — extracted into ./app/bulkEditPanel.js (imported above).
// Re-export on window done in the standard window.* block at file bottom.

// ============================================================
// SIMULATION MODE / SIDEBAR / THEME
// ============================================================
// V18.1 P9 — extracted into ./app/uiToggles.js (imported above).
// Re-exports on window done in the standard window.* block at file bottom.

// ============================================================
// FILTERS UI
// ============================================================
const FiltersUI = {
  init() {
    // V17 P11 (full-stack F-5 + sys-analyst §2) — idempotent guard. Listeners
    // were stacking on every re-init (test setup, hot-reload, future re-bind).
    if (FiltersUI._bound) return;
    FiltersUI._bound = true;
    const bind=(id,key,bool)=>{
      const el=document.getElementById(id);
      if (!el) return;
      el.addEventListener('change',e=>{
        // V17 P11 (sys-analyst §4 + QA B3) — manual filter mutation drops the
        // active-preset highlight: preset claim no longer matches reality.
        if (state.filters.preset && key !== 'preset') state.filters.preset = null;
        state.filters[key]=bool?e.target.checked:e.target.value;
        App.refreshCurrentSection();
      });
    };
    // V17 P11 (full-stack F-4 + QA B1) — search has its own debounced `input`
    // listener below; binding `change` here would race the trailing setTimeout.
    bind('filter-team','team'); bind('filter-scope','scope');
    bind('filter-release','release'); bind('filter-worktype','workType'); bind('filter-role','role'); bind('filter-assignee','assignee');
    bind('filter-blocking','onlyBlocking',true);
    bind('filter-risky','onlyRisky',true); bind('filter-done','onlyDone',true);
    if (FiltersUI._searchTimer) clearTimeout(FiltersUI._searchTimer);
    document.getElementById('filter-search').addEventListener('input',e=>{
      const next = e.target.value.trim();
      clearTimeout(FiltersUI._searchTimer);
      FiltersUI._searchTimer = setTimeout(()=>{
        if (state.filters.search === next) return;
        if (state.filters.preset) state.filters.preset = null;
        state.filters.search=next;
        App.refreshCurrentSection();
      }, 140);
    });
    document.getElementById('btn-reset-filters').addEventListener('click',()=>FiltersUI.reset());
    document.querySelectorAll('.preset-btn[data-preset]').forEach(btn=>btn.addEventListener('click',()=>FiltersUI.applyPreset(btn.dataset.preset)));
    // V17 P11 (QA A2) — toggle-chip wraps a hidden checkbox; `change` flips
    // `state.filters.only*` via the bind() above, but the visual `.active`
    // class on the wrapping chip was only set inside applyPreset/syncUI/reset.
    // Click the chip directly → checkbox toggles, chip stayed inactive. Fix:
    // mirror checkbox.checked → chip.classList on every change.
    ['blocking','risky','done'].forEach(k=>{
      const cb=document.getElementById(`filter-${k}`);
      const tg=document.getElementById(`toggle-${k}`);
      if (cb && tg) cb.addEventListener('change',()=>tg.classList.toggle('active', cb.checked));
    });
  },
  applyPreset(preset) {
    document.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('active'));
    // V17 P11 (QA B3 + sys-analyst §4) — preset previously preserved
    // role/assignee/tag/team/workType/search silently. User pick role=BE then
    // preset «Критичное» got "Critical AND BE" without warning. Spec: preset
    // means a CLEAN view — clear all dimensions first.
    state.filters.search='';
    state.filters.team='';
    state.filters.workType='';
    state.filters.role='';
    state.filters.assignee='';
    state.filters.tag='';
    state.filters.scope='';
    state.filters.release='';
    state.filters.onlyBlocking=false;
    state.filters.onlyRisky=false;
    state.filters.onlyDone=false;
    if (preset==='reset') { state.filters.preset=null; FiltersUI.syncUI(); FiltersUI.populateDropdowns(); App.refreshCurrentSection(); return; }
    state.filters.preset=preset;
    const btn=document.querySelector(`.preset-btn[data-preset="${preset}"]`);
    if (btn) btn.classList.add('active');
    if (preset==='critical') state.filters.onlyRisky=true;
    else if (preset==='no-release') state.filters.release='none';
    else if (preset==='needs-confirm') state.filters.scope='Требует подтверждения';
    else if (preset==='has-blocker') state.filters.onlyBlocking=true;
    else if (preset==='overtime') state.filters.release='overtime';
    else if (preset==='done') state.filters.onlyDone=true;
    FiltersUI.syncUI(); FiltersUI.populateDropdowns(); App.refreshCurrentSection();
  },
  syncUI() {
    document.getElementById('filter-scope').value=state.filters.scope||'';
    document.getElementById('filter-release').value=state.filters.release||'';
    ['blocking','risky','done'].forEach(k=>{
      const fk='only'+k.charAt(0).toUpperCase()+k.slice(1);
      const cb=document.getElementById(`filter-${k}`);
      if (cb) cb.checked=state.filters[fk];
      const tg=document.getElementById(`toggle-${k}`);
      if (tg) tg.classList.toggle('active',state.filters[fk]);
    });
    const roleSel=document.getElementById('filter-role'); if(roleSel) roleSel.value=Array.isArray(state.filters.role)?'':(state.filters.role||'');
    const assigneeSel=document.getElementById('filter-assignee'); if(assigneeSel) assigneeSel.value=Array.isArray(state.filters.assignee)?'':(state.filters.assignee||'');
  },
  reset() {
    state.filters={search:'',team:'',scope:'',release:'',workType:'',role:'',assignee:'',tag:'',onlyBlocking:false,onlyRisky:false,onlyDone:false,preset:null};
    document.getElementById('filter-search').value=''; document.getElementById('filter-team').value='';
    document.getElementById('filter-scope').value=''; document.getElementById('filter-release').value='';
    document.getElementById('filter-worktype').value=''; document.getElementById('filter-role').value='';
    const assigneeSel=document.getElementById('filter-assignee'); if (assigneeSel) assigneeSel.value='';
    document.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('active'));
    FiltersUI.syncUI(); FiltersUI.populateDropdowns(); App.refreshCurrentSection();
  },
  populateDropdowns() {
    const teamSel=document.getElementById('filter-team'), cur1=teamSel.value;
    teamSel.innerHTML='<option value="">Все</option>'+FilterEngine.getTeams().map(t=>`<option value="${t}"${cur1===t?' selected':''}>${t}</option>`).join('');
    const wtSel=document.getElementById('filter-worktype'), cur2=wtSel.value;
    wtSel.innerHTML='<option value="">Все</option>'+FilterEngine.getWorkTypes().map(t=>`<option value="${t}"${cur2===t?' selected':''}>${t}</option>`).join('');
    const roleSel=document.getElementById('filter-role'), cur3=Array.isArray(state.filters.role)?'':roleSel.value;
    roleSel.innerHTML='<option value="">Все</option>'+FilterEngine.getRoles().map(r=>`<option value="${r}"${cur3===r?' selected':''}>${r}</option>`).join('');
    const asSel=document.getElementById('filter-assignee');
    if (asSel) {
      const curA=Array.isArray(state.filters.assignee)?'':asSel.value;
      asSel.innerHTML='<option value="">Все</option>'+FilterEngine.getAssignees().map(a=>`<option value="${a}"${curA===a?' selected':''}>${a}</option>`).join('');
    }
    const rpw=document.getElementById('preset-roles-wrap');
    if(rpw){
      const roles=FilterEngine.getRoles();
      const current=Array.isArray(state.filters.role)?state.filters.role:(state.filters.role?[state.filters.role]:[]);
      rpw.innerHTML='';
      const ms=Multiselect.create(current,(vals)=>{
        state.filters.role=vals.length?vals:'';
        document.getElementById('filter-role').value='';
        App.refreshCurrentSection();
      },()=>roles);
      ms.classList.add('preset-ms');
      rpw.appendChild(ms);
    }
    const paw=document.getElementById('preset-assignees-wrap');
    if (paw) {
      const assignees=FilterEngine.getAssignees();
      const current=Array.isArray(state.filters.assignee)?state.filters.assignee:(state.filters.assignee?[state.filters.assignee]:[]);
      paw.innerHTML='';
      const ms=Multiselect.create(current,(vals)=>{
        state.filters.assignee=vals.length?vals:'';
        const baseSel=document.getElementById('filter-assignee'); if (baseSel) baseSel.value='';
        App.refreshCurrentSection();
      },()=>assignees);
      ms.classList.add('preset-ms');
      paw.appendChild(ms);
    }
    const ptw=document.getElementById('preset-tags-wrap');
    if(ptw){
      const tags=[...new Set(state.rows.flatMap(r=>r.tags?String(r.tags).split('|').map(s=>s.trim()).filter(Boolean):[]))].sort();
      const current=Array.isArray(state.filters.tag)?state.filters.tag:(state.filters.tag?[state.filters.tag]:[]);
      ptw.innerHTML='';
      const ms=Multiselect.create(current,(vals)=>{
        state.filters.tag=vals.length?vals:'';
        App.refreshCurrentSection();
      },()=>tags);
      ms.classList.add('preset-ms');
      ptw.appendChild(ms);
    }
  },
};

// LLMAssistant extracted to ./app/llmAssistant.js (audit #7).

// Nav → app/nav.js (audit #18 decomposition). Imported at the top of this file.
// ============================================================
// APP SETTINGS
// ============================================================
// V18.1 P9 — extracted into ./app/appSettings.js (imported above).
// Re-exports on window done in the standard window.* block at file bottom.
// ============================================================

// Onboarding   extracted to ./app/onboarding.js   (audit #7).
// ActionLayer  extracted to ./app/actionLayer.js  (audit #7).
// JiraPulse    extracted to ./app/jiraPulse.js    (audit #7).

// ============================================================
// APP
// ============================================================

// Thin wrapper that injects orchestrator deps into the extracted splash.
// Lives here (not in init.js) so the deps object can capture the live
// App reference defined just below — circular import avoided.
function setupWelcomeSplash() {
  return _setupWelcomeSplash({
    Storage, RiskEngine, HistoryManager, RegistryView, App, state,
    isFirstRun, showWelcomeScreen, updateDemoBanner,
  });
}

const App = {
  init() {
    // Initialise the errors log FIRST so it captures any boot-time errors
    // from the rest of init (Storage.load failures, view-init exceptions,
    // etc.). Idempotent — the second pass on hot-reload no-ops.
    try {
      ErrorsLog.init();
      ErrorsLog.onChange(() => { try { updateErrorsBadge(); } catch (_) {} });
      // Initial badge paint reflects errors persisted across F5.
      requestAnimationFrame(() => { try { updateErrorsBadge(); } catch (_) {} });
    } catch (_) {}
    // V17 P2 (CRIT-5) — flush pending Storage.save before tab unload /
    // hide. Storage.save has 400 ms debounce; without these hooks any
    // edit within the last 400 ms before ⌘W is silently lost. Audit
    // 2026-05 (QA, B4 + system analyst, C2).
    try {
      window.addEventListener('beforeunload', () => {
        try { Storage.flushNow?.(); } catch (_) {}
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          try { Storage.flushNow?.(); } catch (_) {}
        }
      });
    } catch (_) {}
    setupWelcomeSplash();
    Storage.loadSettings();
    loadHistoryLog();
    // V11: kick off SQLite initialisation in the background. The promise is
    // intentionally NOT awaited here — App.init must not block on WASM load.
    // If it fails, mode silently falls back to localStorage. UI can still
    // show readiness via AppDataStore.status() in the settings panel.
    try { AppDataStore.init().catch(() => {}); } catch(_) {}
    syncColumnSettings();
    App.applyPresetsCollapsed();
    RegistryView.applyRowHeight();
    SidebarUI.init();
    ThemeUI.init();
    Nav.init({ App });
    FiltersUI.init();
    App.bindImports();
    App.bindExport();
    App.bindClear();
    App.bindSave();
    App.bindAddRow();
    App.bindUndoRedo();
    App.bindColToggle();
    App.bindRegistrySettings();
    App.bindGanttModes();
    App.bindTimelineModes();
    App.bindPodlozhkaModes();
    App.bindSummaryModes();
    App.bindColOrderReset();
    App.bindPodlozhkaGroup();
    App.bindFullscreenRegistry();
    App.bindFilterToggle();
    App.bindPresetsCollapse();
    App.bindEmployees();
    // V14: bindGantt2Controls removed with GanttV2 (B2)
    App.bindGanttPlanLock();   // V14 (B3 + B4)
    App.bindCrossTabStorageSync();
    App.bindFilesDropdown();
    AppSettings.init();
    Onboarding.init();
    // Expose openIntegrationsSettings globally so app-settings modal can call it
    window.openIntegrationsSettings = openIntegrationsSettings;
    // Hydrate integrations connection state from the server (source of truth
    // for tokens). Fixes "F5 token loss": when localStorage is empty but the
    // server has tokens (fresh browser / cleared site data / admin-provisioned
    // jira_config.json), the integrations UI used to show "не настроена" until
    // the user re-saved each one. Fire-and-forget; isConfigured() falls back
    // to localStorage if this never resolves. After hydration, re-render the
    // Integrations view so any "не настроен" pills update to the correct state.
    try {
      hydrateIntegrationsFromServer().then((cfg) => {
        if (!cfg) return;
        try {
          const sec = document.getElementById('section-integrations');
          if (sec && !sec.classList.contains('hidden')) IntegrationsView.render();
        } catch(_) {}
      }).catch(() => {});
    } catch(_) {}
    // V11 Onboarding
    initOnboardingUI({ goTo: (s) => Nav.goTo(s), showToast, notify });
    bindWelcomeButtons();
    // Override btn-onboarding to re-open the welcome screen.
    // V17 P12 (full-stack F-3 + designer §3 + sys-analyst minor) — previously
    // this called `resetOnboarding()` which wiped the entire `q2_onboarding_v1`
    // localStorage entry, including `mode` and `lastDatasetType`. That meant
    // `updateDemoBanner` would flash off, the «Вернуться к демо» affordance
    // disappeared, and any «I already chose setup mode» state was lost — all
    // so the welcome modal would re-appear. The welcome modal renders itself
    // unconditionally here; no state wipe needed.
    document.getElementById('btn-onboarding')?.addEventListener('click', () => {
      showWelcomeScreen();
    });
    LLMAssistant.init();
    // Initialise chat alerts & daily snapshot after state is ready
    try { takeSnapshot(); } catch(_) {}
    try { saveAlertBaseline(); } catch(_) {}
    try {
      if (state.llm) state.llm.alerts = buildAlerts();
      // Inject alert bar into chat messages panel on first open
      const fab = document.getElementById('assistant-fab');
      if (fab) {
        const _origClick = fab.onclick;
        document.getElementById('assistant-fab').addEventListener('click', () => {
          requestAnimationFrame(() => {
            const msgWrap = document.getElementById('assistant-messages');
            if (msgWrap && !document.getElementById('chat-alert-bar')) {
              const bar = document.createElement('div');
              bar.innerHTML = renderAlertBar(state.llm?.alerts || []);
              if (bar.firstChild) msgWrap.insertBefore(bar.firstChild, msgWrap.firstChild);
            }
          });
        }, { once: false, capture: false });
      }
    } catch(_) {}
    BulkEditPanel.bindUI();
    App.bindSimMode();
    // V17 P10 (sys-analyst §4) — restore sim-mode visual state on boot so the
    // banner/yellow icon match `state.simMode` from localStorage.
    SimMode.applyFromState();
    App.bindInsightActions();
    ActionLayer.init();
    document.getElementById('modal-kpi-close').addEventListener('click',()=>closeModal(document.getElementById('modal-kpi')));
    document.getElementById('modal-kpi').addEventListener('click',e=>{if(e.target===document.getElementById('modal-kpi'))closeModal(document.getElementById('modal-kpi'));});

    const saved=Storage.load();
    // Skip the standalone "Найдены локальные изменения" modal entirely if the
    // welcome splash absorbed the restore decision into its own card.
    if(saved&&saved.rows&&saved.rows.length>0 && !welcomeHandledRestore()){
      const meta=document.getElementById('modal-restore-meta');
      meta.textContent=`Сохранено ${saved.rows.length} строк от ${new Date(saved.savedAt).toLocaleString('ru')}.`;
      document.getElementById('modal-restore').classList.remove('hidden');
      document.getElementById('btn-restore-yes').onclick=()=>{
        Storage.restore(saved); RiskEngine.computeAll();
        HistoryManager.clear();
        RegistryView.applyRowHeight();
        closeModal(document.getElementById('modal-restore'));
        App.populateFilterDropdowns(); App.renderSection('dashboard'); App.updateTopbarBadge();
        updateDemoBanner();
        setTimeout(()=>{ if(state.activeSection==='registry') RegistryView.autoFitColWidths(); },150);
      };
      document.getElementById('btn-restore-no').onclick=()=>{
        Storage.clear(); HistoryManager.clear(); closeModal(document.getElementById('modal-restore'));
        App.renderSection('dashboard');
        // Skip auto-onboarding if first-run splash is still on screen — it will chain after fade-out.
        if (isFirstRun() && !document.getElementById('welcomeOverlay')) showWelcomeScreen();
      };
    } else {
      App.renderSection('dashboard');
      // Show onboarding welcome on first run only when first-run splash isn't on screen
      // (otherwise the splash's "Погнали" button chains into onboarding after its fade-out).
      if (isFirstRun() && !document.getElementById('welcomeOverlay')) {
        setTimeout(() => showWelcomeScreen(), 300);
      } else if (!isFirstRun()) {
        updateDemoBanner();
      }
    }
    App.populateFilterDropdowns();
    App.updateTopbarBadge();
    // V17 P10 (designer §1 + sys-analyst §3) — brand click/Enter → dashboard.
    // Previously the brand was a dead label.
    const brand = document.getElementById('topbar-brand');
    if (brand && !brand._q2BrandBound) {
      brand._q2BrandBound = true;
      const goHome = () => { try { App.renderSection('dashboard'); } catch(_) {} };
      brand.addEventListener('click', goHome);
      brand.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); }
      });
    }
  },
  bindImports() {
    // V15: JSON — атомарный round-trip-формат (см. dataStore JSONImport).
    // Обрабатываем первым: его confirm-диалог должен сработать раньше,
    // если пользователь по ошибке выбрал не тот файл.
    document.getElementById('input-json')?.addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const fname = f.name || 'JSON';
      const r = new FileReader();
      r.onload = ev => {
        try {
          JSONImport.import(ev.target.result);
          App.populateFilterDropdowns();
          showPostLoadInsights(state.rows);
          HistoryLog.data('import_json', `Импорт JSON: ${fname}`, { count: state.rows.length, target: fname, source: 'json' });
        } catch (err) {
          // JSONImport.import() уже сам показывает alert + пишет в ErrorsLog;
          // но catch здесь страхует от unexpected throws.
          showToast(`Не удалось импортировать JSON: ${err?.message || err}`, 'error', 3500);
        }
        e.target.value = '';
      };
      r.readAsText(f, 'utf-8');
    });
    document.getElementById('input-xlsx').addEventListener('change',e=>{
      const f=e.target.files[0]; if(!f)return;
      const fname=f.name||'XLSX';
      const r=new FileReader(); r.onload=ev=>{
        XLSXImporter.import(new Uint8Array(ev.target.result));
        App.populateFilterDropdowns(); e.target.value='';
        showPostLoadInsights(state.rows);
        HistoryLog.data('import_xlsx', `Импорт XLSX: ${fname}`, { count: state.rows.length, target: fname, source: 'xlsx' });
      }; r.readAsArrayBuffer(f);
    });
    document.getElementById('input-csv').addEventListener('change',e=>{
      const f=e.target.files[0]; if(!f)return;
      const fname=f.name||'CSV';
      const r=new FileReader(); r.onload=ev=>{
        CSV.import(ev.target.result);
        App.populateFilterDropdowns(); e.target.value='';
        showPostLoadInsights(state.rows);
        HistoryLog.data('import_csv', `Импорт CSV: ${fname}`, { count: state.rows.length, target: fname, source: 'csv' });
      }; r.readAsText(f,'utf-8');
    });
    const csvUpdate=document.getElementById('input-csv-update');
    if(csvUpdate){
      csvUpdate.addEventListener('change',e=>{
        const f=e.target.files[0]; if(!f)return;
        const fname=f.name||'CSV update';
        const r=new FileReader();
        r.onload=ev=>{
          CSV.importUpdate(ev.target.result); App.populateFilterDropdowns(); e.target.value='';
          HistoryLog.data('import_csv_update', `CSV update: ${fname}`, { target: fname, source: 'csv-update' });
        };
        r.readAsText(f,'utf-8');
      });
    }
    // XLSX update — merge by Epic key. Existing rows kept verbatim, new
    // epics appended. Settings/columns untouched (Storage.save persists rows
    // separately from settings).
    const xlsxUpdate = document.getElementById('input-xlsx-update');
    if (xlsxUpdate) {
      xlsxUpdate.addEventListener('change', e => {
        const f = e.target.files[0]; if (!f) return;
        const fname = f.name || 'XLSX update';
        const r = new FileReader();
        r.onload = ev => {
          XLSXImporter.importUpdate(new Uint8Array(ev.target.result));
          App.populateFilterDropdowns(); e.target.value = '';
          HistoryLog.data('import_xlsx_update', `XLSX update: ${fname}`, { target: fname, source: 'xlsx-update' });
        };
        r.readAsArrayBuffer(f);
      });
    }
  },
  bindExport() {
    // V17 P9 (QA 1.5) — commit pending inline-edits before export. Cell
    // inputs commit on `change` (which fires on blur). If user types into
    // a cell and clicks «Export» without losing focus first, the typed
    // value never reaches state.rows → silent data loss in the file. Forcing
    // blur drains the pending value through the change-handler. Same trick
    // used for JSON / XLSX paths below. Audit 2026-05-V17.
    const flushPendingEdits = () => {
      try { document.activeElement?.blur?.(); } catch (_) {}
      try { Storage.flushNow?.(); } catch (_) {}
    };
    const exportCsvFn = async () => {
      flushPendingEdits();
      if(!state.rows.length){alert('Нет данных');return;}
      try{
        await CSV.export();
        HistoryLog.data('export_csv', `Скачать CSV (${state.rows.length} строк)`, { count: state.rows.length });
      }
      catch(e){ console.error(e); showToast('Не удалось экспортировать CSV','error',2600); }
    };
    document.getElementById('btn-export-csv')?.addEventListener('click', exportCsvFn);

    // V15: JSON export — atomic round-trip format.
    document.getElementById('btn-export-json')?.addEventListener('click', () => {
      flushPendingEdits();
      try {
        JSONExport.download();
        HistoryLog.data('export_json', `Скачать JSON (${state.rows.length} строк, ${state.employees.length} сотрудников)`,
          { rows: state.rows.length, employees: state.employees.length });
      } catch (e) {
        console.error(e);
        showToast('Не удалось экспортировать JSON', 'error', 2600);
      }
    });

    // V15: Gantt → standalone HTML viewer for sharing.
    document.getElementById('btn-export-gantt-html')?.addEventListener('click', async () => {
      try {
        await GanttHTMLExport.download();
        HistoryLog.data('export_gantt_html', `Выгрузка Ганта в HTML (${state.rows.length} строк)`, { rows: state.rows.length });
      } catch (e) {
        console.error(e);
        showToast('Не удалось экспортировать Гант: ' + (e?.message || e), 'error', 3000);
      }
    });

    // XLSX export — round-trip-safe: same headers as XLSXImporter.import,
    // one sheet per team. No extra columns beyond the import template.
    document.getElementById('btn-export-xlsx')?.addEventListener('click', () => {
      flushPendingEdits();
      if (!state.rows.length) { alert('Нет данных'); return; }
      try {
        XLSXImporter.export();
        HistoryLog.data('export_xlsx', `Скачать XLSX (${state.rows.length} строк)`, { count: state.rows.length });
      } catch (e) {
        console.error(e); showToast('Не удалось экспортировать XLSX', 'error', 2600);
      }
    });
  },
  bindClear() {
    document.getElementById('btn-clear-storage').addEventListener('click',()=>{
      if(confirm('Очистить все данные и настройки?')){
        HistoryManager.checkpoint('очистка данных');
        const before=state.rows.length;
        Storage.clear(); state.rows=[]; state.diagnostics={sources:[],sheets:[],rowsPerSheet:{},detectedColumns:{},missingColumns:{},warnings:[],registryCount:0,csvImportCount:0,localStorageCount:0};
        state.employees=[];
        App.populateFilterDropdowns(); App.refreshAll(); App.updateTopbarBadge();
        HistoryLog.data('clear_all', `Очистка всех данных (было ${before} строк)`, { count: before, source: 'topbar' });
      }
    });
  },
  bindSave() {
    const doSave = (source) => {
      // V17 P10 (QA §1.1) — guard на пустой state, иначе toast «✓ Сохранено»
      // вводит в заблуждение когда нечего сохранять.
      if (!state.rows.length) {
        showToast?.('Нет данных для сохранения', 'info', 1600);
        return;
      }
      forceSave();
      HistoryLog.data('save', `Сохранение всех данных (${state.rows.length} строк)`, { count: state.rows.length, source });
    };
    document.getElementById('btn-save').addEventListener('click', () => doSave('topbar'));
    // V17 P10 (designer §1, sys-analyst §4 consensus) — Cmd/Ctrl+S → save.
    // Skip when typing into editable elements; preventDefault so the
    // browser's «Save Page» dialog does NOT hijack. Idempotent guard
    // prevents double-binding on hot-reload / re-init paths.
    if (!document._q2SaveHotkeyBound) {
      document._q2SaveHotkeyBound = true;
      document.addEventListener('keydown', (e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (!mod || (e.key !== 's' && e.key !== 'S')) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        doSave('hotkey');
      });
    }
  },
  bindAddRow() { document.getElementById('btn-add-row').addEventListener('click',()=>{
    RegistryView.addRow();
    HistoryLog.data('row_add', 'Добавлена пустая строка в реестр', { source: 'registry' });
  }); },
  bindUndoRedo() {
    // Bind every undo/redo button (topbar + Gantt header) — classes catch both,
    // ID kept for primary topbar one. forEach is no-op if collection empty.
    document.querySelectorAll('.btn-undo-clone, #btn-undo').forEach(btn =>
      btn.addEventListener('click', () => HistoryManager.undo()));
    document.querySelectorAll('.btn-redo-clone, #btn-redo').forEach(btn =>
      btn.addEventListener('click', () => HistoryManager.redo()));
    document.addEventListener('keydown',e=>{
      const target=e.target;
      const mod=e.ctrlKey||e.metaKey;
      if(!mod) return;
      // Allow undo/redo in registry, gantt, kanban, timeline, employees, podlozhka
      const ALLOWED = ['registry','gantt','kanban','timeline','employees','podlozhka'];
      const inAllowedSection = ALLOWED.includes(state.activeSection);
      const containerHit = ALLOWED.some(s => {
        const el = document.getElementById('section-'+s);
        return el && target instanceof Node && el.contains(target);
      });
      if (!inAllowedSection && !containerHit) return;
      // Don't hijack while typing in inputs/contenteditable (textareas, edit cells)
      const tag = (target && target.tagName) || '';
      const isEditing = ['INPUT','TEXTAREA','SELECT'].includes(tag) || target?.isContentEditable;
      if (isEditing) return;
      if(e.key.toLowerCase()==='z'&&!e.shiftKey){e.preventDefault();HistoryManager.undo();return;}
      if((e.key.toLowerCase()==='z'&&e.shiftKey)||e.key.toLowerCase()==='y'){e.preventDefault();HistoryManager.redo();}
    });
    HistoryManager.syncButtons();
  },
  bindColToggle() {
    document.getElementById('btn-toggle-cols').addEventListener('click',()=>{
      const p=document.getElementById('col-toggle-panel'); p.classList.toggle('hidden'); if(!p.classList.contains('hidden'))RegistryView.renderColTogglePanel();
    });
  },
  bindRegistrySettings() {
    document.getElementById('btn-registry-settings').addEventListener('click',()=>{
      const p=document.getElementById('registry-settings-panel');
      p.classList.toggle('hidden');
      if(!p.classList.contains('hidden')) RegistryView.renderSettingsPanel();
    });
  },
  bindColOrderReset() {
    document.getElementById('btn-reset-col-order').addEventListener('click',()=>{
      HistoryManager.checkpoint('сброс порядка столбцов');
      state.colOrder=REGISTRY_COLS.map(c=>c.key);
      state.colWidths={};
      syncColumnSettings();
      Storage.save();
      RegistryView.render();
    });
  },
  bindGanttModes() {
    // V15: single-mode now. The «Детальный по задачам» button was a tab-
    // toggle for one tab — the user removed it, since 1-of-1 tabs are just
    // visual noise. We still keep `state.ganttMode = 'detailedTasks'` to
    // migrate old persisted values silently (compact / detailed / epics /
    // arrows / ultra / arrowsNew → all map to detailedTasks).
    state.ganttMode = 'detailedTasks';
    // Stub kept so other call-sites that expect `App.syncGanttModeUi` to
    // exist don't ReferenceError. No DOM work needed anymore.
    App.syncGanttModeUi = () => {};
  },
  bindTimelineModes() {
    const summaryBtn=document.getElementById('timeline-mode-summary');
    const detailedBtn=document.getElementById('timeline-mode-detailed');
    if(!summaryBtn||!detailedBtn) return;
    const sync=()=>{
      summaryBtn.classList.toggle('active',state.timelineMode!=='detailed');
      detailedBtn.classList.toggle('active',state.timelineMode==='detailed');
    };
    summaryBtn.addEventListener('click',()=>{ state.timelineMode='summary'; sync(); if(state.activeSection==='timeline')TimelineView.render(); });
    detailedBtn.addEventListener('click',()=>{ state.timelineMode='detailed'; sync(); if(state.activeSection==='timeline')TimelineView.render(); });
    sync();
  },
  bindSummaryModes() {
    // V17.1 G1 — представление «Совсем красиво» удалено вместе с переключателем.
    //   Любое значение state.summaryMode теперь нормализуется в 'brief'
    //   (мигрирует старые сохранённые настройки superBeautiful → brief).
    if (state.summaryMode !== 'brief') {
      state.summaryMode = 'brief';
      try { Storage.save(); } catch(_) {}
    }
  },
  bindPodlozhkaModes() {
    const summary=document.getElementById('podlozhka-mode-summary');
    const detailed=document.getElementById('podlozhka-mode-detailed');
    if(!summary||!detailed) return;
    const sync=()=>{
      summary.classList.toggle('active',state.podlozhkaMode!=='detailed');
      detailed.classList.toggle('active',state.podlozhkaMode==='detailed');
    };
    summary.addEventListener('click',()=>{
      state.podlozhkaMode='summary';
      Storage.save();
      sync();
      if(state.activeSection==='podlozhka') PodlozhkaView.render();
    });
    detailed.addEventListener('click',()=>{
      state.podlozhkaMode='detailed';
      Storage.save();
      sync();
      if(state.activeSection==='podlozhka') PodlozhkaView.render();
    });
    sync();
  },
  bindPodlozhkaGroup() {
    const sel=document.getElementById('podlozhka-group');
    if(!sel) return;
    sel.value=state.podlozhkaGroup||'team';
    sel.addEventListener('change',e=>{ state.podlozhkaGroup=e.target.value; if(state.activeSection==='podlozhka')PodlozhkaView.render(); });
  },
  bindFullscreenRegistry() {
    const btn=document.getElementById('btn-fullscreen-registry');
    btn.addEventListener('click',()=>{
      document.body.classList.toggle('registry-fullscreen');
      btn.textContent=document.body.classList.contains('registry-fullscreen')?'✕ Выйти':'⛶';
      btn.title=document.body.classList.contains('registry-fullscreen')?'Выйти из полного экрана':'Полный экран';
    });
    // V15 (audit #1, fullstack Critical 1) — idempotency guard. Without
    // it, every section navigation that re-runs `bindRegistryFullscreen`
    // would install another global keydown listener; over a session
    // these accumulate linearly into a memory + CPU drain.
    if (!document._q2RegistryEscBound) {
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.body.classList.contains('registry-fullscreen')) {
          document.body.classList.remove('registry-fullscreen');
          const fsBtn = document.getElementById('btn-fullscreen-registry');
          if (fsBtn) fsBtn.textContent = '⛶';
        }
      });
      document._q2RegistryEscBound = true;
    }
  },
  bindFilterToggle() {
    const btn      = document.getElementById('btn-toggle-filters');
    const backdrop = document.getElementById('filters-backdrop');
    const drawer   = document.getElementById('global-filters-bar');
    if (!btn) return;

    const isOpen = () => document.body.classList.contains('filters-open');
    const setOpen = (open) => {
      document.body.classList.toggle('filters-open', !!open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    const close = () => setOpen(false);

    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!isOpen()); });
    backdrop?.addEventListener('click', close);

    // Esc closes the drawer.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) close();
    });

    // Click outside the drawer (anywhere not in drawer / not the button) closes it.
    document.addEventListener('mousedown', (e) => {
      if (!isOpen()) return;
      if (drawer && drawer.contains(e.target)) return;
      if (btn.contains(e.target)) return;
      close();
    });

    // Strip the legacy `filters-hidden` class if it leaked from prior versions.
    document.body.classList.remove('filters-hidden');
  },
  bindPresetsCollapse() {
    const btn=document.getElementById('btn-toggle-presets');
    if(!btn) return;
    btn.addEventListener('click',()=>{
      state.presetsCollapsed=!state.presetsCollapsed;
      App.applyPresetsCollapsed();
      Storage.save();
    });
  },
  applyPresetsCollapsed() {
    document.body.classList.toggle('presets-collapsed',!!state.presetsCollapsed);
  },
  bindEmployees() {
    const addBtn=document.getElementById('btn-add-employee');
    if(addBtn) addBtn.addEventListener('click',()=>{
      // V15 (audit#1, system H5): checkpoint so misclicks can be Ctrl+Z'd.
      HistoryManager.checkpoint('добавить сотрудника');
      state.employees.push(EmployeeFactory.create({sourceType:'manual'}));
      Storage.save();
      App.populateFilterDropdowns();
      if(state.activeSection==='employees') EmployeesView.render();
      showToast('Сотрудник добавлен');
    });
    const importCsv=document.getElementById('input-employees-csv');
    if(importCsv){
      importCsv.addEventListener('change',e=>{
        const f=e.target.files[0]; if(!f)return;
        const r=new FileReader();
        r.onload=ev=>{ EmployeesView.importCSV(ev.target.result); e.target.value=''; };
        r.readAsText(f,'utf-8');
      });
    }
    const importXlsx=document.getElementById('input-employees-xlsx');
    if(importXlsx){
      importXlsx.addEventListener('change',e=>{
        const f=e.target.files[0]; if(!f)return;
        const r=new FileReader();
        r.onload=ev=>{ EmployeesView.importXLSX(new Uint8Array(ev.target.result)); e.target.value=''; };
        r.readAsArrayBuffer(f);
      });
    }
    const tmplBtn=document.getElementById('btn-employees-template');
    if(tmplBtn){
      tmplBtn.addEventListener('click',()=>{
        if (typeof window.XLSX==='undefined') {
          showToast('Библиотека XLSX не загружена','error',3000); return;
        }
        const headers=['ФИО','Роль','Команда','Дни овертайма','Готов работать в будни','Комментарий по будням'];
        const example=['Иванов Иван','Backend','Платформа','2026-05-15, 2026-05-22','Да','Только до 19:00'];
        const ws=window.XLSX.utils.aoa_to_sheet([headers, example]);
        ws['!cols']=headers.map(h=>({wch: Math.max(14, Math.min(28, h.length+6))}));
        const wb=window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, 'Сотрудники');
        window.XLSX.writeFile(wb, 'employees_template.xlsx');
        showToast('Шаблон сохранён');
      });
    }

    // V14 (B3 + B4): plan-lock controls. Visibility flips based on
    // `state.planLocked` and `state.ganttEditMode`. State persists via
    // SETTINGS_KEY (see dataStore.js) so the lock survives F5.
    // (Logic helper bindings are below — bindGanttPlanLock).

    // V14 (A2): «Удалить всех» — destructive action gated by a typed
    // confirmation. HistoryManager.checkpoint preserves the previous state
    // for undo, so the worst case is "press Ctrl+Z".
    const delAllBtn=document.getElementById('btn-employees-delete-all');
    if (delAllBtn) {
      delAllBtn.addEventListener('click',()=>{
        const n=state.employees.length;
        if (!n) { showToast('Список уже пуст','info',1800); return; }
        const typed=prompt(
          `Удалить всех сотрудников (${n} шт.)? Это действие можно отменить через Ctrl+Z.\n\n`+
          `Введите УДАЛИТЬ для подтверждения:`,
          ''
        );
        if (typed == null) return;                 // user cancelled
        if (typed.trim().toUpperCase() !== 'УДАЛИТЬ') {
          showToast('Подтверждение не совпало — действие отменено','info',2400);
          return;
        }
        HistoryManager.checkpoint(`удаление всех сотрудников (${n})`);
        state.employees=[];
        Storage.save();
        App.populateFilterDropdowns();
        if (state.activeSection==='employees') EmployeesView.render();
        showToast(`Удалено ${n} сотрудников`,'success',2200);
        try { window.HistoryLog?.data?.('employees_delete_all', `Удалено ${n} сотрудников`, { count:n }); } catch(_) {}
      });
    }
  },

  /* ── V14 (B3 + B4 + B5): Gantt plan-lock controls ──────────
     state.planLocked = null | { at: ISOString, by: 'user' }
     state.ganttEditMode = boolean
     The drop handler in views/gantt.js consults `App.requireMoveComment()`
     before performing the actual move; if it returns a Promise<string> that
     resolves to a non-empty comment, the move proceeds. If the user cancels,
     the move is aborted. */
  bindGanttPlanLock() {
    const fmtDate = (iso) => {
      try { return new Date(iso).toLocaleString('ru', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
      catch(_) { return iso || ''; }
    };
    const renderHeader = () => {
      const status     = document.getElementById('gantt-lock-status');
      const lockBtn    = document.getElementById('btn-gantt-lock-plan');
      const editBtn    = document.getElementById('btn-gantt-edit-mode');
      const unlockBtn  = document.getElementById('btn-gantt-unlock-plan');
      if (!status || !lockBtn || !editBtn || !unlockBtn) return;

      const locked    = !!state.planLocked;
      const editMode  = !!state.ganttEditMode;

      lockBtn.classList.toggle('hidden',  locked);
      editBtn.classList.toggle('hidden',  !locked);
      unlockBtn.classList.toggle('hidden', !locked);
      status.classList.toggle('hidden',   !locked);

      if (locked) {
        const ts = fmtDate(state.planLocked.at);
        if (editMode) {
          status.innerHTML = `<span class="gantt-lock-badge gantt-lock-badge-edit">✏ Режим редактирования (без фиксации переносов)</span>`;
          editBtn.textContent = '✓ Выйти из режима редактирования';
        } else {
          status.innerHTML = `<span class="gantt-lock-badge">🔒 План зафиксирован · ${ts}</span>`;
          editBtn.textContent = '✏ Режим редактирования';
        }
      }
    };
    App._renderGanttPlanLockHeader = renderHeader;
    renderHeader();

    document.getElementById('btn-gantt-lock-plan')?.addEventListener('click', () => {
      // V15 Spine 2026-04-30 — full modal with date + time pickers.
      // Replaces the bare `prompt()` flow that looked off-brand on a styled
      // app. Default values = «right now», so the common case (lock=now)
      // is one click away — but we let the user backdate to the actual
      // sign-off moment (e.g. yesterday's ретро).
      App.openGanttLockPlanModal().then(picked => {
        if (!picked) return;                            // cancelled
        const { iso, label } = picked;
        state.planLocked = { at: iso, by: 'user', lockDate: label };
        state.ganttEditMode = false;
        Storage.save();
        renderHeader();
        showToast(`План зафиксирован на ${label} — переносы теперь требуют комментарий`, 'success', 3200);
        try { window.HistoryLog?.data?.('plan_lock', `План зафиксирован на ${label}`); } catch(_) {}
      });
    });

    document.getElementById('btn-gantt-unlock-plan')?.addEventListener('click', () => {
      if (!confirm('Снять фиксацию плана? Переносы снова будут без обязательного комментария.')) return;
      state.planLocked = null;
      state.ganttEditMode = false;
      Storage.save();
      renderHeader();
      showToast('Фиксация плана снята', 'info', 2200);
      try { window.HistoryLog?.data?.('plan_unlock', 'Фиксация плана снята'); } catch(_) {}
    });

    document.getElementById('btn-gantt-edit-mode')?.addEventListener('click', () => {
      state.ganttEditMode = !state.ganttEditMode;
      Storage.save();
      renderHeader();
      const msg = state.ganttEditMode
        ? 'Режим редактирования включён — переносы пока без комментариев'
        : 'Вышли из режима редактирования — переносы снова требуют комментарий';
      showToast(msg, 'info', 2400);
    });
  },

  /** V14 (B5): called by Gantt drop handler before performing a cross-bucket
   *  move. If the plan is locked AND edit mode is OFF, opens the comment
   *  modal and returns a Promise<string> with the user's comment. Returns
   *  Promise<null> if cancelled. If the lock is not active, resolves with
   *  empty string immediately (no modal). */
  requireMoveComment({ rowKey='', srcCol='', dstCol='', wt='' }={}) {
    if (!state.planLocked || state.ganttEditMode) return Promise.resolve('');
    const overlay = document.getElementById('modal-gantt-move');
    const summary = document.getElementById('modal-gantt-move-summary');
    const ta      = document.getElementById('modal-gantt-move-comment');
    const okBtn   = document.getElementById('modal-gantt-move-ok');
    const noBtn   = document.getElementById('modal-gantt-move-cancel');
    const xBtn    = document.getElementById('modal-gantt-move-close');
    if (!overlay || !ta || !okBtn) return Promise.resolve('');
    // V15 (audit #1, system Critical 4 + fullstack Critical 4 + QA Critical 1):
    // re-entry guard. Without it, opening this modal a second time (e.g.,
    // user drops another pill before resolving the first) wires duplicate
    // listeners onto the SAME OK button. Both Promises would resolve on a
    // single click → wrong comment lands on wrong row in `transferComments`.
    if (overlay.dataset.busy === '1') return Promise.resolve(null);
    overlay.dataset.busy = '1';

    summary.textContent = `${rowKey || 'Задача'} · ${wt} · ${srcCol} → ${dstCol}`;
    ta.value = '';
    okBtn.disabled = true;
    overlay.classList.remove('hidden');
    setTimeout(() => ta.focus(), 50);

    return new Promise(resolve => {
      const cleanup = () => {
        ta.removeEventListener('input', onInput);
        okBtn.removeEventListener('click', onOk);
        noBtn.removeEventListener('click', onCancel);
        xBtn ?.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey);
        overlay.dataset.busy = '0';
        overlay.classList.add('hidden');
      };
      const onInput  = () => { okBtn.disabled = !ta.value.trim(); };
      const onOk     = () => { if (okBtn.disabled) return; const v = ta.value.trim(); cleanup(); resolve(v || null); };
      const onCancel = () => { cleanup(); resolve(null); };
      // V15 (audit #1, QA Critical 2): ESC closes modal as null-result.
      const onKey    = (e) => { if (e.key === 'Escape') onCancel(); };
      ta.addEventListener('input', onInput);
      okBtn.addEventListener('click', onOk);
      noBtn.addEventListener('click', onCancel);
      xBtn ?.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey);
    });
  },

  /** V15 Spine 2026-04-30: open the «Зафиксировать план» modal with date +
   *  time pickers. Resolves with `{ iso, label }` on confirm, null on
   *  cancel. `iso` is full ISO timestamp; `label` is human-readable
   *  «DD.MM.YYYY HH:MM» for toast / history-log. Defaults = right now.
   *  Re-entry guard via `dataset.busy` mirrors `requireMoveComment`. */
  openGanttLockPlanModal() {
    const overlay = document.getElementById('modal-gantt-lock');
    const dateEl  = document.getElementById('modal-gantt-lock-date');
    const timeEl  = document.getElementById('modal-gantt-lock-time');
    const okBtn   = document.getElementById('modal-gantt-lock-ok');
    const noBtn   = document.getElementById('modal-gantt-lock-cancel');
    const xBtn    = document.getElementById('modal-gantt-lock-close');
    if (!overlay || !dateEl || !timeEl || !okBtn) return Promise.resolve(null);
    if (overlay.dataset.busy === '1') return Promise.resolve(null);
    overlay.dataset.busy = '1';

    // Pre-fill «right now» (local time — the user thinks in their
    // timezone, so don't surprise them with UTC offsets in the picker).
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    dateEl.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    timeEl.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    overlay.classList.remove('hidden');
    setTimeout(() => dateEl.focus(), 50);

    return new Promise(resolve => {
      const cleanup = () => {
        okBtn.removeEventListener('click', onOk);
        noBtn.removeEventListener('click', onCancel);
        xBtn?.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey);
        overlay.dataset.busy = '0';
        overlay.classList.add('hidden');
      };
      const onOk = () => {
        const d = String(dateEl.value || '').trim();
        const t = String(timeEl.value || '00:00').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          showToast('Заполните дату', 'error', 2200); return;
        }
        const parsed = new Date(`${d}T${t}:00`);
        if (Number.isNaN(parsed.getTime())) {
          showToast('Неверная дата/время', 'error', 2200); return;
        }
        const [yyyy, mm, dd] = d.split('-');
        const label = `${dd}.${mm}.${yyyy} ${t}`;
        cleanup();
        resolve({ iso: parsed.toISOString(), label });
      };
      const onCancel = () => { cleanup(); resolve(null); };
      const onKey = (e) => {
        if (e.key === 'Escape') onCancel();
        else if (e.key === 'Enter' && (e.target === dateEl || e.target === timeEl)) onOk();
      };
      okBtn.addEventListener('click', onOk);
      noBtn.addEventListener('click', onCancel);
      xBtn?.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey);
    });
  },

  /** V14 (B7): open the «Завершить задачу» modal. Returns
   *  Promise<{date:string, comment:string}|null> — null on cancel.
   *  Date is required (default today). */
  openGanttCompleteModal({ summary='' }={}) {
    const overlay = document.getElementById('modal-gantt-complete');
    const summaryEl = document.getElementById('modal-gantt-complete-summary');
    const dateEl    = document.getElementById('modal-gantt-complete-date');
    const cmtEl     = document.getElementById('modal-gantt-complete-comment');
    const okBtn     = document.getElementById('modal-gantt-complete-ok');
    const noBtn     = document.getElementById('modal-gantt-complete-cancel');
    const xBtn      = document.getElementById('modal-gantt-complete-close');
    if (!overlay || !dateEl || !okBtn) return Promise.resolve(null);
    if (overlay.dataset.busy === '1') return Promise.resolve(null);   // V15 audit#1 — re-entry guard
    overlay.dataset.busy = '1';
    summaryEl.textContent = summary || '';
    const today = new Date().toISOString().slice(0, 10);
    dateEl.value = today;
    cmtEl.value  = '';
    overlay.classList.remove('hidden');
    setTimeout(() => dateEl.focus(), 50);
    return new Promise(resolve => {
      const cleanup = () => {
        okBtn.removeEventListener('click', onOk);
        noBtn.removeEventListener('click', onCancel);
        xBtn ?.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey);
        overlay.dataset.busy = '0';
        overlay.classList.add('hidden');
      };
      const onOk     = () => {
        const date = (dateEl.value || '').trim();
        if (!date) { showToast('Укажите дату фактического завершения','error',2200); return; }
        // V15 (audit#1, QA M6): reject invalid dates ("2026-13-99" etc.)
        const parsed = new Date(date);
        if (isNaN(parsed.getTime())) { showToast('Некорректная дата','error',2200); return; }
        cleanup();
        resolve({ date, comment: (cmtEl.value || '').trim() });
      };
      const onCancel = () => { cleanup(); resolve(null); };
      const onKey    = (e) => { if (e.key === 'Escape') onCancel(); };
      okBtn.addEventListener('click', onOk);
      noBtn.addEventListener('click', onCancel);
      xBtn ?.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey);
    });
  },

  /** V14 (B6.2): open «Установить даты работ» modal. Returns
   *  Promise<{start:string, end:string}|null>. Both fields optional —
   *  caller decides what to do with empty values. */
  openGanttDatesModal({ summary='', start='', end='' }={}) {
    const overlay  = document.getElementById('modal-gantt-dates');
    const summaryEl= document.getElementById('modal-gantt-dates-summary');
    const startEl  = document.getElementById('modal-gantt-dates-start');
    const endEl    = document.getElementById('modal-gantt-dates-end');
    const okBtn    = document.getElementById('modal-gantt-dates-ok');
    const noBtn    = document.getElementById('modal-gantt-dates-cancel');
    const xBtn     = document.getElementById('modal-gantt-dates-close');
    if (!overlay || !okBtn) return Promise.resolve(null);
    if (overlay.dataset.busy === '1') return Promise.resolve(null);   // V15 audit#1 — re-entry guard
    overlay.dataset.busy = '1';
    summaryEl.textContent = summary || '';
    startEl.value = start || '';
    endEl.value   = end   || '';
    overlay.classList.remove('hidden');
    return new Promise(resolve => {
      const cleanup = () => {
        okBtn.removeEventListener('click', onOk);
        noBtn.removeEventListener('click', onCancel);
        xBtn ?.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey);
        overlay.dataset.busy = '0';
        overlay.classList.add('hidden');
      };
      const onOk     = () => {
        const s = (startEl.value || '').trim();
        const e = (endEl.value   || '').trim();
        // V15 (audit#1, QA M6): reject invalid date strings.
        if (s && isNaN(new Date(s).getTime())) { showToast('Некорректная дата начала','error',2400); return; }
        if (e && isNaN(new Date(e).getTime())) { showToast('Некорректная дата завершения','error',2400); return; }
        if (s && e && new Date(s) > new Date(e)) {
          showToast('Дата начала позже даты завершения','error',2400); return;
        }
        cleanup();
        resolve({ start: s, end: e });
      };
      const onCancel = () => { cleanup(); resolve(null); };
      const onKey    = (ev) => { if (ev.key === 'Escape') onCancel(); };
      okBtn.addEventListener('click', onOk);
      noBtn.addEventListener('click', onCancel);
      xBtn ?.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey);
    });
  },

  /** V14 (B6.1 + B6.1.1): open «Назначить исполнителя» picker. Returns
   *  Promise<employee|null>. Employees filtered by role-tag overlap with
   *  `taskTags`; if `requireOtDays` is true (task is in OT column), also
   *  filters to those with non-empty `overtimeDays`. */
  openGanttAssignModal({ summary='', taskTags=[], requireOtDays=false }={}) {
    const overlay = document.getElementById('modal-gantt-assign');
    const summaryEl = document.getElementById('modal-gantt-assign-summary');
    const searchEl  = document.getElementById('modal-gantt-assign-search');
    const hintEl    = document.getElementById('modal-gantt-assign-hint');
    const listEl    = document.getElementById('modal-gantt-assign-list');
    const noBtn     = document.getElementById('modal-gantt-assign-cancel');
    const xBtn      = document.getElementById('modal-gantt-assign-close');
    if (!overlay || !listEl) return Promise.resolve(null);
    if (overlay.dataset.busy === '1') return Promise.resolve(null);   // V15 audit#1 — re-entry guard
    overlay.dataset.busy = '1';

    const splitTags = (raw) => String(raw||'').split(/[|,]/).map(s=>s.trim().toLowerCase()).filter(Boolean);
    const tagSet = new Set(taskTags.map(t => String(t||'').trim().toLowerCase()).filter(Boolean));

    // Compute filtered candidate list from current state.
    const all = state.employees || [];
    let strict = all.filter(e => {
      if (requireOtDays && !(Array.isArray(e.overtimeDays) && e.overtimeDays.length)) return false;
      if (!tagSet.size) return true;     // no tags on the row → no role filter
      const empRoles = new Set(splitTags(e.roles));
      // Role-overlap: ANY shared tag wins.
      for (const r of empRoles) if (tagSet.has(r)) return true;
      return false;
    });
    let candidates = strict;
    let widened = false;
    if (!candidates.length && tagSet.size) {
      // Fall back to all (with OT-only filter still applied) so the user
      // isn't stuck with an empty picker because role-tags don't match.
      candidates = all.filter(e => !requireOtDays || (Array.isArray(e.overtimeDays) && e.overtimeDays.length));
      widened = true;
    }

    summaryEl.textContent = summary || '';
    const otNote = requireOtDays ? ' Колонка OT — показаны только сотрудники с заполненными OT-датами.' : '';
    if (widened) hintEl.textContent = `По тегам задачи (${[...tagSet].join(', ')}) совпадений по ролям не нашёл — показываю всех.${otNote}`;
    else if (tagSet.size) hintEl.textContent = `Отфильтровано по совпадению ролей с тегами задачи (${[...tagSet].join(', ')}).${otNote}`;
    else hintEl.textContent = `Без фильтра по роли (на задаче нет тегов).${otNote}`;

    const renderList = (filterText) => {
      const q = String(filterText||'').trim().toLowerCase();
      const filtered = candidates.filter(e => !q || String(e.fio||'').toLowerCase().includes(q));
      if (!filtered.length) {
        listEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-3);font-size:12px;">Никого не найдено</div>';
        return;
      }
      listEl.innerHTML = filtered.map(e => {
        const roles = e.roles ? `<span style="font-size:11px;color:var(--text-3);">${escapeHtmlBasic(e.roles.replace(/\|/g, ', '))}</span>` : '';
        const ot = (Array.isArray(e.overtimeDays) && e.overtimeDays.length) ? ` <span style="font-size:10px;color:#92400e;background:#fef3c7;padding:1px 5px;border-radius:3px;">OT:${e.overtimeDays.length}</span>` : '';
        return `<div class="modal-gantt-assign-item" data-emp-id="${e.id}" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border-light);">
          <div style="font-weight:600;">${escapeHtmlBasic(e.fio||'без имени')}${ot}</div>
          ${roles}
        </div>`;
      }).join('');
    };
    function escapeHtmlBasic(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    searchEl.value = '';
    renderList('');
    overlay.classList.remove('hidden');
    setTimeout(() => searchEl.focus(), 50);

    return new Promise(resolve => {
      const onSearch = () => renderList(searchEl.value);
      const onPick = (ev) => {
        const item = ev.target.closest('[data-emp-id]');
        if (!item) return;
        const emp = (state.employees || []).find(e => e.id === item.dataset.empId);
        cleanup();
        resolve(emp || null);
      };
      const onCancel = () => { cleanup(); resolve(null); };
      const onKey    = (e) => { if (e.key === 'Escape') onCancel(); };
      const cleanup = () => {
        searchEl.removeEventListener('input', onSearch);
        listEl.removeEventListener('click', onPick);
        noBtn.removeEventListener('click', onCancel);
        xBtn ?.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey);
        overlay.dataset.busy = '0';
        overlay.classList.add('hidden');
      };
      searchEl.addEventListener('input', onSearch);
      listEl.addEventListener('click', onPick);
      noBtn.addEventListener('click', onCancel);
      xBtn ?.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey);
    });
  },

  /** V14 (B8): «В какой колодец?» modal for the bulk-add flow. Returns
   *  Promise<{bucket: 'backlog'|'r120'|'r121'|'r122'|'overtime', comment:string}|null>.
   *  Comment is required (button stays disabled until non-empty). */
  openGanttAddTargetModal({ summary='' }={}) {
    const overlay = document.getElementById('modal-gantt-add-target');
    const summaryEl = document.getElementById('modal-gantt-add-target-summary');
    const cmtEl     = document.getElementById('modal-gantt-add-target-comment');
    const bucketsBox= document.getElementById('modal-gantt-add-target-buckets');
    const okBtn     = document.getElementById('modal-gantt-add-target-ok');
    const noBtn     = document.getElementById('modal-gantt-add-target-cancel');
    const xBtn      = document.getElementById('modal-gantt-add-target-close');
    if (!overlay || !okBtn) return Promise.resolve(null);
    if (overlay.dataset.busy === '1') return Promise.resolve(null);   // V15 audit#1 — re-entry guard
    overlay.dataset.busy = '1';
    summaryEl.textContent = summary || '';
    cmtEl.value = '';
    okBtn.disabled = true;
    // reset to Backlog default
    const def = bucketsBox.querySelector('input[value="backlog"]');
    if (def) def.checked = true;
    overlay.classList.remove('hidden');
    setTimeout(() => cmtEl.focus(), 50);
    return new Promise(resolve => {
      const cleanup = () => {
        cmtEl.removeEventListener('input', onInput);
        okBtn.removeEventListener('click', onOk);
        noBtn.removeEventListener('click', onCancel);
        xBtn ?.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey);
        overlay.dataset.busy = '0';
        overlay.classList.add('hidden');
      };
      const onInput = () => { okBtn.disabled = !cmtEl.value.trim(); };
      const onOk    = () => {
        if (okBtn.disabled) return;
        const bucket = bucketsBox.querySelector('input[name="gantt-add-bucket"]:checked')?.value || 'backlog';
        const comment = cmtEl.value.trim();
        if (!comment) return;
        cleanup();
        resolve({ bucket, comment });
      };
      const onCancel = () => { cleanup(); resolve(null); };
      const onKey    = (e) => { if (e.key === 'Escape') onCancel(); };
      cmtEl.addEventListener('input', onInput);
      okBtn.addEventListener('click', onOk);
      noBtn.addEventListener('click', onCancel);
      xBtn ?.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey);
    });
  },

  bindCrossTabStorageSync() {
    if(App._storageSyncBound) return;
    App._storageSyncBound=true;
    window.addEventListener('storage',(e)=>{
      if(!e||(e.key!==STORAGE_KEY&&e.key!==SETTINGS_KEY)) return;
      showToast('Данные были изменены в другой вкладке. Обновите страницу, чтобы синхронизироваться.','error',3800);
    });
  },
  // V14: bindGantt2Controls() removed — GanttV2 retired (B2).
  renderLegend(targetId,items) {
    const el=document.getElementById(targetId);
    if(!el) return;
    if(!items||!items.length){el.innerHTML='';el.style.display='none';return;}
    el.style.display='';
    el.innerHTML=items.map(item=>{
      if(item.color){
        return `<span class="legend-item-inline"><span class="legend-dot" style="background:${item.color}"></span>${Utils.escapeHtml(item.label)}</span>`;
      }
      return `<span class="legend-item-inline">${Utils.escapeHtml(item.label)}</span>`;
    }).join('');
  },
  renderSectionLegends(section) {
    const legendsBySection={
      dashboard:[
        {color:'#4f46e5',label:'Релизы: 1.20 / 1.21 / 1.22'},
        {color:'#dc2626',label:'Красный: блокеры и овертайм'},
        {color:'#f59e0b',label:'Жёлтый: требует подтверждения'},
        {color:'#059669',label:'Зелёный: в scope / сделано'},
      ],
      registry:[],
      gantt:[
        {color:'#4f46e5',label:'Линии зависимостей'},
        {color:'#dc2626',label:'Конфликт зависимости по срокам'},
        {label:'◎ Перетяните с задачи на задачу для связи'},
      ],
      // V14: gantt2 legend removed (GanttV2 retired)
      kanban:[
        {color:'#dc2626',label:'Красная рамка: блокер'},
        {color:'#f59e0b',label:'Жёлтая рамка: риск'},
        {color:'#9ca3af',label:'Полупрозрачность: сделано'},
      ],
      timeline:[
        {color:'#4f46e5',label:'Стадии релизов'},
        {color:'#059669',label:'Распределение работ'},
        {color:'#d97706',label:'Статусы scope'},
      ],
      podlozhka:[
        {color:'#dc2626',label:'Рисковые строки'},
        {color:'#059669',label:'Сделанные строки'},
        {label:'Режим «Детализированное» показывает видимые столбцы реестра'},
      ],
      employees:[
        {color:'#4f46e5',label:'Роли и команды как теги'},
        {color:'#dc2626',label:'OT: задачи сотрудника в овертайме'},
        {label:'Кнопка «Задачи» раскрывает связанный список из реестра'},
      ],
      summary:[
        {color:'#4f46e5',label:'Ключевые KPI для CEO'},
        {color:'#059669',label:'Прогресс выполнения'},
        {color:'#dc2626',label:'Точки риска и блокировки'},
      ],
      metrics:[
        {color:'#4f46e5',label:'SLA сроков и зависимостное давление'},
        {color:'#14b8a6',label:'Scope mix и портфель типов работ'},
        {color:'#ef4444',label:'Операционные и качественные сигналы'},
      ],
      insights:[
        {color:'#dc2626',label:'High: критический сигнал'},
        {color:'#f59e0b',label:'Medium: требует внимания'},
        {color:'#22c55e',label:'Low: наблюдение'},
      ],
      diagnostics:[
        {label:'Показывает источник данных и качество импорта'},
      ],
    };
    const targetMap={
      dashboard:'dashboard-legend',
      registry:'registry-legend',
      gantt:'gantt-legend-extra',
      // V14: gantt2 legend retired
      kanban:'kanban-legend',
      timeline:'timeline-legend-extra',
      podlozhka:'podlozhka-legend',
      employees:'employees-legend',
      summary:'summary-legend',
      metrics:'metrics-legend',
      insights:'insights-legend',
      diagnostics:'diagnostics-legend',
    };
    Object.entries(targetMap).forEach(([key,id])=>App.renderLegend(id,key===section?legendsBySection[key]||[]:[]) );
  },
  populateFilterDropdowns() { FiltersUI.populateDropdowns(); },
  renderSection(s) {
    // Track when the active section was last rendered so the reactive
    // auto-flush can skip a redundant re-render that's about to fire
    // 100 ms after a UI handler already painted the new state. This
    // prevents the Gantt "blink + scroll-to-top" double-render: a drag/
    // drop / delete handler calls renderChart() itself (with scroll
    // preservation) → state mutation marks the store dirty → 100 ms
    // later the auto-flush would re-render the same section, blowing
    // away the just-restored scroll.
    App._lastRenderAt = Date.now();
    App._lastRenderSection = s;
    if(App.syncGanttModeUi) App.syncGanttModeUi();
    if(s==='dashboard') DashboardView.render();
    else if(s==='registry') RegistryView.render();
    else if(s==='gantt') GanttView.render();
    // V14: 'gantt2' route removed — old links auto-redirected to gantt below.
    else if(s==='kanban') KanbanView.render();
    else if(s==='timeline') TimelineView.render();
    else if(s==='podlozhka') PodlozhkaView.render();
    else if(s==='employees') EmployeesView.render();
    else if(s==='summary') SummaryView.render();
    else if(s==='metrics') MetricsView.render();
    else if(s==='insights') InsightsView.render();
    else if(s==='diagnostics') DiagnosticsView.render();
    else if(s==='actions') ActionLayer.render();
    else if(s==='ai') AIView.render();
    else if(s==='ai-ceo') AICeoView.render();
    else if(s==='integrations') IntegrationsView.render();
    else if(s==='history') HistoryView.render();
    else if(s==='errors') ErrorsView.render();
    App.renderSectionLegends(s);
    if(typeof LLMAssistant!=='undefined'&&LLMAssistant.updateQuickPrompts){
      LLMAssistant.updateQuickPrompts();
    }
    HistoryManager.syncButtons();
    App.animateSection(s);
  },
  animateSection(section) {
    const root=document.getElementById(`section-${section}`);
    if(!root) return;
    const now=Date.now();
    if(App._lastAnimAt&&(now-App._lastAnimAt)<260) return;
    App._lastAnimAt=now;
    const targets=[...root.querySelectorAll('.kpi-card, .summary-card, .data-table-wrap, .insight-item, .kanban-card, .gantt-row, .gar-row, .timeline-section, .diag-card, .employee-card, .metrics-card, .metrics-person, .metrics-signal, .view-legend .legend-item-inline, .preset-btn, .preset-role-btn, .ai-block, .ceo-card, .ceo-feed-item')].slice(0,48);
    const bars=[...root.querySelectorAll('.mini-progress > span')].slice(0,32);
    targets.forEach((el,idx)=>{
      el.classList.remove('ui-animate-item');
      el.style.animationDelay=`${Math.min(idx*10,150)}ms`;
    });
    bars.forEach((bar,idx)=>{
      bar.classList.remove('progress-animated');
      bar.style.animationDelay=`${Math.min(idx*14,170)}ms`;
    });
    requestAnimationFrame(()=>{
      targets.forEach(el=>el.classList.add('ui-animate-item'));
      bars.forEach(bar=>bar.classList.add('progress-animated'));
    });
    clearTimeout(App._animCleanupT);
    App._animCleanupT=setTimeout(()=>{
      targets.forEach(el=>{ el.classList.remove('ui-animate-item'); el.style.animationDelay=''; });
      bars.forEach(el=>{ el.classList.remove('progress-animated'); el.style.animationDelay=''; });
    },760);
  },
  refreshAll() { App.renderSection(state.activeSection); HistoryManager.syncButtons(); },
  refreshCurrentSection() { App.renderSection(state.activeSection); },
  /** Sub-views that re-render in-place (e.g. GanttView.renderChart on a
   *  drop handler) can call this to inform the reactive auto-flush that
   *  the active section was just painted — and the upcoming reactive
   *  flush should skip a redundant `App.refreshAll()`. */
  markRenderedNow() { App._lastRenderAt = Date.now(); App._lastRenderSection = state.activeSection; },
  refreshDashboardIfActive() { if(state.activeSection==='dashboard') DashboardView.render(); },
  updateTopbarBadge() {
    const b=document.getElementById('topbar-row-count');
    if(state.rows.length){b.textContent=state.rows.length+' задач';b.classList.remove('hidden');}
    else b.classList.add('hidden');
    App.refreshFilterCountBadge();
  },
  // V17 P10 (designer §1 + sys-analyst §2 + art-director Quick win 4) —
  // applied-filter counter on the «Фильтры» topbar button. Hidden when 0
  // active filters so the chrome stays quiet by default.
  refreshFilterCountBadge() {
    const el = document.getElementById('topbar-filter-count');
    if (!el) return;
    let n = 0;
    try { n = FilterEngine.getActiveCount?.() || 0; } catch(_) { n = 0; }
    if (n > 0) {
      el.textContent = String(n);
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  },
  bindFilesDropdown() {
    const wrap=document.getElementById('files-dropdown-wrap');
    const btn=document.getElementById('btn-files-dropdown');
    const menu=document.getElementById('files-dropdown-menu');
    if(!btn||!menu) return;
    // V17 P10 (a11y consensus) — wire ARIA semantics so screen-readers announce
    // the popover correctly. role=menu + haspopup + expanded sync on every toggle.
    btn.setAttribute('aria-haspopup','menu');
    btn.setAttribute('aria-expanded','false');
    menu.setAttribute('role','menu');
    const setOpen=(open)=>{
      menu.classList.toggle('hidden',!open);
      btn.classList.toggle('active',open);
      btn.setAttribute('aria-expanded', open?'true':'false');
    };
    const close=()=>setOpen(false);
    btn.addEventListener('click',(e)=>{
      e.stopPropagation();
      setOpen(menu.classList.contains('hidden'));
    });
    // V17 P10 (full-stack C1 idempotent + designer §2 + QA §3) — bind document
    // listeners only once. Repeat calls of bindFilesDropdown (e.g. after re-init)
    // would otherwise stack click/keydown handlers.
    if (!document._q2FilesDropdownBound) {
      document._q2FilesDropdownBound = true;
      document.addEventListener('click',(e)=>{
        const w=document.getElementById('files-dropdown-wrap');
        const m=document.getElementById('files-dropdown-menu');
        const b=document.getElementById('btn-files-dropdown');
        if(!w||!m||!b) return;
        if(!w.contains(e.target) && !m.classList.contains('hidden')){
          m.classList.add('hidden');
          b.classList.remove('active');
          b.setAttribute('aria-expanded','false');
        }
      });
      document.addEventListener('keydown',(e)=>{
        if (e.key !== 'Escape') return;
        const m=document.getElementById('files-dropdown-menu');
        const b=document.getElementById('btn-files-dropdown');
        if(!m||!b||m.classList.contains('hidden')) return;
        m.classList.add('hidden');
        b.classList.remove('active');
        b.setAttribute('aria-expanded','false');
        b.focus();
      });
    }
    menu.querySelectorAll('input[type=file]').forEach(inp=>{
      inp.addEventListener('change',close);
    });
    document.getElementById('btn-export-csv')?.addEventListener('click',close);
    document.getElementById('btn-clear-storage')?.addEventListener('click',close);
  },
  bindSimMode() {
    const btn=document.getElementById('btn-sim-mode');
    if(btn) btn.addEventListener('click',()=>SimMode.toggle());
  },
  bindInsightActions() {
    document.addEventListener('click',(e)=>{
      const btn=e.target.closest('.insight-action-btn');
      if(!btn) return;
      const action=btn.dataset.action;
      const rows=FilterEngine.getFiltered();
      if(action==='assign_120'){
        const targets=rows.filter(r=>r.isUnassigned&&r.scopeStatus==='Да');
        applyBulkAction(targets.map(r=>r.id),'assign_release',{release:'120'});
      } else if(action==='confirm_scope'){
        const targets=rows.filter(r=>r.scopeStatus==='Требует подтверждения'&&(r.hasRelease120||r.hasRelease121||r.hasRelease122||r.hasOvertime));
        applyBulkAction(targets.map(r=>r.id),'set_scope',{scope:'Да'});
      } else if(action==='clear_blockers'){
        const targets=rows.filter(r=>r.blockingDependency&&(r.hasRelease120||r.hasRelease121));
        applyBulkAction(targets.map(r=>r.id),'clear_blocker',{});
      }
    });
  },
};

// ============================================================
// WINDOW REFS + BOOTSTRAP
// ============================================================
window.App            = App;
window.LLMAssistant   = LLMAssistant;
// `PromptsEditor` is now imported from ./app/promptsEditor.js (audit #18 decomposition)
// — the module also self-registers on window for backward compat. Keep the explicit
// assignment as a defensive idempotent: it's a no-op if already set, and makes the
// global surface visible at this orchestration point.
window.PromptsEditor  = PromptsEditor;
window.HistoryManager = HistoryManager;
window.showToast      = showToast;
window.showFunnyLoader = showFunnyLoader;
window.AppSettings    = AppSettings;
window.Onboarding     = Onboarding;
window.ThemeUI        = ThemeUI;
window.RegistryView   = RegistryView;
window.BulkEditPanel  = BulkEditPanel;
window.ActionLayer    = ActionLayer;

subscribe(reason => {
  if (!App) return;
  if (reason==='import-csv'||reason==='import-xlsx'||reason==='restore') {
    App.populateFilterDropdowns(); App.refreshAll(); App.updateTopbarBadge();
  } else if (reason) {
    App.refreshAll();
  }
  // Refresh alert bar when data changes
  if (reason && reason !== 'chat_filter' && reason !== 'chat_filter_clear') {
    try { refreshAlerts(); } catch(_) {}
  }
});

// V12 — cross-tab sync (audit recommendation #1, FOUND_BUGS NEW-1).
// When the user has the app open in two tabs, a `Storage.save()` from tab A
// is invisible to tab B until B itself writes — at which point B overwrites
// A's data. Listening to the `storage` event on the same origin fires in
// EVERY tab except the writer, so B can pull the freshest state silently.
//
// We only react to OUR own keys (constants from `STORAGE_KEYS`) and only
// when `e.newValue` differs (browser also fires the event with newValue=null
// on `removeItem`). The reload path goes through `Storage.load()` +
// `App.refreshAll()` wrapped in `Reactive.silent` so it doesn't trigger
// another save.
import { STORAGE_KEYS, SETTINGS_KEYS } from './constants.js';
window.addEventListener('storage', (e) => {
  if (!e.key) return;          // .clear() fires with key=null — ignore
  // Only react to our own keys: data + settings + onboarding (not LLM logs etc)
  const ours = STORAGE_KEYS.includes(e.key) || SETTINGS_KEYS.includes(e.key);
  if (!ours) return;
  if (e.newValue == null) return;   // removeItem — don't trigger reload
  // Pull-and-render is wrapped in Reactive.silent because the import paths
  // mutate state.rows / state.colOrder etc. and would otherwise re-fire
  // Storage.save() in a loop with the writing tab.
  try {
    Reactive.silent(() => {
      Storage.loadSettings();
      const saved = Storage.load();
      if (saved && Array.isArray(saved.rows)) {
        Storage.restore(saved);
        try { RiskEngine.computeAll(state.rows); } catch(_) {}
      }
    });
    if (window.App) {
      App.populateFilterDropdowns();
      App.refreshAll();
      App.updateTopbarBadge();
    }
  } catch(err) { console.warn('[storage-sync] cross-tab reload failed:', err); }
});

// Audit #6 — Reactive auto-flush. Fires debounced (~100 ms) after any
// proxied mutation of `state` (e.g. `state.rows[0].team = 'X'`).
// Bootstrap and snapshot-restoration paths are wrapped in
// `Reactive.silent(...)` to avoid save-loops.
import { Reactive } from './reactiveStore.js';
let _reactiveBooted = false;
// Guard against the render-mutates-state-mutates-render infinite loop:
// `App.refreshAll()` triggers view renders which sometimes write back
// to `state.*` (filter dropdowns, derived row fields, etc.). Without
// `silent(...)` those nested writes mark the store dirty again →
// 100 ms later this same subscriber fires → loop. Wrapping the body in
// `Reactive.silent(...)` swallows nested writes for the duration of
// the flush. A re-entry flag `_reactiveFlushing` is a belt-and-braces
// guard for the (rare) microtask race where the timer fires twice
// before silent() takes effect.
//
// Skip auto-`refreshAll` when the active section was rendered within
// the last 250 ms — the user-action handler that triggered the
// mutation has already painted the right UI (typically with scroll
// preservation). A second wholesale re-render here would just blow
// away that scroll and create a visible blink (Gantt drag/delete,
// Registry inline edit, etc.).
let _reactiveFlushing = false;
const _AUTO_RERENDER_GRACE_MS = 250;
Reactive.subscribe(() => {
  if (!_reactiveBooted || !window.App) return;       // ignore changes during initial load
  if (_reactiveFlushing) return;                     // re-entry → skip
  _reactiveFlushing = true;
  Reactive.silent(() => {
    // V17 P11 (full-stack F-1 + sys-analyst §2) — drop the FilterEngine cache
    // on every flush. The cache key was keyed on `state._dataVersion`, which
    // is bumped only by forceSave / CSV-import. Inline-edit / drag mutations
    // never touched _dataVersion, so getFiltered() returned a stale array.
    try { FilterEngine.invalidate?.(); } catch(_) {}
    try { Storage.save(); } catch (e) { console.warn('[reactive] Storage.save failed:', e); }
    const justRendered = App._lastRenderSection === state.activeSection
                      && (Date.now() - (App._lastRenderAt || 0)) < _AUTO_RERENDER_GRACE_MS;
    if (!justRendered) {
      try { App.refreshAll(); } catch (e) { console.warn('[reactive] refreshAll failed:', e); }
    }
  });
  _reactiveFlushing = false;
});

document.addEventListener('DOMContentLoaded', () => {
  // Wrap App.init in silent — bootstrap mutates state heavily (Storage.load,
  // syncColumnSettings, AppDataStore.init writes rows from SQLite, etc.).
  // After init returns we flip the flag and let auto-flush take over.
  Reactive.silent(() => App.init());
  _reactiveBooted = true;
});
