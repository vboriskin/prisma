'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — ENRICHMENT  (V18.1 P3)

   Pure functions, расширяющие model `analysePulse()` дополнительными
   агрегатами для v2.0 UI:

     · heatmap[3][24]   — 24-часовая активность за today/yesterday/prev
     · contextSwitches  — переключения между задачами (gap < 30 мин)
     · timeline72h      — единая лента 72ч событий (sorted DESC)
     · blockers         — issues с dwell-time > N часов в текущем статусе

   Дизайн: enrichment ОПЦИОНАЛЬНЫЙ (вызывается ТОЛЬКО v2.0 orchestrator'ом).
   v1 не запускает его → нулевой performance impact для v1. Все новые
   поля ДОБАВЛЯЮТСЯ к участнику; старые НЕ переименовываются.

   Open question §G.1 — TZ heatmap. P3 решение: SERVER LOCAL TIME (как
   и весь Pulse pipeline). Browser TZ — будущая enhancement (потребует
   передачи TZ от клиента в /employee-detail запросе в P4+).

   Open question §G.2 — Blocker dwell threshold. P3 решение: единый
   24ч порог. Статус-зависимые пороги (Code Review >8ч, In Progress
   >48ч) — P4+ override через config.
   ============================================================ */

import { isTerminalStatus } from './portfolioPulseUtils.js';
import { Utils } from '../utils.js';
// V20 S11 — Per-person metrics (Z1-Z10).
import { applyPersonMetrics } from './teamScanner2PersonMetrics.js';

const DEFAULT_DWELL_HOURS = 24;

/**
 * V20 S6.2.4 — Merge blockers (computed from assigneeIndex) со stale items
 * (computed in pulseModel из broader timeline-based signal).
 *
 * Правила:
 *   · blockers wins на дубликатах по issue.key (он точнее — учитывает
 *     dwellHours и пороги).
 *   · stale items без блокирующих признаков (но в long-stale статусе)
 *     добавляются как «дополнительные blockers» с source='stale-merge'.
 *   · result сортируется по dwellHours desc.
 */
function _mergeBlockersWithStale(blockers, stale) {
  const blockerKeys = new Set();
  for (const b of (blockers || [])) {
    if (b?.key) blockerKeys.add(b.key);
  }
  const merged = [...(blockers || [])];
  for (const s of (stale || [])) {
    if (!s?.key) continue;
    if (blockerKeys.has(s.key)) continue;
    // Stale-only entries: переносим как «soft» blockers с источником.
    merged.push({
      ...s,
      source: 'stale-merge',
    });
  }
  // Сортировка по dwellHours desc (если есть). Старые items внизу — игнорируем.
  merged.sort((a, b) => Number(b?.dwellHours || 0) - Number(a?.dwellHours || 0));
  return merged;
}

/**
 * V20 S4 — Inline service-account pattern detection.
 *
 * Дублирует логику EmployeeFactory.detectServiceAccount, но напрямую
 * вызывается из enrichment'а для «legacy storage employees» у которых
 * нет isServiceAccount флага. Не импортируем rowFactory чтобы избежать
 * циклической зависимости (rowFactory → state → tooling → ...).
 *
 * При изменении паттернов — синхронизировать обе копии.
 */
function _detectServiceAccountByKey(rawKey) {
  const key = String(rawKey || '').toLowerCase().trim();
  if (!key) return false;
  if (/^(cab-sa-|sbt-|sa-|out-dinov-|out-|svc-|bot-|system-)/i.test(key)) return true;
  if (/-(sa|bot|svc|api|system)-/i.test(key)) return true;
  if (/^(sbt-issue-managment-user|sbt-sbbol|cab-sa-jira\d+)$/i.test(key)) return true;
  return false;
}

/**
 * V20 S10.6 — Build a Set of issue keys that belong to currently active sprints.
 *
 * Источник: `model.spaces[pk].sprintIssues[]` — заполняется analysePulse'ом
 * на основе `report.sprintKeys` (от Jira `sprint in openSprints()` JQL).
 * Один pk = один активный спринт (по соглашению с пользователем). При
 * carry-over (issue в 2 спринтах одновременно) Jira возвращает её в активном
 * спринте — она попадёт в Set.
 *
 * @param {object} model — output of analysePulse()
 * @returns {Set<string>}
 */
function _buildActiveSprintKeySet(model) {
  const keys = new Set();
  const spaces = model?.spaces || {};
  for (const pk of Object.keys(spaces)) {
    const sp = spaces[pk] || {};
    for (const it of (sp.sprintIssues || [])) {
      if (it?.key) keys.add(it.key);
    }
  }
  return keys;
}

/**
 * V20 S10.6 — Filter participant's activity items to only those tied to
 * issues in `activeSprintKeys`. Mutates participant in-place.
 *
 * Поля где ищем `issue.key`:
 *   · timelineToday/Yesterday/Prev — `it.issue.key`
 *   · zephyrTestsCreatedRecent      — `it.slim.key` (TEST issue itself)
 *   · zephyrTestsExecutedRecent     — `it.slim.key`
 *   · issuesNow                     — `it.key`
 *
 * bbItems и cfItems НЕ фильтруются здесь: коммиты из repo-walk никогда не
 * имеют issueKey (commit-msg парсинг не реализован), поэтому фильтрация
 * давала badges.commits48h > 0 при пустом bbItems → «Коммиты без транзишенов»
 * на карточке + пустая модалка. Sprint filter влияет только на Jira-таймлайн
 * (classifer читает badges/timeline, не bbItems напрямую).
 */
function _filterParticipantBySprintKeys(p, sprintKeys) {
  const ok = (k) => typeof k === 'string' && sprintKeys.has(k);
  const filt = (arr, getKey) => Array.isArray(arr)
    ? arr.filter(it => ok(getKey(it)))
    : arr;
  p.timelineToday      = filt(p.timelineToday,     it => it?.issue?.key);
  p.timelineYesterday  = filt(p.timelineYesterday, it => it?.issue?.key);
  p.timelinePrev       = filt(p.timelinePrev,      it => it?.issue?.key);
  p.zephyrTestsCreatedRecent  = filt(p.zephyrTestsCreatedRecent,  it => it?.slim?.key);
  p.zephyrTestsExecutedRecent = filt(p.zephyrTestsExecutedRecent, it => it?.slim?.key);
  p.issuesNow          = filt(p.issuesNow,         it => it?.key);
  p.stale              = filt(p.stale,             it => it?.key);
  // V21 sprint-filter — компромисс между «strict» и «не трогать».
  // Sber Stash-коммиты НЕ парсятся по issueKey из commit-msg → у большинства
  // bbItems нет `issueKey`. Если выкинуть их строго (как в первой попытке
  // 2026-05-07) — на пилоте СБОФ Платформа `rawFetched: 351 →
  // filteredOutOrUnattributed: 351`, ВСЁ BB-attribution умирает.
  // Решение: items с issueKey → фильтруем по спринту; items БЕЗ issueKey →
  // оставляем (это PR/коммиты без Jira-связи, тимлид всё равно хочет видеть
  // их в person-feed). Badges НЕ пересчитываем — они отражают raw-активность,
  // не sprint-scoped.
  const sprintAware = (arr, getKey) => Array.isArray(arr)
    ? arr.filter(it => {
        const k = getKey(it);
        if (!k) return true;          // нет issueKey — keep
        return sprintKeys.has(k);     // есть — должен быть в активном спринте
      })
    : arr;
  // 2026-05-11 — bbItems/cfItems НЕ фильтруются по active-sprint. Причина:
  // commits из repo-walk не имеют issueKey → фильтрация выкидывала их и
  // создавала рассинхрон badge/items («Коммиты 48ч: 5» + пустая detail-modal).
  // PRs с issueKey CORE-99 (не в активном спринте) — тоже legitimate work,
  // не должны исчезать. Фильтр оставлен только на: zephyr / issuesNow /
  // timeline (там issueKey всегда есть и спринт-scope важен).
}

function _applyActiveSprintFilter(model, sprintKeys) {
  for (const p of (model.participants || [])) {
    _filterParticipantBySprintKeys(p, sprintKeys);
  }
}

// V20 S10.1 — Detect deactivated Jira/BB accounts by `[X]` suffix in display
// name. В Sber Delta Jira deactivated users получают суффикс `[X]` к
// displayName (договорённость администраторов корп-Jira). Bitbucket для тех
// же email'ов — то же поведение.
//
// Покрываем латинский+кириллический X, full-width брэкеты `［X］`/`〔X〕`,
// trailing whitespace. НЕ ловим `[X-MAN]`/`[XO]` (X не последний символ
// внутри скобок) — там X часть названия.
//
// V20 S11.1 BUG-5 — расслабляем trailing-anchor: HR в Sber иногда добавляет
// суффикс типа `Иванов И.И. [X] (уволен 2025-12-31)`. Раньше regex требовал
// `[X]` строго в конце строки → false negative. Теперь матчим `[X]` где
// угодно после которого допускаются только пробелы / parenthetical
// аннотации `(...)` / даты до конца. Это сохраняет защиту от false positives
// (имя типа `[X-MAN] Petr` всё ещё не матчит — там X внутри скобок не
// одиночный).
// PR-CH — алиасы на централизованный helper в utils.js. Backward compat.
const DEACTIVATED_LABEL_RE = Utils.DEACTIVATED_LABEL_RE;
const _isDeactivatedByLabel = Utils.isDeactivatedAccount;
// V20 S8.5 #2 — METRIC_THRESHOLDS подключены. Раньше словарь был в Config,
// но никем не использовался — оба архитектора нашли как «мёртвый словарь».
// Импортить из Config напрямую = circular (Config импортит DEFAULT_DWELL_THRESHOLDS
// отсюда). Решение: METRIC_THRESHOLDS живут здесь, Config их re-export'ит.
export const METRIC_THRESHOLDS = {
  switchGapSec:                30 * 60,
  switchesPerHourForFullScore: 4,
  sprintPaceTolerancePct:      10,
  orphanFreshMs:               30 * 86400 * 1000,
  crvSlowHours:                24,
  crvWarnHours:                8,
  crvOutlierMaxHours:          14 * 24,
  prThroughputDays:            7,
  prOverloadOpenedThreshold:   5,
  prOverloadRateThreshold:     0.4,
  prHealthyRateThreshold:      0.7,
};
const SWITCH_GAP_SEC                    = METRIC_THRESHOLDS.switchGapSec;
const SWITCHES_PER_HOUR_FOR_FULL_SCORE  = METRIC_THRESHOLDS.switchesPerHourForFullScore;

/**
 * V18.1 P7-S2.2 — differential dwell-thresholds (status-aware).
 *
 * SM/PO panel: единый 24ч порог для blocker'ов смешивает семантики.
 * Code Review > 8ч уже горит для команды, In Progress 30ч — норма.
 * Семантика «blocker» становится действенной только когда threshold
 * привязан к статусу.
 *
 * Lookup — fuzzy lowercase match по statusName. Override через opts.thresholds.
 */
export const DEFAULT_DWELL_THRESHOLDS = {
  codeReview:  8,   // Code Review > 8ч = блокер (зависает на ревьюерах)
  qa:         16,   // QA / Testing > 16ч = блокер
  inProgress: 48,   // In Progress > 48ч = блокер (давно начали, не закончили)
  todo:       72,   // To Do > 72ч в спринте = подвис
  default:    24,   // Все остальные non-terminal — fallback
};

/**
 * V18.1 P7-S2.3 — TZ-aware hour extraction.
 *
 * Контекст: enrichment запускается и на КЛИЕНТЕ (browser TZ), и на
 * СЕРВЕРЕ (server TZ, обычно UTC в k8s-deployment). Без offset'а
 * heatmap «съезжает»: пик 14:00 МСК показывается в часе 11:00 при
 * server-side drill-down /employee-detail.
 *
 * Решение: client передаёт `Date.getTimezoneOffset()` (минуты WEST of
 * UTC; для МСК = -180) в /employee-detail body, server использует.
 *
 * @param {string} iso ISO timestamp («2026-05-02T11:00:00Z»)
 * @param {number} [tzOffsetMin] минуты WEST of UTC (как от Date.getTimezoneOffset()).
 *   undefined → используется environment-local Date.getHours() (для in-browser fetch).
 * @returns {number} 0..23 hour-of-day в нужной TZ
 */
export function getLocalHour(iso, tzOffsetMin) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return -1;
  if (typeof tzOffsetMin !== 'number') return d.getHours();
  // utcMs - offsetMin*60000 → adjusted to user's TZ when read as UTC.
  // tzOffsetMin = -180 (МСК) → utcMs - (-180)*60000 = utcMs + 180min = correctly +3h.
  const adjustedMs = d.getTime() - tzOffsetMin * 60 * 1000;
  return new Date(adjustedMs).getUTCHours();
}

