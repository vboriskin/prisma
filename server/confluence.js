'use strict';
/* ════════════════════════════════════════════════════════════
   server/confluence.js — Confluence fetchers (V18 extraction).
   ────────────────────────────────────────────────────────────
   Extracted from server.js as part of structural debt cleanup.

   Public surface (returned by `create({...})`):
     · ppFetchConfluenceActivity     — main CF activity collector
                                       (CQL search × 3 + audit-log fallback)
     · ppFetchCfAuthorshipVelocity   — words/day per author (top-30 pages)
     · ppFetchCfSpaceAcl             — per-space users/groups/anonymous
     · ppFetchCfHealthMetrics        — orphans/DoD/cadence/post-mortems
     · ppFetchStaleConfluence        — pages older than 365d
     · ppFetchRetroClosure           — retro action-item closure rate

   Internal helper kept private to module:
     · _ppCfAuditAugment             — audit-log walker (called only from
                                       ppFetchConfluenceActivity)

   Factory deps (wired through `create({...})`):
     · jiraForward                   — outbound HTTP (server/upstream.js)
     · jiraPLimit                    — bounded concurrency
     · _cfBuildPathCascade           — Cloud `/wiki/rest` ↔ DC `/rest` cascade
     · _ppMakeAuthHeader             — basic-auth header builder
     · _ppKeyForAuthor               — identity-deterministic author key
     · _ppRedactSecretsInText        — secret-scrub helper

   `logger` is `require()`-d directly (process-wide singleton, V19 E4).
   ──────────────────────────────────────────────────────────── */

const logger = require('./logger.js');

// ── factory-injected deps ───────────────────────────────────
let _jiraForward;
let _jiraPLimit;
let _cfBuildPathCascade;
let _ppMakeAuthHeader;
let _ppKeyForAuthor;
let _ppRedactSecretsInText;

// V22 C2 — pathname-only extractor для surface'а в `tried[].url`. Запрос
// типа `${base}/rest/api/content/search?cql=...&start=...` сворачивается до
// `/rest/api/content/search` чтобы tried[] не утекал query-params (cql /
// токен-заголовки в логах upstream'а / cookie-эхо). Inline и без зависимостей —
// модуль server-side, URL ctor доступен.
function _safePathname(u) {
  try { return new URL(String(u || '')).pathname || ''; }
  catch (_) { return String(u || '').split('?')[0].replace(/^https?:\/\/[^/]+/, '') || ''; }
}

/**
 * V17.2 I2c — Confluence activity collector.
 *
 * Что делает:
 *   • space-scope `space in (DEV, PAY, ...)` если задан `cfg.confluenceSpaceKeys`
 *   • per-employee `contributor in (...)` / `creator in (...)` / `mention in (...)`
 *     если переданы `opts.employees` с identity (lookup-by-email-prefix
 *     или по `confluenceAccountId`)
 *   • CQL cutoff с +1ч padding для TZ-skew, точная фильтрация у нас по cutoffTs
 *   • Pagination через start/limit (cap 1000 events на тип)
 *   • Три типа активности: page/blogpost edits, comments, mentions
 *   • Path-cascade Cloud `/wiki/rest/...` ↔ DC `/rest/...`
 *   • Дедупликация: edit > comment > mention (если один target_id и тот же author)
 */
