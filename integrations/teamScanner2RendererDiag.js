'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — RENDERER (DIAGNOSTIC)
   Extracted from teamScanner2Renderer.js (2026-05-11 Tier 0 split).
   Содержит: renderDiagnosticModal + 11 _diagSection* helpers,
   renderDiagnosticDisclaimer, renderProbeResults,
   renderIdentityResolvePreview, renderSensitivityResults,
   renderCrvDrilldownModal, renderAnomalyMiniChart,
   renderVelocityCompareModal, renderHowCalculatedModal.

   ~1330 LOC. Главный renderer (teamScanner2Renderer.js) re-export'ит
   public функции из этого файла, поэтому existing imports работают
   без изменений (backward-compat).
   ============================================================ */

import { Icons } from '../app/icons.js';
import { state } from '../state.js';
// 2026-05-11 — V23 Cross-team Benchmarks subtab используется в
// renderVelocityCompareModal для отображения матрицы команды × метрики
// с подсветкой best practices.
import { runHygieneRules } from './jiraHygiene.js';
// 2026-05-12 — Common helpers (esc/plural) — Tier 0 phase 2 split.
import { esc, plural } from './teamScanner2RendererCommon.js';
// Cyclic — main re-imports renderHowCalculatedModal/renderDiagnosticModal из Diag
// и сам экспортирует HOW_SECTIONS. ES modules runtime resolves binding к моменту вызова.
import { HOW_SECTIONS } from './teamScanner2Renderer.js';

/* ════════════════════════════════════════════════════════════
   ─── V20 S8.5 #23: SPLIT BOUNDARY ──────────────────────────
   Всё ниже до конца файла — diagnostic-view функции.
   В будущей итерации (S9) — extract в отдельный файл
   `teamScanner2DiagnosticView.js`. Сейчас логически отделено
   markers, чтобы IDE/grep могли найти границу.

   Files of this section:
     - renderDiagnosticModal + 9 _diagSection* helpers
     - renderDiagnosticDisclaimer
     - renderProbeResults
     - renderSensitivityResults
     - renderIdentityResolvePreview
     - renderHowCalculatedModal
     - renderCrvDrilldownModal      (V20 S8 #2)
     - renderAnomalyMiniChart       (V20 S8.5 #20)
     ~ 1000 строк, можно вырезать целиком в новый файл.
   ════════════════════════════════════════════════════════════ */

/* ── V20 S2.3 — Diagnostic modal ──────────────────────────────
   User finding: «нет артефактов из BB / Conf — почему?»
   Решение — accordion-modal с 5+ секциями + 2-button JSON export
   (B3 consent flow: безопасный по умолчанию, полный с disclaimer'ом).
   ──────────────────────────────────────────────────────── */

export function renderDiagnosticModal(state, opts = {}) {
  const sections = [
    _diagSectionHeader(state.header, state.tzSkew),
    _diagSectionKnownIssues(state),                    // V20 S8 #12 — pilot quick-help
    _diagSectionConfig(state.config),
    _diagSectionConnection(state.connection),
    _diagSectionSources(state.sources, state.rawDiag, state.config),
    _diagSectionJenkins(state.jenkins, state.jenkinsAttributed),
    _diagSectionIdentity(state.identity),
    _diagSectionBbCfAttribution(state.bbCfAttribution), // per-employee attribution details
    _diagSectionThresholds(state.thresholds),
    _diagSectionSnapshot(state.snapshot),
    _diagSectionModelSummary(state.modelSummary),
    _diagSectionBots(state.botsFilteredOut || []),     // V20 S7 B10
  ].join('');

  const auditCount = (opts.auditEntries || []).length;
  const auditHint = auditCount
    ? `За последний период было ${auditCount} ${plural(auditCount, ['экспорт', 'экспорта', 'экспортов'])}. Все логированы.`
    : 'Журнал экспортов пуст.';

  return `
    <div class="ts2-diag-modal-overlay" id="ts2-diag-modal" role="presentation">
      <div class="ts2-diag-modal" role="dialog" aria-modal="true" aria-labelledby="ts2-diag-title">
        <div class="ts2-diag-header">
          <h3 class="ts2-diag-title" id="ts2-diag-title">${Icons.get('clipboard', { cls: 'btn-icon', size: 14 })} Диагностика Сканнера команд</h3>
          <button class="ts2-diag-close" type="button" data-close-modal aria-label="Закрыть">${Icons.get('x', { size: 14 })}</button>
        </div>
        <div class="ts2-diag-body">
          <div class="ts2-diag-intro">
            Если по BB / Jira / Confluence не приходят данные — ниже причины и как починить.
            <br>Кликните на заголовок секции чтобы развернуть.
          </div>
          ${sections}
          <div class="ts2-diag-export-section">
            <h4 class="ts2-diag-export-title">Экспортировать для разработчика</h4>
            <p class="ts2-diag-export-hint">
              Если проблему не удалось решить — отправьте JSON с диагностикой.
              Безопасный экспорт скрывает email / accountId / названия задач.
            </p>
            <div class="ts2-diag-export-buttons">
              <button class="ts2-btn ts2-btn-primary" id="ts2-diag-export-safe" type="button">
                ${Icons.get('shield-check', { cls: 'btn-icon', size: 14 })} Безопасный экспорт
              </button>
              <button class="ts2-btn ts2-btn-warn" id="ts2-diag-export-raw" type="button">
                ${Icons.get('alert-triangle', { cls: 'btn-icon', size: 14 })} Полный экспорт (PII)
              </button>
            </div>
            <div class="ts2-diag-audit-hint">
              ${Icons.get('lock', { cls: 'btn-icon', size: 12 })} ${esc(auditHint)}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/** V20 S2.3 — disclaimer перед raw-экспортом. B3 consent flow. */
export function renderDiagnosticDisclaimer() {
  return `
    <div class="ts2-diag-disclaimer-overlay" id="ts2-diag-disclaimer" role="presentation">
      <div class="ts2-diag-disclaimer" role="dialog" aria-modal="true" aria-labelledby="ts2-diag-disclaimer-title">
        <div class="ts2-diag-disclaimer-header">
          <span class="ts2-diag-disclaimer-icon" aria-hidden="true">${Icons.get('alert-triangle', { size: 18 })}</span>
          <h3 class="ts2-diag-disclaimer-title" id="ts2-diag-disclaimer-title">Полный экспорт содержит персональные данные</h3>
        </div>
        <div class="ts2-diag-disclaimer-body">
          <p>JSON будет содержать <b>в открытом виде</b>:</p>
          <ul class="ts2-diag-disclaimer-list">
            <li>email сотрудников (полностью, не маскированный)</li>
            <li>jiraAccountId / bitbucketLogin / confluenceAccountId</li>
            <li>имена сотрудников (displayName)</li>
            <li>названия задач Jira и страниц Confluence (полностью)</li>
          </ul>
          <p>Токены интеграций (Bearer / Authorization) <b>всегда</b> скрыты — даже здесь.</p>
          <p class="ts2-diag-disclaimer-warning">
            Отправляйте этот JSON <b>только напрямую разработчику</b>, которому вы доверяете
            (1:1 chat / личная почта). Не загружайте в публичные баги, не пересылайте через
            групповые чаты.
          </p>
          <p class="ts2-diag-disclaimer-audit">
            Факт экспорта будет залогирован в localStorage этого браузера
            (только timestamp + размер, без содержимого).
          </p>
          <!-- V20 S8.5 #21 — counter оставшегося consent (auto-show если ещё активен). -->
          <p class="ts2-diag-disclaimer-counter" id="ts2-diag-consent-counter" style="display:none;"></p>
          <!-- V20 S7 B6 — обязательный consent checkbox перед раскрытием PII.
               Compliance: HR-аудит может запросить доказательство явного согласия.
               V20 S8 #6 — добавлен «запомнить на 24ч» (q2_diag_consent_until). -->
          <label class="ts2-diag-disclaimer-consent">
            <input type="checkbox" id="ts2-diag-disclaimer-consent">
            <span>Я понимаю что JSON содержит персональные данные сотрудников
                  и обязуюсь передать его только конкретному доверенному
                  разработчику. Не буду пересылать в групповые чаты, баги
                  или публичные системы.</span>
          </label>
          <label class="ts2-diag-disclaimer-remember">
            <input type="checkbox" id="ts2-diag-disclaimer-remember">
            <span>Запомнить согласие на 24 часа (для срочных передач без повторного клика). Audit-log сохранит факт автоматического consent'а.</span>
          </label>
        </div>
        <div class="ts2-diag-disclaimer-actions">
          <button class="ts2-btn ts2-btn-ghost" type="button" data-close-modal>Отмена</button>
          <button class="ts2-btn ts2-btn-warn" type="button" id="ts2-diag-disclaimer-confirm" disabled>
            Понял риски — продолжить
          </button>
        </div>
      </div>
    </div>
  `;
}

/* Section helpers — каждая возвращает <div class="ts2-diag-section">…</div> */

function _diagSection(id, head, body, opts = {}) {
  const open = opts.openByDefault ? 'ts2-diag-section-open' : '';
  return `
    <div class="ts2-diag-section ${open}" data-section="${esc(id)}">
      <button class="ts2-diag-section-head" type="button">
        <span class="ts2-diag-section-chev" aria-hidden="true">▸</span>
        <span class="ts2-diag-section-title">${esc(head)}</span>
        ${opts.statusPill ? `<span class="ts2-diag-status-pill ts2-diag-status-${esc(opts.statusKind || 'neutral')}">${esc(opts.statusPill)}</span>` : ''}
      </button>
      <div class="ts2-diag-section-body">${body}</div>
    </div>
  `;
}

function _kv(label, value, hint) {
  const v = (value === null || value === undefined || value === '') ? '—' : String(value);
  return `<div class="ts2-diag-kv"><span class="ts2-diag-kv-label">${esc(label)}</span><span class="ts2-diag-kv-value">${esc(v)}</span>${hint ? `<span class="ts2-diag-kv-hint">${esc(hint)}</span>` : ''}</div>`;
}

// v22 — surface HTTP-status сводку (cfTriedSummary / bbTriedSummary) прямо
// в UI диагностики. Раньше это было видно только в RAW JSON-экспорте, что
// затрудняло triage «Confluence пустой» / «Bitbucket пустой». Цвет каждого
// чипа подсказывает: 200=ok, 400/4xx=warning, 401/403=auth, 0=network.
function _renderTriedSummary(label, summary) {
  if (!summary || !summary.total) return '';
  const byStatus = summary.byStatus || {};
  const codes = Object.keys(byStatus).sort();
  const chip = (code, n) => {
    const cls = code.startsWith('2') ? 'ts2-diag-status-ok'
              : (code === '401' || code === '403') ? 'ts2-diag-status-auth'
              : code.startsWith('4') ? 'ts2-diag-status-warn'
              : code === '0' ? 'ts2-diag-status-net'
              : 'ts2-diag-status-other';
    return `<span class="ts2-diag-status-chip ${cls}" title="HTTP ${code}: ${n} попыток">${esc(code)}<span class="ts2-diag-status-x">×</span>${n}</span>`;
  };
  const chips = codes.map(c => chip(c, byStatus[c])).join('');
  // Hint что коды значат, чтобы не нужно было гуглить.
  const hint = codes.includes('400') ? 'CQL переполнен (>80 имён в IN)'
             : codes.includes('401') || codes.includes('403') ? 'токен протух / нет прав'
             : codes.includes('0') ? 'network/TLS блок'
             : codes.includes('302') || codes.includes('301') ? 'SSO redirect — токен возможно cookie, не PAT'
             : codes.length === 1 && codes[0].startsWith('2') ? 'OK'
             : '';
  // V22 C2 — surface редиректнутых pathname'ов (макс 5, без query). Сервер
  // (server/confluence.js) кладёт `tried[].url = pathname-only`; клиент
  // (teamScanner2.js) дедуплицирует и кладёт в `cfTriedSummary.redirectedSamples`.
  const samples = Array.isArray(summary.redirectedSamples) ? summary.redirectedSamples : [];
  const samplesBlock = samples.length ? `
    <div class="ts2-diag-tried-redirect-row" style="grid-column: 1 / -1; margin-top:6px; font-size:12px; color: var(--prizma-text-secondary, var(--text-2, #4A4A52));">
      <span style="color: var(--prizma-warning, #C97A1A); font-weight: 600;">Редирект на эндпоинтах:</span>
      ${samples.map(p => `<code style="margin-left:6px; padding:1px 4px; background: rgba(0,0,0,.04); border-radius:3px;">${esc(p)}</code>`).join('')}
    </div>
  ` : '';
  return `<div class="ts2-diag-kv ts2-diag-tried-row">
    <span class="ts2-diag-kv-label">${esc(label)}</span>
    <span class="ts2-diag-kv-value ts2-diag-tried-chips">${chips}</span>
    ${hint ? `<span class="ts2-diag-kv-hint">${esc(hint)}</span>` : ''}
    ${samplesBlock}
  </div>`;
}

function _diagSectionHeader(h, tz) {
  // V20 S3.3 — TZ skew block.
  let tzBlock = '';
  if (tz?.available) {
    const flag = tz.skewSuspicious ? `<span class="ts2-diag-flag">${Icons.get('alert-triangle', { cls: 'btn-icon', size: 12 })} ${esc(String(tz.skewSeconds))}s skew</span>` : '';
    tzBlock = `
      <div class="ts2-diag-subhead">Time skew (browser ↔ server)</div>
      ${_kv('Browser timezone', tz.browserTzLabel)}
      ${_kv('Server fetchedAt',  tz.serverTs)}
      ${_kv('Browser now',       tz.browserNow)}
      ${_kv('Age кэша (server→now)', `${tz.skewSeconds} сек`, flag)}
      ${tz.skewSuspicious ? `<div class="ts2-diag-callout">
        Расхождение > 5 мин может указывать на:<br>
        1) <b>Часы клиента или сервера ушли</b> — проверьте System Time на обеих сторонах.<br>
        2) <b>VPN маршрутизация</b> — запрос идёт через другой регион/ДЦ.<br>
        3) <b>Старый кэш</b> — нажмите кнопку «Обновить», чтобы увидеть свежий fetchedAt.
      </div>` : ''}
    `;
  }
  return _diagSection('header', 'Окружение', `
    ${_kv('Время отчёта', h.generatedAt)}
    ${_kv('Build', h.appBuild)}
    ${_kv('Browser', h.userAgent.slice(0, 80) + (h.userAgent.length > 80 ? '…' : ''))}
    ${_kv('Locale', h.locale)}
    ${_kv('TZ offset (мин)', h.tzOffsetMin)}
    ${tzBlock}
  `, { openByDefault: true, statusPill: tz?.skewSuspicious ? 'TZ skew' : null, statusKind: tz?.skewSuspicious ? 'warn' : null });
}

function _diagSectionConfig(c) {
  const bad = !c.projectKeys.length;
  return _diagSection('config', 'Конфигурация',
    `${_kv('projectKeys (Jira)', c.projectKeys.join(', ') || '—', c.projectKeys.length ? `${c.projectKeys.length} шт.` : 'нет')}
     ${_kv('bbProjectKeys (Bitbucket)', c.bbProjectKeys.join(', ') || '—', c.bbProjectKeys.length ? `${c.bbProjectKeys.length} шт.` : 'будет искать по всем')}
     ${_kv('spaceKeys (Confluence)', c.spaceKeys.join(', ') || '—', c.spaceKeys.length ? `${c.spaceKeys.length} шт.` : 'будет искать по всем доступным')}
     ${_kv('Окно активности', c.activityWindowHours + ' ч')}
     ${_kv('sinceDate', c.sinceDate)}
     ${_kv('Jira токен', c.hasJiraToken ? 'настроен' : 'НЕ настроен', c.jiraBaseUrl)}
     ${_kv('Bitbucket токен', c.hasBitbucketToken ? 'настроен' : 'НЕ настроен', c.bitbucketBaseUrl)}
     ${_kv('Confluence токен', c.hasConfluenceToken ? 'настроен' : 'НЕ настроен', c.confluenceBaseUrl)}
     ${_kv('insecureTls', c.allowInsecureTls ? 'разрешён (self-signed)' : 'строгая проверка')}`,
    { statusPill: bad ? 'нет projectKeys' : null, statusKind: bad ? 'err' : 'ok', openByDefault: bad });
}

function _diagSectionConnection(c) {
  // V20 S3.1 — connection probe matrix UI. Кнопка вне зависимости от
  // fetchPerformed — даже без cache можно прогнать verify-endpoints.
  const probeUI = `
    <div class="ts2-diag-subhead">Live probe</div>
    <div class="ts2-diag-probe-controls">
      <button class="ts2-btn ts2-btn-ghost ts2-btn-sm" id="ts2-diag-probe-run" type="button">${Icons.get('play', { cls: 'btn-icon', size: 12 })} Прогнать все 3 интеграции</button>
      <span class="ts2-diag-probe-hint">Параллельно дёргает /verify-* endpoints, измеряет latency client-side.</span>
    </div>
    <div class="ts2-diag-probe-results" id="ts2-diag-probe-results"></div>
  `;
  if (!c.fetchPerformed) {
    return _diagSection('connection', 'Подключение / fetch',
      `<div class="ts2-diag-empty">Pulse-данные ещё не загружались (lazy mode). Нажмите «Загрузить данные команды» в основном экране — или прогоните live-probe ниже.</div>${probeUI}`,
      { statusPill: 'не запускался', statusKind: 'warn' });
  }
  const errCount = (c.perPkErrors || []).length;
  const errBlock = errCount ? `
    <div class="ts2-diag-subhead">Ошибки по проектам (${errCount}):</div>
    ${c.perPkErrors.map(e => `
      <div class="ts2-diag-err-row">
        <code class="ts2-diag-pk">${esc(e.projectKey)}</code>
        <span class="ts2-diag-err-msg">${esc(e.error)}</span>
      </div>
    `).join('')}
  ` : `<div class="ts2-diag-ok">Все per-PK fetch'и прошли без ошибок.</div>`;
  // V20 S7 B11 — jobId expiration display.
  const jobExpInfo = c.jobExpired
    ? '<span class="ts2-diag-flag">истёк — drill-down не работает</span>'
    : (c.jobExpiresInMs != null ? `осталось ${Math.round(c.jobExpiresInMs / 60000)} мин` : '');
  return _diagSection('connection', 'Подключение / fetch', `
    ${_kv('Время загрузки', c.fetchedAt)}
    ${_kv('Возраст кэша', c.cacheAgeMs != null ? Math.round(c.cacheAgeMs / 1000) + ' сек' : '—')}
    ${_kv('Latency last fetch', c.fetchLatencyMs != null ? c.fetchLatencyMs + ' мс' : '—')}
    ${_kv('jobId (TTL 120 мин)', c.jobId || '—', jobExpInfo)}
    ${errBlock}
    ${probeUI}
  `, { statusPill: errCount ? `${errCount} ошибок` : (c.jobExpired ? 'jobId истёк' : 'OK'), statusKind: errCount ? 'err' : (c.jobExpired ? 'warn' : 'ok'), openByDefault: errCount > 0 || c.jobExpired });
}

