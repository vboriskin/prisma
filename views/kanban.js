'use strict';
/* ============================================================
   KANBAN VIEW — v8_0 ES module
   ============================================================ */

import { state } from '../state.js';
import { FilterEngine } from '../filters.js';
import { Utils } from '../utils.js';
import { RowFactory } from '../rowFactory.js';
import { Storage } from '../dataStore.js';
import { RH } from './renderHelpers.js';

export const KanbanView = {
  _drag: { rowId:null, sourceCol:null },
  render() {
    const filtered=FilterEngine.getFiltered();
    const board=document.getElementById('kanban-board');
    const columns=[
      {key:'backlog',  label:'Без релиза', filter:r=>r.isUnassigned,  tfGet:null,          tfSet:null},
      {key:'r120',     label:'Релиз 1.20', filter:r=>r.hasRelease120, tfGet:'release120Types', tfSet:'release120Types'},
      {key:'r121',     label:'Релиз 1.21', filter:r=>r.hasRelease121, tfGet:'release121Types', tfSet:'release121Types'},
      {key:'r122',     label:'Релиз 1.22', filter:r=>r.hasRelease122, tfGet:'release122Types', tfSet:'release122Types'},
      {key:'overtime', label:'Овертайм',   filter:r=>r.hasOvertime,   tfGet:'overtimeTypes',  tfSet:'overtimeTypes'},
    ];

    board.innerHTML='';
    columns.forEach(col=>{
      const colRows=filtered.filter(col.filter);
      const colEl=document.createElement('div'); colEl.className='kanban-col'; colEl.dataset.colKey=col.key;

      colEl.innerHTML=`<div class="kanban-col-header"><span>${col.label}</span><span class="kanban-col-header-badge">${colRows.length}</span></div>`;
      const body=document.createElement('div'); body.className='kanban-col-body';

      // Drop target
      body.addEventListener('dragover',e=>{ e.preventDefault(); body.classList.add('drag-over'); colEl.classList.add('drag-target'); });
      body.addEventListener('dragleave',()=>{ body.classList.remove('drag-over'); colEl.classList.remove('drag-target'); });
      body.addEventListener('drop',e=>{
        e.preventDefault(); body.classList.remove('drag-over'); colEl.classList.remove('drag-target');
        const {rowId,sourceCol}=KanbanView._drag;
        if (!rowId||sourceCol===col.key) return;
        const row=state.rows.find(r=>r.id===rowId); if(!row) return;
        if (col.key==='backlog') {
          // Remove from source release only
          if (sourceCol!=='backlog'&&columns.find(c=>c.key===sourceCol)?.tfSet) {
            row[columns.find(c=>c.key===sourceCol).tfSet]=[];
          }
        } else {
          const targetField=col.tfSet;
          if (sourceCol==='backlog') {
            if (!(row[targetField]||[]).length) row[targetField]=['backend'];
          } else {
            const srcField=columns.find(c=>c.key===sourceCol)?.tfSet;
            const srcTypes=(srcField&&row[srcField])||[];
            row[targetField]=srcTypes.length?[...srcTypes]:['backend'];
            if (srcField) row[srcField]=[];
          }
        }
        row.dirty=true; row.updatedAt=new Date().toISOString();
        RowFactory.updateDerived(row); Storage.save(); KanbanView.render();
      });

      colRows.slice(0,100).forEach((row,ci)=>{
        let borderCls='';
        if(row.blockingDependency)borderCls='card-blocking';
        else if(row.riskFlags&&row.riskFlags.length)borderCls='card-risky';
        if(row.isDone)borderCls+=' card-done';
        const types=(col.tfGet?row[col.tfGet]:[])||[];

        const card=document.createElement('div');
        card.className=`kanban-card ${borderCls}`;
        card.style.setProperty('--i', ci);
        card.draggable=true;
        card.dataset.rowId=row.id;
        card.innerHTML=`
          <div class="kanban-card-team">${row.team}</div>
          <div class="kanban-card-epic">${Utils.truncate(row.epic,40)}</div>
          <div class="kanban-card-task"><div class="tasks-cell">${RH.jiraTagsHtml(row.tasks)}</div></div>
          <div class="kanban-card-meta">
            ${RH.scopeChip(row.scopeStatus)}
            ${types.length?RH.workTypeChips(types):''}
            ${row.role?`<span class="chip chip-indigo">${Utils.truncate(row.role,20)}</span>`:''}
            ${row.blockingDependency?`<span class="chip chip-red">🚧${row.blockingDeadline?' до '+row.blockingDeadline:''}</span>`:''}
            ${RH.riskBadges(row.riskFlags)}${RH.doneBadge(row.isDone)}
            ${row.jiraStatus?`<span class="chip chip-blue kanban-int-badge" title="Jira: ${row.jiraStatus}">🔵 ${row.jiraStatus.slice(0,12)}</span>`:''}
            ${row.prStatus==='merged'?`<span class="chip chip-green kanban-int-badge" title="PR Merged">🟢 Merged</span>`:row.prStatus==='approved'?`<span class="chip chip-teal kanban-int-badge" title="PR Approved">✅ Approved</span>`:row.prStatus==='open'?`<span class="chip chip-yellow kanban-int-badge" title="PR открыт">🟡 PR</span>`:row.jiraKey&&!row.prUrl?`<span class="chip chip-gray kanban-int-badge" title="Нет PR">⚠️</span>`:''}
          </div>`;
        card.addEventListener('dragstart',e=>{
          KanbanView._drag={rowId:row.id,sourceCol:col.key};
          card.classList.add('dragging'); e.dataTransfer.effectAllowed='move';
        });
        card.addEventListener('dragend',()=>card.classList.remove('dragging'));
        body.appendChild(card);
      });
      if (colRows.length>100) { const more=document.createElement('div'); more.style.cssText='padding:8px;font-size:11px;color:var(--text-4)'; more.textContent=`...ещё ${colRows.length-100}`; body.appendChild(more); }
      colEl.appendChild(body); board.appendChild(colEl);
    });
  },
};
