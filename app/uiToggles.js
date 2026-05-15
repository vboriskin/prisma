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
import { Icons }      from './icons.js';
import { Services }   from './services.js';

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
    // AUDIT_HOLISTIC Идея 14 — Toast.warn / Toast.info (canonical).
    if (typeof window !== 'undefined') {
      const msg = state.simMode
        ? 'Режим симуляции включён — изменения не сохраняются'
        : 'Режим симуляции выключен';
      const T = Services.Toast;
      if (T) {
        if (state.simMode) T.warn(msg);
        else               T.info(msg);
      } else {
        window.showToast?.(msg, state.simMode ? 'warning' : 'info');
      }
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
      // P10.7 — cross-fade: иконка fade-out + rotate (200ms),
      // затем смена темы и иконки, затем fade-in (transition сам отрисует).
      // 2026-05-04 — guard от двойного клика во время кросс-фейда: если
      // переход в полёте, игнорируем повторные нажатия (иначе иконка и тема
      // могут разойтись на 1-2 кадра).
      if (btn.classList.contains('theme-switching')) return;
      const reduceMotion = typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;
      const commit = () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        ThemeUI.apply();
        Storage.save();
        HistoryLog.settings('theme_toggle', `Тема: ${state.theme === 'dark' ? 'тёмная' : 'светлая'}`);
        btn.classList.remove('theme-switching');
        // 2026-05-04 — toast-feedback при смене темы (раньше было только у
        // SimMode/Save). В low-luminosity условиях иконка-only недостаточна.
        // AUDIT_HOLISTIC Идея 14 — Toast.info (canonical).
        if (typeof window !== 'undefined') {
          const msg = `Тема: ${state.theme === 'dark' ? 'тёмная' : 'светлая'}`;
          if (Services.Toast?.info) Services.Toast.info(msg, { timeoutMs: 1600 });
          else window.showToast?.(msg, 'info', 1600);
        }
      };
      if (reduceMotion) {
        commit();
      } else {
        btn.classList.add('theme-switching');
        setTimeout(commit, 200);
      }
    });
  },
  apply() {
    const dark = state.theme === 'dark';
    document.body.classList.toggle('theme-dark', dark);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const btn  = document.getElementById('btn-theme-toggle');
    const icon = document.getElementById('btn-theme-icon');
    if (icon) {
      // P10.7 — динамическая иконка: dark → sun (намёк «переключиться в light»),
      // light → moon. Path-only update, т.к. #btn-theme-icon сам является
      // <svg> в index.html (атрибуты viewBox / stroke уже выставлены).
      icon.innerHTML = Icons.ICON_PATHS[dark ? 'sun' : 'moon'];
    }
    if (btn) btn.title = dark ? 'Светлая тема' : 'Тёмная тема';
    // V21 π8 Ф3 — sync aria-pressed для toggle-state (audit 1.1).
    btn?.setAttribute('aria-pressed', dark ? 'true' : 'false');
  },
};
