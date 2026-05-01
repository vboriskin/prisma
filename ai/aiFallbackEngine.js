'use strict';
/* ============================================================
   AI FALLBACK ENGINE — v10_0
   Rule-based analytics for the AI tab. Works 100% without LLM.
   All 13 blocks return a uniform { id, title, icon, score,
   status, summary, insights[], recommendations[], ... } shape.
   ============================================================ */

import { state }                       from '../state.js';
import { computeProgress, computeLoad } from '../metricsEngine.js';
import { computeHealthScore }           from '../chat/chatAlerts.js';

/* ── tiny helpers ──────────────────────────────────────────── */
const pct  = (n, d) => d ? Math.round(n / d * 100) : 0;
const act  = rows  => rows.filter(r => !r.isDone);
const rel  = (rows, key) => rows.filter(r => key === 'ot' ? r.hasOvertime : r[`hasRelease${key}`]);
const sev  = s => ({ critical: 0, warning: 1, info: 2, ok: 3 })[s] ?? 9;
const sortSev = arr => arr.slice().sort((a, b) => sev(a.severity) - sev(b.severity));

/* ── shared metrics (call once, pass to blocks) ─────────────── */
export function computeBaseMetrics(rows) {
  const total       = rows.length;
  const done        = rows.filter(r => r.isDone).length;
  const active      = total - done;
  const blockers    = rows.filter(r => r.blockingDependency && !r.isDone);
  const risky       = rows.filter(r => (r.riskFlags||[]).length && !r.isDone);
  const noRelease   = rows.filter(r => r.isUnassigned && r.scopeStatus === 'Да' && !r.isDone);
  const unconfirmed = rows.filter(r => r.scopeStatus === 'Требует подтверждения' && !r.isDone);
  const noTeam      = rows.filter(r => !r.team && !r.isDone);
  const noAssignee  = rows.filter(r => !r.assignee && !r.isDone);
  const overtime    = rows.filter(r => r.hasOvertime);

  const progress = computeProgress(rows);
  const load     = computeLoad(rows);
  const health   = computeHealthScore(rows);

  const teams = {};
  rows.forEach(r => {
    if (!r.team) return;
    if (!teams[r.team]) teams[r.team] = { total:0, done:0, blockers:0, risky:0 };
    teams[r.team].total++;
    if (r.isDone) teams[r.team].done++;
    if (r.blockingDependency && !r.isDone) teams[r.team].blockers++;
    if ((r.riskFlags||[]).length && !r.isDone) teams[r.team].risky++;
  });

  return {
    total, done, active, donePct: pct(done, total),
    blockers, risky, noRelease, unconfirmed, noTeam, noAssignee, overtime,
    progress, load, health, teams,
    topBlockers: [...blockers].sort((a,b)=>(b.riskScore||0)-(a.riskScore||0)).slice(0,10),
    topRisky:    [...risky].sort((a,b)=>(b.riskScore||0)-(a.riskScore||0)).slice(0,10),
  };
}

/* ══════════════════════════════════════════════════════════════
   1. AI Project Health Brain
   ════════════════════════════════════════════════════════════ */
export function computeProjectHealth(rows) {
  const m = computeBaseMetrics(rows);
  const score  = m.health;
  const status = score >= 80 ? 'ok' : score >= 60 ? 'risk' : 'critical';

  const problems = sortSev([
    m.blockers.length   && { title:`${m.blockers.length} активных блокеров`,            severity: m.blockers.length>=5?'critical':'warning', filter:{onlyBlocking:true} },
    m.noRelease.length  && { title:`${m.noRelease.length} задач в scope без релиза`,     severity: m.noRelease.length>=10?'warning':'info',    filter:{isUnassigned:true,scopeStatus:'Да'} },
    m.unconfirmed.length&& { title:`${m.unconfirmed.length} задач требуют подтверждения`,severity:'warning',                                   filter:{scope:'Требует подтверждения'} },
    m.risky.length      && { title:`${m.risky.length} рискованных задач`,                severity:'info',                                       filter:{onlyRisky:true} },
    m.overtime.length   && { title:`${m.overtime.length} задач в overtime`,              severity:'info',                                       filter:{release:'ot'} },
  ].filter(Boolean)).slice(0,5);

  const recommendations = [
    m.blockers.length    && { title:`Разблокировать ${m.blockers.length} задач`,                 impact:'high',   action:'Назначить ответственных за снятие блокеров',        filter:{onlyBlocking:true} },
    m.noRelease.length   && { title:`Распределить ${m.noRelease.length} задач в релизы`,         impact:'high',   action:'Расставить приоритеты и назначить релизные окна',    filter:{isUnassigned:true} },
    m.unconfirmed.length && { title:`Подтвердить scope (${m.unconfirmed.length} задач)`,         impact:'medium', action:'Провести сессию по уточнению scope',                 filter:{scope:'Требует подтверждения'} },
  ].filter(Boolean).slice(0,4);

  const summaryText = {
    ok:       `Проект в хорошем состоянии. Выполнено ${m.donePct}% задач, критических проблем нет.`,
    risk:     `Проект требует внимания. Выполнено ${m.donePct}%, есть ${m.blockers.length} блокеров и ${m.noRelease.length} задач без релиза.`,
    critical: `Проект в критическом состоянии. Health Score: ${score}. Требуется немедленное вмешательство.`,
  }[status];

  return {
    id:'health', title:'Здоровье проекта', icon:'🧠',
    score, status, summary: summaryText,
    insights:[
      `Выполнено ${m.done} из ${m.total} задач (${m.donePct}%)`,
      m.blockers.length ? `${m.blockers.length} активных блокеров требуют снятия` : 'Активных блокеров нет',
      m.noRelease.length ? `${m.noRelease.length} задач в scope не распределены по релизам` : 'Все in-scope задачи распределены',
      m.unconfirmed.length ? `${m.unconfirmed.length} задач требуют подтверждения scope` : 'Scope полностью подтверждён',
    ].filter(Boolean),
    problems, recommendations,
    filterPayload: null, confidence: m.total>0?'high':'low', aiEnhanced:false, _meta:m,
  };
}

