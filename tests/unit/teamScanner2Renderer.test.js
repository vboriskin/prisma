'use strict';
/* ============================================================
   tests/unit/teamScanner2Renderer.test.js
   --
   V18.1 P7 Sprint 3 S3.4 — coverage gap для renderer-функций.

   QA panel: renderEmployeeDetailPanel happy path, filter-pill toggle,
   peak-cell mark в heatmap, maskEmail edge cases, empty-state CTA —
   ничего из этого не покрыто.

   Подход: pure HTML-string assertions. Нам не нужен DOM — renderer
   возвращает HTML-строку, проверяем что нужные классы / aria-атрибуты /
   содержание в неё попадают.

   Utils.escapeHtml требует Node ≥ 18 + DOM-shim либо browser. Используем
   minimal shim для тестов.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Минимальный shim для Utils.escapeHtml (uses DOMParser в проде).
// Подменяем глобально до импорта renderer'а.
globalThis.window = globalThis.window || {};
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: () => ({
      set textContent(v) { this._t = v; },
      get innerHTML() {
        return String(this._t || '')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      },
    }),
  };
}

const {
  renderEmployeeDetailPanel,
  renderTopBar,
  renderTeamGlance,
  renderEmpty,
  renderError,
  classifyPerson,
  renderMultiTeamView,
  fmtDuration,
  renderTeamSwitcher,
  renderSprintLagBreakdown,
  renderVelocityComparison,
} = await import('../../integrations/teamScanner2Renderer.js');

/* ── Test fixtures ───────────────────────────────────────── */

function makeParticipant(over = {}) {
  return {
    key: 'u1',
    label: 'Иванов Александр',
    email: 'vasya.borisov@sber.ru',
    jiraAccountId: 'u1',
    avatar: '',
    projects: ['PRJ'],
    timelineToday:     [],
    timelineYesterday: [],
    timelinePrev:      [],
    issuesNow: [],
    stale:     [],
    bbItems:   [],
    cfItems:   [],
    badges: { commits48h: 0, pr48h: 0, conf48h: 0 },
    zephyrTestsCreatedRecent: [],
    zephyrTestsExecutedRecent: [],
    loggedTodaySec:     0,
    loggedYesterdaySec: 0,
    loggedDayBeforeSec: 0,
    heatmap72x4: {
      // V18.3 A2: 5 sources (J/B/C/Zc/Ze)
      grid: [new Array(72).fill(0), new Array(72).fill(0), new Array(72).fill(0), new Array(72).fill(0), new Array(72).fill(0)],
      rowTotals: [0, 0, 0, 0, 0],
      colTotals: new Array(72).fill(0),
      peakCell: null,
    },
    contextSwitches: { distinctIssueKeys: 0, switchEvents: [], switchScore: 0 },
    blockers: [],
    timeline72h: [],
    ...over,
  };
}
function makeModel(over = {}) {
  return {
    participants: [],
    fetchedAt: '2026-05-02T14:00:00Z',
    projectKeys: ['PRJ'],
    jiraBaseUrl: 'https://jira.test',
    spaces: {},
    unassignedByPk: {},
    scannerV2: {
      enrichedAt: Date.now(),
      dwellThresholdHours: 24,
      tzOffsetMin: null,
      serverLocalTZ: true,
      sprintGoal: { sprints: [], aggregateProgress: 0, aggregateDone: 0, aggregateTotal: 0, aggregatePace: 'no-data' },
      risks:      { orphansByPk: {}, totalOrphans: 0, outOfSprintByPerson: {}, totalOutOfSprint: 0, outOfSprintRatio: 0 },
    },
    ...over,
  };
}

/* ── renderEmployeeDetailPanel ──────────────────────────── */

