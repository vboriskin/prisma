'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — BRIEF EXPORT
   Standalone HTML «бриф» команды: одна команда — одна .html-страница.

   Плоский список сотрудников (без группировки stop/watch/moving/idle),
   каждая строка раскрывается в полную карточку из renderEmployeeDetailPanel.
   Inline JS даёт: разворачивание строки, поиск по имени, сортировку
   колонок, «развернуть всё / свернуть всё», переключатель темы
   (светлая по умолчанию).

   Содержимое разворачиваемой части = вывод renderEmployeeDetailPanel,
   пост-обработанный: убираем кнопки «Закрыть / TG / Share / 1:1 / Copy»
   и runtime-id'шники (id="ts2-panel-main" и т.д.), которые после
   дублирования по N сотрудникам сломали бы валидность HTML.

   2026-06-01 — LLM-сводка убрана из выгрузки HTML: она живёт теперь
   в live-модалке сотрудника как раскрывашка «Сводка ассистента»
   (lazy fetch при первом раскрытии). См. teamScanner2AssistantLLM.js.

   Экспорт: Blob + <a download> (тот же приём, что в _performExport).
   ============================================================ */

import { renderEmployeeDetailPanel } from './teamScanner2Renderer.js';
import { renderPersonRows } from './teamScanner2RendererPersonRows.js';
import { emit as telemetryEmit } from './telemetry.js';

const ALL_SRC_FILTERS = { j: true, b: true, c: true, zc: true, ze: true };

const CSS_KEEP_TOKENS = [
  'ts2-', 'pz-', 'pp-', 'brief-', 'btn-icon',
  '.ts2', '.pz', '.pp', '.brief',
];

/**
 * Основная точка входа. Собирает standalone HTML, триггерит скачивание.
 *
 * @param {object} model — pulse-model (model.participants, model.scannerV2 …)
 * @param {object} [opts]
 * @param {string} [opts.teamLabel] — название команды для шапки и имени файла
 */
export function exportTeamBrief(model, opts = {}) {
  if (!model || !Array.isArray(model.participants) || model.participants.length === 0) {
    throw new Error('Нет данных для выгрузки — сначала обновите Сканнер.');
  }
  const teamLabel = opts.teamLabel || (model.projectKeys || []).join(', ') || 'команда';
  const generatedAt = new Date();
  const peopleHtml = _buildPeopleSection(model);
  const css = _collectScopedCss();
  const headerHtml = _buildHeader(model, teamLabel, generatedAt);
  const toolbarHtml = _buildToolbar();
  const sortBarHtml = _buildSortBar();
  const bodyHtml = `
    <div class="brief-shell ts2-root">
      ${headerHtml}
      ${toolbarHtml}
      ${sortBarHtml}
      <div class="brief-people">${peopleHtml}</div>
    </div>
  `;
  const documentHtml = _assembleHtmlDocument({
    title: `Бриф команды ${teamLabel}`,
    css,
    bodyHtml,
    inlineJs: _briefInlineJs(),
  });
  const filename = `team-brief-${_slug(teamLabel)}-${_dateStamp(generatedAt)}.html`;
  _downloadFile(documentHtml, filename);
  try {
    telemetryEmit('scanner2.brief_export', {
      teamLabel,
      peopleCount: model.participants.length,
      sizeBytes: documentHtml.length,
    });
  } catch (_) { /* telemetry — best effort */ }
}


/* ── people section: ts2-row + .brief-detail next-sibling ─── */

