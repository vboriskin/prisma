'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — LLM ASSISTANT
   --
   Две функции LLM-сводки по сотруднику, вызываемые ленинно при
   раскрытии секции «Сводка ассистента» в модалке сотрудника.

     generateSummary(p, model, opts)
       → { ok, html, error? }
       Сводка-нарратив за 72ч в 3 блоках:
         «Что делал вчера / Что делает сегодня / На что обратить
         внимание». Прокидывает в LLM производные сигналы
         (signals.*), чтобы не угадывал из массивов.

     generatePlanHypothesis(p, model, opts)
       → { ok, html, error? }
       ГИПОТЕЗА плана сегодня + факт вчера в 2 блоках.
       Опирается на active-sprint scope, WIP, due dates, blockers,
       PR-очередь. Явно дисклеймит что это не commitment.

   Оба ходят в /api/llm/chat тем же путём, что чат-бот: payload
   shape с apiBaseUrl + token + clientId + clientSecret (берётся
   из window.LLMAssistant.getSettings/getToken).

   Jira-ключи в ответе LLM пост-обрабатываются: к голому KEY
   подставляется « — Полное название» из payload, если LLM не
   сделал сам.
   ============================================================ */

/* ── Public API ───────────────────────────────────────────── */

export async function generateSummary(p, model, opts = {}) {
  return _runLLM({
    p,
    model,
    opts,
    system: SUMMARY_SYSTEM_PROMPT,
    buildPayload: _buildSummaryPayload,
    sections: SUMMARY_SECTIONS,
  });
}

export async function generatePlanHypothesis(p, model, opts = {}) {
  return _runLLM({
    p,
    model,
    opts,
    system: PLAN_SYSTEM_PROMPT,
    buildPayload: _buildPlanPayload,
    sections: PLAN_SECTIONS,
  });
}

export function readLLMConfig() {
  try {
    if (typeof window !== 'undefined' && window.LLMAssistant) {
      const settings = window.LLMAssistant.getSettings?.() || {};
      const token = window.LLMAssistant.getToken?.() || '';
      return {
        apiBaseUrl:   String(settings.apiBaseUrl || '').replace(/\/+$/, ''),
        model:        settings.model || 'GigaChat-2',
        temperature:  Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 0.35,
        clientId:     settings.clientId     || '',
        clientSecret: settings.clientSecret || '',
        token,
      };
    }
  } catch (_) { /* fall through */ }
  return { apiBaseUrl: '', model: 'GigaChat-2', temperature: 0.35, token: '', clientId: '', clientSecret: '' };
}

export function hasLLMCredentials(cfg) {
  return !!(cfg && (cfg.token || (cfg.clientId && cfg.clientSecret)));
}

/* ── Core runner ──────────────────────────────────────────── */

async function _runLLM({ p, model, opts, system, buildPayload, sections }) {
  const cfg = opts.cfg || readLLMConfig();
  if (!hasLLMCredentials(cfg)) {
    return {
      ok: false,
      error: 'LLM не настроен',
      html: `<div class="ts2-assistant-error">LLM не настроен: Настройки → LLM → введите token или clientId+clientSecret.</div>`,
    };
  }
  const userPayload = buildPayload(p, model);
  const res = await _callLLM(cfg, system, userPayload, opts);
  if (!res.ok) {
    return {
      ok: false,
      error: res.error || 'unknown',
      html: `<div class="ts2-assistant-error">LLM не ответил: <code>${_esc(res.error || '')}</code></div>`,
    };
  }
  const keyToSummary = buildKeyToSummaryMap(p);
  const augmented = augmentJiraKeysWithTitles(res.text, keyToSummary);
  const html = formatLLMResponseHTML(augmented, sections);
  return { ok: true, html, raw: res.text };
}

/* ── LLM fetch ────────────────────────────────────────────── */

async function _callLLM(cfg, system, userText, opts = {}) {
  const body = {
    apiBaseUrl:  cfg.apiBaseUrl || '',
    model:       opts.model || cfg.model || 'GigaChat-2',
    temperature: typeof opts.temperature === 'number' ? opts.temperature : cfg.temperature,
    max_tokens:  opts.maxTokens || 800,
    stream:      false,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: userText },
    ],
    token:        cfg.token || '',
    clientId:     cfg.clientId || '',
    clientSecret: cfg.clientSecret || '',
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try { ctrl.abort(new DOMException('timeout', 'TimeoutError')); } catch (_) { ctrl.abort(); }
  }, opts.timeoutMs || 45000);
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort(opts.signal.reason);
    else opts.signal.addEventListener('abort', () => ctrl.abort(opts.signal.reason), { once: true });
  }
  try {
    const res = await fetch('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      const errMsg = errBody?.error ? String(errBody.error) : `HTTP ${res.status} ${res.statusText || ''}`.trim();
      return { ok: false, error: errMsg };
    }
    const data = await res.json().catch(() => null);
    if (!data) return { ok: false, error: 'Сервер вернул не-JSON ответ.' };
    const text = data?.choices?.[0]?.message?.content || data?.text || data?.content || null;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return { ok: false, error: 'LLM вернул пустой ответ.' };
    }
    return { ok: true, text: text.trim() };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/* ── Prompts ──────────────────────────────────────────────── */

