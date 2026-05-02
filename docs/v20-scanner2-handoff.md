# V20 «Сканнер команд 2.0» — Handoff для следующего LLM-агента

> Этот документ — **минимальный самодостаточный context** для продолжения работы по фиче «Сканнер команд 2.0». Если ты — новый Claude/LLM-агент, читай этот файл ПЕРВЫМ, после `CLAUDE.md` и `docs/state-contracts.md`.

**Дата последнего hand-off**: 2026-05-02
**Последняя итерация**: V20 S9 (Real Zephyr fetch для Sber DC)
**Тесты**: 771/771 зелёные

---

## 1. Что мы строим — за 30 секунд

«Сканнер команд 2.0» — внутренний инструмент тимлидов в дашборде планирования (вкладка «Интеграции» → «Сканнер команд»). Показывает состояние команды по 4 группам (Стоп / Watch / Движется / Без активности) на основе активности из Jira / Bitbucket / Confluence / Zephyr.

**Pilot**: 109 человек в команде «СБОФ Платформа», 5 проектных ключей (`SBOFPLCORE, SMECM, SMEAM, SMEND, SMECIS`), Sber Delta инстанс.

**Ключевая боль пилота, которую мы решали**: BB/CF не возвращали данных по сотрудникам — потому что их identity (bbLogin, confluenceAccountId) не была заполнена в реестре. После S5 это исправлено через auto-create employees из Jira + Auto-Resolve через email→API.

---

## 2. Где код живёт

### Главные файлы (в порядке важности)

```
integrations/
├── teamScanner2.js              orchestrator (~1700 строк, lifecycle + handlers)
├── teamScanner2Renderer.js      ВЕСЬ UI rendering (~2300 строк, god-module)
├── teamScanner2Enrichment.js    classify, blockers, sprint goal, 6 new metrics (~1100)
├── teamScanner2Diagnostic.js    gather state + JSON export + scrub contract (~750)
├── teamScanner2Classifier.js    pure classifyPerson (single source of truth, S8 #15)
├── teamScanner2Config.js        team thresholds + presets + METRIC_THRESHOLDS re-export
├── teamScanner2History.js       multi-day snapshot persist (V19 C2)
├── portfolioPulseModel.js       analysePulse + identity matching (BB/CF/Zephyr lookup)
└── integrationsSync.js          verify*, resolveIdentitiesByEmail wrapper

views/
├── employees.js                 SA-toggle UI (S8 #11, в `<details>Дополнительно</details>`)

server.js (~3500 строк) — критичные функции:
├── ppFetchBitbucketActivity        (line ~875)
├── ppFetchConfluenceActivity       (line ~1565)
├── _ppCfAuditAugment               (line ~1816, V20 S5.3)
├── ppFetchZephyrActivity           (line ~1908, V20 S9 NEW)
├── jiraResolveProjectId            (line ~1898, V20 S9 NEW)
├── /api/integrations/resolve-identities  (line ~2730, V20 S4-S5.2)
└── /api/integrations/diag-audit    (line ~2710, V20 S8.5 #14)

tests/unit/
├── teamScanner2Diagnostic.test.js  35 contract тестов
├── teamScanner2Metrics.test.js     25 metrics тестов
├── teamScanner2ScrubProperty.test.js  property-based scrub
├── teamScanner2Classifier.test.js  classifier
├── employeeFactory.test.js         + service-account detect
└── teamScanner2History.test.js
```

---

## 3. История V20 S1-S9 (что когда сделано)

