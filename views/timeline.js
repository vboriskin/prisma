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
import { renderPageHeader, prizmaEmptyGlyph } from '../app/prizmaUI.js';
// AUDIT-ART #15 — _wtColors (Tailwind-rainbow hex) заменён на единые
// brand-токены из constants.js, чтобы Timeline и Гант говорили на одном
// визуальном языке. PHASE_COLOR_TOKENS — для CSS (поддерживают theme),
// PHASE_COLORS — fallback для inline-стилей где CSS-var не резолвится
// (SVG-attributes, экспорты).
import { PHASE_COLOR_TOKENS, PHASE_COLORS } from '../constants.js';
import { Services } from '../app/services.js';

/* AUDIT-ART #15 — runtime style-инжект для Timeline.
   styles.css не правится (параллельные агенты конфликтуют).
   Идемпотентно: повторные вызовы no-op. */
function injectTimelineAuditArtStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('audit-art-timeline-style')) return;
  const style = document.createElement('style');
  style.id = 'audit-art-timeline-style';
  style.textContent = `
/* AUDIT-ART #15 — tabular-nums на численных подписях Timeline для выравнивания
   стадий-счётчиков и команд-счётчиков. */
.timeline-stat,
.timeline-row-count,
.timeline-team-count,
.timeline-stage-dates {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1, "lnum" 1;
}
`;
  document.head.appendChild(style);
}

function _injectPrizmaHeader(sectionId, prizmaSectionKey, sub) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const hostId = sectionId + '-prizma-header';
  let host = section.querySelector('#' + hostId);
  if (!host) {
    host = document.createElement('div');
    host.id = hostId;
    section.insertBefore(host, section.firstChild);
  }
  host.innerHTML = renderPageHeader(prizmaSectionKey, sub ? { sub } : {});
}

