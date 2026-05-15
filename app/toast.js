'use strict';
/* ============================================================
   TOAST — AUDIT_HOLISTIC паттерн 9 / Идея 14
   --
   Чистый thin-wrapper API над `ToastQueue.show` (см. app/uxKit.js).
   Закрывает дрейф между legacy `showToast(msg, type, ms)` и
   object-form `showToast({...})` — ~75 callsites, 5 разных типов,
   `'warn'` vs `'warning'` confusion.

   Public API:
     Toast.success(msg, opts?)  → 3s default, mascot flashSuccess
     Toast.error(msg, opts?)    → 5s default, БЕЗ mascot-нагнетания
     Toast.info(msg, opts?)     → 3s default, нейтраль
     Toast.warn(msg, opts?)     → 4s default, drift-tone (alias под legacy 'warn'/'warning')
     Toast.loading(msg, opts?)  → persistent, mascot setMood('thinking')
     Toast.dismiss(id)          → закрыть конкретный toast
     Toast.dismissAll()         → закрыть все

   Возвращает: `{ id, dismiss(), update(opts) }` — handle для loading/replace.

   opts (все optional):
     subText?:     string           // вторая строка caption-style
     persist?:     boolean          // зеркало в NotifyCenter (F4)
     mascotPhase?: 'thinking'|'success'|'alert'|null  // override авто-mascot
     actionLabel?: string           // текст кнопки (Повторить/Отменить/...)
     onAction?:    () => void       // callback по кнопке (как onUndo)
     timeoutMs?:   number           // override default ms
     id?:          string|number    // для replace-semantics
     actor?:       string           // identity-key для NotifyCenter (email/jiraAccountId)
     actionUrl?:   string           // deep-link для NotifyCenter
     kind?:        string           // category для NotifyCenter

   Контракты:
     · НЕ дублирует render — внутри `ToastQueue.show`.
     · НЕ удаляет legacy `showToast` (см. uxKit.js / app.js — backward-compat).
     · Identity-deterministic — actor через email/jiraAccountId, не fuzzy-name.
     · AU5 LLM tone-lint работает на чате; toast — короткий transient channel,
       lint не нужен.
     · MascotMood — best-effort (`window.MascotMood`), no-op без него.
   ============================================================ */

import { ToastQueue } from './uxKit.js';
import { Services } from './services.js';

/* ---- mascot integration -------------------------------------- */

const _MASCOT_AUTO = Object.freeze({
  loading: 'thinking',
  success: 'success',
  // error → намеренно null (избегаем нагнетания тревоги)
  error:   null,
  warn:    'alert',
  info:    null,
});

function _triggerMascot(kind, phaseOverride) {
  const phase = phaseOverride !== undefined ? phaseOverride : _MASCOT_AUTO[kind];
  if (!phase) return;
  const MM = (typeof window !== 'undefined') ? window.MascotMood : null;
  if (!MM) return;
  try {
    if (kind === 'success' || phase === 'success') {
      if (typeof MM.flashSuccess === 'function') { MM.flashSuccess(); return; }
    }
    if (typeof MM.setMood === 'function') MM.setMood(phase);
  } catch (_) { /* mascot best-effort */ }
}

/* ---- ToastQueue mascot type mapping -------------------------- */

const _QUEUE_MASCOT = Object.freeze({
  // Это `mascot` parameter в ToastQueue.show — не путать с MascotMood.
  // ToastQueue рендерит маленький маскот ВНУТРИ toast (см. uxKit.js).
  loading: 'loading',
  success: 'success',
  error:   'concerned',
  warn:    'alert',
  info:    'info',
});

const _QUEUE_TYPE = Object.freeze({
  loading: 'info',     // нет «loading» CSS-класса; стилизуем как info + mascot=loading
  success: 'success',
  error:   'error',
  warn:    'warning',
  info:    'info',
});

const _DEFAULT_MS = Object.freeze({
  loading: 0,          // sticky — caller сам делает dismiss(id)
  success: 3000,
  error:   5000,
  warn:    4000,
  info:    3000,
});

/* ---- core impl ----------------------------------------------- */

