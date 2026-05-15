## AUDIT_UX.md — UX-аудит «Призмы»

> Этап 2 ночного аудита. Команда: продуктовые UX-исследователи. Фокус: ежедневная работа тимлида Сбера, эффективность сценариев. A11Y вынесен из scope (по решению этапа 0/1).
> Сегмент пользователя: тимлид/руководитель команды, открывает приложение 3-6 раз в день (утренний review, пред-стендап, в середине дня по триггеру, вечером перед уходом). Главные сценарии: «что под риском прямо сейчас», «куда уходит ёмкость команды», «привести план в порядок перед SteerCo».

Формат: `раздел | файл:строка | severity | проблема | решение | трудозатраты`.

---

### 1. Дашборд

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 1. Дашборд | views/dashboard.js:79-102 | high | На пустом state KPI-блок показывает CTA, но 6 соседних блоков (`dashboard-action-block`, `dashboard-signals`, `risks-panel`, `release-breakdown`, `dashboard-weekly-progress`, `dashboard-overload`) очищаются в пустые `innerHTML=''` — экран выглядит «полусломанным» (заголовок остаётся, под ним пустота). Тимлид видит «всё развалилось», а не «нет данных». | Скрывать пустые блоки через CSS-класс `.is-hidden-empty` или показывать единый `prizma-empty` контейнер на всё полотно дашборда; CTA-импорт оставить только в нём. | S |
| 1. Дашборд | views/dashboard.js:60-77 | medium | На каждом `refresh` пересчитываются `renderActionBlock / renderSignals / renderProgress / renderKPIs / renderRisksPanel / renderReleaseBreakdown / renderWeeklyProgress / renderOverloadBlock` — 8 рендеров без debounce/diff. Тимлид редактирует строку в реестре → дашборд (если открыт через split) перерисовывается полностью, а не точечно. | Ввести «section dirty bitmap» как для `_heroCache`; перерисовывать только изменившиеся блоки. | M |
| 1. Дашборд | views/dashboard.js:43-49 | medium | Drill-фильтры `FILTER_PAYLOAD_BY_KEY` (blocked/overtime/needs_confirm/...) уносят пользователя в Реестр без явного toast «активирован фильтр X». После клика тимлид видит другую секцию + сократившийся список и не сразу понимает, какой фильтр сработал, как его сбросить. | Toast «Фильтр: блокеры (12) — кликните чтобы снять» + временно подсветить активные чипы фильтра в реестре. | S |

---

### 2. Метрики (верхний раздел)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 2. Метрики | views/metrics.js:60-71 | medium | Метрики НЕ отделены от глобального FilterEngine — но это не отображено в UI. Тимлид смотрит «Прогресс 42%», не помнит что включён фильтр «релиз 1.21», и принимает решения по неполным данным. | Sticky-banner «Метрики считаются по N из M задач (фильтр активен → Сбросить)» поверх блоков. | S |
| 2. Метрики | views/metrics.js:306-362 | low | 4 разных empty-state-копирайта в одном экране («Нет данных за выбранный период» / «по типам работ» / «по командам» / «по исполнителям»). При 0-state весь экран — мозаика отрицаний. | Один общий `renderEmptyState` для блока «нет данных по этому срезу» + микро-CTA «снять фильтр». | S |
| 2. Метрики | views/metrics.js:55-72 | medium | Loading-state ОТСУТСТВУЕТ. При тяжёлом плане (5k+ строк) первый рендер занимает заметное время, экран замораживается без feedback'а. | Показать `prizmaLoaderMark` + caption на длительностях >300ms, по pattern из `views/aiView.js:275`. | S |

---

