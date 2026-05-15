'use strict';
/* ============================================================
   TEAM-HEALTH DASHBOARDS — V21 AO/AP
   (V21 tabs-consolidation: файл переименован из `insightsDashboards.js` —
   эти 4 экрана живут в модулях КОМАНДА / РИТУАЛЫ и НЕ относились
   к ушедшей вкладке «Инсайты». См. audit-2026-05-V21-tabs/02-insights.md §6.)

   Четыре отдельных экрана которые читают из общего pulse-model
   (`TeamScanner2.getModel()`) и не делают новых HTTP-запросов:

     · EstimationCalibrationView — личное «обещал X — получилось Y»
     · ComponentHealthView       — per-component dashboard
     · BurnoutWatchtowerView     — manager-only after-hours signals
     · DocDebtConsoleView        — CF stale pages + ping owners

   Все 4 share одну CSS-семью .ts2-sd-* + .insights-dash-*

   AUDIT-ART (2026-05) — точечные art-direction правки #18, #19, #29, #30:
   hero-card в Burnout, bus-factor visual в ComponentHealth, sparkline
   в Estimation, табы «Контент»/«Доступы» в DocDebt. Все стили инжектятся
   рантаймом через `injectTeamHealthAuditArtStyles()` ниже — `styles.css`
   не трогается. Корневой враппер `audit-art-teamhealth ts2-root`
   включает существующий `data-tip` tooltip-механизм Сканнера 2.0.
   ============================================================ */

import { TeamScanner2 } from '../integrations/teamScanner2.js';
import { Utils } from '../utils.js';
import { computeEstimateAccuracy } from '../integrations/teamScanner2Insights.js';
import { renderPageHeader } from '../app/prizmaUI.js';

const esc = (v) => Utils.escapeHtml(String(v == null ? '' : v));

/* ============================================================
   AUDIT-ART runtime style injection.
   Вызывается лениво (idempotent) перед рендером любой из 4 view.
   Мечает все правила `/* AUDIT-ART #N *​/`.
   ============================================================ */