/* ══════════════════════════════════════════════════════════════
   2. AI Forecast Engine
   ════════════════════════════════════════════════════════════ */
export function computeForecast(rows) {
  const releases = [{key:'120',label:'1.20'},{key:'121',label:'1.21'},{key:'122',label:'1.22'},{key:'ot',label:'Overtime'}];

  const forecasts = releases.map(({key,label}) => {
    const rr = rel(rows, key);
    if (!rr.length) return null;
    const total  = rr.length;
    const rdone  = rr.filter(r=>r.isDone).length;
    const active = total - rdone;
    const blk    = rr.filter(r=>r.blockingDependency && !r.isDone).length;
    const rsk    = rr.filter(r=>(r.riskFlags||[]).length && !r.isDone).length;
    const unconf = rr.filter(r=>r.scopeStatus==='Требует подтверждения' && !r.isDone).length;
    const donePct = pct(rdone, total);
    const penalty = Math.min(40, blk*8 + rsk*4 + unconf*3);
    const expected = Math.max(0, Math.min(100,
      active===0 ? 100 : donePct + Math.round((1 - penalty/100) * (100-donePct) * 0.45)));
    const factors = [blk&&`${blk} блокеров`, rsk&&`${rsk} рисков`, unconf&&`${unconf} неподтверждённых`].filter(Boolean);
    return { key, label, total, done:rdone, active, blk, rsk, unconf, donePct,
             expected, best:Math.min(100,expected+15), worst:Math.max(0,expected-Math.min(30,penalty)),
             factors, status: expected>=70?'ok':expected>=40?'risk':'critical' };
  }).filter(Boolean);

  const ovr = forecasts.length ? Math.round(forecasts.reduce((s,f)=>s+f.expected,0)/forecasts.length) : 50;
  const lowHistory = rows.filter(r=>r.isDone).length < rows.length * 0.1;

  return {
    id:'forecast', title:'Прогноз релизов', icon:'📈',
    score:ovr, status: ovr>=70?'ok':ovr>=40?'risk':'critical',
    summary: lowHistory
      ? 'Прогноз приблизительный: данных о завершённых задачах пока мало. Velocity не определён.'
      : `Средняя вероятность успешного закрытия релизов: ${ovr}%.`,
    insights: forecasts.map(f=>`${f.label}: ${f.expected}% (worst ${f.worst}%, best ${f.best}%)`),
    recommendations: forecasts.filter(f=>f.status!=='ok').map(f=>({
      title:`Улучшить прогноз для ${f.label}`,
      impact: f.status==='critical'?'high':'medium',
      action: f.blk>0 ? `Снять ${f.blk} блокеров` : `Подтвердить scope (${f.unconf} задач)`,
      filter: { release: f.key },
    })).slice(0,3),
    forecasts, filterPayload:null, confidence: lowHistory?'low':'medium', aiEnhanced:false,
  };
}

/* ══════════════════════════════════════════════════════════════
   3. If Nothing Changes
   ════════════════════════════════════════════════════════════ */
