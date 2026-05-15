# AUDIT_QA.md — QA-аудит «Призмы»

> Этап 9 из 14. Команда: senior QA-инженеры (manual + edge cases, automation, performance, security).
> Корень: `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design_v2/`
> Карта: `AUDIT_MAP.md` (18 разделов + общее + кросс-разрезные).
> Тестовая база сейчас: **534 unit / 11 contract / 10 e2e** (см. `npm test`, `package.json`).

Менталитет: «что может сломаться». Каждая находка — гипотеза, требующая ручной/авто-проверки.
Severity: **critical** (data loss / security), **high** (UX-block / функциональный), **medium** (degradation), **low** (cosmetic / rare).
Трудозатраты: **S** (≤2 ч), **M** (полдня—день), **L** (>1 день).

---

## Часть А: Потенциальные баги по коду (66 находок)

### 1. Дашборд (`views/dashboard.js`)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| A1.1 | Дашборд | `views/dashboard.js:124` | medium | `Math.round((done/total)*100)` — при 99/100 = 99%, при 200/201 = 100% (визуально «всё готово», по факту нет). Округление вверх скрывает 1 невыполненную задачу. | Использовать `Math.floor` для KPI «КУРС КВАРТАЛА» либо показывать `99.5%` с десятой при `total<200`. | S |
| A1.2 | Дашборд | `views/dashboard.js:122,123` | medium | Регэкспы `/бэклог\|backlog/i` против `r.release` и `r.tags`. Если release пустой и tags содержат `"backlog-2025"` — попадёт в backlog-bucket. Ложное двоение для `r.tags = "backlog,frontend"`. | Различать «release===backlog» (canonical) и tag-помеченные строки; считать только release. | S |
| A1.3 | Дашборд | `views/dashboard.js:109,127` | low | `_heroCache` — это строка `"total\|done\|risky\|backlog\|unassigned\|pct"`. При совпадении кеша innerHTML не переписывается, но если меняется ТОЛЬКО состав строк (например swap risk-flag) — числа те же, контент должен бы обновиться. Сейчас не обновляется. | Включать дополнительный hash: `state._dataVersion`. | S |
| A1.4 | Дашборд | `views/dashboard.js:177,192` | medium | Пороги `Math.max(5, totalRows*0.05)` — при `totalRows=0` порог=5, любой `needsConfirm>5` пробрасывает action. При пустом плане и одном фантомном scope-edge — action не показывается; но при 4 строках с needsConfirm=4 — игнорируется, хотя это 100%. | Нормализовать процент только при `totalRows>0`, иначе показывать absolute. | S |
| A1.5 | Дашборд | `views/dashboard.js:298` | low | `_splitAssignee` сплитит по `[\|,]` — если ФИО содержит запятую («Иванов, И.И.»), split разорвёт его. RTL/спецсимволы тоже не учтены. | Использовать `; \|` как primary, или пайп. Документировать contract в RowFactory. | S |

### 2. Метрики (`views/metrics.js`)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| A2.1 | Метрики | `views/metrics.js:195` | high | `(1 - (max-min)/Math.max(1, max))*100` — при `max=0` (пустой массив или все нули) даёт `(1-0/1)*100 = 100%` «равномерности нагрузки», что вводит в заблуждение. | Возвращать `null` / `—` при `max===0`. | S |
| A2.2 | Метрики | `views/metrics.js:78,92,110,120,132,147,167,193,197,198,201` | medium | 11 мест с `Math.round(x/total*100)` без проверки `total>0` в части мест (при пустых ролях / командах деление даёт NaN на 0; уже частично защищено). Несогласованная защита. | Единый helper `pct(num, den, fallback=0)` — использовать везде. | M |
| A2.3 | Метрики | `views/metrics.js:135` | medium | `parseDate(v)` принимает любую строку и `new Date('что угодно')` — для ввода `"31.02.2026"` Chrome даёт NaN, Safari — Invalid Date, FF — другое. Расхождение по браузерам. | Жёсткий regex `^\d{2}\.\d{2}\.\d{4}$`, иначе явный fail. | S |
| A2.4 | Метрики | `views/metrics.js:301` | low | `Math.max(8, Math.round(r.total/rows.length*100))` для ширины бар-чарта — при 0/0 даёт NaN, при `total<rows.length*0.08` всегда 8% (неинформативно). | Обработать `rows.length===0`. | S |
| A2.5 | Метрики | `views/metrics.js` (overall) | medium | Все агрегаты считаются на каждый `render()`. При 5000 rows × 8 группировок — проседание UI на 200-400ms. Нет memoize по `state._dataVersion`. | Memoize агрегатов или запускать в `requestIdleCallback`. | M |

