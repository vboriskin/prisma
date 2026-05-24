'use strict';
/* ============================================================
   GANTT VIEW — v14_0 ES module (GanttV2 retired in V14, see B2)
   ============================================================ */

import { state } from '../state.js';
import { FilterEngine } from '../filters.js';
import { Utils } from '../utils.js';
import { RowFactory } from '../rowFactory.js';
import { Icons } from '../app/icons.js';
import { Storage } from '../dataStore.js';
// V22 G-07 (audit-experts-2026-05-15) — dead imports purge:
// RiskEngine, RH, SCOPE_OPTIONS, RELEASE_WINDOWS, GANTT_RELEASE_WINDOWS,
// GANTT_TIMELINE_START, GANTT_TIMELINE_END, GANTT_DAY_PX,
// GANTT_RELEASE_BOUNDS, PHASE_SHORT — none of them были использованы в коде
// (только в самой строке import). Перепроверено через grep по имени.
import {
  PHASE_ORDER, PHASE_COLORS,
  PHASE_COLOR_TOKENS, PHASE_COLOR_TOKEN_FALLBACK,
  WORK_TYPES, GANTT_COL_LABELS, buildReleaseList,
} from '../constants.js';
import { GANTT_LEGEND } from './gantt/legendContent.js';
// V18.3 B1 (partial split) — 4 self-contained method'а вынесены в aux.
import {
  openHistoryModal as _auxHistoryModal,
  openAddEpicModal as _auxAddEpicModal,
  bindFastTooltip as _auxBindFastTooltip,
  drawPostponeArrows as _auxDrawPostponeArrows,
} from './gantt/aux.js';
import { renderPageHeader, prizmaEmptyGlyph } from '../app/prizmaUI.js';
import { Services } from '../app/services.js';

/** Волна 3 — общий helper для prizma-page-header в section'ах. */
function _injectPrizmaHeader(sectionId, prizmaSectionKey, sub) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const hostId = sectionId + '-prizma-header';
  let host = section.querySelector('#' + hostId);
  if (!host) {
    host = document.createElement('div');
    host.id = hostId;
    section.insertBefore(host, section.firstChild);
  }
  host.innerHTML = renderPageHeader(prizmaSectionKey, sub ? { sub } : {});
}

// V17.1 C11+C12 — единый плюрализатор для русских окончаний.
// Пример: pl(1, ['задача','задачи','задач']) → 'задача', pl(3,…) → 'задачи',
// pl(5,…) → 'задач'. Используется в team-counter (C12) и в epic-meta (C11).
function pl(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
// V22 G-10 (audit-experts-2026-05-15 Vrba S0-2) — «N задач» создавал
// иллюзию что показано N Jira-тикетов, тогда как реально это N **типов
const EPIC_FORMS = ['эпик', 'эпика', 'эпиков'];

// V17.1 C4 — длинный русский формат «20 апреля – 17 мая» для подзаголовка
// колонки релиза. Источник `c.sub` сейчас — `'DD.MM–DD.MM'`; сохраняем
// исходное поле для логики today-pill (parser в well-header), но рендерим
// читаемую версию для пользователя.
const RU_MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function formatLongRange(sub) {
  if (!sub) return '';
  const m = String(sub).match(/^(\d{2})\.(\d{2})\D+(\d{2})\.(\d{2})/);
  if (!m) return sub;
  const [, sd, sm, ed, em] = m.map(x => parseInt(x, 10) || x);
  const left  = `${parseInt(sd,10)} ${RU_MONTHS_GEN[parseInt(sm,10)-1] || ''}`;
  const right = `${parseInt(ed,10)} ${RU_MONTHS_GEN[parseInt(em,10)-1] || ''}`;
  return `${left} – ${right}`;
}

// F1 Churn-heat — flame-иконка (lucide), inline SVG (без эмодзи по брендбуку).
// Метит «нестабильные» эпики, переезжающие между релизами 3+ раз.
const _CHURN_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>';

const CHURN_THRESHOLD = 3;

export const Gantt3View = {
  // Wave1 P-GR §B4 — приватный фильтр-state `gf` удалён: единственным
  // потребителем был `getRows()`, фильтры жили в `FilterEngine`, а локальный
  // `gf` всегда оставался initial-defaults (никаких сеттеров не было).
  _cancelTransientInteractions: null,
  _clearTransientInteractions() {
    if (typeof Gantt3View._cancelTransientInteractions === 'function') {
      try { Gantt3View._cancelTransientInteractions(); } catch(_) {}
    }
    Gantt3View._cancelTransientInteractions = null;
  },
  // Гант 3.0 п.2 — состояние «Линзы зависимостей» (sketch 09). on = режим
  // включён; focusKey = текущий эпик в фокусе; locked = зафиксирован кликом;
  // graph = мемоизированные множества предков/потомков/крит-путь; els = карта
  // epicKey→row-элемент; handlers/overlay/readout — для аккуратного teardown.
  _lens: { on: false, focusKey: null, locked: false, graph: null, els: null, overlay: null, readout: null, onScroll: null, onKey: null, _raf: 0 },
  // Гант 3.0 п.3 — состояние «Фокус-дорожки» (sketch redesign 02). on = режим
  // включён; team = teamKey раскрытой команды (остальные свёрнуты в сводку).
  _focusLane: { on: false, team: null },
  // Гант 3.0 п.4 — состояние «Командного режима» (sketch redesign 04). on =
  // режим включён; filter = активный фильтр { kind,label,test } или null;
  // sel = индекс выбранного пункта меню; opts = плоский список текущих опций.
  _cmd: { on: false, filter: null, sel: 0, opts: [], bar: null, onKey: null },
  // Гант 3.0 п.5 — «Pill-anatomy»: поповер расшифровки пилюли (клик). Inline,
  // всегда доступен. pop = текущий элемент поповера, onDoc — outside-listener.
  _anatomy: { pop: null, onDoc: null, anchor: null },
  // Гант 3.0 п.6 — «Нарратив»: оверлей-документ квартала (кнопка). el = оверлей.
  _narrative: { el: null, onKey: null },
  // Гант 3.0 п.8 — «Курс» (north-star): toggle компактной оси квартала.
  _northstar: { on: false },
  // Гант 3.0 п.9 — «Marquee-bulk»: Shift+тяни рамку → выделение пилюль.
  _marquee: { box: null, bar: null, start: null, dragging: false },
  // Гант 3.0 п.10 — «Peek-quicklook»: клик по лейблу эпика → карточка-превью.
  _peek: { pop: null, onDoc: null, anchor: null },
  // Гант 3.0 п.11 — «Переносы» (plan-diff по переносам): toggle подсветки.
  _diff: { on: false },
  // Гант 3.0 п.12 — «Burndown»: toggle мини-спарклайнов сгорания в шапках релизов.
  _burndown: { on: false },
  // Гант 3.0 п.13-16,21,24,25 — «Виды»: альтернативные представления (оверлеи).
  _mode: { el: null, name: null, onKey: null, st: null },
  // Гант 3.0 п.20 — «Чипы»: быстрые фильтры (toggle-режим, AND-комбинация).
  _chips: { on: false, active: null, strip: null },
  // Гант 3.0 п.19 — «Radial-menu»: радиальное контекст-меню на пилюле.
  _radial: { el: null, onDoc: null, bypass: false },
  // Гант 3.0 п.23 — «Подсказки» (smart-suggest): панель наблюдений по плану.
  _suggest: { el: null },
  // Гант 3.0 п.17 — «Слой заметок» (annotations): отдельный store, не мутит план.
  _annot: { on: false, pop: null, onDoc: null },
  _annotStore: null,
  // AUDIT-ART #11/#12/#13 — runtime style-инжект (идемпотентный).
  // Не редактируем styles.css напрямую (merge-conflict зона). Все правила
  // помечены маркером `AUDIT-ART #N` (в CSS-комментарии) чтобы было легко
  // переехать в styles.css или откатить.
  _auditArtInjectStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('audit-art-gantt3-style')) return;
    const css = `
/* AUDIT-ART #12 — team-rail: rainbow hash-color → нейтральный 1px grey.
   Identity команды теперь несёт monogram (см. .audit-art-team-mono),
   color != identity. */
.v16-team-rail.audit-art-team-rail {
  background: var(--prizma-border-strong, var(--prizma-text-tertiary, #94a3b8)) !important;
  width: 1px !important;
  border-radius: 0 !important;
}

/* AUDIT-ART #12 — team-monogram: 2-letter chip рядом с названием команды.
   Tabular-nums + spine eyebrow (10px CAPS, letter-spacing). */
.audit-art-team-mono {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 18px;
  padding: 0 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-feature-settings: "tnum" 1, "lnum" 1;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .6px;
  color: var(--prizma-text-secondary, var(--text-2));
  background: transparent;
  border: 1px solid var(--prizma-border, var(--border));
  border-radius: 4px;
  text-transform: uppercase;
}

/* AUDIT-ART #13 — capacity sparkline: пять баров → нейтральные grey.
   Только overload-bar остаётся signal-цветом (off-course красный).
   Раньше каждый bucket красился в свой signal-цвет (information/on-course/
   drift/off-course/text-tertiary) — «свет от ёлки», 5 цветов всегда. */
.v16-spark-bar-backlog,
.v16-spark-bar-r120,
.v16-spark-bar-r121,
.v16-spark-bar-r122,
.v16-spark-bar-overtime {
  background: var(--prizma-text-tertiary, #94a3b8) !important;
  opacity: .55;
}
.v16-spark-bar-overload {
  background: var(--prizma-off-course, #C13838) !important;
  opacity: 1;
}

/* ===========================================================
   V22 audit-experts-2026-05-15 — patch-stack для Ганта.
   Все правила помечены тегом V22-G-<N> чтобы было легко
   tracking / откатить per-issue.
   =========================================================== */

/* V22-G-11 — Dependency badge на эпик-строке.
   Inline-индикатор «← N зависимостей / → N блокирующих» с минимальной
   визуальной нагрузкой. Линии через весь Гант на 200 эпиков превращаются
   в кашу — поэтому компактный chip с tooltip-ом + click → dep-graph. */
.v16-epic-deps-badge {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 0 4px; height: 14px;
  background: transparent;
  border: 1px solid var(--prizma-border, var(--border));
  border-radius: 3px;
  color: var(--prizma-text-secondary, var(--text-2));
  font: 500 9.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  font-feature-settings: "tnum" 1, "lnum" 1;
  letter-spacing: .2px;
  cursor: pointer;
  vertical-align: middle;
  transition: border-color .12s, color .12s;
}
.v16-epic-deps-badge:hover {
  border-color: var(--prizma-information, #4f46e5);
  color: var(--prizma-information, #4f46e5);
}
.v16-epic-deps-badge:focus-visible {
  outline: 2px solid var(--prizma-information, #4f46e5);
  outline-offset: 1px;
}
.v16-epic-deps-in,
.v16-epic-deps-out {
  font-feature-settings: "tnum" 1, "lnum" 1;
}
.v16-epic-deps-in  { color: var(--prizma-drift,    #B07B1A); } /* зависит от чего-то — амбер (риск ждать) */
.v16-epic-deps-out { color: var(--prizma-off-course,#C13838); } /* блокирует других — красный */

/* V22-G-09 — Time-axis (today-маркер) внутри активной release-колонки.
   Раньше: «окно 1.21» — без понимания «когда дедлайн? мы внутри или вышли?»
   Теперь: для bucket-cell с .gantt-col-today добавляется vertical-line
   маркер today на пропорциональной позиции внутри окна. */
.gantt-bucket-today-marker {
  position: absolute;
  top: 0; bottom: 0;
  width: 1px;
  background: var(--prizma-information, #4f46e5);
  opacity: .55;
  pointer-events: none;
  z-index: 1;
}
.gantt-bucket-today-marker::after {
  content: '';
  position: absolute;
  top: -2px; left: -2px;
  width: 5px; height: 5px;
  background: var(--prizma-information, #4f46e5);
  border-radius: 50%;
}
.gantt-window-r120,
.gantt-window-r121,
.gantt-window-r122,
.gantt-window-overtime {
  position: relative; /* чтобы абсолютный today-маркер позиционировался */
}

/* V22-G-15 — Toolbar visual hierarchy.
   Primary actions (Зафиксировать план, Снять фиксацию) — outline + текст.
   Secondary (История, Граф зависимостей, Как читать) — outline + текст.
   Tertiary / utility (Undo, Redo, Свернуть, Полный экран) — icon-only,
   зрительно слабее (opacity .8 + бордер ghost). NAV-кластер (Поиск,
   Режим, Плотность, Полный экран) — все icon-only ghost, в самом правом
   конце. Это уже задано через prizma-icon-only-btn — мы дополнительно
   делаем visual-weight унифицированным. */
.section-header-actions .btn.prizma-icon-only-btn {
  opacity: .82;
  border-color: var(--prizma-border, var(--border));
}
.section-header-actions .btn.prizma-icon-only-btn:hover {
  opacity: 1;
}
.section-header-actions .topbar-divider {
  /* eyebrow-label кластера: «Вид» / «Навигация» — уже есть data-cluster-label,
     просто чуть приглушаем чтобы не конкурировал с кнопками */
  opacity: .65;
}

/* V22-G-17 — Один шрифт на строку эпика.
   Раньше: имя эпика (16px/800) + счётчик (24px/300) — два разных шрифта,
   глаз не знал куда смотреть. Теперь иерархия СТРОЙКО по weight и opacity. */
.v16-epic-name {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: 0;
}
.v16-epic-sub {
  font-size: 11px;
  font-weight: 500;
  line-height: 1.3;
  opacity: .72; /* «легче» родителя — иерархия через прозрачность, не размер */
}
/* V22-G-18 — font-size scale в Ганте теперь 4 размера вместо 11:
     12px (счётчики, бейджы, мелочь — tnum)
     13px (имя эпика, имя пилла)
     14px (заголовки секций, кластер-лейблы)
     11px (caps eyebrow / spine-caption)
   Здесь объявляем как custom-properties для override-стека. */
.section-header-actions {
  --gdt-size-mono: 12px;
  --gdt-size-base: 13px;
  --gdt-size-head: 14px;
  --gdt-size-caps: 11px;
}

/* V22-G-20 — Заголовок Ганта: убираем конкурирующие цветовые каналы.
   Раньше: 6 каналов (фон, полоска, шрифт цвета, иконки, бейдж, бордер).
   Теперь: 2 канала — neutral-фон + один accent цвет (information) только
   на active элементах. Все decorative окраски (border, icon, badge) сведены
   в один neutral grey. */
#section-gantt3 .section-header-actions .btn {
  background: var(--prizma-bg-elevated, #fff);
  color: var(--prizma-text-primary, var(--text-1));
  border-color: var(--prizma-border, var(--border));
}
#section-gantt3 .section-header-actions .btn[aria-expanded="true"],
#section-gantt3 .section-header-actions .btn.is-active {
  /* единственный accent-канал — для активного состояния */
  border-color: var(--prizma-information, #4f46e5);
  color: var(--prizma-information, #4f46e5);
}

/* V22-G-21 — Pill: возвращаем к Spine «один канал = одно сообщение».
   Раньше пилл нёс 8 визуальных каналов одновременно. Spine-доктрина
   допускает: 3px stripe-left + один текстовый бейдж. Прочее (тень,
   двойной фон, доп. бордер, gradient) — убираем. См. также G-22 ниже. */
.gantt-type-pill {
  /* убираем double-shadow ring — единственный bordering сигнал = stripe-left.
     Это закрывает G-21 + G-22 (box-shadow as visual border) сразу. */
  box-shadow: none !important;
  border-top: 1px solid transparent;
  border-right: 1px solid transparent;
  border-bottom: 1px solid transparent;
  /* stripe-left уже задан через border-left: 3px solid var(--pill-stripe) */
}
.gantt-type-pill:hover {
  /* hover «усиление stripe» БЕЗ ring */
  box-shadow: none !important;
  background: var(--prizma-bg-tertiary, var(--prizma-bg-elevated));
  border-left-width: 4px; /* stripe чуть шире на hover — единственный feedback-канал */
}
/* Pill row-2 (meta): WCAG-fix (см. также Birman C3). Раньше 9.5px на
   light-theme давал contrast 4.32:1 (требуется 4.5:1). Теперь 10.5px
   + усиленный text-color → выше порога. */
.gdt-pill-row-2 {
  font-size: 10.5px;
  color: var(--prizma-text-secondary, var(--text-2));
}

/* V22 X-02 / K-03 — focused-row подсветка при focus-changed эпика.
   2.4 сек pulse-highlight (через transient class) — даёт визуальный
   anchor когда юзер пришёл в Гант через action-chip чата или
   dependency-graph. */
.gantt-row.gantt-row-focused {
  background: rgba(79, 70, 229, 0.10) !important;
  animation: gantt-row-focus-pulse 2.4s ease-out;
}
@keyframes gantt-row-focus-pulse {
  0%   { background: rgba(79, 70, 229, 0.28); }
  100% { background: rgba(79, 70, 229, 0.0); }
}

/* V22-G-22 — box-shadow as border → real border.
   Раньше у .gantt-type-pill стоял box-shadow: 0 0 0 1px var(--prizma-border) —
   это тень функционально работала как бордер, нарушая Spine no-shadows
   doctrine. Заменено на правильный border (см. G-21 выше) или удалено
   совсем (для pill — оставляем только stripe). */

/* F1 Churn-heat — бейдж «нестабильного» эпика (3+ переносов между релизами).
   Один сигнал, drift-токен (амбер «внимание»), без заливки всей строки —
   чтобы не плодить «свет от ёлки». Тот же chip-язык, что и у deps-badge. */
.v16-epic-churn {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 0 4px; height: 14px;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--prizma-drift, #B07B1A) 45%, transparent);
  border-radius: 3px;
  color: var(--prizma-drift, #B07B1A);
  vertical-align: middle;
  cursor: default;
}
.v16-epic-churn > svg { display: block; }
.v16-epic-churn-n {
  font: 600 9.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  font-feature-settings: "tnum" 1, "lnum" 1;
  letter-spacing: .2px;
}

/* F2 Milestone'ы — вертикальная контрольная точка. Отличается от today-line
   именованным флажком сверху + точечным (не штриховым) стилем линии и более
   низким z-index (4 у «сегодня» побеждает). */
.gdt-milestone-line {
  position: absolute;
  top: 0;
  width: 0;
  border-left: 1px dotted var(--prizma-text-secondary, var(--text-2, #64748b));
  pointer-events: none;
  z-index: 3;
}
.gdt-milestone-line[hidden] { display: none; }
.gdt-milestone-flag {
  position: absolute;
  top: 2px; left: 0;
  transform: translateX(-50%);
  max-width: 120px;
  padding: 1px 5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  background: var(--prizma-surface, var(--surface, #fff));
  border: 1px solid var(--prizma-border, var(--border, #e2e8f0));
  border-top: 2px solid var(--prizma-information, #4f46e5);
  border-radius: 0 0 3px 3px;
  color: var(--prizma-text-secondary, var(--text-2, #64748b));
  font: 700 9px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: .4px;
  text-transform: uppercase;
  pointer-events: auto;
  z-index: 5;
}

/* F2 — модалка управления вехами. */
.ms-add-row { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
.ms-add-row .re-field-input { margin: 0; }
.ms-add-row #ms-label { flex: 1; }
.ms-list { display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow-y: auto; }
.ms-empty { padding: 16px; text-align: center; color: var(--prizma-text-tertiary, var(--text-3, #94a3b8)); font-size: 12px; }
.ms-item {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 8px;
  border: 1px solid var(--prizma-border, var(--border, #e2e8f0));
  border-radius: 6px;
}
.ms-item-date {
  font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  font-feature-settings: "tnum" 1, "lnum" 1;
  color: var(--prizma-information, #4f46e5);
  min-width: 58px;
}
.ms-item-label { flex: 1; font-size: 13px; color: var(--prizma-text-primary, var(--text-1)); }
.ms-item-del {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0;
  background: transparent; border: none; border-radius: 4px;
  color: var(--prizma-text-tertiary, var(--text-3, #94a3b8));
  cursor: pointer;
}
.ms-item-del:hover { color: var(--prizma-off-course, #C13838); background: var(--prizma-surface-2, rgba(0,0,0,.04)); }
.ms-count { font-size: 11px; color: var(--prizma-text-tertiary, var(--text-3, #94a3b8)); }

/* === ГАНТ 3.0 · п.1 «Перетаскивание с подсветкой дропзон» (lab sketch 02) ===
   Делаем drag-affordance явной: grab-курсор на пилюлях; ЧЁТКАЯ подсветка
   валидных дропзон (тот же эпик, другой колодец) + приглушение невалидных;
   усиленное кольцо на ячейке прямо под курсором. Scoped под #section-gantt3 —
   оригинальный Гант (общий бледный .gdt-drop-valid в styles.css) не затронут.
   ВАЖНО: фон/тень/прозрачность ставятся ИНЛАЙНОМ в dragstart-хендлере (см.
   gantt3.js), т.к. общий .gdt-drop-valid в styles.css объявлен с !important и
   перебивает любой class-rule. Здесь — только то, что инлайн не задаёт: курсор,
   transition и hover-кольцо через outline (единственное свойство, что слоится
   поверх инлайн background/box-shadow). */
#section-gantt3 .gantt-type-pill { cursor: grab; }
#section-gantt3 .gantt-type-pill.gantt-pill-dragging { cursor: grabbing; opacity: .4; }
#section-gantt3 .gantt-cell.gdt-drop-valid { cursor: copy; transition: background .12s, box-shadow .12s; }
#section-gantt3 .gantt-cell.gdt-drop-invalid { cursor: not-allowed; transition: opacity .12s; }
#section-gantt3 .gantt-cell.gdt-drop-valid.gantt-cell-dragover {
  outline: 2px solid var(--prizma-information) !important;
  outline-offset: -2px;
}

/* === ГАНТ 3.0 · п.2 «Линза зависимостей» (lab sketch 09) =================
   Toggle-режим: наведение на эпик-строку гасит несвязанное и проявляет
   цепочку — предки (зависит от · information/синий), потомки (блокирует ·
   off-course/красный), крит-путь (drift/жёлтый). SVG-провода рисуются в
   fixed-overlay (#gdt-lens-wires) поверх вьюпорта, readout-плашка плавает
   в правом-нижнем углу. Всё scoped под #section-gantt3 / собственные id —
   оригинальный Гант не затронут. */
#btn-gantt3-lens.active {
  border-color: var(--prizma-information);
  color: var(--prizma-information);
  background: var(--prizma-information-bg);
}
/* Дым: при активном фокусе несвязанные строки гаснут. */
#section-gantt3 #gantt3-wrap.gdt-lens-focusing .gantt-row:not(.gdt-lens-chain),
#section-gantt3 #gantt3-wrap.gdt-lens-focusing .gantt-row-trail {
  opacity: .13; filter: saturate(.35);
  transition: opacity .25s var(--ease-calm, ease), filter .25s var(--ease-calm, ease);
}
#section-gantt3 #gantt3-wrap.gdt-lens-focusing .gantt-row.gdt-lens-chain {
  transition: opacity .25s var(--ease-calm, ease);
}
/* Левый stripe строки перекрашиваем под роль (бьёт inline-цвет через !important). */
#section-gantt3 .gantt-row.gdt-lens-focus  .v16-epic-stripe { background: var(--prizma-text-primary, var(--text-1, #111)) !important; width: 3px !important; }
#section-gantt3 .gantt-row.gdt-lens-anc    .v16-epic-stripe { background: var(--prizma-information) !important; width: 3px !important; }
#section-gantt3 .gantt-row.gdt-lens-desc   .v16-epic-stripe { background: var(--prizma-off-course) !important; width: 3px !important; }
#section-gantt3 .gantt-row.gdt-lens-crit   .v16-epic-stripe { background: var(--prizma-drift) !important; width: 3px !important; }
#section-gantt3 .gantt-row.gdt-lens-focus { background: var(--prizma-information-bg); }
#section-gantt3 .gantt-row.gdt-lens-crit  { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--prizma-drift) 55%, transparent); }
/* Role-чип, инжектится в .v16-epic-sub. */
.gdt-lens-role { display: inline-flex; align-items: center; font: 700 9px/1 var(--font, inherit); letter-spacing: .5px; text-transform: uppercase; padding: 2px 5px; border-radius: 3px; white-space: nowrap; }
.gdt-lens-role.foc  { color: var(--prizma-text-primary, var(--text-1)); background: var(--prizma-bg-tertiary, rgba(0,0,0,.06)); }
.gdt-lens-role.anc  { color: var(--prizma-information); background: var(--prizma-information-bg); }
.gdt-lens-role.desc { color: var(--prizma-off-course); background: var(--prizma-off-course-bg, rgba(193,56,56,.12)); }
.gdt-lens-role.crit { color: var(--prizma-drift); background: var(--prizma-drift-bg, rgba(176,123,26,.14)); }
/* Fixed SVG-overlay для проводов. */
#gdt-lens-wires { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 60; overflow: visible; }
/* Плавающая readout-плашка. */
#gdt-lens-readout {
  position: fixed; right: 22px; bottom: 22px; z-index: 61;
  min-width: 252px; max-width: 340px; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 7px;
  background: var(--prizma-bg-elevated, var(--card, #fff));
  border: 1px solid var(--prizma-border, var(--border));
  border-left: 3px solid var(--prizma-information);
  border-radius: var(--r-md, 10px);
  box-shadow: 0 10px 30px rgba(0,0,0,.30);
  font: 12px/1.4 var(--font, inherit);
  animation: gdtLensReadoutIn .18s var(--ease-calm, ease);
}
@keyframes gdtLensReadoutIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
#gdt-lens-readout .lr-title { font-weight: 700; font-size: 12.5px; color: var(--prizma-text-primary, var(--text-1)); }
#gdt-lens-readout .lr-title .muted { color: var(--prizma-text-tertiary, var(--text-3)); font-weight: 500; }
#gdt-lens-readout .lr-counts { display: flex; gap: 14px; font: 600 11px/1 var(--mono, ui-monospace, monospace); }
#gdt-lens-readout .lr-counts .dep { color: var(--prizma-information); }
#gdt-lens-readout .lr-counts .blk { color: var(--prizma-off-course); }
#gdt-lens-readout .lr-crit { font: 500 11px/1.45 var(--mono, ui-monospace, monospace); color: var(--prizma-text-secondary, var(--text-2)); }
#gdt-lens-readout .lr-crit b { color: var(--prizma-drift); font-weight: 700; }
#gdt-lens-readout .lr-empty { font-size: 11.5px; color: var(--prizma-text-tertiary, var(--text-3)); }
#gdt-lens-readout .lr-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 10px; color: var(--prizma-text-tertiary, var(--text-3)); }
#gdt-lens-readout .lr-legend i { display: inline-block; width: 14px; height: 0; border-top: 2px solid; margin-right: 5px; vertical-align: middle; }
#gdt-lens-readout .lr-hint { font-size: 10.5px; color: var(--prizma-text-tertiary, var(--text-3)); border-top: 1px solid var(--prizma-border, var(--border)); padding-top: 6px; }
#gdt-lens-readout .lr-hint kbd { font: 600 10px/1 var(--mono, ui-monospace, monospace); padding: 1px 4px; border: 1px solid var(--prizma-border, var(--border)); border-radius: 3px; }
/* Линза живёт только на вкладке Гант 3.0: уходишь на другой раздел —
   fixed-chrome авто-прячется (html[data-active-section] ставит app/nav.js).
   Сам режим не выключаем — вернёшься, и линза снова доступна. */
html:not([data-active-section="gantt3"]) #gdt-lens-wires,
html:not([data-active-section="gantt3"]) #gdt-lens-readout { display: none !important; }

/* === ГАНТ 3.0 · п.3 «Фокус-дорожка» (lab redesign 02) ====================
   Progressive disclosure поверх существующего collapse: ровно одна команда
   раскрыта детально, остальные свёрнуты в тихую сводку (team-header +
   bucket-ячейки нагрузки). Клик по любому team-header переключает фокус
   (аккордеон). Реюзает _dtHiddenTeams + .is-team-collapsed. Scoped под
   #section-gantt3 — оригинальный Гант не затронут. */
#btn-gantt3-focuslane.active {
  border-color: var(--prizma-information);
  color: var(--prizma-information);
  background: var(--prizma-information-bg);
}
/* В режиме фокус-дорожки все team-header кликабельны (переключают фокус). */
body.gdt-focuslane-on #section-gantt3 .gantt-team-header { cursor: pointer; }
/* Свёрнутые команды — тихие, но читаемые (сводка нагрузки видна). */
body.gdt-focuslane-on #section-gantt3 .gantt-team-header:not(.gdt-lane-focus) {
  opacity: .66; transition: opacity .2s var(--ease-calm, ease), background .15s;
}
body.gdt-focuslane-on #section-gantt3 .gantt-team-header:not(.gdt-lane-focus):hover {
  opacity: 1; background: var(--prizma-bg-elevated, var(--row-hover, rgba(0,0,0,.03)));
}
/* Фокусная команда — акцентная полоса на sticky-лейбле + акцентное имя. */
body.gdt-focuslane-on #section-gantt3 .gantt-team-header.gdt-lane-focus .gdt-team-label {
  box-shadow: inset 3px 0 0 var(--prizma-information);
}
body.gdt-focuslane-on #section-gantt3 .gantt-team-header.gdt-lane-focus .gdt-team-name {
  color: var(--prizma-information);
}

/* === ГАНТ 3.0 · п.4 «Командный режим» (lab redesign 04-command-driven) =====
   Командная строка над чартом фильтрует/подсвечивает Гант как тихий backdrop.
   Префиксы team:/release:/risk: + свободный текст, grouped-dropdown подсказок,
   клавнавигация. Scoped под #section-gantt3 / собственные id — оригинал не
   затронут. */
#btn-gantt3-cmd.active { border-color: var(--prizma-information); color: var(--prizma-information); background: var(--prizma-information-bg); }
#gdt-cmd-bar { padding: 12px 16px 4px; display: flex; flex-direction: column; align-items: center; }
.gdt-cmd-box { width: 100%; max-width: 680px; position: relative; }
.gdt-cmd-field {
  display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 14px;
  background: var(--prizma-bg-elevated, var(--card)); border: 1px solid var(--prizma-border-strong, var(--border));
  border-radius: var(--r-lg, 12px); transition: border-color .18s var(--ease-calm, ease), box-shadow .18s;
}
.gdt-cmd-field.focus { border-color: var(--prizma-information); box-shadow: 0 0 0 3px var(--prizma-information-bg); }
.gdt-cmd-field .gdt-cmd-ic { color: var(--prizma-text-tertiary, var(--text-3)); flex: none; display: inline-flex; }
.gdt-cmd-field input { flex: 1; background: none; border: none; outline: none; color: var(--prizma-text-primary, var(--text-1)); font: 400 15px/1 var(--font, inherit); letter-spacing: -.01em; }
.gdt-cmd-field input::placeholder { color: var(--prizma-text-tertiary, var(--text-3)); }
.gdt-cmd-clear { display: none; background: none; border: none; cursor: pointer; color: var(--prizma-text-tertiary, var(--text-3)); padding: 4px; border-radius: 4px; }
.gdt-cmd-clear:hover { color: var(--prizma-text-primary, var(--text-1)); }
.gdt-cmd-clear.on { display: inline-flex; }
#gdt-cmd-menu {
  position: absolute; top: 52px; left: 0; right: 0; z-index: 1000;
  background: var(--prizma-bg-elevated, var(--card)); border: 1px solid var(--prizma-border-strong, var(--border));
  border-radius: var(--r-lg, 12px); box-shadow: 0 16px 48px rgba(0,0,0,.42);
  max-height: 50vh; overflow-y: auto; padding: 6px; display: none;
}
#gdt-cmd-menu.open { display: block; }
.gdt-cmd-grp { padding: 9px 12px 4px; font: 700 10px/1 var(--font, inherit); letter-spacing: .6px; text-transform: uppercase; color: var(--prizma-text-tertiary, var(--text-3)); }
.gdt-cmd-opt { display: flex; align-items: center; gap: 11px; padding: 8px 12px; border-radius: var(--r-md, 8px); cursor: pointer; }
.gdt-cmd-opt.sel { background: var(--prizma-bg-tertiary, rgba(0,0,0,.05)); }
.gdt-cmd-opt .oic { width: 24px; height: 24px; flex: none; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--r-sm, 6px); border: 1px solid var(--prizma-border, var(--border)); color: var(--prizma-text-secondary, var(--text-2)); font: 700 9px/1 var(--mono, ui-monospace, monospace); }
.gdt-cmd-opt .otext { flex: 1; min-width: 0; }
.gdt-cmd-opt .ot { font-size: 13px; font-weight: 500; color: var(--prizma-text-primary, var(--text-1)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gdt-cmd-opt .os { font: 500 10.5px/1.3 var(--mono, ui-monospace, monospace); color: var(--prizma-text-tertiary, var(--text-3)); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gdt-cmd-opt .okind { font: 600 9px/1 var(--mono, ui-monospace, monospace); letter-spacing: .4px; text-transform: uppercase; color: var(--prizma-text-tertiary, var(--text-3)); border: 1px solid var(--prizma-border, var(--border)); border-radius: 4px; padding: 3px 6px; flex: none; }
#gdt-cmd-menu .gdt-cmd-empty { padding: 16px 12px; text-align: center; font-size: 12.5px; color: var(--prizma-text-tertiary, var(--text-3)); }
#gdt-cmd-status { width: 100%; max-width: 680px; margin-top: 9px; display: flex; align-items: center; gap: 12px; min-height: 20px; }
.gdt-cmd-chip { display: none; align-items: center; gap: 7px; font: 600 11px/1 var(--mono, ui-monospace, monospace); color: var(--prizma-information); }
.gdt-cmd-chip.on { display: inline-flex; }
.gdt-cmd-chip button { background: none; border: none; color: var(--prizma-text-tertiary, var(--text-3)); cursor: pointer; padding: 2px; display: inline-flex; }
.gdt-cmd-chip button:hover { color: var(--prizma-text-primary, var(--text-1)); }
.gdt-cmd-stat { margin-left: auto; font: 500 11px/1 var(--mono, ui-monospace, monospace); color: var(--prizma-text-tertiary, var(--text-3)); }
/* backdrop: dim/highlight Ганта при активном фильтре */
body.gdt-cmd-filtering #section-gantt3 .gantt-row.gdt-cmd-dim,
body.gdt-cmd-filtering #section-gantt3 .gantt-team-header.gdt-cmd-dim {
  opacity: .16; transition: opacity .25s var(--ease-calm, ease);
}
#section-gantt3 .gantt-row.gdt-cmd-hit .v16-epic-name { color: var(--prizma-text-primary, var(--text-1)); font-weight: 600; }
#section-gantt3 .gantt-cell.gdt-cmd-hl { background: var(--prizma-information-bg) !important; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--prizma-information) 45%, transparent); transition: background .2s; }

/* === ГАНТ 3.0 · п.5 «Pill-anatomy» (lab sketch 08) =======================
   Клик по пилюле → поповер с расшифровкой её «анатомии»: тип работы, статус
   (словами + глиф), исполнитель, релиз, период, комментарий. Inline, scoped. */
#gdt-anatomy-pop {
  position: fixed; z-index: 64; min-width: 210px; max-width: 280px;
  background: var(--prizma-bg-elevated, var(--card)); border: 1px solid var(--prizma-border-strong, var(--border));
  border-radius: var(--r-md, 10px); box-shadow: 0 12px 36px rgba(0,0,0,.34);
  padding: 12px 13px; font: 12px/1.45 var(--font, inherit);
  animation: gdtAnatomyIn .14s var(--ease-calm, ease);
}
@keyframes gdtAnatomyIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
#gdt-anatomy-pop .ga-hd { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
#gdt-anatomy-pop .ga-stripe { width: 3px; align-self: stretch; min-height: 16px; border-radius: 2px; background: var(--prizma-information); flex: none; }
#gdt-anatomy-pop .ga-wt { font-weight: 700; font-size: 13px; color: var(--prizma-text-primary, var(--text-1)); }
#gdt-anatomy-pop .ga-row { display: flex; gap: 8px; padding: 3px 0; }
#gdt-anatomy-pop .ga-k { width: 84px; flex: none; color: var(--prizma-text-tertiary, var(--text-3)); font-size: 11px; }
#gdt-anatomy-pop .ga-v { flex: 1; min-width: 0; color: var(--prizma-text-secondary, var(--text-2)); }
#gdt-anatomy-pop .ga-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
#gdt-anatomy-pop .ga-dot.done { background: var(--prizma-on-course); }
#gdt-anatomy-pop .ga-dot.active { background: var(--prizma-information); }
#gdt-anatomy-pop .ga-dot.unplanned { background: transparent; box-shadow: inset 0 0 0 1.5px var(--prizma-text-tertiary, var(--text-3)); }
#gdt-anatomy-pop .ga-dot.todo { background: transparent; box-shadow: inset 0 0 0 1.5px var(--prizma-text-secondary, var(--text-2)); }
#gdt-anatomy-pop .ga-cmt { margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--prizma-border, var(--border)); font-size: 11px; color: var(--prizma-text-tertiary, var(--text-3)); white-space: pre-wrap; }

/* === ГАНТ 3.0 · п.6 «Narrative» (lab redesign 07) =========================
   Кнопка «Нарратив» → оверлей: квартал как читаемый документ. Каждый эпик —
   абзац со статус-фразой (генерится из DOM-данных) + мини-трек релизов. TOC
   команд слева. Оверлей в body, авто-прячется вне вкладки. */
#btn-gantt3-narrative.active { border-color: var(--prizma-information); color: var(--prizma-information); background: var(--prizma-information-bg); }
#gdt-narrative {
  position: fixed; inset: 0; z-index: 70; display: flex; flex-direction: column;
  background: var(--prizma-bg, var(--bg, #0A0A0F)); animation: gdtNarrIn .18s var(--ease-calm, ease);
}
@keyframes gdtNarrIn { from { opacity: 0; } to { opacity: 1; } }
#gdt-narrative .gn-top { display: flex; align-items: center; gap: 12px; padding: 14px 22px; border-bottom: 1px solid var(--prizma-border, var(--border)); flex: none; }
#gdt-narrative .gn-title { font-weight: 800; font-size: 17px; letter-spacing: -.01em; color: var(--prizma-text-primary, var(--text-1)); }
#gdt-narrative .gn-sub { font: 500 12px/1 var(--mono, ui-monospace, monospace); color: var(--prizma-text-tertiary, var(--text-3)); }
#gdt-narrative .gn-close { margin-left: auto; background: none; border: 1px solid var(--prizma-border, var(--border)); border-radius: var(--r-sm, 6px); color: var(--prizma-text-secondary, var(--text-2)); cursor: pointer; padding: 6px 10px; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; }
#gdt-narrative .gn-close:hover { color: var(--prizma-text-primary, var(--text-1)); border-color: var(--prizma-border-strong, var(--border)); }
#gdt-narrative .gn-body { flex: 1; display: flex; min-height: 0; }
#gdt-narrative .gn-toc { width: 196px; flex: none; border-right: 1px solid var(--prizma-border, var(--border)); overflow-y: auto; padding: 14px 0; }
#gdt-narrative .gn-toc a { display: block; padding: 7px 18px; font-size: 12.5px; color: var(--prizma-text-secondary, var(--text-2)); text-decoration: none; border-left: 2px solid transparent; cursor: pointer; }
#gdt-narrative .gn-toc a:hover { color: var(--prizma-text-primary, var(--text-1)); }
#gdt-narrative .gn-toc a.active { color: var(--prizma-information); border-left-color: var(--prizma-information); font-weight: 600; }
#gdt-narrative .gn-feed { flex: 1; overflow-y: auto; padding: 22px 28px 80px; }
#gdt-narrative .gn-doc { max-width: 760px; margin: 0 auto; }
#gdt-narrative .gn-team { font: 700 11px/1 var(--font, inherit); letter-spacing: .6px; text-transform: uppercase; color: var(--prizma-text-tertiary, var(--text-3)); margin: 26px 0 12px; padding-top: 14px; border-top: 1px solid var(--prizma-border, var(--border)); }
#gdt-narrative .gn-team:first-child { margin-top: 0; border-top: none; padding-top: 0; }
#gdt-narrative .gn-epic { position: relative; padding: 4px 0 16px 14px; }
#gdt-narrative .gn-epic::before { content: ""; position: absolute; left: 0; top: 7px; bottom: 16px; width: 3px; border-radius: 2px; background: var(--prizma-border-strong, var(--border)); }
#gdt-narrative .gn-epic.risk-off::before { background: var(--prizma-off-course); }
#gdt-narrative .gn-epic.risk-drift::before { background: var(--prizma-drift); }
#gdt-narrative .gn-epic .gn-nm { font-size: 15px; font-weight: 600; color: var(--prizma-text-primary, var(--text-1)); }
#gdt-narrative .gn-epic .gn-status { font-size: 13.5px; line-height: 1.55; color: var(--prizma-text-secondary, var(--text-2)); margin-top: 3px; }
#gdt-narrative .gn-epic .gn-status .done { color: var(--prizma-on-course); }
#gdt-narrative .gn-epic .gn-status .prog { color: var(--prizma-information); }
#gdt-narrative .gn-epic .gn-status .warn { color: var(--prizma-drift); }
#gdt-narrative .gn-track { display: flex; gap: 5px; margin-top: 9px; flex-wrap: wrap; }
#gdt-narrative .gn-trk { font: 600 10px/1 var(--mono, ui-monospace, monospace); padding: 4px 8px; border-radius: var(--r-sm, 6px); border: 1px solid var(--prizma-border, var(--border)); color: var(--prizma-text-tertiary, var(--text-3)); }
#gdt-narrative .gn-trk.has { color: var(--prizma-text-secondary, var(--text-2)); border-color: var(--prizma-border-strong, var(--border)); background: var(--prizma-bg-elevated, transparent); }
#gdt-narrative .gn-trk.cur { border-color: var(--prizma-information); color: var(--prizma-information); }
html:not([data-active-section="gantt3"]) #gdt-narrative { display: none !important; }

/* === ГАНТ 3.0 · п.8 «North-star» — только таймлайн (lab redesign 10) =======
   Toggle «Курс» → компактная ось квартала над чартом: сегменты релизов, вехи
   точками с подписями, маркер «сейчас». Позиции по DOY% (как milestone-lines). */
#btn-gantt3-northstar.active { border-color: var(--prizma-information); color: var(--prizma-information); background: var(--prizma-information-bg); }
#gdt-northstar { padding: 8px 26px 2px; }
#gdt-northstar .ns-track { position: relative; height: 54px; }
#gdt-northstar .ns-line { position: absolute; left: 0; right: 0; top: 30px; height: 2px; background: var(--prizma-border-strong, var(--border)); border-radius: 2px; }
#gdt-northstar .ns-bnd { position: absolute; top: 24px; width: 1px; height: 13px; background: var(--prizma-border, var(--border)); }
#gdt-northstar .ns-seg { position: absolute; top: 40px; transform: translateX(-50%); font: 600 10px/1 var(--mono, ui-monospace, monospace); color: var(--prizma-text-tertiary, var(--text-3)); white-space: nowrap; }
#gdt-northstar .ns-seg.cur { color: var(--prizma-text-secondary, var(--text-2)); }
#gdt-northstar .ns-ms { position: absolute; top: 30px; transform: translate(-50%, -50%); width: 10px; height: 10px; }
#gdt-northstar .ns-ms .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--prizma-drift); box-shadow: 0 0 0 2px var(--prizma-bg, #0A0A0F); }
#gdt-northstar .ns-ms .lbl { position: absolute; bottom: 13px; left: 50%; transform: translateX(-50%); font: 600 10px/1 var(--font, inherit); color: var(--prizma-text-secondary, var(--text-2)); white-space: nowrap; background: var(--prizma-bg, #0A0A0F); padding: 0 4px; }
#gdt-northstar .ns-now { position: absolute; top: 12px; bottom: 4px; width: 0; border-left: 2px solid var(--prizma-information); }
#gdt-northstar .ns-now span { position: absolute; top: -2px; left: 4px; font: 700 9px/1 var(--mono, ui-monospace, monospace); letter-spacing: .4px; color: var(--prizma-information); white-space: nowrap; }
#gdt-northstar .ns-empty { font-size: 11.5px; color: var(--prizma-text-tertiary, var(--text-3)); padding: 8px 0; }

/* === ГАНТ 3.0 · п.9 «Marquee-bulk» (lab sketch 11) ========================
   Shift+тяни рамку по чарту → выделяет пилюли; плавающая панель: счётчик +
   снять + копировать сводку. Scoped. (Bulk-мутации опущены: move-helper —
   render-closure, безопасно не переиспользуется.) */
#gdt-marquee { position: fixed; z-index: 66; pointer-events: none; border: 1px solid var(--prizma-information); background: color-mix(in srgb, var(--prizma-information) 12%, transparent); border-radius: 3px; }
#section-gantt3 .gantt-type-pill.gdt-mq-sel { box-shadow: inset 0 0 0 1.5px var(--prizma-information); background: var(--prizma-information-bg) !important; }
#gdt-mq-bar {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 67;
  display: none; align-items: center; gap: 14px; padding: 10px 14px;
  background: var(--prizma-bg-elevated, var(--card)); border: 1px solid var(--prizma-border-strong, var(--border));
  border-radius: var(--r-md, 10px); box-shadow: 0 10px 30px rgba(0,0,0,.34); font: 12px/1 var(--font, inherit);
  animation: gdtMqIn .16s var(--ease-calm, ease);
}
#gdt-mq-bar.on { display: flex; }
@keyframes gdtMqIn { from { opacity: 0; transform: translate(-50%, 12px); } to { opacity: 1; transform: translate(-50%, 0); } }
#gdt-mq-bar .mq-count { font-weight: 700; }
#gdt-mq-bar .mq-count b { color: var(--prizma-information); font-feature-settings: "tnum"; }
#gdt-mq-bar button { background: none; border: 1px solid var(--prizma-border, var(--border)); border-radius: var(--r-sm, 6px); color: var(--prizma-text-secondary, var(--text-2)); cursor: pointer; padding: 6px 10px; font-size: 12px; }
#gdt-mq-bar button:hover { color: var(--prizma-text-primary, var(--text-1)); border-color: var(--prizma-border-strong, var(--border)); }
#gdt-mq-bar .mq-hint { font: 500 10.5px/1 var(--mono, ui-monospace, monospace); color: var(--prizma-text-tertiary, var(--text-3)); }

/* === ГАНТ 3.0 · п.10 «Peek-quicklook» (lab sketch 12) =====================
   Клик по лейблу эпика → карточка-превью: мини-трек релизов + факты. */
#gdt-peek {
  position: fixed; z-index: 65; width: 320px; max-width: calc(100vw - 24px);
  background: var(--prizma-bg-elevated, var(--card)); border: 1px solid var(--prizma-border-strong, var(--border));
  border-radius: var(--r-md, 10px); box-shadow: 0 16px 44px rgba(0,0,0,.4); padding: 14px 15px;
  font: 12px/1.45 var(--font, inherit); animation: gdtAnatomyIn .15s var(--ease-calm, ease);
}
#gdt-peek .pk-hd { display: flex; align-items: flex-start; gap: 9px; padding-left: 10px; position: relative; margin-bottom: 11px; }
#gdt-peek .pk-hd::before { content: ""; position: absolute; left: 0; top: 2px; bottom: 2px; width: 3px; border-radius: 2px; background: var(--prizma-border-strong, var(--border)); }
#gdt-peek.risk-off .pk-hd::before { background: var(--prizma-off-course); }
#gdt-peek.risk-drift .pk-hd::before { background: var(--prizma-drift); }
#gdt-peek .pk-nm { font-weight: 700; font-size: 14px; color: var(--prizma-text-primary, var(--text-1)); }
#gdt-peek .pk-team { font: 500 10.5px/1 var(--mono, ui-monospace, monospace); color: var(--prizma-text-tertiary, var(--text-3)); margin-top: 4px; }
#gdt-peek .pk-track { display: grid; gap: 4px; margin: 4px 0 11px; }
#gdt-peek .pk-trk { display: flex; align-items: center; gap: 8px; }
#gdt-peek .pk-trk .k { width: 52px; flex: none; font: 600 10px/1 var(--mono, ui-monospace, monospace); color: var(--prizma-text-tertiary, var(--text-3)); text-align: right; }
#gdt-peek .pk-trk .v { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 3px; }
#gdt-peek .pk-wt { font: 600 10px/1 var(--font, inherit); padding: 3px 6px; border-radius: 4px; background: var(--prizma-bg-tertiary, rgba(0,0,0,.05)); color: var(--prizma-text-secondary, var(--text-2)); }
#gdt-peek .pk-wt.done { opacity: .55; text-decoration: line-through; }
#gdt-peek .pk-trk .empty { color: var(--prizma-text-tertiary, var(--text-3)); opacity: .5; }
#gdt-peek .pk-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; border-top: 1px solid var(--prizma-border, var(--border)); padding-top: 10px; }
#gdt-peek .pk-fact .fk { font: 600 9.5px/1 var(--font, inherit); letter-spacing: .4px; text-transform: uppercase; color: var(--prizma-text-tertiary, var(--text-3)); }
#gdt-peek .pk-fact .fv { font-size: 13px; font-weight: 600; color: var(--prizma-text-primary, var(--text-1)); margin-top: 3px; }
#gdt-peek .pk-fact .fv.warn { color: var(--prizma-drift); }

/* === ГАНТ 3.0 · п.11 «Plan-diff» по переносам (lab sketch 13) =============
   Toggle «Переносы»: подсвечивает пилюли с записанным переносом (drift),
   приглушает остальные. Источник — реальные переносы (cmt-transfer marker /
   row.ganttArrows), НЕ синтетический baseline. */
#btn-gantt3-diff.active { border-color: var(--prizma-drift); color: var(--prizma-drift); background: var(--prizma-drift-bg, rgba(176,123,26,.14)); }
body.gdt-diff-on #section-gantt3 .gantt-type-pill.gdt-diff-moved {
  outline: 2px solid var(--prizma-drift, #B07B1A) !important; outline-offset: -1px;
  background: var(--prizma-drift-bg, rgba(176,123,26,.14)) !important; border-radius: var(--r-sm, 6px);
}
body.gdt-diff-on #section-gantt3 .gantt-bar-multi .gantt-type-pill:not(.gdt-diff-moved):not(.gantt-pill-ghost) { opacity: .32; transition: opacity .2s; }

/* === ГАНТ 3.0 · п.12 «Burndown-rail» (lab sketch 20, toggleable) ==========
   «Burndown» → мини-спарклайн сгорания в шапке каждого датированного релиза. */
#btn-gantt3-burndown.active { border-color: var(--prizma-information); color: var(--prizma-information); background: var(--prizma-information-bg); }
.gdt-burndown { margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
.gdt-burndown svg { width: 100%; height: 28px; display: block; }
.gdt-burndown .bd-pace { font: 600 9px/1 var(--mono, ui-monospace, monospace); letter-spacing: .3px; }
.gdt-burndown .bd-pace.ok { color: var(--prizma-on-course); }
.gdt-burndown .bd-pace.behind { color: var(--prizma-drift); }
.gdt-burndown .bd-pace.none { color: var(--prizma-text-tertiary, var(--text-3)); }

/* === ГАНТ 3.0 · «Виды» — дропдаун + общий shell оверлея-режима (п.13-16,21,24,25) */
#btn-gantt3-views.active { border-color: var(--prizma-information); color: var(--prizma-information); background: var(--prizma-information-bg); }
#gdt-views-menu {
  position: fixed; z-index: 72; min-width: 220px; padding: 6px;
  background: var(--prizma-bg-elevated, var(--card)); border: 1px solid var(--prizma-border-strong, var(--border));
  border-radius: var(--r-md, 10px); box-shadow: 0 16px 44px rgba(0,0,0,.4); display: none;
}
#gdt-views-menu.open { display: block; }
#gdt-views-menu button { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: none; border: none; cursor: pointer; padding: 9px 11px; border-radius: var(--r-sm, 6px); color: var(--prizma-text-secondary, var(--text-2)); font: 500 13px/1.2 var(--font, inherit); }
#gdt-views-menu button:hover { background: var(--prizma-bg-tertiary, rgba(0,0,0,.05)); color: var(--prizma-text-primary, var(--text-1)); }
#gdt-views-menu button .vm-d { font: 500 10.5px/1.2 var(--mono, ui-monospace, monospace); color: var(--prizma-text-tertiary, var(--text-3)); margin-left: auto; }
/* shell оверлея */
#gdt-mode {
  position: fixed; inset: 0; z-index: 71; display: flex; flex-direction: column;
  background: var(--prizma-bg, var(--bg, #0A0A0F)); animation: gdtNarrIn .18s var(--ease-calm, ease);
}
#gdt-mode .gm-top { display: flex; align-items: center; gap: 12px; padding: 13px 22px; border-bottom: 1px solid var(--prizma-border, var(--border)); flex: none; }
#gdt-mode .gm-title { font-weight: 800; font-size: 16px; letter-spacing: -.01em; color: var(--prizma-text-primary, var(--text-1)); }
#gdt-mode .gm-sub { font: 500 12px/1 var(--mono, ui-monospace, monospace); color: var(--prizma-text-tertiary, var(--text-3)); }
#gdt-mode .gm-spacer { flex: 1; }
#gdt-mode .gm-act { background: none; border: 1px solid var(--prizma-border, var(--border)); border-radius: var(--r-sm, 6px); color: var(--prizma-text-secondary, var(--text-2)); cursor: pointer; padding: 6px 11px; font-size: 12px; }
#gdt-mode .gm-act:hover { color: var(--prizma-text-primary, var(--text-1)); border-color: var(--prizma-border-strong, var(--border)); }
#gdt-mode .gm-body { flex: 1; overflow: auto; min-height: 0; }
html:not([data-active-section="gantt3"]) #gdt-mode, html:not([data-active-section="gantt3"]) #gdt-views-menu { display: none !important; }
/* per-mode (компактно, токены) */
.gdt-dg { width: 100%; border-collapse: collapse; font: 12px/1.3 var(--font, inherit); }
.gdt-dg th, .gdt-dg td { padding: 8px 12px; border-bottom: 1px solid var(--prizma-border, var(--border)); text-align: left; white-space: nowrap; }
.gdt-dg th { position: sticky; top: 0; background: var(--prizma-bg-elevated, var(--card)); font: 700 10px/1 var(--font, inherit); letter-spacing: .5px; text-transform: uppercase; color: var(--prizma-text-tertiary, var(--text-3)); z-index: 2; user-select: none; }
.gdt-dg tbody tr:hover { background: var(--prizma-bg-elevated, rgba(0,0,0,.03)); }
.gdt-dg td:nth-child(2) { font-weight: 600; color: var(--prizma-text-primary, var(--text-1)); }
.gdt-dg .num { text-align: center; font-feature-settings: "tnum"; font-family: var(--mono, ui-monospace, monospace); }
.gdt-msplit { display: flex; height: 100%; }
.gdt-msplit .ms-list { width: 300px; flex: none; border-right: 1px solid var(--prizma-border, var(--border)); overflow-y: auto; padding: 8px 0; }
.gdt-msplit .ms-li { padding: 9px 16px 9px 18px; cursor: pointer; position: relative; border-bottom: 1px solid var(--prizma-border, var(--border)); }
.gdt-msplit .ms-li::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: transparent; }
.gdt-msplit .ms-li.sel { background: var(--prizma-bg-elevated, rgba(0,0,0,.04)); }
.gdt-msplit .ms-li.sel::before { background: var(--prizma-information); }
.gdt-msplit .ms-li .nm { font-size: 13px; font-weight: 600; color: var(--prizma-text-primary, var(--text-1)); }
.gdt-msplit .ms-li .mt { font: 500 10.5px/1.3 var(--mono, ui-monospace, monospace); color: var(--prizma-text-tertiary, var(--text-3)); margin-top: 3px; }
.gdt-msplit .ms-insp { flex: 1; overflow-y: auto; padding: 26px 32px; }
.gdt-card { max-width: 720px; }
.gdt-card .ic-nm { font-size: 24px; font-weight: 800; letter-spacing: -.02em; color: var(--prizma-text-primary, var(--text-1)); }
.gdt-card .ic-team { font: 600 11px/1 var(--mono, ui-monospace, monospace); color: var(--prizma-text-tertiary, var(--text-3)); margin-top: 6px; text-transform: uppercase; letter-spacing: .5px; }
.gdt-card .ic-track { margin: 20px 0; display: grid; gap: 6px; }
.gdt-card .ic-trk { display: flex; align-items: center; gap: 10px; }
.gdt-card .ic-trk .k { width: 60px; flex: none; text-align: right; font: 600 11px/1 var(--mono, ui-monospace, monospace); color: var(--prizma-text-tertiary, var(--text-3)); }
.gdt-card .ic-trk .v { display: flex; flex-wrap: wrap; gap: 4px; }
.gdt-wt { font: 600 11px/1 var(--font, inherit); padding: 4px 8px; border-radius: 5px; background: var(--prizma-bg-tertiary, rgba(0,0,0,.05)); color: var(--prizma-text-secondary, var(--text-2)); }
.gdt-wt.done { opacity: .5; text-decoration: line-through; }
.gdt-stats { display: flex; gap: 26px; margin: 18px 0; }
.gdt-stat .sv { font-size: 22px; font-weight: 800; color: var(--prizma-text-primary, var(--text-1)); font-feature-settings: "tnum"; }
.gdt-stat .sk { font: 600 10px/1 var(--font, inherit); text-transform: uppercase; letter-spacing: .5px; color: var(--prizma-text-tertiary, var(--text-3)); margin-top: 4px; }
.gdt-stat .sv.warn { color: var(--prizma-off-course); }
.gdt-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 1px; background: var(--prizma-border, var(--border)); border: 1px solid var(--prizma-border, var(--border)); border-radius: var(--r-md, 10px); overflow: hidden; }
.gdt-kpi { background: var(--prizma-bg, var(--card)); padding: 16px 18px; }
.gdt-kpi .kv { font-size: 26px; font-weight: 800; color: var(--prizma-text-primary, var(--text-1)); font-feature-settings: "tnum"; }
.gdt-kpi .kk { font: 600 10px/1 var(--font, inherit); text-transform: uppercase; letter-spacing: .5px; color: var(--prizma-text-tertiary, var(--text-3)); margin-top: 5px; }
.gdt-rep { max-width: 900px; margin: 0 auto; padding: 28px 20px 80px; }
.gdt-rep h2 { font: 700 13px/1 var(--font, inherit); text-transform: uppercase; letter-spacing: .6px; color: var(--prizma-text-tertiary, var(--text-3)); margin: 28px 0 12px; }
.gdt-rep .rk { display: flex; align-items: center; gap: 10px; padding: 8px 0 8px 12px; position: relative; border-bottom: 1px solid var(--prizma-border, var(--border)); }
.gdt-rep .rk::before { content: ""; position: absolute; left: 0; top: 6px; bottom: 6px; width: 3px; border-radius: 2px; background: var(--prizma-drift); }
.gdt-rep .rk.off::before { background: var(--prizma-off-course); }
.gdt-rep .cap { display: flex; align-items: center; gap: 12px; padding: 7px 0; }
.gdt-rep .cap .cn { width: 150px; flex: none; font-size: 12.5px; color: var(--prizma-text-secondary, var(--text-2)); }
.gdt-rep .cap .bar { flex: 1; height: 8px; border-radius: 4px; background: var(--prizma-bg-tertiary, rgba(0,0,0,.06)); overflow: hidden; }
.gdt-rep .cap .bar i { display: block; height: 100%; background: var(--prizma-information); }
.gdt-deck { position: relative; height: 100%; }
.gdt-deck .dk-slide { position: absolute; inset: 0; padding: 40px 56px; overflow-y: auto; opacity: 0; pointer-events: none; transition: opacity .3s var(--ease-calm, ease); }
.gdt-deck .dk-slide.on { opacity: 1; pointer-events: auto; }
.gdt-deck .dk-h { font-size: 32px; font-weight: 800; letter-spacing: -.02em; margin-bottom: 22px; color: var(--prizma-text-primary, var(--text-1)); }
.gdt-deck .dk-nav { position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; }
.gdt-deck .dk-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--prizma-border-strong, var(--border)); border: none; cursor: pointer; padding: 0; }
.gdt-deck .dk-dot.on { width: 22px; border-radius: 4px; background: var(--prizma-information); }
.gdt-mission { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; padding: 14px; height: 100%; grid-auto-rows: minmax(0, 1fr); }
.gdt-pan { background: var(--prizma-bg-elevated, var(--card)); border: 1px solid var(--prizma-border, var(--border)); border-radius: var(--r-md, 10px); padding: 13px 15px; overflow: auto; }
.gdt-pan .ph { font: 700 10px/1 var(--font, inherit); text-transform: uppercase; letter-spacing: .5px; color: var(--prizma-text-tertiary, var(--text-3)); margin-bottom: 10px; }
.gdt-heat { display: grid; gap: 3px; }
.gdt-heat .hr { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 3px; align-items: center; }
.gdt-heat .hc { height: 20px; border-radius: 3px; display: flex; align-items: center; justify-content: center; font: 600 9px/1 var(--mono, ui-monospace, monospace); color: var(--prizma-text-secondary, var(--text-2)); }
.gdt-scrub { padding: 18px 26px; border-bottom: 1px solid var(--prizma-border, var(--border)); }
.gdt-scrub input[type=range] { width: 100%; accent-color: var(--prizma-information); }
.gdt-scrub .sc-lbl { font: 600 12px/1 var(--mono, ui-monospace, monospace); color: var(--prizma-text-secondary, var(--text-2)); margin-bottom: 10px; }

/* === ГАНТ 3.0 · п.20 «Filter-chips» (lab sketch 25) ======================= */
#btn-gantt3-chips.active { border-color: var(--prizma-information); color: var(--prizma-information); background: var(--prizma-information-bg); }
#gdt-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; padding: 9px 18px 3px; }
#gdt-chips .gc-chip { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px 5px 13px; border: 1px solid var(--prizma-border, var(--border)); border-radius: 999px; background: none; cursor: pointer; font: 500 12px/1 var(--font, inherit); color: var(--prizma-text-secondary, var(--text-2)); }
#gdt-chips .gc-chip::before { content: ""; position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 0; height: 60%; background: var(--prizma-information); border-radius: 0 2px 2px 0; transition: width .15s; }
#gdt-chips .gc-chip.on { color: var(--prizma-information); border-color: var(--prizma-information); }
#gdt-chips .gc-chip.on::before { width: 3px; }
#gdt-chips .gc-chip .gc-n { font: 600 10.5px/1 var(--mono, ui-monospace, monospace); color: var(--prizma-text-tertiary, var(--text-3)); }
#gdt-chips .gc-chip[data-zero="1"] { opacity: .45; }
#gdt-chips .gc-res { margin-left: auto; font: 500 11px/1 var(--mono, ui-monospace, monospace); color: var(--prizma-text-tertiary, var(--text-3)); }
body.gdt-chips-on #section-gantt3 .gantt-row.gdt-chip-dim,
body.gdt-chips-on #section-gantt3 .gantt-team-header.gdt-chip-dim { opacity: .14; transition: opacity .25s var(--ease-calm, ease); }

/* === ГАНТ 3.0 · п.19 «Radial-menu» (lab sketch 27, посимпатичнее) ========= */
#gdt-radial { position: fixed; width: 232px; height: 232px; margin: -116px 0 0 -116px; z-index: 68; pointer-events: none; opacity: 0; transform: scale(.6); transition: opacity .14s var(--ease-calm, ease), transform .16s var(--ease-spring, cubic-bezier(.34,1.56,.64,1)); }
#gdt-radial.show { opacity: 1; transform: scale(1); pointer-events: auto; }
#gdt-radial svg { width: 100%; height: 100%; overflow: visible; }
#gdt-radial .rs-arc { fill: var(--prizma-bg-elevated, var(--card)); stroke: var(--prizma-border, var(--border)); stroke-width: 1; cursor: pointer; transition: fill .12s; }
#gdt-radial .rs-sect.hot .rs-arc { fill: color-mix(in srgb, var(--rs-acc, var(--prizma-information)) 18%, var(--prizma-bg-elevated, var(--card))); stroke: var(--rs-acc, var(--prizma-information)); }
#gdt-radial .rs-glyph { fill: none; stroke: var(--prizma-text-secondary, var(--text-2)); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
#gdt-radial .rs-sect.hot .rs-glyph { stroke: var(--rs-acc, var(--prizma-information)); }
#gdt-radial .rs-lab { fill: var(--prizma-text-tertiary, var(--text-3)); font: 700 8.5px/1 var(--font, sans-serif); text-anchor: middle; pointer-events: none; text-transform: uppercase; letter-spacing: .3px; }
#gdt-radial .rs-sect.hot .rs-lab { fill: var(--rs-acc, var(--prizma-information)); }
#gdt-radial .rs-hub { fill: var(--prizma-bg, #0A0A0F); stroke: var(--prizma-border-strong, var(--border)); stroke-width: 1; }
#gdt-radial .rs-hub-t { fill: var(--prizma-text-primary, var(--text-1)); font: 700 11px/1 var(--font, sans-serif); text-anchor: middle; pointer-events: none; }
#gdt-radial .rs-hub-t2 { fill: var(--prizma-text-tertiary, var(--text-3)); font: 600 8px/1 var(--mono, monospace); text-anchor: middle; pointer-events: none; }

/* === ГАНТ 3.0 · п.23 «Smart-suggest» (lab sketch 21) ====================== */
#btn-gantt3-suggest.active { border-color: var(--prizma-insight, #7C5CFF); color: var(--prizma-insight, #7C5CFF); background: color-mix(in srgb, var(--prizma-insight, #7C5CFF) 12%, transparent); }
#gdt-suggest { position: fixed; top: 0; right: 0; bottom: 0; width: 360px; max-width: 92vw; z-index: 66; display: flex; flex-direction: column; background: var(--prizma-bg-elevated, var(--card)); border-left: 1px solid var(--prizma-border-strong, var(--border)); box-shadow: -12px 0 36px rgba(0,0,0,.28); animation: gdtSuggIn .2s var(--ease-calm, ease); }
@keyframes gdtSuggIn { from { transform: translateX(20px); opacity: 0; } to { transform: none; opacity: 1; } }
#gdt-suggest .sg-top { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--prizma-border, var(--border)); }
#gdt-suggest .sg-title { font-weight: 700; font-size: 14px; color: var(--prizma-text-primary, var(--text-1)); }
#gdt-suggest .sg-close { margin-left: auto; background: none; border: none; cursor: pointer; color: var(--prizma-text-tertiary, var(--text-3)); font-size: 18px; line-height: 1; }
#gdt-suggest .sg-body { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
#gdt-suggest .sg-card { position: relative; padding: 12px 13px 12px 15px; border: 1px solid var(--prizma-border, var(--border)); border-radius: var(--r-md, 10px); }
#gdt-suggest .sg-card::before { content: ""; position: absolute; left: 0; top: 10px; bottom: 10px; width: 3px; border-radius: 2px; background: var(--prizma-insight, #7C5CFF); }
#gdt-suggest .sg-card.warn::before { background: var(--prizma-drift); }
#gdt-suggest .sg-card.crit::before { background: var(--prizma-off-course); }
#gdt-suggest .sg-ct { font-weight: 600; font-size: 13px; color: var(--prizma-text-primary, var(--text-1)); }
#gdt-suggest .sg-cw { font-size: 12px; line-height: 1.45; color: var(--prizma-text-secondary, var(--text-2)); margin-top: 5px; }
#gdt-suggest .sg-act { margin-top: 9px; background: none; border: 1px solid var(--prizma-border, var(--border)); border-radius: var(--r-sm, 6px); color: var(--prizma-text-secondary, var(--text-2)); cursor: pointer; padding: 5px 10px; font-size: 11.5px; }
#gdt-suggest .sg-act:hover { color: var(--prizma-information); border-color: var(--prizma-information); }
#gdt-suggest .sg-empty { color: var(--prizma-text-tertiary, var(--text-3)); font-size: 13px; text-align: center; padding: 30px 16px; line-height: 1.5; }
#section-gantt3 .gantt-row.gdt-flash { animation: gdtRowFlash 1.6s var(--ease-calm, ease); }
@keyframes gdtRowFlash { 0%,100% { background: transparent; } 25% { background: var(--prizma-information-bg); } }
html:not([data-active-section="gantt3"]) #gdt-suggest { display: none !important; }

/* === ГАНТ 3.0 · п.22 «Inline-edit» (lab sketch 22) ======================== */
#section-gantt3 .v16-epic-name { cursor: text; }
.gdt-inline-input { width: 100%; box-sizing: border-box; font: inherit; color: var(--prizma-text-primary, var(--text-1)); background: var(--prizma-bg, #fff); border: 1px solid var(--prizma-information); border-radius: 4px; padding: 1px 5px; outline: none; box-shadow: 0 0 0 3px var(--prizma-information-bg); }
#section-gantt3 .gantt-row.gdt-edit-saved { animation: gdtRowFlash 1s var(--ease-calm, ease); }

/* === ГАНТ 3.0 · п.18 «Merge-resolve» (lab sketch 29, превью-режим) ========= */
.gdt-merge { max-width: 760px; margin: 0 auto; padding: 24px 20px 70px; }
.gdt-merge .mg-note { font-size: 12px; color: var(--prizma-text-tertiary, var(--text-3)); margin-bottom: 16px; padding: 9px 12px; border: 1px dashed var(--prizma-border-strong, var(--border)); border-radius: var(--r-sm, 6px); }
.gdt-merge .mg-summary { display: flex; gap: 18px; font-size: 13px; margin-bottom: 16px; }
.gdt-merge .mg-summary .ok { color: var(--prizma-on-course); font-weight: 600; }
.gdt-merge .mg-summary .cf { color: var(--prizma-drift); font-weight: 600; }
.gdt-merge .mg-auto { border: 1px solid var(--prizma-border, var(--border)); border-radius: var(--r-md, 10px); margin-bottom: 18px; overflow: hidden; }
.gdt-merge .mg-auto-h { padding: 11px 14px; cursor: pointer; display: flex; gap: 8px; align-items: center; font-size: 13px; font-weight: 600; color: var(--prizma-text-secondary, var(--text-2)); }
.gdt-merge .mg-auto-b { max-height: 0; overflow: hidden; transition: max-height .25s var(--ease-calm, ease); }
.gdt-merge .mg-auto.open .mg-auto-b { max-height: 600px; }
.gdt-merge .mg-auto-row { padding: 8px 14px; border-top: 1px solid var(--prizma-border, var(--border)); font-size: 12.5px; color: var(--prizma-text-secondary, var(--text-2)); }
.gdt-merge .mg-auto-row b { color: var(--prizma-text-primary, var(--text-1)); }
.gdt-merge .mg-conf { border: 1px solid var(--prizma-border, var(--border)); border-left: 3px solid var(--prizma-drift); border-radius: var(--r-md, 10px); padding: 13px 15px; margin-bottom: 12px; }
.gdt-merge .mg-conf.resolved { border-left-color: var(--prizma-on-course); }
.gdt-merge .mg-conf.skipped { border-left-color: var(--prizma-text-tertiary, var(--text-3)); opacity: .7; }
.gdt-merge .mg-conf-t { font-size: 13px; font-weight: 600; color: var(--prizma-text-primary, var(--text-1)); margin-bottom: 9px; }
.gdt-merge .mg-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
.gdt-merge .mg-opt { border: 1px solid var(--prizma-border, var(--border)); border-radius: var(--r-sm, 6px); padding: 9px 11px; cursor: pointer; }
.gdt-merge .mg-opt:has(input:checked) { border-color: var(--prizma-information); background: var(--prizma-information-bg); }
.gdt-merge .mg-opt .ok2 { font: 600 9px/1 var(--font, inherit); text-transform: uppercase; letter-spacing: .4px; color: var(--prizma-text-tertiary, var(--text-3)); }
.gdt-merge .mg-opt .vv { font-size: 13px; color: var(--prizma-text-primary, var(--text-1)); margin-top: 4px; }
.gdt-merge .mg-skip { margin-top: 9px; background: none; border: none; color: var(--prizma-text-tertiary, var(--text-3)); cursor: pointer; font-size: 11.5px; text-decoration: underline; }
.gdt-merge .mg-apply { margin-top: 8px; background: var(--prizma-information); color: #fff; border: none; border-radius: var(--r-sm, 6px); padding: 9px 18px; cursor: pointer; font-size: 13px; font-weight: 600; }

/* === ГАНТ 3.0 · п.17 «Annotations-layer» (lab sketch 30) ================== */
#btn-gantt3-annot.active { border-color: var(--prizma-information); color: var(--prizma-information); background: var(--prizma-information-bg); }
body.gdt-annot-on #section-gantt3 .gantt-cell[data-row-id] { cursor: copy; }
.gdt-annot-marker { position: absolute; top: 3px; right: 3px; width: 8px; height: 8px; border-radius: 50%; background: var(--prizma-information); box-shadow: 0 0 0 2px var(--prizma-bg, #fff); cursor: pointer; z-index: 4; }
#gdt-annot-pop { position: fixed; z-index: 69; width: 240px; background: var(--prizma-bg-elevated, var(--card)); border: 1px solid var(--prizma-border-strong, var(--border)); border-radius: var(--r-md, 10px); box-shadow: 0 12px 36px rgba(0,0,0,.34); padding: 11px; animation: gdtAnatomyIn .14s var(--ease-calm, ease); }
#gdt-annot-pop .ga-ta { width: 100%; box-sizing: border-box; min-height: 64px; resize: vertical; font: 12.5px/1.4 var(--font, inherit); color: var(--prizma-text-primary, var(--text-1)); background: var(--prizma-bg, #fff); border: 1px solid var(--prizma-border, var(--border)); border-radius: var(--r-sm, 6px); padding: 7px 9px; outline: none; }
#gdt-annot-pop .ga-ta:focus { border-color: var(--prizma-information); }
#gdt-annot-pop .ga-row { display: flex; gap: 7px; margin-top: 9px; }
#gdt-annot-pop button { background: none; border: 1px solid var(--prizma-border, var(--border)); border-radius: var(--r-sm, 6px); cursor: pointer; padding: 5px 10px; font-size: 12px; color: var(--prizma-text-secondary, var(--text-2)); }
#gdt-annot-pop .ga-save { border-color: var(--prizma-information); color: var(--prizma-information); }
#gdt-annot-pop .ga-del { margin-left: auto; color: var(--prizma-off-course); border-color: transparent; }

/* === ГАНТ 3.0 · «Анатомия пилюли» (lab sketch 08, референс) ===============
   ВАЖНО: в реальном приложении нет --r-sm/--r-md/--r-lg (там --radius-*),
   поэтому фолбэки давали 10/6/14 — углы крупнее скетча. Задаём ЛАБОВЫЕ радиусы
   локально на .gpa, чтобы все .gpa-* совпали со скетчем 1-в-1 (4/6/10). */
#gdt-mode .gpa { --r-sm: 4px; --r-md: 6px; --r-lg: 10px; --r-xl: 14px; max-width: 1080px; margin: 0 auto; padding: 28px 24px 72px; }
#gdt-mode .gpa-head { margin-bottom: 22px; }
#gdt-mode .gpa-head h1 { font-size: 22px; font-weight: 800; letter-spacing: -.01em; margin: 6px 0 6px; color: var(--prizma-text-primary, var(--text-1)); }
#gdt-mode .gpa-head p { margin: 0; color: var(--prizma-text-secondary, var(--text-2)); font-size: 14px; max-width: 660px; line-height: 1.55; }
#gdt-mode .gpa-eyebrow { font: 700 10px/1 var(--font, inherit); letter-spacing: .6px; text-transform: uppercase; color: var(--prizma-text-tertiary, var(--text-3)); margin-bottom: 14px; }
#gdt-mode .gpa-sec { margin-top: 38px; }
#gdt-mode .gpa-stage { position: relative; background: var(--prizma-bg-elevated, var(--card)); border: 1px solid var(--prizma-border, var(--border)); border-radius: var(--r-lg, 14px); padding: 64px 40px 70px; min-height: 320px; }
#gdt-mode .gpa-leaders { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
#gdt-mode .gpa-specimen-wrap { display: flex; justify-content: center; align-items: center; min-height: 80px; }
#gdt-mode .gpa-spec { position: relative; display: inline-flex; align-items: center; gap: 12px; padding: 14px 20px 14px 22px; background: var(--prizma-bg-tertiary, rgba(0,0,0,.05)); border-radius: var(--r-md, 10px); user-select: none; min-width: 260px; }
#gdt-mode .gpa-spec::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--wt, var(--prizma-information)); border-radius: var(--r-md, 10px) 0 0 var(--r-md, 10px); }
#gdt-mode .gpa-spec .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
#gdt-mode .gpa-spec .body { display: flex; flex-direction: column; gap: 4px; }
#gdt-mode .gpa-spec .nm { font: 600 15px/1 var(--font, inherit); color: var(--prizma-text-primary, var(--text-1)); }
#gdt-mode .gpa-spec .meta { font: 500 11.5px/1 var(--mono, ui-monospace, monospace); color: var(--prizma-text-tertiary, var(--text-3)); letter-spacing: .2px; }
#gdt-mode .gpa-callout { position: absolute; max-width: 188px; }
#gdt-mode .gpa-callout .lab { font: 700 10px/1 var(--font, inherit); letter-spacing: .6px; text-transform: uppercase; color: var(--prizma-information); }
#gdt-mode .gpa-callout .desc { margin-top: 4px; font-size: 11.5px; line-height: 1.45; color: var(--prizma-text-secondary, var(--text-2)); }
#gdt-mode .gpa-callout.c-stripe { left: 24px; top: 26px; text-align: right; }
#gdt-mode .gpa-callout.c-name { right: 30px; top: 18px; }
#gdt-mode .gpa-callout.c-meta { right: 30px; bottom: 18px; }
#gdt-mode .gpa-callout.c-dot { left: 24px; bottom: 24px; text-align: right; }
#gdt-mode .gpa-variants { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
#gdt-mode .gpa-vcard { background: var(--prizma-bg-elevated, var(--card)); border: 1px solid var(--prizma-border, var(--border)); border-radius: var(--r-md, 10px); padding: 14px; }
#gdt-mode .gpa-vcard .vt { font: 700 10px/1 var(--font, inherit); letter-spacing: .6px; text-transform: uppercase; color: var(--prizma-text-tertiary, var(--text-3)); margin-bottom: 11px; }
#gdt-mode .gpa-vcard .vrow { display: flex; align-items: center; min-height: 38px; }
#gdt-mode .gpa-vcard .vn { margin-top: 9px; font-size: 11px; color: var(--prizma-text-tertiary, var(--text-3)); line-height: 1.4; }
#gdt-mode .gpa-pill { position: relative; display: inline-flex; align-items: center; gap: 8px; padding: 7px 11px 7px 13px; background: var(--prizma-bg-tertiary, rgba(0,0,0,.05)); border-radius: var(--r-sm, 6px); user-select: none; }
#gdt-mode .gpa-pill::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--wt, var(--prizma-information)); border-radius: var(--r-sm, 6px) 0 0 var(--r-sm, 6px); }
#gdt-mode .gpa-pill .nm { font: 600 12px/1 var(--font, inherit); color: var(--prizma-text-primary, var(--text-1)); }
#gdt-mode .gpa-pill .who { font: 500 10px/1 var(--mono, ui-monospace, monospace); color: var(--prizma-text-tertiary, var(--text-3)); }
#gdt-mode .gpa-pill .dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
#gdt-mode .gpa-pill[data-state="progress"]::after { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--prizma-information); flex: none; }
#gdt-mode .gpa-pill[data-state="done"] { opacity: .5; }
#gdt-mode .gpa-pill[data-state="done"] .nm { text-decoration: line-through; text-decoration-color: var(--prizma-text-tertiary, var(--text-3)); }
#gdt-mode .gpa-pill[data-state="unplanned"]::before { background: repeating-linear-gradient(135deg, var(--wt, var(--prizma-information)) 0 3px, transparent 3px 6px); }
#gdt-mode .gpa-pill.weighted::before { top: 50%; transform: translateY(-50%); height: var(--wh, 60%); bottom: auto; border-radius: 2px; }
#gdt-mode .gpa-ba { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
#gdt-mode .gpa-panel { background: var(--prizma-bg-elevated, var(--card)); border: 1px solid var(--prizma-border, var(--border)); border-radius: var(--r-md, 10px); padding: 20px; transition: opacity .3s var(--ease-calm, ease); }
#gdt-mode .gpa-panel.dim { opacity: .32; }
#gdt-mode .gpa-tag { font: 700 10px/1 var(--font, inherit); letter-spacing: .6px; text-transform: uppercase; margin-bottom: 16px; display: inline-flex; align-items: center; gap: 6px; }
#gdt-mode .gpa-tag.bad { color: var(--prizma-off-course); }
#gdt-mode .gpa-tag.good { color: var(--prizma-on-course); }
#gdt-mode .gpa-demo { display: flex; align-items: center; justify-content: center; min-height: 70px; }
#gdt-mode .gpa-note { margin-top: 16px; font-size: 11.5px; line-height: 1.5; color: var(--prizma-text-secondary, var(--text-2)); }
#gdt-mode .gpa-note b { color: var(--prizma-text-primary, var(--text-1)); font-weight: 600; }
#gdt-mode .gpa-oldpill { display: inline-flex; align-items: center; gap: 5px; padding: 6px 10px; background: var(--prizma-information); color: #0A0A0F; border-radius: var(--r-sm, 6px); box-shadow: 0 0 0 2px var(--prizma-off-course), 0 2px 10px rgba(0,0,0,.5); font: 700 9.5px/1.1 var(--font, inherit); letter-spacing: .2px; }
#gdt-mode .gpa-oldpill .sub { font-weight: 400; opacity: .85; }
#gdt-mode .gpa-principle { margin-top: 26px; text-align: center; }
#gdt-mode .gpa-principle .big { font: 600 18px/1.3 var(--font, inherit); letter-spacing: -.01em; color: var(--prizma-text-primary, var(--text-1)); }
#gdt-mode .gpa-principle .big .twochan { color: var(--prizma-information); }
#gdt-mode .gpa-principle .small { margin-top: 6px; font-size: 12.5px; color: var(--prizma-text-tertiary, var(--text-3)); }
#gdt-mode .gpa-batoggle { background: none; border: 1px solid var(--prizma-border, var(--border)); border-radius: var(--r-sm, 6px); color: var(--prizma-text-secondary, var(--text-2)); cursor: pointer; padding: 6px 11px; font-size: 12px; }

/* === ГАНТ 3.0 · z-index fix ===============================================
   Чром приложения: топбар z:100, сайдбар z:90, модалки z:1000+. Все наши
   fixed-оверлеи изначально стояли на 60–72 → их шапки с кнопкой «Закрыть»
   прятались ПОД топбаром/сайдбаром (выйти можно было только Esc). Поднимаем
   выше чрома, но ниже FAB(10000)/confirm-dialog(11500). */
#gdt-lens-wires, #gdt-lens-readout, #gdt-anatomy-pop, #gdt-peek, #gdt-radial,
#gdt-annot-pop, #gdt-marquee, #gdt-mq-bar, #gdt-suggest, #gdt-views-menu,
#gdt-narrative, #gdt-mode { z-index: 9100; }
#gdt-views-menu { z-index: 9200; }   /* дропдаун — поверх своего оверлея-режима */
`;
    const styleEl = document.createElement('style');
    styleEl.id = 'audit-art-gantt3-style';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  },
  render() {
    // F10 fix (codebase-01) + sj3 (codebase-05) — отметить рендер для guard'а.
    try { Services.App?.markRenderedNow?.(); } catch (_) {}
    /* AUDIT-ART #11/#12/#13 — runtime CSS-overrides поверх styles.css (без
       прямых правок styles.css во избежание merge-conflict'ов). Инжектим
       один раз; идемпотентно. */
    Gantt3View._auditArtInjectStyles();
    _injectPrizmaHeader('section-gantt3', 'gantt');
    Gantt3View.applyMode();            // V16 roadmap-2 (A4) — restore overview/default
    Gantt3View.applyDensity();         // V16 #5 — restore persisted density before chart paints
    Gantt3View.renderPillLegend();
    // Wave1 P-GR §B5/§B6 — Gantt3View.renderFilters() удалён вместе с DOM-узлом
    // `#gantt-filters` (см. index.html). Раньше метод был no-op, оставшийся
    // от старого фильтр-бара.
    Gantt3View.renderChart();
    Gantt3View.bindFullscreen();
    Gantt3View.bindExpandCollapse();
    Gantt3View.bindDensity();          // V16 #5
    Gantt3View.bindMode();             // V16 roadmap-2 (A4)
    Gantt3View.bindJumpPalette();      // V16 #5
    Gantt3View.bindKeyboardNav();      // V16 roadmap-2 (B6)
    Gantt3View.bindReleaseEditor();    // #1 C4 — «+ релиз» и edit через header
  },
  /**
   * #1 C4 — кнопка «+ релиз» в шапке Ганта открывает модалку CRUD. На
   * header-cell custom релиза cls-доп `gdt-custom-release` + клик на самой
   * заголовочной ячейке (но не на elements внутри) тоже открывает редактор.
   */
  bindReleaseEditor() {
    const btn = document.getElementById('btn-gantt3-add-release');
    if (btn && !btn._gdtReleaseBound) {
      btn._gdtReleaseBound = true;
      btn.addEventListener('click', async () => {
        const mod = await import('../components/releaseEditorModal.js');
        mod.openReleaseEditor({ onSaved: () => Gantt3View.renderChart() });
      });
    }
    const annoBtn = document.getElementById('btn-gantt3-annotations');
    if (annoBtn && !annoBtn._gdtAnnoBound) {
      annoBtn._gdtAnnoBound = true;
      annoBtn.addEventListener('click', async () => {
        const mod = await import('../components/cellAnnotationsBrowser.js');
        mod.openAnnotationsBrowser();
      });
    }
    // F2 — управление вехами/контрольными точками.
    const msBtn = document.getElementById('btn-gantt3-milestones');
    if (msBtn && !msBtn._gdtMsBound) {
      msBtn._gdtMsBound = true;
      msBtn.addEventListener('click', async () => {
        const mod = await import('../components/milestonesModal.js');
        mod.openMilestonesModal({ onSaved: () => Gantt3View.renderChart() });
      });
    }
  },
  /** V16 roadmap-2 (B6) — keyboard navigation across the gantt grid.
   *  Roving tabindex; ←/→/↑/↓ between pills; Enter/F2 ctx-menu; Esc blur. */
  bindKeyboardNav() {
    if (Gantt3View._kbBound) return;
    Gantt3View._kbBound = true;
    const wrap = document.getElementById('gantt3-wrap');
    if (!wrap) { Gantt3View._kbBound = false; return; }

    const allPills = () => Array.from(wrap.querySelectorAll('.gantt-type-pill[data-wt][data-row-id]:not(.gantt-pill-ghost)'));
    const setRoving = (target) => {
      allPills().forEach(p => { p.tabIndex = (p === target) ? 0 : -1; });
    };
    const focusPill = (target) => {
      if (!target) return;
      setRoving(target);
      target.focus({ preventScroll: false });
    };
    const sibling = (current, dir) => {
      const list = allPills();
      const idx = list.indexOf(current);
      if (idx < 0) return null;
      if (dir === 'left')  return list[idx - 1] || null;
      if (dir === 'right') return list[idx + 1] || null;
      const curRow = current.closest('.gantt-row');
      const allRows = Array.from(wrap.querySelectorAll('.gantt-row[data-row-id]'));
      const rIdx = allRows.indexOf(curRow);
      const targetRow = dir === 'up' ? allRows[rIdx - 1] : allRows[rIdx + 1];
      if (!targetRow) return null;
      const curCol = current.dataset.srcCol;
      const sameCol = targetRow.querySelector(`.gantt-cell[data-col="${window.CSS?.escape ? CSS.escape(curCol) : curCol}"] .gantt-type-pill[data-wt][data-row-id]:not(.gantt-pill-ghost)`);
      if (sameCol) return sameCol;
      return targetRow.querySelector('.gantt-type-pill[data-wt][data-row-id]:not(.gantt-pill-ghost)');
    };

    const setupRoving = () => {
      const list = allPills();
      if (!list.length) return;
      list.forEach((p, i) => { p.tabIndex = (i === 0) ? 0 : -1; });
    };
    setupRoving();
    // V22 G-03 (audit-experts-2026-05-15 Demin C3) — раньше:
    //   Gantt3View.renderChart = function(...args) { _orig(args); setupRoving(); }
    // monkey-patch перекрывал метод объекта-namespace. После HMR/тестов это
    // ломалось (cached reference). Решение: подписка на EventBus-событие
    // 'gantt3-rendered', которое Gantt3View эмитит в конце своего renderChart().
    // Идемпотентно: флаг _kbRovingSubscribed защищает от двойной подписки.
    if (!Gantt3View._kbRovingSubscribed) {
      Gantt3View._kbRovingSubscribed = true;
      try {
        const bus = (typeof globalThis !== 'undefined') ? globalThis.EventBus : null;
        if (bus && typeof bus.on === 'function') {
          bus.on('gantt3-rendered', () => {
            try { setupRoving(); } catch (_) {}
          });
        } else {
          // Fallback: subscribe to Reactive flush. Дешевле monkey-patch'а.
          if (typeof globalThis !== 'undefined' && globalThis.Reactive?.subscribe) {
            globalThis.Reactive.subscribe(() => {
              try { setupRoving(); } catch (_) {}
            });
          }
        }
      } catch (_) { /* defensive */ }
    }

    wrap.addEventListener('focusin', (e) => {
      const pill = e.target.closest?.('.gantt-type-pill[data-wt][data-row-id]:not(.gantt-pill-ghost)');
      if (pill) setRoving(pill);
    });

    wrap.addEventListener('keydown', (e) => {
      const focused = document.activeElement;
      if (!focused || !focused.matches('.gantt-type-pill[data-wt][data-row-id]:not(.gantt-pill-ghost)')) return;
      if (focused.matches('input, textarea, select')) return;
      let next = null;
      switch (e.key) {
        case 'ArrowLeft':  next = sibling(focused, 'left');  break;
        case 'ArrowRight': next = sibling(focused, 'right'); break;
        case 'ArrowUp':    next = sibling(focused, 'up');    break;
        case 'ArrowDown':  next = sibling(focused, 'down');  break;
        case 'Enter':
        case 'F2': {
          e.preventDefault();
          const r = focused.getBoundingClientRect();
          const ev = new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true,
            clientX: r.left + r.width / 2,
            clientY: r.top  + r.height / 2,
          });
          focused.dispatchEvent(ev);
          return;
        }
        case 'Escape':
          document.getElementById('gdt-ctx-menu')?.remove();
          focused.blur();
          return;
        default:
          return;
      }
      if (next) {
        e.preventDefault();
        focusPill(next);
      }
    });
  },
  /** V16 roadmap-2 (A4) — gantt zoom mode. Two states:
   *    'default'  — full detail, pills + epics + trails (what V16 ships now)
   *    'overview' — one row per team, per-bucket stacked bars showing
   *                 work-type distribution. Useful when 100+ teams
   *                 ×30+ tasks turn the screen into texture.
   *  Click on a team row in overview switches back to default + jumps. */
  applyMode() {
    let mode = 'default';
    try {
      const saved = localStorage.getItem('q2_gantt3_mode_v16');
      if (saved === 'overview' || saved === 'default') mode = saved;
    } catch (_) {}
    Gantt3View._dtMode = mode;
    document.body.dataset.gdtMode = mode;
  },
  bindMode() {
    const btn = document.getElementById('btn-gantt3-mode');
    if (!btn || btn._gdtModeBound) return;
    btn._gdtModeBound = true;
    // V21 — initial aria-pressed sync с текущим режимом.
    btn.setAttribute('aria-pressed', Gantt3View._dtMode === 'overview' ? 'true' : 'false');
    btn.addEventListener('click', () => {
      const next = Gantt3View._dtMode === 'overview' ? 'default' : 'overview';
      Gantt3View._dtMode = next;
      document.body.dataset.gdtMode = next;
      try { localStorage.setItem('q2_gantt3_mode_v16', next); } catch (_) {}
      btn.setAttribute('aria-pressed', next === 'overview' ? 'true' : 'false');
      btn.title = next === 'overview'
        ? 'Режим: Overview (клик → Default)'
        : 'Режим: Default (клик → Overview)';
      window.showToast?.(`Режим: ${next === 'overview' ? 'Overview' : 'Default'}`, 'info', 1400);
      // V16 roadmap-2 (B4) — preserve scroll anchor across re-render.
      Gantt3View._withScrollAnchor(() => Gantt3View.renderChart());
    });
  },
  /** V16 roadmap-2 (B4) — scroll-anchor helper. Toggles like density,
   *  mode, collapse-all rebuild the gantt body and the user's scroll
   *  position is lost. We snapshot the topmost-visible team-key just
   *  before the rebuild and re-scroll to its new position after. */
  _withScrollAnchor(fn) {
    const wrap = document.getElementById('gantt3-wrap');
    let anchorKey = null;
    if (wrap) {
      const wrapRect = wrap.getBoundingClientRect();
      const teams = wrap.querySelectorAll('.gantt-team-header[data-team-key]');
      for (const el of teams) {
        const r = el.getBoundingClientRect();
        if (r.bottom > wrapRect.top + 4) {
          anchorKey = el.dataset.teamKey;
          break;
        }
      }
    }
    fn();
    if (anchorKey && wrap) {
      requestAnimationFrame(() => {
        const target = wrap.querySelector(`.gantt-team-header[data-team-key="${window.CSS?.escape ? CSS.escape(anchorKey) : anchorKey}"]`);
        if (target?.scrollIntoView) {
          target.scrollIntoView({ behavior: 'instant', block: 'start' });
        }
      });
    }
  },
  /** V16 (gantt-roadmap #5) + V21 pills refresh — density toggle. Three
   *  states cycle: «regular» (Spine-pill 2-row, ~44 px) → «compact» (~32 px,
   *  meta-row hidden) → «minimal» (~22 px, единственная строка name+glyph,
   *  для overview-mode на больших проектах). Persisted to localStorage. */
  applyDensity() {
    let mode = 'regular';
    try {
      const saved = localStorage.getItem('q2_gantt3_density_v16');
      if (saved === 'compact' || saved === 'regular' || saved === 'minimal') mode = saved;
    } catch (_) {}
    document.body.dataset.gdtDensity = mode;
  },
  bindDensity() {
    const btn = document.getElementById('btn-gantt3-density');
    if (!btn || btn._gdtDensityBound) return;
    btn._gdtDensityBound = true;
    // Гант 3.0 п.7 — добавлен «Адаптивная» (auto) шаг в цикл: плотность
    // выбирается по числу видимых эпиков. _densityChoice хранит ВЫБОР юзера
    // (включая 'auto'), data-gdt-density — фактически применённое значение.
    const NEXT = { regular: 'compact', compact: 'minimal', minimal: 'auto', auto: 'regular' };
    const LABEL = { regular: 'Regular', compact: 'Compact', minimal: 'Minimal', auto: 'Адаптивная' };
    btn.addEventListener('click', () => {
      // V16 roadmap-2 (B4) — preserve scroll anchor: density attribute
      // change reflows row heights, but our anchor read still works
      // because team-header positions update synchronously.
      Gantt3View._withScrollAnchor(() => {
        const cur  = Gantt3View._densityChoice || document.body.dataset.gdtDensity || 'regular';
        const next = NEXT[cur] || 'regular';
        Gantt3View._densityChoice = next;
        if (next === 'auto') {
          Gantt3View._densityAuto = true;
          const applied = Gantt3View._densityApplyAuto();
          btn.title = `Плотность: Адаптивная → ${LABEL[applied]} (клик → Regular)`;
          btn.setAttribute('aria-label', `Плотность строк: Адаптивная (${LABEL[applied]})`);
          window.showToast?.(`Плотность: Адаптивная → ${LABEL[applied]}`, 'info', 1600);
        } else {
          Gantt3View._densityAuto = false;
          document.body.dataset.gdtDensity = next;
          try { localStorage.setItem('q2_gantt3_density_v16', next); } catch (_) {}
          btn.title = `Плотность: ${LABEL[next]} (клик → ${LABEL[NEXT[next]]})`;
          // V21 — sync aria-label с current density для screen-reader.
          btn.setAttribute('aria-label', `Плотность строк: ${LABEL[next]}`);
          window.showToast?.(`Плотность: ${LABEL[next]}`, 'info', 1400);
        }
      });
      // #7 — density change меняет row heights через CSS, но pre-render'ные
      // SVG-стрелки переносов остаются с устаревшими координатами. Re-draw
      // через двойной rAF (один кадр на CSS-reflow, второй на актуальные
      // bbox'ы pills). Также обновляем today-line.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const wrap = document.getElementById('gantt3-wrap');
        if (!wrap) return;
        try { Gantt3View.drawPostponeArrows(wrap); } catch (_) {}
        try { Gantt3View._positionTodayLine(wrap); } catch (_) {}
      }));
    });
  },
  /** Гант 3.0 п.7 — «Адаптивная» плотность: выбирает regular/compact/minimal по
   *  числу видимых эпиков (мало → свободно, много → плотно). Возвращает
   *  применённое значение. Пере-вызывается из post-render hook, пока выбран auto. */
  _densityApplyAuto() {
    const wrap = document.getElementById('gantt3-wrap');
    const n = wrap ? wrap.querySelectorAll('.gantt-row[data-epic-key]').length : 0;
    const applied = n < 12 ? 'regular' : n < 28 ? 'compact' : 'minimal';
    document.body.dataset.gdtDensity = applied;
    try { localStorage.setItem('q2_gantt3_density_v16', 'auto'); } catch (_) {}
    return applied;
  },
  /** V16 (gantt-roadmap #5) — Cmd+K palette: fuzzy search across teams +
   *  epics. Opens on ⌘K / Ctrl+K (and via the toolbar button). Selecting
   *  a result scrolls to the matching row and pulses a highlight ring. */
  bindJumpPalette() {
    if (Gantt3View._jumpBound) return;
    Gantt3View._jumpBound = true;
    // V21 — detect platform для корректного отображения хоткея (⌘K на macOS,
    // Ctrl+K на Windows/Linux). Палитра имеет один статический prompt в
    // index.html — обновляем его при первом bind.
    try {
      const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
      const promptEl = document.querySelector('.gdt-jump-prompt');
      if (promptEl) promptEl.textContent = isMac ? '⌘K' : 'Ctrl+K';
    } catch (_) {}
    document.getElementById('btn-gantt3-jump')?.addEventListener('click', () => Gantt3View.openJumpPalette());
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K' || e.key === 'л' || e.key === 'Л')) {
        // V16 roadmap-2 (S2) — don't swallow ⌘K when the user is typing.
        // Linear-style guard: skip if focus is in an editable element OR if
        // any modal-overlay is currently open (lock-modal, move-comment,
        // assign, complete, dates, etc.). Earlier behaviour ate users'
        // half-typed comments when they reflexively hit ⌘K mid-edit.
        if (state.activeSection !== 'gantt') return;
        const t = e.target;
        const isEditable = t && (
          t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          (t.isContentEditable === true)
        );
        if (isEditable) return;
        const modalOpen = !!document.querySelector('.modal-overlay:not(.hidden), #gdt-jump-palette:not(.hidden)');
        if (modalOpen) return;
        e.preventDefault();
        Gantt3View.openJumpPalette();
      }
    });
  },
  openJumpPalette() {
    const overlay = document.getElementById('gdt-jump-palette');
    const input   = document.getElementById('gdt-jump-input');
    const results = document.getElementById('gdt-jump-results');
    if (!overlay || !input || !results) return;
    // Wave3 P-GR — local `esc` shorthand. Pre-Wave3 the function referenced
    // a free `esc` identifier that was only ever resolvable via global scope
    // (Utils.escapeHtml never lived on `window`); the bug was inert because
    // the only code path reaching it required `state.rows.length > 0`. Now
    // that the task-by-id branch can render with empty state, we need a
    // proper local binding so `esc(tag)` doesn't ReferenceError.
    const esc = (s) => Utils.escapeHtml(s == null ? '' : String(s));

    // Build the searchable index every open — cheap, and keeps it fresh
    // after edits / imports without any subscribe wiring.
    const teams = Utils.unique((state.rows || []).map(r => r.team).filter(Boolean));
    const teamKeyFn = t => t.replace(/[^a-zA-Zа-яА-ЯёЁъЪ0-9]/g, '_');
    const items = [];
    for (const team of teams) {
      items.push({ kind: 'team', label: team, sub: 'команда', key: teamKeyFn(team), rowId: null });
    }
    for (const r of (state.rows || [])) {
      const epic = r.epic || r.tasks;
      if (!epic) continue;
      items.push({ kind: 'epic', label: epic, sub: r.team || '—', key: teamKeyFn(r.team || ''), rowId: r.id });
    }

    let active = 0;
    // Wave3 P-GR — task-by-id helper: матчит Jira-tag pattern (PROJ-123).
    // Если текст в палитре похож на тег — приоритетно ищем row, у которого
    // в `tasks` поле есть совпадение, и при выборе скроллим к строке.
    const TAG_RE = /^([A-Z][A-Z0-9]*)-?(\d+)$/i;
    const _searchTaskById = (query) => {
      const m = String(query || '').trim().match(TAG_RE);
      if (!m) return null;
      const tag = `${m[1].toUpperCase()}-${m[2]}`;
      for (const row of (state.rows || [])) {
        const haystack = String(row.tasks || '').toUpperCase();
        if (haystack.includes(tag)) return { row, tag };
      }
      return { row: null, tag };
    };
    const norm = (s) => String(s || '').toLowerCase();
    const score = (item, q) => {
      if (!q) return 1;
      const lab = norm(item.label);
      const sub = norm(item.sub);
      if (lab.startsWith(q)) return 100;
      if (lab.includes(q))    return 50;
      if (sub.includes(q))    return 20;
      // Cheap subseq match — every char of q appears in order in lab.
      let i = 0;
      for (const ch of lab) { if (i < q.length && ch === q[i]) i++; }
      return i === q.length ? 5 : 0;
    };
    const renderResults = () => {
      const qRaw = String(input.value || '').trim();
      const q = norm(input.value).trim();

      // Wave3 P-GR — task-by-id режим. Если запрос == Jira-tag, отдельная
      // ветка: показываем 1 item «Задача PROJ-1234 в строке X» (если
      // нашли) или fallback «не найдена в текущих строках».
      const tagHit = _searchTaskById(qRaw);
      if (tagHit) {
        const { row, tag } = tagHit;
        if (row) {
          const taskItem = {
            kind: 'task',
            label: tag,
            sub: row.epic || row.team || '—',
            key: teamKeyFn(row.team || ''),
            rowId: row.id,
          };
          if (active >= 1) active = 0;
          results.innerHTML = `
            <div class="gdt-jump-item${active === 0 ? ' is-active' : ''}" data-idx="0" data-kind="task" data-key="${esc(taskItem.key)}" data-row-id="${esc(taskItem.rowId || '')}">
              <span class="gdt-jump-kind gdt-jump-kind-task">task</span>
              <span class="gdt-jump-label">${esc(taskItem.label)}</span>
              <span class="gdt-jump-sub">${esc(taskItem.sub)}</span>
            </div>`;
          results._items = [taskItem];
          return;
        }
        // Tag-shape, но не нашли в state.rows — показываем явный fallback.
        results.innerHTML = `<div class="gdt-jump-empty">Задача ${esc(tag)} не найдена в текущих строках</div>`;
        results._items = [];
        active = 0;
        return;
      }

      const ranked = items
        .map(it => ({ it, s: score(it, q) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 40)
        .map(x => x.it);
      if (!ranked.length) {
        results.innerHTML = '<div class="gdt-jump-empty">Ничего не найдено</div>';
        active = 0;
        return;
      }
      if (active >= ranked.length) active = 0;
      results.innerHTML = ranked.map((it, idx) => `
        <div class="gdt-jump-item${idx === active ? ' is-active' : ''}" data-idx="${idx}" data-kind="${esc(it.kind)}" data-key="${esc(it.key)}" data-row-id="${esc(it.rowId || '')}">
          <span class="gdt-jump-kind gdt-jump-kind-${esc(it.kind)}">${it.kind === 'team' ? 'team' : 'epic'}</span>
          <span class="gdt-jump-label">${esc(it.label)}</span>
          <span class="gdt-jump-sub">${esc(it.sub)}</span>
        </div>`).join('');
      results._items = ranked;
    };
    const close = () => {
      overlay.classList.add('hidden');
      input.value = '';
      results.innerHTML = '';
      document.removeEventListener('keydown', onKey, true);
    };
    const jumpTo = (it) => {
      if (!it) return;
      close();
      // Make sure the team is expanded if collapsed.
      if (!Gantt3View._dtHiddenTeams) Gantt3View._dtHiddenTeams = new Set();
      if (it.key && Gantt3View._dtHiddenTeams.has(it.key)) {
        Gantt3View._dtHiddenTeams.delete(it.key);
        Gantt3View.renderChart();
      }
      // Find the target DOM node.
      requestAnimationFrame(() => {
        const wrap = document.getElementById('gantt3-wrap');
        if (!wrap) return;
        let target = null;
        if (it.kind === 'team') {
          target = wrap.querySelector(`.gantt-team-header[data-team-key="${cssEscape(it.key)}"]`);
        } else if ((it.kind === 'epic' || it.kind === 'task') && it.rowId) {
          // Wave3 P-GR — `task` kind reuses epic-row resolution: row is
          // the parent of all per-pill children, scroll-anchor совпадает.
          target = wrap.querySelector(`.gantt-row[data-row-id="${cssEscape(it.rowId)}"]`)
                || wrap.querySelector(`.gantt-cell[data-row-id="${cssEscape(it.rowId)}"]`)?.parentElement;
        }
        if (target?.scrollIntoView) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Wave3 P-GR — для task-by-id используем явный highlight-class
          // (gantt-row-highlight) поверх gdt-jump-pulse, чтобы CSS-анимация
          // была "выраженнее" (8px box-shadow вместо короткого pulse).
          if (it.kind === 'task') {
            target.classList.add('gantt-row-highlight');
            setTimeout(() => target.classList.remove('gantt-row-highlight'), 1600);
          } else {
            target.classList.add('gdt-jump-pulse');
            setTimeout(() => target.classList.remove('gdt-jump-pulse'), 1400);
          }
        }
      });
    };
    const cssEscape = (s) => (window.CSS?.escape ? window.CSS.escape(String(s)) : String(s).replace(/"/g, '\\"'));

    const onKey = (e) => {
      const list = results._items || [];
      if (e.key === 'Escape')      { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown')   { e.preventDefault(); active = Math.min(list.length - 1, active + 1); renderResults(); return; }
      if (e.key === 'ArrowUp')     { e.preventDefault(); active = Math.max(0, active - 1); renderResults(); return; }
      if (e.key === 'Enter')       { e.preventDefault(); jumpTo(list[active]); return; }
    };
    input.value = '';
    overlay.classList.remove('hidden');
    renderResults();
    setTimeout(() => input.focus(), 30);
    input.oninput = () => { active = 0; renderResults(); };
    document.addEventListener('keydown', onKey, true);

    // Click handlers — delegated to the results container so we don't
    // re-bind on every renderResults() call.
    results.onclick = (ev) => {
      const it = ev.target.closest('.gdt-jump-item');
      if (!it) return;
      const idx = Number(it.dataset.idx);
      jumpTo((results._items || [])[idx]);
    };
    overlay.onclick = (ev) => {
      if (ev.target === overlay) close();
    };
  },
  /** V15 Spine 2026-04-30 — collapsible pill-anatomy legend above the
   *  gantt. Default collapsed (single «💡 Подсказки» button). Click to
   *  expand into the full legend (anatomy demo + colodets + states +
   *  переносы). State persists in localStorage so a user who closes it
   *  doesn't have to close it again on every page load. */
  renderPillLegend() {
    const host = document.getElementById('gantt3-pill-legend');
    if (!host) return;
    const STORAGE_KEY = 'q2_gantt3_legend_open_v15';
    let openState = false;
    try {
      openState = localStorage.getItem(STORAGE_KEY) === '1';
    } catch (_) { /* private mode → default collapsed */ }

    const T = GANTT_LEGEND;
    const fullLegendHtml = `
      <div class="gdt-pill-legend-body">
        <div class="gdt-pill-legend-section gdt-pill-legend-anatomy">
          <div class="gdt-pill-legend-title">${T.sectionTitle.anatomy}</div>
          <div class="gdt-pill-legend-items">
            <span class="gdt-pill-legend-demo">
              <span class="gdt-pill-legend-stripe"></span>
              <span class="gdt-pill-legend-demo-body">
                <span class="gdt-pill-legend-demo-row1">
                  <span class="gdt-pill-legend-demo-name">${T.anatomy.demoName}</span>
                  <span class="gdt-pill-legend-demo-state-active"></span>
                  <span class="gdt-pill-legend-demo-cmt"></span>
                </span>
                <span class="gdt-pill-legend-demo-row2">${T.anatomy.demoMeta}</span>
              </span>
            </span>
            <span class="gdt-pill-legend-meta">${T.anatomy.description}</span>
          </div>
        </div>
        <div class="gdt-pill-legend-section">
          <div class="gdt-pill-legend-title">${T.sectionTitle.buckets}</div>
          <div class="gdt-pill-legend-items">
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-stripe-sample" style="background:var(--release-r120-color)"></span> ${T.bucket.r120}</span>
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-stripe-sample" style="background:var(--release-r121-color)"></span> ${T.bucket.r121}</span>
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-stripe-sample" style="background:var(--release-r122-color)"></span> ${T.bucket.r122}</span>
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-stripe-sample" style="background:var(--release-ot-color)"></span> ${T.bucket.ot}</span>
          </div>
        </div>
        <div class="gdt-pill-legend-section">
          <div class="gdt-pill-legend-title">${T.sectionTitle.states}</div>
          <div class="gdt-pill-legend-items">
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-state gdt-pill-legend-state-active"></span> ${T.state.active}</span>
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-state gdt-pill-legend-state-done">✓</span> ${T.state.done}</span>
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-state gdt-pill-legend-state-unplanned"></span> ${T.state.unplanned}</span>
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-cmt-square gdt-pill-legend-cmt-transfer"></span> ${T.state.transferComment}</span>
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-cmt-square gdt-pill-legend-cmt-add"></span> ${T.state.addedAfterLock}</span>
          </div>
        </div>
        <div class="gdt-pill-legend-section">
          <div class="gdt-pill-legend-title">${T.sectionTitle.transfers}</div>
          <div class="gdt-pill-legend-items">
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-icon">↗</span> ${T.transfer.from}</span>
            <span class="gdt-pill-legend-item"><span class="gdt-pill-legend-icon">↘</span> ${T.transfer.to}</span>
            <span class="gdt-pill-legend-item gdt-pill-legend-meta">${T.transfer.meta}</span>
          </div>
        </div>
      </div>`;

    // V17.1 C8 — внутренняя toggle-кнопка убрана (переехала в section-header
    // как `#btn-gantt3-tips-toggle`). Здесь оставляем только тело подсказок;
    // его открытое/закрытое состояние всё ещё хранится в localStorage и
    // переключается из section-header.
    host.dataset.open = openState ? '1' : '0';
    host.innerHTML = `<div class="gdt-pill-legend-content" data-open="${openState ? '1' : '0'}">${fullLegendHtml}</div>`;
    const sectionToggle = document.getElementById('btn-gantt3-tips-toggle');
    if (sectionToggle && !sectionToggle._gdtTipsBound) {
      sectionToggle._gdtTipsBound = true;
      sectionToggle.addEventListener('click', () => {
        const cur = host.dataset.open === '1';
        const next = !cur;
        host.dataset.open = next ? '1' : '0';
        const content = host.querySelector('.gdt-pill-legend-content');
        if (content) content.dataset.open = next ? '1' : '0';
        sectionToggle.classList.toggle('active', next);
        // V21 — sync aria-expanded для disclosure-pattern (screen-reader
        // понимает «open / closed» состояние подсказки-блока).
        sectionToggle.setAttribute('aria-expanded', next ? 'true' : 'false');
        try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch (_) {}
      });
      // initial active-class sync
      sectionToggle.classList.toggle('active', openState);
      sectionToggle.setAttribute('aria-expanded', openState ? 'true' : 'false');
    }
    // V17.1 C9 — History modal: shows action log filtered to gantt-related
    // entries. Idempotent guard prevents stacking listeners on every render.
    const histBtn = document.getElementById('btn-gantt3-history');
    if (histBtn && !histBtn._gdtHistBound) {
      histBtn._gdtHistBound = true;
      histBtn.addEventListener('click', () => Gantt3View._openHistoryModal());
    }
    // i4 (codebase-04 audit) — dependency-graph overlay.
    const depsBtn = document.getElementById('btn-gantt3-deps');
    if (depsBtn && !depsBtn._gdtDepsBound) {
      depsBtn._gdtDepsBound = true;
      depsBtn.addEventListener('click', () => {
        try { Services.DependencyGraphView?.toggle?.(); } catch (_) {}
      });
    }
    // Гант 3.0 п.2 — «Линза зависимостей» (sketch 09): in-context overlay,
    // в отличие от btn-gantt3-deps (отдельный граф-вид). Toggle режима.
    const lensBtn = document.getElementById('btn-gantt3-lens');
    if (lensBtn && !lensBtn._gdtLensBound) {
      lensBtn._gdtLensBound = true;
      lensBtn.addEventListener('click', () => Gantt3View._lensToggleMode());
    }
    // Гант 3.0 п.3 — «Фокус-дорожка» (toggle accordion-режима).
    const laneBtn = document.getElementById('btn-gantt3-focuslane');
    if (laneBtn && !laneBtn._gdtLaneBound) {
      laneBtn._gdtLaneBound = true;
      laneBtn.addEventListener('click', () => Gantt3View._focusLaneToggleMode());
    }
    // Гант 3.0 п.4 — «Командный режим» (toggle командной строки-фильтра).
    const cmdBtn = document.getElementById('btn-gantt3-cmd');
    if (cmdBtn && !cmdBtn._gdtCmdBound) {
      cmdBtn._gdtCmdBound = true;
      cmdBtn.addEventListener('click', () => Gantt3View._cmdToggleMode());
    }
    // Гант 3.0 п.6 — «Нарратив» (оверлей-документ квартала).
    const narrBtn = document.getElementById('btn-gantt3-narrative');
    if (narrBtn && !narrBtn._gdtNarrBound) {
      narrBtn._gdtNarrBound = true;
      narrBtn.addEventListener('click', () => Gantt3View._narrativeToggle());
    }
    // Гант 3.0 п.8 — «Курс» (north-star ось).
    const nsBtn = document.getElementById('btn-gantt3-northstar');
    if (nsBtn && !nsBtn._gdtNsBound) {
      nsBtn._gdtNsBound = true;
      nsBtn.addEventListener('click', () => Gantt3View._northstarToggle());
    }
    // Гант 3.0 п.11 — «Переносы» (plan-diff).
    const diffBtn = document.getElementById('btn-gantt3-diff');
    if (diffBtn && !diffBtn._gdtDiffBound) {
      diffBtn._gdtDiffBound = true;
      diffBtn.addEventListener('click', () => Gantt3View._diffToggle());
    }
    // Гант 3.0 п.12 — «Burndown».
    const bdBtn = document.getElementById('btn-gantt3-burndown');
    if (bdBtn && !bdBtn._gdtBdBound) {
      bdBtn._gdtBdBound = true;
      bdBtn.addEventListener('click', () => Gantt3View._burndownToggle());
    }
    // Гант 3.0 — «Виды» дропдаун (альт. представления).
    const viewsBtn = document.getElementById('btn-gantt3-views');
    if (viewsBtn && !viewsBtn._gdtViewsBound) {
      viewsBtn._gdtViewsBound = true;
      viewsBtn.addEventListener('click', (e) => { e.stopPropagation(); Gantt3View._viewsToggleMenu(); });
    }
    // Гант 3.0 п.20 — «Чипы».
    const chipsBtn = document.getElementById('btn-gantt3-chips');
    if (chipsBtn && !chipsBtn._gdtChipsBound) {
      chipsBtn._gdtChipsBound = true;
      chipsBtn.addEventListener('click', () => Gantt3View._chipsToggleMode());
    }
    // Гант 3.0 п.23 — «Подсказки» (smart-suggest).
    const sugBtn = document.getElementById('btn-gantt3-suggest');
    if (sugBtn && !sugBtn._gdtSugBound) {
      sugBtn._gdtSugBound = true;
      sugBtn.addEventListener('click', () => Gantt3View._suggestToggle());
    }
    // Гант 3.0 п.17 — «Слой заметок» (annotations).
    const annotBtn = document.getElementById('btn-gantt3-annot');
    if (annotBtn && !annotBtn._gdtAnnotBtnBound) {
      annotBtn._gdtAnnotBtnBound = true;
      annotBtn.addEventListener('click', () => Gantt3View._annotToggle());
    }
  },
  /** V17.1 C9 — собрать модалку истории изменений Ганта. Источник —
   *  state.actionLog (наполняется HistoryLog.data/.gantt + HistoryManager). */
  // V18.3 B1 — extracted to ./gantt/aux.js (60 LOC moved out).
  _openHistoryModal() { _auxHistoryModal(); },

  /** V17.1 C13 — «Добавить эпик» modal. V18.3 B1 — extracted to
   *  ./gantt/aux.js (110 LOC moved). onCreated callback вызывает
   *  Gantt3View.renderChart() — это дает aux.js быть pure без circular
   *  Gantt3View reference. */
  _openAddEpicModal(presetTeam) {
    _auxAddEpicModal(presetTeam, { onCreated: () => Gantt3View.renderChart() });
  },

  /* ═══════════════════════════════════════════════════════════════════════
     Гант 3.0 · п.2 — «ЛИНЗА ЗАВИСИМОСТЕЙ» (порт lab sketch 09-dependency-lens)
     Toggle-режим поверх живого Ганта: наводишь на эпик-строку — несвязанное
     гаснет, проявляется цепочка (предки=зависит-от/синий, потомки=блокирует/
     красный, крит-путь/жёлтый). Провода — fixed SVG-overlay (getBoundingRect,
     перерисовка на scroll/resize). Click=lock, Esc/повторный клик=выход.
     Граф из state.epicDeps (multi-deps массивы, cycle-safe). Всё scoped под
     #section-gantt3 / собственные id — оригинальный Гант не затронут.
     ═══════════════════════════════════════════════════════════════════════ */
  _lensToggleMode() {
    if (Gantt3View._lens.on) Gantt3View._lensExit();
    else                     Gantt3View._lensEnter();
  },
  _lensEnter() {
    const L = Gantt3View._lens;
    L.on = true;
    const btn = document.getElementById('btn-gantt3-lens');
    if (btn) { btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true'); }
    document.body.classList.add('gdt-lens-on');
    Gantt3View._lensEnsureChrome();
    Gantt3View._lensBuildGraph();
    Gantt3View._lensBindRows();
    // Esc выходит из режима — но ТОЛЬКО когда активна вкладка Гант 3.0, иначе
    // глобальный capture-listener воровал бы Escape у модалок других разделов.
    L.onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (document.documentElement.dataset.activeSection !== 'gantt3') return;
      e.preventDefault();
      Gantt3View._lensExit();
    };
    document.addEventListener('keydown', L.onKey, true);
    L.onScroll = () => Gantt3View._lensScheduleRedraw();
    window.addEventListener('scroll', L.onScroll, true);   // capture: ловим и вложенные скроллеры
    window.addEventListener('resize', L.onScroll);
    Gantt3View._lensRenderReadoutEmpty();
    try { Services.Toast?.info?.('Линза зависимостей: наведите на эпик. Esc — выйти.', { ms: 2600 }); } catch (_) {}
  },
  _lensExit() {
    const L = Gantt3View._lens;
    Gantt3View._lensClearFocus();
    L.on = false; L.locked = false; L.focusKey = null;
    const btn = document.getElementById('btn-gantt3-lens');
    if (btn) { btn.classList.remove('active'); btn.setAttribute('aria-pressed', 'false'); }
    document.body.classList.remove('gdt-lens-on');
    if (L.onKey)    { document.removeEventListener('keydown', L.onKey, true); L.onKey = null; }
    if (L.onScroll) { window.removeEventListener('scroll', L.onScroll, true); window.removeEventListener('resize', L.onScroll); L.onScroll = null; }
    if (L._raf)     { cancelAnimationFrame(L._raf); L._raf = 0; }
    if (L.overlay)  { L.overlay.remove(); L.overlay = null; }
    if (L.readout)  { L.readout.remove(); L.readout = null; }
    L.graph = null; L.els = null;
  },
  _lensEnsureChrome() {
    const L = Gantt3View._lens;
    if (!L.overlay) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'gdt-lens-wires'; svg.setAttribute('aria-hidden', 'true');
      document.body.appendChild(svg);
      L.overlay = svg;
    }
    if (!L.readout) {
      const div = document.createElement('div');
      div.id = 'gdt-lens-readout';
      document.body.appendChild(div);
      L.readout = div;
    }
  },
  /** Строит граф зависимостей из state.epicDeps. Ключ эпика = row.epic.
   *  epicDeps[from] = to | [to,…] означает «from зависит от to» (to — предок).
   *  Cycle-safe: транзитивные множества через visited-guard, длиннейшие цепи
   *  (крит-путь) — через on-stack guard (реальные dep-графы ацикличны, но от
   *  кривых данных не должно зависать). */
  _lensBuildGraph() {
    const L = Gantt3View._lens;
    const deps = (state && state.epicDeps) ? state.epicDeps : {};
    const keys = new Set();
    (state.rows || []).forEach(r => { const k = String(r.epic || r.tasks || '').trim(); if (k) keys.add(k); });
    Object.keys(deps).forEach(k => keys.add(String(k)));
    Object.values(deps).forEach(v => (Array.isArray(v) ? v : [v]).forEach(t => { if (t) keys.add(String(t)); }));

    const depsOf = (k) => { const v = deps[k]; return (Array.isArray(v) ? v : (v ? [v] : [])).map(String).filter(Boolean); };
    const directChildren = {}; keys.forEach(k => directChildren[k] = []);
    keys.forEach(k => depsOf(k).forEach(d => { (directChildren[d] = directChildren[d] || []).push(k); }));

    const ancestorsOf = {}, descendantsOf = {};
    const collectAnc  = (k, acc) => depsOf(k).forEach(d => { if (!acc.has(d)) { acc.add(d); collectAnc(d, acc); } });
    const collectDesc = (k, acc) => (directChildren[k] || []).forEach(c => { if (!acc.has(c)) { acc.add(c); collectDesc(c, acc); } });
    keys.forEach(k => {
      const a = new Set(); collectAnc(k, a);  a.delete(k); ancestorsOf[k]   = a;
      const d = new Set(); collectDesc(k, d); d.delete(k); descendantsOf[k] = d;
    });

    const upMemo = {}, downMemo = {};
    const longestUp = (k, stack) => {
      if (upMemo[k]) return upMemo[k];
      stack = stack || new Set();
      if (stack.has(k)) return [];
      stack.add(k);
      let best = [];
      depsOf(k).forEach(d => { const ch = longestUp(d, stack).concat([d]); if (ch.length > best.length) best = ch; });
      stack.delete(k);
      return (upMemo[k] = best);
    };
    const longestDown = (k, stack) => {
      if (downMemo[k]) return downMemo[k];
      stack = stack || new Set();
      if (stack.has(k)) return [];
      stack.add(k);
      let best = [];
      (directChildren[k] || []).forEach(c => { const ch = [c].concat(longestDown(c, stack)); if (ch.length > best.length) best = ch; });
      stack.delete(k);
      return (downMemo[k] = best);
    };
    const criticalPath = (k) => longestUp(k).concat([k]).concat(longestDown(k));

    L.graph = { keys, depsOf, directChildren, ancestorsOf, descendantsOf, criticalPath };
  },
  /** Карта epicKey → первый row-элемент в DOM (для подсветки + якорей проводов). */
  _lensMapEls() {
    const wrap = document.getElementById('gantt3-wrap');
    const els = {};
    if (wrap) wrap.querySelectorAll('.gantt-row[data-epic-key]').forEach(el => {
      const k = el.getAttribute('data-epic-key');
      if (k && !els[k]) els[k] = el;
    });
    Gantt3View._lens.els = els;
    return els;
  },
  /** Делегированные слушатели на #gantt3-wrap (переживают innerHTML-ре-рендер,
   *  т.к. wrap-элемент не пересоздаётся). Idempotent через wrap._gdtLensBound. */
  _lensBindRows() {
    const wrap = document.getElementById('gantt3-wrap');
    if (!wrap) return;
    Gantt3View._lensMapEls();
    if (wrap._gdtLensBound) return;
    wrap._gdtLensBound = true;
    wrap.addEventListener('mouseover', (e) => {
      const L = Gantt3View._lens;
      if (!L.on || L.locked) return;
      const row = e.target.closest('.gantt-row[data-epic-key]');
      if (!row) return;
      const k = row.getAttribute('data-epic-key');
      if (k && k !== L.focusKey) Gantt3View._lensFocus(k);
    });
    wrap.addEventListener('mouseleave', () => {
      const L = Gantt3View._lens;
      if (L.on && !L.locked) Gantt3View._lensClearFocus();
    });
    wrap.addEventListener('click', (e) => {
      const L = Gantt3View._lens;
      if (!L.on) return;
      const row = e.target.closest('.gantt-row[data-epic-key]');
      if (!row) return;
      // не воровать клики у интерактивных контролов строки
      if (e.target.closest('button, a, input, select, textarea, .gantt-type-pill, .v16-epic-deps-badge, .v16-epic-deps-edit')) return;
      const k = row.getAttribute('data-epic-key');
      if (!k) return;
      e.preventDefault(); e.stopPropagation();
      if (L.locked && L.focusKey === k) { L.locked = false; Gantt3View._lensFocus(k); }
      else { L.locked = true; Gantt3View._lensFocus(k); }
    });
  },
  _lensFocus(key) {
    const L = Gantt3View._lens;
    if (!L.on) return;
    if (!L.graph) Gantt3View._lensBuildGraph();
    const wrap = document.getElementById('gantt3-wrap');
    if (!wrap) return;
    L.focusKey = key;
    const G = L.graph;
    const anc  = G.ancestorsOf[key]   || new Set();
    const desc = G.descendantsOf[key] || new Set();
    const crit = G.criticalPath(key);
    const critSet = new Set(crit);
    const els = Gantt3View._lensMapEls();

    wrap.classList.add('gdt-lens-focusing');
    Gantt3View._lensStripRowDecor(wrap);
    const addCls = (k, ...cls) => { const el = els[k]; if (el) el.classList.add('gdt-lens-chain', ...cls); };
    addCls(key, 'gdt-lens-focus');
    anc.forEach(a  => addCls(a,  'gdt-lens-anc'));
    desc.forEach(d => addCls(d, 'gdt-lens-desc'));
    crit.forEach(c => { if (els[c]) els[c].classList.add('gdt-lens-chain', 'gdt-lens-crit'); });
    Gantt3View._lensAddRole(els[key], 'foc', 'фокус');
    anc.forEach(a  => Gantt3View._lensAddRole(els[a],  'anc',  'предок'));
    desc.forEach(d => Gantt3View._lensAddRole(els[d], 'desc', 'потомок'));

    Gantt3View._lensDrawWires(key, anc, desc, critSet);
    Gantt3View._lensRenderReadout(key, anc, desc, crit);
  },
  _lensClearFocus() {
    const L = Gantt3View._lens;
    L.focusKey = null;
    const wrap = document.getElementById('gantt3-wrap');
    if (wrap) { wrap.classList.remove('gdt-lens-focusing'); Gantt3View._lensStripRowDecor(wrap); }
    if (L.overlay) L.overlay.innerHTML = '';
    if (L.on) Gantt3View._lensRenderReadoutEmpty();
  },
  _lensStripRowDecor(wrap) {
    wrap = wrap || document.getElementById('gantt3-wrap');
    if (!wrap) return;
    wrap.querySelectorAll('.gdt-lens-chain,.gdt-lens-focus,.gdt-lens-anc,.gdt-lens-desc,.gdt-lens-crit')
      .forEach(el => el.classList.remove('gdt-lens-chain','gdt-lens-focus','gdt-lens-anc','gdt-lens-desc','gdt-lens-crit'));
    wrap.querySelectorAll('.gdt-lens-role').forEach(el => el.remove());
  },
  _lensAddRole(rowEl, cls, text) {
    if (!rowEl) return;
    const sub = rowEl.querySelector('.v16-epic-sub');
    if (!sub || sub.querySelector('.gdt-lens-role.' + cls)) return;
    const span = document.createElement('span');
    span.className = 'gdt-lens-role ' + cls;
    span.textContent = text;
    sub.insertBefore(span, sub.firstChild);
  },
  /** Рисует провода в fixed-overlay: якорь — правый край лейбла строки (живой
   *  getBoundingClientRect, поэтому переживает любой scroll/sticky при redraw).
   *  Безье изгибается в левый гаттер. Крит-путь — жирная сплошная, прочее —
   *  тонкий пунктир. */
  _lensDrawWires(key, anc, desc, critSet) {
    const L = Gantt3View._lens;
    const svg = L.overlay; if (!svg) return;
    const els = L.els || Gantt3View._lensMapEls();
    const focusEl = els[key];
    if (!focusEl) { svg.innerHTML = ''; return; }
    const anchor = (el) => {
      const label = el.querySelector('.gantt-row-label') || el;
      const r = label.getBoundingClientRect();
      return { x: r.right - 6, y: r.top + r.height / 2 };
    };
    const fa = anchor(focusEl);
    let s = '';
    const wire = (toEl, color, onCrit) => {
      if (!toEl) return;
      const b = anchor(toEl);
      const dx = Math.max(26, Math.min(90, Math.abs(b.y - fa.y) * 0.18 + 26));
      const cx = Math.min(fa.x, b.x) - dx;
      s += '<path d="M' + fa.x.toFixed(1) + ' ' + fa.y.toFixed(1) +
           ' C ' + cx.toFixed(1) + ' ' + fa.y.toFixed(1) + ', ' +
           cx.toFixed(1) + ' ' + b.y.toFixed(1) + ', ' +
           b.x.toFixed(1) + ' ' + b.y.toFixed(1) + '" fill="none" stroke="' + color +
           '" stroke-width="' + (onCrit ? 2.2 : 1.3) + '"' + (onCrit ? '' : ' stroke-dasharray="4 3"') +
           ' opacity="' + (onCrit ? 1 : 0.8) + '"/>';
      s += '<circle cx="' + b.x.toFixed(1) + '" cy="' + b.y.toFixed(1) + '" r="' + (onCrit ? 3 : 2.3) + '" fill="' + color + '"/>';
    };
    anc.forEach(a  => wire(els[a],  'var(--prizma-information)', critSet.has(a)));
    desc.forEach(d => wire(els[d], 'var(--prizma-off-course)',  critSet.has(d)));
    svg.innerHTML = s;
  },
  _lensScheduleRedraw() {
    const L = Gantt3View._lens;
    if (!L.on || !L.focusKey || L._raf) return;
    L._raf = requestAnimationFrame(() => {
      L._raf = 0;
      const G = L.graph;
      if (!L.on || !L.focusKey || !G) return;
      Gantt3View._lensDrawWires(
        L.focusKey,
        G.ancestorsOf[L.focusKey]   || new Set(),
        G.descendantsOf[L.focusKey] || new Set(),
        new Set(G.criticalPath(L.focusKey))
      );
    });
  },
  _lensRenderReadout(key, anc, desc, crit) {
    const L = Gantt3View._lens; const ro = L.readout; if (!ro) return;
    const esc = (s) => Utils.escapeHtml(String(s));
    const short = (k) => k.split(/\s+/).slice(0, 2).join(' ');
    const critLabels = crit.length > 1
      ? crit.map(c => c === key ? '<b>' + esc(short(c)) + '</b>' : esc(short(c))).join(' → ')
      : '— (изолирован)';
    ro.innerHTML =
      '<div class="lr-title">' + esc(key) + '</div>' +
      '<div class="lr-counts"><span class="dep">зависит от ' + anc.size + '</span><span class="blk">блокирует ' + desc.size + '</span></div>' +
      '<div class="lr-crit">крит-путь: ' + critLabels + '</div>' +
      '<div class="lr-hint">' + (L.locked ? 'Закреплено · клик по эпику снимет' : 'Клик — закрепить') + ' · <kbd>Esc</kbd> выход</div>';
  },
  _lensRenderReadoutEmpty() {
    const ro = Gantt3View._lens.readout; if (!ro) return;
    ro.innerHTML =
      '<div class="lr-empty">Наведите эпик — проявится его цепочка зависимостей.</div>' +
      '<div class="lr-legend">' +
        '<span><i style="border-color:var(--prizma-information)"></i>зависит от</span>' +
        '<span><i style="border-color:var(--prizma-off-course)"></i>блокирует</span>' +
        '<span><i style="border-color:var(--prizma-drift)"></i>крит-путь</span>' +
      '</div>' +
      '<div class="lr-hint"><kbd>Esc</kbd> — выйти из режима</div>';
  },

  /* ═══════════════════════════════════════════════════════════════════════
     Гант 3.0 · п.3 — «ФОКУС-ДОРОЖКА» (порт lab redesign 02-swimlane-focus)
     Progressive disclosure / аккордеон поверх существующего collapse: ровно
     одна команда раскрыта детально, остальные свёрнуты в тихую сводку
     (team-header + bucket-ячейки нагрузки). Клик по любому team-header
     переключает фокус. Реюзает _dtHiddenTeams + .is-team-collapsed (как
     chevron-handler) — class-toggle без полного ре-рендера. Повторный клик
     кнопки = выход (все команды раскрываются).
     ═══════════════════════════════════════════════════════════════════════ */
  _focusLaneTeamKeys() {
    const wrap = document.getElementById('gantt3-wrap');
    if (!wrap) return [];
    return [...wrap.querySelectorAll('.gantt-team-header[data-team-key]')].map(h => h.dataset.teamKey);
  },
  _focusLaneToggleMode() {
    if (Gantt3View._focusLane.on) Gantt3View._focusLaneExit();
    else                          Gantt3View._focusLaneEnter();
  },
  _focusLaneEnter() {
    const FL = Gantt3View._focusLane;
    const keys = Gantt3View._focusLaneTeamKeys();
    if (!keys.length) { try { Services.Toast?.info?.('Нет команд для фокуса'); } catch (_) {} return; }
    FL.on = true;
    const btn = document.getElementById('btn-gantt3-focuslane');
    if (btn) { btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true'); }
    document.body.classList.add('gdt-focuslane-on');
    if (!Gantt3View._dtHiddenTeams) Gantt3View._dtHiddenTeams = new Set();
    Gantt3View._focusLaneBind();
    // фокус на ранее выбранную (если ещё в DOM) либо на первую команду
    const tk = (FL.team && keys.includes(FL.team)) ? FL.team : keys[0];
    Gantt3View._focusLaneSetFocus(tk, { silent: true });
    try { Services.Toast?.info?.('Фокус-дорожка: клик по команде раскрывает её, остальные — в сводку. Кнопка ещё раз — выход.', { ms: 2800 }); } catch (_) {}
  },
  _focusLaneExit() {
    const FL = Gantt3View._focusLane;
    FL.on = false;
    const btn = document.getElementById('btn-gantt3-focuslane');
    if (btn) { btn.classList.remove('active'); btn.setAttribute('aria-pressed', 'false'); }
    document.body.classList.remove('gdt-focuslane-on');
    // развернуть все команды (фокус-режим — отдельный слой; на выходе чистим)
    if (Gantt3View._dtHiddenTeams) Gantt3View._dtHiddenTeams.clear();
    const wrap = document.getElementById('gantt3-wrap');
    if (wrap) {
      wrap.querySelectorAll('.gantt-row.is-team-collapsed').forEach(r => r.classList.remove('is-team-collapsed'));
      wrap.querySelectorAll('.gantt-team-header.gdt-lane-focus').forEach(h => h.classList.remove('gdt-lane-focus'));
      wrap.querySelectorAll('.gantt-team-vis-btn').forEach(b => Gantt3View._focusLaneSetChevron(b, false));
    }
  },
  _focusLaneSetFocus(tk, opts) {
    const FL = Gantt3View._focusLane;
    if (!tk) return;
    FL.team = tk;
    const wrap = document.getElementById('gantt3-wrap');
    if (!wrap) return;
    const keys = Gantt3View._focusLaneTeamKeys();
    // _dtHiddenTeams = все кроме фокусной → полный ре-рендер останется консистентен
    if (!Gantt3View._dtHiddenTeams) Gantt3View._dtHiddenTeams = new Set();
    Gantt3View._dtHiddenTeams.clear();
    keys.forEach(k => { if (k !== tk) Gantt3View._dtHiddenTeams.add(k); });
    // class-toggle без полного ре-рендера (тот же приём, что у chevron-handler)
    wrap.querySelectorAll('.gantt-row[data-team-key]').forEach(r => {
      r.classList.toggle('is-team-collapsed', r.dataset.teamKey !== tk);
    });
    wrap.querySelectorAll('.gantt-team-header[data-team-key]').forEach(h => {
      const isFocus = h.dataset.teamKey === tk;
      h.classList.toggle('gdt-lane-focus', isFocus);
      const btn = h.querySelector('.gantt-team-vis-btn');
      if (btn) Gantt3View._focusLaneSetChevron(btn, !isFocus);
    });
    if (!opts || !opts.silent) {
      const hd = wrap.querySelector('.gantt-team-header.gdt-lane-focus');
      if (hd) hd.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  },
  _focusLaneSetChevron(btn, collapsed) {
    try { btn.innerHTML = Services.Icons?.get?.(collapsed ? 'chevron-right' : 'chevron-down', { size: 12 }) || ''; } catch (_) {}
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    btn.setAttribute('aria-label', collapsed ? 'Развернуть команду' : 'Свернуть команду');
  },
  _focusLaneBind() {
    const wrap = document.getElementById('gantt3-wrap');
    if (!wrap || wrap._gdtFocusLaneBound) return;
    wrap._gdtFocusLaneBound = true;
    // capture-фаза: перехватываем клик по team-header РАНЬШЕ per-button
    // chevron-handler'а (bubble) и переводим его в смену фокуса (аккордеон).
    wrap.addEventListener('click', (e) => {
      if (!Gantt3View._focusLane.on) return;            // вне режима — обычное поведение chevron
      const hd = e.target.closest('.gantt-team-header[data-team-key]');
      if (!hd) return;
      if (e.target.closest('.gdt-team-add-epic')) return;  // «+» добавить эпик не воруем
      e.stopPropagation(); e.preventDefault();
      Gantt3View._focusLaneSetFocus(hd.dataset.teamKey);
    }, true);
  },

  /* ═══════════════════════════════════════════════════════════════════════
     Гант 3.0 · п.4 — «КОМАНДНЫЙ РЕЖИМ» (порт lab redesign 04-command-driven)
     Командная строка над чартом фильтрует/подсвечивает Гант как тихий backdrop.
     Каталог подсказок строится DOM-скан'ом текущего #gantt3-wrap (team-key /
     epic-key / pill[data-wt] / cell[data-col] / risk-glyph) — без связки с
     внутренней моделью, естественно отражает текущие фильтры/видимые данные.
     Фильтры — closures над строковыми ключами (не над DOM-нодами), поэтому
     переживают ре-рендер. Клавиатура: / фокус, ↑↓ выбор, ↵ применить, esc
     сброс/выход. Повторный клик кнопки = выход.
     ═══════════════════════════════════════════════════════════════════════ */
  _cmdToggleMode() {
    if (Gantt3View._cmd.on) Gantt3View._cmdExit();
    else                    Gantt3View._cmdEnter();
  },
  _cmdEnter() {
    const C = Gantt3View._cmd;
    C.on = true;
    const btn = document.getElementById('btn-gantt3-cmd');
    if (btn) { btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true'); }
    document.body.classList.add('gdt-cmd-on');
    Gantt3View._cmdEnsureBar();
    // глобальный «/» — фокус строки (только когда вкладка Гант 3.0 активна и
    // мы не печатаем уже в каком-то поле).
    C.onKey = (e) => {
      if (e.key !== '/') return;
      if (document.documentElement.dataset.activeSection !== 'gantt3') return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      e.preventDefault();
      document.getElementById('gdt-cmd-input')?.focus();
    };
    document.addEventListener('keydown', C.onKey, true);
    const inp = document.getElementById('gdt-cmd-input');
    if (inp) inp.focus();
    Gantt3View._cmdRenderMenu();
    try { Services.Toast?.info?.('Командный режим: фильтруйте Гант — team:, release:, risk: или текст. «/» — фокус строки, Esc — выход.', { ms: 3000 }); } catch (_) {}
  },
  _cmdExit() {
    const C = Gantt3View._cmd;
    C.on = false;
    const btn = document.getElementById('btn-gantt3-cmd');
    if (btn) { btn.classList.remove('active'); btn.setAttribute('aria-pressed', 'false'); }
    Gantt3View._cmdSetFilter(null);              // снять dim/highlight + gdt-cmd-filtering
    document.body.classList.remove('gdt-cmd-on');
    if (C.onKey) { document.removeEventListener('keydown', C.onKey, true); C.onKey = null; }
    if (C.bar) { C.bar.remove(); C.bar = null; }
  },
  _cmdEnsureBar() {
    const C = Gantt3View._cmd;
    if (C.bar && document.body.contains(C.bar)) return C.bar;
    const host = document.getElementById('gantt3-pill-legend') || document.getElementById('gantt3-wrap');
    if (!host || !host.parentNode) return null;
    const bar = document.createElement('div');
    bar.id = 'gdt-cmd-bar';
    bar.innerHTML =
      '<div class="gdt-cmd-box">' +
        '<div class="gdt-cmd-field" id="gdt-cmd-field">' +
          '<span class="gdt-cmd-ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></span>' +
          '<input id="gdt-cmd-input" type="text" autocomplete="off" spellcheck="false" placeholder="Команда или фильтр — team:, release:, risk: или просто текст" aria-label="Командная строка Ганта">' +
          '<button class="gdt-cmd-clear" id="gdt-cmd-clear" aria-label="Очистить"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
        '</div>' +
        '<div id="gdt-cmd-menu"></div>' +
      '</div>' +
      '<div id="gdt-cmd-status">' +
        '<span class="gdt-cmd-chip" id="gdt-cmd-chip">фильтр: <b id="gdt-cmd-chip-label"></b><button id="gdt-cmd-chip-clear" aria-label="Снять фильтр"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></span>' +
        '<span class="gdt-cmd-stat" id="gdt-cmd-stat"></span>' +
      '</div>';
    host.parentNode.insertBefore(bar, host);
    C.bar = bar;
    const inp   = bar.querySelector('#gdt-cmd-input');
    const field = bar.querySelector('#gdt-cmd-field');
    const menu  = bar.querySelector('#gdt-cmd-menu');
    inp.addEventListener('focus', () => { field.classList.add('focus'); menu.classList.add('open'); Gantt3View._cmdRenderMenu(); });
    inp.addEventListener('blur',  () => { field.classList.remove('focus'); setTimeout(() => menu.classList.remove('open'), 140); });
    inp.addEventListener('input', () => { Gantt3View._cmd.sel = 0; menu.classList.add('open'); Gantt3View._cmdRenderMenu(); Gantt3View._cmdSyncClear(); });
    inp.addEventListener('keydown', (e) => Gantt3View._cmdOnKeydown(e));
    bar.querySelector('#gdt-cmd-clear').addEventListener('click', () => { inp.value = ''; inp.focus(); Gantt3View._cmdRenderMenu(); Gantt3View._cmdSyncClear(); });
    bar.querySelector('#gdt-cmd-chip-clear').addEventListener('click', () => Gantt3View._cmdSetFilter(null));
    Gantt3View._cmdSyncStat();
    return bar;
  },
  _cmdSyncClear() {
    const inp = document.getElementById('gdt-cmd-input');
    const clr = document.getElementById('gdt-cmd-clear');
    if (inp && clr) clr.classList.toggle('on', !!inp.value);
  },
  // Каталог подсказок из DOM. cssEsc — для attr-селекторов в test-closures.
  _cmdCatalog() {
    const wrap = document.getElementById('gantt3-wrap');
    const cat = { actions: [], teams: [], epics: [], wts: [], rels: [], risks: [] };
    if (!wrap) return cat;
    const cssEsc = (s) => (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s);
    cat.actions = [
      { kind: 'действие', icon: '×', label: 'Сбросить фильтр', sub: 'показать весь квартал', run: () => Gantt3View._cmdSetFilter(null) },
      { kind: 'действие', icon: '+', label: 'Новый эпик', sub: 'создать эпик', run: () => Gantt3View._openAddEpicModal() },
      { kind: 'действие', icon: '◆', label: 'Вехи', sub: 'контрольные точки на оси', run: () => document.getElementById('btn-gantt3-milestones')?.click() },
    ];
    const seenT = new Set();
    wrap.querySelectorAll('.gantt-team-header[data-team-key]').forEach(h => {
      const key = h.dataset.teamKey; if (!key || seenT.has(key)) return; seenT.add(key);
      const name = (h.querySelector('.gdt-team-name')?.textContent || key).trim();
      const cnt = wrap.querySelectorAll('.gantt-row[data-team-key="' + cssEsc(key) + '"]').length;
      cat.teams.push({ kind: 'команда', icon: 'TM', label: name, sub: cnt + ' эпиков', rowTest: (row) => row.dataset.teamKey === key });
    });
    const seenE = new Set();
    wrap.querySelectorAll('.gantt-row[data-epic-key]').forEach(r => {
      const key = r.dataset.epicKey; if (!key || seenE.has(key)) return; seenE.add(key);
      cat.epics.push({ kind: 'эпик', icon: 'EP', label: key, sub: '', rowTest: (row) => row.dataset.epicKey === key });
    });
    const seenW = new Set();
    wrap.querySelectorAll('.gantt-type-pill[data-wt]').forEach(p => {
      const wt = p.dataset.wt; if (!wt || seenW.has(wt)) return; seenW.add(wt);
      cat.wts.push({ kind: 'работа', icon: 'WT', label: wt, sub: 'пилюли типа «' + wt + '»',
        rowTest: (row) => !!row.querySelector('.gantt-type-pill[data-wt="' + cssEsc(wt) + '"]'),
        cellTest: (cell) => !!cell.querySelector('.gantt-type-pill[data-wt="' + cssEsc(wt) + '"]') });
    });
    const seenR = new Set();
    wrap.querySelectorAll('.gantt-cell[data-col]').forEach(c => {
      const key = c.dataset.col; if (!key || seenR.has(key)) return; seenR.add(key);
      const rel = (state.releases || []).find(r => r.key === key);
      const label = rel?.short || rel?.label || key;
      cat.rels.push({ kind: 'релиз', icon: 'RL', label: 'release:' + label, sub: 'подсветить колонку ' + label,
        rowTest: (row) => !!row.querySelector('.gantt-cell[data-col="' + cssEsc(key) + '"] .gantt-type-pill'),
        cellTest: (cell) => cell.dataset.col === key });
    });
    cat.risks = [
      { kind: 'риск', icon: '!', label: 'risk:есть', sub: 'эпики с риск-метками',
        rowTest: (row) => !!row.querySelector('.gdt-cell-risk-glyph:not(.is-empty)') },
    ];
    return cat;
  },
  _cmdComputeOpts(q) {
    const cat = Gantt3View._cmdCatalog();
    q = String(q || '').trim();
    const low = q.toLowerCase();
    let groups = [];
    const m = low.match(/^(team|release|risk)\s*:\s*(.*)$/);
    if (m) {
      const pre = m[1], rest = m[2];
      if (pre === 'team')         groups.push(['Команды', cat.teams.filter(o => o.label.toLowerCase().includes(rest))]);
      else if (pre === 'release') groups.push(['Релизы', cat.rels.filter(o => o.label.toLowerCase().includes(rest))]);
      else if (pre === 'risk')    groups.push(['Риск', cat.risks.filter(o => !rest || o.label.toLowerCase().includes(rest))]);
    } else if (!q) {
      groups = [['Действия', cat.actions], ['Команды', cat.teams], ['Работы', cat.wts.slice(0, 5)], ['Релизы', cat.rels]];
    } else {
      const f = (arr) => arr.filter(o => o.label.toLowerCase().includes(low) || (o.sub && o.sub.toLowerCase().includes(low)));
      groups = [['Действия', f(cat.actions)], ['Эпики', f(cat.epics)], ['Команды', f(cat.teams)], ['Работы', f(cat.wts)], ['Релизы', f(cat.rels)], ['Риск', f(cat.risks)]];
    }
    groups = groups.filter(g => g[1] && g[1].length);
    const flat = [];
    groups.forEach(g => g[1].forEach(o => flat.push(o)));
    return { groups, flat };
  },
  _cmdRenderMenu() {
    const C = Gantt3View._cmd;
    const menu = document.getElementById('gdt-cmd-menu');
    const inp  = document.getElementById('gdt-cmd-input');
    if (!menu || !inp) return;
    const r = Gantt3View._cmdComputeOpts(inp.value);
    C.opts = r.flat;
    if (C.sel >= C.opts.length) C.sel = Math.max(0, C.opts.length - 1);
    const esc = Utils.escapeHtml;
    if (!C.opts.length) { menu.innerHTML = '<div class="gdt-cmd-empty">Ничего не найдено</div>'; return; }
    let h = '', idx = 0;
    r.groups.forEach(([title, arr]) => {
      h += '<div class="gdt-cmd-grp">' + esc(title) + '</div>';
      arr.forEach(o => {
        h += '<div class="gdt-cmd-opt' + (idx === C.sel ? ' sel' : '') + '" data-idx="' + idx + '">' +
          '<span class="oic">' + esc(o.icon || '·') + '</span>' +
          '<span class="otext"><span class="ot">' + esc(o.label) + '</span>' + (o.sub ? '<span class="os">' + esc(o.sub) + '</span>' : '') + '</span>' +
          '<span class="okind">' + esc(o.kind) + '</span></div>';
        idx++;
      });
    });
    menu.innerHTML = h;
    menu.querySelectorAll('.gdt-cmd-opt').forEach(el => {
      el.addEventListener('mouseenter', () => { C.sel = +el.dataset.idx; Gantt3View._cmdMarkSel(); });
      el.addEventListener('mousedown', (ev) => { ev.preventDefault(); Gantt3View._cmdApplyOpt(C.opts[+el.dataset.idx]); });
    });
  },
  _cmdMarkSel() {
    const menu = document.getElementById('gdt-cmd-menu');
    if (!menu) return;
    menu.querySelectorAll('.gdt-cmd-opt').forEach(el => el.classList.toggle('sel', +el.dataset.idx === Gantt3View._cmd.sel));
    menu.querySelector('.gdt-cmd-opt.sel')?.scrollIntoView({ block: 'nearest' });
  },
  _cmdOnKeydown(e) {
    const C = Gantt3View._cmd;
    if (e.key === 'ArrowDown')      { e.preventDefault(); if (C.opts.length) { C.sel = (C.sel + 1) % C.opts.length; Gantt3View._cmdMarkSel(); } }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); if (C.opts.length) { C.sel = (C.sel - 1 + C.opts.length) % C.opts.length; Gantt3View._cmdMarkSel(); } }
    else if (e.key === 'Enter')     { e.preventDefault(); Gantt3View._cmdApplyOpt(C.opts[C.sel]); }
    else if (e.key === 'Escape')    {
      e.preventDefault();
      const inp = document.getElementById('gdt-cmd-input');
      if (inp && inp.value) { inp.value = ''; Gantt3View._cmdRenderMenu(); Gantt3View._cmdSyncClear(); }
      else if (C.filter)    { Gantt3View._cmdSetFilter(null); }
      else                  { Gantt3View._cmdExit(); }
    }
  },
  _cmdApplyOpt(o) {
    if (!o) return;
    if (o.run) o.run();
    else Gantt3View._cmdSetFilter({ kind: o.kind, label: o.label, rowTest: o.rowTest, cellTest: o.cellTest });
    const inp = document.getElementById('gdt-cmd-input');
    if (inp) inp.value = '';
    Gantt3View._cmdSyncClear();
    document.getElementById('gdt-cmd-menu')?.classList.remove('open');
  },
  _cmdSetFilter(f) {
    const C = Gantt3View._cmd;
    C.filter = f;
    const chip = document.getElementById('gdt-cmd-chip');
    const chipLabel = document.getElementById('gdt-cmd-chip-label');
    if (chip) chip.classList.toggle('on', !!f);
    if (chipLabel && f) chipLabel.textContent = f.label;
    Gantt3View._cmdApplyFilter();
    if (f) { try { Services.Toast?.info?.('Фильтр: ' + f.label, { ms: 1800 }); } catch (_) {} }
  },
  _cmdApplyFilter() {
    const C = Gantt3View._cmd, f = C.filter;
    const wrap = document.getElementById('gantt3-wrap');
    if (!wrap) return;
    // снять прошлую подсветку
    wrap.querySelectorAll('.gdt-cmd-dim').forEach(el => el.classList.remove('gdt-cmd-dim'));
    wrap.querySelectorAll('.gdt-cmd-hit').forEach(el => el.classList.remove('gdt-cmd-hit'));
    wrap.querySelectorAll('.gdt-cmd-hl').forEach(el => el.classList.remove('gdt-cmd-hl'));
    document.body.classList.toggle('gdt-cmd-filtering', !!f);
    const epicRows = [...wrap.querySelectorAll('.gantt-row[data-epic-key]')];
    if (!f) { Gantt3View._cmdSyncStat(epicRows.length, epicRows.length); return; }
    let shown = 0;
    const teamHasHit = Object.create(null);
    epicRows.forEach(row => {
      let hit = false;
      try { hit = !!f.rowTest(row); } catch (_) { hit = false; }
      row.classList.toggle('gdt-cmd-dim', !hit);
      row.classList.toggle('gdt-cmd-hit', hit);
      if (hit) {
        shown++;
        teamHasHit[row.dataset.teamKey] = true;
        if (f.cellTest) row.querySelectorAll('.gantt-cell').forEach(cell => { try { if (f.cellTest(cell)) cell.classList.add('gdt-cmd-hl'); } catch (_) {} });
      }
    });
    // team-header'ы без попаданий — тоже гаснут
    wrap.querySelectorAll('.gantt-team-header[data-team-key]').forEach(h => {
      h.classList.toggle('gdt-cmd-dim', !teamHasHit[h.dataset.teamKey]);
    });
    Gantt3View._cmdSyncStat(shown, epicRows.length);
  },
  _cmdSyncStat(shown, total) {
    const stat = document.getElementById('gdt-cmd-stat');
    if (!stat) return;
    const wrap = document.getElementById('gantt3-wrap');
    const totalEpics = (total != null) ? total : (wrap ? wrap.querySelectorAll('.gantt-row[data-epic-key]').length : 0);
    stat.textContent = Gantt3View._cmd.filter
      ? ((shown != null ? shown : 0) + ' из ' + totalEpics + ' эпиков')
      : (totalEpics + ' эпиков');
  },

  /* ═══════════════════════════════════════════════════════════════════════
     Гант 3.0 · п.5 — «PILL-ANATOMY» (порт lab sketch 08). Клик по пилюле →
     поповер с расшифровкой её закодированных каналов: тип работы (+цвет stripe),
     статус словами+глиф, исполнитель, релиз, период, комментарий. Данные
     читаются из самой пилюли (DOM) — без связки с моделью. Inline, всегда.
     ═══════════════════════════════════════════════════════════════════════ */
  _anatomyBind() {
    const wrap = document.getElementById('gantt3-wrap');
    if (!wrap || wrap._gdtAnatomyBound) return;
    wrap._gdtAnatomyBound = true;
    wrap.addEventListener('click', (e) => {
      const pill = e.target.closest('.gantt-type-pill[data-wt]');
      if (!pill || pill.classList.contains('gantt-pill-ghost') || !pill.dataset.rowId) return;
      // не мешаем командному фильтру/линзе/фокусу перехватывать свои клики —
      // у них свои delegated-хендлеры на team-header/пустых местах, не на пилюлях.
      e.stopPropagation();
      Gantt3View._anatomyOpen(pill);
    });
  },
  _anatomyOpen(pill) {
    Gantt3View._anatomyClose();
    const esc = Utils.escapeHtml;
    const cell = pill.closest('.gantt-cell[data-col]');
    const row  = pill.closest('.gantt-row[data-row-id]');
    const wt   = (pill.dataset.wt || '').trim();
    const name = (pill.querySelector('.gdt-pill-name')?.textContent || wt || 'работа').trim();
    let stateLabel = 'К выполнению', stateCls = 'todo';
    if      (pill.querySelector('.gdt-pill-state-done'))      { stateLabel = 'Готово';           stateCls = 'done'; }
    else if (pill.querySelector('.gdt-pill-state-unplanned')) { stateLabel = 'Не запланирована'; stateCls = 'unplanned'; }
    else if (pill.querySelector('.gdt-pill-state-active'))    { stateLabel = 'В работе';          stateCls = 'active'; }
    const meta = (pill.querySelector('.gdt-pill-meta')?.textContent || '').trim();
    let who = '', period = '';
    if (meta && meta !== '—') { const parts = meta.split('·').map(s => s.trim()); who = parts[0] || ''; period = parts[1] || ''; }
    const colKey = (cell?.dataset.col || pill.dataset.srcCol || '').trim();
    const rel = (state.releases || []).find(r => r.key === colKey);
    const relLabel = GANTT_COL_LABELS[colKey] || rel?.short || rel?.label || colKey;
    const epicName = (row?.querySelector('.v16-epic-name')?.textContent || '').trim();
    const cmtTip = pill.querySelector('.gdt-pill-cmt-marker')?.getAttribute('data-tip') || '';
    const pop = document.createElement('div');
    pop.id = 'gdt-anatomy-pop';
    pop.innerHTML =
      '<div class="ga-hd"><span class="ga-stripe"></span><span class="ga-wt">' + esc(name) + '</span></div>' +
      (epicName ? '<div class="ga-row"><span class="ga-k">Эпик</span><span class="ga-v">' + esc(epicName) + '</span></div>' : '') +
      '<div class="ga-row"><span class="ga-k">Статус</span><span class="ga-v"><span class="ga-dot ' + stateCls + '"></span>' + esc(stateLabel) + '</span></div>' +
      '<div class="ga-row"><span class="ga-k">Исполнитель</span><span class="ga-v">' + (who ? esc(who) : '<i>не назначен</i>') + '</span></div>' +
      '<div class="ga-row"><span class="ga-k">Релиз</span><span class="ga-v">' + esc(relLabel) + '</span></div>' +
      (period ? '<div class="ga-row"><span class="ga-k">Период</span><span class="ga-v">' + esc(period) + '</span></div>' : '') +
      (cmtTip ? '<div class="ga-cmt">' + esc(cmtTip) + '</div>' : '');
    document.body.appendChild(pop);
    Gantt3View._anatomy.pop = pop;
    Gantt3View._anatomy.anchor = pill;
    Gantt3View._anatomyPosition();
    try {
      const col = getComputedStyle(pill, '::before').backgroundColor;
      if (col && col !== 'rgba(0, 0, 0, 0)' && col !== 'transparent') pop.querySelector('.ga-stripe').style.background = col;
    } catch (_) {}
    Gantt3View._anatomy.onDoc = (ev) => {
      if (ev.type === 'keydown') { if (ev.key === 'Escape') Gantt3View._anatomyClose(); return; }
      if (ev.type === 'scroll')  { Gantt3View._anatomyClose(); return; }
      if (!pop.contains(ev.target) && !pill.contains(ev.target)) Gantt3View._anatomyClose();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', Gantt3View._anatomy.onDoc, true);
      document.addEventListener('keydown',  Gantt3View._anatomy.onDoc, true);
      window.addEventListener('scroll',     Gantt3View._anatomy.onDoc, true);
    }, 0);
  },
  _anatomyPosition() {
    const A = Gantt3View._anatomy;
    if (!A.pop || !A.anchor) return;
    const r = A.anchor.getBoundingClientRect();
    const pw = A.pop.offsetWidth, ph = A.pop.offsetHeight;
    let left = r.left;
    let top = r.bottom + 6;
    if (left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
    if (left < 12) left = 12;
    if (top + ph > window.innerHeight - 12) top = r.top - ph - 6;   // flip above
    if (top < 12) top = 12;
    A.pop.style.left = Math.round(left) + 'px';
    A.pop.style.top  = Math.round(top) + 'px';
  },
  _anatomyClose() {
    const A = Gantt3View._anatomy;
    if (A.onDoc) {
      document.removeEventListener('mousedown', A.onDoc, true);
      document.removeEventListener('keydown',  A.onDoc, true);
      window.removeEventListener('scroll',     A.onDoc, true);
      A.onDoc = null;
    }
    if (A.pop) { A.pop.remove(); A.pop = null; }
    A.anchor = null;
  },

  /* ═══════════════════════════════════════════════════════════════════════
     Гант 3.0 · п.6 — «НАРРАТИВ» (порт lab redesign 07). Кнопка → оверлей:
     квартал как читаемый документ. Каждый эпик — абзац со статус-фразой
     (генерится из DOM: кол-во работ, готово/в работе, риск, переезды) +
     мини-трек релизов. TOC команд слева со скроллом. Esc / «Закрыть» — выход.
     ═══════════════════════════════════════════════════════════════════════ */
  _narrativeToggle() {
    if (Gantt3View._narrative.el) Gantt3View._narrativeClose();
    else                          Gantt3View._narrativeOpen();
  },
  _plRabot(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'работа';
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'работы';
    return 'работ';
  },
  _narrativeEpicHtml(row) {
    const esc = Utils.escapeHtml;
    const epic = (row.querySelector('.v16-epic-name')?.textContent || '(без эпика)').trim();
    const realPill = (c) => c.querySelector('.gantt-type-pill[data-wt]:not(.gantt-pill-ghost)');
    const cells = [...row.querySelectorAll('.gantt-cell[data-col]')];
    const pills = [...row.querySelectorAll('.gantt-type-pill[data-wt]')].filter(p => !p.classList.contains('gantt-pill-ghost'));
    const n = pills.length;
    const done   = pills.filter(p => p.querySelector('.gdt-pill-state-done')).length;
    const active = pills.filter(p => p.querySelector('.gdt-pill-state-active')).length;
    const hasRisk = !!row.querySelector('.gdt-cell-risk-glyph:not(.is-empty)');
    const churn   = !!row.querySelector('.v16-epic-churn');
    const riskCls = hasRisk ? ' risk-off' : (churn ? ' risk-drift' : '');
    let s = n ? (n + ' ' + Gantt3View._plRabot(n)) : 'работы пока не заведены';
    const parts = [];
    if (done)   parts.push('<span class="done">' + done + ' готово</span>');
    if (active) parts.push('<span class="prog">' + active + ' в работе</span>');
    let sentence = s + (parts.length ? ' (' + parts.join(', ') + ')' : '') + '.';
    if (hasRisk) sentence += ' <span class="warn">Есть риск-метки.</span>';
    if (churn)   sentence += ' <span class="warn">Переезжал между релизами.</span>';
    const track = cells.map(c => {
      const has = !!realPill(c);
      const lbl = GANTT_COL_LABELS[c.dataset.col] || c.dataset.col;
      return '<span class="gn-trk' + (has ? ' has' : '') + '">' + esc(lbl) + '</span>';
    }).join('');
    return '<div class="gn-epic' + riskCls + '"><div class="gn-nm">' + esc(epic) + '</div>' +
      '<div class="gn-status">' + sentence + '</div>' +
      '<div class="gn-track">' + track + '</div></div>';
  },
  _narrativeOpen() {
    const wrap = document.getElementById('gantt3-wrap');
    if (!wrap) return;
    const esc = Utils.escapeHtml;
    const cssEsc = (s) => (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s);
    const teamHeaders = [...wrap.querySelectorAll('.gantt-team-header[data-team-key]')];
    let toc = '', feed = '';
    teamHeaders.forEach((th, ti) => {
      const tk = th.dataset.teamKey;
      const teamName = (th.querySelector('.gdt-team-name')?.textContent || tk || '—').trim();
      const anchor = 'gn-team-' + ti;
      toc  += '<a data-anchor="' + anchor + '">' + esc(teamName) + '</a>';
      feed += '<div class="gn-team" id="' + anchor + '">' + esc(teamName) + '</div>';
      wrap.querySelectorAll('.gantt-row[data-team-key="' + cssEsc(tk) + '"][data-epic-key]')
        .forEach(row => { feed += Gantt3View._narrativeEpicHtml(row); });
    });
    const el = document.createElement('div');
    el.id = 'gdt-narrative';
    el.innerHTML =
      '<div class="gn-top"><span class="gn-title">Нарратив квартала</span>' +
      '<span class="gn-sub">' + teamHeaders.length + ' ' + Gantt3View._plKomand(teamHeaders.length) + ' · читаемый план</span>' +
      '<button class="gn-close" id="gn-close">Закрыть · Esc</button></div>' +
      '<div class="gn-body"><nav class="gn-toc">' + toc + '</nav>' +
      '<div class="gn-feed"><div class="gn-doc">' + (feed || '<div class="gn-team">Нет данных</div>') + '</div></div></div>';
    document.body.appendChild(el);
    Gantt3View._narrative.el = el;
    const btn = document.getElementById('btn-gantt3-narrative');
    if (btn) { btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true'); }
    el.querySelector('#gn-close').addEventListener('click', () => Gantt3View._narrativeClose());
    el.querySelectorAll('.gn-toc a').forEach(a => a.addEventListener('click', () => {
      el.querySelector('#' + a.dataset.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.querySelectorAll('.gn-toc a').forEach(x => x.classList.remove('active'));
      a.classList.add('active');
    }));
    Gantt3View._narrative.onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); Gantt3View._narrativeClose(); } };
    document.addEventListener('keydown', Gantt3View._narrative.onKey, true);
  },
  _plKomand(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'команда';
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'команды';
    return 'команд';
  },
  _narrativeClose() {
    const N = Gantt3View._narrative;
    if (N.onKey) { document.removeEventListener('keydown', N.onKey, true); N.onKey = null; }
    if (N.el) { N.el.remove(); N.el = null; }
    const btn = document.getElementById('btn-gantt3-narrative');
    if (btn) { btn.classList.remove('active'); btn.setAttribute('aria-pressed', 'false'); }
  },

  /* ═══════════════════════════════════════════════════════════════════════
     Гант 3.0 · п.8 — «КУРС» / north-star (порт lab redesign 10, только таймлайн).
     Toggle → компактная ось квартала над чартом: сегменты релизов, вехи точками
     с подписями, вертикальный маркер «сейчас». Позиции по DOY% (день года) из
     header[data-win-start/end] — та же модель, что у milestone-lines.
     ═══════════════════════════════════════════════════════════════════════ */
  _northstarToggle() {
    if (Gantt3View._northstar.on) Gantt3View._northstarHide();
    else                          Gantt3View._northstarShow();
  },
  _northstarShow() {
    Gantt3View._northstar.on = true;
    const btn = document.getElementById('btn-gantt3-northstar');
    if (btn) { btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true'); }
    Gantt3View._northstarBuild();
  },
  _northstarHide() {
    Gantt3View._northstar.on = false;
    const btn = document.getElementById('btn-gantt3-northstar');
    if (btn) { btn.classList.remove('active'); btn.setAttribute('aria-pressed', 'false'); }
    document.getElementById('gdt-northstar')?.remove();
  },
  _northstarBuild() {
    const wrap = document.getElementById('gantt3-wrap');
    if (!wrap) return;
    document.getElementById('gdt-northstar')?.remove();
    const esc = Utils.escapeHtml;
    const yr = new Date().getFullYear();
    const isoToDoy = (iso) => { const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Math.floor((Date.UTC(yr, (+m[2]) - 1, +m[3]) - Date.UTC(yr, 0, 1)) / 86400000) : null; };
    const headers = [...wrap.querySelectorAll('.gantt-header-col[data-win-start]')];
    const strip = document.createElement('div');
    strip.id = 'gdt-northstar';
    const wins = headers.map(h => {
      const s = parseInt(h.dataset.winStart, 10), e = parseInt(h.dataset.winEnd, 10);
      return { s, e, key: h.dataset.col };
    }).filter(w => Number.isFinite(w.s) && Number.isFinite(w.e));
    if (!wins.length) {
      strip.innerHTML = '<div class="ns-empty">Нет датированных релизов для оси.</div>';
      wrap.parentNode.insertBefore(strip, wrap);
      return;
    }
    let minS = Infinity, maxE = -Infinity;
    wins.forEach(w => { const s = w.s; let e = w.e; if (e < s) e += 365; minS = Math.min(minS, s); maxE = Math.max(maxE, e); });
    const span = Math.max(1, maxE - minS);
    const pctOf = (doy) => { let d = doy; if (d < minS) d += 365; return Math.max(0, Math.min(100, ((d - minS) / span) * 100)); };
    let html = '<div class="ns-track"><div class="ns-line"></div>';
    // сегменты релизов + границы
    const curKey = (wins.find(w => { const today = new Date(); const td = Math.floor((Date.UTC(yr, today.getMonth(), today.getDate()) - Date.UTC(yr, 0, 1)) / 86400000); let s = w.s, e = w.e < w.s ? w.e + 365 : w.e, d = td < s ? td + 365 : td; return d >= s && d <= e; }) || {}).key;
    wins.forEach(w => {
      const e = w.e < w.s ? w.e + 365 : w.e;
      const cpct = pctOf((w.s + e) / 2);
      const lbl = GANTT_COL_LABELS[w.key] || w.key;
      html += '<div class="ns-bnd" style="left:' + pctOf(w.s).toFixed(2) + '%"></div>';
      html += '<div class="ns-seg' + (w.key === curKey ? ' cur' : '') + '" style="left:' + cpct.toFixed(2) + '%">' + esc(lbl) + '</div>';
    });
    // вехи
    (Array.isArray(state.milestones) ? state.milestones : []).forEach(ms => {
      const doy = isoToDoy(ms.date);
      if (doy == null) return;
      const d = String(ms.date).match(/^(\d{4})-(\d{2})-(\d{2})/);
      const shortD = d ? d[3] + '.' + d[2] : '';
      const lbl = String(ms.label || '').trim() || shortD || 'веха';
      html += '<div class="ns-ms" style="left:' + pctOf(doy).toFixed(2) + '%" title="' + esc(lbl + (shortD ? ' · ' + shortD : '')) + '"><span class="lbl">' + esc(lbl) + '</span><span class="dot"></span></div>';
    });
    // сейчас
    const today = new Date();
    const todayDoy = Math.floor((Date.UTC(yr, today.getMonth(), today.getDate()) - Date.UTC(yr, 0, 1)) / 86400000);
    html += '<div class="ns-now" style="left:' + pctOf(todayDoy).toFixed(2) + '%"><span>сейчас</span></div>';
    html += '</div>';
    strip.innerHTML = html;
    wrap.parentNode.insertBefore(strip, wrap);
  },

  /* ═══════════════════════════════════════════════════════════════════════
     Гант 3.0 · п.9 — «MARQUEE-BULK» (порт lab sketch 11). Shift+тяни рамку по
     чарту → выделяет пилюли (AABB-пересечение в client-координатах); плавающая
     панель: счётчик, «Копировать сводку», «Снять». Делегат pointerdown на
     #gantt3-wrap. Bulk-мутации опущены (move-helper — render-closure).
     ═══════════════════════════════════════════════════════════════════════ */
  _marqueeBind() {
    const wrap = document.getElementById('gantt3-wrap');
    if (!wrap || wrap._gdtMqBound) return;
    wrap._gdtMqBound = true;
    wrap.addEventListener('pointerdown', (e) => {
      if (!e.shiftKey || e.button !== 0) return;
      e.preventDefault();                         // отменяет native pill-drag + text-select
      Gantt3View._marqueeStart(e);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.documentElement.dataset.activeSection === 'gantt3'
          && document.getElementById('gdt-mq-bar')?.classList.contains('on')) {
        e.preventDefault(); Gantt3View._marqueeReset();
      }
    }, true);
  },
  _marqueeStart(e) {
    const M = Gantt3View._marquee;
    M.start = { x: e.clientX, y: e.clientY };
    M.dragging = true;
    Gantt3View._marqueeClearSel();
    const box = document.createElement('div'); box.id = 'gdt-marquee';
    document.body.appendChild(box); M.box = box;
    const onMove = (ev) => Gantt3View._marqueeMove(ev);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      Gantt3View._marqueeEnd();
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
  },
  _marqueeMove(e) {
    const M = Gantt3View._marquee;
    if (!M.dragging || !M.box) return;
    const x1 = Math.min(M.start.x, e.clientX), y1 = Math.min(M.start.y, e.clientY);
    const x2 = Math.max(M.start.x, e.clientX), y2 = Math.max(M.start.y, e.clientY);
    M.box.style.left = x1 + 'px'; M.box.style.top = y1 + 'px';
    M.box.style.width = (x2 - x1) + 'px'; M.box.style.height = (y2 - y1) + 'px';
    const wrap = document.getElementById('gantt3-wrap');
    if (!wrap) return;
    wrap.querySelectorAll('.gantt-type-pill[data-wt]:not(.gantt-pill-ghost)').forEach(p => {
      const r = p.getBoundingClientRect();
      p.classList.toggle('gdt-mq-sel', r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1);
    });
  },
  _marqueeEnd() {
    const M = Gantt3View._marquee;
    M.dragging = false;
    if (M.box) { M.box.remove(); M.box = null; }
    const n = Gantt3View._marqueeSelected().length;
    if (n) Gantt3View._marqueeShowBar(n); else Gantt3View._marqueeHideBar();
  },
  _marqueeSelected() {
    const wrap = document.getElementById('gantt3-wrap');
    return wrap ? [...wrap.querySelectorAll('.gantt-type-pill.gdt-mq-sel')] : [];
  },
  _marqueeClearSel() {
    document.querySelectorAll('#gantt3-wrap .gantt-type-pill.gdt-mq-sel').forEach(p => p.classList.remove('gdt-mq-sel'));
  },
  _marqueeShowBar(n) {
    let bar = document.getElementById('gdt-mq-bar');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'gdt-mq-bar';
      bar.innerHTML = '<span class="mq-count"><b id="mq-n">0</b> <span id="mq-word">работ</span> выбрано</span>' +
        '<button id="mq-copy">Копировать сводку</button><button id="mq-clear">Снять</button>' +
        '<span class="mq-hint">Shift+тяни — выделить</span>';
      document.body.appendChild(bar);
      bar.querySelector('#mq-clear').addEventListener('click', () => Gantt3View._marqueeReset());
      bar.querySelector('#mq-copy').addEventListener('click', () => Gantt3View._marqueeCopy());
      Gantt3View._marquee.bar = bar;
    }
    bar.querySelector('#mq-n').textContent = n;
    bar.querySelector('#mq-word').textContent = Gantt3View._plRabot(n);
    bar.classList.add('on');
  },
  _marqueeHideBar() { document.getElementById('gdt-mq-bar')?.classList.remove('on'); },
  _marqueeReset() { Gantt3View._marqueeClearSel(); Gantt3View._marqueeHideBar(); },
  _marqueeCopy() {
    const sel = Gantt3View._marqueeSelected();
    const lines = sel.map(p => {
      const wt = (p.querySelector('.gdt-pill-name')?.textContent || p.dataset.wt || '').trim();
      const epic = (p.closest('.gantt-row[data-epic-key]')?.querySelector('.v16-epic-name')?.textContent || '').trim();
      const col = p.closest('.gantt-cell[data-col]')?.dataset.col || '';
      const rel = GANTT_COL_LABELS[col] || col;
      return [epic, wt, rel].filter(Boolean).join(' · ');
    });
    const text = lines.join('\n');
    try { navigator.clipboard?.writeText(text); window.showToast?.('Сводка скопирована (' + sel.length + ')', 'info', 1600); }
    catch (_) { window.showToast?.('Копирование недоступно', 'info', 1400); }
  },

  /* ═══════════════════════════════════════════════════════════════════════
     Гант 3.0 · п.10 — «PEEK-QUICKLOOK» (порт lab sketch 12). Клик по лейблу
     эпика → карточка-превью: мини-трек релизов (работы по колонкам) + факты
     (работ, готово, исполнители, статус). DOM-driven. Гард: не в режиме Линза/
     Фокус (они используют клик по строке/хедеру) и не по пилюле/кнопке.
     ═══════════════════════════════════════════════════════════════════════ */
  _peekBind() {
    const wrap = document.getElementById('gantt3-wrap');
    if (!wrap || wrap._gdtPeekBound) return;
    wrap._gdtPeekBound = true;
    wrap.addEventListener('click', (e) => {
      if (Gantt3View._lens.on || Gantt3View._focusLane.on) return;
      const label = e.target.closest('.gantt-row-label');
      if (!label) return;
      if (e.target.closest('button, a, input, .v16-epic-deps-badge, .v16-epic-deps-edit, .gantt-type-pill')) return;
      const row = label.closest('.gantt-row[data-epic-key]');
      if (!row) return;
      e.stopPropagation();
      Gantt3View._peekOpen(row, label);
    });
  },
  _peekOpen(row, anchor) {
    Gantt3View._peekClose();
    const esc = Utils.escapeHtml;
    const cssEsc = (s) => (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s);
    const wrap = document.getElementById('gantt3-wrap');
    const epic = (row.querySelector('.v16-epic-name')?.textContent || '(без эпика)').trim();
    const tk = row.dataset.teamKey || '';
    const team = (wrap.querySelector('.gantt-team-header[data-team-key="' + cssEsc(tk) + '"] .gdt-team-name')?.textContent || tk || '').trim();
    const cells = [...row.querySelectorAll('.gantt-cell[data-col]')];
    const pills = [...row.querySelectorAll('.gantt-type-pill[data-wt]')].filter(p => !p.classList.contains('gantt-pill-ghost'));
    const n = pills.length;
    const done   = pills.filter(p => p.querySelector('.gdt-pill-state-done')).length;
    const active = pills.filter(p => p.querySelector('.gdt-pill-state-active')).length;
    const hasRisk = !!row.querySelector('.gdt-cell-risk-glyph:not(.is-empty)');
    const churn   = !!row.querySelector('.v16-epic-churn');
    let trackHtml = '';
    cells.forEach(c => {
      const ps = [...c.querySelectorAll('.gantt-type-pill[data-wt]:not(.gantt-pill-ghost)')];
      if (!ps.length) return;
      const rel = GANTT_COL_LABELS[c.dataset.col] || c.dataset.col;
      trackHtml += '<div class="pk-trk"><span class="k">' + esc(rel) + '</span><span class="v">' +
        ps.map(p => { const wt = (p.querySelector('.gdt-pill-name')?.textContent || p.dataset.wt || '').trim(); const dn = p.querySelector('.gdt-pill-state-done') ? ' done' : ''; return '<span class="pk-wt' + dn + '">' + esc(wt) + '</span>'; }).join('') +
        '</span></div>';
    });
    if (!trackHtml) trackHtml = '<div class="pk-trk"><span class="v empty">Нет запланированных работ</span></div>';
    const whoSet = new Set();
    pills.forEach(p => { const m = (p.querySelector('.gdt-pill-meta')?.textContent || '').split('·')[0].trim(); if (m && m !== '—') whoSet.add(m); });
    const statusV = hasRisk ? 'Риск' : churn ? 'Переезды' : active ? 'В работе' : 'План';
    const pop = document.createElement('div');
    pop.id = 'gdt-peek';
    pop.className = hasRisk ? 'risk-off' : (churn ? 'risk-drift' : '');
    pop.innerHTML =
      '<div class="pk-hd"><div><div class="pk-nm">' + esc(epic) + '</div>' + (team ? '<div class="pk-team">' + esc(team) + '</div>' : '') + '</div></div>' +
      '<div class="pk-track">' + trackHtml + '</div>' +
      '<div class="pk-facts">' +
        '<div class="pk-fact"><div class="fk">Работ</div><div class="fv">' + n + '</div></div>' +
        '<div class="pk-fact"><div class="fk">Готово</div><div class="fv">' + done + ' / ' + n + '</div></div>' +
        '<div class="pk-fact"><div class="fk">Исполнители</div><div class="fv">' + (whoSet.size || '—') + '</div></div>' +
        '<div class="pk-fact"><div class="fk">Статус</div><div class="fv' + ((hasRisk || churn) ? ' warn' : '') + '">' + esc(statusV) + '</div></div>' +
      '</div>';
    document.body.appendChild(pop);
    Gantt3View._peek.pop = pop; Gantt3View._peek.anchor = anchor;
    // position near anchor (right of label, clamp)
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = r.right + 8, top = r.top;
    if (left + pw > window.innerWidth - 12) left = Math.max(12, r.left - pw - 8);
    if (top + ph > window.innerHeight - 12) top = Math.max(12, window.innerHeight - ph - 12);
    pop.style.left = Math.round(left) + 'px'; pop.style.top = Math.round(top) + 'px';
    Gantt3View._peek.onDoc = (ev) => {
      if (ev.type === 'keydown') { if (ev.key === 'Escape') Gantt3View._peekClose(); return; }
      if (ev.type === 'scroll')  { Gantt3View._peekClose(); return; }
      if (!pop.contains(ev.target) && !anchor.contains(ev.target)) Gantt3View._peekClose();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', Gantt3View._peek.onDoc, true);
      document.addEventListener('keydown',  Gantt3View._peek.onDoc, true);
      window.addEventListener('scroll',     Gantt3View._peek.onDoc, true);
    }, 0);
  },
  _peekClose() {
    const P = Gantt3View._peek;
    if (P.onDoc) {
      document.removeEventListener('mousedown', P.onDoc, true);
      document.removeEventListener('keydown',  P.onDoc, true);
      window.removeEventListener('scroll',     P.onDoc, true);
      P.onDoc = null;
    }
    if (P.pop) { P.pop.remove(); P.pop = null; }
    P.anchor = null;
  },

  /* ═══════════════════════════════════════════════════════════════════════
     Гант 3.0 · п.11 — «ПЕРЕНОСЫ» / plan-diff (порт lab sketch 13, по переносам).
     Toggle: подсвечивает пилюли с записанным переносом (DOM-маркер
     .gdt-pill-cmt-transfer ← row.ganttArrows/transferComments), приглушает
     остальные. НЕ синтетический baseline — реальная история переносов.
     ═══════════════════════════════════════════════════════════════════════ */
  _plPerenos(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'перенос';
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'переноса';
    return 'переносов';
  },
  _diffToggle() {
    const D = Gantt3View._diff;
    D.on = !D.on;
    const btn = document.getElementById('btn-gantt3-diff');
    if (btn) { btn.classList.toggle('active', D.on); btn.setAttribute('aria-pressed', D.on ? 'true' : 'false'); }
    document.body.classList.toggle('gdt-diff-on', D.on);
    if (D.on) {
      const n = Gantt3View._diffApply();
      window.showToast?.(n ? (n + ' ' + Gantt3View._plPerenos(n) + ' в плане') : 'Переносов в плане пока нет', 'info', 2000);
    } else {
      Gantt3View._diffClear();
    }
  },
  _diffApply() {
    const wrap = document.getElementById('gantt3-wrap');
    if (!wrap) return 0;
    let n = 0;
    wrap.querySelectorAll('.gantt-type-pill[data-wt]').forEach(p => {
      const moved = !!p.querySelector('.gdt-pill-cmt-transfer');
      p.classList.toggle('gdt-diff-moved', moved);
      if (moved) n++;
    });
    return n;
  },
  _diffClear() {
    document.querySelectorAll('#gantt3-wrap .gantt-type-pill.gdt-diff-moved').forEach(p => p.classList.remove('gdt-diff-moved'));
  },

  /* ═══════════════════════════════════════════════════════════════════════
     Гант 3.0 · п.12 — «BURNDOWN-RAIL» (порт lab sketch 20, toggleable). В шапку
     каждого датированного релиза — мини-спарклайн сгорания: пунктир-идеал
     (total→0 за окно), фактическая линия (по done), вертикаль «сегодня», цвет
     по pace (в графике/отставание). Считается из DOM (пилюли колонки + done).
     ═══════════════════════════════════════════════════════════════════════ */
  _burndownToggle() {
    const B = Gantt3View._burndown;
    B.on = !B.on;
    const btn = document.getElementById('btn-gantt3-burndown');
    if (btn) { btn.classList.toggle('active', B.on); btn.setAttribute('aria-pressed', B.on ? 'true' : 'false'); }
    if (B.on) Gantt3View._burndownBuild(); else Gantt3View._burndownClear();
  },
  _burndownClear() { document.querySelectorAll('#gantt3-wrap .gdt-burndown').forEach(e => e.remove()); },
  _burndownBuild() {
    const wrap = document.getElementById('gantt3-wrap');
    if (!wrap) return;
    Gantt3View._burndownClear();
    const cssEsc = (s) => (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s);
    const yr = new Date().getFullYear();
    const today = new Date();
    const todayDoy = Math.floor((Date.UTC(yr, today.getMonth(), today.getDate()) - Date.UTC(yr, 0, 1)) / 86400000);
    wrap.querySelectorAll('.gantt-header-col[data-win-start]').forEach(hdr => {
      const key = hdr.dataset.col; if (!key) return;
      let s = parseInt(hdr.dataset.winStart, 10), e = parseInt(hdr.dataset.winEnd, 10);
      if (!Number.isFinite(s) || !Number.isFinite(e)) return;
      if (e < s) e += 365;
      const windowDays = Math.max(1, e - s + 1);
      let td = todayDoy; if (td < s) td += 365;
      const elapsed = Math.max(0, Math.min(windowDays - 1, td - s));
      const cellPills = [...wrap.querySelectorAll('.gantt-cell[data-col="' + cssEsc(key) + '"] .gantt-type-pill[data-wt]:not(.gantt-pill-ghost)')];
      const total = cellPills.length;
      const done = cellPills.filter(p => p.querySelector('.gdt-pill-state-done')).length;
      const box = document.createElement('div'); box.className = 'gdt-burndown';
      if (total === 0) { box.innerHTML = '<span class="bd-pace none">нет работ</span>'; hdr.appendChild(box); return; }
      const elapsedPct = elapsed / (windowDays - 1 || 1);
      const idealRemain = total * (1 - elapsedPct);
      const actualRemain = total - done;
      const onPace = actualRemain <= idealRemain + 0.001;
      const yOf = (r) => (2 + (1 - r / total) * 22).toFixed(1);
      const tx = (elapsedPct * 100).toFixed(1);
      const accent = onPace ? 'var(--prizma-on-course)' : 'var(--prizma-drift)';
      const svg = '<svg viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true">' +
        '<line x1="0" y1="25" x2="100" y2="25" stroke="var(--prizma-border)" stroke-width="1" vector-effect="non-scaling-stroke"/>' +
        '<line x1="0" y1="' + yOf(total) + '" x2="100" y2="' + yOf(0) + '" stroke="var(--prizma-text-tertiary)" stroke-width="1" stroke-dasharray="3 2" vector-effect="non-scaling-stroke"/>' +
        '<line x1="' + tx + '" y1="0" x2="' + tx + '" y2="26" stroke="var(--prizma-information)" stroke-width="1" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>' +
        '<polyline points="0,' + yOf(total) + ' ' + tx + ',' + yOf(actualRemain) + '" fill="none" stroke="' + accent + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/>' +
        '<circle cx="' + tx + '" cy="' + yOf(actualRemain) + '" r="2.2" fill="' + accent + '"/>' +
        '</svg>';
      box.innerHTML = svg + '<span class="bd-pace ' + (onPace ? 'ok' : 'behind') + '">' + done + '/' + total + ' · ' + (onPace ? 'в графике' : 'отставание') + '</span>';
      hdr.appendChild(box);
    });
  },

  /* ═══════════════════════════════════════════════════════════════════════
     Гант 3.0 · «ВИДЫ» — альтернативные представления квартала (оверлеи).
     Дропдаун «Виды ▾» → один из 7 режимов. Общий shell #gdt-mode + DOM-скан
     _collectEpics() кормит все режимы согласованными данными. Esc/Закрыть —
     выход; авто-прячется вне вкладки. (п.13 split, п.14 zen, п.15 datagrid,
     п.16 report, п.21 scrubber/history, п.24 deck, п.25 mission).
     ═══════════════════════════════════════════════════════════════════════ */
  _GDT_VIEWS: [
    ['split',    'Сплит-вид',      'мастер-деталь'],
    ['zen',      'Дзен-фокус',     'один эпик крупно'],
    ['datagrid', 'Таблица',        'плотный грид'],
    ['report',   'Отчёт',          'печатный статус'],
    ['scrubber', 'История',        'ползунок по переносам'],
    ['deck',     'Дек',            'слайды ревью'],
    ['mission',  'Центр управления','приборная панель'],
    ['merge',    'Слияние',        'разрешение конфликтов (превью)'],
    ['anatomy',  'Анатомия пилюли', 'как устроена пилюля · референс'],
  ],
  _collectEpics() {
    const wrap = document.getElementById('gantt3-wrap');
    const out = { teams: [], epics: [], cols: [], colLabel: {} };
    if (!wrap) return out;
    const firstRow = wrap.querySelector('.gantt-row[data-epic-key]');
    if (firstRow) firstRow.querySelectorAll('.gantt-cell[data-col]').forEach(c => { out.cols.push(c.dataset.col); out.colLabel[c.dataset.col] = GANTT_COL_LABELS[c.dataset.col] || c.dataset.col; });
    const ts = new Set();
    wrap.querySelectorAll('.gantt-team-header[data-team-key]').forEach(h => {
      const tk = h.dataset.teamKey; if (ts.has(tk)) return; ts.add(tk);
      out.teams.push({ key: tk, name: (h.querySelector('.gdt-team-name')?.textContent || tk).trim() });
    });
    const deps = (state && state.epicDeps) ? state.epicDeps : {};
    wrap.querySelectorAll('.gantt-row[data-epic-key]').forEach(row => {
      const epic = (row.querySelector('.v16-epic-name')?.textContent || '(без эпика)').trim();
      const tk = row.dataset.teamKey || '';
      const cells = {};
      row.querySelectorAll('.gantt-cell[data-col]').forEach(c => {
        cells[c.dataset.col] = [...c.querySelectorAll('.gantt-type-pill[data-wt]:not(.gantt-pill-ghost)')].map(p => ({
          wt: (p.querySelector('.gdt-pill-name')?.textContent || p.dataset.wt || '').trim(),
          done: !!p.querySelector('.gdt-pill-state-done'),
          active: !!p.querySelector('.gdt-pill-state-active'),
          who: (p.querySelector('.gdt-pill-meta')?.textContent || '').split('·')[0].trim().replace(/^—$/, ''),
        }));
      });
      const all = Object.values(cells).flat();
      const dv = deps[epic]; const depList = Array.isArray(dv) ? dv : (dv ? [dv] : []);
      out.epics.push({
        epic, key: row.dataset.epicKey, teamKey: tk,
        team: (out.teams.find(t => t.key === tk)?.name) || tk,
        cells, total: all.length, done: all.filter(p => p.done).length, active: all.filter(p => p.active).length,
        risk: !!row.querySelector('.gdt-cell-risk-glyph:not(.is-empty)'),
        churn: !!row.querySelector('.v16-epic-churn'),
        deps: depList,
        who: [...new Set(all.map(p => p.who).filter(Boolean))],
      });
    });
    return out;
  },
  _viewsToggleMenu() {
    const m = document.getElementById('gdt-views-menu');
    if (m && m.classList.contains('open')) { Gantt3View._viewsCloseMenu(); return; }
    Gantt3View._viewsOpenMenu();
  },
  _viewsOpenMenu() {
    Gantt3View._viewsCloseMenu();
    const btn = document.getElementById('btn-gantt3-views');
    const menu = document.createElement('div'); menu.id = 'gdt-views-menu';
    menu.innerHTML = Gantt3View._GDT_VIEWS.map(([k, t, d]) =>
      '<button data-view="' + k + '">' + Utils.escapeHtml(t) + '<span class="vm-d">' + Utils.escapeHtml(d) + '</span></button>').join('');
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = (r.bottom + 6) + 'px';
    menu.classList.add('open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    menu.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { const v = b.dataset.view; Gantt3View._viewsCloseMenu(); Gantt3View._modeOpen(v); }));
    Gantt3View._viewsOnDoc = (e) => { if (!menu.contains(e.target) && e.target !== btn) Gantt3View._viewsCloseMenu(); };
    setTimeout(() => document.addEventListener('mousedown', Gantt3View._viewsOnDoc, true), 0);
  },
  _viewsCloseMenu() {
    if (Gantt3View._viewsOnDoc) { document.removeEventListener('mousedown', Gantt3View._viewsOnDoc, true); Gantt3View._viewsOnDoc = null; }
    document.getElementById('gdt-views-menu')?.remove();
    document.getElementById('btn-gantt3-views')?.setAttribute('aria-expanded', 'false');
  },
  _modeOpen(name) {
    const builder = Gantt3View['_mode_' + name];
    if (typeof builder !== 'function') return;
    Gantt3View._modeClose();
    const meta = Gantt3View._GDT_VIEWS.find(v => v[0] === name) || [name, name, ''];
    const data = Gantt3View._collectEpics();
    const el = document.createElement('div'); el.id = 'gdt-mode'; el.dataset.mode = name;
    el.innerHTML = '<div class="gm-top"><span class="gm-title">' + Utils.escapeHtml(meta[1]) + '</span>' +
      '<span class="gm-sub">' + data.epics.length + ' эпиков · ' + data.teams.length + ' команд</span>' +
      '<span class="gm-spacer"></span><span class="gm-extra"></span>' +
      '<button class="gm-act gm-close">Закрыть · Esc</button></div>' +
      '<div class="gm-body" id="gdt-mode-body"></div>';
    document.body.appendChild(el);
    Gantt3View._mode = { el, name, st: null, onKey: (e) => { if (e.key === 'Escape') { e.preventDefault(); Gantt3View._modeClose(); } } };
    el.querySelector('.gm-close').addEventListener('click', () => Gantt3View._modeClose());
    document.addEventListener('keydown', Gantt3View._mode.onKey, true);
    const btn = document.getElementById('btn-gantt3-views'); if (btn) btn.classList.add('active');
    try { builder(el.querySelector('#gdt-mode-body'), data, el); } catch (e) { el.querySelector('#gdt-mode-body').innerHTML = '<div style="padding:24px;color:var(--prizma-text-tertiary)">Ошибка рендера вида: ' + Utils.escapeHtml(String(e && e.message)) + '</div>'; }
  },
  _modeClose() {
    const M = Gantt3View._mode;
    if (!M) return;
    if (M.onKey) document.removeEventListener('keydown', M.onKey, true);
    if (M.st && M.st.onKey2) document.removeEventListener('keydown', M.st.onKey2, true);
    if (M.st && M.st.onResize) window.removeEventListener('resize', M.st.onResize);
    if (M.el) M.el.remove();
    Gantt3View._mode = { el: null, name: null, onKey: null, st: null };
    document.getElementById('btn-gantt3-views')?.classList.remove('active');
  },
  _modeEpicCard(e, data) {
    const esc = Utils.escapeHtml;
    const track = data.cols.filter(c => (e.cells[c] || []).length).map(c =>
      '<div class="ic-trk"><span class="k">' + esc(data.colLabel[c]) + '</span><span class="v">' +
      (e.cells[c] || []).map(p => '<span class="gdt-wt' + (p.done ? ' done' : '') + '">' + esc(p.wt) + (p.who ? ' · ' + esc(p.who) : '') + '</span>').join('') +
      '</span></div>').join('') || '<div class="ic-trk"><span class="v" style="color:var(--prizma-text-tertiary)">Нет запланированных работ</span></div>';
    const statusTxt = e.risk ? 'Риск срыва' : e.churn ? 'Дрейфует' : e.active ? 'В работе' : 'По плану';
    return '<div class="gdt-card"><div class="ic-nm">' + esc(e.epic) + '</div><div class="ic-team">' + esc(e.team) + '</div>' +
      '<div class="gdt-stats">' +
        '<div class="gdt-stat"><div class="sv">' + e.total + '</div><div class="sk">работ</div></div>' +
        '<div class="gdt-stat"><div class="sv">' + e.done + '</div><div class="sk">готово</div></div>' +
        '<div class="gdt-stat"><div class="sv">' + e.who.length + '</div><div class="sk">людей</div></div>' +
        '<div class="gdt-stat"><div class="sv' + ((e.risk || e.churn) ? ' warn' : '') + '">' + esc(statusTxt) + '</div><div class="sk">статус</div></div>' +
      '</div><div class="ic-track">' + track + '</div>' +
      (e.deps.length ? '<div class="ic-team" style="margin-top:14px">Зависит от: ' + esc(e.deps.join(', ')) + '</div>' : '') + '</div>';
  },
  _mode_split(body, data) {
    const esc = Utils.escapeHtml;
    body.innerHTML = '<div class="gdt-msplit"><div class="ms-list"></div><div class="ms-insp"></div></div>';
    const list = body.querySelector('.ms-list'), insp = body.querySelector('.ms-insp');
    list.innerHTML = data.epics.map((e, i) => '<div class="ms-li" data-i="' + i + '"><div class="nm">' + esc(e.epic) + '</div><div class="mt">' + esc(e.team) + ' · ' + e.total + ' работ' + (e.risk ? ' · риск' : e.churn ? ' · дрейф' : '') + '</div></div>').join('');
    const sel = (i) => { list.querySelectorAll('.ms-li').forEach(x => x.classList.toggle('sel', +x.dataset.i === i)); insp.innerHTML = Gantt3View._modeEpicCard(data.epics[i], data); };
    list.querySelectorAll('.ms-li').forEach(li => li.addEventListener('click', () => sel(+li.dataset.i)));
    if (data.epics.length) sel(0);
  },
  _mode_zen(body, data) {
    let i = 0;
    body.innerHTML = '<div style="max-width:860px;margin:0 auto;padding:44px 28px"><div id="zen-card"></div>' +
      '<div style="display:flex;gap:12px;justify-content:center;margin-top:28px"><button class="gm-act" id="zen-prev">← Пред</button>' +
      '<span id="zen-pos" style="font:600 12px/1 var(--mono);color:var(--prizma-text-tertiary);align-self:center"></span>' +
      '<button class="gm-act" id="zen-next">След →</button></div></div>';
    const card = body.querySelector('#zen-card'), pos = body.querySelector('#zen-pos');
    const show = () => { card.innerHTML = Gantt3View._modeEpicCard(data.epics[i], data); pos.textContent = (i + 1) + ' / ' + data.epics.length; };
    const step = (d) => { if (!data.epics.length) return; i = (i + d + data.epics.length) % data.epics.length; show(); };
    body.querySelector('#zen-prev').addEventListener('click', () => step(-1));
    body.querySelector('#zen-next').addEventListener('click', () => step(1));
    Gantt3View._mode.st = { onKey2: (ev) => { if (ev.key === 'ArrowLeft') step(-1); else if (ev.key === 'ArrowRight') step(1); } };
    document.addEventListener('keydown', Gantt3View._mode.st.onKey2, true);
    if (data.epics.length) show(); else card.innerHTML = '<div style="color:var(--prizma-text-tertiary)">Нет эпиков</div>';
  },
  _mode_datagrid(body, data) {
    const esc = Utils.escapeHtml;
    const cols = data.cols;
    const st = { key: 'risk', dir: -1 };
    const rows = data.epics.map(e => ({ e, riskN: e.risk ? 2 : (e.churn ? 1 : 0), ratio: e.total ? e.done / e.total : 0, counts: cols.reduce((m, c) => { m[c] = (e.cells[c] || []).length; return m; }, {}) }));
    const render = () => {
      rows.sort((a, b) => { const k = st.key; let av, bv;
        if (k === 'team') { av = a.e.team; bv = b.e.team; } else if (k === 'epic') { av = a.e.epic; bv = b.e.epic; }
        else if (k === 'total') { av = a.e.total; bv = b.e.total; } else if (k === 'ratio') { av = a.ratio; bv = b.ratio; }
        else if (k === 'risk') { av = a.riskN; bv = b.riskN; } else { av = a.counts[k] || 0; bv = b.counts[k] || 0; }
        return (typeof av === 'string') ? st.dir * av.localeCompare(bv, 'ru') : st.dir * (av - bv); });
      const car = (k) => st.key === k ? (st.dir < 0 ? ' ▾' : ' ▴') : '';
      const th = (k, l, num) => '<th data-k="' + k + '"' + (num ? ' class="num"' : '') + '>' + esc(l) + car(k) + '</th>';
      let h = '<table class="gdt-dg"><thead><tr>' + th('team', 'Команда') + th('epic', 'Эпик') + cols.map(c => th(c, data.colLabel[c], true)).join('') + th('total', 'Σ', true) + th('ratio', 'Готово', true) + th('risk', 'Риск') + '</tr></thead><tbody>';
      rows.forEach(r => { h += '<tr><td>' + esc(r.e.team) + '</td><td>' + esc(r.e.epic) + '</td>' +
        cols.map(c => '<td class="num">' + (r.counts[c] || '·') + '</td>').join('') +
        '<td class="num">' + r.e.total + '</td><td class="num">' + Math.round(r.ratio * 100) + '%</td>' +
        '<td>' + (r.e.risk ? '<span style="color:var(--prizma-off-course)">риск</span>' : r.e.churn ? '<span style="color:var(--prizma-drift)">дрейф</span>' : '—') + '</td></tr>'; });
      h += '</tbody></table>';
      body.innerHTML = h;
      body.querySelectorAll('th').forEach(t => t.addEventListener('click', () => { const k = t.dataset.k; if (st.key === k) st.dir *= -1; else { st.key = k; st.dir = (k === 'team' || k === 'epic') ? 1 : -1; } render(); }));
    };
    render();
  },
  _mode_report(body, data) {
    const esc = Utils.escapeHtml;
    const totalWork = data.epics.reduce((n, e) => n + e.total, 0);
    const doneWork = data.epics.reduce((n, e) => n + e.done, 0);
    const pct = totalWork ? Math.round(doneWork / totalWork * 100) : 0;
    const risks = data.epics.filter(e => e.risk);
    const cap = data.teams.map(t => ({ name: t.name, n: data.epics.filter(e => e.teamKey === t.key).reduce((s, e) => s + e.total, 0) }));
    const maxCap = Math.max(1, ...cap.map(c => c.n));
    let h = '<div class="gdt-rep"><div class="gdt-kpis">' +
      '<div class="gdt-kpi"><div class="kv">' + data.epics.length + '</div><div class="kk">эпиков</div></div>' +
      '<div class="gdt-kpi"><div class="kv">' + data.teams.length + '</div><div class="kk">команд</div></div>' +
      '<div class="gdt-kpi"><div class="kv">' + pct + '%</div><div class="kk">готово</div></div>' +
      '<div class="gdt-kpi"><div class="kv">' + risks.length + '</div><div class="kk">рисков</div></div>' +
      '<div class="gdt-kpi"><div class="kv">' + totalWork + '</div><div class="kk">работ</div></div></div>';
    h += '<h2>Риски</h2>' + (risks.length ? risks.map(e => '<div class="rk off"><b>' + esc(e.epic) + '</b>&nbsp;<span style="color:var(--prizma-text-tertiary)">— ' + esc(e.team) + '</span></div>').join('') : '<div style="color:var(--prizma-text-tertiary);font-size:13px">Рисков не зафиксировано</div>');
    h += '<h2>Нагрузка команд</h2>' + cap.map(c => '<div class="cap"><span class="cn">' + esc(c.name) + '</span><span class="bar"><i style="width:' + Math.round(c.n / maxCap * 100) + '%"></i></span><span style="font:600 11px/1 var(--mono);color:var(--prizma-text-tertiary)">' + c.n + '</span></div>').join('');
    h += '</div>';
    body.innerHTML = h;
    const extra = Gantt3View._mode.el && Gantt3View._mode.el.querySelector('.gm-extra');
    if (extra) { extra.innerHTML = '<button class="gm-act" id="rep-print">Печать / PDF</button>'; extra.querySelector('#rep-print').addEventListener('click', () => window.print()); }
  },
  _mode_deck(body, data) {
    const esc = Utils.escapeHtml;
    const slides = [];
    const totalWork = data.epics.reduce((n, e) => n + e.total, 0);
    const doneWork = data.epics.reduce((n, e) => n + e.done, 0);
    const pct = totalWork ? Math.round(doneWork / totalWork * 100) : 0;
    slides.push('<div class="dk-h">Квартал — обзор</div><div class="gdt-kpis"><div class="gdt-kpi"><div class="kv">' + data.epics.length + '</div><div class="kk">эпиков</div></div><div class="gdt-kpi"><div class="kv">' + data.teams.length + '</div><div class="kk">команд</div></div><div class="gdt-kpi"><div class="kv">' + pct + '%</div><div class="kk">готово</div></div><div class="gdt-kpi"><div class="kv">' + data.epics.filter(e => e.risk).length + '</div><div class="kk">рисков</div></div></div>');
    data.teams.forEach(t => { const eps = data.epics.filter(e => e.teamKey === t.key); slides.push('<div class="dk-h">' + esc(t.name) + '</div>' + eps.map(e => '<div style="padding:11px 0;border-bottom:1px solid var(--prizma-border);display:flex;gap:12px;align-items:center"><b style="flex:1;font-size:15px">' + esc(e.epic) + '</b><span style="font:600 13px/1 var(--mono);color:var(--prizma-text-tertiary)">' + e.done + '/' + e.total + '</span>' + (e.risk ? '<span style="color:var(--prizma-off-course);font-size:12px">риск</span>' : e.churn ? '<span style="color:var(--prizma-drift);font-size:12px">дрейф</span>' : '') + '</div>').join('')); });
    const risks = data.epics.filter(e => e.risk);
    slides.push('<div class="dk-h">Риски квартала</div>' + (risks.length ? risks.map(e => '<div style="padding:11px 0 11px 14px;border-left:3px solid var(--prizma-off-course);margin-bottom:9px"><b style="font-size:15px">' + esc(e.epic) + '</b> <span style="color:var(--prizma-text-tertiary)">— ' + esc(e.team) + '</span></div>').join('') : '<div style="color:var(--prizma-text-tertiary)">Рисков не зафиксировано</div>'));
    let cur = 0;
    body.innerHTML = '<div class="gdt-deck">' + slides.map((s, i) => '<div class="dk-slide' + (i === 0 ? ' on' : '') + '">' + s + '</div>').join('') +
      '<div class="dk-nav"><button class="gm-act" id="dk-prev">←</button>' + slides.map((s, i) => '<button class="dk-dot' + (i === 0 ? ' on' : '') + '" data-d="' + i + '"></button>').join('') + '<button class="gm-act" id="dk-next">→</button></div></div>';
    const go = (n) => { cur = (n + slides.length) % slides.length; body.querySelectorAll('.dk-slide').forEach((s, i) => s.classList.toggle('on', i === cur)); body.querySelectorAll('.dk-dot').forEach((d, i) => d.classList.toggle('on', i === cur)); };
    body.querySelector('#dk-prev').addEventListener('click', () => go(cur - 1));
    body.querySelector('#dk-next').addEventListener('click', () => go(cur + 1));
    body.querySelectorAll('.dk-dot').forEach(d => d.addEventListener('click', () => go(+d.dataset.d)));
    Gantt3View._mode.st = { onKey2: (ev) => { if (ev.key === 'ArrowLeft') go(cur - 1); else if (ev.key === 'ArrowRight') go(cur + 1); } };
    document.addEventListener('keydown', Gantt3View._mode.st.onKey2, true);
  },
  _mode_mission(body, data) {
    const esc = Utils.escapeHtml;
    const totalWork = data.epics.reduce((n, e) => n + e.total, 0);
    const doneWork = data.epics.reduce((n, e) => n + e.done, 0);
    const pct = totalWork ? Math.round(doneWork / totalWork * 100) : 0;
    const risks = data.epics.filter(e => e.risk);
    let heat = '<div class="gdt-heat"><div class="hr"><span></span>' + data.cols.map(c => '<span class="hc" style="background:none;color:var(--prizma-text-tertiary)">' + esc(data.colLabel[c]) + '</span>').join('') + '</div>';
    data.teams.forEach(t => { heat += '<div class="hr"><span style="font:600 9px/1 var(--mono);color:var(--prizma-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(t.name) + '</span>' +
      data.cols.map(c => { const n = data.epics.filter(e => e.teamKey === t.key).reduce((s, e) => s + ((e.cells[c] || []).length), 0); const tint = n === 0 ? 'transparent' : 'color-mix(in srgb, var(--prizma-information) ' + Math.min(64, n * 12) + '%, transparent)'; return '<span class="hc" style="background:' + tint + '">' + (n || '') + '</span>'; }).join('') + '</div>'; });
    heat += '</div>';
    body.innerHTML = '<div class="gdt-mission">' +
      '<div class="gdt-pan" style="grid-column:1/-1"><div class="ph">Сводка квартала</div><div class="gdt-kpis"><div class="gdt-kpi"><div class="kv">' + data.epics.length + '</div><div class="kk">эпиков</div></div><div class="gdt-kpi"><div class="kv">' + pct + '%</div><div class="kk">готово</div></div><div class="gdt-kpi"><div class="kv">' + risks.length + '</div><div class="kk">рисков</div></div><div class="gdt-kpi"><div class="kv">' + totalWork + '</div><div class="kk">работ</div></div></div></div>' +
      '<div class="gdt-pan" style="grid-column:1/3"><div class="ph">Нагрузка: команды × релизы</div>' + heat + '</div>' +
      '<div class="gdt-pan"><div class="ph">Риски</div>' + (risks.length ? risks.map(e => '<div style="padding:7px 0 7px 10px;border-left:3px solid var(--prizma-off-course);margin-bottom:7px;font-size:12.5px">' + esc(e.epic) + '<div style="color:var(--prizma-text-tertiary);font-size:11px;margin-top:2px">' + esc(e.team) + '</div></div>').join('') : '<div style="color:var(--prizma-text-tertiary);font-size:12px">Рисков нет</div>') + '</div>' +
      '</div>';
  },
  _mode_scrubber(body, data) {
    const esc = Utils.escapeHtml;
    const moves = [];
    (state.rows || []).forEach(r => { (Array.isArray(r.ganttArrows) ? r.ganttArrows : []).forEach(a => { moves.push({ epic: String(r.epic || r.tasks || '').trim(), wt: a.wt, from: a.srcCol, to: a.dstCol, at: a.at }); }); });
    moves.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
    if (!moves.length) { body.innerHTML = '<div style="padding:48px;max-width:560px;margin:0 auto;text-align:center;color:var(--prizma-text-tertiary);font-size:14px;line-height:1.6">История переносов пуста — пока ни одна работа не переезжала между релизами.<br>Перетащите пилюлю в другой колодец, и перенос появится здесь, на ползунке времени.</div>'; return; }
    const N = moves.length;
    const fmt = (at) => { const m = String(at).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '.' + m[2] : ''; };
    body.innerHTML = '<div class="gdt-scrub"><div class="sc-lbl" id="sc-lbl"></div><input type="range" min="0" max="' + N + '" value="' + N + '" id="sc-range"></div><div id="sc-list" style="padding:18px 26px;max-width:760px"></div>';
    const range = body.querySelector('#sc-range'), lbl = body.querySelector('#sc-lbl'), listEl = body.querySelector('#sc-list');
    const render = () => { const k = +range.value; lbl.textContent = 'Перемотка: показаны переносы 1…' + k + ' из ' + N; listEl.innerHTML = moves.slice(0, k).map(mv => '<div style="padding:8px 0;border-bottom:1px solid var(--prizma-border);font-size:13px"><b>' + esc(mv.epic) + '</b> · ' + esc(mv.wt || '') + ' : ' + esc(GANTT_COL_LABELS[mv.from] || mv.from || '?') + ' → ' + esc(GANTT_COL_LABELS[mv.to] || mv.to || '?') + ' <span style="color:var(--prizma-text-tertiary);font:600 11px/1 var(--mono);margin-left:6px">' + fmt(mv.at) + '</span></div>').join(''); };
    range.addEventListener('input', render); render();
  },
  _mode_merge(body, data) {
    const esc = Utils.escapeHtml;
    const names = data.epics.map(e => e.epic);
    const pick = (i) => names[i % (names.length || 1)] || 'эпик';
    const AUTO = [
      { ep: pick(0), fld: 'комментарий', to: 'обновлён из файла' },
      { ep: pick(1), fld: 'исполнитель', to: 'добавлен' },
      { ep: pick(2), fld: 'дата', to: 'сдвинута на неделю' },
    ];
    const CONF = [
      { ep: pick(3), fld: 'scope', local: 'Да', file: 'Требует подтверждения' },
      { ep: pick(4), fld: 'релиз', local: '1.21', file: '1.22' },
    ];
    const st = Gantt3View._mode.st = { decided: {} };
    const render = () => {
      const resolved = Object.values(st.decided).filter(v => v === 'local' || v === 'file').length;
      const skipped = Object.values(st.decided).filter(v => v === 'skip').length;
      let h = '<div class="gdt-merge">';
      h += '<div class="mg-note">Превью режима слияния: как разрешались бы конфликты при импорте плана поверх текущего. Данные демонстрационные — реальный план не меняется.</div>';
      h += '<div class="mg-summary"><span class="ok">' + AUTO.length + ' авто-применено</span><span class="cf">' + CONF.length + ' конфликта</span><span style="color:var(--prizma-text-tertiary)">' + resolved + ' решено · ' + skipped + ' пропущено</span></div>';
      h += '<div class="mg-auto"><div class="mg-auto-h" id="mg-auth"><span>▸</span> Авто-применённые правки (' + AUTO.length + ')</div><div class="mg-auto-b">' + AUTO.map(a => '<div class="mg-auto-row"><b>' + esc(a.ep) + '</b> · ' + esc(a.fld) + ' — ' + esc(a.to) + '</div>').join('') + '</div></div>';
      CONF.forEach((c, i) => { const d = st.decided[i]; h += '<div class="mg-conf' + (d === 'skip' ? ' skipped' : (d ? ' resolved' : '')) + '"><div class="mg-conf-t">' + esc(c.ep) + ' · поле «' + esc(c.fld) + '»</div><div class="mg-opts"><label class="mg-opt"><input type="radio" name="cf' + i + '" value="local"' + (d === 'local' ? ' checked' : '') + '> <span class="ok2">Текущий</span><div class="vv">' + esc(c.local) + '</div></label><label class="mg-opt"><input type="radio" name="cf' + i + '" value="file"' + (d === 'file' ? ' checked' : '') + '> <span class="ok2">Из файла</span><div class="vv">' + esc(c.file) + '</div></label></div><button class="mg-skip" data-skip="' + i + '">Пропустить этот конфликт</button></div>'; });
      h += '<button class="mg-apply" id="mg-apply">Применить разрешения</button></div>';
      body.innerHTML = h;
      body.querySelector('#mg-auth').addEventListener('click', () => body.querySelector('.mg-auto').classList.toggle('open'));
      body.querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', () => { st.decided[+r.name.slice(2)] = r.value; render(); }));
      body.querySelectorAll('.mg-skip').forEach(s => s.addEventListener('click', () => { st.decided[+s.dataset.skip] = 'skip'; render(); }));
      body.querySelector('#mg-apply').addEventListener('click', () => {
        const applied = AUTO.length + Object.values(st.decided).filter(v => v === 'local' || v === 'file').length;
        const skip = Object.values(st.decided).filter(v => v === 'skip').length;
        const undec = CONF.length - Object.keys(st.decided).length;
        window.showToast?.('Применено ' + applied + ', пропущено ' + skip + (undec > 0 ? ', не решено ' + undec : '') + ' (превью)', 'info', 2800);
      });
    };
    render();
  },
  /* «Анатомия пилюли» (порт lab sketch 08): референс — specimen с SVG-выносками,
     грид специменов состояний, before/after «два канала, не пять». */
  _mode_anatomy(body) {
    const esc = Utils.escapeHtml;
    const C_BE = 'var(--prizma-information)', C_FE = 'var(--prizma-insight, #7C5CFF)', C_QA = 'var(--prizma-on-course)', C_IM = 'var(--prizma-drift)';
    const variants = [
      { vt: 'Запланировано', wt: C_QA, nm: 'QA', state: 'planned', vn: 'База: полоса + имя. Точки нет — работа ещё не началась.' },
      { vt: 'В работе', wt: C_BE, nm: 'BE', state: 'progress', vn: 'Точка 6px цвета information — активность без отдельной плашки.' },
      { vt: 'Завершено', wt: C_FE, nm: 'FE', state: 'done', vn: 'Приглушено + зачёркнуто. Done «уходит в фон», не кричит.' },
      { vt: 'Не запланировано', wt: C_BE, nm: 'BE', state: 'unplanned', vn: 'Штрихованная полоса — попало в релиз вне плана.' },
      { vt: 'С исполнителем', wt: C_IM, nm: 'IMPL', who: 'Орлов', state: 'planned', vn: 'Мета-строка добавляет второй канал — кто делает.' },
      { vt: 'Рисковый', wt: C_FE, nm: 'FE', who: 'Ким', state: 'progress', risk: true, vn: 'Риск — только на точке (off-course). Полоса остаётся типом.' },
      { vt: 'Взвешено оценкой', wt: C_BE, nm: 'BE', weighted: true, est: 28, vn: 'Высота полосы ∝ человеко-дням. Вес виден без чисел.' },
    ];
    const vcards = variants.map(v => {
      let pill = '<div class="gpa-pill' + (v.weighted ? ' weighted' : '') + '" data-state="' + v.state + '" style="--wt:' + v.wt + (v.weighted ? ';--wh:' + Math.round(30 + v.est / 28 * 60) + '%' : '') + '">';
      if (v.state === 'done') pill += '<span class="dot" style="background:var(--prizma-on-course)"></span>';
      if (v.risk) pill += '<span class="dot" style="background:var(--prizma-off-course)"></span>';
      pill += '<span class="nm">' + esc(v.nm) + '</span>';
      if (v.who) pill += '<span class="who">' + esc(v.who) + '</span>';
      pill += '</div>';
      return '<div class="gpa-vcard"><div class="vt">' + esc(v.vt) + '</div><div class="vrow">' + pill + '</div><div class="vn">' + esc(v.vn) + '</div></div>';
    }).join('');
    body.innerHTML =
      '<div class="gpa"><div class="gpa-head"><div class="gpa-eyebrow">Спецификация</div><h1>Анатомия пилюли</h1>' +
      '<p>Пилюля работы несёт <b>ровно два канала</b>: вертикальная полоса слева — тип работы, и одна мета-строка — исполнитель. Статус не добавляет коробок: его выражают точка 6px, прозрачность или штриховка полосы.</p></div>' +
      '<div class="gpa-sec"><div class="gpa-eyebrow">Эталон · разбор по частям</div>' +
        '<div class="gpa-stage" id="gpa-stage"><svg class="gpa-leaders" id="gpa-leaders" aria-hidden="true"></svg>' +
          '<div class="gpa-specimen-wrap"><div class="gpa-spec" id="gpa-spec" style="--wt:var(--prizma-information)">' +
            '<span class="dot" id="gpa-a-dot" style="background:var(--prizma-information)"></span>' +
            '<span class="body"><span class="nm" id="gpa-a-name">Новый процессинг СБП</span><span class="meta" id="gpa-a-meta">BE · Сидоров</span></span></div></div>' +
          '<div class="gpa-callout c-stripe"><div class="lab">Полоса слева</div><div class="desc">Тип работы (BE/FE/QA…). Единственная категориальная краска. 3px, без заливки фона.</div></div>' +
          '<div class="gpa-callout c-name"><div class="lab">Имя</div><div class="desc">Канал 1 — что это за работа. Основной вес и контраст.</div></div>' +
          '<div class="gpa-callout c-meta"><div class="lab">Мета-строка</div><div class="desc">Канал 2 — исполнитель, моноширинный. Ровно одна строка.</div></div>' +
          '<div class="gpa-callout c-dot"><div class="lab">Индикатор статуса</div><div class="desc">Точка 6px / прозрачность / штрих — не отдельная плашка.</div></div></div></div>' +
      '<div class="gpa-sec"><div class="gpa-eyebrow">Специмены состояний</div><div class="gpa-variants">' + vcards + '</div></div>' +
      '<div class="gpa-sec"><div style="display:flex;align-items:center;gap:10px"><div class="gpa-eyebrow" style="margin:0">Было / стало</div><span style="flex:1"></span><button class="gpa-batoggle" id="gpa-ba">Показать «было»</button></div>' +
        '<div class="gpa-ba" style="margin-top:14px">' +
          '<div class="gpa-panel" id="gpa-bad"><span class="gpa-tag bad">Было · пять каналов</span><div class="gpa-demo"><span class="gpa-oldpill"><span>◆</span><span>BE</span><span>●</span><span class="sub">Сидоров</span><span>⚠</span><span class="sub">75%</span><span>↗</span></span></div><div class="gpa-note">Заливка, кольцо-тень, <b>три глифа</b>, процент, текст 9.5px. Цвет фона спорит со статусом — глаз не знает, куда смотреть.</div></div>' +
          '<div class="gpa-panel" id="gpa-good"><span class="gpa-tag good">Стало · два канала</span><div class="gpa-demo"><div class="gpa-pill" data-state="progress" style="--wt:var(--prizma-information)"><span class="nm">BE</span><span class="who">Сидоров</span></div></div><div class="gpa-note">Полоса = тип. Имя + исполнитель. Точка = в работе. <b>Ничего лишнего</b> — статус читается периферийным зрением.</div></div></div>' +
        '<div class="gpa-principle"><div class="big">«<span class="twochan">два канала</span>, не пять»</div><div class="small">Каждый дополнительный сигнал на пилюле снижает читаемость остальных. Ограничение — это и есть дизайн.</div></div></div></div>';
    // before/after toggle
    const baBtn = body.querySelector('#gpa-ba'), bad = body.querySelector('#gpa-bad'), good = body.querySelector('#gpa-good');
    let mode = 'after';
    const applyMode = (m) => { if (m === 'before') { good.classList.add('dim'); bad.classList.remove('dim'); baBtn.textContent = 'Показать «стало»'; } else { bad.classList.add('dim'); good.classList.remove('dim'); baBtn.textContent = 'Показать «было»'; } mode = m; };
    applyMode('after');
    baBtn.addEventListener('click', () => applyMode(mode === 'after' ? 'before' : 'after'));
    // SVG-выноски от частей пилюли к подписям
    const stage = body.querySelector('#gpa-stage'), svg = body.querySelector('#gpa-leaders');
    const rel = (elm) => { const s = stage.getBoundingClientRect(), r = elm.getBoundingClientRect(); return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height, cx: r.left - s.left + r.width / 2, cy: r.top - s.top + r.height / 2 }; };
    const drawLeaders = () => {
      const spec = body.querySelector('#gpa-spec'); if (!spec || !spec.getBoundingClientRect().width) return;
      const sp = rel(spec);
      const pStripe = { x: sp.x + 2, y: sp.cy }, pName = rel(body.querySelector('#gpa-a-name')), pMeta = rel(body.querySelector('#gpa-a-meta')), pDot = rel(body.querySelector('#gpa-a-dot'));
      const ends = [
        { c: '.c-stripe', to: [pStripe.x, pStripe.y - 14], side: 'left' },
        { c: '.c-name', to: [pName.x + pName.w, pName.cy], side: 'right' },
        { c: '.c-meta', to: [pMeta.x + pMeta.w, pMeta.cy], side: 'right' },
        { c: '.c-dot', to: [pDot.cx, pDot.cy], side: 'left' },
      ];
      let s = '';
      ends.forEach(e => {
        const co = rel(stage.querySelector(e.c));
        const from = e.side === 'right' ? [co.x, co.cy] : [co.x + co.w, co.cy];
        const mx = (from[0] + e.to[0]) / 2;
        s += '<path d="M' + from[0].toFixed(1) + ' ' + from[1].toFixed(1) + ' C ' + mx.toFixed(1) + ' ' + from[1].toFixed(1) + ', ' + mx.toFixed(1) + ' ' + e.to[1].toFixed(1) + ', ' + e.to[0].toFixed(1) + ' ' + e.to[1].toFixed(1) + '" fill="none" stroke="var(--prizma-border-strong, var(--border))" stroke-width="1"/>';
        s += '<circle cx="' + e.to[0].toFixed(1) + '" cy="' + e.to[1].toFixed(1) + '" r="2.4" fill="var(--prizma-information)"/>';
      });
      svg.innerHTML = s;
    };
    drawLeaders(); setTimeout(drawLeaders, 60);
    const onResize = () => drawLeaders();
    window.addEventListener('resize', onResize);
    Gantt3View._mode.st = { onResize };
  },

  /* ═══════════════════════════════════════════════════════════════════════
     Гант 3.0 · п.20 — «ЧИПЫ» (порт lab sketch 25). Toggle-строка быстрых
     фильтров над чартом: риски / в работе / переезды / готовое / по релизам.
     Клики комбинируются по AND, несовпадающие строки гаснут, у каждого чипа
     live-счётчик (превью «если добавить»). DOM-driven.
     ═══════════════════════════════════════════════════════════════════════ */
  _chipsPredicates() {
    const wrap = document.getElementById('gantt3-wrap');
    const cssEsc = (s) => (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s);
    const cols = []; const seen = new Set();
    const firstRow = wrap && wrap.querySelector('.gantt-row[data-epic-key]');
    if (firstRow) firstRow.querySelectorAll('.gantt-cell[data-col]').forEach(c => { if (!seen.has(c.dataset.col)) { seen.add(c.dataset.col); cols.push(c.dataset.col); } });
    const base = [
      { key: 'risk',   label: 'Риски',         test: r => !!r.querySelector('.gdt-cell-risk-glyph:not(.is-empty)') },
      { key: 'active', label: 'В работе',      test: r => !!r.querySelector('.gdt-pill-state-active') },
      { key: 'churn',  label: 'Переезды',      test: r => !!r.querySelector('.v16-epic-churn') },
      { key: 'done',   label: 'Есть готовое',  test: r => !!r.querySelector('.gdt-pill-state-done') },
    ];
    cols.forEach(c => base.push({ key: 'col:' + c, label: GANTT_COL_LABELS[c] || c, test: r => !!r.querySelector('.gantt-cell[data-col="' + cssEsc(c) + '"] .gantt-type-pill[data-wt]:not(.gantt-pill-ghost)') }));
    return base;
  },
  _chipsToggleMode() {
    const C = Gantt3View._chips;
    if (C.on) { Gantt3View._chipsExit(); return; }
    C.on = true; C.active = new Set();
    document.body.classList.add('gdt-chips-on');
    const btn = document.getElementById('btn-gantt3-chips');
    if (btn) { btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true'); }
    Gantt3View._chipsBuild();
  },
  _chipsExit() {
    const C = Gantt3View._chips; C.on = false; C.active = null;
    document.body.classList.remove('gdt-chips-on');
    const btn = document.getElementById('btn-gantt3-chips');
    if (btn) { btn.classList.remove('active'); btn.setAttribute('aria-pressed', 'false'); }
    Gantt3View._chipsClearDim();
    document.getElementById('gdt-chips')?.remove(); C.strip = null;
  },
  _chipsBuild() {
    const wrap = document.getElementById('gantt3-wrap'); if (!wrap) return;
    document.getElementById('gdt-chips')?.remove();
    const esc = Utils.escapeHtml;
    const preds = Gantt3View._chipsPredicates();
    const strip = document.createElement('div'); strip.id = 'gdt-chips';
    strip.innerHTML = preds.map(p => '<button class="gc-chip" data-k="' + esc(p.key) + '">' + esc(p.label) + ' <span class="gc-n"></span></button>').join('') + '<span class="gc-res"></span>';
    wrap.parentNode.insertBefore(strip, wrap);
    strip.querySelectorAll('.gc-chip').forEach(ch => ch.addEventListener('click', () => {
      const k = ch.dataset.k;
      if (Gantt3View._chips.active.has(k)) Gantt3View._chips.active.delete(k); else Gantt3View._chips.active.add(k);
      Gantt3View._chipsApply();
    }));
    Gantt3View._chips.strip = strip;
    Gantt3View._chipsApply();
  },
  _chipsApply() {
    const C = Gantt3View._chips; const wrap = document.getElementById('gantt3-wrap');
    if (!wrap || !C.strip) return;
    const preds = Gantt3View._chipsPredicates();
    const active = preds.filter(p => C.active.has(p.key));
    const rows = [...wrap.querySelectorAll('.gantt-row[data-epic-key]')];
    let shown = 0; const teamHit = {};
    rows.forEach(r => {
      const hit = active.every(p => p.test(r));
      r.classList.toggle('gdt-chip-dim', active.length > 0 && !hit);
      if (hit) { shown++; teamHit[r.dataset.teamKey] = true; }
    });
    wrap.querySelectorAll('.gantt-team-header[data-team-key]').forEach(h => h.classList.toggle('gdt-chip-dim', active.length > 0 && !teamHit[h.dataset.teamKey]));
    C.strip.querySelectorAll('.gc-chip').forEach(ch => {
      const k = ch.dataset.k; const p = preds.find(x => x.key === k);
      const test = active.slice(); if (!C.active.has(k) && p) test.push(p);
      const cnt = rows.filter(r => test.every(x => x.test(r))).length;
      ch.querySelector('.gc-n').textContent = cnt;
      ch.dataset.zero = cnt === 0 ? '1' : '0';
      ch.classList.toggle('on', C.active.has(k));
    });
    C.strip.querySelector('.gc-res').textContent = active.length ? ('показано ' + shown + ' из ' + rows.length) : (rows.length + ' эпиков');
  },
  _chipsClearDim() { document.querySelectorAll('#gantt3-wrap .gdt-chip-dim').forEach(e => e.classList.remove('gdt-chip-dim')); },

  /* ═══════════════════════════════════════════════════════════════════════
     Гант 3.0 · п.19 — «RADIAL-MENU» (порт lab sketch 27, посимпатичнее). ПКМ по
     пилюле → радиальное SVG-меню (5 секторов). Перехват в capture-фазе раньше
     существующего rect-меню; безопасные действия (Детали/Линза/Похожие/Копир.)
     + сектор «Ещё» возвращает существующее wired-меню через bypass-флаг.
     ═══════════════════════════════════════════════════════════════════════ */
  _radialBind() {
    const wrap = document.getElementById('gantt3-wrap');
    if (!wrap || wrap._gdtRadialBound) return;
    wrap._gdtRadialBound = true;
    wrap.addEventListener('contextmenu', (e) => {
      if (Gantt3View._radial.bypass) { Gantt3View._radial.bypass = false; return; }  // → существующее rect-меню
      const pill = e.target.closest('.gantt-type-pill[data-wt][data-row-id]');
      if (!pill || pill.dataset.wt === 'задача' || pill.classList.contains('gantt-pill-ghost')) return;
      e.preventDefault(); e.stopPropagation();
      Gantt3View._radialOpen(e.clientX, e.clientY, pill);
    }, true);
  },
  _radialOpen(x, y, pill) {
    Gantt3View._radialClose();
    const esc = Utils.escapeHtml;
    const wt = (pill.querySelector('.gdt-pill-name')?.textContent || pill.dataset.wt || '').trim();
    const colKey = pill.closest('.gantt-cell[data-col]')?.dataset.col || pill.dataset.srcCol || '';
    const rel = GANTT_COL_LABELS[colKey] || colKey;
    const sectors = [
      { key: 'details', label: 'Детали',  acc: 'var(--prizma-information)',          glyph: '<circle cx="0" cy="-3" r="1.2"/><path d="M0 0v5"/>' },
      { key: 'lens',    label: 'Линза',    acc: 'var(--prizma-information)',          glyph: '<circle cx="-2" cy="-2" r="3.2"/><path d="M2.4 2.4l2 2"/>' },
      { key: 'similar', label: 'Похожие',  acc: 'var(--prizma-insight, #7C5CFF)',     glyph: '<path d="M-5 -3h10M-5 0h10M-5 3h6"/>' },
      { key: 'copy',    label: 'Копир.',   acc: 'var(--prizma-on-course)',            glyph: '<rect x="-5" y="-4" width="7" height="9" rx="1.2"/><path d="M-2 -7h6v9"/>' },
      { key: 'more',    label: 'Ещё',      acc: 'var(--prizma-text-secondary, #888)', glyph: '<circle cx="-4.5" cy="0" r="1.1"/><circle cx="0" cy="0" r="1.1"/><circle cx="4.5" cy="0" r="1.1"/>' },
    ];
    const N = sectors.length, R_IN = 44, R_OUT = 104, GAP = 3;
    const polar = (r, deg) => { const a = (deg - 90) * Math.PI / 180; return [116 + r * Math.cos(a), 116 + r * Math.sin(a)]; };
    const arcPath = (a0, a1) => {
      const [x0, y0] = polar(R_OUT, a0), [x1, y1] = polar(R_OUT, a1), [x2, y2] = polar(R_IN, a1), [x3, y3] = polar(R_IN, a0);
      const laf = (a1 - a0) > 180 ? 1 : 0;
      return 'M' + x0.toFixed(1) + ' ' + y0.toFixed(1) + ' A' + R_OUT + ' ' + R_OUT + ' 0 ' + laf + ' 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
        ' L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + ' A' + R_IN + ' ' + R_IN + ' 0 ' + laf + ' 0 ' + x3.toFixed(1) + ' ' + y3.toFixed(1) + ' Z';
    };
    let svg = '';
    sectors.forEach((s, i) => {
      const a0 = i * (360 / N) + GAP / 2, a1 = (i + 1) * (360 / N) - GAP / 2, mid = (a0 + a1) / 2;
      const [lx, ly] = polar((R_IN + R_OUT) / 2 + 16, mid), [gx, gy] = polar((R_IN + R_OUT) / 2 - 8, mid);
      svg += '<g class="rs-sect" data-key="' + s.key + '" style="--rs-acc:' + s.acc + '"><path class="rs-arc" d="' + arcPath(a0, a1) + '"/>' +
        '<g class="rs-glyph" transform="translate(' + gx.toFixed(1) + ',' + gy.toFixed(1) + ')">' + s.glyph + '</g>' +
        '<text class="rs-lab" x="' + lx.toFixed(1) + '" y="' + (ly + 3).toFixed(1) + '">' + esc(s.label) + '</text></g>';
    });
    svg += '<circle class="rs-hub" cx="116" cy="116" r="' + (R_IN - 4) + '"/><text class="rs-hub-t" x="116" y="114">' + esc(wt.slice(0, 9)) + '</text><text class="rs-hub-t2" x="116" y="126">' + esc(rel) + '</text>';
    const el = document.createElement('div'); el.id = 'gdt-radial';
    el.innerHTML = '<svg viewBox="0 0 232 232" aria-label="Радиальное меню">' + svg + '</svg>';
    const pad = 120;
    el.style.left = Math.max(pad, Math.min(window.innerWidth - pad, x)) + 'px';
    el.style.top = Math.max(pad, Math.min(window.innerHeight - pad, y)) + 'px';
    document.body.appendChild(el);
    Gantt3View._radial.el = el;
    requestAnimationFrame(() => el.classList.add('show'));
    el.querySelectorAll('.rs-sect').forEach(g => {
      g.addEventListener('mouseenter', () => g.classList.add('hot'));
      g.addEventListener('mouseleave', () => g.classList.remove('hot'));
      g.addEventListener('click', () => Gantt3View._radialAction(g.dataset.key, pill, x, y));
    });
    Gantt3View._radial.onDoc = (ev) => {
      if (ev.type === 'keydown') { if (ev.key === 'Escape') Gantt3View._radialClose(); return; }
      if (!el.contains(ev.target)) Gantt3View._radialClose();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', Gantt3View._radial.onDoc, true);
      document.addEventListener('keydown', Gantt3View._radial.onDoc, true);
      window.addEventListener('scroll', Gantt3View._radialClose, true);
    }, 0);
  },
  _radialAction(key, pill, x, y) {
    Gantt3View._radialClose();
    if (key === 'details') { Gantt3View._anatomyOpen(pill); }
    else if (key === 'lens') { if (!Gantt3View._lens.on) Gantt3View._lensEnter(); const ek = pill.closest('.gantt-row[data-epic-key]')?.dataset.epicKey; if (ek) { Gantt3View._lens.locked = true; Gantt3View._lensFocus(ek); } }
    else if (key === 'similar') { Gantt3View._radialSimilar(pill); }
    else if (key === 'copy') { const wt = (pill.querySelector('.gdt-pill-name')?.textContent || pill.dataset.wt || '').trim(); const ep = (pill.closest('.gantt-row[data-epic-key]')?.querySelector('.v16-epic-name')?.textContent || '').trim(); try { navigator.clipboard?.writeText((ep ? ep + ' · ' : '') + wt); window.showToast?.('Скопировано', 'info', 1300); } catch (_) {} }
    else if (key === 'more') { Gantt3View._radial.bypass = true; pill.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y })); }
  },
  _radialSimilar(pill) {
    const wt = pill.dataset.wt; const wrap = document.getElementById('gantt3-wrap');
    if (!wrap || !wt) return;
    const esc = (s) => (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s);
    wrap.querySelectorAll('.gantt-type-pill.gdt-mq-sel').forEach(p => p.classList.remove('gdt-mq-sel'));
    const same = wrap.querySelectorAll('.gantt-type-pill[data-wt="' + esc(wt) + '"]:not(.gantt-pill-ghost)');
    same.forEach(p => p.classList.add('gdt-mq-sel'));
    window.showToast?.('Похожих по «' + wt + '»: ' + same.length, 'info', 1800);
  },
  _radialClose() {
    const R = Gantt3View._radial;
    if (R.onDoc) { document.removeEventListener('mousedown', R.onDoc, true); document.removeEventListener('keydown', R.onDoc, true); R.onDoc = null; }
    window.removeEventListener('scroll', Gantt3View._radialClose, true);
    if (R.el) { R.el.remove(); R.el = null; }
  },

  /* ═══════════════════════════════════════════════════════════════════════
     Гант 3.0 · п.23 — «ПОДСКАЗКИ» / smart-suggest (порт lab sketch 21). Боковая
     панель: read-only наблюдения по плану (перегруз / риск без владельца /
     частые переезды / не начато), у каждого «Показать в Ганте» — scroll+flash
     эпика. БЕЗ мутаций (apply из скетча небезопасен на проде) — это нудж, не
     автодействие; решение за человеком.
     ═══════════════════════════════════════════════════════════════════════ */
  _suggestToggle() {
    if (Gantt3View._suggest.el) Gantt3View._suggestClose();
    else                       Gantt3View._suggestOpen();
  },
  _suggestDerive(data) {
    const out = [];
    let worst = null;
    data.teams.forEach(t => data.cols.forEach(c => { const n = data.epics.filter(e => e.teamKey === t.key).reduce((s, e) => s + ((e.cells[c] || []).length), 0); if (!worst || n > worst.n) worst = { team: t.name, col: c, n }; }));
    if (worst && worst.n >= 4) out.push({ sev: 'warn', title: 'Перегруз: ' + worst.team + ' · ' + (data.colLabel[worst.col] || worst.col), why: 'В этом окне ' + worst.n + ' работ — больше всех. Стоит разгрузить или перенести часть на соседний релиз.', epicKey: null });
    data.epics.filter(e => e.risk).forEach(e => { if (Object.values(e.cells).flat().some(p => !p.who)) out.push({ sev: 'crit', title: 'Риск без владельца: ' + e.epic, why: 'У эпика есть риск-метки, но не все работы назначены. Назначьте ответственного.', epicKey: e.key }); });
    data.epics.filter(e => e.churn).forEach(e => out.push({ sev: 'warn', title: 'Частые переезды: ' + e.epic, why: 'Эпик нестабилен — переезжал между релизами. Проверьте реалистичность плана.', epicKey: e.key }));
    data.epics.filter(e => e.total > 0 && e.active === 0 && e.done === 0).slice(0, 3).forEach(e => out.push({ sev: 'info', title: 'Не начато: ' + e.epic, why: 'Запланировано работ: ' + e.total + ', но ни одна не в работе. Пора стартовать?', epicKey: e.key }));
    return out;
  },
  _suggestOpen() {
    const data = Gantt3View._collectEpics();
    const items = Gantt3View._suggestDerive(data);
    const esc = Utils.escapeHtml;
    const el = document.createElement('div'); el.id = 'gdt-suggest';
    el.innerHTML = '<div class="sg-top"><span class="sg-title">Подсказки</span><span style="font:600 11px/1 var(--mono,monospace);color:var(--prizma-text-tertiary)">' + items.length + '</span><button class="sg-close" aria-label="Закрыть">×</button></div>' +
      '<div class="sg-body">' + (items.length ? items.map(it => '<div class="sg-card ' + it.sev + '"><div class="sg-ct">' + esc(it.title) + '</div><div class="sg-cw">' + esc(it.why) + '</div>' + (it.epicKey ? '<button class="sg-act" data-ek="' + esc(it.epicKey) + '">Показать в Ганте</button>' : '') + '</div>').join('') : '<div class="sg-empty">План выглядит сбалансированно — серьёзных наблюдений нет.</div>') + '</div>';
    document.body.appendChild(el);
    Gantt3View._suggest.el = el;
    const btn = document.getElementById('btn-gantt3-suggest'); if (btn) { btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true'); }
    el.querySelector('.sg-close').addEventListener('click', () => Gantt3View._suggestClose());
    el.querySelectorAll('.sg-act').forEach(b => b.addEventListener('click', () => Gantt3View._suggestShow(b.dataset.ek)));
  },
  _suggestShow(ek) {
    const wrap = document.getElementById('gantt3-wrap'); if (!wrap) return;
    const esc = (s) => (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s);
    const row = wrap.querySelector('.gantt-row[data-epic-key="' + esc(ek) + '"]');
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.remove('gdt-flash'); void row.offsetWidth; row.classList.add('gdt-flash');
    setTimeout(() => row.classList.remove('gdt-flash'), 1700);
  },
  _suggestClose() {
    if (Gantt3View._suggest.el) { Gantt3View._suggest.el.remove(); Gantt3View._suggest.el = null; }
    const btn = document.getElementById('btn-gantt3-suggest'); if (btn) { btn.classList.remove('active'); btn.setAttribute('aria-pressed', 'false'); }
  },

  /* ═══════════════════════════════════════════════════════════════════════
     Гант 3.0 · п.22 — «INLINE-EDIT» (порт lab sketch 22). Двойной клик по имени
     эпика → инлайн-input; Enter/blur коммитит в state.rows[i].epic (реактивный
     ре-рендер + HistoryManager-checkpoint для undo), Esc отменяет. Делегат на
     #gantt3-wrap; не активен в режимах Линза/Фокус.
     ═══════════════════════════════════════════════════════════════════════ */
  _inlineBind() {
    const wrap = document.getElementById('gantt3-wrap');
    if (!wrap || wrap._gdtInlineBound) return;
    wrap._gdtInlineBound = true;
    wrap.addEventListener('dblclick', (e) => {
      if (Gantt3View._lens.on || Gantt3View._focusLane.on) return;
      const nm = e.target.closest('.v16-epic-name');
      if (!nm || nm.querySelector('input')) return;
      const row = nm.closest('.gantt-row[data-row-id]');
      if (!row) return;
      e.preventDefault(); e.stopPropagation();
      Gantt3View._inlineEditName(nm, row.dataset.rowId);
    });
  },
  _inlineEditName(nm, rowId) {
    const cur = nm.textContent.trim();
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = cur; inp.className = 'gdt-inline-input';
    inp.setAttribute('aria-label', 'Переименовать эпик');
    nm.textContent = ''; nm.appendChild(inp); inp.focus(); inp.select();
    let done = false;
    const finish = (commit) => {
      if (done) return; done = true;
      const val = inp.value.trim();
      if (commit && val && val !== cur) {
        const row = (state.rows || []).find(r => r.id === rowId);
        if (row) {
          try { Services.HistoryManager?.checkpoint?.('переименование эпика'); } catch (_) {}
          row.epic = val;                         // reactive proxy → Storage.save + re-render
          try { window.showToast?.('Эпик переименован', 'info', 1400); } catch (_) {}
          return;                                 // re-render перерисует строку
        }
      }
      nm.textContent = cur;                       // отмена / без изменений
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    inp.addEventListener('blur', () => finish(true));
  },

  /* ═══════════════════════════════════════════════════════════════════════
     Гант 3.0 · п.17 — «СЛОЙ ЗАМЕТОК» / annotations (порт lab sketch 30). Toggle
     «Слой» → клик по ячейке добавляет свободную заметку; маркеры на размеченных
     ячейках; клик по маркеру → правка/удаление. Хранится В ОТДЕЛЬНОМ store
     (localStorage q2_gantt3_annot_v1), НЕ мутирует план эпиков.
     ═══════════════════════════════════════════════════════════════════════ */
  _annotLoad() {
    if (!Gantt3View._annotStore) { try { Gantt3View._annotStore = JSON.parse(localStorage.getItem('q2_gantt3_annot_v1') || '{}') || {}; } catch (_) { Gantt3View._annotStore = {}; } }
    return Gantt3View._annotStore;
  },
  _annotSave() { try { localStorage.setItem('q2_gantt3_annot_v1', JSON.stringify(Gantt3View._annotStore || {})); } catch (_) {} },
  _annotToggle() {
    const A = Gantt3View._annot; A.on = !A.on;
    document.body.classList.toggle('gdt-annot-on', A.on);
    const btn = document.getElementById('btn-gantt3-annot'); if (btn) { btn.classList.toggle('active', A.on); btn.setAttribute('aria-pressed', A.on ? 'true' : 'false'); }
    if (A.on) { Gantt3View._annotBind(); Gantt3View._annotRenderMarkers(); try { window.showToast?.('Слой заметок: клик по ячейке — добавить заметку', 'info', 2400); } catch (_) {} }
    else { Gantt3View._annotClearMarkers(); Gantt3View._annotClosePop(); }
  },
  _annotRenderMarkers() {
    const wrap = document.getElementById('gantt3-wrap'); if (!wrap) return;
    Gantt3View._annotClearMarkers();
    const store = Gantt3View._annotLoad();
    const esc = (s) => (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s);
    Object.keys(store).forEach(key => {
      const sep = key.indexOf('|'); const rowId = key.slice(0, sep), col = key.slice(sep + 1);
      const cell = wrap.querySelector('.gantt-cell[data-row-id="' + esc(rowId) + '"][data-col="' + esc(col) + '"]');
      if (cell) { const m = document.createElement('span'); m.className = 'gdt-annot-marker'; m.dataset.key = key; m.title = store[key]; cell.appendChild(m); }
    });
  },
  _annotClearMarkers() { document.querySelectorAll('#gantt3-wrap .gdt-annot-marker').forEach(m => m.remove()); },
  _annotBind() {
    const wrap = document.getElementById('gantt3-wrap'); if (!wrap || wrap._gdtAnnotBound) return;
    wrap._gdtAnnotBound = true;
    wrap.addEventListener('click', (e) => {
      if (!Gantt3View._annot.on) return;
      const marker = e.target.closest('.gdt-annot-marker');
      if (marker) { e.stopPropagation(); Gantt3View._annotOpenPop(marker.dataset.key, marker); return; }
      const cell = e.target.closest('.gantt-cell[data-row-id][data-col]');
      if (!cell || e.target.closest('.gantt-type-pill, button, .gdt-cell-risk-glyph, .gdt-note-bubble')) return;
      e.stopPropagation();
      Gantt3View._annotOpenPop(cell.dataset.rowId + '|' + cell.dataset.col, cell);
    });
  },
  _annotOpenPop(key, anchor) {
    Gantt3View._annotClosePop();
    const store = Gantt3View._annotLoad();
    const cur = store[key] || '';
    const pop = document.createElement('div'); pop.id = 'gdt-annot-pop';
    pop.innerHTML = '<textarea class="ga-ta" placeholder="Заметка к ячейке…">' + Utils.escapeHtml(cur) + '</textarea>' +
      '<div class="ga-row"><button class="ga-save">Сохранить</button>' + (cur ? '<button class="ga-del">Удалить</button>' : '') + '<button class="ga-cancel">Отмена</button></div>';
    document.body.appendChild(pop);
    Gantt3View._annot.pop = pop;
    const r = anchor.getBoundingClientRect();
    let left = r.left, top = r.bottom + 6; const pw = 240;
    if (left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
    if (top + 130 > window.innerHeight) top = Math.max(12, r.top - 136);
    pop.style.left = Math.max(12, left) + 'px'; pop.style.top = top + 'px';
    const ta = pop.querySelector('.ga-ta'); ta.focus();
    pop.querySelector('.ga-save').addEventListener('click', () => { const v = ta.value.trim(); if (v) store[key] = v; else delete store[key]; Gantt3View._annotSave(); Gantt3View._annotRenderMarkers(); Gantt3View._annotClosePop(); });
    pop.querySelector('.ga-del')?.addEventListener('click', () => { delete store[key]; Gantt3View._annotSave(); Gantt3View._annotRenderMarkers(); Gantt3View._annotClosePop(); });
    pop.querySelector('.ga-cancel').addEventListener('click', () => Gantt3View._annotClosePop());
    Gantt3View._annot.onDoc = (ev) => { if (ev.type === 'keydown') { if (ev.key === 'Escape') Gantt3View._annotClosePop(); return; } if (!pop.contains(ev.target) && !anchor.contains(ev.target)) Gantt3View._annotClosePop(); };
    setTimeout(() => { document.addEventListener('mousedown', Gantt3View._annot.onDoc, true); document.addEventListener('keydown', Gantt3View._annot.onDoc, true); }, 0);
  },
  _annotClosePop() {
    const A = Gantt3View._annot;
    if (A.onDoc) { document.removeEventListener('mousedown', A.onDoc, true); document.removeEventListener('keydown', A.onDoc, true); A.onDoc = null; }
    if (A.pop) { A.pop.remove(); A.pop = null; }
  },

  bindFullscreen() {
    const btn = document.getElementById('btn-gantt3-fullscreen');
    if (!btn || btn._gdtFsBound) return;
    btn._gdtFsBound = true;
    const section = document.getElementById('section-gantt3');
    const toggle = () => {
      const on = section.classList.toggle('gdt-fullscreen');
      // textContent затирал SVG-иконку и оставлял голый текст «Развернуть»,
      // который выходил за границы .prizma-icon-only-btn (min-width:28px) и
      // визуально наезжал на соседнюю кнопку. Icon-swap по тому же паттерну,
      // что и btn-gantt3-expand-all.
      const iconName = on ? 'minimize' : 'maximize';
      const label    = on ? 'Выйти из полного экрана' : 'Полный экран';
      btn.innerHTML  = Services.Icons?.get?.(iconName, { size: 14, label }) || '';
      btn.title      = label;
      btn.setAttribute('aria-label', label);
      Gantt3View._dtColWidths = {};
      Gantt3View.renderChart();
    };
    btn.addEventListener('click', toggle);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && section.classList.contains('gdt-fullscreen')) toggle();
    });
  },
  bindExpandCollapse() {
    const btn = document.getElementById('btn-gantt3-expand-all');
    if (!btn || btn._gdtEcBound) return;
    btn._gdtEcBound = true;
    btn.addEventListener('click', () => {
      // V16 roadmap-2 (B4) — preserve scroll-anchor across the toggle.
      Gantt3View._withScrollAnchor(() => {
        const teamKey = t => t.replace(/[^a-zA-Zа-яА-ЯёЁъЪ0-9]/g, '_');
        const allTks  = [...new Set(Gantt3View.getRows().map(r => teamKey(r.team)))];
        const anyVisible = allTks.some(tk => !Gantt3View._dtHiddenTeams?.has(tk));
        if (!Gantt3View._dtHiddenTeams) Gantt3View._dtHiddenTeams = new Set();
        if (anyVisible) allTks.forEach(tk => Gantt3View._dtHiddenTeams.add(tk));
        else            Gantt3View._dtHiddenTeams.clear();
        Gantt3View.renderChart();
      });
    });
  },
  // Wave1 P-GR §B5 — `renderFilters()` удалён (DOM-узел `#gantt-filters`
  // больше не существует, см. index.html и §B4 про `gf`).
  getRows() {
    // Wave1 P-GR §B4 — секция фильтров поверх FilterEngine удалена: локальный
    // `gf` всегда был initial-defaults, поэтому все ветки сводились к no-op.
    return FilterEngine.getFiltered();
  },
  /**
   * V22 G-04 (audit-experts-2026-05-15 Demin H1) — coalesce multiple
   * renderChart() calls within one microtask/tick into a single full
   * rebuild. Раньше при каждой пользовательской мутации (move + revert +
   * checkpoint + update + state-flush + Reactive notify) renderChart()
   * вызывался 3-5 раз подряд, каждый раз rebuild всей таблицы 200 строк.
   *
   * Этот wrapper:
   *  · если уже scheduled — no-op;
   *  · через rAF делает один реальный _renderChartImmediate;
   *  · `flushRenderChart()` для тестов / синхронных путей.
   *
   * Vanilla код, без runtime cost когда вызовов мало.
   */
  _renderChartRaf: 0,
  _renderChartScheduled: false,
  scheduleRenderChart() {
    if (Gantt3View._renderChartScheduled) return;
    Gantt3View._renderChartScheduled = true;
    const fn = () => {
      Gantt3View._renderChartScheduled = false;
      Gantt3View._renderChartRaf = 0;
      try { Gantt3View._renderChartImmediate(); } catch (e) { console.warn('[Gantt] renderChart threw:', e); }
    };
    if (typeof requestAnimationFrame === 'function') {
      Gantt3View._renderChartRaf = requestAnimationFrame(fn);
    } else {
      Gantt3View._renderChartRaf = setTimeout(fn, 16);
    }
  },
  flushRenderChart() {
    if (!Gantt3View._renderChartScheduled) return;
    if (Gantt3View._renderChartRaf) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(Gantt3View._renderChartRaf);
      else clearTimeout(Gantt3View._renderChartRaf);
      Gantt3View._renderChartRaf = 0;
    }
    Gantt3View._renderChartScheduled = false;
    Gantt3View._renderChartImmediate();
  },
  renderChart() {
    // V22 G-04 — публичный API остаётся прежним; делегируем в coalescer.
    // Любой синхронный код, который ожидал что после renderChart() DOM
    // ОЧЕНЬ скоро обновится — должен дождаться следующего rAF либо
    // явно вызвать Gantt3View.flushRenderChart().
    Gantt3View.scheduleRenderChart();
  },
  _renderChartImmediate() {
    // AUDIT-12 — отмечаем grace-окно в НАЧАЛЕ render (не только в конце на
    // 2138). Иначе при тяжёлом DOM/throttled rAF render длится >250ms,
    // grace истекает, и subscriber-flush от Storage.save даёт второй полный
    // re-render. Ранний mark покрывает это окно.
    try { Services.App?.markRenderedNow?.(); } catch (_) {}
    Gantt3View._clearTransientInteractions();
    if (Gantt3View._docTipListener) {
      document.removeEventListener('mousemove', Gantt3View._docTipListener);
      Gantt3View._docTipListener = null;
    }
    document.querySelectorAll('.gep-tooltip,.gtx-tooltip').forEach(t => t.remove());

    // #7: preserve scroll position across re-renders. Drag-drop / move-next /
    // delete / backlog-edit trigger renderChart() which sets innerHTML — that
    // wipes any scroll state. We capture three independent scrollers because
    // depending on mode the vertical scroll lives on a different element:
    //   · normal mode:     vertical scroll on `window` (gantt3-wrap is overflow-y:visible)
    //   · fullscreen mode: vertical scroll on `.gantt-container` (max-height + overflow-y:auto)
    //   · horizontal:      always on `#gantt3-wrap` (overflow-x:auto)
    // Capturing only window.scrollY would miss fullscreen; capturing only
    // wrap.scrollTop would miss normal mode. Capture all three.
    const _wrapForScroll = document.getElementById('gantt3-wrap');
    const _containerForScroll = _wrapForScroll?.querySelector('.gantt-container');
    if (_wrapForScroll) {
      Gantt3View._pendingScrollX     = _wrapForScroll.scrollLeft || 0;
      Gantt3View._pendingScrollY     = _wrapForScroll.scrollTop  || 0;
      Gantt3View._pendingContainerY  = _containerForScroll?.scrollTop || 0;
      Gantt3View._pendingDocY        = window.scrollY || 0;
    }

    // V14: legacy Gantt modes ('epics' / 'arrows' / 'ultra' / 'arrowsNew')
    // are all retired — only `detailedTasks` remains. The V13 GanttV2
    // ("Гант 2.0" with ISO-week zoom + dependency arrows) was removed
    // because it duplicated functionality already covered by the main
    // detailed-tasks view, the legacy code was a maintenance tax, and
    // user explicitly requested its removal (B2).
    const wrap=document.getElementById('gantt3-wrap');
    if (wrap) { wrap.style.display=''; }
    const rows=Gantt3View.getRows();
    if (!rows.length){wrap.innerHTML=`<div class="empty-state">${prizmaEmptyGlyph()}<div class="empty-title">План пуст</div><div class="empty-sub">Загрузите XLSX или включите демо-данные, чтобы увидеть курс квартала.</div></div>`;return;}
    // V17.1 C1 — backlog header label removed (was «Бэклог»). Колодец остаётся,
    //   но текст заголовка / подзаголовка скрыт — пользовательский запрос.
    // V17.1 C4 — date sub теперь рендерится длинным русским форматом
    //   («20 апреля – 17 мая») через formatLongRange при сборке header'а;
    //   `sub` оставляем в исходном `DD.MM–DD.MM` потому что parser today-pill
    //   завязан на этот формат.
    // #1 C2 — cols строятся из buildReleaseList(state.releases). Legacy 5
    // («backlog/r120/r121/r122/overtime») получают kind='legacy' и flatTypes/
    // flatHas (для чтения row.release120Types и т.п.). Custom релизы — kind='custom',
    // данные в row.customReleaseTypes[key]. Скрытые через локальный «глаз»
    // (state.ganttHiddenReleases) — отфильтрованы.
    const hiddenSet = new Set(Array.isArray(state.ganttHiddenReleases) ? state.ganttHiddenReleases : []);
    const cols = buildReleaseList(state.releases)
      .filter(r => !hiddenSet.has(r.key))
      .map(r => ({
        key:       r.key,
        label:     r.short || r.label,
        sub:       r.key === 'backlog' ? '' : (r.dates || (r.key === 'overtime' ? 'Овертайм' : '')),
        cls:       r.cls,
        kind:      r.kind,
        flatTypes: r.flatTypes,
        flatHas:   r.flatHas,
      }));
    // Only `detailedTasks` mode is reachable here — `arrowsNew` was handled
    // above (delegates to GanttV2). The legacy `compact` and team-wells
    // modes were removed (audit recommendation #4 / user request).
    return Gantt3View.renderDetailedTasks(rows, wrap, cols);
  },
  renderDetailedTasks(rows, wrap, cols) {
    /* ---- helpers ---- */
    const esc = Utils.escapeHtml;
    const toTags = v => String(v||'').split(/[|,]/).map(s=>s.trim()).filter(Boolean);
    // V21 Wave-3 — emoji-prefix для типов работ удалён по брендбуку.
    // Категория уже выводится текстом, дублирующий эмодзи не нужен.
    const wtEmoji = () => '';

    /* ---- field maps ----
       Legacy 5 релизов хранят данные в плоских полях row.release120Types и т.п.
       Custom релизы — в row.customReleaseTypes[key]. Helpers ниже унифицируют
       read/write для обоих kind. Maps ещё используются legacy code-path'ами
       (overview header counts, DnD по legacy ключам). */
    const _colByKey = Object.create(null);
    for (const c of cols) _colByKey[c.key] = c;
    const _colKind = (key) => _colByKey[key]?.kind || 'legacy';
    // AUDIT-2/4 — legacy vs custom определяем по принадлежности к этому набору,
    // НЕ по _colByKey (который содержит только видимые cols → move в скрытый
    // колодец ломался). Так move/add/ctx работают для любого колодца.
    const _FLAT_FIELD = { backlog: 'backlogTypes', r120: 'release120Types', r121: 'release121Types', r122: 'release122Types', overtime: 'overtimeTypes' };
    const _FLAT_HAS   = { backlog: 'isUnassigned', r120: 'hasRelease120', r121: 'hasRelease121', r122: 'hasRelease122', overtime: 'hasOvertime' };
    const _isLegacyCol = (key) => Object.prototype.hasOwnProperty.call(_FLAT_FIELD, key);
    const _readTypes = (row, key) => {
      if (_isLegacyCol(key)) return Array.isArray(row[_FLAT_FIELD[key]]) ? row[_FLAT_FIELD[key]] : [];
      const map = row.customReleaseTypes || {};
      return Array.isArray(map[key]) ? map[key] : [];
    };
    const _writeTypes = (row, key, arr) => {
      if (_isLegacyCol(key)) { row[_FLAT_FIELD[key]] = Array.isArray(arr) ? arr : []; return; }
      if (!row.customReleaseTypes) row.customReleaseTypes = {};
      row.customReleaseTypes[key] = Array.isArray(arr) ? arr : [];
    };
    const _hasTypes = (row, key) => {
      if (_isLegacyCol(key)) return !!row[_FLAT_HAS[key]];
      const arr = row.customReleaseTypes?.[key];
      return Array.isArray(arr) && arr.length > 0;
    };
    // Лейбл колодца с fallback на ярлык кастомного релиза (AUDIT-23 — убрать
    // «undefined» в тостах). cols строятся из buildReleaseList → берём оттуда.
    const _colLabelFor = (key) => {
      const c = _colByKey[key];
      if (c) return c.label;
      const rel = (state.releases || []).find(r => r.key === key);
      return GANTT_COL_LABELS[key] || rel?.short || rel?.label || key;
    };
    // AUDIT-23 — лейблы колодцев с кастомными релизами (иначе undefined в
    // KB-drag/trail). hasMap/tfMap/colKeyMap (legacy-only) удалены — везде
    // теперь _readTypes/_writeTypes/_hasTypes.
    const COL_LABEL_MAP = { ...GANTT_COL_LABELS };
    for (const r of (state.releases || [])) COL_LABEL_MAP[r.key] = r.short || r.label || r.key;
    for (const c of cols) COL_LABEL_MAP[c.key] = c.label;

    /* V15 Spine redesign 2026-04-30 — emoji-prefix helpers retired
       (avatar circle, 📅, 📬). Pill content is now a two-row layout:
         row 1 = name + state-glyph + comment-marker
         row 2 = «ФИО · 01.05—15.05 · token(s)» (meta footer)
       New helpers below produce the meta string and the state/comment
       markers as plain HTML — no emoji, no inline colours unless required
       (cmt-marker uses a CSS class for amber/blue). */

    /** Compact «01.05—15.05» from ISO-ish dates. Returns '' if either side
     *  is empty. Drops year (always current scope) but keeps day+month. */
    const _shortPeriod = (row) => {
      if (!row || !row.workStartDate || !row.workEndDate) return '';
      const fmt = (s) => {
        const d = new Date(s);
        if (Number.isNaN(d.getTime())) return String(s);
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
      };
      return `${fmt(row.workStartDate)}—${fmt(row.workEndDate)}`;
    };

    /** Compact assignee label for the meta-row. 0 → '—', 1 → fio,
     *  2 → "А, Б", 3+ → "А, Б +N". Falls back to abbreviated last names if
     *  the joined string would be too long for the pill (>22 chars). */
    const _assigneeLabel = (assignees) => {
      if (!assignees || !assignees.length) return '';
      const lasts = assignees.map(s => String(s || '').trim().split(/\s+/)[0] || s);
      if (assignees.length === 1) return lasts[0];
      if (assignees.length === 2) return `${lasts[0]}, ${lasts[1]}`;
      return `${lasts[0]}, ${lasts[1]} +${assignees.length - 2}`;
    };
    /** V16 roadmap-2 (B2) — short initials for the Compact-density badge.
     *  «Иванов Иван» → «ИИ»; single-name «Иванов» → «И». 2 chars max. */
    const _initialsLabel = (assignees) => {
      if (!assignees || !assignees.length) return '';
      const first = String(assignees[0] || '').trim();
      if (!first) return '';
      const parts = first.split(/\s+/).filter(Boolean);
      const init = parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
      const suffix = assignees.length > 1 ? `+${assignees.length - 1}` : '';
      return (init.toUpperCase() + suffix);
    };


    /* ---- shared helpers used by ctx-menu + drag-and-drop ---- */
    // Format ISO timestamp as "dd.mm.yy" — used in ghost-pill labels (#9).
    const fmtMoveDate = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(-2)}`;
    };
    // Move work-type `wt` from `srcCol` to `dstCol` on `row`. Records a ghost
    // arrow with timestamp so renderer leaves a "перенос dd.mm.yy" trail in the
    // source cell. Used by both the context-menu "Перенести в …" action and
    // cross-cell drag-and-drop (#5/#8/#9/#12).
    const moveWtBetweenCols = (row, wt, srcCol, dstCol, opts = {}) => {
      // V22 G-02 (audit-experts-2026-05-15 Demin C2) — все мутации идут
      // через ПЕРЕСОЗДАНИЕ массива (spread + reassign), а не через
      // push/splice на proxy-wrapped reference. Push/splice на прокси
      // ТЕХНИЧЕСКИ триггерит set-trap (Array.prototype.push internally
      // does set on index + length), но reassign-pattern: (а) явнее
      // выражает интент «массив обновился», (б) защищён от случаев когда
      // raw-array извлекли через RAW_TARGET, (в) совместим с будущей
      // оптимизацией PROXY_CACHE.
      // AUDIT-2 — custom-aware через _readTypes/_writeTypes (был legacy-only
      // colKeyMap → перенос в кастомный колодец = тихая потеря данных).
      _writeTypes(row, srcCol, _readTypes(row, srcCol).filter(t => t !== wt));
      const dstExisting = _readTypes(row, dstCol);
      if (!dstExisting.includes(wt)) _writeTypes(row, dstCol, [...dstExisting, wt]);
      const at = new Date().toISOString();
      // V15 (1.4.2): preserve full history of moves. Earlier we filtered out
      // any prior arrow for the same `wt` ("pill can only have ONE current
      // move-trail") — that erased the trail when the user moved a pill
      // through several columns (1.20 → 1.21 → 1.22 left only the last hop
      // visible). Now we append every move; renderer surfaces each as its
      // own sub-row so the chain reads naturally top-to-bottom.
      row.ganttArrows = [...(Array.isArray(row.ganttArrows) ? row.ganttArrows : []), { wt, srcCol, dstCol, at }];
      // V14 (B5): if a comment was supplied (plan-locked move), append to
      // the row's transfer-comment trail. Each entry stores enough context
      // to be useful later: timestamp, what moved, src/dst, free-form text.
      // V17 P2 (CRIT-3): when plan is locked AND edit-mode is on, the
      // comment-modal is bypassed (`requireMoveComment` resolves '' early)
      // — but we MUST still record an audit entry. Otherwise edit-mode
      // becomes a hole in the plan-lock contract: 30 moves under edit-mode
      // produce zero `transferComments`, breaking compliance use-case.
      const planLocked = !!(state.planLocked);
      const editModeOn = !!(state.ganttEditMode);
      const existingComments = Array.isArray(row.transferComments) ? row.transferComments : [];
      if (opts.comment) {
        row.transferComments = [...existingComments, { at, wt, from: srcCol, to: dstCol, text: String(opts.comment) }];
      } else if (planLocked && editModeOn) {
        row.transferComments = [...existingComments, { at, wt, from: srcCol, to: dstCol, text: '[edit-mode]' }];
      }
      row.dirty = true;
      row.updatedAt = at;
      RowFactory.updateDerived(row);
      Storage.save();
      try { window.HistoryLog?.gantt?.('move_wt', `${wt}: ${srcCol}→${dstCol}${opts.comment ? ' [с комментарием]' : ''}`, { wt, srcCol, dstCol, comment: opts.comment }); } catch(_) {}
    };
    // Inverse of moveWtBetweenCols: revert a moved pill back to its source cell
    // (#6: "Вернуть обратно" in the ctx menu of the destination pill).
    const revertMove = (row, wt, currentCol) => {
      const arrows = row.ganttArrows || [];
      const idx = arrows.findIndex(a => a.dstCol === currentCol && a.wt === wt);
      if (idx < 0) return null;
      const a = arrows[idx];
      // AUDIT-2 — custom-aware (был legacy-only colKeyMap).
      _writeTypes(row, a.dstCol, _readTypes(row, a.dstCol).filter(t => t !== wt));
      const srcExisting = _readTypes(row, a.srcCol);
      if (!srcExisting.includes(wt)) _writeTypes(row, a.srcCol, [...srcExisting, wt]);
      row.ganttArrows = arrows.filter((_, i) => i !== idx);
      row.dirty = true;
      row.updatedAt = new Date().toISOString();
      RowFactory.updateDerived(row);
      Storage.save();
      return a;
    };

    /* ---- per-column widths (persisted across re-renders) ---- */
    if (!Gantt3View._dtColWidths) Gantt3View._dtColWidths = {};
    if (!Gantt3View._dtHiddenTeams) Gantt3View._dtHiddenTeams = new Set();
    const wrapW      = Math.max(960, wrap.clientWidth || 0);
    const lwDefault  = Math.max(220, Math.min(420, Math.round(wrapW * 0.18)));
    // '_label' key stores user-resized label-column width
    if (!Gantt3View._dtColWidths['_label']) Gantt3View._dtColWidths['_label'] = lwDefault;
    // V21 — Бэклог по умолчанию 160px (user request, 2026-05-07).
    // 1.20/1.21/1.22/Овертайм продолжают расти по 1fr — это активные релизы,
    // им нужна пропорциональная ширина под bars. Бэклог визуально вторичен.
    if (!Gantt3View._dtColWidths['backlog']) Gantt3View._dtColWidths['backlog'] = 160;
    const getLW      = () => Gantt3View._dtColWidths['_label'] || lwDefault;
    const defaultCw  = Math.max(200, Math.floor((wrapW - getLW()) / cols.length));
    const getW       = key => Gantt3View._dtColWidths[key] || defaultCw;
    // V17.1 C2 — wells растягиваются равномерно на всю доступную ширину.
    //   Если пользователь не менял ширину колодца → выдаём
    //   `minmax(<defaultCw>px, 1fr)` — оставшееся место делится между ними.
    //   Если ширина зафиксирована вручную → конкретные пиксели.
    //   Если все колодцы зафиксированы — поведение прежнее (точные px),
    //   просто без 1fr-наполнения.
    const makeGT     = () => {
      const lw = getLW();
      const segs = cols.map(c => {
        const w = Gantt3View._dtColWidths[c.key];
        return w ? `${w}px` : `minmax(${defaultCw}px, 1fr)`;
      });
      return `${lw}px ` + segs.join(' ');
    };

    /* ---- build HTML body ---- */
    let body = '';
    const teams   = Utils.unique(rows.map(r => r.team));
    const teamKey = t => t.replace(/[^a-zA-Zа-яА-ЯёЁъЪ0-9]/g,'_');

    /* V22 G-05 (audit-experts-2026-05-15 Demin H2) — precompute Map<team→rows[]>.
       Раньше hot-path был O(N×M):
         teams.forEach(team => {
           const teamRows = rows.filter(r => r.team === team);   // O(N)
           ...
         });
       На 100 команд × 200 rows = 20 000 итераций КАЖДЫЙ renderChart().
       Теперь — один проход (O(N)) для построения Map, затем .get() за O(1)
       при обходе teams. */
    const rowsByTeam = new Map();
    for (const r of rows) {
      const t = r.team;
      const list = rowsByTeam.get(t);
      if (list) list.push(r);
      else rowsByTeam.set(t, [r]);
    }

    /* V16 roadmap-2 (S3) — capacity load-distribution sparkline. We
       precompute (a) per-team per-bucket counts and (b) the global max so
       bars are comparable across teams (one team's «full» bar = another's
       «full» bar). Threshold = 8 per bucket → bar gets a red overload tick
       on top so PMs can spot overcommitted teams in one glance. */
    const BUCKET_KEYS = ['backlog','r120','r121','r122','overtime'];
    const teamCounts = new Map();
    let globalMaxBucket = 0;
    rows.forEach(r => {
      const key = r.team;
      if (!teamCounts.has(key)) teamCounts.set(key, { backlog:0, r120:0, r121:0, r122:0, overtime:0 });
      const c = teamCounts.get(key);
      if (r.hasRelease120)  c.r120++;
      if (r.hasRelease121)  c.r121++;
      if (r.hasRelease122)  c.r122++;
      if (r.hasOvertime)    c.overtime++;
      if (r.isUnassigned)   c.backlog++;
    });
    teamCounts.forEach(c => {
      BUCKET_KEYS.forEach(k => { if (c[k] > globalMaxBucket) globalMaxBucket = c[k]; });
    });
    if (globalMaxBucket < 1) globalMaxBucket = 1;
    const OVERLOAD_THRESHOLD = 8;

    /* V16 roadmap-2 (B1) — per-column distribution sparkline. Aggregates
       work-type counts across ALL teams for each bucket so the column
       header gets a tiny stacked-bar showing the whole-portfolio mix
       («в 1.21 баланс BE/FE/QA сломан?»). Computed once per render. */
    const colWtMix = { backlog:{}, r120:{}, r121:{}, r122:{}, overtime:{} };
    const COL_TO_FIELD = {
      backlog:'backlogTypes', r120:'release120Types', r121:'release121Types',
      r122:'release122Types', overtime:'overtimeTypes',
    };
    rows.forEach(r => {
      Object.entries(COL_TO_FIELD).forEach(([colKey, field]) => {
        (r[field] || []).forEach(wt => {
          colWtMix[colKey][wt] = (colWtMix[colKey][wt] || 0) + 1;
        });
      });
    });

    /* V16 roadmap-2 (S4) — bucket flow badges. Aggregate ganttArrows
       across all rows: «+N» = arrows that LANDED in bucket K, «−N» =
       arrows that LEFT bucket K. Renders on the column header next to
       the release-tag so a PM can see «1.20 lost 7, 1.21 gained 5»
       without scrolling through trail-rows. */
    const flowIn  = { backlog:0, r120:0, r121:0, r122:0, overtime:0 };
    const flowOut = { backlog:0, r120:0, r121:0, r122:0, overtime:0 };
    /* V16 roadmap-2 (A4) — overview mode aggregations.
       For each (team, bucket) collect a frequency map of work-types so we
       can render a horizontal stacked-bar in the team's bucket cell.
       Skipped entirely when mode is 'default'. */
    const _isOverview = Gantt3View._dtMode === 'overview';
    const teamWtBuckets = new Map();   // team → { backlog: {wt:n}, r120:{wt:n}, ... }
    if (_isOverview) {
      const FIELD_BY_KEY = {
        backlog:  'backlogTypes',
        r120:     'release120Types',
        r121:     'release121Types',
        r122:     'release122Types',
        overtime: 'overtimeTypes',
      };
      rows.forEach(r => {
        const team = r.team || '—';
        if (!teamWtBuckets.has(team)) {
          teamWtBuckets.set(team, { backlog:{}, r120:{}, r121:{}, r122:{}, overtime:{} });
        }
        const slot = teamWtBuckets.get(team);
        Object.entries(FIELD_BY_KEY).forEach(([colKey, field]) => {
          (r[field] || []).forEach(wt => {
            slot[colKey][wt] = (slot[colKey][wt] || 0) + 1;
          });
        });
      });
    }

    rows.forEach(r => {
      const arrows = Array.isArray(r.ganttArrows) ? r.ganttArrows : [];
      arrows.forEach(a => {
        if (a.dstCol in flowIn)  flowIn[a.dstCol]++;
        if (a.srcCol in flowOut) flowOut[a.srcCol]++;
      });
    });

    /* AUDIT-ART #12 — team identity via 2-letter monogram + neutral grey rail.
       Раньше rail красился `hsl(hash, 58%, 52%)` — на 6+ командах получалась
       радуга, color = identity (нарушение брендбука §3 «5% signal»). Решение:
       rail остаётся 1px нейтральным `var(--prizma-border-strong)`, identity
       команды несёт monogram (две первые буквы) рядом с названием. */
    const teamMonogram = (s) => {
      const str = String(s || '').trim();
      if (!str) return '—';
      // Берём по первой букве каждого слова (макс. 2): «Платежи Веб» → «ПВ»;
      // «Backend» → «BA» (первые 2 буквы если одно слово).
      const parts = str.split(/[\s\-_]+/).filter(Boolean);
      const mono = parts.length > 1
        ? (parts[0][0] + parts[1][0])
        : parts[0].slice(0, 2);
      return mono.toUpperCase();
    };

    teams.forEach(team => {
      // V22 G-05 — было `rows.filter(...)`; теперь pre-bucketed Map за O(1).
      const teamRows = rowsByTeam.get(team) || [];
      const tk       = teamKey(team);
      const isHidden = Gantt3View._dtHiddenTeams.has(tk);
      /* AUDIT-ART #12 — `teamHue` retired (hash-color rainbow). Identity
         теперь несёт monogram, rail остаётся нейтральным. */
      const tMono    = teamMonogram(team);

      // V16 team-header: full-row sticky-feeling block, 3px coloured rail
      // (hash-hue per team), name 14px/600, total-task count + per-bucket
      // chips with active counts highlighted (empty buckets read as `·`
      // at 40% opacity). The label cell hosts the rail; bucket cells render
      // a chip with bucket-label + count so each cell is a tiny indicator
      // even when the team is collapsed.
      // V16 roadmap-2 (S3) — capacity sparkline: 5 vertical bars (one per
      // bucket), heights proportional to per-team-per-bucket count vs the
      // global max. Bucket > OVERLOAD_THRESHOLD → red top tick so an over-
      // committed team is spottable instantly. Total height 16 px, mounted
      // inside the team-label cell to the right of the «N задач» count.
      const tCounts = teamCounts.get(team) || { backlog:0, r120:0, r121:0, r122:0, overtime:0 };
      const overloadCount = BUCKET_KEYS.reduce((n, k) => n + (tCounts[k] > OVERLOAD_THRESHOLD ? 1 : 0), 0);
      const sparkBars = BUCKET_KEYS.map(k => {
        const v = tCounts[k];
        const heightPct = v === 0 ? 0 : Math.max(8, (v / globalMaxBucket) * 100);
        const overload = v > OVERLOAD_THRESHOLD;
        return `<span class="v16-spark-bar v16-spark-bar-${esc(k)}${overload ? ' v16-spark-bar-overload' : ''}${v === 0 ? ' v16-spark-bar-empty' : ''}"
          style="height:${heightPct.toFixed(0)}%"
          title="${esc(GANTT_COL_LABELS[k] || k)}: ${v}${overload ? ' · перегруз' : ''}"
          aria-label="${v}"></span>`;
      }).join('');
      const sparkHtml = `<span class="v16-team-spark${overloadCount ? ' v16-team-spark-overload' : ''}" aria-label="Загрузка по колодцам">${sparkBars}</span>`;

      // V16 roadmap-2 (A4) — bucket cell renders differently per mode:
      //   default  → count chip («1.20 4»)
      //   overview → horizontal stacked-bar of work-types + total count
      const _bucketCells = cols.map(col => {
        const cnt = teamRows.filter(r => _hasTypes(r, col.key)).length;
        const isActive = cnt > 0;
        if (_isOverview) {
          const wtMap = teamWtBuckets.get(team)?.[col.key] || {};
          const wtEntries = Object.entries(wtMap).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
          const wtTotal   = wtEntries.reduce((s, [, n]) => s + n, 0);
          const segs = wtEntries.map(([wt, n]) => {
            /* AUDIT-ART #11 — theme-aware var-token вместо hardcoded hex.
               PHASE_COLORS остаётся только в standalone-export (см. constants.js). */
            const color = (PHASE_COLOR_TOKENS && PHASE_COLOR_TOKENS[wt]) || PHASE_COLOR_TOKEN_FALLBACK;
            const widthPct = (n / wtTotal) * 100;
            return `<span class="gdt-overview-seg" style="background:${color};width:${widthPct.toFixed(2)}%" title="${esc(wt)}: ${n}"></span>`;
          }).join('');
          return `<div class="gantt-team-header-cell v16-team-bucket-cell gdt-overview-cell" data-col="${esc(col.key)}">
            ${wtTotal
              ? `<div class="gdt-overview-bar" aria-label="Распределение типов работ">${segs}</div>
                 <span class="gdt-overview-count">${wtTotal}</span>`
              : `<span class="gdt-overview-empty">·</span>`}
          </div>`;
        }
        // V17.1 C5 — `v16-team-bucket-label` (текст «1.21» / «Бэклог» внутри
        // строки команды) удалён по требованию пользователя. Заголовок уже
        // несёт релиз-тег один раз на колодце; в team-row остаётся только
        // count — это снижает визуальный шум и улучшает density.
        return `<div class="gantt-team-header-cell v16-team-bucket-cell" data-col="${esc(col.key)}">
          <span class="v16-team-bucket${isActive ? ' v16-team-bucket-active' : ' v16-team-bucket-empty'}" data-bucket="${esc(col.key)}">
            <span class="v16-team-bucket-count">${isActive ? cnt : '·'}</span>
          </span>
        </div>`;
      }).join('');

      body += `<div class="gantt-team-header gdt-grid-row v16-team-row${_isOverview ? ' gdt-overview-row' : ''}${(Gantt3View._focusLane && Gantt3View._focusLane.on && Gantt3View._focusLane.team === tk) ? ' gdt-lane-focus' : ''}" data-team-key="${esc(tk)}" style="display:grid;grid-template-columns:${makeGT()}">
        <span class="v16-team-rail audit-art-team-rail" aria-hidden="true"></span>
        <div class="gantt-team-header-cell gdt-team-label v16-team-label">
          ${_isOverview
            ? `<span class="gdt-overview-chev">${Services.Icons?.get?.('chevron-right', { size: 12 }) || ''}</span>`
            : `<button type="button" class="gantt-team-vis-btn" data-team-key="${esc(tk)}" data-team-name="${esc(team||'—')}" title="Скрыть/показать строки команды" aria-label="${isHidden?'Развернуть команду':'Свернуть команду'}" aria-expanded="${isHidden ? 'false' : 'true'}">${Services.Icons?.get?.(isHidden?'chevron-right':'chevron-down', { size: 12 }) || ''}</button>`}
          <span class="audit-art-team-mono" aria-hidden="true">${esc(tMono)}</span>
          <strong class="gdt-team-name v16-team-name">${esc(team||'—')}</strong>
          <!-- V17.1 C12 — заголовок столбца Эпик: «N эпиков» с правильным
               окончанием через pl(). Каждая строка под team-row = один эпик. -->
          <span class="team-count v16-team-total">${teamRows.length} ${pl(teamRows.length, EPIC_FORMS)}</span>
          <!-- V17.1 C13 — «+» добавить эпик в эту команду (модалка с полным
               набором полей: epic / scope / release / типы работ / зависимости /
               комментарий). После сохранения новая строка добавляется в гант. -->
          <button class="gdt-team-add-epic" data-team="${esc(team)}" title="Добавить эпик в команду «${esc(team)}»" aria-label="Добавить эпик в команду ${esc(team)}">+</button>
          ${sparkHtml}
        </div>
        ${_bucketCells}
      </div>`;

      // In overview mode every team shows ONLY the aggregated row above —
      // no epic-rows, no trail-rows. Skip the per-row body to keep the
      // surface dense for at-a-glance distribution.
      if (_isOverview) return;

      teamRows.forEach(row => {
        // #10: don't truncate — render full epic name; CSS handles wrapping/overflow.
        const epicText     = row.epic || row.tasks || '(без эпика)';
        const cats         = toTags(row.category);
        // V16 roadmap-2 (A3) — left epic column adopts mini-spine language:
        // categories rendered as mono-text tags (no chip background), and
        // a counter line «N работ · M переносов» added underneath. The
        // dominant work-type colour drives a 2 px left-stripe on the row
        // label (analogue of the pill stripe) so the left column finally
        // speaks the same Spine dialect as the right side of the screen.
        const catHtml      = cats.length
          ? cats.slice(0,3).map(cat=>`<span class="v16-epic-cat">${esc(Utils.truncate(cat,16))}</span>`).join('<span class="v16-epic-cat-sep">·</span>')
          : '<span class="v16-epic-cat-empty">без категории</span>';
        // Aggregate work-type tally across the row's buckets to pick the
        // dominant accent colour for the row's left-stripe.
        const _wtTally = Object.create(null);
        for (const c of cols) {
          for (const t of _readTypes(row, c.key)) { _wtTally[t] = (_wtTally[t] || 0) + 1; }
        }
        let _domWt = '';
        let _domCount = 0;
        for (const [t, n] of Object.entries(_wtTally)) {
          if (n > _domCount) { _domCount = n; _domWt = t; }
        }
        /* AUDIT-ART #11 — epic-row left-stripe через theme-aware var-token,
           PHASE_COLORS остался ТОЛЬКО в HTML-export (см. constants.js). */
        const _epicStripeColor = (PHASE_COLOR_TOKENS && PHASE_COLOR_TOKENS[_domWt]) || PHASE_COLOR_TOKEN_FALLBACK;
        // V22 G-11 (audit-experts-2026-05-15 Vrba S0-3) — visualise epic
        // dependencies in the meta line: `_depsOut` = эпики, ОТ которых
        // зависит этот (он стрелочкой влево «← N»), `_depsIn` = эпики,
        // которые зависят ОТ него («→ N»). Линии-через-весь-Гант на
        // 50–200 эпиков превращаются в кашу — поэтому даём компактный
        // inline-индикатор с tooltip'ом + click → раскрытие dep-graph.
        // Источник: `state.epicDeps` (Map<from, to>): `from` зависит от `to`.
        const _epicKey = String(row.epic || row.tasks || '').trim();
        let _depsOut = 0, _depsIn = 0;
        let _depsOutList = [], _depsInList = [];
        if (_epicKey && state.epicDeps) {
          const deps = state.epicDeps;
          // #11 — multi-deps: значение может быть Array<to> ИЛИ string.
          const out = deps[_epicKey];
          const outArr = Array.isArray(out) ? out.filter(Boolean) : (out ? [String(out)] : []);
          _depsOut = outArr.length;
          _depsOutList = outArr.map(String);
          // Этот эпик блокирует других — entries where value (или элемент массива) === _epicKey.
          for (const [from, to] of Object.entries(deps)) {
            const toArr = Array.isArray(to) ? to.filter(Boolean) : (to ? [String(to)] : []);
            if (toArr.includes(_epicKey)) { _depsIn++; _depsInList.push(String(from)); }
          }
        }
        const _depsTooltip = [
          _depsOut ? `Зависит от: ${_depsOutList.join(', ')}` : '',
          _depsIn  ? `Блокирует: ${_depsInList.slice(0, 5).join(', ')}${_depsIn > 5 ? '…' : ''}` : '',
        ].filter(Boolean).join('\n');
        const _depsBadge = (_depsOut || _depsIn)
          ? `<button type="button" class="v16-epic-deps-badge" data-epic-key="${esc(_epicKey)}" data-tip="${esc(_depsTooltip)}" aria-label="Зависимости эпика: ${_depsOut ? 'зависит от ' + _depsOut : ''}${_depsOut && _depsIn ? ', ' : ''}${_depsIn ? 'блокирует ' + _depsIn : ''}" title="Открыть граф зависимостей">${_depsOut ? `<span class="v16-epic-deps-in">←${_depsOut}</span>` : ''}${_depsIn ? `<span class="v16-epic-deps-out">→${_depsIn}</span>` : ''}</button>`
          : '';
        // F1 Churn-heat — эпик с ≥3 зафиксированными переносами «нестабилен»
        // (переезжает из релиза в релиз). В большом плане такие тонут среди
        // стабильных — даём компактный flame-бейдж с числом переносов в первой
        // позиции мета-строки (источник: row.ganttArrows, уже считается).
        const _churnCount = Array.isArray(row.ganttArrows) ? row.ganttArrows.length : 0;
        const _isChurny   = _churnCount >= CHURN_THRESHOLD;
        const _churnTip   = `Нестабильный эпик: ${_churnCount} ${pl(_churnCount, ['перенос', 'переноса', 'переносов'])} между релизами`;
        const _churnBadge = _isChurny
          ? `<span class="v16-epic-churn" data-tip="${esc(_churnTip)}" title="${esc(_churnTip)}" aria-label="${esc(_churnTip)}">${_CHURN_SVG}<span class="v16-epic-churn-n">${_churnCount}</span></span>`
          : '';
        const assignees    = toTags(row.assignee);
        const hasAssignee  = assignees.length > 0;
        const assigneeText = hasAssignee ? assignees.join(', ') : 'без исполнителя';
        // V15: warn-triangle removed from epic title per user request.
        // The "no assignee" signal stays via the assignee tooltip on pills.
        const dp = row.donePills || {}; // per-pill done map: "${colKey}__${wt}" → true
        const pillDone = (colKey, wt) => !!dp[`${colKey}__${wt}`];
        // V15: per-pill «not planned» flag. Same key shape as donePills.
        const up = row.unplannedPills || {};
        const pillUnplanned = (colKey, wt) => !!up[`${colKey}__${wt}`];
        // Labels for ghost-marker (kept in sync with NEXT_RELEASE/COL_LABEL below)
        const _GHOST_COL_LABEL = COL_LABEL_MAP;
        // V15 (1.4): inline ghost-pills in cells were retired — every move
        // is now rendered as its own dedicated sub-row beneath the parent
        // epic row, so the «↗ ghost» and the destination marker sit on the
        // same y-line and the SVG arrow becomes purely horizontal.
        // Cells stop showing ghost pills entirely; `arrowsBySrc` is gone.

        // V15 — comment lookup for bulk-added pills. When plan was locked
        // and the user added a pill via «+ → bucket + comment», the action
        // lands in `transferComments[]` with `from === '+'`. Render 📬 on
        // each affected pill with the comment in the tooltip.
        const _comments = Array.isArray(row.transferComments) ? row.transferComments : [];
        // V17 P2 (H6) — pre-bucket transferComments into a Map keyed by
        // `<col>__<wt>__<kind>`. Replaces the per-pill O(N×M) scan in
        // `findAddComment` / `findMoveComment` (called for EVERY pill in
        // EVERY render). On 30 pills × 50 comments × 100 teams that was
        // 4.5M iterations per renderChart. Audit 2026-05 (full-stack P2).
        const _addByPill  = new Map();
        const _moveByPill = new Map();
        for (const c of _comments) {
          if (!c || !c.to || !c.wt) continue;
          const key = `${c.to}__${c.wt}`;
          const ts  = Date.parse(c.at) || 0;
          if (c.from === '+') {
            const prev = _addByPill.get(key);
            if (!prev || ts > prev._ts) _addByPill.set(key, Object.assign({ _ts: ts }, c));
          } else {
            const prev = _moveByPill.get(key);
            if (!prev || ts > prev._ts) _moveByPill.set(key, Object.assign({ _ts: ts }, c));
          }
        }
        const findAddComment = (colKey, wt) => _addByPill.get(`${colKey}__${wt}`) || null;
        // V15 Spine 2026-04-30 — `_addCmtIcon` 📬-prefix helper retired;
        // the comment marker now lives inside `_buildPill` as a square
        // (gdt-pill-cmt-marker), rendered from the same `findAddComment`
        // result. Trail ghost-pills use the same marker class — see below.

        /* V15 Spine — per-pill assignee with row-level fallback. Reads the
           per-pill map first; if absent, falls back to row.assignee so legacy
           rows keep displaying ФИО everywhere until per-pill overrides land. */
        const ap = row.assigneePills || {};
        const pillAssignees = (colKey, wt) => {
          const perPill = ap[`${colKey}__${wt}`];
          if (typeof perPill === 'string' && perPill.trim()) return toTags(perPill);
          return assignees;
        };

        /* V17 P2 (H6) — replaced O(N) scan with Map lookup. */
        const findMoveComment = (colKey, wt) => _moveByPill.get(`${colKey}__${wt}`) || null;

        /* Single source of truth for pill HTML. Used by both backlog and
           release/overtime branches below. Two-row Spine layout:
             row 1: name + state-glyph + comment-marker
             row 2: «ФИО · 01.05—15.05 · token(s)» */
        const ip = row.inProgressPills || {};
        const pillInProgress = (colKey, wt) => !!ip[`${colKey}__${wt}`];
        const _buildPill = (colKey, wt) => {
          const isDone       = pillDone(colKey, wt);
          const isUnplanned  = pillUnplanned(colKey, wt);
          const isInProgress = pillInProgress(colKey, wt);
          const moveCmt      = findMoveComment(colKey, wt);
          const addCmt       = findAddComment(colKey, wt);
          const cmt          = addCmt || moveCmt;        // prefer added-marker if both
          const pillAssg     = pillAssignees(colKey, wt);
          const period       = _shortPeriod(row);

          // State priority: done > unplanned > in-progress > todo (default).
          // Only «in-progress» pills get the saturated solid-circle glyph;
          // «todo» (the new default) is a hollow circle so the gantt reads
          // calmer until somebody actively starts work.
          const stateClass =
            isDone       ? 'gdt-pill-state gdt-pill-state-done'
          : isUnplanned  ? 'gdt-pill-state gdt-pill-state-unplanned'
          : isInProgress ? 'gdt-pill-state gdt-pill-state-active'
          :                'gdt-pill-state gdt-pill-state-todo';

          const cmtMarker = cmt && cmt.text
            ? `<span class="gdt-pill-cmt-marker ${addCmt ? 'gdt-pill-cmt-add' : 'gdt-pill-cmt-transfer'}"
                role="img" aria-label="${esc(`${addCmt ? 'Добавлено в зафиксированный план' : 'Перенесено'} — есть комментарий`)}"
                data-tip="${esc(`${addCmt ? 'Добавлено' : 'Перенесено'}${cmt.at ? ' ' + fmtMoveDate(cmt.at) : ''}\nКомментарий: ${cmt.text}`)}"></span>`
            : '';

          // Meta line — strictly «ФИО · 01.05—15.05». Date / status tokens
          // (parked / moved / added) were removed 2026-04-30 because they
          // squeezed the period off the pill at typical widths AND duplicated
          // info that already lives in the cmt-marker tooltip + state-glyph.
          // «Не запланирована» is signalled three times already (left-stripe
          // dashed + state-glyph dashed circle + italic name), no token needed.
          const metaParts = [];
          const assgLabel = _assigneeLabel(pillAssg);
          if (assgLabel) metaParts.push(esc(assgLabel));
          if (period)    metaParts.push(esc(period));

          const metaText  = metaParts.length ? metaParts.join(' · ') : '';
          const metaInner = metaText
            ? `<span class="gdt-pill-meta">${metaText}</span>`
            : '<span class="gdt-pill-meta gdt-pill-meta-empty">—</span>';

          // Tooltip — full ФИО list + period + comment if present + status.
          // V21 — status-постфикс в aria-label/tooltip: state-glyph (●/✓/○) сам
          // по себе декоративный (`::before`), screen-reader его не читает.
          // Добавляем явный текст состояния в aria-label, чтобы статус был
          // доступен AT-пользователям.
          const tipFio    = pillAssg.length ? pillAssg.join(', ') : 'без исполнителя';
          const tipParts  = [`${wt} — ${tipFio}`];
          if (period) tipParts.push(`Период: ${row.workStartDate} → ${row.workEndDate}`);
          if (cmt && cmt.text) tipParts.push(`${addCmt ? 'Добавлено' : 'Перенесено'}${cmt.at ? ' ' + fmtMoveDate(cmt.at) : ''}: ${cmt.text}`);
          const statusText = isDone ? 'Завершено' : isUnplanned ? 'Не запланирована' : isInProgress ? 'В работе' : 'Не начата';
          tipParts.push(`Статус: ${statusText}`);

          const dc = isDone      ? ' gdt-pill-done'      : '';
          const uc = isUnplanned ? ' gdt-pill-unplanned' : '';

          // V15 Spine 2026-04-30 — native `title=` replaced with `data-tip`.
          // Browsers wait ~1.5s before showing native tooltips and there's
          // no web API to shorten that. We render our own tooltip via a
          // delegated mouseover handler attached once in `_bindFastTooltip`
          // (200 ms delay). `aria-label` keeps screen-reader access.
          // V16 roadmap-2 (C1) — progress-underline. When the pill is
          // «в работе» AND the row has both work-period dates, derive a
          // 0-1 progress factor from how far today sits inside that
          // period. Renders as a 2 px bottom-edge bar in the work-type
          // accent. Skipped if no dates or pill not in-progress.
          let progressBar = '';
          if (isInProgress && row.workStartDate && row.workEndDate) {
            const s = new Date(row.workStartDate).getTime();
            const e0 = new Date(row.workEndDate).getTime();
            const n = Date.now();
            if (Number.isFinite(s) && Number.isFinite(e0) && e0 > s) {
              const ratio = Math.max(0, Math.min(1, (n - s) / (e0 - s)));
              progressBar = `<span class="gdt-pill-progress" style="width:${(ratio * 100).toFixed(1)}%" aria-hidden="true"></span>`;
            }
          }
          // V16 roadmap-2 (B6) — `tabindex="-1"` so roving-tabindex
          // keyboard nav can promote one pill at a time.
          // V17 P2 (CONSENSUS-1) — closing `>` added after data-tip. All
          // four audit agents (full-stack, QA, system analyst, gantt-spec)
          // independently flagged the open-tag never closed. Browser HTML5
          // recovery silently fixed it for layout, but inner spans became
          // siblings, breaking `.gantt-type-pill .gdt-pill-row-1` selector
          // semantics and aria-label association.
          return `<span class="gantt-type-pill${dc}${uc}" draggable="true" tabindex="-1" role="button"
            data-wt="${esc(wt)}" data-row-id="${esc(row.id)}" data-src-col="${esc(colKey)}"
            aria-label="${esc(tipParts.join(' · '))}"
            data-tip="${esc(tipParts.join('\n'))}">
            <span class="gdt-pill-row-1">
              <span class="gdt-pill-name">${esc(Utils.truncate(wt, 18))}</span>
              ${pillAssg.length ? `<span class="gdt-pill-initials" aria-hidden="true">${esc(_initialsLabel(pillAssg))}</span>` : ''}
              <span class="${stateClass}"></span>${cmtMarker}
            </span>
            <span class="gdt-pill-row-2">${metaInner}</span>
            ${progressBar}
          </span>`;
        };

        // Per-cell счётчик заметок (Confluence-style). Bubble стоит абсолютно
        // в правом верхнем углу cell; click → попап.
        const _notesByCol = Object.create(null);
        if (Array.isArray(row.cellNotes)) {
          for (const n of row.cellNotes) {
            if (!n || !n.col) continue;
            _notesByCol[n.col] = (_notesByCol[n.col] || 0) + 1;
          }
        }
        const _NOTE_ICON_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
        const _noteBubble = (colKey) => {
          // Backlog не получает annotations (notes/risks) — это область
          // незапланированного; контекста ячейки в смысле релиза нет.
          if (colKey === 'backlog') return '';
          const count = _notesByCol[colKey] || 0;
          const empty = count === 0;
          const label = empty ? 'Добавить заметку' : `Заметок: ${count}`;
          const countBadge = empty ? '' : `<span class="gdt-cell-note-count">${count}</span>`;
          return `<button type="button" class="gdt-cell-note-icon${empty ? ' is-empty' : ''}" data-col="${esc(colKey)}" data-row-id="${esc(row.id)}" aria-label="${esc(label)}" title="${esc(label)}">${_NOTE_ICON_SVG}${countBadge}</button>`;
        };
        // Per-cell риски. Glyph в левом верхнем углу cell; цвет = приоритет
        // (hard-deadline > dangling > open-question). Click → попап.
        const _risksByCol = Object.create(null);
        if (Array.isArray(row.cellRisks)) {
          for (const r of row.cellRisks) {
            if (!r || !r.col) continue;
            (_risksByCol[r.col] ||= []).push(r);
          }
        }
        // AUDIT-18 — SVG-иконки вместо сырых глифов ?◇! (единый язык с note-SVG).
        const _RISK_SVG_INNER = {
          'open-question': '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
          'dangling':      '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2"/>',
          'hard-deadline': '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
        };
        const _RISK_GLYPHS = Object.fromEntries(Object.entries(_RISK_SVG_INNER).map(([k, inner]) =>
          [k, `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`]));
        const _RISK_LABELS = { 'open-question': 'Открытый вопрос', 'dangling': 'Подвешенная активность', 'hard-deadline': 'Жёсткий дедлайн' };
        const _riskGlyph = (colKey) => {
          if (colKey === 'backlog') return '';
          const list = _risksByCol[colKey] || [];
          if (!list.length) {
            // Empty-state — мелкая «!» иконка, видна только на hover cell.
            return `<button type="button" class="gdt-cell-risk-glyph is-empty" data-kind="open-question" data-col="${esc(colKey)}" data-row-id="${esc(row.id)}" aria-label="Добавить риск" title="Добавить риск">!</button>`;
          }
          const dominant = list.some(r => r.kind === 'hard-deadline') ? 'hard-deadline'
            : list.some(r => r.kind === 'dangling') ? 'dangling' : 'open-question';
          const label = list.length === 1
            ? _RISK_LABELS[dominant]
            : `${list.length} риск(ов): ${list.map(r => _RISK_LABELS[r.kind] || r.kind).join(', ')}`;
          const countBadge = list.length > 1 ? `<span class="gdt-cell-risk-count">${list.length}</span>` : '';
          return `<button type="button" class="gdt-cell-risk-glyph" data-kind="${esc(dominant)}" data-col="${esc(colKey)}" data-row-id="${esc(row.id)}" aria-label="${esc(label)}" title="${esc(label)}">${_RISK_GLYPHS[dominant]}${countBadge}</button>`;
        };

        const cells = cols.map(col => {
          const ghosts = '';

          /* ---- backlog cell: always show "+", pills from backlogTypes ---- */
          if (col.key === 'backlog') {
            // V16 roadmap-2 (C2) — sort pills inside the cell by canonical
            // PHASE_ORDER (BA → analytics → BE → FE → QA → внедрение → …).
            // Workflow flows in this order, so the visual reads as a soft
            // left-to-right time gradient inside each cell. Unknown wt's
            // (custom strings) fall to the end, alphabetically.
            const _phaseRank = (t) => {
              const idx = PHASE_ORDER.indexOf(t);
              return idx >= 0 ? idx : 999 + t.localeCompare(' ', 'ru');
            };
            const bTypes = _readTypes(row, 'backlog').slice().sort((a, b) => _phaseRank(a) - _phaseRank(b));
            const shown  = bTypes.slice(0, 12);
            const more   = bTypes.length - shown.length;
            const pills  = shown.map(t => _buildPill('backlog', t)).join('');
            const moreHtml = more > 0 ? `<span class="gantt-type-pill"><span class="gdt-pill-row-1"><span class="gdt-pill-name">+${more}</span></span></span>` : '';
            const inner = (pills || ghosts) ? `<div class="gantt-bar-multi" data-row-id="${esc(row.id)}" data-src-col="backlog">${pills}${moreHtml}${ghosts}</div>` : '';
            return `<div class="gantt-cell gantt-window-backlog" data-col="backlog" data-row-id="${esc(row.id)}">
              ${inner}
              <button class="gdt-add-type-btn" data-row-id="${esc(row.id)}" title="Добавить тип задачи">+</button>
            </div>`;
          }
          /* ---- release / overtime cells ---- */
          const has   = _hasTypes(row, col.key);
          // V16 roadmap-2 (C2) — same PHASE_ORDER sort as backlog above
          // (BA → analytics → BE → FE → QA → внедрение → стабилизация → hotfix).
          const _phaseRankR = (t) => {
            const idx = PHASE_ORDER.indexOf(t);
            return idx >= 0 ? idx : 999 + t.localeCompare(' ', 'ru');
          };
          const types = _readTypes(row, col.key).slice().sort((a, b) => _phaseRankR(a) - _phaseRankR(b));
          const shown = types.slice(0, 12);
          const more  = types.length - shown.length;
          const pills = shown.map(t => _buildPill(col.key, t)).join('');
          const fallback = `<span class="gantt-type-pill" draggable="true"
            data-wt="задача" data-row-id="${esc(row.id)}" data-src-col="${esc(col.key)}">
            <span class="gdt-pill-row-1"><span class="gdt-pill-name">задача</span></span>
            </span>`;
          const moreHtml = more > 0 ? `<span class="gantt-type-pill"><span class="gdt-pill-row-1"><span class="gdt-pill-name">+${more}</span></span></span>` : '';
          const inner = (has || ghosts)
            ? `<div class="gantt-bar-multi" data-row-id="${esc(row.id)}" data-src-col="${esc(col.key)}">${has ? (pills||fallback) : ''}${moreHtml}${ghosts}</div>`
            : '';
          return `<div class="gantt-cell ${col.cls}" data-col="${esc(col.key)}" data-row-id="${esc(row.id)}">
            ${inner}
            ${_riskGlyph(col.key)}
            ${_noteBubble(col.key)}
          </div>`;
        });

        // #1: risk badges removed from epic-column header — they cluttered
        //   the title and the dedicated risks panel on the dashboard already
        //   surfaces them. Keep the no-assignee triangle.
        body += `<div class="gantt-row gdt-grid-row${isHidden ? ' is-team-collapsed' : ''}" data-team-key="${esc(tk)}" data-row-id="${esc(row.id)}" data-epic-key="${esc(_epicKey)}" style="grid-template-columns:${makeGT()}">
          <div class="gantt-row-label v16-epic-label">
            <span class="v16-epic-stripe" style="background:${_epicStripeColor}" aria-hidden="true"></span>
            <div class="v16-epic-name gantt-row-label-name">${esc(epicText)}</div>
            <div class="v16-epic-sub gantt-row-label-sub">
              ${_churnBadge}${_depsBadge || ''}${(_churnBadge || _depsBadge) ? '<span class="v16-epic-cat-sep">·</span>' : ''}<span class="v16-epic-cats">${catHtml}</span>
              <button type="button" class="v16-epic-deps-edit" data-epic-key="${esc(_epicKey)}" title="Зависимости эпика" aria-label="Указать зависимости">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><line x1="8.2" y1="10.7" x2="15.8" y2="6.3"/><line x1="8.2" y1="13.3" x2="15.8" y2="17.7"/></svg>
              </button>
            </div>
          </div>${cells.join('')}</div>`;

        // V15 (1.4) — trail sub-rows: ONE per recorded ganttArrow, in
        // chronological order. Each sub-row has the same grid as the main
        // row. Cells empty except `srcCol` (a ghost-pill «↗ wt») and
        // `dstCol` (a ghost-marker «↘ wt»). They're paired by a unique
        // `data-arrow-at` so `drawPostponeArrows` connects ONLY them
        // (no diagonal to the main row). The actual pill stays on the
        // main row in its current bucket.
        const arrows = Array.isArray(row.ganttArrows) ? row.ganttArrows : [];
        // V15 — comment lookup: transferComments[] is the canonical trail
        // for both moves AND bulk-adds. Find the comment matching this move
        // (same wt + src + dst, closest timestamp). Falls back to undefined.
        const comments = Array.isArray(row.transferComments) ? row.transferComments : [];
        const findComment = (arrow) => {
          // Prefer EXACT timestamp match; otherwise the most-recent earlier
          // entry that matches wt+from+to (5-second tolerance — different
          // setters use different clocks).
          const target = Date.parse(arrow.at) || 0;
          let best = null;
          let bestDelta = Infinity;
          for (const c of comments) {
            if (c.wt !== arrow.wt) continue;
            if (c.from !== arrow.srcCol) continue;
            if (c.to   !== arrow.dstCol) continue;
            const cTs = Date.parse(c.at) || 0;
            const delta = Math.abs(cTs - target);
            if (delta < bestDelta) { bestDelta = delta; best = c; }
          }
          return best;
        };

        arrows.forEach((a) => {
          const dt = fmtMoveDate(a.at);
          const cmt = findComment(a);
          // V15 Spine 2026-04-30 — emoji on trail ghost-pills retired.
          // Use the same square cmt-marker as on main pills so the visual
          // language stays consistent. Hollow Twin cascade auto-applies on
          // unplanned via styles.css.
          const cmtIcon = cmt && cmt.text
            ? `<span class="gdt-pill-cmt-marker gdt-pill-cmt-transfer gdt-trail-cmt" data-tip="${esc(`Перенесено${dt ? ' ' + dt : ''}\nКомментарий: ${cmt.text}`)}"></span>`
            : '';
          // V16 (gantt-roadmap #4) — compact trail-strip. Drops the «↗ wt»
          // and «↘ wt» text duplication (the wt is already on the parent
          // pill above) — src now shows only «↗ DD.MM», dst shows just
          // «↘» as a tiny chip. Left label collapses to an L-connector
          // hairline. Total height ~20 px instead of 26+. Arrow stroke
          // colour switches to the work-type accent (handled in
          // drawPostponeArrows below).
          const _srcLabel = _GHOST_COL_LABEL[a.srcCol] || a.srcCol;
          const _dstLabel = _GHOST_COL_LABEL[a.dstCol] || a.dstCol;
          // V21 — расширенные tooltip и aria-label с полной траекторией:
          // «BE: 1.20 → 1.21 · 12.04». Раньше src показывал только wt+date,
          // dst — только destination, без полной картины переноса. Также
          // tabindex=0 + role=img + aria-label для клавиатурного юзера.
          const _trailFullText = `${a.wt}: ${_srcLabel} → ${_dstLabel}${dt ? ' · ' + dt : ''}`;
          const trailCells = cols.map(col => {
            if (col.key === a.srcCol) {
              return `<div class="gantt-cell ${col.cls} gdt-trail-cell" data-col="${esc(col.key)}" data-row-id="${esc(row.id)}">
                <span class="gantt-type-pill gantt-pill-ghost gdt-trail-src"
                  tabindex="0" role="img" aria-label="${esc('Перенос (откуда): ' + _trailFullText)}"
                  data-wt="${esc(a.wt)}" data-row-id="${esc(row.id)}"
                  data-src-col="${esc(a.srcCol)}" data-dst-col="${esc(a.dstCol)}"
                  data-arrow-at="${esc(a.at || '')}"
                  data-tip="${esc('↗ Перенесено отсюда: ' + _trailFullText)}">${cmtIcon}<span class="gdt-trail-arrow">↗</span>${dt ? `<span class="gdt-trail-date">${esc(dt)}</span>` : ''}</span>
              </div>`;
            }
            if (col.key === a.dstCol) {
              return `<div class="gantt-cell ${col.cls} gdt-trail-cell" data-col="${esc(col.key)}" data-row-id="${esc(row.id)}">
                <span class="gantt-type-pill gantt-pill-ghost gdt-trail-dst"
                  tabindex="0" role="img" aria-label="${esc('Перенос (куда): ' + _trailFullText)}"
                  data-wt="${esc(a.wt)}" data-row-id="${esc(row.id)}"
                  data-src-col="${esc(a.srcCol)}" data-dst-col="${esc(a.dstCol)}"
                  data-arrow-at="${esc(a.at || '')}"
                  data-tip="${esc('↘ Перенесено сюда: ' + _trailFullText)}"><span class="gdt-trail-arrow">↘</span></span>
              </div>`;
            }
            return `<div class="gantt-cell ${col.cls} gdt-trail-cell gdt-trail-empty" data-col="${esc(col.key)}"></div>`;
          }).join('');
          body += `<div class="gantt-row gantt-row-trail gdt-grid-row${isHidden ? ' is-team-collapsed' : ''}" data-team-key="${esc(tk)}" data-arrow-at="${esc(a.at || '')}" style="grid-template-columns:${makeGT()}">
            <div class="gantt-row-label gdt-trail-label"></div>${trailCells}</div>`;
        });
      });
    });

    /* ---- header with resize handles ---- */
    const gt = makeGT();
    const headerCols =
      `<div class="gantt-header-label" style="position:relative">Эпик / Категория
        <div class="gdt-resize-handle" data-col-key="_label" title="Потяните чтобы изменить ширину столбца задач"></div>
      </div>` +
      cols.map(c => {
        // V16 (gantt-roadmap #3) — Unified Date-Rail. The bucket label
        // becomes a release-tag (16 px weight 800), date-range a quiet
        // meta-line, and we inject a «сегодня DD.MM» pill on the bucket
        // whose date-range covers today. `c.sub` is `DD.MM–DD.MM`; we
        // parse both ends and compare against today's month+day (year-
        // agnostic — the spread of a release window is what matters).
        const today = new Date();
        const todayLabel = `${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}`;
        // V22 G-09 (audit-experts-2026-05-15 Vrba S0-1) — расширяем расчёт:
        // вместе с булевым isCurrent теперь возвращаем и pct (0..100) для
        // позиции today-маркера внутри окна. Раньше: внутри bucket'а не
        // было понимания «когда дедлайн? мы внутри или вышли?». Теперь:
        // вертикальная линия на пропорциональной позиции + tooltip.
        const _bounds = (() => {
          if (!c.sub) return null;
          const m = c.sub.match(/^(\d{2})\.(\d{2})\D+(\d{2})\.(\d{2})/);
          if (!m) return null;
          const [, sd, sm, ed, em] = m;
          return {
            start: parseInt(sm, 10) * 100 + parseInt(sd, 10),
            end:   parseInt(em, 10) * 100 + parseInt(ed, 10),
            now:   (today.getMonth() + 1) * 100 + today.getDate(),
          };
        })();
        const isCurrent = (() => {
          if (!_bounds) return false;
          const { start, end, now } = _bounds;
          // QA A4.2 — year-rollover guard. Релиз-окно может пересекать 31.12 →
          // 01.01 (например 28.12–15.01). Тогда start>end, и обычная проверка
          // `now>=start && now<=end` для now=102 (02.01) даёт false, хотя
          // мы внутри окна. Раскрываем как (now>=start) || (now<=end).
          if (start > end) return now >= start || now <= end;
          return now >= start && now <= end;
        })();
        // V22 G-09 — pct позиции today внутри окна. _bounds хранит даты как
        // MM*100+DD (компактно), но для линейной интерполяции нужны day-of-year:
        // например, между 18.05 (DOY 138) и 14.06 (DOY 165) — 27 дней, а
        // 522-518=4 ≠ 27. Конвертируем через Date.UTC, чтобы не зависеть
        // от длин месяцев.
        const todayPct = (() => {
          if (!isCurrent || !_bounds) return null;
          const { start, end, now } = _bounds;
          const yr = today.getFullYear();
          const toDoy = (mmdd) => {
            const mm = Math.floor(mmdd / 100);
            const dd = mmdd % 100;
            return Math.floor((Date.UTC(yr, mm - 1, dd) - Date.UTC(yr, 0, 1)) / 86400000);
          };
          const s = toDoy(start), e = toDoy(end), n = toDoy(now);
          if (e < s) {
            // year-rollover (например 28.12–15.01)
            const total   = (365 - s) + e;
            const elapsed = n >= s ? (n - s) : ((365 - s) + n);
            return Math.max(0, Math.min(100, (elapsed / total) * 100));
          }
          if (e === s) return 50;
          return Math.max(0, Math.min(100, ((n - s) / (e - s)) * 100));
        })();
        const todayPill = isCurrent
          ? `<span class="gdt-rail-today" title="Сегодня ${esc(todayLabel)}">сегодня</span>`
          : '';
        // V17.1 C4 — render long Russian range («20 апреля – 17 мая»);
        // c.sub оставляем DD.MM–DD.MM выше для today-pill parser.
        const subPretty = c.sub && /\d{2}\.\d{2}/.test(c.sub) ? formatLongRange(c.sub) : c.sub;
        const sub = subPretty
          ? `<span class="gdt-rail-meta gantt-col-date">${esc(subPretty)}</span>`
          : (c.key === 'overtime' ? '' : '');
        const label = c.key === 'backlog'
          ? `<span class="gdt-rail-label gdt-rail-label-backlog">${esc(c.label)}</span>`
          : `<span class="gdt-rail-label">${esc(c.label)}</span>`;
        // V16 roadmap-2 (S4) — flow badges. `+N` (came in, blue) and `−N`
        // (left, amber). Both hidden when 0; `±` direction matches the
        // pill cmt-marker semantics (blue = added, amber = transferred).
        const fIn  = flowIn[c.key]  || 0;
        const fOut = flowOut[c.key] || 0;
        const flowBadges = (fIn || fOut)
          ? `<span class="gdt-rail-flow" title="Перенесено в колодец: ${fIn} · из колодца: ${fOut}">
              ${fIn  ? `<span class="gdt-rail-flow-in">+${fIn}</span>`   : ''}
              ${fOut ? `<span class="gdt-rail-flow-out">−${fOut}</span>` : ''}
            </span>`
          : '';
        // V16 roadmap-2 (B1) — distribution sparkline above the header.
        // 4 px-tall stacked bar, segments coloured by work-type from the
        // canonical PHASE_COLOR_TOKENS palette (theme-aware). Empty bucket →
        // no bar. Tooltip on each segment names the work-type and count.
        // AUDIT-ART #11 — switched from PHASE_COLORS hex to var-tokens; hex
        // fallback PHASE_COLORS остался ТОЛЬКО в standalone-export.
        const _mix = colWtMix[c.key] || {};
        const _mixEntries = Object.entries(_mix).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
        const _mixTotal   = _mixEntries.reduce((s, [, n]) => s + n, 0);
        const distSpark = _mixTotal
          ? `<div class="gdt-rail-dist" aria-label="Распределение типов работ в колодце">
              ${_mixEntries.map(([wt, n]) => {
                const color = (PHASE_COLOR_TOKENS && PHASE_COLOR_TOKENS[wt]) || PHASE_COLOR_TOKEN_FALLBACK;
                const widthPct = (n / _mixTotal) * 100;
                return `<span class="gdt-rail-dist-seg" style="background:${color};width:${widthPct.toFixed(2)}%" title="${esc(wt)}: ${n}"></span>`;
              }).join('')}
            </div>`
          : '';
        const todayPctAttr = (todayPct !== null) ? ` data-today-pct="${todayPct.toFixed(2)}" data-today-label="${esc(todayLabel)}"` : '';
        // F2 — DOY-границы окна колодца для позиционирования milestone-линий
        // (тот же date→x маппинг, что и today-line; год-агностично, как _bounds).
        const _winAttr = (() => {
          if (!_bounds) return '';
          const yr = today.getFullYear();
          const toDoy = (mmdd) => {
            const mm = Math.floor(mmdd / 100), dd = mmdd % 100;
            return Math.floor((Date.UTC(yr, mm - 1, dd) - Date.UTC(yr, 0, 1)) / 86400000);
          };
          return ` data-win-start="${toDoy(_bounds.start)}" data-win-end="${toDoy(_bounds.end)}"`;
        })();
        // #1 C5 — eye-button: скрыть колодец локально (state.ganttHiddenReleases).
        // Для backlog не показываем (его скрывать смысла нет — наглядность пустых задач).
        // AUDIT-6 — SVG eye-off вместо «×» (× читался как «удалить релиз»).
        const eyeBtn = c.key === 'backlog' ? '' :
          `<button type="button" class="gdt-col-eye" data-col-key="${esc(c.key)}" title="Скрыть колодец из Ганта" aria-label="Скрыть колодец ${esc(c.label)}"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg></button>`;
        // #6 — week-ticks: тонкие vertical засечки по 7 дней внутри окна
        // (только для колодцев с реальным диапазоном дат).
        const weekTicks = (() => {
          if (!_bounds) return '';
          const yr = today.getFullYear();
          const toDoy = (mmdd) => {
            const mm = Math.floor(mmdd / 100);
            const dd = mmdd % 100;
            return Math.floor((Date.UTC(yr, mm - 1, dd) - Date.UTC(yr, 0, 1)) / 86400000);
          };
          let s = toDoy(_bounds.start), e = toDoy(_bounds.end);
          if (e < s) e += 365;
          const total = e - s;
          if (total < 7) return '';
          const ticks = [];
          for (let d = 7; d < total; d += 7) {
            const pct = (d / total) * 100;
            ticks.push(`<span class="gdt-week-tick" style="left:${pct.toFixed(2)}%"></span>`);
          }
          return ticks.join('');
        })();
        return `<div class="gantt-header-col" data-col="${esc(c.key)}"${todayPctAttr}${_winAttr} style="position:relative">
          ${distSpark}
          ${weekTicks}
          <div class="gdt-rail-stack">${label}${sub}${todayPill}${flowBadges}</div>
          ${eyeBtn}
          <div class="gdt-resize-handle" data-col-key="${esc(c.key)}" title="Потяните чтобы изменить ширину"></div>
        </div>`;
      }).join('');
    const header = `<div class="gantt-header gdt-header gdt-grid-row" style="display:grid;grid-template-columns:${gt}">${headerCols}</div>`;
    const legend = `<div class="gantt-legend">
      ${[['var(--release-none-color)','Бэклог'],['var(--release-r120-color)','1.20'],['var(--release-r121-color)','1.21'],['var(--release-r122-color)','1.22'],['var(--release-ot-color)','OT']].map(([c,l])=>`<div class="gantt-legend-item"><div class="gantt-legend-dot" style="background:${c}"></div>${l}</div>`).join('')}
    </div>`;

    // V21 anti-jitter — заморозить высоту wrap'а на момент rebuild'а.
    // Без этого `wrap.innerHTML = ...` коллапсит контейнер в height:0 на
    // один кадр (между innerHTML-write и layout), контент ниже подскакивает
    // вверх и возвращается → визуально «дёргание как при обновлении».
    // Удерживаем прежнюю высоту через min-height и отпускаем когда новый
    // DOM уже разложился: rAF когда вкладка видима + setTimeout как фолбек
    // на случай скрытой вкладки (rAF тогда тротлится). Не учитывает
    // уменьшение количества рядов — высота сожмётся естественно через тик;
    // для drop-сценариев (главный источник дёрганья) количество рядов не
    // меняется.
    const _prevHeight = wrap.offsetHeight;
    if (_prevHeight > 0) wrap.style.minHeight = _prevHeight + 'px';
    // #1 C5 — banner со списком скрытых колодцев + кнопкой «Показать все».
    const _hiddenList = Array.isArray(state.ganttHiddenReleases) ? state.ganttHiddenReleases : [];
    const hiddenBanner = _hiddenList.length
      ? `<div class="gdt-hidden-releases" role="status">
           <span class="gdt-hidden-releases-label">Скрыто колодцев: ${_hiddenList.length}</span>
           <button type="button" class="gdt-hidden-releases-show-all">Показать все</button>
         </div>`
      : '';
    // F2 — milestone-линии: один div на веху, позиционируется в
    // _positionMilestoneLines после layout (как today-line). Скрыты до
    // позиционирования, чтобы не мелькать в (0,0).
    const milestonesHtml = (Array.isArray(state.milestones) ? state.milestones : [])
      .map(ms => {
        const d = String(ms.date ?? '');
        const dm = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
        const shortD = dm ? `${dm[3]}.${dm[2]}` : '';
        const lbl = String(ms.label ?? '').trim() || shortD || 'веха';
        const tip = [String(ms.label ?? '').trim(), shortD].filter(Boolean).join(' · ') || 'Веха';
        return `<div class="gdt-milestone-line" data-ms-id="${esc(String(ms.id ?? ''))}" data-ms-date="${esc(d)}" hidden><span class="gdt-milestone-flag" title="${esc(tip)}">${esc(lbl)}</span></div>`;
      })
      .join('');
    wrap.innerHTML = `<div class="gantt-container gdt-container">${hiddenBanner}${header}<div class="gantt-body">${body}</div>${legend}<div class="gdt-today-line" hidden></div>${milestonesHtml}</div>`;
    // #2: do NOT force overflow:visible — that killed the horizontal scrollbar
    //   on #gantt3-wrap (defined as overflow-x:auto in styles.css). Let CSS win.
    wrap.style.overflow = '';
    if (_prevHeight > 0) {
      let _released = false;
      const _release = () => { if (_released) return; _released = true; wrap.style.minHeight = ''; };
      requestAnimationFrame(_release);
      setTimeout(_release, 50);
    }
    // #7: restore the scroll position captured by renderChart() before
    //   re-rendering. Prevents the page jumping to the top + smooth-scroll
    //   "дёргание" effect after every pill action (move / delete / drag-drop /
    //   undo / redo / backlog "+").
    //
    //   Two non-obvious requirements:
    //   (a) `html { scroll-behavior: smooth }` is set globally in styles.css.
    //       `window.scrollTo({top, behavior:'instant'})` is honoured only in
    //       very recent browsers — older Safari treats `'instant'` as `'auto'`,
    //       which then falls back to the CSS smooth → user sees the page
    //       smoothly scrolling away from the row they just edited. Use the
    //       LEGACY 2-arg form `window.scrollTo(x, y)` — it's defined to be
    //       instant regardless of CSS.
    //   (b) After `wrap.innerHTML = ...` the new DOM hasn't been laid out yet,
    //       so the document height is briefly the OLD value (or 0 between
    //       innerHTML write and paint). A synchronous `scrollTo(savedY)` may
    //       be silently clamped if savedY > current document height. Defer
    //       the restore to the next animation frame, when layout is settled.
    if (typeof Gantt3View._pendingScrollX === 'number') {
      const savedX        = Gantt3View._pendingScrollX;
      const savedWrapY    = Gantt3View._pendingScrollY;
      const savedContY    = Gantt3View._pendingContainerY;
      const savedDocY     = Gantt3View._pendingDocY;
      Gantt3View._pendingScrollX = Gantt3View._pendingScrollY =
        Gantt3View._pendingContainerY = Gantt3View._pendingDocY = null;

      const applyScrolls = () => {
        wrap.scrollLeft = savedX;
        if (savedWrapY) wrap.scrollTop = savedWrapY;
        const cont = wrap.querySelector('.gantt-container');
        if (cont && savedContY) cont.scrollTop = savedContY;
        if (typeof savedDocY === 'number') {
          // Legacy form bypasses `scroll-behavior: smooth` from CSS.
          window.scrollTo(0, savedDocY);
        }
      };
      // Apply immediately (covers the common case where layout is already
      // available because the new DOM is similar in size to the old one) AND
      // again on the next frame (covers the edge case where layout hasn't
      // settled and the first call was clamped). Idempotent, costs nothing.
      applyScrolls();
      requestAnimationFrame(applyScrolls);
    }
    // Tell App's reactive auto-flush: we just painted, skip the upcoming
    // ~100 ms-delayed re-render. Without this, the second render would
    // wipe out the scroll restoration above and the user would see the
    // Gantt blink + jump to top after every drag/delete.
    try { Services.App?.markRenderedNow?.(); } catch(_) {}

    // Гант 3.0 п.2 — после ре-рендера строки пересозданы: снимаем устаревший
    // фокус-декор линзы (делегированные слушатели на #gantt3-wrap переживают
    // innerHTML-замену — wrap-элемент тот же, режим остаётся включён, юзер
    // наводит заново). Без этого L.focusKey указывал бы на detached-узлы.
    if (Gantt3View._lens && Gantt3View._lens.on) {
      Gantt3View._lens.locked = false;
      Gantt3View._lensBindRows();      // идемпотентно (guard wrap._gdtLensBound)
      Gantt3View._lensClearFocus();
    }
    // Гант 3.0 п.3 — Фокус-дорожка: шаблон уже отрисовал gdt-lane-focus + collapse
    // из _dtHiddenTeams, остаётся только (идемпотентно) переустановить делегата.
    if (Gantt3View._focusLane && Gantt3View._focusLane.on) {
      Gantt3View._focusLaneBind();
    }
    // Гант 3.0 п.4 — Командный режим: строки пересозданы → dim/highlight слетели.
    // Бар (sibling до #gantt3-wrap) переживает innerHTML; фильтр-closures держат
    // строковые ключи, поэтому просто пере-применяем подсветку к новым строкам.
    if (Gantt3View._cmd && Gantt3View._cmd.on) {
      Gantt3View._cmdEnsureBar();
      if (Gantt3View._cmd.filter) Gantt3View._cmdApplyFilter();
    }
    // Гант 3.0 п.5 — Pill-anatomy: делегат на #gantt3-wrap (идемпотентно, всегда
    // активен); открытый поповер на старой пилюле закрываем (пилюли пересозданы).
    Gantt3View._anatomyBind();
    Gantt3View._anatomyClose();
    // Гант 3.0 п.7 — Адаптивная плотность: пересчитать по новому числу эпиков.
    if (Gantt3View._densityAuto) Gantt3View._densityApplyAuto();
    // Гант 3.0 п.8 — «Курс»: headers пересозданы → пересобрать ось.
    if (Gantt3View._northstar && Gantt3View._northstar.on) Gantt3View._northstarBuild();
    // Гант 3.0 п.9 — Marquee: делегат идемпотентен; выделение слетело (пилюли
    // пересозданы) → прячем панель.
    Gantt3View._marqueeBind();
    Gantt3View._marqueeHideBar();
    // Гант 3.0 п.10 — Peek: делегат идемпотентен; закрыть карточку (строки новые).
    Gantt3View._peekBind();
    Gantt3View._peekClose();
    // Гант 3.0 п.11 — Переносы: пере-тегировать moved-пилюли после ре-рендера.
    if (Gantt3View._diff && Gantt3View._diff.on) Gantt3View._diffApply();
    // Гант 3.0 п.12 — Burndown: шапки пересозданы → пересобрать спарклайны.
    if (Gantt3View._burndown && Gantt3View._burndown.on) Gantt3View._burndownBuild();
    // Гант 3.0 п.20 — Чипы: строки пересозданы → пересобрать строку чипов + dim.
    if (Gantt3View._chips && Gantt3View._chips.on) Gantt3View._chipsBuild();
    // Гант 3.0 п.19 — Radial-menu: делегат идемпотентен; закрыть открытое меню.
    Gantt3View._radialBind();
    Gantt3View._radialClose();
    // Гант 3.0 п.22 — Inline-edit: делегат dblclick на #gantt3-wrap (идемпотентно).
    Gantt3View._inlineBind();
    // Гант 3.0 п.17 — Слой заметок: ячейки пересозданы → пере-навесить маркеры.
    if (Gantt3View._annot && Gantt3View._annot.on) { Gantt3View._annotBind(); Gantt3View._annotRenderMarkers(); }

    /* update expand/collapse-all button icon (V21 P11.3 — Lucide line-glyph
       вместо box-drawing ⊟/⊞: иконка зависит от состояния, переключаемся
       через Icons.get() чтобы не оставлять нативный текст-символ в кнопке). */
    const ecBtn = document.getElementById('btn-gantt3-expand-all');
    if (ecBtn) {
      const anyVisible = teams.some(t => !Gantt3View._dtHiddenTeams?.has(teamKey(t)));
      const iconName   = anyVisible ? 'minus-square' : 'plus-square';
      const label      = anyVisible ? 'Свернуть все команды' : 'Развернуть все команды';
      ecBtn.title       = label;
      ecBtn.setAttribute('aria-label', label);
      try {
        ecBtn.innerHTML = Services.Icons?.get?.(iconName, { size: 14, label }) || '';
      } catch (_) {
        ecBtn.textContent = '';
      }
    }

    /* ---- helper: update all grid rows to new column widths ---- */
    const updateAllGrids = () => {
      const newGT = makeGT();
      wrap.querySelectorAll('.gdt-grid-row').forEach(el => { el.style.gridTemplateColumns = newGT; });
    };

    /* ---- team visibility toggle — use style.display to override inline display:grid ---- */
    wrap.querySelectorAll('.gantt-team-vis-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const tk2 = btn.dataset.teamKey;
        const nowHidden = !Gantt3View._dtHiddenTeams.has(tk2);
        if (nowHidden) Gantt3View._dtHiddenTeams.add(tk2);
        else           Gantt3View._dtHiddenTeams.delete(tk2);
        // AUDIT_HOLISTIC O10 — toggle класса вместо прямого style.display.
        // Класс `.is-team-collapsed` определён в styles.css и не борется
        // с `body[data-gdt-density]` правилами на той же property.
        wrap.querySelectorAll('.gantt-row').forEach(rowEl => {
          if (rowEl.dataset.teamKey === tk2) rowEl.classList.toggle('is-team-collapsed', nowHidden);
        });
        btn.innerHTML = Services.Icons?.get?.(nowHidden ? 'chevron-right' : 'chevron-down', { size: 12 }) || '';
        // Wave3 P-GR — sync a11y state with collapse-state. `<button>` уже
        // handles Enter/Space via native click; нам остаётся только
        // следить за aria-expanded + aria-label. Имя команды и счётчик
        // эпиков сохранены в data-team-name + соседнем .v16-team-total
        // для обогащённого aria-label в screen-reader.
        const teamName = btn.dataset.teamName || tk2;
        const epicCount = btn.parentElement?.querySelector('.v16-team-total')?.textContent || '';
        btn.setAttribute('aria-expanded', nowHidden ? 'false' : 'true');
        btn.setAttribute('aria-label', nowHidden ? 'Развернуть команду' : 'Свернуть команду');
      });
    });

    /* V17.1 C13 — «+» в строке команды → модалка нового эпика. */
    wrap.querySelectorAll('.gdt-team-add-epic').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const teamName = btn.dataset.team || '';
        Gantt3View._openAddEpicModal(teamName);
      });
    });

    /* V22 G-11 (audit-experts-2026-05-15 Vrba S0-3) — click на dep-badge
       открывает граф зависимостей. Тултип уже даёт «зависит от / блокирует»
       список текстом (через `data-tip` + bindFastTooltip). */
    wrap.querySelectorAll('.v16-epic-deps-badge').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        try { Services.DependencyGraphView?.open?.(); } catch (_) {}
      });
    });

    /* #11 — иконка зависимостей рядом с категорией эпика → модалка multi-dep. */
    wrap.querySelectorAll('.v16-epic-deps-edit').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const epicKey = btn.dataset.epicKey;
        if (!epicKey) return;
        const mod = await import('../components/epicDepsModal.js');
        mod.openEpicDepsModal({
          epicKey,
          onSaved: () => Gantt3View.renderChart(),
        });
      });
    });

    /* Cell-notes icon — открывает попап заметок для ячейки. */
    wrap.querySelectorAll('.gdt-cell-note-icon').forEach(bubble => {
      bubble.addEventListener('mousedown', e => e.stopPropagation());
      bubble.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const rowId = bubble.dataset.rowId;
        const colKey = bubble.dataset.col;
        const targetRow = state.rows.find(r => r.id === rowId);
        if (!targetRow) return;
        const colMeta = cols.find(c => c.key === colKey);
        const releaseLabel = colMeta ? `${colMeta.label}${colMeta.sub ? ' · ' + colMeta.sub : ''}` : colKey;
        const mod = await import('../components/cellNotesPopover.js');
        mod.openCellNotesPopover({
          row: targetRow,
          col: colKey,
          anchorEl: bubble,
          releaseLabel,
          onChange: () => {
            try { Storage.save(); } catch (_) {}
            Gantt3View.renderChart();
          },
        });
      });
    });

    /* #1 C5 — eye-button скрывает колодец из state.ganttHiddenReleases. */
    wrap.querySelectorAll('.gdt-col-eye').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        const key = btn.dataset.colKey;
        if (!key) return;
        const current = Array.isArray(state.ganttHiddenReleases) ? state.ganttHiddenReleases.slice() : [];
        if (!current.includes(key)) current.push(key);
        state.ganttHiddenReleases = current;
        try { Storage.save(); } catch (_) {}
        Gantt3View.renderChart();
        // AUDIT-6 — feedback: скрытие происходило молча.
        try { window.showToast?.(`Колодец «${COL_LABEL_MAP[key] || key}» скрыт · нажмите «Показать все» сверху`, 'info', 2600); } catch (_) {}
      });
    });

    const _bannerShowAll = wrap.querySelector('.gdt-hidden-releases-show-all');
    if (_bannerShowAll) {
      _bannerShowAll.addEventListener('click', () => {
        state.ganttHiddenReleases = [];
        try { Storage.save(); } catch (_) {}
        Gantt3View.renderChart();
      });
    }

    /* Cell-risks glyph — открывает попап рисков для ячейки. */
    wrap.querySelectorAll('.gdt-cell-risk-glyph').forEach(glyph => {
      glyph.addEventListener('mousedown', e => e.stopPropagation());
      glyph.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const rowId = glyph.dataset.rowId;
        const colKey = glyph.dataset.col;
        const targetRow = state.rows.find(r => r.id === rowId);
        if (!targetRow) return;
        const colMeta = cols.find(c => c.key === colKey);
        const releaseLabel = colMeta ? `${colMeta.label}${colMeta.sub ? ' · ' + colMeta.sub : ''}` : colKey;
        const mod = await import('../components/cellRisksPopover.js');
        mod.openCellRisksPopover({
          row: targetRow,
          col: colKey,
          anchorEl: glyph,
          releaseLabel,
          onChange: () => {
            try { Storage.save(); } catch (_) {}
            Gantt3View.renderChart();
          },
        });
      });
    });

    /* V16 roadmap-2 (A4) — Overview row click → switch to default mode +
       jump to that team. Bound only in overview mode; expand-to-detail is
       the one and only action of an overview row. */
    if (_isOverview) {
      wrap.querySelectorAll('.gdt-overview-row').forEach(rowEl => {
        rowEl.addEventListener('click', () => {
          const tk2 = rowEl.dataset.teamKey;
          Gantt3View._dtMode = 'default';
          document.body.dataset.gdtMode = 'default';
          try { localStorage.setItem('q2_gantt3_mode_v16', 'default'); } catch (_) {}
          Gantt3View.renderChart();
          requestAnimationFrame(() => {
            const target = document.querySelector(`.gantt-team-header[data-team-key="${tk2 ? (window.CSS?.escape ? CSS.escape(tk2) : tk2) : ''}"]`);
            if (target?.scrollIntoView) {
              target.scrollIntoView({ behavior: 'smooth', block: 'center' });
              target.classList.add('gdt-jump-pulse');
              setTimeout(() => target.classList.remove('gdt-jump-pulse'), 1400);
            }
          });
        });
      });
    }

    /* Per-pill DnD setup — fills dataTransfer for the per-cell drop handler.
       NOTE: no `e.stopPropagation()` here. The wrap-level dragstart listener
       must also see this event so it can populate `_dragData`, which the
       wrap-level intra-cell pill→pill reorder relies on. */
    wrap.querySelectorAll('.gantt-type-pill[draggable]').forEach(pill => {
      pill.addEventListener('dragstart', e => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('rowId',  pill.dataset.rowId);
        e.dataTransfer.setData('srcCol', pill.dataset.srcCol);
        e.dataTransfer.setData('wt',     pill.dataset.wt);
        // AUDIT_HOLISTIC O10 — class-toggle вместо style.opacity, чтобы
        // правило могло быть отключено через prefers-reduced-motion.
        pill.classList.add('is-dragging');
      });
      pill.addEventListener('dragend', () => { pill.classList.remove('is-dragging'); });
    });
    // Per-cell DnD: works because the per-pill dragstart above sets dataTransfer
    // entries (rowId, srcCol, wt). On drop, route through moveWtBetweenCols so
    // the source cell keeps a ghost trail (#8) — including a timestamped arrow
    // in row.ganttArrows that drawPostponeArrows uses to render the connector.
    wrap.querySelectorAll('.gantt-cell[data-col]').forEach(cell => {
      cell.addEventListener('dragover',  e => { e.preventDefault(); cell.classList.add('gantt-cell-dragover'); });
      cell.addEventListener('dragleave', ()  => cell.classList.remove('gantt-cell-dragover'));
      cell.addEventListener('drop', async e => {
        // QA A4.6 — глобальный try/finally вокруг async drop-handler.
        // Без него любой неожиданный throw (renderChart, moveWtBetweenCols,
        // hook-эвент) превращался в Unhandled Promise Rejection, при этом
        // классы `gantt-cell-dragover` могли остаться на сёстрах cell
        // (например, при ошибке в requireMoveComment до их сброса).
        try {
        e.preventDefault();
        cell.classList.remove('gantt-cell-dragover');
        const rowId  = e.dataTransfer.getData('rowId');
        const srcCol = e.dataTransfer.getData('srcCol');
        const wt     = e.dataTransfer.getData('wt');
        const dstCol = cell.dataset.col;
        if (!rowId || !wt) return;
        // P10.27 — Brand §9 motion: helper для reject Pulse (off-course).
        // Source pill ещё в DOM (renderChart не вызывался при early return),
        // навешиваем класс на 800ms — совпадает с длиной prizma-drop-reject.
        const flagRejectedPill = () => {
          try {
            const _esc = (s) => (window.CSS?.escape ? CSS.escape(String(s)) : String(s));
            const srcPill = wrap.querySelector(
              `.gantt-type-pill[data-row-id="${_esc(rowId)}"][data-src-col="${_esc(srcCol)}"][data-wt="${_esc(wt)}"]`
            );
            if (!srcPill) return;
            srcPill.classList.add('drop-rejected');
            setTimeout(() => srcPill.classList.remove('drop-rejected'), 800);
          } catch (_) { /* мотион не критичен для логики переноса */ }
        };
        // V16 roadmap-2 (B7) — explicit feedback instead of silent no-op.
        // UX 4.1 — унифицировано через window.Toast.warning (blocked drop).
        if (cell.dataset.rowId && cell.dataset.rowId !== rowId) {
          Services.Toast?.warning?.('Не тот эпик — перенесите внутри своего', { ms: 2400 });
          flagRejectedPill();
          return;
        }
        if (srcCol === dstCol) {
          Services.Toast?.warning?.('Задача уже здесь', { ms: 1400 });
          flagRejectedPill();
          return;
        }
        // V15 (audit#1, QA Critical 4): drop fired AFTER user navigated
        // away — guard so we don't mutate state behind an invisible UI.
        if (state.activeSection && state.activeSection !== 'gantt') return;
        const row = state.rows.find(r => r.id === rowId);
        if (!row) return;
        // V14 (B5): if the plan is locked AND edit mode is off, prompt for
        // a mandatory comment via App.requireMoveComment(). Empty/cancelled
        // → abort the move (no state change). Comment is appended to
        // row.transferComments[] inside moveWtBetweenCols.
        let moveComment = '';
        try {
          const res = await Services.App?.requireMoveComment?.({
            rowKey: (row.epic || row.tasks || '(без эпика)'),
            srcCol: COL_LABEL[srcCol], dstCol: COL_LABEL[dstCol], wt,
          });
          if (res === null) {
            // V15 (audit#1, QA H2): explicit feedback so user knows it was cancelled.
            // UX 4.1 — унифицировано через window.Toast.info (cancelled drop).
            Services.Toast?.info?.('Перенос отменён', { ms: 1500 });
            return;
          }
          moveComment = res || '';
        } catch (e2) {
          // V15 (audit#1, QA H3): don't fall through silently — that defeats
          // the V14 (B5) plan-lock contract. Surface + abort.
          window.showToast?.('Не удалось открыть форму комментария. Попробуйте ещё раз', 'error', 3000);
          try { Services.ErrorsLog?.add?.({ level:'error', source:'Gantt3View.drop', message:'requireMoveComment threw', stack: e2?.stack || String(e2) }); } catch(_){}
          return;
        }
        // V15 (audit#1, fullstack Critical 4): re-resolve row by id after
        // await — state.rows could have been replaced by a CSV import while
        // the modal was open, leaving the captured `row` orphaned.
        const fresh = state.rows.find(r => r.id === rowId);
        if (!fresh) {
          window.showToast?.('Задача больше не существует — перенос отменён', 'warning', 2400);
          return;
        }
        Services.HistoryManager?.checkpoint(`перенести ${wt}: ${COL_LABEL[srcCol]} → ${COL_LABEL[dstCol]}`);
        moveWtBetweenCols(fresh, wt, srcCol, dstCol, { comment: moveComment });
        Gantt3View.renderChart();
        // P10.27 — Brand §9 Align-feedback после успешного перемещения.
        // renderChart() пересобрал DOM — навешиваем класс на новый pill в
        // dstCol через rAF чтобы дождаться layout. 600ms = длина анимации
        // prizma-drop-align.
        requestAnimationFrame(() => {
          try {
            const _esc = (s) => (window.CSS?.escape ? CSS.escape(String(s)) : String(s));
            const newPill = document.querySelector(
              `.gantt-type-pill[data-row-id="${_esc(rowId)}"][data-src-col="${_esc(dstCol)}"][data-wt="${_esc(wt)}"]`
            );
            if (!newPill) return;
            newPill.classList.add('drop-aligned');
            setTimeout(() => newPill.classList.remove('drop-aligned'), 600);
          } catch (_) { /* мотион не критичен для логики */ }
        });
        } catch (e2) {
          // QA A4.6 — surface ошибку юзеру + log, не уходим в Unhandled.
          try { window.showToast?.('Не удалось перенести задачу', 'error', 2400); } catch (_) {}
          try { Services.ErrorsLog?.add?.({ level:'error', source:'Gantt3View.drop', message:'drop handler crashed', stack: e2?.stack || String(e2) }); } catch (_) {}
        } finally {
          // Подчищаем все осиротевшие dragover-классы на случай, если
          // throw произошёл до очистки соседних cell'ов.
          try { wrap.querySelectorAll('.gantt-cell-dragover').forEach(c => c.classList.remove('gantt-cell-dragover')); } catch (_) {}
        }
      });
    });

    /* ── П10.25 Keyboard-DnD (WCAG 2.5.7 AAA) ───────────────────────────
       Двух-шаговая модель для пользователей без мыши:
         Enter/Space → выбрать pill → стрелки ←/→ → перемещение между колодцами
         в той же строке → Enter/Space → drop. Esc → отмена.
       Re-use существующего drop-handler API: `moveWtBetweenCols` + те же
       guards (cross-epic, same-col, plan-locked → requireMoveComment) что у
       mouse drop. НЕ дублируем валидацию.                                    */
    const _ensureLiveRegion = () => {
      let live = document.getElementById('gantt3-kb-live');
      if (!live) {
        live = document.createElement('div');
        live.id = 'gantt3-kb-live';
        live.className = 'visually-hidden';
        live.setAttribute('aria-live', 'polite');
        live.setAttribute('aria-atomic', 'true');
        document.body.appendChild(live);
      }
      return live;
    };
    const _announce = (msg) => {
      try {
        const live = _ensureLiveRegion();
        // Очищаем сначала — иначе AT не зачитает идентичное сообщение повторно.
        live.textContent = '';
        // Микро-задержка через rAF чтобы AT гарантированно зафиксировал
        // очистку перед записью нового текста.
        requestAnimationFrame(() => { live.textContent = String(msg || ''); });
      } catch (_) { /* SR-only, не критично */ }
    };

    let _kbDrag = null; // { pill, srcRow, srcCol, srcWt, targetCol }

    const _kbCellsForRow = (rowId) => {
      const _esc = (s) => (window.CSS?.escape ? CSS.escape(String(s)) : String(s));
      return Array.from(wrap.querySelectorAll(
        `.gantt-cell[data-col][data-row-id="${_esc(rowId)}"]`
      ));
    };

    const _clearKbTargets = () => {
      wrap.querySelectorAll('.gantt-cell.kb-drag-target')
        .forEach(c => c.classList.remove('kb-drag-target'));
    };

    const _highlightKbTarget = (cell) => {
      _clearKbTargets();
      if (cell) cell.classList.add('kb-drag-target');
    };

    const _startKbDrag = (pill) => {
      if (_kbDrag) return;
      const srcRow = pill.dataset.rowId;
      const srcCol = pill.dataset.srcCol;
      const srcWt  = pill.dataset.wt;
      if (!srcRow || !srcCol || !srcWt) return;
      _kbDrag = { pill, srcRow, srcCol, srcWt, targetCol: srcCol };
      pill.classList.add('kb-drag-active');
      pill.setAttribute('aria-grabbed', 'true');
      const cells = _kbCellsForRow(srcRow);
      const startCell = cells.find(c => c.dataset.col === srcCol) || null;
      _highlightKbTarget(startCell);
      _announce(`Задача ${srcWt} выбрана. Используйте стрелки влево и вправо для выбора колодца. Enter — переместить, Esc — отмена.`);
    };

    const _moveKbDrag = (dir) => {
      if (!_kbDrag) return;
      const cells = _kbCellsForRow(_kbDrag.srcRow);
      if (!cells.length) return;
      const curIdx = cells.findIndex(c => c.dataset.col === _kbDrag.targetCol);
      let nextIdx = (curIdx < 0 ? 0 : curIdx) + dir;
      if (nextIdx < 0) nextIdx = 0;
      if (nextIdx >= cells.length) nextIdx = cells.length - 1;
      if (nextIdx === curIdx) return;
      const nextCell = cells[nextIdx];
      _kbDrag.targetCol = nextCell.dataset.col;
      _highlightKbTarget(nextCell);
      const label = COL_LABEL_MAP[_kbDrag.targetCol] || _kbDrag.targetCol;
      _announce(`Колодец ${label}`);
    };

    const _cleanupKbDragVisuals = () => {
      if (_kbDrag?.pill) {
        try {
          _kbDrag.pill.classList.remove('kb-drag-active');
          _kbDrag.pill.setAttribute('aria-grabbed', 'false');
        } catch (_) {}
      }
      _clearKbTargets();
    };

    const _cancelKbDrag = () => {
      if (!_kbDrag) return;
      _cleanupKbDragVisuals();
      _announce('Перемещение отменено');
      _kbDrag = null;
    };

    /* Имитирует ту же логику что mouse-drop (см. cell.addEventListener('drop', …)
       выше): cross-epic guard → same-col guard → activeSection guard →
       requireMoveComment → moveWtBetweenCols → renderChart. НЕ дублирует
       валидацию: использует те же ветки и те же тосты. */
    const _executeDrop = async (srcRowId, srcWt, srcCol, dstCol) => {
      // cross-epic guard: pills всегда привязаны к одной строке (`data-row-id`),
      // поэтому строкой target == srcRowId — это инвариант UI, для kb-DnD
      // поддерживается через `_kbCellsForRow(srcRow)`. Дополнительная
      // проверка здесь — paranoia.
      if (!srcRowId || !srcWt || !srcCol || !dstCol) return false;
      if (srcCol === dstCol) {
        // UX 4.1 — унифицировано через window.Toast.warning (blocked drop).
        Services.Toast?.warning?.('Задача уже здесь', { ms: 1400 });
        return false;
      }
      if (state.activeSection && state.activeSection !== 'gantt') return false;
      const row = state.rows.find(r => r.id === srcRowId);
      if (!row) return false;
      let moveComment = '';
      try {
        const res = await Services.App?.requireMoveComment?.({
          rowKey: (row.epic || row.tasks || '(без эпика)'),
          srcCol: COL_LABEL_MAP[srcCol] || srcCol,
          dstCol: COL_LABEL_MAP[dstCol] || dstCol,
          wt: srcWt,
        });
        if (res === null) {
          // UX 4.1 — унифицировано через window.Toast.info (cancelled drop).
          Services.Toast?.info?.('Перенос отменён', { ms: 1500 });
          return false;
        }
        moveComment = res || '';
      } catch (e2) {
        window.showToast?.('Не удалось открыть форму комментария. Попробуйте ещё раз', 'error', 3000);
        try { Services.ErrorsLog?.add?.({ level:'error', source:'Gantt3View.kbDrop', message:'requireMoveComment threw', stack: e2?.stack || String(e2) }); } catch(_) {}
        return false;
      }
      const fresh = state.rows.find(r => r.id === srcRowId);
      if (!fresh) {
        window.showToast?.('Задача больше не существует — перенос отменён', 'warning', 2400);
        return false;
      }
      Services.HistoryManager?.checkpoint(`перенести ${srcWt}: ${COL_LABEL_MAP[srcCol]} → ${COL_LABEL_MAP[dstCol]}`);
      moveWtBetweenCols(fresh, srcWt, srcCol, dstCol, { comment: moveComment });
      Gantt3View.renderChart();
      // Align-feedback: pill пересоздан после renderChart() — навешиваем
      // .drop-aligned на новый pill в dstCol через rAF.
      requestAnimationFrame(() => {
        try {
          const _esc = (s) => (window.CSS?.escape ? CSS.escape(String(s)) : String(s));
          const newPill = document.querySelector(
            `.gantt-type-pill[data-row-id="${_esc(srcRowId)}"][data-src-col="${_esc(dstCol)}"][data-wt="${_esc(srcWt)}"]`
          );
          if (!newPill) return;
          newPill.classList.add('drop-aligned');
          setTimeout(() => newPill.classList.remove('drop-aligned'), 600);
        } catch (_) { /* мотион не критичен */ }
      });
      return true;
    };

    const _commitKbDrag = async () => {
      if (!_kbDrag) return;
      const { srcRow, srcWt, srcCol, targetCol } = _kbDrag;
      // Сбрасываем визуальное состояние сейчас — DOM всё равно перерисуется
      // через renderChart(), а пользователь не должен видеть «зависший»
      // outline пока ждёт modal-комментария.
      _cleanupKbDragVisuals();
      const captured = _kbDrag;
      _kbDrag = null;
      const ok = await _executeDrop(srcRow, srcWt, srcCol, targetCol);
      if (ok) {
        const dstLabel = COL_LABEL_MAP[targetCol] || targetCol;
        _announce(`Задача ${captured.srcWt} перемещена в колодец ${dstLabel}`);
      } else {
        // Если drop отклонён (напр. same-col, cross-section, отменённый
        // комментарий) — pill остаётся в исходном колодце, фокус возвращаем
        // на исходный pill чтобы пользователь мог попробовать снова.
        try { captured.pill?.focus?.({ preventScroll: true }); } catch (_) {}
      }
    };

    const _attachKeyboardDnD = (pill) => {
      if (pill.dataset.kbBound) return;
      pill.dataset.kbBound = '1';
      // Базовый ARIA для skipped-mouse пользователей. tabindex="-1" уже стоит
      // в HTML (roving-tabindex from bindKeyboardNav); role/aria-label —
      // дополняем. aria-grabbed="false" по умолчанию.
      if (!pill.hasAttribute('role')) pill.setAttribute('role', 'button');
      if (!pill.hasAttribute('aria-grabbed')) pill.setAttribute('aria-grabbed', 'false');
      pill.addEventListener('keydown', (e) => {
        // Не реагируем когда фокус внутри input/textarea (не должно случиться,
        // но guard на случай вложенных editable child'ов в будущем).
        if (e.target?.matches?.('input, textarea, select')) return;
        if (!_kbDrag) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            // Останавливаем bubble: иначе wrap-level keydown
            // (bindKeyboardNav) на Enter откроет contextmenu.
            e.stopPropagation();
            _startKbDrag(pill);
          }
        } else if (_kbDrag.pill === pill) {
          if (e.key === 'ArrowRight') {
            e.preventDefault(); e.stopPropagation();
            _moveKbDrag(+1);
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault(); e.stopPropagation();
            _moveKbDrag(-1);
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault(); e.stopPropagation();
            _commitKbDrag();
          } else if (e.key === 'Escape') {
            e.preventDefault(); e.stopPropagation();
            _cancelKbDrag();
          }
        }
      });
      // blur во время активного перетаскивания → отмена (иначе пользователь
      // потеряет визуальный контекст).
      pill.addEventListener('blur', () => {
        if (_kbDrag && _kbDrag.pill === pill) {
          _cancelKbDrag();
        }
      });
    };

    wrap.querySelectorAll('.gantt-type-pill[draggable]').forEach(_attachKeyboardDnD);

    /* ---- backlog "+" picker ---- */
    const removeAddPicker = () => document.getElementById('gdt-add-picker')?.remove();
    wrap.querySelectorAll('.gdt-add-type-btn').forEach(plusBtn => {
      plusBtn.addEventListener('click', e => {
        e.stopPropagation();
        removeAddPicker();
        const rowId = plusBtn.dataset.rowId;
        const row   = state.rows.find(r => r.id === rowId);
        if (!row) return;

        /* collect all unique types from the whole dataset (do not filter by what's already in this row) */
        const allDataTypes = new Set(WORK_TYPES);
        state.rows.forEach(r => {
          (r.release120Types||[]).forEach(t=>allDataTypes.add(t));
          (r.release121Types||[]).forEach(t=>allDataTypes.add(t));
          (r.release122Types||[]).forEach(t=>allDataTypes.add(t));
          (r.overtimeTypes||[]).forEach(t=>allDataTypes.add(t));
          (r.backlogTypes||[]).forEach(t=>allDataTypes.add(t));
        });

        /* mark already-added types but show ALL */
        const inWells = new Set([
          ...(row.release120Types||[]),
          ...(row.release121Types||[]),
          ...(row.release122Types||[]),
          ...(row.overtimeTypes||[]),
          ...(row.backlogTypes||[]),
        ]);
        const available = [...allDataTypes].filter(Boolean).sort((a,b)=>a.localeCompare(b,'ru'));

        if (!available.length) {
          window.showToast?.('Не настроены типы задач. Откройте Настройки → Типы работ', 'info', 2400);
          return;
        }

        const picker = document.createElement('div');
        picker.id = 'gdt-add-picker';
        picker.className = 'gdt-add-picker';
        const rect = plusBtn.getBoundingClientRect();
        const px = Math.min(rect.left, window.innerWidth  - 220);
        const py = Math.min(rect.bottom + 4, window.innerHeight - 260);
        picker.style.cssText = `position:fixed;top:${py}px;left:${px}px;z-index:9999`;
        picker.innerHTML = `
          <div class="gdt-add-picker-title">Выберите тип задачи</div>
          <div class="gdt-add-picker-list">
            ${available.map(t => {
              const already = inWells.has(t);
              return `<label class="gdt-add-picker-item${already?' gdt-add-picker-item-used':''}" title="${already?'Этот тип уже есть в строке — можно добавить ещё раз':''}">
                <input type="checkbox" value="${esc(t)}">
                ${wtEmoji(t)} ${esc(t)}${already?' <span class="gdt-add-picker-used-badge">уже добавлен</span>':''}
              </label>`;
            }).join('')}
          </div>
          <div class="gdt-add-picker-footer">
            <button class="btn btn-sm btn-primary gdt-add-picker-ok">Добавить</button>
            <button class="btn btn-sm btn-outline gdt-add-picker-cancel">Отмена</button>
          </div>`;
        document.body.appendChild(picker);

        picker.querySelector('.gdt-add-picker-ok').addEventListener('click', async () => {
          const selected = [...picker.querySelectorAll('input:checked')].map(cb => cb.value);
          if (!selected.length) { removeAddPicker(); return; }
          removeAddPicker();
          // V14 (B8): after the user picks types, ask which bucket and a
          // mandatory comment. Both default-flow (no plan-lock) and
          // plan-locked flow share this single modal — the comment is
          // ALWAYS required for a bulk-add since adding work mid-plan is
          // a tracked decision.
          const summary = `${(row.epic || row.tasks || '(без эпика)')}: добавить ${selected.length} тип(ов): ${selected.slice(0,3).join(', ')}${selected.length>3?'…':''}`;
          const choice = await Services.App?.openGanttAddTargetModal?.({ summary });
          if (!choice) return;     // cancelled
          const { bucket, comment } = choice;
          Services.HistoryManager?.checkpoint(`добавить ${selected.length} тип(ов) в ${_colLabelFor(bucket)}`);
          // AUDIT-4 — custom-aware add (был legacy-only colKeyMap → в кастомный
          // колодец типы не добавлялись).
          {
            const current = _readTypes(row, bucket);
            const toAdd = selected.filter(t => !current.includes(t));
            if (toAdd.length) _writeTypes(row, bucket, [...current, ...toAdd]);
          }
          // V14 (B5/B8): record the action in transferComments so the trail
          // is uniform regardless of how a pill landed in a bucket.
          const at = new Date().toISOString();
          const existingComments = Array.isArray(row.transferComments) ? row.transferComments : [];
          row.transferComments = [
            ...existingComments,
            ...selected.map(t => ({ at, wt: t, from: '+', to: bucket, text: comment })),
          ];
          row.dirty = true;
          row.updatedAt = at;
          RowFactory.updateDerived(row);
          Storage.save();
          Gantt3View.renderChart();
          window.showToast?.(`Добавлено ${selected.length} в ${COL_LABEL[bucket] || bucket}`, 'success', 1800);
          try { window.HistoryLog?.gantt?.('bulk_add', `Добавлено ${selected.length} в ${COL_LABEL[bucket] || bucket}`, { rowId: row.id, bucket, types: selected, comment }); } catch(_) {}
        });
        picker.querySelector('.gdt-add-picker-cancel').addEventListener('click', removeAddPicker);

        const onOutside = ev => {
          if (!picker.contains(ev.target) && ev.target !== plusBtn) {
            removeAddPicker();
            document.removeEventListener('click', onOutside, true);
          }
        };
        setTimeout(() => document.addEventListener('click', onOutside, true), 0);
      });
    });

    /* ---- Fix 1.7 + label column: resize handles ---- */
    wrap.querySelectorAll('.gdt-resize-handle').forEach(handle => {
      handle.addEventListener('mousedown', e => {
        e.preventDefault();
        const colKey  = handle.dataset.colKey;
        const isLabel = colKey === '_label';
        const startX  = e.clientX;
        const startW  = isLabel ? getLW() : getW(colKey);
        const minW    = isLabel ? 140 : 80;
        const maxW    = isLabel ? 600 : 600;
        document.body.style.cursor = 'col-resize';
        // V17.1.2 — стрелки переносов рисуются по pixel-координатам через
        //   getBoundingClientRect (см. drawPostponeArrows). При resize колодца
        //   updateAllGrids меняет grid-template-columns, но SVG-стрелки
        //   остаются на старых координатах. RAF на каждом mousemove дёшево
        //   и даёт live-перерисовку без рывков; на mouseup делаем финальный
        //   draw чтобы гарантировать точное попадание после release.
        let _arrowsRaf = 0;
        const redrawArrows = () => {
          cancelAnimationFrame(_arrowsRaf);
          _arrowsRaf = requestAnimationFrame(() => {
            try { Gantt3View.drawPostponeArrows(wrap); } catch(_) {}
          });
        };
        const onMove = ev => {
          const newW = Math.max(minW, Math.min(maxW, startW + ev.clientX - startX));
          Gantt3View._dtColWidths[colKey] = newW;
          updateAllGrids();
          redrawArrows();
        };
        const onUp = () => {
          document.body.style.cursor = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
          // финальная синхронизация уже после того как браузер пересчитал layout
          requestAnimationFrame(() => requestAnimationFrame(() => {
            try { Gantt3View.drawPostponeArrows(wrap); } catch(_) {}
          }));
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
      });
    });

    /* ---- context menu: per-pill done + перенос в след релиз ---- */
    // AUDIT-22/23 — динамические соседи и лейблы из cols (включая кастомные
    // релизы), а не legacy-хардкод. NEXT по порядку видимых колодцев;
    // COL_LABEL покрывает и кастомные (иначе «undefined» в тостах).
    const NEXT_RELEASE = {};
    for (let i = 0; i < cols.length - 1; i++) NEXT_RELEASE[cols[i].key] = cols[i + 1].key;
    const COL_LABEL = { ...GANTT_COL_LABELS };
    for (const r of (state.releases || [])) COL_LABEL[r.key] = r.short || r.label || r.key;
    for (const c of cols) COL_LABEL[c.key] = c.label;

    const removeCtxMenu = () => document.getElementById('gdt-ctx-menu')?.remove();

    // V22 X-02 / K-03 (audit-experts-2026-05-15 Selvadurai #1) —
    // production call-site #2: при клике (НЕ ctx-menu) на pill устанавливаем
    // Focus на эпик. Сканнер реагирует через EventBus 'focus-changed'
    // (app.js:701 уже подписан). Чат при следующем prompt'е получит этот
    // focus в state.meta.focus и LLM узнает «этот пользователь интересуется
    // эпиком X». Прерывистый pattern: фокус ставим ТОЛЬКО на простой
    // left-click (без drag, без modifier'ов). Drag-and-drop / ctx-menu /
    // shift-click — отдельные жесты, focus НЕ ставим.
    if (!wrap._focusClickBound) {
      wrap._focusClickBound = true;
      wrap.addEventListener('click', e => {
        if (e.button !== 0) return;                   // left only
        if (e.shiftKey || e.metaKey || e.ctrlKey) return;
        if (e.defaultPrevented) return;
        const pill = e.target.closest('.gantt-type-pill[data-row-id]');
        if (!pill) return;
        const rowId = pill.dataset.rowId;
        const row = state.rows.find(r => r.id === rowId);
        const epicKey = row?.epic || row?.tasks || '';
        if (!epicKey) return;
        try {
          (Services.Focus || globalThis.Focus)?.set?.({
            kind: 'epic', id: epicKey, source: 'gantt',
          });
        } catch (_) {}
      }, { capture: false });
    }

    // AUDIT — bug #1: #gantt3-wrap переживает renderChart() (сбрасывается
    // innerHTML, сам элемент сохраняется). 5 делегирующих хендлеров ниже
    // раньше добавлялись на КАЖДЫЙ render → после N рендеров N копий (стопка
    // ctx-меню, двойная мутация на drop). Снимаем предыдущий набор (хранится
    // на элементе) перед повторной привязкой со свежими closure-данными
    // (COL_LABEL/cols пересобираются каждый render).
    if (wrap._gdtDelegated) {
      for (const [type, fn] of Object.entries(wrap._gdtDelegated)) {
        wrap.removeEventListener(type, fn);
      }
    }
    wrap._gdtDelegated = {};

    wrap.addEventListener('contextmenu', wrap._gdtDelegated.contextmenu = e => {
      const pill = e.target.closest('.gantt-type-pill[data-wt][data-row-id]');
      if (!pill) return;
      e.preventDefault();
      // AUDIT — bug #8: снять предыдущее меню вместе с его document-listener
      // (через transient-registry), а не только DOM-node — иначе onOutside от
      // прошлого меню остаётся на document и закрывает уже это, новое меню.
      Gantt3View._clearTransientInteractions();
      removeCtxMenu();
      const rowId  = pill.dataset.rowId;
      const wt     = pill.dataset.wt;
      const srcCol = pill.dataset.srcCol;
      if (!rowId || !wt || wt === 'задача') return;
      const row = state.rows.find(r => r.id === rowId);
      if (!row) return;
      // V15 Spine 2026-04-30 — DO NOT initialize per-pill maps here.
      // The ctx-menu open path was previously assigning `row.donePills = {}`
      // / `row.unplannedPills = {}` / `row.ganttArrows = []` on every right-
      // click, even when fields were already present. Through the Reactive
      // proxy these `set` ops fire observers → Storage.save → renderChart →
      // user perceives the gantt «дёргается» on every right-click. Read
      // through local fallbacks; the action handlers that actually mutate
      // (done / unplan / move / etc.) already lazy-init these fields.
      const donePills       = row.donePills       || {};
      const unplannedPills  = row.unplannedPills  || {};
      const inProgressPills = row.inProgressPills || {};
      const ganttArrows     = row.ganttArrows     || [];

      const doneKey       = `${srcCol}__${wt}`;
      const isDone        = !!donePills[doneKey];
      const isUnplanned   = !!unplannedPills[doneKey];   // same key shape
      const isInProgress  = !!inProgressPills[doneKey];  // V15 — new state
      const isGhost = pill.classList.contains('gantt-pill-ghost');
      const label   = Utils.escapeHtml(Utils.truncate(wt, 18));
      const nextCol = NEXT_RELEASE[srcCol];
      const nextLabel = nextCol ? COL_LABEL[nextCol] : null;

      // Index of this wt within its current column array (for reorder).
      // AUDIT-22 — custom-aware через _readTypes (был legacy-only colKeyMap).
      const arr = _readTypes(row, srcCol);
      const idxInCol = arr.indexOf(wt);
      const canLeft  = !isGhost && idxInCol > 0;
      const canRight = !isGhost && idxInCol >= 0 && idxInCol < arr.length - 1;

      // #6: pill is "the destination of a recorded move" → show "Вернуть обратно".
      const moveTrail   = (row.ganttArrows || []).find(a => !isGhost && a.dstCol === srcCol && a.wt === wt);
      const isMoveTarget = !!moveTrail;
      const moveSrcLabel = moveTrail ? (COL_LABEL[moveTrail.srcCol] || moveTrail.srcCol) : null;

      const menu = document.createElement('div');
      menu.id = 'gdt-ctx-menu';
      menu.className = 'gdt-ctx-menu';
      // Wave3 P-GR — a11y: role="menu" + tabindex для arrow-nav. Клавиши
      // ↑/↓/Esc/Enter обрабатываются ниже (после append). При закрытии
      // фокус возвращается на pill, открывший меню.
      menu.setAttribute('role', 'menu');
      menu.setAttribute('tabindex', '-1');
      const _ctxReturnFocusEl = pill;
      // V15 Spine 2026-04-30 — provisional position; the real bounds-fix
      // happens AFTER innerHTML+append, when we know the actual menu size.
      // The hardcoded `-240` reserve was wrong: we added new items («▶ В
      // работе»), and locked-plan + move-target rows can grow even taller,
      // so the bottom of the menu was clipping out of the viewport.
      menu.style.cssText = `position:fixed;top:${e.clientY}px;left:${e.clientX}px;z-index:9999;visibility:hidden`;
      // V15 Spine 2026-04-30 — «Rail / Command Rail» concept (art director +
      // designer review). Sub-headers СТАТУС/ПОЛОЖЕНИЕ/ПАРАМЕТРЫ instead of
      // dividers · stroked-glyph in the right-aligned column instead of
      // emoji prefixes · `data-active` on toggle items paints accent-text +
      // filled dot · destructive items live in their own tinted zone at
      // the bottom · bucket names rendered as mono-chip pills.
      const _bucketChip = (s) => `<span class="gdt-ctx-bucket-chip">${Utils.escapeHtml(s)}</span>`;
      const _row = (cls, action, body, glyph = '') =>
        `<div class="gdt-ctx-item${cls ? ' ' + cls : ''}" data-action="${action}">
          <span class="gdt-ctx-text">${body}</span>
          ${glyph ? `<span class="gdt-ctx-glyph">${glyph}</span>` : ''}
        </div>`;
      const _toggle = (action, isActive, body) =>
        `<div class="gdt-ctx-item gdt-ctx-state-toggle${isActive ? ' is-active' : ''}" data-action="${action}">
          <span class="gdt-ctx-dot"></span>
          <span class="gdt-ctx-text">${body}</span>
        </div>`;

      // Inline values for ПАРАМЕТРЫ — show actual data when set, fall back
      // to the action-name placeholder when empty (designer suggestion).
      const _assigneesForPill = (() => {
        const ap = row.assigneePills && typeof row.assigneePills === 'object' ? row.assigneePills : {};
        const perPill = typeof ap[doneKey] === 'string' && ap[doneKey].trim() ? ap[doneKey] : '';
        const fallback = String(row.assignee || '').trim();
        return perPill || fallback;
      })();
      const _datesLabel = (row.workStartDate && row.workEndDate)
        ? `${Utils.escapeHtml(row.workStartDate)} → ${Utils.escapeHtml(row.workEndDate)}`
        : '';

      menu.innerHTML = isGhost
        ? `
          <div class="gdt-ctx-title">${label} <span class="gdt-ctx-title-meta">след переноса</span></div>
          <div class="gdt-ctx-section gdt-ctx-section-danger">
            ${_row('gdt-ctx-item-danger', 'undo-move', 'Убрать след переноса', Icons.get('x', { size: 14 }))}
          </div>
        `
        : `
          <div class="gdt-ctx-title">${label}${isMoveTarget ? ` <span class="gdt-ctx-title-meta">перенесено из ${_bucketChip(moveSrcLabel)}</span>` : ''}</div>

          <div class="gdt-ctx-section">
            <div class="gdt-ctx-section-head">Статус</div>
            ${_toggle(isDone ? 'undone' : 'done', isDone, isDone ? 'Завершена' : 'Завершить')}
            ${(isDone || isUnplanned)
              ? ''
              : _toggle(isInProgress ? 'stop-work' : 'start-work', isInProgress, isInProgress ? 'В работе' : 'Взять в работу')}
            ${_toggle(isUnplanned ? 'plan' : 'unplan', isUnplanned, isUnplanned ? 'Не запланирована' : 'Снять с плана')}
          </div>

          <div class="gdt-ctx-section">
            <div class="gdt-ctx-section-head">Положение</div>
            ${isMoveTarget ? _row('', 'revert-move', `Вернуть в ${_bucketChip(moveSrcLabel)}`, Icons.get('undo', { size: 14 })) : ''}
            ${nextLabel
              ? _row('', 'move-next', `Перенести в ${_bucketChip(nextLabel)}`, Icons.get('chevron-right', { size: 14 }))
              : _row('gdt-ctx-item-disabled', '', 'Последний релиз', Icons.get('chevron-right', { size: 14 }))}
            ${_row(canLeft  ? '' : 'gdt-ctx-item-disabled', 'move-left',  'Сдвинуть влево',  Icons.get('chevron-left', { size: 14 }))}
            ${_row(canRight ? '' : 'gdt-ctx-item-disabled', 'move-right', 'Сдвинуть вправо', Icons.get('chevron-right', { size: 14 }))}
          </div>

          <div class="gdt-ctx-section">
            <div class="gdt-ctx-section-head">Параметры</div>
            ${/* E4 fix (codebase-03 audit) — glyph-only `✎`/`+`/`✕` заменены
                 на Icons.* SVG для соответствия §3 line-glyph hygiene. */ ''}
            ${_row('', 'assign',
              _assigneesForPill ? `<span class="gdt-ctx-value">${Utils.escapeHtml(_assigneesForPill)}</span>` : 'Назначить исполнителя',
              _assigneesForPill ? Icons.get('pencil', { size: 12 }) : Icons.get('plus', { size: 12 }))}
            ${_assigneesForPill ? _row('gdt-ctx-item-subtle', 'unassign', 'Снять назначение', Icons.get('x', { size: 12 })) : ''}
            ${_row('', 'set-dates',
              _datesLabel ? `<span class="gdt-ctx-value">${_datesLabel}</span>` : 'Установить даты работ',
              _datesLabel ? Icons.get('pencil', { size: 12 }) : Icons.get('plus', { size: 12 }))}
          </div>

          <div class="gdt-ctx-section gdt-ctx-section-danger">
            ${_row('gdt-ctx-item-danger', 'delete', 'Удалить из колодца', Icons.get('trash', { size: 14 }))}
          </div>
        `;
      document.body.appendChild(menu);

      // Wave3 P-GR — пометить все items role="menuitem" и сделать
      // focusable. Disabled / section-head / title / glyph-узлы исключаем.
      const _ctxFocusables = () => Array.from(menu.querySelectorAll(
        '.gdt-ctx-item:not(.gdt-ctx-item-disabled)'
      ));
      _ctxFocusables().forEach((it) => {
        it.setAttribute('role', 'menuitem');
        it.setAttribute('tabindex', '-1');
      });
      // Initial focus — на первый menuitem (после layout-clamp, ниже).

      // Now that the menu is in the DOM, measure it and clamp to viewport.
      // 8 px breathing-room from each viewport edge. If the menu would
      // hang off the BOTTOM, flip it ABOVE the cursor instead of just
      // sliding up — flipping feels more natural and keeps the cursor
      // anchored to the menu, which matters for rapid-fire ctx actions.
      {
        const PAD = 8;
        const mr = menu.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let left = e.clientX;
        let top  = e.clientY;
        if (left + mr.width  + PAD > vw) left = Math.max(PAD, vw - mr.width  - PAD);
        if (top  + mr.height + PAD > vh) {
          // Try flipping above the cursor first; if still doesn't fit, clamp.
          const flipped = e.clientY - mr.height;
          top = flipped >= PAD ? flipped : Math.max(PAD, vh - mr.height - PAD);
        }
        // AUDIT_HOLISTIC O10 — позиция через CSS custom-property.
        // #10 — обнуляем inline top/left, иначе они (specificity 1000)
        // выигрывают у CSS-vars и clamp игнорируется у правого/нижнего края.
        menu.dataset.pos = '1';
        menu.style.top = '';
        menu.style.left = '';
        menu.style.setProperty('--prizma-menu-x', left + 'px');
        menu.style.setProperty('--prizma-menu-y', top  + 'px');
        menu.style.visibility = 'visible';
      }

      // Wave3 P-GR — focus first menuitem + arrow-nav + Esc + return-focus.
      {
        const items = _ctxFocusables();
        if (items.length) {
          requestAnimationFrame(() => { try { items[0].focus(); } catch (_) {} });
        }
        const onCtxKey = (ev) => {
          const its = _ctxFocusables();
          if (!its.length) return;
          const cur = document.activeElement;
          const idx = its.indexOf(cur);
          if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            removeCtxMenu();
            try { _ctxReturnFocusEl?.focus({ preventScroll: false }); } catch (_) {}
            return;
          }
          if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            const next = its[(idx >= 0 ? idx + 1 : 0) % its.length] || its[0];
            try { next.focus(); } catch (_) {}
            return;
          }
          if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            const prev = its[(idx > 0 ? idx - 1 : its.length - 1)] || its[its.length - 1];
            try { prev.focus(); } catch (_) {}
            return;
          }
          if (ev.key === 'Home') {
            ev.preventDefault();
            try { its[0].focus(); } catch (_) {}
            return;
          }
          if (ev.key === 'End') {
            ev.preventDefault();
            try { its[its.length - 1].focus(); } catch (_) {}
            return;
          }
          if (ev.key === 'Enter' || ev.key === ' ') {
            const target = cur && cur.matches?.('.gdt-ctx-item') ? cur : null;
            if (target) {
              ev.preventDefault();
              target.click();
            }
          }
        };
        menu.addEventListener('keydown', onCtxKey);
        // Wrap removeCtxMenu via observer-on-remove? Простее: переопределить
        // через MutationObserver не нужно — все existing call-sites
        // вызывают removeCtxMenu() и не возвращают focus. Делегируем
        // return-focus в onOutside / Escape; click-on-item уже сам по
        // себе перенесёт focus на следующий interactive (renderChart()
        // перерисует pill, focus всё равно потеряется — это OK для
        // действия-завершения).
      }

      menu.addEventListener('click', ev => {
        const action = ev.target.closest('[data-action]')?.dataset.action;
        if (!action) return;

        if (action === 'undone') {
          Services.HistoryManager?.checkpoint(`вернуть ${wt}`);
          if (row.donePills) delete row.donePills[doneKey];
          row.dirty = true;
          Storage.save();
          removeCtxMenu();
          Gantt3View.renderChart();
          return;
        }
        // V15 (1.1) — toggle «Не запланирована» flag per-pill.
        if (action === 'unplan' || action === 'plan') {
          Services.HistoryManager?.checkpoint(action === 'unplan' ? `снять с плана ${wt}` : `вернуть в план ${wt}`);
          if (!row.unplannedPills) row.unplannedPills = {};
          if (action === 'unplan') row.unplannedPills[doneKey] = { at: new Date().toISOString() };
          else                     delete row.unplannedPills[doneKey];
          row.dirty = true;
          row.updatedAt = new Date().toISOString();
          Storage.save();
          removeCtxMenu();
          Gantt3View.renderChart();
          try { window.HistoryLog?.gantt?.(action, `${wt} (${COL_LABEL[srcCol]})`, { wt, srcCol }); } catch(_) {}
          return;
        }
        // V15 Spine 2026-04-30 — «To Do ↔ В работе» toggle. Pills are
        // born as «To Do» (no entry in `inProgressPills`); the user flips
        // them to «В работе» explicitly. Mirrors the unplan/plan pair so
        // history-log + checkpoint stay symmetrical.
        if (action === 'start-work' || action === 'stop-work') {
          Services.HistoryManager?.checkpoint(action === 'start-work' ? `в работу: ${wt}` : `вернуть в to do: ${wt}`);
          if (!row.inProgressPills) row.inProgressPills = {};
          if (action === 'start-work') row.inProgressPills[doneKey] = { at: new Date().toISOString() };
          else                          delete row.inProgressPills[doneKey];
          row.dirty = true;
          row.updatedAt = new Date().toISOString();
          Storage.save();
          removeCtxMenu();
          Gantt3View.renderChart();
          try { window.HistoryLog?.gantt?.(action, `${wt} (${COL_LABEL[srcCol]})`, { wt, srcCol }); } catch(_) {}
          return;
        }
        if (action === 'done') {
          // V14 (B7): «Завершить» now requires the user to specify the
          // factual completion date and lets them attach an optional
          // comment. donePills[k] becomes an OBJECT {at,comment,ts}
          // (was a bare `true`) — renderer still treats truthy as done so
          // existing data round-trips. row.actualDoneDate / row.doneComment
          // mirror the latest pill-completion for spreadsheet-style access.
          removeCtxMenu();
          (async () => {
            const result = await Services.App?.openGanttCompleteModal?.({
              summary: `${(row.epic || row.tasks || '(без эпика)')} · ${wt} · ${COL_LABEL[srcCol]}`,
            });
            // #9 — гарантированно закрываем модалку (на случай если openGantt-
            // CompleteModal оставила её visible после resolve — встречалось
            // в edge-case'ах при быстром повторе action).
            const _completeModal = document.getElementById('modal-gantt-complete');
            if (_completeModal && !_completeModal.classList.contains('hidden')) {
              _completeModal.classList.add('hidden');
              _completeModal.dataset.busy = '0';
            }
            if (!result) return;     // cancelled
            Services.HistoryManager?.checkpoint(`завершить ${wt}`);
            if (!row.donePills) row.donePills = {};
            row.donePills[doneKey] = { at: result.date, comment: result.comment, ts: new Date().toISOString() };
            row.actualDoneDate = result.date;
            row.doneComment    = result.comment;
            row.dirty = true;
            row.updatedAt = new Date().toISOString();
            Storage.save();
            Gantt3View.renderChart();
            try { window.HistoryLog?.gantt?.('complete_pill', `Завершено ${wt} (${COL_LABEL[srcCol]}) на ${result.date}`, { wt, srcCol, date: result.date, comment: result.comment }); } catch(_) {}
          })();
          return;
        }

        if (action === 'set-dates') {
          // V14 (B6.2): row-level work-period override.
          removeCtxMenu();
          (async () => {
            const result = await Services.App?.openGanttDatesModal?.({
              summary: `${(row.epic || row.tasks || '(без эпика)')} · ${wt}`,
              start: row.workStartDate || '',
              end:   row.workEndDate   || '',
            });
            if (!result) return;
            Services.HistoryManager?.checkpoint(`установить даты работ`);
            row.workStartDate = result.start;
            row.workEndDate   = result.end;
            row.dirty = true;
            row.updatedAt = new Date().toISOString();
            RowFactory.updateDerived(row);
            Storage.save();
            Gantt3View.renderChart();
            try { window.HistoryLog?.gantt?.('set_dates', `${result.start || '—'} → ${result.end || '—'}`, { rowId: row.id, ...result }); } catch(_) {}
          })();
          return;
        }

        if (action === 'assign') {
          // V15 Spine redesign 2026-04-30 — assignment is now PER-PILL, not
          // per-row. Old V14 behaviour silently broadcast «Иванов» to every
          // pill of the row across all colodets; user flagged this as a bug.
          // We now write to row.assigneePills[`${srcCol}__${wt}`]. Renderer
          // reads per-pill first → falls back to row.assignee for legacy rows.
          removeCtxMenu();
          (async () => {
            const taskTags = String(row.tags || '').split(/[|,]/).map(s=>s.trim()).filter(Boolean);
            const result = await Services.App?.openGanttAssignModal?.({
              summary: `${(row.epic || row.tasks || '(без эпика)')} · ${wt} · ${COL_LABEL[srcCol]}`,
              taskTags,
              requireOtDays: srcCol === 'overtime',
            });
            if (!result) return;
            Services.HistoryManager?.checkpoint(`назначить ${result.fio || 'исполнителя'} на ${wt}`);
            if (!row.assigneePills || typeof row.assigneePills !== 'object') row.assigneePills = {};
            row.assigneePills[`${srcCol}__${wt}`] = result.fio;
            row.assignedAt = new Date().toISOString();
            row.dirty = true;
            row.updatedAt = row.assignedAt;
            RowFactory.updateDerived(row);
            Storage.save();
            Services.App?.populateFilterDropdowns?.();
            Gantt3View.renderChart();
            window.showToast?.(`Назначен ${result.fio} на «${wt}»`,'success',1800);
            try { window.HistoryLog?.gantt?.('assign_pill', `Назначен ${result.fio} на ${wt} в ${srcCol}`, { rowId: row.id, empId: result.id, fio: result.fio, col: srcCol, wt }); } catch(_) {}
          })();
          return;
        }

        // V17.1 C7 — снять назначение с пилюли. Удаляет ключ из
        // row.assigneePills (и пишет '' в legacy row.assignee если pills нет).
        if (action === 'unassign') {
          const pillKey = `${srcCol}__${wt}`;
          Services.HistoryManager?.checkpoint(`снять назначение на ${wt}`);
          if (row.assigneePills && typeof row.assigneePills === 'object' && row.assigneePills[pillKey]) {
            const prev = row.assigneePills[pillKey];
            delete row.assigneePills[pillKey];
            row.dirty = true; row.updatedAt = new Date().toISOString();
            RowFactory.updateDerived(row);
            Storage.save();
            removeCtxMenu();
            Gantt3View.renderChart();
            window.showToast?.(`Снят ${prev} с «${wt}»`, 'info', 1800);
            try { window.HistoryLog?.gantt?.('unassign_pill', `Снят ${prev} с ${wt} в ${srcCol}`, { rowId: row.id, fio: prev, col: srcCol, wt }); } catch(_) {}
          } else {
            // legacy: row.assignee на всю строку — обнуляем только если
            // других пилюль с этим же исполнителем нет (защита от случайного
            // массового снятия).
            row.assignee = '';
            row.dirty = true; row.updatedAt = new Date().toISOString();
            RowFactory.updateDerived(row);
            Storage.save();
            removeCtxMenu();
            Gantt3View.renderChart();
            window.showToast?.('Назначение снято', 'info', 1600);
          }
          return;
        }

        if (action === 'delete') {
          Services.HistoryManager?.checkpoint(`удалить ${wt} из ${COL_LABEL[srcCol]}`);
          // AUDIT-22 — custom-aware delete (был legacy-only colKeyMap → no-op
          // по данным в кастомном колодце).
          _writeTypes(row, srcCol, _readTypes(row, srcCol).filter(t => t !== wt));
          // Also drop any "done"-flag and any arrow trail tied to this wt
          if (row.donePills) delete row.donePills[doneKey];
          // V17 P2 (CRIT-4): scope the arrow-trail purge to arrows that
          // ENTERED OR LEFT the source colodet. Earlier `a.wt !== wt` was
          // too wide: deleting `backend` in r122 wiped trails of `backend`
          // in r120↔r121 too. Audit 2026-05 (QA, B2).
          if (Array.isArray(row.ganttArrows)) {
            row.ganttArrows = row.ganttArrows.filter(
              a => !(a.wt === wt && (a.srcCol === srcCol || a.dstCol === srcCol))
            );
          }
          row.dirty = true; row.updatedAt = new Date().toISOString();
          RowFactory.updateDerived(row);
          Storage.save();
          removeCtxMenu();
          Gantt3View.renderChart();
          window.showToast?.(`«${Utils.truncate(wt, 20)}» удалена из ${COL_LABEL[srcCol]}`, 'info', 1800);
          return;
        }

        if (action === 'undo-move') {
          // V15 (audit#1, system H7): checkpoint so the «убрать след
          // переноса» action is reversible like all other gantt mutations.
          Services.HistoryManager?.checkpoint('убрать след переноса');
          if (Array.isArray(row.ganttArrows)) {
            row.ganttArrows = row.ganttArrows.filter(a => !(a.wt === wt && a.srcCol === srcCol));
          }
          row.dirty = true;
          Storage.save();
          removeCtxMenu();
          Gantt3View.renderChart();
          return;
        }

        if (action === 'move-left' || action === 'move-right') {
          if (idxInCol < 0) { removeCtxMenu(); return; }
          const targetIdx = action === 'move-left' ? idxInCol - 1 : idxInCol + 1;
          if (targetIdx < 0 || targetIdx >= arr.length) { removeCtxMenu(); return; }
          Services.HistoryManager?.checkpoint(`переставить ${wt}`);
          // AUDIT-22 — custom-aware reorder. arr = _readTypes(row, srcCol),
          // переставляем копию и пишем обратно через _writeTypes.
          const reordered = arr.slice();
          [reordered[idxInCol], reordered[targetIdx]] = [reordered[targetIdx], reordered[idxInCol]];
          _writeTypes(row, srcCol, reordered);
          row.dirty = true;
          Storage.save();
          removeCtxMenu();
          Gantt3View.renderChart();
          return;
        }

        if (action === 'move-next' && nextCol) {
          // V15 (Spine 2026-04-30): the ctx-menu «перенести в …» action
          // previously skipped the V14 (B5) plan-lock comment prompt —
          // only drag-and-drop honored it. User flagged the inconsistency:
          // a move that asks for a comment on drag must also ask on click.
          // We now route through the same `App.requireMoveComment()` flow.
          // When unlocked / edit-mode-on, the helper resolves with `''`
          // immediately (no modal) — keeps the unlocked path zero-friction.
          removeCtxMenu();
          (async () => {
            let moveComment = '';
            try {
              const res = await Services.App?.requireMoveComment?.({
                rowKey: (row.epic || row.tasks || '(без эпика)'),
                srcCol: COL_LABEL[srcCol], dstCol: COL_LABEL[nextCol], wt,
              });
              if (res === null) {
                // UX 4.1 — унифицировано через window.Toast.info (cancelled drop).
                Services.Toast?.info?.('Перенос отменён', { ms: 1500 });
                return;
              }
              moveComment = res || '';
            } catch (e2) {
              window.showToast?.('Не удалось открыть форму комментария. Попробуйте ещё раз', 'error', 3000);
              try { Services.ErrorsLog?.add?.({ level:'error', source:'Gantt3View.move-next', message:'requireMoveComment threw', stack: e2?.stack || String(e2) }); } catch(_){}
              return;
            }
            // Re-resolve row by id after await — state.rows could have been
            // replaced by a CSV/JSON import while the modal was open.
            const fresh = state.rows.find(r => r.id === row.id);
            if (!fresh) {
              window.showToast?.('Задача больше не существует — перенос отменён', 'warning', 2400);
              return;
            }
            Services.HistoryManager?.checkpoint(`перенести ${wt}: ${COL_LABEL[srcCol]} → ${COL_LABEL[nextCol]}`);

            // ── Visual flight animation ──────────────────────────
            const srcCell = wrap.querySelector(`.gantt-cell[data-col="${srcCol}"][data-row-id="${fresh.id}"]`);
            const dstCell = wrap.querySelector(`.gantt-cell[data-col="${nextCol}"][data-row-id="${fresh.id}"]`);
            const srcPill = pill;
            if (srcCell && dstCell && srcPill && srcPill.isConnected) {
              const startRect = srcPill.getBoundingClientRect();
              const endRect   = dstCell.getBoundingClientRect();
              const ghost = srcPill.cloneNode(true);
              ghost.classList.add('gantt-pill-flying');
              ghost.style.cssText = `
                position:fixed;left:${startRect.left}px;top:${startRect.top}px;
                width:${startRect.width}px;height:${startRect.height}px;
                z-index:10000;pointer-events:none;
                transition:transform .65s cubic-bezier(.45,.05,.25,1.6), opacity .55s .15s ease-out, box-shadow .25s ease-out;
                box-shadow:0 4px 16px rgba(0,0,0,.25);
              `;
              document.body.appendChild(ghost);
              // AUDIT_HOLISTIC O10 — transform через CSS custom-properties;
              // правило `.gdt-drop-ghost` уважает prefers-reduced-motion.
              ghost.classList.add('gdt-drop-ghost');
              requestAnimationFrame(() => {
                const dx = endRect.left + endRect.width/2  - (startRect.left + startRect.width/2);
                const dy = endRect.top  + endRect.height/2 - (startRect.top  + startRect.height/2);
                ghost.style.setProperty('--prizma-ghost-tx', dx + 'px');
                ghost.style.setProperty('--prizma-ghost-ty', dy + 'px');
                ghost.style.setProperty('--prizma-ghost-scale', '1.15');
                ghost.style.boxShadow = '0 8px 24px rgba(79,70,229,.4)';
              });
              dstCell.classList.add('gantt-cell-receiving');
              setTimeout(() => dstCell.classList.remove('gantt-cell-receiving'), 900);
              // V22 G-08 (audit-experts-2026-05-15 Demin H7) — раньше
              //   setTimeout(() => ghost.remove(), 700)
              //   setTimeout(() => Gantt3View.renderChart(), 700)
              // Magic-number 700 совпадал с CSS `transition: transform .65s` —
              // если дизайнер менял длительность, удаление/ре-рендер летел
              // в пустоту (раньше) или с дрожанием (позже). Заменяем на
              // транзишн-event: ghost удаляется и Гант перерендеривается
              // ТОЧНО когда анимация транзишна завершилась. Fallback
              // setTimeout(1200) защищает от случая когда transitionend
              // не выстрелит (reduced-motion / display:none во время полёта).
              let _animDone = false;
              const _finish = () => {
                if (_animDone) return;
                _animDone = true;
                try { ghost.remove(); } catch (_) {}
                try { Gantt3View.renderChart(); } catch (_) {}
              };
              ghost.addEventListener('transitionend', (ev) => {
                // Слушаем только основной transform — а не вложенные box-shadow
                // / opacity transitions, иначе finish сработает на первом из них.
                if (ev.propertyName === 'transform') _finish();
              }, { once: false });
              // Defensive fallback: если по какой-то причине transitionend
              // не выстрелил (reduced-motion, hidden tab, browser bug) —
              // через 1.2s всё равно вычищаем (анимация ≤ .65s + headroom).
              setTimeout(_finish, 1200);

              // Mutate via shared helper (records timestamped arrow). Сама
              // мутация делается СРАЗУ — не ждём анимации. renderChart()
              // отложен до transitionend (см. _finish выше).
              moveWtBetweenCols(fresh, wt, srcCol, nextCol, { comment: moveComment });
            } else {
              // Если визуальной анимации не было (например, ячейка не нашлась
              // в DOM) — просто мутируем и сразу перерисовываем.
              moveWtBetweenCols(fresh, wt, srcCol, nextCol, { comment: moveComment });
              Gantt3View.renderChart();
            }
          })();
          return;
        }

        // #6: revert a previously-moved pill back to its original cell.
        if (action === 'revert-move') {
          Services.HistoryManager?.checkpoint(`вернуть ${wt} обратно`);
          const reverted = revertMove(row, wt, srcCol);
          removeCtxMenu();
          Gantt3View.renderChart();
          if (reverted) {
            const fromLbl = COL_LABEL[reverted.dstCol] || reverted.dstCol;
            const toLbl   = COL_LABEL[reverted.srcCol] || reverted.srcCol;
            window.showToast?.(`«${Utils.truncate(wt, 20)}» возвращена: ${fromLbl} → ${toLbl}`, 'info', 2200);
          }
          return;
        }
      });

      const onOutside = ev => {
        if (!menu.contains(ev.target)) {
          removeCtxMenu();
          document.removeEventListener('click', onOutside, true);
          Gantt3View._cancelTransientInteractions = null;
          // Wave3 P-GR — если outside-click был по другому focusable
          // (например, чтобы открыть другое меню) — не воруем focus.
          // Возвращаем на pill только если active элемент потерян (body).
          if (document.activeElement === document.body) {
            try { _ctxReturnFocusEl?.focus?.({ preventScroll: true }); } catch (_) {}
          }
        }
      };
      // AUDIT — bug #8: регистрируем teardown меню в transient-registry, чтобы
      // renderChart() (зовёт _clearTransientInteractions в начале) и повторный
      // right-click сняли и detached-node, и capture-listener с document.
      // Раньше onOutside жил на document до следующего клика → leak + закрывал
      // чужое меню (menu.contains на отсоединённой ноде всегда false).
      Gantt3View._cancelTransientInteractions = () => {
        removeCtxMenu();
        document.removeEventListener('click', onOutside, true);
      };
      setTimeout(() => document.addEventListener('click', onOutside, true), 0);
    });

    /* ── Drag-and-drop reorder within the same well ─────── */
    let _dragData = null;
    wrap.addEventListener('dragstart', wrap._gdtDelegated.dragstart = e => {
      const pill = e.target.closest('.gantt-type-pill[data-wt][data-row-id]');
      if (!pill || pill.classList.contains('gantt-pill-ghost')) return;
      _dragData = {
        rowId:  pill.dataset.rowId,
        srcCol: pill.dataset.srcCol,
        wt:     pill.dataset.wt,
      };
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', _dragData.wt); } catch(_){}
      pill.classList.add('gantt-pill-dragging');

      // V16 roadmap-2 (A2) — pre-highlight drop targets the moment drag
      // starts. Valid = same row (same epic), different col. Invalid =
      // every other cell. Without this advance hint, the user only sees
      // a single highlight on the cell currently under cursor — and
      // dropping near a hatched OT gutter feels especially uncertain.
      // Iterate via dataset comparison rather than CSS selectors (cleaner
      // and avoids cross-scope cssEscape helpers).
      // Гант 3.0 п.1 — подсветка дропзон через inline-!important. Класс
      // .gdt-drop-valid в общем .gantt-* каскаде перебивается правилами
      // [data-theme=…] .gantt-window-* (специфичность 0,3,0) и shared
      // !important-правилом, поэтому фон/тень/прозрачность ставим инлайном
      // (бьёт любой stylesheet-rule). cursor задаётся CSS-классом — там
      // конфликта нет. Снимаем в dragend.
      wrap.querySelectorAll('.gantt-cell[data-row-id]').forEach(c => {
        if (c.dataset.rowId === _dragData.rowId) {
          if (c.dataset.col !== _dragData.srcCol) {
            c.classList.add('gdt-drop-valid');
            c.style.setProperty('background-color', 'var(--prizma-information-bg)', 'important');
            c.style.setProperty('box-shadow', 'inset 0 0 0 1.5px var(--prizma-information)', 'important');
          }
        } else {
          c.classList.add('gdt-drop-invalid');
          c.style.setProperty('opacity', '0.4', 'important');
        }
      });
    });
    wrap.addEventListener('dragend', wrap._gdtDelegated.dragend = e => {
      const pill = e.target.closest('.gantt-type-pill');
      if (pill) pill.classList.remove('gantt-pill-dragging');
      wrap.querySelectorAll('.gantt-pill-drop-target,.gantt-cell-drop-target,.gdt-drop-valid,.gdt-drop-invalid')
        .forEach(el => {
          el.classList.remove('gantt-pill-drop-target','gantt-cell-drop-target','gdt-drop-valid','gdt-drop-invalid');
          // Гант 3.0 п.1 — снять inline-подсветку (см. dragstart).
          el.style.removeProperty('background-color');
          el.style.removeProperty('box-shadow');
          el.style.removeProperty('opacity');
        });
      _dragData = null;
    });
    // Wrap-level handlers cover ONLY intra-cell pill→pill reorder.
    // Cross-cell DnD is handled by the per-cell drop installed above (which
    // routes through moveWtBetweenCols so a ghost trail is recorded). If we
    // also handled cross-cell here, both handlers would fire on bubble and
    // double-mutate the row.
    wrap.addEventListener('dragover', wrap._gdtDelegated.dragover = e => {
      if (!_dragData) return;
      // Гант 3.0 п.1 — edge-autoscroll: тащишь к правому/левому краю → колодцы
      // прокручиваются, дальние релизы достижимы перетаскиванием (#gantt3-wrap = h-скроллер).
      { const r = wrap.getBoundingClientRect();
        if (e.clientX > r.right - 64) wrap.scrollLeft += 14;
        else if (e.clientX < r.left + 248) wrap.scrollLeft = Math.max(0, wrap.scrollLeft - 14); }
      const pillTarget = e.target.closest('.gantt-type-pill[data-wt][data-row-id]');
      if (!pillTarget) return;
      if (pillTarget.classList.contains('gantt-pill-ghost') || pillTarget.classList.contains('gantt-pill-dragging')) return;
      if (pillTarget.dataset.rowId !== _dragData.rowId || pillTarget.dataset.srcCol !== _dragData.srcCol) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      wrap.querySelectorAll('.gantt-pill-drop-target').forEach(el => el.classList.remove('gantt-pill-drop-target'));
      pillTarget.classList.add('gantt-pill-drop-target');
    });
    wrap.addEventListener('drop', wrap._gdtDelegated.drop = e => {
      if (!_dragData) return;
      const target = e.target.closest('.gantt-type-pill[data-wt][data-row-id]');
      if (!target) return;
      if (target.dataset.rowId !== _dragData.rowId || target.dataset.srcCol !== _dragData.srcCol) return;
      e.preventDefault();
      const row = state.rows.find(r => r.id === _dragData.rowId);
      if (!row) { _dragData = null; return; }
      // AUDIT-22 — custom-aware intra-cell reorder (был legacy-only colKeyMap).
      const arr = _readTypes(row, _dragData.srcCol);
      if (!arr.length) return;
      const fromIdx = arr.indexOf(_dragData.wt);
      const toIdx   = arr.indexOf(target.dataset.wt);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
      Services.HistoryManager?.checkpoint(`переставить ${_dragData.wt}`);
      const next = [...arr];
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, _dragData.wt);
      _writeTypes(row, _dragData.srcCol, next);
      row.dirty = true;
      Storage.save();
      _dragData = null;
      wrap.querySelectorAll('.gantt-pill-drop-target').forEach(el => el.classList.remove('gantt-pill-drop-target'));
      Gantt3View.renderChart();
    });

    /* Draw postpone arrows after layout is settled. Single rAF was racing the
       browser's layout pass on first render — pill rects came back zero-sized,
       arrows had nothing to anchor to, and the SVG silently rendered nothing.
       Two rAFs guarantee one full paint has happened.
       V17 P2 (M2) — dropped the 750 ms `setTimeout` re-run. Audit found the
       extra paint actually drew arrows over already-removed nodes during
       fast re-renders (e.g. drag-flight animation). Two rAFs are sufficient
       since flight animations finish before next render. */
    requestAnimationFrame(() => requestAnimationFrame(() => Gantt3View.drawPostponeArrows(wrap)));

    // V17.1.2 — ResizeObserver на gantt3-wrap: при любом изменении размера
    //   (resize окна браузера, sidebar collapse/expand, открытие чата,
    //   1fr-перераспределение колодцев из C2) стрелки получают свежие
    //   pixel-координаты. Идемпотентно: если уже привязан к этому wrap'у —
    //   skip. Debounce через RAF чтобы не дёргать на каждом пикселе.
    if (!wrap._gdtArrowsResizeObserver && typeof ResizeObserver !== 'undefined') {
      // TECH 4.2 — scrollEnd-style debounce 50 ms. Раньше cancelAnimationFrame
      // + rAF гасил только intra-frame burst'ы; multi-frame resize (drag
      // sidebar / window resize) триггерил drawPostponeArrows на каждом frame.
      // Теперь копим entries за 50 ms и обрабатываем только финальное состояние.
      let _roRaf = 0;
      let _roTimer = 0;
      const flush = () => {
        cancelAnimationFrame(_roRaf);
        _roRaf = requestAnimationFrame(() => {
          try { Gantt3View.drawPostponeArrows(wrap); } catch(_) {}
        });
      };
      const ro = new ResizeObserver(() => {
        clearTimeout(_roTimer);
        _roTimer = setTimeout(flush, 50);
      });
      ro.observe(wrap);
      wrap._gdtArrowsResizeObserver = ro;
    }

    // V15 Spine 2026-04-30 — install the fast custom-tooltip handler once.
    // Idempotent — wrap-level delegation survives every renderChart() since
    // we re-use the same `#gantt3-wrap` node.
    Gantt3View.bindFastTooltip(wrap);

    Gantt3View._positionTodayLine(wrap);
    Gantt3View._positionMilestoneLines(wrap);
    Gantt3View._bindTodayLineResize(wrap);

    // V22 G-03 (audit-experts-2026-05-15 Demin C3) + G-08 (Demin H7) —
    // эмитим 'gantt3-rendered' для подписчиков (keyboard-nav setupRoving,
    // dependency-arrows, post-render hooks). Раньше эти подписки делались
    // через monkey-patch Gantt3View.renderChart — заменено на EventBus.
    try {
      if (typeof globalThis !== 'undefined' && globalThis.EventBus?.emit) {
        globalThis.EventBus.emit('gantt3-rendered');
      }
    } catch (_) { /* defensive */ }
  },
  /**
   * Today-line — вертикальная пунктирная линия сквозь всю высоту Ганта.
   * Источник позиции: header-col c data-today-pct (тот колодец, в окно
   * которого попадает текущая дата). Левая координата = bbox header-col
   * относительно .gantt-container + ширина колодца × pct/100.
   *
   * Скрывается, если активного колодца нет (например, today вне всех окон).
   */
  _positionTodayLine(wrap) {
    if (!wrap) return;
    const container = wrap.querySelector('.gantt-container');
    const line = container?.querySelector('.gdt-today-line');
    if (!container || !line) return;
    const activeHeader = container.querySelector('.gantt-header-col[data-today-pct]');
    if (!activeHeader) {
      line.hidden = true;
      return;
    }
    const pct = parseFloat(activeHeader.dataset.todayPct || '0');
    const label = activeHeader.dataset.todayLabel || '';
    const hdrRect = activeHeader.getBoundingClientRect();
    const ctnRect = container.getBoundingClientRect();
    const leftPx = (hdrRect.left - ctnRect.left) + (hdrRect.width * pct / 100);
    line.style.left = `${leftPx.toFixed(1)}px`;
    // Высота: bottom:0 у container даёт только viewport-part'а, потому что
    // у container `overflow-y:auto` (см. styles.css:6875). Используем
    // scrollHeight чтобы линия покрывала ВСЕ rows + trails ниже viewport.
    line.style.height = `${container.scrollHeight}px`;
    line.title = label ? `Сегодня — ${label}` : 'Сегодня';
    line.hidden = false;
  },
  /**
   * F2 Milestone'ы — вертикальные контрольные точки. Та же модель, что и
   * today-line: дата вехи → DOY → колодец, в чьё окно она попадает → процент
   * внутри окна → пиксельная позиция. Год — текущий (окна год-агностичны, как
   * и весь Гант). Веха вне всех окон — скрыта (как today-line вне окон).
   */
  _positionMilestoneLines(wrap) {
    if (!wrap) return;
    const container = wrap.querySelector('.gantt-container');
    if (!container) return;
    const lines = container.querySelectorAll('.gdt-milestone-line');
    if (!lines.length) return;
    const headers = [...container.querySelectorAll('.gantt-header-col[data-win-start]')];
    const ctnRect = container.getBoundingClientRect();
    const headerEl = container.querySelector('.gantt-header');
    const headerH = headerEl ? headerEl.offsetHeight : 0;   // флажок ставим под шапкой колодцев
    const yr = new Date().getFullYear();
    const isoToDoy = (iso) => {
      const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return null;
      return Math.floor((Date.UTC(yr, (+m[2]) - 1, +m[3]) - Date.UTC(yr, 0, 1)) / 86400000);
    };
    lines.forEach(line => {
      const doy = isoToDoy(line.dataset.msDate);
      if (doy == null || !headers.length) { line.hidden = true; return; }
      let placed = false;
      for (const hdr of headers) {
        const s = parseInt(hdr.dataset.winStart, 10);
        let e = parseInt(hdr.dataset.winEnd, 10);
        if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
        let d = doy;
        if (e < s) { e += 365; if (d < s) d += 365; }   // окно через год-rollover (28.12–15.01)
        if (d < s || d > e) continue;
        const pct = (e === s) ? 50 : ((d - s) / (e - s)) * 100;
        const hdrRect = hdr.getBoundingClientRect();
        const leftPx = (hdrRect.left - ctnRect.left) + (hdrRect.width * pct / 100);
        const flag = line.querySelector('.gdt-milestone-flag');
        if (flag) flag.style.top = `${headerH + 2}px`;   // под лейблами колодцев (1.20/1.21), не наезжая
        line.style.left = `${leftPx.toFixed(1)}px`;
        line.style.height = `${container.scrollHeight}px`;
        line.hidden = false;
        placed = true;
        break;
      }
      if (!placed) line.hidden = true;
    });
  },
  _todayLineResizeBound: false,
  _todayLineRO: null,
  _bindTodayLineResize(wrap) {
    const reposition = () => {
      const w = document.getElementById('gantt3-wrap');
      if (w) { Gantt3View._positionTodayLine(w); Gantt3View._positionMilestoneLines(w); }
    };
    // window-resize — стабильный таргет, биндим один раз.
    if (!Gantt3View._todayLineResizeBound) {
      Gantt3View._todayLineResizeBound = true;
      window.addEventListener('resize', reposition);
    }
    // AUDIT-8 — `.gantt-header` пересоздаётся каждым renderChart, поэтому RO
    // нужно reobserve свежий узел: иначе observer навсегда висит на detached
    // header и линия перестаёт реагировать на ресайз колонок (+ утечка DOM).
    try {
      if (Gantt3View._todayLineRO) Gantt3View._todayLineRO.disconnect();
      const hdr = wrap.querySelector('.gantt-header');
      if (hdr && typeof ResizeObserver !== 'undefined') {
        Gantt3View._todayLineRO = new ResizeObserver(reposition);
        Gantt3View._todayLineRO.observe(hdr);
      }
    } catch (_) { /* old browsers */ }
  },
  /** Lightweight body-attached tooltip — replaces native `title=` (which
   *  has a ~1.5 s delay browsers don't expose any API to shorten). 200 ms
   *  hover delay before showing. Multi-line via `\n` in `data-tip`.
   *  V18.3 B1 — extracted to ./gantt/aux.js (50 LOC moved). once-flag
   *  передаётся через mutable boundState reference. */
  _fastTipBoundState: { bound: false },
  bindFastTooltip(wrap) { _auxBindFastTooltip(wrap, Gantt3View._fastTipBoundState); },
  // V18.3 B1 — extracted to ./gantt/aux.js (132 LOC moved).
  drawPostponeArrows(wrap) { _auxDrawPostponeArrows(wrap); },
  // [removed] renderArrows / renderUltra / renderEpics / renderArrowsNew —
  //   legacy modes retired. Only `detailedTasks` (default) survives in V14.
  //   bindGanttModes() in app.js silently migrates the old state values to
  //   'detailedTasks' so that bookmarked links / persisted state still work.
};