export function computeIfNothingChanges(rows) {
  const m = computeBaseMetrics(rows);
  const consequences = [];

  if (m.blockers.length>=3)    consequences.push({severity:'critical', text:`${m.blockers.length} блокеров останутся и продолжат задерживать зависимые задачи`});
  if (m.noRelease.length>=5)   consequences.push({severity:'warning',  text:`${m.noRelease.length} задач в scope по-прежнему не будут распределены по релизам`});
  if (m.unconfirmed.length>=3) consequences.push({severity:'warning',  text:`${m.unconfirmed.length} задач с неподтверждённым scope рискуют попасть в релиз без согласования`});

  // Most at-risk release
  let worstRel=null, worstScore=-1;
  ['120','121','122'].forEach(k=>{
    const rr=rel(rows,k); if(!rr.length) return;
    const sc = rr.filter(r=>r.blockingDependency&&!r.isDone).length*3 + rr.filter(r=>r.scopeStatus==='Требует подтверждения'&&!r.isDone).length*2;
    if(sc>worstScore){worstScore=sc; worstRel=k;}
  });
  if (worstRel && worstScore>0)
    consequences.push({severity:'warning', text:`Релиз 1.${worstRel} наиболее уязвим: блокеры и неподтверждённый scope могут вызвать задержку`});

  const overloaded = Object.entries(m.load).filter(([,v])=>v.total>=6).map(([n])=>n);
  if (overloaded.length)
    consequences.push({severity:'info', text:`${overloaded.length} исполнителей (${overloaded.slice(0,3).join(', ')}) продолжат работу в режиме перегруза`});

  if (!consequences.length)
    consequences.push({severity:'info', text:'Ситуация относительно стабильна. Активных угроз при текущих данных мало.'});

  const worstSev = consequences.some(c=>c.severity==='critical')?'critical':consequences.some(c=>c.severity==='warning')?'risk':'ok';
  return {
    id:'if_nothing_changes', title:'Если ничего не менять', icon:'⏳',
    score:null, status:worstSev,
    summary:`Если ничего не менять: ${consequences.filter(c=>c.severity!=='info').length} активных угрозы.`,
    insights: consequences.map(c=>c.text),
    recommendations:[
      m.blockers.length && {title:'Приоритет: снять блокеры',       impact:'high',   action:'Провести встречу по разблокированию критических задач', filter:{onlyBlocking:true}},
      m.noRelease.length && {title:'Распределить задачи без релиза', impact:'high',   action:'Назначить релизные окна для задач в scope',              filter:{isUnassigned:true}},
    ].filter(Boolean),
    filterPayload:null, confidence:'medium', aiEnhanced:false,
  };
}

/* ══════════════════════════════════════════════════════════════
   4. Dependency Graph Analyzer
   ════════════════════════════════════════════════════════════ */
export function computeDependencyAnalysis(rows) {
  const deps = state.epicDeps || {};
  const hasDeps = Object.keys(deps).length > 0;

  if (!hasDeps) {
    const textHints = rows.filter(r=>r.teamDependency||(r.comment&&/зависит|dependent|блокирует/i.test(r.comment)));
    return {
      id:'dependency', title:'Анализ зависимостей', icon:'🕸️',
      score:null, status:'info',
      summary:'Зависимости между эпиками не заданы. Обнаружены потенциальные зависимости по тексту.',
      insights:[
        'Граф зависимостей не настроен',
        textHints.length ? `${textHints.length} задач содержат упоминание зависимостей в полях teamDependency/comment` : 'Упоминаний зависимостей в текстовых полях не найдено',
        'Добавьте зависимости на вкладке Гант (режим "Зависимости")',
      ],
      recommendations:[{title:'Настроить зависимости', impact:'medium', action:'Используйте вкладку Гант для построения графа', filter:null}],
      filterPayload:null, confidence:'low', aiEnhanced:false,
    };
  }

  const nodes = new Set([...Object.keys(deps), ...Object.values(deps)]);
  const outDeg = {}, inDeg = {};
  nodes.forEach(n=>{outDeg[n]=0; inDeg[n]=0;});
  Object.entries(deps).forEach(([from,to])=>{outDeg[from]=(outDeg[from]||0)+1; inDeg[to]=(inDeg[to]||0)+1;});

  const keyNodes = Object.entries(outDeg).filter(([,d])=>d>=2).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([n,d])=>`"${n}" (${d} зависимых)`);
  const blockedEpics = new Set(rows.filter(r=>r.blockingDependency&&!r.isDone).map(r=>r.epic).filter(Boolean));
  const chainRisks = Object.entries(deps).filter(([from])=>blockedEpics.has(from)).map(([from,to])=>`${from} → ${to}`).slice(0,5);

  return {
    id:'dependency', title:'Анализ зависимостей', icon:'🕸️',
    score:null, status: chainRisks.length?'risk':'ok',
    summary:`Граф: ${nodes.size} узлов, ${Object.keys(deps).length} связей. ${chainRisks.length ? 'Обнаружены рискованные цепочки.' : 'Критических цепочек не найдено.'}`,
    insights:[
      `Всего зависимостей: ${Object.keys(deps).length}`,
      keyNodes.length ? `Ключевые узлы: ${keyNodes.join(', ')}` : 'Ключевых узлов (с множеством зависимых) нет',
      chainRisks.length ? `Рискованные цепочки: ${chainRisks.slice(0,3).join('; ')}` : 'Цепочек риска (блокер→зависимый) не найдено',
    ],
    recommendations: chainRisks.length ? [{title:'Снять блокеры в цепочках', impact:'high', action:'Разблокировать: '+chainRisks[0], filter:{onlyBlocking:true}}] : [],
    filterPayload:null, confidence:'high', aiEnhanced:false,
  };
}

