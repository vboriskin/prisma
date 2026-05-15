'use strict';
/* ============================================================
   tests/unit/views-headers.test.js — Волна 3 / 4 редизайна.
   Static-source-snapshot: каждый view модулей импортирует
   `renderPageHeader` из `app/prizmaUI.js` и вызывает его с
   правильным sectionKey. Цель — поймать регрессию когда
   кто-то удалит page-header или переименует sectionKey.
   ============================================================ */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

function read(rel) {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

/** Пары [файл, [список sectionKey, которые должны вызываться через renderPageHeader]]. */
const VIEW_HEADERS = [
  ['views/dashboard.js',          ['dashboard']],
  ['views/registry.js',           ['registry']],
  ['views/employees.js',          ['employees']],
  ['views/aiCeoView.js',          ['ai-ceo']],
  ['views/aiView.js',             ['ai']],
  ['views/kanban.js',             ['kanban']],
  ['views/history.js',            ['history']],
  ['views/teamHealthDashboards.js', ['est-calibration', 'component-health', 'burnout']],
  ['app/actionLayer.js',          ['actions']],
];

/** Файлы которые передают sectionKey через переменную (prizmaSectionKey).
    Для них проверяем только импорт + наличие вызова, без literal section'а. */
const VIEW_DYNAMIC = [
  'views/metrics.js',
  'views/gantt.js',
  'views/timeline.js',
];

describe('views-headers — все главные views рендерят prizma page-header', () => {
  for (const [file, sections] of VIEW_HEADERS) {
    test(`${file} импортирует renderPageHeader из app/prizmaUI.js`, () => {
      const src = read(file);
      assert.match(src, /import\s+\{[^}]*\brenderPageHeader\b[^}]*\}\s+from\s+['"][^'"]*\/?prizmaUI(?:\.js)?['"]/,
        `${file} должен импортировать renderPageHeader из prizmaUI.js`);
    });

    for (const section of sections) {
      test(`${file} вызывает renderPageHeader('${section}', ...)`, () => {
        const src = read(file);
        const re = new RegExp(`renderPageHeader\\(\\s*['"\`]${section.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}['"\`]`);
        assert.match(src, re, `${file} должен содержать renderPageHeader('${section}', ...)`);
      });
    }
  }

  for (const file of VIEW_DYNAMIC) {
    test(`${file} (dynamic) импортирует и использует renderPageHeader`, () => {
      const src = read(file);
      assert.match(src, /import\s+\{[^}]*\brenderPageHeader\b[^}]*\}\s+from\s+['"][^'"]*\/?prizmaUI(?:\.js)?['"]/,
        `${file} должен импортировать renderPageHeader`);
      assert.match(src, /renderPageHeader\(/, `${file} должен вызывать renderPageHeader`);
    });
  }
});

describe('views-headers — 5 default-sections модулей покрыты', () => {
  // По плану §5.1 — каждый из 5 модулей имеет default-section, главный экран
  // которого ОБЯЗАН содержать page-header + (для course/goals) hero-блок.
  const DEFAULTS = {
    course:  'dashboard',
    path:    'registry',
    team:    'employees',
    goals:   'ai-ceo',
    rituals: 'est-calibration',
  };
  const FILES = {
    dashboard:        'views/dashboard.js',
    registry:         'views/registry.js',
    employees:        'views/employees.js',
    'ai-ceo':         'views/aiCeoView.js',
    'est-calibration':'views/teamHealthDashboards.js',
  };

  for (const [moduleKey, sectionKey] of Object.entries(DEFAULTS)) {
    test(`модуль "${moduleKey}" — default-section "${sectionKey}" имеет page-header в ${FILES[sectionKey]}`, () => {
      const src = read(FILES[sectionKey]);
      const re = new RegExp(`renderPageHeader\\(\\s*['"\`]${sectionKey.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}['"\`]`);
      assert.match(src, re);
    });
  }
});

describe('views-headers — hero-блок только на course/goals главных экранах', () => {
  // Brand §3 (renderHero) — звезда + KPI рендерится только на главных
  // экранах модулей course (dashboard) и goals (ai-ceo). Path/team/rituals —
  // без hero, только page-header.
  test('views/dashboard.js использует renderHero', () => {
    const src = read('views/dashboard.js');
    assert.match(src, /\brenderHero\(/, 'dashboard должен рендерить hero-блок');
  });

  test('views/registry.js НЕ использует renderHero (path-модуль без hero)', () => {
    const src = read('views/registry.js');
    assert.doesNotMatch(src, /\brenderHero\(/, 'registry не должен рендерить hero');
  });

  test('views/employees.js НЕ использует renderHero (team-модуль без hero)', () => {
    const src = read('views/employees.js');
    assert.doesNotMatch(src, /\brenderHero\(/, 'employees не должен рендерить hero');
  });
});
