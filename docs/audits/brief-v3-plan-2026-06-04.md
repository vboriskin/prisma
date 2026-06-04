# Бриф v3.0 — план реализации

**Дата:** 2026-06-04
**Источник:** Аудит 7 экспертов (Agile coach / Tim Lead / UX / Data Analyst / QA / Editor / Product Consultant)
**Headline аудита:** *Бриф визуально уравнивает 15 сотрудников и заставляет тимлида кликать каждого, хотя все сигналы риска (blockers, stale, classifyPerson, actionQueue) уже посчитаны.*

**One-liner:** *Перенести уже посчитанные сигналы наружу: status-dot + 3-4 числовых badge в строку, KPI-полоса и Attention Queue в header, плюс закрыть базовую гигиену артефакта (Markdown-копирование, print-CSS, fallback при падении LLM) — без новых данных, без перегруза UI.*

---

## Стратегия

**Бриф v2.0 сохраняется** — добавляем третий пункт в kebab. V3 — это not-replacement, а evolution. Тимлид может попробовать обе версии и оставить V3 как новую дефолт-выгрузку. V2 удалим спустя 2 недели после стабилизации.

**V3 файл:** `integrations/teamScanner2BriefExportV3.js`
**Не трогаем:** V2 (`teamScanner2BriefExportV2.js`), assistant-rules/render/llm (общий пул)
**Переиспользуем:** `composeDailyBriefMarkdown`, `buildActionQueue`, `classifyPerson`, `_extractPanelSections` (heatmap), `_render72hHTML` (assistant section)

---

## Структура V3 (сверху вниз)

```
┌─────────────────────────────────────────────────────────────────┐
│ Бриф · Команда X · 04.06.2026                       [Тема][MD]  │  ← header
│ Снимок: 2 часа назад · окно 72ч · 12 сотрудников               │
│                                                                  │
│ Курс: дрейф −9pp │ Стоп: 4 │ Блокеры: 7 / макс 96ч │ Burn: 2 │  ← KPI-полоса
│ Закрыто/сутки: 12 │ LLM: 11/12 OK                              │
├─────────────────────────────────────────────────────────────────┤
│ ⚠ 2 сотрудника без jiraAccountId — пропущены. Проверьте Реестр. │  ← identity-banner (если есть)
├─────────────────────────────────────────────────────────────────┤
│ КОМУ ПОМОЧЬ СЕГОДНЯ                                              │
│ ┌─ Иванов · PRZM-12 висит 47ч ──┐ ┌─ Петров · WIP=6 ──┐ ┌─...─┐│  ← attention strip
├─────────────────────────────────────────────────────────────────┤
│ Сортировка: [По риску]✓ [По алфавиту] [По активности]            │
│ Фильтр:    [Все]✓ [Стоп 4] [Наблюдают 3] [Тихо 2]               │  ← sort + filter chips (sticky)
├═════════════════════════════════════════════════════════════════┤
│ ▌Иванов И.И.                BLK·2 STL·1 WIP·5 →stop ✕LLM       ▾│  ← roster row
│ │Петров П.П.                              WIP·3 DONE·1         ▾│
│ │Козлов Д.Д.                              CTX·12               ▾│
│ ...                                                              │
└─────────────────────────────────────────────────────────────────┘
```

### При раскрытии сотрудника:

```
▌Иванов И.И.                BLK·2 STL·1 WIP·5 →stop ✕LLM      ▴
├─ БЛОКЕРЫ (Нужна помощь по 2 задачам)                            ← elevated, сверху
│  • PRZM-12 «Авторизация» застряло 47ч (порог 24ч, ×1.96) High  │
│  • PRZM-19 «Settings UI» застряло 36ч (порог 24ч, ×1.50) Med   │
├─ Что делал вчера (Сгенерировано GigaChat)                       ← Сводка ассистента
│  [LLM narrative или fallback «Сгенерировано rule-engine»]        │
│  ↓ Подробнее (свёрнуто)                                          │
├─ Что делает сегодня (Сгенерировано GigaChat)                    │
│  [LLM narrative или fallback]                                    │
│  ↓ Подробнее (свёрнуто)                                          │
├─ Заметка тимлида                                                 ← contenteditable
│  [_______________________________________]                       │
├─ События за 72 часа ▾ (свёрнуто)                                │
└─ Активность по источникам [heatmap]                             │
```

---

## P0 фичи (8 шт, все must)

### 1. KPI-полоса в шапке
**Файл:** `_buildKpiBand(model, ctx)` в V3
**Источник данных:** уже посчитано — `computeSprintConfidence`, `computeBlockerMTTR`, `actionQueue`, `computeTeamHealthScore`, `classifyPerson` counts.
**Ячейки (скрываются, если NULL):**
- **Курс**: `dpace` от `aggregatePace` (e.g., «дрейф −9pp» — формат «{знак}{abs}pp» от 0)
- **Стоп**: count classifyPerson==='stop'
- **Блокеры**: сумма `blockers.length` + макс `dwellHours`
- **Burnout-high**: count `personMetrics.burnout.level==='high'`
- **Закрыто/сутки**: сумма `closedToday + closedYesterday`
- **LLM**: «N/M OK» (N успешных из M)
- **Снимок**: формат «X ч назад» от `ctx.fetchedAtMs`

