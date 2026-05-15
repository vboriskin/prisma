'use strict';
/* ============================================================
   server/integrations/techInfo.js — V13 (extracted from server.js, audit #19).

   TECH INFO — debug-time aggregator over Jira / Bitbucket / Confluence.
   Powers the «🔧 Техническая информация» modal: a data-heavy snapshot
   of versions, projects, issue types, statuses, fields, boards, repos,
   spaces, etc. Each source cached independently for 10 minutes; on
   error we serve stale cache (with a flag) instead of failing.

   Deps come in via the factory `createTechInfo({ jiraRequest, jiraForward,
   makeBasicAuthHeader })` — server.js wires them at module-load time. We
   keep the cache as module state so successive calls share it.

   Public surface: `buildTechInfo(cfg, opts)` returns the full payload.
   ============================================================ */

const TECH_INFO_TTL_MS = 10 * 60 * 1000;
const TECH_INFO_TIMEOUT_MS = 15000;
const TECH_INFO_TOP_PROJECTS = 5;
const TECH_INFO_TOP_REPOS    = 5;
const TECH_INFO_TOP_SPACES   = 5;
const TECH_INFO_CUSTOMFIELD_OPTION_CAP = 20;
const TECH_INFO_BOARD_SPRINT_CAP = 3;

/** Tiny concurrency-bounded `Promise.allSettled` runner — used for
 *  per-project / per-repo / per-space sub-fetches so we don't open
 *  100 sockets at once. Returns an array of {ok, value} or {ok:false, error}. */
async function _tiPLimit(concurrency, jobs) {
  const results = new Array(jobs.length);
  let i = 0;
  await new Promise(resolve => {
    let running = 0;
    const next = () => {
      if (i >= jobs.length && running === 0) { resolve(); return; }
      while (running < concurrency && i < jobs.length) {
        const idx = i++;
        running++;
        Promise.resolve()
          .then(() => jobs[idx]())
          .then(v => { results[idx] = { ok: true, value: v }; })
          .catch(e => { results[idx] = { ok: false, error: e?.message || String(e) }; })
          .finally(() => { running--; next(); });
      }
    };
    next();
  });
  return results;
}

function _tiShapeProject(p) {
  return {
    id:              p.id || '',
    key:             p.key || '',
    name:            p.name || '',
    projectTypeKey:  p.projectTypeKey || '',
    leadDisplayName: p.lead?.displayName || '',
  };
}

function _tiShapeIssueType(t) {
  return {
    id:          t.id || '',
    name:        t.name || '',
    description: String(t.description || '').slice(0, 240),
    subtask:     !!t.subtask,
    iconUrl:     t.iconUrl || '',
  };
}

function _tiShapeStatus(s) {
  return {
    id:           s.id || '',
    name:         s.name || '',
    description:  String(s.description || '').slice(0, 240),
    statusCategoryKey:  s.statusCategory?.key || '',
    statusCategoryName: s.statusCategory?.name || '',
    statusCategoryColor:s.statusCategory?.colorName || '',
  };
}

function _tiShapeField(f) {
  return {
    id:        f.id || '',
    name:      f.name || '',
    custom:    !!f.custom,
    schemaType:    f.schema?.type   || '',
    schemaCustom:  f.schema?.custom || '',
  };
}

/**
 * Factory — wires runtime deps and returns `{ buildTechInfo }`.
 *
 * @param {object} deps
 * @param {Function} deps.jiraRequest          - (cfg, method, path, body?) → parsed-json
 * @param {Function} deps.jiraForward          - ({targetUrl, method, headers, ...}) → {status, text}
 * @param {Function} deps.makeBasicAuthHeader  - (token) → 'Basic xxx' (or 'Bearer xxx')
 */
