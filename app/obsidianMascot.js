'use strict';
/* ============================================================================
   ObsidianMascot — контроллер маскота Призмы.

   Брендбук: obsidian/MASCOT_OBSIDIAN.md (§13.5–§13.9, §13.10).

   Управляет двумя DOM-элементами:
     · #obsidian-fab-mascot — floating в правом нижнем углу (56×56).
     · #obsidian-chat-avatar — аватар внутри чата (32×32) + per-message avatars.

   Контракт стака (mM1 fix, design-03 audit):
     · Tier 3 ambient (Breathe/Blink/Look) — НЕ снимается при swap exclusive.
     · Tier 1 (emerge/vanish/hibernate) — exclusive, ambient выключен (body-scale конфликт).
     · Tier 2 + Living Shape — exclusive, но Breathe держится поверх (§13.9).
   ============================================================================ */

import { Services } from './services.js';

const SESSION_KEY = 'q2_obsidian_emerged_v1';
const EMERGE_MS   = 2400;
const HOVER_LEAVE_DEBOUNCE_MS = 100;     // mM4 fix
const IDLE_HIBERNATE_MS = 5 * 60 * 1000; // mM8 fix — §13.7

// v22 mascot-pass — rich inline SVG со всеми hooks для Tier 1 (Emerge/Vanish/
// Hibernate) и Living Shape (ls-*). `<use href="#obs-base">` не подходит —
// Chromium не передаёт animation cascade на shadow descendants для non-inheritable
// properties. Inline SVG обходит это ограничение. Hidden defaults на
// blade/edge/facet/ring/bar/brow/emit/return/particle/socket; CSS keyframes
// сами активируют их. body+eyes — visible default. */
//
// AUDIT_MASCOT #4.1 (CRITICAL) — добавлены ранее отсутствующие hooks:
//   obs-aura, obs-inner-star (Hibernate signature — звезда Призмы внутри тела)
//   obs-lid, obs-lid-l, obs-lid-r (Blink/Awaken/Settle/Wink — веки)
//   obs-spark, obs-spark--2/--3/--4 (Success — 4 искры)
//   obs-edge-1/-2/-3 (ls-thinking — edge-shimmer на гранях)
//   obs-trail-1/-2/-3 (ls-move — след при движении в туре)
//   obs-body-x, obs-body-wave (ls-move — обёртки для translateX и skewY)
// Без этого hibernate был без звезды, awaken/wink без век, success без
// искр, ls-thinking без shimmer, ls-move в туре стоял на месте.
const RICH_OBS_SVG = `<svg viewBox="-60 -60 120 120" overflow="visible">
  <circle class="obs-ring" cx="0" cy="0" r="0" fill="none" stroke="var(--obs-emerge-glow, #fff)" stroke-width="0.6" opacity="0"/>
  <rect class="obs-blade" x="-1.5" y="-50" width="3" height="100" fill="var(--obs-emerge-glow, #fff)" opacity="0"/>
  <rect class="obs-edge-l" x="-1.5" y="-50" width="3" height="100" fill="var(--obs-emerge-glow, #fff)" opacity="0"/>
  <rect class="obs-edge-r" x="-1.5" y="-50" width="3" height="100" fill="var(--obs-emerge-glow, #fff)" opacity="0"/>
  <polygon class="obs-facet-tl" points="-22,-46 6,-50 -10,-22" fill="var(--obs-emerge-glow, #fff)" opacity="0"/>
  <polygon class="obs-facet-tr" points="6,-50 28,-22 0,-22" fill="var(--obs-emerge-glow, #fff)" opacity="0"/>
  <polygon class="obs-facet-bl" points="-32,-22 -28,12 -10,46" fill="var(--obs-emerge-glow, #fff)" opacity="0"/>
  <polygon class="obs-facet-br" points="28,-22 18,32 -10,46" fill="var(--obs-emerge-glow, #fff)" opacity="0"/>
  <!-- AUDIT_MASCOT #4.1 — obs-aura: hibernate-glow вокруг тела. CSS hib-aura
       управляет r (42→60) и opacity. Default невидим. -->
  <circle class="obs-aura" cx="0" cy="0" r="42" fill="none" stroke="var(--obs-emerge-glow, #fff)" stroke-width="2" opacity="0"/>
  <!-- AUDIT_MASCOT #4.1 — ls-move контейнеры: внешний x для translateX,
       внутренний wave для skewY. Существующая .obs-body обёртка осталась
       внутри; keyframes которые таргетят .obs-body transform (success,
       hibernate, awaken, settle, wink, surprised, ls-thinking-body, ls-stream-body)
       стакаются естественно через nested transform. -->
  <g class="obs-body-x">
    <g class="obs-body-wave">
      <g class="obs-body">
        <polygon points="-22,-46 6,-50 28,-22 18,32 -10,46 -28,12 -32,-22" fill="var(--obs-body, #fff)"/>
        <polygon class="obs-body-outline" points="-22,-46 6,-50 28,-22 18,32 -10,46 -28,12 -32,-22" fill="none" stroke="var(--obs-feature, #1A1A22)" stroke-width="0.7" opacity="0.45" stroke-linejoin="round"/>
        <polygon points="-22,-46 -32,-22 -10,46" fill="var(--obs-feature, #1A1A22)" opacity="0.08"/>
        <polygon points="6,-50 28,-22 18,32" fill="var(--obs-body, #fff)" opacity="0.04"/>
        <line x1="-22" y1="-46" x2="-10" y2="46" stroke="var(--obs-feature, #1A1A22)" stroke-width="0.5" opacity="0.18"/>
        <line x1="6" y1="-50" x2="28" y2="-22" stroke="var(--obs-feature, #1A1A22)" stroke-width="0.5" opacity="0.12"/>
        <line x1="28" y1="-22" x2="-10" y2="46" stroke="var(--obs-feature, #1A1A22)" stroke-width="0.5" opacity="0.18"/>
        <line x1="6" y1="-50" x2="18" y2="32" stroke="var(--obs-feature, #1A1A22)" stroke-width="0.5" opacity="0.12"/>
        <line x1="-32" y1="-22" x2="18" y2="32" stroke="var(--obs-feature, #1A1A22)" stroke-width="0.4" opacity="0.08"/>
        <!-- AUDIT_MASCOT #4.1 — obs-inner-star: 8-лучевая звезда Призмы
             внутри тела для Hibernate signature (§13.7). CSS hib-star-glow
             управляет opacity 0→0.22. Default невидим. -->
        <polygon class="obs-inner-star" points="0,-12 1.76,-4.25 8.49,-8.49 4.25,-1.76 12,0 4.25,1.76 8.49,8.49 1.76,4.25 0,12 -1.76,4.25 -8.49,8.49 -4.25,1.76 -12,0 -4.25,-1.76 -8.49,-8.49 -1.76,-4.25" fill="var(--obs-emerge-glow, #fff)" opacity="0"/>
        <!-- AUDIT_MASCOT #4.1 — obs-edge-1/2/3: shimmer-overlay для ls-thinking
             на трёх ключевых гранях body-octagon. CSS only-opacity. -->
        <line class="obs-edge-1" x1="-22" y1="-46" x2="6" y2="-50" stroke="var(--obs-emerge-glow, #fff)" stroke-width="1.2" opacity="0.18"/>
        <line class="obs-edge-2" x1="28" y1="-22" x2="18" y2="32" stroke="var(--obs-emerge-glow, #fff)" stroke-width="1.2" opacity="0.12"/>
        <line class="obs-edge-3" x1="-10" y1="46" x2="-28" y2="12" stroke="var(--obs-emerge-glow, #fff)" stroke-width="1.2" opacity="0.08"/>
      </g>
    </g>
  </g>
  <circle class="obs-eye obs-eye-l" cx="-9" cy="-3" r="1.8" fill="var(--obs-feature, #1A1A22)"/>
  <circle class="obs-eye obs-eye-r" cx="6" cy="-3" r="1.8" fill="var(--obs-feature, #1A1A22)"/>
  <!-- AUDIT_MASCOT #4.1 — obs-lid / obs-lid-l / obs-lid-r: веки. CSS таргетит
       stroke-dashoffset (видимая длина 9 единиц при offset=0). Класс obs-lid
       (без l/r) используется для Blink (синхронный обоих). obs-lid-l/r для
       Awaken/Settle/Wink/Hibernate (с staggered timing). Класс obs-lid стоит
       на обоих path-ах — Blink анимирует оба синхронно. -->
  <path class="obs-lid obs-lid-l" d="M -11.5 -3 L -6.5 -3" stroke="var(--obs-feature, #1A1A22)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-dasharray="9" stroke-dashoffset="9" opacity="0"/>
  <path class="obs-lid obs-lid-r" d="M 3.5 -3 L 8.5 -3" stroke="var(--obs-feature, #1A1A22)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-dasharray="9" stroke-dashoffset="9" opacity="0"/>
  <rect class="obs-bar-l" x="-9.5" y="-3.9" width="0" height="1.8" fill="var(--obs-feature, #1A1A22)"/>
  <rect class="obs-bar-r" x="5.5" y="-3.9" width="0" height="1.8" fill="var(--obs-feature, #1A1A22)"/>
  <path class="obs-brow-l" d="M -14 -10 L -5 -8" stroke="var(--obs-feature, #1A1A22)" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-dasharray="11" stroke-dashoffset="11" opacity="0"/>
  <path class="obs-brow-r" d="M 5 -8 L 14 -10" stroke="var(--obs-feature, #1A1A22)" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-dasharray="11" stroke-dashoffset="11" opacity="0"/>
  <!-- AUDIT_MASCOT #4.1 — obs-spark / obs-spark--2/3/4: 4 искры для Success.
       CSS spark анимирует opacity+scale. Расположены вокруг тела (1 над,
       2 по сторонам, 1 под). Default — opacity:0, transform:scale(0). -->
  <circle class="obs-spark" cx="0" cy="-55" r="2.2" fill="var(--obs-emerge-glow, #fff)" opacity="0" style="transform-origin:0 -55px"/>
  <circle class="obs-spark obs-spark--2" cx="-38" cy="-22" r="2.2" fill="var(--obs-emerge-glow, #fff)" opacity="0" style="transform-origin:-38px -22px"/>
  <circle class="obs-spark obs-spark--3" cx="38" cy="-22" r="2.2" fill="var(--obs-emerge-glow, #fff)" opacity="0" style="transform-origin:38px -22px"/>
  <circle class="obs-spark obs-spark--4" cx="0" cy="50" r="2.2" fill="var(--obs-emerge-glow, #fff)" opacity="0" style="transform-origin:0 50px"/>
  <circle class="obs-emit-1" cx="0" cy="0" r="0" fill="var(--obs-feature, #1A1A22)"/>
  <circle class="obs-emit-2" cx="0" cy="0" r="0" fill="var(--obs-feature, #1A1A22)"/>
  <circle class="obs-emit-3" cx="0" cy="0" r="0" fill="var(--obs-feature, #1A1A22)"/>
  <circle class="obs-emit-4" cx="0" cy="0" r="0" fill="var(--obs-feature, #1A1A22)"/>
  <circle class="obs-return-1" cx="0" cy="0" r="0" fill="var(--obs-feature, #1A1A22)"/>
  <circle class="obs-return-2" cx="0" cy="0" r="0" fill="var(--obs-feature, #1A1A22)"/>
  <circle class="obs-particle" cx="0" cy="-3" r="0" fill="var(--obs-feature, #1A1A22)"/>
  <circle class="obs-socket" cx="-25" cy="-28" r="0" fill="none" stroke="var(--obs-body, #fff)" stroke-width="0.8" opacity="0"/>
  <!-- AUDIT_MASCOT #4.1 — obs-trail-1/-2/-3: «след» от движения тела для
       ls-move в туре. CSS анимирует translate(0→-30px) + opacity 0→0.7→0.
       Расположены за телом (cx=0 центр, обе стороны от eyes). -->
  <circle class="obs-trail-1" cx="0" cy="-3" r="3" fill="var(--obs-body, #fff)" opacity="0"/>
  <circle class="obs-trail-2" cx="0" cy="-3" r="2.5" fill="var(--obs-body, #fff)" opacity="0"/>
  <circle class="obs-trail-3" cx="0" cy="-3" r="2" fill="var(--obs-body, #fff)" opacity="0"/>
</svg>`;

