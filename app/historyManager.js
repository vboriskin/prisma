// @ts-check
'use strict';
/* ============================================================
   HistoryManager — undo/redo via snapshot checkpoints.
   --
   Captures `state` mutations and lets the user step back/forward.
   Up to 45 entries by default; older ones drop off the bottom.

   Public API:
     HistoryManager.checkpoint(label?)
     HistoryManager.undo()
     HistoryManager.redo()
     HistoryManager.clear()
     HistoryManager.syncButtons()      — refresh disabled-state of toolbar btns

   Cross-module deps (kept as window globals to avoid import cycles with App):
     window.HistoryModule  — optional faster snapshot strategy
     RegistryView          — applies row height after restore
     RiskEngine            — recompute risk flags after restore
     Storage               — persist after restore
     App                   — refresh UI after restore
   ============================================================ */

import { state, syncColumnSettings } from '../state.js';
import { Storage } from '../dataStore.js';
import { FilterEngine } from '../filters.js';
import { RiskEngine } from '../riskEngine.js';
import { RowFactory } from '../rowFactory.js';
import { RegistryView } from '../views/registry.js';
import { HistoryLog } from '../historyLog.js';
import { Reactive } from '../reactiveStore.js';

export const HistoryManager = {
  limit: 45,
  undoStack: [],
  redoStack: [],
  _restoring: false,

  _capture() {
    if (window.HistoryModule && typeof window.HistoryModule.buildSnapshot === 'function') {
      return window.HistoryModule.buildSnapshot(state);
    }
    return JSON.parse(JSON.stringify({
      rows: state.rows, employees: state.employees,
      customCols: state.customCols, colOrder: state.colOrder,
      colWidths: state.colWidths, colVisibility: state.colVisibility,
      colLabels: state.colLabels, colTypes: state.colTypes,
      pinnedCols: state.pinnedCols, rowHeight: state.rowHeight,
      sort: state.sort, lastClickedRowId: state.lastClickedRowId,
      epicDeps: state.epicDeps, _idCounter: state._idCounter,
      _dataVersion: state._dataVersion,
      // V15 (audit#1, system H3): include plan-lock and edit-mode in
      // history snapshots so undo correctly reverts those V14 toggles.
      planLocked: state.planLocked,
      ganttEditMode: state.ganttEditMode,
    }));
  },

  _fingerprint(snapshot) {
    if (window.HistoryModule && typeof window.HistoryModule.fingerprint === 'function') {
      return window.HistoryModule.fingerprint(snapshot);
    }
    const payload = JSON.stringify(snapshot);
    return payload.length + ':' + payload.slice(0, 180);
  },

  checkpoint(label='edit') {
    if (HistoryManager._restoring) return;
    const snapshot = HistoryManager._capture();
    const fp = HistoryManager._fingerprint(snapshot);
    const prev = HistoryManager.undoStack[HistoryManager.undoStack.length - 1];
    if (prev && prev.fp === fp) return;
    HistoryManager.undoStack.push({ label, fp, snapshot });
    if (HistoryManager.undoStack.length > HistoryManager.limit) HistoryManager.undoStack.shift();
    HistoryManager.redoStack = [];
    HistoryManager.syncButtons();
    // Audit log: every undoable mutation lands here. Skip noisy auto-restore checkpoints.
    if (label && label !== 'edit') {
      try { HistoryLog.data('checkpoint', label, { source: 'mutation' }); } catch(_) {}
    }
  },

  _apply(snapshot) {
    HistoryManager._restoring = true;
    try {
      // The snapshot restoration mutates state heavily — wrap in silent() so
      // the reactive auto-flush doesn't fire mid-restore (we issue ONE
      // explicit refresh at the end). Keeps undo/redo a single-frame op.
      Reactive.silent(() => {
        if (window.HistoryModule && typeof window.HistoryModule.applySnapshot === 'function') {
          window.HistoryModule.applySnapshot(state, snapshot);
        } else {
          Object.assign(state, JSON.parse(JSON.stringify(snapshot)));
        }
        syncColumnSettings();
        RegistryView.applyRowHeight();
        FilterEngine.invalidate();
        state.rows.forEach(r => RowFactory.updateDerived(r));
        RiskEngine.computeAll();
        Storage.save();
      });
      // Explicit single refresh after the silent block.
      window.App?.populateFilterDropdowns?.();
      window.App?.refreshAll?.();
      window.App?.updateTopbarBadge?.();
    } finally {
      HistoryManager._restoring = false;
      HistoryManager.syncButtons();
    }
  },

  undo() {
    if (!HistoryManager.undoStack.length) return;
    const current = HistoryManager._capture();
    const prev = HistoryManager.undoStack.pop();
    HistoryManager.redoStack.push({ label: prev.label, fp: HistoryManager._fingerprint(current), snapshot: current });
    HistoryManager._apply(prev.snapshot);
    window.showToast?.('Отменено');
    HistoryLog.data('undo', `Отменено: ${prev.label}`, { target: prev.label, source: 'undo' });
  },

  redo() {
    if (!HistoryManager.redoStack.length) return;
    const current = HistoryManager._capture();
    const next = HistoryManager.redoStack.pop();
    HistoryManager.undoStack.push({ label: next.label, fp: HistoryManager._fingerprint(current), snapshot: current });
    HistoryManager._apply(next.snapshot);
    window.showToast?.('Повторено');
    HistoryLog.data('redo', `Повторено: ${next.label}`, { target: next.label, source: 'redo' });
  },

  clear() {
    HistoryManager.undoStack = [];
    HistoryManager.redoStack = [];
    HistoryManager.syncButtons();
  },

  syncButtons() {
    // Multiple visible undo/redo buttons exist (topbar + Gantt header). Iterate
    // all clones via class so every disabled-state and tooltip stays in sync.
    const undoBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.btn-undo-clone, #btn-undo'));
    const redoBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.btn-redo-clone, #btn-redo'));
    const undoTitle = HistoryManager.undoStack.length
      ? `Отменить (${HistoryManager.undoStack[HistoryManager.undoStack.length - 1].label})` : 'Отменить';
    const redoTitle = HistoryManager.redoStack.length
      ? `Повторить (${HistoryManager.redoStack[HistoryManager.redoStack.length - 1].label})` : 'Повторить';
    undoBtns.forEach(btn => { btn.disabled = !HistoryManager.undoStack.length; btn.title = undoTitle; });
    redoBtns.forEach(btn => { btn.disabled = !HistoryManager.redoStack.length; btn.title = redoTitle; });
  },
};

if (typeof window !== 'undefined') window.HistoryManager = HistoryManager;
