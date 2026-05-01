# 06. Что нового в V13 — качество surface

## Краткая сводка изменений V13

| Изменение | Файлы | Audit-маркер |
|---|---|---|
| Новое: chat-activity (3 system prompts + 6 user templates + classifier + handler) | `chat/chatActivityIntents.js` (259), `chat/chatActivityPrompts.js`, `chat/chatActivityHandler.js` (243), `chat/chatEngine.js` (modified) | V13 feature |
| Декомпозиция app.js | `app/storageSettings.js` (185), `app/promptsEditor.js` (126), `app/nav.js` (58) | audit #18 |
| Декомпозиция server.js | `server/integrations/techInfo.js` (589), `server/integrations/blackDashboard.js` (255) | audit #19 |
| CSS-vars + cleanup | `styles.css` (343 KB, было 348 KB) | audit #27 |
| Тесты chat-activity | `tests/unit/chatActivityIntents.test.js` (24), `tests/unit/chatActivityPrompts.test.js` (25) | V13 feature |
| `parseDomainLink.test.js` обновлён | `tests/unit/parseDomainLink.test.js` | следствие декомпозиции |
| `app.js` импорты + DI-call-sites | `app.js` (1897 LOC, было 2148) | audit #18 |
| `server.js` импорты + factory wiring | `server.js` (1828 LOC, было 2655) | audit #19 |

---

## Качество новых модулей

### V13 chat-activity

#### 🟢 `chat/chatActivityIntents.js` (259 LOC)

**Сильные стороны**:
- Pure functions — `classifyActivityIntent`, `extractIssueKey`, `extractRelativeDate`, `resolveDateRange`, `extractEmployees`, `parseActivityQuery`. Все side-effect-free.
- Cyrillic-aware regex boundaries `(?:^|[^а-яёa-z0-9])` (исправление V12 баг с `\b` перенесено корректно).
- 24 unit-теста покрывают edge-cases (empty input, mixed scripts, fuzzy date).
- Понятный комментарий-шапка с обзором intent'ов.

**Слабые места**:
- `RULES` массив — `first-match-wins`, ordered by specificity. Это **скрытое coupling**: вставка нового правила между existing двумя может изменить классификацию. Тестов на ordering нет.
- `extractEmployees` — три эвристики (substring / first+surname-prefix / dot-style email). Третья ветка (`label.replace(/[._]/g, ' ')`) только для labels с точкой/подчёркиванием. Если label это «ivan.petrov», ищется «ivan petrov» в нижнем регистре — но если в тексте «ivan.petrov», substring-match сработает первым. Edge-case: «ivan-petrov» в text vs «ivan.petrov» в label — НЕ матчится.

**Severity**: ✅ Качество хорошее. Рекомендация: добавить тесты на ordering правил (что именно `NOW > COMPARE > BY_ISSUE > FEED > TEAM > DAY > GENERIC`), добавить тест на «ivan-petrov vs ivan.petrov».

#### 🟢 `chat/chatActivityPrompts.js`

**Сильные стороны**:
- Три system-prompts (BASIC / DETAILED / ANALYTICAL) логично подобраны.
- `ACTIVITY_ANTI_INJECT` — anti-prompt-injection trailer есть.
- 25 тестов покрывают content invariants (упоминание Jira/BB/CF/Zephyr, режимы, шаблоны).

**Слабые места**:
- Antipattern test «mentions four data sources»: hardcoded на названия — если система когда-нибудь начнёт говорить «GitLab» вместо «Bitbucket», тесты упадут вне реальной поломки.

**Severity**: ✅ Хорошее качество.

#### 🟡 `chat/chatActivityHandler.js` (243 LOC)

**Сильные стороны**:
- Хорошо документированная public surface (`handleActivityQuery(text, deps) → {…}`).
- DI через `deps.pulseModel` — правильный pattern.
- Каждый из 6 intent'ов чётко разделён (switch).

**Слабые места**:
- **0 тестов**. Вся ветвистая логика — без покрытия (TST-5).
- `(window as any).PortfolioPulse._model` доступ через `chat/chatEngine.js:658` — нарушение чистоты handler'а.
- См. REL-10 — clarification message misleading при отсутствии Pulse.

**Severity**: 🟡 Логика чистая, тестов нет.

### V13 декомпозиция

#### 🟢 `app/storageSettings.js`, `app/promptsEditor.js`, `app/nav.js`

