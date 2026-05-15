'use strict';
/* ============================================================
   CHAT REPORTS — v10_0
   Daily report, snapshot management, change-log reader.
   ============================================================ */

import { state } from '../state.js';
import { Utils } from '../utils.js';
// V21 T — pl helper для русских plural'ов в reports.
const _pl = (n, forms) => `${n} ${Utils.plural(n, forms)}`;

export const DAILY_SNAPSHOT_KEY = 'q2_daily_snapshot_v1';
const MAX_LOG_ROWS = 30; // max rows stored per log entry

/* ── Snapshot ─────────────────────────────────────────────── */

/** Lightweight snapshot of current rows (for diff). */
function snapshotRow(r) {
  return {
    id: r.id, epic: r.epic || r.tasks || '', team: r.team || '',
    isDone: !!r.isDone, scopeStatus: r.scopeStatus || '',
    blockingDependency: !!r.blockingDependency,
    riskFlags: (r.riskFlags || []).slice(),
    r120: (r.release120Types || []).length > 0,
    r121: (r.release121Types || []).length > 0,
    r122: (r.release122Types || []).length > 0,
    ot:   (r.overtimeTypes   || []).length > 0,
    isUnassigned: !!r.isUnassigned,
    assignee: r.assignee || '',
  };
}

export function takeSnapshot() {
  // F7 fix (chat-04 audit) — race-guard: если есть pendingBatch, snapshot
  // делать опасно (между takeSnapshot и confirm юзер может уйти, а потом
  // вернуться, и diff смешает chat-changes с manual). Возвращаем существующий
  // snapshot и сигнализируем «устаревший».
  if (state.llm?.pendingBatch) {
    try { window.showToast?.('Снимок не обновлён · сначала примените или отмените chat-действие', 'warning', 4000); } catch (_) {}
    return loadSnapshot();
  }
  const snap = {
    ts: new Date().toISOString(),
    total: state.rows.length,
    rows: state.rows.map(snapshotRow),
  };
  try { localStorage.setItem(DAILY_SNAPSHOT_KEY, JSON.stringify(snap)); } catch(_) {}
  return snap;
}