async function ppFetchConfluenceActivity(cfg, tls, cutoffTs, opts = {}) {
  if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) return { authors: {}, configured: false, tried: [] };
  const baseRaw = String(cfg.confluenceBaseUrl).replace(/\/+$/, '').replace(/\/wiki$/i, '');
  const auth = _ppMakeAuthHeader(cfg.confluenceToken);
  const tried = [];

  const cqlCutoffTs = Number(opts.cqlCutoffTs) || (cutoffTs - 60 * 60 * 1000);
  const isoCutoff   = new Date(cqlCutoffTs).toISOString().replace('T', ' ').slice(0, 16);
  const employees   = Array.isArray(opts.employees) ? opts.employees : [];

  // Build CQL identity clause: contributor in ("alice", "bob") or mention in (...)
  // Используем username (email-prefix) и confluenceAccountId как кандидатов.
  // CQL Confluence ожидает username; для большинства DC это email-prefix.
  const identityNames = new Set();
  for (const e of employees) {
    const cf = String(e.confluenceAccountId || '').trim();
    if (cf) identityNames.add(cf);
    const em = String(e.email || '').trim().toLowerCase();
    if (em && em.includes('@')) {
      identityNames.add(em.split('@')[0]);     // email-prefix as username (LDAP/AD common)
      identityNames.add(em);                    // full email (Cloud accountId path иногда)
    }
  }
  // 2026-05-11 — CQL-injection mitigation: identity-список используется в CQL
  // как `user.fullname in ("X", "Y", …)`. Кавычки экранируются ниже, но
  // двойного escape недостаточно — CQL имеет специальные операторы. Добавляем
  // strict allowlist: только alphanumeric + `._-@` (стандартные символы
  // LDAP-username / email). Всё остальное (кавычки, parens, скобки,
  // unicode-control) отсекаем — типичная identity не содержит таких символов.
  const _SAFE_IDENT_RE = /^[a-zA-Z0-9._\-@]+$/;
  const identityListRaw = [...identityNames];
  const identityList = identityListRaw.filter(n => _SAFE_IDENT_RE.test(n));
  const droppedCount = identityListRaw.length - identityList.length;
  if (droppedCount > 0) {
    try { logger?.warn?.('cf.identity_dropped_unsafe_chars', { dropped: droppedCount, total: identityListRaw.length }); } catch (_) {}
  }
  // eslint-disable-next-line no-unused-vars
  const idClause = identityList.length
    ? ` AND ${'%FIELD%'} in (${identityList.map(n => `"${n.replace(/"/g, '\\"')}"`).join(', ')})`
    : '';

  // Space scope clause: AND space in (DEV, PAY).
  // Inline parser (server.js не импортирует портальные модули).
  const spaceKeys = String(cfg.confluenceSpaceKeys || '')
    .split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  const spaceClause = spaceKeys.length
    ? ` AND space in (${spaceKeys.map(k => `"${k.replace(/"/g, '\\"')}"`).join(', ')})`
    : '';

  // Path cascade — try Cloud first, fall back to DC.
  // PR-DA — общий helper `_cfPathCascade` теперь используется во всех 3 местах
  // (cf-velocity, cf-acl, audit) — раньше cascade был только здесь.
  const PATHS_FULL = _cfBuildPathCascade(baseRaw, '/rest/api/content/search')
    .map((url, i) => ({ tag: i === 0 ? 'wiki-rest' : 'rest', url }));

  // 2026-05-11 — one-time probe: какой path реально работает в этой инсталляции.
  // Sber Confluence DC (confluence.delta.sbrf.ru) монтирует API на `/rest/...`
  // без `/wiki/` context-path. До фикса каждый CQL запрос тратил один впустую
  // на /wiki/rest/api/content/search (404 → fallback /rest) и логировал 302 как
  // SSO redirect (false positive `suspectedSso: true`). Probe выбирает winner
  // один раз через cheap `/space?limit=1` запрос — устраняет wasted requests
  // и false-positive SSO алерт. Cloud (с /wiki context-path) тоже корректно
  // обрабатывается: wiki-rest вернёт 200, останется он.
  async function _probeWinningPath() {
    for (const p of PATHS_FULL) {
      const probeUrl = p.url.replace('/api/content/search', '/api/space') + '?limit=1';
      const t0 = Date.now();
      const r = await _jiraForward({
        targetUrl: probeUrl, method: 'GET',
        headers: { Authorization: auth, Accept: 'application/json' },
        allowInsecureTls: tls, timeoutMs: 5000,
      }).catch(e => ({ status: 0, _err: e?.message }));
      tried.push({
        type: `probe-${p.tag}`,
        status: r.status,
        ms: Date.now() - t0,
        url: _safePathname(probeUrl),
        error: r._err || '',
      });
      if (r.status >= 200 && r.status < 300) return p;
      // auth-fail = token bad for both paths, скорее всего; не пробуем второй
      if (r.status === 401 || r.status === 403) return null;
    }
    return null;
  }
  const winning = await _probeWinningPath();
  // PATHS — либо ТОЛЬКО winner, либо full cascade (если probe не определился).
  const PATHS = winning ? [winning] : PATHS_FULL;

  // Page through CQL with cap=1000 per type per call.
  async function paginatedSearch(pathSpec, cql, expand) {
    const out = [];
    let start = 0;
    const limit = 100;
    const cap = 1000;
    let pages = 0;
    while (out.length < cap && pages < 10) {
      const url = `${pathSpec.url}?cql=${encodeURIComponent(cql)}&start=${start}&limit=${limit}&expand=${encodeURIComponent(expand)}`;
      const t0 = Date.now();
      const r = await _jiraForward({
        targetUrl: url, method: 'GET',
        headers: { Authorization: auth, Accept: 'application/json' },
        allowInsecureTls: tls, timeoutMs: 20000,
      }).catch(e => ({ status: 0, text: '', _err: e?.message }));
      // V21 CF1 — content-type guard. Sber upstream proxy иногда отдаёт
      // 200 OK с HTML login-страницей (silent SSO interception): JSON.parse
      // падает в catch, parsed=null, batch=[], silent fail без warning. До
      // фикса так Confluence пропадал на пилоте: 96 items → 0 без causes.
      const ctype  = String(r?.headers?.['content-type'] || r?.headers?.['Content-Type'] || '').toLowerCase();
      const head   = String(r?.text || '').slice(0, 200).trim().toLowerCase();
      const isHtml = head.startsWith('<') || head.includes('<html') || head.includes('<!doctype') || ctype.includes('text/html');
      tried.push({
        type: pathSpec.tag, status: r.status, cql, start, ms: Date.now() - t0,
        // V22 C2 — pathname (без query) для surface'а в `cfTriedSummary.redirectedSamples`.
        // Query-string исключаем чтобы не утечь cql / token / cookies при
        // экспорте диагностики; pathname достаточен для triage'а («какой
        // эндпоинт получает 302 — Cloud /wiki/rest или DC /rest»).
        url: _safePathname(pathSpec.url),
        contentType: ctype || '',
        htmlBody: isHtml,
        error: r._err || '',
      });
      // V21 L1+L2 — server log-events для post-mortem.
      if (r.status === 301 || r.status === 302) {
        try { logger?.warn?.('cf.http_redirect', { url: pathSpec.url.split('?')[0], status: r.status, location: r?.headers?.location || '' }); } catch (_) {}
      }
      if (r.status === 401 || r.status === 403) {
        const wwwAuth = String(r?.headers?.['www-authenticate'] || '').slice(0, 100);
        try { logger?.warn?.('cf.auth_fail', { url: pathSpec.url.split('?')[0], status: r.status, wwwAuth }); } catch (_) {}
        return { results: [], status: r.status };
      }
      if (r.status >= 300) {
        if (out.length === 0) return { results: [], status: r.status };
        break;
      }
      // V21 CF1 — early-bail на HTML-body. logger.warn для server-side ELK.
      if (isHtml) {
        try { logger?.warn?.('cf.html_body', { url: pathSpec.url.split('?')[0], status: r.status, contentType: ctype }); } catch (_) {}
        if (out.length === 0) return { results: [], status: r.status, htmlBody: true };
        break;
      }
      let parsed;
      try { parsed = JSON.parse(r.text); } catch (_) { parsed = null; }
      const batch = parsed?.results || [];
      out.push(...batch);
      pages++;
      // M10: было `if (batch.length < limit) break` — некорректно для CQL,
      // Confluence иногда возвращает < limit при наличии следующих страниц
      // (server-side фильтрация). Полагаемся на `_links.next` или
      // `size`/`totalSize`. Fallback на batch.length === 0 если ни того ни
      // другого нет (некоторые DC versions).
      const hasNext = !!parsed?._links?.next || (typeof parsed?.size === 'number' && typeof parsed?.totalSize === 'number' && (start + batch.length) < parsed.totalSize);
      if (!hasNext && batch.length === 0) break;
      if (!hasNext && !parsed?._links?.next && batch.length < limit) break;
      start += batch.length || limit;
    }
    return { results: out, status: 200 };
  }

  // v22 fix — батчим identity IN-clause по 80 имён за раз. Confluence DC
  // даёт 400 Bad Request на IN-clause >100 items (или ?cql URI > 8KB), что
  // ломало fetch для команд 100+ человек: identityList = 102 emails + 102
  // email-prefixes + cfIds = 230+ имён → CQL рушился, totalItems=0 silent.
  // Берём список идентичностей чанками, исполняем CQL отдельно для каждого
  // чанка, мерджим results (с дедупом по id).
  const ID_CHUNK = 80;
  function _chunkIdentity(list, size) {
    if (!list.length) return [[]];
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }
  const idChunks = _chunkIdentity(identityList, ID_CHUNK);

  // Run a CQL query, picking the first PATH that returns 2xx or a result.
  // Если identityList пуст — один запрос без id-фильтра. Иначе — N запросов
  // (по chunk'у), мердж по `id`. Status: 200 если хотя бы один чанк OK.
  async function runCQL(cqlNoIdentity, cqlField, expand) {
    if (idChunks.length === 1 && idChunks[0].length === 0) {
      const cql = cqlNoIdentity + spaceClause;
      for (const p of PATHS) {
        const r = await paginatedSearch(p, cql, expand);
        if (r.status >= 200 && r.status < 300) return { results: r.results, path: p, cql };
        if (r.status === 401 || r.status === 403) return { results: [], path: p, cql, authError: r.status };
      }
      return { results: [], path: PATHS[PATHS.length - 1], cql };
    }
    const merged = new Map();
    let chosenPath = null;
    let authError = null;
    for (const chunk of idChunks) {
      const idClauseChunk = chunk.length
        ? ` AND ${cqlField} in (${chunk.map(n => `"${n.replace(/"/g, '\\"')}"`).join(', ')})`
        : '';
      const cql = cqlNoIdentity + idClauseChunk + spaceClause;
      // Try paths until one returns 2xx; cache winning path для последующих чанков.
      const pathsToTry = chosenPath ? [chosenPath, ...PATHS.filter(p => p !== chosenPath)] : PATHS;
      let chunkOk = false;
      for (const p of pathsToTry) {
        const r = await paginatedSearch(p, cql, expand);
        if (r.status >= 200 && r.status < 300) {
          for (const it of r.results) {
            const id = it?.id || it?.content?.id || JSON.stringify(it).slice(0, 60);
            if (!merged.has(id)) merged.set(id, it);
          }
          chosenPath = p;
          chunkOk = true;
          break;
        }
        if (r.status === 401 || r.status === 403) { authError = r.status; break; }
      }
      if (authError) break;
      if (!chunkOk) {
        // CQL chunk failed on all paths (most likely 400 / 414 от слишком длинного URL).
        // Не падаем целиком — просто логируем в `tried` (paginatedSearch уже сделал)
        // и идём к следующему chunk. Если все чанки fail — out пуст.
        continue;
      }
    }
    if (authError) return { results: [], path: chosenPath || PATHS[0], cql: cqlNoIdentity, authError };
    return { results: [...merged.values()], path: chosenPath || PATHS[PATHS.length - 1], cql: cqlNoIdentity };
  }

  // 2026-05-11 — параллельные CQL-passes. Раньше sequential: каждый pass
  // ждал предыдущий → 3 × (10 страниц × 200ms) = 6 сек. Теперь parallel:
  // ~2 сек. Внутри пасса pagination остаётся sequential (нужен cursor `start`).
  // ── Pass 1: page / blogpost edits ─────────────────────────
  const editCql = `type in (page, blogpost) AND lastmodified > "${isoCutoff}"`;
  // ── Pass 2: comments ─────────────────────────────────────
  const commentCql = `type = comment AND created > "${isoCutoff}"`;
  // ── Pass 3: mentions ─────────────────────────────────────
  const mentionCql = `lastmodified > "${isoCutoff}"`;
  const [editR, commentR, mentionR] = await Promise.all([
    runCQL(editCql, 'contributor', 'version,space,history.lastUpdated,history.createdBy'),
    runCQL(commentCql, 'creator', 'version,space,container'),
    runCQL(mentionCql, 'mention', 'version,space'),
  ]);

  // Auth-error cascade end: bail with explicit message.
  const anyAuthErr = [editR, commentR, mentionR].find(x => x?.authError);
  if (anyAuthErr) {
    return { authors: {}, configured: true, tried, error: `Confluence HTTP ${anyAuthErr.authError} — токен просрочен или нет прав` };
  }

  const winningPath = (editR.path || commentR.path || mentionR.path || PATHS[0]).tag;
  const urlBase = winningPath === 'wiki-rest' ? `${baseRaw}/wiki` : baseRaw;

  // ── Aggregate authors ────────────────────────────────────
  const authors = {};
  // `username` = Confluence DC username or Cloud accountId (v.by.username / v.by.accountId).
  // Stored as `slug` so _buildAuthorLookups.bySlug can find it via emp.confluenceAccountId.
  const ensureAuthor = (dn, em, k, username = '') => {
    if (!authors[k]) authors[k] = { edits: 0, comments: 0, mentions: 0, displayName: dn || em || k, email: em, slug: String(username || '').toLowerCase().trim(), items: [], _seenTargets: new Set() };
    else if (username && !authors[k].slug) authors[k].slug = String(username).toLowerCase().trim();
    return authors[k];
  };
  const pushItem = (a, item) => {
    if (a.items.length >= 100) return;
    if (item.targetId) {
      // V17.2 I2c — dedup: предпочитаем edit/create > comment > mention для
      //   одного и того же target_id у одного автора. Если уже видели этот
      //   target — пропускаем (порядок проходов: edits → comments → mentions
      //   гарантирует что edit «победит» дальше идущий mention).
      if (a._seenTargets.has(item.targetId)) return;
      a._seenTargets.add(item.targetId);
    }
    a.items.push(item);
  };

  // Pass 1 — edits
  for (const p of (editR.results || [])) {
    const v = p.version || {};
    const tsP = Date.parse(v.when || '');
    if (Number.isFinite(tsP) && tsP < cutoffTs) continue;
    const dn = v.by?.displayName || v.by?.publicName || '';
    const em = v.by?.email || '';
    const k = _ppKeyForAuthor(dn, em);
    if (!k) continue;
    // username = Confluence DC username / Cloud accountId — used for bySlug attribution.
    const cfUn = v.by?.username || v.by?.accountId || '';
    const a = ensureAuthor(dn, em, k, cfUn);
    a.edits++;
    pushItem(a, {
      kind: (Number(v.number) || 0) === 1 ? 'create' : 'edit',
      title: p.title || '',
      url:   p._links?.webui ? `${urlBase}${p._links.webui}` : '',
      at:    v.when || '',
      spaceKey:  p.space?.key  || '',
      spaceName: p.space?.name || '',
      targetId:  String(p.id || ''),
    });
  }
  // Pass 2 — comments
  for (const c of (commentR.results || [])) {
    const v = c.version || {};
    const tsP = Date.parse(v.when || c.history?.createdDate || '');
    if (Number.isFinite(tsP) && tsP < cutoffTs) continue;
    const dn = v.by?.displayName || c.history?.createdBy?.displayName || '';
    const em = v.by?.email || c.history?.createdBy?.email || '';
    const k = _ppKeyForAuthor(dn, em);
    if (!k) continue;
    const cfUn = v.by?.username || v.by?.accountId || c.history?.createdBy?.username || c.history?.createdBy?.accountId || '';
    const a = ensureAuthor(dn, em, k, cfUn);
    a.comments++;
    const cont = c.container || {};
    pushItem(a, {
      kind:  'comment',
      title: cont.title || c.title || '(без заголовка)',
      url:   c._links?.webui ? `${urlBase}${c._links.webui}` : (cont._links?.webui ? `${urlBase}${cont._links.webui}` : ''),
      at:    v.when || c.history?.createdDate || '',
      spaceKey:  c.space?.key  || cont.space?.key  || '',
      spaceName: c.space?.name || cont.space?.name || '',
      targetId:  `${cont.id || c.id || ''}#comment-${c.id || ''}`,
    });
  }
  // Pass 3 — mentions
  // H4: Раньше mention каждой страницы атрибутировался КАЖДОМУ identity-юзеру,
  // overcount пропорционален размеру команды. Без body-scan мы не можем
  // отличить кого реально упомянули. Поэтому: НЕ атрибутируем mentions
  // per-person без body. Считаем общий счётчик в `_diagOnly.mentionsUnattributed`
  // чтобы UI мог показать «N упоминаний за период, авторство не определено».
  let _mentionsUnattributed = 0;
  for (const p of (mentionR.results || [])) {
    const v = p.version || {};
    const tsP = Date.parse(v.when || '');
    if (Number.isFinite(tsP) && tsP < cutoffTs) continue;
    if (!identityList.length) continue;
    _mentionsUnattributed++;
  }

  // Cleanup _seenTargets перед возвратом (это служебное поле).
  for (const a of Object.values(authors)) delete a._seenTargets;

  // ── V20 S5.3 — Audit-log fallback ────────────────────────
  // Если CQL search ничего/мало вернул (типичная ситуация для Sber DC где
  // user.email не индексирован) — добираем events через audit log.
  // /rest/auditing/1.0/events?affectedObject=Space,<id> возвращает все
  // события за период с author.name = ФИО. Match'им по emp.fio.
  //
  // Решение применяется ТОЛЬКО если:
  //   · есть spaceKeys (без них audit нерелевантен)
  //   · CQL дал < 5 events ИЛИ < 50% от identity-list authors
  // Прерываемся раньше если audit token не имеет прав или нет space ID.
  // eslint-disable-next-line no-unused-vars
  const cqlAuthorsCount = Object.keys(authors).length;
  // eslint-disable-next-line no-unused-vars
  const identityCount = identityList.length;
  // eslint-disable-next-line no-unused-vars
  const cqlSparse = cqlAuthorsCount < Math.max(5, Math.floor(identityCount * 0.5));
  // V21 AX (audit-09 §D #15) — page views per page собираются всегда,
  // даже если CQL pipeline уже дал данные (audit walk проходит per-space).
  const pageViews = new Map();
  if (spaceKeys.length && employees.length) {
    try {
      await _ppCfAuditAugment({
        baseRaw, auth, tls, cutoffTs, spaceKeys, employees,
        authors, ensureAuthor, pushItem, tried,
        pageViews, // V21 AX
      });
    } catch (e) {
      tried.push({ type: 'audit-fallback', error: _ppRedactSecretsInText(e?.message || 'thrown', 100) });
    }
  }
  for (const a of Object.values(authors)) delete a._seenTargets;     // повторный cleanup

  // V21 AX — top-50 страниц по view count.
  const pageViewsArr = [...pageViews.values()].sort((a, b) => b.count - a.count).slice(0, 50);

  return {
    authors,
    configured: true,
    tried,
    scope: { spaces: spaceKeys, employees: identityList.length, windowHours: Math.round((Date.now() - cutoffTs) / 3600000) },
    pageViews: pageViewsArr,
    // H4: общий счётчик упоминаний без авторства (без body-scan нельзя сказать
    // кого реально упомянули — раньше fan-out к каждому identity, overcount).
    mentionsUnattributed: _mentionsUnattributed,
  };
}

