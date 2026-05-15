'use strict';
/* ============================================================
   NOTIFY CENTER — AUDIT_HOLISTIC F4
   --
   Единый центр уведомлений (вместо разрозненных toast-queue,
   mascot-pulse, FAB-ring, badge на nav). Persistent inbox:
   тимлид, который не у экрана 30 минут, не теряет события.

   Public API:
     NotifyCenter.add({ id, kind, title, body, actor, ts,
                        severity, actionUrl, actionLabel })
     NotifyCenter.markRead(id)
     NotifyCenter.markAllRead()
     NotifyCenter.dismiss(id)
     NotifyCenter.clear()
     NotifyCenter.getAll()         → Array<Notification>
     NotifyCenter.getUnreadCount() → number
     NotifyCenter.subscribe(fn)    → unsubscribe()
     NotifyCenter.unsubscribe(fn)
     NotifyCenter.renderPanel(rootEl) — rendering UI для bell-popup

   Persistence:
     Запись делается через Reactive proxy (state.notifications mutation
     → debounced Storage.save). Контракт CLAUDE.md #1: НЕ вызываем
     Storage.save() напрямую. Mass-mutations (markAllRead / clear)
     обёрнуты в Reactive.silent + Reactive.notifyManual.

   Severity:
     'info'        — нейтральная подсказка       (--prizma-information)
     'drift'       — предупреждение, дрейф       (--prizma-drift)
     'off-course'  — критика, off-course         (--prizma-off-course)
     'insight'     — проактивный инсайт          (--prizma-insight)

   Cap:
     Max 100 записей. При overflow вытесняется самая старая (FIFO).
     Записи старше 30 дней автоматически отбрасываются на add().

   Identity-deterministic (CLAUDE.md #2):
     Поле `actor` — email или jiraAccountId сотрудника. НЕ fuzzy-name.
     Если нотификация про сотрудника, caller передаёт identity-key,
     а не «Иванов И.И.»

   ============================================================ */

import { state } from '../state.js';
import { Reactive } from '../reactiveStore.js';
import { Icons } from './icons.js';
import { Services } from './services.js';

const SEVERITY = Object.freeze({
  INFO:       'info',
  DRIFT:      'drift',
  OFF_COURSE: 'off-course',
  INSIGHT:    'insight',
});

const SEVERITY_TOKEN = Object.freeze({
  'info':       'information',
  'drift':      'drift',
  'off-course': 'off-course',
  'insight':    'insight',
});

const CAP_MAX = 100;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней

const _subscribers = new Set();
let _seq = 1;

function _ensureArray() {
  if (!Array.isArray(state.notifications)) {
    state.notifications = [];
  }
  return state.notifications;
}

function _notifySubscribers(reason) {
  for (const fn of Array.from(_subscribers)) {
    try { fn(reason); } catch (_) { /* one bad subscriber doesn't break others */ }
  }
}

function _normalizeSeverity(s) {
  if (s === SEVERITY.INFO || s === SEVERITY.DRIFT
      || s === SEVERITY.OFF_COURSE || s === SEVERITY.INSIGHT) return s;
  return SEVERITY.INFO;
}

function _genId() {
  return 'ntf-' + Date.now().toString(36) + '-' + (_seq++).toString(36);
}

function _purgeOld(arr) {
  const cutoff = Date.now() - MAX_AGE_MS;
  return arr.filter(n => {
    const ts = Number(n?.ts) || 0;
    return ts >= cutoff;
  });
}

/* ── Public API ─────────────────────────────────────────── */

