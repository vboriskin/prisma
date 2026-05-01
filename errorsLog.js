'use strict';
/* ============================================================
   ERRORS LOG — V13 (added 2026-04)

   Centralised in-memory + localStorage log of every error/warning
   that happened in the app. Powers the "Ошибки" sidebar section.

   Sources captured automatically:
     · `window.onerror`              — uncaught synchronous errors
     · `unhandledrejection`          — unhandled async promise rejections
     · `console.error` / .warn       — wrapped to mirror into the log
     · `showToast(_, 'error'|'warning')` — toasts route through `add()`
   Manual API for code that wants to log explicitly:
     · ErrorsLog.add({ level, source, message, details?, stack? })
     · ErrorsLog.clear()
     · ErrorsLog.getAll()

   Capped at MAX_ENTRIES (LRU). Persisted to localStorage so errors
   survive F5. Tokens / passwords are NEVER logged — calls
   intentionally pass already-sanitised messages.
   ============================================================ */

const STORAGE_KEY = 'q2_errors_v1';
const MAX_ENTRIES = 500;

let _entries = [];                // newest-first; bounded by MAX_ENTRIES
let _idCounter = 0;
let _listeners = new Set();       // re-render hooks: () => void
// V15 (audit #1, fullstack Critical 2): re-entrancy guard for the
// console.error / console.warn wrappers. Without it, a listener that
// itself calls console.warn would recurse → infinite loop → stack
// overflow. We also guard `add()` so a JSON.stringify failure on
// _stringifyDetails can't spiral via the wrapped console.
let _inHook = false;
// V15 (audit #1, QA Medium 3 + fullstack Low 3): one-time toast when the
// quota fallback halves the log. Without this, the user has no idea half
// their errors silently disappeared.
let _quotaWarningShown = false;

function _persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_entries));
  } catch (_) {
    // Quota exceeded — drop oldest and try again. If still failing, give up.
    try {
      _entries = _entries.slice(0, Math.floor(MAX_ENTRIES / 2));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_entries));
      if (!_quotaWarningShown) {
        _quotaWarningShown = true;
        try { window.showToast?.(`Журнал ошибок переполнил localStorage — старые записи отброшены. Экспортируйте журнал.`, 'warning', 5000); } catch(_) {}
      }
    } catch (_) {}
  }
}

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      _entries = arr.slice(0, MAX_ENTRIES);
      // Restart id counter above the highest persisted id so new entries
      // never collide with reloaded ones.
      const maxId = _entries.reduce((m, e) => Math.max(m, +e.id || 0), 0);
      _idCounter = maxId;
    }
  } catch (_) {
    _entries = [];
  }
}

function _emit() {
  for (const fn of _listeners) {
    try { fn(); } catch (_) { /* listener crash should not crash the logger */ }
  }
}

function _stringifyDetails(details) {
  if (details == null) return '';
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details, _safeReplacer, 2);
  } catch (_) {
    try { return String(details); } catch (_) { return ''; }
  }
}

// Drop circulars and HUGE values to keep payload sane.
function _safeReplacer(_key, value) {
  if (typeof value === 'function') return '[fn]';
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (typeof value === 'string' && value.length > 4000) return value.slice(0, 4000) + '… [truncated]';
  return value;
}

export const ErrorsLog = {
  /** Initialise: load persisted entries, attach global handlers. Idempotent. */
  init() {
    if (ErrorsLog._initialised) return;
    ErrorsLog._initialised = true;
    _load();

    // ── window.onerror (sync) ───────────────────────────────────
    const prevOnError = window.onerror;
    window.onerror = function (msg, source, lineno, colno, err) {
      try {
        ErrorsLog.add({
          level:   'error',
          source:  'window.onerror',
          message: typeof msg === 'string' ? msg : (err?.message || 'Unknown error'),
          details: { source, lineno, colno },
          stack:   err?.stack,
        });
      } catch (_) {}
      if (typeof prevOnError === 'function') return prevOnError.apply(this, arguments);
    };

    // ── unhandledrejection (async) ──────────────────────────────
    window.addEventListener('unhandledrejection', (ev) => {
      try {
        const r = ev.reason;
        ErrorsLog.add({
          level:   'error',
          source:  'unhandledrejection',
          message: r?.message || (typeof r === 'string' ? r : 'Promise rejected'),
          details: r && typeof r === 'object' && !(r instanceof Error) ? r : null,
          stack:   r?.stack,
        });
      } catch (_) {}
    });

    // ── console.error / console.warn mirror ─────────────────────
    // Wrap so the original behaviour (devtools log) is preserved AND
    // every call lands in the Errors tab. Don't re-wrap on hot reload.
    // V15 (audit #1, fullstack Critical 2): re-entrancy guard via _inHook.
    // Without it, a listener calling console.warn → wrapper → add → emit
    // listener → console.warn would loop until stack overflow.
    if (!console._q2Wrapped) {
      const origErr = console.error.bind(console);
      const origWarn = console.warn.bind(console);
      console.error = (...args) => {
        if (_inHook) return origErr(...args);    // re-entry: just pass through
        _inHook = true;
        try { ErrorsLog.add({ level: 'error', source: 'console.error', message: _formatConsoleArgs(args) }); } catch (_) {}
        finally { _inHook = false; }
        origErr(...args);
      };
      console.warn = (...args) => {
        if (_inHook) return origWarn(...args);
        _inHook = true;
        try { ErrorsLog.add({ level: 'warn', source: 'console.warn', message: _formatConsoleArgs(args) }); } catch (_) {}
        finally { _inHook = false; }
        origWarn(...args);
      };
      console._q2Wrapped = true;
    }
  },

  /**
   * Append an entry to the log. Newest-first, bounded by MAX_ENTRIES.
   * @param {object} e
   * @param {'error'|'warn'|'info'} [e.level='error']
   * @param {string} e.source        — short tag, e.g. 'BlackDashboard', 'jiraRequest'
   * @param {string} e.message       — already-sanitised user-facing string
   * @param {*}      [e.details]     — any JSON-able context
   * @param {string} [e.stack]
   */
  add(e) {
    const entry = {
      id:      ++_idCounter,
      ts:      Date.now(),
      level:   e.level   || 'error',
      source:  e.source  || 'unknown',
      message: String(e.message || '').slice(0, 2000),
      details: e.details != null ? _stringifyDetails(e.details) : '',
      stack:   e.stack ? String(e.stack).slice(0, 8000) : '',
    };
    _entries.unshift(entry);
    if (_entries.length > MAX_ENTRIES) _entries.length = MAX_ENTRIES;
    _persist();
    _emit();
    return entry;
  },

  /** Drop everything. */
  clear() {
    _entries = [];
    _persist();
    _emit();
  },

  /** Snapshot (newest first). Mutating the array does NOT affect storage. */
  getAll() { return _entries.slice(); },

  /** Subscribe to changes (used by ErrorsView to live-refresh). */
  onChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); },

  /** Counts by level — for the sidebar badge. */
  counts() {
    const out = { total: _entries.length, error: 0, warn: 0, info: 0 };
    for (const e of _entries) out[e.level] = (out[e.level] || 0) + 1;
    return out;
  },
};

function _formatConsoleArgs(args) {
  return args
    .map(a => {
      if (a == null) return String(a);
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.message;
      try { return JSON.stringify(a, _safeReplacer); } catch (_) { return String(a); }
    })
    .join(' ')
    .slice(0, 2000);
}

if (typeof window !== 'undefined') window.ErrorsLog = ErrorsLog;
