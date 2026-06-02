# Аудит таблицы сотрудников: реальные баги, edge cases и состояния

**Эксперт:** QA-инженер с фокусом на edge cases в data-driven UI и race conditions
**Дата:** 2026-06-02

## Резюме

В коде есть несколько багов с реальными последствиями для UX, а не просто
«мог бы быть лучше». Самые серьёзные: некорректный конвертер `seconds → hours`
в payload LLM (×10 от реального значения), полностью сломанный share-link
после canonical-формата (новый URL не парсится), некорректная классификация
диф-бэйджа `idle → stop` как улучшения, накопление эффектов TZ-skew между
сервером и браузером, и «всегда false» индикатор устаревших данных
в нарративе. Несколько менее критичных багов вокруг team-median'ов,
неконсистентного состояния panel'и при search-фильтре, неинвалидируемого
search-cache на смену команды и leak'ов document-level listeners при rapid
clicking сценариях.

## Находки

### 1. AssistantLLM: конвертер `originalEstimateSeconds → originalEstimateH` делит на 360, должен на 3600

**Описание:** `teamScanner2AssistantLLM.js:351-352`:
```js
if (Number(it.originalEstimateSeconds) > 0) out.originalEstimateH = Math.round(it.originalEstimateSeconds / 360) / 10;
if (Number(it.timeSpentSeconds) > 0)        out.timeSpentH        = Math.round(it.timeSpentSeconds / 360) / 10;
```
Делит секунды на 360 (×10 ошибка). Для задачи с оценкой 4ч (14400с)
получаем `14400/360 = 40 → /10 = 4`. Случайно правильно для round(integer*10),
но `Math.round(14400/360)/10 = Math.round(40)/10 = 4` — это совпадение.
Для оценки 30 минут (1800с): `Math.round(1800/360)/10 = 5/10 = 0.5`. Тоже
случайно правильно. Для 47 минут (2820с): `Math.round(2820/360)/10 =
Math.round(7.83)/10 = 8/10 = 0.8` — реально 47/60 ≈ 0.78. Близко. Так что
*для целых десятых часа* арифметика случайно сходится. Но если задача
имеет оценку 27 минут (1620с): `Math.round(1620/360)/10 = Math.round(4.5)/10
= 5/10 = 0.5` — реально 0.45. Округление через `*10` маскирует ошибку, но
ломает её для дробных значений (например `Math.round(45/3600*10)/10` дало
бы 0.0; через `/360`: `Math.round(45/360)/10 = 0/10 = 0`). И семантически
формула неверна (магическая константа без комментария).

**Симптом:** LLM получает значения, которые при некоторых граничных
дробных оценках округляются неверно. Тимлид смотрит выдачу — «4ч на 30-мин
задачу» при оценке 0.45ч. Хуже того — формула «работает по совпадению»,
если кто-то починит округление (например, на `.toFixed(2)` без `*10`),
все часы внезапно станут ×10.

**Воспроизведение:**
1. Создать задачу в Jira с originalEstimate = 45 минут (2700 секунд).
2. Сотрудник её активно ведёт (попадает в `issuesNow`).
3. Открыть detail panel → «Сводка ассистента» → раскрыть.
4. Inspect payload в `/api/llm/chat` body → `originalEstimateH: 0.8`
   вместо 0.75 (45/60). С округлением скрыто, но при подсчёте за рабочий
   день ошибка накапливается.

**Зачем чинить:** числовые input в LLM-промпт прямо влияют на «План
сегодня» и оценочные строки в Plan'е. Корректность данных — фундамент
для всей AI-логики.

**Как чинить:** заменить на `it.originalEstimateSeconds / 3600`, окрулить
`*10`/10 или через `.toFixed(1)`. Покрыть unit-тестом — три кейса:
полный час, дробный час (0.5, 0.75), zero.

**Критичность:** high (ломает корректность LLM input).
**Сложность:** low.
**Ценность:** high.

---

### 2. Share-link auto-open не работает после canonical-формата URL

**Описание:** `teamScanner2.js:778-805` `_consumeShareLink` парсит только
legacy формат:
```js
const match = m.match(/^#scanner2\/employee\/(.+)$/);
```
А `_updateShareLinkHash` (line 847-849) пишет **новый** canonical:
```js
const newHash = this._expandedKey
  ? `#scanner2?focusKind=employee&focusId=${encodeURIComponent(this._expandedKey)}`
  : '#scanner2';
```
Когда А копирует ссылку из открытой панели → отправляет Б → Б открывает,
hash `#scanner2?focusKind=employee&focusId=иванов%20и.и.` — regex не
матчит → silent no-op, panel не открывается.

**Симптом:** Тимлид Маxim (async workflow в карточке аудита) отправляет
коллеге линк — у того открывается команда, но без подсветки сотрудника.
Maxим: «он что слепой? я ему ссылку на конкретного человека послал».

**Воспроизведение:**
1. Открыть detail panel любого сотрудника.
2. Скопировать URL из адресной строки (нажать кнопку Share или Ctrl+L → Ctrl+C).
3. Открыть в новой вкладке.
4. Сканер открывается, но `_expandedKey === ''`. Панель не открывается.

**Зачем чинить:** share-link заявлен как pilot-feature (Maksim из async-команды);
сломан = feature мёртвый.