**Дизайн:** mono-tabular, 60px высота, серый текст / акцентные числа. Без рамки.

### 2. Identity-banner (если есть unmatched)
**Источник:** `model.scannerV2.identityResolve.{unmatched, blocked}` (уже есть в Сканнере)
**Условие:** `unmatched.length > 0 || blocked.length > 0`
**Текст:** «⚠ Внимание: N сотрудников без jiraAccountId — пропущены. K заблокированы. Проверьте Реестр или identity-mapping.»
**Стиль:** drift-tone (янтарный stripe-left), свёрнутый список по клику

### 3. Attention strip — top-3 «Кому помочь»
**Источник:** `model.scannerV2.actionQueue` (top-5, берём первые 3)
**Каждый chip:** ФИО · причина 1 строкой («PRZM-12 висит 47ч», «WIP=6», «burnout high»)
**Интеракция:** клик → скролл к карточке + auto-open detail
**Цвет:** severity-based (red/amber)
**Если actionQueue пуст:** «Команда в порядке — нет требующих внимания» (нейтральный текст)

### 4. Status-dot + Risk badges в строке
**Status-dot:** 3px stripe-left, классификация `classifyPerson(p)`:
- `stop` → red
- `watch` → amber
- `moving` → green
- `idle` → grey

**Risk badges (mono-tabular, цифра + лейбл, фиксированная ширина):**
- `BLK·N` — `p.blockers.length` (red если ≥1)
- `STL·N` — `p.stale.length` (amber если ≥1)
- `WIP·N` — `p.issuesNow.length` (bold если ≥4)
- `DONE·N` — `closedToday + closedYesterday` (green если ≥1)
- `CTX·N` — `p.contextSwitches.distinctIssueKeys` (grey, без подсветки)

Нули не рендерятся (data-ink ratio).

### 5. Data-quality pill в строке
**Логика:**
- Если `!p.jiraAccountId` → «Не сматчен»
- Если `LLM не ответил для этого человека` → «✕ LLM»
- Если `timeline72h.length===0 && badges.commits48h===0` → «Нет данных»
- Если только часть интеграций сматчена → «Только {what}»
- Иначе ничего

**Стиль:** мелкий монохромный pill, grey-amber. Не агрессивный, скорее предупреждающий.

### 6. Кнопки «Скопировать как Markdown»
**Header-кнопка:** «Копировать всю команду» — рядом с переключателем темы.
**Per-person кнопка:** на hover строки (mini-icon).
**Источник:** `composeDailyBriefMarkdown(model, ctx)` уже написан.
**Формат:** H2 ФИО, H3 Вчера/Сегодня/Блокеры, bullets с KEY + summary, footer «Источник: Бриф {team} от {date}».
**Реализация:** `navigator.clipboard.writeText()` + предсобранный MD в `data-md` атрибуте.

### 7. Print CSS
**Правила:**
- Все `details` раскрыты при печати
- Скрыть chevron, theme-toggle, MD-кнопки, copy-buttons
- Force light theme
- `page-break-inside: avoid` на `.briefv3-person`
- `@page` counters в footer «Бриф {team} · стр. X»
- Heatmap grayscale-safe (полупрозрачный + символы внутри)

### 8. Deterministic fallback вместо «Сводка недоступна»
**Когда LLM упал:**
- Вместо `<div class="ts2-assistant-error">Сводка недоступна</div>`
- Показываем deterministic-сводку:
  ```
  Вчера: закрыл N задач, залогировано Xч, K коммитов, P PR.
  Сегодня в работе: список issuesNow с key + summary.
  ```
- Inline-warning: «Сгенерировано rule-engine, GigaChat не ответил»
- Визуальная рамка-метка (серая 2px slash-pattern)

---

## P1 фичи (отобранные, ~5 шт)

### 9. Блокеры — отдельный блок в верху раскрывашки
**До:** Сводка ассистента (LLM может галлюцинировать про блокеры)
**Формат каждого блокера:**
- KEY · summary
- «застряло Xч (порог Yч, ×Z.NN)» — где Z = dwell/threshold ratio
- priority badge
- цвет: amber (1.0-1.5×), orange (1.5-2×), red (>2×)
**Sort:** by dwell/threshold ratio desc

### 10. Sort chips + Filter chips
**Sort chips** (sticky под header):
- «По риску» (default) — severity weight `blockers·10 + stale·3 + ctxSwitches·1`
- «По алфавиту» — name asc
- «По активности» — `sum(timeline72h)` desc

**Filter chips:**
- «Все» (default)
- «Стоп N» — toggle visibility (CSS-only, без re-render)
- «Наблюдают M»
- «Тихо K» (idle)

Один sort и один filter активны одновременно.

