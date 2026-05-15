'use strict';
/* ============================================================================
 * server/bitbucket.js — V18 extraction step 5
 *
 * Bitbucket Activity / Governance fetchers extracted from server.js.
 * Все три функции — pure I/O fetchers, dependency-injected через factory:
 *   · jiraForward / jiraSleep        — низкоуровневый HTTP client (upstream.js)
 *   · _bbGateWait / _bbGateClose     — shared Bitbucket rate-limit gate
 *   · _breaker* / _httpCache* / etc. — circuit-breaker и cache primitives
 *   · jiraPLimit                     — concurrency limiter
 *   · ppHelpers (_ppMakeAuthHeader, _ppKeyForAuthor, _parseEmailName,
 *     _parseEmailEmail, _ppNormalizeBbTs, _ppBbAllowedProjects) — small
 *     pure helpers, передаются как объект с одноимёнными ключами.
 *
 * Public surface:
 *   const bb = require('./server/bitbucket.js').create({ ...deps });
 *   bb.ppFetchBitbucketActivity(cfg, tls, cutoffTs, cutoffIso) -> Promise<{...}>
 *   bb.ppFetchBitbucketGovernance(cfg, tls)                    -> Promise<{...}>
 *   bb._bbFetchWithRetry(opts)                                 -> Promise<{status,text,headers}>
 *
 * Обоснование dep-injection: server.js строит helpers (auth, key-for-author,
 * email-parse) в начале файла из require'ов на server/integrations/authHelpers
 * + локальных функций, и не имеет смысла дублировать их в этом модуле. Factory
 * получает уже резолвенные ссылки и закрывает их в module-level переменных.
 * ========================================================================== */

const logger = require('./logger.js');

// ── Module-level injected deps (set by create({...})). ──
let _jiraForward;
let _jiraSleep;
let _bbGateWaitFn;
let _bbGateCloseFn;
let _jiraPLimit;
// ppHelpers
let _ppMakeAuthHeader;
let _ppKeyForAuthor;
let _parseEmailName;
let _parseEmailEmail;
let _ppNormalizeBbTs;
let _ppBbAllowedProjects;

/**
 * BB fetch с retry на 429/502-504/network. До 4 попыток, exp backoff
 * c jitter, honors Retry-After header. shared-gate _bbGate* блокирует
 * остальные параллельные запросы пока 429-cooldown не пройдёт.
 * Pure: не пишет в tried — caller продолжает push'ить как до фикса
 * (запись в tried только финальный исход — 200 если retry помог, 429
 * если все попытки exhausted).
 * Returns {status, text, headers} like jiraForward.
 */
async function _bbFetchWithRetry(opts /*, label */) {
  const MAX_ATTEMPTS = 4;
  let delay = 1000;
  let last = { status: 0, text: '' };
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await _bbGateWaitFn();
    const r = await _jiraForward(opts).catch(e => ({ status: 0, text: '', _err: String(e?.message || e).slice(0, 120) }));
    last = r;
    if (r.status >= 200 && r.status < 300) return r;
    const retryable = r.status === 429 || (r.status >= 502 && r.status <= 504) || r.status === 0;
    if (!retryable || i === MAX_ATTEMPTS - 1) return r;
    if (r.status === 429) {
      const retryAfterSec = parseInt(r.headers?.['retry-after'] || '0', 10);
      const waitMs = Math.min(retryAfterSec > 0 ? retryAfterSec * 1000 : delay, 30000);
      _bbGateCloseFn(waitMs, `429 attempt ${i + 1}`);
      await _jiraSleep(waitMs);
    } else {
      await _jiraSleep(delay + Math.floor(Math.random() * 200));
    }
    delay = Math.min(delay * 2, 15000);
  }
  return last;
}

