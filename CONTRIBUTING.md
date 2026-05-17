# Contributing

Точка сборки правил разработки. Если ты впервые в репо — прочти это + [`CLAUDE.md`](./CLAUDE.md).

> Для **LLM-агента** главный документ — [`CLAUDE.md`](./CLAUDE.md). Этот файл — для humans.

## Setup

```bash
git clone <repo>
cd v17_0
npm install         # устанавливает devDependencies (TypeScript, ESLint)
npm test            # должно дать 534 unit / 11 contract / 0 fail
npm start           # → http://localhost:8080
```

`npm install` **обязателен для разработки** (typecheck + lint). Для конечного юзера он не нужен — есть `КАК-ЗАПУСТИТЬ.md` + `Запустить (Mac).command` / `(Windows).bat`.

## Workflow

1. Создай ветку: `git checkout -b <type>/<short-description>`
   - `feature/...` — новая фича
   - `fix/...` — багфикс
   - `refactor/...` — без поведенческих изменений
   - `docs/...` — только doc-update
   - `audit/...` — итерация V-эпохи (см. § «V-эпохи» ниже)

2. Сделай работу + тесты

3. Прогон локально:
   ```bash
   npm run typecheck    # tsc --checkJs
   npm run lint         # eslint --max-warnings 215
   npm test             # 534 + 11 + 104 testRunner
   ```

4. PR с заполненным [PR-шаблоном](./.github/pull_request_template.md). Если documentation impact = N/A — так и напиши.

5. Review / merge.

## Коммит-сообщения

Формат: `<type>(<scope>): <subject>`

```
feat(gantt): add «Снять исполнителя» action in pill ctx-menu
fix(integrations): backtick inside HTML comment breaks template literal
refactor(server): extract _cfPathCascade helper from 5 places
docs(audit): V18 P1 — git init audit report
chore: bump max-warnings to 200
test(contract): migrate to node:test
```

Types: `feat / fix / refactor / docs / chore / test / perf / style`.

Тело коммита:
- Что изменилось (1-3 строки)
- Почему (если не очевидно)
- Ссылка на audit (`Closes V18 P3`) если применимо
- `Co-Authored-By: ...` для совместной работы (LLM включительно)

**HEREDOC** для многострочных сообщений — обязательно, чтобы форматирование не съелось shell'ом.

## V-эпохи и audit-метки в коде

Проект развивается итерациями V11 → V12 → V14 → … → V22+ (Phase 5.2 / Sprint A+B+C / Playwright). Каждая закреплена ярлыками в коде.

Audit-папки `audit-2026-*` удалены (commit `afeb858`) — все находки реализованы и legacy-метки в коде самодостаточны. История V-эпохи: `git log --grep="V17.2 I1c"`.

Когда добавляешь существенную правку:

```js
// V22+ Sprint A — tokenized (was hardcoded HEX × 9)
.ts2-row-src-b { border-left-color: var(--prizma-on-course); }
```

Формат: `V<version> [Sprint <X> | P<number>] — <короткое описание>`

→ Подробнее: [`docs/version-history.md`](./docs/version-history.md)

## 3 контракта state — критично

Прежде чем менять что-то в `state.js / dataStore.js / integrations/`:

1. **Reactive.silent** — mass-mutations должны быть в `Reactive.silent(...)` иначе infinite loop
2. **Identity-deterministic attribution** — `state.employees[].{email, jiraAccountId, bitbucketLogin, confluenceAccountId}` авторитет для интеграций. Никаких fuzzy-FIO-matches.
3. **`_scrubSecrets`** — все экспорты обязаны через `CSV._scrubSecrets()`.

→ Полные контракты: [`docs/state-contracts.md`](./docs/state-contracts.md)

## Что НЕ трогать

- `Reactive.silent` обвязка вокруг `Storage.save / restore` — без неё loop
- `_ppFindByPartial` (dev-only fallback за флагом)
- Vendored libs (`libs/xlsx.full.min.js`, `libs/sql-wasm.*`) — обновлять только через security review
- Sigma fields внутри `jira_config.json` — миграция = breaking change

→ Полный список с объяснениями: [`docs/dont-touch.md`](./docs/dont-touch.md)

## Стиль

### Vanilla JS принципы

