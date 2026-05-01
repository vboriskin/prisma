# V17 — Overnight Roadmap ✅ + V17.1 patch pack ✅ + V17.2 Integrations audit ✅

Базис: V16 (Spine-pill + 5 макро-улучшений ганта + roadmap-2 Tier S/A/B/C). Тесты на старте: 478 unit / 11 contract / 0 fail.

**Финальные тесты: 516 unit / 11 contract / 0 fail (+38 regression-тестов).**

Папка отчётов: `audit-2026-05-V17/`. Каждый пункт = отдельный `.md` с тем что нашёл, что починил, что отложил.

## Roadmap

| # | Пункт | Файл отчёта | Статус |
|---|---|---|---|
| 1 | Технический аудит — full stack / QA / system analyst + отдельно гант | [01-tech-audit.md](./01-tech-audit.md) | ✅ |
| 2 | Применить найденные фиксы + написать больше тестов + прогнать | [02-fixes-and-tests.md](./02-fixes-and-tests.md) | ✅ |
| 3 | Чат-ассистент — арт-директор + дизайнеры | [03-chat-redesign.md](./03-chat-redesign.md) | ✅ |
| 4 | Новая вкладка интеграций «Производительность сотрудников» | [04-perf-tab.md](./04-perf-tab.md) | ✅ |
| 5 | Рефакторинг «Сканнер команд» (Portfolio Pulse) — таймауты | [05-portfolio-pulse-refactor.md](./05-portfolio-pulse-refactor.md) | ✅ |
| 6 | Рефакторинг «Чёрный дашборд» (V11) — несколько проектов | [06-black-dashboard-refactor.md](./06-black-dashboard-refactor.md) | ✅ |
| 7 | Прогнать тесты | [07-tests-pass.md](./07-tests-pass.md) | ✅ |
| 8 | Аудит «Дашборд / Метрики / Сводная / Инсайты / AI CEO / AI анализ» | [08-dashboard-tabs-audit.md](./08-dashboard-tabs-audit.md) | ✅ audit |
| 9 | Аудит «Реестр» | [09-registry-audit.md](./09-registry-audit.md) | ✅ audit |
| 10 | Аудит «Шапка» | [10-topbar-audit.md](./10-topbar-audit.md) | ✅ audit |
| 11 | Аудит «Фильтры» | [11-filters-audit.md](./11-filters-audit.md) | ✅ audit |
| 12 | Аудит «Тур / обучение / демо» | [12-tour-audit.md](./12-tour-audit.md) | ✅ audit |

## Что отгружено в коде (P1-P7 — applied fixes)

**P1+P2:** 10 audit fixes (1 blocker + 4 critical + 2 high + 3 medium) в `views/gantt.js` / `dataStore.js` / `app.js` / `styles.css` + 19 regression-тестов

**P3:** 12 chat fixes (hotkey ⌘/, gradient cleanup, neutral user-bubble, no-emoji category badges, inline-citations `BIK-1234`, 2px stream sweep, payload behind debug-flag, Cmd+Enter, Up-arrow recall, aria-live, ▾ subtitle, token-died UX) + 19 regression-тестов

**P4:** New `👥 Производительность сотрудников` sub-tab (Frontend `integrations/employeePerformance.js` + server endpoint `POST /api/integrations/employee-performance` + CSS skin + sub-tab integration)

**P5:** Portfolio Pulse timeouts × 2-3 (client 180→600s, server budgets 20-30→60-75s, per-call 25→60s)

**P6:** Black Dashboard multi-project (per-project budget 240→600s, search budget 90→180s, multi-project chunkConcurrency 1→2)

**P7:** Final tests pass (516/11/0)

## Что отгружено как applied-fixes + audit (P8-P12)

**P8** (6 dashboard tabs): synthesized 5-agent audit + ~10 fixes (KPI stripe/mono, gradient cleanup, dashboard empty-state crash fix, AI views FilterEngine integration, memory leak fix, KPI→registry CTA, etc) + 18 TODO

