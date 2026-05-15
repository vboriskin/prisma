# AUDIT_ARTDIRECTION.md — Этап 4 из 14

> Арт-дирекция и визуальный язык. Не «правильно ли построено» (это вёрстка/этап 3), а «передаёт ли продукт нужное ощущение, единый ли это вкус».
>
> Корень: `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design_v2/`
> Брендбук: `my_prisma-brand/BRAND_BOOK.md`. Маскот: `obsidian/obsidian.css` + sprite.
> Основные правила: `docs/spine-pill.md`, `docs/brand.md`. Канонические helpers: `app/prizmaUI.js`.

---

## Резюме арт-директора (TL;DR)

Призма как продукт **визуально расколота надвое**:

1. **Брендовая оболочка** (topbar, splash, hero, page-headers, маскот, mascot motion, prizmaLoader) — собрана с любовью, ощущается как один продукт со вкусом, dark-first, тихий и точный. Это 15% поверхности.
2. **Data-views** (Гант, Реестр, Метрики, BlackDashboard, Pulse, Сканнер, AI) — внутри плотная корпоративная сетка, в которой Призма опционально сверху. Брендбук применён на 60–70%: hero есть, signal-dot'ы есть, но плотность — «средне-корпоративный enterprise», а не «компас». Северной звезды как мысли — нет, есть как декорация.

Самое слабое место — **AI-разделы (10/11/13)**: визуально это плоские data-плашки. Никакого «думания», никакого «зеркала», никакого процесса (streaming/пульса/cursor). У продукта нет ощущения «AI-second-brain», есть ощущение «отчёт на питоне».

Самое сильное место — **маскот Обсидиан** + **splash + breathe-mark в topbar**: это работает, держит характер.

«Чёрный дашборд» — название, не визуальная метафора. Скин такой же как у всех. Потенциал на high-stakes oversight-режим неиспользован.

Tone-of-voice брендбука («спокойный · точный · тёплый · уверенный») в hero/loader соблюдён, в плотных data-views рассыпается на «средне-серьёзный b2b-tool».

---

## Формат находок

`раздел | файл:строка | severity | проблема | решение | трудозатраты`

severity: `critical` (расходится с брендом фундаментально) / `high` (видимая утечка) / `medium` (заметно, но не доминирует) / `low` (поправить чтобы было чисто).
трудозатраты: S (≤4ч) / M (½–2 дня) / L (3+ дня).

---

## 1. Дашборд

| | | | | | |
|---|---|---|---|---|---|
| 1 | `views/dashboard.js:128-148` | high | Hero даёт «Курс квартала / 57.7%» — это идеальный момент создать «компас-метафору», но KPI-число просто крупный текст рядом со звездой; звезда не указывает, не отклоняется, не реагирует на drift. Метафора брендбука «компас» не материализована — просто «звёздочка слева от %». | Hero-звезда должна жить от данных: лёгкое отклонение оси (rotate -2..+2°) при drift, signal-pulse при off-course (брендбук §9 Pulse — уже описан как состояние, но не привязан к hero). При on-course — чистый breathe. | M |
| 2 | `views/dashboard.js:213-264` | high | Action-block «Что требует курса сегодня» — визуально это three flat cards со spinning ratio равной всем остальным KPI-плиткам. Нет иерархии: action-block, KPI-grid, signals, release-breakdown, weekly, overload — все одного веса. Глаз не понимает «сюда смотреть в первую очередь». | Action-block должен быть ×1.6 по плотности и иметь больше пустоты вокруг. Остальные блоки — ×1.0. Weekly + overload в light-grade второго ряда (через `--text-3` лейблы). | S |
| 3 | `views/dashboard.js:399-438` | medium | KPI-grid из 12 плиток (`.kpi-card`) — это «мозаика equal weight». Нет dominant carrier — выглядит как admin-панель Sberworks 2017, не как «компас». | Свернуть в 4 главных + collapse «остальные KPI» (показать по запросу). Брендбук §3 пропорций «5% signal» — соблюдается только если 80% плиток нейтральные; сейчас наоборот. | M |
| 4 | `styles.css:9310, 10279` | medium | `.skeleton` использует `linear-gradient(90deg, ...)` — формально это shimmer внутри loader (брендбук §11 L3 разрешает gradient в shimmer), но **только** один. В проекте 2 skeleton'а с разными gradient-параметрами + ещё 4 декоративных gradient в pp-loader / kpi-card-blue. Решение брендбука «без gradients кроме L3 shimmer» нарушено. | Унифицировать: один глобальный `.skeleton` (L3) с одним shimmer. Удалить декоративные gradient'ы в `.pp-loader` (`styles.css:11333,11363,11499,11758`) — заменить на solid `var(--card)` + 3px stripe-left. | M |
| 5 | `views/dashboard.js:300-394` | low | Блок «Сигналы» (3 lists × severity high/medium/low) — рендерится как одинаковые `.insight-list` без визуальной разницы между critical и low. Только цветной badge справа несёт severity. Глаз не сканирует — нужно читать. | Critical-list — left-stripe `--prizma-off-course`. Medium — `--prizma-drift`. Low — без stripe (нейтральный). Это применит spine-pill §3 правильно. | S |

## 2. Метрики

