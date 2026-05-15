# Renderer Split — Deferred to Dedicated Session

**Status**: Deferred (2026-05-11 ночная сессия — risk не оправдан)
**Effort estimate**: 3-5 часов внимательной работы + 2-3 часа тестирования
**Priority**: High (unblocks renderer-touching work)

## Текущее состояние

`integrations/teamScanner2Renderer.js` = **5961 LOC** — god-module.

## Целевая декомпозиция

| Module | LOC | Содержит |
|---|---|---|
| `teamScanner2RendererCommon.js` | ~300 | esc, fmtDuration, fmtHours, _statusChip, plural-helpers, safeUrl |
| `teamScanner2RendererHero.js` | ~800 | renderTopBar, renderTeamGlance, renderTeamSwitcher, renderVelocityComparison, renderTeamHealthHero, renderDailyBrief, renderActionQueue, _composeRoomStoryLine |
| `teamScanner2RendererPanel.js` | ~750 | renderEmployeeDetailPanel, renderPersonNarrative, renderPersonMetricsPanel, maskEmail, renderPanelHeader, renderCounters, renderHeatmap72x4, renderFilters, renderBlockersShelf, renderEventsFeed, renderEventLine, renderSrcBadge, kindLabel, renderSwitchesNote |
| `teamScanner2RendererInsights.js` | ~1400 | renderSleepingDataInsights (780 LOC alone), renderStalePrs, renderEstimateAccuracy, renderOnboardingRamp, renderSoloAuthorFiles, renderScopeChurnDetail, renderZombieIssues, renderSprintHealth, renderHistoryTrendRow, renderTile_componentLoad, _renderDependencySankey |
| `teamScanner2RendererDiag.js` | ~1100 | renderDiagnosticModal, renderDiagnosticDisclaimer, _diagSection*, renderProbeResults, renderIdentityResolvePreview, renderSensitivityResults, renderCrvDrilldownModal, renderAnomalyMiniChart, renderVelocityCompareModal, renderHowCalculatedModal |
| `teamScanner2RendererPersonRows.js` | ~600 | renderPersonRows, renderRow, classifyPerson, emptyDayLanguage, bucketByHour, dotStrip, renderSparkline, renderDelta |
| `teamScanner2Renderer.js` (facade) | ~400 | _renderScannerTabBar, registerScannerSubTab, setRenderContext, _printScanner, renderEmpty, renderError, renderSkeleton, renderDetailStub, renderMultiTeamView, renderTeamConfigModal, flashAnchorTarget, re-exports |

## Зачем split

1. **DX** — easier navigation (5961 LOC god-module → 400-1400 LOC модули)
2. **Test isolation** — domain-specific tests per file
3. **Hot-path** — изменения в одном домене не затрагивают другие
4. **Code review** — диффы 50 LOC вместо 5000

## Последовательность (рекомендация)

1. **Phase 1**: extract `teamScanner2RendererCommon.js` (utilities). Минимальный риск.
2. **Phase 2**: extract `teamScanner2RendererDiag.js` (clean boundary, ~1100 LOC). Тестировать diagnostic modal flow end-to-end.
3. **Phase 3**: extract `teamScanner2RendererPanel.js` (heavily cross-referenced — careful).
4. **Phase 4**: extract `teamScanner2RendererInsights.js` (renderSleepingDataInsights 780 LOC inside — самый большой single function).
5. **Phase 5**: extract `teamScanner2RendererHero.js`.
6. **Phase 6**: extract `teamScanner2RendererPersonRows.js`.

Каждая phase = own commit, own test run.

## Зависимости которые осложнят split

| Function | Cross-references |
|---|---|
| `_statusChip` | Used in 8+ places across all domains — extract to Common first |
| `Icons.get` | External, no issue |
| `renderSleepingDataInsights` (780 LOC) | Контейнер для kebab-menu insights — может потребоваться отдельный split внутри Insights-module |
| `state` import | Used for `state.employees` etc — keep external |
| `setRenderContext`/`getScannerTab` | Module-level state — нужен careful handling, может через `Common` |

## Контракт сохранения публичного API

Все existing imports должны продолжать работать:

```js
import { renderTopBar, renderTeamGlance, ... } from './teamScanner2Renderer.js';
```

Facade file (`teamScanner2Renderer.js`) re-exports всё из sub-modules.

## Acceptance criteria

- ✅ Все existing imports works (back-compat)
- ✅ `npm test` — 48/48 renderer tests pass
- ✅ Manual smoke test: open Scanner, switch teams, open Diagnostic, all renders OK
- ✅ Each new file < 1500 LOC
- ✅ No circular imports

## Что НЕ делать

- ❌ Не менять public API (function signatures) во время split
- ❌ Не оптимизировать функции в процессе extract'а
- ❌ Не пытаться split за одну сессию (тренируемся: Phase 1+2 за вечер, остальное — за неделю)
