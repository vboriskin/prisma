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
import { renderPageHeader } from '../app/prizmaUI.js';
import { Services } from '../app/services.js';

export const KanbanView = {
  _drag: { rowId:null, sourceCol:null },
  render() {
    // F10 fix (codebase-01) + sj3 (codebase-05) — отметить рендер для guard'а.
    try { Services.App?.markRenderedNow?.(); } catch (_) {}
    _injectKanbanHeader();
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
      body.addEventListener('dragover',e=>{ e.preventDefault(); body.classList.add('prizma-dragging'); colEl.classList.add('prizma-drop-target'); });
      body.addEventListener('dragleave',()=>{ body.classList.remove('prizma-dragging'); colEl.classList.remove('prizma-drop-target'); });
      body.addEventListener('drop',e=>{
        e.preventDefault(); body.classList.remove('prizma-dragging'); colEl.classList.remove('prizma-drop-target');
        const {rowId,sourceCol}=KanbanView._drag;
        // V21 J #80 — drop в ту же колонку или без rowId — теперь explicit
        // toast вместо silent return (юзер думал «не сработало»).
        if (!rowId) {
          window.showToast?.('Не удалось определить карточку — попробуй ещё раз', 'warning', 1800);
          return;
        }
        if (sourceCol===col.key) {
          window.showToast?.('Карточка уже в этой колонке', 'info', 1500);
          return;
        }
        const row=state.rows.find(r=>r.id===rowId);
        if (!row) {
          window.showToast?.('Карточка не найдена в данных — обнови страницу', 'error', 2400);
          return;
        }
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
        // P11.4 — overdue marker: blockingDependency + blockingDeadline в прошлом.
        // Класс .kanban-card-overdue даёт 3px stripe-left цвета off-course (см. styles.css P11.4).
        let isOverdue=false;
        if (row.blockingDependency && row.blockingDeadline) {
          const dl=new Date(row.blockingDeadline);
          if (!isNaN(dl.getTime()) && dl < new Date()) isOverdue=true;
        }
        if (isOverdue) borderCls+=' kanban-card-overdue';
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
            ${row.blockingDependency?`<span class="chip chip-red" title="Блокирующая зависимость${row.blockingDeadline?' до '+row.blockingDeadline:''}"><span class="signal-dot signal-off-course"></span>${row.blockingDeadline?' до '+row.blockingDeadline:' блок'}</span>`:''}
            ${RH.riskBadges(row.riskFlags)}${RH.doneBadge(row.isDone)}
            ${row.jiraStatus?`<span class="chip chip-blue kanban-int-badge" title="Jira: ${row.jiraStatus}"><span class="signal-dot signal-information"></span> ${row.jiraStatus.slice(0,12)}</span>`:''}
            ${row.prStatus==='merged'?`<span class="chip chip-green kanban-int-badge" title="PR Merged"><span class="signal-dot signal-on-course"></span> Merged</span>`:row.prStatus==='approved'?`<span class="chip chip-teal kanban-int-badge" title="PR Approved"><span class="signal-dot signal-on-course"></span> Approved</span>`:row.prStatus==='open'?`<span class="chip chip-yellow kanban-int-badge" title="PR открыт"><span class="signal-dot signal-drift"></span> PR</span>`:row.jiraKey&&!row.prUrl?`<span class="chip chip-gray kanban-int-badge" title="Нет PR"><span class="signal-dot signal-off-course"></span> no-PR</span>`:''}
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

function _injectKanbanHeader() {
  const section = document.getElementById('section-kanban');
  if (!section) return;
  let host = section.querySelector('#kanban-prizma-header');
  if (!host) {
    host = document.createElement('div');
    host.id = 'kanban-prizma-header';
    section.insertBefore(host, section.firstChild);
  }
  host.innerHTML = renderPageHeader('kanban', { sub: 'WIP-доска: задачи по статусу.' });
}
