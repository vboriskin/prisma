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
      // QD4: дополнительные email-aliases (work + personal, или old/new
      // адреса при reorg). Используется в attribution когда BB-author keyed
      // по personal@gmail.com, а emp.email = work@sber.ru. Pipe-separated
      // в storage. Применяется вместе с основным email — emp matchится
      // если ЛЮБОЙ из них совпал.
      aliasEmails: '',
      jiraAccountId: '',
      bitbucketLogin: '',
      confluenceAccountId: '',
      // V20 S4 — service-account flag. Авто-детект по pattern на jiraKey
      //   (см. EmployeeFactory.detectServiceAccount). Помогает исключить
      //   bot/sa-аккаунты (cab-sa-..., sbt-..., out-...) из counts Сканнера
      //   команд. Override'ится вручную (если автодетект ошибся).
      // ВНИМАНИЕ: дефолт `null` — сигнал «ещё не классифицирован».
      // normalize() запустит detectServiceAccount только если null/undefined.
      // Этим достигается: явный override `true` или `false` через `ov`
      // переживает normalize, не перетирается auto-detect'ом.
      isServiceAccount: null,
      // Заблокированный сотрудник (уволен / вне штата). В Сбер-реестре
      // помечается суффиксом [Х]/[X]/[В]/[B] в ФИО. Авто-детект по regex
      // в normalize(). Исключается из identity-coverage / BB-CF-attribution
      // / любых counts «без bbLogin» — иначе мёртвые души портят метрики.
      isBlocked: null,
      sourceType: 'manual',
      createdAt: now,
      updatedAt: now,
    };
    Object.assign(emp, ov);
    EmployeeFactory.normalize(emp);
    return emp;
  },
  normalize(emp) {
    // TECH кр.2 — memoize normalize: 60s cache. EmployeeFactory.create вызывает
    // normalize при каждом load + restore + auto-create. Если объект уже
    // нормализован недавно и fio не менялся — skip полный pass. Гард-проверка
    // на наличие fio + _normalizedAt чтобы свеже-созданные / только что
    // импортированные emp всё равно прошли полный normalize.
    if (emp.fio && emp._normalizedAt && (Date.now() - emp._normalizedAt) < 60000) {
      return;
    }
    emp.fio = String(emp.fio || '').trim();
    emp.roles = String(emp.roles || '').split(/[|,]/).map(s=>s.trim()).filter(Boolean).join('|');
    emp.teams = String(emp.teams || '').split(/[|,]/).map(s=>s.trim()).filter(Boolean).join('|');
    if (!Array.isArray(emp.overtimeDays)) emp.overtimeDays = Utils.parseDateList(emp.overtimeDays);
    emp.overtimeDays = [...new Set(emp.overtimeDays.map(d=>Utils.parseDateish(d)||d).filter(Boolean))].sort();
    emp.weekdayReady = Utils.toBool(emp.weekdayReady,false);
    emp.weekdayComment = String(emp.weekdayComment || '').split(/[|,]/).map(s=>s.trim()).filter(Boolean).join('|');
    // V17.2 I1a — identity-поля: trim + lowercase email, остальные trim only.
    // F4: jiraAccountId тоже lowercase'им — иначе один и тот же сотрудник
    // импортированный с разным регистром (`JIRAUSER123` vs `jirauser123`)
    // создаёт дубль employee при следующих pulse-job'ах. Старые записи
    // мигрируют автоматически — normalize() прогоняется при каждой загрузке.
    emp.email               = String(emp.email               || '').trim().toLowerCase();
    emp.jiraAccountId       = String(emp.jiraAccountId       || '').trim().toLowerCase();
    emp.bitbucketLogin      = String(emp.bitbucketLogin      || '').trim().toLowerCase();
    emp.confluenceAccountId = String(emp.confluenceAccountId || '').trim().toLowerCase();
    // QD4: aliasEmails — pipe/comma-separated, lowercased, deduped, без основного.
    {
      const raw = String(emp.aliasEmails || '').split(/[|,]/).map(s => s.trim().toLowerCase()).filter(Boolean);
      const main = emp.email;
      const set = new Set(raw.filter(e => e !== main));
      emp.aliasEmails = [...set].join('|');
    }
    // V20 S4 — service-account auto-detect (если не выставлено вручную).
    //   Если в БД есть явный override (true/false) — не трогаем.
    //   Иначе (null / undefined) — определяем по pattern.
    if (emp.isServiceAccount == null) {
      emp.isServiceAccount = EmployeeFactory.detectServiceAccount(emp);
    }
    // TECH 17.5 — кэш detectBlocked по fio. При изменении fio (restore /
    // ручное переименование) — re-detect, иначе skip regex.
    if (emp.isBlocked == null || emp._blockedFor !== emp.fio) {
      emp.isBlocked = EmployeeFactory.detectBlocked(emp);
      emp._blockedFor = emp.fio;
    }
    emp.updatedAt = new Date().toISOString();
    emp._normalizedAt = Date.now();
  },

  /**
   * Заблокированные пользователи помечаются в ФИО суффиксом [Х]/[X]/[В]/[B].
   * Примеры: «Иванов И.И. [Х]», «Петров П.П.[X]», «Сидоров С.С. [В]».
   * Возвращает true если такой маркер есть.
   */
  detectBlocked(emp) {
    const fio = String(emp.fio || '');
    if (!fio) return false;
    return /\[\s*[ХXВB]\s*\]/i.test(fio);
  },

  /**
   * V20 S4 — Pattern-based service account detection.
   *
   * Эвристики (упорядочено по уверенности):
   *   1) jiraKey начинается на cab-sa-, sbt-, sa-, out-, svc-, bot-, system-
   *   2) jiraKey содержит -sa- / -bot- / -svc- / -api- (e.g. user-api-1)
   *   3) email пустой И roles пустой И fio пустой/общий — служебный
   *
   * Не использует ФИО для match'а — иначе сломаем V17.2 I1c contract.
   *
   * @returns {boolean}
   */
  detectServiceAccount(emp) {
    const key = String(emp.jiraKey || emp.jiraAccountId || emp.id || '').toLowerCase();
    if (!key) return false;
    // Pattern 1 — service prefixes (наиболее уверенный сигнал).
    if (/^(cab-sa-|sbt-|sa-|out-dinov-|out-|svc-|bot-|system-)/i.test(key)) return true;
    // Pattern 2 — service infixes.
    if (/-(sa|bot|svc|api|system)-/i.test(key)) return true;
    // Pattern 3 — общие имена ботов (issue-managment, sbbol etc.) — точный список,
    // не fuzzy-substring чтобы не зацепить настоящих людей.
    if (/^(sbt-issue-managment-user|sbt-sbbol|cab-sa-jira\d+)$/i.test(key)) return true;
    return false;
  },

  /**
   * V21 ghost-detect (diagnostic 2026-05-07) — auto-created employees
   * без identity-полей и без ФИО. Это «призраки» в реестре: попали через
   * auto-create из Jira participants (S5.1), но displayName был пустой
   * или равнялся accountId, а email/bb/cf не подтянулись.
   *
   * Критерии (все одновременно):
   *   1) inRegistry (есть в state.employees) — auto-create уже произошёл
   *   2) НЕТ ни одного identity-канала: !email && !bitbucketLogin && !confluenceAccountId
   *   3) ФИО пустой ИЛИ совпадает с jiraAccountId/key (factory fallback)
   *   4) НЕ service-account (там критерии другие)
   *   5) НЕ blocked (с [Х]/[X] — это уволенные, у них могут быть пустые поля)
   *
   * Используется в Сканнере для исключения из counts + UI-фильтра.
   */
  detectGhost(emp) {
    if (!emp) return false;
    if (emp.isServiceAccount) return false;
    if (emp.isBlocked) return false;
    const hasAnyIdentity = !!(
      String(emp.email || '').trim() ||
      String(emp.bitbucketLogin || '').trim() ||
      String(emp.confluenceAccountId || '').trim()
    );
    if (hasAnyIdentity) return false;
    const fio = String(emp.fio || '').trim();
    const accountId = String(emp.jiraAccountId || emp.jiraKey || emp.id || '').trim();
    // ФИО пустое ИЛИ совпадает с techkey (factory вернула fallback) →
    // это auto-created без mapping.
    if (!fio) return true;
    if (fio.toLowerCase() === accountId.toLowerCase()) return true;
    return false;
  },
};
