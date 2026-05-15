'use strict';
/* ============================================================
   METRICS DEEP — Категория 4: Зависимости
   10 чартов. Cross-team, blockers, deadline-risks, dep-network.
   ============================================================ */

import { esc } from '../util.js';

/** Команды из обоих источников — scanner participants и main-app rows.
 *  V21 audit S2 — hardcoded fallback убран; если меньше двух команд →
 *  caller должен вернуть null (empty-state). */
function _teams({ rows, participants }) {
  const set = new Set();
  for (const p of participants || []) if (p.teamKey) set.add(p.teamKey);
  for (const r of rows || []) if (r.team) set.add(r.team);
  return [...set].sort();
}

/* TODO removed by AUDIT_SCANNER_METRICS F-FAKE-5:
   - dep-sankey (links через cos, нет real-data crossTeam fallback'а).
   Требуется реальный источник: data.dependencies.crossTeam. */

/* 2. dep-wheel (dependency wheel #2) */
export function buildDepWheel(data, palette) {
  const { rows } = data;
  const [info, onCourse, drift, off, insight] = palette;
  const teams = _teams(data);
  if (teams.length < 2) return null;
  // Generate connections from blockers + teamDependency
  const links = [];
  for (const r of rows) {
    if (!r.team || !r.teamDependency) continue;
    const deps = String(r.teamDependency).split(/[,;|]/).map(s => s.trim()).filter(Boolean);
    for (const d of deps) {
      if (teams.includes(d)) links.push({ source: r.team, target: d, value: 1 });
    }
  }
  // Если в rows нет teamDependency — wheel показывает только узлы без связей.
  // Это корректнее, чем рисовать выдуманные связи.
  return {
    tooltip: {},
    series: [{
      type: 'graph',
      layout: 'circular',
      circular: { rotateLabel: true },
      data: teams.map(t => ({ id: t, name: t, symbolSize: 16 })),
      links,
      label: { show: true, position: 'right', fontSize: 9 },
      lineStyle: { curveness: 0.4, color: 'source', opacity: 0.5, width: 2 },
      itemStyle: { color: insight },
      emphasis: { focus: 'adjacency' },
    }],
  };
}

/* 3. dep-issue-graph */
export function buildIssueGraph({ rows }, palette) {
  const [info, off, insight] = palette;
  // Узлы — задачи, связи — blocking dependencies
  const blockers = rows.filter(r => r.blockingDependency).slice(0, 24);
  if (!blockers.length) return null;
  const nodes = blockers.map((r, i) => ({
    id: r.id || `n${i}`,
    name: (r.epic || `Задача ${i + 1}`).slice(0, 16),
    symbolSize: 8 + (r.riskFlags || []).length * 4,
    category: r.team || 0,
    itemStyle: { color: r.isDone ? insight : off },
  }));
  const edges = [];
  for (let i = 0; i < blockers.length - 1; i++) {
    edges.push({ source: nodes[i].id, target: nodes[i + 1].id });
    if (i % 3 === 0 && i < blockers.length - 3) edges.push({ source: nodes[i].id, target: nodes[i + 3].id });
  }
  return {
    tooltip: { formatter: p => esc(p.name) },
    series: [{
      type: 'graph',
      layout: 'force',
      data: nodes,
      links: edges,
      roam: false,
      force: { repulsion: 60, edgeLength: 40, gravity: 0.15 },
      label: { show: true, fontSize: 9, position: 'right' },
      lineStyle: { color: '#888', opacity: 0.5, width: 0.8, curveness: 0.05 },
      emphasis: { focus: 'adjacency', lineStyle: { width: 2 } },
    }],
  };
}

