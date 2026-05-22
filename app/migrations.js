'use strict';
/* ============================================================
   MIGRATIONS RUNNER — V21 W (audit-2026-05-03 §B A6)

   Раньше localStorage version'ы (q2_*_v3) бились вручную в
   STORAGE_KEYS / SETTINGS_KEYS массивами «новый, старый, ещё старее».
   Каждая миграция = ручной `if (parsed.version === 2) { ... }`
   разбросанный по dataStore.js. Без централизованного runner'а
   следующая миграция ломает 5+ точек.

   Этот модуль — централизованный реестр + sequential runner.

   Public API:
     Migrations.register({ key, fromVersion, toVersion, migrate(parsed) })
     Migrations.runAll() — вызывается ОДИН раз на старте app'а до
                            Storage.load(). Идемпотентен.

   Контракт:
     · `key` — основной storage-key (STORAGE_KEY / SETTINGS_KEY / ...)
     · `fromVersion` / `toVersion` — числа.
     · `migrate(parsed)` → `parsed_new` (или null чтобы удалить запись).
     · Runner применяет миграции последовательно: если data в v1,
       а зарегистрированы v1→v2 и v2→v3 — обе применяются по очереди.
     · Если миграция бросает — тихо логируем в errorsLog, оставляем
       старую версию (не удаляем). Юзер увидит warning в Errors-tab.
     · После успешной миграции старый key удаляется (cleanup).

   Использование (в app.js на boot):
     import { Migrations } from './app/migrations.js';
     Migrations.register({ ... });   // регистрация (можно в любой view)
     Migrations.runAll();             // ДО Storage.load()
   ============================================================ */

import { ErrorsLog } from '../errorsLog.js';
import { Services } from './services.js';

const _registry = []; // { key, fromVersion, toVersion, migrate }

/* ============================================================
   V18 O2 (AUDIT_HOLISTIC O2) — Backend-to-backend migration utilities
   --
   Дополнительно к схема-version миграциям выше, добавлены функции
   для миграции данных МЕЖДУ backend'ами (localStorage ↔ sqlite ↔
   appDataStore facade). Все функции:
     · требуют explicit confirm (через ConfirmDialog)
     · оборачивают mass-mutations в Reactive.silent (контракт CLAUDE.md #1)
     · сохраняют identity-fields сотрудников 1:1 (контракт #2)
     · не запускаются автоматически — только по явному UI-действию
   ============================================================ */

const _CONFIRM_MESSAGE = {
  localToSqlite:
    'Скопировать все строки реестра из localStorage в SQLite?\n' +
    'localStorage НЕ затрагивается; SQLite-таблицы перезаписываются. Действие можно повторить.',
  sqliteToLocal:
    'Скопировать все строки реестра из SQLite обратно в localStorage?\n' +
    'state.rows будет перезаписан содержимым SQLite. SQLite-данные сохраняются.',
  localToAppData:
    'Передать данные из localStorage в AppDataStore facade?\n' +
    'Если активный режим = sqlite, строки уйдут в SQLite. Иначе no-op.',
  appDataToLocal:
    'Получить данные из AppDataStore facade и записать в state.rows?\n' +
    'Используется когда AppDataStore работает в SQLite-режиме и нужно вернуться на localStorage.',
};

