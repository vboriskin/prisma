# 08. Инструментарий и CI

## ESLint

`eslint.config.js` — flat config (v9). Активные правила:

| Правило | Уровень | Что |
|---|---|---|
| `prefer-const` | warn | OK |
| `no-var` | warn | OK |
| `no-unused-vars` | warn | with `argsIgnorePattern: '^_'` — **caughtErrorsIgnorePattern не выставлен** |
| `no-empty` | warn | `allowEmptyCatch: true` |
| `no-undef` | off | `// we use window globals heavily` — комментарий честный |
| `no-cond-assign` | error | except-parens |
| `local/no-unescaped-innerhtml` | warn | custom rule (см. `eslint-rules/`) |
| `local/css-class-prefix` | warn | custom rule |

**`max-warnings 335`** в `package.json`. Фактически:
```bash
$ npm run lint 2>&1 | tail -1
✖ 332 problems (0 errors, 332 warnings)
```

3 warning'а запаса. **Опасно**: любое новое предупреждение → CI red. Учитывая, что `no-unused-vars` на `_` в catch'ах генерит шум, который трудно избежать без `caughtErrorsIgnorePattern`.

**Близкое к ratchet**: 332/335 = 99.1% от допустимого. Один новый файл — выйдем.

**Recommended**:
- Добавить `caughtErrorsIgnorePattern: '^_'` в `no-unused-vars` config — снимет ~10 warning'ов.
- После V12 fix у нас баги починены, но locked-bug-tests были обновлены — ничего не должно прибавиться.

## Custom rules

### `local/no-unescaped-innerhtml`

```bash
$ npm run lint 2>&1 | grep -c "no-unescaped-innerhtml"
234
```

234 случая. **Покрытие**: высокое — каждый `${...}` в `innerHTML = \`...\`` ловится. **False positive rate** оценил в `02-security.md` — около 40-50% (numeric metrics, whitelisted enums).

**Improvement идея**: добавить allowlist по типу значения (`Number`, известные const enum'ы) — но это усложнит rule.

### `local/css-class-prefix`

Проверяет что классы соответствуют префиксам по ownership map (eslint.config.js:31-72). Сейчас warn — нет запретов на crossing prefix'ов.

**Польза**: видна, заметил пару нарушений в выводе. Не критично.

## TypeScript via JSDoc

`tsconfig.json` — `checkJs: true, noEmit: true, allowJs: true`. Файлы под `// @ts-check` — не нашёл явного списка, но tsc проходит на 0 errors.

**Покрытие**: TypeScript видит весь код (все .js файлы), но JSDoc-аннотации стоят неравномерно. Самые "типизированные":
- `libs/safeHtml.js` — полная JSDoc-документация
- `integrations/portfolioPulseModel.js` — несколько `@param`, `@returns`
- `dataStore.js` — частично

**Что проще всего опт-ин'нуть**:
- `chat/chatIntentParser.js` — pure functions, легко добавить return types.
- `integrations/portfolioPulseUtils.js` — то же.

**Что сложно**:
- `app.js`, `server.js` — слишком много `any` пройдёт.

## Perf budget

```
✓ index.html (raw)                52.3 KB / 70.0 KB     (75%)
✓ styles.css (raw)               339.7 KB / 360.0 KB    (94%)
✓ all JS (raw)                  1133.1 KB / 1500.0 KB   (76%)
✓ all JS (gzipped)               324.3 KB / 400.0 KB    (81%)
✓ biggest single JS file         105.5 KB / 120.0 KB    (88%)
✓ biggest single CSS file        339.7 KB / 360.0 KB    (94%)
```

**Запас по метрикам**:
- styles.css: 6% — критично узко, любой новый блок CSS сломает.
- biggest single JS: 12% — app.js близко к 120KB.
- gzipped: 19% — приличный запас.

**Тренд** не могу оценить (нет git-истории). Но V11 → V12 не добавил много.

## npm scripts

```json
"start":         "node launch.js 8080",
"start:3000":    "node launch.js 3000",
"server":        "node server.js 8080",
"test":          "node testRunner.js && npm run test:unit && node contractTest.js",
"test:unit":     "node --test --test-reporter=spec 'tests/unit/**/*.test.js'",
"test:contract": "node --test --test-reporter=spec 'tests/contract/**/*.test.js'",
"test:coverage": "node --test --experimental-test-coverage --test-reporter=spec 'tests/unit/**/*.test.js'",
"test:e2e":      "node e2eTest.js",
"typecheck":     "tsc --noEmit -p .",
"lint":          "eslint . --max-warnings 335",
"lint:strict":   "eslint .",
"lint:fix":      "eslint . --fix",
"perf:budget":   "node scripts/perfBudget.js",
"ci":            "npm run typecheck && npm run lint && npm run test && npm run test:e2e && npm run perf:budget"
```

**Что есть**: всё что нужно.

**Что устарело**: `start:3000` — рудимент.

**Чего не хватает**:
- `test:watch` — `node --test --watch` для развёртки.
- `lint:warnings` — показать только warnings (без errors), полезно при ratchet.

## Запуск без `npm install`

Production deploy: `node server.js`. Без `node_modules`:

```bash
$ rm -rf node_modules
$ node server.js 18999 &
$ curl http://127.0.0.1:18999/health
{"ok":true,...}
```

✓ работает. Проверил вручную — index.html отдаётся, integrations работают.

**Что сломается без dev-deps**:
- `npm test` — `node --test` встроенный, **работает**. `testRunner.js` тоже встроенный node.
- `npm run typecheck` — нужен `typescript` пакет. **Сломается**.
- `npm run lint` — нужен `eslint`. **Сломается**.
- `npm run perf:budget` — `node scripts/perfBudget.js` чистый. **Работает**.

**Заявленное "no install"** — production OK, dev — нет.

## Что отсутствует в tooling

| Tool | Зачем | Стоимость? |
|---|---|---|
| Coverage report | видеть % | dev-only, можно через `--experimental-test-coverage` (есть scripts/test:coverage уже) |
| Pre-commit hook | блокировать commit с red CI | husky etc — npm-dep, **не ставить** |
| Bundle analyzer | визуализация размеров | esbuild-bundle-analyzer — **не ставить** |
| Lighthouse audits | a11y, perf | manual run |
| Dependabot / Renovate | обновления зависимостей | у нас 3 dev-deps, редко обновляются |

## Заключение

Категория | Оценка
---|---
ESLint правила | хорошо — есть custom rules для XSS и CSS prefix |
ESLint warnings limit | удовлетворительно — 332/335 critical, slack 3 |
Custom rules false positive | удовлетворительно — 40-50% on `no-unescaped-innerhtml` |
TypeScript JSDoc | удовлетворительно — purchase basic OK, expansion затратен |
Perf budget | удовлетворительно — 88-94% близко к лимитам, опасно |
npm scripts | хорошо |
Production без dev-deps | хорошо — `node server.js` стартует чисто |
Coverage в CI | плохо — нет |
