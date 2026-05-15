'use strict';
/* ============================================================
   UNIFIED FALLBACK ENGINE — AUDIT_HOLISTIC O6
   ------------------------------------------------------------
   Объединяет shared-логику двух старых fallback'ов:
     · ai/aiFallbackEngine.js (13 блоков для AI Анализа)
     · ai/aiCeoFallback.js     (5 блоков для AI CEO)

   Стратегия:
     · Базовые метрики (риски / блокеры / scope-counters / teams /
       releases) считаются ОДИН раз через `buildBlockData({rows,kind})`.
     · Для analysis-kind метрики совместимы с computeBaseMetrics.
     · Для ceo-kind дополнительно считаются loadArr / overloaded /
       releaseProblems / worstRelease (как в computeCeoMetrics).
     · Старые файлы оставлены как thin wrappers — они теперь делегируют
       сюда, не ломая ни одного callsite.

   Контракты:
     · Никаких state-мутаций (read-only).
     · Identity-deterministic: rows отдаются «как есть», engine не
       мерджит сотрудников по fuzzy-name'у.
     · Reactive-safe: pipeline не вызывает Reactive.silent — это
       забота вьюхи (она сама решает, batch это update или нет).
   ============================================================ */

import { state }                        from '../state.js';
// AUDIT_ARCHITECTURE #15 — computeHealthScore zhivet teper' v
// metricsEngine; eto zakryvaet edinstvennyy narushennyy border
// `ai/* → chat/*`. Funkciya — chistaya metrika, ne UI.
import { computeProgress, computeLoad, computeHealthScore } from '../metricsEngine.js';

/* ── tiny helpers ─────────────────────────────────────────── */
const pct  = (n, d) => d ? Math.round(n / d * 100) : 0;
const cap  = (s, n) => String(s || '').slice(0, n);
const act  = rows  => rows.filter(r => !r.isDone);
const rel  = (rows, key) => rows.filter(r => key === 'ot' ? r.hasOvertime : r[`hasRelease${key}`]);
const sev  = s => ({ critical: 0, warning: 1, info: 2, ok: 3 })[s] ?? 9;
const sortSev = arr => arr.slice().sort((a, b) => sev(a.severity) - sev(b.severity));

/* ─────────────────────────────────────────────────────────── */
/* SHARED METRICS — единый builder для обоих kind'ов          */
/* ─────────────────────────────────────────────────────────── */

/**
 * Считает все базовые метрики, нужные обоим движкам.
 * @param {Array}              rows
 * @param {{kind:'analysis'|'ceo'}} [opts]  kind управляет добором ceo-only
 *   полей (loadArr, releaseProblems, worstRelease, blockingNear).
 */
export function buildBlockData({ rows, kind = 'analysis' } = {}) {
  rows = Array.isArray(rows) ? rows : [];
  const total       = rows.length;
  const done        = rows.filter(r => r.isDone).length;
  const active      = total - done;
  const blockers    = rows.filter(r => r.blockingDependency && !r.isDone);
  const risky       = rows.filter(r => (r.riskFlags||[]).length && !r.isDone);
  const noRelease   = rows.filter(r => r.isUnassigned && r.scopeStatus === 'Да' && !r.isDone);
  const unconfirmed = rows.filter(r => r.scopeStatus === 'Требует подтверждения' && !r.isDone);
  const noTeam      = rows.filter(r => !r.team && !r.isDone);
  const noAssignee  = rows.filter(r => !r.assignee && !r.isDone);
  const overtimeAll = rows.filter(r => r.hasOvertime); // analysis: includes done; ceo: filter again
  const overtime    = kind === 'ceo' ? rows.filter(r => r.hasOvertime && !r.isDone) : overtimeAll;

  const progress = computeProgress(rows);
  const load     = computeLoad(rows);
  const health   = computeHealthScore(rows);

  // Team aggregation (общий формат для analysis + ceo)
  const teams = {};
  rows.forEach(r => {
    const t = r.team || (kind === 'ceo' ? '—' : '');
    if (!t) return;
    if (!teams[t]) teams[t] = { total:0, done:0, active:0, blockers:0, risky:0, noRelease:0, noAssignee:0 };
    teams[t].total++;
    if (r.isDone) { teams[t].done++; return; }
    teams[t].active++;
    if (r.blockingDependency)        teams[t].blockers++;
    if ((r.riskFlags||[]).length)    teams[t].risky++;
    if (r.isUnassigned && r.scopeStatus==='Да') teams[t].noRelease++;
    if (!r.assignee)                 teams[t].noAssignee++;
  });

  const base = {
    total, done, active, donePct: pct(done, total),
    blockers, risky, noRelease, unconfirmed, noTeam, noAssignee, overtime,
    progress, load, health, teams,
    topBlockers: [...blockers].sort((a,b)=>(b.riskScore||0)-(a.riskScore||0)).slice(0,10),
    topRisky:    [...risky].sort((a,b)=>(b.riskScore||0)-(a.riskScore||0)).slice(0, kind === 'ceo' ? 8 : 10),
  };

  if (kind !== 'ceo') return base;

  // ── CEO-only extras ──────────────────────────────────────
  const inRelease   = rows.filter(r => (r.hasRelease120||r.hasRelease121||r.hasRelease122) && !r.isDone);
  const blockingNear= blockers.filter(r => r.hasRelease120 || r.hasRelease121);

  const loadArr = Object.entries(load)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.total - a.total);
  const maxLoad = loadArr[0]?.total || 1;
  const overloaded = loadArr.filter(a => a.total >= 5).slice(0, 5);

  const releaseProblems = {
    '120': { key:'120', label:'1.20', progress: progress['120'] || {total:0,done:0,pct:0},
      blockers: blockers.filter(r=>r.hasRelease120).length,
      unconfirmed: unconfirmed.filter(r=>r.hasRelease120).length },
    '121': { key:'121', label:'1.21', progress: progress['121'] || {total:0,done:0,pct:0},
      blockers: blockers.filter(r=>r.hasRelease121).length,
      unconfirmed: unconfirmed.filter(r=>r.hasRelease121).length },
    '122': { key:'122', label:'1.22', progress: progress['122'] || {total:0,done:0,pct:0},
      blockers: blockers.filter(r=>r.hasRelease122).length,
      unconfirmed: unconfirmed.filter(r=>r.hasRelease122).length },
  };
  const worstRelease = Object.values(releaseProblems)
    .filter(r => r.progress.total > 0)
    .sort((a,b) => (b.blockers*15 + b.unconfirmed*5 + (100-b.progress.pct)) -
                   (a.blockers*15 + a.unconfirmed*5 + (100-a.progress.pct)))[0] || null;

  return {
    ...base,
    inRelease, blockingNear,
    loadArr, maxLoad, overloaded,
    releaseProblems, worstRelease,
  };
}