// Hydrate (replace `<use>`-based SVG with rich inline SVG). Idempotent через
// `data-obs-hydrated` маркер. Только hydrate'им элементы которые могут
// проходить Tier 1/Living Shape — обычные иконки оставляем как есть.
function hydrateRichMascot(el) {
  if (!el || el.dataset.obsHydrated === '1') return;
  el.dataset.obsHydrated = '1';
  el.innerHTML = RICH_OBS_SVG;
}

// mM1 fix — split на ambient (T3, всегда живёт) и exclusive (T1+T2+LS).
const AMBIENT_CLASSES = new Set([
  'obs--breathe', 'obs--blink', 'obs--look', 'obs--float', 'obs--sway', 'obs--pulse',
]);
const EXCLUSIVE_CLASSES = [
  // Tier 1 — signature
  'obs--emerge', 'obs--vanish', 'obs--hibernate', 'obs--awaken',
  // Tier 2 — moments
  'obs--ack', 'obs--cur', 'obs--alert', 'obs--success', 'obs--surprised',
  'obs--settle', 'obs--squint', 'obs--wink', 'obs--concerned',
  // Living Shape
  'obs--ls-thinking', 'obs--ls-streaming', 'obs--ls-complete',
  'obs--ls-stop', 'obs--ls-error', 'obs--ls-tool', 'obs--ls-move',
  // helpers
  'obs--once', 'obs--alive',
];
const TIER1_CLASSES = new Set(['obs--emerge', 'obs--vanish', 'obs--hibernate']);

