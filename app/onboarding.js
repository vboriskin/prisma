'use strict';
/* ============================================================
   Onboarding — legacy 24-step product tour (overlay + highlight).
   --
   Walks through every section of the app, highlighting the relevant
   element. Used both at first run (via welcome screen "Пройти обучение"
   button) and on demand from settings.

   Cross-module deps via window globals (avoid import cycles with App):
     window.Nav  — navigates to the section before highlighting.
   ============================================================ */

export const Onboarding = {
  _step: 0,
  _steps: [
    { section:null,        navKey:null,         selector:'#topbar',                                 title:'1. Шапка',                     text:'Кнопка «Сохранить» пересчитывает риски и сохраняет данные в браузере. Кнопка «Файлы» — импорт XLSX/CSV и экспорт. ⚡ — режим симуляции (без сохранения). ⚙ — настройки.' },
    { section:null,        navKey:null,         selector:'#btn-toggle-filters',                     title:'2. Фильтры',                   text:'Нажмите кнопку «Фильтры» чтобы показать панель фильтров. Фильтруйте по команде, scope, релизу, исполнителю. Пресеты — готовые наборы фильтров.' },
    { section:'dashboard', navKey:'dashboard',  selector:'#dashboard-kpi',                          title:'3. Дашборд — KPI',             text:'KPI-карточки показывают общую статистику: задач в работе, блокеры, риски, процент выполнения. Кликните на карточку для подробностей.' },
    { section:'dashboard', navKey:'dashboard',  selector:'#risks-panel',                            title:'4. Дашборд — Риски',           text:'Панель рисков автоматически выделяет проблемные задачи: без релиза, с подтверждением в релизе, блокеры. Обновляется при каждом сохранении.' },
    { section:'registry',  navKey:'registry',   selector:'#registry-table',                         title:'5. Реестр — таблица',          text:'Таблица всех задач. Кликните ячейку для редактирования. Правый клик по строке — контекстное меню (копировать/удалить). Столбцы можно перетаскивать, закреплять, скрывать.' },
    { section:'registry',  navKey:'registry',   selector:'#section-registry .section-header-actions', title:'6. Реестр — инструменты',   text:'«+ Строка» — добавить строку после выбранной. «Столбцы» — скрыть/показать колонки. ⚙ Настройки — закрепить, переименовать, добавить столбцы. ⛶ — полный экран.' },
    { section:'gantt',     navKey:'gantt',      selector:'.btn-group',                              title:'7. Гант — режимы',             text:'«Детальный по задачам» — строки с типами работ, drag-and-drop между колодцами релизов. «Со стрелками» — расширенный вид с зависимостями между эпиками.' },
    { section:'gantt',     navKey:'gantt',      selector:'#gantt-wrap',                             title:'8. Гант — детали',             text:'Перетаскивайте задачи между колодцами релизов. Нажмите ▾ рядом с командой чтобы свернуть её строки. ⚠ рядом с задачей — исполнитель не назначен.' },
    { section:'kanban',    navKey:'kanban',     selector:'#kanban-board',                           title:'9. Канбан',                    text:'Карточки задач по релизам. Перетащите карточку для смены релиза. Цветная левая полоса: красная — блокер, оранжевая — риск, жёлтая — изменено.' },
    { section:'timeline',  navKey:'timeline',   selector:'#timeline-wrap',                          title:'10. Таймлайн',                 text:'Диаграммы распределения задач по стадиям: количество, типы работ, статусы scope. Два режима: Сводный и Детальный.' },
    { section:'insights',  navKey:'insights',   selector:'#insights-wrap',                          title:'11. Инсайты',                  text:'Автоматический анализ: задачи без релиза, перегруженные релизы, сигналы блокировки. Каждый сигнал ссылается на конкретные задачи.' },
    { section:'integrations',navKey:'integrations', selector:'#section-integrations',                title:'13. Интеграции',               text:'Подключение к Jira, Bitbucket и Confluence. Две под-вкладки: «Overview» — ваши задачи + Plan vs Reality. «📡 Сканнер команд» — операционный дашборд по project keys: участники, что делали вчера, висящие задачи, инсайты.' },
    { section:'ai',         navKey:'ai',        selector:'#section-ai',                             title:'14. AI Анализ',                text:'13 AI-блоков: Project Health, Forecast, Bottlenecks, Anomalies, Quality, Risk Narrative, Prioritization, Replanning, Recommendations и др. Кнопка «↺ Обновить всё» запускает LLM-обогащение поверх rule-based fallback.' },
    { section:'ai-ceo',     navKey:'ai-ceo',    selector:'#section-ai-ceo',                         title:'15. AI CEO',                   text:'CEO-уровень: Project Health Brain, If Nothing Changes, You’re Lying To Yourself, Save The Release. Read-only — действия только через preview + подтверждение.' },
    { section:'employees',  navKey:'employees', selector:'#section-employees',                      title:'16. Сотрудники',               text:'Список сотрудников с ролями, командами, овертайм-днями. «+ Сотрудник» / импорт XLSX-CSV / 📄 Шаблон — скачать пустой XLSX. Сводные карточки сверху.' },
    { section:'summary',    navKey:'summary',   selector:'#section-summary',                        title:'17. Сводная для CEO',          text:'Готовый управленческий отчёт. Два режима: «Краткая» и «Совсем красиво». Можно экспортировать.' },
    { section:'metrics',    navKey:'metrics',   selector:'#section-metrics',                        title:'18. Метрики',                  text:'Графики и распределения по релизам, командам, типам работ.' },
    { section:'diagnostics',navKey:'diagnostics',selector:'#section-diagnostics',                   title:'19. Диагностика',              text:'Что найдено в импортированных файлах, какие колонки определены, предупреждения и ошибки парсинга.' },
    { section:'actions',    navKey:'actions',   selector:'#section-actions',                        title:'20. Action Layer',             text:'Каталог массовых действий: назначить релиз, сменить scope, пометить готовыми, авто-распределение, очистка флагов риска. Каждое действие — preview перед применением.' },
    { section:'history',    navKey:'history',   selector:'#section-history',                        title:'21. История изменений',        text:'Полный аудит-лог всех действий: импорты, сохранения, AI-запросы, синхи интеграций, навигация. Фильтры по категориям, экспорт в CSV, очистка.' },
    { section:null,         navKey:null,        selector:'#btn-app-settings',                       title:'22. Настройки',                text:'⚙ — единая точка входа в настройки. 4 вкладки: Интерфейс (порядок и видимость вкладок и блоков), Интеграции (Jira / BB / CF endpoints + токены), LLM (модель / промпты / контекст), Хранилище (localStorage / SQLite).' },
    { section:null,         navKey:null,        selector:'#btn-theme-toggle',                       title:'23. Тема и режимы',            text:'🌙/☀️ — светлая / тёмная тема. ⚡ — режим симуляции (изменения не сохраняются — для экспериментов). 🌀 (если включено) — индикатор демо-данных.' },
    { section:'dashboard',  navKey:null,        selector:'#assistant-fab',                          title:'24. AI-помощник',              text:'Кнопка в правом нижнем углу открывает чат-ассистента. Задавайте вопросы о данных на русском: «Какие задачи без релиза?», «Что в зоне риска?», «Перенеси задачу X в 1.22». Ответы группируются по интентам: 🔍 Поиск / 💡 Объяснение / ⚡ Действие / 📊 Анализ / 🗺 План / 📋 Отчёт.' },
  ],
  init() {
    // btn-onboarding is now owned by V11 onboarding (shows welcome screen)
    document.getElementById('onboarding-next')?.addEventListener('click', () => Onboarding.next());
    document.getElementById('onboarding-prev')?.addEventListener('click', () => Onboarding.prev());
    document.getElementById('onboarding-skip')?.addEventListener('click', () => Onboarding.end());
    document.querySelector('.onboarding-backdrop')?.addEventListener('click', () => Onboarding.end());
  },
  start() { Onboarding._step = 0; document.getElementById('onboarding-overlay')?.classList.remove('hidden'); Onboarding.show(0); },
  show(idx) {
    const steps = Onboarding._steps;
    if (idx < 0 || idx >= steps.length) { Onboarding.end(); return; }
    Onboarding._step = idx;
    const step = steps[idx];
    document.getElementById('onboarding-title').textContent = step.title;
    document.getElementById('onboarding-text').textContent  = step.text;
    document.getElementById('onboarding-step-badge').textContent = `${idx + 1} / ${steps.length}`;
    document.getElementById('onboarding-prev').disabled = idx === 0;
    document.getElementById('onboarding-next').textContent = idx === steps.length - 1 ? 'Завершить' : 'Далее →';
    const doHighlight = () => {
      const target = document.querySelector(step.selector); if (!target) return;
      target.scrollIntoView({ block: 'center', behavior: 'instant' });
      requestAnimationFrame(() => requestAnimationFrame(() => { Onboarding._positionHighlight(target); }));
    };
    // Nav lives on window (registered by app.js); avoids a circular import.
    if (step.section) { window.Nav?.goTo(step.section); setTimeout(doHighlight, 60); } else doHighlight();
  },
  _positionHighlight(target) {
    const highlight = document.getElementById('onboarding-highlight');
    const tooltip   = document.getElementById('onboarding-tooltip');
    if (!highlight || !tooltip) return;
    const r = target.getBoundingClientRect(); const pad = 8;
    const hl = { left: r.left-pad, top: r.top-pad, width: r.width+pad*2, height: r.height+pad*2 };
    highlight.style.left = `${hl.left}px`; highlight.style.top = `${hl.top}px`;
    highlight.style.width = `${hl.width}px`; highlight.style.height = `${hl.height}px`;
    const tipW=320, tipH=200, gap=14;
    let tipTop = hl.top + hl.height + gap;
    if (tipTop + tipH > window.innerHeight - 12) tipTop = hl.top - tipH - gap;
    tipTop = Math.max(12, tipTop);
    const tipLeft = Math.max(12, Math.min(hl.left, window.innerWidth - tipW - 12));
    tooltip.style.left = `${tipLeft}px`; tooltip.style.top = `${tipTop}px`;
  },
  next() { if (Onboarding._step >= Onboarding._steps.length - 1) { Onboarding.end(); return; } Onboarding.show(Onboarding._step + 1); },
  prev() { Onboarding.show(Onboarding._step - 1); },
  end() {
    document.getElementById('onboarding-overlay')?.classList.add('hidden');
    const hl = document.getElementById('onboarding-highlight');
    if (hl) { hl.style.left=''; hl.style.top=''; hl.style.width=''; hl.style.height=''; }
  },
};

if (typeof window !== 'undefined') window.Onboarding = Onboarding;
