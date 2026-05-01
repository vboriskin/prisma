'use strict';
/* ============================================================
   appDataStore — v11 unified storage facade
   Decides between localStorage (legacy) and SQLite (experimental)
   based on `localStorage.dataStorageMode`. UI code talks to this
   facade; it routes calls under the hood.

   - localStorage stays the source of truth for *settings* /
     onboarding / integrations config — those are SMALL and don't
     belong in SQLite.
   - SQLite (when enabled) becomes the source of truth for ROWS,
     COMMENTS, CHANGE LOG, INTEGRATIONS-cache.
   - When SQLite is enabled but not yet initialised / failed to
     init, we transparently fall back to localStorage.

   Public API (all sync where possible — lazy-init handled inside):
     AppDataStore.mode                 → 'localStorage' | 'sqlite'
     AppDataStore.setMode(mode)
     AppDataStore.init()               → Promise<void>
     AppDataStore.getRows()            → array
     AppDataStore.saveRows(rows)
     AppDataStore.appendChangeLog({…}) → maybe id
     AppDataStore.getChangeLog(opts?)  → array
     AppDataStore.getComments(rowId?)
     AppDataStore.appendComment({…})
     AppDataStore.migrateFromLocalStorage()
     AppDataStore.status()             → { mode, sqliteReady, dumpSize }
   ============================================================ */

import { state } from './state.js';
import { SQLiteStore } from './sqliteStore.js';

const MODE_KEY = 'dataStorageMode';
const MIGRATED_KEY = 'q2_sqlite_migrated_v1';

function _readMode() {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'sqlite' ? 'sqlite' : 'localStorage';
  } catch (_) { return 'localStorage'; }
}

function _useSqlite() {
  return _readMode() === 'sqlite' && SQLiteStore.isReady();
}

export const AppDataStore = {
  get mode() { return _readMode(); },

  setMode(mode) {
    const m = (mode === 'sqlite') ? 'sqlite' : 'localStorage';
    try { localStorage.setItem(MODE_KEY, m); } catch(_) {}
  },

  /** Idempotent. Initialises SQLite if mode is set to sqlite. */
  async init() {
    if (this.mode !== 'sqlite') return; // nothing to do for localStorage
    const ok = await SQLiteStore.init();
    if (!ok) {
      console.warn('[AppDataStore] SQLite init failed — fall back to localStorage');
      // Don't auto-flip the mode — user explicitly chose sqlite. We just route
      // every method to localStorage until it succeeds (e.g. after reload).
    }
  },

  /* ── Rows ─────────────────────────────────────────────── */
  getRows() {
    if (_useSqlite()) {
      try { return SQLiteStore.getRows(); } catch(_) {}
    }
    // localStorage path: state.rows is the live mirror; persistence is in
    // dataStore.js Storage.save which writes STORAGE_KEY. Reading from state
    // here keeps the API consistent.
    return Array.isArray(state.rows) ? state.rows : [];
  },
  saveRows(rows) {
    if (_useSqlite()) {
      try { SQLiteStore.saveRows(rows); } catch(e) { console.warn('[AppDataStore] saveRows fallback', e); }
    }
    // localStorage path is handled by the existing Storage.save in dataStore.js.
    // We don't duplicate it here to avoid double-writes. Caller still calls
    // Storage.save() as today.
  },

  /* ── Comments / change log ─────────────────────────────
     For now these only write/read from SQLite when active.
     If localStorage mode — caller can keep using state.actionLog / row.changeLog. */
  getComments(rowId) {
    if (_useSqlite()) {
      try { return SQLiteStore.getComments(rowId); } catch(_) {}
    }
    return [];
  },
  appendComment(c) {
    if (_useSqlite()) {
      try { return SQLiteStore.appendComment(c); } catch(_) {}
    }
    return null;
  },
  getChangeLog(opts) {
    if (_useSqlite()) {
      try { return SQLiteStore.getChangeLog(opts); } catch(_) {}
    }
    return [];
  },
  appendChangeLog(e) {
    if (_useSqlite()) {
      try { return SQLiteStore.appendChangeLog(e); } catch(_) {}
    }
    return null;
  },

  /* ── Migration utility ───────────────────────────────── */
  /** Read everything currently in localStorage / state.rows and write it into
   *  the SQLite database. Idempotent — caller can run as many times as wanted.
   *  Returns { rowsCount, alreadyMigrated, ok }. */
  async migrateFromLocalStorage() {
    if (!SQLiteStore.isReady()) {
      const ok = await SQLiteStore.init();
      if (!ok) {
        const why = SQLiteStore.lastError && SQLiteStore.lastError();
        return { ok: false, error: why ? `SQLite не загружен: ${why}` : 'SQLite не загружен' };
      }
    }
    const alreadyMigrated = (() => {
      try { return localStorage.getItem(MIGRATED_KEY) === 'true'; } catch(_) { return false; }
    })();
    try {
      const rows = Array.isArray(state.rows) ? state.rows : [];
      SQLiteStore.saveRows(rows);
      await SQLiteStore.persistNow();
      try { localStorage.setItem(MIGRATED_KEY, 'true'); } catch(_) {}
      return { ok: true, rowsCount: rows.length, alreadyMigrated };
    } catch (e) {
      return { ok: false, error: 'Ошибка переноса: ' + (e?.message || e) };
    }
  },

  /** Reverse direction: pull rows from SQLite back into state.rows + localStorage.
   *  Useful when the user wants to switch back to the legacy backend without
   *  losing data they entered while on SQLite mode. Idempotent — overwrites
   *  state.rows with whatever is currently in SQLite. */
  async migrateToLocalStorage() {
    if (!SQLiteStore.isReady()) {
      const ok = await SQLiteStore.init();
      if (!ok) {
        const why = SQLiteStore.lastError && SQLiteStore.lastError();
        return { ok: false, error: why ? `SQLite не загружен: ${why}` : 'SQLite не загружен' };
      }
    }
    try {
      const rows = SQLiteStore.getRows();
      if (!Array.isArray(rows)) return { ok: false, error: 'SQLite вернул не массив' };
      state.rows = rows;
      // Caller is expected to flush via Storage.save() — we don't import dataStore
      // here to keep the dependency graph one-way (UI → AppDataStore → SQLiteStore).
      return { ok: true, rowsCount: rows.length };
    } catch (e) {
      return { ok: false, error: 'Ошибка переноса из SQLite: ' + (e?.message || e) };
    }
  },

  /** Force-flush in-memory DB to IDB / localStorage. */
  async persist() {
    if (SQLiteStore.isReady()) await SQLiteStore.persistNow();
  },

  status() {
    return {
      mode: this.mode,
      sqliteReady: SQLiteStore.isReady(),
      dumpSize: SQLiteStore.isReady() ? SQLiteStore.size() : 0,
      migrated: (() => { try { return localStorage.getItem(MIGRATED_KEY) === 'true'; } catch(_) { return false; } })(),
    };
  },
};

if (typeof window !== 'undefined') window.AppDataStore = AppDataStore;
