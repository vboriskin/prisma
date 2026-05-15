'use strict';
/* ============================================================
   server/jenkins.js — V18 extraction (from server.js)

   Jenkins integration: verify-endpoint (probe v2 после 2026-05-07 audit)
   + Phase 1 MVP scan-endpoint (2026-05-10).

   Public surface (returned by `create({...})`):
     · handleJenkinsVerify(res, { cfg, tls }) — обрабатывает
       /api/integrations/jenkins-verify (writes JSON в res напрямую).
     · handleJenkinsScan(res, { cfg, tls, body }) — Phase-1 scan-endpoint:
       fetch jobs + per-job builds → aggregation perJob/perAuthor/summary.
       Кэш 5 мин per-folder. Partial failures не валят весь scan.

   Также экспортируется (для тестов):
     · _aggregateJenkinsBuilds(rawJobs, opts) — pure aggregation.

   Зависимости через factory:
     · jiraForward — низкоуровневый HTTP-call (с TLS-bypass поддержкой)
     · writeJson   — server.js helper (status, payload)
     · ppMakeAuthHeader — Basic/Bearer auth header builder
   ============================================================ */

const logger = require('./logger.js'); // eslint-disable-line no-unused-vars

// ── factory-injected deps ────────────────────────────────────
let _jiraForward;
let _writeJson;
let _ppMakeAuthHeader;

/**
 * V21 Jenkins probe v2 (post 2026-05-07 audit).
 * Главные находки prior-probe:
 *   J1 username≠Jenkins userId → returnable authScheme + meR-error для дебага
 *   J2 SSO/SiteMinder перехват → capture key headers (X-Jenkins, Location, Server, Set-Cookie names)
 *   J3 jiraForward не follows redirects → 302 = explicit «sso-redirect» label
 *   J4 jiraForward neg-cache 403 → useCache:false на ВСЕХ probe-запросах
 *   J5 corp WAF блокирует non-browser UA → fallback retry с Mozilla UA
 *
 * Returns: { ok, who, jobsCount, jobsSample[], cultritsSample[], folder,
 *            crumbDetected, authScheme, reachedJenkins, ssoDetected,
 *            proxyDetected, diagnosis, suggestion, error, tried }
 */
