'use strict';
/* ============================================================
   integrations/release2/release2Model.js — V22+ (Release 2.0)

   Normalize raw Jira issue (output `jira-fetch-all`-like) → typed
   model для UI. Идемпотентный, pure (без side-effects).

   Public API:
     analyseRelease2(rawIssue) → ReleaseModel
     analyseRelease2List(rawIssues, opts?) → { releases, byProject, byStatus, byOwner, stats }
     extractLinkedSummaries(rawIssue) → { stories, bugs, sub, partOf, cloners }

   Model shape:
     {
       key, summary, project, status, priority, type,
       reporter, assignee, organizer, approver,
       configElement[], distribCE[], service[],
       polygonUAT, polygonIFT,
       distribUrl, distribDecomm[],
       riskAuto, riskLevel,
       canaryKind, securityPatch, modelRelease, omniRelease,
       regressNeeded, iftConclusion, ntRequired, ntConclusion,
       fpdProcessed, fpdComment,
       uatGoal, uatResult, ppsiApprovedAt,
       tsAndSpo, specialConditions, operationCond, ppsiComment,
       critIssues, nonCritIssues, uatScenario,
       standLocation, uatInvited[],
       dates: { planFixation, planIFTStart, planIFTEnd, planNTStart, planNTEnd,
                planRegression, planUATStart, planUATEnd, planDeployStart,
                planProdEnd, factUATStart, factUATEnd, factProdDate },
       created, updated,
       labels[], components[],
       _links: { partOf[], bugs[], cloners[], outward[], inward[] },
       _subtasks: [{key, summary, status, assignee}],
       _attachments: [{filename, url, size, created, author}],
       _phase, _phaseColor,
       _riskRank, _typeRank,
       _statusOrderIndex,
       _meta: { jiraKey, projectKey, raw, _ts },
     }
   ============================================================ */

import { FIELD_BY_ID, STATUS_PHASES, STATUS_ORDER, RISK_RANK, RELEASE_TYPES } from './release2Fields.js';

/* ─────────────────────────────────────────────────────────────
   Per-kind normalizers
   ───────────────────────────────────────────────────────────── */

function _normOption(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.trim() || null;
  return v.value || v.name || null;
}

function _normOptionArr(v) {
  if (!Array.isArray(v)) return [];
  return v.map(_normOption).filter(Boolean);
}

/**
 * V22+ Phase 5.2 — [В]/[B]/[Х]/[X] suffix detection.
 * См. ~/.claude/.../memory/feedback_blocked_users.md: эти суффиксы означают
 * уволенных сотрудников. UI-политика: muted-render в индивид-полях +
 * silent-filter в aggregates (owners-card etc).
 */
const _BLOCKED_RE = /\s*\[\s*[ХXВB]\s*\]\s*$/i;

function _normUser(v) {
  if (!v) return null;
  const rawDisplay = v.displayName || v.name || '';
  const isBlocked = _BLOCKED_RE.test(rawDisplay);
  const displayName = rawDisplay.replace(_BLOCKED_RE, '').trim();
  return {
    name: (v.name || v.key || '').replace(_BLOCKED_RE, '').trim(),
    displayName: displayName || rawDisplay,
    email: v.emailAddress || '',
    accountId: v.accountId || '',
    isBlocked,
  };
}

function _normUserArr(v) {
  if (!Array.isArray(v)) return [];
  return v.map(_normUser).filter(Boolean);
}

function _normDate(v) {
  if (!v) return null;
  if (typeof v !== 'string') return null;
  return v;  // храним ISO как есть, форматирование — в UI
}

function _normRichText(v) {
  if (!v) return null;
  if (typeof v !== 'string') return null;
  return v.trim() || null;
}

/** Распарсить КЭ/КЭ-дистрибутива/service-как массив объектов. */
function _normKgArr(v) {
  if (!Array.isArray(v)) return [];
  return v.map(item => {
    if (!item || typeof item !== 'object') return null;
    return {
      id: item.id || '',
      value: item.value || item.name || '',
      url: item.url || '',
      version: item.version || '',
      maturityLevel: item.maturityLevel || '',
      statusDetailed: item.statusDetailed || '',
    };
  }).filter(Boolean);
}

