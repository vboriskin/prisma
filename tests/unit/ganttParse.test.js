'use strict';
// ============================================================
// tests/unit/ganttParse.test.js
// --
// Regression test for V21 audit-art bootstrap-blocker:
// "node --check" passed but ES-module import threw
// "Unexpected template string" because a backtick-quoted token
// inside a block-comment containing the sequence asterisk-slash
// closed the surrounding block comment early, leaving a stray
// template literal in the source.
//
// This test ensures views/gantt.js parses as a real ES module
// (i.e. survives the same parser path the browser uses).
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Stub browser globals before importing modules that touch them.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };

test('views/gantt.js loads cleanly as ES module', async () => {
  const mod = await import('../../views/gantt.js');
  assert.ok(mod, 'module import returned a value');
  assert.ok(mod.GanttView, 'GanttView export present');
  assert.equal(typeof mod.GanttView._auditArtInjectStyles, 'function',
    '_auditArtInjectStyles method present');
});

test('views/ganttHtmlExport.js loads cleanly as ES module', async () => {
  // Same class of bug, different file: a backtick inside a multiline
  // template literal (the inlined _REDRAW_ARROWS_JS payload) closed the
  // outer template early. Guard parses on every CI run.
  const mod = await import('../../views/ganttHtmlExport.js');
  assert.ok(mod, 'module import returned a value');
  assert.ok(mod.GanttHTMLExport, 'GanttHTMLExport export present');
});
