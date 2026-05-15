# Аудит 2026-05-04

> Серия из 12 отчётов по визуальному, функциональному и UX-аудиту проекта **Призма** (СБОФ Планировщик v17). Все отчёты — **только аналитика**, изменения в исходный код не вносились.

## Индекс

| # | Отчёт | Тема | Эксперты-роли |
|---|---|---|---|
| 1 | [01-visual-audit.md](./01-visual-audit.md) | Визуальный аудит dark / light — остаточные «синие» засветы, gradient-policy, контраст | brand designer · visual designer · a11y reviewer · frontend dev |
| 2 | [02-functional-audit.md](./02-functional-audit.md) | Функциональный аудит: тесты, ESLint, runtime-баги, persistence races | senior frontend · QA lead · tech lead · a11y |
| 3 | [03-brandbook-adaptation.md](./03-brandbook-adaptation.md) | Адаптация всех вкладок (кроме Дашборда) и LLM-чата под брендбук Призмы | brand designer · typography lead · motion designer · a11y |
| 4 | [04-hero-style-spread.md](./04-hero-style-spread.md) | Распространение hero-стиля Дашборда («0% / КУРС КВАРТАЛА») на остальные вкладки + чат | typography lead · interaction designer · brand designer |
| 5 | [05-icons-redesign.md](./05-icons-redesign.md) | Иконки под брендбук — переход с эмодзи на семейство 8-лучевой звезды + Lucide line-glyph | brand designer · iconography lead · a11y |
| 6 | [06-scanner-demo-mode.md](./06-scanner-demo-mode.md) | Сканнер команд 2.0: план реализации демо-режима | senior frontend · QA lead · product/UX writer · security |
| 7 | [07-tech-views.md](./07-tech-views.md) | Технические неровности по вкладкам / блокам (`views/*`) | senior frontend · design-system architect · perf engineer · code health |
| 8 | [08-tech-actions.md](./08-tech-actions.md) | Технические неровности кнопок / модалок / drag-and-drop / toasts | senior frontend · interaction designer · a11y |
| 9 | [09-tech-content.md](./09-tech-content.md) | Технические неровности контента: формат чисел / дат / loaders / empty-states | senior frontend · i18n lead · a11y |
| 10 | [10-design-actions-experts.md](./10-design-actions-experts.md) | Дизайн-аудит действий, кнопок, модалок, hover/focus/active | interaction designer · motion designer · micro-copy editor · a11y |
| 11 | [11-design-views-experts.md](./11-design-views-experts.md) | Дизайн-аудит вкладок и контента (15 экранов × 5 ролей × 5 осей) | typography · color/brand · layout/grid · a11y · editorial illustrator |
| 12 | [12-user-feedback.md](./12-user-feedback.md) | UX-feedback от 5 синтетических персон (PO / тимлид / HR / Q-планировщик / новичок) | 5 персон |

## Статус

Все 12 отчётов и индекс готовы — итого **13 файлов, ~2 990 строк, ~250 КБ**. Никаких изменений в исходный код не вносилось.

| # | Файл | Размер | Статус |
|---|---|---|---|
| README | README.md | 6.7 КБ | ✓ |
| 01 | 01-visual-audit.md | 13 КБ | ✓ |
| 02 | 02-functional-audit.md | 11 КБ | ✓ |
| 03 | 03-brandbook-adaptation.md | 19 КБ | ✓ |
| 04 | 04-hero-style-spread.md | 17 КБ | ✓ |
| 05 | 05-icons-redesign.md | 15 КБ | ✓ |
| 06 | 06-scanner-demo-mode.md | 20 КБ | ✓ (план без реализации) |
| 07 | 07-tech-views.md | 27 КБ | ✓ |
| 08 | 08-tech-actions.md | 19 КБ | ✓ |
| 09 | 09-tech-content.md | 22 КБ | ✓ |
| 10 | 10-design-actions-experts.md | 33 КБ | ✓ |
| 11 | 11-design-views-experts.md | 19 КБ | ✓ |
| 12 | 12-user-feedback.md | 35 КБ | ✓ |

## Метод

- **Статика**: `grep` по `styles.css` (15 617 LOC), `app.js`, `views/*`, `integrations/*`, `chat/*`, `index.html`.
- **Тесты**: `npm test` (1005 / 28 / 0), `npm run typecheck` (silent OK), `npm run lint` — не запускается локально (`node_modules` отсутствует).
- **DOM-проба**: 25 секций через preview MCP, переключение тем, открытие модалок, проверка hover/focus.
- **Бренд-сверка**: `my_prisma-brand/BRAND_BOOK.md` (Northstar метафора, без эмодзи, без gradients, 3px stripe-left, mono-tabular numerals, CAPS sub-headers, 4 motion-жеста).
- **Контракт**: `CLAUDE.md` контракты (Reactive.silent / identity-deterministic / `_scrubSecrets`).

## Что НЕ менять (общий список из всех отчётов)

- **Reactive.silent** обвязки в `Storage.save / restore / syncColumnSettings` — без них infinite loop.
- **Identity-deterministic attribution** через `state.employees[].{email,jiraAccountId,bitbucketLogin,confluenceAccountId}`.
- **`_scrubSecrets` policy** на всех экспортах.
- **36px row-density** Реестра, **compact pills** Ганта, **drag-and-drop** в Ганте — рабочая поверхность опытных пользователей.
- **Vendored libs** (`libs/xlsx.full.min.js`, `libs/sql-wasm.*`).
- **Splash-screen radial-gradient** (Northstar Emerge motion §9-10) — допустимо.
- **Status-pills** (signal-цвета) — semantic, не decorative.

## Сводный приоритет

**Критично (silent loss / security):**
- `dataStore.js:156` — позиционный вызов `ErrorsLog.add` (см. отчёт 02 #1).
- `integrations/portfolioPulseModel.js:651,735,768` — достижим `_ppFindByPartial` через `opts.allowFuzzyAuthorMatch` (см. 02 #3).

**Важно (видно сразу):**
- ~80 hardcoded синих/slate hex в `body.theme-dark` правилах (см. 01).
- Контраст `--prizma-text-secondary` Mist `#5A5A64` на Night → 3.4 (fail small text).
- Эмодзи как icon-system в production UI — 168 попаданий (см. 05).

**Средне:**
- Gradient policy violations в светлой теме (~10 мест).
- Дрейф между master-плана пилот V18.3 и реальным кодом (см. 02 #10).

**Полировка / DX:**
- `npm run ci` → `lint` падает (нет `node_modules`).
- `package.json` нет `"type": "module"` — предупреждения тестового раннера.

## Что сделано РАНЕЕ (не в этом аудите)

В предыдущей итерации (2026-05-03) были применены:
- Перевод `body.theme-dark` CSS-переменных на `var(--prizma-*)`.
- Override-слой в конце `styles.css` для метрик / реестра / ганта / AI CEO.
- Фикс ThemeUI: `data-theme="light/dark"` всегда устанавливается явно.
- `app/appSettings.js`: блоки скрываются через inject `<style>` — переживает re-render и работает для лениво рендеримых блоков.
- `.ceo-card-dark` в светлой теме → Ink `#1A1A22` (контрастная вставка).

**Эта серия (2026-05-04) — только аудит, без правок.** Реализация — последующими PR.
