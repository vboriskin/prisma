'use strict';
/* ============================================================
   ROW FACTORY — v8_0 ES module
   ============================================================ */

import { Utils, nextId } from './utils.js';
import { RiskEngine } from './riskEngine.js';

export const RowFactory = {
  create(ov={}) {
    const now = new Date().toISOString();
    const row = {
      id: nextId(), sourceType:'', sourceSheet:'', team:'',
      category:'', epic:'',
      backend:'', frontend:'', analytics_estimate:'', testing_estimate:'', total_estimate:'',
      tasks:'', taskComment:'', teamDependency:'', risks:'',
      release120Raw:'', release121Raw:'', release122Raw:'', overtimeRaw:'',
      release120Types:[], release121Types:[], release122Types:[], overtimeTypes:[],
      hasRelease120:false, hasRelease121:false, hasRelease122:false, hasOvertime:false, isUnassigned:true,
      scopeStatus:'', role:'',
      blockingDependency:false, blockingDeadline:'',
      commitToCounterparty:false, commitDate:'',
      // V15: `unplannedPills` is a per-pill flag map keyed by `<colKey>__<wt>`,
      // mirroring `donePills`. A truthy value marks the pill as «not planned»
      // — it stays visible in the gantt but renders dashed/dimmed with a
      // ⚐ prefix. Toggled via the gantt context menu.
      isDone:false, doneDate:'', backlogTypes:[], donePills:{}, unplannedPills:{}, ganttArrows:[],
      // V15 (Spine redesign 2026-04-30): per-pill assignee map keyed by
      // `<colKey>__<wt>`. Mirrors `donePills` / `unplannedPills`. Value =
      // FIO string (pipe-separated for multi-assignee). Read priority:
      // per-pill if set → fallback to row.assignee. Writes go ONLY here so
      // assigning «Иванов» to a single pill doesn't broadcast to the whole
      // row (which was the old V14 behaviour the user flagged as a bug).
      assigneePills:{},
      // V15 (Spine redesign 2026-04-30): per-pill «in-progress» flag.
      // Pills are now «To Do» by default — only flip to «В работе» when
      // the user explicitly says so via the gantt ctx-menu. Earlier
      // builds rendered every active pill as «● в работе», which made
      // the gantt look busier than the team actually was.
      inProgressPills:{},
      comment:'', dirty:true, riskFlags:[],
      // V15 (audit#1, system H1): `tags` was used by Registry import + the
      // assign-employee role-filter, but never declared as a default. For
      // in-app-created rows it would be undefined → `String(row.tags||'')`
      // returned '' → role filter silently bypassed. Now declared = ''.
      tags:'',
      workPeriodStart:'', workPeriodEnd:'', assignee:'', rowColor:'',
      // V14 (B5/B6/B7): plan-lock comment trail + work-date overrides +
      // factual completion fields. All optional — older rows without them
      // get undefined / empty defaults via createRow().
      transferComments: [],   // [{at, from, to, wt?, text}]
      workStartDate: '',
      workEndDate: '',
      actualDoneDate: '',
      doneComment: '',
      assignedAt: '',
      createdAt:now, updatedAt:now,
    };
    Object.assign(row, ov);
    RowFactory.updateDerived(row);
    return row;
  },
  updateDerived(row) {
    // Keep work period consistent for timeline math.
    if (row.workPeriodStart && row.workPeriodEnd) {
      const s = new Date(row.workPeriodStart);
      const e = new Date(row.workPeriodEnd);
      if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && s > e) {
        const tmp = row.workPeriodStart;
        row.workPeriodStart = row.workPeriodEnd;
        row.workPeriodEnd = tmp;
      }
    }
    row.hasRelease120 = !!(row.release120Types && row.release120Types.length);
    row.hasRelease121 = !!(row.release121Types && row.release121Types.length);
    row.hasRelease122 = !!(row.release122Types && row.release122Types.length);
    row.hasOvertime   = !!(row.overtimeTypes   && row.overtimeTypes.length);
    row.isUnassigned  = !row.hasRelease120 && !row.hasRelease121 && !row.hasRelease122 && !row.hasOvertime;
    row.release120Raw = (row.release120Types||[]).join(', ');
    row.release121Raw = (row.release121Types||[]).join(', ');
    row.release122Raw = (row.release122Types||[]).join(', ');
    row.overtimeRaw   = (row.overtimeTypes||[]).join(', ');
    RiskEngine.computeFlags(row);
    RiskEngine.computeRiskScore(row);
  },
};

export const EmployeeFactory = {
  create(ov={}) {
    const now = new Date().toISOString();
    const emp = {
      id: 'emp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,7),
      fio: '',
      roles: '',
      teams: '',
      overtimeDays: [],
      weekdayReady: false,
      weekdayComment: '',
      // V17.2 I1a — deterministic identity для интеграций. Привязка
      //   PR/commit/comment-автора к сотруднику теперь требует ЛИБО точного
      //   совпадения email, ЛИБО одного из этих ID. Fuzzy-match по FIO
      //   запрещён (приводил к ложным atribuциям сотрудникам без BB-аккаунта).
      //   Все поля опциональны: пустая строка = «у этого сотрудника нет этой
      //   интеграции» — портфолио-агрегатор просто не привязывает к нему
      //   данные из соответствующего источника.
      email: '',
      jiraAccountId: '',
      bitbucketLogin: '',
      confluenceAccountId: '',
      sourceType: 'manual',
      createdAt: now,
      updatedAt: now,
    };
    Object.assign(emp, ov);
    EmployeeFactory.normalize(emp);
    return emp;
  },
  normalize(emp) {
    emp.fio = String(emp.fio || '').trim();
    emp.roles = String(emp.roles || '').split(/[|,]/).map(s=>s.trim()).filter(Boolean).join('|');
    emp.teams = String(emp.teams || '').split(/[|,]/).map(s=>s.trim()).filter(Boolean).join('|');
    if (!Array.isArray(emp.overtimeDays)) emp.overtimeDays = Utils.parseDateList(emp.overtimeDays);
    emp.overtimeDays = [...new Set(emp.overtimeDays.map(d=>Utils.parseDateish(d)||d).filter(Boolean))].sort();
    emp.weekdayReady = Utils.toBool(emp.weekdayReady,false);
    emp.weekdayComment = String(emp.weekdayComment || '').split(/[|,]/).map(s=>s.trim()).filter(Boolean).join('|');
    // V17.2 I1a — identity-поля: trim + lowercase email, остальные trim only.
    emp.email               = String(emp.email               || '').trim().toLowerCase();
    emp.jiraAccountId       = String(emp.jiraAccountId       || '').trim();
    emp.bitbucketLogin      = String(emp.bitbucketLogin      || '').trim();
    emp.confluenceAccountId = String(emp.confluenceAccountId || '').trim();
    emp.updatedAt = new Date().toISOString();
  },
};