### 11. Diff-arrow vs вчера
**Источник:** `model.scannerV2.yesterdayGroups[p.key]` (если есть prev snapshot)
**Логика:** если `classifyPerson(p) !== yesterdayGroup` → arrow chip
- Был `moving`, стал `stop` → `↓stop` (red)
- Был `stop`, стал `moving` → `↑moving` (green)
- Иначе → ничего

**Только когда есть событие** — без шума.

### 12. Cross-team badge «ext N»
**Источник:** `model.scannerV2.crossTeamDeps[p.key]` (если есть)
**Условие:** есть блокеры с external team
**Tooltip:** список «KEY · команда»
**Цвет:** insight (фиолетовый)

### 13. Заметка тимлида (contenteditable)
**Расположение:** ровно после «Что делает сегодня», до Событий 72ч
**Persistence:** `localStorage` ключ `briefv3.note.{teamKey}.{personEmail}.{exportDate}`
**Placeholder:** «Темы для 1:1 / решения с Daily»
**В Markdown-копировании:** включается как блок «**Комментарий руководителя:**»
**В print:** видна как блок

---

## Что НЕ делаем (по решению аудита)

- ❌ Сводная таблица команды в конце документа — дублирует функционал badges в строке
- ❌ Скрытие narrative GigaChat за toggle — narrative ценится, лучше fallback + transparency
- ❌ Сжатие heatmap 72×4 до 72×1 — теряем breakdown
- ❌ Подзаголовок «logged 6.5ч / ctx-switches» отдельной строкой под ФИО — дублирует badges

---

## Технические детали

### Файлы создаём/меняем

| Файл | Тип | Что |
|---|---|---|
| `integrations/teamScanner2BriefExportV3.js` | **создаём** | Главный модуль с `exportTeamBriefV3` |
| `integrations/teamScanner2.js` | edit | Kebab-item «Бриф v3.0» + `_exportBriefV3` |
| `integrations/teamScanner2Renderer.js` | edit (мелочи) | (не должно, переиспользуем) |
| `styles.css` | edit | Стили `.briefv3-*` (ограничены) |

### Архитектурный контракт

```js
exportTeamBriefV3(model, {
  teamLabel: string,
  context: {
    history, prev, employees, userEmail, fetchedAtMs,
  },
  assistantByKey: Map<key, html>,
  llmStatusByKey: Map<key, 'ok'|'failed'|'skipped'>,
})
```

### Сборка identity-banner данных
В существующем коде это `model.scannerV2.identityResolve.{unmatched, blocked}`.
Если нет — derive из `participants.filter(p => !p.jiraAccountId)`.

### Сборка KPI-полосы
В `_buildContext`/header'е:
```js
const counts = participants.reduce((acc, p) => {
  acc[classifyPerson(p)]++;
  acc.blockers += (p.blockers || []).length;
  acc.closedToday += closedToday(p);
  acc.maxDwell = Math.max(acc.maxDwell, ...((p.blockers||[]).map(b => b.dwellHours || 0)));
  return acc;
}, { stop: 0, watch: 0, moving: 0, idle: 0, blockers: 0, closedToday: 0, maxDwell: 0 });
```

### Markdown formatter
Переиспользуем `composeDailyBriefMarkdown(model, ctx)` из `teamScanner2Insights.js` — уже написан. Если для конкретного сотрудника нужен per-person — вызвать частный variant или собрать руками из `composePersonNarrative(p)` + `_render72hHTML` (markdown-stripped).

### LLM status tracking
В `_exportBriefV3` после Promise.allSettled — записать `llmStatusByKey.set(p.key, success ? 'ok' : 'failed')`. Передать в render для data-quality pill.

---

## Acceptance criteria

✅ Открывается в браузере, не падает консоль
✅ Theme toggle переключает dark/light, сохраняет в localStorage
✅ KPI-полоса показывает все 6 чисел (или скрывает NULL)
✅ Identity-banner появляется только при unmatched > 0
✅ Attention strip показывает top-3 (или fallback-сообщение)
✅ Risk badges в строке: BLK/STL/WIP/DONE/CTX, нули скрыты
✅ Status-dot цветной по classifyPerson
✅ Data-quality pill для проблемных кейсов
✅ Sort chips переключают порядок без re-render
✅ Filter chips прячут строки CSS-toggle
✅ Раскрытие — Блокеры сверху + assistant + events + heatmap
✅ Fallback вместо «Сводка недоступна»
✅ Markdown copy работает (clipboard + alert)
✅ Print CSS — Cmd+P даёт читаемый документ
✅ Заметка тимлида редактируется, сохраняется
✅ Diff-arrow в строке (если есть prev snapshot)
✅ Cross-team badge (если есть deps)

---

## Roadmap после V3

После показа руководству и собранного фидбэка — V3.1 решит:
- Sparkbar активности 72ч в строке (compressed heatmap)
- Filter «Я закрыл это» — личный чекбокс per Daily
- Holiday-aware messaging для понедельника
- Window-size guard (warning при sinceDate > 7 дней)

---

**Время оценка:** 2-3 часа автономной работы.
**Готовность к показу:** к утру 2026-06-05.
