'use strict';
/* ============================================================
   JIRA HYGIENE ENGINE — V23 (2026-05-11) + V22+ extension (2026-05-17)
   --
   Цель: тимлид утром видит «73/100 гигиена. 12 задач без assignee,
   5 zombie, 3 без оценки». Один клик → список → bulk-fix.

   Engine = pure functions:
     · runHygieneRules(model) → { score, violations: [{ rule, severity, items: [...] }] }
     · RULES — массив правил, каждое: { id, label, severity, check(model) }

   Engine не делает HTTP, не зависит от DOM. Renderer и orchestrator
   импортируют отсюда.

   Rules V23 MVP (12 шт): D-01…D-12.
   V22+ extension (2026-05-17): добавлено 8 новых правил D-13..D-22.
     Skip по запросу user'а: правила про эпики (D-15/D-16), composite
     и type-specific. Эпики — агрегация, мало смысла анализировать.

   Score: 100 - sum(weight × violation_count_normalized).
   ============================================================ */

import { isTerminalStatus, isInitialStatus } from './portfolioPulseUtils.js';

const DEFAULT_THRESHOLDS = {
  inProgressDaysCritical: 5,
  inReviewDaysCritical: 3,
  estimateDriftRatio: 2.0,
  reopenCountCritical: 2,
  silentDays: 7,                 // D-14: in-progress/review без апдейта > N дней
  sprintHistoryCarryOver: 3,     // D-18: ≥ N спринтов carry-over
  sprintOverloadSP: 15,          // D-13: суммарно SP на assignee
  labelClutter: 7,               // D-22: max labels per issue
  descStubMaxLen: 50,            // D-21: description ≤ 50 chars и заглушка
};

/** Active issue = НЕ в terminal/done state. Используем portfolioPulseUtils. */
function _isActive(issue) {
  return !isTerminalStatus(issue?.status || '', issue?.statusCat || '');
}
/** Working issue = НЕ terminal И НЕ initial (todo/backlog). Для D-01. */
function _isWorking(issue) {
  return _isActive(issue) && !isInitialStatus(issue?.status || '', issue?.statusCat || '');
}
const _SUBTASK_RX = /sub-?task|подзадача/i;
function _isSubtask(issue) {
  return _SUBTASK_RX.test(String(issue?.type || ''));
}
const _STUB_RX = /^\s*(todo|tbd|—|fixme|описать|tba|n\/a|—)\s*$/i;

