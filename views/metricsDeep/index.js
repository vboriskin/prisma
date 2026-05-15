'use strict';
/* ============================================================
   METRICS DEEP — 3-я подвкладка Сканнера команды

   Архитектура:
     · `renderHtml(model)` → HTML-строка-скаффолд (категории + canvas-divs)
     · `mount(rootEl, model)` → init ECharts на canvas-div'ах батчами по 8
       через `requestIdleCallback` (см. processBatch).
     · `unmount(rootEl)` → dispose всех instance'ов, снимает resize-listener.

   AUDIT_SCANNER_METRICS F-PERF-1 — раньше комментарий обещал «IntersectionObserver,
   чарт init'ится только когда виден», но фактически processBatch инициализирует
   все чарты сразу. Расхождение doc vs code устранено: текст теперь честный.
   `_ioMounter` ниже — placeholder, реально не использется. TODO: либо реально
   подключить IO (чтобы init только видимых), либо удалить переменную.

   ECharts грузится через `await import()` внутри mount (V21 audit P1):
     1MB бандл едет по сети только при первом hit на вкладку «Метрики»,
     а не при каждом mount Сканнера.
   ============================================================ */

import { buildPrizmaEchartsTheme } from './echartsPrizmaTheme.js';
import { VELOCITY_CHARTS } from './categories/velocity.js';
import { QUALITY_CHARTS }  from './categories/quality.js';
import { PEOPLE_CHARTS }   from './categories/people.js';
import { DEPS_CHARTS }     from './categories/dependencies.js';
import { ACTIVITY_CHARTS } from './categories/activity.js';
import { HEALTH_CHARTS }   from './categories/health.js';
import { adaptModelToData } from './dataAdapter.js';

/** Map<canvasEl, ECharts instance>. Не WeakMap — нужен явный обход для
 *  resize/unmount, и canvas'ы и так отстаются жить пока висит DOM. */
const _instances = new Map();
let _echartsModule = null;        // lazily-loaded ECharts namespace
let _ioMounter = null;            // IntersectionObserver
let _resizeHandler = null;        // bound debounced resize
let _activeRoot = null;           // current mounted root

/** A5 — registry чартов как Map для O(1) lookup (вместо .find на 60 elem). */
const ALL_CHARTS = new Map();
for (const list of [VELOCITY_CHARTS, QUALITY_CHARTS, PEOPLE_CHARTS, DEPS_CHARTS, ACTIVITY_CHARTS, HEALTH_CHARTS]) {
  for (const c of list) ALL_CHARTS.set(c.id, c);
}

/* ── Scaffold ─────────────────────────────────────── */