/** V20 S3.1 — render probe results после клика «Прогнать». */
export function renderProbeResults(probe) {
  if (!probe) return '<div class="ts2-diag-empty">Нет результатов probe.</div>';
  const row = (r) => {
    const kind = r.ok ? 'ok' : 'err';
    const icon = r.ok ? Icons.get('check', { cls: 'btn-icon', size: 12 }) : Icons.get('x', { cls: 'btn-icon', size: 12 });
    const detail = r.ok
      ? (r.who ? esc(r.who) : 'OK')
      : esc(r.error || 'unknown');
    return `
      <div class="ts2-diag-probe-row ts2-diag-probe-${kind}">
        <span class="ts2-diag-probe-icon" aria-hidden="true">${icon}</span>
        <code class="ts2-diag-probe-source">${esc(r.source)}</code>
        <span class="ts2-diag-probe-latency">${esc(String(r.latencyMs))} мс</span>
        <span class="ts2-diag-probe-detail">${detail}</span>
      </div>`;
  };
  return `
    <div class="ts2-diag-probe-grid">
      ${row(probe.jira)}
      ${row(probe.bitbucket)}
      ${row(probe.confluence)}
    </div>
    <div class="ts2-diag-probe-meta">Probe выполнен ${esc(probe.generatedAt)}</div>
  `;
}

/**
 * E1 — render up to 10 sample BB-items dropped by allowlist filter.
 * Helps to see «команда контрибутит во внешний repo» insight, not just count.
 *
 * Privacy: server-side cap=10, title truncated to 60 chars, no commit body.
 * Safe-mode export: name/displayName/title scrubbed via _scrubInPlace.
 */
