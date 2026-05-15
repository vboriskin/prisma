'use strict';
/* ============================================================
   app/router.js — AUDIT_HOLISTIC F9 (deep-link sharing)
   --
   Hash-based router + 2-way bind с `state.filters`. Без full reload
   и без History API (corporate-deploy-friendly: file:// тоже работает).

   Формат hash:
     #<section>?<key1>=<val1>&<key2>=<val2>
       e.g. #registry?team=Alpha&sprint=PI-1.21&done=false

     · `<section>` — ключ из nav.js (`registry`, `gantt`, `dashboard`, ...).
     · `<key>=<val>` — пары whitelist'ом (см. SAFE_FILTER_KEYS ниже).
     · Значения проходят через `encodeURIComponent` / `decodeURIComponent`.
     · Boolean-фильтры сериализуются как `true`/`false`; массивы — `,`-joined.
     · Массивы / объекты-значения, не входящие в whitelist, в URL не попадают.

   Public API:
     · Router.init({ App })            — повесить hashchange listener,
                                         подписаться на Reactive flush, применить
                                         текущий location.hash к state.
     · Router.navigate(section, fs?)   — программно переписать hash;
                                         если fs передан → state.filters заменён.
     · Router.parse(hash)              — { section, filters }
     · Router.serialize(section, fs)   — string `#section?...`
     · Router.subscribe(fn)            — fn({section, filters, source})
     · Router.unsubscribe(fn)
     · Router._applyHashToState(hash)  — внутреннее, expose для тестов
     · Router._dispose()               — для тестов, снять listeners

   Контракты:
     · Никогда не пишем `Storage.save()` напрямую.
     · Apply hash → state делается через Reactive.silent (mass mutation),
       чтобы не было save+refresh×N от каждого set'а.
     · Cycle-detection через флаг `_routerUpdating`: hashchange-handler
       рассматривает событие только если флаг false (т.е. URL изменился
       НЕ нами).
     · PII в URL: значения проходят через `PII.scrubString` если глобальный
       PII доступен; whitelist всё равно гарантирует, что email/phone-поля
       никогда не пробрасываются.

   «From» tracking (HOLISTIC паттерн 14):
     state.filters._source = 'url' | 'manual' | 'drill-down'.
     Router выставляет `'url'` когда применяет hash; UI filter-bar читает
     поле для бейджа «Из ссылки → ...».
   ============================================================ */

import { state } from '../state.js';
import { Reactive } from '../reactiveStore.js';
import { Services } from './services.js';

// Whitelist — какие поля state.filters допустимо писать в URL.
// `sprint` оставлен на будущее (placeholder для PI-фильтра, AUDIT_HOLISTIC F9).
// `done` — alias для `onlyDone` (короче в URL).
const SAFE_FILTER_KEYS = Object.freeze([
  'team', 'sprint', 'done', 'scope', 'assignee', 'release', 'priority',
  'role', 'workType', 'tag', 'search', 'onlyBlocking', 'onlyRisky', 'onlyDone',
]);

// Aliases: URL key ↔ state.filters key (когда они расходятся для краткости).
const URL_TO_STATE = Object.freeze({ done: 'onlyDone' });
const STATE_TO_URL = Object.freeze({ onlyDone: 'done' });

// V22 X-03 (audit-experts-2026-05-15 Selvadurai #3) — focus-keys для
// унифицированного deep-link'а. Раньше Сканнер использовал собственный
// hash формата `#scanner2/employee/<key>` (parser в teamScanner2.js),
// что давало два несовместимых URL-формата в одном продукте. Теперь:
//   #scanner2?focusKind=employee&focusId=ivanov@sber.ru
//   #gantt?focusKind=epic&focusId=BIK-1234
//   #registry?team=PAY&focusKind=epic&focusId=BIK-1234
// Все три — единый формат, парсятся одним Router.
const FOCUS_KEYS = Object.freeze(['focusKind', 'focusId', 'focusPeriod']);
const VALID_FOCUS_KINDS = Object.freeze(['employee', 'epic', 'team', 'release', 'block-id']);

// Section whitelist собирается лениво из DOM (если он есть) — fallback
// на жёсткий список для node-окружения (тесты).
const FALLBACK_SECTIONS = Object.freeze([
  'dashboard', 'registry', 'gantt', 'kanban', 'timeline', 'podlozhka',
  'history', 'employees', 'burnout', 'component-health', 'ai-ceo',
  'exec', 'actions', 'ai', 'metrics', 'integrations', 'diagnostics',
  'errors', 'est-calibration', 'doc-debt',
]);

const DEBOUNCE_MS = 300;