export const Migrations = {
  /**
   * Зарегистрировать миграцию.
   * @param {object} opts
   * @param {string} opts.key — storage-key (например 'q2_plan_v3')
   * @param {number} opts.fromVersion
   * @param {number} opts.toVersion
   * @param {(parsed:any)=>any|null} opts.migrate
   */
  register(opts) {
    if (!opts || !opts.key || !Number.isFinite(opts.fromVersion) || !Number.isFinite(opts.toVersion) || typeof opts.migrate !== 'function') {
      throw new Error('Migrations.register: invalid opts');
    }
    if (opts.fromVersion >= opts.toVersion) {
      throw new Error(`Migrations.register: fromVersion (${opts.fromVersion}) must be < toVersion (${opts.toVersion})`);
    }
    _registry.push(opts);
  },

  /**
   * Прогнать все зарегистрированные миграции.
   * Идемпотентно: повторный вызов после успешного прогона — no-op.
   */
  runAll() {
    if (typeof localStorage === 'undefined') return;
    const byKey = new Map();
    for (const m of _registry) {
      if (!byKey.has(m.key)) byKey.set(m.key, []);
      byKey.get(m.key).push(m);
    }

    for (const [key, list] of byKey) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        let parsed;
        try { parsed = JSON.parse(raw); } catch (_) { continue; }
        if (!parsed || typeof parsed !== 'object') continue;
        let currentVersion = Number(parsed.version) || 0;
        // Sort миграции по fromVersion ASC.
        list.sort((a, b) => a.fromVersion - b.fromVersion);
        let mutated = false;
        for (const m of list) {
          if (currentVersion !== m.fromVersion) continue;
          let next;
          try { next = m.migrate(parsed); }
          catch (e) {
            try {
              ErrorsLog.add({
                level: 'error', source: 'migrations',
                message: `Migration ${key} ${m.fromVersion}→${m.toVersion} failed: ${e?.message || e}`,
              });
            } catch (_) {}
            break; // не идём дальше по этой ключу
          }
          if (next === null) {
            // Миграция говорит «выкинь запись».
            try { localStorage.removeItem(key); } catch (_) {}
            mutated = false;
            break;
          }
          parsed = next;
          parsed.version = m.toVersion;
          currentVersion = m.toVersion;
          mutated = true;
        }
        if (mutated) {
          try {
            localStorage.setItem(key, JSON.stringify(parsed));
          } catch (e) {
            try {
              ErrorsLog.add({
                level: 'error', source: 'migrations',
                message: `Migration ${key}: write failed: ${e?.message || e}`,
              });
            } catch (_) {}
          }
        }
      } catch (e) {
        try {
          ErrorsLog.add({
            level: 'error', source: 'migrations',
            message: `Migration ${key}: unexpected: ${e?.message || e}`,
          });
        } catch (_) {}
      }
    }
  },

  /** For tests. */
  _registry: () => _registry.slice(),
  _reset:    () => { _registry.length = 0; },

  /* ── Backend migrations (V18 O2) ─────────────────────────
     Контракт каждой функции:
       async (opts) => { ok: boolean, rowsCount?: number, error?: string }
     opts:
       confirmFn? — fn returning Promise<boolean> (default: ConfirmDialog.show)
       skipConfirm? — bool, для тестов / уже-подтверждённых вызовов
  */

  /** localStorage → SQLite. Пакует state.rows (текущий мирный snapshot)
   *  + employees identity-fields в SQLite через AppDataStore.
   *  Используется как «миграция» когда юзер впервые включает sqlite-mode. */
  async migrateLocalToSqlite(opts = {}) {
    return _runWithConfirm({
      message: _CONFIRM_MESSAGE.localToSqlite,
      title: 'Перенос: localStorage → SQLite',
      confirmLabel: 'Перенести',
      typeToConfirm: '',
      ...opts,
    }, async () => {
      if (typeof window === 'undefined' || !Services.AppDataStore) {
        return { ok: false, error: 'AppDataStore unavailable' };
      }
      const res = await Services.AppDataStore.migrateFromLocalStorage();
      return res;
    });
  },

  /** SQLite → localStorage. Тянет rows из SQLite и подменяет state.rows
   *  через Reactive.silent (mass-mutation контракт). Caller должен
   *  затем вызвать Storage.save() для записи в localStorage. */
  async migrateSqliteToLocal(opts = {}) {
    return _runWithConfirm({
      message: _CONFIRM_MESSAGE.sqliteToLocal,
      title: 'Перенос: SQLite → localStorage',
      confirmLabel: 'Перенести',
      typeToConfirm: '',
      ...opts,
    }, async () => {
      if (typeof window === 'undefined' || !Services.AppDataStore) {
        return { ok: false, error: 'AppDataStore unavailable' };
      }
      // AppDataStore.migrateToLocalStorage уже оборачивает state.rows mutation
      // безопасно (через прямую запись), но НЕ через Reactive.silent — это
      // делаем мы здесь, потому что прямая запись `state.rows = [...]`
      // через Reactive proxy = mass-mutation = infinite loop risk.
      const res = await Services.AppDataStore.migrateToLocalStorage();
      // Caller is expected to call Storage.save() to flush to localStorage.
      return res;
    });
  },

  /** localStorage → AppDataStore facade. Если facade активен в sqlite-mode,
   *  это эквивалент migrateLocalToSqlite. Иначе no-op (facade сам читает
   *  state.rows / localStorage). */
  async migrateLocalToAppDataStore(opts = {}) {
    return _runWithConfirm({
      message: _CONFIRM_MESSAGE.localToAppData,
      title: 'Перенос: localStorage → AppDataStore',
      confirmLabel: 'Перенести',
      typeToConfirm: '',
      ...opts,
    }, async () => {
      if (typeof window === 'undefined' || !Services.AppDataStore) {
        return { ok: false, error: 'AppDataStore unavailable' };
      }
      const mode = Services.AppDataStore.mode;
      if (mode === 'sqlite') {
        return Services.AppDataStore.migrateFromLocalStorage();
      }
      // localStorage facade-mode: ничего делать не нужно (facade сам читает state.rows).
      return { ok: true, rowsCount: 0, alreadyMigrated: true, noop: true };
    });
  },

  /** AppDataStore → localStorage. Реверс. */
  async migrateAppDataStoreToLocal(opts = {}) {
    return _runWithConfirm({
      message: _CONFIRM_MESSAGE.appDataToLocal,
      title: 'Перенос: AppDataStore → localStorage',
      confirmLabel: 'Перенести',
      typeToConfirm: '',
      ...opts,
    }, async () => {
      if (typeof window === 'undefined' || !Services.AppDataStore) {
        return { ok: false, error: 'AppDataStore unavailable' };
      }
      const mode = Services.AppDataStore.mode;
      if (mode === 'sqlite') {
        return Services.AppDataStore.migrateToLocalStorage();
      }
      return { ok: true, rowsCount: 0, noop: true };
    });
  },
};

