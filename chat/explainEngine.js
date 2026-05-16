'use strict';
/* ============================================================
   chat/explainEngine.js — V22+ Phase 4 (K-K6)

   Rule-based explain-engine для «почему» вопросов.

     · «почему у PAY низкая velocity»
     · «почему у Иванова много блокеров»
     · «почему перенесли BIK-1234 в 1.22»
     · «почему 1.21 не закрыт»

   Подход: ranked factors. Аггрегируем сигналы из state.rows + Scanner-model
   + actionLog + ganttArrows + transferComments. Сортируем по impact'у.
   Возвращаем человекочитаемое объяснение + drilldown.

   Public API:
     buildExplainResponse(target, params, opts?) → structured

   Контракты:
     · НЕ зовёт LLM (rule-based).
     · Identity-deterministic — все matches через state.employees identity.
     · Возвращает ranked factors с весами (для UI bar-chart позже).
     · НЕ выдаёт ложных факторов — если сигналов нет, возвращает «недостаточно данных»
       и предлагает дополнительные источники.

   Архитектура:
     resolveTarget → выбираем subject (employee/team/epic/release/metric)
       → собираем factors[]
       → rank by weight
       → формируем response с top-N + chips для каждого фактора
   ============================================================ */

import { state } from '../state.js';
import { Services } from '../app/services.js';
import { linkTo } from './linkTo.js';

/* ─────────────────────────────────────────────────────────────
   Main router
   ───────────────────────────────────────────────────────────── */

/**
 * @param {object} target — resolveTarget output
 * @param {object} params — { metric?: string, asks?: string }
 * @param {object} opts
 * @returns {object} structured response
 */
export function buildExplainResponse(target, params = {}, opts = {}) {
  const text = String(target?.raw?.text || '').toLowerCase();
  const asks = String(params?.asks || text);

  // Detect what is being explained.
  const subject = _detectSubject(target, asks);

  switch (subject.kind) {
    case 'team_velocity':       return _explainTeamVelocity(subject, target);
    case 'employee_blockers':   return _explainEmployeeBlockers(subject, target);
    case 'epic_transfer':       return _explainEpicTransfer(subject, target);
    case 'release_completion':  return _explainReleaseCompletion(subject, target);
    case 'overload':            return _explainOverload(subject, target);
    default:                    return _explainGeneric(target);
  }
}

/* ─────────────────────────────────────────────────────────────
   Subject detection
   ───────────────────────────────────────────────────────────── */

function _detectSubject(target, asks) {
  const lc = asks.toLowerCase();
  // «низкая velocity», «упала velocity», «velocity»
  if (target?.team && /(?:velocity|велосити|скорост[а-яё]+|медлен|производит[а-яё]+|низк[а-яё]+\s+темп)/.test(lc)) {
    return { kind: 'team_velocity', team: target.team };
  }
  // «много блокеров», «застрял», «заблокирован»
  if (target?.employee && /(?:блокер|застр[а-яё]+|заблок[а-яё]+)/.test(lc)) {
    return { kind: 'employee_blockers', employee: target.employee };
  }
  // «перенесли», «перенос», «move»
  if (target?.epic && /(?:перенесли|перенос|move|сдвин[а-яё]+|переехал[а-яё]*)/.test(lc)) {
    return { kind: 'epic_transfer', epic: target.epic };
  }
  // «не закрыт», «отстаёт», «не готов» — для релиза
  if (target?.release && /(?:не\s+закрыт|отстаёт|отстает|не\s+готов|задержив[а-яё]+)/.test(lc)) {
    return { kind: 'release_completion', release: target.release };
  }
  // «перегружен», «перегрузка», «overload»
  if (/(?:перегруж[а-яё]+|перегруз|overload|нагрузк[а-яё]+)/.test(lc)) {
    return { kind: 'overload', team: target?.team, employee: target?.employee };
  }
  return { kind: 'generic' };
}

/* ─────────────────────────────────────────────────────────────
   Team velocity explanation
   ───────────────────────────────────────────────────────────── */

