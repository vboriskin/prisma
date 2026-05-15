'use strict';
/* ============================================================
   app/prizmaUI.js — Волна 2 редизайна.
   Helper'ы для page-header / hero / star-mark / toast / loaders.
   Вызываются из views/*.js при рендере главных экранов модулей.
   ============================================================ */

import { getModuleForSection, getModuleLabel, getSectionLabel } from './appSettings.js';
import { Icons } from './icons.js';

// 8 граней-лучей помечены `prizma-star-edge` + `data-edge-index` (0..7),
// чтобы CSS мог последовательно мерцать каждую грань (см. styles.css —
// keyframe `prizma-star-edge-pulse`). Анимация активируется ТОЛЬКО когда
// parent `.prizma-hero-mark` имеет `data-prizma-hero-state="off-course"`.
const STAR_SVG_INLINE = `
  <svg viewBox="0 0 120 120" aria-hidden="true">
    <g transform="translate(60,60)" fill="currentColor">
      <polygon class="prizma-star-edge" data-edge-index="0" points="0,-50 4,-4 0,0 -4,-4"/>
      <polygon class="prizma-star-edge" data-edge-index="4" points="0,50 4,4 0,0 -4,4"/>
      <polygon class="prizma-star-edge" data-edge-index="6" points="-50,0 -4,-4 0,0 -4,4" opacity="0.7"/>
      <polygon class="prizma-star-edge" data-edge-index="2" points="50,0 4,-4 0,0 4,4" opacity="0.7"/>
      <polygon class="prizma-star-edge" data-edge-index="7" points="-32,-32 -3,-5 0,0 -5,-3" opacity="0.45"/>
      <polygon class="prizma-star-edge" data-edge-index="1" points="32,-32 3,-5 0,0 5,-3" opacity="0.45"/>
      <polygon class="prizma-star-edge" data-edge-index="5" points="-32,32 -3,5 0,0 -5,3" opacity="0.45"/>
      <polygon class="prizma-star-edge" data-edge-index="3" points="32,32 3,5 0,0 5,3" opacity="0.45"/>
      <circle r="4"/>
    </g>
  </svg>
`;

/** Вернёт inline-SVG разметку звезды (всегда currentColor). */
export function starSvg() { return STAR_SVG_INLINE; }

/**
 * Empty-state glyph — приглушённая Northstar для блоков «Нет данных».
 * Заменяет legacy emoji (📁 📊 👥 🤖). Brandbook §11: «только звезда + число»;
 * empty-state поддерживает каноничный знак в opacity 0.3, не вводит новые
 * декоративные иконки.
 */
export function prizmaEmptyGlyph() {
  return `<div class="prizma-empty-glyph" aria-hidden="true">${STAR_SVG_INLINE}</div>`;
}

/**
 * Вернёт HTML-разметку page-header (eyebrow + h1 + sub + hairline).
 * Eyebrow автоматически собирается из MODULES: «{МОДУЛЬ} · {РАЗДЕЛ}».
 *
 * @param {string} sectionKey — ключ section'а (e.g. 'dashboard')
 * @param {object} [opts]
 * @param {string} [opts.title] — переопределить заголовок (default: getSectionLabel)
 * @param {string} [opts.sub]   — опциональный подзаголовок
 */
export function renderPageHeader(sectionKey, opts = {}) {
  const moduleKey = getModuleForSection(sectionKey);
  const moduleLabel = (getModuleLabel(moduleKey) || '').toUpperCase();
  const sectionLabel = (getSectionLabel(sectionKey) || '').toUpperCase();
  const eyebrow = moduleLabel && sectionLabel ? `${moduleLabel} · ${sectionLabel}` : (moduleLabel || sectionLabel);
  const title = opts.title != null ? opts.title : getSectionLabel(sectionKey);
  // Bug-fix: TDZ — раньше было `escapeHtml(sub)` ВНУТРИ инициализации `const sub`,
  // что давало ReferenceError. Используем `opts.sub` напрямую.
  const sub = opts.sub ? `<div class="prizma-page-sub">${escapeHtml(opts.sub)}</div>` : '';
  // H1 визуально скрыт через CSS (см. styles.css `.prizma-page-h1`) — eyebrow
  // уже несёт название раздела, h1 был тавтологией. В DOM остаётся как
  // sr-only, чтобы у каждой страницы оставался валидный page-heading.
  return `
    <div class="prizma-page-header">
      <div class="prizma-page-eyebrow">${escapeHtml(eyebrow)}</div>
      <h1 class="prizma-page-h1">${escapeHtml(title)}</h1>
      ${sub}
      <div class="prizma-page-hairline"></div>
    </div>
  `;
}