export const NotifyCenter = {
  SEVERITY,

  /**
   * Добавить нотификацию.
   * @param {object} opts
   * @param {string}  [opts.id]            — auto-generated если не задан
   * @param {string}  [opts.kind='generic']— smysl/category ('drift' / 'risk' / 'insight' / etc)
   * @param {string}  [opts.title]
   * @param {string}  [opts.body]
   * @param {string}  [opts.actor]         — identity-deterministic key
   *                                          (email / jiraAccountId), не имя.
   * @param {number}  [opts.ts]            — millis since epoch (default: Date.now())
   * @param {string}  [opts.severity]      — info / drift / off-course / insight
   * @param {string}  [opts.actionUrl]     — deep-link (например, #section-gantt?epic=X)
   * @param {string}  [opts.actionLabel]   — caption кнопки
   * @returns {object} the stored notification
   */
  add(opts = {}) {
    const arr = _ensureArray();
    const purged = _purgeOld(arr);
    const ts = Number.isFinite(opts.ts) ? Number(opts.ts) : Date.now();
    const note = {
      id:          opts.id || _genId(),
      kind:        String(opts.kind || 'generic'),
      title:       String(opts.title || ''),
      body:        String(opts.body || ''),
      actor:       opts.actor ? String(opts.actor) : '',
      ts,
      severity:    _normalizeSeverity(opts.severity),
      read:        false,
      actionUrl:   opts.actionUrl ? String(opts.actionUrl) : '',
      actionLabel: opts.actionLabel ? String(opts.actionLabel) : '',
    };
    purged.push(note);
    // FIFO cap: drop oldest first.
    let next = purged;
    if (next.length > CAP_MAX) next = next.slice(next.length - CAP_MAX);
    state.notifications = next;
    _notifySubscribers('add');
    return note;
  },

  markRead(id) {
    const arr = _ensureArray();
    const idx = arr.findIndex(n => n && n.id === id);
    if (idx < 0) return false;
    if (arr[idx].read) return true;
    // Прямая мутация через Reactive proxy → debounced save.
    arr[idx].read = true;
    _notifySubscribers('markRead');
    return true;
  },

  /**
   * Mass-mutation. Обёрнут в Reactive.silent чтобы не плодить дребезг —
   * один dirty-flag на батч (контракт CLAUDE.md #1).
   */
  markAllRead() {
    const arr = _ensureArray();
    if (!arr.length) return 0;
    let changed = 0;
    Reactive.silent(() => {
      for (const n of arr) {
        if (n && !n.read) { n.read = true; changed++; }
      }
    });
    if (changed > 0) {
      // Inform the reactive layer manually (we did mutate inside silent).
      Reactive.notifyManual();
      _notifySubscribers('markAllRead');
    }
    return changed;
  },

  dismiss(id) {
    const arr = _ensureArray();
    const idx = arr.findIndex(n => n && n.id === id);
    if (idx < 0) return false;
    // Replace array reference so reactive proxy notices.
    state.notifications = arr.slice(0, idx).concat(arr.slice(idx + 1));
    _notifySubscribers('dismiss');
    return true;
  },

  clear() {
    const arr = _ensureArray();
    if (!arr.length) return 0;
    const n = arr.length;
    state.notifications = [];
    _notifySubscribers('clear');
    return n;
  },

  getAll() {
    const arr = _ensureArray();
    // Чистим old at read-time тоже, чтобы UI не показывал stale-запись
    // если нет add()-операций (например, сессия просто долго открыта).
    const fresh = _purgeOld(arr);
    if (fresh.length !== arr.length) state.notifications = fresh;
    // Newest first.
    return fresh.slice().sort((a, b) => (Number(b?.ts) || 0) - (Number(a?.ts) || 0));
  },

  getUnreadCount() {
    const arr = _ensureArray();
    let c = 0;
    for (const n of arr) if (n && !n.read) c++;
    return c;
  },

  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    _subscribers.add(fn);
    return () => _subscribers.delete(fn);
  },

  unsubscribe(fn) {
    _subscribers.delete(fn);
  },

  /* ── UI: bell-button + panel rendering ─────────────────── */

  /**
   * Hydrate bell-button: подцепить click + бейдж + ARIA-state.
   * Безопасно вызывать несколько раз (idempotent — `data-hydrated`).
   */
  hydrateBell(btnEl, panelEl) {
    if (!btnEl || btnEl.dataset.notifyHydrated === '1') return;
    btnEl.dataset.notifyHydrated = '1';
    btnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      NotifyCenter.togglePanel(panelEl, btnEl);
    });
    NotifyCenter._refreshBadge(btnEl);
    NotifyCenter.subscribe(() => {
      NotifyCenter._refreshBadge(btnEl);
      // Если панель открыта — перерисовать листинг.
      if (panelEl && !panelEl.classList.contains('hidden')) {
        NotifyCenter.renderPanel(panelEl, btnEl);
      }
    });
    // Click-outside чтобы закрыть.
    if (typeof document !== 'undefined') {
      document.addEventListener('click', (e) => {
        if (!panelEl || panelEl.classList.contains('hidden')) return;
        if (panelEl.contains(e.target) || btnEl.contains(e.target)) return;
        NotifyCenter.closePanel(panelEl, btnEl);
      });
    }
  },

  togglePanel(panelEl, btnEl) {
    if (!panelEl) return;
    if (panelEl.classList.contains('hidden')) {
      NotifyCenter.openPanel(panelEl, btnEl);
    } else {
      NotifyCenter.closePanel(panelEl, btnEl);
    }
  },

  openPanel(panelEl, btnEl) {
    if (!panelEl) return;
    NotifyCenter.renderPanel(panelEl, btnEl);
    panelEl.classList.remove('hidden');
    if (btnEl) btnEl.setAttribute('aria-expanded', 'true');
  },

  closePanel(panelEl, btnEl) {
    if (!panelEl) return;
    panelEl.classList.add('hidden');
    if (btnEl) btnEl.setAttribute('aria-expanded', 'false');
  },

  _refreshBadge(btnEl) {
    if (!btnEl) return;
    const count = NotifyCenter.getUnreadCount();
    let dot = btnEl.querySelector('.prizma-notify-dot');
    if (count > 0) {
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'prizma-notify-dot';
        dot.setAttribute('aria-hidden', 'true');
        btnEl.appendChild(dot);
      }
      // Pulse-animation triggers via CSS class — restart by re-adding.
      dot.classList.remove('prizma-notify-dot--pulse');
      // Force reflow before re-adding for restart anim.
      // eslint-disable-next-line no-unused-expressions
      void dot.offsetWidth;
      dot.classList.add('prizma-notify-dot--pulse');
      btnEl.setAttribute('aria-label', `Уведомления (${count} новых)`);
    } else {
      if (dot) dot.remove();
      btnEl.setAttribute('aria-label', 'Уведомления');
    }
  },

  /**
   * Rendering panel UI: header + list + empty + footer.
   * Caller предоставляет уже-существующий DOM-узел `<div class="prizma-notify-panel">`.
   */
  renderPanel(rootEl, btnEl) {
    if (!rootEl) return;
    const items = NotifyCenter.getAll();
    const escape = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const header = `
      <div class="prizma-notify-header">
        <span class="prizma-notify-eyebrow">УВЕДОМЛЕНИЯ</span>
        ${items.some(n => !n.read)
          ? `<button type="button" class="prizma-notify-mark-all" data-action="mark-all">Прочитать всё</button>`
          : ''}
      </div>
    `;

    let body;
    if (!items.length) {
      body = `
        <div class="prizma-notify-empty">
          <span class="obs obs--sm obs--breathe obs--ls-thinking obs--alive" aria-hidden="true">
            <svg viewBox="-60 -60 120 120"><use href="#obs-base"/></svg>
          </span>
          <p class="prizma-notify-empty-msg">Здесь будет тихо</p>
          <p class="prizma-notify-empty-sub">Когда курс качнётся, мы скажем — без шума.</p>
        </div>
      `;
    } else {
      const rows = items.map(n => {
        const sev = _normalizeSeverity(n.severity);
        const token = SEVERITY_TOKEN[sev] || 'information';
        const rel = NotifyCenter.formatRelative(n.ts);
        const action = n.actionUrl
          ? `<a class="prizma-notify-action" href="${escape(n.actionUrl)}" data-id="${escape(n.id)}">${escape(n.actionLabel || 'Открыть')}</a>`
          : '';
        return `
          <li class="prizma-notify-row prizma-notify-row--${escape(token)}${n.read ? ' is-read' : ''}"
              data-id="${escape(n.id)}">
            <div class="prizma-notify-row-stripe" aria-hidden="true"></div>
            <div class="prizma-notify-row-body">
              <div class="prizma-notify-row-head">
                <span class="prizma-notify-row-title">${escape(n.title)}</span>
                <time class="prizma-notify-row-ts">${escape(rel)}</time>
              </div>
              ${n.body ? `<p class="prizma-notify-row-text">${escape(n.body)}</p>` : ''}
              <div class="prizma-notify-row-actions">
                ${action}
                ${!n.read ? `<button type="button" class="prizma-notify-row-read" data-action="read" data-id="${escape(n.id)}">Прочитано</button>` : ''}
                <button type="button" class="prizma-notify-row-dismiss" data-action="dismiss" data-id="${escape(n.id)}" aria-label="Скрыть">×</button>
              </div>
            </div>
          </li>
        `;
      }).join('');
      body = `<ul class="prizma-notify-list" role="list">${rows}</ul>`;
    }

    const footer = `
      <div class="prizma-notify-footer">
        <a href="#section-history" class="prizma-notify-history-link" data-action="history">История уведомлений</a>
      </div>
    `;

    rootEl.innerHTML = header + body + footer;
    rootEl.setAttribute('role', 'dialog');
    rootEl.setAttribute('aria-label', 'Уведомления');

    // Bind actions delegated.
    rootEl.addEventListener('click', NotifyCenter._onPanelClick, { once: false });
    // Use a fresh handler each render via dataset to avoid duplicates:
    // simpler: clone listener via removing previous binding.
    // Strategy: tag the root with a one-time binding marker.
    if (rootEl.dataset.notifyBound !== '1') {
      rootEl.dataset.notifyBound = '1';
      rootEl.addEventListener('click', (e) => {
        const t = e.target;
        if (!t || !(t instanceof Element)) return;
        const action = t.getAttribute('data-action');
        if (!action) return;
        const id = t.getAttribute('data-id') || '';
        if (action === 'mark-all') {
          NotifyCenter.markAllRead();
        } else if (action === 'read' && id) {
          NotifyCenter.markRead(id);
        } else if (action === 'dismiss' && id) {
          NotifyCenter.dismiss(id);
        } else if (action === 'history') {
          // Deep-link на History view с filter='notifications'. Если History
          // ещё не поддерживает фильтр — TODO; здесь просто меняем hash.
          if (typeof window !== 'undefined') {
            window.location.hash = '#section-history';
            NotifyCenter.closePanel(rootEl, btnEl);
          }
        }
      });
    }
  },

  /** Внутренний noop — реальный handler binding делается через
   *  `data-notify-bound`, чтобы Edit-tool не плодил дублей. */
  _onPanelClick() { /* noop placeholder for tests / typecheck */ },

  /**
   * «N мин назад / 3 ч назад / вчера / позавчера / 5 дн назад».
   * Для тестов — детерминированно от now.
   */
  formatRelative(ts, now = Date.now()) {
    const t = Number(ts) || 0;
    if (!t) return '';
    const diff = Math.max(0, now - t);
    const sec = Math.floor(diff / 1000);
    if (sec < 45) return 'только что';
    const min = Math.floor(sec / 60);
    if (min < 45) return `${min} мин назад`;
    const hr = Math.floor(min / 60);
    if (hr < 22) return `${hr} ч назад`;
    const day = Math.floor(hr / 24);
    if (day === 1) return 'вчера';
    if (day === 2) return 'позавчера';
    if (day < 30) return `${day} дн назад`;
    return new Date(t).toLocaleDateString('ru-RU');
  },

  /** For tests. */
  _CAP_MAX:    CAP_MAX,
  _MAX_AGE_MS: MAX_AGE_MS,
  _Icons:      Icons,
};

Services.register('NotifyCenter', NotifyCenter);
if (typeof window !== 'undefined') window.NotifyCenter = NotifyCenter;

export default NotifyCenter;
