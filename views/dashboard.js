'use strict';
/* ============================================================
   DASHBOARD VIEW — V21 (audit 2026-05-V21-tabs/01-dashboard.md)
   Sections 2 (Brand) + 3 (Performance) + 4 (Domain) применены.
   --
   SECURITY: every user-controlled value (row.team, row.epic, row.tags,
   row.comment, row.category, etc.) is escaped via `esc(...)` before
   landing in an innerHTML template.
   --
   V21 highlights:
   • RELEASE_FIELDS-driven KPI/breakdown (4.1) — конец квартала уже не
     ломает дашборд, правится одна константа.
   • computeDashboardCounters — single-pass агрегатор (3.1), 20+ filter'ов
     схлопнуты в один reduce.
   • isBacklog vs isUnassigned (4.5) — раздельно показываем «без курса»
     (проблема) и «бэклог» (норма).
   • Hero rerender идемпотентен (3.2) — нет повторного aria-live spam'а.
   • SVG-icons вместо Юникод-стрелок (2.1).
   • Сортировка risk-flags по убыванию (4.4).
   • Subtitle к блокерам с дальним хвостом (4.3).
   • Блок «Перегрузка инженеров» (OT × открытые 1.22) — 4.2.
   • Блок «Сделано за неделю» (4.6).
   ============================================================ */

import { state } from '../state.js';
import { FilterEngine } from '../filters.js';
import { Utils } from '../utils.js';
import { RISK_FLAGS, RELEASE_WINDOWS, RELEASE_FIELDS } from '../constants.js';
import { computeProgress, computeDashboardCounters } from '../metricsEngine.js';
import { RH } from './renderHelpers.js';
import { renderPageHeader, renderHero, prizmaEmptyGlyph } from '../app/prizmaUI.js';
import { Icons } from '../app/icons.js';
import { Services } from '../app/services.js';

const esc = (v) => Utils.escapeHtml(v);

/* SVG-стрелка из брендового icon-set (V21 audit 2.1). */
function svgArrow(name = 'arrow-right', size = 12) {
  try { return Icons.get(name, { cls: 'dash-arrow-icon', size }); }
  catch (_) { return ''; }
}

/* TECH 1.1 — Memoization для тяжёлых агрегаций dashboard.
   Раньше каждый render делал rows × assignees / rows × workTypes forEach
   несколько раз. На 1.5к строк × 6 блоков = 5-15 ms × 6 = jank.
   Кэш ключуется на (state._dataVersion + filtersKey + rows.length) — если
   FilterEngine отдаёт тот же snapshot, агрегация не пересчитывается.
   Кэш holds ровно один последний snapshot (Map с size=1 семантикой) —
   нам не нужна история, нужен fast-path при двух подряд render'ах. */
const _memoCache = new Map();
function _memoKey(rows) {
  let dv = 0;
  let fk = '';
  try { dv = state._dataVersion | 0; } catch (_) {}
  try { fk = FilterEngine._cacheKey || ''; } catch (_) {}
  // rows.length — fallback fingerprint на случай если _dataVersion не bump'нулся
  return dv + '~' + rows.length + '~' + fk;
}
function _memo(name, rows, compute) {
  const fullKey = name + '|' + _memoKey(rows);
  if (_memoCache.has(fullKey)) return _memoCache.get(fullKey);
  // Cache size=1 семантика — только последний результат держим в памяти.
  if (_memoCache.size > 8) _memoCache.clear();
  const value = compute();
  _memoCache.set(fullKey, value);
  return value;
}

/* AUDIT-ART #1/#2/#3/#5 — runtime-style инжект.
   Идемпотентно: повторные вызовы no-op. Все правила помечены AUDIT-ART #N.
   Не редактируем styles.css напрямую — параллельные агенты могут конфликтовать. */
function injectDashboardAuditArtStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('audit-art-dashboard-style')) return;
  const style = document.createElement('style');
  style.id = 'audit-art-dashboard-style';
  style.textContent = `
/* AUDIT-ART #1 / V22 fix (2026-05-10) — Hero-звезда reactive.
   Старый «красный круг» (offcourse-pulse) убран по UX-фидбеку — теперь
   off-course выражается через медленную пульсацию нижней грани звезды
   (см. styles.css:.prizma-star-edge[data-edge-index="4"]). Drift-tilt
   оставлен — он мягкий и не визуально шумный. */
@keyframes prizma-hero-drift-tilt {
  from { transform: rotate(-2deg); }
  to   { transform: rotate(2deg); }
}
.prizma-hero-mark[data-prizma-hero-state="drift"] svg {
  animation: prizma-hero-drift-tilt 3.6s ease-in-out infinite alternate;
  transform-origin: 50% 50%;
}
@media (prefers-reduced-motion: reduce) {
  .prizma-hero-mark[data-prizma-hero-state="drift"] svg {
    animation: none !important;
    transform: none;
  }
}

/* AUDIT-ART #2 — Action-block dominance. ×1.6 плотность + воздух вокруг. */
.dash-action-block.dash-action-emphasis {
  padding: 28px 32px;
  margin: 0 0 32px;
}
.dash-action-block.dash-action-emphasis .dash-action-card {
  font-size: 18px;
  line-height: 1.4;
  padding: 18px 20px;
}
.dash-action-block.dash-action-emphasis .dash-action-num {
  font-size: 26px;
  font-variant-numeric: tabular-nums;
}
.dash-action-block.dash-action-emphasis .dash-action-text {
  font-size: 15px;
  line-height: 1.4;
}
.dash-action-block.dash-action-emphasis .dash-section-eyebrow {
  margin-bottom: 16px;
}
/* Weekly + overload во втором ряду — light-grade лейблы. */
.dash-weekly-progress .dash-section-eyebrow,
.dash-weekly-progress .dash-weekly-text,
#dashboard-overload .dash-section-eyebrow,
#dashboard-overload .dash-overload-fio {
  color: var(--prizma-text-tertiary, var(--text-3));
}

/* AUDIT-ART #3 — KPI-grid: 4 главных + collapse «остальные».
   Главные плитки — обычный flow. Свернутые secondary прячутся в <details>. */
.kpi-card--secondary { /* модификатор для свёрнутых плиток */ }
#dashboard-kpi .kpi-collapse {
  grid-column: 1 / -1;
  margin: 4px 0 0;
  padding: 0;
}
#dashboard-kpi .kpi-collapse > summary {
  list-style: none;
  cursor: pointer;
  padding: 8px 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .7px;
  text-transform: uppercase;
  color: var(--prizma-text-tertiary, var(--text-3));
  display: flex;
  align-items: center;
  gap: 6px;
  user-select: none;
}
#dashboard-kpi .kpi-collapse > summary::-webkit-details-marker { display: none; }
#dashboard-kpi .kpi-collapse > summary::before {
  content: '';
  width: 6px; height: 6px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
  transition: transform 160ms ease;
}
#dashboard-kpi .kpi-collapse[open] > summary::before { transform: rotate(45deg); }
#dashboard-kpi .kpi-collapse-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  margin-top: 8px;
}

/* AUDIT-ART #5 — Сигналы: stripe-left по severity.
   critical → off-course, medium → drift, low — без stripe. */
.insight-list.insight-list--critical {
  border-left: 3px solid var(--prizma-off-course, #FF6B6B);
  padding-left: 12px;
}
.insight-list.insight-list--medium {
  border-left: 3px solid var(--prizma-drift, #FFB347);
  padding-left: 12px;
}
.insight-list.insight-list--low {
  border-left: none;
  padding-left: 0;
}
`;
  document.head.appendChild(style);
}

