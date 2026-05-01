'use strict';
/* ============================================================
   TIMELINE VIEW + PODLOZHKA VIEW — v8_0 ES module
   ============================================================ */

import { state } from '../state.js';
import { FilterEngine } from '../filters.js';
import { Utils } from '../utils.js';
import { RH } from './renderHelpers.js';
// Audit-#4: lit-html-style auto-escape for the most XSS-prone view —
// PodlozhkaView renders r.comment / r.epic / r.role / r.blockingDeadline
// directly from user-imported XLSX data.
import { html as sht } from '../libs/safeHtml.js';

export const TimelineView = {
  render() {
    if (state.timelineMode==='detailed') TimelineView.renderDetailed();
    else TimelineView.renderSummary();
  },
  _stages() {
    return [
      {key:'backlog',  label:'Бэклог',    dates:'',            stageCls:'stage-backlog',  filter:r=>r.isUnassigned,  tf:null},
      {key:'r120',     label:'1.20',       dates:'20.04–17.05', stageCls:'stage-r120',     filter:r=>r.hasRelease120, tf:'release120Types'},
      {key:'r121',     label:'1.21',       dates:'18.05–14.06', stageCls:'stage-r121',     filter:r=>r.hasRelease121, tf:'release121Types'},
      {key:'r122',     label:'1.22',       dates:'15.06–14.07', stageCls:'stage-r122',     filter:r=>r.hasRelease122, tf:'release122Types'},
      {key:'overtime', label:'OT',         dates:'Овертайм',    stageCls:'stage-overtime', filter:r=>r.hasOvertime,   tf:'overtimeTypes'},
    ];
  },
  _wtColors:{
    'backend':'#3b82f6','frontend':'#22c55e','тестирование':'#a855f7',
    'аналитика':'#f97316','бизнес аналитика':'#fb923c','внедрение':'#06b6d4',
    'миграция данных':'#84cc16','стабилизация':'#64748b','хотфикс':'#ef4444',
  },
  renderSummary() {
    const filtered=FilterEngine.getFiltered();
    const stages=TimelineView._stages();
    const stageData=stages.map(s=>{
      const rows=filtered.filter(s.filter), count=rows.length;
      const wtMap={},scMap={'Да':0,'Нет':0,'Требует подтверждения':0},doneCount=rows.filter(r=>r.isDone).length;
      rows.forEach(r=>{if(s.tf)(r[s.tf]||[]).forEach(t=>{wtMap[t]=(wtMap[t]||0)+1;});if(r.scopeStatus in scMap)scMap[r.scopeStatus]++;});
      return{...s,count,wtMap,scMap,doneCount};
    });
    const maxC=Math.max(...stageData.map(s=>s.count),1);
    const allWt=Utils.unique(stageData.flatMap(s=>Object.keys(s.wtMap)));
    const wc=TimelineView._wtColors;

    const countSection=`<div class="timeline-section"><div class="timeline-section-title">Количество задач по стадиям</div>
      <div class="timeline-stages">${stageData.map(s=>`
        <div class="timeline-stage">
          <div class="timeline-stage-header ${s.stageCls}">${s.label}<br><span style="font-size:10px;font-weight:400">${s.dates}</span></div>
          <div class="timeline-stage-body">
            <div class="timeline-stat">${s.count}</div>
            <div class="timeline-stat-sub">задач${s.doneCount?` / ${s.doneCount} ✅`:''}</div>
            <div style="height:6px;background:var(--border-light);border-radius:3px;margin-top:8px;overflow:hidden">
              <div class="${s.stageCls}" style="height:100%;width:${s.count/maxC*100}%;background:currentColor;border-radius:3px"></div>
            </div>
          </div></div>`).join('')}</div></div>`;

    const wtSection=allWt.length?`<div class="timeline-section"><div class="timeline-section-title">По типу работ</div>
      ${stageData.map(s=>{const tot=Object.values(s.wtMap).reduce((a,b)=>a+b,0)||1;
        return`<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <div style="width:120px;font-size:11px;font-weight:600;color:var(--text-3);text-align:right;flex-shrink:0">${s.label}</div>
          <div class="timeline-bar-wrap" style="flex:1">${allWt.map(wt=>{const c=s.wtMap[wt]||0;if(!c)return'';return`<div class="timeline-bar-seg" title="${wt}:${c}" style="width:${c/tot*100}%;background:${wc[wt]||'#888'}"></div>`;}).join('')}</div>
          <div style="width:30px;font-size:11px;color:var(--text-3)">${s.count}</div></div>`;}).join('')}
      <div class="timeline-legend">${allWt.map(wt=>`<div class="legend-item"><div class="legend-dot" style="background:${wc[wt]||'#888'}"></div>${wt}</div>`).join('')}</div></div>`:'' ;

    const scopeSection=`<div class="timeline-section"><div class="timeline-section-title">По статусу Scope</div>
      ${stageData.map(s=>{const tot=s.count||1;
        return`<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <div style="width:120px;font-size:11px;font-weight:600;color:var(--text-3);text-align:right;flex-shrink:0">${s.label}</div>
          <div class="timeline-bar-wrap" style="flex:1">
            ${[['Да','#059669'],['Нет','#9ca3af'],['Требует подтверждения','#d97706']].map(([sc,cl])=>{const c=s.scMap[sc]||0;if(!c)return'';return`<div class="timeline-bar-seg" title="${sc}:${c}" style="width:${c/tot*100}%;background:${cl}"></div>`;}).join('')}
          </div>
          <div style="width:30px;font-size:11px;color:var(--text-3)">${s.count}</div></div>`;}).join('')}
      <div class="timeline-legend"><div class="legend-item"><div class="legend-dot" style="background:#059669"></div>Да</div><div class="legend-item"><div class="legend-dot" style="background:#9ca3af"></div>Нет</div><div class="legend-item"><div class="legend-dot" style="background:#d97706"></div>Треб.</div></div></div>`;

    document.getElementById('timeline-wrap').innerHTML=countSection+wtSection+scopeSection;
  },
  renderDetailed() {
    const filtered=FilterEngine.getFiltered();
    const stages=TimelineView._stages();
    const teams=Utils.unique(filtered.map(r=>r.team));
    const wc=TimelineView._wtColors;
    if (!teams.length) { document.getElementById('timeline-wrap').innerHTML='<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">Нет данных</div></div>'; return; }

    const html=stages.map(stage=>{
      const stageRows=filtered.filter(stage.filter);
      const maxTeamCount=Math.max(...teams.map(t=>stageRows.filter(r=>r.team===t).length),1);
      const teamRows=teams.map(team=>{
        const tr=stageRows.filter(r=>r.team===team), cnt=tr.length;
        if(!cnt)return`<div class="timeline-team-row"><div class="timeline-team-label">${Utils.truncate(team,18)}</div><div class="timeline-team-bars"><div class="timeline-team-bar-cell"><div class="timeline-team-bar-inner"><div style="width:100%;background:var(--border-light);height:100%"></div></div></div></div><div class="timeline-team-count">—</div></div>`;
        // Work type breakdown
        const wtMap={}; if(stage.tf)tr.forEach(r=>(r[stage.tf]||[]).forEach(t=>{wtMap[t]=(wtMap[t]||0)+1;}));
        const tot=Object.values(wtMap).reduce((a,b)=>a+b,0)||1;
        const segs=Object.entries(wtMap).map(([wt,c])=>`<div class="timeline-bar-seg" title="${wt}:${c}" style="width:${c/tot*100}%;background:${wc[wt]||'#888'}"></div>`).join('');
        const done=tr.filter(r=>r.isDone).length;
        const barW=cnt/maxTeamCount*100;
        return`<div class="timeline-team-row">
          <div class="timeline-team-label">${Utils.truncate(team,18)}</div>
          <div class="timeline-team-bars"><div class="timeline-team-bar-cell" style="position:relative">
            <div style="width:${barW}%;min-width:${cnt?'4px':'0'}">
              <div class="timeline-team-bar-inner">${segs||`<div style="width:100%;background:#d1d5db;height:100%"></div>`}</div>
            </div>
          </div></div>
          <div class="timeline-team-count">${cnt}${done?` / ${done}✅`:''}</div></div>`;
      }).join('');
      return`<div class="timeline-section"><div class="timeline-section-title" style="display:flex;gap:8px;align-items:center">
        <span class="chip ${stage.stageCls}" style="font-size:13px;padding:4px 10px">${stage.label}</span>
        ${stage.dates} — ${stageRows.length} задач
      </div>${teamRows||'<div style="color:var(--text-3);font-size:12px">Нет задач в этой стадии</div>'}</div>`;
    }).join('');
    document.getElementById('timeline-wrap').innerHTML=html;
  },
};

