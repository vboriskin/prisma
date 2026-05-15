# `window.*` → Services / EventBus migration

> AUDIT_TECH кр.13 (high) — 51 PascalCase + 17 lowercase `window.*` exports для cross-module communication. Невозможно tree-shake / типизировать / тестировать изолированно. Постепенная миграция на Services registry + EventBus.

## Архитектурное решение

Сохраняем 3 механизма с чёткими ролями, **без удаления существующего кода**:

| Mechanism | Когда использовать | Файл |
|---|---|---|
| **Прямой ES import** | Лучший вариант. Всегда когда нет circular cycle | `import { X } from '../path/X.js'` |
| **Services registry** | Когда есть circular cycle (App ↔ views ↔ chat ↔ ai) | `import { Services } from '../app/services.js'; Services.X.foo()` |
| **EventBus** | Эфемерные нотификации (state-changed, section-entered) | `import { EventBus } from '../app/eventBus.js'; EventBus.emit/on(...)` |

**`window.X` direct access** — deprecated. Сохраняется backward-compat mirror для legacy callers, но новые consumer'ы должны переходить на варианты выше.

## Карта существующих `window.*` (до миграции)

### Services / Singletons (51 PascalCase)

`ActionLayer`, `App`, `AppDataStore`, `AppSettings`, `AutoSummary`, `BlackDashboard`, `BulkEditPanel`, `BulkPlatform`, `ConfirmDialog`, `DependencyEngine`, `DependencyGraphView`, `ErrorsLog`, `EventBus`, `ExecView`, `ExplainScreen`, `FieldError`, `Flags`, `Focus`, `FocusTrap`, `HistoryManager`, `HistoryView`, `Icons`, `IntegrationsBindModal`, `IntegrationsLoadSettings`, `IntegrationsRenderModal`, `LLMAssistant`, `Migrations`, `Nav`, `NotifyCenter`, `ObsidianMascot`, `Onboarding`, `PII`, `Permissions`, `PortfolioPulse`, `PrizmaAiFrame`, `PromptsEditor`, `Reactive`, `RegistryView`, `Router`, `SQLiteStore`, и др.

### Utility helpers (17 lowercase)

`applyBulkAction`, `attachBackdropClose`, `closeModal`, `createPrismaDialog`, `ensureXLSX`, `executeAction`, `openChatDrawer`, `openIntegrationsSettings`, `scrubChatSecrets`, `showFunnyLoader`, `showToast`, `takeSnapshot`, и др.

### Browser APIs (НЕ трогаем)
`window.addEventListener`, `window.fetch`, `window.confirm`, `window.setTimeout`, `window.onerror` — стандартные браузерные API, не наш scope.

## Pattern для нового модуля

```js
// app/myView.js
import { Services } from '../app/services.js';
import { EventBus } from '../app/eventBus.js';

export const MyView = {
  render() { /* ... */ },
};

// Регистрация в Services + автоматическое window-mirror.
Services.register('MyView', MyView);

// Backward-compat для legacy callsite'ов (необязательно).
// Services.register уже зеркалит на window. Эта строка — явный signal
// что модуль ОЖИДАЕТ window.MyView mirror; удалить когда все
// callsite'ы мигрируют на Services.MyView или ES import.
if (typeof window !== 'undefined') window.MyView = MyView;
```

## Pattern для consumer'а

### Лучший вариант: ES import (если нет cycle)

```js
import { HistoryManager } from '../app/historyManager.js';
HistoryManager.checkpoint('edit');
```

### Через Services (если есть cycle)

```js
import { Services } from '../app/services.js';
Services.HistoryManager?.checkpoint('edit');     // optional chain — может быть не зарегистрирован при early bootstrap
```

### Через EventBus (для notifications)

```js
import { EventBus } from '../app/eventBus.js';
EventBus.emit('section-entered', { section: 'gantt' });
const off = EventBus.on('state-changed', () => { /* ... */ });
// ...
off(); // unsubscribe
```

### Legacy: `window.X` (deprecated)

```js
window.HistoryManager?.checkpoint('edit');   // продолжает работать, но deprecated
```