### 3. Реестр (`views/registry.js`, `rowFactory.js`, `filters.js`, `app/bulkEditPanel.js`)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| A3.1 | Реестр | `views/registry.js:618-655` | high | `deleteRow` — toast «отменить» 4500мс, но snapshot `removedSnapshot` хранит ССЫЛКУ (не клон). После удаления юзер открывает и редактирует другую строку с тем же id — `removedSnapshot` мутирует под рукой. Undo вернёт «полу-новую» строку. | Глубоко клонировать snapshot перед splice (`structuredClone(removedSnapshot)`). | S |
| A3.2 | Реестр | `views/registry.js:622,661` | high | Удалить → быстро `Ctrl+Z` И параллельно нажать «Отменить» в тосте → две операции восстановления (двойной splice). | Ловить событие undo и инвалидировать toast-onUndo. | S |
| A3.3 | Реестр | `views/registry.js:80-89` | medium | `applySorting` использует `String(va).localeCompare(...,'ru', {numeric:true})` — но сортировка по дате DD.MM.YYYY работает по строке, а не по timestamp. `01.12.2025` < `15.01.2026` будет ошибочно (потому что lexically 01<15). | Для типа `date` — отдельный path с `Date.parse`. | M |
| A3.4 | Реестр | `views/registry.js:701` | high | `JSON.parse(JSON.stringify(orig))` для копирования — теряет `Date`, `Map`, `Set`, undefined-поля и круговые ссылки. Если в строке есть Date-объект — превратится в строку, тип потеряется. | Использовать `structuredClone()` или `RowFactory.clone()`. | S |
| A3.5 | Реестр | `views/registry.js:280` | medium | `requestAnimationFrame(() => tbody.classList.add('rows-animate'))` — если пользователь переключил вкладку до анимации, `tbody` может быть удалён. Никакой проверки. | `if (!tbody.isConnected) return;`. | S |
| A3.6 | Реестр | `app/bulkEditPanel.js` (если bulk-edit) | high | При bulk-edit 1000+ строк один `state.rows[i].x = y` через Proxy = 1000 reactive-flush триггеров. Без `Reactive.silent` — infinite loop / 30sec freeze. | Обернуть bulk-mutations в `Reactive.silent`. | M |
| A3.7 | Реестр | `views/registry.js:622` | medium | `removedIndex` запоминается, но если между удалением и отменой импортировался новый CSV — индекс уже невалиден, `splice(idx>=len, 0, snap)` молча append'нет в конец. | Сохранять не индекс, а id-предшественника; искать его на restore. | S |
| A3.8 | Реестр | `filters.js` (FilterEngine) | high | Поиск по тексту — сейчас регистронезависимый? Если строка содержит эмодзи в имени — `localeCompare` может вернуть 0 при разных эмодзи (одинаковые grapheme cluster). Также нет защиты от очень длинных строк (>10000 символов в кастомном поле — `String.includes` O(n×m)). | Truncate до 1024 + ICU нормализация. | M |

### 4. Гант (`views/gantt.js`, `views/dependencyGraph.js`, `views/ganttHtmlExport.js`)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| A4.1 | Гант | `views/gantt.js:1248-1250` | critical | Прогресс-бар для in-progress задачи: `n - s) / (e0 - s)`, при `e0===s` (старт = конец, нулевая длительность) — деление на 0 → Infinity. | Guard `if (e0 <= s) return 0`. | S |
| A4.2 | Гант | `views/gantt.js:67-69,1446-1447` | high | `parseInt(sm,10)*100 + parseInt(sd,10)` для сравнения дат игнорирует год. Декабрь→январь следующего года: декабрь=1200+31=1231, январь=100+1=101 → end<now всегда. Перенос года ломает «прошёл vs впереди». | Использовать `Date.parse` или включить год в сравнение. | M |
| A4.3 | Гант | `views/gantt.js:805,856,2069,2393,2410,2436,2458,2485,2506,2518,2544` | high | Множество `new Date().toISOString()` — timestamp в UTC. При локальной таймзоне +3h юзер вечером 23.05 видит дату 24.05 в `donePills.at`. Возможна путаница: «когда сделано». | Хранить ISO + использовать local-format при отображении (`Intl.DateTimeFormat`). | M |
| A4.4 | Гант | `views/gantt.js:1438,750-755,786-788` | medium | Format `dd.mm.yy` без года при отображении — после 31.12.2025 → 01.01.2026, юзер видит «01.01» без года и думает «прошло 11 мес». | Показывать год если задача в другом году. | S |
| A4.5 | Гант | `views/gantt.js:432,443,1516` | high | Множественные `innerHTML = …` в hot-path рендере. При 500+ строках × 8 колонок — большая HTML-string каждый раз, GC-pressure. + потенциальный XSS если в `row.epic` приходит `<script>` (зависит от того, всё ли проходит через `escapeHtml`). | Аудит каждого innerHTML на escape; сравнить с `safeHtml.sht\`\``. | L |
| A4.6 | Гант | `views/gantt.js:1675,2733` | high | `cell.addEventListener('drop', async e => {...})` — async без try/catch вокруг всего тела. Если внутри throws — Unhandled Promise Rejection, drop-операция оставляет UI в inconsistent state (drop-aligned class не снят). | Обернуть тело в try/finally, в finally чистить классы. | M |
| A4.7 | Гант | `views/gantt.js:2114,2129` | medium | Двойной `requestAnimationFrame` (rAF→rAF) для отложенного arrow-rerender. Если пользователь переключил вкладку — окошко скрыто, RAF не выстреливает, при возврате — пачка отложенных рендеров. | Учитывать `document.visibilityState`. | S |
| A4.8 | Гант | `views/dependencyGraph.js` (наверняка) | high | Граф зависимостей — циклы (A→B→A). Если рендер не детектит цикл — бесконечная рекурсия в layout. | DFS с visited-set. | M |
| A4.9 | Гант | `views/ganttHtmlExport.js` | medium | HTML-export: если в данных есть `</script>` или `--` (HTML comment) — сломает экспорт. | Sanitize строк через `escapeHtml`. Тест: эпик с именем `</script><script>alert(1)`. | S |
| A4.10 | Гант | `views/gantt.js:248,456,495,1523,1567,1751,1907,2114,2319,2633` | medium | 10+ `setTimeout` в лимбо — если пользователь закрывает вкладку или переключает между Гантом и другой секцией, timer'ы остаются висящими и могут срабатывать на размонтированный DOM. | `clearTimeout` при unmount + WeakRef на DOM. | M |

### 5. История (`views/history.js`, `historyLog.js`)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| A5.1 | История | `historyLog.js` (action log) | medium | Если user генерирует 10000 действий — лог разбухает в localStorage. На QuotaExceededError записи теряются молча? | Cap на 5000 записей с FIFO. Тест: импорт XLSX 10k строк → много записей. | S |
| A5.2 | История | `views/history.js` | low | Сортировка по дате — если timestamps идентичны (быстрые клики < 1ms), порядок недетерминирован. | Стабильная сортировка + tie-breaker по `id`. | S |
| A5.3 | История | `views/history.js` | medium | Очень длинный текст в action-label (например импорт файла с именем 500 символов) — обрезается? Перенос? | Truncate в UI (CSS `text-overflow`). | S |