let _auditArtStyleInjected = false;
function injectTeamHealthAuditArtStyles() {
  if (_auditArtStyleInjected) return;
  if (typeof document === 'undefined') return;
  if (document.getElementById('audit-art-teamhealth-style')) {
    _auditArtStyleInjected = true;
    return;
  }
  const css = `
/* AUDIT-ART #18 — Burnout hero-card + secondary-grid.
   Передаёт «зеркало», не «manager-dashboard»: один крупный сигнал
   + три плотных secondary. */
.audit-art-teamhealth .aat-burnout-hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 24px;
  padding: 20px 24px 20px 28px;
  margin: 8px 0 20px;
  background: var(--prizma-bg-elevated, var(--card));
  border: 1px solid var(--prizma-border, var(--border));
  border-radius: 8px;
}
.audit-art-teamhealth .aat-burnout-hero::before {
  content: '';
  position: absolute;
  left: 0; top: 12px; bottom: 12px;
  width: 3px;
  border-radius: 2px;
  background: var(--prizma-text-tertiary, var(--text-3));
}
.audit-art-teamhealth .aat-burnout-hero[data-severity="off-course"]::before { background: var(--prizma-off-course); }
.audit-art-teamhealth .aat-burnout-hero[data-severity="drift"]::before      { background: var(--prizma-drift); }
.audit-art-teamhealth .aat-burnout-hero[data-severity="on-course"]::before  { background: var(--prizma-on-course); }
.audit-art-teamhealth .aat-burnout-hero-eyebrow {
  font-size: 10px; font-weight: 700; letter-spacing: .7px; text-transform: uppercase;
  color: var(--prizma-text-tertiary, var(--text-3));
  margin: 0 0 6px;
}
.audit-art-teamhealth .aat-burnout-hero-name {
  font-size: 18px; font-weight: 600; line-height: 1.2;
  color: var(--prizma-text-primary, var(--text-1));
  margin: 0 0 8px;
}
.audit-art-teamhealth .aat-burnout-hero-meta {
  font-size: 12px; line-height: 1.45;
  color: var(--prizma-text-secondary, var(--text-2));
  font-feature-settings: "tnum" 1, "lnum" 1;
}
.audit-art-teamhealth .aat-burnout-hero-pct {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-feature-settings: "tnum" 1;
  font-weight: 500;
  color: var(--prizma-text-primary, var(--text-1));
}
.audit-art-teamhealth .aat-burnout-hero-spark {
  display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
}
.audit-art-teamhealth .aat-spark-week {
  display: flex; align-items: flex-end; gap: 4px;
  height: 36px;
}
.audit-art-teamhealth .aat-spark-bar {
  width: 6px;
  min-height: 2px;
  background: var(--prizma-border-strong, var(--border));
  border-radius: 1px;
}
.audit-art-teamhealth .aat-spark-bar.is-after { background: var(--prizma-drift); }
.audit-art-teamhealth .aat-spark-bar.is-after.is-peak { background: var(--prizma-off-course); }
.audit-art-teamhealth .aat-spark-week-labels {
  display: flex; gap: 4px;
  font-size: 9px; font-weight: 600; letter-spacing: .6px;
  color: var(--prizma-text-tertiary, var(--text-3));
}
.audit-art-teamhealth .aat-spark-week-labels span {
  width: 6px; text-align: center;
}
.audit-art-teamhealth .aat-burnout-secondary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.audit-art-teamhealth .aat-burnout-secondary > .insights-dash-col {
  font-size: 12px;
}
.audit-art-teamhealth .aat-burnout-secondary > .insights-dash-col h3 {
  font-size: 11px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase;
  color: var(--prizma-text-secondary, var(--text-2));
  margin: 0 0 6px;
}
.audit-art-teamhealth .aat-burnout-secondary .insights-dash-hint {
  font-size: 11px; line-height: 1.4;
}
/* AUDIT-ART (2026-05) row-card refinement — fine-tune для compact secondary-grid.
   Полные grid-стили живут в styles.css '.audit-art-teamhealth .ts2-sd-row' —
   здесь только ужимаем размер шрифта внутри hero-card-секции.
   ВАЖНО: НЕ использовать backticks (grave accent) в этом комменте!
   Они закрывают внешний template literal → ReferenceError.
   См. docs/dont-touch.md разделение про backticks внутри CSS-комментариев. */
.audit-art-teamhealth .aat-burnout-secondary .ts2-sd-row {
  font-size: 12px;
}

/* AUDIT-ART #19 — bus-factor visual: 3 квадрата + крупный mono-num. */
.audit-art-teamhealth .aat-bf {
  display: inline-flex; align-items: center; gap: 8px;
  font-feature-settings: "tnum" 1;
}
.audit-art-teamhealth .aat-bf-num {
  font-family: ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, monospace;
  font-weight: 300;
  font-size: 24px;
  line-height: 1;
  color: var(--prizma-text-primary, var(--text-1));
  letter-spacing: -0.5px;
}
.audit-art-teamhealth .aat-bf[data-bf="1"] .aat-bf-num { color: var(--prizma-off-course); }
.audit-art-teamhealth .aat-bf[data-bf="2"] .aat-bf-num { color: var(--prizma-drift); }
.audit-art-teamhealth .aat-bf-grid {
  display: inline-flex; gap: 2px;
}
.audit-art-teamhealth .aat-bf-cell {
  width: 8px; height: 8px;
  background: var(--prizma-border-strong, var(--border));
  border-radius: 1px;
}
.audit-art-teamhealth .aat-bf-cell.is-on { background: var(--prizma-text-primary, var(--text-1)); }
.audit-art-teamhealth .aat-bf[data-bf="1"] .aat-bf-cell.is-on { background: var(--prizma-off-course); }

/* AUDIT-ART #29 — per-row sparkline для оценок. 5–7 точек,
   вертикальная позиция = ratio (1.0 = средняя линия). */
.audit-art-teamhealth .aat-est-spark {
  display: inline-block;
  position: relative;
  width: 56px;
  height: 16px;
  margin-right: 8px;
  vertical-align: middle;
}
.audit-art-teamhealth .aat-est-spark::before {
  content: '';
  position: absolute;
  left: 0; right: 0; top: 50%;
  border-top: 1px dashed var(--prizma-border, var(--border));
}
.audit-art-teamhealth .aat-est-spark-dot {
  position: absolute;
  width: 4px; height: 4px;
  border-radius: 50%;
  background: var(--prizma-text-secondary, var(--text-2));
  transform: translate(-50%, -50%);
}
.audit-art-teamhealth .aat-est-spark-dot[data-band="bad"]  { background: var(--prizma-off-course); }
.audit-art-teamhealth .aat-est-spark-dot[data-band="mid"]  { background: var(--prizma-drift); }
.audit-art-teamhealth .aat-est-spark-dot[data-band="good"] { background: var(--prizma-on-course); }
.audit-art-teamhealth .aat-est-spark-empty {
  font-size: 10px;
  color: var(--prizma-text-tertiary, var(--text-3));
  letter-spacing: .4px;
}

/* AUDIT-ART #30 — DocDebt tabs: spine-pill (active = bottom 3px stripe). */
.audit-art-teamhealth .aat-docdebt-tabs {
  display: flex; align-items: stretch; gap: 0;
  border-bottom: 1px solid var(--prizma-border, var(--border));
  margin: 8px 0 16px;
}
.audit-art-teamhealth .aat-docdebt-tab {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 10px 16px 12px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .7px;
  text-transform: uppercase;
  color: var(--prizma-text-tertiary, var(--text-3));
  cursor: pointer;
  position: relative;
  transition: color 140ms var(--ease-standard, ease);
}
.audit-art-teamhealth .aat-docdebt-tab:hover {
  color: var(--prizma-text-secondary, var(--text-2));
}
.audit-art-teamhealth .aat-docdebt-tab[aria-selected="true"] {
  color: var(--prizma-text-primary, var(--text-1));
}
.audit-art-teamhealth .aat-docdebt-tab[aria-selected="true"]::after {
  content: '';
  position: absolute;
  left: 12px; right: 12px; bottom: -1px;
  height: 3px;
  background: var(--prizma-information);
  border-radius: 2px 2px 0 0;
}
.audit-art-teamhealth .aat-docdebt-tab:focus-visible {
  outline: 1.5px solid var(--prizma-information);
  outline-offset: 2px;
}
.audit-art-teamhealth .aat-docdebt-pane[hidden] { display: none !important; }
`;
  const styleEl = document.createElement('style');
  styleEl.id = 'audit-art-teamhealth-style';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
  _auditArtStyleInjected = true;
}

/* Helper: empty-state когда нет pulse-данных. Шапка page-header'а
   рендерится тоже, чтобы юзер сразу видел module-eyebrow + section-h1. */
function _renderNoData(sectionKey, hint) {
  const sub = hint || 'Запустите Сканнер 2.0 — данные появятся здесь автоматически.';
  return `
    ${renderPageHeader(sectionKey, { sub })}
    <div class="insights-dash-empty"></div>
  `;
}

// V21 π9 — единый duration-форматтер `Utils.formatDuration` (audit §1.2).
function _fmtH(ms) { return Utils.formatDuration(ms); }

