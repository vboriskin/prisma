'use strict';
/* tests/unit/release2Model.test.js — V22+ Phase 5 (Release 2.0). */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FIXTURE = '/Users/vaceslavboriskin/PycharmProjects/n8n/work/IDP/release_2_0.json';

describe('release2Model', () => {
  test('analyseRelease2: real Jira sample → корректные поля', async () => {
    const { analyseRelease2 } = await import('../../integrations/release2/release2Model.js');
    const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    const m = analyseRelease2(raw);

    assert.equal(m.key, 'SMECM-22526');
    assert.match(m.summary, /КАР.*Релиз 1\.21/);
    assert.equal(m.status, 'Создан');
    assert.equal(m.type, 'Плановый');
    assert.equal(m.priority, 'Minor');
    assert.equal(m._phase, 'creation');
    assert.equal(m.project.key, 'SMECM');

    // КЭ: 2 elements
    assert.equal(m.configElement?.length, 2);
    assert.equal(m.configElement[0].value, 'СБОФ.Рассмотрение.F2');

    // Service
    assert.equal(m.service?.length, 1);
    assert.equal(m.service[0].value, 'СБОФ');

    // Polygons
    assert.equal(m.polygonUAT, 'Major-Go');
    assert.equal(m.polygonIFT, 'Major-check');

    // Users
    assert.ok(m.organizer?.displayName?.length);
    assert.ok(m.approver?.displayName?.length);

    // Dates
    assert.ok(m.dates.planUATStart);
    assert.ok(m.dates.planProdEnd);
    assert.equal(typeof m.dates.planProdEnd, 'string');

    // Links: 15 PartOf + 16 Bugs + 1 Cloner
    assert.equal(m._links.partOf.length, 15);
    assert.equal(m._links.bugs.length, 16);
    assert.equal(m._links.cloners.length, 1);

    // Subtasks
    assert.equal(m._subtasks.length, 0);

    // Attachments
    assert.equal(m._attachments.length, 0);

    // Status order
    assert.equal(m._statusOrderIndex, 0);

    // Flags — пусто потому что даты в будущем за пределами 3/7 дн
    assert.ok(Array.isArray(m._flags));
  });

  test('analyseRelease2: null/invalid → null', async () => {
    const { analyseRelease2 } = await import('../../integrations/release2/release2Model.js');
    assert.equal(analyseRelease2(null), null);
    assert.equal(analyseRelease2({}), null);
    assert.equal(analyseRelease2({ key: '', fields: {} }), null);
  });

  test('analyseRelease2List: aggregation + group-by', async () => {
    const { analyseRelease2List } = await import('../../integrations/release2/release2Model.js');
    const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    const result = analyseRelease2List([raw], {});
    assert.equal(result.releases.length, 1);
    assert.equal(result.stats.total, 1);
    assert.equal(result.stats.byPhase.creation, 1);
    assert.equal(result.byProject.get('Credit process (KAR)')?.length, 1);
    assert.equal(result.byStatus.get('Создан')?.length, 1);
  });

  test('extractLinkedSummaries: правильное разделение типов', async () => {
    const { extractLinkedSummaries } = await import('../../integrations/release2/release2Model.js');
    const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    const links = extractLinkedSummaries(raw);
    assert.equal(links.partOf.length, 15);
    assert.equal(links.bugs.length, 16);
    assert.equal(links.cloners.length, 1);
    // Все partOf — это Story (issuetype может быть пустым в sample,
    // но проверим что ключи корректные).
    assert.ok(links.partOf.every(p => /^[A-Z]+-\d+$/.test(p.key)));
  });

  test('diffRelease2Lists: added / removed / changed', async () => {
    const { diffRelease2Lists } = await import('../../integrations/release2/release2Model.js');
    const prev = [
      { key: 'A', status: 'Создан', priority: 'Minor', dates: {}, _links: { partOf: [] } },
      { key: 'B', status: 'ПСИ',    priority: 'Major', dates: {}, _links: { partOf: [{ key: 'x' }] } },
    ];
    const curr = [
      { key: 'A', status: 'Формирование', priority: 'Minor', dates: {}, _links: { partOf: [] } },
      { key: 'C', status: 'Создан',       priority: 'Minor', dates: {}, _links: { partOf: [] } },
    ];
    const d = diffRelease2Lists(prev, curr);
    assert.equal(d.added.length, 1);
    assert.equal(d.added[0].key, 'C');
    assert.equal(d.removed.length, 1);
    assert.equal(d.removed[0].key, 'B');
    assert.equal(d.changed.length, 1);
    assert.equal(d.changed[0].key, 'A');
    assert.deepEqual(d.changed[0].deltas[0], { field: 'status', from: 'Создан', to: 'Формирование' });
  });

  test('flags: соблизкие даты ПСИ/ПРОМ дают _flags', async () => {
    const { analyseRelease2 } = await import('../../integrations/release2/release2Model.js');
    const tomorrow = new Date(Date.now() + 86400_000).toISOString();
    const in5 = new Date(Date.now() + 5 * 86400_000).toISOString();
    const raw = {
      key: 'X-1',
      fields: {
        summary: 'test',
        project: { key: 'X', name: 'X' },
        status: { name: 'ПСИ' },
        priority: { name: 'Major' },
        issuetype: { name: 'Release 2.0' },
        created: tomorrow,
        updated: tomorrow,
        issuelinks: [],
        subtasks: [],
        attachment: [],
        customfield_29500: tomorrow,    // planUATStart — завтра
        customfield_24300: in5,          // planProdEnd — через 5 дней
      },
    };
    const m = analyseRelease2(raw);
    assert.ok(m._flags.some(f => f.kind === 'uat-soon'));
    assert.ok(m._flags.some(f => f.kind === 'prod-soon'));
  });
});

describe('release2Fields constants', () => {
  test('FIELD_BY_ID + FIELD_BY_KEY mapping', async () => {
    const { FIELD_BY_ID, FIELD_BY_KEY, buildFieldList } = await import('../../integrations/release2/release2Fields.js');
    assert.equal(FIELD_BY_ID['customfield_28700']?.key, 'type');
    assert.equal(FIELD_BY_KEY.configElement?.id, 'customfield_22200');
    const fields = buildFieldList();
    assert.ok(fields.includes('summary'));
    assert.ok(fields.includes('customfield_22200'));
    assert.ok(fields.length > 50);
  });

  test('STATUS_PHASES таксономия', async () => {
    const { STATUS_PHASES } = await import('../../integrations/release2/release2Fields.js');
    assert.equal(STATUS_PHASES['Создан'], 'creation');
    assert.equal(STATUS_PHASES['ПСИ'], 'uat');
    assert.equal(STATUS_PHASES['Установлен на ПРОМ'], 'deploy');
    assert.equal(STATUS_PHASES['Отменено'], 'cancel');
  });
});
