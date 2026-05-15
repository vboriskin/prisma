'use strict';
/* ============================================================
   CHAT EXPLAIN — v10_0
   Explains metrics, risk scores, release health, team overload.
   All rule-based — no LLM required.
   ============================================================ */

import { state } from '../state.js';
import { computeHealthScore } from './chatAlerts.js';

const RISK_FLAG_LABELS = {
  CONFIRMATION_IN_RELEASE: 'В релизе без подтверждения scope',
  IN_SCOPE_WITHOUT_RELEASE: 'В scope, но без назначенного релиза',
  BLOCKING_NEAR_RELEASE:   'Блокер в ближайшем релизном окне',
};

const RISK_SCORE_FORMULA = `riskScore = sum(факторов):
  +30 — blockingDependency = true
  +25 — scopeStatus=Да, но нет релиза
  +20 — Требует подтверждения, уже в релизе
  +15 — есть в 1.20 (ближайший релиз)
  +10 — scope = Требует подтверждения
  Максимум: 100`;

const HEALTH_FORMULA = `healthScore = 100 − penalty
  penalty = (blockers×15 + risky×8 + noRelease×5) / active × 10
  Минимум: 0, Максимум: 100`;

const PRESSURE_FORMULA = `pressureIndex (на исполнителя):
  = количество активных задач (незакрытых)
  Высокий: ≥ 5 задач
  Критический: ≥ 8 задач`;

/* ── Helpers ─────────────────────────────────────────────── */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function rowLabel(r) {
  return esc(r.epic || r.tasks || `#${r.id}`);
}

function relLabel(key) {
  return { r120:'1.20', r121:'1.21', r122:'1.22', overtime:'Овертайм', backlog:'Бэклог' }[key] || key;
}

/* ── Row-level explanation ───────────────────────────────── */

export function explainRow(rowIdOrEpic) {
  const row = state.rows.find(r =>
    r.id === rowIdOrEpic ||
    (r.epic || '').toLowerCase().includes((rowIdOrEpic||'').toLowerCase()) ||
    (r.tasks|| '').toLowerCase().includes((rowIdOrEpic||'').toLowerCase())
  );
  if (!row) {
    return {
      text: `Задача "${esc(rowIdOrEpic)}" не найдена. Попробуй написать точнее.`,
      cards: [], actions: [], drilldown: [],
    };
  }

  const score = row.riskScore || 0;
  const flags = row.riskFlags || [];
  const factors = [];
  if (row.blockingDependency)                              factors.push({ label: 'Блокер', pts: 30, desc: 'blockingDependency = true' });
  if (flags.includes('IN_SCOPE_WITHOUT_RELEASE'))          factors.push({ label: 'В scope без релиза', pts: 25, desc: 'scopeStatus=Да, isUnassigned=true' });
  if (flags.includes('CONFIRMATION_IN_RELEASE'))           factors.push({ label: 'Подтверждение в релизе', pts: 20, desc: 'Требует подтверждения + уже в окне' });
  if (row.hasRelease120)                                   factors.push({ label: 'В 1.20 (ближайший)', pts: 15, desc: 'release120Types не пуст' });
  if (row.scopeStatus === 'Требует подтверждения')         factors.push({ label: 'Требует подтверждения', pts: 10, desc: 'scopeStatus = Требует подтверждения' });

  const factorLines = factors.map(f => `- **${f.label}** (+${f.pts}): ${f.desc}`).join('\n');
  const flagLines   = flags.map(f => `- ${RISK_FLAG_LABELS[f] || f}`).join('\n') || '- Флаги рисков не выставлены';

  const text = `## Объяснение riskScore для "${rowLabel(row)}"

**riskScore: ${score}** (из 100)
**Команда:** ${esc(row.team||'—')} · **Scope:** ${esc(row.scopeStatus||'—')}

### Факторы (из которых складывается score):
${factorLines || '- Нет активных факторов риска'}

### Выставленные флаги:
${flagLines}

### Формула:
\`\`\`
${RISK_SCORE_FORMULA}
\`\`\`

### Что можно сделать:
${factors.length
  ? factors.map(f => `- Убрать "${f.label}": снизит score на ${f.pts} пунктов`).join('\n')
  : '- Задача в хорошем состоянии'}`;

  const actions = [
    row.blockingDependency && {
      label: 'Снять блокер', type: 'confirm_batch',
      payload: { action: 'clear_blocker', filter: { ids: [row.id] }, label: `Снять блокер: ${row.epic||row.id}` },
    },
    !row.isDone && {
      label: 'Отметить сделано', type: 'confirm_batch',
      payload: { action: 'mark_done', filter: { ids: [row.id] }, label: `Завершить: ${row.epic||row.id}` },
    },
  ].filter(Boolean);

  const drilldown = [
    { text: 'Что изменить прямо сейчас?', prompt: `Что нужно сделать с задачей "${row.epic||row.id}", чтобы снизить риск?` },
    { text: 'История задачи', prompt: `Что изменилось в задаче "${row.epic||row.id}"?` },
  ];

  return { text, cards: [], actions, drilldown };
}

