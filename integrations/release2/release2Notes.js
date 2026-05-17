'use strict';
/* ============================================================
   integrations/release2/release2Notes.js — V22+ (Release notes feature, 2026-05-17)

   Pure builder для release notes. НЕ зависит от DOM — тестируется через unit.

   Public API:
     buildRuleBasedMarkdown(release, related?, opts?) → string
       Мгновенная rule-based генерация markdown'а из release-модели + опционально
       подгруженных related issue с description. Группировка по issuetype →
       по КЭ → по priority DESC.

     buildLLMPrompt(release, related?, opts?) → { system, user }
       Подготовка system+user сообщений для GigaChat. Включает rule-based
       markdown как baseline + descriptions related issue (если есть).

     callLLMForNotes(prompt, opts?) → Promise<string|null>
       Soft-fallback wrapper над /api/llm/chat. Возвращает text или null если
       LLM недоступен / timeout.

     downloadMarkdown(md, releaseKey, source?) → void
       Blob+a-download trigger. source='rule'|'llm' → влияет на filename.

     stripHtmlTags(html) → string
       Утилита: HTML (из renderedFields.description) → plain text.

     scrubSecrets(text) → string
       Защита от утечки токенов / паролей в payload для LLM.
   ============================================================ */

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

const PRIORITY_RANK = {
  'Highest':  5, 'Blocker':  5,
  'Critical': 4, 'High':     4,
  'Major':    3, 'Medium':   3,
  'Minor':    2, 'Low':      2,
  'Trivial':  1, 'Lowest':   1,
};

/**
 * Распознаём заблокированных [Х]/[X]/[В]/[B] (см. MEMORY.feedback_blocked_users).
 * Для assignee/reporter в release notes заменяем на «—».
 */
function _isBlocked(name) {
  if (!name) return false;
  return /\s*\[[ХXВB]\]\s*$/i.test(String(name));
}

function _userLabel(u) {
  if (!u) return '—';
  const name = u.displayName || u.label || u.name || '';
  if (!name || _isBlocked(name)) return '—';
  return name;
}

