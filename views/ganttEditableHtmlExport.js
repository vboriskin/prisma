'use strict';
/* ============================================================
   GANTT EDITABLE HTML EXPORT — round-trip формат

   Расширение GanttHTMLExport для случая «PM выгрузил → отправил
   бизнес-аналитикам → они правят локально → PM импортирует обратно».

   Файл = base read-only viewer (тот же что GanttHTMLExport.build) +
   две инъекции перед </body>:
     1) <script id="prizma-snapshot"> — атомарный snapshot (JSONExport.buildSnapshot)
        + meta (version, exportId, dataSource, exportedAt, editableSchema).
     2) <script id="prizma-editor"> — inline editor (toggle режима,
        мутации pills/notes/risks, кнопка «Скачать обновлённую копию»).

   Существующий GanttHTMLExport НЕ модифицируется — это отдельная
   точка входа в Files-меню.
   ============================================================ */

import { state }      from '../state.js';
import { JSONExport } from '../dataStore.js';
import { GanttHTMLExport } from './ganttHtmlExport.js';

/** Простой UUID-v4 fallback для browsers без crypto.randomUUID. */
function _uuid() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); }
  catch (_) { /* fallthrough */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Demo vs production guard — по convention id-prefix `demo_`. */
function _detectDataSource() {
  const rows = Array.isArray(state.rows) ? state.rows : [];
  if (!rows.length) return 'production';
  const demoCount = rows.filter(r => String(r.id || '').startsWith('demo_')).length;
  return demoCount > rows.length / 2 ? 'demo' : 'production';
}

/**
 * Inline editor JS. Минимальный скелет в C1: только toggle режима
 * редактирования + counter правок (нулевой). Функционал pills/notes/
 * risks add'ится в C2/C3, download — в C4.
 */
const _EDITOR_JS = `
(function prizmaEditor() {
  const snap = (function() {
    try { return JSON.parse(document.getElementById('prizma-snapshot').textContent); }
    catch (_) { return null; }
  })();
  if (!snap) return;

  // Карта правок: ключ — \`pill:<rowId>__<col>__<wt>\` (pills) либо
  // \`note:<rowId>__<col>__<noteId>\` / \`risk:...\` (C3). Значение — payload
  // правки + ts. Идемпотентно: повторное изменение того же pill пере-пишет.
  const edits = new Map();
  let editMode = false;

  function _rowById(rowId) {
    return (snap.snapshot?.data?.rows || []).find(r => r.id === rowId);
  }
  function _currentPillStatus(rowId, col, wt) {
    const row = _rowById(rowId);
    if (!row) return 'planned';
    const k = col + '__' + wt;
    if (row.donePills && row.donePills[k]) return 'done';
    if (row.inProgressPills && row.inProgressPills[k]) return 'in-progress';
    return 'planned';
  }
  function _pendingPillStatus(rowId, col, wt) {
    const key = 'pill:' + rowId + '__' + col + '__' + wt;
    return edits.has(key) ? edits.get(key).status : null;
  }

  function _renderBanner() {
    let bar = document.getElementById('prizma-edit-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'prizma-edit-bar';
      bar.innerHTML = \`
        <span class="prizma-edit-status">
          <strong id="prizma-edit-title">Только просмотр</strong>
          <span id="prizma-edit-sub">Включите режим редактирования, чтобы внести правки.</span>
        </span>
        <span class="prizma-edit-actions">
          <span id="prizma-edit-counter" hidden>Правок: <strong>0</strong></span>
          <button type="button" id="prizma-edit-toggle" class="prizma-edit-btn">Режим редактирования</button>
          <button type="button" id="prizma-edit-download" class="prizma-edit-btn prizma-edit-btn-primary" hidden>Скачать обновлённую копию</button>
        </span>
      \`;
      document.body.prepend(bar);
    }
    bar.dataset.mode = editMode ? 'edit' : 'view';
    document.getElementById('prizma-edit-title').textContent = editMode ? 'Режим редактирования' : 'Только просмотр';
    const sub = document.getElementById('prizma-edit-sub');
    sub.textContent = editMode
      ? 'Изменения нужно скачать и отправить обратно — они сохраняются только в обновлённой копии файла.'
      : \`Файл: \${snap.exportId.slice(0, 8)} · \${snap.dataSource === 'demo' ? 'демо-данные' : 'рабочие данные'} · \${snap.exportedAt?.slice(0, 10) || ''}\`;
    document.body.classList.toggle('prizma-edit-mode', editMode);
    document.getElementById('prizma-edit-toggle').textContent = editMode ? 'Выключить редактирование' : 'Режим редактирования';
    _updateCounter();
  }

  function _updateCounter() {
    const el = document.getElementById('prizma-edit-counter');
    const dl = document.getElementById('prizma-edit-download');
    if (!el) return;
    const n = edits.size;
    el.hidden = (n === 0);
    el.querySelector('strong').textContent = String(n);
    if (dl) dl.hidden = (n === 0 || !editMode);
  }

  function _markPillEdited(rowId, col, wt) {
    const pills = document.querySelectorAll(\`.gantt-type-pill[data-row-id="\${CSS.escape(rowId)}"][data-src-col="\${CSS.escape(col)}"][data-wt="\${CSS.escape(wt)}"]\`);
    pills.forEach(p => p.classList.add('prizma-edited'));
  }

  // Pill click → mini-popup со статусом + comment. Note/risk icons тоже.
  function _wireEditors() {
    document.querySelectorAll('.gantt-type-pill[data-row-id][data-src-col][data-wt]').forEach(pill => {
      if (pill._prizmaWired) return;
      pill._prizmaWired = true;
      pill.addEventListener('click', (e) => {
        if (!editMode) return;
        e.preventDefault();
        e.stopPropagation();
        _openPillPopup(pill);
      });
    });
    document.querySelectorAll('.gdt-cell-note-icon[data-row-id][data-col]').forEach(el => {
      if (el._prizmaWired) return;
      el._prizmaWired = true;
      el.addEventListener('click', (e) => {
        if (!editMode) return;
        e.preventDefault();
        e.stopPropagation();
        _openAnnotationPopup(el, 'note');
      });
    });
    document.querySelectorAll('.gdt-cell-risk-glyph[data-row-id][data-col]').forEach(el => {
      if (el._prizmaWired) return;
      el._prizmaWired = true;
      el.addEventListener('click', (e) => {
        if (!editMode) return;
        e.preventDefault();
        e.stopPropagation();
        _openAnnotationPopup(el, 'risk');
      });
    });
  }

  function _openPillPopup(pill) {
    document.getElementById('prizma-pill-popup')?.remove();
    const rowId = pill.dataset.rowId;
    const col   = pill.dataset.srcCol;
    const wt    = pill.dataset.wt;
    const row = _rowById(rowId);
    const epicLabel = (row?.epic || row?.tasks || '(без эпика)').slice(0, 60);
    const current = _pendingPillStatus(rowId, col, wt) || _currentPillStatus(rowId, col, wt);
    const key = 'pill:' + rowId + '__' + col + '__' + wt;
    const existingEdit = edits.get(key);
    const initComment = existingEdit?.comment ?? (row?.donePills?.[col + '__' + wt]?.comment || '');

    const pop = document.createElement('div');
    pop.id = 'prizma-pill-popup';
    pop.className = 'prizma-pop';
    pop.innerHTML = \`
      <div class="prizma-pop-head">
        <div class="prizma-pop-eyebrow">\${_esc(epicLabel)}</div>
        <div class="prizma-pop-title">\${_esc(wt)} · \${_esc(col)}</div>
        <button type="button" class="prizma-pop-close" aria-label="Закрыть">×</button>
      </div>
      <div class="prizma-pop-body">
        <div class="prizma-pop-field">
          <label class="prizma-pop-label">Статус</label>
          <div class="prizma-pop-radios">
            \${['planned','in-progress','done'].map(s => \`
              <label class="prizma-pop-radio\${current===s?' is-active':''}" data-status="\${s}">
                <input type="radio" name="prizma-pill-status" value="\${s}" \${current===s?'checked':''}>
                <span>\${{'planned':'План','in-progress':'В работе','done':'Завершено'}[s]}</span>
              </label>
            \`).join('')}
          </div>
        </div>
        <div class="prizma-pop-field" id="prizma-pop-comment-field" \${current==='done'?'':'hidden'}>
          <label class="prizma-pop-label" for="prizma-pop-comment">Комментарий (опц.)</label>
          <textarea id="prizma-pop-comment" class="prizma-pop-text" rows="2" placeholder="Например: закрыто за 3 дня раньше срока">\${_esc(initComment)}</textarea>
        </div>
      </div>
      <div class="prizma-pop-footer">
        \${existingEdit ? '<button type="button" class="prizma-edit-btn" id="prizma-pop-revert">Отменить правку</button>' : '<span></span>'}
        <div class="prizma-pop-actions">
          <button type="button" class="prizma-edit-btn" id="prizma-pop-cancel">Отмена</button>
          <button type="button" class="prizma-edit-btn prizma-edit-btn-primary" id="prizma-pop-save">Сохранить</button>
        </div>
      </div>
    \`;
    document.body.appendChild(pop);

    // Position возле pill (под ним, с clamp'ом по viewport).
    const r = pill.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let left = r.left + r.width / 2 - pr.width / 2;
    let top  = r.bottom + 6;
    left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8));
    if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - pr.height - 6);
    pop.style.left = left + 'px';
    pop.style.top  = top  + 'px';

    let selectedStatus = current;
    pop.querySelectorAll('.prizma-pop-radio').forEach(r => {
      r.addEventListener('click', () => {
        selectedStatus = r.dataset.status;
        pop.querySelectorAll('.prizma-pop-radio').forEach(x => x.classList.toggle('is-active', x === r));
        r.querySelector('input').checked = true;
        document.getElementById('prizma-pop-comment-field').hidden = (selectedStatus !== 'done');
      });
    });
    pop.querySelector('.prizma-pop-close').addEventListener('click', () => pop.remove());
    document.getElementById('prizma-pop-cancel').addEventListener('click', () => pop.remove());
    document.getElementById('prizma-pop-revert')?.addEventListener('click', () => {
      edits.delete(key);
      _renderPillVisualState(rowId, col, wt);
      pop.remove();
      _updateCounter();
    });
    document.getElementById('prizma-pop-save').addEventListener('click', () => {
      const comment = (document.getElementById('prizma-pop-comment')?.value || '').trim();
      const baseline = _currentPillStatus(rowId, col, wt);
      const baselineComment = row?.donePills?.[col + '__' + wt]?.comment || '';
      if (selectedStatus === baseline && (selectedStatus !== 'done' || comment === baselineComment)) {
        edits.delete(key);
      } else {
        edits.set(key, { kind: 'pill', rowId, col, wt, status: selectedStatus, comment, ts: new Date().toISOString() });
      }
      _renderPillVisualState(rowId, col, wt);
      pop.remove();
      _updateCounter();
    });
    // Click outside → cancel.
    setTimeout(() => {
      function onDoc(ev) {
        if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', onDoc, true); }
      }
      document.addEventListener('mousedown', onDoc, true);
    }, 0);
  }

  function _renderPillVisualState(rowId, col, wt) {
    const pills = document.querySelectorAll(\`.gantt-type-pill[data-row-id="\${CSS.escape(rowId)}"][data-src-col="\${CSS.escape(col)}"][data-wt="\${CSS.escape(wt)}"]\`);
    const key = 'pill:' + rowId + '__' + col + '__' + wt;
    const edited = edits.has(key);
    pills.forEach(p => p.classList.toggle('prizma-edited', edited));
  }

  /** Текущее (с учётом edits) состояние notes/risks для cell. */
  function _annotationsFor(rowId, col, kind) {
    const row = _rowById(rowId);
    if (!row) return [];
    const baseKey = kind === 'note' ? 'cellNotes' : 'cellRisks';
    const base = (row[baseKey] || []).filter(n => n && n.col === col);
    // Накладываем pending edits: delete/edit/add.
    const result = [];
    const editedIds = new Set();
    for (const item of base) {
      const key = kind + ':' + rowId + '__' + item.id;
      const ed = edits.get(key);
      if (!ed) { result.push(item); continue; }
      if (ed.action === 'delete') { editedIds.add(item.id); continue; }
      if (ed.action === 'edit') { result.push({ ...item, ...ed.payload }); editedIds.add(item.id); continue; }
    }
    // Plus newly-added items.
    for (const [k, ed] of edits) {
      if (!k.startsWith(kind + ':' + rowId + '__new__')) continue;
      if (ed.action !== 'add') continue;
      result.push({ ...ed.payload, id: ed.tempId, _pending: true });
    }
    return result;
  }

  const RISK_KIND_LABELS = { 'open-question': 'Открытый вопрос', 'dangling': 'Подвешено', 'hard-deadline': 'Жёсткий дедлайн' };

  function _openAnnotationPopup(anchor, kind) {
    document.getElementById('prizma-anno-popup')?.remove();
    const rowId = anchor.dataset.rowId;
    const col   = anchor.dataset.col;
    const row = _rowById(rowId);
    const epicLabel = (row?.epic || row?.tasks || '(без эпика)').slice(0, 60);
    let editingId = null;  // id заметки в edit-mode (null = list)

    function _render() {
      const items = _annotationsFor(rowId, col, kind);
      const editingItem = editingId ? items.find(i => i.id === editingId) : null;
      const isEditing = !!editingItem || editingId === 'new';
      const draft = editingItem || (editingId === 'new'
        ? (kind === 'note'
            ? { text: '' }
            : { kind: 'open-question', text: '', dueDate: '' })
        : null);

      const listHtml = items.length
        ? items.map(item => {
            const meta = kind === 'risk' ? \`<span class="prizma-anno-kind prizma-anno-kind-\${_esc(item.kind)}">\${_esc(RISK_KIND_LABELS[item.kind] || item.kind)}</span>\` : '';
            const due  = item.dueDate ? \`<span class="prizma-anno-due">до \${_esc(item.dueDate)}</span>\` : '';
            return \`<div class="prizma-anno-item\${item._pending ? ' is-pending' : ''}" data-id="\${_esc(item.id)}">
              <div class="prizma-anno-item-meta">\${meta}\${due}</div>
              <div class="prizma-anno-item-text">\${_esc(item.text)}</div>
              <div class="prizma-anno-item-actions">
                <button type="button" class="prizma-anno-edit" data-id="\${_esc(item.id)}" \${item._pending ? 'disabled title="Сначала сохраните, потом редактируйте"' : ''}>Изменить</button>
                <button type="button" class="prizma-anno-delete" data-id="\${_esc(item.id)}">Удалить</button>
              </div>
            </div>\`;
          }).join('')
        : '<div class="prizma-anno-empty">Пока пусто.</div>';

      const formHtml = isEditing ? \`
        <div class="prizma-anno-form">
          \${kind === 'risk' ? \`
            <label class="prizma-pop-label">Тип</label>
            <select class="prizma-anno-kind-select">
              \${['open-question','dangling','hard-deadline'].map(k => \`<option value="\${k}" \${draft.kind === k ? 'selected' : ''}>\${RISK_KIND_LABELS[k]}</option>\`).join('')}
            </select>
          \` : ''}
          <label class="prizma-pop-label">\${kind === 'note' ? 'Текст заметки' : 'Описание риска'}</label>
          <textarea class="prizma-pop-text prizma-anno-text" rows="3" placeholder="...">\${_esc(draft.text || '')}</textarea>
          \${kind === 'risk' ? \`
            <label class="prizma-pop-label">Дедлайн (опц.)</label>
            <input type="date" class="prizma-anno-due-input" value="\${_esc(draft.dueDate || '')}">
          \` : ''}
          <div class="prizma-anno-form-actions">
            <button type="button" class="prizma-edit-btn" data-anno-action="cancel">Отмена</button>
            <button type="button" class="prizma-edit-btn prizma-edit-btn-primary" data-anno-action="save">Сохранить</button>
          </div>
        </div>
      \` : \`<button type="button" class="prizma-anno-add" data-anno-action="add-new">+ Добавить \${kind === 'note' ? 'заметку' : 'риск'}</button>\`;

      pop.innerHTML = \`
        <div class="prizma-pop-head">
          <div class="prizma-pop-eyebrow">\${_esc(epicLabel)}</div>
          <div class="prizma-pop-title">\${kind === 'note' ? 'Заметки' : 'Риски'} · \${_esc(col)}</div>
          <button type="button" class="prizma-pop-close" aria-label="Закрыть">×</button>
        </div>
        <div class="prizma-anno-list">\${listHtml}</div>
        \${formHtml}
      \`;

      pop.querySelector('.prizma-pop-close').addEventListener('click', () => pop.remove());
      pop.querySelectorAll('.prizma-anno-edit').forEach(b => b.addEventListener('click', () => { editingId = b.dataset.id; _render(); }));
      pop.querySelectorAll('.prizma-anno-delete').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.id;
        const item = items.find(i => i.id === id);
        if (item?._pending) {
          // Pending add — просто очистить из edits.
          for (const [k] of edits) {
            if (edits.get(k).tempId === id) { edits.delete(k); break; }
          }
        } else {
          const key = kind + ':' + rowId + '__' + id;
          edits.set(key, { kind, action: 'delete', rowId, col, id, ts: new Date().toISOString() });
        }
        _markCellEdited(rowId, col, kind);
        _updateCounter();
        _render();
      }));
      pop.querySelector('[data-anno-action="add-new"]')?.addEventListener('click', () => { editingId = 'new'; _render(); });
      pop.querySelector('[data-anno-action="cancel"]')?.addEventListener('click', () => { editingId = null; _render(); });
      pop.querySelector('[data-anno-action="save"]')?.addEventListener('click', () => {
        const text = pop.querySelector('.prizma-anno-text').value.trim();
        if (!text) return;
        const payload = { col, text, createdAt: new Date().toISOString() };
        if (kind === 'risk') {
          payload.kind = pop.querySelector('.prizma-anno-kind-select').value;
          payload.dueDate = pop.querySelector('.prizma-anno-due-input').value || '';
        }
        if (editingId === 'new') {
          const tempId = (kind === 'note' ? 'note_' : 'risk_') + 'tmp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
          edits.set(kind + ':' + rowId + '__new__' + tempId, { kind, action: 'add', rowId, col, tempId, payload, ts: new Date().toISOString() });
        } else {
          edits.set(kind + ':' + rowId + '__' + editingId, { kind, action: 'edit', rowId, col, id: editingId, payload, ts: new Date().toISOString() });
        }
        editingId = null;
        _markCellEdited(rowId, col, kind);
        _updateCounter();
        _render();
      });
    }

    const pop = document.createElement('div');
    pop.id = 'prizma-anno-popup';
    pop.className = 'prizma-pop prizma-anno-pop';
    document.body.appendChild(pop);
    _render();
    // Position
    const r = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let left = r.left + r.width / 2 - pr.width / 2;
    let top  = r.bottom + 6;
    left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8));
    if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - pr.height - 6);
    pop.style.left = left + 'px';
    pop.style.top  = top  + 'px';
    setTimeout(() => {
      function onDoc(ev) {
        if (!pop.contains(ev.target) && ev.target !== anchor) { pop.remove(); document.removeEventListener('mousedown', onDoc, true); }
      }
      document.addEventListener('mousedown', onDoc, true);
    }, 0);
  }

  function _markCellEdited(rowId, col, kind) {
    // Маркируем cell-anchor когда у этой клетки есть pending edits.
    const sel = kind === 'note' ? '.gdt-cell-note-icon' : '.gdt-cell-risk-glyph';
    const els = document.querySelectorAll(\`\${sel}[data-row-id="\${CSS.escape(rowId)}"][data-col="\${CSS.escape(col)}"]\`);
    // Есть ли pending edit для этой клетки?
    let hasEdit = false;
    for (const [k] of edits) {
      if (k.startsWith(kind + ':' + rowId + '__')) {
        const e = edits.get(k);
        if (e.col === col) { hasEdit = true; break; }
      }
    }
    els.forEach(el => el.classList.toggle('prizma-edited', hasEdit));
  }

  function _esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Применить накопленные edits к копии snapshot.data.rows. */
  function _applyEditsToSnapshot(meta) {
    const next = JSON.parse(JSON.stringify(meta));
    const rows = next.snapshot?.data?.rows || [];
    const byId = Object.create(null);
    for (const r of rows) byId[r.id] = r;
    const todayISO = new Date().toISOString();
    const todayDate = todayISO.slice(0, 10);
    for (const [, e] of edits) {
      const row = byId[e.rowId];
      if (!row) continue;
      if (e.kind === 'pill') {
        if (!row.donePills) row.donePills = {};
        if (!row.inProgressPills) row.inProgressPills = {};
        const k = e.col + '__' + e.wt;
        if (e.status === 'done') {
          row.donePills[k] = { at: todayDate, comment: e.comment || '', ts: todayISO };
          delete row.inProgressPills[k];
        } else if (e.status === 'in-progress') {
          row.inProgressPills[k] = { at: todayISO };
          delete row.donePills[k];
        } else {
          delete row.donePills[k];
          delete row.inProgressPills[k];
        }
      } else if (e.kind === 'note' || e.kind === 'risk') {
        const field = e.kind === 'note' ? 'cellNotes' : 'cellRisks';
        if (!Array.isArray(row[field])) row[field] = [];
        if (e.action === 'delete') {
          row[field] = row[field].filter(n => n.id !== e.id);
        } else if (e.action === 'edit') {
          const idx = row[field].findIndex(n => n.id === e.id);
          if (idx >= 0) row[field][idx] = { ...row[field][idx], ...e.payload };
        } else if (e.action === 'add') {
          row[field].push({ id: e.tempId, ...e.payload });
        }
      }
      row.updatedAt = todayISO;
    }
    next.lastEditedAt = todayISO;
    return next;
  }

  /** Скачать текущий документ с обновлённым snapshot. Удаляет runtime UI
   *  (banner, popup, edit-marker class) перед сериализацией — получатель
   *  откроет «чистый» файл и сможет править с нуля. */
  function _downloadUpdated() {
    if (!edits.size) {
      alert('Нет правок для сохранения.');
      return;
    }
    const updatedMeta = _applyEditsToSnapshot(snap);
    // Clone document, очистить runtime artifacts, заменить snapshot, скачать.
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('#prizma-edit-bar, #prizma-pill-popup').forEach(el => el.remove());
    clone.querySelectorAll('.prizma-edited').forEach(el => el.classList.remove('prizma-edited'));
    const snapEl = clone.querySelector('#prizma-snapshot');
    if (snapEl) snapEl.textContent = JSON.stringify(updatedMeta).replace(/</g, '\\u003c');
    const html = '<!DOCTYPE html>\\n' + clone.outerHTML;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = 'gantt_edited_' + dateStr + '_' + snap.exportId.slice(0, 8) + '.html';
    a.click();
    URL.revokeObjectURL(url);
    // После save очистка edits + visual reset.
    edits.clear();
    document.querySelectorAll('.gantt-type-pill.prizma-edited').forEach(p => p.classList.remove('prizma-edited'));
    _updateCounter();
    alert('Файл скачан. Отправьте его обратно тому, кто прислал — он импортирует правки.');
  }

  function _init() {
    _renderBanner();
    document.getElementById('prizma-edit-toggle')?.addEventListener('click', () => {
      editMode = !editMode;
      _renderBanner();
      if (editMode) _wireEditors();
      else document.getElementById('prizma-pill-popup')?.remove();
    });
    document.getElementById('prizma-edit-download')?.addEventListener('click', _downloadUpdated);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
  else _init();
})();
`;

/* Стили банера + edit-mode маркеров. Inline чтобы не зависеть от внешнего CSS. */
const _EDITOR_CSS = `
#prizma-edit-bar {
  position: sticky; top: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 10px 24px;
  background: #fef3c7; color: #78350f;
  border-bottom: 1px solid #f59e0b;
  font: 500 13px/1.4 system-ui, sans-serif;
}
#prizma-edit-bar[data-mode="edit"] { background: #fee2e2; color: #7f1d1d; border-bottom-color: #dc2626; }
.prizma-edit-status { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.prizma-edit-status strong { font-size: 13px; }
.prizma-edit-status #prizma-edit-sub { font-size: 11px; opacity: .85; }
.prizma-edit-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
#prizma-edit-counter { font-size: 12px; font-variant-numeric: tabular-nums; }
.prizma-edit-btn {
  padding: 6px 12px; border: 1px solid currentColor; background: transparent;
  color: inherit; border-radius: 4px; cursor: pointer; font: 600 12px system-ui;
}
.prizma-edit-btn:hover { background: rgba(0,0,0,.05); }
.prizma-edit-btn-primary { background: #16a34a; color: #fff; border-color: #16a34a; }
.prizma-edit-btn-primary:hover { background: #15803d; }
/* Edit-mode visual: лёгкая dashed-рамка на editable hover'ах. */
body.prizma-edit-mode .gantt-type-pill { cursor: pointer; }
body.prizma-edit-mode .gantt-type-pill:hover { outline: 2px dashed rgba(220,38,38,.5); outline-offset: 2px; }
.gantt-type-pill.prizma-edited {
  outline: 2px solid #16a34a !important;
  outline-offset: 2px;
  position: relative;
}
.gantt-type-pill.prizma-edited::after {
  content: '●';
  position: absolute;
  top: -6px; right: -6px;
  width: 10px; height: 10px;
  background: #16a34a;
  color: #16a34a;
  font-size: 0;
  border-radius: 50%;
  z-index: 5;
}

/* Pill popup. */
.prizma-pop {
  position: fixed;
  z-index: 1100;
  width: 320px;
  background: #fff;
  border: 1px solid #d4d4d8;
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0,0,0,.18);
  color: #18181b;
  font: 13px/1.4 system-ui, sans-serif;
}
.prizma-pop-head {
  padding: 10px 14px 8px;
  border-bottom: 1px solid #e4e4e7;
  position: relative;
}
.prizma-pop-eyebrow { font: 600 10px/1 system-ui; color: #71717a; letter-spacing: .6px; text-transform: uppercase; margin-bottom: 4px; }
.prizma-pop-title { font: 600 14px/1.3 system-ui; }
.prizma-pop-close {
  position: absolute; top: 6px; right: 8px;
  background: transparent; border: 0; font-size: 18px; line-height: 1; color: #71717a;
  cursor: pointer; padding: 4px 6px;
}
.prizma-pop-close:hover { color: #18181b; }
.prizma-pop-body { padding: 10px 14px; display: flex; flex-direction: column; gap: 10px; }
.prizma-pop-field { display: flex; flex-direction: column; gap: 4px; }
.prizma-pop-label { font: 600 10px/1 system-ui; color: #71717a; letter-spacing: .6px; text-transform: uppercase; }
.prizma-pop-radios { display: flex; gap: 6px; }
.prizma-pop-radio {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px; border: 1px solid #d4d4d8; border-radius: 6px;
  cursor: pointer; font-size: 12px; font-weight: 500; background: #fff;
  transition: border-color .12s, background .12s;
}
.prizma-pop-radio:hover { border-color: #4f46e5; }
.prizma-pop-radio input { margin: 0; }
.prizma-pop-radio.is-active { border-color: #16a34a; background: #f0fdf4; color: #166534; }
.prizma-pop-text {
  width: 100%; box-sizing: border-box;
  padding: 6px 8px; border: 1px solid #d4d4d8; border-radius: 4px;
  font: inherit; font-size: 13px; resize: vertical; min-height: 50px;
}
.prizma-pop-text:focus { border-color: #4f46e5; outline: 0; box-shadow: 0 0 0 3px rgba(79,70,229,.12); }
.prizma-pop-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px 12px; gap: 8px;
  border-top: 1px solid #e4e4e7;
}
.prizma-pop-actions { display: flex; gap: 6px; }

/* Annotation popup (notes + risks). */
.prizma-anno-pop { width: 340px; }
.prizma-anno-list { padding: 8px 14px; max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.prizma-anno-empty { padding: 12px; text-align: center; color: #71717a; font-size: 12px; }
.prizma-anno-item {
  background: #fafafa; border: 1px solid #e4e4e7; border-radius: 6px;
  padding: 8px 10px; font-size: 12px; display: flex; flex-direction: column; gap: 4px;
}
.prizma-anno-item.is-pending { border-color: #16a34a; background: #f0fdf4; }
.prizma-anno-item-meta { display: flex; gap: 6px; flex-wrap: wrap; font-size: 10px; }
.prizma-anno-kind {
  padding: 2px 6px; border-radius: 8px; font-weight: 700;
  background: #fef3c7; color: #92400e;
}
.prizma-anno-kind-dangling { background: #eef2ff; color: #4338ca; }
.prizma-anno-kind-hard-deadline { background: #fee2e2; color: #991b1b; }
.prizma-anno-due { color: #dc2626; font-weight: 600; }
.prizma-anno-item-text { color: #18181b; white-space: pre-wrap; word-break: break-word; }
.prizma-anno-item-actions { display: flex; gap: 4px; justify-content: flex-end; }
.prizma-anno-item-actions button {
  background: transparent; border: 0; padding: 2px 6px; font-size: 11px;
  color: #71717a; cursor: pointer; border-radius: 3px;
}
.prizma-anno-item-actions button:hover { color: #4f46e5; background: #eef2ff; }
.prizma-anno-item-actions .prizma-anno-delete:hover { color: #dc2626; background: #fee2e2; }
.prizma-anno-item-actions button:disabled { opacity: .4; cursor: default; }
.prizma-anno-add {
  margin: 4px 14px 12px; padding: 8px 12px;
  background: transparent; border: 1px dashed #d4d4d8; border-radius: 6px;
  color: #71717a; cursor: pointer; font: 600 12px system-ui;
}
.prizma-anno-add:hover { border-color: #4f46e5; color: #4f46e5; }
.prizma-anno-form { padding: 6px 14px 12px; display: flex; flex-direction: column; gap: 6px; border-top: 1px solid #e4e4e7; }
.prizma-anno-kind-select, .prizma-anno-due-input {
  padding: 6px 8px; border: 1px solid #d4d4d8; border-radius: 4px; font: inherit; font-size: 12px;
  background: #fff; color: #18181b;
}
.prizma-anno-text { font-size: 12px; }
.prizma-anno-form-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 4px; }

body.prizma-edit-mode .gdt-cell-note-icon,
body.prizma-edit-mode .gdt-cell-risk-glyph { cursor: pointer; }
.gdt-cell-note-icon.prizma-edited,
.gdt-cell-risk-glyph.prizma-edited {
  outline: 2px solid #16a34a;
  outline-offset: 1px;
  border-radius: 50%;
}
`;

/**
 * Сформировать editable HTML. Базируется на GanttHTMLExport.build()
 * (без модификации того модуля) + инъекции snapshot и editor перед </body>.
 */
async function _buildEditableHtml() {
  // keepIds: true — НЕ стрипать data-row-id / data-src-col на pills/cells,
  // editor нужен для identify (rowId + colKey + wt).
  // keepEditable: true — оставить .gdt-cell-note-icon.is-empty / risk-glyph.is-empty
  // чтобы редактор мог открывать popover для add-note/risk.
  const baseHtml = await GanttHTMLExport.build({ keepIds: true, keepEditable: true });
  if (!baseHtml) return '';

  const snapshot = JSONExport.buildSnapshot();
  const meta = {
    version: 1,
    exportId: _uuid(),
    dataSource: _detectDataSource(),
    exportedAt: new Date().toISOString(),
    editableSchema: 1,
    snapshot,
  };
  // JSON.stringify в `<script>` блок: экранируем `</` чтобы не закрыть тэг
  // случайно (правило MDN для embedded JSON).
  const safeJson = JSON.stringify(meta).replace(/</g, '\\u003c');

  const injection = `
<style>${_EDITOR_CSS}</style>
<script id="prizma-snapshot" type="application/json">${safeJson}</script>
<script>${_EDITOR_JS}</script>
`;
  // Вставляем перед </body>. Существующий ganttHtmlExport не модифицируется.
  return baseHtml.replace(/<\/body>\s*<\/html>\s*$/i, injection + '\n</body>\n</html>');
}

export const GanttEditableHTMLExport = {
  async download() {
    const html = await _buildEditableHtml();
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gantt_editable_${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
    window.showToast?.('Гант экспортирован для правки. Передайте файл редакторам.', 'success', 2800);
  },
  build() { return _buildEditableHtml(); },
};
