'use strict';
/* ============================================================
   PORTFOLIO PULSE — METRICS / CHARTS
   Pure HTML/CSS charts (donut via conic-gradient, bars).
   ============================================================ */

import { esc, ts, daysAgo, typeBucket, isTerminalStatus, isInitialStatus, formatHrs, formatDuration, pct } from './portfolioPulseUtils.js';

/* ── Donut via conic-gradient ──────────────────────────── */
const DONUT_COLORS = ['#6366f1','#a855f7','#ec4899','#22c55e','#f59e0b','#3b82f6','#ef4444','#14b8a6','#eab308','#8b5cf6'];

export function renderDonut(title, dataObj) {
  const entries = Object.entries(dataObj || {}).filter(([k,v]) => v > 0).sort((a,b)=>b[1]-a[1]);
  const total = entries.reduce((s, e) => s + e[1], 0);
  if (!total) {
    return `<div class="pp-chart pp-chart-donut">
      <div class="pp-chart-title">${esc(title)}</div>
      <div class="pp-chart-empty">— нет данных</div></div>`;
  }
  let acc = 0;
  const stops = entries.map(([k, v], i) => {
    const start = (acc / total) * 360; acc += v;
    const end   = (acc / total) * 360;
    return `${DONUT_COLORS[i % DONUT_COLORS.length]} ${start}deg ${end}deg`;
  }).join(',');
  const legend = entries.map(([k, v], i) => `
    <div class="pp-chart-legend-row">
      <span class="pp-chart-dot" style="background:${DONUT_COLORS[i % DONUT_COLORS.length]}"></span>
      <span class="pp-chart-legend-label">${esc(k)}</span>
      <span class="pp-chart-legend-val">${v}</span>
      <span class="pp-chart-legend-pct">${pct(v, total)}%</span>
    </div>`).join('');
  return `
    <div class="pp-chart pp-chart-donut">
      <div class="pp-chart-title">${esc(title)}</div>
      <div class="pp-chart-donut-wrap">
        <div class="pp-chart-donut-ring" style="background: conic-gradient(${stops});">
          <div class="pp-chart-donut-hole">
            <div class="pp-chart-donut-total">${total}</div>
            <div class="pp-chart-donut-label">всего</div>
          </div>
        </div>
        <div class="pp-chart-legend">${legend}</div>
      </div>
    </div>`;
}

/* ── Bars ──────────────────────────────────────────────── */
export function renderBars(title, dataObj, opts = {}) {
  const entries = Object.entries(dataObj || {}).sort((a, b) => b[1] - a[1]);
  const max = entries.length ? Math.max(...entries.map(e => e[1])) : 0;
  if (!max) {
    return `<div class="pp-chart pp-chart-bars">
      <div class="pp-chart-title">${esc(title)}</div>
      <div class="pp-chart-empty">— нет данных</div></div>`;
  }
  const limit = opts.limit || 12;
  const rows = entries.slice(0, limit).map(([k, v], i) => `
    <div class="pp-bar-row">
      <span class="pp-bar-label" title="${esc(k)}">${esc(k)}</span>
      <div class="pp-bar-track"><div class="pp-bar-fill" style="width:${(v/max)*100}%;background:${DONUT_COLORS[i % DONUT_COLORS.length]}"></div></div>
      <span class="pp-bar-val">${v}${opts.suffix || ''}</span>
    </div>`).join('');
  return `<div class="pp-chart pp-chart-bars">
    <div class="pp-chart-title">${esc(title)}</div>
    <div class="pp-bar-list">${rows}</div></div>`;
}

/* ── Histogram (age buckets) ───────────────────────────── */
const AGE_BUCKETS = [
  { lab: '<7д',   max: 7 },
  { lab: '7–14д', max: 14 },
  { lab: '14–30д',max: 30 },
  { lab: '30–60д',max: 60 },
  { lab: '60–90д',max: 90 },
  { lab: '>90д',  max: Infinity },
];
export function renderAgeHistogram(title, issues, dateField = 'created') {
  const buckets = AGE_BUCKETS.map(b => ({ ...b, count: 0 }));
  for (const i of issues) {
    const age = (Date.now() - ts(i[dateField])) / (24 * 3600 * 1000);
    if (!Number.isFinite(age) || age < 0) continue;
    for (const b of buckets) { if (age <= b.max) { b.count++; break; } }
  }
  const obj = Object.fromEntries(buckets.map(b => [b.lab, b.count]));
  return renderBars(title, obj, { limit: 10 });
}

/* ── Build all metric objects from a model (no rendering) ──
   Returns { donutTypes, donutPriorities, donutStatuses, wipByPerson, ... } */
export function buildMetrics(model) {
  const allIssues = Object.values(model.spaces).flatMap(s => s.issues || []);
  const wipIssues = Object.values(model.spaces).flatMap(s => s.wipIssues || []);

  const donutTypes      = {};
  const donutPriorities = {};
  const donutStatuses   = {};
  const wipByPerson     = {};
  const wipBySpace      = {};
  const wipByType       = {};
  const loggedByPerson  = {};
  const bugsBySpace     = {};
  const unassignedBySpace = {};
  const highPrioNotStarted = [];
  const staleByPerson   = {};
  const backlogBySpace  = {};

  for (const it of allIssues) {
    donutTypes[it.type || '—']         = (donutTypes[it.type || '—'] || 0) + 1;
    donutPriorities[it.priority||'—']  = (donutPriorities[it.priority||'—'] || 0) + 1;
    donutStatuses[it.status||'—']      = (donutStatuses[it.status||'—'] || 0) + 1;
    if (typeBucket(it) === 'bug') bugsBySpace[it.pk] = (bugsBySpace[it.pk] || 0) + 1;
    if (!it.assignee && !isTerminalStatus(it.status, it.statusCat)) unassignedBySpace[it.pk] = (unassignedBySpace[it.pk] || 0) + 1;
    if (/blocker|highest|critical|критич/i.test(it.priority || '') && isInitialStatus(it.status, it.statusCat))
      highPrioNotStarted.push(it);
  }
  for (const it of wipIssues) {
    if (it.assignee) wipByPerson[it.assignee] = (wipByPerson[it.assignee] || 0) + 1;
    wipBySpace[it.pk] = (wipBySpace[it.pk] || 0) + 1;
    wipByType[it.type || '—'] = (wipByType[it.type || '—'] || 0) + 1;
  }
  for (const p of model.participants) {
    if (p.loggedYesterdaySec) loggedByPerson[p.label] = Math.round(p.loggedYesterdaySec / 3600 * 10) / 10;
    if (p.stale.length) staleByPerson[p.label] = p.stale.length;
  }
  for (const [pk, sp] of Object.entries(model.spaces)) {
    backlogBySpace[pk] = (sp.backlogIssues || []).length;
  }

  return {
    donutTypes, donutPriorities, donutStatuses,
    wipByPerson, wipBySpace, wipByType,
    loggedByPerson, bugsBySpace, unassignedBySpace,
    highPrioNotStarted, staleByPerson, backlogBySpace,
    allIssues, wipIssues,
  };
}
