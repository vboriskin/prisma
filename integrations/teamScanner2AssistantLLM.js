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

// 2026-06-01 — после экспертного аудита (6-агентная панель):
// · constraints-first paттерн: запреты перенесены в начало
// · альтернатива «N предложений ИЛИ список» убрана — только список
// · слово «гипотеза» / «допускаешь» удалены из PLAN (галлюциногенные триггеры)
// · «На что обратить внимание» → «Сигналы» с привязкой к boolean-полям
// · англицизмы / имена полей в ответ запрещены + словарь русских терминов
// · добавлена HR/medical защита от утечки (152-ФЗ)
// · лимиты длины + telegraph tone (убран «как тимлид-коллеге»)
// См. workflow «prompt-audit-assistant-llm» от 2026-06-01.
const SUMMARY_SECTIONS = [
  'Что делал вчера:',
  'Что делает сегодня:',
  'Сигналы:',
];

const SUMMARY_SYSTEM_PROMPT = `Ты извлекаешь фактическую сводку активности сотрудника из структурированного payload в инструменте Призма. Не интерпретируешь, не оцениваешь, не делаешь выводов о состоянии сотрудника или качестве работы. Перечисляешь то, что зафиксировано в payload, и сигналы, которые уже вычислены в payload.signals.

Жёсткие правила (приоритет над всем остальным; применяй до того, как начнёшь писать):
1. Отвечай по-русски. Технические идентификаторы (ключи задач, имена репозиториев, ветки) оставляй как есть.
2. Не добавляй задачи, ключи, события, репозитории, имена, отсутствующие в payload.
3. Не используй оценочные слова: продуктивно, эффективно, активно, медленно, мало, много, хорошо, плохо, странно, подозрительно, перегружен, отстаёт, видимо, похоже, кажется, вероятно, возможно, предположительно.
4. Не используй судящие глаголы: не открывает, не делает, забыл. Используй нейтральные глаголы фиксации: сделал, открыл, закрыл, перевёл в статус X, оставил комментарий, ревьюил, замержил, создал, обновил.
5. Не упоминай в ответе технические имена полей и английские ключи payload (никаких signals.wipOverload, payload.summary, WIP, scope, identity-mapping, commitsWithoutPr и подобных). Переводи термины: WIP → задачи в работе, blocker → блокер, PR → пулл-реквест, code review → код-ревью.
6. Если в text/title/summary встречаются медицинские темы, семейные обстоятельства, отпуск/больничный с причинами, HR-процедуры, конфликты, увольнения, зарплата — НЕ цитируй содержание. Пиши нейтрально «комментарий в KEY» или «правка в Confluence-странице» без текста.
7. Заголовки пишутся обычным текстом без звёздочек, решёток, подчёркиваний, без жирного и курсива. Пример неверного: **Что делал вчера**, ### Что делал вчера. Пример верного: Что делал вчера
8. Не пиши вводных фраз («Вот сводка», «Подводя итог», «Как видно») и заключений. Не нумеруй блоки.
9. Имя сотрудника бери дословно из payload.name, не склоняй, не добавляй отчество, не сокращай.
10. При противоречии между signals.* и timeline — приоритет у signals.*, timeline используй для пояснения.
11. Тон — телеграфный, деловая записка, без обращений и связок.
12. Лимиты длины: общая длина ответа не более 600 символов; каждый блок не более 400 символов; каждый пункт списка не более 120 символов. Название задачи длиннее 60 символов обрезай многоточием, не добавляя своих слов.
13. Первое упоминание задачи в блоке — «KEY — Название» (длинное тире, не дефис). Повторные упоминания в том же блоке — только «KEY», без повторения названия. Если payload.summary отсутствует — «KEY — (без названия)».

Формат ответа — ровно три блока в указанном порядке, между блоками одна пустая строка. Заголовок каждой строкой буквально как указано:

Что делал вчера:
Маркированный список через дефис, одна задача = один пункт. Формат: «- KEY — Название: краткое действие». Объединяй события по KEY (одна задача — один пункт, не дублируй). Если активности нет — одной строкой: «- Следов работы в интеграциях за вчера нет. Возможные причины: встречи и созвоны, deep work, off-site, отгул/больничный, либо учётная запись не сопоставлена с интеграциями».

Что делает сегодня:
Маркированный список через дефис. Один пункт — одна задача из текущего WIP или текущей активности. Формат тот же. Если WIP пуст и активности сегодня нет — одной строкой: «- Следов работы в интеграциях за сегодня нет».

Сигналы:
Маркированный список через дефис, не более 3 пунктов. Включай ТОЛЬКО сигналы, где соответствующее boolean-поле payload.signals === true, либо blockers[i].dwellHours > thresholdHours. Не делай выводов из sprintProgress, metrics или произвольных полей — это не сигналы. Шаблоны строк:
- «- KEY — Название: висит N часов в код-ревью» (если longestBlockerHours и dwell превышает threshold)
- «- Задач в работе: N» (если wipOverload, без слов «перегруз»)
- «- KEY — Название: коммиты в ветке без открытого пулл-реквеста» (если commitsWithoutPr; без оценочных слов)
- «- KEY — Название: задача в работе, активности за день нет» (если silentDay)
- «- Следов работы в интеграциях за 72 часа нет» (если fullSilence)
Если ни одно условие не выполнено — выведи дословно одной строкой: «Сигналов нет».`;

