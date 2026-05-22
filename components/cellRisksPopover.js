'use strict';
/* ============================================================
   CELL RISKS POPOVER — фигура «риск» на ячейке

   Три типа риска (per-cell):
     open-question  — открытый вопрос (бизнес-неясность, ждём ответа)
     dangling       — подвешенная активность (зависимость, hand-off)
     hard-deadline  — обязательный дедлайн (релиз-блокер)

   Структура: row.cellRisks[] = [{ id, col, kind, text, dueDate? }]
   Persistence: автоматически через Proxy state.js + Storage.save().
   ============================================================ */

import { Utils } from '../utils.js';

const KIND_META = {
  'open-question': { label: 'Открытый вопрос',      glyph: '?',  cssVar: '--prizma-drift',     fallback: '#f59e0b' },
  'dangling':      { label: 'Подвешенная активность', glyph: '◇',  cssVar: '--prizma-information', fallback: '#4f46e5' },
  'hard-deadline': { label: 'Жёсткий дедлайн',       glyph: '!',  cssVar: '--prizma-off-course', fallback: '#dc2626' },
};

const KIND_ORDER = ['open-question', 'dangling', 'hard-deadline'];

export function kindMeta(kind) {
  return KIND_META[kind] || KIND_META['open-question'];
}

export function kindOrderForCount(risks) {
  // Цвет/glyph группы выбираем по приоритету: hard > dangling > open-question.
  const has = new Set((risks || []).map(r => r.kind));
  for (const k of ['hard-deadline', 'dangling', 'open-question']) {
    if (has.has(k)) return k;
  }
  return 'open-question';
}

const _activePopovers = new Set();

export function closeAllRiskPopovers() {
  for (const p of [..._activePopovers]) {
    try { p.close(); } catch (_) {}
  }
}

