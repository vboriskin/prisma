'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — BRIEF EXPORT
   Standalone HTML «бриф» команды: одна команда — одна .html-страница.

   Сохраняет ТОТ ЖЕ визуал, что и в Сканнере (вытягивает CSS из
   document.styleSheets), плюс добавляет inline JS для:
     · разворачивания каждой строки в полную карточку сотрудника
     · поиска по имени
     · фильтра по группам (stop/watch/moving/idle)
     · сортировки внутри групп
     · «развернуть всё / свернуть всё»

   Содержимое разворачиваемой части = вывод renderEmployeeDetailPanel,
   пост-обработанный: убираем кнопки «Закрыть / TG / Share / 1:1 / Copy»
   и runtime-id'шники (id="ts2-panel-main" и т.д.), которые после
   дублирования по N сотрудникам сломали бы валидность HTML.

   Экспорт: Blob + <a download> (тот же приём, что в _performExport).
   ============================================================ */

import { renderEmployeeDetailPanel } from './teamScanner2Renderer.js';
import { renderPersonRows } from './teamScanner2RendererPersonRows.js';
import { classifyPerson } from './teamScanner2Classifier.js';
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
    // Без DOM (например, jsdom без правильного флага) — отдадим как есть.
    return rawRowsHtml;
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<!DOCTYPE html><body><div id="wrap">${rawRowsHtml}</div></body>`, 'text/html');
  const wrap = doc.getElementById('wrap');
  if (!wrap) return rawRowsHtml;
  const byKey = new Map();
  for (const p of model.participants) byKey.set(p.key, p);
  const rows = wrap.querySelectorAll('.ts2-row[data-key]');
  rows.forEach(row => {
    const key = row.getAttribute('data-key');
    const p = byKey.get(key);
    if (!p) return;
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
    row.parentNode.insertBefore(detailWrap, row.nextSibling);
  });
  return wrap.innerHTML;
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
  const groupCounts = _countGroups(model.participants);
  return `
    <header class="brief-header">
      <h1 class="brief-header-title">Бриф команды ${_esc(teamLabel)}</h1>
      <div class="brief-header-meta">
        <span class="brief-header-date">${_esc(_formatDate(generatedAt))}</span>
        <span class="brief-header-sep">·</span>
        <span class="brief-header-count">${peopleCount} ${_plural(peopleCount, ['сотрудник', 'сотрудника', 'сотрудников'])}</span>
        ${sprintLine ? `<span class="brief-header-sep">·</span>${sprintLine}` : ''}
      </div>
      <div class="brief-header-groups">
        <span class="brief-group-stat brief-group-stop"><strong>${groupCounts.stop}</strong> требуют внимания</span>
        <span class="brief-group-stat brief-group-watch"><strong>${groupCounts.watch}</strong> под наблюдением</span>
        <span class="brief-group-stat brief-group-moving"><strong>${groupCounts.moving}</strong> движется</span>
        <span class="brief-group-stat brief-group-idle"><strong>${groupCounts.idle}</strong> без активности</span>
      </div>
    </header>
  `;
}

function _buildToolbar() {
  return `
    <div class="brief-toolbar" role="toolbar" aria-label="Управление брифом">
      <input type="search" id="brief-search" class="brief-search" placeholder="Поиск по имени" autocomplete="off" aria-label="Поиск сотрудника по имени">
      <div class="brief-chips" role="group" aria-label="Фильтр групп">
        <button type="button" class="brief-chip brief-chip-stop" data-brief-group="stop" aria-pressed="true">Требуют внимания</button>
        <button type="button" class="brief-chip brief-chip-watch" data-brief-group="watch" aria-pressed="true">Наблюдение</button>
        <button type="button" class="brief-chip brief-chip-moving" data-brief-group="moving" aria-pressed="true">Движется</button>
        <button type="button" class="brief-chip brief-chip-idle" data-brief-group="idle" aria-pressed="true">Без активности</button>
      </div>
      <div class="brief-toolbar-spacer"></div>
      <button type="button" class="brief-btn" id="brief-expand-all">Развернуть всё</button>
      <button type="button" class="brief-btn" id="brief-collapse-all">Свернуть всё</button>
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
    .brief-header-meta, .brief-header-groups { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12px; color: var(--prizma-text-secondary, #555); }
    .brief-header-groups { margin-top: 6px; }
    .brief-header-sep { opacity: .4; }
    .brief-group-stat { padding: 2px 8px; border-radius: 10px; background: var(--prizma-bg-tertiary, #F0EDE5); }
    .brief-group-stop strong  { color: var(--prizma-off-course, #C03030); }
    .brief-group-watch strong { color: var(--prizma-drift, #B86A00); }
    .brief-group-moving strong{ color: var(--prizma-on-course, #1B7A3E); }
    .brief-group-idle strong  { color: var(--prizma-text-tertiary, #999); }

    .brief-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 0; }
    .brief-toolbar-spacer { flex: 1 1 auto; }
    .brief-search { padding: 6px 10px; border: 1px solid var(--prizma-border, #E5E0D5); border-radius: 8px; min-width: 220px; font-size: 13px; background: var(--prizma-bg-elevated, #fff); color: inherit; }
    .brief-chip { padding: 4px 10px; border: 1px solid var(--prizma-border, #E5E0D5); border-radius: 12px; background: var(--prizma-bg-elevated, #fff); font-size: 12px; cursor: pointer; color: inherit; }
    .brief-chip[aria-pressed="false"], .brief-chip.brief-chip-off { opacity: .45; text-decoration: line-through; }
    .brief-chip-stop[aria-pressed="true"]   { box-shadow: inset 3px 0 0 var(--prizma-off-course, #C03030); }
    .brief-chip-watch[aria-pressed="true"]  { box-shadow: inset 3px 0 0 var(--prizma-drift, #B86A00); }
    .brief-chip-moving[aria-pressed="true"] { box-shadow: inset 3px 0 0 var(--prizma-on-course, #1B7A3E); }
    .brief-chip-idle[aria-pressed="true"]   { box-shadow: inset 3px 0 0 var(--prizma-text-tertiary, #999); }
    .brief-btn { padding: 5px 10px; border: 1px solid var(--prizma-border, #E5E0D5); border-radius: 8px; background: var(--prizma-bg-elevated, #fff); font-size: 12px; cursor: pointer; color: inherit; }
    .brief-btn:hover, .brief-chip:hover { background: var(--prizma-bg-tertiary, #F0EDE5); }

    .brief-sortbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px 0 12px; font-size: 12px; }
    .brief-sortbar-label { color: var(--prizma-text-secondary, #555); margin-right: 4px; }
    .brief-sort-btn { padding: 4px 8px; border: 1px solid var(--prizma-border, #E5E0D5); border-radius: 6px; background: var(--prizma-bg-elevated, #fff); cursor: pointer; font-size: 12px; color: inherit; }
    .brief-sort-btn[data-brief-dir="asc"]  .brief-sort-arrow::before { content: "↑"; }
    .brief-sort-btn[data-brief-dir="desc"] .brief-sort-arrow::before { content: "↓"; }
    .brief-sort-btn[data-brief-dir="asc"], .brief-sort-btn[data-brief-dir="desc"] { background: var(--prizma-bg-tertiary, #F0EDE5); font-weight: 600; }

    .brief-row { cursor: pointer; position: relative; }
    .brief-row::after { content: ""; position: absolute; right: 8px; top: 50%; width: 8px; height: 8px; border-right: 1.5px solid var(--prizma-text-tertiary, #999); border-bottom: 1.5px solid var(--prizma-text-tertiary, #999); transform: translateY(-65%) rotate(45deg); transition: transform .15s; opacity: .6; pointer-events: none; }
    .brief-row.brief-row-expanded::after { transform: translateY(-25%) rotate(-135deg); opacity: 1; }
    .brief-row[aria-expanded="true"] { background: var(--prizma-bg-tertiary, #F0EDE5); }

    .brief-detail { margin: 4px 0 12px; padding: 4px 12px 12px; border-left: 3px solid var(--prizma-information, #6EC1E4); background: var(--prizma-bg-elevated, #fff); border-radius: 0 8px 8px 0; }
    .brief-detail[hidden] { display: none; }
    .brief-panel-inline { position: static !important; transform: none !important; box-shadow: none !important; max-width: none !important; width: auto !important; height: auto !important; max-height: none !important; padding: 8px 0 !important; overflow: visible !important; background: transparent !important; border: none !important; }
    .brief-panel-inline .ts2-panel-head { padding-top: 0; }
  `;
  return `<!DOCTYPE html>
<html lang="ru">
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

  // 4. Status filter chips (toggle group visibility)
  $$('.brief-chip[data-brief-group]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var g = chip.dataset.briefGroup;
      var pressed = chip.getAttribute('aria-pressed') !== 'false';
      var next = !pressed;
      chip.setAttribute('aria-pressed', next ? 'true' : 'false');
      var grp = $('[data-group-anchor="' + g + '"]');
      if (grp) grp.style.display = next ? '' : 'none';
    });
  });

  // 5. Sort within each group
  $$('.brief-sort-btn[data-brief-sort]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var by = btn.dataset.briefSort;
      var dir = btn.dataset.briefDir === 'asc' ? 'desc' : 'asc';
      $$('.brief-sort-btn').forEach(function (b) { if (b !== btn) b.dataset.briefDir = ''; });
      btn.dataset.briefDir = dir;
      var groups = $$('[data-group-anchor]');
      groups.forEach(function (grpEl) {
        var inner = grpEl.querySelector('.ts2-rows-inner') || grpEl;
        var items = [];
        var kids = Array.prototype.slice.call(inner.children);
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
          inner.appendChild(it.row);
          if (it.detail) inner.appendChild(it.detail);
        });
      });
    });
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

function _countGroups(parts) {
  const counts = { stop: 0, watch: 0, moving: 0, idle: 0 };
  for (const p of parts || []) {
    const g = classifyPerson(p);
    if (counts[g] != null) counts[g]++;
  }
  return counts;
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
