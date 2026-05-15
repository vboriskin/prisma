'use strict';
/* ============================================================
   UX KIT — V21 P
   Foundation helpers для UX/a11y. Все три export'а —
   self-contained, без внешних зависимостей кроме DOM.

   Public API:
     ConfirmDialog.show({ title, message, confirmLabel, cancelLabel,
                          danger, typeToConfirm }) → Promise<boolean>
     FocusTrap.attach(containerEl, { initialFocus, returnFocus }) → detach()
     ToastQueue.show({ msg, type, ms, undo, onUndo, id }) → toastId
     ToastQueue.dismiss(id)

   ConfirmDialog заменяет native `confirm()` — поддерживает кнопки,
   Esc/Enter, danger-стиль (красный confirm), typeToConfirm (УДАЛИТЬ).

   FocusTrap зацикливает Tab внутри modal'и + восстанавливает focus
   на возврате. Опирается на `:focusable` selector — стандартный набор
   интерактивных элементов.

   ToastQueue показывает несколько toast'ов друг под другом, поддерживает
   Undo-CTA (кнопка «Отменить» внутри toast'а с onUndo callback).
   ============================================================ */

const FOCUSABLE_SEL = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/* ── ConfirmDialog ──────────────────────────────────────── */

export const ConfirmDialog = {
  /**
   * @param {Object} opts
   * @param {string} opts.title — заголовок (h3)
   * @param {string} opts.message — текст; \n превращается в <br>
   * @param {string} [opts.confirmLabel='Подтвердить']
   * @param {string} [opts.cancelLabel='Отмена']
   * @param {boolean} [opts.danger=false] — красная confirm-кнопка
   * @param {string} [opts.typeToConfirm] — если задано, кнопка disabled пока юзер не введёт точное совпадение (case-insensitive). Используется для destructive «удалить всё».
   * @returns {Promise<boolean>} true если confirm, false если cancel/Esc.
   */
  show({ title = 'Подтверждение', message = '', confirmLabel = 'Подтвердить', cancelLabel = 'Отмена', danger = false, typeToConfirm = '' } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay confirm-dialog-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'confirm-dialog-title');

      const escapeHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const msgHtml = escapeHtml(message).replace(/\n/g, '<br>');
      const typedHtml = typeToConfirm
        ? `<div class="confirm-dialog-typed-wrap">
             <label for="confirm-dialog-typed" class="confirm-dialog-typed-label">Для подтверждения введите <strong>${escapeHtml(typeToConfirm)}</strong>:</label>
             <input type="text" id="confirm-dialog-typed" class="confirm-dialog-typed-input" autocomplete="off" spellcheck="false">
           </div>`
        : '';

      overlay.innerHTML = `
        <div class="modal-box confirm-dialog-box">
          <h3 id="confirm-dialog-title">${escapeHtml(title)}</h3>
          ${message ? `<p class="confirm-dialog-msg">${msgHtml}</p>` : ''}
          ${typedHtml}
          <div class="confirm-dialog-actions">
            <button type="button" class="btn btn-ghost confirm-dialog-cancel">${escapeHtml(cancelLabel)}</button>
            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'} confirm-dialog-confirm" ${typeToConfirm ? 'disabled' : ''}>${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const okBtn     = overlay.querySelector('.confirm-dialog-confirm');
      const cancelBtn = overlay.querySelector('.confirm-dialog-cancel');
      const typedInp  = overlay.querySelector('.confirm-dialog-typed-input');

      const detachFocusTrap = FocusTrap.attach(overlay, {
        initialFocus: typedInp || cancelBtn,
      });

      let resolved = false;
      const cleanup = (result) => {
        if (resolved) return;
        resolved = true;
        try { detachFocusTrap(); } catch (_) {}
        overlay.remove();
        resolve(result);
      };

      okBtn.addEventListener('click', () => cleanup(true));
      cancelBtn.addEventListener('click', () => cleanup(false));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });

      if (typedInp) {
        typedInp.addEventListener('input', () => {
          okBtn.disabled = typedInp.value.trim().toUpperCase() !== typeToConfirm.toUpperCase();
        });
        typedInp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !okBtn.disabled) cleanup(true);
        });
      }

      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
        else if (e.key === 'Enter' && !typedInp && document.activeElement !== cancelBtn) {
          e.preventDefault();
          if (!okBtn.disabled) cleanup(true);
        }
      };
      overlay.addEventListener('keydown', onKey);
    });
  },
};

/* ── FocusTrap ──────────────────────────────────────────── */

export const FocusTrap = {
  /**
   * Зацикливает Tab внутри container'а, фокусирует initialFocus,
   * на detach() возвращает focus на элемент, который был активен
   * перед attach (обычно — кнопка, открывшая modal).
   *
   * @param {HTMLElement} container
   * @param {Object} [opts]
   * @param {HTMLElement} [opts.initialFocus] — куда поставить focus сразу. Default: первый focusable.
   * @param {boolean} [opts.returnFocus=true] — вернуть focus при detach.
   * @returns {() => void} detach
   */
  attach(container, { initialFocus = null, returnFocus = true } = {}) {
    if (!container) return () => {};
    const previouslyFocused = document.activeElement;

    const getFocusables = () => Array.from(container.querySelectorAll(FOCUSABLE_SEL))
      .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);

    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const items = getFocusables();
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last  = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };

    container.addEventListener('keydown', onKey);

    // Set initial focus on next frame so DOM has settled
    requestAnimationFrame(() => {
      const target = initialFocus || getFocusables()[0] || container;
      try { target.focus({ preventScroll: false }); } catch (_) { try { target.focus(); } catch (_2) {} }
    });

    return function detach() {
      container.removeEventListener('keydown', onKey);
      if (returnFocus && previouslyFocused && typeof previouslyFocused.focus === 'function') {
        try { previouslyFocused.focus({ preventScroll: true }); } catch (_) {}
      }
    };
  },
};

/* ── ToastQueue ─────────────────────────────────────────── */

let _toastSeq = 0;
const _toasts = new Map(); // id -> { el, timer }

function _toastEnsureContainer() {
  let c = document.getElementById('toast-queue');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toast-queue';
    c.setAttribute('aria-live', 'polite');
    c.setAttribute('aria-atomic', 'false');
    document.body.appendChild(c);
  }
  return c;
}

export const ToastQueue = {
  /**
   * @param {Object|string} optsOrMsg
   *   Либо объект { msg, type, ms, undo, onUndo, id }, либо
   *   строка (back-compat с legacy `showToast(msg, type, ms)`).
   * @param {string} [legacyType]
   * @param {number} [legacyMs]
   * @returns {string|number} toastId — можно передать в dismiss().
   */
  show(optsOrMsg, legacyType, legacyMs) {
    const opts = (typeof optsOrMsg === 'string' || optsOrMsg == null)
      ? { msg: optsOrMsg, type: legacyType, ms: legacyMs }
      : optsOrMsg;
    const { msg = '', type = 'success', ms = 2400, undo = '', onUndo = null, id,
            mascot = null, subText = '',
            // AUDIT_HOLISTIC F4 — `persist:true` ALSO добавляет в NotifyCenter,
            // так тимлид не теряет событие если был не у экрана. Toast остаётся
            // transient channel; persistence — opt-in.
            persist = false, kind = '', actor = '', actionUrl = '', actionLabel = '' } = opts;
    const toastId = id || ++_toastSeq;
    if (persist && typeof window !== 'undefined' && Services.NotifyCenter) {
      try {
        const sevMap = { error: 'off-course', warning: 'drift', info: 'info', success: 'info' };
        Services.NotifyCenter.add({
          kind:        kind || type,
          title:       String(msg),
          body:        String(subText || ''),
          actor,
          severity:    sevMap[type] || 'info',
          actionUrl,
          actionLabel,
        });
      } catch (_) { /* persist is best-effort, don't break toast */ }
    }

    // Если такой id уже показан — убираем, заменяем (replace semantics).
    if (_toasts.has(toastId)) ToastQueue.dismiss(toastId);

    const c = _toastEnsureContainer();
    const el = document.createElement('div');
    el.className = `toast toast-${type}${mascot ? ' toast-with-mascot' : ''}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.dataset.toastId = String(toastId);
    const safeText = String(msg).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeSub  = String(subText).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // design-01 D fix — маскот в toast'е («concerned» для error, «alert» для drift,
    // «success» для подтверждения). Stack под §13.10: маскот всегда поверх Breathe.
    let mascotHtml = '';
    if (mascot) {
      // AUDIT_MASCOT 5.6 — расширенный набор: добавлены `loading` (для
      // long-running операций — export, AI compute) и `info` (для
      // нейтральных подсказок). Раньше всё мапилось на 3 эмоции.
      const phaseClass = ({
        concerned: 'obs--breathe obs--concerned obs--alive',
        alert:     'obs--breathe obs--alert obs--alive',
        success:   'obs--breathe obs--success obs--alive',
        loading:   'obs--breathe obs--ls-thinking obs--alive',
        info:      'obs--breathe obs--cur obs--alive',
      })[mascot] || 'obs--breathe';
      mascotHtml = `<span class="toast-mascot obs obs--sm ${phaseClass}" aria-hidden="true"><svg viewBox="-60 -60 120 120"><use href="#obs-base"/></svg></span>`;
    }
    const bodyHtml = `<div class="toast-body"><span class="toast-msg">${safeText}</span>${safeSub ? `<span class="toast-sub">${safeSub}</span>` : ''}</div>`;
    if (undo && typeof onUndo === 'function') {
      el.innerHTML = `${mascotHtml}${bodyHtml}<button type="button" class="toast-undo" aria-label="${String(undo).replace(/"/g, '&quot;')}">${String(undo).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</button><button type="button" class="toast-close" aria-label="Закрыть">×</button>`;
      el.querySelector('.toast-undo').addEventListener('click', () => {
        try { onUndo(); } catch (_) {}
        ToastQueue.dismiss(toastId);
      });
    } else {
      el.innerHTML = `${mascotHtml}${bodyHtml}<button type="button" class="toast-close" aria-label="Закрыть">×</button>`;
    }
    el.querySelector('.toast-close').addEventListener('click', () => ToastQueue.dismiss(toastId));
    c.appendChild(el);
    // v22 mascot-pass — hydrate toast mascot rich SVG'ом для concerned/alert
    // animations (work только с inline SVG, не через `<use>`).
    const toastMascotEl = el.querySelector('.toast-mascot');
    if (toastMascotEl) try { Services.ObsidianMascot?.hydrate?.(toastMascotEl); } catch (_) {}

    const timer = ms > 0 ? setTimeout(() => ToastQueue.dismiss(toastId), ms) : null;
    _toasts.set(toastId, { el, timer });
    try { window.HistoryLog?.event?.('toast.shown', { type, hasMascot: !!mascot, hasUndo: !!(undo && onUndo), ms }); } catch (_) {}
    return toastId;
  },

  dismiss(id) {
    const entry = _toasts.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.el.classList.add('toast-out');
    setTimeout(() => {
      try { entry.el.remove(); } catch (_) {}
      _toasts.delete(id);
    }, 180);
  },

  dismissAll() {
    for (const id of Array.from(_toasts.keys())) ToastQueue.dismiss(id);
  },

  // AUDIT_MASCOT 5.3 (HIGH) — semantic helpers с авто-mascot. Раньше
  // `mascot:` параметр API существовал но НИКТО его не вызывал — UX-effect
  // нулевой. Теперь errorsLog/drift-detection/etc могут писать понятный
  // вызов вместо ручной сборки phase-classes.
  // Сигнатура: `Toast.error('msg', { hint, retry, ms })` etc.
  error(msg, opts = {}) {
    return ToastQueue.show({
      msg, type: 'error', mascot: 'concerned',
      subText: opts.hint || '',
      ms: opts.ms ?? 5000,
      undo: opts.retry ? 'Повторить' : '',
      onUndo: opts.retry || null,
    });
  },
  warning(msg, opts = {}) {
    return ToastQueue.show({
      msg, type: 'warning', mascot: 'alert',
      subText: opts.hint || '',
      ms: opts.ms ?? 4000,
    });
  },
  success(msg, opts = {}) {
    return ToastQueue.show({
      msg, type: 'success', mascot: 'success',
      subText: opts.hint || '',
      ms: opts.ms ?? 2400,
    });
  },
  loading(msg, opts = {}) {
    return ToastQueue.show({
      msg, type: 'info', mascot: 'loading',
      subText: opts.hint || '',
      ms: 0,                  // sticky — caller сам делает dismiss(id) после операции
    });
  },
  info(msg, opts = {}) {
    return ToastQueue.show({
      msg, type: 'info', mascot: 'info',
      subText: opts.hint || '',
      ms: opts.ms ?? 3000,
    });
  },
};

