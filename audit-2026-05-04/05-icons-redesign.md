# П5 — Иконки под брендбук Призмы (звёздное семейство)

> Дата: 2026-05-04. Источники: `BRAND_BOOK.md §5 «Иконки модулей»`, `assets/svg/modules/{kurs,sled-puti,komanda,tseli,ritualy}.svg`. Принцип V15: «без эмодзи в production UI» (`CLAUDE.md` § Принципы дизайна V15).

---

## 1. Инвентаризация эмодзи в production HTML/JS

Прогон `grep -rnE "[🔒🔓⌘▦⇕⊟✏🗑🌙☀⚡🌀⏳↻↺📋📊📈📉📁🗂📎📌🔍🔎ℹ⚠❌✅✓✗👤👥💬🤖🎯🚀🔔🔥💡⭐🌟⚙🔧🎨📝📂🏷]" --include='*.js' --include='*.html'` (без `audit-*`, `libs`, `design-audit`, `docs`, `tests`, `ai`, `my_prisma-brand`) даёт **168 production-попаданий**, из них около половины — управляющие глифы (`↺ ↻ ⌘K ▦ ⇕ ⊟ ⊞`), остальное — настоящие emoji. Полный пробег по grep сохранён в исходниках; ниже — сводка.

### 1.1 Section / module nav (sidebar)

Уже использует SVG-звёзды (`index.html:553-733`, 5 модулей × inline-SVG). Эмодзи здесь нет — это эталон, к которому нужно подтянуть остальную часть UI.

### 1.2 Topbar buttons (Реестр / Гант toolbar)

| Файл:строка | Глиф | Контекст |
|---|---|---|
| `index.html:868` | `↺` | btn-undo, «Отменить» |
| `index.html:869` | `↻` | btn-redo, «Вернуть» |
| `index.html:871` | `⚙` | «Настройки» (toolbar) |
| `index.html:873` | `↺` | btn-reset-col-order |
| `index.html:908` | `✓` | bulk-btn-done «Сделано» |
| `index.html:954` | `🔒` | gantt-lock-plan |
| `index.html:963` | `✏` | gantt-edit-mode |
| `index.html:964` | `🔓` | gantt-unlock-plan |
| `index.html:970` | `⌘K` | gantt-jump search trigger |
| `index.html:974` | `▦` | gantt-mode (Default/Overview) |
| `index.html:975` | `⇕` | gantt-density |
| `index.html:976,978,977` | `⊟ ↻ ↺` | expand-all / undo-redo (toolbar dup) |
| `index.html:1058` | `🗑` | employees-delete-all |
| `index.html:1196` | `⚙` | assistant-btn-settings |
| `views/employees.js:177` | `▦` | view-mode toggle (cards) |
| `views/errorsView.js:92` | `🗑` | errlog-clear |
| `views/aiView.js:254,321` | `↺` | refresh AI block |
| `views/aiCeoView.js:342` | `↺` | refresh AI |
| `app/promptsEditor.js:60` | `↺` | reset prompt-category |

### 1.3 Dropdown / settings-nav items

| Файл:строка | Глиф | Контекст |
|---|---|---|
| `app/appSettings.js:189-192` | `📂 ⚡ 🌙 ⚙` | вкладки настроек: Файлы / Симуляция / Тема / Настройки |
| `app/actionLayer.js:29-44` | `🔧 🤖 📋 ✅ 👤 ⚡ 💬 🔍` | каждая ACTION (8 шт.) имеет emoji-icon в каталоге |
| `app/actionLayer.js:51` | `🎯 🗓 📋 👥 ⚡ 🛡 🏷 📤` | CAT_ICONS — 8 категорий действий |
| `app/promptsEditor.js:92` | `🔍 💡 ⚡ 📊 🗺 📋 💬` | category-icon для LLM-промптов |
| `app/onboarding.js:36-38` | `⚙ 🌙/☀️ ⚡ 🌀 🔍 💡 ⚡ 📊 🗺 📋` | подписи в onboarding-туре |

### 1.4 Inline в текстах / badge / chip / status-pill

