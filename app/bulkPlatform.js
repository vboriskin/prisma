'use strict';
/* ============================================================
   BULK PLATFORM — AUDIT_HOLISTIC F5
   --
   Единая платформа для bulk-операций. Сейчас в проекте два разных API:
     · Реестр       — applyBulkAction(rowIds, type, payload)  (dataStore.js)
     · Гигиена/Сканнер — собственные path'ы внутри teamScanner2*
     · Action Layer — обёртка над applyBulkAction
     · AI-batches   — chatActions.js → window.applyBulkAction
   Эта платформа объединяет их в один контракт с preview / dryRun /
   apply / undo / audit-trail.

   Сценарий «починка плана перед planning'ом» (AUDIT_HOLISTIC §5.3):
     preview → пользователь видит diff до apply
     dryRun  → симуляция (зачем — стоит ли вообще)
     apply   → выполняет, возвращает undoToken
     undo    → откат по structuredClone-snapshot

   ─────────────────────────────────────────────────────────────
   API
   ─────────────────────────────────────────────────────────────
   BulkPlatform.preview(operation)
       → { targets, before, after, conflicts, warnings, summary }
       НЕ модифицирует state. Используется bulk-panel'ом для UI-diff.

   BulkPlatform.dryRun(operation)
       → { ok, hypothetical: { applied, skipped }, sideEffects, warnings }
       Полная симуляция: проходит весь apply-pipeline на КОПИИ rows и
       возвращает «как бы выглядел state», + перечень side-effects
       (`risk.recompute`, `derived.update` и т.п.) — чтобы caller
       понимал стоимость операции.

   BulkPlatform.apply(operation, opts?)
       → { ok, applied, skipped, undoToken, auditId }
       Выполняет mass-mutation в Reactive.silent. Снимает snapshot до
       мутации (structuredClone, не JSON-roundtrip — сохраняет Date/Map/Set,
       HOLISTIC паттерн 6). Snapshot хранится 30 минут или до следующего
       apply (whichever first).
       opts:
         { skipAudit?, skipUndo?, source?, label? }

   BulkPlatform.undo(undoToken)
       → { ok, restored } | { ok:false, reason }
       Восстанавливает state.rows из snapshot'а 1-в-1.

   BulkPlatform.audit()
       → Array<{ ts, kind, source, targetCount, undoToken, success, label }>
       Ring buffer 50 последних apply.

   ─────────────────────────────────────────────────────────────
   Operation shape
   ─────────────────────────────────────────────────────────────
       {
         kind: 'set-field' | 'mark-done' | 'reassign' | 'change-scope' |
               'rollover-release' | 'archive' | 'custom',
         targets: [
           { rowId },                           // identity для row
           { employeeEmail }, { jiraAccountId } // identity для employee
         ],
         payload: { field?, value?, ... },
         source: 'registry' | 'hygiene' | 'actionLayer' | 'ai-batch',
         label?: string                        // human-friendly для audit
       }

   ─────────────────────────────────────────────────────────────
   Контракты CLAUDE.md
   ─────────────────────────────────────────────────────────────
   1. Reactive.silent(...) для apply (mass mutation) — обязательно,
      иначе на 500 строках Storage.save+refreshAll триггерится 500 раз.
   2. НЕ вызываем Storage.save() напрямую — мутация state триггерит
      auto-save через Reactive subscriber в app.js.
   3. Identity-deterministic (#2) — apply ищет row по
      `rowId` или employee по `email|jiraAccountId|bitbucketLogin|
      confluenceAccountId`. Никаких fuzzy-name-matches.

   ─────────────────────────────────────────────────────────────
   Migration plan
   ─────────────────────────────────────────────────────────────
   Старые callsites не удаляем — `applyBulkAction(...)` в dataStore.js
   продолжает работать. BulkPlatform.apply имеет адаптер `_legacyApply`,
   который под капотом вызывает existing `applyBulkAction`. Phase-2
   мигрирует callsites на BulkPlatform по очереди.
   ============================================================ */

