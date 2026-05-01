'use strict';
/* ============================================================
   ONBOARDING STATE — v11_0
   localStorage key: q2_onboarding_v1
   ============================================================ */

export const OB_KEY = 'q2_onboarding_v1';

/** @typedef {'demo'|'setup'|null} OnboardingMode */

/**
 * Read current onboarding state from localStorage.
 * @returns {{ completed: boolean, mode: OnboardingMode, step: number, lastDatasetType: string|null }}
 */
export function getOnboardingState() {
  try {
    const raw = localStorage.getItem(OB_KEY);
    if (!raw) return { completed: false, mode: null, step: 0, lastDatasetType: null };
    return JSON.parse(raw);
  } catch {
    return { completed: false, mode: null, step: 0, lastDatasetType: null };
  }
}

/** Returns true if the user has never completed onboarding. */
export function isFirstRun() {
  return getOnboardingState().completed !== true;
}

/** Returns true if the app is currently in demo mode. */
export function isDemoMode() {
  return getOnboardingState().mode === 'demo';
}

/**
 * Start onboarding in the given mode.
 * @param {'demo'|'setup'} mode
 */
export function startOnboarding(mode) {
  const cur = getOnboardingState();
  _save({ ...cur, mode, step: 0 });
}

/** Mark onboarding as fully completed. */
export function completeOnboarding() {
  const cur = getOnboardingState();
  _save({ ...cur, completed: true });
}

/** Set the current micro-tour step. */
export function setOnboardingStep(step) {
  const cur = getOnboardingState();
  _save({ ...cur, step });
}

/** Record the type of last loaded dataset ('demo' | 'user'). */
export function setLastDatasetType(type) {
  const cur = getOnboardingState();
  _save({ ...cur, lastDatasetType: type });
}

/** Switch from demo mode to user mode (clears demo flag). */
export function exitDemoMode() {
  const cur = getOnboardingState();
  _save({ ...cur, mode: 'setup', lastDatasetType: 'user' });
}

/** Switch back to demo mode. */
export function enterDemoMode() {
  const cur = getOnboardingState();
  _save({ ...cur, mode: 'demo', lastDatasetType: 'demo' });
}

/** Full reset — shows welcome screen on next load. */
export function resetOnboarding() {
  localStorage.removeItem(OB_KEY);
}

/* ---- private ---- */
function _save(obj) {
  try { localStorage.setItem(OB_KEY, JSON.stringify(obj)); } catch { /* quota */ }
}
