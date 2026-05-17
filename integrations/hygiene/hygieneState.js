'use strict';
/* ============================================================
   integrations/hygiene/hygieneState.js — V22+ extension (2026-05-17)

   In-memory state + localStorage persist для подвкладки «Гигиена»:
     · activeTeam: '__all__' | <projectKey>
     · disabledRules: [ruleId, …]
     · thresholdOverrides: { ruleField: value }

   Engine `jiraHygiene.runHygieneRules` уже принимает `opts.disabledRules`
   и `opts.thresholds` — UI просто прокидывает их.

   localStorage key: q2_hygiene_state_v1
   ============================================================ */

const LS_KEY = 'q2_hygiene_state_v1';

function _emptyState() {
  return {
    activeTeam: '__all__',     // '__all__' | <projectKey> (e.g. 'SMEAM')
    disabledRules: [],
    thresholdOverrides: {},
  };
}

class HygieneState {
  constructor() {
    this._loaded = false;
    this._state = _emptyState();
  }
  _ensureLoaded() {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(LS_KEY) : null;
      if (raw) {
        const stored = JSON.parse(raw);
        if (stored && typeof stored === 'object') {
          this._state = { ..._emptyState(), ...stored };
          if (!Array.isArray(this._state.disabledRules)) this._state.disabledRules = [];
          if (!this._state.thresholdOverrides || typeof this._state.thresholdOverrides !== 'object') {
            this._state.thresholdOverrides = {};
          }
        }
      }
    } catch (_) { /* corrupt — defaults */ }
  }
  _save() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(LS_KEY, JSON.stringify(this._state));
    } catch (_) { /* quota / off — silent */ }
  }

  /* ── accessors ──────────────────────────────────────────── */
  get state() { this._ensureLoaded(); return this._state; }
  get activeTeam() { return this.state.activeTeam; }
  get disabledRules() { return this.state.disabledRules.slice(); }
  get thresholdOverrides() { return { ...this.state.thresholdOverrides }; }

  /* ── mutations ──────────────────────────────────────────── */
  setActiveTeam(v) { this.state.activeTeam = String(v || '__all__'); this._save(); }
  toggleRule(id) {
    this._ensureLoaded();
    const idx = this._state.disabledRules.indexOf(id);
    if (idx >= 0) this._state.disabledRules.splice(idx, 1);
    else this._state.disabledRules.push(id);
    this._save();
  }
  isRuleDisabled(id) { return this.state.disabledRules.includes(id); }
  resetRules() { this._state.disabledRules = []; this._save(); }
  setThreshold(field, value) {
    this._ensureLoaded();
    this._state.thresholdOverrides[field] = value;
    this._save();
  }
  resetThresholds() { this._state.thresholdOverrides = {}; this._save(); }
}

export const hygieneState = new HygieneState();
