'use strict';
/* ============================================================
   app/init.js — bootstrap helpers extracted from app.js (audit #7).
   --
   Currently owns:
     · setupWelcomeSplash(deps)  — first-run "Привет → Погнали" splash,
                                    or "Восстановить / Начать заново"
                                    when saved data exists.
     · welcomeHandledRestore()   — flag the App.init code reads to know
                                    whether the splash already handled
                                    the modal-restore decision.

   Why a deps object instead of imports? The splash needs to call back
   into the main App orchestrator (Storage, RegistryView, App.*, etc.).
   To avoid a circular import (app.js → init.js → app.js), we let app.js
   pass those references in. Same pattern as a DI seam.
   ============================================================ */

const WELCOME_KEY = 'welcomeShown';
let _welcomeHandledRestore = false;

export function welcomeHandledRestore() { return _welcomeHandledRestore; }

/**
 * @param {object} deps
 * @param {object} deps.Storage
 * @param {object} deps.RiskEngine
 * @param {object} deps.HistoryManager
 * @param {object} deps.RegistryView
 * @param {object} deps.App
 * @param {object} deps.state
 * @param {function?} deps.isFirstRun
 * @param {function?} deps.showWelcomeScreen
 * @param {function?} deps.updateDemoBanner
 */
export function setupWelcomeSplash(deps) {
  const { Storage, RiskEngine, HistoryManager, RegistryView, App, state,
          isFirstRun, showWelcomeScreen, updateDemoBanner } = deps;

  const overlay = document.getElementById('welcomeOverlay');
  if (!overlay) return; // Inline early-out already removed it.
  try {
    if (localStorage.getItem(WELCOME_KEY) === 'true') { overlay.remove(); return; }
  } catch(_) {}

  const cta      = document.getElementById('welcomeCtaBtn');
  const subtitle = document.getElementById('welcomeSubtitle');
  const cursor   = subtitle?.querySelector('.welcome-subtitle-cursor');

  /* ── Decide flow — fresh vs restore ─────────────────────── */
  let saved = null;
  try { saved = Storage.load(); } catch(_) { saved = null; }
  const hasSaved = !!(saved && Array.isArray(saved.rows) && saved.rows.length > 0);

  if (hasSaved) {
    overlay.classList.add('welcome-restore-active');
    const restoreEl  = document.getElementById('welcomeRestore');
    const metaEl     = document.getElementById('welcomeRestoreMeta');
    if (restoreEl) restoreEl.hidden = false;
    if (subtitle)  subtitle.dataset.text = 'У тебя уже есть сохранённый план — продолжим?';
    if (metaEl) {
      const dateStr = (() => {
        try { return new Date(saved.savedAt).toLocaleString('ru'); } catch(_) { return ''; }
      })();
      metaEl.textContent = `Сохранено ${saved.rows.length} строк${dateStr ? ' от ' + dateStr : ''}.`;
    }
  }

  /* ── Typewriter (subtitle) ──────────────────────────────── */
  const TYPEWRITER_START = 750;
  const CHAR_DELAY       = 26;
  let typewriterTimer = null;
  function startTypewriter() {
    if (!subtitle || !cursor) return;
    const text = subtitle.dataset.text || '';
    subtitle.classList.add('welcome-typing');
    let i = 0;
    const tick = () => {
      if (i < text.length) {
        const ch = text.charAt(i++);
        cursor.insertAdjacentText('beforebegin', ch);
        const jitter = (Math.random() * 8) - 4;
        typewriterTimer = setTimeout(tick, CHAR_DELAY + jitter);
      } else {
        setTimeout(() => cursor && cursor.classList.add('welcome-cursor-done'), 800);
      }
    };
    typewriterTimer = setTimeout(tick, 0);
  }
  setTimeout(startTypewriter, TYPEWRITER_START);

  /* ── Dismiss flow ───────────────────────────────────────── */
  let dismissed = false;
  const dismiss = (afterFn) => {
    if (dismissed) return;
    dismissed = true;
    if (typewriterTimer) clearTimeout(typewriterTimer);
    overlay.classList.add('welcome-out');
    try { localStorage.setItem(WELCOME_KEY, 'true'); } catch(_) {}
    setTimeout(() => {
      overlay.remove();
      try { afterFn && afterFn(); } catch(_) {}
    }, 460);
  };

  /* ── Wire CTAs depending on mode ────────────────────────── */
  if (hasSaved) {
    _welcomeHandledRestore = true;

    document.getElementById('welcomeRestoreYes')?.addEventListener('click', () => {
      dismiss(() => {
        try {
          Storage.restore(saved); RiskEngine.computeAll();
          HistoryManager.clear();
          RegistryView.applyRowHeight();
          App.populateFilterDropdowns();
          App.renderSection('dashboard');
          App.updateTopbarBadge();
          updateDemoBanner && updateDemoBanner();
          setTimeout(() => { if (state.activeSection === 'registry') RegistryView.autoFitColWidths(); }, 150);
        } catch(e) { console.warn('[welcome restore] failed:', e); }
      });
    });
    document.getElementById('welcomeRestoreNo')?.addEventListener('click', () => {
      dismiss(() => {
        try {
          Storage.clear(); HistoryManager.clear();
          App.renderSection('dashboard');
          if (typeof isFirstRun === 'function' && isFirstRun()
              && typeof showWelcomeScreen === 'function') {
            showWelcomeScreen();
          }
        } catch(e) { console.warn('[welcome restart] failed:', e); }
      });
    });
  } else {
    cta?.addEventListener('click', () => dismiss(() => {
      try {
        if (typeof isFirstRun === 'function' && isFirstRun()
            && typeof showWelcomeScreen === 'function') {
          showWelcomeScreen();
        }
      } catch(_) {}
    }));
  }

  // Keyboard shortcut only sensible in fresh-start mode (single action).
  if (!hasSaved) {
    document.addEventListener('keydown', function welcomeKeys(e) {
      if (dismissed) { document.removeEventListener('keydown', welcomeKeys); return; }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cta?.click(); }
    });
  }
}
