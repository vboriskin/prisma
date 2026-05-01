# 07. Тесты

## Запуск CI

```bash
$ npm run ci
> typecheck && lint && test && test:e2e && perf:budget

# typecheck:    OK (0 errors)
# lint:         332 warnings (within --max-warnings 335)
# test:         testRunner 104/104 + node:test 324/324 + contract 11/11 = 439 passed
# test:e2e:     10/10 passed
# perf:budget:  ✓ All budgets within limits
# rc: 0
```

**Время**: ~25 секунд. Хорошо для CI.

## Покрытие по модулям (интуитивная оценка)

Coverage tool не настроен (есть `--experimental-test-coverage`, но не используется в CI). Прошёлся файлами:

| Модуль | LOC | Тесты | Coverage оценка |
|---|---|---|---|
| `integrations/portfolioPulseUtils.js` | 200 | 31 unit | **80%** — почти все экспорты |
| `integrations/portfolioPulseModel.js` | 823 | 21 unit | **40%** — analysePulse частично, edge-cases слабо |
| `integrations/portfolioPulseInsights.js` | 200 | 26 unit | **70%** — все основные правила |
| `integrations/portfolioPulseBacklog.js` | 72 | 16 unit | **90%** — простой модуль |
| `integrations/portfolioPulseMetrics.js` | 137 | 19 unit | **80%** |
| `integrations/blackDashboardModel.js` | 173 | 17 unit | **80%** |
| `integrations/techInfoRenderer.js` | 617 | 23 unit | **40%** — основные ветки, нет per-section |
| `chat/chatIntentParser.js` | 547 | 30 unit | **60%** |
| `chat/chatPrompts.js` | 349 | 22 unit | **70%** |
| `chat/chatTemplates.js` | 177 | 17 unit | **80%** |
| `ai/aiFallbackEngine.js` | 527 | 22 unit | **30%** — только базовые engines, не все 13 |
| `ai/aiContextBuilder.js` | 97 | 14 unit | **90%** |
| `utils.js` | 190 | 46 unit | **85%** |
| `server.js` | 2612 | 11 contract + 10 e2e | **15%** — happy paths, BB/CF/Sigma не покрыты |
| `app.js` | 2148 | 0 (только legacy 104 inline-mirror) | **0% direct, ~10% mirror** |
| `views/registry.js` | 822 | 0 | **0%** |
| `views/gantt.js` | 1100 | 0 | **0%** |
| `views/metrics.js` | 851 | 0 | **0%** |
| `chat/chatEngine.js` | 699 | 0 | **0%** |
| `chat/chatActions.js` | 411 | 0 | **0%** |
| `ai/aiCeoFallback.js` | 653 | 0 | **0%** |
| `dataStore.js` | 886 | inline-mirror в testRunner | **30% mirror** |