**P9** (Registry): synthesized 5-agent audit + 12 fixes (CSV formula injection security guard, flushPendingEdits before export, bulk on filtered intersect, unified bulk-actions code-path, Esc deselect, Storage.restore orphan cleanup, Spine eyebrow + tabular-nums + count-badge + bulk-panel surface flip + pin SVG, tag paste split) + 20 TODO

**P10** (Topbar): synthesized 5-agent audit + 11 fixes (Cmd+S hotkey + empty-guard, files-dropdown a11y/Esc/idempotent, sim-banner top-offset, SimMode.applyFromState boot-restore, filter-count badge, brand→dashboard, aria-labels on 6 icon-btns, demo-bar emoji→SVG, logo-pulse kill, idempotent guards) + 14 TODO

**P11** (Filters): synthesized 5-agent audit + 9 fixes (FilterEngine.invalidate on flush, idempotent FiltersUI._bound, search dual-handler race fix, applyPreset clean-state, tag splitter [|,] consistency, Multiselect a11y/Esc/Enter/Space, toggle-chip↔checkbox sync, manual-mutation drops preset highlight, preset emoji→text) + 18 TODO

**P12** (Tour): synthesized 5-agent audit + 7 fixes (startDemoFlow idempotent + confirm-overwrite, welcome Esc/backdrop, tour reposition on resize/scroll, _hideTourTooltip orphan-cleanup, btn-onboarding non-destructive, demo blockingDeadline dynamic isoShift, inline doc) + 20 TODO

## Договорённости с пользователем

