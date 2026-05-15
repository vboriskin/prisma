'use strict';
/* ============================================================
   app/promptsEditor.js — V13 (extracted from app.js, audit #18).

   Editable system + user prompts per intent category. Lives inside
   the LLM tab of the unified Settings modal.

   Why extracted: this also closes FOUND_BUGS #5 — `PromptsEditor`
   was previously a `const` in app.js, invisible to `app/llmAssistant.js`,
   which crashed on startup when `bindUI()` reached `PromptsEditor.init()`.
   The earlier fix exposed it via `window.PromptsEditor`. After this
   extraction the export becomes the canonical surface — `app.js` no
   longer needs the global, callers import it directly.
   ============================================================ */

import { Utils } from '../utils.js';
import {
  getAllPrompts, getDefaultPrompt, savePromptOverrides, resetPromptOverride,
  CATEGORIES as PROMPT_CATEGORIES,
} from '../chat/chatPrompts.js';
import { HistoryLog } from '../historyLog.js';
import { ConfirmDialog } from './uxKit.js';
import { Icons } from './icons.js';
import { Services } from './services.js';

export const PromptsEditor = {
  init() {
    const root = document.getElementById('llm-prompts-list');
    if (!root) return;
    PromptsEditor.render();
    document.getElementById('llm-prompts-reset-all')?.addEventListener('click', async () => {
      // V21 Q — ConfirmDialog (danger). Custom-промпты не имеют undo (нет checkpoint).
      const ok = await ConfirmDialog.show({
        title: 'Сбросить все промпты?',
        message: 'Все кастомные изменения промптов будут заменены на defaults. Действие необратимо.',
        confirmLabel: 'Сбросить',
        danger: true,
      });
      if (!ok) return;
      PROMPT_CATEGORIES.forEach(cat => resetPromptOverride(cat));
      PromptsEditor.render();
      window.showToast?.('Промпты сброшены к defaults');
      try { HistoryLog.settings('prompts_reset_all', 'Сброшены все custom-промпты'); } catch(_) {}
    });
  },

  render() {
    const root = document.getElementById('llm-prompts-list');
    if (!root) return;
    const all = getAllPrompts();
    const esc = (v) => Utils.escapeHtml(String(v ?? ''));
    root.innerHTML = PROMPT_CATEGORIES.map((cat, idx) => {
      const p = all[cat];
      const customised = p.customised;
      return `
        <details class="llm-prompt-card${customised ? ' llm-prompt-card-custom' : ''}" data-cat="${esc(cat)}"${idx === 0 ? ' open' : ''}>
          <summary>
            <span class="llm-prompt-cat-icon">${Icons.get(PromptsEditor._iconFor(cat), { size: 14 })}</span>
            <span class="llm-prompt-cat-label">${esc(p.label)}</span>
            <code class="llm-prompt-cat-key">${esc(cat)}</code>
            ${customised ? '<span class="llm-prompt-custom-flag" title="Кастомизирован">●</span>' : ''}
            <button class="btn btn-ghost btn-xs llm-prompt-reset" data-cat="${esc(cat)}" title="Сбросить эту категорию к defaults" aria-label="Сбросить категорию к умолчаниям"${customised ? '' : ' disabled'}>${Icons.get('rotate-ccw', { size: 12 })}</button>
          </summary>
          <div class="llm-prompt-body">
            <label class="llm-prompt-field">
              <span class="llm-prompt-field-label">System prompt — роль и поведение</span>
              <textarea class="llm-prompt-textarea llm-prompt-system" data-cat="${esc(cat)}" rows="6" spellcheck="false">${esc(p.system)}</textarea>
            </label>
            <label class="llm-prompt-field">
              <span class="llm-prompt-field-label">User prompt template — как формируется запрос пользователя</span>
              <textarea class="llm-prompt-textarea llm-prompt-user" data-cat="${esc(cat)}" rows="6" spellcheck="false">${esc(p.userTemplate)}</textarea>
              <span class="llm-prompt-hint">Плейсхолдеры: <code>{{message}}</code> · <code>{{filters}}</code> · <code>{{context}}</code> · <code>{{structuredSuffix}}</code> · <code>{{antiInject}}</code></span>
            </label>
            <div class="llm-prompt-row-actions">
              <button class="btn btn-outline btn-xs llm-prompt-save" data-cat="${esc(cat)}">Сохранить</button>
              <span class="llm-prompt-status" data-cat="${esc(cat)}"></span>
            </div>
          </div>
        </details>`;
    }).join('');

    root.querySelectorAll('.llm-prompt-save').forEach(btn => {
      btn.addEventListener('click', () => PromptsEditor._saveCategory(btn.dataset.cat));
    });
    root.querySelectorAll('.llm-prompt-reset').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        PromptsEditor._resetCategory(btn.dataset.cat);
      });
    });
  },

  _iconFor(cat) {
    // E2 fix (codebase-03 audit §12 no-emoji) — emoji-словарь заменён на
    // нейтральные dot-маркеры. Если нужны реальные иконки — Icons.get().
    return '·';
  },

  _saveCategory(cat) {
    const root = document.getElementById('llm-prompts-list');
    if (!root) return;
    const sysEl = root.querySelector(`textarea.llm-prompt-system[data-cat="${cat}"]`);
    const usrEl = root.querySelector(`textarea.llm-prompt-user[data-cat="${cat}"]`);
    if (!sysEl || !usrEl) return;
    const all = getAllPrompts();
    const patch = {};
    PROMPT_CATEGORIES.forEach(c => {
      patch[c] = { system: all[c].system, userTemplate: all[c].userTemplate };
    });
    patch[cat] = { system: sysEl.value, userTemplate: usrEl.value };
    savePromptOverrides(patch);
    PromptsEditor.render();
    const status = document.querySelector(`.llm-prompt-status[data-cat="${cat}"]`);
    if (status) {
      status.textContent = 'Сохранено';
      status.classList.add('llm-prompt-status-ok');
      setTimeout(() => { status.textContent = ''; status.classList.remove('llm-prompt-status-ok'); }, 1500);
    }
    window.showToast?.(`Промпт «${cat}» сохранён`);
    try { HistoryLog.settings('prompt_save', `Кастомный промпт: ${cat}`); } catch(_) {}
  },

  _resetCategory(cat) {
    const def = getDefaultPrompt(cat);
    const root = document.getElementById('llm-prompts-list');
    if (!root) return;
    const sysEl = root.querySelector(`textarea.llm-prompt-system[data-cat="${cat}"]`);
    const usrEl = root.querySelector(`textarea.llm-prompt-user[data-cat="${cat}"]`);
    if (sysEl) sysEl.value = def.system;
    if (usrEl) usrEl.value = def.userTemplate;
    resetPromptOverride(cat);
    PromptsEditor.render();
    window.showToast?.(`Промпт «${cat}» сброшен к default`);
    try { HistoryLog.settings('prompt_reset', `Сброс промпта: ${cat}`); } catch(_) {}
  },
};

Services.register('PromptsEditor', PromptsEditor);
if (typeof window !== 'undefined') window.PromptsEditor = PromptsEditor;