function _explainTeamVelocity(subject, target) {
  const teamName = subject.team?.name || subject.team;
  const teamRows = (state.rows || []).filter(r => String(r.team || '') === String(teamName));

  const factors = [];

  // F1: блокеры в команде (Registry)
  const blockers = teamRows.filter(r => r.blockingDependency && !r.isDone);
  if (blockers.length) {
    factors.push({
      title: `${blockers.length} активных блокеров`,
      weight: blockers.length * 3,
      detail: `Эпики ${blockers.slice(0, 3).map(r => r.epic || r.tasks).filter(Boolean).join(', ')} помечены как блокирующие зависимостями.`,
      action: { type: 'apply_filter', label: '→ Реестр: блокеры', payload: { team: teamName, onlyBlocking: true } },
    });
  }

  // F2: переносы за квартал (Gantt arrows)
  const transfers = teamRows.flatMap(r => r.ganttArrows || []);
  if (transfers.length >= 3) {
    factors.push({
      title: `${transfers.length} переносов между релизами`,
      weight: transfers.length * 2,
      detail: 'Большое количество переносов между окнами планирования сигналит о нестабильном scope или ресурсной перегрузке.',
      action: linkTo({ kind: 'team', name: teamName }, { section: 'gantt', label: '→ Гант: команда' }),
    });
  }

  // F3: overtime эпики
  const overtime = teamRows.filter(r => r.hasOvertime && !r.isDone);
  if (overtime.length) {
    factors.push({
      title: `${overtime.length} эпиков в овертайме`,
      weight: overtime.length * 2,
      detail: 'Задачи переехали за пределы квартала — команда не уложилась в окно.',
      action: { type: 'apply_filter', label: '→ Только overtime', payload: { team: teamName, onlyOvertime: true } },
    });
  }

  // F4: Sigma coverage низкое
  const bdModel = _getBDModel();
  if (bdModel?.coverageByTeam) {
    const cov = bdModel.coverageByTeam.find(t => t.name === teamName || t.pk === teamName);
    if (cov && (cov.pct ?? 100) < 70) {
      factors.push({
        title: `Coverage Sigma-целей всего ${cov.pct}%`,
        weight: 10 - Math.floor(cov.pct / 10),
        detail: 'Команда работает над задачами не покрывающими квартальные цели — фокус расфокусирован.',
        action: { type: 'navigate', label: '→ Чёрный дашборд', payload: { section: 'black-dashboard' } },
      });
    }
  }

  // F5: scope-changes (actionLog)
  const scopeChanges = (state.actionLog || []).filter(e =>
    /scope/i.test(e.label || e.type || '') &&
    teamRows.some(r => r.id === e.rowId)
  );
  if (scopeChanges.length >= 3) {
    factors.push({
      title: `${scopeChanges.length} изменений scope за период`,
      weight: scopeChanges.length,
      detail: 'Frequent scope-changes ломают планирование и снижают throughput.',
    });
  }

  // F6: Scanner — много stop/idle people в команде
  const scannerModel = _getScannerModel();
  if (scannerModel?.participants) {
    const teamParts = scannerModel.participants
      .filter(p => !p.deactivated)
      .filter(p => (p.projects || []).some(pk => String(pk).toLowerCase().includes(String(teamName).toLowerCase())));
    const stale = teamParts.filter(p => (p.stale?.length || 0) >= 3);
    if (stale.length) {
      factors.push({
        title: `${stale.length} человек со «stale» задачами`,
        weight: stale.length * 2,
        detail: 'Несколько участников имеют задачи без движения >7 дней — нужен unblock-session.',
        action: linkTo({ kind: 'team', name: teamName }, { section: 'scanner2', label: '→ Сканнер команды' }),
      });
    }
  }

  return _composeExplain(
    `Почему у команды ${teamName} низкая velocity`,
    factors,
    target,
    teamName
  );
}

/* ─────────────────────────────────────────────────────────────
   Employee blockers explanation
   ───────────────────────────────────────────────────────────── */