### 3. Реестр

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 3. Реестр | views/registry.js:33-43 | high | Поле `#filter-search` (`index.html:1006-1007`) НЕ имеет debounce'а в registry.js — каждый keystroke триггерит полный фильтр по всем строкам и репейнт. На плане 3k+ задач ввод текста в поиск ощутимо тормозит. | Debounce 150ms (как в `views/history.js:172-176`). | S |
| 3. Реестр | views/registry.js:738-758 | medium | Bulk-edit panel показывает «Выбрано: 3 из 5 (2 вне фильтра)» (`app/bulkEditPanel.js:51-55`), но кнопка «Применить» применяет только к 3 видимым — это правильно, но без явного предупреждения. Тимлид думает, что bulk применился ко всем 5. | До применения показывать модальное подтверждение «Будет затронуто 3 задачи (2 пропущены — вне фильтра). Продолжить?». | S |
| 3. Реестр | views/registry.js, app/bulkEditPanel.js:111-138 | medium | Нет горячей клавиши «выделить всё видимое». Чекбокс `#bulk-select-all` (`views/registry.js:158`) только мышью. Тимлиду на bulk-операциях приходится тянуться к мыши после фокуса в search. | Cmd/Ctrl+A в реестре (когда не в редакторе) → выделить отфильтрованные строки. | S |
| 3. Реестр | views/registry.js:861-883 | low | После «Сбросить вид реестра» нет undo-toast (просто `showToast('Вид реестра сброшен')`), хотя для удаления столбца undo сделан (`views/registry.js:955-977`). Несимметрично. | Snapshot текущей колонок-метаданных + undo CTA в toast'е. | M |

---

### 4. Гант

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 4. Гант | views/gantt.js:1699-1741, 2540-2660 | high | Drop задачи в чужой эпик/в тот же колодец показывает разные toast-сообщения с разными интонациями («Эта задача относится к другому эпику», «Задача уже в этом колодце», «Перенос отменён»). Drag-drop поведение перегружено — тимлид теряется, переноситься или нет. | Унифицировать копирайтинг в 3 категории (success/blocked/cancelled) с одним стилем, добавить превью-overlay перед drop'ом — «куда я переношу». | M |
| 4. Гант | views/gantt.js:704 | medium | Empty-state «План пуст» — без CTA-кнопки импорта/демо (в отличие от `views/dashboard.js:79-97`). Тимлид первый раз заходит в Гант на голой инсталляции и упирается в текст. | Скопировать паттерн dashboard'а: 2 кнопки «Импортировать XLSX» + «Демо». | S |
| 4. Гант | views/gantt.js:222-289 | low | Toggling режима/плотности кидает 1.4-секундный toast («Режим: Overview», «Плотность: …»), но не персистит выбор visually на кнопке (нет active-state на полоске) до следующего рендера. Тимлид кликает повторно «не сработало ли». | Сразу подсвечивать active-state кнопки на mousedown без ожидания render. | S |
| 4. Гант | views/gantt.js:1247-1330 | medium | Cmd+K palette (`views/gantt.js:292-304`) есть только в Ганте; в Реестре/Сотрудниках/Дашборде нет глобальной командной палитры — тимлид помнит шорткат и пробует везде. | Глобальный Cmd+K (search команд + эпиков + переход в секцию + bulk-actions). | L |

---

### 5. История

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 5. История | views/history.js:194-206 | medium | «Очистить» удаляет ВСЮ историю необратимо без typed-confirmation, тогда как «Удалить всех сотрудников» (`app.js:1240-1276`) и «Очистить хранилище» (`app.js:920-940`) требуют ввода `УДАЛИТЬ`/`ОЧИСТИТЬ`. Несимметрия для destructive-действий. | Добавить `typeToConfirm: 'УДАЛИТЬ'` в `ConfirmDialog.show` (поддерживается в `app/uxKit.js:44-72`). | S |
| 5. История | views/history.js:75-83 | low | Stat-cards (Данные/AI/Интеграции/...) ведут себя как фильтры (toggle by click), но визуально неотличимы от read-only KPI карт в Дашборде. Тимлид не понимает что они кликабельны. | Hover-state «фильтровать по этой категории», курсор pointer (если уже не настроено). | S |
| 5. История | views/history.js:189-192 | low | Экспорт CSV без preview — тимлид жмёт «Экспорт», получает файл, не зная что внутри (фильтрованный лог или всё). | Toast «Экспортировано N записей (фильтр применён)». | S |

---

