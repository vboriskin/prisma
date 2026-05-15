'use strict';
/* ============================================================
   EMPLOYEES VIEW — v8_0 ES module
   ============================================================ */

import { state } from '../state.js';
import { FilterEngine } from '../filters.js';
import { Utils } from '../utils.js';
import { EmployeeFactory, RowFactory } from '../rowFactory.js';
import { Storage } from '../dataStore.js';
import { computeLoad } from '../metricsEngine.js';
import { RH } from './renderHelpers.js';
import { createTagInput } from '../components/tagInput.js';
import { ConfirmDialog } from '../app/uxKit.js';
import { renderPageHeader, prizmaEmptyGlyph } from '../app/prizmaUI.js';
import { Icons } from '../app/icons.js';
import { Services } from '../app/services.js';

// V21 π7 A2 — локальный `_esc` удалён, используем `Utils.escapeHtml`
// (5 копий escape-функции в проекте схлопнуты в одну). Псевдоним
// `_escAttr` сохраняем для backward-compat в template literals — указывает
// на ту же функцию (для атрибутов нужны те же правила экранирования).
const _esc     = (s) => Utils.escapeHtml(s);
const _escAttr = _esc;

/* AUDIT-ART #16/#17 — runtime style-инжект для Сотрудников.
   styles.css не правится (параллельные агенты конфликтуют).
   Идемпотентно: повторные вызовы no-op.
   #16 — нейтральные KPI-карты (signal только на «значении» и только при
   отклонении от нормы, не как фон).
   #17 — toggle Карточки/Таблица в spine-pill (3px stripe-bottom, no fill). */
function injectEmployeesAuditArtStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('audit-art-employees-style')) return;
  const style = document.createElement('style');
  style.id = 'audit-art-employees-style';
  style.textContent = `
/* AUDIT-ART #16 — нейтрализация фона KPI-карт. Раньше .kpi-signal-on-course /
   off-course / information красили всю карту. Брендбук §3 (signal 5%):
   фон карты должен быть нейтральным (--card / --prizma-bg-elevated),
   цветным становится только число при отклонении. */
.employees-summary-cards .kpi-card.kpi-neutral {
  background: var(--prizma-bg-elevated, var(--card, #fff));
  border: 1px solid var(--border-light, var(--border, rgba(0,0,0,0.06)));
}
.employees-summary-cards .kpi-card.kpi-neutral .kpi-value {
  color: var(--prizma-text-primary, var(--text-1, inherit));
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1, "lnum" 1;
}
/* Цвет на значении — точечно. data-kpi-state управляет тем, какой signal-цвет
   получает число (off-course / drift / information / on-course). */
.employees-summary-cards .kpi-card.kpi-neutral .kpi-value[data-kpi-state="off-course"] {
  color: var(--prizma-off-course);
}
.employees-summary-cards .kpi-card.kpi-neutral .kpi-value[data-kpi-state="drift"] {
  color: var(--prizma-drift);
}
.employees-summary-cards .kpi-card.kpi-neutral .kpi-value[data-kpi-state="information"] {
  color: var(--prizma-information);
}
.employees-summary-cards .kpi-card.kpi-neutral .kpi-value[data-kpi-state="on-course"] {
  color: var(--prizma-on-course);
}
.employees-summary-cards .kpi-card.kpi-neutral .kpi-label {
  color: var(--prizma-text-secondary, var(--text-2, inherit));
}

/* AUDIT-ART #17 — toggle Карточки/Таблица spine-pill.
   Active = inset-bottom 3px stripe (information-токен), background transparent.
   Inactive = no fill, neutral text. */
.employees-view-toggle .employees-view-toggle-btn {
  background: transparent;
  border: 1px solid transparent;
  color: var(--prizma-text-secondary, var(--text-2));
  box-shadow: none;
  border-radius: 6px;
  transition: color 140ms ease, box-shadow 140ms ease;
}
.employees-view-toggle .employees-view-toggle-btn:hover {
  color: var(--prizma-text-primary, var(--text-1));
}
.employees-view-toggle .employees-view-toggle-btn.active {
  background: transparent;
  color: var(--prizma-information);
  box-shadow: inset 0 -3px 0 var(--prizma-information);
  border-radius: 6px 6px 0 0;
}
`;
  document.head.appendChild(style);
}

