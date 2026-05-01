# 08. Рекомендации (приоритизировано)

Сортировка: **risk × ease-of-fix** (high-risk-easy первое).

## Топ-10 (must-do в следующем sprint)

| # | Что | Зачем (risk) | Сложность | Эффект |
|---|---|---|---|---|
| 1 | Перенести `testRunner.js` тесты в `tests/unit/` с реальными импортами | Closed-form NEW-V13-2 — 104 теста сейчас фантомные | S (1-3h) | high |
| 2 | Поправить `npm run test:contract` (либо script, либо местоположение `contractTest.js`) | Closed-form NEW-V13-3 — обманчивый CI | S (15min) | high |
| 3 | try/catch вокруг `App.init()` в `DOMContentLoaded` + showToast | Closed-form NEW-15 / REL-1 — silent boot failure | S (15min) | high |
| 4 | Заменить empty catch в `notify()` на `console.error` + reason context | Closed-form NEW-4 / REL-2 — diagnostics | XS (5min) | medium |
| 5 | Валидировать URL scheme в `jiraForward` (только http/https) | Closed-form SEC-1 / NEW-V13-1 — partial mitigation | S (10min) | high (for shared deployment) |
| 6 | Atomic write config (`writeFileSync(tmp); renameSync(tmp, file)`) | Closed-form NEW-V13-6 — config corruption risk | S (10min) | medium |
| 7 | Обновить ARCHITECTURE.md под V13 (заголовок, секции, changelog) | Closed-form NEW-V13-4 — docs ≠ code | S (1h) | medium |
| 8 | Добавить unit-тесты на `chat/chatActivityHandler.js` (~15 тестов) | Closed-form NEW-V13-5 / TST-5 — 243 LOC без покрытия | M (3-4h) | high |
| 9 | Single-flight для `_jiraSprintFieldIdCache` + invalidation на config-write | Closed-form NEW-V13-9 / REL-8 — cache stampede | S (30min) | medium |
| 10 | Cap `areas.length` ≤ 100 в `jiraSanitizeAreas` | Closed-form NEW-V13-11 / SRV-5 — DoS amp | XS (5min) | low |

**Прикинутый бюджет: ~10-12 hours total**.

## Top-20 (последующий sprint)

| # | Что | Сложность | Эффект |
|---|---|---|---|
| 11 | Single-flight для Tech Info cache (NEW-5/REL-4) | S | medium |
| 12 | Memory-cache `jiraReadConfig` + invalidate on write (REL-6) | S | medium |
| 13 | Idle-timeout на `proxyChat` upstream stream (SRV-2) | M | medium |
| 14 | Storage.save: log non-Quota errors via console.error (NEW-3/REL-7) | XS | low |
| 15 | Триаж 95 `local/no-unescaped-innerhtml` warnings, цель `--max-warnings 110` | M | medium (security) |
| 16 | Focus trap utility + apply в 4 модалок (FE-2/NEW-V13-13) | M | medium (a11y) |
| 17 | Coverage в CI — `npm run test:coverage` + budget script (TST-4) | S | medium |
| 18 | Декомпозиция: `server/jiraApi.js`, `server/integrations/portfolioPulse.js` (SRV-1) | M | medium |
| 19 | `handleIntegrationsApi` → 10 отдельных handlers + ROUTES map (SRV-4) | M | medium |
| 20 | `chat/chatEngine.process()` принимает `pulseModel` через DI, не window (FE-7) | XS | low |

## Top-30 (на потом)

| # | Что | Сложность |
|---|---|---|
| 21 | Декомпозиция `app.js` — `AppSettings`, `BulkEditPanel`, `SidebarUI`, `ThemeUI` | L |
| 22 | jsdom UI-тесты для `views/registry.js`, `views/gantt.js` (audit #20) | XL |
| 23 | `// @ts-check` опт-ин на 5-10 модулей (audit #23) | M |
| 24 | Property-based fuzz-тесты на parsers (TST-7) | M |
| 25 | `analysePulse` рефактор — 298 LOC → под-функции (audit #28) | L |
| 26 | dependency-cruiser в CI (audit #29) | S |
| 27 | CSS V2: разрезать на 4-5 файлов через `@import` (FE-5) | XL |
| 28 | Bitbucket pagination beyond top-10 repos (NEW-18, audit #15) | M |
| 29 | `cfg.allowInsecureTls` per-service (SEC-7/NEW-V13-22) | M |
| 30 | Безопасный экспорт `_parseDomainLink` (вместо `new Function`) (SEC-6) | XS |

## Что **не рекомендую** делать

- **Полная миграция server.js на ESM** — изменение `require → import`, `module.exports → export`, `__dirname/__filename` workarounds. XL effort, low value (frontend ESM, server CJS — разделение чёткое).
- **Замена http.createServer на Express/Fastify** — нарушает «no runtime deps», добавляет attack surface. Текущий минимализм — feature, не bug.
- **Миграция localStorage → IndexedDB как primary** — V11 уже добавил SQLite-via-WASM как opt-in. localStorage остаётся primary deliberately (5-10 MB достаточно для типичного use-case). IDB — асинхронный, complicates `Storage.save` API.
- **Замена `node:test` на jest/vitest** — добавление dev-deps без явного выигрыша. node:test покрывает 95% функциональности.
- **Полное удаление inline `onclick="event.stopPropagation()"`** — проще через делегат, но затронет 7 мест в hot-path. Убрать только если CSP tightening становится приоритетом.
- **Гранулярные DOM updates вместо innerHTML** — без VDOM это много кода. Лучше: virtual scrolling в registry/gantt (audit #20).

## Roadmap

### Sprint N (короткий, 1-2 дня)
- pp.1-10 из «Топ-10» — security/reliability fundamentals.

### Sprint N+1 (неделя)
- pp.11-20 — coverage, testing infrastructure, server decomposition continued.

### Sprint N+2 (две недели)
- pp.21-30 — нагнать качественный долг, jsdom-тесты, CSS V2.

### Continuous (без явного sprint'а)
- Триаж innerHTML warnings (15 шт. в неделю).
- A11y улучшения (по jira-issue).

---

## Финальная оценка V13

🟢 **Хорошее**:
- Архитектурно проект здоровый. Декомпозиция, DI, factory-patterns правильные.
- Тестов растёт. ESLint + tsc + e2e + contract + perf — пирамида правильная.
- Никаких exploitable vulnerabilities (даже SSRF — design choice для текущего deployment).
- Все 12 V12-багов закрыты, регрессий нет.

🟡 **Требует внимания**:
- testRunner.js phantom-tests (NEW-V13-2) — главный архитектурный долг.
- Unfixed H-severity bugs из V12 (NEW-4, NEW-15) — не сложные, но игнорируются 2 sprint'а.
- ARCHITECTURE.md устарел — критично для onboarding'а.

🔴 **Не критично, но плохая привычка**:
- Накопление long-tail L-severity замечаний (17 штук) — каждое по отдельности неважно, в сумме — техдолг растёт быстрее чем гасится.

**Общая рекомендация**: следующий sprint — **«гигиена»**: топ-10 рекомендаций, без новых features. После — V14 с большим functional rollout.