function _fmtDate(s) {
  if (!s) return '—';
  try {
    const d = new Date(s);
    if (!Number.isFinite(d.getTime())) return '—';
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch (_) { return '—'; }
}

/**
 * HTML → plain text (для renderedFields.description).
 * Безопасно strip'аем теги + decode 5 named entities + collapse whitespace.
 */
export function stripHtmlTags(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const cp = parseInt(n, 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x10FFFF ? String.fromCodePoint(cp) : '';
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Защита от утечки секретов в LLM-payload (description часто содержит ссылки
 * с токенами в query-params, или Authorization-header'ы в копипасте багов).
 * Не претендуем на полноту — заменяем bearer / authorization / token / password
 * фрагменты на [REDACTED] перед отправкой в GigaChat.
 */
export function scrubSecrets(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    // JWT — 3 dot-separated base64 parts начиная с `eyJ` (header `{"alg"...}`).
    // Ловит и обычные access-tokens GigaChat / Sigma / любых JWS.
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT-REDACTED]')
    // Заголовки + querystring токены.
    .replace(/(authorization|bearer|api[_-]?key|x-api-key|auth-token)\s*[:=]\s*\S+/gi, '$1: [REDACTED]')
    .replace(/(token|password|passwd|secret|apikey|auth_key)\s*[:=]\s*\S+/gi, '$1: [REDACTED]')
    .replace(/[?&](token|access_token|api_key|key|auth)=[^&\s]+/gi, '$&[redacted]');
}

/* ─────────────────────────────────────────────────────────────
   Group + sort
   ───────────────────────────────────────────────────────────── */

/**
 * Группирует items по КЭ (label/component). Если у item есть config-element
 * который пересекается с release.configElement[].value → группа КЭ. Иначе
 * группа «Без КЭ».
 *
 * @param {Array} items — из release._links.partOf или ._links.bugs
 * @param {object} release — release-модель
 * @returns {Map<string, Array>} групировка key=КЭ-label
 */
function _groupByKE(items, release) {
  const groups = new Map();
  // Известные КЭ из релиза (для нормализации).
  const releaseKE = (release?.configElement || []).map(c => String(c.value || c).trim());
  for (const item of items) {
    let group = 'Без КЭ';
    // Эвристика 1: labels пересекаются с releaseKE.
    const labels = (item.labels || []).map(l => String(l));
    const matchedKE = releaseKE.find(ke => labels.some(l => l === ke || l.includes(ke)));
    if (matchedKE) {
      group = matchedKE;
    } else {
      // Эвристика 2: components.
      const components = (item.components || []).map(c => c?.name || c).filter(Boolean);
      if (components.length) group = String(components[0]);
    }
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);
  }
  // Сортируем внутри группы: priority DESC → status (готовые внизу) → key ASC.
  for (const arr of groups.values()) {
    arr.sort((a, b) => {
      const pa = PRIORITY_RANK[a.priority] || 0;
      const pb = PRIORITY_RANK[b.priority] || 0;
      if (pa !== pb) return pb - pa;
      const aDone = /done|готов|закр/i.test(a.status || '');
      const bDone = /done|готов|закр/i.test(b.status || '');
      if (aDone !== bDone) return aDone ? 1 : -1;
      return String(a.key).localeCompare(String(b.key));
    });
  }
  return groups;
}

/**
 * Из release model + related fetch'а собираем enriched items (со описаниями).
 * related — массив raw Jira issue из fetchRelease2Related(withDescription:true).
 */
function _mergeWithRelated(items, related) {
  if (!Array.isArray(related) || !related.length) return items;
  const byKey = new Map();
  for (const r of related) {
    if (r?.key) byKey.set(r.key, r);
  }
  return items.map(it => {
    const r = byKey.get(it.key);
    if (!r) return it;
    const f = r.fields || {};
    // description: try renderedFields.description (HTML) → strip; fallback на f.description.
    const renderedDesc = r?.renderedFields?.description || '';
    const rawDesc = typeof f.description === 'string' ? f.description : '';
    const description = renderedDesc ? stripHtmlTags(renderedDesc) : rawDesc;
    return {
      ...it,
      description: description || '',
      assignee: it.assignee || f.assignee,
      labels: Array.isArray(f.labels) ? f.labels : (it.labels || []),
      components: Array.isArray(f.components) ? f.components : (it.components || []),
    };
  });
}

/* ─────────────────────────────────────────────────────────────
   Section builders
   ───────────────────────────────────────────────────────────── */

function _renderHeader(release, opts) {
  const isShort = opts.mode === 'short';
  const lines = [];
  lines.push(`# Release notes · ${release.key}`);
  if (release.summary) lines.push(`### ${release.summary}`);
  if (isShort) {
    // Краткая версия — минимум.
    const prod = _fmtDate(release.dates?.planProdEnd);
    lines.push('');
    lines.push(`**Дата ПРОМ (план):** ${prod}`);
    return lines.join('\n');
  }
  // Полная.
  const prodPlan = _fmtDate(release.dates?.planProdEnd);
  const prodFact = _fmtDate(release.dates?.factProdDate);
  lines.push('');
  lines.push(`| Поле | Значение |`);
  lines.push(`|---|---|`);
  lines.push(`| Тип релиза | ${release.type || release.issuetype || '—'} |`);
  lines.push(`| Статус | ${release.status || '—'} |`);
  lines.push(`| Проект | ${release.project?.name || release.project?.key || '—'} |`);
  lines.push(`| Дата ПРОМ (план) | ${prodPlan} |`);
  lines.push(`| Дата ПРОМ (факт) | ${prodFact} |`);
  lines.push(`| Организатор | ${_userLabel(release.organizer)} |`);
  if (release.approver) lines.push(`| Утверждающий | ${_userLabel(release.approver)} |`);
  if (release.riskLevel) lines.push(`| Степень риска | ${release.riskLevel} |`);
  return lines.join('\n');
}

function _renderTLDR() {
  // TL;DR умеет только LLM — для rule-based ставим placeholder с подсказкой.
  return [
    '## TL;DR',
    '',
    '_Краткое описание изменений в релизе будет сгенерировано при нажатии «Сформировать с LLM»._',
  ].join('\n');
}

function _renderStoriesSection(release, items, opts) {
  const lines = ['', `## Что нового — Stories (${items.length})`];
  if (!items.length) {
    lines.push('', '_Нет историй в составе релиза._');
    return lines.join('\n');
  }
  const isShort = opts.mode === 'short';
  const groups = _groupByKE(items, release);
  // КЭ-группы сортируем: с большим количеством наверх.
  const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [keGroup, arr] of sortedGroups) {
    lines.push('', `### ${keGroup} (${arr.length})`);
    for (const it of arr) {
      const prioBadge = it.priority && it.priority !== 'Major' ? ` · ${it.priority}` : '';
      const statusBadge = it.status ? ` · _${it.status}_` : '';
      const summary = (it.summary || '').replace(/\s+/g, ' ').trim();
      if (isShort) {
        // Краткая: без Jira-ключа, без status, только summary.
        lines.push(`- ${summary}${prioBadge}`);
      } else {
        lines.push(`- **${it.key}** ${summary}${statusBadge}${prioBadge}`);
        if (it.description && it.description.length > 10) {
          // Включаем краткое описание (3 строки, до 280 chars).
          const desc = it.description.split('\n').slice(0, 3).join(' ').slice(0, 280);
          lines.push(`  ${desc}${it.description.length > 280 ? '…' : ''}`);
        }
      }
    }
  }
  return lines.join('\n');
}

function _renderBugsSection(release, items, opts) {
  const lines = ['', `## Исправления — Bugs (${items.length})`];
  if (!items.length) {
    lines.push('', '_Нет багов в составе релиза._');
    return lines.join('\n');
  }
  const isShort = opts.mode === 'short';
  const groups = _groupByKE(items, release);
  const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [keGroup, arr] of sortedGroups) {
    lines.push('', `### ${keGroup} (${arr.length})`);
    for (const it of arr) {
      const prioBadge = it.priority && it.priority !== 'Major' ? ` · ${it.priority}` : '';
      const summary = (it.summary || '').replace(/\s+/g, ' ').trim();
      if (isShort) {
        lines.push(`- ${summary}${prioBadge}`);
      } else {
        const statusBadge = it.status ? ` · _${it.status}_` : '';
        lines.push(`- **${it.key}** ${summary}${statusBadge}${prioBadge}`);
        if (it.description && it.description.length > 10) {
          const desc = it.description.split('\n').slice(0, 3).join(' ').slice(0, 280);
          lines.push(`  ${desc}${it.description.length > 280 ? '…' : ''}`);
        }
      }
    }
  }
  return lines.join('\n');
}