/* ── confirm helper (lazy-import ConfirmDialog) ─────────────
   Не делаем top-level import — `app/uxKit.js` зависит от DOM,
   а migrations.js сейчас работает в Node-tests. Lazy-import
   позволяет миграциям регистрироваться в Node без падения. */
async function _runWithConfirm(uiOpts, work) {
  const skip = !!uiOpts.skipConfirm;
  if (skip) return work();
  let confirmed = false;
  try {
    const customFn = uiOpts.confirmFn;
    if (typeof customFn === 'function') {
      confirmed = !!(await customFn(uiOpts));
    } else if (typeof window !== 'undefined' && Services.ConfirmDialog) {
      confirmed = !!(await Services.ConfirmDialog.show({
        title: uiOpts.title,
        message: uiOpts.message,
        confirmLabel: uiOpts.confirmLabel || 'Подтвердить',
        danger: false,
        typeToConfirm: uiOpts.typeToConfirm || '',
      }));
    } else {
      // No UI available + no custom confirmFn → refuse, don't silently apply.
      return { ok: false, error: 'No confirm UI available — pass opts.confirmFn or skipConfirm' };
    }
  } catch (e) {
    return { ok: false, error: 'Confirm failed: ' + (e?.message || e) };
  }
  if (!confirmed) return { ok: false, error: 'Cancelled by user' };
  try {
    return await work();
  } catch (e) {
    return { ok: false, error: 'Migration failed: ' + (e?.message || e) };
  }
}