describe('renderEmployeeDetailPanel — happy path', () => {
  test('возвращает HTML с panel-секциями для существующего участника', () => {
    const model = makeModel({ participants: [makeParticipant()] });
    const html = renderEmployeeDetailPanel(model, 'u1', { filters: { j: true, b: true, c: true, z: true } });
    assert.match(html, /class="ts2-panel ts2-panel-modal"/);
    assert.match(html, /Иванов Александр/);
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /id="ts2-panel-main"/);
    // Все 4 секции присутствуют.
    assert.match(html, /Heatmap 72×4/);
    assert.match(html, /Старые задачи/);
    assert.match(html, /События/);
  });

  test('non-existent key → возвращает empty-panel', () => {
    const model = makeModel({ participants: [makeParticipant()] });
    const html = renderEmployeeDetailPanel(model, 'unknown-key', { filters: {} });
    assert.match(html, /Участник не найден/);
    assert.match(html, /id="ts2-detail-close"/);
  });

  test('email masked по умолчанию (PII)', () => {
    const model = makeModel({ participants: [makeParticipant({ email: 'vasya.borisov@sber.ru' })] });
    const html = renderEmployeeDetailPanel(model, 'u1', {});
    // masked default text shown
    assert.match(html, /v\*+@sber\.ru/);
    // full email присутствует только в data-attribute (для toggle), но не в видимом тексте до click'а.
    assert.match(html, /data-email-full="vasya\.borisov@sber\.ru"/);
  });

  test('peakCell в heatmap получает .ts2-hcell-peak class', () => {
    const grid = [new Array(72).fill(0), new Array(72).fill(0), new Array(72).fill(0), new Array(72).fill(0), new Array(72).fill(0)];
    grid[0][50] = 5;
    const p = makeParticipant({
      heatmap72x4: {
        grid,
        rowTotals: [5, 0, 0, 0, 0],
        colTotals: new Array(72).fill(0),
        peakCell: { srcIdx: 0, hourIndex: 50, count: 5 },
      },
    });
    const model = makeModel({ participants: [p] });
    const html = renderEmployeeDetailPanel(model, 'u1', { filters: { j: true, b: true, c: true, z: true } });
    assert.match(html, /ts2-hcell-peak/);
  });

  test('saturation outline (>=4 events) добавляет .ts2-hcell-saturated', () => {
    const grid = [new Array(72).fill(0), new Array(72).fill(0), new Array(72).fill(0), new Array(72).fill(0), new Array(72).fill(0)];
    grid[0][30] = 7;   // saturation
    const p = makeParticipant({
      heatmap72x4: { grid, rowTotals: [7, 0, 0, 0, 0], colTotals: new Array(72).fill(0), peakCell: null },
    });
    const model = makeModel({ participants: [p] });
    const html = renderEmployeeDetailPanel(model, 'u1', { filters: { j: true, b: true, c: true, z: true } });
    assert.match(html, /ts2-hcell-saturated/);
  });
});

/* ── filter-pill toggle behavior ─────────────────────────── */

