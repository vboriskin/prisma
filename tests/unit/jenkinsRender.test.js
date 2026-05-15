'use strict';
/* ============================================================
   tests/unit/jenkinsRender.test.js
   --
   Phase-3 Jenkins (2026-05-10) — pure render-logic тесты для UI-фрагментов
   которые рендерят данные из model.jenkins / participant.jenkinsBuilds48h.

   Тестируемые render-функции (из integrations/teamScanner2Renderer.js)
   НЕ экспортированы (внутренние helpers большого renderer-модуля), поэтому
   логика реплицирована inline по контракту. Контракт документирован в
   docs/integrations/jenkins.md (Phase-3) — при изменении render-кода
   ОБЯЗАТЕЛЬНО править и здесь, и в renderer'е, и в jenkins.md.

   Покрывает:
     1) J-chip в person-card (renderPersonMetricsPanel)
     2) Per-row source-chip J<N> (in renderPersonRows)
     3) Cross-team Jenkins tile (renderSleepingDataInsights, multi-only)
     4) Diagnostic JENKINS section (_diagSectionJenkins)
     5) Identity-attribution mapping (teamScanner2.js jenkins_attach block)
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/* ============================================================
   Реплика esc() из renderer'а: minimal HTML escape без зависимостей.
   В проде Utils.escapeHtml использует DOMParser; здесь — строковая
   замена, достаточная для assertions.
   ============================================================ */
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ============================================================
   Task 1.1 — J-chip rendering в person-card.
   Источник: integrations/teamScanner2Renderer.js#renderPersonMetricsPanel
   (ищи блок «Phase-1 Jenkins MVP (2026-05-10) — J chip»).
   ============================================================ */