/* ═════════════════════════════════════════════════════════════
   ANALYSIS BLOCKS — 13 блоков из старого aiFallbackEngine.
   Каждый получает rows, внутри вызывает buildBlockData.
   ═════════════════════════════════════════════════════════════ */

export function computeProjectHealth(rows) {
  const m = buildBlockData({ rows, kind: 'analysis' });
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
    id:'health', title:'Здоровье проекта', icon:'compass',
    score, status, summary: summaryText,
    insights:[
      `Выполнено ${m.done} из ${m.total} задач (${m.donePct}%)`,
      m.blockers.length ? `${m.blockers.length} активных блокеров требуют снятия` : 'Активных блокеров нет',
      m.noRelease.length ? `${m.noRelease.length} задач в scope не распределены по релизам` : 'Все in-scope задачи распределены',
      m.unconfirmed.length ? `${m.unconfirmed.length} задач требуют подтверждения scope` : 'Scope полностью подтверждён',
    ].filter(Boolean),
    problems, recommendations,
    filterPayload: null, confidence: m.total>0?'high':'low', aiEnhanced:false, source:'rule-based', _meta:m,
  };
}

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
    id:'forecast', title:'Прогноз релизов', icon:'trending-up',
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
    forecasts, filterPayload:null, confidence: lowHistory?'low':'medium', aiEnhanced:false, source:'rule-based',
  };
}

export function computeIfNothingChangesAnalysis(rows) {
  const m = buildBlockData({ rows, kind: 'analysis' });
  const consequences = [];

  if (m.blockers.length>=3)    consequences.push({severity:'critical', text:`${m.blockers.length} блокеров останутся и продолжат задерживать зависимые задачи`});
  if (m.noRelease.length>=5)   consequences.push({severity:'warning',  text:`${m.noRelease.length} задач в scope по-прежнему не будут распределены по релизам`});
  if (m.unconfirmed.length>=3) consequences.push({severity:'warning',  text:`${m.unconfirmed.length} задач с неподтверждённым scope рискуют попасть в релиз без согласования`});

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
    id:'if_nothing_changes', title:'Если ничего не менять', icon:'hourglass',
    score:null, status:worstSev,
    summary:`Если ничего не менять: ${consequences.filter(c=>c.severity!=='info').length} активных угрозы.`,
    insights: consequences.map(c=>c.text),
    recommendations:[
      m.blockers.length && {title:'Приоритет: снять блокеры',       impact:'high',   action:'Провести встречу по разблокированию критических задач', filter:{onlyBlocking:true}},
      m.noRelease.length && {title:'Распределить задачи без релиза', impact:'high',   action:'Назначить релизные окна для задач в scope',              filter:{isUnassigned:true}},
    ].filter(Boolean),
    filterPayload:null, confidence:'medium', aiEnhanced:false, source:'rule-based',
  };
}