**Как чинить:** в `_consumeShareLink` добавить второй парсер для canonical:
```js
const canonical = m.match(/^#scanner2\?(.+)$/);
if (canonical) {
  const params = new URLSearchParams(canonical[1]);
  if (params.get('focusKind') === 'employee') {
    const id = params.get('focusId');
    if (id) { /* same flow as legacy */ }
  }
}
```
Также: переиспользовать существующий `app/router.js` парсер, как
комментарий обещает в `_updateShareLinkHash`.

**Критичность:** high (заявленная фича не работает).
**Сложность:** low.
**Ценность:** medium.

---

### 3. Diff-badge `idle → stop` отрисовывается как улучшение (↑ up arrow)

**Описание:** `teamScanner2RendererPersonRows.js:273-286`:
```js
const order = { stop: 0, watch: 1, moving: 2, idle: -1 };
const prevRank = order[prevGroup];
const currRank = order[currentGroup];
if (currRank > prevRank) { arrowIcon = 'arrow-up-right'; cls += ' ts2-row-diff-up'; }
if (currRank < prevRank) { arrowIcon = 'arrow-down-right'; cls += ' ts2-row-diff-down'; groupDropped = true; }
```
Маппинг ранков: `stop=0, watch=1, moving=2, idle=-1`. Это значит, что `idle`
имеет ранк **ниже** stop (наихудший ранк). Любой переход `idle → X` (где
X ∈ {stop, watch, moving}) даёт `currRank > prevRank` → стрелка вверх,
класс `ts2-row-diff-up`. Но `idle → stop` — это **регрессия**: вчера человек
был тих (отпуск/больничный/просто без активности), сегодня у него висят
блокеры. Это должно показываться как drop (down + pulse-attention).

**Симптом:** Тимлид смотрит на роster утром: «↑ из тихо → стоп» с зелёной
up-стрелкой выглядит как «человек вернулся к работе». Реально человек
вышел с больничного И у него скопились блокеры — двойная атака, требует
внимания, а рендер успокаивает.

**Воспроизведение:** Сложно симулировать вручную, нужно:
1. День 1 (snapshot): человек в idle (нет активности, нет блокеров).
2. День 2 (сегодня): у того же человека classifyPerson === 'stop'
   (есть blockers, today === 0). Это возможно если за ночь Jira
   создала задачи с overdue dwell-time на его имя.
3. Открыть Сканер: на строке `↑ тихо` зелёная стрелка вверх вместо красной.

**Зачем чинить:** дезинформирует тимлида в самом критичном сегменте —
кто требует разговора сегодня.

**Как чинить:** переосмыслить ранг-функцию по «требуется ли внимание»:
`stop=3, watch=2, moving=1, idle=0`. Тогда `currRank > prevRank` = stuck
got worse. Альтернатива: explicit transition matrix:
```js
const TRANSITION_DIRECTION = {
  'idle→stop':   'down',
  'idle→watch':  'neutral',
  'idle→moving': 'up',
  'moving→idle': 'neutral', // отпуск
  'stop→idle':   'up', // были блокеры, теперь даже не в Jira (closed?)
  // и т.д.
};
```

**Критичность:** high (correctness в high-attention zone).
**Сложность:** low (минимальный fix — переписать order map).
**Ценность:** high.

---

### 4. `composePersonNarrative.isStaleData` всегда `false` (читает поле с participant, а оно на model)

**Описание:** `teamScanner2Insights.js:1052-1053`:
```js
const fetchedAtMs = p._fetchedAtMs || 0;
const isStaleData = fetchedAtMs > 0 && (now - fetchedAtMs) > 24 * HOUR_MS;
```
`_fetchedAtMs` пишется в `_fetchAndRender` на `this._model._fetchedAtMs`
(L1564) и `loadDemo` на `m._fetchedAtMs` (L709). На уровне participant
никто его не выставляет.

Результат: `fetchedAtMs === 0` всегда → `isStaleData === false` всегда.

**Симптом:** В нарративе detail panel'и индикатор «устаревшие» никогда не
загорается. Тимлид, открывший вчерашний кэш (если такое возможно через
restoring state), не получает предупреждения.

**Воспроизведение:**
1. Сложно — текущая инвалидация cache по 5-минутному TTL вообще не
   позволяет показать данные старше 24ч.
2. Кодом: положить `breakpoint` в L1053, ни в одном открытии panel'и
   условие не выполнится.

**Зачем чинить:** dead UI signal вводит ложное чувство безопасности.
Либо чинить (читать `model._fetchedAtMs` через ctx), либо удалить вообще.

**Как чинить:** передавать `fetchedAtMs` через ctx в `composePersonNarrative(p, ctx)`,
или читать из закрытой переменной `model` (но требует другой сигнатуры).
Простейший вариант — выставлять `p._fetchedAtMs = model._fetchedAtMs` после
enrichment в orchestrator'е.

**Критичность:** medium (silent regression).
**Сложность:** low.
**Ценность:** low (фича не критична).

---

### 5. Team-median'ы в роster читают несуществующее поле `hoursLoggedToday`

**Описание:** `teamScanner2RendererPersonRows.js:106`:
```js
const _hrArr  = parts.map(pp => Number(pp.hoursLoggedToday || 0));
```
Поле на participant называется `loggedTodaySec`, а не `hoursLoggedToday`.
Видно по rows-template L308: `hoursToday = fmtHours(p.loggedTodaySec || 0)`.