/* ══════════════════════════════════════════════════════════════
   5. Smart Replanning
   ════════════════════════════════════════════════════════════ */
export function computeSmartReplanning(rows) {
  const m = computeBaseMetrics(rows);
  const scenarios = [
    { label:'Консервативный', icon:'🛡️', color:'blue',
      what:[`Перенести ${Math.ceil(m.noRelease.length*0.5)} наименее приоритетных задач без релиза в Overtime`,`Сосредоточиться на снятии ${m.blockers.length} блокеров`,`Зафиксировать scope 1.20 и не добавлять новые задачи`],
      affected: m.noRelease.length + m.blockers.length, risk:'Низкий', tradeoff:'Часть задач перейдёт в следующий релиз' },
    // V17.1 K1 — Conservative / Balanced / Aggressive → русские названия.
    { label:'Сбалансированный', icon:'⚖️', color:'green',
      what:[`Распределить ${m.noRelease.length} задач без релиза по 1.21 и 1.22`,`Параллельно снимать блокеры (${m.blockers.length})`,`Подтвердить scope для ${m.unconfirmed.length} неопределённых задач`],
      affected: m.noRelease.length+m.blockers.length+m.unconfirmed.length, risk:'Средний', tradeoff:'Требует активного управления и регулярных синков' },
    { label:'Агрессивный', icon:'🚀', color:'orange',
      what:['Добавить дополнительные ресурсы для параллельной работы',`Перевести все ${m.noRelease.length} задач в ближайшие релизы`,'Принять повышенный риск для ускорения доставки'],
      affected: m.total, risk:'Высокий', tradeoff:'Высокая нагрузка на команды, возможное снижение качества' },
  ];
  return {
    id:'replanning', title:'Сценарии перепланирования', icon:'🗺️',
    score:null, status:'info',
    summary:`3 сценария перепланирования для ${m.active} активных задач.`,
    insights: scenarios.map(s=>`${s.icon} ${s.label}: ${s.what[0]}`),
    recommendations:[], scenarios,
    filterPayload:null, confidence:'medium', aiEnhanced:false,
  };
}

/* ══════════════════════════════════════════════════════════════
   6. Bottleneck Finder
   ════════════════════════════════════════════════════════════ */
export function computeBottlenecks(rows) {
  const active = act(rows);
  const bottlenecks = [];

  // By team
  const ts = {};
  active.forEach(r=>{ if(!r.team) return; ts[r.team]=ts[r.team]||{total:0,blockers:0,risky:0}; ts[r.team].total++; if(r.blockingDependency)ts[r.team].blockers++; if((r.riskFlags||[]).length)ts[r.team].risky++; });
  Object.entries(ts).filter(([,s])=>s.blockers>0||s.risky>=3).sort((a,b)=>(b[1].blockers*3+b[1].risky)-(a[1].blockers*3+a[1].risky)).slice(0,3).forEach(([team,s])=>{
    bottlenecks.push({type:'team', label:`Команда ${team}`, reason:`${s.blockers} блокеров, ${s.risky} рискованных из ${s.total} активных`, severity:s.blockers>=3?'critical':'warning', filter:{team}});
  });

  // By assignee (overloaded)
  Object.entries(computeLoad(active)).filter(([,v])=>v.total>=6).sort((a,b)=>b[1].total-a[1].total).slice(0,3).forEach(([name,v])=>{
    bottlenecks.push({type:'assignee', label:`Исполнитель ${name}`, reason:`${v.total} задач (1.20:${v.r120} 1.21:${v.r121} 1.22:${v.r122})`, severity:v.total>=10?'critical':'warning', filter:{assignee:name}});
  });

  // By release
  ['120','121','122'].forEach(k=>{ const rr=rel(active,k); const blk=rr.filter(r=>r.blockingDependency).length; if(blk>=5) bottlenecks.push({type:'release',label:`Релиз 1.${k}`,reason:`${blk} блокеров из ${rr.length} активных (${pct(blk,rr.length)}%)`,severity:'warning',filter:{release:k,onlyBlocking:true}}); });

  if (!bottlenecks.length) bottlenecks.push({type:'none',label:'Критических узких мест не найдено',reason:'Нагрузка распределена равномерно',severity:'info',filter:null});

  const worstSev = bottlenecks.some(b=>b.severity==='critical')?'critical':bottlenecks.some(b=>b.severity==='warning')?'risk':'ok';
  return {
    id:'bottlenecks', title:'Узкие места', icon:'🔍',
    score:null, status:worstSev,
    summary:`Найдено ${bottlenecks.filter(b=>b.severity!=='info').length} узких мест.`,
    insights: bottlenecks.slice(0,5).map(b=>`${b.label}: ${b.reason}`),
    recommendations: bottlenecks.filter(b=>b.filter&&b.severity!=='info').slice(0,3).map(b=>({
      title:`Устранить: ${b.label}`, impact:b.severity==='critical'?'high':'medium', action:b.reason, filter:b.filter,
    })),
    bottlenecks, filterPayload:null, confidence:'high', aiEnhanced:false,
  };
}