/**
 * Hero-блок с звездой + большой KPI + caption.
 * Используется только на главных экранах модулей (Курс/Цели).
 *
 * @param {object} cfg
 * @param {string} cfg.kpi      — текст KPI (e.g. "57.7%")
 * @param {string} cfg.caption  — caption под KPI (e.g. "КУРС КВАРТАЛА")
 * @param {Array<{num: string, label: string}>} [cfg.supporting] — supporting-числа
 * @param {string} [cfg.signal] — stripe-left signal (off-course/drift/on-course/...)
 * @param {'on-course'|'drift'|'off-course'} [cfg.state] — реактивное состояние
 *        hero-звезды. Привязывается к data-атрибуту `data-prizma-hero-state`
 *        на `.prizma-hero-mark`. На основе этого CSS подключает breathe (default,
 *        on-course), drift-tilt (drift) или signal-pulse ring (off-course).
 *        Параметр опциональный — без него hero ведёт себя как раньше (breathe).
 *        AUDIT-ART #1 dashboard.js — Hero-звезда reactive.
 */
export function renderHero({ kpi, caption, supporting = [], signal = '', state = '' }) {
  const sup = supporting.length
    ? `<div class="prizma-hero-supporting">${supporting.map(s => `
        <div class="prizma-hero-supporting-item">
          <div class="prizma-hero-supporting-num">${escapeHtml(String(s.num))}</div>
          <div class="prizma-hero-supporting-lab">${escapeHtml(String(s.label))}</div>
        </div>`).join('')}</div>`
    : '';
  // V21 π3 Ф5 — `signal` параметр добавляет stripe-left семантического цвета
  // для hero (off-course / drift / on-course / information / insight).
  // Без `signal` — hero нейтральный (как раньше). Используется в AI-CEO
  // («56» PROJECT UNDER RISK → off-course) и других местах где hero хочет
  // показать risk-status одной деталью без расцвета всего блока.
  const sigClass = signal ? ` prizma-hero-signal-${escapeHtml(signal)}` : '';
  // AUDIT-ART #1 — реактивное состояние звезды. Список разрешённых значений
  // ограничен, чтобы случайный data-атрибут не «течь» в DOM.
  const allowedStates = new Set(['on-course', 'drift', 'off-course']);
  const stateAttr = allowedStates.has(state) ? ` data-prizma-hero-state="${state}"` : '';
  return `
    <div class="prizma-hero${sigClass}">
      <div class="prizma-hero-mark"${stateAttr}>${STAR_SVG_INLINE}</div>
      <div class="prizma-hero-kpi">${escapeHtml(String(kpi || ''))}</div>
      <div class="prizma-hero-caption">${escapeHtml(String(caption || ''))}</div>
      ${sup}
    </div>
  `;
}

/**
 * Toast — нотификация в правом нижнем углу. Auto-dismiss через 5 секунд.
 *
 * @param {string} message
 * @param {'info'|'ok'|'drift'|'error'|'insight'} [state='info']
 * @param {number} [duration=5000] — миллисекунды
 */
export function showPrizmaToast(message, state = 'info', duration = 5000) {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.className = 'prizma-toast';
  el.dataset.state = state;
  el.textContent = String(message || '');
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 200ms ease';
    setTimeout(() => el.remove(), 220);
  }, duration);
}

/**
 * Inline pulse-loader (L1) — для действий 300ms-2s.
 * Возвращает HTML, не DOM-элемент.
 */
export function inlinePulseLoader(label = '') {
  const aria = label ? ` aria-label="${escapeHtml(label)}"` : '';
  return `<span class="prizma-loader-inline"${aria} role="status"></span>`;
}