- **Никаких npm-пакетов в production** runtime. Vendored — только `xlsx.full.min.js` и `sql-wasm.*`.
- **Native ES modules**, без бандлера и build-step. `import`/`export`.
- **JSDoc типы** через `// @ts-check` opt-in per file.
- **Imperative DOM** через innerHTML с обязательным `Utils.escapeHtml()`.

### Spine-pill design language (V15+)

Все data-views (Реестр / Гант / Дашборд / Settings):
- Без эмодзи в data-surfaces (onboarding tour OK)
- Без gradients
- 3px stripe-left для активных/выделенных
- Mono-tabular numerals
- CAPS sub-headers 9-10px / letter-spacing .6-.7px
- SVG icons (не emoji)
- Spacing на 4/8 grid

→ Visual checklist: [`docs/spine-pill.md`](./docs/spine-pill.md)

### Безопасность по умолчанию

- HTML insert — только через `Utils.escapeHtml`
- CSV cell-export через `Utils.escapeCSV` (formula injection guard)
- Token redact в error paths: `Bearer|Authorization|token|secret|password|apiKey|authKey` regex
- `_scrubSecrets()` для всех export-paths

→ Полный security flow: [`docs/integrations/auth-and-secrets.md`](./docs/integrations/auth-and-secrets.md)

### Lint warnings

`npm run lint -- --max-warnings 215` — это **legacy budget**, не архитектурное решение.

- Не повышай число «чтобы прошёл CI»
- Если PR случайно понижает счётчик до 200 — закрепи прогресс: `--max-warnings 200`
- Не используй массовый `eslint-disable` — это обходит проблему

## Adding a new view / integration / endpoint

| Что добавляешь | Куда смотреть |
|---|---|
| Новый view | [`ARCHITECTURE.md` § Adding a view](./ARCHITECTURE.md) |
| Новый `/api/integrations/*` | [`docs/integrations/README.md`](./docs/integrations/README.md) + [`api-endpoints.md`](./docs/integrations/api-endpoints.md) |
| Новая интеграция (Jira/BB/CF/etc) | [`docs/integrations/auth-and-secrets.md`](./docs/integrations/auth-and-secrets.md) — security checklist |
| Изменение state shape | [`docs/state-contracts.md`](./docs/state-contracts.md) — особенно про migrations |
| Новый тестовый pattern | [`docs/testing.md`](./docs/testing.md) |
| Visual change | [`docs/spine-pill.md`](./docs/spine-pill.md) |

## Тесты

```bash
npm test                 # all (testRunner + unit + contract)
npm run test:unit        # ~1613 unit (node:test, ~3s)
npm run test:contract    # 11 contract (spawns fake-Jira + server.js, ~5s)
npm run test:e2e         # 10 e2e HTTP smoke (spawns server.js)
npm run test:visual      # V22+ Sprint C — Playwright visual smoke (~30 tests, ~2 min)
npm run test:visual:ci   # same + JSON-reporter для CI artifact
npm run test:coverage    # unit + coverage report
```

Один тест:
```bash
node --test tests/unit/portfolioPulseModel.test.js
node --test --test-name-pattern "fuzzy match" tests/unit/portfolioPulseModel.test.js
```

→ Уровни / fixtures / weak-coverage areas: [`docs/testing.md`](./docs/testing.md)

## Перед merge — чек-лист

- [ ] `npm test` зелёное (укажи числа в PR description)
- [ ] `npm run typecheck` без ошибок
- [ ] `npm run lint` без новых warnings (≤215)
- [ ] PR-шаблон [`.github/pull_request_template.md`](./.github/pull_request_template.md) заполнен (или `Documentation impact: N/A`)
- [ ] Если visual change — скриншот light + dark theme в PR
- [ ] Audit-метки в коде имеют формат `V<n> P<m> — описание`

## Получить помощь

- **LLM-агенту:** [`CLAUDE.md`](./CLAUDE.md)
- **Не разобрался в коде:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) + [`docs/state-contracts.md`](./docs/state-contracts.md)
- **Доменный термин неясен:** [`docs/domain-glossary.md`](./docs/domain-glossary.md)
- **Странное место в коде:** [`docs/dont-touch.md`](./docs/dont-touch.md) — может оно «осознанная кривизна»
- **Хочу понять историю:** [`docs/version-history.md`](./docs/version-history.md) + audit-папки
