'use strict';
/* ============================================================
   V18 O2 (AUDIT_HOLISTIC O2): Этот модуль обёрнут в `sqlite` backend
   в `app/storage/StorageRouter.js`. Wrapper нормализует API под
   StorageInterface (save/load/clear/keys/ready). Прямые вызовы
   `SQLiteStore.saveRows / getRows` остаются доступны для legacy кода.

   SQLite Storage Layer — v11 (experimental, opt-in)

   Wraps sql.js (WASM-compiled SQLite). Persists database dumps
   to IndexedDB (preferred) with localStorage as a base64 fallback.

   - Lazy-loads sql.js on first init() call.
   - Falls back gracefully if sql.js can't be loaded — caller
     should detect via `await SQLiteStore.isAvailable()`.
   - Tokens / secrets are NEVER written here (security boundary).

   Public API:
     SQLiteStore.init()                  → Promise<boolean>
     SQLiteStore.isReady()               → boolean
     SQLiteStore.getRows()               → array
     SQLiteStore.saveRows(rows)          → void   (debounced persist)
     SQLiteStore.getComments(rowId?)     → array
     SQLiteStore.appendComment({rowId, author, text}) → number id
     SQLiteStore.getChangeLog(opts?)     → array
     SQLiteStore.appendChangeLog({rowId, field, oldValue, newValue}) → number id
     SQLiteStore.getIntegrations()       → array
     SQLiteStore.saveIntegrations(arr)   → void
     SQLiteStore.exportDump()            → Uint8Array
     SQLiteStore.importDump(bytes)       → void
     SQLiteStore.clearAll()              → void
     SQLiteStore.size()                  → number  (bytes of current dump)
     SQLiteStore.runRaw(sql, params?)    → array of objects (debug)
   ============================================================ */

import { Services } from './app/services.js';

const IDB_NAME    = 'q2_sqlite_v1';
const IDB_STORE   = 'dump';
const IDB_KEY     = 'main';
const LS_DUMP_KEY = 'q2_sqlite_dump_b64_v1';   // localStorage fallback (base64)

/* ── sql.js loader ──────────────────────────────────────────
   Tries (in order):
   1. window.initSqlJs (already on page if you bundled it locally)
   2. local file libs/sql-wasm.js
   3. CDN https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.js
   The corresponding sql-wasm.wasm is fetched from the same dir.
*/
const SQL_JS_LOCAL_JS  = 'libs/sql-wasm.js';
const SQL_JS_CDN_JS    = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.js';
const SQL_JS_LOCAL_WASM= 'libs/';
const SQL_JS_CDN_WASM  = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/';

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => { try { s.remove(); } catch(_) {} reject(new Error('failed to load ' + src)); };
    document.head.appendChild(s);
  });
}

let _wasmBaseUrl = SQL_JS_LOCAL_WASM;   // path used for sql-wasm.wasm fetch

async function _loadSqlJs() {
  if (typeof window.initSqlJs === 'function') {
    return window.initSqlJs;
  }
  const errors = [];
  // Try local file first
  try {
    await _loadScript(SQL_JS_LOCAL_JS);
    if (typeof window.initSqlJs === 'function') {
      _wasmBaseUrl = SQL_JS_LOCAL_WASM;
      return window.initSqlJs;
    }
  } catch (e) { errors.push('local: ' + (e?.message || e)); }
  // CDN
  try {
    await _loadScript(SQL_JS_CDN_JS);
    if (typeof window.initSqlJs === 'function') {
      _wasmBaseUrl = SQL_JS_CDN_WASM;
      return window.initSqlJs;
    }
  } catch (e) { errors.push('cdn: ' + (e?.message || e)); }
  throw new Error('sql.js не найден ни локально (libs/sql-wasm.js), ни через CDN. ' + errors.join(' | '));
}

/* ── IndexedDB tiny helpers ──────────────────────────────── */