function _renderTestingSection(release) {
  const subtasks = release._subtasks || [];
  if (!subtasks.length) return '';
  const passed = subtasks.filter(s => /done|готов|passed/i.test(s.status || '')).length;
  const failed = subtasks.filter(s => /fail|cancel|отмен/i.test(s.status || '')).length;
  const inProgress = subtasks.length - passed - failed;
  const lines = ['', `## Тестирование`];
  lines.push('');
  lines.push(`- Подзадач ПСИ: **${subtasks.length}** (${passed} готовы · ${failed} провалены · ${inProgress} в работе)`);
  if (release.ppsiApprovedAt) {
    lines.push(`- ППСИ-approval: **${_fmtDate(release.ppsiApprovedAt)}**`);
  } else {
    lines.push(`- ППСИ-approval: _не зафиксирован_`);
  }
  if (release.uatGoal) lines.push(`- Цель ПСИ: ${release.uatGoal}`);
  if (release.uatResult) lines.push(`- Результат ПСИ: ${release.uatResult}`);
  return lines.join('\n');
}

function _renderConfigElementsSection(release) {
  const ke = release.configElement || [];
  if (!ke.length) return '';
  const lines = ['', `## Технические артефакты (КЭ)`, ''];
  for (const c of ke) {
    const v = c.value || c;
    lines.push(`- ${v}`);
  }
  return lines.join('\n');
}

function _renderDatesSection(release) {
  const d = release.dates || {};
  const rows = [
    ['Фиксация плана',      d.planFixation,     null],
    ['ИФТ',                  d.planIFTStart || d.planIFTEnd, null],
    ['НТ',                   d.planNTStart || d.planNTEnd,   null],
    ['ПСИ (UAT)',            d.planUATStart || d.planUATEnd, d.factUATStart || d.factUATEnd],
    ['ППСИ',                 null,               release.ppsiApprovedAt],
    ['ПРОМ',                 d.planProdEnd,      d.factProdDate],
  ].filter(r => r[1] || r[2]);
  if (!rows.length) return '';
  const lines = ['', `## Даты этапов`, '', `| Этап | План | Факт |`, `|---|---|---|`];
  for (const [label, plan, fact] of rows) {
    lines.push(`| ${label} | ${_fmtDate(plan)} | ${_fmtDate(fact)} |`);
  }
  return lines.join('\n');
}

