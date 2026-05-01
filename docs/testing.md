# Testing

Текущая база: **534 unit + 11 contract + 10 e2e + ~104 testRunner = 659+ tests**.

## 4 уровня

| Уровень | Где | Раннер | Сколько | Когда писать |
|---|---|---|---|---|
| testRunner | `testRunner.js` (root) + спец-`.test.js` файлы | самописный | ~104 | **legacy** — миграция на node:test, новые не пишем |
| Unit (node:test) | `tests/unit/*.test.js` | `node --test` | 534 | большинство новых тестов |
| Contract | `contractTest.js` (root) | самописный (поднимает fake-Jira + real `server.js`) | 11 | `/api/integrations/*` поведенческие тесты |
| e2e | `e2eTest.js` (root) | самописный (puppeteer? scripted DOM?) | 10 | smoke полного user-flow |

## Команды

```bash
npm test                    # testRunner + unit + contract (без e2e)
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

## testRunner — legacy

`testRunner.js` (~900 строк) — самописный runner. Один большой файл с inline-тестами. Существует исторически. Постепенная миграция на `node:test` идёт; новые тесты — только `tests/unit/*.test.js`.

Не удалять — пока 104 теста живут только там. Когда мигрируем — удалим всё разом.

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

Когда читаешь old audit (`audit-2026-04-29-v13/05-tests-pass.md` etc) — там описаны решения «почему этот тест устроен так». Полезно при изменении тестов чтобы не сломать существующий контракт.

## Что слабо покрыто

- **DOM rendering** — мы не проверяем что HTML-вывод views соответствует expected
- **Drag-and-drop в Ганте** — pure-DOM, без e2e не проверишь
- **CSS regression** — Spine-pill consistency проверяется глазами, не автоматом
- **LLM streaming behaviour** — `parseStreamResponse` имеет диагностику но нет тестов на edge-cases (пустой stream, broken SSE, и т.д.)
- **Black Dashboard async-job** — `_jobs` cache lifecycle не покрыт

При работе в этих областях — **запускай вручную перед коммитом**, тесты не поймают.