describe('Task 1.1 — J-chip в person-card (renderPersonMetricsPanel)', () => {
  // Pure-replica логики из renderer'а. При изменении — синхронизировать.
  function renderJPersonChip(participant, model) {
    const p = participant || {};
    const jBuilds = p?.jenkinsBuilds48h || 0;
    const jFails  = p?.jenkinsFailures48h || 0;
    const jFolder = model?.jenkins?.folder || 'sbof';
    return `<span class="ts2-pm-chip ${jBuilds === 0 ? 'ts2-pm-chip-empty' : ''}" data-pm-formula="Jenkins за 48ч: ${jBuilds} билдов, ${jFails} fail. Источник — culprits / actions.causes.userName из folder ${esc(jFolder)}. Если 0 при роли DevOps/SRE — проверьте jenkinsUserName в Сотрудниках или запустите Auto-Resolve.">
    <span class="ts2-pm-chip-key">J</span>
    <span class="ts2-pm-chip-num">${jBuilds}</span>
    <span class="ts2-pm-chip-lab">${jFails > 0 ? jFails + ' fail' : 'билдов 48ч'}</span>
  </span>`;
  }

  test('builds=12, fails=2 → chip содержит J, 12, "2 fail"', () => {
    const p = { jenkinsBuilds48h: 12, jenkinsFailures48h: 2 };
    const html = renderJPersonChip(p, { jenkins: { folder: 'sbof' } });
    assert.match(html, /ts2-pm-chip-key">J</);
    assert.match(html, /ts2-pm-chip-num">12</);
    assert.match(html, /2 fail/);
    // Не пустая
    assert.ok(!/ts2-pm-chip ts2-pm-chip-empty/.test(html), 'не должен иметь -empty class при builds>0');
  });

  test('builds=0 → chip с ts2-pm-chip-empty class', () => {
    const p = { jenkinsBuilds48h: 0, jenkinsFailures48h: 0 };
    const html = renderJPersonChip(p, { jenkins: { folder: 'sbof' } });
    assert.match(html, /ts2-pm-chip ts2-pm-chip-empty/);
    assert.match(html, /ts2-pm-chip-num">0</);
  });

  test('builds>0, fails=0 → label "билдов 48ч" вместо "X fail"', () => {
    const p = { jenkinsBuilds48h: 7, jenkinsFailures48h: 0 };
    const html = renderJPersonChip(p, { jenkins: { folder: 'sbof' } });
    assert.match(html, /билдов 48ч/);
    assert.ok(!/ fail/.test(html.replace(/Jenkins за 48ч[^"]*/, '')),
      'должно быть label "билдов 48ч", не "0 fail"');
  });

  test('formula-tooltip упоминает folder', () => {
    const p = { jenkinsBuilds48h: 3 };
    const html = renderJPersonChip(p, { jenkins: { folder: 'platform-mobile' } });
    assert.match(html, /folder platform-mobile/);
  });

  test('participant без jenkins-fields → safe defaults (0)', () => {
    const html = renderJPersonChip({}, { jenkins: { folder: 'sbof' } });
    assert.match(html, /ts2-pm-chip-empty/);
    assert.match(html, /ts2-pm-chip-num">0</);
  });

  test('model.jenkins=null → defaults to "sbof" folder в tooltip', () => {
    const p = { jenkinsBuilds48h: 1 };
    const html = renderJPersonChip(p, {});
    assert.match(html, /folder sbof/);
  });
});

/* ============================================================
   Task 1.2 — Per-row source-chip J<N>.
   Источник: integrations/teamScanner2Renderer.js#renderPersonRows
   (ищи блок «Phase-2 Jenkins (2026-05-10) — J<N> чип»).
   ============================================================ */
describe('Task 1.2 — Per-row source-chip J<N>', () => {
  // Pure-replica srcChip helper'а из renderer'а.
  const srcChip = (label, n, cls, titleOverride) => n > 0
    ? `<span class="ts2-row-src-chip ts2-row-src-${cls}" title="${titleOverride || `${label} активность за 72ч: ${n} событий`}"><span class="ts2-row-src-chip-key">${cls.toUpperCase()}</span><span class="ts2-row-src-chip-num">${n}</span></span>`
    : '';

  function renderSrcChips(p) {
    const bbN = (p.bbItems || []).length;
    const cfN = (p.cfItems || []).length;
    const zN  = ((p.zephyrTestsCreatedRecent || []).length
              + (p.zephyrTestsExecutedRecent || []).length);
    const jN  = p.jenkinsBuilds48h || 0;
    return (bbN || cfN || zN || jN)
      ? `<span class="ts2-row-src-chips">${srcChip('Bitbucket', bbN, 'b')}${srcChip('Confluence', cfN, 'c')}${srcChip('Zephyr', zN, 'z')}${srcChip('Jenkins', jN, 'j', `Jenkins билдов за 48ч: ${jN}${p.jenkinsFailures48h ? ` · failures: ${p.jenkinsFailures48h}` : ''}`)}</span>`
      : '';
  }

  test('jenkinsBuilds48h=5 → J chip с числом и Information accent class', () => {
    const html = renderSrcChips({ jenkinsBuilds48h: 5, jenkinsFailures48h: 0 });
    assert.match(html, /ts2-row-src-chips/);
    assert.match(html, /ts2-row-src-chip ts2-row-src-j/);
    assert.match(html, /ts2-row-src-chip-key">J</);
    assert.match(html, /ts2-row-src-chip-num">5</);
  });

  test('Jenkins title упоминает 48ч окно', () => {
    const html = renderSrcChips({ jenkinsBuilds48h: 5 });
    assert.match(html, /Jenkins билдов за 48ч: 5/);
  });

  test('jenkinsFailures48h>0 → title содержит "failures: N"', () => {
    const html = renderSrcChips({ jenkinsBuilds48h: 5, jenkinsFailures48h: 2 });
    assert.match(html, /failures: 2/);
  });

  test('jenkinsFailures48h=0 → title без "failures"', () => {
    const html = renderSrcChips({ jenkinsBuilds48h: 5, jenkinsFailures48h: 0 });
    assert.ok(!/failures/.test(html), 'title не должен упоминать failures при 0');
  });

  test('всё пусто (bb=0, cf=0, z=0, j=0) → srcChips НЕ рендерится', () => {
    const html = renderSrcChips({});
    assert.equal(html, '', 'пустая обёртка должна быть строкой ""');
    const html2 = renderSrcChips({
      bbItems: [], cfItems: [],
      zephyrTestsCreatedRecent: [], zephyrTestsExecutedRecent: [],
      jenkinsBuilds48h: 0,
    });
    assert.equal(html2, '');
  });

  test('только J заполнен → срабатывает обёртка', () => {
    const html = renderSrcChips({ jenkinsBuilds48h: 3 });
    assert.match(html, /ts2-row-src-chips/);
    assert.match(html, /ts2-row-src-j/);
    // Bitbucket/Confluence/Zephyr chip-ов нет (note: -c матчит wrapper-class
    // ts2-row-src-chips/-chip; используем boundary через "-c\\b" / "-c "
    // или более точную регулярку с пробелом/кавычкой после).
    assert.ok(!/ts2-row-src-b[\s"]/.test(html), 'no Bitbucket chip');
    assert.ok(!/ts2-row-src-c[\s"]/.test(html), 'no Confluence chip');
    assert.ok(!/ts2-row-src-z[\s"]/.test(html), 'no Zephyr chip');
  });
});

/* ============================================================
   Task 1.3 — Cross-team Jenkins tile (renderSleepingDataInsights).
   Источник: integrations/teamScanner2Renderer.js#renderSleepingDataInsights
   (ищи комментарий «7j) Phase-2 Jenkins activity tile»).
   Multi-only: scope='multi' OR (undefined без team filter).
   ============================================================ */
describe('Task 1.3 — Cross-team Jenkins tile (Глубже multi-view)', () => {
  // Pure-replica логики из renderer'а — tile-builder.
  // Возвращает '' если model.jenkins нет / error / 0 jobs / 0 builds.
  function renderJenkinsTile(model, opts = {}) {
    const jen = model?.jenkins;
    // Multi-only guard: в team-view tile скрыт.
    if (opts.scope === 'team') return '';
    if (!jen || jen.error) return '';
    if (!(jen.summary?.totalBuilds7d > 0 || jen.totalJobs > 0)) return '';
    const sum = jen.summary || {};
    const frPct = Number(sum.failureRatePct || 0);
    const frCls = frPct >= 20 ? 'ts2-sd-bad' : (frPct >= 10 ? 'ts2-sd-mid' : 'ts2-sd-good');
    const items = [
      `<li class="ts2-sd-row"><span class="ts2-sd-key">Всего билдов</span><span class="ts2-sd-val">${sum.totalBuilds7d || 0}</span><span class="ts2-sd-pct">за 7д</span></li>`,
      `<li class="ts2-sd-row"><span class="ts2-sd-key">Failure rate</span><span class="ts2-sd-val">${sum.failures7d || 0}/${sum.totalBuilds7d || 0}</span><span class="ts2-sd-pct ${frCls}">${frPct}%</span></li>`,
      `<li class="ts2-sd-row"><span class="ts2-sd-key">Deploy frequency</span><span class="ts2-sd-val">${sum.deployFreqPer7d || 0}</span><span class="ts2-sd-pct">релизов/7д</span></li>`,
      `<li class="ts2-sd-row"><span class="ts2-sd-key">MTTR</span><span class="ts2-sd-val">${(Number(sum.mttrHours) || 0).toFixed(1)}</span><span class="ts2-sd-pct">ч (proxy)</span></li>`,
      `<li class="ts2-sd-row"><span class="ts2-sd-key">Jobs scanned</span><span class="ts2-sd-val">${jen.scannedJobs || 0}/${jen.totalJobs || 0}</span><span class="ts2-sd-pct">${esc(jen.folder || '')}</span></li>`,
    ];
    const topFailed = (jen.perJob || [])
      .filter(j => (j.failures7d || 0) > 0)
      .sort((a, b) => (b.failures7d || 0) - (a.failures7d || 0))
      .slice(0, 5);
    if (topFailed.length) {
      items.push(`<li class="ts2-sd-row ts2-sd-row-section"><span class="ts2-sd-key">Топ failed jobs</span></li>`);
      for (const j of topFailed) {
        const safeUrl = j.url ? esc(j.url) : '#';
        const linkOpen  = j.url ? `<a href="${safeUrl}" target="_blank" rel="noopener">` : '<span>';
        const linkClose = j.url ? '</a>' : '</span>';
        items.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">${linkOpen}${esc(j.name)}${linkClose}</span><span class="ts2-sd-val">${j.failures7d}/${j.builds7d || 0}</span><span class="ts2-sd-pct ts2-sd-bad">fail</span></li>`);
      }
    }
    return `<details class="ts2-sd-tile"><summary class="ts2-sd-summary"><span>Jenkins активность</span><span class="ts2-sd-hint">— builds / failure rate / deploy frequency / MTTR (proxy: время от FAILURE до следующего SUCCESS на том же job). Источник — folder ${esc(jen.folder || 'sbof')}.</span></summary><ul class="ts2-sd-list">${items.join('')}</ul></details>`;
  }

  const SAMPLE = {
    folder: 'sbof', totalJobs: 47, scannedJobs: 47,
    summary: { totalBuilds7d: 287, failures7d: 34, failureRatePct: 12, deployFreqPer7d: 12, mttrHours: 4.7 },
    perJob: [
      { name: 'sbof-deploy-prod', failures7d: 5, builds7d: 20, url: 'http://j/job/sbof-deploy-prod/' },
      { name: 'sbof-build-fe',    failures7d: 8, builds7d: 30, url: 'http://j/job/sbof-build-fe/' },
      { name: 'sbof-test-be',     failures7d: 3, builds7d: 12, url: 'http://j/job/sbof-test-be/' },
      { name: 'sbof-deploy-stage', failures7d: 2, builds7d: 10, url: 'http://j/job/sbof-deploy-stage/' },
      { name: 'sbof-lint',        failures7d: 1, builds7d: 8,  url: 'http://j/job/sbof-lint/' },
      { name: 'sbof-pact',        failures7d: 1, builds7d: 5,  url: 'http://j/job/sbof-pact/' },
    ],
  };

  test('happy path: tile rendered с key metrics', () => {
    const html = renderJenkinsTile({ jenkins: SAMPLE }, { scope: 'multi' });
    assert.ok(html.length > 0, 'tile должен рендериться');
    assert.match(html, /Jenkins активность/);
    assert.match(html, /Всего билдов/);
    assert.match(html, />287</);
    assert.match(html, /12%/);
    assert.match(html, />12</);
    assert.match(html, /релизов\/7д/);
    assert.match(html, /4\.7/);
    assert.match(html, /ч \(proxy\)/);
  });

  test('top-5 failed jobs с links', () => {
    const html = renderJenkinsTile({ jenkins: SAMPLE }, { scope: 'multi' });
    // Топ-5: sbof-build-fe (8), sbof-deploy-prod (5), sbof-test-be (3), sbof-deploy-stage (2), sbof-lint (1)
    assert.match(html, /sbof-build-fe/);
    assert.match(html, /sbof-deploy-prod/);
    assert.match(html, /sbof-test-be/);
    assert.match(html, /sbof-deploy-stage/);
    assert.match(html, /sbof-lint/);
    // sbof-pact (1, 6th) НЕ должен попасть в топ-5
    assert.ok(!/sbof-pact/.test(html), 'только топ-5 failed jobs');
    // Ссылки на Jenkins URL
    assert.match(html, /href="http:\/\/j\/job\/sbof-build-fe/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener"/);
  });

  test('failure-rate tier: 5% → ts2-sd-good (зелёный)', () => {
    const m = { jenkins: { ...SAMPLE, summary: { ...SAMPLE.summary, failureRatePct: 5 } } };
    const html = renderJenkinsTile(m, { scope: 'multi' });
    assert.match(html, /ts2-sd-good/);
    assert.ok(!/ts2-sd-mid/.test(html.match(/Failure rate.*?<\/li>/s)?.[0] || ''));
    assert.ok(!/ts2-sd-bad/.test(html.match(/Failure rate.*?<\/li>/s)?.[0] || ''));
  });

  test('failure-rate tier: 12% → ts2-sd-mid (жёлтый)', () => {
    const m = { jenkins: { ...SAMPLE, summary: { ...SAMPLE.summary, failureRatePct: 12 } } };
    const html = renderJenkinsTile(m, { scope: 'multi' });
    const frRow = html.match(/Failure rate.*?<\/li>/s)?.[0] || '';
    assert.match(frRow, /ts2-sd-mid/);
  });

  test('failure-rate tier: 25% → ts2-sd-bad (красный)', () => {
    const m = { jenkins: { ...SAMPLE, summary: { ...SAMPLE.summary, failureRatePct: 25 } } };
    const html = renderJenkinsTile(m, { scope: 'multi' });
    const frRow = html.match(/Failure rate.*?<\/li>/s)?.[0] || '';
    assert.match(frRow, /ts2-sd-bad/);
  });

  test('edge: model.jenkins.error → tile НЕ рендерится', () => {
    const m = { jenkins: { ...SAMPLE, error: 'HTTP 401' } };
    assert.equal(renderJenkinsTile(m, { scope: 'multi' }), '');
  });

  test('edge: totalJobs=0 + builds7d=0 → tile НЕ рендерится', () => {
    const m = { jenkins: { folder: 'sbof', totalJobs: 0, summary: { totalBuilds7d: 0 }, perJob: [] } };
    assert.equal(renderJenkinsTile(m, { scope: 'multi' }), '');
  });

  test('edge: model.jenkins=null → tile НЕ рендерится', () => {
    assert.equal(renderJenkinsTile({ jenkins: null }, { scope: 'multi' }), '');
    assert.equal(renderJenkinsTile({}, { scope: 'multi' }), '');
  });

  test('edge: scope="team" → tile НЕ рендерится (multi-only)', () => {
    const html = renderJenkinsTile({ jenkins: SAMPLE }, { scope: 'team' });
    assert.equal(html, '', 'в team-view tile должен быть скрыт');
  });

  test('multi-view default (scope=undefined) → tile рендерится', () => {
    const html = renderJenkinsTile({ jenkins: SAMPLE });
    assert.ok(html.length > 0, 'без scope=team tile должен быть');
  });

  test('XSS: имя job экранируется', () => {
    const m = {
      jenkins: {
        ...SAMPLE,
        perJob: [{ name: 'evil<script>alert(1)</script>', failures7d: 1, builds7d: 1, url: '' }],
      },
    };
    const html = renderJenkinsTile(m, { scope: 'multi' });
    assert.ok(!/<script>alert/.test(html), 'XSS-вектор не должен пройти');
    assert.match(html, /evil&lt;script&gt;/);
  });
});

/* ============================================================
   Task 1.4 — Diagnostic JENKINS section.
   Источник: integrations/teamScanner2Renderer.js#_diagSectionJenkins
   ============================================================ */
describe('Task 1.4 — Diagnostic JENKINS section (_diagSectionJenkins)', () => {
  // Pure-replica логики (без _diagSection / _kv обёрток — проверяем
  // что секция формирует правильный statusPill / statusKind / openByDefault
  // + содержит ожидаемые KV).
  function buildJenkinsDiagModel(jenkins, attributedCount) {
    const fmt = (n) => Number.isFinite(n) ? n.toLocaleString('ru-RU') : '—';
    if (!jenkins) {
      return { kind: 'empty', statusKind: 'neutral',
               body: 'Не настроено или fetch не запускался.' };
    }
    if (jenkins.error) {
      return { kind: 'error', statusPill: 'fail', statusKind: 'warn', openByDefault: true,
               body: `Подключено: нет / Ошибка: ${jenkins.error}` };
    }
    const fetchedAt = jenkins.fetchedAt ? new Date(jenkins.fetchedAt) : null;
    const ageMin = fetchedAt ? Math.round((Date.now() - fetchedAt.getTime()) / 60000) : null;
    const totalJobs = jenkins.totalJobs || 0;
    const scannedJobs = jenkins.scannedJobs || 0;
    const builds7d = jenkins.summary?.totalBuilds7d || 0;
    const failureRatePct = jenkins.summary?.failureRatePct || 0;
    const authorsCount = jenkins.perAuthor ? Object.keys(jenkins.perAuthor).length : 0;
    const errs = Array.isArray(jenkins.errors) ? jenkins.errors : [];
    const statusPill = errs.length ? `${errs.length} ошиб.` : 'OK';
    const statusKind = errs.length ? 'warn' : 'ok';
    const openByDefault = errs.length > 0;
    const kvs = {
      'Подключено': 'да',
      'Folder': jenkins.folder || '—',
      'Last fetch age min': ageMin,
      'Jobs': `${fmt(scannedJobs)} / ${fmt(totalJobs)} отсканировано`,
      'Builds 7д': `${fmt(builds7d)} (failure rate ${failureRatePct}%)`,
      'Authors': `${fmt(authorsCount)} (атрибутировано к ${fmt(attributedCount || 0)} в реестре)`,
      'Deploy/7д': fmt(jenkins.summary?.deployFreqPer7d || 0),
      'MTTR (proxy)': `${jenkins.summary?.mttrHours || 0} ч`,
    };
    return { kind: 'ok', statusPill, statusKind, openByDefault, kvs, errors: errs };
  }

  test('jenkins=null → kind=empty, statusKind=neutral', () => {
    const r = buildJenkinsDiagModel(null);
    assert.equal(r.kind, 'empty');
    assert.equal(r.statusKind, 'neutral');
    assert.match(r.body, /Не настроено/);
  });

  test('jenkins.error set → statusPill="fail", openByDefault=true', () => {
    const r = buildJenkinsDiagModel({ error: 'HTTP 401' });
    assert.equal(r.kind, 'error');
    assert.equal(r.statusPill, 'fail');
    assert.equal(r.statusKind, 'warn');
    assert.equal(r.openByDefault, true);
    assert.match(r.body, /HTTP 401/);
  });

  test('happy path: ok status, KV-rows', () => {
    const j = {
      folder: 'sbof', fetchedAt: new Date().toISOString(),
      totalJobs: 47, scannedJobs: 47,
      summary: { totalBuilds7d: 287, failures7d: 34, failureRatePct: 12, deployFreqPer7d: 12, mttrHours: 4.7 },
      perAuthor: { 'A': {}, 'B': {}, 'C': {} },
      errors: [],
    };
    const r = buildJenkinsDiagModel(j, 2);
    assert.equal(r.kind, 'ok');
    assert.equal(r.statusPill, 'OK');
    assert.equal(r.statusKind, 'ok');
    assert.equal(r.openByDefault, false);
    assert.equal(r.kvs['Folder'], 'sbof');
    assert.match(r.kvs['Jobs'], /47.*47/);
    assert.match(r.kvs['Builds 7д'], /failure rate 12%/);
    assert.match(r.kvs['Authors'], /3.*атрибутировано к 2/);
    assert.match(r.kvs['MTTR (proxy)'], /4\.7 ч/);
  });

  test('errors.length>0 → statusPill="N ошиб.", auto-открыта', () => {
    const j = {
      folder: 'sbof', fetchedAt: new Date().toISOString(),
      totalJobs: 5, scannedJobs: 5, summary: {},
      perAuthor: {},
      errors: [
        { scope: 'job:svc-a', message: 'HTTP 500' },
        { scope: 'auth', message: 'token expired' },
      ],
    };
    const r = buildJenkinsDiagModel(j);
    assert.equal(r.statusPill, '2 ошиб.');
    assert.equal(r.statusKind, 'warn');
    assert.equal(r.openByDefault, true);
    assert.equal(r.errors.length, 2);
  });

  test('fetchedAt → ageMin вычисляется', () => {
    const ts = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 мин назад
    const r = buildJenkinsDiagModel({
      fetchedAt: ts, folder: 'sbof', totalJobs: 1, scannedJobs: 1,
      summary: {}, perAuthor: {}, errors: [],
    });
    // 4-6 (округление + jitter)
    assert.ok(r.kvs['Last fetch age min'] >= 4 && r.kvs['Last fetch age min'] <= 6,
      `expected ageMin ~5, got ${r.kvs['Last fetch age min']}`);
  });
});

/* ============================================================
   Task 1.5 — Identity attribution mapping.
   Источник: integrations/teamScanner2.js (jenkins_attach block ~L1218).
   Это pure data-transform: perAuthor + participants → participant.jenkins*.
   ============================================================ */
describe('Task 1.5 — Identity attribution (jenkins_attach mapping)', () => {
  // Pure-replica логики из teamScanner2.js.
  function attachJenkinsToParticipants(perAuthor, participants) {
    const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const byName = new Map();
    for (const [name, rec] of Object.entries(perAuthor || {})) {
      const k = norm(name);
      if (k) byName.set(k, rec);
    }
    for (const p of (participants || [])) {
      const candidates = [
        p?.label, p?.fullName, p?.displayName, p?.name, p?.email,
      ].filter(Boolean);
      let rec = null;
      for (const c of candidates) {
        const r = byName.get(norm(c));
        if (r) { rec = r; break; }
      }
      if (rec) {
        p.jenkinsBuilds48h    = rec.builds48h    || 0;
        p.jenkinsFailures48h  = rec.failures48h  || 0;
        p.jenkinsLastBuildAt  = rec.lastBuildAt  || 0;
      } else {
        p.jenkinsBuilds48h   = 0;
        p.jenkinsFailures48h = 0;
        p.jenkinsLastBuildAt = 0;
      }
    }
    return participants;
  }

  test('happy: точный match по fullName → participant получает поля', () => {
    const perAuthor = {
      'Иванов Иван Иванович': { builds48h: 5, failures48h: 1, builds7d: 12, failures7d: 2, lastBuildAt: 1700000000000 },
    };
    const ps = [{ label: 'Иванов И.И.', fullName: 'Иванов Иван Иванович', email: 'i.ivanov@sber.ru' }];
    attachJenkinsToParticipants(perAuthor, ps);
    assert.equal(ps[0].jenkinsBuilds48h,   5);
    assert.equal(ps[0].jenkinsFailures48h, 1);
    assert.equal(ps[0].jenkinsLastBuildAt, 1700000000000);
  });

  test('case-insensitive: ИВАНОВ ИВАН ИВАНОВИЧ совпадает с "Иванов Иван Иванович"', () => {
    const perAuthor = {
      'ИВАНОВ ИВАН ИВАНОВИЧ': { builds48h: 7, failures48h: 0 },
    };
    const ps = [{ label: 'Иванов Иван Иванович' }];
    attachJenkinsToParticipants(perAuthor, ps);
    assert.equal(ps[0].jenkinsBuilds48h, 7);
  });

  test('whitespace-trim + collapse: "  Иванов  Иван  " совпадает', () => {
    const perAuthor = {
      '  Иванов  Иван  ': { builds48h: 3, failures48h: 1 },
    };
    const ps = [{ fullName: 'иванов иван' }];
    attachJenkinsToParticipants(perAuthor, ps);
    assert.equal(ps[0].jenkinsBuilds48h,   3);
    assert.equal(ps[0].jenkinsFailures48h, 1);
  });

  test('match по email если label не совпадает', () => {
    const perAuthor = {
      'i.ivanov@sber.ru': { builds48h: 2, failures48h: 0 },
    };
    const ps = [{ label: 'Кто-то Другой', email: 'i.ivanov@sber.ru' }];
    attachJenkinsToParticipants(perAuthor, ps);
    assert.equal(ps[0].jenkinsBuilds48h, 2);
  });

  test('нет совпадения → defaults 0/0/0', () => {
    const perAuthor = {
      'Совершенно Другой Человек': { builds48h: 99, failures48h: 99 },
    };
    const ps = [{ label: 'Иванов И.И.', email: 'i.ivanov@sber.ru' }];
    attachJenkinsToParticipants(perAuthor, ps);
    assert.equal(ps[0].jenkinsBuilds48h,   0);
    assert.equal(ps[0].jenkinsFailures48h, 0);
    assert.equal(ps[0].jenkinsLastBuildAt, 0);
  });

  test('пустой perAuthor → все participants получают 0', () => {
    const ps = [{ label: 'A' }, { label: 'B' }];
    attachJenkinsToParticipants({}, ps);
    assert.equal(ps[0].jenkinsBuilds48h, 0);
    assert.equal(ps[1].jenkinsBuilds48h, 0);
  });

  test('пустые participants → no-throw', () => {
    assert.doesNotThrow(() => attachJenkinsToParticipants({ 'A': { builds48h: 1 } }, []));
    assert.doesNotThrow(() => attachJenkinsToParticipants({}, null));
  });

  test('priority: label → fullName → displayName → name → email', () => {
    // perAuthor совпадает только с email — должен сработать (последний кандидат).
    const perAuthor = { 'fallback@sber.ru': { builds48h: 4 } };
    const ps = [{ label: 'X', fullName: 'Y', displayName: 'Z', name: 'W', email: 'fallback@sber.ru' }];
    attachJenkinsToParticipants(perAuthor, ps);
    assert.equal(ps[0].jenkinsBuilds48h, 4);
  });

  test('никаких fuzzy-match (substring не должен срабатывать)', () => {
    const perAuthor = { 'Иванов Иван Иванович': { builds48h: 50 } };
    const ps = [{ fullName: 'Иванов' }]; // только фамилия
    attachJenkinsToParticipants(perAuthor, ps);
    assert.equal(ps[0].jenkinsBuilds48h, 0,
      'identity-deterministic: substring не считается совпадением');
  });
});
