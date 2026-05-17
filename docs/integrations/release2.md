# Release 2.0 sub-tab (V22+ Phase 5)

Подвкладка «Release 2.0» внутри «Интеграции». Тянет кастомный Jira issue-type
`Release 2.0` со всеми 56 custom-полями, показывает их в list-view с фильтрами,
группировкой, expand-panel'ями.

## Зачем

В Сбер-Jira процесс «выкатывания релиза» оформляется как Jira-issue с типом
«Release 2.0». 56 custom-fields покрывают весь lifecycle: фиксация → ИФТ → НТ
→ ПСИ → ППСИ → ПРОМ. У PM/тимлида нет одной точки чтобы видеть состояние ВСЕХ
релизов; они скакают между Jira-фильтрами / Confluence / Excel.

Эта подвкладка — этот единый список.

## Файлы

```
integrations/release2/
├── release2Fields.js      ← 56 fields taxonomy (id ↔ key ↔ label ↔ kind), STATUS_PHASES, RISK_RANK
├── release2Model.js       ← analyseRelease2List + diffRelease2Lists + _computeStats
├── release2Api.js         ← fetchRelease2List / fetchRelease2Related с AbortSignal
├── release2State.js       ← localStorage 'r2_state_v1' (groupBy, filters, expandedKeys, diffHistory)
├── release2Renderer.js    ← pure HTML string builder (toolbar / phase-bar / hero / filters / list / expand)
└── release2.js            ← orchestrator: render + refresh + click delegation + Multiselect mount
```

Server endpoints в [`server/integrations-api.js`](../../../server/integrations-api.js):
- `POST /api/integrations/release2-fetch` — bulk Jira-search по `issuetype = "Release 2.0"`
- `POST /api/integrations/release2-related` — lazy-fetch связанных Stories/Bugs

## Контракты

### 1. Server source-of-truth для config

Frontend НЕ читает `state.integrations.jira` — этого поля нет в state.js. Чтобы
проверить настроена ли Jira, либо:

1. Дёрнуть `/api/integrations/release2-fetch` — сервер вернёт 400 «Jira не настроена»
2. Использовать `integrations/integrationsStore.js` → `loadSettings()` (см. fix `9972a20`)

### 2. Project keys — dual-format

Server endpoint читает project keys из 3 источников:
1. `body.projectKeys[]` (override от клиента)
2. `cfg.jiraProjectKeys` (comma-separated string)
3. `cfg.areas[].projectKey` (legacy format)

См. `server/integrations-api.js:387-400`.

### 3. JQL — никаких хардкоженных дефолтов

JQL строится из явных параметров:
```
issuetype = "Release 2.0" AND project in (...) [AND status != ...] [AND created > ...] ORDER BY priority DESC
```

`AND status != ...` добавляется ТОЛЬКО если `body.statuses[]` непуст.
`AND created > X` — только если `body.sinceDate` ИЛИ `cfg.sinceDate` задан.

См. commit `4946166` — это explicit fix предыдущего хардкода.

### 4. Identity-aware blocked users (V22+ Phase 5.2)

`release2Model.js:_normUser` детектит суффиксы `[В]/[B]/[Х]/[X]` (уволенные —
см. `~/.claude/.../memory/feedback_blocked_users.md`). Возвращает
`{isBlocked: true, displayName: <cleaned>}`.

В UI:
- В individual-полях (Организатор ПСИ / Утверждающий / Assignee) — muted-render
  через `.r2-user-blocked` (opacity .55, line-through dotted, italic, tooltip)
- В owners-card aggregation — **silent-filter** (заблокированные исключаются
  из top-N перед aggregation)

## UI компоненты

### Hero block (`r2-hero`)

Объединяет phase-bar и owners-card в один horizontal card:

- **Phase-bar** (segmented) — 6 фаз (creation/stabilize/uat/approve/deploy/cancel)
  с пропорциональными сегментами. При dominant >50% — выводится в hero-tile слева.
  Click = toggle `filters.phase`.
- **Owners stat-card** — top-6 owners по count + micro-phasebar 4px (V22+ Sprint C).
  `<details open={groupBy==='owner'}>`.

### Diff-banner (`r2-diff-banner`)

`<details>` (closed по умолчанию). Summary показывает «За последний refresh:
+3 новых · ~2 изменено · −1 удалено» + 7-day sparkline (если history ≥3 точек).
Body — detail-blocks: список added, changed (по полям: status / priority /
riskAuto / planProdEnd / partOfCount), removed.

History хранится в `release2State.diffHistory[]` (ring buffer 7 точек).

### Row + expand panel

- **Row-head** — 8 columns: risk-dot / key / summary / status-pill / KE-chip /
  date(with eyebrow) / plan-vs-fact sparkline / flags / chevron
- **Status-spine** — 6-stage lifecycle bar 36px на вершине expand'а
- **4 tabs**: «Что внутри» (Compose + ППСИ + collapsed Attrs) / «Сроки» (mini-Gantt
  + 5 lifecycle blocks) / «Связи» (РоВ + Attachments) / «Здоровье» (auto-checklist)

### Filters

V21 `Multiselect.create()` mount в placeholder'ы. 4 фильтра: проекты / статусы /
типы релиза / риски. Plus search-input + sticky-strip + breadcrumb chips активных.

## Тесты

```bash
node --test tests/unit/release2Model.test.js          # analyseRelease2 + diff
node --test tests/unit/release2Api.test.js            # fetch с mockFetch
node --test tests/unit/release2DiffOwners.test.js     # diff-banner + owners-card
npm run test:visual -- --grep "Release 2.0"           # Playwright
```

## Известные баги (см. Playwright full-audit)

| # | Что | Где |
|---|---|---|
| 1 | В тестах fake-Jira на 127.0.0.1 блокируется SSRF-guard'ом сервера: `Blocked outbound to 127.0.0.1 (SSRF guard: IPv4 loopback)` | `integrations-release2.png` |

## Связанные документы

- [3 контракта state](../state-contracts.md) — identity-deterministic attribution
- [Spine-pill](../spine-pill.md) — design rules (stripe-left, mono-tabular, CAPS)
- [Auth and secrets](./auth-and-secrets.md) — token scrub policy
- `git log --grep="V22+ Phase 5"` — full history итерации
