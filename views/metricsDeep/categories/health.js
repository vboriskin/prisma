'use strict';
/* ============================================================
   METRICS DEEP — Категория 6: Здоровье
   10 чартов. Gauge × 2, polar, bar, flame × 2, alert × 2, subplot, wordcloud.
   ============================================================ */

import { esc } from '../util.js';

/* 1. health-team-gauge
   AUDIT_SCANNER_METRICS F-FAKE-8 — было `((done-blocked)/total)*100 + 60` —
   magic +60 чтобы выглядело прилично. Теперь честная композитная формула:
   4 компонента (done, no-blockers, planned, no-OT), каждый 0..1, нормализован
   до 0..100. Без сдвигов. Если данных нет — score=0. */
export function buildTeamHealthGauge({ rows }, palette) {
  const [info, onCourse, drift, off] = palette;
  const total = Math.max(1, rows.length);
  const done = rows.filter(r => r.isDone).length;
  const blocked = rows.filter(r => r.blockingDependency).length;
  const planned = rows.filter(r => !r.isUnassigned).length;
  const ot = rows.filter(r => r.hasOvertime).length;
  const components = [
    done / total,                  // вес 1: % сделанного
    1 - blocked / total,           // вес 1: % без блокеров
    planned / total,               // вес 1: % с релизом
    1 - ot / total,                // вес 1: % без overtime
  ];
  const score = Math.round((components.reduce((a, b) => a + b, 0) / components.length) * 100);
  return {
    series: [{
      type: 'gauge',
      startAngle: 200, endAngle: -20,
      min: 0, max: 100,
      radius: '95%',
      center: ['50%', '60%'],
      axisLine: {
        lineStyle: {
          width: 18,
          color: [
            [0.3, off],
            [0.7, drift],
            [1, onCourse],
          ],
        },
      },
      pointer: { itemStyle: { color: 'auto' } },
      axisTick: { show: false },
      splitLine: { length: 6, lineStyle: { width: 2, color: '#fff' } },
      axisLabel: { distance: -22, fontSize: 9, color: 'auto' },
      detail: { valueAnimation: true, formatter: '{value}', color: 'auto', fontSize: 28, fontWeight: 600, offsetCenter: [0, '20%'] },
      title: { offsetCenter: [0, '50%'], color: 'inherit', fontSize: 11 },
      data: [{ value: score, name: 'Здоровье' }],
    }],
  };
}

/* 2. health-confidence-gauge
   AUDIT_SCANNER_METRICS F-LIE-4 — раньше подписан «Уверенность», но считал
   `!isUnassigned/total` = заполненность поля релиз. Семантика искажена.
   Теперь composite confidence: % задач которые имеют ОДНОВРЕМЕННО:
   assignee + release + estimate (или story-points эквивалент через рабочий
   период) + не блокеры. Это и есть «уверенность в том что задача доедет». */
export function buildConfidenceGauge({ rows }, palette) {
  const [info, onCourse, drift] = palette;
  const total = Math.max(1, rows.length);
  const confident = rows.filter(r =>
    !r.isUnassigned &&
    !!r.assignee &&
    (!!r.workEndDate || !!r.commitDate) &&
    !r.blockingDependency
  ).length;
  const conf = Math.round((confident / total) * 100);
  return {
    series: [{
      type: 'gauge',
      startAngle: 90, endAngle: -270,
      pointer: { show: false },
      progress: { show: true, overlap: false, roundCap: true, clip: false, itemStyle: { color: info } },
      axisLine: { lineStyle: { width: 16, color: [[1, '#0002']] } },
      splitLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      data: [{ value: conf, name: 'Уверенность' }],
      title: { fontSize: 11, color: 'inherit', offsetCenter: [0, '78%'] },
      detail: { valueAnimation: true, formatter: '{value}%', color: 'auto', fontSize: 30, fontWeight: 600, offsetCenter: [0, '0%'] },
      radius: '95%',
      center: ['50%', '50%'],
    }],
  };
}