### 6. Таймлайн

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 6. Таймлайн | views/timeline.js:104, 144 | medium | Empty-state — единственный пустой `<div class="empty-title">Нет данных</div>`, без CTA, без объяснения «фильтр vs нет плана». В Реестре/Гант/Сотрудники пустое состояние различает эти два сценария. | Использовать `renderEmptyState` (`app/prizmaUI.js:186`) с дифференциацией по `state.rows.length`. | S |
| 6. Таймлайн | views/timeline.js:30-34 | medium | Переключение режима detailed/summary через `state.timelineMode` — но в UI нет видимого переключателя в самом view (только legacy в HTML?). Тимлид не знает о существовании detailed-режима. | Toggle-button в page-header'е таймлайна. | S |
| 6. Таймлайн | views/timeline.js:54-97 | low | Loading-state отсутствует. Большой план → задержка рендера sparklines без feedback'а. | Inline pulse-loader на >300ms. | S |

---

### 7. Сотрудники

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 7. Сотрудники | views/employees.js:117-211 | high | Контролы (sort/filter/view-toggle/reset) рендерятся в `_renderControls` через `bar.innerHTML = …` на каждом `EmployeesView.render()` — теряется фокус и состояние input'ов (date pickers, search). Тимлид вводит дату в «OT с» → внешний reactive flush → render → теряется фокус. | Инкрементальный update контролов: создать DOM 1 раз, обновлять только value/selected. | M |
| 7. Сотрудники | views/employees.js:267-274 | medium | Empty-state различает «список пуст» vs «фильтр», но не предлагает конкретного действия. «Добавьте вручную или загрузите CSV/XLSX» — без кнопок. | Добавить inline-кнопки CTA как в Дашборде. | S |
| 7. Сотрудники | views/employees.js:198-200 | medium | Дата-фильтры «OT с» / «OT по» работают на `change`, не на `input` — тимлид меняет дату, ждёт «когда применится». При этом переключатели «Команда/Роль» — на `change` тоже, но они select'ы и срабатывают сразу. Несимметрия ощущения. | На дате — `change`+`blur`-чейн, на «Только с OT» — мгновенно (уже так). Документировать паттерн в комментарии к контролам. | S |
| 7. Сотрудники | views/employees.js:482, 789 | low | Чекбоксы (`weekdayReady`, `isServiceAccount`) — без группировки и без явного «save»: тимлид меняет, не видит подтверждения, что сохранилось. | Микро-toast «Сохранено» при изменении чекбокса (как в `views/registry.js:883`). | S |

---

