'use strict';
/* ============================================================
   tests/unit/teamScanner2Config.test.js
   --
   V18.3 A1 — unit tests для per-team config layer.
   Покрывает:
     · loadTeamConfig / saveTeamConfig (localStorage round-trip)
     · getTeamThresholds (fallback to global default)
     · applyPreset / resetTeam
     · buildTeamThresholdsMap (для enrichment integration)
     · computeBlockers с per-pk teamThresholds (override)
   ============================================================ */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// localStorage shim для node:test (не browser).
const _store = new Map();
globalThis.localStorage = {
  getItem(k)   { return _store.has(k) ? _store.get(k) : null; },
  setItem(k,v) { _store.set(k, String(v)); },
  removeItem(k){ _store.delete(k); },
  clear()      { _store.clear(); },
};

const {
  loadTeamConfig, saveTeamConfig, getTeamThresholds, applyPreset,
  resetTeam, buildTeamThresholdsMap, PRESET_THRESHOLDS,
} = await import('../../integrations/teamScanner2Config.js');

const {
  computeBlockers, buildAssigneeIndex, DEFAULT_DWELL_THRESHOLDS,
} = await import('../../integrations/teamScanner2Enrichment.js');

describe('teamScanner2Config — basic API', () => {
  beforeEach(() => _store.clear());

  test('loadTeamConfig empty store → {}', () => {
    assert.deepEqual(loadTeamConfig(), {});
  });

  test('saveTeamConfig → loadTeamConfig round-trip', () => {
    saveTeamConfig({ ML: { mode: 'research', dwellHours: { codeReview: 24 } } });
    const cfg = loadTeamConfig();
    assert.equal(cfg.ML.mode, 'research');
    assert.equal(cfg.ML.dwellHours.codeReview, 24);
  });

  test('saveTeamConfig({}) clears prior data', () => {
    saveTeamConfig({ ML: { mode: 'research', dwellHours: { codeReview: 24 } } });
    saveTeamConfig({});
    assert.deepEqual(loadTeamConfig(), {});
  });

  test('corrupt JSON → loadTeamConfig returns {}', () => {
    localStorage.setItem('q2_scanner2_team_config', 'not-json');
    assert.deepEqual(loadTeamConfig(), {});
  });
});

describe('getTeamThresholds — fallback chain', () => {
  beforeEach(() => _store.clear());

  test('pk без config → fallback (global default)', () => {
    const t = getTeamThresholds('UNKNOWN');
    assert.deepEqual(t, DEFAULT_DWELL_THRESHOLDS);
  });

  test('pk с custom config → merged с fallback', () => {
    saveTeamConfig({ ML: { dwellHours: { codeReview: 32 } } });
    const t = getTeamThresholds('ML');
    assert.equal(t.codeReview, 32);     // override
    assert.equal(t.qa, DEFAULT_DWELL_THRESHOLDS.qa);  // fallback (16)
    assert.equal(t.inProgress, DEFAULT_DWELL_THRESHOLDS.inProgress);
  });

  test('null pk → fallback', () => {
    assert.deepEqual(getTeamThresholds(null), DEFAULT_DWELL_THRESHOLDS);
    assert.deepEqual(getTeamThresholds(''), DEFAULT_DWELL_THRESHOLDS);
  });
});

describe('PRESET_THRESHOLDS — Olga ML use case', () => {
  test('research preset долгие пороги (CR 24, IP 96)', () => {
    const r = PRESET_THRESHOLDS.research;
    assert.ok(r.codeReview >= 16, 'CR должен быть >=16 для research');
    assert.ok(r.inProgress >= 72, 'IP длинный для ML-research');
  });

  test('hotfix preset быстрые пороги (CR 4, IP 12)', () => {
    const h = PRESET_THRESHOLDS.hotfix;
    assert.ok(h.codeReview <= 8, 'CR ≤ 8 для hotfix urgency');
    assert.ok(h.inProgress <= 24, 'IP ≤ 24 для hotfix');
  });

  test('default preset = DEFAULT_DWELL_THRESHOLDS', () => {
    assert.deepEqual(PRESET_THRESHOLDS.default, DEFAULT_DWELL_THRESHOLDS);
  });
});

describe('applyPreset / resetTeam', () => {
  beforeEach(() => _store.clear());

  test('applyPreset stores mode + dwellHours', () => {
    applyPreset('ML', 'research');
    const cfg = loadTeamConfig();
    assert.equal(cfg.ML.mode, 'research');
    assert.equal(cfg.ML.dwellHours.codeReview, PRESET_THRESHOLDS.research.codeReview);
  });

  test('resetTeam удаляет pk из config', () => {
    applyPreset('ML', 'research');
    resetTeam('ML');
    const cfg = loadTeamConfig();
    assert.equal(cfg.ML, undefined);
  });

  test('applyPreset с unknown preset → falls back to default', () => {
    applyPreset('ML', 'nonexistent');
    const cfg = loadTeamConfig();
    assert.equal(cfg.ML.mode, 'nonexistent');   // mode сохраняется как label
    assert.equal(cfg.ML.dwellHours.codeReview, PRESET_THRESHOLDS.default.codeReview);
  });
});

