'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — BRIEF V3.0 EXPORT (2026-06-04)
   --
   Третья версия выгрузки. Основа — аудит 7 экспертов
   (см. docs/audits/brief-v3-plan-2026-06-04.md).

   Главное отличие от V2:
     • Risk badges в свёрнутой строке сотрудника (BLK/STL/WIP/DONE/CTX)
     • Status-dot слева от ФИО по classifyPerson
     • Data-quality pill в строке (LLM не ответил / Не сматчен)
     • Attention strip (top-3 «Кому помочь» из buildActionQueue)
     • KPI-полоса в шапке (Стоп/Блокеры/Burnout/Закрыто/Снимок)
     • Identity-banner если есть unmatched
     • Sort chips (По риску / По алфавиту / По активности)
     • Filter chips (Все / Стоп / Watch / Idle)
     • Блокеры — отдельный блок в верху раскрывашки до narrative
     • Deterministic fallback вместо «Сводка недоступна»
     • Кнопки «Скопировать как Markdown»
     • Print CSS (@media print)
     • Заметка тимлида (contenteditable, localStorage)

   Public API:
     exportTeamBriefV3(model, opts)
       opts:
         teamLabel: string
         assistantByKey: Map<personKey, html>
         llmStatusByKey: Map<personKey, 'ok'|'failed'|'skipped'>
         context: { history, prev, employees, userEmail, fetchedAtMs }
   ============================================================ */

import { renderEmployeeDetailPanel } from './teamScanner2Renderer.js';
import { classifyPerson } from './teamScanner2Classifier.js';
import {
  buildActionQueue,
  composeDailyBriefMarkdown,
  composePersonNarrative,
  composeNarrativeMarkdown,
} from './teamScanner2Insights.js';
import { emit as telemetryEmit } from './telemetry.js';

const SVG_STAR_PATH = 'M50 5 L58 35 L88 38 L65 58 L72 88 L50 72 L28 88 L35 58 L12 38 L42 35 Z';

/* ── Public ────────────────────────────────────────────────── */

export function exportTeamBriefV3(model, opts = {}) {
  if (!model || !Array.isArray(model.participants) || model.participants.length === 0) {
    throw new Error('Нет данных для выгрузки — сначала обновите Сканнер.');
  }
  const teamLabel = opts.teamLabel || (model.projectKeys || []).join(', ') || 'команда';
  const generatedAt = new Date();
  const assistantByKey = opts.assistantByKey instanceof Map ? opts.assistantByKey : new Map();
  const llmStatusByKey = opts.llmStatusByKey instanceof Map ? opts.llmStatusByKey : new Map();

  // ── Aggregate data for KPI + attention ──
  const ctx = _buildCtx(model, opts.context || {}, generatedAt);

  const headerHtml      = _buildHeader(model, teamLabel, generatedAt, ctx);
  const kpiHtml         = _buildKpiBand(model, ctx);
  const identityHtml    = _buildIdentityBanner(model, ctx);
  const attentionHtml   = _buildAttentionStrip(model, ctx);
  const toolbarHtml     = _buildSortFilterToolbar(ctx);
  const rosterHtml      = _buildRoster(model, ctx, assistantByKey, llmStatusByKey);

  const dailyMarkdown = composeDailyBriefMarkdown(model, opts.context?.history || []);
  const teamMdData = _b64(`# Бриф · ${teamLabel} · ${_dateStr(generatedAt)}\n\n${dailyMarkdown}`);

  const bodyHtml = `
    <div class="briefv3-shell ts2-root" data-sort="risk" data-filter="all">
      ${headerHtml}
      ${kpiHtml}
      ${identityHtml}
      ${attentionHtml}
      ${toolbarHtml}
      <main class="briefv3-main">
        <section class="briefv3-roster" aria-label="Сотрудники">
          ${rosterHtml}
        </section>
      </main>
      <footer class="briefv3-footer">
        Бриф v3.0 · Призма · ${_esc(teamLabel)} · ${_dateStr(generatedAt)}
      </footer>
    </div>
  `;

  const css = _ownCss();
  const documentHtml = _assembleHtmlDocument({
    title: `Бриф v3.0 · ${teamLabel} · ${_dateStr(generatedAt)}`,
    css,
    bodyHtml,
    inlineJs: _briefV3InlineJs(teamMdData),
  });
  const filename = `team-brief-v3-${_slug(teamLabel)}-${_dateStamp(generatedAt)}.html`;
  _downloadFile(documentHtml, filename);
  try {
    telemetryEmit('scanner2.brief_export_v3', {
      teamLabel,
      peopleCount: model.participants.length,
      sizeBytes: documentHtml.length,
      assistantCount: assistantByKey.size,
      llmFailedCount: Array.from(llmStatusByKey.values()).filter(s => s === 'failed').length,
    });
  } catch (_) {}
}

/* ── Aggregate ctx ────────────────────────────────────────── */

function _buildCtx(model, ctxIn, generatedAt) {
  const ctx = {
    fetchedAtMs: ctxIn.fetchedAtMs || model.fetchedAtMs || Date.now(),
    employees: ctxIn.employees || [],
    history: ctxIn.history || [],
    prev: ctxIn.prev || null,
  };

  // Counts по группам
  const counts = { stop: 0, watch: 0, moving: 0, idle: 0 };
  let totalBlockers = 0;
  let maxBlockerDwell = 0;
  let burnoutHigh = 0;
  let closedToday = 0;
  for (const p of model.participants) {
    counts[classifyPerson(p)]++;
    const blockers = p.blockers || [];
    totalBlockers += blockers.length;
    for (const b of blockers) maxBlockerDwell = Math.max(maxBlockerDwell, Number(b.dwellHours) || 0);
    if (p.personMetrics?.burnout?.level === 'high') burnoutHigh++;
    closedToday += _countClosedToday(p);
  }
  ctx.counts = counts;
  ctx.totalBlockers = totalBlockers;
  ctx.maxBlockerDwell = maxBlockerDwell;
  ctx.burnoutHigh = burnoutHigh;
  ctx.closedToday = closedToday;

  // Sprint confidence — берём первый спринт или sprintGoal
  const sg = model?.scannerV2?.sprintGoal;
  if (sg) {
    ctx.sprintConfidence = sg.aggregateProgress != null ? Math.round(sg.aggregateProgress) : null;
    ctx.sprintPace = sg.aggregatePace || 'no-data';
  }

  // Action queue (top-5, take 3 for strip)
  ctx.actionQueue = buildActionQueue(model);

  // Identity-resolve report
  const cov = model?.summary?.coverageReport || null;
  if (cov) {
    ctx.identityUnmatched = (cov.unmatched || []).length || cov.unmatchedRegistryCount || 0;
    ctx.identityBlocked = cov.blockedExcluded || 0;
  } else {
    ctx.identityUnmatched = (model.participants || []).filter(p => !p.jiraAccountId).length;
    ctx.identityBlocked = 0;
  }

  // Yesterday groups for diff arrows
  ctx.yesterdayGroups = {};
  if (ctx.prev && Array.isArray(ctx.prev.participants)) {
    for (const yp of ctx.prev.participants) {
      if (yp.key) ctx.yesterdayGroups[yp.key] = classifyPerson(yp);
    }
  } else if (ctx.history && Array.isArray(ctx.history)) {
    const yLast = ctx.history[ctx.history.length - 1];
    if (yLast?.personGroups) ctx.yesterdayGroups = yLast.personGroups;
  }

  ctx.generatedAt = generatedAt;
  return ctx;
}

