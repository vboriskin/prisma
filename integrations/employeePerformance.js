'use strict';
/* ============================================================
   EMPLOYEE PERFORMANCE — V17 P4
   --
   New sub-tab in section-integrations: «Производительность сотрудников».
   Pulls a list of employees from the projects configured in
   cfg.jiraProjectKeys (the «delta» project keys) and renders a card
   grid with per-employee metrics aggregated from Jira / Bitbucket /
   Confluence.

   MVP scope (this commit):
   · Sub-tab UI + card grid skeleton
   · Aggregator for Jira open/done/overdue counts (server endpoint)
   · Bitbucket PR count (stub — TODO when API available)
   · Confluence pages (stub — TODO)
   · Optional «✨ AI-анализ» card-action that shoots ФИО+metrics to
     the chat-assistant for a narrative summary

   Audit 2026-05-V17 · pt 4. See audit-2026-05-V17/04-perf-tab.md.
   ============================================================ */

import { state } from '../state.js';
import { Utils } from '../utils.js';

// Per-tab cached fetch result. Cleared on manual refresh button click.
let _model = null;
let _loading = false;
let _error = null;
let _container = null;

const fmtDt = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru');
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** FNV-1a hash → stable HSL hue per FIO. Same idea as gantt team rail. */
function fioHue(s) {
  let h = 2166136261;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h % 360;
}

