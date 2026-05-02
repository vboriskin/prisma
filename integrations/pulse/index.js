'use strict';
/* ============================================================
   PULSE PIPELINE FACADE  (V19 D3, originally deferred from V18 P10)

   Single import point для всего Portfolio Pulse — оркестратор,
   API, model, renderer, insights, metrics, backlog, utils.
   Файлы остаются на своих местах в integrations/portfolioPulse*.js
   (так что existing direct imports НЕ ломаются); этот facade —
   organizational layer.

   Use:
     import { PortfolioPulse, analysePulse, fetchPulseData } from './pulse';
     // или
     import * as Pulse from './pulse';
     Pulse.PortfolioPulse.render(container);
     const model = Pulse.analysePulse(raw);

   Audit context:
     V18 P10 (server-decomposition) audit-md mention'ил «Pulse pipeline
     5-файловый объединить в pulse/index.js фасад». В V18 P10 не
     успели — fixed in V19 D3. Closes Phase 3 audit Bullet B3.

   Do NOT import from this facade WITHIN pulse/* internal modules
   (would create circular reference). Internal imports — direct paths.
   ============================================================ */

// ──────── Orchestrator (главный entry point) ────────────────
export {
  PortfolioPulse,
  __testing as __pulseOrchestratorTesting,
} from '../portfolioPulse.js';

// ──────── HTTP API layer ────────────────────────────────────
export {
  fetchPulseData,
  fetchEmployeeDetail,
} from '../portfolioPulseApi.js';

// ──────── Data model + analysis ─────────────────────────────
export {
  analysePulse,
  filterModelByPk,
} from '../portfolioPulseModel.js';

// ──────── Insights / metrics / backlog ──────────────────────
export {
  buildInsights,
  filterInsightsByPk,
} from '../portfolioPulseInsights.js';

export {
  buildMetrics,
  renderDonut,
  renderBars,
  renderAgeHistogram,
} from '../portfolioPulseMetrics.js';

export {
  buildBacklogModel,
  buildBacklogInsights,
} from '../portfolioPulseBacklog.js';

// ──────── Renderer (40+ функций, big surface) ───────────────
// Сюда попадает всё что используется outside pulse-internals.
export {
  setRenderContext,
  renderTopHeader,
  renderMainTabs,
  renderErrorBanner,
  renderTeamsTab,
  renderSummaryTab,
  renderSprintsTab,
  renderInsightsTab,
  renderMetricsTab,
  renderBacklogTab,
  renderSkeleton,
  renderEmpty,
  renderError,
  renderHowModal,
  renderParticipantCard,
  renderUnassignedBlock,
  renderIssueRow,
  renderGroupedByType,
  renderTypeGroup,
} from '../portfolioPulseRenderer.js';

// ──────── Utilities (используются и Scanner 2.0) ────────────
export {
  parseProjectKeys,
  slimIssue,
  typeBucket,
  typeBucketLabel,
  statusBucket,
  isTerminalStatus,
  isInitialStatus,
  isWipActive,
  zephyrKind,
  groupByBucket,
  userKey,
  userNameKey,
  userLabel,
  userAvatar,
  ts,
  daysAgo,
  hoursAgo,
  todayStart,
  yesterdayStart,
  twoDaysAgoStart,
  formatDuration,
  formatHrs,
  pct,
  esc,
  trunc,
} from '../portfolioPulseUtils.js';
