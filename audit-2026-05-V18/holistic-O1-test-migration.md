# O1 — testRunner.js → node:test migration plan

> AUDIT_HOLISTIC §6 строка 122 (O1):
> «`testRunner.js` legacy + 104 legacy-test описание (DEVOPS 2.2) — должны
> быть migrate'нуты в `node:test`. retire в V18 P12, удалить из CI.»

Дата: 2026-05-08
Автор: QA-инженер (V18 P12 pilot)

---

## TL;DR

`testRunner.js` — самописный 909-LOC self-contained раннер, **104 теста / 0 fail**.
Тесты НЕ импортируют production-модули — они **inline-зеркалят** доменную
логику (RiskEngine, FilterEngine, DependencyEngine, MetricsEngine, safeHtml,
reactiveStore). Это значит: миграция = переписать тесты против **реальных**
модулей, а не просто скопировать.

Этот документ:
1. Каталогизирует все 104 теста по группам, реальный модуль и сложность.
2. Фиксирует план миграции в 3 фазы.
3. Описывает pilot pass (RiskEngine, 15 тестов) — выполнен в этом коммите.

---

## Baseline (на момент начала миграции — 2026-05-08)

| Раннер | Pass | Fail | Заметка |
|---|---|---|---|
| `node testRunner.js` | **104** | **0** | контракт «не сломать» |
| `npm run test:unit` | ~251 ✔ top-level / 13 ✖ subtests | pre-existing failures, **не V18 P12 регрессии** | doc claim 534/0 stale |
| `npm run test:contract` | 1 ✔ / 5 ✖ | pre-existing failures | |

**Контракт миграции**: testRunner остаётся 104/0; новые `tests/unit/*.test.js`
не должны добавлять fail'ов сверх baseline.

---

## Каталог 104 тестов

| # | Группа в testRunner.js | Тестов | Реальный модуль | DOM/IO? | Сложность миграции |
|---|---|---|---|---|---|
| 1 | RiskEngine — computeFlags | 9 | `riskEngine.js` (export RiskEngine) | нет | **easy** ← pilot |
| 2 | RiskEngine — computeRiskScore | 6 | `riskEngine.js` | нет | **easy** ← pilot |
| 3 | FilterEngine — applyFilters | 12 | `filters.js` (FilterEngine) — но API другой (читает `state.rows/state.filters` глобально, а тест передаёт rows как arg) | нет | medium — нужна обвязка вокруг state, **частично уже есть в `tests/unit/filterEngine.test.js`** → проверить дубликаты |
| 4 | DependencyEngine — cycle detection | 8 | `dependencyEngine.js` экспортирует `detectCycles(deps)` (plural, иной signature). testRunner тестирует приватный `detectCycle(deps, from)` + `getTransitiveDeps`, которых нет в публичном API | нет | medium — переписать против `detectCycles` с новыми тест-кейсами или экспортнуть helpers |
| 5 | MetricsEngine — computeProgress | 6 | `metricsEngine.js` | нет | medium — проверить что API совпадает |
| 6 | MetricsEngine — computeLoad | 4 | `metricsEngine.js` | нет | medium — проверить что API совпадает |
| 7 | toBool — state.js utility | 12 | `state.js` (export `toBool`) | нет (state импорт через `localStorage` stub) | **easy** |
| 8 | FilterEngine.filter — search | 4 | `filters.js` | нет | medium — overlap c #3 + tests/unit/filterEngine.test.js |
| 9 | FilterEngine.filter — release | 4 | `filters.js` | нет | medium — overlap |
| 10 | FilterEngine.filter — toggles | 4 | `filters.js` | нет | medium — overlap |
| 11 | FilterEngine.filter — workType | 3 | `filters.js` | нет | medium — overlap |
| 12 | MetricsEngine.computeProgress — counts | 8 | `metricsEngine.js` (V2 локальный, иное API) | нет | medium |
| 13 | MetricsEngine.computeProgress — edge cases | 4 | `metricsEngine.js` | нет | medium |
| 14 | safeHtml — escape semantics | 11 | `libs/safeHtml.js` (export `html`, `unsafe`) | нет | **easy** |
| 15 | reactiveStore — basic semantics | 9 | `reactiveStore.js` (export `Reactive`) — **уже частично покрыт в `tests/unit/reactiveStore.test.js`** | нет (есть setTimeout) | medium — overlap, нужен audit duplicates |
| **Σ** | **15 групп** | **104** | | | |

### Итого по сложности
- **easy** (RiskEngine, toBool, safeHtml): **38 тестов** → V18 P12 pilot
- **medium** (Filter, Metrics, Dep, Reactive с overlap): **66 тестов** → V18 P13 / V19
- **hard / нужно overlap-резолвить**: 0

---

## Стратегия миграции — 3 фазы

### Фаза 1 (V18 P12) — этот коммит
- Создать `tests/unit/legacy/riskEngine.test.js` — мигрирует группы 1–2 (15 тестов).
- legacy `testRunner.js` НЕ трогаем — остаётся в `npm test`.
- Добавить в `package.json` alias `npm run test:legacy` → `node testRunner.js` (явная семантика: «легаси-pre-V18, мигрируется»).
- Обновить `docs/testing.md` — закрепить «новые тесты только через `node:test`», добавить перечень что мигрируется и что ещё нет.

### Фаза 2 (V18 P13 / V19) — параллельная миграция остальных 89
1. Группы 5/6/12/13 (Metrics) — 22 теста — легко через реальный `metricsEngine.js`.
2. Группа 7 (toBool) — 12 тестов — изи.
3. Группа 14 (safeHtml) — 11 тестов — изи.
4. Группы 3/8–11 (Filter ×27 тестов) — **нужен deduplication audit** против `tests/unit/filterEngine.test.js` чтобы не размножать.
5. Группа 4 (Dep ×8) — переписать против `detectCycles`/`getCriticalPath` (новый scope).
6. Группа 15 (Reactive ×9) — **deduplication audit** против `tests/unit/reactiveStore.test.js`.