function initials(fio) {
  const parts = String(fio || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

async function fetchModel() {
  _loading = true;
  _error = null;
  paint();
  try {
    const res = await fetch('/api/integrations/employee-performance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      // V17.2 I4 → V18 P6: redact через централизованный Utils.redactSecretsInText.
      const txt = await res.text();
      throw new Error(`HTTP ${res.status}: ${Utils.redactSecretsInText(txt)}`);
    }
    _model = await res.json();
  } catch (e) {
    _error = e.message || String(e);
    try { window.ErrorsLog?.add?.({ level: 'error', source: 'EmployeePerformance.fetch', message: _error }); } catch (_) {}
  } finally {
    _loading = false;
    paint();
  }
}

function paint() {
  if (!_container) return;
  if (_loading) {
    _container.innerHTML = `
      <div class="ep-loader">
        <div class="ep-loader-spinner"></div>
        <div class="ep-loader-label">Загружаем данные о сотрудниках…</div>
        <div class="ep-loader-hint">Запрос к Jira / Bitbucket / Confluence — может занять до 30 сек на проект</div>
      </div>`;
    return;
  }
  if (_error) {
    _container.innerHTML = `
      <div class="ep-error">
        <div class="ep-error-title">⚠ Не удалось загрузить</div>
        <div class="ep-error-msg">${esc(_error)}</div>
        <button class="btn btn-sm btn-outline" data-action="retry">Повторить</button>
        <div class="ep-error-hint">Проверь jiraProjectKeys / токены в Настройки → Интеграции</div>
      </div>`;
    return;
  }
  if (!_model) {
    _container.innerHTML = `
      <div class="ep-empty">
        <div class="ep-empty-icon">👥</div>
        <div class="ep-empty-title">Производительность сотрудников</div>
        <div class="ep-empty-hint">
          Список сотрудников строится из issues по проектам, указанным в настройках
          (поле «Jira Project Keys»). Для каждого собирается активность из Jira /
          Bitbucket / Confluence.
        </div>
        <button class="btn btn-primary" data-action="load">Загрузить сводку</button>
      </div>`;
    return;
  }

  const employees = Array.isArray(_model.employees) ? _model.employees : [];
  const meta = _model.meta || {};
  const head = `
    <div class="ep-head">
      <div class="ep-head-title">Производительность сотрудников</div>
      <div class="ep-head-meta">
        <span><strong>${employees.length}</strong> сотрудников</span>
        <span>·</span>
        <span><strong>${(meta.projectKeys || []).length}</strong> проектов</span>
        ${meta.fetchedAt ? `<span>·</span><span>обновлено ${esc(fmtDt(meta.fetchedAt))}</span>` : ''}
      </div>
      <div class="ep-head-actions">
        <button class="btn btn-sm btn-outline" data-action="refresh">↻ Обновить</button>
      </div>
    </div>`;

  if (!employees.length) {
    _container.innerHTML = head + `
      <div class="ep-empty">
        <div class="ep-empty-title">Сотрудников не найдено</div>
        <div class="ep-empty-hint">
          В проектах ${(meta.projectKeys || []).map(k => `<code>${esc(k)}</code>`).join(', ') || '(пусто)'} нет issues с assignee.
          Возможно, нужно указать другие jiraProjectKeys в Настройках.
        </div>
      </div>`;
    return;
  }

  // Sort by activity (open + done) desc.
  const sorted = [...employees].sort((a, b) => {
    const sA = (a.jira?.open || 0) + (a.jira?.done || 0);
    const sB = (b.jira?.open || 0) + (b.jira?.done || 0);
    return sB - sA;
  });

  const cards = sorted.map(emp => renderCard(emp)).join('');
  _container.innerHTML = head + `<div class="ep-grid">${cards}</div>`;
}

function renderCard(emp) {
  const fio = emp.fio || '—';
  const hue = fioHue(fio);
  const j = emp.jira || {};
  const bb = emp.bitbucket || {};
  const cf = emp.confluence || {};
  const overdueClass = (j.overdue || 0) > 0 ? 'ep-metric-warn' : '';
  const totalScore = (j.open || 0) + (j.done || 0) + (bb.prsAuthored || 0) + (cf.pages || 0);

  return `<div class="ep-card" data-fio="${esc(fio)}">
    <div class="ep-card-rail" style="background: hsl(${hue},58%,52%)" aria-hidden="true"></div>
    <div class="ep-card-head">
      <div class="ep-card-avatar" style="background: hsl(${hue},58%,52%)">${esc(initials(fio))}</div>
      <div class="ep-card-name">${esc(fio)}</div>
      ${emp.email ? `<div class="ep-card-email">${esc(emp.email)}</div>` : ''}
    </div>

    <div class="ep-section">
      <div class="ep-section-title">JIRA</div>
      <div class="ep-metrics">
        <div class="ep-metric">
          <div class="ep-metric-num">${j.open ?? 0}</div>
          <div class="ep-metric-label">в работе</div>
        </div>
        <div class="ep-metric">
          <div class="ep-metric-num">${j.done ?? 0}</div>
          <div class="ep-metric-label">завершено</div>
        </div>
        <div class="ep-metric ${overdueClass}">
          <div class="ep-metric-num">${j.overdue ?? 0}</div>
          <div class="ep-metric-label">просрочено</div>
        </div>
      </div>
    </div>

    ${(bb.prsAuthored != null || bb.prsOpen != null) ? `
      <div class="ep-section">
        <div class="ep-section-title">BITBUCKET</div>
        <div class="ep-metrics">
          <div class="ep-metric">
            <div class="ep-metric-num">${bb.prsAuthored ?? '—'}</div>
            <div class="ep-metric-label">PR создано</div>
          </div>
          <div class="ep-metric">
            <div class="ep-metric-num">${bb.prsOpen ?? '—'}</div>
            <div class="ep-metric-label">в ревью</div>
          </div>
        </div>
      </div>
    ` : ''}

    ${(cf.pages != null) ? `
      <div class="ep-section">
        <div class="ep-section-title">CONFLUENCE</div>
        <div class="ep-metrics">
          <div class="ep-metric">
            <div class="ep-metric-num">${cf.pages ?? '—'}</div>
            <div class="ep-metric-label">страниц</div>
          </div>
        </div>
      </div>
    ` : ''}

    <div class="ep-card-foot">
      <div class="ep-card-score" title="Сумма активности по всем источникам">${totalScore}</div>
      <button class="btn btn-xs btn-outline ep-llm-btn" data-action="llm-analyse" data-fio="${esc(fio)}" title="Попросить ассистента описать вклад сотрудника">✨ Анализ</button>
    </div>
  </div>`;
}

function bind(container) {
  container.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const action = t.dataset.action;
    if (action === 'load' || action === 'retry' || action === 'refresh') {
      _model = null;
      fetchModel();
    } else if (action === 'llm-analyse') {
      const fio = t.dataset.fio;
      const emp = (_model?.employees || []).find(e => e.fio === fio);
      if (!emp) return;
      const j = emp.jira || {};
      const summary = `Опиши вклад сотрудника «${fio}» по данным интеграций. Цифры:\n` +
        `Jira: открыто ${j.open || 0}, завершено ${j.done || 0}, просрочено ${j.overdue || 0}.\n` +
        `Сделай 3-5 пунктов: что хорошо, что просело, рекомендации.`;
      // Open assistant + prefill input.
      const panel = document.getElementById('assistant-panel');
      const fab   = document.getElementById('assistant-fab');
      const input = document.getElementById('assistant-input');
      if (panel) { panel.classList.remove('hidden', 'minimized'); state.llm.panelOpen = true; }
      if (fab) fab.classList.add('hidden');
      if (input) {
        input.value = summary;
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 180) + 'px';
        input.focus();
      }
    }
  });
}

export const EmployeePerformance = {
  render(container) {
    _container = container;
    bind(container);
    if (!_model && !_loading) {
      // first render → empty state with CTA, user clicks to load
      paint();
    } else {
      paint();
    }
  },
  refresh() {
    _model = null;
    fetchModel();
  },
  isLoading() { return _loading; },
};
