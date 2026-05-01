# V18 P4 — CI gate

**Дата:** 2026-05-01
**Tests:** 534 / 11 / 0 (без изменений — pure infrastructure)
**Effort:** S

## Что сделано

Создан CI pipeline в двух вариантах (для гибкости — на момент V18 P1 remote ещё не подключён, не известно где будет жить repo):

1. **`.github/workflows/ci.yml`** — для GitHub / GitHub Enterprise
2. **`.gitlab-ci.yml`** — для GitLab (corporate Сбера часто использует именно его)

Оба файла покрывают одинаковый pipeline; когда remote определится, лишний можно удалить (либо оставить оба — на случай миграции).

## Стадии CI (одинаковые в обоих файлах)

| Stage | Что |
|---|---|
| validate | `typecheck` (tsc --checkJs) |
| validate | `lint` (--max-warnings 215) |
| validate | `perf:budget` (scripts/perfBudget.js) |
| test | `test:unit` (534 node:test) |
| test | `test:contract` (11 spawn-server) |
| test | `node testRunner.js` (~104 legacy) |
| test | `test:e2e` (10 HTTP smoke) |
| smoke | server boot → `/health` returns 200 |

GitHub Actions запускает их linear (упрощённо), GitLab — параллельно по stage'ам.

## Что НЕ сделано (явно)

- **Branch protection rules** — настраиваются на стороне сервера хостинга после push. На repo-side ничего не делаем.
- **Coverage threshold gate** — пока нет, потому что покрытие неравномерное (P13 будет работать с этим). Сейчас просто прогоняем coverage без threshold.
- **Auto-publish artefacts** — нечего публиковать (не библиотека).
- **`npm ci` стандартный** — на момент V18 P1 lock-файла нет. CI использует `npm ci || npm install` fallback. Когда `npm install` будет сделан и lock закоммичен — заменить на чистый `npm ci`.
- **Кэширование `node_modules`** — настроено в обоих файлах через `cache: npm` (Actions) и через `cache.paths: node_modules/` (GitLab). Эффект только после первого build'а.

## Тесты

Это pure infrastructure-добавление, code-side ничего не меняется → тесты как были:

```
534 / 11 / 0
```

## Что было закрыто

`P4` закрывает Phase 3 audit TODO **D5** «`npm run ci` запускается локально, но нет автоматического gate в репозитории».

## Кросс-ссылки в CONTRIBUTING.md

Уже есть упоминание в CONTRIBUTING.md § Workflow:
> 5. Review / merge.

После merge CI запустит pipeline на main; если что-то упадёт — известно через notification от хостинга.

## Резюме

```
✓ .github/workflows/ci.yml  (~ 60 LOC)
✓ .gitlab-ci.yml             (~ 80 LOC)
✓ Tests: 534 / 11 / 0
```

Pipeline готов; станет «живым» когда появится remote. Когда:
1. `git remote add origin <url>`
2. `git push -u origin main`
3. Хостинг автоматически подхватит yaml (для GitLab нужно сразу; для GitHub нужно зайти в Actions tab включить workflow при первом push).

V18 P4 закрыт. Дальше — P5 (path-cascade helper).
