# Audit 09 — Integrations Deep Dive (Jira / BB / CF / Zephyr + новые метрики)

**Авторы:** 4 эксперта — Atlassian Expert (Jira/BB/CF), QA/Test Management Specialist (Zephyr), Senior Data Analyst (метрики/aggregates), API Performance Specialist (optimization).

---

## TL;DR

**4 главных вывода:**
1. **«Sleeping data» гигантское** — много полей собираются но не используются (`subtasks[]`, `resolution`, full `changelog.histories[]`, `worklog.worklogs[].author`, BB activities raw timestamps, CF audit-log per-page)
2. **`HTTP keep-alive` отсутствует** — каждый fetch = новый TCP+TLS handshake (~150-300ms на corp-proxy). +40-50% latency без новых endpoints
3. **Zephyr — silent truncation на 200 cap** + userKey mismatch (30-50% потерянных авторов)
4. **Главный gap по value:** `/rest/agile/1.0/sprint/{id}/issue` (sprint commitment vs delivery) — НЕ собираем вообще

**Top-5 quick wins (1 PR, ~150 LOC, ≤2д):**
1. `keepAlive` agent + gzip
2. LRU httpCache 5min для GET search
3. Parallel pagination внутри PK
4. Differential JQL `updated > last`
5. Resolution-split + reopen-rate (одна JQL, одна tile)

---

## A. Jira — что собираем сейчас

`server.js:691` `JIRA_FIELDS`:
- `summary, description, status, assignee, reporter, updated, created, priority, issuetype, labels, duedate`
- `timetracking, timeoriginalestimate, aggregatetimespent, worklog, comment, parent, subtasks, resolution, resolutiondate`
- `customfield_*` (sprint via `_jiraSprintFieldId`, zephyr)

4 query-bucket в `ppFetchPulseData`:
- `sprint` (openSprints, без changelog) — 500 issues
- `recent` (-3d, **с** changelog) — 400
- `inProgress` — 500
- `backlog` — 200

Используется: dwellHours, transitions, worklog sums, sprint membership.

---

## B. Jira — что **ещё** можно собрать (ranked by value)