/* ── FieldError — inline validation helper (V21 T) ────────── */

/**
 * V21 T (audit-2026-05-03 §H Top-12 #8) — inline validation вместо Toast.
 * Помечает <input> как invalid с aria-invalid="true" + красная рамка
 * + сообщение под полем. Применяется в local-form контексте; глобально
 * мигрировать все формы — отдельный sprint.
 *
 * Usage:
 *   FieldError.set(inputEl, 'Дата не может быть в прошлом');
 *   FieldError.clear(inputEl);
 */
export const FieldError = {
  set(input, message) {
    if (!input) return;
    input.setAttribute('aria-invalid', 'true');
    input.classList.add('field-invalid');
    let msgEl = input.nextElementSibling;
    if (!msgEl || !msgEl.classList?.contains('field-error-msg')) {
      msgEl = document.createElement('div');
      msgEl.className = 'field-error-msg';
      msgEl.setAttribute('role', 'alert');
      input.insertAdjacentElement('afterend', msgEl);
    }
    msgEl.textContent = message;
  },
  clear(input) {
    if (!input) return;
    input.removeAttribute('aria-invalid');
    input.classList.remove('field-invalid');
    const msgEl = input.nextElementSibling;
    if (msgEl && msgEl.classList?.contains('field-error-msg')) msgEl.remove();
  },
};

