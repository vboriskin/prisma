'use strict';
/* ============================================================
   MILESTONES MODAL — F2 контрольные точки/вехи Ганта

   Управление state.milestones[] = [{ id, date:'YYYY-MM-DD', label }].
   Вертикальные вехи («код-фриз», «релиз-кандидат») рендерятся на Ганте как
   today-line (GanttView._positionMilestoneLines). Здесь — CRUD: добавить
   (date + label), удалить, сохранить. Работаем на рабочей копии, коммитим
   только по «Сохранить» (как в epicDepsModal).
   ============================================================ */

import { state }   from '../state.js';
import { Storage } from '../dataStore.js';
import { Utils }   from '../utils.js';

const esc = (s) => Utils.escapeHtml(String(s ?? ''));

function _genId() {
  return 'ms_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** ISO YYYY-MM-DD → DD.MM.YY (для чипа в списке). */
function _fmtDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '';
  return `${m[3]}.${m[2]}.${m[1].slice(2)}`;
}

function _sortByDate(arr) {
  return arr.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

/**
 * @param {object} [opts]
 * @param {function} [opts.onSaved]
 */
export function openMilestonesModal(opts = {}) {
  document.getElementById('modal-milestones')?.remove();

  // Рабочая копия — мутируем её, коммитим в state по «Сохранить».
  let list = _sortByDate(Array.isArray(state.milestones) ? state.milestones : [])
    .map(m => ({ id: m.id || _genId(), date: m.date || '', label: m.label || '' }));

  const html = `
    <div class="modal-overlay" id="modal-milestones" role="dialog" aria-modal="true" aria-labelledby="ms-title">
      <div class="modal-box re-modal-box">
        <div class="modal-header">
          <div class="re-modal-eyebrow">КОНТРОЛЬНЫЕ ТОЧКИ</div>
          <h3 id="ms-title">Вехи на Ганте</h3>
          <button class="modal-close-btn" type="button" aria-label="Закрыть" data-close-modal><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="re-modal-body">
          <div class="re-field-hint" style="margin-bottom:10px">Вертикальные линии-цели сквозь весь Гант («код-фриз», «релиз-кандидат»). Позиция вычисляется по дате внутри окна релиза.</div>
          <div class="ms-add-row">
            <input type="date" id="ms-date" class="re-field-input re-field-date" aria-label="Дата вехи">
            <input type="text" id="ms-label" class="re-field-input" placeholder="Название (напр. Код-фриз)" maxlength="40" autocomplete="off">
            <button class="btn btn-outline btn-sm" id="ms-add" type="button">Добавить</button>
          </div>
          <div class="ms-list" id="ms-list"></div>
        </div>
        <div class="re-modal-footer">
          <span class="ms-count" id="ms-count"></span>
          <div class="re-modal-actions">
            <button class="btn btn-outline btn-sm" data-close-modal>Отмена</button>
            <button class="btn btn-primary btn-sm" id="ms-save">Сохранить</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-milestones');
  const close = () => overlay?.remove();
  overlay?.addEventListener('click', (ev) => {
    if (ev.target === overlay || ev.target.closest?.('[data-close-modal]')) close();
  });
  document.addEventListener('keydown', function esc2(ev) {
    if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); }
  });

  const listEl  = document.getElementById('ms-list');
  const countEl = document.getElementById('ms-count');
  const dateEl  = document.getElementById('ms-date');
  const labelEl = document.getElementById('ms-label');

  function renderList() {
    list = _sortByDate(list);
    if (!list.length) {
      listEl.innerHTML = '<div class="ms-empty">Пока нет вех. Добавьте дату-цель выше.</div>';
    } else {
      listEl.innerHTML = list.map(m => `
        <div class="ms-item" data-id="${esc(m.id)}">
          <span class="ms-item-date">${esc(_fmtDate(m.date))}</span>
          <span class="ms-item-label">${esc(m.label || '(без названия)')}</span>
          <button type="button" class="ms-item-del" data-id="${esc(m.id)}" aria-label="Удалить веху" title="Удалить">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>`).join('');
      listEl.querySelectorAll('.ms-item-del').forEach(btn => {
        btn.addEventListener('click', () => {
          list = list.filter(m => m.id !== btn.dataset.id);
          renderList();
        });
      });
    }
    countEl.textContent = list.length ? `Вех: ${list.length}` : '';
  }
  renderList();

  function addOne() {
    const date  = dateEl.value;
    const label = labelEl.value.trim();
    if (!date) { window.showToast?.('Укажите дату вехи', 'warning', 1800); dateEl.focus(); return; }
    list.push({ id: _genId(), date, label });
    dateEl.value = '';
    labelEl.value = '';
    renderList();
    labelEl.focus();
  }
  document.getElementById('ms-add').addEventListener('click', addOne);
  labelEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addOne(); } });

  document.getElementById('ms-save').addEventListener('click', () => {
    state.milestones = _sortByDate(list).map(m => ({ id: m.id, date: m.date, label: m.label }));
    try { Storage.save(); } catch (_) {}
    close();
    try { opts.onSaved?.(); } catch (_) {}
    window.showToast?.(`Вехи обновлены (${list.length})`, 'success', 1800);
  });

  return close;
}
