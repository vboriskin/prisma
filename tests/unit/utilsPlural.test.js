'use strict';
/* ============================================================
   tests/unit/utilsPlural.test.js — V21 BF (audit-08 critical-zero-coverage)
   --
   Покрывает Utils.plural — русские склонения (audit-09 §I Quick win 1).
   Pure-function — без mocks, без window.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Utils } from '../../utils.js';

describe('Utils.plural — Russian plural rules', () => {
  test('1 → "one" form', () => {
    assert.equal(Utils.plural(1, ['задача', 'задачи', 'задач']), 'задача');
  });

  test('2-4 → "few" form', () => {
    assert.equal(Utils.plural(2, ['задача', 'задачи', 'задач']), 'задачи');
    assert.equal(Utils.plural(3, ['задача', 'задачи', 'задач']), 'задачи');
    assert.equal(Utils.plural(4, ['задача', 'задачи', 'задач']), 'задачи');
  });

  test('5-20 → "many" form', () => {
    for (let n = 5; n <= 20; n++) {
      assert.equal(Utils.plural(n, ['задача', 'задачи', 'задач']), 'задач', `n=${n}`);
    }
  });

  test('11-14 (special exception) → "many" not "one"/"few"', () => {
    assert.equal(Utils.plural(11, ['блокер', 'блокера', 'блокеров']), 'блокеров');
    assert.equal(Utils.plural(12, ['блокер', 'блокера', 'блокеров']), 'блокеров');
    assert.equal(Utils.plural(13, ['блокер', 'блокера', 'блокеров']), 'блокеров');
    assert.equal(Utils.plural(14, ['блокер', 'блокера', 'блокеров']), 'блокеров');
  });

  test('21, 31, 101 (mod10=1, mod100!=11) → "one" form', () => {
    assert.equal(Utils.plural(21, ['день', 'дня', 'дней']), 'день');
    assert.equal(Utils.plural(31, ['день', 'дня', 'дней']), 'день');
    assert.equal(Utils.plural(101, ['день', 'дня', 'дней']), 'день');
  });

  test('22-24, 32-34 (mod10=2-4, mod100!=12-14) → "few" form', () => {
    assert.equal(Utils.plural(22, ['риск', 'риска', 'рисков']), 'риска');
    assert.equal(Utils.plural(23, ['риск', 'риска', 'рисков']), 'риска');
    assert.equal(Utils.plural(34, ['риск', 'риска', 'рисков']), 'риска');
  });

  test('25-30 (mod10=5-9) → "many" form', () => {
    assert.equal(Utils.plural(25, ['тест', 'теста', 'тестов']), 'тестов');
    assert.equal(Utils.plural(28, ['тест', 'теста', 'тестов']), 'тестов');
    assert.equal(Utils.plural(30, ['тест', 'теста', 'тестов']), 'тестов');
  });

  test('0 → "many" form', () => {
    assert.equal(Utils.plural(0, ['тест', 'теста', 'тестов']), 'тестов');
  });

  test('отрицательное число — берёт abs', () => {
    assert.equal(Utils.plural(-1, ['день', 'дня', 'дней']), 'день');
    assert.equal(Utils.plural(-3, ['день', 'дня', 'дней']), 'дня');
    assert.equal(Utils.plural(-11, ['день', 'дня', 'дней']), 'дней');
  });

  test('non-numeric → 0 → "many" form', () => {
    assert.equal(Utils.plural('abc', ['day', 'days', 'дней']), 'дней');
    assert.equal(Utils.plural(null, ['день', 'дня', 'дней']), 'дней');
    assert.equal(Utils.plural(undefined, ['день', 'дня', 'дней']), 'дней');
  });

  test('overload: plural(n, one, few, many) — 4 args', () => {
    assert.equal(Utils.plural(1, 'минута', 'минуты', 'минут'), 'минута');
    assert.equal(Utils.plural(3, 'минута', 'минуты', 'минут'), 'минуты');
    assert.equal(Utils.plural(7, 'минута', 'минуты', 'минут'), 'минут');
  });

  test('массив форм vs varargs дают одинаковый результат', () => {
    const a = Utils.plural(5, ['блок', 'блока', 'блоков']);
    const b = Utils.plural(5, 'блок', 'блока', 'блоков');
    assert.equal(a, b);
  });

  test('non-rus формы тоже работают', () => {
    assert.equal(Utils.plural(1, ['day', 'days', 'days']), 'day');
    assert.equal(Utils.plural(5, ['day', 'days', 'days']), 'days');
  });
});

describe('Utils.plural — нумерация edge cases', () => {
  test('100 → "many" (mod10=0)', () => {
    assert.equal(Utils.plural(100, ['руб', 'рубля', 'рублей']), 'рублей');
  });

  test('111-114 → "many" (mod100=11-14 → exception)', () => {
    assert.equal(Utils.plural(111, ['руб', 'рубля', 'рублей']), 'рублей');
    assert.equal(Utils.plural(114, ['руб', 'рубля', 'рублей']), 'рублей');
  });

  test('121, 122 → "one"/"few" (mod10=1/2, mod100=21/22 outside 11-14)', () => {
    assert.equal(Utils.plural(121, ['руб', 'рубля', 'рублей']), 'рубль' === 'рубль' ? 'руб' : 'руб');
    assert.equal(Utils.plural(122, ['руб', 'рубля', 'рублей']), 'рубля');
  });

  test('1000, 1001 — works ok', () => {
    assert.equal(Utils.plural(1000, ['день', 'дня', 'дней']), 'дней');
    assert.equal(Utils.plural(1001, ['день', 'дня', 'дней']), 'день');
  });
});
