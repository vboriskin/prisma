# 00 — Синтез 5 экспертных отчётов по редизайну дашборда

> Вход: 01-IA, 02-VISUAL, 03-INTERACTION, 04-UX, 05-MOTION (написаны 2026-05-04, read-only).
> Выход: единое предложение для согласования. Без правок кода.

---

## TL;DR

Дашборд сейчас — **табло из 9 равновесных секций**. Все 5 экспертов независимо пришли к одному выводу: **нужна точка фокуса = «что требует курса сегодня»**, а не «вот вам 12 цифр одинакового веса». Решение единогласно: **сжать → выровнять иерархию → добавить actionable-блок → выселить тяжёлые таблицы**.

Финальная картинка:

```
┌────────────────────────────────────────────────────┐
│  eyebrow: КУРС · ДАШБОРД                           │
│  h1: Курс квартала                                 │ ← было «Сводный дашборд» (тавтология)
│  ─── hairline ─────                                │
├────────────────────────────────────────────────────┤
│            ★ (breathe)                             │
│              48px / 300                            │
│             КУРС КВАРТАЛА                          │ ← 11/CAPS/1.5
│       146 / ДРЕЙФ 12 / БЕЗ КУРСА 18                │
├──── hairline ──────────────────────────────────────┤
│  ЧТО ТРЕБУЕТ КУРСА СЕГОДНЯ            (новое)      │
│  ┌──────────────────────────────────────────────┐  │
│  │ ●off  56 задач без релиза в 1.20  [Открыть] │  │
│  │ ●drft 12 задач требуют scope        [Сверить]│  │
│  │ ●off  3 блокера истекают на неделе  [Открыть]│  │
│  └──────────────────────────────────────────────┘  │
│  Все требующие внимания (12) →                     │
├────────────────────────────────────────────────────┤
│  КУРС ПО РЕЛИЗАМ                                   │
│  [1.20 60%][1.21 30%][1.22 12%][OT 28%][всего 45%] │
├────────────────────────────────────────────────────┤
│  СОСТОЯНИЕ КУРСА                                   │
│  PRIMARY (32px) — 4 карты:                         │
│    Треб.подтв · Без релиза · Блокеры · Овертайм    │
│  SECONDARY (20px) — 7-8 карт:                      │
│    Всего · Scope-Да · Scope-Нет · 1.20/.21/.22 ·   │
│    Сделано  (нейтральные, без stripe)              │
├──── ниже fold ─────────────────────────────────────┤
│  ▸ Детализация по релизам      (collapsed)         │
│  ▸ Активные риски              (collapsed)         │
└────────────────────────────────────────────────────┘
[`teams-summary`, `no-release`, `needs-confirm` — ВЫНЕСЕНЫ ИЗ ДАШБОРДА]
```

Все 1017 тестов сохраняются. Контракт `renderHero` соблюдается. KPI-cards остаются кликабельными.

---

## 1. На чём согласны все 5 экспертов (consensus)

| # | Что | IA | Visual | Interaction | UX | Motion |
|---|---|:---:|:---:|:---:|:---:|:---:|
| Hero дублирует данные с KPI-grid | ✓ | ✓ | ✓ | ✓ | — |
| Нужен actionable-блок «Что требует курса» | ✓ | — | ✓ | ✓ | ✓ |
| 12 KPI равного веса = плоская иерархия | ✓ | ✓ | — | ✓ | — |
| `teams-summary` выселить с дашборда | ✓ | — | — | ✓ | — |
| `blocking-detail` (таблица 20 строк) выкинуть, заменить action-блоком | ✓ | — | — | ✓ | — |
| Эмодзи `⚠ 🚧` убрать | — | ✓ | — | ✓ | — |
| Hardcoded hex `#fcd34d`, `#fca5a5` → CSS-vars | — | ✓ | — | — | — |
| Empty-state нужен с CTA-кнопками | — | — | ✓ | ✓ | — |
| Хотя бы 1 жест помимо Breathe (Emerge на load) | — | — | ✓ | — | ✓ |
| `signal-цвет` НЕ применять как декорацию (release-card-count, risk-counter-value, blocking-title) | — | ✓ | — | — | — |
| h1 «Сводный дашборд» = тавтология с eyebrow «КУРС · ДАШБОРД» | — | — | — | ✓ | — |

