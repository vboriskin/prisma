'use strict';
/* ============================================================
   AUTO-SUMMARY — AUDIT_HOLISTIC AI3
   ------------------------------------------------------------
   Создаёт ОДНУ short-фразу-summary для длинных списков:
     · Action queue (top-5 ranked observations)
     · Sleeping Data tiles (set of inactive metric tiles)
     · Hygiene violations (rule-engine output)
     · History filtered (filtered history list)

   Дизайн:
     1) Rule-based extract — детерминированный (тесты быстрые,
        нет внешних вызовов). Этого достаточно для default-output.
     2) LLM-ретушь — опционально через ai/llmClient.js#callLLM.
        Включается только если state.llm.useAutoSummary !== false
        и `callLLM` доступна. Кешируется.

   API:
     AutoSummary.summarize(kind, items, opts?)         → string (sync)
     AutoSummary.summarizeAsync(kind, items, opts?)    → Promise<string>
       где opts = { useLLM?: boolean, llm?: callLLMRef }

   Cache:
     · Memo по `kind + JSON.stringify(items.slice(0, 50))`
     · TTL 60 секунд
     · Не персистится (RAM only) — identity-deterministic запуска
       per-session, но не cross-session (контракт #2 не затрагиваем,
       summary это derived data)

   Контракты (см. CLAUDE.md):
     · Никаких Storage.save() — это presentation layer.
     · Identity-deterministic — rule-based extract принципиально
       одинаков для одного и того же ввода.
     · Без эмодзи в output фраз.
   ============================================================ */

import { Services } from '../app/services.js';

const TTL_MS = 60 * 1000;
const _cache = new Map(); // key → { value: string, expires: number }

function _cacheKey(kind, items) {
  // .slice(0, 50) — защита от перерасхода JSON.stringify на длинных
  // списках. Для action-queue / sleeping-data / hygiene 50 — заведомо
  // больше реалистичного размера (queue.length ≤ 12, sleeping ≤ 30).
  let body;
  try { body = JSON.stringify(Array.isArray(items) ? items.slice(0, 50) : items); }
  catch (_) { body = String(items?.length || 0); }
  return `${kind}::${body}`;
}

function _getCached(key) {
  const hit = _cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) { _cache.delete(key); return null; }
  return hit.value;
}

function _setCached(key, value) {
  _cache.set(key, { value, expires: Date.now() + TTL_MS });
  // Soft cap чтобы не утекало (max 64 ключа). FIFO eviction.
  if (_cache.size > 64) {
    const firstKey = _cache.keys().next().value;
    if (firstKey) _cache.delete(firstKey);
  }
}

const plural = (n, forms) => {
  // forms: [one, few, many] — например ['нарушение','нарушения','нарушений']
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5)   return forms[1];
  if (b === 1)          return forms[0];
  return forms[2];
};

/* ──────────────────────────────────────────────────────────────
   Rule-based summarizers per kind.
   ────────────────────────────────────────────────────────────── */

function _summarizeActionQueue(items) {
  if (!items || !items.length) return 'Очередь действий пуста — ритм в курсе.';
  const n = items.length;
  // q.severity ∈ {'high','medium','low'} (см. teamScanner2Insights#buildActionQueue);
  // если поле отсутствует, считаем medium.
  const high = items.filter(q => (q.severity || 'medium') === 'high').length;
  const top = items[0]?.label || '';
  const word = plural(n, ['действие','действия','действий']);
  if (high > 0 && top) {
    const hWord = plural(high, ['срочное','срочных','срочных']);
    return `${n} ${word} в очереди, ${high} ${hWord}; первым — ${top}.`;
  }
  if (top) return `${n} ${word} в очереди; первым — ${top}.`;
  return `${n} ${word} в очереди.`;
}

function _summarizeSleepingData(items) {
  if (!items || !items.length) return 'Спящих метрик нет — все источники свежие.';
  const n = items.length;
  // tile.staleDays / tile.lastUpdate — допустимые форматы; падаем мягко.
  const stale7 = items.filter(t => Number(t.staleDays) >= 7).length;
  const sources = new Set();
  items.forEach(t => { if (t.source) sources.add(String(t.source)); });
  const word = plural(n, ['метрика','метрики','метрик']);
  const head = `${n} спящих ${word}`;
  if (stale7 && sources.size) {
    return `${head}, ${stale7} >7 дней; источники: ${[...sources].slice(0,3).join(', ')}.`;
  }
  if (stale7) return `${head}, ${stale7} >7 дней.`;
  if (sources.size) return `${head}; источники: ${[...sources].slice(0,3).join(', ')}.`;
  return `${head}.`;
}

