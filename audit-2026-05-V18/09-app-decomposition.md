# V18.1 P9 — app.js decomposition

**Дата:** 2026-05-01
**Tests:** 534 unit / 11 contract / 0 fail (без регрессий)
**Effort:** M

## Метрика

```
До:  app.js 2613 LOC
После app.js 1909 LOC  (-704 LOC, -27%)
```

3 новых модуля в `app/`:

| Файл | LOC | Что |
|---|---|---|
| `app/uiToggles.js` | 113 | SimMode + SidebarUI + ThemeUI (3 isolated UI clusters) |
| `app/bulkEditPanel.js` | 113 | Bulk-edit panel (per-row checkboxes + bulk actions) |
| `app/appSettings.js` | 478 | AppSettings + NAV_SECTIONS + BLOCKS_PER_SECTION + APP_SETTINGS_KEY + TOPBAR_ITEMS |

## Что вынесено

### 1. UI toggles (uiToggles.js, 113 LOC)

Три маленьких изолированных модуля:
- **SimMode** (~24 LOC) — simulation-mode toggle (V17 P10 F4 boot-restore)
- **SidebarUI** (~22 LOC) — sidebar collapse
- **ThemeUI** (~33 LOC) — light/dark theme + icon swap

Дизайн: zero coupling между ними; `window.showToast` через global lookup (`if (window.showToast)`) чтобы избежать circular import. `HistoryLog.settings` — direct import (cycle-safe).

### 2. BulkEditPanel (bulkEditPanel.js, 113 LOC)

Direct port из app.js (lines 291-384). Зависимости через imports:
- `state` (читает `state.bulkSelected` set)
- `FilterEngine.getFiltered()` для intersect-with-visible (V17 P9 fix)
- `applyBulkAction` из dataStore
- `window.showToast` через global

Idempotent guard `_escBound` сохранён.

### 3. AppSettings + 4 константы (appSettings.js, 478 LOC)

Самый большой кластер. Settings modal с 5 вкладками:
- Interface (sortable nav-sections + toggleable blocks + topbar order)
- Storage (через `StorageSettings.render` injection)
- LLM (inlined из legacy llm-settings-modal)
- Integrations (lazy-render через `window.IntegrationsRenderModal`)
- Debug

Зависимости:
- **Direct import:** Utils, state, Storage, notify, HistoryLog, AppDataStore, StorageSettings
- **Через window:** LLMAssistant, IntegrationsLoadSettings/RenderModal/BindModal, App.renderActive, closeModal, showToast (defined в app.js → loaded ПОСЛЕ модуля; lazy-call внутри callbacks безопасен)
- 4 константы (NAV_SECTIONS / BLOCKS_PER_SECTION / APP_SETTINGS_KEY / TOPBAR_ITEMS) re-exported через `export const` — используются из app.js в Nav-handlers + Onboarding insights.

## Что НЕ вынесено

Оставлено в app.js (для будущих P9.x итераций):
- **App** orchestrator (~600 LOC, init+bind+refresh+nav, central singleton)
- **FiltersUI** (~110 LOC, тесно связан с views/registry FilterEngine)
- **bindExport / bindImports** функции (~250 LOC, file IO + CSV/XLSX/JSON parsing)
- Toast / Funny-loader / closeModal helpers (~80 LOC, used by everywhere через window)
- Reactive subscribe + `_reactiveBooted` guard (orchestration core)

Эти места плотно связаны и ломать их в одной итерации рисково. Каждое заслуживает отдельного фокуса.

## Backward compatibility

Все вынесенные модули **re-exported на `window.*`** в существующем block в app.js:
```js
window.AppSettings    = AppSettings;
window.BulkEditPanel  = BulkEditPanel;
window.ThemeUI        = ThemeUI;
// ...
```

Не сломали внешние ссылки (chat / integrations / views читают `window.AppSettings.load()` etc).

## Тесты

```
534 unit / 11 contract / 0 fail
```

Без регрессий. Smoke-test (server boot + `/health`) проходит — frontend модули загружаются корректно.

## Performance budget

`scripts/perfBudget.js` — `app.js` < 3000 LOC threshold. Сейчас 1909, запас ~1100 LOC (уютнее работать).

## Что закрыто из аудита

Phase 3 audit Bullet **A1** «`app.js` 2613 LOC — продолжать decomposition в `app/*`. Цель: app.js < 1500 LOC».
- ✅ Сделано до 1909 LOC (-704)
- ❌ Цель < 1500 не достигнута. App orchestrator + FiltersUI + bindExport остались — это естественные кандидаты для P9.1 / V18.2.

## Резюме

```
✓ app/uiToggles.js     (113 LOC) — SimMode + SidebarUI + ThemeUI
✓ app/bulkEditPanel.js (113 LOC) — Bulk-edit panel
✓ app/appSettings.js   (478 LOC) — AppSettings + 4 constants
✓ app.js: 2613 → 1909 LOC (-27%)
✓ Tests: 534 / 11 / 0
✓ window.* re-exports for backward-compat preserved
```

V18.1 P9 закрыт частично (большая декомпозиция сделана, цель < 1500 LOC отложена). Дальше — P10 (server.js decomposition).