/** Per-category section. Содержит чарт-карточки. */
function _section(title, hint, charts) {
  return `
    <section class="md-deep-cat">
      <h3 class="md-deep-cat-title">${title} <span class="md-deep-cat-hint">— ${hint}</span></h3>
      <div class="md-deep-grid">
        ${charts.map(c => `
          <div class="md-chart" data-chart-id="${c.id}">
            <div class="md-chart-head">
              <div class="md-chart-title">${c.title}</div>
              <div class="md-chart-sub">${c.sub || ''}</div>
            </div>
            <div class="md-chart-canvas" id="md-chart-${c.id}"></div>
            <div class="md-chart-hint">${c.hint || ''}</div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

/** Все 6 категорий, 60 чартов. Brandbook §4 — все подписи на русском.
 *  V21 — `md-deep--mounting` modifier hides пустые canvas-div'ы до того как
 *  ECharts успеет их заполнить (CSS-fade при снятии класса). Без этого юзер
 *  видел два кадра: scaffold + содержимое = «двойное мигание». */
export function renderHtml(_model) {
  /* AUDIT_SCANNER_METRICS F-DUP-1 — TODO: rename sub-tab label "Метрики" → "Графики команды" в teamScanner2Renderer.js (другой агент сделает) */
  return `
    <div class="md-deep md-deep--mounting">
      <div class="md-deep-intro">
        <span class="md-deep-intro-eyebrow">СКАННЕР · КОМАНДА + ЛЮДИ</span>
        <h2 class="md-deep-intro-title">Графики команды</h2>
        <p class="md-deep-intro-text">6 категорий, 60 чартов. Каждый имеет inline-подсказку «зачем». Тема — Призма, light/dark sync. Графики реагируют на изменение состава задач.</p>
      </div>
      <div class="metrics-deep-period-bar">
        <label for="metrics-deep-period">Период:</label>
        <select id="metrics-deep-period">
          <option value="7d">7 дней</option>
          <option value="30d" selected>30 дней</option>
          <option value="90d">90 дней</option>
          <option value="quarter">Квартал</option>
        </select>
      </div>
      ${_section('1. Темп и курс',          'скорость команды',         VELOCITY_CHARTS)}
      ${_section('2. Качество',             'риски · оценки · scope',   QUALITY_CHARTS)}
      ${_section('3. Команды и люди',       'нагрузка · овертайм',      PEOPLE_CHARTS)}
      ${_section('4. Зависимости',          'между командами · блокеры',DEPS_CHARTS)}
      ${_section('5. Активность',           'хроника · календарь',      ACTIVITY_CHARTS)}
      ${_section('6. Здоровье',             'индикаторы · оповещения',  HEALTH_CHARTS)}
    </div>
  `;
}

/* ── Mount / Unmount ──────────────────────────────── */

/** Mount ECharts instances. Init батчами по 8 через requestIdleCallback
 *  (V21 audit A3 — заменил sync 60 init'ов на yield-cooperative батчинг).
 *  AUDIT_SCANNER_METRICS F-PERF-1 — комментарий синхронизирован с реализацией;
 *  IntersectionObserver обещался, но не использовался — это TODO, не сделано. */
export async function mount(rootEl, model) {
  if (!rootEl) return;
  // V21 audit P1 — ECharts грузится по требованию, не на старте Сканнера.
  if (!_echartsModule) {
    try {
      _echartsModule = await import('../../libs/echarts.esm.min.js');
    } catch (e) {
      try { console.error('[metricsDeep] ECharts load failed:', e); } catch (_) {}
      rootEl.innerHTML = `<div class="md-deep-error">Не удалось загрузить библиотеку графиков</div>`;
      return;
    }
  }
  // V21 audit A1 — перед mount'ом снимаем предыдущие instance'ы (защита
  // от двойного mount при scanner refresh).
  unmount(_activeRoot);
  _activeRoot = rootEl;

  // V21 audit A2 — registerTheme идемпотентен по name, кэширует первый
  // вариант → переключение light/dark не обновляло palette. Решение:
  // регистрируем тему под уникальным именем (light/dark), используем его.
  const themeMode = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
  const themeName = `prizma-${themeMode}`;
  _echartsModule.registerTheme(themeName, buildPrizmaEchartsTheme());

  // V21 audit A3 — Batch-init чартов по 8 чтобы не фризить main thread.
  // 60 синхронных ECharts.init = ~400ms jank (reported by user as «зависание»).
  // requestIdleCallback + setTimeout-fallback позволяет браузеру перерисоваться
  // и обработать input между батчами. md-deep--mounting снимается после финального
  // батча (ранее снималось сразу — теперь откладывается вместе с init'ами).
  const canvases = Array.from(rootEl.querySelectorAll('.md-chart-canvas'));
  const deep = rootEl.querySelector('.md-deep');
  const BATCH = 8;
  let batchIdx = 0;
  /* AUDIT_SCANNER_METRICS F-PERF-3 — TODO: pre-compute aggregation per category once,
     передавать build'ерам через extended data{}; сейчас каждый build делает 4-8
     rows.filter() = O(rows × charts). */
  const processBatch = () => {
    if (rootEl !== _activeRoot) return;           // root сменился — стоп
    const end = Math.min(batchIdx + BATCH, canvases.length);
    for (; batchIdx < end; batchIdx++) {
      _initChart(canvases[batchIdx], model, themeName);
    }
    if (batchIdx < canvases.length) {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(processBatch, { timeout: 300 });
      } else {
        setTimeout(processBatch, 0);
      }
    } else if (deep) {
      deep.classList.remove('md-deep--mounting');
    }
  };
  processBatch();

  // V21 audit A4 — debounced resize + cleanup в unmount (раньше listener
  // оставался жить навсегда, тёк на каждом SPA-переходе).
  if (_resizeHandler) window.removeEventListener('resize', _resizeHandler);
  let _resizeTimer = 0;
  _resizeHandler = () => {
    if (_resizeTimer) cancelAnimationFrame(_resizeTimer);
    _resizeTimer = requestAnimationFrame(() => {
      for (const inst of _instances.values()) {
        try { inst.resize(); } catch (_) {}
      }
    });
  };
  window.addEventListener('resize', _resizeHandler, { passive: true });

  // F-NAV-3 — period filter selector. Восстанавливает persisted значение,
  // bind change-handler → localStorage + custom event 'metricsDeep:periodChange'.
  // TODO: прокинуть data.period в build'еры (сейчас чарты не реагируют).
  try {
    const periodSel = rootEl.querySelector('#metrics-deep-period');
    if (periodSel) {
      try {
        const persisted = localStorage.getItem('q2_metricsDeep_period');
        if (persisted) periodSel.value = persisted;
      } catch (_) { /* ignore */ }
      periodSel.addEventListener('change', (ev) => {
        const v = ev.target?.value || '30d';
        try { localStorage.setItem('q2_metricsDeep_period', v); } catch (_) {}
        try {
          window.dispatchEvent(new CustomEvent('metricsDeep:periodChange', { detail: { period: v } }));
        } catch (_) {}
      });
    }
  } catch (_) { /* ignore */ }
}