async function handleJenkinsVerify(res, { cfg, tls }) {
  const baseRaw = String(cfg.jenkinsBaseUrl || '').replace(/\/+$/, '');
  if (!baseRaw || !cfg.jenkinsToken) {
    _writeJson(res, 400, { ok: false, error: 'Jenkins не настроен (нет baseUrl или token)' });
    return;
  }
  const folder = String(cfg.jenkinsFolder || '').trim();
  const tokenRaw = String(cfg.jenkinsToken || '');
  const authScheme = tokenRaw.includes(':') ? 'Basic' : 'Bearer';
  const auth = _ppMakeAuthHeader(tokenRaw);
  const tried = [];

  const _captureHeaders = (h) => {
    if (!h) return null;
    const get = (k) => h[k] || h[k.toLowerCase()];
    // Set-Cookie: только имена cookies, не значения (security)
    const setCookieRaw = h['set-cookie'] || h['Set-Cookie'];
    const setCookieNames = Array.isArray(setCookieRaw)
      ? setCookieRaw.map(s => String(s).split('=')[0].trim()).slice(0, 8)
      : (setCookieRaw ? [String(setCookieRaw).split('=')[0].trim()] : []);
    return {
      xJenkins: get('x-jenkins') || '',           // "2.492.3" если дошли до Jenkins
      location: get('location') || '',            // куда редиректит
      wwwAuth:  get('www-authenticate') || '',    // realm подсказывает auth-механизм
      server:   get('server') || '',              // BIG-IP / nginx-corporate / SiteMinder
      contentType: get('content-type') || '',
      setCookieNames,                             // SMSESSION = SiteMinder; JSESSIONID = Jenkins
    };
  };
  const _looksLikeHtml = (text) => {
    const head = String(text || '').slice(0, 200).trim().toLowerCase();
    return head.startsWith('<') || head.includes('<html') || head.includes('<!doctype');
  };
  const _classifyResponse = (r) => {
    const h = _captureHeaders(r?.headers);
    const reachedJenkins = !!h?.xJenkins;
    if (r.status === 302 || r.status === 301) return { kind: 'sso-redirect', reachedJenkins, headers: h };
    if (r.status >= 200 && r.status < 300) {
      if (_looksLikeHtml(r.text)) return { kind: 'sso-html-200', reachedJenkins, headers: h };
      return { kind: 'ok', reachedJenkins, headers: h };
    }
    if (r.status === 401) return { kind: 'auth-fail-401', reachedJenkins, headers: h };
    if (r.status === 403) return { kind: reachedJenkins ? 'jenkins-403' : 'proxy-403', reachedJenkins, headers: h };
    if (r.status === 0)   return { kind: 'network', reachedJenkins, headers: h, error: r._err };
    return { kind: `http-${r.status}`, reachedJenkins, headers: h };
  };
  const tryFetch = async (url, opts = {}) => {
    const headers = {
      Authorization: auth,
      Accept: 'application/json',
      // J5 fallback: иногда корп-WAF блокирует non-browser UA. Дефолт jiraForward'а
      // — `sbof-planner/1.0`. По-умолчанию пробуем как Mozilla — это меньше шансов
      // получить 403 от корп-прокси.
      'User-Agent': opts.ua === 'plain' ? 'sbof-planner/1.0'
        : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      ...(opts.extraHeaders || {}),
    };
    const r = await _jiraForward({
      targetUrl: url, method: 'GET', headers,
      allowInsecureTls: tls, timeoutMs: 15000,
      useCache: false,                            // J4 — никаких negative cache 403
    }).catch(e => ({ status: 0, text: '', headers: {}, _err: String(e?.message || e).slice(0, 120) }));
    const cls = _classifyResponse(r);
    tried.push({
      url: url.replace(baseRaw, ''),
      status: r.status,
      kind: cls.kind,
      reachedJenkins: cls.reachedJenkins,
      authScheme,
      ua: opts.ua === 'plain' ? 'sbof-planner/1.0' : 'Mozilla',
      responseHeaders: cls.headers,
      error: r._err,
    });
    return { ...r, _classification: cls };
  };

  try {
    // Cascade endpoints в правильном порядке (наименее privilege-зависимый сначала):
    //   1) /api/json   — root probe, должен дать 200 или внятный 403
    //   2) /me/api/json — кто я (даёт fullName/id если auth прошёл)
    //   3) /job/<folder>/api/json — доступ к folder
    //   4) /crumbIssuer/api/json — только для CSRF token (не для probe!)
    const rootR = await tryFetch(`${baseRaw}/api/json?tree=mode,nodeName,numExecutors,useCrumbs,useSecurity`);
    const meR   = await tryFetch(`${baseRaw}/me/api/json?tree=fullName,id,description`);
    const folderPath = folder ? `/job/${encodeURIComponent(folder)}` : '';
    const jobsR = await tryFetch(`${baseRaw}${folderPath}/api/json?tree=jobs[name,_class,url,color]`);

    let who = '';
    if (meR.status >= 200 && meR.status < 300 && meR._classification.kind === 'ok') {
      try { const m = JSON.parse(meR.text); who = m?.fullName || m?.id || ''; } catch (_) {}
    }

    let jobsCount = 0, jobsSample = [], parsedFolder = null;
    if (jobsR.status >= 200 && jobsR.status < 300 && jobsR._classification.kind === 'ok') {
      try {
        parsedFolder = JSON.parse(jobsR.text);
        const jobs = parsedFolder?.jobs || [];
        jobsCount = jobs.length;
        jobsSample = jobs.slice(0, 5).map(j => ({
          name: j.name, _class: j._class || '', color: j.color || '', url: j.url || ''
        }));
      } catch (_) {}
    }

    // Sample culprits — только если jobs дошли.
    let cultritsSample = [];
    if (parsedFolder && parsedFolder.jobs && parsedFolder.jobs.length) {
      const firstJob = parsedFolder.jobs.find(j => !/Folder/i.test(j._class || '')) || parsedFolder.jobs[0];
      if (firstJob?.url) {
        const buildR = await tryFetch(
          `${firstJob.url.replace(/\/+$/, '')}/lastBuild/api/json?tree=number,result,timestamp,culprits[fullName],changeSet[items[author[fullName]]]`
        );
        if (buildR.status >= 200 && buildR.status < 300 && buildR._classification.kind === 'ok') {
          try {
            const b = JSON.parse(buildR.text);
            const set = new Set();
            (b.culprits || []).forEach(c => c?.fullName && set.add(c.fullName));
            ((b.changeSet?.items) || []).forEach(it => it?.author?.fullName && set.add(it.author.fullName));
            cultritsSample = [...set].slice(0, 5);
          } catch (_) {}
        }
      }
    }

    // CSRF crumb — только если auth прошёл (best-effort, не блокирует probe).
    let crumbDetected = false;
    if (rootR._classification.kind === 'ok' || meR._classification.kind === 'ok') {
      const crumbR = await tryFetch(`${baseRaw}/crumbIssuer/api/json`);
      if (crumbR.status >= 200 && crumbR.status < 300 && crumbR._classification.kind === 'ok') {
        try { const j = JSON.parse(crumbR.text); crumbDetected = !!(j?.crumb && j?.crumbRequestField); } catch (_) {}
      }
    }

    // ── Diagnose root cause ────────────────────────────────
    const allFailed = !rootR._classification.reachedJenkins
      && !meR._classification.reachedJenkins
      && !jobsR._classification.reachedJenkins;
    const ssoDetected = tried.some(t => t.kind === 'sso-redirect' || t.kind === 'sso-html-200');
    const proxyHeaders = tried.find(t => t.responseHeaders?.setCookieNames?.some(n => /SMSESSION|MTSCookie|nginx_session|JSESSIONID/i.test(n)));
    const reachedJenkins = tried.some(t => t.responseHeaders?.xJenkins);

    // Root cause суммарка для UI hint.
    let diagnosis = '';
    let suggestion = '';
    if (jobsR._classification.kind === 'ok') {
      // ОК.
    } else if (ssoDetected) {
      diagnosis = 'SSO/SiteMinder перехват. Прокси требует cookie от login-страницы, которой у нас нет.';
      suggestion = 'Уточните у Jenkins-админа, есть ли API-token endpoint, который обходит SSO (часто `X-Jenkins-API-Token` header или отдельный API URL без SSO-фильтра).';
    } else if (allFailed && !reachedJenkins) {
      diagnosis = 'Запросы не дошли до Jenkins (нет X-Jenkins header в ответе). Скорее всего корпоративный прокси/WAF блокирует.';
      suggestion = 'Проверьте: (1) URL правильный shard (Sber DREAM = sberbank.ru, не delta.sbrf.ru); (2) ваш network имеет доступ; (3) может нужен VPN/jumphost.';
    } else if (jobsR.status === 403 && reachedJenkins) {
      diagnosis = 'Jenkins вернул 403 (auth не распознана). Token валиден на уровне корп-сети, но имя пользователя не совпадает с Jenkins userId.';
      suggestion = 'Зайдите в Jenkins UI → People → клик на свой профиль → URL содержит `/user/<id>` — это правильное имя для Basic auth (формат `<id>:apiToken`).';
    } else if (jobsR.status === 401) {
      diagnosis = 'Jenkins требует auth (401). Token либо невалиден, либо в неправильном формате.';
      suggestion = 'Создайте новый API token в Jenkins UI: People → ваш юзер → Configure → API Token → Add new Token. Используйте формат `username:apiToken`.';
    } else if (jobsR.status >= 200 && jobsR.status < 300 && jobsR._classification.kind === 'sso-html-200') {
      diagnosis = 'Прокси отдал HTML логин-страницу с status 200. Это silent SSO interception.';
      suggestion = suggestion || 'Та же проблема что и SSO redirect — нужен механизм обхода SSO для API.';
    } else if (jobsR.status === 404) {
      diagnosis = `Folder \`${folder || '(root)'}\` не найден.`;
      suggestion = 'Проверьте поле «Folder команды» — это сегмент URL после `/job/`. Если у команды нет folder — оставьте пусто.';
    }

    const okFinal = jobsR._classification.kind === 'ok';
    _writeJson(res, 200, {
      ok: okFinal,
      who, jobsCount, jobsSample, cultritsSample,
      folder, crumbDetected,
      authScheme,
      reachedJenkins,
      ssoDetected,
      proxyDetected: !!proxyHeaders,
      diagnosis: okFinal ? '' : diagnosis,
      suggestion: okFinal ? '' : suggestion,
      error: okFinal ? '' : `HTTP ${jobsR.status} на ${folderPath || '/'} — ${diagnosis || 'проверьте URL/токен/folder'}`,
      tried,
    });
  } catch (e) {
    _writeJson(res, 200, { ok: false, error: String(e?.message || e).slice(0, 200), tried });
  }
}