---

## 2. Единое предложение

### 2.1. Page header

**Сейчас:**
- eyebrow: `КУРС · ДАШБОРД`
- h1: `Сводный дашборд`
- sub: «Сводный взгляд: куда движется команда по релизам.»

**После:**
- eyebrow: `КУРС · ДАШБОРД` (без изменений)
- h1: **`Курс квартала`** (убираем тавтологию «дашборд»)
- sub: без изменений

### 2.2. Hero (renderHero — контракт сохраняется)

**Сейчас:**
- KPI: `57.7%` (48px, weight **700** — конфликт с брендбук §4)
- Caption: `КУРС КВАРТАЛА` (CAPS)
- Supporting: `В РАБОТЕ / ДРЕЙФ / БЕЗ КУРСА`

**После:**
- KPI: `57.7%` (48px, weight **300** — брендбук §4 MonoNumber)
- Caption: `КУРС КВАРТАЛА` (без изменений)
- Supporting: `В РАБОТЕ / ДРЕЙФ / БЕЗ КУРСА` (без изменений; supporting корректно)

> **NB:** UX-advocate предлагал заменить caption на человеческую фразу типа «Курс выдерживается. До конца квартала 38 дней». Я считаю это решением продукта, не дизайна — оставляем CAPS как **default**, но открываем возможность conditional «Курс отклонился. Дрейф +4 за неделю» как **новый блок ниже** (см. 2.7 «Что нужно решить»).

### 2.3. **NEW** Action-блок «Что требует курса сегодня»

**Между hero и KPI-grid** — новая секция `.dash-action-block`. Это **главная add-фича** редизайна (consensus IA + Interaction + UX + Motion).

Состав:
- Заголовок-eyebrow: `ЧТО ТРЕБУЕТ КУРСА СЕГОДНЯ` (CAPS 11/1.5, секция-разделитель)
- 0–3 action-card строки в формате:
  - signal-dot (`signal-off-course` или `signal-drift`)
  - число + текст («56 задач без релиза в 1.20»)
  - CTA-кнопка («Распределить» / «Сверить» / «Открыть»)
- footer-link: `Все требующие внимания (N) →` → Реестр с composite-фильтром
- Empty-state: «Курс ровный. Сегодня ничего срочного не требует внимания.»

**Алгоритм top-3:**
1. `blockingDependency && deadline ≤ 7 days` → `off-course`, action: «Открыть»
2. `hasOvertime && !workPeriod` → `off-course`, action: «Завершить план»
3. `scopeStatus === 'Требует подтверждения' && >5` → `drift`, action: «Сверить scope»
4. `riskFlags.length > 0` → `drift`, action: «Открыть»
5. `isUnassigned > 30` → `drift`, action: «Распределить»

Всё что выше — данные **уже есть** в `state.rows[]`, новых API не нужно.

**Action-cards только в едином оформлении:**
- background `--prizma-bg-elevated`
- border-left 3px signal-color
- focus только на CTA-кнопке (не на карточке) — избегаем double-button-trap
- `role="region" aria-label="Требует курса сегодня"`

### 2.4. KPI-grid — иерархия трио

**Сейчас:** 12 карточек, все 22px / 600 mono, 4 со stripe-left signal — но визуально равны.

**После:** 12 карточек разделены на **PRIMARY (4) + SECONDARY (8)**:

| # | KPI | Класс | Размер | Signal |
|---|---|---|---|---|
| 1 | **Треб. подтверждения** | `kpi-primary signal-drift` | **32px** | drift stripe |
| 2 | **Без релиза** | `kpi-primary signal-drift` | **32px** | drift stripe |
| 3 | **Блокирующих зав.** | `kpi-primary signal-off-course` | **32px** | off-course stripe |
| 4 | **В овертайме** | `kpi-primary signal-off-course` | **32px** | off-course stripe |
| 5 | Всего задач | `kpi-secondary kpi-neutral` | 20px | — |
| 6 | В scope (Да) | `kpi-secondary kpi-neutral` | 20px | — |
| 7 | Вне scope (Нет) | `kpi-secondary kpi-neutral` | 20px | — |
| 8 | В релизе 1.20 | `kpi-secondary kpi-neutral` | 20px | — |
| 9 | В релизе 1.21 | `kpi-secondary kpi-neutral` | 20px | — |
| 10 | В релизе 1.22 | `kpi-secondary kpi-neutral` | 20px | — |
| 11 | Сделано | `kpi-secondary kpi-neutral` | 20px | — (или `signal-on-course` если ≥80%) |
| 12 | Строк с рисками | dynamic: `kpi-primary signal-off-course` если >0, иначе `kpi-secondary` | 32 / 20 | dynamic |

**Веса:** все на 400 (брендбук §4). 700 уходит. Цифры — `--prizma-text-primary` (нейтральный); signal — **только в stripe-left**, не в цвете цифры.

**Заголовок секции:** `СОСТОЯНИЕ КУРСА` (CAPS 11/1.5) — сейчас секция без явного заголовка.

### 2.5. Progress-bars — `КУРС ПО РЕЛИЗАМ`

**Сейчас:** 5 карточек 1.20/1.21/1.22/OT/Всего — read-only, не кликабельны.

**После:**
- Заголовок: `КУРС ПО РЕЛИЗАМ` (CAPS 11/1.5)
- Без изменений в составе и ритме.
- **Опционально (could):** сделать кликабельными → modal-kpi с release-фильтром (как сейчас KPI-card r120). Не первый этап — после.

### 2.6. Что выкидывается из дашборда

| Блок | Куда |
|---|---|
| `risks-panel` (счётчики флагов) | Свернуть в `▸ Активные риски` ниже fold (collapsed) |
| `blocking-detail-card` (таблица 20 строк) | **Удалить с дашборда** — заменено action-блоком 2.3 |
| `release-breakdown` (4 release-card с mini-breakdown) | Свернуть в `▸ Детализация по релизам` ниже fold (collapsed) |
| `teams-summary-wrap` (12-колоночная таблица команд) | **Вынести в модуль КОМАНДА** (`views/employees.js`) или в Сводную |
| `no-release-wrap` (таблица «Без релиза») | **Удалить** — KPI-supporting «БЕЗ КУРСА» в hero уже ведёт в Реестр с фильтром |
| `needs-confirm-wrap` (таблица «Требует подтверждения») | **Удалить** — KPI-card «Треб. подтв.» уже ведёт в Реестр с фильтром |
| 12 KPI-cards (старая плоская сетка) | **Заменить** на 4 PRIMARY + 8 SECONDARY (см. 2.4) |

После выселения первый экран = **5 секций** (header, hero, action-блок, progress, KPI-grid). Ниже fold = 2 свёрнутых блока. Таблицы команд / no-release / needs-confirm — в других view'ах.

### 2.7. Палитра — правила signal

**Запрет signal-цветов как декорации (брендбук §3.3):**
- `.release-card-count` `--prizma-information` → `--prizma-text-primary` (нейтральный счётчик)
- `.risk-counter-value` `--warning` → `--prizma-text-primary` (signal в stripe-left на parent)
- `.blocking-detail-title` `--danger` → `--prizma-text-secondary` + eyebrow CAPS

**Hardcoded hex → токены:**
- `#fcd34d` → `var(--prizma-drift)` 30%-альфа на border
- `#fca5a5` → `var(--prizma-off-course)` 30%-альфа на border

**Эмодзи:**
- `.risks-panel-title::before { content: '⚠' }` → удалить
- `.blocking-detail-title::before { content: '🚧' }` → удалить (но и сама secция переезжает ниже fold)

### 2.8. Типографика

**Trio-шкала чисел:** 48 (Hero) / 32 (Primary KPI) / 20 (Secondary + supporting + release-count + risk-counter).