| | | | | | |
|---|---|---|---|---|---|
| 6 | `views/metrics.js:251-414` | high | Шесть `metrics-grid-2/3` блоков подряд (pie, sla, teams, roles, scope, types, dep, people, balance, health, ring, trend) — это 12 карт одного веса. Density=максимум, иерархия=ноль. Это ровно то, что брендбук определяет как «admin-панель» (антипаттерн §1). | Сгруппировать в 3 «room»-блока: «Распределение» (pie+scope+types), «Команды и люди» (teams+roles+balance+people), «Тренды» (sla+trend+ring+health). Внутри room — single-column scroll. Между room — 32px пустоты + caps eyebrow. | M |
| 7 | `views/metrics.js:401-413` | medium | «Контрольный круг» — это `conic-gradient` с 4 зонами (прогресс/риски/блокеры/запас). Хорошая идея «четырёхсекторный compass», но цвета прозвонить не получается: information (синий) / off-course (красный) / drift (жёлтый) / text-tertiary (серый) — сразу 4 семантических signals в одном круге, без иерархии. Глаз видит pie, не радар. | Двухуровневый радар: внутреннее кольцо — прогресс solid green, внешнее кольцо stroke — drift/off-course нагрузка. Серый «запас» убрать (это просто «100 минус остальное», не нужен дополнительный сектор). | M |
| 8 | `views/metrics.js:266-271` | low | Pie с conic-gradient + цвет-точки в легенде — стандартный chart, но релизы получают цвет signal-token'ов (information/on-course/drift/off-course). Это путает: 1.20 не «информационная» — это нейтральный релиз. Signal-цвета должны нести смысл по брендбуку §3, не быть декоративными. | Релизы — нейтральная серая шкала разной светлоты (`--prizma-text-secondary` → `--prizma-text-tertiary`). Signal-цвета сохранить только для overtime/risk. | S |

## 3. Реестр

| | | | | | |
|---|---|---|---|---|---|
| 9 | `views/registry.js:139-158` | medium | Header реестра — sticky thead с 20+ колонками, всё одного веса. После V17 P9 F7 шрифт уменьшен до 10px CAPS — это правильный spine-eyebrow. Но pin-button + sort-icon + resize-handle в каждой ячейке создают «техно-grid» эффект. Брендбук просит «спокойствие важнее эффектов» — здесь спокойствия нет, есть density. | Уменьшить визуальный вес pin-кнопки: показывать только on-hover (текущий иконка появляется только при `pinned` или hover). Resize-handle — невидимый по умолчанию, hover-state только. | S |
| 10 | `views/registry.js:120-129` | low | `row-colored` использует `Utils.hexToRgba(row.rowColor, 0.16)` — пользователь выбирает hex, не из палитры. Это даёт «cyber-rainbow» эффект если пользователь раскрасит 5 строк в 5 цветов — теряется dark-first монохром. | Ограничить выбор 6 signal-приглушёнными оттенками из брендбука §3 (on-course-bg / drift-bg / off-course-bg / information-bg / insight-bg / neutral). Свободный hex-picker — снять. | S |

## 4. Гант

| | | | | | |
|---|---|---|---|---|---|
| 11 | `views/gantt.js:1036, 1106, 1487` + `constants.js:96-100` | high | `PHASE_COLORS` — 9 hardcoded hex (`#6A5E78, #5A5A6E, #2C5F88, #3A8060, #8A6428...`). Это самый видимый цветной элемент Ганта (pills работ). Палитра — вне signal-системы брендбука: серовато-коричневые тона, но НЕ `--prizma-worktype-*` token'ы (хотя `PHASE_COLOR_TOKENS` существует рядом). Inline-export Ганта (HTML) использует hex (комментарий объясняет — без подключения theme.css). Это создаёт «два разных Ганта» — light в браузере на токенах, экспорт на hex. | Привести экспорт к light-варианту брендбук-палитры точно (брендбук уже даёт hex для каждого worktype). Внутри браузера — всё через `var(--prizma-worktype-*)`. Audit-комментарий обновить. | M |
| 12 | `views/gantt.js:1058-1075` | medium | Team-row: `hsl(${hue},58%,52%)` — hash-color rail слева. Эта формула даёт 6+ ярких цветов rainbow на одном экране при 6+ командах. Брендбук §3 «5% signal» нарушен — color = identity, не семантика. | Rail per team должен быть **не** rainbow. Брендбук решает identity иконой/инициалами + neutral grey rail. Если нужно отличать команды — короткое 2-letter monogram + 1px тёмная вертикальная линия. | M |
| 13 | `views/gantt.js:1014-1023` | low | Per-team capacity sparkline (5 vertical bars в team-label) — хорошая идея, но bar'ы окрашены `var(--release-r12X-color)` (`information/on-course/drift/off-course/text-tertiary`). 5 разных signal-цветов в одной 16×40px sparkline создают «свет от ёлки», а не индикатор перегруза. | Sparkline — нейтрально-серые bars, **только** overload-bar получает `--prizma-off-course`. Это превращает «5 цветов всегда» в «1 цвет когда плохо». | S |

## 5. История

| | | | | | |
|---|---|---|---|---|---|
| 14 | `views/history.js:19-26, 76-83, 145` | low | Category-color пятна: `var(--prizma-information)` (data), `--prizma-insight` (ai), `--prizma-on-course` (view), `--prizma-drift` (system). Эти токены — semantic signals по брендбуку §3 «только статус курса». «История» — нейтральный системный экран; раздавать ему 4 разных signal-цвета — десемантизация. | Все категории — нейтральный grey icon в `--prizma-text-secondary`. Active/selected — `--prizma-information` (как информация про действие). Это делает «historical» feeling. | S |

