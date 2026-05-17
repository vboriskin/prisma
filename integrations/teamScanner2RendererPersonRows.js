'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — RENDERER (PERSON ROWS)
   Extracted 2026-05-12 — Tier 0 Renderer split phase 4.

   ~280 LOC:
     · renderPersonRows — group dispatch (stop/watch/moving/idle)
     · renderRow — single person row
     · SRC_LABELS / SRC_NAMES / SRC_KEYS — constants (also used by Panel)

   Render-context (via ctx param) — no module-level state.
   ============================================================ */

import { Icons } from '../app/icons.js';
import {
  esc, plural, fmtDuration, fmtHours,
  bucketByHour, dotStrip, emptyDayLanguage,
} from './teamScanner2RendererCommon.js';
import { classifyPerson } from './teamScanner2Classifier.js';
import { buildYesterdayGroupMap } from './teamScanner2Insights.js';

// V18.3 A2 — Zephyr split на Created (Zc) и Executed (Ze).
// Pilot finding (Ilia QA): семантически разные — план vs прогон.
export const SRC_LABELS = ['J',    'B',         'C',          'Zc',             'Ze'];
export const SRC_NAMES  = ['Jira', 'Bitbucket', 'Confluence', 'Zephyr-планы',   'Zephyr-прогоны'];
export const SRC_KEYS   = ['j',    'b',         'c',          'zc',             'ze'];

/** V18.1 P7-S3.2 / V22 (2026-05-09) — HR-language: «Стоп» → «Требует разговора»
 *  → «Требует внимания» (operational signal, без HR-конотации). Person-row тип
 *  stop остаётся в classify; меняется только presentational layer.
 *  2026-05-12 — перенесён сюда из main renderer'а (Phase 4 follow-up,
 *  иначе renderGroup получает ReferenceError в браузере). */
const GROUP_META = {
  stop:   { label: 'Требует внимания', desc: 'Висят без движения — нужен разговор сегодня' },
  watch:  { label: 'Под наблюдением',   desc: 'Триггеры: перегрузка, тишина или старое тянется' },
  moving: { label: 'Движется',          desc: 'Есть активность сегодня, без красных флагов' },
  idle:   { label: 'Без активности',     desc: 'Нет следов в Jira / BB / CF' },
};

