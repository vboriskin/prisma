'use strict';
/* ============================================================
   RELEASE EDITOR MODAL — добавить/редактировать пользовательский релиз

   #1 — модалка с date-pickers и smart-pattern автоподстановкой ярлыка.
   Парсит существующие shorts (legacy + custom), находит trailing numeric
   pattern и инкрементирует последнее число: 1.22→1.23, 929.13→929.14,
   72.1→72.2. Если паттерна нет — поле остаётся пустым.
   ============================================================ */

import { state }    from '../state.js';
import { Storage }  from '../dataStore.js';
import { Utils }    from '../utils.js';
import { Reactive } from '../reactiveStore.js';
import { ConfirmDialog } from '../app/uxKit.js';
import { LEGACY_RELEASE_LIST } from '../constants.js';

/** AUDIT-5 — вычистить все следы удаляемого релиза из строк и UI-состояния,
 *  иначе остаются орфаны (donePills/notes/risks/customReleaseTypes), а ключ
 *  застревает в ganttHiddenReleases/filters.release и «воскресает» при
 *  повторном создании того же ярлыка. */
function _purgeReleaseEverywhere(key) {
  Reactive.silent(() => {
    state.ganttHiddenReleases = (state.ganttHiddenReleases || []).filter(k => k !== key);
    if (Array.isArray(state.filters?.release)) {
      state.filters.release = state.filters.release.filter(k => k !== key);
    }
    for (const row of (state.rows || [])) {
      if (row.customReleaseTypes && row.customReleaseTypes[key]) delete row.customReleaseTypes[key];
      const prefix = key + '__';
      for (const mapKey of ['donePills', 'inProgressPills', 'assigneePills', 'unplannedPills']) {
        const m = row[mapKey];
        if (m && typeof m === 'object') {
          for (const k of Object.keys(m)) if (k.startsWith(prefix)) delete m[k];
        }
      }
      if (Array.isArray(row.cellNotes)) row.cellNotes = row.cellNotes.filter(n => n.col !== key);
      if (Array.isArray(row.cellRisks)) row.cellRisks = row.cellRisks.filter(n => n.col !== key);
      if (Array.isArray(row.ganttArrows)) row.ganttArrows = row.ganttArrows.filter(a => a.srcCol !== key && a.dstCol !== key);
    }
  });
}

const MONTHS_RU = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];

function _padd(n) { return String(n).padStart(2, '0'); }

/** «DD.MM–DD.MM» → { startISO, endISO } для текущего года (приближённо). */
function _parseDatesToIso(datesStr) {
  if (!datesStr) return { start: '', end: '' };
  const m = String(datesStr).match(/^(\d{2})\.(\d{2})\D+(\d{2})\.(\d{2})/);
  if (!m) return { start: '', end: '' };
  const yr = new Date().getFullYear();
  return {
    start: `${yr}-${m[2]}-${m[1]}`,
    end:   `${yr}-${m[4]}-${m[3]}`,
  };
}

