'use strict';
/* ============================================================
   ONBOARDING UI — v11_0
   Handles: welcome overlay, demo loading, CEO micro-tour,
            setup flow, post-load insights, empty states.
   ============================================================ */

import { state }        from '../state.js';
import { Storage }      from '../dataStore.js';
import { RiskEngine }   from '../riskEngine.js';
import { loadDemoData } from './demoData.js';
import { ConfirmDialog } from '../app/uxKit.js';
import { Icons }        from '../app/icons.js';
import { Services }     from '../app/services.js';
import {
  startOnboarding, completeOnboarding, setOnboardingStep,
  setLastDatasetType, exitDemoMode, enterDemoMode,
  getOnboardingState, isDemoMode,
} from './onboarding.js';

/* ---- forward-declared refs filled by init() ---- */
let _goTo      = null; // (section:string) => void  — set by app.js
let _showToast = null; // (msg, type) => void
let _notify    = null; // (reason) => void

// V17.2 — мини-плюрализатор для русских окончаний (used by post-load insights).
function pl(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5)   return forms[1];
  if (b === 1)          return forms[0];
  return forms[2];
}

/* ================================================================
   PUBLIC API
   ================================================================ */

/** Call once from app.js, passing the App/Nav helpers. */
export function initOnboardingUI({ goTo, showToast, notify }) {
  _goTo      = goTo;
  _showToast = showToast;
  _notify    = notify;
}

/** Show full-screen welcome overlay. */
export function showWelcomeScreen() {
  // v22 — никаких отдельных welcome-mascot'ов. Маскот в углу — это
  // глобальный #obsidian-fab-mascot (persistent через все экраны без
  // re-mount). Welcome просто показывается поверх; FAB остаётся виден.
  const el = document.getElementById('ob-welcome');
  if (el) el.classList.remove('hidden');
}

/** Hide welcome overlay. */
export function hideWelcomeScreen() {
  const el = document.getElementById('ob-welcome');
  if (el) el.classList.add('hidden');
}

/** Load demo data then navigate to AI CEO and start micro-tour. */
let _demoFlowInFlight = false;
export async function startDemoFlow() {
  // V17 P12 (full-stack F-4) — guard against double-click race during the
  // 900ms artificial delay. Without the flag, two demo loads ran in parallel,
  // double-firing Storage.save / `demo-load` notify / showCeoTour.
  if (_demoFlowInFlight) return;
  // V17 P12 (QA §3 + designer §4) — confirm before destroying user-imported
  // data. Previously `loadDemoData()` overwrote `state.rows = rows` with no
  // warning. If the user spent an hour curating their own data and clicked
  // «Demo» from the welcome / back-to-demo button, all work was lost.
  try {
    const hasUserData = (typeof window !== 'undefined')
      && Array.isArray(window.state?.rows) && window.state.rows.length > 0
      && window.state.rows.some(r => !String(r.id || '').startsWith('demo_'));
    if (hasUserData) {
      // V21 Q — ConfirmDialog (warning). Loss of work — пользователь должен явно подтвердить.
      const ok = await ConfirmDialog.show({
        title: 'Загрузить демо-данные?',
        message: 'Текущие задачи будут заменены демо-набором. Рекомендуем сначала экспортировать через «Файлы → Скачать JSON».',
        confirmLabel: 'Загрузить демо',
        danger: true,
      });
      if (!ok) return;
    }
  } catch(_) {}
  _demoFlowInFlight = true;
  try {
    startOnboarding('demo');
    setLastDatasetType('demo');
    hideWelcomeScreen();
    _showDemoLoading();
    await _delay(900);
    loadDemoData();
    Storage.save();
    _notify('demo-load');
    _hideDemoLoading();
    updateDemoBanner();
    _showToast('Демо-данные загружены — 22 задачи', 'success', 2800);
    _goTo('ai-ceo');
    await _delay(350);
    showCeoTour();
  } finally {
    _demoFlowInFlight = false;
  }
}