| Файл:строка | Глиф | Контекст |
|---|---|---|
| `views/timeline.js:68,120,163,193,210,212` | `✅ ⚠` | done-badge / risky-badge / chip-done |
| `views/dashboard.js:152` | `⚠️` | overload-flag в progress-card |
| `views/employees.js:432` | `⚠️` | overloaded-employee badge |
| `views/kanban.js:100` | `🟢 ✅ 🟡 ⚠️` | PR-status: merged/approved/open/none |
| `views/renderHelpers.js:48,52` | `⚠ ✅` | dependency-warn / doneBadge |
| `views/registry.js:725` | `📌` | column pin-toggle |
| `views/integrationsView.js:133-352` | `⏳ ✓ ✗` | проверка подключения интеграций (5×) |
| `views/ganttHtmlExport.js:188,311,400,540,1021,1028-1030,960` | `✅ ✓ 🌙 ☀ 📋 👥 🔒` | self-contained HTML-экспорт |
| `views/gantt.js:469,635,636,640,645` | `✓ 📈 📊 🚀 📝` | type-icon (BE/FE/QA/docs) |
| `views/metrics.js:470-480` | `📈 📊 🚀 📝` | те же type-icon (дубль) |
| `views/history.js:16-19,67` | `📊 🤖 ⚙️ 🗑` | history-categories |
| `chat/chatEngine.js:55-576` | `👥 📋 📊 🏷 👤 ⚠ ✓ ✅ ⚠️ 💡 🔍 🚫` | persona, action-buttons, list-icons (~30 occurrences) |
| `chat/chatExplain.js:103,159,160,242` | `✓ 🔍 📋 ⚠` | suggestion-buttons |
| `chat/chatActions.js:127` | `✓` | apply-action label |
| `chat/chatAlerts.js:66,110` | `⚠️ 🔥` | alert severity |
| `chat/chatUIRenderer.js:72,131,184,283` | `✓ 🔍 💡 📋 ↺ ⚠` | step-marker, intent-badge, retry-btn, citation-warn |
| `app/llmAssistant.js:983,1003` | `⚠ ⚙` | error-state в чате |
| `app/storageSettings.js:49-132` | `✓ ✗ ⏳ 🗑 ↻` | SQLite-status |
| `views/insightsDashboards.js:227` | `⚠` | tlead-warning baner |
| `app/prizmaUI.js:31` | `📁 📊 👥 🤖` | комментарий «заменяет legacy emoji», но они всё ещё в коде других файлов |

### 1.5 Welcome-screen / modal

| Файл:строка | Глиф | Контекст |
|---|---|---|
| `index.html:114,215` | `↻` | welcome-btn-arrow (имеет `aria-hidden="true"`, ок) |
| `index.html:368` | `🔒` | в `<h3>` модального диалога «Зафиксировать план» |

---

## 2. Таблица замен (emoji → SVG)

Принцип: **разделы / модули** уезжают на 5 SVG-звёзд из `assets/svg/modules/`. **Кнопки и статусы** — на Lucide-style line-glyph 1.5px stroke (24px viewBox, scale 16/20/24px).

### 2.1 Section nav (уже сделано — эталон)

| Раздел | Текущее | Эталон | Размер |
|---|---|---|---|
| Курс / Дашборд | inline SVG-звезда | `assets/svg/modules/kurs.svg` | 14×14 (head), 16×16 (sub-nav) |
| След пути / Реестр | inline SVG | `sled-puti.svg` (звезда + затухающие точки) | 14/16 |
| Команда / Сотрудники | inline SVG | `komanda.svg` (звезда + 3 спутника) | 14/16 |
| Цели / AI-CEO | inline SVG | `tseli.svg` (звезда внутри концентрических кругов) | 14/16 |
| Ритуалы / Калибровка | inline SVG | `ritualy.svg` (две звезды в диалоге) | 14/16 |

### 2.2 Topbar / toolbar buttons (заменить)

