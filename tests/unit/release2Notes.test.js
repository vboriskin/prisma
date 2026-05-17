'use strict';
/* ============================================================
   tests/unit/release2Notes.test.js — V22+ (Release notes feature, 2026-05-17)

   Pure builder tests — без DOM, без LLM-сети.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRuleBasedMarkdown,
  buildLLMPrompt,
  stripHtmlTags,
  scrubSecrets,
  getRelatedKeysForFetch,
} from '../../integrations/release2/release2Notes.js';

function _mkRelease(overrides = {}) {
  return {
    key: 'REL-42',
    summary: 'Q2 release · Online onboarding',
    status: 'In Progress',
    type: 'Major',
    issuetype: 'Release 2.0',
    project: { key: 'SBOFPL', name: 'Платформа' },
    organizer: { displayName: 'Иванов И.И.' },
    approver:  { displayName: 'Петров П.П.' },
    riskLevel: 'Средний',
    configElement: [
      { value: 'KE-AUTH' },
      { value: 'KE-PAYMENTS' },
    ],
    dates: {
      planProdEnd: '2026-06-15',
      factProdDate: null,
      planUATStart: '2026-06-01',
      planUATEnd: '2026-06-10',
    },
    _links: {
      partOf: [
        { key: 'BIK-101', summary: 'Добавить шаг подтверждения по СМС', status: 'Done',        priority: 'Major',    labels: ['KE-AUTH'] },
        { key: 'BIK-102', summary: 'Поддержка multi-factor authentication', status: 'In Progress', priority: 'Blocker',  labels: ['KE-AUTH'] },
        { key: 'BIK-103', summary: 'Optimisation платёжной шины',          status: 'In Review',  priority: 'Major',    labels: ['KE-PAYMENTS'] },
      ],
      bugs: [
        { key: 'BIK-201', summary: 'Падение при коротком login', status: 'Done',     priority: 'Critical', labels: ['KE-AUTH'] },
        { key: 'BIK-202', summary: 'Чек 0₽ повисает',           status: 'Open',     priority: 'Major',    labels: ['KE-PAYMENTS'] },
      ],
    },
    _subtasks: [
      { key: 'BIK-301', summary: 'ПСИ по auth', status: 'Done',         assignee: { displayName: 'QA1' } },
      { key: 'BIK-302', summary: 'ПСИ по pay',  status: 'In Progress',  assignee: { displayName: 'QA2' } },
    ],
    ppsiApprovedAt: '2026-06-12',
    ...overrides,
  };
}

describe('release2Notes — pure builder', () => {

  describe('buildRuleBasedMarkdown', () => {

    test('возвращает заголовок с release.key + summary', () => {
      const md = buildRuleBasedMarkdown(_mkRelease());
      assert.match(md, /^# Release notes · REL-42/m);
      assert.match(md, /Q2 release · Online onboarding/);
    });

    test('полная версия содержит все 8 разделов', () => {
      const md = buildRuleBasedMarkdown(_mkRelease(), [], { mode: 'full' });
      assert.match(md, /## TL;DR/);
      assert.match(md, /## Что нового — Stories/);
      assert.match(md, /## Исправления — Bugs/);
      assert.match(md, /## Тестирование/);
      assert.match(md, /## Технические артефакты/);
      assert.match(md, /## Даты этапов/);
      assert.match(md, /## Метрики релиза/);
    });

    test('краткая версия содержит только TL;DR + Stories + Bugs', () => {
      const md = buildRuleBasedMarkdown(_mkRelease(), [], { mode: 'short' });
      assert.match(md, /## TL;DR/);
      assert.match(md, /## Что нового/);
      assert.match(md, /## Исправления/);
      assert.doesNotMatch(md, /## Тестирование/);
      assert.doesNotMatch(md, /## Даты этапов/);
      assert.doesNotMatch(md, /## Метрики релиза/);
    });

    test('краткая версия НЕ содержит Jira-ключей в списках', () => {
      const md = buildRuleBasedMarkdown(_mkRelease(), [], { mode: 'short' });
      assert.doesNotMatch(md, /\*\*BIK-101\*\*/);
      // Но summary должен быть.
      assert.match(md, /Добавить шаг подтверждения по СМС/);
    });

    test('полная версия содержит Jira-ключи как audit-trail', () => {
      const md = buildRuleBasedMarkdown(_mkRelease(), [], { mode: 'full' });
      assert.match(md, /\*\*BIK-101\*\*/);
      assert.match(md, /\*\*BIK-201\*\*/);
    });

    test('группировка stories по КЭ', () => {
      const md = buildRuleBasedMarkdown(_mkRelease(), [], { mode: 'full' });
      assert.match(md, /### KE-AUTH \(2\)/);
      assert.match(md, /### KE-PAYMENTS \(1\)/);
    });

    test('сортировка внутри КЭ по приоритету DESC', () => {
      const md = buildRuleBasedMarkdown(_mkRelease(), [], { mode: 'full' });
      // Blocker BIK-102 должен идти ПЕРЕД Major BIK-101 в группе KE-AUTH.
      const block102 = md.indexOf('BIK-102');
      const block101 = md.indexOf('BIK-101');
      assert.ok(block102 < block101, `BIK-102 (Blocker) должен быть перед BIK-101 (Major), но позиции: ${block102} / ${block101}`);
    });

    test('empty release → human-friendly stub', () => {
      const empty = { key: 'REL-99', summary: 'Empty', _links: {} };
      const md = buildRuleBasedMarkdown(empty);
      assert.match(md, /Нет историй в составе релиза/);
      assert.match(md, /Нет багов в составе релиза/);
    });

    test('заблокированные [Х]/[X] исключаются из assignee', () => {
      const r = _mkRelease({
        organizer: { displayName: 'Уволенный [Х]' },
      });
      const md = buildRuleBasedMarkdown(r);
      assert.match(md, /Организатор\s*\|\s*—/);
      assert.doesNotMatch(md, /Уволенный/);
    });

    test('включает description если related items переданы', () => {
      const related = [
        {
          key: 'BIK-101',
          fields: {
            description: 'Раньше пользователь вводил телефон и логин одним полем. Теперь СМС-код приходит на телефон.',
          },
          renderedFields: {},
        },
      ];
      const md = buildRuleBasedMarkdown(_mkRelease(), related, { mode: 'full' });
      assert.match(md, /СМС-код приходит на телефон/);
    });

    test('renderedFields.description (HTML) → strip tags', () => {
      const related = [
        {
          key: 'BIK-101',
          fields: { description: '<p>HTML описание</p>' },
          renderedFields: {
            description: '<p>HTML <strong>описание</strong> с <a href="#">ссылкой</a></p>',
          },
        },
      ];
      const md = buildRuleBasedMarkdown(_mkRelease(), related, { mode: 'full' });
      assert.match(md, /HTML описание с ссылкой/);
      assert.doesNotMatch(md, /<p>/);
      assert.doesNotMatch(md, /<strong>/);
    });

    test('null release → safe fallback', () => {
      const md = buildRuleBasedMarkdown(null);
      assert.match(md, /Релиз не задан/);
    });
  });

  describe('buildLLMPrompt', () => {

    test('возвращает { system, user } с правилами в system', () => {
      const p = buildLLMPrompt(_mkRelease(), []);
      assert.ok(p.system && typeof p.system === 'string');
      assert.ok(p.user && typeof p.user === 'string');
      assert.match(p.system, /Сохраняй ВСЕ ключи задач/);
      assert.match(p.system, /TL;DR/);
    });

    test('user содержит release-key + rule-based + description-секцию', () => {
      const related = [
        { key: 'BIK-101', fields: { description: 'Раздел auth.' }, renderedFields: {} },
      ];
      const p = buildLLMPrompt(_mkRelease(), related);
      assert.match(p.user, /REL-42/);
      assert.match(p.user, /ИСХОДНЫЙ RULE-BASED MARKDOWN/);
      assert.match(p.user, /ПОЛНЫЕ ОПИСАНИЯ ЗАДАЧ/);
      assert.match(p.user, /BIK-101/);
    });

    test('description проходит через scrubSecrets перед LLM', () => {
      const related = [
        {
          key: 'BIK-101',
          fields: {
            description: 'Connect to API with Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig and password: secret123',
          },
          renderedFields: {},
        },
      ];
      const p = buildLLMPrompt(_mkRelease(), related);
      assert.doesNotMatch(p.user, /eyJhbGciOiJIUzI1NiJ9/);
      assert.match(p.user, /\[(JWT-)?REDACTED\]|REDACTED/);
    });
  });

  describe('stripHtmlTags', () => {

    test('strip <p>, <br>, <ul>, <li>', () => {
      const html = '<p>Текст<br>Вторая строка</p><ul><li>один</li><li>два</li></ul>';
      const text = stripHtmlTags(html);
      assert.match(text, /Текст/);
      assert.match(text, /Вторая строка/);
      assert.match(text, /один/);
      assert.match(text, /два/);
      assert.doesNotMatch(text, /<p>|<li>|<br>/);
    });

    test('decode HTML-entities', () => {
      assert.equal(stripHtmlTags('A&amp;B'), 'A&B');
      assert.equal(stripHtmlTags('&lt;tag&gt;'), '<tag>');
      assert.equal(stripHtmlTags('&quot;quoted&quot;'), '"quoted"');
      assert.equal(stripHtmlTags('&#1056;услово'), 'Руслово');
    });

    test('script/style tags removed entirely', () => {
      const text = stripHtmlTags('<style>body{color:red}</style>Content<script>alert(1)</script>');
      assert.match(text, /Content/);
      assert.doesNotMatch(text, /alert/);
      assert.doesNotMatch(text, /color:red/);
    });

    test('empty / null → empty string', () => {
      assert.equal(stripHtmlTags(null), '');
      assert.equal(stripHtmlTags(''), '');
      assert.equal(stripHtmlTags(undefined), '');
    });
  });

  describe('scrubSecrets', () => {

    test('redacts JWT', () => {
      const text = 'eyJhbGciOiJIUzI1NiJ9.somepayload.signature и что-то ещё';
      assert.match(scrubSecrets(text), /\[JWT-REDACTED\]/);
    });

    test('redacts Authorization: Bearer', () => {
      const text = 'curl -H "Authorization: Bearer mytoken123" url';
      const out = scrubSecrets(text);
      assert.match(out, /authorization: \[REDACTED\]/i);
    });

    test('redacts password=', () => {
      const text = 'password=mySecret123';
      const out = scrubSecrets(text);
      assert.match(out, /password: \[REDACTED\]/i);
    });

    test('обычный текст без секретов проходит без изменений', () => {
      const text = 'Просто описание задачи без секретов.';
      assert.equal(scrubSecrets(text), text);
    });
  });

  describe('getRelatedKeysForFetch', () => {

    test('возвращает union partOf + bugs', () => {
      const keys = getRelatedKeysForFetch(_mkRelease());
      assert.deepEqual(keys.sort(), ['BIK-101', 'BIK-102', 'BIK-103', 'BIK-201', 'BIK-202'].sort());
    });

    test('dedup по key', () => {
      const r = _mkRelease({
        _links: {
          partOf: [{ key: 'X-1' }, { key: 'X-2' }],
          bugs: [{ key: 'X-1' }, { key: 'X-3' }],
        },
      });
      const keys = getRelatedKeysForFetch(r);
      assert.equal(keys.length, 3);
      assert.deepEqual(keys.sort(), ['X-1', 'X-2', 'X-3']);
    });

    test('пустой release → []', () => {
      assert.deepEqual(getRelatedKeysForFetch({}), []);
      assert.deepEqual(getRelatedKeysForFetch(null), []);
    });
  });
});
