'use strict';
/* ============================================================
   teamScanner2-demo-fixture.test.js — V21 π5
   --
   Контракт-тест на shape SCANNER2_DEMO_FIXTURE. Гарантирует:
     · marker `isDemo: true` присутствует
     · 8+ участников, у каждого — все обязательные поля
     · покрыты все 4 поведенческих класса (idle / moving / watch / stop)
     · sprint-goal с непустыми sprints
     · risks shape совместим с тем что читает renderTopBar
     · 2 команды с непересекающимися members
     · identity (jiraAccountId / bitbucketLogin / confluenceAccountId)
       — у достаточно людей чтобы resolveIdentitiesByEmail отрабатывал
   ============================================================ */

const { test } = require('node:test');
const assert   = require('node:assert/strict');

// Фикстура — ESM модуль, поэтому грузим динамически. Кэшируем результат
// между тестами через простой promise-singleton (await import без top-level await).
let _fixturePromise = null;
function loadFixture() {
  if (!_fixturePromise) {
    _fixturePromise = import('../../integrations/teamScanner2DemoFixture.js');
  }
  return _fixturePromise;
}

test('demo fixture: top-level shape', async () => {
  const { SCANNER2_DEMO_FIXTURE } = await loadFixture();
  const f = SCANNER2_DEMO_FIXTURE;
  assert.equal(f.isDemo, true,             'isDemo marker должен быть true');
  assert.equal(f._isDemoFixture, true,     'duplicated marker для callers без _demoMode flag');
  assert.equal(typeof f.fetchedAt, 'string', 'fetchedAt — ISO-строка');
  assert.equal(typeof f.jiraBaseUrl, 'string', 'jiraBaseUrl — string');
  assert.ok(Array.isArray(f.projectKeys),  'projectKeys — массив');
  assert.ok(f.projectKeys.length >= 1,     'хотя бы 1 PK');
  assert.ok(Array.isArray(f.participants), 'participants — массив');
  assert.ok(f.participants.length >= 8,    'минимум 8 участников');
  assert.ok(typeof f.spaces === 'object',  'spaces — object');
  assert.ok(f.scannerV2,                   'scannerV2 присутствует');
});

test('demo fixture: participants shape', async () => {
  const { SCANNER2_DEMO_FIXTURE } = await loadFixture();
  for (const p of SCANNER2_DEMO_FIXTURE.participants) {
    assert.ok(p.key,    `participant без key`);
    assert.ok(p.name,   `participant ${p.key} без name`);
    assert.ok(p.email,  `participant ${p.key} без email`);
    assert.ok(p.jiraAccountId, `participant ${p.key} без jiraAccountId — нарушение identity-контракта`);
    assert.ok(Array.isArray(p.timelineToday),     `${p.key}: timelineToday не массив`);
    assert.ok(Array.isArray(p.timelineYesterday), `${p.key}: timelineYesterday не массив`);
    assert.ok(Array.isArray(p.blockers),          `${p.key}: blockers не массив`);
    assert.ok(p.badges && typeof p.badges === 'object', `${p.key}: badges object`);
    assert.equal(typeof p.badges.commits48h, 'number', `${p.key}: commits48h — число`);
    assert.equal(typeof p.badges.pr48h,      'number', `${p.key}: pr48h — число`);
  }
});

test('demo fixture: behavioural class coverage', async () => {
  // Структурное правило (без classifyPerson):
  //   stop   = blockers.length >= 1 AND timelineToday = []
  //   moving = timelineToday.length >= 2
  //   watch  = blockers.length >= 1 AND timelineToday.length >= 1
  //   idle   = timelineToday=0 AND timelineYesterday=0 AND blockers=0
  const { SCANNER2_DEMO_FIXTURE } = await loadFixture();
  let stop = 0, moving = 0, watch = 0, idle = 0;
  for (const p of SCANNER2_DEMO_FIXTURE.participants) {
    const t = p.timelineToday.length;
    const y = p.timelineYesterday.length;
    const b = p.blockers.length;
    if (b >= 1 && t === 0) stop++;
    else if (t >= 2) moving++;
    else if (b >= 1) watch++;
    else if (t === 0 && y === 0 && b === 0) idle++;
  }
  assert.ok(stop   >= 1, `должен быть >=1 stop  (got ${stop})`);
  assert.ok(moving >= 1, `должен быть >=1 moving (got ${moving})`);
  assert.ok(watch  >= 1, `должен быть >=1 watch (got ${watch})`);
  assert.ok(idle   >= 1, `должен быть >=1 idle (got ${idle})`);
});