if (typeof window !== 'undefined') window.FieldError = FieldError;

/* ── Auto focus-trap for modal-style overlays ────────────── */

/**
 * V21 Q (audit-2026-05-03 §I, Quick win 2) — auto focus-trap.
 * Когда любой из `.modal-overlay`, `.int-modal-overlay`, `.ceo-modal-overlay`,
 * `#app-settings-modal`, `#llm-settings-modal`, `#al-modal`, `#onboarding-overlay`
 * становится visible (теряет .hidden), attach'им FocusTrap. На скрытие — detach.
 *
 * Используем MutationObserver вместо patching каждый show/hide site —
 * 6+ модалок открываются из 20+ мест, не хочется размазывать.
 */
const _autoTrapped = new WeakMap(); // element -> detachFn
const TRAPPABLE_SEL = [
  '.modal-overlay',
  '.int-modal-overlay',
  '.ceo-modal-overlay',
  '.welcome-overlay-modal',         // P10.16 — modal-restore (открывается из welcome-overlay)
  '#app-settings-modal',
  '#llm-settings-modal',
  '#al-modal',
  '#onboarding-overlay',
  '#ob-welcome',
  '#modal-restore',                  // P10.16 — explicit fallback id
].join(',');

function _isVisibleModal(el) {
  if (!el || !el.classList) return false;
  if (el.classList.contains('hidden')) return false;
  // Дополнительный safety: getComputedStyle проверяет display:none через CSS-rule.
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return true;
}