## 6. Таймлайн

| | | | | | |
|---|---|---|---|---|---|
| 15 | `views/timeline.js:44-53` | critical | Hardcoded hex палитра `_wtColors`: `#3b82f6 backend, #22c55e frontend, #a855f7 testing, #f97316 analytics, #fb923c, #06b6d4, #84cc16, #64748b, #ef4444 hotfix`. Это **другая** палитра чем `PHASE_COLORS` в Ганте (там приглушённые корпоративные тона) — Tailwind-rainbow. Один продукт, два worktype-цветовых языка. Визуально Timeline и Gantt выглядят как два разных приложения. | Заменить на `PHASE_COLOR_TOKENS` (уже существует). Если SVG-inline нужен hex — fallback из `PHASE_COLORS` (light brand-palette). | S |

## 7. Сотрудники

| | | | | | |
|---|---|---|---|---|---|
| 16 | `views/employees.js:255-260` | medium | KPI summary cards: 4 карты — neutral / on-course / off-course / information. Это semantic-mix без логики: «Готовы в будни» — green, «С OT днями» — red. На light-весах фон-плитки будут красным/зелёным. Брендбук §3 — signal-цвет должен быть точечным (5% площади), не как фон карты. | KPI-карты нейтральные (`--card`), значение цветное только когда есть отклонение. На norm — нейтральный текст. | S |
| 17 | `views/employees.js:182-188` | low | Toggle «Карточки / Таблица» — стандартные кнопки с иконкой. Это брендово-нейтрально, но в светлой теме это «обычный b2b switch». Брендбук просит spine-pill: active state — 3px stripe-left или bottom, не filled. | Active toggle — `box-shadow: inset 0 -3px 0 var(--prizma-information)`. Inactive — без фона. | S |

## 8. Перегрузка

| | | | | | |
|---|---|---|---|---|---|
| 18 | `views/teamHealthDashboards.js:172-258` | high | BurnoutWatchtower — 4 column-list'а одного веса: «After-hours», «Reviewer overload», «Idle reviewers», «Specialists». Это «manager-dashboard для тимлидов», но визуально — 4 одинаковые таблицы как в Pulse. Брендбук tone-of-voice §7 «спокойный, не тревожный». «After-hours 50%+» сейчас — просто красная точка справа в строке. Не передаёт «мы заметили, поговорите 1:1» (то что говорит warning-banner выше). | Карточный layout: 1 крупная карта на главный сигнал (top after-hours person + sparkline недели) + 3 secondary в 1 ряд. Передавать «зеркало» tone — нет тревоги, есть наблюдение. | L |

## 9. Здоровье компонентов

| | | | | | |
|---|---|---|---|---|---|
| 19 | `views/teamHealthDashboards.js:127-170` | medium | Component health: 2 column-list'а («Компоненты», «Hot files»). Bus factor `bf=1` — один человек точка отказа. Сейчас это `ts2-sd-bad` (красная точка). Это критичная info, но текст узкий — «bf=1» не читается без объяснения. | Bus-factor — крупный mono-num визуальный, hover-tooltip объясняет «знание у 1 человека». Можно добавить мини-аватар-сетку (3 человека → 3 точки, 1 заполнена). | M |

## 10. AI CEO

| | | | | | |
|---|---|---|---|---|---|
| 20 | `views/aiCeoView.js:271-294` + `ai/aiCeoRenderer.js:130-149` | critical | AI CEO выглядит как **обычный дашборд** с заголовком «AI CEO». Hero: score 56% + label «PROJECT UNDER RISK» + 2 кнопки + 3 cause-точки. Никакого визуального сигнала «это думающая система». Кнопка «AI» (refresh) — стандартный icon-button. Чип статуса `ceo-ai-chip-enhanced/fallback` (line 405) — текст «AI · 14:32» / «Rule-based · AI недоступен» — крошечный, не передаёт что Призма буквально только что подумала. | AI hero нуждается в визуальном сигнале «второй мозг»: разовый пульс insight-цвета (брендбук signal `Insight #B084CC`) при обновлении, мягкое breathe-glow на score-ring пока «думает», explicit «думаю…» frame с маскотом в ls-thinking. Сейчас никакого AI-feel — это просто rule-based отчёт с кнопкой «обновить». | L |
| 21 | `ai/aiCeoRenderer.js:48-73` | high | `emojiToBrandIcon` — runtime-маппер emoji→signal-dot/SVG. Сам факт его существования говорит: data-источники (`aiCeoFallback.js`) до сих пор инжектят emoji как icon-поле в `cards`/`hardTruths`/`actionFeed`. Маппер ловит 🔴🟡🟢🚫📉⚡🔥 и т.п., НО fallback на «unknown emoji → пустая строка» — то есть любая несовпавшая иконка просто исчезает. Это data-driven, но visual-fragile. | Перевести icon-ключи на названия Lucide-иконок прямо в data (`crosshair, alert-triangle, trending-down, hourglass`), как это уже сделано в `app/icons.js`. Эмоджи в data удалить полностью (CLAUDE.md §«Без эмодзи» применить и к data, не только к UI). | M |
| 22 | `ai/aiCeoFallback.js:264-291, 349, 366-376` | high | В `aiCeoFallback.js` живут hardcoded emoji `'⚠️', '🚫', '🔴'` и в `aiFallbackEngine.js:127,173,244,349,366-376` — `'📈', '⏳', '🚀', '🔥', '📊', '✅', '💡', '🎯'`. Это 17 точек, где AI-движок генерирует emoji-icon, а renderer его потом «фиксит». Брендбук §6 / spine-pill §1 — без эмодзи в data-views. | Заменить все emoji-литералы на iconKey-строки. Renderer — только Icons.get(name). Один проход — закрывает обе линии (data + UI). | M |