export function renderPersonRows(model, ctx = {}) {
  const parts = model?.participants || [];
  if (!parts.length) {
    return `<div class="ts2-empty">Нет данных по участникам за выбранные проекты.</div>`;
  }
  // 2026-05-11 — Small-team / all-idle banner. Edge cases:
  // · team < 5 → progress bars выглядят нелепо ("67% на 3 из 5"), warn user
  // · все idle → возможно команда в отпуске или данные не пришли
  let smallTeamBanner = '';
  if (parts.length < 5) {
    smallTeamBanner = `<div class="ts2-team-edge-banner ts2-team-edge-small" role="note">
      ${Icons.get('info', { cls: 'btn-icon', size: 12 })}
      <strong>Маленькая команда (${parts.length} ${plural(parts.length, ['человек', 'человека', 'человек'])})</strong> — метрики могут быть статистически нестабильны.
      Aggregate (% / средние) интерпретируйте с осторожностью.
    </div>`;
  }
  const idleCount = parts.filter(pp => classifyPerson(pp) === 'idle').length;
  if (idleCount === parts.length && parts.length > 0) {
    smallTeamBanner += `<div class="ts2-team-edge-banner ts2-team-edge-idle" role="note">
      ${Icons.get('alert-triangle', { cls: 'btn-icon', size: 12 })}
      <strong>Вся команда в idle</strong> — проверьте: (а) команда в отпуске? (б) интеграции живые? Откройте Диагностику.
    </div>`;
  }
  // V20 S12 I3 — yesterday's per-person group для diff-badge на row.
  // Возвращает Map<personKey, group>. Если у нас нет prev snapshot или
  // в нём не сохранены personGroups — Map пустой, badge не рендерим.
  const yesterdayGroups = buildYesterdayGroupMap(ctx.prev);
  // V18.1 P2 — group by classifyPerson. Внутри группы сортируем по
  // timelineToday desc, потом yesterday desc.
  const groups = { stop: [], watch: [], moving: [], idle: [] };
  for (const p of parts) groups[classifyPerson(p)].push(p);
  const sortFn = (a, b) => {
    const aT = (a.timelineToday    || []).length;
    const bT = (b.timelineToday    || []).length;
    if (aT !== bT) return bT - aT;
    return (b.timelineYesterday || []).length - (a.timelineYesterday || []).length;
  };
  groups.stop.sort(sortFn);
  groups.watch.sort(sortFn);
  groups.moving.sort(sortFn);
  groups.idle.sort(sortFn);
  // V20 S8 #3 — Triage-pill для большой stop-группы. Пилот feedback:
  // «79 строк без приоритизации = тимлид теряется». Сортируем stop по
  // максимальному dwellHours (чем дольше висит — тем выше). Топ-3
  // отображаются как pill-row перед списком.
  const stopTriage = groups.stop
    .filter(p => (p.blockers || []).some(b => Number(b.dwellHours) > 0))
    .map(p => ({
      p,
      maxDwell: Math.max(0, ...(p.blockers || []).map(b => Number(b.dwellHours) || 0)),
    }))
    .sort((a, b) => b.maxDwell - a.maxDwell)
    .slice(0, 3);

  const expandedKey = ctx.expandedKey || '';
  // V20 S7 A2 — pass v2 metrics-maps (для chip'ов в row).
  // 2026-05-11 — добавлены team-medians для per-person comparison tooltips.
  // Helps тимлид сразу видеть «Федя в 1.5× от среднего по WIP».
  const _median = (arr) => {
    if (!arr.length) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = sorted.length >>> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const _wipArr = parts.map(pp => (pp.issuesNow || []).length).filter(Number.isFinite);
  const _prArr  = parts.map(pp => pp.badges?.pr48h || 0);
  const _hrArr  = parts.map(pp => Number(pp.hoursLoggedToday || 0));
  const teamMedians = {
    wip: _median(_wipArr),
    pr:  _median(_prArr),
    hours: _median(_hrArr),
  };
  const metricsMaps = {
    crv: model?.scannerV2?.codeReviewVelocity || {},
    prT: model?.scannerV2?.prThroughput || {},
    teamMedians,
  };
  // V20 S8 #3 + S8.5 #6 — триаж-pill теперь срабатывает по count ≥ 5 OR maxDwell ≥ 48ч.
  // Pилот feedback: «4 stop с одним 96ч — pill спрячется, пропущу самый болезненный кейс».
  const maxAnyDwell = Math.max(0, ...stopTriage.map(t => t.maxDwell));
  const showTriage = stopTriage.length > 0 && (groups.stop.length >= 5 || maxAnyDwell >= 48);
  // V21 — блок «Топ N в Стопе сегодня» удалён по запросу пользователя.
  // Stop-группа уже первая в renderGroup-порядке + ▌Nh dwell-badge на row,
  // pill дублировал. (Раньше: showTriage → triagePillHtml; код удалён.)
  const triagePillHtml = '';
  const renderGroup = (key) => {
    const arr = groups[key];
    if (!arr.length) return '';
    const meta = GROUP_META[key];
    const rows = arr.map(p => renderRow(p, expandedKey === p.key, metricsMaps, yesterdayGroups, key)).join('');
    const head = `
      <div class="ts2-group-head">
        <span class="ts2-group-label">${esc(meta.label)}</span>
        <span class="ts2-group-count" title="${esc(meta.desc)}">${arr.length}</span>
      </div>`;
    if (key === 'idle') {
      // Сворачиваемая, по умолчанию закрыта — снимает шум с главного экрана.
      return `
        <details class="ts2-group ts2-group-${key}" data-group-anchor="${key}">
          <summary class="ts2-group-summary">${head}</summary>
          <div class="ts2-rows-inner">${rows}</div>
        </details>`;
    }
    return `
      <div class="ts2-group ts2-group-${key}" data-group-anchor="${key}">
        ${head}
        <div class="ts2-rows-inner">${rows}</div>
      </div>`;
  };

  // Порядок групп = приоритет внимания тимлида утром.
  return `
    <div class="ts2-rows">
      ${smallTeamBanner}
      ${triagePillHtml}
      ${renderGroup('stop')}
      ${renderGroup('watch')}
      ${renderGroup('moving')}
      ${renderGroup('idle')}
    </div>
  `;
}

function renderRow(p, isExpanded, metricsMaps = {}, yesterdayGroups, currentGroup) {
  // 2026-05-11 — fallback на zeroes если teamMedians не передан (бэк-compat).
  const tm = metricsMaps.teamMedians || { wip: 0, pr: 0, hours: 0 };
  const hToday = bucketByHour(p.timelineToday);
  const hYest  = bucketByHour(p.timelineYesterday);
  const todayN = (p.timelineToday    || []).length;
  const yestN  = (p.timelineYesterday || []).length;
  // V18.1 P7-S3.2 — убираем red ▌ stripe слева от имени (HR panel:
  // «дублирует функцию dwellBadge ▌Nh справа, один из двух уберите»).
  // Оставляем spacer для grid-выравнивания. Stop-сигнал идёт через
  // принадлежность к группе «Требует разговора» с red stripe-left
  // на уровне группы — это уже сильный визуальный маркер.
  const blockerMark = `<span class="ts2-blocker-spacer"></span>`;

  const todayBlock = todayN > 0
    ? dotStrip(hToday, `Сегодня: ${todayN} событий`)
    : `<span class="ts2-strip-empty">${esc(emptyDayLanguage(p, 'today'))}</span>`;

  const yestBlock = yestN > 0
    ? dotStrip(hYest,  `Вчера: ${yestN} событий`)
    : `<span class="ts2-strip-empty ts2-strip-empty-y">—</span>`;

  const prsCount    = (p.badges?.pr48h || 0);
  // V18.1 P3 — distinct issue keys из enrichment вместо ручного Set'а.
  // Fallback на P1-логику если enrichment не запущен (defensive).
  const tasksTouchN = (p.contextSwitches?.distinctIssueKeys ?? new Set([
    ...(p.timelineToday || []),
    ...(p.timelineYesterday || []),
  ].map(e => e?.issue?.key).filter(Boolean)).size);
  const hoursToday  = fmtHours(p.loggedTodaySec || 0);
  // V18.1 P7-S4.3 — WIP counter (issuesNow). Manager + Anna + Dmitry
  // pilot finding: «Команды равномерно загружены? — не закрыто. WIP-counter
  // в classifier работает (≥3 → watch), но числом не показан».
  // ≥3 → подсвечиваем amber (overcommit signal).
  const wipN  = (p.issuesNow || []).length;
  const wipCls = wipN >= 4 ? 'ts2-counter ts2-counter-warn' : (wipN >= 3 ? 'ts2-counter ts2-counter-amber' : 'ts2-counter');
  // V18.1 P7-S4.5 — B/C/Z source-indicators в row (inline после имени).
  // Pilot finding (Vasiliy + Elena consensus): «multi-source signal должен
  // быть в строке, а не только в side-panel — heatmap 72×4 хорош, но это
  // «уровень 3», а решение принимается на «уровне 2»».
  // Counts из p.bbItems / cfItems / zephyr — все за 72ч окно.
  const bbN = (p.bbItems || []).length;
  const cfN = (p.cfItems || []).length;
  const zN  = ((p.zephyrTestsCreatedRecent || []).length
            + (p.zephyrTestsExecutedRecent || []).length);
  // Phase-2 Jenkins (2026-05-10) — J<N> чип отдельным source-indicator'ом.
  // jenkinsBuilds48h приходит из identity-attribution (teamScanner2.js
  // jenkins_attach block ~L1232). Title указывает 48ч окно, не 72ч —
  // это Jenkins-specific (короче чем у BB/CF/Z) потому что builds
  // обычно daily, более частая каденция.
  const jN  = p.jenkinsBuilds48h || 0;
  // 2026-05-11 — Jenkins error indicator. Если jenkins fetch упал (timeout,
  // 5xx, SSO redirect) — рендерим J⚠ чип независимо от counts, чтобы тимлид
  // сразу видел «Jenkins недоступен», а не misleading 0 builds. Источник —
  // p.jenkinsError, который teamScanner2.js jenkins_attach copies из
  // jenkinsData.error в каждый participant (renderRow не получает model).
  const jErr = p?.jenkinsError ? String(p.jenkinsError) : '';
  // Sprint B (Birman) — улучшенный tooltip с расшифровкой однобуквенных src
  const SRC_FULL = { b: 'Bitbucket: коммиты / PR / комментарии', c: 'Confluence: правки страниц', z: 'Zephyr: тесты / прогоны', j: 'Jenkins: сборки' };
  const srcChip = (label, n, cls, titleOverride) => n > 0
    ? `<span class="ts2-row-src-chip ts2-row-src-${cls}" title="${titleOverride || `${SRC_FULL[cls] || label} за 72ч: ${n} событий`}"><span class="ts2-row-src-chip-key">${cls.toUpperCase()}</span><span class="ts2-row-src-chip-num">${n}</span></span>`
    : '';
  const jChipRow = jErr
    ? `<span class="ts2-row-src-chip ts2-row-src-j ts2-row-src-warn" title="Jenkins недоступен: ${esc(jErr)}"><span class="ts2-row-src-chip-key">J</span><span class="ts2-row-src-chip-num" aria-label="недоступен">${Icons.get('alert-triangle', { cls: 'btn-icon', size: 10 })}</span></span>`
    : srcChip('Jenkins', jN, 'j', `Jenkins билдов за 48ч: ${jN}${p.jenkinsFailures48h ? ` · failures: ${p.jenkinsFailures48h}` : ''}`);
  const srcChips = (bbN || cfN || zN || jN || jErr)
    ? `<span class="ts2-row-src-chips">${srcChip('Bitbucket', bbN, 'b')}${srcChip('Confluence', cfN, 'c')}${srcChip('Zephyr', zN, 'z')}${jChipRow}</span>`
    : '';

  // P3 signals: switch-score → ↻N badge if non-trivial; max blocker dwell → ▌Nh
  const switches = p.contextSwitches?.switchEvents?.length || 0;
  const maxDwell = (p.blockers && p.blockers[0]?.dwellHours) || 0;
  // V18.1 P7-S4.6 — switch-index ↻N теперь опционален через
  // localStorage-флаг q2_scanner_hide_productivity. Pilot finding (Dmitry):
  // «↻N switch-badge выглядит как watchdog, тимлиды учуют». ▌Nh dwell-badge
  // НЕ скрывается — это операционный blocker-сигнал, не productivity-tracking.
  const hideProductivity = (() => {
    try { return localStorage.getItem('q2_scanner_hide_productivity') === '1'; } catch (_) { return false; }
  })();
  const switchBadge = (!hideProductivity && switches >= 3)
    ? `<span class="ts2-badge ts2-badge-switch" title="Переключений между задачами за 72ч (gap < 30 мин). Скрыть: localStorage.q2_scanner_hide_productivity = '1'">${Icons.get('rotate-cw', { cls: 'btn-icon', size: 12 })}${switches}</span>`
    : '';
  const dwellBadge = maxDwell >= 24
    ? `<span class="ts2-badge ts2-badge-dwell" title="Максимальный dwell-time блокера (${maxDwell}ч в текущем статусе)">▌${fmtDuration(maxDwell)}</span>`
    : '';
  // V20 S7 A2 — CRV + PR throughput chips per-row.
  const myCrv = metricsMaps.crv?.[p.key];
  const crvChip = myCrv && myCrv.count >= 2
    ? `<span class="ts2-badge ts2-badge-crv ts2-badge-crv-${myCrv.threshold}" title="Median time-to-first-review для этого ревьюера за 14 дней (N=${myCrv.count})">CR ${myCrv.medianHours}ч</span>`
    : '';
  const myPrT = metricsMaps.prT?.[p.key];
  const prChip = myPrT && myPrT.opened > 0
    ? `<span class="ts2-badge ts2-badge-prT ts2-badge-prT-${myPrT.flag}" title="${myPrT.merged} merged из ${myPrT.opened} opened за 7 дней (${Math.round(myPrT.mergeRate*100)}%) · flag: ${myPrT.flag}">${myPrT.opened}↗ ${Math.round(myPrT.mergeRate*100)}%</span>`
    : '';
  // V20 S10.3 — srcChips переезжают сюда из name-block. Причина: в
  // name-block (200px grid track) был внутренний flex с переменным числом
  // элементов (0..3 chips), что давало визуальную «гуляющую» границу слева
  // от dot-strips у разных строк. Логически BB/CF/Z chips = «откуда данные»
  // = badge-class meta-info, рядом с dwell/CR/PR.
  // V20 S12 I3 — diff vs yesterday badge: «↑ был moving, стал stop».
  // yesterdayGroups — Map<key, group> из prev snapshot. Если у нас не было
  // person-tracking вчера (fresh deployment) — пусто, badge не рендерим.
  let diffBadge = '';
  // Phase 3 E3 — `groupDropped` сигнализирует ухудшение (moving→watch/stop,
  // watch→stop). Используется ниже для pulse-attention анимации на чипе.
  // Брендбук §9 #3 — pulse только на регрессе, не на улучшении.
  let groupDropped = false;
  const prevGroup = yesterdayGroups?.get?.(p.key);
  if (prevGroup && currentGroup && prevGroup !== currentGroup) {
    // Direction: stop > watch > moving > idle (от худшего к лучшему).
    const order = { stop: 0, watch: 1, moving: 2, idle: -1 };
    const prevRank = order[prevGroup];
    const currRank = order[currentGroup];
    // Sprint A: unicode arrows → SVG icons
    let arrowIcon = Icons.get('arrow-right', { cls: 'btn-icon', size: 10 });
    let cls = 'ts2-row-diff';
    if (Number.isFinite(prevRank) && Number.isFinite(currRank)) {
      if (currRank > prevRank) { arrowIcon = Icons.get('arrow-up-right',   { cls: 'btn-icon', size: 10 }); cls += ' ts2-row-diff-up'; }
      if (currRank < prevRank) { arrowIcon = Icons.get('arrow-down-right', { cls: 'btn-icon', size: 10 }); cls += ' ts2-row-diff-down'; groupDropped = true; }
    }
    const groupRu = { stop: 'стоп', watch: 'наблюдение', moving: 'движется', idle: 'тихо' };
    // Phase 3 E3 — `is-pulse-attention` на дрейфующих чипах: 3 пульса × 1600ms
    // = ~5 секунд внимания. Брендбук §9 #3.
    if (groupDropped) cls += ' is-pulse-attention';
    diffBadge = `<span class="${cls}" title="Вчера: ${groupRu[prevGroup] || prevGroup} → Сегодня: ${groupRu[currentGroup] || currentGroup}">${arrowIcon} ${esc(groupRu[prevGroup] || prevGroup)}</span>`;
  }
  const badges = (diffBadge || srcChips || switchBadge || dwellBadge || crvChip || prChip)
    ? `<span class="ts2-row-badges">${diffBadge}${srcChips}${dwellBadge}${switchBadge}${crvChip}${prChip}</span>`
    : `<span class="ts2-row-badges-spacer"></span>`;

  // V18.1 P7-S3.1 — aria-controls связывает row с panel id (=ts2-panel-main),
  // SR анонсирует «связан с panel'ью «Детализация по сотруднику»».
  return `
    <div class="ts2-row ${isExpanded ? 'ts2-row-expanded' : ''}" data-key="${esc(p.key)}" tabindex="0" role="button" aria-expanded="${isExpanded}" aria-controls="ts2-panel-main">
      ${blockerMark}
      <span class="ts2-name-block">
        <span class="ts2-name" title="${esc(p.label)}">${esc(p.label || '—')}</span>
      </span>
      <span class="ts2-strip-wrap ts2-strip-wrap-today"><span class="ts2-strip-label">Сегодня</span>${todayBlock}</span>
      <span class="ts2-strip-wrap ts2-strip-wrap-yest"><span class="ts2-strip-label">Вчера</span>${yestBlock}</span>
      ${badges}
      <span class="ts2-counters">
        <span class="${wipCls}" title="Активные задачи в пути. Норма ≤2, перегрузка ≥3. Медиана команды: ${tm.wip}${wipN > tm.wip * 1.5 && tm.wip > 0 ? ` (×${(wipN / tm.wip).toFixed(1)} от среднего)` : ''}."><span class="ts2-counter-num">${wipN}</span><span class="ts2-counter-lab">в пути</span></span>
        <span class="ts2-counter" title="PR за 48ч. Медиана команды: ${tm.pr}${prsCount > tm.pr * 1.5 && tm.pr > 0 ? ` (×${(prsCount / tm.pr).toFixed(1)})` : ''}."><span class="ts2-counter-num">${prsCount}</span><span class="ts2-counter-lab">PR</span></span>
        <span class="ts2-counter" title="Задач затронуто за 72ч"><span class="ts2-counter-num">${tasksTouchN}</span><span class="ts2-counter-lab">задач</span></span>
        <span class="ts2-counter" title="Залогировано сегодня (часов). Медиана команды: ${tm.hours}ч${hoursToday > tm.hours * 1.5 && tm.hours > 0 ? ` (×${(hoursToday / tm.hours).toFixed(1)})` : ''}."><span class="ts2-counter-num">${hoursToday}</span><span class="ts2-counter-lab">ч</span></span>
      </span>
      <span class="ts2-chev">${Icons.get(isExpanded ? 'chevron-down' : 'chevron-right', { cls: 'btn-icon', size: 12 })}</span>
    </div>
  `;
}