**Унификация:**
- Hero KPI: 48 / **300** / -1px (брендбук §4 MonoNumber-логика)
- Primary KPI: **32 / 400 / -0.5px / JetBrains Mono**
- Secondary KPI / supporting / release-count / risk-counter: **20 / 400 / -0.2px / JetBrains Mono**
- Все labels: 10 / 600 / 1.2px CAPS / SF Pro Display
- Все section-eyebrows: 11 / 500 / 1.5px CAPS / SF Pro Display
- Body: 15 / 400 (брендбук §4 Body)
- BodySmall: 13 / 400 (sub-text)

**Тэги:**
- Никакого weight 700 на дашборде (Visual lead, брендбук §4).
- Все числа — JetBrains Mono + tabular-nums.
- Все CAPS-labels с letter-spacing 1.2 (kpi-label) или 1.5 (eyebrow).

### 2.9. Interaction / a11y

**MUST:**
- `role="region"` + `aria-label` на каждом блоке (action-блок, KPI-grid, progress, ниже-fold)
- `aria-live="polite"` на `#dashboard-kpi` и `.prizma-hero-kpi` — числа меняются после refresh
- `role="progressbar"` + `aria-valuenow` на `.progress-bar-fill`
- `aria-label` KPI расширить: «Открыть в реестре: {label}, {value} задач»
- focus-visible на KPI: `--prizma-information` (синий) + offset 3px (вместо `--prizma-text-primary` — на dark теме сливается с stripe-left signal-цветами)
- Empty-state: 2 CTA-кнопки «Импортировать XLSX» / «Применить шаблон демо»
- Focus-management при KPI-modal → Реестр: focus на `#section-registry h2` + `aria-live` toast

**SHOULD:**
- supporting-числа в hero — снять `cursor:pointer`-обещание (либо сделать кликабельными — решение продукта)
- focus-trap в `modal-kpi` (сейчас отсутствует)

### 2.10. Motion

**Использовать 4 жеста брендбука §9 (сейчас только Breathe + Align):**

| Жест | Где | Длительность | Триггер |
|---|---|---|---|
| **Breathe** (есть) | hero-mark, empty-glyph | 4s loop | always (idle) |
| **Emerge** (новый) | KPI-grid (12 cards), action-блок (3 cards), release-cards | 320–420ms / stagger 50–80ms | первый рендер / data load |
| **Align** (новый, на дашборде) | при изменении числа в `.kpi-value` (data refresh) | 320ms spring | `oldValue !== newValue` |
| **Pulse** (новый) | только новые `signal-off-course` KPI/action-cards | 1600ms × **3 повтора, не infinite** | `state.lastSeen.dashboard < record.changedAt` && severity off-course |
| **Align** (есть, recheck) | topbar-mark при KPI-modal → Реестр | 1600ms spring | `App.goTo` с диффом раздела |

**Sequencing на первый рендер:** ~1700ms total с stagger (см. 05-MOTION § 5).

**Reduced-motion:** universal-rule в `theme.css` уже бьёт animation-duration. Точечно добавить `:hover { transform: none }` для kpi-card.

---

## 3. Что нужно решить (вопросы продукту)

### 3.1. Hero caption — статичный или conditional?

UX-advocate предлагает заменить «КУРС КВАРТАЛА» на человеческую фразу типа «Курс выдерживается. До конца квартала 38 дней» (или «Курс отклонился. Дрейф +4 за неделю» при плохом раскладе).

**Pros:** narrative, brandbook §7 voice, помогает Анне утром.
**Cons:** нет в брендбуке такого pattern'а; «38 дней» — это нечто новое для расчёта (нужна дата конца квартала в state); «дрейф +4 за неделю» — нужен snapshot прошлой недели.

**Моё мнение:** на этом этапе оставить статичный CAPS «КУРС КВАРТАЛА». Conditional context-фразу — отдельный спринт после согласования контента продуктом.

**Вопрос пользователю:** делаем сейчас или откладываем?

### 3.2. Action-cards — top-3 или top-5?

