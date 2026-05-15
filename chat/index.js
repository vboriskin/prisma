'use strict';
/* ============================================================
   AUDIT_ARCHITECTURE #16 — public facade dlya chat-modulei.

   Cel': vse vneshnie callsite'y (sejchas — `app/llmAssistant.js`,
   `app/promptsEditor.js`) dolzhny import'it' tol'ko otsyuda, a ne
   napryamuyu iz chat/chatEngine.js / chat/chatActions.js i pr.

   MIGRACIYA — postepennaya:
     · Esli zatochil novyy callsite snaruzhi `chat/` — beri import otsyuda.
     · Sushchestvuyushchie pryamye importy (`from '../chat/chatEngine.js'`)
       NE perepisyvayutsya massovo. Chat-modulu sami mezhdu soboy mogut
       hodit' napryamuyu (eto vnutrennee delo modulya).

   SLEDSTVIE: kogda vse vneshnie tochki perevedeny — mozhno postavit'
   eslint-rule no-restricted-imports na chat/* iz `app/*` i `views/*`.
   ============================================================ */

// chatEngine — core LLM-pipeline (process / parseLLMResponse)
export {
  buildLLMPrompt,
  buildPromptParts,
  process,
  parseLLMResponse,
} from './chatEngine.js';

// chatActions — apply-batch / matchRowsByFilter / executeAction
export {
  matchRowsByFilter,
  buildBatchPreview,
  applyPendingBatch,
  executeAction,
  bindActionClicks,
} from './chatActions.js';

// chatUIRenderer — DOM-rendering struct/user/thinking/error messages
export {
  renderStructuredResponse,
  renderUserMessage,
  renderThinking,
  renderError,
  parseStructuredFromLLM,
} from './chatUIRenderer.js';

// chatTemplates — quick-prompts templates
export {
  getQuickPrompts,
  renderQuickPromptsHTML,
} from './chatTemplates.js';

// chatAlerts — alert bar over chat panel + computeHealthScore re-export
// (computeHealthScore zhivet v metricsEngine.js, AUDIT_ARCHITECTURE #15)
export {
  buildAlerts,
  renderAlertBar,
  refreshAlerts,
  saveAlertBaseline,
  computeHealthScore,
} from './chatAlerts.js';

// chatPrompts — prompt overrides storage + categories
export {
  PROMPTS_STORAGE_KEY,
  STRUCTURED_SUFFIX,
  ANTI_INJECT,
  FEW_SHOT_EXPLAIN,
  FEW_SHOT_ACTION,
  FEW_SHOT_ANALYSIS,
  CATEGORIES,
  getDefaultPrompt,
  getAllPrompts,
  savePromptOverrides,
  resetPromptOverride,
  getPrompt,
  PROMPTS,
} from './chatPrompts.js';