export function computeDependencyAnalysis(rows) {
  const deps = state.epicDeps || {};
  const hasDeps = Object.keys(deps).length > 0;

  if (!hasDeps) {
    const textHints = rows.filter(r=>r.teamDependency||(r.comment&&/зависит|dependent|блокирует/i.test(r.comment)));
    return {
      id:'dependency', title:'Анализ зависимостей', icon:'link-2',
      score:null, status:'info',
      summary:'Зависимости между эпиками не заданы. Обнаружены потенциальные зависимости по тексту.',
      insights:[
        'Граф зависимостей не настроен',
        textHints.length ? `${textHints.length} задач содержат упоминание зависимостей в полях teamDependency/comment` : 'Упоминаний зависимостей в текстовых полях не найдено',
        'Добавьте зависимости на вкладке Гант (режим "Зависимости")',
      ],
      recommendations:[{title:'Настроить зависимости', impact:'medium', action:'Используйте вкладку Гант для построения графа', filter:null}],
      filterPayload:null, confidence:'low', aiEnhanced:false, source:'rule-based',
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
    id:'dependency', title:'Анализ зависимостей', icon:'link-2',
    score:null, status: chainRisks.length?'risk':'ok',
    summary:`Граф: ${nodes.size} узлов, ${Object.keys(deps).length} связей. ${chainRisks.length ? 'Обнаружены рискованные цепочки.' : 'Критических цепочек не найдено.'}`,
    insights:[
      `Всего зависимостей: ${Object.keys(deps).length}`,
      keyNodes.length ? `Ключевые узлы: ${keyNodes.join(', ')}` : 'Ключевых узлов (с множеством зависимых) нет',
      chainRisks.length ? `Рискованные цепочки: ${chainRisks.slice(0,3).join('; ')}` : 'Цепочек риска (блокер→зависимый) не найдено',
    ],
    recommendations: chainRisks.length ? [{title:'Снять блокеры в цепочках', impact:'high', action:'Разблокировать: '+chainRisks[0], filter:{onlyBlocking:true}}] : [],
    filterPayload:null, confidence:'high', aiEnhanced:false, source:'rule-based',
  };
}

export function computeSmartReplanning(rows) {
  const m = buildBlockData({ rows, kind: 'analysis' });
  const scenarios = [
    { label:'Консервативный', icon:'shield', color:'blue',
      what:[`Перенести ${Math.ceil(m.noRelease.length*0.5)} наименее приоритетных задач без релиза в Overtime`,`Сосредоточиться на снятии ${m.blockers.length} блокеров`,`Зафиксировать scope 1.20 и не добавлять новые задачи`],
      affected: m.noRelease.length + m.blockers.length, risk:'Низкий', tradeoff:'Часть задач перейдёт в следующий релиз' },
    { label:'Сбалансированный', icon:'compass', color:'green',
      what:[`Распределить ${m.noRelease.length} задач без релиза по 1.21 и 1.22`,`Параллельно снимать блокеры (${m.blockers.length})`,`Подтвердить scope для ${m.unconfirmed.length} неопределённых задач`],
      affected: m.noRelease.length+m.blockers.length+m.unconfirmed.length, risk:'Средний', tradeoff:'Требует активного управления и регулярных синков' },
    { label:'Агрессивный', icon:'rocket', color:'orange',
      what:['Добавить дополнительные ресурсы для параллельной работы',`Перевести все ${m.noRelease.length} задач в ближайшие релизы`,'Принять повышенный риск для ускорения доставки'],
      affected: m.total, risk:'Высокий', tradeoff:'Высокая нагрузка на команды, возможное снижение качества' },
  ];
  return {
    id:'replanning', title:'Сценарии перепланирования', icon:'map',
    score:null, status:'info',
    summary:`3 сценария перепланирования для ${m.active} активных задач.`,
    insights: scenarios.map(s=>`${s.label}: ${s.what[0]}`),
    recommendations:[], scenarios,
    filterPayload:null, confidence:'medium', aiEnhanced:false, source:'rule-based',
  };
}

export function computeBottlenecks(rows) {
  const active = act(rows);
  const bottlenecks = [];

  const ts = {};
  active.forEach(r=>{ if(!r.team) return; ts[r.team]=ts[r.team]||{total:0,blockers:0,risky:0}; ts[r.team].total++; if(r.blockingDependency)ts[r.team].blockers++; if((r.riskFlags||[]).length)ts[r.team].risky++; });
  Object.entries(ts).filter(([,s])=>s.blockers>0||s.risky>=3).sort((a,b)=>(b[1].blockers*3+b[1].risky)-(a[1].blockers*3+a[1].risky)).slice(0,3).forEach(([team,s])=>{
    bottlenecks.push({type:'team', label:`Команда ${team}`, reason:`${s.blockers} блокеров, ${s.risky} рискованных из ${s.total} активных`, severity:s.blockers>=3?'critical':'warning', filter:{team}});
  });

  Object.entries(computeLoad(active)).filter(([,v])=>v.total>=6).sort((a,b)=>b[1].total-a[1].total).slice(0,3).forEach(([name,v])=>{
    bottlenecks.push({type:'assignee', label:`Исполнитель ${name}`, reason:`${v.total} задач (1.20:${v.r120} 1.21:${v.r121} 1.22:${v.r122})`, severity:v.total>=10?'critical':'warning', filter:{assignee:name}});
  });

  ['120','121','122'].forEach(k=>{ const rr=rel(active,k); const blk=rr.filter(r=>r.blockingDependency).length; if(blk>=5) bottlenecks.push({type:'release',label:`Релиз 1.${k}`,reason:`${blk} блокеров из ${rr.length} активных (${pct(blk,rr.length)}%)`,severity:'warning',filter:{release:k,onlyBlocking:true}}); });

  if (!bottlenecks.length) bottlenecks.push({type:'none',label:'Критических узких мест не найдено',reason:'Нагрузка распределена равномерно',severity:'info',filter:null});

  const worstSev = bottlenecks.some(b=>b.severity==='critical')?'critical':bottlenecks.some(b=>b.severity==='warning')?'risk':'ok';
  return {
    id:'bottlenecks', title:'Узкие места', icon:'search',
    score:null, status:worstSev,
    summary:`Найдено ${bottlenecks.filter(b=>b.severity!=='info').length} узких мест.`,
    insights: bottlenecks.slice(0,5).map(b=>`${b.label}: ${b.reason}`),
    recommendations: bottlenecks.filter(b=>b.filter&&b.severity!=='info').slice(0,3).map(b=>({
      title:`Устранить: ${b.label}`, impact:b.severity==='critical'?'high':'medium', action:b.reason, filter:b.filter,
    })),
    bottlenecks, filterPayload:null, confidence:'high', aiEnhanced:false, source:'rule-based',
  };
}

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
    id:'risk_narrative', title:'Описание рисков', icon:'file-text',
    score:null, status: narratives.some(n=>n.count>=5)?'risk':narratives.some(n=>n.count>0)?'info':'ok',
    summary:`${narratives.filter(n=>n.count>0).length} активных рисковых паттернов.`,
    insights: narratives.slice(0,4).map(n=>n.title+(n.count?` (${n.count} задач)`:'')),
    recommendations: narratives.filter(n=>n.filter&&n.count>0).slice(0,3).map(n=>({
      title:n.title, impact:n.count>=5?'high':'medium', action:n.howToFix, filter:n.filter,
    })),
    narratives, filterPayload:null, confidence:'high', aiEnhanced:false, source:'rule-based',
  };
}

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
    id:'prioritization', title:'Приоритизация задач', icon:'crosshair',
    score:null, status:'info',
    summary:`Топ-${top10.length} задач, требующих немедленного внимания.`,
    insights: top10.slice(0,5).map(r=>`${r.epic||r.tasks||'—'}: ${r._reasons.join(', ')} (score ${r._sc})`),
    recommendations: top10.slice(0,3).map(r=>({
      title: r.epic||r.tasks||'—', impact:r._sc>=60?'high':'medium', action:r._reasons[0]||'Требует внимания', filter:{search:r.epic||r.tasks||''},
    })),
    topRows:top10, filterPayload:null, confidence:'high', aiEnhanced:false, source:'rule-based',
  };
}

