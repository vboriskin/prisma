'use strict';
/* ============================================================
   INTEGRATIONS RENDERER — v10_0
   Pure HTML-string renderers. No state mutation, no side effects.
   ============================================================ */

import { Utils } from '../utils.js';
const esc = s => Utils.escapeHtml(String(s ?? ''));
const fmtDate = s => { if (!s) return '—'; try { return new Date(s).toLocaleDateString('ru'); } catch(_) { return s; } };
const linkBtn = (url, label) => url ? `<a class="int-link-btn" href="${esc(url)}" target="_blank" rel="noreferrer">${label}</a>` : '';

/* ── PR status badge ──────────────────────────────────────── */
function prBadge(status) {
  if (!status) return '';
  const map = {
    open:     ['int-badge-pr-open',     '🟡 Open'],
    approved: ['int-badge-pr-approved', '✅ Approved'],
    merged:   ['int-badge-pr-merged',   '🟢 Merged'],
    declined: ['int-badge-pr-declined', '🔴 Declined'],
  };
  const [cls, label] = map[String(status).toLowerCase()] || ['int-badge-pr-open', esc(status)];
  return `<span class="int-badge ${cls}">${label}</span>`;
}

/* ── Jira status badge ────────────────────────────────────── */
function jiraBadge(status) {
  if (!status) return '';
  const s = String(status).toLowerCase();
  const cls = s.includes('done') || s.includes('closed') || s.includes('resolved') ? 'int-badge-jira-done'
            : s.includes('progress') || s.includes('review') ? 'int-badge-jira-wip'
            : 'int-badge-jira-todo';
  return `<span class="int-badge int-badge-jira ${cls}">🔵 ${esc(status)}</span>`;
}

/* ══════════════════════════════════════════════════════════
   SETTINGS MODAL
   ══════════════════════════════════════════════════════════ */
