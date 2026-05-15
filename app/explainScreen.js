'use strict';
/* ============================================================
   EXPLAIN SCREEN — «Объясни этот экран» (AUDIT_HOLISTIC AI1).
   ------------------------------------------------------------
   Глобальный hotkey `?` (Shift+/) или `Cmd+/` → включает explain
   mode: курсор crosshair, любой `[data-explain]` подсвечивается,
   click → popover «КАК ЧИТАТЬ» (что / как / что делать).

   Закрывает: SCANNER_METRICS F-EXPL-1, COPY 22, UX 8.

   Контракты:
     · Не дублируем LLM-клиент — используем ai/llmClient.js#callLLM.
     · `state.meta` отсутствует — настройку «enabled by default»
       читаем из localStorage `prizma.explain.enabled`.
     · Tone-of-voice: партнёр, спокойный, тёплый, точный, на «вы»,
       без эмодзи (Brand §7).

   API ExplainScreen (singleton):
     · enable()                                    — включить mode
     · disable()                                   — выключить mode
     · toggle()                                    — переключить
     · isEnabled()                                 — boolean
     · attachMeta(elementOrSelector, metaObj)      — навесить data-explain
     · explain(element)                            — показать popover
     · isHotkeyEvent(evt)                          — pure: detect `?`/Cmd+/
     · _registerCallLLM(fn)                        — DI для тестов
   ============================================================ */

import { EXPLAIN_META, getMeta, registerMeta } from './explainMeta.js';
import { Services } from './services.js';

const LS_KEY = 'prizma.explain.enabled';
const POPOVER_ID = 'explain-popover';
const OVERLAY_CLASS = 'explain-overlay-active';
const HIGHLIGHT_CLASS = 'explain-target-highlight';

/* ---------- pure helpers ---------- */

/**
 * Проверяет, является ли событие триггером explain-mode hotkey.
 * Триггеры: `?` (Shift+/) или Cmd+/ / Ctrl+/.
 * Не активируется, если фокус во вводимом поле.
 *
 * @param {KeyboardEvent|{key:string,shiftKey?:boolean,metaKey?:boolean,ctrlKey?:boolean,target?:any}} evt
 * @returns {boolean}
 */
export function isHotkeyEvent(evt) {
  if (!evt || typeof evt !== 'object') return false;
  const key = evt.key;
  if (key !== '?' && key !== '/') return false;

  const t = evt.target;
  if (t && typeof t === 'object') {
    const tag = (t.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
    if (t.isContentEditable) return false;
  }

  // `?` через Shift+/
  if (key === '?') return true;
  // Cmd+/ или Ctrl+/
  if (key === '/' && (evt.metaKey || evt.ctrlKey)) return true;
  return false;
}

/**
 * Из элемента достаёт kind для explain. Приоритет:
 *   1) data-explain="<kind>"
 *   2) ближайший родитель с data-explain
 * @param {Element|null} el
 * @returns {string|null}
 */
export function resolveKind(el) {
  if (!el || !el.closest) return null;
  const host = el.closest('[data-explain]');
  if (!host) return null;
  const kind = host.getAttribute('data-explain');
  return kind && kind.trim() ? kind.trim() : null;
}

/**
 * Достаёт читаемый label у элемента (для LLM-fallback).
 * @param {Element} el
 * @returns {string}
 */
export function resolveLabel(el) {
  if (!el) return '';
  const explicit = el.getAttribute && el.getAttribute('data-explain-label');
  if (explicit) return explicit.slice(0, 200);
  const aria = el.getAttribute && el.getAttribute('aria-label');
  if (aria) return aria.slice(0, 200);
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 200);
}

/**
 * Шаблон промпта для LLM-fallback (нет meta для kind).
 * @param {{kind:string, label:string}} ctx
 * @returns {{system:string, user:string}}
 */
export function buildLLMPrompt({ kind, label }) {
  const system =
    'Вы — партнёр по продукту Призма. Объясняете спокойно, точно, тёпло, ' +
    'на «вы». Без эмодзи. Без восклицательных знаков. Без жаргона. ' +
    'Не более трёх коротких строк.';
  const user =
    `Объясните кратко (3 строки), что показывает этот блок интерфейса.\n` +
    `kind=${kind || 'unknown'}\n` +
    `label=${label || ''}\n` +
    `Структура ответа: 1) что показывает; 2) как считается коротко; ` +
    `3) что делать, если значение не нравится.`;
  return { system, user };
}