function _explainEmployeeBlockers(subject, target) {
  const empLabel = subject.employee?.label || subject.employee?.id;
  const factors = [];

  const scannerModel = _getScannerModel();
  if (scannerModel?.participants) {
    const p = scannerModel.participants.find(p =>
      !p.deactivated && (
        String(p.email || '').toLowerCase() === String(subject.employee.id || '').toLowerCase()
        || String(p.label || '') === empLabel
      )
    );
    if (p) {
      const blockers = p.blockers || [];
      // F1: dwell-time блокеров
      const oldBlockers = blockers.filter(b => (b.dwellHours || 0) > 48);
      if (oldBlockers.length) {
        factors.push({
          title: `${oldBlockers.length} блокеров висит >2 дней`,
          weight: oldBlockers.length * 3,
          detail: `Самые старые: ${oldBlockers.slice(0, 3).map(b => b.blockerKey || b.issueKey).join(', ')}.`,
        });
      }
      // F2: stale items
      if ((p.stale?.length || 0) >= 3) {
        factors.push({
          title: `${p.stale.length} задач без движения`,
          weight: p.stale.length * 2,
          detail: 'Задачи не обновлялись >7 дней — возможно, ждут review или внешний ответ.',
        });
      }
      // F3: cross-team зависимости
      const crossTeam = blockers.filter(b => {
        const myPk = (b.issueKey || '').match(/^([A-Z]+)-/)?.[1];
        const blockerPk = (b.blockerKey || '').match(/^([A-Z]+)-/)?.[1];
        return myPk && blockerPk && myPk !== blockerPk;
      });
      if (crossTeam.length) {
        factors.push({
          title: `${crossTeam.length} блокеров из других команд`,
          weight: crossTeam.length * 2,
          detail: 'Cross-team зависимости часто буксуют — нужна эскалация / sync.',
        });
      }
    }
  }

  // F4: Registry-level блокеры assigned to this person
  const registryBlocked = (state.rows || []).filter(r =>
    !r.isDone && r.blockingDependency &&
    String(r.assignee || '').toLowerCase().includes(String(subject.employee.id || '').toLowerCase())
  );
  if (registryBlocked.length) {
    factors.push({
      title: `${registryBlocked.length} помечено как блокирующее в Реестре`,
      weight: registryBlocked.length * 2,
      detail: 'Эпики помечены вручную как блокирующие зависимостями.',
    });
  }

  return _composeExplain(
    `Почему у ${empLabel} много блокеров`,
    factors,
    target,
    empLabel
  );
}

/* ─────────────────────────────────────────────────────────────
   Epic transfer explanation
   ───────────────────────────────────────────────────────────── */

function _explainEpicTransfer(subject, target) {
  const epicId = subject.epic?.id || subject.epic;
  const row = (state.rows || []).find(r =>
    r.epic === epicId || r.tasks === epicId || r.id === epicId
  );
  if (!row) {
    return _composeExplain(`Эпик ${epicId} не найден в Реестре`, [], target, epicId);
  }

  const factors = [];
  const arrows = row.ganttArrows || [];
  const comments = row.transferComments || [];

  if (arrows.length) {
    factors.push({
      title: `Эпик переносили ${arrows.length} раз${_pluralEnd(arrows.length)}`,
      weight: arrows.length * 3,
      detail: arrows
        .slice(-3)
        .map(a => `${a.srcCol} → ${a.dstCol} (${a.at?.slice(0, 10) || '?'})`)
        .join('; '),
    });
  }

  // Group comments by keyword
  if (comments.length) {
    const reasons = { blocker: 0, scope: 0, capacity: 0, other: 0 };
    for (const c of comments) {
      const txt = String(c.text || '').toLowerCase();
      if (/блокер|зависим|ждём|ожидаем/.test(txt)) reasons.blocker++;
      else if (/scope|объём|объем|требован/.test(txt)) reasons.scope++;
      else if (/ресурс|capacity|нагрузк|занят/.test(txt)) reasons.capacity++;
      else reasons.other++;
    }
    if (reasons.blocker > 0) {
      factors.push({
        title: `Причина: блокеры/зависимости (${reasons.blocker})`,
        weight: reasons.blocker * 3,
        detail: 'В комментариях к переносам отмечены зависимости от других задач.',
      });
    }
    if (reasons.scope > 0) {
      factors.push({
        title: `Причина: изменения scope (${reasons.scope})`,
        weight: reasons.scope * 2,
        detail: 'Менялся объём задачи — потребовалось больше времени.',
      });
    }
    if (reasons.capacity > 0) {
      factors.push({
        title: `Причина: capacity / ресурсы (${reasons.capacity})`,
        weight: reasons.capacity * 2,
        detail: 'Команда не имела ресурсов на эпик в текущем окне.',
      });
    }
  }

  if (row.blockingDependency) {
    factors.push({
      title: 'Эпик помечен как блокирующая зависимость',
      weight: 5,
      detail: 'В Реестре установлен флаг blockingDependency.',
    });
  }

  return _composeExplain(
    `Почему перенесли ${epicId}`,
    factors,
    target,
    epicId
  );
}

