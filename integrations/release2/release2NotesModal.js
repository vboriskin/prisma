'use strict';
/* ============================================================
   integrations/release2/release2NotesModal.js — V22+ (2026-05-17)

   UI-модалка для release notes.

   Public API:
     openReleaseNotesModal(release, opts?) → void
       opts: { jiraBaseUrl?, signal? }

   Lifecycle:
     1. Открывается с rule-based markdown (мгновенно, sync render)
     2. Toolbar: [⬇ Скачать .md] [✨ Сформировать с LLM] [⧉ Копировать]
     3. Toggle "Полная / Краткая" — переключает mode rule-based рендера
     4. Click LLM → bulk-fetch descriptions + LLM call → replace body
     5. Esc / ✕ / backdrop → close
   ============================================================ */

import {
  buildRuleBasedMarkdown,
  buildLLMPrompt,
  callLLMForNotes,
  downloadMarkdown,
  getRelatedKeysForFetch,
} from './release2Notes.js';
import { fetchRelease2Related } from './release2Api.js';
import { renderMarkdownLite } from '../../chat/chatUIRenderer.js';
import { Icons } from '../../app/icons.js';

const MODAL_ID = 'r2-notes-modal';

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ─────────────────────────────────────────────────────────────
   Public API
   ───────────────────────────────────────────────────────────── */

/**
 * @param {object} release — analysed release-model (см. release2Model.js)
 * @param {object} opts — { jiraBaseUrl?, signal? }
 */
export function openReleaseNotesModal(release, opts = {}) {
  if (!release || !release.key) return;
  // Cleanup предыдущего instance'а (если был).
  document.getElementById(MODAL_ID)?.remove();

  // State модалки (хранится локально в closure).
  const modalState = {
    mode: 'full',                       // 'full' | 'short'
    source: 'rule',                     // 'rule' | 'llm'
    currentMarkdown: '',                // последний рендер
    related: [],                        // raw issues с description (после LLM-fetch)
    llmLoading: false,
    llmError: null,
    abortCtrl: null,
  };

  // Initial render — мгновенно из release-data, без fetch'а descriptions.
  modalState.currentMarkdown = buildRuleBasedMarkdown(release, [], { mode: modalState.mode });

  document.body.insertAdjacentHTML('beforeend', _renderShell(release, modalState));
  const overlay = document.getElementById(MODAL_ID);
  if (!overlay) return;
  document.body.classList.add('is-ts2-modal-open');

  // Initial body fill.
  _updateBody(overlay, modalState);

  // Close handlers (Esc / ✕ / backdrop).
  const close = () => {
    try { modalState.abortCtrl?.abort(); } catch (_) {}
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    document.body.classList.remove('is-ts2-modal-open');
  };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay || ev.target.closest?.('[data-r2-notes-close]')) close();
  });

  // Toolbar handlers.
  overlay.querySelector('[data-r2-notes-download]')?.addEventListener('click', () => {
    if (!modalState.currentMarkdown) return;
    downloadMarkdown(modalState.currentMarkdown, release.key, modalState.source);
    // Visual feedback — кнопка флешит «Скачано».
    const btn = overlay.querySelector('[data-r2-notes-download]');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = `${Icons.get('check', { cls: 'btn-icon', size: 12 })} Скачано`;
      btn.classList.add('r2-notes-btn-success');
      setTimeout(() => {
        btn.innerHTML = orig;
        btn.classList.remove('r2-notes-btn-success');
      }, 1600);
    }
  });

  overlay.querySelector('[data-r2-notes-copy]')?.addEventListener('click', async () => {
    if (!modalState.currentMarkdown) return;
    try {
      await navigator.clipboard?.writeText?.(modalState.currentMarkdown);
      const btn = overlay.querySelector('[data-r2-notes-copy]');
      if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = `${Icons.get('check', { cls: 'btn-icon', size: 12 })} Скопировано`;
        btn.classList.add('r2-notes-btn-success');
        setTimeout(() => {
          btn.innerHTML = orig;
          btn.classList.remove('r2-notes-btn-success');
        }, 1600);
      }
    } catch (_) { /* clipboard denied — silent */ }
  });

  overlay.querySelector('[data-r2-notes-llm]')?.addEventListener('click', async () => {
    if (modalState.llmLoading) return;
    await _runLLM(release, modalState, overlay, opts);
  });

  // Mode toggle (Полная / Краткая).
  overlay.querySelectorAll('[data-r2-notes-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const newMode = btn.dataset.r2NotesMode;
      if (newMode === modalState.mode) return;
      modalState.mode = newMode;
      // Re-render текущим source'ом.
      if (modalState.source === 'rule') {
        modalState.currentMarkdown = buildRuleBasedMarkdown(release, modalState.related, { mode: newMode });
      } else {
        // LLM-генерация делалась под "full" — для "short" возвращаемся к rule-based.
        modalState.source = 'rule';
        modalState.currentMarkdown = buildRuleBasedMarkdown(release, modalState.related, { mode: newMode });
        _updateSourceBadge(overlay, 'rule');
      }
      _updateModeButtons(overlay, newMode);
      _updateBody(overlay, modalState);
    });
  });
}

