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

  // Накопитель правок (Map<rowId, partialRow>). Naполняется в C2-C3.
  const edits = new Map();
  let editMode = false;

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

  // C2/C3 точки расширения. Сейчас пустые.
  function _wireEditors() { /* TODO C2: pill click → done-popup */ }
  function _downloadUpdated() {
    // TODO C4: re-serialize snapshot + download.
    alert('C4: «Скачать обновлённую копию» в разработке.');
  }

  document.addEventListener('DOMContentLoaded', () => {
    _renderBanner();
    document.getElementById('prizma-edit-toggle').addEventListener('click', () => {
      editMode = !editMode;
      _renderBanner();
      if (editMode) _wireEditors();
    });
    document.getElementById('prizma-edit-download')?.addEventListener('click', _downloadUpdated);
  });
  // Если DOM уже загружен (script внизу body) — fire сразу.
  if (document.readyState !== 'loading') {
    _renderBanner();
    document.getElementById('prizma-edit-toggle')?.addEventListener('click', () => {
      editMode = !editMode;
      _renderBanner();
      if (editMode) _wireEditors();
    });
    document.getElementById('prizma-edit-download')?.addEventListener('click', _downloadUpdated);
  }
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
/* Edit-mode visual: лёгкая dashed-рамка на editable hover'ах. Активируется в C2. */
body.prizma-edit-mode .gantt-type-pill { cursor: pointer; }
body.prizma-edit-mode .gantt-type-pill:hover { outline: 2px dashed rgba(220,38,38,.5); outline-offset: 2px; }
`;

/**
 * Сформировать editable HTML. Базируется на GanttHTMLExport.build()
 * (без модификации того модуля) + инъекции snapshot и editor перед </body>.
 */
async function _buildEditableHtml() {
  const baseHtml = await GanttHTMLExport.build();
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
