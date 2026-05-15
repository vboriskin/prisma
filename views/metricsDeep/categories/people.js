'use strict';
/* ============================================================
   METRICS DEEP — Категория 3: Команды и люди
   10 чартов. WIP, OT, ревью, нагрузка, sunburst, treemap, network.
   ============================================================ */

import { esc } from '../util.js';

/** Унифицированный экстрактор: участники из scanner если есть, иначе из rows. */
function _byAssignee({ rows, participants }) {
  const m = new Map();
  // V21 audit D1 — приоритет scanner.participants (мы внутри Сканнера команды).
  for (const p of participants || []) {
    const fio = p.label || p.name;
    if (!fio) continue;
    // AUDIT_SCANNER_METRICS F-DATA-1 — раньше `done = max(0, activeIssuesCount -
    // issuesNow.length)` это не done, а residual. Теперь честно: используем
    // closedToday/donePillCount если есть, иначе 0 (не угадываем).
    const realDone = Number(p.closedToday) || Number(p.donePillCount) || 0;
    m.set(fio, {
      fio,
      total: (p.issuesNow || []).length || p.activeIssuesCount || 0,
      done:  realDone,
      wip:   (p.issuesNow || []).length,
      ot:    p.blockedCount || 0,
      team:  p.teamKey || '—',
    });
  }
  // Дополняем из rows — пользователь может иметь и scanner и реестр.
  for (const r of rows) {
    const a = String(r.assignee || '').trim();
    if (!a) continue;
    if (!m.has(a)) m.set(a, { fio: a, total: 0, done: 0, wip: 0, ot: 0, team: r.team || '—' });
    const e = m.get(a);
    e.total++;
    if (r.isDone) e.done++; else e.wip++;
    if (r.hasOvertime) e.ot++;
  }
  return [...m.values()];
}

/* 1. people-wip-bar */
export function buildWipBar(data, palette) {
  const [info, onCourse, drift] = palette;
  const list = _byAssignee(data).sort((a, b) => b.wip - a.wip).slice(0, 16);
  if (!list.length) return null;
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 0, right: 0 },
    grid: { left: 8, right: 8, top: 32, bottom: 60, containLabel: true },
    xAxis: { type: 'category', data: list.map(e => e.fio), axisLabel: { rotate: 45, fontSize: 10 } },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      { name: 'В работе',  type: 'bar', stack: 't', data: list.map(e => e.wip),  itemStyle: { color: info } },
      { name: 'Завершено', type: 'bar', stack: 't', data: list.map(e => e.done), itemStyle: { color: onCourse } },
    ],
  };
}

/* 2. people-load-treemap */
export function buildLoadTreemap({ rows, participants }, palette) {
  const [info, onCourse, drift, off, insight] = palette;
  const byTeam = new Map();
  // V21 audit D1 — participants приоритетны: каждый член = +1 в свою команду.
  for (const p of participants || []) {
    const t = p.teamKey || '—';
    byTeam.set(t, (byTeam.get(t) || 0) + 1);
  }
  for (const r of rows) {
    const t = r.team || '—';
    byTeam.set(t, (byTeam.get(t) || 0) + 1);
  }
  if (!byTeam.size) return null;
  return {
    tooltip: {},
    series: [{
      type: 'treemap',
      roam: false, breadcrumb: { show: false },
      label: { fontSize: 12, color: '#fff', formatter: '{b}\n{c}' },
      itemStyle: { gapWidth: 2, borderRadius: 4 },
      levels: [{ itemStyle: { gapWidth: 3 } }],
      color: [info, onCourse, drift, insight, off],
      data: [...byTeam.entries()].map(([name, value]) => ({ name, value })),
    }],
  };
}

