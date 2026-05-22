'use strict';
/* ============================================================
   GANTT — AUX MODULE  (V18.3 B1 partial split)

   4 self-contained method'а, вынесенных из views/gantt.js (1692 LOC
   renderDetailedTasks остаётся там как был — слишком closure-heavy
   для безопасного split'а в V18.3, отложено в V19).

   Все 4 метода НЕ читают / НЕ пишут closure state'а из gantt.js;
   зависимости — pure imports + explicit callbacks.

   Public exports:
     openHistoryModal()             — show «История изменений Ганта» modal
     openAddEpicModal(presetTeam, opts)  — opts.onCreated callback вместо
                                            прямого GanttView.renderChart()
     bindFastTooltip(wrap, state)   — state = { bound: bool } для once-flag
     drawPostponeArrows(wrap)       — pure, рисует SVG-стрелки переносов
   ============================================================ */

import { state }       from '../../state.js';
import { Utils }       from '../../utils.js';
import { RowFactory }  from '../../rowFactory.js';
import { RiskEngine }  from '../../riskEngine.js';
import { Storage }     from '../../dataStore.js';
import { FocusTrap }   from '../../app/uxKit.js';
import { Services }    from '../../app/services.js';
import { attachAutocomplete } from '../../components/textAutocomplete.js';
import { getUniqueTagValues } from '../../components/tagInput.js';
import {
  SCOPE_OPTIONS, WORK_TYPES, PHASE_COLORS,
  PHASE_COLOR_TOKENS, PHASE_COLOR_TOKEN_FALLBACK,
} from '../../constants.js';

/* V21 — общий шаблон close-button SVG (как в статических modal'ах в
   index.html). Используется в openHistoryModal / openAddEpicModal. */
const _CLOSE_BTN_HTML = `<button class="modal-close-btn" type="button" aria-label="Закрыть" title="Закрыть" data-close-modal>
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
</button>`;

/* ────────────────────────────────────────────────────────── */
/* History modal                                              */
/* ────────────────────────────────────────────────────────── */

