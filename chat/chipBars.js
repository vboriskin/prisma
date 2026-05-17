'use strict';
/* ============================================================
   chat/chipBars.js — V22+ Week 2 (UX-01, UX-02, S-S7, S-S8)

   Builders для interactive chip-bar'ов в ответах чата:

   1. UX-01: time-period chip-bar [Сегодня | Вчера | Неделя | Месяц |
      Квартал | Год | Свой...] — реализован через action-chip с
      type='send_prompt' (предзаполняет input + автосенд).

   2. UX-02: «Свой...» chip → action типа 'open_date_picker' (новый
      action handler в chatActions.js рендерит popover с двумя date-
      input'ами).

   3. S-S7: source-icons mini-chips для glance-read «📋J · 🔀B · 📄C · 🧪Z».
      Это display-only (не action) — рендерятся inline в text/cards.

   Public API:
     buildTimeChipBar(target, opts?) → ActionChip[]
       Возвращает массив chip'ов для structured.actions.
     buildSourceChips(summary)        → string (HTML inline)
       Mini-chips для glance-read.
     buildCustomDateChip()            → ActionChip
       Открыть date-picker.
   ============================================================ */

const TIME_PRESETS = Object.freeze([
  { label: 'Сегодня', period: 'сегодня' },
  { label: 'Вчера',   period: 'вчера' },
  { label: 'Неделя',  period: 'неделя' },
  { label: 'Месяц',   period: 'месяц' },
  { label: 'Квартал', period: 'квартал' },
  { label: 'Год',     period: 'год' },
]);

/**
 * Построить time-chip-bar для смены периода в текущем запросе.
 * @param {object} target — resolveTarget output (нужно target.employee/team)
 * @param {object} opts   — { currentPeriod?: string, includeCustom?: bool }
 * @returns {Array<ActionChip>}
 */
export function buildTimeChipBar(target, opts = {}) {
  const subject = _subjectLabel(target);
  if (!subject) return [];
  const currentLabel = opts.currentPeriod || target?.period?.label || '';
  const chips = TIME_PRESETS.map(preset => {
    const isCurrent = currentLabel.toLowerCase().includes(preset.period);
    return {
      type: 'send_prompt',
      label: isCurrent ? `· ${preset.label} ·` : preset.label,
      payload: {
        prompt: `${subject} за ${preset.period}`,
        autoSend: true,
      },
      primary: isCurrent,
    };
  });
  if (opts.includeCustom !== false) {
    chips.push(buildCustomDateChip(subject));
  }
  return chips;
}

/**
 * Chip «Свой...» — открывает date-picker.
 * Подключённый handler `open_date_picker` рисует popover с двумя
 * date input'ами и при submit делает send_prompt с custom-range текстом.
 */
export function buildCustomDateChip(subject) {
  return {
    type: 'open_date_picker',
    label: 'Свой период...',
    payload: { subject },
  };
}

/**
 * Mini-chips для inline source-breakdown.
 * Принимает агрегированную сводку с counts per source.
 *
 * 2026-05-17 (C1 fix) — раньше возвращали raw HTML (`<span class="chat-
 * source-mini-chip">`), который проходил через renderMarkdownLite →
 * `escapeHtml` экранировал `<>` → пользователь видел буквально
 * `&lt;span...&gt;`. Теперь возвращаем sentinel-токен `[[SC|key|count|title]]`,
 * который НЕ содержит `<>&"'` (escapeHtml его не трогает), а
 * renderMarkdownLite после `escapeHtml` распознаёт паттерн и
 * подставляет нужный HTML.
 *
 * @param {object} summary — { jira?: {total}, bb?: {total}, cf?: {total}, zephyr?: {total} }
 * @returns {string} — sentinel-токены, разделённые пробелом
 */
export function buildSourceChips(summary) {
  if (!summary) return '';
  const items = [];
  if (summary.jira)   items.push({ key: 'J',  count: summary.jira.total || 0,   title: 'Jira' });
  if (summary.bb)     items.push({ key: 'B',  count: summary.bb.total || 0,     title: 'Bitbucket' });
  if (summary.cf)     items.push({ key: 'C',  count: summary.cf.total || 0,     title: 'Confluence' });
  if (summary.zephyr) items.push({ key: 'Z',  count: summary.zephyr.total || 0, title: 'Zephyr' });
  if (!items.length) return '';
  // pipes используются как delimiter — внутри title pipes нет.
  return items.map(it => `[[SC|${it.key}|${it.count}|${it.title}]]`).join(' ');
}

/**
 * Helper — извлечь «subject» текст для prompt-substitution:
 *   target.employee → «Иванов Иван»
 *   target.team     → «команда PAY»
 *   target.epic     → «эпик BIK-1234»
 *   target.release  → «релиз 1.21»
 */
function _subjectLabel(target) {
  if (!target) return '';
  if (target.employee) return target.employee.label || target.employee.id;
  if (target.team)     return `команда ${target.team.name || target.team}`;
  if (target.epic)     return `эпик ${target.epic.id || target.epic}`;
  if (target.release)  return `релиз ${target.release.id || target.release}`;
  return '';
}