/* В action-block кнопки идут в Реестр с этими preset-фильтрами. */
const FILTER_PAYLOAD_BY_KEY = {
  blocked:       { onlyBlocking: true },
  overtime:      { release: 'overtime' },
  needs_confirm: { scope: 'Требует подтверждения' },
  risky:         { onlyRisky: true },
  no_release:    { release: 'none' },
};

/* UX 1.3 — человекочитаемые лейблы для toast при drill-фильтре.
   После navigation в Реестр info-toast подсказывает, какой фильтр
   автоматически применён, чтобы переход не выглядел как «магия». */
const FILTER_LABEL_BY_KEY = {
  blocked:       'есть блокеры',
  overtime:      'релиз Овертайм',
  needs_confirm: 'scope «Требует подтверждения»',
  risky:         'есть риск',
  no_release:    'без релиза',
};

export const DashboardView = {
  // V21 audit 3.4 — guard повторного stagger'а после первого mount'а.
  _staggered: false,

  render() {
    // F10 fix (codebase-01) + sj3 (codebase-05) — отметить рендер для guard'а.
    try { Services.App?.markRenderedNow?.(); } catch (_) {}
    // AUDIT-ART #1/#2/#3/#5 — runtime CSS-инжект (idempotent).
    injectDashboardAuditArtStyles();
    const rows = FilterEngine.getFiltered();
    DashboardView._renderPrizmaHeader(rows);
    if (!rows.length) {
      DashboardView._renderEmpty();
      return;
    }
    // V21 audit 3.1 — single-pass агрегатор, передаётся во все блоки.
    const c = computeDashboardCounters(rows);
    DashboardView.renderActionBlock(rows, c);
    // V21 tabs-consolidation (вариант A) — room «Сигналы» (бывшая вкладка
    // «Инсайты»). После action-блока, перед charts по релизам — соответствует
    // рекомендации `audit-2026-05-V21-tabs/02-insights.md` § «Вариант A».
    DashboardView.renderSignals(rows);
    DashboardView.renderProgress(rows);
    DashboardView.renderKPIs(rows, c);
    DashboardView.renderRisksPanel(c);
    DashboardView.renderReleaseBreakdown(rows);
    DashboardView.renderWeeklyProgress(c);
    DashboardView.renderOverloadBlock(c);
  },

  _renderEmpty() {
    const kpiEl = document.getElementById('dashboard-kpi');
    if (kpiEl) {
      kpiEl.innerHTML = `<div class="dash-empty">
        ${prizmaEmptyGlyph()}
        <div class="dash-empty-title">Курс ещё не проложен</div>
        <div class="dash-empty-sub">Загрузите план — увидите состояние квартала. Импортируйте XLSX или начните с шаблона.</div>
        <div class="dash-empty-actions">
          <button class="btn btn-primary btn-sm" data-dash-empty-action="import-xlsx">Импортировать XLSX</button>
          <button class="btn btn-outline btn-sm" data-dash-empty-action="demo-template">Шаблон демо</button>
        </div>
      </div>`;
      kpiEl.querySelector('[data-dash-empty-action="import-xlsx"]')?.addEventListener('click', () => {
        document.getElementById('btn-import-xlsx')?.click();
      });
      kpiEl.querySelector('[data-dash-empty-action="demo-template"]')?.addEventListener('click', () => {
        document.getElementById('ob-btn-back-demo')?.click();
      });
    }
    ['dashboard-action-block','dashboard-signals','dashboard-progress','risks-panel','release-breakdown',
     'dashboard-weekly-progress','dashboard-overload'].forEach(id => {
      const el = document.getElementById(id); if (el) el.innerHTML = '';
    });
  },

  /** V21 audit 3.2 — идемпотентность через cache-hash значений. innerHTML
   *  переписывается ТОЛЬКО когда hero-числа поменялись; aria-live больше
   *  не дёргается на каждый refresh.
   *  V21 audit 4.5 — supporting заменён на разделённые «БЭКЛОГ» и «БЕЗ КУРСА».
   */
  _heroCache: '',
  _renderPrizmaHeader(rows) {
    const section = document.getElementById('section-dashboard');
    if (!section) return;
    let host = section.querySelector('#dashboard-prizma-header');
    if (!host) {
      host = document.createElement('div');
      host.id = 'dashboard-prizma-header';
      section.insertBefore(host, section.firstChild);
    }
    const total = rows.length || 0;
    const done  = rows.filter(r => r.isDone).length;
    const risky = rows.filter(r => r.riskFlags && r.riskFlags.length).length;
    const backlog    = rows.filter(r => /бэклог|backlog/i.test(String(r.release || r.tags || ''))).length;
    const unassigned = rows.filter(r => r.isUnassigned && !/бэклог|backlog/i.test(String(r.release || r.tags || ''))).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    // AUDIT-ART #1 — hero-state по KPI %. Пороги: ≥80 on-course, 50-79 drift,
    // <50 off-course. Совпадает с уже существующим renderProgress (overload>30
    // = drift) по «эмоциональному» направлению, но привязано к курсу квартала.
    let heroState = 'on-course';
    if (pct < 50) heroState = 'off-course';
    else if (pct < 80) heroState = 'drift';
    const cacheKey = `${total}|${done}|${risky}|${backlog}|${unassigned}|${pct}|${heroState}`;
    if (cacheKey === DashboardView._heroCache) return;
    DashboardView._heroCache = cacheKey;
    host.innerHTML = `
      ${renderPageHeader('dashboard', { title: 'Курс квартала', sub: 'Где команда сейчас находится по курсу квартала.' })}
      ${renderHero({
        kpi: pct + '%',
        caption: 'КУРС КВАРТАЛА',
        state: heroState,
        supporting: [
          { num: total - done, label: 'В РАБОТЕ' },
          { num: risky,        label: 'ДРЕЙФ' },
          { num: backlog,      label: 'БЭКЛОГ' },
          { num: unassigned,   label: 'БЕЗ КУРСА' },
        ],
      })}
    `;
    // V21 audit 3.5 — aria-live ТОЛЬКО на hero-KPI, не дублируем на kpi-grid /
    // progress / weekly. Один announce per refresh достаточен.
    const heroKpi = host.querySelector('.prizma-hero-kpi');
    if (heroKpi) {
      heroKpi.setAttribute('aria-live', 'polite');
      heroKpi.setAttribute('aria-atomic', 'true');
    }
    // AUDIT-COPY #3 — KPI «БЕЗ КУРСА» нужен tooltip с расшифровкой.
    host.querySelectorAll('.prizma-hero-supporting-item').forEach(item => {
      const lab = item.querySelector('.prizma-hero-supporting-lab');
      if (!lab) return;
      const text = (lab.textContent || '').trim();
      if (text === 'БЕЗ КУРСА') {
        item.setAttribute('title', 'Задачи в скоупе квартала, но без релиза');
      }
    });
  },

  /* П4-DASHBOARD Wave 3 — Action-блок «Что требует курса сегодня».
     V21: blockingNear / otNoPeriod / risky берём из агрегатора.
     V21 audit 4.3 — добавлен subtitle с «дальним хвостом» блокеров. */
  renderActionBlock(rows, c) {
    const el = document.getElementById('dashboard-action-block');
    if (!el) return;
    const candidates = [];
    if (c.blockingNear7d > 0) {
      const tail = c.blockingFarQuarter;
      candidates.push({
        severity: 'off-course',
        num: c.blockingNear7d,
        text: c.blockingNear7d === 1 ? 'блокирующая зависимость близка к дедлайну' : `блокирующих зависимостей близки к дедлайну`,
        subtitle: tail > 0 ? `ещё ${tail} в этом квартале` : '',
        cta: 'Открыть',
        filterKey: 'blocked',
      });
    }
    if (c.otNoPeriod > 0) candidates.push({
      severity: 'off-course',
      num: c.otNoPeriod,
      text: c.otNoPeriod === 1 ? 'задача в овертайме без периода' : 'задач в овертайме без периода',
      cta: 'Завершить план',
      filterKey: 'overtime',
    });
    // V21 audit 1.3 — пороги остаются локальными констами (не магия — relative).
    const totalRows = rows.length;
    if (c.needsConfirm > Math.max(5, totalRows * 0.05)) candidates.push({
      severity: 'drift',
      num: c.needsConfirm,
      text: 'задач требуют подтверждения scope',
      cta: 'Сверить',
      filterKey: 'needs_confirm',
    });
    if (c.risky > 0) candidates.push({
      severity: 'drift',
      num: c.risky,
      text: c.risky === 1 ? 'задача с риском' : 'задач с риском',
      cta: 'Открыть',
      filterKey: 'risky',
    });
    // V21 audit 4.5 — теперь только unassigned (без бэклога), порог относительный.
    if (c.byRelease.unassigned > Math.max(15, totalRows * 0.15)) candidates.push({
      severity: 'drift',
      num: c.byRelease.unassigned,
      text: 'задач без курса',
      cta: 'Распределить',
      filterKey: 'no_release',
    });
    const sevWeight = { 'off-course': 0, 'drift': 1 };
    candidates.sort((a, b) => sevWeight[a.severity] - sevWeight[b.severity] || b.num - a.num);
    const top3 = candidates.slice(0, 3);
    if (!top3.length) {
      // AUDIT-ART #2 — `dash-action-emphasis` повышает иерархию блока (×1.6).
      el.innerHTML = `
        <div class="dash-action-block dash-action-empty dash-action-emphasis" role="region" aria-label="Что требует курса сегодня">
          <div class="dash-section-eyebrow">ЧТО ТРЕБУЕТ КУРСА СЕГОДНЯ</div>
          <div class="dash-action-empty-body">
            <div class="dash-action-empty-title">Курс ровный</div>
            <div class="dash-action-empty-sub">Сегодня всё под контролем.</div>
          </div>
        </div>`;
      return;
    }
    // V21 audit 2.2 — упрощённый aria-label (без дублирования видимого текста).
    const cardsHtml = top3.map(card => `
      <div class="dash-action-card signal-${card.severity}">
        <span class="signal-dot signal-${card.severity}" aria-hidden="true"></span>
        <span class="dash-action-num">${card.num}</span>
        <div class="dash-action-text-wrap">
          <span class="dash-action-text">${esc(card.text)}</span>
          ${card.subtitle ? `<span class="dash-action-subtitle">${esc(card.subtitle)}</span>` : ''}
        </div>
        <button class="btn btn-outline btn-sm dash-action-cta" data-filter-key="${card.filterKey}" aria-label="${esc(card.cta)}">${esc(card.cta)}</button>
      </div>`).join('');
    // AUDIT-ART #2 — `dash-action-emphasis` повышает иерархию блока (×1.6
    // плотность + воздух 32px). Иные блоки KPI/release/weekly остаются ×1.0.
    // 2026-05-10 — footer-link «Все требующие внимания» удалён по запросу:
    // дублировал переход в Реестр без полезной фильтрации.
    el.innerHTML = `
      <div class="dash-action-block dash-action-emphasis" role="region" aria-label="Что требует курса сегодня">
        <div class="dash-section-eyebrow">ЧТО ТРЕБУЕТ КУРСА СЕГОДНЯ</div>
        <div class="dash-action-list">${cardsHtml}</div>
      </div>`;
    // V21 audit 3.3 — единый overwrite-pattern на родителе вместо
    // per-button addEventListener (раньше при двух подряд render'ах
    // листенеры дублировались).
    el.onclick = (ev) => {
      const ctaBtn = ev.target.closest('[data-filter-key]');
      if (ctaBtn) {
        const filterKey = ctaBtn.dataset.filterKey;
        // AUDIT_HOLISTIC §5.1 — блокер-карточка ведёт в Сканнер (не Реестр),
        // плюс выставляем focus-якорь для cross-section preselect'а.
        // Раньше click уходил в Реестр, тимлид руками шёл в Сканнер и заново
        // фильтровал по человеку.
        if (filterKey === 'blocked') {
          try {
            Services.Focus?.set?.({
              kind: 'block-id',
              id: 'all-blocking',
              period: '7d',
              source: 'dashboard.action-block',
            });
          } catch (_) {}
          try { (Services.Nav?.goTo || Services.App?.goTo)?.('integrations'); } catch (_) {}
          return;
        }
        const payload = FILTER_PAYLOAD_BY_KEY[filterKey];
        if (payload) DashboardView._goToRegistry(payload, filterKey);
      }
    };
    DashboardView._stagger(el.querySelectorAll('.dash-action-card'), 80);
  },

  /* V21 audit 3.3 — общий помощник перехода в Реестр с фильтром.
     UX 1.3 — после navigation показываем info-toast с лейблом активного
     drill-фильтра, чтобы пользователь видел, какое подмножество показано. */
  _goToRegistry(payload, filterKey) {
    if (state.filters && typeof state.filters === 'object') {
      Object.assign(state.filters, payload);
    }
    try { window.notify?.('filters'); } catch (_) {}
    try { Services.App?.populateFilterDropdowns?.(); } catch (_) {}
    try { (Services.Nav?.goTo || Services.App?.goTo)?.('registry'); } catch (_) {}
    // UX 1.3 — info-toast (не undo, простое уведомление 3s).
    try {
      const label = filterKey ? FILTER_LABEL_BY_KEY[filterKey] : '';
      if (label) Services.Toast?.info?.(`Применён фильтр: ${label}`, { ms: 3000 });
    } catch (_) {}
  },

  /* V21 audit 3.4 — stagger только при первом mount'е dash. На последующих
     refresh (import / save / reactive notify) — без анимации, иначе мерцает. */
  _stagger(nodes, stepMs) {
    if (DashboardView._staggered) return;
    nodes.forEach((node, i) => {
      node.style.animationDelay = (i * stepMs) + 'ms';
      node.classList.add('is-emerging');
      const onEnd = () => {
        node.classList.remove('is-emerging');
        node.style.animationDelay = '';
        node.removeEventListener('animationend', onEnd);
      };
      node.addEventListener('animationend', onEnd);
    });
  },

  /* V21 tabs-consolidation (вариант A) — room «Сигналы».
     Содержимое перенесено из бывшей вкладки «Инсайты» (views/metrics.js
     InsightsView.render). Логика подсчётов сохранена 1:1. Hero-block
     убран — у Дашборда уже есть свой hero (renderPrizmaHeader).
     Источник: audit-2026-05-V21-tabs/02-insights.md § «Вариант A». */
  _splitAssignee(v) {
    return String(v || '').split(/[|,]/).map(s => s.trim()).filter(Boolean);
  },
  renderSignals(rows) {
    const wrap = document.getElementById('dashboard-signals');
    if (!wrap) return;

    const bySeverity = { high: [], medium: [], low: [] };
    const push = (severity, text, value) => bySeverity[severity].push({ text, value });

    const blockersNear = rows.filter(r => r.blockingDependency && (r.hasRelease120 || r.hasRelease121)).length;
    push('high', 'Блокеры в ближайших релизах', blockersNear);
    push('high', 'В scope без релиза', rows.filter(r => r.scopeStatus === 'Да' && r.isUnassigned).length);
    push('high', 'Задачи OT без периода работ', rows.filter(r => r.hasOvertime && (!r.workPeriodStart || !r.workPeriodEnd)).length);

    const noAssignee = rows.filter(r => !DashboardView._splitAssignee(r.assignee).length).length;
    push('medium', 'Задачи без исполнителя', noAssignee);
    push('medium', 'Сделанные без даты', rows.filter(r => r.isDone && !r.doneDate).length);
    push('medium', 'Требуют подтверждения и уже в релизе',
      rows.filter(r => r.scopeStatus === 'Требует подтверждения' &&
        (r.hasRelease120 || r.hasRelease121 || r.hasRelease122 || r.hasOvertime)).length);

    // TECH 1.1 — memoize assignee aggregation (rows × assignees forEach).
    const overloaded = _memo('signals.overloaded', rows, () => {
      const assigneeLoad = {};
      rows.forEach(r => DashboardView._splitAssignee(r.assignee).forEach(name => {
        assigneeLoad[name] = (assigneeLoad[name] || 0) + 1;
      }));
      return Object.entries(assigneeLoad).filter(([, n]) => n >= 6).sort((a, b) => b[1] - a[1]).slice(0, 8);
    });
    push('low', 'Исполнители с высокой нагрузкой (>=6 задач)', overloaded.length);

    // 2026-05-10 — карточка «Команды с наибольшей долей рисков» удалена;
    // вместе с ней снят `_memo('signals.teamRisk', ...)` builder и
    // `teamsBlock` markup — никто извне не использовал эти выкладки
    // (грепнули весь репо, references только локальные).

    const inScopeNoRelease = rows.filter(r => r.scopeStatus === 'Да' && r.isUnassigned);
    const confirmInRelease = rows.filter(r => r.scopeStatus === 'Требует подтверждения' &&
      (r.hasRelease120 || r.hasRelease121 || r.hasRelease122 || r.hasOvertime));
    const blockerNear = rows.filter(r => r.blockingDependency && (r.hasRelease120 || r.hasRelease121));

    const renderActionBtn = (label, cls, action) =>
      `<button class="btn btn-sm ${cls} insight-action-btn" data-action="${action}">${esc(label)}</button>`;
    // AUDIT-ART #5 — severity → stripe-left на корне списка.
    // critical (high) → off-course, medium → drift, low — без stripe.
    // 2026-05-10 — `low` (Операционные наблюдения) теперь получает нейтральный
    // серый stripe-left через `insight-list--neutral`, чтобы карточка имела
    // тот же visual cue, что и соседняя «Ключевые проблемы данных».
    const SEV_TO_MOD = { high: 'insight-list--critical', medium: 'insight-list--medium', low: 'insight-list--neutral' };
    const renderList = (title, sev, extra = '', actionBtn = '') => `
      <div class="insight-list ${SEV_TO_MOD[sev] || ''}">
        <div class="insight-list-head">
          <div class="data-table-title">${esc(title)}</div>
          ${actionBtn ? `<div class="insight-list-actions">${actionBtn}</div>` : ''}
        </div>
        ${bySeverity[sev].map(i => `<div class="insight-item"><span>${esc(i.text)}</span><span class="insight-badge ${sev}">${i.value}</span></div>`).join('')}
        ${extra}
      </div>`;

    const overloadBlock = overloaded.length
      ? `<div style="margin-top:8px">${overloaded.map(([name, count]) =>
          `<div class="insight-item"><span>${esc(name)}</span><span>${count}</span></div>`).join('')}</div>`
      : '<div class="empty-inline">Перегруженных исполнителей нет</div>';

    const highActionBtn    = inScopeNoRelease.length ? renderActionBtn('Назначить в 1.20 →', 'btn-primary', 'assign_120') : '';
    const medActionBtn     = confirmInRelease.length ? renderActionBtn('Перевести в "Да" →', 'btn-outline', 'confirm_scope') : '';
    const blockerActionBtn = blockerNear.length      ? renderActionBtn('Снять блокеры →',    'btn-danger',  'clear_blockers') : '';

    const totalSignals = bySeverity.high.length + bySeverity.medium.length;
    const summary = bySeverity.high.some(s => s.value > 0)
      ? `${totalSignals} активных, есть критические`
      : `${totalSignals} активных`;

    wrap.innerHTML = `
      <details class="dash-collapsible dashboard-signals-room" open>
        <summary class="dash-collapsible-summary">
          <div class="dash-section-eyebrow">СИГНАЛЫ</div>
          <span class="dashboard-signals-summary">${esc(summary)}</span>
        </summary>
        <div class="dashboard-signals-body">
          <div class="summary-grid" style="margin-bottom:12px">
            ${renderList('Критические сигналы', 'high', '', highActionBtn + blockerActionBtn)}
            ${renderList('Сигналы внимания',     'medium', '', medActionBtn)}
          </div>
          <div class="summary-grid summary-grid--2col">
            ${renderList('Операционные наблюдения', 'low', overloadBlock)}
            <div class="insight-list insight-list--neutral">
              <div class="data-table-title" style="margin-bottom:6px">Ключевые проблемы данных</div>
              <div class="insight-item"><span>Строки без категории</span><span class="insight-badge medium">${rows.filter(r => !String(r.category || '').trim()).length}</span></div>
              <div class="insight-item"><span>Строки без роли</span><span class="insight-badge medium">${rows.filter(r => !String(r.role || '').trim()).length}</span></div>
              <div class="insight-item"><span>Строки без эпика</span><span class="insight-badge low">${rows.filter(r => !String(r.epic || '').trim()).length}</span></div>
              <div class="insight-item"><span>Риски в закрытых задачах</span><span class="insight-badge low">${rows.filter(r => r.isDone && r.riskFlags && r.riskFlags.length).length}</span></div>
            </div>
          </div>
        </div>
      </details>
    `;
  },

  /* V21 audit 4.1 — KPI генерируются циклом по RELEASE_FIELDS.
     V21 audit 3.1 — счётчики из агрегатора.
     V21 audit 4.5 — «Без курса» = unassigned (бэклог отдельно).
     AUDIT-ART #3 — 4 главных + <details> «остальные». 4 primary KPI несут
     «курс»-семантику: общий объём (Всего), потеря курса (Без курса), внешние
     препятствия (Блокирующих зав.), внутренние риски (Строк с рисками).
     Остальные 8+ — коллапсятся, состояние сохраняется в localStorage. */
  renderKPIs(rows, c) {
    const releaseKpis = RELEASE_FIELDS
      .filter(R => R.key !== 'overtime')
      .map(R => ({
        label: 'В ' + R.label.toLowerCase(),
        value: c.byRelease[R.key].total,
        cls: 'kpi-secondary kpi-neutral',
        key: R.key,
      }));
    const kpis = [
      { label: 'Всего задач',     value: c.total,                 cls: 'kpi-secondary kpi-neutral',                                                          key: 'total' },
      { label: 'В scope (Да)',    value: c.scopeYes,              cls: 'kpi-secondary kpi-neutral',                                                          key: 'scope_yes' },
      { label: 'Вне scope (Нет)', value: c.scopeNo,               cls: 'kpi-secondary kpi-neutral',                                                          key: 'scope_no' },
      { label: 'Треб. подтв.',    value: c.needsConfirm,          cls: 'kpi-primary signal-drift',                                                           key: 'needs_confirm' },
      ...releaseKpis,
      { label: 'В овертайме',     value: c.byRelease.overtime.total, cls: 'kpi-primary signal-off-course',                                                  key: 'overtime' },
      { label: 'Бэклог',          value: c.byRelease.backlog,     cls: 'kpi-secondary kpi-neutral',                                                          key: 'backlog' },
      { label: 'Без курса',       value: c.byRelease.unassigned,  cls: 'kpi-primary signal-drift',                                                           key: 'no_release' },
      { label: 'Блокирующих зав.',value: c.blocking,              cls: 'kpi-primary signal-off-course',                                                      key: 'blocked' },
      { label: 'Строк с рисками', value: c.risky,                 cls: c.risky > 0 ? 'kpi-primary signal-off-course' : 'kpi-secondary kpi-neutral',          key: 'risky' },
      { label: 'Сделано',         value: c.done,                  cls: 'kpi-secondary kpi-neutral',                                                          key: 'done' },
    ];
    // AUDIT-ART #3 — главные плитки выбраны по «компас»-семантике.
    const PRIMARY_KEYS = new Set(['total', 'no_release', 'blocked', 'risky']);
    const primary = kpis.filter(k => PRIMARY_KEYS.has(k.key));
    const secondary = kpis.filter(k => !PRIMARY_KEYS.has(k.key));
    // AUDIT-ART #3 — open-state сохраняется между сессиями.
    let expanded = false;
    try { expanded = localStorage.getItem('prizma.dashboard.kpiExpanded') === 'true'; } catch (_) {}
    const renderCard = (k, extraCls = '') => `
      <div class="kpi-card kpi-card-clickable ${k.cls}${extraCls ? ' ' + extraCls : ''}" role="button" tabindex="0" data-kpi="${k.key}" aria-label="${esc(k.label)}: ${k.value}"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div></div>`;
    const el = document.getElementById('dashboard-kpi');
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Состояние курса — KPI карточки');
    // V21 audit 3.5 — aria-live снят с kpi-grid.
    el.removeAttribute('aria-live');
    // V21 audit 2.2 — короткий aria-label (без «открыть в реестре, перейти…»).
    const primaryHtml = primary.map(k => renderCard(k)).join('');
    const secondaryHtml = secondary.map(k => renderCard(k, 'kpi-card--secondary')).join('');
    el.innerHTML = `${primaryHtml}<details class="kpi-collapse"${expanded ? ' open' : ''}><summary>Показать остальные KPI</summary><div class="kpi-collapse-grid">${secondaryHtml}</div></details>`;
    DashboardView._stagger(el.querySelectorAll('.kpi-card'), 50);
    // AUDIT-ART #3 — persist open/closed.
    const detailsEl = el.querySelector('.kpi-collapse');
    if (detailsEl) {
      detailsEl.addEventListener('toggle', () => {
        try { localStorage.setItem('prizma.dashboard.kpiExpanded', String(detailsEl.open)); } catch (_) {}
      });
    }
    // KPI клик: единый dispatcher.
    el.onclick = (ev) => DashboardView._handleKpiClick(ev, rows);
    el.onkeydown = (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const card = ev.target.closest('[data-kpi]'); if (!card) return;
      ev.preventDefault();
      card.click();
    };
  },

  _handleKpiClick(ev, rows) {
    const card = ev.target.closest('[data-kpi]'); if (!card) return;
    const key   = card.dataset.kpi;
    const label = card.querySelector('.kpi-label').textContent;
    const filterFn = DashboardView._kpiFilterFn(key, rows);
    DashboardView.openKpiModal(label, filterFn ? filterFn() : [], key);
  },

  /* V21 audit 4.1 — фильтры тоже генерятся из RELEASE_FIELDS. */
  _kpiFilterFn(key, rows) {
    if (key === 'total')        return () => rows;
    if (key === 'scope_yes')    return () => rows.filter(r => r.scopeStatus === 'Да');
    if (key === 'scope_no')     return () => rows.filter(r => r.scopeStatus === 'Нет');
    if (key === 'needs_confirm')return () => rows.filter(r => r.scopeStatus === 'Требует подтверждения');
    if (key === 'no_release')   return () => rows.filter(r => r.isUnassigned && !/бэклог|backlog/i.test(String(r.release || r.tags || '')));
    if (key === 'backlog')      return () => rows.filter(r => /бэклог|backlog/i.test(String(r.release || r.tags || '')));
    if (key === 'blocked')      return () => rows.filter(r => r.blockingDependency);
    if (key === 'risky')        return () => rows.filter(r => r.riskFlags && r.riskFlags.length);
    if (key === 'done')         return () => rows.filter(r => r.isDone);
    const R = RELEASE_FIELDS.find(R => R.key === key);
    if (R) return () => rows.filter(r => r[R.has]);
    return null;
  },

  /* V21 audit 2.3 — progress-cards получают signal-stripe при перегрузке. */
  renderProgress(rows) {
    const el = document.getElementById('dashboard-progress');
    if (!el) return;
    const p = computeProgress(rows);
    const releases = [
      { key: '120', label: '1.20', color: 'var(--release-r120-color)' },
      { key: '121', label: '1.21', color: 'var(--release-r121-color)' },
      { key: '122', label: '1.22', color: 'var(--release-r122-color)' },
      { key: 'ot',  label: 'OT',   color: 'var(--release-ot-color)' },
      { key: 'all', label: 'Всего',color: 'var(--release-none-color)' },
    ];
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Курс по релизам');
    const releaseToKpiKey = { '120':'r120', '121':'r121', '122':'r122', 'ot':'overtime', 'all':'total' };
    el.innerHTML = releases.map(r => {
      const d = p[r.key] || { total:0, done:0, pct:0 };
      const overload = d.total > 30 && r.key !== 'all';
      const stripe = overload ? ' signal-drift' : '';
      const kpiKey = releaseToKpiKey[r.key];
      return `<div class="progress-card progress-card-clickable${stripe}" role="button" tabindex="0" data-progress-kpi="${kpiKey}" aria-label="${esc(r.label)}: ${d.done} из ${d.total} задач, ${d.pct}%">
        <div class="progress-card-header">
          <span class="progress-label">${r.label}</span>
          <span class="progress-counts">${d.done} / ${d.total} задач${overload ? ' <span class="signal-dot signal-drift" role="img" aria-label="Перегрузка"></span>' : ''}</span>
        </div>
        <div class="progress-bar-wrap" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${d.pct}" aria-label="${esc(r.label)}: ${d.done} из ${d.total} задач">
          <div class="progress-bar-fill" style="width:${d.pct}%;background:${r.color}"></div>
        </div>
        <div class="progress-pct">${d.pct}%</div>
      </div>`;
    }).join('');
    const kpiFilters = {
      r120:    () => rows.filter(r => r.hasRelease120),
      r121:    () => rows.filter(r => r.hasRelease121),
      r122:    () => rows.filter(r => r.hasRelease122),
      overtime:() => rows.filter(r => r.hasOvertime),
      total:   () => rows,
    };
    const onActivate = (card) => {
      const key = card.dataset.progressKpi;
      const label = card.querySelector('.progress-label').textContent;
      const filterFn = kpiFilters[key];
      if (!filterFn) return;
      DashboardView.openKpiModal(`Релиз ${label}`, filterFn(), key === 'total' ? null : key);
    };
    el.onclick = (ev) => { const card = ev.target.closest('[data-progress-kpi]'); if (card) onActivate(card); };
    el.onkeydown = (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const card = ev.target.closest('[data-progress-kpi]'); if (!card) return;
      ev.preventDefault(); onActivate(card);
    };
  },

  openKpiModal(title, rows, kpiKey) {
    const overlay = document.getElementById('modal-kpi');
    if (overlay) overlay.dataset.owner = 'dashboard';
    document.getElementById('modal-kpi-title').textContent = title;
    const body = document.getElementById('modal-kpi-body');
    const cta = document.getElementById('modal-kpi-goto-registry');
    if (cta) {
      // V21 audit 4.1 — release payload тоже из RELEASE_FIELDS.
      const releaseFilterByKpi = Object.fromEntries(
        RELEASE_FIELDS.map(R => [R.key, { release: R.short.toLowerCase() }])
      );
      const filterPayloadByKpi = {
        scope_yes:    { scope: 'Да' },
        scope_no:     { scope: 'Нет' },
        needs_confirm:{ scope: 'Требует подтверждения' },
        ...releaseFilterByKpi,
        overtime:     { release: 'overtime' },
        no_release:   { release: 'none' },
        backlog:      { release: 'backlog' },
        blocked:      { onlyBlocking: true },
        risky:        { onlyRisky: true },
        done:         { onlyDone: true },
      };
      const payload = filterPayloadByKpi[kpiKey];
      cta.style.display = payload ? '' : 'none';
      cta.onclick = () => {
        if (!payload) return;
        if (state.filters && typeof state.filters === 'object') {
          Object.assign(state.filters, payload);
        }
        try { window.notify?.('filters'); } catch (_) {}
        try { Services.App?.populateFilterDropdowns?.(); } catch (_) {}
        overlay.classList.add('hidden');
        try { (Services.Nav?.goTo || Services.App?.goTo)?.('registry'); } catch (_) {}
      };
    }
    if (!rows.length) { body.innerHTML = '<div style="padding:20px;color:var(--text-3)">Нет строк</div>'; }
    else {
      body.innerHTML = `<table class="data-table" style="width:100%">
        <thead><tr><th>Команда</th><th>Эпик</th><th>Задачи</th><th>Scope</th><th>Категория</th><th>Теги</th><th>Релизы</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td>${esc(r.team || '—')}</td>
          <td>${esc(r.epic || '—')}</td>
          <td style="max-width:200px"><div class="tasks-cell">${RH.jiraTagsHtml(r.tasks)}</div></td>
          <td>${RH.scopeChip(r.scopeStatus)}</td>
          <td>${esc(r.category || '—')}</td>
          <td>${esc(r.tags || '—')}</td>
          <td>${RH.releaseChips(r)}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    }
    document.getElementById('modal-kpi').classList.remove('hidden');
  },

  /* V21 audit 4.4 — risk-flags сортируются по убыванию. */
  renderRisksPanel(c) {
    const el = document.getElementById('risks-panel');
    const entries = Object.entries(c.byRiskFlag).sort((a, b) => b[1] - a[1]);
    if (!entries.length) { el.innerHTML = ''; return; }
    const total = entries.reduce((s, [, n]) => s + n, 0);
    el.innerHTML = `<details class="dash-collapsible">
      <summary class="dash-collapsible-summary">
        <span class="dash-section-eyebrow">АКТИВНЫЕ РИСКИ <span class="count-badge">${total}</span></span>
      </summary>
      <div class="risks-panel-items">${
        entries.map(([f, n]) => `<div class="risk-counter"><div class="risk-counter-value">${esc(n)}</div><div class="risk-counter-label">${esc(RISK_FLAGS[f] || f)}</div></div>`).join('')
      }</div>
    </details>`;
  },

  /* V21 audit 4.1 — release-breakdown тоже циклом из RELEASE_FIELDS. */
  renderReleaseBreakdown(rows) {
    const el = document.getElementById('release-breakdown');
    if (!el) return;
    // TECH 1.1 — memoize per-release breakdown (rows × workTypes × scopes).
    // Cache vs render flow: вся карточка считается из rr (filtered rows).
    const breakdownData = _memo('releaseBreakdown.data', rows, () => {
      return RELEASE_FIELDS.map(R => {
        const rr = rows.filter(r => r[R.has]);
        const wtMap = {};
        rr.forEach(r => (r[R.tf] || []).forEach(t => { wtMap[t] = (wtMap[t] || 0) + 1; }));
        const scMap = { 'Да': 0, 'Нет': 0, 'Требует подтверждения': 0 };
        rr.forEach(r => { if (r.scopeStatus in scMap) scMap[r.scopeStatus]++; });
        const done = rr.filter(r => r.isDone).length;
        return { key: R.key, total: rr.length, wtMap, scMap, done };
      });
    });
    const cards = RELEASE_FIELDS.map((R, i) => {
      const rw = RELEASE_WINDOWS[R.key];
      const d = breakdownData[i];
      const wtMap = d.wtMap;
      const scMap = d.scMap;
      const done = d.done;
      return `<div class="release-card">
        <div class="release-card-header"><div class="release-card-title">${esc(rw.label)}</div><div class="release-card-dates">${esc(rw.dates)}</div></div>
        <div class="release-card-count">${d.total} задач</div>
        <div class="mini-breakdown">
          <div class="mini-breakdown-row"><span class="mini-breakdown-label">В scope (Да)</span><span class="mini-breakdown-val">${scMap['Да']}</span></div>
          <div class="mini-breakdown-row"><span class="mini-breakdown-label">Треб. подтв.</span><span class="mini-breakdown-val">${scMap['Требует подтверждения']}</span></div>
          <div class="mini-breakdown-row"><span class="mini-breakdown-label">Сделано</span><span class="mini-breakdown-val">${done}</span></div>
          ${Object.entries(wtMap).slice(0, 3).map(([t, n]) => `<div class="mini-breakdown-row"><span class="mini-breakdown-label">${esc(t)}</span><span class="mini-breakdown-val">${n}</span></div>`).join('')}
        </div></div>`;
    }).join('');
    el.innerHTML = `<details class="dash-collapsible">
      <summary class="dash-collapsible-summary">
        <span class="dash-section-eyebrow">ДЕТАЛИЗАЦИЯ ПО РЕЛИЗАМ</span>
      </summary>
      <div class="release-breakdown-grid release-breakdown-grid-inner">${cards}</div>
    </details>`;
  },

  /* V21 audit 4.6 — «Сделано за неделю». Positive-feedback блок: видим
     что команда закрыла за последние 7 дней. closedAt берётся из row.
     Если у строк нет closedAt / actualDoneDate / doneDate — блок скрыт. */
  renderWeeklyProgress(c) {
    const el = document.getElementById('dashboard-weekly-progress');
    if (!el) return;
    if (!c.doneRecent7d) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div class="dash-weekly-progress" role="region" aria-label="Прогресс за неделю">
        <div class="dash-section-eyebrow">ПРОГРЕСС ЗА НЕДЕЛЮ</div>
        <div class="dash-weekly-content signal-on-course">
          <span class="dash-weekly-num">${c.doneRecent7d}</span>
          <span class="dash-weekly-text">${c.doneRecent7d === 1 ? 'задача завершена за последние 7 дней' : 'задач завершено за последние 7 дней'}</span>
        </div>
      </div>`;
  },

  /* V21 audit 4.2 — «Перегрузка инженеров». Кто работает в OT при незакрытых
     1.22-задачах. Используем агрегатор. Если нет таких — блок скрыт. */
  renderOverloadBlock(c) {
    const el = document.getElementById('dashboard-overload');
    if (!el) return;
    if (!c.overloadEngineers || !c.overloadEngineers.length) { el.innerHTML = ''; return; }
    const top = c.overloadEngineers.slice(0, 5);
    const rest = c.overloadEngineers.length - top.length;
    const itemsHtml = top.map(e => `
      <div class="dash-overload-row">
        <span class="dash-overload-fio">${esc(e.fio)}</span>
        <span class="dash-overload-counts"><span class="dash-overload-tag dash-overload-ot">OT ${e.ot}</span><span class="dash-overload-tag dash-overload-r122">1.22 ${e.r122}</span></span>
      </div>`).join('');
    el.innerHTML = `
      <details class="dash-collapsible">
        <summary class="dash-collapsible-summary">
          <span class="dash-section-eyebrow">ПЕРЕГРУЗКА ИНЖЕНЕРОВ <span class="count-badge">${c.overloadEngineers.length}</span></span>
        </summary>
        <div class="dash-overload-list signal-drift">${itemsHtml}${rest > 0 ? `<div class="dash-overload-rest">и ещё ${rest}…</div>` : ''}</div>
      </details>`;
  },
};
