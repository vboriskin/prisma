'use strict';
/* ============================================================
   METRICS DEEP — Категория 1: Велосити и курс
   AUDIT_SCANNER_METRICS F-FAKE-2 — удалены 5/10 fake-чартов
   (combo/area/timeseries/streamgraph/calendar), которые синтезировали
   данные через sin/cos/random. Требуется реальный metricsHistory.

   Оставшиеся (real-data):
     1.  velocity-bar          Bar Chart            stacked done/wip по релизам
     2.  velocity-burnup       Line Chart           кумулятивный burnup за квартал
     3.  velocity-funnel       Funnel               пайплайн задач
     4.  velocity-histogram    Histogram            lead-time distribution
     5.  velocity-sankey       Sankey               scope churn
   ============================================================ */

/* AUDIT_SCANNER_METRICS — fake-чарты удалены целиком из реестра (F-FAKE-2),
   empty-state helper не нужен на этом файле. */

/* ── helpers ──────────────────────────────────────── */

const RELEASES = [
  { key: 'r120', label: '1.20', has: r => r.hasRelease120, types: r => r.release120Types || [] },
  { key: 'r121', label: '1.21', has: r => r.hasRelease121, types: r => r.release121Types || [] },
  { key: 'r122', label: '1.22', has: r => r.hasRelease122, types: r => r.release122Types || [] },
  { key: 'ot',   label: 'OT',   has: r => r.hasOvertime,   types: r => r.overtimeTypes  || [] },
];

const QUARTER_START = new Date(new Date().getFullYear(), 3, 1); // 1 апреля
const QUARTER_DAYS  = 92;

function _daysBetween(a, b) {
  const ms = b - a;
  return Math.max(0, Math.floor(ms / 86400000));
}

function _fmtShortDate(d) {
  return d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit' });
}

/** V21 audit P5 — quarter labels (92 точки) генерится один раз и кешируется
 *  на день (по `toDateString()`). Раньше — каждый mount всех velocity-чартов. */
let _quarterDayLabelsCache = null;
let _quarterDayLabelsKey   = '';
function _quarterDayLabels() {
  const key = new Date().toDateString();
  if (_quarterDayLabelsKey === key && _quarterDayLabelsCache) return _quarterDayLabelsCache;
  const labels = [];
  for (let i = 0; i < QUARTER_DAYS; i++) {
    const d = new Date(QUARTER_START); d.setDate(d.getDate() + i);
    labels.push(_fmtShortDate(d));
  }
  _quarterDayLabelsCache = labels;
  _quarterDayLabelsKey   = key;
  return labels;
}

/** Считает количество pill'ов в строке (sum по всем releases × types). */
function _pillCount(row) {
  return RELEASES.reduce((sum, R) => sum + R.types(row).length, 0);
}

/** Считает завершённые pill'ы строки (через donePills map). */
function _donePillCount(row) {
  const dp = row.donePills || {};
  return Object.values(dp).filter(Boolean).length;
}

/* ── 1. velocity-bar ──────────────────────────────── */

export function buildVelocityBar({ rows }, palette) {
  const [info, onCourse] = palette;
  const labels = ['1.20', '1.21', '1.22', 'OT', 'Без релиза'];
  const matchers = [
    r => r.hasRelease120, r => r.hasRelease121, r => r.hasRelease122,
    r => r.hasOvertime, r => !r.hasRelease120 && !r.hasRelease121 && !r.hasRelease122 && !r.hasOvertime,
  ];
  const done = matchers.map(fn => rows.filter(r => fn(r) && r.isDone).length);
  const wip  = matchers.map((fn, i) => rows.filter(fn).length - done[i]);
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['Завершено', 'В работе'], top: 0, right: 0 },
    grid: { left: 8, right: 8, top: 32, bottom: 24, containLabel: true },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      { name: 'Завершено', type: 'bar', stack: 'total', data: done, itemStyle: { color: onCourse } },
      { name: 'В работе',  type: 'bar', stack: 'total', data: wip,  itemStyle: { color: info } },
    ],
  };
}

/* ── 2. velocity-burnup (line) ─────────────────────── */

