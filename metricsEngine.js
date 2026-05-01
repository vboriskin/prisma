'use strict';
/* ============================================================
   METRICS ENGINE — v8_0 ES module
   ============================================================ */

export function computeProgress(rows) {
  const releases = ['120','121','122','ot'];
  const result = {};
  releases.forEach(rel => {
    const key = rel === 'ot' ? 'hasOvertime' : `hasRelease${rel}`;
    const inRel = rows.filter(r => r[key]);
    const done = inRel.filter(r => r.isDone).length;
    result[rel] = { total: inRel.length, done, pct: inRel.length ? Math.round(done/inRel.length*100) : 0 };
  });
  const total = rows.length;
  const done = rows.filter(r => r.isDone).length;
  result.all = { total, done, pct: total ? Math.round(done/total*100) : 0 };
  return result;
}

export function computeLoad(rows) {
  const load = {};
  rows.forEach(r => {
    const assignees = String(r.assignee||'').split(/[|,]/).map(s=>s.trim()).filter(Boolean);
    assignees.forEach(name => {
      if (!load[name]) load[name] = { total:0, r120:0, r121:0, r122:0, ot:0 };
      load[name].total++;
      if (r.hasRelease120) load[name].r120++;
      if (r.hasRelease121) load[name].r121++;
      if (r.hasRelease122) load[name].r122++;
      if (r.hasOvertime)   load[name].ot++;
    });
  });
  return load;
}