import { state }       from '../state.js';
import { Reactive }    from '../reactiveStore.js';
import { Permissions } from './permissions.js';
import { Services }    from './services.js';

// ───────────────────────────────────────────────────────────
// Конфиг
// ───────────────────────────────────────────────────────────
const SNAPSHOT_TTL_MS = 30 * 60 * 1000;   // 30 минут
const AUDIT_LIMIT     = 50;
const VALID_KINDS = new Set([
  'set-field', 'mark-done', 'reassign', 'change-scope',
  'rollover-release', 'archive', 'custom',
]);
const VALID_SOURCES = new Set([
  'registry', 'hygiene', 'actionLayer', 'ai-batch', 'unknown',
]);

// Map BulkPlatform `kind` → legacy applyBulkAction `actionType`.
// Legacy сохраняем как fallback path: пока не все callsites мигрированы,
// BulkPlatform может делегировать в существующий applyBulkAction.
const KIND_TO_LEGACY = {
  'set-field':         (p) => mapSetField(p),     // динамически от payload.field
  'mark-done':         (p) => p?.value === false ? 'unmark_done' : 'mark_done',
  'reassign':          () => 'set_assignee',
  'change-scope':      () => 'set_scope',
  'rollover-release':  () => 'assign_release',
  'archive':           () => null,                // нет legacy эквивалента
  'custom':            () => null,
};
function mapSetField(payload) {
  const f = payload?.field;
  if (f === 'priority')  return 'set_priority';
  if (f === 'comment')   return 'set_comment';
  if (f === 'doneDate')  return 'set_done_date';
  if (f === 'businessValue') return 'set_business_value';
  if (f === 'review')    return payload?.value === false ? 'unflag_review' : 'flag_review';
  return null;                                    // unknown → custom path
}

// ───────────────────────────────────────────────────────────
// Внутреннее состояние модуля
// ───────────────────────────────────────────────────────────
/** @typedef {{ token: string, ts: number, snapshot: any, expiresAt: number, label: string }} Snapshot */
/** Active snapshots keyed by undoToken. */
const _snapshots = /** @type {Map<string, Snapshot>} */ (new Map());

let _tokenCounter = 0;
function _nextToken() {
  _tokenCounter += 1;
  return `bp-${Date.now().toString(36)}-${_tokenCounter.toString(36)}`;
}

// `Date.now` injection — для тестов с фейковыми часами.
let _now = () => Date.now();
function _setClock(fn) { _now = (typeof fn === 'function') ? fn : (() => Date.now()); }

// ───────────────────────────────────────────────────────────
// Helpers — идентификация, snapshot, GC
// ───────────────────────────────────────────────────────────
function _resolveRowTargets(targets) {
  // Identity-deterministic: rowId — primary key. Возвращаем актуальные
  // ссылки на row из state.rows (а не копии).
  if (!Array.isArray(targets)) return [];
  const byId = new Map();
  for (const t of targets) {
    if (!t) continue;
    const id = t.rowId ?? t.id;
    if (id != null) byId.set(id, true);
  }
  if (!byId.size) return [];
  return state.rows.filter(r => r && byId.has(r.id));
}

