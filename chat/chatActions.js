'use strict';
/* ============================================================
   CHAT ACTIONS — v10_0
   Executes structured actions triggered by assistant messages.
   Includes batch preview/apply and change-log writing.
   ============================================================ */

import { state, notify } from '../state.js';
import { writeChangeLogEntry } from './chatReports.js';
import { trackBulk as _telBulk, trackLLM as _telLLM } from '../integrations/telemetry.js';
import { Services } from '../app/services.js';

/* ── Helpers ─────────────────────────────────────────────── */

// AUDIT_HOLISTIC паттерн 9 / Идея 14 — migrated.
// Local helper теперь делегирует в чистый `Toast.*` API (см. app/toast.js)
// с back-compat fallback на legacy `window.showToast`. Это закрывает 16 callsites
// в этом файле одним переключением вместо ручной правки каждого.
const _TYPE_MAP = { success:'success', ok:'success', error:'error', err:'error',
                    info:'info', warn:'warn', warning:'warn', loading:'loading' };
function showToast(msg, type) {
  try {
    const T = Services.Toast;
    if (T && typeof T.success === 'function') {
      const m = _TYPE_MAP[type] || 'success';
      return T[m](msg);
    }
    return window.showToast?.(msg, type);
  } catch(_) {}
}

function navigateTo(section) {
  // F5 fix (chat-04 audit) — приоритет Nav.goTo (проставляет data-active-module,
  // <title>, обновляет chip-bar), затем legacy App.goTo, затем DOM-fallback.
  try {
    if (Services.Nav?.goTo) { Services.Nav.goTo(section); return; }
    if (Services.App?.goTo) { Services.App.goTo(section); return; }
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
      // F2 fix (chat-04 audit) — нормализуем оба формата: '1.21' и '121'.
      // chatEngine выдаёт `replace('.','')`, но Реестр хранит '1.21' — без
      // нормализации matchRowsByFilter не находил ничего.
      const rel = String(filter.release).replace('.', '').toLowerCase();
      const keyMap = { '120': 'hasRelease120', '121': 'hasRelease121', '122': 'hasRelease122', 'ot': 'hasOvertime', 'overtime': 'hasOvertime' };
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
  // V22 — telemetry bulk preview.
  try { _telBulk('preview', { rowsCount: matched.length, actionType: action }); } catch (_) {}

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
      label: `Применить (${matched.length})`,
      type: 'confirm_batch',
      payload: { batchId },
      primary: true,
    },
    {
      label: 'Отмена',
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

  // F8 fix (chat-04 audit): не передаём hard-coded types:['backend'] для
  // assign_release. applyBulkAction должен сохранить существующие types
  // (frontend/QA chip-выбор), назначив release-флаг — иначе чат стирает
  // ручную разметку. types=undefined => preserve.
  const payloadMap = {
    assign_release: { release: value, _label: label },
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
    // F1 fix (chat-04 audit, CLAUDE.md контракт #1) — fallback mass-mutation
    // ОБЯЗАН быть в Reactive.silent(), иначе на каждой из N строк Proxy
    // триггерит debounce save + App.refreshAll. На N=50 это 50 reflows.
    // F8 fix: убран hard-coded `r[field] = ['backend']` — preserve существующие.
    const ids = new Set(rowIds);
    const apply = () => {
      state.rows.filter(r => ids.has(r.id)).forEach(r => {
        if (action === 'assign_release') {
          const field = `release${value}Types`;
          if (!Array.isArray(r[field])) r[field] = [];
          // preserve types: если массив пуст — оставить пустым (UI знает дефолт),
          // НЕ переписывать ['backend'] поверх.
          r.dirty = true; r.updatedAt = new Date().toISOString();
          try { window.RowFactory?.updateDerived(r); } catch(_) {}
        }
        if (action === 'set_scope')    { r.scopeStatus = value; r.dirty = true; r.updatedAt = new Date().toISOString(); }
        if (action === 'mark_done')    { r.isDone = true; if (!r.doneDate) r.doneDate = new Date().toISOString().slice(0,10); r.dirty = true; r.updatedAt = new Date().toISOString(); }
        if (action === 'set_comment')  { r.comment = r.comment ? r.comment + '\n' + (value||'') : (value||''); r.dirty = true; r.updatedAt = new Date().toISOString(); }
        if (action === 'clear_blocker'){ r.blockingDependency = false; r.blockingDeadline = ''; r.dirty = true; r.updatedAt = new Date().toISOString(); }
      });
    };
    if (Services.Reactive?.silent) Services.Reactive.silent(apply);
    else apply();
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

  // F4 fix (chat-04 audit) — chat-batch теперь видим в HistoryLog.ai наравне
  // с chat_message. Раньше mass-mutation на 50 задач была невидима в общей
  // истории (только в внутреннем actionLog), что мешало аудиту.
  try {
    window.HistoryLog?.ai?.('chat_batch', `${label} · ${rowIds.length} задач`, {
      details: JSON.stringify({ action, value, rowIds: rowIds.slice(0, 200) }),
      source: 'chat',
    });
  } catch (_) {}

  state.llm.pendingBatch = null;
  // V22 — telemetry bulk apply.
  try { _telBulk('apply', { rowsCount: rowIds.length, actionType: action }); } catch (_) {}
  showToast(`Курс скорректирован — ${rowIds.length} задач`, 'success');
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
    // F3 fix (chat-04 audit) — affinity tag, чтобы Реестр мог показать chip
    // «фильтр от ассистента» с быстрым «сбросить». Без этого юзер не понимал,
    // почему после navigate в Дашборд и обратно фильтры остались.
    f._source = 'chat';
    f._appliedAt = Date.now();
    notify('chat_filter');
    showToast('Фильтры применены');
    if (!payload.noNavigate) navigateTo('registry');
  } catch (e) {
    showToast('Курс не сверен · фильтры: ' + (e.message || e), 'error');
  }
}

function handleClearFilters() {
  const f = state.filters;
  f.search = ''; f.team = ''; f.scope = ''; f.release = '';
  f.workType = ''; f.role = ''; f.assignee = ''; f.tag = '';
  f.onlyBlocking = false; f.onlyRisky = false; f.onlyDone = false; f.preset = null;
  // F3 fix: clear affinity tag тоже.
  f._source = null; f._appliedAt = 0;
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
  // L4 fix: убран auto-click. Раньше LLM мог сочинить prompt + label «Применить»
  // и при клике запрос ушёл бы автоматом (semi-automatic loop). Теперь:
  // 1) prompt подставляется в input;
  // 2) input получает фокус;
  // 3) пользователь видит текст и САМ нажимает «Отправить» — это явное consent.
  const input = document.getElementById('assistant-input');
  if (input && payload.prompt) {
    input.value = payload.prompt;
    input.dispatchEvent(new Event('input'));
    try { input.focus(); } catch (_) {}
    // Auto-click убран намеренно — см. комментарий выше.
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
  if (!result.ok) {
    // F6 fix (chat-04 audit) — на mismatch/empty raise виден в чате,
    // не только в toast. Раньше silent-toast пропадал через 2.4s,
    // юзер не понимал, что произошло.
    const msg = result.message || 'Не удалось применить';
    showToast(msg, 'error');
    try {
      if (state.llm?.history) {
        state.llm.history.push({
          role: 'assistant',
          content: `Не удалось применить действие: ${msg}`,
          isError: true,
        });
        Services.LLMAssistant?.renderMessages?.();
        Services.LLMAssistant?._saveDebounced?.();
      }
    } catch (_) {}
  }
  return result;
}

function handleCancelBatch() {
  // V22 — telemetry bulk cancel; rowsCount берём из pendingBatch до сброса.
  try {
    const p = state.llm?.pendingBatch;
    _telBulk('cancel', { rowsCount: p?.rowIds?.length || 0, actionType: p?.action || '' });
  } catch (_) {}
  if (state.llm) state.llm.pendingBatch = null;
  showToast('Действие отменено');
}

function handleTakeSnapshot() {
  try {
    window.takeSnapshot?.();
    showToast('📸 Снимок сохранён');
  } catch(_) {
    showToast('Курс не сверен · снимок не сохранён', 'error');
  }
}

/* ── Dispatcher ──────────────────────────────────────────── */

export function executeAction(type, payload = {}) {
  // V22 — telemetry LLM-accepted: пользователь кликнул action-chip на ответе.
  // Каждый клик = «принятие» LLM-предложения (proxy для accept-rate).
  try { _telLLM('accepted', { actionType: type }); } catch (_) {}
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
    case 'open_settings':   return handleOpenSettings(payload);   // L11
    case 'set_focus':       return handleSetFocus(payload);          // V22 X-02 / K-03
    case 'open_url':        return handleOpenUrl(payload);           // V22+ Week 1 (DL-7)
    case 'export_md':       return handleExportMarkdown(payload);    // V22+ Week 1 (EX-01)
    case 'copy_response':   return handleCopyResponse(payload);      // V22+ Week 1 (EX-02)
    case 'open_date_picker': return handleOpenDatePicker(payload);   // V22+ Week 2 (UX-02)
    default:
      console.warn('[ChatActions] Unknown action type:', type, payload);
  }
}

// V22+ Week 1 (DL-7) — open external URL (Jira browse, BB repo, CF page).
// Безопасность: разрешаем ТОЛЬКО https:// + проверяем host против известных
// integrations baseUrl. Иначе LLM мог бы подсунуть фишинговый URL.
function handleOpenUrl(payload = {}) {
  const url = String(payload?.url || '').trim();
  if (!url) return { ok: false, reason: 'no-url' };
  let parsed;
  try { parsed = new URL(url); }
  catch { return { ok: false, reason: 'invalid-url' }; }
  if (!/^https?:$/.test(parsed.protocol)) return { ok: false, reason: 'bad-protocol' };
  // Host whitelist: integrations baseUrl'ы из state.
  const allowedHosts = [];
  try {
    const ints = (Services.AppState || globalThis.state || {}).integrations || {};
    for (const k of ['jira', 'bitbucket', 'confluence', 'sigma']) {
      const base = ints[k]?.baseUrl;
      if (base) {
        try { allowedHosts.push(new URL(base).host); } catch (_) {}
      }
    }
  } catch (_) {}
  if (allowedHosts.length && !allowedHosts.includes(parsed.host)) {
    console.warn('[ChatActions] open_url rejected (host not in integrations whitelist):', parsed.host);
    return { ok: false, reason: 'host-not-allowed' };
  }
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'window-open-failed' };
  }
}