/**
 * Inline brand-mark с breathe + ring (без overlay-обёртки).
 * Используется для замены legacy-spinner'ов внутри custom layout-карточек
 * (funny-loader, ob-loading, ti-loading, ts2-skeleton, pp-loader, ai-block-loading).
 *
 * Брендбук §11: «Никогда не круговой спиннер. Это не наш язык».
 */
export function prizmaLoaderMark() {
  return `<div class="prizma-loader-page-mark">${STAR_SVG_INLINE}</div>`;
}

/**
 * Page-loader (L2) — full-screen breathe-mark + ring + caption.
 * Использовать когда ожидание 2-6 сек.
 */
export function showPageLoader(caption = 'Сверяем курс…') {
  if (typeof document === 'undefined') return null;
  const existing = document.querySelector('.prizma-loader-page');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'prizma-loader-page';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `
    <div class="prizma-loader-page-mark">${STAR_SVG_INLINE}</div>
    <div class="prizma-loader-page-caption">${escapeHtml(caption)}</div>
  `;
  document.body.appendChild(el);
  return {
    setCaption(text) {
      const cap = el.querySelector('.prizma-loader-page-caption');
      if (cap) cap.textContent = String(text || '');
    },
    close() {
      el.style.opacity = '0';
      el.style.transition = 'opacity 200ms ease';
      setTimeout(() => el.remove(), 220);
    },
  };
}

/**
 * AUDIT_ARTDIRECTION #27 — маскот в hibernate-state для AI empty.
 * Возвращает HTML с `<div class="obs obs--hibernate">…</div>` — обсидиановый
 * маскот в спящем режиме (idle-кристалл со звездой Призмы внутри тела +
 * lid'ы прикрыты + aura). Брендбук §13.7: «idle 5+ мин → Hibernate».
 *
 * Используется renderEmptyState({ illustration: 'mascot-hibernate' })
 * для AI-разделов, где «Призма пока не видит курс» — правильная метафора
 * (маскот спит, а не «error state»).
 *
 * SVG копируется из app/obsidianMascot.js#RICH_OBS_SVG (нужен полный sprite,
 * иначе hib-aura/hib-star-glow не получат свои hooks). Hydrate через
 * ObsidianMascot.hydrate() при наличии window.ObsidianMascot, иначе fallback
 * на canonical-октагон без анимаций.
 */
export function mascotHibernateGlyph() {
  // Минимальный inline-SVG: octagon + inner-star + aura. CSS hib-* keyframes
  // в obsidian.css анимируют их когда у элемента есть class `obs--hibernate`.
  // Без sprite hydration get'ает плоскую разметку — лучше hydrate через
  // ObsidianMascot после mount'а.
  const fallbackSvg = `<svg viewBox="-60 -60 120 120" overflow="visible" aria-hidden="true">
    <circle class="obs-aura" cx="0" cy="0" r="42" fill="none" stroke="var(--obs-emerge-glow, #fff)" stroke-width="2" opacity="0.3"/>
    <polygon points="-22,-46 6,-50 28,-22 18,32 -10,46 -28,12 -32,-22" fill="var(--obs-body, #fff)" opacity="0.85"/>
    <polygon class="obs-inner-star" points="0,-12 1.76,-4.25 8.49,-8.49 4.25,-1.76 12,0 4.25,1.76 8.49,8.49 1.76,4.25 0,12 -1.76,4.25 -8.49,8.49 -4.25,1.76 -12,0 -4.25,-1.76 -8.49,-8.49 -1.76,-4.25" fill="var(--obs-emerge-glow, #fff)" opacity="0.22"/>
    <circle class="obs-eye obs-eye-l" cx="-9" cy="-3" r="1.6" fill="var(--obs-feature, #1A1A22)" opacity="0.4"/>
    <circle class="obs-eye obs-eye-r" cx="6" cy="-3" r="1.6" fill="var(--obs-feature, #1A1A22)" opacity="0.4"/>
  </svg>`;
  return `<div class="prizma-empty-mascot obs obs--hibernate" data-prizma-mascot="hibernate">${fallbackSvg}</div>`;
}