function _resolveEmployeeTargets(targets) {
  // Identity-deterministic для employees: email | jiraAccountId |
  // bitbucketLogin | confluenceAccountId. CLAUDE.md контракт #2.
  if (!Array.isArray(targets)) return [];
  const emails  = new Set();
  const jiraIds = new Set();
  const bbLogins = new Set();
  const cfIds   = new Set();
  for (const t of targets) {
    if (!t) continue;
    if (t.employeeEmail)        emails.add(String(t.employeeEmail).toLowerCase());
    if (t.email)                emails.add(String(t.email).toLowerCase());
    if (t.jiraAccountId)        jiraIds.add(String(t.jiraAccountId).toLowerCase());
    if (t.bitbucketLogin)       bbLogins.add(String(t.bitbucketLogin).toLowerCase());
    if (t.confluenceAccountId)  cfIds.add(String(t.confluenceAccountId).toLowerCase());
  }
  if (!emails.size && !jiraIds.size && !bbLogins.size && !cfIds.size) return [];
  const emps = Array.isArray(state.employees) ? state.employees : [];
  return emps.filter(e => {
    if (!e) return false;
    const em = String(e.email || '').toLowerCase();
    const ji = String(e.jiraAccountId || '').toLowerCase();
    const bb = String(e.bitbucketLogin || '').toLowerCase();
    const cf = String(e.confluenceAccountId || '').toLowerCase();
    return (em && emails.has(em)) || (ji && jiraIds.has(ji))
        || (bb && bbLogins.has(bb)) || (cf && cfIds.has(cf));
  });
}

function _cloneRows(rows) {
  // structuredClone — сохраняет Date / Map / Set (HOLISTIC паттерн 6,
  // CLAUDE.md «JSON-roundtrip теряет non-JSON types»).
  // Fallback на JSON-roundtrip только если structuredClone недоступен
  // (старые runtimes — но в Node 18+ и Chrome 98+ есть).
  if (typeof structuredClone === 'function') {
    try { return structuredClone(rows); } catch (_) { /* fall through */ }
  }
  // Last-resort fallback. Документировано: предупреждаем в audit.
  return JSON.parse(JSON.stringify(rows));
}

function _gcExpiredSnapshots() {
  const now = _now();
  for (const [token, snap] of _snapshots) {
    if (snap.expiresAt <= now) _snapshots.delete(token);
  }
}

function _evictOldestIfNeeded() {
  // Защита от утечки: если 100+ apply без undo, держим только 20.
  const MAX_LIVE_SNAPSHOTS = 20;
  if (_snapshots.size <= MAX_LIVE_SNAPSHOTS) return;
  const sorted = [..._snapshots.entries()].sort((a, b) => a[1].ts - b[1].ts);
  const toRemove = sorted.slice(0, sorted.length - MAX_LIVE_SNAPSHOTS);
  for (const [token] of toRemove) _snapshots.delete(token);
}

// ───────────────────────────────────────────────────────────
// Audit log
// ───────────────────────────────────────────────────────────
function _ensureActionLog() {
  if (!Array.isArray(state.actionLog)) {
    Reactive.silent(() => { state.actionLog = []; });
  }
}

function _writeAudit(entry) {
  _ensureActionLog();
  Reactive.silent(() => {
    state.actionLog.unshift(entry);
    // Cap: используем 1000 как сейчас в dataStore.js (см. F4 fix), чтобы
    // не конфликтовать с существующим writer'ом.
    if (state.actionLog.length > 1000) state.actionLog.length = 1000;
  });
}

// ───────────────────────────────────────────────────────────
// Validation
// ───────────────────────────────────────────────────────────
function _validateOperation(op) {
  if (!op || typeof op !== 'object') {
    return { ok: false, reason: 'operation is not an object' };
  }
  if (!VALID_KINDS.has(op.kind)) {
    return { ok: false, reason: `unknown kind: ${op.kind}` };
  }
  if (!Array.isArray(op.targets)) {
    return { ok: false, reason: 'targets must be an array' };
  }
  if (op.source != null && !VALID_SOURCES.has(op.source)) {
    return { ok: false, reason: `unknown source: ${op.source}` };
  }
  return { ok: true };
}

// ───────────────────────────────────────────────────────────
// Field application — pure helpers
// ───────────────────────────────────────────────────────────
/**
 * Compute the diff between current row and what would change.
 * Returns a partial row with только changed fields.
 */
