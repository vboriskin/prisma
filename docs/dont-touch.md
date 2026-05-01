# Don't Touch — Осознанная кривизна

Места которые **выглядят** как баги или legacy code, но на самом деле — сознательные компромиссы. **Не «фикси»** их без понимания контекста.

## 1. `_ppFindByPartial` в `integrations/portfolioPulseModel.js`

**Что выглядит подозрительно:** Функция fuzzy-name-matching с tokenSet/transliteration, выглядит как production-код, **никогда не вызывается в production-path**.

**Почему так:**
- До V17.2 это был основной механизм атрибуции BB/CF данных к сотрудникам
- Жалоба пользователя «PR привязываются к не тем людям» → V17.2 I1c → переход на deterministic identity (`state.employees[].bitbucketLogin`)
- Функция оставлена как **dev-only fallback** за флагом:

```js
analysePulse(raw, { allowFuzzyAuthorMatch: true })
```

Нужна для:
- Локальной отладки когда identity ещё не настроена
- Edge-case'ов когда нужно вручную проверить «а нашлись бы матчи если включить fuzzy»

**Не делай:**
- ❌ Не удаляй — flag-based fallback нужен
- ❌ Не «улучшай» алгоритм матчинга
- ❌ Не врубай как production
- ❌ Не пиши новые тесты «должна найти Иванова в Ivanov» — тест `V17.2 I1c: fuzzy SUPPRESSED по умолчанию` явно проверяет что НЕ находит

См. [`state-contracts.md` § Identity](./state-contracts.md), `audit-2026-05-V17/13-integrations-audit.md` § I1c.

## 2. `Reactive.silent` обвязка в `Storage.save / restore`

**Что выглядит подозрительно:** Везде вокруг внутренностей `Storage.save` обёртка `Reactive.silent(() => { ... })`. Похоже на «cargo cult».

**Почему так:** без silent — infinite loop. `Storage.save` вызывает `syncColumnSettings` который пишет в `state.colOrder` → Reactive trap → `Storage.save` → снова `syncColumnSettings` → бесконечно.

**Не делай:**
- ❌ Не убирай `silent` из save/restore «для упрощения»
- ❌ Не вызывай `Storage.save` вручную из subscribers — уже вызывается; повторный вызов создаст вложенные silent'ы

См. [`state-contracts.md` § Reactive](./state-contracts.md).

## 3. `_dataVersion` bump только в forceSave

**Что выглядит подозрительно:** `state._dataVersion++` происходит только в `forceSave()`, а не на каждую row-mutation. Кажется что cache в `FilterEngine` будет stale.

**Почему так:**
- Bumping на каждый prop-set создаёт invalidation-storm
- V17 P11 F1 — `FilterEngine.invalidate()` теперь вызывается напрямую в Reactive subscriber (более точечно)
- `_dataVersion` нужен только для cross-tab сценариев и snapshot-detection

**Не делай:**
- ❌ Не добавляй `state._dataVersion++` на row-mutation paths — produced storm
- ❌ Не убирай invalidate() из subscriber — getFiltered() станет stale

## 4. Sigma fields внутри `jira_config.json`

**Что выглядит подозрительно:** Sigma — отдельный Jira-инстанс, но его настройки (`sigmaJiraBaseUrl`, `sigmaJiraToken`, `sigmaGoalEpicKeys`) лежат в **общем** `jira_config.json`, а не в `sigma_config.json`.

**Почему так:**
- Исторический артефакт V12 (когда Sigma добавили — было быстрее запихнуть в существующий конфиг)
- Миграция = breaking change для всех текущих юзеров (придётся писать migration script + переучивать)
- Польза от разнесения — нулевая (security сейчас не страдает, scrub работает)

**Не делай:**
- ❌ Не разноси без миграционного плана и обсуждения

## 5. `path-cascade` логика дублируется в 5 местах

**Что выглядит подозрительно:** Pattern «попробуй `/wiki/rest/...`, потом `/rest/...`» в `server.js` встречается **5 раз** — не вынесено в helper.

**Почему так:** небольшие различия между endpoints (что делать на 401 vs 404 vs 400, какие fallback URLs пробовать), и каждое место возникало в свою итерацию (V12 P2 → V17.2 I2a → I2b → I2c-G5 → I2c-G7).