function _buildPeopleSection(model) {
  const rawRowsHtml = renderPersonRows(model, { expandedKey: '' });
  if (typeof DOMParser === 'undefined') {
    return rawRowsHtml;
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<!DOCTYPE html><body><div id="wrap">${rawRowsHtml}</div></body>`, 'text/html');
  const wrap = doc.getElementById('wrap');
  if (!wrap) return rawRowsHtml;
  const byKey = new Map();
  for (const p of model.participants) byKey.set(p.key, p);
  const allRows = Array.from(wrap.querySelectorAll('.ts2-row[data-key]'));
  const flat = doc.createElement('div');
  flat.className = 'ts2-rows brief-people-flat';
  for (const row of allRows) {
    const key = row.getAttribute('data-key');
    const p = byKey.get(key);
    if (!p) continue;
    row.classList.add('brief-row');
    row.setAttribute('aria-expanded', 'false');
    row.dataset.briefKey = key;
    row.dataset.briefName = (p.label || '').toLowerCase();
    row.dataset.sortName = (p.label || '');
    row.dataset.sortToday = String((p.timelineToday || []).length);
    row.dataset.sortYest = String((p.timelineYesterday || []).length);
    row.dataset.sortWip = String((p.issuesNow || []).length);
    row.dataset.sortPr = String(p.badges?.pr48h || 0);
    row.dataset.sortTasks = String(p.contextSwitches?.distinctIssueKeys || 0);
    row.dataset.sortHours = String(((p.loggedTodaySec || 0) / 3600).toFixed(2));
    const detailRawHtml = renderEmployeeDetailPanel(model, key, { filters: { ...ALL_SRC_FILTERS } });
    const detailWrap = doc.createElement('div');
    detailWrap.className = 'brief-detail';
    detailWrap.hidden = true;
    detailWrap.dataset.detailFor = key;
    detailWrap.innerHTML = detailRawHtml;
    _stripRuntimeArtifacts(detailWrap);
    _trimDetailForBrief(detailWrap, p, doc);
    flat.appendChild(row);
    flat.appendChild(detailWrap);
  }
  return flat.outerHTML;
}

/**
 * Подгон контента detail-панели под формат брифа:
 *   1. Убираем ts2-panel-head (ФИО+3д тренд+email+CR/PR/cross-team — это
 *      уже видно в строке выше).
 *   2. Из нарратива выкидываем «Блокер: …» / «N блокеров: …» (тимлид и так
 *      увидит блокеры в LLM-сводке).
 *   3. В строке «Сегодня:» подставляем «(название задачи)» рядом с каждым
 *      ключом Jira.
 *   4. Убираем ts2-pm-section (метрики PROD/АКТИВ/CF/Z/J).
 *   5. Убираем «Старые задачи» (renderBlockersShelf).
 */
function _trimDetailForBrief(root, p, doc) {
  // 1. Шапка панели (имя + sub-meta + metric row).
  root.querySelectorAll('.ts2-panel-head').forEach(el => el.remove());
  // 2026-06-01 — «Сводка ассистента» — live-only фича (lazy LLM-fetch
  // при раскрытии). В standalone-брифе нет бэкенда, оставлять секцию
  // = врать «Раскройте — сгенерируется». Сносим целиком.
  root.querySelectorAll('.ts2-assistant-section').forEach(el => el.remove());
  // 4. Метрики сотрудника (Метрики сотрудника / клик по chip / PROD / АКТИВ / CF / Z / J).
  root.querySelectorAll('.ts2-pm-section').forEach(el => el.remove());
  // 5. Старые задачи (blockers shelf). Когда blockers непусто — это
  //    <details class="ts2-blockers-details">. Когда пусто, рендерер
  //    отдаёт обычную .ts2-panel-section с заголовком «Старые задачи».
  //    Сносим оба варианта по заголовку.
  root.querySelectorAll('.ts2-blockers-details').forEach(el => el.remove());
  root.querySelectorAll('.ts2-panel-section').forEach(sec => {
    const title = sec.querySelector('.ts2-panel-section-title');
    if (title && /старые задачи/i.test(title.textContent || '')) sec.remove();
  });
  // 2. Narrative-предложение про блокеры.
  root.querySelectorAll('.ts2-narrative-item').forEach(li => {
    const lab = li.querySelector('.ts2-narrative-label');
    if (lab && /блокер/i.test(lab.textContent || '')) li.remove();
  });
  // 3. «Сегодня:» — заменяем одну строку «через запятую» на список
  //    задач с полным названием. Перекомпонуем сами из participant'а.
  _rewriteTodayAsList(root, p, doc);
}

/**
 * Удаляет оригинальный narrative-item «Сегодня: …» (одной строкой через
 * запятую) и подставляет вместо него li со встроенным `<ul>`:
 *   · по одному пункту на каждую задачу (KEY — Полное название)
 *   · отдельные пункты на коммиты / PR за 48ч (если есть)
 * Без обрезки названий.
 */
function _rewriteTodayAsList(root, p, doc) {
  const list = root.querySelector('.ts2-narrative-list');
  if (!list) return;
  const items = Array.from(list.children).filter(li => li.classList.contains('ts2-narrative-item'));
  const todayLi = items.find(li => {
    const lab = li.querySelector('.ts2-narrative-label');
    return lab && /сегодня/i.test(lab.textContent || '');
  });
  // Если оригинальная строка «Сегодня тишина в Jira/BB.» — оставляем как есть.
  if (todayLi) {
    const txt = todayLi.querySelector('.ts2-narrative-text');
    if (!txt) return;
    // Если в строке нет ни одного Jira-ключа — это, скорее всего, plain
    // «тишина», тогда не трогаем.
    if (!todayLi.querySelector('a.ts2-issue-link')) return;
  }
  const keyToSummary = _buildKeyToSummaryMap(p);
  const todayEvents = (p.timelineToday || []);
  const wip = (p.issuesNow || []);
  const bb = (p.bbItems || []);
  // Уникальные ключи (WIP сначала, чтобы они шли первыми; потом today-events).
  const seen = new Set();
  const taskItems = [];
  for (const it of wip) {
    const k = String(it?.key || '').toUpperCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const sum = it.summary || keyToSummary.get(k) || '';
    taskItems.push({ key: k, summary: sum, status: it.status || '', source: 'wip' });
  }
  for (const e of todayEvents) {
    const k = String(e?.issue?.key || '').toUpperCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const sum = e.issue?.summary || keyToSummary.get(k) || '';
    taskItems.push({ key: k, summary: sum, status: '', source: 'touched' });
  }
  const commitsN = bb.filter(it => it.kind === 'commit' || !it.kind).length;
  const prN = bb.filter(it => it.kind === 'pr').length;
  if (taskItems.length === 0 && commitsN === 0 && prN === 0) return;
  const sublist = doc.createElement('ul');
  sublist.className = 'brief-today-list';
  for (const t of taskItems) {
    const li = doc.createElement('li');
    li.className = `brief-today-item brief-today-item-${t.source}`;
    const a = doc.createElement('a');
    a.className = 'ts2-issue-link jira-key-link';
    a.href = _jiraIssueHref(t.key);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = t.key;
    li.appendChild(a);
    if (t.summary) {
      li.appendChild(doc.createTextNode(` — ${t.summary}`));
    }
    if (t.status) {
      const st = doc.createElement('span');
      st.className = 'brief-today-status';
      st.textContent = ` · ${t.status}`;
      li.appendChild(st);
    }
    sublist.appendChild(li);
  }
  if (commitsN > 0) {
    const li = doc.createElement('li');
    li.className = 'brief-today-item brief-today-item-meta';
    li.textContent = `Коммитов за 48ч: ${commitsN}`;
    sublist.appendChild(li);
  }
  if (prN > 0) {
    const li = doc.createElement('li');
    li.className = 'brief-today-item brief-today-item-meta';
    li.textContent = `PR за 48ч: ${prN}`;
    sublist.appendChild(li);
  }
  // Заменяем оригинальный «Сегодня: …» на наш li с label + <ul>.
  const newLi = doc.createElement('li');
  newLi.className = 'ts2-narrative-item brief-today-block';
  const lab = doc.createElement('span');
  lab.className = 'ts2-narrative-label';
  lab.textContent = 'Сегодня:';
  newLi.appendChild(lab);
  newLi.appendChild(sublist);
  if (todayLi) todayLi.replaceWith(newLi);
  else list.insertBefore(newLi, list.firstChild);
}

function _jiraIssueHref(key) {
  // Тот же синтез, что в jiraIssueLink (но мы не дёргаем import чтобы
  // не плодить cyclic). Если значение из state недоступно — отдаём
  // относительную ссылку, чтобы хотя бы выглядела как ссылка.
  try {
    const base = (typeof window !== 'undefined' && window.location?.origin) || '';
    return `${base}/browse/${encodeURIComponent(key)}`;
  } catch (_) {
    return `#${key}`;
  }
}

