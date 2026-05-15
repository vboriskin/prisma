'use strict';
/* ============================================================
   SUMMARY VIEW + METRICS VIEW + DIAGNOSTICS VIEW
   — v8_0 ES module
   (V21 tabs-consolidation вариант A — InsightsView retired,
    содержимое в views/dashboard.js DashboardView.renderSignals.)
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
import { renderPageHeader, renderHero, renderEmptyState, workTypeIcon } from '../app/prizmaUI.js';

const esc = (v) => Utils.escapeHtml(v);

/** Волна 3 — общий helper для prizma-page-header в section'ах. */
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

// ============================================================
// SUMMARY VIEW — REMOVED (П4-MS Wave 1, audit-2026-05-04/summary-metrics-redesign).
// Сводная свёрнута в Дашборд: 5/6 экспертов независимо подтвердили, что
// у Сводной 0 production-уникальных блоков после редизайна Дашборда.
// renderBrief / renderDetailed / renderBeautiful / renderSuperBeautiful
// удалены целиком (~320 строк). Последние три были dead code после V17.1 G1.
// ============================================================

// ============================================================
// METRICS VIEW
// ============================================================
// V18 (audit §07-tech-views #8) — sparkline magic numbers вынесены в const'ы:
//   sparkW = ширина viewBox SVG, sparkH = высота, sparkPad = inner padding.
//   Изменены только тут, в одном месте, чтобы не плодить magic в render().
const METRICS_SPARK_W = 440;
const METRICS_SPARK_H = 120;
const METRICS_SPARK_PAD = 16;

/* AUDIT-ART #6/#7/#8 — runtime-style-инжект для room-grouping, двухуровневого
   контрольного круга и нейтральной серой шкалы pie-релизов. Не правим styles.css
   во избежание конфликтов с другими агентами. Вызывается один раз при первом
   рендере MetricsView. */
function injectMetricsAuditArtStyles() {
  if (document.getElementById('audit-art-metrics-style')) return;
  const style = document.createElement('style');
  style.id = 'audit-art-metrics-style';
  style.textContent = `
    /* AUDIT-ART #6 — room-grouping в Метриках. Между room-блоками 32px, внутри
       room — однотонный single-column scroll с уменьшенным gap (12px). */
    .metrics-room-section { display: flex; flex-direction: column; gap: 12px; }
    .metrics-room-section + .metrics-room-section { margin-top: 32px; }
    .prizma-room-eyebrow {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .7px;
      text-transform: uppercase;
      color: var(--prizma-text-tertiary, var(--text-3));
      margin: 0 0 4px;
      font-variant-numeric: tabular-nums;
    }
    /* AUDIT-ART #7 — двухуровневый контрольный круг.
       Внутренний conic — solid on-course прогресс. Внешнее SVG-кольцо —
       drift + off-course нагрузка через stroke-dasharray. «Запас» убран.
       Двойной class-селектор повышает specificity над .metrics-control-ring
       из styles.css (width:180/height:180/display:flex), иначе fixed-size
       контейнер не превратится в position:relative-канву. */
    .metrics-control-ring.metrics-control-ring--two-level {
      position: relative;
      width: 100%;
      height: auto;
      aspect-ratio: 1 / 1;
      max-width: 220px;
      margin: 0 auto;
      display: block;
      box-shadow: none;
      background: transparent !important;
    }
    .metrics-control-ring--two-level .mcr-outer {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      transform: rotate(-90deg);
    }
    .metrics-control-ring--two-level .mcr-inner {
      position: absolute;
      inset: 14%;
      border-radius: 50%;
      background: conic-gradient(
        var(--prizma-on-course) 0 var(--mcr-progress, 0%),
        var(--prizma-on-course-bg, rgba(127, 232, 181, 0.12)) var(--mcr-progress, 0%) 100%
      );
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .metrics-control-ring--two-level .mcr-core {
      width: 70%;
      height: 70%;
      border-radius: 50%;
      background: var(--card, #1A1A22);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .metrics-control-ring--two-level .mcr-core strong {
      font-size: 24px;
      font-weight: 300;
      line-height: 1;
      color: var(--text-1);
    }
    .metrics-control-ring--two-level .mcr-core span {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .7px;
      text-transform: uppercase;
      color: var(--prizma-text-tertiary, var(--text-3));
    }
  `;
  document.head.appendChild(style);
}

