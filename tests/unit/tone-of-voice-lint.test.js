'use strict';
/* ============================================================
   tests/unit/tone-of-voice-lint.test.js
   --
   Tests for AU5 (AUDIT_HOLISTIC) — tone-of-voice lint middleware.
   Pure functions: lintLlmOutput, applyDefaultLint.
   ============================================================ */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { lintLlmOutput, applyDefaultLint, getLintMode, _internal } from '../../chat/toneOfVoiceLint.js';

/* ── localStorage shim (node has no DOM) ─────────────────── */

const _ls = (() => {
  const store = new Map();
  return {
    getItem(k)        { return store.has(k) ? store.get(k) : null; },
    setItem(k, v)     { store.set(k, String(v)); },
    removeItem(k)     { store.delete(k); },
    clear()           { store.clear(); },
  };
})();

before(() => {
  if (typeof globalThis.localStorage === 'undefined') globalThis.localStorage = _ls;
});

after(() => {
  try { _ls.clear(); } catch (_) {}
});

/* ── R1 — emoji ──────────────────────────────────────────── */

describe('R1 — emoji detection & strip', () => {
  test('positive: detects emoji + strips when stripEmoji=true', () => {
    const input = 'Курс выдерживается 🚀 и команда на месте 👍.';
    const r = lintLlmOutput(input, { stripEmoji: true });
    assert.equal(r.warnings.filter(w => w.rule === 'R1').length, 2);
    // After strip: no emoji codepoints remain in returned text.
    assert.match(r.text, /Курс выдерживается/);
    assert.doesNotMatch(r.text, /🚀|👍/u);
  });

  test('negative: clean Russian text without emoji — no R1 warnings', () => {
    const r = lintLlmOutput('Команда сверяет курс на пятницу.');
    assert.equal(r.warnings.filter(w => w.rule === 'R1').length, 0);
    assert.equal(r.text, 'Команда сверяет курс на пятницу.');
  });

  test('warn-only mode does not modify text but reports warnings', () => {
    const r = lintLlmOutput('Готово ✅', { stripEmoji: false });
    assert.equal(r.text, 'Готово ✅');
    assert.ok(r.warnings.some(w => w.rule === 'R1'));
  });
});

/* ── R2 — anglicisms ─────────────────────────────────────── */

describe('R2 — English terms', () => {
  test('positive: matches "task / blocker / sprint / release" (case-insensitive)', () => {
    const r = lintLlmOutput('There is a Blocker on the sprint and Release.');
    const r2 = r.warnings.filter(w => w.rule === 'R2');
    const matches = r2.map(w => w.match.toLowerCase());
    assert.ok(matches.includes('blocker'));
    assert.ok(matches.includes('sprint'));
    assert.ok(matches.includes('release'));
  });

  test('negative: russian-only text — no R2 warnings', () => {
    const r = lintLlmOutput('Замечен дрейф в проекте, добавлен ориентир.');
    assert.equal(r.warnings.filter(w => w.rule === 'R2').length, 0);
  });

  test('hint contains russian alternative', () => {
    const r = lintLlmOutput('Need to set scope.');
    const w = r.warnings.find(x => x.rule === 'R2' && /scope/i.test(x.match));
    assert.ok(w);
    assert.match(w.hint, /объ[её]м|границ/i);
  });
});

/* ── R3 — «Курс сверен» overuse ──────────────────────────── */

describe('R3 — kurs-sveren overuse', () => {
  test('positive: 2+ occurrences in one response triggers warning', () => {
    const r = lintLlmOutput('Курс сверен. План готов. Курс сверен повторно.');
    const r3 = r.warnings.filter(w => w.rule === 'R3');
    assert.equal(r3.length, 1);
    assert.match(r3[0].snippet, /2× «Курс сверен»/);
  });

  test('negative: single occurrence is fine', () => {
    const r = lintLlmOutput('Курс сверен — продолжаем работу.');
    assert.equal(r.warnings.filter(w => w.rule === 'R3').length, 0);
  });
});

/* ── R4 — shouty / pressure ──────────────────────────────── */