function _computeAfter(row, op) {
  const after = {};
  const p = op.payload || {};
  switch (op.kind) {
    case 'set-field': {
      if (p.field) after[p.field] = p.value;
      break;
    }
    case 'mark-done': {
      const done = p.value !== false;
      after.isDone = done;
      if (done && !row.doneDate) {
        after.doneDate = (typeof p.date === 'string') ? p.date : _todayLocal();
      }
      if (!done) after.doneDate = '';
      break;
    }
    case 'reassign': {
      if (typeof p.assignee === 'string') after.assignee = p.assignee.trim();
      break;
    }
    case 'change-scope': {
      if (typeof p.scope === 'string') after.scopeStatus = p.scope;
      break;
    }
    case 'rollover-release': {
      const rel = p.release;
      const types = Array.isArray(p.types) ? p.types : ['backend'];
      if (rel === '120') after.release120Types = types;
      else if (rel === '121') after.release121Types = types;
      else if (rel === '122') after.release122Types = types;
      else if (rel === 'ot')  after.overtimeTypes = types;
      break;
    }
    case 'archive': {
      after._archived = true;
      break;
    }
    case 'custom': {
      // payload.fields = { f1: v1, f2: v2 }
      if (p.fields && typeof p.fields === 'object') {
        for (const [k, v] of Object.entries(p.fields)) after[k] = v;
      }
      break;
    }
  }
  return after;
}

function _applyAfter(row, after) {
  for (const [k, v] of Object.entries(after)) row[k] = v;
  row.dirty = true;
  row.updatedAt = new Date().toISOString();
}

