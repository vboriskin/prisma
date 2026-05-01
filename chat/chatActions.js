'use strict';
/* ============================================================
   CHAT ACTIONS — v10_0
   Executes structured actions triggered by assistant messages.
   Includes batch preview/apply and change-log writing.
   ============================================================ */

import { state, notify } from '../state.js';
import { writeChangeLogEntry } from './chatReports.js';

/* ── Helpers ─────────────────────────────────────────────── */

function showToast(msg, type) {
  try { window.showToast?.(msg, type); } catch(_) {}
}

function navigateTo(section) {
  try {
    if (window.App?.goTo) { window.App.goTo(section); return; }
    const btn = document.querySelector(`.nav-item[data-section="${section}"]`);
    if (btn) btn.click();
  } catch(_) {}
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Filter helpers ──────────────────────────────────────── */

/**
 * Match rows against a filter spec from batch intent params.
 * Supports: isUnassigned, noAssignee, scopeStatus, release (e.g. '122'),
 *           onlyBlocking, onlyRisky, team, ids
 */
export function matchRowsByFilter(filter = {}) {
  return state.rows.filter(r => {
    if (Array.isArray(filter.ids) && filter.ids.length) return filter.ids.includes(r.id);
    if (filter.isUnassigned   && !r.isUnassigned)                    return false;
    if (filter.noAssignee     && r.assignee && r.assignee.trim())    return false;
    if (filter.scopeStatus    && r.scopeStatus !== filter.scopeStatus) return false;
    if (filter.onlyBlocking   && !r.blockingDependency)              return false;
    if (filter.onlyRisky      && !(r.riskFlags||[]).length)          return false;
    if (filter.team           && !(r.team||'').toLowerCase().includes(filter.team.toLowerCase())) return false;
    if (filter.release) {
      const rel = String(filter.release);
      const keyMap = { '120': 'hasRelease120', '121': 'hasRelease121', '122': 'hasRelease122', 'ot': 'hasOvertime' };
      const key = keyMap[rel];
      if (key && !r[key]) return false;
    }
    return true;
  });
}

/* ── Batch preview ───────────────────────────────────────── */

const ACTION_LABELS = {
  assign_release: 'Назначить в релиз',
  set_scope:      'Изменить scopeStatus',
  mark_done:      'Отметить как сделано',
  set_comment:    'Добавить комментарий',
  clear_blocker:  'Снять блокер',
};

const RELEASE_LABELS = { '120':'1.20', '121':'1.21', '122':'1.22', 'ot':'Овертайм' };

function describeAction(action, value) {
  if (action === 'assign_release')  return `→ Релиз ${RELEASE_LABELS[value] || value}`;
  if (action === 'set_scope')       return `→ scope = "${value}"`;
  if (action === 'mark_done')       return `→ Отметить сделано`;
  if (action === 'set_comment')     return `→ Комментарий: "${String(value||'').slice(0,40)}"`;
  if (action === 'clear_blocker')   return `→ Снять блокер`;
  return `→ ${action}`;
}

/**
 * Build a preview response for a batch action.
 * Stores the pending batch in state.llm.pendingBatch.
 */
export function buildBatchPreview(batchParams) {
  const { action, filter, value, label } = batchParams;
  if (!action) {
    return {
      text: 'Не удалось определить действие. Уточни запрос.',
      cards: [], actions: [], drilldown: [],
    };
  }

  const matched = matchRowsByFilter(filter || {});
  const batchId = 'batch_' + Date.now();

  // Store pending batch
  if (state.llm) {
    state.llm.pendingBatch = {
      id: batchId, action, filter, value,
      rowIds: matched.map(r => r.id),
      label: label || `${ACTION_LABELS[action]||action} (${matched.length})`,
    };
  }

  if (matched.length === 0) {
    return {
      text: `## Предварительный просмотр\n\nПо заданным критериям задач **не найдено**. Уточни фильтр.`,
      cards: [], actions: [], drilldown: [],
    };
  }

  const preview5 = matched.slice(0, 5);
  const moreCount = matched.length - preview5.length;
  const previewLines = preview5.map(r =>
    `- **${esc(r.epic||r.tasks||'—')}** · ${esc(r.team||'—')} · scope: ${esc(r.scopeStatus||'—')}`
  ).join('\n');

  const actionDesc = describeAction(action, value);
  const text = `## Предварительный просмотр действия

**Действие:** ${ACTION_LABELS[action]||action} ${actionDesc}
**Затронутых строк:** ${matched.length}

### Первые примеры:
${previewLines}${moreCount > 0 ? `\n- _...и ещё ${moreCount} задач_` : ''}

**Подтвердить?** Нажми «Применить» или напиши «да». Для отмены — «нет».`;

  const actions = [
    {
      label: `✓ Применить (${matched.length})`,
      type: 'confirm_batch',
      payload: { batchId },
      primary: true,
    },
    {
      label: '✕ Отмена',
      type: 'cancel_batch',
      payload: { batchId },
    },
  ];

  const drilldown = [
    { text: 'Уточнить фильтр', prompt: 'Уточни, для каких именно задач нужно выполнить это действие.' },
  ];

  return { text, cards: [], actions, drilldown };
}

/* ── Batch apply ─────────────────────────────────────────── */

/**
 * Apply the stored pending batch action.
 */
export function applyPendingBatch(batchId) {
  const pending = state.llm?.pendingBatch;
  if (!pending) {
    return { ok: false, message: 'Нет ожидающего действия для применения.' };
  }
  if (batchId && pending.id !== batchId) {
    return { ok: false, message: 'ID действия не совпадает.' };
  }

  const { action, rowIds, value, label } = pending;
  if (!rowIds || !rowIds.length) {
    state.llm.pendingBatch = null;
    return { ok: false, message: 'Список задач пуст.' };
  }

  // Map to applyBulkAction format
  const actionTypeMap = {
    assign_release: 'assign_release',
    set_scope:      'set_scope',
    mark_done:      'mark_done',
    set_comment:    'set_comment',
    clear_blocker:  'clear_blocker',
  };

  const payloadMap = {
    assign_release: { release: value, types: ['backend'], _label: label },
    set_scope:      { scope: value, _label: label },
    mark_done:      { done: true, _label: label },
    set_comment:    { comment: value || '', append: true, _label: label },
    clear_blocker:  { _label: label },
  };

  const bulkAction  = actionTypeMap[action];
  const bulkPayload = payloadMap[action] || { _label: label };

  // Capture before-state for change log
  const beforeState = rowIds.map(id => {
    const r = state.rows.find(row => row.id === id);
    if (!r) return null;
    let oldVal, field;
    if (action === 'assign_release') { field = `release${value}Types`; oldVal = (r[field]||[]).slice(); }
    if (action === 'set_scope')      { field = 'scopeStatus'; oldVal = r.scopeStatus; }
    if (action === 'mark_done')      { field = 'isDone'; oldVal = r.isDone; }
    if (action === 'set_comment')    { field = 'comment'; oldVal = r.comment; }
    if (action === 'clear_blocker')  { field = 'blockingDependency'; oldVal = r.blockingDependency; }
    return { rowId: id, epic: r.epic || r.tasks || '', field, oldVal };
  }).filter(Boolean);

  // Execute via applyBulkAction from dataStore (available globally via window)
  try {
    window.applyBulkAction?.(rowIds, bulkAction, bulkPayload);
  } catch(_) {
    // Fallback: direct mutation if applyBulkAction not on window
    const ids = new Set(rowIds);
    state.rows.filter(r => ids.has(r.id)).forEach(r => {
      if (action === 'assign_release') {
        const field = `release${value}Types`;
        if (!Array.isArray(r[field])) r[field] = [];
        if (!r[field].length) r[field] = ['backend'];
        r.dirty = true; r.updatedAt = new Date().toISOString();
        try { window.RowFactory?.updateDerived(r); } catch(_) {}
      }
      if (action === 'set_scope')    { r.scopeStatus = value; r.dirty = true; r.updatedAt = new Date().toISOString(); }
      if (action === 'mark_done')    { r.isDone = true; if (!r.doneDate) r.doneDate = new Date().toISOString().slice(0,10); r.dirty = true; r.updatedAt = new Date().toISOString(); }
      if (action === 'set_comment')  { r.comment = r.comment ? r.comment + '\n' + (value||'') : (value||''); r.dirty = true; r.updatedAt = new Date().toISOString(); }
      if (action === 'clear_blocker'){ r.blockingDependency = false; r.blockingDeadline = ''; r.dirty = true; r.updatedAt = new Date().toISOString(); }
    });
    try { window.Storage?.save(); } catch(_) {}
    notify('chat_batch');
  }

  // Write change log
  const changes = beforeState.map(b => {
    const r = state.rows.find(row => row.id === b.rowId);
    let newVal = b.oldVal;
    if (r) {
      if (action === 'assign_release') newVal = (r[`release${value}Types`]||[]).slice();
      if (action === 'set_scope')      newVal = r.scopeStatus;
      if (action === 'mark_done')      newVal = r.isDone;
      if (action === 'set_comment')    newVal = r.comment;
      if (action === 'clear_blocker')  newVal = r.blockingDependency;
    }
    return { ...b, newVal };
  });

  writeChangeLogEntry({ action, label, rowIds, changes, source: 'chat' });

  state.llm.pendingBatch = null;
  showToast(`✓ Применено к ${rowIds.length} задачам`, 'success');
  return { ok: true, count: rowIds.length, label };
}

/* ── Standard action handlers ────────────────────────────── */

function handleNavigate(payload) {
  navigateTo(payload.section || 'dashboard');
  showToast(`Переход → ${payload.section}`);
}

function handleApplyFilter(payload) {
  try {
    const f = state.filters;
    if (payload.team         !== undefined) f.team         = payload.team;
    if (payload.release      !== undefined) f.release      = payload.release;
    if (payload.workType     !== undefined) f.workType     = payload.workType;
    if (payload.assignee     !== undefined) f.assignee     = payload.assignee;
    if (payload.search       !== undefined) f.search       = payload.search;
    if (payload.scope        !== undefined) f.scope        = payload.scope;
    if (payload.onlyBlocking !== undefined) f.onlyBlocking = !!payload.onlyBlocking;
    if (payload.onlyRisky    !== undefined) f.onlyRisky    = !!payload.onlyRisky;
    if (payload.onlyDone     !== undefined) f.onlyDone     = !!payload.onlyDone;
    notify('chat_filter');
    showToast('Фильтры применены');
    if (!payload.noNavigate) navigateTo('registry');
  } catch (e) {
    showToast('Ошибка применения фильтров: ' + (e.message || e), 'error');
  }
}

function handleClearFilters() {
  const f = state.filters;
  f.search = ''; f.team = ''; f.scope = ''; f.release = '';
  f.workType = ''; f.role = ''; f.assignee = ''; f.tag = '';
  f.onlyBlocking = false; f.onlyRisky = false; f.onlyDone = false; f.preset = null;
  notify('chat_filter_clear');
  showToast('Фильтры сброшены');
}

function handlePreviewRelease(payload) {
  navigateTo('gantt');
  if (payload.release) {
    const sel = document.getElementById('gantt-mode');
    if (sel) { sel.value = 'detailed'; sel.dispatchEvent(new Event('change')); }
  }
  showToast(`Предпросмотр: Гант → ${payload.release || ''}`);
}

function handleSendPrompt(payload) {
  const input = document.getElementById('assistant-input');
  if (input && payload.prompt) {
    input.value = payload.prompt;
    input.dispatchEvent(new Event('input'));
    const sendBtn = document.getElementById('assistant-btn-send');
    if (sendBtn && !sendBtn.disabled) sendBtn.click();
  }
}

function handleSetReviewMode(payload) {
  const role = payload.role || 'ceo';
  if (state.llm) state.llm.reviewMode = role;
  const labels = { ceo: 'CEO', dm: 'Delivery Manager', risk: 'Risk Officer', lead: 'Team Lead' };
  showToast(`Режим обзора: ${labels[role] || role}`);
}

function handleCopyText(payload) {
  const text = String(payload.text || '');
  if (!text) return;
  navigator.clipboard?.writeText(text).then(
    () => showToast('Скопировано'),
    () => {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      showToast('Скопировано');
    }
  );
}

function handleExportSummary(payload) {
  const text = String(payload.text || '');
  if (!text) { showToast('Нет текста для экспорта'); return; }
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `planning-summary-${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  showToast('Файл скачан');
}

function handleConfirmBatch(payload) {
  const result = applyPendingBatch(payload.batchId);
  if (!result.ok) showToast(result.message || 'Не удалось применить', 'error');
  return result;
}

function handleCancelBatch() {
  if (state.llm) state.llm.pendingBatch = null;
  showToast('Действие отменено');
}

function handleTakeSnapshot() {
  try {
    window.takeSnapshot?.();
    showToast('📸 Снимок сохранён');
  } catch(_) {
    showToast('Не удалось сохранить снимок', 'error');
  }
}

/* ── Dispatcher ──────────────────────────────────────────── */

export function executeAction(type, payload = {}) {
  switch (type) {
    case 'navigate':        return handleNavigate(payload);
    case 'apply_filter':    return handleApplyFilter(payload);
    case 'clear_filters':   return handleClearFilters();
    case 'preview_release': return handlePreviewRelease(payload);
    case 'send_prompt':     return handleSendPrompt(payload);
    case 'set_review_mode': return handleSetReviewMode(payload);
    case 'copy_text':       return handleCopyText(payload);
    case 'export_summary':  return handleExportSummary(payload);
    case 'confirm_batch':   return handleConfirmBatch(payload);
    case 'cancel_batch':    return handleCancelBatch();
    case 'take_snapshot':   return handleTakeSnapshot();
    default:
      console.warn('[ChatActions] Unknown action type:', type, payload);
  }
}

/**
 * Bind action button clicks on the messages container.
 * Called once during LLMAssistant.bindUI().
 */
export function bindActionClicks(messagesWrap) {
  if (!messagesWrap) return;

  messagesWrap.addEventListener('click', (e) => {
    // Action buttons
    const btn = e.target.closest('[data-action-type]');
    if (btn) {
      const type = btn.dataset.actionType || '';
      let payload = {};
      try { payload = JSON.parse(btn.dataset.actionPayload || '{}'); } catch(_) {}
      const result = executeAction(type, payload);
      // If confirm_batch was applied, refresh messages to reflect the confirmed state
      if (type === 'confirm_batch' && result?.ok) {
        try { window.LLMAssistant?.renderMessages(); } catch(_) {}
      }
      return;
    }

    // Alert card prompt buttons (data-prompt)
    const promptBtn = e.target.closest('[data-prompt]');
    if (promptBtn && !promptBtn.classList.contains('chat-drilldown-btn')) {
      const prompt = promptBtn.dataset.prompt || '';
      if (prompt) handleSendPrompt({ prompt });
      return;
    }

    // Drilldown prompts
    const drillBtn = e.target.closest('.chat-drilldown-btn');
    if (drillBtn) {
      const prompt = drillBtn.dataset.prompt || drillBtn.textContent || '';
      if (prompt) {
        const input = document.getElementById('assistant-input');
        if (input) { input.value = prompt; input.dispatchEvent(new Event('input')); input.focus(); }
      }
    }
  });
}