/** Pick dwell-threshold for a status name. Fuzzy lowercase match.
 *  V18.3 A3 — добавлен «Ready for QA» / «Готов к QA» в QA-категорию.
 *  Pilot finding (Ilia QA): «"Ready for QA" — это PR с UI-изменениями
 *  ждёт smoke-pass; default=24 даёт false-negative, надо 16ч как другой QA».
 */
// QD14: Set для отслеживания статусов которые fall-through на default —
// surface'ится в model.scannerV2.unknownDwellStatuses для диагностики
// custom workflow ситуаций (когда blocker'ы могут пропускаться).
const _UNKNOWN_DWELL_STATUSES = new Set();
export function pickDwellThreshold(statusName, thresholds = DEFAULT_DWELL_THRESHOLDS) {
  const s = String(statusName || '').toLowerCase();
  if (/code\s*review|peer\s*review|на\s+ревью|ревью\s+кода/.test(s)) return thresholds.codeReview;
  // QA-bucket: covers Ready for QA / Готов к QA / Testing / Тестирование / QA
  if (/\bqa\b|\btest(ing)?\b|тестирован|ready\s+for\s+qa|готов(а|о)?\s+к\s+qa/.test(s)) return thresholds.qa;
  if (/in\s*progress|\bworking\b|\bdoing\b|в\s+работе|разработ/.test(s)) return thresholds.inProgress;
  if (/\btodo\b|to\s*do|\bopen\b|\bnew\b|открыт|новая/.test(s))      return thresholds.todo;
  // Fall-through на default: если статус нестандартный (`Awaiting deploy`,
  // `Reviewed`, `Ready for Release`...), threshold может быть некорректным
  // (default обычно ≥ 24ч, реальные blocker'ы пропускаются). Логируем для
  // surface'а в diagnostic.
  if (statusName) _UNKNOWN_DWELL_STATUSES.add(String(statusName));
  return thresholds.default;
}
/** QD14: Получить накопленные unknown-statuses + опциональный reset. */
export function getUnknownDwellStatuses(reset = false) {
  const out = [..._UNKNOWN_DWELL_STATUSES];
  if (reset) _UNKNOWN_DWELL_STATUSES.clear();
  return out;
}

/**
 * Apply v2.0 enrichment to a model produced by analysePulse(). MUTATES the
 * model — добавляет per-participant поля + top-level `model.scannerV2` meta.
 *
 * @param {object} model        — output of analysePulse()
 * @param {object} [rawReports] — original raw response (нужен для blockers,
 *                                которым требуется issue.changelog)
 * @param {object} [opts]       — { dwellHours? }
 * @returns {object} the same model (mutated, returned for chaining)
 */