/* ══════════════════════════════════════════════════════════════
   7. Risk Narrative Engine
   ════════════════════════════════════════════════════════════ */
export function computeRiskNarrative(rows) {
  const active = act(rows);
  const byFlag = {};
  active.forEach(r => (r.riskFlags||[]).forEach(f=>{ if(!byFlag[f])byFlag[f]=[]; byFlag[f].push(r); }));

  const flagDefs = {
    BLOCKING_NEAR_RELEASE:  (rs)=>({ title:'Блокеры в ближайших релизах',         story:`${rs.length} задач с активным блокером в 1.20 или 1.21. Каждый блокер создаёт цепочку задержек.`,              howToFix:'Назначить ответственных за каждый блокер, провести разблокировочную встречу.', filter:{onlyBlocking:true} }),
    IN_SCOPE_WITHOUT_RELEASE:(rs)=>({ title:'Scope без релиза',                    story:`${rs.length} задач помечены как "в scope", но не привязаны ни к одному релизному окну.`,                        howToFix:'Расставить приоритеты и распределить по 1.21, 1.22 или Overtime.',             filter:{isUnassigned:true,scopeStatus:'Да'} }),
    CONFIRMATION_IN_RELEASE: (rs)=>({ title:'Неподтверждённый scope в релизе',     story:`${rs.length} задач со статусом "Требует подтверждения" уже попали в релиз — риск изменений в последний момент.`,howToFix:'Срочно согласовать scope с PO/PM или перенести в бэклог.',                  filter:{scope:'Требует подтверждения'} }),
  };

  const narratives = Object.entries(byFlag)
    .filter(([f]) => flagDefs[f])
    .map(([f, rs]) => ({ flag:f, count:rs.length, ...flagDefs[f](rs) }));

  const risky = active.filter(r=>(r.riskFlags||[]).length);
  if (risky.length>=10 && !narratives.length)
    narratives.push({ flag:'general', count:risky.length, title:'Высокий общий уровень риска', story:`${risky.length} активных задач имеют флаги риска — возможно системная проблема планирования.`, howToFix:'Провести risk review с командой.', filter:{onlyRisky:true} });

  if (!narratives.length)
    narratives.push({ flag:'none', count:0, title:'Значимых рисков не обнаружено', story:'Текущий план выглядит чисто — флагов риска нет или их мало.', howToFix:'Продолжайте регулярный мониторинг.', filter:null });

  return {
    id:'risk_narrative', title:'Описание рисков', icon:'📖',
    score:null, status: narratives.some(n=>n.count>=5)?'risk':narratives.some(n=>n.count>0)?'info':'ok',
    summary:`${narratives.filter(n=>n.count>0).length} активных рисковых паттернов.`,
    insights: narratives.slice(0,4).map(n=>n.title+(n.count?` (${n.count} задач)`:'')),
    recommendations: narratives.filter(n=>n.filter&&n.count>0).slice(0,3).map(n=>({
      title:n.title, impact:n.count>=5?'high':'medium', action:n.howToFix, filter:n.filter,
    })),
    narratives, filterPayload:null, confidence:'high', aiEnhanced:false,
  };
}

/* ══════════════════════════════════════════════════════════════
   8. AI Prioritization Engine
   ════════════════════════════════════════════════════════════ */
export function computePrioritization(rows) {
  const active = act(rows);
  const scored = active.map(r => {
    let sc = r.riskScore||0;
    if (r.hasRelease120) sc+=25; else if (r.hasRelease121) sc+=15;
    if (r.blockingDependency) sc+=30;
    if (!r.assignee) sc+=10;
    if (r.scopeStatus==='Требует подтверждения') sc+=8;
    const reasons=[r.blockingDependency&&'блокер', r.hasRelease120&&'релиз 1.20', (r.riskFlags||[]).length&&(r.riskFlags||[]).slice(0,2).join(', '), !r.assignee&&'нет исполнителя'].filter(Boolean);
    return {...r, _sc:sc, _reasons:reasons};
  }).sort((a,b)=>b._sc-a._sc);
  const top10 = scored.slice(0,10);

  return {
    id:'prioritization', title:'Приоритизация задач', icon:'🎯',
    score:null, status:'info',
    summary:`Топ-${top10.length} задач, требующих немедленного внимания.`,
    insights: top10.slice(0,5).map(r=>`${r.epic||r.tasks||'—'}: ${r._reasons.join(', ')} (score ${r._sc})`),
    recommendations: top10.slice(0,3).map(r=>({
      title: r.epic||r.tasks||'—', impact:r._sc>=60?'high':'medium', action:r._reasons[0]||'Требует внимания', filter:{search:r.epic||r.tasks||''},
    })),
    topRows:top10, filterPayload:null, confidence:'high', aiEnhanced:false,
  };
}

