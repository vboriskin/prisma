# Audits Index — V14 → V21

> Полный индекс всех audit-папок. Каждая папка — read-only ADR-history
> эпохи проекта. Не редактировать. Источник правды для всех `// V<N>`
> аудит-меток в коде (см. CLAUDE.md «Как читать audit-метки»).

См. также [`version-history.md`](./version-history.md) для краткой расшифровки **V11→V17.2**.

---

## V14 — plan-lock + GanttV2 retired

Не имеет собственной audit-папки (старше системы 5-агентных аудитов).
Артефакты в коде помечены `// V14 (B2)`/`(B3)`/`(B4)`/`(B5)`/`(B6)`/`(B7)`.

Расшифровка см. [`version-history.md`](./version-history.md).

---

## V15 — Spine-pill redesign

Не имеет своей audit-папки. Артефакты:
- `// V15 (audit#1, system H1)` — `tags` default fix
- `// V15 (Spine redesign 2026-04-30)` — per-pill assignee/inProgress/unplanned

См. [`spine-pill.md`](./spine-pill.md) для полного описания дизайн-языка.

---

## V17 / V17.1 / V17.2 — `audit-2026-05-V17/`

**Тема:** Overnight roadmap (тех. аудит, AI-чат редизайн, Performance tab,
Pulse / Black Dashboard refactor, dashboard / registry / settings / topbar /
filters / tour audits).

**Финальные тесты:** 516 unit / 11 contract / 0 fail (+38 regression).

| Файл | Тема |
|---|---|
| [MASTER_PLAN.md](../audit-2026-05-V17/MASTER_PLAN.md) | Roadmap V17 + V17.1 + V17.2 |
| 01-tech-audit.md | Full-stack / QA / system analyst (start) |
| 02-fixes-and-tests.md | Применённые фиксы + regression-тесты |
| 03-chat-redesign.md | Арт-дир + дизайнеры по чату |
| 04-perf-tab.md | Новая вкладка «Производительность сотрудников» |
| 05-portfolio-pulse-refactor.md | Pulse — таймауты, refactor |
| 06-black-dashboard-refactor.md | V11 → multi-project Sigma |
| 07-tests-pass.md | Прогон |
| 08-dashboard-tabs-audit.md | Дашборд / Метрики / Сводная / Инсайты / AI CEO / AI Анализ |
| 09-registry-audit.md | Реестр |
| 10-topbar-audit.md | Topbar |
| 11-filters-audit.md | Фильтры |
| 12-tour-audit.md | Onboarding tour |
| 13-integrations-audit.md | **V17.2 I1a-I5** identity-deterministic attribution |

---

## V18 — `audit-2026-05-V18/`

**Тема:** Structural debt cleanup + DX enablement.
**Тесты:** 534 unit / 11 contract / 0 fail.

| Файл | Тема |
|---|---|
| [MASTER_PLAN.md](../audit-2026-05-V18/MASTER_PLAN.md) | Roadmap V18 (Block A/B/C) |
| 01-git-init.md | Привести проект под git-контроль |
| 02-test-contract-fix.md | Контракт-тесты починены |
| 03-contributing.md | CONTRIBUTING.md создан |
| 04-ci-gate.md | CI gate (.gitlab-ci.yml) |
| 05-path-cascade-helper.md | Унификация path-cascade в Pulse |
| 06-token-middleware.md | Token-middleware для всех `/api/integrations/*` |
| 07-async-job-unification.md | Async-job pattern |
| 08-bb-bucket-split.md | Bitbucket bucket split |
| 09-app-decomposition.md | `app.js` (2.2k LOC) → `app/*` |
| 10-server-decomposition.md | `server.js` (6.6k LOC) → `server/*` |
| scanner2-graduation.md | V20 Scanner2 → production |
| scanner2-pilot-feedback.md | Feedback пилота |
| v18-3-B1-gantt-recon.md | V18.3 — гант recon |
| v18-3-MASTER_PLAN.md | V18.3 plan |
| v18-3-and-v19-roadmap.md | Раскатка на V19 |

---

## V20 / V21 (current) — `audit-2026-05-V21-tabs/`

**Тема:** Per-tab аудит после интеграции Сканнера 2.0 и переноса дашборда.

| Файл | Тема |
|---|---|
| 01-dashboard.md | КУРС · Дашборд (16 находок, 4 эксперта) |
| 02-insights.md | Инсайты |
| 03-gantt.md | Гант |
| 04-employees.md | Сотрудники |
| 05-ai-ceo.md | AI CEO |
| 06-actions-layer.md | Действия (Action Layer) |
| 07-ai-analysis.md | AI Анализ |
| 08-chatbot.md | Чат-бот |

