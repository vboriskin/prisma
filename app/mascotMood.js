'use strict';
/* ============================================================================
   MascotMood — AUDIT_HOLISTIC F11 / Идея 12 «барометр портфеля».
   --
   Маскот перестаёт быть декорацией и начинает отражать состояние плана:
     · on-course  — 0 off-course рисков, ≤2 drift → breathe (default ambient)
     · drift      — 1+ drift, 0 off-course → obs--cur (slight tilt + look)
     · off-course — 1+ off-course → obs--alert (СПОКОЙНЫЙ: единичный pulse,
                    не loop alarm; respect tone «спокойный, не тревожный» §7
                    BRAND_BOOK).
     · thinking   — активный AI-flow (state.llm.isStreaming) → obs--ls-thinking
     · success    — после long task (Pulse refresh / AI update) → obs--success
                    1.5s → возврат в base.

   Контракты CLAUDE.md (которые нельзя нарушать):
     · НЕ вызываем Storage.save() напрямую (мы вообще не пишем в state).
     · Identity-deterministic (нерелевантно — мы не атрибутируем людей).
     · Reactive.silent — нерелевантно: mood READ-ONLY, никаких mutations.

   Подписка на источники:
     · Reactive.subscribe — главный канал (state.rows[i].riskScore meняется
       через Proxy → debounced flush → пересчёт mood).
     · interval-fallback (5s) — для Set/Map ops которые Proxy не видит и для
       state.llm.isStreaming (нет геттера-flag в Proxy для bool-flag-флипа).

   Throttle:
     · Не больше 1 mood-change в 1500ms (debounce).
     · prefers-reduced-motion: только on-course (breathe), всё остальное no-op.
     · localStorage flag `q2_mascot_mood_disabled = '1'` → mood-ring выключен,
       маскот остаётся в default breathe (юзер-выбор).

   Glue к ObsidianMascot:
     · Используем существующий API (см. app/obsidianMascot.js). НЕ дублируем
       state-machine — переключаем классы через пере-использование эффектов:
         on-course   → _setLoop/breathe (через resetMascot + ensureAmbient)
         drift       → _setLoop('obs--cur')   через прямую class-mutation
         off-course  → pulseAlertOnFab() (одиночный pulse, очередь уже есть)
         thinking    → setChatPhase('thinking', fab)  (loop ls-thinking)
         success     → _playOnce('obs--success')      через setChatPhase API
       Поскольку ObsidianMascot не экспортит низкоуровневые helpers, MascotMood
       работает ТОЛЬКО через публичные методы и аккуратные class-toggle'ы.
   ============================================================================ */

import { state, subscribe as stateSubscribe } from '../state.js';
import { Reactive } from '../reactiveStore.js';

/* ---- константы --------------------------------------------------------- */

const MOOD_DISABLED_KEY = 'q2_mascot_mood_disabled';
const DEBOUNCE_MS       = 1500;
const FALLBACK_POLL_MS  = 5000;
const SUCCESS_HOLD_MS   = 1500;

// Пороги совпадают с views/registry.js:458 (>=60 red, >=30 orange).
// Локальные константы вместо magic-numbers — переопределяемы для тестов.
const RISK_OFF_COURSE_THRESHOLD = 60;
const RISK_DRIFT_THRESHOLD      = 30;
const DRIFT_TOLERANCE_COUNT     = 2;   // <=2 drift всё ещё on-course

/** @typedef {'on-course'|'drift'|'off-course'|'thinking'|'success'|'cur'} Mood */
// AUDIT_HOLISTIC §5.1 «Утро тимлида» — `cur` = «я смотрю с тобой».
// Активен пока state.meta.focus !== null. Управляется через
// Focus.set/clear → MascotMood.setCursor/clearCursor (внизу).

/* ---- helpers ----------------------------------------------------------- */

function _reducedMotion() {
  try { return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; }
  catch (_) { return false; }
}

function _isMoodDisabled() {
  try { return globalThis.localStorage?.getItem(MOOD_DISABLED_KEY) === '1'; }
  catch (_) { return false; }
}

/**
 * Классифицировать row по riskScore: 'off-course' | 'drift' | 'on-course'.
 * Совпадает с registry.js:458 семантикой.
 * @param {{ riskScore?: number }} row
 */
function _classifyRow(row) {
  const s = Number(row?.riskScore) || 0;
  if (s >= RISK_OFF_COURSE_THRESHOLD) return 'off-course';
  if (s >= RISK_DRIFT_THRESHOLD)      return 'drift';
  return 'on-course';
}

/**
 * Чистая функция (тестируема изолированно).
 * @param {{ rows?: Array<{ riskScore?: number }>, llm?: { isStreaming?: boolean } }} stateLike
 * @param {{ pendingSuccess?: boolean }} [flags]
 * @returns {Mood}
 */