const SUMMARY_SECTIONS = [
  'Что делал вчера:',
  'Что делает сегодня:',
  'На что обратить внимание:',
];

const SUMMARY_SYSTEM_PROMPT = `Ты — ассистент тимлида в инструменте Призма. Помогаешь утром за 30 секунд понять, что происходит у конкретного сотрудника.

Получаешь сырые данные за 72 часа: задачи Jira (WIP, статусы, dwellHours блокеров, due date, оценка/потраченное), события Bitbucket (коммиты/PR/ревью), Confluence (правки), агрегированные метрики и блок производных сигналов (signals.*) — на них опирайся в первую очередь.

Структура ответа РОВНО три блока. Каждый заголовок отдельной строкой буквально как указано.

Что делал вчера:
<2-4 предложения ИЛИ маркированный список (одна задача на пункт). Конкретно по задачам с указанием «KEY — Название». Если активности нет — «По данным интеграций активности нет — возможно отгул, болезнь или identity-mapping не настроен».>

Что делает сегодня:
<2-4 предложения ИЛИ список. WIP сейчас + текущая активность. KEY — Название.>

На что обратить внимание:
<1-3 пункта-сигнала. Только конкретика по сигналам: «KEY висит N часов в Code Review (signals.longestBlockerHours)», «WIP=N при норме ≤2 (signals.wipOverload)», «коммиты есть, PR не открывает (signals.commitsWithoutPr)», «assigned WIP без активности за день (signals.silentDay)». Если красных флагов нет — «Сигналов нет».>

Жёсткие правила:
- Никаких оценок «хорошо/плохо», «продуктивно/непродуктивно». Только факты и сигналы.
- Никаких выдуманных задач, ключей, событий — только из payload.
- Когда упоминаешь Jira-задачу, ВСЕГДА пиши «KEY — Полное название» (название из payload.summary).
- Без markdown заголовков, без emoji.
- Тон сухой, профессиональный, как тимлид-коллеге.`;

const PLAN_SECTIONS = [
  'Что в плане сегодня (гипотеза):',
  'Факт вчера:',
];

const PLAN_SYSTEM_PROMPT = `Ты — ассистент тимлида в Призме. Помогаешь сформулировать ГИПОТЕЗУ ожидаемого плана у сотрудника. Это не явный commitment — у задач может не быть due date или story points. Ты допускаешь предположения, опираясь на доступные сигналы: scope активного спринта, WIP, статусы, dwell-time блокеров, due date если есть, PR-очередь.

Структура ответа РОВНО два блока. Каждый заголовок отдельной строкой буквально как указано.

Что в плане сегодня (гипотеза):
<1-3 пункта-списка (формат «- KEY — Название (источник)»). В скобках кратко указывай источник сигнала: (sprint scope), (WIP), (блокер N часов), (due date HH-MM-DD), (PR на ревью). Если данных нет (нет sprint scope, нет assigned WIP) — «Нет данных для оценки плана».>

Факт вчера:
<2-3 предложения по факту: какие задачи двигал (KEY — Название), сколько коммитов / PR / комментариев. Если за вчера тишина — «По данным интеграций вчера активности не было».>

Жёсткие правила:
- В «План сегодня» каждый пункт ОБЯЗАН содержать источник сигнала в скобках.
- Никаких выдуманных задач — только из payload.
- KEY — Полное название всегда.
- Никаких оценок и эмоций.
- Без markdown заголовков, без emoji.`;

/* ── Payload builders ─────────────────────────────────────── */

