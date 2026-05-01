'use strict';
/* ============================================================
   tests/unit/chatTemplates.test.js
   --
   Tests for getQuickPrompts (state-aware template generation) and
   renderQuickPromptsHTML (escape + truncate).

   getQuickPrompts() reads `state.rows` + `state.activeSection`. We
   set those before each test by importing the same `state` object.
   ============================================================ */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Stub localStorage to avoid issues with state import side-effects.
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
};

const { state } = await import('../../state.js');
const { getQuickPrompts, renderQuickPromptsHTML } = await import('../../chat/chatTemplates.js');

beforeEach(() => {
  state.rows = [];
  state.activeSection = 'dashboard';
});

describe('getQuickPrompts — base case', () => {
  test('with empty state returns the two always-on prompts', () => {
    const r = getQuickPrompts();
    assert.ok(r.length >= 2);
    assert.ok(r.some(p => /CEO-update/.test(p.prompt)));
    assert.ok(r.some(p => /риски и блокеры/.test(p.prompt)));
  });

  test('result capped at 8 prompts', () => {
    state.rows = Array.from({ length: 30 }, (_, i) => ({
      team: 'T'+(i%3), assignee: 'X', isDone: i%2===0, isUnassigned: i%4===0,
      hasRelease120: true, hasRelease121: true, hasRelease122: true,
      riskFlags: i%3===0 ? ['BLOCKER'] : [], scopeStatus: 'Да',
    }));
    const r = getQuickPrompts();
    assert.ok(r.length <= 8, `got ${r.length}, expected ≤ 8`);
  });

  test('deduplicates by prompt text', () => {
    state.rows = [{ team: 'A', isDone: true, hasRelease120: true }];
    const r = getQuickPrompts();
    const seen = new Set();
    for (const p of r) {
      assert.ok(!seen.has(p.prompt), `duplicate: ${p.prompt}`);
      seen.add(p.prompt);
    }
  });
});

describe('getQuickPrompts — conditional templates', () => {
  test('release 1.20 prompt only when row has hasRelease120', () => {
    state.rows = [{ hasRelease120: true }];
    const r = getQuickPrompts();
    assert.ok(r.some(p => /1\.20/.test(p.prompt)));
  });

  test('without hasRelease120 — no 1.20 prompt', () => {
    state.rows = [{ hasRelease120: false }];
    const r = getQuickPrompts();
    assert.equal(r.find(p => /1\.20/.test(p.prompt)), undefined);
  });

  test('"перегружен" prompt only when at least one row has assignee', () => {
    state.rows = [{ assignee: 'Иван' }];
    const r = getQuickPrompts();
    assert.ok(r.some(p => /перегружен/.test(p.prompt)));
  });

  test('"повестка для груминга" only when undone+unassigned exists', () => {
    state.rows = [{ isDone: false, isUnassigned: true }];
    const r = getQuickPrompts();
    assert.ok(r.some(p => /груминга/.test(p.prompt)));
  });

  test('">1 team" required for "перечисли все команды" prompt', () => {
    state.rows = [{ team: 'A' }];
    const r1 = getQuickPrompts();
    assert.equal(r1.find(p => /Перечисли все команды/.test(p.prompt)), undefined);
    state.rows = [{ team: 'A' }, { team: 'B' }];
    const r2 = getQuickPrompts();
    assert.ok(r2.some(p => /Перечисли все команды/.test(p.prompt)));
  });
});

describe('getQuickPrompts — section overrides', () => {
  test('on registry section adds registry-specific prompts', () => {
    state.activeSection = 'registry';
    state.rows = [{}];
    const r = getQuickPrompts();
    assert.ok(r.some(p => /реестр/i.test(p.prompt)));
  });

  test('on gantt section adds gantt-specific prompts', () => {
    state.activeSection = 'gantt';
    state.rows = [{}];
    const r = getQuickPrompts();
    assert.ok(r.some(p => /критический путь/.test(p.prompt) || /зависим/i.test(p.prompt)));
  });

  test('on unknown section, only ALWAYS + BY_DATA', () => {
    state.activeSection = '___nonexistent___';
    state.rows = [];
    const r = getQuickPrompts();
    assert.equal(r.length, 2);  // 2 ALWAYS prompts only
  });
});

describe('renderQuickPromptsHTML', () => {
  test('empty list returns empty string', () => {
    assert.equal(renderQuickPromptsHTML([]), '');
    assert.equal(renderQuickPromptsHTML(null), '');
  });

  test('renders <button> with data-prompt / data-context / data-category', () => {
    const html = renderQuickPromptsHTML([
      { prompt: 'Hi', context: 'summary', category: 'overview' },
    ]);
    assert.match(html, /class="assistant-quick-btn"/);
    assert.match(html, /data-prompt="Hi"/);
    assert.match(html, /data-context="summary"/);
    assert.match(html, /data-category="overview"/);
  });

  test('truncates display text > 62 chars with "…"', () => {
    const long = 'A'.repeat(80);
    const html = renderQuickPromptsHTML([{ prompt: long, context: 'x', category: 'y' }]);
    // Original prompt preserved in data-prompt; visible text truncated.
    assert.match(html, new RegExp(`data-prompt="${long}"`));
    assert.match(html, /A{60}…/);
  });

  test('escapes quotes in data-prompt attribute', () => {
    const html = renderQuickPromptsHTML([{ prompt: 'Hi "world"', context: '', category: '' }]);
    assert.match(html, /data-prompt="Hi &quot;world&quot;"/);
  });

  test('escapes < and > in visible button text (data-prompt attr stays raw — see note)', () => {
    // Visible label IS HTML-escaped (`&lt;script&gt;`). The `data-prompt`
    // attribute is NOT — it only escapes quotes. That's not strictly XSS
    // (browsers treat data-* as string values, not script), but `<` in an
    // attribute can break HTML parsing. Documented invariant; renderer
    // should ideally escape full set in attribute too. See REFACTOR_SUGGESTIONS.
    const html = renderQuickPromptsHTML([{ prompt: '<script>', context: '', category: '' }]);
    assert.match(html, /&lt;script&gt;<\/button>/, 'visible text must be escaped');
  });

  test('includes inline style with --i index', () => {
    const html = renderQuickPromptsHTML([
      { prompt: 'a', context: '', category: '' },
      { prompt: 'b', context: '', category: '' },
    ]);
    assert.match(html, /--i:0/);
    assert.match(html, /--i:1/);
  });
});