function _buildKeyToSummaryMap(p) {
  const m = new Map();
  const put = (key, sum) => {
    const k = String(key || '').trim().toUpperCase();
    const s = String(sum || '').trim();
    if (!k || !s) return;
    if (!m.has(k)) m.set(k, s);
  };
  for (const it of (p.issuesNow || [])) put(it?.key, it?.summary);
  for (const b of (p.blockers || [])) put(b?.key, b?.summary);
  for (const lst of [p.timelineToday, p.timelineYesterday, p.timelinePrev]) {
    for (const e of (lst || [])) {
      const issue = e?.issue;
      if (!issue?.key) continue;
      put(issue.key, issue.summary || issue?.fields?.summary);
    }
  }
  return m;
}

function _truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

/**
 * Чистим panel-фрагмент от того, что в standalone HTML не имеет смысла
 * или ломает валидность из-за дублирования по N сотрудникам:
 *   · all id="…" — у нас N панелей, нельзя
 *   · кнопки «Закрыть / TG / Share / 1:1 / Copy / Back» — без JS бессмысленны
 *   · aria-modal / role="dialog" — это не модалка, а развёрнутая строка
 *   · кнопки «прыгнуть к группе» (data-jump-key) — некуда прыгать
 */
function _stripRuntimeArtifacts(root) {
  root.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  const killSelectors = [
    '.ts2-panel-close',
    '.ts2-panel-tgcopy',
    '.ts2-panel-share',
    '.ts2-panel-back',
    '.ts2-narrative-copy',
    '.ts2-detail-spawn-1on1',
    '.ts2-panel-metric-action',
    '[data-jump-key]',
    '[data-close-modal]',
    '[data-narrative-md]',
  ];
  for (const sel of killSelectors) {
    root.querySelectorAll(sel).forEach(el => el.remove());
  }
  root.querySelectorAll('.ts2-panel').forEach(el => {
    el.removeAttribute('role');
    el.removeAttribute('aria-modal');
    el.removeAttribute('aria-labelledby');
    el.removeAttribute('tabindex');
    el.classList.add('brief-panel-inline');
  });
  root.querySelectorAll('.ts2-panel-head-actions').forEach(el => {
    if (!el.children.length) el.remove();
  });
}