Результат: `_hrArr` целиком из `Number(undefined || 0) = 0`. `tm.hours = 0`
всегда. Tooltip строки: «Медиана команды: 0ч» — для всех команд независимо
от реальной нагрузки. И поскольку `tm.hours > 0` дополнительно гейтит
условие `×N от среднего`, ratio-бэйдж никогда не показывается для часов.

**Симптом:** Тимлид смотрит tooltip «N часов · Медиана команды: 0ч» —
«у нас все по 6 часов в день, а медиана 0? Глюк, не доверяю числам».
Также не работают amber-метки overhour.

**Воспроизведение:**
1. Открыть Сканер с любой настроенной командой где есть worklog'и.
2. Hover на счётчик `Nч` в роster row.
3. В tooltip: «Медиана команды: 0ч» — для всех строк.

**Зачем чинить:** медиана — заявленная фича (per-person comparison
tooltip).

**Как чинить:**
```js
const _hrArr = parts.map(pp => Number(pp.loggedTodaySec || 0) / 3600);
```

**Критичность:** low (cosmetic, no data corruption).
**Сложность:** low.
**Ценность:** medium.

---

### 6. Search-cache не учитывает смену команды (false-positive hit при одинаковом length/first/last)

**Описание:** `teamScanner2.js:180-202`. `_filterParticipantsByQuery`
строит `dataKey` из `length + first.key + last.key`. Но cache shared
между переключателями команд (multi/team) и pk-filter'ами. Если две
команды имеют одинаковую длину participants и совпадают first/last key —
cache hit вернёт результат предыдущей команды.

Особенно опасно: после `_applyPkFilter` (single team view) переключение
команды через kebab `Сравнение команд` или segmented-tabs делает
`filteredModel.participants` другой массив, но `_searchCacheKey` может
не измениться если длины совпали.

**Симптом:** Тимлид Команды А ищет «Петров», находит. Переключается
на Команду Б того же размера, начинает печатать «Петр» в search —
видит результат из Команды А (без Петрова в Б).

**Воспроизведение:**
1. Команда A с 12 участниками; первый по сортировке (alphabet) — `Аркадий`,
   последний — `Юра`.
2. Команда B с 12 участниками; первый — `Аркадий` (бывает, имена пересекаются),
   последний — `Юра`.
3. В A ввести в search «петр» → возвращает [Петров].
4. Переключить на B → search ещё показывает [Петров] (cache hit).
5. Стереть → ввести снова «петр» → видим Петрова из A в результатах B.

**Зачем чинить:** false-positive data display.

**Как чинить:** включить projectKeys-фингерпринт в `dataKey`:
```js
const pksKey = (model?.projectKeys || []).slice().sort().join(',');
const dataKey = pksKey + ':' + list.length + ':' + ...;
```
Или сбрасывать cache в `_setSelectedTeam` / `_setMultiView` явно.

**Критичность:** medium (rare but real correctness bug).
**Сложность:** low.
**Ценность:** medium.

---

### 7. TZ-skew: heatmap row-strip использует browser TZ, timelineToday собран на server TZ

**Описание:** Renderer'ная функция `bucketByHour` (`teamScanner2RendererCommon.js:133-145`):
```js
const d = new Date(t);
...
const h = d.getHours();
```
Берёт **browser-local** hour. А `timelineToday`/`timelineYesterday`
буженуются на сервере через `todayStart` (`portfolioPulseUtils.js:14`):
`d.setHours(0,0,0,0)` — это server-local TZ (обычно UTC в k8s).

Если сервер в UTC, а browser в МСК (+3): event с at `2026-06-02T22:30:00Z`
сервером тагится `timelineToday` (UTC день 02 июня). На browser: dot
строки «Сегодня» позиционируется в 22:30 + 3 = 01:30 локальной (но это
уже 03 июня в МСК). Так что Dot за «Сегодня» рендерится в 01:30 утра —
ОК для строки Сегодня. Но: event at `2026-06-02T03:00:00Z` для МСК-юзера
это `06:00 МСК 02 июня` (Сегодня в МСК), а сервер мог положить его в
`timelineYesterday` если cutoff `todayStart` уже прошёл (UTC midnight).
В МСК пользователь видит строку «Вчера» содержащую события сегодняшнего
утра по его TZ — диссонанс.

**Симптом:** Тимлид в МСК сидит в 9 утра, открывает Сканер, видит у Феди
«вчера 3 события» (это были события сегодня в 03-06 UTC = 06-09 МСК), а
«сегодня 0». Думает «Федя ничего не делает», подходит на standup —
оказывается Федя сделал 3 транзишена с утра.

**Воспроизведение:** В контейнере сервера выставить TZ=UTC, в browser'е
быть в МСК. Включить worklog/transition в 06:30 МСК (03:30 UTC). Открыть
Сканер сразу после полуночи UTC (т.е. 03:00 МСК) — событие попадёт в
timelineYesterday (server-side todayStart = свежий UTC midnight ещё не
наступил для events до midnight UTC, дальше уже наступит). Реальный
edge case часовой переходной зоны.

**Зачем чинить:** скрытая систематическая ошибка для всех событий
рядом с server TZ midnight. Усугубляется в часовых поясах далеких от
сервера (KAZ +6, например).