/* ─────────────────────────────────────────────────────────────
   Internal: shell + dynamic updates
   ───────────────────────────────────────────────────────────── */

function _renderShell(release, modalState) {
  const partOfCount = (release._links?.partOf || []).length;
  const bugsCount = (release._links?.bugs || []).length;
  const llmDisabled = !partOfCount && !bugsCount;
  // Header title — release key + summary (truncate).
  const releaseLabel = release.summary
    ? `${release.key} · ${_esc(String(release.summary).slice(0, 80))}`
    : _esc(release.key);
  return `
    <div class="r2-notes-modal-overlay" id="${MODAL_ID}" role="dialog" aria-modal="true" aria-labelledby="r2-notes-title">
      <div class="r2-notes-modal" role="document">
        <div class="r2-notes-head">
          <div class="r2-notes-title" id="r2-notes-title">
            <span class="r2-notes-title-eyebrow">Release notes</span>
            <span class="r2-notes-title-key">${releaseLabel}</span>
            <span class="r2-notes-source-badge r2-notes-source-rule" data-r2-source-badge>локально</span>
          </div>
          <button class="r2-notes-close" type="button" data-r2-notes-close aria-label="Закрыть">${Icons.get('x', { size: 14 })}</button>
        </div>
        <div class="r2-notes-toolbar">
          <div class="r2-notes-toolbar-left">
            <button class="r2-notes-btn r2-notes-btn-primary" type="button" data-r2-notes-download title="Скачать markdown-файл">
              ${Icons.get('download', { cls: 'btn-icon', size: 12 })} Скачать .md
            </button>
            <button class="r2-notes-btn r2-notes-btn-llm" type="button" data-r2-notes-llm ${llmDisabled ? 'disabled' : ''} title="Переписать на язык бизнес-пользователя через GigaChat">
              ${Icons.get('sparkles', { cls: 'btn-icon', size: 12 })} <span data-r2-llm-label>Сформировать с LLM</span>
            </button>
          </div>
          <div class="r2-notes-toolbar-mid">
            <span class="r2-notes-mode-label">Версия:</span>
            <div class="r2-notes-mode-toggle" role="tablist" aria-label="Версия release notes">
              <button class="r2-notes-mode-btn r2-notes-mode-active" data-r2-notes-mode="full" role="tab" aria-selected="true">Полная</button>
              <button class="r2-notes-mode-btn" data-r2-notes-mode="short" role="tab" aria-selected="false">Краткая</button>
            </div>
          </div>
          <div class="r2-notes-toolbar-right">
            <button class="r2-notes-btn r2-notes-btn-ghost" type="button" data-r2-notes-copy title="Скопировать markdown в буфер">
              ${Icons.get('copy', { cls: 'btn-icon', size: 12 })} Копировать
            </button>
          </div>
        </div>
        <div class="r2-notes-body" data-r2-notes-body>
          <!-- сюда вставляется отрендеренный markdown -->
        </div>
        <div class="r2-notes-foot" data-r2-notes-foot>
          ${partOfCount} ${_pluralRu(partOfCount, ['история', 'истории', 'историй'])} · ${bugsCount} ${_pluralRu(bugsCount, ['баг', 'бага', 'багов'])} · собрано из Jira
        </div>
      </div>
    </div>
  `;
}

function _updateBody(overlay, modalState) {
  const body = overlay.querySelector('[data-r2-notes-body]');
  if (!body) return;
  const html = renderMarkdownLite(modalState.currentMarkdown);
  body.innerHTML = `<article class="r2-notes-article">${html}</article>`;
}