function _countClosedToday(p) {
  let n = 0;
  for (const e of (p.timelineToday || [])) if (e?.kind === 'closed') n++;
  return n;
}

function _countClosedYesterday(p) {
  let n = 0;
  for (const e of (p.timelineYesterday || [])) if (e?.kind === 'closed') n++;
  return n;
}

/* ── Header ────────────────────────────────────────────────── */

function _buildHeader(model, teamLabel, generatedAt, ctx) {
  const dateStr = _dateStr(generatedAt);
  const ageMin = Math.round((Date.now() - ctx.fetchedAtMs) / 60_000);
  const ageLabel = ageMin < 60 ? `${ageMin}мин назад` : `${Math.round(ageMin / 60)}ч назад`;
  const peopleN = model.participants.length;
  return `
    <header class="briefv3-header">
      <div class="briefv3-brand">
        <svg class="briefv3-star" viewBox="0 0 100 100" aria-hidden="true">
          <path d="${SVG_STAR_PATH}" fill="currentColor"/>
        </svg>
        <div class="briefv3-brand-text">
          <span class="briefv3-brand-wordmark">ПРИЗМА</span>
          <span class="briefv3-brand-sub">Бриф v3.0</span>
        </div>
      </div>
      <div class="briefv3-titlewrap">
        <h1 class="briefv3-title">Бриф · ${_esc(teamLabel)}</h1>
        <div class="briefv3-meta">${_esc(dateStr)} · Снимок: ${ageLabel} · ${peopleN} ${_pluralPeople(peopleN)}</div>
      </div>
      <div class="briefv3-header-actions">
        <button class="briefv3-btn" id="briefv3-copy-team" type="button" title="Скопировать всю команду в Markdown">Копировать MD</button>
        <button class="briefv3-btn" id="briefv3-print" type="button" title="Печать">Печать</button>
        <button class="briefv3-btn" id="briefv3-theme-toggle" type="button" title="Переключить тему">Тема</button>
      </div>
    </header>`;
}

/* ── KPI band ──────────────────────────────────────────────── */

function _buildKpiBand(model, ctx) {
  const cells = [];

  if (ctx.sprintConfidence != null) {
    const pace = ctx.sprintPace;
    const tone = pace === 'behind' ? 'off-course' : pace === 'on-pace' ? 'on-course' : 'drift';
    const label = pace === 'behind' ? 'отстаём' : pace === 'on-pace' ? 'в плане' : 'дрейф';
    cells.push(_kpiCell('Курс спринта', `${ctx.sprintConfidence}% · ${label}`, tone));
  }

  if (ctx.counts.stop > 0) {
    cells.push(_kpiCell('Стоп', `${ctx.counts.stop} чел`, 'off-course'));
  }
  if (ctx.counts.watch > 0) {
    cells.push(_kpiCell('Наблюдают', `${ctx.counts.watch} чел`, 'drift'));
  }
  if (ctx.counts.moving > 0) {
    cells.push(_kpiCell('Движутся', `${ctx.counts.moving} чел`, 'on-course'));
  }
  if (ctx.counts.idle > 0) {
    cells.push(_kpiCell('Тихо', `${ctx.counts.idle} чел`, 'info'));
  }

  if (ctx.totalBlockers > 0) {
    const dwellLabel = ctx.maxBlockerDwell > 0 ? ` · макс ${Math.round(ctx.maxBlockerDwell)}ч` : '';
    cells.push(_kpiCell('Блокеры', `${ctx.totalBlockers}${dwellLabel}`, 'off-course'));
  }

  if (ctx.burnoutHigh > 0) {
    cells.push(_kpiCell('Burnout-high', `${ctx.burnoutHigh} чел`, 'off-course'));
  }

  if (ctx.closedToday > 0) {
    cells.push(_kpiCell('Закрыто сегодня', `${ctx.closedToday}`, 'on-course'));
  }

  if (!cells.length) return '';

  return `
    <section class="briefv3-kpi" aria-label="Состояние команды">
      ${cells.join('')}
    </section>`;
}

function _kpiCell(label, value, tone) {
  return `
    <div class="briefv3-kpi-cell briefv3-kpi-${tone}">
      <div class="briefv3-kpi-label">${_esc(label)}</div>
      <div class="briefv3-kpi-value">${_esc(value)}</div>
    </div>`;
}

/* ── Identity banner ────────────────────────────────────────── */

function _buildIdentityBanner(model, ctx) {
  const u = ctx.identityUnmatched || 0;
  const b = ctx.identityBlocked || 0;
  if (u === 0 && b === 0) return '';
  const parts = [];
  if (u > 0) parts.push(`${u} ${u === 1 ? 'сотрудник' : (u < 5 ? 'сотрудника' : 'сотрудников')} без jiraAccountId`);
  if (b > 0) parts.push(`${b} заблокирован${b === 1 ? '' : (b < 5 ? 'ы' : 'о')} в Jira`);
  return `
    <section class="briefv3-banner briefv3-banner-warn" role="alert">
      <span class="briefv3-banner-icon" aria-hidden="true">⚠</span>
      <span class="briefv3-banner-text">Внимание: ${parts.join(', ')} — не попали в бриф. Проверьте Реестр или identity-mapping.</span>
    </section>`;
}

/* ── Attention strip ───────────────────────────────────────── */

function _buildAttentionStrip(model, ctx) {
  const queue = (ctx.actionQueue || []).slice(0, 3);
  if (!queue.length) {
    return `
      <section class="briefv3-attention briefv3-attention-empty" aria-label="Кому помочь сегодня">
        <span class="briefv3-attention-empty-text">Команда в порядке — никому не требуется помощь сегодня.</span>
      </section>`;
  }
  const chips = queue.map(q => `
    <button class="briefv3-attention-chip" type="button" data-target="${_attr(q.key)}">
      <span class="briefv3-attention-name">${_esc(q.label)}</span>
      <span class="briefv3-attention-reason">${_esc(q.reason)}</span>
      <span class="briefv3-attention-action">${_esc(q.action)}</span>
    </button>`).join('');
  return `
    <section class="briefv3-attention" aria-label="Кому помочь сегодня">
      <div class="briefv3-attention-title">КОМУ ПОМОЧЬ СЕГОДНЯ</div>
      <div class="briefv3-attention-chips">${chips}</div>
    </section>`;
}