/* ─────────────────────────────────────────────────────────────
   Release completion explanation
   ───────────────────────────────────────────────────────────── */

function _explainReleaseCompletion(subject, target) {
  const releaseId = subject.release?.id || subject.release;
  const flagMap = { '1.20': 'hasRelease120', '1.21': 'hasRelease121', '1.22': 'hasRelease122' };
  const flag = flagMap[releaseId];
  if (!flag) {
    return _composeExplain(`Релиз ${releaseId} не распознан`, [], target, releaseId);
  }

  const scoped = (state.rows || []).filter(r => r[flag]);
  const done = scoped.filter(r => r.isDone).length;
  const blocked = scoped.filter(r => r.blockingDependency && !r.isDone).length;
  const noAssignee = scoped.filter(r => !r.isDone && !r.assignee).length;
  const transfers = scoped.flatMap(r => r.ganttArrows || []).filter(a => a.dstCol === `r${releaseId.replace('.', '')}`);

  const factors = [];
  if (blocked) {
    factors.push({
      title: `${blocked} эпиков заблокированы`,
      weight: blocked * 3,
      detail: 'Эпики помечены как блокирующие зависимости — нужно снять блоки до релиза.',
    });
  }
  if (noAssignee) {
    factors.push({
      title: `${noAssignee} эпиков без исполнителя`,
      weight: noAssignee * 2,
      detail: 'Эпики без assignee не могут двигаться.',
    });
  }
  if (transfers.length >= 3) {
    factors.push({
      title: `${transfers.length} эпиков перенесли в ${releaseId}`,
      weight: transfers.length * 2,
      detail: 'Большое число поздних добавлений увеличивает нагрузку на окно.',
    });
  }
  const total = scoped.length;
  const remainingPct = total ? Math.round((total - done) / total * 100) : 0;
  if (remainingPct > 50) {
    factors.push({
      title: `${remainingPct}% эпиков ещё не закрыты`,
      weight: Math.floor(remainingPct / 10),
      detail: `Из ${total} эпиков сделано всего ${done}.`,
    });
  }

  return _composeExplain(
    `Почему ${releaseId} отстаёт`,
    factors,
    target,
    releaseId
  );
}

/* ─────────────────────────────────────────────────────────────
   Overload explanation
   ───────────────────────────────────────────────────────────── */

function _explainOverload(subject, target) {
  const subjLabel = subject.team?.name || subject.employee?.label || 'команда';
  const factors = [];

  // Count rows by assignee/team
  const rows = (state.rows || []).filter(r => !r.isDone);
  let scope = rows;
  if (subject.team) {
    const teamName = subject.team.name || subject.team;
    scope = rows.filter(r => String(r.team || '') === String(teamName));
  }

  if (subject.employee) {
    const empId = String(subject.employee.id || '').toLowerCase();
    const empRows = rows.filter(r => String(r.assignee || '').toLowerCase().includes(empId));
    factors.push({
      title: `${empRows.length} активных эпиков`,
      weight: empRows.length,
      detail: 'Количество назначенных открытых задач.',
    });
    const overtime = empRows.filter(r => r.hasOvertime).length;
    if (overtime) {
      factors.push({
        title: `${overtime} эпиков в overtime`,
        weight: overtime * 2,
        detail: 'Часть задач не вмещается в стандартное окно.',
      });
    }
  } else {
    // Team-level
    const byAssignee = {};
    for (const r of scope) {
      const a = String(r.assignee || '').split(/[|,]/)[0].trim();
      if (!a) continue;
      byAssignee[a] = (byAssignee[a] || 0) + 1;
    }
    const overloaded = Object.entries(byAssignee)
      .filter(([, n]) => n >= 5)
      .sort((a, b) => b[1] - a[1]);
    if (overloaded.length) {
      factors.push({
        title: `${overloaded.length} человек с ≥5 эпиками`,
        weight: overloaded.length * 3,
        detail: `Topscore: ${overloaded.slice(0, 3).map(([a, n]) => `${a} (${n})`).join(', ')}.`,
      });
    }
    factors.push({
      title: `${scope.length} активных эпиков в команде`,
      weight: scope.length,
      detail: 'Общее количество открытых эпиков по команде.',
    });
  }

  return _composeExplain(
    `Почему ${subjLabel} перегружен${subject.employee ? '' : 'а'}`,
    factors,
    target,
    subjLabel
  );
}