function _todayLocal() {
  // Локальная дата (см. dataStore.js — Utils.localDateString контракт).
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function _detectConflicts(rows, op) {
  // Простые conflict-checks. Для caller'а — они decide блокировать
  // apply или предупреждать (warnings).
  const warnings = [];
  const conflicts = [];
  if (op.kind === 'mark-done') {
    const alreadyDone = rows.filter(r => r.isDone === (op.payload?.value !== false));
    if (alreadyDone.length === rows.length && rows.length > 0) {
      warnings.push('Все выбранные строки уже в этом состоянии — apply будет no-op');
    }
  }
  if (op.kind === 'rollover-release' && !op.payload?.release) {
    conflicts.push('payload.release не указан');
  }
  if (op.kind === 'reassign' && !String(op.payload?.assignee || '').trim()) {
    conflicts.push('payload.assignee пуст');
  }
  return { conflicts, warnings };
}

function _summary(rows, op) {
  const kindLabel = {
    'set-field':         'Изменить поле',
    'mark-done':         (op.payload?.value === false) ? 'Снять метку «готово»' : 'Отметить как готово',
    'reassign':          'Переназначить',
    'change-scope':      'Сменить scope',
    'rollover-release':  'Перенести релиз',
    'archive':           'Архивировать',
    'custom':            'Custom операция',
  }[op.kind] || op.kind;
  return `${kindLabel}: ${rows.length} строк${rows.length === 1 ? 'а' : (rows.length % 10 === 1 && rows.length !== 11 ? 'а' : '')}`;
}

// ───────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────
export const BulkPlatform = {
  /**
   * Preview the operation. Does NOT mutate state.
   */
  preview(operation) {
    const v = _validateOperation(operation);
    if (!v.ok) {
      return { ok: false, reason: v.reason, targets: [], before: [], after: [], conflicts: [v.reason], warnings: [], summary: '' };
    }
    const rows = _resolveRowTargets(operation.targets);
    const employees = _resolveEmployeeTargets(operation.targets);
    const before = rows.map(r => ({ id: r.id, snapshot: { ...r } }));
    const after = rows.map(r => ({ id: r.id, changes: _computeAfter(r, operation) }));
    const { conflicts, warnings } = _detectConflicts(rows, operation);
    return {
      ok: conflicts.length === 0,
      targets: rows,
      employees,
      before,
      after,
      conflicts,
      warnings,
      summary: _summary(rows, operation),
    };
  },

  /**
   * Dry-run: full simulation on a clone, no state mutation.
   * Returns a hypothetical result snapshot + side-effects log.
   */
  dryRun(operation) {
    const v = _validateOperation(operation);
    if (!v.ok) return { ok: false, reason: v.reason, hypothetical: null, sideEffects: [], warnings: [] };
    const rows = _resolveRowTargets(operation.targets);
    if (!rows.length) {
      return {
        ok: true,
        hypothetical: { applied: 0, skipped: 0, sample: [] },
        sideEffects: ['no targets resolved'],
        warnings: ['Ни одна строка не сматчилась с targets — apply будет no-op'],
      };
    }
    const sideEffects = [];
    let applied = 0; let skipped = 0;
    const sample = [];
    // Симулируем на КОПИЯХ — не трогаем real rows.
    const copies = _cloneRows(rows);
    for (const row of copies) {
      const after = _computeAfter(row, operation);
      if (!Object.keys(after).length) { skipped++; continue; }
      _applyAfter(row, after);
      applied++;
      if (sample.length < 5) sample.push({ id: row.id, after });
      // Side-effects: какие движки caller'у ожидать.
      if (operation.kind === 'rollover-release' || operation.kind === 'change-scope') {
        sideEffects.push('rowFactory.updateDerived');
        sideEffects.push('riskEngine.computeFlags');
      }
      if (operation.kind === 'mark-done') {
        sideEffects.push('progress.recompute');
      }
    }
    return {
      ok: true,
      hypothetical: { applied, skipped, sample },
      sideEffects: [...new Set(sideEffects)],
      warnings: _detectConflicts(rows, operation).warnings,
    };
  },

  /**
   * Apply: mass-mutation on real state inside Reactive.silent(...).
   * Captures snapshot for undo. Writes audit-trail entry.
   */
  apply(operation, opts = {}) {
    const v = _validateOperation(operation);
    if (!v.ok) return { ok: false, reason: v.reason, applied: 0, undoToken: null };
    // AUDIT_HOLISTIC P6 + Идея 1 — example permission gate.
    // Маппим bulk-kind на permission-key из state.meta.permissions:
    //   · mark-done       → canMarkDone
    //   · change-scope    → canChangeScope
    //   · default (любой) → canBulkEdit
    // Default-allow контракт Permissions.can сохраняет совместимость:
    // если permissions matrix не загружен — apply работает как раньше.
    const permKey = (operation.kind === 'mark-done')
      ? 'canMarkDone'
      : (operation.kind === 'change-scope')
        ? 'canChangeScope'
        : 'canBulkEdit';
    if (!opts.skipPermission && !Permissions.can(permKey)) {
      return { ok: false, reason: `permission denied: ${permKey}`, applied: 0, undoToken: null };
    }
    const rows = _resolveRowTargets(operation.targets);
    if (!rows.length) {
      return { ok: false, reason: 'no targets resolved', applied: 0, undoToken: null };
    }
    const { conflicts } = _detectConflicts(rows, operation);
    if (conflicts.length) {
      return { ok: false, reason: conflicts.join('; '), applied: 0, undoToken: null };
    }

    _gcExpiredSnapshots();

    // Snapshot для undo — структурный clone state.rows.
    let undoToken = null;
    if (!opts.skipUndo) {
      undoToken = _nextToken();
      const ts = _now();
      _snapshots.set(undoToken, {
        token: undoToken,
        ts,
        expiresAt: ts + SNAPSHOT_TTL_MS,
        snapshot: _cloneRows(state.rows),
        label: opts.label || operation.label || operation.kind,
      });
      _evictOldestIfNeeded();
    }

    // Mass-mutation в Reactive.silent — иначе на 500 строк × 5 присваиваний
    // = 2500 микро-flush'ей (см. F1 в dataStore.js). Один Storage.save()
    // случится автоматически после выхода из silent при первом следующем
    // дёрганье Proxy — это то поведение, что и в applyBulkAction (через
    // notifyManual или один внешний trigger). Здесь явно дёрнем
    // Reactive.notifyManual в конце, чтобы один debounced save случился.
    let applied = 0; let skipped = 0;
    Reactive.silent(() => {
      for (const row of rows) {
        const after = _computeAfter(row, operation);
        if (!Object.keys(after).length) { skipped++; continue; }
        _applyAfter(row, after);
        applied++;
      }
    });
    // Один внешний trigger: state.rows[i].x уже изменены, но silent не
    // дал debounced flush'у запуститься. Дёргаем notifyManual — subscriber
    // в app.js вызовет Storage.save + App.refreshAll один раз.
    Reactive.notifyManual();

    // Audit
    let auditId = null;
    if (!opts.skipAudit) {
      auditId = `audit-${_now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const auditEntry = {
        id: auditId,
        ts: new Date(_now()).toISOString(),
        kind: operation.kind,
        targetCount: applied,
        skipped,
        source: operation.source || opts.source || 'unknown',
        undoToken,
        success: true,
        label: opts.label || operation.label || _summary(rows, operation),
        // Persistable дополнения (совместимы с existing actionLog shape).
        type: operation.kind,
        count: applied,
        at: new Date(_now()).toISOString(),
      };
      _writeAudit(auditEntry);
    }

    return { ok: true, applied, skipped, undoToken, auditId };
  },

  /**
   * Undo: restore state.rows from snapshot 1-to-1.
   */
  undo(undoToken) {
    if (!undoToken) return { ok: false, reason: 'no undoToken' };
    _gcExpiredSnapshots();
    const snap = _snapshots.get(undoToken);
    if (!snap) return { ok: false, reason: 'snapshot not found or expired' };
    if (snap.expiresAt <= _now()) {
      _snapshots.delete(undoToken);
      return { ok: false, reason: 'snapshot expired' };
    }

    Reactive.silent(() => {
      // Restore: full replace state.rows.
      // Используем _cloneRows ещё раз — чтобы повторный undo (если он
      // допустим) не зависел от той же ссылки.
      state.rows = _cloneRows(snap.snapshot);
    });
    Reactive.notifyManual();

    // Snapshot одноразовый — после успешного undo удаляем.
    _snapshots.delete(undoToken);

    // Audit-entry для undo
    const restoredCount = Array.isArray(state.rows) ? state.rows.length : 0;
    _writeAudit({
      id: `audit-undo-${_now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      ts: new Date(_now()).toISOString(),
      kind: 'undo',
      targetCount: restoredCount,
      source: 'bulkPlatform',
      undoToken,
      success: true,
      label: `Undo: ${snap.label}`,
      type: 'undo',
      count: restoredCount,
      at: new Date(_now()).toISOString(),
    });

    return { ok: true, restored: restoredCount };
  },

  /**
   * Audit log — last 50 entries, BulkPlatform-related.
   */
  audit() {
    if (!Array.isArray(state.actionLog)) return [];
    // Ring buffer view: возвращаем последние AUDIT_LIMIT, фильтруя
    // только BulkPlatform-events (имеют поле undoToken или kind=undo).
    return state.actionLog
      .filter(e => e && (typeof e.undoToken !== 'undefined' || e.kind === 'undo'))
      .slice(0, AUDIT_LIMIT);
  },

  // ───────────────────────────────────────────────────────────
  // Internal — для тестов и migration helpers
  // ───────────────────────────────────────────────────────────
  /** @internal */
  _legacyTypeFor(operation) {
    const fn = KIND_TO_LEGACY[operation.kind];
    return fn ? fn(operation.payload || {}) : null;
  },

  /** @internal — для тестов: подменить часы. */
  _setClock(fn) { _setClock(fn); },

  /** @internal — для тестов: очистить snapshots. */
  _resetForTest() {
    _snapshots.clear();
    _tokenCounter = 0;
    _setClock(null);
  },

  /** @internal — для тестов: количество живых snapshots. */
  _liveSnapshotCount() { return _snapshots.size; },
};

Services.register('BulkPlatform', BulkPlatform);
if (typeof window !== 'undefined') window.BulkPlatform = BulkPlatform;