/* ── Release explanation ─────────────────────────────────── */

export function explainRelease(relKey) {
  const fieldMap = { r120:'hasRelease120', r121:'hasRelease121', r122:'hasRelease122', overtime:'hasOvertime' };
  const field = fieldMap[relKey];
  const label = relLabel(relKey);
  const rows  = field ? state.rows.filter(r => r[field]) : state.rows;

  if (!rows.length) {
    return { text: `Задач в ${label} нет.`, cards: [], actions: [], drilldown: [] };
  }

  const total     = rows.length;
  const done      = rows.filter(r => r.isDone).length;
  const blockers  = rows.filter(r => r.blockingDependency && !r.isDone);
  const risky     = rows.filter(r => (r.riskFlags||[]).length && !r.isDone);
  const needsConf = rows.filter(r => r.scopeStatus === 'Требует подтверждения' && !r.isDone);
  const pct       = total ? Math.round(done/total*100) : 0;

  const riskReasons = [];
  if (blockers.length)  riskReasons.push(`**${blockers.length} блокеров** могут задержать выпуск`);
  if (needsConf.length) riskReasons.push(`**${needsConf.length} задач** требуют подтверждения scope`);
  if (pct < 30)         riskReasons.push(`**Готовность всего ${pct}%** — мало времени`);
  if (risky.length > total * 0.3) riskReasons.push(`**${risky.length} (${Math.round(risky.length/total*100)}%) задач** имеют флаги риска`);

  const topBlockers = blockers.slice(0, 5).map(r =>
    `- **${rowLabel(r)}** · ${esc(r.team||'—')} — ${(r.riskFlags||[]).map(f => RISK_FLAG_LABELS[f]||f).join(', ')||'блокер'}`
  ).join('\n');

  const text = `## Почему ${label} в риске?

**Статус:** ${done}/${total} задач готово (${pct}%) · Блокеры: ${blockers.length} · Риски: ${risky.length}

### Причины риска:
${riskReasons.length ? riskReasons.map(r => `- ${r}`).join('\n') : '- Явных критических рисков нет'}

${blockers.length ? `### Ключевые блокеры (топ-5):\n${topBlockers}` : ''}

### Что делать:
- Снять блокеры: скажи "покажи блокеры ${label}"
- Подтвердить scope: согласовать ${needsConf.length} задач`;

  const actions = [
    { label: `Блокеры ${label}`, type: 'apply_filter', payload: { onlyBlocking: true, release: label.replace('.','') } },
    { label: `Все задачи ${label}`, type: 'apply_filter', payload: { release: label.replace('.','') } },
  ];

  const drilldown = [
    { text: 'Конкретный план', prompt: `Составь план снятия рисков для релиза ${label}.` },
    { text: 'Назначить блокеры', prompt: `Кто должен отвечать за снятие блокеров в ${label}?` },
  ];

  return { text, cards: [], actions, drilldown };
}

/* ── Team overload explanation ───────────────────────────── */

export function explainTeamOverload(teamName) {
  const rows = teamName
    ? state.rows.filter(r => r.team && r.team.toLowerCase().includes(teamName.toLowerCase()))
    : state.rows;
  const label = teamName || 'все команды';

  const load = {};
  rows.filter(r => !r.isDone).forEach(r => {
    (r.assignee||'').split(/[|,]/).map(s => s.trim()).filter(Boolean).forEach(name => {
      if (!load[name]) load[name] = { total: 0, r120: 0, r121: 0, r122: 0, ot: 0, blockers: 0 };
      load[name].total++;
      if (r.hasRelease120) load[name].r120++;
      if (r.hasRelease121) load[name].r121++;
      if (r.hasRelease122) load[name].r122++;
      if (r.hasOvertime)   load[name].ot++;
      if (r.blockingDependency) load[name].blockers++;
    });
  });

  const sorted = Object.entries(load).sort((a,b) => b[1].total - a[1].total);
  const overloaded = sorted.filter(([,v]) => v.total >= 5);
  const lines = sorted.slice(0, 8).map(([name, v]) =>
    `- **${esc(name)}**: ${v.total} задач | 1.20: ${v.r120} · 1.21: ${v.r121} · 1.22: ${v.r122}${v.blockers ? ` · блокеров: ${v.blockers}` : ''}`
  ).join('\n');

  const text = `## Нагрузка: ${esc(label)}

**Исполнителей с высокой нагрузкой (≥5 задач):** ${overloaded.length}

### Распределение:
${lines || '- Исполнителей не найдено'}

### Формула:
\`\`\`
${PRESSURE_FORMULA}
\`\`\`

### Рекомендации:
${overloaded.length > 0
  ? overloaded.slice(0,3).map(([n,v]) => `- **${esc(n)}** (${v.total} задач): рассмотри перераспределение`).join('\n')
  : '- Перегрузки нет'}`;

  const drilldown = [
    { text: 'Как перераспределить?', prompt: `Как перераспределить задачи команды ${label}, чтобы снизить перегруз?` },
    { text: 'Кого привлечь?', prompt: `Кто из свободных может помочь команде ${label}?` },
  ];

  return { text, cards: [], actions: [], drilldown };
}