/**
 * PR-CE — баннер прозрачности фильтров. Показывает был ли активен
 * `activeSprintOnly` и `selectedPk` в момент построения модели.
 * Большинство аналитических метрик (Burnout, Hot-files, Doc-debt) считаются
 * за окно 30+ дней и НЕ фильтруются по активному спринту — пользователь
 * видит full picture. Banner объясняет это явно, чтобы тимлид не ждал что
 * 1-toggle поменяет цифры в Burnout.
 */
function _renderScopeBanner(m, opts = {}) {
  const f = m?.scannerV2?.activeSprintFilter || {};
  const sprintNote = f.requested
    ? (f.applied
       ? '<b>Активен фильтр:</b> только активный спринт. Показатели ниже — на этом подмножестве.'
       : `<b>Фильтр запрошен, но не применён</b> (${f.failOpenReason === 'no-sprint' ? 'нет активных спринтов' : 'ошибка API'}). Данные показаны без фильтра.`)
    : '';
  const dashboardScope = opts.windowBased
    ? 'Метрика считается за окно (≥ 30 дней) — фильтр «только активный спринт» здесь не применяется намеренно.'
    : '';
  if (!sprintNote && !dashboardScope) return '';
  return `<div class="insights-dash-scope-banner">${[sprintNote, dashboardScope].filter(Boolean).join(' · ')}</div>`;
}

/* AUDIT-ART #29 — sparkline для одного человека: до 7 точек.
   Вертикальная позиция: ratio=0.5..2.0 → y=top..bottom (clamped).
   Идеальный диапазон 0.7–1.3 — нейтральный серый dot, иначе drift / off-course. */
function _renderEstimationSparkline(ratios) {
  if (!Array.isArray(ratios) || ratios.length === 0) {
    // AUDIT-ART #29 — fallback когда данных мало.
    // TODO(AUDIT-ART #29): когда `recentRatios` пустой — у participant'а <3 samples,
    // в out[] он не попадает. Если расширим computeEstimateAccuracy на «слабые»
    // выборки — заменить empty на приглушённый серый «n=2» индикатор.
    return '<span class="aat-est-spark-empty" aria-label="Недостаточно точек для sparkline">— —</span>';
  }
  const n = ratios.length;
  const W = 56, H = 16;
  const stepX = n > 1 ? (W - 4) / (n - 1) : 0;
  const dots = ratios.map((r, i) => {
    // Map ratio 0.5..2.0 → y from H-2 (bottom) to 2 (top); clamp.
    const clamped = Math.max(0.5, Math.min(2.0, r));
    // 1.0 must sit in the middle (8px). Use log-ish but linear is enough at this scale.
    const norm = (clamped - 0.5) / 1.5; // 0..1
    const y = H - 2 - norm * (H - 4);   // bottom..top
    const x = 2 + i * stepX;
    let band = 'good';
    if (r > 1.3 || r < 0.7) band = 'mid';
    if (r > 1.6 || r < 0.5) band = 'bad';
    return `<span class="aat-est-spark-dot" data-band="${band}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px"></span>`;
  }).join('');
  return `<span class="aat-est-spark" role="img" aria-label="Распределение последних ${n} оценок">${dots}</span>`;
}

/* ── EstimationCalibrationView ──────────────────────────── */