/* ── header / toolbar / sort bar ────────────────────────── */

function _buildHeader(model, teamLabel, generatedAt) {
  const sg = model?.scannerV2?.sprintGoal;
  const sprintLine = sg && sg.aggregateTotal > 0
    ? `<span class="brief-header-sprint">Спринт: ${_esc(sg.aggregateDone)}/${_esc(sg.aggregateTotal)} (${_esc(sg.aggregateProgress)}%)</span>`
    : '';
  const peopleCount = (model.participants || []).length;
  return `
    <header class="brief-header">
      <h1 class="brief-header-title">Бриф команды ${_esc(teamLabel)}</h1>
      <div class="brief-header-meta">
        <span class="brief-header-date">${_esc(_formatDate(generatedAt))}</span>
        <span class="brief-header-sep">·</span>
        <span class="brief-header-count">${peopleCount} ${_plural(peopleCount, ['сотрудник', 'сотрудника', 'сотрудников'])}</span>
        ${sprintLine ? `<span class="brief-header-sep">·</span>${sprintLine}` : ''}
      </div>
    </header>
  `;
}

function _buildToolbar() {
  return `
    <div class="brief-toolbar" role="toolbar" aria-label="Управление брифом">
      <input type="search" id="brief-search" class="brief-search" placeholder="Поиск по имени" autocomplete="off" aria-label="Поиск сотрудника по имени">
      <button type="button" class="brief-btn" id="brief-expand-all">Развернуть всё</button>
      <button type="button" class="brief-btn" id="brief-collapse-all">Свернуть всё</button>
      <div class="brief-toolbar-spacer"></div>
      <button type="button" class="brief-btn brief-theme-btn" id="brief-theme-toggle" aria-label="Переключить тему" title="Светлая ↔ тёмная">
        <span class="brief-theme-icon" aria-hidden="true">☾</span><span class="brief-theme-label"> Тёмная</span>
      </button>
    </div>
  `;
}

function _buildSortBar() {
  const opts = [
    { id: 'name', label: 'Имя' },
    { id: 'today', label: 'Сегодня' },
    { id: 'yest', label: 'Вчера' },
    { id: 'wip', label: 'WIP' },
    { id: 'pr', label: 'PR' },
    { id: 'tasks', label: 'Задач' },
    { id: 'hours', label: 'Часов' },
  ];
  return `
    <div class="brief-sortbar" role="group" aria-label="Сортировка внутри групп">
      <span class="brief-sortbar-label">Сортировка:</span>
      ${opts.map(o => `<button type="button" class="brief-sort-btn" data-brief-sort="${o.id}" data-brief-dir="">${_esc(o.label)} <span class="brief-sort-arrow" aria-hidden="true">↕</span></button>`).join('')}
    </div>
  `;
}