/**
 * V20 S5.3 — Confluence audit log → augment authors map.
 *
 * Pipeline:
 *   1) Resolve каждый spaceKey → spaceId (через /rest/api/space/<key>).
 *   2) Для каждого spaceId fetch /rest/auditing/1.0/events?affectedObject=Space,<id>
 *      paginated (cursor-based в DC).
 *   3) Для каждого event:
 *      · фильтр timestamp >= cutoffTs (client-side, т.к. audit не принимает period filter
 *        в DC до 7.20)
 *      · author.name (= ФИО) → match по emp.fio (case-insensitive).
 *      · если match — bump соответствующий counter (edits/comments/mentions)
 *        исходя из event.type.action.
 *
 * Не заменяет CQL pipeline — augmentирует. Дедуп через _seenTargets.
 */
async function _ppCfAuditAugment(opts) {
  const { baseRaw, auth, tls, cutoffTs, spaceKeys, employees, authors, ensureAuthor, pushItem, tried, pageViews } = opts;
  // V20 S6.1 — Build FIO → employee map. Service-аккаунты ИСКЛЮЧАЮТСЯ —
  // если бот зарегистрирован с FIO (auto-create), его не должны путать с
  // настоящим автором, даже если ФИО совпадает.
  const fioMap = new Map();
  for (const e of employees) {
    if (e.isServiceAccount) continue;
    const fio = String(e.fio || '').toLowerCase().trim();
    if (fio) fioMap.set(fio, e);
  }
  if (!fioMap.size) return;

  // 1) Resolve space IDs.
  const spaceIds = [];
  for (const key of spaceKeys.slice(0, 5)) {     // cap = 5 spaces чтобы не спамить
    const url = `${baseRaw}/rest/api/space/${encodeURIComponent(key)}`;
    const r = await _jiraForward({ targetUrl: url, method: 'GET', headers: { Authorization: auth, Accept: 'application/json' }, allowInsecureTls: tls, timeoutMs: 8000 }).catch(() => ({ status: 0 }));
    tried.push({ type: 'audit-space-resolve', key, status: r.status, url: _safePathname(url) });
    if (r.status < 200 || r.status >= 300) continue;
    try {
      const parsed = JSON.parse(r.text);
      if (parsed.id) spaceIds.push({ key, id: String(parsed.id) });
    } catch (_) {}
  }
  if (!spaceIds.length) return;

  // 2) Fetch audit events per space, paginated by cursor. Cap = 5 pages × 100 = 500 events.
  const action2counter = (action) => {
    const a = String(action || '').toLowerCase();
    if (a.includes('comment'))                 return 'comments';
    if (a.includes('mention'))                 return 'mentions';
    if (a.includes('updated') || a.includes('edited') || a.includes('created')) return 'edits';
    return null;
  };

  let augmented = 0;
  for (const sp of spaceIds) {
    let cursor = null;
    let pages = 0;
    while (pages < 5) {
      let url = `${baseRaw}/rest/auditing/1.0/events?affectedObject=${encodeURIComponent(`Space,${sp.id}`)}&limit=100`;
      if (cursor) url += `&pageCursor=${encodeURIComponent(cursor)}&offset=0`;
      const r = await _jiraForward({ targetUrl: url, method: 'GET', headers: { Authorization: auth, Accept: 'application/json' }, allowInsecureTls: tls, timeoutMs: 12000 }).catch(e => ({ status: 0, _err: e?.message }));
      tried.push({ type: 'audit-events', spaceKey: sp.key, page: pages, status: r.status, url: _safePathname(url) });
      if (r.status === 401 || r.status === 403) {
        return;     // нет прав на audit — bail
      }
      if (r.status < 200 || r.status >= 300) break;
      let parsed; try { parsed = JSON.parse(r.text); } catch (_) { break; }
      const events = parsed.entities || [];
      if (!events.length) break;
      let oldestEventBeforeCutoff = false;
      for (const ev of events) {
        const ts = Date.parse(ev.timestamp || '');
        if (!Number.isFinite(ts)) continue;
        if (ts < cutoffTs) { oldestEventBeforeCutoff = true; continue; }
        // Найдём target page (используется для views и mainflow).
        const target = (ev.affectedObjects || []).find(o => o.type === 'Page' || o.type === 'Comment' || o.type === 'Blogpost') || {};
        // V21 AX (audit-09 §D #15) — Page views aggregation per page.
        // ANY user (включая anonymous), counter = views (action содержит "viewed").
        if (pageViews && target.id && /viewed/i.test(ev.type?.action || '')) {
          const pageKey = String(target.id);
          const e = pageViews.get(pageKey) || { id: pageKey, title: target.name || '', spaceKey: sp.key, count: 0 };
          e.count++;
          if (target.name && !e.title) e.title = target.name;
          pageViews.set(pageKey, e);
        }
        const fio = String(ev.author?.name || '').toLowerCase().trim();
        if (!fio) continue;
        const emp = fioMap.get(fio);
        if (!emp) continue;     // не наш сотрудник
        const counter = action2counter(ev.type?.action);
        if (!counter) continue;
        const dn = ev.author?.name || '';
        const em = emp.email || '';
        const k = _ppKeyForAuthor(dn, em);
        if (!k) continue;
        const a = ensureAuthor(dn, em, k);
        a[counter]++;
        pushItem(a, {
          kind: counter === 'edits' ? 'edit' : (counter === 'comments' ? 'comment' : 'mention'),
          title: target.name || ev.type?.action || 'audit',
          url:   target.uri || '',
          at:    ev.timestamp || '',
          spaceKey:  sp.key,
          targetId:  String(target.id || ev.id || `${sp.id}-${ts}`),
          source:    'audit-log',
        });
        augmented++;
      }
      // Если самый старый event на странице УЖЕ до cutoff — следующая будет ещё старее, прерываемся.
      if (oldestEventBeforeCutoff && events.length === parsed.pagingInfo?.size) break;
      cursor = parsed.pagingInfo?.nextPageCursor || null;
      if (!cursor || parsed.pagingInfo?.lastPage) break;
      pages++;
    }
  }
  tried.push({ type: 'audit-augmented', count: augmented, spaces: spaceIds.length });
}