function _summarizeHygieneViolations(items) {
  if (!items || !items.length) return 'Нарушений гигиены не найдено — данные чисты.';
  const n = items.length;
  // v.kind / v.epic / v.assignee / v.ruleId
  const noAssignee = items.filter(v =>
    v.kind === 'no_assignee' || (v.assignee == null || v.assignee === '')
  ).length;
  const epics = new Set();
  items.forEach(v => { if (v.epic) epics.add(String(v.epic)); });
  const word = plural(n, ['нарушение','нарушения','нарушений']);
  if (noAssignee > 0 && epics.size > 0) {
    const eWord = plural(epics.size, ['эпик','эпика','эпиков']);
    return `${n} ${word} → ${noAssignee} без assignee, затронуто ${epics.size} ${eWord}.`;
  }
  if (noAssignee > 0) return `${n} ${word} → ${noAssignee} без assignee.`;
  if (epics.size > 0) {
    const eWord = plural(epics.size, ['эпик','эпика','эпиков']);
    return `${n} ${word}, затронуто ${epics.size} ${eWord}.`;
  }
  return `${n} ${word}.`;
}

function _summarizeHistoryFiltered(items) {
  if (!items || !items.length) return 'История по выбранному фильтру пуста.';
  const n = items.length;
  // entry.kind / entry.user / entry.at (timestamp)
  const users = new Set();
  items.forEach(e => { if (e.user) users.add(String(e.user)); });
  const ts = items
    .map(e => Number(e.at || e.timestamp || 0))
    .filter(t => Number.isFinite(t) && t > 0);
  const word = plural(n, ['запись','записи','записей']);
  if (users.size > 0 && ts.length >= 2) {
    const span = Math.max(...ts) - Math.min(...ts);
    const days = Math.max(1, Math.round(span / (24 * 3600 * 1000)));
    const dWord = plural(days, ['день','дня','дней']);
    return `${n} ${word} за ${days} ${dWord}, ${users.size} участн${users.size === 1 ? 'ик' : 'иков'}.`;
  }
  if (users.size > 0) {
    return `${n} ${word}, ${users.size} участн${users.size === 1 ? 'ик' : 'иков'}.`;
  }
  return `${n} ${word}.`;
}

const _RULE_SUMMARIZERS = {
  'action-queue':        _summarizeActionQueue,
  'sleeping-data':       _summarizeSleepingData,
  'hygiene-violations':  _summarizeHygieneViolations,
  'history-filtered':    _summarizeHistoryFiltered,
};

/* ──────────────────────────────────────────────────────────────
   Public API
   ────────────────────────────────────────────────────────────── */

/**
 * Synchronous rule-based summary.
 * @param {'action-queue'|'sleeping-data'|'hygiene-violations'|'history-filtered'} kind
 * @param {Array} items
 * @returns {string}
 */
function summarize(kind, items) {
  const fn = _RULE_SUMMARIZERS[kind];
  if (!fn) return '';
  const key = _cacheKey(kind, items);
  const hit = _getCached(key);
  if (hit) return hit;
  let value;
  try { value = fn(items) || ''; }
  catch (_) { value = ''; }
  _setCached(key, value);
  return value;
}

/**
 * Optionally LLM-augmented summary. Returns rule-based result immediately
 * if LLM is not enabled / not available; awaits LLM only when explicitly
 * requested AND state.llm.useAutoSummary !== false.
 *
 * @param {string} kind
 * @param {Array}  items
 * @param {{ useLLM?: boolean, llm?: Function, stateRef?: object }} [opts]
 * @returns {Promise<string>}
 */
async function summarizeAsync(kind, items, opts = {}) {
  const ruleText = summarize(kind, items);
  const { useLLM, llm, stateRef } = opts;
  if (!useLLM || typeof llm !== 'function') return ruleText;
  // Guard: state.llm.useAutoSummary === false → отключено пользователем.
  // stateRef передаётся явно чтобы модуль был тестируем без window.state.
  const flag = stateRef?.llm?.useAutoSummary;
  if (flag === false) return ruleText;

  try {
    const text = await llm({
      system: 'Ты помощник тимлида. Перепиши короткую фразу о списке в максимум 1-2 предложения. Сохрани числа и имена. Без эмодзи.',
      user:   `Перепиши короче, сохрани суть и приоритет:\n\n${ruleText}`,
      maxTokens: 90,
      temperature: 0.2,
    });
    if (typeof text === 'string' && text.trim()) {
      // Снимаем wrapping-кавычки и хвостовые `»` перед/после знака препинания.
      const stripped = text
        .trim()
        .replace(/^["'«»]+|["'«»]+$/g, '')
        .replace(/[«»](?=[.,;:!?])/g, '')
        .replace(/(?<=[.,;:!?])[«»]/g, '');
      // Cache LLM-вариант под отдельным ключом — иначе rule-cache затрётся.
      _setCached(_cacheKey('llm:' + kind, items), stripped);
      return stripped;
    }
  } catch (_) { /* network/timeout — fall through to ruleText */ }
  return ruleText;
}

/**
 * Очистка кеша (тесты, теме-switch, явный refresh пользователем).
 */
function clearCache() { _cache.clear(); }

export const AutoSummary = {
  summarize,
  summarizeAsync,
  clearCache,
  // Exposed для тестов и для phase-2 интеграции:
  _internal: { _cacheKey, _RULE_SUMMARIZERS },
};

Services.register('AutoSummary', AutoSummary);
if (typeof window !== 'undefined') {
  window.AutoSummary = AutoSummary;
}

export default AutoSummary;