export function openHistoryModal() {
  const log = Array.isArray(state.actionLog) ? state.actionLog : [];
  // Фильтр: записи, относящиеся к Ганту по type или category=='gantt'.
  const GANTT_PATTERNS = /^(assign_pill|unassign_pill|set_dates|move|move_back|undo|redo|checkpoint|plan_lock|edit_mode|delete|add_type|drop|drag|trail|epic_add|epic_)/i;
  const ganttEntries = log.filter(e => {
    if (!e) return false;
    if (e.category === 'gantt') return true;
    if (GANTT_PATTERNS.test(String(e.type || ''))) return true;
    const lbl = String(e.label || '').toLowerCase();
    return /колодц|пилюл|релиз 1\.|перенос|план|эпик|гант/i.test(lbl);
  });
  const escH = Utils.escapeHtml;
  const fmtTime = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    } catch(_) { return iso; }
  };
  const rowsHtml = ganttEntries.length
    ? ganttEntries.slice(0, 500).map(e => `
        <tr>
          <td class="gdt-hist-time">${escH(fmtTime(e.at))}</td>
          <td class="gdt-hist-type"><span class="gdt-hist-pill">${escH(e.type || '—')}</span></td>
          <td class="gdt-hist-label">${escH(e.label || '')}</td>
          <td class="gdt-hist-source">${escH(e.source || '')}</td>
        </tr>`).join('')
    : `<tr><td colspan="4" class="gdt-hist-empty">Нет записей в истории Ганта</td></tr>`;
  // V17.1.1 — переписано под существующий шаблон (`.modal-box` + inline body padding).
  // V21 — добавлены role/aria/FocusTrap (раньше отсутствовали — фокус «утекал»).
  const html = `
    <div class="modal-overlay" id="modal-gantt-history" role="dialog" aria-modal="true" aria-labelledby="modal-gantt-history-title">
      <div class="modal-box modal-box-wide">
        <div class="modal-header">
          <h3 id="modal-gantt-history-title">История изменений Ганта</h3>
          ${_CLOSE_BTN_HTML}
        </div>
        <div class="ae-modal-body">
          <div class="gdt-hist-meta">Показано записей: ${ganttEntries.length}</div>
          <div class="gdt-hist-table-wrap">
            <table class="gdt-hist-table">
              <thead><tr><th>Время</th><th>Тип</th><th>Описание</th><th>Источник</th></tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
  document.getElementById('modal-gantt-history')?.remove();
  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-gantt-history');
  let detachTrap = null;
  try { detachTrap = FocusTrap.attach(overlay, { initialFocus: overlay.querySelector('h3') }); } catch (_) {}
  const close = () => { try { detachTrap?.(); } catch (_) {} overlay?.remove(); };
  overlay?.addEventListener('click', (ev) => { if (ev.target === overlay || ev.target.closest('[data-close-modal]')) close(); });
  document.addEventListener('keydown', function escClose(ev){ if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); } });
}

/* ────────────────────────────────────────────────────────── */
/* Add Epic modal                                             */
/* ────────────────────────────────────────────────────────── */

/**
 * V17.1 C13 — «Добавить эпик» modal. После сохранения вызывается
 * opts.onCreated() callback (caller передаёт GanttView.renderChart()).
 * Это убирает direct GanttView reference из aux-модуля.
 */
export function openAddEpicModal(presetTeam, opts = {}) {
  const onCreated = typeof opts.onCreated === 'function' ? opts.onCreated : () => {};
  const escH = Utils.escapeHtml;
  const allTeams = Utils.unique(state.rows.map(r => r.team).filter(Boolean));
  if (presetTeam && !allTeams.includes(presetTeam)) allTeams.unshift(presetTeam);
  const wtList = Array.isArray(WORK_TYPES) ? WORK_TYPES : [];
  const releases = ['1.20','1.21','1.22','overtime'];
  const releaseLabel = { '1.20':'Релиз 1.20', '1.21':'Релиз 1.21', '1.22':'Релиз 1.22', 'overtime':'Овертайм' };
  const html = `
    <div class="modal-overlay" id="modal-gantt-add-epic" role="dialog" aria-modal="true" aria-labelledby="modal-gantt-add-epic-title">
      <div class="modal-box modal-box-wide ae-modal-box">
        <div class="modal-header">
          <h3 id="modal-gantt-add-epic-title">Добавить эпик</h3>
          ${_CLOSE_BTN_HTML}
        </div>
        <div class="ae-modal-body">
          <div class="form-grid">
            <label class="form-row">
              <span class="form-label">Команда</span>
              <input id="ae-team" class="form-input" placeholder="Команда…" autocomplete="off" value="${escH(presetTeam || '')}">
            </label>
            <label class="form-row">
              <span class="form-label">Эпик</span>
              <input id="ae-epic" class="form-input" placeholder="Название эпика…" autocomplete="off" autofocus>
            </label>
            <label class="form-row">
              <span class="form-label">Категория / тэги</span>
              <input id="ae-category" class="form-input" placeholder="Например: BE, FE, QA" autocomplete="off">
            </label>
            <label class="form-row">
              <span class="form-label">Scope</span>
              <select id="ae-scope" class="form-input">
                ${(SCOPE_OPTIONS || ['Да','Нет','Требует подтверждения']).map(s => `<option value="${escH(s)}">${escH(s)}</option>`).join('')}
              </select>
            </label>
            <label class="form-row">
              <span class="form-label">Релиз</span>
              <select id="ae-release" class="form-input">
                ${releases.map(r => `<option value="${escH(r)}">${escH(releaseLabel[r])}</option>`).join('')}
              </select>
            </label>
            <fieldset class="form-row">
              <legend class="form-label">Типы работ</legend>
              <div class="ae-wt-list">
                ${wtList.map(w => `<label class="ae-wt-item"><input type="checkbox" value="${escH(w)}"> ${escH(w)}</label>`).join('')}
              </div>
            </fieldset>
            <label class="form-row">
              <span class="form-label">Зависимости (через запятую)</span>
              <input id="ae-deps" class="form-input" placeholder="Например: SBOF-101, SBOF-102" autocomplete="off">
            </label>
            <label class="form-row form-row-checkbox">
              <input type="checkbox" id="ae-blocking">
              <span>Блокирующая зависимость (deadline-критична)</span>
            </label>
            <label class="form-row">
              <span class="form-label">Комментарий</span>
              <textarea id="ae-comment" class="form-input" rows="2" placeholder="Дополнительный контекст…"></textarea>
            </label>
          </div>
        </div>
        <div class="ae-modal-footer">
          <button class="btn btn-outline btn-sm" data-close-modal>Отмена</button>
          <button class="btn btn-primary btn-sm" id="ae-save">Сохранить</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modal-gantt-add-epic')?.remove();
  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-gantt-add-epic');
  // V21 — FocusTrap.attach с initialFocus на «Эпик» input (autofocus уже стоит,
  // FocusTrap reinforces) — фокус не утечёт за пределы модалки при Tab.
  let detachTrap = null;
  try { detachTrap = FocusTrap.attach(overlay, { initialFocus: overlay.querySelector('#ae-epic') }); } catch (_) {}
  const cleanups = [];
  const teamInput = document.getElementById('ae-team');
  const epicInput = document.getElementById('ae-epic');
  const catInput  = document.getElementById('ae-category');
  const depsInput = document.getElementById('ae-deps');
  if (teamInput) cleanups.push(attachAutocomplete(teamInput, () => Utils.unique(state.rows.map(r => r.team).filter(Boolean))));
  if (epicInput) cleanups.push(attachAutocomplete(epicInput, () => Utils.unique(state.rows.map(r => r.epic).filter(Boolean))));
  if (catInput)  cleanups.push(attachAutocomplete(catInput,  () => getUniqueTagValues('category')));
  if (depsInput) cleanups.push(attachAutocomplete(depsInput, () => Utils.unique(state.rows.map(r => r.epic).filter(Boolean))));
  const close = () => {
    cleanups.forEach(fn => { try { fn(); } catch (_) {} });
    try { detachTrap?.(); } catch (_) {}
    overlay?.remove();
  };
  overlay?.addEventListener('click', (ev) => {
    if (ev.target === overlay || ev.target.closest?.('[data-close-modal]')) close();
  });
  document.addEventListener('keydown', function esc(ev){ if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  document.getElementById('ae-save').addEventListener('click', () => {
    const team = (document.getElementById('ae-team').value || '').trim();
    const epic = (document.getElementById('ae-epic').value || '').trim();
    if (!team || !epic) {
      window.showToast?.('Команда и эпик — обязательные поля', 'warning', 1800);
      return;
    }
    const category = (document.getElementById('ae-category').value || '').trim();
    const scope = document.getElementById('ae-scope').value || '';
    const release = document.getElementById('ae-release').value || '';
    const wts = Array.from(overlay.querySelectorAll('.ae-wt-item input:checked')).map(c => c.value);
    const deps = (document.getElementById('ae-deps').value || '').trim();
    const blocking = !!document.getElementById('ae-blocking').checked;
    const comment = (document.getElementById('ae-comment').value || '').trim();
    const fieldByRel = { '1.20':'release120Types', '1.21':'release121Types', '1.22':'release122Types', 'overtime':'overtimeTypes' };
    const seed = { team, epic, category, tags: category, scopeStatus: scope, taskComment: comment, blockingDependency: blocking, dependencies: deps };
    if (release && fieldByRel[release]) seed[fieldByRel[release]] = wts;
    else seed.backlogTypes = wts;
    Services.HistoryManager?.checkpoint?.(`добавить эпик «${epic}» в ${team}`);
    const newRow = RowFactory.create(seed);
    RowFactory.updateDerived(newRow);
    state.rows = [...state.rows, newRow];
    try { RiskEngine.computeAll(); } catch(_) {}
    Storage.save();
    try { window.HistoryLog?.data?.('epic_add', `Добавлен эпик «${epic}» в команду ${team}`, { rowId: newRow.id, team, epic }); } catch(_) {}
    try { Services.App?.populateFilterDropdowns?.(); } catch(_) {}
    close();
    onCreated();
    window.showToast?.(`Эпик «${epic}» добавлен в ${team}`, 'success', 1800);
  });
}

/* ────────────────────────────────────────────────────────── */
/* Fast tooltip                                                */
/* ────────────────────────────────────────────────────────── */

/**
 * Bind global fast-tooltip handler to wrap. once-flag хранится в
 * `boundState` (объект с .bound mutable bool) — caller передаёт ref.
 * До split'а этот once-flag был GanttView._fastTipBound.
 */
export function bindFastTooltip(wrap, boundState) {
  if (boundState?.bound) return;
  if (boundState) boundState.bound = true;
  let el = null;
  let timer = null;
  // AUDIT_HOLISTIC O10 — все стили fast-tooltip перенесены в styles.css
  // (`.gdt-fasttip` rule). Здесь — только element creation + variables.
  const ensureEl = () => {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'gdt-fasttip';
    document.body.appendChild(el);
    return el;
  };
  const place = (target) => {
    const txt = target.dataset.tip;
    if (!txt) return;
    const node = ensureEl();
    node.textContent = txt;
    node.classList.add('is-visible');
    // Position above target, centered. Flip below if it would clip the top.
    const r = target.getBoundingClientRect();
    const tipR = node.getBoundingClientRect();
    let left = Math.round(r.left + r.width / 2 - tipR.width / 2);
    left = Math.max(8, Math.min(left, window.innerWidth - tipR.width - 8));
    let top = Math.round(r.top - tipR.height - 8);
    if (top < 8) top = Math.round(r.bottom + 8);   // flip
    node.style.setProperty('--prizma-tip-x', left + 'px');
    node.style.setProperty('--prizma-tip-y', top + 'px');
  };
  const hide = () => {
    clearTimeout(timer); timer = null;
    if (el) el.classList.remove('is-visible');
  };
  wrap.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t) return;
    clearTimeout(timer);
    timer = setTimeout(() => place(t), 200);
  });
  wrap.addEventListener('mouseout', (e) => {
    if (e.target.closest('[data-tip]')) hide();
  });
  // Edge cases — scroll, drag, blur should kill an open tip.
  wrap.addEventListener('mousedown', hide);
  window.addEventListener('scroll', hide, true);
}