/* ─────────────────────────────────────────────────────────────
   Field dispatcher
   ───────────────────────────────────────────────────────────── */

function _normField(fieldMeta, raw) {
  if (raw === undefined || raw === null) return null;
  switch (fieldMeta.kind) {
    case 'string':    return typeof raw === 'string' ? raw.trim() || null : String(raw);
    case 'rich':      return _normRichText(raw);
    case 'date':
    case 'datetime':  return _normDate(raw);
    case 'option':    return _normOption(raw);
    case 'options[]': return _normOptionArr(raw);
    case 'user':      return _normUser(raw);
    case 'users[]':   return _normUserArr(raw);
    case 'kg[]':
    case 'distrib[]':
    case 'service[]': return _normKgArr(raw);
    default:          return raw;
  }
}

/* ─────────────────────────────────────────────────────────────
   Linked issues extraction
   ───────────────────────────────────────────────────────────── */

/**
 * Из raw.fields.issuelinks извлекает 5 категорий:
 *   partOf  — Story в составе релиза (inward "PartOf")
 *   bugs    — баги релиза (inward/outward "Bugs")
 *   cloners — клоны (любое направление "Cloners")
 *   outward — остальные outward-связи
 *   inward  — остальные inward-связи
 */
export function extractLinkedSummaries(raw) {
  const out = { partOf: [], bugs: [], cloners: [], outward: [], inward: [] };
  const links = raw?.fields?.issuelinks || [];
  for (const l of links) {
    const t = l?.type || {};
    const tname = String(t.name || '');
    const direction = l.outwardIssue ? 'out' : 'in';
    const target = l.outwardIssue || l.inwardIssue || {};
    const item = {
      key: target.key || '',
      summary: target.fields?.summary || '',
      status: target.fields?.status?.name || '',
      issuetype: target.fields?.issuetype?.name || '',
      priority: target.fields?.priority?.name || '',
      direction,
      linkType: tname,
    };
    if (!item.key) continue;
    if (tname === 'PartOf') {
      out.partOf.push(item);
    } else if (tname === 'Bugs') {
      out.bugs.push(item);
    } else if (tname === 'Cloners') {
      out.cloners.push(item);
    } else if (direction === 'out') {
      out.outward.push(item);
    } else {
      out.inward.push(item);
    }
  }
  return out;
}

function _extractSubtasks(raw) {
  const subs = raw?.fields?.subtasks || [];
  return subs.map(s => ({
    key: s?.key || '',
    summary: s?.fields?.summary || '',
    status: s?.fields?.status?.name || '',
    assignee: _normUser(s?.fields?.assignee),
  })).filter(s => s.key);
}

function _extractAttachments(raw) {
  const arr = raw?.fields?.attachment || [];
  return arr.map(a => ({
    id: a?.id || '',
    filename: a?.filename || '',
    url: a?.content || '',
    size: Number(a?.size || 0),
    created: a?.created || '',
    mimeType: a?.mimeType || '',
    author: _normUser(a?.author),
  })).filter(a => a.filename);
}

/* ─────────────────────────────────────────────────────────────
   Main analyser
   ───────────────────────────────────────────────────────────── */

/**
 * @param {object} raw — full Jira issue payload
 * @returns {object} ReleaseModel
 */