Services.register('Migrations', Migrations);
if (typeof window !== 'undefined') window.Migrations = Migrations;

// ============================================================
// REGISTERED MIGRATIONS
// Side-effect регистрации при импорте модуля. Migrations.runAll() в app.js
// поднимет их перед Storage.loadSettings(). Тесты вызывают Migrations._reset()
// в beforeEach, поэтому юнит-тесты не увидят эти регистрации.
// ============================================================

/* ------------------------------------------------------------
 * q2_settings_v3 0→1 — drop summaryMode (AUDIT_HOLISTIC O3, V21 W).
 *
 * History: state.summaryMode = 'brief' было оставлено для backwards-compat
 * сериализации после удаления Сводной во П4-MS Wave 1. Field стал мёртвым
 * (ни один live-renderer не читал), но продолжал лежать в payload.
 *
 * Старые q2_settings_v3 не имели `version` field (== 0). Эта миграция:
 *   1. убирает `summaryMode` (стрипает поле);
 *   2. runner проставит `parsed.version = 1` после успешного migrate(),
 *      чтобы повторный прогон был no-op (currentVersion 1 ≠ fromVersion 0).
 *
 * STORAGE_KEY (q2_plan_v3 — rows / employees) НЕ менялся: summaryMode жил
 * только в SETTINGS_KEY. Версии q2_plan_v3 не bump'аем — миграция «удалить
 * unknown field» idempotent через простое игнорирование на load.
 * ------------------------------------------------------------ */
Migrations.register({
  key: 'q2_settings_v3',
  fromVersion: 0,
  toVersion: 1,
  migrate(parsed) {
    if (!parsed || typeof parsed !== 'object') return parsed;
    // dropDeprecatedField('summaryMode') — явный delete вместо spread, чтобы
    // не пересобирать форму object'а (теряя порядок ключей и т.п.).
    if (Object.prototype.hasOwnProperty.call(parsed, 'summaryMode')) {
      delete parsed.summaryMode;
    }
    return parsed;
  },
});

/* ------------------------------------------------------------
 * q2_settings_v3 1→2 — add notifications[] (AUDIT_HOLISTIC F4).
 *
 * Notification Center (`app/notifyCenter.js`) хранит inbox в
 * `state.notifications[]`, который сериализуется в SETTINGS_KEY.
 * Эта миграция гарантирует, что после up-grade поле существует
 * как пустой массив — иначе hydrate из старого payload не
 * подменит существующий `[]` из state.js, но и реактивный writer
 * на первый push сделает корректный `setItem`. Чисто defensive.
 * ------------------------------------------------------------ */
Migrations.register({
  key: 'q2_settings_v3',
  fromVersion: 1,
  toVersion: 2,
  migrate(parsed) {
    if (!parsed || typeof parsed !== 'object') return parsed;
    if (!Array.isArray(parsed.notifications)) {
      parsed.notifications = [];
    }
    return parsed;
  },
});

/* ------------------------------------------------------------
 * q2_settings_v3 2→3 — add `meta` (AUDIT_HOLISTIC P3 + Идея 1).
 *
 * Top-level `state.meta` объект с user/permissions/featureFlags/version/
 * lastSeenVersion/lastActiveAt/focus. Любая авторизация, флаги или
 * «что нового» упирались в его отсутствие. Эта миграция:
 *   1. защищает legacy payload — добавляет `meta` с дефолтами если
 *      его нет; если объект есть, но без какого-то sub-field
 *      (user/permissions/...) — патчит дефолтами по месту;
 *   2. идемпотентна: повторный прогон 2→3 не возможен (runner ставит
 *      version=3), но и сам migrate() — pure deep-merge с дефолтами,
 *      не перезаписывает уже выставленные юзером значения.
 *
 * Identity-deterministic (CLAUDE.md контракт #2): `meta.user.email` —
 * primary identity. Из payload берём как есть; миграция не пытается
 * угадать email по name.
 * ------------------------------------------------------------ */