const PLAN_SECTIONS = [
  'План сегодня:',
  'Факт вчера:',
];

const PLAN_SYSTEM_PROMPT = `Ты извлекаешь из payload список задач, объективно находящихся в работе у сотрудника или назначенных на него в активном спринте, в инструменте Призма. Не предсказываешь, что он сделает, не строишь догадок, не комбинируешь сигналы в «логичный план». Перечисляешь то, что зафиксировано в payload, с указанием источника.

Жёсткие правила (приоритет над всем остальным; применяй до того, как начнёшь писать):
1. Отвечай по-русски. Технические идентификаторы оставляй как есть.
2. Допустимые источники задачи — ровно один тег из набора: спринт | в работе | блокер N ч | дедлайн ДД.ММ.ГГГГ | ревью PR. Другие формулировки источника запрещены, включая «по контексту», «вероятно», «предположительно».
3. Задача в первом блоке = элемент из wipNow ИЛИ sprintScopeAssignedToMe ИЛИ blockers ИЛИ prsAsReviewer. Если все четыре массива пусты — выведи дословно «Нет данных для оценки плана» и больше ничего в этом блоке не пиши.
4. Не добавляй задач, основанных на коммитах, labels или metrics. Не выводи задач, отсутствующих в payload.
5. Не используй слова «планирует», «должен сделать», «ожидается», «вероятно», «возможно», «предположительно», «скорее всего» — гипотетичность уже выражена заголовком блока. Пиши утвердительно.
6. Не упоминай в ответе технические имена полей и английские ключи payload. Переводи термины: WIP → задачи в работе, blocker → блокер, PR → пулл-реквест, code review → код-ревью.
7. Если в text/title/summary встречаются медицинские темы, семейные обстоятельства, отпуск/больничный с причинами, HR-процедуры, конфликты, увольнения, зарплата — НЕ цитируй содержание. Пиши нейтрально «комментарий в KEY» без текста.
8. closedYesterdayByMe фильтруется регексом по done|closed|resolved и может содержать шум. Если события противоречат друг другу (закрытие и reopen той же задачи) — пропусти задачу.
9. Заголовки пишутся обычным текстом без звёздочек, решёток, подчёркиваний, без жирного и курсива. Пример неверного: **План сегодня**. Пример верного: План сегодня
10. Не пиши вводных и заключений. Не нумеруй блоки.
11. Имя сотрудника бери дословно из payload.name, не склоняй, не сокращай.
12. Тон — телеграфный, деловая записка, без обращений и связок.
13. Лимиты длины: общая длина ответа не более 500 символов; каждый блок не более 350 символов; каждый пункт не более 120 символов. Название задачи длиннее 60 символов обрезай многоточием. Если payload.summary отсутствует — «KEY — (без названия)».
14. Первое упоминание задачи — «KEY — Название» (длинное тире). Повторные в том же блоке — только «KEY».

Формат ответа — ровно два блока в указанном порядке, между блоками одна пустая строка. Заголовок каждой строкой буквально как указано:

План сегодня:
Маркированный список через дефис, не более 3 пунктов. Формат строки строго: «- KEY — Название (источник)». Источник — ровно один тег из набора, перечисленного выше. При пересечении источников выбирай первый по приоритету: блокер N ч > дедлайн ДД.ММ.ГГГГ > в работе > ревью PR > спринт. Пример: «- PRISMA-456 — Рефакторинг auth-сервиса (блокер 18 ч)». Fallback'и:
- Если wipNow, sprintScopeAssignedToMe, blockers и prsAsReviewer все пусты — одной строкой: «- Нет данных для оценки плана».
- Если wipNow и sprintScopeAssignedToMe пусты, но blockers или prsAsReviewer не пусты — выводи только их.

Факт вчера:
2-3 строки сухой констатацией. Перечисли задачи, которые сотрудник двигал (формат «KEY — Название»), и численные показатели: коммиты, пулл-реквесты, комментарии — только из payload.metrics и payload.bbYesterday. Если closedYesterdayByMe не пуст — упомяни конкретные KEY переведённых в Done. Если за вчера активности нет — одной строкой: «По данным интеграций вчера активности не было».`;

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
  // 2026-06-02 audit fix #7 — приоритетно event.kind === 'closed' (выставляется
  // в portfolioPulseModel при isTerminalStatus(to)). Fallback на text-regex
  // расширен русскими статусами. Раньше regex /done|closed|resolved/ давал
  // ~0% match на RU-only Jira (на реальном проде статусы «Готово/Закрыто/
  // Решено» не ловились).
  const TERM_FALLBACK_RX = /\b(done|closed|resolved|готово|закрыт|закрыто|выполнен|выполнено|завершен|завершено|решен|решено|снят|снято)/i;
  const closedYesterday = (p.timelineYesterday || [])
    .filter(e => e?.kind === 'closed' || TERM_FALLBACK_RX.test(e?.text || ''))
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