function _diagSectionBbDroppedSamples(rawDiag, allowedProjectKeys) {
  if (!rawDiag) return '';
  const samples = Array.isArray(rawDiag.bbDroppedSamples) ? rawDiag.bbDroppedSamples : [];
  const total   = Number(rawDiag.bbDroppedOutOfAllowlist || 0);
  if (total === 0 && samples.length === 0) return '';
  const allowList = (allowedProjectKeys || []).filter(Boolean).map(esc).join(', ') || '—';
  const ago = (at) => {
    if (!at) return '—';
    const ms = Date.now() - Date.parse(at);
    if (!Number.isFinite(ms) || ms < 0) return '—';
    if (ms < 3600_000) return `${Math.round(ms / 60000)} мин`;
    if (ms < 86400_000) return `${Math.round(ms / 3600_000)} ч`;
    return `${Math.round(ms / 86400_000)} дн`;
  };
  const KIND_LABELS = { commit: 'commit', pr: 'PR', review: 'review' };
  const rows = samples.map(it => {
    const kind  = KIND_LABELS[it.kind] || esc(it.kind || '—');
    const repo  = it.repo ? esc(it.repo) : (it.project ? esc(it.project) : '—');
    const author = it.author ? esc(it.author) : (it.authorSlug ? esc(it.authorSlug) : '—');
    const title = it.title ? esc(it.title) : '';
    const titleHtml = title ? ` · <span class="ts2-diag-dropped-title">${title}</span>` : '';
    const linkHtml = it.url
      ? ` · <a class="ts2-diag-dropped-link" href="${esc(it.url)}" target="_blank" rel="noopener">↗</a>`
      : '';
    return `<tr>
      <td><code>${repo}</code></td>
      <td>${author}</td>
      <td>${kind}</td>
      <td>${esc(ago(it.at))}</td>
      <td class="ts2-diag-dropped-extra">${titleHtml}${linkHtml}</td>
    </tr>`;
  }).join('');
  const moreCount = Math.max(0, total - samples.length);
  const moreLine  = moreCount > 0
    ? `<div class="ts2-diag-help">…и ещё ${moreCount} (показано первые ${samples.length}).</div>`
    : '';
  return `
    <div class="ts2-diag-subhead">Bitbucket: ${total} items вне allowlist</div>
    <div class="ts2-diag-help">
      Allowlist (<code>bbProjectKeys</code>): <b>${allowList}</b> — измените в настройках Bitbucket.
      Возможный инсайт: команда контрибутит в чужой repo.
    </div>
    ${samples.length ? `
      <table class="ts2-diag-table">
        <thead><tr><th>Repo</th><th>Автор</th><th>Тип</th><th>Когда</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${moreLine}
    ` : `<div class="ts2-diag-help">Образцы dropped-items не сохранены (старая версия server'а или allowlist пустой).</div>`}
  `;
}

/**
 * E2/E3 — render BB authors that have raw activity but no identity-mapping
 * in state.employees (no matching bitbucketLogin/email). Shows top 30 by
 * eventCount (commits + prs).
 *
 * V22 P-bind — inline dropdown «Привязать к…» с FIO активных сотрудников.
 * Onchange handler делегируется через data-bb-bind-slug; обработчик
 * подключается в teamScanner2._openDiagModal через event delegation.
 * Активный сотрудник = !isBlocked && !isServiceAccount (см. CLAUDE.md
 * memory rule про [Х]/[X]/[В]/[B] suffix — заблокированные/уволенные).
 */
function _diagSectionBbUnattributedAuthors(rawDiag) {
  if (!rawDiag) return '';
  const list = Array.isArray(rawDiag.bbUnattributedAuthors) ? rawDiag.bbUnattributedAuthors : [];
  if (!list.length) return '';
  const totalEvents = list.reduce((s, a) => s + (a.eventCount || 0), 0);
  const SHOWN_CAP = 20;
  const shown = list.slice(0, SHOWN_CAP);
  const rest  = list.length - shown.length;

  // Build active-employees options — exclude blocked ([Х]/[X]/[В]/[B]),
  // service-accounts, и пустые ФИО. Сортировка по ФИО для удобства.
  const activeEmps = (state.employees || []).filter(e =>
    e && !e.isBlocked && !e.isServiceAccount && String(e.fio || '').trim(),
  );
  activeEmps.sort((a, b) => String(a.fio || '').localeCompare(String(b.fio || ''), 'ru'));
  const optsHtml = activeEmps.map(e => {
    const key = e.id || e.jiraKey || e.email || e.fio;
    const has = String(e.bitbucketLogin || '').trim()
      ? ` (bb: ${esc(String(e.bitbucketLogin).slice(0, 24))})`
      : '';
    return `<option value="${esc(String(key))}">${esc(e.fio)}${has}</option>`;
  }).join('');

  const rows = shown.map(a => {
    const slug = a.slug ? `<code>${esc(a.slug)}</code>` : '<span class="ts2-diag-empty">—</span>';
    const dn   = a.displayName ? esc(a.displayName) : '—';
    const ev   = `<b>${a.eventCount}</b> <span class="ts2-diag-help">(${a.commits || 0}c · ${a.prs || 0}pr)</span>`;
    const slugAttr = esc(String(a.slug || ''));
    const select = slugAttr && optsHtml
      ? `<select class="ts2-diag-bb-bind-select" data-bb-bind-slug="${slugAttr}" aria-label="Привязать ${slugAttr} к сотруднику">
          <option value="">— Привязать к… —</option>
          ${optsHtml}
        </select>`
      : '<span class="ts2-diag-empty">—</span>';
    return `<tr>
      <td>${slug}</td>
      <td>${dn}</td>
      <td>${ev}</td>
      <td>${select}</td>
    </tr>`;
  }).join('');
  const moreLine = rest > 0
    ? `<div class="ts2-diag-help">…и ещё ${rest} авторов (top-${SHOWN_CAP} показано).</div>`
    : '';
  return `
    <div class="ts2-diag-subhead">Bitbucket: ${list.length} ${list.length === 1 ? 'автор' : 'авторов'} без identity-mapping (${totalEvents} events)</div>
    <div class="ts2-diag-help">
      Привяжите BB-slug к сотруднику в реестре — выберите ФИО в выпадающем «Привязать к…».
      Это запишет <code>bitbucketLogin</code> и запустит refresh Сканнера. Также можно запустить
      Auto-Resolve в секции Identity coverage ниже.
    </div>
    <table class="ts2-diag-table">
      <thead><tr><th>BB slug</th><th>Display name</th><th>Events</th><th>Действие</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${moreLine}
  `;
}

function _diagSectionSources(s, rawDiag, config) {
  const fmt = (n) => Number.isFinite(n) ? n.toLocaleString('ru-RU') : '—';
  const allowedProjectKeys = config?.bbProjectKeys || [];
  if (!s.jira && !s.bitbucket && !s.confluence) {
    return _diagSection('sources', 'Артефакты по источникам',
      `<div class="ts2-diag-empty">Нет данных — fetch не запускался.</div>`,
      { statusKind: 'neutral' });
  }
  // Highlight «нет данных» по каждому источнику.
  const bbZero = s.bitbucket && s.bitbucket.totalItems === 0;
  const cfZero = s.confluence && s.confluence.totalItems === 0;
  const warnings = [];
  if (bbZero) warnings.push('Bitbucket: 0 артефактов');
  if (cfZero) warnings.push('Confluence: 0 артефактов');
  return _diagSection('sources', 'Артефакты по источникам', `
    <div class="ts2-diag-subhead">Jira</div>
    ${_kv('Назначенные задачи (issuesNow)', fmt(s.jira?.issuesAssignedNow))}
    ${_kv('События timeline 72ч', fmt(s.jira?.timelineEvents72h))}
    ${_kv('Комментарии recent', fmt(s.jira?.commentsRecent))}
    ${_kv('Project spaces в model', fmt(s.jira?.perPkSpaces))}
    <div class="ts2-diag-subhead">Bitbucket ${bbZero ? `<span class="ts2-diag-flag">${Icons.get('alert-triangle', { cls: 'btn-icon', size: 12 })} нулевые</span>` : ''}</div>
    ${_kv('Всего items', fmt(s.bitbucket?.totalItems))}
    ${_kv('Commits', fmt(s.bitbucket?.commits))}
    ${_kv('Pull Requests', fmt(s.bitbucket?.prs))}
    ${_kv('Reviews', fmt(s.bitbucket?.reviews))}
    ${_renderTriedSummary('Попытки HTTP', rawDiag?.bbTriedSummary)}
    <div class="ts2-diag-subhead">Confluence ${cfZero ? `<span class="ts2-diag-flag">${Icons.get('alert-triangle', { cls: 'btn-icon', size: 12 })} нулевые</span>` : ''}</div>
    ${_kv('Items (правки + страницы + комменты)', fmt(s.confluence?.totalItems))}
    ${_renderTriedSummary('Попытки CQL', rawDiag?.cfTriedSummary)}
    <div class="ts2-diag-subhead">Zephyr</div>
    ${_kv('Тесты создано', fmt(s.zephyr?.testsCreated))}
    ${_kv('Тесты выполнено', fmt(s.zephyr?.testsExecuted))}
    ${(bbZero || cfZero) ? `<div class="ts2-diag-callout">
      Нулевые артефакты обычно означают одну из:<br>
      1) <b>Identity coverage</b> — у сотрудников не заполнены <code>bitbucketLogin</code> / <code>confluenceAccountId</code> в реестре. См. секцию «Identity coverage» ниже.<br>
      2) <b>Окно слишком короткое</b> — попробуйте увеличить «Окно активности» в настройках до 168ч.<br>
      3) <b>Token / permission</b> — проверьте кнопками «Проверить подключение» в настройках.
    </div>` : ''}
    ${rawDiag ? `
      <div class="ts2-diag-subhead">RAW counts (до identity-attribution)</div>
      ${_kv('BB authors (raw)', rawDiag.bbAuthorsCount,
        rawDiag.bbItemsTotal + ' items total'
        + (rawDiag.bbDroppedOutOfAllowlist > 0
          ? ` · <span class="ts2-diag-flag-soft" aria-live="polite" style="white-space:nowrap;">отброшено allowlist'ом: ${rawDiag.bbDroppedOutOfAllowlist}</span>`
          : ''))}
      ${_kv('CF authors (raw)', rawDiag.cfAuthorsCount,
        rawDiag.cfItemsTotal + ' items total'
        + (rawDiag.cfMentionsUnattributed > 0
          ? ` · <span class="ts2-diag-flag-soft" aria-live="polite" style="white-space:nowrap;">упоминаний без авторства: ${rawDiag.cfMentionsUnattributed}</span>`
          : ''))}
      ${_kv('Zephyr authors (raw)', rawDiag.zephyrAuthorsCount, `${rawDiag.zephyrTestCasesScanned} test cases · ${rawDiag.zephyrTestRunsScanned} test runs · ${rawDiag.zephyrProjectsResolved} projects${rawDiag.zephyrMode ? ' · режим: <code>' + esc(rawDiag.zephyrMode) + '</code>' : ''}`)}
      ${rawDiag.bigMetricsTimeouts && Object.keys(rawDiag.bigMetricsTimeouts).length
        ? `<div class="ts2-diag-flag-row">${Object.keys(rawDiag.bigMetricsTimeouts).map(k => `<span class="ts2-diag-flag-pill" title="Поднимите PULSE_PK_TIMEOUT_MS env">${Icons.get('alert-triangle', { cls: 'btn-icon', size: 11 })} timeout: ${esc(k)}</span>`).join(' ')}</div>`
        : ''}
      ${(() => {
        // QD12: explainer для total-расхождений (raw vs resolved per-person).
        const r = s.modelSummary?._raw || s.summary?._raw;
        if (!r) return '';
        const lines = [];
        if (r.commits48hUnresolved > 0) lines.push(`коммитов без атрибуции: ${r.commits48hUnresolved}`);
        if (r.pr48hUnresolved > 0)      lines.push(`PR без атрибуции: ${r.pr48hUnresolved}`);
        if (r.conf48hUnresolved > 0)    lines.push(`CF-events без атрибуции: ${r.conf48hUnresolved}`);
        if (!lines.length) return '';
        return `<div class="ts2-diag-flag-soft" style="display:block;margin-top:6px;">Расхождение «команда vs по людям»: ${lines.join(', ')}. Это активность от авторов которых нет в реестре сотрудников или у которых не заполнен <code>bitbucketLogin</code>/<code>email</code>.</div>`;
      })()}
      ${rawDiag.bbAuthorsCount > 0 && (s.bitbucket?.totalItems || 0) === 0
        ? `<div class="ts2-diag-flag">${Icons.get('alert-triangle', { cls: 'btn-icon', size: 12 })} BB вернул данные, но 0 attribution — это identity gap</div>`
        : ''}
      ${(rawDiag.bbAuthorSlugs || []).length > 0 ? `
        <div class="ts2-diag-subhead">BB slug-и (${rawDiag.bbAuthorSlugs.length}) — сравни с <code>bitbucketLogin</code> в реестре сотрудников:</div>
        <div class="ts2-diag-slug-list">${rawDiag.bbAuthorSlugs.map(sl => `<code class="ts2-diag-slug">${esc(sl)}</code>`).join(' ')}</div>
      ` : ''}
      ${_diagSectionBbDroppedSamples(rawDiag, allowedProjectKeys)}
      ${_diagSectionBbUnattributedAuthors(rawDiag)}
      ${rawDiag.cfAuthorsCount > 0 && (s.confluence?.totalItems || 0) === 0
        ? `<div class="ts2-diag-flag">${Icons.get('alert-triangle', { cls: 'btn-icon', size: 12 })} CF вернул данные, но 0 attribution — это identity gap</div>`
        : ''}
      ${rawDiag.perPk?.length ? `
        <div class="ts2-diag-subhead">Per-PK</div>
        <table class="ts2-diag-table">
          <thead><tr><th>PK</th><th>Issues</th><th>Sprints</th><th>Status</th></tr></thead>
          <tbody>
            ${rawDiag.perPk.map(pk => `<tr>
              <td><code>${esc(pk.pk)}</code></td>
              <td>${pk.issuesCount}</td>
              <td>${pk.sprintCount}</td>
              <td>${pk.hasError ? `<span class="ts2-diag-flag">${esc(pk.error || 'error')}</span>` : 'OK'}</td>
            </tr>`).join('')}
          </tbody>
        </table>` : ''}
    ` : ''}
  `, { statusPill: warnings.length ? warnings.length + ' предупр.' : 'OK', statusKind: warnings.length ? 'warn' : 'ok', openByDefault: warnings.length > 0 });
}