/* ─────────────────────────────────────────────────────────────
   Generic «недостаточно данных» fallback
   ───────────────────────────────────────────────────────────── */

function _explainGeneric(target) {
  return {
    text: 'Не удалось определить, что нужно объяснить. Попробуйте уточнить:\n\n- «почему у [команды] низкая velocity»\n- «почему у [Иванова] много блокеров»\n- «почему перенесли [BIK-1234]»\n- «почему 1.21 отстаёт»',
    cards: [],
    actions: [],
    drilldown: [
      { text: 'Кто перегружен',   prompt: 'кто перегружен' },
      { text: 'Главные блокеры',  prompt: 'главные блокеры' },
      { text: 'Сколько переносов в 1.21', prompt: 'сколько переносов в 1.21' },
    ],
    responseSource: 'rule',
    _meta: { kind: 'explain_generic' },
  };
}

/* ─────────────────────────────────────────────────────────────
   Composer
   ───────────────────────────────────────────────────────────── */

function _composeExplain(title, factors, target, subjectLabel) {
  // Сортируем по weight DESC, top-5.
  const ranked = [...factors].sort((a, b) => b.weight - a.weight).slice(0, 5);

  const lines = [`## ${title}`, ''];

  if (!ranked.length) {
    lines.push('_Недостаточно данных для объяснения. Попробуйте:_');
    lines.push('');
    lines.push('- Запустить Сканнер команд (свежие блокеры/stale)');
    lines.push('- Открыть Гант (история переносов)');
    lines.push('- Проверить Чёрный дашборд (Sigma coverage)');
  } else {
    lines.push('### Главные факторы (по значимости)');
    lines.push('');
    for (let i = 0; i < ranked.length; i++) {
      const f = ranked[i];
      lines.push(`**${i + 1}. ${f.title}**`);
      if (f.detail) lines.push(f.detail);
      lines.push('');
    }
    // Summary
    const totalWeight = ranked.reduce((s, f) => s + f.weight, 0);
    lines.push(`_Всего распознано ${factors.length} факторов, суммарный вес: ${totalWeight}._`);
  }

  // Build actions: aggregate unique actions from factors.
  const actions = [];
  const seen = new Set();
  for (const f of ranked) {
    if (f.action) {
      const key = `${f.action.type}:${f.action.label}`;
      if (!seen.has(key)) {
        actions.push(f.action);
        seen.add(key);
      }
    }
  }

  // Drilldown
  const drilldown = [
    subjectLabel && { text: `Полная сводка по ${subjectLabel}`, prompt: `расскажи про ${subjectLabel} за квартал` },
    { text: 'Кто перегружен',     prompt: 'кто перегружен' },
    { text: 'Что в овертайме',    prompt: 'кто овертаймил' },
  ].filter(Boolean);

  // Cards с weights
  const cards = ranked.slice(0, 4).map(f => ({
    title: f.title,
    value: String(f.weight),
    hint: 'вес фактора',
  }));

  return {
    text: lines.join('\n'),
    cards,
    actions,
    drilldown,
    responseSource: 'rule',
    _meta: {
      kind: 'explain',
      factorCount: factors.length,
      topFactor: ranked[0]?.title,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

function _getScannerModel() {
  try { return Services.TeamScanner2?.getModel?.() || null; }
  catch (_) { return null; }
}
function _getBDModel() {
  try { return Services.BlackDashboard?._model || null; }
  catch (_) { return null; }
}
function _pluralEnd(n) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return '';
  if (b === 1) return '';
  if (b > 1 && b < 5) return 'а';
  return '';
}
