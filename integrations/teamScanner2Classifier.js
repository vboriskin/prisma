'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — CLASSIFIER (V20 S8 #15)

   Pure module — без зависимостей на renderer / state / DOM.
   Вынесен из teamScanner2Renderer.js (canonical) и teamScanner2History.js
   (inline copy) после Tech Lead audit:
     «Когда S8 добавит сигнал в classifier, history будет отставать —
      snapshot day N classified как `idle`, day N+1 как `moving`
      без изменения данных, только из-за рассинхронизации. Скрытый bug
      который вылезет через год».

   Single source of truth — теперь и renderer, и history используют
   одну реализацию.

   Public API:
     classifyPerson(participant) → 'stop' | 'watch' | 'moving' | 'idle'
     stuckListOf(participant)    → Array (blockers OR stale fallback)
     statusOfPerson(participant) → 'blocker' | 'today' | 'idle' (для UI ▌-индикатора)

   Контракт participant — duck-typed. Используются поля:
     timelineToday, timelineYesterday, issuesNow, blockers, stale,
     badges (pr48h, commits48h, reviews, approves), cfItems, bbItems,
     zephyrTestsCreatedRecent, zephyrTestsExecutedRecent.

   Любой новый сигнал → меняйте здесь, не дублируйте.
   ============================================================ */

/**
 * V18.1 P3 — stuck-сигнал теперь приходит из blockers (precise dwell-time)
 * если P3 enrichment запущен. Иначе fallback на stale (P1/P2 broad signal).
 */
export function stuckListOf(p) {
  if (Array.isArray(p?.blockers) && p.blockers.length) return p.blockers;
  return p?.stale || [];
}

/**
 * 4-group classification: stop / watch / moving / idle.
 *
 * Правила (по убыванию приоритета):
 *   1. idle   — нет signal'ов вообще (Jira + BB + CF + Zephyr + reviews).
 *   2. stop   — есть stuck (blockers) и НЕТ активности сегодня.
 *   3. watch  — overload (issuesNow ≥ 3) ИЛИ stuck-but-active ИЛИ
 *               вчера активность была, сегодня тишина.
 *   4. moving — всё остальное (есть today или other-signal).
 */
export function classifyPerson(p) {
  const today = (p?.timelineToday    || []).length;
  const yest  = (p?.timelineYesterday || []).length;
  const wip   = (p?.issuesNow         || []).length;
  const stuck = stuckListOf(p).length;
  const prs48 = p?.badges?.pr48h      || 0;
  const com48 = p?.badges?.commits48h || 0;
  // V18.1 P7-S1.3 — расширили idle-проверку на BB/CF/Zephyr/reviews сигналы.
  // Без этого senior/тимлид/архитектор с активностью только в PR-ревью
  // или CF-доках попадали в idle — это ложь и обидно.
  const reviewSig = (p?.badges?.reviews   || 0) + (p?.badges?.approves || 0);
  const cfN       = (p?.cfItems || []).length;
  const bbN       = (p?.bbItems || []).length;
  const zephyrN   = ((p?.zephyrTestsCreatedRecent  || []).length
                  +  (p?.zephyrTestsExecutedRecent || []).length);
  const anyOtherSig = reviewSig > 0 || cfN > 0 || bbN > 0 || zephyrN > 0;

  // Idle.
  if (today === 0 && yest === 0 && wip === 0 && stuck === 0
      && prs48 === 0 && com48 === 0 && !anyOtherSig) {
    return 'idle';
  }
  // Stop.
  if (stuck > 0 && today === 0) return 'stop';
  // Watch.
  if (wip >= 3) return 'watch';
  if (stuck > 0 && today > 0) return 'watch';
  if (today === 0 && yest > 0) return 'watch';
  // Moving.
  return 'moving';
}

/**
 * Per-row UI indicator: 'blocker' (red ▌) / 'today' / 'idle'.
 * Не путать с classifyPerson — это для row-level visual marker.
 */
export function statusOfPerson(p) {
  const today = (p?.timelineToday || []).length;
  const stuck = stuckListOf(p).length;
  if (stuck > 0 && today === 0) return 'blocker';
  if (today > 0) return 'today';
  return 'idle';
}
