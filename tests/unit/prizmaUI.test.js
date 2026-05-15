'use strict';
/* ============================================================
   tests/unit/prizmaUI.test.js — Волна 3 редизайна.
   Регрессионные тесты для prizmaUI.js helper'ов:
     · renderPageHeader — eyebrow собирается «{МОДУЛЬ} · {РАЗДЕЛ}», sub опционален
     · renderHero — звезда + KPI + caption + опц. supporting
     · TDZ-bug fix (sub ссылался на саму себя) — не возвращается
     · escape-helper не пропускает <script>
   ============================================================ */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  renderPageHeader,
  renderHero,
  starSvg,
  inlinePulseLoader,
} from '../../app/prizmaUI.js';

describe('renderPageHeader — eyebrow + h1 + sub', () => {
  test('5 модулей × default-section: eyebrow матчит «{MODULE} · {SECTION}»', () => {
    const cases = [
      { section: 'dashboard',       expectModule: 'КУРС',     expectTitle: 'Дашборд' },
      { section: 'registry',        expectModule: 'СЛЕД ПУТИ',expectTitle: 'Реестр' },
      { section: 'employees',       expectModule: 'КОМАНДА',  expectTitle: 'Сотрудники' },
      { section: 'ai-ceo',          expectModule: 'ЦЕЛИ',     expectTitle: 'AI CEO' },
      { section: 'est-calibration', expectModule: 'РИТУАЛЫ',  expectTitle: 'Точность оценок' },
    ];
    for (const c of cases) {
      const html = renderPageHeader(c.section);
      assert.match(html, new RegExp(`prizma-page-eyebrow.+${c.expectModule}`),
        `${c.section} → eyebrow ${c.expectModule}`);
      assert.match(html, new RegExp(`prizma-page-h1[^>]*>${c.expectTitle}`),
        `${c.section} → h1 ${c.expectTitle}`);
      assert.match(html, /prizma-page-hairline/, `${c.section} → hairline есть`);
    }
  });

  test('opts.sub добавляет prizma-page-sub блок', () => {
    const html = renderPageHeader('dashboard', { sub: 'Тестовый подзаголовок' });
    assert.match(html, /prizma-page-sub.+Тестовый подзаголовок/);
  });

  test('без opts.sub блок-sub не рендерится', () => {
    const html = renderPageHeader('dashboard');
    assert.doesNotMatch(html, /prizma-page-sub/);
  });

  test('opts.title переопределяет section-label', () => {
    const html = renderPageHeader('dashboard', { title: 'Кастомный заголовок' });
    assert.match(html, />Кастомный заголовок</);
  });

  test('TDZ-bug regression: opts.sub не должен ронять рендер с ReferenceError', () => {
    // Раньше внутри `const sub = opts.sub ? \`...${escapeHtml(sub)}...\` : ''`
    // переменная `sub` ссылалась на саму себя → ReferenceError на каждом render'е.
    // Должно проходить без исключений.
    assert.doesNotThrow(() => {
      renderPageHeader('dashboard', { sub: 'любой текст' });
    });
  });

  test('XSS-safe: <script> в opts.sub экранируется', () => {
    const html = renderPageHeader('dashboard', { sub: '<script>alert(1)</script>' });
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
  });

  test('XSS-safe: <script> в opts.title экранируется', () => {
    const html = renderPageHeader('dashboard', { title: '<img onerror=x>' });
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
  });
});

describe('renderHero — звезда + KPI', () => {
  test('базовый рендер содержит звезду + KPI + caption', () => {
    const html = renderHero({ kpi: '57.7%', caption: 'КУРС КВАРТАЛА' });
    assert.match(html, /prizma-hero-mark/, 'есть mark-обёртка');
    assert.match(html, /<svg/, 'есть SVG');
    assert.match(html, />57\.7%</, 'KPI вставлен');
    assert.match(html, />КУРС КВАРТАЛА</, 'caption вставлен');
  });

  test('supporting-числа рендерятся', () => {
    const html = renderHero({
      kpi: '0%', caption: 'X',
      supporting: [
        { num: 10, label: 'A' },
        { num: 5,  label: 'B' },
      ],
    });
    assert.match(html, /prizma-hero-supporting/);
    assert.match(html, />10</);
    assert.match(html, />5</);
    assert.match(html, />A</);
    assert.match(html, />B</);
  });

  test('без supporting блок не рендерится', () => {
    const html = renderHero({ kpi: '0%', caption: 'X' });
    assert.doesNotMatch(html, /prizma-hero-supporting/);
  });
});

describe('starSvg / inlinePulseLoader', () => {
  test('starSvg возвращает SVG с 8 polygon-лучами + ядром', () => {
    const svg = starSvg();
    assert.match(svg, /<svg/);
    const polygons = svg.match(/<polygon/g) || [];
    assert.equal(polygons.length, 8, '8 лучей звезды');
    assert.match(svg, /<circle r="4"/, 'ядро r=4');
  });

  test('inlinePulseLoader с label прокидывает aria-label', () => {
    const html = inlinePulseLoader('Сверяем курс…');
    assert.match(html, /prizma-loader-inline/);
    assert.match(html, /aria-label="Сверяем курс…"/);
  });

  test('inlinePulseLoader без label — без aria-label', () => {
    const html = inlinePulseLoader();
    assert.match(html, /prizma-loader-inline/);
    assert.doesNotMatch(html, /aria-label=/);
  });
});