export function computeMoodFromState(stateLike, flags = {}) {
  if (flags.pendingSuccess) return 'success';
  if (stateLike?.llm?.isStreaming) return 'thinking';
  const rows = Array.isArray(stateLike?.rows) ? stateLike.rows : [];
  let off = 0, drift = 0;
  for (const r of rows) {
    const c = _classifyRow(r);
    if (c === 'off-course') off++;
    else if (c === 'drift') drift++;
    if (off > 0 && drift > DRIFT_TOLERANCE_COUNT) break; // короткое замыкание
  }
  if (off > 0)                       return 'off-course';
  if (drift > DRIFT_TOLERANCE_COUNT) return 'drift';
  return 'on-course';
}

/* ---- singleton --------------------------------------------------------- */

const _AMBIENT_LOOP_CLASSES = ['obs--cur', 'obs--ls-thinking'];

/** Прямой class-toggle на FAB. ObsidianMascot не экспортит _setLoop публично,
 *  поэтому делаем минимальный no-op-safe equivalent: clear из ambient set →
 *  ensure breathe → add target. Если FAB не найден — silent skip. */
function _applyLoopClass(fabEl, loopClass) {
  if (!fabEl) return;
  for (const c of _AMBIENT_LOOP_CLASSES) {
    if (c !== loopClass) fabEl.classList.remove(c);
  }
  // breathe всегда живёт как ambient (см. AMBIENT_CLASSES в obsidianMascot.js)
  fabEl.classList.add('obs--breathe');
  if (loopClass) fabEl.classList.add(loopClass);
}

function _clearAllMoodLoops(fabEl) {
  if (!fabEl) return;
  for (const c of _AMBIENT_LOOP_CLASSES) fabEl.classList.remove(c);
}

