'use strict';
/* ============================================================
   EPIC DEPENDENCIES MODAL — указать «от чего зависит» эпик

   #11 — открывается из иконки в эпик-колонке Ганта. Multi-select:
   эпик может зависеть сразу от нескольких других эпиков.

   Storage: state.epicDeps[from] = Array<to> ИЛИ string (legacy один-к-одному).
   Adapter normalizeDepsOut() ниже принимает оба и возвращает array.
   ============================================================ */

import { state }   from '../state.js';
import { Storage } from '../dataStore.js';
import { Utils }   from '../utils.js';

/** Возвращает array `to`-эпиков, от которых зависит данный `from`. */
export function normalizeDepsOut(from) {
  const v = (state.epicDeps || {})[from];
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return [String(v)];
}

/** Записывает Array<to> в state.epicDeps[from], либо удаляет ключ если []. */
export function setDepsOut(from, toArr) {
  const map = { ...(state.epicDeps || {}) };
  const arr = (Array.isArray(toArr) ? toArr : []).filter(Boolean);
  if (!arr.length) delete map[from];
  else map[from] = arr;
  state.epicDeps = map;
  try { Storage.save(); } catch (_) {}
}

export function openEpicDepsModal({ epicKey, onSaved }) {
  if (!epicKey) return () => {};
  const esc = (s) => Utils.escapeHtml(String(s ?? ''));

  // Существующие эпики (кроме себя).
  const allEpics = Array.from(new Set(
    (state.rows || [])
      .map(r => String(r.epic || r.tasks || '').trim())
      .filter(Boolean)
  )).filter(e => e !== epicKey).sort((a, b) => a.localeCompare(b, 'ru'));

  // Already selected dependencies (this epic depends on these).
  let selected = new Set(normalizeDepsOut(epicKey));

  document.getElementById('modal-epic-deps')?.remove();
  const html = `
    <div class="modal-overlay" id="modal-epic-deps" role="dialog" aria-modal="true" aria-labelledby="ed-title">
      <div class="modal-box ed-modal-box">
        <div class="modal-header">
          <div class="re-modal-eyebrow">ЗАВИСИМОСТИ ЭПИКА</div>
          <h3 id="ed-title">${esc(epicKey)}</h3>
          <button class="modal-close-btn" type="button" aria-label="Закрыть" data-close-modal>×</button>
        </div>
        <div class="ed-body">
          <div class="ed-help">Отметьте эпики, от которых зависит данный. Они появятся в «Графе зависимостей» со стрелками к этому эпику.</div>
          <input type="text" class="ed-search" id="ed-search" placeholder="Поиск эпиков…" autocomplete="off" autofocus>
          <div class="ed-list" id="ed-list"></div>
        </div>
        <div class="re-modal-footer">
          <span class="re-modal-spacer"></span>
          <div class="re-modal-actions">
            <button class="btn btn-outline btn-sm" data-close-modal>Отмена</button>
            <button class="btn btn-primary btn-sm" id="ed-save">Сохранить</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-epic-deps');
  const close = () => overlay?.remove();
  overlay?.addEventListener('click', (ev) => {
    if (ev.target === overlay || ev.target.closest?.('[data-close-modal]')) close();
  });
  document.addEventListener('keydown', function esc2(ev) {
    if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); }
  });

  const listEl = document.getElementById('ed-list');
  const searchEl = document.getElementById('ed-search');
  function render() {
    const q = searchEl.value.trim().toLowerCase();
    const items = allEpics.filter(e => !q || e.toLowerCase().includes(q));
    if (!items.length) {
      listEl.innerHTML = '<div class="ed-empty">Эпики не найдены</div>';
      return;
    }
    listEl.innerHTML = items.map(e => {
      const checked = selected.has(e) ? 'checked' : '';
      return `<label class="ed-item${selected.has(e) ? ' is-selected' : ''}">
        <input type="checkbox" data-epic="${esc(e)}" ${checked}>
        <span class="ed-item-text">${esc(e)}</span>
      </label>`;
    }).join('');
    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const ep = cb.dataset.epic;
        if (cb.checked) selected.add(ep);
        else selected.delete(ep);
        cb.closest('.ed-item').classList.toggle('is-selected', cb.checked);
      });
    });
  }
  render();
  searchEl.addEventListener('input', render);

  document.getElementById('ed-save').addEventListener('click', () => {
    setDepsOut(epicKey, [...selected]);
    close();
    try { onSaved?.(); } catch (_) {}
    window.showToast?.(`Зависимости эпика «${epicKey}» обновлены`, 'success', 1800);
  });

  return close;
}
