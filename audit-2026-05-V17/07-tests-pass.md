# Пункт 7 — Прогон тестов

После пунктов P1-P6:

```
ℹ tests 516
ℹ suites 130
ℹ pass 516
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 363.30575
```

```
Contract: 11 passed, 0 failed
```

## Что добавлено за итерацию V17 (P1-P6)

| File | Tests | Что покрывает |
|---|---|---|
| `tests/unit/v17AuditFixes.test.js` | 19 | CRIT-1 (token leak), H4 (RowFactory restore), CRIT-4 (delete-pill arrow filter), H3 (Cyrillic regex), CRIT-3 (edit-mode trail), H6 (Map-based comments) |
| `tests/unit/v17ChatRedesign.test.js` | 19 | CHAT-5 (cite-regex), CHAT-1 (hotkey policy), CHAT-9 (up-arrow recall), CHAT-4 (category labels) |

## Покрытие до vs после V17

| Метрика | До (v16) | После (V17 P1-P6) |
|---|---|---|
| Unit-тестов | 478 | **516** (+38) |
| Suites | 122 | **130** (+8) |
| Contract-тестов | 11 | 11 |
| Failing | 0 | **0** |

## Что не покрыто тестами (TODO для будущих итераций)

Из аудита P1 в `01-tech-audit.md` остались TODO:

1. **`reactiveStore.js`** — нет тестов на `silent` / `flushNow` / re-entrancy
2. **`HistoryManager`** checkpoint/undo
3. **`server.js` `serveStatic` path-traversal**
4. **`server.js` `jiraForward` SSRF allowlist** (требует фичу самой allowlist)
5. **`/api/integrations/employee-performance`** contract test (TODO-10 в P4)
6. Гант чтение пилюли как DOM (требует jsdom)

## Резюме

Все фиксы P1-P6 не сломали существующие тесты. Регрессионная защита расширена на 38 новых тестов. Базис устойчив для продолжения работы по пунктам P8-P12.