**Густо**: integrations / chat / ai — основные модули покрыты на 60-90%.
**Пусто**: views/* — 0% (renderer'ы), app.js — 0% direct.

## Качество тестов — выборка

Прошёлся по 10 случайным тестам из разных файлов. Ни одного `expect(true).toBe(true)` стиля. Несколько случайных:

1. `tests/unit/portfolioPulseModel.test.js:75` — `analysePulse — happy path → counts a single in-progress issue toward summary.wip`. **Содержательно**: проверяет что summary.wip = 1 для in-progress issue. ✓

2. `tests/unit/utils.test.js:88` — `Utils.parseCSVLine — escaped double-quote inside field ("")`. Проверяет `parseCSVLine('"He said ""hi"""')` → `['He said "hi"']`. **Содержательно**, RFC 4180 corner case. ✓

3. `tests/unit/chatPrompts.test.js:120` — `buildUserPrompt with no active filters renders "— фильтры не активны"`. **Содержательно**, проверяет fallback. ✓

4. `tests/unit/aiFallbackEngine.test.js:44` — `computeBaseMetrics: counts done/active/total correctly`. **Содержательно**.

5. `tests/unit/portfolioPulseInsights.test.js:67` — `empty space → warning`. **Содержательно**, edge-case.

6. `tests/unit/blackDashboardModel.test.js:50` — `null input produces empty model with safe defaults`. **Содержательно**, defensive.

7. `tests/unit/parseDomainLink.test.js:47` — `array of {key} objects → ['PAY-1']`. **Содержательно**, normaliser test.

8. `tests/unit/portfolioPulseUtils.test.js:165` — `formatHrs: < 1 hour returns rounded minutes with cyrillic "м"`. **Содержательно**.

9. `tests/unit/techInfo.test.js:115` — `Cloud-not-supported banner when cloudUnsupported flag set`. **Содержательно**.

10. `testRunner.js:181` (legacy) — `BLOCKING_NEAR_RELEASE when blocker in 1.20`. **Содержательно**.

**Качество — хорошее**. Тесты реально проверяют поведение, не tautology.

## Что не покрыто совсем

| Модуль | Почему |
|---|---|
| `app.js` | God-object, сложно тестировать без refactor |
| `views/registry.js` | renderer + DOM — нужны DOM-тесты (jsdom) |
| `views/gantt.js` | то же |
| `views/metrics.js` | то же |
| `chat/chatEngine.js` | оркестратор + side effects — нужны моки |
| `chat/chatActions.js` | мутирует state — тесты сложные |
| `ai/aiCeoFallback.js` | формирует HTML-блоки — DOM-тесты |
| `server.js` (sigma + black-dashboard endpoints) | contract-тесты не настроены для них |
| `historyManager.js`, `appDataStore.js` | inline в testRunner частично |

## Flaky-tests

```bash
$ grep -n "Date.now()\|Math.random()\|setTimeout" tests/ 2>/dev/null
```

Найдено в тестах:
- `tests/unit/aiContextBuilder.test.js`, `tests/unit/portfolioPulseInsights.test.js`, `tests/unit/portfolioPulseBacklog.test.js` — используют `new Date(Date.now() - X * day_ms).toISOString()`. **Не flaky** — относительные даты, проверяется поведение типа "в этом месяце".
- `tests/helpers/timeFreeze.js` — детерминирующая подмена `Date`. ✓
- `Math.random()` — ни в одном тесте не нашёл.
- `setTimeout` — только в `e2eTest.js` для rate-limit waiter (намеренно).

**Flaky риск низкий**.

## E2E — что покрывают

`e2eTest.js` — 10 тестов:
1. `/health → 200, ok:true, uptime number`
2. `/metrics → counters present`
3. `GET / → index.html`
4. `GET /styles.css → 200 + text/css`
5. `/api/jira/config does not leak tokens`
6. `/health exempt from rate-limit`
7. `Rate-limit triggers 429 on burst`
8. `portfolio-pulse without config → no 5xx`
9. `Unknown jira API → 4xx`
10. `tech-info: rate-limited (429) — endpoint exists and rate-limit applies`

**Покрывают**: health, metrics, static, rate-limit, общие 4xx pathways.

**Не покрывают**:
- Реальный Pulse fetch с настроенным fake Jira (это в contract-тесте, не e2e).
- Black Dashboard endpoint (sigma + delta).
- Tech-info с реальными данными (только 429 path).
- LLM proxy.
- WebSocket / SSE streaming.

## Contract — fake Jira fidelity

Уже разобрал в `06-integrations.md`. Кратко: happy paths OK, error/timeout/pagination scenarios — не покрыты.

## Отсутствует в инфраструктуре

| Что | Зачем |
|---|---|
| Coverage instrumentation | Видеть процент покрытия в CI |
| Mutation testing | Проверять качество тестов (StrykerJS — ставить нельзя без npm-deps) |
| Snapshot testing | Renderer'ы — proof against drift |
| Fuzzing parsers | `_parseDomainLink`, `parseFullCSV` — много вариантов |
| Browser-side e2e (Playwright) | Реальный UI flow |

## Заключение

Категория | Оценка
---|---
Test framework выбор | хорошо — `node:test` без новых deps |
Коэф. покрытия модулей | удовлетворительно — на 60% по основным, 0% по UI и app.js |
Качество (что проверяют) | хорошо — выборка из 10 показала содержательные кейсы |
Flaky risk | хорошо — Date frozen, нет Math.random |
E2E | удовлетворительно — basic paths, нет real Pulse/BD/LLM flow |
Contract fidelity | удовлетворительно — happy path только, no errors |
Coverage tool | плохо — отсутствует в CI |