// V21 AZ (audit-09 §H Person #15) — CF authorship velocity (words/day).
// Per-page body fetch + word count, attribute к creator/lastUpdater.
// Cap: top-30 recent pages из spaces. Окно 14д для расчёта words/day.
async function ppFetchCfAuthorshipVelocity(cfg, tls) {
  if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) return { configured: false, perAuthor: {}, tried: [] };
  const cfBase = cfg.confluenceBaseUrl.replace(/\/+$/, '').replace(/\/wiki$/i, '');
  const auth = _ppMakeAuthHeader(cfg.confluenceToken);
  const tried = [];
  const spaceKeys = String(cfg.confluenceSpaceKeys || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  if (!spaceKeys.length) return { configured: true, perAuthor: {}, tried, error: 'no-spaces' };

  // Step 1: discover top-30 recently modified pages.
  // PR-DA — path-cascade /wiki/rest → /rest (раньше работало только для DC).
  const cqlSpace = spaceKeys.length ? `space IN (${spaceKeys.map(s => `"${s}"`).join(', ')}) AND ` : '';
  const cql = `${cqlSpace}type=page AND lastmodified > "now-14d"`;
  let pages = [];
  for (const cascadeUrl of _cfBuildPathCascade(cfBase, '/rest/api/content/search')) {
    try {
      const url = `${cascadeUrl}?cql=${encodeURIComponent(cql)}&limit=30&expand=history,version`;
      const r = await _jiraForward({ targetUrl: url, method: 'GET', headers: { Authorization: auth, Accept: 'application/json' }, allowInsecureTls: tls, timeoutMs: 10000 });
      tried.push({ type: 'cf-velocity-search', status: r.status, base: cascadeUrl });
      if (r.status >= 200 && r.status < 300) {
        pages = (JSON.parse(r.text || '{}').results || []).slice(0, 30);
        break;
      }
      if (r.status === 401 || r.status === 403) break;     // не cascade — нет смысла
    } catch (e) { tried.push({ type: 'cf-velocity-search', error: String(e?.message || e).slice(0, 100), base: cascadeUrl }); }
  }
  if (!pages.length) return { configured: true, perAuthor: {}, tried };

  // Step 2: per-page body fetch + word count.
  // PR-DA — path-cascade и здесь (Cloud /wiki/rest → DC /rest).
  const perAuthor = new Map(); // displayName → { words, pages }
  await _jiraPLimit(4, pages.map(p => async () => {
    let r = { status: 0 };
    for (const cascadeUrl of _cfBuildPathCascade(cfBase, `/rest/api/content/${encodeURIComponent(p.id)}`)) {
      try {
        const bodyUrl = `${cascadeUrl}?expand=body.storage,version,history.lastUpdated`;
        r = await _jiraForward({ targetUrl: bodyUrl, method: 'GET', headers: { Authorization: auth, Accept: 'application/json' }, allowInsecureTls: tls, timeoutMs: 10000 });
        tried.push({ type: 'cf-velocity-body', pageId: p.id, status: r.status, base: cascadeUrl });
        if (r.status >= 200 && r.status < 300) break;
        if (r.status === 401 || r.status === 403) break;
      } catch (e) { tried.push({ type: 'cf-velocity-body', pageId: p.id, error: String(e?.message || e).slice(0, 100), base: cascadeUrl }); }
    }
    try {
      if (r.status < 200 || r.status >= 300) return;
      const data = JSON.parse(r.text || '{}');
      const body = data.body?.storage?.value || '';
      // Strip HTML tags + count words.
      const text = body.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ');
      const words = text.split(/\s+/).filter(w => w.length >= 2).length;
      // H3/M5: identity-deterministic key через _ppKeyForAuthor + сохраняем
      // username/accountId/email чтобы клиент мог сматчить с employees-таблицей.
      // Раньше ключ = displayName → два человека с одинаковым ФИО конфлайтились,
      // нет линка к confluenceAccountId.
      const updBy = data.history?.lastUpdated?.by || data.version?.by || data.history?.createdBy || {};
      const dn = updBy.displayName || '';
      const em = updBy.email || '';
      const slug = updBy.username || updBy.accountId || '';
      const key = _ppKeyForAuthor(dn, em);
      if (!key || !words) return;
      const e = perAuthor.get(key) || { words: 0, pages: 0, displayName: dn || em || key, email: em, slug: String(slug || '').toLowerCase().trim() };
      e.words += words;
      e.pages++;
      perAuthor.set(key, e);
    } catch (e) { tried.push({ type: 'cf-velocity-body', pageId: p.id, error: String(e?.message || e).slice(0, 100) }); }
  }));

  // Step 3: words/day = total words / 14.
  const perAuthorObj = {};
  for (const [k, v] of perAuthor) {
    perAuthorObj[k] = { ...v, wordsPerDay: +(v.words / 14).toFixed(1) };
  }
  return { configured: true, perAuthor: perAuthorObj, tried, windowDays: 14 };
}

