'use strict';
/* ============================================================
   tests/unit/teamScanner2Lifecycle.test.js
   --
   V18.1 P7 Sprint 1 — lifecycle tests для TeamScanner2.
   Покрывают unmount() и _closePanel() — escHandler cleanup при
   subtab switch / panel close.

   Без этих тестов был реальный bug: handler копился на document
   при каждом переключении subtab'а из открытой panel'и → 5 переключений = 5
   листенеров → Esc в чужом subtab'е дёргал _closePanel в скрытом scanner2.
   ============================================================ */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// JSDOM-style минимальный shim: server-test-env. Реальный DOM не нужен —
// нам важен только document.addEventListener / removeEventListener tracking.
let docListenerCount = 0;
const docListeners = new Set();
globalThis.document = {
  addEventListener(type, fn) {
    docListeners.add(fn);
    docListenerCount++;
  },
  removeEventListener(type, fn) {
    if (docListeners.has(fn)) {
      docListeners.delete(fn);
      docListenerCount--;
    }
  },
};

// Также shim window/state — TeamScanner2 import дёргает несколько модулей
// которые трогают browser globals.
globalThis.window  = globalThis.window  || {};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };

// Импорт ПОСЛЕ shim'а.
const { TeamScanner2 } = await import('../../integrations/teamScanner2.js');

describe('TeamScanner2 lifecycle — V18.1 P7 S1.1', () => {
  beforeEach(() => {
    // Reset state
    TeamScanner2._expandedKey = '';
    TeamScanner2._escHandler = null;
    TeamScanner2._model = null;
    TeamScanner2._container = null;
    docListeners.clear();
    docListenerCount = 0;
  });

  test('unmount() снимает escHandler если он висит', () => {
    // Эмулируем «panel открыта»: вешаем фейковый escHandler.
    TeamScanner2._escHandler = () => {};
    document.addEventListener('keydown', TeamScanner2._escHandler);
    assert.equal(docListenerCount, 1, 'precondition: 1 listener attached');

    TeamScanner2.unmount();

    assert.equal(TeamScanner2._escHandler, null, 'escHandler cleared');
    assert.equal(docListenerCount, 0, 'listener removed from document');
    assert.equal(TeamScanner2._expandedKey, '', 'panel closed');
  });

  test('unmount() безопасен когда escHandler=null', () => {
    assert.doesNotThrow(() => TeamScanner2.unmount());
    assert.equal(docListenerCount, 0);
  });

  test('повторные unmount() не падают', () => {
    TeamScanner2._escHandler = () => {};
    document.addEventListener('keydown', TeamScanner2._escHandler);
    TeamScanner2.unmount();
    assert.doesNotThrow(() => TeamScanner2.unmount());
    assert.equal(docListenerCount, 0);
  });

  test('сценарий subtab switch: 5 переключений не оставляют orphan handlers', () => {
    // Эмулируем 5 циклов: open panel (handler attached) → unmount (cleared)
    for (let i = 0; i < 5; i++) {
      TeamScanner2._escHandler = () => {};
      document.addEventListener('keydown', TeamScanner2._escHandler);
      TeamScanner2.unmount();
    }
    assert.equal(docListenerCount, 0, 'no orphan listeners after 5 cycles');
  });

  test('_expandedKey сбрасывается при unmount даже если был установлен', () => {
    TeamScanner2._expandedKey = 'some-employee-key';
    TeamScanner2.unmount();
    assert.equal(TeamScanner2._expandedKey, '');
  });
});
