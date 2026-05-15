'use strict';
/* ============================================================
   app/focusManager.js — AUDIT_HOLISTIC §5.1 «Утро тимлида»
   --
   Единый «контекст-якорь» для cross-section UX-сценария
   Дашборд → Сканнер → Сотрудник → AI Анализ → Действия.

   Ранее каждая секция держала свой mini-state; тимлид четырежды
   заново выставлял «Иванов в команде Альфа за неделю». Здесь —
   single source of truth: `state.meta.focus`.

   Public API:
     · Focus.set({kind, id, period?, source?})
         — записывает state.meta.focus = {...} (через Reactive proxy →
           debounced flush). Эмитит EventBus.emit('focus-changed', focus).
           Push'ит entry в history (для Cmd+[ / Cmd+]).
     · Focus.clear()
         — state.meta.focus = null + emit('focus-changed', null).
           НЕ трогает history (Cmd+[ всё ещё может вернуть).
     · Focus.get() → текущий focus.
     · Focus.history.push(focus) — обычно дёргается только из set();
           прямое использование — для тестов.
     · Focus.back() / Focus.forward() — навигация по ring buffer.
     · Focus.bindHotkeys() — Cmd+[ → back, Cmd+] → forward
                              (Ctrl+ на Win/Linux). Идемпотентно.
     · Focus.unbindHotkeys() — для тестов.

   Контракты:
     · `kind` ∈ 'employee' | 'epic' | 'team' | 'release' | 'block-id'
     · `period` ∈ '7d' | '14d' | '30d' | 'q' | 'all' (default '7d')
     · `id` — identity-deterministic (email / jiraAccountId / team-name /
              release-window / Jira-key). НЕ ФИО (CLAUDE.md контракт #2).
     · НЕ вызывает Storage.save() напрямую — вся persistence идёт
       через Reactive proxy.
     · Mass-mutation: при `set()` мы пишем ОДНО поле — Reactive proxy
       сам соберёт debounced flush. Reactive.silent НЕ нужен.
     · Hotkey-handler пропускает event если фокус внутри input/textarea/
       contenteditable (чтобы не воровать Cmd+[ у текстового редактора).

   Toast feedback:
     При set() показываем transient toast «Контекст: <label> · <period>»
     через ToastQueue.show({persist:false}). Если ToastQueue не загружен
     (тесты / SSR) — silent skip.

   Маскот integration:
     При focus !== null → MascotMood.setCursor() — переключает FAB
     в 'cur' loop (obs--cur, «я смотрю с тобой»).
     При focus === null → MascotMood.clearCursor() — возврат в авто-режим.
   ============================================================ */

import { state } from '../state.js';
import { Reactive } from '../reactiveStore.js';
import { EventBus } from './eventBus.js';
import { Services } from './services.js';

/* ── Константы / валидация ──────────────────────────── */

const VALID_KINDS = Object.freeze(
  ['employee', 'epic', 'team', 'release', 'block-id'],
);
const VALID_PERIODS = Object.freeze(
  ['7d', '14d', '30d', 'q', 'all'],
);
const HISTORY_CAP = 20;
const DEFAULT_PERIOD = '7d';

/* ── Internal state (не персистится — только runtime) ── */

const _history = []; // ring buffer of focus-snapshots
let _historyIdx = -1; // указатель: -1 = «после head», 0..len-1 = текущая
let _hotkeysBound = false;
let _onKeyDown = null;

/* ── Helpers ─────────────────────────────────────────── */

function _isInputActive() {
  try {
    const el = (typeof document !== 'undefined') && document.activeElement;
    if (!el) return false;
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  } catch (_) { return false; }
}

function _validatePeriod(p) {
  if (p == null || p === '') return DEFAULT_PERIOD;
  return VALID_PERIODS.includes(p) ? p : DEFAULT_PERIOD;
}

function _validateKind(k) {
  return VALID_KINDS.includes(k);
}