// V21 AR (audit-09 §D #19/#27) — Space-level ACL audit.
// Per space: список users + groups с permission. Server CF использует
// `/rest/api/space/{key}` с expand=permissions; на DC иногда требуется
// `/rest/space/{key}/permission`. Делаем graceful probe обоих.
async function ppFetchCfSpaceAcl(cfg, tls) {
  if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) return { configured: false, bySpace: {}, tried: [] };
  const cfBase = cfg.confluenceBaseUrl.replace(/\/+$/, '').replace(/\/wiki$/i, '');
  const auth = _ppMakeAuthHeader(cfg.confluenceToken);
  const tried = [];
  const bySpace = {};
  const spaceKeys = String(cfg.confluenceSpaceKeys || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  if (!spaceKeys.length) return { configured: true, bySpace: {}, tried, error: 'no-spaces-configured' };

  await _jiraPLimit(3, spaceKeys.slice(0, 10).map(spaceKey => async () => {
    let users = 0, groups = 0, anonymous = false;
    let lastStatus = 0;
    // Probe 1: /rest/api/space/{key}?expand=permissions (Cloud-style и часть DC).
    try {
      const url = `${cfBase}/rest/api/space/${encodeURIComponent(spaceKey)}?expand=permissions`;
      const r = await _jiraForward({ targetUrl: url, method: 'GET', headers: { Authorization: auth, Accept: 'application/json' }, allowInsecureTls: tls, timeoutMs: 10000 });
      lastStatus = r.status;
      tried.push({ type: 'cf-space-acl', spaceKey, probe: 'expand', status: r.status });
      if (r.status >= 200 && r.status < 300) {
        const parsed = JSON.parse(r.text || '{}');
        const perms = parsed.permissions || [];
        for (const p of perms) {
          if (p.subjects?.user?.results)  users += p.subjects.user.results.length;
          if (p.subjects?.group?.results) groups += p.subjects.group.results.length;
          if (p.anonymousAccess) anonymous = true;
        }
      }
    } catch (e) { tried.push({ type: 'cf-space-acl', spaceKey, error: String(e?.message || e).slice(0, 100) }); }
    bySpace[spaceKey] = { users, groups, anonymous, status: lastStatus };
  }));
  return { configured: true, bySpace, tried };
}