### 6. Таймлайн (`views/timeline.js`)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| A6.1 | Таймлайн | `views/timeline.js:168,198` | low | Конкатенация `' '+r.doneDate` — если doneDate содержит ведущий пробел или null — UI получает `'  '` или `' null'`. | `r.doneDate ? Utils.escapeHtml(r.doneDate) : ''`. | S |
| A6.2 | Таймлайн | `views/timeline.js` | medium | При большом N задач (>500) — все рендерятся одним innerHTML. Скроллы, не виртуализация. | Virtual scrolling (windowing). | L |

### 7. Сотрудники (`views/employees.js`, `rowFactory.js` EmployeeFactory)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| A7.1 | Сотрудники | `views/employees.js:540-578` | high | Удаление сотрудника + Ctrl+Z + клик «Отменить» в тосте → как и в Реестре, double-restore (см. A3.2). + если сотрудник — assignee у строк, restore не пересчитывает derived-поля. | Тот же fix + `RowFactory.updateDerived` после restore. | S |
| A7.2 | Сотрудники | `views/employees.js:570` | medium | Snapshot — ссылка, не клон (см. A3.1). При параллельном редактировании удалённого сотрудника в другой вкладке — мусор. | `structuredClone`. | S |
| A7.3 | Сотрудники | `views/employees.js:83` | low | `if (isNaN(ts)) return false;` — `ts` это `Date.parse(...)` строки от пользователя; для пустой строки возвращается NaN, для `"  "` — тоже NaN. OK, но не логируется. | OK, но добавить debug-warning при invalid date в проде. | S |
| A7.4 | Сотрудники / EmployeeFactory | `rowFactory.js` (`detectBlocked` / `detectGhost` / `detectServiceAccount`) | high | По CLAUDE.md / MEMORY.md: ФИО с суффиксом `[Х]/[X]/[В]/[B]` = заблокированы. Если detectBlocked делает `endsWith('[Х]')` без trim — один пробел в конце ФИО ломает детект. | Trim + регистр-нечувствительный regex. Тест: `"Иванов И. [Х] "`. | S |
| A7.5 | Сотрудники | `views/employees.js` | medium | Capacity = 5 default — но если у пользователя 0 backers и capacity вообще не задана, при делении нагрузки получаем `0/5=0%` (выглядит «никто не работает»), хотя данных нет. | Различать «capacity=0 явно» vs «не задано». | S |
| A7.6 | Сотрудники | `views/employees.js` table mode | medium | При 500+ сотрудников нет виртуализации; renderTable строит весь tbody. | Виртуализация или paginate. | M |

### 8. Перегрузка (`views/teamHealthDashboards.js` — BurnoutWatchtowerView)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| A8.1 | Перегрузка | `views/teamHealthDashboards.js:176` | medium | BurnoutWatchtowerView вычисляет нагрузку на основе `state.rows` × `state.employees`. Если employees пуст, а rows есть с assignees — все «orphan», но детект «перегрузки» молча возвращает 0. | Показать warning: «нет employee-таблицы». | S |
| A8.2 | Перегрузка | (там же) | low | Пороги выгорания (probably hardcoded) не учитывают часовые пояса при подсчёте «дни OT за неделю» — у работающих в +3 границы недели смещены. | Документ + конфиг порогов. | S |

### 9. Здоровье компонентов (`views/teamHealthDashboards.js` — ComponentHealthView)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| A9.1 | Здоровье компонентов | `views/teamHealthDashboards.js:129` | medium | Группировка по компоненту: если `r.component` пустой / null — попадает в bucket "—" / "Без компонента"? Если ключи "—" и "" — два разных bucket. | Нормализовать пустое к одному ключу. | S |

### 10. AI CEO (`views/aiCeoView.js`, `ai/aiCeoRenderer.js`, `ai/aiCeoFallback.js`, `ai/llmClient.js`)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| A10.1 | AI CEO | `views/aiCeoView.js:333` | high | `JSON.parse(el.dataset.filter \|\| '{}')` — если в data-filter попало `{` от LLM (галлюцинация) — JSON.parse ломается, throws SyntaxError, выходит из обработчика. Try/catch отсутствует. | try/catch + fallback `{}`. | S |
| A10.2 | AI CEO | `ai/llmClient.js:107` | medium | `text.match(/\{[\s\S]*\}/)` — greedy, при двух JSON-объектах в ответе захватывает «всё между первой и последней `}`». Если первый невалиден — провал, хотя второй валидный. | Iterate возможные `{...}` chunks. | M |
| A10.3 | AI CEO | `ai/llmClient.js:53` | medium | `signal: opts.signal \|\| AbortSignal.timeout(timeout)` — `AbortSignal.timeout` есть в Chrome 102+, FF 100+. На старых браузерах падает. Сейчас не Polly-fill. | Manual setTimeout fallback. | S |
| A10.4 | AI CEO | `ai/llmClient.js:81` | low | `if (!res \|\| !res.ok) return null` — стирает 401/403/429 без discriminacii. Юзер не понимает: токен стух vs rate-limit vs network. | Возвращать `{ok:false, status:res.status, error:'...'}`. | S |
| A10.5 | AI CEO | `ai/aiCeoFallback.js` | medium | Fallback engine при отсутствии LLM — генерирует «синтетические» рекомендации. Если данных нет совсем (state.rows=[]) — какие? Возможен output «нет рисков», что юзер прочтёт как «всё ок». | Явное состояние «нет данных для анализа». | S |

### 11. CEO-режим (`views/exec.js`)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| A11.1 | CEO-режим | `views/exec.js:199` | medium | `section.innerHTML = ` — при перезаходе на секцию все обработчики событий отвалились. Если этот режим инициализирует listener'ы — нужно проверить отсутствие «дубль-handler» при повторном render. | Audit listener-add. | S |
| A11.2 | CEO-режим | `views/exec.js` (read-only) | medium | Если read-only KPI экран показывает данные, но через debounce save — при F5 у юзера могут быть устаревшие данные. | Force load перед render. | S |

