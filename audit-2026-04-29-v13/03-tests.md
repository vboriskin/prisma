# 03. Tests

## Текущее состояние

| Layer | Файл/директория | Тестов | Статус |
|---|---|---|---|
| **Inline mirror** | `testRunner.js` | **104** | ⚠️ тестирует ИНЛАЙН-копии, не реальный код |
| Unit (node:test) | `tests/unit/*.test.js` (16 файлов) | 373 | ✓ работает |
| Contract | `contractTest.js` (root, не в `tests/contract/`) | 11 | ✓ работает, но через `node contractTest.js`, не `npm run test:contract` |
| Contract (declared) | `tests/contract/**/*.test.js` | **0** | ⚠️ директория ПУСТАЯ |
| E2E | `e2eTest.js` | 10 | ✓ работает (запускает реальный сервер на 19099) |
| Coverage | `--experimental-test-coverage` | available | не настроено в CI |
| **Итого** | | **494** | ↑ количество растёт; ↓ покрытие по domain modules — пропуски |

---

## TST-1 [H] testRunner.js — фантомные 104 теста

**Уже разобрано в `02-reliability.md` (REL-3)**.

TL;DR: testRunner.js содержит inline-копии `RiskEngine`, `FilterEngine`, `applyBulkAction`, `Reactive`, и др. Тесты гоняются на копиях. Реальные модули `riskEngine.js`, `filters.js`, `dataStore.js`, `state.js`, `rowFactory.js`, `reactiveStore.js` НЕ имеют тестов в `tests/unit/`.

В V12 audit рекомендации #20 признали coverage gap (jsdom UI-тесты), но **по domain modules (без UI)** дело даже хуже:

| Модуль | LOC | Test file | Реально тестируется? |
|---|---|---|---|
| `riskEngine.js` | 53 | `testRunner.js` (inline-mirror) | ❌ inline-only |
| `filters.js` | 119 | `testRunner.js` (inline-mirror) | ❌ inline-only |
| `rowFactory.js` | 124 | — | ❌ нет |
| `reactiveStore.js` | 145 | `testRunner.js` (inline-mirror) | ❌ inline-only |
| `state.js` | 207 | — | ❌ нет |
| `dependencyEngine.js` | 33 | — | ❌ нет |
| `metricsEngine.js` | 38 | — | ❌ нет |
| `insightEngine.js` | 50 | — | ❌ нет |
| `historyLog.js` | 154 | — | ❌ нет |
| `dataStore.js` | 904 | — | ❌ нет |
| `appDataStore.js` | 226 | — | ❌ нет |

**6 из 11 domain modules вообще без тестов**. 5 имеют только inline-mirror, который не отвалится при изменении настоящего кода.

**Рекомендация**:
- **Step 1** (S, 1-2h): для каждой группы тестов в testRunner.js завести соответствующий `tests/unit/X.test.js` с реальным `import`. Проверить что все тесты по-прежнему зелёные.
- **Step 2** (S): удалить testRunner.js и убрать его из `npm test`.
- **Step 3** (M): docстроки + edge-case тесты для модулей, которые тестов вообще не имели.

---

## TST-2 [H] `tests/contract/` — пустая директория, `npm run test:contract` отрабатывает с 0 тестами

**Файл**: `package.json:scripts.test:contract`

```json
"test:contract": "node --test --test-reporter=spec 'tests/contract/**/*.test.js'"
```

```
ℹ tests 0
ℹ pass 0
ℹ fail 0
ℹ duration_ms 4.999292
```

Реальные contract-тесты живут в `contractTest.js` в корне и запускаются через `node contractTest.js` внутри `npm test`. Скрипт `test:contract` **никуда не ведёт**, но в CI создаёт впечатление, что contract-тесты «прошли».

**Severity**: H (обманчивый CI signal).

**Рекомендация**:
- (а) Перенести `contractTest.js` в `tests/contract/integrations.test.js`, переписав на `node:test` API. Унифицировать со всем остальным.
- (б) Или — если переписывать дорого — поправить script:
  ```json
  "test:contract": "node contractTest.js"
  ```

---

## TST-3 [M] e2e не валидирует ответ tech-info / black-dashboard под реальной нагрузкой (только rate-limit)

**Файл**: `e2eTest.js`

E2E rapid-fire бьёт по `/api/integrations/tech-info` 7 раз и проверяет, что один из ответов 429. Но «happy path» (что endpoint вообще существует и не 500) **не проверен** — нет конфига Jira-fake.

