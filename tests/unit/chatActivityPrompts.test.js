'use strict';
/* ============================================================
   tests/unit/chatActivityPrompts.test.js — V13
   --
   Tests for the prompt registry: system prompts, user templates,
   mode classification, anti-injection trailer.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SYSTEM_PROMPT_ACTIVITY_BASIC,
  SYSTEM_PROMPT_ACTIVITY_DETAILED,
  SYSTEM_PROMPT_ACTIVITY_ANALYTICAL,
  ACTIVITY_MODES,
  pickSystemPromptForMode, classifyActivityMode, buildActivitySystemPrompt,
  USER_TEMPLATES, USER_TEMPLATE_NAMES,
  ACTIVITY_ANTI_INJECT,
} from '../../chat/chatActivityPrompts.js';

describe('System prompts — content invariants', () => {
  test('all three system prompts are non-empty strings', () => {
    for (const p of [SYSTEM_PROMPT_ACTIVITY_BASIC, SYSTEM_PROMPT_ACTIVITY_DETAILED, SYSTEM_PROMPT_ACTIVITY_ANALYTICAL]) {
      assert.equal(typeof p, 'string');
      assert.ok(p.length > 200, 'system prompt should be a few paragraphs');
    }
  });

  test('all mention the four data sources', () => {
    for (const p of [SYSTEM_PROMPT_ACTIVITY_BASIC, SYSTEM_PROMPT_ACTIVITY_DETAILED, SYSTEM_PROMPT_ACTIVITY_ANALYTICAL]) {
      assert.match(p, /Jira/);
      assert.match(p, /Bitbucket/);
      assert.match(p, /Confluence/);
      assert.match(p, /Zephyr/);
    }
  });

  test('analytical prompt rejects opinionated judgements', () => {
    assert.match(SYSTEM_PROMPT_ACTIVITY_ANALYTICAL, /оценочн.{0,5}суждени/);
  });

  test('detailed prompt asks for chronological feed', () => {
    assert.match(SYSTEM_PROMPT_ACTIVITY_DETAILED, /хронолог|HH:MM/i);
  });
});

describe('classifyActivityMode', () => {
  test('"подробно" / "детально" / "хронология" → DETAILED', () => {
    assert.equal(classifyActivityMode('покажи подробно что было'), ACTIVITY_MODES.DETAILED);
    assert.equal(classifyActivityMode('детальный отчёт'),         ACTIVITY_MODES.DETAILED);
    assert.equal(classifyActivityMode('хронология за день'),     ACTIVITY_MODES.DETAILED);
    assert.equal(classifyActivityMode('покажи всю активность'),   ACTIVITY_MODES.DETAILED);
  });

  test('"сравни" / "топ" / "рейтинг" → ANALYTICAL', () => {
    assert.equal(classifyActivityMode('сравни Ивана и Анну'),  ACTIVITY_MODES.ANALYTICAL);
    assert.equal(classifyActivityMode('топ-5 за неделю'),       ACTIVITY_MODES.ANALYTICAL);
    assert.equal(classifyActivityMode('рейтинг сотрудников'),    ACTIVITY_MODES.ANALYTICAL);
    assert.equal(classifyActivityMode('кто больше коммитил'),    ACTIVITY_MODES.ANALYTICAL);
  });

  test('default fallback → BASIC', () => {
    assert.equal(classifyActivityMode('что делает Иван'),    ACTIVITY_MODES.BASIC);
    assert.equal(classifyActivityMode('активность за вчера'), ACTIVITY_MODES.BASIC);
    assert.equal(classifyActivityMode(''),                    ACTIVITY_MODES.BASIC);
  });
});

describe('pickSystemPromptForMode', () => {
  test('correct prompt per mode', () => {
    assert.equal(pickSystemPromptForMode(ACTIVITY_MODES.BASIC),       SYSTEM_PROMPT_ACTIVITY_BASIC);
    assert.equal(pickSystemPromptForMode(ACTIVITY_MODES.DETAILED),    SYSTEM_PROMPT_ACTIVITY_DETAILED);
    assert.equal(pickSystemPromptForMode(ACTIVITY_MODES.ANALYTICAL),  SYSTEM_PROMPT_ACTIVITY_ANALYTICAL);
  });

  test('unknown mode falls through to basic', () => {
    assert.equal(pickSystemPromptForMode('unknown'), SYSTEM_PROMPT_ACTIVITY_BASIC);
  });
});

describe('buildActivitySystemPrompt — anti-inject trailer', () => {
  test('appends ACTIVITY_ANTI_INJECT to the chosen system prompt', () => {
    const final = buildActivitySystemPrompt(ACTIVITY_MODES.BASIC);
    assert.ok(final.endsWith(ACTIVITY_ANTI_INJECT));
    assert.ok(final.startsWith(SYSTEM_PROMPT_ACTIVITY_BASIC.slice(0, 50)));
  });

  test('anti-inject mentions "значения, а не инструкции"', () => {
    assert.match(ACTIVITY_ANTI_INJECT, /значения, а не инструкции/);
  });
});

describe('USER_TEMPLATES — shape and substitution', () => {
  test('all templates are functions', () => {
    for (const name of USER_TEMPLATE_NAMES) {
      assert.equal(typeof USER_TEMPLATES[name], 'function');
    }
  });

  test('whatNow substitutes employee + dataBlock', () => {
    const out = USER_TEMPLATES.whatNow({ employee: 'Иван', dataBlock: 'тест-блок', lastEventAt: '12:34' });
    assert.match(out, /Иван/);
    assert.match(out, /тест-блок/);
    assert.match(out, /12:34/);
  });

  test('whatOnDay includes employee + date + totalEvents', () => {
    const out = USER_TEMPLATES.whatOnDay({ employee: 'Иван', date: 'вчера', dataBlock: 'X', totalEvents: 7 });
    assert.match(out, /Иван/);
    assert.match(out, /вчера/);
    assert.match(out, /7/);
  });

  test('compareEmployees joins multiple names', () => {
    const out = USER_TEMPLATES.compareEmployees({ employees: ['Иван','Анна','Петя'], period: 'за неделю', dataBlock: '' });
    assert.match(out, /Иван, Анна, Петя/);
    assert.match(out, /за неделю/);
  });

  test('byIssue includes issueKey + period', () => {
    const out = USER_TEMPLATES.byIssue({ issueKey: 'PAY-99', period: 'вчера', dataBlock: 'block' });
    assert.match(out, /PAY-99/);
    assert.match(out, /вчера/);
  });

  test('eventFeed mentions source-icons in the prompt', () => {
    const out = USER_TEMPLATES.eventFeed({ employee: 'Иван', date: 'вчера', source: '', dataBlock: '' });
    assert.match(out, /🔷.*Jira|🧪.*Zephyr|🔀.*Bitbucket|📘.*Confluence/);
  });

  test('teamSummary includes employees count', () => {
    const out = USER_TEMPLATES.teamSummary({ employees: ['A','B','C','D'], date: 'вчера', dataBlock: 'data' });
    // Команда: A, B, C, D
    assert.match(out, /A, B, C, D/);
    assert.match(out, /вчера/);
  });
});

describe('USER_TEMPLATE_NAMES — exports', () => {
  test('contains all six expected template names', () => {
    for (const n of ['whatNow','whatOnDay','compareEmployees','byIssue','eventFeed','teamSummary']) {
      assert.ok(USER_TEMPLATE_NAMES.includes(n), `missing template: ${n}`);
    }
  });
});