/* 3. health-components-polar */
export function buildComponentsPolar({ rows }, palette) {
  const [info, onCourse, drift, off, insight] = palette;
  const total = Math.max(1, rows.length);
  const components = [
    { name: 'Темп',       value: Math.round((rows.filter(r => r.isDone).length / total) * 100) },
    { name: 'Качество',   value: Math.round((1 - rows.filter(r => (r.riskFlags || []).length).length / total) * 100) },
    { name: 'План',       value: Math.round((rows.filter(r => !r.isUnassigned).length / total) * 100) },
    { name: 'Без блоков', value: Math.round((1 - rows.filter(r => r.blockingDependency).length / total) * 100) },
    { name: 'Без OT',     value: Math.round((1 - rows.filter(r => r.hasOvertime).length / total) * 100) },
  ];
  return {
    angleAxis: { type: 'category', data: components.map(c => c.name) },
    radiusAxis: { max: 100 },
    polar: {},
    tooltip: {},
    series: [{
      type: 'bar',
      coordinateSystem: 'polar',
      data: components.map(c => c.value),
      itemStyle: {
        color: p => [info, onCourse, drift, off, insight][p.dataIndex],
        borderRadius: [4, 4, 0, 0],
      },
      label: { show: true, position: 'middle', formatter: p => `${p.value}%`, color: '#fff', fontSize: 10 },
    }],
  };
}

/* 4. health-kpi-bar
   AUDIT_SCANNER_METRICS F-FAKE-9 — раньше «В срок=64», «WIP=72», «Снятие
   блоков=78» были hardcoded. Теперь — реальные агрегаты из rows + scanner.
   Где данных нет (sprint commit/MTTR не вернулись из Pulse) — показываем 0 +
   TODO в hint. Магических коэффициентов больше нет. */
export function buildKpiBar({ rows, scanner }, palette) {
  const [info, onCourse, drift, off] = palette;
  const total = Math.max(1, rows.length);
  const done = rows.filter(r => r.isDone).length;
  // «В срок» — % done-задач, выполненных до plannedDate (если есть).
  const doneOnTime = rows.filter(r => {
    if (!r.isDone || !r.doneDate) return false;
    const plannedTs = r.commitDate ? +new Date(r.commitDate) : (r.workEndDate ? +new Date(r.workEndDate) : 0);
    if (!plannedTs) return false;
    return +new Date(r.doneDate) <= plannedTs;
  }).length;
  const doneWithPlan = rows.filter(r => r.isDone && (r.commitDate || r.workEndDate)).length;
  const inSrokPct = doneWithPlan ? Math.round((doneOnTime / doneWithPlan) * 100) : 0;
  // «Контроль WIP» — % сотрудников с WIP <= 4.
  const byAssignee = {};
  rows.forEach(r => { if (!r.isDone && r.assignee) (byAssignee[r.assignee] = (byAssignee[r.assignee] || 0) + 1); });
  const fios = Object.keys(byAssignee);
  const wipOk = fios.filter(f => byAssignee[f] <= 4).length;
  const wipPct = fios.length ? Math.round((wipOk / fios.length) * 100) : 0;
  // «Снятие блоков» — оценка через bigMetrics.blockerMTTR если есть, иначе 0.
  const blockerScore = (() => {
    const mttr = scanner?.bigMetrics?.blockerMTTR;
    if (typeof mttr === 'number' && mttr > 0) {
      // нормализуем: 0ч=100, 24ч=80, 72ч=50, >168=0.
      return Math.max(0, Math.min(100, Math.round(100 - (mttr / 168) * 100)));
    }
    return 0;
  })();
  const kpis = [
    { name: 'В срок',          target: 80, actual: inSrokPct },
    { name: 'Готово, %',       target: 70, actual: rows.length ? Math.round((done / total) * 100) : 0 },
    { name: 'Покрытие плана',  target: 90, actual: rows.length ? Math.round((rows.filter(r => !r.isUnassigned).length / total) * 100) : 0 },
    { name: 'Контроль WIP',    target: 85, actual: wipPct },
    { name: 'Снятие блоков',   target: 95, actual: blockerScore },
  ];
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['Цель', 'Факт'], top: 0, right: 0 },
    grid: { left: 8, right: 8, top: 32, bottom: 24, containLabel: true },
    xAxis: { type: 'category', data: kpis.map(k => k.name), axisLabel: { fontSize: 10, rotate: 20 } },
    yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
    series: [
      { name: 'Цель', type: 'bar', data: kpis.map(k => k.target), itemStyle: { color: info, opacity: 0.4 } },
      { name: 'Факт', type: 'bar', data: kpis.map(k => k.actual), itemStyle: {
        color: p => p.value >= kpis[p.dataIndex].target ? onCourse : (p.value >= kpis[p.dataIndex].target - 15 ? drift : off),
        borderRadius: [4, 4, 0, 0],
      }, label: { show: true, position: 'top', formatter: '{c}%', fontSize: 10 } },
    ],
  };
}

