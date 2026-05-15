# Призма — brand reference (для разработчиков)

> Эта страница — минимально необходимое для разработчика, который пишет код в `prisma_new_design`. Полный brandbook с обоснованием каждого решения — в [`my_prisma-brand/BRAND_BOOK.md`](../my_prisma-brand/BRAND_BOOK.md). Здесь только то, что нужно знать чтобы НЕ сломать дизайн при добавлении нового view.

---

## 1. Метафора и слоган

- **Метафора**: Северная звезда. Команда сверяет курс по ориентиру, а не следует за ярким маркером.
- **Слоган**: «Северная звезда для вашей команды.»
- **Знак**: 8-лучевая Northstar (главные 4 + диагональные 4 + ядро). См. `assets/brand/star.svg` или helper `starSvg()` из `app/prizmaUI.js`.

---

## 2. Информационная архитектура — 5 модулей

Источник: `app/appSettings.js` → `MODULES`. Менять структуру там, не в sidebar HTML.

| Slug      | Label        | Default section   | Sub-sections |
|-----------|--------------|-------------------|--------------|
| `course`  | Курс         | `dashboard`       | dashboard / summary / metrics / insights |
| `path`    | След пути    | `registry`        | registry / gantt / kanban / timeline / podlozhka / history |
| `team`    | Команда      | `employees`       | employees / burnout / component-health |
| `goals`   | Цели         | `ai-ceo`          | ai-ceo / actions / ai |
| `rituals` | Ритуалы      | `est-calibration` | est-calibration / doc-debt / integrations / diagnostics / errors |

Slug всегда английский (resolved 2026, см. `design-audit/redesign-my-prisma/00-PLAN.md`). Label — русский.

```js
import { getModuleForSection, getModuleLabel, getSectionLabel } from './app/appSettings.js';

getModuleForSection('gantt');   // → 'path'
getModuleLabel('path');         // → 'След пути'
getSectionLabel('gantt');       // → 'Гант'
```

---

## 3. Палитра

Полные токены: `theme.css` (root) + `my_prisma-brand/tokens/colors.json`. Используй CSS-переменные, не hex.

### Core
- `--prizma-bg` (Night `#0A0A0F` / Paper `#FAFAF8`) — главный фон, 60%.
- `--prizma-surface` (Twilight `#1A1A22` / Snow `#FFFFFF`) — карты, 20%.
- `--prizma-mark` (Star `#FFFFFF` / Ink `#1A1A22`) — знак и заголовки.
- `--prizma-mist` (`#5A5A64` / `#7A7A82`) — подписи.

### Signal — только для статуса курса
- `--signal-on-course` — на курсе.
- `--signal-drift` — дрейф.
- `--signal-off-course` — курс потерян.
- `--signal-information` — нейтральный сигнал.
- `--signal-insight` — найден неочевидный паттерн.

**Запрещено**: signal-цвета как декорация, чистый `#000000` (используй Ink), чистый `#FFFFFF` на светлом фоне (используй Snow), legacy gradients.

Legacy `var(--accent)` всё ещё работает через shim в `styles.css` (~строка 122) → разрешается на `--prizma-mark`. Bulk-rename отложен (риск 44k LOC).

---

## 4. Типографика

- **Заголовки + UI**: SF Pro Display (system fallback `-apple-system, ui-sans-serif`).
- **Числа**: JetBrains Mono с `font-feature-settings: "tnum"`. Все KPI / метрики / таблицы.
- Никаких Plus Jakarta, EB Garamond — старый бренд-пак (`design-audit/prisma-brand/`) deprecated.

CAPS sub-headers — 9-10px, letter-spacing 0.6-0.7px (legacy V15 spine-pill style сохранён).

---

## 5. Page-template — каждый раздел рендерит шапку

`app/prizmaUI.js#renderPageHeader(sectionKey, opts)` собирает eyebrow `«{МОДУЛЬ} · {РАЗДЕЛ}»` + h1 + опц. sub + hairline.

```js
import { renderPageHeader, renderHero } from './app/prizmaUI.js';

container.innerHTML = renderPageHeader('dashboard', {
  sub: 'Q2 2026 · обновлено только что',
});
```

Hero-блок (звезда + большой KPI + caption) — только на главных экранах модулей (Курс / Цели):

```js
container.innerHTML += renderHero({
  kpi: '57.7%',
  caption: 'КУРС КВАРТАЛА',
  supporting: [
    { num: 12, label: 'эпиков на курсе' },
    { num: 3,  label: 'дрейф' },
  ],
});
```

`opts.sub` и `opts.title` экранируются через `escapeHtml` — XSS-safe (см. tests/unit/prizmaUI.test.js).

---

## 6. Motion — 4 жеста

