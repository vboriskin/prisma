'use strict';
/* tests/unit/reviewPreset.test.js — V22+ Week 4 (LP-08). */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe('buildReviewSections', () => {
  test('пустые summaries → грамотный fallback', async () => {
    const { buildReviewSections } = await import('../../chat/reviewPreset.js');
    const r = buildReviewSections(
      { employee: { label: 'Иванов Иван', id: 'iv@sber.ru' } },
      { label: 'Q1 2026' },
      {}
    );
    assert.deepEqual(r.achievements, []);
    assert.match(r.markdown, /Нет явных достижений/);
    assert.match(r.markdown, /Performance Review/);
    assert.match(r.markdown, /Q1 2026/);
  });

  test('achievements: Jira closed + types + top items', async () => {
    const { buildReviewSections } = await import('../../chat/reviewPreset.js');
    const summaries = {
      jira: {
        total: 8,
        closed: 5,
        byType: { Bug: 3, Task: 2 },
        top: [
          { key: 'BIK-1', summary: 'KYC backend', status: 'Done' },
          { key: 'BIK-2', summary: 'Pay v2 frontend', status: 'Done' },
        ],
      },
      bb: { total: 3, merged: 2, repos: { mobile: 2, backend: 1 } },
      cf: { total: 1, spaces: { PAY: 1 } },
    };
    const r = buildReviewSections(
      { employee: { label: 'Иванов Иван' } },
      { label: 'май 2026' },
      summaries
    );
    assert.ok(r.achievements.length >= 3);
    const md = r.achievements.join('\n');
    assert.match(md, /Закрыто 5 задач/);
    assert.match(md, /Слил 2 PR/);
    assert.match(md, /Подготовил 1 страниц/);
    assert.match(md, /BIK-1/);
  });

  test('growth: незакрытые задачи > closed × 2 → signal', async () => {
    const { buildReviewSections } = await import('../../chat/reviewPreset.js');
    const summaries = {
      jira: { total: 10, closed: 2, byType: {}, top: [] },
      bb: { total: 0, merged: 0, repos: {} },
    };
    const r = buildReviewSections({ employee: { label: 'Иванов' } }, { label: 'май' }, summaries);
    assert.ok(r.growthAreas.some(g => /незакрытых/i.test(g)));
  });

  test('growth: comparison drop в Jira closed', async () => {
    const { buildReviewSections } = await import('../../chat/reviewPreset.js');
    const summaries = {
      jira: { total: 5, closed: 2, byType: {}, top: [] },
    };
    const comparison = {
      jira: { total: 8, closed: 7 },
    };
    const r = buildReviewSections(
      { employee: { label: 'Иванов' } },
      { label: 'май' },
      summaries,
      comparison
    );
    assert.ok(r.growthAreas.some(g => /меньше.*предыдущем/i.test(g)));
  });

  test('growth: BB activity отсутствует → signal', async () => {
    const { buildReviewSections } = await import('../../chat/reviewPreset.js');
    const summaries = {
      jira: { total: 5, closed: 3, byType: {}, top: [] },
      bb: { total: 0, merged: 0, repos: {} },
    };
    const r = buildReviewSections({ employee: { label: 'Иванов' } }, { label: 'май' }, summaries);
    assert.ok(r.growthAreas.some(g => /Bitbucket.*отсутствует/i.test(g)));
  });

  test('recommendations: derived from growth', async () => {
    const { buildReviewSections } = await import('../../chat/reviewPreset.js');
    const summaries = {
      jira: { total: 20, closed: 5, byType: {}, top: [] },
    };
    const r = buildReviewSections({ employee: { label: 'Иванов' } }, { label: 'май' }, summaries);
    assert.ok(r.recommendations.length >= 1);
    assert.ok(r.recommendations.some(rec => /review-сессию/i.test(rec)));
  });

  test('recommendations: positive если нет growth signals', async () => {
    const { buildReviewSections } = await import('../../chat/reviewPreset.js');
    const summaries = {
      jira: { total: 10, closed: 8, byType: { Bug: 4, Task: 4 }, top: [] },
      bb: { total: 5, merged: 5, repos: { mobile: 5 } },
      cf: { total: 4, spaces: { PAY: 4 } },
    };
    const r = buildReviewSections({ employee: { label: 'Иванов' } }, { label: 'май' }, summaries);
    assert.ok(r.recommendations.length >= 1);
  });

  test('markdown: содержит все 3 секции', async () => {
    const { buildReviewSections } = await import('../../chat/reviewPreset.js');
    const r = buildReviewSections(
      { employee: { label: 'Иванов' } },
      { label: 'май' },
      { jira: { total: 5, closed: 5, byType: {}, top: [] } }
    );
    assert.match(r.markdown, /Achievements/);
    assert.match(r.markdown, /Growth Areas/);
    assert.match(r.markdown, /Recommendations/);
  });

  test('all types fragmentation: >4 проектов → signal', async () => {
    const { buildReviewSections } = await import('../../chat/reviewPreset.js');
    const summaries = {
      jira: {
        total: 8, closed: 4, byType: { Bug: 4 },
        top: [
          { key: 'PAY-1', status: 'Done' },
          { key: 'CORE-1', status: 'Done' },
          { key: 'KYC-1', status: 'Done' },
          { key: 'API-1', status: 'Done' },
          { key: 'MOB-1', status: 'Done' },
        ],
      },
    };
    const r = buildReviewSections({ employee: { label: 'Иванов' } }, { label: 'май' }, summaries);
    assert.ok(r.growthAreas.some(g => /разбросаны.*проектам/i.test(g)));
  });
});