IA склоняется к 3 («уважение времени»), Interaction нейтрален.

**Моё мнение:** **top-3 + footer «Все требующие (N) →»**. 5 — wall of action. 3 — фокус.

**Вопрос:** ок?

### 3.3. `teams-summary` — куда?

IA говорит: вынести в модуль КОМАНДА. UX-advocate согласен.

**Варианты:**
- (а) В `views/employees.js` — добавить новую секцию «Сводка по командам» с теми же 12 колонками
- (б) Удалить совсем — данные доступны в Реестре с фильтром по команде
- (в) Перенести в Сводную (`section-summary`)

**Моё мнение:** (а). У employees.js уже есть KPI-cards и hero — таблица сводки логично дополнит.

**Вопрос:** ок? Или (б) / (в)?

### 3.4. `no-release` / `needs-confirm` таблицы — удалить?

IA говорит: удалить (пользователь идёт через KPI-card → modal → Реестр). UX согласен.

**Контр-аргумент:** Игорь (планировщик) может страдать без быстрых таблиц.

**Моё мнение:** удалить. Игорь работает в Реестре, не на дашборде. Данные не теряются — путь в Реестр через KPI один клик.

**Вопрос:** ок? Или оставить как `▸ collapsed` ниже fold?

### 3.5. Release-card / progress-card делать кликабельными?

Interaction предлагает — для consistency с KPI. IA сворачивает release-breakdown ниже fold.

**Моё мнение:** **progress-card в `КУРС ПО РЕЛИЗАМ` сделать кликабельными** (consistency wins, тот же modal что KPI). **release-breakdown** ниже fold — пока не трогаем (collapsed по умолчанию).

**Вопрос:** ок?

### 3.6. h1 «Сводный дашборд» → «Курс квартала»?

UX-advocate отмечает тавтологию.

**Моё мнение:** менять. eyebrow `КУРС · ДАШБОРД` уже несёт «дашборд»; h1 = носит контекст «квартал».

**Вопрос:** ок? Или альтернативный h1 (например, «Текущий квартал», «Состояние курса»)?

---

## 4. План работ — по этапам

После согласования п.3 — исполнение волнами.

**Волна 1 — Quick wins (≤ 1 день, изолированы):**
- (1) Hero KPI weight 700 → 300 (1 строка CSS)
- (2) Убрать эмодзи `⚠ 🚧` (2 правки CSS)
- (3) Заменить hardcoded hex `#fcd34d`, `#fca5a5` на токены
- (4) Снять signal-цвет с release-card-count, risk-counter-value, blocking-detail-title
- (5) h1 «Сводный дашборд» → «Курс квартала»
- (6) `aria-label` KPI расширить
- (7) `role="region" + aria-labelledby` на блоках
- (8) `aria-live` на dashboard-kpi и hero-kpi
- (9) `role="progressbar"` + `aria-valuenow`
- (10) focus-visible KPI на `--prizma-information`
- (11) supporting в hero — снять `cursor:pointer`-намёк

**Волна 2 — KPI-grid trio (1–2 дня):**
- (12) Новые классы `.kpi-primary` (32/400) и `.kpi-secondary` (20/400)
- (13) Перенести 4 карточки в PRIMARY, остальные 8 в SECONDARY
- (14) `.kpi-label` 10/600/1.2 CAPS унификация
- (15) Section-eyebrow `СОСТОЯНИЕ КУРСА` над KPI-grid
- (16) Section-eyebrow `КУРС ПО РЕЛИЗАМ` над progress-grid

**Волна 3 — Action-блок «Что требует курса» (2–3 дня):**
- (17) Новый блок `.dash-action-block` между hero и KPI-grid
- (18) Алгоритм top-3 по severity (см. 2.3)
- (19) Action-cards с CTA-кнопкой и signal-stripe
- (20) Footer-link «Все требующие (N) →»
- (21) Empty-state «Курс ровный»
- (22) Action-card → Реестр с composite-фильтром