**Как чинить:** на сервере приклеивать к событию `localDate` / `localHour`
по `tzOffsetMin` из browser (orchestrator уже отправляет его в `fetchDetail`).
Альтернатива: всё считать UTC и просто документировать.

**Критичность:** medium (systematic, but only affects edge hours).
**Сложность:** high (нужно протащить tzOffset через всю pipeline до server
analysePulse).
**Ценность:** medium.

---

### 8. Panel остаётся открытой когда search/filter скрывает строку

**Описание:** `teamScanner2.js:1810-1818`. Search-фильтр применяется
к `filteredModel.participants`:
```js
filteredModel = { ...filteredModel,
  participants: _filterParticipantsByQuery(filteredModel.participants, this._searchQuery) };
```
Но panel рендерится из `m` (original, unfiltered) на L1790:
```js
const panelHtml = this._expandedKey
  ? renderEmployeeDetailPanel(m, this._expandedKey, ...)
  : '';
```
Значит: panel остаётся открытой даже если person был фильтрован. Но строка
с `ts2-row-expanded` визуально исчезла из dashboard, при этом backdrop
+ panel рендерятся.

**Симптом:** Тимлид открыл карточку Иванова, потом в search набрал «петр» —
Иванов исчез из роster, но его карточка всё ещё открыта на правой стороне.
Закроет → откроет другого → проще, но cognitive dissonance.

**Воспроизведение:**
1. Открыть detail panel сотрудника X.
2. В search-input набрать что-то что не совпадает с label X.
3. Видим: row X исчезла из dashboard, но panel X всё ещё открыт.

**Зачем чинить:** state inconsistency.

**Как чинить:** в `_renderFull` после фильтрации проверить:
```js
if (this._expandedKey
    && !(filteredModel.participants || []).some(p => p.key === this._expandedKey)) {
  this._expandedKey = '';
}
```
Или менее агрессивно — disable panel rendering когда подсветка отсутствует
и показать «карточка скрыта фильтром» в panel.

**Критичность:** medium.
**Сложность:** low.
**Ценность:** medium.

---

### 9. `_kebabAbort` orphan listeners при rapid clicking + двойной abort no-op

**Описание:** `teamScanner2.js:2173-2218`. На каждое открытие kebab'а
создаётся новый AbortController. Перед созданием — если есть `_kebabAbort` —
abort'ится. Окей. Но: внутри `setTimeout(0)` мы навешиваем outside-click
и esc-handler — между момент создания контроллера и tick'ом setTimeout
controller может быть `abort()`-нут (быстрый re-toggle); guard L2202 это
ловит и return. Но есть гонка с другим кодом, который потенциально может
зарегистрировать новый kebabAbort прямо в этот же tick — abort предыдущего
не пройдёт, потому что `this._kebabAbort` уже указывает на новый.