/* 3. people-sunburst */
export function buildSunburst({ rows, participants }, palette) {
  const [info, onCourse, drift, off, insight] = palette;
  const tree = new Map();
  // V21 audit D1 — sunburst команда → эпик → исполнитель. Источник: rows
  // (там есть epic), participants дают только команда → ФИО без эпика.
  for (const r of rows) {
    const team = r.team || '—';
    const ep   = r.epic || r.category || '—';
    const a    = r.assignee || '—';
    if (!tree.has(team)) tree.set(team, new Map());
    const epM = tree.get(team);
    if (!epM.has(ep)) epM.set(ep, new Map());
    const aM = epM.get(ep);
    aM.set(a, (aM.get(a) || 0) + 1);
  }
  // Если rows пусты — упрощённый sunburst команда → ФИО из participants.
  if (!tree.size) {
    for (const p of participants || []) {
      const team = p.teamKey || '—';
      const fio  = p.label || p.name || '—';
      if (!tree.has(team)) tree.set(team, new Map());
      const epM = tree.get(team);
      if (!epM.has('—')) epM.set('—', new Map());
      const aM = epM.get('—');
      aM.set(fio, (aM.get(fio) || 0) + 1);
    }
  }
  if (!tree.size) return null;
  const data = [];
  for (const [team, epM] of tree) {
    const teamItem = { name: team, children: [] };
    for (const [ep, aM] of epM) {
      const epItem = { name: ep, children: [] };
      for (const [a, n] of aM) epItem.children.push({ name: a, value: n });
      teamItem.children.push(epItem);
    }
    data.push(teamItem);
  }
  return {
    tooltip: {},
    series: [{
      type: 'sunburst',
      data,
      color: palette,
      radius: ['10%', '95%'],
      label: { fontSize: 9, rotate: 'tangential' },
      levels: [{}, { itemStyle: { borderWidth: 2, borderColor: 'transparent' } },
        { label: { fontSize: 10 } },
        { label: { fontSize: 8, color: '#fff' } }],
      itemStyle: { borderColor: 'transparent', borderRadius: 2 },
    }],
  };
}

/* 4. people-ot-polar
   AUDIT_SCANNER_METRICS F-FAKE-7 — sin-fallback убран. Считаем недели OT
   по реальным timestamp'ам в participant.timelinePrev (массив записей с
   полем `ts` или `date`). Если ни у кого нет timeline — empty-state.
*/
export function buildOtPolar({ participants }, palette) {
  const [info, onCourse, drift, off] = palette;
  const weeks = 13;
  const labels = Array.from({ length: weeks }, (_, i) => `W${i + 1}`);
  // Якорь — начало квартала из 1 апреля текущего года.
  const QUARTER_START_MS = new Date(new Date().getFullYear(), 3, 1).getTime();
  const WEEK_MS = 7 * 86400000;
  const counts = new Array(weeks).fill(0);
  let any = false;
  for (const p of participants || []) {
    const tl = p && p.timelinePrev;
    if (!Array.isArray(tl) || !tl.length) continue;
    for (const e of tl) {
      const raw = e && (e.ts || e.date || e.at);
      if (!raw) continue;
      const t = new Date(raw).getTime();
      if (!Number.isFinite(t)) continue;
      const wk = Math.floor((t - QUARTER_START_MS) / WEEK_MS);
      if (wk >= 0 && wk < weeks) { counts[wk]++; any = true; }
    }
  }
  if (!any) {
    return {
      title: {
        text: 'Нет данных',
        subtext: 'Требуется реальный источник: participant.timelinePrev',
        left: 'center', top: 'middle',
        textStyle: { fontSize: 14, color: '#94a3b8' },
        subtextStyle: { fontSize: 12, color: '#94a3b8' },
      },
    };
  }
  return {
    polar: { radius: ['20%', '85%'] },
    tooltip: { trigger: 'item' },
    angleAxis: { type: 'category', data: labels, startAngle: 90 },
    radiusAxis: { },
    series: [{
      type: 'bar',
      coordinateSystem: 'polar',
      data: counts,
      itemStyle: { color: drift, borderRadius: [4, 4, 0, 0] },
      label: { show: true, position: 'middle', color: '#fff', fontSize: 9, formatter: p => p.value || '' },
    }],
  };
}

/* 5. people-switch-bubble */
export function buildSwitchBubble(input, palette) {
  const [info, drift, off, insight] = palette;
  const list = _byAssignee(input).slice(0, 20);
  if (!list.length) return null;
  // x = wip, y = total, size = ot
  const points = list.map(e => ({
    value: [e.wip, e.total, Math.max(8, e.ot * 8 + 8)],
    name: e.fio,
  }));
  return {
    tooltip: { formatter: p => `${esc(p.name)}<br/>В работе: ${p.value[0]}<br/>всего: ${p.value[1]}<br/>Овертайм: ${(p.value[2] - 8) / 8}` },
    grid: { left: 8, right: 8, top: 16, bottom: 24, containLabel: true },
    xAxis: { type: 'value', name: 'В работе', minInterval: 1 },
    yAxis: { type: 'value', name: 'всего' },
    series: [{
      type: 'scatter',
      data: points,
      symbolSize: v => Math.sqrt(v[2]) * 4,
      itemStyle: { color: drift, opacity: 0.6, borderColor: 'transparent', borderWidth: 1 },
      emphasis: { focus: 'self' },
    }],
  };
}