function createTechInfo(deps) {
  const { jiraRequest, jiraForward, makeBasicAuthHeader } = deps;

  // Module-scope cache — shared across calls.
  const _techInfoCache = {
    jira:       { data: null, fetchedAt: 0 },
    bitbucket:  { data: null, fetchedAt: 0 },
    confluence: { data: null, fetchedAt: 0 },
  };

  /** Wrap `jiraRequest` (Jira credentials) — used by Jira fetchers. */
  async function _tiJiraGet(cfg, path) {
    return jiraRequest(cfg, 'GET', path);
  }

  /** Bitbucket-aware GET with explicit timeout. Returns parsed JSON or throws. */
  async function _tiBitbucketGet(cfg, tls, urlPath) {
    if (!cfg.bitbucketBaseUrl || !cfg.bitbucketToken) throw new Error('Bitbucket не настроен');
    const base = cfg.bitbucketBaseUrl.replace(/\/+$/, '');
    const auth = makeBasicAuthHeader(cfg.bitbucketToken);
    // V21 Y2 — useCache:false: techInfo держит собственный 10-мин cache на верхнем
    // уровне (forceRefresh эту cache сбрасывает). Если бы ниже jiraForward тоже
    // кэшировал — forceRefresh на верхнем не пробивал бы до сети, контракт сломан.
    const r = await jiraForward({
      targetUrl: base + urlPath, method: 'GET',
      headers: { Authorization: auth },
      allowInsecureTls: tls, timeoutMs: TECH_INFO_TIMEOUT_MS,
      useCache: false,
    });
    if (r.status < 200 || r.status >= 300) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    try { return JSON.parse(r.text); } catch { throw new Error('Bitbucket: невалидный JSON'); }
  }

  /** Confluence-aware GET with explicit timeout. Returns parsed JSON or throws. */
  async function _tiConfluenceGet(cfg, tls, urlPath) {
    if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) throw new Error('Confluence не настроен');
    const base = cfg.confluenceBaseUrl.replace(/\/+$/, '');
    const auth = makeBasicAuthHeader(cfg.confluenceToken);
    const r = await jiraForward({
      targetUrl: base + urlPath, method: 'GET',
      headers: { Authorization: auth },
      allowInsecureTls: tls, timeoutMs: TECH_INFO_TIMEOUT_MS,
      useCache: false,
    });
    if (r.status < 200 || r.status >= 300) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    try { return JSON.parse(r.text); } catch { throw new Error('Confluence: невалидный JSON'); }
  }

  async function _tiFetchJira(cfg) {
    if (!cfg.jiraBaseUrl || !cfg.jiraToken) throw new Error('Jira не настроена');

    const baseCallSpecs = [
      { key: 'serverInfo',    path: '/rest/api/2/serverInfo' },
      { key: 'myself',        path: '/rest/api/2/myself' },
      { key: 'projects',      path: '/rest/api/2/project' },
      { key: 'issueTypes',    path: '/rest/api/2/issuetype' },
      { key: 'statuses',      path: '/rest/api/2/status' },
      { key: 'priorities',    path: '/rest/api/2/priority' },
      { key: 'resolutions',   path: '/rest/api/2/resolution' },
      { key: 'fields',        path: '/rest/api/2/field' },
      { key: 'boards',        path: '/rest/agile/1.0/board?maxResults=50' },
    ];
    const baseResults = await Promise.allSettled(baseCallSpecs.map(s => _tiJiraGet(cfg, s.path)));

    const out = {
      serverInfo:           {},
      myself:               {},
      projects:             [],
      issueTypes:           [],
      statuses:             [],
      statusesByCategory:   { 'new': [], 'indeterminate': [], 'done': [] },
      priorities:           [],
      resolutions:          [],
      fields:               { system: [], custom: [] },
      statusesByProject:    {},
      customFieldOptions:   {},
      versionsByProject:    {},
      componentsByProject:  {},
      boards:               [],
      sprintsByBoard:       {},
      _truncated:           {},
      _errors:              {},
    };

    const get = (idx) => {
      const r = baseResults[idx];
      if (!r) return null;
      if (r.status === 'rejected') {
        out._errors[baseCallSpecs[idx].key] = r.reason?.message || String(r.reason);
        return null;
      }
      return r.value;
    };

    const si = get(0);
    if (si) {
      out.serverInfo = {
        version:        si.version || '',
        buildNumber:    si.buildNumber ?? '',
        deploymentType: si.deploymentType || '',
        serverTime:     si.serverTime || '',
        baseUrl:        si.baseUrl || cfg.jiraBaseUrl || '',
      };
    }

    const me = get(1);
    if (me) {
      out.myself = {
        name:         me.name || '',
        displayName:  me.displayName || '',
        emailAddress: me.emailAddress || '',
        active:       !!me.active,
      };
    }

    const projects = get(2);
    if (Array.isArray(projects)) {
      out.projects = projects.map(_tiShapeProject)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    }

    const issueTypes = get(3);
    if (Array.isArray(issueTypes)) {
      out.issueTypes = issueTypes.map(_tiShapeIssueType)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    }

    const statuses = get(4);
    if (Array.isArray(statuses)) {
      out.statuses = statuses.map(_tiShapeStatus);
      for (const s of out.statuses) {
        const cat = s.statusCategoryKey || 'indeterminate';
        const bucket = (cat === 'new' || cat === 'done' || cat === 'indeterminate') ? cat : 'indeterminate';
        out.statusesByCategory[bucket].push(s);
      }
    }

    const priorities = get(5);
    if (Array.isArray(priorities)) {
      out.priorities = priorities.map(p => ({
        id: p.id || '', name: p.name || '', iconUrl: p.iconUrl || '', statusColor: p.statusColor || '',
      }));
    }

    const resolutions = get(6);
    if (Array.isArray(resolutions)) {
      out.resolutions = resolutions.map(r => ({
        id: r.id || '', name: r.name || '', description: String(r.description || '').slice(0, 240),
      }));
    }

    const fields = get(7);
    if (Array.isArray(fields)) {
      const shaped = fields.map(_tiShapeField);
      out.fields.system = shaped.filter(f => !f.custom).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      out.fields.custom = shaped.filter(f =>  f.custom).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    }

    const boards = get(8);
    if (boards?.values) {
      out.boards = boards.values.slice(0, 50).map(b => ({ id: b.id, name: b.name || '', type: b.type || '' }));
    } else if (boards?._error) {
      out._errors.boards = boards._error;
    }

    let topPks = String(cfg.jiraProjectKeys || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!topPks.length && out.projects.length) {
      topPks = out.projects.slice(0, TECH_INFO_TOP_PROJECTS).map(p => p.key);
    } else {
      topPks = topPks.slice(0, TECH_INFO_TOP_PROJECTS);
    }

    const projectJobs = [];
    for (const pk of topPks) {
      projectJobs.push(async () => ({ pk, kind: 'statuses',   data: await _tiJiraGet(cfg, `/rest/api/2/project/${encodeURIComponent(pk)}/statuses`) }));
      projectJobs.push(async () => ({ pk, kind: 'versions',   data: await _tiJiraGet(cfg, `/rest/api/2/project/${encodeURIComponent(pk)}/versions`) }));
      projectJobs.push(async () => ({ pk, kind: 'components', data: await _tiJiraGet(cfg, `/rest/api/2/project/${encodeURIComponent(pk)}/components`) }));
    }
    const projectResults = await _tiPLimit(4, projectJobs);
    for (const r of projectResults) {
      if (!r.ok) continue;
      const { pk, kind, data } = r.value;
      if (kind === 'statuses' && Array.isArray(data)) {
        out.statusesByProject[pk] = data.map(it => ({
          issueTypeId:   it.id || '',
          issueTypeName: it.name || '',
          subtask:       !!it.subtask,
          statuses:      Array.isArray(it.statuses) ? it.statuses.map(_tiShapeStatus) : [],
        }));
      } else if (kind === 'versions' && Array.isArray(data)) {
        out.versionsByProject[pk] = data.map(v => ({
          id: v.id || '', name: v.name || '', description: String(v.description || '').slice(0, 240),
          released: !!v.released, archived: !!v.archived, releaseDate: v.releaseDate || '',
        }));
      } else if (kind === 'components' && Array.isArray(data)) {
        out.componentsByProject[pk] = data.map(c => ({
          id: c.id || '', name: c.name || '', description: String(c.description || '').slice(0, 240),
          leadDisplayName: c.lead?.displayName || '',
        }));
      }
    }

    const candidateCustomFields = out.fields.custom.filter(f =>
      /option|select|choice/i.test(f.schemaType || '') ||
      /option|select|cascading|multicheckbox|radiobutton/i.test(f.schemaCustom || ''),
    ).slice(0, TECH_INFO_CUSTOMFIELD_OPTION_CAP);
    const optionJobs = candidateCustomFields.map(f => async () => {
      try {
        const data = await _tiJiraGet(cfg, `/rest/api/2/customField/${encodeURIComponent(f.id.replace(/^customfield_/, ''))}/option`);
        return { id: f.id, options: Array.isArray(data?.values) ? data.values : (Array.isArray(data) ? data : []) };
      } catch {
        return { id: f.id, options: [] };
      }
    });
    const optionResults = await _tiPLimit(4, optionJobs);
    if (candidateCustomFields.length > TECH_INFO_CUSTOMFIELD_OPTION_CAP) {
      out._truncated.customFieldOptions = `показаны опции для первых ${TECH_INFO_CUSTOMFIELD_OPTION_CAP} полей`;
    }
    for (const r of optionResults) {
      if (!r.ok) continue;
      const { id, options } = r.value;
      if (options.length) {
        out.customFieldOptions[id] = options.map(o => ({
          id:    o.id || '',
          value: o.value || '',
          disabled: !!o.disabled,
        }));
      }
    }

    const boardSpecs = out.boards.slice(0, TECH_INFO_BOARD_SPRINT_CAP);
    const sprintJobs = boardSpecs.map(b => async () => {
      const data = await _tiJiraGet(cfg, `/rest/agile/1.0/board/${encodeURIComponent(b.id)}/sprint?state=active,future&maxResults=50`);
      return { boardId: b.id, sprints: Array.isArray(data?.values) ? data.values : [] };
    });
    const sprintResults = await _tiPLimit(3, sprintJobs);
    for (const r of sprintResults) {
      if (!r.ok) continue;
      const { boardId, sprints } = r.value;
      out.sprintsByBoard[boardId] = sprints.map(s => ({
        id: s.id, name: s.name || '', state: s.state || '',
        startDate: s.startDate || '', endDate: s.endDate || '',
        goal: String(s.goal || '').slice(0, 240),
      }));
    }

    return out;
  }

  async function _tiFetchBitbucket(cfg, tls) {
    if (!cfg.bitbucketBaseUrl || !cfg.bitbucketToken) throw new Error('Bitbucket не настроен');

    const base = cfg.bitbucketBaseUrl.replace(/\/+$/, '');
    const isCloud = /bitbucket\.org/i.test(base) || /\/2\.0\b/.test(base);
    if (isCloud) {
      return {
        cloudUnsupported: true,
        _info: 'Bitbucket Cloud не поддерживается в этом разделе — таб реализован для Server / Data Center',
      };
    }

    const out = {
      applicationProperties: {},
      projects: [],
      repos: [],
      branchesByRepo: {},
      _truncated: {},
      _errors: {},
    };

    const [appPropsR, projectsR, reposR] = await Promise.allSettled([
      _tiBitbucketGet(cfg, tls, '/rest/api/1.0/application-properties'),
      _tiBitbucketGet(cfg, tls, '/rest/api/1.0/projects?limit=100'),
      _tiBitbucketGet(cfg, tls, '/rest/api/1.0/repos?limit=100'),
    ]);

    if (appPropsR.status === 'fulfilled') {
      out.applicationProperties = {
        version:     appPropsR.value.version || '',
        buildNumber: appPropsR.value.buildNumber || '',
        displayName: appPropsR.value.displayName || '',
      };
    } else {
      out._errors.applicationProperties = appPropsR.reason?.message || String(appPropsR.reason);
    }

    if (projectsR.status === 'fulfilled') {
      const v = projectsR.value;
      out.projects = (v.values || []).map(p => ({
        key:    p.key || '', name: p.name || '', id: p.id || '',
        type:   p.type || '', description: String(p.description || '').slice(0, 240),
        public: !!p.public,
      })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      if (v.size && Number(v.size) > out.projects.length) {
        out._truncated.projects = `показано ${out.projects.length} из ${v.size}`;
      }
    } else {
      out._errors.projects = projectsR.reason?.message || String(projectsR.reason);
    }

    if (reposR.status === 'fulfilled') {
      const v = reposR.value;
      out.repos = (v.values || []).map(r => ({
        slug:           r.slug || r.name || '',
        name:           r.name || '',
        projectKey:     r.project?.key || '',
        defaultBranch:  r.defaultBranch || '',
        scmId:          r.scmId || '',
        public:         !!r.public,
      })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      if (v.size && Number(v.size) > out.repos.length) {
        out._truncated.repos = `показано ${out.repos.length} из ${v.size}`;
      }
    } else {
      out._errors.repos = reposR.reason?.message || String(reposR.reason);
    }

    const topRepos = out.repos.slice(0, TECH_INFO_TOP_REPOS);
    const branchJobs = topRepos.map(r => async () => {
      if (!r.projectKey || !r.slug) return null;
      const data = await _tiBitbucketGet(cfg, tls,
        `/rest/api/1.0/projects/${encodeURIComponent(r.projectKey)}/repos/${encodeURIComponent(r.slug)}/branches?limit=50`);
      return { projectKey: r.projectKey, slug: r.slug, data };
    });
    const branchResults = await _tiPLimit(3, branchJobs);
    for (const res of branchResults) {
      if (!res.ok || !res.value) continue;
      const { projectKey, slug, data } = res.value;
      const id = `${projectKey}/${slug}`;
      out.branchesByRepo[id] = (data.values || []).map(b => ({
        displayId:        b.displayId || b.id || '',
        isDefault:        !!b.isDefault,
        latestCommitHash: String(b.latestCommit || '').slice(0, 12),
      }));
      if (data.size && Number(data.size) > out.branchesByRepo[id].length) {
        out._truncated[`branches/${id}`] = `показано ${out.branchesByRepo[id].length} из ${data.size}`;
      }
    }

    return out;
  }

  async function _tiFetchConfluence(cfg, tls) {
    if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) throw new Error('Confluence не настроена');

    const out = {
      systemInfo: {},
      currentUser: {},
      spaces: [],
      labelsBySpace: {},
      templatesBySpace: {},
      _truncated: {},
      _errors: {},
    };

    const [sysR, userR, spacesR] = await Promise.allSettled([
      _tiConfluenceGet(cfg, tls, '/rest/api/settings/systemInfo').catch(e => { throw e; }),
      _tiConfluenceGet(cfg, tls, '/rest/api/user/current'),
      _tiConfluenceGet(cfg, tls, '/rest/api/space?limit=100&expand=description.plain'),
    ]);

    if (sysR.status === 'fulfilled') {
      out.systemInfo = {
        databaseExampleLatency: sysR.value.databaseExampleLatency ?? null,
        buildNumber:            sysR.value.buildNumber ?? '',
        version:                sysR.value.version || '',
      };
    } else {
      out._errors.systemInfo = sysR.reason?.message || 'systemInfo недоступно (требуются права администратора)';
    }

    if (userR.status === 'fulfilled') {
      out.currentUser = {
        username:    userR.value.username || '',
        userKey:     userR.value.userKey || '',
        displayName: userR.value.displayName || '',
      };
    } else {
      out._errors.currentUser = userR.reason?.message || String(userR.reason);
    }

    if (spacesR.status === 'fulfilled') {
      const v = spacesR.value;
      out.spaces = (v.results || []).map(s => ({
        id:   s.id || '',
        key:  s.key || '',
        name: s.name || '',
        type: s.type || '',
        description: String(s.description?.plain?.value || '').slice(0, 240),
      })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      if (v.size && Number(v.size) > out.spaces.length) {
        out._truncated.spaces = `показано ${out.spaces.length} из ${v.size}`;
      }
    } else {
      out._errors.spaces = spacesR.reason?.message || String(spacesR.reason);
    }

    const topSpaces = out.spaces.slice(0, TECH_INFO_TOP_SPACES);
    const spaceJobs = [];
    for (const sp of topSpaces) {
      spaceJobs.push(async () => ({
        key: sp.key, kind: 'labels',
        data: await _tiConfluenceGet(cfg, tls, `/rest/api/space/${encodeURIComponent(sp.key)}/label?limit=100`).catch(_ => ({ results: [] })),
      }));
      spaceJobs.push(async () => ({
        key: sp.key, kind: 'templates',
        data: await _tiConfluenceGet(cfg, tls, `/rest/api/template/page?spaceKey=${encodeURIComponent(sp.key)}&limit=50`).catch(_ => ({ results: [] })),
      }));
    }
    const spaceResults = await _tiPLimit(3, spaceJobs);
    for (const r of spaceResults) {
      if (!r.ok) continue;
      const { key, kind, data } = r.value;
      if (kind === 'labels') {
        out.labelsBySpace[key] = (data.results || []).map(lab => ({
          name:   lab.name || '',
          prefix: lab.prefix || '',
        }));
      } else if (kind === 'templates') {
        out.templatesBySpace[key] = (data.results || []).map(t => ({
          templateId: t.templateId || t.id || '',
          name:       t.name || '',
          description:String(t.description || '').slice(0, 240),
        }));
      }
    }

    return out;
  }

  /** Public: build the full tech-info payload, honouring per-source cache.
   *  `opts.source` ∈ 'all' | 'jira' | 'bitbucket' | 'confluence'.
   *  `opts.forceRefresh` resets ALL three caches. */
  async function buildTechInfo(cfg, opts = {}) {
    const tls = !!cfg.allowInsecureTls;
    const wantedSource = opts.source || 'all';
    const force = !!opts.forceRefresh;
    if (force) {
      _techInfoCache.jira       = { data: null, fetchedAt: 0 };
      _techInfoCache.bitbucket  = { data: null, fetchedAt: 0 };
      _techInfoCache.confluence = { data: null, fetchedAt: 0 };
    }
    const now = Date.now();
    const isFresh = (entry) => entry.data && (now - entry.fetchedAt) < TECH_INFO_TTL_MS;
    const want = (key) => wantedSource === 'all' || wantedSource === key;

    const errors = {};
    const stale  = {};

    async function fetchSource(key, fetcher) {
      if (!want(key)) return null;
      const entry = _techInfoCache[key];
      if (!force && isFresh(entry)) return entry.data;
      try {
        const data = await fetcher();
        entry.data = data;
        entry.fetchedAt = now;
        return data;
      } catch (e) {
        const msg = e?.message || String(e);
        if (entry.data) {
          stale[key] = true;
          errors[key] = msg + ' (показаны кэшированные данные)';
          return entry.data;
        }
        errors[key] = msg;
        return null;
      }
    }

    const [jira, bitbucket, confluence] = await Promise.all([
      fetchSource('jira',       () => _tiFetchJira(cfg)),
      fetchSource('bitbucket',  () => _tiFetchBitbucket(cfg, tls)),
      fetchSource('confluence', () => _tiFetchConfluence(cfg, tls)),
    ]);

    return {
      jira:       jira       || null,
      bitbucket:  bitbucket  || null,
      confluence: confluence || null,
      fetchedAt:  new Date(now).toISOString(),
      errors,
      stale,
      cache: {
        jira:       { fetchedAt: _techInfoCache.jira.fetchedAt       ? new Date(_techInfoCache.jira.fetchedAt).toISOString()       : '' },
        bitbucket:  { fetchedAt: _techInfoCache.bitbucket.fetchedAt  ? new Date(_techInfoCache.bitbucket.fetchedAt).toISOString()  : '' },
        confluence: { fetchedAt: _techInfoCache.confluence.fetchedAt ? new Date(_techInfoCache.confluence.fetchedAt).toISOString() : '' },
      },
    };
  }

  return { buildTechInfo };
}

module.exports = { createTechInfo };