```js
✓ tech-info: rate-limited (429) — endpoint exists and rate-limit applies
```

Контракт-тест это покрывает (через fake Jira), но e2e не пересекается с contract-тестом — они в разных средах.

**Severity**: M (e2e не «чёрный ящик», как должен быть).

**Рекомендация**: либо переиспользовать fake-Jira из `contractTest.js` в e2e (одна общая инфраструктура), либо добавить в e2e отдельный тест с замоканным jira_config.json.

---

## TST-4 [M] Coverage не запускается в CI

**Файл**: `package.json`

```json
"test:coverage": "node --test --experimental-test-coverage --test-reporter=spec ..."
"ci": "npm run typecheck && npm run lint && npm run test && npm run test:e2e && npm run perf:budget"
```

`test:coverage` есть как команда, но **не запускается** в `ci`. Нет порога, нет тренда, нет видимости.

**Severity**: M.

**Рекомендация**:
1. Добавить `npm run test:coverage` в ci.
2. Парсить `--test-coverage`-output в `scripts/coverageBudget.js` (по аналогии с `perfBudget.js`).
3. Стартовый порог: 50% line-coverage по `chat/`, `integrations/`, `views/aiCeoFallback.js` (по факту что есть). Постепенно растить.

---

## TST-5 [M] Активити-handler (V13) — тестов нет

**Файл**: `chat/chatActivityHandler.js` (243 LOC), тестов 0.

Тесты у `chatActivityIntents.js` (24) и `chatActivityPrompts.js` (25) есть. Но **handler** — тот самый orchestrator с 6 ветками switch — не покрыт.

**Эффект**: легко регресснуть в:
- неправильное `needsClarification` сообщение
- забытый `dataBlock` build для нового intent
- кейс `pulseModel === null`

**Severity**: M.

**Рекомендация**: добавить `tests/unit/chatActivityHandler.test.js`, ~15-20 тестов:
- Без pulseModel — все 6 intent'ов возвращают разумные ответы
- С минимальным mock pulseModel — каждый intent возвращает `{systemPrompt, userPrompt}`
- needsClarification ветки — каждая упомянута

Это `chat/chatEngine.js process()` тоже без unit-тестов (700 LOC) — это **уже** в audit recommendation #12. В V13 не сделано.

---

## TST-6 [L] Параллелизация / порядок зависимостей в node:test

**Файл**: `tests/unit/parseDomainLink.test.js`

Использует `before(() => { src = readFileSync(...); })` — корректно, **но**: после декомпозиции (V13) тест читает `server/integrations/blackDashboard.js`. Если структура файлов поменяется опять — тест ломается с непрозрачным сообщением.

**Эффект**: hidden coupling между тестом и file path.

**Severity**: L.

**Рекомендация**: экспортировать `_parseDomainLink` напрямую (см. SEC-6).

---

## TST-7 [L] Отсутствие property-based / fuzzing тестов

**Текущее состояние**: только example-based.

Множество мест в codebase ожидают «well-formed» Jira/BB/CF JSON. Реальный API возвращает разные shape (см. NEW-13 history rotation, _parseDomainLink с 4 фильмами форматов).

**Severity**: L (nice-to-have).

**Рекомендация**: для `_parseDomainLink`, `extractRelativeDate`, `classifyActivityIntent` — добавить fuzz-test, генерирующий случайные строки и убеждающийся что не падает (assert.doesNotThrow). Можно без deps, через `Math.random` + `String.fromCharCode`.

---

## Что **хорошо** про тесты в V13

✅ **373 unit + 11 contract + 10 e2e** — пирамида правильная (много unit, меньше contract, ещё меньше e2e).
✅ **node:test (no extra deps)** — соответствует «no npm runtime deps» политике.
✅ **Contract tests с fake Jira** в `contractTest.js` — отличная практика.
✅ **e2e запускает РЕАЛЬНЫЙ сервер** на отдельном порту (19099), не моки. Real-world.
✅ **49 тестов на V13 chat-activity** добавлены вместе с feature.
✅ **`parseDomainLink.test.js` правильно обновлён** при декомпозиции — путь к модулю поменялся.
✅ **TypeScript --checkJs** проходит без ошибок (`tsconfig.json` строгий).
✅ **ESLint custom rules** (`local/no-unescaped-innerhtml`, `local/css-class-prefix`) — невидимый, но мощный quality-gate.
✅ **`--max-warnings 215`** — есть baseline, регрессы видны.
✅ **`scripts/perfBudget.js`** — bundle-watch на месте (audit #30).
