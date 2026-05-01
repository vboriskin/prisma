'use strict';
/* ============================================================
   CHAT ALERTS — v10_0
   Builds, stores and renders alert cards for the chat panel.
   ============================================================ */

import { state } from '../state.js';
import { Utils } from '../utils.js';

const ALERT_SNAPSHOT_KEY = 'q2_alert_baseline_v1';
const ALERT_THRESHOLD = {
  blockers:    1,   // alert if any blockers
  riskGrowth:  2,   // alert if risks grew by this many vs baseline
  noRelease:   3,   // alert if this many in-scope tasks have no release
  overload:    5,   // alert if any assignee has ≥ N active tasks
  healthDrop:  10,  // alert if healthScore dropped by this % vs baseline
};

/* ── Health score (local formula) ────────────────────────── */

export function computeHealthScore(rows) {
  if (!rows || !rows.length) return 100;
  const total     = rows.length;
  const done      = rows.filter(r => r.isDone).length;
  const blockers  = rows.filter(r => r.blockingDependency && !r.isDone).length;
  const risky     = rows.filter(r => (r.riskFlags||[]).length && !r.isDone).length;
  const noRelease = rows.filter(r => r.isUnassigned && r.scopeStatus === 'Да' && !r.isDone).length;
  const active    = total - done;
  if (active === 0) return 100;
  const penalty = (blockers * 15 + risky * 8 + noRelease * 5) / active;
  return Math.max(0, Math.round(100 - Math.min(100, penalty * 10)));
}

/* ── Alert builders ───────────────────────────────────────── */

function buildBlockerAlerts(rows) {
  const blockers = rows.filter(r => r.blockingDependency && !r.isDone);
  if (blockers.length < ALERT_THRESHOLD.blockers) return [];
  const r120 = blockers.filter(r => r.hasRelease120);
  const teams = [...new Set(blockers.map(r => r.team).filter(Boolean))];
  return [{
    id: 'alert_blockers',
    type: 'blockers',
    severity: blockers.length >= 5 ? 'critical' : 'warning',
    icon: '🚫',
    title: `${blockers.length} активных блокеров`,
    body: `${r120.length > 0 ? `В т.ч. ${r120.length} в 1.20. ` : ''}Команды: ${teams.slice(0, 3).join(', ')}${teams.length > 3 ? ` +${teams.length - 3}` : ''}`,
    count: blockers.length,
    filterPayload: { onlyBlocking: true },
    drillPrompt: 'Перечисли все блокеры и предложи способы их снятия.',
    fixPrompt: 'Предложи план устранения текущих блокеров.',
  }];
}

function buildRiskAlerts(rows) {
  const risky = rows.filter(r => (r.riskFlags||[]).length && !r.isDone);
  if (!risky.length) return [];
  const baseline = loadAlertBaseline();
  const wasRisky = baseline ? (baseline.riskyCount || 0) : risky.length;
  const grew = risky.length - wasRisky;
  if (grew < ALERT_THRESHOLD.riskGrowth && risky.length < 5) return [];
  return [{
    id: 'alert_risks',
    type: 'risks',
    severity: grew > 0 ? 'warning' : 'info',
    icon: '⚠️',
    title: `${risky.length} рискованных задач${grew > 0 ? ` (+${grew} с последней проверки)` : ''}`,
    body: `Топ риски: ${[...new Set(risky.flatMap(r => r.riskFlags||[]))].slice(0, 3).join(', ') || 'разные'}`,
    count: risky.length,
    filterPayload: { onlyRisky: true },
    drillPrompt: 'Объясни главные риски и почему они возникли.',
    fixPrompt: 'Что нужно сделать, чтобы снизить количество рискованных задач?',
  }];
}

function buildNoReleaseAlerts(rows) {
  const noRel = rows.filter(r => r.isUnassigned && r.scopeStatus === 'Да' && !r.isDone);
  if (noRel.length < ALERT_THRESHOLD.noRelease) return [];
  const teams = [...new Set(noRel.map(r => r.team).filter(Boolean))];
  return [{
    id: 'alert_no_release',
    type: 'no_release',
    severity: noRel.length >= 10 ? 'warning' : 'info',
    icon: '📭',
    title: `${noRel.length} задач в scope без релиза`,
    body: `Команды: ${teams.slice(0, 3).join(', ')}${teams.length > 3 ? ` +${teams.length - 3}` : ''}`,
    count: noRel.length,
    filterPayload: { release: 'none', scope: 'Да' },
    drillPrompt: 'Почему эти задачи остались без релиза?',
    fixPrompt: 'перенеси задачи без релиза в 1.22',
  }];
}

