// @ts-check
'use strict';
/* ============================================================
   RISK ENGINE — v8_0 ES module
   --
   computeFlags: pure rules → row.riskFlags (RiskFlag[])
   computeRiskScore: weighted score 0..100 → row.riskScore
   computeAll: walk state.rows
   ============================================================ */

import { state } from './state.js';

/** @typedef {import('./types').Row}      Row */
/** @typedef {import('./types').RiskFlag} RiskFlag */

export const RiskEngine = {
  /** @param {Row} row */
  computeFlags(row) {
    /** @type {RiskFlag[]} */
    const flags = [];
    const inAny = row.hasRelease120||row.hasRelease121||row.hasRelease122||row.hasOvertime;
    if (row.scopeStatus==='Требует подтверждения' && inAny) flags.push('CONFIRMATION_IN_RELEASE');
    if (row.scopeStatus==='Да' && row.isUnassigned) flags.push('IN_SCOPE_WITHOUT_RELEASE');
    if (row.blockingDependency && (row.hasRelease120||row.hasRelease121)) flags.push('BLOCKING_NEAR_RELEASE');
    row.riskFlags = flags;
  },
  /** @param {Row} row @returns {number} */
  computeRiskScore(row) {
    let score = 0;
    if (row.blockingDependency) score += 30;
    if ((row.riskFlags||[]).includes('IN_SCOPE_WITHOUT_RELEASE')) score += 25;
    if ((row.riskFlags||[]).includes('CONFIRMATION_IN_RELEASE')) score += 20;
    if (row.hasRelease120) score += 15;
    if (row.scopeStatus === 'Требует подтверждения') score += 10;
    row.riskScore = Math.min(100, score);
    return row.riskScore;
  },
  computeAll() {
    state.rows.forEach(r => {
      RiskEngine.computeFlags(r);
      RiskEngine.computeRiskScore(r);
    });
  },
};
