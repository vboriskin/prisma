'use strict';
/* ============================================================
   LOADER PHRASES — V22.1

   Два набора фраз: для Сканнера команд и Чёрного дашборда.
   Вращаются каждые 2.5с; анимация fade задана в styles.css
   (.ts2-skel-phrase, .bd-loader-phrase — @keyframes pp-phrase-fade).

   startPhraseRotator(elementId, phrases, intervalMs) — универсальный
   хелпер; возвращает timerId для clearInterval в finally-блоке.
   ============================================================ */

export const SCANNER_PHRASES = [
  'Допрашиваю Jira со светом в лицо…',
  'Считаю чьи коммиты в 23:59…',
  'Ищу задачи без assignee. Их много…',
  'Будю In Progress с позапрошлой недели…',
  'Провожу внеплановый стендап с API…',
  'Проверяю кто не смержил ветку с Q3…',
  'Подслушиваю активность в тихий час…',
  'Калибрую оптимизм к реальности…',
  'Строю радар угроз по дедлайну…',
  'Ищу блокеры под конец спринта…',
  'Пью кофе, пока Jira раздумывает…',
  'Сканирую всех. Никто не скроется…',
  'Суммирую активность за 72 часа…',
  'Объясняю Bitbucket зачем мы сюда пришли…',
  'Рисую команду на карте рисков…',
  'Прощупываю PR-очередь на выходных…',
  'Ловлю отставание до того как оно выросло…',
  'Смотрю сколько часов в Code Review. Много…',
];

export const BD_PHRASES = [
  'Синхронизирую цели с реальностью…',
  'Запрашиваю Sigma. Молчит. Пробую ещё раз…',
  'Сверяю курс квартала с компасом…',
  'Ищу эпики без цели — их надо привязать…',
  'Запускаю CEO-режим на полную…',
  'Читаю между строк метрик…',
  'Собираю сигналы со всех проектов…',
  'Готовлю сводку к следующему CTO-review…',
  'Корп Jira медитирует. Ждём вместе…',
  'Разбираю стратегический туман…',
  'Связываю Delta с планами квартала…',
  'Ищу разрыв между целями и бэклогом…',
  'Прогреваю дашборд для топ-стрима…',
  'Суммирую квартальный прогресс по OKR…',
  'Привязываю эпики к горизонту…',
  'Проверяю scope-дрейф относительно целей…',
  'Считаю сколько из OKR реально движется…',
];

/**
 * Запускает ротацию фраз с fade-анимацией.
 * @param {string}   elementId   — id DOM-элемента (span/div) для вывода фразы
 * @param {string[]} phrases     — массив фраз
 * @param {number}   [ms=2500]   — интервал смены, мс
 * @returns {number}  timerId — передать в clearInterval() при остановке
 */
export function startPhraseRotator(elementId, phrases, ms = 2500) {
  if (!phrases || !phrases.length) return 0;
  const pool = phrases.slice().sort(() => Math.random() - 0.5);
  let idx = 0;

  const tick = () => {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.classList.remove('phrase-in');
    // trigger reflow для перезапуска анимации
    void el.offsetWidth;
    el.textContent = pool[idx % pool.length];
    el.classList.add('phrase-in');
    idx++;
  };

  tick(); // показать первую фразу сразу
  return setInterval(tick, ms);
}

/** @deprecated V22 — kept for legacy import compatibility */
export const LOADER_PHRASES = [...SCANNER_PHRASES, ...BD_PHRASES];

/** @deprecated V22 */
export function makePhraseFeeder() {
  let pool = [];
  return () => {
    if (!pool.length) pool = LOADER_PHRASES.slice().sort(() => Math.random() - 0.5);
    return pool.shift();
  };
}
