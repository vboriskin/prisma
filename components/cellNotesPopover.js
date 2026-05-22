'use strict';
/* ============================================================
   CELL NOTES POPOVER — Confluence-style multi-note editor

   Привязан к одной ячейке Ганта (row × release-col). Несколько
   независимых заметок, навигация ←/→ между ними, добавление /
   удаление. Заметка = { id, col, text, createdAt, author? }.

   Persistence: мутации `row.cellNotes` идут через Proxy в state.js,
   Storage.save срабатывает автоматически. После каждой мутации
   зовём opts.onChange для re-render badge.
   ============================================================ */

import { Utils } from '../utils.js';

const _activePopovers = new Set();

export function closeAllCellPopovers() {
  for (const p of [..._activePopovers]) {
    try { p.close(); } catch (_) {}
  }
}

export function openCellNotesPopover({ row, col, anchorEl, releaseLabel, onChange }) {
  if (!row || !col) return () => {};
  closeAllCellPopovers();

  const esc = (s) => Utils.escapeHtml(String(s ?? ''));
  if (!Array.isArray(row.cellNotes)) row.cellNotes = [];
  const notesAll = row.cellNotes;
  // Локальная view-выборка: только заметки этой колонки. Мутируем notesAll,
  // но рендерим только matching col.
  const colNotes = () => notesAll.filter(n => n.col === col);
  let activeIdx = Math.max(0, colNotes().length - 1);
  let isAdding  = colNotes().length === 0;

  const root = document.createElement('div');
  root.className = 'gdt-cellpop';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-label', `Заметки · ${row.epic || '—'} · ${releaseLabel || col}`);
  document.body.appendChild(root);

  function render() {
    const list = colNotes();
    if (activeIdx >= list.length) activeIdx = list.length - 1;
    if (activeIdx < 0) activeIdx = 0;
    const current = list[activeIdx];
    const empty = list.length === 0;
    const showEditor = isAdding || empty;
    const stepperHtml = list.length > 1
      ? `<div class="gdt-cellpop-stepper">
           <button type="button" class="gdt-cellpop-step gdt-cellpop-prev" aria-label="Предыдущая заметка" ${activeIdx <= 0 ? 'disabled' : ''}>‹</button>
           <span class="gdt-cellpop-counter">${activeIdx + 1} / ${list.length}</span>
           <button type="button" class="gdt-cellpop-step gdt-cellpop-next" aria-label="Следующая заметка" ${activeIdx >= list.length - 1 ? 'disabled' : ''}>›</button>
         </div>`
      : (list.length === 1 ? `<span class="gdt-cellpop-counter">1 заметка</span>` : '');
    const editorHtml = showEditor
      ? `<form class="gdt-cellpop-editor">
           <textarea class="gdt-cellpop-text" rows="3" placeholder="Текст заметки…" autofocus></textarea>
           <div class="gdt-cellpop-editor-actions">
             ${empty ? '' : '<button type="button" class="btn btn-outline btn-xs gdt-cellpop-cancel">Отмена</button>'}
             <button type="submit" class="btn btn-primary btn-xs gdt-cellpop-save">Сохранить</button>
           </div>
         </form>`
      : `<div class="gdt-cellpop-body">
           <div class="gdt-cellpop-text-view">${esc(current.text)}</div>
           <div class="gdt-cellpop-meta">
             <span class="gdt-cellpop-time">${esc(_fmtTime(current.createdAt))}</span>
             ${current.author ? `<span class="gdt-cellpop-author">${esc(current.author)}</span>` : ''}
           </div>
           <div class="gdt-cellpop-actions">
             <button type="button" class="btn btn-outline btn-xs gdt-cellpop-delete" data-id="${esc(current.id)}">Удалить</button>
             <button type="button" class="btn btn-primary btn-xs gdt-cellpop-add">+ Добавить</button>
           </div>
         </div>`;
    root.innerHTML = `
      <div class="gdt-cellpop-arrow" aria-hidden="true"></div>
      <div class="gdt-cellpop-head">
        <div class="gdt-cellpop-title">Заметки · ${esc(releaseLabel || col)}</div>
        <button type="button" class="gdt-cellpop-close" aria-label="Закрыть">×</button>
      </div>
      <div class="gdt-cellpop-stepper-wrap">${stepperHtml}</div>
      ${editorHtml}
    `;
    _bindRendered();
    _position();
  }

  function _bindRendered() {
    root.querySelector('.gdt-cellpop-close')?.addEventListener('click', close);
    root.querySelector('.gdt-cellpop-prev')?.addEventListener('click', () => { activeIdx = Math.max(0, activeIdx - 1); render(); });
    root.querySelector('.gdt-cellpop-next')?.addEventListener('click', () => { activeIdx = Math.min(colNotes().length - 1, activeIdx + 1); render(); });
    root.querySelector('.gdt-cellpop-add')?.addEventListener('click', () => { isAdding = true; render(); });
    root.querySelector('.gdt-cellpop-cancel')?.addEventListener('click', () => { isAdding = false; render(); });
    root.querySelector('.gdt-cellpop-delete')?.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      const idx = notesAll.findIndex(n => n.id === id);
      if (idx >= 0) {
        notesAll.splice(idx, 1);
        activeIdx = Math.max(0, activeIdx - 1);
        notify();
        if (colNotes().length === 0) isAdding = true;
        render();
      }
    });
    const form = root.querySelector('.gdt-cellpop-editor');
    if (form) {
      const ta = form.querySelector('.gdt-cellpop-text');
      ta?.focus();
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = (ta?.value || '').trim();
        if (!text) return;
        const note = {
          id: 'note_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
          col,
          text,
          createdAt: new Date().toISOString(),
        };
        notesAll.push(note);
        activeIdx = colNotes().length - 1;
        isAdding = false;
        notify();
        render();
      });
    }
  }

  function _position() {
    const aRect = anchorEl?.getBoundingClientRect?.();
    const pRect = root.getBoundingClientRect();
    const margin = 8;
    if (!aRect) {
      root.style.left = '50%';
      root.style.top  = '50%';
      root.style.transform = 'translate(-50%, -50%)';
      return;
    }
    let left = aRect.left + aRect.width / 2 - pRect.width / 2;
    let top  = aRect.bottom + margin;
    if (left + pRect.width > window.innerWidth - margin) left = window.innerWidth - pRect.width - margin;
    if (left < margin) left = margin;
    if (top + pRect.height > window.innerHeight - margin) {
      // flip above
      top = aRect.top - pRect.height - margin;
      root.classList.add('is-flipped');
    } else {
      root.classList.remove('is-flipped');
    }
    root.style.left = `${left}px`;
    root.style.top  = `${top}px`;
    root.style.transform = '';
  }

  function notify() {
    try { onChange?.(); } catch (_) {}
  }

  function onDocClick(e) {
    if (!root.contains(e.target) && !anchorEl?.contains(e.target)) close();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  function close() {
    _activePopovers.delete(api);
    document.removeEventListener('mousedown', onDocClick, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', _position);
    window.removeEventListener('scroll', _position, true);
    root.remove();
  }

  const api = { close };
  _activePopovers.add(api);

  render();
  document.addEventListener('mousedown', onDocClick, true);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', _position);
  window.addEventListener('scroll', _position, true);

  return close;
}

function _fmtTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch (_) { return iso || ''; }
}