// V21 AQ (audit-09 §H #40) — Retro action-item closure rate.
// Шаблон: CF page с label IN ("retro", "retrospective", "post-mortem")
// + раздел «Action items» (h2) + Confluence task-list блок.
// CF storage format: `<ac:task><ac:task-status>complete|incomplete</ac:task-status>...`.
// Парсим body.storage, считаем complete/incomplete на page.
//
// Cap: 20 retro pages на pulse (recent). Per-page body fetch.
async function ppFetchRetroClosure(cfg, tls) {
  if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) return { configured: false, perPage: [], summary: { totalPages: 0, totalItems: 0, closed: 0 }, tried: [] };
  const cfBase = cfg.confluenceBaseUrl.replace(/\/+$/, '').replace(/\/wiki$/i, '');
  const auth = _ppMakeAuthHeader(cfg.confluenceToken);
  const tried = [];
  const spaceKeys = String(cfg.confluenceSpaceKeys || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  if (!spaceKeys.length) return { configured: true, perPage: [], summary: { totalPages: 0, totalItems: 0, closed: 0 }, tried, error: 'no-spaces' };

  // Step 1: discover recent retro pages по labels.
  const cqlSpaceFilter = spaceKeys.length ? `space IN (${spaceKeys.map(s => `"${s}"`).join(', ')}) AND ` : '';
  const cql = `${cqlSpaceFilter}type=page AND label IN ("retro", "retrospective", "post-mortem", "ретро") AND created > "now-180d"`;
  let pages = [];
  // PR-DA — path-cascade (Cloud /wiki/rest → DC /rest).
  for (const cascadeUrl of _cfBuildPathCascade(cfBase, '/rest/api/content/search')) {
    try {
      const url = `${cascadeUrl}?cql=${encodeURIComponent(cql)}&limit=20&expand=space,history`;
      const r = await _jiraForward({ targetUrl: url, method: 'GET', headers: { Authorization: auth, Accept: 'application/json' }, allowInsecureTls: tls, timeoutMs: 12000 });
      tried.push({ type: 'retro-search', status: r.status, base: cascadeUrl });
      if (r.status >= 200 && r.status < 300) {
        pages = (JSON.parse(r.text || '{}').results || []).slice(0, 20);
        break;
      }
      if (r.status === 401 || r.status === 403) break;
    } catch (e) { tried.push({ type: 'retro-search', error: String(e?.message || e).slice(0, 100), base: cascadeUrl }); }
  }

  if (!pages.length) return { configured: true, perPage: [], summary: { totalPages: 0, totalItems: 0, closed: 0 }, tried };

  // Step 2: per-page fetch body.storage + parse <ac:task-status>.
  const perPage = [];
  await _jiraPLimit(4, pages.map(p => async () => {
    try {
      const bodyUrl = `${cfBase}/rest/api/content/${encodeURIComponent(p.id)}?expand=body.storage`;
      const r = await _jiraForward({ targetUrl: bodyUrl, method: 'GET', headers: { Authorization: auth, Accept: 'application/json' }, allowInsecureTls: tls, timeoutMs: 10000 });
      tried.push({ type: 'retro-body', pageId: p.id, status: r.status });
      if (r.status < 200 || r.status >= 300) return;
      const body = JSON.parse(r.text || '{}').body?.storage?.value || '';
      // Парсим простым regex'ом — достаточно для CF task-list.
      const statuses = (body.match(/<ac:task-status>(complete|incomplete)<\/ac:task-status>/g) || [])
        .map(m => m.includes('complete</ac:task-status>') ? 'complete' : 'incomplete');
      const total = statuses.length;
      const closed = statuses.filter(s => s === 'complete').length;
      perPage.push({
        id:     p.id,
        title:  p.title || '',
        space:  p.space?.key || '',
        url:    `${cfBase}/pages/viewpage.action?pageId=${p.id}`,
        total, closed,
        ratio:  total > 0 ? +(closed / total).toFixed(3) : null,
      });
    } catch (e) { tried.push({ type: 'retro-body', pageId: p.id, error: String(e?.message || e).slice(0, 100) }); }
  }));

  const totalItems = perPage.reduce((s, p) => s + p.total, 0);
  const closed     = perPage.reduce((s, p) => s + p.closed, 0);
  return {
    configured: true,
    perPage: perPage.sort((a, b) => (a.ratio ?? -1) - (b.ratio ?? -1)),
    summary: {
      totalPages: perPage.length,
      totalItems,
      closed,
      ratio: totalItems > 0 ? +(closed / totalItems).toFixed(3) : null,
    },
    tried,
  };
}