let _routerUpdating = false;          // true — Router сам пишет hash → ignore hashchange
let _stateUpdating = false;           // true — Router сам пишет state → ignore reactive
let _hashchangeBound = null;
let _reactiveUnsub = null;
let _writeTimer = null;
let _initDeps = null;
const _subscribers = new Set();

function _getValidSections() {
  if (typeof document !== 'undefined' && document.querySelectorAll) {
    const dom = Array.from(document.querySelectorAll('[data-section]'))
      .map(el => el.getAttribute('data-section'))
      .filter(Boolean);
    if (dom.length) return new Set(dom);
  }
  return new Set(FALLBACK_SECTIONS);
}

/** Light wrapper — глобальный PII если есть, иначе identity. */
function _scrub(s) {
  try {
    if (typeof window !== 'undefined' && window.PII && typeof window.PII.scrubString === 'function') {
      return window.PII.scrubString(String(s), 500);
    }
    if (typeof globalThis !== 'undefined' && globalThis.PII && typeof globalThis.PII.scrubString === 'function') {
      return globalThis.PII.scrubString(String(s), 500);
    }
  } catch (_) { /* PII модуль не обязан быть загружен в этом окружении */ }
  return String(s);
}

/** Encode единичного значения для URL. Boolean → 'true'/'false'; массив → ','-joined. */
function _encodeValue(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    return v.filter(x => x != null && x !== '').map(x => encodeURIComponent(_scrub(String(x)))).join(',');
  }
  return encodeURIComponent(_scrub(String(v)));
}

/** Decode значения из URL. Если содержит запятую — массив. Boolean keywords → bool. */
function _decodeValue(raw, originalKey) {
  if (raw == null || raw === '') return '';
  // Массивы: split по `,` ДО decode (чтобы `%2C` внутри элемента не трактовался).
  if (raw.includes(',')) {
    return raw.split(',').map(x => {
      try { return decodeURIComponent(x); } catch (_) { return x; }
    }).filter(x => x !== '');
  }
  let s;
  try { s = decodeURIComponent(raw); } catch (_) { s = raw; }
  // Boolean ключи (URL-форма "done" + state-форма "onlyDone/onlyRisky/onlyBlocking").
  const k = (originalKey || '').toLowerCase();
  if (k === 'done' || k.startsWith('only')) {
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0' || s === '') return false;
  }
  return s;
}

/**
 * Parse `#section?key=val&key2=val2` → { section, filters }.
 * Толерантен к пустому/мусорному hash (возвращает {section:'', filters:{}}).
 * @param {string} hash
 */
function parse(hash) {
  // V22 X-03 — `focus` поле появляется ТОЛЬКО когда в hash есть валидные
  // focus-параметры (или legacy Scanner-формат). Для пустого hash'а
  // возвращаем {section:'', filters:{}} — backward-compat с тестами
  // (router.test.js использует deepEqual).
  const out = { section: '', filters: {} };
  if (!hash || typeof hash !== 'string') return out;
  let h = hash.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (!h) return out;
  // V22 X-03 — обратная совместимость с legacy Scanner-форматом
  // `#scanner2/employee/<key>`. Раньше парсился в teamScanner2.js собственным
  // hash-handler'ом; теперь Router переводит его в канонический формат.
  const legacyScanner = h.match(/^scanner2\/(employee|epic|team)\/(.+?)(?:\?|$)/);
  if (legacyScanner) {
    out.section = 'scanner2';
    let id;
    try { id = decodeURIComponent(legacyScanner[2]); } catch (_) { id = legacyScanner[2]; }
    out.focus = { kind: legacyScanner[1], id };
    return out;
  }
  const qIdx = h.indexOf('?');
  const section = (qIdx === -1 ? h : h.slice(0, qIdx)).trim();
  const query = qIdx === -1 ? '' : h.slice(qIdx + 1);
  out.section = section;
  if (!query) return out;
  const focusBuilder = {};
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawVal = eq === -1 ? '' : pair.slice(eq + 1);
    let key;
    try { key = decodeURIComponent(rawKey); } catch (_) { key = rawKey; }
    // V22 X-03 — focus-keys обрабатываются отдельно (не идут в filters).
    if (FOCUS_KEYS.includes(key)) {
      let val;
      try { val = decodeURIComponent(rawVal); } catch (_) { val = rawVal; }
      focusBuilder[key] = val;
      continue;
    }
    if (!SAFE_FILTER_KEYS.includes(key)) continue;          // whitelist
    const stateKey = URL_TO_STATE[key] || key;
    out.filters[stateKey] = _decodeValue(rawVal, key);
  }
  // Compose focus только если есть валидный kind+id.
  if (focusBuilder.focusKind && focusBuilder.focusId &&
      VALID_FOCUS_KINDS.includes(focusBuilder.focusKind)) {
    out.focus = {
      kind: focusBuilder.focusKind,
      id: focusBuilder.focusId,
      period: focusBuilder.focusPeriod || '7d',
    };
  }
  return out;
}