export const EstimationCalibrationView = {
  render() {
    injectTeamHealthAuditArtStyles();
    const root = document.getElementById('section-est-calibration');
    if (!root) return;
    const m = TeamScanner2.getModel?.();
    if (!m) {
      root.innerHTML = _renderNoData('est-calibration', 'Перейдите в Сканнер 2.0 и запустите загрузку — это активирует данные оценок.');
      return;
    }
    // Per-person accuracy (existing computation).
    const perPerson = computeEstimateAccuracy(m);
    // Per-PK sprint estimation accuracy (PR-AD).
    const sc = m.bigMetrics?.sprintCommit?.byPk || {};
    const perPk = Object.entries(sc)
      .map(([pk, v]) => ({
        pk,
        avg: v.estimationAccuracy?.avgHoursPerSp,
        cov: v.estimationAccuracy?.coV,
        n:   v.estimationAccuracy?.n || 0,
      }))
      .filter(e => e.avg != null);

    const personRows = perPerson.length ? perPerson.slice(0, 30).map(e => {
      const cls = e.tendency === 'good' ? 'ts2-sd-good' : 'ts2-sd-mid';
      const tendencyText = e.tendency === 'good' ? 'точно' : e.tendency === 'underestimate' ? 'недооценивает' : 'переоценивает';
      // AUDIT-ART #29 — sparkline перед текстом, один взгляд = стабильность/разнобой.
      const spark = _renderEstimationSparkline(e.recentRatios);
      return `<li class="ts2-sd-row"><span class="ts2-sd-key">${spark}${esc(e.label)}</span><span class="ts2-sd-val">медиан. отношение ${e.medianRatio}</span><span class="ts2-sd-pct ${cls}">${esc(tendencyText)} · n=${e.sampleSize}</span></li>`;
    }).join('') : '<li class="ts2-sd-row"><span class="ts2-sd-key">Недостаточно данных (нужно ≥3 задачи с проставленной оценкой и фактически списанным временем на человека)</span></li>';

    const pkRows = perPk.length ? perPk.map(e => {
      const cls = e.cov != null && e.cov > 0.4 ? 'ts2-sd-bad' : e.cov != null && e.cov > 0.2 ? 'ts2-sd-mid' : 'ts2-sd-good';
      return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(e.pk)}</span><span class="ts2-sd-val">${e.avg}ч/SP</span><span class="ts2-sd-pct ${cls}">CoV ${e.cov ?? '—'} · n=${e.n}</span></li>`;
    }).join('') : '<li class="ts2-sd-row"><span class="ts2-sd-key">Спринтовые данные не подгружены (нужен Jira Agile + закрытые спринты со story-point оценками)</span></li>';

    // PR-CT — diagnose причины «нет данных»: показываем требование к Jira-полям.
    const requirementsHint = `
      <p class="insights-dash-hint">
        Для этой вкладки нужно в Jira: (1) поле <b>Original Estimate</b> или Time Tracking
        у задач + фактически списанное время (<b>Time Spent / aggregatetimespent</b>),
        (2) Jira Agile с закрытыми спринтами и проставленными <b>Story Points</b>
        (поле <code>customfield_10004</code>). Если ничего из этого не настроено —
        оба блока ниже будут пустыми, это не баг.
      </p>`;
    root.innerHTML = `
      <div class="audit-art-teamhealth ts2-root">
      ${renderPageHeader('est-calibration', { sub: 'Личная и проектная точность оценок: «обещал X — получилось Y».' })}
      ${_renderScopeBanner(m)}
      ${requirementsHint}
      <div class="insights-dash-wrap">
        <div class="insights-dash-col">
          <h3>Личная точность оценок</h3>
          <p class="insights-dash-hint">Медианное отношение = факт / оценка. Хорошо если 0.7–1.3. &gt;1.3 — недооценивает, &lt;0.7 — переоценивает. Sparkline слева — последние оценки в порядке появления.</p>
          <ul class="ts2-sd-list">${personRows}</ul>
        </div>
        <div class="insights-dash-col">
          <h3>Точность по проектам (часы / SP)</h3>
          <p class="insights-dash-hint">Среднее «часов на 1 story-point» за последние закрытые спринты. CoV (коэффициент вариации) показывает стабильность: &lt;0.2 — стабильно, &gt;0.4 — разнобой.</p>
          <ul class="ts2-sd-list">${pkRows}</ul>
        </div>
      </div>
      </div>
    `;
  },
};

/* ── ComponentHealthView ────────────────────────────────── */

/* AUDIT-ART #19 — bus-factor visual: 3 8×8 квадратика + крупный mono-num.
   Заполнено столько ячеек сколько bf (cap 3). data-tip даёт hover-tooltip
   через .ts2-root [data-tip]:hover::after — поэтому корень обёрнут в ts2-root. */
function _renderBusFactor(bf) {
  const n = Math.max(0, Math.min(3, bf | 0));
  const cells = Array.from({ length: 3 }, (_, i) =>
    `<span class="aat-bf-cell${i < n ? ' is-on' : ''}"></span>`).join('');
  const tip = bf === 1
    ? 'Знание у 1 человека — точка отказа'
    : bf === 2
      ? 'Знание у 2 человек — узкое место'
      : `Знание у ${bf} человек`;
  return `<span class="aat-bf" data-bf="${bf}" data-tip="${esc(tip)}"><span class="aat-bf-num">${bf}</span><span class="aat-bf-grid">${cells}</span></span>`;
}

export const ComponentHealthView = {
  render() {
    injectTeamHealthAuditArtStyles();
    const root = document.getElementById('section-component-health');
    if (!root) return;
    const m = TeamScanner2.getModel?.();
    if (!m) { root.innerHTML = _renderNoData('component-health'); return; }
    const cl = m.summary?.componentOwnerLoad || {};
    const hot = m.bigMetrics?.hotFiles?.hotFiles || [];
    const bus = m.bigMetrics?.hotFiles?.busFactor || [];
    const components = Object.entries(cl)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.issueCount - a.issueCount)
      .slice(0, 30);

    const compRows = components.length ? components.map(c => {
      const openPct = c.issueCount > 0 ? Math.round(c.openCount / c.issueCount * 100) : 0;
      const cls = openPct > 70 ? 'ts2-sd-bad' : openPct > 40 ? 'ts2-sd-mid' : 'ts2-sd-good';
      const lead = c.lead ? esc(c.lead) : '—';
      return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(c.name)}</span><span class="ts2-sd-val">владелец: ${lead}</span><span class="ts2-sd-pct ${cls}">${c.openCount}/${c.issueCount} (${openPct}% открыто)</span></li>`;
    }).join('') : '<li class="ts2-sd-row"><span class="ts2-sd-key">Нет компонентов в открытых задачах</span></li>';

    const hasHot = hot.length > 0;
    const hotRows = hasHot ? hot.slice(0, 15).map(f => {
      // AUDIT-ART #19 — bus-factor визуал вместо мелкой красной точки.
      const bfVisual = _renderBusFactor(f.busFactor);
      return `<li class="ts2-sd-row"><span class="ts2-sd-key" title="${esc(f.path)}">${esc(f.path.split('/').slice(-2).join('/'))}</span><span class="ts2-sd-val">${f.changes} изм</span><span class="ts2-sd-pct">${bfVisual}</span></li>`;
    }).join('') : '';

    // V21 hot-files header: иерархия eyebrow → sub-header → howto → counter
    // вместо одной слепой стены. Empty-state в отдельном warning-блоке.
    const hotHeaderHtml = hasHot
      ? `
        <div class="hf-header">
          <div class="hf-eyebrow">ГОРЯЧИЕ ФАЙЛЫ</div>
          <div class="hf-subhead">top-15 точек отказа за 90 дней</div>
          <div class="hf-howto">
            <strong>Что значит:</strong> bf=1 → файл знает только один человек (точка отказа). Cap 1000 commit/repo, 5 репозиториев. Сетка справа — носители знания.
          </div>
          <div class="hf-counter"><span class="hf-counter-num">${bus.length}</span> файлов с bf=1 / Всего <span class="hf-counter-num">${hot.length}</span> файлов проанализировано</div>
        </div>
        <ul class="ts2-sd-list">${hotRows}</ul>
      `
      : `
        <div class="hf-header">
          <div class="hf-eyebrow">ГОРЯЧИЕ ФАЙЛЫ</div>
          <div class="hf-subhead">top-15 точек отказа за 90 дней</div>
        </div>
        <div class="hf-empty">
          <strong>Горячие файлы не подгружены</strong> — BB не настроен или ENABLE_HOT_FILES=0. Включите интеграцию в настройках или установите env-флаг.
        </div>
      `;

    root.innerHTML = `
      <div class="audit-art-teamhealth ts2-root">
      ${renderPageHeader('component-health', { sub: 'Здоровье кода: горячие файлы, концентрация знаний.' })}
      ${_renderScopeBanner(m, { windowBased: true })}
      <div class="insights-dash-wrap">
        <div class="insights-dash-col">
          <h3>Компоненты по нагрузке</h3>
          <p class="insights-dash-hint">Сколько задач закреплено за компонентом и какой % сейчас открыт.</p>
          <ul class="ts2-sd-list">${compRows}</ul>
        </div>
        <div class="insights-dash-col hf-tile">
          ${hotHeaderHtml}
        </div>
      </div>
      </div>
    `;
  },
};