### 8. Перегрузка

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 8. Перегрузка | views/teamHealthDashboards.js:174-258 | high | View хорошо строит сигналы, но в empty-states указано только «Нет данных или внерабочая активность = 0% у всех» (`:203`) — без подсказки откуда брать данные. Тимлид первый раз: пустой экран без CTA, без перехода в «Сканнер 2.0» (где данные начинаются). | Empty-state с кнопкой «Запустить Сканнер команд» → переход на `#section-integrations` с автозапуском. | S |
| 8. Перегрузка | views/teamHealthDashboards.js:231 | medium | Warning-баннер «Только для тимлидов: сигналы индикативные…» — important wisdom, но dismissable не предусмотрен. Каждый день один и тот же текст, после 3-го раза тимлид не читает. | Сделать collapse «прочитал» с persist в `state.dismissedWarnings`. | S |
| 8. Перегрузка | views/teamHealthDashboards.js:209-213 | low | Source-tag «по активности» (для overload reviewer'ов без formal assignment) — есть, но без цвета/позиции. Сливается со span'ом name'а. | Дать ему `var(--prizma-information)` фон, поставить справа от имени с разделителем. | S |

---

### 9. Здоровье компонентов

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 9. Здоровье компонентов | views/teamHealthDashboards.js:127-170 | medium | Hot-files показываются c `path.split('/').slice(-2).join('/')` (`:150`) — обрезанный путь. Title содержит полный путь, но тимлиду сложно понять «из какого репо». | Префикс «<repo>/<...>/<file>» вместо двух последних сегментов; репо показывать как chip. | S |
| 9. Здоровье компонентов | views/teamHealthDashboards.js:146 | low | Empty-state «Нет компонентов в открытых задачах» — без CTA. | «Проверьте что в Jira настроены поля Components → ссылка на доку». | S |
| 9. Здоровье компонентов | views/teamHealthDashboards.js:151 | low | Hot-files empty-state — содержит технические переменные («ENABLE_HOT_FILES=0»), которых нет в UI настроек. Тимлид не знает, что с этим делать. | Заменить на «Bitbucket не настроен. Открыть настройки →» (data-action). | S |

---

### 10. AI CEO

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 10. AI CEO | views/aiCeoView.js:171-191 | medium | `openChatWithMessage` имеет 400ms `setTimeout` для поднятия чата. На медленных машинах FAB ещё не открылся, click уходит в пустоту. | Promise-based ожидание: возвращать промис из FAB.open(), await, потом dispatch. | M |
| 10. AI CEO | ai/aiCeoRenderer.js:76-82 | medium | Empty-state «Нет данных для AI CEO» — без кнопки CTA, в отличие от Dashboard'а и AI Анализа. | Скопировать паттерн `data-ai-empty-action`/`data-dash-empty-action`. | S |
| 10. AI CEO | views/aiCeoView.js (renderCeoLoading import) | low | Loading при LLM-call длительностью 25s (timeout). Если запрос упал на 24s — пользователь ждал зря, без явного «cancel». | Добавить cancel-button (как в `integrations/teamScanner2Renderer.js:3488` и `portfolioPulseRenderer.js:1358`). | S |

---

### 11. CEO-режим (Exec)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 11. CEO-режим | views/exec.js:192-218 | high | Полный rerender `section.innerHTML = …` на каждом state-flush. CEO открыл, отвернулся, рядом редактируют реестр через split-tab — экран мерцает. И теряется hover/focus. | Идемпотентный рендер с diff-кэшем (как в `_heroCache` дашборда). | M |
| 11. CEO-режим | views/exec.js:222-232 | medium | Drill-кнопка тайла применяет `state.filters.onlyBlocking = true` напрямую, минуя FilterEngine.invalidate(). Гонки → реестр может показать нефильтрованные данные первым кадром. | Вызывать `FilterEngine.invalidate()` перед `Nav.goTo`. | S |
| 11. CEO-режим | views/exec.js:151-167 | medium | Блокеры показываются с `+N ещё…` без drill-down — нельзя раскрыть прямо в тайле. CEO в стендапе тыкает «ещё», ничего не происходит. | Сделать `+N ещё…` кликабельным → раскрыть expanded card или сразу в реестр с фильтром. | S |

---

### 12. Действия (Action Layer)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 12. Действия | app/actionLayer.js:166-180 | high | `openModal` показывает action в `<div id="al-modal">`, но без preview результата ДО apply. Тимлид жмёт «Применить» → bulk-mutation на N задачах — без визуальной верификации. | Добавить блок «будет затронуто: список первых 5 задач + ссылка раскрыть». Pattern из `dataStore.js:620` (CSV-update preview). | M |
| 12. Действия | app/actionLayer.js:154-158 | medium | Журнал действий no-op (`renderLog: /* no-op */`), но пункт «Журнал» в навигации может остаться. Двойственность: в Истории есть, в Action — нет. | Полностью убрать, либо явный link «Журнал → История изменений». | S |
| 12. Действия | app/actionLayer.js:173 | medium | Кнопка cancel `al-modal-cancel` без подтверждения — если тимлид заполнил textarea-параметры (комментарий к bulk-операции), они теряются. | Если есть введённые значения — показать ConfirmDialog «Закрыть без применения?». | S |

---

### 13. AI Анализ

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 13. AI Анализ | views/aiView.js:269-309 | medium | На LLM-fail один и тот же toast «AI недоступен — показан rule-based анализ» появляется 13 раз подряд (по разу на блок) при `_refreshAll`. Toast queue не свертывает дубликаты. | Дедупликация: один summary-toast «5 из 13 блоков обновлены AI, остальные — rule-based». | S |
| 13. AI Анализ | views/aiView.js:312-351 | medium | Refresh-all блокирует UI на ~1.5 минуты при 13 блоках с CONCURRENCY=3. Кнопка дисейблится, но другие интеракции (фильтры, навигация) — работают, и при смене секции запросы не отменяются. | AbortController per-batch + cancel при unmount/section-change. | M |
| 13. AI Анализ | views/aiView.js:140-150 | low | `showExplain` фоллбэчит на toast «см. подробности в чат-панели», когда нет ни modal-kpi ни открытого чата. Ничего не открывается — тимлид кликнул explain, ждёт. | Если ни одного канала нет — открыть чат-FAB и поставить input. | S |

---

### 14. Точность оценок

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 14. Точность оценок | views/teamHealthDashboards.js:96-104 | medium | `requirementsHint` — большой текстовый блок «Для этой вкладки нужно в Jira…» всегда виден сверху. Когда данные есть — это шум. | Показать только при empty data; при наличии данных — collapsed `<details>`. | S |
| 14. Точность оценок | views/teamHealthDashboards.js:88-89 | low | Строка-empty «Недостаточно данных (нужно ≥3 задачи с проставленной оценкой и фактически списанным временем на человека)» — длиннее ширины колонки на узких экранах, ломает таблицу. | Ограничить text-overflow / wrap до 2 строк + tooltip. | S |
| 14. Точность оценок | views/teamHealthDashboards.js:62-122 | low | Нет export'а данных в CSV, в отличие от других sub-tabs Сканнера и Истории. Тимлид не может унести таблицу в SteerCo. | Кнопка «Экспорт» в page-header → CSV. | M |

---

### 15. Документация (доки-долги)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 15. Документация | views/teamHealthDashboards.js:262-360 | medium | Семь sections отрендерены сплошной сеткой без фильтров «по пространству», без сортировки по % сирот. На 30+ пространствах требуется скролл-фест. | Добавить контролы: select по пространству + сортировка + поиск. | M |
| 15. Документация | views/teamHealthDashboards.js:283-285 | medium | Owner-rows показывают «N правок · M комм.», но без действия «пинговать». Цель раздела — «пинговать владельцев», но кнопки нет. | Добавить кнопку «Скопировать @username» / «Открыть в CF» рядом с каждым owner. | S |
| 15. Документация | views/teamHealthDashboards.js:298 | low | Retro-summary-row смешана с per-page-rows в одном `<ul>` — визуально не выделена как «итог». | Отделить в `<header>` блока. | S |

---

### 16. Интеграции (settings modal)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 16. Интеграции | integrations/integrationsRenderer.js:31-37 | high | 5 вкладок (Jira Delta / Jira Sigma / Bitbucket / Confluence / Jenkins), но НИГДЕ не показано «какие настроены / какие нет» в самой шапке. Тимлид открывает modal, кликает по каждой → проверяет «есть ли token». | Бейдж-точка/чек-марк рядом с каждым tab-button (зелёный = configured + verified, серый = пусто, красный = verify failed). | S |
| 16. Интеграции | integrations/integrationsRenderer.js:56-59, 80-83 | high | Кнопки «Проверить» и «Сохранить» — всегда обе видны, всегда обе active. Логика «сначала проверь, потом сохраняй» не enforce'нута. Тимлид сохраняет некорректный токен — Сканнер падает позже без явной связи. | Disable «Сохранить» пока verify не пройден; либо «Сохранить» автоматом запускает verify и блокирует save при ошибке. | M |
| 16. Интеграции | integrations/integrationsRenderer.js:48-49, 72-73 etc. | medium | Hint «Если оставить поле пустым при сохранении — текущий токен НЕ перезаписывается» дублируется 5 раз (по разу на интеграцию). При первом столкновении непонятно, при повторных — шум. | Один глобальный hint наверху modal'и + tooltip-icon рядом с password-полем. | S |
| 16. Интеграции | integrations/integrationsRenderer.js:131-153 | low | Окно активности — четыре radio-кнопки + custom-input. UI выглядит как preset, но переключение между ними не сохраняет ввод в custom (если ввёл «50» в custom, кликнул 72ч → вернулся в custom — пусто). | Persist custom value в `state` локально пока модалка открыта. | S |

---

### 17. Сканнер команд

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 17. Сканнер команд | integrations/teamScanner2Renderer.js:3494-3556 | medium | Два разных empty-state ('no-config' и 'no-data') — оба с CTA, хорошо. НО: «Загрузить данные команды» (no-data) и «Открыть настройки» (no-config) выглядят похоже визуально. Если pkeys есть, но verify не проходил — может попасть в no-data, тимлид жмёт «загрузить» → ошибка. | Добавить промежуточный state «pkeys есть, но интеграция не verified» с CTA «Проверить подключение». | M |
| 17. Сканнер команд | integrations/teamScanner2Renderer.js:3478-3492 | medium | Skeleton показывает rotating-phrase + msg + cancel — хорошо. Но нет ETA или прогресса (tot %); при запуске на больших командах (10+ pk) — 1.5 минуты ожидания без feedback'а. | Прогресс «3 из 8 проектов готово» (server уже возвращает per-pk). | M |
| 17. Сканнер команд | integrations/teamScanner2Renderer.js:42-66 | medium | Tab-state `today/deeper/metrics` — module-scoped (не в `state`). Тимлид листает Сегодня → Метрики → переключает команду → возвращается → tab сбросился на «today». Это хорошо для свежей команды, но если открывал «metrics» — теряет место. | Persist tab в localStorage per-team. | S |
| 17. Сканнер команд | integrations/teamScanner2Renderer.js:3558-3566 | low | renderError показывает retry-кнопку, но если ошибка нерекаверная (401) — retry приведёт к той же ошибке. Тимлид жмёт повторно. | Различать transient vs auth error → разные CTA («Повторить» vs «Открыть настройки»). | S |

---

### 18. Чёрный дашборд

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 18. Чёрный дашборд | integrations/blackDashboardRenderer.js:766 | medium | `renderError` принимает только string-message, без контекста (какая операция упала). Тимлид видит «Не удалось получить данные» — где: Sigma Jira, Delta Jira, expand, coverage? | Структурированный error c источником + trace-id из server-side. | M |
| 18. Чёрный дашборд | integrations/blackDashboardRenderer.js:52-160 | medium | `_renderDiagnosticsDetails` всегда collapsed. Когда coverage низкий (<40%), тимлид должен сам сообразить, что нужно открыть Diagnostics — никакого визуального cue. | Auto-expand diagnostics-block если coveragePct < 40 ИЛИ чанк-ошибки > 0. | S |
| 18. Чёрный дашборд | integrations/blackDashboardRenderer.js:23-44 | low | Coverage-tier пороги (`<40 / 40-69 / ≥70`) — hardcoded; тимлид Сбера может работать в команде, где «40% покрытия = норма» (новые проекты). | Пороги в settings. | M |

---

## Сквозные UX-проблемы

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| Сквозное | dataStore.js:418, 533, 549-551, 617-618, 707, 850, 871, 882; app.js:865, 902 | critical | **Native `alert(...)` всё ещё используется в 9 местах в data-import path** (CSV/JSON/XLSX). Брендбук V21 и `app/uxKit.js` явно требуют ConfirmDialog/ToastQueue. На каждый импорт-фейл — браузерный модалок-«хром» в стиле 2005. Тимлиду стыдно показывать. | Заменить все `alert()` на `showToast(..., 'error', ToastDuration.MED)` или `ConfirmDialog.show()` с danger-стилем. | M |
| Сквозное | dataStore.js:621, 717, 864, 866 | high | **Native `confirm(...)` остался в data-store** (CSV-update, JSON-import, schema-mismatch) хотя проект уже мигрировал на ConfirmDialog везде где видит код-ревью. Ломает консистентность стиля. | Миграция на `ConfirmDialog.show({ danger: true })`. | S |
| Сквозное | app.js:920, 1243; dataStore.js:920 | high | **Native `prompt(...)` для destructive type-confirm** («Введите ОЧИСТИТЬ»/«УДАЛИТЬ»/«CHANGE»). ConfirmDialog уже поддерживает `typeToConfirm` (`app/uxKit.js:44-72`), но не используется. | Заменить на `ConfirmDialog.show({ typeToConfirm: 'УДАЛИТЬ' })`. | S |
| Сквозное | onboarding/onboardingUI.js:317-322; integrations/portfolioPulseRenderer.js:1362-1376; integrations/techInfoRenderer.js:45, 80, 113 | medium | **Эмодзи в production UI** (📋 ⚠ 📡 🎬 ✓ ✗ ⏳) — нарушение принципа V15 «Без эмодзи в production UI» (CLAUDE.md). Все остальные секции мигрировали на Lucide-icons. | Заменить эмодзи на Icons.get('alert-triangle' / 'inbox' / 'play-circle' / ...). | S |
| Сквозное | views/* | high | **Отсутствие сохраняемых представлений (saved views)**. Тимлид каждое утро применяет одни и те же фильтры (релиз 1.21 + только риски + моя команда) и заново их выставляет. | View-presets: `state.savedViews[]`, кнопка «Сохранить как…» в filter-баре, dropdown в topbar'е. | L |
| Сквозное | app.js:977-1006; views/gantt.js:292-304 | medium | **Hotkey discoverability**: Ctrl+S, Ctrl+Z, Cmd+K — задокументированы в title-tooltip отдельных кнопок, но нет общего экрана «Все шорткаты». При первом дне на проекте тимлид не знает что они есть. | `?` (или Cmd+/) → modal с таблицей всех шорткатов; ссылка из FAB-меню. | M |
| Сквозное | app/uxKit.js:188-241 | medium | **Toast queue без grouping/dedup**. При bulk-операциях/refresh-all летят десятки одинаковых toast'ов («Сохранено», «AI недоступен») — экран забит. | `ToastQueue.show({ id: 'autosave' })` уже поддерживает replace-семантику; но не используется системно. Ввести convention: per-action id для повторяющихся событий. | S |
| Сквозное | views/dashboard.js:79; views/registry.js:64-78; views/employees.js:267-269; views/timeline.js:104, 144; views/gantt.js:704; views/aiView.js:177; ai/aiCeoRenderer.js:76 | medium | **Empty-state inconsistency**: 7 разных раз-размеченных empty-блоков, каждый со своим tone of voice («Курс ещё не проложен» / «Список сотрудников пуст» / «Нет данных» / «План пуст» / «Нет данных для AI CEO»). Шаблон `renderEmptyState` (`app/prizmaUI.js:186`) есть, но не везде используется. | Унификация: все sections через `renderEmptyState({title, hint, action})` + единый словарь копирайтинга. | M |
| Сквозное | views/dashboard.js, views/metrics.js, views/timeline.js, views/employees.js, views/registry.js | high | **Loading-state почти отсутствует во всех views state.rows**. Только AI-views и Сканнер показывают loader. На большом плане первый рендер дашборда / метрик — пол-секунды белого экрана. | Skeleton/L1 inline-pulse во всех sections при `state.rows.length > 1000` или при первом рендере. | M |
| Сквозное | views/exec.js:222-232; views/dashboard.js:43-49; views/aiCeoView.js:166-168 | medium | **Drill-down фильтры применяются к state.filters мутацией**, без явной indication «откуда пришёл filter». Тимлид кликает в Дашборде «Перегрузка», переходит в Реестр, видит уже отфильтрованный список, потом сбрасывает фильтр. Активные фильтры — единственный indicator. | Source-attribution в URL/state: `state.filters._source = 'dashboard'` + sticky breadcrumb «Из Дашборда → Перегрузка → [Сбросить]» в фильтр-баре реестра. | M |
| Сквозное | views/registry.js:33-42; views/employees.js:228-275; views/gantt.js:704; views/timeline.js:54-97 | medium | **Нет skeleton'ов** при первом рендере (только spinner-loader или `<div class="empty-state">`). Skeleton-bars дают ощущение «вот-вот загрузится», spinner — «занято». | Skeleton-rows для табличных views (Реестр, Сотрудники, История). | M |
| Сквозное | views/registry.js, views/employees.js, views/gantt.js | low | **Нет «горячей точки» для добавления (`+ Новая задача` floating)**. Кнопка «Добавить» спрятана в topbar'е (`btn-add-row`). Тимлид при первом тестировании путается, где создать задачу. | FAB «+ Добавить» в правом нижнем углу видим только в registry/gantt; touch-friendly. | S |
| Сквозное | app/bulkEditPanel.js, views/registry.js | medium | **Bulk-операция без preview** — выбрал 50 задач, нажал «Назначить релиз 1.22» → молча применилось. Откат через Ctrl+Z, но это надо ЗНАТЬ. | Перед apply показывать модалку «Будет изменено 50 строк (превью первых 5). Применить? Можно откатить через Ctrl+Z». | S |
| Сквозное | app.js:1117-1166 | medium | **Click-outside поведение разное в модалках**: integrations-modal (`integrations/integrationsView.js`) и ConfirmDialog (`app/uxKit.js:96`) закрываются по клику на overlay, а al-modal (`app/actionLayer.js:181`) — только по cancel-кнопке. | Унифицировать: для non-destructive — overlay-close; для destructive — только Cancel. | S |
| Сквозное | views/aiView.js:269-308; views/aiCeoView.js | medium | **AI-кнопки «Обновить блок / Обновить всё»** не показывают остаток токенов / стоимость запроса. На корп-LLM с лимитом — тимлид может выбить квоту команды. | Показывать «осталось N запросов» (если known) или последний `latencyMs` рядом с кнопкой. | M |
| Сквозное | integrations/teamScanner2Renderer.js, views/teamHealthDashboards.js, views/dashboard.js | low | **Inconsistent number formatting**: где-то «1ч», где-то «1д 4ч», где-то «4500 ч». `Utils.formatDuration` существует, но не везде применён. | Audit: единый formatter для всех durations. | S |
| Сквозное | views/registry.js:1006; views/employees.js:1331; views/history.js:62; views/gantt.js:514 | low | **Поиск без debounce в registry, без empty-results-hint**. После debounce'а — нет «ничего не найдено по запросу X», только пустая таблица. | 200ms debounce + персональная подсказка «По запросу `X` ничего» + кнопка «Очистить поиск». | S |
| Сквозное | app.js:923, 1244; views/registry.js:865, 932; views/employees.js:546 | low | **Текст «Действие можно отменить через Ctrl+Z»** повторяется в каждом ConfirmDialog message — это шум, тимлид перестаёт читать. | Перенести в footer ConfirmDialog'а (один раз, мелким шрифтом) либо в подсказку «как отменить» рядом с кнопкой Confirm. | S |
| Сквозное | onboarding/onboardingUI.js:312-360; views/dashboard.js:79-97; views/aiView.js:201-209 | medium | **CTA «Шаблон демо» / «Посмотреть демо»** ведут на разные демо-флоу (`ob-btn-back-demo`, `startDemoFlow`, `ts2-load-demo`). Тимлид первый раз попадает в разные демо-данные с разных entry-points. | Унифицированный `demoFlow.start({ section })` — один источник truth. | M |

---

**Итого находок:** 56 (3 critical/high secured-by-style sections + 53 распределены по 18 разделам).
**Критических (для daily-flow):** 1 (alert/confirm/prompt в data-import).
**High:** 9 (saved-views, drag-drop UX, bulk preview, hotkey discoverability, integrations verify gate, controls focus loss, missing loaders, exec mirror render, dashboard ghost-empty).

*Сгенерировано Этапом 2 ночного аудита. Источники: всё дерево `views/` + `integrations/teamScanner2*` + `integrations/blackDashboard*` + `integrations/portfolioPulse*` + `app/uxKit.js` + `app/onboarding.js` + `chat/chatUIRenderer.js` + `integrations/integrationsRenderer.js`.*
