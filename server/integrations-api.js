'use strict';
/* ============================================================
   server/integrations-api.js — V18 extraction (from server.js)

   Big switch over `/api/integrations/*` pathnames. Originally lived
   inline in server.js (~1045 LOC at line 1956). Extracted into a
   factory-pattern module so server.js can stay focused on routing /
   bootstrap.

   Endpoints covered (~22):
     • /jira-issue
     • /portfolio-pulse                    (legacy sync)
     • /portfolio-pulse/start              (async-job)
     • /portfolio-pulse/cancel/:jobId
     • /portfolio-pulse/status
     • /portfolio-pulse/employee-detail
     • /jira-fetch-all
     • /bitbucket-prs
     • /confluence-search
     • /verify-bitbucket
     • /sigma-verify
     • /tech-info
     • /black-dashboard/start
     • /black-dashboard/status
     • /black-dashboard
     • /jenkins-verify
     • /confluence-audit-logins
     • /confluence-resolve-user
     • /scanner-prefs
     • /diag-audit
     • /resolve-identities
     • /verify-confluence

   Dependencies are injected via `create({...})`. This keeps the module
   independent of server.js global state and lets callers swap upstream
   helpers (e.g. when pulse-runner extraction lands, _runPortfolioPulse
   will come from `./pulse-runner.js` instead of server.js — no change
   needed here).

   IMPORTANT: this module deliberately does NOT replicate logic from
   helpers; everything heavy (pulse runner, BD, TechInfo, Jenkins probe)
   stays in its own module and is passed in.
   ============================================================ */
const logger = require('./logger.js');

// Injected deps — populated by create().
let _writeJson, _readBody;
let _jiraReadConfig, _jiraSanitizeAreas;
let _jiraRequest, _jiraSearchAll, _jiraForward;
let _cfPathCascade;
let _ppMakeAuthHeader, _ppRedactSecretsInText;
let _runPortfolioPulse;
let _pulseCreateJob, _pulseGetJob, _pulseRunJob;
let _pulseCancelRegister, _pulseCancelMark, _pulseAssertNotCancelled;
let _pulseDetailRateAllow, _pulseDetailCacheGet, _pulseDetailCacheSet;
let _PULSE_DETAIL_RATE_WINDOW_MS;
let _bdCreateJob, _bdGetJob, _bdRunJob;
let _buildBlackDashboard, _sigmaCfgView;
let _buildTechInfo;
let _handleJenkinsVerify;
let _handleJenkinsScan;