function _updateModeButtons(overlay, mode) {
  overlay.querySelectorAll('[data-r2-notes-mode]').forEach(btn => {
    const isActive = btn.dataset.r2NotesMode === mode;
    btn.classList.toggle('r2-notes-mode-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function _updateSourceBadge(overlay, source) {
  const badge = overlay.querySelector('[data-r2-source-badge]');
  if (!badge) return;
  if (source === 'llm') {
    badge.textContent = 'LLM';
    badge.classList.remove('r2-notes-source-rule');
    badge.classList.add('r2-notes-source-llm');
  } else {
    badge.textContent = 'локально';
    badge.classList.remove('r2-notes-source-llm');
    badge.classList.add('r2-notes-source-rule');
  }
}

function _updateFooter(overlay, release, source) {
  const foot = overlay.querySelector('[data-r2-notes-foot]');
  if (!foot) return;
  const partOfCount = (release._links?.partOf || []).length;
  const bugsCount = (release._links?.bugs || []).length;
  const sourceLabel = source === 'llm' ? 'сгенерировано LLM' : 'собрано из Jira';
  foot.textContent = `${partOfCount} ${_pluralRu(partOfCount, ['история', 'истории', 'историй'])} · ${bugsCount} ${_pluralRu(bugsCount, ['баг', 'бага', 'багов'])} · ${sourceLabel}`;
}

function _setLLMButtonState(overlay, state) {
  const btn = overlay.querySelector('[data-r2-notes-llm]');
  const label = btn?.querySelector('[data-r2-llm-label]');
  if (!btn || !label) return;
  switch (state) {
    case 'loading':
      btn.disabled = true;
      btn.classList.add('r2-notes-btn-loading');
      label.textContent = 'Генерируется…';
      break;
    case 'after-success':
      btn.disabled = false;
      btn.classList.remove('r2-notes-btn-loading');
      label.textContent = 'Перегенерировать';
      break;
    case 'idle':
    default:
      btn.disabled = false;
      btn.classList.remove('r2-notes-btn-loading');
      label.textContent = 'Сформировать с LLM';
  }
}

/* ─────────────────────────────────────────────────────────────
   LLM flow
   ───────────────────────────────────────────────────────────── */

async function _runLLM(release, modalState, overlay, opts) {
  // 1) Bulk-fetch descriptions для всех related issues.
  modalState.llmLoading = true;
  modalState.abortCtrl = new AbortController();
  _setLLMButtonState(overlay, 'loading');
  _renderInlineLLMNotice(overlay, 'fetching');

  const keys = getRelatedKeysForFetch(release);
  let related = modalState.related;
  if (keys.length && !related.length) {
    try {
      related = await fetchRelease2Related(keys, {
        withDescription: true,
        signal: modalState.abortCtrl.signal,
        timeoutMs: 45_000,
      });
      modalState.related = related;
    } catch (e) {
      modalState.llmLoading = false;
      modalState.llmError = e?.message || 'Не удалось получить описания задач';
      _renderInlineLLMNotice(overlay, 'fetch-failed', modalState.llmError);
      _setLLMButtonState(overlay, 'idle');
      return;
    }
  }

  // 2) Build prompt и вызываем LLM.
  _renderInlineLLMNotice(overlay, 'generating');
  const prompt = buildLLMPrompt(release, related, { mode: modalState.mode });
  // 2026-05-17 — callLLMForNotes возвращает `{ok, text, error}` (раньше
  // был просто string|null). Это позволяет показать конкретную причину:
  // «нет токена», «бюджет исчерпан», «timeout» и т.п. — вместо generic
  // «LLM недоступен».
  let llmResult = { ok: false, error: 'Unknown error' };
  try {
    llmResult = await callLLMForNotes(prompt, {
      signal: modalState.abortCtrl.signal,
      maxTokens: 2500,
      temperature: 0.3,
    });
  } catch (e) {
    llmResult = { ok: false, error: e?.message || 'LLM error' };
  }
  modalState.llmLoading = false;
  if (!llmResult.ok) {
    modalState.llmError = llmResult.error || 'LLM error';
    _renderInlineLLMNotice(overlay, 'llm-failed', modalState.llmError);
    // Откатываем body к rule-based + сохраняем descriptions для следующей попытки.
    modalState.currentMarkdown = buildRuleBasedMarkdown(release, related, { mode: modalState.mode });
    _updateBody(overlay, modalState);
    _setLLMButtonState(overlay, 'idle');
    return;
  }
  // 3) Success — обновляем body новым LLM-output'ом.
  _clearInlineLLMNotice(overlay);
  modalState.source = 'llm';
  modalState.currentMarkdown = llmResult.text;
  _updateBody(overlay, modalState);
  _updateSourceBadge(overlay, 'llm');
  _updateFooter(overlay, release, 'llm');
  _setLLMButtonState(overlay, 'after-success');
}

function _renderInlineLLMNotice(overlay, stage, errorText) {
  const body = overlay.querySelector('[data-r2-notes-body]');
  if (!body) return;
  // Не затираем существующий контент полностью — добавляем notice сверху.
  body.querySelector('.r2-notes-llm-notice')?.remove();
  const messages = {
    'fetching':    'Подгружаю описания задач из Jira…',
    'generating':  'GigaChat пишет release notes…',
    'fetch-failed':`Не удалось подгрузить описания: ${errorText || 'unknown'}. LLM использует только summary.`,
    'llm-failed':  errorText || 'LLM недоступен. Показан rule-based вариант.',
  };
  const kind = (stage === 'fetch-failed' || stage === 'llm-failed') ? 'error' : 'progress';
  const spinner = kind === 'progress'
    ? `<span class="r2-notes-spinner" aria-hidden="true"></span>`
    : `<span class="r2-notes-warn-icon" aria-hidden="true">${Icons.get('alert-triangle', { cls: 'btn-icon', size: 12 })}</span>`;
  const notice = document.createElement('div');
  notice.className = `r2-notes-llm-notice r2-notes-llm-notice-${kind}`;
  notice.innerHTML = `${spinner}<span>${_esc(messages[stage] || stage)}</span>`;
  body.insertBefore(notice, body.firstChild);
}

function _clearInlineLLMNotice(overlay) {
  overlay.querySelector('.r2-notes-llm-notice')?.remove();
}

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

function _pluralRu(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