export const PodlozhkaView = {
  render() {
    const filtered=FilterEngine.getFiltered();
    const groupBy=state.podlozhkaGroup;
    const badge=document.getElementById('podlozhka-badge');
    badge.textContent=`${filtered.length} задач`;
    const wrap=document.getElementById('podlozhka-wrap');
    if (!filtered.length) { wrap.innerHTML='<div class="empty-state"><div class="empty-icon">📂</div><div class="empty-title">Нет данных</div></div>'; return; }

    // Group rows
    let groups={};
    if (groupBy==='none') { groups={'Все задачи':filtered}; }
    else {
      filtered.forEach(r=>{
        const key=groupBy==='team'?r.team:groupBy==='epic'?r.epic:groupBy==='scope'?r.scopeStatus||'—':'—';
        if (!groups[key||'—']) groups[key||'—']=[];
        groups[key||'—'].push(r);
      });
    }

    const tableHtml=(rows)=>{
      if (state.podlozhkaMode==='detailed') {
        const cols=window.RegistryView?.getVisibleCols()||[];
        const headers=cols.map(c=>state.colLabels[c.key]||c.label);
        const format=(r,c)=>{
          const v=r[c.key];
          if (c.key==='tasks') return `<div class="pod-tasks">${RH.jiraTagsHtml(v||'')}</div>`;
          if (Array.isArray(v)) return v.length?v.join(', '):'—';
          if (typeof v==='boolean') return v?'Да':'Нет';
          if (c.type==='scope') return RH.scopeChip(v);
          if (c.type==='multiselect') return RH.workTypeChips(v||[]);
          if (c.key==='isDone') return r.isDone?`<span class="chip chip-done">✅${r.doneDate?' '+r.doneDate:''}</span>`:'—';
          if (c.key==='blockingDependency') return r.blockingDependency?`<span class="chip chip-red">🚧${r.blockingDeadline?' '+r.blockingDeadline:''}</span>`:'—';
          return Utils.escapeHtml(String(v==null||v===''?'—':v));
        };
        return `<div style="overflow-x:auto"><table class="podlozhka-table">
          <thead><tr>${headers.map(h=>`<th>${Utils.escapeHtml(h)}</th>`).join('')}<th>Риски</th></tr></thead>
          <tbody>${rows.map(r=>{
            const riskCls=r.riskFlags&&r.riskFlags.length?' pod-risky':'';
            const doneCls=r.isDone?' pod-done':'';
            return `<tr class="${riskCls}${doneCls}">${cols.map(c=>`<td>${format(r,c)}</td>`).join('')}<td>${RH.riskBadges(r.riskFlags)||'—'}</td></tr>`;
          }).join('')}</tbody>
        </table></div>`;
      }
      return String(sht`<div style="overflow-x:auto"><table class="podlozhka-table">
        <thead><tr><th>Эпик</th><th>Задачи</th><th>Scope</th><th>Релизы</th><th>Тип работ</th><th>Роль</th><th>Риски</th><th>Блокер</th><th>Сделано</th><th>Комментарий</th></tr></thead>
        <tbody>${rows.map(r => {
          const allTypes = [...r.release120Types, ...r.release121Types, ...r.release122Types, ...r.overtimeTypes];
          const cls = (r.riskFlags && r.riskFlags.length ? 'pod-risky ' : '') + (r.isDone ? 'pod-done' : '');
          return sht`<tr class="${cls.trim()}">
            <td style="font-weight:600;min-width:140px">${r.epic || '—'}</td>
            <td style="min-width:200px"><div class="pod-tasks">${RH.jiraTagsHtml(r.tasks)}</div></td>
            <td>${RH.scopeChip(r.scopeStatus)}</td>
            <td><div class="pod-release-chips">${RH.releaseChips(r)}</div></td>
            <td>${allTypes.length ? RH.workTypeChips(allTypes) : '—'}</td>
            <td>${r.role ? sht`<span class="chip chip-indigo">${Utils.truncate(r.role, 20)}</span>` : '—'}</td>
            <td>${RH.riskBadges(r.riskFlags) || '—'}</td>
            <td>${r.blockingDependency
                  ? sht`<span class="chip chip-red">🚧${r.blockingDeadline ? ' ' + r.blockingDeadline : ''}</span>`
                  : '—'}</td>
            <td>${r.isDone
                  ? sht`<span class="chip chip-done">✅${r.doneDate ? ' ' + r.doneDate : ''}</span>`
                  : '—'}</td>
            <td style="max-width:200px;color:var(--text-3)">${Utils.truncate(r.comment, 60) || '—'}</td>
          </tr>`;
        })}</tbody>
      </table></div>`);
    };

    wrap.innerHTML=Object.entries(groups).map(([groupKey,rows])=>{
      const doneCount=rows.filter(r=>r.isDone).length;
      const blockers=rows.filter(r=>r.blockingDependency).length;
      const risky=rows.filter(r=>r.riskFlags&&r.riskFlags.length).length;
      return`<div class="podlozhka-group">
        <div class="podlozhka-group-header">
          <div class="podlozhka-group-title">${groupKey}</div>
          <div class="podlozhka-group-meta">
            <span>${rows.length} задач</span>
            ${doneCount?`<span>✅ ${doneCount}</span>`:''}
            ${blockers?`<span>🚧 ${blockers}</span>`:''}
            ${risky?`<span>⚠ ${risky}</span>`:''}
          </div>
        </div>
        ${tableHtml(rows)}</div>`;
    }).join('');
  },
};
