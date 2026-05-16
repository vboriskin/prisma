'use strict';
/* ============================================================
   chat/reviewPreset.js — V22+ Week 4 (LP-08)

   Performance-review preset: добавляет 3 секции в employeeReport,
   готовые к копи-пасту в HR-документ или 1-on-1:

     · Achievements   — top-5 контрибьюшен за период
     · Growth Areas   — rule-based signals «над чем работать»
     · Recommendations — конкретные actions для следующего периода

   Все секции rule-based — без LLM. Использует уже собранные summaries
   из employeeReport.js.

   Public API:
     buildReviewSections(target, period, summaries, comparison?)
       → { achievements, growthAreas, recommendations, markdown }

   Контракты:
     · НЕ throw'ает на пустые summaries.
     · Все секции — markdown готовый к встраиванию.
     · Comparison-data опциональна — добавляет «vs прошлый период» в Growth.
   ============================================================ */

/* ─────────────────────────────────────────────────────────────
   Main builder
   ───────────────────────────────────────────────────────────── */

/**
 * @param {object} target — resolveTarget output (нужно target.employee)
 * @param {object} period — { from, to, label }
 * @param {object} summaries — { jira?, bb?, cf? } from employeeReport.js
 * @param {object} comparison — optional { jira, bb, cf } from prev period
 * @returns {{achievements, growthAreas, recommendations, markdown}}
 */
export function buildReviewSections(target, period, summaries, comparison = null) {
  const empLabel = target?.employee?.label || target?.employee?.id || '(сотрудник)';
  const periodLabel = period?.label || '';

  const sJira = summaries?.jira || null;
  const sBB   = summaries?.bb   || null;
  const sCF   = summaries?.cf   || null;

  // Phase 1: Achievements — top items + counters
  const achievements = _buildAchievements(empLabel, periodLabel, sJira, sBB, sCF);

  // Phase 2: Growth Areas — rule-based signals
  const growthAreas = _buildGrowthAreas(empLabel, periodLabel, sJira, sBB, sCF, comparison);

  // Phase 3: Recommendations — concrete actions
  const recommendations = _buildRecommendations(empLabel, sJira, sBB, sCF, growthAreas);

  // Combined markdown — для копи-паста в HR.
  const markdown = [
    `## Performance Review: ${empLabel}`,
    `**Период:** ${periodLabel || '—'}`,
    '',
    '### 🏆 Achievements',
    achievements.length ? achievements.map(a => `- ${a}`).join('\n') : '_Нет явных достижений за период._',
    '',
    '### 📈 Growth Areas',
    growthAreas.length ? growthAreas.map(g => `- ${g}`).join('\n') : '_Сигналов о точках роста не обнаружено._',
    '',
    '### 🎯 Recommendations',
    recommendations.length ? recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n') : '_Конкретных рекомендаций нет._',
  ].join('\n');

  return { achievements, growthAreas, recommendations, markdown };
}

/* ─────────────────────────────────────────────────────────────
   Achievements
   ───────────────────────────────────────────────────────────── */

function _buildAchievements(empLabel, periodLabel, sJira, sBB, sCF) {
  const out = [];

  // 1. Jira closed-tickets — самое явное
  if (sJira && sJira.closed > 0) {
    const types = Object.entries(sJira.byType || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([t, n]) => `${t}: ${n}`)
      .join(', ');
    out.push(
      `**Закрыто ${sJira.closed} задач${_pluralEnd(sJira.closed)}**` +
      (types ? ` (${types})` : '')
    );
  }

  // 2. Top-3 Jira items (most-recent meaningful closures)
  if (sJira && sJira.top?.length) {
    const closedTop = sJira.top
      .filter(it => /done|закры|complete|resolved/i.test(it.status || ''))
      .slice(0, 3);
    for (const it of closedTop) {
      const key = it.key || '?';
      const summary = (it.summary || '').slice(0, 80);
      if (summary) out.push(`\`${key}\` — ${summary}`);
    }
  }

  // 3. BB merged PRs — code-shipping signal
  if (sBB && sBB.merged > 0) {
    const repos = Object.entries(sBB.repos || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([r]) => r)
      .join(', ');
    out.push(
      `**Слил ${sBB.merged} PR${_pluralEnd(sBB.merged)}**` +
      (repos ? ` (${repos})` : '')
    );
  }

  // 4. CF authored pages — knowledge-sharing signal
  if (sCF && sCF.total > 0) {
    const spaces = Object.entries(sCF.spaces || {})
      .filter(([k]) => k !== 'unknown')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([s]) => s)
      .join(', ');
    out.push(
      `**Подготовил ${sCF.total} страниц${_pluralEndCh(sCF.total)} в Confluence**` +
      (spaces ? ` (${spaces})` : '')
    );
  }

  // Лимит топ-5 чтобы review не был стеной текста.
  return out.slice(0, 5);
}

/* ─────────────────────────────────────────────────────────────
   Growth Areas — rule-based signals
   ───────────────────────────────────────────────────────────── */

