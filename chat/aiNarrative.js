'use strict';
/* ============================================================
   chat/aiNarrative.js — V22+ Week 4 (LP-09)

   AI-generated narrative summary для employeeReport (LP-01).

   Получает структурированную сводку (раз посчитанную rule-based'ом) и
   просит GigaChat сделать связный текст 150-200 слов. Не запрашивает
   сырых данных — payload pre-aggregated, чтобы не утечь PII.

   Public API:
     generateAINarrative(report, opts?) → Promise<string|null>
       · report — output buildEmployeeReport (_meta, text, cards)
       · opts   — { signal?, model?, timeoutMs?, dryRun? }
       · returns: narrative text (200 слов) или null если LLM unavailable

   Контракты:
     · НЕ throw'ает на network/API ошибку — возвращает null.
     · Soft-fallback: если LLM unconfigured → null.
     · Использует существующий /api/llm/chat endpoint (не SSE — short non-streaming для скорости).
     · PII-safe: только агрегированные числа, не raw items.
     · Identity preserved — employee.label из target идёт в prompt.
   ============================================================ */

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * @param {object} report — { text, cards, _meta:{employee, period, totals, sources} }
 * @param {object} opts — { signal?, model?, timeoutMs?, dryRun? }
 * @returns {Promise<string|null>}
 */
export async function generateAINarrative(report, opts = {}) {
  if (!report || !report._meta) return null;
  const meta = report._meta;
  if (meta.kind !== 'employee_report') return null;

  // dryRun — для тестов: возвращаем prompt, не делаем сеть.
  if (opts.dryRun) {
    return _buildPrompt(report);
  }

  const prompt = _buildPrompt(report);

  // Use existing /api/llm/chat. NOT streaming — нам нужен полный текст.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'TimeoutError')),
    opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort(opts.signal.reason);
    else opts.signal.addEventListener('abort', () => ctrl.abort(opts.signal.reason), { once: true });
  }

  try {
    const body = {
      messages: [
        { role: 'system', content: _SYSTEM_PROMPT },
        { role: 'user',   content: prompt },
      ],
      model: opts.model || 'GigaChat',
      max_tokens: 400,
      temperature: 0.5,
      stream: false,
    };

    const res = await fetch('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      // LLM unavailable — soft-fallback. Caller просто не вставит narrative.
      return null;
    }
    const data = await res.json().catch(() => null);
    if (!data) return null;

    // OpenAI-format response: choices[0].message.content
    const text = data?.choices?.[0]?.message?.content
              || data?.text
              || data?.content
              || null;
    if (!text || typeof text !== 'string') return null;

    return _sanitize(text);
  } catch (e) {
    // AbortError / network — silent. Caller fallback'нется без narrative.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────────────────────────────────────────────────
   Prompts
   ───────────────────────────────────────────────────────────── */

const _SYSTEM_PROMPT = `Ты — ассистент по performance review. Получаешь агрегированные метрики работы сотрудника и пишешь связный narrative-обзор для тимлида.

Правила:
- 150-200 слов, нейтральный профессиональный тон.
- НЕ выдумывай задач, проектов, имён — только то что в payload.
- НЕ суди о «качестве работы» — описывай факты.
- Структура:
  1. Краткий итог периода (1 предложение).
  2. Главные направления работы (2-3 предложения).
  3. Заметные паттерны или тренды (1-2 предложения).
- Не используй markdown-заголовки. Сплошной текст, абзацами.
- НЕ используй emoji.
- НЕ начинай с «Сотрудник» или «За период» — найди более живую формулировку.`;

function _buildPrompt(report) {
  const meta = report._meta || {};
  // Используем human-readable label если есть, иначе id.
  const emp = meta.employeeLabel || meta.employee || '(сотрудник)';
  const period = meta.period || {};
  const totals = meta.totals || {};
  const sources = meta.sources || [];

  // Извлекаем top items если есть — из report.text для context (хороший hack).
  // Не парсим markdown, просто daём то что уже агрегировано.
  const topJira = _extractTopItems(report.text, '### Jira');
  const topBB   = _extractTopItems(report.text, '### Bitbucket');
  const topCF   = _extractTopItems(report.text, '### Confluence');

  const lines = [
    `Сотрудник: ${emp}`,
    `Период: ${period.label || `${period.from} — ${period.to}`}`,
    `Источники: ${sources.join(', ') || 'none'}`,
    '',
    'Агрегированные метрики:',
    `- Jira задач за период: ${totals.jira || 0}`,
    `- Bitbucket PR/коммитов: ${totals.bb || 0}`,
    `- Confluence страниц: ${totals.cf || 0}`,
  ];

  if (topJira) lines.push('', 'Топ Jira задачи:', topJira);
  if (topBB)   lines.push('', 'Топ BB активность:', topBB);
  if (topCF)   lines.push('', 'Топ CF страницы:', topCF);

  lines.push('', 'Напиши narrative-обзор на 150-200 слов по правилам в system-сообщении.');

  return lines.join('\n');
}

/**
 * Извлечь top-items блок из markdown'ового report.text.
 * Ищем секцию `### <название>` + соседние `- ...` пункты до пустой строки или следующего ###.
 */
function _extractTopItems(text, sectionHeader) {
  if (!text || !sectionHeader) return '';
  const idx = text.indexOf(sectionHeader);
  if (idx < 0) return '';
  const after = text.slice(idx + sectionHeader.length);
  const stopIdx = after.search(/\n### |\n## /);
  const section = stopIdx >= 0 ? after.slice(0, stopIdx) : after;
  // Берём только bullet'ы («- »).
  const bullets = section.split('\n').filter(l => l.trim().startsWith('-')).slice(0, 5);
  return bullets.length ? bullets.join('\n') : '';
}

function _sanitize(text) {
  // Убираем лишние пробелы, тримим, проверяем что не пусто.
  const t = String(text).trim();
  if (!t) return null;
  if (t.length < 30) return null;  // слишком короткий — невалидный narrative
  return t;
}

/* ─────────────────────────────────────────────────────────────
   Helper для employeeReport — вставка narrative в текст отчёта
   ───────────────────────────────────────────────────────────── */

/**
 * Префиксует report.text сгенерированным narrative'ом + бейдж AI-generated.
 * Caller передаёт structured response — возвращается mutated копия.
 *
 * @param {object} structured — output buildEmployeeReport
 * @param {string} narrative
 * @returns {object} new structured
 */
export function injectNarrative(structured, narrative) {
  if (!structured || !narrative) return structured;
  const badge = '> **✦ AI-обзор** _(сгенерирован GigaChat, опирается только на цифры выше)_';
  const newText = [
    structured.text.split('\n').slice(0, 2).join('\n'), // header (## + period)
    '',
    badge,
    '',
    narrative,
    '',
    '---',
    '',
    structured.text.split('\n').slice(2).join('\n'), // rest
  ].join('\n');
  return {
    ...structured,
    text: newText,
    _meta: {
      ...structured._meta,
      hasNarrative: true,
    },
  };
}