| # | Endpoint / Field | Что даёт | Effort |
|---|---|---|---|
| 1 | `GET /rest/agile/1.0/board/{id}/sprint?state=closed` | **Sprint velocity history (last 6 sprints)** — план vs факт story points | M |
| 2 | `GET /rest/agile/1.0/sprint/{sid}/issue` | Issues at sprint **end-state** (commitment vs delivery) | M |
| 3 | `expand=changelog` на ВСЕХ buckets | reopen-rate, blocked-time, time-in-status full history | +50-80% latency |
| 4 | `customfield_10004 (Story Points), 10100 (Business Value), 10200 (Epic Link), 10202 (Sprint)` | оценки vs факт, scope-creep | XS |
| 5 | `fields=issuelinks` | depend-on / blocks / clones / "is blocked by" → **граф зависимостей** | XS |
| 6 | `fields=attachment` | N attached, sizes, mime — proxy для DoR-completeness | XS |
| 7 | `GET /rest/api/2/issue/{key}/watchers` | watcher-count → engagement | per-issue req — дорого |
| 8 | `fields=fixVersions, versions, components` | release-tracking, component-ownership | XS |
| 9 | `GET /rest/api/2/project/{pk}/components` | component lead → автоматическая ответственность | S |
| 10 | `GET /rest/api/2/project/{pk}/versions` | release schedule, released-at | S |
| 11 | `worklog.worklogs[].author + timeSpent` | **Per-author timeSpent breakdown** — реальная утилизация (а не assignee-stub). Данные уже едут! | S |
| 12 | Resolution-split (Done / Won't Do / Duplicate / CR) | quality-of-grooming. Поле уже есть! | XS |
| 13 | JQL `status changed FROM "In Progress" TO "Reopened"` | **reopen rate** | S |
| 14 | `GET /rest/api/2/user/assignable/search?project={pk}` | who-can-be-assigned → team boundary | S |
| 15 | `subtasks[]` (поле уже в ALL_FIELDS) | completion-ratio per parent. Данные есть, **не используется в UI** | S |

---

## C. Bitbucket — что собираем + что ещё

**Сейчас** (`server.js:924-1145`): PRs (state=ALL, last 50, 48h-window), Commits (last 100, authorTimestamp filter), PR activities → reviews/approves/needsWork/declined/prComments (cap=30 PRs/PK).

| # | Endpoint | Метрика | Effort |
|---|---|---|---|
| 1 | PR `createdDate, updatedDate, mergedDate` + activities `OPENED→APPROVED→MERGED` | **PR cycle-time** + first-review-latency. Данные есть, нужен агрегатор | S |
| 2 | `GET .../pull-requests/{id}/diff?contextLines=0` | **lines added/removed per PR**, hot-files | M |
| 3 | `GET .../pull-requests/{id}/changes` | **N files changed** (PR-size complexity) | S |
| 4 | `GET .../commits/{sha}/changes` или `…/diff` | per-commit churn | M |
| 5 | `GET .../branches?details=true&orderBy=MODIFICATION` | **stale branches** (>30d) | S |
| 6 | `GET .../commits?merges=exclude&since=&until=` | cherry-pick chains | M |
| 7 | `GET .../pull-requests/{id}/commits` | force-push detection | M |
| 8 | Aggregated по 30d: top-50 файлов с max changes | **hot-files** + bus-factor (если 1 author > 80% commits) | M |
| 9 | `GET .../repos/{repo}/permissions/users` + `/groups` | repository ACL audit | S |
| 10 | `GET .../build-status/1.0/commits/{sha}` | CI build status — green-rate | M |
| 11 | Reviewer assignment: PR `reviewers[]` + activities | overloaded reviewers, idle reviewers | S |
| 12 | First-time contributor: commit author не появлялся > 90d | онбординг-сигнал | M |
| 13 | `GET .../tags?orderBy=MODIFICATION` | release-tagging cadence | S |
| 14 | `GET .../repos/{repo}/settings/hooks` | governance — какие хуки включены | S |

---

## D. Confluence — что собираем + что ещё

**Сейчас:** CQL `lastmodified > X` per author, audit-log `/rest/api/audit?startDate=&endDate=` для viewers.

| # | Endpoint | Метрика | Effort |
|---|---|---|---|
| 1 | `cql=creator="X" AND type=page` | **pages owned by author**, age-distribution | S |
| 2 | `GET /rest/api/content/{id}/child/comment?expand=history` | comments per page → engagement | S |
| 3 | `GET /rest/api/content/{id}/notification/child-created` | watchers, restrictions | S |
| 4 | `cql=lastmodified < "now-365d" AND type=page` | **stale knowledge** (>1 year) | XS |
| 5 | `cql=ancestor!=* AND type=page AND space=X` | orphaned pages | S |
| 6 | `GET /rest/api/content/{id}/child/attachment` | attachment artifacts | S |
| 7 | `cql=text~"DoD" OR text~"Definition of Done"` | DoD/DoR template compliance | S |
| 8 | `GET /rest/api/space/{key}/permission` | space-level ACL audit | S |
| 9 | `GET /rest/api/content/{id}/restriction/byOperation` | restricted pages = knowledge silos | S |
| 10 | Page views aggregated по page | popular vs dead pages | M |
| 11 | `cql=type=page AND created > now-30d` | page-creation cadence per team | XS |
| 12 | `GET /rest/api/content/{id}?expand=body.storage` + scan `<a href>` | cross-space link graph | M |
| 13 | `cql=label="post-mortem"` | post-mortem coverage | XS |

---

## E. Zephyr — что чинить + что ещё

**Текущая реализация** (`server.js:2012` `ppFetchZephyrActivity`): Zephyr **Squad** (legacy), endpoints `/rest/tests/1.0/testcase/search` + `/testrun/search`.

**Critical issues:**
1. **`maxResults=200` без paginate** (line 2049, 2087) — silent truncation. Регресс-цикл = тысячи runs/quarter
2. **Нет 429/5xx retry** — `tried.push({status:429})` и тишина
3. **userKey mismatch** — Sber DC формат `JIRAUSER1697487`, но Zephyr иногда возвращает голый `1697487` или username `i.ivanov` → 30-50% потерянных авторов
4. **`testCase.updatedOn >= "..."` ZQL** — синтаксис нестабилен в старых версиях; нужен probe
5. **Нет concurrency limit per-pk** — на 20 проектах = 20 параллельных запросов → 429
6. **`status.id === 4956` magic number** (line 2101) — id «Done» меняется per-instance

**Что ещё можно собрать с Zephyr:**

| # | Метрика | Endpoint |
|---|---|---|
| 1 | **Test execution cycles** (sprint pass-rate) | `/testrun/search?query=cycleId IN(...)` |
| 2 | **Pass rate per author** | агрегация `tr.status × tr.executionTime` |
| 3 | **Flaky tests** (P→F→P в окне) | `/testresult/search?query=testCase=...` history |
| 4 | **Coverage map** Jira-issue ↔ test | `/testcase/{key}/traceability` |
| 5 | **Untested closed issues** | JQL `status=Done` MINUS Zephyr-traced |
| 6 | **Test debt** — TC без runs >90d | `lastTestResultDate` filter |
| 7 | **Step-level fails** | `/testresult/{id}/step` |
| 8 | **Defects from failed runs** | `tr.defects[]` field |
| 9 | **Historical pass-rate trend** | week-over-week aggregation |
| 10 | **Slow tests** (top-20 by `executionTime`) | sort |
| 11 | **Re-run count** per TC | count of `RETEST` status |
| 12 | **Coverage by component** | `tc.components[]` × Jira components |
| 13 | **Manual vs auto split** | `tc.labels` или customField |
| 14 | **Cycle completion %** | `cycle.executedCount/totalCount` |

**Альтернативы Zephyr:**
- **Xray** — лицензия дорогая, обычно нет в Сбере
- **TestRail** — фрагментарно у некоторых команд (DevOps, NLP)
- **Jira labels-based** (`tested`/`needs-test`) — fallback за 2 часа, recommend как safety-net
- **Allure/CI-driven** — для auto-tests; не покрывает manual QA

---

## F. Sleeping data (собираем, не используем в UI)

| Поле/данные | Где собирается | Где НЕ показывается |
|---|---|---|
| `subtasks[]` (в ALL_FIELDS) | recent/inProgress/backlog | UI не показывает sub-task completion ratio per parent epic |
| `resolution + resolutiondate` | все buckets | разбивка `Won't Do / Duplicate / Done` отсутствует |
| `worklog.worklogs[].author + timeSpent` | `worklog` field | aggregation только sum — per-author breakdown теряется |
| `comment.comments[]` | `comment` field | FRT не считается, sentiment/keyword отсутствует |
| Full `changelog.histories[]` (recent bucket) | expand=changelog | используется только last-transition + dwell, time-in-each-status не вычисляется |
| BB PR `activities` (OPENED, RESCOPED, COMMENTED) | activity stream | используется только counter, raw timestamps для FRT теряются |
| BB commit message body | `c.message` | только первая строка → revert/cherry-pick detection теряется |
| Confluence `version.number` | search expand=version | edit-frequency per page не агрегируется |
| Audit-log `Viewed page` events | viewer-resolve | aggregated по user, **не по page** |
| `priority`, `labels`, `duedate` | все buckets | SLA-by-priority bucketing нет |

---

## G. Top-30 новых метрик

| # | Метрика | Источник | Effort | Value |
|---|---|---|---|---|
| 1 | Sprint commitment vs delivery (за 6 sprints) | `/rest/agile/1.0/sprint/{id}` end-state | M | XL |
| 2 | Velocity trend per team | derived from #1 | S | XL |
| 3 | Reopen rate per assignee | JQL `status changed FROM Done TO X` | S | L |
| 4 | Bug-aging distribution (P1/P2/P3) | `priority + created` | S | L |
| 5 | Time-in-each-status per issue | full changelog | M | L |
| 6 | Per-author worklog breakdown | `worklog.worklogs[]` | S | L |
| 7 | First-response-time (FRT) on bugs | `comment.comments[]` first-non-reporter | M | L |
| 8 | Issue-link graph (blocks / depends-on) | `fields=issuelinks` | S | L |
| 9 | Epic-completion ratio | `subtasks[]` aggregated to parent | S | L |
| 10 | Resolution-quality split | `resolution` | XS | M |
| 11 | Component owner load | `/project/{pk}/components` | S | M |
| 12 | Release readiness (fixVersion-coverage) | `fields=fixVersions` | S | L |
| 13 | Story-point estimation accuracy | `customfield_SP + worklog/timetracking` | M | L |
| 14 | Backlog hygiene (no SP/estimate/priority) | bulk JQL | XS | M |
| 15 | Stale issues (no update >30d in active sprint) | bulk JQL | XS | M |
| 16 | PR cycle-time p50/p90 | BB activities (есть) | S | XL |
| 17 | First-review-latency p50/p90 | BB activities (есть) | S | XL |
| 18 | Review-depth (comments per PR) | BB activities (есть) | XS | L |
| 19 | PR-size distribution (lines + files) | BB diff/changes | M | L |
| 20 | Hot-files top-20 (max touches /30d) | BB commits/changes per repo | M | L |
| 21 | Bus-factor per file | derived from #20 | S | XL |
| 22 | Stale branches (>30d no commits) | BB `/branches` | S | M |
| 23 | Reviewer overload (top-5 by assignment) | BB PR `reviewers[]` | S | M |
| 24 | Idle reviewer (assigned, 0 actions) | BB activities | S | M |
| 25 | First-time contributor onboarding | BB commits author seen<90d | M | M |
| 26 | CI green-rate per repo | `/build-status/1.0/commits/{sha}` | M | L |
| 27 | Stale Confluence pages (>1y) | CQL `lastmodified < -365d` | XS | M |
| 28 | Orphan pages per space | CQL `ancestor!=*` | S | M |
| 29 | Page-engagement (views + comments + watchers) | audit + content/{id}/child/comment | M | L |
| 30 | Knowledge-silo (restricted pages cnt) | `/restriction/byOperation` | S | M |

---

## H. Aggregate metrics по уровням

### Person-level (12)
1. Code-review depth score
2. Review reciprocity ratio
3. Knowledge breadth (# уникальных компонентов)
4. Specialist Gini
5. Mentorship signal
6. Bug-induce rate
7. Rework ratio
8. Context-switch index
9. CF authorship velocity
10. Test ownership (Zephyr)
11. PR cycle time personal
12. After-hours ratio

### Sprint-level (12)
1. Scope churn
2. Spillover rate
3. Carry-over age
4. Lead time / Cycle time
5. Estimation accuracy
6. Bug-to-story ratio
7. Review WIP
8. Test pass-rate trend
9. Flaky test count
10. Blocked time aggregate
11. Code churn
12. Doc coverage

### Team-level (12)
1. **DORA**: deployment freq, lead time, MTTR, change failure rate
2. WIP limit compliance
3. Throughput
4. Predictability score (std velocity / mean)
5. Hot-file concentration
6. Bus-factor / truck-factor
7. Onboarding ramp time
8. Backlog health
9. Stale issues
10. Component coverage
11. Cross-team PR ratio
12. Retro action-item closure rate

### Cross-team (6)
1. Dependency graph density
2. Blocked-by-other-team time
3. Shared component conflict
4. Review SLA cross-team
5. Knowledge import/export
6. API contract breakage rate

### Org-level (6)
1. Org throughput per FTE
2. Quality north-star (escaped defects)
3. Innovation ratio (feature/maintenance/tech-debt)
4. Engineering attrition correlation с burnout
5. Knowledge centralization (Herfindahl по CF)
6. Time-to-value (idea → prod)

---

## I. New views (10 идей)

1. **Component health card** — per-component dashboard
2. **Bus-factor map** — visual, по orgу
3. **Dependency Sankey** — cross-team flow
4. **Burnout watchtower** — manager-only
5. **Onboarding tracker** — новые члены, ramp progress
6. **Doc-debt console** — CF pages outdated, owner
7. **Flaky-tests leaderboard** — Zephyr
8. **Release train cockpit** — multi-release timeline
9. **Estimation calibration** — личный estimate vs actual
10. **Knowledge flow graph** — кто читает/пишет/правит чужие CF страницы (mentorship signal)

---

## J. API performance — Top-20 quick wins

| # | Win | Где | Эффект |
|---|---|---|---|
| 1 | **`keepAlive`-agent + gzip** | `jiraForward` line 520 | −150ms/req, −60% bytes |
| 2 | **LRU httpCache 5min для GET search** | wrap `jiraRequest` | −90% repeated pulse-retries |
| 3 | **Parallel pagination внутри PK** (PLimit 3) | `jiraSearchAll` line 654 | ×2.5 throughput |
| 4 | **Differential JQL `updated > last`** | `jiraBuildAreaReport` line 806 | ×10 на тёплых PK |
| 5 | **Zephyr pagination + cap=1000** | line 2049/2087 | устранить silent loss |
| 6 | **Zephyr concurrency limit 4** | line 2045 | нет 429 |
| 7 | BB `/repos?limit=1000` | line 974 | +крупные projects |
| 8 | BB `since=<sha>` incremental commits | line 1071 | −95% per-repo |
| 9 | Drop `description`/`worklog` из JIRA_FIELDS если не нужно | line 691 | −40% payload |
| 10 | **SSE для pulse `/status`** | line 2378 | −70% poll cost |
| 11 | gzip `/result` | pulse handlers | −80% body |
| 12 | ETag passthrough в `jiraForward` | line 520 | 304 для `/field`, `/project` |
| 13 | Persist BB `appType` TTL 1h | line 1256 | −1 probe call/pulse |
| 14 | Persist CF preferred path TTL 1h | line 1659 | −1 probe call/CQL |
| 15 | Bulk `key in (…)` вместо N×issue/{key} | line 2238 | N→1 call |
| 16 | Per-integration `maxSockets` agent | new | изоляция bursts |
| 17 | CF `cql space in (…)` single-call | line 1888 | N→1 |
| 18 | Stale-while-revalidate в httpCache | new | UI без блока |
| 19 | Negative cache 5min для 404/403 | `jiraRequest` | стоп-флапы |
| 20 | Streaming JSON parse (`stream-json`) для search | line 535 | −50% RAM на 2k issues |

**Самое жирное:** #1 + #2 + #4 + #11 покрывают ~70% всей пользы. Можно внедрить за один PR (≈150 LOC), без breaking changes.

---

## K. Quick-wins (≤2д каждая)

1. **HTTP keep-alive** для всех 4 fetch-функций
2. **Resolution-split + reopen-rate** — JQL уже едет, разбить
3. **Sub-task completion ratio per epic** — `subtasks[]` уже в payload
4. **Per-author worklog breakdown** — `worklog.worklogs[]` уже едет
5. **Issue-link graph (blocked-by)** — добавить `issuelinks` в `JIRA_FIELDS`. `dependencyEngine.js` готов
6. **PR cycle-time p50/p90** — данные уже в `_prsForActivity`
7. **First-review-latency** — те же activities (4h)
8. **Stale Confluence (>1y)** — одна CQL, одна tile (4h)
9. **Hot-files top-20 (30d)** — `commits + /changes`. Cache в SQLite-WASM 24h
10. **Stale branches** — `/branches?orderBy=MODIFICATION` (4h)
11. **BB retry on 5xx** — обёртка вокруг `jiraForward` (2h)
12. **Component lead audit** — `/project/{pk}/components` (8h)
13. **Backlog hygiene tile** — JQL для no-SP / no-priority (4h)
14. **Idle reviewer detection** — PR `reviewers[]` vs activities (8h)
15. **Zephyr quick-fix:** paginate + userKey normalize + concurrency limit + permissions probe (1д)

---

## L. Главный gap по value

1. **Sprint-velocity history** через `/rest/agile/1.0` — её мы вообще не собираем. XL value
2. **PR cycle-time** — данные уже есть, агрегатор отсутствует. XL value
3. **Issue-links** — одно поле в `JIRA_FIELDS` открывает граф зависимостей. L value, XS effort
4. **Per-author worklog** — данные есть, не разворачиваются. L value, S effort

**По эффективности:** keep-alive + parallel-buckets срежут latency на 40-50% без новых endpoints.

**Pilot 109/5PK позволяет** добавить 3-4 новых req/PK без проблем — Server лимиты мягкие, узкое место не он, а sequential pagination.

---

**Файлы high-priority:**
- `server.js:520` `jiraForward` (keepAlive, gzip, ETag)
- `server.js:654` `jiraSearchAll` (parallel pagination)
- `server.js:691` `JIRA_FIELDS` (drop unused, add issuelinks)
- `server.js:806` `jiraBuildAreaReport` (differential JQL)
- `server.js:920` `_ppFetchBitbucketRepoWalk` (cycle-time aggregator)
- `server.js:1620` `_ppFetchConfluence` (CQL bulk, persist preferred path)
- `server.js:2012` `ppFetchZephyrActivity` (paginate, concurrency, userKey normalize)
- `integrations/portfolioPulseModel.js` `analysePulse` (sub-task completion, resolution-split, per-author worklog)
- `integrations/teamScanner2Insights.js` (новые person/sprint/team metrics)