export function enrichForScanner2(model, rawReports = null, opts = {}) {
  if (!model || !Array.isArray(model.participants)) return model;
  // V20 S4 — отфильтровать service-accounts ДО enrichment'а. Они не
  // должны попадать в counts / heatmap / blockers / risks. Если
  // opts.includeServiceAccounts === true — оставляем (для диагностики
  // или служебного режима).
  //
  // V20 S4 fix — defensive auto-detect по participant.key напрямую.
  // Причина: emp.isServiceAccount устанавливается в EmployeeFactory.normalize(),
  // который запускается ТОЛЬКО при create(). Если employees были в localStorage
  // до S4 deploy — normalize не запускался, флаг = undefined,
  // p.isServiceAccount = !!undefined = false, фильтр пропускал бота.
  // Теперь вторая проверка: pattern прямо по p.key + p.jiraAccountId.
  const filteredOutBots = [];
  // V20 S10.1 — отдельный bucket для deactivated `[X]`-юзеров. Показываем
  // в diagnostic + при включённом toggle «показать заблокированных» возвращаем
  // в participants[].
  const filteredOutDeactivated = [];
  if (!opts.includeServiceAccounts) {
    model.participants = model.participants.filter(p => {
      if (!p) return true;
      // 1) Явный флаг из реестра (если employee был create()'нут после S4).
      if (p.isServiceAccount) {
        filteredOutBots.push({ key: p.key, label: p.label, source: 'registry' });
        return false;
      }
      // 2) Pattern detection прямо по participant.key (legacy storage fix).
      if (_detectServiceAccountByKey(p.key) || _detectServiceAccountByKey(p.jiraAccountId)) {
        filteredOutBots.push({ key: p.key, label: p.label, source: 'pattern' });
        return false;
      }
      return true;
    });
  }
  // V20 S10.6 — Active Sprint Only filter. Применяется ПОСЛЕ bot/deactivated
  // фильтрации, ДО per-participant compute (heatmap/blockers/timeline72h),
  // чтобы все производные метрики автоматически были sprint-scoped.
  //
  // Pilot finding: «не хочу видеть людей у которых вся активность в бэклоге
  // или прошлых спринтах». Фильтрует timeline (events), bb-items, cf-items,
  // zephyr items, issuesNow по `issue.key ∈ activeSprintIssueKeys`.
  //
  // SAFETY: если включить filter но `model.spaces[pk].sprintIssues` пуст
  // (нет спринта у команды) — НЕ filter'им (fail-open), иначе пользователь
  // увидит «всё пусто» без объяснения.
  let activeSprintFilterApplied = false;
  let activeSprintKeyCount = 0;
  // V20 S11.1 BUG-8 — различаем 3 состояния fail-open:
  //   'no-sprint' — у всех команд нет активного спринта (нормальная ситуация
  //                 для команд между спринтами, не баг)
  //   'api-error' — хотя бы у одной команды space.hasError=true → данные
  //                 неполные, возможно sprintIssues missing из-за ошибки API
  //   'ok'        — фильтр применён успешно
  let failOpenReason = 'ok';
  if (opts.activeSprintOnly) {
    const sprintKeys = _buildActiveSprintKeySet(model);
    activeSprintKeyCount = sprintKeys.size;
    const anySpaceHasError = Object.values(model.spaces || {}).some(s => s?.hasError);
    if (sprintKeys.size > 0) {
      _applyActiveSprintFilter(model, sprintKeys);
      activeSprintFilterApplied = true;
    } else if (anySpaceHasError) {
      failOpenReason = 'api-error';
    } else {
      failOpenReason = 'no-sprint';
    }
  }
  // V20 S10.6 — снимок состояния фильтра, прокидывается через локальные
  // переменные в финальный model.scannerV2 (см. ниже, model.scannerV2 = {...}).
  const _activeSprintFilterMeta = {
    requested: !!opts.activeSprintOnly,
    applied:   activeSprintFilterApplied,
    sprintIssueKeyCount: activeSprintKeyCount,
    // V20 S11.1 BUG-8 — UI должен отличать «нет спринта» от «API упал».
    failOpenReason, // 'ok' | 'no-sprint' | 'api-error'
  };
  // V20 S10.1 — фильтрация deactivated `[X]`-юзеров (default ON).
  // opts.includeDeactivated === true → оставляем (toggle «показать
  // заблокированных» в UI для аудита/handover). Источник истины — суффикс
  // `[X]` в displayName/label, который Sber Delta Jira ставит автоматически.
  if (!opts.includeDeactivated) {
    model.participants = model.participants.filter(p => {
      if (!p) return true;
      if (_isDeactivatedByLabel(p)) {
        filteredOutDeactivated.push({ key: p.key, label: p.label });
        return false;
      }
      return true;
    });
  }
  // Сохраняем как property модели — UI/диагностика смогут показать.
  model.botsFilteredOut = filteredOutBots;
  model.deactivatedFilteredOut = filteredOutDeactivated;
  const dwellHours = Number(opts.dwellHours || DEFAULT_DWELL_HOURS);
  // V18.1 P7-S2.2 — каждое статус-зависимое значение можно override'нуть
  // через opts.thresholds. Bare scalar `dwellHours` остался как
  // backward-compat для default-fallback.
  const thresholds = {
    ...DEFAULT_DWELL_THRESHOLDS,
    default: dwellHours,
    ...(opts.thresholds || {}),
  };
  // V18.3 A1 — per-team thresholds override (Olga ML pilot finding).
  // Map<pk, thresholds-map>. computeBlockers ниже использует teamThresholds[pk]
  // если для конкретной команды задан override, иначе fallback на global
  // thresholds.
  const teamThresholds = opts.teamThresholds || {};

  const assigneeIndex = rawReports ? buildAssigneeIndex(rawReports) : null;

  // V18.1 P7-S2.3 — tzOffsetMin прокидывается во все TZ-зависимые
  // computations. Если не передан — используется environment-local Date.
  const tz = (typeof opts.tzOffsetMin === 'number') ? opts.tzOffsetMin : null;

  // UX feedback 2026-05-10 (Sc3) — sprint filter не применялся к p.blockers,
  // поэтому при включённом «Только активный спринт» в карточках всё равно
  // светились старые задачи. computeBlockers идёт через assigneeIndex (raw
  // Jira), минуя _applyActiveSprintFilter. Нужен post-filter: после построения
  // blockers выкинуть те, чей key не в sprintKeys (если фильтр applied).
  const _sprintKeysForBlockers = (_activeSprintFilterMeta.applied)
    ? _buildActiveSprintKeySet(model)
    : null;
  for (const p of model.participants) {
    p.heatmap         = computeHeatmap(p, tz);
    p.contextSwitches = computeContextSwitches(p);
    p.timeline72h     = computeTimeline72h(p, tz);
    // V20 S6.2.4 — Stale ↔ blockers merge.
    // computeBlockers смотрит ТОЛЬКО на assigneeIndex (issues где user — assignee).
    // p.stale содержит более широкий signal (включая issues где user активен через
    // timeline = reviewer / commenter). Раньше blockers перезаписывал stale полностью —
    // терялись reviewer-сигналы. Теперь merge by issue.key (blockers wins на дубликатах).
    const blockersBase = assigneeIndex
      ? computeBlockers(p, assigneeIndex, thresholds, teamThresholds)
      : [];
    p.blockers = _mergeBlockersWithStale(blockersBase, p.stale || []);
    // Sc3 fix — apply sprint filter to blockers (must happen post-merge).
    // Fail-open: если sprintKeys пустой — НЕ фильтруем (поведение _applyActiveSprintFilter
    // уже учитывает это). При sprintKeys есть — выкинуть всё что вне активного спринта.
    if (_sprintKeysForBlockers && _sprintKeysForBlockers.size > 0) {
      p.blockers = (p.blockers || []).filter(b => b && b.key && _sprintKeysForBlockers.has(b.key));
    }
    // V18.1 P5 — расширенные сигналы для side-panel:
    p.heatmap72x4     = computeHeatmap72x4(p, tz);   // 4 sources × 72 hours
    p.sparkline72h    = computeSparkline72h(p);      // 72 значений events/час (deprecated в S2.5)
  }

  // V18.1 P7-S2.1.5 — risk summary (orphans + out-of-sprint).
  // V18.1 P7-S2.1 — sprint goal progress.
  // V20 S6.3 — new metrics (включаются после S5 расширенного покрытия).
  // V20 S8 #18 + S8.5 #3 — memoize. Fingerprint расширен:
  //   · model.fetchedAt — основной identity модели
  //   · participants.length — защита от мутации модели
  //   · teamThresholds + dwellHours — Tech Lead audit gotcha: «при изменении
  //     per-team порога memo возвращает stale, потому что fp не учитывал opts».
  // Также memo помечен non-enumerable — НЕ попадает в JSON-export через
  // _safeDeepClone (Senior Full-stack audit: «memo удваивает размер export'а»).
  const memoKey = '_v20s8_metricsMemo';
  const fpThresholds = teamThresholds ? JSON.stringify(teamThresholds).slice(0, 200) : '';
  const fp = `${model.fetchedAt || ''}|${(model.participants || []).length}|${dwellHours}|${fpThresholds}`;
  let cache = model[memoKey];
  if (!cache || cache._fp !== fp) {
    cache = {
      _fp: fp,
      risks:              computeRiskSummary(model),
      sprintGoal:         computeSprintGoal(model),
      codeReviewVelocity: computeCodeReviewVelocity(model),
      prThroughput:       computePrThroughput(model),
      crossTeamDeps:      computeCrossTeamDependencies(model),
    };
    // Non-enumerable — JSON.stringify пропускает, не попадает в diagnostic export.
    // S8.5 #4 (BONUS): закрывает leak-vector при scrub-режиме.
    Object.defineProperty(model, memoKey, {
      value: cache, writable: true, enumerable: false, configurable: true,
    });
  }
  const { risks, sprintGoal, codeReviewVelocity, prThroughput, crossTeamDeps } = cache;

  model.scannerV2 = {
    enrichedAt: Date.now(),
    dwellThresholdHours: dwellHours,    // backward-compat (default fallback)
    dwellThresholds: thresholds,        // V18.1 P7-S2.2 — full map (global default)
    teamThresholds,                     // V18.3 A1 — per-pk override map
    tzOffsetMin: tz,                    // V18.1 P7-S2.3 — null = environment-local
    serverLocalTZ: tz === null,         // если null → server local; иначе TZ-aware
    switchGapSec: SWITCH_GAP_SEC,
    risks,                              // V18.1 P7-S2.1.5
    sprintGoal,                         // V18.1 P7-S2.1
    // V20 S6.3 — new metrics. Видимы в diagnostic export + UI dashboards.
    codeReviewVelocity,
    prThroughput,
    crossTeamDeps,
    // V20 S10.6 — Active Sprint Only filter meta (UI badge + diagnostic).
    activeSprintFilter: _activeSprintFilterMeta,
  };
  // V20 S11 — Per-person metrics (Z1-Z3, Z6, Z8, Z9, Z10). Применяется
  // ПОСЛЕ финального model.scannerV2 чтобы все pre-computed поля (badges,
  // contextSwitches, blockers) были на месте.
  applyPersonMetrics(model);
  return model;
}

