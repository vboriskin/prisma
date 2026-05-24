'use strict';
/* ============================================================
   DEMO DATA — v11_0  fixture rows for onboarding demo mode
   ============================================================ */

import { state }       from '../state.js';
import { RowFactory }  from '../rowFactory.js';
import { RiskEngine }  from '../riskEngine.js';

/* ---- helpers ---- */
const T = (arr) => arr; // type alias

/* ------------------------------------------------------------------ */
export function loadDemoData() {
  const rows = _buildRows();
  rows.forEach(r => RowFactory.updateDerived(r));
  state.rows = rows;

  // V22+ demo — зависимости между эпиками (для Линзы / графа / бейджей).
  // Ключ/значение = ИМЯ эпика (epicDeps[from] = [to,…] → «from зависит от to»).
  // Цепочки дают и предков, и потомков, и крит-путь:
  //   Apple Pay → Новый процессинг → Интеграция с НСПК
  //   Редизайн → Дашборд KYC → Рефакторинг лимитов ← Автоодобрение
  state.epicDeps = {
    'Новый процессинг платежей SBP': ['Интеграция с НСПК'],
    'Apple Pay повторная интеграция': ['Новый процессинг платежей SBP'],
    'Дашборд KYC-метрик': ['Рефакторинг расчёта лимитов'],
    'Автоматическое одобрение кредитов': ['Рефакторинг расчёта лимитов', 'Дашборд KYC-метрик'],
    'Редизайн главного экрана': ['Дашборд KYC-метрик'],
  };

  // V22+ demo — вехи на оси (для «Курса» / milestone-линий).
  const today = new Date();
  const isoShift = (days) => new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10);
  state.milestones = [
    { id: 'ms_demo_1', date: isoShift(-34), label: 'Старт квартала' },
    { id: 'ms_demo_2', date: isoShift(2),   label: 'Релиз 1.21' },
    { id: 'ms_demo_3', date: isoShift(40),  label: 'Code freeze 1.22' },
  ];

  RiskEngine.computeAll();
  state.employees = [];
  state.diagnostics = {
    sources:['demo'], sheets:['Demo'], rowsPerSheet:{Demo:rows.length},
    detectedColumns:{}, missingColumns:{}, warnings:[],
    registryCount:rows.length, csvImportCount:0, localStorageCount:0,
  };
}

