'use strict';
/* tests/unit/chipBars.test.js — V22+ Week 2 (UX-01, S-S7, S-S8). */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe('chipBars', () => {
  test('buildTimeChipBar: возвращает 7 chip\'ов (6 presets + custom)', async () => {
    const { buildTimeChipBar } = await import('../../chat/chipBars.js');
    const chips = buildTimeChipBar({ employee: { id: 'iv@sber.ru', label: 'Иванов Иван' } });
    assert.equal(chips.length, 7);
    // 6 send_prompt + 1 open_date_picker
    const sendPrompts = chips.filter(c => c.type === 'send_prompt');
    assert.equal(sendPrompts.length, 6);
    const customs = chips.filter(c => c.type === 'open_date_picker');
    assert.equal(customs.length, 1);
  });

  test('buildTimeChipBar: subject в prompt подставляется', async () => {
    const { buildTimeChipBar } = await import('../../chat/chipBars.js');
    const chips = buildTimeChipBar({ employee: { id: 'iv@sber.ru', label: 'Иванов Иван' } });
    const today = chips.find(c => c.label === 'Сегодня' || c.label === '· Сегодня ·');
    assert.ok(today);
    assert.match(today.payload.prompt, /Иванов/);
    assert.match(today.payload.prompt, /сегодня/);
  });

  test('buildTimeChipBar: current period подсвечен', async () => {
    const { buildTimeChipBar } = await import('../../chat/chipBars.js');
    const chips = buildTimeChipBar(
      { employee: { id: 'iv@sber.ru', label: 'Иванов Иван' } },
      { currentPeriod: 'за месяц' }
    );
    const month = chips.find(c => c.label.includes('Месяц'));
    assert.ok(month);
    assert.equal(month.primary, true);
    assert.match(month.label, /·/);  // обёрнут «·»
  });

  test('buildTimeChipBar: пустой target → []', async () => {
    const { buildTimeChipBar } = await import('../../chat/chipBars.js');
    assert.deepEqual(buildTimeChipBar(null), []);
    assert.deepEqual(buildTimeChipBar({}), []);
  });

  test('buildTimeChipBar: team subject', async () => {
    const { buildTimeChipBar } = await import('../../chat/chipBars.js');
    const chips = buildTimeChipBar({ team: { name: 'PAY' } });
    const week = chips.find(c => c.label === 'Неделя');
    assert.ok(week);
    assert.match(week.payload.prompt, /команда PAY/);
  });

  test('buildCustomDateChip', async () => {
    const { buildCustomDateChip } = await import('../../chat/chipBars.js');
    const chip = buildCustomDateChip('Иванов Иван');
    assert.equal(chip.type, 'open_date_picker');
    assert.equal(chip.payload.subject, 'Иванов Иван');
  });

  test('buildSourceChips: правильная HTML-разметка', async () => {
    const { buildSourceChips } = await import('../../chat/chipBars.js');
    const html = buildSourceChips({
      jira: { total: 5 },
      bb:   { total: 3 },
      cf:   { total: 1 },
    });
    assert.match(html, /J:5/);
    assert.match(html, /B:3/);
    assert.match(html, /C:1/);
    assert.match(html, /chat-source-mini-chip/);
  });

  test('buildSourceChips: пустой summary → пустая строка', async () => {
    const { buildSourceChips } = await import('../../chat/chipBars.js');
    assert.equal(buildSourceChips(null), '');
    assert.equal(buildSourceChips({}), '');
  });
});
