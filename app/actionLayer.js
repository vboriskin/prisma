'use strict';
/* ============================================================
   ActionLayer — bulk-action catalog (assign release, change scope,
   normalize assignees, recompute risks, …) with a per-action modal.

   Each entry in CATALOG describes:
     - id, cat (releases/scope/team/priority/risks/markup/export)
     - icon, name, desc, params[] (form-control schema)
     - mass:true means "ignores scope, runs on whole dataset"

   Cross-module deps via window globals:
     window.App          — refreshCurrentSection() after mutation
     window.showToast    — user feedback
   ============================================================ */

import { state } from '../state.js';
import { FilterEngine } from '../filters.js';
import { applyBulkAction, autoAssignRelease, normalizeAssignees, batchRiskRecompute, exportSelectedCSV } from '../dataStore.js';
import { renderPageHeader } from './prizmaUI.js';
import { Icons } from './icons.js';
import { Services } from './services.js';

const getFilteredRows = () => FilterEngine.getFiltered();

export const ActionLayer = {
  _activeCat: 'all',

  // AUDIT-ART #25 — каждое действие имеет `group`: 'replan' | 'scope' |
  //   'rollover' | 'cleanup'. Это «момент в курсе», не категория-as-cat.
  //   Cat остаётся как legacy-фильтр, но render группирует по group.
  CATALOG: [
    { id:'assign_release',      cat:'releases', group:'replan',   iconKey:'calendar',       name:'Назначить в релиз',       desc:'Привязать задачи к выбранному релизу с типами работ.',    params:[{key:'release',label:'Релиз',type:'select',opts:['120','121','122','ot']},{key:'types',label:'Типы работ',type:'multicheck',opts:['backend','frontend','тестирование','аналитика','бизнес аналитика','внедрение','миграция данных','стабилизация','хотфикс']}] },
    { id:'clear_release',       cat:'releases', group:'replan',   iconKey:'no-symbol',      name:'Снять все релизы',        desc:'Удалить привязку ко всем релизам у выбранных задач.',     params:[] },
    { id:'set_release_type',    cat:'releases', group:'replan',   iconKey:'wrench',         name:'Изменить типы работ',     desc:'Переназначить типы работ в конкретном релизе без смены самого релиза.', params:[{key:'release',label:'Релиз',type:'select',opts:['120','121','122','ot']},{key:'types',label:'Новые типы',type:'multicheck',opts:['backend','frontend','тестирование','аналитика','бизнес аналитика','внедрение','миграция данных','стабилизация','хотфикс']}] },
    { id:'auto_assign_release', cat:'releases', group:'replan',   iconKey:'sparkles',       name:'Авто-распределение',      desc:'Назначить в релиз все задачи без релиза (или все, если overwrite).', params:[{key:'release',label:'Релиз',type:'select',opts:['120','121','122','ot']},{key:'overwrite',label:'Перезаписать существующие',type:'checkbox'}], mass:true },
    { id:'set_scope',           cat:'scope',    group:'scope',    iconKey:'clipboard',      name:'Изменить статус объёма',  desc:'Установить "Да", "Нет" или "Требует подтверждения" у выбранных задач.', params:[{key:'scope',label:'Статус',type:'select',opts:['Да','Нет','Требует подтверждения']}] },
    { id:'mark_done',           cat:'scope',    group:'cleanup',  iconKey:'check-circle',   name:'Отметить готовыми',       desc:'Поставить флаг "Готово" и зафиксировать дату закрытия.', params:[] },
    { id:'unmark_done',         cat:'scope',    group:'scope',    iconKey:'rotate-ccw',     name:'Открыть задачи',          desc:'Снять флаг "Готово" с выбранных задач.',                  params:[] },
    { id:'set_done_date',       cat:'scope',    group:'cleanup',  iconKey:'calendar',       name:'Задать дату закрытия',    desc:'Вручную установить дату закрытия без изменения статуса.', params:[{key:'date',label:'Дата',type:'date'}] },
    { id:'set_assignee',        cat:'team',     group:'replan',   iconKey:'user',           name:'Назначить исполнителя',   desc:'Переназначить исполнителя у всех выбранных задач.',       params:[{key:'assignee',label:'Исполнитель',type:'assignee'}] },
    { id:'normalize_assignees', cat:'team',     group:'cleanup',  iconKey:'users',          name:'Нормализовать имена',     desc:'Привести имена исполнителей к единому регистру (убрать лишние пробелы).', params:[], mass:true },
    { id:'set_priority',        cat:'priority', group:'replan',   iconKey:'zap',            name:'Установить приоритет',    desc:'Назначить приоритет High / Medium / Low у выбранных задач.', params:[{key:'priority',label:'Приоритет',type:'select',opts:['high','medium','low']}] },
    { id:'set_business_value',  cat:'priority', group:'replan',   iconKey:'sparkles',       name:'Задать бизнес-ценность',  desc:'Установить числовой показатель ценности (0–100) для приоритизации.', params:[{key:'value',label:'Ценность (0–100)',type:'number',min:0,max:100}] },
    { id:'clear_blocker',       cat:'risks',    group:'replan',   iconKey:'shield',         name:'Снять блокер',            desc:'Убрать флаг blockingDependency и дату блокирующего дедлайна.', params:[] },
    { id:'add_risk_flag',       cat:'risks',    group:'scope',    iconKey:'alert-triangle', name:'Добавить флаг риска',     desc:'Вручную добавить специфический флаг риска к задачам.',   params:[{key:'flag',label:'Тип риска',type:'select',opts:['IN_SCOPE_WITHOUT_RELEASE','CONFIRMATION_IN_RELEASE','OVERDUE_DEADLINE','CUSTOM_RISK']}] },
    { id:'remove_risk_flags',   cat:'risks',    group:'cleanup',  iconKey:'trash',          name:'Снять флаги риска',       desc:'Удалить все или конкретный флаг риска у выбранных задач.', params:[{key:'flag',label:'Флаг (пусто = все)',type:'select',opts:['','IN_SCOPE_WITHOUT_RELEASE','CONFIRMATION_IN_RELEASE','OVERDUE_DEADLINE','CUSTOM_RISK']}] },
    { id:'batch_risk_recompute',cat:'risks',    group:'scope',    iconKey:'rotate-cw',      name:'Пересчитать риск-скоры',  desc:'Принудительно пересчитать Risk Score для всех задач в реестре.', params:[], mass:true },
    { id:'set_comment',         cat:'markup',   group:'scope',    iconKey:'message-square', name:'Добавить заметку',        desc:'Дописать или заменить текстовую заметку у выбранных задач.', params:[{key:'comment',label:'Заметка',type:'textarea'},{key:'append',label:'Добавить (не заменять)',type:'checkbox'}] },
    { id:'flag_review',         cat:'markup',   group:'scope',    iconKey:'search',         name:'Отметить для ревью',      desc:'Поставить маркер "требует ревью" с опциональной заметкой.', params:[{key:'note',label:'Причина (опционально)',type:'text'}] },
    { id:'unflag_review',       cat:'markup',   group:'cleanup',  iconKey:'check',          name:'Снять метку ревью',       desc:'Убрать флаг "требует ревью" с выбранных задач.',          params:[] },
    { id:'reset_row',           cat:'markup',   group:'cleanup',  iconKey:'rotate-ccw',     name:'Сбросить к базовому',     desc:'Снять блокеры, флаги риска, ревью и выставить приоритет Medium.', params:[] },
    { id:'export_selected_csv', cat:'export',   group:'cleanup',  iconKey:'upload',         name:'Экспорт в CSV',           desc:'Скачать выбранные (или все отфильтрованные) задачи в CSV-файл.', params:[], mass:true },
  ],

  CAT_LABELS: { all:'Все', releases:'Релизы', scope:'Объём', team:'Команда', priority:'Приоритет', risks:'Риски', markup:'Разметка', export:'Экспорт' },
  CAT_ICONS:  { all:'crosshair', releases:'calendar', scope:'clipboard', team:'users', priority:'zap', risks:'shield', markup:'tag', export:'upload' },

  // AUDIT-ART #25 — группировка по «моменту в курсе». Порядок — нарративный:
  //   планируем → сверяем → переносим → зачищаем.
  GROUP_ORDER: ['replan', 'scope', 'rollover', 'cleanup'],
  GROUP_LABELS: {
    replan:   'ПЕРЕПЛАНИРОВАТЬ',
    scope:    'СВЕРИТЬ SCOPE',
    rollover: 'ПЕРЕНЕСТИ РЕЛИЗ',
    cleanup:  'ЗАЧИСТИТЬ',
  },
  GROUP_HINTS: {
    replan:   'Сдвинуть задачи между релизами, переназначить исполнителей, снять блокеры.',
    scope:    'Подтвердить scope, добавить риск-флаги, пересчитать скоры, оставить заметку.',
    rollover: 'Перенести релиз целиком, объединить релизы. Редкий ритуал в конце цикла.',
    cleanup:  'Закрыть готовое, снять флаги, нормализовать имена, выгрузить в CSV.',
  },

  _resolveScope(scopeType, criteriaKey, criteriaVal) {
    switch (scopeType) {
      case 'all':      return state.rows.map(r=>r.id);
      case 'filtered': return getFilteredRows().map(r=>r.id);
      case 'selected': return [...state.bulkSelected];
      case 'criteria': return ActionLayer._byCriteria(criteriaKey, criteriaVal);
      // AUDIT_HOLISTIC §5.1 — новый scope, читает state.meta.focus.
      // Если focus.kind === 'employee' → фильтр по assignee (substring match
      // local-part email или ФИО). Если focus null — пустой scope.
      case 'focus':    return ActionLayer._byFocus();
      default:         return [];
    }
  },
  _byFocus() {
    const focus = state?.meta?.focus;
    if (!focus || focus.kind !== 'employee' || !focus.id) return [];
    const id = String(focus.id);
    const idLc = id.toLowerCase();
    const localPart = id.includes('@') ? id.split('@')[0].toLowerCase() : idLc;
    // Identity-deterministic resolve через state.employees (email → ФИО).
    let needle = localPart;
    const emp = (state.employees || []).find(e =>
      (e.email && e.email.toLowerCase() === idLc),
    );
    if (emp && emp.fio) needle = emp.fio.toLowerCase();
    return state.rows
      .filter(r => (r.assignee || '').toLowerCase().includes(needle))
      .map(r => r.id);
  },
  _byCriteria(key, val) {
    if (!key || val === '') return [];
    return state.rows.filter(r => {
      if (key === 'release') return (r.release120Types?.length&&val==='120')||(r.release121Types?.length&&val==='121')||(r.release122Types?.length&&val==='122')||(r.overtimeTypes?.length&&val==='ot');
      if (key === 'assignee') return (r.assignee||'').toLowerCase().includes(val.toLowerCase());
      if (key === 'scope')    return r.scopeStatus === val;
      if (key === 'priority') return r.priority === val;
      if (key === 'no_release') return !r.release120Types?.length && !r.release121Types?.length && !r.release122Types?.length && !r.overtimeTypes?.length;
      if (key === 'blockers')   return !!r.blockingDependency;
      if (key === 'risky')      return (r.riskScore||0) >= 30;
      if (key === 'review_flag')return !!r._reviewFlag;
      return false;
    }).map(r=>r.id);
  },
  _scopeCount(scopeType, criteriaKey, criteriaVal) { return ActionLayer._resolveScope(scopeType, criteriaKey, criteriaVal).length; },

  runAction(actionDef, scopeType, criteriaKey, criteriaVal, params) {
    const ids = ActionLayer._resolveScope(scopeType, criteriaKey, criteriaVal);
    if (actionDef.id === 'auto_assign_release') {
      const n = autoAssignRelease(params.release, !!params.overwrite);
      state.actionLog.unshift({ id:Date.now(), type:actionDef.id, label:actionDef.name, count:n, at:new Date().toISOString(), simMode:state.simMode });
      if (state.actionLog.length > 200) state.actionLog.length = 200;
      ActionLayer.renderLog(); Services.App?.refreshCurrentSection?.(); return;
    }
    if (actionDef.id === 'normalize_assignees') {
      const n = normalizeAssignees();
      state.actionLog.unshift({ id:Date.now(), type:actionDef.id, label:actionDef.name, count:n, at:new Date().toISOString(), simMode:state.simMode });
      if (state.actionLog.length > 200) state.actionLog.length = 200;
      ActionLayer.renderLog(); Services.App?.refreshCurrentSection?.(); return;
    }
    if (actionDef.id === 'batch_risk_recompute') {
      const n = batchRiskRecompute();
      state.actionLog.unshift({ id:Date.now(), type:actionDef.id, label:actionDef.name, count:n, at:new Date().toISOString(), simMode:state.simMode });
      if (state.actionLog.length > 200) state.actionLog.length = 200;
      ActionLayer.renderLog(); Services.App?.refreshCurrentSection?.(); return;
    }
    if (actionDef.id === 'export_selected_csv') {
      const n = exportSelectedCSV(ids);
      state.actionLog.unshift({ id:Date.now(), type:actionDef.id, label:actionDef.name, count:n, at:new Date().toISOString(), simMode:false });
      if (state.actionLog.length > 200) state.actionLog.length = 200;
      ActionLayer.renderLog(); return;
    }
    if (!ids.length) { window.showToast?.('Нет задач в выбранной области.', 'warn'); return; }
    applyBulkAction(ids, actionDef.id, { ...params, _label: actionDef.name });
  },

  render() {
    // V17.1 I1 — «Журнал действий» больше не выводится в Action Layer:
    //   полностью дублировал вкладку «История». Каталог действий остаётся;
    //   `_renderLogPanel` оставлен в коде, но не вызывается. `renderLog`
    //   стал no-op'ом — ниже.
    ActionLayer._injectStyles();
    const section = document.getElementById('section-actions');
    if (section) {
      let host = section.querySelector('#actions-prizma-header');
      if (!host) {
        host = document.createElement('div');
        host.id = 'actions-prizma-header';
        section.insertBefore(host, section.firstChild);
      }
      // AUDIT_HOLISTIC §5.1 — sub читает state.meta.focus, если есть.
      const focus = state?.meta?.focus || null;
      const sub = (focus && focus.kind === 'employee' && focus.id)
        ? `Каталог действий для ${ActionLayer._displayFocus(focus)}.`
        : 'Каталог массовых действий: коррекция курса для всей команды.';
      host.innerHTML = renderPageHeader('actions', { sub });
    }
    const el = document.getElementById('al-main'); if (!el) return;
    el.innerHTML = ActionLayer._renderCatalog();
    ActionLayer._bindCatalog();
  },

  /** AUDIT_HOLISTIC §5.1 — human-label для focus в actions-header. */
  _displayFocus(focus) {
    if (!focus || !focus.id) return '';
    const id = String(focus.id);
    return (focus.kind === 'employee' && id.includes('@')) ? id.split('@')[0] : id;
  },
  _catFilter() {
    const cats = Object.keys(ActionLayer.CAT_LABELS);
    return `<div class="al-cat-bar">${cats.map(c=>`<button class="al-cat-btn${ActionLayer._activeCat===c?' active':''}" data-cat="${c}">${Icons.get(ActionLayer.CAT_ICONS[c], { size: 14 })} ${ActionLayer.CAT_LABELS[c]}</button>`).join('')}</div>`;
  },
  // AUDIT-ART #25 — render группами «момента в курсе» в reading column,
  //   не grid. Cat-filter оставлен — фильтрует поверх группировки. Если
  //   `_activeCat !== 'all'`, показываются только группы с подходящими
  //   действиями.
  _renderCatalog() {
    const cat = ActionLayer._activeCat;
    const items = cat==='all' ? ActionLayer.CATALOG : ActionLayer.CATALOG.filter(a=>a.cat===cat);

    // Группируем
    const byGroup = new Map();
    for (const a of items) {
      const g = a.group || 'cleanup';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(a);
    }

    const groups = ActionLayer.GROUP_ORDER
      .filter(g => byGroup.has(g) && byGroup.get(g).length)
      .map(g => {
        const list = byGroup.get(g);
        const rows = list.map(a => `
          <div class="al-action-row" data-action="${a.id}">
            <div class="al-action-row-icon">${Icons.get(a.iconKey || 'tag', { size: 18 })}</div>
            <div class="al-action-row-body">
              <div class="al-action-row-name">${a.name}${a.mass ? ' <span class="al-mass-badge">массовая</span>' : ''}</div>
              <div class="al-action-row-desc">${a.desc}</div>
            </div>
            <button class="btn btn-sm al-run-btn" data-action="${a.id}">Запустить →</button>
          </div>
        `).join('');
        return `<section class="al-group">
          <header class="al-group-head">
            <div class="al-group-eyebrow">${ActionLayer.GROUP_LABELS[g]}</div>
            <div class="al-group-hint">${ActionLayer.GROUP_HINTS[g] || ''}</div>
          </header>
          <div class="al-group-rows">${rows}</div>
        </section>`;
      }).join('');

    return `<div class="al-catalog-wrap">
      <div class="al-catalog-header">
        <h3 class="al-section-title">Каталог действий</h3>
        ${ActionLayer._catFilter()}
      </div>
      <div class="al-catalog-reading">${groups || '<div class="al-empty">Нет действий в этом разделе.</div>'}</div>
    </div>`;
  },
  _injectStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('audit-art-actionlayer-style')) return;
    const style = document.createElement('style');
    style.id = 'audit-art-actionlayer-style';
    style.textContent = `
      /* AUDIT-ART #25 — группировка по моменту, reading column */
      .al-catalog-reading {
        display: flex;
        flex-direction: column;
        gap: 32px;
        /* V19 fix — убран max-width: 760px (давал ~60% ширины колонки на широких экранах);
           reading-column остаётся читаемой за счёт inner-content max-width в group-rows. */
        margin: 16px 0 0;
      }
      .al-group {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .al-group-head { margin-bottom: 4px; }
      .al-group-eyebrow {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.7px;
        text-transform: uppercase;
        color: var(--prizma-text-tertiary, var(--text-3));
        margin-bottom: 4px;
      }
      .al-group-hint {
        font-size: 13px;
        color: var(--prizma-text-secondary, var(--text-3));
        line-height: 1.45;
      }
      .al-group-rows {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .al-action-row {
        display: grid;
        grid-template-columns: 32px 1fr auto;
        gap: 14px;
        align-items: center;
        /* V19 fix — padding-left уменьшен на 3px и компенсирован прозрачным
           border-left 3px (всегда), чтобы hover не сдвигал контент. */
        padding: 12px 16px 12px 13px;
        background: var(--card);
        border: 1px solid var(--border-light, var(--border));
        border-left: 3px solid transparent;
        border-radius: var(--radius, 8px);
        cursor: pointer;
        transition: border-color var(--motion-fast, 140ms) var(--ease-standard, ease);
      }
      .al-action-row:hover {
        border-left-color: var(--accent);
      }
      .al-action-row-icon {
        color: var(--prizma-text-secondary, var(--text-3));
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .al-action-row-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-1);
        margin-bottom: 2px;
      }
      .al-action-row-desc {
        font-size: 12px;
        color: var(--prizma-text-secondary, var(--text-3));
        line-height: 1.4;
      }
      .al-action-row .al-mass-badge {
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        color: var(--prizma-text-tertiary, var(--text-3));
        background: transparent;
        border: 1px solid var(--border-light, var(--border));
        padding: 1px 6px;
        border-radius: var(--radius-xs, 4px);
        margin-left: 6px;
        vertical-align: middle;
      }
      .al-empty {
        font-size: 13px;
        color: var(--prizma-text-tertiary, var(--text-3));
        padding: 24px 0;
      }
    `;
    document.head.appendChild(style);
  },
  _renderLogPanel() { return `<div class="al-log-wrap"><h3 class="al-section-title">Журнал действий</h3><div id="al-log-list">${ActionLayer._logHTML()}</div></div>`; },
  _logHTML() {
    if (!state.actionLog.length) return '<div class="al-log-empty">Действия ещё не применялись.</div>';
    return state.actionLog.slice(0,50).map(e=>{
      const dt = new Date(e.at).toLocaleString('ru',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'});
      return `<div class="al-log-entry${e.simMode?' al-log-sim':''}"><div class="al-log-meta"><span class="al-log-type">${e.label}</span><span class="al-log-count">${e.count} задач</span></div><div class="al-log-time">${dt}${e.simMode?' · симуляция':''}</div></div>`;
    }).join('');
  },
  // V17.1 I1 — теперь no-op: журнал не отображается в Action Layer (дублировал
  //   «Историю»). Все callers (Storage hooks etc.) могут вызывать без вреда.
  renderLog() { /* no-op — see V17.1 I1 */ },
  _bindCatalog() {
    const wrap = document.getElementById('al-main'); if (!wrap) return;
    wrap.querySelectorAll('.al-cat-btn').forEach(btn=>btn.addEventListener('click',()=>{ ActionLayer._activeCat=btn.dataset.cat; ActionLayer.render(); }));
    wrap.querySelectorAll('.al-run-btn').forEach(btn=>btn.addEventListener('click',e=>{ e.stopPropagation(); const actionDef=ActionLayer.CATALOG.find(a=>a.id===btn.dataset.action); if(actionDef)ActionLayer.openModal(actionDef); }));
    // AUDIT-ART #25 — row-click тоже открывает модалку (как раньше card-click).
    //   `.al-action-card` legacy-селектор удалён вместе с grid-разметкой.
    wrap.querySelectorAll('.al-action-row').forEach(row=>row.addEventListener('click',e=>{ if(e.target.closest('.al-run-btn'))return; const actionDef=ActionLayer.CATALOG.find(a=>a.id===row.dataset.action); if(actionDef)ActionLayer.openModal(actionDef); }));
  },
  openModal(actionDef) {
    const modal = document.getElementById('al-modal'); if (!modal) return;
    document.getElementById('al-modal-title').textContent = actionDef.name;
    document.getElementById('al-modal-desc').textContent = actionDef.desc;
    document.getElementById('al-modal-params').innerHTML = ActionLayer._renderParams(actionDef);
    ActionLayer._bindScopeCounter(actionDef);
    modal.classList.remove('hidden');
    document.getElementById('al-modal-apply').onclick = () => ActionLayer._applyModal(actionDef);
    document.getElementById('al-modal-cancel').onclick = () => modal.classList.add('hidden');
    modal.onclick = e => { if (e.target === modal) modal.classList.add('hidden'); };
  },
  _renderParams(actionDef) {
    // AUDIT_HOLISTIC §5.1 — добавляем «По фокусу» если активен focus-якорь.
    const focusScopeOpt = (() => {
      const focus = state?.meta?.focus;
      if (!focus || focus.kind !== 'employee' || !focus.id) return '';
      const n = ActionLayer._byFocus().length;
      const label = ActionLayer._displayFocus(focus);
      return `<option value="focus">По фокусу — ${label} (${n})</option>`;
    })();
    const scope = `<div class="al-param-row"><label class="al-param-label">Область применения</label><select id="al-scope-type" class="al-param-select">${focusScopeOpt ? focusScopeOpt + (focusScopeOpt ? ' ' : '') : ''}<option value="all">Все задачи (${state.rows.length})</option><option value="filtered">Отфильтрованные (${getFilteredRows().length})</option><option value="selected">Выбранные в реестре (${state.bulkSelected.size})</option><option value="criteria">По критерию →</option></select></div>
    <div id="al-criteria-row" class="al-param-row al-criteria-row hidden"><label class="al-param-label">Критерий</label><div style="display:flex;gap:6px;align-items:center"><select id="al-criteria-key" class="al-param-select"><option value="no_release">Без релиза</option><option value="blockers">Блокеры</option><option value="risky">Рискованные (score≥30)</option><option value="review_flag">Отмечены для ревью</option><option value="release">Релиз =</option><option value="scope">Статус объёма =</option><option value="priority">Приоритет =</option><option value="assignee">Исполнитель содержит</option></select><input id="al-criteria-val" class="al-param-input" style="width:120px" placeholder="значение"></div></div>
    <div class="al-param-row"><span class="al-scope-preview" id="al-scope-preview">→ задач: —</span></div>`;
    const paramFields = actionDef.params.map(p => {
      if (p.type==='select') return `<div class="al-param-row"><label class="al-param-label">${p.label}</label><select class="al-param-select" name="${p.key}">${p.opts.map(o=>`<option value="${o}">${o}</option>`).join('')}</select></div>`;
      if (p.type==='multicheck') return `<div class="al-param-row"><label class="al-param-label">${p.label}</label><div class="al-multicheck">${p.opts.map(o=>`<label class="al-check-item"><input type="checkbox" name="${p.key}" value="${o}" checked> ${o}</label>`).join('')}</div></div>`;
      if (p.type==='checkbox') return `<div class="al-param-row"><label class="al-param-label">${p.label}</label><input type="checkbox" name="${p.key}" style="width:16px;height:16px;cursor:pointer"></div>`;
      if (p.type==='textarea') return `<div class="al-param-row"><label class="al-param-label">${p.label}</label><textarea class="al-param-textarea" name="${p.key}" rows="3" placeholder="${p.label}"></textarea></div>`;
      if (p.type==='assignee') { const names=[...new Set(state.rows.map(r=>r.assignee).filter(Boolean))].sort(); return `<div class="al-param-row"><label class="al-param-label">${p.label}</label><input class="al-param-input" list="al-assignee-list" name="${p.key}" placeholder="Введите имя"><datalist id="al-assignee-list">${names.map(n=>`<option value="${n}">`).join('')}</datalist></div>`; }
      return `<div class="al-param-row"><label class="al-param-label">${p.label}</label><input class="al-param-input" type="${p.type||'text'}" name="${p.key}" placeholder="${p.label}"${p.min!=null?` min="${p.min}"`:''}${p.max!=null?` max="${p.max}"`:''}></div>`;
    }).join('');
    return scope + paramFields;
  },
  _bindScopeCounter(actionDef) {
    const upd = () => {
      const st=document.getElementById('al-scope-type')?.value||'all';
      const ck=document.getElementById('al-criteria-key')?.value||'';
      const cv=document.getElementById('al-criteria-val')?.value||'';
      const n=ActionLayer._scopeCount(st,ck,cv);
      const el=document.getElementById('al-scope-preview'); if(el)el.textContent=`→ задач: ${n}`;
      const crit=document.getElementById('al-criteria-row'); if(crit)crit.classList.toggle('hidden',st!=='criteria');
    };
    setTimeout(()=>{ document.getElementById('al-scope-type')?.addEventListener('change',upd); document.getElementById('al-criteria-key')?.addEventListener('change',upd); document.getElementById('al-criteria-val')?.addEventListener('input',upd); upd(); },0);
  },
  _applyModal(actionDef) {
    const modal=document.getElementById('al-modal');
    const st=document.getElementById('al-scope-type')?.value||'all';
    const ck=document.getElementById('al-criteria-key')?.value||'';
    const cv=document.getElementById('al-criteria-val')?.value||'';
    const params={};
    modal.querySelectorAll('[name]').forEach(el=>{
      if(el.type==='checkbox'){params[el.name]=el.checked;return;}
      params[el.name]=el.value;
    });
    actionDef.params.filter(p=>p.type==='multicheck').forEach(p=>{
      params[p.key]=[...modal.querySelectorAll(`input[name="${p.key}"]:checked`)].map(e=>e.value);
    });
    modal.classList.add('hidden');
    ActionLayer.runAction(actionDef,st,ck,cv,params);
  },
  init() {
    const close=()=>document.getElementById('al-modal')?.classList.add('hidden');
    document.getElementById('al-modal-cancel')?.addEventListener('click',close);
    document.getElementById('al-modal-cancel2')?.addEventListener('click',close);
  },
};

Services.register('ActionLayer', ActionLayer);
if (typeof window !== 'undefined') window.ActionLayer = ActionLayer;