Также: при `_renderFull` уничтожается DOM, но если kebab был открыт —
`_kebabAbort` остаётся живым (его никто не abort'ит в `_renderFull`). На
следующем bind'е новой kebab-кнопки опять abort'нём — orphan listeners
жили все это время.

**Симптом:** При aggressive testing (10+ refresh'ей с открытым kebab'ом)
в DevTools видны orphan keyup/click listeners на document, привязанные к
detached kebabMenu nodes. Memory leak (small, but documented behavior).

**Воспроизведение:**
1. Открыть Сканер, model загружен.
2. Открыть kebab.
3. Не закрывая kebab, нажать Refresh.
4. Открыть kebab снова, повторить 5-10×.
5. В DevTools → Performance → Memory → Take heap snapshot. Поискать
   `Detached HTMLElement` — найдутся detached kebabMenu instances.

**Зачем чинить:** аккуратность; growth небольшой, но идёт.

**Как чинить:** в `_renderFull` ДО `innerHTML = html` вызвать
`this._kebabAbort?.abort()` и обнулить.

**Критичность:** low.
**Сложность:** low.
**Ценность:** low.

---

### 10. `closedYesterdayByMe` не ловит русские статусы Done (Закрыто/Готово/Решено)

**Описание:** `teamScanner2AssistantLLM.js:312-314`:
```js
const closedYesterday = (p.timelineYesterday || [])
  .filter(e => /done|closed|resolved/i.test(e?.text || '') || /status/i.test(e?.kind || ''))
```
Regex чисто английский. Sber Delta Jira чаще всего настроена с RU-only
workflow ('В работе' / 'Готово' / 'Закрыто' / 'Решено' / 'Снято в работу').
Поэтому почти всегда `closedYesterday === []` для русскоязычных команд.

`kind` typically не содержит "status" — он `transition`, `closed`,
`resolved`, `field-change`. То есть второй filter тоже мимо.

Результат: payload `closedYesterdayByMe = []` для всех русских команд →
LLM не получает factual список закрытий → строка «Факт вчера» только из
metrics, без перечисления KEY.

**Симптом:** Юзер видит сводку «По данным интеграций вчера активности
не было» или строку без конкретики, хотя в Jira реально было 3 закрытия.

**Воспроизведение:** Создать тестовый workflow с RU-status'ами; перевести
issue в `Готово`. На следующий день открыть detail panel → «План сегодня /
факт вчера» → в Факт вчера не упомянуты ключи.

**Зачем чинить:** локализация = baseline. Без неё LLM-фича бесполезна для
RU-only Jira.

**Как чинить:**
```js
.filter(e => {
  const kind = String(e?.kind || '').toLowerCase();
  if (kind === 'transition' || kind === 'closed' || kind === 'resolved') {
    const to = String(e?.to || '').toLowerCase();
    return /done|closed|resolved|готов|закры|решен|выполн/.test(to);
  }
  return false;
});
```
А также явно тегировать transition с `to` (это в payload уже есть).

**Критичность:** medium.
**Сложность:** low.
**Ценность:** medium.

---

### 11. `_assistantInflight.get(focusKey)?.abort()` теряет inflight если key поменялся между mount и close

**Описание:** `teamScanner2.js:4073` `_closePanel`:
```js
try { this._assistantInflight.get(focusKey)?.abort?.(); } catch (_) {}
this._assistantInflight.delete(focusKey);
```
`focusKey = this._expandedKey` (заклинательно). Но `_closePanel` вызывается
в нескольких контекстах:
- Click on Close button.
- Backdrop click.
- Escape key.

И ещё: `_setSelectedTeam`/`_setMultiView` делает `this._expandedKey = ''`
ДО `_renderFull`, **не вызывая** `_closePanel`. Inflight LLM-запрос для
закрытой панели не abort'ится. Когда response придёт, `_renderAssistantBlock`
попытается обновить detached `.ts2-assistant-block-content` (DOM exists в
detached fragment). Ошибки не будет, но wasted work + memory hold.

**Симптом:** Открыть panel персона A, expand LLM section → fetch стартует
(45 секунд timeout). Переключиться на другую команду → panel закрыта без
abort. В Network tab видно: запрос продолжается до timeout.

**Воспроизведение:**
1. Открыть detail panel.
2. Развернуть «Сводка ассистента» — пошёл fetch.
3. Сразу переключить команду через segmented-tabs (без закрытия panel).
4. В DevTools → Network → видим запрос `/api/llm/chat` всё ещё in-flight.

**Зачем чинить:** waste resources, утечка PII через unhandled response.

**Как чинить:** в `_setSelectedTeam`/`_setMultiView` после `_expandedKey = ''`
позвать `this.abortAllAssistants()` или явно abort соответствующий key.
Или унифицировать через `_closePanel(silent: true)`.

**Критичность:** low-medium.
**Сложность:** low.
**Ценность:** low.

---

### 12. Renderer rejects participant matching share-link by `key` only, не по email

**Описание:** `teamScanner2.js:1771` (в `_renderFull` apply share-link):
```js
const exists = (m.participants || []).some(p => p.key === this._pendingShareKey);
```
`_pendingShareKey` может быть установлен через `applyFocus({id: focus.id})`
где `focus.id = email > jiraAccountId > key` (per L2562). То есть focus
может прийти с emails, а здесь матчим только по `key` (= lowercased ФИО).
Mismatch — silent toast «больше не работает в команде».

`applyFocus` сам делает identity-resolve (L820-826), но это работает только
если model УЖЕ загружена. Если focus прилетел до загрузки, ставится pending
key с raw `id` (email), и потом resolve не происходит.

**Симптом:** Cross-view focus с Реестра → Сканер (где Реестр отправил email
сотрудника) — Сканер не подсветит сотрудника, покажет toast «больше не
работает».

**Воспроизведение:** Открыть Реестр, кликнуть на email-cell, перейти в
Сканер → panel не открывается. Воспроизводимость зависит от того, кто
отправляет focus event.

**Зачем чинить:** Cross-section focus contract сломан в части initial-load
сценария.

**Как чинить:** В `_renderFull` повторить identity-resolve когда
`_pendingShareKey` ищется в model:
```js
const idLc = String(this._pendingShareKey).toLowerCase();
const found = (m.participants || []).find(p =>
  p.key === this._pendingShareKey ||
  (p.email && p.email.toLowerCase() === idLc) ||
  String(p.jiraAccountId || '') === this._pendingShareKey
);
if (found) this._expandedKey = found.key;
```

**Критичность:** medium (cross-view feature).
**Сложность:** low.
**Ценность:** medium.

---

### 13. `j` chip показывает «0 билдов» когда Jenkins не настроен (не отличить от «настроен, но 0»)

**Описание:** `teamScanner2RendererPersonRows.js:225-227, 213, 219`:
```js
const jN = p.jenkinsBuilds48h || 0;
const jErr = p?.jenkinsError ? String(p.jenkinsError) : '';
...
const jChipRow = jErr ? ... : srcChip('Jenkins', jN, 'j', ...);
```
`p.jenkinsError` — это **fetch error**. Но если Jenkins не настроен
(`jenkinsBaseUrl` не задан в settings), `jenkinsData.error` может быть
`null`/`undefined` или содержать `'not configured'`. Тогда `jErr === ''`
и rendering идёт через `srcChip` который возвращает '' при `n === 0`.

То есть: если Jenkins не настроен, **никаких индикаторов** — тимлид
видит 3 chips (B/C/Z) и думает «всё ок, Jenkins тоже считается». На
самом деле Jenkins вообще не пытались дергать.

**Симптом:** Тимлид DevOps смотрит на сотрудника-SRE, не видит J-chip,
думает «у Феди 0 deploy'ев», подходит — оказывается мы не настроили
Jenkins для команды. Wasted 1:1.

**Воспроизведение:**
1. Открыть Настройки интеграций → Jenkins → очистить baseUrl.
2. Refresh Scanner.
3. На любой строке нет J-chip даже у разработчиков, кого Jenkins знает
   (если бы был настроен).

**Зачем чинить:** «нет данных» != «есть, но 0» — оба важные сигнала, должны
различаться.

**Как чинить:** на server-стороне `jenkins-scan` возвращать explicit flag
`configured: false`, а на клиенте в `_lastRawDiag.jenkinsConfigured` —
prop'ать на participant как `p.jenkinsNotConfigured = true`. Тогда renderer
может ставить третий вариант chip'а: «J ⨯ не настроено» или скрыть J chip
явно с label-comment.

**Критичность:** low.
**Сложность:** medium.
**Ценность:** medium.

---

### 14. `_renderPanelOnly` после filter pill двойная стрелка handler'ов на body events

**Описание:** `teamScanner2.js:2954-2969`. `_renderPanelOnly` re-renders
panel в DOM и вызывает `_bindPanelEvents`. Каждый clickfilter pill →
re-render → new `_escHandler` regestered. Но `_bindPanelEvents` корректно
делает `removeEventListener` для previous handler. Тут ОК.

Проблема в другом: дашборд'овский click-on-row handler сидит на `.ts2-row`
(L2543). Panel re-render не трогает rows. Но вот click на row B пока
открыта panel A: `_renderPanelOnly` rebuilds panel. Однако:
**`_escHandler` registered с global signal (per L2632-2633), а если
изначальный `_escHandler` уже зарегистрирован — `removeEventListener`
работает, но потом `addEventListener` на тот же signal — controller'у
всё равно сколько раз handler navешан, ОК... но closure capture old `root`?**

Re-reading: `_escHandler = (e) => { ... root.querySelector(...) }`.
`root = this._container` (re-captured at start of `_bindPanelEvents`).
Каждый вызов = свежее замыкание со свежим root. OK.

Но есть менее очевидный bug: `_bindPanelEvents` сильно не идемпотентен —
он каждый раз привязывает `.ts2-recent-feed` click delegate'ы (line 2650).
После filter-pill switch: panel re-rendered → новый delegate. Старый
delegate был на старом `.ts2-recent-feed` (детачен; click handler уходит
с node). OK, automatic gc.

Так что bug не там, но `_bindPanelEvents` теперь дёргает повторно
`.ts2-pm-chip[click]` (L2675) — а они тоже на новых nodes. OK.

Реальный issue: `_bindAssistantSection`'s `'toggle'` event listener
**не использует delegated pattern** и привязывается на `.ts2-assistant-section`
напрямую. На каждом `_renderPanelOnly` навешиваем новый listener. Старый
на detached node — ОК. Но cache state теряется: при re-mount section,
`<details>` теряет `open=true` attribute (нет в HTML). Если user развернул
section и потом нажал filter pill, panel rebuilt — section snapped closed.

**Симптом:** Tлид раскрыл «Сводка ассистента» → дождался ответа. Кликнул
filter pill — panel переслала, секция сжалась обратно. Чтобы прочитать,
надо снова открыть. Reading data приходит из cache (без re-fetch), но UX
disruption.

**Воспроизведение:**
1. Открыть detail panel.
2. Развернуть «Сводка ассистента», дождаться текста.
3. Кликнуть один из filter pills (J / B / C / Zc / Ze) — panel перерисовалась.
4. Секция «Сводка ассистента» закрыта. Раскрыть → данные есть мгновенно
   (cache), но пользователь жмёт лишний раз.

**Зачем чинить:** микро-frustration, повторное закрытие на каждом filter
переключении.

**Как чинить:** в `renderAssistantSection` добавить `${isOpen ? 'open' : ''}`
attribute и держать `_assistantOpenKeys` в state:
```js
function renderAssistantSection(p, ctx) {
  const isOpen = ctx?.assistantOpenKeys?.has?.(p.key);
  return `<details ${isOpen ? 'open' : ''} ...>`;
}
```

**Критичность:** low.
**Сложность:** medium.
**Ценность:** medium.

---

### 15. `bucketByHour` отбрасывает события с `Date(...)` уехавшим вперёд более чем на час, но clock-skew может быть и backward

**Описание:** `teamScanner2RendererCommon.js:140`:
```js
if (d.getTime() > Date.now() + 60 * 60 * 1000) continue;
```
Защита от future-clock-skew. Но если сервер ушёл назад (например, NTP-rollback),
events могут получить timestamp **в прошлом**, который не пересекается с
сегодняшним днём — попадают в неправильный bucket или вообще выходят за
72-часовое окно (`heatmap72x4` line 943: `if (hoursAgo < 0 || hoursAgo >= 72) return`).

Не критично, но не симметрично. Когда server clock вернулся на 2ч назад,
все события «выглядят свежее» — попадают в правильные buckets. Так что
backward-skew саб-симметричен и не страшен. Forward-skew — реальная проблема.

**Симптом:** Сложно воспроизвести в проде. Артефакт: если по какой-то
причине участник получает event с `at` в будущем (например, переписки
со сменой TZ при badge editing), heatmap dot не появится в нужной строке.

**Воспроизведение:** Manually inject event с at=now+90 минут (например,
через test fixture). Видим: dot не появляется.

**Зачем чинить:** edge case, не critical.

**Как чинить:** добавить лог/telemetry на drop'нутые events чтобы видеть
clock-skew в проде:
```js
if (d.getTime() > Date.now() + 60 * 60 * 1000) {
  if (typeof telemetryEmit !== 'undefined') telemetryEmit('scanner2.clock_skew_drop', {});
  continue;
}
```

**Критичность:** low.
**Сложность:** low.
**Ценность:** low.

---

### 16. `tasksTouchN` подсчёт через distinctIssueKeys: pendant edge case с issuesNow

**Описание:** `teamScanner2RendererPersonRows.js:188-191`:
```js
const tasksTouchN = (p.contextSwitches?.distinctIssueKeys ?? new Set([
  ...(p.timelineToday || []),
  ...(p.timelineYesterday || []),
].map(e => e?.issue?.key).filter(Boolean)).size);
```
`distinctIssueKeys` это number (из `computeContextSwitches`). Если он `0`
(пользователь без timeline event'ов), `??` сохраняет 0 (nullish coalescing
не triggers на 0). Но если `p.contextSwitches.distinctIssueKeys` именно
`undefined` (защитный код в classifier допускает это), fallback срабатывает.

Реальный bug в fallback (defensive code): использует только today + yesterday,
без timelinePrev. Tooltip говорит «72ч» а fallback считает 48ч.
Но: enrichment всегда добавляет `contextSwitches` (per L412 `p.contextSwitches = computeContextSwitches(p)`),
так что fallback dead code. Только проблема для тестов или edge.

**Симптом:** в тестах с manually-created participant без contextSwitches —
неправильный счётчик. В проде — нет.

**Зачем чинить:** dead code или починить fallback (добавить timelinePrev).

**Как чинить:**
```js
const tasksTouchN = p.contextSwitches?.distinctIssueKeys
  ?? new Set([...today, ...yesterday, ...prev].map(...).filter(Boolean)).size;
```

**Критичность:** low.
**Сложность:** low.
**Ценность:** low.

---

### 17. WIP-counter с issueNow от `_applyPkFilter` может конфликтовать с classifier WIP-cache

**Описание:** classifier кэширует результат через `WeakMap`, key = participant
ref (L101 `_classifyCache.get(p)`). `_applyPkFilter` создаёт мутированный
объект `filteredParticipants` через `model.participants.filter(...)` — это
**тот же объект participant** (filter не клонирует). Так что cache hit
работает корректно.

Но! `_applyActiveSprintFilter` (enrichment) **мутирует** participant
`p.issuesNow = filt(p.issuesNow, ...)` (L133). После этого `classifyPerson(p)`
cache hit вернёт CЛАМ STALE результат (рассчитан на ДО фильтрации). 

Проверка: bumpClassifyEpoch вызывается в `_renderFull` (L1767) ДО любого
rendering'а. Так что classifier результат свежий per-render. ОК.

Но `enrichForScanner2` мутирует НЕ-cache в pipeline: blockers → stale merge.
Вызывает `computeBlockers` сразу за `classifyPerson` где-то ещё (например,
в `computeRiskSummary`). Order is correct because `applyPersonMetrics` runs
после, и `classifyPerson` `bumpClassifyEpoch` не вызывает сам по себе. Ok.

**Симптом:** Сложно воспроизвести в проде. Theoretical: если кто-то
вызовет `classifyPerson(p)` ДО `enrichForScanner2` finishes, а потом ПОСЛЕ —
cache вернёт stale. Но в текущем flow вызывается только в renderer пути
после полного enrichment.

**Зачем чинить:** документация/защита от регрессий в будущем.

**Как чинить:** `bumpClassifyEpoch()` явно в `enrichForScanner2` финале.

**Критичность:** low (theoretical).
**Сложность:** low.
**Ценность:** low.

---

### 18. `_announce` после `_renderFull` падает в пустоту из-за `requestAnimationFrame` против detached DOM

**Описание:** `teamScanner2.js:2099-2104`:
```js
_announce(msg) {
  const el = this._container?.querySelector('#ts2-aria-live');
  if (!el) return;
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = String(msg || ''); });
}
```
Между clear (`el.textContent = ''`) и rAF callback, если кто-то делает
`_renderFull`, container.innerHTML replaced → `el` детачен. rAF callback
выставляет textContent на detached node. SR ничего не услышит.

Воспроизведение в стрессовом сценарии: открыть panel (`_announce('Открыта детализация')`) и
сразу хитро refresh — message потерян.

**Симптом:** Screen reader (NVDA) не объявляет некоторые toast-like
сообщения после bulk-resolve / share-copy при agressive interaction.

**Воспроизведение:** Сложно. Мог бы попасть в a11y-аудит.

**Зачем чинить:** a11y корректность.

**Как чинить:** проверить детачен ли node ПЕРЕД setting textContent:
```js
requestAnimationFrame(() => {
  if (document.contains(el)) el.textContent = String(msg || '');
});
```

**Критичность:** low.
**Сложность:** low.
**Ценность:** low.

---

### 19. `_pendingShareKey` не очищается при ошибке fetch — повисает на следующий mount

**Описание:** `teamScanner2.js:1002-1004` (`_paintError`):
```js
this._pendingShareKey = '';
```
Это в `_paintError`. Но в `_fetchAndRender` finally (L1612-1616):
```js
this._loading = false;
this._loadingMsg = '';
this._stopPhraseRotator();
```
Не сбрасывает `_pendingShareKey` если ошибка не была paint'нута через
`_paintError` (например, abort). При abort'е `_fetchAndRender` возвращается
из `if (e?.name === 'AbortError') return` (L1592) ДО finally. `_pendingShareKey`
остаётся.

При следующем `render()` `_consumeShareLink` (L778) вызывается СНОВА и
читает hash. Если hash не сменился — выставит pending снова. Но если hash
очищен (пользователь сменил), `_pendingShareKey` всё ещё содержит старый
key — и в `_renderFull` его попытаются применить с ложным «не работает в
команде» toast.

**Симптом:** После abort'нутого refresh с share-link в URL пользователь
видит fluky toast о non-existent сотруднике.

**Воспроизведение:**
1. Открыть Сканер с share-link `#scanner2/employee/петров`.
2. На loading нажать Cancel.
3. Перейти в другую subtab.
4. Вернуться в Scanner.
5. Toast «больше не работает в команде» появится без причины.

**Зачем чинить:** false-positive toast.

**Как чинить:** в `_paintCancelled` и `_fetchAndRender` abort-branch
clear `_pendingShareKey`. Или унификация — сбрасывать в `refresh()`.

**Критичность:** low.
**Сложность:** low.
**Ценность:** low.

---

### 20. Email mask показывается в panel header, несмотря на комментарий "masking убран"

**Описание:** `teamScanner2Renderer.js:1418-1419`:
```js
function renderPanelHeader(p, tToday, tYest, tPrev, metrics = {}) {
  // V22 (2026-05-09 UX) — email-masking убран по UX-фидбеку: внутренний
  // tool, всё внутри корп-сети, masking только мешал тимлиду.
```
Но L1478:
```js
${emailFull ? `<a class="ts2-panel-email" href="mailto:${esc(emailFull)}"
   data-email-full="${esc(emailFull)}"
   ... title="Написать ${esc(maskEmail(emailFull))} ...">${esc(maskEmail(emailFull))}</a>` : ''}
```
Видимый текст `${esc(maskEmail(emailFull))}` — masked. `mailto:href` — unmasked (correct).
Только `data-email-full` хранит unmasked.

Несоответствие с комментарием: masking всё ещё применяется к visible тексту.
Тимлид видит `f****@sber.ru` вместо `fedor.ivanov@sber.ru`. Но click on
link открывает корректный mailto. Несоответствие.

**Симптом:** Confusion: пользователь видит масковый email, не может его
прочитать чтобы запомнить, но click работает.

**Воспроизведение:** Открыть detail panel любого сотрудника с email —
masked text в header.

**Зачем чинить:** код vs intent inconsistency, либо удалить maskEmail
заявленно, либо переименовать.

**Как чинить:** удалить вызовы `maskEmail` в panel header или, если
действительно нужна маска для screen-shareable контекста, добавить flag и
сделать осмысленно.

**Критичность:** low.
**Сложность:** low.
**Ценность:** low.

---

## Опциональный блок — приоритеты на 2 недели

Если бы у меня было 2 недели на этот аудит, прицеливался бы так:

1. **Неделя 1, день 1-2:** Починить high-criticality баги — #1 (LLM
   секунды-в-часы), #2 (share-link новый формат не парсится), #3 (diff-badge
   idle→stop), #4 (isStaleData всегда false). Это всё точечные fix'ы без
   архитектурных изменений, покрыть unit-тестами в `tests/unit/teamScanner2/`.