function buildOverloadAlerts(rows) {
  const load = {};
  rows.filter(r => !r.isDone).forEach(r => {
    (r.assignee||'').split(/[|,]/).map(s => s.trim()).filter(Boolean).forEach(name => {
      load[name] = (load[name] || 0) + 1;
    });
  });
  const overloaded = Object.entries(load)
    .filter(([, n]) => n >= ALERT_THRESHOLD.overload)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (!overloaded.length) return [];
  return [{
    id: 'alert_overload',
    type: 'overload',
    severity: 'info',
    icon: '🔥',
    title: `${overloaded.length} исполнителей с высокой нагрузкой`,
    body: overloaded.map(([n, c]) => `${n}: ${c}`).join(' · '),
    count: overloaded.length,
    filterPayload: null,
    drillPrompt: 'Кто из исполнителей перегружен и как это исправить?',
    fixPrompt: 'Как перераспределить задачи, чтобы снизить перегруз?',
  }];
}

function buildHealthAlerts(rows) {
  const score = computeHealthScore(rows);
  const baseline = loadAlertBaseline();
  const prevScore = baseline ? (baseline.healthScore || score) : score;
  const drop = prevScore - score;
  if (score >= 70 && drop < ALERT_THRESHOLD.healthDrop) return [];
  return [{
    id: 'alert_health',
    type: 'health',
    severity: score < 50 ? 'critical' : 'warning',
    icon: score < 50 ? '🔴' : '🟡',
    title: `Health Score: ${score}%${drop > 0 ? ` (−${drop}% с последней проверки)` : ''}`,
    body: `Влияют: блокеры, задачи без релиза, риски`,
    count: score,
    filterPayload: null,
    drillPrompt: 'Объясни почему healthScore такой.',
    fixPrompt: 'Что сделать, чтобы поднять healthScore?',
  }];
}

/* ── Baseline (for delta tracking) ───────────────────────── */

function loadAlertBaseline() {
  try { return JSON.parse(localStorage.getItem(ALERT_SNAPSHOT_KEY) || 'null'); } catch(_) { return null; }
}

export function saveAlertBaseline() {
  const rows = state.rows;
  const risky = rows.filter(r => (r.riskFlags||[]).length && !r.isDone).length;
  const health = computeHealthScore(rows);
  try {
    localStorage.setItem(ALERT_SNAPSHOT_KEY, JSON.stringify({
      ts: new Date().toISOString(), riskyCount: risky, healthScore: health,
    }));
  } catch(_) {}
}

/* ── Public API ───────────────────────────────────────────── */

/** Build alert list from current state.rows. */
export function buildAlerts() {
  const rows = state.rows;
  if (!rows || !rows.length) return [];
  return [
    ...buildBlockerAlerts(rows),
    ...buildRiskAlerts(rows),
    ...buildNoReleaseAlerts(rows),
    ...buildOverloadAlerts(rows),
    ...buildHealthAlerts(rows),
  ];
}

/** Render alert cards HTML for injection into the chat. */
export function renderAlertBar(alerts) {
  if (!alerts || !alerts.length) return '';
  const severityClass = s => s === 'critical' ? 'chat-alert-critical' : s === 'warning' ? 'chat-alert-warning' : 'chat-alert-info';
  const cards = alerts.map(a => {
    const esc = Utils.escapeHtml;
    const showBtn  = a.filterPayload ? `<button class="chat-alert-btn" data-action-type="apply_filter" data-action-payload='${JSON.stringify(a.filterPayload||{})}'>Показать</button>` : '';
    const explBtn  = `<button class="chat-alert-btn" data-prompt="${esc(a.drillPrompt)}">Объяснить</button>`;
    const fixBtn   = `<button class="chat-alert-btn chat-alert-btn-fix" data-prompt="${esc(a.fixPrompt)}">Предложить исправление</button>`;
    return `<div class="chat-alert-card ${severityClass(a.severity)}">
      <span class="chat-alert-icon">${a.icon}</span>
      <div class="chat-alert-body">
        <div class="chat-alert-title">${esc(a.title)}</div>
        <div class="chat-alert-sub">${esc(a.body)}</div>
      </div>
      <div class="chat-alert-actions">${showBtn}${explBtn}${fixBtn}</div>
    </div>`;
  }).join('');
  return `<div class="chat-alert-bar" id="chat-alert-bar">${cards}</div>`;
}

/** Refresh alerts and update the DOM if panel is open. */
export function refreshAlerts() {
  const alerts = buildAlerts();
  if (Array.isArray(state.llm?.alerts)) {
    state.llm.alerts = alerts;
  } else if (state.llm) {
    state.llm.alerts = alerts;
  }
  const bar = document.getElementById('chat-alert-bar');
  if (bar) {
    const newHtml = renderAlertBar(alerts);
    if (newHtml) bar.outerHTML = newHtml;
    else bar.remove();
  }
  return alerts;
}