/* ────────────────────────────────────────────────────────── */
/* Heatmap — 3 days × 24 hours, server local time             */
/* ────────────────────────────────────────────────────────── */

/**
 * Returns { grid: number[3][24], peakHour, peakCount, quietHours[] }
 *   grid[0] = today, grid[1] = yesterday, grid[2] = day-before
 *   Hour bucket = `Date.getHours()` (server local).
 */
export function computeHeatmap(p, tzOffsetMin) {
  const grid = [
    new Array(24).fill(0),
    new Array(24).fill(0),
    new Array(24).fill(0),
  ];
  const buckets = [
    p?.timelineToday    || [],
    p?.timelineYesterday || [],
    p?.timelinePrev      || [],
  ];
  for (let dayIdx = 0; dayIdx < 3; dayIdx++) {
    for (const e of buckets[dayIdx]) {
      const h = getLocalHour(e?.at, tzOffsetMin);
      if (h >= 0 && h < 24) grid[dayIdx][h]++;
    }
  }
  // Collapse to 24-vector for peak / quiet computation.
  let peakHour = -1, peakCount = 0;
  const collapsed = new Array(24).fill(0);
  for (let h = 0; h < 24; h++) {
    collapsed[h] = grid[0][h] + grid[1][h] + grid[2][h];
    if (collapsed[h] > peakCount) { peakCount = collapsed[h]; peakHour = h; }
  }
  const quietHours = [];
  for (let h = 0; h < 24; h++) {
    if (collapsed[h] <= 1) quietHours.push(h);
  }
  return { grid, peakHour, peakCount, quietHours };
}

/* ────────────────────────────────────────────────────────── */
/* Context switches — gap < 30 min между разными issue.key    */
/* ────────────────────────────────────────────────────────── */

/**
 * Returns { distinctIssueKeys, switchEvents[], switchScore }
 *   - switchEvents: только пары [a,b] где key(a) ≠ key(b) и gap < 30мин
 *   - switchScore:  switches/hour / 4, capped at 1.0 (4+/hour = 1.0)
 */
export function computeContextSwitches(p) {
  const events = [];
  const sources = [p?.timelineToday || [], p?.timelineYesterday || [], p?.timelinePrev || []];
  for (const arr of sources) {
    for (const e of arr) {
      const key = e?.issue?.key;
      const at  = e?.at;
      if (!key || !at) continue;
      const ms = new Date(at).getTime();
      if (isNaN(ms)) continue;
      events.push({ at: ms, key });
    }
  }
  events.sort((a, b) => a.at - b.at);

  const keys = new Set();
  const switches = [];
  for (let i = 0; i < events.length; i++) {
    keys.add(events[i].key);
    if (i === 0) continue;
    const a = events[i - 1];
    const b = events[i];
    if (a.key === b.key) continue;
    const gapSec = Math.floor((b.at - a.at) / 1000);
    if (gapSec < SWITCH_GAP_SEC) {
      switches.push({
        atIso:   new Date(b.at).toISOString(),
        fromKey: a.key,
        toKey:   b.key,
        gapSec,
      });
    }
  }

  const totalSpanMs = events.length > 1 ? events[events.length - 1].at - events[0].at : 0;
  const totalHours  = Math.max(1, totalSpanMs / 3600 / 1000);
  const switchScore = Math.min(1, switches.length / totalHours / SWITCHES_PER_HOUR_FOR_FULL_SCORE);

  return {
    distinctIssueKeys: keys.size,
    switchEvents: switches,
    switchScore,
  };
}

/* ────────────────────────────────────────────────────────── */
/* Timeline72h — merged DESC лента событий с dayOffset/hourBucket */
/* ────────────────────────────────────────────────────────── */

/**
 * Returns array of events с дополненными полями `src` (jira/bb/cf/zephyr),
 * `dayOffset` (0|1|2|null) и `hourBucket` (0..23). Sorted DESC by `at`.
 *
 * V18.1 P6.2 — расширено с jira-only до unified лента всех 4 источников:
 *  - jira:   timelineToday/Yesterday/Prev (events с issue + kind)
 *  - bb:     bbItems (PR/commit/review с repo/url/status)
 *  - cf:     cfItems (page edit/create/comment с title/spaceName)
 *  - zephyr: zephyrTestsCreatedRecent + zephyrTestsExecutedRecent
 *
 * Это закрывает gap «инфа о Confluence не показывается в events feed» —
 * до этого фикса P3 timeline72h был jira-only, и в detail-panel
 * Confluence-активность считалась в heatmap row C, но не отображалась.
 */
export function computeTimeline72h(p, tzOffsetMin) {
  const out = [];
  // Jira — из 3 day-buckets с dayOffset для совместимости с существующим UI.
  const tagJira = (events, dayOffset) => {
    for (const e of events) {
      if (!e?.at) continue;
      const d = new Date(e.at);
      if (isNaN(d.getTime())) continue;
      out.push({ ...e, src: 'jira', dayOffset, hourBucket: getLocalHour(e.at, tzOffsetMin) });
    }
  };
  tagJira(p?.timelineToday    || [], 0);
  tagJira(p?.timelineYesterday || [], 1);
  tagJira(p?.timelinePrev      || [], 2);

  // BB / CF / Zephyr — тегируем `src`, dayOffset вычисляем по at.
  const today00 = new Date(); today00.setHours(0, 0, 0, 0);
  const yest00  = new Date(today00); yest00.setDate(today00.getDate() - 1);
  const prev00  = new Date(today00); prev00.setDate(today00.getDate() - 2);
  const dayOffsetOf = (at) => {
    const t = new Date(at).getTime();
    if (isNaN(t)) return null;
    if (t >= today00.getTime()) return 0;
    if (t >= yest00.getTime())  return 1;
    if (t >= prev00.getTime())  return 2;
    return null;   // events older than 72h end up here, но они отфильтрованы 72h-окном на сервере
  };
  const tagOther = (items, src) => {
    for (const it of items) {
      if (!it?.at) continue;
      const d = new Date(it.at);
      if (isNaN(d.getTime())) continue;
      out.push({ ...it, src, dayOffset: dayOffsetOf(it.at), hourBucket: getLocalHour(it.at, tzOffsetMin) });
    }
  };
  tagOther(p?.bbItems                     || [], 'bb');
  tagOther(p?.cfItems                     || [], 'cf');
  tagOther(p?.zephyrTestsCreatedRecent    || [], 'zephyr');
  tagOther(p?.zephyrTestsExecutedRecent   || [], 'zephyr');

  out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return out;
}

/* ────────────────────────────────────────────────────────── */
/* Sprint Goal Progress (V18.1 P7-S2.1) — #1 в карте 7        */
/* сигналов synthesis-плана. Без этого PO не имеет ROI-метрики */
/* для defend'a у CTO.                                        */
/* ────────────────────────────────────────────────────────── */

// V20 S8.5 #2 — алиасы из METRIC_THRESHOLDS (config-driven).
const SPRINT_PACE_TOLERANCE_PCT = METRIC_THRESHOLDS.sprintPaceTolerancePct;

/**
 * Считает Sprint Goal Progress per active-sprint:
 *   { pk, name, startDate, endDate, daysLeft, daysTotal,
 *     total, done, progressPct, idealPct, pace }
 *
 * pace ∈ {'ahead', 'on-track', 'behind', 'no-data'}.
 *
 * - progressPct = done / total * 100
 * - idealPct    = elapsed/total of sprint duration
 * - 'ahead'   если progress >= ideal + 10%
 * - 'behind'  если progress <= ideal - 10%
 * - 'on-track' иначе
 * - 'no-data'  если sprint без startDate/endDate (ничего не считаем)
 *
 * Source: model.spaces[pk].sprintIssues + activeSprintName + activeSprintInfo.
 * Done detection — через isTerminalStatus.
 *
 * Without SP-fields fallback: count(done) / count(total) — приемлемо для
 * MVP, упоминается в open question §G.4 synthesis-плана.
 */