/** Init одного chart canvas'а — приватный, вызывается из IO callback. */
function _initChart(canvasEl, model, themeName) {
  if (!_echartsModule || !canvasEl) return;
  const id = canvasEl.id.replace(/^md-chart-/, '');
  const found = ALL_CHARTS.get(id);
  if (!found) return;

  try {
    const data = adaptModelToData(model);
    // V21 audit D2 — синтетика больше не наследуется. Если нет ни одной
    // реальной задачи / участника команды — рисуем «недостаточно данных»,
    // не показываем фейковые синусоиды как реальные показатели.
    if (!data.hasReal) {
      _renderEmpty(canvasEl);
      return;
    }
    /* AUDIT_SCANNER_METRICS F-DUP-3 — TODO: для upcoming-burnup использовать
       `buildBurnupData` из integrations/teamScanner2Insights.js как единственный
       источник, не дублировать собственным вычислением в build'ере. */
    const opt = found.build(data, _palette());
    if (!opt) {
      _renderEmpty(canvasEl);
      return;
    }
    const inst = _echartsModule.init(canvasEl, themeName, { renderer: 'canvas' });
    inst.setOption(opt);
    _instances.set(canvasEl, inst);
  } catch (e) {
    // V21 audit R1 — не молчим, рисуем fallback UI вместо пустоты.
    try { console.warn('[metricsDeep]', id, 'failed:', e?.message || e); } catch (_) {}
    _renderError(canvasEl);
  }
}

function _renderEmpty(c) {
  c.innerHTML = `<div class="md-chart-empty">Недостаточно данных</div>`;
}
function _renderError(c) {
  c.innerHTML = `<div class="md-chart-error">Не удалось отрисовать</div>`;
}

/** Dispose ECharts instances + снять observers/listeners. */
export function unmount(rootEl) {
  if (!rootEl) {
    // Cleanup global listeners даже если rootEl нет — на случай повторного
    // unmount после смены страницы.
    if (_resizeHandler) {
      window.removeEventListener('resize', _resizeHandler);
      _resizeHandler = null;
    }
    if (_ioMounter) { try { _ioMounter.disconnect(); } catch (_) {} _ioMounter = null; }
    return;
  }
  rootEl.querySelectorAll('.md-chart-canvas').forEach(c => {
    const inst = _instances.get(c);
    if (inst) {
      try { inst.dispose(); } catch (_) {}
      _instances.delete(c);
    }
  });
  if (rootEl === _activeRoot) {
    _activeRoot = null;
    if (_resizeHandler) { window.removeEventListener('resize', _resizeHandler); _resizeHandler = null; }
    if (_ioMounter)     { try { _ioMounter.disconnect(); } catch (_) {} _ioMounter = null; }
  }
}

/** V21 audit P3 — сообщает caller'у нужен ли re-mount: canvas'ы свежесгенерены
 *  но не имеют instance'ов (после scanner re-paint). */
export function needsMount(rootEl) {
  if (!rootEl) return false;
  const canvases = rootEl.querySelectorAll('.md-chart-canvas');
  if (!canvases.length) return false;
  // Если хоть один canvas — новый DOM-нод (нет в _instances), нужен re-mount.
  for (const c of canvases) {
    if (!_instances.has(c)) return true;
  }
  return false;
}

/* ── Helpers ──────────────────────────────────────── */

/** Resolve current Prizma palette colors for inline series-styling. */
function _palette() {
  const t = buildPrizmaEchartsTheme();
  return t.color || ['#6EC1E4', '#7FE8B5', '#FFB347', '#FF6B6B', '#B084CC'];
}