function _evaluateTrap(el) {
  if (!el || !el.matches?.(TRAPPABLE_SEL)) return;
  const visible = _isVisibleModal(el);
  const trapped = _autoTrapped.has(el);
  if (visible && !trapped) {
    const detach = FocusTrap.attach(el);
    _autoTrapped.set(el, detach);
  } else if (!visible && trapped) {
    try { _autoTrapped.get(el)(); } catch (_) {}
    _autoTrapped.delete(el);
  }
}

function _initAutoTrap() {
  // Test-safe: MutationObserver / getComputedStyle отсутствуют в Node-only
  // окружении (тесты через `node --test` без jsdom). Без них auto-trap
  // деградирует в no-op — модалки всё равно работают, просто без trap'а.
  if (typeof MutationObserver === 'undefined' || typeof getComputedStyle === 'undefined') return;
  // Initial scan — modals уже могут быть visible на boot.
  document.querySelectorAll(TRAPPABLE_SEL).forEach(_evaluateTrap);
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes' && (m.attributeName === 'class' || m.attributeName === 'style' || m.attributeName === 'hidden')) {
        _evaluateTrap(m.target);
      } else if (m.type === 'childList') {
        // New modal'и могут быть добавлены в body (ConfirmDialog так делает).
        m.addedNodes.forEach(n => {
          if (n.nodeType === 1) {
            if (n.matches?.(TRAPPABLE_SEL)) _evaluateTrap(n);
            n.querySelectorAll?.(TRAPPABLE_SEL).forEach(_evaluateTrap);
          }
        });
      }
    }
  });
  obs.observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden'],
    subtree: true,
    childList: true,
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initAutoTrap, { once: true });
  } else {
    _initAutoTrap();
  }
}

/* ── PrismaDialog (P10.17) ──────────────────────────────── */