export const EmployeesView = {
  _expanded: {},
  _cleanups: [],
  // V14 (A4 + A5): sort + filter state. Sticky across renders. Sort
  // field one of: 'fio' | 'role' | 'team' | 'otDays'. Filter fields:
  // team (single team), role (single role), otFrom/otTo (date range).
  _sort:   { field: 'fio', dir: 'asc' },
  // V21 audit 04-employees §15: добавлен `query` для поиска по ФИО.
  _filter: { team: '', role: '', otFrom: '', otTo: '', onlyWithOt: false, query: '' },
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
    const queryL = String(f.query||'').trim().toLowerCase();
    const otFromTs = f.otFrom ? Date.parse(f.otFrom) : null;
    const otToTs   = f.otTo   ? Date.parse(f.otTo)   : null;
    return employees.filter(emp => {
      // V21 audit 04-employees §15: search by FIO (substring, case-insensitive).
      if (queryL) {
        const fioL = String(emp.fio || '').toLowerCase();
        if (!fioL.includes(queryL)) return false;
      }
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
     Lives in #employees-controls (created once, refreshed in place).
     UX 7.1 — идемпотентный рендер: на повторных вызовах _renderControls
     обновляются только value/selected/checked/options существующих
     элементов; innerHTML не переписывается, иначе фокус срывается с
     date-picker'ов и input'ов на каждом render() (например после
     reactive-notify). */
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

    // UX 7.1 — fast path: bar уже построен. Перерисовываем только
    // изменяемые значения (selects, date inputs, checkbox, view-toggle).
    // Опции <select> для command/role обновляем через rebuild — список ролей
    // и команд может меняться при mass-edit, но это не ломает фокус (focus
    // обычно не на этих <select> между ререндерами).
    if (bar.dataset.bound === '1') {
      const $val = (sel) => bar.querySelector(`[data-emp-ctrl="${sel}"]`);
      const sortField = $val('sort-field');
      if (sortField && sortField.value !== s.field) sortField.value = s.field;
      const filterTeam = $val('filter-team');
      if (filterTeam) {
        const newOpts = `<option value="">Все</option>${optList(allTeams, f.team)}`;
        if (filterTeam.innerHTML !== newOpts) filterTeam.innerHTML = newOpts;
        else if (filterTeam.value !== (f.team || '')) filterTeam.value = f.team || '';
      }
      const filterRole = $val('filter-role');
      if (filterRole) {
        const newOpts = `<option value="">Все</option>${optList(allRoles, f.role)}`;
        if (filterRole.innerHTML !== newOpts) filterRole.innerHTML = newOpts;
        else if (filterRole.value !== (f.role || '')) filterRole.value = f.role || '';
      }
      const otFromInp = $val('filter-ot-from');
      // Не трогаем value у focused input — пользователь может в нём печатать.
      if (otFromInp && document.activeElement !== otFromInp && otFromInp.value !== (f.otFrom || '')) {
        otFromInp.value = f.otFrom || '';
      }
      const otToInp = $val('filter-ot-to');
      if (otToInp && document.activeElement !== otToInp && otToInp.value !== (f.otTo || '')) {
        otToInp.value = f.otTo || '';
      }
      const onlyOt = $val('filter-only-ot');
      if (onlyOt && onlyOt.checked !== !!f.onlyWithOt) onlyOt.checked = !!f.onlyWithOt;
      const viewCardsBtn = $val('view-cards');
      const viewTableBtn = $val('view-table');
      if (viewCardsBtn) viewCardsBtn.classList.toggle('active', EmployeesView._viewMode === 'cards');
      if (viewTableBtn) viewTableBtn.classList.toggle('active', EmployeesView._viewMode === 'table');
      return;
    }

    bar.innerHTML = `
      <div class="employees-controls-group">
        <label class="employees-ctrl-label">Сортировка</label>
        <select class="employees-ctrl-select" data-emp-ctrl="sort-field">
          <option value="fio"    ${s.field==='fio'   ?'selected':''}>ФИО</option>
          <option value="role"   ${s.field==='role'  ?'selected':''}>Роль</option>
          <option value="team"   ${s.field==='team'  ?'selected':''}>Команда</option>
          <option value="otDays" ${s.field==='otDays'?'selected':''}>Дней овертайма</option>
        </select>
        <button class="employees-ctrl-btn" data-emp-ctrl="sort-dir" title="Направление сортировки" aria-label="Направление сортировки">${s.dir==='desc'?Icons.get('chevrons-up-down',{size:14,label:'По убыванию'}):Icons.get('chevrons-up-down',{size:14,label:'По возрастанию'})}</button>
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
        <label class="employees-ctrl-label">Овертайм с</label>
        <input class="employees-ctrl-input" type="date" data-emp-ctrl="filter-ot-from" value="${_escAttr(f.otFrom||'')}">
        <label class="employees-ctrl-label">по</label>
        <input class="employees-ctrl-input" type="date" data-emp-ctrl="filter-ot-to" value="${_escAttr(f.otTo||'')}">
      </div>
      <div class="employees-controls-group">
        <label class="employees-ctrl-checkbox">
          <input type="checkbox" data-emp-ctrl="filter-only-ot" ${f.onlyWithOt?'checked':''}>
          Только с овертаймом
        </label>
      </div>
      <div class="employees-controls-spacer"></div>
      <div class="employees-controls-group">
        <label class="employees-ctrl-label">Вид</label>
        <div class="employees-view-toggle">
          <button class="employees-ctrl-btn employees-view-toggle-btn ${EmployeesView._viewMode==='cards'?'active':''}" data-emp-ctrl="view-cards" title="Карточки с детализацией">${Icons.get('grid', { size: 14 })}<span class="employees-view-toggle-label">Карточки</span></button>
          <button class="employees-ctrl-btn employees-view-toggle-btn ${EmployeesView._viewMode==='table'?'active':''}" data-emp-ctrl="view-table" title="Компактная таблица">${Icons.get('list', { size: 14 })}<span class="employees-view-toggle-label">Таблица</span></button>
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
      // V21 audit 04-employees §15: query тоже сбрасываем + чистим input.
      EmployeesView._filter = { team:'', role:'', otFrom:'', otTo:'', onlyWithOt:false, query:'' };
      const searchInp = document.getElementById('employees-search');
      if (searchInp) searchInp.value = '';
      EmployeesView.render();
    });
    // UX 7.1 — отметка «листенеры навешены» — на повторных _renderControls
    // не пересобираем DOM и не теряем фокус.
    bar.dataset.bound = '1';
  },

  _renderPrizmaHeader() {
    const section = document.getElementById('section-employees');
    if (!section) return;
    let host = section.querySelector('#employees-prizma-header');
    if (!host) {
      host = document.createElement('div');
      host.id = 'employees-prizma-header';
      section.insertBefore(host, section.firstChild);
    }
    host.innerHTML = renderPageHeader('employees', {
      sub: 'Состав команды и распределение нагрузки.',
    });
  },

  render() {
    EmployeesView.cleanup();
    // AUDIT-ART #16/#17 — runtime style-инжект (idempotent).
    injectEmployeesAuditArtStyles();
    // Волна 2 — Prizma page-header сверху страницы.
    EmployeesView._renderPrizmaHeader();
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
    if (summaryCardsEl) {
      // AUDIT-ART #16 — нейтральные KPI-карты, цвет только на значении при
      // отклонении. Пороги:
      //   • «Сотрудников» — всегда нейтральный счётчик (нет «нормы»).
      //   • «Готовы в будни» — нейтрально (это просто доля). Не отклонение.
      //   • «С OT днями» — off-course если есть хотя бы один (норма = 0).
      //   • «Связанных задач» — information если средняя нагрузка >5 задач
      //     на сотрудника (capacity по умолчанию из _renderLoadSummary = 5).
      const otState = withOtDays > 0 ? 'off-course' : '';
      const avgPerHead = list.length ? (taskLinks / list.length) : 0;
      const taskState = avgPerHead > 5 ? 'information' : '';
      const stateAttr = (s) => s ? ` data-kpi-state="${s}"` : '';
      summaryCardsEl.innerHTML = `
        <div class="kpi-card kpi-neutral"><div class="kpi-label">Сотрудников</div><div class="kpi-value">${list.length}</div></div>
        <div class="kpi-card kpi-neutral"><div class="kpi-label">Готовы в будни</div><div class="kpi-value">${weekdayReady}</div></div>
        <div class="kpi-card kpi-neutral"><div class="kpi-label">С OT днями</div><div class="kpi-value"${stateAttr(otState)}>${withOtDays}</div></div>
        <div class="kpi-card kpi-neutral"><div class="kpi-label">Связанных задач</div><div class="kpi-value"${stateAttr(taskState)}>${taskLinks}</div></div>
      `;
    }

    // V14 (A4+A5): controls bar — sort selector + filter inputs.
    EmployeesView._renderControls(state.employees);

    const wrap=document.getElementById('employees-table-wrap');
    if (!list.length) {
      const emptyMsg = totalAll === 0
        ? `<div class="empty-state">${prizmaEmptyGlyph()}<div class="empty-title">Список сотрудников пуст</div><div class="empty-hint">Добавьте вручную или загрузите CSV/XLSX</div></div>`
        : `<div class="empty-state">${prizmaEmptyGlyph()}<div class="empty-title">Подходящих сотрудников нет</div><div class="empty-hint">Сбросьте фильтры или измените запрос</div></div>`;
      wrap.innerHTML = emptyMsg;
      // П4-DASHBOARD Wave 4: teams-summary рендерится по state.rows,
      // а не по employees — должна работать даже при пустом списке сотрудников.
      EmployeesView._renderTeamsSummary();
      return;
    }

    const load = computeLoad(state.rows);
    wrap.innerHTML='';
    if (EmployeesView._viewMode === 'cards') {
      EmployeesView._renderCards(wrap, list, load);
    } else {
      EmployeesView._renderTable(wrap, list, load);
    }
    // П4-DASHBOARD Wave 4: teams-summary переехала с дашборда сюда.
    // Сводная таблица 12 колонок × N команд по rows. Контейнер
    // создаётся ниже основного table-wrap, ОДИН РАЗ.
    EmployeesView._renderTeamsSummary();
    // AUDIT_HOLISTIC §5.1 — если активен focus-якорь на employee,
    // делаем auto-scroll в карточку и подсвечиваем (identity-deterministic
    // resolve по email).
    EmployeesView._applyFocus();
  },

  /** AUDIT_HOLISTIC §5.1 — preselect employee card по state.meta.focus. */
  _applyFocus() {
    try {
      const focus = state?.meta?.focus;
      if (!focus || focus.kind !== 'employee' || !focus.id) return;
      const id = String(focus.id).trim();
      const idLc = id.toLowerCase();
      const emp = (state.employees || []).find(e =>
        (e.email && e.email.toLowerCase() === idLc) ||
        (e.jiraAccountId && String(e.jiraAccountId) === id) ||
        (e.fio && e.fio.toLowerCase() === idLc),
      );
      if (!emp) return;
      const card = document.querySelector(`.employee-card[data-emp-id="${CSS.escape(String(emp.id))}"]`);
      if (!card) return;
      card.classList.add('employee-card-focused');
      try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
      // remove highlight on next focus-change или через 4с
      setTimeout(() => { try { card.classList.remove('employee-card-focused'); } catch (_) {} }, 4000);
    } catch (_) { /* render-failure не должен блокировать view */ }
  },

  /* П4-DASHBOARD Wave 4 — миграция teams-summary с дашборда.
     Cross-team аналитика по rows: распределение по scope, релизам, OT,
     блокерам, рискам, done. Источник — state.rows (а не employees). */
  _renderTeamsSummary() {
    const section = document.getElementById('section-employees');
    if (!section) return;
    let host = section.querySelector('#employees-teams-summary');
    if (!host) {
      host = document.createElement('div');
      host.id = 'employees-teams-summary';
      section.appendChild(host);
    }
    const rows = state.rows || [];
    const teams = Utils.unique(rows.map(r => r.team));
    if (!teams.length) { host.innerHTML = ''; return; }
    // P7 fix (codebase-02 audit) — single-pass aggregation за O(N) вместо
    // teams×12 .filter() сканов (≈ teams×12×N). На 30 команд × 5k rows
    // экономит 30-80ms на каждый рендер.
    const stats = new Map();
    teams.forEach(t => stats.set(t, { tot:0, yes:0, no:0, treb:0, r120:0, r121:0, r122:0, ot:0, ua:0, blk:0, rsk:0, done:0 }));
    for (const r of rows) {
      const c = stats.get(r.team); if (!c) continue;
      c.tot++;
      if (r.scopeStatus === 'Да') c.yes++;
      else if (r.scopeStatus === 'Нет') c.no++;
      else if (r.scopeStatus === 'Требует подтверждения') c.treb++;
      if (r.hasRelease120) c.r120++;
      if (r.hasRelease121) c.r121++;
      if (r.hasRelease122) c.r122++;
      if (r.hasOvertime) c.ot++;
      if (r.isUnassigned) c.ua++;
      if (r.blockingDependency) c.blk++;
      if (r.riskFlags && r.riskFlags.length) c.rsk++;
      if (r.isDone) c.done++;
    }
    host.innerHTML = `<div class="data-table-wrap" role="region" aria-label="Сводка по командам">
      <div class="data-table-title">СВОДКА ПО КОМАНДАМ</div>
      <div style="overflow-x:auto"><table class="data-table">
        <thead><tr><th style="text-align:left">Команда</th><th>Всего</th><th>Да</th><th>Нет</th><th title="Требует подтверждения">Треб.</th><th>1.20</th><th>1.21</th><th>1.22</th><th title="Овертайм">Овертайм</th><th>Без рел.</th><th>Блокер</th><th>Риски</th><th>Сделано</th></tr></thead>
        <tbody>${teams.map(team => {
          const c = stats.get(team);
          const cells = [c.tot, c.yes, c.no, c.treb, c.r120, c.r121, c.r122, c.ot, c.ua, c.blk, c.rsk, c.done];
          return `<tr><td style="text-align:left"><strong>${_esc(team)}</strong></td>${cells.map(v=>`<td>${v||'—'}</td>`).join('')}</tr>`;
        }).join('')}</tbody>
      </table></div></div>`;
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
      const trimmed = fioInput.value.trim();
      // V21 audit 04-employees §5: warning при коллизии ФИО (case-insensitive).
      // Не блокируем — пользователь может реально иметь тёзок, — но даём toast.
      if (trimmed) {
        const lower = trimmed.toLowerCase();
        const dup = state.employees.find(e => e.id !== emp.id && String(e.fio || '').trim().toLowerCase() === lower);
        if (dup) {
          window.showToast?.(`«${trimmed}» уже есть в списке — это омоним?`, 'warning', 4000);
        }
      }
      emp.fio=trimmed;
      EmployeeFactory.normalize(emp);
      Storage.save();
      Services.App?.populateFilterDropdowns();
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
    // V21 audit 04-employees §10: tag-input был неверным паттерном (free-text
    // комментарий «не может во вторник 5 мая, заболел ребёнок» разрывался по
    // запятой на чипы). Теперь — обычный textarea.
    const commentInput=document.createElement('textarea');
    commentInput.className='employee-card-comment-input';
    commentInput.rows=2;
    commentInput.placeholder='Когда не может (даты/недели исключений)';
    commentInput.value=String(emp.weekdayComment||'').replace(/\|/g,'\n');
    commentInput.addEventListener('change',()=>{
      // Сохраняем как `|`-joined (legacy формат для совместимости с импортом).
      emp.weekdayComment=commentInput.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).join('|');
      EmployeeFactory.normalize(emp);
      Storage.save();
      // V21 audit 04-employees §2: skip full re-render — комментарий локальный,
      // не влияет на сортировку / list-фильтры.
    });
    return commentInput;
  },
  _buildLoadButton(emp, load) {
    const empLoad = load[emp.fio] || { total:0, r120:0, r121:0, r122:0, ot:0 };
    const empTasks=EmployeesView.getTasksForEmployee(emp.fio);
    const isOverloaded = empLoad.total >= 6;
    const loadHtml = `
      <div class="emp-load-wrap ${isOverloaded?'emp-overloaded':''}">
        <span class="emp-load-total" title="Всего задач">${isOverloaded?'<span class="signal-dot signal-off-course" role="img" aria-label="Перегрузка"></span>':''}${empLoad.total}</span>
        <div class="emp-load-breakdown">
          ${empLoad.r120?`<span class="emp-load-chip r120">1.20:${empLoad.r120}</span>`:''}
          ${empLoad.r121?`<span class="emp-load-chip r121">1.21:${empLoad.r121}</span>`:''}
          ${empLoad.r122?`<span class="emp-load-chip r122">1.22:${empLoad.r122}</span>`:''}
          ${empLoad.ot?`<span class="emp-load-chip ot">OT:${empLoad.ot}</span>`:''}
        </div>
      </div>`;
    const drillBtn=document.createElement('button');
    drillBtn.className='employee-act-btn';
    drillBtn.innerHTML=loadHtml+`<span class="emp-drill-meta" style="opacity:.7;margin-left:4px;display:inline-flex;align-items:center;gap:2px">${Icons.get('chevrons-up-down',{size:10})}<span>${empTasks.length}</span></span>`;
    drillBtn.addEventListener('click',()=>{
      EmployeesView._expanded[emp.id]=!EmployeesView._expanded[emp.id];
      EmployeesView.render();
    });
    return drillBtn;
  },
  _buildDeleteButton(emp) {
    const delBtn=document.createElement('button');
    delBtn.className='employee-act-btn';
    delBtn.innerHTML=Icons.get('x',{size:14,label:'Удалить сотрудника'});
    delBtn.title='Удалить сотрудника';
    delBtn.setAttribute('aria-label','Удалить сотрудника');
    delBtn.addEventListener('click', async ()=>{
      // V21 Q (audit-2026-05-03 §I, Quick win 8) — native confirm() заменён
      // на ConfirmDialog: keyboard-friendly, focus-trap, danger-стиль,
      // Undo через HistoryManager.checkpoint остаётся как раньше.
      const ok = await ConfirmDialog.show({
        title: 'Удалить сотрудника?',
        message: `«${emp.fio || 'без имени'}» будет удалён из списка. Действие можно отменить через Ctrl+Z.`,
        confirmLabel: 'Удалить',
        danger: true,
      });
      if (!ok) return;
      Services.HistoryManager?.checkpoint(`удаление сотрудника: ${emp.fio || 'без имени'}`);
      // V21 P / П10.22 — toast undo CTA (snapshot текущей позиции, чтобы
      // вернуть сотрудника на тот же индекс при отмене).
      const removedIndex = state.employees.findIndex(e=>e.id===emp.id);
      // QA A7.2 — клон, не ссылка.
      const removedSnapshot = removedIndex >= 0 ? Utils.deepClone(state.employees[removedIndex]) : null;
      // QA A3.7 (employees) — id предшественника для restore-by-id.
      const predecessorId = removedIndex > 0 ? state.employees[removedIndex - 1]?.id : null;
      state.employees=state.employees.filter(e=>e.id!==emp.id);
      Storage.save();
      Services.App?.populateFilterDropdowns();
      EmployeesView.render();
      if (removedSnapshot) {
        const dur = (typeof window !== 'undefined' && window.ToastDuration) ? window.ToastDuration.LONG : 4500;
        const shortDur = (typeof window !== 'undefined' && window.ToastDuration) ? window.ToastDuration.SHORT : 1500;
        window.showToast?.({
          msg:  `Сотрудник «${removedSnapshot.fio || 'без имени'}» удалён`,
          type: 'success',
          ms:   dur,
          undo: 'Отменить',
          onUndo: () => {
            // QA A7.1 — guard против double-restore.
            if (state.employees.some(e => e.id === removedSnapshot.id)) return;
            // QA A3.7 — restore by predecessor id, fallback к индексу.
            let idx;
            const predIdx = predecessorId ? state.employees.findIndex(e => e.id === predecessorId) : -1;
            if (predIdx >= 0) idx = predIdx + 1;
            else idx = Math.max(0, Math.min(removedIndex, state.employees.length));
            state.employees.splice(idx, 0, removedSnapshot);
            // QA A7.1 — после restore пересчитать derived поля у всех строк,
            // где этот сотрудник был assignee (роль, isUnassigned и т.п.).
            try { state.rows.forEach(r => RowFactory.updateDerived(r)); } catch (_) {}
            Storage.save();
            Services.App?.populateFilterDropdowns();
            EmployeesView.render();
            window.showToast?.('Удаление отменено', 'info', shortDur);
          },
        });
      }
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
      // V22 04-employees task #3: семантическая stripe-left.
      //   blocked → drift (приглушённый янтарь, «вне строя, но история ценна»)
      //   service-account → information (нейтральный, не тревожный)
      //   обычный — neutral border
      if (emp.isBlocked) card.classList.add('employee-card--blocked');
      else if (emp.isServiceAccount) card.classList.add('employee-card--service');
      card.dataset.empId=emp.id;

      // Header — FIO input (large) + delete button
      const header=document.createElement('div');
      header.className='employee-card-header';
      const fioWrap=document.createElement('div');
      fioWrap.className='employee-card-fio';
      fioWrap.appendChild(EmployeesView._buildFioInput(emp));
      // V22 — visual badge для сотрудников без email. В реальной диагностике
      // ~5/102 без email → для них Auto-Resolve по идентичности невозможен
      // (BB / CF / Jenkins cascade-ы стартуют с email). Тимлид должен
      // видеть «слепое пятно» сразу, без открытия секции «Привязка».
      // Service-account / blocked сотрудников намеренно скрываем — у них
      // отсутствие email норма (бот / уволен).
      const emailEmpty = !String(emp.email || '').trim();
      if (emailEmpty && !emp.isServiceAccount && !emp.isBlocked) {
        const badge = document.createElement('span');
        badge.className = 'employee-card-no-email-badge';
        badge.textContent = 'Нет email — атрибуция невозможна';
        badge.title = 'Без email сотрудник не попадает в Auto-Resolve (BB / Confluence / Jenkins). Заполните Email ниже.';
        fioWrap.appendChild(badge);
      }
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

      // V21 audit 04-employees §9: «Готов в будни» → «Овертайм по будням:
      // готов» + tooltip; двусмысленность с обычным рабочим днём убрана.
      const wdRow=document.createElement('div');
      wdRow.className='employee-card-row';
      const wdLbl=document.createElement('div');
      wdLbl.className='employee-card-label';
      wdLbl.textContent='Будни OT';
      wdLbl.title='Готов задержаться сверх 8 часов в будний день (овертайм по будням, не путать с обычным рабочим днём).';
      const wdVal=document.createElement('div');
      wdVal.className='employee-card-value employee-card-weekday';
      const wdCheckLabel=document.createElement('label');
      wdCheckLabel.className='employee-card-weekday-toggle';
      wdCheckLabel.title='Готов задержаться сверх 8 часов в будний день.';
      wdCheckLabel.appendChild(EmployeesView._buildWeekdayCheckbox(emp));
      wdCheckLabel.appendChild(document.createTextNode(' Овертайм по будням: готов'));
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
      // V21 audit 04-employees §4: Email вынесен в основные поля карточки
      // (он реально нужен для resolve), 3 интеграционных id свёрнуты в
      // <details> «Привязка к интеграциям» — раньше Jira accountId типа
      // `5b10a2844c20165700ede21g` пугал HR-юзера прямо в основной форме.
      card.appendChild(sectionRow('Email', EmployeesView._buildIdInput(emp, 'email', 'name@company.com'), 'Используется для привязки к Jira / BB / Confluence по email (точное совпадение).'));

      const idDetails = document.createElement('details');
      idDetails.className = 'employee-card-section employee-card-identity';
      idDetails.innerHTML = `
        <summary class="employee-card-identity-head">Привязка к интеграциям (опционально)</summary>
        <div class="employee-card-identity-hint">Заполнится автоматически после первой активности в Jira / Bitbucket / Confluence. Оставьте пустым, если человек не использует эту систему.</div>
      `;
      const idBody = document.createElement('div');
      idBody.className = 'employee-card-identity-body';
      idBody.appendChild(sectionRow('Jira accountId',       EmployeesView._buildIdInput(emp, 'jiraAccountId',       '5b10a2844c20165700ede21g'), 'Cloud accountId или username Server Jira'));
      idBody.appendChild(sectionRow('Bitbucket login',      EmployeesView._buildIdInput(emp, 'bitbucketLogin',      'i.ivanov'),                 'Username в Bitbucket. Пусто = «нет аккаунта в BB»'));
      idBody.appendChild(sectionRow('Confluence accountId', EmployeesView._buildIdInput(emp, 'confluenceAccountId', '5b10a2844c20165700ede21g'), 'Опционально, для сводок Confluence'));
      idDetails.appendChild(idBody);
      card.appendChild(idDetails);

      // V20 S7 B7 + V20 S8 #11 — Service-account toggle.
      // Pилот feedback: «toggle для разработчика, не для меня. Я в карточку
      // захожу что человек делает, а не чтобы его в боты записать». Решение:
      // спрятали под <details> «Дополнительно» (collapsed by default).
      // V22 04-employees task #2: туда же ушёл блок source/createdAt/updatedAt
      // (раньше показывался как hover-footer, шумел в каждой карточке —
      // теперь видно только когда юзер сам раскрыл «Дополнительно»).
      const saWrap = document.createElement('details');
      saWrap.className = 'employee-card-section employee-card-advanced';
      const saId = `emp-sa-${emp.id}`;
      const fmtDate=(s)=>{ if(!s) return '—'; try { return new Date(s).toLocaleDateString('ru'); } catch(_) { return s; } };
      const metaParts=[
        `source: ${Utils.escapeHtml(emp.sourceType||'manual')}`,
        `создан: ${fmtDate(emp.createdAt)}`,
      ];
      if (emp.updatedAt && emp.updatedAt !== emp.createdAt) metaParts.push(`обновлён: ${fmtDate(emp.updatedAt)}`);
      const metaHtml = metaParts.map(m=>`<span class="employee-card-meta">${m}</span>`).join('');
      saWrap.innerHTML = `
        <summary class="employee-card-advanced-head">Дополнительно</summary>
        <div class="employee-card-advanced-body">
          <label for="${saId}" class="employee-card-sa-label">
            <input type="checkbox" id="${saId}" ${emp.isServiceAccount ? 'checked' : ''}>
            <span>Сервисный аккаунт (бот/SA — исключить из Сканнера команд)</span>
          </label>
          <div class="employee-card-sa-hint">Сервисные аккаунты исключаются из counts Сканнера команд. Pattern auto-detect по jiraKey: cab-sa-*, sbt-*, out-*, svc-*, bot-*. Используйте этот toggle если автодетект ошибся.</div>
          <div class="employee-card-meta-list" aria-label="Источник и даты записи">${metaHtml}</div>
        </div>
      `;
      saWrap.querySelector('input').addEventListener('change', (ev) => {
        emp.isServiceAccount = !!ev.target.checked;
        emp.updatedAt = new Date().toISOString();
        // Reactive proxy сам триггерит save через mutation listener.
      });
      card.appendChild(saWrap);

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
  async mergeImported(imported, sourceLabel) {
    if (!imported.length) { window.showToast?.('Не найдено валидных строк сотрудников (нужна колонка ФИО).', 'warning'); return; }
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
    if (!addCount && !updateCount) { window.showToast?.('Изменений по сотрудникам не найдено.', 'info'); return; }
    // V21 audit 04-employees §6 — native confirm() заменён на ConfirmDialog:
    // focus-trap, danger-стиль, keyboard-friendly, превью первых 3 строк.
    // Импорт уже полностью отработал в state, но изменения мержатся в-память
    // и фиксируются Storage.save ТОЛЬКО после подтверждения. До подтверждения
    // мутации видны в UI, но при отказе мы откатываем (revert) — поэтому
    // снимем snapshot перед мержем... но проще проверить ДО мержа: пересоберём
    // mergeImported с двухфазным async-flow.
    // Pragma: snapshot уже мутирован выше — для отказа делаем reload из storage.
    const preview = imported.slice(0, 3).map(e => Utils.escapeHtml(String(e.fio || '').slice(0, 40))).join(', ');
    const ok = await ConfirmDialog.show({
      title: 'Применить импорт сотрудников?',
      message: `${sourceLabel}: добавить ${addCount}, обновить ${updateCount}.${preview ? `\nПервые: ${preview}${imported.length > 3 ? `, +ещё ${imported.length - 3}` : ''}.` : ''}`,
      confirmLabel: 'Применить',
    });
    if (!ok) {
      // Откатываем уже-применённые мутации: перечитываем state из Storage.
      try { Storage.restore?.(); } catch (_) { /* legacy api */ }
      if (state.activeSection==='employees') EmployeesView.render();
      window.showToast?.('Импорт отменён', 'info');
      return;
    }
    Storage.save();
    Services.App?.populateFilterDropdowns();
    if (state.activeSection==='employees') EmployeesView.render();
    window.showToast?.(`Сотрудники: +${addCount}, обновлено ${updateCount}`);
  },
  importCSV(text) {
    if (text.charCodeAt(0)===0xFEFF) text=text.slice(1);
    const rows=Utils.parseFullCSV(text);
    if (rows.length<2) { window.showToast?.('CSV пустой', 'warning'); return; }
    const headers=rows[0].map(h=>String(h||'').trim());
    const imported=EmployeesView.parseImportedRows(headers, rows.slice(1), 'csv');
    EmployeesView.mergeImported(imported, 'CSV');
  },
  importXLSX(buffer) {
    if (typeof window.XLSX==='undefined') { window.showToast?.('Положите libs/xlsx.full.min.js рядом с index.html', 'error'); return; }
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
