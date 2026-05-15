# П1 — Визуальный аудит dark / light

> Дата: 2026-05-04. Метод: grep по `styles.css` (15 617 LOC) + DOM-inspection через preview MCP + сверка с `my_prisma-brand/BRAND_BOOK.md`. Только отчёт, изменений в коде не вносилось.

**Эксперты-роли:**
- **Brand designer** — соответствие токенам Северной Звезды (Night/Twilight/Paper/Mist/signal).
- **Visual designer** — gradient policy, контраст, decorative-clutter.
- **A11y reviewer** — WCAG 2.1 AA контраст для small/large text.
- **Frontend dev** — где источники в CSS, как лечить (без правок — указатели).

## TL;DR

Базовый фон/карты переведены на Night/Twilight (предыдущая итерация). Однако в `body.theme-dark` остаются **~80** правил с hardcoded синими/slate hex (`#0b1020`, `#121a2f`, `#25304d`, `#16203a`, `#141d35`, `#334772`, …) и indigo-акцентами (`#4f46e5`, `#6366f1`, `#818cf8`, `#a5b4fc`). В светлой теме — **~10 рудиментарных gradients** на surfaces (запрещены брендбуком). A11y: `--text-4: #9ca3af` на Paper даёт ratio ≈ 3.0 — **fail** для small text.

---

## 1. Тёмная тема — карты с остаточным «синим»

| Раздел / класс | `styles.css:line` | Текущие цвета | По брендбуку |
|---|---|---|---|
| `.td-actions` (реестр) | 1428 | `#10172b` slate | `var(--prizma-bg-elevated)` Twilight |
| `.th-actions` (реестр header) | 1429 | `#1a2340` slate | Twilight |
| `.gdt-jump-kind-team` (гант jumpbox) | 1971 | `rgba(99,102,241,.18)` indigo + `#a5b4fc` | `--prizma-information-bg` + `--prizma-information` |
| `.gantt-lock-badge-edit` | 2198 | `#172554` / `#bfdbfe` / `#1e40af` | `--prizma-information-bg` + ramp |
| `.gdt-pill-legend-state-active` | 2554 | `#4f46e5` indigo flat | `--prizma-information` |
| `.summary-super-hero` (dark) | 3582 | `#121a2f` / `#25304d` / `#818cf8` border-left | Twilight + neutral border + 3px information stripe |
| `.metrics-hero` (dark) | 3739 | то же | то же |
| `.metrics-signal` / `.metrics-spark-svg` / `.metrics-control-ring-inner` | 4017–4025 | `#141d35` / `#334772` + gradient | flat Twilight + neutral border |
| `.metrics-person` (dark) | 3995 | `linear-gradient(90deg,#121a2f,#17223f)` | flat Twilight |
| `.registry-table td[data-sticky]` | 4029 | `#111b33` / `#2b3d63` border | `--prizma-bg-elevated` + `--prizma-border` |
| `.registry-table tbody tr:hover > td` | 4030 | `#1a2745 !important` | `--prizma-bg-tertiary` + alpha |
| `.kanban-col-body` | 4011 | `#111b33` slate | Twilight |
| `.podlozhka-group-header` (dark) | 4014 | `linear-gradient(135deg,#1a2847,#15263f)` | flat Twilight |
| `.timeline-stage-header` / `.stage-r120` | 3988–3990 | `#222c57` / `#9faeff` border | `--prizma-bg-tertiary` + `--prizma-text-secondary` |
| `.llm-settings-box`, `.assistant-msg-*`, `#llm-settings-modal textarea`, `.msg-copy-btn` | 4604–4635 | `#121a2f` / `#141d35` / `#334772` slate | Twilight + neutral border |
| `.bulk-panel` (gantt) | 5098 | `#121a2f` + indigo `#818cf8` border-left | Twilight + information stripe |
| `.ai-block` (dark) | 8228 | `#1a2035` / `#2d3f5e` | Twilight + neutral border |
| `#timeline-legend-extra` | 3969 | `#121a2f` / `#2b3d63` | Twilight |
| `.gar-toolbar`, `.gtx-pill`, `.gtx-pill-danger`, `.gtx-dep-state`, `.gtx-group-dep` | 3974–3987 | `#202b52` / `#3a4f84` / `#3a1622` / `#17233f` / `#4a1021` | semantic-bg или Twilight |
| `.preset-role-btn.active` (dark) | 3950 | `#27355b` / `#dbe4ff` / `#4b5f90` | Twilight + 3px information stripe |
| `.gantt-cell` border | 3959 | `#243457` slate | `--prizma-border` |
| `.gantt-window-r120/r121/r122/backlog` (dark) | 3960–3963 | `#1b2348` / `#122f35` / `#3a2c14` / `#111b33` | semantic-tinted background или Twilight |
| `body.theme-dark .els-chip.r120` (employees) | 3022 | `rgba(99,102,241,.15)` / `#a5b4fc` indigo | Twilight + `--prizma-information` stripe |