function _buildSummaryPayload(p, model) {
  const name = p.label || p.key || '(сотрудник)';
  const sprintProgress = model?.scannerV2?.sprintGoal
    ? {
        progressPct: model.scannerV2.sprintGoal.aggregateProgress,
        daysLeft:    model.scannerV2.sprintGoal.sprints?.[0]?.daysLeft,
      }
    : null;
  const wip = (p.issuesNow || []).slice(0, 8).map(_slimTask);
  const blockers = (p.blockers || []).slice(0, 6).map(_slimBlocker);
  const today = (p.timelineToday || []).slice(0, 18).map(_slimEvent);
  const yesterday = (p.timelineYesterday || []).slice(0, 18).map(_slimEvent);
  const bbToday = (p.bbItems || []).slice(0, 12).map(_slimBb);
  const cfToday = (p.cfItems || []).slice(0, 6).map(_slimCf);

  // Производные сигналы — на них LLM опирается в «На что обратить внимание».
  const wipN = (p.issuesNow || []).length;
  const longestBlockerH = blockers.length
    ? Math.max(...blockers.map(b => Number(b.dwellHours) || 0))
    : 0;
  const commits48h = (p.bbItems || []).filter(it => it.kind === 'commit' || !it.kind).length;
  const prs48h = (p.bbItems || []).filter(it => it.kind === 'pr').length;
  const todayEventsN = (p.timelineToday || []).length;

  const signals = {
    wipOverload:        wipN >= 4,
    longestBlockerHours: longestBlockerH,
    codeReviewQueue:    Number(p?._codeReviewQueueDepth || 0) || 0,
    commitsWithoutPr:   commits48h > 0 && prs48h === 0,
    silentDay:          todayEventsN === 0 && wipN > 0,
    fullSilence:        todayEventsN === 0 && wipN === 0 && (p.timelineYesterday || []).length === 0,
  };

  return JSON.stringify({
    name,
    email: p.email || '',
    sprintProgress,
    signals,
    wip,
    blockers,
    timelineToday: today,
    timelineYesterday: yesterday,
    bbToday,
    cfToday,
    metrics: {
      hoursLoggedTodayH:   Math.round(((p.loggedTodaySec || 0) / 3600) * 10) / 10,
      hoursLoggedYestH:    Math.round(((p.loggedYesterdaySec || 0) / 3600) * 10) / 10,
      commits48h, prs48h,
      cfEdits48h: (p.cfItems || []).length,
    },
  }, null, 2);
}

function _buildPlanPayload(p, model) {
  const name = p.label || p.key || '(сотрудник)';
  // sprintIssues — assigned-to-me, по всем pk сотрудника.
  const myKey = String(p.jiraAccountId || '');
  const myEmail = String(p.email || '').toLowerCase();
  const projects = Array.isArray(p.projects) ? p.projects : [];
  const sprintScope = [];
  for (const pk of projects) {
    const list = model?.spaces?.[pk]?.sprintIssues || [];
    for (const it of list) {
      const aName = String(it.assignee || '').toLowerCase();
      // assignee у slim — display name. Сопоставление по name/email/displayName
      // не идеально, но прокси приемлемый: если фразу slimIssue не задало —
      // дополнительно сверяем с p.label.
      const matchByName = aName && (aName === (p.label || '').toLowerCase());
      if (matchByName) sprintScope.push(_slimTask(it));
    }
    if (sprintScope.length >= 12) break;
  }
  // closedYesterdayByMe — события за вчера со status→Done.
  const closedYesterday = (p.timelineYesterday || [])
    .filter(e => /done|closed|resolved/i.test(e?.text || '') || /status/i.test(e?.kind || ''))
    .slice(0, 8)
    .map(_slimEvent);
  // pr-as-reviewer — пытаемся вытащить из bb.review events.
  const prsAsReviewer = (p.bbItems || [])
    .filter(it => it.kind === 'review')
    .slice(0, 6)
    .map(it => ({ title: it.title || '', repo: it.repo || '', status: it.status || '' }));
  const sprintInfo = model?.scannerV2?.sprintGoal?.sprints?.[0] || null;
  const sprintProgress = sprintInfo
    ? { name: sprintInfo.name || '', progressPct: sprintInfo.progressPct, daysLeft: sprintInfo.daysLeft }
    : null;
  return JSON.stringify({
    name,
    sprintProgress,
    wipNow:             (p.issuesNow || []).slice(0, 10).map(_slimTask),
    sprintScopeAssignedToMe: sprintScope,
    blockers:           (p.blockers || []).slice(0, 6).map(_slimBlocker),
    prsAsReviewer,
    closedYesterdayByMe: closedYesterday,
    bbYesterday: (p.bbItems || []).slice(0, 12).map(_slimBb),
    metrics: {
      commits48h: (p.bbItems || []).filter(it => it.kind === 'commit' || !it.kind).length,
      prs48h:     (p.bbItems || []).filter(it => it.kind === 'pr').length,
    },
  }, null, 2);
}

/* ── Slimmers ─────────────────────────────────────────────── */

function _slimTask(it) {
  const out = {
    key:    it.key || '',
    summary: it.summary || '',
    status:  it.status || '',
    priority: it.priority || '',
    duedate:  it.duedate || '',
  };
  if (Number(it.originalEstimateSeconds) > 0) out.originalEstimateH = Math.round(it.originalEstimateSeconds / 360) / 10;
  if (Number(it.timeSpentSeconds) > 0)        out.timeSpentH        = Math.round(it.timeSpentSeconds / 360) / 10;
  if (Array.isArray(it.labels) && it.labels.length) out.labels = it.labels.slice(0, 6);
  return out;
}

