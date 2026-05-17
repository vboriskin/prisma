'use strict';
/* ============================================================
   integrations/hygiene/hygieneRenderer.js — V22+ (2026-05-17)

   Pure HTML string builder для подвкладки «Гигиена».
   Не side-effects'ный. Event-handling — в hygiene.js orchestrator через
   click-delegation.

   Public API:
     renderHygieneSubTab(model, hygieneState, opts?) → string
     applyTeamFilter(model, teamKey) → filteredModel
   ============================================================ */

import { runHygieneRules } from '../jiraHygiene.js';

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _pl(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

/**
 * Filter model by projectKey. Если '__all__' — возвращаем сам model.
 * Применяется к model.spaces[].issues — оставляем только spaces, чей
 * ключ совпадает с teamKey.
 */
export function applyTeamFilter(model, teamKey) {
  if (!model || teamKey === '__all__' || !teamKey) return model;
  const upperKey = String(teamKey).toUpperCase();
  const filteredSpaces = {};
  for (const [k, v] of Object.entries(model.spaces || {})) {
    if (String(k).toUpperCase() === upperKey) {
      filteredSpaces[k] = v;
    }
  }
  return {
    ...model,
    spaces: filteredSpaces,
    projectKeys: Array.isArray(model.projectKeys)
      ? model.projectKeys.filter(pk => String(pk).toUpperCase() === upperKey)
      : [],
  };
}

/* ─────────────────────────────────────────────────────────────
   Empty / loader states
   ───────────────────────────────────────────────────────────── */

export function renderHygieneEmpty(kind, opts = {}) {
  if (kind === 'loading') {
    return `<div class="hyg-state hyg-state-loading">
      <div class="hyg-loader-spinner" aria-hidden="true"></div>
      <div class="hyg-state-text">Загружаю данные из Сканнера…</div>
    </div>`;
  }
  if (kind === 'no-config') {
    return `<div class="hyg-state hyg-state-empty">
      <div class="hyg-state-title">Не настроена интеграция с Jira</div>
      <div class="hyg-state-text">Откройте <strong>Настройки → Интеграции → Jira</strong> и заполните <code>jiraProjectKeys</code> + токен.</div>
    </div>`;
  }
  // default: no-data
  return `<div class="hyg-state hyg-state-empty">
    <div class="hyg-state-title">Нужны данные Сканнера</div>
    <div class="hyg-state-text">Гигиена считается по выгрузке Сканнера команд. Нажмите кнопку — данные подгрузятся, и сюда вернётся score 0-100 + список нарушений по 20 правилам.</div>
    <button class="hyg-btn hyg-btn-primary" type="button" data-hyg-action="load-data">Загрузить данные</button>
  </div>`;
}

/* ─────────────────────────────────────────────────────────────
   Team switcher
   ───────────────────────────────────────────────────────────── */

function _renderTeamSwitcher(model, activeTeam) {
  const pks = (model?.projectKeys || []).slice().sort();
  if (!pks.length) return '';
  const tabs = pks.map(pk => {
    const active = activeTeam === pk;
    return `<button type="button"
      class="hyg-team-tab${active ? ' hyg-team-tab-active' : ''}"
      data-hyg-team="${escapeHtml(pk)}"
      aria-pressed="${active}">${escapeHtml(pk)}</button>`;
  }).join('');
  const allActive = activeTeam === '__all__' || !activeTeam;
  return `<div class="hyg-team-switcher" role="tablist" aria-label="Команда">
    <button type="button"
      class="hyg-team-tab hyg-team-tab-all${allActive ? ' hyg-team-tab-active' : ''}"
      data-hyg-team="__all__"
      aria-pressed="${allActive}">Все команды</button>
    <span class="hyg-team-sep">·</span>
    ${tabs}
  </div>`;
}

/* ─────────────────────────────────────────────────────────────
   Score block
   ───────────────────────────────────────────────────────────── */

function _renderScoreBlock(score, violationsCount, rulesCount) {
  const tier = score >= 90 ? 'good' : score >= 70 ? 'mid' : score >= 50 ? 'warn' : 'bad';
  const tierLabel = score >= 90 ? 'отлично'
                  : score >= 70 ? 'норма'
                  : score >= 50 ? 'требует внимания'
                                : 'требует разговора';
  return `<div class="hyg-score hyg-score-${tier}">
    <div class="hyg-score-num">${score}</div>
    <div class="hyg-score-side">
      <div class="hyg-score-lab">/ 100 — ${tierLabel}</div>
      <div class="hyg-score-sub">${violationsCount} ${_pl(violationsCount, ['нарушение', 'нарушения', 'нарушений'])} в ${rulesCount} ${_pl(rulesCount, ['правиле', 'правилах', 'правилах'])}</div>
    </div>
  </div>`;
}

/* ─────────────────────────────────────────────────────────────
   Violations list (with rule-toggle)
   ───────────────────────────────────────────────────────────── */

function _renderViolations(violations, opts) {
  const jiraBase = opts.jiraBaseUrl
    ? String(opts.jiraBaseUrl).replace(/\/+$/, '')
    : '';

  return violations
    .sort((a, b) => (b.weight * b.count) - (a.weight * a.count))
    .map(v => {
      const issueRows = v.items.map(it => {
        const keyLink = jiraBase
          ? `<a class="hyg-issue-key" href="${escapeHtml(jiraBase)}/browse/${encodeURIComponent(it.key)}" target="_blank" rel="noopener noreferrer">${escapeHtml(it.key)}</a>`
          : `<span class="hyg-issue-key">${escapeHtml(it.key)}</span>`;
        const meta = [it.type, it.status, it.assignee].filter(Boolean).map(x => escapeHtml(x)).join(' · ');
        return `<li class="hyg-issue-row">
          ${keyLink}
          <span class="hyg-issue-summary" title="${escapeHtml(it.summary)}">${escapeHtml((it.summary || '').slice(0, 100))}</span>
          <span class="hyg-issue-meta">${meta}</span>
        </li>`;
      }).join('');
      const sevClass = v.severity === 'crit' ? 'hyg-rule-crit'
                     : v.severity === 'warn' ? 'hyg-rule-warn'
                                              : 'hyg-rule-info';
      const moreLine = v.truncated
        ? `<li class="hyg-issue-more">…ещё ${v.count - v.items.length} (всего ${v.count}, показано 50)</li>`
        : '';
      return `<details class="hyg-rule ${sevClass}" data-hyg-rule="${escapeHtml(v.rule)}">
        <summary class="hyg-rule-head">
          <span class="hyg-rule-id">${escapeHtml(v.rule)}</span>
          <span class="hyg-rule-label">${escapeHtml(v.label)}</span>
          <span class="hyg-rule-sev hyg-sev-${v.severity}">${escapeHtml(v.severity)}</span>
          <span class="hyg-rule-count">${v.count}</span>
          <button type="button" class="hyg-rule-toggle" data-hyg-action="toggle-rule" data-hyg-rule-id="${escapeHtml(v.rule)}" title="Скрыть это правило">скрыть</button>
        </summary>
        <ul class="hyg-issue-list">${issueRows}${moreLine}</ul>
      </details>`;
    }).join('');
}

/* ─────────────────────────────────────────────────────────────
   Disabled rules summary
   ───────────────────────────────────────────────────────────── */

function _renderDisabledRules(disabledIds, allRules) {
  if (!disabledIds?.length) return '';
  const chips = disabledIds.map(id => {
    const ruleDef = allRules.find(r => r.id === id);
    const label = ruleDef ? ruleDef.label : id;
    return `<button type="button" class="hyg-disabled-chip" data-hyg-action="toggle-rule" data-hyg-rule-id="${escapeHtml(id)}" title="Включить обратно">
      <span class="hyg-disabled-id">${escapeHtml(id)}</span>
      <span class="hyg-disabled-label">${escapeHtml(label)}</span>
      <span class="hyg-disabled-cross">+ вернуть</span>
    </button>`;
  }).join('');
  return `<div class="hyg-disabled-rules">
    <span class="hyg-disabled-title">Скрыто:</span>
    ${chips}
  </div>`;
}

/* ─────────────────────────────────────────────────────────────
   Top-level render
   ───────────────────────────────────────────────────────────── */

/**
 * @param {object} model — Scanner model (TeamScanner2.getModel())
 * @param {object} stateObj — hygieneState instance с .activeTeam / .disabledRules / .thresholdOverrides
 * @param {object} opts — { jiraBaseUrl?, allRules? }
 */
export function renderHygieneSubTab(model, stateObj, opts = {}) {
  // 1. Empty cases
  if (!model) {
    return `<div class="hyg-view">${renderHygieneEmpty('no-data')}</div>`;
  }

  // 2. Filter model by active team
  const activeTeam = stateObj?.activeTeam || '__all__';
  const filteredModel = applyTeamFilter(model, activeTeam);

  // 3. Run engine
  const disabled = stateObj?.disabledRules || [];
  const thresholds = stateObj?.thresholdOverrides || {};
  const { score, violations } = runHygieneRules(filteredModel, {
    disabledRules: disabled,
    thresholds,
  });

  // 4. Compose HTML
  const teamSwitcher = _renderTeamSwitcher(model, activeTeam);
  const scoreBlock = _renderScoreBlock(
    score,
    violations.reduce((s, v) => s + v.count, 0),
    violations.length
  );
  const disabledSummary = _renderDisabledRules(disabled, opts.allRules || []);
  const violationBlocks = violations.length
    ? _renderViolations(violations, opts)
    : `<div class="hyg-state hyg-state-good">✓ Все правила пройдены. Команда — образец.</div>`;

  const howTo = `<div class="hyg-howto" role="note">
    <div class="hyg-howto-title">Гигиена данных Jira · ${activeTeam === '__all__' ? 'все команды' : escapeHtml(activeTeam)}</div>
    <div class="hyg-howto-text">
      20 правил качества данных: без исполнителя, без оценки, zombie в review, carry-over,
      sprint-overload, тихие задачи, critical/blocker без owner и т.д. Score 100 = всё чисто.
      Под каждым правилом — список затронутых задач со ссылками в Jira.
    </div>
  </div>`;

  return `<div class="hyg-view">
    ${teamSwitcher}
    ${howTo}
    ${scoreBlock}
    ${disabledSummary}
    <div class="hyg-rules-list">
      ${violationBlocks}
    </div>
  </div>`;
}