/** Start setup flow (open file upload instructions). */
export function startSetupFlow() {
  startOnboarding('setup');
  setLastDatasetType('user');
  completeOnboarding();
  hideWelcomeScreen();
  updateDemoBanner();
  _goTo('dashboard');
  _showToast('Загрузите свой файл через «Файлы → Импорт XLSX/CSV»', 'info', 5000);
  // Highlight the files button briefly
  const filesBtn = document.getElementById('btn-files-dropdown');
  if (filesBtn) {
    filesBtn.classList.add('ob-pulse');
    setTimeout(() => filesBtn.classList.remove('ob-pulse'), 3500);
  }
}

/* ---- CEO micro-tour ---- */
// #5.5 (low) — intro-шаг знакомит юзера с маскотом перед тем, как тот
// начнёт прыгать между блоками. Без него «звезда» появляется без контекста.
// selector:null = шаг без highlight-ring, tooltip центрируется на маскоте.
const CEO_TOUR_STEPS = [
  {
    selector: null,
    title: 'Это Обсидиан',
    text: 'Маленький наблюдатель Призмы. Дальше он покажет дорогу — следите за ним.',
    intro: true,
  },
  {
    selector: '#ceo-hero',
    title: '1 / 3 — Здоровье проекта',
    text: 'Шкала показывает общий статус: OK, AT RISK или CRITICAL. Каждая причина — кликабельна: нажмите чтобы сразу увидеть проблемные задачи в реестре.',
  },
  {
    selector: '#ceo-inc',
    title: '2 / 3 — Если ничего не делать',
    text: 'Прогноз на 14 дней вперёд: как риски вырастут сами собой без вмешательства. Помогает убедить команду действовать прямо сейчас.',
  },
  {
    selector: '#ceo-save',
    title: '3 / 3 — Спасти релиз',
    text: 'Три сценария с оценкой риска до/после. Нажмите «Посмотреть изменения» — увидите, что именно предлагается, без применения к данным.',
  },
];

/** Run 3-step micro-tour on CEO blocks. */
let _tourCurrentIdx = -1;
let _tourReposListenerBound = false;
export function showCeoTour() {
  setOnboardingStep(0);
  _renderTourStep(0);
}

function _renderTourStep(idx) {
  _hideTourTooltip();
  if (idx >= CEO_TOUR_STEPS.length) {
    _endCeoTour();
    return;
  }
  setOnboardingStep(idx);
  _tourCurrentIdx = idx;
  const step = CEO_TOUR_STEPS[idx];
  // #5.5 — intro-шаг (selector:null) рисуется без target/highlight-ring,
  // tooltip центрируется через _positionTourTooltip(null, ...).
  const target = step.selector ? document.querySelector(step.selector) : null;
  if (step.selector && !target) { _renderTourStep(idx + 1); return; }

  if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    _positionTourTooltip(target, step, idx);
  }));
  // V17 P12 (QA §1 + full-stack F-1) — re-anchor on resize/scroll. Without
  // this the highlight ring stuck to the original `getBoundingClientRect()`
  // values and pointed at empty space after the user scrolled or the layout
  // shifted (lazy AI block render, image load, etc.).
  if (!_tourReposListenerBound) {
    _tourReposListenerBound = true;
    const reflow = () => {
      if (_tourCurrentIdx < 0 || _tourCurrentIdx >= CEO_TOUR_STEPS.length) return;
      const s = CEO_TOUR_STEPS[_tourCurrentIdx];
      // #5.5 — intro-step (selector:null) центрируется по viewport,
      // re-anchor для него = пере-центрирование на resize.
      const t = s.selector ? document.querySelector(s.selector) : null;
      if (!document.getElementById('ob-tour-tooltip')) return;
      if (s.selector && !t) return;
      _positionTourTooltip(t, s, _tourCurrentIdx);
    };
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, { passive: true });
  }
}