function _slimBlocker(b) {
  const t = _slimTask(b);
  t.dwellHours = Number(b.dwellHours) || 0;
  t.thresholdHours = Number(b.thresholdHours) || 0;
  return t;
}

function _slimEvent(e) {
  return {
    at:   e?.at || '',
    src:  e?.src || 'jira',
    kind: e?.kind || '',
    key:  e?.issue?.key || '',
    summary: e?.issue?.summary || e?.issue?.fields?.summary || '',
    text: String(e?.text || '').slice(0, 120),
  };
}

function _slimBb(it) {
  return {
    kind:   it.kind || 'commit',
    title:  String(it.title || '').slice(0, 100),
    repo:   it.repo || '',
    status: it.status || '',
    at:     it.at || '',
  };
}

function _slimCf(it) {
  return {
    kind:  it.kind || 'edit',
    title: String(it.title || '').slice(0, 100),
    space: it.spaceName || it.spaceKey || '',
    at:    it.at || '',
  };
}

/* ── Post-process: KEY → KEY — Название ───────────────────── */

export function buildKeyToSummaryMap(p) {
  const map = new Map();
  const add = (key, summary) => {
    if (!key || !summary) return;
    const k = String(key).toUpperCase().trim();
    if (!map.has(k)) map.set(k, String(summary).trim());
  };
  for (const it of (p?.issuesNow || []))         add(it.key, it.summary);
  for (const b of  (p?.blockers || []))          add(b.key, b.summary);
  for (const e of  (p?.timelineToday || []))     add(e?.issue?.key, e?.issue?.summary || e?.issue?.fields?.summary);
  for (const e of  (p?.timelineYesterday || [])) add(e?.issue?.key, e?.issue?.summary || e?.issue?.fields?.summary);
  for (const e of  (p?.timelinePrev || []))      add(e?.issue?.key, e?.issue?.summary || e?.issue?.fields?.summary);
  return map;
}

export function augmentJiraKeysWithTitles(text, keyToSummary) {
  if (!text || !keyToSummary || keyToSummary.size === 0) return text;
  // Захватываем «KEY» (ABC-123), за которым НЕТ « — Название» / «(Название)».
  const re = /\b([A-Z][A-Z0-9]+-\d+)\b(?!\s*(?:[—–-]|\())/g;
  return text.replace(re, (match, key) => {
    const sum = keyToSummary.get(String(key).toUpperCase());
    return sum ? `${key} — ${sum}` : match;
  });
}

/* ── HTML formatter ───────────────────────────────────────── */

/**
 * Превращает текст LLM в HTML: переданные `sections` — массив заголовков
 * («Что делал вчера:», …). Между ними рендерим контент: bullet-pointы
 * (- … / • …) → <ul><li>, остальное — <p>.
 */
export function formatLLMResponseHTML(text, sections) {
  if (!text) return '';
  const lines = String(text).split('\n');
  const out = [];
  let buf = [];
  const flushBuf = () => {
    if (!buf.length) return;
    // Если все непустые строки начинаются с маркера — ul, иначе p.
    const nonEmpty = buf.filter(l => l.trim());
    const allBullets = nonEmpty.length > 0 && nonEmpty.every(l => /^\s*[-•*]\s+/.test(l));
    if (allBullets) {
      const items = nonEmpty.map(l => `<li>${_escInline(l.replace(/^\s*[-•*]\s+/, ''))}</li>`).join('');
      out.push(`<ul class="ts2-assistant-list">${items}</ul>`);
    } else {
      const para = _escInline(buf.join(' ').trim());
      if (para) out.push(`<p>${para}</p>`);
    }
    buf = [];
  };
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const isHeader = sections.some(h => line.trim() === h);
    if (isHeader) {
      flushBuf();
      out.push(`<strong class="ts2-assistant-h">${_esc(line.trim())}</strong>`);
      continue;
    }
    if (!line.trim()) { flushBuf(); continue; }
    buf.push(line);
  }
  flushBuf();
  return out.join('\n');
}

/* ── helpers ──────────────────────────────────────────────── */

function _esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// _escInline сохраняет уже встроенные «KEY — Название» как plain-text,
// но превращает голый KEY в Jira-ссылку. По умолчанию linkify отключён —
// модалка в Сканнере живёт в проде, ключи можно линкифицировать чтобы
// был клик в Jira. Однако нам неоткуда взять base URL надёжно, поэтому
// отдаём чистый escape — link оставляем не-кликабельным.
function _escInline(s) {
  return _esc(s);
}