> _Brand designer:_ «весь этот ряд — наследие старой синей тёмной темы. Каждое правило пробивается через `body.theme-dark .X { background: #ХХ }` и переоезжает токен. Замена на `var(--prizma-bg-elevated)` / `var(--prizma-border)` снимает синий тон везде разом.»

## 2. Тёмная тема — gradient policy violations

Brandbook: gradients **запрещены** на surfaces (см. § 12 Illegal usage). В styles.css 51 `linear-gradient` + 2 `radial-gradient`. Критичные на surfaces:

| Класс | Стр. | Источник проблемы |
|---|---|---|
| `.gantt-team-header` (dark, base) | 5815 | `linear-gradient(135deg,#1e2030,#1a1d2e)` |
| `.gantt-team-header.v16-team-row` (dark) | 5834 | `linear-gradient(135deg,#1c2030,#1a1d2e)` |
| `.gantt-team-header.v16-team-row:hover` (dark) | 5840 | `linear-gradient(135deg,#1f2540,#1c2034)` |
| `.metrics-row-fill.role` | 3805 | `linear-gradient(90deg,#8b5cf6,#6366f1)` purple→indigo |
| `.gtx-link-progress` | 3517 | `linear-gradient(120deg,#0f172a,#1f2937,#334155)` slate-сборка |
| `.metrics-spark-svg` (dark) | 4024 | `linear-gradient(180deg,#121a31,#1a2746)` |
| `.assistant-panel-header` (dark) | 4605 | `linear-gradient(90deg,rgba(79,70,229,.22),rgba(2,132,199,.16))` |
| `.welcome-splash-circle` (radial) | 4504 | radial для splash — допустимо по motion §10, но цвет `rgba(99,102,241,…)` нужно перевести на `--prizma-information` |
| `.gradient-fallback-pulse-bar` (radial) | 10219 / 10254 | `#e9d5ff/#a78bfa/#6d28d9` purple-сборка для splash motion |
| `.summary-progress-fill` | 8077 | `linear-gradient(90deg,#ef4444,#f59e0b,#22c55e)` — semantic ОК для прогресса |
| `.ceo-risk-bar-fill.ceo-risk-proj` low/med/high | 8595–8597 | `linear-gradient(90deg,#1d4ed8,#3b82f6)` low → должен быть `--prizma-information` |

## 3. Светлая тема — несоответствия

| Раздел | Стр. | Сейчас | Должно |
|---|---|---|---|
| Главный fallback | 51 | `--bg: #f0f2f7` (синевато-серый) | в brand shim `--bg: var(--prizma-bg)` уже подменяет на `#FAFAF8`, но строка-источник остаётся как декларация для тех мест, где shim не виден |
| `.metrics-row-fill` base | 3801 | `linear-gradient(90deg,#6366f1,#14b8a6)` | flat `var(--prizma-information)` или Spine-pill stripe |
| `.metrics-row-fill.role` | 3805 | purple→indigo gradient | flat secondary |
| `.podlozhka-group-header` light | 3868 | `linear-gradient(180deg,#f8fafc,#eef2ff)` | flat Linen `#F0EDE5` |
| `.ai-enhanced-badge` | 6864 | `linear-gradient(135deg,#a78bfa,#ec4899)` purple→pink | flat insight `#6B4488` или secondary text |
| `.ai-block` (light) | 7886 | `linear-gradient(135deg,#ede9fe,#dbeafe)` | flat Snow + insight stripe |
| `.onboarding-ribbon` | 7297 | `linear-gradient(180deg,#c4b5fd,#f9a8d4)` | flat Snow + onboarding accent |
| `.assistant-panel-header` | 4600–4601 | `radial-gradient + linear-gradient rgba(99,102,241,.18)` | flat Snow / Twilight |
| `.ceo-risk-bar-fill.ceo-risk-proj` low | 8597 | `linear-gradient(90deg,#1d4ed8,#3b82f6)` | semantic information |

## 4. Контраст / a11y

| Пара | Цвет | На фоне | Ratio | WCAG AA |
|---|---|---|---|---|
| `--text-4` light | `#9ca3af` | `#FAFAF8` Paper | ~3.0 | **fail small** |
| `--prizma-text-secondary` dark | `#5A5A64` Mist | `#0A0A0F` Night | ~3.4 | **fail small** (нужно подняться к `#7A7A82`+) |
| `--text-3` light | `#7A7A82` Stone | `#FAFAF8` | ~4.7 | pass |
| `body.theme-dark .gtx-dep-state` | `#fecdd3` | `#4a1021` | ~6.2 | pass |
| `body.theme-dark .stage-r120` | `#9faeff` | `#222c57` | ~5.8 | pass |
| `--prizma-on-course` dark | `#7FE8B5` | `#0A0A0F` | ~10.4 | pass large+small |
| `--prizma-information` dark | `#6EC1E4` | `#0A0A0F` | ~7.9 | pass |
| `--prizma-drift` dark | `#FFB347` | `#0A0A0F` | ~10.0 | pass |
| `--prizma-off-course` dark | `#FF6B6B` | `#0A0A0F` | ~5.0 | pass small (граница) |