/* 6. people-team-treegraph */
export function buildTeamTreegraph({ rows, participants }, palette) {
  const [info, onCourse, drift, insight] = palette;
  const teamMap = new Map();
  for (const p of participants || []) {
    const t = p.teamKey || '—';
    const a = p.label || p.name || '—';
    if (!teamMap.has(t)) teamMap.set(t, new Set());
    teamMap.get(t).add(a);
  }
  for (const r of rows) {
    const t = r.team || '—';
    const a = r.assignee || '—';
    if (!teamMap.has(t)) teamMap.set(t, new Set());
    teamMap.get(t).add(a);
  }
  if (!teamMap.size) return null;
  const data = {
    name: 'Команда',
    children: [...teamMap.entries()].map(([team, fios]) => ({
      name: team,
      children: [...fios].map(a => ({ name: a, value: 1 })),
      itemStyle: { color: info },
    })),
    itemStyle: { color: insight },
  };
  return {
    tooltip: { trigger: 'item' },
    series: [{
      type: 'tree',
      data: [data],
      top: '6%', left: '10%', right: '20%', bottom: '6%',
      symbolSize: 7,
      orient: 'LR',
      label: { position: 'left', verticalAlign: 'middle', align: 'right', fontSize: 9 },
      leaves: { label: { position: 'right', verticalAlign: 'middle', align: 'left' } },
      emphasis: { focus: 'descendant' },
      expandAndCollapse: true,
      animationDurationUpdate: 600,
    }],
  };
}

/* 7. people-network-graph */
export function buildNetworkGraph({ rows }, palette) {
  const [info, onCourse, drift, off, insight] = palette;
  // Узлы — assignee'ы, связи — общие эпики. Только rows: нужна информация
  // об эпиках, которой в scanner.participants нет.
  const fios = new Set();
  const epicMap = new Map(); // epic -> Set fio
  for (const r of rows) {
    if (!r.assignee) continue;
    fios.add(r.assignee);
    const ep = r.epic || r.category || '—';
    if (!epicMap.has(ep)) epicMap.set(ep, new Set());
    epicMap.get(ep).add(r.assignee);
  }
  const nodes = [...fios].map(name => ({ id: name, name, symbolSize: 10, category: 0 }));
  // AUDIT_SCANNER_METRICS F-PERF-4 — early-cap при генерации edges. Раньше
  // O(epics × FIO²): 50 эпиков × 10 FIO² = 25k edges и ECharts падал/фризил.
  // Теперь обрываем сразу после 200 — slice(0,200) ниже становится no-op,
  // память не тратится на лишние объекты.
  const EDGE_CAP = 200;
  const edges = [];
  outer: for (const [, set] of epicMap) {
    const arr = [...set];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        edges.push({ source: arr[i], target: arr[j] });
        if (edges.length >= EDGE_CAP) break outer;
      }
    }
  }
  // V21 audit S2 — убраны hardcoded ФИО fallback'и (могли совпасть с реальными
  // именами в корп-демо). Если нет данных — null → empty-state.
  if (nodes.length === 0) return null;
  return {
    tooltip: {},
    series: [{
      type: 'graph',
      layout: 'force',
      data: nodes,
      links: edges.slice(0, 200),
      roam: false,
      label: { show: true, fontSize: 9, position: 'right' },
      force: { repulsion: 80, edgeLength: 50, gravity: 0.1 },
      lineStyle: { color: 'source', opacity: 0.4, width: 0.6, curveness: 0.1 },
      itemStyle: { color: insight },
      emphasis: { focus: 'adjacency', lineStyle: { width: 2 } },
    }],
  };
}

