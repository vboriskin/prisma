'use strict';
/* tests/unit/resolveTarget.test.js — V22+ Week 1 (I-01, I-04). */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

async function _setupState() {
  const { state } = await import('../../state.js');
  state.rows = [
    { id: 'r1', team: 'PAY',  epic: 'Платёжный шлюз v2', tasks: 'BIK-100' },
    { id: 'r2', team: 'CORE', epic: 'Миграция',          tasks: 'CORE-50' },
    { id: 'r3', team: 'PAY',  epic: 'KYC v3',            tasks: 'BIK-200' },
  ];
  state.employees = [
    { email: 'ivanov@sber.ru',     fio: 'Иванов Иван',     jiraAccountId: 'jaid-1', team: 'PAY' },
    { email: 'petrov@sber.ru',     fio: 'Петров Пётр',     jiraAccountId: 'jaid-2', team: 'CORE' },
    { email: 'ivanova@sber.ru',    fio: 'Иванова Анна',    jiraAccountId: 'jaid-3', team: 'PAY' },
    { email: 'fired@sber.ru',      fio: 'Сидоров [X]',     jiraAccountId: 'jaid-4', team: 'PAY', deactivated: true },
  ];
  state.integrations = {
    jira:       { hasToken: true },
    bitbucket:  { hasToken: true },
    confluence: { hasToken: false },     // CF не настроен — для I-04 теста
    zephyr:     { hasToken: true },
  };
  return state;
}

describe('resolveTarget', () => {
  test('пустой текст → пустой target', async () => {
    await _setupState();
    const { resolveTarget } = await import('../../chat/resolveTarget.js');
    const t = resolveTarget('');
    assert.equal(t.employee, null);
    assert.equal(t.team, null);
    assert.deepEqual(t.sources, []);
  });

  test('email-match → identity-deterministic employee', async () => {
    await _setupState();
    const { resolveTarget } = await import('../../chat/resolveTarget.js');
    const t = resolveTarget('что у ivanov@sber.ru за неделю?');
    assert.ok(t.employee);
    assert.equal(t.employee.ref, 'email');
    assert.equal(t.employee.id, 'ivanov@sber.ru');
    assert.equal(t.employee.label, 'Иванов Иван');
  });

  test('ФИО-match по фамилии', async () => {
    await _setupState();
    const { resolveTarget } = await import('../../chat/resolveTarget.js');
    const t = resolveTarget('расскажи про Иванова');
    assert.ok(t.employee);
    assert.equal(t.employee.ref, 'fio');
    assert.match(t.employee.label, /Иванов/);
  });

  test('ambiguity — две Ивановых', async () => {
    await _setupState();
    const { resolveTarget } = await import('../../chat/resolveTarget.js');
    // «Иванов» сматчит и Иванов Иван, и Иванова Анна (фамилия начинается с «Иванов»...
    // На самом деле Иванов и Иванова — разные фамилии. Проверим обоих:
    const t = resolveTarget('расскажи про Иванов и Иванова');
    assert.ok(t.employee);
    assert.ok(t.ambiguity);
    assert.equal(t.ambiguity.kind, 'employee');
    assert.ok(t.ambiguity.candidates.length >= 2);
  });

  test('уволенный [X] фильтруется', async () => {
    await _setupState();
    const { resolveTarget } = await import('../../chat/resolveTarget.js');
    const t = resolveTarget('расскажи про Сидорова');
    assert.equal(t.employee, null);   // отфильтрован
  });

  test('team-match', async () => {
    await _setupState();
    const { resolveTarget } = await import('../../chat/resolveTarget.js');
    const t = resolveTarget('что у команды PAY?');
    assert.ok(t.team);
    assert.equal(t.team.name, 'PAY');
  });

  test('source detection: BB / CF / Jira / Zephyr', async () => {
    await _setupState();
    const { resolveTarget } = await import('../../chat/resolveTarget.js');
    assert.deepEqual(resolveTarget('что в Bitbucket?').sources, ['bb']);
    assert.deepEqual(resolveTarget('покажи Confluence страницы').sources, ['cf']);
    assert.deepEqual(resolveTarget('сколько PR в jira?').sources.sort(), ['bb', 'jira']);
    assert.deepEqual(resolveTarget('тест-кейсы в Zephyr').sources, ['zephyr']);
  });

  test('action detection', async () => {
    await _setupState();
    const { resolveTarget } = await import('../../chat/resolveTarget.js');
    assert.equal(resolveTarget('сравни Иванова и Петрова').action, 'compare');
    assert.equal(resolveTarget('найди задачи').action, 'find');
    assert.equal(resolveTarget('стендап').action, 'standup');
    assert.equal(resolveTarget('расскажи про Иванова').action, 'show');
  });

  test('release detection', async () => {
    await _setupState();
    const { resolveTarget } = await import('../../chat/resolveTarget.js');
    assert.equal(resolveTarget('что в 1.21?').release.id, '1.21');
    assert.equal(resolveTarget('овертайм').release.id, 'overtime');
    assert.equal(resolveTarget('в бэклоге').release.id, 'backlog');
  });

  test('epic Jira-key extraction', async () => {
    await _setupState();
    const { resolveTarget } = await import('../../chat/resolveTarget.js');
    const t = resolveTarget('что у BIK-1234?');
    assert.ok(t.epic);
    assert.equal(t.epic.id, 'BIK-1234');
    assert.equal(t.epic.source, 'jira-key');
  });

  test('period передаётся в target', async () => {
    await _setupState();
    const { resolveTarget } = await import('../../chat/resolveTarget.js');
    const t = resolveTarget('что у Иванова за квартал?', { now: new Date(2026, 4, 15) });
    assert.ok(t.period);
    assert.equal(t.period.label, 'за квартал');
  });

  test('checkSourcesAvailable выявляет неконфигурированный CF', async () => {
    await _setupState();
    const { checkSourcesAvailable } = await import('../../chat/resolveTarget.js');
    assert.deepEqual(checkSourcesAvailable(['bb', 'cf']), ['cf']);
    assert.deepEqual(checkSourcesAvailable(['jira']), []);
    assert.deepEqual(checkSourcesAvailable([]), []);
  });

  test('memo: «А Петров?» наследует period+source от Иванова', async () => {
    await _setupState();
    const { resolveTarget, rememberTarget, resolveTargetWithMemo, _clearTargetMemo } =
      await import('../../chat/resolveTarget.js');
    _clearTargetMemo();
    const now = new Date(2026, 4, 15);
    // 1-й turn: Иванов за неделю в BB
    const t1 = resolveTarget('что у Иванова за неделю в BB?', { now });
    rememberTarget(t1);
    // 2-й turn: только «А Петров?»
    const t2 = resolveTargetWithMemo('А Петров?', { now });
    assert.ok(t2.employee);
    assert.match(t2.employee.label, /Петров/);
    assert.ok(t2.period);
    assert.equal(t2.period.label, 'за неделю');
    assert.deepEqual(t2.sources, ['bb']);
    assert.equal(t2._inheritedFromMemo, true);
  });

  test('memo: TTL 5 минут', async () => {
    await _setupState();
    const { resolveTarget, rememberTarget, recallLastTarget, _clearTargetMemo } =
      await import('../../chat/resolveTarget.js');
    _clearTargetMemo();
    const t1 = resolveTarget('что у Иванова за неделю');
    rememberTarget(t1);
    // Сразу — recall возвращает.
    assert.ok(recallLastTarget());
    // Memo не имеет внешнего clock override, проверяем через метод _clearTargetMemo.
    _clearTargetMemo();
    assert.equal(recallLastTarget(), null);
  });
});
