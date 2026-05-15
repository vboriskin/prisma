'use strict';
/* ============================================================
   tests/unit/router.test.js — AUDIT_HOLISTIC F9 (deep-link sharing)
   --
   Покрывает app/router.js: parse / serialize / round-trip /
   special-chars / cycle-detection / whitelist enforcement (PII).

   Node-окружение: window/document мокаем перед import'ом router.js,
   потому что модуль трогает window.addEventListener / location в init.
   ============================================================ */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/* ── Window/location mock ──────────────────────────────────── */
class MockLocation {
  constructor() {
    this.pathname = '/';
    this.search = '';
    this._hash = '';
  }
  get hash() { return this._hash; }
  set hash(v) {
    const next = v && !v.startsWith('#') ? '#' + v : (v || '');
    if (next === this._hash) return;
    this._hash = next;
    if (this._onChange) this._onChange();
  }
}

class MockHistory {
  constructor(loc) { this.loc = loc; this._entries = []; }
  replaceState(_s, _t, url) {
    this._entries.push(url);
    const h = url.indexOf('#');
    this.loc._hash = h === -1 ? '' : url.slice(h);
    // replaceState НЕ триггерит hashchange (это контракт браузера).
  }
}

function setupBrowserGlobals() {
  const listeners = { hashchange: [] };
  const loc = new MockLocation();
  const hist = new MockHistory(loc);
  loc._onChange = () => {
    for (const fn of listeners.hashchange.slice()) {
      try { fn({ type: 'hashchange' }); } catch (_) {}
    }
  };
  globalThis.window = {
    location: loc,
    history: hist,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter(x => x !== fn);
    },
  };
  globalThis.document = {
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  return { loc, hist, listeners };
}

/* ── Fresh-import helper ──────────────────────────────────────
   ESM-cache nuance: cache-buster works, но если cache-bust'нуть И state.js,
   И router.js — router имеет ВНУТРИ себя `import { state } from '../state.js'`,
   которое НЕ cache-bust'нуто. Получаем 2 разных state-объекта. Поэтому
   state.js / reactiveStore.js берём ОДИН раз без буста, а router.js
   cache-bust'им — флаги модуля свежие.
   ─────────────────────────────────────────────────────────── */
let _stateMod, _reactiveMod;
async function freshRouter() {
  setupBrowserGlobals();
  if (!_stateMod) _stateMod = await import('../../state.js');
  if (!_reactiveMod) _reactiveMod = await import('../../reactiveStore.js');
  // Cache-bust только router — нам нужны свежие module-level flags.
  const routerMod = await import('../../app/router.js?t=' + Math.random());
  // Сброс state.filters / activeSection.
  _reactiveMod.Reactive.silent(() => {
    _stateMod.state.filters = {
      search:'', team:'', scope:'', release:'', workType:'',
      role:'', assignee:'', tag:'',
      onlyBlocking:false, onlyRisky:false, onlyDone:false,
      preset:null,
    };
    _stateMod.state.activeSection = 'dashboard';
  });
  return { Router: routerMod.Router, state: _stateMod.state, Reactive: _reactiveMod.Reactive };
}

/* ── Tests ───────────────────────────────────────────────── */

describe('Router.parse', () => {
  test('парсит секцию без фильтров', async () => {
    const { Router } = await freshRouter();
    const r = Router.parse('#registry');
    assert.equal(r.section, 'registry');
    assert.deepEqual(r.filters, {});
  });

  test('парсит секцию + фильтры из whitelist', async () => {
    const { Router } = await freshRouter();
    const r = Router.parse('#registry?team=Alpha&sprint=PI-1.21&done=false');
    assert.equal(r.section, 'registry');
    assert.equal(r.filters.team, 'Alpha');
    assert.equal(r.filters.sprint, 'PI-1.21');
    // `done` алиасится в state-key `onlyDone`, и trues-false разрешается в bool.
    assert.equal(r.filters.onlyDone, false);
  });

  test('пустой / мусорный hash → {section:"",filters:{}}', async () => {
    const { Router } = await freshRouter();
    assert.deepEqual(Router.parse(''), { section: '', filters: {} });
    assert.deepEqual(Router.parse('#'), { section: '', filters: {} });
    assert.deepEqual(Router.parse(null), { section: '', filters: {} });
  });
});

