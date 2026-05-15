'use strict';
/* ============================================================
   app/storage/StorageInterface.js — V18 O2 (AUDIT_HOLISTIC O2)
   --
   Единый interface-контракт для всех persistence-backends.
   Это JSDoc-only "интерфейс" (ES-modules не имеют real interfaces),
   но typedef ниже используется в `@implements` тегах файлов
   `dataStore.js` / `appDataStore.js` / `sqliteStore.js`.

   ВАЖНО:
   - Это thin abstraction поверх 3 уже существующих stores —
     dataStore.Storage (localStorage), AppDataStore (facade),
     SQLiteStore (SQL.js WASM).
   - НЕ заменяет существующие APIs. Не ломает контракт `Storage.save()`.
     Это slot-in router для UI/migration кода.
   - Все методы либо sync (для localStorage path), либо возвращают
     Promise (для SQLite). Backend само объявляет `kind`.

   Контракт-кратко:
     save(key, value)  — записать произвольный сериализуемый объект
     load(key)         — прочитать (null если нет)
     clear()           — стереть все ключи backend'а
     keys()            — массив всех ключей
     kind              — 'localStorage' | 'appDataStore' | 'sqlite'
     ready()           — Promise<boolean> — ready-to-use?
   ============================================================ */

/**
 * @typedef {'localStorage'|'appDataStore'|'sqlite'} StorageBackendKind
 */

/**
 * @typedef {Object} StorageInterface
 * @property {StorageBackendKind} kind — what backend this is
 * @property {(key:string, value:any)=>void|Promise<void>} save
 *   Persist arbitrary serializable value under `key`. Sync for
 *   localStorage path; may be async for sqlite/idb backends. Callers
 *   that need synchronous semantics use the `Storage.save()` legacy
 *   path on `dataStore.js` (which writes STORAGE_KEY directly).
 * @property {(key:string)=>any|null|Promise<any|null>} load
 *   Read previously-saved value. Returns `null` if missing or corrupt.
 * @property {()=>void|Promise<void>} clear
 *   Erase all keys owned by this backend.
 * @property {()=>string[]|Promise<string[]>} keys
 *   List all keys owned by this backend.
 * @property {()=>Promise<boolean>} ready
 *   Resolve `true` when the backend is initialised and usable.
 *   For localStorage this is always immediate; for sqlite it waits
 *   on `SQLiteStore.init()`.
 */

/**
 * Утилита: проверить что `obj` соответствует StorageInterface.
 * Не throws — возвращает массив missing-методов (или [] если ok).
 * Используется в тестах и в StorageRouter при регистрации backend'а.
 *
 * @param {any} obj
 * @returns {string[]}
 */
export function validateStorageInterface(obj) {
  const REQUIRED = ['save', 'load', 'clear', 'keys', 'ready'];
  const missing = [];
  if (!obj || typeof obj !== 'object') return ['<not-an-object>'];
  for (const m of REQUIRED) {
    if (typeof obj[m] !== 'function') missing.push(m);
  }
  if (typeof obj.kind !== 'string') missing.push('kind');
  return missing;
}

/**
 * Известные kinds (зеркало typedef выше — runtime check).
 */
export const STORAGE_KINDS = Object.freeze(['localStorage', 'appDataStore', 'sqlite']);

if (typeof window !== 'undefined') {
  window.StorageInterface = { validateStorageInterface, STORAGE_KINDS };
}
