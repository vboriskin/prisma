'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — RENDERER (INSIGHTS TILES)
   Extracted 2026-05-12 — Tier 0 Renderer split phase 3.

   ~1030 LOC self-contained tile renderers:
     · renderSleepingDataInsights — "Глубже" tab, многоплиточная аналитика
     · _renderDependencySankey — cross-team dependency flow
     · renderTile_componentLoad — component owner load
     · _renderDeeperEmptyState — empty state fallback

   Pure functions: receive model + opts, return HTML string.
   Используется ТОЛЬКО `esc` из Common — нет других внешних helpers
   (Insights functions передаются через `model.scannerV2.*` уже-computed).
   ============================================================ */

import { esc } from './teamScanner2RendererCommon.js';

function _renderDependencySankey(flow) {
  if (!flow.length) return '';
  const sources = new Map();
  const targets = new Map();
  const links = [];
  for (const f of flow) {
    const m = f.pair.match(/^(\S+)\s*→\s*(\S+)$/);
    if (!m) continue;
    const [, src, tgt] = m;
    sources.set(src, (sources.get(src) || 0) + f.count);
    targets.set(tgt, (targets.get(tgt) || 0) + f.count);
    links.push({ src, tgt, count: f.count });
  }
  if (!links.length) return '';
  const srcList = [...sources.entries()].sort((a, b) => b[1] - a[1]);
  const tgtList = [...targets.entries()].sort((a, b) => b[1] - a[1]);

  // 8-цветная палитра — каждой команде свой стабильный цвет.
  const PALETTE = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
  const colorOf = new Map();
  const allPk = [...new Set([...sources.keys(), ...targets.keys()])].sort();
  allPk.forEach((pk, i) => colorOf.set(pk, PALETTE[i % PALETTE.length]));

  // SVG geometry: шире, выше, с местом для labels снаружи.
  const W = 720;
  const nodeW = 14;     // узкие узлы — поток важнее
  const padL = 70;      // место для label слева
  const padR = 70;      // место для label справа
  const padT = 24;
  const padB = 36;      // место для легенды
  const innerH = Math.max(160, Math.max(srcList.length, tgtList.length) * 36);
  const H = padT + innerH + padB;
  const xLeft = padL;
  const xRight = W - padR - nodeW;

  const totalSrc = srcList.reduce((s, [, c]) => s + c, 0) || 1;
  const totalTgt = tgtList.reduce((s, [, c]) => s + c, 0) || 1;

  // Y positions нод.
  const srcY = new Map(); let yA = padT;
  for (const [pk, n] of srcList) {
    const h = Math.max(14, Math.round(n / totalSrc * (innerH - srcList.length * 6)));
    srcY.set(pk, { y: yA, h });
    yA += h + 6;
  }
  const tgtY = new Map(); yA = padT;
  for (const [pk, n] of tgtList) {
    const h = Math.max(14, Math.round(n / totalTgt * (innerH - tgtList.length * 6)));
    tgtY.set(pk, { y: yA, h });
    yA += h + 6;
  }

  // Gradients для каждой связки (один раз uid).
  const gradId = (i) => `ts2sk-grad-${i}`;
  const gradients = links.map((l, i) => {
    const c1 = colorOf.get(l.src);
    const c2 = colorOf.get(l.tgt);
    return `<linearGradient id="${gradId(i)}" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stop-color="${c1}" />
      <stop offset="100%" stop-color="${c2}" />
    </linearGradient>`;
  }).join('');

  // Узлы: тонкие закруглённые прямоугольники + подписи снаружи.
  const nodes = [];
  for (const [pk, n] of srcList) {
    const p = srcY.get(pk);
    const c = colorOf.get(pk);
    nodes.push(`<rect class="ts2-sankey-node" data-pk="${esc(pk)}" x="${xLeft}" y="${p.y}" width="${nodeW}" height="${p.h}" rx="3" fill="${c}"></rect>`);
    nodes.push(`<text x="${xLeft - 8}" y="${p.y + p.h / 2 + 4}" text-anchor="end" font-size="11.5" font-weight="600" fill="var(--text-1)">${esc(pk)}</text>`);
    nodes.push(`<text x="${xLeft - 8}" y="${p.y + p.h / 2 + 17}" text-anchor="end" font-size="10" fill="var(--text-3)" font-family="ui-monospace, monospace">${n}</text>`);
  }
  for (const [pk, n] of tgtList) {
    const p = tgtY.get(pk);
    const c = colorOf.get(pk);
    nodes.push(`<rect class="ts2-sankey-node" data-pk="${esc(pk)}" x="${xRight}" y="${p.y}" width="${nodeW}" height="${p.h}" rx="3" fill="${c}"></rect>`);
    nodes.push(`<text x="${xRight + nodeW + 8}" y="${p.y + p.h / 2 + 4}" text-anchor="start" font-size="11.5" font-weight="600" fill="var(--text-1)">${esc(pk)}</text>`);
    nodes.push(`<text x="${xRight + nodeW + 8}" y="${p.y + p.h / 2 + 17}" text-anchor="start" font-size="10" fill="var(--text-3)" font-family="ui-monospace, monospace">${n}</text>`);
  }

  // Связи: ribbon-curves с градиентом source→target цвет.
  const srcUsed = new Map();
  const tgtUsed = new Map();
  const paths = [];
  const sortedLinks = links.slice().sort((a, b) => b.count - a.count);
  sortedLinks.forEach((l, _i) => {
    const sP = srcY.get(l.src);
    const tP = tgtY.get(l.tgt);
    if (!sP || !tP) return;
    const sFrac = l.count / sources.get(l.src);
    const tFrac = l.count / targets.get(l.tgt);
    const sH = sP.h * sFrac;
    const tH = tP.h * tFrac;
    const sUsed = srcUsed.get(l.src) || 0;
    const tUsed = tgtUsed.get(l.tgt) || 0;
    const sY1 = sP.y + sUsed;
    const sY2 = sY1 + sH;
    const tY1 = tP.y + tUsed;
    const tY2 = tY1 + tH;
    srcUsed.set(l.src, sUsed + sH);
    tgtUsed.set(l.tgt, tUsed + tH);
    const x1 = xLeft + nodeW;
    const x2 = xRight;
    const mid = (x1 + x2) / 2;
    const dTop = `M ${x1} ${sY1} C ${mid} ${sY1}, ${mid} ${tY1}, ${x2} ${tY1}`;
    const dBot = `L ${x2} ${tY2} C ${mid} ${tY2}, ${mid} ${sY2}, ${x1} ${sY2} Z`;
    // Найдём оригинальный index для grad-id.
    const origIdx = links.indexOf(l);
    paths.push(`<path class="ts2-sankey-link" data-pk-src="${esc(l.src)}" data-pk-tgt="${esc(l.tgt)}" d="${dTop} ${dBot}" fill="url(#${gradId(origIdx)})"><title>${esc(l.src)} → ${esc(l.tgt)}: ${l.count} ${l.count === 1 ? 'связь' : (l.count < 5 ? 'связи' : 'связей')}</title></path>`);
  });

  // Легенда — мини-pills снизу.
  const legend = allPk.slice(0, 8).map(pk =>
    `<span class="ts2-sankey-leg-pill"><span class="ts2-sankey-leg-dot" style="background:${colorOf.get(pk)}"></span>${esc(pk)}</span>`
  ).join('');

  return `<details class="ts2-sd-tile ts2-sd-big" open>
    <summary class="ts2-sd-summary"><span>Зависимости между командами</span><span class="ts2-sd-hint">— Sankey · cross-team flow</span></summary>
    <div class="ts2-sankey-wrap">
      <svg class="ts2-sankey" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <defs>${gradients}</defs>
        <g class="ts2-sankey-links">${paths.join('')}</g>
        <g class="ts2-sankey-nodes">${nodes.join('')}</g>
      </svg>
      <div class="ts2-sankey-legend">${legend}</div>
    </div>
  </details>`;
}

/* AUDIT_SCANNER #20 — TODO: разбить эту 700-LOC функцию на per-tile renderers
   (renderTile_componentLoad, renderTile_busFactor, renderTile_throughput, ...).
   Каждый — pure (model) => string|null. Эта функция станет orchestrator'ом.
   Сейчас невозможно тестировать каждый tile отдельно. Proof-of-pattern ниже:
   componentOwnerLoad → renderTile_componentLoad(sum). */

/**
 * AUDIT_SCANNER #20 (proof-of-pattern) — pure tile renderer для component owner load.
 * Извлечён из renderSleepingDataInsights как пример формата для остальных tile'ов.
 * @param {object} sum - model.summary
 * @returns {string|null} HTML или null если данных нет
 */