function _normalizeFocus(input) {
  if (!input || typeof input !== 'object') return null;
  const kind = String(input.kind || '');
  if (!_validateKind(kind)) return null;
  const id = String(input.id || '').trim();
  if (!id) return null;
  const period = _validatePeriod(input.period);
  const source = input.source ? String(input.source) : '';
  const out = { kind, id, period };
  if (source) out.source = source;
  return out;
}

/** Equality: ignore source field (две одинаковых set() из разных мест
 *  не должны раздувать history). */
function _focusEquals(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.id === b.id && a.period === b.period;
}

function _humanLabelForFocus(f) {
  if (!f) return '';
  // Identity-deterministic: id может быть email — обрезаем до local-part.
  const id = String(f.id || '');
  let label = id;
  if (f.kind === 'employee' && id.includes('@')) {
    label = id.split('@')[0];
  }
  // Period в человекочитаемом виде.
  const periodMap = {
    '7d':  'последняя неделя',
    '14d': 'последние две недели',
    '30d': 'последний месяц',
    'q':   'квартал',
    'all': 'весь период',
  };
  const periodLabel = periodMap[f.period] || f.period || '';
  return periodLabel ? `${label} · ${periodLabel}` : label;
}

function _emitChanged(focus) {
  try { EventBus.emit('focus-changed', focus); } catch (_) {}
}

function _showToast(focus) {
  if (!focus) return;
  try {
    const TQ = (typeof window !== 'undefined') && Services.ToastQueue;
    if (!TQ || typeof TQ.show !== 'function') return;
    TQ.show({
      msg: `Контекст: ${_humanLabelForFocus(focus)}`,
      type: 'info',
      ms: 2400,
      mascot: 'info',
      persist: false,
    });
  } catch (_) { /* toast — best-effort */ }
}

function _applyMascotCursor(focus) {
  try {
    const MM = (typeof globalThis !== 'undefined') && globalThis.MascotMood;
    if (!MM) return;
    if (focus) {
      if (typeof MM.setCursor === 'function') MM.setCursor();
      else if (typeof MM.setMood === 'function') MM.setMood('drift'); // fallback (drift = obs--cur)
    } else if (typeof MM.clearCursor === 'function') {
      MM.clearCursor();
    } else if (typeof MM.setMood === 'function') {
      MM.setMood(null); // clear override → авто-режим
    }
  } catch (_) {}
}

/* ── History ring buffer ─────────────────────────────── */

function _pushHistory(focus) {
  if (!focus) return;
  // Если мы стояли «в середине» истории — обрезаем хвост (как в браузере).
  if (_historyIdx >= 0 && _historyIdx < _history.length - 1) {
    _history.length = _historyIdx + 1;
  }
  // Дедупликация: не дублируем top если совпадает.
  const top = _history.length ? _history[_history.length - 1] : null;
  if (_focusEquals(top, focus)) {
    _historyIdx = _history.length - 1;
    return;
  }
  _history.push({ ...focus });
  if (_history.length > HISTORY_CAP) _history.shift();
  _historyIdx = _history.length - 1;
}

function _writeFocusToState(focus) {
  // Reactive proxy: одно поле — debounced flush сам соберёт.
  state.meta.focus = focus ? { ...focus } : null;
}

/* ── Public API ──────────────────────────────────────── */