| Sprint | Главное содержимое | Тесты |
|---|---|---|
| **S1** | Lazy-load + window-presets + how-modal + stale-banner | 0 |
| **S2** | Diagnostic modal + JSON export + scrub contract + audit log | +23 |
| **S3** | Connection probe + sensitivity preview + TZ skew | +12 |
| **S4** | Identity Auto-Resolve + service-account auto-detect | +10 |
| **S5** | Auto-create employees из Jira + CF FIO-cascade + audit-log fallback | 0 |
| **S6** | 8 hotfixes + 6 metric fixes + 6 new metrics (CRV, PR throughput, slope, Z-score, EMA, cross-team) | +25 |
| **S7** | UI surfaces для new metrics (CRV-bar, slope-arrow, anomaly badges) + 13 audit findings | 0 |
| **S8** | 22 polish/arch tasks (XSS fix, kebab, triage-pill, copy-for-TG, METRIC_THRESHOLDS, classifier extract, memoize) | +5 |
| **S8.5** | 16 follow-up tasks (real METRIC_THRESHOLDS wire-up, audit retry queue, anomaly mini-chart, 1:1 inline) | 0 |
| **S9** | **Real Zephyr fetch для Sber DC** (новый endpoint /rest/tests/1.0/*, отдельный fetcher) | 0 |

**Полная история итераций — в commit-log репо. Этот файл — только контекст.**

---

## 4. КРИТИЧНЫЕ контракты — не нарушай

### V17.2 I1c — Identity-deterministic attribution
- BB/CF атрибуция строго по `state.employees[].{email, jiraAccountId, bitbucketLogin, confluenceAccountId}`
- **Никаких fuzzy-name-matches** (`_ppFindByPartial` существует, но это dev-only fallback за флагом)
- При S9: Zephyr `userKey` = `jiraAccountId` для Sber DC. Match напрямую

### Reactive.silent contract (CLAUDE.md §1)
- Mass-mutations в `state.*` обязаны быть в `Reactive.silent(() => {...})`, иначе infinite loop
- `Storage.save?.()` ВЫНОСИТСЯ за пределы `Reactive.silent` (S8.5 #B3 fix)
- Использовать `appState` alias в teamScanner2.js (там есть `const state = ...` локальная переменная-shadow)

### Scrub policy (CLAUDE.md §3)
- Все JSON-export'ы проходят через `prepareDiagnosticExport(state, mode)` в teamScanner2Diagnostic.js
- Safe-mode regex покрывает: `email|accountId|userKey|userName|username|key|fio|displayName|name|fullName|label|secret|token|...`
- При добавлении нового PII-поля — обновить regex в `_scrubInPlace` + property-based test
- **БОНУС: новый XSS class regression в S8.5 #1** — все user-config strings (`sinceDate`, `tz.browserTzLabel` и т.п.) обязательно через `esc()` если попадают в HTML body

### TDZ guards
- Историческая беда: 3 раза за месяц ловили TDZ из-за неправильного порядка `const`-объявлений в `_renderFull` / `_fetchAndRender`. **Все ctx-переменные деkларируются ДО построения template literals**, не после.
- Pattern для нового code: сначала все `const x = ...`, потом `const html = \`...\${x}...\``

---

## 5. Где сейчас оставлены хвосты

### От аудитов экспертов (не выполнено)

#### Pure архитектурные (high-risk refactor, отложены до S10+)
- **#17 Lifecycle public API** (attach/paint/detach) — добавлен thin wrapper в teamScanner2.js, но `IntegrationsView` ещё не мигрирован на него
- **#22 Renderer.js split** — поставлены маркеры границ для будущего разделения, файл всё ещё 2300 строк
- **#10 Server-side consent storage** — сейчас localStorage, не подделка-resistant

#### Compliance gaps
- **#12 Rate-limit на `/api/integrations/diag-audit`** — endpoint без защиты от flood
- **#13 Property-test реально property-based** — текущий тест 100x тот же layout, не настоящее fuzzing

#### Backlog UX полировки
- Counter «consent активен ещё N часов» в settings (видна только в disclaimer'е)
- Listener leak risk в kebab при `_renderFull` re-render (P2)
- Focus management для kebab menu (a11y P2)

### От пилота (нужна верификация на real data)
- **S9 Real Zephyr fetch — ещё не проверен на pilot**. Ожидаемые гочи:
  - Token может не иметь прав на `/rest/tests/1.0/*`
  - `userKey` формат может отличаться (`1697487` vs `JIRAUSER1697487`)
  - CQL фильтр `testCase.updatedOn >= "..."` может не работать
  - Это будет видно в первом diagnostic JSON после S9 deploy

### Известные косметические debts
- **silent_error coverage 4/24** в teamScanner2.js (S8 #16). Закрыты только 4 критичных. Оставшиеся 20 silent catches остались (low priority — большинство defensive)
- **`_v20s8_metricsMemo` cache fingerprint** — включает teamThresholds, но НЕ включает `dwellHours` если он передан явно (edge case при custom override)

---

## 6. Recent pilot insights (последний JSON 2026-05-02)

```
teamSize: 109 (after auto-create from 17→109 в S5)
identity:
  email:   93%
  jiraId:  100%
  bbLogin: 82%   (после auto-resolve, было 0%)
  cfId:    49%   (после S5.2 FIO-cascade, было 0%)
counts:    stop=79  watch=5  moving=2  idle=23
sources:
  bitbucket: 46 items (cap'нуто attribution; раньше тоже 46 → identity заполнилась но pulse re-fetch ещё не делался)
  confluence: 0      (нужен ↻ Обновить чтобы пересчитать с заполненным cfId)
  zephyr:    0/0     (S9 fix — после S9 deploy + ↻ Обновить должен заработать)
botsFilteredOut: 4   (auto-detected, source: 'registry')
```

**Главный pending action для пилота**: после S9 deploy сделать `↻ Обновить` (это запустит pulse fetch с новой identity + Zephyr API). Ожидаю:
- `cf.totalItems > 0` (~30-100)
- `zephyr` counts > 0 (нет ground truth, но не должно быть 0 если Zephyr настроен в проекте SMECIS — там 1255 test runs)
- `stop: 79 → 30-40` (из-за того что у людей появятся events из BB/CF/Zephyr)
- `moving: 2 → 30-50`

---

## 7. Цикл работы (наш rhythm)

1. **Pilot прогоняет** → присылает diagnostic JSON
2. **Я анализирую** — нахожу что не сошлось, какие counts перекошены, какие endpoint'ы не отвечают
3. **Эксперты могут аудитить** через subagents (Senior fullstack, Tech Lead, Pilot persona) — обычно даёт 5-15 находок
4. **User выбирает** какие находки фиксить (по нумерованной таблице)
5. **Я делаю в фазах** (P1 quick wins → P2 logic → P3 architecture → P4 compliance)
6. **`npm run test:unit`** — должно быть зелёным до commit
7. **Loop**

Не забываю: **commit делается ТОЛЬКО когда user explicitly попросит**. Пользователь видит diff в terminal, рекомендует pilot прогон, я только пишу код.

---

## 8. Quick health check (запустить в новой сессии)

```bash
cd /Users/vaceslavboriskin/q2_parse/v17_0
npm run test:unit                            # должно быть 771/771 зелёные
node --check server.js                       # syntax OK
node --check integrations/teamScanner2.js
node --check integrations/teamScanner2Renderer.js
git status                                   # должны быть untracked / modified — НЕ COMMIT'НУТО
git log --oneline -5                         # last commits для контекста
```

Если что-то красное — это регрессия от моей последней работы, возможно нужен rollback. Спрашивай user перед действием.

---

## 9. Tips для следующего меня

### Когда user даёт diagnostic.json
- Файл может быть до 1MB. **Не читай целиком** — `Read` упадёт. Используй `offset/limit`
- Сначала смотри `header / config / connection` (line 1-100)
- Потом `identity.coverage` — это сразу даёт diagnosis
- Потом `sources.rawDiag` — отличает «server вернул 0» vs «identity gap»

### Когда user просит «составь список в одну таблицу»
- Прежде чем писать таблицу — проконсультируйся с TodoWrite, оцени количество задач
- Таблица: №, Что, Зачем (плейн), Кто нашёл, Severity, Время
- В конце предложи 4 варианта scoping (минимум / средне / полный / pilot first)

### Когда user пропускает P0 security findings
- НЕ молчи. Скажи явно: «ты пропустил #N — это P0 (XSS / token leak / etc)». Сделай fix без спроса
- В финальном отчёте flag это как BONUS

### Когда context budget низкий
- Не делай 22 задачи в один заход. После каждой большой Phase — verify tests + commit-readiness
- Обновляй TodoWrite после каждой фазы — пользователь видит прогресс
- Если задача требует > 30 мин — лучше сделай меньше, но не сломай build

### Самые частые баги которые я ловил
1. **TDZ** при добавлении нового const-помощника — порядок объявления внутри функции
2. **Circular import** при попытке вытащить config-словарь между Enrichment ↔ Config
3. **Apostrophe in test name** ломает single-quote string в node:test descriptions
4. **localStorage shim** в node:test нужен для Diagnostic / History тестов
5. **CR/LF в диагностике** — `String.slice(0, 200)` в redactSecretsInText недостаточно для base64-encoded токена

---

## 10. Быстрая навигация по pilot data

Pilot diagnostic JSON живёт в:
```
/Users/vaceslavboriskin/PycharmProjects/n8n/work/sbof_planner/diagnostic.json
```

Этот файл периодически обновляется пилотом (на нём же есть API examples в plain text после JSON-блока). **Структура файла**:
1. Line 1: header «ВЫГРУЗКА diagnostics из нашего приложения»
2. Lines 5-757: JSON выгрузка
3. Line 760+: API examples (BB / CF / Zephyr) разделённые `-----` маркерами

При чтении используй `grep -n "^https://\|^-----\|^Request URL"` чтобы найти границы секций.

---

## 11. Что user скорее всего попросит дальше

После S9 deploy — самые вероятные сценарии:

### A) «Прислал JSON, проанализируй»
1. Read diagnostic.json (offset/limit, не целиком)
2. Сравни coverage до/после
3. Зафиксируй: zephyr counts > 0? Если нет — какой endpoint падает (см. `tried[]`)
4. Если CF coverage не вырос — `_ppCfAuditAugment` мог не сработать, проверь `tried` в JSON

### B) «Зови экспертов снова»
1. Subagents в parallel: Senior Full-stack + Tech Lead + Pilot
2. Брифинги — что было сделано в последней итерации, что проверить
3. Свести в таблицу с priority, дать user выбор

### C) «Pilot заработал, что дальше — продакшен?»
1. S10 Lifecycle API + Renderer split (отложенные high-risk refactor'ы)
2. Server-side consent (compliance hardening)
3. Pilot-tested scrub edge cases — найдём вместе

### D) «Не работает [что-то конкретное]»
1. Diag JSON → connection.perPkErrors — server-side ошибки
2. `tried` arrays в каждом fetcher — какие endpoints какой статус вернули
3. Console errors — обычно TDZ или import resolution

---

## 12. Контакты / финальные предупреждения

- **НЕ редактируй** файлы в `audit-2026-*/` — это read-only ADR-history
- **НЕ commit'ь** без явной просьбы user
- **НЕ удаляй** legacy fallback `_ppFindByPartial` — это dev-only за флагом, см. `docs/dont-touch.md`
- **Vendored libs** не трогать (libs/xlsx.full.min.js)

При сомнениях — задай вопрос user'у. Лучше 30 секунд clarification чем час отката изменений.

---

**Удачи.** Всё что нужно для быстрого восстановления контекста — здесь. Если что-то не нашёл — ищи в коммит-логе по тегу `V20 S<N>` или в `audit-2026-05-V20/` (если такая папка появится).
