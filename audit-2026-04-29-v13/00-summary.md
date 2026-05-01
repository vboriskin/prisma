# Аудит V13 — резюме

**Дата**: 2026-04-29
**Аудитор**: senior+ fullstack + QA
**Версия**: v13_0 (пост-декомпозиция app.js / server.js + chat-activity + CSS-cleanup)
**Базовая линия**: V12 audit (`audit-2026-04-29/`) + докинутые в этой сессии правки

---

## TL;DR

V13 продолжает движение в правильную сторону: декомпозиция (app.js −13%, server.js −31%), extension chat-activity с тестами (49 unit), CSS-vars и удаление 416 «защитных» fallback-ов. Ничего из ранее зафиксированного НЕ сломано — все 373 unit / 11 contract / 10 e2e зелёные.

Однако накопились **долги, которые НЕ адресовались** ни в V12, ни в V13, и появилось **несколько новых дефектов** в свежей пост-декомпозиционной surface. Главное:

1. **🔴 SSRF surface** в `/api/jira/config` POST — пользователь может прописать любую URL (включая `file://`, `http://169.254.169.254`, `localhost:*`), и сервер пошлёт туда credentials. Для intra-corporate single-tenant это «приемлемо», но не задокументировано как design-choice.
2. **🔴 testRunner.js (104 теста) не тестирует реальный код** — модули (`RiskEngine`, `FilterEngine` и др.) дублированы внутри `testRunner.js` inline. Это «теневая» тестовая база, которая никогда не упадёт при изменении настоящих файлов. Должна быть убрана или переписана с реальными импортами.
3. **🟠 NEW-15 не починен** — `_reactiveBooted = true` остаётся `false`, если `App.init()` бросает синхронно. Reactive auto-save больше не сработает; пользователь не получит ни ошибки, ни автосохранения.
4. **🟠 NEW-5 (cache stampede в Tech Info) не починен** при декомпозиции — `_techInfoCache` переехал в модуль, но single-flight семантики так и нет. После декомпозиции структура изменилась, риск тот же.
5. **🟠 `tests/contract/` пустой** — `npm run test:contract` отрабатывает с 0 тестами и `0 failed`, что в CI выглядит как «всё ок». Реальные contract-тесты живут в `contractTest.js` (root) и запускаются по другому пути.
6. **🟠 ARCHITECTURE.md устарел** — заголовок `v12_0`, упоминаний V13 нет. Декомпозиция #18/#19 и chat-activity не задокументированы.
7. **🟡 207 ESLint warnings** — стабильно, но 95 из них `no-unescaped-innerhtml` (audit #1, XSS surface). Без статичного контента это «defense-in-depth», но **2 года** без миграции на safeHtml.
8. **🟡 NEW-13 (bundle-CSV token theft) исправлен через ALLOWLIST**, но сам факт что CSV-импорт может писать в произвольные `localStorage`-ключи — порочная по дизайну фича. Лучше отдельный JSON-export, не CSV.
9. **🟡 jiraWriteConfig — не атомарная запись** (без temp+rename). Если сервер упадёт между `open` и `close`, `jira_config.json` обнулится.
10. **🟡 readFileSync / writeFileSync в request handler** (`jiraReadConfig` / `jiraWriteConfig`) блокируют event loop. На single-user OK, на 5+ конкурентных запросах деградация.

---

## Метрики кода

| Метрика | Значение | Комментарий |
|---|---|---|
| JS LOC (без libs/node_modules) | 33 310 | +5 KB vs V12 (chat-activity + extracts) |
| CSS LOC / bytes | 8 939 / 343 KB | −1.3% после CSS-vars sweep |
| HTML LOC | 919 | unchanged |
| Самый большой JS-файл | `app.js` 1 897 LOC (91.6 KB) | была 2 148 в V12 |
| Второй | `server.js` 1 828 LOC (89.3 KB) | была 2 612 в V12 |
| Тестов | 373 unit + 11 contract + 10 e2e + **104 testRunner** | testRunner = inline-зеркало, см. ниже |
| ESLint warnings | 207 | стабильно (105 unused + 95 innerHTML + 4 prefer-const + 3 другие) |
| ESLint errors | 0 | OK |
| TypeScript (--checkJs) | 0 errors | OK |
| Perf budget | All within limits | styles.css на 93%, остальное 75–85% |

---

## Структура отчёта

| # | Файл | Содержание |
|---|---|---|
| 00 | `00-summary.md` | этот файл |
| 01 | `01-security.md` | security findings — SSRF, CSP, файловые операции |
| 02 | `02-reliability.md` | reliability — race conditions, error handling, atomic writes |
| 03 | `03-tests.md` | разбор тестовой пирамиды — сильные стороны и долги |
| 04 | `04-frontend.md` | frontend-долги — innerHTML, a11y, реактивность |
| 05 | `05-server.md` | server-долги — sync IO, cache stampede, decomposition gaps |
| 06 | `06-v13-diff.md` | что нового в V13 и качество новой surface |
| 07 | `07-found-bugs.md` | сводный список найденного (NEW-V13-*) с severity |
| 08 | `08-recommendations.md` | приоритизированный список улучшений |

---

## Категория-оценки

| Категория | V12 | V13 | Комментарий |
|---|---|---|---|
| Architecture | хорошо | **хорошо+** | декомпозиция +DI, чистые границы модулей |
| Security | удовл. | **удовл.** | CSP/headers ✓, SSRF surface остался открытым |
| Reliability | удовл. | удовл. | race conditions / silent failures по-прежнему висят |
| Tests | хорошо | хорошо | количество растёт, но coverage gap по domain modules |
| Frontend code quality | удовл. | **удовл.+** | -300 LOC из app.js, semantic CSS vars |
| Server code quality | удовл. | **удовл.+** | factory-DI шаблон унифицирован |
| A11y | плохо | **плохо** | aria-live для toast есть, но focus management всё ещё нет |
| Documentation | удовл. | **плохо** | ARCHITECTURE.md V12, не V13 |
| Tooling/CI | хорошо | хорошо | ESLint+tsc+e2e+contract+perf — вся пирамида в порядке |

Звёздочки означают изменение по сравнению с V12. **Documentation просел** — все остальные либо стабильны, либо улучшились.