**Не делай:**
- ❌ Не пытайся вынести в один универсальный helper «как раз сейчас» — рискуешь сломать поведение на edge-cases
- ✅ TODO когда пойдём в I3 рефакторинг — вынести в `_cfPathCascade(paths, baseUrl, headers, opts)` с явными failure-modes

См. [`integrations/README.md` § Path-cascade pattern](./integrations/README.md).

## 6. `testRunner.js` живёт рядом с `node:test`

**Что выглядит подозрительно:** В корне есть `testRunner.js` (~900 строк, самопис) **и одновременно** `tests/unit/*.test.js` (node:test). Зачем дублировать?

**Почему так:**
- testRunner — legacy с момента когда node:test ещё не было (Node 18 era)
- Постепенная миграция: новые тесты пишутся в `tests/unit/*.test.js` через `node --test`
- 104 теста всё ещё в testRunner — миграция не закончена, удалять преждевременно сломает CI

**Не делай:**
- ❌ Не пиши новые тесты в testRunner
- ❌ Не удаляй testRunner.js «для cleanup»
- ✅ Когда будут силы — мигрируй блок тестов из testRunner в tests/unit/, а потом удаляй testRunner целиком

## 7. `lint --max-warnings 215`

**Что выглядит подозрительно:** Magic number `215` в `package.json`.

**Почему так:** legacy budget — было `~250`, опускался по мере фиксов до `215`. Не должно расти, должно опускаться.

**Не делай:**
- ❌ Не повышай число «чтобы прошёл CI»
- ❌ Не понижай через массовый `eslint-disable` — это обходит проблему
- ✅ Понижай по 1-2 за итерацию, удаляя реальные warnings

См. [`testing.md` § Lint warnings](./testing.md).

## 8. Эмодзи в `app/onboarding.js` 24-step legacy tour

**Что выглядит подозрительно:** В `app/onboarding.js` (legacy 24-step tour) масса эмодзи в текстах шагов. V15 говорит «no emoji в production UI».

**Почему так:**
- Onboarding tour — отдельная UX зона (one-time-only, не data-display)
- Эмодзи помогают новичкам ориентироваться (это инструкция, не Реестр)
- Spine-pill no-emoji rule применим к **data surfaces** (Реестр / Гант / Дашборд / Settings), не к onboarding

**Не делай:**
- ❌ Не убирай эмодзи из onboarding-шагов
- ✅ V15 retired эмодзи в data-views и chat — но не в tour

См. [`spine-pill.md`](./spine-pill.md).

## 9. `_ppMergeAuthorMaps` в server.js

**Что выглядит подозрительно:** Объединяет `bitbucketRepoWalk.authors` и `devStatus.authors` в один словарь. Кажется что это причина BB-misattribution.

**Почему так:**
- Fact: V17.2 I1d добавил **defensive фильтр** `_devStatusAuthorsFiltered` — entries без email/login отбрасываются ПЕРЕД merge
- Дальше merged уходит в Pulse → identity-deterministic match (V17.2 I1c) на frontend → плохие entries не привязаются

**Не делай:**
- ❌ Не разделяй map'ы обратно «потому что merge подозрительно»
- ❌ Не отключай dev-status walker — его данные ценны для случаев когда Bitbucket сам не настроен
- ✅ Если жалуются на новую misattribution — проверь identity-таблицу пользователя, не merge

## 10. Backticks внутри HTML-комментариев в JS template literals