function _clearExclusive(el) {
  if (!el) return;
  for (const c of EXCLUSIVE_CLASSES) el.classList.remove(c);
}
function _ensureAmbient(el, ambient = 'obs--breathe') {
  if (!el) return;
  el.classList.add(ambient);
}
function _reducedMotion() {
  try { return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; }
  catch (_) { return false; }
}
// telemetry hook (design-03 rec) — client-side phase log для UX-метрик.
function _logPhase(target, phase, durMs) {
  try { window.HistoryLog?.event?.('obsidian.phase', { target, phase, durMs }); } catch (_) {}
}

/**
 * Установить exclusive state и вернуться в ambient после animationend.
 * mM3/M3: для error baseState = breathe (concerned стакаем как .obs--alive).
 * M4 fix: clearTimeout при нормальном finish, иначе двойной reset.
 */
function _playOnce(el, stateClass, baseState = 'obs--breathe') {
  if (!el) return Promise.resolve();
  if (_reducedMotion()) {
    // mM3 rec — не навешиваем once-класс в reduced-motion, сразу финал.
    // MD #4.10 — резолвим с `{ _reducedMotion: true }` flag вместо undefined,
    // чтобы будущие consumer'ы (.then(res => res?._reducedMotion ? skip : ...))
    // могли отличить sync-resolve от полного цикла. Существующие callsites
    // (setChatPhase / awaken / vanish) игнорируют value — это safe-добавление.
    _clearExclusive(el);
    if (baseState && !AMBIENT_CLASSES.has(baseState)) el.classList.add(baseState);
    _ensureAmbient(el);
    return Promise.resolve({ _reducedMotion: true });
  }
  return new Promise(resolve => {
    const t0 = Date.now();
    _clearExclusive(el);
    const isTier1 = TIER1_CLASSES.has(stateClass);
    if (!isTier1) _ensureAmbient(el);   // mM1: ambient под T2/LS
    el.classList.add(stateClass);
    el.classList.add('obs--once');
    let done = false;
    let safetyId = 0;
    const finish = () => {
      if (done) return;
      done = true;
      if (safetyId) { clearTimeout(safetyId); safetyId = 0; } // M4 fix
      el.removeEventListener('animationend', finish);
      _clearExclusive(el);
      if (baseState && !AMBIENT_CLASSES.has(baseState)) el.classList.add(baseState);
      _ensureAmbient(el);
      _logPhase(el.id || 'mascot', stateClass, Date.now() - t0);
      resolve();
    };
    el.addEventListener('animationend', finish);
    safetyId = setTimeout(finish, 3500);
  });
}

/** Loop state. Для T1 ambient выключаем (body-scale конфликт). */
function _setLoop(el, stateClass) {
  if (!el) return;
  _clearExclusive(el);
  const isTier1 = TIER1_CLASSES.has(stateClass);
  if (!isTier1) _ensureAmbient(el);
  el.classList.add(stateClass);
  _logPhase(el.id || 'mascot', stateClass, 0);
}