export const TimelineView = {
  render() {
    _injectPrizmaHeader('section-timeline', 'timeline', 'Хронология эпиков по релизам.');
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
  /* AUDIT-ART #15 (CRITICAL) — _wtColors (Tailwind rainbow hex) удалён.
     Возвращаем CSS-var-токен через PHASE_COLOR_TOKENS, fallback —
     `--prizma-text-tertiary` для незнакомого worktype. Использование
     CSS-токена в `style="background: var(--prizma-worktype-be)"` корректно
     (это CSS-context, var() резолвится). Для случаев, где требуется чистый
     hex (SVG-атрибут, inline-export — здесь не используется), есть
     `_wtColorHex(wt)`. */
  _wtColor(wt) {
    return PHASE_COLOR_TOKENS[wt] || 'var(--prizma-text-tertiary, #94a3b8)';
  },
  _wtColorHex(wt) {
    return PHASE_COLORS[wt] || '#94a3b8';
  },
  _wtClassMap:{
    'backend':'timeline-wt-backend','frontend':'timeline-wt-frontend','тестирование':'timeline-wt-testing',
    'аналитика':'timeline-wt-analytics','бизнес аналитика':'timeline-wt-banalytics','внедрение':'timeline-wt-impl',
    'миграция данных':'timeline-wt-migration','стабилизация':'timeline-wt-stabilization','хотфикс':'timeline-wt-hotfix',
  },
  renderSummary() {
    // AUDIT-ART #15 — runtime style-инжект (idempotent).
    injectTimelineAuditArtStyles();
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
    // AUDIT-ART #15 — было `wc=TimelineView._wtColors[wt]`, теперь
    // через `TimelineView._wtColor(wt)` → CSS-var из PHASE_COLOR_TOKENS.
    const wc=(wt)=>TimelineView._wtColor(wt);

    const countSection=`<div class="timeline-section"><div class="timeline-section-title">Количество задач по стадиям</div>
      <div class="timeline-stages">${stageData.map(s=>`
        <div class="timeline-stage">
          <div class="timeline-stage-header ${s.stageCls}">${s.label}<br><span class="timeline-stage-dates">${s.dates}</span></div>
          <div class="timeline-stage-body">
            <div class="timeline-stat">${s.count}</div>
            <div class="timeline-stat-sub">задач${s.doneCount?` / ${s.doneCount} <span class="signal-dot signal-on-course" role="img" aria-label="Сделано"></span>`:''}</div>
            <div class="timeline-stage-progress" role="img" aria-label="${s.label}: ${s.count} задач">
              <div class="${s.stageCls} timeline-stage-progress-fill" style="width:${s.count/maxC*100}%"></div>
            </div>
          </div></div>`).join('')}</div></div>`;

    const wtSection=allWt.length?`<div class="timeline-section"><div class="timeline-section-title">По типу работ</div>
      ${stageData.map(s=>{const tot=Object.values(s.wtMap).reduce((a,b)=>a+b,0)||1;
        return`<div class="timeline-row">
          <div class="timeline-row-label">${s.label}</div>
          <div class="timeline-bar-wrap timeline-row-bar" role="img" aria-label="${s.label}: ${s.count} задач">${allWt.map(wt=>{const c=s.wtMap[wt]||0;if(!c)return'';return`<div class="timeline-bar-seg" title="${wt}: ${c}" aria-label="${wt}: ${c}" style="width:${c/tot*100}%;background:${wc(wt)}"></div>`;}).join('')}</div>
          <div class="timeline-row-count">${s.count}</div></div>`;}).join('')}
      <div class="timeline-legend">${allWt.map(wt=>`<div class="legend-item"><div class="legend-dot ${TimelineView._wtClassMap[wt]||'timeline-wt-other'}"></div>${wt}</div>`).join('')}</div></div>`:'' ;

    const scopeSection=`<div class="timeline-section"><div class="timeline-section-title">По статусу Scope</div>
      ${stageData.map(s=>{const tot=s.count||1;
        return`<div class="timeline-row">
          <div class="timeline-row-label">${s.label}</div>
          <div class="timeline-bar-wrap timeline-row-bar" role="img" aria-label="${s.label}: ${s.count} задач">
            ${[['Да','timeline-scope-bar-yes'],['Нет','timeline-scope-bar-no'],['Требует подтверждения','timeline-scope-bar-pending']].map(([sc,cls])=>{const c=s.scMap[sc]||0;if(!c)return'';return`<div class="timeline-bar-seg timeline-scope-bar ${cls}" title="${sc}: ${c}" aria-label="${sc}: ${c}" style="width:${c/tot*100}%"></div>`;}).join('')}
          </div>
          <div class="timeline-row-count">${s.count}</div></div>`;}).join('')}
      <div class="timeline-legend"><div class="legend-item"><div class="legend-dot timeline-scope-bar timeline-scope-bar-yes"></div>Да</div><div class="legend-item"><div class="legend-dot timeline-scope-bar timeline-scope-bar-no"></div>Нет</div><div class="legend-item"><div class="legend-dot timeline-scope-bar timeline-scope-bar-pending"></div>Треб.</div></div></div>`;

    document.getElementById('timeline-wrap').innerHTML=countSection+wtSection+scopeSection;
  },
  renderDetailed() {
    // AUDIT-ART #15 — runtime style-инжект (idempotent).
    injectTimelineAuditArtStyles();
    const filtered=FilterEngine.getFiltered();
    const stages=TimelineView._stages();
    const teams=Utils.unique(filtered.map(r=>r.team));
    // AUDIT-ART #15 — token-based color resolver вместо hardcoded hex map.
    const wc=(wt)=>TimelineView._wtColor(wt);
    if (!teams.length) { document.getElementById('timeline-wrap').innerHTML=`<div class="empty-state">${prizmaEmptyGlyph()}<div class="empty-title">Нет данных</div></div>`; return; }

    const html=stages.map(stage=>{
      const stageRows=filtered.filter(stage.filter);
      const maxTeamCount=Math.max(...teams.map(t=>stageRows.filter(r=>r.team===t).length),1);
      const teamRows=teams.map(team=>{
        const tr=stageRows.filter(r=>r.team===team), cnt=tr.length;
        if(!cnt)return`<div class="timeline-team-row"><div class="timeline-team-label">${Utils.truncate(team,18)}</div><div class="timeline-team-bars"><div class="timeline-team-bar-cell"><div class="timeline-team-bar-inner"><div class="timeline-bar-empty timeline-bar-empty-muted"></div></div></div></div><div class="timeline-team-count">—</div></div>`;
        // Work type breakdown
        const wtMap={}; if(stage.tf)tr.forEach(r=>(r[stage.tf]||[]).forEach(t=>{wtMap[t]=(wtMap[t]||0)+1;}));
        const tot=Object.values(wtMap).reduce((a,b)=>a+b,0)||1;
        const segs=Object.entries(wtMap).map(([wt,c])=>`<div class="timeline-bar-seg" title="${wt}: ${c}" aria-label="${wt}: ${c}" style="width:${c/tot*100}%;background:${wc(wt)}"></div>`).join('');
        const done=tr.filter(r=>r.isDone).length;
        const barW=cnt/maxTeamCount*100;
        return`<div class="timeline-team-row">
          <div class="timeline-team-label">${Utils.truncate(team,18)}</div>
          <div class="timeline-team-bars"><div class="timeline-team-bar-cell timeline-team-bar-cell-rel">
            <div class="timeline-team-bar-outer" style="width:${barW}%;min-width:${cnt?'4px':'0'}" role="img" aria-label="${stage.label} / ${team}: ${cnt} задач">
              <div class="timeline-team-bar-inner">${segs||`<div class="timeline-bar-empty"></div>`}</div>
            </div>
          </div></div>
          <div class="timeline-team-count">${cnt}${done?` / ${done}<span class="signal-dot signal-on-course" role="img" aria-label="Сделано"></span>`:''}</div></div>`;
      }).join('');
      return`<div class="timeline-section"><div class="timeline-section-title timeline-section-title-detailed">
        <span class="chip ${stage.stageCls} timeline-stage-chip">${stage.label}</span>
        ${stage.dates} — ${stageRows.length} задач
      </div>${teamRows||'<div class="timeline-empty-stage">Нет задач в этой стадии</div>'}</div>`;
    }).join('');
    document.getElementById('timeline-wrap').innerHTML=html;
  },
};

export const PodlozhkaView = {
  render() {
    _injectPrizmaHeader('section-podlozhka', 'podlozhka', 'Подложка планёрок: артефакт квартального планирования.');
    const filtered=FilterEngine.getFiltered();
    const groupBy=state.podlozhkaGroup;
    const badge=document.getElementById('podlozhka-badge');
    badge.textContent=`${filtered.length} задач`;
    const wrap=document.getElementById('podlozhka-wrap');
    if (!filtered.length) { wrap.innerHTML=`<div class="empty-state">${prizmaEmptyGlyph()}<div class="empty-title">Нет данных</div></div>`; return; }

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
        const cols=Services.RegistryView?.getVisibleCols()||[];
        const headers=cols.map(c=>state.colLabels[c.key]||c.label);
        const format=(r,c)=>{
          const v=r[c.key];
          if (c.key==='tasks') return `<div class="pod-tasks">${RH.jiraTagsHtml(v||'')}</div>`;
          if (Array.isArray(v)) return v.length?v.join(', '):'—';
          if (typeof v==='boolean') return v?'Да':'Нет';
          if (c.type==='scope') return RH.scopeChip(v);
          if (c.type==='multiselect') return RH.workTypeChips(v||[]);
          // QA A6.1 — escape user-supplied date strings (Жesthetic: они обычно
          // dd.mm.yyyy, но через интеграции могут прилететь произвольные
          // символы; без escape — потенциальный XSS-вектор).
          if (c.key==='isDone') return r.isDone?`<span class="chip chip-done"><span class="signal-dot signal-on-course"></span>${r.doneDate?' '+Utils.escapeHtml(r.doneDate):''}</span>`:'—';
          if (c.key==='blockingDependency') return r.blockingDependency?`<span class="chip chip-red"><span class="signal-dot signal-off-course"></span>${r.blockingDeadline?' '+Utils.escapeHtml(r.blockingDeadline):''}</span>`:'—';
          return Utils.escapeHtml(String(v==null||v===''?'—':v));
        };
        return `<div class="podlozhka-table-wrap"><table class="podlozhka-table">
          <thead><tr>${headers.map(h=>`<th>${Utils.escapeHtml(h)}</th>`).join('')}<th>Риски</th></tr></thead>
          <tbody>${rows.map(r=>{
            const riskCls=r.riskFlags&&r.riskFlags.length?' pod-risky':'';
            const doneCls=r.isDone?' pod-done':'';
            return `<tr class="${riskCls}${doneCls}">${cols.map(c=>`<td>${format(r,c)}</td>`).join('')}<td>${RH.riskBadges(r.riskFlags)||'—'}</td></tr>`;
          }).join('')}</tbody>
        </table></div>`;
      }
      return String(sht`<div class="podlozhka-table-wrap"><table class="podlozhka-table">
        <thead><tr><th>Эпик</th><th>Задачи</th><th>Scope</th><th>Релизы</th><th>Тип работ</th><th>Роль</th><th>Риски</th><th>Блокер</th><th>Сделано</th><th>Комментарий</th></tr></thead>
        <tbody>${rows.map(r => {
          const allTypes = [...r.release120Types, ...r.release121Types, ...r.release122Types, ...r.overtimeTypes];
          const cls = (r.riskFlags && r.riskFlags.length ? 'pod-risky ' : '') + (r.isDone ? 'pod-done' : '');
          return sht`<tr class="${cls.trim()}">
            <td class="pod-cell-epic">${r.epic || '—'}</td>
            <td class="pod-cell-tasks"><div class="pod-tasks">${RH.jiraTagsHtml(r.tasks)}</div></td>
            <td>${RH.scopeChip(r.scopeStatus)}</td>
            <td><div class="pod-release-chips">${RH.releaseChips(r)}</div></td>
            <td>${allTypes.length ? RH.workTypeChips(allTypes) : '—'}</td>
            <td>${r.role ? sht`<span class="chip chip-indigo">${Utils.truncate(r.role, 20)}</span>` : '—'}</td>
            <td>${RH.riskBadges(r.riskFlags) || '—'}</td>
            <td>${r.blockingDependency
                  ? sht`<span class="chip chip-red"><span class="signal-dot signal-off-course"></span>${r.blockingDeadline ? ' ' + r.blockingDeadline : ''}</span>`
                  : '—'}</td>
            <td>${r.isDone
                  ? sht`<span class="chip chip-done"><span class="signal-dot signal-on-course"></span>${r.doneDate ? ' ' + r.doneDate : ''}</span>`
                  : '—'}</td>
            <td class="pod-cell-comment">${Utils.truncate(r.comment, 60) || '—'}</td>
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
            ${doneCount?`<span><span class="signal-dot signal-on-course"></span> ${doneCount}</span>`:''}
            ${blockers?`<span><span class="signal-dot signal-off-course"></span> ${blockers}</span>`:''}
            ${risky?`<span><span class="signal-dot signal-drift"></span> ${risky}</span>`:''}
          </div>
        </div>
        ${tableHtml(rows)}</div>`;
    }).join('');
  },
};