## Pilot status (2026-05-08)

**Phase 1-4 — owners registered (45 services)**:
- ✓ `app/icons.js` → `Services.register('Icons', Icons)` (window.Icons mirror сохранён)
- ✓ `app/uxKit.js` → 5 services: `ConfirmDialog`, `FocusTrap`, `ToastQueue`, `createPrismaDialog`, `attachBackdropClose`
- ✓ `app/eventBus.js` → существовал до этой миграции (AUDIT_HOLISTIC P3)
- ✓ Phase 2 (utility helpers): 23 модуля — actionLayer, aiFramePrimitive, bulkPlatform, explainScreen, exportSlideDeck, featureFlags, focusManager, historyManager, llmAssistant, migrations, nav, notifyCenter, obsidianMascot, onboarding, permissions, promptsEditor, router, toast, appDataStore, dependencyEngine, errorsLog, reactiveStore, sqliteStore
- ✓ Phase 3 (views/integrations): 10 модулей — dependencyGraph, exec, history, integrationsView (3 services), settingsView, blackDashboard, portfolioPulse, teamScanner2, techInfo, autoSummary
- ✓ Phase 4 (orchestrator): `app.js` зарегистрировал App, AppSettings, ThemeUI, RegistryView, BulkEditPanel + idempotent re-registers

**Phase 5A — consumer migration (TOP 5 services)**:
- ✓ `App` (~50 callsites in 16 files), `Toast` (~12 in 12 files), `ObsidianMascot` (~21 in 6 files), `SQLiteStore` (~22 in 2 files), `AppDataStore` (~13 in 5 files)
- ✓ ~110 callsites переведены на `Services.X?.foo()` с автоматическим импортом `import { Services } from '...'`
- ✓ Owner-файлы не тронуты (assignments `window.X = X` сохранены для backward compat)
- ✓ Mixed-access patterns (`window.Nav?.goTo || window.App?.goTo`) и comment-references оставлены
- ✓ Tests / preview boot — 0 регрессий (15 baseline failures, 0 новых)
- ✓ `Services` proxy дополнен window-fallback: `Services.X` читает `window.X` если `_registry.get('X') === undefined` — позволяет тестам инжектить mock через `window.X = mock` без `register()`