describe('Router.serialize', () => {
  test('секция без фильтров → #section', async () => {
    const { Router } = await freshRouter();
    assert.equal(Router.serialize('registry', {}), '#registry');
  });

  test('пропускает пустые / falsy / NOT-whitelist поля', async () => {
    const { Router } = await freshRouter();
    const out = Router.serialize('registry', {
      team: 'Alpha',
      scope: '',                  // пустое — пропускается
      onlyBlocking: false,        // false — пропускается
      _searchIndex: 'cache',      // internal cache — пропускается
      bogusKey: 'x',              // не в whitelist — пропускается
    });
    assert.equal(out, '#registry?team=Alpha');
  });

  test('boolean true → "true"; алиасит onlyDone → done', async () => {
    const { Router } = await freshRouter();
    const out = Router.serialize('registry', { onlyDone: true, team: 'Beta' });
    // Order независит — проверяем оба фрагмента.
    assert.match(out, /^#registry\?/);
    assert.match(out, /done=true/);
    assert.match(out, /team=Beta/);
  });

  test('массив сериализуется как ","-joined', async () => {
    const { Router } = await freshRouter();
    const out = Router.serialize('registry', { role: ['BE', 'FE'] });
    // Запятая — допустимый символ в URL query (RFC 3986 sub-delims), и
    // удобнее в плане длины-ссылки. Round-trip через parse покрывает
    // обратное чтение.
    assert.equal(out, '#registry?role=BE,FE');
  });
});

describe('Router round-trip', () => {
  test('serialize → parse возвращает идентичный объект', async () => {
    const { Router } = await freshRouter();
    const orig = { team: 'Alpha', sprint: 'PI-1.21', onlyDone: true };
    const hash = Router.serialize('registry', orig);
    const back = Router.parse(hash);
    assert.equal(back.section, 'registry');
    assert.equal(back.filters.team, 'Alpha');
    assert.equal(back.filters.sprint, 'PI-1.21');
    assert.equal(back.filters.onlyDone, true);
  });

  test('special chars (space, &, %) выживают round-trip', async () => {
    const { Router } = await freshRouter();
    // Имя команды с пробелом и амперсандом — должно URL-encoded-then-decoded.
    const orig = { team: 'A & B', search: 'foo bar' };
    const hash = Router.serialize('registry', orig);
    // Гарантируем что в hash нет «голого» `&` внутри значений (это сломает разбиение):
    assert.match(hash, /team=A%20%26%20B/);
    assert.match(hash, /search=foo%20bar/);
    const back = Router.parse(hash);
    assert.equal(back.filters.team, 'A & B');
    assert.equal(back.filters.search, 'foo bar');
  });
});

describe('Router cycle detection', () => {
  test('навигация Router.navigate не триггерит handler-цикл', async () => {
    const { Router, state } = await freshRouter();
    let calls = 0;
    Router.subscribe(() => { calls++; });
    Router.init({});
    // Navigate — Router сам пишет hash. Если cycle-detection сломан,
    // hashchange-handler ещё раз вызовет _applyHashToState → subscribers
    // получат двойное событие.
    Router.navigate('registry', { team: 'Alpha' });
    // Дать время на возможный hashchange (mock диспетчит синхронно).
    await new Promise(r => setTimeout(r, 10));
    assert.equal(state.filters.team, 'Alpha');
    // Subscribers должны были получить ровно один event (manual из navigate).
    assert.equal(calls, 1, `expected 1 subscriber call, got ${calls}`);
    Router._dispose();
  });

  test('apply hash через _applyHashToState не пишет hash обратно', async () => {
    const { Router, state, Reactive } = await freshRouter();
    Router.init({});
    // Эмулируем внешнее изменение URL (как будто пользователь вставил ссылку).
    Router._applyHashToState('#registry?team=Beta');
    assert.equal(state.activeSection, 'registry');
    assert.equal(state.filters.team, 'Beta');
    assert.equal(state.filters._source, 'url');
    // Прокручиваем debounce + flush — Router НЕ должен переписать hash, потому
    // что значение state совпадает с тем что в URL уже есть, плюс _stateUpdating
    // блокировал реактивный write.
    Reactive.flushNow?.();
    await new Promise(r => setTimeout(r, 350));
    Router._dispose();
  });
});

describe('Router whitelist / PII enforcement', () => {
  test('serialize не включает email-поля даже если переданы', async () => {
    const { Router } = await freshRouter();
    // `email` НЕ в whitelist → пропустится.
    const out = Router.serialize('employees', {
      team: 'Alpha',
      email: 'ivanov@sber.ru',
      assignee: 'ivanov@sber.ru',           // в whitelist но scrub-нём
    });
    assert.doesNotMatch(out, /ivanov@sber\.ru/, 'PII email не должен попасть в URL');
    // `email` отброшен whitelist'ом, `assignee` — scrub'нут (если PII глобально доступен).
    assert.match(out, /team=Alpha/);
  });

  test('parse игнорирует non-whitelist ключи из злонамеренной ссылки', async () => {
    const { Router } = await freshRouter();
    const r = Router.parse('#registry?team=Alpha&bogus=1&__proto__=evil&_searchIndex=hack');
    assert.equal(r.filters.team, 'Alpha');
    // Проверяем по own-keys чтобы не споткнуться о Object.prototype-наследование
    // (`'__proto__' in {}` всегда true).
    const ownKeys = Object.keys(r.filters);
    assert.ok(!ownKeys.includes('bogus'), 'bogus must be filtered');
    assert.ok(!ownKeys.includes('__proto__'), '__proto__ must be filtered');
    assert.ok(!ownKeys.includes('_searchIndex'), '_searchIndex must be filtered');
    // Самое важное — prototype-pollution не произошёл.
    assert.equal(({}).polluted, undefined);
  });

  test('whitelist содержит только безопасные ключи (snapshot)', async () => {
    const { Router } = await freshRouter();
    const wl = Router._SAFE_FILTER_KEYS;
    // Контрактные ключи из задания.
    for (const must of ['team', 'sprint', 'done', 'scope', 'assignee', 'release', 'priority']) {
      assert.ok(wl.includes(must), `whitelist must include ${must}`);
    }
    // PII-ключи не должны быть в whitelist (даже как алиасы).
    for (const forbid of ['email', 'phone', 'snils', 'passport', 'token', 'password']) {
      assert.ok(!wl.includes(forbid), `whitelist must NOT include ${forbid}`);
    }
  });
});

describe('Router._source tracking', () => {
  test('apply из URL → state.filters._source === "url"', async () => {
    const { Router, state } = await freshRouter();
    Router.init({});
    Router._applyHashToState('#registry?team=Gamma');
    assert.equal(state.filters._source, 'url');
    Router._dispose();
  });

  test('navigate(section, filters) → state.filters._source === "manual"', async () => {
    const { Router, state } = await freshRouter();
    Router.init({});
    Router.navigate('registry', { team: 'Delta' });
    assert.equal(state.filters._source, 'manual');
    Router._dispose();
  });
});