export function openCellRisksPopover({ row, col, anchorEl, releaseLabel, onChange }) {
  if (!row || !col) return () => {};
  closeAllRiskPopovers();

  const esc = (s) => Utils.escapeHtml(String(s ?? ''));
  if (!Array.isArray(row.cellRisks)) row.cellRisks = [];
  const risksAll = row.cellRisks;
  const colRisks = () => risksAll.filter(r => r.col === col);
  let activeIdx = Math.max(0, colRisks().length - 1);
  let isAdding  = colRisks().length === 0;
  let draftKind = 'open-question';

  const root = document.createElement('div');
  root.className = 'gdt-cellpop gdt-cellpop-risk';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-label', `Риски · ${row.epic || '—'} · ${releaseLabel || col}`);
  document.body.appendChild(root);

  function render() {
    const list = colRisks();
    if (activeIdx >= list.length) activeIdx = list.length - 1;
    if (activeIdx < 0) activeIdx = 0;
    const current = list[activeIdx];
    const empty = list.length === 0;
    const showEditor = isAdding || empty;
    const stepperHtml = list.length > 1
      ? `<div class="gdt-cellpop-stepper">
           <button type="button" class="gdt-cellpop-step gdt-cellpop-prev" aria-label="Предыдущий риск" ${activeIdx <= 0 ? 'disabled' : ''}>‹</button>
           <span class="gdt-cellpop-counter">${activeIdx + 1} / ${list.length}</span>
           <button type="button" class="gdt-cellpop-step gdt-cellpop-next" aria-label="Следующий риск" ${activeIdx >= list.length - 1 ? 'disabled' : ''}>›</button>
         </div>`
      : (list.length === 1 ? `<span class="gdt-cellpop-counter">1 риск</span>` : '');

    const kindOptions = KIND_ORDER.map(k => {
      const m = KIND_META[k];
      const selected = k === draftKind ? ' selected' : '';
      return `<option value="${k}"${selected}>${esc(m.glyph)}  ${esc(m.label)}</option>`;
    }).join('');

    const editorHtml = showEditor
      ? `<form class="gdt-cellpop-editor">
           <label class="gdt-cellpop-field">
             <span class="gdt-cellpop-field-label">Тип риска</span>
             <select class="gdt-cellpop-kind">${kindOptions}</select>
           </label>
           <label class="gdt-cellpop-field">
             <span class="gdt-cellpop-field-label">Описание</span>
             <textarea class="gdt-cellpop-text" rows="3" placeholder="Что под угрозой?" autofocus></textarea>
           </label>
           <label class="gdt-cellpop-field">
             <span class="gdt-cellpop-field-label">Дедлайн (опц.)</span>
             <input type="date" class="gdt-cellpop-due" />
           </label>
           <div class="gdt-cellpop-editor-actions">
             ${empty ? '' : '<button type="button" class="btn btn-outline btn-xs gdt-cellpop-cancel">Отмена</button>'}
             <button type="submit" class="btn btn-primary btn-xs gdt-cellpop-save">Сохранить</button>
           </div>
         </form>`
      : (() => {
          const m = kindMeta(current.kind);
          const dueHtml = current.dueDate ? `<span class="gdt-cellpop-due-view">До ${esc(_fmtDate(current.dueDate))}</span>` : '';
          return `<div class="gdt-cellpop-body">
            <div class="gdt-cellpop-kind-view" data-kind="${esc(current.kind)}">
              <span class="gdt-cellpop-kind-glyph">${esc(m.glyph)}</span>
              <span class="gdt-cellpop-kind-label">${esc(m.label)}</span>
            </div>
            <div class="gdt-cellpop-text-view">${esc(current.text)}</div>
            <div class="gdt-cellpop-meta">${dueHtml}</div>
            <div class="gdt-cellpop-actions">
              <button type="button" class="btn btn-outline btn-xs gdt-cellpop-delete" data-id="${esc(current.id)}">Удалить</button>
              <button type="button" class="btn btn-primary btn-xs gdt-cellpop-add">+ Добавить</button>
            </div>
          </div>`;
        })();

    root.innerHTML = `
      <div class="gdt-cellpop-arrow" aria-hidden="true"></div>
      <div class="gdt-cellpop-head">
        <div class="gdt-cellpop-title">Риски · ${esc(releaseLabel || col)}</div>
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
    root.querySelector('.gdt-cellpop-next')?.addEventListener('click', () => { activeIdx = Math.min(colRisks().length - 1, activeIdx + 1); render(); });
    root.querySelector('.gdt-cellpop-add')?.addEventListener('click', () => { isAdding = true; render(); });
    root.querySelector('.gdt-cellpop-cancel')?.addEventListener('click', () => { isAdding = false; render(); });
    root.querySelector('.gdt-cellpop-delete')?.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      const idx = risksAll.findIndex(r => r.id === id);
      if (idx >= 0) {
        risksAll.splice(idx, 1);
        activeIdx = Math.max(0, activeIdx - 1);
        notify();
        if (colRisks().length === 0) isAdding = true;
        render();
      }
    });
    const kindSelect = root.querySelector('.gdt-cellpop-kind');
    if (kindSelect) kindSelect.addEventListener('change', () => { draftKind = kindSelect.value; });
    const form = root.querySelector('.gdt-cellpop-editor');
    if (form) {
      const ta = form.querySelector('.gdt-cellpop-text');
      const due = form.querySelector('.gdt-cellpop-due');
      ta?.focus();
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = (ta?.value || '').trim();
        if (!text) return;
        const risk = {
          id: 'risk_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
          col,
          kind: draftKind,
          text,
          dueDate: due?.value || '',
        };
        risksAll.push(risk);
        activeIdx = colRisks().length - 1;
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
      top = aRect.top - pRect.height - margin;
      root.classList.add('is-flipped');
    } else {
      root.classList.remove('is-flipped');
    }
    root.style.left = `${left}px`;
    root.style.top  = `${top}px`;
    root.style.transform = '';
  }

  function notify() { try { onChange?.(); } catch (_) {} }

  function onDocClick(e) {
    if (!root.contains(e.target) && !anchorEl?.contains(e.target)) close();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

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

function _fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
  catch (_) { return iso; }
}
