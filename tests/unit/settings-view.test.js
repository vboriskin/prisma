'use strict';
/* ============================================================
   tests/unit/settings-view.test.js — AUDIT_HOLISTIC F12
   --
   Покрывает SettingsView (`views/settingsView.js`):
     · scaffold секций (8 штук, правильный порядок)
     · render(host) монтирует sidebar + правую панель
     · localStorage persistence (prizma.settings.activeTab)
     · setActiveTab переключает active class и aria-selected
     · renderSection возвращает HTML для каждой секции
     · spine-pill контракт (data-settings-tab + is-active class)
   ============================================================ */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/* ── In-memory localStorage stub ──────────────────────────── */
function _mkStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    _store: store,
  };
}

/* ── Минимальный DOM-stub ─────────────────────────────────── */
function _mkElement(tag = 'div', innerHTMLInit = '') {
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    _innerHTML: innerHTMLInit,
    _attrs: new Map(),
    _classes: new Set(),
    _listeners: new Map(),
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) {
      this._innerHTML = String(v);
      // не парсим — querySelectorAll работает с last-rendered children.
      this.children = _parseChildrenFromHTML(this._innerHTML);
    },
    setAttribute(k, v) { this._attrs.set(k, String(v)); },
    getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; },
    classList: {
      add: function (...c) { c.forEach(x => el._classes.add(x)); },
      remove: function (...c) { c.forEach(x => el._classes.delete(x)); },
      contains: function (c) { return el._classes.has(c); },
      toggle: function (c, force) {
        const has = el._classes.has(c);
        const want = (force === undefined) ? !has : !!force;
        if (want) el._classes.add(c); else el._classes.delete(c);
        return want;
      },
    },
    addEventListener(ev, fn) {
      if (!this._listeners.has(ev)) this._listeners.set(ev, []);
      this._listeners.get(ev).push(fn);
    },
    appendChild(child) { this.children.push(child); return child; },
    querySelectorAll(sel) {
      // Минимальный support: `[data-settings-tab]`, `[data-settings-panel]`,
      // `[data-settings-action]`, `[data-settings-control="..."]`,
      // `.prizma-settings-tab`.
      return _walkSelect(this.children, sel);
    },
    querySelector(sel) {
      const list = this.querySelectorAll(sel);
      return list.length ? list[0] : null;
    },
  };
  return el;
}

/** Парсит innerHTML в плоский массив "псевдо-элементов" — нам важны только
 *  атрибуты data-settings-tab / data-settings-panel / data-settings-action
 *  / data-settings-control и class is-active. */
function _parseChildrenFromHTML(html) {
  const out = [];
  // Не AST-полный парсер: ищем теги с интересующими атрибутами.
  const tagRegex = /<(\w+)([^>]*)>/g;
  let m;
  while ((m = tagRegex.exec(html)) !== null) {
    const tag = m[1];
    const attrs = m[2] || '';
    const el = _mkElement(tag);
    // Собираем атрибуты.
    const attrRe = /([a-zA-Z][\w-]*)(?:="([^"]*)")?/g;
    let am;
    while ((am = attrRe.exec(attrs)) !== null) {
      const name = am[1];
      const val = am[2] !== undefined ? am[2] : '';
      if (name === 'class') {
        val.split(/\s+/).filter(Boolean).forEach(c => el._classes.add(c));
      } else {
        el._attrs.set(name, val);
      }
    }
    out.push(el);
  }
  return out;
}

function _walkSelect(children, sel) {
  // Поддержка `[attr]` / `[attr="val"]` / `.class` / комбинаций.
  const matches = (el) => _selectorMatches(el, sel);
  const result = [];
  for (const c of children) {
    if (matches(c)) result.push(c);
    if (c.children && c.children.length) {
      const nested = _walkSelect(c.children, sel);
      result.push(...nested);
    }
  }
  return result;
}