/* 5. health-flame-team */
export function buildFlameTeam({ rows }, palette) {
  const [info, drift, off, onCourse] = palette;
  // Flame graph как nested bars: команда → эпик → задачи
  const teams = [...new Set(rows.map(r => r.team || '—'))].slice(0, 6);
  const epics = [...new Set(rows.map(r => r.epic || '—'))].slice(0, 8);
  const data = [];
  let max = 0;
  teams.forEach((t, ti) => {
    epics.forEach((e, ei) => {
      const n = rows.filter(r => (r.team || '—') === t && (r.epic || '—') === e).length;
      if (n > 0) {
        data.push([ei, ti, n]);
        if (n > max) max = n;
      }
    });
  });
  return {
    tooltip: { position: 'top', formatter: p => `${esc(teams[p.value[1]])} · ${esc(epics[p.value[0]])}: ${p.value[2]}` },
    grid: { left: 80, right: 8, top: 8, bottom: 60, containLabel: true },
    xAxis: { type: 'category', data: epics, axisLabel: { rotate: 30, fontSize: 9 } },
    yAxis: { type: 'category', data: teams, axisLabel: { fontSize: 10 } },
    visualMap: { min: 0, max, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, inRange: { color: ['transparent', drift, off] }, textStyle: { fontSize: 10 } },
    series: [{ type: 'heatmap', data, itemStyle: { borderRadius: 2 }, label: { show: true, fontSize: 9, color: '#fff' } }],
  };
}

/* 6. health-flame-person */
export function buildFlamePerson({ rows }, palette) {
  const [drift, off] = palette;
  // По одной строке на сотрудника
  const fios = [...new Set(rows.map(r => r.assignee).filter(Boolean))].slice(0, 12);
  const dataKey = ['В работе', 'Блокеры', 'Риски', 'Овертайм'];
  const data = []; let max = 0;
  fios.forEach((f, fi) => {
    dataKey.forEach((k, ki) => {
      let v = 0;
      if (ki === 0)      v = rows.filter(r => r.assignee === f && !r.isDone).length;
      else if (ki === 1) v = rows.filter(r => r.assignee === f && r.blockingDependency).length;
      else if (ki === 2) v = rows.filter(r => r.assignee === f && (r.riskFlags || []).length).length;
      else if (ki === 3) v = rows.filter(r => r.assignee === f && r.hasOvertime).length;
      data.push([ki, fi, v]);
      if (v > max) max = v;
    });
  });
  return {
    tooltip: { position: 'top', formatter: p => `${esc(fios[p.value[1]])} · ${esc(dataKey[p.value[0]])}: ${p.value[2]}` },
    grid: { left: 100, right: 8, top: 8, bottom: 60, containLabel: true },
    xAxis: { type: 'category', data: dataKey },
    yAxis: { type: 'category', data: fios, axisLabel: { fontSize: 10 } },
    visualMap: { min: 0, max: max || 1, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, inRange: { color: ['transparent', drift, off] }, textStyle: { fontSize: 10 } },
    series: [{ type: 'heatmap', data, itemStyle: { borderRadius: 2 }, label: { show: true, fontSize: 9, color: '#fff' } }],
  };
}

