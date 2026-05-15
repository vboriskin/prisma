'use strict';
/* ============================================================
   app/storage/StorageRouter.js — V18 O2 (AUDIT_HOLISTIC O2)
   --
   Тонкий fasade-роутер для 3 существующих persistence-backends:
       1. localStorage  → wraps native localStorage
       2. appDataStore  → wraps AppDataStore (sql/ls auto-pick)
       3. sqlite        → wraps SQLiteStore (sql.js WASM)

   ВАЖНО:
   - Router НЕ меняет существующее runtime-поведение. Старые callsites
     `Storage.save()` / `localStorage.setItem(...)` продолжают работать
     1:1. Router нужен для (а) migration-функций; (б) future code,
     которому нужен абстрактный backend-handle.
   - Каждый backend-обёртка реализует @typedef StorageInterface
     из ./StorageInterface.js.

   Public API:
       StorageRouter.use(kind)            → set active backend (default: 'localStorage')
       StorageRouter.active()             → current active backend handle
       StorageRouter.get(kind)            → handle for specific backend (no switch)
       StorageRouter.list()               → array of all available backends

   Все backend'ы lazy: SQLite-handle не вызывает init() пока не запросят
   .ready() / .save() / .load(). localStorage-handle всегда ready.
   ============================================================ */

import { validateStorageInterface, STORAGE_KINDS } from './StorageInterface.js';
import { Services } from '../services.js';

/* ── localStorage backend ─────────────────────────────────── */
/** @type {import('./StorageInterface.js').StorageInterface} */
const localBackend = {
  kind: 'localStorage',
  save(key, value) {
    if (typeof localStorage === 'undefined') return;
    try {
      const payload = (typeof value === 'string') ? value : JSON.stringify(value);
      localStorage.setItem(key, payload);
    } catch (e) {
      // QuotaExceeded / disabled storage: emit toast if available, swallow otherwise.
      // AUDIT_HOLISTIC Идея 14 — Toast.error (canonical), back-compat на showToast.
      if (e && e.name === 'QuotaExceededError' && typeof window !== 'undefined') {
        if (Services.Toast?.error) Services.Toast.error('Память браузера заполнена', { timeoutMs: 4000 });
        else window.showToast?.('Память браузера заполнена', 'error', 4000);
      }
      throw e;
    }
  },
  load(key) {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return null;
      try { return JSON.parse(raw); }
      catch (_) { return raw; } // not-JSON, return raw string
    } catch (_) { return null; }
  },
  clear() {
    if (typeof localStorage === 'undefined') return;
    // Only clear keys we recognise as ours (q2_*) to avoid nuking
    // unrelated browser state.
    try {
      const ks = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('q2_')) ks.push(k);
      }
      ks.forEach(k => localStorage.removeItem(k));
    } catch (_) {}
  },
  keys() {
    if (typeof localStorage === 'undefined') return [];
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('q2_')) out.push(k);
      }
    } catch (_) {}
    return out;
  },
  async ready() { return typeof localStorage !== 'undefined'; },
};

/* ── appDataStore backend (facade over LS/SQLite) ─────────── */
/**
 * Wraps `window.AppDataStore`. We intentionally read from window (not
 * import) because the router can be loaded before AppDataStore mounts
 * (boot order: dataStore → appDataStore → views).
 *
 * @type {import('./StorageInterface.js').StorageInterface}
 */
const appDataBackend = {
  kind: 'appDataStore',
  save(key, value) {
    // AppDataStore is row-centric, not key/value. We only support `rows`
    // semantics here — other keys delegate to localStorage.
    if (key === 'rows' && typeof window !== 'undefined' && Services.AppDataStore) {
      return Services.AppDataStore.saveRows(Array.isArray(value) ? value : []);
    }
    return localBackend.save(key, value);
  },
  load(key) {
    if (key === 'rows' && typeof window !== 'undefined' && Services.AppDataStore) {
      return Services.AppDataStore.getRows();
    }
    return localBackend.load(key);
  },
  clear() {
    // AppDataStore facade has no clearAll(); we clear the underlying
    // SQLite store via its handle, then clear localStorage.
    try { Services.SQLiteStore?.clearAll?.(); } catch (_) {}
    localBackend.clear();
  },
  keys() {
    // Return localStorage keys + a synthetic 'rows' marker if AppDataStore
    // sqlite has rows.
    const out = localBackend.keys();
    try {
      if (Services.AppDataStore && Services.AppDataStore.mode === 'sqlite' &&
          Services.SQLiteStore && Services.SQLiteStore.isReady()) {
        if (Array.isArray(Services.AppDataStore.getRows()) && Services.AppDataStore.getRows().length > 0) {
          out.push('rows');
        }
      }
    } catch (_) {}
    return out;
  },
  async ready() {
    if (typeof window === 'undefined' || !Services.AppDataStore) return false;
    if (Services.AppDataStore.mode === 'sqlite') {
      try { await Services.AppDataStore.init(); } catch (_) {}
      return !!Services.SQLiteStore?.isReady?.();
    }
    return true;
  },
};

