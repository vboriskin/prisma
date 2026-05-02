'use strict';
/* ============================================================
   EMPLOYEES VIEW — v8_0 ES module
   ============================================================ */

import { state } from '../state.js';
import { FilterEngine } from '../filters.js';
import { Utils } from '../utils.js';
import { EmployeeFactory } from '../rowFactory.js';
import { Storage } from '../dataStore.js';
import { computeLoad } from '../metricsEngine.js';
import { RH } from './renderHelpers.js';
import { createTagInput } from '../components/tagInput.js';

// Local HTML escape helpers — used by V14 (A4+A5) controls bar templates.
// Kept tiny and module-private to avoid leaking into the global namespace.
const _esc = (s) => String(s ?? '')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const _escAttr = _esc;     // same rules apply — attributes need entity-escaping too

export const EmployeesView = {
  _expanded: {},
  _cleanups: [],
  // V14 (A4 + A5): sort + filter state. Sticky across renders. Sort
  // field one of: 'fio' | 'role' | 'team' | 'otDays'. Filter fields:
  // team (single team), role (single role), otFrom/otTo (date range).
  _sort:   { field: 'fio', dir: 'asc' },
  _filter: { team: '', role: '', otFrom: '', otTo: '', onlyWithOt: false },
  // V14 (A1): two render modes — 'cards' (default, detail-rich) and
  // 'table' (legacy spreadsheet view). User can flip via the toggle in
  // the controls bar.
  _viewMode: 'cards',
  cleanup() {
    EmployeesView._cleanups.forEach(fn=>{ try{ fn(); } catch(e){} });
    EmployeesView._cleanups=[];
  },
  _splitTags(raw) {
    return String(raw||'').split(/[|,]/).map(s=>s.trim()).filter(Boolean);
  },
  getTasksForEmployee(fio) {
    const name=String(fio||'').trim();
    if (!name) return [];
    return state.rows.filter(row=>{
      const assignees=EmployeesView._splitTags(row.assignee);
      return assignees.includes(name);
    });
  },
  /* ── V14 (A5): filter helper ──────────────────────────────
     Each filter field is conjunctive (AND). Empty/false fields are
     ignored — i.e. default state shows everyone. */
  _applyFilters(employees) {
    const f = EmployeesView._filter;
    const teamL = String(f.team||'').trim().toLowerCase();
    const roleL = String(f.role||'').trim().toLowerCase();
    const otFromTs = f.otFrom ? Date.parse(f.otFrom) : null;
    const otToTs   = f.otTo   ? Date.parse(f.otTo)   : null;
    return employees.filter(emp => {
      if (teamL) {
        const teams = EmployeesView._splitTags(emp.teams).map(s=>s.toLowerCase());
        if (!teams.includes(teamL)) return false;
      }
      if (roleL) {
        const roles = EmployeesView._splitTags(emp.roles).map(s=>s.toLowerCase());
        if (!roles.includes(roleL)) return false;
      }
      const otDays = Array.isArray(emp.overtimeDays) ? emp.overtimeDays : [];
      if (f.onlyWithOt && otDays.length === 0) return false;
      if (otFromTs != null || otToTs != null) {
        if (!otDays.length) return false;
        const matches = otDays.some(d => {
          const ts = Date.parse(d);
          if (isNaN(ts)) return false;
          if (otFromTs != null && ts < otFromTs) return false;
          if (otToTs   != null && ts > otToTs)   return false;
          return true;
        });
        if (!matches) return false;
      }
      return true;
    });
  },

  /* ── V14 (A4): sort helper ────────────────────────────────
     Stable sort using localeCompare for textual fields and numeric
     comparison for OT-day count. */
  _applySort(list) {
    const { field, dir } = EmployeesView._sort;
    const sign = dir === 'desc' ? -1 : 1;
    const sorted = list.slice();
    const cmpStr = (a, b) => String(a||'').localeCompare(String(b||''), 'ru');
    sorted.sort((a, b) => {
      let r = 0;
      if (field === 'fio')         r = cmpStr(a.fio, b.fio);
      else if (field === 'role')   r = cmpStr(EmployeesView._splitTags(a.roles)[0]||'', EmployeesView._splitTags(b.roles)[0]||'');
      else if (field === 'team')   r = cmpStr(EmployeesView._splitTags(a.teams)[0]||'', EmployeesView._splitTags(b.teams)[0]||'');
      else if (field === 'otDays') r = (Array.isArray(a.overtimeDays)?a.overtimeDays.length:0) - (Array.isArray(b.overtimeDays)?b.overtimeDays.length:0);
      // Tie-break by ФИО asc — keeps order stable across re-renders.
      if (r === 0) r = cmpStr(a.fio, b.fio);
      return r * sign;
    });
    return sorted;
  },

  /* ── V14 (A4 + A5): render the controls bar above the table.
     Lives in #employees-controls (created once, refreshed in place). */
  _renderControls(allEmployees) {
    let bar = document.getElementById('employees-controls');
    if (!bar) {
      // Inject after the legend, before the summary cards. We hook into
      // the existing #employees-table-wrap parent.
      bar = document.createElement('div');
      bar.id = 'employees-controls';
      bar.className = 'employees-controls';
      const summary = document.getElementById('employees-summary-cards');
      summary?.parentElement?.insertBefore(bar, summary);
    }

    // Build option lists from current employee data — keeps dropdowns
    // honest (no stale roles/teams from before mass-delete).
    const allRoles = Array.from(new Set(
      allEmployees.flatMap(e => EmployeesView._splitTags(e.roles))
    )).sort((a,b)=>a.localeCompare(b,'ru'));
    const allTeams = Array.from(new Set(
      allEmployees.flatMap(e => EmployeesView._splitTags(e.teams))
    )).sort((a,b)=>a.localeCompare(b,'ru'));

    const f = EmployeesView._filter;
    const s = EmployeesView._sort;
    const optList = (items, current) =>
      items.map(x => `<option value="${_escAttr(x)}"${x === current ? ' selected' : ''}>${_esc(x)}</option>`).join('');

    bar.innerHTML = `
      <div class="employees-controls-group">
        <label class="employees-ctrl-label">Сортировка</label>
        <select class="employees-ctrl-select" data-emp-ctrl="sort-field">
          <option value="fio"    ${s.field==='fio'   ?'selected':''}>ФИО</option>
          <option value="role"   ${s.field==='role'  ?'selected':''}>Роль</option>
          <option value="team"   ${s.field==='team'  ?'selected':''}>Команда</option>
          <option value="otDays" ${s.field==='otDays'?'selected':''}>Дней OT</option>
        </select>
        <button class="employees-ctrl-btn" data-emp-ctrl="sort-dir" title="Направление сортировки">${s.dir==='desc'?'↓':'↑'}</button>
      </div>
      <div class="employees-controls-divider"></div>
      <div class="employees-controls-group">
        <label class="employees-ctrl-label">Команда</label>
        <select class="employees-ctrl-select" data-emp-ctrl="filter-team">
          <option value="">Все</option>
          ${optList(allTeams, f.team)}
        </select>
      </div>
      <div class="employees-controls-group">
        <label class="employees-ctrl-label">Роль</label>
        <select class="employees-ctrl-select" data-emp-ctrl="filter-role">
          <option value="">Все</option>
          ${optList(allRoles, f.role)}
        </select>
      </div>
      <div class="employees-controls-group">
        <label class="employees-ctrl-label">OT с</label>
        <input class="employees-ctrl-input" type="date" data-emp-ctrl="filter-ot-from" value="${_escAttr(f.otFrom||'')}">
        <label class="employees-ctrl-label">по</label>
        <input class="employees-ctrl-input" type="date" data-emp-ctrl="filter-ot-to" value="${_escAttr(f.otTo||'')}">
      </div>
      <div class="employees-controls-group">
        <label class="employees-ctrl-checkbox">
          <input type="checkbox" data-emp-ctrl="filter-only-ot" ${f.onlyWithOt?'checked':''}>
          Только с OT
        </label>
      </div>
      <div class="employees-controls-spacer"></div>
      <div class="employees-controls-group">
        <label class="employees-ctrl-label">Вид</label>
        <div class="employees-view-toggle">
          <button class="employees-ctrl-btn ${EmployeesView._viewMode==='cards'?'active':''}" data-emp-ctrl="view-cards" title="Карточки с детализацией">▦ Карточки</button>
          <button class="employees-ctrl-btn ${EmployeesView._viewMode==='table'?'active':''}" data-emp-ctrl="view-table" title="Компактная таблица">≡ Таблица</button>
        </div>
      </div>
      <button class="employees-ctrl-btn" data-emp-ctrl="reset" title="Сбросить сортировку и фильтры">Сбросить</button>
    `;

    // Wire events. We don't use event delegation because the inputs are
    // few and have heterogeneous semantics — direct listeners are clearer.
    const $=(sel)=>bar.querySelector(`[data-emp-ctrl="${sel}"]`);
    $('sort-field')?.addEventListener('change',e=>{ EmployeesView._sort.field=e.target.value; EmployeesView.render(); });
    $('sort-dir')  ?.addEventListener('click', ()=>{ EmployeesView._sort.dir = EmployeesView._sort.dir==='asc'?'desc':'asc'; EmployeesView.render(); });
    $('filter-team')?.addEventListener('change',e=>{ EmployeesView._filter.team=e.target.value; EmployeesView.render(); });
    $('filter-role')?.addEventListener('change',e=>{ EmployeesView._filter.role=e.target.value; EmployeesView.render(); });
    $('filter-ot-from')?.addEventListener('change',e=>{ EmployeesView._filter.otFrom=e.target.value; EmployeesView.render(); });
    $('filter-ot-to')  ?.addEventListener('change',e=>{ EmployeesView._filter.otTo  =e.target.value; EmployeesView.render(); });
    $('filter-only-ot')?.addEventListener('change',e=>{ EmployeesView._filter.onlyWithOt=e.target.checked; EmployeesView.render(); });
    $('view-cards')?.addEventListener('click',()=>{ EmployeesView._viewMode='cards'; EmployeesView.render(); });
    $('view-table')?.addEventListener('click',()=>{ EmployeesView._viewMode='table'; EmployeesView.render(); });
    $('reset')?.addEventListener('click',()=>{
      EmployeesView._sort   = { field:'fio', dir:'asc' };
      EmployeesView._filter = { team:'', role:'', otFrom:'', otTo:'', onlyWithOt:false };
      EmployeesView.render();
    });
  },

  render() {
    EmployeesView.cleanup();
    // V14 (A5 + A4): apply filters first, then sort. Sticky state lives
    // on EmployeesView._sort / ._filter so re-render preserves the user's
    // current view across data mutations (add / delete / inline edit).
    const filtered = EmployeesView._applyFilters(state.employees);
    const list = EmployeesView._applySort(filtered);
    const totalAll = state.employees.length;
    const filteredOut = totalAll - list.length;
    // V15 (audit #1, system Critical 3) — null-check. The badge node may
    // not be in DOM yet on the very first render before the section
    // becomes active; without this guard, `badge.textContent` throws and
    // the whole view fails to render.
    const badge=document.getElementById('employees-count-badge');
    if (badge) {
      badge.textContent = filteredOut > 0
        ? `${list.length} из ${totalAll} сотрудников`
        : `${totalAll} сотрудников`;
    }

    const taskLinks=list.reduce((acc,emp)=>acc+EmployeesView.getTasksForEmployee(emp.fio).length,0);
    const weekdayReady=list.filter(e=>e.weekdayReady).length;
    const withOtDays=list.filter(e=>Array.isArray(e.overtimeDays)&&e.overtimeDays.length).length;
    const summaryCardsEl = document.getElementById('employees-summary-cards');
    if (summaryCardsEl) summaryCardsEl.innerHTML=`
      <div class="kpi-card"><div class="kpi-label">Сотрудников</div><div class="kpi-value">${list.length}</div></div>
      <div class="kpi-card kpi-green"><div class="kpi-label">Готовы в будни</div><div class="kpi-value">${weekdayReady}</div></div>
      <div class="kpi-card kpi-red"><div class="kpi-label">С OT днями</div><div class="kpi-value">${withOtDays}</div></div>
      <div class="kpi-card kpi-blue"><div class="kpi-label">Связанных задач</div><div class="kpi-value">${taskLinks}</div></div>
    `;

    // V14 (A4+A5): controls bar — sort selector + filter inputs.
    EmployeesView._renderControls(state.employees);

    const wrap=document.getElementById('employees-table-wrap');
    if (!list.length) {
      const emptyMsg = totalAll === 0
        ? '<div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">Список сотрудников пуст</div><div class="empty-hint">Добавьте вручную или загрузите CSV/XLSX</div></div>'
        : '<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">Под фильтр ничего не попало</div><div class="empty-hint">Сбросьте фильтры — кнопка «Сбросить» в шапке списка</div></div>';
      wrap.innerHTML = emptyMsg;
      return;
    }

    const load = computeLoad(state.rows);
    wrap.innerHTML='';
    if (EmployeesView._viewMode === 'cards') {
      EmployeesView._renderCards(wrap, list, load);
    } else {
      EmployeesView._renderTable(wrap, list, load);
    }
  },

  /* ── V14 (A1): per-employee subnode builders ──────────────
     Each builder returns one DOM node + wires its own events.
     Both the table view and the card view use these same nodes,
     so behaviour stays identical. */
  _buildFioInput(emp) {
    const fioInput=document.createElement('input');
    fioInput.className='cell-input';
    fioInput.type='text';
    fioInput.value=emp.fio||'';
    fioInput.placeholder='ФИО';
    fioInput.addEventListener('change',()=>{
      emp.fio=fioInput.value.trim();
      EmployeeFactory.normalize(emp);
      Storage.save();
      window.App?.populateFilterDropdowns();
      EmployeesView.render();
    });
    return fioInput;
  },
  /** V17.2 I1b — generic input builder для identity-полей (email, jiraAccountId,
   *  bitbucketLogin, confluenceAccountId). Не делает re-render всей вкладки
   *  на каждый change (как _buildFioInput) — identity-поле не влияет на сортировку
   *  / фильтры карточек, поэтому достаточно обновить эту строку state.employees.
   *
   *  V17.2 I2c — для поля `email`: после change auto-trigger
   *  POST /api/integrations/confluence-resolve-user → автозаполняем
   *  `confluenceAccountId` если нашли. Не блокирует UI — fire-and-forget. */
  _buildIdInput(emp, fieldKey, placeholder) {
    const input = document.createElement('input');
    input.className = 'cell-input';
    input.type = 'text';
    input.value = emp[fieldKey] || '';
    input.placeholder = placeholder || '';
    input.addEventListener('change', () => {
      const newVal = input.value.trim();
      const oldVal = emp[fieldKey] || '';
      emp[fieldKey] = newVal;
      EmployeeFactory.normalize(emp);
      Storage.save();
      // V17.2 I2c — при заполнении email пробуем подтянуть confluenceAccountId.
      //   Только если email действительно изменился (не повтор), и поле
      //   confluenceAccountId сейчас пустое (не перезаписываем manual).
      if (fieldKey === 'email' && newVal && newVal !== oldVal && !emp.confluenceAccountId) {
        EmployeesView._tryResolveConfluenceUser(emp);
      }
    });
    return input;
  },
  /** V17.2 I2c — fire-and-forget Confluence user lookup. Toast при успехе/ошибке.
   *  Не показывает loader — это «бонусная» автоматика, юзер не ждёт результата. */
  async _tryResolveConfluenceUser(emp) {
    try {
      const resp = await fetch('/api/integrations/confluence-resolve-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emp.email, fullname: emp.fio }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!data.ok || !data.user) return;     // не нашли — молча игнорим
      const u = data.user;
      const accId = u.accountId || u.username || '';
      if (!accId) return;
      if (emp.confluenceAccountId) return;     // manual-entry guard (race)
      emp.confluenceAccountId = accId;
      EmployeeFactory.normalize(emp);
      Storage.save();
      window.showToast?.(`Confluence: подтянули accountId для ${emp.fio} (${u.displayName || accId})`, 'success', 2400);
      try { window.HistoryLog?.integrations?.('cf_resolve', `Confluence accountId автозаполнен у ${emp.fio}: ${accId}`); } catch(_) {}
      // Re-render карточки чтобы новое значение появилось в input.
      EmployeesView.render?.();
    } catch (_) { /* network/parse — silently skip */ }
  },
  _buildRolesInput(emp) {
    const rolesInput=createTagInput(EmployeesView._splitTags(emp.roles),(tags)=>{
      emp.roles=tags.join('|');
      EmployeeFactory.normalize(emp);
      Storage.save();
      EmployeesView.render();
    },()=>FilterEngine.getRoles());
    if (rolesInput._cleanup) EmployeesView._cleanups.push(()=>rolesInput._cleanup());
    return rolesInput;
  },
  _buildTeamsInput(emp) {
    const teamsInput=createTagInput(EmployeesView._splitTags(emp.teams),(tags)=>{
      emp.teams=tags.join('|');
      EmployeeFactory.normalize(emp);
      Storage.save();
      EmployeesView.render();
    },()=>FilterEngine.getTeams());
    if (teamsInput._cleanup) EmployeesView._cleanups.push(()=>teamsInput._cleanup());
    return teamsInput;
  },
  _buildOtDaysControl(emp) {
    const daysWrap=document.createElement('div');
    daysWrap.className='employee-date-wrap';
    const listWrap=document.createElement('div');
    listWrap.className='employee-date-list';
    (emp.overtimeDays||[]).forEach(d=>{
      const chip=document.createElement('span');
      chip.className='employee-date-chip';
      chip.innerHTML=`${Utils.escapeHtml(d)} <button type="button">×</button>`;
      chip.querySelector('button').addEventListener('click',()=>{
        emp.overtimeDays=(emp.overtimeDays||[]).filter(x=>x!==d);
        EmployeeFactory.normalize(emp);
        Storage.save();
        EmployeesView.render();
      });
      listWrap.appendChild(chip);
    });
    const addWrap=document.createElement('div');
    addWrap.className='employee-date-add';
    const dayInput=document.createElement('input');
    dayInput.type='date';
    dayInput.className='cell-input';
    dayInput.style.maxWidth='150px';
    const addBtn=document.createElement('button');
    addBtn.className='employee-act-btn';
    addBtn.textContent='+';
    addBtn.addEventListener('click',()=>{
      if (!dayInput.value) return;
      emp.overtimeDays=[...(emp.overtimeDays||[]),dayInput.value];
      EmployeeFactory.normalize(emp);
      Storage.save();
      EmployeesView.render();
    });
    addWrap.appendChild(dayInput);
    addWrap.appendChild(addBtn);
    // V17.1 E2 — input row сверху, добавленные значения снизу. Раньше
    // visually было наоборот: chips затирали input при большом списке.
    daysWrap.appendChild(addWrap);
    daysWrap.appendChild(listWrap);
    return daysWrap;
  },
  _buildWeekdayCheckbox(emp) {
    const wdCb=document.createElement('input');
    wdCb.type='checkbox';
    wdCb.checked=!!emp.weekdayReady;
    wdCb.addEventListener('change',()=>{
      emp.weekdayReady=wdCb.checked;
      EmployeeFactory.normalize(emp);
      Storage.save();
      EmployeesView.render();
    });
    return wdCb;
  },
  _buildWeekdayCommentInput(emp) {
    const commentInput=createTagInput(EmployeesView._splitTags(emp.weekdayComment),(tags)=>{
      emp.weekdayComment=tags.join('|');
      EmployeeFactory.normalize(emp);
      Storage.save();
      EmployeesView.render();
    });
    if (commentInput._cleanup) EmployeesView._cleanups.push(()=>commentInput._cleanup());
    return commentInput;
  },
  _buildLoadButton(emp, load) {
    const empLoad = load[emp.fio] || { total:0, r120:0, r121:0, r122:0, ot:0 };
    const empTasks=EmployeesView.getTasksForEmployee(emp.fio);
    const isOverloaded = empLoad.total >= 6;
    const loadHtml = `
      <div class="emp-load-wrap ${isOverloaded?'emp-overloaded':''}">
        <span class="emp-load-total" title="Всего задач">${empLoad.total}${isOverloaded?' ⚠️':''}</span>
        <div class="emp-load-breakdown">
          ${empLoad.r120?`<span class="emp-load-chip r120">1.20:${empLoad.r120}</span>`:''}
          ${empLoad.r121?`<span class="emp-load-chip r121">1.21:${empLoad.r121}</span>`:''}
          ${empLoad.r122?`<span class="emp-load-chip r122">1.22:${empLoad.r122}</span>`:''}
          ${empLoad.ot?`<span class="emp-load-chip ot">OT:${empLoad.ot}</span>`:''}
        </div>
      </div>`;
    const drillBtn=document.createElement('button');
    drillBtn.className='employee-act-btn';
    drillBtn.innerHTML=loadHtml+`<span style="font-size:10px;opacity:.7;margin-left:4px">▼ ${empTasks.length}</span>`;
    drillBtn.addEventListener('click',()=>{
      EmployeesView._expanded[emp.id]=!EmployeesView._expanded[emp.id];
      EmployeesView.render();
    });
    return drillBtn;
  },
  _buildDeleteButton(emp) {
    const delBtn=document.createElement('button');
    delBtn.className='employee-act-btn';
    delBtn.textContent='✕';
    delBtn.title='Удалить сотрудника';
    delBtn.addEventListener('click',()=>{
      if (!confirm(`Удалить сотрудника "${emp.fio||'без имени'}"?`)) return;
      // V15 (audit #1, system H6) — checkpoint before mutation so undo works.
      window.HistoryManager?.checkpoint(`удаление сотрудника: ${emp.fio || 'без имени'}`);
      state.employees=state.employees.filter(e=>e.id!==emp.id);
      Storage.save();
      window.App?.populateFilterDropdowns();
      EmployeesView.render();
    });
    return delBtn;
  },
  _buildExpandedTasksHtml(empTasks) {
    if (!empTasks.length) {
      return '<div class="text-muted text-sm" style="padding:10px 4px">В реестре нет задач с этим исполнителем.</div>';
    }
    return `<div style="overflow:auto;padding:6px 0">
      <table class="data-table" style="width:100%">
        <thead><tr><th>Команда</th><th>Эпик</th><th>Задача</th><th>Релизы</th><th>Овертайм</th></tr></thead>
        <tbody>
          ${empTasks.map(r=>`<tr>
            <td>${Utils.escapeHtml(r.team||'—')}</td>
            <td>${Utils.escapeHtml(r.epic||'—')}</td>
            <td><div class="tasks-cell">${RH.jiraTagsHtml(r.tasks||'')}</div></td>
            <td>${RH.releaseChips(r)}</td>
            <td>${r.hasOvertime?'<span class="chip chip-red">OT</span>':'<span class="chip chip-gray">Нет</span>'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  },

  /* ── V14 (A1, table mode): legacy spreadsheet view ──────── */
  _renderTable(wrap, list, load) {
    const table=document.createElement('table');
    table.className='employees-table';
    // V17.1 E3 — column «Нагрузка» удалена из таблицы (выносится в отдельный
    // summary-блок под таблицей).
    table.innerHTML='<thead><tr><th>ФИО</th><th>Роль</th><th>Команда</th><th>Дни OT</th><th>Будни OT</th><th>Комментарий к будням</th><th></th></tr></thead>';
    const tbody=document.createElement('tbody');
    list.forEach(emp=>{
      const tr=document.createElement('tr');
      const cell=(node)=>{ const td=document.createElement('td'); td.appendChild(node); return td; };
      tr.appendChild(cell(EmployeesView._buildFioInput(emp)));
      tr.appendChild(cell(EmployeesView._buildRolesInput(emp)));
      tr.appendChild(cell(EmployeesView._buildTeamsInput(emp)));
      tr.appendChild(cell(EmployeesView._buildOtDaysControl(emp)));
      tr.appendChild(cell(EmployeesView._buildWeekdayCheckbox(emp)));
      tr.appendChild(cell(EmployeesView._buildWeekdayCommentInput(emp)));
      tr.appendChild(cell(EmployeesView._buildDeleteButton(emp)));
      tbody.appendChild(tr);
      if (EmployeesView._expanded[emp.id]) {
        const detailTr=document.createElement('tr');
        const td=document.createElement('td');
        td.colSpan=7;       // V17.1 E3 — colspan downgraded after column removal
        td.innerHTML=EmployeesView._buildExpandedTasksHtml(EmployeesView.getTasksForEmployee(emp.fio));
        detailTr.appendChild(td);
        tbody.appendChild(detailTr);
      }
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    // V17.1 E3 — render workload summary section under the table (Q4=а+б+в).
    EmployeesView._renderLoadSummary(wrap, list, load);
  },

  /** V17.1 E3 — отдельная сводная нагрузки под таблицей сотрудников.
   *  Q4 (а+б+в): horizontal bar per employee + table fallback + цветовая
   *  шкала (зелёный 0-80%, жёлтый 80-100%, красный 100%+).
   *  Capacity = 5 (default) если у сотрудника не задана своя capacity. */
  _renderLoadSummary(wrap, list, load) {
    const section = document.createElement('section');
    section.className = 'employees-load-summary';
    const heading = document.createElement('div');
    heading.className = 'els-heading';
    heading.innerHTML = '<span class="els-title">Нагрузка</span><span class="els-meta">текущий план: задач по сотруднику относительно capacity (по умолчанию 5)</span>';
    section.appendChild(heading);
    const sorted = [...list].sort((a, b) => {
      const la = (load[a.fio]?.total) || 0;
      const lb = (load[b.fio]?.total) || 0;
      return lb - la;
    });
    const grid = document.createElement('div');
    grid.className = 'els-grid';
    sorted.forEach(emp => {
      const lo = load[emp.fio] || { total:0, r120:0, r121:0, r122:0, ot:0 };
      const cap = emp.capacity || 5;
      const pct = cap > 0 ? Math.min(200, Math.round((lo.total / cap) * 100)) : 0;
      const tier = pct >= 100 ? 'red' : pct >= 80 ? 'amber' : 'green';
      const row = document.createElement('div');
      row.className = `els-row els-row-${tier}`;
      row.innerHTML = `
        <div class="els-name">${Utils.escapeHtml(emp.fio || '—')}</div>
        <div class="els-bar-wrap" title="${lo.total} из ${cap} (${pct}%)">
          <div class="els-bar"><div class="els-bar-fill" style="width:${Math.min(100, pct)}%"></div></div>
        </div>
        <div class="els-stats">
          <span class="els-stat-total">${lo.total}/${cap}</span>
          <span class="els-stat-pct">${pct}%</span>
          ${lo.r120 ? `<span class="els-chip r120">1.20:${lo.r120}</span>` : ''}
          ${lo.r121 ? `<span class="els-chip r121">1.21:${lo.r121}</span>` : ''}
          ${lo.r122 ? `<span class="els-chip r122">1.22:${lo.r122}</span>` : ''}
          ${lo.ot   ? `<span class="els-chip ot">OT:${lo.ot}</span>`     : ''}
        </div>`;
      grid.appendChild(row);
    });
    section.appendChild(grid);
    if (!sorted.length) {
      const empty = document.createElement('div');
      empty.className = 'els-empty';
      empty.textContent = 'Нет сотрудников для расчёта нагрузки';
      section.appendChild(empty);
    }
    wrap.appendChild(section);
  },

  /* ── V14 (A1, card mode): rich detail-cards ──────────────
     Each card shows the employee's info in labeled sections rather
     than spreadsheet cells. The same input nodes are used as in the
     table view, so editing behaviour is identical — only layout
     differs. createdAt / updatedAt / sourceType / id meta is shown
     muted in the card footer for traceability. */
  _renderCards(wrap, list, load) {
    const grid=document.createElement('div');
    grid.className='employee-cards-grid';
    list.forEach(emp=>{
      const card=document.createElement('div');
      card.className='employee-card';
      card.dataset.empId=emp.id;

      // Header — FIO input (large) + delete button
      const header=document.createElement('div');
      header.className='employee-card-header';
      const fioWrap=document.createElement('div');
      fioWrap.className='employee-card-fio';
      fioWrap.appendChild(EmployeesView._buildFioInput(emp));
      header.appendChild(fioWrap);
      header.appendChild(EmployeesView._buildDeleteButton(emp));
      card.appendChild(header);

      // Body sections — each has a label + the matching subnode.
      const sectionRow=(label, node, hint)=>{
        const row=document.createElement('div');
        row.className='employee-card-row';
        const lbl=document.createElement('div');
        lbl.className='employee-card-label';
        lbl.textContent=label;
        if (hint) lbl.title=hint;
        const val=document.createElement('div');
        val.className='employee-card-value';
        val.appendChild(node);
        row.appendChild(lbl);
        row.appendChild(val);
        return row;
      };

      card.appendChild(sectionRow('Роль',     EmployeesView._buildRolesInput(emp)));
      card.appendChild(sectionRow('Команда',  EmployeesView._buildTeamsInput(emp)));
      const otDaysCount = Array.isArray(emp.overtimeDays) ? emp.overtimeDays.length : 0;
      card.appendChild(sectionRow(`Дни OT${otDaysCount?` (${otDaysCount})`:''}`, EmployeesView._buildOtDaysControl(emp), 'Конкретные даты выходов на овертайм'));

      // Будни — checkbox + comment input on the same row
      const wdRow=document.createElement('div');
      wdRow.className='employee-card-row';
      const wdLbl=document.createElement('div');
      wdLbl.className='employee-card-label';
      wdLbl.textContent='Будни';
      const wdVal=document.createElement('div');
      wdVal.className='employee-card-value employee-card-weekday';
      const wdCheckLabel=document.createElement('label');
      wdCheckLabel.className='employee-card-weekday-toggle';
      wdCheckLabel.appendChild(EmployeesView._buildWeekdayCheckbox(emp));
      wdCheckLabel.appendChild(document.createTextNode(' Готов в будни'));
      wdVal.appendChild(wdCheckLabel);
      wdVal.appendChild(EmployeesView._buildWeekdayCommentInput(emp));
      wdRow.appendChild(wdLbl);
      wdRow.appendChild(wdVal);
      card.appendChild(wdRow);

      // Load row — same load button as table mode
      card.appendChild(sectionRow('Нагрузка', EmployeesView._buildLoadButton(emp, load), 'Кол-во задач по релизам'));

      // V17.2 I1b — Identity-секция: deterministic привязка к источникам.
      //   Если поля пустые — портфолио-агрегатор НЕ привязывает к этому
      //   сотруднику данные из соответствующего источника (раньше работала
      //   fuzzy-match по ФИО → ложные attributions).
      const idHeader = document.createElement('div');
      idHeader.className = 'employee-card-id-header';
      idHeader.textContent = 'Идентификация для интеграций';
      card.appendChild(idHeader);
      card.appendChild(sectionRow('Email',                 EmployeesView._buildIdInput(emp, 'email',               'name@company.com'),  'Привязка к Jira / BB по email (точное совпадение)'));
      card.appendChild(sectionRow('Jira accountId',         EmployeesView._buildIdInput(emp, 'jiraAccountId',       '5b10a2844c20165700ede21g'), 'Cloud accountId или username Server Jira'));
      card.appendChild(sectionRow('Bitbucket login',        EmployeesView._buildIdInput(emp, 'bitbucketLogin',      'i.ivanov'),          'Username в Bitbucket. Пусто = «нет аккаунта в BB»'));
      card.appendChild(sectionRow('Confluence accountId',   EmployeesView._buildIdInput(emp, 'confluenceAccountId', '5b10a2844c20165700ede21g'), 'Опционально, для сводок Confluence'));

      // V20 S7 B7 + V20 S8 #11 — Service-account toggle.
      // Pилот feedback: «toggle для разработчика, не для меня. Я в карточку
      // захожу что человек делает, а не чтобы его в боты записать». Решение:
      // спрятали под <details> «Дополнительно» (collapsed by default).
      const saWrap = document.createElement('details');
      saWrap.className = 'employee-card-section employee-card-advanced';
      const saId = `emp-sa-${emp.id}`;
      saWrap.innerHTML = `
        <summary class="employee-card-advanced-head">Дополнительно</summary>
        <div class="employee-card-advanced-body">
          <label for="${saId}" class="employee-card-sa-label" title="Сервисные аккаунты исключаются из counts Сканнера команд. Pattern auto-detect по jiraKey: cab-sa-*, sbt-*, out-*, svc-*, bot-*. Используйте этот toggle если автодетект ошибся.">
            <input type="checkbox" id="${saId}" ${emp.isServiceAccount ? 'checked' : ''}>
            <span>Сервисный аккаунт (бот/SA — исключить из Сканнера команд)</span>
          </label>
        </div>
      `;
      saWrap.querySelector('input').addEventListener('change', (ev) => {
        emp.isServiceAccount = !!ev.target.checked;
        emp.updatedAt = new Date().toISOString();
        // Reactive proxy сам триггерит save через mutation listener.
      });
      card.appendChild(saWrap);

      // Footer — meta (sourceType + dates), muted
      const footer=document.createElement('div');
      footer.className='employee-card-footer';
      const fmtDate=(s)=>{ if(!s) return '—'; try { return new Date(s).toLocaleDateString('ru'); } catch(_) { return s; } };
      const meta=[
        `source: ${Utils.escapeHtml(emp.sourceType||'manual')}`,
        `создан: ${fmtDate(emp.createdAt)}`,
      ];
      if (emp.updatedAt && emp.updatedAt !== emp.createdAt) meta.push(`обновлён: ${fmtDate(emp.updatedAt)}`);
      footer.innerHTML = meta.map(m=>`<span class="employee-card-meta">${m}</span>`).join('');
      card.appendChild(footer);

      // Expanded "linked tasks" panel — collapsed by default
      if (EmployeesView._expanded[emp.id]) {
        const expanded=document.createElement('div');
        expanded.className='employee-card-expanded';
        expanded.innerHTML=EmployeesView._buildExpandedTasksHtml(EmployeesView.getTasksForEmployee(emp.fio));
        card.appendChild(expanded);
      }

      grid.appendChild(card);
    });
    wrap.appendChild(grid);
  },
  parseImportedRows(headers, matrixRows, sourceType) {
    const headerMap={};
    headers.forEach((h,idx)=>{
      const field=Utils.mapEmployeeHeader(Utils.normalizeHeader(h));
      if (field) headerMap[field]=idx;
    });
    if (headerMap.fio==null) return [];
    const get=(cells,key)=>{
      const idx=headerMap[key];
      return idx==null?'':String(cells[idx]||'').trim();
    };
    const imported=[];
    matrixRows.forEach(cells=>{
      if (!cells || cells.every(c=>!String(c||'').trim())) return;
      const fio=get(cells,'fio');
      if (!fio) return;
      imported.push(EmployeeFactory.create({
        fio,
        roles:get(cells,'roles'),
        teams:get(cells,'teams'),
        overtimeDays:Utils.parseDateList(get(cells,'overtimeDays')),
        weekdayReady:Utils.toBool(get(cells,'weekdayReady'),false),
        weekdayComment:get(cells,'weekdayComment'),
        sourceType,
      }));
    });
    return imported;
  },
  mergeImported(imported, sourceLabel) {
    if (!imported.length) { alert('Не найдено валидных строк сотрудников (нужна колонка ФИО).'); return; }
    const existingByFio=new Map();
    state.employees.forEach(emp=>{
      const key=String(emp.fio||'').trim().toLowerCase();
      if (key) existingByFio.set(key,emp);
    });
    let addCount=0, updateCount=0;
    imported.forEach(emp=>{
      const key=String(emp.fio||'').trim().toLowerCase();
      if (!key) return;
      const existing=existingByFio.get(key);
      if (existing) {
        existing.roles=emp.roles;
        existing.teams=emp.teams;
        existing.overtimeDays=emp.overtimeDays;
        existing.weekdayReady=emp.weekdayReady;
        existing.weekdayComment=emp.weekdayComment;
        existing.sourceType=emp.sourceType;
        EmployeeFactory.normalize(existing);
        updateCount++;
      } else {
        state.employees.push(emp);
        existingByFio.set(key,emp);
        addCount++;
      }
    });
    if (!addCount && !updateCount) { alert('Изменений по сотрудникам не найдено.'); return; }
    const ask=confirm(`${sourceLabel}: добавить ${addCount}, обновить ${updateCount}. Применить?`);
    if (!ask) return;
    Storage.save();
    window.App?.populateFilterDropdowns();
    if (state.activeSection==='employees') EmployeesView.render();
    window.showToast?.(`Сотрудники: +${addCount}, обновлено ${updateCount}`);
  },
  importCSV(text) {
    if (text.charCodeAt(0)===0xFEFF) text=text.slice(1);
    const rows=Utils.parseFullCSV(text);
    if (rows.length<2) { alert('CSV пустой'); return; }
    const headers=rows[0].map(h=>String(h||'').trim());
    const imported=EmployeesView.parseImportedRows(headers, rows.slice(1), 'csv');
    EmployeesView.mergeImported(imported, 'CSV');
  },
  importXLSX(buffer) {
    if (typeof window.XLSX==='undefined') { alert('Положите libs/xlsx.full.min.js рядом с index.html'); return; }
    const wb=window.XLSX.read(buffer,{type:'array'});
    const imported=[];
    wb.SheetNames.forEach(sheetName=>{
      const ws=wb.Sheets[sheetName];
      const raw=window.XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
      if (!raw || raw.length<2) return;
      let headerIdx=0;
      for (let i=0;i<Math.min(6,raw.length);i++) {
        const mapped=raw[i].map(h=>Utils.mapEmployeeHeader(Utils.normalizeHeader(h)));
        if (mapped.includes('fio')) { headerIdx=i; break; }
      }
      const headers=(raw[headerIdx]||[]).map(h=>String(h||'').trim());
      const rows=raw.slice(headerIdx+1);
      imported.push(...EmployeesView.parseImportedRows(headers,rows,'xlsx:'+sheetName));
    });
    EmployeesView.mergeImported(imported, 'XLSX');
  },
};