**Волна 4 — Выселение и переезды (1 день + 1 день в Команде):**
- (23) Удалить `blocking-detail-card`, `no-release-wrap`, `needs-confirm-wrap`
- (24) Свернуть `risks-panel` и `release-breakdown` в `<details>` ниже fold
- (25) Перенести `teams-summary` в `views/employees.js` (если выбран вариант (а))
- (26) Empty-state CTA: 2 кнопки

**Волна 5 — Motion (1–2 дня):**
- (27) Emerge stagger на kpi-grid и action-block
- (28) Align на `.kpi-value` при изменении (data-prev-value)
- (29) Pulse только на свежих off-course (3 повтора, не infinite)
- (30) Sequencing 1700ms total

**Волна 6 — Дополнительно (could):**
- (31) Progress-cards кликабельны (модал по релизу)
- (32) Hero-supporting кликабельны (или решение «не делать»)

---

## 5. Что НЕ делаем в этом редизайне

- Cmd+K command-palette — отдельный спринт, в дашборд-редизайн не входит.
- Auto-launch onboarding tour — отдельная задача (ранее предлагалась как quick-win #4 из П12).
- Сегментный layout-toggle (5 view'ов задач в один) — большая архитектурная задача (П12 #6), требует продуктового решения.
- Cross-фильтр / composite-фильтры на действиях — текущий KPI-modal flow остаётся.
- Графики / sparklines / heatmaps на дашборде — не нужны (есть отдельная вкладка `Метрики`).
- Полное переписывание `<div role="button">` KPI-карточек на `<button>` — отдельная техдолг-задача (Interaction §6 пункт 15).

---

## 6. Контракты

- `renderHero` обязан использоваться в `views/dashboard.js` — `tests/unit/views-headers.test.js`. **Сохраняем.**
- KPI-cards остаются кликабельными → modal → Реестр с фильтром. **Сохраняем.**
- `data-target` на KPI-cards — поведение клика остаётся. **Сохраняем.**
- `prizma-empty-glyph()` для empty-state, `breathe`-анимация, signal-палитра — обязательны. **Соблюдаем.**
- 1017 unit-тестов проходят на каждом этапе. **Гарантируем.**

---

## 7. Спорные мнения внутри команды

1. **Visual ↔ IA про KPI-grid:** Visual хочет 4 PRIMARY + 8 SECONDARY = 12. IA хочет 4 KPI вообще. Резолюция: **компромисс Visual** (12 в иерархии trio), потому что (а) сохраняет привычку power-юзеров (Дмитрий 4/5, Игорь 4/5 не страдают), (б) чёткая иерархия 32 vs 20 решает «12 равных» проблему IA.

2. **Interaction ↔ IA про release/progress кликабельность:** Interaction за «всё кликабельно». IA за «только KPI и action-block». Резолюция: **только progress-cards кликабельны в первой итерации**. Release-cards — потом, если данные покажут спрос.

3. **UX ↔ Visual про h1:** UX за «Курс квартала». Visual молчит. Резолюция: **меняем**.

4. **Motion ↔ Interaction про Pulse:** Motion за Pulse на off-course. Interaction беспокоится о fatigue. Резолюция: **3 повтора + cooldown** (один Pulse на одно событие, не запускать снова до взаимодействия).

5. **UX про conditional caption:** оставлен в product-decisions (3.1) — не делаем сейчас.

---

## 8. Метрики успеха

После redesign'а проверить:
- Время «утреннего обзора» (от открытия до понимания статуса) — цель ≤ 15 секунд.
- Конверсия из дашборда в Реестр через KPI-modal CTA — должна вырасти (action-block + KPI-modal handoff).
- Среднее время на дашборде до первого клика — должно сократиться.
- 1017 тестов остаются зелёными после каждой волны.

---

## 9. Резюме

Дашборд из **табло** становится **компасом**: hero (где курс) → action (что требует) → progress (как идём) → status (в каком состоянии). Все 5 экспертов сошлись независимо. Контракты не нарушаются. Tests safe. Объём работ — 7–10 дней при выполнении волнами 1→5.

**Минимальный набор «сделать сейчас» для согласования:** п. 3.1–3.6.