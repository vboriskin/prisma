'use strict';
/* ============================================================
   GANTT EDIT CONFLICT MODAL — приёмная сторона round-trip

   Открывается из handler'а импорта (app.js). Показывает diff:
   * Auto-apply (без конфликтов) — счётчик сверху.
   * Conflicts — список с pick для каждого (local / imported / skip).

   На «Применить» — мутирует state.rows под Reactive.silent, чтобы один
   bulk-flush, не N. Затем Storage.save + History log.
   ============================================================ */

import { state } from '../state.js';
import { Storage } from '../dataStore.js';
import { Reactive } from '../reactiveStore.js';
import { Utils } from '../utils.js';
import { Services } from '../app/services.js';
import { describeChange, snippetValue } from './ganttEditableHtmlImport.js';

const esc = (s) => Utils.escapeHtml(String(s ?? ''));

export function openImportConflictModal({ meta, warnings, changes, onApplied }) {
  document.getElementById('modal-import-conflicts')?.remove();
  const autoChanges = changes.filter(c => !c.isConflict);
  const conflicts   = changes.filter(c =>  c.isConflict);
  // По умолчанию для каждого conflict выбран «imported» (это новые правки).
  const choices = new Map();
  for (const c of conflicts) choices.set(c.id, 'imported');

  const warningHtml = warnings.length
    ? `<div class="ic-warnings">${warnings.map(w => `<div class="ic-warn ic-warn-${esc(w.level)}">${esc(w.text)}</div>`).join('')}</div>`
    : '';

  const dateStr = meta.exportedAt ? new Date(meta.exportedAt).toLocaleString('ru-RU') : '';
  const html = `
    <div class="modal-overlay" id="modal-import-conflicts" role="dialog" aria-modal="true" aria-labelledby="ic-title">
      <div class="modal-box ic-modal-box">
        <div class="modal-header">
          <div class="re-modal-eyebrow">ИМПОРТ ПРАВОК</div>
          <h3 id="ic-title">Изменения из файла</h3>
          <button class="modal-close-btn" type="button" aria-label="Закрыть" data-close-modal>×</button>
        </div>
        <div class="ic-body">
          <div class="ic-meta">
            <span class="ic-meta-item"><strong>${esc(autoChanges.length)}</strong> применятся автоматически</span>
            <span class="ic-meta-item ic-meta-conflicts"><strong>${esc(conflicts.length)}</strong> конфликтов — выберите версию</span>
          </div>
          ${dateStr ? `<div class="ic-source">Файл сформирован ${esc(dateStr)} · ${esc(meta.exportId?.slice(0, 8) || '')}</div>` : ''}
          ${warningHtml}
          ${conflicts.length ? `
            <div class="ic-section-title">Конфликты</div>
            <div class="ic-conflicts" id="ic-conflicts-list">
              ${conflicts.map(c => _conflictHtml(c)).join('')}
            </div>
          ` : ''}
          ${autoChanges.length ? `
            <details class="ic-auto-details">
              <summary>Показать ${autoChanges.length} автоматических правок</summary>
              <ul class="ic-auto-list">
                ${autoChanges.map(c => `<li><span class="ic-auto-epic">${esc(c.epic)}</span> · ${esc(describeChange(c))} · ${esc(_actionLabel(c.action))} → ${esc(snippetValue(c, 'imported'))}</li>`).join('')}
              </ul>
            </details>
          ` : ''}
        </div>
        <div class="re-modal-footer">
          <span class="re-modal-spacer"></span>
          <div class="re-modal-actions">
            <button class="btn btn-outline btn-sm" data-close-modal>Отмена</button>
            <button class="btn btn-primary btn-sm" id="ic-apply">Применить выбранное</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-import-conflicts');
  const close = () => overlay?.remove();
  overlay?.addEventListener('click', (ev) => {
    if (ev.target === overlay || ev.target.closest?.('[data-close-modal]')) close();
  });
  document.addEventListener('keydown', function esc2(ev) {
    if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); }
  });

  // Wire radio choices.
  overlay.querySelectorAll('input[type="radio"][data-cid]').forEach(r => {
    r.addEventListener('change', () => {
      if (r.checked) choices.set(r.dataset.cid, r.value);
    });
  });

  document.getElementById('ic-apply').addEventListener('click', () => {
    const toApply = autoChanges.concat(conflicts.filter(c => choices.get(c.id) === 'imported'));
    _applyChanges(toApply);
    // History log с exportId — guard от повторных импортов.
    try {
      window.HistoryLog?.data?.('import_gantt_edits',
        `Импортированы правки Ганта: ${toApply.length} из ${changes.length}`,
        { exportId: meta.exportId, applied: toApply.length, total: changes.length, conflicts: conflicts.length });
    } catch (_) {}
    close();
    try { onApplied?.(toApply); } catch (_) {}
    try { Services.App?.refreshAll?.() || window.App?.refreshAll?.(); } catch (_) {}
    window.showToast?.(`Применено ${toApply.length} правок из ${changes.length}.`, 'success', 2800);
  });
}

function _conflictHtml(c) {
  const localStr    = snippetValue(c, 'local');
  const importedStr = snippetValue(c, 'imported');
  return `
    <div class="ic-row">
      <div class="ic-row-head">
        <span class="ic-row-epic">${esc(c.epic)}</span>
        <span class="ic-row-type">${esc(describeChange(c))}</span>
        <span class="ic-row-action ic-row-action-${esc(c.action)}">${esc(_actionLabel(c.action))}</span>
      </div>
      <div class="ic-row-choices">
        <label class="ic-choice">
          <input type="radio" name="ic-${esc(c.id)}" value="local" data-cid="${esc(c.id)}">
          <span class="ic-choice-label">Локально</span>
          <span class="ic-choice-value">${esc(localStr)}</span>
        </label>
        <label class="ic-choice is-default">
          <input type="radio" name="ic-${esc(c.id)}" value="imported" data-cid="${esc(c.id)}" checked>
          <span class="ic-choice-label">Из файла</span>
          <span class="ic-choice-value">${esc(importedStr)}</span>
        </label>
        <label class="ic-choice">
          <input type="radio" name="ic-${esc(c.id)}" value="skip" data-cid="${esc(c.id)}">
          <span class="ic-choice-label">Пропустить</span>
          <span class="ic-choice-value">— оставить как локально, не менять</span>
        </label>
      </div>
    </div>`;
}

function _actionLabel(action) {
  return { add: 'Добавление', edit: 'Изменение', delete: 'Удаление' }[action] || action;
}

function _applyChanges(toApply) {
  if (!Array.isArray(toApply) || !toApply.length) return;
  const rowsById = Object.create(null);
  for (const r of (state.rows || [])) rowsById[r.id] = r;
  Reactive.silent(() => {
    const nowISO = new Date().toISOString();
    for (const c of toApply) {
      const row = rowsById[c.rowId];
      if (!row) continue;
      if (c.type === 'donePills' || c.type === 'inProgressPills') {
        if (!row[c.type]) row[c.type] = {};
        if (c.action === 'delete') {
          delete row[c.type][c.subKey];
        } else {
          row[c.type][c.subKey] = c.imported;
          // Кросс-чистка: done и in-progress взаимоисключающие.
          if (c.type === 'donePills' && row.inProgressPills) delete row.inProgressPills[c.subKey];
          if (c.type === 'inProgressPills' && row.donePills) delete row.donePills[c.subKey];
        }
      } else if (c.type === 'cellNotes' || c.type === 'cellRisks') {
        if (!Array.isArray(row[c.type])) row[c.type] = [];
        if (c.action === 'delete') {
          row[c.type] = row[c.type].filter(n => n.id !== c.subKey);
        } else if (c.action === 'add') {
          row[c.type].push(c.imported);
        } else if (c.action === 'edit') {
          const idx = row[c.type].findIndex(n => n.id === c.subKey);
          if (idx >= 0) row[c.type][idx] = c.imported;
          else row[c.type].push(c.imported);
        }
      } else if (c.type === 'releaseTypes') {
        // Перенос/состав работ: добавить/удалить wt в release-array колодца.
        const FLAT = { backlog: 'backlogTypes', r120: 'release120Types', r121: 'release121Types', r122: 'release122Types', overtime: 'overtimeTypes' };
        const arrOf = (col) => {
          if (FLAT[col]) { if (!Array.isArray(row[FLAT[col]])) row[FLAT[col]] = []; return row[FLAT[col]]; }
          if (!row.customReleaseTypes) row.customReleaseTypes = {};
          if (!Array.isArray(row.customReleaseTypes[col])) row.customReleaseTypes[col] = [];
          return row.customReleaseTypes[col];
        };
        const arr = arrOf(c.col);
        if (c.action === 'add') { if (!arr.includes(c.wt)) arr.push(c.wt); }
        else if (c.action === 'delete') { const i = arr.indexOf(c.wt); if (i >= 0) arr.splice(i, 1); }
      }
      row.updatedAt = nowISO;
    }
  });
  try { Storage.save(); } catch (_) {}
}
