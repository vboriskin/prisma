# Codebase — UX / visual / brandbook compliance

> UX-инженер аудит. Consistency, a11y, mobile, brandbook (§3.3 signal-палитра, §11 calm-loader, §12 no emoji, §4 mono-tabular numerals).
> Дата: 2026-05-07

| ID | Sev | File:line / Element | Issue | Brandbook ref | Fix |
|---|---|---|---|---|---|
| **E1** | HIGH | `views/errorsView.js:131` — `errlog-empty` | Эмодзи `✨` в production-empty-state («Записей пока нет — это хорошо ✨») | §12 no-emoji | Заменить на `prizmaEmptyGlyph()` или `Icons.sparkles` |
| **E2** | HIGH | `app/promptsEditor.js:74,93,112` | `💾 Сохранить`, dict `🔍 💡 ⚡ 📊 🗺 📋 💬`, `✓ Сохранено` рендерятся в UI промпт-редактора | §12 | `Icons.save / search / lightbulb / bolt / chart / map / clipboard / chat / check` |
| **E3** | HIGH | `app/onboarding.js:16,21,23,27,30,36,37,38` — все step.text | Гид-онбординг показывает `⚡ ⚙ + ⛶ ▾ ⚠ 📡 📄 🌙 ☀️ 🌀 🔍 💡 📊 🗺 📋` пользователю | §12 | Перевести в inline-`<svg>` через `Icons.*`, либо текстовые подписи |
| **E4** | MED | `views/gantt.js:627,2225,2254,2258,2261` | UI-glyphs `✕ Выйти`, `⛶`, `✎`, `+`, `✕` в context-menu | §12 (текст-glyph не emoji, но §3 line-glyph hygiene) | Унификация через `Icons.x / maximize / pencil / plus` |
| **E5** | MED | `views/ganttHtmlExport.js:425` + `views/gantt.js:559` + `styles.css:2558` | `✓` glyph в Gantt-pill state | §11/§12 | `styles.css:18896` уже мигрирует на inline-SVG — закончить миграцию (legacy `content:'✓'` ещё активен на стр. 2558) |
| **E6** | LOW | `views/renderHelpers.js:61` | `🔗` префикс в Jira-tag | §12 | `Icons.link` |
| **E7** | HIGH | `app/llmAssistant.js:1150,1174` | Сообщение об ошибке с `⚠`/`⚙` пользователю | §12 + §3.3 (warning через `signal-warning`-dot) | Заменить glyph на `Icons.alert` + использовать класс `signal-dot warning` |
| **E8** | LOW | `index.html:1576` | Заголовок настроек `🧠 Промпты по типам команд` | §12 | `Icons.brain` или без glyph |
| **S1** | HIGH | `styles.css:11756` `.ob-loading-spinner` + `@keyframes ob-spin { to {transform:rotate(360deg)} }` | Классический rotating CSS-spinner для obsidian-маскота | §11 calm-loader | Заменить на `prizma-loader-inline` / `prizmaLoaderMark` (есть в `theme.css:196`) |
| **S2** | MED | `styles.css:4131` `@keyframes pieSpinIn` (`rotate(-18deg)`) | Pie-chart spin-in анимация | §11 | Заменить на `opacity`-fade или `breathe` |
| **G1** | **CRIT** | `styles.css:8677` `.ai-quality-bar-fill` `linear-gradient(90deg,#ef4444,#f59e0b,#22c55e)` | Светофор-градиент (red→amber→green) внутри прогресс-бара | §3.3 signal-only / no rainbow | Перевести в дискретные сегменты по `--prizma-critical / warning / success` |
| **G2** | **CRIT** | `styles.css:5350` градиент `#a78bfa,#ec4899` (виолет/розовый) | Не-signal цветной gradient в badge | §3.3 | Заменить на `var(--prizma-information)` solid |
| **G3** | HIGH | `styles.css:4064` `linear-gradient(90deg,#6366f1,#14b8a6)` summary-super-bar | Indigo→Teal gradient | §3.3 | Solid `--prizma-information` или `--prizma-success` |
| **G4** | HIGH | `styles.css:8869` `linear-gradient(180deg,#f59e0b,#dc2626)` nav-item-ceo accent | Amber→red strip — alarm-look, не «спокойный» | §3.3 + §1 calm | `var(--prizma-warning)` solid |
| **G5** | MED | `styles.css:3278-3292,5711,5886-5917,5991,6043,7288-7289,7499` | Хардкоженные `#ef4444 #f59e0b #22c55e #dc2626 #6366f1` напрямую в bg/color | §3.3 + design-token discipline | Заменить на `var(--prizma-critical / warning / success / information)` |
| **G6** | LOW | `styles.css:2891,4120,4252,4292` slabs `linear-gradient(...,#ffffff,#f8fafc)` | Технически monochrome но не через token | §3 | `color-mix(in srgb, var(--surface-1) ...)` |
| **N1** | LOW | global | `font-feature-settings:"tnum"` уже глобально на `body` (`styles.css:217`) и продублирован 84+ местах | §4 OK, но redundant | Удалить дубликаты после `:root`-инжекции |
| **F1** | MED | `:focus-visible` встречается 72×, но не для всех `.btn-ghost / .gdt-pill / context-menu rows / .ts2-sd-row` | Часть интерактивов без видимого focus-ring | WCAG 2.4.7, §A11y | Глобально: `:where(button,a,[role=button],[tabindex]:not([tabindex="-1"])):focus-visible{outline:2px solid var(--prizma-focus);outline-offset:2px}` |
| **A1** | HIGH | `index.html:1060` `<button id="bulk-btn-deselect">✕</button>` без `aria-label` (только `title`) | Icon-only button, screen-reader читает «✕» | WCAG 4.1.2 | `aria-label="Снять выделение"` |
| **A2** | MED | `views/gantt.js:627,2225` контекст-меню row glyphs `✕`/`✎` | Glyph-only без accessible name | WCAG 4.1.2 | `aria-label`/visually-hidden текст |
| **EM1** | HIGH | `views/dashboard.js:353`, `views/metrics.js:306,337,350,362`, `views/timeline.js:104,144`, `views/teamHealthDashboards.js:203` | Голый `<div class="text-muted">Нет данных</div>` без glyph/CTA | UX empty-state pattern (§1 calm) | `<div class="empty-state">${prizmaEmptyGlyph()}<div class="empty-title">…</div><div class="empty-sub">…</div></div>` |
| **C1** | MED | `styles.css:2891` `linear-gradient(135deg, var(--prizma-information-bg), #f0f7ff)` | Mixing token + raw hex | §3 | `#f0f7ff` → `color-mix(...,var(--prizma-information-bg)...)` |
| **MB1** | MED | Total 24 `@media max-width` rules в `styles.css` — `375px` явно отсутствует | Нет ad-hoc fix-ов под 375px (iPhone SE) | Mobile §responsive | `@media (max-width:375px)` overrides для `topbar-actions`, `dash-empty-actions` (column-stack), `gdt-pill` (compact mode) |
| **MB2** | MED | `views/gantt.js` Gantt-grid (table-layout) | Не известно про horizontal scroll-wrapper на 768px | Mobile | `overflow-x:auto` обёртку + `min-width:768px` для `.gdt-grid` |
| **RM1** | OK | `prefers-reduced-motion` встречается 31×, покрытие хорошее | — | §11 | Audit-only: `obsidian/obsidian.css:943` уже корректно — но `ob-spin` (S1) надо обнулить отдельно |
| **WCAG1** | HIGH | `styles.css:5711` `.btn-danger { background:#fef2f2; color:#ef4444 }` | `#ef4444` на `#fef2f2` ≈ 4.0:1 — ниже AA для нормального текста (4.5:1) | WCAG 1.4.3 | Понизить text до `#b91c1c` (≈ 6.1:1) или `var(--prizma-critical-text)` |
| **WCAG2** | MED | `.text-muted` (часто `var(--text-3)`) на `var(--surface-2)` | Возможный <4.5:1 для small body | WCAG 1.4.3 | Поднять `--text-3` минимум до contrast-ratio 4.5 на bg-2/3 |

## Сводка
- **Критично (Critical/High):** E1–E3, E7, S1, G1–G4, A1, EM1, WCAG1 — 11 нарушений
- **Mid:** E4, E5, S2, G5, F1, A2, MB1, MB2, C1, WCAG2 — 10
- **Low/OK:** E6, E8, G6, N1, RM1 — 5

**Топ-3 фикс-приоритета:**
1. **G1 (rainbow gradient в `.ai-quality-bar-fill`)** — самое грубое нарушение §3.3, видно на главном AI-экране.
2. **S1 (ob-spin для obsidian-маскота)** — маскот только что подключён, его loader противоречит §11. Нужно `prizma-loader-inline`.
3. **EM1 (голые «Нет данных»)** — на 5+ экранах, нарушает UX-pattern и calm-tone §1.

**Системные рекомендации:**
- Линт-правило ESLint на emoji-regex в `views/**` и `index.html` (есть `eslint-rules/` — добавить).
- Linter / stylelint-rule запрет hex-литералов в `styles.css` вне `:root`/`theme.css`.
- Глобальный `:focus-visible` через `:where()` устранит F1 одной строкой.
