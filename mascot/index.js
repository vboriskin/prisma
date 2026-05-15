'use strict';
/* ============================================================
   AUDIT_ARCHITECTURE #25 — public facade dlya maskota.

   Vse 4 tochki rendera maskota proekta:
     · FAB (chat-assistant floating button)        — app/llmAssistant.js
     · chat-msg-avatar (avatar v soobshchenii chat'a) — chat/chatUIRenderer.js
     · toast-mascot (success/error toast'y)        — app/uxKit.js (cherez ObsidianMascot.welcome / showToast)
     · tour-mascot (onboarding tour)               — onboarding/onboardingUI.js
   dolzhny render'it'sya cherez render(el, opts) — eto edinaya tochka
   vhoda, kotoraya hide'it znanie o ObsidianMascot/setChatPhase ot
   vyzyvayushchey storony.

   MIGRACIYA — postepennaya:
     · Sushchestvuyushchie callsite'y NE menyayem (chat/chatUIRenderer.js,
       onboarding/onboardingUI.js, app/uxKit.js, app/obsidianMascot.js
       ostayutsya kak est').
     · Lyuboy NOVYY callsite — beret iz '../mascot/index.js'.
     · Postepenno (ratchet'om) starye callsite'y migriruyutsya na facade,
       togda i zaprosim eslint no-restricted-imports.
   ============================================================ */

export { ObsidianMascot } from '../app/obsidianMascot.js';
import { Services } from '../app/services.js';

/**
 * Render maskota na DOM-element.
 *
 * Vse vneshnie callsite'y dolzhny pol'zovat'sya etoy funkciyey vmesto
 * pryamogo vyzova `window.ObsidianMascot.hydrate(el)` /
 * `window.ObsidianMascot.setChatPhase(phase, el)`.
 *
 * @param {HTMLElement|null} el  Element-mishen' (esli null — no-op).
 * @param {Object}           [opts]
 * @param {string}           [opts.phase]  Esli zadan — vyzovet
 *   setChatPhase(phase, el) (chat-faza: idle / thinking / tool / done).
 */
export function render(el, opts = {}) {
  if (!el) return;
  const M = (typeof window !== 'undefined') ? Services.ObsidianMascot : null;
  if (!M) return;
  if (typeof M.hydrate === 'function') M.hydrate(el);
  if (opts && opts.phase && typeof M.setChatPhase === 'function') {
    M.setChatPhase(opts.phase, el);
  }
}
