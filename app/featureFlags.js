'use strict';
/* ============================================================
   FEATURE FLAGS — AUDIT_HOLISTIC P5 + Идея 1
   --
   Тонкий helper над `state.meta.featureFlags`. Позволяет:
     · `Flags.isEnabled(name)` → boolean.
     · `Flags.subscribe(name, handler)` → unsubscribe-функция.
       Handler вызывается при изменении флага (вызывается синхронно
       из EventBus 'flags-changed' bridge'а).
     · `Flags.set(name, value)` — для тестов / админ-UI.

   Контракты:
     · Default-on: если флаг не определён в state.meta.featureFlags —
       isEnabled возвращает true (мы не хотим, чтобы добавление новой
       фичи в код требовало одновременного кода-миграции; default-true
       сохраняет существующее поведение, а отключение возможно через
       `Flags.set('newFeature', false)`).
     · Server-driven контракт (P5): `/api/flags` сможет позже залить
       payload в `state.meta.featureFlags` — модуль не зависит от
       источника, только читает state.

   Стандартные флаги (см. state.js):
     · 'ai'             — AI-Анализ + AI-CEO views.
     · 'mascotMood'     — фичи маскота (F11).
     · 'notifications'  — Notification Center (F4).
     · 'explainScreen'  — explain-screen overlay.
   ============================================================ */

import { state }    from '../state.js';
import { EventBus } from './eventBus.js';
import { Services } from './services.js';

/** @type {Map<string, Set<Function>>} */
const _subs = new Map();

function _list(name) {
  let s = _subs.get(name);
  if (!s) { s = new Set(); _subs.set(name, s); }
  return s;
}

function _readFlags() {
  return (state && state.meta && state.meta.featureFlags) || {};
}

export const Flags = {
  /**
   * Проверить, включён ли флаг.
   * Default-on (см. контракт выше).
   * @param {string} name
   * @returns {boolean}
   */
  isEnabled(name) {
    if (typeof name !== 'string' || !name) return false;
    const flags = _readFlags();
    if (typeof flags !== 'object' || flags == null) return true;
    if (!Object.prototype.hasOwnProperty.call(flags, name)) return true; // default-on
    return flags[name] !== false;
  },

  /**
   * Подписаться на изменения флага. Handler вызывается с (newValue).
   * @param {string} name
   * @param {(value: boolean) => void} handler
   * @returns {() => void} unsubscribe
   */
  subscribe(name, handler) {
    if (typeof name !== 'string' || !name)   throw new TypeError('Flags.subscribe: name must be non-empty string');
    if (typeof handler !== 'function')        throw new TypeError('Flags.subscribe: handler must be function');
    _list(name).add(handler);
    return () => {
      const s = _subs.get(name);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) _subs.delete(name);
    };
  },

  /**
   * Выставить флаг + уведомить подписчиков.
   * Mutation идёт через Reactive proxy → debounced auto-save в SETTINGS_KEY.
   * @param {string} name
   * @param {boolean} value
   */
  set(name, value) {
    if (typeof name !== 'string' || !name) throw new TypeError('Flags.set: name must be non-empty string');
    const v = value !== false;
    if (!state.meta || typeof state.meta !== 'object') return;
    if (!state.meta.featureFlags || typeof state.meta.featureFlags !== 'object') {
      state.meta.featureFlags = {};
    }
    const prev = state.meta.featureFlags[name];
    if (prev === v) return;
    state.meta.featureFlags[name] = v;
    _notifyFlag(name, v);
  },

  /** @internal — для тестов: количество подписчиков на name. */
  _subscriberCount(name) {
    const s = _subs.get(name);
    return s ? s.size : 0;
  },

  /** @internal — для тестов: сбросить подписчиков. */
  _resetForTest() { _subs.clear(); },
};

function _notifyFlag(name, value) {
  const s = _subs.get(name);
  if (s) {
    for (const fn of Array.from(s)) {
      try { fn(value); }
      catch (e) { try { console.warn(`[featureFlags] subscriber for "${name}" threw:`, e); } catch (_) {} }
    }
  }
  try { EventBus.emit('flags-changed', { name, value }); } catch (_) {}
}

Services.register('Flags', Flags);
if (typeof window !== 'undefined') window.Flags = Flags;