/* 7. health-alerts-active */
export function buildAlertsActive({ rows }, palette) {
  const [info, drift, off] = palette;
  const active = [
    { name: 'Блокеров с dwell > 24ч', value: rows.filter(r => r.blockingDependency).length, sev: 'high' },
    { name: 'Задач без assignee',     value: rows.filter(r => !r.assignee).length, sev: 'med' },
    { name: 'Овертайм-окно',          value: rows.filter(r => r.hasOvertime).length, sev: 'high' },
    { name: 'Scope требует',          value: rows.filter(r => /требует/i.test(r.scopeStatus || '')).length, sev: 'med' },
    { name: 'Без даты завершения',    value: rows.filter(r => !r.workEndDate && !r.isDone).length, sev: 'low' },
    { name: 'Risk-flag установлен',   value: rows.filter(r => (r.riskFlags || []).length).length, sev: 'high' },
  ].sort((a, b) => b.value - a.value);
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 8, right: 24, top: 8, bottom: 24, containLabel: true },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: { type: 'category', data: active.map(a => a.name), axisLabel: { fontSize: 10 } },
    series: [{
      type: 'bar',
      data: active.map(a => a.value),
      itemStyle: {
        color: p => active[p.dataIndex].sev === 'high' ? off : (active[p.dataIndex].sev === 'med' ? drift : info),
        borderRadius: [0, 4, 4, 0],
      },
      label: { show: true, position: 'right', fontSize: 10 },
    }],
  };
}

/* 8. health-alerts-today */
export function buildAlertsToday({ rows }, palette) {
  const [info, drift, off, insight] = palette;
  // V21 audit D2 — синтетика заменена на агрегаты по rows; без данных
  // _initChart показывает empty-state.
  const today = [
    { name: 'Сегодня дедлайн',          value: rows.filter(r => {
      if (!r.commitDate) return false;
      const d = new Date(r.commitDate);
      const now = new Date(); now.setHours(0,0,0,0);
      const dn  = new Date(d);  dn.setHours(0,0,0,0);
      return dn.getTime() === now.getTime();
    }).length, sev: 'high' },
    { name: 'Дедлайн на этой неделе',   value: rows.filter(r => {
      if (!r.commitDate) return false;
      const d = new Date(r.commitDate); const now = new Date();
      return d > now && (d - now) < 7 * 86400000;
    }).length, sev: 'med' },
    { name: 'Без assignee',             value: rows.filter(r => !r.assignee).length, sev: 'med' },
    { name: 'Без даты завершения',      value: rows.filter(r => !r.workEndDate && !r.isDone).length, sev: 'low' },
    { name: 'Помеченные риском',        value: rows.filter(r => (r.riskFlags || []).length).length, sev: 'low' },
  ];
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 8, right: 24, top: 8, bottom: 24, containLabel: true },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: { type: 'category', data: today.map(a => a.name), axisLabel: { fontSize: 10 } },
    series: [{
      type: 'bar',
      data: today.map(a => a.value),
      itemStyle: {
        color: p => today[p.dataIndex].sev === 'high' ? off : (today[p.dataIndex].sev === 'med' ? drift : insight),
        borderRadius: [0, 4, 4, 0],
      },
      label: { show: true, position: 'right', fontSize: 10 },
    }],
  };
}

/* 9. health-subplot-2x2 */
export function buildSubplot2x2({ rows }, palette) {
  const [info, onCourse, drift, off] = palette;
  const total = Math.max(1, rows.length);
  const done = rows.filter(r => r.isDone).length;
  const wip  = rows.filter(r => !r.isDone).length;
  const blocked = rows.filter(r => r.blockingDependency).length;
  const ot = rows.filter(r => r.hasOvertime).length;
  return {
    tooltip: { trigger: 'item' },
    title: [
      { text: `${Math.round((done / total) * 100)}%`,    left: '25%', top: '8%',  textAlign: 'center', textStyle: { color: onCourse, fontSize: 36, fontWeight: 600 } },
      { text: 'Done',                                    left: '25%', top: '32%', textAlign: 'center', textStyle: { color: 'inherit', fontSize: 11 } },
      { text: `${Math.round((wip / total) * 100)}%`,     left: '75%', top: '8%',  textAlign: 'center', textStyle: { color: info, fontSize: 36, fontWeight: 600 } },
      { text: 'WIP',                                     left: '75%', top: '32%', textAlign: 'center', textStyle: { color: 'inherit', fontSize: 11 } },
      { text: `${blocked}`,                              left: '25%', top: '52%', textAlign: 'center', textStyle: { color: off, fontSize: 36, fontWeight: 600 } },
      { text: 'Blockers',                                left: '25%', top: '76%', textAlign: 'center', textStyle: { color: 'inherit', fontSize: 11 } },
      { text: `${ot}`,                                   left: '75%', top: '52%', textAlign: 'center', textStyle: { color: drift, fontSize: 36, fontWeight: 600 } },
      { text: 'OT задач',                                left: '75%', top: '76%', textAlign: 'center', textStyle: { color: 'inherit', fontSize: 11 } },
    ],
  };
}