**Phase 5B — consumer migration (tier 2, 19 сервисов)**:
- ✓ LLMAssistant (9), ConfirmDialog (5), Icons (8), Nav (3), Reactive (4), ThemeUI (2), Onboarding (2), BulkEditPanel (4), ActionLayer (2), ToastQueue (2), RegistryView (3), BlackDashboard (2), Migrations (2), Focus (1), DependencyGraphView (1), PortfolioPulse (1)
- ✓ ~55 callsites в 18 файлах (`app.js`, `dataStore.js`, app/storageSettings, app/appSettings, chat/chatActions, chat/chatEngine, ai/llmClient, ai/AIPipeline, views/aiCeoView, views/aiView, views/gantt, views/exec, views/dashboard, views/registry, views/timeline, views/integrationsView, views/settingsView, onboarding/onboardingUI)
- ✓ 3 файла получили новый `import { Services }` (chatEngine, AIPipeline, timeline)
- ✓ Mixed-access (`window.Nav?.goTo || window.App?.goTo` в dashboard, `window.ChatDrawer || window.LLMAssistant` в explainScreen) — оставлено
- ✓ PromptsEditor / NotifyCenter / Permissions / Flags — без изменений (нет non-owner non-comment consumer'ов)
- ✓ Tests = 15 (baseline), preview = 45 services / 0 errors

**TODO (для следующих PR)** — приоритет от наименее рискованных:

1. **Utility helpers** (низкий риск): `app/toast.js`, `app/notifyCenter.js`, `app/promptsEditor.js`, `app/migrations.js`
2. **Views** (средний риск): `views/registry.js`, `views/employees.js`, `views/gantt.js`, `views/exec.js`, `views/dependencyGraph.js`, `views/history.js`
3. **App orchestrator** (высокий риск): `app.js` экспорт `App` + 30+ методов
4. **Stores** (высокий риск): `dataStore.js`, `appDataStore.js`, `sqliteStore.js`
5. **State / Reactive** (критический риск): `state.js`, `reactiveStore.js`

**Антипаттерны для PR-review**:

- ❌ `window.X = Y;` без соответствующего `Services.register('X', Y)`
- ❌ Новый callsite `window.X.foo()` без try/catch — заменить на `Services.X?.foo()` или ES import
- ❌ Прямое присваивание `Services.X = ...` — использовать `Services.register()` (Proxy блокирует)

## Tooling

- **`globals.d.ts`** — типизация всех существующих `window.X` (для `tsc --checkJs`). Дополнен после Stage 8 секцией для `Services` и `EventBus`.
- **`eslint-rules/no-direct-window-service.md`** — ADR с готовым custom rule для активации в `eslint.config.js` когда views/* зачищены.

## Тесты

Тестирование легко через mock-injection (раньше нужно было mock'ать `window`):

```js
import { Services } from '../app/services.js';
// В тесте:
Services.register('HistoryManager', { checkpoint: jest.fn() });
// ... код-под-тестом зовёт Services.HistoryManager.checkpoint(...) ...
```

## Roadmap

| Phase | Цель | Effort |
|---|---|---|
| **Phase 1** ✓ | Foundation: Services registry + EventBus + globals.d.ts + docs | S |
| **Phase 2** | Migrate utility helpers (10+ модулей) | M |
| **Phase 3** | Migrate views (12+ модулей) | M |
| **Phase 4** | Migrate App orchestrator + stores | L |
| **Phase 5** ✓ | Migrate consumers (window.X → Services.X) — 5A: top-5; 5B: 19 services; 5C: tail. ~250 callsites в 60 файлах. Window-mirror сохранён. | M |
| **Phase 6** ✓ (error) | ESLint rule `local/no-direct-window-service` активирован в `eslint.config.js` сразу как **error** после очистки 22 → 0 hits. Mixed-access (`window.Toast` / `window.Nav || window.App`) и existence checks (`if (window.App)`) переведены на `Services.X` — proxy fallback гарантирует identical semantics. | S |

После Phase 6 (error) ✓: `window.*` exports = только browser APIs + 0 service-global consumer-callsites → tree-shake-friendly + типизация + изолированное тестирование. Window-mirror в owner-modules сохранён для backward compat (assignments не флагуются).

## ESLint rule (Phase 6)

`eslint-rules/no-direct-window-service.js` — flags `window.<RegisteredService>` access for services in the registered set.

- **Mode**: `error` (active). Любой новый `window.<RegisteredService>` callsite ломает CI.
- **SERVICE_NAMES** — keep in sync with `Services.register(...)` callsites + this doc's «Services / Singletons» section. Currently 45 names.
- **BROWSER_APIS** — whitelist of standard `window.*` (addEventListener, fetch, location, etc.) — never flagged.
- **Allowed**: `window.X = ...` (assignment / owner registration), `typeof window.X` (existence check), `delete window.X` (cleanup), `import { X } from '...'` (preferred), `Services.X?.method()` (registry).

### Hits после Phase 6 promotion: **0**

22 ранее «intentional» hits переведены на `Services.X` (idential semantics через proxy fallback):

| File | Service(s) | Изначальный pattern | После Phase 6 |
|---|---|---|---|
| `dataStore.js` (×10) | Toast | `window.Toast?.X || window.showToast?.()` | `Services.Toast?.X || window.showToast?.()` |
| `views/dashboard.js` (×8) | Nav, App | `(window.Nav?.goTo || window.App?.goTo)` | `(Services.Nav?.goTo || Services.App?.goTo)` |
| `app.js` (×2 Toast) | Toast | `window.Toast?.warning?.() || window.showToast?.()` | `Services.Toast?.warning?.() || window.showToast?.()` |
| `app.js` (×2 App) | App | `if (window.App)`, `!window.App` | `if (Services.App)`, `!Services.App` |

`window.showToast` — lowercase utility, не в SERVICE_NAMES → не флагуется (legacy V11 fallback контракт сохранён).