/** ISO YYYY-MM-DD → DD.MM. */
function _isoToShort(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}` : '';
}

/**
 * Парсит существующие short'ы (legacy + custom), находит trailing numeric
 * pattern и инкрементирует последний segment. Поддерживает:
 *  «1.20»/«1.21»/«1.22» → «1.23»
 *  «929.12»/«929.13» → «929.14»
 *  «72.1»/«72.2» → «72.3»
 *  «1.0»/«2.0» → «3.0» (если first segment растёт)
 *  «Релиз A.1»/«Релиз A.2» → «Релиз A.3»
 */
export function suggestNextShort(existingShorts) {
  if (!Array.isArray(existingShorts) || !existingShorts.length) return '';
  // Берём последний — это правдоподобный «свежайший» паттерн (custom
  // append'ятся в конец state.releases в порядке создания).
  const last = existingShorts[existingShorts.length - 1];
  if (!last) return '';
  // Trailing dot-separated numeric block (e.g. "1.20", "929.13", "72.1"),
  // с возможным non-digit prefix ("Релиз A.").
  const m = String(last).match(/^(.*?)(\d+(?:\.\d+)*)(\D*)$/);
  if (!m) return '';
  const [, prefix, nums, suffix] = m;
  const parts = nums.split('.');
  const lastIdx = parts.length - 1;
  const n = parseInt(parts[lastIdx], 10);
  if (!Number.isFinite(n)) return '';
  // Сохраняем ширину паддинга (если был "1.05" → "1.06", не "1.6").
  const width = parts[lastIdx].length;
  parts[lastIdx] = String(n + 1).padStart(width, '0');
  return prefix + parts.join('.') + suffix;
}

/**
 * @param {object} opts
 * @param {string} [opts.key]
 * @param {function} [opts.onSaved]
 */
export function openReleaseEditor(opts = {}) {
  const esc = (s) => Utils.escapeHtml(String(s ?? ''));
  const editKey = opts.key || '';
  const existing = editKey
    ? (state.releases || []).find(r => r.key === editKey)
    : null;
  const isEdit = !!existing;
  if (editKey && LEGACY_RELEASE_LIST.some(l => l.key === editKey)) {
    window.showToast?.('Встроенные релизы не редактируются', 'warning', 2200);
    return () => {};
  }

  // Smart-suggestion для нового релиза.
  const allShorts = [
    ...LEGACY_RELEASE_LIST.filter(r => r.key !== 'backlog' && r.key !== 'overtime').map(r => r.short),
    ...((state.releases || []).map(r => r.short)),
  ].filter(Boolean);
  const suggested = !isEdit ? suggestNextShort(allShorts) : '';

  const existingDates = _parseDatesToIso(existing?.dates || '');
  const draft = {
    short: existing?.short || '',
    label: existing?.label || '',
    startISO: existingDates.start,
    endISO:   existingDates.end,
  };

  document.getElementById('modal-release-editor')?.remove();
  const html = `
    <div class="modal-overlay" id="modal-release-editor" role="dialog" aria-modal="true" aria-labelledby="modal-release-editor-title">
      <div class="modal-box re-modal-box">
        <div class="modal-header">
          <div class="re-modal-eyebrow">${isEdit ? 'РЕДАКТИРОВАНИЕ РЕЛИЗА' : 'НОВЫЙ РЕЛИЗ'}</div>
          <h3 id="modal-release-editor-title">${isEdit ? esc(existing.short || existing.label) : 'Добавить релиз'}</h3>
          <button class="modal-close-btn" type="button" aria-label="Закрыть" data-close-modal><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="re-modal-body">
          <div class="re-field">
            <label class="re-field-label" for="re-short">Ярлык</label>
            <input id="re-short" class="re-field-input" placeholder="${esc(suggested || 'Например: 1.23')}" maxlength="20" value="${esc(draft.short)}" autocomplete="off" autofocus>
            <div class="re-field-hint">${isEdit ? 'Например: 1.23, 929.14, 72.3' : (suggested ? `Подсказка: следующий — <strong>${esc(suggested)}</strong>` : 'Любой формат — у каждой команды свой стандарт')}</div>
          </div>
          <div class="re-field">
            <label class="re-field-label" for="re-label">Полное название</label>
            <input id="re-label" class="re-field-input" placeholder="Релиз 1.23 — quarterly drop" maxlength="60" value="${esc(draft.label)}" autocomplete="off">
            <div class="re-field-hint">Опционально — показывается в названии колонки и тултипах.</div>
          </div>
          <div class="re-field re-field-dates">
            <label class="re-field-label">Диапазон</label>
            <div class="re-dates-row">
              <input type="date" id="re-start" class="re-field-input re-field-date" value="${esc(draft.startISO)}">
              <span class="re-dates-sep" aria-hidden="true">→</span>
              <input type="date" id="re-end" class="re-field-input re-field-date" value="${esc(draft.endISO)}">
            </div>
            <div class="re-field-hint">Начало и конец окна планирования. Today-line будет интерполироваться внутри.</div>
          </div>
        </div>
        <div class="re-modal-footer">
          ${isEdit ? '<button class="btn btn-outline btn-xs re-delete-btn" id="re-delete">Удалить релиз</button>' : '<span class="re-modal-spacer"></span>'}
          <div class="re-modal-actions">
            <button class="btn btn-outline btn-sm" data-close-modal>Отмена</button>
            <button class="btn btn-primary btn-sm" id="re-save">${isEdit ? 'Сохранить' : 'Добавить'}</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-release-editor');
  const close = () => overlay?.remove();
  overlay?.addEventListener('click', (ev) => {
    if (ev.target === overlay || ev.target.closest?.('[data-close-modal]')) close();
  });
  document.addEventListener('keydown', function esc2(ev) {
    if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); }
  });

  // Если есть suggestion и поле пустое — заполняем его (но юзер может стереть).
  const shortInp = document.getElementById('re-short');
  if (!isEdit && suggested && !shortInp.value) shortInp.value = suggested;

  document.getElementById('re-save').addEventListener('click', () => {
    const short = shortInp.value.trim();
    const label = document.getElementById('re-label').value.trim();
    const startISO = document.getElementById('re-start').value;
    const endISO   = document.getElementById('re-end').value;
    if (!short) {
      window.showToast?.('Укажите ярлык релиза', 'warning', 1800);
      shortInp.focus();
      return;
    }
    if (startISO && endISO && startISO > endISO) {
      window.showToast?.('Дата конца раньше даты начала', 'warning', 2200);
      return;
    }
    const dates = (startISO && endISO)
      ? `${_isoToShort(startISO)}–${_isoToShort(endISO)}`
      : '';
    const key = editKey || ('r' + short.replace(/[^\w]/g, '').toLowerCase());
    if (!editKey) {
      if (LEGACY_RELEASE_LIST.some(l => l.key === key) || (state.releases || []).some(r => r.key === key)) {
        window.showToast?.('Релиз с таким ярлыком уже есть', 'warning', 2200);
        return;
      }
    }
    const arr = Array.isArray(state.releases) ? state.releases.slice() : [];
    if (isEdit) {
      const idx = arr.findIndex(r => r.key === editKey);
      if (idx >= 0) {
        arr[idx] = { ...arr[idx], short, label: label || `Релиз ${short}`, dates };
      }
    } else {
      arr.push({
        key,
        short,
        label: label || `Релиз ${short}`,
        dates,
        cls: 'gantt-window-' + key,
        order: arr.length + 1,
      });
    }
    state.releases = arr;
    try { Storage.save(); } catch (_) {}
    close();
    try { opts.onSaved?.(); } catch (_) {}
    window.showToast?.(isEdit ? `Релиз ${short} обновлён` : `Добавлен релиз ${short}`, 'success', 1800);
  });

  if (isEdit) {
    document.getElementById('re-delete').addEventListener('click', async () => {
      // AUDIT-20 — in-app ConfirmDialog вместо native confirm().
      const ok = await ConfirmDialog.show({
        title: `Удалить релиз «${draft.short}»?`,
        message: 'Колодец и все его пилюли, заметки, риски и переносы будут удалены из всех эпиков. Действие необратимо.',
        confirmLabel: 'Удалить релиз',
        cancelLabel: 'Отмена',
        danger: true,
      }).catch(() => false);
      if (!ok) return;
      _purgeReleaseEverywhere(editKey);
      state.releases = (state.releases || []).filter(r => r.key !== editKey);
      try { Storage.save(); } catch (_) {}
      close();
      try { opts.onSaved?.(); } catch (_) {}
      window.showToast?.(`Релиз ${draft.short} удалён`, 'success', 1800);
    });
  }

  return close;
}
