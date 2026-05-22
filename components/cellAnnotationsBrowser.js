'use strict';
/* ============================================================
   CELL ANNOTATIONS BROWSER — список всех заметок и рисков

   #4 — модалка вызывается из toolbar Ганта. Tabs «Заметки» / «Риски»,
   карточки с epic / release / content / time. Click → закрывает модалку
   и скроллит к нужной ячейке с краткой подсветкой.
   ============================================================ */

import { state } from '../state.js';
import { Utils } from '../utils.js';
import { buildReleaseList } from '../constants.js';

const RISK_KIND_LABELS = {
  'open-question':  'Открытый вопрос',
  'dangling':       'Подвешено',
  'hard-deadline':  'Жёсткий дедлайн',
};

export function openAnnotationsBrowser() {
  document.getElementById('modal-annotations-browser')?.remove();
  const esc = (s) => Utils.escapeHtml(String(s ?? ''));

  // Собираем все аннотации.
  const releases = buildReleaseList(state.releases || []);
  const relMap = Object.create(null);
  for (const r of releases) relMap[r.key] = r;

  const notes = [];
  const risks = [];
  for (const row of state.rows || []) {
    if (Array.isArray(row.cellNotes)) {
      for (const n of row.cellNotes) {
        notes.push({ ...n, rowId: row.id, epic: row.epic, team: row.team });
      }
    }
    if (Array.isArray(row.cellRisks)) {
      for (const r of row.cellRisks) {
        risks.push({ ...r, rowId: row.id, epic: row.epic, team: row.team });
      }
    }
  }
  // Сортировка: новые сверху.
  notes.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const _card = (item, kind) => {
    const rel = relMap[item.col];
    const relLabel = rel ? (rel.short || rel.label || item.col) : item.col;
    const time = item.createdAt ? _fmtTime(item.createdAt) : '';
    const due  = item.dueDate ? `<span class="cab-due">До ${esc(_fmtDate(item.dueDate))}</span>` : '';
    const kindLabel = kind === 'risk' ? RISK_KIND_LABELS[item.kind] || item.kind : '';
    const kindTag = kindLabel ? `<span class="cab-kind cab-kind-${esc(item.kind)}">${esc(kindLabel)}</span>` : '';
    return `<button type="button" class="cab-card" data-row-id="${esc(item.rowId)}" data-col="${esc(item.col)}" data-kind="${esc(kind)}">
      <div class="cab-card-head">
        <span class="cab-card-epic">${esc(item.epic || '(без эпика)')}</span>
        <span class="cab-card-team">${esc(item.team || '—')}</span>
        <span class="cab-card-rel">${esc(relLabel)}</span>
      </div>
      ${kindTag ? `<div class="cab-card-meta">${kindTag}${due}</div>` : (due ? `<div class="cab-card-meta">${due}</div>` : '')}
      <div class="cab-card-text">${esc(item.text || '')}</div>
      ${time ? `<div class="cab-card-time">${esc(time)}</div>` : ''}
    </button>`;
  };

  const notesHtml = notes.length
    ? notes.map(n => _card(n, 'note')).join('')
    : '<div class="cab-empty">Пока нет заметок. Добавьте их кликом по иконке в углу ячейки.</div>';
  const risksHtml = risks.length
    ? risks.map(r => _card(r, 'risk')).join('')
    : '<div class="cab-empty">Пока нет рисков. Добавьте их кликом по «!»-иконке в углу ячейки.</div>';

  const html = `
    <div class="modal-overlay" id="modal-annotations-browser" role="dialog" aria-modal="true" aria-labelledby="cab-title">
      <div class="modal-box cab-modal-box">
        <div class="modal-header">
          <div class="re-modal-eyebrow">АННОТАЦИИ ЯЧЕЕК</div>
          <h3 id="cab-title">Все заметки и риски</h3>
          <button class="modal-close-btn" type="button" aria-label="Закрыть" data-close-modal>×</button>
        </div>
        <div class="cab-tabs" role="tablist">
          <button class="cab-tab is-active" data-tab="notes" role="tab">Заметки <span class="cab-tab-count">${notes.length}</span></button>
          <button class="cab-tab" data-tab="risks" role="tab">Риски <span class="cab-tab-count">${risks.length}</span></button>
        </div>
        <div class="cab-body">
          <div class="cab-pane is-active" data-pane="notes">${notesHtml}</div>
          <div class="cab-pane" data-pane="risks">${risksHtml}</div>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-annotations-browser');
  const close = () => overlay?.remove();
  overlay?.addEventListener('click', (ev) => {
    if (ev.target === overlay || ev.target.closest?.('[data-close-modal]')) close();
  });
  document.addEventListener('keydown', function esc2(ev) {
    if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); }
  });

  // Tabs.
  overlay.querySelectorAll('.cab-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const key = tab.dataset.tab;
      overlay.querySelectorAll('.cab-tab').forEach(t => t.classList.toggle('is-active', t === tab));
      overlay.querySelectorAll('.cab-pane').forEach(p => p.classList.toggle('is-active', p.dataset.pane === key));
    });
  });

  // Card click → close + scroll-to-cell + highlight.
  overlay.querySelectorAll('.cab-card').forEach(card => {
    card.addEventListener('click', () => {
      const rowId = card.dataset.rowId;
      const col = card.dataset.col;
      close();
      _scrollAndHighlight(rowId, col);
    });
  });

  return close;
}

function _scrollAndHighlight(rowId, col) {
  const esc = (s) => (window.CSS?.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'));
  // Если колодец скрыт через локальный «глаз» — возвращаем его, чтобы можно
  // было увидеть аннотацию.
  if (Array.isArray(state.ganttHiddenReleases) && state.ganttHiddenReleases.includes(col)) {
    state.ganttHiddenReleases = state.ganttHiddenReleases.filter(k => k !== col);
    // re-render Ганта произойдёт через reactive
  }
  setTimeout(() => {
    const cell = document.querySelector(`.gantt-cell[data-row-id="${esc(rowId)}"][data-col="${esc(col)}"]`);
    if (!cell) {
      window.showToast?.('Не удалось найти ячейку', 'warning', 2000);
      return;
    }
    cell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    cell.classList.add('gdt-cell-highlight');
    setTimeout(() => cell.classList.remove('gdt-cell-highlight'), 1800);
  }, 250);
}

function _fmtTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch (_) { return iso || ''; }
}
function _fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
  catch (_) { return iso; }
}
