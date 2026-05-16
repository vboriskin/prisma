'use strict';
/* tests/unit/linkTo.test.js — V22+ Week 1 (I-03, DL-1..DL-6). */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

async function _setupState() {
  const { state } = await import('../../state.js');
  state.integrations = {
    jira: { baseUrl: 'https://jira.sber.ru', hasToken: true },
  };
  return state;
}

describe('linkTo factory', () => {
  test('employee → set_focus action', async () => {
    await _setupState();
    const { linkTo } = await import('../../chat/linkTo.js');
    const chip = linkTo({ kind: 'employee', id: 'ivanov@sber.ru', label: 'Иванов И.' });
    assert.equal(chip.type, 'set_focus');
    assert.equal(chip.payload.kind, 'employee');
    assert.equal(chip.payload.id, 'ivanov@sber.ru');
    assert.match(chip.label, /Сканнер/);
    assert.match(chip.label, /Иванов/);
  });

  test('team → set_focus (scanner) или apply_filter (gantt/registry)', async () => {
    await _setupState();
    const { linkTo } = await import('../../chat/linkTo.js');
    const scanner = linkTo({ kind: 'team', name: 'PAY' }, { section: 'scanner2' });
    assert.equal(scanner.type, 'set_focus');
    assert.equal(scanner.payload.id, 'PAY');

    const gantt = linkTo({ kind: 'team', name: 'PAY' }, { section: 'gantt' });
    assert.equal(gantt.type, 'apply_filter');
    assert.equal(gantt.payload.team, 'PAY');
  });

  test('epic → set_focus с Jira-key', async () => {
    await _setupState();
    const { linkTo } = await import('../../chat/linkTo.js');
    const chip = linkTo({ kind: 'epic', id: 'BIK-1234' });
    assert.equal(chip.type, 'set_focus');
    assert.equal(chip.payload.kind, 'epic');
    assert.equal(chip.payload.id, 'BIK-1234');
  });

  test('release → set_focus (gantt)', async () => {
    await _setupState();
    const { linkTo } = await import('../../chat/linkTo.js');
    const chip = linkTo({ kind: 'release', id: '1.21' });
    assert.equal(chip.type, 'set_focus');
    assert.equal(chip.payload.id, '1.21');
  });

  test('goal → navigate в Чёрный', async () => {
    await _setupState();
    const { linkTo } = await import('../../chat/linkTo.js');
    const chip = linkTo({ kind: 'goal', id: 'GOAL-1' });
    assert.equal(chip.type, 'navigate');
    assert.equal(chip.payload.section, 'black-dashboard');
    assert.equal(chip.payload.goalId, 'GOAL-1');
  });

  test('externalJiraLink — формирует URL из integrations.baseUrl', async () => {
    await _setupState();
    const { externalJiraLink } = await import('../../chat/linkTo.js');
    const chip = externalJiraLink('BIK-1234');
    assert.equal(chip.type, 'open_url');
    assert.equal(chip.payload.url, 'https://jira.sber.ru/browse/BIK-1234');
    assert.match(chip.label, /BIK-1234/);
  });

  test('externalJiraLink → null если baseUrl пустой', async () => {
    const { state } = await import('../../state.js');
    state.integrations = { jira: {} };
    const { externalJiraLink } = await import('../../chat/linkTo.js');
    assert.equal(externalJiraLink('BIK-1234'), null);
  });

  test('buildDefaultLinks для resolved target', async () => {
    await _setupState();
    const { buildDefaultLinks } = await import('../../chat/linkTo.js');
    const chips = buildDefaultLinks({
      employee: { id: 'ivanov@sber.ru', label: 'Иванов И.' },
      team:     { name: 'PAY' },
      epic:     null,
      release:  null,
    });
    // 1 employee + 2 team (scanner + gantt) = 3
    assert.equal(chips.length, 3);
    assert.equal(chips[0].payload.kind, 'employee');
    assert.equal(chips[1].payload.kind, 'team');   // scanner
    assert.equal(chips[2].payload.team,  'PAY');   // gantt
  });

  test('unknown kind → null', async () => {
    await _setupState();
    const { linkTo } = await import('../../chat/linkTo.js');
    assert.equal(linkTo({ kind: 'something' }), null);
    assert.equal(linkTo(null), null);
  });
});