### 12. Действия (`app/actionLayer.js`)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| A12.1 | Действия | `app/actionLayer.js` | medium | Если действие = вызов LLM (`callBlockLLM`) и юзер кликает 2 раза за 100мс (двойной клик) — два запроса к LLM, оба меняют state.filters, последний выигрывает. Toast «применено» 2 раза. | Идемпотентность кнопки: disable пока in-flight. | S |
| A12.2 | Действия | `app/actionLayer.js` | medium | Action-плагины — если плагин кидает throw, общий action-bar ломается. | Sandbox per-plugin: try/catch и fallback. | M |

### 13. AI Анализ (`views/aiView.js`, `ai/aiRenderer.js`, `ai/aiContextBuilder.js`, `ai/aiFallbackEngine.js`)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| A13.1 | AI Анализ | `views/aiView.js:340,347` | high | `liveEl.outerHTML = renderBlock(enhanced)` — outerHTML заменяет элемент, но references из других мест держатся в памяти (memory leak). + `Promise.all(slice.map(refreshOne))` — без catch на каждый: если 1 throws, `Promise.all` rejects, оставшиеся в slice доходят, но следующее окно может стартануть с поломанным state. | Использовать `Promise.allSettled` + null-guard на DOM. | M |
| A13.2 | AI Анализ | `views/aiView.js:217` | medium | `root.onclick = async (e) => {...}` — async-handler без try/catch в теле. Если throw посередине — Unhandled Promise Rejection, нет toast'а юзеру. | try/catch + showToast('error'). | S |
| A13.3 | AI Анализ | `ai/aiContextBuilder.js` | high | Контекст-builder для LLM собирает state.rows / state.employees. Если 5000 rows — payload может превысить max_tokens (default 900). Без truncate — LLM возвращает 4xx или мусор. | Sample-strategy: топ-N по риску, остальное — агрегаты. | M |
| A13.4 | AI Анализ | `ai/aiFallbackEngine.js` | medium | Fallback при отсутствии токена — генерация на правилах. Если правило кидает на edge case (например, пустой `r.workEndDate`) — fallback тоже падает. Двойной fail. | Exhaustive null-checks. | M |

### 14. Точность оценок (`views/teamHealthDashboards.js` — EstimationCalibrationView)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| A14.1 | Точность оценок | `views/teamHealthDashboards.js:65` | medium | Сравнение `plannedDate` vs `actualDoneDate`. При timezone shift (см. A4.3) разница может быть ±1 день, искажая «точность». | Сравнивать по календарной дате в timezone пользователя. | S |
| A14.2 | Точность оценок | (там же) | low | Если `actualDoneDate` отсутствует у выполненной задачи — попадает в bucket «без даты», не в калибровку. Без явного indicator'а. | Counter «N задач без даты, не учтены». | S |

### 15. Документация (`views/teamHealthDashboards.js` — DocDebtConsoleView)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| A15.1 | Документация | `views/teamHealthDashboards.js:262` | medium | Stale-pages — порог свежести (probably 90 дней). При смене года (`new Date(2026,0,1) - new Date(2025,9,1)`) — корректно. Но `getTimezoneOffset` меняется DST → расчёт может сдвинуться на 1 час, на границе дней — на день. | Считать в днях через `(t1-t0)/86400000`. | S |
| A15.2 | Документация | (там же) | medium | «Ping owners» — если owner отсутствует / уволен ([Х]) — кому пинговать? | Cascade: owner → team-lead → fallback. | M |

### 16. Интеграции (`views/integrationsView.js`, `integrations/integrationsRenderer.js`, `integrations/integrationsStore.js`, `integrations/integrationsSync.js`)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| A16.1 | Интеграции | `integrations/integrationsStore.js:42` | high | `JSON.parse(localStorage.getItem(INT_SETTINGS_KEY) \|\| '{}')` — без try/catch. Corrupted JSON throws при load(), вся интеграционная панель ломается. | try/catch + reset на дефолты + warn. | S |
| A16.2 | Интеграции | `integrations/integrationsSync.js:32` | high | `JSON.parse(text)` без try в sync-pipeline. Если сервер вернул HTML (sso redirect) — throws, sync silently fails. | try/catch с указанием на причину. | S |
| A16.3 | Интеграции | `views/integrationsView.js:261-385` | medium | `res_el.innerHTML = _statusBadge(...)` — пять мест переписывают innerHTML без debounce. Быстрый клик «Test connection» → race: последний завершённый запрос побеждает, но если сначала finish first.cancel а потом второй (asyncs) — UI показывает результат предыдущего. | AbortController на test, request-id check. | M |
| A16.4 | Интеграции | `integrations/integrationsRenderer.js` | high | Settings modal — токены вводятся в `<input type="text">` или `password`? Если text — отображается на экране, при шеринге screen возможен leak. | Использовать `type="password"` + show-toggle. | S |
| A16.5 | Интеграции | `server.js` (`/api/jira/config`) | critical | Endpoints для настройки токенов — есть ли CSRF-protection / origin-check? Vanilla JS без CSRF token, если кто-то угадает endpoint и POST — может перезаписать конфиг. | CSRF token + same-origin enforcement. | M |
| A16.6 | Интеграции | `integrations/integrationsStore.js:116` | medium | `localStorage.setItem(...)` без try/catch — QuotaExceededError → unhandled. | try/catch + toast. | S |

