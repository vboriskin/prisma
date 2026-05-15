'use strict';
/* ============================================================
   server/zephyr.js — V18 extraction (from server.js)

   Zephyr / test-management domain:
     · jiraResolveZephyrResultFieldId — auto-discover customfield ID
       (Zephyr Squad/Scale/Xray) для testresult attribute via /field probe
     · _zephyrNormalizeUserKey — userKey → canonical username
     · _zephyrFetchWithRetry   — 429/5xx retry wrapper around jiraForward
     · _zephyrFetchTestsDc_LEGACY — `/rest/tests/1.0/*` (Zephyr Tests DC)
     · _zephyrProbe            — detect plugin (Scale / Tests DC / fallback)
     · _zephyrFetchScale       — `/rest/atm/1.0/*` (Zephyr Scale / TM4J)
     · _zephyrFetchJqlFallback — JQL surrogate via /rest/api/2/search
     · ppFetchZephyrActivity   — orchestrator, picks fetcher

   Все низкоуровневые helpers (jiraRequest, jiraForward, jiraPLimit,
   jiraResolveProjectId, _ppMakeAuthHeader) приходят через factory.

   Public surface (returned by `create({...})`):
     · jiraResolveZephyrResultFieldId
     · ppFetchZephyrActivity
     · _zephyrNormalizeUserKey  (re-exported для совместимости тестов)
   ============================================================ */

const logger = require('./logger.js'); // eslint-disable-line no-unused-vars

// ── factory-injected deps ────────────────────────────────────
let _jiraRequest;
let _jiraForward;
let _jiraPLimit;
let _jiraResolveProjectId;
let _ppMakeAuthHeader;

// ── module-scoped state ──────────────────────────────────────
let _zephyrResultFieldIdCache = { url: '', id: '', at: 0 };
const _ZEPHYR_FIELD_TTL = 60 * 60 * 1000;   // 1 hour

const _ZEPHYR_PROBE_TTL = 30 * 60 * 1000;
const _zephyrProbeCache = new Map();   // baseUrl → { mode, at, tried }

/* ── Phase 3 — Zephyr/Xray test-result customfield auto-discovery ──
   Different test-management plugins store the PASS/FAIL outcome in
   different places:
     · Zephyr Squad (Server):  custom field "Test Status" or "Execution Status"
     · Zephyr Scale:           customfield with name containing "test result"
     · Xray:                   customfield "Test Run Status"
   We probe `/rest/api/2/field` once per Jira (TTL 1h) and pick the first
   match by name keyword. Returns '' if nothing matched — caller should
   then fall back to issue.fields.status.name (which works for the
   simplest Zephyr setups where execution status === Jira status).
   ────────────────────────────────────────────────────────────────── */
async function jiraResolveZephyrResultFieldId(cfg) {
  const now = Date.now();
  if (_zephyrResultFieldIdCache.url === cfg.jiraBaseUrl
      && now - _zephyrResultFieldIdCache.at < _ZEPHYR_FIELD_TTL) {
    return _zephyrResultFieldIdCache.id;     // may be '' = "no field found"
  }
  let found = '';
  try {
    const fields = await _jiraRequest(cfg, 'GET', '/rest/api/2/field');
    if (Array.isArray(fields)) {
      // Match by name keyword, prefer customfield_*. First-match wins —
      // ordering by specificity to avoid picking up unrelated "status" fields.
      const KEYWORDS = [
        /test\s*run\s*status/i,
        /execution\s*status/i,
        /test\s*status/i,
        /test\s*result/i,
        /прогон/i,
        /результ.*тест/i,
      ];
      for (const rx of KEYWORDS) {
        const f = fields.find(f =>
          rx.test(String(f.name || '')) && String(f.id || '').startsWith('customfield_'));
        if (f) { found = f.id; break; }
      }
    }
  } catch (_) { /* probe failed — fall through to '' = use status.name */ }
  _zephyrResultFieldIdCache = { url: cfg.jiraBaseUrl, id: found, at: now };
  return found;
}

// Z3 — userKey normalizer.
function _zephyrNormalizeUserKey(raw) {
  if (raw == null) return '';
  let k = String(raw).trim();
  if (!k) return '';
  // `JIRAUSER1697487` → `JIRAUSER1697487` (DC standard form, не трогаем).
  // Голый `1697487` → `JIRAUSER1697487` (если только цифры).
  if (/^\d{5,}$/.test(k)) return `JIRAUSER${k}`;
  // username `I.Ivanov` → `i.ivanov` (DC username case-insensitive).
  if (/^[A-Za-z][A-Za-z0-9._-]+$/.test(k)) return k.toLowerCase();
  return k;
}

// Z2 — fetch с retry на 429/503/таймауте (3 попытки, exp backoff).
async function _zephyrFetchWithRetry(opts, label, tried) {
  const attempts = 3;
  let lastStatus = 0, lastErr = '';
  for (let i = 0; i < attempts; i++) {
    const r = await _jiraForward(opts).catch(e => ({ status: 0, _err: String(e?.message || e).slice(0, 120) }));
    lastStatus = r.status;
    lastErr    = r._err || '';
    if (r.status >= 200 && r.status < 300) return r;
    // Retryable: 429, 502, 503, 504, network (status=0).
    const retryable = r.status === 429 || (r.status >= 502 && r.status <= 504) || r.status === 0;
    if (!retryable || i === attempts - 1) {
      tried.push({ type: label, status: r.status, attempts: i + 1, error: r._err });
      return r;
    }
    // Exp backoff: 0.5s, 1.5s, 4s + jitter.
    const delay = 500 * Math.pow(3, i) + Math.floor(Math.random() * 200);
    await new Promise(res => setTimeout(res, delay));
  }
  tried.push({ type: label, status: lastStatus, attempts, error: lastErr });
  return { status: lastStatus, text: '' };
}