async function ppFetchBitbucketActivity(cfg, tls, cutoffTs, cutoffIso) {
  if (!cfg.bitbucketBaseUrl || !cfg.bitbucketToken) return { authors: {}, configured: false };
  const base = cfg.bitbucketBaseUrl.replace(/\/+$/, '');
  const auth = _ppMakeAuthHeader(cfg.bitbucketToken);
  const isCloud = /bitbucket\.org/i.test(base) || /\/2\.0\b/.test(base);
  // C4: убран hardcoded `.slice(0, 5)` — раньше первые 5 entries обрабатывались,
  // 6+ молча игнорились. Теперь cap через env (default 50 entries),
  // per-project cap по репозиториям остаётся в `expanded.push(...slice(REPO_CAP))`.
  const PROJECT_ENTRY_CAP = Math.max(1, Math.min(200, Number(process.env.PULSE_BB_PROJECT_ENTRIES) || 50));
  const repos = String(cfg.bitbucketProjectKeys || '')
    .split(',').map(s => s.trim()).filter(Boolean).slice(0, PROJECT_ENTRY_CAP);
  if (!repos.length) return { authors: {}, configured: true, error: 'projectKeys пусты' };
  // PR-CG — strict allowlist: после expand'а отбрасываем любые entries, чей
  // PROJECT-сегмент не входит в явно указанный список. Иначе на Server-е
  // listProjects/auto-expand мог тянуть репозитории из других projects (если
  // /projects/{KEY}/repos возвращает соседние репки или KEY имеет коллизию).
  // Для Cloud — workspaceKey == первая сегмент.
  const allowedProjectKeys = new Set(
    repos.map(r => (r.split('/')[0] || '').trim().toLowerCase()).filter(Boolean)
  );
  // lowerKey → { commits, prs, displayName, email,
  //              items: [{kind:'pr'|'commit', title, url, repo, at, status?}] }
  // items[] is capped at 50 per author so even a huge contributor stays bounded.
  const authors = {};
  // F3: было `tried.push(...)` без cap. С новыми пагинациями (50 entries ×
  // 5 страниц PR × 5 страниц commits) до ~25k записей → response раздувается
  // до МБ → slow serialize/network. Cap 2000 + флаг truncated.
  const TRIED_CAP = 2000;
  const _triedRaw = [];
  let _triedTruncated = false;
  const tried = new Proxy(_triedRaw, {
    get(target, prop) {
      if (prop === 'push') return (...args) => {
        if (target.length < TRIED_CAP) return target.push(...args);
        _triedTruncated = true;
        return target.length;
      };
      return target[prop];
    }
  });
  const ITEMS_CAP_PER_AUTHOR = 50;
  const bump = (kind, displayName, email, item, slug) => {
    const k = _ppKeyForAuthor(displayName, email);
    if (!k) return;
    if (!authors[k]) authors[k] = {
      commits: 0, prs: 0, displayName: displayName || email || k, email: email || '', items: [],
      // Wave 4d: PR review action counters. `reviews` is the umbrella sum;
      // breakdowns let the renderer show "✓3 approve · ⚠1 needs-work".
      reviews: 0, approves: 0, needsWork: 0, declined: 0, prComments: 0,
    };
    if (!authors[k][kind] && kind !== 'reviews') authors[k][kind] = 0;
    authors[k][kind]++;
    if (!authors[k].displayName && displayName) authors[k].displayName = displayName;
    if (!authors[k].email && email) authors[k].email = email;
    // Store Stash login slug so attribution can match emp.bitbucketLogin → author.
    const sl = String(slug || '').toLowerCase().trim();
    if (sl && !authors[k].slug) authors[k].slug = sl;
    if (item && authors[k].items.length < ITEMS_CAP_PER_AUTHOR) {
      authors[k].items.push(item);
    }
  };
  // Track PRs we should ask for activity stream. Each entry: {proj, repo, prId, at, title, url, isCloud:false, repoPath}.
  // Capped globally to 30 to bound the per-PK 90 s budget.
  const _prsForActivity = [];
  const ACTIVITY_CAP = 30;
  // V21 BB-RL fix — _bbFetchWithRetry поверх jiraForward: 4 попытки, shared
  // _bbGate, honors Retry-After. До этого: 66% запросов 429 → данные пропадали.
  const get = (url) => _bbFetchWithRetry({
    targetUrl: url, method: 'GET',
    headers: { Authorization: auth },
    allowInsecureTls: tls, timeoutMs: 20000,
  });

  // Expand single-segment Server entries (e.g. "SBOFPL") to all repos under
  // that project — saves the user from having to list every repo manually.
  const expanded = [];
  for (const entry of repos) {
    const segs = entry.split('/').map(s => s.trim()).filter(Boolean);
    if (segs.length >= 2 || isCloud) { expanded.push(entry); continue; }
    // Single segment + Server mode: probe `/projects/{KEY}/repos`.
    const projKey = segs[0];
    const repoListResp = await _jiraForward({
      targetUrl: `${base}/rest/api/1.0/projects/${encodeURIComponent(projKey)}/repos?limit=50`,
      method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 15000,
    }).catch(e => ({ status: 0, text: '', _err: e.message }));
    tried.push({ entry, type: 'list-repos', status: repoListResp.status });
    if (repoListResp.status >= 200 && repoListResp.status < 300) {
      try {
        // M9 (revert): «sort by r.id desc» переключал на свежесозданные репо
        // (часто sandbox/копии), активные старые репо вылетали — diagnostic
        // показал регрессию: 10 авторов → 4, PR/reviews обнулились.
        // Возвращаем исходный порядок Stash (алфавитно по name).
        const list = (JSON.parse(repoListResp.text).values || []).map(r => `${projKey}/${r.slug || r.name}`);
        if (list.length) {
          // PR-CG: cap был 10 — у крупных Stash-проектов (SBOFPL и т.п.)
          // 11-й и далее репо не сканировались. Поднимаем до 50, env-параметр.
          const REPO_CAP_PER_PROJECT = Math.max(5, Math.min(200, Number(process.env.PULSE_BB_REPOS_PER_PROJECT) || 50));
          expanded.push(...list.slice(0, REPO_CAP_PER_PROJECT));
          tried.push({ entry, type: 'list-repos-result', total: list.length, taken: Math.min(list.length, REPO_CAP_PER_PROJECT) });
        } else {
          tried.push({ entry, skipped: 'у проекта нет репозиториев или нет доступа' });
        }
      } catch (_) {
        tried.push({ entry, skipped: 'не удалось разобрать список репозиториев' });
      }
    } else {
      tried.push({ entry, skipped: `проект не найден / 401-403 (HTTP ${repoListResp.status}) — нужен формат PROJECT/repo для Server, либо токен без доступа к проекту` });
    }
  }

  // F2: было sequential `for (const entry of expanded)`. С увеличенными
  // cap'ами (50 entries × 5 страниц PR × 5 страниц commits) worst-case
  // суммирует до 250с на 90с-таймауте → ложный timeout → empty data.
  // Параллелим через jiraPLimit (default 4, env-параметр).
  const BB_REPO_CONCURRENCY = Math.max(1, Math.min(16, Number(process.env.PULSE_BB_REPO_CONCURRENCY) || 4));
  await _jiraPLimit(BB_REPO_CONCURRENCY, expanded.map(entry => async () => {
    const segs = entry.split('/').map(s => s.trim()).filter(Boolean);
    if (segs.length < 2 && !isCloud) { tried.push({ entry, skipped: 'нужен формат PROJECT/repo для Server' }); return; }
    const proj = segs.length >= 2 ? segs[0] : '';
    const repo = segs[segs.length - 1];
    // PR-CG strict allowlist enforcement: pure-defense проверка после expand'а.
    if (proj && !allowedProjectKeys.has(proj.toLowerCase())) {
      tried.push({ entry, skipped: `вне allowlist'а проектов (${[...allowedProjectKeys].join(', ')})` });
      return;
    }

    // === CLOUD ===
    if (isCloud) {
      const repoPath = segs.length >= 2 ? `${segs[0]}/${segs[1]}` : repo;
      // Pull-requests updated in 48h window. q= filter is server-side (cheap).
      const prsResp = await get(`${base}/repositories/${encodeURI(repoPath)}/pullrequests?pagelen=50&state=OPEN,MERGED,DECLINED&q=updated_on>"${cutoffIso}"`);
      tried.push({ entry: repoPath, type: 'pr', status: prsResp.status });
      if (prsResp.status >= 200 && prsResp.status < 300) {
        try { for (const p of (JSON.parse(prsResp.text).values || [])) {
          bump('prs', p.author?.display_name || '', p.author?.nickname || '', {
            kind: 'pr',
            title:  p.title || '',
            url:    p.links?.html?.href || '',
            repo:   repoPath,
            at:     p.updated_on || p.created_on || '',
            status: (p.state || '').toLowerCase(),
          });
        } } catch(e) {
          // M1: было `catch(_) {}` — JSON.parse на corrupted gzip / proxy
          // injection молчаливо терял весь PR-список репозитория.
          tried.push({ entry: repoPath, type: 'pr-parse', error: String(e?.message || e).slice(0, 100) });
        }
      }
      // Commits — no server-side date filter, paginate first page and filter client-side.
      const cmResp = await get(`${base}/repositories/${encodeURI(repoPath)}/commits?pagelen=100`);
      tried.push({ entry: repoPath, type: 'commit', status: cmResp.status });
      if (cmResp.status >= 200 && cmResp.status < 300) {
        try {
          for (const c of (JSON.parse(cmResp.text).values || [])) {
            const ts = Date.parse(c.date || '');
            if (!Number.isFinite(ts) || ts < cutoffTs) continue;
            const dn = c.author?.user?.display_name || _parseEmailName(c.author?.raw);
            const em = _parseEmailEmail(c.author?.raw);
            bump('commits', dn, em, {
              kind: 'commit',
              title: (c.message || '').split('\n')[0],
              url:    c.links?.html?.href || '',
              repo:   repoPath,
              at:     c.date || '',
              hash:   c.hash || '',
            });
          }
        } catch(e) {
          tried.push({ entry: repoPath, type: 'commit-parse', error: String(e?.message || e).slice(0, 100) });
        }
      }
      return;
    }
    // === SERVER (Stash) ===
    if (proj && repo) {
      // H2: пагинация PR'ов через `start`/`isLastPage` пока last seen
      // `updatedDate >= cutoffTs`. Раньше брали 50 первых — на busy 48ч-окне
      // 51+ PR'ы молча терялись.
      const PR_PAGES_CAP = Math.max(1, Math.min(20, Number(process.env.PULSE_BB_PR_PAGES_CAP) || 5));
      let prStart = 0;
      let prPages = 0;
      let prContinue = true;
      while (prContinue && prPages < PR_PAGES_CAP) {
        const prsResp = await get(`${base}/rest/api/1.0/projects/${encodeURIComponent(proj)}/repos/${encodeURIComponent(repo)}/pull-requests?state=ALL&order=NEWEST&limit=50&start=${prStart}`);
        tried.push({ entry, type: 'pr', status: prsResp.status, page: prPages });
        if (prsResp.status < 200 || prsResp.status >= 300) break;
        let parsedPr;
        try { parsedPr = JSON.parse(prsResp.text); }
        catch (e) {
          tried.push({ entry, type: 'pr-parse', error: String(e?.message || e).slice(0, 100) });
          break;
        }
        const values = parsedPr.values || [];
        // R1: пустая страница без isLastPage = бесконечный pagination до CAP.
        // Сразу выходим если values пустой.
        if (!values.length) { prContinue = false; break; }
        let lastSeenTs = Infinity;
        for (const p of values) {
          const ts = _ppNormalizeBbTs(p.updatedDate || p.createdDate || 0);
          lastSeenTs = Math.min(lastSeenTs, ts || lastSeenTs);
          if (ts < cutoffTs) continue;
          const u = p.author?.user || {};
          const prTitle = p.title || '';
          const prUrl   = p.links?.self?.[0]?.href || '';
          bump('prs', u.displayName || u.name || '', u.emailAddress || '', {
            kind: 'pr',
            title:  prTitle,
            url:    prUrl,
            repo:   `${proj}/${repo}`,
            at:     ts ? new Date(ts).toISOString() : '',
            status: (p.state || '').toLowerCase(),
            prId:   p.id,
          }, u.name || u.slug || '');
          const reviewerNames = Array.isArray(p.reviewers)
            ? p.reviewers.map(r => r.user?.displayName || r.user?.name || '').filter(Boolean)
            : [];
          const prAuthor = u.displayName || u.name || '';
          if (_prsForActivity.length < ACTIVITY_CAP && p.id != null) {
            _prsForActivity.push({ proj, repo, prId: p.id, at: ts, title: prTitle, url: prUrl, reviewers: reviewerNames, author: prAuthor });
          }
        }
        prPages++;
        // Прекращаем пагинацию: последняя страница ИЛИ последний PR старше cutoff.
        if (parsedPr.isLastPage === true) prContinue = false;
        else if (Number.isFinite(lastSeenTs) && lastSeenTs < cutoffTs) prContinue = false;
        else if (typeof parsedPr.nextPageStart === 'number') prStart = parsedPr.nextPageStart;
        else prStart += 50;
      }

      // H2: commits аналогично — paginate пока authorTimestamp >= cutoffTs.
      const CM_PAGES_CAP = Math.max(1, Math.min(20, Number(process.env.PULSE_BB_COMMIT_PAGES_CAP) || 5));
      let cmStart = 0;
      let cmPages = 0;
      let cmContinue = true;
      while (cmContinue && cmPages < CM_PAGES_CAP) {
        const cmResp = await get(`${base}/rest/api/1.0/projects/${encodeURIComponent(proj)}/repos/${encodeURIComponent(repo)}/commits?limit=100&start=${cmStart}`);
        tried.push({ entry, type: 'commit', status: cmResp.status, page: cmPages });
        if (cmResp.status < 200 || cmResp.status >= 300) break;
        let parsedCm;
        try { parsedCm = JSON.parse(cmResp.text); }
        catch (e) {
          tried.push({ entry, type: 'commit-parse', error: String(e?.message || e).slice(0, 100) });
          break;
        }
        const values = parsedCm.values || [];
        // R1: empty-page guard.
        if (!values.length) { cmContinue = false; break; }
        let lastSeenTs = Infinity;
        for (const c of values) {
          const ts = _ppNormalizeBbTs(c.authorTimestamp || c.committerTimestamp || 0);
          lastSeenTs = Math.min(lastSeenTs, ts || lastSeenTs);
          if (ts < cutoffTs) continue;
          const a = c.author || {};
          bump('commits', a.displayName || a.name || '', a.emailAddress || '', {
            kind: 'commit',
            title: (c.message || '').split('\n')[0],
            url:   `${base}/projects/${proj}/repos/${repo}/commits/${c.id || c.displayId || ''}`,
            repo:  `${proj}/${repo}`,
            at:    ts ? new Date(ts).toISOString() : '',
            hash:  c.displayId || c.id || '',
          }, a.name || a.slug || '');
        }
        cmPages++;
        if (parsedCm.isLastPage === true) cmContinue = false;
        else if (Number.isFinite(lastSeenTs) && lastSeenTs < cutoffTs) cmContinue = false;
        else if (typeof parsedCm.nextPageStart === 'number') cmStart = parsedCm.nextPageStart;
        else cmStart += 100;
      }
    }
  }));
  // V21 Y3 (audit-09 §F + #16-#18 sleeping data) — per-PR lifecycle aggregator.
  // Используем те же activities, что уже едут — для каждого PR накапливаем
  // openedAt / firstReviewAt / mergedAt / commentsCount; в конце вычисляем
  // p50/p90 cycle-time и first-review-latency. Это чистый агрегатор поверх
  // существующих данных (zero new HTTP).
  const _prLifecycle = new Map(); // `${proj}/${repo}#${prId}` → { openedAt, firstReviewAt, mergedAt, comments }

  // V21 Z5 — Reviewer assignment + activity tracking.
  // PR-CV bug-fix: declarations подняты ВЫШЕ activity-Promise. Раньше они
  // объявлялись `const` после Promise (line ~1632) — внутри callback'а на
  // line ~1597 `reviewerActivities.get()` срабатывал TDZ ReferenceError,
  // который глотался `try/catch(_) {}`. Map оставалась пустой → idle=[]
  // и acted=0 для всех ревьюеров (ложное «все участвуют» / overload пуст).
  const reviewerAssignments = new Map();   // name → assignedCount
  const reviewerActivities  = new Map();   // name → Set<prId> где имеется review-action
  const reviewerComments    = new Map();   // PR-CY — name → totalCommentsCount across all PRs

  // ── Wave 4d: pull review-action stream for the recent PRs (Server). ──
  // Each PR's `/activities` returns a paginated list of events: APPROVED,
  // UNAPPROVED, REVIEWED, COMMENTED, DECLINED, MERGED, OPENED, etc. We bump
  // per-author counters for the review-relevant ones and append items[] so
  // the timeline can show "Иван approved PAY-1234 (PR #234)".
  if (_prsForActivity.length) {
    const ACTIVITY_CONCURRENCY = 4;
    let i = 0, running = 0;
    await new Promise((resolve) => {
      const next = () => {
        while (running < ACTIVITY_CONCURRENCY && i < _prsForActivity.length) {
          const job = _prsForActivity[i++]; running++;
          (async () => {
            const { proj, repo, prId, title, url } = job;
            const aResp = await get(`${base}/rest/api/1.0/projects/${encodeURIComponent(proj)}/repos/${encodeURIComponent(repo)}/pull-requests/${prId}/activities?limit=100`);
            tried.push({ entry: `${proj}/${repo}#${prId}`, type: 'pr-activity', status: aResp.status });
            if (aResp.status >= 200 && aResp.status < 300) {
              try {
                // V21 Y3 / PR-CY — per-PR lifecycle bucket.
                const lkKey = `${proj}/${repo}#${prId}`;
                const lk = (_prLifecycle.get(lkKey)) || {
                  openedAt: 0, firstReviewAt: 0, mergedAt: 0,
                  declinedAt: 0,           // PR-CY — для cycleTimeDeclined
                  lastActivityAt: 0,       // PR-CY — для abandoned-detection
                  comments: 0,
                };
                _prLifecycle.set(lkKey, lk);
                for (const a of (JSON.parse(aResp.text).values || [])) {
                  const ts = _ppNormalizeBbTs(a.createdDate || 0);
                  // V21 Y3 — для lifecycle принимаем любой ts, не только > cutoffTs;
                  // PR открытый раньше окна тоже даёт valid cycle-time.
                  const action = String(a.action || '').toUpperCase();
                  if (action === 'OPENED'   && ts && (!lk.openedAt   || ts < lk.openedAt))   lk.openedAt   = ts;
                  if (action === 'APPROVED' && ts && (!lk.firstReviewAt || ts < lk.firstReviewAt)) lk.firstReviewAt = ts;
                  if (action === 'MERGED'   && ts && (!lk.mergedAt   || ts > lk.mergedAt))   lk.mergedAt   = ts;
                  if (action === 'DECLINED' && ts && (!lk.declinedAt || ts > lk.declinedAt)) lk.declinedAt = ts;
                  if (ts && ts > lk.lastActivityAt) lk.lastActivityAt = ts;
                  if (action === 'COMMENTED') lk.comments++;
                  if (ts < cutoffTs) continue;
                  const u = a.user || {};
                  const dn = u.displayName || u.name || '';
                  const em = u.emailAddress || '';
                  const sl = u.name || u.slug || '';
                  // PR-CY — per-reviewer comment-depth: бампаем счётчик при COMMENTED.
                  if (action === 'COMMENTED') {
                    const key = dn || em;
                    if (key) reviewerComments.set(key, (reviewerComments.get(key) || 0) + 1);
                  }
                  // Map Stash actions → which counter to bump. Skip OPENED /
                  // MERGED / RESCOPED — those are author-side, not reviews.
                  // V21 Z5 — record reviewer activity per PR для idle detection.
                  if (action === 'APPROVED' || action === 'REVIEWED' || action === 'COMMENTED' || action === 'DECLINED') {
                    const key = dn || em;
                    if (key) {
                      const set = reviewerActivities.get(key) || new Set();
                      set.add(`${proj}/${repo}#${prId}`);
                      reviewerActivities.set(key, set);
                    }
                  }
                  const counter =
                    action === 'APPROVED'  ? 'approves'   :
                    action === 'REVIEWED'  ? 'needsWork'  :    // Stash uses REVIEWED for needs-work
                    action === 'DECLINED'  ? 'declined'   :
                    action === 'COMMENTED' ? 'prComments' : '';
                  if (!counter) continue;
                  // Bump both: specific counter + umbrella `reviews`.
                  bump(counter, dn, em, {
                    kind:  'review',
                    title: `${action.toLowerCase()} · ${title}`,
                    url,   repo: `${proj}/${repo}`,
                    at:    ts ? new Date(ts).toISOString() : '',
                    action,
                    prId,
                  }, sl);
                  bump('reviews', dn, em, null, sl);
                }
              } catch(_) {}
            }
          })().finally(() => { running--; if (i >= _prsForActivity.length && running === 0) resolve(); else next(); });
        }
      };
      next();
    });
  }

  // V21 Z5 (audit-09 §C #15, #18) — Reviewer overload + idle reviewer.
  // Overload: top-N авторов по числу assigned reviews.
  // Idle: reviewer попал в reviewers[] но нет ни одной activity (approve/comment/needsWork).
  // PR-CV — заполнение `reviewerAssignments` после Promise (теперь, когда
  // activity-loop уже отработал и `reviewerActivities` собран корректно).
  // `reviewerActivities` копится внутри callback'а на каждый APPROVED /
  // REVIEWED / COMMENTED / DECLINED event.
  for (const job of _prsForActivity) {
    for (const rev of (job.reviewers || [])) {
      reviewerAssignments.set(rev, (reviewerAssignments.get(rev) || 0) + 1);
    }
  }

  // V21 Y3 — compute PR cycle-time / first-review-latency / review-depth.
  // Cycle-time: openedAt → mergedAt (для merged PR'ов).
  // First-review-latency: openedAt → firstReviewAt (APPROVED событие).
  // Review-depth: средний COMMENTED count per PR.
  const _quantile = (arr, q) => {
    if (!arr.length) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
    return sorted[idx];
  };
  // PR-CY — три отдельных bucket'а для cycle-time:
  //   merged    — PR доехал до prod (openedAt → mergedAt)
  //   declined  — PR отказан (openedAt → declinedAt)
  //   abandoned — PR ни merged, ни declined, lastActivity > 7 дней назад
  // Раньше учитывались только merged → p50/p90 завышены для команд с decline'ами.
  const ABANDONED_THRESHOLD_MS = 7 * 24 * 3600 * 1000;
  const nowMs = Date.now();
  const cycleTimes = [];
  const cycleTimesDeclined = [];
  const cycleTimesAbandoned = [];
  const firstReviews = [];
  const commentsCounts = [];
  let abandonedCount = 0;
  for (const lk of _prLifecycle.values()) {
    if (lk.openedAt && lk.mergedAt && lk.mergedAt > lk.openedAt) {
      cycleTimes.push(lk.mergedAt - lk.openedAt);
    } else if (lk.openedAt && lk.declinedAt && lk.declinedAt > lk.openedAt) {
      cycleTimesDeclined.push(lk.declinedAt - lk.openedAt);
    } else if (lk.openedAt && !lk.mergedAt && !lk.declinedAt
               && lk.lastActivityAt > 0
               && nowMs - lk.lastActivityAt > ABANDONED_THRESHOLD_MS) {
      cycleTimesAbandoned.push(nowMs - lk.openedAt);
      abandonedCount++;
    }
    if (lk.openedAt && lk.firstReviewAt && lk.firstReviewAt > lk.openedAt) {
      firstReviews.push(lk.firstReviewAt - lk.openedAt);
    }
    commentsCounts.push(lk.comments);
  }
  const prMetrics = {
    cycleTimeMs: { p50: _quantile(cycleTimes, 0.50), p90: _quantile(cycleTimes, 0.90), n: cycleTimes.length },
    // PR-CY — раздельные bucket'ы.
    cycleTimeDeclined:  { p50: _quantile(cycleTimesDeclined,  0.50), p90: _quantile(cycleTimesDeclined,  0.90), n: cycleTimesDeclined.length },
    cycleTimeAbandoned: { p50: _quantile(cycleTimesAbandoned, 0.50), p90: _quantile(cycleTimesAbandoned, 0.90), n: cycleTimesAbandoned.length, count: abandonedCount },
    firstReviewMs: { p50: _quantile(firstReviews,  0.50), p90: _quantile(firstReviews,  0.90), n: firstReviews.length },
    reviewDepth:   {
      avgComments: commentsCounts.length ? (commentsCounts.reduce((s, n) => s + n, 0) / commentsCounts.length) : 0,
      p50:         _quantile(commentsCounts, 0.50),
      p90:         _quantile(commentsCounts, 0.90),
      n:           commentsCounts.length,
    },
  };

  // V21 AC + PR-CY — Code-review depth теперь использует реальные comment-counts
  // per reviewer (раньше был proxy через `prsReviewed.size` без учёта что
  // одни ревьюеры дают 100 комментов на PR, другие — 1).
  // `reviewerComments` собирается в activity-loop выше при action === 'COMMENTED'.
  const codeReviewDepth = [];
  for (const [name, prSet] of reviewerActivities) {
    const totalComments = reviewerComments.get(name) || 0;
    const prsReviewed = prSet.size;
    codeReviewDepth.push({
      name,
      prsReviewed,
      totalComments,
      avgCommentsPerPr: prsReviewed > 0 ? +(totalComments / prsReviewed).toFixed(2) : 0,
    });
  }
  codeReviewDepth.sort((a, b) => b.totalComments - a.totalComments);

  // V21 AF (audit-09 §H Person #25) — Mentorship signal.
  // Pair (mentor, mentee): сколько раз mentor approve/comment чужие PR.
  // Чем больше A→B и < — B→A асимметрия, тем сильнее mentorship.
  const mentorshipPairs = new Map(); // "mentor|mentee" → count
  for (const job of _prsForActivity) {
    const author = job.author || '';
    if (!author) continue;
    const actedReviewers = (job.reviewers || []).filter(r =>
      (reviewerActivities.get(r) || new Set()).has(`${job.proj}/${job.repo}#${job.prId}`)
    );
    for (const rev of actedReviewers) {
      if (rev === author) continue;
      const k = `${rev}|${author}`;
      mentorshipPairs.set(k, (mentorshipPairs.get(k) || 0) + 1);
    }
  }
  // Build mentorship: top pairs by asymmetry.
  const mentorScores = [];
  const seenPairs2 = new Set();
  for (const [k, count] of mentorshipPairs) {
    const [a, b] = k.split('|');
    const reverseCount = mentorshipPairs.get(`${b}|${a}`) || 0;
    const pairKey = [a, b].sort().join('|');
    if (seenPairs2.has(pairKey)) continue;
    seenPairs2.add(pairKey);
    if (count > reverseCount) {
      mentorScores.push({ mentor: a, mentee: b, score: count - reverseCount, helped: count });
    } else if (reverseCount > count) {
      mentorScores.push({ mentor: b, mentee: a, score: reverseCount - count, helped: reverseCount });
    }
  }
  mentorScores.sort((a, b) => b.score - a.score);

  // V21 AC (audit-09 §H Person #24) — Review reciprocity.
  // Edges: для каждого PR строим edge prAuthor → reviewer (если reviewer действовал).
  // Reciprocity = пар (A, B) где есть и A→B и B→A / total unique pairs.
  const edges = new Set(); // "A|B" (A reviewed PR by B)
  for (const job of _prsForActivity) {
    const author = job.author || '';
    if (!author) continue;
    const reviewers = reviewerActivities && (job.reviewers || []).filter(r => (reviewerActivities.get(r) || new Set()).has(`${job.proj}/${job.repo}#${job.prId}`));
    for (const rev of (reviewers || [])) {
      if (rev !== author) edges.add(`${rev}|${author}`);
    }
  }
  let reciprocalPairs = 0, totalPairs = 0;
  const seenPairs = new Set();
  for (const e of edges) {
    const [a, b] = e.split('|');
    const pairKey = [a, b].sort().join('|');
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    totalPairs++;
    if (edges.has(`${b}|${a}`)) reciprocalPairs++;
  }
  const reciprocity = {
    pairs:       totalPairs,
    reciprocal:  reciprocalPairs,
    ratio:       totalPairs > 0 ? +(reciprocalPairs / totalPairs).toFixed(3) : 0,
  };

  // V21 Z5 / PR-CV — Reviewer overload + idle.
  //
  // Bitbucket Server без mandatory-reviewer policy часто возвращает PR с
  // пустым `reviewers[]` (формального назначения не было, есть только
  // активность). Раньше при пустом reviewers[] reviewerAssignments тоже
  // оставался пустым → overload=[] и idle=[]. Теперь fallback: если formal
  // assignments < acted-people, добираем из activity-track. Это даёт UI
  // картину «кто реально ревьюит» а не «кто формально назначен».
  const overloadCandidates = new Map(); // name → { assigned, source: 'formal'|'activity'|'both' }
  for (const [name, n] of reviewerAssignments) {
    overloadCandidates.set(name, { assigned: n, source: 'formal' });
  }
  for (const [name, prSet] of reviewerActivities) {
    if (overloadCandidates.has(name)) {
      overloadCandidates.get(name).source = 'both';
    } else {
      // Activity-based reviewer без formal assignment — считаем активные PR'ы
      // как pseudo-assigned (минимум сколько он реально ревьюил).
      overloadCandidates.set(name, { assigned: prSet.size, source: 'activity' });
    }
  }
  const reviewerOverload = [...overloadCandidates.entries()]
    .map(([name, info]) => ({
      name,
      assigned: info.assigned,
      acted: (reviewerActivities.get(name) || new Set()).size,
      idle:  info.assigned > 0 && (reviewerActivities.get(name) || new Set()).size === 0,
      source: info.source,
    }))
    .sort((a, b) => b.assigned - a.assigned);
  // Idle обнаруживаем ТОЛЬКО среди formal-assigned (activity-based по
  // определению не idle — раз уж в activity-set попал, что-то делал).
  const idleReviewers = reviewerOverload.filter(r => r.idle && r.assigned >= 2 && r.source === 'formal');
  const reviewerStats = {
    overload: reviewerOverload.slice(0, 10),
    idle:     idleReviewers.slice(0, 20),
    total:    reviewerOverload.length,
    // PR-CV diagnostics — чтобы видеть в /diagnostic почему пусто.
    formalAssignmentsCount: reviewerAssignments.size,
    activityReviewersCount: reviewerActivities.size,
    note: reviewerAssignments.size === 0 && reviewerActivities.size > 0
      ? 'PR в Bitbucket без formal reviewers[] — overload построен по participants из activity (approve/comment).'
      : (reviewerAssignments.size === 0 && reviewerActivities.size === 0
         ? 'Нет PR с reviewer-action за окно (либо PR-список пуст, либо все без действий).'
         : null),
  };

  return { authors, configured: true, repos: expanded.length, allowedProjectKeys: [...allowedProjectKeys], tried: _triedRaw, triedTruncated: _triedTruncated, prActivitiesScanned: _prsForActivity.length, prMetrics, reviewerStats, codeReviewDepth, reciprocity, mentorScores: mentorScores.slice(0, 10) };
}