/* ── Sort + Filter toolbar ─────────────────────────────────── */

function _buildSortFilterToolbar(ctx) {
  const c = ctx.counts;
  return `
    <section class="briefv3-toolbar" aria-label="Сортировка и фильтр">
      <div class="briefv3-toolbar-group">
        <span class="briefv3-toolbar-label">Сортировка:</span>
        <button class="briefv3-chip briefv3-chip-sort is-active" data-sort="risk" type="button">По риску</button>
        <button class="briefv3-chip briefv3-chip-sort" data-sort="name" type="button">По алфавиту</button>
        <button class="briefv3-chip briefv3-chip-sort" data-sort="activity" type="button">По активности</button>
      </div>
      <div class="briefv3-toolbar-group">
        <span class="briefv3-toolbar-label">Фильтр:</span>
        <button class="briefv3-chip briefv3-chip-filter is-active" data-filter="all" type="button">Все</button>
        ${c.stop   > 0 ? `<button class="briefv3-chip briefv3-chip-filter briefv3-chip-stop"  data-filter="stop"  type="button">Стоп ${c.stop}</button>`     : ''}
        ${c.watch  > 0 ? `<button class="briefv3-chip briefv3-chip-filter briefv3-chip-watch" data-filter="watch" type="button">Наблюдают ${c.watch}</button>` : ''}
        ${c.moving > 0 ? `<button class="briefv3-chip briefv3-chip-filter briefv3-chip-moving" data-filter="moving" type="button">Движутся ${c.moving}</button>` : ''}
        ${c.idle   > 0 ? `<button class="briefv3-chip briefv3-chip-filter briefv3-chip-idle"  data-filter="idle"  type="button">Тихо ${c.idle}</button>`     : ''}
      </div>
    </section>`;
}

/* ── Roster ────────────────────────────────────────────────── */

function _buildRoster(model, ctx, assistantByKey, llmStatusByKey) {
  return model.participants.map(p =>
    _buildPersonBlock(p, model, ctx, assistantByKey.get(p.key), llmStatusByKey.get(p.key))
  ).join('');
}

function _buildPersonBlock(p, model, ctx, assistantHtml, llmStatus) {
  const group = classifyPerson(p);
  const name = _esc(p.label || p.key);
  const blockerCount = (p.blockers || []).length;
  const staleCount = (p.stale || []).length;
  const wipCount = (p.issuesNow || []).length;
  const doneCount = _countClosedToday(p) + _countClosedYesterday(p);
  const ctxCount = (p.contextSwitches?.distinctIssueKeys) || 0;
  const activityScore = (p.timeline72h || []).length;

  // Risk weight для sort by risk
  const riskWeight = blockerCount * 100 + staleCount * 10 + (wipCount >= 4 ? 5 : 0) + (group === 'stop' ? 1000 : group === 'watch' ? 200 : 0);

  // Diff arrow vs yesterday group
  let diffArrow = '';
  const ygroup = ctx.yesterdayGroups[p.key];
  if (ygroup && ygroup !== group) {
    if (group === 'stop' && ygroup !== 'stop') {
      diffArrow = `<span class="briefv3-row-diff briefv3-row-diff-bad" title="Был ${ygroup}, стал stop">→stop</span>`;
    } else if (group === 'moving' && (ygroup === 'stop' || ygroup === 'watch')) {
      diffArrow = `<span class="briefv3-row-diff briefv3-row-diff-good" title="Был ${ygroup}, разблокировался">→moving</span>`;
    } else if (group === 'watch' && ygroup === 'moving') {
      diffArrow = `<span class="briefv3-row-diff briefv3-row-diff-warn" title="Был moving, перешёл в watch">→watch</span>`;
    }
  }

  // Data-quality pill
  let dqPill = '';
  if (!p.jiraAccountId) {
    dqPill = `<span class="briefv3-row-dq briefv3-row-dq-warn" title="Не сматчен с Jira">Не сматчен</span>`;
  } else if (llmStatus === 'failed') {
    dqPill = `<span class="briefv3-row-dq briefv3-row-dq-warn" title="LLM не ответил, сгенерирован deterministic fallback">✕ LLM</span>`;
  } else if ((p.timeline72h || []).length === 0 && (p.badges?.commits48h || 0) === 0 && (p.badges?.pr48h || 0) === 0) {
    dqPill = `<span class="briefv3-row-dq briefv3-row-dq-neutral" title="Нет событий за 72ч ни из одной интеграции">Нет данных</span>`;
  }

  // Risk badges (только ненулевые)
  const badges = [];
  if (blockerCount > 0) badges.push(_riskBadge('BLK', blockerCount, 'off-course', `${blockerCount} блокер${blockerCount === 1 ? '' : (blockerCount < 5 ? 'а' : 'ов')}`));
  if (staleCount > 0) badges.push(_riskBadge('STL', staleCount, 'drift', `${staleCount} старых задач${staleCount === 1 ? 'а' : ''}`));
  if (wipCount > 0) {
    const tone = wipCount >= 4 ? 'drift' : 'info';
    badges.push(_riskBadge('WIP', wipCount, tone, `${wipCount} в работе${wipCount >= 4 ? ' (перегрузка)' : ''}`));
  }
  if (doneCount > 0) badges.push(_riskBadge('DONE', doneCount, 'on-course', `${doneCount} закрытых за 48ч`));
  if (ctxCount >= 5) badges.push(_riskBadge('CTX', ctxCount, 'info', `${ctxCount} переключений между задачами`));

  // Cross-team badge
  let crossTeamBadge = '';
  const crossTeam = model?.scannerV2?.crossTeamDeps?.[p.key];
  if (crossTeam && (crossTeam.incoming > 0 || crossTeam.outgoing > 0)) {
    const total = (crossTeam.incoming || 0) + (crossTeam.outgoing || 0);
    crossTeamBadge = `<span class="briefv3-row-cross" title="Зависимости с другими командами">ext·${total}</span>`;
  }

  // Detail content
  const blockersHtml = _buildBlockersBlock(p);
  const assistantBlock = _buildAssistantBlock(p, assistantHtml, llmStatus);
  const noteBlock = _buildNoteBlock(p);
  const eventsBlock = _buildEventsBlock(p, model);
  const heatmapBlock = _buildHeatmapBlock(p, model);

  return `
    <article class="briefv3-person briefv3-person-${group}"
             data-key="${_attr(p.key)}"
             data-group="${_attr(group)}"
             data-name="${_attr(p.label || p.key)}"
             data-risk="${riskWeight}"
             data-activity="${activityScore}">
      <div class="briefv3-row">
        <button class="briefv3-row-main" type="button" data-toggle aria-expanded="false">
          <span class="briefv3-row-dot briefv3-row-dot-${group}" title="${_groupTitle(group)}"></span>
          <span class="briefv3-row-name">${name}</span>
          ${diffArrow}
          ${dqPill}
          ${crossTeamBadge}
          <span class="briefv3-row-badges">${badges.join('')}</span>
          <span class="briefv3-row-chev" aria-hidden="true">▾</span>
        </button>
        <button class="briefv3-row-copy" type="button" data-copy-person="${_attr(p.key)}" title="Скопировать карточку в Markdown">MD</button>
      </div>
      <div class="briefv3-detail" hidden>
        ${blockersHtml}
        ${assistantBlock}
        ${noteBlock}
        ${eventsBlock}
        ${heatmapBlock}
      </div>
    </article>`;
}