async function handleIntegrationsApi(req, res, pathname) {
  // V13 (6th pass): /status endpoints are GET-only by design — они
  // poll-endpoints, идемпотентные, jobId в query-string. Everything
  // else stays POST-only as before.
  // V18.1 fix — добавлен '/portfolio-pulse/status' (V18 P7 ввёл async-job
  // pattern, но забыл обновить этот guard → клиент получал 405 на GET).
  const STATUS_POLL_PATHS = new Set([
    '/api/integrations/black-dashboard/status',
    '/api/integrations/portfolio-pulse/status',
  ]);
  const isStatusPoll = STATUS_POLL_PATHS.has(pathname);
  if (isStatusPoll) {
    if (req.method !== 'GET') { _writeJson(res, 405, { error: 'Method not allowed (GET required)' }); return; }
  } else {
    if (req.method !== 'POST') { _writeJson(res, 405, { error: 'Method not allowed' }); return; }
  }
  try {
    // GET requests don't have a body — skip readBody to avoid the 256kb wait.
    const raw = isStatusPoll ? '' : await _readBody(req, 256 * 1024);
    const body = raw ? JSON.parse(raw) : {};
    const cfg  = _jiraReadConfig();

    // ── helpers ──────────────────────────────────────────────
    const tls = !!cfg.allowInsecureTls;
    // V18 P6 — унифицировал на top-level _ppMakeAuthHeader (был локальный дубль).
    const makeAuthHeader = _ppMakeAuthHeader;

    // ── /api/integrations/jira-issue ─────────────────────────
    if (pathname === '/api/integrations/jira-issue') {
      const key = String(body.key || '').trim();
      if (!key) { _writeJson(res, 400, { error: 'Missing key' }); return; }
      if (!cfg.jiraBaseUrl || !cfg.jiraToken) { _writeJson(res, 400, { error: 'Jira не настроена' }); return; }
      // AUDIT_SCANNER #44 — expand=names позволяет UI резолвить customfield-ID'шники
      // (Epic Link, Story Points, …) по их названию из response без hardcode-маппинга.
      const issue = await _jiraRequest(cfg, 'GET', `/rest/api/2/issue/${encodeURIComponent(key)}?fields=status,assignee,updated&expand=names`);
      _writeJson(res, 200, {
        key,
        status:    issue.fields?.status?.name || '',
        assignee:  issue.fields?.assignee?.displayName || '',
        updatedAt: issue.fields?.updated || '',
      });
      return;
    }

    // ── /api/integrations/portfolio-pulse ────────────────────
    // V11 Portfolio Pulse: fetches Jira data for multiple project keys in one call,
    // returns flat per-PK reports with `error` set on individual failures (so one
    // broken PK doesn't kill the whole response).
    if (pathname === '/api/integrations/portfolio-pulse') {
      // V18 P7 — sync POST остался для backward-compat и contract-тестов;
      // вся логика выделена в `_runPortfolioPulse` чтобы async-job /start
      // мог переиспользовать тот же код. Новый frontend → /start + /status.
      try {
        const result = await _runPortfolioPulse(body, cfg, tls);
        _writeJson(res, 200, result);
      } catch (e) {
        _writeJson(res, e.statusCode || 500, { error: e.message || String(e) });
      }
      return;
    }

    // ── /api/integrations/portfolio-pulse/start ──────────────
    // V18 P7 — async-job pattern (mirrors /black-dashboard/start).
    if (pathname === '/api/integrations/portfolio-pulse/start') {
      // Fail-fast: явные ошибки валидации возвращаем СРАЗУ (без создания job),
      // чтобы клиент мог показать их сразу, а не через poll.
      if (!cfg.jiraBaseUrl || !cfg.jiraToken) {
        _writeJson(res, 400, { error: 'Jira не настроена' });
        return;
      }
      const job = _pulseCreateJob(body);
      // TECH 17.2 — register cancel-token для client-driven abort'а.
      _pulseCancelRegister(job.id);
      // V19 C4 — telemetry: pulse-job started (server-side counterpart
      // к scanner2.fetch_done с client-side latency).
      logger.event('pulse.start', {
        jobId: job.id,
        pkCount: (body.projectKeys || []).length,
        empCount: (body.employees || []).length,
      });
      _pulseRunJob(job, async (j) => {
        return await _runPortfolioPulse(body, cfg, tls, (newPhase) => {
          // TECH 17.2 — каждый phase-transition это natural abort-checkpoint.
          // Если клиент cancel'нул — кидаем здесь, до начала следующего этапа.
          _pulseAssertNotCancelled(j.id);
          j.phase = newPhase;
        });
      });
      _writeJson(res, 200, { jobId: job.id, startedAt: job.startedAt });
      return;
    }

    // ── /api/integrations/portfolio-pulse/cancel/:jobId ──────
    // TECH 17.2 — client-driven cancel. Frontend AbortController на fetch'е
    // отменяет HTTP-connection, но server-side job продолжал работать
    // 30+ сек (10+ pkScanned, 100+ Jira-страниц, 50+ BB-repos). Теперь:
    // клиент при abort шлёт POST на этот endpoint — мы выставляем флаг,
    // runner'а через pulseAssertNotCancelled() прервёт следующий этап,
    // job перейдёт в status='error', message='Pulse job cancelled by client'.
    // Idempotent: повторный cancel — 200 ok с already=true. Если jobId
    // не существует / истёк — 404 (frontend graceful skip — старый flow).
    if (pathname.startsWith('/api/integrations/portfolio-pulse/cancel/')) {
      const jobId = pathname.slice('/api/integrations/portfolio-pulse/cancel/'.length).trim();
      if (!jobId) { _writeJson(res, 400, { error: 'jobId path-param required' }); return; }
      const job = _pulseGetJob(jobId);
      if (!job) { _writeJson(res, 404, { error: 'Unknown jobId (TTL expired or never started)' }); return; }
      if (job.status !== 'running') {
        // Already done/error — cancel — no-op.
        _writeJson(res, 200, { jobId, cancelled: false, status: job.status, already: true });
        return;
      }
      const marked = _pulseCancelMark(jobId);
      logger.event('pulse.cancel_request', { jobId, marked });
      _writeJson(res, 200, { jobId, cancelled: marked, status: 'running', already: false });
      return;
    }

    // ── /api/integrations/portfolio-pulse/status?jobId=X[&withResult=1] ─────
    if (pathname === '/api/integrations/portfolio-pulse/status') {
      const qs = (req.url.split('?')[1] || '');
      const params = new URLSearchParams(qs);
      const jobId = (params.get('jobId') || '').trim();
      // V21 O (audit-2026-05-03 §C B8) — opt-in result payload. См. b-d/status.
      const withResult = params.get('withResult') === '1' || params.get('withResult') === 'true';
      const legacyMode = !params.has('withResult');
      const job = _pulseGetJob(jobId);
      if (!job) { _writeJson(res, 404, { error: 'Unknown jobId (возможно истёк TTL 120 мин — нажмите ↻ Обновить чтобы создать новый pulse-job)' }); return; }
      const out = {
        jobId:      job.id,
        status:     job.status,
        phase:      job.phase,
        startedAt:  job.startedAt,
        finishedAt: job.finishedAt,
        error:      job.error,
      };
      if (job.status === 'done' && (withResult || legacyMode)) out.result = job.result;
      else if (job.status === 'done' && !withResult && !legacyMode) out.resultAvailable = true;
      else                                                          out.result = null;
      _writeJson(res, 200, out);
      return;
    }

    // ── /api/integrations/portfolio-pulse/employee-detail ────
    // V18.1 P4 — lazy drill-down endpoint для Сканнера 2.0.
    // Берёт raw reports из cached pulse-job (TTL 30 мин), переиспользует
    // analysePulse + enrichForScanner2 для одного участника. Это точка
    // расширения для P5+ side-panel: позволяет (а) пересчитать enrichment
    // с другим dwellHours-порогом без re-fetch'а Jira, (б) в будущем —
    // browser-TZ heatmap (передаётся hourTZOffset).
    //
    // Cache-hit ≈ 200-500мс. Cache-miss → 404 (клиент должен заново
    // запустить /start). НЕ делаем re-fetch здесь, чтобы избежать
    // дублирования heavy логики.
    if (pathname === '/api/integrations/portfolio-pulse/employee-detail') {
      const jobId = String(body.jobId || '').trim();
      const employeeKey = String(body.employeeKey || '').trim();
      const dwellHours = Number(body.dwellHours) > 0 ? Number(body.dwellHours) : 24;
      // V18.1 P7-S2.3 — tzOffsetMin from browser. Если не передан —
      // server использует свой local time (legacy behavior, может «съехать»
      // для users в другой TZ).
      const tzOffsetMin = (typeof body.tzOffsetMin === 'number') ? body.tzOffsetMin : null;
      if (!jobId || !employeeKey) {
        _writeJson(res, 400, { error: 'jobId and employeeKey required' });
        return;
      }
      // V18.1 P7-S1.2 — rate-limit per-jobId 30 req / 60s. Защищает
      // analysePulse от DoS через retry-loop (любой knowing jobId).
      if (!_pulseDetailRateAllow(jobId)) {
        _writeJson(res, 429, {
          error: 'Rate limit: max 30 requests per minute per jobId',
          retryAfter: Math.ceil(_PULSE_DETAIL_RATE_WINDOW_MS / 1000),
        });
        return;
      }
      const job = _pulseGetJob(jobId);
      if (!job) { _writeJson(res, 404, { error: 'Unknown jobId (возможно истёк TTL 120 мин — нажмите ↻ Обновить чтобы создать новый pulse-job)' }); return; }
      if (job.status !== 'done') {
        _writeJson(res, 409, { error: `Job not done yet (status=${job.status})` });
        return;
      }
      if (!job.result) {
        _writeJson(res, 404, { error: 'Job has no result (cancelled or errored)' });
        return;
      }
      // V18.1 P7-S1.2 — result cache TTL 5 мин. Hit → no analysePulse re-run.
      // P7-S2.3: cache key включает tzOffsetMin (разные TZ → разные heatmap).
      const cached = _pulseDetailCacheGet(jobId, employeeKey, dwellHours, tzOffsetMin);
      if (cached) {
        _writeJson(res, 200, {
          ...cached,
          meta: { ...(cached.meta || {}), fromCache: true, fromResultCache: true },
        });
        return;
      }
      const t0 = Date.now();
      try {
        // ESM modules — Node auto-reparse'ит через dynamic import.
        // NOTE: paths relative to this file (server/integrations-api.js).
        // `../integrations/...` resolves to repo-root /integrations/ — same
        // place server.js used to import from.
        const { analysePulse } = await import('../integrations/portfolioPulseModel.js');
        const { enrichForScanner2 } = await import('../integrations/teamScanner2Enrichment.js');
        // employees: пустой массив — server не имеет доступа к state.employees,
        // identity-mapping не нужен для drill-down (key уже известен).
        const baseModel = analysePulse(job.result, { staleDays: 7, employees: [] });
        // V18.1 P7-S2.3 — tzOffsetMin прокидывается в enrichment.
        const enriched  = enrichForScanner2(baseModel, job.result, {
          dwellHours,
          ...(typeof tzOffsetMin === 'number' ? { tzOffsetMin } : {}),
        });
        const p = (enriched.participants || []).find(x => x.key === employeeKey);
        if (!p) {
          _writeJson(res, 404, { error: 'employeeKey not found in cached participants' });
          return;
        }
        const payload = {
          employee: {
            key:           p.key,
            label:         p.label,
            email:         p.email,
            jiraAccountId: p.jiraAccountId,
            avatar:        p.avatar,
            // V18.1 P7-S1.2 — defensive: projects может быть Set до Array.from
            //   на model.js:629. Если кто-то рефакторит pp model — JSON.stringify(Set)
            //   = '{}'. Здесь явно конвертируем.
            projects:      Array.isArray(p.projects) ? p.projects : Array.from(p.projects || []),
          },
          enrichment: {
            heatmap:         p.heatmap,
            contextSwitches: p.contextSwitches,
            timeline72h:     p.timeline72h,
            blockers:        p.blockers,
          },
          aggregates: {
            loggedTodaySec:     p.loggedTodaySec     || 0,
            loggedYesterdaySec: p.loggedYesterdaySec || 0,
            loggedDayBeforeSec: p.loggedDayBeforeSec || 0,
            badges:             p.badges             || {},
            issuesNowCount:    (p.issuesNow || []).length,
            staleCount:        (p.stale     || []).length,
          },
          meta: {
            fromCache: true,
            fromResultCache: false,
            jobId,
            builtMs: Date.now() - t0,
            dwellThresholdHours: enriched.scannerV2?.dwellThresholdHours ?? dwellHours,
            serverLocalTZ:       enriched.scannerV2?.serverLocalTZ       ?? (tzOffsetMin === null),
            tzOffsetMin:         enriched.scannerV2?.tzOffsetMin ?? tzOffsetMin,
          },
        };
        _pulseDetailCacheSet(jobId, employeeKey, dwellHours, tzOffsetMin, payload);
        // V19 C4 — telemetry: drill-down compute с latency.
        logger.event('pulse.detail_built', {
          jobId, builtMs: payload.meta.builtMs, dwellHours, hasTz: tzOffsetMin !== null,
        });
        _writeJson(res, 200, payload);
      } catch (e) {
        logger.error('[employee-detail] enrichment failed', { err: e?.message || String(e), jobId, employeeKey });
        _writeJson(res, 500, { error: 'enrichment failed: ' + (e?.message || 'unknown') });
      }
      return;
    }

    // ── /api/integrations/jira-fetch-all ─────────────────────
    // Bulk-fetch issues from Jira. If areas (projectKeys) are configured — use them.
    // Otherwise fall back to "issues assigned to current user, unresolved, updated last 90 days".
    if (pathname === '/api/integrations/jira-fetch-all') {
      if (!cfg.jiraBaseUrl || !cfg.jiraToken) { _writeJson(res, 400, { error: 'Jira не настроена' }); return; }
      // Use unified `jiraProjectKeys` (comma-separated) if set; fall back to legacy `areas`
      let areas = _jiraSanitizeAreas(cfg.areas);
      const keys = String(cfg.jiraProjectKeys || '').split(',').map(s => s.trim()).filter(Boolean);
      if (keys.length) areas = keys.map(k => ({ name: k, projectKey: k }));
      const fields = ['summary','status','assignee','updated','priority','labels','issuetype','duedate','parent','resolution','components','fixVersions'];
      // Use configured cut-off date (default 2025-01-01); allow override per request
      const requestedSince = String(body.sinceDate || '').trim();
      const since = /^\d{4}-\d{2}-\d{2}$/.test(requestedSince) ? requestedSince : (cfg.sinceDate || '2025-01-01');
      let jql;
      if (areas.length) {
        const projects = areas.map(a => `"${a.projectKey}"`).join(',');
        jql = `project in (${projects}) AND updated >= "${since}" ORDER BY updated DESC`;
      } else {
        // No project areas configured — only fetch user's own issues since cutoff
        jql = `assignee = currentUser() AND updated >= "${since}" ORDER BY updated DESC`;
      }
      try {
        const issues = await _jiraSearchAll(cfg, jql, fields, [], 1500);
        const flat = issues.map(it => ({
          key:       it.key,
          summary:   it.fields?.summary || '',
          status:    it.fields?.status?.name || '',
          assignee:  it.fields?.assignee?.displayName || '',
          updatedAt: it.fields?.updated || '',
          priority:  it.fields?.priority?.name || '',
          labels:    Array.isArray(it.fields?.labels) ? it.fields.labels : [],
          issuetype: it.fields?.issuetype?.name || '',
          dueDate:   it.fields?.duedate || '',
          parentKey: it.fields?.parent?.key || '',
          components:(it.fields?.components || []).map(c => c.name).filter(Boolean),
          fixVersions:(it.fields?.fixVersions || []).map(v => v.name).filter(Boolean),
          team:      (it.fields?.components || []).map(c => c.name).filter(Boolean).join(', ') || '',
        }));
        _writeJson(res, 200, { issues: flat, jql, count: flat.length, areasUsed: areas.length });
      } catch(e) {
        _writeJson(res, 500, { error: e.message || String(e) });
      }
      return;
    }

    // ── /api/integrations/release2-fetch ─────────────────────
    // V22+ Phase 5 (Release 2.0 sub-tab).
    // Bulk-fetch объектов issuetype="Release 2.0" по projectKeys из jira_config.
    // Поддерживает фильтры:
    //   · body.statuses[]    — массив статусов для исключения (default: 3 терминальных)
    //   · body.sinceDate     — created-cutoff YYYY-MM-DD (default из cfg.sinceDate)
    //   · body.includeAllStatuses — bool, отключает status-exclude
    //   · body.projectKeys[] — override jiraProjectKeys из cfg
    //   · body.maxResults    — cap результата (default 500)
    // Возвращает RAW issues — клиент сам нормализует через release2Model.
    if (pathname === '/api/integrations/release2-fetch') {
      if (!cfg.jiraBaseUrl || !cfg.jiraToken) {
        _writeJson(res, 400, { error: 'Jira не настроена' });
        return;
      }
      // Project keys: из body или из config.
      let projectKeys = Array.isArray(body.projectKeys) ? body.projectKeys.filter(Boolean) : [];
      if (!projectKeys.length) {
        projectKeys = String(cfg.jiraProjectKeys || '').split(',').map(s => s.trim()).filter(Boolean);
      }
      if (!projectKeys.length) {
        _writeJson(res, 400, { error: 'Не настроены jiraProjectKeys в jira_config' });
        return;
      }

      // Default-исключаемые статусы (терминальные)
      const DEFAULT_EXCLUDED_STATUSES = ['Установлен на ПРОМ', 'Установка на ПРОМ', 'Отменено'];
      const includeAll = body.includeAllStatuses === true;
      const statusesToExclude = includeAll
        ? []
        : (Array.isArray(body.statuses) && body.statuses.length
            ? body.statuses
            : DEFAULT_EXCLUDED_STATUSES);

      // Date cutoff
      const requestedSince = String(body.sinceDate || '').trim();
      const since = /^\d{4}-\d{2}-\d{2}$/.test(requestedSince)
        ? requestedSince
        : (cfg.sinceDate || '2025-01-01');

      // JQL builder
      const projectClause = `project in (${projectKeys.map(k => `"${k}"`).join(',')})`;
      const statusClause = statusesToExclude.length
        ? ' AND ' + statusesToExclude.map(s => `status != "${s}"`).join(' AND ')
        : '';
      const dateClause = ` AND created > "${since}"`;
      const jql = `issuetype = "Release 2.0" AND ${projectClause}${statusClause}${dateClause} ORDER BY priority DESC, created DESC`;

      // Fields: стандартные + список custom-полей (~56 штук).
      // Custom-field IDs захардкожены в integrations/release2/release2Fields.js
      // на клиенте, но сервер просто запрашивает всё что попросили + standard.
      const requestedFields = Array.isArray(body.fields) && body.fields.length
        ? body.fields
        : null;
      const fields = requestedFields || [
        'summary', 'status', 'priority', 'issuetype', 'project',
        'reporter', 'assignee', 'created', 'updated', 'duedate',
        'labels', 'components', 'fixVersions',
        'issuelinks', 'subtasks', 'attachment',
        // Custom — клиент должен передавать список нужных field-id в body.fields.
        // Если не передаёт — fallback на «все custom» через '*all'.
        '*all',
      ];

      // Expand: nameы полей + рендеренные значения (для description).
      const expand = ['names', 'schema'];

      // Cap результата (default 500 — Release 2.0 редко > 100 активных).
      const maxResults = Math.min(Math.max(50, Number(body.maxResults) || 500), 2000);

      try {
        const issues = await _jiraSearchAll(cfg, jql, fields, expand, maxResults);
        // Клиент сам нормализует через release2Model.js. Возвращаем raw.
        _writeJson(res, 200, {
          issues,
          jql,
          count: issues.length,
          projectKeys,
          statusesExcluded: statusesToExclude,
          since,
          fetchedAt: new Date().toISOString(),
        });
      } catch (e) {
        logger.error('[release2-fetch] failed', { err: e?.message || String(e), jql });
        _writeJson(res, 500, { error: e?.message || String(e), jql });
      }
      return;
    }

    // ── /api/integrations/release2-related ───────────────────
    // V22+ Phase 5 (Release 2.0) — lazy fetch связанных Story/Bug по
    // ключам через jira-issue (без bulk). Используется при первом
    // expand'е релиза, для подкачки описаний и текущих статусов.
    // body: { keys: ['BIK-1', 'BIK-2', ...] }
    if (pathname === '/api/integrations/release2-related') {
      if (!cfg.jiraBaseUrl || !cfg.jiraToken) {
        _writeJson(res, 400, { error: 'Jira не настроена' });
        return;
      }
      const keys = Array.isArray(body.keys) ? body.keys.filter(k => /^[A-Z][A-Z0-9]+-\d+$/.test(String(k))) : [];
      if (!keys.length) {
        _writeJson(res, 400, { error: 'Need keys[] array of valid Jira-keys' });
        return;
      }
      // Через JQL-batch (issuekey in (K1, K2, ...)) — один запрос.
      const jql = `issuekey in (${keys.map(k => `"${k}"`).join(',')})`;
      const fields = ['summary', 'status', 'priority', 'issuetype', 'assignee', 'reporter', 'updated', 'duedate', 'labels'];
      try {
        const issues = await _jiraSearchAll(cfg, jql, fields, [], 200);
        _writeJson(res, 200, { issues, count: issues.length });
      } catch (e) {
        logger.error('[release2-related] failed', { err: e?.message || String(e) });
        _writeJson(res, 500, { error: e?.message || String(e) });
      }
      return;
    }

    // ── /api/integrations/bitbucket-prs ──────────────────────
    if (pathname === '/api/integrations/bitbucket-prs') {
      const jiraKey = String(body.jiraKey || '').trim();
      if (!jiraKey) { _writeJson(res, 400, { error: 'Missing jiraKey' }); return; }
      if (!cfg.bitbucketBaseUrl || !cfg.bitbucketToken) { _writeJson(res, 400, { error: 'Bitbucket не настроен' }); return; }
      const base       = cfg.bitbucketBaseUrl.replace(/\/+$/, '');
      const authHeader = makeAuthHeader(cfg.bitbucketToken);
      const projectKeys = String(cfg.bitbucketProjectKeys || '').split(',').map(s => s.trim()).filter(Boolean);
      const prs = [];
      const targets = projectKeys.length ? projectKeys : ['_'];
      for (const proj of targets.slice(0, 5)) {
        try {
          const searchUrl = proj === '_'
            ? `${base}/pullrequests?q=title~"${encodeURIComponent(jiraKey)}"&pagelen=10`
            : `${base}/repositories/${encodeURIComponent(proj)}/pullrequests?q=title~"${encodeURIComponent(jiraKey)}"&pagelen=10`;
          const resp = await _jiraForward({
            targetUrl: searchUrl, method: 'GET',
            headers: { Authorization: authHeader },
            allowInsecureTls: tls,
          });
          if (resp.status < 300) {
            const data = JSON.parse(resp.text);
            (data.values || []).forEach(pr => {
              prs.push({
                url:       pr.links?.html?.href || '',
                status:    (pr.state || '').toLowerCase(),
                title:     pr.title || '',
                updatedAt: pr.updated_on || '',
                reviewers: (pr.reviewers || []).length,
              });
            });
          }
        } catch(_) {}
      }
      _writeJson(res, 200, { prs, jiraKey });
      return;
    }

    // ── /api/integrations/confluence-search ──────────────────
    // V17.2 I2a — переписано:
    //   • path-cascade `/wiki/rest/...` → `/rest/...` → `/wiki/rest/api/content/search`
    //   • `Accept: application/json` (без него Server возвращает HTML за SSO)
    //   • CQL вместо `title=...` exact-match (раньше «PROJ-123» не находил
    //     страницы «PROJ-123 Спецификация»)
    //   • trim хвостового `/wiki` чтобы не получалось `…/wiki/wiki/rest/...`
    //   • явный 401-handler («токен просрочен или нет прав»)
    if (pathname === '/api/integrations/confluence-search') {
      const query = String(body.query || '').trim();
      if (!query) { _writeJson(res, 400, { error: 'Missing query' }); return; }
      if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) { _writeJson(res, 400, { error: 'Confluence не настроена' }); return; }
      // I2a — strip trailing `/` and trailing `/wiki` so the cascade can
      // independently try `/wiki/rest/...` без двойного префикса.
      const base = String(cfg.confluenceBaseUrl).replace(/\/+$/, '').replace(/\/wiki$/i, '');
      const requestedSince = String(body.sinceDate || '').trim();
      const since = /^\d{4}-\d{2}-\d{2}$/.test(requestedSince) ? requestedSince : (cfg.sinceDate || '2025-01-01');
      // V17.2 I2c — добавляем space-scope если задан в настройках.
      const _searchSpaceKeys = String(cfg.confluenceSpaceKeys || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
      const _spaceClause = _searchSpaceKeys.length
        ? ` AND space in (${_searchSpaceKeys.map(k => `"${k.replace(/"/g, '\\"')}"`).join(', ')})`
        : '';
      const cql = `(title ~ "${query.replace(/"/g, '\\"')}" OR text ~ "${query.replace(/"/g, '\\"')}") AND type = page${_spaceClause} ORDER BY lastModified DESC`;
      const tryPaths = [
        `${base}/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=20&expand=version,history.lastUpdated`,
        `${base}/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=20&expand=version,history.lastUpdated`,
        // Legacy Server fallback if `/content/search` not available.
        `${base}/wiki/rest/api/content?type=page&title=${encodeURIComponent(query)}&limit=20&expand=version`,
        `${base}/rest/api/content?type=page&title=${encodeURIComponent(query)}&limit=20&expand=version`,
      ];
      const headers = {
        Authorization: makeAuthHeader(cfg.confluenceToken),
        Accept: 'application/json',
      };
      // V18 P5 — переиспользует _cfPathCascade helper.
      const cascade = await _cfPathCascade(tryPaths, { headers, allowInsecureTls: tls });
      if (cascade.authError) {
        _writeJson(res, 200, { pages: [], query, sinceDate: since, error: `Confluence: HTTP ${cascade.authError} — токен просрочен или нет прав`, tried: cascade.tried });
        return;
      }
      const pages = [];
      if (cascade.ok) {
        let data;
        try { data = JSON.parse(cascade.text); }
        catch (_) {
          _writeJson(res, 200, { pages: [], query, sinceDate: since, error: 'Confluence вернул не-JSON (вероятно SSO/HTML)', tried: cascade.tried });
          return;
        }
        const sinceTs = Date.parse(since + 'T00:00:00Z');
        (data.results || []).forEach(p => {
          const lastMod = p.version?.when || p.history?.lastUpdated?.when || '';
          if (lastMod && Number.isFinite(sinceTs)) {
            const ts = Date.parse(lastMod);
            if (Number.isFinite(ts) && ts < sinceTs) return;
          }
          const webLink = p._links?.base && p._links?.webui ? p._links.base + p._links.webui : '';
          pages.push({ title: p.title || '', url: webLink, lastModified: lastMod });
        });
        if (pages.length > 5) pages.length = 5;
      }
      const errorMsg = cascade.ok ? '' : (cascade.error || 'Confluence недоступен');
      _writeJson(res, 200, { pages, query, sinceDate: since, ...(errorMsg ? { error: errorMsg, tried: cascade.tried } : {}) });
      return;
    }

    // ── /api/integrations/verify-bitbucket ───────────────────
    if (pathname === '/api/integrations/verify-bitbucket') {
      if (!cfg.bitbucketBaseUrl || !cfg.bitbucketToken) { _writeJson(res, 200, { ok: false, error: 'Bitbucket не настроен' }); return; }
      const base   = cfg.bitbucketBaseUrl.replace(/\/+$/, '');
      const authH  = makeAuthHeader(cfg.bitbucketToken);
      const fwd    = url => _jiraForward({ targetUrl: url, method: 'GET', headers: { Authorization: authH }, allowInsecureTls: tls });
      // Try Bitbucket Server first (/rest/api/1.0/profile/recent/repos),
      // then fall back to Bitbucket Cloud (/user)
      let who = '?';
      let ok  = false;
      const serverResp = await fwd(`${base}/rest/api/1.0/profile/recent/repos?limit=1`).catch(()=>null);
      if (serverResp && serverResp.status < 300) {
        ok = true; // Server — no user name from this endpoint, just confirms auth works
      } else if (serverResp && serverResp.status === 401) {
        _writeJson(res, 200, { ok: false, error: 'Неверный токен (401)' }); return;
      } else {
        // Fallback: Bitbucket Cloud
        const cloudResp = await fwd(`${base}/user`).catch(()=>null);
        if (cloudResp && cloudResp.status < 300) {
          const d = JSON.parse(cloudResp.text || '{}');
          who = d.display_name || d.username || '?';
          ok  = true;
        } else if (cloudResp && cloudResp.status === 401) {
          _writeJson(res, 200, { ok: false, error: 'Неверный токен (401)' }); return;
        } else {
          _writeJson(res, 200, { ok: false, error: `HTTP ${cloudResp?.status ?? 'нет ответа'} — проверьте Base URL` }); return;
        }
      }
      _writeJson(res, 200, { ok, who });
      return;
    }

    // ── /api/integrations/sigma-verify ───────────────────────
    if (pathname === '/api/integrations/sigma-verify') {
      if (!cfg.sigmaJiraBaseUrl || !cfg.sigmaJiraToken) { _writeJson(res, 200, { ok: false, error: 'Sigma Jira не настроена' }); return; }
      try {
        const sigCfg = _sigmaCfgView(cfg);
        const me = await _jiraRequest(sigCfg, 'GET', '/rest/api/2/myself');
        _writeJson(res, 200, { ok: true, who: me.displayName || me.name || '?' });
      } catch (e) {
        _writeJson(res, 200, { ok: false, error: e.message || String(e) });
      }
      return;
    }

    // ── /api/integrations/tech-info ──────────────────────────
    // Reuse the `body` already parsed at the top of handleIntegrationsApi —
    // calling readBody again would hang because the request stream is consumed.
    if (pathname === '/api/integrations/tech-info') {
      try {
        const source = ['all','jira','bitbucket','confluence'].includes(body.source) ? body.source : 'all';
        const forceRefresh = !!body.forceRefresh;
        const data = await _buildTechInfo(cfg, { source, forceRefresh });
        _writeJson(res, 200, data);
      } catch (e) {
        _writeJson(res, 500, { error: e?.message || String(e) });
      }
      return;
    }

    // ── /api/integrations/black-dashboard/start ──────────────
    // Async job pattern: returns jobId immediately; client polls /status.
    if (pathname === '/api/integrations/black-dashboard/start') {
      try {
        const job = _bdCreateJob();
        _bdRunJob(job, cfg);
        _writeJson(res, 200, { jobId: job.id, startedAt: job.startedAt });
      } catch (e) {
        _writeJson(res, 500, { error: e.message || String(e) });
      }
      return;
    }

    // ── /api/integrations/black-dashboard/status?jobId=X[&withResult=1] ─────
    if (pathname === '/api/integrations/black-dashboard/status') {
      try {
        const qs = (req.url.split('?')[1] || '');
        const params = new URLSearchParams(qs);
        const jobId = params.get('jobId') || '';
        // V21 O (audit-2026-05-03 §C B8) — opt-in result payload. Раньше
        // /status возвращал full job.result на КАЖДОМ poll, даже когда
        // клиент уже забрал результат. На больших отчётах это 5-50MB JSON
        // × N тиков polling. Теперь клиент пингует /status налегке, и явно
        // дозапрашивает withResult=1 один раз когда увидел status==='done'.
        // Backwards-compat: legacy клиенты (без флага) получают result как
        // раньше, чтобы не ломать прод.
        const withResult = params.get('withResult') === '1' || params.get('withResult') === 'true';
        const legacyMode = !params.has('withResult');
        const job = _bdGetJob(jobId);
        if (!job) { _writeJson(res, 404, { error: 'Unknown jobId (возможно истёк TTL 120 мин — нажмите ↻ Обновить чтобы создать новый pulse-job)' }); return; }
        const out = {
          jobId:     job.id,
          status:    job.status,
          phase:     job.phase,
          startedAt: job.startedAt,
          elapsedMs: Date.now() - job.startedAt,
        };
        if (job.finishedAt) {
          out.finishedAt = job.finishedAt;
          out.durationMs = job.finishedAt - job.startedAt;
        }
        if (job.status === 'done' && (withResult || legacyMode)) out.result = job.result;
        if (job.status === 'done' && !withResult && !legacyMode)  out.resultAvailable = true;
        if (job.status === 'error') out.error  = job.error;
        _writeJson(res, 200, out);
      } catch (e) {
        _writeJson(res, 500, { error: e.message || String(e) });
      }
      return;
    }

    // ── /api/integrations/black-dashboard ────────────────────
    // Legacy synchronous endpoint — kept for back-compat. New clients
    // should use /start + /status. This one will hit the same long-load
    // problem as before; documented intentionally.
    if (pathname === '/api/integrations/black-dashboard') {
      try {
        const data = await _buildBlackDashboard(cfg);
        _writeJson(res, 200, data);
      } catch (e) {
        _writeJson(res, 500, { error: e.message || String(e) });
      }
      return;
    }

    // ── /api/integrations/jenkins-verify ─────────────────────
    // V18 extraction — Jenkins probe v2 вынесен в server/jenkins.js.
    // Здесь delegating-handler: модуль сам пишет в res через writeJson.
    // Returns: { ok, who, jobsCount, jobsSample[], cultritsSample[],
    //   folder, crumbDetected, authScheme, reachedJenkins, ssoDetected,
    //   proxyDetected, diagnosis, suggestion, error, tried }
    if (pathname === '/api/integrations/jenkins-verify') {
      await _handleJenkinsVerify(res, { cfg, tls });
      return;
    }

    // ── /api/integrations/jenkins-scan (Phase 1 MVP, 2026-05-10) ──
    // POST body: { folder?, sinceTs? } — optional override от UI.
    // Returns full aggregation snapshot (fetchedAt, perJob, perAuthor,
    // summary, errors[], elapsedMs). Cache 5 мин per-folder.
    // Failure isolation: 401/timeout per-job не валит весь scan.
    if (pathname === '/api/integrations/jenkins-scan') {
      await _handleJenkinsScan(res, { cfg, tls, body });
      return;
    }

    // ── /api/integrations/confluence-audit-logins ────────────
    // V17.2 I2c (G7) — Audit log из Confluence: логины/выходы за окно.
    //   Endpoint /rest/api/audit?startDate=<ms>&endDate=<ms>&limit=1000.
    //   Может быть отключён в админке (Audit log → Configuration) или
    //   retention < окна — отдаём явное сообщение.
    if (pathname === '/api/integrations/confluence-audit-logins') {
      if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) { _writeJson(res, 400, { error: 'Confluence не настроена' }); return; }
      const base = String(cfg.confluenceBaseUrl).replace(/\/+$/, '').replace(/\/wiki$/i, '');
      const headers = { Authorization: makeAuthHeader(cfg.confluenceToken), Accept: 'application/json' };
      const winHours = Math.min(168, Math.max(1, Number(cfg.activityWindowHours) || 72));
      const startMs = Date.now() - winHours * 3600 * 1000;
      const endMs   = Date.now();
      // V18 P5 — переиспользует _cfPathCascade.
      const cascade = await _cfPathCascade([
        `${base}/wiki/rest/api/audit?startDate=${startMs}&endDate=${endMs}&limit=1000&start=0`,
        `${base}/rest/api/audit?startDate=${startMs}&endDate=${endMs}&limit=1000&start=0`,
      ], { headers, allowInsecureTls: tls, timeoutMs: 25000 });
      if (cascade.authError) {
        _writeJson(res, 200, { ok: false, error: `Audit log недоступен (HTTP ${cascade.authError}). Нужен Confluence administrator или audit-viewer.`, tried: cascade.tried });
        return;
      }
      if (!cascade.ok) {
        _writeJson(res, 200, { ok: false, error: 'Audit log endpoint не найден или недоступен. В админке: Audit log → Configuration.', tried: cascade.tried });
        return;
      }
      const tried = cascade.tried;     // alias чтобы не править все ссылки на tried ниже
      let parsed;
      try { parsed = JSON.parse(cascade.text); } catch (_) { parsed = null; }
      const records = parsed?.results || [];
      // Filter to login/logout entries. Confluence Server / DC summary patterns
      // обычно: «User logged in», «User logged out», «User logged in (single sign-on)».
      const isLoginEntry = (r) => {
        const s = String(r?.summary || '').toLowerCase();
        return s.includes('logged in') || s.includes('logged out') || s.includes('login') || s.includes('logout');
      };
      // Group by author identity → counts.
      const byUser = {};
      for (const rec of records) {
        if (!isLoginEntry(rec)) continue;
        const author = rec.author || rec.authorObject || rec.user || {};
        const key = String(author.userKey || author.username || author.name || author.email || '').toLowerCase();
        if (!key) continue;
        if (!byUser[key]) byUser[key] = {
          userKey: author.userKey || '',
          username: author.username || author.name || '',
          email: author.email || '',
          displayName: author.displayName || author.name || '',
          loginCount: 0,
          logoutCount: 0,
          lastLoginAt: '',
          items: [],
        };
        const summary = String(rec.summary || '').toLowerCase();
        const ts = Number(rec.creationDate) || Date.parse(rec.creationDate || '') || 0;
        if (summary.includes('logged out') || summary.includes('logout')) byUser[key].logoutCount++;
        else byUser[key].loginCount++;
        if (ts && ts > Date.parse(byUser[key].lastLoginAt || 0)) byUser[key].lastLoginAt = new Date(ts).toISOString();
        if (byUser[key].items.length < 50) {
          byUser[key].items.push({
            kind: (summary.includes('logout') || summary.includes('logged out')) ? 'logout' : 'login',
            at: ts ? new Date(ts).toISOString() : '',
            summary: rec.summary || '',
            remoteAddress: rec.remoteAddress || '',
          });
        }
      }
      // Audit может вернуть retention info в поле `auditRetentionPeriod`. Сразу подсветим.
      const retention = parsed?.retentionPeriod || parsed?.auditRetentionPeriod || null;
      _writeJson(res, 200, {
        ok: true,
        windowHours: winHours,
        users: Object.values(byUser).sort((a, b) => b.loginCount - a.loginCount),
        totalRecords: records.length,
        loginRecords: Object.values(byUser).reduce((n, u) => n + u.loginCount + u.logoutCount, 0),
        retention,
        tried,
      });
      return;
    }

    // ── /api/integrations/confluence-resolve-user ────────────
    // V17.2 I2c — резолвим пользователя по email или ФИО → возвращаем
    //   confluenceAccountId / username / displayName / email. Используется
    //   для автозаполнения identity-полей в карточке сотрудника.
    //   Cascade:
    //     1) `/wiki/rest/api/user/search?cql=user.emailAddress="..."` (Cloud)
    //     2) `/rest/api/search?cql=user.email~"..."` (DC, ~ префикс-search)
    //     3) `/rest/api/user/search?username=<email-prefix>`
    //     4) cql=user.fullname~"<fio>" если нет email
    if (pathname === '/api/integrations/confluence-resolve-user') {
      if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) { _writeJson(res, 400, { error: 'Confluence не настроена' }); return; }
      const email = String(body.email || '').trim().toLowerCase();
      const fullname = String(body.fullname || '').trim();
      if (!email && !fullname) { _writeJson(res, 400, { error: 'Нужен email или fullname' }); return; }
      const base = String(cfg.confluenceBaseUrl).replace(/\/+$/, '').replace(/\/wiki$/i, '');
      const headers = { Authorization: makeAuthHeader(cfg.confluenceToken), Accept: 'application/json' };
      const tried = [];
      const tryFetch = async (url) => {
        const r = await _jiraForward({ targetUrl: url, method: 'GET', headers, allowInsecureTls: tls }).catch((e) => ({ status: 0, text: String(e?.message || e) }));
        tried.push({ url: url.replace(/[?].*$/, '...'), status: r.status });
        return r;
      };
      const buildCandidates = () => {
        const out = [];
        if (email) {
          out.push(`${base}/wiki/rest/api/search/user?cql=${encodeURIComponent(`user.email = "${email}"`)}`);
          out.push(`${base}/rest/api/search?cql=${encodeURIComponent(`user.email = "${email}"`)}&limit=10`);
          const prefix = email.split('@')[0];
          if (prefix) {
            out.push(`${base}/rest/api/user/search?username=${encodeURIComponent(prefix)}&limit=10`);
            out.push(`${base}/wiki/rest/api/user/search?username=${encodeURIComponent(prefix)}&limit=10`);
          }
        }
        if (fullname) {
          out.push(`${base}/wiki/rest/api/search/user?cql=${encodeURIComponent(`user.fullname ~ "${fullname.replace(/"/g, '\\"')}"`)}`);
          out.push(`${base}/rest/api/search?cql=${encodeURIComponent(`user.fullname ~ "${fullname.replace(/"/g, '\\"')}"`)}&limit=10`);
        }
        return out;
      };
      let resolved = null;
      for (const url of buildCandidates()) {
        const r = await tryFetch(url);
        if (r.status === 401 || r.status === 403) {
          _writeJson(res, 200, { ok: false, error: `Confluence HTTP ${r.status} — токен просрочен`, tried });
          return;
        }
        if (r.status < 200 || r.status >= 300) continue;
        let parsed;
        try { parsed = JSON.parse(r.text); } catch (_) { continue; }
        // user/search format: { results: [{user: {...}}, ...] } or [{...}, ...]
        const results = Array.isArray(parsed) ? parsed
                       : Array.isArray(parsed?.results) ? parsed.results
                       : [];
        for (const item of results) {
          const u = item.user || item;
          const u_email = String(u.email || u.emailAddress || '').toLowerCase();
          if (email && u_email && u_email !== email) continue;
          if (email && !u_email) continue;     // не доверяем без email-подтверждения
          resolved = {
            accountId: u.accountId || u.userKey || '',
            username:  u.username  || u.name    || '',
            displayName: u.displayName || u.publicName || u.name || '',
            email: u_email || email || '',
            avatar: u.profilePicture?.path || u.avatarUrls?.['48x48'] || '',
          };
          break;
        }
        if (resolved) break;
      }
      if (!resolved) { _writeJson(res, 200, { ok: false, error: 'Пользователь не найден в Confluence', tried }); return; }
      _writeJson(res, 200, { ok: true, user: resolved, tried });
      return;
    }

    // ── /api/integrations/scanner-prefs ──────────────────────
    // V21 V1 — Server-side persistence для scanner preferences (cross-device
    // sync). Простейшая реализация: один JSON-файл на server.js рядом с
    // jira_config.json. Per-user через query=?user=<email>; user-segregated
    // store. Это POC — не production-grade, но закрывает запрос
    // «выбор команды должен сохраняться на 2-м устройстве».
    //
    // Schema:
    //   GET  /api/integrations/scanner-prefs?user=<email>
    //     → { team, sprintFilter, showBlocked, ...другие toggle-флаги }
    //   POST /api/integrations/scanner-prefs?user=<email>
    //     body: { team?, sprintFilter?, ... } (partial update)
    //     → { ok: true }
    //
    // SECURITY: user строка из query, server-side НЕ валидирует identity —
    // production должен заменить на SAML-claim или authenticated session.
    // Сейчас trusted internal env (vanilla, без auth middleware), для пилота OK.
    if (pathname === '/api/integrations/scanner-prefs') {
      // V18 extraction note — server.js had a latent bug here: `parsedUrl`
      // was undefined in this scope, and the top-level method-guard rejects
      // GET (only black-dashboard/status + portfolio-pulse/status are GET-
      // poll endpoints). So GET to scanner-prefs returned 405 and POSTs
      // would crash with ReferenceError. Replacing with explicit
      // URLSearchParams from req.url so the POST path keeps working.
      const _qs = new URLSearchParams((req.url.split('?')[1] || ''));
      const userKey = String(_qs.get('user') || '').replace(/[^a-zA-Z0-9.@_-]/g, '').slice(0, 100);
      if (!userKey) { _writeJson(res, 400, { error: 'user query param required' }); return; }
      const path = require('path');
      const fs = require('fs');
      // V18 extraction — relative to server/integrations-api.js. Repo root
      // is parent dir, where scanner_prefs.json lived alongside server.js.
      const PREFS_FILE = path.resolve(__dirname, '..', 'scanner_prefs.json');
      let store = {};
      try {
        if (fs.existsSync(PREFS_FILE)) store = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8'));
      } catch (_) { store = {}; }
      if (req.method === 'GET') {
        _writeJson(res, 200, store[userKey] || {});
        return;
      }
      if (req.method === 'POST') {
        try {
          // Partial update: merge с существующим.
          const existing = store[userKey] || {};
          const incoming = body || {};
          // Whitelist known fields to prevent prototype pollution / arbitrary keys.
          const ALLOWED = ['team', 'sprintFilter', 'showBlocked', 'velocityCompare', 'velocityView', 'searchQuery', 'lastViewedAt'];
          const merged = { ...existing };
          for (const k of ALLOWED) {
            if (k in incoming) merged[k] = incoming[k];
          }
          merged.lastViewedAt = Date.now();
          store[userKey] = merged;
          fs.writeFileSync(PREFS_FILE, JSON.stringify(store, null, 2));
          logger.event('scanner_prefs.update', { userKey: userKey.slice(0, 30), keys: Object.keys(incoming) });
          _writeJson(res, 200, { ok: true, prefs: merged });
        } catch (e) {
          _writeJson(res, 500, { ok: false, error: 'failed to persist' });
        }
        return;
      }
      _writeJson(res, 405, { error: 'method not allowed' });
      return;
    }

    // ── /api/integrations/diag-audit ─────────────────────────
    // V20 S8 #14 — Server-side audit-log для diagnostic JSON export.
    // localStorage-only audit можно очистить — HR-compliance ненадёжен.
    // Логируем факт экспорта в structured-log → попадает в ELK через
    // server logger pipeline. БЕЗ contents — только метаданные.
    if (pathname === '/api/integrations/diag-audit') {
      try {
        logger.event('integrations.diag_audit', {
          mode:              String(body.mode || 'safe').slice(0, 16),
          sizeBytes:         Math.min(Number(body.sizeBytes) || 0, 10 * 1024 * 1024),
          pkCount:           Math.min(Number(body.pkCount) || 0, 100),
          consentGiven:      !!body.consentGiven,
          consentSource:     String(body.consentSource || 'unknown').slice(0, 32),
          disclaimerVersion: String(body.disclaimerVersion || '').slice(0, 32),
        });
        _writeJson(res, 200, { ok: true });
      } catch (e) {
        _writeJson(res, 500, { ok: false, error: 'audit log failed' });
      }
      return;
    }

    // ── /api/integrations/resolve-identities ─────────────────
    // V20 S4 — bulk resolver: для каждого { key, email, fullname }
    //   парраллельно дёргаем BB user-search + CF user-search,
    //   возвращаем найденные { bbLogin, bbDisplayName, cfAccountId,
    //   cfDisplayName }. ИЗ POV V17.2 I1c контракта это identity-
    //   deterministic: email — авторитетный SAML-claim, lookup по нему
    //   через API детерминированный, не fuzzy-match по ФИО.
    //
    // Concurrency: max 5 parallel to не уронить BB/CF при 100+ users.
    // Per-user timeout: 8 сек на источник.
    //
    // Ответ:
    //   { results: [{ key, email, bb: {ok, slug?, displayName?, error?},
    //                 cf: {ok, accountId?, displayName?, error?} }, ...],
    //     summary: { total, bbResolved, cfResolved } }
    if (pathname === '/api/integrations/resolve-identities') {
      const items = Array.isArray(body.items) ? body.items.slice(0, 500) : [];
      if (!items.length) { _writeJson(res, 400, { error: 'items[] is empty or missing' }); return; }
      const bbConfigured = !!(cfg.bitbucketBaseUrl && cfg.bitbucketToken);
      const cfConfigured = !!(cfg.confluenceBaseUrl && cfg.confluenceToken);
      const jkConfigured = !!(cfg.jenkinsBaseUrl && cfg.jenkinsToken);
      if (!bbConfigured && !cfConfigured && !jkConfigured) {
        _writeJson(res, 400, { error: 'Ни BB, ни Confluence, ни Jenkins не настроены — нечего резолвить' });
        return;
      }
      const bbBase = bbConfigured ? cfg.bitbucketBaseUrl.replace(/\/+$/, '') : null;
      const bbAuth = bbConfigured ? makeAuthHeader(cfg.bitbucketToken) : null;
      const cfBase = cfConfigured ? cfg.confluenceBaseUrl.replace(/\/+$/, '').replace(/\/wiki$/i, '') : null;
      const cfAuth = cfConfigured ? makeAuthHeader(cfg.confluenceToken) : null;
      const jkBase = jkConfigured ? cfg.jenkinsBaseUrl.replace(/\/+$/, '') : null;
      const jkAuth = jkConfigured ? makeAuthHeader(cfg.jenkinsToken) : null;

      const tryBbByEmail = async (email) => {
        // BB Server cascade:
        //   1) /rest/api/1.0/users?filter=<email>  — exact emailAddress match.
        //   2) (V22 BB-prefix) /rest/api/1.0/users?filter=<email-prefix> —
        //      попытка по prefix'у (часть до @). Срабатывает когда LDAP
        //      username совпадает с email-prefix'ом (типичный паттерн в
        //      Сбер-инстансах: `i.ivanov@sber.ru` → username `i.ivanov`).
        //      Проверяем оба варианта: точный prefix и без-точек (`iivanov`).
        //   3) Если несколько кандидатов — берём только при exact-match
        //      по slug/name (identity-deterministic, не fuzzy по ФИО).
        try {
          // Step 1 — exact email-match.
          const url1 = `${bbBase}/rest/api/1.0/users?filter=${encodeURIComponent(email)}&limit=10`;
          const r1 = await _jiraForward({ targetUrl: url1, method: 'GET', headers: { Authorization: bbAuth, Accept: 'application/json' }, allowInsecureTls: tls, timeoutMs: 8000 }).catch(e => ({ status: 0, text: String(e?.message || e) }));
          if (r1.status >= 200 && r1.status < 300) {
            const parsed = JSON.parse(r1.text || '{}');
            const values = Array.isArray(parsed.values) ? parsed.values : [];
            const match = values.find(u => String(u.emailAddress || '').toLowerCase() === email);
            if (match) {
              return { ok: true, slug: match.slug || match.name || '', displayName: match.displayName || '', emailAddress: match.emailAddress || '', via: 'email-exact' };
            }
          } else if (r1.status === 401 || r1.status === 403) {
            return { ok: false, error: `HTTP ${r1.status}` };
          }

          // Step 2 — prefix-match (V22 BB-prefix). Только если email содержит '@'.
          const at = email.indexOf('@');
          if (at <= 0) return { ok: false, error: 'не найден' };
          const prefix = email.slice(0, at);
          const variants = new Set([prefix]);
          // Без точек (`i.ivanov` → `iivanov`) — типичный alt-LDAP вариант.
          if (prefix.includes('.')) variants.add(prefix.replace(/\./g, ''));
          // 2026-05-11 — email `+tag` нормализация. Адреса вида
          // `ivan+sber@delta.ru` встречаются (Gmail-style suffix) —
          // LDAP-юзера зовут `ivan`, не `ivan+sber`. Без strip'а lookup
          // не находит. Добавляем `ivan` как кандидат к variants.
          const plusIdx = prefix.indexOf('+');
          if (plusIdx > 0) {
            const stripped = prefix.slice(0, plusIdx);
            variants.add(stripped);
            if (stripped.includes('.')) variants.add(stripped.replace(/\./g, ''));
          }
          for (const v of variants) {
            const url2 = `${bbBase}/rest/api/1.0/users?filter=${encodeURIComponent(v)}&limit=10`;
            const r2 = await _jiraForward({ targetUrl: url2, method: 'GET', headers: { Authorization: bbAuth, Accept: 'application/json' }, allowInsecureTls: tls, timeoutMs: 8000 }).catch(e => ({ status: 0, text: String(e?.message || e) }));
            if (r2.status < 200 || r2.status >= 300) continue;
            const parsed2 = JSON.parse(r2.text || '{}');
            const values2 = Array.isArray(parsed2.values) ? parsed2.values : [];
            // Identity-deterministic: только точный slug/name == prefix-variant.
            const exact = values2.find(u =>
              String(u.slug || '').toLowerCase() === v.toLowerCase() ||
              String(u.name || '').toLowerCase() === v.toLowerCase(),
            );
            if (exact) {
              return { ok: true, slug: exact.slug || exact.name || '', displayName: exact.displayName || '', emailAddress: exact.emailAddress || '', via: `prefix-${v === prefix ? 'dot' : 'no-dot'}` };
            }
          }
          return { ok: false, error: 'не найден' };
        } catch (e) { return { ok: false, error: _ppRedactSecretsInText(e.message || 'thrown', 100) }; }
      };

      const tryCfByEmail = async (email, fullname, bbLogin) => {
        // V20 S5.2 — CF cascade redesigned для Sber Confluence DC.
        //
        // Контекст из API-примеров (Confluence DC 7.x):
        //   · user.email cql НЕ работает (всегда 0 results)
        //   · /rest/api/user?username=X нужен NUMERIC LDAP id, не email-prefix
        //   · /rest/api/search?cql=user.fullname="ФИО" работает по ТОЧНОМУ
        //     ФИО match (это наш ключ — берём fio из Jira displayName).
        //   · audit log пишет author.name = ФИО → можно match'ить obratno.
        //
        // Cascade:
        //   1) cql=user.fullname="<FIO>"  — точный match по ФИО (требует
        //      fullname в input'ах, что мы передаём из state.employees.fio)
        //   2) cql=user.fullname~"<FIO>"  — подстрока (lucene tilde-search)
        //   3) /rest/api/user/search?username=<email-prefix>  — может сработать
        //      если username совпадает с email-prefix (бывает у некоторых
        //      сетапов LDAP).
        //   4) cql=user.email = "..."     — последний fallback на DC, обычно empty.
        //   5) (V22) /wiki/rest/api/search?cql=user.displayName="<FIO>"
        //      — search-API (vs user-search), exact-match по displayName.
        //      Другая семантика чем user.fullname (search vs user-search) —
        //      срабатывает на инстансах где user-search закрыт PAT-scope'ом,
        //      а content-search открыт.
        //   6) (V22) /rest/api/user?username=<bbLogin> — direct user-lookup.
        //      Stash + Confluence в Сбере часто имеют общий LDAP username,
        //      т.е. bitbucketLogin === confluenceUsername. Срабатывает после
        //      того как BB resolve проставил bbLogin (или когда HR заполнил
        //      его руками в карточке сотрудника).
        //
        // Из ответа берём username (LDAP-numeric) → cfAccountId.
        try {
          const prefix = email.split('@')[0];
          const fioEsc = String(fullname || '').replace(/"/g, '\\"').trim();
          const bbLoginClean = String(bbLogin || '').trim();

          const candidates = [];
          if (fioEsc) {
            // 1) ТОЧНЫЙ match по ФИО — самый надёжный для Sber CF.
            candidates.push({ url: `${cfBase}/rest/api/search?cql=${encodeURIComponent(`user.fullname = "${fioEsc}"`)}&limit=5`, step: 'fullname-exact' });
            // 2) Подстрока ФИО — cheaper fallback (синтаксис `~` в DC).
            candidates.push({ url: `${cfBase}/rest/api/search?cql=${encodeURIComponent(`user.fullname ~ "${fioEsc}"`)}&limit=5`, step: 'fullname-tilde' });
          }
          if (prefix) {
            // 3) username-as-email-prefix lookup.
            candidates.push({ url: `${cfBase}/rest/api/user/search?username=${encodeURIComponent(prefix)}&limit=5`, step: 'username-prefix' });
          }
          // 4) email cql — final fallback, обычно 0 в DC.
          candidates.push({ url: `${cfBase}/rest/api/search?cql=${encodeURIComponent(`user.email = "${email}"`)}&limit=5`, step: 'email-cql' });
          if (fioEsc) {
            // 5) NEW V22: search-API (не user-search) с displayName-cql.
            //    /wiki/-prefix целево даёт CF Cloud-style endpoint, в DC
            //    обычно тоже отвечает (mounted на /wiki). Если 404 — silent
            //    skip (cascade продолжается).
            candidates.push({ url: `${cfBase}/wiki/rest/api/search?cql=${encodeURIComponent(`user.displayName = "${fioEsc}"`)}&limit=5`, step: 'search-displayname' });
          }
          if (bbLoginClean) {
            // 6) NEW V22: direct user-lookup по bbLogin (Stash↔CF shared LDAP).
            //    Точечный GET по конкретному username; если CF instance его
            //    знает — вернёт user-объект сразу без CQL.
            candidates.push({ url: `${cfBase}/rest/api/user?username=${encodeURIComponent(bbLoginClean)}`, step: 'bb-login-direct' });
          }

          const triedDebug = [];
          // V20 S6.1 — early-break tracking. Если первые 2 candidate'а вернули
          // 200 OK с пустым result — дальше пробовать бесполезно (CQL не
          // настроен на этом instance). Сохраняем cascade time с ~12 мин до
          // ~20-40 сек на 110 сотрудников при широком unsupported.
          let consecutiveEmptyOk = 0;
          for (const cand of candidates) {
            const url  = cand.url;
            const step = cand.step;
            const r = await _jiraForward({ targetUrl: url, method: 'GET', headers: { Authorization: cfAuth, Accept: 'application/json' }, allowInsecureTls: tls, timeoutMs: 8000 }).catch(e => ({ status: 0, text: String(e?.message || e) }));
            triedDebug.push(`${url.replace(/\?.*$/, '...')} → ${r.status}`);
            if (r.status === 401 || r.status === 403) return { ok: false, error: `HTTP ${r.status}: токен Confluence не имеет прав на user-search` };
            if (r.status < 200 || r.status >= 300) continue;
            // V22 — step 6 `/rest/api/user?username=` отдаёт single user-объект,
            // не {results:[]}. Нормализуем чтобы единый match-loop ниже работал.
            let parsed; try { parsed = JSON.parse(r.text); } catch (_) { continue; }
            let results;
            if (step === 'bb-login-direct') {
              // Direct user-lookup → один объект (или {} если не найден).
              results = (parsed && (parsed.username || parsed.name || parsed.userKey || parsed.accountId)) ? [parsed] : [];
            } else {
              results = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.results) ? parsed.results : [];
            }
            // V20 S6.1 — если 200 OK + пустой результат → это «эндпоинт
            // ответил, но не нашёл». 2 подряд таких → break cascade.
            if (results.length === 0) {
              consecutiveEmptyOk++;
              if (consecutiveEmptyOk >= 2) break;
              continue;
            }
            consecutiveEmptyOk = 0;
            // V20 S7 B8 — collect all FIO matches, return ambiguous if >1.
            // Раньше брали первого «по индексу» при тёзках — недетерминированно.
            const fioMatches = [];
            let exactEmailMatch = null;
            for (const item of results) {
              const u = item.user || item;
              const u_email = String(u.email || u.emailAddress || '').toLowerCase().trim();
              const u_fullname = String(u.displayName || u.publicName || u.name || u.title || '').trim();
              const exactEmail = u_email && u_email === email;
              const exactFio   = fioEsc && u_fullname && u_fullname.toLowerCase() === fioEsc.toLowerCase();
              const username = u.username || u.name || u.userName || _extractUsernameFromCfUri(u);
              if (!username) continue;
              const candidate = {
                accountId:   u.userKey || u.accountId || u.key || username,
                username,
                displayName: u_fullname || username,
              };
              if (exactEmail) { exactEmailMatch = { ...candidate, matchedBy: 'email' }; break; }
              if (exactFio) fioMatches.push(candidate);
              else if (results.length === 1) fioMatches.push(candidate);     // single — trust
            }
            if (exactEmailMatch) return { ok: true, ...exactEmailMatch, matchedStep: step };
            if (fioMatches.length === 1) {
              return { ok: true, ...fioMatches[0], matchedBy: 'fio', matchedStep: step };
            }
            if (fioMatches.length > 1) {
              // Ambiguous — несколько тёзок. Возвращаем кандидатов для UI choice.
              return {
                ok: false,
                error: `ambiguous: ${fioMatches.length} тёзок с ФИО "${fioEsc}"`,
                ambiguousCandidates: fioMatches.map(c => ({ username: c.username, displayName: c.displayName })),
              };
            }
          }
          return { ok: false, error: `не найден; tried ${triedDebug.length} endpoints (last: ${triedDebug[triedDebug.length-1] || 'none'})` };
        } catch (e) { return { ok: false, error: _ppRedactSecretsInText(e.message || 'thrown', 100) }; }
      };

      // Phase-2 Jenkins (2026-05-10) — Jenkins user resolution.
      // Стратегия (cascade):
      //   1) GET /asynchPeople/api/json?tree=users[user[fullName,id]]
      //      → exact case-insensitive whitespace-trim match по fullName
      //      из state.employees.fio (ФИО, который Jira отдаёт).
      //   2) GET /user/<email-prefix>/api/json → если 200 → user exists.
      //      Используется как fallback когда Jenkins userId совпадает с
      //      email-prefix (часто, но не всегда — у Сбер-Jenkins обычно
      //      LDAP-numeric, не email-prefix).
      // Возврат: { ok, jenkinsUserName, fullName?, error? }.
      // Identity-deterministic per CLAUDE.md контракт #2 — никаких
      // fuzzy-match'ей, только exact ФИО или прямой prefix-hit.
      let _jenkinsPeopleCache = null; // Map<normFullName, { id, fullName }>
      const _jkNorm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
      const _loadJenkinsPeople = async () => {
        if (_jenkinsPeopleCache) return _jenkinsPeopleCache;
        try {
          const url = `${jkBase}/asynchPeople/api/json?tree=users[user[fullName,id,absoluteUrl]]`;
          const r = await _jiraForward({
            targetUrl: url, method: 'GET',
            headers: { Authorization: jkAuth, Accept: 'application/json',
                       'User-Agent': 'Mozilla/5.0 sbof-planner/1.0' },
            allowInsecureTls: tls, timeoutMs: 8000,
          }).catch(e => ({ status: 0, text: String(e?.message || e) }));
          if (r.status < 200 || r.status >= 300) {
            _jenkinsPeopleCache = new Map();
            return _jenkinsPeopleCache;
          }
          let parsed; try { parsed = JSON.parse(r.text); } catch (_) { parsed = null; }
          const m = new Map();
          const users = Array.isArray(parsed?.users) ? parsed.users : [];
          for (const wrap of users) {
            const u = wrap?.user || wrap;
            const fullName = String(u?.fullName || '').trim();
            const id = String(u?.id || u?.absoluteUrl?.split('/user/')?.[1]?.replace(/\/+$/, '') || '').trim();
            if (!fullName || !id) continue;
            const key = _jkNorm(fullName);
            if (key && !m.has(key)) m.set(key, { id, fullName });
          }
          _jenkinsPeopleCache = m;
          return m;
        } catch (_) {
          _jenkinsPeopleCache = new Map();
          return _jenkinsPeopleCache;
        }
      };
      const tryJenkinsByEmailFio = async (email, fullname) => {
        try {
          const fioNorm = _jkNorm(fullname);
          if (fioNorm) {
            const people = await _loadJenkinsPeople();
            const hit = people.get(fioNorm);
            if (hit) {
              return { ok: true, jenkinsUserName: hit.id, fullName: hit.fullName, matchedBy: 'fullName' };
            }
          }
          const prefix = String(email || '').split('@')[0];
          if (prefix) {
            const url = `${jkBase}/user/${encodeURIComponent(prefix)}/api/json`;
            const r = await _jiraForward({
              targetUrl: url, method: 'GET',
              headers: { Authorization: jkAuth, Accept: 'application/json',
                         'User-Agent': 'Mozilla/5.0 sbof-planner/1.0' },
              allowInsecureTls: tls, timeoutMs: 6000,
            }).catch(e => ({ status: 0, text: String(e?.message || e) }));
            if (r.status >= 200 && r.status < 300) {
              try {
                const parsed = JSON.parse(r.text || '{}');
                const fn = String(parsed?.fullName || '').trim();
                return { ok: true, jenkinsUserName: prefix, fullName: fn || prefix, matchedBy: 'prefix' };
              } catch (_) {
                return { ok: true, jenkinsUserName: prefix, fullName: prefix, matchedBy: 'prefix' };
              }
            }
            if (r.status === 401 || r.status === 403) return { ok: false, error: `HTTP ${r.status}: Jenkins token не имеет прав` };
          }
          return { ok: false, error: 'не найден' };
        } catch (e) { return { ok: false, error: _ppRedactSecretsInText(e.message || 'thrown', 100) }; }
      };

      // CF user-объект иногда даёт username не напрямую, а в URL self-ссылке.
      // Пример: uri="https://confluence.../viewuser.action?username=19468503"
      function _extractUsernameFromCfUri(u) {
        const uri = u?._links?.self || u?.links?.self?.[0]?.href || u?.uri || '';
        if (!uri) return '';
        const m = String(uri).match(/[?&]username=([^&]+)/);
        return m ? decodeURIComponent(m[1]) : '';
      }

      // V21 R (audit-2026-05-03 §C B12) — concurrency 5 → 12. На 100 user'ах
      // 5 параллельных воркеров даёт ~110 сек (cascade per-user 8-12 сек).
      // BB и CF на on-prem справляются с 12+ concurrent fetches; keep-alive
      // agents (B5) держат сокеты, не плодя TLS-handshake. На 12 параллельно
      // итог ≈ 35-50 сек (×3 ускорение).
      const CONCURRENCY = 12;
      const results = new Array(items.length);
      let cursor = 0;
      const worker = async () => {
        while (cursor < items.length) {
          const i = cursor++;
          const it = items[i];
          const email    = String(it?.email    || '').trim().toLowerCase();
          const fullname = String(it?.fullname || '').trim();
          const key      = String(it?.key      || '').trim();
          // V22 — bbLogin попадает сюда из integrationsSync (caller знает
          // emp.bitbucketLogin). Используется в CF cascade step #6 как
          // direct user-lookup (Stash↔CF shared-LDAP heuristic).
          const bbLogin  = String(it?.bbLogin  || '').trim();
          if (!email && !fullname) {
            results[i] = { key, email: '', bb: { ok: false, error: 'нет email и fio' }, cf: { ok: false, error: 'нет email и fio' }, jenkins: { ok: false, error: 'нет email и fio' } };
            continue;
          }
          const [bb, cf, jenkins] = await Promise.all([
            (bbConfigured && email) ? tryBbByEmail(email) : Promise.resolve({ ok: false, error: email ? 'BB не настроен' : 'нет email' }),
            cfConfigured ? tryCfByEmail(email, fullname, bbLogin) : Promise.resolve({ ok: false, error: 'CF не настроен' }),
            jkConfigured ? tryJenkinsByEmailFio(email, fullname) : Promise.resolve({ ok: false, error: 'Jenkins не настроен' }),
          ]);
          results[i] = { key, email, fullname, bb, cf, jenkins };
        }
      };
      const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker());
      await Promise.all(workers);

      // 2026-05-11 — breakdown per integration: matched / notFound /
      // ambiguous / apiError / notConfigured / noEmail. Помогает диагностике:
      // «bbMatched: 7 из 50» — без breakdown непонятно почему 43 fail'нули.
      // Helper для классификации ошибки.
      const _classifyResult = (r, integration) => {
        const o = r?.[integration];
        if (!o) return 'unknown';
        if (o.ok) return 'matched';
        const err = String(o.error || '').toLowerCase();
        if (err.includes('не настроен')) return 'notConfigured';
        if (err.includes('нет email')) return 'noEmail';
        if (o.ambiguousCandidates || err.includes('ambiguous')) return 'ambiguous';
        if (/http [45]\d\d/.test(err)) return 'apiError';
        if (err.includes('не найден') || err.includes('not found')) return 'notFound';
        return 'otherError';
      };
      const _breakdown = (integration) => {
        const out = {
          matched: 0, notFound: 0, ambiguous: 0,
          apiError: 0, notConfigured: 0, noEmail: 0, otherError: 0,
        };
        for (const r of results) out[_classifyResult(r, integration)]++;
        return out;
      };
      // Sample failures для post-mortem (cap 10 per integration, NO PII —
      // key passed as-is, scrub apply'ится на клиенте через salt-hash).
      const _failSamples = (integration) => {
        return results
          .filter(r => {
            const cls = _classifyResult(r, integration);
            return cls !== 'matched' && cls !== 'notConfigured' && cls !== 'noEmail';
          })
          .slice(0, 10)
          .map(r => {
            const o = r[integration] || {};
            return {
              key:       String(r.key || ''),
              reason:    _classifyResult(r, integration),
              error:     o.error ? String(o.error).slice(0, 100) : null,
              matchedBy: o.matchedBy || null,
              via:       o.via || null,
              matchedStep: o.matchedStep || null,
            };
          });
      };

      const summary = {
        total:           items.length,
        bbResolved:      results.filter(r => r.bb?.ok).length,
        cfResolved:      results.filter(r => r.cf?.ok).length,
        jenkinsResolved: results.filter(r => r.jenkins?.ok).length,
        noEmail:         results.filter(r => !r.email).length,
        // V22 — telemetry per-step распределение CF успехов. Помогает
        // понять _какая_ ступень cascade тащит coverage (диагностика
        // эффекта новых fallback'ов 5 и 6 в production).
        cfFallbackBySearch:  results.filter(r => r.cf?.ok && r.cf?.matchedStep === 'search-displayname').length,
        cfFallbackByBbLogin: results.filter(r => r.cf?.ok && r.cf?.matchedStep === 'bb-login-direct').length,
        // 2026-05-11 — детальный breakdown + failure samples.
        bbBreakdown:      _breakdown('bb'),
        cfBreakdown:      _breakdown('cf'),
        jenkinsBreakdown: _breakdown('jenkins'),
        bbFailureSamples:      _failSamples('bb'),
        cfFailureSamples:      _failSamples('cf'),
        jenkinsFailureSamples: _failSamples('jenkins'),
      };
      logger.event('integrations.resolve_identities', summary);
      _writeJson(res, 200, { results, summary });
      return;
    }

    // ── /api/integrations/verify-confluence ──────────────────
    // V17.2 I2c — если заданы `confluenceSpaceKeys`, в первую очередь
    //   проверяем что мы видим первое пространство (это содержательнее
    //   чем абстрактный `/user/current`). Сбой → понятное сообщение
    //   «не видно пространство DEV (HTTP 403)» вместо «токен сломан».
    if (pathname === '/api/integrations/verify-confluence') {
      if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) { _writeJson(res, 200, { ok: false, error: 'Confluence не настроена' }); return; }
      const base = String(cfg.confluenceBaseUrl).replace(/\/+$/, '').replace(/\/wiki$/i, '');
      const headers = { Authorization: makeAuthHeader(cfg.confluenceToken), Accept: 'application/json' };
      const _spaceKeys = String(cfg.confluenceSpaceKeys || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
      const tried = [];
      // Step 1: если есть spaceKeys — проверяем доступ к каждому
      if (_spaceKeys.length) {
        const accessible = [];
        const denied = [];
        for (const key of _spaceKeys.slice(0, 5)) {     // cap = 5 чтобы не спамить
          const urls = [
            `${base}/wiki/rest/api/space/${encodeURIComponent(key)}`,
            `${base}/rest/api/space/${encodeURIComponent(key)}`,
          ];
          let foundIn = null;
          for (const url of urls) {
            const r = await _jiraForward({ targetUrl: url, method: 'GET', headers, allowInsecureTls: tls }).catch((e) => ({ status: 0, text: String(e?.message || e) }));
            tried.push({ url: url.replace(/\?.*$/, ''), status: r.status });
            if (r.status >= 200 && r.status < 300) { foundIn = url; break; }
            if (r.status === 401 || r.status === 403) {
              denied.push({ key, status: r.status });
              break;
            }
          }
          if (foundIn) accessible.push(key);
          else if (!denied.find(d => d.key === key)) denied.push({ key, status: '404' });
        }
        if (accessible.length) {
          _writeJson(res, 200, {
            ok: true,
            who: `${accessible.length}/${_spaceKeys.length} пространств доступно: ${accessible.join(', ')}${denied.length ? ' · нет доступа: ' + denied.map(d => `${d.key}(${d.status})`).join(', ') : ''}`,
            spaces: { accessible, denied }, tried,
          });
          return;
        }
        if (denied.find(d => d.status === 401 || d.status === 403)) {
          _writeJson(res, 200, { ok: false, error: `Нет доступа ни к одному из пространств: ${denied.map(d => `${d.key}(${d.status})`).join(', ')}`, tried });
          return;
        }
        // 404 на всех ключах — может, пространства не существуют в этом инстансе
        _writeJson(res, 200, { ok: false, error: `Пространства не найдены: ${_spaceKeys.join(', ')} (HTTP 404)`, tried });
        return;
      }
      // Step 2: fallback на user/current (когда spaceKeys пустые).
      // V18 P5 — переиспользует _cfPathCascade.
      const fallbackCascade = await _cfPathCascade([
        `${base}/wiki/rest/api/user/current`,
        `${base}/rest/api/user/current`,
        `${base}/wiki/rest/api/space?limit=1`,
        `${base}/rest/api/space?limit=1`,
      ], { headers, allowInsecureTls: tls });
      const allTried = [...tried, ...fallbackCascade.tried];
      if (fallbackCascade.authError) {
        _writeJson(res, 200, { ok: false, error: `Confluence HTTP ${fallbackCascade.authError} — токен просрочен или нет прав`, tried: allTried });
        return;
      }
      if (fallbackCascade.ok) {
        let who = '?';
        try { const d = JSON.parse(fallbackCascade.text); who = d.displayName || d.username || d.name || (Array.isArray(d.results) ? `${d.results.length} space(s)` : '?'); } catch(_) {}
        _writeJson(res, 200, { ok: true, who, tried: allTried });
        return;
      }
      _writeJson(res, 200, { ok: false, error: `Confluence недоступен (попробовано ${allTried.length} URL)`, tried: allTried });
      return;
    }

    _writeJson(res, 404, { error: 'Unknown integrations endpoint' });
  } catch(e) {
    _writeJson(res, 500, { error: e.message || String(e) });
  }
}