export function computeDynamicDashboard(rows) {
  const m = buildBlockData({ rows, kind: 'analysis' });
  const cards = [];
  if (m.blockers.length)    cards.push({icon:'no-symbol',title:'Блокеры',     value:m.blockers.length,  label:'активных',   severity:m.blockers.length>=5?'critical':'warning', filter:{onlyBlocking:true}});
  if (m.noRelease.length)   cards.push({icon:'inbox',title:'Без релиза',  value:m.noRelease.length, label:'в scope',    severity:m.noRelease.length>=10?'warning':'info',   filter:{isUnassigned:true}});
  if (m.unconfirmed.length) cards.push({icon:'help-circle',title:'Неподтверждённые',value:m.unconfirmed.length,label:'задач',severity:'warning',filter:{scope:'Требует подтверждения'}});
  const overloaded = Object.entries(m.load).filter(([,v])=>v.total>=6);
  if (overloaded.length)    cards.push({icon:'flame',title:'Перегружены', value:overloaded.length,  label:'исполнителей',severity:'warning', filter:null});
  cards.push({icon:'check-circle',title:'Готово',      value:`${m.donePct}%`, label:`${m.done}/${m.total}`, severity:m.donePct>=70?'ok':m.donePct>=40?'info':'warning', filter:{onlyDone:true}});
  cards.push({icon:'compass',title:'Health Score',value:`${m.health}%`, label:'состояние', severity:m.health>=80?'ok':m.health>=60?'warning':'critical', filter:null});
  ['120','121','122'].forEach(k=>{ const rr=rel(rows,k); if(!rr.length) return; const d=rr.filter(r=>r.isDone).length,p=pct(d,rr.length); cards.push({icon:'rocket',title:`Релиз 1.${k}`,value:`${p}%`,label:`${d}/${rr.length}`,severity:p>=70?'ok':p>=40?'info':'warning',filter:{release:k}}); });

  return {
    id:'dashboard', title:'Сгенерированный дашборд', icon:'bar-chart',
    score:null, status:'info',
    summary:`${cards.length} динамических карточек по текущим данным.`,
    insights: cards.slice(0,4).map(c=>`${c.title}: ${c.value} ${c.label}`),
    recommendations:[], dashboardCards:cards.slice(0,8),
    filterPayload:null, confidence:'high', aiEnhanced:false, source:'rule-based',
  };
}

export function computeAnomalies(rows) {
  const active = act(rows);
  const anomalies = [];

  const relCnts = {};
  ['120','121','122','ot'].forEach(k=>{ const n=rel(rows,k).length; if(n) relCnts[k]=n; });
  const avg = Object.values(relCnts).reduce((s,v)=>s+v,0) / Math.max(1,Object.keys(relCnts).length);
  Object.entries(relCnts).forEach(([k,n])=>{ if(n>avg*2&&n>20) anomalies.push({title:`Перегрузка релиза 1.${k}`,detail:`${n} задач — в ${Math.round(n/avg)}x больше среднего`,severity:'warning',check:'Проверить распределение задач',filter:{release:k}}); });

  const noOwnerPct = pct(active.filter(r=>!r.assignee).length, active.length);
  if (noOwnerPct>=30 && active.length>10) anomalies.push({title:'Много задач без исполнителя',detail:`${noOwnerPct}% активных задач не назначены`,severity:'warning',check:'Назначить исполнителей или закрыть как неактуальные',filter:null});

  const r120 = rel(rows,'120');
  const unc120 = r120.filter(r=>r.scopeStatus==='Требует подтверждения'&&!r.isDone).length;
  if (unc120>=3) anomalies.push({title:'Неподтверждённый scope в 1.20',detail:`${unc120} задач с неопределённым scope в ближайшем релизе`,severity:'critical',check:'Срочно подтвердить или перенести задачи',filter:{release:'120',scope:'Требует подтверждения'}});

  const blkByTeam = {};
  active.filter(r=>r.blockingDependency).forEach(r=>{ if(r.team) blkByTeam[r.team]=(blkByTeam[r.team]||0)+1; });
  const worst = Object.entries(blkByTeam).sort((a,b)=>b[1]-a[1])[0];
  const totalBlk = active.filter(r=>r.blockingDependency).length;
  if (worst && worst[1]>=5) anomalies.push({title:`Концентрация блокеров: ${worst[0]}`,detail:`${worst[1]} из ${totalBlk} блокеров — в одной команде`,severity:'warning',check:'Помочь команде с разблокированием',filter:{team:worst[0],onlyBlocking:true}});

  if (!anomalies.length) anomalies.push({title:'Аномалий не обнаружено',detail:'Распределение задач выглядит нормальным',severity:'info',check:'',filter:null});

  return {
    id:'anomalies', title:'Поиск аномалий', icon:'eye',
    score:null, status:anomalies.some(a=>a.severity==='critical')?'critical':anomalies.some(a=>a.severity==='warning')?'risk':'ok',
    summary:`${anomalies.filter(a=>a.severity!=='info').length} аномалий обнаружено.`,
    insights: anomalies.slice(0,5).map(a=>`${a.title}: ${a.detail}`),
    recommendations: anomalies.filter(a=>a.severity!=='info').slice(0,3).map(a=>({title:a.title,impact:a.severity==='critical'?'high':'medium',action:a.check,filter:a.filter})),
    anomalies, filterPayload:null, confidence:'high', aiEnhanced:false, source:'rule-based',
  };
}

export function computePlanQuality(rows) {
  const m = buildBlockData({ rows, kind: 'analysis' });
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
    id:'quality', title:'Качество плана', icon:'shield-check',
    score, status:score>=80?'ok':score>=60?'risk':'critical',
    summary:`Качество плана: ${score}/100. ${breakdown.length===0?'Отличный план!':`${breakdown.length} факторов снижают оценку.`}`,
    insights:[`Общая оценка: ${score}/100`,...breakdown.slice(0,3).map(b=>`${b.factor}: ${b.penalty} пунктов`)],
    recommendations: breakdown.slice(0,3).map(b=>({title:`+${Math.abs(b.penalty)} пунктов: ${b.factor}`,impact:Math.abs(b.penalty)>=10?'high':'medium',action:b.fix,filter:null})),
    breakdown, filterPayload:null, confidence:'high', aiEnhanced:false, source:'rule-based',
  };
}