/* ---------- DOM utils (no-op в node-тестах) ---------- */

function hasDOM() {
  return typeof document !== 'undefined' && !!document.body;
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function trackTelem(eventName, payload) {
  try {
    const T = (typeof window !== 'undefined' && window.Telem) || null;
    if (T && typeof T.track === 'function') {
      T.track(eventName, payload || {});
      return;
    }
  } catch(_) { /* noop */ }
  try { console.debug('[explain]', eventName, payload || {}); } catch(_) {}
}

/* ---------- popover render ---------- */

function ensurePopoverStyles() {
  if (!hasDOM()) return;
  if (document.getElementById('explain-screen-styles')) return;
  const css = `
.explain-overlay-active, .explain-overlay-active * { cursor: crosshair !important; }
.explain-target-highlight { outline: 2px solid #C9A24A !important; outline-offset: 2px; box-shadow: 0 0 0 4px rgba(201,162,74,.15); }
#${POPOVER_ID} { position: fixed; z-index: 9999; max-width: 360px; min-width: 240px;
  background: var(--panel-bg, #fff); color: var(--text, #1A1A1A);
  border: 1px solid var(--panel-border, rgba(0,0,0,.12));
  border-radius: 10px; box-shadow: 0 10px 28px rgba(0,0,0,.18);
  padding: 14px 16px 12px; font: 13px/1.45 ui-sans-serif, system-ui, sans-serif; }
#${POPOVER_ID} .explain-eyebrow { font-size: 9px; letter-spacing: .7px;
  text-transform: uppercase; font-weight: 600; opacity: .7; margin-bottom: 6px; }
#${POPOVER_ID} .explain-title { font-size: 14px; font-weight: 600; margin: 0 0 8px; }
#${POPOVER_ID} .explain-section { margin: 6px 0; }
#${POPOVER_ID} .explain-section-label { font-size: 11px; font-weight: 600; opacity: .65; margin-bottom: 2px; }
#${POPOVER_ID} .explain-body { font-size: 13px; }
#${POPOVER_ID} .explain-footer { display:flex; justify-content: space-between; gap: 8px;
  margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,.08); }
#${POPOVER_ID} .explain-link-btn { background: none; border: 0; padding: 0; cursor: pointer;
  color: var(--accent, #C9A24A); font-size: 12px; text-decoration: underline; }
#${POPOVER_ID} .explain-close { background: none; border: 0; padding: 0; cursor: pointer;
  font-size: 16px; line-height: 1; opacity: .55; }
#${POPOVER_ID} .explain-close:hover { opacity: 1; }
`;
  const style = document.createElement('style');
  style.id = 'explain-screen-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

function closePopover() {
  if (!hasDOM()) return;
  const node = document.getElementById(POPOVER_ID);
  if (node && node.parentNode) node.parentNode.removeChild(node);
}

function renderPopover(element, content) {
  if (!hasDOM() || !element) return;
  ensurePopoverStyles();
  closePopover();

  const rect = (element.getBoundingClientRect && element.getBoundingClientRect()) || { top: 80, left: 80, bottom: 100 };
  const top  = Math.max(8, Math.min(window.innerHeight - 240, rect.bottom + 8));
  const left = Math.max(8, Math.min(window.innerWidth  - 380, rect.left));

  const wrap = document.createElement('div');
  wrap.id = POPOVER_ID;
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-label', 'Как читать этот блок');
  wrap.style.top = `${top}px`;
  wrap.style.left = `${left}px`;
  wrap.innerHTML = content;
  document.body.appendChild(wrap);

  const closeBtn = wrap.querySelector('.explain-close');
  if (closeBtn) closeBtn.addEventListener('click', closePopover);

  const askBtn = wrap.querySelector('[data-explain-ask]');
  if (askBtn) askBtn.addEventListener('click', () => {
    const kind = askBtn.getAttribute('data-kind') || '';
    closePopover();
    try {
      const drawer = (typeof window !== 'undefined') && (window.ChatDrawer || Services.LLMAssistant);
      if (drawer && typeof drawer.openWithPrompt === 'function') {
        drawer.openWithPrompt(`Расскажите подробнее про блок «${kind}». Что ещё стоит знать?`);
      } else if (typeof window !== 'undefined' && typeof window.openChatDrawer === 'function') {
        window.openChatDrawer({ prefill: `Расскажите подробнее про блок «${kind}».` });
      }
    } catch(_) { /* drawer not available — ok */ }
    trackTelem('explain.ask_more', { kind });
  });
}

function buildPopoverHTMLFromMeta(meta) {
  const kind = escHtml(meta.kind);
  return `
    <button class="explain-close" type="button" aria-label="Закрыть">×</button>
    <div class="explain-eyebrow">Как читать</div>
    <h3 class="explain-title">${escHtml(meta.kind)}</h3>
    <div class="explain-section">
      <div class="explain-section-label">Что показывает</div>
      <div class="explain-body">${escHtml(meta.what)}</div>
    </div>
    <div class="explain-section">
      <div class="explain-section-label">Как считается</div>
      <div class="explain-body">${escHtml(meta.how)}</div>
    </div>
    <div class="explain-section">
      <div class="explain-section-label">Что делать</div>
      <div class="explain-body">${escHtml(meta.soWhat)}</div>
    </div>
    <div class="explain-footer">
      <button class="explain-link-btn" type="button" data-explain-ask data-kind="${kind}">Спросить ещё</button>
      <span class="explain-eyebrow">Призма</span>
    </div>
  `;
}

function buildPopoverHTMLFromText(kind, text) {
  return `
    <button class="explain-close" type="button" aria-label="Закрыть">×</button>
    <div class="explain-eyebrow">Как читать</div>
    <h3 class="explain-title">${escHtml(kind || 'этот блок')}</h3>
    <div class="explain-section">
      <div class="explain-body">${escHtml(text)}</div>
    </div>
    <div class="explain-footer">
      <button class="explain-link-btn" type="button" data-explain-ask data-kind="${escHtml(kind || '')}">Спросить ещё</button>
      <span class="explain-eyebrow">Призма</span>
    </div>
  `;
}

/* ---------- ExplainScreen singleton ---------- */

const _state = {
  enabled: false,
  /** @type {((opts:{system:string,user:string})=>Promise<string|null>)|null} */
  callLLMFn: null,
  /** Зарегистрированные хэндлеры — для disable() очистки. */
  _onKey: null,
  _onClick: null,
  _onMove: null,
  _highlighted: null,
};

async function _defaultCallLLM(opts) {
  try {
    const mod = await import('../ai/llmClient.js');
    if (mod && typeof mod.callLLM === 'function') {
      return mod.callLLM({ system: opts.system, user: opts.user, maxTokens: 220, temperature: 0.2 });
    }
  } catch(e) {
    try { console.warn('[explain] llmClient unavailable:', e?.message || e); } catch(_) {}
  }
  return null;
}

function _highlight(el) {
  if (!hasDOM()) return;
  if (_state._highlighted && _state._highlighted !== el) {
    _state._highlighted.classList.remove(HIGHLIGHT_CLASS);
  }
  if (el) el.classList.add(HIGHLIGHT_CLASS);
  _state._highlighted = el;
}

function _clearHighlight() {
  if (!hasDOM()) return;
  if (_state._highlighted) {
    _state._highlighted.classList.remove(HIGHLIGHT_CLASS);
    _state._highlighted = null;
  }
}

function _onMove(evt) {
  if (!_state.enabled) return;
  const target = evt.target && evt.target.closest && evt.target.closest('[data-explain]');
  _highlight(target || null);
}

function _onClick(evt) {
  if (!_state.enabled) return;
  const target = evt.target && evt.target.closest && evt.target.closest('[data-explain]');
  if (!target) return;
  evt.preventDefault();
  evt.stopPropagation();
  ExplainScreen.explain(target);
  ExplainScreen.disable();
}

function _onKey(evt) {
  // Esc — выйти из mode и закрыть popover.
  if (evt.key === 'Escape') {
    if (_state.enabled) ExplainScreen.disable();
    closePopover();
    return;
  }
  if (isHotkeyEvent(evt)) {
    evt.preventDefault();
    ExplainScreen.toggle();
  }
}

export const ExplainScreen = {
  isEnabled() { return !!_state.enabled; },

  enable() {
    if (_state.enabled) return;
    _state.enabled = true;
    if (hasDOM()) {
      ensurePopoverStyles();
      document.body.classList.add(OVERLAY_CLASS);
      _state._onMove = _onMove;
      _state._onClick = _onClick;
      document.addEventListener('mousemove', _state._onMove, true);
      document.addEventListener('click', _state._onClick, true);
    }
    trackTelem('explain.mode_enable', {});
  },

  disable() {
    _state.enabled = false;
    if (hasDOM()) {
      document.body.classList.remove(OVERLAY_CLASS);
      if (_state._onMove)  document.removeEventListener('mousemove', _state._onMove, true);
      if (_state._onClick) document.removeEventListener('click',     _state._onClick, true);
      _state._onMove = null;
      _state._onClick = null;
      _clearHighlight();
    }
    trackTelem('explain.mode_disable', {});
  },

  toggle() {
    if (_state.enabled) this.disable(); else this.enable();
  },

  /**
   * Привязать meta-описание к элементу/селектору. Если meta новый kind —
   * также регистрируется в EXPLAIN_META.
   * @param {Element|string} elementOrSelector
   * @param {ExplainMeta|{kind:string,...}} metaObj
   */
  attachMeta(elementOrSelector, metaObj) {
    if (!metaObj || !metaObj.kind) return false;
    registerMeta(metaObj);
    if (!hasDOM()) return true;
    const el = (typeof elementOrSelector === 'string')
      ? document.querySelector(elementOrSelector)
      : elementOrSelector;
    if (el && el.setAttribute) {
      el.setAttribute('data-explain', metaObj.kind);
      if (metaObj.what)
        el.setAttribute('data-explain-label', String(metaObj.what).slice(0, 120));
    }
    return true;
  },

  /**
   * Открыть popover для элемента. Если у элемента есть data-explain →
   * meta из реестра. Если meta нет — LLM-fallback.
   */
  async explain(element) {
    if (!element) return;
    const kind = resolveKind(element);
    const meta = kind ? getMeta(kind) : null;

    if (meta) {
      renderPopover(element, buildPopoverHTMLFromMeta(meta));
      trackTelem('explain.open', { kind, source: 'meta' });
      return;
    }

    // LLM fallback
    const label = resolveLabel(element);
    const prompt = buildLLMPrompt({ kind, label });
    renderPopover(element, buildPopoverHTMLFromText(kind, 'Подбираем объяснение…'));
    trackTelem('explain.open', { kind: kind || 'unknown', source: 'llm' });

    const fn = _state.callLLMFn || _defaultCallLLM;
    let answer = null;
    try { answer = await fn(prompt); } catch(_) { answer = null; }

    const text = (answer && typeof answer === 'string' && answer.trim())
      ? answer.trim()
      : 'Не удалось получить объяснение. Попробуйте ещё раз или обратитесь к коллеге.';

    if (hasDOM() && document.getElementById(POPOVER_ID)) {
      renderPopover(element, buildPopoverHTMLFromText(kind, text));
    }
  },

  /** DI hook для тестов. */
  _registerCallLLM(fn) { _state.callLLMFn = (typeof fn === 'function') ? fn : null; },

  /** Глобальный bind hotkey. Вызывать один раз из bootstrap (app.js / init). */
  bindHotkey() {
    if (!hasDOM() || _state._onKey) return;
    _state._onKey = _onKey;
    document.addEventListener('keydown', _state._onKey, true);
    // Авто-включение, если пользователь оставил флажок в localStorage.
    try {
      const v = localStorage.getItem(LS_KEY);
      if (v === '1') ExplainScreen.enable();
    } catch(_) { /* SSR / locked storage */ }
  },

  unbindHotkey() {
    if (hasDOM() && _state._onKey) {
      document.removeEventListener('keydown', _state._onKey, true);
      _state._onKey = null;
    }
  },

  /** Чтение/запись пользовательского флажка (для будущих настроек). */
  setEnabledByDefault(flag) {
    try { localStorage.setItem(LS_KEY, flag ? '1' : '0'); } catch(_) {}
  },
  getEnabledByDefault() {
    try { return localStorage.getItem(LS_KEY) === '1'; }
    catch(_) { return false; }
  },
};

// Удобный namespace, чтобы внутри теста можно было обнулить state.
ExplainScreen._internals = {
  state: _state,
  buildPopoverHTMLFromMeta,
  buildPopoverHTMLFromText,
};

Services.register('ExplainScreen', ExplainScreen);
// Авто-bind в браузере (не в node:test).
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => ExplainScreen.bindHotkey(), { once: true });
    } else {
      ExplainScreen.bindHotkey();
    }
    window.ExplainScreen = ExplainScreen;
  } catch(_) { /* noop */ }
}

export default ExplainScreen;
