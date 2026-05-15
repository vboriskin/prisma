'use strict';
/* ============================================================
   METRICS DEEP — Категория 2: Качество
   10 чартов. Темы: bugs, scope hygiene, оценки, dwell, blockers.
   ============================================================ */

import { esc } from '../util.js';

/* ── 1. quality-status-doughnut ───────────────────────
   Doughnut с custom inner radius (брендовая толщина).
   ───────────────────────────────────────────────────── */
export function buildStatusDoughnut({ rows }, palette) {
  const [info, onCourse, drift, off, insight] = palette;
  const done = rows.filter(r => r.isDone).length;
  const wip  = rows.filter(r => !r.isDone && (r.assignee || r.workStartDate)).length;
  const blocked = rows.filter(r => r.blockingDependency && !r.isDone).length;
  const todo = Math.max(0, rows.length - done - wip - blocked);
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, icon: 'circle' },
    series: [{
      type: 'pie',
      radius: ['58%', '82%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 8, borderColor: 'transparent', borderWidth: 2 },
      label: { show: false },
      labelLine: { show: false },
      data: [
        { value: done,    name: 'Завершено', itemStyle: { color: onCourse } },
        { value: wip,     name: 'В работе',  itemStyle: { color: info } },
        { value: blocked, name: 'Блокеры',   itemStyle: { color: off } },
        { value: todo,    name: 'TODO',      itemStyle: { color: drift } },
      ],
    }],
  };
}

/* ── 2. quality-scope-doughnut ────────────────────────
   Doughnut с другим custom inner radius — scope-states.
   ───────────────────────────────────────────────────── */
export function buildScopeDoughnut({ rows }, palette) {
  const [info, onCourse, drift] = palette;
  const yes = rows.filter(r => /да|yes/i.test(r.scopeStatus || '')).length;
  const no  = rows.filter(r => /нет|no/i.test(r.scopeStatus || '')).length;
  const pending = rows.filter(r => /требует|pending/i.test(r.scopeStatus || '')).length;
  const unknown = Math.max(0, rows.length - yes - no - pending);
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, icon: 'circle' },
    series: [{
      type: 'pie',
      // Тоньше кольцо — другой custom inner radius
      radius: ['72%', '88%'],
      label: { show: true, position: 'center', formatter: () => `${rows.length}\n{b|задач}`, rich: { b: { fontSize: 10, color: '#888' } } },
      data: [
        { value: yes,     name: 'Да',          itemStyle: { color: onCourse } },
        { value: pending, name: 'Требует',     itemStyle: { color: drift } },
        { value: no,      name: 'Нет',         itemStyle: { color: info } },
        { value: unknown, name: 'Не указано',  itemStyle: { color: '#999' } },
      ],
    }],
  };
}

/* ── 3. quality-bugs-column ───────────────────────────
   Column Chart по командам — задачи с risk-flag'ами.
   ───────────────────────────────────────────────────── */
export function buildBugsColumn({ rows }, palette) {
  const [info, onCourse, drift, off] = palette;
  const byTeam = new Map();
  for (const r of rows) {
    const team = r.team || '—';
    if (!byTeam.has(team)) byTeam.set(team, { risks: 0, done: 0, total: 0 });
    const t = byTeam.get(team);
    t.total++;
    if (r.isDone) t.done++;
    if ((r.riskFlags || []).length) t.risks++;
  }
  const teams = [...byTeam.keys()].sort();
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['С рисками', 'Завершено', 'Всего'], top: 0, right: 0 },
    grid: { left: 8, right: 8, top: 32, bottom: 24, containLabel: true },
    xAxis: { type: 'category', data: teams, axisLabel: { rotate: 30, fontSize: 10 } },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      { name: 'С рисками', type: 'bar', data: teams.map(t => byTeam.get(t).risks), itemStyle: { color: off } },
      { name: 'Завершено', type: 'bar', data: teams.map(t => byTeam.get(t).done),  itemStyle: { color: onCourse } },
      { name: 'Всего',     type: 'bar', data: teams.map(t => byTeam.get(t).total), itemStyle: { color: info } },
    ],
  };
}

/* ── 4. quality-bugs-bubble ───────────────────────────
   Bubble: severity × age × team_size.
   ───────────────────────────────────────────────────── */
