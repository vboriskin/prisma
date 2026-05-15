'use strict';
/* ============================================================
   INTEGRATIONS RENDERER — v10_0
   Pure HTML-string renderers. No state mutation, no side effects.
   ============================================================ */

import { Utils } from '../utils.js';
import { Icons } from '../app/icons.js';
const esc = s => Utils.escapeHtml(String(s ?? ''));

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
    : `<div class="int-modal-header"><span class="int-modal-title">${Icons.get('settings', { cls: 'btn-icon', size: 14 })} Настройки интеграций</span><button class="int-modal-close" id="int-modal-close" aria-label="Закрыть">${Icons.get('x', { size: 14 })}</button></div>`;
  const openWrap  = inline
    ? `<div class="int-inline" id="int-settings-modal">`
    : `<div class="int-modal-overlay" id="int-settings-modal"><div class="int-modal-box">`;
  const closeWrap = inline ? `</div>` : `</div></div>`;
  // AUDIT_ARTDIRECTION #32 — пустые настройки = первый контакт с системой.
  // Показываем маскот в углу + caption «компаньон-feel». Detect: ни один
  // из 5 каналов не имеет URL+token. На пустой панели юзер видит, что
  // система ждёт связь. CSS-инжект — один раз, idempotent (см. _ensure...).
  const isEmpty = !(
    (s.jiraBaseUrl       && s.hasJiraToken)       ||
    (s.sigmaJiraBaseUrl  && s.hasSigmaJiraToken)  ||
    (s.bitbucketBaseUrl  && s.hasBitbucketToken)  ||
    (s.confluenceBaseUrl && s.hasConfluenceToken) ||
    (s.jenkinsBaseUrl    && s.hasJenkinsToken)
  );
  const mascotIllust = isEmpty ? _renderEmptyMascot() : '';
  return openWrap + headerHtml + `
      <div class="int-modal-body${isEmpty ? ' int-modal-body-empty' : ''}">
        ${mascotIllust}
        <!-- V17.1.3 — Jira (Delta + Sigma) разделено на две независимые
             вкладки. Bindings (#int-jira-* / #int-sigma-*) сохранены —
             меняется только разметка вкладок и панелей. -->
        <div class="int-settings-tabs">
          <button class="int-stab active" data-stab="jira-delta">Jira Delta</button>
          <button class="int-stab" data-stab="jira-sigma">Jira Sigma</button>
          <button class="int-stab" data-stab="bitbucket">Bitbucket</button>
          <button class="int-stab" data-stab="confluence">Confluence</button>
          <button class="int-stab" data-stab="jenkins">Jenkins</button>
        </div>

        <!-- Jira Delta — основная Jira, источник задач команд -->
        <div class="int-stab-panel active" data-panel="jira-delta">
          <div class="int-subblock-title">Delta Jira <span class="int-subblock-hint">— основная Jira, источник задач команд</span></div>
          <div class="int-field-group">
            <label class="int-field-label">Endpoint (Base URL)</label>
            <input class="int-field-input" id="int-jira-url" type="url" placeholder="https://company.atlassian.net" value="${esc(s.jiraBaseUrl||'')}">
          </div>
          <div class="int-field-group">
            <label class="int-field-label">API Token ${s.hasJiraToken ? `<span class="int-token-ok">${Icons.get('check', { cls: 'btn-icon', size: 12 })} Сохранён</span>` : ''}</label>
            <input class="int-field-input" id="int-jira-token" type="password" placeholder="${s.hasJiraToken ? '••••••••' : 'Bearer token или email:token'}">
            <span class="int-field-hint">Если оставить поле пустым при сохранении — текущий токен НЕ перезаписывается. <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">Создать токен →</a></span>
          </div>
          <div class="int-field-group">
            <label class="int-field-label">Ключи проектных пространств</label>
            <input class="int-field-input" id="int-jira-project-keys" type="text" placeholder="PAY, SBOF, KYC" value="${esc(s.jiraProjectKeys||'')}">
            <span class="int-field-hint">Через запятую. Используется для запросов в Jira (JQL <code>project in (...)</code>) и в Portfolio Pulse.</span>
          </div>
          <div class="int-field-actions">
            <button class="int-btn int-btn-ghost" id="int-jira-verify" title="Delta = основная Jira с задачами команд">Проверить Delta</button>
            <button class="int-btn int-btn-primary" id="int-jira-save" title="Delta = основная Jira с задачами команд">Сохранить Delta</button>
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
            <label class="int-field-label">Personal Access Token ${s.hasSigmaJiraToken ? `<span class="int-token-ok">${Icons.get('check', { cls: 'btn-icon', size: 12 })} Сохранён</span>` : ''}</label>
            <input class="int-field-input" id="int-sigma-token" type="password" placeholder="${s.hasSigmaJiraToken ? '••••••••' : 'Bearer token или email:token'}">
            <span class="int-field-hint">Если оставить поле пустым при сохранении — текущий токен НЕ перезаписывается.</span>
          </div>
          <div class="int-field-group">
            <label class="int-field-label">Ключи квартальных эпиков-целей</label>
            <input class="int-field-input" id="int-sigma-goal-epic-keys" type="text" placeholder="GOAL-1, GOAL-2, GOAL-3" value="${esc(s.sigmaGoalEpicKeys||'')}">
            <span class="int-field-hint">Через запятую. Каждый эпик содержит поле <code>Domain link</code> — массив ключей задач Delta.</span>
          </div>
          <div class="int-field-actions">
            <button class="int-btn int-btn-ghost" id="int-sigma-verify" title="Sigma = Jira с эпиками-целями квартала">Проверить Sigma</button>
            <button class="int-btn int-btn-primary" id="int-sigma-save" title="Sigma = Jira с эпиками-целями квартала">Сохранить Sigma</button>
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
            <label class="int-field-label">Token ${s.hasBitbucketToken ? `<span class="int-token-ok">${Icons.get('check', { cls: 'btn-icon', size: 12 })} Сохранён</span>` : ''}</label>
            <input class="int-field-input" id="int-bb-token" type="password" placeholder="${s.hasBitbucketToken ? '••••••••' : 'Bearer token или user:app_password'}">
            <span class="int-field-hint">Если оставить поле пустым при сохранении — текущий токен НЕ перезаписывается.</span>
          </div>
          <div class="int-field-group">
            <label class="int-field-label">Ключи репозиториев / проектов</label>
            <input class="int-field-input" id="int-bb-project-keys" type="text" placeholder="my-repo, another-repo" value="${esc(s.bitbucketProjectKeys||'')}">
            <span class="int-field-hint">Через запятую. Слаги репозиториев или ключи проектов для поиска PR.</span>
          </div>
          ${_renderBbSuggestedProjects(opts.bbSuggestedProjects, s.bitbucketProjectKeys || '')}
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
            <label class="int-field-label">API Token ${s.hasConfluenceToken ? `<span class="int-token-ok">${Icons.get('check', { cls: 'btn-icon', size: 12 })} Сохранён</span>` : ''}</label>
            <input class="int-field-input" id="int-cf-token" type="password" placeholder="${s.hasConfluenceToken ? '••••••••' : 'Bearer token или email:token'}">
            <span class="int-field-hint">Если оставить поле пустым при сохранении — текущий токен НЕ перезаписывается.</span>
          </div>
          <!-- V17.2 I2c — Ключи пространств (CQL space-in filter) -->
          <div class="int-field-group">
            <label class="int-field-label">Ключи пространств</label>
            <input class="int-field-input" id="int-cf-space-keys" type="text" placeholder="DEV, PAY, SBOF" value="${esc(s.confluenceSpaceKeys||'')}">
            <span class="int-field-hint">Через запятую. Видны в URL: <code>/spaces/&lt;KEY&gt;/pages/...</code>. Используются во всех запросах к Confluence (поиск страниц, активность, проверка подключения). Пустое поле = искать по всем доступным пространствам.</span>
          </div>
          <!-- V17.2 I2c — Окно активности (часов) — единое для BB / Jira / Confluence + Pulse -->
          <!-- V20 S1.3 — пресеты 24/72/168 + custom (PO request: «удобный выбор окна»). -->
          <div class="int-field-group">
            <label class="int-field-label">Окно активности — Bitbucket / Jira / Confluence (часов)</label>
            ${(() => {
              const wh = Number(s.activityWindowHours) || 72;
              const isPreset = wh === 24 || wh === 72 || wh === 168;
              const preset = isPreset ? String(wh) : 'custom';
              const r = (val, label, hint) =>
                `<label class="int-window-preset ${preset === val ? 'int-window-preset-active' : ''}">
                  <input type="radio" name="int-cf-window-preset" value="${val}" ${preset === val ? 'checked' : ''}>
                  <span class="int-window-preset-label">${esc(label)}</span>
                  <span class="int-window-preset-hint">${esc(hint)}</span>
                </label>`;
              return `
                <div class="int-window-presets" role="radiogroup" aria-label="Окно активности">
                  ${r('24',     '24 ч',  'сутки')}
                  ${r('72',     '72 ч',  '3 дня — по умолчанию')}
                  ${r('168',    '168 ч', 'неделя')}
                  ${r('custom', 'своё',  '1–168 ч')}
                </div>
                <div class="int-window-custom ${preset === 'custom' ? '' : 'hidden'}" id="int-cf-window-custom-wrap">
                  <input class="int-field-input" id="int-cf-window-hours" type="number" min="1" max="168" placeholder="72" value="${esc(String(wh))}">
                  <span class="int-field-hint">диапазон: 1–168 часов</span>
                </div>
              `;
            })()}
            <span class="int-field-hint">За какой период собирать активность из всех трёх систем: коммиты, PR, правки страниц, комментарии и события Jira-таймлайна. Heatmap всегда показывает ровно 72ч независимо от этого значения.</span>
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

        <!-- V21 Jenkins — CI integration для Сканнера команд. -->
        <div class="int-stab-panel" data-panel="jenkins">
          <div class="int-subblock-title">Jenkins CI <span class="int-subblock-hint">— builds + успешность для team-glance в Сканнере</span></div>
          <div class="int-field-group">
            <label class="int-field-label">Endpoint (Base URL)</label>
            <input class="int-field-input" id="int-jenkins-url" type="url" placeholder="https://sbof.ci.jenkins.sberbank.ru" value="${esc(s.jenkinsBaseUrl||'')}">
            <span class="int-field-hint">
              Корень Jenkins-инстанса. Если у команды отдельный shard (например <code>sbof.ci.jenkins.sberbank.ru</code>) — используйте его, не общий <code>ci.jenkins.sberbank.ru</code>.
              <br><strong>Внимание:</strong> Sber DREAM Jenkins (<code>*.sberbank.ru</code>) и Sber Delta (Jira/BB/CF на <code>*.delta.sbrf.ru</code>) — <strong>разные security perimeters</strong>. Token, валидный для Jira/BB/CF, может не работать на Jenkins. API token нужно создать именно в Jenkins UI (см. ниже).
            </span>
          </div>
          <div class="int-field-group">
            <label class="int-field-label">Token ${s.hasJenkinsToken ? `<span class="int-token-ok">${Icons.get('check', { cls: 'btn-icon', size: 12 })} Сохранён</span>` : ''}</label>
            <input class="int-field-input" id="int-jenkins-token" type="password" placeholder="${s.hasJenkinsToken ? '••••••••' : 'username:apiToken (например i.ivanov:11abc...)'}">
            <span class="int-field-hint">
              <strong>Формат: <code>username:apiToken</code></strong> (как у Jira/BB/CF на Sber DREAM). Голый token без username даёт 403.
              <br>API token создаётся в Jenkins: <code>People → ваш юзер → Configure → API Token → Add new Token</code>.
              <br>Если оставить поле пустым при сохранении — текущий token НЕ перезаписывается.
            </span>
          </div>
          <div class="int-field-group">
            <label class="int-field-label">Folder команды</label>
            <input class="int-field-input" id="int-jenkins-folder" type="text" placeholder="sbof" value="${esc(s.jenkinsFolder||'')}">
            <span class="int-field-hint">Имя верхнего folder'а команды (segment URL после <code>/job/</code>). Для СБОФ Платформа = <code>sbof</code>. Без него probe сканирует root.</span>
          </div>
          <div class="int-field-actions">
            <button class="int-btn int-btn-ghost" id="int-jenkins-verify">Проверить подключение</button>
            <button class="int-btn int-btn-primary" id="int-jenkins-save">Сохранить</button>
          </div>
          <div class="int-verify-result hidden" id="int-jenkins-verify-result"></div>
        </div>
      </div>
      <div class="int-modal-footer">
        <div class="int-footer-row">
          <label class="int-field-label-inline" for="int-global-since-date">Дата начала выборки</label>
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
   AUDIT_ARTDIRECTION #32 — мини-маскот в empty-settings.
   ══════════════════════════════════════════════════════════
   Если ни одна из 5 интеграций не подключена — показываем тонкую
   иллюстрацию: 8-лучевая Призма-звезда (брендбук §2 Anatomy) + caption.
   Без zoom-flash, без эмодзи. Стилизуется через runtime-injected <style>
   (id="int-empty-mascot-styles") — НЕ через styles.css по требованию
   AUDIT_ARTDIRECTION (don't touch styles.css). */
function _ensureEmptyMascotStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('int-empty-mascot-styles')) return;
  const style = document.createElement('style');
  style.id = 'int-empty-mascot-styles';
  style.textContent = `
    .int-modal-body.int-modal-body-empty { position: relative; }
    .int-empty-mascot {
      position: absolute;
      top: 14px; right: 18px;
      display: flex; flex-direction: column; align-items: flex-end;
      gap: 6px;
      pointer-events: none;
      max-width: 220px;
      z-index: 1;
    }
    .int-empty-mascot-figure {
      width: 56px; height: 56px;
      color: var(--prizma-information, #6EC1E4);
      opacity: .7;
      animation: int-empty-mascot-breathe 3.6s ease-in-out infinite;
    }
    .int-empty-mascot-figure svg { display: block; width: 100%; height: 100%; }
    .int-empty-mascot-caption {
      font-size: 11px; line-height: 1.4;
      color: var(--prizma-text-tertiary, var(--text-3, #7A7A82));
      text-align: right;
      letter-spacing: .2px;
      max-width: 200px;
    }
    @keyframes int-empty-mascot-breathe {
      0%, 100% { opacity: .55; transform: scale(1); }
      50%      { opacity: .85; transform: scale(1.04); }
    }
    @media (prefers-reduced-motion: reduce) {
      .int-empty-mascot-figure { animation: none; opacity: .7; }
    }
    @media (max-width: 720px) {
      .int-empty-mascot { position: static; max-width: 100%; align-items: center; margin: 0 0 12px 0; }
      .int-empty-mascot-caption { text-align: center; }
    }
  `;
  document.head.appendChild(style);
}

function _renderEmptyMascot() {
  _ensureEmptyMascotStyles();
  // 8-лучевая Призма-звезда (брендбук §2 Anatomy). Используем уже-существующий
  // Icons.get('star') — line-glyph 24x24, stroke=currentColor.
  const star = Icons.get('star', { size: 56, label: 'Призма ждёт связь' });
  return `
    <div class="int-empty-mascot" aria-hidden="true">
      <div class="int-empty-mascot-figure">${star}</div>
      <div class="int-empty-mascot-caption">Настрой связь — и я начну видеть курс команды</div>
    </div>
  `;
}

/**
 * V22 P-allowlist — secondary block «Дополнительные проекты» в BB-настройках.
 *
 * suggestions = unique-projects из bbDroppedSamples (см.
 * teamScanner2._lastRawDiag.bbDroppedSamples). Каждый sample имеет
 * `repo` или `project` field. Извлекаем prefix (project key) — обычно
 * первый сегмент до «/», напр. `CI00361704/foo` → `CI00361704`.
 *
 * Если suggestions пустой / Сканнер ещё не запускался — рендерим
 * подсказку «запустите Сканнер для получения предложений» вместо
 * скрытого блока (visibility важна для UX-потока).
 *
 * Уже добавленные в `bitbucketProjectKeys` исключаются из списка
 * (case-insensitive), чтобы не предлагать дубли.
 */
function _renderBbSuggestedProjects(rawSuggestions, currentKeysCsv) {
  const list = Array.isArray(rawSuggestions) ? rawSuggestions : [];
  const have = new Set(
    String(currentKeysCsv || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
  );
  // Dedupe + filter уже-добавленных. Сохраняем порядок first-seen + count.
  const counts = new Map();
  for (const p of list) {
    const key = String(p || '').trim();
    if (!key) continue;
    if (have.has(key.toLowerCase())) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const suggestions = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  if (!suggestions.length) {
    return `
      <div class="int-field-group int-bb-allowlist-empty">
        <label class="int-field-label">Дополнительные проекты</label>
        <span class="int-field-hint">
          После запуска Сканнера здесь появятся предложения по проектам, в которые
          команда контрибутит, но они <code>отброшены allowlist'ом</code> в диагностике.
        </span>
      </div>
    `;
  }
  const chips = suggestions.map(([k, n]) => `
    <label class="int-bb-allowlist-chip">
      <input type="checkbox" class="int-bb-allowlist-checkbox" value="${esc(k)}">
      <span class="int-bb-allowlist-chip-key"><code>${esc(k)}</code></span>
      <span class="int-bb-allowlist-chip-count" title="Items в активности">${n}</span>
    </label>
  `).join('');
  return `
    <div class="int-field-group int-bb-allowlist">
      <label class="int-field-label">Дополнительные проекты <span class="int-field-hint" style="margin-left:6px;">— из диагностики Сканнера</span></label>
      <span class="int-field-hint">
        Эти проекты появлялись в активности команды, но не были учтены allowlist'ом.
        Отметьте те, которые относятся к команде, и нажмите «Добавить выбранные».
      </span>
      <div class="int-bb-allowlist-chips">${chips}</div>
      <div class="int-bb-allowlist-actions">
        <button class="int-btn int-btn-ghost" id="int-bb-allowlist-add" type="button">Добавить выбранные</button>
        <span class="int-bb-allowlist-status" id="int-bb-allowlist-status" aria-live="polite"></span>
      </div>
    </div>
  `;
}