**Сильные стороны**:
- Чёткие границы. Каждый модуль имеет один responsibility.
- DI-pattern (`render(host, deps)`) — корректный.
- Backward-compat через `window.PromptsEditor = ...` сохранён (исправляет FOUND_BUGS #5 правильно).
- Все изменения покрыты существующими тестами (никаких регрессий).

**Слабые места**:
- `app/storageSettings.js` — 12 ESLint warnings раз-в-раз (innerHTML без эскейпа). Унаследованы из inline-кода V12; не «свежие».
- `app/promptsEditor.js` — глобал `window.PromptsEditor` используется в `app.js:1790`. Дубль — модуль сам уже выполняет это в `if (typeof window !== 'undefined')`. Comment в app.js это объясняет, OK, но **избыточная** инициализация.

**Severity**: ✅ Хорошее качество.

#### 🟢 `server/integrations/techInfo.js`, `server/integrations/blackDashboard.js`

**Сильные стороны**:
- Factory pattern (`createTechInfo({deps}) → {buildTechInfo}`) — отличный compromise между ESM и существующей CommonJS-инфраструктурой.
- Cache в closure (module-scope) — encapsulated, не утекает.
- Комментарий-шапка объясняет «зачем factory, а не imports».
- Тесты `parseDomainLink.test.js` обновлены без потери покрытия.

**Слабые места**:
- `_techInfoCache` всё ещё подвержен cache stampede (REL-4).
- `_ppMakeAuthHeader` (в server.js) дублирует логику, которая есть и в Bitbucket/Confluence handlers внутри Tech Info. Не вынесена в shared utility (`server/utils/auth.js`).

**Severity**: ✅ Хорошее качество, рекомендация — добавить single-flight + `server/utils/auth.js`.

### V13 CSS

#### 🟢 `styles.css` cleanup

**Сильные стороны**:
- 4 новых семантических var (`--surface-header`, `--surface-input`, `--row-hover`, `--border-strong`) с light/dark swap.
- 4 «фантомных» var promoted (`--bg-secondary`, `--surface`, `--accent-strong`, `--font-mono`).
- 416 защитных `var(--x, fallback)` удалены — pure win, ноль behavior changes.
- 12+ light-rules переведены на var().
- 26 dark-overrides удалены / схлопнуты.
- Брэйс-баланс сохранён (2919/2919).

**Слабые места**:
- Цель audit #27 «−30%» НЕ достигнута. Реальный результат **−1.3%** (4435 байт). Aудит был оптимистичным.
- 5 разрозненных «Dark theme» блоков (lines 2010, 2173, 4452, 7254) не унифицированы.
- Дубликация между «main dark» и «Dark hotfix pass» удалена частично, не до конца.

**Severity**: 🟡 Сделано меньше чем планировалось, но без регрессий. Audit #27 закрыт условно.

---

## Backward compatibility

✅ **Все 373 unit + 11 contract + 10 e2e тестов зелёные** — ничего не сломано.

✅ **API endpoints** не менялись.

✅ **localStorage keys** не менялись.

✅ **window-globals** (App, LLMAssistant, PromptsEditor, AppSettings, Onboarding, ThemeUI, RegistryView, BulkEditPanel, ActionLayer, HistoryManager, Reactive, etc.) — все на месте.

⚠️ **ARCHITECTURE.md** не обновлён — там по-прежнему `v12_0` в заголовке. Не runtime-проблема, документационный долг.

---

## Метрики «до vs после V13»

| Метрика | V12 | V13 | Δ |
|---|---|---|---|
| `app.js` | 2 148 LOC | 1 897 LOC | −251 (−11.7%) |
| `server.js` | 2 612 LOC | 1 828 LOC | −784 (−30.0%) |
| `styles.css` | 8 943 / 348 KB | 8 939 / 343 KB | −4 / −5 KB |
| Top file size (perf budget) | server.js 89 KB | app.js 91.6 KB | swap |
| Test cases | 324 unit + 11 contract + 10 e2e | 373 unit + 11 contract + 10 e2e | +49 unit |
| ESLint warnings | 215 | 207 | −8 (вынесено мёртвых var) |
| Total JS LOC | 32 800 | 33 310 | +510 (новый функционал) |

**Net effect**: код **больше**, но **лучше структурирован**. Тесты больше. Никаких регрессов.