describe('R4 — shouty exclamations', () => {
  test('positive: detects !!! / ВНИМАНИЕ / СРОЧНО / Действуйте сейчас', () => {
    const r = lintLlmOutput('ВНИМАНИЕ! 3 задачи просрочены!!! Действуйте сейчас.');
    const r4 = r.warnings.filter(w => w.rule === 'R4');
    // expect ≥3: «ВНИМАНИЕ», «!!!», «Действуйте сейчас»
    assert.ok(r4.length >= 3, `expected ≥3 R4 warnings, got ${r4.length}`);
  });

  test('negative: calm tone passes', () => {
    const r = lintLlmOutput('Замечен дрейф. Предлагаю пересмотреть план.');
    assert.equal(r.warnings.filter(w => w.rule === 'R4').length, 0);
  });
});

/* ── R5 — «ты»-форма ────────────────────────────────────── */

describe('R5 — informal "ты" form', () => {
  test('positive: detects «привет / делай / возьми / ты можешь»', () => {
    const r = lintLlmOutput('Привет! Делай задачу. Возьми блокер. Ты можешь это.');
    const r5 = r.warnings.filter(w => w.rule === 'R5');
    const hits = r5.map(w => w.match.toLowerCase());
    assert.ok(hits.some(h => h.includes('привет')));
    assert.ok(hits.some(h => h.includes('делай')));
    assert.ok(hits.some(h => h.includes('возьми')));
    assert.ok(hits.some(h => h.includes('ты ')));
  });

  test('negative: «вы»-form passes', () => {
    const r = lintLlmOutput('Здравствуйте. Сделайте задачу, посмотрите детали.');
    // «посмотрите» — это форма на «вы», не должна сматчиться через одиночный «посмотри».
    // R5 матчит word-boundary, поэтому «посмотрите» НЕ ловится.
    const r5 = r.warnings.filter(w => w.rule === 'R5');
    assert.equal(r5.length, 0, `expected 0 R5 warnings, got: ${JSON.stringify(r5)}`);
  });
});

/* ── opts.disable + applyDefaultLint mode ────────────────── */

describe('opts.disable per-rule', () => {
  test('disabling R2 silences anglicisms but keeps R1', () => {
    const r = lintLlmOutput('blocker 🚀', { disable: { R2: true } });
    assert.equal(r.warnings.filter(w => w.rule === 'R2').length, 0);
    assert.ok(r.warnings.some(w => w.rule === 'R1'));
  });
});

describe('applyDefaultLint mode resolution', () => {
  test('mode "off" → passthrough, no warnings', () => {
    globalThis.localStorage.setItem(_internal.MODE_KEY, _internal.MODE_OFF);
    const r = applyDefaultLint('Привет 🚀 blocker!!!');
    assert.equal(r.mode, 'off');
    assert.equal(r.text, 'Привет 🚀 blocker!!!');
    assert.equal(r.warnings.length, 0);
  });

  test('mode "warn-only" (default) → text unchanged, warnings present', () => {
    globalThis.localStorage.setItem(_internal.MODE_KEY, _internal.MODE_WARN);
    const r = applyDefaultLint('Привет 🚀');
    assert.equal(r.mode, 'warn-only');
    assert.equal(r.text, 'Привет 🚀');
    assert.ok(r.warnings.length > 0);
  });

  test('mode "on" → emoji stripped, other warnings reported', () => {
    globalThis.localStorage.setItem(_internal.MODE_KEY, _internal.MODE_ON);
    const r = applyDefaultLint('Готово 🚀, blocker найден.');
    assert.equal(r.mode, 'on');
    assert.doesNotMatch(r.text, /🚀/u);
    // R2 warning о «blocker» сохраняется
    assert.ok(r.warnings.some(w => w.rule === 'R2'));
  });

  test('mode default (no localStorage value) → warn-only', () => {
    globalThis.localStorage.removeItem(_internal.MODE_KEY);
    assert.equal(getLintMode(), 'warn-only');
  });
});

/* ── safety / edge ───────────────────────────────────────── */

describe('safety & edge cases', () => {
  test('null / undefined / non-string input does not throw', () => {
    assert.doesNotThrow(() => lintLlmOutput(null));
    assert.doesNotThrow(() => lintLlmOutput(undefined));
    assert.doesNotThrow(() => lintLlmOutput(42));
    const r = lintLlmOutput(null);
    assert.equal(r.text, '');
    assert.deepEqual(r.warnings, []);
  });

  test('empty string returns empty warnings', () => {
    const r = lintLlmOutput('');
    assert.equal(r.text, '');
    assert.equal(r.warnings.length, 0);
  });
});