function _renderMetricsSection(release, partOf, bugs) {
  const ke = release.configElement || [];
  const subs = release._subtasks || [];
  const lines = ['', `## Метрики релиза`, ''];
  lines.push(`- Историй (Stories): **${partOf.length}**`);
  lines.push(`- Багов (Bugs): **${bugs.length}**`);
  lines.push(`- КЭ: **${ke.length}**`);
  lines.push(`- Подзадач ПСИ: **${subs.length}**`);
  return lines.join('\n');
}

function _renderFooter(release) {
  const ts = new Date().toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  return `\n\n---\n_Release notes сгенерированы из Призмы · ${ts} · ${release.key}_\n`;
}

/* ─────────────────────────────────────────────────────────────
   Public API: buildRuleBasedMarkdown
   ───────────────────────────────────────────────────────────── */

/**
 * @param {object} release — analysed release model
 * @param {Array}  related — raw issues с description (от fetchRelease2Related)
 * @param {object} opts — { mode: 'full'|'short' (default 'full') }
 * @returns {string} markdown
 */
export function buildRuleBasedMarkdown(release, related = [], opts = {}) {
  if (!release || !release.key) return '_Релиз не задан._';
  const mode = opts.mode === 'short' ? 'short' : 'full';
  const partOf = _mergeWithRelated(release._links?.partOf || [], related);
  const bugs   = _mergeWithRelated(release._links?.bugs   || [], related);
  const sections = [];
  sections.push(_renderHeader(release, { mode }));
  sections.push(_renderTLDR());
  sections.push(_renderStoriesSection(release, partOf, { mode }));
  sections.push(_renderBugsSection(release, bugs, { mode }));
  if (mode === 'full') {
    const tests = _renderTestingSection(release);
    if (tests) sections.push(tests);
    const ke = _renderConfigElementsSection(release);
    if (ke) sections.push(ke);
    const dates = _renderDatesSection(release);
    if (dates) sections.push(dates);
    sections.push(_renderMetricsSection(release, partOf, bugs));
  }
  sections.push(_renderFooter(release));
  return sections.filter(Boolean).join('\n');
}

/* ─────────────────────────────────────────────────────────────
   Public API: buildLLMPrompt
   ───────────────────────────────────────────────────────────── */

const LLM_SYSTEM_PROMPT = `Ты — технический писатель Сбербанка. Получаешь rule-based markdown release-notes + полные описания задач, и пишешь читабельную бизнес-версию для рассылки руководству.

ПРАВИЛА:
1. Сохраняй ВСЕ ключи задач в формате "ABC-1234" — это audit-trail для разработки.
2. Переписывай тех-формулировки на язык бизнес-пользователя (без жаргона «фикс»/«рефактор»/«рефакторинг»/«ИФТ»/«НТ» — explain).
3. Сохраняй структуру разделов: TL;DR → Что нового → Исправления → (Тестирование / КЭ / Даты / Метрики).
4. ОБЯЗАТЕЛЬНО заполни раздел "## TL;DR" в 2-3 строки — синтезируй главное из всех изменений.
5. Тон нейтральный, без маркетинговых эпитетов («революционный», «уникальный», «передовой»).
6. Длина итогового документа ≤ 1.5x от исходного — не раздувай.
7. НЕ выдумывай фичи, описания, эффекты. Если описание задачи пустое — используй только summary.
8. НЕ используй emoji. Заголовки markdown (## / ###), списки markdown (-).
9. НЕ начинай TL;DR с "Этот релиз" — пиши конкретно про функционал.
10. Если задача описана в коде Jira-issue → опиши КОНКРЕТНО что она делает в продукте, не "разработка функционала X".`;

/**
 * @param {object} release
 * @param {Array}  related — raw issues с description
 * @param {object} opts — { mode: 'full'|'short' }
 * @returns {{ system: string, user: string }}
 */
