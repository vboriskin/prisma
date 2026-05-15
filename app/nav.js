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
import { Reactive } from '../reactiveStore.js';
import { HistoryLog } from '../historyLog.js';
import { getModuleForSection, getModuleLabel, getSectionLabel } from './appSettings.js';
import { Services } from './services.js';

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
    // Волна 1 — клик по module-header ведёт на defaultSection модуля.
    document.querySelectorAll('.sidebar-module-head[data-section]').forEach(btn => {
      btn.addEventListener('click', () => Nav.goTo(btn.dataset.section));
    });
  },
  goTo(section) {
    // V21 tabs-consolidation (вариант A) — старая вкладка «Инсайты» свёрнута
    // в Дашборд (room #dashboard-signals). Редирект сохраняет старые ссылки/
    // закладки/onboarding-шаги. Аналогично retired `gantt2` (V14).
    if (section === 'insights') section = 'dashboard';
    const prev = state.activeSection;
    // 2026-05-04 — UI-only state, не триггерит Storage.save. Без silent
    // navigation мутировал state → reactive flush → debounce save → dirty-dot
    // мигал на 400 мс при каждой смене вкладки (cosmetic noise).
    Reactive.silent(() => { state.activeSection = section; });

    // Волна 1 — module-aware navigation.
    // - data-active-module / data-active-section управляют CSS-каскадом.
    // - align-жест на module-indicator при смене модуля (brandbook §9).
    // - dynamic <title>: «{Раздел} · Призма».
    const html = document.documentElement;
    const prevModule = html.dataset.activeModule || '';
    const nextModule = getModuleForSection(section);
    html.dataset.activeModule = nextModule;
    html.dataset.activeSection = section;

    // <title>
    try {
      const sectionLabel = getSectionLabel(section);
      document.title = sectionLabel ? `${sectionLabel} · Призма` : 'Призма';
    } catch (_) { /* DOM может быть не готов в тестах */ }

    // Module-indicator — обновляем label + триггерим align при смене модуля.
    const labelEl = document.getElementById('topbar-module-label');
    if (labelEl) {
      const newLabel = (getModuleLabel(nextModule) || '').toUpperCase();
      labelEl.textContent = newLabel;
    }
    if (prevModule && prevModule !== nextModule) {
      const indicator = document.querySelector('.topbar-module-indicator');
      if (indicator) {
        indicator.classList.add('is-aligning');
        clearTimeout(Nav._alignT);
        Nav._alignT = setTimeout(() => indicator.classList.remove('is-aligning'), 1600);
      }
    }

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
    // V21 Wave-3 — re-hydrate `data-icon` placeholders в свежерендеренной
    // секции. Дёшево (одно сканирование секции), безопасно (idempotent через
    // `data-icon-hydrated`-флаг). Если Icons ещё не загружен (early bootstrap)
    // — silent no-op.
    try { Services.Icons?.hydrate?.(el || document); } catch (_) {}
    // V21 BM — refresh AI context chip-bar после навигации.
    try { Services.LLMAssistant?.refreshContextBar?.(); } catch (_) {}
    // F15 fix (chat-04 audit) — раньше переход в `history` не логировался,
    // и навигация чат→history была невидима в собственном логе. Теперь
    // логируем тоже, но с source='nav' (чтобы не путать с self-views).
    if (prev !== section) {
      HistoryLog.view('navigate', `Переход: ${section}`, { target: section, source: 'nav' });
    }
  },
};

Services.register('Nav', Nav);
if (typeof window !== 'undefined') window.Nav = Nav;
