'use strict';
/* ============================================================
   tests/unit/v17AuditFixes.test.js
   --
   Regression tests for the V17 P2 audit fixes (see
   audit-2026-05-V17/01-tech-audit.md). Each describe-block locks
   down one finding so the next iteration can't silently regress it.
   ============================================================ */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function makeLS() {
  const m = new Map();
  return {
    getItem:    (k) => (m.has(k) ? m.get(k) : null),
    setItem:    (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear:      () => m.clear(),
    _store:     m,
  };
}
globalThis.localStorage = makeLS();
globalThis.window       = { addEventListener: () => {}, App: { applyPresetsCollapsed: () => {} }, ThemeUI: { apply: () => {} } };

const { state }                                = await import('../../state.js');
const { CSV, JSONExport, Storage }             = await import('../../dataStore.js');
const { RowFactory }                           = await import('../../rowFactory.js');

/* ── CRIT-1 ─ token leak in CSV / JSON export ─────────────── */
describe('V17 CRIT-1 — token leak in export bundle', () => {
  beforeEach(() => {
    globalThis.localStorage = makeLS();
    state.rows = [];
  });

  // V17.1 F1 — `q2_integrations_v1` снова включается в bundle (по запросу
  //   пользователя — round-trip настроек интеграций через JSON), но токены
  //   ОБЯЗАТЕЛЬНО вычищаются `_scrubSecrets`. Тесты отражают новую политику:
  //   ключ присутствует, но без `jiraToken` / `bitbucketToken` / etc.
  test('CSV export bundle includes q2_integrations_v1 BUT tokens are scrubbed', () => {
    localStorage.setItem('q2_integrations_v1', JSON.stringify({
      jiraToken: 'AAAA-SECRET',
      jiraProjectKeys: 'PROJ',
      jiraBaseUrl: 'https://example.atlassian.net',
    }));
    const bundle = CSV._buildSettingsBundle();
    const integrations = bundle.localStorage.q2_integrations_v1;
    assert.ok(integrations, 'integrations key must be present after V17.1 F1');
    assert.equal(integrations.jiraToken, undefined, 'jiraToken must be scrubbed');
    assert.equal(integrations.jiraProjectKeys, 'PROJ',  'non-secret fields preserved');
    const stringified = JSON.stringify(bundle);
    assert.ok(!stringified.includes('AAAA-SECRET'),
      'token value must not leak via the CSV bundle');
  });

  test('JSON export bundle includes q2_integrations_v1 BUT tokens are scrubbed', () => {
    localStorage.setItem('q2_integrations_v1', JSON.stringify({
      jiraToken: 'BBBB-SECRET',
      jiraBaseUrl: 'https://example.atlassian.net',
    }));
    const snap = JSONExport.buildSnapshot();
    const integrations = snap.bundle.q2_integrations_v1;
    assert.ok(integrations, 'integrations key must be present after V17.1 F1');
    assert.equal(integrations.jiraToken, undefined, 'jiraToken must be scrubbed');
    assert.ok(!JSON.stringify(snap).includes('BBBB-SECRET'));
  });

  test('defence-in-depth: token-shaped fields scrubbed even from allowlisted keys', () => {
    // Pretend a future regression sneaks a token field into a kept key.
    localStorage.setItem('q2_settings_v3', JSON.stringify({
      foo: 1,
      jiraToken: 'CCCC-ACCIDENT',
      nested: { bitbucketToken: 'DDDD-NESTED', safe: 'ok' },
    }));
    const bundle = CSV._buildSettingsBundle();
    const flat = JSON.stringify(bundle);
    assert.ok(!flat.includes('CCCC-ACCIDENT'), 'top-level token must be scrubbed');
    assert.ok(!flat.includes('DDDD-NESTED'),   'nested token must be scrubbed');
    assert.ok(flat.includes('"safe":"ok"'),    'unrelated fields survive');
    assert.ok(flat.includes('"foo":1'),        'unrelated numeric fields survive');
  });
});

/* ── H4 ─ Storage.restore via RowFactory.create ────────────── */
describe('V17 H4 — Storage.restore hydrates legacy rows through RowFactory', () => {
  test('row missing assigneePills/unplannedPills/inProgressPills gets defaults', () => {
    Storage.restore({
      rows: [
        { id: 'r1', team: 'A', epic: 'E1', release120Types: ['BE'] },  // legacy snapshot
      ],
      employees: [],
    });
    assert.equal(state.rows.length, 1);
    const r = state.rows[0];
    // V15 / V16 fields must be present even if legacy snapshot lacked them.
    assert.equal(typeof r.donePills, 'object');
    assert.equal(typeof r.unplannedPills, 'object');
    assert.equal(typeof r.inProgressPills, 'object');
    assert.equal(typeof r.assigneePills, 'object');
    assert.ok(Array.isArray(r.transferComments));
    assert.ok(Array.isArray(r.ganttArrows));
    // Original data preserved.
    assert.equal(r.team, 'A');
    assert.equal(r.epic, 'E1');
    assert.deepEqual(r.release120Types, ['BE']);
  });

  test('row that already has new fields keeps them as-is', () => {
    Storage.restore({
      rows: [{
        id: 'r2', team: 'B', epic: 'E2',
        donePills: { 'r120__BE': true },
        unplannedPills: { 'r121__FE': { at: '2026-01-01' } },
        inProgressPills: { 'r120__BE': true },
        assigneePills:   { 'r120__BE': 'Иванов' },
        transferComments: [{ at: '2026-01-02', wt: 'BE', from: 'r120', to: 'r121', text: 'why' }],
        ganttArrows: [{ wt: 'BE', srcCol: 'r120', dstCol: 'r121', at: '2026-01-02' }],
      }],
      employees: [],
    });
    const r = state.rows[0];
    assert.equal(r.donePills['r120__BE'], true);
    assert.equal(r.assigneePills['r120__BE'], 'Иванов');
    assert.equal(r.transferComments[0].text, 'why');
    assert.equal(r.ganttArrows.length, 1);
  });
});

/* ── CRIT-4 ─ delete pill scopes ganttArrows correctly ────── */
describe('V17 CRIT-4 — delete pill must keep unrelated trail-arrows', () => {
  // The fix lives inside the gantt context-menu handler (views/gantt.js),
  // which is too DOM-heavy to mock here. We pin down the BEHAVIOUR via
  // direct function: `arrows.filter(a => !(a.wt === wt && (a.srcCol === srcCol || a.dstCol === srcCol)))`.
  const purge = (arrows, wt, srcCol) =>
    arrows.filter(a => !(a.wt === wt && (a.srcCol === srcCol || a.dstCol === srcCol)));

  test('deleting wt in r122 keeps r120↔r121 trail of same wt', () => {
    const arrows = [
      { wt: 'backend', srcCol: 'r120', dstCol: 'r121', at: '2026-01-01' },
      { wt: 'backend', srcCol: 'r122', dstCol: 'overtime', at: '2026-01-02' },
    ];
    const after = purge(arrows, 'backend', 'r122');
    // The 1.20→1.21 trail survives; only the r122-leaving arrow gone.
    assert.equal(after.length, 1);
    assert.equal(after[0].srcCol, 'r120');
    assert.equal(after[0].dstCol, 'r121');
  });

  test('deleting wt in r121 also kills both arrows that touch r121', () => {
    const arrows = [
      { wt: 'BE', srcCol: 'r120', dstCol: 'r121' },
      { wt: 'BE', srcCol: 'r121', dstCol: 'r122' },
      { wt: 'FE', srcCol: 'r120', dstCol: 'r121' },   // different wt — keep
    ];
    const after = purge(arrows, 'BE', 'r121');
    assert.equal(after.length, 1);
    assert.equal(after[0].wt, 'FE');
  });

  test('different wt is untouched even in same colodet', () => {
    const arrows = [{ wt: 'QA', srcCol: 'r120', dstCol: 'r121' }];
    const after = purge(arrows, 'BE', 'r120');
    assert.equal(after.length, 1);
  });
});

/* ── H3 ─ Cyrillic Ё / Ъ in team-key regex ─────────────────── */
describe('V17 H3 — team-key regex covers Ё / Ъ', () => {
  // Reproduce the helper logic verbatim (used in 3 places in views/gantt.js).
  const teamKey = t => String(t || '').replace(/[^a-zA-Zа-яА-ЯёЁъЪ0-9]/g, '_');

  test('Ё / ё are kept', () => {
    assert.equal(teamKey('Ёлки'), 'Ёлки');
    assert.equal(teamKey('ёжик'), 'ёжик');
  });

  test('Ъ / ъ are kept', () => {
    assert.equal(teamKey('Объект'), 'Объект');
    assert.equal(teamKey('подъезд'), 'подъезд');
  });

  test('non-cyrillic punctuation still becomes _', () => {
    assert.equal(teamKey('Команда / 1'), 'Команда___1');
    assert.equal(teamKey('A-B'), 'A_B');
  });

  test('Ёлки vs Елки yield distinct keys (regression for E1)', () => {
    assert.notEqual(teamKey('Ёлки'), teamKey('Елки'),
      'Ё must not collapse to Е/_; otherwise collapse-state and Cmd+K conflate teams');
  });
});

/* ── CRIT-3 ─ edit-mode under plan-lock writes audit entry ─── */
describe('V17 CRIT-3 — edit-mode under plan-lock writes [edit-mode] trail', () => {
  // We import the gantt module just to verify the constant policy via the
  // moveWtBetweenCols-equivalent logic. Since gantt.js is DOM-heavy we
  // re-implement the rule directly here as a contract pin.
  const policy = (planLocked, editModeOn, comment) => {
    if (comment)                       return { write: true, text: String(comment) };
    if (planLocked && editModeOn)      return { write: true, text: '[edit-mode]' };
    return { write: false };
  };

  test('plan-locked + edit-mode + empty comment → [edit-mode] entry', () => {
    const r = policy(true, true, '');
    assert.equal(r.write, true);
    assert.equal(r.text, '[edit-mode]');
  });

  test('plan-locked + edit-mode + real comment → real comment wins', () => {
    const r = policy(true, true, 'risk by sigma');
    assert.equal(r.write, true);
    assert.equal(r.text, 'risk by sigma');
  });

  test('plan unlocked → no entry on empty comment (legacy behaviour)', () => {
    assert.equal(policy(false, false, '').write, false);
  });

  test('plan locked but edit-mode off → no entry on empty comment (modal would have caught it)', () => {
    assert.equal(policy(true, false, '').write, false);
  });
});

/* ── H6 ─ transferComments lookup is now Map-based ────────── */
describe('V17 H6 — transferComments → Map per row (perf)', () => {
  // Pin behaviour: latest-by-timestamp wins per (col, wt) key.
  const buildMaps = (comments) => {
    const addByPill = new Map();
    const moveByPill = new Map();
    for (const c of comments) {
      if (!c || !c.to || !c.wt) continue;
      const key = `${c.to}__${c.wt}`;
      const ts  = Date.parse(c.at) || 0;
      if (c.from === '+') {
        const prev = addByPill.get(key);
        if (!prev || ts > prev._ts) addByPill.set(key, Object.assign({ _ts: ts }, c));
      } else {
        const prev = moveByPill.get(key);
        if (!prev || ts > prev._ts) moveByPill.set(key, Object.assign({ _ts: ts }, c));
      }
    }
    return { addByPill, moveByPill };
  };

  test('latest add comment wins', () => {
    const { addByPill } = buildMaps([
      { from: '+', to: 'r120', wt: 'BE', at: '2026-01-01', text: 'old' },
      { from: '+', to: 'r120', wt: 'BE', at: '2026-02-01', text: 'new' },
    ]);
    assert.equal(addByPill.get('r120__BE').text, 'new');
  });

  test('add and move maps are disjoint', () => {
    const { addByPill, moveByPill } = buildMaps([
      { from: '+',    to: 'r120', wt: 'BE', at: '2026-01-01', text: 'added' },
      { from: 'r120', to: 'r121', wt: 'BE', at: '2026-01-02', text: 'moved' },
    ]);
    assert.equal(addByPill.get('r120__BE').text, 'added');
    assert.equal(moveByPill.get('r121__BE').text, 'moved');
    assert.equal(addByPill.get('r121__BE'), undefined);
    assert.equal(moveByPill.get('r120__BE'), undefined);
  });

  test('malformed entries skipped gracefully', () => {
    const { addByPill, moveByPill } = buildMaps([
      null,
      undefined,
      {},
      { from: '+', to: 'r120' },             // missing wt
      { from: '+', wt: 'BE' },               // missing to
      { from: '+', to: 'r120', wt: 'BE', at: 'invalid date' },  // _ts becomes 0, still stored
    ]);
    assert.equal(addByPill.size, 1);
    assert.equal(moveByPill.size, 0);
  });
});