/* ══════════════════════════════════════════════════════════════
   9. AI-generated Dashboard
   ════════════════════════════════════════════════════════════ */
export function computeDynamicDashboard(rows) {
  const m = computeBaseMetrics(rows);
  const cards = [];
  if (m.blockers.length)    cards.push({icon:'🚫',title:'Блокеры',     value:m.blockers.length,  label:'активных',   severity:m.blockers.length>=5?'critical':'warning', filter:{onlyBlocking:true}});
  if (m.noRelease.length)   cards.push({icon:'📭',title:'Без релиза',  value:m.noRelease.length, label:'в scope',    severity:m.noRelease.length>=10?'warning':'info',   filter:{isUnassigned:true}});
  if (m.unconfirmed.length) cards.push({icon:'❓',title:'Неподтверждённые',value:m.unconfirmed.length,label:'задач',severity:'warning',filter:{scope:'Требует подтверждения'}});
  const overloaded = Object.entries(m.load).filter(([,v])=>v.total>=6);
  if (overloaded.length)    cards.push({icon:'🔥',title:'Перегружены', value:overloaded.length,  label:'исполнителей',severity:'warning', filter:null});
  cards.push({icon:'✅',title:'Готово',      value:`${m.donePct}%`, label:`${m.done}/${m.total}`, severity:m.donePct>=70?'ok':m.donePct>=40?'info':'warning', filter:{onlyDone:true}});
  cards.push({icon:'❤️',title:'Health Score',value:`${m.health}%`, label:'состояние', severity:m.health>=80?'ok':m.health>=60?'warning':'critical', filter:null});
  ['120','121','122'].forEach(k=>{ const rr=rel(rows,k); if(!rr.length) return; const d=rr.filter(r=>r.isDone).length,p=pct(d,rr.length); cards.push({icon:'🚀',title:`Релиз 1.${k}`,value:`${p}%`,label:`${d}/${rr.length}`,severity:p>=70?'ok':p>=40?'info':'warning',filter:{release:k}}); });

  return {
    id:'dashboard', title:'Сгенерированный дашборд', icon:'📊',
    score:null, status:'info',
    summary:`${cards.length} динамических карточек по текущим данным.`,
    insights: cards.slice(0,4).map(c=>`${c.title}: ${c.value} ${c.label}`),
    recommendations:[], dashboardCards:cards.slice(0,8),
    filterPayload:null, confidence:'high', aiEnhanced:false,
  };
}

/* ══════════════════════════════════════════════════════════════
   10. Anomaly Detection
   ════════════════════════════════════════════════════════════ */
export function computeAnomalies(rows) {
  const active = act(rows);
  const anomalies = [];

  // Release concentration
  const relCnts = {};
  ['120','121','122','ot'].forEach(k=>{ const n=rel(rows,k).length; if(n) relCnts[k]=n; });
  const avg = Object.values(relCnts).reduce((s,v)=>s+v,0) / Math.max(1,Object.keys(relCnts).length);
  Object.entries(relCnts).forEach(([k,n])=>{ if(n>avg*2&&n>20) anomalies.push({title:`Перегрузка релиза 1.${k}`,detail:`${n} задач — в ${Math.round(n/avg)}x больше среднего`,severity:'warning',check:'Проверить распределение задач',filter:{release:k}}); });

  // Many without owner
  const noOwnerPct = pct(active.filter(r=>!r.assignee).length, active.length);
  if (noOwnerPct>=30 && active.length>10) anomalies.push({title:'Много задач без исполнителя',detail:`${noOwnerPct}% активных задач не назначены`,severity:'warning',check:'Назначить исполнителей или закрыть как неактуальные',filter:null});

  // Unconfirmed in 1.20
  const r120 = rel(rows,'120');
  const unc120 = r120.filter(r=>r.scopeStatus==='Требует подтверждения'&&!r.isDone).length;
  if (unc120>=3) anomalies.push({title:'Неподтверждённый scope в 1.20',detail:`${unc120} задач с неопределённым scope в ближайшем релизе`,severity:'critical',check:'Срочно подтвердить или перенести задачи',filter:{release:'120',scope:'Требует подтверждения'}});

  // Blocker concentration
  const blkByTeam = {};
  active.filter(r=>r.blockingDependency).forEach(r=>{ if(r.team) blkByTeam[r.team]=(blkByTeam[r.team]||0)+1; });
  const worst = Object.entries(blkByTeam).sort((a,b)=>b[1]-a[1])[0];
  const totalBlk = active.filter(r=>r.blockingDependency).length;
  if (worst && worst[1]>=5) anomalies.push({title:`Концентрация блокеров: ${worst[0]}`,detail:`${worst[1]} из ${totalBlk} блокеров — в одной команде`,severity:'warning',check:'Помочь команде с разблокированием',filter:{team:worst[0],onlyBlocking:true}});

  if (!anomalies.length) anomalies.push({title:'Аномалий не обнаружено',detail:'Распределение задач выглядит нормальным',severity:'info',check:'',filter:null});

  return {
    id:'anomalies', title:'Поиск аномалий', icon:'🔭',
    score:null, status:anomalies.some(a=>a.severity==='critical')?'critical':anomalies.some(a=>a.severity==='warning')?'risk':'ok',
    summary:`${anomalies.filter(a=>a.severity!=='info').length} аномалий обнаружено.`,
    insights: anomalies.slice(0,5).map(a=>`${a.title}: ${a.detail}`),
    recommendations: anomalies.filter(a=>a.severity!=='info').slice(0,3).map(a=>({title:a.title,impact:a.severity==='critical'?'high':'medium',action:a.check,filter:a.filter})),
    anomalies, filterPayload:null, confidence:'high', aiEnhanced:false,
  };
}