export function computeSecondOpinion(rows) {
  const m = buildBlockData({ rows, kind: 'analysis' });
  const findings = [];

  const rvls = ['120','121','122'].map(k=>rel(rows,k).length).filter(n=>n>0);
  if (rvls.length>=2 && Math.max(...rvls)/Math.max(1,Math.min(...rvls))>=3) findings.push({issue:'Дисбаланс задач по релизам',detail:'Задачи распределены неравномерно: один релиз значительно больше других',risk:'medium',canIgnore:false});

  const r120 = rel(rows,'120'); const r120done = pct(r120.filter(r=>r.isDone).length, r120.length||1);
  if (r120.length>0 && r120done<30 && m.blockers.filter(r=>r.hasRelease120).length>=2) findings.push({issue:'Чрезмерный оптимизм по 1.20',detail:`Выполнено ${r120done}%, при этом ${m.blockers.filter(r=>r.hasRelease120).length} блокеров`,risk:'high',canIgnore:false});

  if (m.noAssignee.length>=m.active*0.2&&m.active>10) findings.push({issue:'Много задач без исполнителя',detail:`${m.noAssignee.length} задач (${pct(m.noAssignee.length,m.active)}% активных) без назначенных`,risk:'high',canIgnore:false});

  if (m.risky.length > m.blockers.length*3) findings.push({issue:'Риски могут быть недооценены',detail:'Рискованных задач значительно больше, чем задокументированных блокеров',risk:'medium',canIgnore:true});

  const safeSpots=[m.blockers.length===0&&'Нет активных блокеров',m.unconfirmed.length===0&&'Scope полностью подтверждён',m.donePct>=60&&`Хороший прогресс: ${m.donePct}% задач закрыто`].filter(Boolean);
  if (!findings.length) findings.push({issue:'Существенных проблем не найдено',detail:'План выглядит реалистично',risk:'low',canIgnore:true});

  return {
    id:'second_opinion', title:'Второе мнение', icon:'search',
    score:null, status:findings.some(f=>f.risk==='high')?'risk':findings.some(f=>f.risk==='medium')?'info':'ok',
    summary:`Ревью плана: ${findings.filter(f=>f.risk!=='low').length} проблем, ${safeSpots.length} сильных сторон.`,
    insights:[...findings.slice(0,3).map(f=>`${f.issue}: ${f.detail}`),...safeSpots.slice(0,2).map(s=>String(s))],
    recommendations: findings.filter(f=>!f.canIgnore).slice(0,3).map(f=>({title:f.issue,impact:f.risk==='high'?'high':'medium',action:f.detail,filter:null})),
    findings, safeSpots, filterPayload:null, confidence:'medium', aiEnhanced:false, source:'rule-based',
  };
}

export function computeRecommendations(rows) {
  const m = buildBlockData({ rows, kind: 'analysis' });
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
    id:'recommendations', title:'Рекомендации', icon:'lightbulb',
    score:null, status:recs.some(r=>r.severity==='critical')?'critical':recs.some(r=>r.severity==='warning')?'risk':'ok',
    summary:`${recs.filter(r=>r.severity!=='ok').length} активных рекомендаций.`,
    insights: recs.slice(0,5).map(r=>r.title),
    recommendations: recs.map(r=>({title:r.title, impact:r.severity==='critical'?'high':r.severity==='warning'?'medium':'low', action:r.nextStep, filter:r.filter})),
    recs, filterPayload:null, confidence:'high', aiEnhanced:false, source:'rule-based',
  };
}

/* ═════════════════════════════════════════════════════════════
   CEO BLOCKS — 5 блоков из старого aiCeoFallback.
   Каждый принимает rows и сам строит CEO-метрики.
   ═════════════════════════════════════════════════════════════ */

export function computeCeoHealth(rows) {
  const m = buildBlockData({ rows, kind: 'ceo' });
  if (!m.total) return null;
  const score  = m.health;
  const status = score >= 80 ? 'ok' : score >= 55 ? 'risk' : 'critical';
  const label = { ok:'ПРОЕКТ В НОРМЕ', risk:'ПРОЕКТ ПОД РИСКОМ', critical:'ПРОЕКТ В КРИТИЧЕСКОМ СОСТОЯНИИ' }[status];
  const color = { ok:'green', risk:'orange', critical:'red' }[status];

  const causes = [
    m.blockingNear.length >= 1 && {
      text: `${m.blockingNear.length} блокер${m.blockingNear.length===1?'':'а/ов'} в ближайших релизах`,
      severity: 'critical', filter: { onlyBlocking:true },
    },
    m.blockers.length > 0 && m.blockingNear.length === 0 && {
      text: `${m.blockers.length} активных блокеров`,
      severity: 'warning', filter: { onlyBlocking:true },
    },
    m.noRelease.length >= 3 && {
      text: `${m.noRelease.length} задач в scope без релиза`,
      severity: 'warning', filter: { isUnassigned:true },
    },
    m.unconfirmed.length >= 2 && {
      text: `${m.unconfirmed.length} задач без подтверждения scope`,
      severity: 'warning', filter: { scope:'Требует подтверждения' },
    },
    m.overloaded.length >= 1 && {
      text: `Перегруз: ${m.overloaded.slice(0,2).map(a=>cap(a.name,20)).join(', ')}`,
      severity: 'info', filter: null,
    },
    m.noAssignee.length >= 5 && {
      text: `${m.noAssignee.length} задач без исполнителя`,
      severity: 'info', filter: {},
    },
  ].filter(Boolean).slice(0, 3);

  const worstRel = m.worstRelease;
  const critRelText = worstRel
    ? `Ближайший проблемный релиз: ${worstRel.label} (${worstRel.progress.pct}% done, ${worstRel.blockers} блокеров)`
    : null;

  const summaryParts = [causes.slice(0,2).map(c=>c.text).join(', ')].filter(Boolean);

  return {
    id:'ceo_health', kind:'ceo',
    score, status, label, color, causes,
    summary: summaryParts.join('. ') || 'Данных недостаточно для анализа.',
    critRelText,
    donePct: m.donePct,
    worstRelease: worstRel,
    filterPayload: { onlyBlocking: true },
    source: 'rule-based',
  };
}