export function computeSprintGoal(model) {
  if (!model?.spaces) return { sprints: [], aggregateProgress: 0, aggregateDone: 0, aggregateTotal: 0, aggregatePace: 'no-data' };
  const now = Date.now();
  const sprints = [];
  for (const [pk, space] of Object.entries(model.spaces)) {
    if (!space?.activeSprintName) continue;
    const sprintIssues = space.sprintIssues || [];
    if (sprintIssues.length === 0) continue;

    const total = sprintIssues.length;
    const done  = sprintIssues.filter(it => isTerminalStatus(it.status || '', it.statusCat || '')).length;
    const progressPct = total > 0 ? Math.round((done / total) * 1000) / 10 : 0;

    const sInfo = space.activeSprintInfo || {};
    // Jira возвращает либо `startDate` / `endDate` (object), либо
    // `startDate` строкой при serialize'е sprint custom-field. Поддерживаем оба.
    const startDate = sInfo.startDate || sInfo.startDateLocal || null;
    const endDate   = sInfo.endDate   || sInfo.endDateLocal   || null;
    const startMs = startDate ? Date.parse(startDate) : NaN;
    const endMs   = endDate   ? Date.parse(endDate)   : NaN;

    let daysLeft = null, daysTotal = null, idealPct = null, pace = 'no-data';
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      daysTotal = Math.round((endMs - startMs) / 86400000);
      daysLeft  = Math.max(0, Math.round((endMs - now) / 86400000));
      const elapsed = endMs - now < 0 ? daysTotal : (daysTotal - daysLeft);
      idealPct = Math.round((elapsed / daysTotal) * 1000) / 10;
      if      (progressPct >= idealPct + SPRINT_PACE_TOLERANCE_PCT) pace = 'ahead';
      else if (progressPct <= idealPct - SPRINT_PACE_TOLERANCE_PCT) pace = 'behind';
      else                                                          pace = 'on-track';
    }

    // V20 S12 — расширенные данные для S1/S3/S4/S6:
    //   goal       — sprint goal narrative из Jira (S1)
    //   hygiene    — counts noAssignee/noPriority/oldUpdate (S6)
    //   midpoint   — (S3) на каком % спринта находимся, expected vs actual
    //   goalCritical — issues с label 'goal-critical' (PR-G S2)
    const goal = sInfo?.goal || sInfo?.description || '';
    const hygiene = {
      noAssignee:    sprintIssues.filter(it => !it.assignee).length,
      noPriority:    sprintIssues.filter(it => !it.priority || /none/i.test(it.priority)).length,
      noDescription: sprintIssues.filter(it => !it.description || it.description.length < 30).length,
    };
    const goalCriticalIssues = sprintIssues.filter(it =>
      Array.isArray(it.labels) && it.labels.some(l => /goal[-_]?critical/i.test(l))
    );
    const goalCriticalDone = goalCriticalIssues.filter(it =>
      isTerminalStatus(it.status || '', it.statusCat || '')
    ).length;
    sprints.push({
      pk,
      name: space.activeSprintName,
      startDate,
      endDate,
      daysLeft,
      daysTotal,
      total,
      done,
      progressPct,
      idealPct,
      pace,
      // V20 S12 PR-F — новые поля
      goal,
      hygiene,
      goalCritical: {
        total: goalCriticalIssues.length,
        done:  goalCriticalDone,
        progressPct: goalCriticalIssues.length > 0
          ? Math.round((goalCriticalDone / goalCriticalIssues.length) * 1000) / 10
          : null,
      },
      // sprintIssueKeys — для scope churn diff (S4) с historical snapshot.
      sprintIssueKeys: sprintIssues.map(it => it.key).filter(Boolean),
    });
  }
  const totalAll = sprints.reduce((s, sp) => s + sp.total, 0);
  const doneAll  = sprints.reduce((s, sp) => s + sp.done,  0);
  // V20 S6.2.1 — pace fallback по progress%. Pilot finding: 5 спринтов
  // без startDate/endDate → all 'no-data' → aggregate='no-data', даже если
  // progress=28.3% — т.е. явно behind. Вместо «no-data» используем простой
  // proxy: progress < 25 → behind, ≥ 75 → ahead, иначе on-track.
  // ВАЖНО: применяется ТОЛЬКО когда нет ни одного спринта с датами,
  // т.е. когда честный pace вычислить нельзя в принципе.
  let aggregatePace = 'no-data';
  if (sprints.length > 0) {
    if (sprints.some(s => s.pace === 'behind'))   aggregatePace = 'behind';
    else if (sprints.every(s => s.pace === 'ahead')) aggregatePace = 'ahead';
    else if (sprints.every(s => s.pace === 'no-data')) {
      // Fallback по progress, если ни один sprint не дал валидных дат.
      const aggProg = totalAll > 0 ? (doneAll / totalAll * 100) : 0;
      if      (aggProg <  25) aggregatePace = 'behind';
      else if (aggProg >= 75) aggregatePace = 'ahead';
      else                    aggregatePace = 'on-track';
    }
    else aggregatePace = 'on-track';
  }
  // V20 S6.2.1 — sprint-mean (sprint-weighted) рядом с issue-weighted.
  // Tech-expert finding: spring 200/10% полностью съедает sprint 20/90% при
  // Σ done/Σ total. Mean раскрывает асимметрию.
  const sprintMeanProgress = sprints.length > 0
    ? Math.round(sprints.reduce((s, sp) => s + sp.progressPct, 0) / sprints.length * 10) / 10
    : 0;
  return {
    sprints,
    aggregateProgress: totalAll > 0 ? Math.round(doneAll / totalAll * 1000) / 10 : 0,
    sprintMeanProgress,
    aggregateDone: doneAll,
    aggregateTotal: totalAll,
    aggregatePace,
    aggregatePaceSource: sprints.every(s => s.pace === 'no-data') && sprints.length > 0
      ? 'progress-fallback' : 'date-based',
  };
}

/* ────────────────────────────────────────────────────────── */
/* Risk summary — Orphans + Out-of-sprint (V18.1 P7-S2.1.5)   */
/* ────────────────────────────────────────────────────────── */

/**
 * Считает ключевые риск-сигналы для PO/SM из synthesis-плана:
 *   - Orphan-задачи (без assignee) per project key
 *   - Out-of-sprint Work — events на issues ВНЕ активного спринта,
 *     per participant + total
 *
 * Закрывает сигналы #6 (Out-of-sprint) и #7 (Orphan Risks) из synthesis
 * 7-сигналов плана.
 *
 * Returns:
 *   {
 *     orphansByPk: { [pk]: count },
 *     totalOrphans: number,
 *     outOfSprintByPerson: { [participantKey]: count },
 *     totalOutOfSprint: number,
 *     outOfSprintRatio: 0..1   // share of all events that are out-of-sprint
 *   }
 *
 * Также SET'ит `p.outOfSprintEvents` на каждого participant'а (для UI).
 */