export function renderSettingsModal(settings, opts = {}) {
  const masked = val => val ? '••••••••' : '';
  const s = settings;
  const inline = !!opts.inline;
  // When `inline=true` we skip overlay/box wrapping so the form sits directly inside the app-settings modal
  const headerHtml = inline
    ? ''
    : `<div class="int-modal-header"><span class="int-modal-title">⚙ Настройки интеграций</span><button class="int-modal-close" id="int-modal-close">✕</button></div>`;
  const openWrap  = inline
    ? `<div class="int-inline" id="int-settings-modal">`
    : `<div class="int-modal-overlay" id="int-settings-modal"><div class="int-modal-box">`;
  const closeWrap = inline ? `</div>` : `</div></div>`;
  return openWrap + headerHtml + `
      <div class="int-modal-body">
        <!-- V17.1.3 — Jira (Delta + Sigma) разделено на две независимые
             вкладки. Bindings (#int-jira-* / #int-sigma-*) сохранены —
             меняется только разметка вкладок и панелей. -->
        <div class="int-settings-tabs">
          <button class="int-stab active" data-stab="jira-delta">Jira Delta</button>
          <button class="int-stab" data-stab="jira-sigma">Jira Sigma</button>
          <button class="int-stab" data-stab="bitbucket">Bitbucket</button>
          <button class="int-stab" data-stab="confluence">Confluence</button>
        </div>

        <!-- Jira Delta — основная Jira, источник задач команд -->
        <div class="int-stab-panel active" data-panel="jira-delta">
          <div class="int-subblock-title">Delta Jira <span class="int-subblock-hint">— основная Jira, источник задач команд</span></div>
          <div class="int-field-group">
            <label class="int-field-label">Endpoint (Base URL)</label>
            <input class="int-field-input" id="int-jira-url" type="url" placeholder="https://company.atlassian.net" value="${esc(s.jiraBaseUrl||'')}">
          </div>
          <div class="int-field-group">
            <label class="int-field-label">API Token ${s.hasJiraToken ? '<span class="int-token-ok">✓ Сохранён</span>' : ''}</label>
            <input class="int-field-input" id="int-jira-token" type="password" placeholder="Bearer token или email:token" value="${esc(s.jiraToken||'')}">
            <span class="int-field-hint">Сохранён в браузере и на сервере — повторно вводить не нужно. <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">Создать токен →</a></span>
          </div>
          <div class="int-field-group">
            <label class="int-field-label">Ключи проектных пространств</label>
            <input class="int-field-input" id="int-jira-project-keys" type="text" placeholder="PAY, SBOF, KYC" value="${esc(s.jiraProjectKeys||'')}">
            <span class="int-field-hint">Через запятую. Используется для запросов в Jira (JQL <code>project in (...)</code>) и в Portfolio Pulse.</span>
          </div>
          <div class="int-field-actions">
            <button class="int-btn int-btn-ghost" id="int-jira-verify">Проверить Delta</button>
            <button class="int-btn int-btn-primary" id="int-jira-save">Сохранить Delta</button>
          </div>
          <div class="int-verify-result hidden" id="int-jira-verify-result"></div>
        </div>

        <!-- Jira Sigma — квартальные эпики-цели для «Чёрного дашборда» -->
        <div class="int-stab-panel" data-panel="jira-sigma">
          <div class="int-subblock-title">Sigma Jira <span class="int-subblock-hint">— квартальные эпики-цели для «Чёрного дашборда»</span></div>
          <div class="int-field-group">
            <label class="int-field-label">Endpoint (Base URL)</label>
            <input class="int-field-input" id="int-sigma-url" type="url" placeholder="https://sigma.example.com" value="${esc(s.sigmaJiraBaseUrl||'')}">
          </div>
          <div class="int-field-group">
            <label class="int-field-label">Personal Access Token ${s.hasSigmaJiraToken ? '<span class="int-token-ok">✓ Сохранён</span>' : ''}</label>
            <input class="int-field-input" id="int-sigma-token" type="password" placeholder="Bearer token или email:token" value="${esc(s.sigmaJiraToken||'')}">
            <span class="int-field-hint">Если оставить поле пустым при сохранении — текущий токен НЕ перезаписывается.</span>
          </div>
          <div class="int-field-group">
            <label class="int-field-label">Ключи квартальных эпиков-целей</label>
            <input class="int-field-input" id="int-sigma-goal-epic-keys" type="text" placeholder="GOAL-1, GOAL-2, GOAL-3" value="${esc(s.sigmaGoalEpicKeys||'')}">
            <span class="int-field-hint">Через запятую. Каждый эпик содержит поле <code>Domain link</code> — массив ключей задач Delta.</span>
          </div>
          <div class="int-field-actions">
            <button class="int-btn int-btn-ghost" id="int-sigma-verify">Проверить Sigma</button>
            <button class="int-btn int-btn-primary" id="int-sigma-save">Сохранить Sigma</button>
          </div>
          <div class="int-verify-result hidden" id="int-sigma-verify-result"></div>
        </div>

        <!-- Bitbucket -->
        <div class="int-stab-panel" data-panel="bitbucket">
          <div class="int-field-group">
            <label class="int-field-label">Endpoint (Base URL)</label>
            <input class="int-field-input" id="int-bb-url" type="url" placeholder="https://api.bitbucket.org/2.0" value="${esc(s.bitbucketBaseUrl||'')}">
          </div>
          <div class="int-field-group">
            <label class="int-field-label">Token ${s.hasBitbucketToken ? '<span class="int-token-ok">✓ Сохранён</span>' : ''}</label>
            <input class="int-field-input" id="int-bb-token" type="password" placeholder="Bearer token или user:app_password" value="${esc(s.bitbucketToken||'')}">
            <span class="int-field-hint">Сохранён в браузере и на сервере — повторно вводить не нужно.</span>
          </div>
          <div class="int-field-group">
            <label class="int-field-label">Ключи репозиториев / проектов</label>
            <input class="int-field-input" id="int-bb-project-keys" type="text" placeholder="my-repo, another-repo" value="${esc(s.bitbucketProjectKeys||'')}">
            <span class="int-field-hint">Через запятую. Слаги репозиториев или ключи проектов для поиска PR.</span>
          </div>
          <div class="int-field-actions">
            <button class="int-btn int-btn-ghost" id="int-bb-verify">Проверить подключение</button>
            <button class="int-btn int-btn-primary" id="int-bb-save">Сохранить</button>
          </div>
          <div class="int-verify-result hidden" id="int-bb-verify-result"></div>
        </div>

        <!-- Confluence -->
        <div class="int-stab-panel" data-panel="confluence">
          <div class="int-field-group">
            <label class="int-field-label">Endpoint (Base URL)</label>
            <input class="int-field-input" id="int-cf-url" type="url" placeholder="https://company.atlassian.net/wiki" value="${esc(s.confluenceBaseUrl||'')}">
          </div>
          <div class="int-field-group">
            <label class="int-field-label">API Token ${s.hasConfluenceToken ? '<span class="int-token-ok">✓ Сохранён</span>' : ''}</label>
            <input class="int-field-input" id="int-cf-token" type="password" placeholder="Bearer token или email:token" value="${esc(s.confluenceToken||'')}">
            <span class="int-field-hint">Сохранён в браузере и на сервере — повторно вводить не нужно.</span>
          </div>
          <!-- V17.2 I2c — Ключи пространств (CQL space-in filter) -->
          <div class="int-field-group">
            <label class="int-field-label">Ключи пространств</label>
            <input class="int-field-input" id="int-cf-space-keys" type="text" placeholder="DEV, PAY, SBOF" value="${esc(s.confluenceSpaceKeys||'')}">
            <span class="int-field-hint">Через запятую. Видны в URL: <code>/spaces/&lt;KEY&gt;/pages/...</code>. Используются во всех запросах к Confluence (поиск страниц, активность, проверка подключения). Пустое поле = искать по всем доступным пространствам.</span>
          </div>
          <!-- V17.2 I2c — Окно активности (часов) — единое для Confluence + Pulse -->
          <div class="int-field-group">
            <label class="int-field-label">Окно активности (часов)</label>
            <input class="int-field-input" id="int-cf-window-hours" type="number" min="1" max="168" placeholder="72" value="${esc(String(s.activityWindowHours||72))}">
            <span class="int-field-hint">За какой период собирать активность (правки, комментарии, упоминания, логины). По умолчанию 72ч (3 дня). Максимум 168ч (1 неделя).</span>
          </div>
          <div class="int-field-actions">
            <button class="int-btn int-btn-ghost" id="int-cf-verify">Проверить подключение</button>
            <!-- V17.2 I2c (G7) — Audit log probe. Возвращает кто из команды
                 логинился за окно. Может вернуть «недоступен» если Audit
                 log отключён в админке Confluence (Audit log → Configuration). -->
            <button class="int-btn int-btn-ghost" id="int-cf-audit-probe">Проверить аудит логинов</button>
            <button class="int-btn int-btn-primary" id="int-cf-save">Сохранить</button>
          </div>
          <div class="int-verify-result hidden" id="int-cf-verify-result"></div>
        </div>
      </div>
      <div class="int-modal-footer">
        <div class="int-footer-row">
          <label class="int-field-label-inline" for="int-global-since-date">Загружать данные с даты</label>
          <input type="date" id="int-global-since-date" class="int-field-input int-field-input-narrow" value="${esc(s.sinceDate || '2025-01-01')}">
          <span class="int-field-hint">Применяется к Jira (updated &gt;= …) и Confluence (lastModified &gt;= …)</span>
        </div>
        <label class="int-field-label-checkbox int-global-tls">
          <input type="checkbox" id="int-global-insecure" ${s.allowInsecureTls ? 'checked' : ''}>
          Разрешить self-signed сертификаты (для всех интеграций)
        </label>
      </div>
    ` + closeWrap + ``;
}