2. **Неделя 1, день 3-4:** Написать regression-тесты на классифицирующий
   слой. Сейчас `classifyPerson` тестируется тонко, но diff-badge mapping и
   `composePersonNarrative` — нет. Добавить fixture-based test, который
   симулирует переходы между snapshot'ами и проверяет каждую из 16 ячеек
   transition matrix.

3. **Неделя 1, день 5:** Починить TZ-skew (#7). Это не точечный fix —
   требует протащить `tzOffsetMin` через server pipeline. Сделать
   feature-flag'ом (`localStorage.q2_scanner_tz_aware = '1'`) и сравнить
   снимки до/после.

4. **Неделя 2, день 1-2:** State consistency cleanup — #8 (panel при
   фильтре скрывает строку, но остаётся открыта), #11 (`_assistantInflight`
   leak), #19 (`_pendingShareKey` leak). Реструктурировать `_renderFull`
   так чтобы state-derived проверки (does `_expandedKey` ещё валиден?
   `_pendingShareKey` свеж?) делались в одном месте.

5. **Неделя 2, день 3:** Подготовить telemetry для clock-skew (#15) и для
   `_searchCache` корректности (#6). Включить prod-сбор, через неделю
   проверить — есть ли реальные кейсы.

6. **Неделя 2, день 4-5:** Cosmetic cleanup — #5 (team-medians wrong
   field), #10 (RU-localized statuses), #14 (assistant section state),
   #20 (email mask inconsistency).

Документирование: всем bugs assigned audit-tag `// QA-2026-06-02-bug-XX`
для будущего grepping. Изменить `CLAUDE.md → docs/state-contracts.md` —
добавить раздел «cross-render state lifecycle invariants» с invariant'ами
типа «`_expandedKey` валиден ⟺ participant с этим key есть в `_model.participants`».

Не делать в эти 2 недели: всё, что требует new server-side surface (часть
#7, #13) — это отдельный sprint c integration impacts.