// V21 Z6 (audit-09 §D #25, #26, #30, #32) — CF health metrics.
// 4 XS-CQL запроса per space: orphan pages / DoD-coverage / page-creation cadence /
// post-mortem coverage. Все возвращают только totalSize (limit=0) — дёшево.
async function ppFetchCfHealthMetrics(cfg, tls) {
  if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) return { configured: false, bySpace: {}, tried: [] };
  const cfBase = cfg.confluenceBaseUrl.replace(/\/+$/, '').replace(/\/wiki$/i, '');
  const auth = _ppMakeAuthHeader(cfg.confluenceToken);
  const tried = [];
  const bySpace = {};
  const spaceKeys = String(cfg.confluenceSpaceKeys || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  if (!spaceKeys.length) return { configured: true, bySpace: {}, tried, error: 'no-spaces-configured' };

  // Helper: count-only CQL.
  async function _cfCount(cql, label, spaceKey) {
    try {
      const url = `${cfBase}/rest/api/search?cql=${encodeURIComponent(cql)}&limit=0`;
      const r = await _jiraForward({ targetUrl: url, method: 'GET', headers: { Authorization: auth, Accept: 'application/json' }, allowInsecureTls: tls, timeoutMs: 10000 });
      tried.push({ type: label, spaceKey, status: r.status });
      if (r.status < 200 || r.status >= 300) return 0;
      const parsed = JSON.parse(r.text || '{}');
      return Number(parsed.totalSize) || 0;
    } catch (e) { tried.push({ type: label, spaceKey, error: String(e?.message || e).slice(0, 100) }); return 0; }
  }

  await _jiraPLimit(3, spaceKeys.slice(0, 10).map(spaceKey => async () => {
    const [orphans, dodCoverage, creationCadence30d, postMortems30d, totalPages, recentlyRestricted] = await Promise.all([
      // #25 Orphan pages — нет parent (ancestor!=*) или ancestor IS NULL.
      _cfCount(`space="${spaceKey}" AND type=page AND parent is EMPTY`, 'cf-orphan', spaceKey),
      // #26 DoD/DoR coverage — кол-во страниц упоминающих процессы.
      _cfCount(`space="${spaceKey}" AND type=page AND (text~"DoD" OR text~"Definition of Done" OR text~"DoR" OR text~"Definition of Ready")`, 'cf-dod', spaceKey),
      // #30 Page creation cadence — pages created за последние 30 дней.
      _cfCount(`space="${spaceKey}" AND type=page AND created > "now-30d"`, 'cf-creation', spaceKey),
      // #32 Post-mortem coverage — pages с label="post-mortem".
      _cfCount(`space="${spaceKey}" AND type=page AND label="post-mortem"`, 'cf-postmortem', spaceKey),
      // V21 AB — total pages для baseline.
      _cfCount(`space="${spaceKey}" AND type=page`, 'cf-total', spaceKey),
      // V21 AB (audit-09 §D #20) — restricted-pages proxy: pages последний раз
      // обновлённые недавно — на них чаще ставят ограничения. Точный счёт через
      // /restriction/byOperation требует per-page calls — пропускаем здесь и
      // даём proxy-метрику. Реальный count → отдельный fetcher per page.
      _cfCount(`space="${spaceKey}" AND type=page AND lastmodified > "now-90d"`, 'cf-recent', spaceKey),
    ]);
    bySpace[spaceKey] = {
      orphans, dodCoverage, creationCadence30d, postMortems30d,
      totalPages, recentlyEditedPages: recentlyRestricted,
      // Совместимость с UI tile: ratio orphan/total.
      orphanRatio: totalPages > 0 ? +(orphans / totalPages).toFixed(3) : 0,
      dodRatio:    totalPages > 0 ? +(dodCoverage / totalPages).toFixed(3) : 0,
    };
  }));

  // V21 AB (audit-09 §D #16) — pages owned by author (top-N).
  // Из уже-fetched cf.authors аккумулируем edits-counts как proxy для "ownership".
  // Не точно, но без новых HTTP-calls. Точная per-creator CQL — отдельный PR.
  const ownership = [];
  // (caller заполнит owners из existing confluence.authors).
  return { configured: true, bySpace, ownership, tried };
}