| Текущий emoji | Целевой SVG-glyph | Lucide-имя | Размер |
|---|---|---|---|
| `🔒 Зафиксировать план` | `lock.svg` | `lock` | 16 |
| `🔓 Снять фиксацию` | `lock-open.svg` | `unlock` | 16 |
| `✏ Режим редактирования` | `pencil.svg` | `pencil` | 16 |
| `🗑 Удалить всех / Очистить` | `trash.svg` | `trash-2` | 16 |
| `⚙ Настройки` | `gear.svg` (line) | `settings` | 16 |
| `↺ Отменить / ↻ Вернуть` | `corner-arrow.svg` (left/right) | `undo-2 / redo-2` | 16 |
| `↻ Сбросить / Перенести` | `refresh.svg` | `rotate-cw` | 16 |
| `⌘K Поиск` | `command-icon.svg` + `<kbd>K</kbd>` | `command` | 14 + текст |
| `▦ Mode` | `layout-grid.svg` | `layout-grid` | 16 |
| `⇕ Density` | `chevrons-up-down.svg` | `chevrons-up-down` | 16 |
| `⊟ Свернуть всё / ⊞` | `minus-square / plus-square` | `minus-square` | 16 |
| `📌 Закрепить колонку` | `pin.svg` | `pin` | 14 |
| `📂 Файлы` | `folder.svg` | `folder` | 16 |
| `🌙 / ☀ Тема` | `moon.svg / sun.svg` | `moon / sun` | 16 |
| `⚡ Симуляция` | `zap-line.svg` (1.5px) | `zap` | 16 |
| `🌀 Демо-данные` | small breathing star (брендбук-loader L1) | — | 14 |
| `🔍 Поиск / фильтр` | `search.svg` | `search` | 16 |
| `💬 Заметка` | `message-square.svg` | `message-square` | 16 |
| `🔧 Изменить тип` | `wrench.svg` | `wrench` | 16 |
| `👤 / 👥` | `user.svg / users.svg` | `user / users` | 16 |
| `📈 / 📊` | `trending-up / bar-chart-3` | line-chart family | 16 |
| `🚀 Внедрение` | `rocket-line.svg` (если уж нужен) или нейтральный `arrow-up-right` | `rocket` | 16 |
| `📝 Документация` | `file-text.svg` | `file-text` | 16 |
| `🤖 Авто / AI` | `cpu.svg` или `sparkles.svg` (1.5px) | `sparkles` | 16 |
| `🎯 Все категории` | `crosshair.svg` | `crosshair` | 16 |
| `🗓 Релизы` | `calendar.svg` | `calendar` | 16 |
| `🛡 Риски` | `shield.svg` | `shield` | 16 |
| `🏷 Метки` | `tag.svg` | `tag` | 16 |
| `📤 Экспорт` | `upload.svg` | `upload` | 16 |
| `🗺 План` | `map.svg` | `map` | 16 |
| `💡 Объяснение` | `lightbulb.svg` | `lightbulb` | 16 |

### 2.3 Pictograms статусов (●/▲/■, ✓/✗/⚠, 🟢🟡🔴) → signal-color circles

Брендбук §3.3 «Signal — семантические цвета» допускает только **5 ролей**: «На курсе», «Дрейф», «Сбился с курса», «Информация», «Инсайт». Все статус-emoji должны мапиться так:

| Текущее | Семантика | Замена |
|---|---|---|
| `🟢 / ✅` | На курсе / Done | `<span class="signal-dot signal-on-course"></span>` (цвет `#7FE8B5` dark / `#0F8A5F` light) |
| `🟡 / ⚠ / ⚠️` | Дрейф / Warning | `signal-drift` (`#FFB347 / #B5670A`) |
| `🔴 / 🔥 / 🚫` | Сбился с курса / Critical | `signal-off-course` (`#FF6B6B / #C13838`) |
| `ℹ / ⏳` | Информация / pending | `signal-info` (`#6EC1E4 / #1F6B96`) + `inlinePulseLoader` (брендбук §11 L1) |
| `💡 / 🌟` | Инсайт | `signal-insight` (`#B084CC / #6B4488`) |
| `✓ Сделано` (button-label) | success-state | заменить на line-glyph `check.svg` без цвета — это **действие**, а не статус |

Ключ: `kpi-red/yellow/green` (`styles.css:1221-1227`) уже завязаны на `--success/--warning/--danger`, остаётся подменить hex на signal-палитру брендбука и удалить дополнительные `bd-kpi-*` (`styles.css:11456-11460`) с дублирующими hex.

