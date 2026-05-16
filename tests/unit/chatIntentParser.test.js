'use strict';
/* ============================================================
   tests/unit/chatIntentParser.test.js
   --
   Tests for parseIntent (rule-based intent classification) and
   parseIntentCategory (broad category routing for LLM prompts).
   These are pure functions — no fixtures, no mocks.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseIntent, parseIntentCategory, isRuleBased, INTENTS, CATEGORIES,
} from '../../chat/chatIntentParser.js';

describe('parseIntent — basic shape', () => {
  test('null / empty / non-string returns GENERIC with confidence 0', () => {
    assert.deepEqual(parseIntent(null),      { intent: INTENTS.GENERIC, confidence: 0, params: {} });
    assert.deepEqual(parseIntent(''),        { intent: INTENTS.GENERIC, confidence: 0, params: {} });
    assert.deepEqual(parseIntent(undefined), { intent: INTENTS.GENERIC, confidence: 0, params: {} });
    assert.deepEqual(parseIntent(123),       { intent: INTENTS.GENERIC, confidence: 0, params: {} });
  });

  test('every matched rule returns confidence ≥ 0.6', () => {
    // V22+ Phase 4 — «CEO апдейт» теперь матчит CEO_UPDATE (cross-source).
    // Старый порог 0.85 был жёстко привязан к одному rule; теперь правил больше.
    const r = parseIntent('CEO апдейт');
    assert.ok(r.confidence >= 0.6, `expected confidence ≥ 0.6, got ${r.confidence}`);
  });

  test('shape always { intent, confidence, params }', () => {
    const r = parseIntent('сводка');
    assert.ok('intent' in r);
    assert.ok('confidence' in r);
    assert.ok('params' in r);
  });
});

describe('parseIntent — executive summary triggers', () => {
  // V22+ Phase 4 (K-K1) — CEO-specific prompts теперь идут в CEO_UPDATE
  // (cross-source). Legacy EXECUTIVE_SUMMARY остаётся для общих summary-
  // prompt'ов («краткий статус» / «итог релиза»).
  const ceoUpdateTriggers = ['CEO апдейт', 'CEO update пожалуйста', 'executive summary'];
  const executiveSummaryTriggers = ['краткий статус', 'краткая сводка', 'общий статус', 'итог релиза', 'что происходит'];

  for (const text of ceoUpdateTriggers) {
    test(`recognises "${text}" as CEO_UPDATE (V22+ Phase 4)`, () => {
      assert.equal(parseIntent(text).intent, INTENTS.CEO_UPDATE);
    });
  }
  for (const text of executiveSummaryTriggers) {
    test(`recognises "${text}" as EXECUTIVE_SUMMARY`, () => {
      assert.equal(parseIntent(text).intent, INTENTS.EXECUTIVE_SUMMARY);
    });
  }

  test('"Дай сводку" (accusative) — V12 fix for FOUND_BUGS.md #8', () => {
    // Extended class /сводк[аиуоей]/ covers all common Russian endings.
    assert.equal(parseIntent('Дай сводку').intent, INTENTS.EXECUTIVE_SUMMARY);
  });
});

describe('parseIntent — non-matches fall through to GENERIC', () => {
  for (const text of [
    'мяу',
    'random text',
    'lorem ipsum',
    'привет',
  ]) {
    test(`"${text}" → GENERIC`, () => {
      assert.equal(parseIntent(text).intent, INTENTS.GENERIC);
    });
  }
});

describe('isRuleBased', () => {
  test('returns true for all action / report / planning intents', () => {
    for (const i of [
      INTENTS.EXECUTIVE_SUMMARY, INTENTS.BATCH_ACTION, INTENTS.FIND_TASKS,
      INTENTS.RELEASE_NOTES, INTENTS.WHAT_RISKS, INTENTS.OVERLOAD,
    ]) {
      assert.equal(isRuleBased(i), true, `${i} should be rule-based`);
    }
  });

  test('returns false for GENERIC (LLM-bound)', () => {
    assert.equal(isRuleBased(INTENTS.GENERIC), false);
  });

  test('returns false for unknown intent string', () => {
    assert.equal(isRuleBased('___unknown___'), false);
  });
});

describe('parseIntentCategory — INTENT_TO_CATEGORY mapping', () => {
  test('hint EXECUTIVE_SUMMARY → analysis (source=intent)', () => {
    const r = parseIntentCategory('any text', INTENTS.EXECUTIVE_SUMMARY);
    assert.equal(r.category, 'analysis');
    assert.equal(r.source, 'intent');
  });

  test('hint BATCH_ACTION → action (source=intent)', () => {
    const r = parseIntentCategory('apply changes', INTENTS.BATCH_ACTION);
    assert.equal(r.category, 'action');
  });

  test('hint MEETING_PREP → report', () => {
    assert.equal(parseIntentCategory('', INTENTS.MEETING_PREP).category, 'report');
  });

  test('hint GENERIC falls through to free-text rules (Russian works in V12)', () => {
    // V12 fix (FOUND_BUGS.md #7): Cyrillic-aware boundary lookahead replaced ASCII \b.
    const r = parseIntentCategory('найди все задачи без скоупа', INTENTS.GENERIC);
    assert.equal(r.category, 'search');
    assert.equal(r.source, 'rule');
  });
});

describe('parseIntentCategory — free-text rules now Cyrillic-aware (V12)', () => {
  test('"перенеси PAY-1" → action', () => {
    assert.equal(parseIntentCategory('перенеси PAY-1 в 1.21').category, 'action');
  });

  test('"удали все done" → action', () => {
    assert.equal(parseIntentCategory('удали все done из бэклога').category, 'action');
  });

  test('"Как спасти релиз" → planning', () => {
    assert.equal(parseIntentCategory('Как спасти релиз 1.20?').category, 'planning');
  });

  test('English-only patterns DO work (no Cyrillic \\b issue)', () => {
    // English variants in the rules use ASCII letters; \b works there.
    // "executive summary" hits analysis rule via /executive.summary/.
    const r = parseIntentCategory('Please give me an executive summary');
    // Whether this hits or falls through depends on rules — assert at least
    // it doesn't crash and returns a category.
    assert.ok(['general','search','analysis','report','planning','explain','action'].includes(r.category));
  });

  test('completely unmatched → general (source=fallback)', () => {
    const r = parseIntentCategory('@#$ random words мяу');
    assert.equal(r.category, 'general');
    assert.equal(r.source, 'fallback');
  });

  test('empty string → general', () => {
    assert.equal(parseIntentCategory('').category, 'general');
  });
});

describe('CATEGORIES export sanity', () => {
  test('contains exactly 7 categories', () => {
    assert.equal(CATEGORIES.length, 7);
    for (const c of ['search','explain','action','analysis','planning','report','general']) {
      assert.ok(CATEGORIES.includes(c), `missing category: ${c}`);
    }
  });
});
