'use strict';
/* ============================================================
   JIRA HYGIENE ENGINE — V23 (2026-05-11)
   --
   Цель: тимлид утром видит «73/100 гигиена. 12 задач без assignee,
   5 zombie, 3 без эстимейта». Один клик → список → bulk-fix.

   Engine = pure functions:
     · runHygieneRules(model) → { score, violations: [{ rule, severity, items: [...] }] }
     · RULES — массив правил, каждое: { id, label, severity, check(model) }

   Engine не делает HTTP, не зависит от DOM. Renderer и orchestrator
   импортируют отсюда.

   Rules MVP (12 шт):
     · D-01: без assignee
     · D-02: без story-point estimate
     · D-03: без epic link
     · D-04: в статусе «In Progress» >5 дней
     · D-05: «In Review» >3 дня (zombie review)
     · D-06: «Backlog» при наличии активного спринта (sprint-leak)
     · D-07: re-opened ≥2 раза
     · D-08: bug без severity / priority
     · D-09: estimate ≠ actual (>2x drift)
     · D-10: дублирующиеся ключи / titles
     · D-11: задача без description
     · D-12: задача в прошлом sprint без resolution (carry-over)

   Score: 100 - sum(weight × violation_count_normalized).
   ============================================================ */

const DEFAULT_THRESHOLDS = {
  inProgressDaysCritical: 5,
  inReviewDaysCritical: 3,
  estimateDriftRatio: 2.0,
  reopenCountCritical: 2,
};

const RULES = [
  {
    id: 'D-01',
    label: 'Без assignee',
    severity: 'warn',
    weight: 8,
    check: (model) => {
      const issues = _collectActiveIssues(model);
      return issues.filter(i => !i.assignee || !i.assignee.name).map(_issueRef);
    },
  },
  {
    id: 'D-02',
    label: 'Без эстимейта (story points)',
    severity: 'info',
    weight: 4,
    check: (model) => {
      const issues = _collectActiveIssues(model);
      return issues
        .filter(i => i.statusCat !== 'done' && !i.storyPoints && i.type !== 'Epic')
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
    check: (model) => {
      const issues = _collectActiveIssues(model);
      const counts = new Map();
      for (const i of issues) {
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