### 2.4 Минимальные размеры (брендбук §6)

| Контекст | Размер | Stroke |
|---|---|---|
| Inline в тексте (next to ФИО, релиз) | **12 px** (только favicon-вариант звезды для модулей; line-glyph не используется — слишком тонко) | — |
| Sub-nav, chip-icon, badge | **16 px** | 1.5 px |
| Toolbar button, card-action | **20 px** | 1.5 px |
| Sidebar module-icon, hero | **24 px** | 1.75 px |
| Empty-state, splash | **32+ px** | 2 px |

Действующие inline-SVG в sidebar (14×14) **меньше брендбукового 16×16-минимума** — поднять до 16 при следующей правке.

---

## 3. a11y — `aria-label` для каждой замены

Любая чисто-glyph-кнопка обязана иметь `aria-label` (или видимый текст), `<span class="visually-hidden">` для screen-reader, и `aria-hidden="true"` на самом SVG (чтобы AT не зачитывал shape).

| Кнопка | Обязательный `aria-label` |
|---|---|
| `btn-gantt-lock-plan` | «Зафиксировать план релиза» |
| `btn-gantt-unlock-plan` | «Снять фиксацию плана» |
| `btn-gantt-edit-mode` | «Включить режим редактирования» |
| `btn-undo / btn-redo` | «Отменить последнее действие» / «Вернуть отменённое» |
| `btn-registry-settings` | «Настройки реестра» |
| `btn-reset-col-order` | «Сбросить порядок столбцов» |
| `btn-employees-delete-all` | «Удалить всех сотрудников» |
| `btn-gantt-jump` | «Поиск команд и эпиков (Cmd+K)» |
| `btn-gantt-mode` | «Переключить режим: детальный / обзор» |
| `btn-gantt-density` | «Плотность строк» |
| `btn-gantt-expand-all` | «Свернуть/развернуть все команды» |
| Любой `chip` со signal-точкой | роль `status` + `aria-label="Статус: <значение>"` |
| `kpi-card` (`views/dashboard.js:106`) | роль `button` + `aria-label="${label}: ${value}, открыть подробнее"` |

Текущее состояние — `title=""` есть, но `aria-label` нет ни на одной перечисленной кнопке (`index.html:868-978`). Это нарушение WCAG 2.1 SC 4.1.2 (Name, Role, Value).

### Дополнительно

- Иконкам-«статусам» (signal-dot) добавить `<title>` внутри SVG для tooltip, плюс `role="img"` на span-обёртке.
- Loader-«звёздочка» брендбука (§11 L1/L2) — `aria-live="polite"` + `aria-busy="true"` на родителе.
- В onboarding (`app/onboarding.js:36-38`) emoji в тексте — это контентовый emoji; их можно оставить как **текст**, но на кнопках UI заменить.

---

## 4. Roadmap (рекомендации)

1. **W1.** Создать `assets/svg/icons/` (Lucide-derived 1.5 px stroke) — 30 line-glyph файлов из таблицы §2.2.
2. **W1.** Удалить `app/actionLayer.js:29-51 icon:'…'` emoji-поля → ввести `iconKey:'wrench'` + helper `getIcon(name, size)`.
3. **W2.** Заменить `views/gantt.js:635, views/metrics.js:470` (дубль type-icon-mapping) на единый `getTypeIcon(category)` в `app/prizmaUI.js`.
4. **W2.** Перевести KPI-карточки и chip-status на signal-палитру (`tokens/colors.json` → `styles.css` через CSS-vars). Удалить hex-локализованные `bd-kpi-*`, `jp-chip-done`.
5. **W3.** Прокинуть `aria-label` во все toolbar-кнопки (`index.html`, `views/*.js`).
6. **W3.** Запретить emoji в production через ESLint custom-rule (`eslint-rules/`) — паттерн из шапки grep как regex.

Файл-якоря для PR: `assets/svg/modules/*.svg`, `assets/svg/icons/*.svg` (новая папка), `app/prizmaUI.js`, `index.html` (toolbar), `views/*.js` (chip-replacements), `tokens/colors.json`.