// Y4-3: Stale Confluence — CQL `lastmodified < -365d` per space.
async function ppFetchStaleConfluence(cfg, tls) {
  if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) return { configured: false, bySpace: {}, tried: [] };
  const cfBase = cfg.confluenceBaseUrl.replace(/\/+$/, '').replace(/\/wiki$/i, '');
  const auth = _ppMakeAuthHeader(cfg.confluenceToken);
  const tried = [];
  const bySpace = {};
  const spaceKeys = String(cfg.confluenceSpaceKeys || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  if (!spaceKeys.length) return { configured: true, bySpace: {}, tried, error: 'no-spaces-configured' };

  await _jiraPLimit(3, spaceKeys.slice(0, 10).map(spaceKey => async () => {
    try {
      const cql = `space="${spaceKey}" AND lastmodified < "now-365d" AND type=page`;
      const url = `${cfBase}/rest/api/search?cql=${encodeURIComponent(cql)}&limit=0`;
      const r = await _jiraForward({ targetUrl: url, method: 'GET', headers: { Authorization: auth, Accept: 'application/json' }, allowInsecureTls: tls, timeoutMs: 12000 });
      tried.push({ type: 'stale-cf', spaceKey, status: r.status });
      if (r.status < 200 || r.status >= 300) return;
      const parsed = JSON.parse(r.text || '{}');
      bySpace[spaceKey] = {
        staleCount: Number(parsed.totalSize) || 0,
        windowDays: 365,
      };
    } catch (e) { tried.push({ type: 'stale-cf', spaceKey, error: String(e?.message || e).slice(0, 100) }); }
  }));
  return { configured: true, bySpace, tried };
}

function create(deps) {
  _jiraForward            = deps.jiraForward;
  _jiraPLimit             = typeof deps.jiraPLimit === 'function'
    ? deps.jiraPLimit
    : async (_concurrency, tasks) => {
      // Fallback: serial executor (mirrors jira-api.js pattern). Real prod
      // wires upstream.jiraPLimit; this keeps unit smoke working.
      const out = [];
      for (const t of tasks) out.push(await t());
      return out;
    };
  _cfBuildPathCascade     = deps._cfBuildPathCascade;
  _ppMakeAuthHeader       = deps._ppMakeAuthHeader;
  _ppKeyForAuthor         = deps._ppKeyForAuthor;
  _ppRedactSecretsInText  = deps._ppRedactSecretsInText;
  return {
    ppFetchConfluenceActivity,
    ppFetchCfAuthorshipVelocity,
    ppFetchCfSpaceAcl,
    ppFetchRetroClosure,
    ppFetchCfHealthMetrics,
    ppFetchStaleConfluence,
  };
}

module.exports = { create };