> _A11y reviewer:_ «Mist `#5A5A64` на Night выглядит «дорого» и приглушённо, но 3.4 — fail. Для secondary-метаданных в реестре / ганте (даты, счётчики) поднять до `#8A8A92` или вообще `#A0A0A8` — text-tertiary. Для headlines/body — primary-text `#FFF` обязателен.»

## 5. Иконочные / эмодзи-замены (отдельно в П5)

В тёмной теме многие иконки кнопок — эмодзи (`🔒`, `✏`, `🗑`, `🔓`, `▦`, `⇕`, `⊟`, `🌙`, `☀`, `⚡`, `🌀`, `↻`, `↺`). Эмодзи в production UI **запрещены** brandbook'ом (только в emoji-палитре или диагностике). Полная инвентаризация — П5.

## 6. Сводный приоритет

**Критично (видно сразу — синие пятна на dark):**
1. `.td-actions` / `.th-actions` (реестр `#10172b`/`#1a2340`).
2. `.summary-super-hero` / `.metrics-hero` (`#121a2f`).
3. `.kanban-col-body` / `.podlozhka-group-header` / `.gantt-team-header` (gradient).
4. `.bulk-panel` / `.ai-block` (`#121a2f`/`#1a2035`).
5. `.assistant-msg-*` / `.llm-settings-box` (`#121a2f`/`#334772` slate).
6. `.gtx-pill-danger` / `.gtx-dep-state` / `.stage-r120` (slate + indigo текст).

**Важно (контраст a11y):**
7. Поднять `--prizma-text-secondary` до `#7A7A82+` для small text в dark.
8. Все `--text-4` callsite перевести на `var(--prizma-text-tertiary)`.

**Полировка (gradient policy):**
9. AI-Enhanced Badge / AI-Block-light / Onboarding-ribbon → flat.
10. `.metrics-row-fill.role` → flat или semantic stripe-pill.
11. `.assistant-panel-header` radial → flat.

## 7. Что НЕ трогать

- Splash-screen radial-gradient (Northstar Emerge motion §9-10) — допустимо.
- Status-pills (`--prizma-on-course/-drift/-off-course/-information/-insight`) — semantic, не decorative.
- Цветные пилы тикетов в реестре (SBOF-101 и т.п.) — identity-метки.
- Цветные категории работ в Ганте (backend / frontend / analytics) — semantic indicator.
- 36px row-density Реестра, compact pills Ганта — рабочая поверхность опытных пользователей.

## 8. Полная карта проблем по разделам

| Вкладка / экран | Сейчас (dark) | Сейчас (light) | Brandbook fit |
|---|---|---|---|
| Дашборд | ✅ Night/Twilight + caps + spine | ✅ Paper / Snow | OK (см. П4) |
| Сводная | синий hero `#121a2f` | gradient в KPI-rows | needs migration |
| Метрики | hero/signal/spark — slate | gradient role | needs migration |
| Инсайты | (visualisations) | OK по шиму | dependent on data viz |
| Реестр | actions slate, sticky `#111b33`, hover `#1a2745` | OK | actions cells need fix |
| Гант | team-header gradient, lock-badge-edit `#172554`, bulk-panel slate | OK | core fixes |
| Канбан | col-body `#111b33` | OK | col-body fix |
| Таймлайн | legend-extra slate, stage-r120 indigo | OK | legend + stage refresh |
| История | OK | OK | OK |
| Сотрудники | els-chip indigo (R120) | OK | chips refresh |
| Перегрузка | (зависит от подложки) | gradient `eef2ff/dbeafe` | tile refresh |
| Здоровье компонентов | depend on cards | OK | OK |
| AI CEO | ceo-card-dark slate, risk-bar low gradient | белый → ОК | risk-bar low fix |
| Действия | depend on cards | OK | OK |
| AI Анализ | ai-block slate (dark) / gradient (light) | gradient `ede9fe/dbeafe` | flat + insight |
| Калибровка оценок | OK | OK | OK |
| Дизайн-долг | OK | OK | OK |
| Интеграции | формы — slate inputs | OK | inputs migrate |
| Ошибки | OK (text-only) | OK | OK |
| Сценарии | depend on cards | OK | OK |
| LLM-чат | панели/inputs/messages slate | gradient header | major migration |
| Настройки модалка | OK | OK | OK |

---

**Всего к исправлению (если бы фиксили — но не правим):** ~80 hardcoded правил в `body.theme-dark`, ~10 gradient-replacements в светлой теме, ~2 contrast-fix-точки, ~12 вкладок частично затронуты.
