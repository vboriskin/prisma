'use strict';
/* ============================================================
   REGISTRY VIEW — v8_0 ES module
   ============================================================ */

import { state, notify, syncColumnSettings, getAllCols } from '../state.js';
import { FilterEngine } from '../filters.js';
import { Utils, nextId } from '../utils.js';
import { RowFactory } from '../rowFactory.js';
import { Storage } from '../dataStore.js';
import { REGISTRY_COLS, SCOPE_OPTIONS, COL_TYPES } from '../constants.js';
import { RH } from './renderHelpers.js';
import { Multiselect } from '../components/multiselect.js';
import { createTagInput, getUniqueTagValues, getUniqueTextValues, getEmployeeNames } from '../components/tagInput.js';

let _dragColKey = null;

export const RegistryView = {
  render() {
    const filtered=FilterEngine.getFiltered();
    const sorted=RegistryView.applySorting(filtered);
    const table=document.getElementById('registry-table');
    const empty=document.getElementById('registry-empty');
    const badge=document.getElementById('registry-count-badge');
    badge.textContent=`${sorted.length} / ${state.rows.length}`;
    if (!sorted.length) { table.classList.add('hidden'); empty.classList.remove('hidden'); return; }
    table.classList.remove('hidden'); empty.classList.add('hidden');
    RegistryView.renderHeader(); RegistryView.renderBody(sorted);
  },

  applySorting(rows) {
    const {col,dir}=state.sort; if (!col) return rows;
    return [...rows].sort((a,b)=>{
      let va=a[col],vb=b[col];
      if (va==null)va=''; if (vb==null)vb='';
      if (Array.isArray(va))va=va.join(','); if (Array.isArray(vb))vb=vb.join(',');
      const cmp=String(va).localeCompare(String(vb),'ru',{numeric:true});
      return dir==='asc'?cmp:-cmp;
    });
  },

  getVisibleCols() {
    const all=getAllCols();
    const ordered=state.colOrder
      .map(k=>all.find(c=>c.key===k))
      .filter(c=>c && state.colVisibility[c.key]!==false);
    const pinned=ordered.filter(c=>state.pinnedCols.includes(c.key));
    const rest=ordered.filter(c=>!state.pinnedCols.includes(c.key));
    return [...pinned,...rest];
  },

  _pinnedOffsets(visibleCols) {
    const map={};
    let left=36;
    for (const col of visibleCols) {
      if (!state.pinnedCols.includes(col.key)) break;
      map[col.key]=left;
      left+=(state.colWidths[col.key]||col.width||100);
    }
    return map;
  },

  findRowEl(rowId) {
    return document.querySelector(`#registry-tbody tr[data-row-id="${CSS.escape(String(rowId||''))}"]`);
  },

  updateRowVisual(tr,row) {
    if (!tr || !row) return;
    tr.classList.toggle('row-risky', !!(row.riskFlags && row.riskFlags.length));
    tr.classList.toggle('row-done', !!row.isDone);
    if (row.rowColor) {
      const rowBg = state.theme==='dark' ? Utils.hexToRgba(row.rowColor,0.2) : Utils.hexToRgba(row.rowColor,0.16);
      if (rowBg) {
        tr.classList.add('row-colored');
        tr.style.setProperty('--row-color', rowBg);
      }
    } else {
      tr.classList.remove('row-colored');
      tr.style.removeProperty('--row-color');
    }
  },

  updateRowRiskCell(tr,row) {
    if (!tr || !row) return;
    const tds = tr.querySelectorAll('td');
    const rt = tds[tds.length - 2];
    if (rt) rt.innerHTML = RH.riskBadges(row.riskFlags) + RH.doneBadge(row.isDone);
  },

  renderHeader() {
    const thead=document.getElementById('registry-thead');
    const visibleCols=RegistryView.getVisibleCols();
    const offsets=RegistryView._pinnedOffsets(visibleCols);

    const ths=visibleCols.map((col)=>{
      const w=state.colWidths[col.key]||col.width||100;
      const sortCls=state.sort.col===col.key?(state.sort.dir==='asc'?'sort-asc':'sort-desc'):'';
      const isPinned=state.pinnedCols.includes(col.key);
      const stickyAttr=isPinned?'data-sticky="true"':'';
      const stickyLeft=isPinned?`left:${offsets[col.key]}px;`:'';
      const label=state.colLabels[col.key]||col.label;
      return `<th class="${sortCls}" data-sortcol="${col.key}" data-colkey="${col.key}" ${stickyAttr}
        style="min-width:${w}px;width:${w}px;${stickyLeft}" draggable="true">
        ${label}<button class="col-pin-btn ${isPinned?'pinned':''}" data-pinkey="${col.key}" title="${isPinned?'Открепить':'Закрепить'} столбец" aria-label="${isPinned?'Открепить':'Закрепить'} столбец"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg></button><span class="sort-icon"></span>
        <div class="col-resize-handle" data-resizecol="${col.key}"></div>
      </th>`;
    });

    thead.innerHTML=`<tr><th class="th-cb"><input type="checkbox" id="bulk-select-all" title="Выбрать все"></th><th class="th-num">#</th>${ths.join('')}<th style="min-width:60px">Риски</th><th class="th-actions"></th></tr>`;
    const selectAllCb = thead.querySelector('#bulk-select-all');
    if (selectAllCb) {
      selectAllCb.addEventListener('change', () => {
        const tbody = document.getElementById('registry-tbody');
        const rowIds = [...tbody.querySelectorAll('tr[data-row-id]')].map(tr => tr.dataset.rowId);
        if (selectAllCb.checked) {
          rowIds.forEach(id => state.bulkSelected.add(id));
          tbody.querySelectorAll('.bulk-row-cb').forEach(cb => { cb.checked = true; });
          window.BulkEditPanel?.show(); window.BulkEditPanel?.update();
        } else {
          window.BulkEditPanel?.clearAll();
        }
      });
    }

    // Pin toggle
    thead.querySelectorAll('.col-pin-btn').forEach(btn=>{
      btn.addEventListener('click',e=>{
        e.stopPropagation();
        window.HistoryManager?.checkpoint('закрепление столбца');
        const key=btn.dataset.pinkey;
        if (state.pinnedCols.includes(key)) state.pinnedCols=state.pinnedCols.filter(k=>k!==key);
        else state.pinnedCols.push(key);
        Storage.save(); RegistryView.render();
      });
    });

    // Sort click
    thead.querySelectorAll('[data-sortcol]').forEach(th=>{
      th.addEventListener('click',e=>{
        if (e.target.classList.contains('col-resize-handle')) return;
        const col=th.dataset.sortcol;
        state.sort.dir=(state.sort.col===col&&state.sort.dir==='asc')?'desc':'asc';
        state.sort.col=col;
        RegistryView.render();
      });
    });

    // Column DnD reorder
    thead.querySelectorAll('th[data-colkey]').forEach(th=>{
      th.addEventListener('dragstart',e=>{ _dragColKey=th.dataset.colkey; th.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
      th.addEventListener('dragend',()=>{ th.classList.remove('dragging'); thead.querySelectorAll('th').forEach(t=>t.classList.remove('drag-over')); });
      th.addEventListener('dragover',e=>{ e.preventDefault(); th.classList.add('drag-over'); });
      th.addEventListener('dragleave',()=>th.classList.remove('drag-over'));
      th.addEventListener('drop',e=>{
        e.preventDefault(); th.classList.remove('drag-over');
        const target=th.dataset.colkey;
        if (!_dragColKey||_dragColKey===target) return;
        window.HistoryManager?.checkpoint('порядок столбцов');
        const from=state.colOrder.indexOf(_dragColKey), to=state.colOrder.indexOf(target);
        if (from<0||to<0) return;
        state.colOrder.splice(from,1); state.colOrder.splice(to,0,_dragColKey);
        Storage.save(); RegistryView.render();
      });
    });

    // Column resize
    thead.querySelectorAll('.col-resize-handle').forEach(handle=>{
      handle.addEventListener('mousedown',e=>{
        e.preventDefault(); e.stopPropagation();
        window.HistoryManager?.checkpoint('ширина столбца');
        const colKey=handle.dataset.resizecol;
        const th=handle.closest('th');
        const startX=e.clientX, startW=th.offsetWidth;
        handle.classList.add('resizing');
        let active=true;
        function onMove(e2) {
          if (!active) return;
          const w=Math.max(50,startW+e2.clientX-startX);
          state.colWidths[colKey]=w;
          th.style.minWidth=w+'px'; th.style.width=w+'px';
          // Update all cells in this column
          document.querySelectorAll(`td[data-col="${colKey}"]`).forEach(td=>{ td.style.minWidth=w+'px'; td.style.maxWidth=w+'px'; });
        }
        function onUp() {
          if (!active) return;
          active=false;
          handle.classList.remove('resizing');
          document.removeEventListener('mousemove',onMove);
          document.removeEventListener('mouseup',onUp);
          window.removeEventListener('blur',onUp);
          Storage.save();
        }
        document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
        window.addEventListener('blur',onUp);
      });
    });
  },

  renderBody(rows) {
    const tbody=document.getElementById('registry-tbody');
    tbody.querySelectorAll('.ms-container,[data-cleanup]').forEach(c=>{if(c._cleanup)c._cleanup();});
    // also cleanup tag inputs
    tbody.querySelectorAll('.tag-input-wrap').forEach(c=>{if(c._cleanup)c._cleanup();});
    tbody.innerHTML='';
    tbody.classList.remove('rows-animate');
    // Force reflow so re-adding the class re-triggers animation
    void tbody.offsetHeight;
    tbody.classList.add('rows-animate');
    const visibleCols=RegistryView.getVisibleCols();
    const offsets=RegistryView._pinnedOffsets(visibleCols);

    rows.forEach((row,idx)=>{
      const tr=document.createElement('tr'); tr.dataset.rowId=row.id;
      tr.style.setProperty('--i', Math.min(idx, 30));
      RegistryView.updateRowVisual(tr,row);
      tr.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        document.querySelectorAll('#registry-tbody tr.selected-row').forEach(r => r.classList.remove('selected-row'));
        tr.classList.add('selected-row');
        state.lastClickedRowId = row.id;
      });
      tr.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        RegistryView.showContextMenu(e.clientX, e.clientY, row.id);
      });

      const tdCb=document.createElement('td'); tdCb.className='td-cb';
      const cb=document.createElement('input'); cb.type='checkbox'; cb.className='bulk-row-cb';
      cb.checked=state.bulkSelected.has(row.id);
      cb.addEventListener('change',e=>{ e.stopPropagation(); window.BulkEditPanel?.toggle(row.id, cb.checked); });
      tdCb.appendChild(cb); tr.appendChild(tdCb);

      const tdNum=document.createElement('td'); tdNum.className='td-num'; tdNum.textContent=idx+1; tr.appendChild(tdNum);

      visibleCols.forEach((col)=>{
        const td=document.createElement('td');
        td.dataset.col=col.key;
        const w=state.colWidths[col.key]||col.width||100;
        td.style.minWidth=w+'px'; td.style.maxWidth=w+'px';
        if (state.pinnedCols.includes(col.key)) {
          td.setAttribute('data-sticky','true');
          td.style.left=offsets[col.key]+'px';
        }
        RegistryView.renderCell(td,row,col);
        tr.appendChild(td);
      });

      const tdRisk=document.createElement('td');
      tdRisk.innerHTML=RH.riskBadges(row.riskFlags)+RH.doneBadge(row.isDone);
      tr.appendChild(tdRisk);

      const tdAct=document.createElement('td');
      tdAct.className='td-actions';
      const copyBtn=document.createElement('button'); copyBtn.className='row-act-btn row-act-copy'; copyBtn.title='Копировать строку'; copyBtn.innerHTML='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
      copyBtn.addEventListener('click',()=>RegistryView.copyRow(row.id));
      tdAct.appendChild(copyBtn);
      const delBtn=document.createElement('button'); delBtn.className='row-act-btn row-act-del'; delBtn.title='Удалить строку'; delBtn.innerHTML='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
      delBtn.addEventListener('click',()=>RegistryView.deleteRow(row.id));
      tdAct.appendChild(delBtn); tr.appendChild(tdAct);

      tbody.appendChild(tr);
    });
  },

  renderCell(td,row,col) {
    const val=row[col.key];

    if (col.type==='intlink') {
      // Integration link: jiraKey → Jira browse, prUrl/docUrl → direct link
      if (!val) { td.innerHTML='<span class="cell-text" style="pointer-events:none;color:var(--text-4)">—</span>'; return; }
      let href = val;
      // jiraKey: build Jira URL from settings or just show the key
      if (col.key==='jiraKey') {
        try {
          const cfg = JSON.parse(localStorage.getItem('q2_integrations_v1')||'{}');
          const base = (cfg.jiraBaseUrl||'').replace(/\/+$/,'');
          href = base ? `${base}/browse/${val}` : null;
        } catch(_) { href = null; }
        if (href) {
          td.innerHTML=`<a class="int-registry-link" href="${Utils.escapeHtml(href)}" target="_blank" rel="noreferrer" title="${Utils.escapeHtml(val)}">${Utils.escapeHtml(val)}</a>`;
        } else {
          td.innerHTML=`<span class="cell-text" style="pointer-events:none">${Utils.escapeHtml(String(val).slice(0,20))}</span>`;
        }
      } else {
        // prUrl / docUrl — show short icon link
        const icon = col.key==='prUrl' ? '🔀' : '📄';
        td.innerHTML=`<a class="int-registry-link" href="${Utils.escapeHtml(String(val))}" target="_blank" rel="noreferrer" title="${Utils.escapeHtml(String(val))}">${icon}</a>`;
      }
      return;
    }
    if (col.type==='readonly' || col.type==='riskscore') {
      const score = col.type==='riskscore' ? (row.riskScore||0) : null;
      if (col.type==='riskscore') {
        const color = score>=60?'#ef4444':score>=30?'#f97316':'#22c55e';
        td.innerHTML=`<span class="risk-score-badge" style="background:${color}20;color:${color};border:1px solid ${color}40">${score}</span>`;
      } else {
        td.innerHTML=`<span class="cell-text" style="pointer-events:none">${Utils.truncate(String(val||''),30)}</span>`;
      }
      return;
    }
    if (col.type==='priority') {
      const opts=[['','—'],['high','Высокий'],['medium','Средний'],['low','Низкий']];
      const sel=document.createElement('select'); sel.className='cell-select priority-select';
      opts.forEach(([v,l])=>{ const o=document.createElement('option'); o.value=v; o.textContent=l; if((val||'')===(v))o.selected=true; sel.appendChild(o); });
      sel.addEventListener('change',()=>{
        window.HistoryManager?.checkpoint(`ячейка ${col.key}`);
        row[col.key]=sel.value; row.dirty=true; row.updatedAt=new Date().toISOString();
        Storage.save(); window.App?.refreshDashboardIfActive();
      });
      td.appendChild(sel); return;
    }
    if (col.type==='jira') {
      const wrap=document.createElement('div'); wrap.className='tasks-cell';
      wrap.innerHTML=RH.jiraTagsHtml(val);
      // Edit on double-click
      wrap.title='Двойной клик для редактирования';
      wrap.addEventListener('dblclick',()=>{
        const inp=document.createElement('input'); inp.type='text'; inp.className='cell-input'; inp.value=val||'';
        td.innerHTML=''; td.appendChild(inp); inp.focus();
        function save() {
          const nextVal=inp.value.trim();
          if (String(val||'')===nextVal) { RegistryView.renderCell(td,row,col); return; }
          window.HistoryManager?.checkpoint(`ячейка ${col.key}`);
          row[col.key]=nextVal; row.dirty=true; row.updatedAt=new Date().toISOString();
          Storage.save(); RegistryView.renderCell(td,row,col); window.App?.refreshDashboardIfActive();
        }
        inp.addEventListener('blur',save);
        inp.addEventListener('keydown',e=>{if(e.key==='Enter')inp.blur(); if(e.key==='Escape'){row[col.key]=val;RegistryView.renderCell(td,row,col);}});
      });
      td.appendChild(wrap); return;
    }
    if (col.type==='multiselect') {
      // Storage-tolerant read: if naturally tag/text-stored (pipe-string), split it.
      const cv = Array.isArray(val)
        ? val
        : (typeof val === 'string' ? val.split(/[|,]/).map(s=>s.trim()).filter(Boolean) : []);
      const ms=Multiselect.create(cv,(newVals)=>{
        window.HistoryManager?.checkpoint(`ячейка ${col.key}`);
        // Storage-correct write: keep the column's natural format so downstream code
        // (gantt, dashboard, riskEngine) keeps working.
        row[col.key] = (col.naturalType === 'multiselect') ? newVals : newVals.join('|');
        row.dirty=true; row.updatedAt=new Date().toISOString();
        RowFactory.updateDerived(row); Storage.save(); window.App?.refreshDashboardIfActive();
        const tr=td.closest('tr');
        if(tr){ RegistryView.updateRowVisual(tr,row); RegistryView.updateRowRiskCell(tr,row); }
      });
      td.appendChild(ms); return;
    }
    if (col.type==='scope') {
      const sel=document.createElement('select'); sel.className='cell-select';
      ['',...SCOPE_OPTIONS].forEach(opt=>{const o=document.createElement('option');o.value=opt;o.textContent=opt||'—';if(val===opt)o.selected=true;sel.appendChild(o);});
      sel.addEventListener('change',()=>{
        window.HistoryManager?.checkpoint(`ячейка ${col.key}`);
        row[col.key]=sel.value; row.dirty=true; row.updatedAt=new Date().toISOString();
        RowFactory.updateDerived(row); Storage.save(); window.App?.refreshDashboardIfActive();
        const tr=sel.closest('tr');if(tr){RegistryView.updateRowVisual(tr,row);RegistryView.updateRowRiskCell(tr,row);}
      });
      td.appendChild(sel); return;
    }
    if (col.type==='checkbox') {
      const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=!!val; cb.style.cursor='pointer';
      cb.addEventListener('change',()=>{
        window.HistoryManager?.checkpoint(`чекбокс ${col.key}`);
        row[col.key]=cb.checked; row.dirty=true; row.updatedAt=new Date().toISOString();
        RowFactory.updateDerived(row);
        const tr=cb.closest('tr');
        if (tr) {
          RegistryView.updateRowVisual(tr,row);
          RegistryView.updateRowRiskCell(tr,row);
          // Enable/disable associated date
          const assoc =
            col.key==='isDone'                ? 'doneDate'         :
            col.key==='blockingDependency'    ? 'blockingDeadline' :
            col.key==='commitToCounterparty'  ? 'commitDate'       : null;
          if (assoc) { const dt=tr.querySelector(`[data-col="${assoc}"] input`); if(dt) dt.disabled=!cb.checked; }
        }
        Storage.save(); window.App?.refreshDashboardIfActive();
      });
      td.appendChild(cb); return;
    }
    if (col.type==='date') {
      const inp=document.createElement('input'); inp.type='date'; inp.className='cell-input'; inp.value=val||'';
      const isDoneDate=col.key==='doneDate', isDeadline=col.key==='blockingDeadline', isCommitDate=col.key==='commitDate';
      if (isDoneDate)    inp.disabled=!row.isDone;
      if (isDeadline)    inp.disabled=!row.blockingDependency;
      if (isCommitDate)  inp.disabled=!row.commitToCounterparty;
      inp.addEventListener('change',()=>{
        if (String(row[col.key]||'')===String(inp.value||'')) return;
        window.HistoryManager?.checkpoint(`дата ${col.key}`);
        row[col.key]=inp.value; row.dirty=true; row.updatedAt=new Date().toISOString(); Storage.save();
      });
      td.appendChild(inp); return;
    }
    if (col.type==='daterange') {
      const wrap=document.createElement('div'); wrap.className='date-range-cell';
      const start=document.createElement('input'); start.type='date'; start.className='cell-input'; start.value=row.workPeriodStart||'';
      const end=document.createElement('input'); end.type='date'; end.className='cell-input'; end.value=row.workPeriodEnd||'';
      const dash=document.createElement('span'); dash.textContent='-'; dash.className='date-range-sep';
      const save=()=>{
        const prevStart=row.workPeriodStart||'';
        const prevEnd=row.workPeriodEnd||'';
        const nextStart=start.value||'';
        const nextEnd=end.value||'';
        if (prevStart===nextStart && prevEnd===nextEnd) return;
        window.HistoryManager?.checkpoint('период работ');
        row.workPeriodStart=start.value;
        row.workPeriodEnd=end.value;
        row.dirty=true; row.updatedAt=new Date().toISOString();
        RowFactory.updateDerived(row);
        Storage.save(); window.App?.refreshDashboardIfActive();
      };
      start.addEventListener('change',save); end.addEventListener('change',save);
      wrap.appendChild(start); wrap.appendChild(dash); wrap.appendChild(end); td.appendChild(wrap); return;
    }
    if (col.type==='number') {
      const inp=document.createElement('input'); inp.type='number'; inp.className='cell-input cell-number'; inp.value=val||''; inp.min=0; inp.style.width='100%';
      inp.addEventListener('change',()=>{
        if (String(row[col.key]||'')===String(inp.value||'')) return;
        window.HistoryManager?.checkpoint(`число ${col.key}`);
        row[col.key]=inp.value; row.dirty=true; row.updatedAt=new Date().toISOString(); Storage.save();
      });
      td.appendChild(inp); return;
    }
    if (col.type==='tags') {
      // Storage-tolerant read: works with both arrays (multiselect-natural storage)
      // and pipe-strings (tags-natural storage).
      const current = Array.isArray(val)
        ? val.filter(Boolean).map(s=>String(s).trim())
        : String(val||'').split(/[|,]/).map(s=>s.trim()).filter(Boolean);
      const suggFn = () => {
        if (col.key==='assignee') return [...new Set([...getUniqueTagValues(col.key), ...getEmployeeNames()])].sort((a,b)=>a.localeCompare(b,'ru'));
        return getUniqueTagValues(col.key);
      };
      const tw=createTagInput(current,(tags)=>{
        // Preserve the column's natural storage format so other views don't break.
        const nextVal = (col.naturalType === 'multiselect') ? tags.slice() : tags.join('|');
        const isSame = (col.naturalType === 'multiselect')
          ? (Array.isArray(row[col.key]) && row[col.key].join('|') === tags.join('|'))
          : (String(row[col.key]||'') === nextVal);
        if (isSame) return;
        window.HistoryManager?.checkpoint(`теги ${col.key}`);
        row[col.key]=nextVal; row.dirty=true; row.updatedAt=new Date().toISOString();
        if (col.naturalType === 'multiselect') RowFactory.updateDerived(row);
        Storage.save(); window.App?.populateFilterDropdowns();
        const tr=td.closest('tr');
        if (tr && col.naturalType === 'multiselect') {
          RegistryView.updateRowVisual(tr,row); RegistryView.updateRowRiskCell(tr,row);
          window.App?.refreshDashboardIfActive();
        }
      },suggFn);
      td.appendChild(tw); return;
    }
    if (col.type==='suggest') {
      const inp=document.createElement('input'); inp.type='text'; inp.className='cell-input'; inp.value=val||''; inp.style.width='100%';
      const listId='dl-'+col.key;
      inp.setAttribute('list',listId);
      inp.addEventListener('focus',()=>{
        let dl=document.getElementById(listId);
        if(!dl){dl=document.createElement('datalist');dl.id=listId;document.body.appendChild(dl);}
        dl.innerHTML=getUniqueTextValues(col.key).map(v=>`<option value="${v.replace(/"/g,'&quot;')}">`).join('');
      });
      inp.addEventListener('change',()=>{
        const nextVal=inp.value.trim();
        if (String(row[col.key]||'')===nextVal) return;
        window.HistoryManager?.checkpoint(`текст ${col.key}`);
        row[col.key]=nextVal; row.dirty=true; row.updatedAt=new Date().toISOString(); RowFactory.updateDerived(row); window.App?.populateFilterDropdowns(); Storage.save(); window.App?.refreshDashboardIfActive();
      });
      td.appendChild(inp); return;
    }
    // Default text: long fields are multiline with autosize, short fields stay compact.
    const multilineKeys = new Set(['epic','taskComment','teamDependency','risks','comment']);
    const useMultiline = multilineKeys.has(col.key) || col.key.startsWith('custom_');
    if (useMultiline) {
      const inp=document.createElement('textarea'); inp.className='cell-input cell-textarea';
      inp.value = Array.isArray(val) ? val.join(', ') : (val || '');
      inp.rows=1;
      const autoresize=()=>{ inp.style.height='auto'; inp.style.height=Math.min(180,Math.max(28,inp.scrollHeight))+'px'; };
      inp.addEventListener('input',autoresize);
      inp.addEventListener('change',()=>{
        const typed = inp.value.trim();
        const nextVal = (col.naturalType === 'multiselect')
          ? typed.split(/[|,]/).map(s=>s.trim()).filter(Boolean)
          : typed;
        const sameVal = (col.naturalType === 'multiselect')
          ? (Array.isArray(row[col.key]) && row[col.key].join(',') === nextVal.join(','))
          : (String(row[col.key]||'') === nextVal);
        if (sameVal) return;
        window.HistoryManager?.checkpoint(`текст ${col.key}`);
        row[col.key]=nextVal; row.dirty=true; row.updatedAt=new Date().toISOString();
        RowFactory.updateDerived(row); window.App?.populateFilterDropdowns(); Storage.save(); window.App?.refreshDashboardIfActive();
      });
      td.appendChild(inp); requestAnimationFrame(autoresize); return;
    }
    const inp=document.createElement('input'); inp.type='text'; inp.className='cell-input';
    // Read-tolerant: if storage is array (multiselect-natural), display as comma-separated text.
    inp.value = Array.isArray(val) ? val.join(', ') : (val || '');
    inp.style.width='100%';
    inp.addEventListener('change',()=>{
      const typed = inp.value.trim();
      // Write-correct: if natural type is multiselect, parse comma/pipe-separated tokens back to array.
      const nextVal = (col.naturalType === 'multiselect')
        ? typed.split(/[|,]/).map(s=>s.trim()).filter(Boolean)
        : typed;
      const sameVal = (col.naturalType === 'multiselect')
        ? (Array.isArray(row[col.key]) && row[col.key].join(',') === nextVal.join(','))
        : (String(row[col.key]||'') === nextVal);
      if (sameVal) return;
      window.HistoryManager?.checkpoint(`текст ${col.key}`);
      row[col.key]=nextVal; row.dirty=true; row.updatedAt=new Date().toISOString();
      RowFactory.updateDerived(row); window.App?.populateFilterDropdowns(); Storage.save(); window.App?.refreshDashboardIfActive();
    });
    td.appendChild(inp);
  },

  deleteRow(id) {
    const tr = document.querySelector(`#registry-tbody tr[data-row-id="${CSS.escape(String(id||''))}"]`);
    if (tr) {
      tr.classList.add('tr-deleting');
      setTimeout(() => {
        window.HistoryManager?.checkpoint('удаление строки');
        state.rows=state.rows.filter(r=>r.id!==id);
        Storage.save(); RegistryView.render(); window.App?.updateTopbarBadge(); window.App?.refreshDashboardIfActive();
      }, 180);
      return;
    }
    window.HistoryManager?.checkpoint('удаление строки');
    state.rows=state.rows.filter(r=>r.id!==id);
    Storage.save(); RegistryView.render(); window.App?.updateTopbarBadge(); window.App?.refreshDashboardIfActive();
  },
  addRow() {
    window.HistoryManager?.checkpoint('добавление строки');
    const newRow=RowFactory.create({dirty:true,sourceType:'manual'});
    if (state.lastClickedRowId) {
      const idx=state.rows.findIndex(r=>r.id===state.lastClickedRowId);
      if (idx>=0) { state.rows.splice(idx+1,0,newRow); Storage.save(); RegistryView.render(); window.App?.updateTopbarBadge(); RegistryView._animateNewRow(newRow.id); return; }
    }
    state.rows.push(newRow);
    Storage.save(); RegistryView.render(); window.App?.updateTopbarBadge(); RegistryView._animateNewRow(newRow.id);
  },
  _animateNewRow(id) {
    requestAnimationFrame(()=>{
      const tr = document.querySelector(`#registry-tbody tr[data-row-id="${CSS.escape(String(id||''))}"]`);
      if (tr) { tr.classList.add('tr-adding'); tr.scrollIntoView({block:'nearest'}); setTimeout(()=>tr.classList.remove('tr-adding'),300); }
    });
  },
  showContextMenu(x, y, rowId) {
    document.querySelector('.registry-ctx-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'registry-ctx-menu';
    menu.style.cssText = `left:${x}px;top:${y}px`;
    menu.innerHTML = `
      <div class="ctx-item" data-action="copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Копировать строку</div>
      <div class="ctx-divider"></div>
      <div class="ctx-item ctx-danger" data-action="delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg> Удалить строку</div>`;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth-8) menu.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight-8) menu.style.top = `${y - rect.height}px`;
    menu.addEventListener('click', e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      menu.remove();
      if (action === 'copy') RegistryView.copyRow(rowId);
      if (action === 'delete') RegistryView.deleteRow(rowId);
    });
    const dismiss = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', dismiss); } };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
  },
  copyRow(id) {
    const idx=state.rows.findIndex(r=>r.id===id);
    if (idx<0) return;
    window.HistoryManager?.checkpoint('копия строки');
    const orig=state.rows[idx];
    const copy=RowFactory.create({
      ...JSON.parse(JSON.stringify(orig)),
      id:nextId(), dirty:true, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
    });
    state.rows.splice(idx+1,0,copy);
    Storage.save(); RegistryView.render(); window.App?.updateTopbarBadge();
  },
  autoFitColWidths() {
    const table = document.getElementById('registry-table');
    if (!table) return;
    const visibleCols = RegistryView.getVisibleCols();
    let changed = false;
    visibleCols.forEach((col) => {
      // Only auto-fit if no user-set width or width equals default
      const currentW = state.colWidths[col.key] || col.width || 100;
      // Check header width
      let maxW = col.label.length * 8 + 32;
      // Sample up to 20 rows to measure content
      const cells = table.querySelectorAll(`td[data-col="${col.key}"]`);
      cells.forEach((td, i) => {
        if (i > 20) return;
        const txt = td.textContent?.trim() || '';
        const chips = td.querySelectorAll('.chip,.wt-pill,.tag-badge');
        let contentW = Math.min(txt.length * 7 + 20, 360);
        if (chips.length > 1) contentW = Math.max(contentW, chips.length * 60 + 20);
        maxW = Math.max(maxW, contentW);
      });
      maxW = Math.max(80, Math.min(360, maxW));
      if (maxW > currentW && maxW > (col.width || 100)) {
        state.colWidths[col.key] = maxW;
        changed = true;
      }
    });
    if (changed) {
      syncColumnSettings();
      RegistryView.render();
    }
  },
  renderColTogglePanel() {
    const panel=document.getElementById('col-toggle-panel');
    panel.innerHTML=getAllCols().map(col=>`
      <label class="col-toggle-item">
        <input type="checkbox" data-col="${col.key}" ${state.colVisibility[col.key]!==false?'checked':''}> ${state.colLabels[col.key]||col.label}
      </label>`).join('');
    panel.querySelectorAll('input[data-col]').forEach(cb=>{
      cb.addEventListener('change',()=>{
        if (!cb.checked) {
          const visibleNow=getAllCols().filter(c=>state.colVisibility[c.key]!==false && c.key!==cb.dataset.col).length;
          if (!visibleNow) {
            cb.checked=true;
            window.showToast?.('Нужен минимум один видимый столбец','error',1800);
            return;
          }
        }
        window.HistoryManager?.checkpoint('видимость столбца');
        state.colVisibility[cb.dataset.col]=cb.checked;
        syncColumnSettings();
        Storage.save();
        RegistryView.render();
      });
    });
  },

  applyRowHeight() {
    const rh = state.rowHeight;
    const lines = Math.max(1, Math.floor((rh - 10) / 18));
    document.documentElement.style.setProperty('--row-h', rh + 'px');
    document.documentElement.style.setProperty('--row-lines', String(lines));
  },

  renderSettingsPanel() {
    const panel=document.getElementById('registry-settings-panel');
    const all=getAllCols();
    // Compatible-type groups — changing type within a group keeps the storage format intact.
    // Switching across groups would corrupt downstream consumers (gantt, dashboard, riskEngine),
    // so we hard-disable those options.
    const COMPATIBLE = {
      multiselect: ['multiselect', 'tags'],                           // arrays / pipe-strings
      tags:        ['multiselect', 'tags', 'suggest', 'text'],        // string-friendly
      text:        ['text', 'suggest', 'tags'],
      suggest:     ['text', 'suggest', 'tags'],
      // Strict (typed) columns — single allowed type
      checkbox:    ['checkbox'],
      date:        ['date'],
      daterange:   ['daterange'],
      number:      ['number'],
      scope:       ['scope'],
      priority:    ['priority'],
      riskscore:   ['riskscore'],
      readonly:    ['readonly'],
      intlink:     ['intlink'],
      jira:        ['jira'],
    };
    const colRows=all.map(col=>{
      const label=state.colLabels[col.key]||col.label;
      const w=state.colWidths[col.key]||col.width||100;
      const isPinned=state.pinnedCols.includes(col.key);
      const isCustom=!!state.customCols.find(c=>c.key===col.key);
      const allowed = COMPATIBLE[col.naturalType] || COMPATIBLE.text;
      const lockedTitle = allowed.length === 1
        ? `Тип «${col.naturalType}» зафиксирован — менять небезопасно`
        : `Можно сменить только на совместимый тип (хранилище: ${col.naturalType})`;
      const typeHtml = `<select class="rsp-col-type-input" data-key="${col.key}" title="${lockedTitle}"${allowed.length === 1 ? ' disabled' : ''}>` +
        COL_TYPES.map(t => {
          const isAllowed = allowed.includes(t);
          const isSel = (col.type || 'text') === t;
          return `<option value="${t}"${isSel ? ' selected' : ''}${!isAllowed ? ' disabled' : ''}>${t}${isAllowed ? '' : ' (несовместимо)'}</option>`;
        }).join('') + `</select>`;
      return `<span class="rsp-col-key" title="${col.key}">${col.key}</span>
        <input class="rsp-col-label-input" data-key="${col.key}" value="${label.replace(/"/g,'&quot;')}">
        ${typeHtml}
        <input class="rsp-col-width-input" type="number" data-key="${col.key}" value="${w}" min="40" max="800">
        <button class="rsp-pin-btn ${isPinned?'active':''}" data-key="${col.key}">${isPinned?'📌 Закреплён':'📌 Закрепить'}</button>
        ${isCustom?`<button class="rsp-del-btn" data-key="${col.key}">✕ Удалить</button>`:'<span></span>'}`;
    }).join('');

    panel.innerHTML=`
      <div class="rsp-section">
        <div class="rsp-title">Высота строк</div>
        <div class="rsp-row-height">
          <label>Высота</label>
          <input class="filter-input" type="number" id="rsp-row-h" value="${state.rowHeight}" min="28" max="44" style="width:80px">
          <span style="font-size:12px;color:var(--text-3)">px</span>
          <button class="btn btn-ghost btn-sm" id="rsp-reset-view-btn">Сбросить вид</button>
        </div>
      </div>
      <div class="rsp-section">
        <div class="rsp-title">Столбцы</div>
        <div class="rsp-cols-grid">
          <span class="rsp-col-header">Ключ</span>
          <span class="rsp-col-header">Название</span>
          <span class="rsp-col-header">Тип</span>
          <span class="rsp-col-header">Ширина</span>
          <span class="rsp-col-header">Закреплён</span>
          <span class="rsp-col-header"></span>
          ${colRows}
        </div>
      </div>
      <div class="rsp-section">
        <div class="rsp-title">Добавить столбец</div>
        <div class="rsp-add-col">
          <input id="rsp-new-name" placeholder="Название" style="width:180px">
          <select id="rsp-new-type">
            <option value="text">Текст</option>
            <option value="number">Число</option>
            <option value="checkbox">Чекбокс</option>
            <option value="date">Дата</option>
            <option value="tags">Теги (мультиселект)</option>
          </select>
          <button class="btn btn-primary btn-sm" id="rsp-add-col-btn">+ Добавить</button>
        </div>
      </div>
      <div style="text-align:right;margin-top:8px">
        <button class="btn btn-ghost btn-sm" id="rsp-close-btn">✕ Свернуть настройки</button>
      </div>`;

    panel.querySelector('#rsp-row-h').addEventListener('input', e=>{
      const v=Math.max(28,Math.min(44,parseInt(e.target.value)||36));
      window.HistoryManager?.checkpoint('высота строки');
      state.rowHeight=v; RegistryView.applyRowHeight(); Storage.save();
    });
    panel.querySelector('#rsp-reset-view-btn').addEventListener('click', ()=>{
      if (!confirm('Сбросить вид реестра (ширины, закрепления, видимость, высота)?')) return;
      window.HistoryManager?.checkpoint('сброс вида реестра');
      state.colOrder=[...new Set([...REGISTRY_COLS.map(c=>c.key), ...state.customCols.map(c=>c.key)])];
      state.colWidths={};
      state.pinnedCols=[];
      state.rowHeight=36;
      const vis={};
      getAllCols().forEach(col=>{ vis[col.key]=col.visible!==false; });
      state.colVisibility=vis;
      syncColumnSettings();
      RegistryView.applyRowHeight();
      Storage.save();
      RegistryView.render();
      RegistryView.renderSettingsPanel();
      window.showToast?.('Вид реестра сброшен');
    });

    panel.querySelectorAll('.rsp-col-type-input').forEach(sel=>{
      sel.addEventListener('change', e=>{
        window.HistoryManager?.checkpoint('тип столбца');
        const key=e.target.dataset.key;
        state.colTypes[key]=e.target.value;
        Storage.save(); RegistryView.render(); RegistryView.renderSettingsPanel();
      });
    });

    panel.querySelectorAll('.rsp-col-label-input').forEach(inp=>{
      inp.addEventListener('change', e=>{
        window.HistoryManager?.checkpoint('название столбца');
        const key=e.target.dataset.key;
        const v=e.target.value.trim();
        if (v) state.colLabels[key]=v;
        else delete state.colLabels[key];
        Storage.save(); RegistryView.render();
      });
    });

    panel.querySelectorAll('.rsp-col-width-input').forEach(inp=>{
      inp.addEventListener('change', e=>{
        window.HistoryManager?.checkpoint('ширина столбца');
        const v=Math.max(40,parseInt(e.target.value)||100);
        state.colWidths[e.target.dataset.key]=v;
        e.target.value=v;
        Storage.save(); RegistryView.render();
      });
    });

    panel.querySelectorAll('.rsp-pin-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        window.HistoryManager?.checkpoint('закрепление столбца');
        const key=btn.dataset.key;
        if (state.pinnedCols.includes(key)) state.pinnedCols=state.pinnedCols.filter(k=>k!==key);
        else state.pinnedCols.push(key);
        Storage.save(); RegistryView.render(); RegistryView.renderSettingsPanel();
      });
    });

    panel.querySelectorAll('.rsp-del-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const key=btn.dataset.key;
        if (!confirm('Удалить столбец «'+key+'»?')) return;
        window.HistoryManager?.checkpoint('удаление столбца');
        state.customCols=state.customCols.filter(c=>c.key!==key);
        state.colOrder=state.colOrder.filter(k=>k!==key);
        state.pinnedCols=state.pinnedCols.filter(k=>k!==key);
        delete state.colVisibility[key]; delete state.colWidths[key]; delete state.colLabels[key]; delete state.colTypes[key];
        state.rows.forEach(r=>delete r[key]);
        Storage.save(); RegistryView.render(); RegistryView.renderSettingsPanel();
      });
    });

    panel.querySelector('#rsp-add-col-btn').addEventListener('click', ()=>{
      const name=panel.querySelector('#rsp-new-name').value.trim();
      if (!name) { panel.querySelector('#rsp-new-name').focus(); return; }
      window.HistoryManager?.checkpoint('добавление столбца');
      const type=panel.querySelector('#rsp-new-type').value;
      const key='custom_'+Date.now().toString(36);
      const col={ key, label:name, type, visible:true, width:150 };
      state.customCols.push(col);
      state.colOrder.push(key);
      state.colVisibility[key]=true;
      panel.querySelector('#rsp-new-name').value='';
      Storage.save(); RegistryView.render(); RegistryView.renderSettingsPanel();
    });

    panel.querySelector('#rsp-close-btn').addEventListener('click',()=>{ panel.classList.add('hidden'); });
  },
};