const RULES = [
  {
    id: 'D-01',
    label: 'Без исполнителя',
    severity: 'warn',
    weight: 8,
    // V22+ fix: только working issues (не в todo и не в terminal).
    // По запросу user'а — backlog без исполнителя это норма, важны только активные.
    check: (model) => {
      const issues = _collectActiveIssues(model);
      return issues
        .filter(i => _isWorking(i) && (!i.assignee || !i.assignee.name))
        .map(_issueRef);
    },
  },
  {
    id: 'D-02',
    label: 'Без оценки (story points)',
    severity: 'info',
    weight: 4,
    // V22+ fix: только Story. Bug/Task/Sub-task оценки часто не имеют — норма.
    check: (model) => {
      const issues = _collectActiveIssues(model);
      return issues
        .filter(i => /^story$/i.test(String(i.type || '')) && _isActive(i) && !i.storyPoints)
        .map(_issueRef);
    },
  },
  {
    id: 'D-03',
    label: 'Без эпика',
    severity: 'info',
    weight: 3,
    check: (model) => {
      const issues = _collectActiveIssues(model);
      return issues
        .filter(i => !i.epicKey && i.type !== 'Epic' && i.statusCat !== 'done')
        .map(_issueRef);
    },
  },
  {
    id: 'D-04',
    label: 'В работе >5 дней',
    severity: 'warn',
    weight: 6,
    check: (model, thresholds) => {
      const days = thresholds?.inProgressDaysCritical ?? DEFAULT_THRESHOLDS.inProgressDaysCritical;
      const cutoff = Date.now() - days * 24 * 3600 * 1000;
      const issues = _collectActiveIssues(model);
      return issues
        .filter(i => i.statusCat === 'inprogress' && _statusEnteredTs(i) < cutoff)
        .map(_issueRef);
    },
  },
  {
    id: 'D-05',
    label: 'In Review >3 дней (zombie)',
    severity: 'warn',
    weight: 7,
    check: (model, thresholds) => {
      const days = thresholds?.inReviewDaysCritical ?? DEFAULT_THRESHOLDS.inReviewDaysCritical;
      const cutoff = Date.now() - days * 24 * 3600 * 1000;
      const issues = _collectActiveIssues(model);
      return issues
        .filter(i => /review/i.test(i.status || '') && _statusEnteredTs(i) < cutoff)
        .map(_issueRef);
    },
  },
  {
    id: 'D-06',
    label: 'Backlog при активном спринте (sprint-leak)',
    severity: 'info',
    weight: 3,
    check: (model) => {
      const hasActiveSprint = Boolean(model?.activeSprintInfo?.sprintId);
      if (!hasActiveSprint) return [];
      const issues = _collectActiveIssues(model);
      return issues
        .filter(i => i.statusCat === 'new' && !i.sprintId && i.priority !== 'Low')
        .map(_issueRef);
    },
  },
  {
    id: 'D-07',
    label: 'Re-opened ≥2 раза',
    severity: 'warn',
    weight: 5,
    check: (model, thresholds) => {
      const min = thresholds?.reopenCountCritical ?? DEFAULT_THRESHOLDS.reopenCountCritical;
      const issues = _collectActiveIssues(model);
      return issues
        .filter(i => (i.reopenCount || 0) >= min)
        .map(_issueRef);
    },
  },
  {
    id: 'D-08',
    label: 'Bug без severity / priority',
    severity: 'info',
    weight: 3,
    check: (model) => {
      const issues = _collectActiveIssues(model);
      return issues
        .filter(i => /bug/i.test(i.type || '') && !i.severity && !i.priority)
        .map(_issueRef);
    },
  },
  {
    id: 'D-09',
    label: 'Estimate drift (actual/estimate >2×)',
    severity: 'info',
    weight: 3,
    check: (model, thresholds) => {
      const ratio = thresholds?.estimateDriftRatio ?? DEFAULT_THRESHOLDS.estimateDriftRatio;
      const issues = _collectActiveIssues(model);
      return issues.filter(i => {
        const est = Number(i.estimateHours) || 0;
        const actual = Number(i.actualHours) || 0;
        return est > 0 && actual > 0 && (actual / est) > ratio;
      }).map(_issueRef);
    },
  },
  {
    id: 'D-10',
    label: 'Дублирующие titles',
    severity: 'info',
    weight: 2,
    // V22+ fix: исключить sub-tasks. Sub-tasks типа «CLONE — Test Review»
    // легитимно повторяются 100+ раз — это template-имя.
    check: (model) => {
      const issues = _collectActiveIssues(model);
      const counts = new Map();
      for (const i of issues) {
        if (_isSubtask(i)) continue;
        const k = String(i.summary || '').trim().toLowerCase().slice(0, 80);
        if (!k) continue;
        const arr = counts.get(k) || [];
        arr.push(i);
        counts.set(k, arr);
      }
      const dups = [];
      for (const arr of counts.values()) {
        if (arr.length >= 2) dups.push(...arr);
      }
      return dups.map(_issueRef);
    },
  },
  {
    id: 'D-11',
    label: 'Без description',
    severity: 'info',
    weight: 2,
    check: (model) => {
      const issues = _collectActiveIssues(model);
      return issues
        .filter(i => i.statusCat !== 'done' && (!i.description || i.description.length < 10))
        .map(_issueRef);
    },
  },
  {
    id: 'D-12',
    label: 'Carry-over из прошлого спринта',
    severity: 'warn',
    weight: 5,
    check: (model) => {
      const issues = _collectActiveIssues(model);
      return issues
        .filter(i => i.statusCat !== 'done' && (i.sprintHistory?.length || 0) >= 2)
        .map(_issueRef);
    },
  },

  /* ─── V22+ extension (2026-05-17) — 8 new rules ─────────────────
     Skip per user: D-15/16 (про эпики), composite, type-specific. */

  {
    id: 'D-13',
    label: 'Sprint-overload (>15 SP у одного)',
    severity: 'crit',
    weight: 9,
    // Burnout-индикатор: assignee с суммарными SP > 15 в active спринте.
    // Если несколько таких — каждое (assignee, summary-issue) попадает отдельной строкой.
    check: (model, thresholds) => {
      const maxSP = thresholds?.sprintOverloadSP ?? DEFAULT_THRESHOLDS.sprintOverloadSP;
      const issues = _collectActiveIssues(model);
      // Map<assigneeKey, { name, sp, items[] }>
      const perAssignee = new Map();
      for (const i of issues) {
        if (!_isActive(i)) continue;
        const sp = Number(i.storyPoints) || 0;
        if (sp <= 0) continue;
        const key = i.assignee?.name || i.assignee?.email || '';
        if (!key) continue;
        const entry = perAssignee.get(key) || { name: key, sp: 0, items: [] };
        entry.sp += sp;
        entry.items.push(i);
        perAssignee.set(key, entry);
      }
      const flagged = [];
      for (const e of perAssignee.values()) {
        if (e.sp > maxSP) flagged.push(...e.items);
      }
      return flagged.map(_issueRef);
    },
  },
  {
    id: 'D-14',
    label: 'Тихая задача (>7д без апдейта)',
    severity: 'warn',
    weight: 7,
    // Active issue (in-progress / review) без updatedTs > N дней.
    // «Забыли» или человек в отпуске.
    check: (model, thresholds) => {
      const days = thresholds?.silentDays ?? DEFAULT_THRESHOLDS.silentDays;
      const cutoff = Date.now() - days * 24 * 3600 * 1000;
      const issues = _collectActiveIssues(model);
      return issues
        .filter(i => {
          if (!_isActive(i) || isInitialStatus(i.status || '', i.statusCat || '')) return false;
          const ts = Number(i.updatedTs) || 0;
          return ts > 0 && ts < cutoff;
        })
        .map(_issueRef);
    },
  },
  {
    id: 'D-17',
    label: 'Sub-task без parent / эпика',
    severity: 'warn',
    weight: 5,
    // Sub-task без epicKey и без parent — orphan, потеряется при rollup.
    check: (model) => {
      const issues = _collectActiveIssues(model);
      return issues
        .filter(i => _isSubtask(i) && !i.epicKey && !i.parentKey)
        .map(_issueRef);
    },
  },
  {
    id: 'D-18',
    label: 'Спринт-старожил (≥3 спринтов)',
    severity: 'crit',
    weight: 8,
    // Задача переезжает 3+ спринта подряд — переоценена или не нужна.
    check: (model, thresholds) => {
      const minSprints = thresholds?.sprintHistoryCarryOver ?? DEFAULT_THRESHOLDS.sprintHistoryCarryOver;
      const issues = _collectActiveIssues(model);
      return issues
        .filter(i => _isActive(i) && (i.sprintHistory?.length || 0) >= minSprints)
        .map(_issueRef);
    },
  },
  {
    id: 'D-19',
    label: 'Mismatch: команда ↔ компонент',
    severity: 'info',
    weight: 4,
    // Issue в projectKey=A с component, чей префикс/owner = B.
    // Скрытое cross-team, путаница в attribution.
    // Heuristic: если components[i].name содержит другой projectKey из model.
    check: (model) => {
      const knownPks = new Set(
        (model?.projectKeys || []).concat(
          model?.spaces ? Object.keys(model.spaces) : []
        ).filter(Boolean).map(k => String(k).toUpperCase())
      );
      if (knownPks.size < 2) return [];   // single-team — нечего сравнивать
      const issues = _collectActiveIssues(model);
      return issues
        .filter(i => {
          if (!_isActive(i)) return false;
          const pk = String(i.projectKey || '').toUpperCase();
          if (!pk || !knownPks.has(pk)) return false;
          const components = Array.isArray(i.components) ? i.components : [];
          for (const c of components) {
            const cn = String(c?.name || c || '').toUpperCase();
            for (const otherPk of knownPks) {
              if (otherPk === pk) continue;
              if (cn.includes(otherPk)) return true;
            }
          }
          return false;
        })
        .map(_issueRef);
    },
  },
  {
    id: 'D-20',
    label: 'Critical / Blocker без исполнителя',
    severity: 'crit',
    weight: 10,
    // Самое срочное никто не делает — операционный риск №1.
    // Один Blocker без owner = ночной инцидент.
    check: (model) => {
      const issues = _collectActiveIssues(model);
      return issues
        .filter(i => {
          if (!_isActive(i)) return false;
          const pr = String(i.priority || '').toLowerCase();
          const isCrit = pr.includes('critical') || pr.includes('blocker') || pr.includes('крит') || pr.includes('блок');
          return isCrit && (!i.assignee || !i.assignee.name);
        })
        .map(_issueRef);
    },
  },
  {
    id: 'D-21',
    label: 'Description-заглушка (TODO / TBD)',
    severity: 'info',
    weight: 2,
    // Формально description есть, фактически — TODO/TBD/UPPERCASE/—.
    // Обходит D-11 «без description» т.к. длина ≥10.
    check: (model, thresholds) => {
      const maxLen = thresholds?.descStubMaxLen ?? DEFAULT_THRESHOLDS.descStubMaxLen;
      const issues = _collectActiveIssues(model);
      return issues
        .filter(i => {
          if (!_isActive(i)) return false;
          const d = String(i.description || '').trim();
          if (!d || d.length > maxLen) return false;
          return _STUB_RX.test(d) || /^[A-ZА-Я\s]+$/.test(d);  // только uppercase
        })
        .map(_issueRef);
    },
  },
  {
    id: 'D-22',
    label: 'Метки-помойка (>7 labels)',
    severity: 'info',
    weight: 2,
    // Issue с >7 labels — шум в фильтрах, теряется навигация.
    check: (model, thresholds) => {
      const maxLabels = thresholds?.labelClutter ?? DEFAULT_THRESHOLDS.labelClutter;
      const issues = _collectActiveIssues(model);
      return issues
        .filter(i => Array.isArray(i.labels) && i.labels.length > maxLabels)
        .map(_issueRef);
    },
  },
];