export function computeCeoIfNothingChanges(rows) {
  const m = buildBlockData({ rows, kind: 'ceo' });
  if (!m.total) return null;
  const consequences = [];
  const currentRisk = 100 - m.health;
  const growthRate  = (m.blockers.length * 3 + m.unconfirmed.length * 1.5 + m.noRelease.length) / Math.max(m.active, 1);
  const projectedRisk = Math.min(100, Math.round(currentRisk + growthRate * 14));
  const projectedDays = 14;

  if (m.blockingNear.length > 0) {
    consequences.push({ severity: 'critical', text: `${m.blockingNear.length} блокер${m.blockingNear.length===1?'':'ов'} ближайших релизов — задачи не завершатся вовремя`, filter: { onlyBlocking: true } });
  }
  if (m.worstRelease && m.worstRelease.progress.pct < 60) {
    consequences.push({ severity: 'critical', text: `Релиз ${m.worstRelease.label} завершён на ${m.worstRelease.progress.pct}% — риск срыва без активных действий`, filter: { release: m.worstRelease.key } });
  }
  if (m.noRelease.length >= 3) {
    consequences.push({ severity: 'warning', text: `${m.noRelease.length} задач в scope "повиснут" — они не попадут ни в один релиз`, filter: { isUnassigned: true } });
  }
  if (m.unconfirmed.length >= 2) {
    consequences.push({ severity: 'warning', text: `${m.unconfirmed.length} неподтверждённых задач войдут в релиз по умолчанию — scope станет непредсказуемым`, filter: { scope: 'Требует подтверждения' } });
  }
  if (m.overloaded.length >= 1) {
    const names = m.overloaded.slice(0,2).map(a=>cap(a.name,18)).join(', ');
    consequences.push({ severity: 'warning', text: `Перегруз у ${names} — задачи будут выполняться медленнее или зависнут`, filter: null });
  }
  if (m.noAssignee.length >= 5) {
    consequences.push({ severity: 'info', text: `${m.noAssignee.length} задач без исполнителя — некому их взять в работу`, filter: {} });
  }
  if (consequences.length === 0) {
    consequences.push({ severity: 'info', text: 'При текущем темпе план будет выполнен. Продолжайте мониторинг.', filter: null });
  }

  const firstToBreak = m.topBlockers.slice(0, 4).map(r => ({
    id: r.id,
    task: cap(r.tasks || r.epic || '—', 60),
    team: r.team || '—',
    release: [r.hasRelease120&&'1.20',r.hasRelease121&&'1.21',r.hasRelease122&&'1.22'].filter(Boolean).join('/') || '—',
    riskScore: r.riskScore || 0,
  }));
  const affectedReleases = Object.values(m.releaseProblems)
    .filter(r => r.progress.total > 0 && (r.blockers > 0 || r.unconfirmed > 0))
    .sort((a,b) => b.blockers - a.blockers);

  return {
    id:'ceo_if_nothing_changes', kind:'ceo',
    currentRisk, projectedRisk, projectedDays,
    riskGrowth: projectedRisk - currentRisk,
    consequences, firstToBreak, affectedReleases,
    headline: consequences.length > 1
      ? `Если ничего не менять — риск вырастет с ${currentRisk}% до ${projectedRisk}% за ${projectedDays} дней`
      : 'Ситуация стабильная, но требует наблюдения',
    source: 'rule-based',
  };
}

export function computeCeoHardTruths(rows) {
  const m = buildBlockData({ rows, kind: 'ceo' });
  if (!m.total) return null;
  const hardTruths = [];
  const suspicious = [];
  const weakSignals = [];

  const activePeople = Object.keys(m.load).length;
  const planned = m.active;
  if (activePeople > 0 && planned > activePeople * 6) {
    hardTruths.push({ icon: 'alert-triangle', text: `Запланировано ${planned} задач, но capacity хватает примерно на ${activePeople * 6} — в ${Math.round(planned / (activePeople*6) * 10)/10}× больше чем можно реально взять`, filter: {} });
  }
  const inRelUnconfirmed = m.unconfirmed.filter(r => r.hasRelease120||r.hasRelease121||r.hasRelease122);
  if (inRelUnconfirmed.length >= 2) {
    hardTruths.push({ icon: 'alert-circle', text: `${inRelUnconfirmed.length} задач в релизах со статусом "Требует подтверждения" — scope не подтверждён, но уже стоит в релизе`, filter: { scope:'Требует подтверждения' } });
  }
  if (m.blockers.length >= 3 && m.blockingNear.length === 0) {
    hardTruths.push({ icon: 'no-symbol', text: `${m.blockers.length} блокеров существуют, но ни один не помечен как критичный для ближайшего релиза — риски занижены`, filter: { onlyBlocking: true } });
  }
  if (m.blockingNear.length >= 2) {
    hardTruths.push({ icon: 'alert-circle', text: `${m.blockingNear.length} блокеров прямо в ближайших релизах — они не будут сданы без разблокировки`, filter: { onlyBlocking: true } });
  }
  const wr = m.worstRelease;
  if (wr && wr.progress.pct >= 40 && (wr.blockers > 0 || wr.unconfirmed >= 3)) {
    hardTruths.push({ icon: 'search', text: `Релиз ${wr.label} выглядит нормальным (${wr.progress.pct}% done), но содержит ${wr.blockers} блокеров и ${wr.unconfirmed} неподтверждённых задач`, filter: { release: wr.key } });
  }
  Object.entries(m.teams).forEach(([team, t]) => {
    if (team === '—') return;
    if (t.active > 3 && t.noAssignee / t.active > 0.5) {
      suspicious.push({ icon: 'user', text: `Команда "${cap(team,25)}": ${t.noAssignee} из ${t.active} активных задач без исполнителя`, filter: { team } });
    }
  });
  if (m.overtime.length >= 5) {
    suspicious.push({ icon: 'hourglass', text: `${m.overtime.length} задач уже в overtime — это означает, что основной план не реалистичен`, filter: { release: 'ot' } });
  }
  if (m.noRelease.length >= 10) {
    suspicious.push({ icon: 'archive', text: `${m.noRelease.length} in-scope задач без релиза — скрытый scope, который нужно либо планировать, либо убирать`, filter: { isUnassigned: true } });
  }
  const depCount = Object.keys(state.epicDeps || {}).length;
  if (depCount === 0 && m.blockers.length > 0) {
    suspicious.push({ icon: 'crosshair', text: `${m.blockers.length} блокеров, но зависимости эпиков не описаны — критический путь неизвестен`, filter: { onlyBlocking: true } });
  }
  Object.values(m.releaseProblems).forEach(r => {
    if (r.progress.total >= 5 && r.progress.pct < 30) {
      weakSignals.push({ icon: 'trending-down', text: `Релиз ${r.label}: всего ${r.progress.pct}% done (${r.progress.done}/${r.progress.total}) — темп недостаточный`, filter: { release: r.key } });
    }
  });
  const noTeamCount = Object.values(m.teams)['—']?.active || 0;
  if (noTeamCount >= 3) {
    weakSignals.push({ icon: 'tag', text: `${noTeamCount} активных задач без команды — ответственность размыта`, filter: {} });
  }
  const riskyNoRelease = m.risky.filter(r => r.isUnassigned);
  if (riskyNoRelease.length >= 2) {
    weakSignals.push({ icon: 'zap', text: `${riskyNoRelease.length} рискованных задач без назначенного релиза — их риск не контролируется`, filter: { onlyRisky: true } });
  }

  return {
    id:'ceo_hard_truths', kind:'ceo',
    hardTruths: hardTruths.slice(0, 5),
    suspicious: suspicious.slice(0, 4),
    weakSignals: weakSignals.slice(0, 4),
    totalCount: hardTruths.length + suspicious.length + weakSignals.length,
    source: 'rule-based',
  };
}