export const Focus = {
  /** kinds / periods enum (frozen, для тестов и валидации сторонними). */
  KINDS:   VALID_KINDS,
  PERIODS: VALID_PERIODS,

  /**
   * Установить focus + push в history + toast + маскот cur.
   * @param {{kind:string, id:string, period?:string, source?:string}} input
   * @returns {object|null} normalized focus, либо null если invalid.
   */
  set(input) {
    const focus = _normalizeFocus(input);
    if (!focus) return null;
    _writeFocusToState(focus);
    _pushHistory(focus);
    _applyMascotCursor(focus);
    _showToast(focus);
    _emitChanged(focus);
    return focus;
  },

  /** Очистить focus. Не сбрасывает history (Cmd+[ может вернуть). */
  clear() {
    _writeFocusToState(null);
    _applyMascotCursor(null);
    _emitChanged(null);
  },

  /** Получить текущий focus (snapshot). */
  get() {
    const f = state?.meta?.focus;
    if (!f || typeof f !== 'object') return null;
    return { ...f };
  },

  /**
   * History API — для Cmd+[ / Cmd+] navigation.
   * push() обычно дёргается только из set(); прямой вызов — для тестов.
   */
  history: {
    push(focus) {
      const norm = _normalizeFocus(focus);
      if (!norm) return null;
      _pushHistory(norm);
      return norm;
    },
    /** @internal — только для тестов. */
    _entries() { return _history.slice(); },
    /** @internal — только для тестов. */
    _index()   { return _historyIdx; },
    /** Очистить (например, при logout / clear-state). */
    reset() { _history.length = 0; _historyIdx = -1; },
    /** Размер ring buffer. */
    cap: HISTORY_CAP,
  },

  /**
   * Назад по истории. Если есть предыдущая запись — устанавливает её
   * (без push'а, чтобы не зациклить). Иначе no-op.
   * @returns {object|null} focus после операции (или null если no-op).
   */
  back() {
    if (_historyIdx <= 0) return null;
    _historyIdx -= 1;
    const focus = { ..._history[_historyIdx] };
    _writeFocusToState(focus);
    _applyMascotCursor(focus);
    _emitChanged(focus);
    return focus;
  },

  /**
   * Вперёд по истории.
   * @returns {object|null} focus после операции (или null если no-op).
   */
  forward() {
    if (_historyIdx < 0 || _historyIdx >= _history.length - 1) return null;
    _historyIdx += 1;
    const focus = { ..._history[_historyIdx] };
    _writeFocusToState(focus);
    _applyMascotCursor(focus);
    _emitChanged(focus);
    return focus;
  },

  /**
   * Глобальный keydown listener: Cmd+[ → back, Cmd+] → forward.
   * Идемпотентно: повторный вызов — no-op.
   */
  bindHotkeys() {
    if (_hotkeysBound) return;
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    _onKeyDown = (e) => {
      try {
        // Pass-through если фокус в input/textarea/contenteditable.
        if (_isInputActive()) return;
        // Cmd на Mac, Ctrl на Win/Linux.
        const mod = e.metaKey || e.ctrlKey;
        if (!mod) return;
        if (e.altKey || e.shiftKey) return;
        if (e.key === '[' || e.code === 'BracketLeft') {
          e.preventDefault();
          Focus.back();
        } else if (e.key === ']' || e.code === 'BracketRight') {
          e.preventDefault();
          Focus.forward();
        }
      } catch (_) { /* never let hotkey-handler crash */ }
    };
    document.addEventListener('keydown', _onKeyDown, true);
    _hotkeysBound = true;
  },

  unbindHotkeys() {
    if (!_hotkeysBound) return;
    if (typeof document !== 'undefined' && _onKeyDown) {
      try { document.removeEventListener('keydown', _onKeyDown, true); } catch (_) {}
    }
    _onKeyDown = null;
    _hotkeysBound = false;
  },

  /** @internal — для тестов: проверка bound state. */
  _isHotkeysBound() { return _hotkeysBound; },

  /** @internal — для тестов: полный ресет (history + hotkeys + state). */
  _resetForTest() {
    Focus.unbindHotkeys();
    Focus.history.reset();
    try { Reactive.silent(() => { state.meta.focus = null; }); }
    catch (_) {
      try { state.meta.focus = null; } catch (__) {}
    }
  },
};

Services.register('Focus', Focus);
if (typeof window !== 'undefined') window.Focus = Focus;
if (typeof globalThis !== 'undefined') globalThis.Focus = Focus;