/* ============================================================
   Phase 1 MVP — Jenkins scan endpoint (2026-05-10)
   ============================================================ */

// In-memory cache per-folder (5 мин TTL). Простой Map, очищается на restart.
const _SCAN_CACHE = new Map(); // folder → { ts: number, data: object }
const _SCAN_TTL_MS = 5 * 60 * 1000;

const TOP_N_JOBS    = 50;
const PER_JOB_BUILDS = 30;
const CONCURRENCY    = 8;
const PER_REQ_TIMEOUT_MS = 6000;
const WIN_7D_MS  = 7 * 24 * 3600 * 1000;
const WIN_48H_MS = 48 * 3600 * 1000;

/**
 * Лимитированная по конкурентности параллель.
 * Возвращает массив результатов в исходном порядке.
 * Ошибки оборачиваются в `{__err: msg}`, чтобы caller сам решил что делать.
 */
async function _pMapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (e) {
        results[idx] = { __err: String(e?.message || e).slice(0, 200) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Pure aggregation. Принимает уже распарсенный список jobs (из tree-fetch),
 * + Map<jobName, buildsArray> для each job.
 *
 * Контракт: НЕ делает HTTP, НЕ читает env, НЕ зависит от globals.
 * Тестируется напрямую в jenkinsAggregation.test.js.
 *
 * @param {{folder:string, fetchedAt:string, jobs:Array<object>, jobBuilds:object}} input
 *   - jobs[] — items как от Jenkins tree=jobs[name,url,color,lastBuild[..],healthReport[..]]
 *   - jobBuilds — { [jobName]: Array<{number,timestamp,duration,result,url,actions[],culprits[]}> }
 * @param {object} [opts] - { now?: number } — для тестируемости (фикс таймштампа).
 * @returns {object} aggregation snapshot.
 */
function _aggregateJenkinsBuilds(input, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const folder = String(input?.folder || '');
  const jobs = Array.isArray(input?.jobs) ? input.jobs : [];
  const jobBuilds = input?.jobBuilds || {};

  const cutoff7d  = now - WIN_7D_MS;
  const cutoff48h = now - WIN_48H_MS;

  const perJob = [];
  const perAuthor = Object.create(null);
  let totalBuilds7d = 0;
  let failures7d = 0;
  let deployFreqPer7d = 0;

  // MTTR proxy: для каждого job собираем последовательности FAILURE→SUCCESS
  // и считаем (time(SUCCESS) - time(prev FAILURE)). Mean по всем jobs.
  const mttrSamplesMs = [];

  for (const j of jobs) {
    const name = String(j?.name || '');
    if (!name) continue;
    const url  = String(j?.url || '');
    const color = String(j?.color || '');
    const healthArr = Array.isArray(j?.healthReport) ? j.healthReport : [];
    const healthScore = healthArr.length ? Number(healthArr[0]?.score) || 0 : 0;
    const lb = j?.lastBuild || null;
    const lastBuild = lb ? {
      n: Number(lb.number) || 0,
      result: String(lb.result || ''),
      ts: Number(lb.timestamp) || 0,
      durationMs: Number(lb.duration) || 0,
    } : null;

    const builds = Array.isArray(jobBuilds[name]) ? jobBuilds[name] : [];

    let builds7d = 0, failures7dJob = 0, successes7dJob = 0, abortedJob = 0;
    let durationSumSec = 0, durationCount = 0;
    let lastFailure = null;

    // Sort builds DESC by number (Jenkins обычно так и отдаёт, но
    // явно — на всякий случай для MTTR хронологии).
    const sorted = builds.slice().sort((a, b) => (Number(b.number) || 0) - (Number(a.number) || 0));

    // Для MTTR ходим в обратном порядке (хронологически: старые → новые).
    const chrono = sorted.slice().reverse();
    let lastFailureTs = 0;
    for (const b of chrono) {
      const ts = Number(b?.timestamp) || 0;
      const result = String(b?.result || '');
      if (result === 'FAILURE' && !lastFailureTs) {
        lastFailureTs = ts;
      } else if (result === 'SUCCESS' && lastFailureTs) {
        const delta = ts - lastFailureTs;
        if (delta > 0) mttrSamplesMs.push(delta);
        lastFailureTs = 0;
      }
    }

    for (const b of sorted) {
      const ts = Number(b?.timestamp) || 0;
      const result = String(b?.result || '');
      const durationMs = Number(b?.duration) || 0;
      if (durationMs > 0) { durationSumSec += durationMs / 1000; durationCount++; }

      if (ts >= cutoff7d) {
        builds7d++;
        if (result === 'FAILURE') failures7dJob++;
        else if (result === 'SUCCESS') successes7dJob++;
        else if (result === 'ABORTED') abortedJob++;
      }
      if (result === 'FAILURE' && !lastFailure) {
        lastFailure = { n: Number(b.number) || 0, ts, url: String(b?.url || '') };
      }

      // Author attribution: actions[].causes[].userName (manual trigger)
      // → fallback culprits[].fullName (SCM-detected). Точное name match —
      // никаких fuzzy. Identity-deterministic per CLAUDE.md контракт #2.
      let authorName = '';
      const actions = Array.isArray(b?.actions) ? b.actions : [];
      for (const a of actions) {
        const causes = Array.isArray(a?.causes) ? a.causes : [];
        for (const c of causes) {
          const u = String(c?.userName || '').trim();
          if (u) { authorName = u; break; }
        }
        if (authorName) break;
      }
      if (!authorName) {
        const culprits = Array.isArray(b?.culprits) ? b.culprits : [];
        for (const c of culprits) {
          const fn = String(c?.fullName || '').trim();
          if (fn) { authorName = fn; break; }
        }
      }
      if (authorName) {
        const key = authorName;
        if (!perAuthor[key]) {
          perAuthor[key] = { builds7d: 0, failures7d: 0, builds48h: 0, failures48h: 0, lastBuildAt: 0 };
        }
        const a = perAuthor[key];
        if (ts >= cutoff7d) {
          a.builds7d++;
          if (result === 'FAILURE') a.failures7d++;
        }
        if (ts >= cutoff48h) {
          a.builds48h++;
          if (result === 'FAILURE') a.failures48h++;
        }
        if (ts > a.lastBuildAt) a.lastBuildAt = ts;
      }
    }

    totalBuilds7d += builds7d;
    failures7d   += failures7dJob;
    const isDeployJob = /-deploy(?:$|[-_./])/i.test(name) || /\bdeploy\b/i.test(name);
    if (isDeployJob && successes7dJob > 0) deployFreqPer7d += successes7dJob;

    const abortRate = builds7d > 0 ? Math.round((abortedJob / builds7d) * 100) / 100 : 0;
    const avgDurationSec = durationCount > 0 ? Math.round(durationSumSec / durationCount) : 0;

    perJob.push({
      name, url, color,
      lastBuild,
      healthScore,
      builds7d,
      failures7d: failures7dJob,
      successes7d: successes7dJob,
      abortRate,
      avgDurationSec,
      lastFailure,
    });
  }

  const failureRatePct = totalBuilds7d > 0
    ? Math.round((failures7d / totalBuilds7d) * 1000) / 10  // 1 знак после запятой
    : 0;
  const mttrHours = mttrSamplesMs.length
    ? Math.round((mttrSamplesMs.reduce((s, x) => s + x, 0) / mttrSamplesMs.length) / 3600000 * 10) / 10
    : 0;

  return {
    fetchedAt: new Date(now).toISOString(),
    folder,
    totalJobs: jobs.length,
    scannedJobs: perJob.length,
    perJob,
    perAuthor,
    summary: {
      totalBuilds7d,
      failures7d,
      failureRatePct,
      deployFreqPer7d,
      mttrHours,
    },
    errors: [],   // заполняется в handler'е (HTTP-уровневые ошибки)
    elapsedMs: 0, // заполняется в handler'е
  };
}

/**
 * Phase 1 MVP — handleJenkinsScan.
 * /api/jenkins/scan
 * Body (опц.): { folder?, sinceTs? } — override от UI.
 *
 * Errors handling: per-job 401/timeout не валит весь scan (push в errors[]
 * и continue). Если Jenkins полностью недоступен — отдаём 200 с error в model.
 */
async function handleJenkinsScan(res, { cfg, tls, body }) {
  const t0 = Date.now();
  const baseRaw = String(cfg.jenkinsBaseUrl || '').replace(/\/+$/, '');
  if (!baseRaw || !cfg.jenkinsToken) {
    _writeJson(res, 400, { ok: false, error: 'Jenkins не настроен (нет baseUrl или token)' });
    return;
  }
  const folderRaw = String((body && body.folder) || cfg.jenkinsFolder || 'sbof').trim();
  // 2026-05-11 — Jenkins folder path-traversal mitigation: folder идёт в URL
  // как `/job/${encodeURIComponent(folder)}/...`. encodeURIComponent защищает
  // от basic `../`, но при двойном decode (proxy/WAF) или unicode-аномалиях
  // обход возможен. Strict allowlist: один сегмент, только alphanumeric + `._-`.
  // Если не matches — reject через 400 (не fallback на default, иначе
  // легитимный пользователь не поймёт почему scan'а нет).
  if (!/^[a-zA-Z0-9._-]+$/.test(folderRaw)) {
    _writeJson(res, 400, {
      ok: false,
      error: `Jenkins folder "${folderRaw.slice(0, 50)}" содержит недопустимые символы. Разрешены только латинские буквы, цифры, точка/дефис/подчёркивание.`,
    });
    return;
  }
  const folder = folderRaw;
  const tokenRaw = String(cfg.jenkinsToken || '');
  const auth = _ppMakeAuthHeader(tokenRaw);

  // Cache lookup.
  const cacheKey = folder || '_root_';
  const cached = _SCAN_CACHE.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < _SCAN_TTL_MS) {
    _writeJson(res, 200, { ...cached.data, _fromCache: true, _cacheAgeMs: Date.now() - cached.ts });
    return;
  }

  const errors = [];
  const tried = [];
  let ssoRedirectCount = 0;
  // 2026-05-11 — track raw token without scheme — для retry с
  // `X-Jenkins-API-Token` header (некоторые Jenkins-конфиги принимают
  // его в обход Authorization когда последний отбивается SSO-фильтром).
  const tokenRawNoScheme = tokenRaw.includes(':') ? tokenRaw.split(':')[1] : tokenRaw;

  // 2026-05-11 — `tried[]` populates per-HTTP-call diagnostics for diagnostic
  // export. Mirror of verify-handler pattern (line ~107). Captures URL path
  // (без хоста — host уходит в config.jenkinsBaseUrl), HTTP status, scope,
  // и kind (ok/sso-redirect/auth-fail/parse-fail/network/http-N).
  // Used by teamScanner2 → rawDiag.jenkinsTriedSummary.
  const _classifyScanResp = (r) => {
    if (r.status === 302 || r.status === 301) return 'sso-redirect';
    if (r.status >= 200 && r.status < 300) return 'ok';
    if (r.status === 401) return 'auth-fail-401';
    if (r.status === 403) return 'auth-fail-403';
    if (r.status === 404) return 'http-404';
    if (r.status === 0)   return 'network';
    return `http-${r.status}`;
  };
  // 2026-05-11 — fetchOne accepts optional `timeoutMs` (для combined-query),
  // `authMode` ("std" | "xtok") для retry со вторым auth-механизмом.
  const fetchOne = async (url, scope, opts = {}) => {
    const authMode = opts.authMode || 'std';
    const timeoutMs = Number(opts.timeoutMs) || PER_REQ_TIMEOUT_MS;
    const headers = authMode === 'xtok'
      ? {
          // X-Jenkins-API-Token — fallback path. Передаём raw token (без
          // user:token), некоторые Jenkins-плагины (например custom JIRA
          // bridge) распознают этот header и пропускают мимо SSO-фильтра.
          'X-Jenkins-API-Token': tokenRawNoScheme,
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 sbof-planner/1.0',
        }
      : {
          Authorization: auth,
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 sbof-planner/1.0',
        };
    const r = await _jiraForward({
      targetUrl: url, method: 'GET', headers,
      allowInsecureTls: tls, timeoutMs,
      useCache: false,
    }).catch(e => ({ status: 0, text: '', headers: {}, _err: String(e?.message || e).slice(0, 120) }));
    if (r.status === 302 || r.status === 301) ssoRedirectCount++;
    const kind = _classifyScanResp(r);
    // tried record: path-only (без baseRaw), status, scope, kind, authMode.
    // Cap до 200 записей чтоб не разрастаться.
    if (tried.length < 200) {
      tried.push({
        url: url.replace(baseRaw, ''),
        status: r.status,
        kind,
        scope,
        authMode,
        error: r._err || null,
      });
    }
    if (r.status >= 200 && r.status < 300) {
      try { return { ok: true, data: JSON.parse(r.text) }; }
      catch (_) { errors.push({ scope, message: `parse-fail HTTP ${r.status}` }); return { ok: false }; }
    }
    // 2026-05-11 — RETRY с X-Jenkins-API-Token если первый attempt отбился
    // SSO redirect (302/301) и мы ещё не пробовали xtok-схему. Один retry,
    // никакой рекурсии глубже.
    if (authMode === 'std' && (r.status === 301 || r.status === 302)) {
      const retried = await fetchOne(url, scope, { ...opts, authMode: 'xtok' });
      if (retried.ok) return retried;
      // если retry тоже fail — продолжаем обычный error-flow ниже.
    }
    if (r._err) errors.push({ scope, message: `network: ${r._err}` });
    else if (r.status === 401 || r.status === 403) errors.push({ scope, message: `auth: HTTP ${r.status}` });
    else errors.push({ scope, message: `HTTP ${r.status || 'no-response'}` });
    return { ok: false };
  };

  // 2026-05-11 — Phase 1 (NEW): combined folder-level query — пытается
  // получить jobs + lastBuild + ВСЕ builds в одном запросе с `depth=3`.
  // Мотивация: per-job builds endpoint у некоторых Jenkins отбивается
  // SSO 302 (separate security filter), хотя folder-level allowed.
  // Один большой запрос вместо 38 маленьких:
  //   - Снижает риск SSO (single auth check)
  //   - Быстрее (no per-job latency × 38)
  //   - Уменьшает нагрузку на Jenkins
  // Risk: response может быть до ~150KB на folder с 38 jobs × 30 builds.
  // Bump timeout до 15 sec для combined.
  const folderPath = folder ? `/job/${encodeURIComponent(folder)}` : '';
  const combinedUrl = `${baseRaw}${folderPath}/api/json?tree=jobs[name,url,color,lastBuild[number,result,timestamp,duration],healthReport[score],builds[number,timestamp,duration,result,url,actions[causes[userName]],culprits[fullName]]{0,${PER_JOB_BUILDS}}]&depth=3`;
  const rCombined = await fetchOne(combinedUrl, 'jobs-list-combined', { timeoutMs: 15000 });

  let jobs = [];
  let jobBuilds = {};
  let folderBuildsAvailable = false;

  if (rCombined.ok && Array.isArray(rCombined.data?.jobs)) {
    jobs = rCombined.data.jobs;
    // Проверка: combined вернул хоть один job с builds? Если да — skip per-job.
    folderBuildsAvailable = jobs.some(j => Array.isArray(j?.builds) && j.builds.length > 0);
    if (folderBuildsAvailable) {
      for (const j of jobs) {
        if (j?.name && Array.isArray(j?.builds)) {
          jobBuilds[j.name] = j.builds;
        }
      }
    }
  } else {
    // Combined query упал — fallback на старый flow:
    // Fetch 1 — только jobs + lastBuild без nested builds.
    const fetch1Url = `${baseRaw}${folderPath}/api/json?tree=jobs[name,url,color,lastBuild[number,result,timestamp,duration],healthReport[score]]&depth=2`;
    const r1 = await fetchOne(fetch1Url, 'jobs-list');
    if (r1.ok && Array.isArray(r1.data?.jobs)) {
      jobs = r1.data.jobs;
    } else {
      // Полный fail — отдаём пустой snapshot с ошибкой.
      if (ssoRedirectCount >= 2) {
        errors.push({ scope: 'auth', message: 'Suspected SSO redirect — token may be cookie not API token' });
      }
      _writeJson(res, 200, {
        fetchedAt: new Date().toISOString(),
        folder,
        totalJobs: 0,
        scannedJobs: 0,
        perJob: [],
        perAuthor: {},
        summary: { totalBuilds7d: 0, failures7d: 0, failureRatePct: 0, deployFreqPer7d: 0, mttrHours: 0 },
        errors,
        tried,
        ssoRedirectCount,
        elapsedMs: Date.now() - t0,
        _strategy: 'combined-fail+legacy-fail',
      });
      return;
    }
  }

  // Cap topN.
  const candidates = jobs
    .filter(j => j && j.name)
    // Skip nested folders для Phase 1 — их jobs не имеют lastBuild.
    .slice(0, TOP_N_JOBS);

  // Fetch 2 — per-job builds ТОЛЬКО если combined-query не дал builds.
  // Когда folder-level builds доступны → skip полностью (sparing 38 HTTP).
  if (!folderBuildsAvailable) {
    await _pMapLimit(candidates, CONCURRENCY, async (j) => {
      if (!j?.url && !j?.name) return null;
      const baseJobUrl = j.url ? String(j.url).replace(/\/+$/, '')
        : `${baseRaw}/job/${encodeURIComponent(j.name)}`;
      const url = `${baseJobUrl}/api/json?tree=builds[number,timestamp,duration,result,url,actions[causes[userName]],culprits[fullName]]{0,${PER_JOB_BUILDS}}`;
      const r = await fetchOne(url, `job:${j.name}`);
      if (r.ok && Array.isArray(r.data?.builds)) {
        jobBuilds[j.name] = r.data.builds;
      }
      return null;
    });
  }

  // SSO heuristic.
  if (ssoRedirectCount >= 2) {
    errors.push({ scope: 'auth', message: 'Suspected SSO redirect — token may be cookie not API token' });
  }

  // Aggregate.
  const agg = _aggregateJenkinsBuilds({
    folder,
    fetchedAt: new Date().toISOString(),
    jobs: candidates,
    jobBuilds,
  });
  agg.errors = errors;
  agg.tried = tried;
  agg.ssoRedirectCount = ssoRedirectCount;
  agg.elapsedMs = Date.now() - t0;
  agg.totalJobs = jobs.length;          // overall count, не capped
  agg.scannedJobs = candidates.length;  // что реально отсканировали
  // 2026-05-11 — какой path сработал: combined (1 запрос) или legacy
  // (jobs-list + 38 per-job). Видно в diagnostic для оптимизации.
  agg._strategy = folderBuildsAvailable ? 'combined' : 'legacy-per-job';

  _SCAN_CACHE.set(cacheKey, { ts: Date.now(), data: agg });

  _writeJson(res, 200, agg);
}

function create({ jiraForward, writeJson, ppMakeAuthHeader }) {
  _jiraForward = jiraForward;
  _writeJson = writeJson;
  _ppMakeAuthHeader = ppMakeAuthHeader;
  return { handleJenkinsVerify, handleJenkinsScan };
}

module.exports = { create, _aggregateJenkinsBuilds };