async function ppFetchBitbucketGovernance(cfg, tls) {
  if (!cfg.bitbucketBaseUrl || !cfg.bitbucketToken) return { configured: false, perRepo: {}, prSizes: [], tried: [] };
  const base = cfg.bitbucketBaseUrl.replace(/\/+$/, '');
  const auth = _ppMakeAuthHeader(cfg.bitbucketToken);
  const tried = [];
  const perRepo = {};

  // TECH 17.6 — все BB-запросы внутри governance идут через shared
  // `_bbGate`, как `ppFetchBitbucketActivity` (V21 BB-RL fix).
  // Раньше: прямой `jiraForward` без gate'а — при 429 storm'е activity-
  // fetcher уходил в cooldown, а governance параллельно бил тем же
  // IP'ом и подбавлял 429-ов (одна общая Stash-rate-limit-bucket
  // на корпоративный auth). Теперь — единая очередь.
  // Wrap'аем jiraForward через `_bbGateWait()` перед запросом и
  // `_bbGateClose(retryAfter)` на 429 (ровно та же pattern что в
  // jiraRequest для Jira). Без retry-loop'а: для governance это
  // best-effort, лучше пропустить repo при 429, чем держать BFS на 30s.
  const govFwd = async (opts) => {
    await _bbGateWaitFn();
    const r = await _jiraForward(opts).catch(e => ({ status: 0, text: '', _err: String(e?.message || e).slice(0, 120) }));
    if (r && r.status === 429) {
      const retryAfterSec = parseInt(r.headers?.['retry-after'] || '0', 10);
      const waitMs = Math.min(retryAfterSec > 0 ? retryAfterSec * 1000 : 5000, 30000);
      _bbGateCloseFn(waitMs, 'governance 429');
    }
    return r;
  };

  // Reuse repo discovery pattern from ppFetchStaleBranches.
  const repos = [];
  try {
    // C5: env-параметризация для governance (было slice(0,5) per-project).
    const GOV_REPOS_PER_PROJ = Math.max(1, Math.min(50, Number(process.env.PULSE_BB_GOV_REPOS_PER_PROJECT) || 20));
    const GOV_REPO_LIMIT = Math.max(5, Math.min(200, Number(process.env.PULSE_BB_GOV_REPO_LIMIT) || 80));
    const projsR = await govFwd({ targetUrl: `${base}/rest/api/1.0/projects?limit=50`, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 8000 });
    if (projsR.status >= 200 && projsR.status < 300) {
      let projs = JSON.parse(projsR.text || '{}').values || [];
      // PR-CG: фильтруем проекты по bitbucketProjectKeys allowlist.
      const allow = _ppBbAllowedProjects(cfg);
      if (allow.size) projs = projs.filter(p => allow.has(String(p.key || '').toLowerCase()));
      for (const p of projs) {
        if (repos.length >= GOV_REPO_LIMIT) break;
        const reposR = await govFwd({ targetUrl: `${base}/rest/api/1.0/projects/${encodeURIComponent(p.key)}/repos?limit=50`, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 8000 });
        if (reposR.status >= 200 && reposR.status < 300) {
          const list = JSON.parse(reposR.text || '{}').values || [];
          // M9 revert: исходный Stash-порядок (алфавитно).
          for (const r of list.slice(0, GOV_REPOS_PER_PROJ)) {
            repos.push({ proj: p.key, repo: r.slug });
            if (repos.length >= GOV_REPO_LIMIT) break;
          }
        }
      }
    }
  } catch (e) { tried.push({ type: 'gov-discover', error: String(e?.message || e).slice(0, 100) }); }
  if (!repos.length) return { configured: true, perRepo: {}, prSizes: [], tried, error: 'no-repos' };

  // ACL + hooks per repo (parallel).
  await _jiraPLimit(6, repos.map(({ proj, repo }) => async () => {
    const repoKey = `${proj}/${repo}`;
    const stats = { acl: { users: 0, groups: 0 }, hooks: { configured: 0, enabled: 0 } };
    try {
      // ACL — users + groups.
      const usersR = await govFwd({ targetUrl: `${base}/rest/api/1.0/projects/${encodeURIComponent(proj)}/repos/${encodeURIComponent(repo)}/permissions/users?limit=100`, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 8000 });
      tried.push({ type: 'acl-users', proj, repo, status: usersR.status });
      if (usersR.status >= 200 && usersR.status < 300) {
        stats.acl.users = (JSON.parse(usersR.text || '{}').values || []).length;
      }
      const groupsR = await govFwd({ targetUrl: `${base}/rest/api/1.0/projects/${encodeURIComponent(proj)}/repos/${encodeURIComponent(repo)}/permissions/groups?limit=100`, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 8000 });
      tried.push({ type: 'acl-groups', proj, repo, status: groupsR.status });
      if (groupsR.status >= 200 && groupsR.status < 300) {
        stats.acl.groups = (JSON.parse(groupsR.text || '{}').values || []).length;
      }
    } catch (e) { tried.push({ type: 'acl', proj, repo, error: String(e?.message || e).slice(0, 100) }); }
    try {
      // Hooks — `/settings/hooks` returns list of available hooks with `enabled` flag.
      const hooksR = await govFwd({ targetUrl: `${base}/rest/api/1.0/projects/${encodeURIComponent(proj)}/repos/${encodeURIComponent(repo)}/settings/hooks?limit=100`, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 8000 });
      tried.push({ type: 'hooks', proj, repo, status: hooksR.status });
      if (hooksR.status >= 200 && hooksR.status < 300) {
        const hooks = JSON.parse(hooksR.text || '{}').values || [];
        stats.hooks.configured = hooks.filter(h => h.configured).length;
        stats.hooks.enabled    = hooks.filter(h => h.enabled).length;
      }
    } catch (e) { tried.push({ type: 'hooks', proj, repo, error: String(e?.message || e).slice(0, 100) }); }
    perRepo[repoKey] = stats;
  }));

  // V21 BD (audit-09 §C #9 full) — PR-size full coverage.
  // Cap расширили 20→200; обрабатываем больше PR'ов параллельно (jiraPLimit 6).
  // Добавлено bucketing S/M/L/XL и histogram. Общий cap calls = REPOS × 50.
  const PR_SIZE_CAP = 200;
  const PR_PER_REPO = 25;
  const prSizes = [];
  const prSizeTasks = [];
  for (const { proj, repo } of repos.slice(0, 10)) {
    prSizeTasks.push(async () => {
      if (prSizes.length >= PR_SIZE_CAP) return;
      try {
        const prsR = await govFwd({ targetUrl: `${base}/rest/api/1.0/projects/${encodeURIComponent(proj)}/repos/${encodeURIComponent(repo)}/pull-requests?state=MERGED&order=NEWEST&limit=${PR_PER_REPO}`, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 10000 });
        if (prsR.status < 200 || prsR.status >= 300) return;
        const prs = JSON.parse(prsR.text || '{}').values || [];
        // Внутри репо — параллельный fetch /changes.
        await _jiraPLimit(4, prs.map(p => async () => {
          if (prSizes.length >= PR_SIZE_CAP) return;
          try {
            const chR = await govFwd({ targetUrl: `${base}/rest/api/1.0/projects/${encodeURIComponent(proj)}/repos/${encodeURIComponent(repo)}/pull-requests/${p.id}/changes?limit=300`, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 10000 });
            if (chR.status < 200 || chR.status >= 300) return;
            const changes = JSON.parse(chR.text || '{}').values || [];
            prSizes.push({
              repo: `${proj}/${repo}`,
              prId: p.id,
              title: (p.title || '').slice(0, 60),
              files: changes.length,
              additions: changes.reduce((s, c) => s + (Number(c.linesAdded) || 0), 0),
              deletions: changes.reduce((s, c) => s + (Number(c.linesRemoved) || 0), 0),
              mergedAt: _ppNormalizeBbTs(p.closedDate || p.updatedDate || 0),
              author:   p.author?.user?.displayName || '',
            });
          } catch (e) { /* skip individual */ }
        }));
      } catch (e) { tried.push({ type: 'pr-size', proj, repo, error: String(e?.message || e).slice(0, 100) }); }
    });
  }
  await _jiraPLimit(6, prSizeTasks);

  // V21 BD — Aggregate distribution + S/M/L/XL bucketing.
  // Buckets по строкам (additions+deletions): S<50, M=50-200, L=200-500, XL>500.
  const filesArr  = prSizes.map(p => p.files).filter(n => n > 0).sort((a, b) => a - b);
  const linesArr  = prSizes.map(p => p.additions + p.deletions).filter(n => n > 0).sort((a, b) => a - b);
  const _q = (arr, q) => arr.length ? arr[Math.floor(arr.length * q)] : 0;
  const buckets = { s: 0, m: 0, l: 0, xl: 0 };
  for (const p of prSizes) {
    const lines = p.additions + p.deletions;
    if (lines < 50)        buckets.s++;
    else if (lines < 200)  buckets.m++;
    else if (lines < 500)  buckets.l++;
    else                   buckets.xl++;
  }
  const distribution = {
    n: prSizes.length,
    files: { p50: _q(filesArr, 0.5), p90: _q(filesArr, 0.9), p99: _q(filesArr, 0.99) },
    lines: { p50: _q(linesArr, 0.5), p90: _q(linesArr, 0.9), p99: _q(linesArr, 0.99) },
    buckets,
    bucketsPct: prSizes.length ? {
      s:  +(buckets.s / prSizes.length * 100).toFixed(1),
      m:  +(buckets.m / prSizes.length * 100).toFixed(1),
      l:  +(buckets.l / prSizes.length * 100).toFixed(1),
      xl: +(buckets.xl / prSizes.length * 100).toFixed(1),
    } : null,
  };

  return { configured: true, perRepo, prSizes, distribution, tried };
}

