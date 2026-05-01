'use strict';
/* ============================================================
   SUMMARY VIEW + METRICS VIEW + INSIGHTS VIEW + DIAGNOSTICS VIEW
   — v8_0 ES module
   --
   SECURITY: every user-controlled value (row fields, XLSX sheet names,
   detected column headers, warnings) is escaped via Utils.escapeHtml
   before innerHTML interpolation. XLSX import is the primary stored-XSS
   surface — never let raw cell text into the DOM.
   ============================================================ */

import { state } from '../state.js';
import { FilterEngine } from '../filters.js';
import { Utils } from '../utils.js';
import { GANTT_RELEASE_BOUNDS } from '../constants.js';
// Audit-#4: lit-html-style auto-escape for the most XSS-prone view (Diagnostics
// surfaces XLSX sheet names + column headers + parser warnings — pure user data).
import { html as sht, render as safeRender } from '../libs/safeHtml.js';

const esc = (v) => Utils.escapeHtml(v);

// ============================================================
// SUMMARY VIEW (CEO)
// ============================================================
export const SummaryView = {
  splitTags(v) { return String(v||'').split(/[|,]/).map(s=>s.trim()).filter(Boolean); },
  render() {
    const rows=FilterEngine.getFiltered();
    const wrap=document.getElementById('summary-wrap');
    if (!rows.length) {
      wrap.innerHTML='<div class="empty-state"><div class="empty-icon">📈</div><div class="empty-title">Нет данных для сводной</div></div>';
      return;
    }
    // V17.1 G1 — режим superBeautiful удалён; всегда рендерим краткий вид.
    SummaryView.renderBrief(rows,wrap);
  },
  renderBrief(rows,wrap) {
    const done=rows.filter(r=>r.isDone).length;
    const blockers=rows.filter(r=>r.blockingDependency).length;
    const risky=rows.filter(r=>r.riskFlags&&r.riskFlags.length).length;
    const noRelease=rows.filter(r=>r.isUnassigned).length;
    const ot=rows.filter(r=>r.hasOvertime).length;
    const inScope=rows.filter(r=>r.scopeStatus==='Да').length;
    const progress=rows.length?Math.round(done/rows.length*100):0;

    const relRows=[
      {k:'1.20', total:rows.filter(r=>r.hasRelease120).length, done:rows.filter(r=>r.hasRelease120&&r.isDone).length},
      {k:'1.21', total:rows.filter(r=>r.hasRelease121).length, done:rows.filter(r=>r.hasRelease121&&r.isDone).length},
      {k:'1.22', total:rows.filter(r=>r.hasRelease122).length, done:rows.filter(r=>r.hasRelease122&&r.isDone).length},
      {k:'OT', total:rows.filter(r=>r.hasOvertime).length, done:rows.filter(r=>r.hasOvertime&&r.isDone).length},
    ];

    wrap.innerHTML=`
      <div class="summary-grid" style="margin-bottom:12px">
        <div class="summary-card"><h4>Всего задач</h4><div class="summary-big">${rows.length}</div><div class="summary-sub">В работе: ${rows.length-done}</div></div>
        <div class="summary-card"><h4>Общий прогресс</h4><div class="summary-big">${progress}%</div><div class="mini-progress"><span style="width:${progress}%"></span></div></div>
        <div class="summary-card"><h4>В scope</h4><div class="summary-big">${inScope}</div><div class="summary-sub">из ${rows.length}</div></div>
        <div class="summary-card"><h4>Блокеры / Риски</h4><div class="summary-big">${blockers} / ${risky}</div><div class="summary-sub">Критичный фокус</div></div>
        <div class="summary-card"><h4>Без релиза</h4><div class="summary-big">${noRelease}</div><div class="summary-sub">Нужно назначение</div></div>
        <div class="summary-card"><h4>Овертайм</h4><div class="summary-big">${ot}</div><div class="summary-sub">Нагрузка после релиза</div></div>
      </div>
      <div class="data-table-wrap" style="margin-bottom:12px">
        <div class="data-table-title">Релизы: объём и выполнение</div>
        <table class="data-table" style="width:100%">
          <thead><tr><th>Релиз</th><th>Задач</th><th>Сделано</th><th>Прогресс</th></tr></thead>
          <tbody>
            ${relRows.map(r=>{
              const p=r.total?Math.round(r.done/r.total*100):0;
              return `<tr><td>${r.k}</td><td>${r.total}</td><td>${r.done}</td><td><div class="mini-progress"><span style="width:${p}%"></span></div></td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="insight-list">
        <div class="insight-item"><span>Критические блокеры в ближайших релизах</span><span class="insight-badge high">${rows.filter(r=>r.blockingDependency&&(r.hasRelease120||r.hasRelease121)).length}</span></div>
        <div class="insight-item"><span>В scope, но без релиза</span><span class="insight-badge high">${rows.filter(r=>r.scopeStatus==='Да'&&r.isUnassigned).length}</span></div>
        <div class="insight-item"><span>Сделано без даты</span><span class="insight-badge medium">${rows.filter(r=>r.isDone&&!r.doneDate).length}</span></div>
      </div>
    `;
  },
  renderDetailed(rows,wrap) {
    const teams=Utils.unique(rows.map(r=>r.team));
    const byTeamRows=teams.map(team=>{
      const tr=rows.filter(r=>r.team===team);
      const done=tr.filter(r=>r.isDone).length;
      const blockers=tr.filter(r=>r.blockingDependency).length;
      const risky=tr.filter(r=>r.riskFlags&&r.riskFlags.length).length;
      const progress=tr.length?Math.round(done/tr.length*100):0;
      return {team,total:tr.length,done,blockers,risky,progress};
    }).sort((a,b)=>b.total-a.total);

    const assigneeMap={};
    rows.forEach(r=>{
      SummaryView.splitTags(r.assignee).forEach(name=>{
        if(!assigneeMap[name]) assigneeMap[name]={total:0,ot:0,done:0};
        assigneeMap[name].total++;
        if (r.hasOvertime) assigneeMap[name].ot++;
        if (r.isDone) assigneeMap[name].done++;
      });
    });
    const assigneeRows=Object.entries(assigneeMap)
      .map(([name,v])=>({name,...v,progress:v.total?Math.round(v.done/v.total*100):0}))
      .sort((a,b)=>b.total-a.total);

    const roleMap={};
    rows.forEach(r=>{
      SummaryView.splitTags(r.role).forEach(role=>{
        if(!roleMap[role]) roleMap[role]=0;
        roleMap[role]++;
      });
    });
    const roleRows=Object.entries(roleMap).sort((a,b)=>b[1]-a[1]);

    wrap.innerHTML=`
      <div class="data-table-wrap" style="margin-bottom:12px">
        <div class="data-table-title">Команды: объём, прогресс, риски</div>
        <div style="overflow:auto">
          <table class="data-table" style="width:100%">
            <thead><tr><th>Команда</th><th>Задач</th><th>Сделано</th><th>Блокеры</th><th>Риски</th><th>Прогресс</th></tr></thead>
            <tbody>
              ${byTeamRows.map(r=>`<tr>
                <td>${Utils.escapeHtml(r.team||'—')}</td><td>${r.total}</td><td>${r.done}</td><td>${r.blockers}</td><td>${r.risky}</td>
                <td><div class="mini-progress"><span style="width:${r.progress}%"></span></div></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="summary-grid" style="margin-bottom:12px">
        <div class="summary-card">
          <h4>Роли (топ)</h4>
          ${roleRows.slice(0,12).map(([role,count])=>`<div class="insight-item"><span>${Utils.escapeHtml(role)}</span><span>${count}</span></div>`).join('')||'<div class="text-muted text-sm">Нет данных</div>'}
        </div>
        <div class="summary-card">
          <h4>Исполнители (топ)</h4>
          ${assigneeRows.slice(0,12).map(a=>`<div class="insight-item"><span>${Utils.escapeHtml(a.name)}<span class="text-muted"> • OT:${a.ot}</span></span><span>${a.total}</span></div>`).join('')||'<div class="text-muted text-sm">Нет данных</div>'}
        </div>
      </div>
      <div class="data-table-wrap">
        <div class="data-table-title">Исполнители: нагрузка и выполнение</div>
        <div style="overflow:auto">
          <table class="data-table" style="width:100%">
            <thead><tr><th>Исполнитель</th><th>Задач</th><th>OT</th><th>Сделано</th><th>Прогресс</th></tr></thead>
            <tbody>
              ${assigneeRows.map(a=>`<tr><td>${Utils.escapeHtml(a.name)}</td><td>${a.total}</td><td>${a.ot}</td><td>${a.done}</td><td><div class="mini-progress"><span style="width:${a.progress}%"></span></div></td></tr>`).join('')||'<tr><td colspan="5">Нет данных</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },
  renderBeautiful(rows,wrap) {
    const done=rows.filter(r=>r.isDone).length;
    const progress=rows.length?Math.round(done/rows.length*100):0;
    const blockers=rows.filter(r=>r.blockingDependency).length;
    const risky=rows.filter(r=>r.riskFlags&&r.riskFlags.length).length;
    const noRelease=rows.filter(r=>r.isUnassigned).length;
    const inScope=rows.filter(r=>r.scopeStatus==='Да').length;
    const relStats=[
      {label:'1.20',color:'#4f46e5',count:rows.filter(r=>r.hasRelease120).length},
      {label:'1.21',color:'#059669',count:rows.filter(r=>r.hasRelease121).length},
      {label:'1.22',color:'#d97706',count:rows.filter(r=>r.hasRelease122).length},
      {label:'OT',color:'#dc2626',count:rows.filter(r=>r.hasOvertime).length},
      {label:'Без релиза',color:'#64748b',count:noRelease},
    ];
    const relTotal=relStats.reduce((a,b)=>a+b.count,0)||1;
    let cum=0;
    const pieStops=relStats.map(item=>{
      const start=(cum/relTotal*360).toFixed(2);
      cum+=item.count;
      const end=(cum/relTotal*360).toFixed(2);
      return `${item.color} ${start}deg ${end}deg`;
    }).join(', ');

    const byTeam=Utils.unique(rows.map(r=>r.team)).map(team=>{
      const tr=rows.filter(r=>r.team===team);
      const td=tr.filter(r=>r.isDone).length;
      return {team,total:tr.length,done:td,p:tr.length?Math.round(td/tr.length*100):0};
    }).sort((a,b)=>b.total-a.total).slice(0,8);

    wrap.innerHTML=`
      <div class="summary-beautiful">
        <div class="summary-hero">
          <div class="summary-hero-title">CEO Control Room</div>
          <div class="summary-hero-sub">Ключевая картина релизов, рисков и выполнения в одном экране</div>
          <div class="summary-hero-grid">
            <div class="summary-hero-kpi"><div class="k">Всего задач</div><div class="v">${rows.length}</div></div>
            <div class="summary-hero-kpi"><div class="k">Выполнено</div><div class="v">${done}</div></div>
            <div class="summary-hero-kpi"><div class="k">Общий прогресс</div><div class="v">${progress}%</div></div>
            <div class="summary-hero-kpi"><div class="k">Блокеры</div><div class="v">${blockers}</div></div>
            <div class="summary-hero-kpi"><div class="k">Риски</div><div class="v">${risky}</div></div>
            <div class="summary-hero-kpi"><div class="k">В scope</div><div class="v">${inScope}</div></div>
          </div>
        </div>
        <div class="beaut-grid">
          <div class="beaut-card">
            <div class="beaut-title">Прогресс по ключевым командам</div>
            <div class="beaut-bars">
              ${byTeam.map(t=>`<div class="beaut-bar-row">
                <div>${Utils.escapeHtml(Utils.truncate(t.team||'—',16))}</div>
                <div class="beaut-bar-track"><span class="beaut-bar-fill" style="width:${t.p}%;background:${t.p>=75?'#059669':t.p>=45?'#d97706':'#dc2626'}"></span></div>
                <div>${t.p}%</div>
              </div>`).join('')}
            </div>
          </div>
          <div class="beaut-card">
            <div class="beaut-title">Распределение объёма по релизам</div>
            <div class="beaut-pie" style="background:conic-gradient(${pieStops})"></div>
            <div class="beaut-legend">
              ${relStats.map(i=>`<span class="beaut-pill"><span class="beaut-dot" style="background:${i.color}"></span>${i.label}: ${i.count}</span>`).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  },
  renderSuperBeautiful(rows,wrap) {
    const done=rows.filter(r=>r.isDone).length;
    const total=rows.length;
    const progress=total?Math.round(done/total*100):0;
    const blockers=rows.filter(r=>r.blockingDependency).length;
    const risky=rows.filter(r=>r.riskFlags&&r.riskFlags.length).length;
    const ot=rows.filter(r=>r.hasOvertime).length;
    const noRelease=rows.filter(r=>r.isUnassigned).length;
    const inScope=rows.filter(r=>r.scopeStatus==='Да').length;

    const relStats=[
      {label:'1.20',key:'hasRelease120',color:'#6366f1'},
      {label:'1.21',key:'hasRelease121',color:'#14b8a6'},
      {label:'1.22',key:'hasRelease122',color:'#f59e0b'},
      {label:'OT',key:'hasOvertime',color:'#ef4444'},
      {label:'Без релиза',key:'isUnassigned',color:'#64748b'},
    ].map(x=>({...x,count:rows.filter(r=>!!r[x.key]).length}));
    const relTotal=Math.max(1,relStats.reduce((sum,x)=>sum+x.count,0));
    let acc=0;
    const pieStops=relStats.map(item=>{
      const a=(acc/relTotal*360).toFixed(2);
      acc+=item.count;
      const b=(acc/relTotal*360).toFixed(2);
      return `${item.color} ${a}deg ${b}deg`;
    }).join(', ');

    const teams=Utils.unique(rows.map(r=>r.team)).map(team=>{
      const tr=rows.filter(r=>r.team===team);
      const doneCount=tr.filter(r=>r.isDone).length;
      const p=tr.length?Math.round(doneCount/tr.length*100):0;
      return {team,total:tr.length,p};
    }).sort((a,b)=>b.total-a.total).slice(0,10);

    const topAssignees={};
    rows.forEach(r=>{
      SummaryView.splitTags(r.assignee).forEach(name=>{
        if(!topAssignees[name]) topAssignees[name]={name,total:0,done:0};
        topAssignees[name].total++;
        if(r.isDone) topAssignees[name].done++;
      });
    });
    const leaders=Object.values(topAssignees)
      .map(a=>({...a,p:a.total?Math.round(a.done/a.total*100):0}))
      .sort((a,b)=>b.total-a.total)
      .slice(0,8);

    wrap.innerHTML=`
      <div class="summary-super">
        <div class="summary-super-hero">
          <div class="summary-super-glow summary-super-glow-a"></div>
          <div class="summary-super-glow summary-super-glow-b"></div>
          <div class="summary-super-title">СБОФ Executive Pulse</div>
          <div class="summary-super-sub">Моментальный снимок статуса релизов, рисков и загрузки команд</div>
          <div class="summary-super-kpis">
            <div class="summary-super-kpi"><span>Всего задач</span><strong>${total}</strong></div>
            <div class="summary-super-kpi"><span>Выполнено</span><strong>${done}</strong></div>
            <div class="summary-super-kpi"><span>Прогресс</span><strong>${progress}%</strong></div>
            <div class="summary-super-kpi"><span>Блокеры</span><strong>${blockers}</strong></div>
            <div class="summary-super-kpi"><span>Риски</span><strong>${risky}</strong></div>
            <div class="summary-super-kpi"><span>Овертайм</span><strong>${ot}</strong></div>
          </div>
        </div>

        <div class="summary-super-grid">
          <div class="summary-super-card">
            <div class="summary-super-card-title">Прогресс по командам</div>
            <div class="summary-super-bars">
              ${teams.map((t,i)=>`<div class="summary-super-bar-row">
                <div class="summary-super-bar-label">${Utils.escapeHtml(Utils.truncate(t.team||'—',20))}</div>
                <div class="summary-super-bar-track"><span class="summary-super-bar-fill" style="--p:${t.p};--d:${i*70}ms"></span></div>
                <div class="summary-super-bar-value">${t.p}%</div>
              </div>`).join('')}
            </div>
          </div>

          <div class="summary-super-card">
            <div class="summary-super-card-title">Распределение объема</div>
            <div class="summary-super-pie-wrap">
              <div class="summary-super-pie" style="background:conic-gradient(${pieStops})"></div>
            </div>
            <div class="summary-super-legend">
              ${relStats.map(i=>`<span class="summary-super-pill"><i style="background:${i.color}"></i>${i.label}: ${i.count}</span>`).join('')}
            </div>
          </div>
        </div>

        <div class="summary-super-grid">
          <div class="summary-super-card">
            <div class="summary-super-card-title">Критичный фокус</div>
            <div class="summary-super-metrics">
              <div class="summary-super-metric"><span>В scope без релиза</span><strong>${rows.filter(r=>r.scopeStatus==='Да'&&r.isUnassigned).length}</strong></div>
              <div class="summary-super-metric"><span>Сделано без даты</span><strong>${rows.filter(r=>r.isDone&&!r.doneDate).length}</strong></div>
              <div class="summary-super-metric"><span>Овертайм без периода</span><strong>${rows.filter(r=>r.hasOvertime&&(!r.workPeriodStart||!r.workPeriodEnd)).length}</strong></div>
              <div class="summary-super-metric"><span>В scope</span><strong>${inScope}</strong></div>
              <div class="summary-super-metric"><span>Без релиза</span><strong>${noRelease}</strong></div>
            </div>
          </div>

          <div class="summary-super-card">
            <div class="summary-super-card-title">Лидеры загрузки</div>
            <div class="summary-super-people">
              ${leaders.length?leaders.map((a,i)=>`<div class="summary-super-person" style="--d:${i*70}ms">
                <div class="summary-super-person-name">${Utils.escapeHtml(Utils.truncate(a.name,24))}</div>
                <div class="summary-super-person-meta">${a.total} задач • ${a.p}% done</div>
              </div>`).join(''):'<div class="text-muted text-sm">Нет данных по исполнителям</div>'}
            </div>
          </div>
        </div>
      </div>
    `;
  },
};

// ============================================================
// METRICS VIEW
// ============================================================
export const MetricsView = {
  splitTags(v) { return String(v||'').split(/[|,]/).map(s=>s.trim()).filter(Boolean); },
  render() {
    const rows=FilterEngine.getFiltered();
    const wrap=document.getElementById('metrics-wrap');
    if (!wrap) return;
    if (!rows.length) {
      wrap.innerHTML='<div class="empty-state"><div class="empty-icon">📉</div><div class="empty-title">Нет данных для метрик</div></div>';
      return;
    }

    const done=rows.filter(r=>r.isDone).length;
    const blockers=rows.filter(r=>r.blockingDependency).length;
    const risky=rows.filter(r=>r.riskFlags&&r.riskFlags.length).length;
    const overtime=rows.filter(r=>r.hasOvertime).length;
    const inScope=rows.filter(r=>r.scopeStatus==='Да').length;
    const progress=rows.length?Math.round(done/rows.length*100):0;

    const releases=[
      {k:'1.20', has:'hasRelease120', c:'#6366f1'},
      {k:'1.21', has:'hasRelease121', c:'#14b8a6'},
      {k:'1.22', has:'hasRelease122', c:'#f59e0b'},
      {k:'OT', has:'hasOvertime', c:'#ef4444'},
      {k:'Без релиза', has:'isUnassigned', c:'#64748b'},
    ].map(x=>{
      const rr=rows.filter(r=>!!r[x.has]);
      const doneCount=rr.filter(r=>r.isDone).length;
      const riskyCount=rr.filter(r=>r.riskFlags&&r.riskFlags.length).length;
      const p=rr.length?Math.round(doneCount/rr.length*100):0;
      return {...x,total:rr.length,done:doneCount,risky:riskyCount,p};
    });

    const relTotal=Math.max(1,releases.reduce((s,r)=>s+r.total,0));
    let acc=0;
    const pieStops=releases.map(r=>{
      const s=(acc/relTotal*360).toFixed(2);
      acc+=r.total;
      const e=(acc/relTotal*360).toFixed(2);
      return `${r.c} ${s}deg ${e}deg`;
    }).join(', ');

    const teams=Utils.unique(rows.map(r=>r.team)).map(team=>{
      const tr=rows.filter(r=>r.team===team);
      const td=tr.filter(r=>r.isDone).length;
      const rb=tr.filter(r=>r.blockingDependency).length;
      const rs=tr.filter(r=>r.riskFlags&&r.riskFlags.length).length;
      return {team,total:tr.length,done:td,blockers:rb,risky:rs,p:tr.length?Math.round(td/tr.length*100):0};
    }).sort((a,b)=>b.total-a.total).slice(0,10);

    const rolesMap={};
    rows.forEach(r=>MetricsView.splitTags(r.role).forEach(role=>{
      if(!rolesMap[role]) rolesMap[role]={total:0,done:0};
      rolesMap[role].total++;
      if(r.isDone) rolesMap[role].done++;
    }));
    const roles=Object.entries(rolesMap).map(([role,v])=>({
      role,total:v.total,done:v.done,p:v.total?Math.round(v.done/v.total*100):0,
    })).sort((a,b)=>b.total-a.total).slice(0,8);

    const assigneeMap={};
    rows.forEach(r=>MetricsView.splitTags(r.assignee).forEach(name=>{
      if(!assigneeMap[name]) assigneeMap[name]={total:0,done:0,ot:0,risky:0};
      assigneeMap[name].total++;
      if(r.isDone) assigneeMap[name].done++;
      if(r.hasOvertime) assigneeMap[name].ot++;
      if(r.riskFlags&&r.riskFlags.length) assigneeMap[name].risky++;
    }));
    const assignees=Object.entries(assigneeMap).map(([name,v])=>({
      name,...v,p:v.total?Math.round(v.done/v.total*100):0,
    })).sort((a,b)=>b.total-a.total).slice(0,12);

    const parseDate=(v)=>{ if(!v) return null; const d=new Date(v); return Number.isNaN(d.getTime())?null:d; };
    const releaseEnd=(row)=>{
      if(row.hasRelease120) return new Date(GANTT_RELEASE_BOUNDS.r120[1]);
      if(row.hasRelease121) return new Date(GANTT_RELEASE_BOUNDS.r121[1]);
      if(row.hasRelease122) return new Date(GANTT_RELEASE_BOUNDS.r122[1]);
      return null;
    };
    const plannedDate=(r)=>parseDate(r.workPeriodEnd)||releaseEnd(r)||parseDate(r.workPeriodStart);
    const doneWithPlan=rows.filter(r=>r.isDone&&parseDate(r.doneDate)&&plannedDate(r));
    const onTimeDone=doneWithPlan.filter(r=>parseDate(r.doneDate)<=plannedDate(r)).length;
    const lateDone=Math.max(0,doneWithPlan.length-onTimeDone);
    const doneNoDate=rows.filter(r=>r.isDone&&!r.doneDate).length;
    const slaPct=doneWithPlan.length?Math.round(onTimeDone/doneWithPlan.length*100):0;

    const scopeMix=[
      {k:'Да',c:'#22c55e',n:rows.filter(r=>r.scopeStatus==='Да').length},
      {k:'Нет',c:'#94a3b8',n:rows.filter(r=>r.scopeStatus==='Нет').length},
      {k:'Треб. подтв.',c:'#f59e0b',n:rows.filter(r=>r.scopeStatus==='Требует подтверждения').length},
    ];
    const scopeTotal=Math.max(1,scopeMix.reduce((s,x)=>s+x.n,0));

    const qualitySignals=[
      {label:'Done без даты', value:doneNoDate, severity:doneNoDate>0?'high':'low'},
      {label:'OT без периода', value:rows.filter(r=>r.hasOvertime&&(!r.workPeriodStart||!r.workPeriodEnd)).length, severity:'high'},
      {label:'Без исполнителя', value:rows.filter(r=>!MetricsView.splitTags(r.assignee).length).length, severity:'medium'},
      {label:'Без категории', value:rows.filter(r=>!MetricsView.splitTags(r.category).length).length, severity:'medium'},
      {label:'В scope без релиза', value:rows.filter(r=>r.scopeStatus==='Да'&&r.isUnassigned).length, severity:'high'},
    ];

    const depByTeam=teams.map(t=>({
      ...t,
      pressure:t.total?Math.round((t.blockers+t.risky)/t.total*100):0,
    })).sort((a,b)=>b.pressure-a.pressure).slice(0,8);

    const typeMap={};
    const gather=(arr)=>arr.forEach(w=>{
      const key=String(w||'').trim();
      if(!key) return;
      if(!typeMap[key]) typeMap[key]=0;
      typeMap[key]+=1;
    });
    rows.forEach(r=>{
      gather(Array.isArray(r.release120Types)?r.release120Types:[]);
      gather(Array.isArray(r.release121Types)?r.release121Types:[]);
      gather(Array.isArray(r.release122Types)?r.release122Types:[]);
      gather(Array.isArray(r.overtimeTypes)?r.overtimeTypes:[]);
    });
    const wtEmoji=(wt)=>{
      const x=String(wt||'').trim().toLowerCase();
      if (x.includes('бизнес аналит')) return '📈';
      if (x.includes('аналит')) return '📊';
      if (x.includes('backend') || x.includes('бэкенд') || x.includes('разработ')) return '💻';
      if (x.includes('frontend') || x.includes('фронт')) return '🖥️';
      if (x.includes('qa') || x.includes('тест')) return '🧪';
      if (x.includes('внедр')) return '🚀';
      if (x.includes('миграц')) return '🗃️';
      if (x.includes('стабилиз')) return '🧯';
      if (x.includes('хотфикс') || x.includes('hotfix')) return '🚑';
      if (x.includes('интеграц')) return '🔌';
      if (x.includes('документ')) return '📝';
      return '🧩';
    };
    const typeTotal=Math.max(1,Object.values(typeMap).reduce((s,x)=>s+x,0));
    const typePortfolio=Object.entries(typeMap).map(([type,count])=>({
      type,count,p:Math.round(count/typeTotal*100),
    })).sort((a,b)=>b.count-a.count).slice(0,8);

    const loadTotals=assignees.map(a=>a.total);
    const topLoad=loadTotals.length?Math.max(...loadTotals):0;
    const loadConcentration=rows.length?Math.round(topLoad/rows.length*100):0;
    const evenness=loadTotals.length>1
      ? Math.round((1-(Math.max(...loadTotals)-Math.min(...loadTotals))/Math.max(1,Math.max(...loadTotals)))*100)
      : 100;
    const riskLoad=rows.length?Math.round(risky/rows.length*100):0;
    const blockerLoad=rows.length?Math.round(blockers/rows.length*100):0;

    const releaseHealth=releases.map(r=>{
      const riskPct=r.total?Math.round(r.risky/r.total*100):0;
      const score=Math.max(0,Math.min(100,Math.round(r.p*0.7 + (100-riskPct)*0.3)));
      return {...r,riskPct,score};
    }).sort((a,b)=>b.score-a.score);

    const last14=[];
    const now=new Date();
    const dayKey=(d)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    for(let i=13;i>=0;i--){
      const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()-i);
      last14.push({k:dayKey(d),label:`${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`,v:0});
    }
    const idxMap={}; last14.forEach((x,i)=>{ idxMap[x.k]=i; });
    rows.forEach(r=>{
      if(!r.isDone||!r.doneDate) return;
      const d=parseDate(r.doneDate);
      if(!d) return;
      const k=dayKey(new Date(d.getFullYear(),d.getMonth(),d.getDate()));
      if (Object.prototype.hasOwnProperty.call(idxMap,k)) last14[idxMap[k]].v += 1;
    });
    const sparkW=440,sparkH=120,sparkPad=16;
    const sparkMax=Math.max(1,...last14.map(x=>x.v));
    const sx=i=>sparkPad + ((sparkW-sparkPad*2)*(last14.length===1?0:i/(last14.length-1)));
    const sy=v=>sparkH-sparkPad-((sparkH-sparkPad*2)*(v/sparkMax));
    const sparkPath=last14.map((p,i)=>`${i?'L':'M'}${sx(i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(' ');
    const sparkArea=`${sparkPath} L${sx(last14.length-1).toFixed(1)},${sparkH-sparkPad} L${sx(0).toFixed(1)},${sparkH-sparkPad} Z`;

    const opsSignals=[
      {label:'В scope без релиза', value:rows.filter(r=>r.scopeStatus==='Да'&&r.isUnassigned).length, severity:'high'},
      {label:'Сделано без даты', value:rows.filter(r=>r.isDone&&!r.doneDate).length, severity:'medium'},
      {label:'Овертайм без периода', value:rows.filter(r=>r.hasOvertime&&(!r.workPeriodStart||!r.workPeriodEnd)).length, severity:'high'},
      {label:'Задач без исполнителя', value:rows.filter(r=>!MetricsView.splitTags(r.assignee).length).length, severity:'medium'},
      {label:'Блокеров в ближайших релизах', value:rows.filter(r=>r.blockingDependency&&(r.hasRelease120||r.hasRelease121)).length, severity:'high'},
      {label:'Покрытие done', value:`${progress}%`, severity:'low'},
    ];

    wrap.innerHTML=`
      <div class="metrics-room">
        <div class="metrics-hero">
          <div class="summary-super-glow summary-super-glow-a"></div>
          <div class="summary-super-glow summary-super-glow-b"></div>
          <div class="metrics-hero-title">Metrics Command Center</div>
          <div class="metrics-hero-sub">Комплексная панель исполнения, рисков, прогресса и нагрузки</div>
          <div class="metrics-kpis">
            <div class="metrics-kpi"><span>Всего задач</span><strong>${rows.length}</strong></div>
            <div class="metrics-kpi"><span>Сделано</span><strong>${done}</strong></div>
            <div class="metrics-kpi"><span>Прогресс</span><strong>${progress}%</strong></div>
            <div class="metrics-kpi"><span>Блокеры</span><strong>${blockers}</strong></div>
            <div class="metrics-kpi"><span>Риски</span><strong>${risky}</strong></div>
            <div class="metrics-kpi"><span>Овертайм</span><strong>${overtime}</strong></div>
            <div class="metrics-kpi"><span>В scope</span><strong>${inScope}</strong></div>
          </div>
        </div>

        <div class="metrics-grid metrics-grid-2">
          <div class="metrics-card">
            <div class="metrics-card-title">Распределение объёма</div>
            <div class="summary-super-pie-wrap">
              <div class="summary-super-pie" style="background:conic-gradient(${pieStops})"></div>
            </div>
            <div class="summary-super-legend">
              ${releases.map(r=>`<span class="summary-super-pill"><i style="background:${r.c}"></i>${r.k}: ${r.total}</span>`).join('')}
            </div>
          </div>

          <div class="metrics-card">
            <div class="metrics-card-title">SLA сроков: done вовремя</div>
            <div class="metrics-sla">
              <div class="metrics-sla-main">${slaPct}%</div>
              <div class="mini-progress"><span style="width:${slaPct}%"></span></div>
              <div class="metrics-sla-meta">Вовремя: ${onTimeDone} · С опозданием: ${lateDone} · Без даты done: ${doneNoDate}</div>
            </div>
          </div>
        </div>

        <div class="metrics-grid metrics-grid-3">
          <div class="metrics-card">
            <div class="metrics-card-title">Команды: прогресс и риски</div>
            <div class="metrics-rows">
              ${teams.map((t,i)=>`<div class="metrics-row">
                <div class="metrics-row-label">${Utils.escapeHtml(Utils.truncate(t.team||'—',18))}</div>
                <div class="metrics-row-track"><span class="metrics-row-fill" style="--p:${t.p};--d:${i*55}ms"></span></div>
                <div class="metrics-row-meta">${t.p}% · ${t.blockers}/${t.risky}</div>
              </div>`).join('')}
            </div>
          </div>

          <div class="metrics-card">
            <div class="metrics-card-title">Роли: загрузка</div>
            <div class="metrics-rows">
              ${roles.length?roles.map((r,i)=>`<div class="metrics-row">
                <div class="metrics-row-label">${Utils.escapeHtml(Utils.truncate(r.role,18))}</div>
                <div class="metrics-row-track"><span class="metrics-row-fill role" style="--p:${Math.max(8,Math.round(r.total/rows.length*100))};--d:${i*55}ms"></span></div>
                <div class="metrics-row-meta">${r.total}</div>
              </div>`).join(''):'<div class="text-muted text-sm">Нет данных</div>'}
            </div>
          </div>

          <div class="metrics-card">
            <div class="metrics-card-title">Операционные сигналы</div>
            <div class="metrics-signals">
              ${opsSignals.map(s=>`<div class="metrics-signal ${s.severity}">
                <span>${Utils.escapeHtml(s.label)}</span>
                <strong>${s.value}</strong>
              </div>`).join('')}
            </div>
          </div>
        </div>

        <div class="metrics-grid metrics-grid-3">
          <div class="metrics-card">
            <div class="metrics-card-title">Scope mix</div>
            <div class="metrics-stack">
              <div class="metrics-stack-track">
                ${scopeMix.map(s=>`<span class="metrics-stack-seg" style="width:${Math.round(s.n/scopeTotal*100)}%;background:${s.c}" title="${Utils.escapeHtml(s.k)}: ${s.n}"></span>`).join('')}
              </div>
              <div class="summary-super-legend">
                ${scopeMix.map(s=>`<span class="summary-super-pill"><i style="background:${s.c}"></i>${s.k}: ${s.n}</span>`).join('')}
              </div>
            </div>
          </div>

          <div class="metrics-card">
            <div class="metrics-card-title">Нагрузка по типам работ</div>
            <div class="metrics-rows">
              ${typePortfolio.length?typePortfolio.map((t,i)=>`<div class="metrics-row">
                <div class="metrics-row-label">${wtEmoji(t.type)} ${Utils.escapeHtml(Utils.truncate(t.type,18))}</div>
                <div class="metrics-row-track"><span class="metrics-row-fill role" style="--p:${Math.max(8,t.p)};--d:${i*45}ms"></span></div>
                <div class="metrics-row-meta">${t.count}</div>
              </div>`).join(''):'<div class="text-muted text-sm">Нет данных по типам работ</div>'}
            </div>
          </div>

          <div class="metrics-card">
            <div class="metrics-card-title">Dependency pressure по командам</div>
            <div class="metrics-rows">
              ${depByTeam.length?depByTeam.map((t,i)=>`<div class="metrics-row">
                <div class="metrics-row-label">${Utils.escapeHtml(Utils.truncate(t.team||'—',18))}</div>
                <div class="metrics-row-track"><span class="metrics-row-fill" style="--p:${Math.max(6,t.pressure)};--d:${i*45}ms"></span></div>
                <div class="metrics-row-meta">${t.pressure}%</div>
              </div>`).join(''):'<div class="text-muted text-sm">Нет данных по командам</div>'}
            </div>
          </div>
        </div>

        <div class="metrics-grid metrics-grid-2">
          <div class="metrics-card">
            <div class="metrics-card-title">Исполнители: загрузка / done / overtime</div>
            <div class="metrics-people">
              ${assignees.length?assignees.map((a,i)=>`<div class="metrics-person" style="--d:${i*35}ms">
                <div class="metrics-person-name">${Utils.escapeHtml(Utils.truncate(a.name,24))}</div>
                <div class="metrics-person-meta">${a.total} задач · done ${a.p}% · OT ${a.ot} · риск ${a.risky}</div>
              </div>`).join(''):'<div class="text-muted text-sm">Нет данных по исполнителям</div>'}
            </div>
          </div>

          <div class="metrics-card">
            <div class="metrics-card-title">Баланс нагрузки команды</div>
            <div class="metrics-signals">
              <div class="metrics-signal ${loadConcentration>=25?'high':loadConcentration>=18?'medium':'low'}">
                <span>Концентрация нагрузки (топ-исполнитель)</span>
                <strong>${loadConcentration}%</strong>
              </div>
              <div class="metrics-signal ${evenness<55?'high':evenness<75?'medium':'low'}">
                <span>Равномерность распределения</span>
                <strong>${evenness}%</strong>
              </div>
              ${qualitySignals.map(s=>`<div class="metrics-signal ${s.severity}">
                <span>${Utils.escapeHtml(s.label)}</span>
                <strong>${s.value}</strong>
              </div>`).join('')}
            </div>
          </div>
        </div>

        <div class="metrics-grid metrics-grid-3">
          <div class="metrics-card">
            <div class="metrics-card-title">Индекс здоровья релизов</div>
            <div class="metrics-rows">
              ${releaseHealth.map((r,i)=>`<div class="metrics-row">
                <div class="metrics-row-label">${Utils.escapeHtml(r.k)}</div>
                <div class="metrics-row-track"><span class="metrics-row-fill" style="--p:${Math.max(6,r.score)};--d:${i*40}ms"></span></div>
                <div class="metrics-row-meta">${r.score}</div>
              </div>`).join('')}
            </div>
          </div>

          <div class="metrics-card">
            <div class="metrics-card-title">Control ring</div>
            <div class="metrics-control-ring-wrap">
              <div class="metrics-control-ring" style="background:conic-gradient(#6366f1 0 ${progress}%, #ef4444 ${progress}% ${Math.min(100,progress+riskLoad)}%, #f59e0b ${Math.min(100,progress+riskLoad)}% ${Math.min(100,progress+riskLoad+blockerLoad)}%, #1f2a44 ${Math.min(100,progress+riskLoad+blockerLoad)}% 100%)">
                <div class="metrics-control-ring-inner">
                  <strong>${Math.max(0,100-riskLoad-blockerLoad)}%</strong>
                  <span>операц. запас</span>
                </div>
              </div>
            </div>
            <div class="summary-super-legend">
              <span class="summary-super-pill"><i style="background:#6366f1"></i>Прогресс ${progress}%</span>
              <span class="summary-super-pill"><i style="background:#ef4444"></i>Риски ${riskLoad}%</span>
              <span class="summary-super-pill"><i style="background:#f59e0b"></i>Блокеры ${blockerLoad}%</span>
            </div>
          </div>

          <div class="metrics-card">
            <div class="metrics-card-title">Тренд done за 14 дней</div>
            <div class="metrics-spark-wrap">
              <svg viewBox="0 0 ${sparkW} ${sparkH}" class="metrics-spark-svg">
                <path d="${sparkArea}" fill="rgba(99,102,241,.14)"></path>
                <path d="${sparkPath}" fill="none" stroke="#818cf8" stroke-width="2.8" stroke-linecap="round"></path>
                ${last14.map((p,i)=>`<circle cx="${sx(i).toFixed(1)}" cy="${sy(p.v).toFixed(1)}" r="2.6" fill="#a5b4fc"></circle>`).join('')}
              </svg>
              <div class="metrics-spark-foot">
                <span>${last14[0].label}</span>
                <strong>${last14.reduce((s,x)=>s+x.v,0)} done</strong>
                <span>${last14[last14.length-1].label}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },
};

// ============================================================
// INSIGHTS VIEW
// ============================================================
export const InsightsView = {
  split(v) { return String(v||'').split(/[|,]/).map(s=>s.trim()).filter(Boolean); },
  render() {
    const rows=FilterEngine.getFiltered();
    const wrap=document.getElementById('insights-wrap');
    if (!rows.length) {
      wrap.innerHTML='<div class="empty-state"><div class="empty-icon">💡</div><div class="empty-title">Недостаточно данных для инсайтов</div></div>';
      return;
    }

    const bySeverity={high:[],medium:[],low:[]};
    const push=(severity,text,value)=>bySeverity[severity].push({text,value});

    const blockersNear=rows.filter(r=>r.blockingDependency&&(r.hasRelease120||r.hasRelease121)).length;
    push('high','Блокеры в ближайших релизах',blockersNear);
    push('high','В scope без релиза',rows.filter(r=>r.scopeStatus==='Да'&&r.isUnassigned).length);
    push('high','Задачи OT без периода работ',rows.filter(r=>r.hasOvertime&&(!r.workPeriodStart||!r.workPeriodEnd)).length);

    const noAssignee=rows.filter(r=>!InsightsView.split(r.assignee).length).length;
    push('medium','Задачи без исполнителя',noAssignee);
    push('medium','Сделанные без даты',rows.filter(r=>r.isDone&&!r.doneDate).length);
    push('medium','Требуют подтверждения и уже в релизе',rows.filter(r=>r.scopeStatus==='Требует подтверждения'&&(r.hasRelease120||r.hasRelease121||r.hasRelease122||r.hasOvertime)).length);

    const assigneeLoad={};
    rows.forEach(r=>InsightsView.split(r.assignee).forEach(name=>{ assigneeLoad[name]=(assigneeLoad[name]||0)+1; }));
    const overloaded=Object.entries(assigneeLoad).filter(([,n])=>n>=6).sort((a,b)=>b[1]-a[1]).slice(0,8);
    push('low','Исполнители с высокой нагрузкой (>=6 задач)',overloaded.length);

    const teamRisk=Utils.unique(rows.map(r=>r.team)).map(team=>{
      const tr=rows.filter(r=>r.team===team);
      const risky=tr.filter(r=>r.riskFlags&&r.riskFlags.length).length;
      return {team,total:tr.length,risky,ratio:tr.length?risky/tr.length:0};
    }).sort((a,b)=>b.ratio-a.ratio);

    const inScopeNoRelease = rows.filter(r=>r.scopeStatus==='Да'&&r.isUnassigned);
    const confirmInRelease = rows.filter(r=>r.scopeStatus==='Требует подтверждения'&&(r.hasRelease120||r.hasRelease121||r.hasRelease122||r.hasOvertime));
    const blockerNear = rows.filter(r=>r.blockingDependency&&(r.hasRelease120||r.hasRelease121));

    // V17.1 H1 — actions раньше уезжали за карточку: всё было в одной flex-row
    //   с title и `margin-left:auto`. На узких экранах title прижимал actions
    //   за правый край контейнера. Теперь title — обычный заголовок,
    //   actions — отдельная row с `flex-wrap: wrap` и без отрицательного
    //   margin'а; кнопки переносятся на новую строку, не уезжают за carrier.
    const renderActionBtn=(label,cls,onclick)=>`<button class="btn btn-sm ${cls} insight-action-btn" data-action="${onclick}">${label}</button>`;

    const renderList=(title,sev,extra='',actionBtn='')=>`
      <div class="insight-list">
        <div class="insight-list-head">
          <div class="data-table-title">${title}</div>
          ${actionBtn ? `<div class="insight-list-actions">${actionBtn}</div>` : ''}
        </div>
        ${bySeverity[sev].map(i=>`<div class="insight-item"><span>${i.text}</span><span class="insight-badge ${sev}">${i.value}</span></div>`).join('')}
        ${extra}
      </div>`;

    const overloadBlock=overloaded.length?`<div style="margin-top:8px">${overloaded.map(([name,count])=>`<div class="insight-item"><span>${Utils.escapeHtml(name)}</span><span>${count}</span></div>`).join('')}</div>`:'<div class="text-muted text-sm">Нет перегруженных исполнителей</div>';
    const teamsBlock=teamRisk.slice(0,8).map(t=>`<div class="insight-item"><span>${Utils.escapeHtml(t.team||'—')}</span><span>${Math.round(t.ratio*100)}%</span></div>`).join('')||'<div class="text-muted text-sm">Нет данных</div>';

    const highActionBtn = inScopeNoRelease.length
      ? renderActionBtn('Назначить в 1.20 →','btn-primary','assign_120')
      : '';
    const medActionBtn = confirmInRelease.length
      ? renderActionBtn('Перевести в "Да" →','btn-outline','confirm_scope')
      : '';
    const blockerActionBtn = blockerNear.length
      ? renderActionBtn('Снять блокеры →','btn-danger','clear_blockers')
      : '';

    wrap.innerHTML=`
      <div class="summary-grid" style="margin-bottom:12px">
        ${renderList('Критические сигналы','high','',highActionBtn+blockerActionBtn)}
        ${renderList('Сигналы внимания','medium','',medActionBtn)}
        ${renderList('Операционные наблюдения','low',overloadBlock)}
      </div>
      <div class="summary-grid">
        <div class="insight-list">
          <div class="data-table-title" style="margin-bottom:6px">Команды с наибольшей долей рисков</div>
          ${teamsBlock}
        </div>
        <div class="insight-list">
          <div class="data-table-title" style="margin-bottom:6px">Ключевые проблемы данных</div>
          <div class="insight-item"><span>Строки без категории</span><span class="insight-badge medium">${rows.filter(r=>!String(r.category||'').trim()).length}</span></div>
          <div class="insight-item"><span>Строки без роли</span><span class="insight-badge medium">${rows.filter(r=>!String(r.role||'').trim()).length}</span></div>
          <div class="insight-item"><span>Строки без эпика</span><span class="insight-badge low">${rows.filter(r=>!String(r.epic||'').trim()).length}</span></div>
          <div class="insight-item"><span>Риски в закрытых задачах</span><span class="insight-badge low">${rows.filter(r=>r.isDone&&r.riskFlags&&r.riskFlags.length).length}</span></div>
        </div>
      </div>
    `;
  },
};

// ============================================================
// DIAGNOSTICS VIEW
// ============================================================
export const DiagnosticsView = {
  render() {
    const d = state.diagnostics;
    const wrap = document.getElementById('diagnostics-wrap');
    if (!wrap) return;
    const general = [
      ['Источник данных', (d.sources || []).join(', ') || '—'],
      ['Всего строк',    d.registryCount    || 0],
      ['Из CSV',         d.csvImportCount   || 0],
      ['Из localStorage',d.localStorageCount || 0],
    ];

    const generalCard = sht`<div class="diag-card">
      <div class="diag-card-header">Общая информация</div>
      <div class="diag-card-body">${general.map(([k, v]) =>
        sht`<div class="diag-row"><span class="diag-key">${k}</span><span class="diag-val">${v}</span></div>`)}</div>
    </div>`;

    const sheetsCard = (d.sheets && d.sheets.length)
      ? sht`<div class="diag-card">
          <div class="diag-card-header">Листы XLSX</div>
          <div class="diag-card-body">${d.sheets.map(s =>
            sht`<div class="diag-row"><span class="diag-key">${s}</span><span class="diag-val">${(d.rowsPerSheet || {})[s] ?? '—'} строк</span></div>`)}</div>
        </div>`
      : sht``;

    const colCards = (d.sheets && d.sheets.length)
      ? d.sheets.map(s => {
          const det = d.detectedColumns ? d.detectedColumns[s] : {};
          const miss = d.missingColumns  ? d.missingColumns[s]  : [];
          const detEntries = Object.entries(det || {});
          const detList = detEntries.length
            ? detEntries.map(([f, i]) => sht`<span class="diag-col-item" title="${i.originalHeader}">${f}[${i.index | 0}]</span>`)
            : sht`—`;
          const missList = (miss && miss.length)
            ? sht`<div style="margin-top:8px"><div class="diag-col-list">${miss.map(f => sht`<span class="diag-col-item diag-col-missing">${f}</span>`)}</div></div>`
            : sht``;
          return sht`<div class="diag-card">
            <div class="diag-card-header">Колонки: ${s}</div>
            <div class="diag-card-body">
              <div class="diag-col-list">${detList}</div>
              ${missList}
            </div>
          </div>`;
        })
      : sht``;

    const warnsCard = (d.warnings && d.warnings.length)
      ? sht`<div class="diag-card">
          <div class="diag-card-header">Предупреждения</div>
          <div class="diag-card-body">${d.warnings.map(w => sht`<div class="diag-warning">${w}</div>`)}</div>
        </div>`
      : sht``;

    safeRender(wrap, sht`${generalCard}${sheetsCard}${colCards}${warnsCard}`);
  },
};
