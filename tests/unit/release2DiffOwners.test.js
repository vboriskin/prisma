'use strict';
/* tests/unit/release2DiffOwners.test.js — V22+ Phase 5 (Доп #7, #9).
   Diff-banner UI и Owners-card. */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

/* ─────────────────────────────────────────────────────────────
   Diff-banner UI
   ───────────────────────────────────────────────────────────── */

describe('renderRelease2View: diff-banner', () => {
  afterEach(async () => {
    const { resetAllChatStubs } = await import('../_helpers/llmStub.js');
    await resetAllChatStubs();
  });

  function _baseAnalysed() {
    return {
      releases: [
        { key: 'X-1', summary: 'A', status: 'Создан', priority: 'Major', _phase: 'creation', _statusOrderIndex: 0, project: { name: 'P1' }, dates: {}, _links: {}, _flags: [] },
      ],
      byProject: new Map([['P1', [{ key: 'X-1', summary: 'A', status: 'Создан', priority: 'Major', _phase: 'creation', _statusOrderIndex: 0, project: { name: 'P1' }, dates: {}, _links: {}, _flags: [] }]]]),
      byStatus: new Map(),
      byOwner: new Map(),
      stats: { total: 1, byPhase: { creation: 1 } },
      fetchedAt: '2026-05-16T12:00:00.000Z',
    };
  }

  function _baseState() {
    return {
      groupBy: 'project',
      sort: 'priority',
      filters: { projectKeys: [], statuses: [], types: [], risks: [], searchText: '', smartPreset: '' },
      expandedKeys: new Set(),
      getExpandedTab: () => 'attrs',
      getRelated: () => null,
    };
  }

  test('prevDiff отсутствует → banner не рендерится', async () => {
    const { renderRelease2View } = await import('../../integrations/release2/release2Renderer.js');
    const html = renderRelease2View(_baseAnalysed(), _baseState(), { prevDiff: null });
    assert.doesNotMatch(html, /r2-diff-banner/);
  });

  test('prevDiff пустой → banner не рендерится', async () => {
    const { renderRelease2View } = await import('../../integrations/release2/release2Renderer.js');
    const html = renderRelease2View(_baseAnalysed(), _baseState(), {
      prevDiff: { added: [], removed: [], changed: [] },
    });
    assert.doesNotMatch(html, /r2-diff-banner/);
  });

  test('prevDiff с added → banner показывает +N новых', async () => {
    const { renderRelease2View } = await import('../../integrations/release2/release2Renderer.js');
    const html = renderRelease2View(_baseAnalysed(), _baseState(), {
      prevDiff: {
        added: [{ key: 'X-1', summary: 'New release', status: 'Создан' }],
        removed: [],
        changed: [],
      },
    });
    assert.match(html, /r2-diff-banner/);
    assert.match(html, /\+1/);
    assert.match(html, /Новые:/);
    assert.match(html, /X-1/);
    assert.match(html, /New release/);
  });

  test('prevDiff с changed → группировка по полю', async () => {
    const { renderRelease2View } = await import('../../integrations/release2/release2Renderer.js');
    const html = renderRelease2View(_baseAnalysed(), _baseState(), {
      prevDiff: {
        added: [],
        removed: [],
        changed: [
          { key: 'X-1', deltas: [{ field: 'status', from: 'Создан', to: 'ПСИ' }], current: { summary: 'A' } },
          { key: 'X-2', deltas: [{ field: 'status', from: 'ПСИ', to: 'Согласование ППСИ' }], current: { summary: 'B' } },
          { key: 'X-3', deltas: [{ field: 'priority', from: 'Minor', to: 'Critical' }], current: { summary: 'C' } },
        ],
      },
    });
    assert.match(html, /~3/);
    assert.match(html, /Сменился статус:/);
    assert.match(html, /Изменился приоритет:/);
    assert.match(html, /X-1/);
    assert.match(html, /X-3/);
    assert.match(html, /from-?to|→/);
  });

  test('prevDiff с removed → −N в summary', async () => {
    const { renderRelease2View } = await import('../../integrations/release2/release2Renderer.js');
    const html = renderRelease2View(_baseAnalysed(), _baseState(), {
      prevDiff: {
        added: [],
        removed: [{ key: 'X-99', summary: 'Removed release' }],
        changed: [],
      },
    });
    assert.match(html, /−1|-1/);
    assert.match(html, /Удалены/);
    assert.match(html, /X-99/);
  });

  test('dismiss button присутствует с data-r2-action="diff-dismiss"', async () => {
    const { renderRelease2View } = await import('../../integrations/release2/release2Renderer.js');
    const html = renderRelease2View(_baseAnalysed(), _baseState(), {
      prevDiff: {
        added: [{ key: 'X-1', summary: 'A', status: 'Создан' }],
        removed: [],
        changed: [],
      },
    });
    assert.match(html, /data-r2-action="diff-dismiss"/);
  });

  test('fetchedAt передан в data-attribute', async () => {
    const { renderRelease2View } = await import('../../integrations/release2/release2Renderer.js');
    const analysed = _baseAnalysed();
    const html = renderRelease2View(analysed, _baseState(), {
      prevDiff: { added: [{ key: 'X-1', summary: 'A', status: 'Создан' }], removed: [], changed: [] },
    });
    assert.match(html, /data-r2-fetched-at="2026-05-16T12:00:00\.000Z"/);
  });

  test('много added → видим "и ещё N"', async () => {
    const { renderRelease2View } = await import('../../integrations/release2/release2Renderer.js');
    const added = [];
    for (let i = 0; i < 10; i++) added.push({ key: `X-${i}`, summary: `Test ${i}`, status: 'Создан' });
    const html = renderRelease2View(_baseAnalysed(), _baseState(), {
      prevDiff: { added, removed: [], changed: [] },
    });
    assert.match(html, /\+10/);
    assert.match(html, /и ещё 5/);
  });
});

