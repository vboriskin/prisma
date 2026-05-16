'use strict';
/* tests/unit/periodParser.test.js — V22+ Week 1 (P-01..P-04). */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe('periodParser', () => {
  test('базовые keyword: сегодня/вчера', async () => {
    const { parsePeriod } = await import('../../chat/periodParser.js');
    const now = new Date(2026, 4, 15, 12, 0, 0);   // 15 мая 2026 12:00
    const today = parsePeriod('что было сегодня?', { now });
    assert.equal(today.label, 'сегодня');
    assert.equal(today.from.getDate(), 15);
    assert.equal(today.to.getDate(), 16);

    const yesterday = parsePeriod('покажи вчера', { now });
    assert.equal(yesterday.label, 'вчера');
    assert.equal(yesterday.from.getDate(), 14);
    assert.equal(yesterday.to.getDate(), 15);
  });

  test('rolling: за неделю / месяц / квартал / год', async () => {
    const { parsePeriod, periodDays } = await import('../../chat/periodParser.js');
    const now = new Date(2026, 4, 15, 12, 0, 0);
    assert.equal(periodDays(parsePeriod('за неделю', { now })),  7);
    assert.equal(periodDays(parsePeriod('за месяц', { now })),   30);
    assert.equal(periodDays(parsePeriod('за квартал', { now })), 90);
    assert.equal(periodDays(parsePeriod('за год', { now })),     365);
  });

  test('rolling с числом: за 3 недели / за 5 дней', async () => {
    const { parsePeriod, periodDays } = await import('../../chat/periodParser.js');
    const now = new Date(2026, 4, 15, 12, 0, 0);
    assert.equal(periodDays(parsePeriod('за последние 3 недели', { now })), 21);
    assert.equal(periodDays(parsePeriod('за 5 дней', { now })), 5);
    assert.equal(periodDays(parsePeriod('за 2 месяца', { now })), 60);
  });

  test('календарь: март 2026', async () => {
    const { parsePeriod } = await import('../../chat/periodParser.js');
    const now = new Date(2026, 4, 15);
    const p = parsePeriod('что в марте 2026?', { now });
    assert.equal(p.mode, 'calendar');
    assert.equal(p.from.getMonth(), 2);    // March = 2
    assert.equal(p.from.getDate(), 1);
    assert.equal(p.to.getMonth(), 3);      // April
    assert.equal(p.to.getDate(), 1);
    assert.match(p.label, /март/);
  });

  test('календарь: Q1 / Q3 2025', async () => {
    const { parsePeriod } = await import('../../chat/periodParser.js');
    const now = new Date(2026, 4, 15);
    const q1 = parsePeriod('Q1 2026', { now });
    assert.equal(q1.from.getFullYear(), 2026);
    assert.equal(q1.from.getMonth(), 0);
    assert.equal(q1.to.getMonth(), 3);
    assert.equal(q1.label, 'Q1 2026');

    const q3 = parsePeriod('q3 2025', { now });
    assert.equal(q3.from.getFullYear(), 2025);
    assert.equal(q3.from.getMonth(), 6);
    assert.equal(q3.to.getMonth(), 9);
  });

  test('календарь: «в 2025», «2024 год»', async () => {
    const { parsePeriod } = await import('../../chat/periodParser.js');
    const now = new Date(2026, 4, 15);
    const y1 = parsePeriod('в 2025 году', { now });
    assert.equal(y1.from.getFullYear(), 2025);
    assert.equal(y1.from.getMonth(), 0);
    assert.equal(y1.to.getFullYear(), 2026);

    const y2 = parsePeriod('за 2024 год', { now });
    assert.equal(y2.from.getFullYear(), 2024);
  });

  test('этот месяц / прошлый квартал', async () => {
    const { parsePeriod } = await import('../../chat/periodParser.js');
    const now = new Date(2026, 4, 15);
    const thisMonth = parsePeriod('что в этом месяце', { now });
    assert.equal(thisMonth.from.getMonth(), 4);   // May
    assert.equal(thisMonth.to.getMonth(), 5);     // June

    const prevQuarter = parsePeriod('в прошлом квартале', { now });
    assert.equal(prevQuarter.from.getMonth(), 0); // Q1 = Jan-Mar (we're in Q2)
    assert.equal(prevQuarter.to.getMonth(), 3);   // April = start of Q2
  });

  test('custom range: с 1 марта по 15 апреля', async () => {
    const { parsePeriod } = await import('../../chat/periodParser.js');
    const now = new Date(2026, 4, 15);
    const p = parsePeriod('с 1 марта по 15 апреля', { now });
    assert.equal(p.mode, 'custom');
    assert.equal(p.from.getMonth(), 2);
    assert.equal(p.from.getDate(), 1);
    assert.equal(p.to.getMonth(), 3);
    assert.equal(p.to.getDate(), 16);   // exclusive
  });

  test('custom range: ISO даты', async () => {
    const { parsePeriod } = await import('../../chat/periodParser.js');
    const now = new Date(2026, 4, 15);
    const p = parsePeriod('с 2026-03-01 по 2026-04-15', { now });
    assert.equal(p.mode, 'custom');
    assert.equal(p.from.getMonth(), 2);
    assert.equal(p.from.getDate(), 1);
    assert.equal(p.to.getMonth(), 3);
    assert.equal(p.to.getDate(), 16);
  });

  test('previousPeriod возвращает корректный сдвиг', async () => {
    const { parsePeriod, previousPeriod, periodDays } = await import('../../chat/periodParser.js');
    const now = new Date(2026, 4, 15);
    const cur = parsePeriod('за месяц', { now });
    const prev = previousPeriod(cur);
    assert.equal(periodDays(prev), 30);
    assert.equal(prev.to.getTime(), cur.from.getTime());
  });

  test('пустой / мусорный текст → null', async () => {
    const { parsePeriod } = await import('../../chat/periodParser.js');
    assert.equal(parsePeriod(''), null);
    assert.equal(parsePeriod(null), null);
    assert.equal(parsePeriod('какой-то совсем посторонний текст'), null);
  });

  test('defaultPeriod = неделя', async () => {
    const { defaultPeriod, periodDays } = await import('../../chat/periodParser.js');
    const now = new Date(2026, 4, 15);
    const p = defaultPeriod({ now });
    assert.equal(periodDays(p), 7);
    assert.equal(p.label, 'за неделю');
  });
});