### 17. Сканнер команд (`integrations/teamScanner2*.js`)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| A17.1 | Сканнер | `integrations/teamScanner2.js:375,411,2079` | high | Три `JSON.parse(raw)` (snapshot, prefs, audit-queue). Только snapshot обёрнут try? Audit queue (line 2079) — `queue = raw ? JSON.parse(raw) : []` без try; corrupted localStorage = throw. | try/catch + reset queue. | S |
| A17.2 | Сканнер | `integrations/teamScanner2.js:773` | high | `this._abort = new AbortController()` — если открыто два scanner'а одновременно (две вкладки), второй abort'ит первый. Race на `this._abort`. | Per-instance + reentrancy guard. | M |
| A17.3 | Сканнер | `integrations/teamScanner2.js:2409` | medium | `localStorage.setItem('q2_diag_consent_until', String(Date.now() + 24*60*60*1000))` — 24 часа в ms. Если юзер сменит системное время вперёд → consent истёк раньше. Часовых поясов нет (Date.now UTC ms — OK). | OK по логике, но при смене timezone отображение может путать. | S |
| A17.4 | Сканнер | `integrations/teamScanner2Diagnostic.js:711` | medium | `JSON.parse(JSON.stringify(obj, replacer))` для глубокого клона + scrub. На больших объектах — десятки MB heap. На циклах — throw. | structuredClone + recursive scrub. | M |
| A17.5 | Сканнер | `integrations/teamScanner2Diagnostic.js:315,389` | medium | Комментарий `JSON.parse(JSON.stringify(state)) падал TypeError на real data` — workaround есть, но при добавлении новых non-cloneable полей (Map/Set) опять упадёт. | Контракт + тест на cloneable shape. | S |
| A17.6 | Сканнер | `integrations/teamScanner2Renderer.js:192` | medium | `if (isNaN(d.getTime())) continue;` — silently skip. Если все даты невалидны — empty render без объяснения. | Counter + warning. | S |
| A17.7 | Сканнер | `integrations/teamScanner2Insights.js`, `integrations/teamScanner2Renderer.js` (~5300 строк) | high | God-module 5300 строк — высокий риск регрессий. Любое изменение хеш-таблицы статусов / классификатора затрагивает 10+ функций. | Расщепить на модули, добавить unit-тесты на каждый. | L |
| A17.8 | Сканнер | `integrations/teamScanner2.js:2079-2095` | medium | Audit-queue persists в localStorage. При quota exceeded `localStorage.setItem` throws — но catch есть `(_)`. Молча теряем queue. | Записать в `errorsLog` при quota. | S |
| A17.9 | Сканнер | `integrations/teamScanner2Renderer.js:861` | low | Комментарий: «for...of цикл устойчив к пустому массиву» — но `Math.max(...empty)` где-то рядом возвращает -Infinity (см. сам комментарий). Если этот -Infinity дальше попадает в форматирование — UI покажет `−∞`. | Guard на длину перед `Math.max`. | S |
| A17.10 | Сканнер | (Pulse pipeline `portfolioPulseModel.js` ~1900 строк) | high | Комментарий в CLAUDE.md: `_ppFindByPartial` — dev-only fallback, не «починять». Высокий риск что новый разработчик «починит» и сломает identity-deterministic attribution. | ESLint-rule + комментарий. | S |

### 18. Чёрный дашборд (`integrations/blackDashboard*.js`, `integrations/techInfo*.js`)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| A18.1 | Чёрный дашборд | `integrations/blackDashboard.js:131` | medium | `this._abort = new AbortController()` — при abort+нажатии «обновить» в той же tabи мгновенно — старый promise всё равно может вернуться позднее и записать в state. | Generation-counter check после await. | M |
| A18.2 | Чёрный дашборд | `integrations/blackDashboardRenderer.js:443,454` | low | Комментарий: «0/0 doesn't look like team did nothing» — обработано, но если goalsLinked=0 и delivered=0, показывается ли явно «нет данных»? | Подтвердить тест-кейсами. | S |
| A18.3 | Чёрный дашборд | `integrations/blackDashboardApi.js` (async-job pattern) | high | Polling status — если jobId expires server-side (>10мин), client продолжает poll'ить, получает 404 каждые N секунд, в логах шум. | TTL на client + явный fail после 10мин. | M |
| A18.4 | Чёрный дашборд | `integrations/techInfo.js`, `integrations/techInfoRenderer.js` (620 строк) | medium | TechInfo — ranges/buckets без unit-тестов? `tests/unit/techInfo.test.js` есть, но coverage? | Audit coverage. | S |