export const MetricsView = {
  // V21 π7 A3 — splitTags унифицирован в Utils.splitTags (utils.js:332).
  // Локальная копия удалена; все обращения идут через Utils.splitTags.
  render() {
    _injectPrizmaHeader('section-metrics', 'metrics', 'Прогресс, нагрузка, риски — детально.');
    injectMetricsAuditArtStyles();
    const rows=FilterEngine.getFiltered();
    const wrap=document.getElementById('metrics-wrap');
    if (!wrap) return;
    if (!rows.length) {
      wrap.innerHTML=renderEmptyState({
        title: 'Данных пока нет',
        hint: 'Загрузите реестр или измените фильтры — и метрики появятся.',
      });
      return;
    }

    const done=rows.filter(r=>r.isDone).length;
    const blockers=rows.filter(r=>r.blockingDependency).length;
    const risky=rows.filter(r=>r.riskFlags&&r.riskFlags.length).length;
    const overtime=rows.filter(r=>r.hasOvertime).length;
    const inScope=rows.filter(r=>r.scopeStatus==='Да').length;
    const progress=rows.length?Math.round(done/rows.length*100):0;

    // V18 — release colors unified с dashboard.js через CSS-переменные
    // (audit §07-tech-views #8). См. styles.css :root --release-*-color.
    // AUDIT-ART #8 — релизы получают нейтральную серую шкалу разной светлоты
    // (text-secondary → text-tertiary через rgba). Signal-цвет (drift) остаётся
    // только за overtime-сегментом — он несёт смысл «риск/перегрев», а не
    // декорацию. «Без релиза» — самый светлый серый (наименее значимый).
    const releases=[
      {k:'1.20', has:'hasRelease120', c:'var(--prizma-text-secondary)'},
      {k:'1.21', has:'hasRelease121', c:'rgba(122, 122, 130, 0.78)'},
      {k:'1.22', has:'hasRelease122', c:'rgba(122, 122, 130, 0.55)'},
      {k:'OT', has:'hasOvertime', c:'var(--prizma-drift)'},
      {k:'Без релиза', has:'isUnassigned', c:'rgba(122, 122, 130, 0.32)'},
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
    rows.forEach(r=>Utils.splitTags(r.role).forEach(role=>{
      if(!rolesMap[role]) rolesMap[role]={total:0,done:0};
      rolesMap[role].total++;
      if(r.isDone) rolesMap[role].done++;
    }));
    const roles=Object.entries(rolesMap).map(([role,v])=>({
      role,total:v.total,done:v.done,p:v.total?Math.round(v.done/v.total*100):0,
    })).sort((a,b)=>b.total-a.total).slice(0,8);

    const assigneeMap={};
    rows.forEach(r=>Utils.splitTags(r.assignee).forEach(name=>{
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

    // V18 — scope colors через prizma signal-токены (audit §07-tech-views #8).
    const scopeMix=[
      {k:'Да',c:'var(--prizma-on-course)',n:rows.filter(r=>r.scopeStatus==='Да').length},
      {k:'Нет',c:'var(--prizma-text-tertiary)',n:rows.filter(r=>r.scopeStatus==='Нет').length},
      {k:'Треб. подтв.',c:'var(--prizma-drift)',n:rows.filter(r=>r.scopeStatus==='Требует подтверждения').length},
    ];
    const scopeTotal=Math.max(1,scopeMix.reduce((s,x)=>s+x.n,0));

    const qualitySignals=[
      {label:'Done без даты', value:doneNoDate, severity:doneNoDate>0?'high':'low'},
      {label:'OT без периода', value:rows.filter(r=>r.hasOvertime&&(!r.workPeriodStart||!r.workPeriodEnd)).length, severity:'high'},
      {label:'Без исполнителя', value:rows.filter(r=>!Utils.splitTags(r.assignee).length).length, severity:'medium'},
      {label:'Без категории', value:rows.filter(r=>!Utils.splitTags(r.category).length).length, severity:'medium'},
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
    // V21 Wave-3 — emoji-prefix заменён на line-glyph SVG (workTypeIcon).
    // P11.9 — единый visual-token для type-icon в metrics + gantt + picker.
    const wtIcon = (type) => workTypeIcon(type, { size: 14 });
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
    // TODO(V18+): унифицировать dayKey() с другими view'ями (registry.js, gantt.js
    // имеют похожие helpers). Локальная версия оставлена — не критично.
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
    // V18 (audit §07-tech-views #8) — sparkW/sparkH/sparkPad вынесены в const'ы
    // METRICS_SPARK_W/H/PAD в начале файла (line ~352).
    const sparkW=METRICS_SPARK_W, sparkH=METRICS_SPARK_H, sparkPad=METRICS_SPARK_PAD;
    const sparkMax=Math.max(1,...last14.map(x=>x.v));
    const sx=i=>sparkPad + ((sparkW-sparkPad*2)*(last14.length===1?0:i/(last14.length-1)));
    const sy=v=>sparkH-sparkPad-((sparkH-sparkPad*2)*(v/sparkMax));
    const sparkPath=last14.map((p,i)=>`${i?'L':'M'}${sx(i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(' ');
    const sparkArea=`${sparkPath} L${sx(last14.length-1).toFixed(1)},${sparkH-sparkPad} L${sx(0).toFixed(1)},${sparkH-sparkPad} Z`;

    // П4-MS Wave 5 — `opsSignals` массив удалён вместе с card-блоком ниже.
    // Все 6 ops-signals дублировали бывший `InsightsView.bySeverity` (4 точные
    // дубли high/medium + 1 low-уникальный «Покрытие done», 1 «Задач без
    // исполнителя»). После V21 tabs-consolidation (вариант A) полный обзор
    // сигналов живёт в Дашборде — DashboardView.renderSignals (#dashboard-signals).
    // Метрики сосредоточены на распределениях/трендах (pie / sla / sparkline /
    // control-ring / team-progress / dep-pressure / quality / load-balance).

    // П4 Sec 2 — `metrics-hero` (7 KPI-плиток) свёрнут на единый
    // `renderHero` с одним доминирующим прогрессом + 3 supporting.
    // Сигнал: on-course ≥75%, drift ≥45%, off-course иначе.
    const metricsSignal = progress >= 75 ? 'on-course' : progress >= 45 ? 'drift' : 'off-course';
    // Wave 3 — id-генератор для aria-labelledby на metrics-card title'ах.
    // Каждая карточка получает role="region" + aria-labelledby="<id>" для
    // навигации screen-reader'ом по logical landmarks.
    const cardId = (slug) => `metrics-card-title-${slug}`;
    // Wave 3 — helper для progressbar-разметки на .metrics-row-track. SR
    // получает «<label>: <value>%» в качестве контекста.
    const pbar = (label, valuenow) => `role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${valuenow}" aria-label="${Utils.escapeHtml(label)}: ${valuenow}%"`;

    /* AUDIT-ART #6 — карточки описаны как отдельные строки HTML, чтобы их
       можно было перетасовать между room'ами без переписывания шаблона.
       renderRoom() ниже принимает массив и заворачивает в room-section с
       eyebrow-заголовком. Внутри room — single-column flow (no grid). */
    const cardPie = `
      <div class="metrics-card" role="region" aria-labelledby="${cardId('pie')}">
        <div class="metrics-card-title" id="${cardId('pie')}">Распределение объёма</div>
        <div class="metrics-super-pie-wrap">
          <div class="metrics-super-pie" role="img" aria-label="Распределение объёма задач по релизам" style="--pie-stops:${pieStops};background:conic-gradient(var(--pie-stops))"></div>
        </div>
        <div class="metrics-super-legend">
          ${releases.map(r=>`<span class="metrics-super-pill"><i style="background:${r.c}"></i>${r.k}: <span class="metrics-num">${r.total}</span></span>`).join('')}
        </div>
      </div>`;

    const cardSla = `
      <div class="metrics-card" role="region" aria-labelledby="${cardId('sla')}">
        <div class="metrics-card-title" id="${cardId('sla')}">SLA сроков: сделано вовремя</div>
        <div class="metrics-sla">
          <div class="metrics-sla-main metrics-num" aria-live="polite" aria-atomic="true">${slaPct}%</div>
          <div class="mini-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${slaPct}" aria-label="SLA сроков: ${slaPct}%"><span style="width:${slaPct}%"></span></div>
          <div class="metrics-sla-meta">Вовремя: <span class="metrics-num">${onTimeDone}</span> · С опозданием: <span class="metrics-num">${lateDone}</span> · Без даты done: <span class="metrics-num">${doneNoDate}</span></div>
        </div>
      </div>`;

    const cardTeams = `
      <div class="metrics-card" role="region" aria-labelledby="${cardId('teams')}">
        <div class="metrics-card-title" id="${cardId('teams')}">Команды: прогресс и риски</div>
        <div class="metrics-rows">
          ${teams.map((t,i)=>`<div class="metrics-row">
            <div class="metrics-row-label">${Utils.escapeHtml(Utils.truncate(t.team||'—',18))}</div>
            <div class="metrics-row-track" ${pbar(`Команда ${t.team||'—'}: прогресс`, t.p)}><span class="metrics-row-fill" style="--p:${t.p};--d:${i*55}ms"></span></div>
            <div class="metrics-row-meta metrics-num">${t.p}% · ${t.blockers}/${t.risky}</div>
          </div>`).join('')}
        </div>
      </div>`;

    const cardRoles = `
      <div class="metrics-card" role="region" aria-labelledby="${cardId('roles')}">
        <div class="metrics-card-title" id="${cardId('roles')}">Роли: загрузка</div>
        <div class="metrics-rows">
          ${roles.length?roles.map((r,i)=>{
            // QA A2.4 — guard для rows.length=0 (теоретически roles.length>0
            // подразумевает rows>0, но защищаемся от NaN).
            const denom=rows.length||1;
            const rolePct=Math.max(8,Math.round(r.total/denom*100));
            return `<div class="metrics-row">
            <div class="metrics-row-label">${Utils.escapeHtml(Utils.truncate(r.role,18))}</div>
            <div class="metrics-row-track" ${pbar(`Роль ${r.role}: доля`, rolePct)}><span class="metrics-row-fill role" style="--p:${rolePct};--d:${i*55}ms"></span></div>
            <div class="metrics-row-meta metrics-num">${r.total}</div>
          </div>`;}).join(''):'<div class="empty-inline">Нет данных за выбранный период</div>'}
        </div>
      </div>`;

    const cardScope = `
      <div class="metrics-card" role="region" aria-labelledby="${cardId('scope')}">
        <div class="metrics-card-title" id="${cardId('scope')}">Распределение по scope</div>
        <div class="metrics-stack">
          <div class="metrics-stack-track" role="img" aria-label="Распределение задач по scope-статусам">
            ${scopeMix.map(s=>`<span class="metrics-stack-seg" style="width:${Math.round(s.n/scopeTotal*100)}%;background:${s.c}" title="${Utils.escapeHtml(s.k)}: ${s.n}"></span>`).join('')}
          </div>
          <div class="metrics-super-legend">
            ${scopeMix.map(s=>`<span class="metrics-super-pill"><i style="background:${s.c}"></i>${s.k}: <span class="metrics-num">${s.n}</span></span>`).join('')}
          </div>
        </div>
      </div>`;

    const cardTypes = `
      <div class="metrics-card" role="region" aria-labelledby="${cardId('types')}">
        <div class="metrics-card-title" id="${cardId('types')}">Нагрузка по типам работ</div>
        <div class="metrics-rows">
          ${typePortfolio.length?typePortfolio.map((t,i)=>{
            const typePct=Math.max(8,t.p);
            return `<div class="metrics-row">
            <div class="metrics-row-label"><span class="metrics-type-icon" aria-hidden="true">${wtIcon(t.type)}</span>${Utils.escapeHtml(Utils.truncate(t.type,18))}</div>
            <div class="metrics-row-track" ${pbar(`Тип ${t.type}: доля`, typePct)}><span class="metrics-row-fill role" style="--p:${typePct};--d:${i*45}ms"></span></div>
            <div class="metrics-row-meta metrics-num">${t.count}</div>
          </div>`;}).join(''):'<div class="empty-inline">Нет данных по типам работ</div>'}
        </div>
      </div>`;

    const cardDep = `
      <div class="metrics-card" role="region" aria-labelledby="${cardId('dep')}">
        <div class="metrics-card-title" id="${cardId('dep')}">Давление зависимостей по командам</div>
        <div class="metrics-rows">
          ${depByTeam.length?depByTeam.map((t,i)=>{
            const depPct=Math.max(6,t.pressure);
            return `<div class="metrics-row">
            <div class="metrics-row-label">${Utils.escapeHtml(Utils.truncate(t.team||'—',18))}</div>
            <div class="metrics-row-track" ${pbar(`Давление зависимостей: ${t.team||'—'}`, depPct)}><span class="metrics-row-fill" style="--p:${depPct};--d:${i*45}ms"></span></div>
            <div class="metrics-row-meta metrics-num">${t.pressure}%</div>
          </div>`;}).join(''):'<div class="empty-inline">Нет данных по командам</div>'}
        </div>
      </div>`;

    const cardPeople = `
      <div class="metrics-card" role="region" aria-labelledby="${cardId('people')}">
        <div class="metrics-card-title" id="${cardId('people')}">Исполнители: загрузка / сделано / овертайм</div>
        <div class="metrics-people">
          ${assignees.length?assignees.map((a,i)=>`<div class="metrics-person" style="--d:${i*35}ms">
            <div class="metrics-person-name">${Utils.escapeHtml(Utils.truncate(a.name,24))}</div>
            <div class="metrics-person-meta"><span class="metrics-num">${a.total}</span> задач · done <span class="metrics-num">${a.p}%</span> · OT <span class="metrics-num">${a.ot}</span> · риск <span class="metrics-num">${a.risky}</span></div>
          </div>`).join(''):'<div class="empty-inline">Нет данных по исполнителям</div>'}
        </div>
      </div>`;

    const cardBalance = `
      <div class="metrics-card" role="region" aria-labelledby="${cardId('balance')}">
        <div class="metrics-card-title" id="${cardId('balance')}">Баланс нагрузки команды</div>
        <div class="metrics-signals">
          <div class="metrics-signal ${loadConcentration>=25?'high':loadConcentration>=18?'medium':'low'}">
            <span>Концентрация нагрузки (топ-исполнитель)</span>
            <strong class="metrics-num">${loadConcentration}%</strong>
          </div>
          <div class="metrics-signal ${evenness<55?'high':evenness<75?'medium':'low'}">
            <span>Равномерность распределения</span>
            <strong class="metrics-num">${evenness}%</strong>
          </div>
          ${qualitySignals.map(s=>`<div class="metrics-signal ${s.severity}">
            <span>${Utils.escapeHtml(s.label)}</span>
            <strong class="metrics-num">${s.value}</strong>
          </div>`).join('')}
        </div>
      </div>`;

    const cardHealth = `
      <div class="metrics-card" role="region" aria-labelledby="${cardId('health')}">
        <div class="metrics-card-title" id="${cardId('health')}">Индекс здоровья релизов</div>
        <div class="metrics-rows">
          ${releaseHealth.map((r,i)=>{
            const healthPct=Math.max(6,r.score);
            return `<div class="metrics-row">
            <div class="metrics-row-label">${Utils.escapeHtml(r.k)}</div>
            <div class="metrics-row-track" ${pbar(`Здоровье релиза ${r.k}`, r.score)}><span class="metrics-row-fill" style="--p:${healthPct};--d:${i*40}ms"></span></div>
            <div class="metrics-row-meta metrics-num">${r.score}</div>
          </div>`;}).join('')}
        </div>
      </div>`;

    /* AUDIT-ART #7 — двухуровневый контрольный круг.
       Внутреннее кольцо (conic-gradient): solid on-course прогресс vs.
       прозрачный остаток on-course-bg. Внешнее SVG-кольцо: stroke-dasharray
       рисует drift (блокеры) и off-course (риски) поверх нейтральной канвы.
       «Запас» как сектор убран — он тривиально читается как «не закрашено». */
    const ringR = 46;        // радиус окружности в координатах SVG (viewBox 100×100)
    const ringC = 2 * Math.PI * ringR;
    const driftLen = ringC * (Math.min(100, blockerLoad) / 100);
    const offLen   = ringC * (Math.min(100, riskLoad) / 100);
    const ringRest = Math.max(0, 100 - riskLoad - blockerLoad);
    const cardRing = `
      <div class="metrics-card" role="region" aria-labelledby="${cardId('ring')}">
        <div class="metrics-card-title" id="${cardId('ring')}">Контрольный круг</div>
        <div class="metrics-control-ring-wrap">
          <div class="metrics-control-ring metrics-control-ring--two-level" role="img" aria-describedby="metrics-control-ring-legend" aria-label="Контрольный круг прогресса" style="--mcr-progress:${progress}%">
            <svg class="mcr-outer" viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="${ringR}" fill="none" stroke="var(--prizma-text-tertiary)" stroke-opacity=".22" stroke-width="6"/>
              <circle cx="50" cy="50" r="${ringR}" fill="none" stroke="var(--prizma-drift)" stroke-width="6" stroke-linecap="butt" stroke-dasharray="${driftLen.toFixed(2)} ${(ringC-driftLen).toFixed(2)}" stroke-dashoffset="0"/>
              <circle cx="50" cy="50" r="${ringR}" fill="none" stroke="var(--prizma-off-course)" stroke-width="6" stroke-linecap="butt" stroke-dasharray="${offLen.toFixed(2)} ${(ringC-offLen).toFixed(2)}" stroke-dashoffset="${(-driftLen).toFixed(2)}"/>
            </svg>
            <div class="mcr-inner" aria-hidden="true">
              <div class="mcr-core" aria-live="polite" aria-atomic="true">
                <strong class="metrics-num">${progress}%</strong>
                <span>прогресс</span>
              </div>
            </div>
          </div>
        </div>
        <div class="metrics-super-legend" id="metrics-control-ring-legend">
          <span class="metrics-super-pill"><i style="background:var(--prizma-on-course)"></i>Прогресс <span class="metrics-num">${progress}%</span></span>
          <span class="metrics-super-pill"><i style="background:var(--prizma-drift)"></i>Блокеры <span class="metrics-num">${blockerLoad}%</span></span>
          <span class="metrics-super-pill"><i style="background:var(--prizma-off-course)"></i>Риски <span class="metrics-num">${riskLoad}%</span></span>
          <span class="metrics-super-pill"><i style="background:var(--prizma-text-tertiary);opacity:.35"></i>Запас <span class="metrics-num">${ringRest}%</span></span>
        </div>
      </div>`;

    const cardTrend = `
      <div class="metrics-card" role="region" aria-labelledby="${cardId('trend')}">
        <div class="metrics-card-title" id="${cardId('trend')}">Тренд done за 14 дней</div>
        <div class="metrics-spark-wrap">
          <svg viewBox="0 0 ${sparkW} ${sparkH}" class="metrics-spark-svg metrics-canvas" role="img" aria-describedby="metrics-spark-foot" aria-label="Тренд завершённых задач за 14 дней">
            <path d="${sparkArea}" fill="var(--prizma-information-bg)"></path>
            <path d="${sparkPath}" fill="none" stroke="var(--prizma-information)" stroke-width="2.8" stroke-linecap="round"></path>
            ${last14.map((p,i)=>`<circle cx="${sx(i).toFixed(1)}" cy="${sy(p.v).toFixed(1)}" r="2.6" fill="var(--prizma-information)"></circle>`).join('')}
          </svg>
          <div class="metrics-spark-foot" id="metrics-spark-foot">
            <span class="metrics-num">${last14[0].label}</span>
            <strong><span class="metrics-num">${last14.reduce((s,x)=>s+x.v,0)}</span> done</strong>
            <span class="metrics-num">${last14[last14.length-1].label}</span>
          </div>
        </div>
      </div>`;

    /* AUDIT-ART #6 — renderRoom: оборачивает массив карт в section с caps-eyebrow
       заголовком. Внутри room — single-column scroll (gap 12px), между room —
       32px пустоты (через .metrics-room-section + .metrics-room-section). */
    const renderRoom = (title, blocks) => `
      <section class="metrics-room-section" aria-label="${Utils.escapeHtml(title)}">
        <div class="prizma-room-eyebrow">${Utils.escapeHtml(title)}</div>
        ${blocks.join('')}
      </section>`;

    wrap.innerHTML = `
      <div class="metrics-room">
        ${renderHero({
          kpi: `${progress}%`,
          caption: 'СВОДКА МЕТРИК',
          signal: metricsSignal,
          supporting: [
            { num: done,     label: 'ВЫПОЛНЕНО' },
            { num: blockers, label: 'БЛОКЕРОВ' },
            { num: overtime, label: 'ОВЕРТАЙМ' },
          ],
        })}

        ${renderRoom('Распределение', [cardPie, cardScope, cardTypes])}
        ${renderRoom('Команды и люди', [cardTeams, cardRoles, cardDep, cardBalance, cardPeople])}
        ${renderRoom('Тренды', [cardSla, cardTrend, cardRing, cardHealth])}
      </div>
    `;

    // Wave 3 — hero-KPI в Метриках обновляется при refresh (число `progress%`).
    // `renderHero` — общий helper (не правим), поэтому aria-live навешиваем
    // post-render через querySelector. Для SR: поллинг-обновлений не будет —
    // просто корректное проговаривание новой цифры при следующем render().
    const heroKpi = wrap.querySelector('.prizma-hero-kpi');
    if (heroKpi) {
      heroKpi.setAttribute('aria-live', 'polite');
      heroKpi.setAttribute('aria-atomic', 'true');
    }

    // Wave 4 — Motion для Метрик (audit-2026-05-04 §2.4).
    // Emerge stagger 50ms на ~12 .metrics-card + hero-kpi emerge через 60ms.
    // Хелпер _stagger локальный (не импортируем из dashboard.js — там private).
    MetricsView._stagger(wrap.querySelectorAll('.metrics-card'), 50);
    if (heroKpi) MetricsView._emergeWithDelay(heroKpi, 60);
  },

  /* Wave 4 motion-helper. Аналог DashboardView._stagger — локальная копия,
     чтобы не нарушать инкапсуляцию между views. Снимает .is-emerging +
     animation-delay по `animationend`, чтобы не блокировать последующие
     transitions (hover etc.). */
  _stagger(nodes, stepMs) {
    nodes.forEach((node, i) => {
      node.style.animationDelay = (i * stepMs) + 'ms';
      node.classList.add('is-emerging');
      const onEnd = () => {
        node.classList.remove('is-emerging');
        node.style.animationDelay = '';
        node.removeEventListener('animationend', onEnd);
      };
      node.addEventListener('animationend', onEnd);
    });
  },

  /* Wave 4 — одиночный Emerge с фиксированной задержкой (для hero-kpi). */
  _emergeWithDelay(node, delayMs) {
    if (!node) return;
    node.style.animationDelay = delayMs + 'ms';
    node.classList.add('is-emerging');
    const onEnd = () => {
      node.classList.remove('is-emerging');
      node.style.animationDelay = '';
      node.removeEventListener('animationend', onEnd);
    };
    node.addEventListener('animationend', onEnd);
  },
};

// ============================================================
// INSIGHTS VIEW — REMOVED V21 tabs-consolidation (вариант A,
// audit-2026-05-V21-tabs/02-insights.md). Содержимое переехало в
// `views/dashboard.js` — DashboardView.renderSignals (room «Сигналы»).
// ============================================================

// ============================================================
// DIAGNOSTICS VIEW
// ============================================================
export const DiagnosticsView = {
  render() {
    _injectPrizmaHeader('section-diagnostics', 'diagnostics', 'Состояние интеграций и parser-уведомлений.');
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
