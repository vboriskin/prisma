# Testing

Текущая база: **534 unit + 11 contract + 10 e2e + 104 testRunner = 659+ tests**.

> **Status**: миграция `testRunner.js` → `node:test` в работе. 15 тестов
> RiskEngine мигрированы в `tests/unit/legacy/riskEngine.test.js` параллельно
> с legacy (legacy остаётся в `npm test` до окончания миграции).
>
> **Новые тесты — ТОЛЬКО через `node:test` в `tests/unit/`**, никогда не
> добавляй в `testRunner.js` (он retire'тся в финальной фазе).
>
> **V22+ Sprint C** добавил Playwright visual smoke в `tests/playwright/` —
> отдельный уровень для UI regression.

## 4 уровня

| Уровень | Где | Раннер | Сколько | Когда писать |
|---|---|---|---|---|
| testRunner (legacy) | `testRunner.js` (root) | самописный | 104 | **freeze** — мигрируется в `tests/unit/legacy/` через `node:test`, новые писать ЗАПРЕЩЕНО |
| Unit (node:test) | `tests/unit/**/*.test.js` (включая `legacy/` для мигрированных) | `node --test` | 534 + 15 (мигрировано) | большинство новых тестов |
| Contract | `contractTest.js` (root) | самописный (поднимает fake-Jira + real `server.js`) | 11 | `/api/integrations/*` поведенческие тесты |
| e2e | `e2eTest.js` (root) | самописный (puppeteer? scripted DOM?) | 10 | smoke полного user-flow |

## Команды

```bash
npm test                    # testRunner + unit + contract (без e2e)
npm run test:legacy         # только legacy testRunner (deprecated, миграция в процессе)
npm run test:unit           # только node --test для unit (быстро)
npm run test:contract       # ВНИМАНИЕ: путь в package.json указывает на tests/contract/** — пустая папка
                            # Правильный contract test = `node contractTest.js`
npm run test:coverage       # node --test --experimental-test-coverage
npm run test:e2e            # node e2eTest.js
npm run ci                  # всё + typecheck + lint + perfBudget
```

Один тест:
```bash
node --test tests/unit/portfolioPulseModel.test.js
node --test --test-name-pattern "fuzzy match" tests/unit/portfolioPulseModel.test.js
```

## Когда какой уровень

```
Чистая функция / маленький модуль       → unit
Endpoint /api/integrations/*            → contract
RowFactory / EmployeeFactory            → unit
Reactive proxy behaviour                → unit
analysePulse(raw, opts) → model         → unit (с фикстурой)
Frontend interaction (clicks, forms)    → e2e (если критично) иначе manual
HTTP behaviour (timeouts, retries)      → contract
DOM rendering correctness               → manual + Spine-pill review
```

## Unit — node:test

Стандартный pattern:

```js
'use strict';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// Stub localStorage если файл импортирует store
globalThis.localStorage = globalThis.localStorage || { /* ... */ };

const { Foo } = await import('../../foo.js');

describe('Foo.bar', () => {
  test('happy path', () => {
    assert.equal(Foo.bar(1), 2);
  });
});
```

Импорт через `await import` потому что `tests/unit/*.test.js` пока без `"type": "module"` в package.json — Node парсит как CommonJS, ESM-импорты идут через dynamic `import()`.

## Тестовые fixtures

`tests/fixtures/jiraPulseResponse.js` — единственный shared fixture. Содержит:
- `makeJiraIssue(over)` — конструктор Jira-issue
- `inProgressIssue()`, `doneIssue()`, `todoIssue()` — типичные шаблоны
- `makeRawReport({pk, issues})` — server-shape для один PK
- `makePulsePayload({reports, bitbucket, confluence})` — полная response shape
- `makeBitbucketAggregate(authors)` — bitbucket-часть response
- `ISO_2026_04_28_NOON`, `withFrozenTime` — для тестов с временем

Если пишешь новый тест на pulse — переиспользуй эти helpers, не строй с нуля. Если фикстура чего-то не покрывает — расширь её, не плоди дубли.

## Contract tests (`contractTest.js`)

Самописный runner который:
1. Поднимает **fake Jira** на `127.0.0.1:FAKE_PORT` (returns mocked Jira-shapes)
2. Поднимает **реальный `server.js`** на `127.0.0.1:APP_PORT` с `RATE_LIMIT_PER_MIN=500`
3. Конфигурирует `jira_config.json` через POST `/api/jira/config` так чтобы `jiraBaseUrl` указывал на fake
4. Делает POST на `/api/integrations/*` и проверяет shape ответа

Пример:
```js
/* T3: /api/integrations/portfolio-pulse returns expected shape */
try {
  const r = await req('POST', '/api/integrations/portfolio-pulse', { projectKeys: ['TEST'] });
  if (!r.body.reports || !Array.isArray(r.body.reports))
    throw new Error('reports[] missing');
  // ...
  pass('portfolio-pulse: shape correct');
} catch (e) { fail('portfolio-pulse shape', e); }
```

Чтобы добавить тест на новый endpoint:
1. Добавь fake-handler в `startFakeJira()` для нужных URL'ов (`/rest/api/...`)
2. Если нужны другие сервисы (BB / CF) — нужен fake-server для каждого
3. Добавь `try { ... pass(...) } catch (e) { fail(...) }` блок

## E2E tests (`e2eTest.js`)

**HTTP-уровень**, без браузера. Используются только Node built-ins (`http`, `child_process.spawn`). Что делает:

1. Спавнит реальный `server.js` на порту 19099
2. Бьёт `GET /` (статика), `POST /api/health`, плюс несколько `/api/*` endpoints
3. Проверяет что ответы приходят и shape ожидаемый

Это **smoke**-тест, не классический e2e (нет DOM, нет click'ов, нет visual regression). Имя «e2e» исторически.

Что НЕ покрывается через `e2eTest.js`:
- DOM rendering / CSS layout
- Drag-and-drop в Ганте
- Modal interactions
- LLM streaming behaviour

Если когда-то понадобится «настоящий» e2e (Playwright / Puppeteer) — это отдельный backlog item, текущий `e2eTest.js` оставить как smoke.

## testRunner — legacy (миграция V18 P12 → V19)

`testRunner.js` (~900 строк) — самописный runner. Один большой файл с
inline-mirror'ами доменной логики (RiskEngine, FilterEngine, DependencyEngine,
MetricsEngine, safeHtml, reactiveStore). Существует исторически.

**Status**: фаза-1 миграции запущена (15 тестов RiskEngine уже на `node:test`).
Детали — `git log --grep="V18 P12"`.

| Группа в testRunner | Тестов | Мигрировано? | Файл node:test |
|---|---|---|---|
| RiskEngine — computeFlags + computeRiskScore | 15 | **YES** (V18 P12) | `tests/unit/legacy/riskEngine.test.js` |
| toBool | 12 | планируется V18 P13 | — |
| safeHtml | 11 | планируется V18 P13 | — |
| MetricsEngine — computeProgress + computeLoad | 22 | планируется V18 P13 | — |
| FilterEngine — applyFilters + filter | 27 | dedup audit нужен (см. `tests/unit/filterEngine.test.js`) | — |
| DependencyEngine — cycle detection | 8 | переписать против `detectCycles` | — |
| reactiveStore — basic semantics | 9 | dedup audit нужен (см. `tests/unit/reactiveStore.test.js`) | — |
| **Σ** | **104** | **15 / 104** | |

Не удалять файл — пока 89 тестов живут только там. Удаление = фаза 3 после
полной миграции и 7-дневного зелёного прогона.

**Контракт**: `node testRunner.js` остаётся 104/0 до фазы 3.

`npm run test:legacy` — alias для запуска только legacy testRunner отдельно
(полезно при отладке миграции).

## Покрытие

Распределение по модулям (приблизительно):
- `integrations/portfolioPulse*` — высокое покрытие (~25 unit + contract)
- `integrations/integrationsStore` — 8 (V17.2)
- `rowFactory` / `EmployeeFactory` — есть
- `riskEngine` — есть
- `chat/*` — точечное (V17 P3 added 19 chat tests)
- `app.js` / `server.js` — низкое unit-покрытие, преимущественно через contract+e2e
- `views/*` — почти нет

Куда лучше добавлять тесты в первую очередь:
1. **Pure logic в integrations/** — analyse, build, transform
2. **Reactive contract** — что-то про `silent` + edge-cases восстановления
3. **State migrations** при bump версий localStorage keys
4. **Token-scrub** — каждый новый export-path

## Lint warnings

`npm run lint -- --max-warnings 215`. **215** — это **бюджет legacy warnings** (живая цифра, не архитектурное решение).

Политика: **не повышать, опускать в фоне**.

- Если твой PR добавляет warnings → `npm run lint:strict` (`--max-warnings 0`) на затронутых файлах должен пройти. На остальных — баланс не должен расти.
- Если твой PR случайно понижает счётчик до 200 → обнови `--max-warnings 200` в `package.json` (закрепи прогресс)
- Если на ровном месте упёрся в `> 215` — что-то в твоём изменении внесло новые warnings; не повышай budget, найди причину

Отдельный `docs/lint-warnings.md` НЕ ведём — список stale через 2 коммита, ценности не несёт. Текущие 215 распределены по легаси-местам (старые `views/*.js`, парсинг XLSX через vendored lib и т.п.); виден через `npm run lint` локально.

См. также `eslint-disable` комменты в коде — у каждого есть пояснение «почему».

## Тест-related в audit-папках

Для исторического контекста почему тест устроен именно так — `git log -S "describe('<test name>'"` поднимет коммит-добавление с обоснованием.

## Что слабо покрыто

- **DOM rendering** — мы не проверяем что HTML-вывод views соответствует expected
- **Drag-and-drop в Ганте** — pure-DOM, без e2e не проверишь
- **CSS regression** — Spine-pill consistency проверяется глазами, не автоматом
- **LLM streaming behaviour** — `parseStreamResponse` имеет диагностику но нет тестов на edge-cases (пустой stream, broken SSE, и т.д.)
- **Black Dashboard async-job** — `_jobs` cache lifecycle не покрыт

При работе в этих областях — **запускай вручную перед коммитом**, тесты не поймают.
