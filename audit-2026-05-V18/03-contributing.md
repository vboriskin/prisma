# V18 P3 — CONTRIBUTING.md

**Дата:** 2026-05-01
**Tests:** 534 / 11 / 0 (без изменений — pure docs)
**Effort:** S

## Что сделано

Создан `CONTRIBUTING.md` в корне репо — единая точка сборки правил разработки для людей. Для LLM-агента остаётся `CLAUDE.md`; этот файл не дублирует его, а адресует humans с фокусом на workflow / коммит-стиль / setup.

## Структура

11 секций:

1. **Setup** — `npm install` для разработчика (явно сказано что нужен)
2. **Workflow** — branch naming + 5-step PR-cycle
3. **Коммит-сообщения** — формат `<type>(<scope>): <subject>`, пример HEREDOC
4. **V-эпохи и audit-метки** — формат `V<n> P<m> [(<expert>)] — описание`
5. **3 контракта state** — короткая выжимка + ссылка на `state-contracts.md`
6. **Что НЕ трогать** — короткий список + ссылка на `dont-touch.md`
7. **Стиль** — vanilla JS принципы, Spine-pill, security defaults, lint warnings policy
8. **Adding a new view / integration / endpoint** — таблица «что → куда смотреть»
9. **Тесты** — команды + ссылка на `testing.md`
10. **Pre-merge чек-лист** — финальные шаги
11. **Получить помощь** — навигация по документации

## Закрытые ранее TODO

P3 закрыл одно из TODO Phase 3 phase-аудита:
- **D3** «`npm install` нужен для dev — нигде не сказано» → теперь явно в § Setup и в § Lint warnings.

## Кросс-ссылки

CONTRIBUTING.md ссылается на (читая → понятно весь контекст):
- `CLAUDE.md` (для LLM)
- `ARCHITECTURE.md`
- `docs/state-contracts.md`
- `docs/domain-glossary.md`
- `docs/dont-touch.md`
- `docs/version-history.md`
- `docs/testing.md`
- `docs/spine-pill.md`
- `docs/integrations/README.md`
- `docs/integrations/api-endpoints.md`
- `docs/integrations/auth-and-secrets.md`
- `.github/pull_request_template.md`

Полный round-trip — открывая CONTRIBUTING юзер не должен «застрять не зная куда дальше».

## Что НЕ сделано (явно)

- Не упоминал «code of conduct» / «license» — это внутренний корпоративный проект, такие документы не нужны.
- Не описывал процесс хосткинга PR (GitLab vs GitHub vs Bitbucket) — зависит от того где репо будет жить (на момент V18 P1 remote ещё не подключён).
- Не делал отдельный `MAINTAINERS.md` — список владельцев в Сбере живёт вне репо.

## Tests

```
534 / 11 / 0 — без изменений
```

Pure documentation change.

## Резюме

```
✓ CONTRIBUTING.md (~ 200 строк) — entry point для humans
✓ Закрыто TODO D3 (npm install для dev)
✓ Tests: 534 / 11 / 0
```

V18 P3 закрыт. Дальше — P4 (CI gate).