export function buildLLMPrompt(release, related = [], opts = {}) {
  const ruleBasedMd = buildRuleBasedMarkdown(release, related, opts);
  const tasks = _mergeWithRelated(
    [...(release._links?.partOf || []), ...(release._links?.bugs || [])],
    related
  );
  // Готовим описания задач отдельно — но фильтруем secrets перед отправкой.
  const taskDescriptions = tasks
    .filter(t => t.description && t.description.length > 10)
    .slice(0, 60)  // hard cap чтобы не упереться в context-window
    .map(t => {
      const desc = scrubSecrets(t.description).slice(0, 800);
      return `### ${t.key} — ${(t.summary || '').slice(0, 120)}\n${desc}`;
    })
    .join('\n\n');

  const releaseSummary = (release.summary || '').slice(0, 200);
  const rawUser = [
    `РЕЛИЗ: ${release.key} — ${releaseSummary}`,
    `Дата ПРОМ (план): ${_fmtDate(release.dates?.planProdEnd)}`,
    `Дата ПРОМ (факт): ${_fmtDate(release.dates?.factProdDate)}`,
    '',
    '=== ИСХОДНЫЙ RULE-BASED MARKDOWN ===',
    ruleBasedMd,
    '',
    '=== ПОЛНЫЕ ОПИСАНИЯ ЗАДАЧ ===',
    taskDescriptions || '_(описания отсутствуют)_',
    '',
    '=== ЗАДАНИЕ ===',
    'Перепиши release notes по правилам system-сообщения. Сохрани все ключи задач (ABC-1234), переведи на язык бизнес-пользователя, заполни TL;DR. Выводи ТОЛЬКО markdown — никаких комментариев "Вот ваш ответ:".',
  ].join('\n');

  // Final scrub-pass — защита от утечек в LLM. ruleBasedMd может содержать
  // description embedded в Stories/Bugs списках; taskDescriptions уже
  // scrubbed выше, но рассыпанные секреты в rule-based секции могли проскочить.
  const user = scrubSecrets(rawUser);

  return { system: LLM_SYSTEM_PROMPT, user };
}

/* ─────────────────────────────────────────────────────────────
   Public API: callLLMForNotes
   ───────────────────────────────────────────────────────────── */

const LLM_TIMEOUT_MS = 45_000;

/**
 * @param {{system,user}} prompt
 * @param {object} opts — { signal?, model?, maxTokens?, temperature?, timeoutMs? }
 * @returns {Promise<string|null>}
 */
export async function callLLMForNotes(prompt, opts = {}) {
  if (!prompt?.system || !prompt?.user) return null;
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => {
    try { ctrl.abort(new DOMException('Timeout', 'TimeoutError')); }
    catch (_) { ctrl.abort(); }
  }, opts.timeoutMs || LLM_TIMEOUT_MS) : null;
  if (opts.signal && ctrl) {
    if (opts.signal.aborted) ctrl.abort(opts.signal.reason);
    else opts.signal.addEventListener('abort', () => ctrl.abort(opts.signal.reason), { once: true });
  }
  try {
    const body = {
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user',   content: prompt.user },
      ],
      model: opts.model || 'GigaChat',
      max_tokens: Math.min(opts.maxTokens || 2500, 4000),
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.3,
      stream: false,
    };
    const res = await fetch('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl?.signal,
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data) return null;
    const text = data?.choices?.[0]?.message?.content
              || data?.text
              || data?.content
              || null;
    if (!text || typeof text !== 'string') return null;
    return text.trim();
  } catch (_) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ─────────────────────────────────────────────────────────────
   Public API: downloadMarkdown
   ───────────────────────────────────────────────────────────── */

/**
 * @param {string} md
 * @param {string} releaseKey
 * @param {'rule'|'llm'} source
 */
export function downloadMarkdown(md, releaseKey, source = 'rule') {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
  const date = new Date().toISOString().slice(0, 10);
  const suffix = source === 'llm' ? '-llm' : '';
  const safeKey = String(releaseKey || 'release').replace(/[^A-Za-z0-9_-]/g, '_');
  const filename = `release-notes-${safeKey}-${date}${suffix}.md`;
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

/* ─────────────────────────────────────────────────────────────
   Hint for callers: какие keys тянуть для LLM-режима
   ───────────────────────────────────────────────────────────── */

/**
 * @param {object} release
 * @returns {string[]} keys всех partOf + bugs (для bulk fetch description)
 */
export function getRelatedKeysForFetch(release) {
  const partOf = release?._links?.partOf || [];
  const bugs   = release?._links?.bugs   || [];
  const seen = new Set();
  const result = [];
  for (const it of [...partOf, ...bugs]) {
    if (it?.key && !seen.has(it.key)) {
      seen.add(it.key);
      result.push(it.key);
    }
  }
  return result;
}
