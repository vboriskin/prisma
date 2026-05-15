'use strict';
/* ============================================================
   tests/unit/explain-screen.test.js
   --
   AUDIT_HOLISTIC AI1 — «Объясни этот экран».
   Тесты на app/explainScreen.js + app/explainMeta.js.

   Минимум: meta-register / lookup / LLM-fallback (mock) /
   disable cleanup / hotkey-detect логика (pure).
   ============================================================ */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

// Stub localStorage / window / document (минимум — чтобы модули загрузились без
// браузерного DOM). ExplainScreen внутри проверяет hasDOM() — без document
// просто ничего не рендерит.
globalThis.localStorage = {
  _m: new Map(),
  getItem(k)        { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v)     { this._m.set(k, String(v)); },
  removeItem(k)     { this._m.delete(k); },
  clear()           { this._m.clear(); },
};

const explainMetaMod   = await import('../../app/explainMeta.js');
const explainScreenMod = await import('../../app/explainScreen.js');

const { EXPLAIN_META, getMeta, registerMeta, listKinds } = explainMetaMod;
const { ExplainScreen, isHotkeyEvent, resolveKind, buildLLMPrompt } = explainScreenMod;

/* ---------- 1. registry: register meta ---------- */
describe('explainMeta — registry', () => {
  test('initial registry has at least 5 baseline entries', () => {
    const kinds = listKinds();
    assert.ok(kinds.length >= 5, `expected >=5 baseline kinds, got ${kinds.length}`);
    // Базовые kinds, заявленные в задаче.
    assert.ok(kinds.includes('dashboard.kpi-grid'));
    assert.ok(kinds.includes('metrics.control-circle'));
    assert.ok(kinds.includes('gantt.team-rail'));
    assert.ok(kinds.includes('scanner.gini'));
    assert.ok(kinds.includes('scanner.bus-factor'));
  });

  test('registerMeta adds new entry and is idempotent', () => {
    const ok = registerMeta({ kind: 'test.custom', what: 'X', how: 'Y', soWhat: 'Z' });
    assert.equal(ok, true);
    assert.equal(EXPLAIN_META['test.custom'].what, 'X');

    // повторный без override — не перезаписывает
    const ok2 = registerMeta({ kind: 'test.custom', what: 'X2', how: 'Y2', soWhat: 'Z2' });
    assert.equal(ok2, false);
    assert.equal(EXPLAIN_META['test.custom'].what, 'X');

    // override=true — перезаписывает
    const ok3 = registerMeta({ kind: 'test.custom', what: 'X3', how: 'Y3', soWhat: 'Z3' }, { override: true });
    assert.equal(ok3, true);
    assert.equal(EXPLAIN_META['test.custom'].what, 'X3');
  });

  test('registerMeta rejects malformed input', () => {
    assert.equal(registerMeta(null), false);
    assert.equal(registerMeta({}), false);
    assert.equal(registerMeta({ what: 'no-kind' }), false);
  });
});

/* ---------- 2. lookup by kind ---------- */
describe('explainMeta — lookup', () => {
  test('getMeta returns full meta for known kind', () => {
    const m = getMeta('scanner.gini');
    assert.ok(m);
    assert.equal(m.kind, 'scanner.gini');
    assert.match(m.what, /Gini/i);
    assert.ok(typeof m.how === 'string' && m.how.length > 0);
    assert.ok(typeof m.soWhat === 'string' && m.soWhat.length > 0);
  });

  test('getMeta returns null for unknown kind / bad input', () => {
    assert.equal(getMeta('not.a.kind'), null);
    assert.equal(getMeta(''), null);
    assert.equal(getMeta(null), null);
    assert.equal(getMeta(undefined), null);
    assert.equal(getMeta(42), null);
  });
});

/* ---------- 3. hotkey detection (pure) ---------- */
describe('isHotkeyEvent — pure detector', () => {
  test('detects "?" Shift+/ via key="?"', () => {
    assert.equal(isHotkeyEvent({ key: '?' }), true);
  });

  test('detects Cmd+/ and Ctrl+/', () => {
    assert.equal(isHotkeyEvent({ key: '/', metaKey: true }), true);
    assert.equal(isHotkeyEvent({ key: '/', ctrlKey: true }), true);
  });

  test('plain "/" without modifier is NOT a trigger', () => {
    assert.equal(isHotkeyEvent({ key: '/' }), false);
  });

  test('ignored when focus is in INPUT / TEXTAREA / contentEditable', () => {
    assert.equal(isHotkeyEvent({ key: '?', target: { tagName: 'INPUT' } }), false);
    assert.equal(isHotkeyEvent({ key: '?', target: { tagName: 'TEXTAREA' } }), false);
    assert.equal(isHotkeyEvent({ key: '?', target: { tagName: 'SELECT' } }), false);
    assert.equal(isHotkeyEvent({ key: '?', target: { isContentEditable: true } }), false);
  });

  test('rejects null / non-trigger keys', () => {
    assert.equal(isHotkeyEvent(null), false);
    assert.equal(isHotkeyEvent({ key: 'a' }), false);
    assert.equal(isHotkeyEvent({ key: 'Enter' }), false);
  });
});