function _idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
async function _idbGet(key) {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await _idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error);
    });
  } catch (_) { return null; }
}
async function _idbPut(key, value) {
  if (typeof indexedDB === 'undefined') return false;
  try {
    const db = await _idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror    = () => reject(tx.error);
    });
  } catch (_) { return false; }
}
async function _idbDelete(key) {
  if (typeof indexedDB === 'undefined') return false;
  try {
    const db = await _idbOpen();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror    = () => resolve(false);
    });
  } catch (_) { return false; }
}

/* ── base64 ↔ Uint8Array (for localStorage fallback) ─────── */

function _u8ToBase64(u8) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(s);
}
function _base64ToU8(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

/* ── Schema bootstrap ───────────────────────────────────── */

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT
);

CREATE TABLE IF NOT EXISTS rows (
  id                  TEXT PRIMARY KEY,
  category            TEXT,
  team                TEXT,
  epic                TEXT,
  tasks               TEXT,
  scopeStatus         TEXT,
  release120Types     TEXT,
  release121Types     TEXT,
  release122Types     TEXT,
  overtimeTypes       TEXT,
  backlogTypes        TEXT,
  role                TEXT,
  blockingDependency  INTEGER DEFAULT 0,
  blockingDeadline    TEXT,
  commitToCounterparty INTEGER DEFAULT 0,
  commitDate          TEXT,
  isDone              INTEGER DEFAULT 0,
  doneDate            TEXT,
  workPeriodStart     TEXT,
  workPeriodEnd       TEXT,
  assignee            TEXT,
  comment             TEXT,
  tags                TEXT,
  jiraKey             TEXT,
  jiraStatus          TEXT,
  jiraAssignee        TEXT,
  prUrl               TEXT,
  prStatus            TEXT,
  docUrl              TEXT,
  docTitle            TEXT,
  riskFlags           TEXT,
  raw                 TEXT,    -- catch-all JSON for unmapped fields
  dirty               INTEGER DEFAULT 0,
  createdAt           TEXT,
  updatedAt           TEXT
);
CREATE INDEX IF NOT EXISTS rows_team   ON rows(team);
CREATE INDEX IF NOT EXISTS rows_epic   ON rows(epic);
CREATE INDEX IF NOT EXISTS rows_jiraKey ON rows(jiraKey);

CREATE TABLE IF NOT EXISTS comments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  rowId     TEXT,
  author    TEXT,
  text      TEXT,
  createdAt TEXT
);
CREATE INDEX IF NOT EXISTS comments_rowId ON comments(rowId);

CREATE TABLE IF NOT EXISTS changeLog (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  rowId     TEXT,
  field     TEXT,
  oldValue  TEXT,
  newValue  TEXT,
  timestamp TEXT
);
CREATE INDEX IF NOT EXISTS changeLog_rowId ON changeLog(rowId);
CREATE INDEX IF NOT EXISTS changeLog_ts    ON changeLog(timestamp);

