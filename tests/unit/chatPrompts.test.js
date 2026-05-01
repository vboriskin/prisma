'use strict';
/* ============================================================
   tests/unit/chatPrompts.test.js
   --
   Tests for getPrompt / getAllPrompts / save+reset overrides.
   Storage is mocked with a tiny in-memory shim so tests don't
   touch real localStorage.
   ============================================================ */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Stub localStorage BEFORE the prompts module loads.
const storage = new Map();
globalThis.localStorage = {
  getItem(k)        { return storage.has(k) ? storage.get(k) : null; },
  setItem(k, v)     { storage.set(k, String(v)); },
  removeItem(k)     { storage.delete(k); },
  clear()           { storage.clear(); },
};

const {
  CATEGORIES, getDefaultPrompt, getAllPrompts, getPrompt,
  savePromptOverrides, resetPromptOverride, PROMPTS_STORAGE_KEY, PROMPTS,
} = await import('../../chat/chatPrompts.js');

beforeEach(() => {
  storage.clear();
  // Force the module to re-read overrides on next access.
  // Reaching the cache requires resetting via the public API.
  resetPromptOverride();
});

describe('CATEGORIES — invariants', () => {
  test('contains the canonical set of categories', () => {
    for (const c of ['search','explain','action','analysis','planning','report','general']) {
      assert.ok(CATEGORIES.includes(c), `missing category: ${c}`);
    }
  });

  test('every category resolvable through getDefaultPrompt', () => {
    for (const c of CATEGORIES) {
      const p = getDefaultPrompt(c);
      assert.ok(p, `getDefaultPrompt(${c}) returned falsy`);
      assert.ok(typeof p.label === 'string' && p.label.length);
      assert.ok(typeof p.system === 'string' && p.system.length);
      assert.ok(typeof p.userTemplate === 'string' && p.userTemplate.length);
    }
  });

  test('getDefaultPrompt(unknown) falls back to general', () => {
    const fallback = getDefaultPrompt('___nonsense___');
    const general  = getDefaultPrompt('general');
    assert.equal(fallback.system, general.system);
  });
});

describe('getAllPrompts — defaults state', () => {
  test('every category present, customised=false initially', () => {
    const all = getAllPrompts();
    for (const c of CATEGORIES) {
      assert.ok(all[c]);
      assert.equal(all[c].customised, false);
    }
  });

  test('returns a plain object (no proxy traps)', () => {
    const all = getAllPrompts();
    assert.equal(typeof all, 'object');
    assert.ok('general' in all);
  });
});

describe('savePromptOverrides + resetPromptOverride', () => {
  test('save + read back: override system text persists', () => {
    savePromptOverrides({ general: { system: 'CUSTOM SYSTEM', userTemplate: getDefaultPrompt('general').userTemplate } });
    const all = getAllPrompts();
    assert.equal(all.general.customised, true);
    assert.equal(all.general.system, 'CUSTOM SYSTEM');
  });

  test('reset(category) reverts ONE category', () => {
    savePromptOverrides({
      general: { system: 'C1', userTemplate: getDefaultPrompt('general').userTemplate },
      search:  { system: 'C2', userTemplate: getDefaultPrompt('search').userTemplate },
    });
    resetPromptOverride('general');
    const all = getAllPrompts();
    assert.equal(all.general.customised, false);
    assert.equal(all.search.customised,  true);
  });

  test('reset() with no arg reverts ALL categories', () => {
    savePromptOverrides({
      general: { system: 'C1', userTemplate: getDefaultPrompt('general').userTemplate },
      search:  { system: 'C2', userTemplate: getDefaultPrompt('search').userTemplate },
    });
    resetPromptOverride();
    const all = getAllPrompts();
    for (const c of CATEGORIES) assert.equal(all[c].customised, false);
  });

  test('saving a value identical to default does NOT mark customised', () => {
    const def = getDefaultPrompt('general');
    savePromptOverrides({ general: { system: def.system, userTemplate: def.userTemplate } });
    const all = getAllPrompts();
    assert.equal(all.general.customised, false);
  });

  test('null patch clears overrides without throwing', () => {
    savePromptOverrides({ general: { system: 'C', userTemplate: getDefaultPrompt('general').userTemplate } });
    savePromptOverrides(null);
    assert.equal(getAllPrompts().general.customised, false);
  });

  test('localStorage key is the documented constant', () => {
    assert.equal(PROMPTS_STORAGE_KEY, 'q2_chat_prompts_v1');
  });
});

describe('getPrompt — template rendering', () => {
  test('returns object with label/system/userTemplate/buildUserPrompt', () => {
    const p = getPrompt('search');
    assert.ok(typeof p.label === 'string');
    assert.ok(typeof p.system === 'string');
    assert.ok(typeof p.userTemplate === 'string');
    assert.equal(typeof p.buildUserPrompt, 'function');
  });

  test('unknown category falls back to general', () => {
    const a = getPrompt('___nope___');
    const b = getPrompt('general');
    assert.equal(a.label, b.label);
  });

  test('buildUserPrompt substitutes {{message}}', () => {
    const p = getPrompt('search');
    const out = p.buildUserPrompt({}, 'найди задачи без скоупа');
    assert.match(out, /найди задачи без скоупа/);
  });

  test('buildUserPrompt substitutes {{context}} with JSON of the ctx', () => {
    const p = getPrompt('analysis');
    const out = p.buildUserPrompt({ summary: { totalRows: 42 } }, 'msg');
    assert.match(out, /"totalRows":42/);
  });

  test('buildUserPrompt substitutes {{filters}} with active-filter description', () => {
    const p = getPrompt('search');
    const out = p.buildUserPrompt({ filters: { search: 'pay', team: 'Pay' } }, 'msg');
    assert.match(out, /search="pay"/);
    assert.match(out, /team="Pay"/);
  });

  test('buildUserPrompt with no active filters renders "— фильтры не активны"', () => {
    const p = getPrompt('search');
    const out = p.buildUserPrompt({ filters: {} }, 'msg');
    assert.match(out, /фильтры не активны/);
  });

  test('huge ctx truncated at 6000 chars marker', () => {
    const big = 'x'.repeat(8000);
    const p = getPrompt('analysis');
    const out = p.buildUserPrompt({ huge: big }, 'msg');
    assert.match(out, /\[truncated\]/);
  });

  test('system prompt rendered through template engine — {{antiInject}} expanded', () => {
    const p = getPrompt('analysis');
    // ANTI_INJECT trailer mentions "данные, а не инструкции".
    assert.match(p.system, /данные, а не инструкции/);
  });
});

describe('PROMPTS proxy (legacy)', () => {
  test('subscript access returns the same shape as getPrompt', () => {
    const a = PROMPTS.search;
    const b = getPrompt('search');
    assert.equal(a.label, b.label);
    assert.equal(typeof a.buildUserPrompt, 'function');
  });

  test('Object.keys exposes all CATEGORIES', () => {
    const keys = Object.keys(PROMPTS);
    for (const c of CATEGORIES) assert.ok(keys.includes(c));
  });

  test('access to unknown key returns undefined', () => {
    assert.equal(PROMPTS.___unknown___, undefined);
  });
});