/* 8. people-cross-team-wheel
   AUDIT_SCANNER_METRICS F-FAKE-7 — Math.random() synthetic убран. Если нет
   data.dependencies.crossTeamLinks ни row.teamDependency — empty-state.
*/
export function buildCrossTeamWheel(input, palette) {
  const [info, onCourse, drift, off, insight] = palette;
  const { rows = [], participants = [], dependencies = {} } = input || {};
  const set = new Set();
  for (const p of participants) if (p.teamKey) set.add(p.teamKey);
  for (const r of rows) if (r.team) set.add(r.team);
  const teams = [...set].sort();
  // Real-data path #1: явные cross-team links из dependencies.
  const links = [];
  if (Array.isArray(dependencies.crossTeamLinks)) {
    for (const l of dependencies.crossTeamLinks) {
      if (!l || !l.source || !l.target) continue;
      links.push({ source: l.source, target: l.target, value: Number(l.value) || 1 });
    }
  }
  // Real-data path #2: row.teamDependency.
  if (links.length === 0) {
    for (const r of rows) {
      if (!r.teamDependency || !r.team) continue;
      const deps = String(r.teamDependency).split(/[,;|]/).map(s => s.trim()).filter(Boolean);
      for (const dep of deps) {
        links.push({ source: r.team, target: dep, value: 1 });
      }
    }
  }
  if (teams.length < 2 || links.length === 0) {
    return {
      title: {
        text: 'Нет данных',
        subtext: 'Требуется реальный источник: dependencies.crossTeamLinks',
        left: 'center', top: 'middle',
        textStyle: { fontSize: 14, color: '#94a3b8' },
        subtextStyle: { fontSize: 12, color: '#94a3b8' },
      },
    };
  }
  // Aggregate
  const aggMap = new Map();
  for (const l of links) {
    const k = `${l.source}→${l.target}`;
    aggMap.set(k, (aggMap.get(k) || 0) + l.value);
  }
  const aggLinks = [...aggMap.entries()].map(([k, v]) => {
    const [s, t] = k.split('→');
    return { source: s, target: t, value: v };
  });
  return {
    tooltip: {},
    series: [{
      type: 'graph',
      layout: 'circular',
      circular: { rotateLabel: true },
      data: teams.map(t => ({ id: t, name: t, symbolSize: 14 })),
      links: aggLinks,
      label: { show: true, fontSize: 9, position: 'right', color: 'inherit' },
      lineStyle: { curveness: 0.3, color: 'source', opacity: 0.5, width: 1.5 },
      itemStyle: { color: drift },
      emphasis: { focus: 'adjacency' },
    }],
  };
}