/**
 * Универсальный empty-state блок. Заменяет дубль разметки в views/*.js
 * («Нет данных», «Список пуст», «Ничего не найдено»).
 *
 * @param {object} cfg
 * @param {string}  cfg.title         — заголовок (обязателен по семантике).
 * @param {string} [cfg.hint]         — подсказка под заголовком.
 * @param {string} [cfg.illustration] — 'star-breathe' (default) | 'mascot-hibernate' | '' (без иллюстрации).
 *   AUDIT_ARTDIRECTION #27: 'mascot-hibernate' — маскот Обсидиан в idle/hibernate-state
 *   («Призма пока не видит курс») для AI-empty момента. Default 'star-breathe' остаётся.
 * @param {string} [cfg.action]       — готовый HTML-фрагмент с CTA-кнопкой / ссылкой.
 * @returns {string} HTML-строка.
 */
export function renderEmptyState({ title, hint, illustration = 'star-breathe', action } = {}) {
  let ill = '';
  if (illustration === 'star-breathe') ill = prizmaEmptyGlyph();
  else if (illustration === 'mascot-hibernate') ill = mascotHibernateGlyph();
  return `
    <div class="prizma-empty">
      <div class="prizma-empty-illust">${ill}</div>
      <div class="prizma-empty-title">${escapeHtml(title || '')}</div>
      ${hint ? `<div class="prizma-empty-hint">${escapeHtml(hint)}</div>` : ''}
      ${action ? `<div class="prizma-empty-action">${action}</div>` : ''}
    </div>
  `;
}

/**
 * Маппинг типа работы → имя Lucide-иконки из app/icons.js.
 * Используется gantt / metrics / picker'ами для замены legacy-emoji-prefix'а
 * (📈 📊 🚀 📝 etc.) на единообразный line-glyph.
 *
 * Ключи нормализуются к lower-case, поддержка ru-алиасов («бэкенд», «фронт»,
 * «дизайн», «аналитика», …).
 */
const _WORK_TYPE_ICON_MAP = {
  // EN
  backend:    'cpu',
  frontend:   'monitor',
  mobile:     'smartphone',
  ios:        'smartphone',
  android:    'smartphone',
  qa:         'shield-check',
  test:       'shield-check',
  testing:    'shield-check',
  design:     'palette',
  ux:         'palette',
  ui:         'palette',
  devops:     'server',
  infra:      'server',
  research:   'search',
  discovery:  'search',
  pm:         'clipboard',
  pmo:        'clipboard',
  analytics:  'bar-chart',
  ba:         'bar-chart',
  docs:       'file-text',
  doc:        'file-text',
  // RU-алиасы (pas через тэги в реестре часто в лоу-кейсе)
  'бэкенд':    'cpu',
  'бэк':       'cpu',
  'be':        'cpu',
  'фронтенд':  'monitor',
  'фронт':     'monitor',
  'fe':        'monitor',
  'мобайл':    'smartphone',
  'мобилка':   'smartphone',
  'тест':      'shield-check',
  'тестирование':'shield-check',
  'дизайн':    'palette',
  'девопс':    'server',
  'инфра':     'server',
  'аналитика': 'bar-chart',
  'исследование':'search',
  'ресерч':    'search',
  'продукт':   'clipboard',
  'документация':'file-text',
  'документы': 'file-text',
};

/**
 * Возвращает HTML-строку с line-glyph-иконкой для типа работы.
 * Если ключ неизвестен — fallback на 'tag' (нейтральный label-glyph).
 *
 * @param {string}  type            — произвольная строка («backend», «BE», «Дизайн», …).
 * @param {object} [opts]
 * @param {number} [opts.size=14]   — px квадрата.
 * @param {string} [opts.label]     — aria-label (если нужно сделать иконку семантической).
 * @returns {string} HTML.
 */
export function workTypeIcon(type, opts = {}) {
  const o = { size: 14, ...opts };
  const key = String(type || '').trim().toLowerCase();
  const iconKey = _WORK_TYPE_ICON_MAP[key] || 'tag';
  return Icons.get(iconKey, o);
}

/* Простой HTML-escape — чтобы избежать import'а Utils.js (circular). */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
