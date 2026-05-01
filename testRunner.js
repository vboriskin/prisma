'use strict';
/* ============================================================
   testRunner.js — v8_0 domain logic tests
   Run: node testRunner.js
   No npm required — uses Node.js built-in assert.
   ============================================================ */

const assert = require('assert');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ✓', name);
    passed++;
  } catch (e) {
    console.error('  ✗', name);
    console.error('    ', e.message);
    failed++;
  }
}

function group(label, fn) {
  console.log('\n' + label);
  fn();
}

// ============================================================
// Inline domain logic (mirrors v8_0 modules — no import needed)
// ============================================================

// ---- RiskEngine (mirrors riskEngine.js) ----
const RiskEngine = {
  computeFlags(row) {
    const flags = [];
    const inAny = row.hasRelease120 || row.hasRelease121 || row.hasRelease122 || row.hasOvertime;
    if (row.scopeStatus === 'Требует подтверждения' && inAny) flags.push('CONFIRMATION_IN_RELEASE');
    if (row.scopeStatus === 'Да' && row.isUnassigned) flags.push('IN_SCOPE_WITHOUT_RELEASE');
    if (row.blockingDependency && (row.hasRelease120 || row.hasRelease121)) flags.push('BLOCKING_NEAR_RELEASE');
    row.riskFlags = flags;
  },
  computeRiskScore(row) {
    let score = 0;
    if (row.blockingDependency) score += 30;
    if ((row.riskFlags || []).includes('IN_SCOPE_WITHOUT_RELEASE')) score += 25;
    if ((row.riskFlags || []).includes('CONFIRMATION_IN_RELEASE')) score += 20;
    if (row.hasRelease120) score += 15;
    if (row.scopeStatus === 'Требует подтверждения') score += 10;
    row.riskScore = Math.min(100, score);
    return row.riskScore;
  },
  computeAll(rows) {
    rows.forEach(r => { RiskEngine.computeFlags(r); RiskEngine.computeRiskScore(r); });
  },
};

function makeRow(overrides = {}) {
  return {
    id: 'r_' + Math.random().toString(36).slice(2),
    scopeStatus: '',
    blockingDependency: false,
    hasRelease120: false,
    hasRelease121: false,
    hasRelease122: false,
    hasOvertime: false,
    isUnassigned: true,
    riskFlags: [],
    riskScore: 0,
    isDone: false,
    release120Types: [],
    release121Types: [],
    release122Types: [],
    overtimeTypes: [],
    team: '',
    assignee: '',
    ...overrides,
  };
}

