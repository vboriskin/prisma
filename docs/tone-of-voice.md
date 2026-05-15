# Tone of Voice — Призма

> Реализация AU5 (`AUDIT_HOLISTIC.md` строка 87): tone-of-voice линт
> LLM-output. Сводка правил из
> [`my_prisma-brand/BRAND_BOOK.md` §7](../my_prisma-brand/BRAND_BOOK.md).
>
> - Модуль: [`chat/toneOfVoiceLint.js`](../chat/toneOfVoiceLint.js)
> - Точка подключения: [`chat/chatUIRenderer.js`](../chat/chatUIRenderer.js)
>   → `parseStructuredFromLLM` (один pass на final-text после splitting JSON-блока)
> - Тесты: [`tests/unit/tone-of-voice-lint.test.js`](../tests/unit/tone-of-voice-lint.test.js)
> - Режим (opt-in): `localStorage['prizma.llm.lint'] = 'off' | 'warn-only' | 'on'`.
>   Default — `warn-only`: текст не модифицируется, только лог в `console.debug`
>   и (если есть) `Telem.track('llm.tov_violation', …)`.

## Четыре вектора голоса (BRAND_BOOK §7)

| Хорошо | Плохо |
|---|---|
| Спокойный | Тревожный |
| Уверенный | Хвастливый |
| Точный | Многословный |
| Тёплый | Безразличный |

## Отношение к пользователю

| Хорошо | Плохо |
|---|---|
| Партнёр | Учитель |
| Информирует | Уговаривает |
| Уважает время | Требует внимания |
| На «вы» | На «ты», fam |

## Словарь Призмы

- **Цели и направления**: курс, траектория, ориентир, точка отсчёта, азимут команды, направление.
- **Состояния**: на курсе, в траектории, дрейф, отклонение, сбился с курса, держать ритм.
- **Действия**: сверить курс, уточнить ориентир, увидеть путь, выбрать направление, скорректировать траекторию, следить за дрейфом.

## Правила линта (`chat/toneOfVoiceLint.js`)

Все правила включены по умолчанию, отключаются через
`lintLlmOutput(text, { disable: { R2: true } })`.

| ID | Что ловит | Action | Алгоритм |
|---|---|---|---|
| **R1** | Эмодзи (Unicode emoji-блоки + flags + variation selectors + surrogate pairs) | strip (если `mode='on'`) или warn | Объединённый regex по диапазонам U+1F300-1FAFF, U+2600-27BF и surrogate-парам `\uD83C-\uD83E`. Не ловит `→` `↻` `±` (используются в UI). |
| **R2** | Английские термины: `task / blocker / scope / release / sprint / standup / milestone / backlog / deadline / feature / roadmap / PR` (15 слов) | warn + suggest русский эквивалент | Per-term: `\b<en>\b/gi`, case-insensitive |
| **R3** | Overuse брендовой фразы «Курс сверен» (>1 раза в одном ответе — паттерн 10 в `AUDIT_HOLISTIC.md` строка 33) | warn | `(text.match(/курс\s+сверен/gi) \|\| []).length > 1` |
| **R4** | Кричащие формы: `!!!`, `ВНИМАНИЕ` / `ВАЖНО` / `СРОЧНО`, «Действуйте сейчас», «Не подведите команду» | warn + suggest нейтрализацию | Composite: `!{3,}` + Cyrillic-aware lookaround `(?:^\|[^A-Za-zА-Яа-яЁё])(ВНИМАНИЕ\|...)` (т.к. JS `\b` ASCII-only) |
| **R5** | «ты»-формы: `привет / делай / сделай / возьми / напиши / посмотри / скажи / ты можешь \| должен \| видишь \| хочешь` | warn + suggest «вы»-форму | Per-term: `(?:^\|[\s,;.:!?(])(<word>)(?=[\s,;.:!?)]\|$)/gi` |

### Хорошо (lint — clean)

```
Команда сверяет курс на пятницу.
Замечен дрейф в проекте Atlas — предлагаю пересмотреть план.
14 дней до цели. Курс выдерживается.
Здравствуйте. Сделайте задачу, посмотрите детали.
```

### Плохо (lint находит)

| Вход | Найдено | Hint |
|---|---|---|
| `Готово 🚀, blocker найден.` | R1 + R2 | strip emoji; «blocker» → «блокер / препятствие» |
| `Привет! Делай задачу.` | R5 ×2 | «привет» → «здравствуйте»; «делай» → «сделайте» |
| `ВНИМАНИЕ! 3 задачи просрочены!!! Действуйте сейчас.` | R4 ×3 | all-caps как крик; `!!!` лучше избегать; «действуйте сейчас» — давление |
| `Курс сверен. План готов. Курс сверен повторно.` | R3 | оставьте 1 раз; для остальных — нейтральные success-формулы |
| `Need to set scope on the sprint.` | R2 ×2 | «scope» → «объём / границы»; «sprint» → «спринт» |

### API

```js
import { lintLlmOutput, applyDefaultLint } from './chat/toneOfVoiceLint.js';

// Низкоуровневый — для тестов / редакторов промптов:
const { text, warnings } = lintLlmOutput(rawText, {
  stripEmoji: true,                  // default false
  disable:    { R3: true, R5: true } // optional
});

// Middleware-форма — используется в chatUIRenderer:
const { text: outText, warnings, mode } = applyDefaultLint(rawText);
// mode = 'off' | 'warn-only' | 'on' (из localStorage['prizma.llm.lint'])
```

`warnings[]` — массив `{ rule, snippet, match?, hint? }` для последующего лога /
телеметрии (`Telem.track('llm.tov_violation', …)`) / отображения в UI редактора
промптов.

## Главный слоган

> «Северная звезда для вашей команды.»

Альтернатива для лендинга: «Команды теряются в задачах. Призма даёт ориентир.»

## Примеры

| Хорошо | Плохо |
|---|---|
| «Команда сверяет курс на пятницу» | «Кто-нибудь, проведите ретро в пятницу плиз» |
| «Замечен дрейф в проекте Atlas» | «ВНИМАНИЕ! 3 задачи просрочены, срочно действуйте!» |
| «Призма видит, куда движется команда» | «Лучшая в мире платформа для команд 🚀» |
| «14 дней до цели. Курс выдерживается» | «Осталось 14 дней!! Не подведите команду!» |

---

См. полный brandbook: [`../my_prisma-brand/BRAND_BOOK.md`](../my_prisma-brand/BRAND_BOOK.md) §7.
См. [`brand.md`](./brand.md) — что нужно знать разработчику чтоб не сломать дизайн.
См. [`spine-pill.md`](./spine-pill.md) — визуальный язык V15+.