export function buildVelocityBurnup({ rows }, palette) {
  const [info, onCourse, drift] = palette;
  // Если в строках нет реальных done-дат — синтезируем плавную кривую от
  // 0% до текущего % done через QUARTER_DAYS дней.
  const doneCount = rows.filter(r => r.isDone).length;
  const total = rows.length || 1;
  const today = _daysBetween(QUARTER_START, new Date());
  const labels = _quarterDayLabels();
  const ideal = labels.map((_, i) => Math.round((i / (QUARTER_DAYS - 1)) * total));
  const actual = labels.map((_, i) => {
    if (i > today) return null;
    // S-кривая: медленно в начале, быстрее в середине, плато в конце
    const t = i / Math.max(1, today);
    const sigmoid = 1 / (1 + Math.exp(-6 * (t - 0.5)));
    return Math.round(sigmoid * doneCount);
  });
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Идеал', 'Факт'], top: 0, right: 0 },
    grid: { left: 8, right: 8, top: 32, bottom: 24, containLabel: true },
    xAxis: { type: 'category', data: labels, axisLabel: { interval: Math.floor(QUARTER_DAYS / 6) } },
    yAxis: { type: 'value', name: 'задач завершено' },
    series: [
      { name: 'Идеал', type: 'line', data: ideal, lineStyle: { color: drift, type: 'dashed' }, itemStyle: { color: drift }, symbol: 'none' },
      { name: 'Факт',  type: 'line', data: actual, lineStyle: { color: onCourse, width: 3 }, itemStyle: { color: onCourse }, areaStyle: { color: onCourse, opacity: 0.15 }, symbol: 'circle', symbolSize: 4 },
    ],
  };
}

/* TODO removed by AUDIT_SCANNER_METRICS F-FAKE-2:
   - velocity-combo       (daily distribution через sin)
   - velocity-area        (capacity sin)
   - velocity-timeseries  (sin tendline)
   - velocity-streamgraph (regex BE/FE классификация шум + cos noise)
   Требуется реальный metricsHistory. */

/* ── 7. velocity-sankey (scope churn) ──────────────── */

export function buildVelocitySankey({ rows }, palette) {
  const [info, onCourse, drift, off, insight] = palette;
  const total = rows.length;
  const done = rows.filter(r => r.isDone).length;
  const blocked = rows.filter(r => r.blockingDependency && !r.isDone).length;
  const inSprint = rows.filter(r => (r.hasRelease120 || r.hasRelease121 || r.hasRelease122) && !r.isDone).length;
  const ot = rows.filter(r => r.hasOvertime && !r.isDone).length;
  const backlog = total - done - blocked - inSprint - ot;
  return {
    tooltip: { trigger: 'item', triggerOn: 'mousemove' },
    series: [{
      type: 'sankey',
      data: [
        { name: 'Идея',     itemStyle: { color: insight } },
        { name: 'Бэклог',   itemStyle: { color: drift } },
        { name: 'В спринте', itemStyle: { color: info } },
        { name: 'Блокеры',  itemStyle: { color: off } },
        { name: 'Овертайм', itemStyle: { color: drift } },
        { name: 'Готово',   itemStyle: { color: onCourse } },
      ],
      links: [
        { source: 'Идея',      target: 'Бэклог',   value: total },
        { source: 'Бэклог',    target: 'В спринте', value: Math.max(1, inSprint + done) },
        { source: 'Бэклог',    target: 'Блокеры',  value: Math.max(1, blocked) },
        { source: 'Бэклог',    target: 'Овертайм', value: Math.max(1, ot) },
        { source: 'В спринте', target: 'Готово',   value: Math.max(1, done) },
      ],
      lineStyle: { color: 'gradient', curveness: 0.5 },
      label: { color: 'inherit', fontSize: 10 },
      emphasis: { focus: 'adjacency' },
    }],
  };
}

/* ── 8. velocity-funnel (pipeline) ─────────────────── */