// ---- FilterEngine (mirrors filters.js core logic) ----
function applyFilters(rows, filters) {
  return rows.filter(r => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay = `${r.epic} ${r.team} ${r.tasks} ${r.assignee} ${r.comment || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filters.team && r.team !== filters.team) return false;
    if (filters.scope && r.scopeStatus !== filters.scope) return false;
    if (filters.release) {
      if (filters.release === 'none') { if (!r.isUnassigned) return false; }
      else if (filters.release === '120') { if (!r.hasRelease120) return false; }
      else if (filters.release === '121') { if (!r.hasRelease121) return false; }
      else if (filters.release === '122') { if (!r.hasRelease122) return false; }
      else if (filters.release === 'overtime') { if (!r.hasOvertime) return false; }
    }
    if (filters.onlyBlocking && !r.blockingDependency) return false;
    if (filters.onlyRisky && !(r.riskFlags && r.riskFlags.length > 0)) return false;
    if (filters.onlyDone && !r.isDone) return false;
    return true;
  });
}

// ---- DependencyEngine (mirrors dependencyEngine.js) ----
function detectCycle(epicDeps, from, visited = new Set()) {
  if (visited.has(from)) return true;
  visited.add(from);
  const to = epicDeps[from];
  if (!to) return false;
  return detectCycle(epicDeps, to, visited);
}

function getTransitiveDeps(epicDeps, from) {
  const chain = [];
  let cur = from;
  const seen = new Set();
  while (epicDeps[cur] && !seen.has(cur)) {
    seen.add(cur);
    cur = epicDeps[cur];
    chain.push(cur);
  }
  return chain;
}

// ---- MetricsEngine (mirrors metricsEngine.js) ----
function computeProgress(rows) {
  const releases = ['120', '121', '122', 'ot'];
  const result = {};
  releases.forEach(rel => {
    const key = rel === 'ot' ? 'hasOvertime' : `hasRelease${rel}`;
    const inRel = rows.filter(r => r[key]);
    const done = inRel.filter(r => r.isDone).length;
    result[rel] = { total: inRel.length, done, pct: inRel.length ? Math.round(done / inRel.length * 100) : 0 };
  });
  const total = rows.length;
  const done = rows.filter(r => r.isDone).length;
  result.all = { total, done, pct: total ? Math.round(done / total * 100) : 0 };
  return result;
}

function computeLoad(rows) {
  const load = {};
  rows.forEach(r => {
    const assignees = String(r.assignee || '').split(/[|,]/).map(s => s.trim()).filter(Boolean);
    assignees.forEach(name => {
      if (!load[name]) load[name] = { total: 0, r120: 0, r121: 0, r122: 0, ot: 0 };
      load[name].total++;
      if (r.hasRelease120) load[name].r120++;
      if (r.hasRelease121) load[name].r121++;
      if (r.hasRelease122) load[name].r122++;
      if (r.hasOvertime) load[name].ot++;
    });
  });
  return load;
}

// ---- toBool (mirrors state.js) ----
function toBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'да'].includes(v)) return true;
    if (['false', '0', 'no', 'off', 'нет', ''].includes(v)) return false;
  }
  return !!fallback;
}

// ============================================================
// Tests
// ============================================================

group('RiskEngine — computeFlags', () => {
  test('no flags on empty row', () => {
    const r = makeRow();
    RiskEngine.computeFlags(r);
    assert.deepStrictEqual(r.riskFlags, []);
  });

  test('BLOCKING_NEAR_RELEASE when blocker in 1.20', () => {
    const r = makeRow({ blockingDependency: true, hasRelease120: true, isUnassigned: false });
    RiskEngine.computeFlags(r);
    assert.ok(r.riskFlags.includes('BLOCKING_NEAR_RELEASE'));
  });

  test('BLOCKING_NEAR_RELEASE when blocker in 1.21', () => {
    const r = makeRow({ blockingDependency: true, hasRelease121: true, isUnassigned: false });
    RiskEngine.computeFlags(r);
    assert.ok(r.riskFlags.includes('BLOCKING_NEAR_RELEASE'));
  });

  test('no BLOCKING_NEAR_RELEASE for 1.22 blocker (not near)', () => {
    const r = makeRow({ blockingDependency: true, hasRelease122: true, isUnassigned: false });
    RiskEngine.computeFlags(r);
    assert.ok(!r.riskFlags.includes('BLOCKING_NEAR_RELEASE'));
  });

  test('IN_SCOPE_WITHOUT_RELEASE when scope=Да and unassigned', () => {
    const r = makeRow({ scopeStatus: 'Да', isUnassigned: true });
    RiskEngine.computeFlags(r);
    assert.ok(r.riskFlags.includes('IN_SCOPE_WITHOUT_RELEASE'));
  });

  test('no IN_SCOPE_WITHOUT_RELEASE when scope=Да but has release', () => {
    const r = makeRow({ scopeStatus: 'Да', isUnassigned: false, hasRelease120: true });
    RiskEngine.computeFlags(r);
    assert.ok(!r.riskFlags.includes('IN_SCOPE_WITHOUT_RELEASE'));
  });

  test('CONFIRMATION_IN_RELEASE when needs confirm and in release', () => {
    const r = makeRow({ scopeStatus: 'Требует подтверждения', hasRelease121: true, isUnassigned: false });
    RiskEngine.computeFlags(r);
    assert.ok(r.riskFlags.includes('CONFIRMATION_IN_RELEASE'));
  });

  test('no CONFIRMATION_IN_RELEASE when unassigned', () => {
    const r = makeRow({ scopeStatus: 'Требует подтверждения', isUnassigned: true });
    RiskEngine.computeFlags(r);
    assert.ok(!r.riskFlags.includes('CONFIRMATION_IN_RELEASE'));
  });

  test('multiple flags can coexist', () => {
    const r = makeRow({
      scopeStatus: 'Требует подтверждения',
      blockingDependency: true,
      hasRelease120: true,
      isUnassigned: false,
    });
    RiskEngine.computeFlags(r);
    assert.ok(r.riskFlags.includes('CONFIRMATION_IN_RELEASE'));
    assert.ok(r.riskFlags.includes('BLOCKING_NEAR_RELEASE'));
  });
});

group('RiskEngine — computeRiskScore', () => {
  test('score 0 for clean row', () => {
    const r = makeRow();
    RiskEngine.computeFlags(r);
    RiskEngine.computeRiskScore(r);
    assert.strictEqual(r.riskScore, 0);
  });

  test('blocking adds 30 points', () => {
    const r = makeRow({ blockingDependency: true, hasRelease122: true, isUnassigned: false });
    RiskEngine.computeFlags(r);
    RiskEngine.computeRiskScore(r);
    assert.ok(r.riskScore >= 30);
  });

  test('IN_SCOPE_WITHOUT_RELEASE adds 25 points', () => {
    const r = makeRow({ scopeStatus: 'Да', isUnassigned: true });
    RiskEngine.computeFlags(r);
    RiskEngine.computeRiskScore(r);
    assert.ok(r.riskScore >= 25);
  });

  test('score capped at 100', () => {
    const r = makeRow({
      blockingDependency: true,
      scopeStatus: 'Да',
      isUnassigned: true,
      hasRelease120: true,
    });
    RiskEngine.computeFlags(r);
    RiskEngine.computeRiskScore(r);
    assert.ok(r.riskScore <= 100);
  });

  test('hasRelease120 adds 15 to score', () => {
    const r = makeRow({ hasRelease120: true, isUnassigned: false, scopeStatus: 'Нет' });
    RiskEngine.computeFlags(r);
    const score = RiskEngine.computeRiskScore(r);
    assert.ok(score >= 15);
  });

  test('computeAll processes every row', () => {
    const rows = [
      makeRow({ blockingDependency: true, hasRelease120: true, isUnassigned: false }),
      makeRow({ scopeStatus: 'Да', isUnassigned: true }),
      makeRow(),
    ];
    RiskEngine.computeAll(rows);
    assert.ok(rows[0].riskScore > 0);
    assert.ok(rows[1].riskScore > 0);
    assert.strictEqual(rows[2].riskScore, 0);
  });
});

group('FilterEngine — applyFilters', () => {
  const rows = [
    makeRow({ team: 'Alpha', scopeStatus: 'Да', blockingDependency: true, hasRelease120: true, isUnassigned: false, epic: 'Оплата', assignee: 'Иван', riskFlags: ['BLOCKING_NEAR_RELEASE'] }),
    makeRow({ team: 'Beta',  scopeStatus: 'Нет', blockingDependency: false, isUnassigned: true, epic: 'Отчёты', assignee: 'Мария', riskFlags: [] }),
    makeRow({ team: 'Alpha', scopeStatus: 'Требует подтверждения', blockingDependency: false, hasRelease121: true, isUnassigned: false, epic: 'Интеграция', isDone: true, riskFlags: [] }),
  ];

  test('no filters returns all rows', () => {
    const result = applyFilters(rows, {});
    assert.strictEqual(result.length, 3);
  });

  test('filter by team', () => {
    const result = applyFilters(rows, { team: 'Alpha' });
    assert.strictEqual(result.length, 2);
    assert.ok(result.every(r => r.team === 'Alpha'));
  });

  test('filter by scope=Да', () => {
    const result = applyFilters(rows, { scope: 'Да' });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].scopeStatus, 'Да');
  });

  test('onlyBlocking filter', () => {
    const result = applyFilters(rows, { onlyBlocking: true });
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].blockingDependency);
  });

  test('onlyDone filter', () => {
    const result = applyFilters(rows, { onlyDone: true });
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].isDone);
  });

  test('onlyRisky filter', () => {
    const result = applyFilters(rows, { onlyRisky: true });
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].riskFlags.length > 0);
  });

  test('release=none returns unassigned rows', () => {
    const result = applyFilters(rows, { release: 'none' });
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].isUnassigned);
  });

  test('release=120 returns rows with 1.20', () => {
    const result = applyFilters(rows, { release: '120' });
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].hasRelease120);
  });

  test('search by epic text', () => {
    const result = applyFilters(rows, { search: 'оплата' });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].epic, 'Оплата');
  });

  test('search is case-insensitive', () => {
    const result = applyFilters(rows, { search: 'ОТЧЁТЫ' });
    assert.strictEqual(result.length, 1);
  });

  test('combined filters AND together', () => {
    const result = applyFilters(rows, { team: 'Alpha', onlyBlocking: true });
    assert.strictEqual(result.length, 1);
  });

  test('no match returns empty array', () => {
    const result = applyFilters(rows, { team: 'Gamma' });
    assert.strictEqual(result.length, 0);
  });
});

group('DependencyEngine — cycle detection', () => {
  test('no cycle in simple chain A→B→C', () => {
    const deps = { A: 'B', B: 'C' };
    assert.strictEqual(detectCycle(deps, 'A'), false);
  });

  test('detects self-loop A→A', () => {
    const deps = { A: 'A' };
    assert.strictEqual(detectCycle(deps, 'A'), true);
  });

  test('detects cycle A→B→A', () => {
    const deps = { A: 'B', B: 'A' };
    assert.strictEqual(detectCycle(deps, 'A'), true);
  });

  test('detects cycle in longer chain A→B→C→A', () => {
    const deps = { A: 'B', B: 'C', C: 'A' };
    assert.strictEqual(detectCycle(deps, 'A'), true);
  });

  test('no cycle when chain ends at undefined', () => {
    const deps = { A: 'B' };
    assert.strictEqual(detectCycle(deps, 'A'), false);
  });

  test('getTransitiveDeps returns full chain', () => {
    const deps = { A: 'B', B: 'C' };
    const chain = getTransitiveDeps(deps, 'A');
    assert.deepStrictEqual(chain, ['B', 'C']);
  });

  test('getTransitiveDeps stops at cycle', () => {
    const deps = { A: 'B', B: 'C', C: 'A' };
    const chain = getTransitiveDeps(deps, 'A');
    assert.ok(chain.length < 10); // doesn't loop infinitely
  });

  test('getTransitiveDeps empty for node with no dep', () => {
    const chain = getTransitiveDeps({}, 'X');
    assert.deepStrictEqual(chain, []);
  });
});

group('MetricsEngine — computeProgress', () => {
  test('empty rows gives zero totals', () => {
    const prog = computeProgress([]);
    assert.strictEqual(prog.all.total, 0);
    assert.strictEqual(prog.all.done, 0);
    assert.strictEqual(prog.all.pct, 0);
  });

  test('counts total rows correctly', () => {
    const rows = [makeRow(), makeRow(), makeRow()];
    const prog = computeProgress(rows);
    assert.strictEqual(prog.all.total, 3);
  });

  test('counts done rows correctly', () => {
    const rows = [makeRow({ isDone: true }), makeRow(), makeRow({ isDone: true })];
    const prog = computeProgress(rows);
    assert.strictEqual(prog.all.done, 2);
    assert.strictEqual(prog.all.pct, 67);
  });

  test('release 1.20 progress isolated', () => {
    const rows = [
      makeRow({ hasRelease120: true, isDone: true }),
      makeRow({ hasRelease120: true, isDone: false }),
      makeRow({ hasRelease121: true, isDone: true }),
    ];
    const prog = computeProgress(rows);
    assert.strictEqual(prog['120'].total, 2);
    assert.strictEqual(prog['120'].done, 1);
    assert.strictEqual(prog['120'].pct, 50);
  });

  test('overtime (ot) uses hasOvertime key', () => {
    const rows = [
      makeRow({ hasOvertime: true, isDone: false }),
      makeRow({ hasOvertime: true, isDone: true }),
    ];
    const prog = computeProgress(rows);
    assert.strictEqual(prog.ot.total, 2);
    assert.strictEqual(prog.ot.done, 1);
  });

  test('100% pct when all done', () => {
    const rows = [makeRow({ hasRelease122: true, isDone: true }), makeRow({ hasRelease122: true, isDone: true })];
    const prog = computeProgress(rows);
    assert.strictEqual(prog['122'].pct, 100);
  });
});

group('MetricsEngine — computeLoad', () => {
  test('single assignee counted', () => {
    const rows = [makeRow({ assignee: 'Иван', hasRelease120: true })];
    const load = computeLoad(rows);
    assert.strictEqual(load['Иван'].total, 1);
    assert.strictEqual(load['Иван'].r120, 1);
  });

  test('pipe-separated assignees both counted', () => {
    const rows = [makeRow({ assignee: 'Иван|Мария', hasRelease121: true })];
    const load = computeLoad(rows);
    assert.strictEqual(load['Иван'].total, 1);
    assert.strictEqual(load['Мария'].total, 1);
    assert.strictEqual(load['Иван'].r121, 1);
  });

  test('comma-separated assignees both counted', () => {
    const rows = [makeRow({ assignee: 'Иван,Мария' })];
    const load = computeLoad(rows);
    assert.ok(load['Иван']);
    assert.ok(load['Мария']);
  });

  test('empty assignee ignored', () => {
    const rows = [makeRow({ assignee: '' })];
    const load = computeLoad(rows);
    assert.strictEqual(Object.keys(load).length, 0);
  });
});

group('toBool — state.js utility', () => {
  test('true stays true', () => assert.strictEqual(toBool(true), true));
  test('false stays false', () => assert.strictEqual(toBool(false), false));
  test('"true" string', () => assert.strictEqual(toBool('true'), true));
  test('"1" string', () => assert.strictEqual(toBool('1'), true));
  test('"да" string', () => assert.strictEqual(toBool('да'), true));
  test('"false" string', () => assert.strictEqual(toBool('false'), false));
  test('"0" string', () => assert.strictEqual(toBool('0'), false));
  test('"нет" string', () => assert.strictEqual(toBool('нет'), false));
  test('0 number is false', () => assert.strictEqual(toBool(0), false));
  test('1 number is true', () => assert.strictEqual(toBool(1), true));
  test('null uses fallback', () => assert.strictEqual(toBool(null, true), true));
  test('undefined uses fallback false', () => assert.strictEqual(toBool(undefined, false), false));
});

// ============================================================
// FilterEngine — pure filter function (mirrors filters.js)
// ============================================================
function makeFilterRow(over = {}) {
  return {
    id: '_t', team: '', category: '', epic: '', tasks: '', taskComment: '', tags: '',
    role: '', assignee: '', comment: '',
    scopeStatus: '', release120Types: [], release121Types: [], release122Types: [],
    overtimeTypes: [], hasRelease120: false, hasRelease121: false, hasRelease122: false,
    hasOvertime: false, isUnassigned: true, isDone: false, riskFlags: [],
    blockingDependency: false,
    ...over,
  };
}
const FilterEngineMirror = {
  filter(rows, f) {
    return rows.filter(row => {
      if (f.search) {
        const q = f.search.toLowerCase();
        if (![row.team,row.category,row.tags,row.epic,row.tasks,row.taskComment,row.comment,row.role,row.assignee].join(' ').toLowerCase().includes(q)) return false;
      }
      if (f.team && row.team !== f.team) return false;
      if (f.scope && row.scopeStatus !== f.scope) return false;
      if (f.release) {
        if (f.release === '1.20' && !row.hasRelease120) return false;
        if (f.release === '1.21' && !row.hasRelease121) return false;
        if (f.release === '1.22' && !row.hasRelease122) return false;
        if (f.release === 'overtime' && !row.hasOvertime) return false;
        if (f.release === 'none' && !row.isUnassigned) return false;
      }
      if (f.workType) {
        const all = [...row.release120Types,...row.release121Types,...row.release122Types,...row.overtimeTypes];
        if (!all.includes(f.workType)) return false;
      }
      if (f.onlyBlocking && !row.blockingDependency) return false;
      if (f.onlyRisky && (!row.riskFlags || !row.riskFlags.length)) return false;
      if (f.onlyDone && !row.isDone) return false;
      return true;
    });
  },
};

group('FilterEngine.filter — search', () => {
  const rows = [
    makeRow({ id:'1', team:'Backend',  epic:'Auth' }),
    makeRow({ id:'2', team:'Frontend', epic:'Profile' }),
    makeRow({ id:'3', team:'QA',       comment:'critical bug' }),
  ];
  test('empty search returns all', () => assert.strictEqual(FilterEngineMirror.filter(rows, {}).length, 3));
  test('search by team substring', () => {
    const r = FilterEngineMirror.filter(rows, { search: 'back' });
    assert.strictEqual(r.length, 1); assert.strictEqual(r[0].id, '1');
  });
  test('search across multiple fields', () => {
    const r = FilterEngineMirror.filter(rows, { search: 'critical' });
    assert.strictEqual(r.length, 1); assert.strictEqual(r[0].id, '3');
  });
  test('search is case-insensitive', () => {
    const r = FilterEngineMirror.filter(rows, { search: 'PROFILE' });
    assert.strictEqual(r.length, 1); assert.strictEqual(r[0].id, '2');
  });
});

group('FilterEngine.filter — release', () => {
  const rows = [
    makeRow({ id:'1', hasRelease120:true,  isUnassigned:false }),
    makeRow({ id:'2', hasRelease121:true,  isUnassigned:false }),
    makeRow({ id:'3', hasOvertime:true,    isUnassigned:false }),
    makeRow({ id:'4' /* none — isUnassigned defaults true */ }),
  ];
  test('1.20 only', () => assert.deepStrictEqual(FilterEngineMirror.filter(rows, { release:'1.20' }).map(r=>r.id), ['1']));
  test('1.21 only', () => assert.deepStrictEqual(FilterEngineMirror.filter(rows, { release:'1.21' }).map(r=>r.id), ['2']));
  test('overtime only', () => assert.deepStrictEqual(FilterEngineMirror.filter(rows, { release:'overtime' }).map(r=>r.id), ['3']));
  test('none filter returns unassigned', () =>
    assert.deepStrictEqual(FilterEngineMirror.filter(rows, { release:'none' }).map(r=>r.id), ['4']));
});

group('FilterEngine.filter — toggles', () => {
  const rows = [
    makeRow({ id:'a', blockingDependency:true,  riskFlags:['BLOCKING_NEAR_RELEASE'], isDone:false }),
    makeRow({ id:'b', blockingDependency:false, riskFlags:[],                         isDone:true  }),
    makeRow({ id:'c', blockingDependency:false, riskFlags:['CONFIRMATION_IN_RELEASE'], isDone:false }),
  ];
  test('onlyBlocking', () => assert.deepStrictEqual(FilterEngineMirror.filter(rows, { onlyBlocking:true }).map(r=>r.id), ['a']));
  test('onlyRisky',    () => assert.deepStrictEqual(FilterEngineMirror.filter(rows, { onlyRisky:true    }).map(r=>r.id), ['a','c']));
  test('onlyDone',     () => assert.deepStrictEqual(FilterEngineMirror.filter(rows, { onlyDone:true     }).map(r=>r.id), ['b']));
  test('multiple toggles intersect', () =>
    assert.deepStrictEqual(FilterEngineMirror.filter(rows, { onlyBlocking:true, onlyRisky:true }).map(r=>r.id), ['a']));
});

group('FilterEngine.filter — workType across releases', () => {
  const rows = [
    makeRow({ id:'1', release120Types:['backend'] }),
    makeRow({ id:'2', release121Types:['frontend'] }),
    makeRow({ id:'3', overtimeTypes:['backend'] }),
    makeRow({ id:'4', release122Types:['аналитика'] }),
  ];
  test('backend matches r120 + ot', () => assert.deepStrictEqual(FilterEngineMirror.filter(rows, { workType:'backend' }).map(r=>r.id), ['1','3']));
  test('frontend matches r121',     () => assert.deepStrictEqual(FilterEngineMirror.filter(rows, { workType:'frontend' }).map(r=>r.id), ['2']));
  test('unknown workType empties', () => assert.strictEqual(FilterEngineMirror.filter(rows, { workType:'devops' }).length, 0));
});

// ============================================================
// MetricsEngine — release progress arithmetic
// ============================================================
function computeProgressV2(rows) {
  const out = { all: { total: 0, done: 0, pct: 0 } };
  const buckets = { 120: 'hasRelease120', 121: 'hasRelease121', 122: 'hasRelease122', ot: 'hasOvertime' };
  for (const k of Object.keys(buckets)) out[k] = { total: 0, done: 0, pct: 0 };
  for (const r of rows) {
    out.all.total++;
    if (r.isDone) out.all.done++;
    for (const k of Object.keys(buckets)) {
      if (r[buckets[k]]) {
        out[k].total++;
        if (r.isDone) out[k].done++;
      }
    }
  }
  for (const k of Object.keys(out)) out[k].pct = out[k].total ? Math.round(out[k].done / out[k].total * 100) : 0;
  return out;
}

group('MetricsEngine.computeProgress — counts', () => {
  const rows = [
    makeRow({ hasRelease120:true,  isDone:true  }),
    makeRow({ hasRelease120:true,  isDone:false }),
    makeRow({ hasRelease121:true,  isDone:true  }),
    makeRow({ hasOvertime:true,    isDone:false }),
  ];
  const p = computeProgressV2(rows);
  test('all.total = 4',  () => assert.strictEqual(p.all.total, 4));
  test('all.done = 2',   () => assert.strictEqual(p.all.done,  2));
  test('all.pct = 50',   () => assert.strictEqual(p.all.pct,   50));
  test('120.total = 2',  () => assert.strictEqual(p['120'].total, 2));
  test('120.done = 1',   () => assert.strictEqual(p['120'].done,  1));
  test('120.pct = 50',   () => assert.strictEqual(p['120'].pct,   50));
  test('121 single done = 100%', () => assert.strictEqual(p['121'].pct, 100));
  test('ot pct = 0',     () => assert.strictEqual(p.ot.pct,    0));
});

group('MetricsEngine.computeProgress — edge cases', () => {
  test('empty rows yields zeros', () => {
    const p = computeProgressV2([]);
    assert.strictEqual(p.all.total, 0);
    assert.strictEqual(p.all.pct,   0);
  });
  test('all done = 100%', () => {
    const rows = [makeRow({ hasRelease120:true, isDone:true }), makeRow({ hasRelease120:true, isDone:true })];
    assert.strictEqual(computeProgressV2(rows)['120'].pct, 100);
  });
  test('rounding ½ → 50', () => {
    const rows = [makeRow({ isDone:true }), makeRow({ isDone:false })];
    assert.strictEqual(computeProgressV2(rows).all.pct, 50);
  });
  test('rounding ⅓ → 33', () => {
    const rows = [makeRow({ isDone:true }), makeRow({ isDone:false }), makeRow({ isDone:false })];
    assert.strictEqual(computeProgressV2(rows).all.pct, 33);
  });
});

// ============================================================
// safeHtml — escape semantics + composability
// (mirrors libs/safeHtml.js — kept inline so testRunner stays standalone)
// ============================================================
// Inline mirror so testRunner doesn't need ESM imports.
const _ESC = { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' };
function _esc(v){ return String(v==null?'':v).replace(/[&<>"']/g, c => _ESC[c]); }
class _SafeHtmlMirror {
  constructor(s){ this.__html=s; this.isSafeHtml=true; }
  toString(){ return this.__html; }
}
function _renderValue(v){
  if(v==null||v===false) return '';
  if(v instanceof _SafeHtmlMirror) return v.__html;
  if(Array.isArray(v)) return v.map(_renderValue).join('');
  if(typeof v==='number'||typeof v==='boolean') return String(v);
  return _esc(v);
}
function htmlMirror(strings, ...values){
  let out = strings[0];
  for(let i=0;i<values.length;i++){ out += _renderValue(values[i]); out += strings[i+1]; }
  return new _SafeHtmlMirror(out);
}
function unsafeMirror(s){ return new _SafeHtmlMirror(String(s==null?'':s)); }

group('safeHtml — escape semantics', () => {
  test('plain string is escaped', () => {
    const r = htmlMirror`<div>${'<script>alert(1)</script>'}</div>`;
    assert.strictEqual(String(r), '<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>');
  });
  test('quotes inside attribute value are escaped (no attr break-out)', () => {
    const r = String(htmlMirror`<a title="${'pwn" onclick="alert(1)'}">x</a>`);
    // The user-provided " becomes &quot; — so the attribute boundary held.
    assert.ok(r.includes('&quot;'), 'expected &quot; in output');
    // There should be exactly TWO real " in the output: the ones we wrote
    // around the template literal. Any user-injected " would push count higher.
    assert.strictEqual((r.match(/"/g) || []).length, 2, 'attribute quote count must equal exactly 2');
  });
  test('null / undefined render as empty', () => {
    assert.strictEqual(String(htmlMirror`a${null}b${undefined}c`), 'abc');
  });
  test('false renders as empty (truthy guard idiom)', () => {
    assert.strictEqual(String(htmlMirror`x${false}y`), 'xy');
  });
  test('numbers pass through', () => {
    assert.strictEqual(String(htmlMirror`<b>${42}</b>`), '<b>42</b>');
  });
  test('nested html result is inserted unescaped', () => {
    const inner = htmlMirror`<i>${'<x>'}</i>`;
    const outer = htmlMirror`<u>${inner}</u>`;
    assert.strictEqual(String(outer), '<u><i>&lt;x&gt;</i></u>');
  });
  test('unsafe() bypasses escape', () => {
    const r = htmlMirror`<div>${unsafeMirror('<b>raw</b>')}</div>`;
    assert.strictEqual(String(r), '<div><b>raw</b></div>');
  });
  test('array of strings is joined and each item escaped', () => {
    const items = ['<a>', '<b>'];
    assert.strictEqual(String(htmlMirror`<x>${items}</x>`), '<x>&lt;a&gt;&lt;b&gt;</x>');
  });
  test('array of nested html results composes', () => {
    const items = [htmlMirror`<i>${'a'}</i>`, htmlMirror`<i>${'b'}</i>`];
    assert.strictEqual(String(htmlMirror`<u>${items}</u>`), '<u><i>a</i><i>b</i></u>');
  });
  test('mixed array (strings + nested html)', () => {
    const items = ['<x>', htmlMirror`<y>${'z'}</y>`];
    assert.strictEqual(String(htmlMirror`${items}`), '&lt;x&gt;<y>z</y>');
  });
  test('empty interpolation list works', () => {
    assert.strictEqual(String(htmlMirror`hi`), 'hi');
  });
});

// ============================================================
// reactiveStore — Proxy-based auto-flush + silent escape hatch
// (mirrors reactiveStore.js — kept inline so testRunner stays standalone)
// ============================================================
function makeReactiveMirror() {
  let silentDepth = 0;
  let timer = null;
  let dirty = false;
  const subs = [];
  const cache = new WeakMap();
  const REACT = Symbol('react');
  const RAW   = Symbol('raw');

  const flushNow = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (silentDepth > 0) return;
    if (!dirty) return;
    dirty = false;
    subs.slice().forEach(fn => { try { fn(); } catch(_) {} });
  };
  const markDirty = () => {
    if (silentDepth > 0) return;
    dirty = true;
    if (timer) return;
    timer = setTimeout(flushNow, 5);
  };

  const handler = {
    get(t, k, r) {
      if (k === REACT) return true;
      if (k === RAW)   return t;
      const v = Reflect.get(t, k, r);
      if (v == null || typeof v !== 'object') return v;
      if (v instanceof Date || v instanceof RegExp || v instanceof Set || v instanceof Map) return v;
      if (typeof v === 'function') return v;
      if (v[REACT]) return v;
      const cached = cache.get(v);
      if (cached) return cached;
      const p = new Proxy(v, handler);
      cache.set(v, p);
      return p;
    },
    set(t, k, v, r) {
      const prev = Reflect.get(t, k, r);
      const raw = (v && v[REACT]) ? v[RAW] : v;
      if (prev === raw) return true;
      const ok = Reflect.set(t, k, raw, r);
      markDirty();
      return ok;
    },
    deleteProperty(t, k) {
      const had = Reflect.has(t, k);
      const ok  = Reflect.deleteProperty(t, k);
      if (had) markDirty();
      return ok;
    },
  };
  return {
    wrap(o) { if (!o || typeof o !== 'object') return o; if (o[REACT]) return o; const c = cache.get(o); if (c) return c; const p = new Proxy(o, handler); cache.set(o, p); return p; },
    silent(fn) { silentDepth++; try { return fn(); } finally { silentDepth--; } },
    subscribe(fn) { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; },
    flushNow,
  };
}

function waitFlush(ms = 20) {
  return new Promise(r => setTimeout(r, ms));
}

group('reactiveStore — basic semantics', () => {
  test('top-level set fires subscriber once after debounce', async () => {
    const R = makeReactiveMirror();
    const obj = R.wrap({ x: 1 });
    let calls = 0;
    R.subscribe(() => calls++);
    obj.x = 2;
    obj.x = 3;
    obj.x = 4;
    R.flushNow();
    assert.strictEqual(calls, 1, 'expected exactly 1 flush for batched mutations');
  });
  test('nested object mutation fires through proxy chain', async () => {
    const R = makeReactiveMirror();
    const obj = R.wrap({ rows: [{ team: 'A' }] });
    let calls = 0;
    R.subscribe(() => calls++);
    obj.rows[0].team = 'B';
    R.flushNow();
    assert.strictEqual(calls, 1);
    assert.strictEqual(obj.rows[0].team, 'B');
  });
  test('silent() suppresses all flushes within scope', () => {
    const R = makeReactiveMirror();
    const obj = R.wrap({ x: 1 });
    let calls = 0;
    R.subscribe(() => calls++);
    R.silent(() => {
      obj.x = 99;
      obj.x = 100;
    });
    R.flushNow();
    assert.strictEqual(calls, 0, 'silent() must suppress the flush');
  });
  test('silent() is re-entrant', () => {
    const R = makeReactiveMirror();
    const obj = R.wrap({ x: 1 });
    let calls = 0;
    R.subscribe(() => calls++);
    R.silent(() => {
      R.silent(() => { obj.x = 2; });
      // Inner returned, but outer is still silent — must NOT flush yet.
      obj.x = 3;
    });
    R.flushNow();
    assert.strictEqual(calls, 0);
  });
  test('identity is preserved across accesses (=== holds)', () => {
    const R = makeReactiveMirror();
    const obj = R.wrap({ rows: [{ team: 'A' }] });
    assert.strictEqual(obj.rows[0], obj.rows[0]);
  });
  test('deleteProperty fires subscriber', () => {
    const R = makeReactiveMirror();
    const obj = R.wrap({ rows: { foo: 1 } });
    let calls = 0;
    R.subscribe(() => calls++);
    delete obj.rows.foo;
    R.flushNow();
    assert.strictEqual(calls, 1);
  });
  test('setting same value does not fire', () => {
    const R = makeReactiveMirror();
    const obj = R.wrap({ x: 5 });
    let calls = 0;
    R.subscribe(() => calls++);
    obj.x = 5;       // no-op
    obj.x = 5;       // no-op
    R.flushNow();
    assert.strictEqual(calls, 0);
  });
  test('array methods (push) fire one flush per microtask batch', () => {
    const R = makeReactiveMirror();
    const obj = R.wrap({ rows: [] });
    let calls = 0;
    R.subscribe(() => calls++);
    obj.rows.push({ team: 'X' });
    R.flushNow();
    assert.strictEqual(calls, 1);
    assert.strictEqual(obj.rows.length, 1);
  });
  test('subscribe returns unsubscribe function', () => {
    const R = makeReactiveMirror();
    const obj = R.wrap({ x: 1 });
    let calls = 0;
    const off = R.subscribe(() => calls++);
    obj.x = 2; R.flushNow();
    assert.strictEqual(calls, 1);
    off();
    obj.x = 3; R.flushNow();
    assert.strictEqual(calls, 1, 'unsubscribe should stop further notifications');
  });
});

// ============================================================
// Summary
// ============================================================
console.log(`\n${'─'.repeat(40)}`);
console.log(`  Passed: ${passed}   Failed: ${failed}   Total: ${passed + failed}`);
console.log('─'.repeat(40));
if (failed > 0) process.exit(1);