function _riskBadge(label, value, tone, title) {
  return `<span class="briefv3-badge briefv3-badge-${tone}" title="${_attr(title)}"><span class="briefv3-badge-label">${_esc(label)}</span>·<span class="briefv3-badge-value">${value}</span></span>`;
}

function _groupTitle(g) {
  return { stop: 'Стоп', watch: 'Наблюдают', moving: 'Движутся', idle: 'Тихо' }[g] || g;
}

/* ── Detail blocks ─────────────────────────────────────────── */

function _buildBlockersBlock(p) {
  const blockers = p.blockers || [];
  if (!blockers.length) return '';
  // Sort by dwell/threshold ratio desc
  const sorted = [...blockers].sort((a, b) => {
    const aRatio = (a.dwellHours || 0) / Math.max(1, a.thresholdHours || 24);
    const bRatio = (b.dwellHours || 0) / Math.max(1, b.thresholdHours || 24);
    return bRatio - aRatio;
  });
  const items = sorted.map(b => {
    const dwell = Math.round(b.dwellHours || 0);
    const threshold = b.thresholdHours || 24;
    const ratio = dwell / Math.max(1, threshold);
    const tone = ratio >= 2 ? 'crit' : ratio >= 1.5 ? 'high' : 'warn';
    const priorityChip = b.priority ? `<span class="briefv3-blocker-priority">${_esc(b.priority)}</span>` : '';
    return `
      <li class="briefv3-blocker-item briefv3-blocker-${tone}">
        <div class="briefv3-blocker-head">
          <span class="briefv3-blocker-key">${_esc(b.key || '')}</span>
          <span class="briefv3-blocker-title">${_esc(b.summary || b.title || '')}</span>
          ${priorityChip}
        </div>
        <div class="briefv3-blocker-meta">
          застряло ${dwell}ч (порог ${threshold}ч, ×${ratio.toFixed(1)})
        </div>
      </li>`;
  }).join('');
  return `
    <section class="briefv3-section briefv3-blockers-section">
      <h3 class="briefv3-section-title briefv3-section-title-alert">
        Блокеры
        <span class="briefv3-section-hint">— Нужна помощь по ${blockers.length} ${blockers.length === 1 ? 'задаче' : (blockers.length < 5 ? 'задачам' : 'задачам')}</span>
      </h3>
      <ul class="briefv3-blockers-list">${items}</ul>
    </section>`;
}

function _buildAssistantBlock(p, assistantHtml, llmStatus) {
  if (llmStatus === 'ok' && assistantHtml) {
    return `
      <section class="briefv3-section briefv3-assistant">
        ${assistantHtml}
      </section>`;
  }
  // Fallback — deterministic summary
  const det = _buildDeterministicFallback(p);
  const warnText = llmStatus === 'failed'
    ? 'GigaChat не ответил — сводка собрана из событий'
    : 'AI-сводка не запрашивалась — показано фактологическое резюме';
  return `
    <section class="briefv3-section briefv3-assistant briefv3-assistant-fallback">
      <div class="briefv3-fallback-warn" title="${_attr(warnText)}">⚠ ${_esc(warnText)}</div>
      ${det}
    </section>`;
}

function _buildDeterministicFallback(p) {
  const closedY = _countClosedYesterday(p);
  const closedT = _countClosedToday(p);
  const loggedYh = Math.round(((p.loggedYesterdaySec || 0) / 3600) * 10) / 10;
  const loggedTh = Math.round(((p.loggedTodaySec || 0) / 3600) * 10) / 10;
  const commits = p.badges?.commits48h || 0;
  const prs = p.badges?.pr48h || 0;
  const yEvents = (p.timelineYesterday || []).length;
  const tEvents = (p.timelineToday || []).length;
  const issuesNow = (p.issuesNow || []).slice(0, 5).map(i => `${i.key} — ${i.summary || ''}`);

  const yesterdayLine = (closedY || loggedYh || yEvents || commits || prs)
    ? `Вчера: ${closedY > 0 ? `закрыл ${closedY}, ` : ''}залогировано ${loggedYh}ч, ${yEvents} событий, ${commits} коммитов, ${prs} PR.`
    : 'Вчера: следов работы не зафиксировано.';
  const todayLine = (closedT || loggedTh || tEvents)
    ? `Сегодня: ${closedT > 0 ? `закрыто ${closedT}, ` : ''}залогировано ${loggedTh}ч, ${tEvents} событий.`
    : 'Сегодня: пока без активности.';
  const wipLine = issuesNow.length
    ? `В работе: ${issuesNow.join('; ')}.`
    : '';

  return `
    <div class="briefv3-asst-72h">
      <section class="briefv3-asst-72h-section">
        <h3 class="briefv3-asst-72h-title">Что делал вчера <span class="briefv3-asst-72h-llm-tag">(rule-engine)</span></h3>
        <p>${_esc(yesterdayLine)}</p>
      </section>
      <section class="briefv3-asst-72h-section">
        <h3 class="briefv3-asst-72h-title">Что делает сегодня <span class="briefv3-asst-72h-llm-tag">(rule-engine)</span></h3>
        <p>${_esc(todayLine)}</p>
        ${wipLine ? `<p>${_esc(wipLine)}</p>` : ''}
      </section>
    </div>`;
}

function _buildNoteBlock(p) {
  const key = `briefv3.note.${p.key}`;
  return `
    <section class="briefv3-section briefv3-note-section">
      <h3 class="briefv3-section-title">Заметка тимлида</h3>
      <div class="briefv3-note" contenteditable="true" data-note-key="${_attr(key)}"
           placeholder="Темы для 1:1, решения с Daily…"></div>
    </section>`;
}