/* ══════════════════════════════════════════════════════════════
   11. Plan Quality Score
   ════════════════════════════════════════════════════════════ */
export function computePlanQuality(rows) {
  const m = computeBaseMetrics(rows);
  let score = 100;
  const breakdown = [];
  const pen = (label, n, max, fix) => { if(!n) return; const p=Math.min(max,n); score-=p; breakdown.push({factor:label,penalty:-p,fix}); };
  pen('Задачи без релиза',    m.noRelease.length*2,    20, 'Распределите задачи по релизным окнам');
  pen('Активные блокеры',     m.blockers.length*4,     20, 'Снимите блокеры или уточните зависимости');
  pen('Рискованные задачи',   m.risky.length*2,        15, 'Проведите risk review');
  pen('Неподтверждённый scope',m.unconfirmed.length*2, 10, 'Проведите scope review с PO/PM');
  pen('Задачи без команды',   m.noTeam.length,         10, 'Назначьте команды ответственных');
  if (m.donePct<20 && m.total>20) pen('Низкий % выполнения', 5, 5, 'Обновите статусы или ускорьте закрытие задач');
  score = Math.max(0, Math.round(score));

  return {
    id:'quality', title:'Качество плана', icon:'🏆',
    score, status:score>=80?'ok':score>=60?'risk':'critical',
    summary:`Качество плана: ${score}/100. ${breakdown.length===0?'Отличный план!':`${breakdown.length} факторов снижают оценку.`}`,
    insights:[`Общая оценка: ${score}/100`,...breakdown.slice(0,3).map(b=>`${b.factor}: ${b.penalty} пунктов`)],
    recommendations: breakdown.slice(0,3).map(b=>({title:`+${Math.abs(b.penalty)} пунктов: ${b.factor}`,impact:Math.abs(b.penalty)>=10?'high':'medium',action:b.fix,filter:null})),
    breakdown, filterPayload:null, confidence:'high', aiEnhanced:false,
  };
}

/* ══════════════════════════════════════════════════════════════
   12. AI Second Opinion
   ════════════════════════════════════════════════════════════ */
export function computeSecondOpinion(rows) {
  const m = computeBaseMetrics(rows);
  const findings = [];

  // Release imbalance
  const rvls = ['120','121','122'].map(k=>rel(rows,k).length).filter(n=>n>0);
  if (rvls.length>=2 && Math.max(...rvls)/Math.max(1,Math.min(...rvls))>=3) findings.push({issue:'Дисбаланс задач по релизам',detail:'Задачи распределены неравномерно: один релиз значительно больше других',risk:'medium',canIgnore:false});

  // Optimism check
  const r120 = rel(rows,'120'); const r120done = pct(r120.filter(r=>r.isDone).length, r120.length||1);
  if (r120.length>0 && r120done<30 && m.blockers.filter(r=>r.hasRelease120).length>=2) findings.push({issue:'Чрезмерный оптимизм по 1.20',detail:`Выполнено ${r120done}%, при этом ${m.blockers.filter(r=>r.hasRelease120).length} блокеров`,risk:'high',canIgnore:false});

  // No assignee
  if (m.noAssignee.length>=m.active*0.2&&m.active>10) findings.push({issue:'Много задач без исполнителя',detail:`${m.noAssignee.length} задач (${pct(m.noAssignee.length,m.active)}% активных) без назначенных`,risk:'high',canIgnore:false});

  // Underestimated risks
  if (m.risky.length > m.blockers.length*3) findings.push({issue:'Риски могут быть недооценены',detail:'Рискованных задач значительно больше, чем задокументированных блокеров',risk:'medium',canIgnore:true});

  const safeSpots=[m.blockers.length===0&&'Нет активных блокеров',m.unconfirmed.length===0&&'Scope полностью подтверждён',m.donePct>=60&&`Хороший прогресс: ${m.donePct}% задач закрыто`].filter(Boolean);
  if (!findings.length) findings.push({issue:'Существенных проблем не найдено',detail:'План выглядит реалистично',risk:'low',canIgnore:true});

  return {
    id:'second_opinion', title:'Второе мнение', icon:'🔬',
    score:null, status:findings.some(f=>f.risk==='high')?'risk':findings.some(f=>f.risk==='medium')?'info':'ok',
    summary:`Ревью плана: ${findings.filter(f=>f.risk!=='low').length} проблем, ${safeSpots.length} сильных сторон.`,
    insights:[...findings.slice(0,3).map(f=>`⚠ ${f.issue}: ${f.detail}`),...safeSpots.slice(0,2).map(s=>`✓ ${s}`)],
    recommendations: findings.filter(f=>!f.canIgnore).slice(0,3).map(f=>({title:f.issue,impact:f.risk==='high'?'high':'medium',action:f.detail,filter:null})),
    findings, safeSpots, filterPayload:null, confidence:'medium', aiEnhanced:false,
  };
}