## 11. CEO-режим

| | | | | | |
|---|---|---|---|---|---|
| 23 | `views/exec.js:43-53, 200-216` | high | ExecView — 6 tile'ов в 2 ряда («Релизы под риском / Загрузка / Dependency / Burn-down / Блокеры / Стабильность плана»). Каждый tile = одна цифра + подсказка + drill-кнопка. Визуально — это **dashboard.js light** с 6 KPI-плитками вместо 12. Это не передаёт «один экран без скролла, перед стендапом». Передаёт «упрощённая версия дашборда». Брендбук «спокойный, точный, тёплый» — здесь точный + холодный. | Превратить в reading layout: hero-line («Курс ровный / 2 релиза в дрейфе»), затем 1 column со story «3 человека перегружены, главный — Иванов / Релиз 1.21 78% — отстаёт от плана / Завтра 5 блокеров»). Один экран = one narrative, не grid из 6 tile'ов. Tile-grid оставить как fallback в settings. | L |
| 24 | `views/exec.js:198-205` | medium | Header — `prizma-card-eyebrow PRIZMA · CEO-РЕЖИМ` + h1 «Курс одним экраном». Это правильный brand layout, но затем сразу `exec-grid` без подсказки времени/контекста. Брендбук §10 splash просит continuity «from splash to app» через breathe в углу. Здесь нет «мостика» — попадаешь и сразу 6 цифр. | Subhero-line после h1: «10:14 · 4 апреля 2026 · 12 минут до стендапа» (если установлен calendar-mode) или «Сводка свежая на 15:42». Дата = compass moment. | S |

## 12. Действия

| | | | | | |
|---|---|---|---|---|---|
| 25 | `app/actionLayer.js:132-138` | medium | Каталог действий — `al-action-card` grid (icon + name + desc + run-button). Это — обычный «store of actions». Это правильный data-layer, но брендингово — никак не связано с «коррекцией курса для всей команды» (su-text). Иконки = Lucide (правильно), но layout — generic admin-grid. | Группировка по «момент в курсе»: «Перепланировать», «Сверить scope», «Перенести релиз», «Зачистить». Каждая группа — eyebrow + 2-3 действия в reading column. Не grid. Работа = редкий ритуал, не утилита-меню. | M |

## 13. AI Анализ