/**
 * Serialize { section, filters } → `#section?k=v&...`.
 * Только whitelist'нутые ключи, пустые значения опускаются.
 * @param {string} section
 * @param {object} filters
 * @returns {string}
 */
function serialize(section, filters) {
  const sec = String(section || '').trim();
  const f = filters || {};
  const parts = [];
  for (const stateKey of Object.keys(f)) {
    if (stateKey.startsWith('_')) continue;                 // internal cache
    const urlKey = STATE_TO_URL[stateKey] || stateKey;
    if (!SAFE_FILTER_KEYS.includes(urlKey)) continue;       // whitelist enforcement
    const v = f[stateKey];
    if (v == null) continue;
    if (v === '' || v === false) continue;                  // skip empty / falsy default
    if (Array.isArray(v) && v.length === 0) continue;
    const enc = _encodeValue(v);
    if (!enc) continue;
    parts.push(`${encodeURIComponent(urlKey)}=${enc}`);
  }
  if (!sec) return parts.length ? `#?${parts.join('&')}` : '';
  if (!parts.length) return `#${sec}`;
  return `#${sec}?${parts.join('&')}`;
}

/** Применить hash к state.filters + state.activeSection через Reactive.silent. */
function _applyHashToState(hash) {
  // V22 X-03 — focus теперь optional в parse() return — distructuring
  // даст undefined если поле отсутствует.
  const parsed = parse(hash);
  const { section, filters } = parsed;
  const focus = parsed.focus || null;
  const validSections = _getValidSections();
  _stateUpdating = true;
  try {
    Reactive.silent(() => {
      // 1. Сбрасываем поля whitelist в дефолты (чтобы старый team не остался
      //    при переходе на ссылку без team= параметра).
      const f = state.filters || {};
      for (const k of SAFE_FILTER_KEYS) {
        const stateKey = URL_TO_STATE[k] || k;
        if (!(stateKey in f)) continue;
        const cur = f[stateKey];
        if (typeof cur === 'boolean') f[stateKey] = false;
        else if (Array.isArray(cur)) f[stateKey] = [];
        else f[stateKey] = '';
      }
      // 2. Применяем парсённые значения.
      for (const k of Object.keys(filters)) {
        f[k] = filters[k];
      }
      // 3. «From» tracking.
      f._source = 'url';
      state.filters = f;
      // 4. Section.
      if (section && validSections.has(section)) {
        state.activeSection = section;
      }
    });
  } finally {
    _stateUpdating = false;
  }
  // 5. Trigger re-render через Nav (если App доступен).
  try {
    if (section && validSections.has(section) && _initDeps && _initDeps.App) {
      // Nav.goTo не подходит — он сам мутирует state.activeSection. Вместо
      // этого зовём App.renderSection напрямую (если есть) либо refreshAll.
      if (typeof _initDeps.App.renderSection === 'function') {
        _initDeps.App.renderSection(section);
      } else if (typeof _initDeps.App.refreshAll === 'function') {
        _initDeps.App.refreshAll();
      }
    }
  } catch (e) { /* render-failure не должен блокировать роутер */ }
  // 6. V22 X-03 (audit-experts-2026-05-15 Selvadurai #3) — apply focus
  // если URL содержит focusKind+focusId. Делаем ПОСЛЕ render'а секции,
  // чтобы DOM-узлы уже существовали (Сканнер раньше не находил participant'а
  // для preselect). Через Services.Focus (зарегистрирован focusManager.js).
  if (focus && focus.kind && focus.id) {
    try {
      const focusSvc = Services.Focus || (typeof globalThis !== 'undefined' ? globalThis.Focus : null);
      if (focusSvc && typeof focusSvc.set === 'function') {
        // Defer на следующий tick: если секция только что переключилась
        // (Nav.goTo), её render может ещё не отработать. Reactive flush
        // 200ms уже на подходе — кладём focus поверх.
        setTimeout(() => {
          try {
            focusSvc.set({
              kind: focus.kind,
              id: focus.id,
              period: focus.period || '7d',
              source: 'url',
            });
          } catch (_) {}
        }, 50);
      }
    } catch (_) { /* defensive */ }
  }
  // 7. Notify subscribers.
  for (const fn of Array.from(_subscribers)) {
    try { fn({ section, filters, focus, source: 'url' }); } catch (_) {}
  }
}