/* ── sqlite backend ───────────────────────────────────────── */
/** @type {import('./StorageInterface.js').StorageInterface} */
const sqliteBackend = {
  kind: 'sqlite',
  async save(key, value) {
    if (typeof window === 'undefined' || !Services.SQLiteStore) {
      throw new Error('SQLiteStore unavailable');
    }
    if (!Services.SQLiteStore.isReady()) await Services.SQLiteStore.init();
    if (key === 'rows') {
      Services.SQLiteStore.saveRows(Array.isArray(value) ? value : []);
      return;
    }
    // For non-row keys we stash JSON in a meta-cell using runRaw; if
    // unavailable, fall back to localStorage (same key namespace).
    try {
      const json = (typeof value === 'string') ? value : JSON.stringify(value);
      Services.SQLiteStore.runRaw?.(
        'INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)',
        [String(key), json],
      );
    } catch (_) {
      localBackend.save(key, value);
    }
  },
  async load(key) {
    if (typeof window === 'undefined' || !Services.SQLiteStore) return null;
    if (!Services.SQLiteStore.isReady()) {
      try { await Services.SQLiteStore.init(); } catch (_) { return null; }
    }
    if (key === 'rows') return Services.SQLiteStore.getRows();
    try {
      const rows = Services.SQLiteStore.runRaw?.(
        'SELECT v FROM meta WHERE k = ?', [String(key)]);
      const v = rows && rows[0] && rows[0].v;
      if (v == null) return null;
      try { return JSON.parse(v); } catch (_) { return v; }
    } catch (_) { return null; }
  },
  async clear() {
    if (typeof window === 'undefined' || !Services.SQLiteStore) return;
    try { Services.SQLiteStore.clearAll?.(); } catch (_) {}
  },
  async keys() {
    if (typeof window === 'undefined' || !Services.SQLiteStore) return [];
    if (!Services.SQLiteStore.isReady()) return [];
    const out = [];
    try {
      const rows = Services.SQLiteStore.runRaw?.('SELECT k FROM meta');
      if (Array.isArray(rows)) rows.forEach(r => { if (r && r.k) out.push(String(r.k)); });
      // Add synthetic 'rows' marker if rows table is non-empty.
      const cnt = Services.SQLiteStore.runRaw?.('SELECT COUNT(*) AS c FROM rows');
      if (cnt && cnt[0] && cnt[0].c > 0) out.push('rows');
    } catch (_) {}
    return out;
  },
  async ready() {
    if (typeof window === 'undefined' || !Services.SQLiteStore) return false;
    if (Services.SQLiteStore.isReady()) return true;
    try { return !!(await Services.SQLiteStore.init()); }
    catch (_) { return false; }
  },
};

/* ── Registry ─────────────────────────────────────────────── */

const _backends = {
  localStorage: localBackend,
  appDataStore: appDataBackend,
  sqlite: sqliteBackend,
};

// Validate at module load — fail-fast if a backend forgot a method.
for (const [k, b] of Object.entries(_backends)) {
  const missing = validateStorageInterface(b);
  if (missing.length) {
    throw new Error(`StorageRouter: backend '${k}' missing: ${missing.join(',')}`);
  }
}

let _activeKind = 'localStorage';

export const StorageRouter = {
  /** Switch active backend handle. */
  use(kind) {
    if (!STORAGE_KINDS.includes(kind)) {
      throw new Error(`StorageRouter.use: unknown kind '${kind}'`);
    }
    _activeKind = kind;
    return _backends[kind];
  },

  /** Currently active backend handle. */
  active() { return _backends[_activeKind]; },

  /** Get a backend handle by kind without switching active. */
  get(kind) {
    if (!STORAGE_KINDS.includes(kind)) return null;
    return _backends[kind];
  },

  /** All available backend handles. */
  list() { return STORAGE_KINDS.map(k => _backends[k]); },

  /** For tests. */
  _backends: () => _backends,
};

if (typeof window !== 'undefined') window.StorageRouter = StorageRouter;