function renderTile_componentLoad(sum) {
  const cl = sum?.componentOwnerLoad || {};
  const clEntries = Object.entries(cl)
    .map(([name, v]) => ({ name, ...v }))
    .filter(e => e.openCount > 0)
    .sort((a, b) => b.openCount - a.openCount)
    .slice(0, 6);
  if (!clEntries.length) return null;
  const items = clEntries.map(e => {
    const lead = e.lead ? ` · ${esc(e.lead)}` : '';
    return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(e.name)}${lead}</span><span class="ts2-sd-val">${e.openCount}</span><span class="ts2-sd-pct">из ${e.issueCount}</span></li>`;
  }).join('');
  return `<details class="ts2-sd-tile"><summary class="ts2-sd-summary"><span>Component owner load</span><span class="ts2-sd-hint">— компоненты по open issues</span></summary><ul class="ts2-sd-list">${items}</ul></details>`;
}

/**
 * V21 Z1 (audit-09 carry-over #4-#11) — UI-плитки под уже посчитанные данные.
 * Серверная часть (PR-Y3 sleeping data + PR-Y4 big metrics) собирает всё
 * необходимое; здесь — единый блок tile'ов в Сканнере 2.0.
 *
 * Tiles (7):
 *   1. Resolution split   — closed-задачи: Done / Won't Do / Duplicate / ...
 *   2. Sub-task ratio     — top epics с low completion ratio
 *   3. Per-author worklog — top-5 по реально залогированным часам
 *   4. Component load     — top-5 компонентов по open issues
 *   5. Fix-version coverage — release readiness прогресс
 *   6. PR cycle-time / first-review / review-depth (из bitbucket.prMetrics)
 *   7. Big metrics envelope — reopen-rate / sprint-commit / stale-branches / stale-CF
 *
 * Все 7 рендерятся только если есть данные (graceful empty).
 */
/* «Глубже»-tab fallback когда renderSleepingDataInsights() пуст (демо-фикстура
   без summary/bigMetrics, или реальная data до первого refresh с расширенными
   агрегатами). Раньше pane оставался пустым «глубже пусто». */
function _renderDeeperEmptyState(model, opts = {}) {
  const isDemo = !!(model?.isDemo || model?._isDemoFixture);
  const pkFilter = opts.pkFilter || '';
  // V22 fix #11 — в team-view с pkFilter показываем уточнённую empty-state.
  if (opts.scope === 'team' && pkFilter && !isDemo) {
    return `
      <div class="ts2-empty-state ts2-deeper-empty">
        <div class="ts2-empty-title">Для команды ${esc(pkFilter)} пока нет PK-aware углублённых метрик</div>
        <div class="ts2-empty-text">
          PK-aware плитки (закрытие подзадач, логи времени участников команды) появляются после полного цикла сбора Jira-данных.
          Cross-team показатели (Resolution split, Big-metrics, PR-metrics, DORA) — на подвкладке «+&nbsp;Все».
        </div>
      </div>
    `;
  }
  if (isDemo) {
    return `
      <div class="ts2-empty-state ts2-deeper-empty">
        <div class="ts2-empty-title">Углублённая аналитика недоступна в демо</div>
        <div class="ts2-empty-text">
          Resolution split, worklog, fix-version coverage, PR cycle-time, DORA-proxy и Big-metrics
          считаются по реальной выгрузке Jira/Bitbucket/Confluence. В демо-фикстуре синтезируются
          только активность 48ч и базовые счётчики — этого хватает для «Сегодня», но «Глубже»
          опирается на агрегаты, которых в demo нет.
        </div>
        <div class="ts2-empty-text" style="margin-top:8px">
          Подключите Jira (URL + токен + ключи проектов) и нажмите «Обновить» — здесь появятся
          tile'ы с углублёнными метриками.
        </div>
      </div>
    `;
  }
  return `
    <div class="ts2-empty-state ts2-deeper-empty">
      <div class="ts2-empty-title">Пока нет углублённых метрик</div>
      <div class="ts2-empty-text">
        Сканнер ещё не собрал агрегаты для resolution split, worklog, fix-version coverage,
        PR-метрик и DORA-proxy. Это нормально для первого запуска или если интеграции
        Jira / Bitbucket / Confluence настроены частично.
      </div>
      <div class="ts2-empty-text" style="margin-top:8px">
        Нажмите «Обновить» в правом верхнем углу — после полного цикла сбора tile'ы появятся.
        Если данные не приходят, проверьте проектные ключи и токены в настройках интеграций.
      </div>
    </div>
  `;
}

/**
 * V22 fix #11 (2026-05-09 UX) — opts.pkFilter / opts.scope разделяют tile'ы:
 *   · scope='team'  + pkFilter='DEMO' → только PK-aware плитки (sub-task by epic,
 *     per-author по участникам команды, big-metrics byPk[pk])
 *   · scope='multi'                   → только cross-team плитки (resolution split,
 *     fix-version coverage, PR metrics, DORA, cross-team aggregates)
 *   · scope='all' / undefined         → backward-compat: всё подряд
 */
function renderSleepingDataInsights(model, opts = {}) {
  if (!model?.summary && !model?.bigMetrics && !model?.bitbucket?.prMetrics) return '';
  const sum = model.summary || {};
  const bm  = model.bigMetrics || {};
  const prM = model.bitbucket?.prMetrics || null;
  const pkFilter = opts.pkFilter || '';
  const scope    = opts.scope || 'all'; // 'team' | 'multi' | 'all'
  const _showTeamTiles  = (scope === 'team'  || scope === 'all');
  const _showMultiTiles = (scope === 'multi' || scope === 'all');
  // Helper: проверка что epic-key/issue-key относится к команде (PK prefix).
  const _belongsTo = (key) => !pkFilter || (typeof key === 'string' && key.startsWith(pkFilter + '-'));
  // Helper: набор displayName участников команды (для filter worklog/rework по author).
  const _teamMembers = (() => {
    if (!pkFilter || !Array.isArray(model.participants)) return null;
    const set = new Set();
    for (const p of model.participants) {
      const pks = Array.isArray(p?.pks) ? p.pks : (p?.pk ? [p.pk] : []);
      if (!pks.length || pks.includes(pkFilter)) {
        if (p.label)  set.add(String(p.label).toLowerCase());
        if (p.email)  set.add(String(p.email).toLowerCase());
        if (p.key)    set.add(String(p.key).toLowerCase());
      }
    }
    return set;
  })();
  const _isTeamMember = (name) => !_teamMembers || _teamMembers.has(String(name || '').toLowerCase());
  const tiles = [];

  // 1) Resolution split — cross-team (агрегат по всем PK).
  const rs = sum.resolutionSplit || {};
  const rsEntries = _showMultiTiles ? Object.entries(rs).sort((a, b) => b[1] - a[1]) : [];
  if (rsEntries.length) {
    const total = rsEntries.reduce((s, [, n]) => s + n, 0);
    const items = rsEntries.slice(0, 6).map(([name, n]) => {
      const pct = total ? Math.round(n / total * 100) : 0;
      return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(name)}</span><span class="ts2-sd-val">${n}</span><span class="ts2-sd-pct">${pct}%</span></li>`;
    }).join('');
    tiles.push(`<details class="ts2-sd-tile"><summary class="ts2-sd-summary"><span>Закрытие задач</span><span class="ts2-sd-hint">— как закрываются задачи (всего ${total}). Done = успех, Won't Do = отмена, Duplicate = дубль. Высокая доля Won't Do/Duplicate — задачи плохо ставятся на берегу.</span></summary><ul class="ts2-sd-list">${items}</ul></details>`);
  }

  // 2) Sub-task completion ratio per epic — PK-aware (epic-key содержит pk-prefix).
  const sb = sum.subtasksByEpic || {};
  const sbEntries = !_showTeamTiles ? [] : Object.entries(sb)
    .filter(([k, v]) => v.total >= 3 && _belongsTo(k))
    .sort((a, b) => a[1].ratio - b[1].ratio)
    .slice(0, 6);
  if (sbEntries.length) {
    const items = sbEntries.map(([key, v]) => {
      const pct = Math.round(v.ratio * 100);
      const cls = pct < 30 ? 'ts2-sd-bad' : pct < 70 ? 'ts2-sd-mid' : 'ts2-sd-good';
      return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(key)}</span><span class="ts2-sd-val">${v.done}/${v.total}</span><span class="ts2-sd-pct ${cls}">${pct}%</span></li>`;
    }).join('');
    tiles.push(`<details class="ts2-sd-tile"><summary class="ts2-sd-summary"><span>Закрытие подзадач по эпикам</span><span class="ts2-sd-hint">— топ-6 эпиков с самым низким % закрытых подзадач. Чем меньше % — тем дальше эпик от завершения. Красный = &lt;30%, жёлтый = 30-70%, зелёный = ≥70%.</span></summary><ul class="ts2-sd-list">${items}</ul></details>`);
  }

  // 3) Per-author worklog breakdown — PK-aware (фильтруем authors по участникам команды).
  const wl = sum.worklogByAuthor || {};
  const wlEntries = !_showTeamTiles ? [] : Object.entries(wl)
    .map(([k, v]) => ({ name: v.displayName || k, sec: v.secondsTotal || 0 }))
    .filter(e => e.sec > 0 && _isTeamMember(e.name))
    .sort((a, b) => b.sec - a.sec)
    .slice(0, 8);
  if (wlEntries.length) {
    const items = wlEntries.map(e => {
      const hours = (e.sec / 3600).toFixed(1);
      return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(e.name)}</span><span class="ts2-sd-val">${hours}ч</span></li>`;
    }).join('');
    tiles.push(`<details class="ts2-sd-tile"><summary class="ts2-sd-summary"><span>Логи времени по людям</span><span class="ts2-sd-hint">— топ-8 по часам залогированным в Jira. Не путать с реальной нагрузкой — это только то, что человек руками записал в worklog.</span></summary><ul class="ts2-sd-list">${items}</ul></details>`);
  }

  // V22 fix #11 (2026-05-09 UX) — оставшиеся tile'ы (компоненты, fix-version,
  // PR-метрики, DORA, cross-team, Big-metrics, Zephyr, BB governance и т.д.) —
  // cross-team агрегаты, рендерятся ТОЛЬКО в multi-view (+Все). В team-view
  // юзер видит только PK-aware sub-task / worklog / прочие per-author tile'ы.
  if (_showMultiTiles) {
  // 4) Component owner load.
  // AUDIT_SCANNER #20 — extracted into renderTile_componentLoad as proof-of-pattern.
  const componentLoadHtml = renderTile_componentLoad(sum);
  if (componentLoadHtml) tiles.push(componentLoadHtml);

  // 5) Fix-version coverage.
  const fv = sum.fixVersionCoverage || {};
  const fvEntries = Object.entries(fv)
    .filter(([, v]) => v.total >= 3)
    .sort((a, b) => a[1].done / a[1].total - b[1].done / b[1].total)
    .slice(0, 6);
  if (fvEntries.length) {
    const items = fvEntries.map(([name, v]) => {
      const pct = v.total ? Math.round(v.done / v.total * 100) : 0;
      const cls = pct < 30 ? 'ts2-sd-bad' : pct < 70 ? 'ts2-sd-mid' : 'ts2-sd-good';
      const rel = v.released ? ' · released' : '';
      return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(name)}${rel}</span><span class="ts2-sd-val">${v.done}/${v.total}</span><span class="ts2-sd-pct ${cls}">${pct}%</span></li>`;
    }).join('');
    tiles.push(`<details class="ts2-sd-tile"><summary class="ts2-sd-summary"><span>Готовность релизов</span><span class="ts2-sd-hint">— топ-6 ближайших релизов и доля закрытых задач в каждом. Released = уже выехал. Чем выше %, тем больше готовности к выходу.</span></summary><ul class="ts2-sd-list">${items}</ul></details>`);
  }

  // 6) PR metrics — cycle-time / first-review / review-depth.
  if (prM && (prM.cycleTimeMs?.n || prM.firstReviewMs?.n)) {
    const fmtH = (ms) => ms > 0 ? `${(ms / 3600000).toFixed(1)}ч` : '—';
    tiles.push(`
      <details class="ts2-sd-tile"><summary class="ts2-sd-summary"><span>Метрики PR</span><span class="ts2-sd-hint">— скорость прохождения PR. p50 = «у половины было быстрее этого числа», p90 = «у 90% было быстрее». Большой разрыв p50/p90 = есть PR-выбросы которые висят долго.</span></summary>
        <ul class="ts2-sd-list">
          <li class="ts2-sd-row"><span class="ts2-sd-key">Время от open до merge (p50/p90)</span><span class="ts2-sd-val">${fmtH(prM.cycleTimeMs.p50)} / ${fmtH(prM.cycleTimeMs.p90)}</span><span class="ts2-sd-pct">n=${prM.cycleTimeMs.n}</span></li>
          <li class="ts2-sd-row"><span class="ts2-sd-key">Время до первого ревью (p50/p90)</span><span class="ts2-sd-val">${fmtH(prM.firstReviewMs.p50)} / ${fmtH(prM.firstReviewMs.p90)}</span><span class="ts2-sd-pct">n=${prM.firstReviewMs.n}</span></li>
          <li class="ts2-sd-row"><span class="ts2-sd-key">Глубина ревью (комментариев на PR)</span><span class="ts2-sd-val">в среднем ${prM.reviewDepth.avgComments.toFixed(1)} · p50 ${prM.reviewDepth.p50} / p90 ${prM.reviewDepth.p90}</span><span class="ts2-sd-pct">n=${prM.reviewDepth.n}</span></li>
        </ul>
      </details>
    `);
  }

  // 7r) New dashboards (audit-09 §I #98, #100, #103).
  const dash = sum.newDashboards;
  if (dash) {
    const sections = [];
    // #100 Onboarding tracker.
    if ((dash.onboardingTracker || []).length) {
      const rows = dash.onboardingTracker.slice(0, 6).map(t => {
        const cls = t.rampStatus === 'ramped' ? 'ts2-sd-good' : t.rampStatus === 'progressing' ? 'ts2-sd-mid' : 'ts2-sd-bad';
        return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(t.name)}</span><span class="ts2-sd-val">${t.daysActive}д · ${t.totalEvents} ev</span><span class="ts2-sd-pct ${cls}">${t.rampStatus}</span></li>`;
      }).join('');
      sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Onboarding tracker (90д)</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    // #103 Release cockpit.
    if ((dash.releaseCockpit || []).length) {
      const rows = dash.releaseCockpit.slice(0, 8).map(s => {
        const pct = Math.round(s.ratio * 100);
        const cls = pct < 60 ? 'ts2-sd-bad' : pct < 80 ? 'ts2-sd-mid' : 'ts2-sd-good';
        return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(s.pk)} · ${esc(s.sprintName)}</span><span class="ts2-sd-val">${s.delivered}/${s.committed}</span><span class="ts2-sd-pct ${cls}">${pct}%</span></li>`;
      }).join('');
      sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Release train cockpit (sprint history)</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    // #98 Dependency text-graph.
    if ((dash.dependencyFlow || []).length) {
      const rows = dash.dependencyFlow.slice(0, 10).map(f =>
        `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(f.pair)}</span><span class="ts2-sd-val">${f.count} link${f.count === 1 ? '' : 's'}</span></li>`
      ).join('');
      sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Dependency flow (cross-team links)</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    if (sections.length) {
      tiles.push(`<details class="ts2-sd-tile ts2-sd-big"><summary class="ts2-sd-summary"><span>Insights dashboards</span><span class="ts2-sd-hint">— onboarding / release cockpit / dependency flow</span></summary>${sections.join('')}</details>`);
    }
  }

  // 7s) Org-level metrics (audit-09 §H #90, #92, #94).
  const om = sum.orgMetrics;
  if (om) {
    const rows = [];
    if (om.throughputPerFte && om.throughputPerFte.fte > 0) {
      rows.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">Throughput per FTE</span><span class="ts2-sd-val">${om.throughputPerFte.done} / ${om.throughputPerFte.fte}</span><span class="ts2-sd-pct">${om.throughputPerFte.perFte}/чел</span></li>`);
    }
    if (om.innovationRatio) {
      const ir = om.innovationRatio;
      const techCls = ir.techDebtPct > 30 ? 'ts2-sd-bad' : ir.techDebtPct > 15 ? 'ts2-sd-mid' : 'ts2-sd-good';
      rows.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">Innovation ratio</span><span class="ts2-sd-val">F ${ir.featurePct}% · M ${ir.maintenancePct}% · D ${ir.techDebtPct}%</span><span class="ts2-sd-pct ${techCls}">debt ${ir.techDebtPct}%</span></li>`);
    }
    if (om.knowledgeCentralization && om.knowledgeCentralization.contributors > 0) {
      const kc = om.knowledgeCentralization;
      const cls = kc.herfindahl > 0.5 ? 'ts2-sd-bad' : kc.herfindahl > 0.2 ? 'ts2-sd-mid' : 'ts2-sd-good';
      rows.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">Knowledge centralization (CF)</span><span class="ts2-sd-val">${kc.contributors} contributors</span><span class="ts2-sd-pct ${cls}">H=${kc.herfindahl} · ${kc.interpretation}</span></li>`);
    }
    if (rows.length) {
      tiles.push(`<details class="ts2-sd-tile"><summary class="ts2-sd-summary"><span>Org-level signals</span><span class="ts2-sd-hint">— throughput / innovation / knowledge spread</span></summary><ul class="ts2-sd-list">${rows.join('')}</ul></details>`);
    }
  }

  // 7t1) Dependency Sankey SVG (audit-09 §I #30).
  const flow = sum.newDashboards?.dependencyFlow || [];
  if (flow.length) {
    tiles.push(_renderDependencySankey(flow));
  }

  // 7t) Cross-team metrics (audit-09 §H #84, #85, #86, #87).
  const ct = sum.crossTeamMetrics;
  if (ct) {
    const fmtH = (ms) => ms > 0 ? `${(ms / 3600000).toFixed(1)}ч` : '—';
    const rows = [];
    if (ct.dependencyDensity) {
      const pct = ct.dependencyDensity.densityPct;
      const cls = pct > 30 ? 'ts2-sd-bad' : pct > 15 ? 'ts2-sd-mid' : 'ts2-sd-good';
      rows.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">Dependency density</span><span class="ts2-sd-val">${ct.dependencyDensity.crossPkLinks} cross-pk links</span><span class="ts2-sd-pct ${cls}">${pct}%</span></li>`);
    }
    if (ct.blockedByOtherTeam && ct.blockedByOtherTeam.count) {
      rows.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">Blocked by other team</span><span class="ts2-sd-val">${ct.blockedByOtherTeam.totalHours}ч / ${ct.blockedByOtherTeam.count}шт</span><span class="ts2-sd-pct">avg ${ct.blockedByOtherTeam.avgHours}ч</span></li>`);
    }
    if (ct.reviewSlaProxy && ct.reviewSlaProxy.n) {
      rows.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">Review SLA p50/p90</span><span class="ts2-sd-val">${fmtH(ct.reviewSlaProxy.p50)} / ${fmtH(ct.reviewSlaProxy.p90)}</span><span class="ts2-sd-pct">n=${ct.reviewSlaProxy.n}</span></li>`);
    }
    const sharedRows = (ct.sharedComponentsTop || []).slice(0, 5).map(c =>
      `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(c.name)}</span><span class="ts2-sd-val">${c.issueCount} issues</span><span class="ts2-sd-pct">${c.openCount} open</span></li>`
    ).join('');
    const sections = [];
    if (rows.length)        sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Cross-team aggregates</div><ul class="ts2-sd-list">${rows.join('')}</ul></div>`);
    if (sharedRows)         sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Top shared components</div><ul class="ts2-sd-list">${sharedRows}</ul></div>`);
    if (sections.length) {
      tiles.push(`<details class="ts2-sd-tile ts2-sd-big"><summary class="ts2-sd-summary"><span>Cross-team</span><span class="ts2-sd-hint">— dependency / blocking / shared</span></summary>${sections.join('')}</details>`);
    }
  }

  // 7u) Team-level + DORA proxy (audit-09 §H Team #71-#79, #81).
  const tm = sum.teamMetrics;
  if (tm) {
    const fmtH = (ms) => ms > 0 ? `${(ms / 3600000).toFixed(1)}ч` : '—';
    const sections = [];
    // DORA proxy.
    if (tm.dora) {
      const cls = (n, low, high) => n > high ? 'ts2-sd-bad' : n > low ? 'ts2-sd-mid' : 'ts2-sd-good';
      sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">DORA proxy (7д)</div><ul class="ts2-sd-list">
        <li class="ts2-sd-row"><span class="ts2-sd-key">Deploy frequency (merged PR)</span><span class="ts2-sd-val">${tm.dora.deployFreqPer7d}/7д</span></li>
        <li class="ts2-sd-row"><span class="ts2-sd-key">Lead time p50/p90</span><span class="ts2-sd-val">${fmtH(tm.dora.leadTimeMs.p50)} / ${fmtH(tm.dora.leadTimeMs.p90)}</span></li>
        <li class="ts2-sd-row"><span class="ts2-sd-key">MTTR (proxy via blocker time)</span><span class="ts2-sd-val">${tm.dora.mttrHours.toFixed(1)}ч</span></li>
        <li class="ts2-sd-row"><span class="ts2-sd-key">Change-fail rate (revert/total)</span><span class="ts2-sd-val">${(tm.dora.changeFailRate * 100).toFixed(1)}%</span><span class="ts2-sd-pct ${cls(tm.dora.changeFailRate, 0.05, 0.15)}">${tm.dora.changeFailRate > 0.15 ? 'много' : 'ок'}</span></li>
      </ul></div>`);
    }
    // WIP limit compliance, throughput, predictability.
    const generalRows = [];
    if (tm.wipCompliance) {
      const cls = tm.wipCompliance.overWip ? 'ts2-sd-bad' : 'ts2-sd-good';
      generalRows.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">В пути / лимит</span><span class="ts2-sd-val">${tm.wipCompliance.wip} / ${tm.wipCompliance.limit}</span><span class="ts2-sd-pct ${cls}">${tm.wipCompliance.overWip ? 'over' : 'ok'}</span></li>`);
    }
    if (tm.throughput) {
      generalRows.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">Throughput (done/7д)</span><span class="ts2-sd-val">${tm.throughput.donePer7d}</span><span class="ts2-sd-pct">${tm.throughput.perPerson}/чел</span></li>`);
    }
    if (tm.predictability && tm.predictability.n >= 3) {
      const cls = tm.predictability.cov > 0.4 ? 'ts2-sd-bad' : tm.predictability.cov > 0.2 ? 'ts2-sd-mid' : 'ts2-sd-good';
      generalRows.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">Predictability (CoV velocity)</span><span class="ts2-sd-val">σ=${tm.predictability.std} μ=${tm.predictability.mean}</span><span class="ts2-sd-pct ${cls}">CoV ${tm.predictability.cov}</span></li>`);
    }
    if (tm.hotFileConcentration && tm.hotFileConcentration.total > 0) {
      const pct = Math.round(tm.hotFileConcentration.top5Pct * 100);
      const cls = pct > 60 ? 'ts2-sd-bad' : pct > 40 ? 'ts2-sd-mid' : 'ts2-sd-good';
      generalRows.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">Hot-file concentration (top-5)</span><span class="ts2-sd-val">${pct}% всех изменений</span><span class="ts2-sd-pct ${cls}">${pct > 60 ? 'concentrated' : 'spread'}</span></li>`);
    }
    if (tm.truckFactor != null) {
      const cls = tm.truckFactor > 5 ? 'ts2-sd-bad' : tm.truckFactor > 2 ? 'ts2-sd-mid' : 'ts2-sd-good';
      generalRows.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">Truck-factor (files w/ bf=1)</span><span class="ts2-sd-val">${tm.truckFactor}</span><span class="ts2-sd-pct ${cls}">${tm.truckFactor > 5 ? 'риск' : 'ок'}</span></li>`);
    }
    if (tm.backlogHealth) {
      const pct = Math.round(tm.backlogHealth.ratio * 100);
      const cls = pct < 50 ? 'ts2-sd-bad' : pct < 80 ? 'ts2-sd-mid' : 'ts2-sd-good';
      generalRows.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">Backlog health (priority+desc)</span><span class="ts2-sd-val">${tm.backlogHealth.healthy}/${tm.backlogHealth.total}</span><span class="ts2-sd-pct ${cls}">${pct}%</span></li>`);
    }
    if (generalRows.length) sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Team metrics</div><ul class="ts2-sd-list">${generalRows.join('')}</ul></div>`);
    if (sections.length) {
      tiles.push(`<details class="ts2-sd-tile ts2-sd-big"><summary class="ts2-sd-summary"><span>Team-level + DORA</span><span class="ts2-sd-hint">— DORA / WIP / throughput / predictability / truck-factor</span></summary>${sections.join('')}</details>`);
    }
  }

  // 7v00) Code churn per sprint (audit-09 §H Sprint #18).
  const codeChurn = sum.codeChurnPerSprint;
  if (codeChurn && codeChurn.length) {
    const rows = codeChurn.slice(0, 8).map(c =>
      `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(c.pk)} · ${esc(c.sprint)}</span><span class="ts2-sd-val">+${c.additions} / −${c.deletions}</span><span class="ts2-sd-pct">${c.churn} строк / ${c.commits} commits</span></li>`
    ).join('');
    tiles.push(`<details class="ts2-sd-tile"><summary class="ts2-sd-summary"><span>Code churn per sprint</span><span class="ts2-sd-hint">— lines added/deleted в окне спринта</span></summary><ul class="ts2-sd-list">${rows}</ul></details>`);
  }

  // 7v0) Scope churn + Carry-over age (audit-09 §H Sprint #16, #17).
  const scopeChurn = sum.scopeChurn || {};
  const carryAges = sum.carryOverAges || [];
  if (Object.keys(scopeChurn).length || carryAges.length) {
    const sections = [];
    // Scope churn — per sprint name.
    const churnEntries = Object.entries(scopeChurn)
      .map(([name, v]) => ({ name, added: v.added.length, removed: v.removed.length }))
      .filter(e => e.added + e.removed > 0)
      .sort((a, b) => (b.added + b.removed) - (a.added + a.removed))
      .slice(0, 8);
    if (churnEntries.length) {
      const rows = churnEntries.map(e => {
        const cls = (e.added + e.removed) > 10 ? 'ts2-sd-bad' : (e.added + e.removed) > 5 ? 'ts2-sd-mid' : 'ts2-sd-good';
        return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(e.name)}</span><span class="ts2-sd-val">+${e.added} / −${e.removed}</span><span class="ts2-sd-pct ${cls}">${e.added + e.removed} событий</span></li>`;
      }).join('');
      sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Scope churn (per sprint)</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    // Carry-over age top-10.
    const carryTop = carryAges.slice().sort((a, b) => b.moves - a.moves).slice(0, 8);
    if (carryTop.length) {
      const rows = carryTop.map(e => {
        const cls = e.moves > 3 ? 'ts2-sd-bad' : e.moves > 1 ? 'ts2-sd-mid' : 'ts2-sd-good';
        return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(e.key)}: ${esc(e.summary)}</span><span class="ts2-sd-val">${esc(e.assignee || '—')}</span><span class="ts2-sd-pct ${cls}">${e.moves} sprint-moves</span></li>`;
      }).join('');
      sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Carry-over age (issues с N sprint-moves)</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    if (sections.length) {
      tiles.push(`<details class="ts2-sd-tile ts2-sd-big"><summary class="ts2-sd-summary"><span>Sprint scope churn + carry-over</span><span class="ts2-sd-hint">— sprint changelog walking</span></summary>${sections.join('')}</details>`);
    }
  }

  // 7v) Sprint-level metrics (audit-09 §H Sprint #62, #64, #65, #68).
  const sm = sum.sprintMetrics;
  if (sm && (sm.bugToStoryRatio != null || sm.reviewWipNow > 0 || sm.leadTimeMs?.n)) {
    const fmtH = (ms) => ms > 0 ? `${(ms / 3600000).toFixed(1)}ч` : '—';
    const rows = [];
    if (sm.bugToStoryRatio != null) {
      const pct = Math.round(sm.bugToStoryRatio * 100);
      const cls = pct > 30 ? 'ts2-sd-bad' : pct > 15 ? 'ts2-sd-mid' : 'ts2-sd-good';
      rows.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">Bug-to-story ratio</span><span class="ts2-sd-val">${pct}%</span><span class="ts2-sd-pct ${cls}">${sm.bugToStoryRatio.toFixed(2)}</span></li>`);
    }
    if (sm.leadTimeMs?.n) {
      rows.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">Lead-time p50/p90</span><span class="ts2-sd-val">${fmtH(sm.leadTimeMs.p50)} / ${fmtH(sm.leadTimeMs.p90)}</span><span class="ts2-sd-pct">n=${sm.leadTimeMs.n}</span></li>`);
    }
    if (sm.reviewWipNow >= 0) {
      const cls = sm.reviewWipNow > 20 ? 'ts2-sd-bad' : sm.reviewWipNow > 10 ? 'ts2-sd-mid' : 'ts2-sd-good';
      rows.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">Ревью в пути (open PR)</span><span class="ts2-sd-val">${sm.reviewWipNow}</span><span class="ts2-sd-pct ${cls}">${sm.reviewWipNow > 20 ? 'много' : 'ок'}</span></li>`);
    }
    if (sm.blockerTime?.n) {
      rows.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">Blocker time aggregate</span><span class="ts2-sd-val">${sm.blockerTime.totalHours}ч / ${sm.blockerTime.n}шт</span><span class="ts2-sd-pct">avg ${sm.blockerTime.avgHours}ч</span></li>`);
    }
    if (rows.length) {
      tiles.push(`<details class="ts2-sd-tile"><summary class="ts2-sd-summary"><span>Sprint-level signals</span><span class="ts2-sd-hint">— bug ratio / lead-time / review WIP / blocker time</span></summary><ul class="ts2-sd-list">${rows.join('')}</ul></details>`);
    }
  }

  // 7r3) Knowledge flow (audit-09 §H #41).
  const kf = sum.knowledgeFlow;
  if (kf && (kf.spreaders?.length || kf.siloed?.length)) {
    const sections = [];
    if (kf.spreaders?.length) {
      const rows = kf.spreaders.slice(0, 5).map(p =>
        `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(p.name)}</span><span class="ts2-sd-val">${p.spaces} spaces</span><span class="ts2-sd-pct ts2-sd-good">spreader</span></li>`
      ).join('');
      sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Knowledge spreaders (multi-space)</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    if (kf.siloed?.length) {
      const rows = kf.siloed.slice(0, 5).map(p =>
        `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(p.name)}</span><span class="ts2-sd-val">${p.top1} ${Math.round(p.top1Pct * 100)}%</span><span class="ts2-sd-pct ts2-sd-mid">siloed</span></li>`
      ).join('');
      sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Siloed authors (single-space)</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    if (sections.length) {
      tiles.push(`<details class="ts2-sd-tile ts2-sd-big"><summary class="ts2-sd-summary"><span>Knowledge flow</span><span class="ts2-sd-hint">— spreaders / siloed (CF activity по spaces)</span></summary>${sections.join('')}</details>`);
    }
  }

  // 7r-) Coverage map + Untested closed (audit-09 §E #3, #4).
  const cov = sum.coverageReport;
  if (cov && cov.totalClosed > 0) {
    const pct = Math.round(cov.coverageRatio * 100);
    const cls = pct < 30 ? 'ts2-sd-bad' : pct < 70 ? 'ts2-sd-mid' : 'ts2-sd-good';
    const summaryRow = `<li class="ts2-sd-row"><span class="ts2-sd-key">Closed issues с тестами</span><span class="ts2-sd-val">${cov.coveredClosed}/${cov.totalClosed}</span><span class="ts2-sd-pct ${cls}">${pct}% covered</span></li>`;
    const untestedRows = (cov.untestedClosed || []).slice(0, 8).map(u =>
      `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(u.key)}: ${esc(u.summary)}</span><span class="ts2-sd-val">${u.resolutionDate ? u.resolutionDate.slice(0, 10) : '—'}</span><span class="ts2-sd-pct ts2-sd-bad">no tests</span></li>`
    ).join('');
    tiles.push(`<details class="ts2-sd-tile"><summary class="ts2-sd-summary"><span>Test coverage map</span><span class="ts2-sd-hint">— closed issues без Zephyr traceability</span></summary><ul class="ts2-sd-list">${summaryRow}${untestedRows}</ul></details>`);
  }

  // 7r0) Doc coverage (audit-09 §H Sprint #23).
  const dc = sum.docCoverage;
  if (dc && dc.totalVersions > 0) {
    const pct = Math.round(dc.coverageRatio * 100);
    const cls = pct < 30 ? 'ts2-sd-bad' : pct < 70 ? 'ts2-sd-mid' : 'ts2-sd-good';
    const summaryRow = `<li class="ts2-sd-row"><span class="ts2-sd-key">Всего версий: ${dc.totalVersions}</span><span class="ts2-sd-val">${dc.coveredVersions} с CF страницами</span><span class="ts2-sd-pct ${cls}">${pct}%</span></li>`;
    const versionRows = (dc.perVersion || []).slice(0, 8).map(v => {
      const cls2 = v.covered ? 'ts2-sd-good' : 'ts2-sd-bad';
      return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(v.version)}</span><span class="ts2-sd-val">${v.cfPagesCount} pages</span><span class="ts2-sd-pct ${cls2}">${v.covered ? 'есть' : 'нет'}</span></li>`;
    }).join('');
    tiles.push(`<details class="ts2-sd-tile"><summary class="ts2-sd-summary"><span>Doc coverage</span><span class="ts2-sd-hint">— % fixVersion с CF страницей (keyword match)</span></summary><ul class="ts2-sd-list">${summaryRow}${versionRows}</ul></details>`);
  }

  // 7r1b) CF authorship velocity (audit-09 §H Person #15).
  const cfVel = bm.cfVelocity?.perAuthor || {};
  const cfVelEntries = Object.entries(cfVel).filter(([, v]) => v.wordsPerDay > 0).sort((a, b) => b[1].wordsPerDay - a[1].wordsPerDay).slice(0, 6);
  if (cfVelEntries.length) {
    const rows = cfVelEntries.map(([k, v]) =>
      `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(v.displayName)}</span><span class="ts2-sd-val">${v.words} слов / ${v.pages} pages</span><span class="ts2-sd-pct">${v.wordsPerDay}/день</span></li>`
    ).join('');
    tiles.push(`<details class="ts2-sd-tile"><summary class="ts2-sd-summary"><span>CF authorship velocity</span><span class="ts2-sd-hint">— слов в день (top-30 recent pages, окно 14д)</span></summary><ul class="ts2-sd-list">${rows}</ul></details>`);
  }

  // 7r1a) Bug-induce rate proxy (audit-09 §H Person #14).
  const bugInduceAuthors = (model.participants || [])
    .filter(p => p.bugInduceRate != null && p.bugInduceCounts.bugs > 0)
    .map(p => ({ name: p.label || p.email, rate: p.bugInduceRate, ...p.bugInduceCounts }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 6);
  if (bugInduceAuthors.length) {
    const rows = bugInduceAuthors.map(p => {
      const pct = Math.round(p.rate * 100);
      const cls = pct > 30 ? 'ts2-sd-bad' : pct > 15 ? 'ts2-sd-mid' : 'ts2-sd-good';
      return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(p.name)}</span><span class="ts2-sd-val">${p.bugs} bugs / ${p.commits} commits</span><span class="ts2-sd-pct ${cls}">${pct}%</span></li>`;
    }).join('');
    tiles.push(`<details class="ts2-sd-tile"><summary class="ts2-sd-summary"><span>Bug-induce rate (proxy)</span><span class="ts2-sd-hint">— bugs assigned / commits в окне</span></summary><ul class="ts2-sd-list">${rows}</ul></details>`);
  }

  // 7r1) Rework ratio (audit-09 §H Person #18).
  const reworkAuthors = (model.participants || [])
    .filter(p => p.reworkRatio != null && p.reworkCount > 0)
    .map(p => ({ name: p.label || p.email, rate: p.reworkRatio, count: p.reworkCount, total: p.reworkTotalAssigned }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 6);
  if (reworkAuthors.length) {
    const rows = reworkAuthors.map(p => {
      const pct = Math.round(p.rate * 100);
      const cls = pct > 30 ? 'ts2-sd-bad' : pct > 15 ? 'ts2-sd-mid' : 'ts2-sd-good';
      return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(p.name)}</span><span class="ts2-sd-val">${p.count}/${p.total} reopens</span><span class="ts2-sd-pct ${cls}">${pct}%</span></li>`;
    }).join('');
    tiles.push(`<details class="ts2-sd-tile"><summary class="ts2-sd-summary"><span>Rework ratio (per author)</span><span class="ts2-sd-hint">— issues с reopens / total assigned</span></summary><ul class="ts2-sd-list">${rows}</ul></details>`);
  }

  // 7r2) Mentorship signal (audit-09 §H #25).
  const mentors = model.bitbucket?.mentorScores;
  if (mentors && mentors.length) {
    const rows = mentors.slice(0, 5).map(m =>
      `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(m.mentor)} → ${esc(m.mentee)}</span><span class="ts2-sd-val">+${m.score}</span><span class="ts2-sd-pct">${m.helped} reviews</span></li>`
    ).join('');
    tiles.push(`<details class="ts2-sd-tile"><summary class="ts2-sd-summary"><span>Mentorship signal</span><span class="ts2-sd-hint">— asymmetric review/comment pairs</span></summary><ul class="ts2-sd-list">${rows}</ul></details>`);
  }

  // 7q) Code-review depth + Review reciprocity (audit-09 §H #23, #24).
  const crDepth = model.bitbucket?.codeReviewDepth;
  const recip   = model.bitbucket?.reciprocity;
  if ((crDepth && crDepth.length) || (recip && recip.pairs > 0)) {
    const sections = [];
    if (crDepth && crDepth.length) {
      const top = crDepth.slice(0, 5);
      const rows = top.map(d =>
        `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(d.name)}</span><span class="ts2-sd-val">${d.prsReviewed} PR reviewed</span></li>`
      ).join('');
      sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Code-review depth (top reviewers)</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    if (recip && recip.pairs > 0) {
      const pct = Math.round(recip.ratio * 100);
      const cls = pct < 30 ? 'ts2-sd-bad' : pct < 60 ? 'ts2-sd-mid' : 'ts2-sd-good';
      sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Review reciprocity</div><ul class="ts2-sd-list">
        <li class="ts2-sd-row"><span class="ts2-sd-key">Bidirectional pairs</span><span class="ts2-sd-val">${recip.reciprocal}/${recip.pairs}</span><span class="ts2-sd-pct ${cls}">${pct}%</span></li>
      </ul></div>`);
    }
    if (sections.length) {
      tiles.push(`<details class="ts2-sd-tile ts2-sd-big"><summary class="ts2-sd-summary"><span>Code-review analytics</span><span class="ts2-sd-hint">— depth + reciprocity</span></summary>${sections.join('')}</details>`);
    }
  }

  // 7w) Person-level metrics (audit-09 §H #49, #50, #54, #56, #57, #58).
  // Surface top-N anomalies: высокий afterHours, узкие специалисты, тестовые owners.
  const parts = model.participants || [];
  if (parts.length) {
    const sections = [];
    // After-hours top — сигнал burnout.
    const afterHrs = parts
      .filter(p => p.metrics && p.metrics.afterHoursTotalEvents >= 5)
      .map(p => ({ name: p.label || p.email, ratio: p.metrics.afterHoursRatio, n: p.metrics.afterHoursTotalEvents }))
      .filter(p => p.ratio > 0.2)
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 5);
    if (afterHrs.length) {
      const rows = afterHrs.map(p => {
        const pct = Math.round(p.ratio * 100);
        const cls = pct > 50 ? 'ts2-sd-bad' : pct > 30 ? 'ts2-sd-mid' : 'ts2-sd-good';
        return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(p.name)}</span><span class="ts2-sd-val">n=${p.n}</span><span class="ts2-sd-pct ${cls}">${pct}% off-hours</span></li>`;
      }).join('');
      sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">After-hours ratio (burnout signal)</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    // Knowledge breadth — кто узкий специалист (Gini > 0.6).
    const specialists = parts
      .filter(p => p.metrics && p.metrics.specialistGini > 0.6 && p.metrics.knowledgeBreadth >= 1)
      .map(p => ({ name: p.label || p.email, gini: p.metrics.specialistGini, breadth: p.metrics.knowledgeBreadth }))
      .sort((a, b) => b.gini - a.gini)
      .slice(0, 5);
    if (specialists.length) {
      const rows = specialists.map(p => {
        const cls = p.gini > 0.8 ? 'ts2-sd-bad' : p.gini > 0.6 ? 'ts2-sd-mid' : 'ts2-sd-good';
        // 2026-05-11 — interpretation tooltip: Gini coefficient — domain
        // concept, тимлид не знает что 0.7 значит. Tooltip даёт human reading.
        const interp = p.gini > 0.8 ? 'критически узкий — bus factor 1' :
                       p.gini > 0.6 ? 'узкий — рекомендуется knowledge-share' :
                                       'умеренная специализация';
        return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(p.name)}</span><span class="ts2-sd-val">${p.breadth} проектов</span><span class="ts2-sd-pct ${cls}" title="Gini ${p.gini.toFixed(2)} — ${interp}. Распределение коммитов по файлам: 0=равно, 1=весь код в одном файле. Threshold: >0.6 = warning, >0.8 = critical.">Gini ${p.gini.toFixed(2)}</span></li>`;
      }).join('');
      sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Узкие специалисты <span class="ts2-sd-section-hint" title="Gini coefficient распределения коммитов: 0 = равномерно, 1 = только один файл. Высокий Gini = знание сконцентрировано → bus factor risk.">(?)</span></div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    // Test ownership — top-5 by total tests.
    const testOwners = parts
      .filter(p => p.metrics?.testOwnership && (p.metrics.testOwnership.created + p.metrics.testOwnership.executed) >= 5)
      .map(p => ({ name: p.label || p.email, c: p.metrics.testOwnership.created, e: p.metrics.testOwnership.executed }))
      .sort((a, b) => (b.c + b.e) - (a.c + a.e))
      .slice(0, 5);
    if (testOwners.length) {
      const rows = testOwners.map(p =>
        `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(p.name)}</span><span class="ts2-sd-val">создал ${p.c}</span><span class="ts2-sd-pct">прогнал ${p.e}</span></li>`
      ).join('');
      sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Test ownership (top по тестам)</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    if (sections.length) {
      tiles.push(`<details class="ts2-sd-tile ts2-sd-big"><summary class="ts2-sd-summary"><span>Person-level signals</span><span class="ts2-sd-hint">— burnout / specialists / test ownership</span></summary>${sections.join('')}</details>`);
    }
  }

  // 7x) Confluence extra (audit-09 §D #16, #25, #26, #30, #32).
  const cfh = bm.cfHealth || {};
  if (cfh.bySpace && Object.keys(cfh.bySpace).length) {
    const sections = [];
    const rows = Object.entries(cfh.bySpace).map(([sp, v]) => {
      const orphPct = v.orphanRatio != null ? `${Math.round(v.orphanRatio * 100)}%` : '';
      const cls = (v.orphanRatio || 0) > 0.3 ? 'ts2-sd-bad' : (v.orphanRatio || 0) > 0.15 ? 'ts2-sd-mid' : 'ts2-sd-good';
      return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(sp)}</span><span class="ts2-sd-val">всего ${v.totalPages} · orphan ${v.orphans} · DoD ${v.dodCoverage}</span><span class="ts2-sd-pct ${cls}">${orphPct} orphan</span></li>`;
    }).join('');
    sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Per-space health</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    // Top owners (V21 AB).
    if ((cfh.ownership || []).length) {
      const ownerRows = cfh.ownership.slice(0, 6).map(o =>
        `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(o.name)}</span><span class="ts2-sd-val">${o.edits} edits</span><span class="ts2-sd-pct">${o.comments} comm</span></li>`
      ).join('');
      sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Top page owners (proxy by edits)</div><ul class="ts2-sd-list">${ownerRows}</ul></div>`);
    }
    tiles.push(`<details class="ts2-sd-tile ts2-sd-big"><summary class="ts2-sd-summary"><span>CF health</span><span class="ts2-sd-hint">— per-space + ownership</span></summary>${sections.join('')}</details>`);
  }

  // 7p) BB Governance (audit-09 §C #9, #14, #15) — ACL + hooks + PR-size.
  const bbGov = bm.bbGovernance;
  if (bbGov && bbGov.configured) {
    const sections = [];
    // PR-size distribution + buckets (V21 BD).
    if (bbGov.distribution && bbGov.distribution.n > 0) {
      const dist = bbGov.distribution;
      const bp = dist.bucketsPct || {};
      const xlCls = (bp.xl || 0) > 20 ? 'ts2-sd-bad' : (bp.xl || 0) > 10 ? 'ts2-sd-mid' : 'ts2-sd-good';
      const distRows = [
        `<li class="ts2-sd-row"><span class="ts2-sd-key">files p50/p90/p99</span><span class="ts2-sd-val">${dist.files.p50} / ${dist.files.p90} / ${dist.files.p99 || '—'}</span><span class="ts2-sd-pct">n=${dist.n}</span></li>`,
        `<li class="ts2-sd-row"><span class="ts2-sd-key">lines p50/p90/p99</span><span class="ts2-sd-val">${dist.lines.p50} / ${dist.lines.p90} / ${dist.lines.p99 || '—'}</span></li>`,
      ];
      if (dist.buckets) {
        distRows.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">S / M / L / XL bucketing</span><span class="ts2-sd-val">${dist.buckets.s} / ${dist.buckets.m} / ${dist.buckets.l} / ${dist.buckets.xl}</span><span class="ts2-sd-pct ${xlCls}">${bp.xl || 0}% XL</span></li>`);
      }
      sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">PR-size distribution (recent merged, до 200 PR)</div><ul class="ts2-sd-list">${distRows.join('')}</ul></div>`);
    }
    // ACL summary.
    const repoEntries = Object.entries(bbGov.perRepo || {}).slice(0, 6);
    if (repoEntries.length) {
      const rows = repoEntries.map(([repo, s]) => {
        return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(repo)}</span><span class="ts2-sd-val">ACL ${s.acl.users}u/${s.acl.groups}g</span><span class="ts2-sd-pct">hooks ${s.hooks.enabled}/${s.hooks.configured}</span></li>`;
      }).join('');
      sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">ACL + hooks (top repos)</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    if (sections.length) {
      tiles.push(`<details class="ts2-sd-tile ts2-sd-big"><summary class="ts2-sd-summary"><span>BB governance</span><span class="ts2-sd-hint">— PR-size / ACL / hooks</span></summary>${sections.join('')}</details>`);
    }
  }

  // 7y) Bitbucket extra (audit-09 §C #15, #18, #19) — reviewer overload/idle + stale tags.
  const revStats = model.bitbucket?.reviewerStats;
  if (revStats && (revStats.overload?.length || revStats.idle?.length)) {
    const sections = [];
    if (revStats.overload?.length) {
      const max = revStats.overload[0].assigned || 1;
      const rows = revStats.overload.slice(0, 6).map(r => {
        const pct = Math.round((r.assigned / max) * 100);
        const cls = pct > 80 ? 'ts2-sd-bad' : pct > 50 ? 'ts2-sd-mid' : 'ts2-sd-good';
        return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(r.name)}</span><span class="ts2-sd-val">${r.acted}/${r.assigned}</span><span class="ts2-sd-pct ${cls}">${pct}% load</span></li>`;
      }).join('');
      sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Reviewer overload (top по assigned)</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    if (revStats.idle?.length) {
      const rows = revStats.idle.slice(0, 6).map(r =>
        `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(r.name)}</span><span class="ts2-sd-val">${r.assigned} assigned</span><span class="ts2-sd-pct ts2-sd-bad">0 actions</span></li>`
      ).join('');
      sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Idle reviewers (assigned but inactive)</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    if (sections.length) {
      tiles.push(`<details class="ts2-sd-tile ts2-sd-big"><summary class="ts2-sd-summary"><span>Bitbucket extra</span><span class="ts2-sd-hint">— reviewer load + idle</span></summary>${sections.join('')}</details>`);
    }
  }

  // 7y) D2 (2026-05-10) — Zephyr activity headline tile.
  // Источник: model.zephyr (passthrough из rawReports.zephyr — см. portfolioPulseModel.js:169).
  // Показываем raw scan-counts (testCasesScanned / testRunsScanned) и authorsCount —
  // эти числа НЕ зависят от identity-attribution и от sprint-filter, поэтому остаются
  // читаемыми даже когда per-participant attribution даёт 0 (как было до D1-фикса).
  // Tile рендерится только когда Zephyr реально просканирован (testCasesScanned > 0
  // ИЛИ testRunsScanned > 0). Для не-настроенного Zephyr (configured=false) — тихо.
  const zSum    = model.zephyr?.summary || null;
  const zAuthors = model.zephyr?.authors || null;
  if (_showMultiTiles && zSum && ((zSum.testCasesScanned || 0) > 0 || (zSum.testRunsScanned || 0) > 0)) {
    const authorsCount = zAuthors ? Object.keys(zAuthors).length : 0;
    let tCreated = 0, tExecuted = 0;
    if (zAuthors) {
      for (const a of Object.values(zAuthors)) {
        tCreated  += Number(a?.testsCreated  || 0);
        tExecuted += Number(a?.testsExecuted || 0);
      }
    }
    const mode = zSum.mode || model.zephyr?.mode || '—';
    const rows = [
      `<li class="ts2-sd-row"><span class="ts2-sd-key" style="text-transform:uppercase;letter-spacing:.6px;font-size:9px;opacity:.7">QA активны</span><span class="ts2-sd-val">${authorsCount}</span><span class="ts2-sd-pct">за 72ч</span></li>`,
      `<li class="ts2-sd-row"><span class="ts2-sd-key" style="text-transform:uppercase;letter-spacing:.6px;font-size:9px;opacity:.7">Создано</span><span class="ts2-sd-val">${tCreated}</span><span class="ts2-sd-pct">тест-кейсов</span></li>`,
      `<li class="ts2-sd-row"><span class="ts2-sd-key" style="text-transform:uppercase;letter-spacing:.6px;font-size:9px;opacity:.7">Прогнано</span><span class="ts2-sd-val">${tExecuted}</span><span class="ts2-sd-pct">прогонов</span></li>`,
      `<li class="ts2-sd-row"><span class="ts2-sd-key" style="text-transform:uppercase;letter-spacing:.6px;font-size:9px;opacity:.7">Скан</span><span class="ts2-sd-val">${zSum.testCasesScanned || 0} / ${zSum.testRunsScanned || 0}</span><span class="ts2-sd-pct">${esc(mode)}</span></li>`,
    ].join('');
    tiles.push(`<details class="ts2-sd-tile" open><summary class="ts2-sd-summary"><span>Zephyr активность</span><span class="ts2-sd-hint">— активные QA · создание / прогон тестов · что Zephyr-API вернул за 72ч</span></summary><ul class="ts2-sd-list">${rows}</ul></details>`);
  }

  // 7z) Zephyr extra metrics (audit-09 §E #34, #38, #40, #42-#45).
  const zx = model.zephyr?.extra || null;
  if (zx) {
    const zxParts = [];
    // Pass rate per author.
    const prEntries = Object.entries(zx.passRateByAuthor || {})
      .filter(([, v]) => v.total >= 5)
      .sort((a, b) => a[1].rate - b[1].rate)
      .slice(0, 6);
    if (prEntries.length) {
      const rows = prEntries.map(([, v]) => {
        const pct = Math.round(v.rate * 100);
        const cls = pct < 60 ? 'ts2-sd-bad' : pct < 85 ? 'ts2-sd-mid' : 'ts2-sd-good';
        return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(v.displayName)}</span><span class="ts2-sd-val">${v.pass}/${v.total}</span><span class="ts2-sd-pct ${cls}">${pct}%</span></li>`;
      }).join('');
      zxParts.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Pass rate per author</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    // Test debt.
    if ((zx.testDebt || []).length) {
      const rows = zx.testDebt.slice(0, 6).map(t =>
        `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(t.key)}: ${esc(t.name)}</span><span class="ts2-sd-val">${t.daysSilent}д</span><span class="ts2-sd-pct ts2-sd-bad">no run</span></li>`
      ).join('');
      zxParts.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Test debt (>90д без runs)</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    // Slow tests.
    if ((zx.slowTests || []).length) {
      const rows = zx.slowTests.slice(0, 6).map(t => {
        const sec = (t.executionTime / 1000).toFixed(1);
        return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(t.key)}: ${esc(t.name)}</span><span class="ts2-sd-val">${sec}s</span></li>`;
      }).join('');
      zxParts.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Slow tests (top execution time)</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    // PR-DC — Cycle completion %.
    if ((zx.cycleCompletion || []).length) {
      const rows = zx.cycleCompletion.slice(0, 8).map(c => {
        const cls = c.completionPct < 30 ? 'ts2-sd-bad' : c.completionPct < 70 ? 'ts2-sd-mid' : 'ts2-sd-good';
        return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(c.name)} <span class="ts2-sd-source-tag">${esc(c.pk)}</span></span><span class="ts2-sd-val">${c.done}/${c.total} · ${c.byStatus.fail} fail</span><span class="ts2-sd-pct ${cls}">${c.completionPct}%</span></li>`;
      }).join('');
      zxParts.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Закрытие тест-циклов</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    // Manual vs auto.
    const ma = zx.manualVsAuto || { manual: 0, auto: 0, unknown: 0 };
    if (ma.manual + ma.auto + ma.unknown > 0) {
      const total = ma.manual + ma.auto + ma.unknown;
      zxParts.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Manual vs auto split</div><ul class="ts2-sd-list">
        <li class="ts2-sd-row"><span class="ts2-sd-key">manual</span><span class="ts2-sd-val">${ma.manual}</span><span class="ts2-sd-pct">${Math.round(ma.manual / total * 100)}%</span></li>
        <li class="ts2-sd-row"><span class="ts2-sd-key">auto</span><span class="ts2-sd-val">${ma.auto}</span><span class="ts2-sd-pct">${Math.round(ma.auto / total * 100)}%</span></li>
        <li class="ts2-sd-row"><span class="ts2-sd-key">unlabeled</span><span class="ts2-sd-val">${ma.unknown}</span><span class="ts2-sd-pct">${Math.round(ma.unknown / total * 100)}%</span></li>
      </ul></div>`);
    }
    // Defects from failed runs.
    const dfEntries = Object.entries(zx.defectsFromFails || {}).sort((a, b) => b[1].count - a[1].count).slice(0, 6);
    if (dfEntries.length) {
      const rows = dfEntries.map(([key, v]) =>
        `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(key)}</span><span class="ts2-sd-val">${v.count} fail-runs</span></li>`
      ).join('');
      zxParts.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Defects from failed test runs</div><ul class="ts2-sd-list">${rows}</ul></div>`);
    }
    if (zxParts.length) {
      tiles.push(`<details class="ts2-sd-tile ts2-sd-big"><summary class="ts2-sd-summary"><span>Zephyr extra</span><span class="ts2-sd-hint">— pass-rate / debt / slow / manual-auto</span></summary>${zxParts.join('')}</details>`);
    }
  }

  // 7a) Hot-files + Bus-factor (audit-09 §G #20-#21).
  const hf = bm.hotFiles || {};
  if ((hf.hotFiles || []).length || (hf.busFactor || []).length) {
    const hotRows = (hf.hotFiles || []).slice(0, 10).map(f => {
      const cls = f.busFactor === 1 ? 'ts2-sd-bad' : f.busFactor === 2 ? 'ts2-sd-mid' : 'ts2-sd-good';
      return `<li class="ts2-sd-row"><span class="ts2-sd-key" title="${esc(f.path)}">${esc(f.path.split('/').slice(-2).join('/'))}</span><span class="ts2-sd-val">${f.changes} изм</span><span class="ts2-sd-pct ${cls}">bf=${f.busFactor}</span></li>`;
    }).join('');
    const bfRows = (hf.busFactor || []).slice(0, 8).map(f => {
      return `<li class="ts2-sd-row"><span class="ts2-sd-key" title="${esc(f.path)}">${esc(f.path.split('/').slice(-2).join('/'))}</span><span class="ts2-sd-val">${esc(f.topAuthor)}</span><span class="ts2-sd-pct ts2-sd-bad">${f.topAuthorPct}%</span></li>`;
    }).join('');
    const sections = [];
    if (hotRows) sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Hot files (top-10 за 30д)</div><ul class="ts2-sd-list">${hotRows}</ul></div>`);
    if (bfRows)  sections.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Bus-factor=1 (одна точка отказа)</div><ul class="ts2-sd-list">${bfRows}</ul></div>`);
    // 2026-05-11 — team-level bus-factor aggregate (1 число для quick scan).
    // Вычисляем: какой % файлов имеют bus-factor=1 (один автор).
    // Threshold: >30% = critical, >15% = warn, <15% = ok.
    const totalHotFiles = (hf.hotFiles || []).length;
    const bf1Count = (hf.busFactor || []).length;
    if (totalHotFiles > 0) {
      const bf1Pct = Math.round((bf1Count / totalHotFiles) * 100);
      const teamBfCls = bf1Pct > 30 ? 'ts2-sd-bad' : bf1Pct > 15 ? 'ts2-sd-mid' : 'ts2-sd-good';
      const teamBfInterp = bf1Pct > 30 ? 'критично — много single-points-of-failure' :
                           bf1Pct > 15 ? 'norm — рекомендуется knowledge-share' :
                                          'хорошо — широкое распределение знаний';
      sections.unshift(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Team bus-factor (aggregate)</div><ul class="ts2-sd-list"><li class="ts2-sd-row"><span class="ts2-sd-key">${bf1Count} файлов с bus-factor=1 из ${totalHotFiles}</span><span class="ts2-sd-pct ${teamBfCls}" title="${esc(teamBfInterp)}">${bf1Pct}%</span></li></ul></div>`);
    }
    if (sections.length) {
      tiles.push(`<details class="ts2-sd-tile ts2-sd-big"><summary class="ts2-sd-summary"><span>Hot files + Bus-factor</span><span class="ts2-sd-hint">— файлы с риском</span></summary>${sections.join('')}</details>`);
    }
  }

  // 7) Big metrics envelope (reopen-rate / sprint-commit / stale-branches / stale-CF).
  const bigParts = [];
  if (bm.reopenRate?.byPk && Object.keys(bm.reopenRate.byPk).length) {
    const rows = Object.entries(bm.reopenRate.byPk).map(([pk, v]) => {
      const pct = (v.rate * 100).toFixed(1);
      const cls = v.rate > 0.15 ? 'ts2-sd-bad' : v.rate > 0.05 ? 'ts2-sd-mid' : 'ts2-sd-good';
      return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(pk)}</span><span class="ts2-sd-val">${v.reopens}/${v.dones}</span><span class="ts2-sd-pct ${cls}">${pct}%</span></li>`;
    }).join('');
    bigParts.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Reopen rate (90д)</div><ul class="ts2-sd-list">${rows}</ul></div>`);
  }
  if (bm.sprintCommit?.byPk && Object.keys(bm.sprintCommit.byPk).length) {
    const rows = Object.entries(bm.sprintCommit.byPk).map(([pk, v]) => {
      const pct = Math.round(v.avgDeliveryRatio * 100);
      const cls = pct < 60 ? 'ts2-sd-bad' : pct < 80 ? 'ts2-sd-mid' : 'ts2-sd-good';
      const trend = (v.velocityTrend || []).join('→');
      return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(pk)} · ${v.sprints.length}sp</span><span class="ts2-sd-val" title="velocity: ${trend}">${trend || '—'}</span><span class="ts2-sd-pct ${cls}">avg ${pct}%</span></li>`;
    }).join('');
    bigParts.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Sprint commitment vs delivery (6 спринтов)</div><ul class="ts2-sd-list">${rows}</ul></div>`);
  }
  if (bm.staleBranches?.byRepo && Object.keys(bm.staleBranches.byRepo).length) {
    const rows = Object.entries(bm.staleBranches.byRepo)
      .filter(([, v]) => v.staleCount > 0)
      .sort((a, b) => b[1].staleCount - a[1].staleCount)
      .slice(0, 8)
      .map(([repo, v]) => `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(repo)}</span><span class="ts2-sd-val">${v.staleCount}</span><span class="ts2-sd-pct">stale &gt;30д</span></li>`)
      .join('');
    if (rows) bigParts.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Ветки без сигнала</div><ul class="ts2-sd-list">${rows}</ul></div>`);
  }
  if (bm.staleConfluence?.bySpace && Object.keys(bm.staleConfluence.bySpace).length) {
    const rows = Object.entries(bm.staleConfluence.bySpace)
      .filter(([, v]) => v.staleCount > 0)
      .sort((a, b) => b[1].staleCount - a[1].staleCount)
      .map(([sp, v]) => `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(sp)}</span><span class="ts2-sd-val">${v.staleCount}</span><span class="ts2-sd-pct">stale &gt;1г</span></li>`)
      .join('');
    if (rows) bigParts.push(`<div class="ts2-sd-section"><div class="ts2-sd-section-title">Confluence без сигнала</div><ul class="ts2-sd-list">${rows}</ul></div>`);
  }
  if (bigParts.length) {
    tiles.push(`<details class="ts2-sd-tile ts2-sd-big"><summary class="ts2-sd-summary"><span>Сводные метрики команды</span><span class="ts2-sd-hint">— переоткрытия задач, velocity на спринт, доля задач без движения, давно не обновлявшиеся ветки и страницы. Большие проценты переоткрытий = задачи закрываются раньше времени.</span></summary>${bigParts.join('')}</details>`);
  }

  // 7j) Phase-2 Jenkins activity tile (2026-05-10).
  // Multi-only: Jenkins folder не привязан к PK (один shared CI на всю
  // platform), поэтому per-team разрезу метрика бессмысленна. В team-view
  // тайл скрываем — там его место заняла бы плитка с per-author данными,
  // которая уже частично есть в person-card J chip + identity-attribution.
  // Graceful: если jenkins не сконфигурен (model.jenkins=null) или
  // error / 0 jobs — tile не рендерится тихо.
  const jen = model.jenkins;
  if (jen && !jen.error && (jen.summary?.totalBuilds7d > 0 || jen.totalJobs > 0)) {
    const sum = jen.summary || {};
    const frPct = Number(sum.failureRatePct || 0);
    const frCls = frPct >= 20 ? 'ts2-sd-bad' : (frPct >= 10 ? 'ts2-sd-mid' : 'ts2-sd-good');
    const items = [
      `<li class="ts2-sd-row"><span class="ts2-sd-key">Всего билдов</span><span class="ts2-sd-val">${sum.totalBuilds7d || 0}</span><span class="ts2-sd-pct">за 7д</span></li>`,
      `<li class="ts2-sd-row"><span class="ts2-sd-key">Failure rate</span><span class="ts2-sd-val">${sum.failures7d || 0}/${sum.totalBuilds7d || 0}</span><span class="ts2-sd-pct ${frCls}">${frPct}%</span></li>`,
      `<li class="ts2-sd-row"><span class="ts2-sd-key">Deploy frequency</span><span class="ts2-sd-val">${sum.deployFreqPer7d || 0}</span><span class="ts2-sd-pct">релизов/7д</span></li>`,
      `<li class="ts2-sd-row"><span class="ts2-sd-key">MTTR</span><span class="ts2-sd-val">${(Number(sum.mttrHours) || 0).toFixed(1)}</span><span class="ts2-sd-pct">ч (proxy)</span></li>`,
      `<li class="ts2-sd-row"><span class="ts2-sd-key">Jobs scanned</span><span class="ts2-sd-val">${jen.scannedJobs || 0}/${jen.totalJobs || 0}</span><span class="ts2-sd-pct">${esc(jen.folder || '')}</span></li>`,
    ];
    // Top 5 failed jobs с link'ами на Jenkins URL.
    const topFailed = (jen.perJob || [])
      .filter(j => (j.failures7d || 0) > 0)
      .sort((a, b) => (b.failures7d || 0) - (a.failures7d || 0))
      .slice(0, 5);
    if (topFailed.length) {
      items.push(`<li class="ts2-sd-row ts2-sd-row-section"><span class="ts2-sd-key">Топ failed jobs</span></li>`);
      for (const j of topFailed) {
        const safeUrl = j.url ? esc(j.url) : '#';
        const linkOpen  = j.url ? `<a href="${safeUrl}" target="_blank" rel="noopener">` : '<span>';
        const linkClose = j.url ? '</a>' : '</span>';
        items.push(`<li class="ts2-sd-row"><span class="ts2-sd-key">${linkOpen}${esc(j.name)}${linkClose}</span><span class="ts2-sd-val">${j.failures7d}/${j.builds7d || 0}</span><span class="ts2-sd-pct ts2-sd-bad">fail</span></li>`);
      }
    }
    tiles.push(`<details class="ts2-sd-tile"><summary class="ts2-sd-summary"><span>Jenkins активность</span><span class="ts2-sd-hint">— builds / failure rate / deploy frequency / MTTR (proxy: время от FAILURE до следующего SUCCESS на том же job). Источник — folder ${esc(jen.folder || 'sbof')}.</span></summary><ul class="ts2-sd-list">${items.join('')}</ul></details>`);
  }
  } // end V22 fix #11 — _showMultiTiles guard

  if (!tiles.length) return '';
  // PR-DD — tabbed-tiles. Категоризируем каждый tile по заголовку (внутри
  // <summary>) через regex и оборачиваем в tab-bar. По дефолту — «Все».
  // Active tab persist'ится в localStorage (см. teamScanner2.js handler).
  const categorize = (html) => {
    const m = html.match(/<span>([^<]+)<\/span>/);
    const title = m ? m[1].toLowerCase() : '';
    if (/(sprint|спринт|carry-over|scope churn|code churn|estimation|sprint-level|sprint commit)/i.test(title)) return 'sprint';
    if (/(test|coverage map|cycle|defect|pass rate|slow tests|manual vs auto|re-run|zephyr|jenkins)/i.test(title)) return 'quality';
    if (/(component owner|knowledge|cross-team|team-level|dora|bug-induce|rework|mentorship|code-review|reviewer)/i.test(title)) return 'team';
    if (/(org-level|throughput|innovation|insights dashboards|knowledge centralization)/i.test(title)) return 'org';
    return 'daily';   // resolution split, sub-task, worklog, fix-version, PR metrics, doc coverage etc
  };
  const categorized = tiles.map(html => ({ html, cat: categorize(html) }));
  const counts = categorized.reduce((acc, t) => { acc[t.cat] = (acc[t.cat] || 0) + 1; return acc; }, {});
  const tabs = [
    { id: 'all',     label: 'Все',         count: categorized.length },
    { id: 'daily',   label: 'Ежедневно',   count: counts.daily   || 0 },
    { id: 'sprint',  label: 'Спринт',      count: counts.sprint  || 0 },
    { id: 'team',    label: 'Команда',     count: counts.team    || 0 },
    { id: 'org',     label: 'Организация', count: counts.org     || 0 },
    { id: 'quality', label: 'Качество',    count: counts.quality || 0 },
  ];
  const tabsHtml = tabs.filter(t => t.count > 0 || t.id === 'all').map(t =>
    `<button class="ts2-sd-tab-btn" data-sd-tab="${t.id}" type="button">${esc(t.label)} <span class="ts2-sd-tab-count">${t.count}</span></button>`
  ).join('');
  // Каждый tile получает data-sd-cat атрибут через post-processing inserted в первый <details>.
  const tilesHtml = categorized.map(({ html, cat }) =>
    html.replace(/^<details/, `<details data-sd-cat="${cat}"`)
  ).join('');
  return `
    <div class="ts2-sd-tabs-wrap">
      <div class="ts2-sd-tabs" role="tablist" aria-label="Категории метрик">${tabsHtml}</div>
      <div class="ts2-sd-block" data-sd-active-tab="all">${tilesHtml}</div>
    </div>
  `;
}

export { renderSleepingDataInsights, renderTile_componentLoad, _renderDependencySankey, _renderDeeperEmptyState };
