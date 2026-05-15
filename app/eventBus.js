'use strict';
/* ============================================================
   EVENT BUS — AUDIT_HOLISTIC P3
   --
   Минимальный pub/sub без зависимостей. Цель — заменить разрозненные
   `window.*` глобалы и неявные cross-module callback'и единым каналом.

   Контракты:
     · Бус — singleton: `EventBus` (named export) + `window.EventBus`.
     · Подписчики ИЗОЛИРОВАНЫ: throw в одном handler не ломает остальных
       (логируется в console.warn).
     · `on(event, handler)` возвращает unsubscribe-функцию (как
       `state.subscribe` и `Reactive.subscribe` — единый паттерн в проекте).
     · `once(event, handler)` — подписка с авто-отпиской после первого
       срабатывания. Если в handler упало — всё равно отписываемся.
     · `clear(event?)` — для тестов: без аргумента чистит ВСЁ,
       с именем — только конкретный event.
     · Имена событий — kebab/dot-case, согласно P7 telemetry-convention
       (`domain.action[.qualifier]`).

   Standard events (мост от reactive / notify-center / AI / ...):
     · 'state-changed'         — Reactive proxy / notifyManual.
     · 'state-saved'           — Storage.save() finished writing payload.
     · 'state-restored'        — после Storage.restore() / loadSettings().
     · 'user-changed'          — `state.meta.user.*` изменился.
     · 'permissions-changed'   — `state.meta.permissions.*` изменился.
     · 'flags-changed'         — `state.meta.featureFlags.*` изменился.
     · 'section-entered'       — { section } — Nav.go() в новый раздел.
     · 'section-left'          — { section } — Nav.go() покидает раздел.
     · 'focus-changed'         — { focus } — `state.meta.focus`.
     · 'ai-update-completed'   — { source, blockId } — мост AIPipeline.
     · 'notification-added'    — мост NotifyCenter.add().

   Не делаем:
     · Никакой типизации payload'ов (vanilla JS — не реалистично без
       runtime-cost). Контракт описан здесь и в docs/event-bus.md.
     · Никаких приоритетов / порядка / async-ожидания. emit синхронен —
       handler не должен возвращать Promise.
   ============================================================ */

/** @type {Map<string, Set<Function>>} */
const _handlers = new Map();

function _list(event) {
  let s = _handlers.get(event);
  if (!s) { s = new Set(); _handlers.set(event, s); }
  return s;
}

export const EventBus = {
  /**
   * Подписаться на event. Возвращает unsubscribe-функцию.
   * @param {string} event
   * @param {Function} handler
   * @returns {Function}
   */
  on(event, handler) {
    if (typeof event !== 'string' || !event) throw new TypeError('EventBus.on: event must be non-empty string');
    if (typeof handler !== 'function')        throw new TypeError('EventBus.on: handler must be function');
    _list(event).add(handler);
    return () => EventBus.off(event, handler);
  },

  /**
   * Отписать handler.
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    const s = _handlers.get(event);
    if (!s) return;
    s.delete(handler);
    if (s.size === 0) _handlers.delete(event);
  },

  /**
   * Подписка ОДИН раз. Авто-отписка после первого срабатывания
   * (даже если handler бросил).
   * @param {string} event
   * @param {Function} handler
   * @returns {Function} unsubscribe
   */
  once(event, handler) {
    if (typeof handler !== 'function') throw new TypeError('EventBus.once: handler must be function');
    const wrapper = (payload) => {
      try { handler(payload); }
      finally { EventBus.off(event, wrapper); }
    };
    return EventBus.on(event, wrapper);
  },

  /**
   * Опубликовать. Snapshot подписчиков (handler может отписаться сам).
   * Throw в одном handler НЕ ломает остальных.
   * @param {string} event
   * @param {*} [payload]
   */
  emit(event, payload) {
    const s = _handlers.get(event);
    if (!s || s.size === 0) return;
    // Snapshot — handler может вызвать off / on во время emit.
    const list = Array.from(s);
    for (const fn of list) {
      try { fn(payload); }
      catch (e) {
        try { console.warn(`[eventBus] handler for "${event}" threw:`, e); } catch (_) {}
      }
    }
  },

  /**
   * Очистить подписчиков. Без аргумента — всё; с именем — только этот event.
   * Используется в тестах + Storage.clear().
   * @param {string} [event]
   */
  clear(event) {
    if (typeof event === 'string' && event) {
      _handlers.delete(event);
    } else {
      _handlers.clear();
    }
  },

  /** @internal — для тестов: количество подписчиков на event. */
  _listenerCount(event) {
    const s = _handlers.get(event);
    return s ? s.size : 0;
  },

  /** @internal — для тестов: список зарегистрированных events. */
  _events() {
    return Array.from(_handlers.keys());
  },
};

if (typeof window !== 'undefined') window.EventBus = EventBus;
