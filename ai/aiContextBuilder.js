'use strict';
/* ============================================================
   AI CONTEXT BUILDER — v10_0
   Builds a compact JSON payload for LLM calls.
   Target size: < 60 KB. Never sends full row dataset.
   ============================================================ */

import { state }                        from '../state.js';
// AUDIT_ARCHITECTURE #15 — computeHealthScore zhivet teper' v
// metricsEngine; eto zakryvaet edinstvennyy narushennyy border
// `ai/* → chat/*`. Funkciya — chistaya metrika, ne UI.
import { computeProgress, computeLoad, computeHealthScore } from '../metricsEngine.js';

const pct = (n, d) => d ? Math.round(n / d * 100) : 0;

/**
 * Build a compact context for LLM.
 * @param {Array}  rows    - state.rows
 * @param {object} opts
 *   opts.maxRows   — max task rows to include (default 40)
 *   opts.blockId   — which AI block is calling (passed through for tracing)
 */
export function buildAIContext(rows, opts = {}) {
  const { maxRows = 40, blockId = null } = opts;
  if (!rows || !rows.length) return { empty: true, blockId };

  const active      = rows.filter(r => !r.isDone);
  const done        = rows.filter(r => r.isDone);
  const blockers    = active.filter(r => r.blockingDependency);
  const risky       = active.filter(r => (r.riskFlags||[]).length).sort((a,b)=>(b.riskScore||0)-(a.riskScore||0));
  const noRelease   = active.filter(r => r.isUnassigned && r.scopeStatus === 'Да');
  const unconfirmed = active.filter(r => r.scopeStatus === 'Требует подтверждения');

  const progress = computeProgress(rows);
  const load     = computeLoad(active);
  const health   = computeHealthScore(rows);

  // Minimal row shape for LLM context
  const slim = r => ({
    id:       r.id,
    epic:     (r.epic || '').slice(0, 60),
    task:     (r.tasks || '').slice(0, 80),
    team:     r.team || '',
    release:  [r.hasRelease120&&'1.20', r.hasRelease121&&'1.21', r.hasRelease122&&'1.22', r.hasOvertime&&'OT'].filter(Boolean).join('/') || 'none',
    scope:    r.scopeStatus || '',
    done:     r.isDone,
    blocked:  !!r.blockingDependency,
    risks:    r.riskFlags || [],
    riskScore:r.riskScore  || 0,
    assignee: (r.assignee || '').slice(0, 30),
  });

  // Top rows by riskScore — these are most useful for LLM
  const topRows = [...active]
    .sort((a, b) => (b.riskScore||0) - (a.riskScore||0))
    .slice(0, maxRows)
    .map(slim);

  return {
    blockId,
    summary: {
      total:       rows.length,
      done:        done.length,
      active:      active.length,
      donePct:     pct(done.length, rows.length),
      blockers:    blockers.length,
      risky:       risky.length,
      noRelease:   noRelease.length,
      unconfirmed: unconfirmed.length,
      health,
    },
    releases: {
      r120:     progress['120'] || { total:0, done:0, pct:0 },
      r121:     progress['121'] || { total:0, done:0, pct:0 },
      r122:     progress['122'] || { total:0, done:0, pct:0 },
      overtime: progress['ot']  || { total:0, done:0, pct:0 },
    },
    topBlockers:    blockers.slice(0,  8).map(slim),
    topRiskyRows:   risky.slice(0,     8).map(slim),
    topUnassigned:  noRelease.slice(0, 6).map(slim),
    topUnconfirmed: unconfirmed.slice(0,6).map(slim),
    topRows,
    load: Object.entries(load)
      .sort((a,b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([name, v]) => ({ name, ...v })),
    deps: Object.entries(state.epicDeps || {}).slice(0, 20),
  };
}

/** Serialise context to a string, capped at maxBytes. */
export function serializeContext(ctx, maxBytes = 55000) {
  const raw = JSON.stringify(ctx);
  if (raw.length <= maxBytes) return raw;
  // Trim topRows until it fits
  const copy = { ...ctx, topRows: (ctx.topRows || []).slice(0, 15) };
  const trimmed = JSON.stringify(copy);
  return trimmed.length <= maxBytes ? trimmed : trimmed.slice(0, maxBytes);
}
