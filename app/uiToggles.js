'use strict';
/* ============================================================
   UI TOGGLES — V18.1 P9 extracted from app.js
   --
   Three small isolated UI clusters: SimMode / SidebarUI / ThemeUI.
   Each ~17-29 LOC, no cross-coupling between them.

   Originally inline in app.js (lines 387-463). Extracted because:
     - Self-contained (every toggle = state mutation + DOM apply)
     - No dependencies on App-orchestrator (only Storage + HistoryLog)
     - Reduces app.js by ~70 LOC

   Each module is re-exported on `window` from app.js for backward
   compat (some external code references `window.ThemeUI` / etc).
   ============================================================ */

import { state }      from '../state.js';
import { Storage }    from '../dataStore.js';
import { HistoryLog } from '../historyLog.js';

/**
 * Simulation Mode — global "what-if" toggle. When ON: state mutations work
 * normally for the session, but never persist via Storage.save (audit
 * 2026-04-30 § B5 + V17 P10 F4 boot-restore).
 *
 * `applyFromState()` is the no-toast variant — used on boot to sync
 * UI badge with restored simMode flag without firing toast/log.
 */
export const SimMode = {
  applyFromState() {
    const btn = document.getElementById('btn-sim-mode');
    if (btn) {
      btn.classList.toggle('sim-on', !!state.simMode);
      btn.title = state.simMode
        ? 'Режим симуляции ВКЛЮЧЁН — изменения не сохраняются (нажмите чтобы выключить)'
        : 'Режим симуляции — изменения не сохраняются';
      btn.setAttribute('aria-pressed', state.simMode ? 'true' : 'false');
    }
    document.body.classList.toggle('sim-mode-active', !!state.simMode);
  },
  toggle() {
    state.simMode = !state.simMode;
    SimMode.applyFromState();
    // showToast injected via window.showToast — defined in app.js. Avoiding
    // the import keeps cross-module deps shallow (app.js → uiToggles, not
    // back). Same pattern for HistoryLog.settings (it's exported, but used
    // here in a fire-and-forget manner — safe to import directly).
    if (typeof window !== 'undefined' && window.showToast) {
      window.showToast(
        state.simMode ? 'Режим симуляции включён — изменения не сохраняются' : 'Режим симуляции выключен',
        state.simMode ? 'warning' : 'info'
      );
    }
    HistoryLog.settings('sim_toggle', state.simMode ? 'Включён режим симуляции' : 'Выключен режим симуляции');
  },
};

/**
 * Sidebar collapse toggle. Persists `state.sidebarCollapsed`.
 */
export const SidebarUI = {
  init() {
    // V18.1 — toggle moved from topbar hamburger (#sidebar-toggle) to
    // sidebar footer chevron (#sidebar-collapse). Old id kept as fallback
    // for any cached HTML still in the wild.
    const btn = document.getElementById('sidebar-collapse')
             || document.getElementById('sidebar-toggle');
    if (btn) btn.addEventListener('click', () => SidebarUI.toggle());
    if (state.sidebarCollapsed) SidebarUI.apply();
  },
  toggle() {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    SidebarUI.apply();
    Storage.save();
  },
  apply() {
    const sb = document.getElementById('sidebar');
    const bd = document.body;
    if (!sb || !bd) return;
    if (state.sidebarCollapsed) { sb.classList.add('collapsed'); bd.classList.add('sidebar-collapsed'); }
    else                        { sb.classList.remove('collapsed'); bd.classList.remove('sidebar-collapsed'); }
  },
};

/**
 * Light/Dark theme toggle. Persists `state.theme`. Updates icon + body class.
 *
 * Icon swap: sun glyph when light theme is active (click → dark), moon glyph
 * when dark is active (click → light). Mirrors common UX pattern.
 */
export const ThemeUI = {
  init() {
    const btn = document.getElementById('btn-theme-toggle');
    if (!btn) return;
    if (!['light', 'dark'].includes(state.theme)) state.theme = 'light';
    ThemeUI.apply();
    btn.addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      ThemeUI.apply();
      Storage.save();
      HistoryLog.settings('theme_toggle', `Тема: ${state.theme === 'dark' ? 'тёмная' : 'светлая'}`);
    });
  },
  apply() {
    const dark = state.theme === 'dark';
    document.body.classList.toggle('theme-dark', dark);
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else      document.documentElement.removeAttribute('data-theme');
    const btn  = document.getElementById('btn-theme-toggle');
    const icon = document.getElementById('btn-theme-icon');
    if (icon) {
      icon.innerHTML = dark
        ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'
        : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    }
    if (btn) btn.title = dark ? 'Светлая тема' : 'Тёмная тема';
  },
};