function _buildGrowthAreas(empLabel, periodLabel, sJira, sBB, sCF, comparison) {
  const out = [];

  // Signal 1: Велики ли in-progress vs closed?
  // Если открытых задач больше чем закрытых × 2 — сигнал «много незакрытого».
  if (sJira) {
    const open = (sJira.total || 0) - (sJira.closed || 0);
    if (sJira.total > 5 && open > sJira.closed * 2) {
      out.push(
        `Накопилось **${open} незакрытых задач** при ${sJira.closed} закрытых — стоит обсудить приоритизацию и blockers.`
      );
    }
  }

  // Signal 2: Comparison-based — снижение vs прошлый период
  if (comparison && sJira) {
    const delta = (sJira.closed || 0) - (comparison.jira?.closed || 0);
    if (delta < -3 && comparison.jira?.closed > 0) {
      out.push(
        `**Закрытых задач меньше**, чем в предыдущем периоде (${sJira.closed} vs ${comparison.jira.closed}). Стоит понять причину — переключение на другие задачи / блокеры / другое.`
      );
    }
  }
  if (comparison && sBB) {
    const delta = (sBB.merged || 0) - (comparison.bb?.merged || 0);
    if (delta < -2 && comparison.bb?.merged > 0) {
      out.push(
        `**PR merge rate упал**: ${sBB.merged} vs ${comparison.bb.merged} в прошлом периоде.`
      );
    }
  }

  // Signal 3: Нет активности в одном из источников
  if (sJira && sJira.total > 0 && (!sBB || sBB.total === 0)) {
    out.push(
      `Активность в **Bitbucket за период отсутствует** — задачи закрываются, но кода в репо не приходит. Возможно, работа в другой repo или специфика задач.`
    );
  }
  if (sJira && sJira.total > 0 && (!sCF || sCF.total === 0)) {
    out.push(
      `Активность в **Confluence отсутствует** — стоит фиксировать ключевые решения и требования для команды.`
    );
  }

  // Signal 4: Только один тип задач (мало variety)
  if (sJira && sJira.byType) {
    const types = Object.keys(sJira.byType);
    if (types.length === 1 && sJira.total > 5) {
      out.push(
        `Все задачи одного типа (${types[0]}) — возможно, стоит расширить scope ответственности.`
      );
    }
  }

  // Signal 5: Множество разных проектов — fragmentation
  if (sJira && sJira.top?.length > 0) {
    const projects = new Set(sJira.top.map(it => {
      const m = String(it.key || '').match(/^([A-Z]+)-/);
      return m ? m[1] : '';
    }).filter(Boolean));
    if (projects.size >= 4) {
      out.push(
        `Задачи разбросаны по **${projects.size} проектам** — стоит сфокусироваться на 1-2 для большего impact'а.`
      );
    }
  }

  return out.slice(0, 5);
}

/* ─────────────────────────────────────────────────────────────
   Recommendations
   ───────────────────────────────────────────────────────────── */

function _buildRecommendations(empLabel, sJira, sBB, sCF, growthAreas) {
  const out = [];

  // Direct mapping growth → recommendation
  for (const g of growthAreas) {
    if (/незакрытых задач/i.test(g)) {
      out.push('Проведите review-сессию открытых задач: что закрыть, что отложить, что передать.');
    } else if (/блокеры|blockers/i.test(g)) {
      out.push('Согласовать с тимлидом план снятия блокеров (выделить 1 день в неделю на unblock).');
    } else if (/Bitbucket.*отсутствует/i.test(g)) {
      out.push('Если работа в другом репозитории — добавить его в Сканнер; если кода нет — обсудить scope роли.');
    } else if (/Confluence.*отсутствует/i.test(g)) {
      out.push('Завести шаблон для записи ключевых технических решений (1 страница на эпик).');
    } else if (/одного типа/i.test(g)) {
      out.push('Обсудить с PM расширение типов задач — например, добавить cross-team integration или performance.');
    } else if (/разбросаны.*проектам/i.test(g)) {
      out.push('Сфокусироваться на 1-2 проектах на следующий период; перенести второстепенные на других.');
    } else if (/PR merge rate упал/i.test(g)) {
      out.push('Проверить процесс code review: возможно, ожидание review занимает много времени.');
    } else if (/Закрытых задач меньше/i.test(g)) {
      out.push('Сделать short-sync с тимлидом — понять причины снижения velocity (блокеры? scope-change?).');
    }
  }

  // Generic положительные recommendations если growth-areas пустые.
  if (!out.length) {
    if (sJira && sJira.closed > 5) {
      out.push('Продолжать текущий темп — результат хороший. Стоит обсудить новые challenges или ownership расширенных областей.');
    }
    if (sCF && sCF.total > 3) {
      out.push('Сильная knowledge-sharing активность — рассмотреть mentorship или onboarding-роль для новых членов.');
    }
    if (!out.length) {
      out.push('Зафиксировать текущие приоритеты и обсудить план следующего периода с тимлидом.');
    }
  }

  return out.slice(0, 5);
}

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

function _pluralEnd(n) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'и';
  if (b === 1) return 'у';
  if (b > 1 && b < 5) return 'и';
  return '';
}

function _pluralEndCh(n) {
  // «N страниц» / «1 страница» / «3 страницы»
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return '';
  if (b === 1) return 'у';
  if (b > 1 && b < 5) return 'ы';
  return '';
}