function loadSnapshot() {
  try {
    const raw = localStorage.getItem(DAILY_SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(_) { return null; }
}

/* ── Diff engine ──────────────────────────────────────────── */

function diffSnapshots(old, current) {
  if (!old || !Array.isArray(old.rows)) return null;

  const oldMap = {};
  old.rows.forEach(r => { oldMap[r.id] = r; });
  const curMap = {};
  current.forEach(r => { curMap[r.id] = r; });

  const newlyDone       = [];
  const newlyBlocking   = [];
  const scopeChanged    = [];
  const releaseChanged  = [];
  const newRows         = [];
  const removedRows     = [];
  const newRisks        = [];

  // New rows
  current.forEach(r => { if (!oldMap[r.id]) newRows.push(r); });
  // Removed
  old.rows.forEach(r => { if (!curMap[r.id]) removedRows.push(r); });

  // Changed
  current.forEach(r => {
    const o = oldMap[r.id];
    if (!o) return;
    if (!o.isDone && r.isDone)   newlyDone.push(r);
    if (!o.blockingDependency && r.blockingDependency) newlyBlocking.push(r);
    if (o.scopeStatus !== r.scopeStatus) scopeChanged.push({ row: r, from: o.scopeStatus, to: r.scopeStatus });
    const relChanged = (o.r120 !== r.r120) || (o.r121 !== r.r121) || (o.r122 !== r.r122) || (o.ot !== r.ot);
    if (relChanged) releaseChanged.push(r);
    const hadRisks = o.riskFlags.length;
    const hasRisks = r.riskFlags.length;
    if (hasRisks > hadRisks) newRisks.push(r);
  });

  return { newlyDone, newlyBlocking, scopeChanged, releaseChanged, newRows, removedRows, newRisks };
}

/* ── Daily report builder ─────────────────────────────────── */

export function buildDailyReport() {
  const snap   = loadSnapshot();
  const rows   = state.rows;
  const current = rows.map(snapshotRow);

  // Base stats
  const total      = rows.length;
  const done       = rows.filter(r => r.isDone).length;
  const blockers   = rows.filter(r => r.blockingDependency && !r.isDone).length;
  const risky      = rows.filter(r => (r.riskFlags||[]).length && !r.isDone).length;
  const noRelease  = rows.filter(r => r.isUnassigned && r.scopeStatus === 'Да').length;

  // Top 5 attention rows
  const attention = rows
    .filter(r => !r.isDone)
    .sort((a, b) => (b.riskScore||0) - (a.riskScore||0))
    .slice(0, 5)
    .map(r => ({ epic: r.epic || r.tasks || '—', team: r.team || '—', riskScore: r.riskScore || 0, flags: r.riskFlags || [] }));

  if (!snap) {
    // No snapshot — show current state as baseline
    takeSnapshot(); // save now so next time we have history
    return {
      hasHistory: false,
      snapshotTaken: true,
      stats: { total, done, blockers, risky, noRelease },
      attention,
      recommendations: buildRecommendations(rows),
    };
  }

  const snapDate = new Date(snap.ts);
  const hoursAgo = Math.round((Date.now() - snapDate.getTime()) / 3600000);
  const diff = diffSnapshots(snap, current);

  return {
    hasHistory: true,
    snapDate: snap.ts,
    hoursAgo,
    diff,
    stats: { total, done, blockers, risky, noRelease },
    attention,
    recommendations: buildRecommendations(rows),
  };
}

function buildRecommendations(rows) {
  const recs = [];
  const blockers = rows.filter(r => r.blockingDependency && !r.isDone);
  if (blockers.length > 0)
    recs.push(`Снять ${_pl(blockers.length, ['блокер','блокера','блокеров'])}: начни с "${blockers[0].epic||blockers[0].tasks||'—'}" (${blockers[0].team||'—'})`);
  const noRelease = rows.filter(r => r.isUnassigned && r.scopeStatus === 'Да' && !r.isDone);
  if (noRelease.length > 0)
    recs.push(`Распределить ${_pl(noRelease.length, ['задачу','задачи','задач'])} без релиза: скажи "перенеси задачи без релиза в 1.22"`);
  const nearDeadline = rows.filter(r => r.blockingDeadline && !r.isDone);
  if (nearDeadline.length > 0)
    recs.push(`Проверить ${_pl(nearDeadline.length, ['задачу','задачи','задач'])} с дедлайном`);
  const highRisk = rows.filter(r => (r.riskScore||0) >= 50 && !r.isDone);
  if (highRisk.length > 0)
    recs.push(`Проанализировать ${_pl(highRisk.length, ['задачу','задачи','задач'])} с riskScore ≥ 50`);
  if (recs.length === 0) recs.push('Данные в хорошем состоянии — продолжай в том же духе!');
  return recs;
}

/* ── Change log reader ────────────────────────────────────── */

/**
 * Read change log entries from state.actionLog.
 * @param {object} opts  - { date, team, field, source, limit }
 */
export function readChangeLog(opts = {}) {
  const log = Array.isArray(state.actionLog) ? state.actionLog : [];
  let entries = [...log];

  if (opts.date) {
    const d = new Date(opts.date).toDateString();
    entries = entries.filter(e => new Date(e.at||e.ts||0).toDateString() === d);
  }
  if (opts.today) {
    const today = new Date().toDateString();
    entries = entries.filter(e => new Date(e.at||e.ts||0).toDateString() === today);
  }
  if (opts.source) {
    entries = entries.filter(e => e.source === opts.source);
  }
  if (opts.field) {
    const f = opts.field.toLowerCase();
    entries = entries.filter(e => (e.type||'').toLowerCase().includes(f) || (e.label||'').toLowerCase().includes(f));
  }
  if (opts.release) {
    const rel = opts.release;
    entries = entries.filter(e => (e.label||'').includes(rel) || (e.type||'').includes(rel));
  }

  return entries.slice(0, opts.limit || 50);
}

/** Write a richer change log entry (with row details). */
export function writeChangeLogEntry({ action, label, rowIds, changes, source = 'chat' }) {
  const entry = {
    id: 'clog_' + Date.now(),
    ts: new Date().toISOString(),
    at: new Date().toISOString(),
    type: action,
    label: label || action,
    count: rowIds ? rowIds.length : (changes ? changes.length : 0),
    source,
    rows: (changes || []).slice(0, MAX_LOG_ROWS).map(c => ({
      id: c.rowId, epic: c.epic || '', field: c.field,
      old: c.oldVal, new: c.newVal,
    })),
  };
  if (!Array.isArray(state.actionLog)) state.actionLog = [];
  state.actionLog.unshift(entry);
  if (state.actionLog.length > 200) state.actionLog.length = 200;
}