/* ── BurnoutWatchtowerView ──────────────────────────────── */

/* AUDIT-ART #18 — построить per-day after-hours bar-chart из timeline'а.
   Возвращает массив длиной 7 (Mon..Sun) с числом «после-часов» событий
   на день. Использует ту же логику что portfolioPulseModel:
   off-hours = hour < 6 || hour >= 18 ИЛИ выходной. */
function _buildWeekAfterHoursBars(participant) {
  const events = [
    ...(participant?.timelineToday    || []),
    ...(participant?.timelineYesterday || []),
    ...(participant?.timelinePrev     || []),
    ...(participant?.bbItems          || []),
  ];
  const bars = new Array(7).fill(0).map(() => ({ total: 0, after: 0 }));
  for (const a of events) {
    const t = Date.parse(a?.at || '');
    if (!Number.isFinite(t)) continue;
    const d = new Date(t);
    const day = d.getUTCDay();        // 0=Sun..6=Sat
    const hour = d.getUTCHours();
    const isWeekend = day === 0 || day === 6;
    const isOffHours = hour < 6 || hour >= 18;
    // Convert to Mon-first index (0=Mon..6=Sun).
    const idx = day === 0 ? 6 : day - 1;
    bars[idx].total += 1;
    if (isWeekend || isOffHours) bars[idx].after += 1;
  }
  return bars;
}

function _renderWeekSparkline(bars) {
  const max = Math.max(1, ...bars.map(b => b.total));
  const peakAfter = Math.max(...bars.map(b => b.after));
  const labels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const barsHtml = bars.map((b, i) => {
    const h = Math.round((b.total / max) * 32);
    const isAfter = b.after > 0;
    const isPeak = isAfter && b.after === peakAfter;
    const cls = `aat-spark-bar${isAfter ? ' is-after' : ''}${isPeak ? ' is-peak' : ''}`;
    const tip = `${labels[i]}: ${b.after}/${b.total} вне рабочих часов`;
    return `<span class="${cls}" style="height:${Math.max(2, h)}px" data-tip="${esc(tip)}"></span>`;
  }).join('');
  const labelsHtml = labels.map(l => `<span>${l[0]}</span>`).join('');
  return `
    <div class="aat-spark-week" role="img" aria-label="Внерабочие часы по дням недели">${barsHtml}</div>
    <div class="aat-spark-week-labels">${labelsHtml}</div>
  `;
}