/**
 * @param {'success'|'error'|'info'|'warn'|'loading'} kind
 * @param {string} msg
 * @param {object} [opts]
 * @returns {{ id: string|number, dismiss: () => void, update: (newOpts: object) => void }}
 */
function _show(kind, msg, opts = {}) {
  const ms = (typeof opts.timeoutMs === 'number') ? opts.timeoutMs : _DEFAULT_MS[kind];

  // mascotPhase: пользовательский override; если null/undefined — авто.
  // 'mascotPhase' control: only `false` means «не показывать toast-mascot вообще».
  // Иначе мапим по kind.
  const queueMascot = (opts.mascotPhase === false)
    ? null
    : (opts.mascotPhase || _QUEUE_MASCOT[kind] || null);

  // Build payload for existing ToastQueue.show.
  const payload = {
    msg:         String(msg == null ? '' : msg),
    type:        _QUEUE_TYPE[kind] || 'info',
    ms,
    mascot:      queueMascot,
    subText:     opts.subText || '',
    persist:     !!opts.persist,
    kind:        opts.kind || kind,
    actor:       opts.actor || '',
    actionUrl:   opts.actionUrl || '',
    actionLabel: '',
    undo:        '',
    onUndo:      null,
    id:          opts.id,
  };

  // Action button — переиспользуем undo-cluster (это та же CTA-кнопка в UI).
  if (opts.actionLabel && typeof opts.onAction === 'function') {
    payload.undo   = opts.actionLabel;
    payload.onUndo = opts.onAction;
    // Для NotifyCenter persistent-копии тоже отметим.
    payload.actionLabel = opts.actionLabel;
  } else if (opts.actionLabel) {
    payload.actionLabel = opts.actionLabel;
  }

  const id = ToastQueue.show(payload);

  // Mascot trigger (после render, чтобы UI был на экране одновременно).
  _triggerMascot(kind, opts.mascotPhase);

  return {
    id,
    dismiss() { try { ToastQueue.dismiss(id); } catch (_) {} },
    update(newOpts = {}) {
      // Replace semantics: dismiss + show with same id.
      try { ToastQueue.dismiss(id); } catch (_) {}
      const merged = Object.assign({}, opts, newOpts, { id });
      const nextKind = newOpts.kind && _QUEUE_TYPE[newOpts.kind] ? newOpts.kind : kind;
      const nextMsg  = (newOpts.msg != null) ? newOpts.msg : msg;
      return _show(nextKind, nextMsg, merged);
    },
  };
}

/* ---- Public API --------------------------------------------- */

export const Toast = Object.freeze({
  success(msg, opts) { return _show('success', msg, opts || {}); },
  error  (msg, opts) { return _show('error',   msg, opts || {}); },
  info   (msg, opts) { return _show('info',    msg, opts || {}); },
  /** alias для legacy `'warn'` / `'warning'` — оба маппятся сюда. */
  warn   (msg, opts) { return _show('warn',    msg, opts || {}); },
  warning(msg, opts) { return _show('warn',    msg, opts || {}); },
  loading(msg, opts) { return _show('loading', msg, opts || {}); },

  dismiss(id) { try { ToastQueue.dismiss(id); } catch (_) {} },
  dismissAll() { try { ToastQueue.dismissAll(); } catch (_) {} },

  /**
   * Internal map: legacy type-string → method-name. Используется в
   * uxKit.js back-compat layer (legacy showToast deprecation).
   * Экспортируем для тестов и для линт-правил.
   */
  _legacyTypeMap: Object.freeze({
    success: 'success',
    ok:      'success',
    error:   'error',
    err:     'error',
    info:    'info',
    warn:    'warn',
    warning: 'warn',
    loading: 'loading',
  }),
});

Services.register('Toast', Toast);
if (typeof window !== 'undefined') {
  // window.Toast уже занят alias на ToastQueue из uxKit.js — перезаписываем
  // сейчас на чистый API. Старый alias был backward-compat для `Toast.error()`
  // semantic helpers, которые остались в ToastQueue (перекрытие совместимо:
  // обе формы одинаковой сигнатуры `(msg, opts)`).
  window.Toast = Toast;
}

export default Toast;