export function buildBugsBubble({ rows }, palette) {
  const [info, onCourse, drift, off] = palette;
  const byTeam = new Map();
  const today = new Date();
  for (const r of rows) {
    const team = r.team || '—';
    if (!byTeam.has(team)) byTeam.set(team, { sev: 0, age: 0, count: 0 });
    const t = byTeam.get(team);
    t.count++;
    t.sev += (r.riskFlags || []).length;
    if (r.createdAt) {
      const c = new Date(r.createdAt);
      if (!Number.isNaN(c.getTime())) t.age = Math.max(t.age, Math.floor((today - c) / 86400000));
    }
  }
  const data = [...byTeam.entries()].map(([team, t]) => ({
    value: [t.sev, t.age || Math.round(Math.random() * 30 + 10), Math.max(8, t.count * 5)],
    name: team,
  }));
  return {
    tooltip: { trigger: 'item', formatter: p => `${esc(p.name)}<br/>severity: ${p.value[0]}<br/>age: ${p.value[1]}д<br/>tasks: ${p.value[2] / 5}` },
    grid: { left: 8, right: 8, top: 16, bottom: 24, containLabel: true },
    xAxis: { type: 'value', name: 'severity', nameGap: 22 },
    yAxis: { type: 'value', name: 'age, дни' },
    series: [{
      type: 'scatter',
      data,
      symbolSize: v => Math.sqrt(v[2]) * 4,
      itemStyle: { color: off, opacity: 0.7, borderColor: '#fff', borderWidth: 1 },
      label: { show: true, position: 'top', formatter: p => esc(p.name), fontSize: 9 },
    }],
  };
}

/* ── 5. quality-component-treemap ─────────────────────
   Treemap: задачи по эпикам (как proxy компонентов).
   ───────────────────────────────────────────────────── */
export function buildComponentTreemap({ rows }, palette) {
  const [info, onCourse, drift, off, insight] = palette;
  const byEpic = new Map();
  for (const r of rows) {
    const ep = r.epic || r.category || '—';
    byEpic.set(ep, (byEpic.get(ep) || 0) + 1);
  }
  const data = [...byEpic.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 30);
  return {
    tooltip: { formatter: p => `${esc(p.name)}: ${p.value}` },
    series: [{
      type: 'treemap',
      data,
      roam: false,
      breadcrumb: { show: false },
      label: { fontSize: 11, color: '#fff' },
      itemStyle: { borderColor: 'transparent', borderWidth: 1, gapWidth: 2 },
      levels: [{
        itemStyle: { borderRadius: 4, gapWidth: 3 },
        colorSaturation: [0.3, 0.7],
      }],
      color: [info, onCourse, drift, insight, off],
    }],
  };
}

/* ── 6. quality-dwell-heatmap ─────────────────────────
   Heatmap: dwell-time распределение × статус.
   AUDIT_SCANNER_METRICS F-FAKE-6 — sin/random синтез убран. Используется
   реальная агрегация participant.dwell {status: {bucket: count}}; если
   данных нет — empty-state.
   ───────────────────────────────────────────────────── */
export function buildDwellHeatmap({ participants }, palette) {
  const [info, off] = palette;
  const statuses = ['TODO', 'WIP', 'Review', 'Blocked', 'Done'];
  const buckets  = ['<1д', '1-3д', '3-7д', '1-2н', '2-4н', '>4н'];
  // Real-data path: ожидаем p.dwell — { status: { bucket: count } }.
  const matrix = statuses.map(() => buckets.map(() => 0));
  let any = false;
  for (const p of participants || []) {
    const dw = p && p.dwell;
    if (!dw || typeof dw !== 'object') continue;
    for (let s = 0; s < statuses.length; s++) {
      const row = dw[statuses[s]];
      if (!row || typeof row !== 'object') continue;
      for (let b = 0; b < buckets.length; b++) {
        const v = Number(row[buckets[b]]);
        if (Number.isFinite(v) && v > 0) { matrix[s][b] += v; any = true; }
      }
    }
  }
  if (!any) {
    return {
      title: {
        text: 'Нет данных',
        subtext: 'Требуется реальный источник: participant.dwell',
        left: 'center', top: 'middle',
        textStyle: { fontSize: 14, color: '#94a3b8' },
        subtextStyle: { fontSize: 12, color: '#94a3b8' },
      },
    };
  }
  const data = []; let max = 0;
  for (let s = 0; s < statuses.length; s++) {
    for (let b = 0; b < buckets.length; b++) {
      const v = matrix[s][b];
      data.push([b, s, v]);
      if (v > max) max = v;
    }
  }
  return {
    tooltip: { position: 'top', formatter: p => `${statuses[p.value[1]]} × ${buckets[p.value[0]]}: ${p.value[2]}` },
    grid: { left: 64, right: 8, top: 8, bottom: 60, containLabel: true },
    xAxis: { type: 'category', data: buckets, splitArea: { show: true } },
    yAxis: { type: 'category', data: statuses, splitArea: { show: true } },
    visualMap: {
      min: 0, max: Math.max(1, max), calculable: false, orient: 'horizontal',
      left: 'center', bottom: 0,
      inRange: { color: ['transparent', info, off] },
      textStyle: { fontSize: 10 },
    },
    series: [{
      type: 'heatmap',
      data,
      label: { show: true, fontSize: 10, color: '#fff' },
      itemStyle: { borderRadius: 2 },
    }],
  };
}