function _positionTourTooltip(target, step, idx) {
  let tooltip = document.getElementById('ob-tour-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'ob-tour-tooltip';
    tooltip.className = 'ob-tour-tooltip';
    document.body.appendChild(tooltip);
  }

  const isLast = idx === CEO_TOUR_STEPS.length - 1;
  // design-01 E fix — маскот в tooltip-туре. Между шагами — ls-move (плывёт),
  // на landing — Curious 600мс, потом Breathe. Управляется ниже через
  // ObsidianMascot.setChatPhase на найденном элементе.
  tooltip.innerHTML = `
    <span class="ob-tour-mascot obs obs--sm obs--breathe" aria-hidden="true">
      <svg viewBox="-60 -60 120 120"><use href="#obs-base"/></svg>
    </span>
    <div class="ob-tour-title">${step.title}</div>
    <div class="ob-tour-text">${step.text}</div>
    <div class="ob-tour-actions">
      <span class="ob-tour-dots">${CEO_TOUR_STEPS.map((_,i) => `<span class="ob-tour-dot${i===idx?' active':''}"></span>`).join('')}</span>
      ${idx > 0 ? `<button class="ob-tour-btn ob-tour-prev" data-idx="${idx}">← Назад</button>` : ''}
      <button class="ob-tour-btn ob-tour-primary ob-tour-next" data-idx="${idx}">${isLast ? 'Готово ✓' : 'Далее →'}</button>
      <button class="ob-tour-btn ob-tour-skip">Пропустить</button>
    </div>`;
  // ls-move на каждом step >0 (Curious при первом landing).
  // #5.5 — на intro-шаге (step.intro) показываем 'surprised' once
  // (T2 — wide eyes pop), чтобы маскот «представился».
  setTimeout(() => {
    const m = tooltip.querySelector('.ob-tour-mascot');
    if (!m) return;
    // v22 — hydrate rich SVG для ls-tool/concerned animations.
    try { Services.ObsidianMascot?.hydrate?.(m); } catch (_) {}
    if (step.intro) {
      try {
        m.classList.add('obs--breathe', 'obs--surprised', 'obs--once');
        setTimeout(() => m.classList.remove('obs--surprised', 'obs--once'), 1700);
      } catch (_) {}
    } else if (idx === 0) {
      try { Services.ObsidianMascot?.setChatPhase?.('idle', m); } catch (_) {}
    } else {
      // IxD-1 fix — §13.7 «шаг онбординга → ls-move». Раньше был 'tool'
      // (наклон к tool-сокету), что семантически из чат-use-кейса.
      try { Services.ObsidianMascot?.setChatPhase?.('move', m); } catch (_) {}
    }
  }, 50);

  // highlight ring — на intro-шаге (target=null) кольца нет,
  // tooltip центрируется по viewport.
  let ring = document.getElementById('ob-tour-ring');
  if (!ring) {
    ring = document.createElement('div');
    ring.id = 'ob-tour-ring';
    ring.className = 'ob-tour-ring';
    document.body.appendChild(ring);
  }
  if (!target) {
    ring.classList.add('hidden');
    const tipH = 180;
    const tipW = 340;
    const tipLeft = Math.max(12, Math.round((window.innerWidth - tipW) / 2));
    const tipTop  = Math.max(window.scrollY + 24,
      window.scrollY + Math.round((window.innerHeight - tipH) / 2));
    tooltip.style.cssText = `left:${tipLeft}px;top:${tipTop}px`;
    tooltip.classList.remove('hidden');
  } else {
    const r = target.getBoundingClientRect();
    const pad = 6;
    ring.style.cssText = `left:${r.left - pad}px;top:${r.top - pad + window.scrollY}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
    ring.classList.remove('hidden');

    // position tooltip
    const tipH = 180;
    let tipTop = r.bottom + window.scrollY + 12;
    if (tipTop + tipH > window.scrollY + window.innerHeight - 24) {
      tipTop = r.top + window.scrollY - tipH - 12;
    }
    tipTop = Math.max(window.scrollY + 8, tipTop);
    const tipLeft = Math.max(12, Math.min(r.left, window.innerWidth - 340 - 12));
    tooltip.style.cssText = `left:${tipLeft}px;top:${tipTop}px`;
    tooltip.classList.remove('hidden');
  }

  // bind buttons
  tooltip.querySelector('.ob-tour-next')?.addEventListener('click', () => {
    if (isLast) _endCeoTour();
    else _renderTourStep(idx + 1);
  });
  tooltip.querySelector('.ob-tour-prev')?.addEventListener('click', () => _renderTourStep(idx - 1));
  tooltip.querySelector('.ob-tour-skip')?.addEventListener('click', () => _endCeoTour());
}

function _endCeoTour() {
  _hideTourTooltip();
  // V17 P12 (full-stack F-1) — clear the in-flight idx so resize/scroll
  // listeners stop trying to re-anchor a tooltip that no longer exists.
  _tourCurrentIdx = -1;
  completeOnboarding();
  // show CTA to load own data
  showDemoCTA();
}

function _hideTourTooltip() {
  // V17 P12 (full-stack F-1 minor) — querySelectorAll instead of single
  // getElementById in case a double-click race created multiple tooltip
  // elements (only the first ID-match would otherwise survive forever).
  document.querySelectorAll('#ob-tour-tooltip').forEach(el => el.remove());
  const ring = document.getElementById('ob-tour-ring');
  if (ring) ring.classList.add('hidden');
}

/* ---- demo ↔ user banner ---- */
/** Update topbar demo / upload-own-data buttons based on current mode. */
export function updateDemoBanner() {
  const demo = isDemoMode();
  const demoBar = document.getElementById('ob-demo-bar');
  const btnLoad = document.getElementById('ob-btn-load-data');
  const btnBackToDemo = document.getElementById('ob-btn-back-demo');
  if (demoBar)       demoBar.classList.toggle('hidden', !demo);
  if (btnLoad)       btnLoad.classList.toggle('hidden', !demo);
  if (btnBackToDemo) btnBackToDemo.classList.toggle('hidden', demo || getOnboardingState().lastDatasetType !== 'demo');
}

/* ---- post-load insights ---- */
/** Show a brief insight toast after user loads own data. */
export function showPostLoadInsights(rows) {
  if (!rows || !rows.length) return;
  const blockers  = rows.filter(r => r.blockingDependency).length;
  const noRelease = rows.filter(r => r.isUnassigned).length;
  const risky     = rows.filter(r => (r.riskScore || 0) >= 50).length;
  // V17.2 — emoji 🚧 / 📭 / ⚠️ убраны (Spine no-emoji rule). Числа сами по
  //   себе несут смысл, тип сигнала кодирует toast-cls (warn / success).
  const parts = [];
  if (blockers)  parts.push(`${blockers} ${pl(blockers, ['блокер','блокера','блокеров'])}`);
  if (noRelease) parts.push(`${noRelease} без релиза`);
  if (risky)     parts.push(`${risky} с высоким риском`);
  if (parts.length) {
    _showToast('Загружено: ' + parts.join(' · '), 'warn', 5000);
  } else {
    _showToast(`Загружено ${rows.length} ${pl(rows.length, ['задача','задачи','задач'])} — данные выглядят чисто`, 'success', 3500);
  }
  completeOnboarding();
  setLastDatasetType('user');
  updateDemoBanner();
}

/* ---- empty state ---- */
/** Inject empty-state placeholder into a container when no data present. */
export function showEmptyState(container) {
  if (!container) return;
  // UX скв.4 — эмодзи (📋/🎬/📂) заменены на Lucide-иконки (Icons.get).
  container.innerHTML = `
    <div class="ob-empty-state">
      <div class="ob-empty-icon">${Icons.get('clipboard', { size: 32 })}</div>
      <div class="ob-empty-title">Данные не загружены</div>
      <div class="ob-empty-sub">Загрузите свой план или посмотрите на демо-данных как работает аналитика</div>
      <div class="ob-empty-actions">
        <button class="ob-empty-btn ob-empty-btn-primary" id="ob-empty-demo">${Icons.get('play-circle', { size: 16 })} Посмотреть демо</button>
        <label class="ob-empty-btn ob-empty-btn-secondary">
          ${Icons.get('folder', { size: 16 })} Загрузить файл
          <input type="file" id="ob-empty-file-input" accept=".xlsx,.xls,.csv" class="input-hidden">
        </label>
      </div>
    </div>`;
  container.querySelector('#ob-empty-demo')?.addEventListener('click', startDemoFlow);
  container.querySelector('#ob-empty-file-input')?.addEventListener('change', (e) => {
    const input = document.getElementById('input-xlsx') || document.getElementById('input-csv');
    if (input && e.target.files[0]) {
      const dt = new DataTransfer();
      dt.items.add(e.target.files[0]);
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    }
  });
}

/* ---- demo CTA (after tour) ---- */
/** Show "Ready for your own data?" toast/banner after tour finishes. */
export function showDemoCTA() {
  const cta = document.getElementById('ob-cta-bar');
  if (cta) {
    cta.classList.remove('hidden');
    cta.querySelector('#ob-cta-close')?.addEventListener('click', () => cta.classList.add('hidden'));
    cta.querySelector('#ob-cta-upload')?.addEventListener('click', () => {
      cta.classList.add('hidden');
      exitDemoMode();
      updateDemoBanner();
      _showToast('Загрузите свои данные через «Файлы → Импорт XLSX/CSV»', 'info', 5000);
      const filesBtn = document.getElementById('btn-files-dropdown');
      if (filesBtn) { filesBtn.classList.add('ob-pulse'); setTimeout(() => filesBtn.classList.remove('ob-pulse'), 3500); }
    });
  }
}

/* ---- demo loading overlay ---- */
function _showDemoLoading() {
  const el = document.getElementById('ob-loading');
  if (el) el.classList.remove('hidden');
}

function _hideDemoLoading() {
  const el = document.getElementById('ob-loading');
  if (el) el.classList.add('hidden');
}

/* ---- utils ---- */
function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ================================================================
   BIND WELCOME OVERLAY BUTTONS (called from app.js)
   ================================================================ */
export function bindWelcomeButtons() {
  // V17 P12 (full-stack F-4 + sys-analyst minor) — idempotent guard. The
  // legacy welcome card buttons used `addEventListener` with no `{once:true}`;
  // any future re-init (test setup, hot-reload) would double-bind every CTA.
  if (document._q2WelcomeBound) return;
  document._q2WelcomeBound = true;
  document.getElementById('ob-btn-demo')?.addEventListener('click', startDemoFlow);
  document.getElementById('ob-btn-setup')?.addEventListener('click', startSetupFlow);
  // 🎓 Full tour — close welcome, dismiss demo banner, kick the legacy 13-step Onboarding
  document.getElementById('ob-btn-tour')?.addEventListener('click', () => {
    hideWelcomeScreen();
    completeOnboarding();    // mark onboarding seen so welcome doesn't reopen
    setLastDatasetType('user');
    // Run after the welcome fade-out so the highlights have a target to point at
    setTimeout(() => {
      try {
        if (typeof Services.Onboarding?.start === 'function') Services.Onboarding.start();
        else if (typeof Services.Onboarding?._start === 'function') Services.Onboarding._start();
      } catch(_) {}
    }, 200);
  });
  document.getElementById('ob-welcome-close')?.addEventListener('click', () => {
    // User dismissed without choosing — treat as setup mode
    startSetupFlow();
  });
  // V17 P12 (QA §2 + designer §5) — Esc + backdrop-click to dismiss the
  // welcome overlay. Hint text in the HTML claims «Нажмите Esc или ✕»; until
  // now Esc was never bound and clicking the dimmed backdrop did nothing.
  const welcomeEl = document.getElementById('ob-welcome');
  if (welcomeEl) {
    welcomeEl.addEventListener('click', (e) => {
      // backdrop is the overlay element itself; clicks inside the box bubble
      // up but `e.target === welcomeEl` only when the user hits the backdrop.
      if (e.target === welcomeEl && !welcomeEl.classList.contains('hidden')) {
        startSetupFlow();
      }
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const w = document.getElementById('ob-welcome');
    if (!w || w.classList.contains('hidden')) return;
    e.preventDefault();
    startSetupFlow();
  });
  // Topbar: re-enter demo
  document.getElementById('ob-btn-back-demo')?.addEventListener('click', async () => {
    enterDemoMode();
    await startDemoFlow();
  });
  // Topbar: load own data (shown in demo bar)
  document.getElementById('ob-btn-load-data')?.addEventListener('click', () => {
    exitDemoMode();
    updateDemoBanner();
    _showToast('Загрузите файл через «Файлы → Импорт XLSX/CSV»', 'info', 5000);
    const filesBtn = document.getElementById('btn-files-dropdown');
    if (filesBtn) { filesBtn.classList.add('ob-pulse'); setTimeout(() => filesBtn.classList.remove('ob-pulse'), 3500); }
  });
}