/* ══════════════════════════════════════════════════════════
   STATUS OVERVIEW
   ══════════════════════════════════════════════════════════ */
export function renderStatusOverview(status, rows) {
  const jiraRows    = rows.filter(r => r.jiraKey);
  const prRows      = rows.filter(r => r.prUrl);
  const docRows     = rows.filter(r => r.docUrl);

  function svcCard(id, icon, name, svc, count, filterVal) {
    const connected = svc.configured;
    const badge = connected ? '<span class="int-status-ok">✓ Подключено</span>' : '<span class="int-status-none">— Не настроено</span>';
    const lastSync = status.lastSync ? `<div class="int-status-sync">Синхр.: ${fmtDate(status.lastSync)}</div>` : '';
    return `
    <div class="int-status-card" id="int-card-${id}">
      <div class="int-status-icon">${icon}</div>
      <div class="int-status-info">
        <div class="int-status-name">${name} ${badge}</div>
        <div class="int-status-count">${count} связанных задач</div>
        ${lastSync}
      </div>
      <div class="int-status-actions">
        ${connected ? `<button class="int-btn int-btn-xs" data-int-action="filter" data-filter="${esc(filterVal)}">Показать</button>` : ''}
        <button class="int-btn int-btn-xs int-btn-settings" data-int-action="settings" data-tab="${id}">Настройки</button>
      </div>
    </div>`;
  }

  return `
  <div class="int-section">
    <div class="int-section-header">
      <span class="int-section-title">Статус интеграций</span>
      <div class="int-section-actions" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="int-btn int-btn-primary" id="int-fetch-all-btn" title="Запросить все данные из Jira / Bitbucket / Confluence и обновить реестр">⤓ Загрузить всё из систем</button>
        <button class="int-btn int-btn-ghost" id="int-sync-all-btn" title="Обновить только существующие задачи с Jira Key">↺ Обновить существующие</button>
      </div>
    </div>
    <div id="int-sync-progress" class="int-sync-progress hidden"></div>
    <div class="int-status-grid">
      ${svcCard('jira',      '🔵', 'Jira',       status.jira,       jiraRows.length,  'jira')}
      ${svcCard('bitbucket', '🟡', 'Bitbucket',  status.bitbucket,  prRows.length,    'bitbucket')}
      ${svcCard('confluence','📄', 'Confluence', status.confluence, docRows.length,   'confluence')}
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════
   JIRA BLOCK
   ══════════════════════════════════════════════════════════ */
export function renderJiraBlock(rows, jiraBaseUrl) {
  const withJira = rows.filter(r => r.jiraKey);
  if (!withJira.length) {
    return `
    <div class="int-section">
      <div class="int-section-header"><span class="int-section-title">🔵 Jira</span></div>
      <div class="int-empty">
        <div class="int-empty-icon">🔵</div>
        <div class="int-empty-title">Нет задач с Jira ID</div>
        <div class="int-empty-sub">Добавьте Jira Key в колонку «Jira Key» в реестре, либо импортируйте данные с ключами.</div>
      </div>
    </div>`;
  }

  const rows_html = withJira.slice(0, 100).map(r => {
    const jiraUrl = jiraBaseUrl ? `${jiraBaseUrl.replace(/\/+$/,'')}/browse/${esc(r.jiraKey)}` : '';
    return `
    <tr class="int-table-row" data-row-id="${esc(r.id)}">
      <td class="int-td">${jiraUrl ? `<a class="int-jira-key" href="${esc(jiraUrl)}" target="_blank" rel="noreferrer">${esc(r.jiraKey)}</a>` : esc(r.jiraKey)}</td>
      <td class="int-td">${esc(r.epic||'—')}</td>
      <td class="int-td">${jiraBadge(r.jiraStatus) || '<span class="int-na">—</span>'}</td>
      <td class="int-td int-td-sm">${esc(r.jiraAssignee||'—')}</td>
      <td class="int-td int-td-sm">${fmtDate(r.jiraUpdatedAt)}</td>
      <td class="int-td int-td-sm">${esc(r.team||'—')}</td>
    </tr>`;
  }).join('');

  return `
  <div class="int-section">
    <div class="int-section-header">
      <span class="int-section-title">🔵 Jira <span class="int-section-count">${withJira.length}</span></span>
      <button class="int-btn int-btn-ghost" data-int-action="filter" data-filter="jira">Показать в реестре</button>
    </div>
    <div class="int-table-wrap">
      <table class="int-table">
        <thead><tr>
          <th class="int-th">Jira Key</th><th class="int-th">Эпик</th>
          <th class="int-th">Статус</th><th class="int-th">Исполнитель</th>
          <th class="int-th">Обновлён</th><th class="int-th">Команда</th>
        </tr></thead>
        <tbody>${rows_html}</tbody>
      </table>
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════
   BITBUCKET BLOCK
   ══════════════════════════════════════════════════════════ */
export function renderBitbucketBlock(rows) {
  const withPr   = rows.filter(r => r.prUrl);
  const withKey  = rows.filter(r => r.jiraKey);
  const noPr     = withKey.filter(r => !r.prUrl);
  const openPrs  = withPr.filter(r => r.prStatus === 'open');
  const merged   = withPr.filter(r => r.prStatus === 'merged');

  if (!withKey.length) {
    return `
    <div class="int-section">
      <div class="int-section-header"><span class="int-section-title">🟡 Bitbucket</span></div>
      <div class="int-empty"><div class="int-empty-icon">🟡</div><div class="int-empty-title">Нет задач с Jira Key</div><div class="int-empty-sub">PR поиск работает по Jira Key. Сначала добавьте Jira Key к задачам.</div></div>
    </div>`;
  }

  const statsHtml = `
  <div class="int-pr-stats">
    <div class="int-pr-stat"><span class="int-pr-stat-val">${withPr.length}</span><span class="int-pr-stat-label">всего PR</span></div>
    <div class="int-pr-stat int-pr-open"><span class="int-pr-stat-val">${openPrs.length}</span><span class="int-pr-stat-label">открытых</span></div>
    <div class="int-pr-stat int-pr-merged"><span class="int-pr-stat-val">${merged.length}</span><span class="int-pr-stat-label">merged</span></div>
    <div class="int-pr-stat int-pr-none"><span class="int-pr-stat-val">${noPr.length}</span><span class="int-pr-stat-label">без PR</span></div>
  </div>`;

  const prRows = withPr.slice(0, 50).map(r => `
    <tr class="int-table-row">
      <td class="int-td">${esc(r.jiraKey||'—')}</td>
      <td class="int-td">${esc(r.epic||'—')}</td>
      <td class="int-td">${prBadge(r.prStatus)}</td>
      <td class="int-td">${r.prUrl ? linkBtn(r.prUrl, '🔗 Открыть PR') : '<span class="int-na">—</span>'}</td>
      <td class="int-td int-td-sm">${fmtDate(r.prUpdatedAt)}</td>
    </tr>`).join('');

  const noPrHtml = noPr.length ? `
    <div class="int-subsection">
      <div class="int-subsection-title">⚠️ Задачи без PR (${noPr.length})</div>
      <div class="int-no-pr-list">
        ${noPr.slice(0,20).map(r => `
        <div class="int-no-pr-row">
          <span class="int-no-pr-key">${esc(r.jiraKey)}</span>
          <span class="int-no-pr-epic">${Utils.truncate(r.epic||'',50)}</span>
          <span class="int-no-pr-team">${esc(r.team||'—')}</span>
        </div>`).join('')}
        ${noPr.length > 20 ? `<div class="int-more">...ещё ${noPr.length - 20}</div>` : ''}
      </div>
    </div>` : '';

  return `
  <div class="int-section">
    <div class="int-section-header">
      <span class="int-section-title">🟡 Bitbucket <span class="int-section-count">${withPr.length}</span></span>
      <button class="int-btn int-btn-ghost" data-int-action="filter" data-filter="bitbucket">Показать в реестре</button>
    </div>
    ${statsHtml}
    ${withPr.length ? `
    <div class="int-table-wrap">
      <table class="int-table">
        <thead><tr>
          <th class="int-th">Jira Key</th><th class="int-th">Эпик</th>
          <th class="int-th">PR Статус</th><th class="int-th">Ссылка</th>
          <th class="int-th">Обновлён</th>
        </tr></thead>
        <tbody>${prRows}</tbody>
      </table>
    </div>` : ''}
    ${noPrHtml}
  </div>`;
}

/* ══════════════════════════════════════════════════════════
   CONFLUENCE BLOCK
   ══════════════════════════════════════════════════════════ */
export function renderConfluenceBlock(rows) {
  const withDoc  = rows.filter(r => r.docUrl);
  const withKey  = rows.filter(r => r.jiraKey);
  const noDoc    = withKey.filter(r => !r.docUrl);

  if (!withKey.length) {
    return `
    <div class="int-section">
      <div class="int-section-header"><span class="int-section-title">📄 Confluence</span></div>
      <div class="int-empty"><div class="int-empty-icon">📄</div><div class="int-empty-title">Нет задач с Jira Key</div><div class="int-empty-sub">Документация ищется по Jira Key задачи.</div></div>
    </div>`;
  }

  const docRows = withDoc.slice(0, 50).map(r => `
    <tr class="int-table-row">
      <td class="int-td">${esc(r.jiraKey||'—')}</td>
      <td class="int-td">${r.docTitle ? esc(r.docTitle) : '<span class="int-na">—</span>'}</td>
      <td class="int-td">${r.docUrl ? linkBtn(r.docUrl, '📄 Открыть') : '<span class="int-na">—</span>'}</td>
      <td class="int-td int-td-sm">${esc(r.team||'—')}</td>
    </tr>`).join('');

  const noDocHtml = noDoc.length ? `
    <div class="int-subsection">
      <div class="int-subsection-title">📭 Задачи без документации (${noDoc.length})</div>
      <div class="int-no-pr-list">
        ${noDoc.slice(0,15).map(r => `
        <div class="int-no-pr-row">
          <span class="int-no-pr-key">${esc(r.jiraKey)}</span>
          <span class="int-no-pr-epic">${Utils.truncate(r.epic||'',50)}</span>
          <span class="int-no-pr-team">${esc(r.team||'—')}</span>
        </div>`).join('')}
        ${noDoc.length > 15 ? `<div class="int-more">...ещё ${noDoc.length - 15}</div>` : ''}
      </div>
    </div>` : '';

  return `
  <div class="int-section">
    <div class="int-section-header">
      <span class="int-section-title">📄 Confluence <span class="int-section-count">${withDoc.length}</span></span>
    </div>
    ${withDoc.length ? `
    <div class="int-table-wrap">
      <table class="int-table">
        <thead><tr>
          <th class="int-th">Jira Key</th><th class="int-th">Название</th>
          <th class="int-th">Ссылка</th><th class="int-th">Команда</th>
        </tr></thead>
        <tbody>${docRows}</tbody>
      </table>
    </div>` : ''}
    ${noDocHtml}
  </div>`;
}

/* ══════════════════════════════════════════════════════════
   CROSS-SOURCE ANALYSIS: PLAN VS REALITY
   ══════════════════════════════════════════════════════════ */
export function renderCrossAnalysis(rows) {
  const activeRows = rows.filter(r => !r.isDone);
  const inRelease  = activeRows.filter(r => r.hasRelease120 || r.hasRelease121 || r.hasRelease122);
  const withKey    = activeRows.filter(r => r.jiraKey);

  // Tasks in release but no assignee in Jira
  const noJiraAssignee = inRelease.filter(r => r.jiraKey && !r.jiraAssignee);
  // Tasks in release but no PR
  const noPr = inRelease.filter(r => r.jiraKey && !r.prUrl);
  // Tasks stalled (jiraUpdatedAt > 7 days ago)
  const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const stalled = withKey.filter(r => {
    if (!r.jiraUpdatedAt) return false;
    try { return new Date(r.jiraUpdatedAt).getTime() < sevenDaysAgo; } catch(_) { return false; }
  });
  // Tasks in release but no documentation
  const noDoc = inRelease.filter(r => r.jiraKey && !r.docUrl);

  const findings = [
    noJiraAssignee.length && {
      icon:'👤', sev:'warning',
      title:`${noJiraAssignee.length} задач в релизе без Jira Assignee`,
      text:'Задачи никому не назначены в Jira — ответственность неопределена.',
      filter:'no-jira-assignee',
    },
    noPr.length && {
      icon:'🔀', sev:'warning',
      title:`${noPr.length} задач в релизе без PR`,
      text:'Разработка без pull request — нет код-ревью, нет отслеживания прогресса.',
      filter:'no-pr',
    },
    stalled.length && {
      icon:'⏸', sev:'warning',
      title:`${stalled.length} задач зависли (>7 дней без обновления в Jira)`,
      text:'Задачи не двигаются. Возможно, блокеры или брошенные задачи.',
      filter:'stalled',
    },
    noDoc.length && {
      icon:'📭', sev:'info',
      title:`${noDoc.length} задач в релизе без документации`,
      text:'Confluence документация не привязана — риск "чёрного ящика".',
      filter:'no-doc',
    },
  ].filter(Boolean);

  if (!findings.length && !withKey.length) {
    return `
    <div class="int-section">
      <div class="int-section-header"><span class="int-section-title">🔍 План vs Реальность</span></div>
      <div class="int-empty"><div class="int-empty-icon">✅</div><div class="int-empty-title">Нет данных для анализа</div><div class="int-empty-sub">Добавьте Jira Key к задачам и обновите данные интеграций.</div></div>
    </div>`;
  }

  if (!findings.length) {
    return `
    <div class="int-section">
      <div class="int-section-header"><span class="int-section-title">🔍 План vs Реальность</span></div>
      <div class="int-empty"><div class="int-empty-icon">✅</div><div class="int-empty-title">Расхождений не найдено</div><div class="int-empty-sub">Данные плана и реальных систем согласованы.</div></div>
    </div>`;
  }

  const findingsHtml = findings.map(f => `
    <div class="int-cross-item int-cross-${f.sev}">
      <span class="int-cross-icon">${f.icon}</span>
      <div class="int-cross-body">
        <div class="int-cross-title">${esc(f.title)}</div>
        <div class="int-cross-text">${esc(f.text)}</div>
      </div>
      <div class="int-cross-actions">
        <button class="int-btn int-btn-xs" data-int-action="cross-filter" data-cross="${esc(f.filter)}">Показать задачи</button>
        <button class="int-btn int-btn-xs" data-int-action="cross-explain" data-cross="${esc(f.filter)}">Объяснить</button>
      </div>
    </div>`).join('');

  return `
  <div class="int-section">
    <div class="int-section-header"><span class="int-section-title">🔍 План vs Реальность</span></div>
    <div class="int-cross-list">${findingsHtml}</div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════
   FULL PAGE
   ══════════════════════════════════════════════════════════ */
export function renderIntegrationsPage(rows, status, settings) {
  return `
  <div class="int-page" id="int-page">
    ${renderStatusOverview(status, rows)}
    ${renderCrossAnalysis(rows)}
    ${renderJiraBlock(rows, settings.jiraBaseUrl || '')}
    ${renderBitbucketBlock(rows)}
    ${renderConfluenceBlock(rows)}
  </div>`;
}

/* ── Empty state ─────────────────────────────────────────── */
export function renderIntegrationsEmpty() {
  return `
  <div class="int-page">
    <div class="int-empty int-empty-full">
      <div class="int-empty-icon">🔗</div>
      <div class="int-empty-title">Нет данных для интеграций</div>
      <div class="int-empty-sub">Загрузите задачи из Jira напрямую или импортируйте файл.</div>
      <div class="int-empty-actions" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px">
        <button class="int-btn int-btn-primary" id="int-fetch-all-btn" title="Запросить задачи из Jira и создать строки в реестре">⤓ Загрузить из Jira</button>
        <button class="int-btn int-btn-ghost"   data-int-action="settings" data-tab="jira">⚙ Настроить интеграции</button>
      </div>
    </div>
    <div id="int-sync-progress" class="int-sync-progress hidden"></div>
  </div>`;
}