- **Порядок:** строго последовательный ✅
- **Блокер на пункте N → пропускать с TODO** в `.md`, двигаться дальше — не было блокеров, всё прошло
- **Папка:** `audit-2026-05-V17/`, по одному `.md` на пункт ✅
- **Карточка сотрудника** (п.4) — состав метрик и дизайн на моё усмотрение, можно использовать LLM ✅ (Jira метрики реализованы, Bitbucket/Confluence stub-extension ready)
- **Источник списка сотрудников** (п.4) — сам разберусь ✅ (через `cfg.jiraProjectKeys` issues' assignees)

## Резюме

V17 закрыл:
- 7 critical/high багов из тех-аудита (token leak / SSRF / edit-mode trail / delete-pill arrows / beforeunload / cyrillic regex / restore via factory + perf)
- 12 chat-redesign улучшений
- 1 новую feature-вкладку (MVP)
- 2 timeout-рефактора (Portfolio Pulse / Black Dashboard)
- 5 dashboard / registry / topbar / filters / tour audits с 5-agent методикой → ~50 applied fixes (security/data-correctness/a11y/state/visual) + 90 TODO для следующих спринтов

**Тесты:** 516 unit / 11 contract / 0 fail (+38 за итерацию, 0 регрессий после P8-P12).

## Договорённости с пользователем

- **Порядок:** строго последовательный
- **Блокер на пункте N → пропускать с TODO** в `.md`, двигаться дальше
- **Папка:** `audit-2026-05-V17/`, по одному `.md` на пункт
- **Карточка сотрудника** (п.4) — состав метрик и дизайн на моё усмотрение, можно использовать LLM
- **Источник списка сотрудников** (п.4) — сам разберусь

---

## V17.1 patch pack (2026-05-01)

12 групп правок по запросу пользователя. Применено всё, тесты 516/11/0 без регрессий.

### A. Чат-бот (5)
- A1: FAB переехал в bottom-LEFT (`#assistant-fab`).
- A2: иконка перерисована (sparkles SVG stroke-2, neutral surface, без 135° градиента и infinite-pulse).
- A3: окно чата шире на 30% (`clamp(420→546px, 30vw→39vw, 760→988px)`).
- A4: click-outside → закрывает чат (с idempotent guard `_q2ChatOutsideBound`, skip в mid-stream).
- A5: «Planning Assistant» → «Помощник по планированию», «Контекст: current view» → русские ярлыки в `updateContextModeIndicator`.

### B. Реестр (1)
- B1: `.table-scroll-wrap` height растянут до низа экрана (`100vh - topbar - 110px`, при открытых фильтрах −250px).

### C. Гант (12)
- C1: текст «Бэклог» убран из заголовка колодца.
- C2: колодцы растягиваются равномерно (`makeGT()` использует `minmax(<defaultCw>px, 1fr)` для не-resized колонок).
- C3: разноцветная линия в шапке колодцев скрыта (`.gdt-rail-dist { display:none }`).
- C4: даты в формате «20 апреля – 17 мая» через `formatLongRange()` + `RU_MONTHS_GEN`.
- C5: текст «1.21» / «Бэклог» убран из строки команды (`v16-team-bucket-label` удалён).
- C7: пункт «Снять назначение» в pill ctx-menu (только когда `_assigneesForPill`); action handler `unassign` чистит `row.assigneePills[…]`.
- C8: кнопка «Подсказки по визуализации» переехала в section-header (`#btn-gantt-tips-toggle`); внутренняя toggle убрана.
- C9: кнопка «История» в section-header → модалка `_openHistoryModal()` с фильтром по domain=gantt + GANTT_PATTERNS regex.
- C10: max-height 64px на `.gantt-cell` + hover-expand (заглушает 3-rows overflow).
- C11: «N работ» → «N задач» через `pl()` плюрализатор.
- C12: «N задач» в team-row → «N эпиков» через `pl(EPIC_FORMS)`.
- C13: «+» в team-row epic column → `_openAddEpicModal()` с полным набором полей (команда / эпик / scope / релиз / типы работ / зависимости / комментарий).

### D. Гант HTML-выгрузка (3)
- D1: подсказки в `<details open>` (collapsible).
- D2: кнопка «Текущий релиз» рядом с theme-toggle, JS `_CURRENT_RELEASE_JS` парсит DD.MM или long-RU range и hides всё кроме current+overtime.
- D3: long-format dates / отсутствие «Бэклог» / «1.21» в team-row автоматически прокидываются (export клонирует DOM из live gantt'а).

### E. Сотрудники (3)
- E1: dark-theme overrides для `.employees-controls*` (background card + border rgba 14%).
- E2: input «Дни OT» наверху row, chips под input (`appendChild` order swapped).
- E3: колонка «Нагрузка» удалена из таблицы → `_renderLoadSummary()` под таблицей: bar per employee + total/cap + per-release chips, цветовая шкала green/amber/red (Q4 а+б+в).

### F. Настройки (2)
- F1: JSON export bundle теперь включает `q2_integrations_v1` И `q2_llm_settings_v1` с защитой через `_scrubSecrets` (token-shaped поля выкидываются на любой глубине). Allowlist на import тоже расширен. Тесты `jsonRoundTrip.test.js` обновлены под новую политику.
- F2: `#app-settings-modal` шире и выше (max-width 1100px / max-height 92vh, body 78vh).

### G. Сводная (1)
- G1: представление «Совсем красиво» удалено вместе с переключателем; `bindSummaryModes` нормализует state в `'brief'`; `metrics.js` всегда вызывает `renderBrief`.

### H. Инсайты (1)
- H1: actions «Назначить в 1.20 →» / «Снять блокеры →» вынесены в отдельный flex-wrap row (`.insight-list-head` + `.insight-list-actions`) — больше не уезжают за карточку.

### I. Action layer (1)
- I1: блок «Журнал действий» убран из ActionLayer (дублировал вкладку «История»). `render()` рисует только catalog; `renderLog()` стал no-op.

### J. AI Анализ (2)
- J1: HIGH/MEDIUM/LOW переведены в русские badges через `IMPACT_LABEL`/`SEV_LABEL`/`CONF_LABEL`; HIGH overflow выровнен через CSS `flex-wrap` на actions.
- J2: russifications: AI Forecast Engine / If Nothing Changes / confidence: medium / Worst+Expected+Best / AI-generated Dashboard / Plan Quality Score / Bottleneck Finder / Anomaly Detection / Risk Narrative Engine / AI Second Opinion / AI Prioritization Engine / Dependency Graph Analyzer / Smart Replanning / AI Recommendations Feed / AI Analytics Center → русские заголовки.

### K. AI CEO (2)
- K1: PROJECT OK/AT RISK/CRITICAL → «ПРОЕКТ В НОРМЕ / ПОД РИСКОМ / В КРИТИЧЕСКОМ СОСТОЯНИИ»; Conservative/Balanced/Aggressive → Консервативный / Сбалансированный / Агрессивный; Preview changes → Предпросмотр; Action Feed → Лента действий.
- K2: dark-theme parity на `.ceo-sev-*` токенах: `--sev-bg/--sev-border` переопределены в полупрозрачные accent-tints для тёмной темы (раньше hex `#fef2f2` оставался light на dark surface).

### L. Tests + roadmap
- 4 теста обновлены под новую политику F1 (token-scrub-but-include) + новый title «Здоровье проекта».
- 516 unit / 11 contract / 0 fail после всех групп.

---

## V17.2 — Integrations audit (2026-05-01)

Триггер: жалобы пользователя «Bitbucket-данные привязываются к сотрудникам без BB-аккаунта» + «Confluence не тянутся». 2-эксперта аудит (Senior FS dev + Senior QA) → 13 фиксов в 4 группах.

См. подробно: [13-integrations-audit.md](./13-integrations-audit.md).

### I1 — Bitbucket attribution rebuild (CRITICAL)
- I1a: `EmployeeFactory` расширен полями `email / jiraAccountId / bitbucketLogin / confluenceAccountId`.
- I1b: UI «Идентификация для интеграций» в карточке сотрудника.
- I1c: `analysePulse` — fuzzy 2-token overlap заменён на deterministic identity (email/login/accountId). `_ppFindByPartial` остался dev-only за флагом. `state.employees` теперь авторитетная identity-таблица.
- I1d: dev-status walker filter — entries без email/login отбрасываются.

### I2 — Confluence end-to-end (CRITICAL)
- I2a: `confluence-search` — path-cascade `/wiki/rest/...` → `/rest/...`, CQL `title ~ ... OR text ~ ...` вместо exact title, `Accept: application/json`, trim хвостового `/wiki`.
- I2b: `verify-confluence` — 4-URL cascade (Cloud + DC + space-fallbacks).

### I3 — Settings save guards (HIGH)
- I3a: централизованный `postServerConfig` с await + ошибкой.
- I3b: empty-URL guard (как пустой токен).
- I3c: request-id guard на verify-кнопках.
- I3d: save-кнопки disabled-on-click.

### I4 — Polish (MEDIUM)
- I4a: token redact regex в employeePerformance.fetchModel error path.
- I4b: TechInfo `_wireOverlay` — единый делегированный click-handler.
- I4c: `proxyPost` timeout 15с → 90с (matches PER_PK_TIMEOUT_MS).

### I5 — Auto-fill employee identity from Pulse (HIGH UX)
После каждого успешного `analysePulse` сканируем участников и автозаполняем `email + jiraAccountId` у сотрудников в `state.employees` (match по нормализованному ФИО). Manual wins, ambiguous skipped, toast «Подтянули данные из Jira: N сотрудников». Это устраняет ручную работу — пользователю достаточно завести сотрудника с ФИО, остальное подхватывается само за один pulse.

### I2c — Confluence: space-scope + полная активность (HIGH)
- **G1**: поле `confluenceSpaceKeys` (`DEV, PAY, SBOF`) + `activityWindowHours` (default 72, clamp [1,168]) в settings.
- **G2**: space-scope подключён в `ppFetchConfluenceActivity` + `confluence-search` (per-row) + `verify-confluence` (`/rest/api/space/{KEY}` cascade).
- **G3**: `ppFetchConfluenceActivity` полностью переписан: окно 72h (было 48h), CQL `+1ч padding` (TZ-skew), per-employee `contributor in (...)`, pagination `start/limit` cap 1000×10.
- **G4**: comments + mentions — три CQL-прохода (edits / comments / mentions), shape `{edits, comments, mentions, items[{kind:create|edit|comment|mention}]}`, dedup by targetId.
- **G5**: endpoint `confluence-resolve-user` + auto-trigger в карточке сотрудника при сохранении email — автозаполняет `confluenceAccountId`.
- **G7**: endpoint `confluence-audit-logins` (`/rest/api/audit`) + кнопка «Проверить аудит логинов» в Confluence-вкладке.

**Тесты:** 534 unit / 11 contract / 0 fail (+18 новых: 2 identity-match + 8 autofill + 8 store I2c).