function _buildEventsBlock(p, model) {
  if (typeof DOMParser === 'undefined') return '';
  try {
    const full = renderEmployeeDetailPanel({ participants: [p], ...model, spaces: model?.spaces, scannerV2: model?.scannerV2 }, p.key, { filters: { j: true, b: true, c: true, zc: true, ze: true } });
    const doc = new DOMParser().parseFromString(`<!DOCTYPE html><body>${full}</body>`, 'text/html');
    const evs = doc.querySelector('.ts2-events-section');
    if (!evs) return '';
    evs.removeAttribute('open');
    evs.querySelectorAll('button, .ts2-narrative-copy').forEach(n => n.remove());
    return `<section class="briefv3-section briefv3-events">${evs.outerHTML}</section>`;
  } catch (_) { return ''; }
}

function _buildHeatmapBlock(p, model) {
  if (typeof DOMParser === 'undefined') return '';
  try {
    const full = renderEmployeeDetailPanel({ participants: [p], ...model, spaces: model?.spaces, scannerV2: model?.scannerV2 }, p.key, { filters: { j: true, b: true, c: true, zc: true, ze: true } });
    const doc = new DOMParser().parseFromString(`<!DOCTYPE html><body>${full}</body>`, 'text/html');
    const sections = Array.from(doc.querySelectorAll('.ts2-panel-section'));
    let heat = null;
    for (const s of sections) {
      const title = s.querySelector('.ts2-panel-section-title');
      if (title && /Heatmap/i.test(title.textContent || '')) { heat = s; break; }
    }
    if (!heat) return '';
    heat.querySelectorAll('button').forEach(n => n.remove());
    return `
      <section class="briefv3-section briefv3-heatmap">
        <h3 class="briefv3-section-title">Активность по источникам</h3>
        ${heat.outerHTML}
      </section>`;
  } catch (_) { return ''; }
}

/* ── Inline JS ─────────────────────────────────────────────── */

function _briefV3InlineJs(teamMdData) {
  return `
    (function(){
      'use strict';
      const root = document.querySelector('.briefv3-shell');
      if (!root) return;

      // ── Theme
      const htmlEl = document.documentElement;
      const THEME_KEY = 'briefv3.theme';
      try {
        const saved = localStorage.getItem(THEME_KEY);
        if (saved === 'light' || saved === 'dark') htmlEl.setAttribute('data-theme', saved);
      } catch (_) {}
      document.getElementById('briefv3-theme-toggle')?.addEventListener('click', function(){
        const cur = htmlEl.getAttribute('data-theme') || 'light';
        const next = cur === 'dark' ? 'light' : 'dark';
        htmlEl.setAttribute('data-theme', next);
        try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
      });

      // ── Print
      document.getElementById('briefv3-print')?.addEventListener('click', function(){
        // Раскрываем всё перед печатью
        document.querySelectorAll('.briefv3-detail').forEach(d => { d.hidden = false; });
        document.querySelectorAll('.briefv3-person').forEach(a => a.classList.add('is-open'));
        document.querySelectorAll('details').forEach(d => { d.open = true; });
        setTimeout(() => window.print(), 100);
      });

      // ── Person toggles + auto-collapse on dbl-click
      document.querySelectorAll('[data-toggle]').forEach(function(btn){
        btn.addEventListener('click', function(e){
          if (e.target.closest('[data-copy-person]')) return;
          const article = btn.closest('.briefv3-person');
          if (!article) return;
          const detail = article.querySelector('.briefv3-detail');
          if (!detail) return;
          const open = !detail.hidden;
          detail.hidden = open;
          btn.setAttribute('aria-expanded', String(!open));
          article.classList.toggle('is-open', !open);
        });
      });

      // ── Attention chips → scroll + open
      document.querySelectorAll('.briefv3-attention-chip').forEach(function(chip){
        chip.addEventListener('click', function(){
          const target = chip.getAttribute('data-target');
          if (!target) return;
          const article = document.querySelector('.briefv3-person[data-key="' + CSS.escape(target) + '"]');
          if (!article) return;
          // Open detail
          const detail = article.querySelector('.briefv3-detail');
          if (detail) { detail.hidden = false; article.classList.add('is-open'); article.querySelector('[data-toggle]')?.setAttribute('aria-expanded', 'true'); }
          article.scrollIntoView({ behavior: 'smooth', block: 'center' });
          article.classList.add('briefv3-person-highlight');
          setTimeout(() => article.classList.remove('briefv3-person-highlight'), 1500);
        });
      });

      // ── Sort chips
      const roster = document.querySelector('.briefv3-roster');
      function applySort(mode) {
        if (!roster) return;
        const persons = Array.from(roster.querySelectorAll('.briefv3-person'));
        persons.sort((a, b) => {
          if (mode === 'name') return (a.dataset.name || '').localeCompare(b.dataset.name || '');
          if (mode === 'activity') return (Number(b.dataset.activity) || 0) - (Number(a.dataset.activity) || 0);
          // risk default
          return (Number(b.dataset.risk) || 0) - (Number(a.dataset.risk) || 0);
        });
        for (const p of persons) roster.appendChild(p);
        root.dataset.sort = mode;
      }
      document.querySelectorAll('[data-sort]').forEach(function(chip){
        chip.addEventListener('click', function(){
          const mode = chip.getAttribute('data-sort');
          document.querySelectorAll('[data-sort]').forEach(c => c.classList.toggle('is-active', c === chip));
          applySort(mode);
        });
      });
      // initial sort
      applySort('risk');

      // ── Filter chips
      document.querySelectorAll('[data-filter]').forEach(function(chip){
        chip.addEventListener('click', function(){
          const f = chip.getAttribute('data-filter');
          document.querySelectorAll('[data-filter]').forEach(c => c.classList.toggle('is-active', c === chip));
          root.dataset.filter = f;
        });
      });

      // ── Note persistence
      document.querySelectorAll('[data-note-key]').forEach(function(note){
        const k = note.getAttribute('data-note-key');
        try {
          const saved = localStorage.getItem(k);
          if (saved) note.textContent = saved;
        } catch (_) {}
        // placeholder hack
        if (!note.textContent) note.classList.add('is-empty');
        note.addEventListener('input', function(){
          note.classList.toggle('is-empty', !note.textContent.trim());
          try { localStorage.setItem(k, note.textContent); } catch (_) {}
        });
        note.addEventListener('blur', function(){
          try { localStorage.setItem(k, note.textContent); } catch (_) {}
        });
      });

      // ── Markdown copy: whole team
      const teamMdData = ${JSON.stringify(teamMdData)};
      function decodeMd(b64) {
        try { return decodeURIComponent(escape(atob(b64))); } catch (_) { return atob(b64); }
      }
      document.getElementById('briefv3-copy-team')?.addEventListener('click', function(e){
        const md = decodeMd(teamMdData);
        const btn = e.currentTarget;
        copyToClipboard(md, btn, 'Скопировано');
      });

      // ── Markdown copy: per person
      document.querySelectorAll('[data-copy-person]').forEach(function(btn){
        btn.addEventListener('click', function(e){
          e.stopPropagation();
          const article = btn.closest('.briefv3-person');
          if (!article) return;
          const name = article.dataset.name || '';
          const key = article.dataset.key || '';
          // Собираем MD из detail-блока (текст без HTML)
          const blockersBlock = article.querySelector('.briefv3-blockers-section');
          const assistant = article.querySelector('.briefv3-assistant');
          const note = article.querySelector('[data-note-key]');
          const lines = ['# ' + name];
          if (blockersBlock) {
            lines.push('', '## Блокеры');
            article.querySelectorAll('.briefv3-blocker-item').forEach(li => {
              const k = li.querySelector('.briefv3-blocker-key')?.textContent || '';
              const t = li.querySelector('.briefv3-blocker-title')?.textContent || '';
              const m = li.querySelector('.briefv3-blocker-meta')?.textContent || '';
              lines.push('- **' + k + '** ' + t + ' (' + m.trim() + ')');
            });
          }
          if (assistant) {
            lines.push('', '## Сводка');
            const txt = (assistant.innerText || '').trim();
            if (txt) lines.push(txt);
          }
          if (note && note.textContent.trim()) {
            lines.push('', '## Комментарий руководителя');
            lines.push(note.textContent.trim());
          }
          copyToClipboard(lines.join('\\n'), btn, 'OK');
        });
      });

      function copyToClipboard(text, btn, okText) {
        const orig = btn.textContent;
        const ok = () => { btn.textContent = okText; setTimeout(() => { btn.textContent = orig; }, 1500); };
        const fail = () => { btn.textContent = 'Ошибка'; setTimeout(() => { btn.textContent = orig; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(ok, fail);
        } else {
          const ta = document.createElement('textarea');
          ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); ok(); } catch (_) { fail(); }
          document.body.removeChild(ta);
        }
      }
    })();
  `;
}