/* ── Metric explanation dispatcher ──────────────────────── */

export function explainMetric(metricName, opts = {}) {
  const m = (metricName || '').toLowerCase();

  if (m.includes('risk') || m.includes('риск')) {
    if (opts.rowId || opts.epic) return explainRow(opts.rowId || opts.epic);
    // Global risk overview
    const rows   = state.rows;
    const risky  = rows.filter(r => (r.riskFlags||[]).length && !r.isDone);
    const byFlag = {};
    risky.forEach(r => (r.riskFlags||[]).forEach(f => { byFlag[f] = (byFlag[f]||0)+1; }));
    const flagLines = Object.entries(byFlag)
      .sort((a,b) => b[1]-a[1])
      .map(([f,n]) => `- **${RISK_FLAG_LABELS[f]||f}**: ${n} задач`).join('\n');
    const top5 = risky.slice(0,5).map(r => `- ${rowLabel(r)} (${esc(r.team||'—')}) — riskScore: ${r.riskScore||0}`).join('\n');
    return {
      text: `## Объяснение riskScore (глобально)\n\n**Рискованных задач:** ${risky.length} из ${rows.length}\n\n### По типам рисков:\n${flagLines}\n\n### Топ-5 задач:\n${top5}\n\n### Формула:\n\`\`\`\n${RISK_SCORE_FORMULA}\n\`\`\``,
      cards: [], actions: [
        { label: 'Показать рискованные', type: 'apply_filter', payload: { onlyRisky: true }, primary: true },
      ], drilldown: [
        { text: 'Как снизить риски?', prompt: 'Что нужно сделать, чтобы снизить количество рискованных задач?' },
      ],
    };
  }

  if (m.includes('health') || m.includes('хелс') || m.includes('здоровь')) {
    const rows  = state.rows;
    const score = computeHealthScore(rows);
    const total = rows.length;
    const done  = rows.filter(r => r.isDone).length;
    const bloc  = rows.filter(r => r.blockingDependency && !r.isDone).length;
    const risky = rows.filter(r => (r.riskFlags||[]).length && !r.isDone).length;
    const noRel = rows.filter(r => r.isUnassigned && r.scopeStatus === 'Да' && !r.isDone).length;
    const active = total - done;
    const penalty = active ? ((bloc*15 + risky*8 + noRel*5) / active * 10).toFixed(1) : 0;
    return {
      text: `## Объяснение Health Score\n\n**Health Score: ${score}%**\n\n### Компоненты (активных задач: ${active}):\n- Блокеры: ${bloc} × 15 = ${bloc*15} пенальти\n- Рискованные: ${risky} × 8 = ${risky*8} пенальти\n- Без релиза: ${noRel} × 5 = ${noRel*5} пенальти\n- Итого penalty = ${penalty}\n\n### Формула:\n\`\`\`\n${HEALTH_FORMULA}\n\`\`\`\n\n### Что поднимет score:\n- Снять ${bloc} блокер(ов) → +${Math.min(30, Math.round(bloc*15/Math.max(active,1)*10))} пунктов\n- Распределить ${noRel} задач без релиза → +${Math.min(20, Math.round(noRel*5/Math.max(active,1)*10))} пунктов`,
      cards: [], actions: [], drilldown: [
        { text: 'Как быстро поднять?', prompt: 'Что можно сделать за 1 день, чтобы поднять healthScore?' },
      ],
    };
  }

  if (m.includes('pressure') || m.includes('нагруз') || m.includes('загруз') || m.includes('перегруз')) {
    return explainTeamOverload(opts.team || null);
  }

  if (m.includes('velocity') || m.includes('велосит') || m.includes('скорост')) {
    const rows = state.rows;
    const done = rows.filter(r => r.isDone);
    const recent = done.filter(r => {
      const d = new Date(r.doneDate || r.updatedAt || 0);
      return (Date.now() - d.getTime()) < 14 * 86400000; // last 2 weeks
    });
    return {
      text: `## Velocity\n\n**Закрыто всего:** ${done.length} задач\n**За последние 2 недели:** ${recent.length} задач\n\n_Velocity = количество выполненных задач за период. Чем выше — тем быстрее команда закрывает работу._\n\n### Улучшить:\n- Закрывать мелкие задачи быстрее\n- Убирать блокеры, тормозящие команду`,
      cards: [], actions: [], drilldown: [],
    };
  }

  if (m.includes('bottleneck') || m.includes('узкое место') || m.includes('бутылоч')) {
    return explainBottlenecks();
  }

  if (m.includes('spof') || m.includes('single point') || m.includes('единственн')) {
    return explainSPOF();
  }

  // Default: general metric overview
  const rows  = state.rows;
  const score = computeHealthScore(rows);
  return {
    text: `## Объяснение метрик\n\nДоступные метрики для объяснения:\n- **riskScore** — риск конкретной задачи\n- **healthScore** (${score}%) — общее здоровье плана\n- **pressureIndex** — нагрузка исполнителей\n- **velocity** — скорость закрытия задач\n- **bottlenecks** — узкие места\n- **SPOF** — single point of failure\n\nНапример: "объясни healthScore" или "почему riskScore у задачи X?"`,
    cards: [], actions: [], drilldown: [
      { text: 'Health Score', prompt: 'Объясни healthScore' },
      { text: 'Нагрузка', prompt: 'Объясни pressureIndex' },
      { text: 'Риски', prompt: 'Объясни riskScore' },
    ],
  };
}