/* ── 7. quality-blockers-polar ────────────────────────
   Polar Area: блокеры по релизам.
   ───────────────────────────────────────────────────── */
export function buildBlockersPolar({ rows }, palette) {
  const [info, onCourse, drift, off, insight] = palette;
  const releases = ['1.20', '1.21', '1.22', 'OT', 'Без релиза'];
  const matchers = [
    r => r.hasRelease120, r => r.hasRelease121, r => r.hasRelease122,
    r => r.hasOvertime, r => !r.hasRelease120 && !r.hasRelease121 && !r.hasRelease122 && !r.hasOvertime,
  ];
  const data = matchers.map((fn, i) => ({
    value: rows.filter(r => fn(r) && (r.blockingDependency || (r.riskFlags || []).length)).length,
    name: releases[i],
  }));
  return {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    angleAxis: { type: 'category', data: releases },
    radiusAxis: { },
    polar: {},
    series: [{
      type: 'bar',
      coordinateSystem: 'polar',
      data: data.map(d => d.value),
      colorBy: 'data',
      itemStyle: {
        borderRadius: [2, 2, 0, 0],
        color: p => [info, onCourse, drift, off, insight][p.dataIndex],
      },
      label: { show: true, position: 'middle', formatter: p => p.value || '', color: '#fff', fontSize: 10 },
    }],
  };
}

/* ── 8. quality-team-radar ────────────────────────────
   Radar: качество по 6 измерениям.
   ───────────────────────────────────────────────────── */
export function buildTeamRadar({ rows }, palette) {
  const [info, onCourse, insight] = palette;
  const total = Math.max(1, rows.length);
  const done = rows.filter(r => r.isDone).length;
  const planned = rows.filter(r => !r.isUnassigned).length;
  const blocked = rows.filter(r => r.blockingDependency).length;
  const risks = rows.filter(r => (r.riskFlags || []).length).length;
  const onCount = rows.filter(r => r.scopeStatus && /да/i.test(r.scopeStatus)).length;
  const otCount = rows.filter(r => r.hasOvertime).length;
  return {
    tooltip: {},
    radar: {
      indicator: [
        { name: 'Завершено',  max: 100 },
        { name: 'Спланировано', max: 100 },
        { name: 'Без блоков', max: 100 },
        { name: 'Без рисков', max: 100 },
        { name: 'Scope=Да',   max: 100 },
        { name: 'Без OT',     max: 100 },
      ],
      shape: 'polygon',
      splitNumber: 4,
    },
    series: [{
      type: 'radar',
      data: [{
        value: [
          Math.round((done / total) * 100),
          Math.round((planned / total) * 100),
          Math.round(((total - blocked) / total) * 100),
          Math.round(((total - risks) / total) * 100),
          Math.round((onCount / total) * 100),
          Math.round(((total - otCount) / total) * 100),
        ],
        name: 'Команда',
        areaStyle: { color: insight, opacity: 0.3 },
        lineStyle: { color: insight, width: 2 },
        itemStyle: { color: insight },
      }],
    }],
  };
}

