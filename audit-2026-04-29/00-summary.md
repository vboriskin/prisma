# 00. Сводка аудита V12

## TL;DR

Проект в рабочем состоянии. CI зелёный, тесты проходят (449 unit + contract + e2e), perf budget в пределах. Архитектура «vanilla без бандлера» — осознанный выбор, защищаемый аргументами в `ARCHITECTURE.md`, и в основном последовательный.

Главные риски в текущем состоянии:
1. **Security**: bundle-CSV прямая запись в localStorage (token theft vector — NEW-13), отсутствие CSP/X-Frame-Options, незашифрованные токены в localStorage, path traversal через symlink.
2. **Data loss**: nо `storage` event listener для двух вкладок (NEW-1) → перезапись данных. `q2_action_log_v1` без ротации → QuotaExceeded со временем.
3. **Sustainability**: `app.js` 2148 LOC и `server.js` 2612 LOC — не масштабируется как сейчас. Reactive auto-flush работает, но manual `Storage.save()` ещё в 25 местах — миграция audit #6 не завершена.
4. **Coverage**: views/* и app.js — 0% тестов. Critical-path UI не защищён.
5. **Tooling slack**: lint warnings 332/335 — 3 единицы запаса.

V12 закрыл 8 из 8 documented bugs (FOUND_BUGS.md → fixed). Появилось 20 новых находок (NEW-1..NEW-20), из них 4 уровня **H** (high), 9 **M**, 7 **L**.

## Оценка по разделам

| Раздел | Оценка | Кратко |
|---|---|---|
| 01 Архитектура | удовлетворительно | Нарушений слоёв нет, но 4 файла >1000 LOC, ARCHITECTURE.md устарел |
| 02 Безопасность | удовлетворительно | 234 raw innerHTML warnings, нет CSP, токены в localStorage в открытую |
| 03 Серверная часть | удовлетворительно | 2612 LOC, 7 silent catches, retry only 429, кэши OK |
| 04 Фронтенд | удовлетворительно | 2 пути reactivity, render perf на больших таблицах, a11y базовый |
| 05 Данные | удовлетворительно | NEW-1 race + NEW-2 unbounded log — open issues |
| 06 Интеграции | удовлетворительно | Pagination only first page для BB/CF, retry неполный |
| 07 Тесты | хорошо | 449 тестов, нагрузка на views/* и app.js нулевая, качество выборки высокое |
| 08 Tooling/CI | удовлетворительно | margins узкие, нет coverage, нет release process |
| 09 Качество кода | хорошо | Дублирования есть, но не катастрофа; TODO ноль; имена в новом коде понятные |
| 10 UX | удовлетворительно | Loading/empty states есть в новых разделах, отсутствуют в registry/gantt/import |

## Топ-10 находок

| # | Что | Severity | Где | Найдено в |
|---|---|---|---|---|
| 1 | bundle-CSV → direct localStorage write (token theft) | M-H | `dataStore.js:271-296` | 02 + 11 NEW-13 |
| 2 | Race condition между двумя вкладками — нет storage listener | H | `dataStore.js`, `app.js` | 05 + 11 NEW-1 |
| 3 | `q2_action_log_v1` растёт без ротации | H | `historyLog.js` | 05 + 11 NEW-2 |
| 4 | Нет CSP / X-Frame-Options / X-Content-Type-Options | M | `server.js:2470+` | 02 + 11 NEW-19 |
| 5 | `Storage.save` глушит ВСЕ ошибки кроме Quota (silent data loss) | H | `dataStore.js:48-50` | 11 NEW-3 |
| 6 | Path traversal обходится через symlink | M | `server.js:2462-2466` | 02 + 11 NEW-7 |
| 7 | jiraRequest retries только на 429 — fragile к 502/503 | M | `server.js:418-432` | 06 + 11 |
| 8 | GigaChat token refresh не реализован | M | `server.js:124+` | 06 + 11 NEW-12 |
| 9 | Bitbucket / Confluence пагинация только первая страница | M | `server.js:732, 1373` | 06 |
| 10 | `notify(reason)` глушит исключения подписчиков | H | `state.js:178-180` | 11 NEW-4 |

## Что сильно

- **Тесты на бизнес-логику**: 324 unit-теста в `tests/unit/` через `node:test` — pure-функции хорошо покрыты. Качество — выборочно проверил, тесты содержательные.
- **Reactive store**: проектное решение, аккуратно реализовано (`reactiveStore.js`), есть `Reactive.silent`, есть `flushNow`, есть proxy-cache.
- **safeHtml.js** — компактный (~50 LOC), full lit-html-API совместимый. Новый код активно использует.
- **eslint custom rules** (`local/no-unescaped-innerhtml`, `local/css-class-prefix`) — отличная идея для legacy migration.
- **`PorfolioPulse` orchestrator pattern** — три волны фич реализованы согласовано: state поля, sticky-states, Render-context. Понятный код.

## Что слабо

- **`app.js` + `server.js`** — 4760 LOC в двух файлах. Декомпозиция приостановилась.
- **Manual `Storage.save()`** в dataStore — audit #6 не доведён до конца.
- **Two paths reactivity** (manual + Reactive) сосуществуют. Workaround'ы (см. v11 session) скрывают проблемы, не решают.
- **0% coverage** в `views/*`, `app.js`, `chat/chatEngine.js`, `chat/chatActions.js`, `ai/aiCeoFallback.js`. Критичные модули.
- **Lint warnings 332/335** — slack 3 единицы. Любая мелочь — CI red.
- **CSS 339KB / 360KB** — slack 6%. Любой новый блок — превышение.
- **A11y базовый** — `aria-modal`, `aria-label` есть, но keyboard navigation между tabs не помечен, focus management в модалках отсутствует.

## Как использовать этот аудит

**День 1 (security + critical)**:
- Выполнить **#1, #2, #6, #7, #8, #10** из `12-recommendations.md` — 1 день в сумме. Закрывает 5 из 10 топ-находок.
- Запустить `npm run ci` после каждой правки.

**Неделя 1 (chat tests + DRY)**:
- **#12, #13** — покрыть chatEngine + chatActions. ~2 дня.
- **#3, #4, #5** — DRY и lint slack. ~1 день.

**Спринт (2 недели)**:
- **#16, #15** — token refresh + pagination. ~2 дня.
- **#18 + #19** — декомпозиция app.js + server.js. ~3-5 дней.
- **#24, #25, #26** — a11y улучшения. ~1 день.

**Долгосрок (по необходимости)**:
- **#20** — UI tests с jsdom. ~1 неделя.
- **#27** — CSS reduction. ~1 неделя.
- **#23** — JSDoc on 5-10 модулей. ~3-4 дня.

**Не делать**:
- Полная TypeScript-миграция.
- React/Vue rewrite.
- Husky / Renovate / dependabot.
- Полная замена Reactive на explicit save+refresh.

См. полный список и обоснования в `12-recommendations.md`.