/* ─────────────────────────────────────────────────────────────
   Owners card
   ───────────────────────────────────────────────────────────── */

describe('renderRelease2View: owners-card', () => {
  afterEach(async () => {
    const { resetAllChatStubs } = await import('../_helpers/llmStub.js');
    await resetAllChatStubs();
  });

  function _stateOwners(groupBy = 'project') {
    return {
      groupBy,
      sort: 'priority',
      filters: { projectKeys: [], statuses: [], types: [], risks: [], searchText: '', smartPreset: '' },
      expandedKeys: new Set(),
      getExpandedTab: () => 'attrs',
      getRelated: () => null,
    };
  }

  test('owners-card не рендерится если нет владельцев', async () => {
    const { renderRelease2View } = await import('../../integrations/release2/release2Renderer.js');
    const analysed = {
      releases: [
        { key: 'X-1', summary: 'A', status: 'Создан', priority: 'Major', _phase: 'creation', _statusOrderIndex: 0, project: { name: 'P1' }, dates: {}, _links: {}, _flags: [], organizer: null, assignee: null },
      ],
      byProject: new Map(), byStatus: new Map(), byOwner: new Map(),
      stats: { total: 1, byPhase: {} },
    };
    const html = renderRelease2View(analysed, _stateOwners());
    assert.doesNotMatch(html, /r2-owners-card/);
  });

  test('owners-card показывает top-6 по количеству', async () => {
    const { renderRelease2View } = await import('../../integrations/release2/release2Renderer.js');
    const releases = [];
    // 3 релиза у Иванова, 2 у Петрова, 1 у Сидорова
    for (let i = 0; i < 3; i++) releases.push(_makeRelease(`A-${i}`, 'Иванов Иван', 'creation'));
    for (let i = 0; i < 2; i++) releases.push(_makeRelease(`B-${i}`, 'Петров Пётр', 'uat'));
    releases.push(_makeRelease('C-0', 'Сидоров Сергей', 'deploy'));
    const analysed = {
      releases,
      byProject: new Map([['P1', releases]]),
      byStatus: new Map(), byOwner: new Map(),
      stats: { total: 6, byPhase: { creation: 3, uat: 2, deploy: 1 } },
    };
    const html = renderRelease2View(analysed, _stateOwners());
    assert.match(html, /r2-owners-card/);
    assert.match(html, /Иванов Иван/);
    assert.match(html, /Петров Пётр/);
    assert.match(html, /Сидоров Сергей/);
    // Counters: должны быть в порядке убывания (3, 2, 1)
    const ivanovIdx = html.indexOf('Иванов Иван');
    const petrovIdx = html.indexOf('Петров Пётр');
    const sidIdx = html.indexOf('Сидоров');
    assert.ok(ivanovIdx < petrovIdx);
    assert.ok(petrovIdx < sidIdx);
  });

  test('owner micro-phasebar: сегменты по фазам (V22+ Phase 5.1: dots → bar)', async () => {
    const { renderRelease2View } = await import('../../integrations/release2/release2Renderer.js');
    const releases = [
      _makeRelease('A-1', 'Иванов Иван', 'creation'),
      _makeRelease('A-2', 'Иванов Иван', 'uat'),
      _makeRelease('A-3', 'Иванов Иван', 'deploy'),
    ];
    const analysed = {
      releases,
      byProject: new Map([['P1', releases]]),
      byStatus: new Map(), byOwner: new Map(),
      stats: { total: 3, byPhase: { creation: 1, uat: 1, deploy: 1 } },
    };
    const html = renderRelease2View(analysed, _stateOwners());
    // Phase 5.1: 5 dot-chip заменены на micro-phasebar с 6 сегментами.
    assert.match(html, /r2-owner-phasebar/);
    assert.match(html, /r2-phase-seg-creation/);
    assert.match(html, /r2-phase-seg-uat/);
    assert.match(html, /r2-phase-seg-deploy/);
  });

  test('initials корректные', async () => {
    const { renderRelease2View } = await import('../../integrations/release2/release2Renderer.js');
    const analysed = {
      releases: [_makeRelease('A-1', 'Иванов Иван Петрович', 'creation')],
      byProject: new Map(), byStatus: new Map(), byOwner: new Map(),
      stats: { total: 1, byPhase: { creation: 1 } },
    };
    const html = renderRelease2View(analysed, _stateOwners());
    // Initials = ИИ (Иванов Иван)
    assert.match(html, />ИИ</);
  });

  test('groupBy="owner" → owners-card раскрыт по умолчанию (V22+ Phase 5.1: toggle button → details open)', async () => {
    const { renderRelease2View } = await import('../../integrations/release2/release2Renderer.js');
    const releases = [_makeRelease('A-1', 'Иванов Иван', 'creation')];
    const analysed = {
      releases,
      byProject: new Map(), byStatus: new Map(),
      byOwner: new Map([['Иванов Иван', releases]]),
      stats: { total: 1, byPhase: { creation: 1 } },
    };
    const html = renderRelease2View(analysed, _stateOwners('owner'));
    // Phase 5.1: дублирующая кнопка «Группировать» убрана. Теперь карточка —
    // <details>, открывается автоматически если groupBy === 'owner'.
    assert.match(html, /<details class="r2-owners-card" open>/);
  });

  test('organizer приоритетнее assignee', async () => {
    const { renderRelease2View } = await import('../../integrations/release2/release2Renderer.js');
    const r = _makeRelease('A-1', 'Иванов Иван', 'creation');
    r.assignee = { displayName: 'Assignee Петров' };  // assignee другой
    const analysed = {
      releases: [r],
      byProject: new Map(), byStatus: new Map(), byOwner: new Map(),
      stats: { total: 1, byPhase: { creation: 1 } },
    };
    const html = renderRelease2View(analysed, _stateOwners());
    assert.match(html, /Иванов Иван/);
    assert.doesNotMatch(html, /Assignee Петров/);
  });

  function _makeRelease(key, organizerName, phase) {
    return {
      key, summary: key, status: 'Создан', priority: 'Major',
      _phase: phase, _statusOrderIndex: 0,
      project: { name: 'P1' }, dates: {}, _links: {}, _flags: [],
      organizer: { displayName: organizerName },
      assignee: null,
    };
  }
});

