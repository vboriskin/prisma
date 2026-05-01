# V18 P2 — `test:contract` config fix

**Дата:** 2026-05-01
**Tests:** 534 unit / 11 contract / 0 fail (без изменений)
**Effort:** S (~30 минут)

## Проблема

В `package.json` script `test:contract` указывал на пустую папку:
```json
"test:contract": "node --test --test-reporter=spec 'tests/contract/**/*.test.js'"
```
А реальные contract-тесты жили в `contractTest.js` (root, ~300 LOC) с самописным runner'ом (`pass()/fail()`). Запускались через `npm test` командой `node contractTest.js`.

Несоответствие config'а и реальности → невозможно было запустить отдельно `npm run test:contract`.

## Решение

Перенёс contract-инфраструктуру и тесты в `tests/contract/` под `node:test`.

### Структура

```
tests/contract/
├── _setup.js                     ← infrastructure (123 LOC)
└── integrations.test.js          ← 11 тестов (132 LOC)
```

`_setup.js` — имя начинается с `_` чтобы node:test НЕ подхватил его как тестовый файл (он ищет `*.test.js`).

### Что в `_setup.js`

Вынесена вся инфраструктура:
- `startFakeJira()` / `stopFakeJira()` — fake Jira HTTP-server на порту 19200
- `startApp()` / `stopApp()` — спавн `server.js` на порту 19201 с `RATE_LIMIT_PER_MIN=500`
- `req(method, pathname, body)` — http-helper для App
- `j(s)` — safe JSON.parse
- `getServerInfoHits()` — getter для счётчика, нужно для теста forceRefresh-bypass-cache
- `FAKE_ISSUES` фикстура (TEST-1 issue)

### Что в `integrations.test.js`

11 тестов в формате node:test:
```js
describe('Contract tests — /api/integrations + Portfolio Pulse', () => {
  before(async () => { /* startFakeJira + startApp + initial config POST */ });
  after(()        => { /* stopApp + stopFakeJira */ });

  test('config GET sanitises tokens, exposes hasJiraToken', async () => { ... });
  test('jira/verify connects to fake Jira and returns ok',  async () => { ... });
  // ... 9 more
});
```

Каждый прежний `try { ... pass(...) } catch (e) { fail(...) }` блок стал отдельным `test()` через `assert`.

### Изменения в `package.json`

```diff
- "test": "node testRunner.js && npm run test:unit && node contractTest.js",
+ "test": "node testRunner.js && npm run test:unit && npm run test:contract",
```

`test:contract` остался как был — теперь корректно ссылается на `tests/contract/**/*.test.js`.

### Удалено

- `contractTest.js` (root) — 300 LOC self-implemented runner. Логика полностью покрыта новой структурой.

## Что улучшилось

1. **Корректность конфига** — `npm run test:contract` теперь работает по назначению.
2. **Стандартный runner** — больше нет самописного `pass()/fail()`. Всё через `node:test` + `assert`. Прочие плюсы: timing per-test, structured output, retry support при необходимости.
3. **Изолированность** — `_setup.js` можно переиспользовать в новых contract-test файлах, не дублируя `startFakeJira`/`startApp`.
4. **Меньше кода в root** — `contractTest.js` (root) ушёл, root чище.

## Что НЕ сделано (явно)

- Не разбивал тесты на несколько файлов (`config.test.js`, `pulse.test.js`, `tech-info.test.js`). Сейчас все 11 в одном `integrations.test.js` — это меньшее зло чем 3 файла каждый со своими `before/after` (которые spawn'ят server.js trippled). Если когда-то добавятся ещё ~20 contract-тестов — будет смысл split'ить, тогда нужно общее `before/after` через test-runner setup-файл.
- Не добавлял новые тесты — задача была merge structure, не expand coverage.

## Тесты после

```
npm run test:unit       → 534 pass / 0 fail
npm run test:contract   → 11 pass / 0 fail (~5s — startup includes server.js spawn)
npm test (full)         → 534 + 11 + ~104 testRunner = всё зелёное
```

Никаких регрессий — сравнение через прежнюю `pass: 11, fail: 0` в `contractTest.js` runner'е.

## Документация

Соответствующие правки нужны в `docs/testing.md` (был раздел про `test:contract` указывающий что папка пустая). После P2 — это уже не так. Допишется в P3 (CONTRIBUTING) или отдельным touch-up'ом.

## Резюме

```
✓ tests/contract/_setup.js            (новый, 123 LOC)
✓ tests/contract/integrations.test.js (новый, 132 LOC)
✓ contractTest.js (root)              УДАЛЁН
✓ package.json                        — `test` script обновлён
✓ Tests: 534 / 11 / 0 (без регрессий)
```

V18 P2 закрыт. Дальше — P3 (CONTRIBUTING.md).