function _selectorMatches(el, sel) {
  sel = sel.trim();
  // [name="value"]
  let m = sel.match(/^\[([\w-]+)="([^"]*)"\]$/);
  if (m) {
    return el._attrs.has(m[1]) && el._attrs.get(m[1]) === m[2];
  }
  // [name]
  m = sel.match(/^\[([\w-]+)\]$/);
  if (m) {
    return el._attrs.has(m[1]);
  }
  // .class
  m = sel.match(/^\.([\w-]+)$/);
  if (m) {
    return el._classes.has(m[1]);
  }
  return false;
}

/* ── Setup globals + lazy-import SettingsView ─────────────── */
let SettingsViewMod;
let _ls;

async function freshSettingsView() {
  _ls = _mkStorage();
  globalThis.localStorage = _ls;
  globalThis.window = globalThis.window || {};
  globalThis.window.localStorage = _ls;
  // Минимальный document, чтобы import не падал; реальная работа идёт
  // через переданный host, поэтому document используется только для
  // window.SettingsView guard.
  globalThis.document = globalThis.document || {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => _mkElement(),
    body: { appendChild: () => {} },
  };
  if (!SettingsViewMod) {
    SettingsViewMod = await import('../../views/settingsView.js');
  }
  // Reset persisted tab between tests.
  try { _ls.removeItem(SettingsViewMod.SETTINGS_TAB_KEY); } catch (_) {}
  return SettingsViewMod;
}

/* ────────────────────────────────────────────────────────── */

describe('SettingsView — scaffold', () => {
  test('экспортирует ровно 8 секций в правильном порядке', async () => {
    const { SETTINGS_SECTIONS } = await freshSettingsView();
    assert.equal(SETTINGS_SECTIONS.length, 8);
    const keys = SETTINGS_SECTIONS.map(s => s.key);
    assert.deepEqual(keys, [
      'general', 'theme', 'mascot', 'integrations',
      'prompts', 'notifications', 'storage', 'experiments',
    ]);
    // Все секции имеют label + eyebrow (CAPS).
    for (const s of SETTINGS_SECTIONS) {
      assert.ok(s.label, `section ${s.key} missing label`);
      assert.ok(s.eyebrow, `section ${s.key} missing eyebrow`);
      assert.equal(s.eyebrow, s.eyebrow.toUpperCase(),
        `eyebrow для ${s.key} должен быть в CAPS (брендбук §7)`);
    }
  });

  test('default tab = general; getActiveTab падает обратно при битом значении', async () => {
    const mod = await freshSettingsView();
    assert.equal(mod.SETTINGS_DEFAULT_TAB, 'general');
    assert.equal(mod.getActiveTab(), 'general');
    // Сохраняем мусорный ключ — должен фолбэчиться на default.
    _ls.setItem(mod.SETTINGS_TAB_KEY, 'definitely-not-a-section');
    assert.equal(mod.getActiveTab(), 'general');
  });
});

describe('SettingsView.renderSection — pure HTML', () => {
  test('каждая секция рендерится в непустой HTML с корректным data-section-key', async () => {
    const { SETTINGS_SECTIONS, renderSection } = await freshSettingsView();
    for (const s of SETTINGS_SECTIONS) {
      const html = renderSection(s.key);
      assert.ok(typeof html === 'string' && html.length > 0,
        `renderSection('${s.key}') вернул пустоту`);
      assert.match(html, new RegExp(`data-section-key="${s.key}"`),
        `секция ${s.key} не маркирована data-section-key`);
      assert.match(html, /prizma-settings-section-title/,
        `секция ${s.key} без заголовка`);
    }
  });

  test('integrations + prompts секции имеют ссылки-кнопки в legacy modals', async () => {
    const { renderSection } = await freshSettingsView();
    const intHtml = renderSection('integrations');
    assert.match(intHtml, /data-settings-action="open-integrations"/);
    const prHtml = renderSection('prompts');
    assert.match(prHtml, /data-settings-action="open-prompts"/);
  });

  test('storage секция содержит две кнопки миграции', async () => {
    const { renderSection } = await freshSettingsView();
    const html = renderSection('storage');
    assert.match(html, /data-settings-action="migrate-to-sqlite"/);
    assert.match(html, /data-settings-action="migrate-to-local"/);
  });

  test('mascot секция имеет mood-ring toggle', async () => {
    const { renderSection } = await freshSettingsView();
    const html = renderSection('mascot');
    assert.match(html, /data-settings-control="mascot-mood"/);
  });

  test('неизвестный ключ секции — fallback на general (defensive)', async () => {
    const { renderSection } = await freshSettingsView();
    const html = renderSection('does-not-exist');
    assert.match(html, /data-section-key="general"/);
  });
});