/* ------------------------------------------------------------------ */
function _buildRows() {
  let _id = 1000;
  const id = () => 'demo_' + (_id++).toString(36);
  const now = new Date().toISOString();

  // V17 P12 (designer §5) — keep demo dates relative to "today" instead of
  // hard-coding 2024-03. Hard dates aged poorly (by 2026 the demo showed
  // «просрочено на 700 дней» which corrupted the risk story). The helper
  // generates ISO yyyy-mm-dd strings shifted by N days from today.
  const today = new Date();
  const isoShift = (days) => {
    const d = new Date(today.getTime() + days * 86400000);
    return d.toISOString().slice(0, 10);
  };

  // helper: RowFactory.create is fine but we avoid double-updateDerived
  const mk = (ov) => {
    const r = RowFactory.create({ id: id(), createdAt: now, updatedAt: now, ...ov });
    return r;
  };

  return [
    /* ── Release 1.20 tasks ─────────────────────────────────────── */
    mk({
      team: 'Платежи',
      epic: 'Новый процессинг платежей SBP',
      tasks: 'SBOF-101, SBOF-102',
      scopeStatus: 'Да',
      release120Types: ['backend', 'тестирование'],
      assignee: 'Иванов А.',
      blockingDependency: true,
      blockingDeadline: isoShift(14),  // overdue by ~14 days from today
      // V22+ demo: тестирование готово, backend в работе; жёсткий дедлайн-риск
      donePills: { 'r120__тестирование': true },
      inProgressPills: { 'r120__backend': true },
      cellRisks: [{ id: 'rk_sbp', col: 'r120', kind: 'hard-deadline', text: 'Регуляторный дедлайн SBP — нельзя сдвигать', dueDate: isoShift(5) }],
    }),
    mk({
      team: 'Платежи',
      epic: 'Новый процессинг платежей SBP',
      tasks: 'SBOF-103',
      scopeStatus: 'Да',
      release120Types: ['frontend'],
      assignee: 'Петрова М.',
    }),
    mk({
      team: 'Кредиты',
      epic: 'Рефакторинг расчёта лимитов',
      tasks: 'SBOF-201',
      scopeStatus: 'Требует подтверждения',
      release120Types: ['аналитика', 'backend'],
      assignee: 'Сидоров В.',
      // V22+ demo: аналитика готова, backend в работе
      donePills: { 'r120__аналитика': true },
      inProgressPills: { 'r120__backend': true },
    }),
    mk({
      team: 'Кредиты',
      epic: 'Рефакторинг расчёта лимитов',
      tasks: 'SBOF-202, SBOF-203',
      scopeStatus: 'Требует подтверждения',
      release120Types: ['тестирование'],
      assignee: 'Сидоров В.',
    }),
    mk({
      team: 'Интеграции',
      epic: 'Интеграция с НСПК',
      tasks: 'SBOF-301',
      scopeStatus: 'Да',
      release120Types: ['backend', 'внедрение'],
      assignee: 'Козлов Д.',
      blockingDependency: true,
      blockingDeadline: isoShift(7),  // overdue by ~7 days
      // V22+ demo: backend готов
      donePills: { 'r120__backend': true },
    }),
    mk({
      team: 'Интеграции',
      epic: 'Интеграция с НСПК',
      tasks: 'SBOF-302',
      scopeStatus: 'Да',
      release120Types: ['миграция данных'],
      assignee: 'Козлов Д.',
    }),
    mk({
      team: 'Безопасность',
      epic: 'Обновление TLS-сертификатов',
      tasks: 'SBOF-401',
      scopeStatus: 'Да',
      release120Types: ['стабилизация'],
      assignee: 'Новиков К.',
      isDone: true,
      doneDate: isoShift(-21),  // completed ~3 weeks ago
      donePills: { 'r120__стабилизация': true },
    }),

    /* ── Release 1.21 tasks ─────────────────────────────────────── */
    mk({
      team: 'Аналитика',
      epic: 'Дашборд KYC-метрик',
      tasks: 'SBOF-501',
      scopeStatus: 'Да',
      release121Types: ['аналитика', 'frontend'],
      assignee: 'Морозова Е.',
      // V22+ demo: аналитика в работе и переехала из 1.20 (для Переносов/Истории)
      inProgressPills: { 'r121__аналитика': true },
      ganttArrows: [{ wt: 'аналитика', srcCol: 'r120', dstCol: 'r121', at: isoShift(-28) }],
      transferComments: [{ at: isoShift(-28), from: 'r120', to: 'r121', wt: 'аналитика', text: 'Перенос: ждали выгрузку из НСПК' }],
    }),
    mk({
      team: 'Аналитика',
      epic: 'Дашборд KYC-метрик',
      tasks: 'SBOF-502, SBOF-503',
      scopeStatus: 'Да',
      release121Types: ['backend'],
      assignee: 'Морозова Е.',
    }),
    mk({
      team: 'Кредиты',
      epic: 'Автоматическое одобрение кредитов',
      tasks: 'SBOF-601',
      scopeStatus: 'Требует подтверждения',
      release121Types: ['бизнес аналитика', 'аналитика'],
      assignee: 'Смирнова О.',
      // V22+ demo: открытый вопрос по скоупу + переезд из 1.20
      cellRisks: [{ id: 'rk_auto', col: 'r121', kind: 'open-question', text: 'Скоуп ML-модели не подтверждён бизнесом' }],
      ganttArrows: [{ wt: 'аналитика', srcCol: 'r120', dstCol: 'r121', at: isoShift(-35) }],
      transferComments: [{ at: isoShift(-35), from: 'r120', to: 'r121', wt: 'аналитика', text: 'Сдвинули — зависит от рефакторинга лимитов' }],
    }),
    mk({
      team: 'Кредиты',
      epic: 'Автоматическое одобрение кредитов',
      tasks: 'SBOF-602',
      scopeStatus: 'Да',
      release121Types: ['backend', 'тестирование'],
      assignee: 'Смирнова О.',
    }),
    mk({
      team: 'Платежи',
      epic: 'Apple Pay повторная интеграция',
      tasks: 'SBOF-701',
      scopeStatus: 'Да',
      release121Types: ['внедрение', 'тестирование'],
      assignee: 'Петрова М.',
      // V22+ demo: внедрение в работе + переехало из 1.20
      inProgressPills: { 'r121__внедрение': true },
      ganttArrows: [{ wt: 'внедрение', srcCol: 'r120', dstCol: 'r121', at: isoShift(-20) }],
      transferComments: [{ at: isoShift(-20), from: 'r120', to: 'r121', wt: 'внедрение', text: 'Перенос из 1.20 — ждали процессинг SBP' }],
    }),

    /* ── Release 1.22 tasks ─────────────────────────────────────── */
    mk({
      team: 'Мобайл',
      epic: 'Редизайн главного экрана',
      tasks: 'SBOF-801',
      scopeStatus: 'Да',
      release122Types: ['frontend'],
      assignee: 'Лебедев Т.',
      // V22+ demo: 3 переезда → нестабильный эпик (churn-бейдж: 1.20→1.21→1.22)
      ganttArrows: [
        { wt: 'frontend', srcCol: 'r120', dstCol: 'r121', at: isoShift(-62) },
        { wt: 'frontend', srcCol: 'r121', dstCol: 'r122', at: isoShift(-30) },
        { wt: 'frontend', srcCol: 'r122', dstCol: 'r122', at: isoShift(-12) },
      ],
      transferComments: [{ at: isoShift(-30), from: 'r121', to: 'r122', wt: 'frontend', text: 'Дважды переезжал — скоуп дизайна нестабилен' }],
    }),
    mk({
      team: 'Мобайл',
      epic: 'Редизайн главного экрана',
      tasks: 'SBOF-802, SBOF-803',
      scopeStatus: 'Да',
      release122Types: ['frontend', 'тестирование'],
      assignee: 'Лебедев Т.',
    }),
    mk({
      team: 'Безопасность',
      epic: 'Переход на mTLS внутри контура',
      tasks: 'SBOF-901',
      scopeStatus: 'Требует подтверждения',
      release122Types: ['backend', 'стабилизация'],
      assignee: 'Новиков К.',
      // V22+ demo: висящая зависимость (dangling-риск)
      cellRisks: [{ id: 'rk_mtls', col: 'r122', kind: 'dangling', text: 'Висящая зависимость от сетевого контура — не закрыта' }],
    }),

    /* ── Overtime ────────────────────────────────────────────────── */
    mk({
      team: 'Интеграции',
      epic: 'Исправление уязвимости CVE-2024-1234',
      tasks: 'SBOF-1001',
      scopeStatus: 'Да',
      overtimeTypes: ['хотфикс', 'тестирование'],
      assignee: 'Козлов Д.',
      blockingDependency: true,
      blockingDeadline: isoShift(21),  // due in ~3 weeks
    }),
    mk({
      team: 'Платежи',
      epic: 'Хотфикс: дублирование транзакций',
      tasks: 'SBOF-1002',
      scopeStatus: 'Да',
      overtimeTypes: ['хотфикс'],
      assignee: 'Иванов А.',
    }),

    /* ── Backlog (unassigned — no release) ───────────────────────── */
    mk({
      team: 'Кредиты',
      epic: 'Экспорт отчётов в Excel',
      tasks: 'SBOF-1101',
      scopeStatus: 'Нет',
    }),
    mk({
      team: 'Аналитика',
      epic: 'Исследование A/B тестирования',
      tasks: 'SBOF-1201',
      scopeStatus: 'Нет',
      assignee: 'Морозова Е.',
    }),
    mk({
      team: 'Мобайл',
      epic: 'Push-уведомления: новый провайдер',
      tasks: 'SBOF-1301',
      scopeStatus: 'Нет',
    }),

    /* ── Extra: overloaded assignee (Козлов Д.) ──────────────────── */
    mk({
      team: 'Интеграции',
      epic: 'СМЭВ3 адаптер',
      tasks: 'SBOF-1401',
      scopeStatus: 'Да',
      release120Types: ['backend'],
      assignee: 'Козлов Д.',
    }),
    mk({
      team: 'Интеграции',
      epic: 'СМЭВ3 адаптер',
      tasks: 'SBOF-1402',
      scopeStatus: 'Да',
      release121Types: ['тестирование'],
      assignee: 'Козлов Д.',
    }),
  ];
}