CREATE TABLE IF NOT EXISTS integrations (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  rowId     TEXT,
  jiraKey   TEXT,
  prUrl     TEXT,
  docUrl    TEXT,
  status    TEXT,
  updatedAt TEXT
);
`;

/* Columns persisted as plain SQLite columns (in saveRows). */
const ROW_COLS = [
  'id','category','team','epic','tasks','scopeStatus',
  'release120Types','release121Types','release122Types','overtimeTypes','backlogTypes',
  'role','blockingDependency','blockingDeadline','commitToCounterparty','commitDate',
  'isDone','doneDate','workPeriodStart','workPeriodEnd','assignee','comment','tags',
  'jiraKey','jiraStatus','jiraAssignee','prUrl','prStatus','docUrl','docTitle',
  'riskFlags','raw','dirty','createdAt','updatedAt',
];
/* Boolean fields — convert to 0/1 on write, back to bool on read. */
const BOOL_FIELDS  = new Set(['blockingDependency','isDone','dirty','commitToCounterparty']);
/* Array fields — store as JSON string. */
const ARRAY_FIELDS = new Set(['release120Types','release121Types','release122Types','overtimeTypes','backlogTypes','riskFlags']);

/* ── Internal state ─────────────────────────────────────── */

let _SQL = null;       // initSqlJs result (constructor for Database)
let _db  = null;
let _ready = false;
let _readyPromise = null;
let _persistTimer = null;
let _lastDumpSize = 0;
let _lastError = '';   // last init failure reason (human-readable)

const PERSIST_DEBOUNCE_MS = 500;

function _persistDebounced() {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => { SQLiteStore.persistNow().catch(()=>{}); }, PERSIST_DEBOUNCE_MS);
}

/* ── Row serialisation helpers ──────────────────────────── */

function _rowFromObj(obj) {
  // Build the array of column-values in ROW_COLS order
  const known = new Set(ROW_COLS);
  const raw = {};
  for (const k of Object.keys(obj || {})) {
    if (!known.has(k)) raw[k] = obj[k];
  }
  return ROW_COLS.map(col => {
    if (col === 'raw') return Object.keys(raw).length ? JSON.stringify(raw) : null;
    let v = obj?.[col];
    if (BOOL_FIELDS.has(col))  return v ? 1 : 0;
    if (ARRAY_FIELDS.has(col)) return Array.isArray(v) ? JSON.stringify(v) : (v ? String(v) : null);
    if (v == null) return null;
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  });
}

function _rowToObj(arr) {
  const out = {};
  ROW_COLS.forEach((col, i) => {
    let v = arr[i];
    if (BOOL_FIELDS.has(col))  out[col] = !!v;
    else if (ARRAY_FIELDS.has(col)) {
      if (v == null) out[col] = [];
      else { try { out[col] = JSON.parse(v); } catch(_) { out[col] = []; } }
    } else {
      out[col] = (v == null) ? '' : v;
    }
  });
  if (out.raw && typeof out.raw === 'string') {
    try { Object.assign(out, JSON.parse(out.raw)); } catch(_) {}
    delete out.raw;
  }
  return out;
}

/* ============================================================
   PUBLIC API
   ============================================================ */

export const SQLiteStore = {
  /** Has init() been called and succeeded? */
  isReady() { return _ready; },

  /** Probe whether sql.js is loadable WITHOUT actually initialising. */
  async isAvailable() {
    if (typeof window.initSqlJs === 'function') return true;
    if (_SQL) return true;
    return false;
  },

  /** Last init failure reason (or '' if no failure). */
  lastError() { return _lastError; },

  /** Idempotent. Returns true on success, false on failure. */
  async init() {
    if (_ready) return true;
    if (_readyPromise) return _readyPromise;
    _readyPromise = (async () => {
      try {
        const init = await _loadSqlJs();
        // _wasmBaseUrl was set by _loadSqlJs to either local or CDN, matching where the .js was found.
        try {
          _SQL = await init({ locateFile: (file) => _wasmBaseUrl + file });
        } catch (e1) {
          // wasm fetch failed at the chosen base — try the OTHER source as a last-resort fallback.
          const altBase = (_wasmBaseUrl === SQL_JS_LOCAL_WASM) ? SQL_JS_CDN_WASM : SQL_JS_LOCAL_WASM;
          console.warn('[SQLiteStore] wasm load failed at', _wasmBaseUrl, '→ retrying at', altBase, e1?.message);
          _SQL = await init({ locateFile: (file) => altBase + file });
          _wasmBaseUrl = altBase;
        }
        // Try to load existing dump
        let dump = await _idbGet(IDB_KEY);
        if (!dump) {
          const b64 = localStorage.getItem(LS_DUMP_KEY);
          if (b64) { try { dump = _base64ToU8(b64); } catch(_) {} }
        }
        _db = dump ? new _SQL.Database(new Uint8Array(dump)) : new _SQL.Database();
        _db.run(SCHEMA_SQL);
        _ready = true;
        _lastError = '';
        return true;
      } catch (e) {
        _lastError = e?.message || String(e) || 'unknown';
        console.warn('[SQLiteStore] init failed — falling back to localStorage:', _lastError);
        _ready = false;
        // Reset the ready-promise so a future call (e.g. after the user installs libs/) can retry.
        _readyPromise = null;
        return false;
      }
    })();
    return _readyPromise;
  },

  /** Force-write the current DB to IndexedDB (and localStorage as backup). */
  async persistNow() {
    if (!_ready || !_db) return false;
    try {
      const bytes = _db.export();   // Uint8Array
      _lastDumpSize = bytes.byteLength || 0;
      const okIdb = await _idbPut(IDB_KEY, bytes);
      if (!okIdb) {
        // localStorage fallback (only for SMALL DBs — base64 inflates ~33%)
        try { localStorage.setItem(LS_DUMP_KEY, _u8ToBase64(bytes)); } catch (e) {
          console.warn('[SQLiteStore] dump too large for localStorage:', e?.message);
        }
      }
      return true;
    } catch (e) {
      console.warn('[SQLiteStore] persist failed:', e?.message || e);
      return false;
    }
  },

  /* ── Rows ─────────────────────────────────────────────── */

  getRows() {
    if (!_ready) return [];
    const stmt = _db.prepare(`SELECT ${ROW_COLS.join(',')} FROM rows`);
    const out = [];
    while (stmt.step()) out.push(_rowToObj(stmt.get()));
    stmt.free();
    return out;
  },

  /** Replace all rows in one transaction. */
  saveRows(rows) {
    if (!_ready) return;
    if (!Array.isArray(rows)) rows = [];
    _db.run('BEGIN');
    try {
      _db.run('DELETE FROM rows');
      const placeholders = ROW_COLS.map(() => '?').join(',');
      const stmt = _db.prepare(`INSERT INTO rows(${ROW_COLS.join(',')}) VALUES(${placeholders})`);
      for (const r of rows) stmt.run(_rowFromObj(r));
      stmt.free();
      _db.run('COMMIT');
      _persistDebounced();
    } catch (e) {
      try { _db.run('ROLLBACK'); } catch(_) {}
      console.warn('[SQLiteStore] saveRows failed:', e?.message || e);
    }
  },

  /* ── Comments ─────────────────────────────────────────── */

  getComments(rowId) {
    if (!_ready) return [];
    const sql = rowId
      ? `SELECT id, rowId, author, text, createdAt FROM comments WHERE rowId=? ORDER BY createdAt DESC`
      : `SELECT id, rowId, author, text, createdAt FROM comments ORDER BY createdAt DESC`;
    const stmt = _db.prepare(sql);
    if (rowId) stmt.bind([rowId]);
    const out = [];
    while (stmt.step()) {
      const [id, rid, author, text, createdAt] = stmt.get();
      out.push({ id, rowId: rid, author, text, createdAt });
    }
    stmt.free();
    return out;
  },
  appendComment({ rowId, author, text }) {
    if (!_ready) return null;
    _db.run(`INSERT INTO comments(rowId, author, text, createdAt) VALUES(?,?,?,?)`,
      [String(rowId||''), String(author||''), String(text||''), new Date().toISOString()]);
    const id = _db.exec('SELECT last_insert_rowid() AS id')[0]?.values?.[0]?.[0] || null;
    _persistDebounced();
    return id;
  },

  /* ── Change log ───────────────────────────────────────── */

  getChangeLog({ rowId, limit=200 } = {}) {
    if (!_ready) return [];
    let sql = `SELECT id, rowId, field, oldValue, newValue, timestamp FROM changeLog`;
    const params = [];
    if (rowId) { sql += ` WHERE rowId=?`; params.push(rowId); }
    sql += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(Math.max(1, Math.min(2000, limit|0)));
    const stmt = _db.prepare(sql);
    stmt.bind(params);
    const out = [];
    while (stmt.step()) {
      const [id, rid, field, oldV, newV, ts] = stmt.get();
      out.push({ id, rowId: rid, field, oldValue: oldV, newValue: newV, timestamp: ts });
    }
    stmt.free();
    return out;
  },
  appendChangeLog({ rowId, field, oldValue, newValue }) {
    if (!_ready) return null;
    _db.run(`INSERT INTO changeLog(rowId, field, oldValue, newValue, timestamp) VALUES(?,?,?,?,?)`,
      [String(rowId||''), String(field||''),
       oldValue == null ? null : (typeof oldValue === 'object' ? JSON.stringify(oldValue) : String(oldValue)),
       newValue == null ? null : (typeof newValue === 'object' ? JSON.stringify(newValue) : String(newValue)),
       new Date().toISOString()]);
    const id = _db.exec('SELECT last_insert_rowid() AS id')[0]?.values?.[0]?.[0] || null;
    _persistDebounced();
    return id;
  },

  /* ── Integrations cache (per-row) ─────────────────────── */

  getIntegrations() {
    if (!_ready) return [];
    const stmt = _db.prepare(`SELECT id, rowId, jiraKey, prUrl, docUrl, status, updatedAt FROM integrations`);
    const out = [];
    while (stmt.step()) {
      const [id, rid, jk, pr, doc, st, ts] = stmt.get();
      out.push({ id, rowId: rid, jiraKey: jk, prUrl: pr, docUrl: doc, status: st, updatedAt: ts });
    }
    stmt.free();
    return out;
  },
  saveIntegrations(arr) {
    if (!_ready) return;
    if (!Array.isArray(arr)) arr = [];
    _db.run('BEGIN');
    try {
      _db.run('DELETE FROM integrations');
      const stmt = _db.prepare(`INSERT INTO integrations(rowId, jiraKey, prUrl, docUrl, status, updatedAt) VALUES(?,?,?,?,?,?)`);
      const now = new Date().toISOString();
      for (const it of arr) stmt.run([it.rowId||'', it.jiraKey||'', it.prUrl||'', it.docUrl||'', it.status||'', it.updatedAt||now]);
      stmt.free();
      _db.run('COMMIT');
      _persistDebounced();
    } catch (e) {
      try { _db.run('ROLLBACK'); } catch(_) {}
      console.warn('[SQLiteStore] saveIntegrations failed:', e?.message);
    }
  },

  /* ── Maintenance ──────────────────────────────────────── */

  exportDump() {
    if (!_ready) return null;
    return _db.export();
  },
  importDump(bytes) {
    if (!_SQL) throw new Error('SQLite not initialised');
    if (_db) { try { _db.close(); } catch(_){} }
    _db = new _SQL.Database(new Uint8Array(bytes));
    _db.run(SCHEMA_SQL);  // ensure schema exists in case dump is from older version
    _ready = true;
    _persistDebounced();
  },
  clearAll() {
    if (!_ready) return;
    _db.run('BEGIN');
    try {
      _db.run('DELETE FROM rows');
      _db.run('DELETE FROM comments');
      _db.run('DELETE FROM changeLog');
      _db.run('DELETE FROM integrations');
      _db.run('COMMIT');
      _persistDebounced();
    } catch (e) {
      try { _db.run('ROLLBACK'); } catch(_) {}
    }
  },
  size() {
    return _lastDumpSize || (_ready ? _db.export().byteLength : 0);
  },
  /** Debug — run arbitrary read-only SQL. Returns array of objects. */
  runRaw(sql, params=[]) {
    if (!_ready) return [];
    const stmt = _db.prepare(sql);
    if (params && params.length) stmt.bind(params);
    const out = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      out.push(row);
    }
    stmt.free();
    return out;
  },
  /** Erase the persisted dump (IDB + LS). DOES NOT touch live DB. */
  async clearPersistence() {
    await _idbDelete(IDB_KEY);
    try { localStorage.removeItem(LS_DUMP_KEY); } catch(_) {}
  },
};

Services.register('SQLiteStore', SQLiteStore);
if (typeof window !== 'undefined') window.SQLiteStore = SQLiteStore;
