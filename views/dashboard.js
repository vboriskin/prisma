'use strict';
/* ============================================================
   DASHBOARD VIEW — v8_0 ES module
   --
   SECURITY: every user-controlled value (row.team, row.epic, row.tags,
   row.comment, row.category, etc.) is escaped via `esc(...)` before
   landing in an innerHTML template. XLSX/CSV imports otherwise become a
   stored-XSS vector across all machines that open the file.
   ============================================================ */

import { state } from '../state.js';
import { FilterEngine } from '../filters.js';
import { Utils } from '../utils.js';
import { RISK_FLAGS, RELEASE_WINDOWS } from '../constants.js';
import { computeProgress } from '../metricsEngine.js';
import { RH } from './renderHelpers.js';

const esc = (v) => Utils.escapeHtml(v);
// Truncate first, then escape — order matters because escape adds non-printable
// length (e.g. `<` → `&lt;`) and we want truncation to work on plain text.
const escTrunc = (v, n) => Utils.escapeHtml(Utils.truncate(v, n));

export const DashboardView = {
  render() {
    const rows = FilterEngine.getFiltered();
    // V17 P8 (QA B-1) — empty-guard. Earlier render() unconditionally
    // poked into 8 DOM containers; on empty `state.rows` (post-filter
    // empty / pristine app) some containers were missing → TypeError.
    // Audit 2026-05-V17.
    if (!rows.length) {
      const kpiEl = document.getElementById('dashboard-kpi');
      if (kpiEl) {
        kpiEl.innerHTML = `<div class="empty-state empty-state-inline">
          <div class="empty-state-icon">📊</div>
          <div class="empty-state-title">Нет данных</div>
          <div class="empty-state-hint">Загрузите файл или сбросьте фильтры — реестр пуст.</div>
        </div>`;
      }
      ['dashboard-progress','risks-panel','blocking-detail-card','release-breakdown',
       'teams-summary-wrap','no-release-table','needs-confirm-table'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
      });
      return;
    }
    DashboardView.renderKPIs(rows);
    DashboardView.renderProgress(rows);
    DashboardView.renderRisksPanel(rows);
    DashboardView.renderBlockingCard(rows);
    DashboardView.renderReleaseBreakdown(rows);
    DashboardView.renderTeamsSummary(rows);
    DashboardView.renderNoReleaseTable(rows);
    DashboardView.renderNeedsConfirmTable(rows);
  },
  // V17 P8 — `renderHero` retired (full-stack #5 dead-code).

  renderKPIs(rows) {
    const done=rows.filter(r=>r.isDone).length;
    const kpis=[
      {label:'Всего задач',      value:rows.length,                                       cls:'',          key:'total'},
      {label:'В scope (Да)',      value:rows.filter(r=>r.scopeStatus==='Да').length,       cls:'kpi-green', key:'scope_yes'},
      {label:'Вне scope (Нет)',   value:rows.filter(r=>r.scopeStatus==='Нет').length,      cls:'kpi-gray',  key:'scope_no'},
      {label:'Треб. подтв.',      value:rows.filter(r=>r.scopeStatus==='Требует подтверждения').length, cls:'kpi-yellow', key:'needs_confirm'},
      {label:'В релизе 1.20',     value:rows.filter(r=>r.hasRelease120).length,            cls:'kpi-blue',  key:'r120'},
      {label:'В релизе 1.21',     value:rows.filter(r=>r.hasRelease121).length,            cls:'kpi-blue',  key:'r121'},
      {label:'В релизе 1.22',     value:rows.filter(r=>r.hasRelease122).length,            cls:'kpi-blue',  key:'r122'},
      {label:'В овертайме',       value:rows.filter(r=>r.hasOvertime).length,              cls:'kpi-red',   key:'overtime'},
      {label:'Без релиза',        value:rows.filter(r=>r.isUnassigned).length,             cls:'kpi-yellow',key:'no_release'},
      {label:'Блокирующих зав.',  value:rows.filter(r=>r.blockingDependency).length,       cls:'kpi-red',   key:'blocked'},
      {label:'Строк с рисками',   value:rows.filter(r=>r.riskFlags&&r.riskFlags.length).length, cls:rows.filter(r=>r.riskFlags&&r.riskFlags.length).length>0?'kpi-red':'kpi-gray', key:'risky'},
      {label:'Сделано',           value:done,                                              cls:'kpi-teal',  key:'done'},
    ];
    const el=document.getElementById('dashboard-kpi');
    el.innerHTML=kpis.map(k=>`
      <div class="kpi-card ${k.cls}" style="cursor:pointer" data-kpi="${k.key}"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div></div>`).join('');
    // Attach click handlers
    const kpiFilters={
      total:      ()=>rows,
      scope_yes:  ()=>rows.filter(r=>r.scopeStatus==='Да'),
      scope_no:   ()=>rows.filter(r=>r.scopeStatus==='Нет'),
      needs_confirm:()=>rows.filter(r=>r.scopeStatus==='Требует подтверждения'),
      r120:       ()=>rows.filter(r=>r.hasRelease120),
      r121:       ()=>rows.filter(r=>r.hasRelease121),
      r122:       ()=>rows.filter(r=>r.hasRelease122),
      overtime:   ()=>rows.filter(r=>r.hasOvertime),
      no_release: ()=>rows.filter(r=>r.isUnassigned),
      blocked:    ()=>rows.filter(r=>r.blockingDependency),
      risky:      ()=>rows.filter(r=>r.riskFlags&&r.riskFlags.length),
      done:       ()=>rows.filter(r=>r.isDone),
    };
    // V17 P8 (full-stack #1.1.3) — replaced N×addEventListener-on-card
    // (memory bloat) with single delegated `el.onclick` (overwrite-pattern).
    // Audit 2026-05-V17.
    el.onclick = (ev) => {
      const card = ev.target.closest('[data-kpi]');
      if (!card) return;
      const key   = card.dataset.kpi;
      const label = card.querySelector('.kpi-label').textContent;
      const filterFn = kpiFilters[key];
      const filteredRows = filterFn ? filterFn() : [];
      DashboardView.openKpiModal(label, filteredRows, key);
    };
  },
  renderProgress(rows) {
    const el = document.getElementById('dashboard-progress');
    if (!el) return;
    const p = computeProgress(rows);
    const releases = [
      { key:'120', label:'1.20', color:'#3b82f6' },
      { key:'121', label:'1.21', color:'#8b5cf6' },
      { key:'122', label:'1.22', color:'#10b981' },
      { key:'ot',  label:'OT',   color:'#f97316' },
      { key:'all', label:'Всего',color:'#64748b' },
    ];
    el.innerHTML = releases.map(r => {
      const d = p[r.key] || {total:0,done:0,pct:0};
      const overload = d.total > 30 && r.key !== 'all';
      return `<div class="progress-card">
        <div class="progress-card-header">
          <span class="progress-label">${r.label}</span>
          <span class="progress-counts">${d.done} / ${d.total} задач${overload?' ⚠️':''}</span>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill" style="width:${d.pct}%;background:${r.color}"></div>
        </div>
        <div class="progress-pct">${d.pct}%</div>
      </div>`;
    }).join('');
  },
  // V17 P8 — `kpiKey` теперь тоже параметр, чтобы footer-CTA знал какой
  // фильтр применить в реестре. Если не передан — fallback к стандартному
  // поведению без CTA. (designer Quick win 1)
  openKpiModal(title, rows, kpiKey) {
    const overlay = document.getElementById('modal-kpi');
    if (overlay) overlay.dataset.owner = 'dashboard';
    document.getElementById('modal-kpi-title').textContent = title;
    const body = document.getElementById('modal-kpi-body');
    // Wire the «Open in registry» CTA — maps kpiKey → state.filters payload.
    const cta = document.getElementById('modal-kpi-goto-registry');
    if (cta) {
      const filterPayloadByKpi = {
        scope_yes:    { scope: 'Да' },
        scope_no:     { scope: 'Нет' },
        needs_confirm:{ scope: 'Требует подтверждения' },
        r120:         { release: '1.20' },
        r121:         { release: '1.21' },
        r122:         { release: '1.22' },
        overtime:     { release: 'overtime' },
        no_release:   { release: 'none' },
        blocked:      { onlyBlocking: true },
        risky:        { onlyRisky: true },
        done:         { onlyDone: true },
      };
      const payload = filterPayloadByKpi[kpiKey];
      cta.style.display = payload ? '' : 'none';
      cta.onclick = () => {
        if (!payload) return;
        // Apply filter via state.filters and navigate.
        if (state.filters && typeof state.filters === 'object') {
          Object.assign(state.filters, payload);
        }
        try { window.notify?.('filters'); } catch (_) {}
        try { window.App?.populateFilterDropdowns?.(); } catch (_) {}
        overlay.classList.add('hidden');
        try { window.App?.goTo?.('registry'); } catch (_) {}
      };
    }
    if (!rows.length) { body.innerHTML = '<div style="padding:20px;color:var(--text-3)">Нет строк</div>'; }
    else {
      body.innerHTML = `<table class="data-table" style="width:100%">
        <thead><tr><th>Команда</th><th>Эпик</th><th>Задачи</th><th>Scope</th><th>Категория</th><th>Теги</th><th>Релизы</th></tr></thead>
        <tbody>${rows.map(r=>`<tr>
          <td>${esc(r.team||'—')}</td>
          <td>${esc(r.epic||'—')}</td>
          <td style="max-width:200px"><div class="tasks-cell">${RH.jiraTagsHtml(r.tasks)}</div></td>
          <td>${RH.scopeChip(r.scopeStatus)}</td>
          <td>${esc(r.category||'—')}</td>
          <td>${esc(r.tags||'—')}</td>
          <td>${RH.releaseChips(r)}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    }
    document.getElementById('modal-kpi').classList.remove('hidden');
  },
  renderRisksPanel(rows) {
    const byFlag={};
    rows.forEach(r=>(r.riskFlags||[]).forEach(f=>{byFlag[f]=(byFlag[f]||0)+1;}));
    const el=document.getElementById('risks-panel');
    if (!Object.keys(byFlag).length) { el.innerHTML='<div class="risks-panel-title">Риски внимания</div><div class="text-muted text-sm">Нет активных рисков</div>'; return; }
    el.innerHTML=`<div class="risks-panel-title">Риски внимания</div><div class="risks-panel-items">${
      Object.entries(byFlag).map(([f,c])=>`<div class="risk-counter"><div class="risk-counter-value">${esc(c)}</div><div class="risk-counter-label">${esc(RISK_FLAGS[f]||f)}</div></div>`).join('')
    }</div>`;
  },
  renderBlockingCard(rows) {
    const blocking=rows.filter(r=>r.blockingDependency);
    const el=document.getElementById('blocking-detail-card');
    if (!blocking.length) { el.innerHTML=''; return; }
    const rowsHtml=blocking.slice(0,20).map(r=>`
      <tr>
        <td>${escTrunc(r.team,16)}</td>
        <td>${escTrunc(r.epic,28)}</td>
        <td><div class="tasks-cell">${RH.jiraTagsHtml(r.tasks)}</div></td>
        <td>${esc(r.blockingDeadline||'—')}</td>
        <td>${RH.releaseChips(r)}</td>
        <td>${RH.scopeChip(r.scopeStatus)}</td>
        <td>${esc(r.category||'—')}</td>
        <td>${esc(r.tags||'—')}</td>
        <td>${escTrunc(r.comment,40)||'—'}</td>
      </tr>`).join('');
    el.innerHTML=`<div class="blocking-detail-card">
      <div class="blocking-detail-title">Блокирующие зависимости (${blocking.length})</div>
      <div style="overflow-x:auto"><table class="data-table">
        <thead><tr><th>Команда</th><th>Эпик</th><th>Задачи</th><th>Deadline</th><th>Релизы</th><th>Scope</th><th>Категория</th><th>Теги</th><th>Комментарий</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table></div></div>`;
  },
  renderReleaseBreakdown(rows) {
    const releases=[
      {key:'r120',field:'hasRelease120',tf:'release120Types'},
      {key:'r121',field:'hasRelease121',tf:'release121Types'},
      {key:'r122',field:'hasRelease122',tf:'release122Types'},
      {key:'overtime',field:'hasOvertime',tf:'overtimeTypes'},
    ];
    document.getElementById('release-breakdown').innerHTML=releases.map(rel=>{
      const rw=RELEASE_WINDOWS[rel.key];
      const rr=rows.filter(r=>r[rel.field]);
      const wtMap={};
      rr.forEach(r=>(r[rel.tf]||[]).forEach(t=>{wtMap[t]=(wtMap[t]||0)+1;}));
      const scMap={'Да':0,'Нет':0,'Требует подтверждения':0};
      rr.forEach(r=>{if(r.scopeStatus in scMap)scMap[r.scopeStatus]++;});
      const done=rr.filter(r=>r.isDone).length;
      return `<div class="release-card">
        <div class="release-card-header"><div class="release-card-title">${esc(rw.label)}</div><div class="release-card-dates">${esc(rw.dates)}</div></div>
        <div class="release-card-count">${rr.length} задач</div>
        <div class="mini-breakdown">
          <div class="mini-breakdown-row"><span class="mini-breakdown-label">В scope (Да)</span><span class="mini-breakdown-val">${scMap['Да']}</span></div>
          <div class="mini-breakdown-row"><span class="mini-breakdown-label">Треб. подтв.</span><span class="mini-breakdown-val">${scMap['Требует подтверждения']}</span></div>
          <div class="mini-breakdown-row"><span class="mini-breakdown-label">Сделано</span><span class="mini-breakdown-val">${done}</span></div>
          ${Object.entries(wtMap).slice(0,3).map(([t,c])=>`<div class="mini-breakdown-row"><span class="mini-breakdown-label">${esc(t)}</span><span class="mini-breakdown-val">${c}</span></div>`).join('')}
        </div></div>`;
    }).join('');
  },
  renderTeamsSummary(rows) {
    const teams=Utils.unique(rows.map(r=>r.team));
    if (!teams.length) { document.getElementById('teams-summary-wrap').innerHTML=''; return; }
    document.getElementById('teams-summary-wrap').innerHTML=`<div class="data-table-wrap">
      <div class="data-table-title">Сводка по командам</div>
      <div style="overflow-x:auto"><table class="data-table">
        <thead><tr><th style="text-align:left">Команда</th><th style="text-align:left">Всего</th><th style="text-align:left">Да</th><th style="text-align:left">Нет</th><th style="text-align:left">Треб.</th><th style="text-align:left">1.20</th><th style="text-align:left">1.21</th><th style="text-align:left">1.22</th><th style="text-align:left">OT</th><th style="text-align:left">Без рел.</th><th style="text-align:left">Блокер</th><th style="text-align:left">Риски</th><th style="text-align:left">Сделано</th></tr></thead>
        <tbody>${teams.map(team=>{
          const tr=rows.filter(r=>r.team===team);
          return `<tr><td style="text-align:left"><strong>${esc(team)}</strong></td>${[
            tr.length,
            tr.filter(r=>r.scopeStatus==='Да').length,
            tr.filter(r=>r.scopeStatus==='Нет').length,
            tr.filter(r=>r.scopeStatus==='Требует подтверждения').length,
            tr.filter(r=>r.hasRelease120).length,
            tr.filter(r=>r.hasRelease121).length,
            tr.filter(r=>r.hasRelease122).length,
            tr.filter(r=>r.hasOvertime).length,
            tr.filter(r=>r.isUnassigned).length,
            tr.filter(r=>r.blockingDependency).length,
            tr.filter(r=>r.riskFlags&&r.riskFlags.length).length,
            tr.filter(r=>r.isDone).length,
          ].map(c=>`<td style="text-align:left">${c||'—'}</td>`).join('')}</tr>`;
        }).join('')}</tbody>
      </table></div></div>`;
  },
  renderNoReleaseTable(rows) {
    const nr=rows.filter(r=>r.isUnassigned&&!r.isDone);
    const el=document.getElementById('no-release-wrap');
    if (!nr.length) { el.innerHTML=`<div class="data-table-wrap"><div class="data-table-title">Без релиза</div><div style="padding:20px;color:var(--text-3);font-size:12px">Все задачи назначены</div></div>`; return; }
    el.innerHTML=`<div class="data-table-wrap"><div class="data-table-title">Без релиза <span class="count-badge">${nr.length}</span></div>
      <div style="overflow-x:auto;max-height:320px;overflow-y:auto"><table class="data-table"><thead><tr><th>Команда</th><th>Эпик</th><th>Задача</th><th>Scope</th><th>Риски</th></tr></thead>
      <tbody>${nr.slice(0,50).map(r=>`<tr><td>${escTrunc(r.team,16)}</td><td>${escTrunc(r.epic,24)}</td><td><div class="tasks-cell">${RH.jiraTagsHtml(r.tasks)}</div></td><td>${RH.scopeChip(r.scopeStatus)}</td><td>${RH.riskBadges(r.riskFlags)}</td></tr>`).join('')}</tbody>
      </table></div></div>`;
  },
  renderNeedsConfirmTable(rows) {
    const nc=rows.filter(r=>r.scopeStatus==='Требует подтверждения');
    const el=document.getElementById('needs-confirm-wrap');
    if (!nc.length) { el.innerHTML=`<div class="data-table-wrap"><div class="data-table-title">Требует подтверждения</div><div style="padding:20px;color:var(--text-3);font-size:12px">Нет задач</div></div>`; return; }
    el.innerHTML=`<div class="data-table-wrap"><div class="data-table-title">Требует подтверждения <span class="count-badge">${nc.length}</span></div>
      <div style="overflow-x:auto;max-height:320px;overflow-y:auto"><table class="data-table"><thead><tr><th>Команда</th><th>Эпик</th><th>Задача</th><th>Релизы</th><th>Риски</th></tr></thead>
      <tbody>${nc.slice(0,50).map(r=>`<tr><td>${escTrunc(r.team,16)}</td><td>${escTrunc(r.epic,24)}</td><td><div class="tasks-cell">${RH.jiraTagsHtml(r.tasks)}</div></td><td>${RH.releaseChips(r)}</td><td>${RH.riskBadges(r.riskFlags)}</td></tr>`).join('')}</tbody>
      </table></div></div>`;
  },
};