---

## Mascot+Chat — `audit-2026-05-mascot-chat/`

**Дата:** 2026-05-07. **Тема:** Аудит маскота Обсидиан + чата + кодовой базы
после интеграции маскота. 13 экспертных отчётов.

| Раздел | Файлы |
|---|---|
| **Чат (5)** | chat-01 (LLM/streaming) · chat-02 (perf) · chat-03 (UX/visual) · chat-04 (sections×actions) · chat-05 (improvements) |
| **Кодовая база (5)** | codebase-01 (defects) · codebase-02 (perf) · codebase-03 (UX/brandbook) · codebase-04 (improvements) · codebase-05 (screen-jump root cause) |
| **Дизайн / арт-дирекция (3)** | design-01 (product designer) · design-02 (art-director) · design-03 (motion choreography) |

См. [README.md](../audit-2026-05-mascot-chat/README.md).

---

## Старший аудит — `audit-2026-05-04/`

**Дата:** 2026-05-04. **Тема:** Серия из 12 отчётов по визуальному /
функциональному / UX-аудиту. Все отчёты — **только аналитика**.

| # | Файл | Тема |
|---|---|---|
| 1 | 01-visual-audit.md | Визуальный аудит dark / light |
| 2 | 02-functional-audit.md | Тесты, ESLint, runtime-баги, persistence races |
| 3 | 03-brandbook-adaptation.md | Все вкладки + LLM-чат под брендбук |
| 4 | 04-hero-style-spread.md | Распространение hero-стиля Дашборда |
| 5 | 05-icons-redesign.md | Эмодзи → 8-лучевая звезда + Lucide |
| 6 | 06-scanner-demo-mode.md | Сканнер команд 2.0 — demo-mode |
| 7 | 07-tech-views.md | Технические неровности по вкладкам |
| 8 | 08-tech-actions.md | Кнопки / модалки / drag-and-drop / toasts |
| 9 | 09-tech-content.md | Числа / даты / loaders / empty-states |
| 10 | 10-design-actions-experts.md | Дизайн-аудит действий |
| 11 | 11-design-views-experts.md | Дизайн-аудит вкладок (15 экранов × 5 ролей × 5 осей) |
| 12 | 12-user-feedback.md | UX-feedback от 5 синтетических персон |
| 📁 | dashboard-redesign / gantt-deep / integrations-deep-dive | Глубокие deep-dive'ы |

---

## Holistic эпоха — корневые `AUDIT_*.md` (2026-05-07/08)

Финальный кросс-пасс из 14 отчётов. Каждый строит на предыдущих:

| Файл | Тема | Размер |
|---|---|---|
| AUDIT_MAP.md | Карта продукта | 17 KB |
| AUDIT_TECH.md | Tech audit | 46 KB |
| AUDIT_UX.md | UX audit | 43 KB |
| AUDIT_LAYOUT.md | Layout | 35 KB |
| AUDIT_ARTDIRECTION.md | Art direction | 53 KB |
| AUDIT_MASCOT.md | Маскот Обсидиан | 58 KB |
| AUDIT_LLM.md | LLM | 41 KB |
| AUDIT_COPY.md | Copy | 55 KB |
| AUDIT_DEVOPS.md | DevOps | 39 KB |
| AUDIT_QA.md | QA | 57 KB |
| AUDIT_SCANNER.md | Сканнер команд | 59 KB |
| AUDIT_SCANNER_METRICS.md | Метрики Сканнера | 46 KB |
| AUDIT_ARCHITECTURE.md | Architecture | 77 KB |
| AUDIT_MIGRATION.md | Миграция | 101 KB |
| **AUDIT_HOLISTIC.md** | **Сквозной взгляд (P1-P8 рекомендации)** | 37 KB |
| AUDIT_SUMMARY.md | Резюме | 43 KB |

---

## Старшие docs/audit-* (внутри `docs/`)

В `docs/` живут три исторических аудита (старше V17):

- [`docs/audit-2026-05-03/`](./audit-2026-05-03/) — пилот V21 ранний
- [`docs/audit-2026-05-pilot-review.md`](./audit-2026-05-pilot-review.md) — Pilot Review V21 Призма
- [`docs/audit-2026-05-tech-deep-dive.md`](./audit-2026-05-tech-deep-dive.md) — Технический аудит ~50 KLOC

---

## Что НЕ трогать

- `audit-2026-*/` — все папки read-only.
- `AUDIT_*.md` в корне — read-only финальный пасс.
- `docs/audit-2026-*` — историческое зеркало, не редактировать.