export function analyseRelease2(raw) {
  if (!raw || !raw.key) return null;
  const f = raw.fields || {};

  const model = {
    key: raw.key,
    id: raw.id || '',
    self: raw.self || '',
    summary: f.summary || '',
    project: {
      key: f.project?.key || '',
      name: f.project?.name || '',
    },
    status: f.status?.name || '',
    priority: f.priority?.name || '',
    issuetype: f.issuetype?.name || '',
    reporter: _normUser(f.reporter),
    assignee: _normUser(f.assignee),
    created: f.created || '',
    updated: f.updated || '',
    duedate: f.duedate || null,
    labels: Array.isArray(f.labels) ? f.labels.slice() : [],
    components: (f.components || []).map(c => c?.name).filter(Boolean),
    fixVersions: (f.fixVersions || []).map(v => v?.name).filter(Boolean),
  };

  // Custom-fields dispatch.
  const unknownFields = [];
  for (const [fid, val] of Object.entries(f)) {
    if (!fid.startsWith('customfield_')) continue;
    const meta = FIELD_BY_ID[fid];
    if (!meta) {
      // Не из mapping — оставляем как surplus для diagnostics, но не теряем raw.
      if (val !== null && val !== undefined && val !== '' &&
          !(Array.isArray(val) && val.length === 0) &&
          !(typeof val === 'object' && Object.keys(val).length === 0)) {
        unknownFields.push(fid);
      }
      continue;
    }
    model[meta.key] = _normField(meta, val);
  }

  // ── Группировка дат в model.dates ──
  const DATE_KEYS = [
    'planFixation', 'planIFTStart', 'planIFTEnd', 'planNTStart', 'planNTEnd',
    'planRegression', 'planUATStart', 'planUATEnd', 'planDeployStart', 'planProdEnd',
    'factUATStart', 'factUATEnd', 'factProdDate',
  ];
  model.dates = {};
  for (const k of DATE_KEYS) {
    model.dates[k] = model[k] || null;
    delete model[k];
  }

  // ── Алиасы для UI (organizer, approver) ──
  model.organizer = model.uatOrganizer || null;
  model.approver  = model.approver || null;

  // ── Связи и подзадачи ──
  model._links     = extractLinkedSummaries(raw);
  model._subtasks  = _extractSubtasks(raw);
  model._attachments = _extractAttachments(raw);

  // ── Derived ──
  model._phase     = STATUS_PHASES[model.status] || 'unknown';
  model._statusOrderIndex = (() => {
    const i = STATUS_ORDER.indexOf(model.status);
    return i >= 0 ? i : 999;
  })();
  model._typeRank  = RELEASE_TYPES.indexOf(model.type);
  model._riskRank  = RISK_RANK[model.riskAuto || model.riskLevel] || 0;

  // ── Late flags ──
  model._flags = _computeFlags(model);

  // ── Meta ──
  model._meta = {
    jiraKey: raw.key,
    projectKey: f.project?.key || '',
    _ts: Date.now(),
    unknownFieldsCount: unknownFields.length,
  };

  return model;
}

/* ─────────────────────────────────────────────────────────────
   Flag computation (для alerts/highlights)
   ───────────────────────────────────────────────────────────── */

function _computeFlags(model) {
  const flags = [];
  const now = Date.now();
  const DAY = 86400_000;

  // Скоро ПСИ (3 дня) — Doп. предложение #3
  if (model.dates?.planUATStart) {
    const ts = Date.parse(model.dates.planUATStart);
    if (Number.isFinite(ts)) {
      const days = (ts - now) / DAY;
      if (days >= 0 && days <= 3) flags.push({ kind: 'uat-soon', daysLeft: Math.ceil(days) });
    }
  }
  // Скоро ПРОМ (7 дней) — Doп. предложение #3
  if (model.dates?.planProdEnd) {
    const ts = Date.parse(model.dates.planProdEnd);
    if (Number.isFinite(ts)) {
      const days = (ts - now) / DAY;
      if (days >= 0 && days <= 7) flags.push({ kind: 'prod-soon', daysLeft: Math.ceil(days) });
    }
  }
  // ФПД-блокировка (custom field может отсутствовать)
  if (model.status === 'Установка на ПРОМ' && model.fpdProcessed && model.fpdProcessed !== 'Да') {
    flags.push({ kind: 'fpd-blocked' });
  }

  return flags;
}

/* ─────────────────────────────────────────────────────────────
   List analyser (aggregator + group-by)
   ───────────────────────────────────────────────────────────── */

