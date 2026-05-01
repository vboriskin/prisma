'use strict';
/* ============================================================
   tests/unit/v17ChatRedesign.test.js
   --
   Regression tests for the V17 P3 chat-assistant redesign (see
   audit-2026-05-V17/03-chat-redesign.md). Pure-data and DOM-string
   tests only — UI behaviour requires e2e harness.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/* ── CHAT-5 ─ inline citation regex pins the format ──────── */
describe('V17 CHAT-5 — inline citations regex (BIK-1234, WT-42 etc.)', () => {
  // Same regex used in chatUIRenderer.applyInline:
  //   /\b([A-Z]{2,6}-\d{1,6})\b/g  → wrap in cite-pill.
  // Tests pin the pattern so future markdown extensions don't accidentally
  // swallow it.
  const CITE_RE = /\b([A-Z]{2,6}-\d{1,6})\b/g;

  test('matches typical Jira keys', () => {
    const samples = ['BIK-1234', 'WT-42', 'PROJ-1', 'AAAAAA-999999'];
    samples.forEach(s => {
      const m = s.match(CITE_RE);
      assert.ok(m && m.length === 1, `must match: ${s}`);
    });
  });

  test('does NOT match too-short keys (single letter)', () => {
    assert.equal('A-1'.match(CITE_RE), null);
  });

  test('does NOT match too-long keys (>6 letters)', () => {
    assert.equal('TOOLONG-1'.match(CITE_RE), null);
  });

  test('does NOT match lowercase', () => {
    assert.equal('bik-1234'.match(CITE_RE), null);
  });

  test('does NOT match digits before hyphen', () => {
    assert.equal('1-2'.match(CITE_RE), null);
  });

  test('extracts multiple cites in one string', () => {
    const out = 'See BIK-1 and WT-99 for details'.match(CITE_RE);
    assert.deepEqual(out, ['BIK-1', 'WT-99']);
  });

  test('handles word boundaries (no false-positive in URLs)', () => {
    // The current regex DOES match inside URLs since it uses \b. This
    // pins current behaviour — if we need to exclude URLs later, the
    // regex (or a wrapper) must change explicitly.
    const out = 'see https://jira.example.com/browse/BIK-1234'.match(CITE_RE);
    assert.deepEqual(out, ['BIK-1234']);
  });
});

/* ── CHAT-1 ─ hotkey policy: skip when input has focus elsewhere ── */
describe('V17 CHAT-1 — global hotkey eligibility', () => {
  // Pure policy test: replicate the guard from llmAssistant.bindUI
  // so that future refactors keep the same eligibility rules.
  function isToggleHotkey(e) {
    const ctrlMeta = e.metaKey || e.ctrlKey;
    if (!ctrlMeta) return false;
    return e.key === '/' || e.key === '.' || e.key === 'j' || e.key === 'J' ||
           e.key === 'о' || e.key === 'О';
  }
  function shouldSkip(e, target) {
    const editable = target && (target.tagName === 'INPUT' ||
                                 target.tagName === 'TEXTAREA' ||
                                 target.isContentEditable);
    if (editable && !target.closest?.('#assistant-panel')) return true;
    return false;
  }

  test('Cmd+/ matches', () => {
    assert.ok(isToggleHotkey({ metaKey: true, key: '/' }));
  });

  test('Ctrl+J matches', () => {
    assert.ok(isToggleHotkey({ ctrlKey: true, key: 'j' }));
    assert.ok(isToggleHotkey({ ctrlKey: true, key: 'J' }));
  });

  test('Cmd+о (Russian layout for J) matches', () => {
    assert.ok(isToggleHotkey({ metaKey: true, key: 'о' }));
    assert.ok(isToggleHotkey({ metaKey: true, key: 'О' }));
  });

  test('plain `/` (no modifier) does NOT match', () => {
    assert.equal(isToggleHotkey({ key: '/' }), false);
  });

  test('skipped when typing in an OTHER input', () => {
    const fakeInput = {
      tagName: 'INPUT',
      isContentEditable: false,
      closest: () => null,         // not inside #assistant-panel
    };
    assert.equal(shouldSkip({}, fakeInput), true);
  });

  test('NOT skipped when typing in the chat input itself', () => {
    const insidePanel = {
      tagName: 'TEXTAREA',
      isContentEditable: false,
      closest: (sel) => (sel === '#assistant-panel' ? {} : null),
    };
    assert.equal(shouldSkip({}, insidePanel), false);
  });
});

/* ── CHAT-9 ─ Up-arrow in empty input recalls last prompt ── */
describe('V17 CHAT-9 — up-arrow recall policy', () => {
  // Replicate the condition that decides whether to swap input.value.
  function shouldRecall(eKey, shiftKey, inputValue) {
    return eKey === 'ArrowUp' && !shiftKey && !inputValue;
  }

  test('triggers when input is empty', () => {
    assert.equal(shouldRecall('ArrowUp', false, ''),    true);
    assert.equal(shouldRecall('ArrowUp', false, null),  true);
    assert.equal(shouldRecall('ArrowUp', false, undefined), true);
  });

  test('skipped when input has any text', () => {
    assert.equal(shouldRecall('ArrowUp', false, 'h'), false);
  });

  test('skipped when shift is held (text-selection)', () => {
    assert.equal(shouldRecall('ArrowUp', true, ''), false);
  });

  test('skipped on other keys', () => {
    assert.equal(shouldRecall('ArrowDown', false, ''), false);
    assert.equal(shouldRecall('Enter',      false, ''), false);
  });
});

/* ── CHAT-4 ─ category-badge label fallback ────────────────── */
describe('V17 CHAT-4 — category badge labels (no emoji)', () => {
  // Mirrors the `CATEGORY_LABELS` map exactly; future renames must update
  // this test (which is the contract for users / locale files).
  const CATEGORY_LABELS = {
    search: 'поиск', explain: 'объяснение', action: 'действие', analysis: 'анализ',
    planning: 'план',  report: 'отчёт',     general: 'общее',
  };

  test('every category has a non-emoji Russian label', () => {
    for (const [, label] of Object.entries(CATEGORY_LABELS)) {
      // ASCII test: no character with code-point ≥ 0x1F000 (most emoji).
      for (const ch of label) {
        assert.ok(ch.codePointAt(0) < 0x1F000, `label «${label}» must contain no emoji glyphs`);
      }
      assert.ok(label.length >= 3, `label «${label}» must be a real word, not a symbol`);
    }
  });

  test('label is lowercase Russian (uppercase is applied via CSS)', () => {
    for (const label of Object.values(CATEGORY_LABELS)) {
      assert.equal(label, label.toLowerCase(), `label «${label}» must be lowercase`);
    }
  });
});