/**
 * Factory — wires injected dependencies and returns the bound handler.
 *
 * Parallel-agent note: when `_runPortfolioPulse` and `pulseCancel*` move
 * into `./pulse-runner.js`, only server.js call-site changes — function
 * references injected here keep working without edits to this file.
 */
function create(deps) {
  if (!deps) throw new Error('integrations-api.create: deps required');
  _writeJson                    = deps.writeJson;
  _readBody                     = deps.readBody;
  _jiraReadConfig               = deps.jiraReadConfig;
  _jiraSanitizeAreas            = deps.jiraSanitizeAreas;
  _jiraRequest                  = deps.jiraRequest;
  _jiraSearchAll                = deps.jiraSearchAll;
  _jiraForward                  = deps.jiraForward;
  _cfPathCascade                = deps.cfPathCascade;
  _ppMakeAuthHeader             = deps.ppMakeAuthHeader;
  _ppRedactSecretsInText        = deps.ppRedactSecretsInText;
  _runPortfolioPulse            = deps.runPortfolioPulse;
  _pulseCreateJob               = deps.pulseCreateJob;
  _pulseGetJob                  = deps.pulseGetJob;
  _pulseRunJob                  = deps.pulseRunJob;
  _pulseCancelRegister          = deps.pulseCancelRegister;
  _pulseCancelMark              = deps.pulseCancelMark;
  _pulseAssertNotCancelled      = deps.pulseAssertNotCancelled;
  _pulseDetailRateAllow         = deps.pulseDetailRateAllow;
  _pulseDetailCacheGet          = deps.pulseDetailCacheGet;
  _pulseDetailCacheSet          = deps.pulseDetailCacheSet;
  _PULSE_DETAIL_RATE_WINDOW_MS  = deps.PULSE_DETAIL_RATE_WINDOW_MS;
  _bdCreateJob                  = deps.bdCreateJob;
  _bdGetJob                     = deps.bdGetJob;
  _bdRunJob                     = deps.bdRunJob;
  _buildBlackDashboard          = deps.buildBlackDashboard;
  _sigmaCfgView                 = deps.sigmaCfgView;
  _buildTechInfo                = deps.buildTechInfo;
  _handleJenkinsVerify          = deps.handleJenkinsVerify;
  _handleJenkinsScan            = deps.handleJenkinsScan;
  return { handleIntegrationsApi };
}

module.exports = { create };