export const BurnoutWatchtowerView = {
  render() {
    injectTeamHealthAuditArtStyles();
    const root = document.getElementById('section-burnout');
    if (!root) return;
    const m = TeamScanner2.getModel?.();
    if (!m) { root.innerHTML = _renderNoData('burnout'); return; }
    const parts = m.participants || [];
    // After-hours top — отсортированы по ratio DESC.
    // AUDIT-ART #18 — top-1 = самая высокая ratio при n>=5; вытаскиваем
    // отдельно для hero-card, остальные показываем плотным secondary-list.
    const afterHrs = parts
      .filter(p => p.metrics && p.metrics.afterHoursTotalEvents >= 5)
      .map(p => ({
        participant: p,
        name: p.label || p.email,
        ratio: p.metrics.afterHoursRatio,
        n: p.metrics.afterHoursTotalEvents,
      }))
      .filter(p => p.ratio > 0)
      .sort((a, b) => b.ratio - a.ratio);
    const afterHrsTop = afterHrs[0] || null;
    const afterHrsRest = afterHrs.slice(1, 10);

    // Reviewer overload — lots of assigned reviews.
    const overload = m.bitbucket?.reviewerStats?.overload || [];
    // Idle reviewers.
    const idle = m.bitbucket?.reviewerStats?.idle || [];
    // Узкие специалисты с высоким Gini = single-point-of-failure.
    const specialists = parts
      .filter(p => p.metrics && p.metrics.specialistGini > 0.7 && p.metrics.knowledgeBreadth >= 1)
      .map(p => ({ name: p.label || p.email, gini: p.metrics.specialistGini, breadth: p.metrics.knowledgeBreadth }))
      .sort((a, b) => b.gini - a.gini)
      .slice(0, 10);

    // AUDIT-ART #18 — hero-card: top-1 + sparkline недели + severity-stripe.
    let heroHtml = '';
    if (afterHrsTop) {
      const pct = Math.round(afterHrsTop.ratio * 100);
      const severity = pct > 50 ? 'off-course' : pct > 30 ? 'drift' : 'on-course';
      const bars = _buildWeekAfterHoursBars(afterHrsTop.participant);
      const sparkHtml = _renderWeekSparkline(bars);
      heroHtml = `
        <div class="aat-burnout-hero" data-severity="${severity}">
          <div class="aat-burnout-hero-body">
            <div class="aat-burnout-hero-eyebrow">Главный сигнал · после-часы</div>
            <div class="aat-burnout-hero-name">${esc(afterHrsTop.name)}</div>
            <div class="aat-burnout-hero-meta"><span class="aat-burnout-hero-pct">${pct}%</span> событий вне рабочих часов · <span class="aat-burnout-hero-pct">n=${afterHrsTop.n}</span> за окно</div>
          </div>
          <div class="aat-burnout-hero-spark">${sparkHtml}</div>
        </div>
      `;
    }

    const ahRestRows = afterHrsRest.length ? afterHrsRest.map(p => {
      const pct = Math.round(p.ratio * 100);
      const cls = pct > 50 ? 'ts2-sd-bad' : pct > 30 ? 'ts2-sd-mid' : 'ts2-sd-good';
      return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(p.name)}</span><span class="ts2-sd-val">n=${p.n}</span><span class="ts2-sd-pct ${cls}">${pct}%</span></li>`;
    }).join('') : '<li class="ts2-sd-row"><span class="ts2-sd-key">Других сигналов после-часов нет.</span></li>';

    const overloadRows = overload.length ? overload.slice(0, 10).map(r => {
      const pct = overload[0].assigned ? Math.round((r.assigned / overload[0].assigned) * 100) : 0;
      const cls = pct > 80 ? 'ts2-sd-bad' : pct > 50 ? 'ts2-sd-mid' : 'ts2-sd-good';
      // PR-CV — у каждой записи теперь есть `source`: formal/activity/both.
      // 'activity' — пользователь не был formal-reviewer, но фактически
      // ревьюил PR (Bitbucket без mandatory-reviewer policy).
      const sourceTag = r.source === 'activity' ? ' <span class="ts2-sd-source-tag" title="Без formal assignment, по фактической активности">по активности</span>' : '';
      return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(r.name)}${sourceTag}</span><span class="ts2-sd-val">${r.acted}/${r.assigned}</span><span class="ts2-sd-pct ${cls}">${pct}%</span></li>`;
    }).join('') : '<li class="ts2-sd-row"><span class="ts2-sd-key">Активность ревьюеров отсутствует за окно. Возможно мало PR‑ов или Bitbucket не настроен.</span></li>';
    // PR-CV — server возвращает диагностический note если что-то не так.
    const reviewerStats = m.bitbucket?.reviewerStats || {};
    const reviewerNote = reviewerStats.note
      ? `<p class="insights-dash-hint" style="font-size:11px;color:var(--text-3)">${esc(reviewerStats.note)}</p>`
      : '';

    const idleRows = idle.length ? idle.slice(0, 10).map(r =>
      `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(r.name)}</span><span class="ts2-sd-val">${r.assigned} назначено</span><span class="ts2-sd-pct ts2-sd-bad">без действий</span></li>`
    ).join('') : '<li class="ts2-sd-row"><span class="ts2-sd-key">Спящих ревьюеров нет.</span></li>';

    const specRows = specialists.length ? specialists.map(p => {
      const cls = p.gini > 0.85 ? 'ts2-sd-bad' : 'ts2-sd-mid';
      return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(p.name)}</span><span class="ts2-sd-val">${p.breadth} ${p.breadth === 1 ? 'проект' : (p.breadth < 5 ? 'проекта' : 'проектов')}</span><span class="ts2-sd-pct ${cls}" data-tip="Зона риска: концентрация активности (0 = равномерно по проектам, 1 = весь код в одной зоне)">${p.gini.toFixed(2)}</span></li>`;
    }).join('') : '<li class="ts2-sd-row"><span class="ts2-sd-key">Узких специалистов не обнаружено.</span></li>';

    root.innerHTML = `
      <div class="audit-art-teamhealth ts2-root">
      ${renderPageHeader('burnout', { sub: 'Внерабочая активность, перегрузка ревьюеров, узкие специалисты.' })}
      <div class="insights-dash-warning"><span class="signal-dot signal-drift" role="img" aria-label="Предупреждение"></span> Сигналы тревожные, не приговор. Сначала поговорите 1:1.</div>
      ${_renderScopeBanner(m, { windowBased: true })}
      ${heroHtml}
      <div class="aat-burnout-secondary">
        <div class="insights-dash-col">
          <h3>Прочие после-часы</h3>
          <p class="insights-dash-hint">% событий вне 09:00–18:00 или в выходные.</p>
          <ul class="ts2-sd-list">${ahRestRows}</ul>
        </div>
        <div class="insights-dash-col">
          <h3>Перегрузка ревьюеров</h3>
          <p class="insights-dash-hint">% от лидера по числу ревью.</p>
          ${reviewerNote}
          <ul class="ts2-sd-list">${overloadRows}</ul>
        </div>
        <div class="insights-dash-col">
          <h3>Спящие ревьюеры</h3>
          <p class="insights-dash-hint">Назначены, не действуют.</p>
          <ul class="ts2-sd-list">${idleRows}</ul>
        </div>
      </div>
      <div class="insights-dash-wrap" style="margin-top:16px">
        <div class="insights-dash-col">
          <h3>Узкие специалисты</h3>
          <p class="insights-dash-hint">Сильная концентрация активности на 1–2 проектах. Риск точки отказа.</p>
          <ul class="ts2-sd-list">${specRows}</ul>
        </div>
      </div>
      </div>
    `;
  },
};

/* ── DocDebtConsoleView ─────────────────────────────────── */

/* AUDIT-ART #30 — два таба «Контент» / «Доступы».
   Active сохраняется в localStorage `prizma.docdebt.tab`. Default: content. */
const DOC_DEBT_TAB_KEY = 'prizma.docdebt.tab';

function _getDocDebtActiveTab() {
  try {
    const v = localStorage.getItem(DOC_DEBT_TAB_KEY);
    return v === 'access' ? 'access' : 'content';
  } catch (_e) {
    return 'content';
  }
}

function _setDocDebtActiveTab(tab) {
  try { localStorage.setItem(DOC_DEBT_TAB_KEY, tab); } catch (_e) { /* ignore */ }
}

function _bindDocDebtTabs(root) {
  const tabs = root.querySelectorAll('.aat-docdebt-tab');
  const panes = root.querySelectorAll('.aat-docdebt-pane');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');
      if (!target) return;
      tabs.forEach(t => t.setAttribute('aria-selected', t === btn ? 'true' : 'false'));
      panes.forEach(p => {
        const match = p.getAttribute('data-pane') === target;
        if (match) p.removeAttribute('hidden');
        else p.setAttribute('hidden', '');
      });
      _setDocDebtActiveTab(target);
    });
  });
}

export const DocDebtConsoleView = {
  render() {
    injectTeamHealthAuditArtStyles();
    const root = document.getElementById('section-doc-debt');
    if (!root) return;
    const m = TeamScanner2.getModel?.();
    if (!m) { root.innerHTML = _renderNoData('doc-debt'); return; }
    const cfh = m.bigMetrics?.cfHealth?.bySpace || {};
    const stale = m.bigMetrics?.staleConfluence?.bySpace || {};
    const owners = m.bigMetrics?.cfHealth?.ownership || [];
    const knowFlow = m.summary?.knowledgeFlow || { spreaders: [], siloed: [] };
    const retro = m.bigMetrics?.retroClosure || { perPage: [], summary: { totalPages: 0, totalItems: 0, closed: 0, ratio: null } };
    const acl   = m.bigMetrics?.cfSpaceAcl?.bySpace || {};
    const pageViews = m.confluence?.pageViews || [];

    const spaceRows = Object.entries(cfh).length ? Object.entries(cfh).map(([sp, v]) => {
      const orphPct = v.orphanRatio != null ? Math.round(v.orphanRatio * 100) : 0;
      const cls = orphPct > 30 ? 'ts2-sd-bad' : orphPct > 15 ? 'ts2-sd-mid' : 'ts2-sd-good';
      const staleCount = stale[sp]?.staleCount || 0;
      return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(sp)}</span><span class="ts2-sd-val">всего ${v.totalPages} · сирот ${v.orphans} · старше 1 года: ${staleCount}</span><span class="ts2-sd-pct ${cls}">${orphPct}% сирот</span></li>`;
    }).join('') : '<li class="ts2-sd-row"><span class="ts2-sd-key">Confluence не настроен или нет ключей пространств</span></li>';

    const ownerRows = owners.length ? owners.slice(0, 15).map(o =>
      `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(o.name)}</span><span class="ts2-sd-val">${o.edits} правок</span><span class="ts2-sd-pct">${o.comments} комм.</span></li>`
    ).join('') : '<li class="ts2-sd-row"><span class="ts2-sd-key">Список владельцев CF пуст</span></li>';

    const spreaderRows = (knowFlow.spreaders || []).slice(0, 10).map(p =>
      `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(p.name)}</span><span class="ts2-sd-val">${p.spaces} ${p.spaces === 1 ? 'пространство' : (p.spaces < 5 ? 'пространства' : 'пространств')}</span><span class="ts2-sd-pct ts2-sd-good">распространитель</span></li>`
    ).join('') || '';
    const siloedRows = (knowFlow.siloed || []).slice(0, 10).map(p =>
      `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(p.name)}</span><span class="ts2-sd-val">${p.top1} ${Math.round(p.top1Pct * 100)}%</span><span class="ts2-sd-pct ts2-sd-mid">один спейс</span></li>`
    ).join('') || '';

    // V21 AQ — Retro action-items closure.
    const retroSummaryPct = retro.summary.ratio != null ? Math.round(retro.summary.ratio * 100) : null;
    const retroSummaryCls = retroSummaryPct == null ? '' : retroSummaryPct < 30 ? 'ts2-sd-bad' : retroSummaryPct < 70 ? 'ts2-sd-mid' : 'ts2-sd-good';
    const retroSummaryRow = retro.summary.totalPages > 0
      ? `<li class="ts2-sd-row"><span class="ts2-sd-key">Всего: ${retro.summary.totalPages} ретро-страниц · ${retro.summary.totalItems} пунктов действий</span><span class="ts2-sd-val">${retro.summary.closed} закрыто</span><span class="ts2-sd-pct ${retroSummaryCls}">${retroSummaryPct ?? '—'}%</span></li>`
      : '<li class="ts2-sd-row"><span class="ts2-sd-key">Ретро-страницы не настроены<details class="ts2-sd-detail" style="display:inline-block;margin-left:6px"><summary style="cursor:pointer;color:var(--prizma-text-tertiary,var(--text-3));font-size:11px">подробнее</summary><span style="color:var(--prizma-text-tertiary,var(--text-3));font-size:11px">Нужен label «retro» / «retrospective» / «post-mortem» + блок «Action items».</span></details></span></li>';
    const aclRows = Object.entries(acl).length ? Object.entries(acl).map(([sp, v]) => {
      const anonCls = v.anonymous ? 'ts2-sd-bad' : 'ts2-sd-good';
      return `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(sp)}</span><span class="ts2-sd-val">${v.users} пользов. · ${v.groups} групп</span><span class="ts2-sd-pct ${anonCls}">${v.anonymous ? 'открыто всем' : 'закрыто'}</span></li>`;
    }).join('') : '<li class="ts2-sd-row"><span class="ts2-sd-key">ACL endpoint недоступен или нет ключей пространств</span></li>';

    // V21 AX — Page views top-15 (popular pages).
    const popularRows = (pageViews || []).slice(0, 15).map(p =>
      `<li class="ts2-sd-row"><span class="ts2-sd-key">${esc(p.title || `(стр. ${p.id})`)}</span><span class="ts2-sd-val">${p.spaceKey}</span><span class="ts2-sd-pct">${p.count} просмотров</span></li>`
    ).join('') || '<li class="ts2-sd-row"><span class="ts2-sd-key">Audit-log недоступен (нужны права администратора Confluence + включённый audit для пространства).</span></li>';

    const retroPageRows = (retro.perPage || []).slice(0, 10).map(p => {
      const pct = p.ratio != null ? Math.round(p.ratio * 100) : null;
      const cls = pct == null ? '' : pct < 30 ? 'ts2-sd-bad' : pct < 70 ? 'ts2-sd-mid' : 'ts2-sd-good';
      return `<li class="ts2-sd-row"><span class="ts2-sd-key" title="${esc(p.title)}"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a></span><span class="ts2-sd-val">${p.closed}/${p.total}</span><span class="ts2-sd-pct ${cls}">${pct ?? '—'}%</span></li>`;
    }).join('');

    // AUDIT-ART #30 — два таба: «Контент» и «Доступы». Active сохраняется
    // в localStorage `prizma.docdebt.tab` (default = content).
    const activeTab = _getDocDebtActiveTab();
    const isContent = activeTab === 'content';
    const tabsHtml = `
      <div class="aat-docdebt-tabs" role="tablist">
        <button type="button" class="aat-docdebt-tab" role="tab" aria-selected="${isContent}" data-tab="content">Контент</button>
        <button type="button" class="aat-docdebt-tab" role="tab" aria-selected="${!isContent}" data-tab="access">Доступы</button>
      </div>
    `;

    const contentPane = `
      <div class="aat-docdebt-pane" data-pane="content"${isContent ? '' : ' hidden'} role="tabpanel">
        <div class="insights-dash-wrap">
          <div class="insights-dash-col">
            <h3>Здоровье пространств</h3>
            <p class="insights-dash-hint">Доля страниц-сирот (без родителя), общий объём, старше 1 года.</p>
            <ul class="ts2-sd-list">${spaceRows}</ul>
          </div>
          <div class="insights-dash-col">
            <h3>Главные авторы (по правкам)</h3>
            <p class="insights-dash-hint">Кому пинговать, чтобы привести страницы в порядок.</p>
            <ul class="ts2-sd-list">${ownerRows}</ul>
          </div>
          ${spreaderRows ? `
          <div class="insights-dash-col">
            <h3>Распространители знания</h3>
            <p class="insights-dash-hint">Авторы активные в нескольких пространствах — естественные мостики между командами.</p>
            <ul class="ts2-sd-list">${spreaderRows}</ul>
          </div>` : ''}
          <div class="insights-dash-col">
            <h3>Закрытие пунктов с ретро</h3>
            <p class="insights-dash-hint">Парсим ретро/post-mortem страницы CF (&lt; 180 дней) — task-list блоки с complete/incomplete статусами. Низкий % = пункты не закрываются.</p>
            <ul class="ts2-sd-list">${retroSummaryRow}${retroPageRows}</ul>
          </div>
          <div class="insights-dash-col">
            <h3>Популярные страницы</h3>
            <p class="insights-dash-hint">Самые читаемые страницы за окно (audit-log просмотров). Помогает понять что популярно, а что мёртвый код.</p>
            <ul class="ts2-sd-list">${popularRows}</ul>
          </div>
        </div>
      </div>
    `;

    const accessPane = `
      <div class="aat-docdebt-pane" data-pane="access"${isContent ? ' hidden' : ''} role="tabpanel">
        <div class="insights-dash-wrap">
          <div class="insights-dash-col">
            <h3>ACL пространств</h3>
            <p class="insights-dash-hint">Кто видит каждое пространство. «Открыто всем» — без авторизации, иначе — список пользователей/групп с правами.</p>
            <ul class="ts2-sd-list">${aclRows}</ul>
          </div>
          ${siloedRows ? `
          <div class="insights-dash-col">
            <h3>Изолированные авторы</h3>
            <p class="insights-dash-hint">Активность сконцентрирована в одном пространстве (&gt;90%). Возможно стоит рассмотреть ротацию.</p>
            <ul class="ts2-sd-list">${siloedRows}</ul>
          </div>` : ''}
        </div>
      </div>
    `;

    root.innerHTML = `
      <div class="audit-art-teamhealth ts2-root">
      ${renderPageHeader('doc-debt', { sub: 'Confluence: устаревшие страницы, владельцы, ACL.' })}
      ${_renderScopeBanner(m, { windowBased: true })}
      ${tabsHtml}
      ${contentPane}
      ${accessPane}
      </div>
    `;

    // AUDIT-ART #30 — wire up tab switcher.
    _bindDocDebtTabs(root);
  },
};