### Общее (state, storage, reactive, utils)

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| AS.1 | Storage | `dataStore.js:82,129` | critical | `localStorage.setItem(STORAGE_KEY, JSON.stringify({rows,employees,...}))` — ~500КБ-5МБ JSON. На больших проектах (>3000 rows) приближение к 5MB-quota. При QuotaExceeded — toast, но **данные в state остаются** в памяти и при F5 потеряются. | SQLite-WASM по дефолту для >1000 rows. | L |
| AS.2 | Storage | `dataStore.js:148-184` | high | `Storage.load` — пробегается по `STORAGE_KEYS` (массив legacy-ключей). Если первый corrupted, второй OK — берёт второй. Но если ВСЕ corrupted — возвращает null, и юзер начинает «с нуля» БЕЗ явного warning'а на UI (есть errorsLog, но не модал). | Show recovery dialog если найдена >0 corrupted keys. | S |
| AS.3 | Storage | `dataStore.js:66-113` | high | `Storage.save` — debounce 400мс. Если юзер делает edit + сразу F5/закрытие вкладки — `flushNow` нужно вызвать. Сейчас вызывается только в import-path. Edit-path не имеет beforeunload-flush. | `window.addEventListener('beforeunload', () => Storage.flushNow())`. | S |
| AS.4 | Reactive | `reactiveStore.js`, contracts | critical | По CLAUDE.md: mass-mutations должны быть в `Reactive.silent`. Если новый разработчик в новом view делает `state.rows.forEach(r => r.x = y)` без silent — infinite loop. ESLint-rule? | Custom ESLint rule `no-unsilent-bulk-mutation`. | M |
| AS.5 | Reactive | `state.js`, Proxy | high | Proxy не ловит deep mutation на nested-объектах если они заменяются полностью? `r.tags = [...]` ловится, `r.tags.push(x)` — зависит от реализации Proxy. | Тест: проверить ловлю push/splice. | S |
| AS.6 | Storage | `app/historyManager.js:47-60,101` | high | `JSON.parse(JSON.stringify(state))` для snapshot — теряет Date/Map/Set (см. A3.4). + heap-pressure: 20 snapshots × 5MB state = 100MB. На слабых машинах OOM. | structuredClone + lazy snapshots (только diff). | L |
| AS.7 | Storage | `app/historyManager.js:38` | medium | `limit:20` — undo/redo. Импорт XLSX → 1 чекпоинт. После 20 импортов — самый старый теряется. Юзер может не заметить и потерять «откатить вчерашний импорт». | Long-tail snapshots в IndexedDB. | M |
| AS.8 | Utils | `utils.js:96-103` | low | `escapeHtml` экранирует `'` в `&#39;` — корректно. Но не ловит ` ` <U+200B>` zero-width spaces, `\r\n` и т.д. Для XSS не критично, но в CSV-экспорт может сломаться. | Дополнительный strip control-chars helper. | S |
| AS.9 | LLM | `chat/chatUIRenderer.js:335` | high | `JSON.parse(jsonMatch[1])` — есть try, OK. Но `_validateCitationsInHtml` (line 384) делает regex.replace на innerHTML — если в строке (мутированной LLM) есть `data-cite` без закрывающего `>` — regex match невалидный, силиtly skipped, юзер не видит галлюцинационных pill'ов. | Validate перед replace. | S |
| AS.10 | Server | `server.js:235-324` | high | `_tokenCache` Map (in-memory) — без TTL eviction, только при `expiresAt` check. Если процесс работает год без рестарта и проходит 1000 токенов разных clientId — Map растёт без ограничения. | LRU + max size. | M |

### Кросс-разрезные

| № | раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|---|
| AX.1 | CSV/XLSX export | `dataStore.js:315-322` (`_scrubSecrets`) | critical | По CLAUDE.md: все exports должны проходить `_scrubSecrets`. Любой новый export-path без него = security regression. Code review недостаточен — нужен ESLint/тест. | Кастомный ESLint rule + integration test «export не содержит регексы Bearer/token». | M |
| AX.2 | Filter Engine | `filters.js`, multi-team-edit | high | При редактировании фильтра в одной вкладке + другой вкладке (через `storage` event) — нет cross-tab sync. State в памяти расходится с localStorage. | `window.addEventListener('storage', ...)`. | M |
| AX.3 | Telemetry | `integrations/telemetry.js:245` | low | `beforeunload` flush — beforeunload в современных браузерах ненадёжен (mobile especially). Использовать `visibilitychange + pagehide`. | Дополнительный `pagehide`. | S |
| AX.4 | Identity contract | `state.employees[].{email, jiraAccountId, ...}` | critical | Если в employee одно поле пустое (`bitbucketLogin=""`), но `email` совпадает с другим employee — fuzzy матч сработает? По CLAUDE.md identity-deterministic, никаких fuzzy. Тест нужен. | Регресс-тест на пустые identity-поля. | S |
| AX.5 | RowFactory.updateDerived | `rowFactory.js` | high | Если `updateDerived` throws на bad row (неполные поля) — все последующие row'ы могут не пересчитаться (зависит от вызывающего кода). | try/catch per-row в caller, errorsLog + counter. | S |
| AX.6 | Onboarding | `onboarding/onboarding.js` | medium | Demo data overlap: если у юзера уже есть state и он включает demo — `state.rows` перезаписывается? Backup? | Rollback на disable demo. | S |
| AX.7 | LLM proxy | `server.js`, `/api/llm/chat` | high | Proxy проксирует body с токеном `{ ...body, apiBaseUrl: apiBase, token }` (`ai/llmClient.js:78`) — если кто-то сможет вызвать proxy с подделанным `apiBaseUrl=evil.com`, токен утечёт на evil.com. | Whitelist apiBaseUrl на сервере. | M |
| AX.8 | Theme/CSS | `theme.css`, `styles.css` 20k LOC | medium | При переключении темы (CSS-переменные) — анимация transition на 20k элементах = jank 1-2 секунды. | `prefers-reduced-motion` + cap. | S |
| AX.9 | Mascot/Chat overlay | `app/obsidianMascot.js`, `chat/chatEngine.js` | medium | FAB-overlay поверх Гант: drag-and-drop пилюли могут попадать на FAB и не triggering drop-handler. | z-index audit + pointer-events:none на overlay при drag. | S |

---

## Часть Б: План тестирования

### Б.1 Smoke-тесты (минимальный набор перед каждым релизом, ~10 минут)

1. `npm test` → должно быть **534/11/0** (см. CLAUDE.md). Любое падение = блокер.
2. `npm run typecheck` → ошибок нет.
3. `npm run lint` → не более `--max-warnings 215`.
4. `npm start` → `http://localhost:8080`, главная страница загружается без ошибок в консоли.
5. Нажать sidebar → переключение между всеми 18 разделами без console-ошибок и без зависаний > 1сек.
6. Открыть Реестр, добавить строку, заполнить, F5 — данные сохранены (локально).
7. Открыть Гант, drag-and-drop одну задачу между релизами — change applies, undo (Ctrl+Z) откатывает.
8. Открыть Сотрудники, удалить → нажать «Отменить» в тосте — сотрудник возвращается.
9. Импорт XLSX из demo (либо из `onboarding/demoData.js` тур) — рендер без ошибок.
10. Тёмная/светлая тема — переключение без layout-shift > 100ms.

### Б.2 Критичные пользовательские сценарии (5 сквозных с пошаговыми чек-листами)

#### Сценарий 1. PM ведёт квартал: импорт → редактирование → анализ → экспорт

1. Открыть пустой проект.
2. Импортировать XLSX (тестовый файл с 200 эпиками).
3. Проверить:
   - [ ] Реестр показывает 200 строк, badge `200/200`.
   - [ ] Дашборд hero отображает % выполнения.
   - [ ] Гант разрезает по релизам 1.20/1.21/1.22.
   - [ ] Все assignees сматчены с employees (нет fuzzy).