/* ---------- 4. LLM fallback (mock) ---------- */
describe('ExplainScreen.explain — LLM fallback', () => {
  test('falls back to LLM when meta absent; uses injected callLLM', async () => {
    // Mini fake element supporting closest/getAttribute/getBoundingClientRect.
    let kindAsked = null;
    let labelAsked = null;
    const fakeElement = {
      _attrs: { 'data-explain': 'unknown.kind', 'aria-label': 'Какой-то блок' },
      closest(sel) { return (sel === '[data-explain]') ? this : null; },
      getAttribute(k) { return this._attrs[k] ?? null; },
      classList: { add(){}, remove(){} },
      textContent: 'Содержимое блока',
      tagName: 'DIV',
    };

    const fakeLLM = async ({ system, user }) => {
      // capture for assertion
      const m = user.match(/kind=(\S+)/);  if (m) kindAsked  = m[1];
      const l = user.match(/label=(.+)/);  if (l) labelAsked = l[1].split('\n')[0];
      // sanity: проверяем что system-промпт партнёрский
      assert.match(system, /партнёр|спокойн|тёпл/i);
      return 'Это краткое объяснение блока. Считается из source X. Если не нравится — действие Y.';
    };

    ExplainScreen._registerCallLLM(fakeLLM);

    // explain в node-окружении не рендерит DOM (hasDOM() false), но fallback-ветка
    // должна вызвать fakeLLM, потому что у kind="unknown.kind" нет meta.
    await ExplainScreen.explain(fakeElement);

    assert.equal(kindAsked, 'unknown.kind');
    assert.match(labelAsked || '', /Какой-то блок/);

    // sanity check на сам prompt-builder
    const p = buildLLMPrompt({ kind: 'foo.bar', label: 'Foo' });
    assert.match(p.user, /kind=foo\.bar/);
    assert.match(p.user, /label=Foo/);
    assert.match(p.system, /Без эмодзи/i);

    ExplainScreen._registerCallLLM(null);
  });

  test('skips LLM when meta exists (source=meta path)', async () => {
    let llmCalled = false;
    ExplainScreen._registerCallLLM(async () => { llmCalled = true; return 'should-not-happen'; });

    const fakeEl = {
      _attrs: { 'data-explain': 'scanner.gini' },
      closest(sel) { return (sel === '[data-explain]') ? this : null; },
      getAttribute(k) { return this._attrs[k] ?? null; },
      classList: { add(){}, remove(){} },
      textContent: '',
      tagName: 'DIV',
    };
    await ExplainScreen.explain(fakeEl);
    assert.equal(llmCalled, false, 'LLM must not be called when meta is present');

    ExplainScreen._registerCallLLM(null);
  });
});

/* ---------- 5. disable cleanup ---------- */
describe('ExplainScreen — enable / disable lifecycle', () => {
  test('enable -> isEnabled true; disable -> false; toggle flips', () => {
    assert.equal(ExplainScreen.isEnabled(), false);
    ExplainScreen.enable();
    assert.equal(ExplainScreen.isEnabled(), true);
    ExplainScreen.disable();
    assert.equal(ExplainScreen.isEnabled(), false);
    ExplainScreen.toggle();
    assert.equal(ExplainScreen.isEnabled(), true);
    ExplainScreen.toggle();
    assert.equal(ExplainScreen.isEnabled(), false);
  });

  test('disable clears internal handlers and highlight ref', () => {
    ExplainScreen.enable();
    const internals = ExplainScreen._internals.state;
    // В node-окружении hasDOM() === false → handlers не навешиваются вообще,
    // но enabled-флаг должен переключаться. Поэтому проверяем флаг + что
    // disable не падает.
    assert.equal(internals.enabled, true);
    ExplainScreen.disable();
    assert.equal(internals.enabled, false);
    assert.equal(internals._onMove, null);
    assert.equal(internals._onClick, null);
    assert.equal(internals._highlighted, null);
  });
});

/* ---------- 6. resolveKind ---------- */
describe('resolveKind — DOM-traversal pure helper', () => {
  test('returns kind from data-explain attribute', () => {
    const fake = {
      _kind: 'dashboard.kpi-grid',
      closest(sel) { return (sel === '[data-explain]') ? this : null; },
      getAttribute(k) { return k === 'data-explain' ? this._kind : null; },
    };
    assert.equal(resolveKind(fake), 'dashboard.kpi-grid');
  });

  test('returns null when no [data-explain] ancestor', () => {
    const fake = { closest() { return null; } };
    assert.equal(resolveKind(fake), null);
    assert.equal(resolveKind(null), null);
  });
});

/* ---------- 7. enabled-by-default flag (localStorage) ---------- */
describe('ExplainScreen — enabled-by-default flag', () => {
  test('round-trips via localStorage', () => {
    ExplainScreen.setEnabledByDefault(true);
    assert.equal(ExplainScreen.getEnabledByDefault(), true);
    ExplainScreen.setEnabledByDefault(false);
    assert.equal(ExplainScreen.getEnabledByDefault(), false);
  });
});
