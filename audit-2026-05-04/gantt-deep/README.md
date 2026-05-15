# Гант — глубокий аудит · 2026-05-04 deep

Серия из 6 экспертных отчётов по вкладке Гант (`#section-gantt`), сделана 2026-05-04 после применения V21 pills refresh + tokenization arrows + ghost-chips B вариант. Все отчёты — **только аналитика**, изменения в исходный код в этом аудите не вносились.

## Контекст

Аудит инициирован запросом «нагони экспертов на свое усмотрение, пускай выверяют каждую линию, каждый блок, элемент, кнопку и так далее. все досконально во вкладке гант. все должно работать четко и соответствовать брендбуку».

Расширяет и углубляет:
- `gantt-redesign/` (6 экспертных отчётов от 2026-05-04 утром)
- `audit-2026-05-04/` (12 отчётов уровня всего приложения, с фокусом на Гант в №07 + №11)

## Индекс

| # | Отчёт | Тема | Эксперты-роли |
|---|---|---|---|
| 00 | [00-SYNTHESIS.md](./00-SYNTHESIS.md) | Синтез 6 отчётов: top-10 cross-cutting, тематические кластеры, сводная таблица 88 пунктов на человеческом языке | синтез |
| 01 | [01-visual-brand.md](./01-visual-brand.md) | Визуально-бренд аудит: hex hardcodes, brand-палитра compliance, light/dark parity, gradients, illegal usage | brand designer · visual designer · color reviewer |
| 02 | [02-typography.md](./02-typography.md) | Типографика: веса, размеры, семьи, mono-tabular numerals, CAPS sub-headers, иерархия | typography lead |
| 03 | [03-interaction-motion.md](./03-interaction-motion.md) | Интерактив + анимации: hover/focus/active, click-targets, animations, reduced-motion, drag-drop, tooltips | interaction designer · motion designer |
| 04 | [04-a11y.md](./04-a11y.md) | Доступность: контраст WCAG, focus management, keyboard, ARIA, screen reader semantics, reduced-motion | a11y reviewer · WCAG 2.1 expert |
| 05 | [05-ia-ux.md](./05-ia-ux.md) | Информационная архитектура + UX: иерархия, toolbar grouping, naming consistency, discoverability, 5 персон, microcopy | information architect · UX writer · product/UX lead |
| 06 | [06-code-health.md](./06-code-health.md) | Техническое здоровье: dead CSS/JS, duplicate selectors, !important pollution, hex hardcodes, inline styles, performance smells, legacy patterns | senior frontend · code health · perf engineer |

## Метод

- **Статика**: чтение `views/gantt.js`, `views/gantt/aux.js`, `views/ganttHtmlExport.js`, секций `styles.css` (~720KB grep по `gantt`/`gdt-`/`#section-gantt`), `index.html` секции `#section-gantt`, `theme.css`, `constants.js`, `my_prisma-brand/BRAND_BOOK.md`, `my_prisma-brand/tokens/`.
- **Бренд-сверка**: `BRAND_BOOK.md` (главное §3 Палитра, §4 Типографика, §6 Размеры, §7 Tone of voice, §8 Темы, §9 Motion, §12 Illegal usage).
- **Контракты CLAUDE.md**: Reactive.silent, identity-deterministic attribution, `_scrubSecrets` policy.
- **Не повторяет**: `gantt-redesign/00-SYNTHESIS.md`, `audit-2026-05-04/07-tech-views.md` §3 — каждый эксперт прочёл и расширял, а не дублировал.

## Что сделано РАНЕЕ (контекст для отчётов)

В предыдущих сессиях 2026-05-04 (в т.ч. Wave 1 cleanup из `gantt-redesign/`):
- legacy `<h2>Гант по релизам</h2>` удалён, eyebrow «СЛЕД ПУТИ · ГАНТ» оставлен
- `topbar-divider` группы PLAN/VIEW/NAV вставлены
- `role="toolbar"` + `aria-label="Действия Ганта"` на `.section-header-actions`
- мёртвые `#gantt-filters` + `renderFilters()` удалены
- эмодзи `🔒/✏/✓` в lock-badge заменены на Lucide SVG
- Cmd+K расширен на task-by-id поиск
- `Pulse` keyframe подключён к `.gantt-cell.gantt-cell-dragover` (Wave 4 livebug закрыт)
- `FocusTrap.attach` явно вшит в `requireMoveComment`
- `ctx-menu` получило `role="menu"` + `role="menuitem"` + arrow-nav + return-focus
- `.gantt-team-vis-btn` стал `<button type="button">` с `aria-expanded`

V21 pills refresh (тот же день):
- pill border убран → только 3px stripe-left
- `font-weight: 600 → 500`
- `border-radius: 6px → var(--radius)` (=12px проектное)
- hover D вариант: `background: var(--prizma-bg-tertiary)` + `box-shadow: inset 1px 0 0 var(--pill-stripe)`
- `min-width: 90px → 0`, `max-width: 200px` удалён
- 9 work-type token'ов `--prizma-worktype-*` (3 signature + 6 нейтральных)
- density третий уровень `minimal` (~22px)
- state-active glyph переведён на CSS-shape (вместо U+25CF)
- SVG-стрелки переноса токенизированы через `path.style.stroke = 'var(--prizma-worktype-be)'`
- ghost-chips на trail-row → вариант B: tinted `var(--prizma-bg-tertiary)`, без border, без opacity