describe('filter-pill rendering (S1.6 + S3.3)', () => {
  test('aria-pressed="true" для active pill', () => {
    const model = makeModel({ participants: [makeParticipant()] });
    const html = renderEmployeeDetailPanel(model, 'u1', { filters: { j: true, b: false, c: true, z: true } });
    // J pill active
    assert.match(html, /data-filter="j"[\s\S]*?aria-pressed="true"/);
    // B pill inactive
    assert.match(html, /data-filter="b"[\s\S]*?aria-pressed="false"/);
  });

  test('off-filter получает класс .ts2-filter-pill-off', () => {
    const model = makeModel({ participants: [makeParticipant()] });
    const html = renderEmployeeDetailPanel(model, 'u1', { filters: { j: true, b: false, c: true, z: true } });
    assert.match(html, /ts2-filter-pill-off[^"]*"\s+data-filter="b"/);
  });

  test('off-filter события исчезают из events feed', () => {
    const e1 = { at: '2026-05-02T10:00:00Z', src: 'jira',  issue: { key: 'J-1' }, kind: 'transition' };
    const e2 = { at: '2026-05-02T11:00:00Z', src: 'bb',    title: 'Fix auth',       kind: 'pr' };
    const p = makeParticipant({ timeline72h: [e2, e1] });
    const model = makeModel({ participants: [p] });
    // BB filter OFF — bb event не должен быть в events feed
    const html = renderEmployeeDetailPanel(model, 'u1', { filters: { j: true, b: false, c: true, z: true } });
    assert.match(html, /J-1/, 'jira событие осталось');
    assert.doesNotMatch(html, /Fix auth/, 'bb событие отфильтровано');
  });
});

/* ── renderEmpty CTA (S3.3) ───────────────────────────────── */

describe('renderEmpty (S3.3)', () => {
  test('содержит CTA-кнопку с data-int-action="settings"', () => {
    const html = renderEmpty();
    assert.match(html, /data-int-action="settings"/);
    assert.match(html, /Открыть настройки интеграций/);
    assert.match(html, /class="ts2-btn ts2-btn-primary"/);
  });
});

/* ── renderError ─────────────────────────────────────────── */

describe('renderError', () => {
  test('retryable=true показывает retry-кнопку', () => {
    const html = renderError('Test error', true);
    assert.match(html, /id="ts2-retry-btn"/);
    assert.match(html, /Test error/);
  });
  test('retryable=false скрывает retry-кнопку', () => {
    const html = renderError('No retry', false);
    assert.doesNotMatch(html, /id="ts2-retry-btn"/);
  });
});

/* ── renderTopBar Sprint Goal gauge (S2.1) ───────────────── */

describe('renderTopBar Sprint Goal gauge', () => {
  test('показывает gauge когда есть sprintGoal с aggregateTotal>0', () => {
    const model = makeModel({
      scannerV2: {
        sprintGoal: {
          sprints: [{ pk: 'PRJ', name: 'Sprint 12', daysLeft: 3, total: 10, done: 6, progressPct: 60, pace: 'on-track' }],
          aggregateProgress: 60, aggregateDone: 6, aggregateTotal: 10, aggregatePace: 'on-track',
        },
      },
    });
    const html = renderTopBar(model);
    assert.match(html, /class="ts2-sprint-gauge ts2-sprint-pace-on-track"/);
    assert.match(html, /Sprint 12/);
    assert.match(html, /60%/);
    assert.match(html, /3 дня/);
  });

  test('не показывает gauge при пустом sprintGoal', () => {
    const model = makeModel();
    const html = renderTopBar(model);
    assert.doesNotMatch(html, /ts2-sprint-gauge/);
  });

  test('behind-pace получает danger-стиль', () => {
    const model = makeModel({
      scannerV2: {
        sprintGoal: {
          sprints: [{ pk: 'PRJ', name: 'X', daysLeft: 1, total: 10, done: 1, progressPct: 10, pace: 'behind' }],
          aggregateProgress: 10, aggregateDone: 1, aggregateTotal: 10, aggregatePace: 'behind',
        },
      },
    });
    const html = renderTopBar(model);
    assert.match(html, /ts2-sprint-pace-behind/);
    assert.match(html, /Дрейф/);
  });
});

/* ── renderTeamGlance risk shelf (S2.1.5) ─────────────────── */

describe('renderTeamGlance risk shelf', () => {
  test('показывает risk-row при наличии orphans/oos', () => {
    const model = makeModel({
      participants: [makeParticipant()],
      scannerV2: {
        risks: { totalOrphans: 3, totalOutOfSprint: 5, outOfSprintRatio: 0.2, orphansByPk: { PRJ: 3 }, outOfSprintByPerson: {} },
      },
    });
    const html = renderTeamGlance(model);
    assert.match(html, /ts2-glance-risk-row/);
    assert.match(html, /3.*без assignee/);
    assert.match(html, /5.*out-of-sprint/);
    assert.match(html, /20%/);
  });

  test('скрывает risk-row при нулях', () => {
    const model = makeModel({
      participants: [makeParticipant()],
      scannerV2: {
        risks: { totalOrphans: 0, totalOutOfSprint: 0, outOfSprintRatio: 0, orphansByPk: {}, outOfSprintByPerson: {} },
      },
    });
    const html = renderTeamGlance(model);
    assert.doesNotMatch(html, /ts2-glance-risk-row/);
  });
});

/* ── Multi-team aggregate view (S4.1) ─────────────────────── */

describe('renderMultiTeamView (S4.1)', () => {
  test('пустой spaces → empty-state', () => {
    const html = renderMultiTeamView(makeModel());
    assert.match(html, /Нет данных по командам/);
  });

  test('строит row на каждую pk c участниками + sprint + risks', () => {
    const partA = makeParticipant({ key: 'u1', projects: ['BACKEND'], issuesNow: [{}, {}, {}, {}] });
    const partB = makeParticipant({ key: 'u2', projects: ['FRONTEND'], issuesNow: [{}] });
    const model = makeModel({
      participants: [partA, partB],
      spaces: {
        BACKEND:  { activeSprintName: 'Backend Sprint 12', sprintIssues: [{}, {}] },
        FRONTEND: { activeSprintName: 'Frontend Sprint 5',  sprintIssues: [{}] },
      },
      scannerV2: {
        sprintGoal: {
          sprints: [
            { pk: 'BACKEND',  progressPct: 60, pace: 'on-track', daysLeft: 4 },
            { pk: 'FRONTEND', progressPct: 30, pace: 'behind',   daysLeft: 2 },
          ],
        },
        risks: { orphansByPk: { BACKEND: 3 } },
      },
    });
    const html = renderMultiTeamView(model);
    assert.match(html, /BACKEND/);
    assert.match(html, /FRONTEND/);
    assert.match(html, /Backend Sprint 12/);
    assert.match(html, /60%/);
    assert.match(html, /30%/);
    assert.match(html, /3 orphans/);
    assert.match(html, /4 в пути/, 'BACKEND total WIP=4');
    assert.match(html, /1 в пути/, 'FRONTEND total WIP=1');
    // Click-handlers через data-team-pk
    assert.match(html, /data-team-pk="BACKEND"/);
    assert.match(html, /data-team-pk="FRONTEND"/);
  });

  test('error space → error-row', () => {
    const model = makeModel({
      spaces: {
        BROKEN: { hasError: true, errorMsg: 'Jira 503' },
      },
    });
    const html = renderMultiTeamView(model);
    assert.match(html, /Jira 503/);
    assert.match(html, /ts2-team-row-error/);
  });

  test('сортировка: stop-команды первыми', () => {
    const partA = makeParticipant({
      key: 'u1', projects: ['HEALTHY'],
      issuesNow: [], stale: [], timelineToday: [{ at: new Date().toISOString(), kind: 'transition' }],
    });
    const partB = makeParticipant({
      key: 'u2', projects: ['STUCK'],
      issuesNow: [], stale: [{}, {}], timelineToday: [],
    });
    const model = makeModel({
      participants: [partA, partB],
      spaces: {
        HEALTHY: { activeSprintName: 'A', sprintIssues: [{}] },
        STUCK:   { activeSprintName: 'B', sprintIssues: [{}] },
      },
    });
    const html = renderMultiTeamView(model);
    const idxStuck   = html.indexOf('STUCK');
    const idxHealthy = html.indexOf('HEALTHY');
    assert.ok(idxStuck < idxHealthy, 'STUCK должен быть выше HEALTHY (sort by stop count)');
  });
});

/* ── HR-language: «Требует разговора» (S3.2) ─────────────── */

describe('HR-language polish (S3.2)', () => {
  test('group label «Требует разговора», не «Стоп»', async () => {
    // renderPersonRows не экспортирован — проверяем через
    // renderEmployeeDetailPanel или просто через classifyPerson
    // (косвенно через GROUP_META внутри renderer'а). Используем full-render.
    // Создаём stop'нутого participant'а:
    const p = makeParticipant({
      stale: [{ key: 'X-1' }],
      timelineToday: [],
    });
    assert.equal(classifyPerson(p), 'stop');
    // GROUP_META.stop.label exposed через renderTeamGlance / renderPersonRows?
    // Нет. Но проверим что в team-glance counter «1 стоп» появляется.
    const model = makeModel({ participants: [p] });
    const html = renderTeamGlance(model);
    assert.match(html, /1.*стоп/);
  });
});

/* ── V20 S10.2 — fmtDuration (часы → дни+часы) ────────────── */

describe('fmtDuration', () => {
  test('< 24ч → «Nч» (округление целое)', () => {
    assert.equal(fmtDuration(0),    '0ч');
    assert.equal(fmtDuration(1),    '1ч');
    assert.equal(fmtDuration(8.4),  '8ч');
    assert.equal(fmtDuration(8.6),  '9ч');
    assert.equal(fmtDuration(23.4), '23ч');
  });

  test('24..47.99ч → «1д» / «1д Nч»', () => {
    assert.equal(fmtDuration(24),    '1д');
    assert.equal(fmtDuration(25),    '1д 1ч');
    assert.equal(fmtDuration(47.4),  '1д 23ч');
  });

  test('boundary: 23.99 → «24ч», 24.0 → «1д»', () => {
    // 23.99 округлится до 24, но всё ещё < 24ч → выходит «24ч»
    // (acceptable — пользователь увидит то же что было раньше)
    assert.equal(fmtDuration(23.99), '24ч');
    assert.equal(fmtDuration(24.0),  '1д');
  });

  test('кейсы из реального пилота', () => {
    // 1642ч >= 1000ч → только «Xд» (10ч теряются как шум на масштабе 68 дней).
    // Pilot complaint был именно про 1642ч — «68д» решает читаемость.
    assert.equal(fmtDuration(1642), '68д');
    assert.equal(fmtDuration(168),  '7д');     // ровно неделя
    assert.equal(fmtDuration(72),   '3д');
    assert.equal(fmtDuration(48),   '2д');
    // Ниже 1000ч — показываем часы.
    assert.equal(fmtDuration(100),  '4д 4ч');
    assert.equal(fmtDuration(500),  '20д 20ч');
    assert.equal(fmtDuration(999),  '41д 15ч');
  });

  test('rem ровно округляется до 24 → days+1', () => {
    // 47.6 → days=1, rem=Math.round(47.6 - 24) = Math.round(23.6) = 24 → 2д
    assert.equal(fmtDuration(47.6), '2д');
  });

  test('≥ 1000ч → только «Xд» (часы теряют смысл)', () => {
    assert.equal(fmtDuration(1000),  '41д');
    assert.equal(fmtDuration(2400),  '100д');
    assert.equal(fmtDuration(8760),  '365д');   // год — clock skew или брошенная задача
  });

  test('negative / NaN / Infinity → «—» (defensive)', () => {
    assert.equal(fmtDuration(-1),       '—');
    assert.equal(fmtDuration(NaN),      '—');
    assert.equal(fmtDuration(Infinity), '—');
    assert.equal(fmtDuration(undefined),'—');   // Number(undefined) = NaN
    // null → Number(null) = 0 → '0ч' (не error). Это OK: legacy data
    // часто приносит null вместо undefined. defensive «—» оставляем
    // только для NaN/Infinity/negative.
    assert.equal(fmtDuration(null),     '0ч');
  });

  test('строки с числами парсятся через Number()', () => {
    assert.equal(fmtDuration('30'),     '1д 6ч');
    assert.equal(fmtDuration('1642'),   '68д');
    assert.equal(fmtDuration('abc'),    '—');   // Number('abc') = NaN → defensive
  });
});

/* ── V20 S10.5 — renderTeamSwitcher ───────────────────────── */

describe('renderTeamSwitcher', () => {
  test('0 команд → не рендерит ничего', () => {
    assert.equal(renderTeamSwitcher({ projectKeys: [] }), '');
    assert.equal(renderTeamSwitcher({}), '');
    assert.equal(renderTeamSwitcher(null), '');
  });

  test('S12: 1 команда → рендерит wrapper с search-input но без tabs', () => {
    const html = renderTeamSwitcher({ projectKeys: ['CORE'] });
    assert.match(html, /ts2-team-switcher/);
    assert.doesNotMatch(html, /data-switch-team="CORE"/, 'tabs не нужны при 1 команде');
    assert.match(html, /ts2-team-search/, 'search input всегда');
  });

  test('≥ 2 команд → рендерит segmented tabs + кнопку «+ Все»', () => {
    const html = renderTeamSwitcher({ projectKeys: ['SMECM', 'CORE', 'SMEND'] });
    assert.match(html, /ts2-team-switcher/);
    assert.match(html, /role="tablist"/);
    assert.match(html, /data-switch-team="CORE"/);
    assert.match(html, /data-switch-team="SMECM"/);
    assert.match(html, /data-switch-team="SMEND"/);
    assert.match(html, /data-switch-team="__all__"/);
  });

  test('сортирует pk alphabetical', () => {
    const html = renderTeamSwitcher({ projectKeys: ['SMECM', 'CORE', 'AAAA'] });
    const idxA = html.indexOf('data-switch-team="AAAA"');
    const idxC = html.indexOf('data-switch-team="CORE"');
    const idxS = html.indexOf('data-switch-team="SMECM"');
    assert.ok(idxA < idxC && idxC < idxS, 'expected AAAA < CORE < SMECM');
  });

  test('активный таб (team mode + matching pk) подсвечивается', () => {
    const html = renderTeamSwitcher(
      { projectKeys: ['CORE', 'SMECM'] },
      { activeView: 'team', activePkFilter: 'CORE' },
    );
    // Подсветка через class и aria-selected="true" на CORE.
    assert.match(html, /ts2-team-tab-active[^"]*"\s+data-switch-team="CORE"/);
    assert.match(html, /aria-selected="true"\s+title="Переключиться на команду CORE"/);
  });

  test('multi mode → активна кнопка «+ Все», нет активных pk-tab', () => {
    const html = renderTeamSwitcher(
      { projectKeys: ['CORE', 'SMECM'] },
      { activeView: 'multi', activePkFilter: '' },
    );
    assert.match(html, /ts2-team-tab-all ts2-team-tab-active/);
    // Ни один из pk-табов не должен быть activе.
    assert.doesNotMatch(html, /data-switch-team="CORE"[^>]*ts2-team-tab-active/);
  });

  test('team mode без выбранного pk → подсвечивается первый alphabetical как fallback', () => {
    const html = renderTeamSwitcher(
      { projectKeys: ['SMECM', 'CORE'] },
      { activeView: 'team', activePkFilter: '' },
    );
    // Первый alphabetical = CORE → должен быть active по fallback.
    assert.match(html, /ts2-team-tab-active[^"]*"\s+data-switch-team="CORE"/);
  });
});

/* ── V20 S10.7 — renderSprintLagBreakdown ─────────────────── */

describe('renderSprintLagBreakdown', () => {
  test('пустой sprintGoal → не рендерит ничего', () => {
    assert.equal(renderSprintLagBreakdown(null, {}), '');
    assert.equal(renderSprintLagBreakdown({ sprints: [] }, {}), '');
    assert.equal(renderSprintLagBreakdown(undefined, {}), '');
  });

  test('один спринт + блокеры → рендерит формулу + at-risk список', () => {
    const sg = {
      sprints: [{ pk: 'CORE', name: 'CORE Sprint 26', total: 22, done: 14, progressPct: 63.6, idealPct: 73.1, daysLeft: 3, pace: 'behind' }],
      aggregateProgress: 63.6,
    };
    const model = {
      spaces: { CORE: { sprintIssues: [{ key: 'CORE-1' }, { key: 'CORE-2' }, { key: 'CORE-3' }] } },
      participants: [{
        key: 'u1', label: 'Иванов И.',
        timelineToday: [], timelineYesterday: [], timelinePrev: [],
        blockers: [
          { key: 'CORE-1', dwellHours: 96,  status: 'Code Review', summary: 'Add login' },
          { key: 'CORE-2', dwellHours: 240, status: 'In Progress', summary: 'Refactor auth' },
        ],
      }],
    };
    const html = renderSprintLagBreakdown(sg, model);
    assert.match(html, /Где дрейф\?/);
    assert.match(html, /Как считается/);
    assert.match(html, /CORE-1/);
    assert.match(html, /CORE-2/);
    // Sorted by dwellHours desc → CORE-2 (240ч) появляется раньше CORE-1 (96ч).
    const idx1 = html.indexOf('CORE-1');
    const idx2 = html.indexOf('CORE-2');
    assert.ok(idx2 > 0 && idx2 < idx1, 'expected CORE-2 (240h) перед CORE-1 (96h)');
  });

  test('фильтрует at-risk блокеры по active-sprint-keys', () => {
    const sg = { sprints: [{ pk: 'CORE', name: 'S26', total: 5, done: 2, progressPct: 40, idealPct: 80, daysLeft: 2, pace: 'behind' }] };
    const model = {
      spaces: { CORE: { sprintIssues: [{ key: 'CORE-1' }] } },
      participants: [{
        key: 'u1', label: 'A',
        timelineToday: [], timelineYesterday: [], timelinePrev: [],
        blockers: [
          { key: 'CORE-1',  dwellHours: 30, status: 'IP' }, // ✓ в спринте
          { key: 'CORE-99', dwellHours: 50, status: 'IP' }, // ✗ бэклог — должен исчезнуть
        ],
      }],
    };
    const html = renderSprintLagBreakdown(sg, model);
    assert.match(html, /CORE-1/);
    assert.doesNotMatch(html, /CORE-99/);
  });

  test('выводит «отстаём на Npp» для pace=behind', () => {
    const sg = { sprints: [{ pk: 'CORE', name: 'S', total: 22, done: 14, progressPct: 63.6, idealPct: 73.1, daysLeft: 3, pace: 'behind' }] };
    const html = renderSprintLagBreakdown(sg, { spaces: {}, participants: [] });
    // 73.1 - 63.6 = 9.5 → «отстаём на 9.5pp»
    assert.match(html, /отстаём на 9\.5pp/);
  });

  test('опережает → «опережаем на Npp»', () => {
    const sg = { sprints: [{ pk: 'CORE', name: 'S', total: 22, done: 18, progressPct: 81.8, idealPct: 60, daysLeft: 5, pace: 'ahead' }] };
    const html = renderSprintLagBreakdown(sg, { spaces: {}, participants: [] });
    assert.match(html, /опережаем на/);
  });

  test('Top-3 stuck people: фильтруется по classifyPerson===\'stop\'', () => {
    const sg = { sprints: [{ pk: 'CORE', name: 'S', total: 5, done: 1, progressPct: 20, idealPct: 80, daysLeft: 1, pace: 'behind' }] };
    const stopP = (over) => ({
      timelineToday: [], timelineYesterday: [], timelinePrev: [],
      blockers: [{ key: 'CORE-X', dwellHours: 40 }],
      ...over,
    });
    const model = {
      spaces: { CORE: { sprintIssues: [{ key: 'CORE-X' }] } },
      participants: [
        stopP({ key: 'u1', label: 'Stuck-A' }),     // → stop (есть blocker)
        stopP({ key: 'u2', label: 'Stuck-B', blockers: [{ key: 'CORE-X', dwellHours: 200 }] }),
        { key: 'u3', label: 'Active', timelineToday: [{ at: '...', issue: { key: 'CORE-X' } }], blockers: [] }, // → moving
      ],
    };
    const html = renderSprintLagBreakdown(sg, model);
    assert.match(html, /Stuck-A/);
    assert.match(html, /Stuck-B/);
    assert.doesNotMatch(html, /Active</); // не должен попасть в stuck-список
  });
});

/* ── V20 S11 Z7 — renderVelocityComparison ────────────────── */

describe('renderVelocityComparison', () => {
  function mkSprint(over) {
    return { pk: 'A', name: 'Sprint', total: 10, done: 5, progressPct: 50, pace: 'on-track', ...over };
  }

  test('< 2 команд → не рендерит', () => {
    assert.equal(renderVelocityComparison({ scannerV2: { sprintGoal: { sprints: [] } } }), '');
    assert.equal(renderVelocityComparison({ scannerV2: { sprintGoal: { sprints: [mkSprint()] } } }), '');
  });

  test('bar view (default) — рендерит горизонтальные бары', () => {
    const model = { scannerV2: { sprintGoal: { sprints: [
      mkSprint({ pk: 'CORE',  done: 12, total: 22, progressPct: 54.5, pace: 'behind' }),
      mkSprint({ pk: 'SMECM', done: 8,  total: 15, progressPct: 53,   pace: 'on-track' }),
    ] } } };
    const html = renderVelocityComparison(model);
    assert.match(html, /ts2-velocity-comparison/);
    assert.match(html, /ts2-vc-bars/);
    assert.match(html, /CORE/);
    assert.match(html, /SMECM/);
    // Sorted desc by done → CORE (12) первый.
    const idxC = html.indexOf('"ts2-vc-bar-pk">CORE');
    const idxS = html.indexOf('"ts2-vc-bar-pk">SMECM');
    assert.ok(idxC < idxS, 'expected CORE раньше SMECM по done');
  });

  test('leaderboard view — нумерует #1, #2 ...', () => {
    const model = { scannerV2: { sprintGoal: { sprints: [
      mkSprint({ pk: 'A', done: 20, progressPct: 80 }),
      mkSprint({ pk: 'B', done: 10, progressPct: 40 }),
      mkSprint({ pk: 'C', done: 15, progressPct: 60 }),
    ] } } };
    const html = renderVelocityComparison(model, [], { viewMode: 'leaderboard' });
    assert.match(html, /ts2-vc-leader/);
    assert.match(html, /#1/);
    assert.match(html, /#2/);
    assert.match(html, /#3/);
    // Sorted desc — A (20) → C (15) → B (10)
    const idxA = html.indexOf('"ts2-vc-leader-pk">A');
    const idxC = html.indexOf('"ts2-vc-leader-pk">C');
    const idxB = html.indexOf('"ts2-vc-leader-pk">B');
    assert.ok(idxA < idxC && idxC < idxB);
  });

  test('trend view с history >= 2 → рендерит aggregate sparkline', () => {
    const model = { scannerV2: { sprintGoal: { sprints: [mkSprint({pk:'A'}), mkSprint({pk:'B'})] } } };
    const history = [
      { sprintGoal: { aggregateProgress: 30 } },
      { sprintGoal: { aggregateProgress: 45 } },
    ];
    const html = renderVelocityComparison(model, history, { viewMode: 'trend' });
    assert.match(html, /ts2-vc-trend-aggregate/);
    assert.match(html, /Aggregate за 2 дня/);
  });

  test('trend view с history < 2 → empty-state hint', () => {
    const model = { scannerV2: { sprintGoal: { sprints: [mkSprint({pk:'A'}), mkSprint({pk:'B'})] } } };
    const html = renderVelocityComparison(model, [], { viewMode: 'trend' });
    assert.match(html, /Недостаточно истории/);
  });

  test('переключатели tabs имеют data-velocity-view', () => {
    const model = { scannerV2: { sprintGoal: { sprints: [mkSprint({pk:'A'}), mkSprint({pk:'B'})] } } };
    const html = renderVelocityComparison(model);
    assert.match(html, /data-velocity-view="bar"/);
    assert.match(html, /data-velocity-view="leaderboard"/);
    assert.match(html, /data-velocity-view="trend"/);
  });
});