/* ── CSS ───────────────────────────────────────────────────── */

function _ownCss() {
  return `
    /* ── Brief V3.0 styles ─────────────────────────────────── */
    html, body {
      background: var(--prizma-bg, #f8f9fa);
      color: var(--prizma-text-primary, #1f2937);
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Inter', Segoe UI, Roboto, sans-serif;
      font-feature-settings: "tnum" 1, "lnum" 1;
      font-variant-numeric: tabular-nums lining-nums;
      -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
      margin: 0;
    }
    a { color: var(--prizma-information, #2A6FB3); }
    a:hover { text-decoration: underline; }

    .briefv3-shell { max-width: 1280px; margin: 0 auto; padding: 16px 28px 80px; }

    /* ── Header */
    .briefv3-header {
      display: flex; align-items: flex-start; gap: 16px; padding: 12px 0 16px;
      border-bottom: 1px solid var(--prizma-border, rgba(0,0,0,.08));
    }
    .briefv3-brand { display: flex; align-items: center; gap: 8px; color: var(--prizma-information, #2A6FB3); }
    .briefv3-star { width: 28px; height: 28px; flex: 0 0 28px; }
    .briefv3-brand-text { display: flex; flex-direction: column; line-height: 1.05; }
    .briefv3-brand-wordmark { font-weight: 800; letter-spacing: .12em; font-size: 11px; }
    .briefv3-brand-sub { font-size: 10px; opacity: .65; letter-spacing: .04em; }
    .briefv3-titlewrap { flex: 1; }
    .briefv3-title { margin: 0; font-size: 22px; font-weight: 700; color: var(--prizma-text-primary, #111); }
    .briefv3-meta { margin-top: 4px; font-size: 12px; color: var(--prizma-text-secondary, #6b7280); }
    .briefv3-header-actions { display: flex; gap: 6px; }
    .briefv3-btn {
      padding: 6px 12px; border: 1px solid var(--prizma-border, rgba(0,0,0,.12));
      background: transparent; border-radius: 6px; cursor: pointer; font-size: 12px; color: inherit;
      font-weight: 500;
    }
    .briefv3-btn:hover { background: var(--prizma-bg-tertiary, rgba(0,0,0,.04)); }

    /* ── KPI band */
    .briefv3-kpi {
      display: flex; flex-wrap: wrap; gap: 10px;
      padding: 12px 0; margin: 0 0 14px;
      border-bottom: 1px dashed var(--prizma-border, rgba(0,0,0,.08));
    }
    .briefv3-kpi-cell {
      display: flex; flex-direction: column; gap: 2px;
      padding: 8px 14px; border-radius: 8px;
      background: var(--prizma-bg-elevated, #fff);
      border-left: 3px solid var(--prizma-drift, #F59E0B);
      min-width: 130px;
    }
    .briefv3-kpi-on-course   { border-left-color: var(--prizma-on-course, #2C8C5F); }
    .briefv3-kpi-off-course  { border-left-color: var(--prizma-off-course, #C13838); }
    .briefv3-kpi-drift       { border-left-color: var(--prizma-drift, #F59E0B); }
    .briefv3-kpi-info        { border-left-color: var(--prizma-information, #2A6FB3); }
    .briefv3-kpi-label { font-size: 10px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: var(--prizma-text-secondary, #6b7280); }
    .briefv3-kpi-value { font-size: 15px; font-weight: 700; color: var(--prizma-text-primary, #111); }

    /* ── Identity banner */
    .briefv3-banner {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px; border-radius: 8px; margin: 0 0 14px;
      border-left: 3px solid var(--prizma-drift, #F59E0B);
      background: var(--prizma-drift-bg, rgba(245,158,11,.08));
    }
    .briefv3-banner-warn { color: var(--prizma-drift, #B17609); }
    .briefv3-banner-icon { font-size: 16px; }
    .briefv3-banner-text { font-size: 13px; font-weight: 500; color: var(--prizma-text-primary, #111); }

    /* ── Attention strip */
    .briefv3-attention { margin: 0 0 14px; }
    .briefv3-attention-empty { padding: 8px 0; color: var(--prizma-text-secondary, #6b7280); font-size: 12px; font-style: italic; }
    .briefv3-attention-title {
      font-size: 10px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase;
      color: var(--prizma-text-secondary, #6b7280); margin-bottom: 6px;
    }
    .briefv3-attention-chips { display: flex; flex-wrap: wrap; gap: 10px; }
    .briefv3-attention-chip {
      display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
      padding: 10px 14px; min-width: 220px; max-width: 360px; flex: 1;
      border: 0; cursor: pointer; text-align: left;
      border-left: 3px solid var(--prizma-off-course, #C13838);
      background: var(--prizma-bg-elevated, #fff);
      border-radius: 0 8px 8px 0;
      color: inherit; font-family: inherit;
    }
    .briefv3-attention-chip:hover { background: var(--prizma-bg-tertiary, rgba(0,0,0,.04)); }
    .briefv3-attention-name { font-size: 13px; font-weight: 700; color: var(--prizma-text-primary, #111); }
    .briefv3-attention-reason { font-size: 12px; color: var(--prizma-text-secondary, #6b7280); }
    .briefv3-attention-action { font-size: 11px; color: var(--prizma-information, #2A6FB3); font-weight: 500; }

    /* ── Toolbar */
    .briefv3-toolbar {
      position: sticky; top: 0; z-index: 5;
      display: flex; flex-wrap: wrap; gap: 16px; align-items: center;
      padding: 10px 0 12px; margin: 0 0 14px;
      background: var(--prizma-bg, #f8f9fa);
      border-bottom: 1px solid var(--prizma-border, rgba(0,0,0,.08));
    }
    .briefv3-toolbar-group { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .briefv3-toolbar-label { font-size: 11px; font-weight: 700; color: var(--prizma-text-secondary, #6b7280); margin-right: 4px; }
    .briefv3-chip {
      padding: 4px 10px; border: 1px solid var(--prizma-border, rgba(0,0,0,.12));
      background: transparent; border-radius: 14px; cursor: pointer; font-size: 12px;
      color: inherit; font-weight: 500; font-family: inherit;
    }
    .briefv3-chip:hover { background: var(--prizma-bg-tertiary, rgba(0,0,0,.04)); }
    .briefv3-chip.is-active { background: var(--prizma-information, #2A6FB3); color: white; border-color: var(--prizma-information, #2A6FB3); }
    .briefv3-chip-stop.is-active   { background: var(--prizma-off-course, #C13838); border-color: var(--prizma-off-course, #C13838); }
    .briefv3-chip-watch.is-active  { background: var(--prizma-drift, #F59E0B);     border-color: var(--prizma-drift, #F59E0B); }
    .briefv3-chip-moving.is-active { background: var(--prizma-on-course, #2C8C5F); border-color: var(--prizma-on-course, #2C8C5F); }

    /* ── Roster + Person row */
    .briefv3-roster { display: flex; flex-direction: column; gap: 4px; }
    .briefv3-person {
      border: 1px solid var(--prizma-border, rgba(0,0,0,.08));
      border-radius: 8px; overflow: hidden;
      background: var(--prizma-bg-elevated, #fff);
      transition: box-shadow .15s;
    }
    .briefv3-person.briefv3-person-highlight {
      box-shadow: 0 0 0 3px var(--prizma-information, rgba(42,111,179,.4));
    }
    .briefv3-shell[data-filter="stop"]   .briefv3-person:not([data-group="stop"])   { display: none; }
    .briefv3-shell[data-filter="watch"]  .briefv3-person:not([data-group="watch"])  { display: none; }
    .briefv3-shell[data-filter="moving"] .briefv3-person:not([data-group="moving"]) { display: none; }
    .briefv3-shell[data-filter="idle"]   .briefv3-person:not([data-group="idle"])   { display: none; }

    .briefv3-row { display: flex; align-items: stretch; }
    .briefv3-row-main {
      flex: 1; display: flex; align-items: center; gap: 8px;
      padding: 10px 14px 10px 0; border: 0; background: transparent; cursor: pointer;
      text-align: left; color: inherit; font-family: inherit; font-size: 13px;
      position: relative;
    }
    .briefv3-row-main:hover { background: var(--prizma-bg-tertiary, rgba(0,0,0,.03)); }
    .briefv3-row-dot {
      width: 4px; align-self: stretch; flex: 0 0 4px;
      background: var(--prizma-text-tertiary, #cbd5e1);
    }
    .briefv3-row-dot-stop   { background: var(--prizma-off-course, #C13838); }
    .briefv3-row-dot-watch  { background: var(--prizma-drift,     #F59E0B); }
    .briefv3-row-dot-moving { background: var(--prizma-on-course, #2C8C5F); }
    .briefv3-row-dot-idle   { background: var(--prizma-text-tertiary, #94a3b8); }
    .briefv3-row-name { font-weight: 600; color: var(--prizma-text-primary, #111); margin-left: 6px; }
    .briefv3-row-badges { display: inline-flex; gap: 4px; margin-left: auto; }
    .briefv3-badge {
      display: inline-flex; align-items: center; gap: 2px;
      padding: 2px 6px; border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 10px; font-weight: 700;
      background: var(--prizma-bg-tertiary, rgba(0,0,0,.05));
      color: var(--prizma-text-secondary, #6b7280);
      letter-spacing: .3px;
    }
    .briefv3-badge-off-course { background: var(--prizma-off-course-bg, rgba(193,56,56,.12)); color: var(--prizma-off-course, #B12A2A); }
    .briefv3-badge-drift      { background: var(--prizma-drift-bg, rgba(245,158,11,.12));     color: var(--prizma-drift, #B17609); }
    .briefv3-badge-on-course  { background: var(--prizma-on-course-bg, rgba(44,140,95,.12));  color: var(--prizma-on-course, #1F6B49); }
    .briefv3-badge-info       { background: var(--prizma-information-bg, rgba(42,111,179,.10));color: var(--prizma-information, #2A6FB3); }
    .briefv3-badge-label { font-size: 9px; opacity: .85; }
    .briefv3-badge-value { font-weight: 700; }

    .briefv3-row-diff {
      font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px;
      letter-spacing: .3px;
    }
    .briefv3-row-diff-bad  { background: var(--prizma-off-course-bg, rgba(193,56,56,.12)); color: var(--prizma-off-course, #B12A2A); }
    .briefv3-row-diff-good { background: var(--prizma-on-course-bg, rgba(44,140,95,.12)); color: var(--prizma-on-course, #1F6B49); }
    .briefv3-row-diff-warn { background: var(--prizma-drift-bg, rgba(245,158,11,.12)); color: var(--prizma-drift, #B17609); }

    .briefv3-row-dq {
      font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px;
      background: var(--prizma-bg-tertiary, rgba(0,0,0,.05));
      color: var(--prizma-text-secondary, #6b7280);
    }
    .briefv3-row-dq-warn { background: var(--prizma-drift-bg, rgba(245,158,11,.12)); color: var(--prizma-drift, #B17609); }
    .briefv3-row-dq-neutral { color: var(--prizma-text-tertiary, #94a3b8); }

    .briefv3-row-cross {
      font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px;
      background: var(--prizma-insight-bg, rgba(176,132,204,.12));
      color: var(--prizma-insight, #8B5FB0);
    }

    .briefv3-row-chev {
      color: var(--prizma-text-tertiary, #94a3b8); padding-left: 6px;
      transition: transform .15s;
    }
    .briefv3-person.is-open .briefv3-row-chev { transform: rotate(180deg); }

    .briefv3-row-copy {
      padding: 0 10px; border: 0; border-left: 1px solid var(--prizma-border, rgba(0,0,0,.06));
      background: transparent; cursor: pointer; font-size: 10px; font-weight: 700;
      color: var(--prizma-text-secondary, #6b7280); font-family: ui-monospace, monospace;
      opacity: 0; transition: opacity .15s;
    }
    .briefv3-person:hover .briefv3-row-copy { opacity: 1; }
    .briefv3-row-copy:hover { background: var(--prizma-bg-tertiary, rgba(0,0,0,.04)); color: var(--prizma-text-primary); }

    /* ── Detail */
    .briefv3-detail {
      padding: 12px 18px 18px;
      border-top: 1px solid var(--prizma-border, rgba(0,0,0,.06));
      display: flex; flex-direction: column; gap: 16px;
    }
    .briefv3-detail[hidden] { display: none; }

    .briefv3-section { display: flex; flex-direction: column; gap: 6px; }
    .briefv3-section-title {
      font-size: 11px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase;
      color: var(--prizma-text-secondary, #6b7280); margin: 0;
      display: flex; align-items: baseline; gap: 6px;
    }
    .briefv3-section-title-alert { color: var(--prizma-off-course, #B12A2A); }
    .briefv3-section-hint { font-size: 10px; font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--prizma-text-tertiary); }

    /* Blockers */
    .briefv3-blockers-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
    .briefv3-blocker-item {
      padding: 8px 12px; border-radius: 6px;
      border-left: 3px solid var(--prizma-drift, #F59E0B);
      background: var(--prizma-drift-bg, rgba(245,158,11,.06));
    }
    .briefv3-blocker-warn { border-left-color: var(--prizma-drift, #F59E0B); }
    .briefv3-blocker-high { border-left-color: #E07B00; background: rgba(224,123,0,.08); }
    .briefv3-blocker-crit { border-left-color: var(--prizma-off-course, #C13838); background: var(--prizma-off-course-bg, rgba(193,56,56,.08)); }
    .briefv3-blocker-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .briefv3-blocker-key { font-family: ui-monospace, monospace; font-weight: 700; font-size: 12px; color: var(--prizma-information, #2A6FB3); }
    .briefv3-blocker-title { font-size: 13px; color: var(--prizma-text-primary, #111); flex: 1; }
    .briefv3-blocker-priority { font-size: 10px; font-weight: 600; padding: 1px 5px; border-radius: 4px; background: var(--prizma-bg-tertiary, rgba(0,0,0,.05)); color: var(--prizma-text-secondary, #6b7280); text-transform: uppercase; }
    .briefv3-blocker-meta { font-size: 11px; color: var(--prizma-text-secondary, #6b7280); padding-top: 2px; font-family: ui-monospace, monospace; }

    /* Fallback banner */
    .briefv3-fallback-warn {
      font-size: 11px; color: var(--prizma-drift, #B17609);
      padding: 4px 0; font-weight: 500;
    }

    /* Note */
    .briefv3-note {
      min-height: 50px; padding: 10px 12px; border-radius: 6px;
      background: var(--prizma-bg-tertiary, rgba(0,0,0,.03));
      border: 1px dashed var(--prizma-border, rgba(0,0,0,.12));
      font-size: 13px; color: var(--prizma-text-primary, #111);
      cursor: text;
    }
    .briefv3-note:focus { outline: none; border-color: var(--prizma-information, #2A6FB3); }
    .briefv3-note.is-empty::before {
      content: attr(placeholder);
      color: var(--prizma-text-tertiary, #94a3b8); font-style: italic;
    }

    /* Footer */
    .briefv3-footer {
      margin-top: 30px; padding-top: 14px;
      border-top: 1px solid var(--prizma-border, rgba(0,0,0,.08));
      font-size: 11px; color: var(--prizma-text-tertiary, #94a3b8); text-align: center;
    }

    /* Print */
    @media print {
      .briefv3-shell { max-width: none !important; padding: 0 !important; }
      .briefv3-header-actions, .briefv3-toolbar, .briefv3-row-copy, .briefv3-row-chev { display: none !important; }
      .briefv3-attention { page-break-after: avoid; }
      .briefv3-person { page-break-inside: avoid; break-inside: avoid; border: 1px solid #ccc !important; margin-bottom: 8px; }
      .briefv3-detail { display: flex !important; }
      .briefv3-detail[hidden] { display: flex !important; }
      details { display: block !important; }
      details > summary { list-style: none !important; }
      details > summary::-webkit-details-marker { display: none !important; }
      details > summary::after, details > summary::before { content: '' !important; }
      [data-theme] { color-scheme: light !important; }
      html, body, .briefv3-shell { background: white !important; color: black !important; }
      .briefv3-kpi-cell, .briefv3-banner, .briefv3-attention-chip, .briefv3-person, .briefv3-blocker-item, .briefv3-note { background: white !important; }
      .briefv3-row-name, .briefv3-blocker-title { color: black !important; }
      @page { margin: 16mm 14mm; }
    }
  `;
}

/* ── Misc helpers ──────────────────────────────────────────── */

function _assembleHtmlDocument({ title, css, bodyHtml, inlineJs }) {
  const initialTheme = (() => {
    try {
      const t = (typeof document !== 'undefined') && document.documentElement.getAttribute('data-theme');
      return (t === 'dark' || t === 'light') ? t : 'light';
    } catch (_) { return 'light'; }
  })();
  return `<!DOCTYPE html>
<html lang="ru" data-theme="${initialTheme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${_esc(title)}</title>
<style>
${css}
</style>
</head>
<body>
${bodyHtml}
<script>
${inlineJs}
</script>
</body>
</html>
`;
}

function _downloadFile(html, filename) {
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _attr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function _b64(s) {
  try {
    return btoa(unescape(encodeURIComponent(String(s || ''))));
  } catch (_) { return ''; }
}

function _dateStr(d) {
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function _dateStamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function _slug(s) {
  return String(s || 'team').toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'team';
}

function _pluralPeople(n) {
  const t = n % 10, h = n % 100;
  if (t === 1 && h !== 11) return 'сотрудник';
  if (t >= 2 && t <= 4 && (h < 12 || h > 14)) return 'сотрудника';
  return 'сотрудников';
}