## Сводный приоритет

**Критично (prod-bug / a11y-блокер / brand-нарушение видное сразу):**
- HTML-export: `${gexIcon(...)}` не интерполируется в `statusLabel` (single-quoted) → литерал в выходном HTML
- `▸/▾` regression: `textContent` затирает SVG-chevron на team-collapse toggle
- `.btn:focus-visible` отсутствует — все 12 toolbar-кнопок без видимого фокуса (WCAG 2.4.7)
- Trail-chip light theme contrast fail: FE `#3A8060` на `#F0EDE5` = 4.4:1 (WCAG 1.4.3 fail)
- `.btn:hover translateY(-1px)` нарушает reduced-motion
- `gantt-lock-status` без `aria-live` — screen reader не получает уведомления о фиксации плана

**Важно (видно сразу, blocks brand voice):**
- 5 release-цветов в 6 источниках Tailwind hex (token system готова, не используется)
- Cmd+K palette без combobox aria pattern
- naming chaos «1.20 / Релиз 1.20 / r120 / OT / Овертайм» — 4 написания
- ~25 microcopy issues (Cascade-вид, Нет данных, канцелярит в toast'ах)
- ~28 правил с font-weight 600/700/800 в окружении pill (после V21 pill — 500)

**Полировка (отложить):**
- 15+ half-pixel sizes (9.5/10.5/11.5/12.5/13.5)
- ~12 mono-селекторов используют system mono вместо JetBrains Mono
- ~80 LOC dead CSS rules
- 8 unused imports в `views/gantt.js`
- дубли селекторов (`.gantt-header`, `.gantt-team-header`, `.gantt-cell`, `.gantt-bar-multi`)
- inline-styles в JS-template'ах

## Что НЕ менять (контракты)

- **Reactive.silent** обвязки в `Storage.save / restore / syncColumnSettings`
- **Identity-deterministic attribution** через `state.employees[].{email, jiraAccountId, bitbucketLogin, confluenceAccountId}`
- **`_scrubSecrets` policy** на всех экспортах
- **V21 pills refresh** (только что сделано чисто) — pill main rule, work-type tokens, ghost trail-chips B, arrows на токенах
- **Wave 1 закрытое**: dividers PLAN/VIEW/NAV, role="toolbar", FocusTrap, ctx-menu menupattern, Pulse → cell-dragover
- **Splash-screen radial-gradient** (Northstar Emerge motion §9-10)
- **Status-pills** (signal-цвета) — semantic, не decorative
- **Vendored libs** (`libs/xlsx.full.min.js`, `libs/sql-wasm.*`)
- **`PHASE_COLORS` в `constants.js`** — оставлен для inline-style cases где CSS var() не работает (SVG markers, HTML-export). Менять только так: синхронизировать значения с `--prizma-worktype-*`, не удалять.

## Эффорт по тематическим кластерам

| Кластер | Эффорт | Impact |
|---|---|---|
| A. Critical 6 fixes | 1 день | Закрывает prod-bug + WCAG-блокеры |
| B. Toolbar a11y и naming | 1-2 дня | WCAG 2.1 AA full compliance |
| C. Tailwind→tokens release-палитра | 0.5 дня | Темо-aware рейлы, правильная dark/light |
| D. Microcopy и naming canonization | 0.5-1 день | Brand voice §7, новички перестают теряться |
| E. Code health cleanup | 0.5 дня | Снижение сложности, eslint-clean |
| F. Typography normalization | 1 день | Type-scale брендбука, 7→4 уровня иерархии |
| G. Trail-rows collapse + Empty state CTA | 0.5 дня | Игорь и Олеся главные фрустрации |
| H. Polish + minor a11y | 1 день | — |

**Суммарно**: ~6-8 дней на full sweep всех 137 findings.

## Файлы релевантные для последующих fix-ов

- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/styles.css` — основной CSS, содержит ~80% findings
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/theme.css` — light worktype tokens lines 97-105 (нужна корректировка)
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/index.html` — `#section-gantt` HTML структура, ARIA атрибуты, modal-overlay'ы
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/views/gantt.js` — main render, density toggle, Cmd+K, kb-DnD, ctx-menu
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/views/gantt/aux.js` — history modal, add-epic modal, drawPostponeArrows, bindFastTooltip
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/views/ganttHtmlExport.js` — standalone HTML export, статусы, легенда (содержит prod-bug)
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/constants.js` — RELEASE_WINDOWS, PHASE_*, GANTT_* (нужен RELEASE_LABELS канонический словарь)
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/app.js` — toast messages, FocusTrap, bindGanttPlanLock

---

**Эта серия — только аудит, без правок.** Реализация — последующими PR.
