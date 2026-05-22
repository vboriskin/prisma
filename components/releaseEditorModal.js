'use strict';
/* ============================================================
   RELEASE EDITOR MODAL — добавить/редактировать пользовательский релиз

   #1 C4 — модалка для CRUD на state.releases. Открывается из шапки Ганта
   (кнопка «+ релиз») и из header-col-action на самом колодце Гант'а
   (для редактирования / удаления существующего custom релиза).
   ============================================================ */

import { state }    from '../state.js';
import { Storage }  from '../dataStore.js';
import { Utils }    from '../utils.js';
import { LEGACY_RELEASE_LIST } from '../constants.js';

/**
 * @param {object} opts
 * @param {string} [opts.key]      Если указан — редактирование, иначе создание.
 * @param {function} [opts.onSaved]
 */
export function openReleaseEditor(opts = {}) {
  const esc = (s) => Utils.escapeHtml(String(s ?? ''));
  const editKey = opts.key || '';
  const existing = editKey
    ? (state.releases || []).find(r => r.key === editKey)
    : null;
  const isEdit = !!existing;
  // Legacy релизы редактировать нельзя.
  if (editKey && LEGACY_RELEASE_LIST.some(l => l.key === editKey)) {
    window.showToast?.('Встроенные релизы не редактируются', 'warning', 2200);
    return () => {};
  }

  const draft = {
    short: existing?.short || '',
    label: existing?.label || '',
    dates: existing?.dates || '',
  };

  document.getElementById('modal-release-editor')?.remove();
  const html = `
    <div class="modal-overlay" id="modal-release-editor" role="dialog" aria-modal="true" aria-labelledby="modal-release-editor-title">
      <div class="modal-box ae-modal-box">
        <div class="modal-header">
          <h3 id="modal-release-editor-title">${isEdit ? 'Релиз: ' + esc(existing.short || existing.label) : 'Добавить релиз'}</h3>
          <button class="modal-close-btn" type="button" aria-label="Закрыть" data-close-modal>×</button>
        </div>
        <div class="ae-modal-body">
          <div class="form-grid">
            <label class="form-row">
              <span class="form-label">Ярлык</span>
              <input id="re-short" class="form-input" placeholder="Например: 1.23" maxlength="20" value="${esc(draft.short)}" autofocus>
            </label>
            <label class="form-row">
              <span class="form-label">Полное название (опц.)</span>
              <input id="re-label" class="form-input" placeholder="Например: Релиз 1.23" maxlength="60" value="${esc(draft.label)}">
            </label>
            <label class="form-row">
              <span class="form-label">Диапазон дат</span>
              <input id="re-dates" class="form-input" placeholder="DD.MM–DD.MM" maxlength="40" value="${esc(draft.dates)}">
            </label>
          </div>
        </div>
        <div class="ae-modal-footer">
          ${isEdit ? '<button class="btn btn-outline btn-sm btn-danger" id="re-delete">Удалить релиз</button>' : ''}
          <button class="btn btn-outline btn-sm" data-close-modal>Отмена</button>
          <button class="btn btn-primary btn-sm" id="re-save">${isEdit ? 'Сохранить' : 'Добавить'}</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-release-editor');
  const close = () => overlay?.remove();
  overlay?.addEventListener('click', (ev) => {
    if (ev.target === overlay || ev.target.closest?.('[data-close-modal]')) close();
  });
  document.addEventListener('keydown', function esc2(ev) {
    if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); }
  });

  document.getElementById('re-save').addEventListener('click', () => {
    const short = document.getElementById('re-short').value.trim();
    const label = document.getElementById('re-label').value.trim();
    const dates = document.getElementById('re-dates').value.trim();
    if (!short) {
      window.showToast?.('Укажите ярлык релиза', 'warning', 1800);
      return;
    }
    const key = editKey || ('r' + short.replace(/[^\w]/g, '').toLowerCase());
    if (!editKey) {
      if (LEGACY_RELEASE_LIST.some(l => l.key === key) || (state.releases || []).some(r => r.key === key)) {
        window.showToast?.('Релиз с таким ярлыком уже есть', 'warning', 2200);
        return;
      }
    }
    const arr = Array.isArray(state.releases) ? state.releases.slice() : [];
    if (isEdit) {
      const idx = arr.findIndex(r => r.key === editKey);
      if (idx >= 0) {
        arr[idx] = { ...arr[idx], short, label: label || `Релиз ${short}`, dates };
      }
    } else {
      arr.push({
        key,
        short,
        label: label || `Релиз ${short}`,
        dates,
        cls: 'gantt-window-' + key,
        order: arr.length + 1,
      });
    }
    state.releases = arr;
    try { Storage.save(); } catch (_) {}
    close();
    try { opts.onSaved?.(); } catch (_) {}
    window.showToast?.(isEdit ? `Релиз ${short} обновлён` : `Добавлен релиз ${short}`, 'success', 1800);
  });

  if (isEdit) {
    document.getElementById('re-delete').addEventListener('click', () => {
      if (!confirm(`Удалить релиз «${draft.short}»? Заметки и риски в колодке сохранятся в данных, но колодец исчезнет из Ганта.`)) return;
      const arr = (state.releases || []).filter(r => r.key !== editKey);
      state.releases = arr;
      try { Storage.save(); } catch (_) {}
      close();
      try { opts.onSaved?.(); } catch (_) {}
      window.showToast?.(`Релиз ${draft.short} удалён`, 'success', 1800);
    });
  }

  return close;
}