/* ─────────────────────────────────────────────────────────────
   release2State: diff-dismiss
   ───────────────────────────────────────────────────────────── */

describe('release2State: diff-dismiss tracking', () => {
  afterEach(async () => {
    const { resetAllChatStubs } = await import('../_helpers/llmStub.js');
    await resetAllChatStubs();
  });

  test('isDiffDismissedFor: dismiss + проверка', async () => {
    const { mockLocalStorage } = await import('../_helpers/llmStub.js');
    mockLocalStorage();
    // Force re-import singleton (требует особого подхода — здесь работаем напрямую)
    const { release2State } = await import('../../integrations/release2/release2State.js');

    const ts1 = '2026-05-16T12:00:00.000Z';
    const ts2 = '2026-05-16T13:00:00.000Z';

    // Initially: not dismissed
    assert.equal(release2State.isDiffDismissedFor(ts1), false);

    // Dismiss for ts1
    release2State.dismissDiffFor(ts1);
    assert.equal(release2State.isDiffDismissedFor(ts1), true);
    // Other fetched-at — НЕ dismissed
    assert.equal(release2State.isDiffDismissedFor(ts2), false);

    // After new refresh (ts2), нужно сделать новый dismiss
    release2State.dismissDiffFor(ts2);
    assert.equal(release2State.isDiffDismissedFor(ts2), true);
    // ts1 уже не активен (только последний хранится)
    assert.equal(release2State.isDiffDismissedFor(ts1), false);
  });
});