/**
 * Phase-1 Jenkins MVP (2026-05-10) — UI-секция диагностики.
 * Источник: state.jenkins (snapshot от /api/integrations/jenkins-scan).
 * Если не настроено / unreachable → одна строка «Подключено: нет».
 *
 * Показывает: connected / folder / fetchedAt / jobs scanned / builds 7d
 * + failure-rate / authors (raw vs attributed) / errors (первые 3).
 */
function _diagSectionJenkins(jenkins, attributedCount) {
  const fmt = (n) => Number.isFinite(n) ? n.toLocaleString('ru-RU') : '—';
  // 2026-05-11 — jenkins всегда не-null благодаря Diagnostic.gather'у
  // (legacy null fallback оставлен на случай старого state из cache).
  if (!jenkins) {
    return _diagSection('jenkins', 'Jenkins',
      `<div class="ts2-diag-callout">Jenkins не сканировался (fetch не запускался либо runtime-error в jenkins_attach). Проверьте network log и settings → jenkinsBaseUrl/jenkinsToken.</div>`,
      { statusPill: 'нет данных', statusKind: 'warn', openByDefault: true });
  }
  if (jenkins.error) {
    const reason = String(jenkins.error);
    // Hint-расшифровка типичных reason'ов для пилота.
    let hint = '';
    if (/^not-fetched$/i.test(reason)) {
      hint = 'Сканнер не отправлял запрос — проверьте, что endpoint /api/integrations/jenkins-scan включён и jenkins-блок в teamScanner2.js не выкинуло до его await.';
    } else if (/timeout/i.test(reason)) {
      hint = 'Jenkins не ответил за 8 секунд — возможно SSO-redirect или сетевой таймаут. Используйте Personal Access Token, не cookie.';
    } else if (/HTTP 401|HTTP 403|auth/i.test(reason)) {
      hint = 'Токен истёк или недостаточно прав. Перевыпустите Jenkins API token в профиле.';
    } else if (/HTTP 5/i.test(reason)) {
      hint = 'Jenkins вернул 5xx — серверная проблема, попробуйте позже.';
    } else if (/aborted/i.test(reason)) {
      hint = 'Запрос отменён (новый refresh поверх предыдущего) — обычно безопасно, повторится при следующем fetch.';
    }
    return _diagSection('jenkins', 'Jenkins',
      `<div class="ts2-diag-callout">Подключено: <b>нет</b><br>Ошибка: <code>${esc(reason)}</code>${hint ? `<br><span class="ts2-diag-hint">${esc(hint)}</span>` : ''}</div>`,
      { statusPill: 'fail', statusKind: 'warn', openByDefault: true });
  }
  const fetchedAt = jenkins.fetchedAt ? new Date(jenkins.fetchedAt) : null;
  const fetchedAtStr = fetchedAt ? fetchedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  const ageMin = fetchedAt ? Math.round((Date.now() - fetchedAt.getTime()) / 60000) : null;
  const ageStr = ageMin != null ? ` (${ageMin} мин назад)` : '';
  const totalJobs = jenkins.totalJobs || 0;
  const scannedJobs = jenkins.scannedJobs || 0;
  const builds7d = jenkins.summary?.totalBuilds7d || 0;
  const failures7d = jenkins.summary?.failures7d || 0;
  const failureRatePct = jenkins.summary?.failureRatePct || 0;
  // 2026-05-11 — diagnostic.gather теперь сохраняет perAuthorCount/errors
  // вместо raw perAuthor (scrub-friendly). Поддерживаем оба shape'а.
  const authorsCount = (typeof jenkins.perAuthorCount === 'number')
    ? jenkins.perAuthorCount
    : (jenkins.perAuthor ? Object.keys(jenkins.perAuthor).length : 0);
  const errs = Array.isArray(jenkins.errors) ? jenkins.errors : [];
  const errsHtml = errs.length
    ? `<div class="ts2-diag-subhead">Ошибки (${errs.length}, первые 3)</div>
       <ul class="ts2-diag-incomplete-list">
         ${errs.slice(0, 3).map(e => `<li><code>${esc(e.scope || '')}</code>: ${esc(e.message || '')}</li>`).join('')}
       </ul>`
    : '';
  const statusPill = errs.length ? `${errs.length} ошиб.` : 'OK';
  const statusKind = errs.length ? 'warn' : 'ok';
  return _diagSection('jenkins', 'Jenkins', `
    ${_kv('Подключено', 'да')}
    ${_kv('Folder', jenkins.folder || '—')}
    ${_kv('Last fetch', `${fetchedAtStr}${ageStr}`)}
    ${_kv('Jobs', `${fmt(scannedJobs)} / ${fmt(totalJobs)} отсканировано`)}
    ${_kv('Builds 7д', `${fmt(builds7d)} (failure rate ${failureRatePct}%)`)}
    ${_kv('Authors', `${fmt(authorsCount)} (атрибутировано к ${fmt(attributedCount || 0)} в реестре)`)}
    ${_kv('Deploy/7д', fmt(jenkins.summary?.deployFreqPer7d || 0))}
    ${_kv('MTTR (proxy)', `${jenkins.summary?.mttrHours || 0} ч`)}
    ${errsHtml}
  `, { statusPill, statusKind, openByDefault: errs.length > 0 });
}

function _diagSectionIdentity(i) {
  if (!i.teamSize) {
    return _diagSection('identity', 'Identity coverage',
      `<div class="ts2-diag-empty">Команда пуста — нечего проверять.</div>`);
  }
  const c = i.coverage;
  const bar = (label, c) => `
    <div class="ts2-diag-bar-row">
      <span class="ts2-diag-bar-label">${esc(label)}</span>
      <div class="ts2-diag-bar"><div class="ts2-diag-bar-fill ts2-diag-bar-${c.pct >= 80 ? 'ok' : c.pct >= 50 ? 'warn' : 'err'}" style="width:${c.pct}%"></div></div>
      <span class="ts2-diag-bar-count">${c.count}/${i.teamSize} (${c.pct}%)</span>
    </div>`;
  const incomplete = (i.incomplete || []).slice(0, 20);
  const incompleteHtml = incomplete.length ? `
    <div class="ts2-diag-subhead">Сотрудники с неполной identity (${i.incomplete.length}, показано первые 20):</div>
    <ul class="ts2-diag-incomplete-list">
      ${incomplete.map(p => `<li><b>${esc(p.label || p.key)}</b> — нет: ${(p.missing || []).map(esc).join(', ')}</li>`).join('')}
    </ul>
  ` : `<div class="ts2-diag-ok">У всех сотрудников identity-поля заполнены.</div>`;
  const lowest = Math.min(c.email?.pct ?? 100, c.jiraId?.pct ?? 100, c.bbLogin?.pct ?? 100, c.cfId?.pct ?? 100, c.jkName?.pct ?? 100);
  // V20 S4 — кнопка автo-резолва. Видна только когда есть неполные identity'и
  // И при условии что есть email-coverage > 0 (иначе нечем матчить).
  const canResolve = (i.incomplete || []).length > 0 && (c.email?.pct ?? 0) > 0;
  // V22 B1+B2 — счётчик missing-cf / missing-bb для CTA-копи в bulk-кнопке.
  // Phase-2 (2026-05-10) — добавлен missingJenkins.
  // Считаем по teamSize - count (count = у кого поле есть).
  const missingCf      = Math.max(0, (i.teamSize || 0) - (c.cfId?.count    ?? 0));
  const missingBb      = Math.max(0, (i.teamSize || 0) - (c.bbLogin?.count ?? 0));
  const missingJenkins = Math.max(0, (i.teamSize || 0) - (c.jkName?.count  ?? 0));
  const labelParts = [];
  if (missingCf)      labelParts.push(`cfId для ${missingCf}`);
  if (missingBb)      labelParts.push(`bbLogin для ${missingBb}`);
  if (missingJenkins) labelParts.push(`jenkinsUserName для ${missingJenkins}`);
  const bulkLabel = labelParts.length ? `Найти ${labelParts.join(' · ')}` : 'Bulk-резолв';
  const resolveUI = canResolve ? `
    <div class="ts2-diag-subhead">Авторазрешение через email</div>
    <div class="ts2-diag-resolve-controls">
      <button class="ts2-btn ts2-btn-primary ts2-btn-sm" id="ts2-diag-bulk-resolve-btn" type="button" title="Заполнить пустые bbLogin / cfId без preview. Существующие значения не трогаются.">
        ${Icons.get('zap', { cls: 'btn-icon', size: 14 }) || ''} ${esc(bulkLabel)}
      </button>
      <button class="ts2-btn ts2-btn-secondary ts2-btn-sm" id="ts2-diag-resolve-btn" type="button" title="Открыть preview перед сохранением (можно отменить отдельные строки).">
        ${Icons.get('search', { cls: 'btn-icon', size: 14 })} С preview…
      </button>
      <span class="ts2-diag-resolve-hint">
        Ищет каждого сотрудника в Bitbucket (Stash <code>/rest/api/1.0/users?filter=email</code>),
        Confluence DC (cascade: <code>cql user.fullname</code> → <code>user/search?username=email-prefix</code>)
        и Jenkins (<code>/asynchPeople</code> по точному ФИО → fallback <code>/user/&lt;email-prefix&gt;</code>).
        Concurrency 12 на сервере. Confluence DC может отвечать медленно — на 75 человек ожидайте ~60-90 сек.
      </span>
    </div>
    <div class="ts2-diag-resolve-results" id="ts2-diag-resolve-results"></div>
  ` : '';
  return _diagSection('identity', 'Identity coverage', `
    ${bar('email',          c.email)}
    ${bar('jiraAccountId',  c.jiraId)}
    ${bar('bitbucketLogin', c.bbLogin)}
    ${bar('confluenceId',   c.cfId)}
    ${c.jkName ? bar('jenkinsUserName', c.jkName) : ''}
    ${incompleteHtml}
    ${resolveUI}
  `, { statusPill: lowest + '% мин', statusKind: lowest >= 80 ? 'ok' : lowest >= 50 ? 'warn' : 'err', openByDefault: lowest < 80 });
}