export const MascotMood = {
  _currentMood: /** @type {Mood} */ ('on-course'),
  _override:    /** @type {Mood|null} */ (null),
  _debounceTimer: 0,
  _intervalTimer: 0,
  _unsubReactive: /** @type {(() => void)|null} */ (null),
  _unsubState:    /** @type {(() => void)|null} */ (null),
  _bound: false,
  _successResetTimer: 0,
  _pendingSuccess: false,
  _lastTransitionAt: 0,

  /** Лениво находим FAB. ObsidianMascot.init() мог ещё не отработать. */
  _getFab() {
    try { return globalThis.document?.getElementById?.('obsidian-fab-mascot') || null; }
    catch (_) { return null; }
  },

  /** Подписка на все источники. Идемпотентно. */
  subscribe() {
    if (this._bound) return;
    this._bound = true;

    // 1. Reactive proxy (state mutations через Proxy)
    if (Reactive?.subscribe) {
      this._unsubReactive = Reactive.subscribe(() => this._scheduleUpdate());
    }
    // 2. state.notify (explicit reasons: import-csv, restore, chat_filter)
    if (typeof stateSubscribe === 'function') {
      this._unsubState = stateSubscribe(() => this._scheduleUpdate());
    }
    // 3. interval-fallback (Set/Map ops + isStreaming flag-flip)
    if (this._intervalTimer === 0 && typeof globalThis.setInterval === 'function') {
      this._intervalTimer = globalThis.setInterval(
        () => this._scheduleUpdate(),
        FALLBACK_POLL_MS,
      );
    }

    // первичный расчёт сразу
    this._scheduleUpdate();
  },

  /** Полная отписка — для cleanup в тестах и при настройке отключения mood. */
  unsubscribe() {
    if (this._unsubReactive) { try { this._unsubReactive(); } catch (_) {} this._unsubReactive = null; }
    if (this._unsubState)    { try { this._unsubState();    } catch (_) {} this._unsubState    = null; }
    if (this._intervalTimer && typeof globalThis.clearInterval === 'function') {
      globalThis.clearInterval(this._intervalTimer);
      this._intervalTimer = 0;
    }
    if (this._debounceTimer && typeof globalThis.clearTimeout === 'function') {
      globalThis.clearTimeout(this._debounceTimer);
      this._debounceTimer = 0;
    }
    if (this._successResetTimer && typeof globalThis.clearTimeout === 'function') {
      globalThis.clearTimeout(this._successResetTimer);
      this._successResetTimer = 0;
    }
    this._bound = false;
  },

  /** Manual override. Передай null чтобы вернуть авто-режим. */
  setMood(mood) {
    if (mood === null || mood === undefined) {
      this._override = null;
      this._scheduleUpdate();
      return;
    }
    this._override = /** @type {Mood} */ (mood);
    this._applyMood(mood);
  },

  /**
   * AUDIT_HOLISTIC §5.1 — переключить FAB в 'cur' loop пока активен focus.
   * Реализовано как override → авто-режим вернётся через clearCursor().
   * Идемпотентно.
   */
  setCursor() {
    if (_reducedMotion() || _isMoodDisabled()) return;
    this._override = /** @type {Mood} */ ('cur');
    this._applyMood('cur');
  },

  /** Снять cursor-override → вернуть авто-режим. */
  clearCursor() {
    if (this._override === 'cur') {
      this._override = null;
      this._scheduleUpdate();
    }
  },

  /** Триггер success-флага: маскот сыграет obs--success → вернётся в base
   *  через SUCCESS_HOLD_MS. Используется из Pulse-refresh / AI-update
   *  callsites: `MascotMood.flashSuccess()`. */
  flashSuccess() {
    if (_reducedMotion() || _isMoodDisabled()) return;
    this._pendingSuccess = true;
    this._scheduleUpdate();
    if (this._successResetTimer && typeof globalThis.clearTimeout === 'function') {
      globalThis.clearTimeout(this._successResetTimer);
    }
    this._successResetTimer = globalThis.setTimeout(() => {
      this._pendingSuccess = false;
      this._successResetTimer = 0;
      this._scheduleUpdate();
    }, SUCCESS_HOLD_MS);
  },

  /** Текущий применённый mood. */
  getCurrentMood() { return this._currentMood; },

  /** Включить/выключить mood-ring (persist в localStorage). */
  setDisabled(disabled) {
    try {
      if (disabled) globalThis.localStorage?.setItem(MOOD_DISABLED_KEY, '1');
      else          globalThis.localStorage?.removeItem(MOOD_DISABLED_KEY);
    } catch (_) {}
    if (disabled) {
      // Сбрасываем активный mood, остаёмся в breathe.
      const fab = this._getFab();
      _clearAllMoodLoops(fab);
      this._currentMood = 'on-course';
    } else {
      this._scheduleUpdate();
    }
  },
  isDisabled() { return _isMoodDisabled(); },

  /**
   * Force-update (используется в тестах, чтобы не ждать debounce).
   * Production-callsites обычно идут через _scheduleUpdate().
   */
  update(stateLike = state) {
    if (_isMoodDisabled()) return;
    const next = this._override
      ? this._override
      : computeMoodFromState(stateLike, { pendingSuccess: this._pendingSuccess });
    this._applyMood(next);
  },

  /* ---- internals ------------------------------------------------------- */

  /** Debounced update — гарантирует ≤1 переход за DEBOUNCE_MS. */
  _scheduleUpdate() {
    if (_isMoodDisabled()) return;
    if (this._debounceTimer) return;            // уже scheduled
    this._debounceTimer = globalThis.setTimeout(() => {
      this._debounceTimer = 0;
      try { this.update(state); }
      catch (e) { try { console?.warn?.('[mascotMood] update threw:', e); } catch (_) {} }
    }, DEBOUNCE_MS);
  },

  /** Применение mood'а на DOM. Идемпотентно — same-mood = no-op. */
  _applyMood(mood) {
    if (mood === this._currentMood) return;

    // reduced-motion guard: разрешаем только переход в on-course (нейтраль).
    if (_reducedMotion() && mood !== 'on-course') return;

    const fab = this._getFab();
    this._currentMood = mood;
    this._lastTransitionAt = Date.now();

    if (!fab) return;     // SSR / тест без DOM — просто храним state

    const OM = globalThis.ObsidianMascot;

    switch (mood) {
      case 'on-course':
        _clearAllMoodLoops(fab);
        // breathe — сам по себе всегда живёт как ambient в obsidianMascot.
        // На всякий случай добавим явно:
        fab.classList.add('obs--breathe');
        break;

      case 'drift':
        // Slight tilt + look — без alert-vibes. Тон «спокойный».
        _applyLoopClass(fab, 'obs--cur');
        break;

      case 'off-course':
        _clearAllMoodLoops(fab);
        // Один pulse, не loop. respect §7 BRAND_BOOK «спокойный, не тревожный».
        // ObsidianMascot.pulseAlertOnFab уже умеет очередью / Emerge-guard.
        try { OM?.pulseAlertOnFab?.(); }
        catch (_) {}
        break;

      case 'thinking':
        // ls-thinking loop. ObsidianMascot.setChatPhase понимает FAB как target.
        try { OM?.setChatPhase?.('thinking', fab); }
        catch (_) { _applyLoopClass(fab, 'obs--ls-thinking'); }
        break;

      case 'cur':
        // AUDIT_HOLISTIC §5.1 — focus-якорь активен. Slight tilt + look,
        // тон «спокойный, я смотрю с тобой». Тот же loop class, что и drift,
        // но triggered explicitly из Focus.set, не из risk-классификации.
        _applyLoopClass(fab, 'obs--cur');
        break;

      case 'success':
        // success — once → breathe. ObsidianMascot не экспортит helper напрямую,
        // но setChatPhase('complete') = ls-complete → breathe; для success мы
        // хотим именно obs--success (другая анимация). Делаем minimal once-add
        // с safe-cleanup.
        _clearAllMoodLoops(fab);
        fab.classList.remove('obs--success');
        // force reflow чтобы animation re-trigger'нулась если уже играла
        void fab.offsetWidth;
        fab.classList.add('obs--success', 'obs--once');
        // animationend прибирает obs--once + obs--success в obsidian.css —
        // если class останется висеть, наш success-таймер всё равно сменит mood.
        break;

      default:
        break;
    }
  },
};

if (typeof globalThis !== 'undefined') globalThis.MascotMood = MascotMood;