/**
 * Factory — резолвит зависимости (jiraForward / _bbGate* / jiraPLimit /
 * pp-helpers) и возвращает связанные fetcher-ы. Caller получает уже
 * готовые async-функции с теми же сигнатурами, что были в server.js.
 */
function create(deps) {
  if (!deps || typeof deps !== 'object') {
    throw new Error('bitbucket.create({...}) requires deps object');
  }
  _jiraForward      = deps.jiraForward;
  _jiraSleep        = deps.jiraSleep      || ((ms) => new Promise(r => setTimeout(r, ms)));
  _bbGateWaitFn     = deps._bbGateWait    || (async () => {});
  _bbGateCloseFn    = deps._bbGateClose   || (() => {});
  _jiraPLimit       = deps.jiraPLimit;
  // pp-helpers
  _ppMakeAuthHeader    = deps._ppMakeAuthHeader;
  _ppKeyForAuthor      = deps._ppKeyForAuthor;
  _parseEmailName      = deps._parseEmailName;
  _parseEmailEmail     = deps._parseEmailEmail;
  _ppNormalizeBbTs     = deps._ppNormalizeBbTs;
  _ppBbAllowedProjects = deps._ppBbAllowedProjects;
  // Sanity-warn at boot если что-то критичное не передано (smoke-tests
  // с заглушками работают, prod должен пройти всё).
  if (typeof _jiraForward !== 'function') {
    try { logger.warn('[bitbucket] create({}) without jiraForward — fetchers will throw'); } catch (_) {}
  }
  return { ppFetchBitbucketActivity, ppFetchBitbucketGovernance, _bbFetchWithRetry };
}

module.exports = { create };