/**
 * Дизайн-аудит П10.17 — фабрика модалки нового поколения.
 * НЕ заменяет существующие 11 модалок (миграция — отдельный sprint),
 * а даёт готовый API для будущих диалогов с унифицированной
 * Align-анимацией (см. styles.css `MODALS P10.13-17`).
 *
 * Структура DOM:
 *   div.modal-overlay.prizma-dialog (+ optional .prizma-dialog-danger)
 *     div.modal-box
 *       div.modal-header   — title h3 + close-btn (inline SVG x)
 *       div.modal-body     — content (string HTML | Node)
 *       div.modal-footer   — footer buttons (string HTML | Node | array)
 *
 * Поведение:
 *   - open() добавляет class `show` → анимация in (220ms spring).
 *   - close() добавляет class `closing` → анимация out (160ms),
 *     через 160ms snimает overlay из DOM.
 *   - Esc → close() (через FocusTrap-overlay-keydown).
 *   - Backdrop-click → проверяет «грязные» input/textarea, при
 *     наличии — confirm «Закрыть без сохранения?», иначе close().
 *   - destroy() — синхронное удаление DOM без анимации.
 *
 * @param {Object} opts
 * @param {string}  [opts.id]       — id overlay-узла (default: auto-uniq).
 * @param {string}  [opts.title]    — заголовок h3.
 * @param {string|Node} [opts.content] — тело модалки.
 * @param {string|Node|Array<Node>} [opts.footer] — футер.
 * @param {Function} [opts.onClose] — callback при закрытии (любой путь).
 * @param {Function} [opts.onConfirm] — callback для primary-кнопки (если
 *                                      footer не задан, рисуем дефолтный).
 * @param {boolean} [opts.danger=false] — danger-окраска primary.
 * @returns {{ open: Function, close: Function, destroy: Function, root: HTMLElement }}
 */
