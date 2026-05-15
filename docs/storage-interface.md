# Storage Interface (V18 O2)

> Источник: [`AUDIT_HOLISTIC.md` строка 124, O2](../AUDIT_HOLISTIC.md). Решение
> для трёх параллельных систем persistence (`localStorage`, `appDataStore`,
> `sqliteStore`) без migration-path в обе стороны.

## TL;DR

Тонкий abstraction-layer **поверх** существующих 3 stores. **НЕ** заменяет их —
адаптирует под единый контракт `StorageInterface` для router + миграций.

```
┌──────────────────────────────────────────────────────────┐
│ Каноничный контракт `StorageInterface` (JSDoc typedef)    │
│   { kind, save, load, clear, keys, ready }                │
└────────────────┬─────────────────────────────────────────┘
                 │ implements
   ┌─────────────┼──────────────┐
   ▼             ▼              ▼
localBackend  appDataBackend  sqliteBackend
   │             │              │
   ▼             ▼              ▼
localStorage  AppDataStore   SQLiteStore (sql.js + IDB)
              (facade LS↔SQLite)
```

## Что такое `StorageInterface`

Файл: [`app/storage/StorageInterface.js`](../app/storage/StorageInterface.js).

JSDoc-typedef:

| метод       | сигнатура                                      | comment                          |
|-------------|------------------------------------------------|----------------------------------|
| `kind`      | `'localStorage' \| 'appDataStore' \| 'sqlite'` | constant                         |
| `save`      | `(key, value) => void \| Promise<void>`        | sync для LS, async для sqlite    |
| `load`      | `(key) => any \| null`                         | `null` для missing/corrupt       |
| `clear`     | `() => void`                                   | стирает только `q2_*` в LS       |
| `keys`      | `() => string[]`                               | список владеемых ключей          |
| `ready`     | `() => Promise<boolean>`                       | для sqlite — lazy-init           |

Также экспортируется:
- `validateStorageInterface(obj) → string[]` — массив missing-методов.
- `STORAGE_KINDS` — frozen `['localStorage', 'appDataStore', 'sqlite']`.

## `StorageRouter` — фасад с pluggable backend

Файл: [`app/storage/StorageRouter.js`](../app/storage/StorageRouter.js).

```js
import { StorageRouter } from './app/storage/StorageRouter.js';

// Получить handle конкретного backend'а:
const local  = StorageRouter.get('localStorage');
const sqlite = StorageRouter.get('sqlite');

// Switch active (для будущих consumer'ов router'а):
StorageRouter.use('sqlite');
const active = StorageRouter.active();

// Список всех:
StorageRouter.list().forEach(b => console.log(b.kind));
```

**Важно:** существующее runtime-поведение НЕ изменилось. `Storage.save()` /
`Storage.load()` / `localStorage.setItem(...)` callsites продолжают работать
1:1. Router нужен для (а) migration-функций; (б) future кода, которому
требуется абстрактный backend-handle.

## Backend-to-backend миграции

Файл: [`app/migrations.js`](../app/migrations.js).

Дополнительно к схема-version миграциям (`q2_plan_v2 → q2_plan_v3`),
добавлены 4 функции:

| Функция                            | Направление                       |
|-----------------------------------|-----------------------------------|
| `Migrations.migrateLocalToSqlite` | localStorage → SQLite             |
| `Migrations.migrateSqliteToLocal` | SQLite → localStorage             |
| `Migrations.migrateLocalToAppDataStore` | localStorage → AppDataStore facade |
| `Migrations.migrateAppDataStoreToLocal` | AppDataStore → localStorage       |

Все требуют **explicit confirm** через `ConfirmDialog.show` (либо
custom `opts.confirmFn`, либо `opts.skipConfirm: true` для тестов).

```js
const res = await Migrations.migrateLocalToSqlite();
// → { ok: true, rowsCount: 247, alreadyMigrated: false }

const res2 = await Migrations.migrateSqliteToLocal();
// Caller затем вызывает Storage.save() для flush в localStorage.
```

### Контракт-инварианты миграций

1. **Identity-fields сохраняются 1:1** (CLAUDE.md контракт #2):
   `state.employees[].{email, jiraAccountId, bitbucketLogin, confluenceAccountId}`.
   Тест: `tests/unit/storage-interface.test.js` —
   `round-trip preserves identity-fields`.
2. **Mass-mutations через `Reactive.silent`** (CLAUDE.md контракт #1).
   `migrateSqliteToLocal` пишет в `state.rows` через
   `AppDataStore.migrateToLocalStorage` который НЕ оборачивает —
   поэтому caller (UI) обязан flush через `Storage.save()`, а не
   triggering reactive proxy auto-save.
3. **Confirm обязателен**. Без UI и без `confirmFn`/`skipConfirm` функция
   возвращает `{ ok: false, error: 'No confirm UI available' }` —
   silent-apply невозможен.

## Существующие callsites

Не сломаны:
- `dataStore.js` `Storage.save / load / restore / flushNow / clear` —
  публичный V15+ контракт, вызывается 100+ раз.
- `appDataStore.js` `AppDataStore.{mode, getRows, saveRows, migrateFromLocalStorage,
  migrateToLocalStorage, status}`.
- `sqliteStore.js` `SQLiteStore.{init, getRows, saveRows, isReady, exportDump,
  importDump, clearAll, ...}`.

В каждом из 3 файлов добавлен JSDoc-комментарий со ссылкой на
`StorageRouter`/`StorageInterface`, без изменений API.

## Тесты

`tests/unit/storage-interface.test.js` — 21 теста, 6 suites:
1. `validateStorageInterface` — sane/invalid objects.
2. `localStorage` backend — round-trip, `keys()` filtering, `clear()`,
   missing key → null, `ready()`.
3. `sqlite` backend — rows save/load, meta-key save/load, empty `keys()`,
   lazy `ready()`.
4. Migrations `localStorage → sqlite` — preserves identity-fields,
   refuses without confirm UI, cancellable via `confirmFn: ()=>false`.
5. Migrations `sqlite → localStorage` (reverse) — preserves
   identity-fields.
6. Edge cases — `use()` throws on unknown kind, `get()` returns null,
   `list()` returns 3 backends, `active()` defaults to localStorage,
   appDataStore routes rows through facade.
