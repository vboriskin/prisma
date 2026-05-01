'use strict';
/* ============================================================
   app/nav.js — V13 (extracted from app.js, audit #18).

   Top-level section navigation. Listens to .nav-item buttons,
   toggles `.active` / `.hidden`, plays a tiny enter-animation
   and asks the orchestrator (`App`) to re-render the section.

   DI: the App reference and a couple of helpers come in via
   `init(deps)` because Nav and App live in different modules
   and a circular import would form otherwise.

   Public surface:
     · init(deps)         — wire click handlers and remember deps
     · goTo(section)      — programmatic navigation (used from onboarding)
   ============================================================ */

import { state } from '../state.js';
import { HistoryLog } from '../historyLog.js';

let _deps = null;

export const Nav = {
  /**
   * @param {object} deps
   * @param {object} deps.App                 - orchestrator with .renderSection()
   */
  init(deps) {
    _deps = deps || {};
    document.querySelectorAll('.nav-item[data-section]').forEach(btn => {
      btn.addEventListener('click', () => Nav.goTo(btn.dataset.section));
    });
  },
  goTo(section) {
    const prev = state.activeSection;
    state.activeSection = section;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    const ab = document.querySelector(`.nav-item[data-section="${section}"]`);
    if (ab) ab.classList.add('active');
    document.querySelectorAll('.app-section').forEach(s => s.classList.add('hidden'));
    const el = document.getElementById(`section-${section}`);
    if (el) {
      el.classList.remove('hidden');
      el.classList.remove('section-enter');
      void el.offsetWidth;
      el.classList.add('section-enter');
      clearTimeout(Nav._sectionAnimT);
      Nav._sectionAnimT = setTimeout(() => el.classList.remove('section-enter'), 280);
    }
    _deps?.App?.renderSection?.(section);
    // Don't log re-clicks of the current section, and don't log navigation to history itself (noise)
    if (prev !== section && section !== 'history') {
      HistoryLog.view('navigate', `Переход: ${section}`, { target: section, source: 'nav' });
    }
  },
};

if (typeof window !== 'undefined') window.Nav = Nav;