/* ── Bottlenecks ─────────────────────────────────────────── */

function explainBottlenecks() {
  const rows = state.rows.filter(r => !r.isDone);
  const byTeam = {};
  rows.forEach(r => {
    const t = r.team || '—';
    if (!byTeam[t]) byTeam[t] = { total: 0, blockers: 0, noRelease: 0 };
    byTeam[t].total++;
    if (r.blockingDependency) byTeam[t].blockers++;
    if (r.isUnassigned && r.scopeStatus === 'Да') byTeam[t].noRelease++;
  });
  const sorted = Object.entries(byTeam).sort((a,b) => b[1].blockers - a[1].blockers || b[1].noRelease - a[1].noRelease);
  const lines = sorted.slice(0,6).map(([t,v]) =>
    `- **${esc(t)}**: ${v.total} задач · ${v.blockers} блок. · ${v.noRelease} без релиза`
  ).join('\n');
  return {
    text: `## Узкие места (Bottlenecks)\n\n${lines || '- Данных нет'}\n\n_Узкие места = команды/задачи, где много блокеров или нераспределённых задач._`,
    cards: [], actions: [], drilldown: [
      { text: 'Разблокировать', prompt: 'Предложи план снятия блокеров по командам.' },
    ],
  };
}

/* ── Single Point of Failure ─────────────────────────────── */

function explainSPOF() {
  const rows = state.rows.filter(r => !r.isDone);
  const assigneeCount = {};
  rows.forEach(r => {
    (r.assignee||'').split(/[|,]/).map(s=>s.trim()).filter(Boolean).forEach(name => {
      assigneeCount[name] = (assigneeCount[name]||0) + 1;
    });
  });
  const spof = Object.entries(assigneeCount)
    .filter(([,n]) => n >= 4)
    .sort((a,b) => b[1]-a[1])
    .slice(0, 5);
  const lines = spof.map(([n,c]) => `- **${esc(n)}** — ${c} задач (единственный ответственный)`).join('\n');
  return {
    text: `## Single Point of Failure\n\nСотрудники с высокой концентрацией ответственности:\n\n${lines || '- SPOF не обнаружен'}\n\n_SPOF = человек, от которого зависит слишком много задач. Его отсутствие может заблокировать работу._\n\n### Рекомендации:\n- Назначить второго ответственного на критичные задачи\n- Документировать ключевые зоны ответственности`,
    cards: [], actions: [], drilldown: [],
  };
}