/* 9. people-review-heatmap (reviewer × author)
   AUDIT_SCANNER_METRICS F-FAKE-7 — sin synth убран. Считаем матрицу по
   реальным reviewers из bb.prItems[i].reviewers (author = bb.prItems[i].author).
   Если bb.prItems отсутствует — empty-state.
*/
export function buildReviewHeatmap(input, palette) {
  const [info, off] = palette;
  const bb = (input && input.bb) || {};
  const prItems = Array.isArray(bb.prItems) ? bb.prItems : [];
  const counts = new Map(); // key "author→reviewer" -> count
  const fioSet = new Set();
  for (const pr of prItems) {
    const author = pr && pr.author;
    const reviewers = pr && Array.isArray(pr.reviewers) ? pr.reviewers : [];
    if (!author || !reviewers.length) continue;
    fioSet.add(author);
    for (const rv of reviewers) {
      if (!rv || rv === author) continue;
      fioSet.add(rv);
      const k = `${author}→${rv}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  const fios = [...fioSet].slice(0, 10);
  if (fios.length < 2 || counts.size === 0) {
    return {
      title: {
        text: 'Нет данных',
        subtext: 'Требуется реальный источник: bb.prItems[].reviewers',
        left: 'center', top: 'middle',
        textStyle: { fontSize: 14, color: '#94a3b8' },
        subtextStyle: { fontSize: 12, color: '#94a3b8' },
      },
    };
  }
  const data = []; let max = 0;
  for (let i = 0; i < fios.length; i++) {
    for (let j = 0; j < fios.length; j++) {
      if (i === j) { data.push([j, i, 0]); continue; }
      const k = `${fios[i]}→${fios[j]}`;
      const v = counts.get(k) || 0;
      data.push([j, i, v]);
      if (v > max) max = v;
    }
  }
  return {
    tooltip: { position: 'top', formatter: p => `${esc(fios[p.value[1]])} → ${esc(fios[p.value[0]])}: ${p.value[2]}` },
    grid: { left: 80, right: 8, top: 8, bottom: 80, containLabel: true },
    xAxis: { type: 'category', data: fios, axisLabel: { rotate: 45, fontSize: 9 }, splitArea: { show: true } },
    yAxis: { type: 'category', data: fios, axisLabel: { fontSize: 9 }, splitArea: { show: true } },
    visualMap: { min: 0, max: Math.max(1, max), calculable: false, orient: 'horizontal', left: 'center', bottom: 0, inRange: { color: ['transparent', info, off] }, textStyle: { fontSize: 10 } },
    series: [{ type: 'heatmap', data, label: { show: false }, itemStyle: { borderRadius: 2 } }],
  };
}

/* 10. people-subplot (4 sparklines per team) */
export function buildTeamSubplot({ rows }, palette) {
  const [info, onCourse, drift, off] = palette;
  // 4 sparklines в одной grid: load / quality / velocity / risk
  const teams = [...new Set(rows.map(r => r.team || '—'))].slice(0, 8);
  const total = rows.length || 1;
  const load = teams.map(t => rows.filter(r => (r.team || '—') === t).length);
  const quality = teams.map(t => rows.filter(r => (r.team || '—') === t && (r.riskFlags || []).length === 0).length);
  const velocity = teams.map(t => rows.filter(r => (r.team || '—') === t && r.isDone).length);
  const risk = teams.map(t => rows.filter(r => (r.team || '—') === t && r.blockingDependency).length);
  const subgrid = (top, height) => ({ left: '4%', right: '4%', top, height });
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Нагрузка', 'Качество', 'Темп', 'Риск'], top: 0, fontSize: 10 },
    grid: [
      subgrid('12%', '18%'),
      subgrid('34%', '18%'),
      subgrid('56%', '18%'),
      subgrid('78%', '18%'),
    ],
    xAxis: [
      { gridIndex: 0, type: 'category', data: teams, axisLabel: { show: false }, axisLine: { show: false } },
      { gridIndex: 1, type: 'category', data: teams, axisLabel: { show: false }, axisLine: { show: false } },
      { gridIndex: 2, type: 'category', data: teams, axisLabel: { show: false }, axisLine: { show: false } },
      { gridIndex: 3, type: 'category', data: teams, axisLabel: { fontSize: 9, rotate: 30 } },
    ],
    yAxis: [
      { gridIndex: 0, type: 'value', name: 'Нагрузка', nameTextStyle: { fontSize: 9 } },
      { gridIndex: 1, type: 'value', name: 'Качество', nameTextStyle: { fontSize: 9 } },
      { gridIndex: 2, type: 'value', name: 'Темп',     nameTextStyle: { fontSize: 9 } },
      { gridIndex: 3, type: 'value', name: 'Риск',     nameTextStyle: { fontSize: 9 } },
    ],
    series: [
      { name: 'Нагрузка', type: 'bar', xAxisIndex: 0, yAxisIndex: 0, data: load,     itemStyle: { color: info } },
      { name: 'Качество', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: quality,  itemStyle: { color: onCourse } },
      { name: 'Темп',     type: 'bar', xAxisIndex: 2, yAxisIndex: 2, data: velocity, itemStyle: { color: drift } },
      { name: 'Риск',     type: 'bar', xAxisIndex: 3, yAxisIndex: 3, data: risk,     itemStyle: { color: off } },
    ],
  };
}

export const PEOPLE_CHARTS = [
  { id: 'people-wip-bar',         build: buildWipBar,         title: 'В работе у сотрудников',         sub: 'Bar Chart · топ-16',
    hint: 'У кого больше всего «висит» в работе.' },
  { id: 'people-load-treemap',    build: buildLoadTreemap,    title: 'Нагрузка по командам',           sub: 'Treemap',
    hint: 'Площадь = объём задач у команды.' },
  { id: 'people-sunburst',        build: buildSunburst,       title: 'Команда → эпик → исполнитель',   sub: 'Sunburst',
    hint: 'Многоуровневое дерево распределения.' },
  { id: 'people-ot-polar',        build: buildOtPolar,        title: 'Овертайм-задачи по неделям',     sub: 'Polar Chart',
    hint: 'Когда команда выходила в овертайм.' },
  { id: 'people-switch-bubble',   build: buildSwitchBubble,   title: 'В работе × всего × овертайм',    sub: 'Bubble',
    hint: 'Кто перегружен и часто в овертайме.' },
  { id: 'people-team-treegraph',  build: buildTeamTreegraph,  title: 'Команда → сотрудники',           sub: 'Treegraph',
    hint: 'Иерархическое дерево принадлежности.' },
  { id: 'people-network-graph',   build: buildNetworkGraph,   title: 'Граф соавторства',               sub: 'Force Graph',
    hint: 'Кто работает над общими эпиками.' },
  { id: 'people-cross-team-wheel',build: buildCrossTeamWheel, title: 'Запросы между командами',        sub: 'Dependency Wheel',
    hint: 'Между какими командами движется работа.' },
  { id: 'people-review-heatmap',  build: buildReviewHeatmap,  title: 'Активность ревью',               sub: 'Heatmap «ревьюер × автор»',
    hint: 'Кто кому делает ревью чаще.' },
  { id: 'people-subplot',         build: buildTeamSubplot,    title: '4 показателя по командам',       sub: 'Subplot 4×1',
    hint: 'Нагрузка · качество · темп · риск одним блоком.' },
];