// V22+ Week 1 (EX-01) — export structured response to Markdown.
// payload: { messageIdx, includeHeader?, filename? }
function handleExportMarkdown(payload = {}) {
  try {
    const idx = Number(payload?.messageIdx);
    const history = (Services.AppState || globalThis.state || {}).llm?.history || [];
    const msg = Number.isFinite(idx) ? history[idx] : history[history.length - 1];
    if (!msg) return { ok: false, reason: 'no-message' };
    const md = _renderResponseAsMarkdown(msg, payload);
    const fname = payload?.filename || `prisma-chat-${new Date().toISOString().slice(0, 10)}.md`;
    _downloadBlob(md, fname, 'text/markdown');
    return { ok: true };
  } catch (e) {
    console.warn('[ChatActions] export_md failed:', e);
    return { ok: false, reason: 'export-failed' };
  }
}

// V22+ Week 1 (EX-02) — copy formatted response (rich html + plain text)
// to clipboard. Использует Clipboard API multi-mime.
async function handleCopyResponse(payload = {}) {
  try {
    const idx = Number(payload?.messageIdx);
    const history = (Services.AppState || globalThis.state || {}).llm?.history || [];
    const msg = Number.isFinite(idx) ? history[idx] : history[history.length - 1];
    if (!msg) return { ok: false, reason: 'no-message' };
    const md = _renderResponseAsMarkdown(msg, payload);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(md);
      try { Services.Toast?.info?.('Скопировано в буфер обмена', { ms: 1600 }); } catch (_) {}
      return { ok: true };
    }
    return { ok: false, reason: 'no-clipboard-api' };
  } catch (e) {
    console.warn('[ChatActions] copy_response failed:', e);
    return { ok: false, reason: 'copy-failed' };
  }
}