| Жест    | Когда                                        | Длительность | Easing                                |
|---------|----------------------------------------------|--------------|---------------------------------------|
| Emerge  | первое появление знака (splash, page load)   | 1100ms       | `cubic-bezier(.16,1,.3,1)`            |
| Breathe | idle, всегда (hero, mark в topbar)           | 4000ms loop  | `ease-in-out`, scale 1↔1.04, opacity .85↔1 |
| Pulse   | пришла нотификация / дрейф                   | 1600ms loop  | `ease-out`, кольцо scale .4→1.6       |
| Align   | смена модуля / контекста                     | 1600ms       | `cubic-bezier(.34,1.56,.64,1)` spring |

Принципы:
1. Никаких bounce, кроме align (лёгкий spring).
2. **Уважать `prefers-reduced-motion`** — breathe и pulse должны остановиться. Проверка обязательна для каждого нового анимируемого элемента.
3. Одна анимация за раз. Emerge → Breathe → Pulse / Align → возврат в Breathe.
4. Breathe — default idle. Другие жесты накладываются поверх и возвращают в него.

CSS keyframes готовы в `theme.css` — не пиши свои, используй классы.

---

## 7. Loaders — иерархия

| Уровень | API                                | Когда             | Где брать |
|---------|------------------------------------|-------------------|-----------|
| L1      | `inlinePulseLoader(label?)` → HTML | действие 300ms-2s | `app/prizmaUI.js` |
| L2      | `showPageLoader(caption?)` → handle| ожидание 2-6s     | `app/prizmaUI.js` |
| L3      | `.prizma-skeleton` CSS-классы      | первичная загрузка списков/таблиц | `styles.css` |

```js
const loader = showPageLoader('Сверяем курс…');
// ...await fetch...
loader.setCaption('Применяем изменения…');
loader.close();
```

Обновления callsites idle-handler'ов — отдельная задача (loaders доступны, но в action handlers ещё не везде вызываются).

---

## 8. Toasts и tone of voice

`showPrizmaToast(message, state, duration)` — нотификация в правом нижнем, auto-dismiss.

State'ы: `info` / `ok` / `drift` / `error` / `insight`.

### Словарь — компасная метафора, не «сохранение»

| Хорошо                              | Плохо                                  |
|-------------------------------------|----------------------------------------|
| «Курс сверен»                       | «✓ Сохранено»                          |
| «Замечен дрейф в проекте Atlas»     | «ВНИМАНИЕ! 3 задачи просрочены!»       |
| «14 дней до цели. Курс выдерживается»| «Осталось 14 дней!! Не подведите!»    |
| «Команда сверяет курс на пятницу»   | «Проведите ретро в пятницу плиз»       |
| «Курс не сверен: переполнено локальное хранилище» | «Сохранение не выполнено: QuotaExceeded» |

Векторы голоса: спокойный, уверенный, точный, тёплый. На «вы». Никаких эмодзи в production UI (✓ только в emoji-палитре).

---

## 9. Файлы — карта

| Что                                   | Где                                                     |
|---------------------------------------|---------------------------------------------------------|
| Root design tokens                    | `theme.css`                                             |
| Legacy → prizma shim                  | `styles.css` (~строка 122)                              |
| Звезда / wordmark / app icon          | `assets/brand/{star,star-wordmark,app-icon-ios}.svg`    |
| Иконки модулей                        | `assets/brand/modules/{course,path,team,goals,rituals}.svg` |
| Favicon                               | `favicon.svg` (16×16 star)                              |
| UI helper'ы (header/hero/loader/toast)| `app/prizmaUI.js`                                       |
| Структура IA                          | `app/appSettings.js` → `MODULES`                        |
| Splash overlay                        | `index.html` + `styles.css` (фазы EMERGE → SETTLE → EXIT, 2400ms) |
| Полный brandbook                      | `my_prisma-brand/BRAND_BOOK.md`                         |
| План редизайна                        | `design-audit/redesign-my-prisma/00-PLAN.md`            |
| Старый Editorial бренд (DEPRECATED)   | `design-audit/prisma-brand/DEPRECATED.md`               |

---

## 10. Чек-лист при добавлении нового view

1. ✓ Sidebar — раздел зарегистрирован в `MODULES` в `app/appSettings.js`.
2. ✓ Page-header — первая строка innerHTML это `renderPageHeader('your-section')`.
3. ✓ Hero — только если это default-section модуля.
4. ✓ KPI — JBM-моноширинные цифры (`.prizma-num` / `font-feature-settings: "tnum"`).
5. ✓ Анимации respect `prefers-reduced-motion`.
6. ✓ Color: только CSS-переменные, никаких hex.
7. ✓ TOV: «курс / траектория / дрейф», не «сохранено / ошибка».
8. ✓ Тесты: snapshot на header → `tests/unit/prizmaUI.test.js` уже покрывает helper, новый view добавляет regression-тест если рендерит свой HTML.

---

## Связанные доки

- [`spine-pill.md`](./spine-pill.md) — V15 design principles (legacy, ещё применимы для tabular UI).
- [`sigma-isolation.md`](./sigma-isolation.md) — ADR: Sigma Jira используется только Чёрным дашбордом.
- [`domain-glossary.md`](./domain-glossary.md) — Delta/Sigma Jira, scope, релизы.