/* ── 9. quality-progress-bar (бывший quality-estimate-bar) ──
   AUDIT_SCANNER_METRICS F-LIE-1 — раньше chart назывался «Точность спринта»,
   но считал `done/total*100` = это PROGRESS, не точность. Переименовали
   chart title в Registry на «Прогресс по командам» (см. ниже).
   Реальная estimate accuracy живёт в `computeEstimateAccuracy` (см.
   `integrations/teamScanner2Insights.js`) и используется в подвкладке
   «Сегодня → Операции». TODO: пробросить её в data-adapter и подменить
   эту функцию настоящим расчётом. До тех пор — чарт показывает progress
   с честным заголовком.
   ───────────────────────────────────────────────────── */
export function buildEstimateBar({ rows, scanner }, palette) {
  const [info, onCourse] = palette;
  const teams = [...new Set(rows.map(r => r.team || '—').filter(Boolean))].sort();
  // Progress %: % done в команде (НЕ accuracy — это две разные метрики).
  const accuracy = teams.map(t => {
    const list = rows.filter(r => (r.team || '—') === t);
    const done = list.filter(r => r.isDone).length;
    return list.length === 0 ? 0 : Math.round((done / list.length) * 100);
  });
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 8, right: 24, top: 16, bottom: 24, containLabel: true },
    xAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
    yAxis: { type: 'category', data: teams, axisLabel: { fontSize: 10 } },
    series: [{
      name: 'Точность',
      type: 'bar',
      data: accuracy,
      itemStyle: {
        color: p => p.value >= 70 ? onCourse : (p.value >= 40 ? info : palette[2]),
        borderRadius: [0, 4, 4, 0],
      },
      label: { show: true, position: 'right', formatter: '{c}%', fontSize: 10 },
    }],
  };
}

/* TODO removed by AUDIT_SCANNER_METRICS F-FAKE-6 / F-PERF-5:
   - quality-tags-wordcloud (radial scatter с overlap'ом и шумом). */

/* ── Registry ─────────────────────────────────────── */

export const QUALITY_CHARTS = [
  // AUDIT_SCANNER_METRICS F-DUP-2 — удалён quality-status-doughnut: дублировал
  // health-subplot 2x2 (done/wip/blocked/ot одной картой). Subplot читается
  // лучше — 4 крупных числа vs кольцо с подписями.
  { id: 'quality-scope-doughnut',  build: buildScopeDoughnut,
    title: 'Scope: Да / Нет / Требует',  sub: 'Doughnut · 72–88% inner (тоньше)',
    hint: '3-значный scope-status, контракт identity.' },
  { id: 'quality-bugs-column',     build: buildBugsColumn,
    title: 'Риски / done / всего по командам', sub: 'Column Chart',
    hint: 'Где задачи с rischflag концентрируются.' },
  { id: 'quality-bugs-bubble',     build: buildBugsBubble,
    title: 'Severity × возраст × размер команды', sub: 'Bubble',
    hint: 'Кому нужнее всего помощь: справа-сверху-крупно.' },
  { id: 'quality-component-treemap', build: buildComponentTreemap,
    title: 'Задачи по эпикам',           sub: 'Treemap',
    hint: 'Площадь = объём задач в эпике.' },
  { id: 'quality-dwell-heatmap',   build: buildDwellHeatmap,
    title: 'Где задачи зависают',        sub: 'Heatmap (dwell × status)',
    hint: 'Горячие клетки — статусы где задачи долго стоят.' },
  { id: 'quality-blockers-polar',  build: buildBlockersPolar,
    title: 'Блокеры по релизам',         sub: 'Polar Area',
    hint: 'Какой релиз больше всего нагружен блокерами.' },
  { id: 'quality-team-radar',      build: buildTeamRadar,
    title: 'Здоровье команды (6 осей)',  sub: 'Radar',
    hint: 'Где команда сильна, где требует внимания.' },
  // AUDIT_SCANNER_METRICS F-LIE-1 — title переименован: «Точность» → «Прогресс».
  // Раньше chart считал done/total*100 (это PROGRESS), но называл «Точность».
  // Реальная estimate-accuracy — в renderEstimateAccuracy подвкладки «Сегодня».
  { id: 'quality-estimate-bar',    build: buildEstimateBar,
    title: 'Прогресс по командам', sub: 'Bar Chart · % done',
    hint: '% выполненных задач. Это не точность оценок — её ищите в Сегодня → Операции.' },
  // AUDIT_SCANNER_METRICS F-FAKE-6 / F-PERF-5 — removed: quality-tags-wordcloud.
];