| | | | | | |
|---|---|---|---|---|---|
| 26 | `views/aiView.js:34-48` + `ai/aiRenderer.js` | critical | 13 AI-блоков (`health, forecast, if_nothing_changes, dependency, replanning, bottlenecks, risk_narrative, prioritization, dashboard, anomalies, quality, second_opinion, recommendations`) — одинаковые карточки с заголовком, summary, insights-list, recommendations, refresh-кнопкой. Это **AI-Wikipedia**, не AI-second-brain. Никакого «приоритета внимания», никакой story-progression. Все 13 блоков равноправны — глаз тонет, юзер не понимает с чего начать. | Hero-block «Главное за 30 секунд» (1 блок выбирается AI) на верхушке. Остальные 12 — collapsed details, expand on click. Это превращает grid в «one focal point + library». Брендбук §7 «уважает время» — здесь сейчас обратное. | L |
| 27 | `views/aiView.js:175-180` + empty-state | medium | Empty-state когда нет данных — обычная плашка с CTA «Импортировать XLSX / Демо». Брендбук §10 splash шаблон — «звезда + caption ЛОЗУНГ». AI empty момент идеален для «Призма пока не видит курс» с маскотом в ls-thinking. Сейчас бренд-присутствие минимальное. | Empty AI = маскот hibernate (сжатый кристалл) + caption «Пока не на что смотреть» + CTA. Это создаёт continuity и дружбу, не «error state». | S |
| 28 | `ai/aiRenderer.js` (icons) | medium | AI-blocks используют `block.icon` (текст / emoji-symbol). См. `aiFallbackEngine.js:127-376` — `📈, ⏳, 🚀, 🔥, 📊, ✅, 💡, 🎯`. Same problem as AI CEO (находка #22). | Audit #22 один раз закроет оба. | (см. #22) |

## 14. Точность оценок

| | | | | | |
|---|---|---|---|---|---|
| 29 | `views/teamHealthDashboards.js:62-122` | medium | Estimation calibration: 2 column-list'а (по людям, по проектам). Каждая строка — `key/val/pct` с цветной точкой good/mid/bad. Это правильный density-формат. **Но**: нет визуализации distribution. «Иванов: медиан. отношение 1.4 · недооценивает» — текст. Не видно ширины разброса, не видно outlier'ов. | Per-row sparkline: 5-7 dots показывают последние 7 оценок (вертикальная позиция = ratio). Один взгляд — видишь стабильность/разнобой. | M |

## 15. Документация (доки-долги)

| | | | | | |
|---|---|---|---|---|---|
| 30 | `views/teamHealthDashboards.js:262-360` | medium | DocDebt — 7 column-list'ов (Здоровье пространств / Авторы / Распространители / Изолированные / Retro closure / ACL / Популярные). Это — самый long-list dashboard в продукте. На скрине воспринимается как «семь tab'ов в одном окне». Density = max, но в брендбуке density должна быть осознанная — здесь она результат «кучи данных, не задизайнили». | Поделить на 2 таба: «Контент» (spaces, owners, spreaders, retro, popular) и «Доступы» (ACL, siloed). Внутри каба — один scroll, единый ритм. Семь parallel column'ов превращаются в 2 фокусных view. | M |

## 16. Интеграции (контейнер-секция)

| | | | | | |
|---|---|---|---|---|---|
| 31 | `views/integrationsView.js:38-43` | low | `_statusBadge` — signal-dot + текст. Это правильно (брендбук §3 + §6). Но dot одного размера 8px на всех signal-states. На pending состоянии (info — «жду ответа») dot mute, на error — bright red — это ок. **Но**: pending не дышит. Брендбук §9 Pulse — «когда обнаружен дрейф / нотификация» — pending verify это идеальный момент для тонкого pulse. | Pending dot — `signal-dot-pulse` модификатор (он уже есть в bd-team-mini, line 389 blackDashboardRenderer.js). Унифицировать. | S |
| 32 | `integrations/integrationsRenderer.js` (settings modal) | low | Settings modal — стандартная корпоративная модалка с табами «Delta / Sigma / Bitbucket / Confluence». Бренд = только text «Призма». Маскот не показывается (хотя именно на settings-странице юзер впервые «общается» с системой). | На пустой settings — маскот в углу с тонким caption «Настрой связь — и я начну видеть курс». Это создаёт «компаньон» feel вместо «config-form». | S |

## 17. Сканнер команд

| | | | | | |
|---|---|---|---|---|---|
| 33 | `integrations/teamScanner2Renderer.js` (~5300 строк) | high | Сканнер — самый плотный экран продукта (Glance / Today / Operations / Trends / Sleeping). Внутри глаз тонет: 10+ под-блоков, многоуровневые табы, sparkline'ы, chip'ы, action-queue, пр. Брендбук «спокойный, точный, тёплый» — здесь только «точный». Когда экран — wall of data, спокойствия не получается. | Phase-1: ввести **room-headers** (caps eyebrow + 32px space) между логическими группами. Сейчас всё бок-о-бок. Phase-2: одна story-line вверху («Команда работает в норме / Замечен дрейф в 3 секциях») перед grid. | L |
| 34 | `integrations/portfolioPulseRenderer.js:38, 52, 206, 228, 241, 603-604, 1146, 1214` | high | Hard-emoji в Portfolio Pulse: `task: '✅', closed: '✅', '✓'/'⚠'/'⏱'/'💬'/'↪'/'·'/'🔴'/'🟡'/'🔵'`. Это самое плотное скопление эмодзи в продукте — 9+ позиций в render'е timeline / insights / diag-log. Брендбук §1 spine-pill ban. | Все timeline-events — Lucide-иконки; severity-pills — signal-dot'ы. Один pass × 30 минут. Pulse станет визуально «нашим». | M |
| 35 | `integrations/teamScanner2.js:1728, 1891` | medium | В data-генерации Сканнера эмодзи в строках narrative-блоков (`'🚫 Блокеры:'`, `'🚫 Топ блокеры:'`). Это идёт прямо в DOM. Узкое место — narrative-renderer не различает «текст inline иконку». | Заменить на line-break + `<svg class="ts2-narrative-icon">{no-symbol}</svg> Блокеры`. | S |

## 18. Чёрный дашборд

| | | | | | |
|---|---|---|---|---|---|
| 36 | `integrations/blackDashboard.js:1-30` + `integrations/blackDashboardRenderer.js:296-326` | critical | **«Чёрный»** — название историческое (Sigma-Jira coverage для топ-менеджмента), но **визуально дашборд НЕ чёрный**. Тот же светлый/тёмный скин что и весь продукт (через `--prizma-bg-elevated`, `--card`, `--bd-kpi-blue`). Метафора «black ops / inner sanctum / CEO oversight room» полностью потеряна — пользователь видит «ещё один coverage-tab». Брендбук использует `dark` контекстно (см. §8 Темы — «премиум, ясность, ассоциация с ночным небом» — для лендинга). Здесь идеальный кейс, но не реализован. | **Решение А (sustained):** Чёрный дашборд — **forced dark theme** независимо от user-toggle (как Sigma в чате — отдельный read-only «комната»). Hero — крупный star-mark + caption «СВЕРКА КУРСА · ПОКРЫТИЕ ЦЕЛЕЙ». Высокая type-scale (брендбук §4 Display 72/200), pure-black `#0A0A0F` background — отличается от обычного dark `#1A1A22`. **Решение B (entry):** Если forced-theme рискован — добавить в hero «Sigma-mode» левый stripe, монохром-палитра без signal-цветов (только stark Star + Mist). Это даёт «приглушённый CEO-тон». | L |
| 37 | `integrations/blackDashboardRenderer.js:333-344, 421-435` | high | KPI-блок: `bd-kpi-blue / bd-kpi-grey / bd-kpi-green/yellow/red` (для coverage%) — это classic admin signal-grid. На «Чёрном дашборде» (premium, executive, oversight) этот рисунок read как obsoletely-corporate. Coverage 67% желтым — банально. | KPI-плашки monochrome: цифра 72px JetBrains Mono Light, label CAPS 11px Mist. Coverage % — только знак signal-dot (зелёная/жёлтая/красная точка перед числом, 6px). Никаких цветных surface'ов. | M |
| 38 | `integrations/blackDashboardRenderer.js:445-478` (coverage bars) | medium | Coverage-bar за каждой командой: `bd-cov-fill` background + nested `bd-cov-fill-inner`. Это — заполненный двойной bar. На executive-режиме — слишком много визуальной массы. | Тонкая 2px line + dot-marker на текущем %. Брендбук §11 «никогда круговой спиннер» по духу применим: «никогда heavy-fill bar в premium-контексте». | M |

---

## Особое внимание

### A. Чёрный дашборд (раздел 18) — намеренная метафора или просто другой скин?

**Вердикт:** **Метафора потеряна.** В коде «Чёрный» — это историческое имя (исходно Sigma-Jira oversight, темно-серьёзный namespace для топ-менеджмента и quarterly goals). Визуально же он сейчас рендерится тем же `--prizma-bg / --card / signal-tokens`, что Pulse и Сканнер — то есть **просто ещё одна интеграция-вкладка**.

**Что говорит за «развить метафору»:**
- Брендбук §8 «Темы» прямо разрешает контекстный dark («ассоциация с ночным небом», «премиум»).
- Имя «Чёрный» уже шумит в UI — h2-title, диагностический modal, error-strings — пользователь *слышит* «чёрный», но *видит* обычный.
- Use-case (coverage квартальных целей перед топ-менеджментом) — exactly «high-stakes oversight», брендбук-tone «спокойный · точный · уверенный» здесь должен звучать **громче** чем в Реестре или Ганте.
- Существует прецедент в брендбуке (splash, premium контекст).

**Что говорит против (риск):**
- Forced theme внутри одного приложения — disorienting (юзер switch-нул на light, а здесь dark — может прочесть как баг).
- Maintenance: придётся держать два theme-context'а.

**Рекомендация:** **Развить (Решение B — без forced-theme):** На Чёрном дашборде использовать только monochrome palette (Star/Ink/Mist), без signal-цветов кроме одного coverage-state. Тёмная плитка-hero `#0A0A0F` solid (даже в light theme) над KPI — этого достаточно чтобы создать «комнату внутри продукта». Это сохраняет переключение тем но даёт визуальный подпись «здесь executive-режим».

**Потенциал нереализованного: high.** Это самый дорогой неиспользованный визуальный приём в продукте.

### B. AI-разделы (10 / 11 / 13) — передают «умность» или просто таблички?

**Вердикт:** **Просто таблички.** Все три раздела (`aiCeoView`, `exec`, `aiView`) рендерят rule-based fallback мгновенно, потом тихо мерджат LLM-результат через `outerHTML`-replace. Снаружи — два состояния: «карточка» и «карточка с обновлённым текстом». Никакого «второго мозга».

**Что отсутствует:**
- **Streaming feel.** LLM возвращает JSON одним блоком (через `callLLM`), нет token-by-token отрисовки. Это технически правильно для structured output, но визуально читается как «обычный API». Можно добавить мнимый progressive-reveal: текст summary fade-in за 300-400ms.
- **«Думает» frame.** При refresh — `showPageLoader('Сверяем курс по AI…')` (правильно), но это full-screen overlay. Внутри карточки — `aiceo-refreshing` class (строка 366), но это просто `opacity: 0.6` или skeleton. Маскот в углу карточки в `obs--ls-thinking` — был бы идеален. Сейчас не используется.
- **«Insight» цвет.** Брендбук §3 Signal — `Insight #B084CC`. Это специально зарезервированный цвет под AI-инсайты. В коде используется в `signal-insight` (line 56 aiCeoRenderer) — но крайне редко. AI hero сейчас раскрашивает себя по `health.status` (ok/risk/critical → on-course/drift/off-course), и Insight-цвет фактически не звучит как «ИИ только что подумал».

**Что есть и работает:**
- `ceo-ai-status-chip` (line 405-408 aiCeoView) — маленький чип «AI · 14:32» / «Rule-based · AI недоступен». Честно, но микроскопически.
- AI-кнопка в hero (line 146 aiCeoRenderer) — `rotate-cw` + label «AI». Узнаваемо.
- Loader-фразы в `loaderPhrases.js` («Сверяем курс…») — хороши тонально.

**Рекомендация:** Создать единый `prizma-ai-frame` визуальный примитив:
- При AI-update — короткий glow обводки `--prizma-insight` (4-token CSS animation, 800ms, 1 раз).
- Маскот в углу секции — `obs--ls-thinking` пока loading, `obs--success` (на 1.5s) после.
- AI-only данные (vs rule-based fallback) — left-stripe `--prizma-insight` 3px на cards.

**Потенциал нереализованного: high.** Это самое слабое место в продукте по бренд-впечатлению. AI — главный selling-point внутреннего «мобильной платформы Сбера», а визуально не отличается от 2018-го года.

### C. Маскот Обсидиан в общем продукте

**Вердикт:** Маскот живой и хорошо собранный (см. `obsidian/obsidian.css` 100+ keyframes, 4 tier'а состояний, light/dark parity, palette refresh с `#1A1A22 Ink`). **В контексте продукта он используется в 3 точках:**

1. **#obsidian-fab-mascot** (правый нижний угол, 56×56) — постоянное присутствие, breathe ambient.
2. **#obsidian-chat-avatar** (внутри LLM-чата, 32×32) — реагирует на streaming/complete/tool-call.
3. **Per-message avatars + tour + toast** (упомянуто в карте).

**Где маскот НЕ используется (упущения):**
- AI hero / AI loading / AI success — мог бы быть `obs--ls-thinking` / `obs--ls-complete`. Это closest brand-moment, и его нет.
- Empty-states (Реестр, Дашборд, AI, Метрики) — сейчас prizmaEmptyGlyph (звезда), а маскот в `hibernate` сел бы лучше с tone-of-voice §7 «партнёр, не учитель».
- Splash → Topbar continuity — splash звезда (`renderHero`) ≠ маскот. Брендбук §10 splash continuity описана через breathe star, не через маскот. Это уже выбор: «звезда — продукт, маскот — компаньон». Решение читаемое.
- Onboarding tour использует маскота правильно.

**Конфликт стилей:**
Маскот — мягкая 7-point crystal с тёплой stroke (`#1A1A22 Ink`, opacity 0.45). Звезда продукта — 8-point stark monochrome polygon (`#FFFFFF / #1A1A22`). Они **разные геометрии** (7 vs 8). Это хорошо: маскот ≠ продукт, у него своя форма. Но соседство в одном экране (например, splash + FAB) даёт лёгкий cognitive dissonance: «два кристалла, разной грамматики».

**Рекомендация:**
- Маскота — в AI-states (раздел 13 finding #27).
- Маскота — в `renderEmptyState` (`app/prizmaUI.js:186`) как `illustration: 'mascot-hibernate'` опцию рядом с `'star-breathe'`. Caller выбирает: брендовая пустота (звезда) vs дружелюбная пустота (маскот).
- Не использовать маскота как replacement star-mark в hero — он не «продукт», он «компаньон».

**Потенциал нереализованного: medium-high.** Маскот — самый сильный brand-asset, и он недоиспользован в data-views продукта (живёт в чате и FAB).

---

## Mood-направления

Три направления развития визуального языка. Каждое жертвует чем-то ради усиления другого.

### Mood A: «Тихий компас» (consolidate current direction)

**Идея:** Удвоить ставку на брендбук как он есть. Спокойствие, monochrome, dark-first, mascot как companion, signal-цвета только семантика.

**Конкретно:**
- Все 6 KPI-grid'ов в продукте → плотный stat-strip с monochrome bg.
- Все signal-bg'ы (`--prizma-on-course-bg`, `--prizma-drift-bg` etc.) — снизить tint до 4% (сейчас 12-14%).
- Hero на каждой странице — звезда reactive (см. находка #1).
- AI-разделы — Insight signal-цвет как identity (находка B).
- Сканнер / Pulse — введение room-headers (находка #33).

**Плюсы:** низкая когнитивная нагрузка, дёшево (M трудозатраты), полная brandbook-парность, корпоративная «солидность», уважает время.

**Минусы:** скучный/monotonous, никакого WOW-момента, AI-seller внутри Сбера может сказать «выглядит как 1С».

**Потенциал: medium.**

### Mood B: «Высокий градус» (executive premium / oversight room)

**Идея:** Чёрный дашборд + AI CEO + CEO-режим — выделенный premium-режим с собственной гранулярной типографикой и forced dark.

**Конкретно:**
- 3 раздела (10, 11, 18) — единый «executive layer»: forced dark (`#0A0A0F` solid), Display-scale (72/200) для главных KPI, JetBrains Mono Light для всех чисел, минимум surfaces, максимум пустоты.
- Остальные разделы (Реестр / Гант / Метрики) — обычный contextual theme. Между «обычным» и «executive» переход через черный fade.
- Маскот в executive слое — appears только на error-state (`obs--alert`).

**Плюсы:** создаёт «moment» в продукте, executive-юзер сразу понимает «это для меня», Mood A & B могут coexist (один продукт — два настроения).

**Минусы:** maintenance (два theme-context'а), риск disorientation (forced theme внутри light приложения), брендбук явно не разделяет «обычный» vs «premium» tone — это новая категория.

**Потенциал: high. Самая большая выгода относительно затрат, но требует решения по forced-theme.**

### Mood C: «Живой компас» (mascot + motion as primary identity)

**Идея:** Сделать маскота и motion — главным brand-anchor'ом. Везде где есть state-change, маскот реагирует. Звезда отступает на второй план.

**Конкретно:**
- Маскот — в empty-states всех разделов (вместо звезды).
- Маскот — в AI-разделах (раздел 13 finding #27).
- Splash → topbar handoff — маскот, не звезда.
- Loaders L2/L3 — маскот в `obs--ls-thinking`.
- Hero на Дашборде — маскот реагирует на drift (lookдо, sway, alert).
- Брендбук §6 / §10 переписать: «звезда — знак идентификации в маркетинге, маскот — visible companion в продукте».

**Плюсы:** тёплый, дружелюбный, отличается от всех корпоративных аналогов, использует уже сделанный (и отличный) маскот-asset, передаёт «партнёр, не учитель» лучше всего.

**Минусы:** идёт против брендбука («звезда — главная идентичность»), маскот может стать раздражающим при долгой работе (8-часовой сессии — а это user case по §8), требует доработать маскота в компактных размерах для KPI-плиток.

**Потенциал: medium.** Высокий риск, высокая отдача — но требует переписать кусок брендбука.

---

## Рекомендация по mood

**Главное направление: Mood A с акцентами Mood B на executive-разделы.**

То есть: 70% продукта консолидируем (находки #1-35), а 3 раздела (Чёрный дашборд / AI CEO / CEO-режим) выделяем в premium-слой с monochrome+JetBrains Display-scale (находка #36-38, B). Маскот оставляем как сейчас + расширяем на AI-states (find #27, C-частично).

Это даёт «тихий продукт со вкусом + один WOW-момент для топ-менеджмента» без переписывания брендбука и forced-theme.

---

## Топ-10 идей по визуальным улучшениям

| # | Идея | Эффект | Трудозатраты | Потенциал |
|---|---|---|---|---|
| 1 | Hero-звезда reactive: rotate ±2° на drift, signal-pulse на off-course (находка #1). | Метафора «компас» материализуется. Один визуальный приём — восприятие продукта меняется с «дашборда» на «инструмент ориентации». | M | high |
| 2 | AI-frame primitive: insight-glow обводки + маскот в углу + 3px insight-stripe (находки #20, #27, B). | AI-разделы наконец читаются как AI, а не как rule-based отчёты. Закрывает самое слабое место. | L | high |
| 3 | Чёрный дашборд — monochrome palette + tile-hero `#0A0A0F` solid (находка #36 решение B). | Premium-momentum, executive-context, без рисков forced-theme. | L | high |
| 4 | Унификация worktype-палитр: убрать `_wtColors` Tailwind hex в Timeline (находка #15), убрать hardcoded #hex в Ганте (#11). Один источник через `PHASE_COLOR_TOKENS`. | Гант и Timeline перестают выглядеть как два разных приложения. | S | high |
| 5 | `room-header` концепт (caps eyebrow + 32px space) для всех multi-block страниц (Метрики, Сканнер, DocDebt — находки #6, #33, #30). | Иерархия внимания на плотных экранах. Без потери density. | M | high |
| 6 | Полная зачистка emoji в data-layer: `aiCeoFallback`, `aiFallbackEngine`, `teamScanner2`, `portfolioPulseRenderer` (находки #21, #22, #34, #35). | Единый visual-language. Брендбук §1 spine-pill — finally закрыт. | M | medium |
| 7 | Action-block доминирующий weight на Дашборде: ×1.6 плотность, остальное mute (находка #2). | Юзер при открытии видит «вот сюда смотреть» в первые 200мс. | S | high |
| 8 | KPI-grid → KPI-strip (4 главных + collapse): Дашборд + Метрики + Сотрудники (находки #3, #6, #16). | Density становится осознанной. Брендбук §3 «5% signal» восстанавливается. | M | medium |
| 9 | Маскот в empty-states как option (находки #20 secondary, C-часть). `renderEmptyState({illustration:'mascot-hibernate'})`. | Маскот появляется в 6+ местах продукта вместо 2. Compoundное усиление brand-identity. | S | medium |
| 10 | Subhero context-line под page-header (CEO-режим, AI CEO, Дашборд — находка #24). «10:14 · 4 апреля 2026 · сводка свежая». | Compass-metaphor усиливается через temporal context. Tone-of-voice «уверенный, точный» наконец передаётся. | S | medium |

---

## Что НЕ предлагается (намеренно)

- Менять palette брендбука. Сигнальная палитра выверена и работает — проблемы в её **применении**, не в самих цветах.
- Trade'ить density на whitespace в data-views. Density — для внутреннего продукта верное решение, проблема в том что она *неосознанная* — это и есть mood A: density + structure.
- Удалять маскота. Он среди самых сильных активов.
- Удалять JetBrains Mono для чисел — таблично-цифровая идентичность работает.
- Полный gradient-zero. Брендбук разрешает gradient в L3 shimmer и в jewel mascot. Один shimmer + маскот можно оставить.

---

## Источники

- Брендбук: `my_prisma-brand/BRAND_BOOK.md`
- Маскот: `obsidian/obsidian.css`, `obsidian/obsidian-sprite.svg`, `app/obsidianMascot.js`
- Каноничные UI helpers: `app/prizmaUI.js` (`renderHero`, `renderPageHeader`, `renderEmptyState`)
- Дизайн-правила: `docs/spine-pill.md`, `docs/brand.md`, `docs/branding-proposals.md`
- Renderer'ы: `views/dashboard.js`, `views/metrics.js`, `views/gantt.js`, `views/registry.js`, `views/timeline.js`, `views/employees.js`, `views/exec.js`, `views/aiCeoView.js`, `views/aiView.js`, `views/teamHealthDashboards.js`, `views/history.js`, `views/integrationsView.js`, `app/actionLayer.js`, `integrations/blackDashboardRenderer.js`, `integrations/portfolioPulseRenderer.js`, `integrations/teamScanner2Renderer.js`
- AI: `ai/aiCeoRenderer.js`, `ai/aiCeoFallback.js`, `ai/aiRenderer.js`, `ai/aiFallbackEngine.js`
- Стили: `styles.css` (~20k LOC, базовые токены и shim)

---

*Этап 4 из 14. Команда: арт-директор + ведущий продуктовый дизайнер. 38 находок (5 critical / 12 high / 17 medium / 4 low) + 3 mood-направления + 10 идей.*
