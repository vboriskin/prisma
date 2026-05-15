'use strict';
/* ============================================================
   tests/unit/modules.test.js — Волна 1 редизайна (Northstar IA).
   Проверяет структуру MODULES + helpers (getModuleForSection / getModuleLabel /
   getSectionLabel) + backwards-compat NAV_SECTIONS как derived flat list.
   ============================================================ */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MODULES,
  NAV_SECTIONS,
  getModuleForSection,
  getModuleLabel,
  getSectionLabel,
} from '../../app/appSettings.js';

describe('MODULES — Northstar IA structure', () => {
  test('exports ровно 5 модулей', () => {
    assert.equal(MODULES.length, 5, 'brandbook §5 — ровно 5 модулей');
  });

  test('ключи модулей строго английские (slug)', () => {
    const expected = ['course', 'path', 'team', 'goals', 'rituals'];
    assert.deepEqual(MODULES.map(m => m.key), expected);
  });

  test('каждый модуль имеет label, icon, defaultSection, sections[]', () => {
    for (const m of MODULES) {
      assert.ok(m.label, `module ${m.key} has label`);
      assert.ok(m.icon && m.icon.endsWith('.svg'), `module ${m.key} icon is .svg`);
      assert.ok(m.defaultSection, `module ${m.key} has defaultSection`);
      assert.ok(Array.isArray(m.sections) && m.sections.length > 0, `module ${m.key} has non-empty sections`);
    }
  });

  test('defaultSection каждого модуля присутствует в его sections', () => {
    for (const m of MODULES) {
      const has = m.sections.some(s => s.key === m.defaultSection);
      assert.ok(has, `module ${m.key}.defaultSection (${m.defaultSection}) присутствует в sections`);
    }
  });

  test('каждая section имеет уникальный ключ across all modules', () => {
    const keys = MODULES.flatMap(m => m.sections.map(s => s.key));
    const set = new Set(keys);
    assert.equal(keys.length, set.size, `section keys должны быть уникальны: ${keys.length} != ${set.size}`);
  });
});

describe('getModuleForSection helper', () => {
  test('dashboard → course', () => {
    assert.equal(getModuleForSection('dashboard'), 'course');
  });
  test('registry / gantt / kanban / timeline / podlozhka / history → path', () => {
    for (const s of ['registry', 'gantt', 'kanban', 'timeline', 'podlozhka', 'history']) {
      assert.equal(getModuleForSection(s), 'path', `${s} → path`);
    }
  });
  test('employees / burnout / component-health → team', () => {
    for (const s of ['employees', 'burnout', 'component-health']) {
      assert.equal(getModuleForSection(s), 'team', `${s} → team`);
    }
  });
  test('ai-ceo / actions / ai → goals', () => {
    for (const s of ['ai-ceo', 'actions', 'ai']) {
      assert.equal(getModuleForSection(s), 'goals', `${s} → goals`);
    }
  });
  test('est-calibration / doc-debt / integrations / diagnostics / errors → rituals', () => {
    for (const s of ['est-calibration', 'doc-debt', 'integrations', 'diagnostics', 'errors']) {
      assert.equal(getModuleForSection(s), 'rituals', `${s} → rituals`);
    }
  });
  test('unknown section → fallback course', () => {
    assert.equal(getModuleForSection('unknown-section-xyz'), 'course');
  });
});

describe('getModuleLabel helper', () => {
  test('returns human-readable Russian label', () => {
    assert.equal(getModuleLabel('course'),  'Курс');
    assert.equal(getModuleLabel('path'),    'След пути');
    assert.equal(getModuleLabel('team'),    'Команда');
    assert.equal(getModuleLabel('goals'),   'Цели');
    assert.equal(getModuleLabel('rituals'), 'Ритуалы');
  });
  test('unknown module → empty string', () => {
    assert.equal(getModuleLabel('unknown'), '');
  });
});

describe('getSectionLabel helper', () => {
  test('returns label for known sections', () => {
    assert.equal(getSectionLabel('dashboard'), 'Дашборд');
    assert.equal(getSectionLabel('registry'),  'Реестр');
    assert.equal(getSectionLabel('ai-ceo'),    'AI CEO');
  });
  test('unknown section → returns the key as-is (no throw)', () => {
    assert.equal(getSectionLabel('xyz-unknown'), 'xyz-unknown');
  });
});

describe('NAV_SECTIONS — backwards compat flat list', () => {
  test('derived from MODULES.flatMap', () => {
    const expected = MODULES.flatMap(m => m.sections);
    assert.deepEqual(NAV_SECTIONS, expected);
  });
  test('contains all 19 section keys', () => {
    // П4-MS Wave 1: «summary» удалена → было 21, стало 20.
    // V21 tabs-consolidation (вариант A): «insights» свёрнута в Дашборд → 19.
    // 2 (course) + 6 + 3 + 3 + 5 = 19
    const keys = NAV_SECTIONS.map(s => s.key);
    assert.equal(keys.length, 19, `flat-list length: ${keys.length}`);
    // Несколько ключевых проверок чтобы legacy-callsites не сломались.
    assert.ok(keys.includes('dashboard'));
    assert.ok(keys.includes('registry'));
    assert.ok(keys.includes('ai-ceo'));
    assert.ok(keys.includes('integrations'));
    assert.ok(keys.includes('burnout'));
    assert.ok(keys.includes('est-calibration'));
    // «summary» — удалена в П4-MS Wave 1.
    assert.ok(!keys.includes('summary'), '«summary» должна быть удалена');
    // «insights» — свёрнута в Дашборд (V21 tabs-consolidation вариант A,
    // audit-2026-05-V21-tabs/02-insights.md).
    assert.ok(!keys.includes('insights'), '«insights» должна быть удалена');
  });
});
