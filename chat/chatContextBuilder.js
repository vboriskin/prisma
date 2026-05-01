'use strict';
/* ============================================================
   CHAT CONTEXT BUILDER — v10_0
   Builds focused context objects for each intent type.
   ============================================================ */

import { state } from '../state.js';
import { INTENTS } from './chatIntentParser.js';

/**
 * Safely get filtered rows from FilterEngine.
 */
function getFiltered() {
  try { return window.FilterEngine?.getFiltered() || state.rows; } catch(_) { return state.rows; }
}

/**
 * Build summary statistics from a row array.
 */
function buildStats(rows) {
  const total     = rows.length;
  const done      = rows.filter(r => r.isDone).length;
  const blockers  = rows.filter(r => r.blockingDependency && !r.isDone).length;
  const risky     = rows.filter(r => (r.riskFlags || []).length > 0 && !r.isDone).length;
  const inScope   = rows.filter(r => r.scopeStatus === 'Да').length;
  const unassigned = rows.filter(r => r.isUnassigned && !r.isDone).length;
  const r120 = rows.filter(r => r.hasRelease120).length;
  const r121 = rows.filter(r => r.hasRelease121).length;
  const r122 = rows.filter(r => r.hasRelease122).length;
  const overtime = rows.filter(r => r.hasOvertime).length;
  return { total, done, blockers, risky, inScope, unassigned, r120, r121, r122, overtime,
           donePct: total ? Math.round(done / total * 100) : 0 };
}

/**
 * Build per-team breakdown.
 */
function buildTeamBreakdown(rows) {
  const map = {};
  rows.forEach(r => {
    const t = r.team || '—';
    if (!map[t]) map[t] = { team: t, total: 0, done: 0, blockers: 0, risky: 0, r120: 0, r121: 0, r122: 0 };
    map[t].total++;
    if (r.isDone) map[t].done++;
    if (r.blockingDependency && !r.isDone) map[t].blockers++;
    if ((r.riskFlags || []).length && !r.isDone) map[t].risky++;
    if (r.hasRelease120) map[t].r120++;
    if (r.hasRelease121) map[t].r121++;
    if (r.hasRelease122) map[t].r122++;
  });
  return Object.values(map).sort((a, b) => b.total - a.total);
}

/**
 * Strip a row to lightweight fields for LLM.
 *
 * V15 (audit#2, AI dev Critical 2): the free-form `comment` field used to
 * be passed verbatim. That's a PII / leak vector — users sometimes write
 * names of people, ticket-bodies, internal notes, even credentials in
 * comments. We now redact comments to:
 *   · short summary (≤120 chars after a stripper pass)
 *   · `<no comment>` if empty
 *   · `<redacted>` if comment matches a sensitive pattern (token-like
 *     long base64 / Bearer prefix / "пароль:" etc.)
 * This trades resolution for safety — the LLM can still reason about
 * "task has notes" vs "task is empty", but doesn't see private prose.
 */
function _redactComment(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // Sensitive markers — if found, drop the comment entirely.
  if (/(?:bearer|token|password|пароль|секрет|secret|apikey|api[_\s-]?key)[:\s=]/i.test(s)) return '<redacted>';
  if (/[A-Za-z0-9_\-]{40,}/.test(s)) return '<redacted>';     // long opaque-looking token
  // Otherwise, truncate to 120 chars and strip newlines.
  return s.replace(/\s+/g, ' ').slice(0, 120);
}
function pickRow(r) {
  return {
    id: r.id, team: r.team, epic: r.epic, tasks: r.tasks,
    scopeStatus: r.scopeStatus, assignee: r.assignee, isDone: r.isDone,
    blockingDependency: r.blockingDependency, riskFlags: r.riskFlags || [],
    release120Types: r.release120Types, release121Types: r.release121Types,
    release122Types: r.release122Types, overtimeTypes: r.overtimeTypes,
    workPeriodStart: r.workPeriodStart, workPeriodEnd: r.workPeriodEnd,
    comment: _redactComment(r.comment),
  };
}

/* ── Per-intent context builders ─────────────────────────── */

export function buildExecutiveSummaryContext() {
  const rows = state.rows;
  const stats = buildStats(rows);
  const teams = buildTeamBreakdown(rows);
  const topBlockers = rows.filter(r => r.blockingDependency && !r.isDone).slice(0, 10).map(pickRow);
  const topRisky    = rows.filter(r => (r.riskFlags||[]).length && !r.isDone).slice(0, 10).map(pickRow);
  return { intent: 'executive_summary', stats, teams, topBlockers, topRisky, activeTab: state.activeSection };
}

export function buildReleaseOverviewContext(release) {
  const allRows = state.rows;
  const fieldMap = { r120: 'hasRelease120', r121: 'hasRelease121', r122: 'hasRelease122', overtime: 'hasOvertime', backlog: 'isUnassigned' };
  const field = release ? fieldMap[release] : null;
  const relRows = field ? allRows.filter(r => r[field]) : allRows;
  const stats = buildStats(relRows);
  const teams = buildTeamBreakdown(relRows);
  const blockers = relRows.filter(r => r.blockingDependency && !r.isDone).slice(0, 15).map(pickRow);
  return { intent: 'release_overview', release: release || 'all', stats, teams, blockers,
           rows: relRows.slice(0, 40).map(pickRow) };
}