/* ── CSS collection: pull from current document, filter by token ─── */

function _collectScopedCss() {
  if (typeof document === 'undefined' || !document.styleSheets) return '';
  const chunks = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules = null;
    try { rules = sheet.cssRules; } catch (_) { rules = null; }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      const text = _ruleTextFiltered(rule);
      if (text) chunks.push(text);
    }
  }
  return chunks.join('\n');
}

function _ruleTextFiltered(rule) {
  const T = (typeof CSSRule !== 'undefined') ? CSSRule : null;
  // @-rules: keep keyframes, font-face, supports, и media wrapper'ы (рекурсивно).
  if (T && rule.type === T.KEYFRAMES_RULE)  return rule.cssText;
  if (T && rule.type === T.FONT_FACE_RULE)  return rule.cssText;
  if (T && rule.type === T.SUPPORTS_RULE)   return rule.cssText;
  if (T && rule.type === T.MEDIA_RULE) {
    const inner = Array.from(rule.cssRules).map(_ruleTextFiltered).filter(Boolean).join('\n');
    if (!inner) return '';
    return `@media ${rule.media.mediaText} {\n${inner}\n}`;
  }
  // Style rule: keep, если в selectorText есть один из ts2-/pz-/pp-/brief-/btn-icon,
  // либо это «корневые» :root / html / body / *.
  if (T && rule.type === T.STYLE_RULE) {
    const sel = String(rule.selectorText || '');
    if (!sel) return '';
    if (_isRootSelector(sel)) return rule.cssText;
    for (const t of CSS_KEEP_TOKENS) {
      if (sel.includes(t)) return rule.cssText;
    }
    return '';
  }
  return '';
}

function _isRootSelector(sel) {
  const s = sel.trim();
  if (s === ':root' || s === 'html' || s === 'body' || s === '*' || s === ':root, body') return true;
  // частые комбинированные варианты: «:root, body», «html, body»
  if (/^:root\b/.test(s)) return true;
  if (/^html\b/.test(s) && !s.includes(' ')) return true;
  if (/^body\b/.test(s) && !s.includes(' ')) return true;
  // [data-theme="…"] / :root[data-theme="…"] — корневые селекторы для CSS
  // переменных темы; обязательны, чтобы toggle светлая↔тёмная работал.
  if (s.includes('[data-theme=')) return true;
  return false;
}

/* ── document assembly ──────────────────────────────────── */