// Z-package: legacy Tests DC fetcher переименован в `_zephyrFetchTestsDc_LEGACY`.
// Новый orchestrator `ppFetchZephyrActivity` (см. ниже) делает probe и
// dispatch'ит на правильный fetcher (Scale/Tests DC/JQL fallback).
async function _zephyrFetchTestsDc_LEGACY(cfg, tls, cutoffTs) {
  if (!cfg.jiraBaseUrl || !cfg.jiraToken) {
    return { authors: {}, configured: false, tried: [] };
  }
  const projectKeys = String(cfg.jiraProjectKeys || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  if (!projectKeys.length) return { authors: {}, configured: false, tried: [] };
  const baseRaw = String(cfg.jiraBaseUrl).replace(/\/+$/, '');
  const auth = _ppMakeAuthHeader(cfg.jiraToken);
  const tried = [];
  const isoCutoff = new Date(cutoffTs).toISOString().replace('T', ' ').slice(0, 19);
  const dateCutoff = new Date(cutoffTs).toISOString().slice(0, 10);

  // Step 1: Resolve project keys → numeric IDs (parallel, cached).
  const projects = [];
  await Promise.all(projectKeys.map(async (pk) => {
    const id = await _jiraResolveProjectId(cfg, pk);
    if (id) projects.push({ pk, id });
    else tried.push({ type: 'project-resolve', pk, status: 0, error: 'no-id' });
  }));
  if (!projects.length) return { authors: {}, configured: true, tried, error: 'projects-unresolved' };

  // Step 2: Fetch test cases + test runs per project с CONCURRENCY=4 (Z5).
  const authors = {};
  const ensureAuthor = (rawKey, dn) => {
    const k = _zephyrNormalizeUserKey(rawKey); // Z3
    if (!k) return null;
    if (!authors[k]) authors[k] = { testsCreated: 0, testsExecuted: 0, items: [], displayName: dn || k };
    else if (dn && !authors[k].displayName) authors[k].displayName = dn;
    return authors[k];
  };

  // V21 Z4 / AW — расширенные fields для extra metrics:
  //  · components / labels — для coverage by component / manual-vs-auto split
  //  · lastTestResultDate — test-debt
  //  · traceability       — V21 AW: link с Jira issues (coverage map)
  // API6: добавили `lastTestResultStatus` — возвращается testCase API без extra calls.
  // Даёт pass-rate per-author бесплатно (раньше требовался N×testresults вызов на каждый testRun).
  const tcFields = 'id,key,projectId,name,createdBy,createdOn,updatedBy,updatedOn,components,labels,lastTestResultDate,lastTestResultStatus,traceability';
  // PR-DC — добавили `testCycleId`, `testCycle`, `cycle` для cycle completion %.
  // Разные версии Zephyr Tests DC отдают cycle-info под разными полями.
  const trFields = 'id,key,projectId,name,createdBy,createdOn,updatedBy,updatedOn,userKeys,executionTime,testResultStatuses,status(id,name),defects,issueKey,testCycleId,testCycle(id,name),cycle(id,name)';

  // Z1 — paginated fetch loop. Cap = 1000 за PK чтобы не зациклиться на огромном проекте.
  const PAGE_SIZE = 200;
  const PAGE_CAP  = 5; // 5 × 200 = 1000

  // Z6 — ZQL probe: первая страница пробуется с `updatedOn >= "iso datetime"`.
  // Если HTTP 400 (некоторые DC версии не понимают timestamp) — fallback на date-only.
  // Если и это 400 — fallback на полный сканер без фильтра (post-filter в коде).
  async function _fetchEntityPaginated(entityKind /* 'testcase' | 'testrun' */, projId, pk) {
    const fieldList = entityKind === 'testcase' ? tcFields : trFields;
    const baseEntity = entityKind === 'testcase' ? 'testCase' : 'testRun';

    const queryVariants = [
      `${baseEntity}.projectId IN (${projId}) AND ${baseEntity}.updatedOn >= "${isoCutoff}"`,
      `${baseEntity}.projectId IN (${projId}) AND ${baseEntity}.updatedOn >= "${dateCutoff}"`,
      `${baseEntity}.projectId IN (${projId})`, // last-resort: post-filter
    ];
    let activeQuery = queryVariants[0];
    let allResults = [];
    let truncated = false;
    let totalReported = 0;

    for (let page = 0; page < PAGE_CAP; page++) {
      const startAt = page * PAGE_SIZE;
      const url = `${baseRaw}/rest/tests/1.0/${entityKind}/search?query=${encodeURIComponent(activeQuery)}&fields=${fieldList}&maxResults=${PAGE_SIZE}&startAt=${startAt}&archived=false`;
      const opts = { targetUrl: url, method: 'GET', headers: { Authorization: auth, Accept: 'application/json' }, allowInsecureTls: tls, timeoutMs: 15000 };
      const label = `zephyr-${entityKind}`;
      let r = await _zephyrFetchWithRetry(opts, label, tried);
      // Z6 — на 400 пробуем альтернативные ZQL-варианты (только на page=0).
      if (r.status === 400 && page === 0) {
        for (let v = 1; v < queryVariants.length && r.status === 400; v++) {
          activeQuery = queryVariants[v];
          tried.push({ type: `zephyr-${entityKind}-zql-fallback`, pk, variant: v });
          const url2 = `${baseRaw}/rest/tests/1.0/${entityKind}/search?query=${encodeURIComponent(activeQuery)}&fields=${fieldList}&maxResults=${PAGE_SIZE}&startAt=${startAt}&archived=false`;
          r = await _zephyrFetchWithRetry({ ...opts, targetUrl: url2 }, label, tried);
        }
      }
      if (r.status < 200 || r.status >= 300) break;
      let parsed;
      try { parsed = JSON.parse(r.text || '{}'); } catch (_) { break; }
      const results = Array.isArray(parsed?.results) ? parsed.results : [];
      const total   = Number(parsed?.total) || 0;
      if (page === 0) totalReported = total;
      allResults = allResults.concat(results);
      // Stop conditions: меньше PAGE_SIZE → последняя страница; или мы упёрлись в cap.
      if (results.length < PAGE_SIZE) break;
      if (allResults.length >= PAGE_CAP * PAGE_SIZE) {
        // Достигли cap — отмечаем что всё ещё есть данные.
        if (totalReported > allResults.length) truncated = true;
        break;
      }
    }
    if (totalReported > allResults.length) truncated = true;
    if (truncated) {
      tried.push({ type: `zephyr-${entityKind}-truncated`, pk, seen: allResults.length, total: totalReported });
    }
    return allResults;
  }

  let tcTotal = 0, trTotal = 0;

  // V21 Z4 (audit-09 §E #34, #38, #40, #42-#45) — extra Zephyr metrics aggregator.
  // Все собираются из УЖЕ fetched test cases / runs — без новых HTTP-вызовов.
  const passRateByAuthor = new Map(); // user → { pass, fail, total }
  const testDebt         = [];        // { key, name, lastTestResultDate, daysSilent }
  const defectsFromFails = new Map(); // defectKey → { count, runs: [trKey] }
  const slowTests        = [];        // { key, name, executionTime }
  const reRunCount       = new Map(); // tcKey → count of RETEST status runs
  const coverageByComp   = new Map(); // component name → { manual, auto, total }
  const manualVsAuto     = { manual: 0, auto: 0, unknown: 0 };
  // V21 AW — coverage map: jiraKey → [tcKey] linked via traceability.
  const coverageByJira   = new Map(); // jiraKey → Set of tc keys
  // PR-DC — cycle completion %. Группируем testruns по cycle-id;
  // считаем total + done (PASS/FAIL/BLOCKED — финальные статусы; PENDING/UNEXECUTED — нет).
  const cycleStats = new Map(); // cycleId → { name, total, done, byStatus: {pass, fail, blocked, other} }
  const FINAL_STATUSES = new Set(['pass', 'passed', 'fail', 'failed', 'blocked', 'wip']);
  const PENDING_STATUSES = new Set(['unexecuted', 'pending', 'not_executed', 'todo', 'retest']);

  // Z5 — concurrency 4 (вместо Promise.all из 20+ проектов).
  const PROJECT_CONCURRENCY = 4;
  const projectTasks = projects.map(({ pk, id }) => async () => {
    // Test cases.
    try {
      const tcResults = await _fetchEntityPaginated('testcase', id, pk);
      tcTotal += tcResults.length;
      for (const tc of tcResults) {
        // Z4 #38 — Test debt: TC без runs > 90 дней.
        const lastResultMs = Date.parse(tc.lastTestResultDate || '');
        if (Number.isFinite(lastResultMs)) {
          const daysSilent = Math.floor((Date.now() - lastResultMs) / 86400000);
          if (daysSilent > 90) {
            testDebt.push({ key: tc.key || '', name: (tc.name || '').slice(0, 80), lastTestResultDate: tc.lastTestResultDate, daysSilent, pk });
          }
        }
        // API6: pass-rate из `lastTestResultStatus` без extra calls.
        // Атрибутируется автору последнего execution (createdBy/updatedBy fallback).
        const lastStatus = String(tc.lastTestResultStatus || '').toLowerCase();
        if (lastStatus) {
          const ownerKey = String(tc.updatedBy || tc.createdBy || tc.owner || '').toLowerCase().trim();
          if (ownerKey) {
            const pr = passRateByAuthor.get(ownerKey) || { pass: 0, fail: 0, total: 0 };
            pr.total++;
            if (lastStatus === 'pass') pr.pass++;
            else if (lastStatus === 'fail' || lastStatus === 'failed') pr.fail++;
            passRateByAuthor.set(ownerKey, pr);
          }
        }
        // V21 AW — Coverage map: tc.traceability дает связи с Jira issues.
        // Format DC: traceability — array of `{ traceabilityType, issueKey, ... }`.
        const traceability = Array.isArray(tc.traceability) ? tc.traceability : [];
        for (const t of traceability) {
          const jiraKey = t?.issueKey || t?.key || (typeof t === 'string' ? t : '');
          if (!jiraKey) continue;
          const set = coverageByJira.get(jiraKey) || new Set();
          set.add(tc.key || tc.id || '');
          coverageByJira.set(jiraKey, set);
        }

        // Z4 #44 — Coverage by component.
        const components = Array.isArray(tc.components) ? tc.components : [];
        // Z4 #45 — Manual vs auto split — по labels («auto» / «automation» = auto).
        const labels = Array.isArray(tc.labels) ? tc.labels.map(l => String(l).toLowerCase()) : [];
        const isAuto = labels.some(l => /^auto|automation/.test(l));
        const isManual = labels.includes('manual');
        if (isAuto)         manualVsAuto.auto++;
        else if (isManual)  manualVsAuto.manual++;
        else                manualVsAuto.unknown++;
        for (const c of components) {
          const cn = c?.name || (typeof c === 'string' ? c : '');
          if (!cn) continue;
          const e = coverageByComp.get(cn) || { manual: 0, auto: 0, total: 0 };
          e.total++;
          if (isAuto) e.auto++;
          else if (isManual) e.manual++;
          coverageByComp.set(cn, e);
        }
        // Внутри окна — обычный update/create accounting.
        const updatedMs = Date.parse(tc.updatedOn || tc.createdOn || '');
        if (Number.isFinite(updatedMs) && updatedMs < cutoffTs) continue;
        const creator = String(tc.createdBy || '').trim();
        const updater = String(tc.updatedBy || tc.createdBy || '').trim();
        const a1 = ensureAuthor(creator);
        if (a1) {
          a1.testsCreated++;
          if (a1.items.length < 50) a1.items.push({
            kind: 'test-case', key: tc.key || '', name: (tc.name || '').slice(0, 80),
            at: tc.updatedOn || tc.createdOn || '', pk,
            url: `${baseRaw}/secure/Tests.jspa#/testCase/${encodeURIComponent(tc.key || '')}`,
          });
        }
        if (updater && updater !== creator) {
          const a2 = ensureAuthor(updater);
          if (a2 && a2.items.length < 50) a2.items.push({
            kind: 'test-case-edit', key: tc.key || '', name: (tc.name || '').slice(0, 80),
            at: tc.updatedOn || '', pk,
            url: `${baseRaw}/secure/Tests.jspa#/testCase/${encodeURIComponent(tc.key || '')}`,
          });
        }
      }
    } catch (e) { tried.push({ type: 'zephyr-testcase', pk, error: String(e?.message || e).slice(0, 100) }); }

    // Test runs.
    try {
      const trResults = await _fetchEntityPaginated('testrun', id, pk);
      trTotal += trResults.length;
      for (const tr of trResults) {
        // Z4 #42 — Slow tests: top-20 по executionTime.
        const ms = Number(tr.executionTime) || 0;
        if (ms > 0) slowTests.push({ key: tr.key || '', name: (tr.name || '').slice(0, 80), executionTime: ms, pk });
        // Z4 #43 — Re-run count: status RETEST.
        const statusName = String(tr.status?.name || '').toLowerCase().trim();
        // PR-DC — cycle aggregation. Cycle-id может прийти под разными полями
        // в зависимости от версии Zephyr Tests DC.
        const cycleId   = tr.testCycleId || tr.testCycle?.id || tr.cycle?.id || null;
        const cycleName = tr.testCycle?.name || tr.cycle?.name || '';
        if (cycleId) {
          const cs = cycleStats.get(cycleId) || { name: cycleName, total: 0, done: 0, byStatus: { pass: 0, fail: 0, blocked: 0, pending: 0, other: 0 }, pk };
          cs.total++;
          if (FINAL_STATUSES.has(statusName)) {
            cs.done++;
            if (statusName === 'pass' || statusName === 'passed') cs.byStatus.pass++;
            else if (statusName === 'fail' || statusName === 'failed') cs.byStatus.fail++;
            else if (statusName === 'blocked') cs.byStatus.blocked++;
            else cs.byStatus.other++;
          } else if (PENDING_STATUSES.has(statusName)) {
            cs.byStatus.pending++;
          } else {
            cs.byStatus.other++;
          }
          if (cycleName && !cs.name) cs.name = cycleName;
          cycleStats.set(cycleId, cs);
        }
        if (statusName === 'retest') {
          const tcKey = tr.issueKey || tr.key || '';
          if (tcKey) reRunCount.set(tcKey, (reRunCount.get(tcKey) || 0) + 1);
        }
        // Z4 #40 — Defects from failed runs.
        const isFailed = statusName === 'fail' || statusName === 'failed';
        if (isFailed && Array.isArray(tr.defects) && tr.defects.length) {
          for (const d of tr.defects) {
            const dk = d?.key || d?.issueKey || (typeof d === 'string' ? d : '');
            if (!dk) continue;
            const e = defectsFromFails.get(dk) || { count: 0, runs: [] };
            e.count++;
            if (e.runs.length < 5) e.runs.push(tr.key || '');
            defectsFromFails.set(dk, e);
          }
        }

        const updatedMs = Date.parse(tr.updatedOn || tr.createdOn || '');
        if (Number.isFinite(updatedMs) && updatedMs < cutoffTs) continue;
        const executors = new Set();
        if (Array.isArray(tr.userKeys)) for (const u of tr.userKeys) if (u) executors.add(String(u).trim());
        if (tr.updatedBy)  executors.add(String(tr.updatedBy).trim());
        // Z4 — сравниваем status по name (case-insensitive), а не magic id 4956.
        const isDone = statusName === 'done' || statusName === 'pass' || statusName === 'passed';
        if (tr.createdBy && isDone && executors.size === 0) {
          executors.add(String(tr.createdBy).trim());
        }
        for (const u of executors) {
          // Z4 #34 — Pass rate per author.
          const nu = _zephyrNormalizeUserKey(u);
          if (nu) {
            const pr = passRateByAuthor.get(nu) || { pass: 0, fail: 0, total: 0, displayName: nu };
            pr.total++;
            if (statusName === 'pass' || statusName === 'passed' || statusName === 'done') pr.pass++;
            else if (statusName === 'fail' || statusName === 'failed') pr.fail++;
            passRateByAuthor.set(nu, pr);
          }

          const a = ensureAuthor(u);
          if (!a) continue;
          a.testsExecuted++;
          if (a.items.length < 50) a.items.push({
            kind: 'test-run', key: tr.key || '', name: (tr.name || '').slice(0, 80),
            at: tr.updatedOn || tr.createdOn || '', pk,
            status: tr.status?.name || '', executionTime: tr.executionTime || 0,
            url: `${baseRaw}/secure/Tests.jspa#/testPlayer/${encodeURIComponent(tr.key || '')}`,
          });
        }
      }
    } catch (e) { tried.push({ type: 'zephyr-testrun', pk, error: String(e?.message || e).slice(0, 100) }); }
  });

  await _jiraPLimit(PROJECT_CONCURRENCY, projectTasks);

  // V21 AW — coverage map → plain object, only key list per Jira issue.
  const coverageByJiraObj = {};
  for (const [k, set] of coverageByJira) coverageByJiraObj[k] = [...set];

  // Format aggregates for return.
  const passRateByAuthorObj = {};
  for (const [k, v] of passRateByAuthor) passRateByAuthorObj[k] = { ...v, rate: v.total ? v.pass / v.total : 0 };
  const slowTop20 = slowTests.sort((a, b) => b.executionTime - a.executionTime).slice(0, 20);
  const testDebtTop = testDebt.sort((a, b) => b.daysSilent - a.daysSilent).slice(0, 30);
  const reRunObj = {};
  for (const [k, n] of reRunCount) reRunObj[k] = n;
  const coverageByCompObj = {};
  for (const [k, v] of coverageByComp) coverageByCompObj[k] = v;
  const defectsObj = {};
  for (const [k, v] of defectsFromFails) defectsObj[k] = v;

  // M2: silent-fail при exhausted ZQL fallback'ах. Если все 3 query-варианта
  // получили 4xx и итог пустой — surface как explicit error, иначе UI видит
  // «0 тестов scanned» как валидный результат, тогда как реально все запросы
  // отвалились с 400/401/403/404.
  let zephyrError = null;
  if (tcTotal === 0 && trTotal === 0) {
    const errStatuses = new Set(tried.filter(t => Number(t?.status) >= 400).map(t => Number(t.status)));
    const fallbackUsed = tried.some(t => /zql-fallback/.test(String(t?.type || '')));
    if (errStatuses.size) {
      zephyrError = `all-zql-variants-failed (statuses: ${[...errStatuses].sort().join(', ')})`;
    } else if (fallbackUsed && projects.length > 0) {
      zephyrError = 'all-zql-variants-empty (projects resolved but no test cases/runs returned — check Zephyr Squad/Scale endpoint, project IDs, token permissions)';
    } else if (projects.length === 0) {
      zephyrError = 'projects-unresolved (jiraResolveProjectId returned no IDs — check projectKeys / Jira permissions)';
    }
  }
  // D2 fix (2026-05-11) — aggregate testsCreated/testsExecuted across authors.
  // См. комментарий в `_zephyrFetchScale` для rationale.
  let aggCreatedTdc = 0, aggExecutedTdc = 0;
  for (const a of Object.values(authors)) {
    aggCreatedTdc  += Number(a?.testsCreated)  || 0;
    aggExecutedTdc += Number(a?.testsExecuted) || 0;
  }
  return {
    authors,
    configured: true,
    tried,
    error: zephyrError,
    summary: {
      projectsResolved: projects.length,
      testCasesScanned: tcTotal,
      testRunsScanned: trTotal,
      // D2 fix — attributed totals.
      testsCreated:  aggCreatedTdc,
      testsExecuted: aggExecutedTdc,
      authorsCount:  Object.keys(authors).length,
    },
    // V21 Z4 — extra metrics envelope.
    extra: {
      passRateByAuthor: passRateByAuthorObj,
      testDebt:         testDebtTop,
      defectsFromFails: defectsObj,
      slowTests:        slowTop20,
      reRunCount:       reRunObj,
      coverageByComponent: coverageByCompObj,
      manualVsAuto,
      // V21 AW — Jira ↔ test coverage map.
      coverageByJira: coverageByJiraObj,
      coverageStats: {
        coveredJiraIssues: coverageByJira.size,
        totalLinkRecords:  Object.values(coverageByJiraObj).reduce((s, arr) => s + arr.length, 0),
      },
      // PR-DC — Cycle completion %. Группировка testruns по cycle-id.
      // Формула: completion% = done / total. done = PASS+FAIL+BLOCKED+WIP (final).
      // pending = UNEXECUTED+PENDING+RETEST (нужно ещё исполнить).
      cycleCompletion: [...cycleStats.entries()]
        .map(([id, s]) => ({
          id,
          name: s.name || `cycle ${id}`,
          pk: s.pk,
          total: s.total,
          done: s.done,
          completionPct: s.total > 0 ? Math.round((s.done / s.total) * 100) : 0,
          byStatus: s.byStatus,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 30),
    },
  };
}

/* ────────────────────────────────────────────────────────────
   Z-package: probe + Scale fetcher + JQL fallback + orchestrator.
   ──────────────────────────────────────────────────────────── */

/**
 * Z1: Probe для определения какой Zephyr-плагин на стенде.
 * Один минимальный GET к Scale; на 404 — пробуем Tests DC; 403 → JQL fallback.
 * Кэш per-baseUrl 30 мин (предотвращает повторные probe-запросы каждый pulse).
 */
async function _zephyrProbe(cfg, tls) {
  const baseRaw = String(cfg.jiraBaseUrl || '').replace(/\/+$/, '');
  if (!baseRaw) return { mode: 'jql-fallback', tried: [], at: Date.now() };
  const cached = _zephyrProbeCache.get(baseRaw);
  if (cached && (Date.now() - cached.at) < _ZEPHYR_PROBE_TTL) return cached;

  const pks = String(cfg.jiraProjectKeys || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  if (!pks.length) {
    const r = { mode: 'jql-fallback', tried: [], at: Date.now() };
    _zephyrProbeCache.set(baseRaw, r); return r;
  }
  const auth = _ppMakeAuthHeader(cfg.jiraToken);
  const tried = [];

  // 1) Try Scale.
  const scaleUrl = `${baseRaw}/rest/atm/1.0/testcase/search?query=${encodeURIComponent(`projectKey = "${pks[0]}"`)}&maxResults=1`;
  const r1 = await _zephyrFetchWithRetry({
    targetUrl: scaleUrl, method: 'GET',
    headers: { Authorization: auth, Accept: 'application/json' },
    allowInsecureTls: tls, timeoutMs: 10000,
  }, 'zephyr-probe-scale', tried);
  if (r1.status >= 200 && r1.status < 300) {
    const result = { mode: 'scale', tried, at: Date.now() };
    _zephyrProbeCache.set(baseRaw, result); return result;
  }
  // 2) Только при 404 пробуем Tests DC. На 403 — permission, повторять не нужно.
  if (r1.status === 404 || r1.status === 501) {
    const tdcUrl = `${baseRaw}/rest/tests/1.0/testcase/search?query=${encodeURIComponent('testCase.projectId IN (1)')}&maxResults=1`;
    const r2 = await _zephyrFetchWithRetry({
      targetUrl: tdcUrl, method: 'GET',
      headers: { Authorization: auth, Accept: 'application/json' },
      allowInsecureTls: tls, timeoutMs: 10000,
    }, 'zephyr-probe-testsdc', tried);
    if (r2.status >= 200 && r2.status < 400) {
      const result = { mode: 'testsdc', tried, at: Date.now() };
      _zephyrProbeCache.set(baseRaw, result); return result;
    }
  }
  // QD7: при network-error / timeout (status === 0) НЕ кэшируем результат
  // на 30 мин — иначе все pulse'ы будут идти JQL-fallback'ом даже после
  // восстановления сети. Возвращаем jql-fallback на ОДИН pulse, без cache.
  const isNetworkFail = r1.status === 0;
  const result = { mode: 'jql-fallback', tried, at: Date.now(), _ephemeral: isNetworkFail };
  if (!isNetworkFail) _zephyrProbeCache.set(baseRaw, result);
  return result;
}

/**
 * Z2: Scale (Zephyr Scale / TM4J) fetcher.
 * `/rest/atm/1.0/testcase/search?query=projectKey="X"` — projectKey строкой,
 * без numeric resolve. Фильтр по `updatedOn` client-side.
 * Для testsExecuted: `/rest/atm/1.0/testrun/{key}/testresults` даёт точные
 * `executedBy + executionDate`.
 */
async function _zephyrFetchScale(cfg, tls, cutoffTs, projectKeys) {
  const baseRaw = String(cfg.jiraBaseUrl).replace(/\/+$/, '');
  const auth = _ppMakeAuthHeader(cfg.jiraToken);
  const tried = [];
  const authors = {};
  const ensureAuthor = (rawKey, dn) => {
    const k = _zephyrNormalizeUserKey(rawKey);
    if (!k) return null;
    if (!authors[k]) authors[k] = { testsCreated: 0, testsExecuted: 0, items: [], displayName: dn || k };
    else if (dn && !authors[k].displayName) authors[k].displayName = dn;
    return authors[k];
  };

  const TC_FIELDS = 'key,name,createdBy,createdOn,updatedBy,updatedOn,owner,labels,components,lastTestResultStatus,lastTestResultDate';
  const PAGE_SIZE = 200;
  const PAGE_CAP = 5;
  const blacklist = new Set();

  let tcTotal = 0, trTotal = 0, resultTotal = 0;
  const testRunKeys = [];
  // API6: pass-rate агрегатор (используется в final summary).
  const passRateByAuthor = new Map();

  // 2a) testcase per-project.
  await _jiraPLimit(4, projectKeys.map(pk => async () => {
    if (blacklist.has(pk)) return;
    let startAt = 0;
    for (let page = 0; page < PAGE_CAP; page++) {
      const url = `${baseRaw}/rest/atm/1.0/testcase/search?query=${encodeURIComponent(`projectKey = "${pk}"`)}&fields=${TC_FIELDS}&startAt=${startAt}&maxResults=${PAGE_SIZE}`;
      const r = await _zephyrFetchWithRetry({
        targetUrl: url, method: 'GET',
        headers: { Authorization: auth, Accept: 'application/json' },
        allowInsecureTls: tls, timeoutMs: 15000,
      }, 'zephyr-scale-testcase', tried);
      if (r.status === 403 || r.status === 404) {
        blacklist.add(pk); tried.push({ type: 'scale-blacklist', pk, status: r.status });
        return;
      }
      if (r.status < 200 || r.status >= 300) break;
      let arr;
      try {
        const parsed = JSON.parse(r.text || '[]');
        arr = Array.isArray(parsed) ? parsed : (parsed.results || []);
      } catch { break; }
      tcTotal += arr.length;
      for (const tc of arr) {
        const updMs = Date.parse(tc.updatedOn || tc.createdOn || '');
        if (Number.isFinite(updMs) && updMs >= cutoffTs) {
          const cr = tc.createdBy || '';
          const upd = tc.updatedBy || cr;
          const a1 = ensureAuthor(cr);
          if (a1) {
            a1.testsCreated++;
            // D1 fix (2026-05-10) — Scale-fetcher НЕ пушил items[] в authors,
            // в отличие от _zephyrFetchTestsDc_LEGACY (lines ~307/315/396).
            // Из-за этого diagnostic.sources.zephyr.testsCreated/Executed = 0
            // даже когда summary.testCasesScanned = 3486 / authors имеет 4 entries
            // с testsCreated++ накручено: client (portfolioPulseModel:978) идёт
            // `for (const it of (zEntry.items || []))` и не получает ничего →
            // p.zephyrTestsCreatedRecent остаётся пустым → diagnostic считает
            // длину этого массива (не badges) → 0.
            if (a1.items.length < 50) a1.items.push({
              kind: 'test-case',
              key: tc.key || '',
              name: String(tc.name || '').slice(0, 80),
              at: tc.updatedOn || tc.createdOn || '',
              pk,
              url: `${baseRaw}/secure/Tests.jspa#/testCase/${encodeURIComponent(tc.key || '')}`,
            });
          }
          if (upd && upd !== cr) {
            const a2 = ensureAuthor(upd);
            if (a2 && a2.items.length < 50) a2.items.push({
              kind: 'test-case-edit',
              key: tc.key || '',
              name: String(tc.name || '').slice(0, 80),
              at: tc.updatedOn || '',
              pk,
              url: `${baseRaw}/secure/Tests.jspa#/testCase/${encodeURIComponent(tc.key || '')}`,
            });
          }
        }
        // API6: pass-rate из lastTestResultStatus без extra calls.
        const lastStatus = String(tc.lastTestResultStatus || '').toLowerCase();
        if (lastStatus) {
          const ownerKey = String(tc.updatedBy || tc.createdBy || tc.owner || '').toLowerCase().trim();
          if (ownerKey) {
            const pr = passRateByAuthor.get(ownerKey) || { pass: 0, fail: 0, total: 0 };
            pr.total++;
            if (lastStatus === 'pass') pr.pass++;
            else if (lastStatus === 'fail' || lastStatus === 'failed') pr.fail++;
            passRateByAuthor.set(ownerKey, pr);
          }
        }
      }
      if (arr.length < PAGE_SIZE) break;
      startAt += PAGE_SIZE;
    }
  }));

  // 2b) testrun per-project — собираем keys.
  await _jiraPLimit(4, projectKeys.map(pk => async () => {
    if (blacklist.has(pk)) return;
    const url = `${baseRaw}/rest/atm/1.0/testrun/search?query=${encodeURIComponent(`projectKey = "${pk}"`)}&maxResults=50`;
    const r = await _zephyrFetchWithRetry({
      targetUrl: url, method: 'GET',
      headers: { Authorization: auth, Accept: 'application/json' },
      allowInsecureTls: tls, timeoutMs: 15000,
    }, 'zephyr-scale-testrun', tried);
    if (r.status < 200 || r.status >= 300) return;
    let arr;
    try {
      const parsed = JSON.parse(r.text || '[]');
      arr = Array.isArray(parsed) ? parsed : (parsed.results || []);
    } catch { return; }
    trTotal += arr.length;
    for (const tr of arr.slice(0, 50)) {
      if (tr && tr.key) testRunKeys.push({ pk, key: tr.key });
    }
  }));

  // 2c) per-testrun → /testresults (concurrency 5).
  // QD8: cap снижен 300→100, env-настраиваемый. На медленной Sber-Jira
  // 300 × 15s ÷ 5 = ~60s, что близко к PER_PK_TIMEOUT_MS=90s — риск
  // полного timeout'а всего zephyr-блока. 100 testresults достаточно
  // для 72h-окна большинства команд.
  const TESTRESULTS_CAP = Math.max(20, Math.min(500, Number(process.env.PULSE_ZEPHYR_TESTRESULTS_CAP) || 100));
  await _jiraPLimit(5, testRunKeys.slice(0, TESTRESULTS_CAP).map(({ pk, key }) => async () => {
    const url = `${baseRaw}/rest/atm/1.0/testrun/${encodeURIComponent(key)}/testresults`;
    const r = await _zephyrFetchWithRetry({
      targetUrl: url, method: 'GET',
      headers: { Authorization: auth, Accept: 'application/json' },
      allowInsecureTls: tls, timeoutMs: 15000,
    }, 'zephyr-scale-testresults', tried);
    if (r.status < 200 || r.status >= 300) return;
    let results;
    try { results = JSON.parse(r.text || '[]'); } catch { return; }
    if (!Array.isArray(results)) return;
    for (const res of results) {
      const execMs = Date.parse(res.executionDate || '');
      if (!Number.isFinite(execMs) || execMs < cutoffTs) continue;
      const u = res.executedBy || res.userKey || '';
      const a = ensureAuthor(u);
      if (a) {
        a.testsExecuted++;
        resultTotal++;
        // D1 fix (2026-05-10) — см. комментарий выше про `items.push`.
        // Без этого testsExecutedRecent на клиенте всегда 0 в Scale-режиме.
        if (a.items.length < 50) a.items.push({
          kind: 'test-run',
          key: res.testCaseKey || res.key || key,
          name: String(res.testCaseName || res.name || '').slice(0, 80),
          at: res.executionDate || '',
          pk,
          status: res.status || '',
          executionTime: Number(res.executionTime) || 0,
          url: `${baseRaw}/secure/Tests.jspa#/testPlayer/${encodeURIComponent(key)}`,
        });
      }
    }
  }));

  const passRateObj = {};
  for (const [k, v] of passRateByAuthor) passRateObj[k] = { ...v, rate: v.total ? v.pass / v.total : 0 };

  // D2 fix (2026-05-11) — aggregate testsCreated/testsExecuted across authors,
  // BEFORE возврата. Раньше summary имел только raw scanned counts (3487 TC),
  // но не attributed counts. Diagnostic читал `sources.zephyr.testsCreated`
  // через `participant.zephyrTestsCreatedRecent.length` (line 905 в
  // teamScanner2Diagnostic.js), который depended on `zEntry.items`. Если
  // identity-mapping упал ИЛИ cutoff-window вырезал все TC → 0 attributed.
  // Теперь summary содержит честный sum(authors[*].testsCreated) — это даёт
  // model.zephyr.summary.testsCreated > 0 даже если конкретные participant'ы
  // не получили attribution. Client (portfolioPulseModel:993) синтезирует
  // placeholder items если authors[*].testsCreated > 0 но items.length === 0.
  let aggCreated = 0, aggExecuted = 0;
  for (const a of Object.values(authors)) {
    aggCreated  += Number(a?.testsCreated)  || 0;
    aggExecuted += Number(a?.testsExecuted) || 0;
  }

  return {
    authors, configured: true, tried, error: null, mode: 'scale',
    summary: {
      projectsResolved: projectKeys.length,
      testCasesScanned: tcTotal,
      testRunsScanned:  trTotal,
      testResultsScanned: resultTotal,
      // D2 fix — attributed totals (sum across authors).
      testsCreated:  aggCreated,
      testsExecuted: aggExecuted,
      authorsCount:  Object.keys(authors).length,
      mode: 'scale',
    },
    extra: { passRateByAuthor: passRateObj },
  };
}

/**
 * Z3: JQL-only fallback. Не нуждается в Zephyr API — суррогат через
 * `/rest/api/2/search` по `issuetype in ("Test","Test Case","Test Execution")`.
 * Грубая аппроксимация (assignee ≠ executor строго), но даёт ненулевой signal.
 */
async function _zephyrFetchJqlFallback(cfg, tls, cutoffTs, projectKeys) {
  const baseRaw = String(cfg.jiraBaseUrl).replace(/\/+$/, '');
  const auth = _ppMakeAuthHeader(cfg.jiraToken);
  const tried = [];
  const authors = {};
  const ensureAuthor = (rawKey) => {
    const k = _zephyrNormalizeUserKey(rawKey);
    if (!k) return null;
    if (!authors[k]) authors[k] = { testsCreated: 0, testsExecuted: 0, items: [], displayName: k };
    return authors[k];
  };
  const sinceJql = new Date(cutoffTs).toISOString().slice(0, 10).replace(/-/g, '/');
  // QD2: на Sber-стенде issuetype могут быть на русском («Тест», «Тест-кейс»,
  // «Тестовое выполнение») — английские англ. имена дадут 0 results silent.
  // Конфигурируется через `cfg.zephyrIssuetypes` (comma-separated). Дефолт
  // включает обе локали — Jira парсит case-insensitively, лишние имена
  // игнорируются (вернёт пустой набор для несуществующих).
  const DEFAULT_TEST_ISSUETYPES = [
    // EN
    'Test', 'Test Case', 'Test Execution',
    // RU
    'Тест', 'Тест-кейс', 'Тест кейс', 'Тестовое выполнение', 'Тест-выполнение',
  ];
  const issueTypesRaw = String(cfg.zephyrIssuetypes || '').split(',').map(s => s.trim()).filter(Boolean);
  const issueTypes = issueTypesRaw.length ? issueTypesRaw : DEFAULT_TEST_ISSUETYPES;
  const issueTypesJql = issueTypes.map(t => `"${t.replace(/"/g, '\\"')}"`).join(',');
  const jql = `project in (${projectKeys.map(k => `"${k}"`).join(',')}) AND issuetype in (${issueTypesJql}) AND updated >= "${sinceJql}"`;
  const url = `${baseRaw}/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=summary,issuetype,creator,assignee,updated,status&maxResults=200`;
  const r = await _zephyrFetchWithRetry({
    targetUrl: url, method: 'GET',
    headers: { Authorization: auth, Accept: 'application/json' },
    allowInsecureTls: tls, timeoutMs: 15000,
  }, 'zephyr-jql-fallback', tried);
  if (r.status < 200 || r.status >= 300) {
    return {
      authors: {}, configured: true, tried, error: `jql-fallback-${r.status}`, mode: 'jql-fallback',
      summary: { projectsResolved: projectKeys.length, testCasesScanned: 0, testRunsScanned: 0, mode: 'jql-fallback' },
    };
  }
  let parsed;
  try { parsed = JSON.parse(r.text || '{}'); } catch { parsed = {}; }
  const issues = parsed.issues || [];
  let tc = 0, tr = 0;
  for (const iss of issues) {
    const itype = String(iss.fields?.issuetype?.name || '').toLowerCase();
    // QD2: detect execution на обеих локалях.
    const isExec = itype.includes('execution') || itype.includes('выполнение');
    const creator = iss.fields?.creator?.name || iss.fields?.creator?.key || '';
    const assignee = iss.fields?.assignee?.name || iss.fields?.assignee?.key || '';
    if (isExec) { tr++; const a = ensureAuthor(assignee || creator); if (a) a.testsExecuted++; }
    else { tc++; const a = ensureAuthor(creator); if (a) a.testsCreated++; }
  }
  // D2 fix (2026-05-11) — aggregate testsCreated/testsExecuted across authors.
  let aggCreatedJql = 0, aggExecutedJql = 0;
  for (const a of Object.values(authors)) {
    aggCreatedJql  += Number(a?.testsCreated)  || 0;
    aggExecutedJql += Number(a?.testsExecuted) || 0;
  }
  return {
    authors, configured: true, tried, error: null, mode: 'jql-fallback',
    summary: {
      projectsResolved: projectKeys.length,
      testCasesScanned: tc,
      testRunsScanned: tr,
      // D2 fix — attributed totals.
      testsCreated:  aggCreatedJql,
      testsExecuted: aggExecutedJql,
      authorsCount:  Object.keys(authors).length,
      mode: 'jql-fallback',
    },
  };
}

/**
 * Z4: orchestrator. Probe → выбирает fetcher → graceful degrade.
 */
async function ppFetchZephyrActivity(cfg, tls, cutoffTs) {
  if (!cfg.jiraBaseUrl || !cfg.jiraToken) return { authors: {}, configured: false, tried: [] };
  const projectKeys = String(cfg.jiraProjectKeys || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  if (!projectKeys.length) return { authors: {}, configured: false, tried: [] };

  const probe = await _zephyrProbe(cfg, tls);
  const tried = [...(probe.tried || []), { type: 'zephyr-probe-mode', mode: probe.mode }];

  if (probe.mode === 'scale') {
    const out = await _zephyrFetchScale(cfg, tls, cutoffTs, projectKeys);
    out.tried = [...tried, ...(out.tried || [])];
    // Если Scale ничего не нашёл — degrade в JQL.
    if (out.summary.testCasesScanned === 0 && out.summary.testRunsScanned === 0) {
      const fb = await _zephyrFetchJqlFallback(cfg, tls, cutoffTs, projectKeys);
      fb.tried = [...out.tried, ...(fb.tried || [])];
      fb.mode = 'scale→jql-fallback';
      if (fb.summary) fb.summary.mode = 'scale→jql-fallback';
      return fb;
    }
    return out;
  }
  if (probe.mode === 'testsdc') {
    const out = await _zephyrFetchTestsDc_LEGACY(cfg, tls, cutoffTs);
    out.tried = [...tried, ...(out.tried || [])];
    out.mode = 'testsdc';
    if (out.summary) out.summary.mode = 'testsdc';
    return out;
  }
  // Default: JQL-fallback.
  const out = await _zephyrFetchJqlFallback(cfg, tls, cutoffTs, projectKeys);
  out.tried = [...tried, ...(out.tried || [])];
  return out;
}

function create({
  jiraRequest,
  jiraForward,
  jiraPLimit,
  jiraResolveProjectId,
  ppMakeAuthHeader,
}) {
  _jiraRequest = jiraRequest;
  _jiraForward = jiraForward;
  _jiraPLimit = typeof jiraPLimit === 'function'
    ? jiraPLimit
    : async (_concurrency, tasks) => {
      const out = [];
      for (const t of tasks) out.push(await t());
      return out;
    };
  _jiraResolveProjectId = jiraResolveProjectId;
  _ppMakeAuthHeader = ppMakeAuthHeader;
  return {
    jiraResolveZephyrResultFieldId,
    ppFetchZephyrActivity,
    // helpers re-exported для совместимости (in-file callsites / future tests)
    _zephyrNormalizeUserKey,
    _zephyrFetchWithRetry,
    _zephyrFetchTestsDc_LEGACY,
    _zephyrProbe,
    _zephyrFetchScale,
    _zephyrFetchJqlFallback,
  };
}

module.exports = { create };
