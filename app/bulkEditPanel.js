'use strict';
/* ============================================================
   BULK EDIT PANEL — V18.1 P9 extracted from app.js (lines 291-384)
   --
   Per-row checkbox selection in Registry view + bottom panel with
   bulk actions (assign release, set scope, set priority, set assignee,
   mark done, clear release/blocker).

   V17 P9 (audit-2026-05-V17/09-registry-audit.md) добавил:
     - intersect with FilterEngine.getFiltered() в applyFromPanel
       (защита от mutation вслепую когда selected rows скрыты фильтром)
     - unified code-path: mark_done / clear_release / clear_blocker
       теперь через тот же applyFromPanel
     - Esc deselect (Linear-pattern)
     - idempotent guard `_escBound` на keydown handler

   Зависимости (через imports): state, FilterEngine, applyBulkAction.
   `window.showToast` используется без import (определён в app.js).
   ============================================================ */

import { state }            from '../state.js';
import { FilterEngine }     from '../filters.js';
import { applyBulkAction }  from '../dataStore.js';

export const BulkEditPanel = {
  show() {
    const panel = document.getElementById('bulk-panel');
    if (panel) { panel.classList.remove('hidden'); BulkEditPanel.update(); }
  },
  hide() {
    const panel = document.getElementById('bulk-panel');
    if (panel) panel.classList.add('hidden');
  },
  update() {
    const panel = document.getElementById('bulk-panel');
    if (!panel) return;
    const count = state.bulkSelected.size;
    const countEl = panel.querySelector('#bulk-count');
    if (countEl) countEl.textContent = `Выбрано: ${count}`;
  },
  toggle(rowId, checked) {
    if (checked) state.bulkSelected.add(rowId);
    else         state.bulkSelected.delete(rowId);
    if (state.bulkSelected.size > 0) BulkEditPanel.show();
    else                              BulkEditPanel.hide();
    BulkEditPanel.update();
  },
  selectAll(rows) {
    rows.forEach(r => state.bulkSelected.add(r.id));
    BulkEditPanel.show();
    BulkEditPanel.update();
    document.querySelectorAll('.bulk-row-cb').forEach(cb => { cb.checked = true; });
  },
  clearAll() {
    state.bulkSelected.clear();
    BulkEditPanel.hide();
    document.querySelectorAll('.bulk-row-cb').forEach(cb => { cb.checked = false; });
    const selectAll = document.getElementById('bulk-select-all');
    if (selectAll) selectAll.checked = false;
  },
  applyFromPanel(actionType, basePayload) {
    // V17 P9 (QA 1.1) — keep only ids that survived the current filter.
    // Earlier flow: user selects 5 rows → applies filter «Релиз 1.21» →
    // 0 rows visible but bulkSelected still 5 → bulk action mutated
    // INVISIBLE rows (data mutation вслепую). Now we intersect with
    // visible-after-filter ids.
    const visibleIds = new Set(FilterEngine.getFiltered().map(r => r.id));
    const ids = [...state.bulkSelected].filter(id => visibleIds.has(id));
    if (!ids.length) {
      window.showToast?.('Ничего не выбрано (или вне текущего фильтра)', 'warning', 1800);
      return;
    }
    const payload = basePayload ? { ...basePayload } : {};
    if (actionType === 'assign_release') {
      const sel = document.getElementById('bulk-release-select');
      payload.release = sel ? sel.value : '120';
    } else if (actionType === 'set_scope') {
      const sel = document.getElementById('bulk-scope-select');
      payload.scope = sel ? sel.value : 'Да';
    } else if (actionType === 'set_priority') {
      const sel = document.getElementById('bulk-priority-select');
      payload.priority = sel ? sel.value : 'medium';
    } else if (actionType === 'set_assignee') {
      const inp = document.getElementById('bulk-assignee-input');
      payload.assignee = inp ? inp.value.trim() : '';
      if (!payload.assignee) return;
    }
    applyBulkAction(ids, actionType, payload);
    BulkEditPanel.clearAll();
  },
  bindUI() {
    const panel = document.getElementById('bulk-panel');
    if (!panel) return;
    panel.querySelector('#bulk-btn-deselect')?.addEventListener('click', () => BulkEditPanel.clearAll());
    panel.querySelector('#bulk-btn-release')?.addEventListener('click', () => BulkEditPanel.applyFromPanel('assign_release'));
    panel.querySelector('#bulk-btn-scope')?.addEventListener('click',   () => BulkEditPanel.applyFromPanel('set_scope'));
    panel.querySelector('#bulk-btn-priority')?.addEventListener('click',() => BulkEditPanel.applyFromPanel('set_priority'));
    panel.querySelector('#bulk-btn-assignee')?.addEventListener('click',() => BulkEditPanel.applyFromPanel('set_assignee'));
    // V17 P9 (sys-analyst quick-win 8) — `mark_done / clear_release /
    // clear_blocker` теперь идут через единый applyFromPanel, чтобы все
    // bulk-операции обслуживались одним code-path. Также добавлен guard
    // на пустую selection (раньше silent no-op).
    panel.querySelector('#bulk-btn-done')?.addEventListener('click',          () => BulkEditPanel.applyFromPanel('mark_done', { done: true }));
    panel.querySelector('#bulk-btn-clear-release')?.addEventListener('click', () => BulkEditPanel.applyFromPanel('clear_release'));
    panel.querySelector('#bulk-btn-clear-blocker')?.addEventListener('click', () => BulkEditPanel.applyFromPanel('clear_blocker'));
    // V17 P9 (designer Quick win 1) — Esc deselect when bulk-panel open.
    if (!BulkEditPanel._escBound) {
      BulkEditPanel._escBound = true;
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (state.activeSection !== 'registry') return;
        if (!state.bulkSelected || state.bulkSelected.size === 0) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        BulkEditPanel.clearAll();
      });
    }
  },
};