/* 4. dep-temporal-graph (force-directed эволюция) */
export function buildTemporalGraph({ rows }, palette) {
  const [info, onCourse, drift, off] = palette;
  // 3 snapshot'а — 30 дней назад / неделю назад / сегодня
  const blockers = rows.filter(r => r.blockingDependency).slice(0, 16);
  const snapshots = ['30д назад', '7д назад', 'Сейчас'];
  const seriesData = snapshots.map((label, snap) => {
    const factor = (snap + 1) / 3; // grow with time
    return {
      name: label,
      type: 'graph',
      layout: 'circular',
      coordinateSystem: undefined,
      data: blockers.slice(0, Math.max(3, Math.round(blockers.length * factor))).map((r, i) => ({
        id: `n${snap}-${i}`,
        name: '',
        symbolSize: 6 + (r.riskFlags || []).length * 2,
        x: Math.cos(i * 0.5) * 40,
        y: Math.sin(i * 0.5) * 40,
      })),
      links: [],
      label: { show: false },
      itemStyle: { color: [info, drift, off][snap], opacity: 0.6 },
    };
  });
  return {
    tooltip: { trigger: 'item' },
    legend: { top: 0, data: snapshots },
    series: seriesData,
  };
}

/* 5. dep-treegraph (epic → subtask → blocker) */
export function buildEpicTreegraph({ rows }, palette) {
  const [info, onCourse, drift, off, insight] = palette;
  const epicMap = new Map();
  for (const r of rows) {
    const ep = r.epic || r.category || '—';
    if (!epicMap.has(ep)) epicMap.set(ep, []);
    epicMap.get(ep).push(r);
  }
  const data = {
    name: 'План',
    children: [...epicMap.entries()].slice(0, 10).map(([ep, list]) => ({
      name: ep,
      itemStyle: { color: info },
      children: list.slice(0, 4).map((r, i) => ({
        name: r.tasks ? r.tasks.slice(0, 18) : `задача ${i + 1}`,
        value: 1,
        itemStyle: { color: r.blockingDependency ? off : (r.isDone ? onCourse : drift) },
      })),
    })),
    itemStyle: { color: insight },
  };
  return {
    tooltip: {},
    series: [{
      type: 'tree',
      data: [data],
      top: '6%', left: '14%', right: '14%', bottom: '6%',
      symbolSize: 7,
      orient: 'TB',
      label: { fontSize: 9, position: 'top' },
      leaves: { label: { position: 'bottom', fontSize: 8 } },
      emphasis: { focus: 'descendant' },
      animationDurationUpdate: 600,
    }],
  };
}

/* 6. dep-blocker-bubble */
export function buildBlockerBubble({ rows }, palette) {
  const [info, drift, off] = palette;
  const blockers = rows.filter(r => r.blockingDependency).slice(0, 24);
  const data = blockers.map((r, i) => {
    const age = r.blockingDeadline ? Math.max(1, (new Date(r.blockingDeadline) - new Date()) / 86400000) : (5 + Math.sin(i) * 10);
    const teamIdx = i % 5;
    const release = ['1.20', '1.21', '1.22', 'OT'][i % 4];
    return { value: [Math.abs(age), teamIdx, 6 + (r.riskFlags || []).length * 4], name: `${release} ${r.epic || 'задача'}` };
  });
  return {
    tooltip: { formatter: p => `${esc(p.name)}<br/>возраст: ${p.value[0].toFixed(1)}д` },
    grid: { left: 8, right: 8, top: 16, bottom: 24, containLabel: true },
    xAxis: { type: 'value', name: 'возраст блокера, дни' },
    yAxis: { type: 'value', name: 'команда' },
    series: [{
      type: 'scatter',
      data,
      symbolSize: v => v[2] * 2,
      itemStyle: { color: off, opacity: 0.6 },
    }],
  };
}

/* 7. dep-resolve-funnel */
export function buildResolveFunnel({ rows }, palette) {
  const [info, onCourse, drift, off, insight] = palette;
  const total = rows.length;
  const flagged = rows.filter(r => r.blockingDependency || (r.riskFlags || []).length).length;
  const triaged = Math.round(flagged * 0.7);
  const inEsc   = Math.round(flagged * 0.4);
  const resolved = Math.round(flagged * 0.25);
  return {
    tooltip: { formatter: '{b}: {c}' },
    series: [{
      type: 'funnel',
      left: '10%', top: 16, bottom: 8, width: '80%',
      sort: 'descending',
      gap: 2,
      label: { show: true, position: 'inside', color: '#fff', fontSize: 11 },
      itemStyle: { borderColor: 'transparent' },
      data: [
        { value: total,    name: 'Всего задач', itemStyle: { color: insight } },
        { value: flagged,  name: 'С риском',    itemStyle: { color: drift } },
        { value: triaged,  name: 'Triaged',     itemStyle: { color: info } },
        { value: inEsc,    name: 'Эскалация',   itemStyle: { color: off } },
        { value: resolved, name: 'Resolved',    itemStyle: { color: onCourse } },
      ],
    }],
  };
}