/**
 * V20 S4 — Preview-modal для identity-resolve diff'а.
 * Показывает таблицу: ФИО / email / current → proposed для каждого
 * resolved сотрудника. Highlight changed rows. Save / Cancel.
 *
 * @param {object[]} diff — массив { empKey, fio, email, before:{bb,cf}, after:{bb,cf}, status }
 * @param {object} summary — { total, bbResolved, cfResolved, noEmail }
 */
export function renderIdentityResolvePreview(diff, summary) {
  const changed = diff.filter(d => d.status === 'change');
  const unchanged = diff.filter(d => d.status === 'unchanged');
  const failed = diff.filter(d => d.status === 'failed');
  const noEmail = diff.filter(d => d.status === 'no-email');
  // 2026-05-11 — ambiguous-cf: тёзки в Confluence (несколько user'ов с одинаковым
  // ФИО). Раньше попадали в `failed` без возможности выбора. Теперь — отдельная
  // секция с dropdown per-row для ручного picking.
  const ambigCf = diff.filter(d => d.status === 'ambiguous-cf');

  const row = (d) => {
    const bbChanged = d.before.bb !== d.after.bb;
    const cfChanged = d.before.cf !== d.after.cf;
    return `
      <tr class="ts2-resolve-row ts2-resolve-row-${d.status}">
        <td class="ts2-resolve-fio">${esc(d.fio || '')}</td>
        <td class="ts2-resolve-email">${esc(d.email || '—')}</td>
        <td class="${bbChanged ? 'ts2-resolve-cell-changed' : ''}">
          ${d.before.bb ? `<s class="ts2-resolve-old">${esc(d.before.bb)}</s>` : '<span class="ts2-resolve-empty">—</span>'}
          ${bbChanged ? '→' : ''}
          ${d.after.bb ? `<b class="ts2-resolve-new">${esc(d.after.bb)}</b>` : (bbChanged ? '<span class="ts2-resolve-empty">не найден</span>' : '')}
        </td>
        <td class="${cfChanged ? 'ts2-resolve-cell-changed' : ''}">
          ${d.before.cf ? `<s class="ts2-resolve-old">${esc(d.before.cf)}</s>` : '<span class="ts2-resolve-empty">—</span>'}
          ${cfChanged ? '→' : ''}
          ${d.after.cf ? `<b class="ts2-resolve-new">${esc(d.after.cf)}</b>` : (cfChanged ? '<span class="ts2-resolve-empty">не найден</span>' : '')}
        </td>
      </tr>
    `;
  };

  return `
    <div class="ts2-resolve-modal-overlay" id="ts2-resolve-modal" role="presentation">
      <div class="ts2-resolve-modal" role="dialog" aria-modal="true" aria-labelledby="ts2-resolve-title">
        <div class="ts2-resolve-header">
          <h3 class="ts2-resolve-title" id="ts2-resolve-title">${Icons.get('search', { cls: 'btn-icon', size: 14 })} Identity Auto-Resolve — preview</h3>
          <button class="ts2-resolve-close" type="button" data-close-modal aria-label="Закрыть">${Icons.get('x', { size: 14 })}</button>
        </div>
        <div class="ts2-resolve-summary">
          <span class="ts2-resolve-stat ts2-resolve-stat-ok">${Icons.get('check', { cls: 'btn-icon', size: 12 })} <b>${changed.length}</b> изменений</span>
          <span class="ts2-resolve-stat">≡ ${unchanged.length} без изменений</span>
          <span class="ts2-resolve-stat ${failed.length > changed.length ? 'ts2-resolve-stat-err' : 'ts2-resolve-stat-warn'}">${Icons.get('x', { cls: 'btn-icon', size: 12 })} <b>${failed.length}</b> не найдено</span>
          ${noEmail.length ? `<span class="ts2-resolve-stat ts2-resolve-stat-muted">⊘ ${noEmail.length} без email</span>` : ''}
          <span class="ts2-resolve-stat-meta">BB: ${summary.bbResolved}/${summary.total} · CF: ${summary.cfResolved}/${summary.total}</span>
        </div>
        ${failed.length > changed.length ? `<div class="ts2-resolve-warn-banner">
          ${Icons.get('alert-triangle', { cls: 'btn-icon', size: 14 })} Найдено меньше чем не найдено (${changed.length} vs ${failed.length}).
          Возможные причины: неправильный фокус ФИО (см. раздел «не найдено» ниже),
          CF не индексирует email/fullname, или нет прав у токена.
        </div>` : ''}
        ${ambigCf.length ? `<div class="ts2-resolve-ambig-banner">
          ${Icons.get('alert-triangle', { cls: 'btn-icon', size: 14 })} <b>${ambigCf.length}</b> тёзок в Confluence — выберите правильного человека из выпадающего списка ниже, остальные сохранят пустое поле.
        </div>` : ''}
        <div class="ts2-resolve-body">
          ${ambigCf.length ? `
            <table class="ts2-resolve-table ts2-resolve-ambig-table">
              <thead><tr>
                <th>ФИО</th><th>email</th><th>Кандидаты в Confluence (выберите)</th>
              </tr></thead>
              <tbody>${ambigCf.map(d => `
                <tr class="ts2-resolve-row ts2-resolve-row-ambig" data-empkey="${esc(String(d.empKey))}">
                  <td class="ts2-resolve-fio">${esc(d.fio || '')}</td>
                  <td class="ts2-resolve-email">${esc(d.email || '—')}</td>
                  <td>
                    <select class="ts2-resolve-ambig-select" data-empkey="${esc(String(d.empKey))}">
                      <option value="">— не выбран (пропустить) —</option>
                      ${(d.cfAmbiguousCandidates || []).map(c => `
                        <option value="${esc(c.username || '')}">${esc(c.displayName || c.username || '')} <span class="ts2-resolve-ambig-userid">(${esc(c.username || '')})</span></option>
                      `).join('')}
                    </select>
                  </td>
                </tr>
              `).join('')}</tbody>
            </table>
          ` : ''}
          ${changed.length ? `
            <table class="ts2-resolve-table">
              <thead><tr>
                <th>ФИО</th><th>email</th><th>bitbucketLogin</th><th>confluenceAccountId</th>
              </tr></thead>
              <tbody>${changed.map(row).join('')}</tbody>
            </table>
          ` : `<div class="ts2-diag-empty">Нет изменений — всё уже сматчено.</div>`}
          ${failed.length ? `
            <details class="ts2-resolve-details" ${failed.length > changed.length ? 'open' : ''}>
              <summary>Не найдено в API (${failed.length}) — раскрыть</summary>
              <ul class="ts2-resolve-failed-list">
                ${failed.slice(0, 30).map(d => `<li><b>${esc(d.fio || d.empKey)}</b> · ${esc(d.email)} — bb: ${esc(d.bbError || '?')} / cf: ${esc(d.cfError || '?')}</li>`).join('')}
              </ul>
            </details>
          ` : ''}
        </div>
        <div class="ts2-resolve-actions">
          <button class="ts2-btn ts2-btn-ghost" type="button" data-close-modal>Отмена</button>
          <button class="ts2-btn ts2-btn-primary" type="button" id="ts2-resolve-save"${(changed.length || ambigCf.length) ? '' : ' disabled'}>
            ${Icons.get('check', { cls: 'btn-icon', size: 12 })} Сохранить (${changed.length} авто${ambigCf.length ? ` + до ${ambigCf.length} тёзок` : ''})
          </button>
        </div>
      </div>
    </div>
  `;
}

