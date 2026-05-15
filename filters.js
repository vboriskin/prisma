'use strict';
/* ============================================================
   FILTER ENGINE — v8_0 ES module
   ============================================================ */

import { state } from './state.js';
import { Utils } from './utils.js';

export const FilterEngine = {
  _cacheKey: '',
  _cacheRows: [],
  _buildCacheKey() {
    const f = state.filters || {};
    const roleKey = Array.isArray(f.role) ? f.role.join('|') : (f.role || '');
    const assigneeKey = Array.isArray(f.assignee) ? f.assignee.join('|') : (f.assignee || '');
    const tagKey = Array.isArray(f.tag) ? f.tag.join('|') : (f.tag || '');
    // F12 fix (codebase-01 audit) — раньше cache_hash зависел от _dataVersion;
    // если subscriber пропускал invalidate (re-entry guard в app.js:2065),
    // кэш оставался stale. Добавили `state.rows.length` как fallback fingerprint:
    // CRUD-операция меняет длину → cache miss даже без _dataVersion bump.
    return [
      state._dataVersion,
      state.rows.length,
      f.search || '',
      f.team || '',
      f.scope || '',
      f.release || '',
      f.workType || '',
      roleKey,
      assigneeKey,
      tagKey,
      f.onlyBlocking ? 1 : 0,
      f.onlyRisky ? 1 : 0,
      f.onlyDone ? 1 : 0,
    ].join('~');
  },
  invalidate() {
    FilterEngine._cacheKey = '';
    FilterEngine._cacheRows = [];
  },
  getFiltered() {
    const f=state.filters;
    const cacheKey = FilterEngine._buildCacheKey();
    if (cacheKey === FilterEngine._cacheKey) return FilterEngine._cacheRows;
    const rows = state.rows.filter(row=>{
      if (f.search) {
        const q=f.search.toLowerCase();
        if (![row.team,row.category,row.tags,row.epic,row.tasks,row.taskComment,row.comment,row.role,row.assignee].join(' ').toLowerCase().includes(q)) return false;
      }
      if (f.team && row.team!==f.team) return false;
      if (f.scope && row.scopeStatus!==f.scope) return false;
      if (f.release) {
        if (f.release==='1.20'&&!row.hasRelease120) return false;
        if (f.release==='1.21'&&!row.hasRelease121) return false;
        if (f.release==='1.22'&&!row.hasRelease122) return false;
        if (f.release==='overtime'&&!row.hasOvertime) return false;
        if (f.release==='none'&&!row.isUnassigned) return false;
      }
      if (f.workType) {
        const all=[...row.release120Types,...row.release121Types,...row.release122Types,...row.overtimeTypes];
        if (!all.includes(f.workType)) return false;
      }
      if (f.role) {
        const reqRoles=Array.isArray(f.role)?f.role:[f.role];
        const roles=String(row.role||'').split(/[,|]/).map(s=>s.trim()).filter(Boolean);
        if (!reqRoles.some(rr=>roles.includes(rr))) return false;
      }
      if (f.assignee) {
        const reqAssignees=Array.isArray(f.assignee)?f.assignee:[f.assignee];
        const assignees=String(row.assignee||'').split(/[,|]/).map(s=>s.trim()).filter(Boolean);
        if (!reqAssignees.some(ra=>assignees.includes(ra))) return false;
      }
      if (f.onlyBlocking&&!row.blockingDependency) return false;
      if (f.onlyRisky&&(!row.riskFlags||!row.riskFlags.length)) return false;
      if (f.onlyDone&&!row.isDone) return false;
      if (f.tag) {
        // V17 P11 (QA B4) — split on `[|,]` to match `getUniqueTagValues` in
        // tagInput.js. Previously a row imported with comma-separated tags
        // «BE, FE» was listed as 2 chips in the dropdown but kept the literal
        // «BE, FE» as a single value here, so the filter never matched.
        const reqTags=Array.isArray(f.tag)?f.tag:[f.tag];
        if (!row.tags) return false;
        const rowTags = String(row.tags).split(/[|,]/).map(s=>s.trim()).filter(Boolean);
        if (!reqTags.some(rt=>rowTags.includes(rt))) return false;
      }
      return true;
    });
    FilterEngine._cacheKey = cacheKey;
    FilterEngine._cacheRows = rows;
    return rows;
  },
  getTeams() { return Utils.unique(state.rows.map(r=>r.team)); },
  getWorkTypes() {
    const all=[];
    state.rows.forEach(r=>all.push(...r.release120Types,...r.release121Types,...r.release122Types,...r.overtimeTypes));
    return Utils.unique(all);
  },
  getRoles() {
    const s=new Set();
    state.rows.forEach(r=>{ if(r.role) String(r.role).split('|').map(x=>x.trim()).filter(Boolean).forEach(v=>s.add(v)); });
    return [...s].sort();
  },
  getAssignees() {
    const s=new Set();
    state.rows.forEach(r=>{ if(r.assignee) String(r.assignee).split('|').map(x=>x.trim()).filter(Boolean).forEach(v=>s.add(v)); });
    state.employees.forEach(e=>{ if(e.fio) s.add(String(e.fio).trim()); });
    return [...s].sort((a,b)=>a.localeCompare(b,'ru'));
  },
  // V17 P10 / V22 fix (2026-05-10) — counter показывает ЧИСЛО ВЫБРАННЫХ
  // ЗНАЧЕНИЙ, а не dimensions. Раньше: assignee=[A,B,C] → 1; теперь → 3.
  // Совпадает с user mental model «1 в badge = 1 выбранный фильтр».
  getActiveCount() {
    const f = state.filters || {};
    let n = 0;
    if (f.search) n++;
    if (f.team) n++;
    if (f.scope) n++;
    if (f.release) n++;
    if (f.workType) n++;
    n += Array.isArray(f.role)     ? f.role.length     : (f.role     ? 1 : 0);
    n += Array.isArray(f.assignee) ? f.assignee.length : (f.assignee ? 1 : 0);
    n += Array.isArray(f.tag)      ? f.tag.length      : (f.tag      ? 1 : 0);
    if (f.onlyBlocking) n++;
    if (f.onlyRisky) n++;
    if (f.onlyDone) n++;
    return n;
  },
};