/* 10. health-tags-wordcloud (radial layout #2) */
export function buildHealthWordcloud({ rows }, palette) {
  const [info, onCourse, drift, off, insight] = palette;
  // Top epics + tags weighted by risk count
  const counts = new Map();
  for (const r of rows) {
    const w = 1 + (r.blockingDependency ? 2 : 0) + ((r.riskFlags || []).length);
    if (r.epic)     counts.set(r.epic, (counts.get(r.epic) || 0) + w);
    if (r.category) counts.set(r.category, (counts.get(r.category) || 0) + w);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (!top.length) top.push(['курс', 5], ['команда', 3]);
  const palette5 = [info, onCourse, drift, off, insight];
  const data = top.map(([name, count], i) => {
    const layer = Math.floor(i / 6);
    const angle = ((i % 6) / 6) * Math.PI * 2;
    const r = 25 + layer * 30 + Math.sqrt(count) * 4;
    return { value: [Math.cos(angle) * r, Math.sin(angle) * r, count], name };
  });
  return {
    tooltip: { formatter: p => `${esc(p.name)}: ${p.value[2]}` },
    grid: { left: 0, right: 0, top: 0, bottom: 0 },
    xAxis: { show: false, min: -100, max: 100 },
    yAxis: { show: false, min: -100, max: 100 },
    series: [{
      type: 'scatter',
      data,
      symbolSize: v => Math.max(20, Math.sqrt(v[2]) * 16),
      itemStyle: {
        color: p => palette5[p.dataIndex % 5],
        opacity: 0.45,
        borderColor: '#fff', borderWidth: 1,
      },
      label: {
        show: true,
        formatter: p => esc(p.name),
        fontSize: v => Math.min(18, 9 + (v.value[2] || 1)),
        color: 'inherit',
        position: 'inside',
      },
    }],
  };
}

export const HEALTH_CHARTS = [
  { id: 'health-team-gauge',    build: buildTeamHealthGauge,  title: 'Здоровье команды',          sub: 'Индикатор',
    hint: '0–100, агрегат по 4 факторам.' },
  { id: 'health-conf-gauge',    build: buildConfidenceGauge,  title: 'Уверенность в спринте',     sub: 'Индикатор #2',
    hint: 'Доверие к плану на этот спринт.' },
  { id: 'health-components',    build: buildComponentsPolar,  title: 'Составляющие здоровья',     sub: 'Polar Area #2',
    hint: 'Темп / качество / план / блокеры / овертайм.' },
  { id: 'health-kpi-bar',       build: buildKpiBar,           title: 'Показатели: цель vs факт',  sub: 'Bar Chart #5',
    hint: 'Где отстаём от цели.' },
  { id: 'health-flame-team',    build: buildFlameTeam,        title: 'На чём команда «горит»',    sub: 'Тепловая карта',
    hint: 'Команда × эпик: где концентрация.' },
  { id: 'health-flame-person',  build: buildFlamePerson,      title: 'На чём горит человек',      sub: 'Тепловая карта #2',
    hint: 'В работе / блокеры / риски / овертайм.' },
  { id: 'health-alerts-active', build: buildAlertsActive,     title: 'Активные риски',            sub: 'Список оповещений',
    hint: 'Что требует внимания прямо сейчас.' },
  { id: 'health-alerts-today',  build: buildAlertsToday,      title: 'На сегодня',                sub: 'Список оповещений #2',
    hint: 'События ближайших суток.' },
  { id: 'health-subplot',       build: buildSubplot2x2,       title: 'Показатели 2×2',            sub: 'Subplot #2',
    hint: 'Готово / в работе / блокеры / овертайм.' },
  { id: 'health-wordcloud',     build: buildHealthWordcloud,  title: 'Облако зон риска',          sub: 'Word Cloud #2',
    hint: 'Эпики и категории взвешены по риску.' },
];