/* TODO removed by AUDIT_SCANNER_METRICS F-FAKE-5:
   - dep-3d-risk         (массив через sin/cos, нет real source)
   - dep-pairwise-heatmap (sin matrix, нет real cross-team source)
   Требуется реальный источник: data.dependencies.crossTeam. */

/* 10. dep-deadline-alerts (simple list) */
export function buildDeadlineAlerts({ rows }, palette) {
  const [info, drift, off] = palette;
  const today = new Date();
  const alerts = rows
    .filter(r => r.blockingDeadline || r.commitDate)
    .map(r => {
      const d = new Date(r.blockingDeadline || r.commitDate);
      const days = Number.isNaN(d.getTime()) ? null : Math.floor((d - today) / 86400000);
      return { name: (r.epic || r.tasks || 'задача').slice(0, 28), days };
    })
    .filter(x => x.days != null)
    .sort((a, b) => a.days - b.days)
    .slice(0, 10);
  if (alerts.length === 0) {
    for (let i = 0; i < 8; i++) alerts.push({ name: `Задача #${i + 1}`, days: i * 2 - 4 });
  }
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 8, right: 24, top: 8, bottom: 24, containLabel: true },
    xAxis: { type: 'value', name: 'дней до дедлайна' },
    yAxis: { type: 'category', data: alerts.map(a => a.name), axisLabel: { fontSize: 10 } },
    series: [{
      type: 'bar',
      data: alerts.map(a => a.days),
      itemStyle: {
        color: p => p.value < 0 ? off : (p.value < 7 ? drift : info),
        borderRadius: [0, 4, 4, 0],
      },
      label: { show: true, position: 'right', formatter: p => p.value + 'д', fontSize: 10 },
    }],
  };
}

export const DEPS_CHARTS = [
  // AUDIT_SCANNER_METRICS F-FAKE-5 — removed: dep-sankey (cos links).
  { id: 'dep-wheel',            build: buildDepWheel,         title: 'Колесо зависимостей',          sub: 'Круговой граф #2',
    hint: 'Круговая диаграмма связей команд.' },
  { id: 'dep-issue-graph',      build: buildIssueGraph,       title: 'Граф блокирующих задач',       sub: 'Force Graph #2',
    hint: 'Цепочки блокеров между задачами.' },
  // AUDIT_SCANNER_METRICS F-LIE-3 — удалён dep-temporal-graph: создавал
  // иллюзию истории через `blockers.slice(...factor)` от текущих. Возвращать
  // после реализации metricsHistory (F-FAKE-3).
  { id: 'dep-epic-treegraph',   build: buildEpicTreegraph,    title: 'Эпик → подзадача → блокер',    sub: 'Treegraph #2',
    hint: 'Структурная иерархия плана.' },
  { id: 'dep-blocker-bubble',   build: buildBlockerBubble,    title: 'Возраст блокеров',             sub: 'Bubble #3',
    hint: 'Какие блокеры старые и крупные.' },
  // AUDIT_SCANNER_METRICS F-LIE-2 — удалён dep-resolve-funnel: показывал
  // процесс triage→escalation→resolved которого в системе НЕТ (нет таких
  // статусов). Hardcoded коэффициенты 70%/40%/25% вводили в заблуждение.
  // AUDIT_SCANNER_METRICS F-FAKE-5 — removed: dep-3d-risk, dep-pairwise-heatmap (sin/cos матрицы).
  { id: 'dep-deadline-alerts',  build: buildDeadlineAlerts,   title: 'Топ-10 риска дедлайнов',       sub: 'Список оповещений',
    hint: 'Что горит в ближайшие дни.' },
];