/* ══════════════════════════════════════════════════════════════
   13. AI Recommendations Feed
   ════════════════════════════════════════════════════════════ */
export function computeRecommendations(rows) {
  const m = computeBaseMetrics(rows);
  const recs = [];
  if (m.blockers.length)    recs.push({severity:'critical',title:`Разблокировать ${m.blockers.length} задач`,        explanation:'Активные блокеры задерживают зависимые задачи и ухудшают health score.', impact:`Ускорение доставки на ~${Math.round(m.blockers.length*5)}%`,nextStep:'Провести встречу по разблокированию',filter:{onlyBlocking:true}});
  if (m.noRelease.length>=3) recs.push({severity:'warning', title:`Распределить ${m.noRelease.length} задач без релиза`,explanation:'Задачи в scope без привязки к релизу накапливаются и создают неопределённость.', impact:`+${Math.min(20,m.noRelease.length*2)} пунктов к Quality Score`,nextStep:'Назначить релизные окна для приоритетных задач',filter:{isUnassigned:true}});
  if (m.unconfirmed.length>=2) recs.push({severity:'warning',title:`Подтвердить scope: ${m.unconfirmed.length} задач`,explanation:'Неподтверждённый scope в релизах — источник scope creep и задержек.',impact:'Снижение риска scope creep',nextStep:'Провести scope review сессию',filter:{scope:'Требует подтверждения'}});
  const overloaded = Object.entries(m.load).filter(([,v])=>v.total>=6);
  if (overloaded.length) recs.push({severity:'info',title:`Перераспределить нагрузку (${overloaded.length} перегружены)`,explanation:`${overloaded.map(([n])=>n).slice(0,3).join(', ')} имеют ≥6 активных задач.`,impact:'Снижение риска выгорания',nextStep:'Обсудить перераспределение на синке',filter:null});
  if (m.noAssignee.length>=3) recs.push({severity:'info',title:`Назначить исполнителей (${m.noAssignee.length} задач)`,explanation:'Задачи без owner — потенциальные "сироты", которые никто не ведёт.',impact:'Снижение риска неучтённых задач',nextStep:'Назначить ответственных на ближайшем планировании',filter:null});
  if (m.overtime.length>m.total*0.2) recs.push({severity:'info',title:`Снизить overtime (${m.overtime.length} задач)`,explanation:'Большая доля overtime снижает предсказуемость плана.',impact:'Более прозрачный план',nextStep:'Пересмотреть overtime и приоритизировать',filter:{release:'ot'}});
  if (!recs.length) recs.push({severity:'ok',title:'Активных рекомендаций нет',explanation:'Проект в хорошем состоянии.',impact:'',nextStep:'Мониторинг метрик',filter:null});

  return {
    id:'recommendations', title:'Рекомендации', icon:'💡',
    score:null, status:recs.some(r=>r.severity==='critical')?'critical':recs.some(r=>r.severity==='warning')?'risk':'ok',
    summary:`${recs.filter(r=>r.severity!=='ok').length} активных рекомендаций.`,
    insights: recs.slice(0,5).map(r=>r.title),
    recommendations: recs.map(r=>({title:r.title, impact:r.severity==='critical'?'high':r.severity==='warning'?'medium':'low', action:r.nextStep, filter:r.filter})),
    recs, filterPayload:null, confidence:'high', aiEnhanced:false,
  };
}

/* ── run all blocks at once ────────────────────────────────── */
export function runAllBlocks(rows) {
  return {
    health:            computeProjectHealth(rows),
    forecast:          computeForecast(rows),
    ifNothingChanges:  computeIfNothingChanges(rows),
    dependency:        computeDependencyAnalysis(rows),
    replanning:        computeSmartReplanning(rows),
    bottlenecks:       computeBottlenecks(rows),
    riskNarrative:     computeRiskNarrative(rows),
    prioritization:    computePrioritization(rows),
    dashboard:         computeDynamicDashboard(rows),
    anomalies:         computeAnomalies(rows),
    quality:           computePlanQuality(rows),
    secondOpinion:     computeSecondOpinion(rows),
    recommendations:   computeRecommendations(rows),
  };
}