export function computeCeoSaveTheRelease(rows) {
  const m = buildBlockData({ rows, kind: 'ceo' });
  if (!m.total) return null;
  const wr     = m.worstRelease;
  const health = m.health;
  const riskBefore = 100 - health;
  const relLabel = wr?.label || 'ближайшего релиза';
  const relKey   = wr?.key || '121';

  const conservativeChanges = [
    m.unconfirmed.filter(r => r[`hasRelease${relKey}`] || (!wr)).slice(0, 8).map(r => ({
      type: 'set_scope', label: 'Убрать из релиза (scope "Нет")',
      task: cap(r.tasks||r.epic||'—', 60), id: r.id,
      reason: 'Неподтверждённый scope — риск неготовности',
    })),
    m.noRelease.slice(0, 5).map(r => ({
      type: 'remove_from_scope', label: 'Снять из scope',
      task: cap(r.tasks||r.epic||'—', 60), id: r.id,
      reason: 'In-scope без релиза — создаёт неопределённость',
    })),
  ].flat();
  const conservativeRiskAfter = Math.max(10, riskBefore - 15);
  const conservativeProb = { before: Math.max(10, 100 - riskBefore - 20), after: Math.min(90, 100 - conservativeRiskAfter) };

  const balancedChanges = [
    m.topBlockers.slice(0, 6).map(r => ({
      type: 'assign_owner', label: 'Назначить ответственного за разблокировку',
      task: cap(r.tasks||r.epic||'—', 60), id: r.id,
      reason: 'Блокер без явного ответственного',
    })),
    m.noAssignee.filter(r => r[`hasRelease${relKey}`] || (!wr)).slice(0, 5).map(r => ({
      type: 'assign_assignee', label: 'Назначить исполнителя',
      task: cap(r.tasks||r.epic||'—', 60), id: r.id,
      reason: 'Задача в релизе без исполнителя',
    })),
    m.unconfirmed.filter(r => r[`hasRelease${relKey}`]).slice(0, 4).map(r => ({
      type: 'confirm_scope', label: 'Подтвердить scope',
      task: cap(r.tasks||r.epic||'—', 60), id: r.id,
      reason: 'Нужно подтвердить до начала работы',
    })),
  ].flat();
  const balancedRiskAfter = Math.max(8, riskBefore - 25);
  const balancedProb = { before: Math.max(10, 100 - riskBefore - 20), after: Math.min(92, 100 - balancedRiskAfter) };

  const aggressiveChanges = [
    m.unconfirmed.slice(0, 10).map(r => ({
      type: 'move_to_overtime', label: 'Перенести в overtime',
      task: cap(r.tasks||r.epic||'—', 60), id: r.id,
      reason: 'Неподтверждённый scope — перенос безопаснее',
    })),
    m.topRisky.slice(0, 5).map(r => ({
      type: 'move_to_overtime', label: 'Перенести в overtime (высокий риск)',
      task: cap(r.tasks||r.epic||'—', 60), id: r.id,
      reason: `riskScore: ${r.riskScore}`,
    })),
    m.topBlockers.slice(0, 5).map(r => ({
      type: 'escalate', label: 'Эскалировать блокер',
      task: cap(r.tasks||r.epic||'—', 60), id: r.id,
      reason: 'Блокер не снимается — нужна эскалация',
    })),
  ].flat();
  const aggressiveRiskAfter = Math.max(5, riskBefore - 38);
  const aggressiveProb = { before: Math.max(10, 100 - riskBefore - 20), after: Math.min(95, 100 - aggressiveRiskAfter) };

  return {
    id:'ceo_save_release', kind:'ceo',
    relLabel, riskBefore,
    scenarios: [
      { id:'conservative', label:'Консервативный', icon:'shield',
        description:'Убрать неподтверждённый и "висящий" scope. Минимальные изменения, максимальная предсказуемость.',
        riskBefore, riskAfter: conservativeRiskAfter, probability: conservativeProb,
        scopeImpact: `−${conservativeChanges.length} задач`, affectedCount: conservativeChanges.length,
        tradeoffs: ['Меньший scope → меньше функционала', 'Освобождает ресурсы для приоритетных задач', 'Наименее рискованный сценарий'],
        changes: conservativeChanges },
      { id:'balanced', label:'Сбалансированный', icon:'compass',
        description:'Назначить ответственных, разблокировать ключевые задачи, подтвердить scope. Баланс между изменениями и стабильностью.',
        riskBefore, riskAfter: balancedRiskAfter, probability: balancedProb,
        scopeImpact: `${balancedChanges.filter(c=>c.type==='confirm_scope').length} подтвердить`, affectedCount: balancedChanges.length,
        tradeoffs: ['Требует ресурсов команды на разблокировку', 'Наибольший эффект при наличии ответственных', 'Scope не меняется — функционал сохраняется'],
        changes: balancedChanges },
      { id:'aggressive', label:'Агрессивный', icon:'rocket',
        description:'Срезать всё рискованное, эскалировать блокеры, перевести в overtime. Максимальная вероятность сдачи минимального ядра.',
        riskBefore, riskAfter: aggressiveRiskAfter, probability: aggressiveProb,
        scopeImpact: `−${aggressiveChanges.length} задач / overtime`, affectedCount: aggressiveChanges.length,
        tradeoffs: ['Существенное сокращение scope', 'Конфликты с бизнес-ожиданиями', 'Гарантирует сдачу ядра продукта'],
        changes: aggressiveChanges },
    ],
    source: 'rule-based',
  };
}