export function buildTeamOverviewContext(teamName) {
  const allRows = state.rows;
  const teams = [...new Set(allRows.map(r => r.team).filter(Boolean))].sort();
  const filtered = teamName
    ? allRows.filter(r => r.team && r.team.toLowerCase().includes(teamName.toLowerCase()))
    : allRows;
  const stats = buildStats(filtered);
  const breakdown = buildTeamBreakdown(allRows);
  return { intent: 'team_overview', requestedTeam: teamName || null, availableTeams: teams,
           stats, teamBreakdown: breakdown, rows: filtered.slice(0, 30).map(pickRow) };
}

export function buildRisksContext() {
  const rows = state.rows;
  const blockers = rows.filter(r => r.blockingDependency && !r.isDone).slice(0, 20).map(pickRow);
  const risky    = rows.filter(r => (r.riskFlags||[]).length && !r.isDone).slice(0, 20).map(pickRow);
  const riskTypes = {};
  rows.forEach(r => (r.riskFlags||[]).forEach(f => { riskTypes[f] = (riskTypes[f]||0)+1; }));
  const stats = buildStats(rows);
  return { intent: 'what_risks', stats, blockers, risky, riskTypes };
}

export function buildOverloadContext() {
  const rows = state.rows;
  const load = {};
  rows.forEach(r => {
    if (r.isDone) return;
    (r.assignee || '').split(/[|,]/).map(s => s.trim()).filter(Boolean).forEach(name => {
      if (!load[name]) load[name] = { name, total: 0, r120: 0, r121: 0, r122: 0, ot: 0, blockers: 0 };
      load[name].total++;
      if (r.hasRelease120) load[name].r120++;
      if (r.hasRelease121) load[name].r121++;
      if (r.hasRelease122) load[name].r122++;
      if (r.hasOvertime)   load[name].ot++;
      if (r.blockingDependency) load[name].blockers++;
    });
  });
  const assignees = Object.values(load).sort((a, b) => b.total - a.total);
  const teams = buildTeamBreakdown(rows);
  return { intent: 'overload', assignees: assignees.slice(0, 20), teams };
}

export function buildMeetingPrepContext(meetingType) {
  const rows = state.rows;
  const stats = buildStats(rows);
  const blockers  = rows.filter(r => r.blockingDependency && !r.isDone).slice(0, 10).map(pickRow);
  const risky     = rows.filter(r => (r.riskFlags||[]).length && !r.isDone).slice(0, 10).map(pickRow);
  const recentDone = rows.filter(r => r.isDone).slice(-10).map(pickRow);
  const teams = buildTeamBreakdown(rows);
  return { intent: 'meeting_prep', meetingType: meetingType || 'meeting', stats, teams, blockers, risky, recentDone };
}

export function buildReleaseNotesContext(release) {
  const allRows = state.rows;
  const fieldMap = { r120: 'hasRelease120', r121: 'hasRelease121', r122: 'hasRelease122' };
  const field = release ? fieldMap[release] : null;
  const relRows = field ? allRows.filter(r => r[field]) : allRows;
  const done   = relRows.filter(r => r.isDone);
  const active = relRows.filter(r => !r.isDone);
  return { intent: 'release_notes', release: release || 'all',
           done: done.slice(0, 50).map(pickRow), active: active.slice(0, 30).map(pickRow) };
}

export function buildAskPlanContext() {
  const rows = state.rows;
  const stats = buildStats(rows);
  const blockers = rows.filter(r => r.blockingDependency && !r.isDone).slice(0, 10).map(pickRow);
  const risky    = rows.filter(r => (r.riskFlags||[]).length && !r.isDone).slice(0, 10).map(pickRow);
  const unassigned = rows.filter(r => r.isUnassigned && !r.isDone && r.scopeStatus === 'Да').slice(0, 10).map(pickRow);
  const teams = buildTeamBreakdown(rows);
  return { intent: 'ask_plan', stats, teams, blockers, risky, unassigned };
}

export function buildReviewModeContext(role) {
  const rows = state.rows;
  const stats = buildStats(rows);
  const teams = buildTeamBreakdown(rows);
  const blockers = rows.filter(r => r.blockingDependency && !r.isDone).slice(0, 15).map(pickRow);
  const risky    = rows.filter(r => (r.riskFlags||[]).length && !r.isDone).slice(0, 15).map(pickRow);
  return { intent: 'review_mode', role: role || 'ceo', stats, teams, blockers, risky };
}

export function buildFilterTasksContext(params) {
  const visible = getFiltered();
  return { intent: 'filter_tasks', currentFilters: { ...state.filters }, appliedParams: params,
           visibleCount: visible.length, totalCount: state.rows.length };
}

/**
 * Master dispatcher — picks the right context builder for an intent.
 */
export function buildContextForIntent(intent, params = {}) {
  switch (intent) {
    case INTENTS.EXECUTIVE_SUMMARY: return buildExecutiveSummaryContext();
    case INTENTS.RELEASE_OVERVIEW:  return buildReleaseOverviewContext(params.release);
    case INTENTS.TEAM_OVERVIEW:     return buildTeamOverviewContext(params.team);
    case INTENTS.MEETING_PREP:      return buildMeetingPrepContext(params.meetingType);
    case INTENTS.ASK_PLAN:          return buildAskPlanContext();
    case INTENTS.FILTER_TASKS:      return buildFilterTasksContext(params);
    case INTENTS.RELEASE_NOTES:     return buildReleaseNotesContext(params.release);
    case INTENTS.WHAT_RISKS:        return buildRisksContext();
    case INTENTS.OVERLOAD:          return buildOverloadContext();
    case INTENTS.REVIEW_MODE:       return buildReviewModeContext(params.role);
    default: {
      // Generic — return summary context
      const stats = buildStats(state.rows);
      const teams = buildTeamBreakdown(state.rows);
      return { intent: 'generic', stats, teams };
    }
  }
}