let _prizmaDialogSeq = 0;
export function createPrismaDialog(opts = {}) {
  const {
    id,
    title = '',
    content = '',
    footer = null,
    onClose = null,
    onConfirm = null,
    danger = false,
  } = opts;

  const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay prizma-dialog' + (danger ? ' prizma-dialog-danger' : '');
  overlay.id = id || `prizma-dialog-${++_prizmaDialogSeq}`;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const titleId = `${overlay.id}-title`;
  if (title) overlay.setAttribute('aria-labelledby', titleId);

  const closeSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <h3 id="${titleId}">${escapeHtml(title)}</h3>
        <button type="button" class="modal-close-btn" aria-label="Закрыть" title="Закрыть">${closeSvg}</button>
      </div>
      <div class="modal-body"></div>
      <div class="modal-footer"></div>
    </div>
  `;

  const bodyEl   = overlay.querySelector('.modal-body');
  const footerEl = overlay.querySelector('.modal-footer');
  const closeBtn = overlay.querySelector('.modal-close-btn');

  const appendChild = (parent, val) => {
    if (val == null) return;
    if (typeof val === 'string') parent.insertAdjacentHTML('beforeend', val);
    else if (val instanceof Node) parent.appendChild(val);
    else if (Array.isArray(val)) val.forEach(v => appendChild(parent, v));
  };
  appendChild(bodyEl, content);

  if (footer != null) {
    appendChild(footerEl, footer);
  } else if (typeof onConfirm === 'function') {
    // Дефолтный футер — Cancel + Confirm.
    footerEl.innerHTML = `
      <button type="button" class="btn btn-ghost prizma-dialog-cancel">Отмена</button>
      <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'} prizma-dialog-confirm">Подтвердить</button>
    `;
    footerEl.querySelector('.prizma-dialog-cancel').addEventListener('click', () => api.close());
    footerEl.querySelector('.prizma-dialog-confirm').addEventListener('click', async () => {
      try { await onConfirm(); } catch (_) {}
      api.close();
    });
  } else {
    footerEl.style.display = 'none';
  }

  let detachFocusTrap = null;
  let opened = false;
  let closing = false;

  const _hasDirtyInputs = () => {
    const inputs = bodyEl.querySelectorAll('input, textarea');
    return Array.from(inputs).some(el => {
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked && !el.defaultChecked;
      const v = (el.value || '').trim();
      return v !== '' && v !== (el.defaultValue || '');
    });
  };

  const onBackdropClick = (e) => {
    if (e.target !== overlay) return;
    if (_hasDirtyInputs()) {
      const ok = (typeof window !== 'undefined' && typeof window.confirm === 'function')
        ? window.confirm('Закрыть без сохранения? Введённые данные пропадут')
        : true;
      if (!ok) return;
    }
    api.close();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); api.close(); }
  };

  closeBtn.addEventListener('click', () => api.close());
  overlay.addEventListener('click', onBackdropClick);
  overlay.addEventListener('keydown', onKey);

  const api = {
    root: overlay,
    open() {
      if (opened) return;
      opened = true;
      closing = false;
      if (!overlay.parentNode) document.body.appendChild(overlay);
      // Force reflow so `.show` triggers transition reliably.
      // eslint-disable-next-line no-unused-expressions
      overlay.offsetHeight;
      overlay.classList.add('show');
      try {
        detachFocusTrap = FocusTrap.attach(overlay, {
          initialFocus: bodyEl.querySelector('input, textarea, select, button')
            || footerEl.querySelector('button')
            || closeBtn,
        });
      } catch (_) { detachFocusTrap = null; }
    },
    close() {
      if (!opened || closing) return;
      closing = true;
      overlay.classList.remove('show');
      overlay.classList.add('closing');
      const finalize = () => {
        try { if (detachFocusTrap) detachFocusTrap(); } catch (_) {}
        detachFocusTrap = null;
        try { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); } catch (_) {}
        opened = false;
        closing = false;
        if (typeof onClose === 'function') { try { onClose(); } catch (_) {} }
      };
      if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
        window.setTimeout(finalize, 160);
      } else {
        finalize();
      }
    },
    destroy() {
      try { if (detachFocusTrap) detachFocusTrap(); } catch (_) {}
      detachFocusTrap = null;
      try { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); } catch (_) {}
      opened = false;
      closing = false;
    },
  };

  return api;
}

/**
 * P10.15 helper — backdrop-click rule «confirm если форма грязная».
 * Удобный wrapper для существующих модалок: можно навесить на overlay
 * и получить готовое поведение без миграции на createPrismaDialog.
 *
 * @param {HTMLElement} overlayEl — `.modal-overlay`-узел.
 * @param {Function} closeFn — функция закрытия (что вызвать при OK).
 * @param {Object} [opts]
 * @param {string} [opts.message] — текст confirm.
 * @returns {() => void} detach-обработчик.
 */
export function attachBackdropClose(overlayEl, closeFn, opts = {}) {
  if (!overlayEl || typeof closeFn !== 'function') return () => {};
  const { message = 'Закрыть без сохранения? Введённые данные пропадут' } = opts;
  const handler = (e) => {
    if (e.target !== overlayEl) return;
    const inputs = overlayEl.querySelectorAll('input, textarea');
    const dirty = Array.from(inputs).some(el => {
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked && !el.defaultChecked;
      const v = (el.value || '').trim();
      return v !== '' && v !== (el.defaultValue || '');
    });
    if (dirty) {
      const ok = (typeof window !== 'undefined' && typeof window.confirm === 'function')
        ? window.confirm(message) : true;
      if (!ok) return;
    }
    closeFn(e);
  };
  overlayEl.addEventListener('click', handler);
  return () => overlayEl.removeEventListener('click', handler);
}

// TECH кр.13 — миграция на Services registry. ConfirmDialog / FocusTrap /
// ToastQueue регистрируются единообразно. Services.register уже зеркалит
// на window — явные window.X ниже сохранены как signal что модуль
// ОЖИДАЕТ window-mirror (для будущего удаления когда callsite'ы мигрируют).
import { Services } from './services.js';
Services.register('ConfirmDialog',       ConfirmDialog);
Services.register('FocusTrap',           FocusTrap);
Services.register('ToastQueue',          ToastQueue);
Services.register('createPrismaDialog',  createPrismaDialog);
Services.register('attachBackdropClose', attachBackdropClose);

if (typeof window !== 'undefined') {
  window.ConfirmDialog       = ConfirmDialog;
  window.FocusTrap           = FocusTrap;
  window.ToastQueue          = ToastQueue;
  // AUDIT_HOLISTIC паттерн 9 / Идея 14 — `window.Toast` теперь устанавливается
  // в `app/toast.js` (чистый thin-wrapper API: success/error/info/warn/loading
  // + persist + mascotPhase + subText + actionLabel/onAction). Здесь больше
  // НЕ alias'им на ToastQueue, чтобы load-order был детерминированным
  // (toast.js импортирует ToastQueue → window.Toast = чистый API).
  // Legacy `ToastQueue.error/warning/success/loading/info` помощники остаются
  // на месте для backward-compat (см. ToastQueue определение выше).
  window.createPrismaDialog  = createPrismaDialog;
  window.attachBackdropClose = attachBackdropClose;
}