test('demo fixture: scannerV2 risks', async () => {
  const { SCANNER2_DEMO_FIXTURE } = await loadFixture();
  const r = SCANNER2_DEMO_FIXTURE.scannerV2.risks;
  assert.equal(typeof r.totalOrphans,      'number');
  assert.equal(typeof r.totalOutOfSprint,  'number');
  assert.equal(typeof r.outOfSprintRatio,  'number');
  assert.ok(r.outOfSprintRatio >= 0 && r.outOfSprintRatio <= 1, 'ratio в [0..1]');
});

test('demo fixture: scannerV2 sprint goal', async () => {
  const { SCANNER2_DEMO_FIXTURE } = await loadFixture();
  const sg = SCANNER2_DEMO_FIXTURE.scannerV2.sprintGoal;
  assert.equal(typeof sg.aggregateProgress, 'number');
  assert.ok(Array.isArray(sg.sprints) && sg.sprints.length >= 1);
  for (const s of sg.sprints) {
    assert.ok(s.pk,   'sprint без pk');
    assert.ok(s.name, 'sprint без name');
    assert.ok(['on-track','drift','off-track','no-data'].includes(s.pace),
      `sprint ${s.pk}: pace «${s.pace}» не из enum`);
  }
});

test('demo fixture: teams и members consistency', async () => {
  const { SCANNER2_DEMO_FIXTURE } = await loadFixture();
  const f = SCANNER2_DEMO_FIXTURE;
  const teams = f.scannerV2.teams;
  assert.ok(Array.isArray(teams) && teams.length >= 2, '>=2 команды');
  const allKeys = new Set(f.participants.map(p => p.key));
  const seen = new Set();
  for (const t of teams) {
    assert.ok(t.key, 'team без key');
    assert.ok(t.name, 'team без name');
    assert.ok(Array.isArray(t.members), 'members массив');
    for (const m of t.members) {
      assert.ok(allKeys.has(m), `member ${m} в команде ${t.key} не присутствует в participants[]`);
      assert.ok(!seen.has(m), `member ${m} дублируется между командами`);
      seen.add(m);
    }
  }
});

test('demo fixture: getScanner2DemoModel returns mutable deep clone', async () => {
  const { getScanner2DemoModel, SCANNER2_DEMO_FIXTURE } = await loadFixture();
  const m1 = getScanner2DemoModel();
  const m2 = getScanner2DemoModel();
  m1.participants[0].name = 'Mutated';
  assert.notEqual(m1.participants[0].name, m2.participants[0].name,
    'deep clone не работает: mutation одной копии затронула другую');
  // Original frozen остаётся неизменным
  assert.notEqual(SCANNER2_DEMO_FIXTURE.participants[0].name, 'Mutated',
    'frozen original замутирован — Object.freeze не работает');
});

test('demo fixture: identity coverage', async () => {
  // Хотя бы половина участников должна иметь bitbucketLogin или confluenceAccountId
  // (помимо обязательного jiraAccountId), чтобы UI рендерил mixed-source-bar.
  const { SCANNER2_DEMO_FIXTURE } = await loadFixture();
  const f = SCANNER2_DEMO_FIXTURE;
  const withBb = f.participants.filter(p => p.bitbucketLogin).length;
  const withCf = f.participants.filter(p => p.confluenceAccountId).length;
  assert.ok(withBb >= 3, `>=3 человека с bitbucketLogin (got ${withBb})`);
  assert.ok(withCf >= 2, `>=2 человека с confluenceAccountId (got ${withCf})`);
});