export const ObsidianMascot = {
  _fab: null,
  _avatar: null,
  _hoverBound: false,
  _hoverLeaveTimer: 0,
  _t1Active: false,            // M1 fix — interaction lock
  _alertQueued: false,         // mM2 fix — queue alert during emerge
  _idleTimer: 0,               // mM8 — hibernate trigger
  _idleBound: false,
  _isHibernating: false,

  // AUDIT_MASCOT 7.1 (HIGH) — toggle для скрытия маскота. Persist в localStorage,
  // применяется при init и через hotkey Cmd/Ctrl+Shift+. Юзер с эпилепсией / в
  // долгом фокусе / на screen-share может скрыть FAB одним hotkey'ем без
  // DevTools. Скрытие также отрубает Emerge/Hibernate/idle-таймер.
  isMascotHidden() {
    try { return localStorage.getItem('q2_mascot_hidden') === '1'; } catch (_) { return false; }
  },
  setMascotHidden(hidden) {
    const next = !!hidden;
    try { localStorage.setItem('q2_mascot_hidden', next ? '1' : '0'); } catch (_) {}
    const fabBtn = document.getElementById('assistant-fab');
    if (fabBtn) {
      if (next) {
        fabBtn.classList.add('mascot-hidden');
        // отключаем idle-таймер чтобы не работал в фоне
        if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = 0; }
      } else {
        fabBtn.classList.remove('mascot-hidden');
        // restart idle-таймер
        if (this._idleBound && !this._isHibernating) {
          this._idleTimer = setTimeout(() => this._enterHibernate(), IDLE_HIBERNATE_MS);
        }
      }
    }
    try { _logPhase('mascot', next ? 'mascot-hidden' : 'mascot-shown', 0); } catch (_) {}
    return next;
  },
  toggleMascotHidden() {
    return this.setMascotHidden(!this.isMascotHidden());
  },

  // AUDIT_MASCOT 7.2 (medium) — UI-override размера маскота. Юзер может
  // зафиксировать sm/md/lg, либо оставить 'auto' (тогда работают media-queries
  // в styles.css: <1280px=96, 1280-1919px=144, >=1920px=160).
  // Persist в localStorage.q2_mascot_size; чтение через getMascotSize().
  // Apply делается в init() — set inline-style на :root для --obs-fab-size
  // и --obs-fab-mascot-size. AppSettings UI пишет в localStorage и зовёт
  // applyMascotSize() — без перезагрузки.
  getMascotSize() {
    try {
      const v = localStorage.getItem('q2_mascot_size');
      if (v === 'sm' || v === 'md' || v === 'lg' || v === 'auto') return v;
    } catch (_) {}
    return 'auto';
  },
  setMascotSize(size) {
    const next = (size === 'sm' || size === 'md' || size === 'lg') ? size : 'auto';
    try { localStorage.setItem('q2_mascot_size', next); } catch (_) {}
    this.applyMascotSize();
    return next;
  },
  applyMascotSize() {
    const size = this.getMascotSize();
    const root = document.documentElement;
    if (!root) return;
    if (size === 'auto') {
      root.style.removeProperty('--obs-fab-size');
      root.style.removeProperty('--obs-fab-mascot-size');
      return;
    }
    // sm = 96/80, md = 144/112, lg = 160/124. Совпадает с media-queries.
    const map = { sm: ['96px', '80px'], md: ['144px', '112px'], lg: ['160px', '124px'] };
    const [fab, mascot] = map[size] || map.md;
    root.style.setProperty('--obs-fab-size', fab);
    root.style.setProperty('--obs-fab-mascot-size', mascot);
  },

  // AUDIT_MASCOT 7.3 (medium) — toggle для отключения idle-Hibernate.
  // По умолчанию hibernate включён (default ON). Юзер может выключить через
  // AppSettings → Маскот → «Спящий режим через 5 минут».
  // Persist в localStorage.q2_mascot_hibernate ('1' = on, '0' = off).
  // Метод используется в _enterHibernate() как early-return.
  isHibernateDisabled() {
    try { return localStorage.getItem('q2_mascot_hibernate') === '0'; } catch (_) { return false; }
  },

  // AUDIT_MASCOT 7.4 (low) — программный counter-based suspend/resume.
  // В отличие от mascot-hidden (юзер-выбор), это временное приглушение для
  // preview-модалов и nested flow'ов. 2 suspend → нужны 2 resume.
  // Класс mascot-suspended применяется к .assistant-fab parent'у — стилизация
  // через CSS (см. styles.css "AUDIT_MASCOT 7.4").
  suspend() {
    this._suspendedCount = (this._suspendedCount || 0) + 1;
    if (this._fab) this._fab.parentElement?.classList?.add?.('mascot-suspended');
  },
  resume() {
    this._suspendedCount = Math.max(0, (this._suspendedCount || 0) - 1);
    if (this._suspendedCount === 0 && this._fab) {
      this._fab.parentElement?.classList?.remove?.('mascot-suspended');
    }
  },

  init() {
    this._fab    = document.getElementById('obsidian-fab-mascot');
    this._avatar = document.getElementById('obsidian-chat-avatar');
    if (!this._fab) return;
    // AUDIT_MASCOT 7.1 — apply persisted setting и привязываем hotkey ОДИН раз.
    if (this.isMascotHidden()) {
      const fabBtn = document.getElementById('assistant-fab');
      if (fabBtn) fabBtn.classList.add('mascot-hidden');
    }
    if (!this._hotkeyBound) {
      this._hotkeyBound = true;
      window.addEventListener('keydown', (e) => {
        // Cmd/Ctrl + Shift + . (Period) — toggle.
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '.' || e.code === 'Period')) {
          e.preventDefault();
          const hidden = this.toggleMascotHidden();
          try { Services.Toast?.info?.(hidden ? 'Маскот скрыт' : 'Маскот показан', { ms: 1800 }); } catch (_) {}
        }
      });
    }
    // v22 fail-safe — гарантируем что FAB не останется opacity:0 навсегда.
    // ВАЖНО: НЕ снимать атрибут пока splash активен и Emerge ещё не отыграл —
    // иначе маскот появится готовым кристаллом до signature-момента (вспышка
    // вместо сборки). Атрибут снимаем только если:
    //  · splash отсутствует (другая страница) ИЛИ
    //  · splash уже скрыт ИЛИ
    //  · sessionStorage flag установлен (повторный визит — Emerge уже был).
    // Иначе оставляем pending, splash inline-script сам снимет на 1800ms.
    const fabBtn = document.getElementById('assistant-fab');
    if (fabBtn?.hasAttribute('data-fab-pending')) {
      const splash = document.getElementById('prizma-splash');
      const splashActive = splash
        && splash.style.display !== 'none'
        && !splash.classList.contains('is-done')
        && getComputedStyle(splash).display !== 'none';
      let alreadyEmerged = false;
      try { alreadyEmerged = sessionStorage.getItem(SESSION_KEY) === '1'; } catch (_) {}
      if (!splashActive || alreadyEmerged) {
        fabBtn.removeAttribute('data-fab-pending');
      }
    }
    // v22 mascot-pass — hydrate rich SVG для FAB и chat-avatar (нужны для
    // Emerge / ls-* / Alert / Concerned). Простые `<use>` не передают
    // animation cascade на shadow descendants в Chromium.
    hydrateRichMascot(this._fab);
    if (this._avatar) hydrateRichMascot(this._avatar);
    // AUDIT_MASCOT 7.2 — apply persisted mascot-size override (если не 'auto').
    try { this.applyMascotSize(); } catch (_) {}
    // AUDIT_MASCOT 2.7 — heartbeat last-active каждые 60s + при unload.
    // Используется в _playEmergeIfFirstSession для long-absence detection
    // (>24h → slow awaken + toast «Призма не видела вас сутки»).
    if (!this._lastActiveBound) {
      this._lastActiveBound = true;
      const stamp = () => { try { localStorage.setItem('q2_obsidian_last_active', String(Date.now())); } catch (_) {} };
      stamp();
      this._lastActiveInterval = setInterval(stamp, 60 * 1000);
      window.addEventListener('beforeunload', stamp, { passive: true });
    }
    this._wireFabHover();
    // MD-1 fix — idle-Hibernate включён обратно. Раньше выключали, потому что
    // в светлой теме hibernate-маскот «исчезал» (body #E8E5DA + opacity dim).
    // После VD-2 (white body + 0.9 outline) hibernate-силуэт остаётся
    // читаемым. §13.7 «idle 5+ мин → Hibernate».
    this._wireIdleHibernate();
    this._wireThemeTransition(); // mM10 — добавляет CSS-transition на SVG fill
    this._playEmergeIfFirstSession();
    if (this._avatar) _setLoop(this._avatar, 'obs--breathe');
  },

  _playEmergeIfFirstSession() {
    // На любой reload (F5/Cmd+R/Cmd+Shift+R) сбрасываем emerge-flag, чтобы
    // увидеть Emerge заново. sessionStorage переживает hard reload, поэтому
    // явный removeItem. Splash inline-script делает то же самое — это
    // дублирует на случай, если splash отсутствует на странице.
    try {
      const navType = performance.getEntriesByType('navigation')[0]?.type;
      if (navType === 'reload') sessionStorage.removeItem(SESSION_KEY);
    } catch (_) {}
    let alreadyEmerged = false;
    try { alreadyEmerged = sessionStorage.getItem(SESSION_KEY) === '1'; } catch (_) {}
    // v22 — defer Emerge если сейчас играет splash. Splash inline-script
    // владеет первым Emerge на FAB (запускает на 1800ms, ставит SESSION_KEY
    // после завершения). Init вызывается ~50ms (до splash Emerge phase) —
    // если бы он сам кикнул Emerge, было бы 2 параллельных run'а на одном
    // элементе. Простая проверка: если splash visible → init только ставит
    // Breathe, splash сделает Emerge.
    const splash = (typeof document !== 'undefined') ? document.getElementById('prizma-splash') : null;
    const splashActive = splash
      && splash.style.display !== 'none'
      && !splash.classList.contains('is-done')
      && getComputedStyle(splash).display !== 'none';
    if (alreadyEmerged || _reducedMotion() || splashActive) {
      _setLoop(this._fab, 'obs--breathe');
      return;
    }
    // AUDIT_MASCOT 2.7 — persistent long-absence detect.
    // Если последняя активность >24h назад — после Emerge сыграть slow awaken
    // + ненавязчивый toast «Призма не видела вас сутки». Семантически — «давно
    // не виделись», часть identity маскота §13.7. Heartbeat пишется каждые 60s
    // в init (см. _lastActiveInterval).
    let hoursSinceLastActive = 0;
    try {
      const last = parseInt(localStorage.getItem('q2_obsidian_last_active') || '0', 10);
      if (last) hoursSinceLastActive = (Date.now() - last) / 3600000;
    } catch (_) {}
    this._isLongAbsence = hoursSinceLastActive > 24;
    // M1 fix — лочим interaction до конца T1.
    this._t1Active = true;
    _clearExclusive(this._fab);
    this._fab.classList.add('obs--emerge');
    setTimeout(() => {
      this._t1Active = false;
      _setLoop(this._fab, 'obs--breathe');
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (_) {}
      // mM2: если за время Emerge приходил alert — отыгрываем сейчас.
      if (this._alertQueued) {
        this._alertQueued = false;
        this.pulseAlertOnFab();
      }
      // AUDIT_MASCOT 2.3 — то же для concerned (раньше прорывался поверх Emerge).
      if (this._concernedQueued) {
        this._concernedQueued = false;
        this.pulseConcernedOnFab();
      }
      // AUDIT_MASCOT 2.7 — slow awaken + toast «давно не виделись» через 3000ms
      // после завершения Emerge (даём breathe «закрепиться» 600ms перед awaken).
      if (this._isLongAbsence) {
        this._isLongAbsence = false;
        setTimeout(() => {
          if (!this._fab) return;
          if (this._t1Active) return;
          _playOnce(this._fab, 'obs--awaken', 'obs--breathe');
          try { Services.Toast?.info?.('Призма не видела вас сутки', { ms: 4000 }); } catch (_) {}
        }, 3000);
      }
    }, EMERGE_MS);
  },

  _wireFabHover() {
    if (this._hoverBound || !this._fab) return;
    const btn = this._fab.closest('#assistant-fab') || this._fab;
    btn.addEventListener('mouseenter', () => {
      if (this._t1Active) return;                                 // M1
      if (this._fab.classList.contains('obs--alert')) return;
      // mM4: cancel pending leave-debounce.
      if (this._hoverLeaveTimer) {
        clearTimeout(this._hoverLeaveTimer); this._hoverLeaveTimer = 0;
      }
      _setLoop(this._fab, 'obs--cur');
    });
    btn.addEventListener('mouseleave', () => {
      if (this._t1Active) return;
      if (this._fab.classList.contains('obs--alert')) return;
      // mM4 fix — debounce leave, чтобы Curious end-state мог доиграть.
      if (this._hoverLeaveTimer) clearTimeout(this._hoverLeaveTimer);
      this._hoverLeaveTimer = setTimeout(() => {
        this._hoverLeaveTimer = 0;
        // MD-2 v3 — bridge: capture текущий computed transform body, прибиваем
        // его inline → снимаем obs--cur → transform остаётся inline → next
        // rAF снимаем inline → CSS transition подхватывает переход в neutral.
        // Без этого: при снятии класса animation удаляется и transform мгновенно
        // сбрасывается к default — transition не успевает зацепиться, виден
        // визуальный snap.
        const body = this._fab.querySelector('.obs-body');
        if (body) {
          const computed = getComputedStyle(body).transform;
          if (computed && computed !== 'none') {
            body.style.transform = computed;
            // Force reflow чтобы inline style записался в layout.
            void body.offsetWidth;
            _clearExclusive(this._fab);
            _ensureAmbient(this._fab);
            requestAnimationFrame(() => {
              body.style.transform = '';
              setTimeout(() => { body.style.transform = ''; }, 280);
            });
            return;
          }
        }
        _setLoop(this._fab, 'obs--breathe');
      }, HOVER_LEAVE_DEBOUNCE_MS);
    });
    this._hoverBound = true;
  },

  // mM8 fix — idle-таймер 5 мин → vanish → hibernate. Любой input — awaken.
  // AUDIT_MASCOT 2.1 (HIGH) — `visibilitychange` УБРАН из reset-events:
  // на каждый Cmd+Tab idle-counter обнулялся, и Hibernate в реальном
  // workflow (юзер постоянно прыгает между вкладками) **никогда не
  // срабатывал**. §13.7 «idle 5+ мин → Hibernate» был нерабочим.
  // Теперь counter тикает независимо от tab-switch'ей.
  _wireIdleHibernate() {
    if (this._idleBound) return;
    this._idleBound = true;
    const reset = () => {
      if (this._idleTimer) clearTimeout(this._idleTimer);
      if (this._isHibernating) this._wakeFromHibernate();
      this._idleTimer = setTimeout(() => this._enterHibernate(), IDLE_HIBERNATE_MS);
    };
    // medium-2.5 — mousemove fires 60-120Hz, reset() clearTimeout+setTimeout
    // per call = wasted churn. Throttle к ≤1 reset/sec; pointerdown/keydown
    // остаются без throttle (низкая частота, важно реагировать сразу).
    let throttleTimer = 0;
    const resetThrottled = () => {
      if (throttleTimer) return;
      throttleTimer = setTimeout(() => { throttleTimer = 0; reset(); }, 1000);
    };
    window.addEventListener('mousemove', resetThrottled, { passive: true });
    ['keydown', 'pointerdown'].forEach(ev => {
      window.addEventListener(ev, reset, { passive: true });
    });
    // Возвращение из background → если был hibernate, проиграть awaken.
    // Не reset counter (это было багом 2.1) — просто продолжаем счётчик
    // оттуда где остановились.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this._isHibernating) this._wakeFromHibernate();
    }, { passive: true });
    reset();
  },
  async _enterHibernate() {
    // AUDIT_MASCOT 7.3 — пользовательский opt-out (см. isHibernateDisabled / AppSettings).
    if (this.isHibernateDisabled()) return;
    if (this._isHibernating || this._t1Active || !this._fab) return;
    if (_reducedMotion()) return;
    // AUDIT_MASCOT 2.2 (HIGH) — расширенный guard: не засыпать пока чат
    // активен (thinking/streaming/tool) или есть alert. До фикса маскот
    // мог уснуть прямо во время LLM-стрима, если юзер 5min не двигал
    // мышью (ждал длинный ответ) — выглядело как «всё сломалось».
    const f = this._fab;
    if (f.classList.contains('obs--alert')) return;
    if (f.classList.contains('obs--ls-thinking')) return;
    if (f.classList.contains('obs--ls-streaming')) return;
    if (f.classList.contains('obs--ls-tool')) return;
    // Также проверяем header avatar — chat-фаза может быть не на FAB но
    // активна (юзер открыл чат, FAB скрыт через setFabVisible(false)).
    const av = this._avatar;
    if (av && (av.classList.contains('obs--ls-thinking') || av.classList.contains('obs--ls-streaming') || av.classList.contains('obs--ls-tool'))) return;
    // Дополнительно — глобальный flag (если он есть в state).
    try { if (window.state?.llm?.isStreaming) return; } catch (_) {}
    this._isHibernating = true;
    // AUDIT_MASCOT 2.4 — фиксируем момент входа для метрики «как долго спал».
    this._hibernateStartedAt = Date.now();
    await _playOnce(this._fab, 'obs--vanish', null);
    _clearExclusive(this._fab);
    this._fab.classList.add('obs--hibernate');
    _logPhase('mascot', 'obs--hibernate', 0);
  },
  async _wakeFromHibernate() {
    if (!this._isHibernating || !this._fab) return;
    this._isHibernating = false;
    // AUDIT_MASCOT 2.4 — фиксируем сколько простоял в hibernate.
    if (this._hibernateStartedAt) {
      _logPhase('mascot', 'hibernate-end', Date.now() - this._hibernateStartedAt);
      this._hibernateStartedAt = 0;
    }
    await _playOnce(this._fab, 'obs--awaken', 'obs--breathe');
  },

  // mM10 fix — smooth fill/stroke transition на theme switch.
  _wireThemeTransition() {
    if (document.getElementById('obs-theme-transition-style')) return;
    const style = document.createElement('style');
    style.id = 'obs-theme-transition-style';
    style.textContent = `
      .obs svg path, .obs svg circle, .obs svg rect, .obs svg ellipse {
        transition: fill 200ms var(--obs-ease-out, ease-out),
                    stroke 200ms var(--obs-ease-out, ease-out);
      }
      /* MD-5 — bars (Alert/Squint), brows (Concerned/Error), emit/return/
         particle (Living Shape) и socket анимируют r/x/width/opacity через
         keyframes. Общий 200ms fill-transition сверху давал «жирный» feel
         на быстрых 18-24% Alert-атаках. Отключаем transition только на этих
         элементах — fill/stroke на них не меняется при theme-switch
         (используют var(--obs-feature) который уже синхронен с body). */
      .obs .obs-bar-l, .obs .obs-bar-r,
      .obs .obs-brow-l, .obs .obs-brow-r,
      .obs .obs-emit-1, .obs .obs-emit-2, .obs .obs-emit-3, .obs .obs-emit-4,
      .obs .obs-return-1, .obs .obs-return-2,
      .obs .obs-particle, .obs .obs-socket, .obs .obs-ring, .obs .obs-blade,
      .obs .obs-edge-l, .obs .obs-edge-r {
        transition: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .obs svg path, .obs svg circle, .obs svg rect, .obs svg ellipse {
          transition: none !important;
        }
      }`;
    document.head.appendChild(style);
  },

  setFabVisible(visible) {
    const btn = document.getElementById('assistant-fab');
    if (!btn) return;
    btn.classList.toggle('hidden', !visible);
    // M1 hint: если скрыли FAB во время Emerge — снять класс, чтобы анимация
    // не крутилась «вслепую» под opacity 0.
    if (!visible && this._fab?.classList.contains('obs--emerge')) {
      _clearExclusive(this._fab);
      _ensureAmbient(this._fab);
    }
    // medium-3.2 — FAB hidden, но idle-таймер тикает в фоне → за 5min uлетает
    // в Hibernate под opacity:0, при show юзер видит «застрявший» силуэт. При
    // !visible останавливаем таймер; при visible — рестарт (если bound и не
    // в hibernate). Без этого setFabVisible(true) после hibernate не вернул
    // бы маскот в живое состояние.
    if (!visible) {
      if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = 0; }
    } else {
      if (this._fab) _setLoop(this._fab, 'obs--breathe');
      if (this._idleBound && !this._isHibernating) {
        if (this._idleTimer) clearTimeout(this._idleTimer);
        this._idleTimer = setTimeout(() => this._enterHibernate(), IDLE_HIBERNATE_MS);
      }
    }
  },

  // V22 (mascot-pass) — публичный API для повторного использования Emerge
  // на произвольном элементе (welcome-screen, hero-blocks). Внутри
  // _playOnce: clear exclusive → add 'obs--emerge' + 'obs--once' → animationend
  // → перейти в baseState (default 'obs--breathe'). Для welcome FAB-Emerge
  // отдельно через _playEmergeIfFirstSession (sessionStorage guard).
  playEmergeOn(el, baseState = 'obs--breathe') {
    if (!el) return Promise.resolve();
    el.classList.add('obs');
    // v22 — гарантируем rich SVG (даже если HTML был с `<use href="#obs-base">`).
    hydrateRichMascot(el);
    return _playOnce(el, 'obs--emerge', baseState);
  },
  // Сбрасывает классы emerge/breathe — нужно при повторном показе
  // welcome'а в одной сессии (без этого animationend уже отыграл).
  resetMascot(el) {
    if (!el) return;
    _clearExclusive(el);
    el.classList.remove('obs--breathe', 'obs--blink', 'obs--look', 'obs--float', 'obs--sway', 'obs--pulse');
  },

  pulseAlertOnFab() {
    if (!this._fab) return;
    const btn = document.getElementById('assistant-fab');
    if (btn?.classList.contains('hidden')) return;
    // mM2 fix — не перебиваем Emerge; ставим в очередь.
    if (this._t1Active || this._fab.classList.contains('obs--emerge')) {
      this._alertQueued = true;
      return;
    }
    // AUDIT_MASCOT 3.1 — flag «есть непросмотренное событие». Снимется
    // в FAB-click (см. llmAssistant.js). Используется для подсветки
    // последнего сообщения при открытии чата.
    this._hasUnseenAlert = true;
    _playOnce(this._fab, 'obs--alert', 'obs--breathe');
  },

  // design-01 F — concerned-pulse на FAB при ошибке чата.
  pulseConcernedOnFab() {
    if (!this._fab) return;
    const btn = document.getElementById('assistant-fab');
    if (btn?.classList.contains('hidden')) return;
    // AUDIT_MASCOT 2.3 (medium) — симметрично pulseAlertOnFab: guard
    // на _t1Active И на queue если в Emerge. До фикса concerned мог
    // прорваться поверх Emerge → нарушение «T1+T2 нельзя стакать» §13.9.
    if (this._t1Active || this._fab.classList.contains('obs--emerge')) {
      this._concernedQueued = true;
      return;
    }
    this._hasUnseenAlert = true;
    _playOnce(this._fab, 'obs--concerned', 'obs--breathe');
  },

  // AUDIT_MASCOT #8.2 — публичный API для consumer'ов которым нужно засечь
  // вход/выход в фазу с ms-длительностью (а не loop-старт с durMs=0). Не
  // переписывает _setLoop (он используется во многих местах), а даёт
  // отдельный helper. Будущие call-sites: tour-step телеметрия, idle/hibernate
  // длительности и т.п.
  _phaseEnterAt: new Map(),
  _logPhaseEnter(target, phase) {
    const key = target + ':' + phase;
    this._phaseEnterAt.set(key, Date.now());
    _logPhase(target, phase + '_enter', 0);
  },
  _logPhaseExit(target, phase) {
    const key = target + ':' + phase;
    const start = this._phaseEnterAt.get(key);
    if (start) {
      this._phaseEnterAt.delete(key);
      _logPhase(target, phase + '_exit', Date.now() - start);
    }
  },

  /**
   * Сменить фазу чат-аватара (главного header-аватара ИЛИ per-message).
   *   'idle' — breathe; 'thinking' — ls-thinking; 'streaming' — ls-streaming;
   *   'complete' — once → breathe; 'stop' — once → breathe;
   *   'error' — once → breathe (M3 fix; concerned стакаем как .obs--alive);
   *   'tool' — once → ls-streaming.
   *
   * design-03 rec — между thinking → streaming пускаем короткий ack-bridge.
   */
  setChatPhase(phase, targetEl) {
    const el = targetEl || this._avatar;
    if (!el) return;
    const wasThinking = el.classList.contains('obs--ls-thinking');
    // AUDIT_MASCOT 3.4 / 6.3 (HIGH) — guard для async-chains: если ДО
    // resolve() элемент пере-создан (renderMessages) или history дальше
    // продвинулся (юзер послал новое сообщение), запоздавший .then()
    // навешает concerned/cur на устаревшее сообщение. Снапшотим
    // history.length и проверяем el.isConnected перед апдейтом.
    const startHistLen = (() => { try { return window.state?.llm?.history?.length || 0; } catch (_) { return 0; } })();
    const stillRelevant = () => {
      if (!el.isConnected) return false;
      try { if ((window.state?.llm?.history?.length || 0) !== startHistLen) return false; } catch (_) {}
      return true;
    };
    switch (phase) {
      case 'idle':
        _setLoop(el, 'obs--breathe');
        break;
      case 'thinking':
        _setLoop(el, 'obs--ls-thinking');
        break;
      case 'streaming':
        if (wasThinking) {
          // ack-bridge: короткий «кивок принял» перед стримом.
          // AUDIT_MASCOT 6.5 — _playOnce уже ставит ls-streaming как baseState;
          // двойной _setLoop тут лишний, убран.
          _playOnce(el, 'obs--ack', 'obs--ls-streaming');
        } else {
          _setLoop(el, 'obs--ls-streaming');
        }
        break;
      case 'complete':
        _playOnce(el, 'obs--ls-complete', 'obs--breathe');
        break;
      case 'stop':
        _playOnce(el, 'obs--ls-stop', 'obs--breathe');
        break;
      case 'error':
        // mM3 fix — error возвращается в Breathe (concerned не loop).
        // IxD-3 — после ls-error transition стакаем concerned+alive поверх
        // breathe: §13.7 «модель упала → ls-error → потом alive-stack
        // concerned». Concerned анимация играет 1 раз (animation-fill-mode:
        // both, без infinite) → eyes drop+converge, brows draw, и замирает
        // в final-frame. obs--alive даёт «тихое дыхание» поверх грусти.
        _playOnce(el, 'obs--ls-error', 'obs--breathe').then(() => {
          if (!stillRelevant()) return;
          el.classList.add('obs--concerned', 'obs--alive');
        });
        break;
      case 'tool':
        // AUDIT_MASCOT #6.1 — TODO: контроллер готов, но callsites нет (GigaChat
        // tool-use не используется в проекте). Анимация ls-tool отыграется только
        // когда `chatActivityHandler.js` или другой LLM-flow начнёт явно вызывать
        // `setChatPhase('tool')`. До тех пор — мёртвый код.
        _playOnce(el, 'obs--ls-tool', 'obs--breathe').then(() => {
          if (!stillRelevant()) return;
          _setLoop(el, 'obs--ls-streaming');
        });
        break;
      case 'move':
        // IxD-1 — tour-step transition (§13.7 «шаг онбординга → ls-move»).
        // ls-move 4000ms (overshoot-swim) → curious 2200ms (landing-jest) →
        // breathe. Раньше тур использовал ls-tool (наклон к toolnsocket),
        // что семантически ближе к chat-tool-use.
        _playOnce(el, 'obs--ls-move', 'obs--breathe').then(() => {
          if (!stillRelevant()) return;
          _playOnce(el, 'obs--cur', 'obs--breathe');
        });
        break;
      default:
        break;
    }
  },

  // design-01 A — phase для per-message avatar по индексу сообщения.
  setMessageAvatarPhase(idx, phase) {
    const el = document.querySelector(`.msg-row[data-index="${idx}"] .msg-avatar`);
    if (!el) return;
    hydrateRichMascot(el);
    this.setChatPhase(phase, el);
  },
  // v22 — public hydrate для внешних callsite'ов (toast, tour, splash, welcome).
  hydrate(el) { hydrateRichMascot(el); },
};

Services.register('ObsidianMascot', ObsidianMascot);
if (typeof window !== 'undefined') window.ObsidianMascot = ObsidianMascot;