function _collectActiveIssues(model) {
  if (!model || !model.spaces) return [];
  const out = [];
  for (const space of Object.values(model.spaces)) {
    for (const issue of (space.issues || [])) {
      if (issue) out.push(issue);
    }
  }
  return out;
}

function _statusEnteredTs(issue) {
  const ts = Number(issue?.statusEnteredTs || issue?.updatedTs || 0);
  return Number.isFinite(ts) ? ts : Date.now();
}

function _issueRef(i) {
  return {
    key:      String(i.key || ''),
    summary:  String(i.summary || '').slice(0, 120),
    status:   String(i.status || ''),
    type:     String(i.type || ''),
    assignee: i.assignee?.name || '',
    pk:       String(i.projectKey || ''),
  };
}

/**
 * Run all rules. Returns:
 *   { score: 0-100, violations: [{ rule, severity, weight, items[], count }] }
 *
 * Score formula: 100 - sum(min(rule.weight, weight × items.length / max(team_size, 10))).
 * Capped 0-100.
 */
export function runHygieneRules(model, opts = {}) {
  const thresholds = opts.thresholds || {};
  const teamSize = Math.max(10, (model?.participants || []).length);
  const violations = RULES
    .filter(r => !opts.disabledRules?.includes(r.id))
    .map(rule => {
      let items = [];
      try { items = rule.check(model, thresholds) || []; } catch (_) { items = []; }
      return {
        rule: rule.id,
        label: rule.label,
        severity: rule.severity,
        weight: rule.weight,
        count: items.length,
        items: items.slice(0, 50),     // cap для render performance
        truncated: items.length > 50,
      };
    })
    .filter(v => v.count > 0);

  let score = 100;
  for (const v of violations) {
    const normalizedImpact = Math.min(v.weight, (v.weight * v.count) / teamSize);
    score -= normalizedImpact;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, violations };
}

/** Public API — list rule definitions (для UI toggle / spec). */
export function listHygieneRules() {
  return RULES.map(r => ({ id: r.id, label: r.label, severity: r.severity, weight: r.weight }));
}

/** Default thresholds (для UI sliders / config). */
export function getDefaultHygieneThresholds() {
  return { ...DEFAULT_THRESHOLDS };
}