export function computeRiskSummary(model) {
  if (!model) return { orphansByPk: {}, totalOrphans: 0, totalRealOrphans: 0, outOfSprintByPerson: {}, totalOutOfSprint: 0, outOfSprintRatio: 0 };
  // V20 S6.2.2 — Real Orphans фильтр.
  // Старый totalOrphans считал ВЕСЬ unassignedByPk (для pilot 5 PK с
  // sinceDate=2025-01-01 это 2513 issues — backlog). Не actionable.
  //
  // Real Orphans: только active-sprint OR обновлены за 30 дней OR priority высокий.
  // Это ~30-80 issues — те что реально требуют внимания.
  const orphansByPk = {};
  const realOrphansByPk = {};
  let totalOrphans = 0;
  let totalRealOrphans = 0;
  const FRESH_MS = METRIC_THRESHOLDS.orphanFreshMs;
  const nowMs = Date.now();
  // Sprint keys для проверки «в активном спринте».
  const sprintKeysSet = new Set();
  for (const space of Object.values(model.spaces || {})) {
    for (const it of (space?.sprintIssues || [])) {
      if (it?.key) sprintKeysSet.add(it.key);
    }
  }
  const isHighPriority = (p) => {
    const v = String(p || '').toLowerCase();
    return v === 'highest' || v === 'critical' || v === 'major' || v === 'high';
  };
  for (const [pk, list] of Object.entries(model.unassignedByPk || {})) {
    const arr = list || [];
    const n = arr.length;
    if (n > 0) orphansByPk[pk] = n;
    totalOrphans += n;
    // Real orphan = unassigned AND (in-sprint OR fresh AND high-priority).
    let real = 0;
    for (const it of arr) {
      const key = it?.key;
      const updatedMs = it?.updated ? Date.parse(it.updated) : NaN;
      const fresh = Number.isFinite(updatedMs) && (nowMs - updatedMs) <= FRESH_MS;
      const inSprint = key && sprintKeysSet.has(key);
      const highPri = isHighPriority(it?.priority);
      if (inSprint || (fresh && highPri)) real++;
    }
    if (real > 0) realOrphansByPk[pk] = real;
    totalRealOrphans += real;
  }
  // V20 S6.2.3 — outOfSprintRatio по unique issue keys, не events.
  // Старая формула: events-based — 10 коммитов в OOS-таск дают ratio 91%.
  // Новая: unique(OOS keys) / unique(all touched keys per person).
  const outOfSprintByPerson = {};
  let totalOutOfSprint = 0;
  // Для общего ratio: все unique keys vs OOS unique keys.
  const allTouched = new Set();
  const oosTouched = new Set();
  for (const p of (model.participants || [])) {
    const myKeys = new Set();
    const myOosKeys = new Set();
    const events = []
      .concat(p.timelineToday    || [])
      .concat(p.timelineYesterday || [])
      .concat(p.timelinePrev      || []);
    for (const e of events) {
      const key = e?.issue?.key;
      if (!key) continue;
      myKeys.add(key);
      allTouched.add(key);
      if (sprintKeysSet.size > 0 && !sprintKeysSet.has(key)) {
        myOosKeys.add(key);
        oosTouched.add(key);
      }
    }
    p.outOfSprintEvents = myOosKeys.size;     // backward-compat name, теперь = unique keys
    if (myOosKeys.size > 0) outOfSprintByPerson[p.key] = myOosKeys.size;
    totalOutOfSprint += myOosKeys.size;
  }
  return {
    orphansByPk,
    totalOrphans,
    realOrphansByPk,
    totalRealOrphans,
    outOfSprintByPerson,
    totalOutOfSprint,
    outOfSprintRatio: allTouched.size > 0 ? oosTouched.size / allTouched.size : 0,
    outOfSprintRatioBasis: 'unique-keys',     // S6.2.3 marker — отличить от старого events-based
  };
}

/* ────────────────────────────────────────────────────────── */
/* Heatmap 72×4 — 4 sources × 72 rolling hours (V18.1 P5)     */
/* ────────────────────────────────────────────────────────── */

/**
 * Returns:
 *   {
 *     grid: [J[72], B[72], C[72], Zc[72], Ze[72]],  // chronological: [0]=oldest, [71]=now-1h
 *     rowTotals: [j, b, c, zc, ze],
 *     colTotals: number[72],
 *     peakCell: { srcIdx, hourIndex, count } | null,
 *   }
 * Sources (V18.3 A2 — Zephyr split):
 *   0 = J  jira (timeline events: transition, comment, worklog, ...)
 *   1 = B  bitbucket (p.bbItems[])
 *   2 = C  confluence (p.cfItems[])
 *   3 = Zc zephyr-created  (p.zephyrTestsCreatedRecent — QA пишет план)
 *   4 = Ze zephyr-executed (p.zephyrTestsExecutedRecent — регрессия идёт)
 *
 * Bucketing — rolling 72-hour window от Date.now() назад. Каждый bucket =
 * 1 час. hourIndex 71 = последний завершённый час, hourIndex 0 = час 72ч
 * назад. События старше 72ч игнорируются.
 *
 * Field name `heatmap72x4` сохранён для backward compat (existing tests +
 * server employee-detail response shape). Семантически массив теперь
 * 5×72 — UI и тесты должны итерировать по `grid.length`, не hardcode'ить 4.
 */
export function computeHeatmap72x4(p, _tzOffsetMin) {
  // Note: heatmap72x4 строится через rolling 72-hour window (now backwards),
  // не через "hour-of-day", поэтому tzOffsetMin тут не нужен — `hoursAgo`
  // вычисляется через absolute timestamp diff. Принимаем параметр для
  // signature-симметрии с computeHeatmap.
  const grid = [
    new Array(72).fill(0),  // 0 = jira
    new Array(72).fill(0),  // 1 = bb
    new Array(72).fill(0),  // 2 = cf
    new Array(72).fill(0),  // 3 = zephyr-created (V18.3 A2)
    new Array(72).fill(0),  // 4 = zephyr-executed (V18.3 A2)
  ];
  const HOUR_MS = 3600 * 1000;
  const nowMs = Date.now();

  const drop = (srcIdx, atIso) => {
    if (!atIso) return;
    const ms = new Date(atIso).getTime();
    if (isNaN(ms)) return;
    const hoursAgo = Math.floor((nowMs - ms) / HOUR_MS);
    if (hoursAgo < 0 || hoursAgo >= 72) return;
    const idx = 71 - hoursAgo;   // 0=oldest, 71=newest
    grid[srcIdx][idx]++;
  };

  for (const arr of [p?.timelineToday || [], p?.timelineYesterday || [], p?.timelinePrev || []]) {
    for (const e of arr) drop(0, e?.at);
  }
  for (const it of (p?.bbItems || [])) drop(1, it?.at);
  for (const it of (p?.cfItems || [])) drop(2, it?.at);
  // V18.3 A2 — Zephyr split: created → row 3, executed → row 4.
  // Pilot finding (Ilia QA): «create = QA пишет план, execute = регрессия
  // идёт. Семантически разное».
  for (const it of (p?.zephyrTestsCreatedRecent  || [])) drop(3, it?.at);
  for (const it of (p?.zephyrTestsExecutedRecent || [])) drop(4, it?.at);

  const rowTotals = grid.map(row => row.reduce((s, n) => s + n, 0));
  const colTotals = new Array(72).fill(0);
  for (let h = 0; h < 72; h++) {
    for (let s = 0; s < grid.length; s++) colTotals[h] += grid[s][h];
  }
  let peakCell = null;
  for (let s = 0; s < grid.length; s++) {
    for (let h = 0; h < 72; h++) {
      if (grid[s][h] > 0 && (!peakCell || grid[s][h] > peakCell.count)) {
        peakCell = { srcIdx: s, hourIndex: h, count: grid[s][h] };
      }
    }
  }
  return { grid, rowTotals, colTotals, peakCell };
}

/**
 * 72-длинный массив events/hour (sum across sources). Для UI sparkline.
 * Reuses heatmap72x4.colTotals если уже посчитан, иначе пересчитывает.
 */
export function computeSparkline72h(p) {
  // Если P5 enrichment уже посчитал heatmap72x4 — переиспользуем colTotals.
  // Иначе считаем напрямую (cheap).
  if (p?.heatmap72x4?.colTotals) return p.heatmap72x4.colTotals.slice();
  const HOUR_MS = 3600 * 1000;
  const nowMs = Date.now();
  const out = new Array(72).fill(0);
  const drop = (atIso) => {
    if (!atIso) return;
    const ms = new Date(atIso).getTime();
    if (isNaN(ms)) return;
    const hoursAgo = Math.floor((nowMs - ms) / HOUR_MS);
    if (hoursAgo < 0 || hoursAgo >= 72) return;
    out[71 - hoursAgo]++;
  };
  for (const arr of [p?.timelineToday || [], p?.timelineYesterday || [], p?.timelinePrev || []]) {
    for (const e of arr) drop(e?.at);
  }
  for (const it of (p?.bbItems || []))                      drop(it?.at);
  for (const it of (p?.cfItems || []))                      drop(it?.at);
  for (const it of (p?.zephyrTestsCreatedRecent  || []))    drop(it?.at);
  for (const it of (p?.zephyrTestsExecutedRecent || []))    drop(it?.at);
  return out;
}

/* ────────────────────────────────────────────────────────── */
/* Blockers — issues с dwell-time > threshold в текущем статусе */
/* ────────────────────────────────────────────────────────── */

/**
 * Build index { jiraAccountId | email → [{issue, statusName, statusCat,
 * lastStatusChangeIso}] }. Walks rawReports, не делает ничего else.
 */