/** Записать текущий state в URL hash (debounced). */
function _scheduleWriteToUrl() {
  if (typeof window === 'undefined' || !window.location) return;
  if (_writeTimer) return;
  _writeTimer = setTimeout(() => {
    _writeTimer = null;
    try {
      const next = serialize(state.activeSection || '', state.filters || {});
      const cur = window.location.hash || '';
      if (next === cur) return;
      _routerUpdating = true;
      try {
        // Используем replaceState если доступно (не плодим history-entries).
        if (window.history && typeof window.history.replaceState === 'function') {
          const url = window.location.pathname + window.location.search + next;
          window.history.replaceState(null, '', url);
        } else {
          window.location.hash = next;
        }
      } finally {
        // Микротик — чтобы реальный hashchange (если он сработает) попал в
        // окно, где флаг ещё true.
        setTimeout(() => { _routerUpdating = false; }, 0);
      }
    } catch (e) { /* swallow */ }
  }, DEBOUNCE_MS);
}

function _onHashChange() {
  if (_routerUpdating) return;                 // cycle: это мы сами поменяли hash
  if (typeof window === 'undefined') return;
  const h = window.location.hash || '';
  _applyHashToState(h);
}

export const Router = {
  /**
   * @param {{App?: object}} [deps]
   */
  init(deps) {
    _initDeps = deps || {};
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      _hashchangeBound = _onHashChange;
      window.addEventListener('hashchange', _hashchangeBound);
    }
    // Подписка на reactive flush — пишем URL когда state.filters / activeSection меняется.
    try {
      _reactiveUnsub = Reactive.subscribe(() => {
        if (_stateUpdating) return;            // это мы сами писали в state из hash → не цикл
        _scheduleWriteToUrl();
      });
    } catch (_) { /* в node-тестах reactive может быть mock'нут */ }
    // Применяем текущий hash сразу — кейс открытия ссылки c фильтром.
    if (typeof window !== 'undefined' && window.location && window.location.hash) {
      try { _applyHashToState(window.location.hash); } catch (_) {}
    }
  },

  /**
   * Программная навигация. Если `filters` не передан — берёт текущий state.filters.
   * @param {string} section
   * @param {object} [filters]
   */
  navigate(section, filters) {
    const validSections = _getValidSections();
    _stateUpdating = true;
    try {
      Reactive.silent(() => {
        if (filters) {
          const f = state.filters || {};
          // Сбрасываем whitelist'нутые поля.
          for (const k of SAFE_FILTER_KEYS) {
            const stateKey = URL_TO_STATE[k] || k;
            if (!(stateKey in f)) continue;
            const cur = f[stateKey];
            if (typeof cur === 'boolean') f[stateKey] = false;
            else if (Array.isArray(cur)) f[stateKey] = [];
            else f[stateKey] = '';
          }
          // Применяем переданные.
          for (const k of Object.keys(filters)) f[k] = filters[k];
          f._source = 'manual';
          state.filters = f;
        }
        if (section && validSections.has(section)) {
          state.activeSection = section;
        }
      });
    } finally {
      _stateUpdating = false;
    }
    // Сразу пишем hash (без debounce) — это explicit user-action.
    try {
      if (typeof window !== 'undefined' && window.location) {
        const next = serialize(section || state.activeSection, state.filters || {});
        _routerUpdating = true;
        try {
          if (window.history && typeof window.history.replaceState === 'function') {
            const url = window.location.pathname + window.location.search + next;
            window.history.replaceState(null, '', url);
          } else {
            window.location.hash = next;
          }
        } finally {
          setTimeout(() => { _routerUpdating = false; }, 0);
        }
      }
    } catch (_) {}
    // Render.
    try {
      if (section && validSections.has(section) && _initDeps && _initDeps.App) {
        if (typeof _initDeps.App.renderSection === 'function') {
          _initDeps.App.renderSection(section);
        }
      }
    } catch (_) {}
    for (const fn of Array.from(_subscribers)) {
      try { fn({ section, filters: filters || state.filters, source: 'manual' }); } catch (_) {}
    }
  },

  parse,
  serialize,

  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    _subscribers.add(fn);
    return () => _subscribers.delete(fn);
  },
  unsubscribe(fn) { _subscribers.delete(fn); },

  /** Internal — только для тестов. */
  _applyHashToState,
  _SAFE_FILTER_KEYS: SAFE_FILTER_KEYS,
  _isUpdating: () => _routerUpdating || _stateUpdating,
  _dispose() {
    if (_hashchangeBound && typeof window !== 'undefined') {
      window.removeEventListener('hashchange', _hashchangeBound);
      _hashchangeBound = null;
    }
    if (_reactiveUnsub) { try { _reactiveUnsub(); } catch (_) {} _reactiveUnsub = null; }
    if (_writeTimer) { clearTimeout(_writeTimer); _writeTimer = null; }
    _subscribers.clear();
    _initDeps = null;
    _routerUpdating = false;
    _stateUpdating = false;
  },
};

Services.register('Router', Router);
if (typeof window !== 'undefined') window.Router = Router;