4. Изменить scope «Требует подтверждения» → «Да» в 5 строках. Сохранить.
5. F5. Проверить, что 5 изменений сохранились (через `Storage.flushNow` или beforeunload).
6. Открыть AI Анализ → дождаться 13 блоков (concurrency=3, ~30 сек).
7. Проверить:
   - [ ] Все 13 блоков либо рендерятся (LLM ok), либо показывают fallback content.
   - [ ] Drilldown chip ведёт в Реестр с фильтром.
8. Экспорт CSV → открыть в Excel/Numbers.
9. Проверить:
   - [ ] Нет токенов / Bearer / clientSecret в файле (`_scrubSecrets`).
   - [ ] Нет formula-injection: значения с `=`, `+`, `-`, `@` экранированы префиксом.
10. Закрыть вкладку, через час открыть — данные те же.

#### Сценарий 2. Отмена удаления (toast + Ctrl+Z race)

1. Реестр, 100 строк.
2. Удалить строку #50 (правый клик → удалить).
3. Сразу же (в течение 1 сек) нажать Ctrl+Z.
4. Сразу же (через 0.5 сек) нажать «Отменить» в тосте.
5. Ожидаемо: одна реставрация. Сейчас (см. A3.2) — может быть две (дубль).
6. Проверить, что `state.rows.length === 100` и нет дублей по `id`.
7. Повторить для удаления сотрудника (см. A7.1) и для bulk-delete.

#### Сценарий 3. Drag-and-drop на Ганте через смену года

1. Загрузить план с эпиком dueDate `28.12.2025`.
2. Перетащить пилюлю эпика на январскую дату 2026.
3. Проверить:
   - [ ] `workEndDate` обновился корректно (со сменой года).
   - [ ] Прогресс-бар (если задача в работе) показывает корректный % (см. A4.1, A4.2).
   - [ ] Отображение даты включает год (если предыдущий 2025, а новый 2026; см. A4.4).
4. Проверить undo (Ctrl+Z) → дата возвращается, год корректен.
5. Тест с `01.01.2026` ↔ `31.12.2025` — обе даты не путаются местами.

#### Сценарий 4. LLM недоступен → graceful fallback

1. В настройках интеграций выставить невалидный токен (или disconnect proxy).
2. Открыть AI Анализ → 13 блоков должны показать fallback content (от `aiFallbackEngine.js`), не пустые.
3. Открыть AI CEO → fallback от `aiCeoFallback.js`.
4. Открыть Чат (FAB) → отправить сообщение → ожидаемо «временно недоступен», не зависание.
5. Проверить console: только warn, не error без обработки. Unhandled Promise Rejection — недопустимо.

#### Сценарий 5. Многовкладочное редактирование

1. Открыть `http://localhost:8080` в двух вкладках.
2. Вкладка A: добавить строку «Эпик AAA».
3. Вкладка B: добавить строку «Эпик BBB».
4. Вкладка A: F5.
5. Ожидаемо (после fix AX.2): обе строки в обеих вкладках. Сейчас — вероятно last-writer-wins, одна строка теряется.
6. Зафиксировать поведение, добавить cross-tab sync через `storage` event.

### Б.3 Регрессионный набор по разделам

Для каждого раздела (1-18) — minimum 3 теста: smoke-render, edge-data (пустой / огромный), undo/redo. Конкретно:

| Раздел | Smoke | Edge | Undo |
|---|---|---|---|
| 1. Дашборд | render с 0/100/5000 строк | hero с pct=0/100 | смена rows → undo восстанавливает % |
| 2. Метрики | render | один сотрудник всё | — |
| 3. Реестр | render + sort + filter | пустой + 5000 строк | delete → Ctrl+Z; copy → Ctrl+Z |
| 4. Гант | render по релизам | 0 эпиков; цикл зависимостей | drag → undo |
| 5. История | render | 10000 записей | — (read-only) |
| 6. Таймлайн | render | 500 doneDate | — |
| 7. Сотрудники | render + capacity | 0 employees + 200 employees | delete → undo |
| 8. Перегрузка | render | пустые data | — |
| 9. Здоровье компонентов | render | пустой `r.component` | — |
| 10. AI CEO | render fallback | LLM error path | data-filter parse |
| 11. CEO-режим | render | 0 rows | — |
| 12. Действия | render | plugin throws | — |
| 13. AI Анализ | 13 блоков concurrency | LLM partial fail | — |
| 14. Точность оценок | render | timezone shift | — |
| 15. Документация | render | owner=blocked | — |
| 16. Интеграции | settings save | corrupted JSON | — |
| 17. Сканнер | render glance | 0 employees + 1000 PRs | — |
| 18. Чёрный дашборд | render | jobId expired | — |

### Б.4 Что автоматизировать в первую очередь

**Топ-7 кандидатов** (ROI, ломкость):

1. **Storage round-trip** (save → JSON → load → equal). Уже частично есть в `tests/unit/jsonRoundTrip.test.js`. Добавить с `Date`, `Map`, `Set`, undefined.
2. **`_scrubSecrets` exhaustive** — генерировать payload со всеми вариантами `Bearer`, `token`, `apiKey` в nested-структурах + verify clean.
3. **Reactive.silent contract** — тест: bulk-mutation 1000 строк должна вызвать save **один** раз, не 1000.
4. **HistoryManager undo/redo** — fingerprint на дублирующих snapshot'ах не пушит дубли (line 80).
5. **JSON.parse без try/catch** — статический ESLint-rule (`no-unsafe-json-parse`) для всех `JSON.parse(localStorage.getItem(...))`.
6. **Date-format consistency** — тест: одна и та же дата отображается одинаково на dashboards / gantt / employees.
7. **Identity-deterministic** (CLAUDE.md контракт): тест не должен match'ить сотрудника с пустым `bitbucketLogin` по совпадению `fio`.

### Б.5 Где не хватает тестов