function _diagSectionBbCfAttribution(attr) {
  if (!attr) return '';
  const { total, bbMatched, cfMatched, mismatchCount, unmatchedRegistryCount, rows } = attr;
  if (!total) return '';

  const pct = (n) => total ? Math.round((n / total) * 100) : 0;
  // F9 + QV2: i18n для source-badge — все лейблы на русском (brandbook §12).
  const SOURCE_LABELS = {
    'repo':       'из репо',
    'devStatus':  'devStatus Jira',
    'merged':     'merged-PR',
    'repo-fio':   'fio из репо',
    'merged-fio': 'fio merged',
    'fuzzy':      'нечёткое',
  };
  const sourceBadge = (src) => {
    if (!src) return `<span class="ts2-diag-attr-src ts2-diag-attr-src-none">—</span>`;
    const label = SOURCE_LABELS[src] || src;
    const cls   = (src === 'repo' || src === 'devStatus') ? 'ok' : 'warn';
    return `<span class="ts2-diag-attr-src ts2-diag-attr-src-${cls}">${esc(label)}</span>`;
  };

  // Top-level summary chips.
  const summary = `
    <div class="ts2-diag-attr-summary">
      <span class="ts2-diag-attr-chip">BB matched: <b>${bbMatched}</b>/${total} (${pct(bbMatched)}%)</span>
      <span class="ts2-diag-attr-chip">CF matched: <b>${cfMatched}</b>/${total} (${pct(cfMatched)}%)</span>
      ${mismatchCount > 0 ? `<span class="ts2-diag-attr-chip ts2-diag-attr-chip-warn">Рассинхрон badge/items: <b>${mismatchCount}</b></span>` : ''}
      ${unmatchedRegistryCount > 0 ? `<span class="ts2-diag-attr-chip ts2-diag-attr-chip-warn">Не в реестре: <b>${unmatchedRegistryCount}</b></span>` : ''}
    </div>`;

  // Per-row table — sorted: mismatches first, then no-match, then matched.
  const sorted = [...rows].sort((a, b) => {
    const scoreA = (a.bbBadgeItemsMismatch ? 2 : 0) + (!a.inRegistry ? 1 : 0);
    const scoreB = (b.bbBadgeItemsMismatch ? 2 : 0) + (!b.inRegistry ? 1 : 0);
    return scoreB - scoreA;
  });

  const tableRows = sorted.map(r => {
    const reg    = r.inRegistry    ? '✓' : `<span class="ts2-diag-attr-warn">✗</span>`;
    const bbL    = r.hasBbLogin    ? '✓' : `<span class="ts2-diag-attr-warn">✗</span>`;
    const cfI    = r.hasCfId       ? '✓' : `<span class="ts2-diag-attr-warn">✗</span>`;
    // QV1: было ⚠ эмодзи (нарушение brandbook §12) → SVG icon.
    const mismatch = r.bbBadgeItemsMismatch
      ? `<span class="ts2-diag-attr-warn" title="badges.commits48h=${r.bbCommits48h} но bbItems пусто — likely sprint-filter или attribution remap">${Icons.get('alert-triangle', { cls: 'btn-icon', size: 12 })}</span>`
      : '';
    return `<tr>
      <td class="ts2-diag-attr-hash" title="anonymised key">${esc(r.keyHash)}</td>
      <td>${reg}</td>
      <td>${bbL}</td>
      <td>${cfI}</td>
      <td>${sourceBadge(r.bbSource)}</td>
      <td class="ts2-diag-attr-num">${r.bbCommits48h}</td>
      <td class="ts2-diag-attr-num">${r.bbItemsCount}${mismatch}</td>
      <td class="ts2-diag-attr-num">${r.cfEdits48h}</td>
    </tr>`;
  }).join('');

  return `
    <details class="ts2-diag-section" open>
      <summary class="ts2-diag-section-head">BB/CF атрибуция — per employee</summary>
      <div class="ts2-diag-section-body">
        ${summary}
        <table class="ts2-diag-attr-table">
          <thead>
            <tr>
              <th title="анонимный хеш ключа участника">key#</th>
              <th title="в реестре сотрудников">Реестр</th>
              <th title="есть bitbucketLogin">BB-login</th>
              <th title="есть confluenceAccountId">CF-id</th>
              <th title="источник BB-матча">BB src</th>
              <th title="коммиты 48ч (badge)">c48h</th>
              <th title="bbItems (enriched)">items</th>
              <th title="CF edits 48ч">cf48h</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        <div class="ts2-diag-attr-hint">
          key# — хеш ключа участника (анонимизирован). Иконка предупреждения = рассинхрон badge vs items (items пусто, но badge &gt; 0 — может быть sprint-filter).
        </div>
      </div>
    </details>`;
}