### Фаза 3 (V19+) — retire
- Когда node:test покрытие ≥ 104 тестов мигрировано (и зелёное ≥7 дней):
  - удалить `testRunner.js` с прод-пути в `package.json` (`scripts.test` → только `test:unit && test:contract`),
  - оставить `npm run test:legacy` как deprecated alias на 1 версию,
  - в финале удалить файл и alias.
- CI yml (если появится) — не трогать в P12, делать в фазе 3.

---

## Risks & guardrails

1. **Не сломать `npm test = 104/0`**: текущая фаза НЕ удаляет ничего из testRunner.js. testRunner.js остаётся в `scripts.test`, дублирующие node:test — добавочные.
2. **Deduplication risk**: для Filter и Reactive есть уже частичные node:test покрытия. До фазы 2 — провести explicit diff (group → which exact tests in `tests/unit/...test.js`) и не плодить.
3. **API drift**: testRunner inline-mirrors могут расходиться с production кодом (это и есть legacy-проблема). При миграции каждой группы: первый запуск против real-модуля выявит drift → фиксировать как отдельный bug-bullet, не молча подменять.
4. **state.js side-effects**: `state` импортируется в `riskEngine.js` через top-level. `state` инициализирует `Reactive.wrap` на module load. Pilot-tests должны корректно работать без `localStorage` (или со stub, как в `tests/unit/utils.test.js`).
5. **CI yml не трогаем**: миграция CI-pipeline = отдельная фаза 3.

---

## Pilot pass (этот коммит)

**File**: `tests/unit/legacy/riskEngine.test.js`
**Migrated tests**: 15 (группы 1+2 из таблицы выше)
**Approach**: импортируем реальный `RiskEngine` из `riskEngine.js` (а не inline-mirror).

Список (1:1 соответствие c testRunner.js):

| # | Имя теста (testRunner) | Имя теста (node:test) | Module |
|---|---|---|---|
| 1 | no flags on empty row | computeFlags — no flags on empty row | RiskEngine |
| 2 | BLOCKING_NEAR_RELEASE when blocker in 1.20 | computeFlags — BLOCKING_NEAR_RELEASE for 1.20 | RiskEngine |
| 3 | BLOCKING_NEAR_RELEASE when blocker in 1.21 | computeFlags — BLOCKING_NEAR_RELEASE for 1.21 | RiskEngine |
| 4 | no BLOCKING_NEAR_RELEASE for 1.22 blocker | computeFlags — no BLOCKING_NEAR_RELEASE for 1.22 | RiskEngine |
| 5 | IN_SCOPE_WITHOUT_RELEASE when scope=Да and unassigned | computeFlags — IN_SCOPE_WITHOUT_RELEASE | RiskEngine |
| 6 | no IN_SCOPE_WITHOUT_RELEASE when scope=Да but has release | computeFlags — IN_SCOPE_WITHOUT_RELEASE skipped if assigned | RiskEngine |
| 7 | CONFIRMATION_IN_RELEASE when needs confirm and in release | computeFlags — CONFIRMATION_IN_RELEASE | RiskEngine |
| 8 | no CONFIRMATION_IN_RELEASE when unassigned | computeFlags — CONFIRMATION_IN_RELEASE skipped if no release | RiskEngine |
| 9 | multiple flags can coexist | computeFlags — multiple flags coexist | RiskEngine |
| 10 | score 0 for clean row | computeRiskScore — 0 for clean row | RiskEngine |
| 11 | blocking adds 30 points | computeRiskScore — blocking adds 30 | RiskEngine |
| 12 | IN_SCOPE_WITHOUT_RELEASE adds 25 points | computeRiskScore — IN_SCOPE_WITHOUT_RELEASE adds 25 | RiskEngine |
| 13 | score capped at 100 | computeRiskScore — capped at 100 | RiskEngine |
| 14 | hasRelease120 adds 15 to score | computeRiskScore — hasRelease120 adds 15 | RiskEngine |
| 15 | computeAll processes every row | computeAll — processes state.rows | RiskEngine |

Особенность: testRunner.js в группе 1–2 передаёт `rows` как параметр в
`computeAll(rows)`. Реальный `RiskEngine.computeAll()` (без аргументов) ходит
в `state.rows`. В pilot мы:
- для тестов 1–14 — вызываем `computeFlags(row)` / `computeRiskScore(row)` напрямую (signature совпадает);
- для теста 15 — мутируем `state.rows = [...]` локально, вызываем `computeAll()`, проверяем результат на `state.rows`.

---

## Следующие шаги (после P12 pilot landed)

1. Записать в `audit-2026-05-V18/MASTER_PLAN.md` (если есть P12) что O1 phase-1 закрыт.
2. Открыть V18 P13 ticket: «O1 phase-2 — мигрировать toBool + safeHtml + Metrics (39 тестов)».
3. Перед фазой 2 — diff-аудит дубликатов с `tests/unit/filterEngine.test.js` и `tests/unit/reactiveStore.test.js`.
4. CI yml (если будет добавлен) — `test:legacy` пока в pipeline через `npm test`. Удаление из CI = фаза 3.

---

## Связанные документы

- `docs/testing.md` — обновлён в этом коммите (явный список «что мигрируется»).
- `audit-2026-05-V18/AUDIT_HOLISTIC.md` §6 O1 — исходное обоснование.
- `audit-2026-05-V18/AUDIT_DEVOPS.md` §2.2 — DevOps требование retire.