export function buildAssigneeIndex(rawReports) {
  const m = new Map();
  if (!rawReports?.reports) return m;
  for (const rep of rawReports.reports) {
    for (const issue of (rep.issues || [])) {
      const a = issue?.fields?.assignee;
      if (!a) continue;
      const ak = String(a.accountId || a.key || a.name || '').trim();
      const ae = String(a.emailAddress || a.email || '').toLowerCase().trim();
      const meta = {
        issue,
        statusName: issue?.fields?.status?.name || '',
        statusCat:  issue?.fields?.status?.statusCategory?.key || '',
        lastStatusChangeIso: findLastStatusChange(issue),
      };
      if (ak) {
        const arr = m.get(ak) || [];
        arr.push(meta);
        m.set(ak, arr);
      }
      if (ae) {
        const arr = m.get(ae) || [];
        arr.push(meta);
        m.set(ae, arr);
      }
    }
  }
  return m;
}

/** Latest changelog history with field=status item; fallback issue.created. */
export function findLastStatusChange(issue) {
  const histories = issue?.changelog?.histories || [];
  let lastIso = '';
  for (const h of histories) {
    const items = Array.isArray(h.items) ? h.items : [];
    let hasStatus = false;
    for (const it of items) {
      if (it?.field === 'status') { hasStatus = true; break; }
    }
    if (hasStatus && h.created && (!lastIso || h.created > lastIso)) {
      lastIso = h.created;
    }
  }
  if (!lastIso) lastIso = issue?.fields?.created || '';
  return lastIso;
}

/**
 * Returns array of blocker objects:
 *   { key, summary, status, sinceIso, dwellHours, thresholdHours, pk }
 * Sorted by dwellHours DESC.
 *
 * V18.1 P7-S2.2 — `thresholds` map (DEFAULT_DWELL_THRESHOLDS).
 * V18.3 A1 — опциональный 4-й параметр teamThresholds: Map<pk, threshold-map>.
 * Если issue's pk имеет custom thresholds → используются они, иначе global.
 */
export function computeBlockers(p, assigneeIndex, thresholds, teamThresholds = {}) {
  if (!assigneeIndex || !p) return [];
  // Accept either map (P7+) or scalar number (legacy P3-P6).
  const globalMap = (typeof thresholds === 'number')
    ? { ...DEFAULT_DWELL_THRESHOLDS, default: thresholds }
    : (thresholds || DEFAULT_DWELL_THRESHOLDS);
  const now = Date.now();
  const candidates = []
    .concat(assigneeIndex.get(p.jiraAccountId) || [])
    .concat(assigneeIndex.get(p.email) || []);
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const key = c?.issue?.key;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (isTerminalStatus(c.statusName, c.statusCat)) continue;
    if (!c.lastStatusChangeIso) continue;
    const since = new Date(c.lastStatusChangeIso).getTime();
    if (isNaN(since)) continue;
    const dwellMsActual = now - since;
    // V18.3 A1 — pk lookup для per-team threshold override.
    // pk извлекается из issue.key prefix (X-1234 → X) или явно из field.
    const pk = c?.issue?.fields?.project?.key
            || (key.split('-')[0] || '');
    const tmap = (pk && teamThresholds[pk]) ? teamThresholds[pk] : globalMap;
    const thresholdHours = pickDwellThreshold(c.statusName, tmap);
    const dwellMs = thresholdHours * 3600 * 1000;
    if (dwellMsActual < dwellMs) continue;
    out.push({
      key,
      pk,                        // V18.3 A1 — для UI «BACKEND CR > 8ч»
      summary:    c.issue?.fields?.summary || '',
      status:     c.statusName,
      sinceIso:   c.lastStatusChangeIso,
      dwellHours: Math.round(dwellMsActual / 3600 / 1000),
      thresholdHours,
      // 2026-06-01 — extras для AI-ассистента: due date, оценка, потраченное.
      duedate:    c.issue?.fields?.duedate || '',
      priority:   c.issue?.fields?.priority?.name || '',
      labels:     Array.isArray(c.issue?.fields?.labels) ? c.issue.fields.labels : [],
      originalEstimateSeconds:
        Number(c.issue?.fields?.timetracking?.originalEstimateSeconds)
        || Number(c.issue?.fields?.timeoriginalestimate)
        || 0,
      timeSpentSeconds:
        Number(c.issue?.fields?.timetracking?.timeSpentSeconds)
        || Number(c.issue?.fields?.aggregatetimespent)
        || 0,
    });
  }
  out.sort((a, b) => b.dwellHours - a.dwellHours);
  return out;
}

/* ══════════════════════════════════════════════════════════
   V20 S6.3 — NEW METRICS
   ══════════════════════════════════════════════════════════ */

/**
 * V20 S6.3.1 — Code Review Velocity per reviewer.
 *
 * Считает median time-to-first-review для каждого ревьюера за 14 дней.
 * Сигнализирует bottleneck'и: «весь Backend ждёт ревью от Андрея».
 *
 * Источник: p.bbItems с kind='review' (приходит от ppFetchBitbucketActivity
 * вместе с .at и .prId). По каждому review-event ищем opened-event того же
 * PR в общем bbItems pool (cross-participant) — если найден,
 * delta = review.at - openedAt.
 *
 * Threshold для UI: median > 24h = красный, 8-24h = жёлтый, <8h = зелёный.
 *
 * @returns Map<reviewerKey, { medianHours, count, threshold }>
 */
export function computeCodeReviewVelocity(model) {
  if (!model || !Array.isArray(model.participants)) return {};
  // Step 1: build prId → openedAt map by scanning all bbItems for kind='pr'.
  const prOpenedAt = new Map();
  for (const p of model.participants) {
    for (const it of (p.bbItems || [])) {
      if (it.kind !== 'pr' || !it.prId) continue;
      const ts = Date.parse(it.at || '');
      if (Number.isFinite(ts)) {
        // PR может попадаться у автора и у ревьюера — берём самый ранний.
        const cur = prOpenedAt.get(it.prId);
        if (cur == null || ts < cur) prOpenedAt.set(it.prId, ts);
      }
    }
  }
  // Step 2: для каждого review-event считаем delta до opened.
  const byReviewer = {};      // key → array of hours
  for (const p of model.participants) {
    for (const it of (p.bbItems || [])) {
      if (it.kind !== 'review' || !it.prId) continue;
      const reviewTs = Date.parse(it.at || '');
      const openedTs = prOpenedAt.get(it.prId);
      if (!Number.isFinite(reviewTs) || !Number.isFinite(openedTs)) continue;
      const deltaH = (reviewTs - openedTs) / 3600000;
      if (deltaH < 0 || deltaH > METRIC_THRESHOLDS.crvOutlierMaxHours) continue;     // бракуем outliers > 14 дней
      if (!byReviewer[p.key]) byReviewer[p.key] = [];
      byReviewer[p.key].push(deltaH);
    }
  }
  // Step 3: median per reviewer.
  const out = {};
  for (const [k, arr] of Object.entries(byReviewer)) {
    arr.sort((a, b) => a - b);
    const median = arr[Math.floor(arr.length / 2)];
    out[k] = {
      medianHours: Math.round(median * 10) / 10,
      count:       arr.length,
      threshold:   median > METRIC_THRESHOLDS.crvSlowHours ? 'slow' : median > METRIC_THRESHOLDS.crvWarnHours ? 'warn' : 'ok',
    };
  }
  return out;
}

/**
 * V20 S6.3.1 — PR throughput per author за 7 дней.
 *
 * Аномалия: opened > 5 ∧ mergeRate < 0.4 = «тонет в правках» / ревьюеры
 * не пускают.
 *
 * Источник: p.bbItems с kind='pr' и status (OPEN / MERGED / DECLINED).
 * За 7 дней — просто фильтр по at.
 *
 * @returns Map<authorKey, { opened, merged, declined, mergeRate, flag }>
 */
export function computePrThroughput(model) {
  if (!model || !Array.isArray(model.participants)) return {};
  const cutoff = Date.now() - METRIC_THRESHOLDS.prThroughputDays * 86400 * 1000;
  const out = {};
  for (const p of model.participants) {
    let opened = 0, merged = 0, declined = 0;
    for (const it of (p.bbItems || [])) {
      if (it.kind !== 'pr') continue;
      const ts = Date.parse(it.at || '');
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      const st = String(it.status || '').toUpperCase();
      opened++;
      if (st === 'MERGED')        merged++;
      else if (st === 'DECLINED') declined++;
    }
    if (!opened) continue;
    const mergeRate = merged / opened;
    out[p.key] = {
      opened, merged, declined,
      mergeRate: Math.round(mergeRate * 100) / 100,
      flag:
        opened > METRIC_THRESHOLDS.prOverloadOpenedThreshold && mergeRate < METRIC_THRESHOLDS.prOverloadRateThreshold ? 'overload' :
        mergeRate >= METRIC_THRESHOLDS.prHealthyRateThreshold ? 'healthy' :
        mergeRate >= 0.4              ? 'slow'    :
                                         'stalled',
    };
  }
  return out;
}

