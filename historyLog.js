'use strict';
/* ============================================================
   HISTORY LOG — v10_0
   Centralized audit log of all changes.
   Persists to localStorage. Supports filtering / export.
   ============================================================ */

import { state } from './state.js';
import { Reactive } from './reactiveStore.js';
import { Services } from './app/services.js';

export const HISTORY_KEY = 'q2_action_log_v1';
// TECH 5.1 — rolling window cap. Без auto-trim'а на годичном использовании
// action-log пухнет (>5MB), упирается в localStorage quota и теряет данные
// рандомно через quota-recovery slice. 2000 записей — ~6-12 месяцев активного
// использования при 5-15 событий/день. Старше — отбрасываем head'ом.
const MAX_ENTRIES = 2000;
// Don't persist entries older than this many days (keeps quota in check)
const RETENTION_DAYS = 90;

/* ── Internal helpers ────────────────────────────────────── */
function _ensureLog() {
  if (!Array.isArray(state.actionLog)) state.actionLog = [];
  return state.actionLog;
}

function _persist() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.actionLog));
  } catch(e) {
    // Quota exceeded — drop oldest 30% and retry once
    if (state.actionLog.length > 50) {
      state.actionLog = state.actionLog.slice(0, Math.floor(state.actionLog.length * 0.7));
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(state.actionLog)); } catch(_) {}
    }
  }
}

/* ── Public API ──────────────────────────────────────────── */

/* Load persisted log on app start.
   F3 fix (codebase-01 audit) — присвоение state.actionLog проходит через
   Proxy и триггерит Storage.save({rows,employees,...}). Заворачиваем в
   Reactive.silent: лог хранится в своём persist-канале (_persist()), а
   массивный save основного state не нужен. */
export function loadHistoryLog() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
    Reactive.silent(() => {
      const filtered = parsed.filter(e => {
        const ts = Date.parse(e.at || '') || 0;
        return ts >= cutoff;
      });
      // TECH 5.1 — apply rolling window cap on load (legacy storages могли
      // накопить >2000 до введения cap'а). Тримим head — сохраняем самые свежие.
      state.actionLog = filtered.length > MAX_ENTRIES
        ? filtered.slice(0, MAX_ENTRIES)
        : filtered;
    });
  } catch(_) {
    Reactive.silent(() => { state.actionLog = []; });
  }
}

/* Add an entry. type/category/label/count/details/source. Always persisted. */
export function logAction({ type, category = 'data', label, count = 1, details = '', source = 'ui', target = null } = {}) {
  if (!type) return;
  const entry = {
    id:       (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    type:     String(type).slice(0, 80),
    category: String(category).slice(0, 32),
    label:    String(label || type).slice(0, 200),
    count:    Number(count) || 1,
    details:  details ? String(details).slice(0, 500) : '',
    target:   target ? String(target).slice(0, 200) : null,
    source:   String(source).slice(0, 32),
    at:       new Date().toISOString(),
    simMode:  !!state.simMode,
  };
  // F3 fix (codebase-01 audit) — unshift на state.actionLog через Proxy
  // триггерит auto-save{rows,employees}. Любой клик «закрепить колонку»
  // = serialize всех 1000 rows. Лог пишет себя через _persist() сам.
  Reactive.silent(() => {
    const log = _ensureLog();
    log.unshift(entry);
    // TECH 5.1 — rolling window: drop tail beyond MAX_ENTRIES. unshift+length=
    // эквивалентно splice tail; оставляем явный splice как safety если в
    // legacy localStorage уже накопилось >MAX (auto-trim на load).
    if (log.length > MAX_ENTRIES) {
      log.splice(MAX_ENTRIES, log.length - MAX_ENTRIES);
    }
  });
  _persist();
  // Live-refresh History view if it's open
  if (state.activeSection === 'history' && typeof window !== 'undefined' && Services.HistoryView?.render) {
    try { Services.HistoryView.render(); } catch(_) {}
  }
}

/* Convenience wrappers for common kinds of events */
export const HistoryLog = {
  data:         (type, label, opts={}) => logAction({ type, category: 'data',         label, ...opts }),
  ai:           (type, label, opts={}) => logAction({ type, category: 'ai',           label, ...opts }),
  integrations: (type, label, opts={}) => logAction({ type, category: 'integrations', label, ...opts }),
  settings:     (type, label, opts={}) => logAction({ type, category: 'settings',     label, ...opts }),
  view:         (type, label, opts={}) => logAction({ type, category: 'view',         label, ...opts }),
  system:       (type, label, opts={}) => logAction({ type, category: 'system',       label, ...opts }),
};

export function clearHistoryLog() {
  state.actionLog = [];
  try { localStorage.removeItem(HISTORY_KEY); } catch(_) {}
}

export function exportHistoryAsCSV() {
  const log = _ensureLog();
  const headers = ['Дата', 'Категория', 'Тип', 'Описание', 'Кол-во', 'Цель', 'Источник', 'SimMode', 'Подробности'];
  const rows = log.map(e => [
    e.at, e.category, e.type, e.label, e.count, e.target || '', e.source, e.simMode ? '1' : '', e.details || ''
  ]);
  // V21 J #72 — formula injection guard. Раньше escape только quote'ил,
  // не префиксил `=+-@\t\r` → `=HYPERLINK("evil")` в Описании выполнялся в Excel.
  // Используем тот же pattern что Utils.escapeCSV (V17 P9 F1).
  const escape = v => {
    let s = String(v == null ? '' : v);
    if (s && /^[=+\-@\t\r]/.test(s)) s = '​' + s; // ZWSP prefix
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [headers, ...rows].map(r => r.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `q2_history_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}
