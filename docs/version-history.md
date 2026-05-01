# Version History (V11 → V17.2)

Карта эпох проекта. Если в коде встречаешь ярлык типа `V14 (B2)` или `V17.2 I1c` — здесь расшифровка.

## Зачем эта карта

Audit-папки (`audit-2026-*/`) играют роль ADR — детали в них. Эта таблица — индекс «что в каком V-релизе появилось/умерло».

## V-эпохи

| Эпоха | Дата | Audit-папка | Главное |
|---|---|---|---|
| **V11** | до 2026-04 | (вне репо или старее) | SQLite-WASM as opt-in storage, cross-tab `storage` event listener |
| **V12** | 2026-04-29 | `audit-2026-04-29` | Black Dashboard, Tech Info modal, dev-status BB Phase 1, Confluence cascade Phase 2, Zephyr field auto-discovery, security headers (CSP/X-Frame), bundle-CSV import allowlist |
| **V13** | (отменена) | `audit-2026-04-29-v13` | План был, но не вмержен — папка содержит исследование которое легло в V14 |
| **V14** | 2026-04-30 | `audit-2026-04-30` | Plan-lock + edit-mode (B3+B4+B5), GanttV2 retired (B2), employees inline employees-as-JSON (A3), card-view (A1), gantt2* settings retired |
| **V15** | 2026-04-30 | `design-audit/` | **Spine-pill design language**: flat surfaces, 3px stripe-left, mono-tabular numerals, no emoji в production UI, no gradients |
| **V16** | (на стыке V15-V17) | `design-audit/` сектор macro-improvements | 5 макро-улучшений ганта (team-rail, sparkline, today-pill, flow-badges, jump palette) |
| **V17** | 2026-04-30 → 2026-05-01 | `audit-2026-05-V17` | overnight roadmap (12 пунктов): технический аудит, chat redesign, Performance tab, Portfolio Pulse + Black Dashboard refactor, аудит 6 dashboard-вкладок / Реестр / Шапка / Фильтры / Тур |
| **V17.1** | 2026-05-01 | `audit-2026-05-V17/MASTER_PLAN.md § V17.1` | Patch pack: 12 групп правок (chat A1-A5, registry stretch, gantt 12 fixes, html-export, employees, settings, etc) |
| **V17.2** | 2026-05-01 | `audit-2026-05-V17/13-integrations-audit.md` | **Identity-deterministic integrations** (I1+I2+I3+I4+I5) + **Confluence I2c** (space-scope, per-employee CQL, comments+mentions, audit log) |
| **V18** (Block A+B) | 2026-05-01 ✅ | `audit-2026-05-V18/MASTER_PLAN.md` | **Process foundation + integration consistency** — 8/15 пунктов: P1 git init, P2 contract-tests migration to node:test, P3 CONTRIBUTING.md, P4 CI gate (GitHub + GitLab), P5 _cfPathCascade helper, P6 token-handling consolidation, P7 Pulse async-job pattern, P8 BB bucket separation |
| **V18.1** (Block C-E) | TBD | (TODO `audit-2026-05-V18/`) | **Decomposition + Testing + Operations** — 7 отложенных пунктов: P9 app.js → app/*, P10 server.js → server/*, P11 gantt.js разбивка, P12 testRunner retire, P13 coverage expansion, P14 structured logging, P15 styles.css cleanup |

## Что появилось в каждой версии

### V11 (foundation)

- localStorage-based persistence
- Reactive proxy в state.js
- HistoryManager (Undo/Redo)
- HistoryLog (action audit log)
- SQLite-WASM как opt-in
- Vendored xlsx + sql-wasm libs

### V12 (audit-2026-04-29)

- 8 documented bugs закрыты (`docs/FOUND_BUGS.md`)
- Black Dashboard добавлен (Sigma goal-coverage)
- Tech Info modal (versions/fields/projects discovery)
- Phase 1 — Bitbucket via Jira dev-status panel
- Phase 2 — Confluence path-cascade (3 paths × 3 CQL)
- Phase 3 — Zephyr customfield auto-discovery + per-day buckets
- `safeUrl` / `jiraIssueUrl` extracted to `utils.js`
- Security headers (CSP, X-Frame-Options) на static
- Retry on 502/503/504 в jiraForward
- `fs.realpath` path-traversal closure
- Cross-tab `storage` event listener
- Allowlist на bundle-CSV import

### V13 (отменена)

Папка `audit-2026-04-29-v13` содержит **отвергнутые идеи** + **раннее исследование** что легло в V14. Не путай V13-метки с актуальным кодом — их в коде НЕТ. Если видишь `V13 ...` в комментарии — это исторический артефакт.

### V14 (audit-2026-04-30)

- B2: **GanttV2 retired** — старый «Гант со стрелками» удалён, остался один режим `detailedTasks`. Следы (constants) живут.
- B3: **Plan-lock** (`state.planLocked`)
- B4: **Edit-mode** (`state.ganttEditMode`) — bypass комментариев в plan-locked
- B5: **Comment-on-move** — обязательный комментарий при переносе pill в plan-locked
- A1: Employees card-view + view-toggle
- A3: Employees inline JSON в CSV bundle (`__Q2EMPLOYEES__` marker)
- gantt2* settings keys retired (B2 cleanup)
- Decomposition: `Onboarding`, `BulkEditPanel`, `ActionLayer`, `LLMAssistant` extracted в `app/`
- Audit `H7` checkpoint для «убрать след переноса» (reversibility)

### V15 (design-audit)

- **Spine-pill design language**: 3px stripe-left на active/selected, mono-tabular numerals везде, no-emoji в production, no gradients, neutral surfaces
- Editorial Bold редизайн **отвергнут** пользователем
- Pill anatomy: name + state-glyph + comment-marker (row 1) + ФИО + период (row 2) — без emoji-prefix
- Cmt-square маркеры (transfer/add) вместо текстовых badges

### V16 (на стыке V15-V17)

5 макро-улучшений ганта (gantt-roadmap):
- #1: Team-rail (3px hash-hue rail на team-header)
- #2: Capacity sparkline (5 vertical bars per team-header)
- #3: Unified Date-Rail (today-pill, flow-badges +N/-N в header'ах колодцев)
- #4: Cmd+K команд / эпиков palette
- #5: Density toggle (Regular vs Compact)

Plus roadmap-2 (Tier S/A/B/C improvements). См. `design-audit/`.

### V17 (audit-2026-05-V17)

12-пунктовый «overnight roadmap»:

| # | Что |
|---|---|
| P1 | Технический аудит (full-stack + QA + system-analyst + gantt) |
| P2 | Применить fixes + добавить тесты |
| P3 | Chat-ассистент redesign (12 fixes) |
| P4 | Новая вкладка «Производительность сотрудников» в Integrations |
| P5 | Portfolio Pulse refactor (timeouts × 2-3) |
| P6 | Чёрный дашборд refactor (multi-project loading) |
| P7 | Прогон тестов |
| P8 | Аудит 6 dashboard-вкладок (Дашборд / Метрики / Сводная / Инсайты / AI CEO / AI Анализ) |
| P9 | Аудит «Реестр» (12 fixes; CSV formula injection guard, flushPendingEdits, bulk-on-filtered) |
| P10 | Аудит «Шапка» (11 fixes; Cmd+S, files-dropdown a11y, sim-banner overlap) |
| P11 | Аудит «Фильтры» (9 fixes; FilterEngine.invalidate, search race, applyPreset clean-state, multiselect a11y) |
| P12 | Аудит «Тур / обучение / демо» (7 fixes; confirm-overwrite, welcome Esc, demo dynamic dates) |

Тесты: 478 → 516 (+38 regression).

### V17.1 (patch pack)

12 групп правок по запросу пользователя:

| Группа | Что |
|---|---|
| **A** Chat-bot | FAB → bottom-left, sparkles SVG, +30% width, click-outside-closes, RU translations |
| **B** Registry | Растянуть таблицу до низа экрана |
| **C** Gantt | 12 правок (no «Бэклог» text, 1fr distribution, no colored line, long RU dates, ctx-menu unassign, header tips/history buttons, 2-row max, plural pl(), add-epic modal) |
| **D** HTML export | Collapsible hints, current-release toggle |
| **E** Employees | Dark theme filters, OT input on top, separate workload summary |
| **F** Settings | LLM/integrations roundtrip via JSON, modal wider+taller |
| **G** Сводная | Removed «Совсем красиво» mode |
| **H** Инсайты | Actions overflow fix |
| **I** Action layer | Removed duplicate journal |
| **J** AI Анализ | HIGH overflow + RU |
| **K** AI CEO | RU + dark theme fix on `.ceo-sev-*` |
| **L** Tests | 4 tests updated, 516 → 516/11/0 |

### V17.2 (integrations + Confluence rebuild)

Триггер: жалоба пользователя «Bitbucket-данные привязываются к чужим сотрудникам, Confluence не тянутся».

| Группа | Что |
|---|---|
| **I1a** | `EmployeeFactory` extended: `email`, `jiraAccountId`, `bitbucketLogin`, `confluenceAccountId` |
| **I1b** | UI «Идентификация для интеграций» в карточке сотрудника |
| **I1c** | `analysePulse` rewrite: deterministic identity-first lookup. Fuzzy `_ppFindByPartial` retired в production |
| **I1d** | dev-status walker filter (entries без email/login отбрасываются) |
| **I2a** | `confluence-search`: path-cascade, CQL вместо exact title, `Accept: application/json`, trim `/wiki` |
| **I2b** | `verify-confluence`: 4-URL cascade |
| **I2c-G1** | `confluenceSpaceKeys` + `activityWindowHours` поля (default 72h) |
| **I2c-G2** | Space-scope в `ppFetchConfluenceActivity` + `confluence-search` + `verify-confluence` |
| **I2c-G3** | Per-employee `contributor in (...)`, pagination start/limit cap=1000 |
| **I2c-G4** | Comments + Mentions добавлены (3 раздельных CQL passes) |
| **I2c-G5** | `/api/integrations/confluence-resolve-user` + auto-trigger при сохранении email |
| **I2c-G7** | `/api/integrations/confluence-audit-logins` (audit log: логины/выходы) |
| **I3** | Settings save guards: empty-URL guard, await + ok-check, request-id race guard |
| **I4** | Token redact, listener leak fix, `proxyPost` timeout 15с → 90с |
| **I5** | Auto-fill `email + jiraAccountId` после Pulse (manual wins, ambiguous skip) |

Тесты: 516 → 534 (+18: 2 identity-match + 8 autofill + 8 store).

## Что retired

| Когда | Что | Где остались следы |
|---|---|---|
| V14 (B2) | `GanttV2` mode | `constants.js` GANTT_TIMELINE_*, types.js |
| V14 (B2) | gantt2* settings | dataStore migration |
| V15 | Editorial Bold редизайн | (отвергнут до коммита) |
| V17 P9 | filled-pill chips в Реестре | (заменены на 3px stripe + neutral) |
| V17.2 I1c | `_ppFindByPartial` fuzzy match | `portfolioPulseModel.js` — alive за флагом `allowFuzzyAuthorMatch` |
| V17.2 I1d | dev-status authors без email/login | (фильтруется в server.js) |

→ См. [`dont-touch.md`](./dont-touch.md) для «осознанной кривизны»

## Карта audit-папок

```
audit-2026-04-29/                    ← V12
  ├── 01-fullstack-dev.md
  ├── 02-qa-tester.md
  ├── 03-system-analyst.md
  └── ...

audit-2026-04-29-v13/                ← V13 (cancelled, исследование)
  └── ...

audit-2026-04-30/                    ← V14
  ├── 01-fullstack-fixes.md
  ├── 02-qa-followup.md
  ├── 03-system-analyst-h.md
  └── 04-architecture-decomposition.md   ← важно для app/ structure

design-audit/                        ← V15 + V16 design work
  ├── 01-art-director.md
  ├── 02-designer.md
  └── ...

audit-2026-05-V17/                   ← V17 + V17.1 + V17.2
  ├── MASTER_PLAN.md                  ← главный индекс
  ├── 01-tech-audit.md → 12-tour-audit.md   (V17 P1-P12)
  └── 13-integrations-audit.md        (V17.2)
```

## Когда читать какую папку

- **Что-то странное в коде** → ищи V-метку → находи папку → находи .md по теме
- **Хочу добавить feature похожую на X** → ищи last audit где X описывался → следуй ADR
- **Сломал тест/contract** → смотри audit где этот тест появился → понимай зачем он есть
- **Готовлю release notes** → MASTER_PLAN.md