// V22+ Week 1 — Markdown renderer для structured response.
// Совместим с Confluence / Slack / email-копи-паст.
function _renderResponseAsMarkdown(msg, opts = {}) {
  const lines = [];
  if (opts.includeHeader !== false) {
    lines.push(`# Призма · Ответ ассистента`);
    lines.push(`> ${new Date().toLocaleString('ru-RU')}`);
    lines.push('');
  }
  const s = msg.structured;
  if (s?.text) {
    lines.push(String(s.text));
    lines.push('');
  } else if (msg.content) {
    lines.push(String(msg.content));
    lines.push('');
  }
  if (Array.isArray(s?.cards) && s.cards.length) {
    lines.push('## Показатели');
    for (const c of s.cards) {
      const title = c.title || '';
      const value = c.value != null ? `**${c.value}**` : '';
      const hint  = c.hint  ? ` — _${c.hint}_` : '';
      lines.push(`- ${title}: ${value}${hint}`);
    }
    lines.push('');
  }
  if (Array.isArray(s?.drilldown) && s.drilldown.length) {
    lines.push('## Связанные вопросы');
    for (const d of s.drilldown) {
      lines.push(`- ${d.text || d.prompt}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

// V22+ Week 2 (UX-02) — Custom date-range picker popover.
// При клике «Свой период...» — открываем мини-popover с двумя
// <input type="date">. При submit — формируем prompt и через
// send_prompt автосендим.
function handleOpenDatePicker(payload = {}) {
  if (typeof document === 'undefined') return { ok: false, reason: 'no-dom' };
  // Idempotent — удаляем предыдущий popover если есть.
  const prev = document.getElementById('chat-date-picker-popover');
  if (prev) prev.remove();

  const subject = String(payload?.subject || '').trim();
  const today = new Date();
  const ago30 = new Date(today.getTime() - 30 * 86400_000);
  const fromIso = ago30.toISOString().slice(0, 10);
  const toIso   = today.toISOString().slice(0, 10);

  const pop = document.createElement('div');
  pop.id = 'chat-date-picker-popover';
  pop.className = 'chat-date-picker-popover';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Выберите период');
  pop.innerHTML = `
    <div class="chat-date-picker-title">Свой период</div>
    <label class="chat-date-picker-row">
      <span>с</span>
      <input type="date" id="chat-date-picker-from" value="${fromIso}">
    </label>
    <label class="chat-date-picker-row">
      <span>по</span>
      <input type="date" id="chat-date-picker-to" value="${toIso}">
    </label>
    <div class="chat-date-picker-actions">
      <button class="chat-date-picker-cancel" type="button">Отмена</button>
      <button class="chat-date-picker-apply" type="button">Применить</button>
    </div>
  `;
  document.body.appendChild(pop);

  const close = () => { try { pop.remove(); } catch (_) {} };
  pop.querySelector('.chat-date-picker-cancel').addEventListener('click', close);
  pop.querySelector('.chat-date-picker-apply').addEventListener('click', () => {
    const f = pop.querySelector('#chat-date-picker-from').value;
    const t = pop.querySelector('#chat-date-picker-to').value;
    close();
    if (!f || !t) return;
    const prompt = subject
      ? `${subject} с ${f} по ${t}`
      : `с ${f} по ${t}`;
    try {
      const input = document.getElementById('assistant-input');
      if (input) {
        input.value = prompt;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      try { Services.LLMAssistant?.sendFromInput?.(); } catch (_) {}
    } catch (_) {}
  });

  // Close on outside-click (after a tick — иначе тот же клик закроет).
  setTimeout(() => {
    const onOutside = (e) => {
      if (!pop.contains(e.target)) {
        close();
        document.removeEventListener('click', onOutside, true);
      }
    };
    document.addEventListener('click', onOutside, true);
  }, 50);

  return { ok: true };
}

function _downloadBlob(content, filename, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

// V22 X-02 / K-03 (audit-experts-2026-05-15 Selvadurai #1, #2) — единый
// product-glue action: чат может сфокусировать любую вкладку на конкретном
// объекте (employee / epic / team / release / block-id). Подписчики
// focus-changed получают payload, переключают view + scroll-to.
//
// payload: { kind: 'employee'|'epic'|'team'|'release'|'block-id',
//            id: string,        // identity-deterministic (email / Jira-key / team name)
//            period?: '7d'|'14d'|'30d'|'q'|'all',
//            source?: 'chat' }  // источник для telemetry
function handleSetFocus(payload = {}) {
  const focus = Services.Focus || globalThis.Focus;
  if (!focus || typeof focus.set !== 'function') {
    console.warn('[ChatActions] Focus service not available, set_focus ignored', payload);
    return { ok: false, reason: 'no-focus-service' };
  }
  const kind = String(payload?.kind || '').trim();
  const id   = String(payload?.id   || '').trim();
  if (!kind || !id) {
    console.warn('[ChatActions] set_focus: kind+id required', payload);
    return { ok: false, reason: 'invalid-payload' };
  }
  try {
    focus.set({
      kind,
      id,
      period: payload?.period || '7d',
      source: payload?.source || 'chat',
    });
    return { ok: true };
  } catch (e) {
    console.warn('[ChatActions] set_focus threw:', e);
    return { ok: false, reason: 'focus-set-threw' };
  }
}

// L11: открытие LLM-tab настроек прямо из error-сообщения.
function handleOpenSettings(payload = {}) {
  const modal = document.getElementById('app-settings-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const tab = payload?.tab || 'llm';
  modal.querySelectorAll('.app-settings-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  modal.querySelectorAll('.app-settings-tab-content').forEach(c => c.classList.toggle('hidden', c.dataset.tabContent !== tab));
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
        try { Services.LLMAssistant?.renderMessages(); } catch(_) {}
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