/**
 * V20 S6.3.4 — Cross-team dependencies.
 *
 * Detect: сколько PR/коммитов сделано в репозиторий ВНЕ команды автора.
 * `repo` поле содержит "<projectKey>/<repoSlug>"; берём префикс до '/'.
 * Сравниваем с p.projects (Jira PK) — если bb pk не пересекается → cross-team.
 *
 * Метрика per-team: crossTeamPRs / totalPRs.
 *
 * @returns Map<personKey, { crossTeamPRs, totalPRs, ratio }>
 */
export function computeCrossTeamDependencies(model) {
  if (!model || !Array.isArray(model.participants)) return {};
  const out = {};
  for (const p of model.participants) {
    const myPks = new Set([...(p.projects || [])].map(s => String(s).toUpperCase()));
    let cross = 0, total = 0;
    for (const it of (p.bbItems || [])) {
      if (it.kind !== 'pr') continue;
      total++;
      const repoPk = String(it.repo || '').split('/')[0].toUpperCase();
      if (!repoPk) continue;
      // Сравниваем "BB pk" с Jira pks. В Сбере `bbProjectKeys` (SBOFPL,
      // SBOF_UFS) часто отличаются от Jira pks (SBOFPLCORE, SMECM ...) —
      // тут heuristic: если ЛЮБОЙ префикс матчит — это same-team.
      let matched = false;
      for (const pk of myPks) {
        if (repoPk.startsWith(pk) || pk.startsWith(repoPk)) { matched = true; break; }
      }
      if (!matched) cross++;
    }
    if (!total) continue;
    out[p.key] = { crossTeamPRs: cross, totalPRs: total, ratio: Math.round((cross / total) * 100) / 100 };
  }
  return out;
}

/**
 * V20 S6.3.3 — Sprint Goal slope detection.
 *
 * Линейная регрессия y=ax+b на массиве дневных snapshots `aggregateProgress`
 * за последние 14 дней. Возвращает `slope` (% per day), `r2` (goodness),
 * intercept. Используется для UI «прогресс ↗ +3.2%/день» / «↘ −0.5% — стагнация».
 *
 * @param history массив snapshots { ts, sprintGoal: { aggregateProgress } }
 *               (формат `loadHistory(...)` из teamScanner2History.js)
 */
export function computeSprintGoalSlope(history) {
  if (!Array.isArray(history) || history.length < 3) {
    return { slope: 0, r2: 0, days: history?.length || 0, trend: 'no-data' };
  }
  const cutoff = Date.now() - 14 * 86400 * 1000;
  const points = history
    .filter(h => h.ts >= cutoff && Number.isFinite(h.sprintGoal?.aggregateProgress))
    .map(h => [h.ts / 86400000, h.sprintGoal.aggregateProgress]);
  if (points.length < 3) return { slope: 0, r2: 0, days: points.length, trend: 'no-data' };
  // OLS.
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p[0], 0) / n;
  const meanY = points.reduce((s, p) => s + p[1], 0) / n;
  let num = 0, den = 0, ssTot = 0;
  for (const [x, y] of points) {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
    ssTot += (y - meanY) ** 2;
  }
  const slope = den !== 0 ? num / den : 0;
  // R²
  const intercept = meanY - slope * meanX;
  let ssRes = 0;
  for (const [x, y] of points) {
    const yPred = slope * x + intercept;
    ssRes += (y - yPred) ** 2;
  }
  const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
  // Classify.
  const trend =
    Math.abs(slope) < 0.5 ? 'flat' :
    slope > 0             ? 'up'   :
                             'down';
  return {
    slope: Math.round(slope * 100) / 100,
    r2:    Math.round(r2 * 100) / 100,
    days:  n,
    trend,
  };
}

/**
 * V20 S6.3.2 — Z-score anomaly detection per metric.
 *
 * Для history-серии (массив чисел) считает текущий Z-score = (today - μ) / σ
 * по предыдущим N-1 точкам. |z| > 2 = anomaly.
 *
 * @param series массив значений (ASC по времени, today — последнее)
 * @returns { mean, std, today, z, anomalous }
 */
export function computeZScore(series) {
  if (!Array.isArray(series) || series.length < 4) {
    return { mean: 0, std: 0, today: 0, z: 0, anomalous: false, confidence: 'none' };
  }
  const today = series[series.length - 1];
  const past = series.slice(0, -1);
  const mean = past.reduce((s, x) => s + x, 0) / past.length;
  const variance = past.reduce((s, x) => s + (x - mean) ** 2, 0) / past.length;
  const std = Math.sqrt(variance);
  const z = std > 0 ? (today - mean) / std : 0;
  // 2026-06-02 audit fix #8 — threshold-калибровка под короткую историю.
  // На проде diag z=1.98 при threshold=2 — реальный +24 stop за ночь
  // пропущен. С 4-7 точками std нестабилен, поэтому threshold смягчаем
  // до 1.5σ для «pre-warning». С ≥8 точками — классические 2σ.
  // confidence: high (≥8 pts), medium (5-7 pts), low (4 pts).
  const n = series.length;
  let threshold = 2;
  let confidence = 'high';
  if (n < 8) {
    threshold = 1.5;
    confidence = n >= 6 ? 'medium' : 'low';
  }
  return {
    mean: Math.round(mean * 100) / 100,
    std:  Math.round(std * 100) / 100,
    today,
    z:    Math.round(z * 100) / 100,
    anomalous: Math.abs(z) > threshold,
    threshold,
    confidence,
  };
}

/**
 * V20 S6.3.2 — Exponential Moving Average (EMA) + Week-over-Week delta.
 *
 * EMA устойчивее к day-of-week шуму чем простое среднее. α=0.3 — рекомендация
 * tech-expert'а (хороший баланс «реагирует быстро / не дёргается»).
 *
 * Возвращает: emaToday, emaLastWeek (7d ago), wowDelta = ema(today) - ema(today-7d).
 *
 * @param series ASC-ordered массив daily values (today последнее)
 * @param alpha EMA smoothing factor (default 0.3)
 */
export function computeEmaWoW(series, alpha = 0.3) {
  // V21 trends-guard fix (diagnostic 2026-05-07: history.entries=3 →
  // emaLastWeek=0, wowDelta=48 — выглядело как «было 0 → стало 48», враньё).
  // 2026-05-11 — emaLastWeek/wowDelta = 0 при insufficient history (раньше null).
  // Причина: тесты и downstream-логика ожидают численные значения.
  // Renderer проверяет флаг `insufficientHistory` для показа '—' вместо
  // ложных дельт (см. teamScanner2Renderer.js:5582-5583).
  // 2026-06-02 audit fix #8 — cutoff снижен с 8 до 5 для команд только
  // ставящих Scanner. На проде diag history=4 → insufficientHistory:true
  // отключал WoW для всех. Теперь от 5 точек уже считаем тренд (без WoW,
  // wow требует 8+), и явный confidence для UI.
  const nPts = Array.isArray(series) ? series.length : 0;
  if (nPts < 5) {
    return {
      emaToday: series?.[series.length - 1] ?? 0,
      emaLastWeek: 0,
      wowDelta: 0,
      insufficientHistory: true,
      confidence: 'none',
      pointsAvailable: nPts,
    };
  }
  if (nPts < 8) {
    // Считаем EMA для тренда, но WoW не доступен — confidence: low.
    const emaShort = [];
    emaShort[0] = series[0];
    for (let i = 1; i < series.length; i++) {
      emaShort[i] = alpha * series[i] + (1 - alpha) * emaShort[i - 1];
    }
    const emaTodayShort = Math.round(emaShort[emaShort.length - 1] * 100) / 100;
    return {
      emaToday: emaTodayShort,
      emaLastWeek: 0,
      wowDelta: 0,
      insufficientHistory: true,   // оставляем флаг для существующих UI-проверок
      confidence: 'low',
      pointsAvailable: nPts,
    };
  }
  const ema = [];
  ema[0] = series[0];
  for (let i = 1; i < series.length; i++) {
    ema[i] = alpha * series[i] + (1 - alpha) * ema[i - 1];
  }
  const emaToday = ema[ema.length - 1];
  const emaLastWeek = ema[ema.length - 8];
  return {
    emaToday: Math.round(emaToday * 10) / 10,
    emaLastWeek: Math.round(emaLastWeek * 10) / 10,
    wowDelta: Math.round((emaToday - emaLastWeek) * 10) / 10,
  };
}