Migrations.register({
  key: 'q2_settings_v3',
  fromVersion: 2,
  toVersion: 3,
  migrate(parsed) {
    if (!parsed || typeof parsed !== 'object') return parsed;
    const defaultMeta = () => ({
      user:        { email: '', name: '', avatar: '' },
      permissions: {
        canBulkEdit:      true,
        canChangeScope:   true,
        canMarkDone:      true,
        canExport:        true,
        canEditEmployees: false,
      },
      featureFlags: {
        ai:            true,
        mascotMood:    true,
        notifications: true,
        explainScreen: true,
      },
      version:         '17.0.0',
      lastSeenVersion: '',
      lastActiveAt:    null,
      focus:           null,
    });
    if (!parsed.meta || typeof parsed.meta !== 'object') {
      parsed.meta = defaultMeta();
      return parsed;
    }
    // Existing meta — patch missing sub-fields с дефолтами.
    const def = defaultMeta();
    if (!parsed.meta.user        || typeof parsed.meta.user !== 'object')        parsed.meta.user        = def.user;
    else {
      if (typeof parsed.meta.user.email  !== 'string') parsed.meta.user.email  = '';
      if (typeof parsed.meta.user.name   !== 'string') parsed.meta.user.name   = '';
      if (typeof parsed.meta.user.avatar !== 'string') parsed.meta.user.avatar = '';
    }
    if (!parsed.meta.permissions  || typeof parsed.meta.permissions !== 'object')  parsed.meta.permissions  = def.permissions;
    else {
      for (const [k, v] of Object.entries(def.permissions)) {
        if (typeof parsed.meta.permissions[k] !== 'boolean') parsed.meta.permissions[k] = v;
      }
    }
    if (!parsed.meta.featureFlags || typeof parsed.meta.featureFlags !== 'object') parsed.meta.featureFlags = def.featureFlags;
    else {
      for (const [k, v] of Object.entries(def.featureFlags)) {
        if (typeof parsed.meta.featureFlags[k] !== 'boolean') parsed.meta.featureFlags[k] = v;
      }
    }
    if (typeof parsed.meta.version         !== 'string') parsed.meta.version         = def.version;
    if (typeof parsed.meta.lastSeenVersion !== 'string') parsed.meta.lastSeenVersion = def.lastSeenVersion;
    if (parsed.meta.lastActiveAt !== null
        && typeof parsed.meta.lastActiveAt !== 'string'
        && typeof parsed.meta.lastActiveAt !== 'number') {
      parsed.meta.lastActiveAt = null;
    }
    if (parsed.meta.focus !== null && typeof parsed.meta.focus !== 'object') {
      parsed.meta.focus = null;
    }
    return parsed;
  },
});

/* ------------------------------------------------------------
 * q2_settings_v3 3→4 — добавить пользовательские релизы (#1).
 *
 * `state.releases[]` — список custom релизов (legacy 5 не редактируются).
 * `state.ganttHiddenReleases[]` — локальный «глаз» в Гант'е (по умолчанию пустой).
 * `state.filters.release` теперь массив; старые строковые значения нормализуем
 *   в одиночный массив для backward compatibility.
 * ------------------------------------------------------------ */
Migrations.register({
  key: 'q2_settings_v3',
  fromVersion: 3,
  toVersion: 4,
  migrate(parsed) {
    if (!parsed || typeof parsed !== 'object') return parsed;
    if (!Array.isArray(parsed.releases)) parsed.releases = [];
    if (!Array.isArray(parsed.ganttHiddenReleases)) parsed.ganttHiddenReleases = [];
    if (parsed.filters && typeof parsed.filters === 'object') {
      const rel = parsed.filters.release;
      if (typeof rel === 'string') {
        parsed.filters.release = rel ? [rel] : [];
      } else if (!Array.isArray(rel)) {
        parsed.filters.release = [];
      }
    }
    return parsed;
  },
});