describe('buildTeamThresholdsMap для enrichment', () => {
  beforeEach(() => _store.clear());

  test('пустой config → {}', () => {
    assert.deepEqual(buildTeamThresholdsMap(), {});
  });

  test('config со 2 pk → 2 keys в map', () => {
    applyPreset('ML', 'research');
    applyPreset('SRE', 'hotfix');
    const m = buildTeamThresholdsMap();
    assert.ok(m.ML);
    assert.ok(m.SRE);
    assert.equal(m.ML.codeReview, PRESET_THRESHOLDS.research.codeReview);
    assert.equal(m.SRE.codeReview, PRESET_THRESHOLDS.hotfix.codeReview);
  });

  test('partial dwellHours override merged с default', () => {
    saveTeamConfig({ TEAM: { mode: 'custom', dwellHours: { codeReview: 36 } } });
    const m = buildTeamThresholdsMap();
    assert.equal(m.TEAM.codeReview, 36);
    assert.equal(m.TEAM.qa, DEFAULT_DWELL_THRESHOLDS.qa);
  });
});

describe('computeBlockers с per-pk teamThresholds (V18.3 A1)', () => {
  function makeRaw(...issues) { return { reports: [{ issues }] }; }
  function issue(opts) {
    return {
      key: opts.key,
      fields: {
        summary: opts.summary || '',
        status: { name: opts.status, statusCategory: { key: 'indeterminate' } },
        assignee: { accountId: 'u1' },
        created: '2026-04-01T00:00:00Z',
      },
      changelog: { histories: [{ created: opts.changedAtIso, items: [{ field: 'status' }] }] },
    };
  }

  test('global default только → CR > 8ч → blocker', () => {
    const t10h = new Date(Date.now() - 10 * 3600 * 1000).toISOString();
    const raw = makeRaw(issue({ key: 'ML-1', status: 'Code Review', changedAtIso: t10h }));
    const idx = buildAssigneeIndex(raw);
    const out = computeBlockers({ jiraAccountId: 'u1' }, idx, DEFAULT_DWELL_THRESHOLDS);
    assert.equal(out.length, 1);
    assert.equal(out[0].thresholdHours, 8);
    assert.equal(out[0].pk, 'ML');
  });

  test('per-pk override (ML→24h CR) → CR 10ч НЕ blocker', () => {
    const t10h = new Date(Date.now() - 10 * 3600 * 1000).toISOString();
    const raw = makeRaw(issue({ key: 'ML-1', status: 'Code Review', changedAtIso: t10h }));
    const idx = buildAssigneeIndex(raw);
    const teamThresholds = { ML: { ...DEFAULT_DWELL_THRESHOLDS, codeReview: 24 } };
    const out = computeBlockers({ jiraAccountId: 'u1' }, idx, DEFAULT_DWELL_THRESHOLDS, teamThresholds);
    assert.equal(out.length, 0, 'ML-team override 24ч не пускает 10ч в blockers');
  });

  test('per-pk override применяется ТОЛЬКО к нужной pk', () => {
    const t10h = new Date(Date.now() - 10 * 3600 * 1000).toISOString();
    const raw = makeRaw(
      issue({ key: 'ML-1',  status: 'Code Review', changedAtIso: t10h }),
      issue({ key: 'BACK-1', status: 'Code Review', changedAtIso: t10h }),
    );
    const idx = buildAssigneeIndex(raw);
    const teamThresholds = { ML: { ...DEFAULT_DWELL_THRESHOLDS, codeReview: 24 } };
    const out = computeBlockers({ jiraAccountId: 'u1' }, idx, DEFAULT_DWELL_THRESHOLDS, teamThresholds);
    // BACK не имеет override → CR 8ч глобал → 10ч blocker
    assert.equal(out.length, 1);
    assert.equal(out[0].pk, 'BACK');
  });

  test('blockers содержат pk поле (V18.3 A1)', () => {
    const t100h = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
    const raw = makeRaw(issue({ key: 'XYZ-99', status: 'In Progress', changedAtIso: t100h }));
    const idx = buildAssigneeIndex(raw);
    const out = computeBlockers({ jiraAccountId: 'u1' }, idx, DEFAULT_DWELL_THRESHOLDS);
    assert.equal(out.length, 1);
    assert.equal(out[0].pk, 'XYZ');
  });
});
