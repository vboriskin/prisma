'use strict';
/* ============================================================
   PERMISSIONS — AUDIT_HOLISTIC P6 + Идея 1
   --
   Тонкий helper над `state.meta.permissions`. Позволяет:
     · `Permissions.can(action)` → boolean — простая проверка.
     · `Permissions.guard(action, fn)` → wraps fn — выполнит только если
       can(action) === true; иначе показывает toast «Нет прав» и
       возвращает undefined.

   Контракты:
     · Default-allow для unknown action (можно ужесточить позже:
       сейчас гранулярность permissions matrix — это ровно те ключи,
       что определены в state.meta.permissions; нечитаемое имя →
       fallback `true` чтобы не блокировать существующий код, который
       ещё не интегрирован с permissions matrix).
     · НЕ интегрируется автоматически. Phase-1 — только модуль + единичные
       call-site'ы (например, BulkPlatform.apply ниже). Phase-2 будет
       проходить call-site'ы по очереди.
     · Identity-deterministic: ничего не предполагает о user.email — это
       работа sign-in flow (отдельная задача).

   Стандартные actions (subset из state.meta.permissions):
     · 'canBulkEdit'      — массовые операции в Реестре / Сканнере.
     · 'canChangeScope'   — менять scopeStatus.
     · 'canMarkDone'      — выставлять isDone.
     · 'canExport'        — CSV / JSON / bundle export.
     · 'canEditEmployees' — править Employee identity-fields.

   Toast-контекст: `window.showToast?.(text, severity)` — глобал,
   определённый в app.js. Если showToast недоступен (Node-tests) —
   silently no-op.
   ============================================================ */

import { state }    from '../state.js';
import { EventBus } from './eventBus.js';
import { Services } from './services.js';

// AUDIT_HOLISTIC паттерн 9 / Идея 14 — _safeToast делегирует в чистый Toast.*.
const _PERM_TYPE_MAP = { success:'success', ok:'success', error:'error', err:'error',
                         info:'info', warn:'warn', warning:'warn', loading:'loading' };
function _safeToast(text, severity = 'warn') {
  try {
    if (typeof window === 'undefined') return;
    const T = Services.Toast;
    if (T && typeof T.success === 'function') {
      const m = T[_PERM_TYPE_MAP[severity] || 'warn'];
      return m(text);
    }
    if (typeof window.showToast === 'function') {
      window.showToast(text, severity);
    }
  } catch (_) { /* defensive */ }
}

export const Permissions = {
  /**
   * Boolean проверка — есть ли у текущего пользователя право `action`.
   * Default-allow для неизвестных action'ов (см. контракт выше).
   * @param {string} action
   * @returns {boolean}
   */
  can(action) {
    if (typeof action !== 'string' || !action) return false;
    const matrix = (state && state.meta && state.meta.permissions) || null;
    if (!matrix || typeof matrix !== 'object') return true; // default-allow
    if (!Object.prototype.hasOwnProperty.call(matrix, action)) return true; // default-allow
    return matrix[action] !== false;
  },

  /**
   * Запустить fn ТОЛЬКО если can(action) === true.
   * Иначе показывает toast и возвращает undefined.
   * @template T
   * @param {string} action
   * @param {() => T} fn
   * @returns {T | undefined}
   */
  guard(action, fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('Permissions.guard: fn must be function');
    }
    if (!Permissions.can(action)) {
      _safeToast(`Нет прав на действие: ${action}`, 'warn');
      try { EventBus.emit('permission-denied', { action }); } catch (_) {}
      return undefined;
    }
    return fn();
  },

  /**
   * Проверить и эмитнуть `permission-denied` без выполнения fn.
   * Полезен для UI hide/disable check'ов.
   * @param {string} action
   * @returns {boolean}
   */
  check(action) {
    const ok = Permissions.can(action);
    if (!ok) {
      try { EventBus.emit('permission-denied', { action }); } catch (_) {}
    }
    return ok;
  },
};

Services.register('Permissions', Permissions);
if (typeof window !== 'undefined') window.Permissions = Permissions;