/**
 * @param {Array} rawIssues — Jira-issue payloads
 * @param {object} opts
 * @returns {object}
 */
export function analyseRelease2List(rawIssues, opts = {}) {
  const list = (rawIssues || [])
    .map(analyseRelease2)
    .filter(Boolean);

  // Group-by helpers
  const byProject = _groupBy(list, r => r.project?.name || r.project?.key || '—');
  const byStatus  = _groupBy(list, r => r.status || '—');
  const byOwner   = _groupBy(list, r => r.organizer?.displayName || r.assignee?.displayName || '—');

  // Stats для stat-bar (Доп предложение #1)
  const stats = _computeStats(list);

  return {
    releases: list,
    byProject,
    byStatus,
    byOwner,
    stats,
    fetchedAt: opts.fetchedAt || new Date().toISOString(),
    jql: opts.jql || null,
    totalRaw: rawIssues?.length || 0,
  };
}

function _groupBy(list, keyFn) {
  const out = new Map();
  for (const item of list) {
    const k = keyFn(item) || '—';
    const arr = out.get(k) || [];
    arr.push(item);
    out.set(k, arr);
  }
  return out;
}

function _computeStats(list) {
  const total = list.length;
  const byPhase = { creation: 0, stabilize: 0, uat: 0, approve: 0, deploy: 0, cancel: 0, unknown: 0 };
  const byRisk = {};
  const byType = {};
  let upcomingUAT = 0;       // плановая ПСИ ≤ 3 дня
  let upcomingProd = 0;      // плановая ПРОМ ≤ 7 дней

  for (const r of list) {
    byPhase[r._phase] = (byPhase[r._phase] || 0) + 1;
    if (r.riskAuto || r.riskLevel) {
      const k = r.riskAuto || r.riskLevel;
      byRisk[k] = (byRisk[k] || 0) + 1;
    }
    if (r.type) byType[r.type] = (byType[r.type] || 0) + 1;
    for (const f of r._flags || []) {
      if (f.kind === 'uat-soon') upcomingUAT++;
      else if (f.kind === 'prod-soon') upcomingProd++;
    }
  }

  return { total, byPhase, byRisk, byType, upcomingUAT, upcomingProd };
}

/* ─────────────────────────────────────────────────────────────
   Diff for "what changed since last fetch" (Доп. #9)
   ───────────────────────────────────────────────────────────── */

/**
 * @param {Array} prev — previous releases list
 * @param {Array} curr — current releases list
 * @returns {{added, removed, changed}}
 */
export function diffRelease2Lists(prev, curr) {
  const prevMap = new Map((prev || []).map(r => [r.key, r]));
  const currMap = new Map((curr || []).map(r => [r.key, r]));

  const added = [];
  const removed = [];
  const changed = [];

  for (const [k, c] of currMap) {
    const p = prevMap.get(k);
    if (!p) { added.push(c); continue; }
    // Сравниваем критичные поля.
    const deltas = [];
    if (p.status !== c.status) deltas.push({ field: 'status', from: p.status, to: c.status });
    if (p.priority !== c.priority) deltas.push({ field: 'priority', from: p.priority, to: c.priority });
    if ((p.riskAuto || '') !== (c.riskAuto || '')) deltas.push({ field: 'riskAuto', from: p.riskAuto, to: c.riskAuto });
    if ((p.dates?.planProdEnd || '') !== (c.dates?.planProdEnd || '')) {
      deltas.push({ field: 'planProdEnd', from: p.dates?.planProdEnd, to: c.dates?.planProdEnd });
    }
    if ((p._links?.partOf?.length || 0) !== (c._links?.partOf?.length || 0)) {
      deltas.push({ field: 'partOfCount', from: p._links?.partOf?.length, to: c._links?.partOf?.length });
    }
    if (deltas.length) changed.push({ key: k, deltas, current: c });
  }
  for (const [k, p] of prevMap) {
    if (!currMap.has(k)) removed.push(p);
  }
  return { added, removed, changed };
}