**История:** В V17.2 уже один раз сломалось:
```js
return `
  <!-- (Bindings: \`#int-jira-*\`) -->
  ...
`
```
Браузер парсит первый backtick в комментарии как **end** outer template literal → `#int-jira-*` интерпретируется как expression → `#int` это invalid private name → **`SyntaxError: Unexpected private name #int`**.

**Не делай:**
- ❌ Не используй backticks в HTML-комментариях которые сидят внутри JS template literal
- ✅ Если хочется обозначить идентификатор — используй обычные кавычки или просто сам идентификатор без оформления

`node --check` пропускает (там не выполняются функции), сломается только в браузере.

## 11. `app.js` как 2613-строчный orchestrator

**Что выглядит подозрительно:** Один файл с App, BulkEditPanel, init, navigation, reactive subscribe, history, save, etc.

**Почему так:** Постепенная decomposition в `app/*` (см. `ARCHITECTURE.md` § Decomposition status). Перенос делается по одному модулю когда становится безопасно. Не «всё разом» — слишком много cross-imports.

**Не делай:**
- ❌ Не делай большой PR «вынесем всё за раз»
- ✅ Один модуль за итерацию, тесты после каждого

## 12. `КАК-ЗАПУСТИТЬ.md` + `Запустить (Mac).command` + `Разблокировать на Mac.txt`

**Что выглядит подозрительно:** В корне 3 файла со странными именами на русском которые не выглядят как dev-инструкции.

**Почему так:** Конечный юзер — PM/team-lead в Сбере, у которого может НЕ БЫТЬ установленного `node` или прав запускать `.sh`. Эти файлы для них:
- `КАК-ЗАПУСТИТЬ.md` — инструкция русским языком
- `Запустить (Mac).command` — двойной клик в Finder
- `Разблокировать на Mac.txt` — `xattr -d com.apple.quarantine` trick для blocked .command
- `Запустить (Windows).bat` — Windows эквивалент

**Не делай:**
- ❌ Не удаляй «cleanup repo»
- ❌ Не «нормализуй» имена в латиницу — пользователь видит их в Finder
- ✅ Если что-то меняешь в запуске — синхронизируй с этими файлами

См. [`running.md`](./running.md).

## 13. Ярлыки `V11/V12/V14/V15/V16/V17/V17.x` в коде

**Что выглядит подозрительно:** Тонна меток в комментариях, разные эпохи перемешаны. Хочется унифицировать.

**Почему так:** каждый ярлык — это **точная ссылка в audit-папку** где описано почему так сделано. Удалить = потерять связь между кодом и решениями.

**Не делай:**
- ❌ Не «нормализуй» в одну схему
- ❌ Не удаляй «как старые комментарии»
- ✅ Расшифровка ярлыков — `docs/version-history.md`

## 14. `state.simMode` (sim-mode banner)

**Что выглядит подозрительно:** Глобальный режим симуляции с оранжевым баннером. Нет UI кроме кнопки в шапке. Что это вообще.

**Почему так:** «Что если» режим — пользователь вносит правки в гант (переносит pill, меняет scope), всё работает как обычно, но **на save ничего не записывается**. По выключению — всё откатывается.

Полезен PM'у который хочет «потыкать как было бы» без риска. Защищён от случайного включения (visible orange banner).

**Не делай:**
- ❌ Не убирай оранжевый banner — это safety guard
- ❌ Не путай с `ganttEditMode` (это другое — bypass комментариев в plan-locked)

## 15. Файл `appDataStore.js` рядом с `dataStore.js`

**Что выглядит подозрительно:** `appDataStore.js` (7KB) и `dataStore.js` (55KB) — оба вроде про persistence?

**Почему так:** разные слои, не дубликаты:

| Файл | Что делает |
|---|---|
| `dataStore.js` (55KB) | Основной storage слой: CSV/XLSX/JSON import-export, settings persistence, scrubSecrets, миграции localStorage v1/v2/v3, snapshot/restore. Источник правды для всего что юзер видит. |
| `appDataStore.js` (7KB) | **Facade** над `dataStore` (localStorage) и `sqliteStore` (SQLite-WASM). Решает по `localStorage.dataStorageMode === 'sqlite' \|\| 'localStorage'` куда писать `rows / changeLog / comments`. UI код (settings panel, migration buttons) ходит через facade — не должен знать какой backend активен. |

Используется в:
- `app.js` — `AppDataStore.init()` на boot, `AppDataStore.migrateFromLocalStorage()` / `migrateToLocalStorage()` для UI кнопок
- `app/storageSettings.js` — панель настроек хранилища
- `scripts/perfBudget.js` — отдельная проверка размера

**Не делай:**
- ❌ Не сливай в `dataStore.js` — facade pattern полезен, разделение слоёв осознанное
- ❌ Не удаляй как «дубликат»

---

## Когда добавлять сюда новый пункт

- Реальный case когда LLM/новый dev пытается «починить» правильное место
- При retired-feature которая оставила следы
- При архитектурном компромиссе который не очевиден из кода
- При дубликации которая выглядит как баг но защищена контрактом

Лучше иметь короткий пункт с описанием «почему» чем не иметь.