function _assembleHtmlDocument({ title, css, bodyHtml, inlineJs }) {
  // Overrides поверх scoped CSS: панель «модалки» внутри брифа должна быть
  // обычным блоком, без position:fixed/slide-in. Плюс минимальный layout.
  const briefOwnCss = `
    html, body { margin: 0; padding: 0; }
    body { background: var(--prizma-bg, #FAFAF8); color: var(--prizma-text-primary, #1A1A22); font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .brief-shell { max-width: 1280px; margin: 0 auto; padding: 16px 24px 64px; }
    .brief-header { padding: 12px 0 16px; border-bottom: 1px solid var(--prizma-border, #E5E0D5); margin-bottom: 12px; }
    .brief-header-title { font-size: 22px; margin: 0 0 6px; font-weight: 600; }
    .brief-header-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12px; color: var(--prizma-text-secondary, #555); }
    .brief-header-sep { opacity: .4; }

    .brief-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 0; }
    .brief-toolbar-spacer { flex: 1 1 auto; }
    .brief-search { padding: 6px 10px; border: 1px solid var(--prizma-border, #E5E0D5); border-radius: 8px; min-width: 220px; font-size: 13px; background: var(--prizma-bg-elevated, #fff); color: inherit; }
    .brief-btn { padding: 5px 10px; border: 1px solid var(--prizma-border, #E5E0D5); border-radius: 8px; background: var(--prizma-bg-elevated, #fff); font-size: 12px; cursor: pointer; color: inherit; }
    .brief-btn:hover { background: var(--prizma-bg-tertiary, #F0EDE5); }
    .brief-theme-btn { display: inline-flex; align-items: center; gap: 2px; }
    .brief-theme-icon { font-size: 14px; line-height: 1; }

    .brief-sortbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px 0 12px; font-size: 12px; }
    .brief-sortbar-label { color: var(--prizma-text-secondary, #555); margin-right: 4px; }
    .brief-sort-btn { padding: 4px 8px; border: 1px solid var(--prizma-border, #E5E0D5); border-radius: 6px; background: var(--prizma-bg-elevated, #fff); cursor: pointer; font-size: 12px; color: inherit; }
    .brief-sort-btn[data-brief-dir="asc"]  .brief-sort-arrow::before { content: "↑"; }
    .brief-sort-btn[data-brief-dir="desc"] .brief-sort-arrow::before { content: "↓"; }
    .brief-sort-btn[data-brief-dir="asc"], .brief-sort-btn[data-brief-dir="desc"] { background: var(--prizma-bg-tertiary, #F0EDE5); font-weight: 600; }

    .brief-row { cursor: pointer; position: relative; }
    .brief-row[aria-expanded="true"] { background: var(--prizma-bg-tertiary, #F0EDE5); }
    .brief-row .ts2-chev { transition: transform .15s ease; }
    .brief-row.brief-row-expanded .ts2-chev { transform: rotate(90deg); }
    /* «N в пути» — первый счётчик ряда. WIP видно в развёрнутой карточке,
       в самой строке загромождает. */
    .brief-row .ts2-counters > :first-child { display: none !important; }

    .brief-detail { margin: 4px 0 12px; padding: 4px 12px 12px; border-left: 3px solid var(--prizma-information, #6EC1E4); background: var(--prizma-bg-elevated, #fff); border-radius: 0 8px 8px 0; }
    .brief-detail[hidden] { display: none; }
    .brief-panel-inline,
    .ts2-panel.ts2-panel-modal.brief-panel-inline { position: static !important; transform: none !important; box-shadow: none !important; max-width: none !important; width: auto !important; height: auto !important; max-height: none !important; padding: 8px 0 !important; overflow: visible !important; background: transparent !important; border: none !important; }
    .brief-panel-inline .ts2-panel-head { padding-top: 0; }

    .brief-today-block { display: block; margin: 4px 0; }
    .brief-today-list { margin: 4px 0 0; padding-left: 18px; list-style: disc; }
    .brief-today-item { margin: 2px 0; line-height: 1.5; }
    .brief-today-item .ts2-issue-link { font-weight: 600; }
    .brief-today-status { color: var(--prizma-text-secondary, #555); font-size: 12px; }
    .brief-today-item-meta { color: var(--prizma-text-secondary, #555); list-style: none; margin-left: -18px; }
    .brief-today-item-meta::before { content: "·"; margin-right: 6px; opacity: .6; }

  `;
  return `<!DOCTYPE html>
<html lang="ru" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${_esc(title)}</title>
<style>
${css}
${briefOwnCss}
</style>
</head>
<body>
${bodyHtml}
<script>
${inlineJs}
</script>
</body>
</html>
`;
}

/* ── inline JS for interactivity ─────────────────────────── */