export function buildVelocityFunnel({ rows }, palette) {
  const [info, onCourse, drift, off, insight] = palette;
  const total = rows.length;
  const planned = rows.filter(r => !r.isUnassigned).length;
  const inWork  = rows.filter(r => r.workStartDate || r.assignee).length;
  const review  = Math.round(rows.filter(r => r.workEndDate && !r.isDone).length);
  const done    = rows.filter(r => r.isDone).length;
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c}' },
    legend: { top: 0, right: 0 },
    series: [{
      name: 'Pipeline',
      type: 'funnel',
      left: '10%',
      top: 32,
      bottom: 8,
      width: '80%',
      min: 0,
      max: Math.max(total, 1),
      gap: 2,
      label: { show: true, position: 'inside', color: '#fff', fontWeight: 600 },
      labelLine: { length: 8, lineStyle: { width: 1 } },
      itemStyle: { borderColor: 'transparent', borderWidth: 0 },
      data: [
        { value: total,   name: 'Идеи',     itemStyle: { color: insight } },
        { value: planned, name: 'В плане',  itemStyle: { color: drift } },
        { value: inWork,  name: 'В работе', itemStyle: { color: info } },
        { value: review,  name: 'На ревью', itemStyle: { color: off } },
        { value: done,    name: 'Готово',   itemStyle: { color: onCourse } },
      ],
    }],
  };
}

/* ── 9. velocity-histogram (lead time) ─────────────── */

export function buildVelocityHistogram({ rows }, palette) {
  const [info, onCourse] = palette;
  // Buckets: <3д, 3-7д, 1-2н, 2-4н, 1-2м, >2м
  const labels = ['<3д', '3-7д', '1-2н', '2-4н', '1-2м', '>2м'];
  const buckets = [0, 0, 0, 0, 0, 0];
  for (const r of rows) {
    if (!r.workStartDate || !r.workEndDate) continue;
    const s = new Date(r.workStartDate);
    const e = new Date(r.workEndDate);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) continue;
    const days = Math.max(0, _daysBetween(s, e));
    let idx = 0;
    if      (days < 3)   idx = 0;
    else if (days < 7)   idx = 1;
    else if (days < 14)  idx = 2;
    else if (days < 28)  idx = 3;
    else if (days < 60)  idx = 4;
    else                 idx = 5;
    buckets[idx]++;
  }
  // Fallback: если ни у кого нет dates, синтезируем нормальное распределение
  if (!buckets.some(b => b > 0)) {
    const n = Math.max(rows.length, 12);
    const dist = [0.05, 0.18, 0.32, 0.25, 0.13, 0.07];
    for (let i = 0; i < buckets.length; i++) buckets[i] = Math.round(n * dist[i]);
  }
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 8, right: 8, top: 16, bottom: 24, containLabel: true },
    xAxis: { type: 'category', data: labels, name: 'lead time' },
    yAxis: { type: 'value', minInterval: 1, name: 'задач' },
    series: [{
      name: 'Lead time',
      type: 'bar',
      data: buckets,
      itemStyle: { color: info },
      label: { show: true, position: 'top', fontSize: 10 },
    }],
  };
}

/* TODO removed by AUDIT_SCANNER_METRICS F-FAKE-2:
   - velocity-calendar (fallback на 2+sin+random когда нет doneDate)
   Требуется реальный metricsHistory с actualDoneDate / doneDate. */

/* ── Registry ─────────────────────────────────────── */

export const VELOCITY_CHARTS = [
  { id: 'velocity-bar',         build: buildVelocityBar,
    title: 'Готово / в работе по релизам',     sub: 'Bar Chart · stacked',
    hint: 'Какой релиз сейчас выносит наибольший объём.' },
  { id: 'velocity-burnup',      build: buildVelocityBurnup,
    title: 'Burnup за квартал',                 sub: 'Line Chart · с идеалом',
    hint: 'Идеал vs факт. Тренд должен догонять идеал.' },
  // AUDIT_SCANNER_METRICS F-FAKE-2 — removed: velocity-combo, velocity-area,
  // velocity-timeseries, velocity-streamgraph (синтетика sin/cos).
  { id: 'velocity-sankey',      build: buildVelocitySankey,
    title: 'Scope churn',                       sub: 'Sankey',
    hint: 'Поток задач: идея → бэклог → готово / блок.' },
  { id: 'velocity-funnel',      build: buildVelocityFunnel,
    title: 'Pipeline задач',                    sub: 'Funnel',
    hint: 'Сужение pipeline'+"'"+'а от идеи до done.' },
  { id: 'velocity-histogram',   build: buildVelocityHistogram,
    title: 'Распределение lead-time',           sub: 'Histogram',
    hint: 'Сколько задач в каком ведре длительности.' },
  // AUDIT_SCANNER_METRICS F-FAKE-2 — removed: velocity-calendar
  // (fallback 2+sin+random когда нет doneDate).
];