/* ────────────────────────────────────────────────────────── */
/* Postpone arrows (SVG)                                       */
/* ────────────────────────────────────────────────────────── */

export function drawPostponeArrows(wrap) {
  const container = wrap.querySelector('.gdt-container');
  const body      = wrap.querySelector('.gantt-body') || container;
  if (!container || !body) return;
  /* remove stale SVG */
  wrap.querySelectorAll('.gdt-arrows-svg').forEach(el => el.remove());

  // V15 (1.4): each move now lives in a dedicated trail sub-row whose
  // src + dst ghost-pills share `data-arrow-at`. Match endpoints by that
  // unique key so the SVG arrow is purely horizontal (same row → same y).
  // Fallback to the legacy by-cell lookup keeps old data renderable
  // while we settle the new format.
  // AUDIT-13 — индексируем DOM ОДНИМ проходом (querySelectorAll), вместо
  // 2-4 querySelector на каждую стрелку по всему wrap. На 200 строк × N
  // переносов это убирает тысячи DOM-обходов. Скрытые/отфильтрованные
  // строки просто отсутствуют в индексах — их стрелки тихо пропускаются.
  const trailSrc = new Map(), trailDst = new Map(), cellByKey = new Map();
  wrap.querySelectorAll('.gdt-trail-src[data-row-id][data-arrow-at]').forEach(el => trailSrc.set(el.dataset.rowId + '|' + el.dataset.arrowAt, el));
  wrap.querySelectorAll('.gdt-trail-dst[data-row-id][data-arrow-at]').forEach(el => trailDst.set(el.dataset.rowId + '|' + el.dataset.arrowAt, el));
  wrap.querySelectorAll('.gantt-cell[data-col][data-row-id]').forEach(el => cellByKey.set(el.dataset.rowId + '|' + el.dataset.col, el));

  const arrows = [];
  const diag   = { rowsWithArrows: 0, arrowsTotal: 0, srcMissing: 0, dstMissing: 0, drawn: 0 };
  state.rows.forEach(row => {
    if (!row.ganttArrows?.length) return;
    diag.rowsWithArrows++;
    row.ganttArrows.forEach(a => {
      diag.arrowsTotal++;
      const akey = row.id + '|' + (a.at || '');
      const srcEl = trailSrc.get(akey) || cellByKey.get(row.id + '|' + a.srcCol);
      const dstEl = trailDst.get(akey) || cellByKey.get(row.id + '|' + a.dstCol);
      if (!srcEl) diag.srcMissing++;
      if (!dstEl) diag.dstMissing++;
      if (srcEl && dstEl) { arrows.push({ srcEl, dstEl, wt: a.wt }); diag.drawn++; }
    });
  });
  // Surface the diagnostic so DevTools shows it when arrows fail to appear.
  if (diag.arrowsTotal && (diag.srcMissing || diag.dstMissing || !diag.drawn)) {
    console.warn('[gantt] drawPostponeArrows:', diag);
  }
  if (!arrows.length) return;

  const sw = Math.max(body.scrollWidth,  body.clientWidth);
  const sh = Math.max(body.scrollHeight, body.clientHeight) + 30;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'gdt-arrows-svg');
  svg.setAttribute('width',  sw);
  svg.setAttribute('height', sh);
  // V21 — стрелки декоративные (информация о переносе уже в pill aria-label
  // и в trail-chip aria-label); SVG скрываем от screen-reader.
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:50;overflow:visible';

  /* V16 (gantt-roadmap #4) — arrow uses the work-type accent colour.
     V21 pills refresh — colour берётся из PHASE_COLOR_TOKENS (CSS-var,
     theme-aware), а stroke/fill ставятся через `style.*` а не через
     setAttribute, потому что SVG-атрибуты не резолвят `var(...)`. */
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  svg.appendChild(defs);
  const _markerCache = new Set();
  const _slug = (s) => String(s).replace(/[^a-z0-9]/gi, '').slice(0, 32) || 'fallback';
  const _ensureMarker = (wtKey, colorToken) => {
    const id = `gdt-ah-${_slug(wtKey)}`;
    if (_markerCache.has(id)) return id;
    _markerCache.add(id);
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', id);
    marker.setAttribute('markerWidth',  '6');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('refX', '5.5');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', '0 0, 6 3, 0 6');
    poly.style.fill = colorToken;
    marker.appendChild(poly);
    defs.appendChild(marker);
    return id;
  };

  const cRect = body.getBoundingClientRect();

  arrows.forEach(({ srcEl, dstEl, wt }) => {
    const sR = srcEl.getBoundingClientRect();
    const dR = dstEl.getBoundingClientRect();
    if (!sR.width || !dR.width) return;

    /* anchor points: right-middle of source pill → left-middle of destination pill */
    const sx = sR.right  - cRect.left - 1;
    const sy = sR.top    + sR.height * 0.5 - cRect.top;
    const dx = dR.left   - cRect.left + 1;
    const dy = dR.top    + dR.height * 0.5 - cRect.top;

    const wtColor  = (PHASE_COLOR_TOKENS && PHASE_COLOR_TOKENS[wt]) || PHASE_COLOR_TOKEN_FALLBACK;
    const markerId = _ensureMarker(wt || 'fallback', wtColor);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${sx} ${sy} L ${dx} ${dy}`);
    path.style.stroke = wtColor;
    path.setAttribute('stroke-width',     '1.2');
    path.setAttribute('stroke-linecap',   'round');
    path.setAttribute('fill',             'none');
    path.setAttribute('marker-end',       `url(#${markerId})`);
    path.setAttribute('opacity',          '0.7');
    svg.appendChild(path);
  });

  // V15 Spine 2026-04-30 — body становится своим stacking context'ом
  // через position:relative + z-index:0, иначе arrows наезжают на header.
  body.style.position = 'relative';
  body.style.zIndex   = '0';
  body.appendChild(svg);
}