function _briefInlineJs() {
  // ВНИМАНИЕ: это код для standalone-страницы. Не использует ESM-импорты.
  return `(function () {
  'use strict';
  var doc = document;
  var root = doc.documentElement;
  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }

  function detailFor(key) {
    var all = $$('.brief-detail');
    for (var i = 0; i < all.length; i++) if (all[i].dataset.detailFor === key) return all[i];
    return null;
  }

  function setRowOpen(row, open) {
    var det = detailFor(row.dataset.briefKey);
    if (!det) return;
    det.hidden = !open;
    if (open) row.classList.add('brief-row-expanded'); else row.classList.remove('brief-row-expanded');
    row.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  // 1. Toggle on row click
  $$('.brief-row').forEach(function (row) {
    row.addEventListener('click', function (e) {
      if (e.target.closest('a, button, input, textarea, select, summary')) return;
      var det = detailFor(row.dataset.briefKey);
      if (!det) return;
      setRowOpen(row, !!det.hidden);
    });
    row.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target.closest('a, button, input, textarea, select, summary')) return;
        e.preventDefault();
        var det = detailFor(row.dataset.briefKey);
        if (!det) return;
        setRowOpen(row, !!det.hidden);
      }
    });
  });

  // 2. Expand-all / collapse-all
  var ea = $('#brief-expand-all');
  if (ea) ea.addEventListener('click', function () {
    $$('.brief-row').forEach(function (r) { setRowOpen(r, true); });
  });
  var ca = $('#brief-collapse-all');
  if (ca) ca.addEventListener('click', function () {
    $$('.brief-row').forEach(function (r) { setRowOpen(r, false); });
  });

  // 3. Search by name
  var search = $('#brief-search');
  if (search) search.addEventListener('input', function () {
    var q = (search.value || '').toLowerCase().trim();
    $$('.brief-row').forEach(function (r) {
      var name = r.dataset.briefName || '';
      var match = !q || name.indexOf(q) !== -1;
      r.style.display = match ? '' : 'none';
      var det = detailFor(r.dataset.briefKey);
      if (det && !match) { det.hidden = true; det.style.display = 'none'; r.classList.remove('brief-row-expanded'); }
      else if (det) { det.style.display = ''; }
    });
  });

  // 4. Sort over single flat container
  $$('.brief-sort-btn[data-brief-sort]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var by = btn.dataset.briefSort;
      var dir = btn.dataset.briefDir === 'asc' ? 'desc' : 'asc';
      $$('.brief-sort-btn').forEach(function (b) { if (b !== btn) b.dataset.briefDir = ''; });
      btn.dataset.briefDir = dir;
      var container = $('.brief-people-flat');
      if (!container) return;
      var items = [];
      var kids = Array.prototype.slice.call(container.children);
      for (var i = 0; i < kids.length; i++) {
        var el = kids[i];
        if (el.classList && el.classList.contains('brief-row')) {
          var nxt = kids[i + 1];
          var det = (nxt && nxt.classList && nxt.classList.contains('brief-detail')) ? nxt : null;
          items.push({ row: el, detail: det });
        }
      }
      items.sort(function (a, b) {
        if (by === 'name') {
          var an = a.row.dataset.sortName || '';
          var bn = b.row.dataset.sortName || '';
          return dir === 'asc' ? an.localeCompare(bn, 'ru') : bn.localeCompare(an, 'ru');
        }
        var keyMap = { today: 'sortToday', yest: 'sortYest', wip: 'sortWip', pr: 'sortPr', tasks: 'sortTasks', hours: 'sortHours' };
        var dsKey = keyMap[by];
        var av = parseFloat(a.row.dataset[dsKey] || '0') || 0;
        var bv = parseFloat(b.row.dataset[dsKey] || '0') || 0;
        return dir === 'asc' ? av - bv : bv - av;
      });
      items.forEach(function (it) {
        container.appendChild(it.row);
        if (it.detail) container.appendChild(it.detail);
      });
    });
  });

  // 5. Theme toggle (light default, persist в localStorage briefTheme)
  var themeBtn = $('#brief-theme-toggle');
  function updateThemeBtn(theme) {
    if (!themeBtn) return;
    var isLight = theme === 'light';
    var icon = themeBtn.querySelector('.brief-theme-icon');
    var label = themeBtn.querySelector('.brief-theme-label');
    if (icon)  icon.textContent  = isLight ? '\\u263E' : '\\u2600';
    if (label) label.textContent = isLight ? ' Тёмная' : ' Светлая';
    themeBtn.setAttribute('aria-pressed', isLight ? 'false' : 'true');
  }
  try {
    var saved = localStorage.getItem('briefTheme');
    if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
  } catch (_) {}
  updateThemeBtn(root.getAttribute('data-theme') || 'light');
  if (themeBtn) themeBtn.addEventListener('click', function () {
    var current = root.getAttribute('data-theme') || 'light';
    var next = current === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('briefTheme', next); } catch (_) {}
    updateThemeBtn(next);
  });
})();
`;
}

/* ── small utils ─────────────────────────────────────────── */

function _downloadFile(html, filename) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function _slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'team';
}

function _dateStamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function _formatDate(d) {
  return d.toLocaleString('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function _esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _plural(n, forms) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}