export function computeCeoActionFeed(rows) {
  const m = buildBlockData({ rows, kind: 'ceo' });
  if (!m.total) return null;
  const items = [];

  if (m.blockingNear.length > 0) {
    items.push({ id:'feed_blockers_near', severity:'critical', icon:'no-symbol',
      title:`Разобрать ${m.blockingNear.length} блокеров в ближайших релизах`,
      explanation:'Блокеры прямо в 1.20/1.21 — задачи не завершатся без разблокировки. Критический приоритет.',
      impact:'Без действий релиз сорвётся', affectedCount: m.blockingNear.length,
      filter:{onlyBlocking:true}, actionType:'show' });
  }
  const inRelUnconfirmed = m.unconfirmed.filter(r => r.hasRelease120||r.hasRelease121||r.hasRelease122);
  if (inRelUnconfirmed.length >= 2) {
    items.push({ id:'feed_unconfirmed_in_rel', severity:'critical', icon:'help-circle',
      title:`Подтвердить scope у ${inRelUnconfirmed.length} задач в релизах`,
      explanation:'Неподтверждённый scope в релизе — непредсказуемый объём работ. Нужно либо подтвердить, либо вынести.',
      impact:`Риск неготовности ${inRelUnconfirmed.length} задач`, affectedCount: inRelUnconfirmed.length,
      filter:{scope:'Требует подтверждения'}, actionType:'show' });
  }
  if (m.noRelease.length >= 3) {
    items.push({ id:'feed_no_release', severity:'warning', icon:'clipboard',
      title:`Распределить ${m.noRelease.length} задач по релизам`,
      explanation:'Задачи in-scope без релиза — они не войдут ни в какой релиз, накопятся долгом.',
      impact:'Скрытый backlog растёт', affectedCount: m.noRelease.length,
      filter:{isUnassigned:true}, actionType:'show' });
  }
  if (m.blockers.length > m.blockingNear.length) {
    const extra = m.blockers.length - m.blockingNear.length;
    items.push({ id:'feed_all_blockers', severity:'warning', icon:'zap',
      title:`Ещё ${extra} блокеров вне ближайших релизов`,
      explanation:'Блокеры в 1.22 и overtime — они также требуют внимания и могут задержать последующие релизы.',
      impact:'Риск задержки следующих релизов', affectedCount: extra,
      filter:{onlyBlocking:true}, actionType:'show' });
  }
  if (m.overloaded.length >= 1) {
    const names = m.overloaded.slice(0,3).map(a => cap(a.name, 20)).join(', ');
    items.push({ id:'feed_overload', severity:'warning', icon:'flame',
      title:`Перегруз: ${names}`,
      explanation:'Исполнители с 5+ задачами — скорость выполнения упадёт, задачи будут тормозить друг друга.',
      impact:'Задержки из-за перегруза команды', affectedCount: m.overloaded.reduce((s,a)=>s+a.total,0),
      filter:null, actionType:'explain' });
  }
  if (m.noAssignee.length >= 5) {
    items.push({ id:'feed_no_assignee', severity:'info', icon:'user',
      title:`Назначить владельцев ${m.noAssignee.length} задачам`,
      explanation:'Задачи без исполнителя никто не возьмёт в работу. Нужно назначить или убрать из scope.',
      impact:'Задачи зависнут без движения', affectedCount: m.noAssignee.length,
      filter:{}, actionType:'show' });
  }
  if (m.overtime.length >= 5) {
    items.push({ id:'feed_overtime', severity:'info', icon:'hourglass',
      title:`Снизить overtime: ${m.overtime.length} задач`,
      explanation:'Overtime — признак нереалистичного плана. Нужно пересмотреть приоритеты или расширить ресурсы.',
      impact:'Команда выгорает, качество падает', affectedCount: m.overtime.length,
      filter:{release:'ot'}, actionType:'show' });
  }
  if (Object.keys(state.epicDeps || {}).length === 0 && m.total > 10) {
    items.push({ id:'feed_no_deps', severity:'info', icon:'crosshair',
      title:'Добавить зависимости между эпиками',
      explanation:'Без карты зависимостей критический путь неизвестен. AI не может предупредить о cascade-рисках.',
      impact:'Скрытые зависимости = скрытые риски', affectedCount: 0,
      filter:null, actionType:'explain' });
  }

  return { id:'ceo_action_feed', kind:'ceo', items, source:'rule-based' };
}

/* ─────────────────────────────────────────────────────────── */
/* COMPAT EXPORTS — для thin wrappers                         */
/* ─────────────────────────────────────────────────────────── */

/** Совместимость со старым aiFallbackEngine.runAllBlocks(rows). */
export function runAllAnalysisBlocks(rows) {
  return {
    health:            computeProjectHealth(rows),
    forecast:          computeForecast(rows),
    ifNothingChanges:  computeIfNothingChangesAnalysis(rows),
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

/** Совместимость со старым aiCeoFallback.runAllCeoBlocks(rows). */
export function runAllCeoBlocks(rows) {
  if (!rows || !rows.length) return null;
  const m = buildBlockData({ rows, kind: 'ceo' });
  if (!m.total) return null;
  return {
    metrics:          m,
    health:           computeCeoHealth(rows),
    ifNothingChanges: computeCeoIfNothingChanges(rows),
    hardTruths:       computeCeoHardTruths(rows),
    saveRelease:      computeCeoSaveTheRelease(rows),
    actionFeed:       computeCeoActionFeed(rows)?.items || [],
  };
}

/* default export — namespace для удобства */
export const UnifiedFallbackEngine = {
  buildBlockData,
  // analysis
  computeProjectHealth, computeForecast, computeIfNothingChangesAnalysis,
  computeDependencyAnalysis, computeSmartReplanning, computeBottlenecks,
  computeRiskNarrative, computePrioritization, computeDynamicDashboard,
  computeAnomalies, computePlanQuality, computeSecondOpinion, computeRecommendations,
  // ceo
  computeCeoHealth, computeCeoIfNothingChanges, computeCeoHardTruths,
  computeCeoSaveTheRelease, computeCeoActionFeed,
  // compat
  runAllAnalysisBlocks, runAllCeoBlocks,
};

export default UnifiedFallbackEngine;
