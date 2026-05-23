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
          <button class="modal-close-btn" type="button" aria-label="Закрыть" data-close-modal><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="ed-body">
          <div class="ed-help">Отметьте эпики, от которых зависит «${esc(epicKey)}». Они появятся в «Графе зависимостей» со стрелками к этому эпику.</div>
          <div class="ed-selected-bar" id="ed-selected-bar"></div>
          <input type="text" class="ed-search" id="ed-search" placeholder="Поиск по названию эпика…" autocomplete="off" autofocus>
          <div class="ed-list" id="ed-list"></div>
        </div>
        <div class="re-modal-footer">
          <span class="ed-footer-count" id="ed-footer-count"></span>
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
  const selBarEl = document.getElementById('ed-selected-bar');
  const countEl = document.getElementById('ed-footer-count');

  const _check = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

  function _renderSelectedBar() {
    const arr = [...selected];
    if (!arr.length) { selBarEl.innerHTML = '<span class="ed-selected-empty">Зависимости не выбраны</span>'; }
    else {
      selBarEl.innerHTML = arr.map(e => `<span class="ed-chip" data-epic="${esc(e)}">${esc(e)}<button type="button" class="ed-chip-x" data-epic="${esc(e)}" aria-label="Убрать">×</button></span>`).join('');
      selBarEl.querySelectorAll('.ed-chip-x').forEach(b => b.addEventListener('click', () => {
        selected.delete(b.dataset.epic);
        render();
      }));
    }
    countEl.textContent = arr.length ? `Выбрано: ${arr.length}` : '';
  }

  function render() {
    const q = searchEl.value.trim().toLowerCase();
    const items = allEpics.filter(e => !q || e.toLowerCase().includes(q));
    if (!items.length) {
      listEl.innerHTML = '<div class="ed-empty">Эпики не найдены</div>';
    } else {
      listEl.innerHTML = items.map(e => {
        const on = selected.has(e);
        return `<button type="button" class="ed-item${on ? ' is-selected' : ''}" data-epic="${esc(e)}">
          <span class="ed-item-check">${on ? _check : ''}</span>
          <span class="ed-item-text">${esc(e)}</span>
        </button>`;
      }).join('');
      listEl.querySelectorAll('.ed-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const ep = btn.dataset.epic;
          if (selected.has(ep)) selected.delete(ep);
          else selected.add(ep);
          render();
        });
      });
    }
    _renderSelectedBar();
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