| Зона | Текущее покрытие | Gap | Приоритет |
|---|---|---|---|
| `views/dashboard.js` | нет (no `dashboard.test.js`) | hero-cache, action-block thresholds | high |
| `views/registry.js` | частично через `employeeAutofill` | sort/filter/copyRow/deleteRow undo | high |
| `views/gantt.js` | `ganttHtmlExport.test.js` only | drag-drop, прогресс-бар, dependency cycles | high |
| `views/aiView.js` | нет | concurrency=3, fallback path | medium |
| `app/historyManager.js` | нет | snapshot heap, fingerprint dedup | high |
| `dataStore.js` | `jsonRoundTrip.test.js` | flushNow + beforeunload integration | medium |
| `chat/chatEngine.js` | `chatActivityIntents`, `chatPrompts` | full conversation flow | medium |
| `integrations/teamScanner2Renderer.js` (5300 LOC) | один `teamScanner2Renderer.test.js` | renderer god-module — ужасный coverage | critical |
| `views/dependencyGraph.js` | нет | cycle detection | high |
| `server.js` (~6.5k LOC) | unit `serverLogger`, contract `integrations`/`llm` | CSRF / auth / rate-limit | critical |
| e2e `e2eTest.js` | 10 e2e | импорт-цикл, multi-tab, timezone | high |

---

## Часть В: ТОП-20 наиболее вероятных багов (риск × вероятность)

| Ранг | Баг | Раздел | Риск | Вероятность | Источник |
|---|---|---|---|---|---|
| 1 | **`localStorage` quota overflow** при 5000+ строк → данные не сохраняются, при F5 потеря несохранённого после toast | Storage | critical | high | AS.1 |
| 2 | **Undo + toast-undo race** при удалении → дубль-restore, два экземпляра одной строки | Реестр / Сотрудники | high | high | A3.2, A7.1 |
| 3 | **Snapshot — ссылка, не клон** в delete-undo → undo возвращает мутированную строку | Реестр / Сотрудники | high | medium | A3.1, A7.2 |
| 4 | **Gantt прогресс-бар деление на 0** при `workStartDate === workEndDate` → Infinity, NaN в стиле width | Гант | high | medium | A4.1 |
| 5 | **Year-rollover на Ганте** (декабрь→январь) → `month*100+day` обнуляется, прошедшие задачи показываются как «впереди» | Гант | high | high (ежегодно 31.12 / 01.01) | A4.2 |
| 6 | **`JSON.parse(JSON.stringify(state))` теряет Date/Map/Set** в HistoryManager → undo откатывает с потерей типов | Storage / Undo | high | medium | A3.4, AS.6 |
| 7 | **Bulk-edit без `Reactive.silent`** при 1000+ строк → infinite loop / freeze 30+ сек | Реестр / Bulk | critical | medium | A3.6, AS.4 |
| 8 | **Timezone shift в `toISOString()`** для `donePills.at`, `assignedAt` etc → дата «выполнено» сдвигается на день у пользователей вне UTC | Гант / Точность оценок | medium | high | A4.3, A14.1 |
| 9 | **`JSON.parse(localStorage)` без try/catch** в integrationsStore / teamScanner2 / scanner queue → corrupted storage = вся секция падает | Интеграции / Сканнер | high | medium | A16.1, A16.2, A17.1 |
| 10 | **LLM proxy — апrul whitelist apiBaseUrl** → возможный leak токена на attacker-controlled URL | Сервер / AI | critical | low (но критичный риск) | AX.7 |
| 11 | **Cross-tab desync** — две вкладки редактируют параллельно → last-writer-wins, потеря данных | Storage / Реестр | high | medium | AX.2 |
| 12 | **Heap-pressure undo-stack 20× state** → OOM на слабых машинах при больших проектах | Undo | high | low (но видимый jank) | AS.6 |
| 13 | **Cycle в зависимостях** (`A→B→A`) → бесконечная рекурсия в `dependencyGraph.js` | Гант | high | low | A4.8 |
| 14 | **AI-context payload >max_tokens** при 5000 rows → LLM 4xx или мусорный ответ → fallback не покрывает | AI Анализ | medium | high | A13.3 |
| 15 | **`Promise.all` вместо `allSettled`** в AI refresh-блоков → один fail обрывает оставшиеся в окне | AI Анализ | medium | medium | A13.1 |
| 16 | **Округление `Math.round` 100%** на dashboard hero при 99.5% → пользователь думает «всё готово» | Дашборд | medium | high | A1.1 |
| 17 | **God-module teamScanner2Renderer 5300 LOC** без unit-тестов на reentrancy → любая правка ломает 10+ функций | Сканнер | high | high | A17.7 |
| 18 | **HTML-export Ганта — не sanitize строки** → XSS в exported HTML, открытом в браузере | Гант | high | low | A4.9 |
| 19 | **Mascot/Chat FAB overlap drag-and-drop** на Ганте → пилюли «не дропаются» в зоне FAB | Маскот / Гант | medium | medium | AX.9 |
| 20 | **`detectBlocked` не trim'ает суффикс [Х]** → ФИО с trailing space не классифицируется как заблокированный, утечёт в attribution | Сотрудники / Identity | high | medium | A7.4, AX.4 |

---

## Что делать дальше

1. **Зафиксировать топ-5 багов** в Jira / issue tracker (1, 2, 4, 5, 7) — тут и data loss, и UX-block.
2. **Добавить регрессионные тесты** на все critical/high (ориентир — Б.4, Б.5).
3. **Custom ESLint-rules**: `no-unsafe-json-parse`, `require-reactive-silent-on-bulk`, `no-export-without-scrub`.
4. **Manual QA** проход по 5 сквозным сценариям перед каждым merge в main.
5. **Performance-budget**: уже есть `scripts/perfBudget.js`, расширить на 5000 строк.
6. **Security review**: server.js endpoints (`/api/jira/config`, `/api/llm/chat`) на CSRF / origin / rate-limit.

---

*Сгенерировано Этапом 9. Команда подтверждает: 18 разделов покрыты + общее + кросс-разрезные. Готовность: AUDIT_QA.md ready for triage.*