function _diagSectionThresholds(t) {
  const d = t.defaultDwell || {};
  const perTeamCount = t.perTeam ? Object.keys(t.perTeam).length : 0;
  // V20 S3.2 — sensitivity preview: 4 input'а + кнопка «пересчитать».
  // Реакция в _bindDiagModalEvents: пересчитываем simulateThresholds()
  // и обновляем span'ы results без перерендера всей модалки.
  const sensitivityUI = `
    <div class="ts2-diag-subhead">«Что если…» — sensitivity preview</div>
    <div class="ts2-diag-sens-controls">
      <label class="ts2-diag-sens-input">Code Review (ч)<input type="number" min="1" max="200" value="${d.codeReview}" data-sens-field="codeReview"></label>
      <label class="ts2-diag-sens-input">QA (ч)<input type="number" min="1" max="200" value="${d.qa}" data-sens-field="qa"></label>
      <label class="ts2-diag-sens-input">In Progress (ч)<input type="number" min="1" max="500" value="${d.inProgress}" data-sens-field="inProgress"></label>
      <label class="ts2-diag-sens-input">To Do (ч)<input type="number" min="1" max="500" value="${d.todo}" data-sens-field="todo"></label>
    </div>
    <div class="ts2-diag-sens-controls">
      <button class="ts2-btn ts2-btn-ghost ts2-btn-sm" id="ts2-diag-sens-run" type="button">${Icons.get('play', { cls: 'btn-icon', size: 12 })} Пересчитать blockers</button>
      <span class="ts2-diag-sens-hint">Не сохраняет — только preview эффекта на counts.</span>
    </div>
    <div class="ts2-diag-sens-results" id="ts2-diag-sens-results"></div>
  `;
  return _diagSection('thresholds', 'Пороги (dwell-time)', `
    <div class="ts2-diag-subhead">Default (часы)</div>
    ${_kv('Code Review',  d.codeReview)}
    ${_kv('QA / Testing', d.qa)}
    ${_kv('In Progress',  d.inProgress)}
    ${_kv('To Do / Open', d.todo)}
    ${_kv('Прочие',       d.default)}
    ${perTeamCount ? `<div class="ts2-diag-subhead">Per-team overrides (${perTeamCount})</div>
      <pre class="ts2-diag-pre">${esc(JSON.stringify(t.perTeam, null, 2))}</pre>` : `<div class="ts2-diag-empty">Нет per-team override'ов — используются default.</div>`}
    ${sensitivityUI}
  `, { statusPill: perTeamCount ? `${perTeamCount} команд override` : 'default', statusKind: 'neutral' });
}

/** V20 S3.2 — render результатов sensitivity preview. */
export function renderSensitivityResults(sim, currentCounts) {
  if (!sim) return '<div class="ts2-diag-empty">Нет результатов.</div>';
  const c = sim.counts || {};
  const cur = currentCounts || {};
  const delta = (a, b) => Number.isFinite(a - b) ? (a - b) : 0;
  const fmt = (d) => d > 0 ? `+${d}` : (d < 0 ? `${d}` : '0');
  const cellClass = (d) => d > 0 ? 'ts2-diag-sens-up' : d < 0 ? 'ts2-diag-sens-down' : 'ts2-diag-sens-flat';
  // V20 S6.2.6 — показ warning'а если часть participants ушли в fallback.
  const coverageWarning = sim.coverageInfo
    ? `<div class="ts2-diag-callout">${esc(sim.coverageInfo)}. Гипотетические пороги к ним не применяются — данные показывают default-классификацию.</div>`
    : '';
  return `
    ${coverageWarning}
    <div class="ts2-diag-sens-summary">
      Blockers всего: <b>${sim.blockersTotal}</b>
    </div>
    <table class="ts2-diag-table">
      <thead><tr><th>Группа</th><th>Сейчас</th><th>Симуляция</th><th>Δ</th></tr></thead>
      <tbody>
        ${['stop', 'watch', 'moving', 'idle'].map(k => {
          const d = delta(c[k] || 0, cur[k] || 0);
          return `<tr>
            <td>${esc({ stop: 'Стоп', watch: 'Watch', moving: 'Движется', idle: 'Без активности' }[k])}</td>
            <td>${cur[k] ?? '—'}</td>
            <td><b>${c[k] ?? '—'}</b></td>
            <td class="${cellClass(d)}">${fmt(d)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

function _diagSectionSnapshot(s) {
  const c = s.current?.counts || {};
  const p = s.prev?.counts || {};
  const delta = (a, b) => Number.isFinite(a) && Number.isFinite(b) ? (a - b) : null;
  const fmt = (d) => d == null ? '—' : (d > 0 ? `+${d}` : `${d}`);
  const ageH = s.prev?.ageHours;
  const histStat = s.history?.entries
    ? `${s.history.entries} snap. (${s.history.earliest || '?'} → ${s.history.latest || '?'})`
    : 'нет истории';
  // V20 S7 A6 — EMA / WoW / anomaly блок если есть trends.
  // V21 trends-guard — если ema.insufficientHistory (история < 8 точек),
  // показываем «—» вместо ложного wowDelta + единый бэннер «набирается история».
  const t = s.trends || {};
  const insufficientHistory = !!(t.stopEma?.insufficientHistory || t.movingEma?.insufficientHistory || t.progressEma?.insufficientHistory);
  const pointsAvailable = t.stopEma?.pointsAvailable ?? t.movingEma?.pointsAvailable ?? t.progressEma?.pointsAvailable ?? 0;
  const trendCell = (label, ema, anom) => {
    // 2026-05-11 — `insufficientHistory` flag (вместо null-проверки): когда
    // history < 8 snapshot'ов, computeEmaWoW возвращает 0-значения, но
    // эти цифры не отражают реальный тренд → показываем «—». Раньше
    // полагались на null, но это конфликтовало с тестами / downstream.
    const insufficient = !!ema?.insufficientHistory;
    const wowSign = ema?.wowDelta > 0 ? '+' : '';
    const wowClass = insufficient
      ? 'ts2-diag-sens-flat'
      : (ema?.wowDelta > 0 ? 'ts2-diag-sens-up' : (ema?.wowDelta < 0 ? 'ts2-diag-sens-down' : 'ts2-diag-sens-flat'));
    const anomChip = anom?.anomalous ? `<span class="ts2-diag-flag">${Icons.get('alert-triangle', { cls: 'btn-icon', size: 12 })} z=${anom.z > 0 ? '+' : ''}${anom.z}</span>` : '';
    return `<tr>
      <td>${esc(label)}</td>
      <td>${ema?.emaToday ?? '—'}</td>
      <td>${insufficient ? '—' : (ema?.emaLastWeek ?? '—')}</td>
      <td class="${wowClass}">${insufficient ? '—' : (ema?.wowDelta != null ? wowSign + ema.wowDelta : '—')}</td>
      <td>${anomChip}</td>
    </tr>`;
  };
  const insufficientBanner = insufficientHistory
    ? `<div class="ts2-diag-empty"><i>Набирается история — нужно ≥8 ежедневных snapshot'ов, сейчас ${pointsAvailable}. WoW Δ и anomaly Z-score появятся ${Math.max(0, 8 - pointsAvailable)} дней спустя.</i></div>`
    : '';
  const trendsBlock = (Object.keys(t).length) ? `
    <div class="ts2-diag-subhead">EMA + Week-over-Week (α=0.3, ≥8 точек)</div>
    ${insufficientBanner}
    <table class="ts2-diag-table">
      <thead><tr><th>Метрика</th><th>EMA today</th><th>EMA 7d ago</th><th>WoW Δ</th><th>Anomaly</th></tr></thead>
      <tbody>
        ${trendCell('Стоп',        t.stopEma,    t.stopAnomaly)}
        ${trendCell('Движется',    t.movingEma,  t.movingAnomaly)}
        ${trendCell('Sprint progress', t.progressEma, null)}
      </tbody>
    </table>
  ` : '';
  return _diagSection('snapshot', 'Snapshot delta vs вчера', `
    ${ageH != null ? `<div class="ts2-diag-subhead">Прошлый snapshot: ${ageH} ч назад</div>` : `<div class="ts2-diag-empty">Прошлый snapshot не найден или старше 24 ч.</div>`}
    <table class="ts2-diag-table">
      <thead><tr><th>Группа</th><th>Сейчас</th><th>Раньше</th><th>Δ</th></tr></thead>
      <tbody>
        <tr><td>Стоп</td><td>${c.stop ?? '—'}</td><td>${p.stop ?? '—'}</td><td>${fmt(delta(c.stop, p.stop))}</td></tr>
        <tr><td>Watch</td><td>${c.watch ?? '—'}</td><td>${p.watch ?? '—'}</td><td>${fmt(delta(c.watch, p.watch))}</td></tr>
        <tr><td>Движется</td><td>${c.moving ?? '—'}</td><td>${p.moving ?? '—'}</td><td>${fmt(delta(c.moving, p.moving))}</td></tr>
        <tr><td>Без активности</td><td>${c.idle ?? '—'}</td><td>${p.idle ?? '—'}</td><td>${fmt(delta(c.idle, p.idle))}</td></tr>
      </tbody>
    </table>
    <div class="ts2-diag-subhead">Multi-day история</div>
    <div class="ts2-diag-kv-row">${esc(histStat)}</div>
    ${trendsBlock}
  `);
}

function _diagSectionModelSummary(ms) {
  if (!ms) {
    return _diagSection('model', 'Model summary',
      `<div class="ts2-diag-empty">Нет model'и — fetch не запускался.</div>`);
  }
  return _diagSection('model', 'Model summary', `
    ${_kv('participants', ms.participantsCount)}
    ${_kv('активных спринтов', ms.activeSprintsCount)}
    ${_kv('spaces в model', ms.spaceKeys.join(', ') || '—')}
    <div class="ts2-diag-subhead">Risks</div>
    ${_kv('orphans (всего)',  ms.risks.totalOrphans)}
    ${_kv('orphans (real)',   ms.risks.totalRealOrphans, 'in-sprint OR fresh+high-priority')}
    ${_kv('out-of-sprint',    ms.risks.totalOutOfSprint)}
    ${_kv('outOfSprintRatio', (ms.risks.outOfSprintRatio * 100).toFixed(1) + '%', 'unique-keys basis')}
    <div class="ts2-diag-subhead">Sprint Goal (агрегат)</div>
    ${_kv('progress',         ms.sprintGoal.aggregateProgress + '%')}
    ${_kv('sprint-mean',      (ms.sprintGoal.sprintMeanProgress ?? 0) + '%')}
    ${_kv('pace',             ms.sprintGoal.aggregatePace, ms.sprintGoal.aggregatePaceSource || '')}
    ${_kv('спринтов',         ms.sprintGoal.sprintsCount)}
  `);
}

/**
 * V20 S8 #12 — Known Issues section. Whitelist типичных проблем пилота +
 * подсветка «ваш случай» если condition сматчился. UX feedback: «нужен
 * actionable next-step «CF=0% это normal in Sber DC»».
 */
function _diagSectionKnownIssues(state) {
  const i = state.identity || {};
  const c = state.config || {};
  const conn = state.connection || {};
  const tz = state.tzSkew || {};
  const issues = [];

  // 1) CF coverage 0% — известная проблема Sber DC.
  if ((i.coverage?.cfId?.pct || 0) === 0 && (i.teamSize || 0) > 0) {
    issues.push({
      severity: 'normal',
      title: 'Confluence coverage 0% — известная проблема Sber DC',
      body: `Sber Confluence DC использует numeric LDAP usernames (не email-prefix). API <code>cql=user.email = "..."</code> не индексируется в DC. После V20 S5 cascade пробует <code>cql=user.fullname = "ФИО"</code> — но ФИО должно быть точно как в CF.<br>
            <b>Что делать:</b> 1) Проверьте что <code>fio</code> у сотрудников совпадает с CF профилем символ-в-символ (включая суффиксы [B] / [external]). 2) Если не помогает — заполнить <code>confluenceAccountId</code> вручную (это numeric LDAP-ID, видно в URL CF при наведении на автора).`,
    });
  }

  // 2) BB coverage низкий.
  if ((i.coverage?.bbLogin?.pct || 100) < 30 && c.hasBitbucketToken) {
    issues.push({
      severity: 'warn',
      title: `BB coverage ${i.coverage?.bbLogin?.pct || 0}% — низко`,
      body: `<b>Что делать:</b> Откройте Identity Auto-Resolve (кнопка ниже в этой секции). Sber Stash возвращает slug по email-фильтру — должен сматчить большинство.`,
    });
  }

  // 3) sinceDate слишком широкий.
  const sinceMs = c.sinceDate ? Date.parse(c.sinceDate) : NaN;
  if (Number.isFinite(sinceMs) && (Date.now() - sinceMs) > 365 * 86400 * 1000) {
    issues.push({
      severity: 'warn',
      title: 'sinceDate шире 1 года → высокая latency + много orphan-issues',
      // V20 S8.5 #1 — XSS guard: sinceDate приходит из user-config (settings UI),
      // нельзя интерполировать в HTML без esc(). Тот же класс что мы фиксили в S6/probe.
      body: `Текущий <code>sinceDate=${esc(c.sinceDate)}</code>. Это влияет на: 1) <code>totalOrphans</code> (пилот 2513 — backlog с 2025); 2) Jira fetch latency (видим 50+ сек). <b>Рекомендация:</b> поднять до текущего квартала (например <code>2026-01-01</code>).`,
    });
  }

  // 4) TZ skew suspicious.
  if (tz?.skewSuspicious) {
    issues.push({
      severity: 'warn',
      title: `TZ skew ${esc(String(tz.skewSeconds))}с — часы расходятся`,
      body: `Browser=${esc(tz.browserTzLabel || '')}, server timestamp ${esc(tz.serverTs || '')}. Если skew > 5 мин и vы не на VPN — проверьте system clock (ntp).`,
    });
  }

  // 5) jobId expired (drill-down не работает).
  if (conn?.jobExpired) {
    issues.push({
      severity: 'err',
      title: 'jobId истёк — нажмите кнопку «Обновить»',
      body: 'Server pulse-job TTL = 120 мин. После истечения drill-down по сотрудникам не работает — нужен новый fetch.',
    });
  }

  // 6) Нет projectKeys — empty config.
  if (!c.projectKeys?.length) {
    issues.push({
      severity: 'err',
      title: 'projectKeys пустой',
      body: 'Заполните <code>jiraProjectKeys</code> в настройках Jira. Без них fetch не запустится.',
    });
  }

  if (!issues.length) {
    return _diagSection('known-issues', 'Известные проблемы',
      `<div class="ts2-diag-ok">Всё чисто — известных проблем не обнаружено.</div>`,
      { statusPill: 'OK', statusKind: 'ok' });
  }

  const errCount = issues.filter(i => i.severity === 'err').length;
  const warnCount = issues.filter(i => i.severity === 'warn').length;
  const body = issues.map(iss => `
    <div class="ts2-diag-callout ts2-diag-known-${iss.severity}">
      <div class="ts2-diag-known-title"><span class="signal-dot signal-${iss.severity === 'err' ? 'off-course' : iss.severity === 'warn' ? 'drift' : 'information'}" aria-hidden="true"></span> ${esc(iss.title)}</div>
      <div class="ts2-diag-known-body">${iss.body}</div>
    </div>
  `).join('');
  return _diagSection('known-issues', 'Известные проблемы (auto-detect)', body, {
    statusPill: errCount ? `${errCount} крит.` : (warnCount ? `${warnCount} предупр.` : 'info'),
    statusKind: errCount ? 'err' : (warnCount ? 'warn' : 'neutral'),
    openByDefault: errCount > 0 || warnCount >= 2,
  });
}

/** V20 S7 B10 — botsFilteredOut section. Тимлид может видеть кого мы исключили
 *  и оспорить ложные срабатывания. */
function _diagSectionBots(bots) {
  const count = (bots || []).length;
  if (!count) {
    return _diagSection('bots', 'Service-аккаунты (исключены из counts)',
      `<div class="ts2-diag-empty">Не найдено сервисных аккаунтов.</div>`,
      { statusPill: '0', statusKind: 'neutral' });
  }
  const groupedBySource = {};
  for (const b of bots) {
    const src = b.source || 'pattern';
    if (!groupedBySource[src]) groupedBySource[src] = [];
    groupedBySource[src].push(b);
  }
  const rows = Object.entries(groupedBySource).map(([src, list]) => `
    <div class="ts2-diag-subhead">Источник: ${esc(src)} (${list.length})</div>
    <ul class="ts2-diag-incomplete-list">
      ${list.slice(0, 30).map(b => `<li><code>${esc(b.key)}</code> — ${esc(b.label || '?')}</li>`).join('')}
    </ul>
  `).join('');
  return _diagSection('bots', 'Service-аккаунты (исключены из counts)', `
    <div class="ts2-diag-callout">
      Pattern auto-detect: cab-sa-*, sbt-*, out-*, svc-*, bot-*, system-*, и infix -api-/-bot-/-svc-.
      Если кто-то попал сюда ошибочно — снимите флаг <code>isServiceAccount</code> в карточке сотрудника.
    </div>
    ${rows}
  `, { statusPill: `${count} excl.`, statusKind: 'neutral' });
}

/**
 * V20 S8 #2 — CR-drill-down modal: список самых долгих ревью per reviewer.
 * Pилот feedback: «6ч медиана для отчёта директору. Мне нужны имена и PR».
 *
 * Сейчас у нас данные по reviewer'ам (codeReviewVelocity), но без per-PR
 * details. Показываем top-15 reviewer'ов с медианой > 8h, sorted by median desc.
 * При наличии prT.openItems — добавим конкретные PR (S9 ext).
 */
export function renderCrvDrilldownModal(crv, employees) {
  const empByKey = new Map((employees || []).map(e => [String(e.jiraAccountId || '').toLowerCase(), e]));
  const rows = Object.entries(crv || {})
    .map(([k, v]) => ({
      key: k,
      median: v.medianHours,
      count: v.count,
      threshold: v.threshold,
      label: empByKey.get(String(k).toLowerCase())?.fio || k,
    }))
    .sort((a, b) => b.median - a.median)
    .slice(0, 15);

  if (!rows.length) {
    return `
      <div class="ts2-crv-modal-overlay" id="ts2-crv-drilldown" role="presentation">
        <div class="ts2-crv-modal" role="dialog" aria-modal="true">
          <div class="ts2-resolve-header">
            <h3 class="ts2-resolve-title">Скорость код-ревью</h3>
            <button class="ts2-resolve-close" type="button" data-close-modal>${Icons.get('x', { size: 14 })}</button>
          </div>
          <div class="ts2-resolve-body"><div class="ts2-diag-empty">Нет данных за последние 14 дней.</div></div>
        </div>
      </div>`;
  }
  const slowCount = rows.filter(r => r.threshold === 'slow').length;
  const warnCount = rows.filter(r => r.threshold === 'warn').length;
  return `
    <div class="ts2-crv-modal-overlay" id="ts2-crv-drilldown" role="presentation">
      <div class="ts2-crv-modal" role="dialog" aria-modal="true" aria-labelledby="ts2-crv-title">
        <div class="ts2-resolve-header">
          <h3 class="ts2-resolve-title" id="ts2-crv-title">Скорость код-ревью — топ-15</h3>
          <button class="ts2-resolve-close" type="button" data-close-modal>${Icons.get('x', { size: 14 })}</button>
        </div>
        <div class="ts2-resolve-summary">
          <span class="ts2-resolve-stat ts2-resolve-stat-warn">${Icons.get('alert-triangle', { cls: 'btn-icon', size: 12 })} ${slowCount} медленных (>24ч)</span>
          <span class="ts2-resolve-stat">${warnCount} средних (8-24ч)</span>
          <span class="ts2-resolve-stat-meta">14 дней · sorted by median desc</span>
        </div>
        <div class="ts2-resolve-body">
          <table class="ts2-resolve-table">
            <thead><tr><th>Ревьюер</th><th>Медиана</th><th>Ревью</th><th>Статус</th></tr></thead>
            <tbody>
              ${rows.map(r => `
                <tr class="ts2-resolve-row ts2-resolve-row-${r.threshold === 'slow' ? 'failed' : 'change'}">
                  <td class="ts2-resolve-fio">${esc(r.label)}</td>
                  <td><b>${r.median}ч</b></td>
                  <td>${r.count}</td>
                  <td><span class="signal-dot signal-${r.threshold === 'slow' ? 'off-course' : r.threshold === 'warn' ? 'drift' : 'on-course'}" aria-hidden="true"></span> ${r.threshold === 'slow' ? 'медленно' : r.threshold === 'warn' ? 'средне' : 'ок'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="ts2-how-footnote">
            Threshold: &lt;8ч ok / 8-24ч warn / &gt;24ч slow.<br>
            Подробности по конкретным PR — в карточке сотрудника (клик по строке в дашборде).
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * V20 S8.5 #20 — Anomaly mini-chart modal. Показывает sparkline за 14 дней
 * с baseline (μ ± σ) и подсветкой today как outlier.
 *
 * @param {Array<{ts, value}>} series — daily values
 * @param {object} z — z-score результат (mean, std, today, z)
 * @param {string} metricLabel — «stop», «watch», etc.
 */
export function renderAnomalyMiniChart(series, z, metricLabel) {
  if (!Array.isArray(series) || series.length < 2) {
    return `<div class="ts2-anomaly-modal-overlay" id="ts2-anomaly-modal" role="presentation">
      <div class="ts2-anomaly-modal" role="dialog" aria-modal="true">
        <div class="ts2-resolve-header">
          <h3 class="ts2-resolve-title">Аномалия в группе «${esc(metricLabel)}»</h3>
          <button class="ts2-resolve-close" type="button" data-close-modal>${Icons.get('x', { size: 14 })}</button>
        </div>
        <div class="ts2-resolve-body"><div class="ts2-diag-empty">Недостаточно истории для графика (нужно ≥2 точек).</div></div>
      </div>
    </div>`;
  }
  // Inline SVG sparkline: 360×80px, 14 days max.
  const W = 360, H = 80, P = 8;
  const vals = series.slice(-14);
  const minV = Math.min(...vals, z.mean - z.std);
  const maxV = Math.max(...vals, z.mean + z.std);
  const range = Math.max(1, maxV - minV);
  const xStep = (W - 2 * P) / Math.max(1, vals.length - 1);
  const yScale = (v) => H - P - ((v - minV) / range) * (H - 2 * P);
  const points = vals.map((v, i) => `${P + i * xStep},${yScale(v)}`).join(' ');
  const meanY  = yScale(z.mean);
  const upperY = yScale(z.mean + z.std);
  const lowerY = yScale(z.mean - z.std);
  const todayX = P + (vals.length - 1) * xStep;
  const todayY = yScale(z.today);

  return `<div class="ts2-anomaly-modal-overlay" id="ts2-anomaly-modal" role="presentation">
    <div class="ts2-anomaly-modal" role="dialog" aria-modal="true" aria-labelledby="ts2-anomaly-title">
      <div class="ts2-resolve-header">
        <h3 class="ts2-resolve-title" id="ts2-anomaly-title">Аномалия в группе «${esc(metricLabel)}»</h3>
        <button class="ts2-resolve-close" type="button" data-close-modal>${Icons.get('x', { size: 14 })}</button>
      </div>
      <div class="ts2-resolve-body">
        <div class="ts2-anomaly-stats">
          <span><b>Сегодня:</b> ${z.today}</span>
          <span><b>Среднее за ${vals.length} дней:</b> ${z.mean} ± ${z.std}</span>
          <span class="ts2-anomaly-z"><b>Z-score:</b> ${z.z} ${z.anomalous ? `<span class="signal-dot signal-off-course" aria-hidden="true"></span> аномалия` : ''}</span>
        </div>
        <svg class="ts2-anomaly-chart" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" aria-label="Sparkline за 14 дней с baseline">
          <!-- baseline ±σ -->
          <rect x="${P}" y="${upperY}" width="${W - 2 * P}" height="${lowerY - upperY}" fill="rgba(100,100,100,0.07)"/>
          <line x1="${P}" y1="${meanY}" x2="${W - P}" y2="${meanY}" stroke="rgba(100,100,100,0.4)" stroke-dasharray="3,3"/>
          <!-- series polyline -->
          <polyline points="${points}" fill="none" stroke="var(--prizma-information, #2563eb)" stroke-width="2"/>
          <!-- today marker -->
          <circle cx="${todayX}" cy="${todayY}" r="5" fill="${z.anomalous ? 'var(--danger, #dc2626)' : 'var(--prizma-information, #2563eb)'}"/>
        </svg>
        <div class="ts2-anomaly-legend">
          Линия — daily values. Серая зона — μ ± σ (норма). Точка справа — сегодня.
          ${z.anomalous ? '<br><b>Сегодня выходит за σ-зону:</b> z=' + z.z + ', |z|>2 = аномалия.' : ''}
        </div>
      </div>
    </div>
  </div>`;
}

/**
 * PR-CC — Сравнение команд в модалке.
 * Wrapper вокруг renderVelocityComparison c overlay + header + close.
 * Открывается из kebab «Сравнение команд» — раньше блок жил inline в main view.
 */
/* 2026-05-11 — renderVelocityCompareModal перенесён обратно в main renderer
   (теперь использует Cross-team Benchmarks helper из этого файла). */
export { _renderCrossTeamBenchmarks };

/* 2026-05-11 — Cross-team Benchmarks: матрица команд × метрик.
   Метрики: velocity (sprint goal progress), health (composite),
   hygiene (jiraHygiene score), burnout (% off-hours).
   Best per column — badge «лидер». Worst — «слабее».
*/
function _renderCrossTeamBenchmarks(model, history = []) {
  if (!model || !model.teams || model.teams.length < 2) {
    return `<div class="ts2-benchmarks-empty">Нужно ≥ 2 команды для benchmark-сравнения. Сейчас доступно: ${model?.teams?.length || 0}.</div>`;
  }
  const rows = model.teams.map(team => {
    const teamModel = team.fullModel || { ...model, ...(team.subModel || {}) };
    let hygieneScore = null;
    try { hygieneScore = runHygieneRules(teamModel).score; } catch (_) {}
    return {
      pk: team.pk || team.name,
      name: team.name || team.pk,
      velocity: Math.round(team.aggregateProgress || team.sprintGoal?.aggregateProgress || 0),
      health: Math.round(team.healthScore || 0),
      hygiene: hygieneScore,
      burnout: Math.round((team.burnoutRatio || 0) * 100),
      // более-лучше для velocity/health/hygiene; меньше-лучше для burnout
    };
  });

  // Find best per column
  const best = {
    velocity: Math.max(...rows.map(r => r.velocity)),
    health:   Math.max(...rows.map(r => r.health)),
    hygiene:  Math.max(...rows.map(r => r.hygiene ?? 0)),
    burnout:  Math.min(...rows.map(r => r.burnout)),
  };
  const cellHtml = (val, isBest, label, isBurnout) => {
    if (val == null) return `<td class="ts2-bm-cell"><span class="ts2-bm-na">—</span></td>`;
    const cls = isBest ? 'ts2-bm-cell ts2-bm-cell-best' : 'ts2-bm-cell';
    return `<td class="${cls}" title="${esc(label)}">${val}${isBest ? ` <span class="ts2-bm-badge" title="Лидер по ${esc(label)}">★</span>` : ''}</td>`;
  };

  return `
    <div class="ts2-benchmarks-pane">
      <div class="ts2-benchmarks-howto">
        Матрица метрик по командам. ★ — лидер в колонке (best practice — посмотрите как они достигают).
        Velocity = sprint goal progress %. Health = composite (sprint/blockers/PR-flow/burnout). Hygiene = качество данных Jira (см. вкладку «Гигиена»).
        Burnout = % off-hours commits — меньше=лучше.
      </div>
      <table class="ts2-bm-table">
        <thead>
          <tr>
            <th>Команда</th>
            <th>Velocity %</th>
            <th>Health</th>
            <th>Hygiene</th>
            <th>Burnout %</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td class="ts2-bm-team">${esc(r.name)}</td>
              ${cellHtml(r.velocity, r.velocity === best.velocity, 'sprint goal progress')}
              ${cellHtml(r.health,   r.health === best.health,     'composite health score')}
              ${cellHtml(r.hygiene,  r.hygiene != null && r.hygiene === best.hygiene, 'Jira hygiene score')}
              ${cellHtml(r.burnout,  r.burnout === best.burnout,   'off-hours ratio (меньше лучше)', true)}
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="ts2-benchmarks-footnote">
        Примечание: agregated данные. Per-team детали → переключение команды в Сканнере.
      </div>
    </div>
  `;
}

export function renderHowCalculatedModal() {
  const sections = HOW_SECTIONS.map(s => `
    <div class="ts2-how-section" data-section="${esc(s.id)}">
      <button class="ts2-how-section-head" type="button" aria-expanded="false">
        <span class="ts2-how-section-chev" aria-hidden="true">▸</span>
        <span class="ts2-how-section-title">${esc(s.head)}</span>
      </button>
      <div class="ts2-how-section-body">${s.body}</div>
    </div>
  `).join('');
  return `
    <div class="ts2-how-modal-overlay" id="ts2-how-modal" role="presentation">
      <div class="ts2-how-modal" role="dialog" aria-modal="true" aria-labelledby="ts2-how-title">
        <div class="ts2-how-header">
          <h3 class="ts2-how-title" id="ts2-how-title">Как считаются метрики Сканнера команд</h3>
          <button class="ts2-how-close" type="button" data-close-modal aria-label="Закрыть">${Icons.get('x', { size: 14 })}</button>
        </div>
        <div class="ts2-how-body">
          <div class="ts2-how-intro">
            Раздел отвечает на вопрос «откуда взялась эта цифра / почему этот сотрудник в группе X».
            Кликните на заголовок секции чтобы развернуть.
          </div>
          ${sections}
          <div class="ts2-how-footnote">
            Видны странные значения? Откройте кнопку <b>«Диагностика»</b> (появится в одном из
            следующих обновлений) — там per-PK timing и per-source raw-данные.
          </div>
        </div>
      </div>
    </div>
  `;
}