describe('SettingsView.renderShell — sidebar + spine-pill', () => {
  test('sidebar рендерит все 8 кнопок с data-settings-tab', async () => {
    const { renderShell, SETTINGS_SECTIONS } = await freshSettingsView();
    const html = renderShell('general');
    for (const s of SETTINGS_SECTIONS) {
      assert.match(html, new RegExp(`data-settings-tab="${s.key}"`),
        `sidebar tab ${s.key} отсутствует`);
    }
  });

  test('active tab получает класс is-active + aria-selected="true"', async () => {
    const { renderShell } = await freshSettingsView();
    const html = renderShell('mascot');
    // У mascot должен быть is-active.
    const re = /<button[^>]*data-settings-tab="mascot"[^>]*>/;
    const match = html.match(re);
    assert.ok(match, 'mascot tab не найден');
    assert.match(match[0], /is-active/);
    assert.match(match[0], /aria-selected="true"/);
    // У других — нет is-active.
    const reGen = /<button[^>]*data-settings-tab="general"[^>]*>/;
    const matchGen = html.match(reGen);
    assert.ok(matchGen);
    assert.doesNotMatch(matchGen[0], /is-active/);
    assert.match(matchGen[0], /aria-selected="false"/);
  });

  test('shell содержит page-header (eyebrow + h1) — соответствие Spine-pill', async () => {
    const { renderShell } = await freshSettingsView();
    const html = renderShell();
    assert.match(html, /prizma-page-header/);
    assert.match(html, /prizma-page-eyebrow/);
    assert.match(html, /prizma-page-h1/);
    assert.match(html, /prizma-page-hairline/);
  });
});

describe('SettingsView.render — host integration', () => {
  test('render(host) монтирует shell + панель и возвращает controller', async () => {
    const { render } = await freshSettingsView();
    const host = _mkElement('section');
    const ctrl = render(host);
    assert.ok(host.innerHTML.length > 0);
    assert.match(host.innerHTML, /prizma-settings-shell/);
    assert.equal(typeof ctrl.setTab, 'function');
    assert.equal(typeof ctrl.getTab, 'function');
    assert.equal(ctrl.getTab(), 'general');
  });

  test('controller.setTab переключает activeTab и пишет в localStorage', async () => {
    const mod = await freshSettingsView();
    const host = _mkElement('section');
    const ctrl = mod.render(host);
    const ok = ctrl.setTab('storage');
    assert.equal(ok, true);
    assert.equal(_ls.getItem(mod.SETTINGS_TAB_KEY), 'storage');
    assert.equal(ctrl.getTab(), 'storage');
  });

  test('setTab отвергает неизвестный ключ', async () => {
    const { render } = await freshSettingsView();
    const host = _mkElement('section');
    const ctrl = render(host);
    const ok = ctrl.setTab('mystery');
    assert.equal(ok, false);
    assert.equal(ctrl.getTab(), 'general');
  });
});

describe('SettingsView — persistence через перезапуск', () => {
  test('сохранённый tab подхватывается при следующем render', async () => {
    const mod = await freshSettingsView();
    _ls.setItem(mod.SETTINGS_TAB_KEY, 'notifications');
    assert.equal(mod.getActiveTab(), 'notifications');
    const host = _mkElement('section');
    mod.render(host);
    // Shell должен включать is-active именно у notifications.
    const html = host.innerHTML;
    const re = /<button[^>]*data-settings-tab="notifications"[^>]*>/;
    const match = html.match(re);
    assert.ok(match, 'notifications tab не найден после render');
    assert.match(match[0], /is-active/);
  });
});
