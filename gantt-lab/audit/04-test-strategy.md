# Тестовая стратегия и покрытие — экспертный аудит Ганта 3.0

> **Эксперт:** Test Architect (агент «каждую пылинку» сквозь призму тестируемости и покрытия).
> **Дата:** 2026-05-24.
> **Что покрыто:** аудит фактического тест-покрытия `views/gantt3.js` (6888 строк, 472 КБ), `views/dependencyGraph.js` (340 строк) и 20 режимов/тогглов Ганта 3.0; оценка тестируемости (модульность, чистые функции vs DOM-зависимость, экспорт-поверхность); конкретный harness (Playwright visual+smoke + контрактные unit-тесты) с примерами кода; матрица критичных кейсов по режимам; приоритетный план.
> **Метод:** читал реальный код по `file:line`, реальную тест-базу (`tests/unit/` — 97 файлов / ~1554 теста, `tests/contract/`, `tests/playwright/`), реальные helper'ы (`tests/_helpers/llmStub.js`), реальный `package.json`. Прогонял импорт-пробы через `node --test`.

---

## Резюме

**Текущее покрытие `gantt3.js` = 0 (ноль) тестов. Покрытие `dependencyGraph.js` = 0. Покрытие 20 режимов/тогглов = 0.**

Это — главная находка, подтверждённая прямой проверкой:

```text
$ grep -rn "gantt3"          tests/   →  (пусто)
$ grep -rn "dependencyGraph" tests/   →  (пусто)
$ grep -rn "Gantt3View"      tests/   →  (пусто)
```

При этом сам форк — это **самый большой одиночный view-файл в репозитории**: `views/gantt3.js` = 472 КБ / 6888 строк (для сравнения: оригинал `views/gantt.js` = 220 КБ / 3881, `dashboard.js` = 48 КБ, `employees.js` = 63 КБ). Внутри — **20 интерактивных поверхностей**: 9 режимов-оверлеев из меню «Виды ▾» (`split / zen / datagrid / report / scrubber / deck / mission / merge / anatomy`, см. `_GDT_VIEWS` `views/gantt3.js:3135`) + 11 тогглов тулбара (`Линза / Фокус / Команда / Нарратив / Курс / Переносы / Burndown / Чипы / Подсказки / Слой / Anatomy-popover`). Ни одна из них не имеет ни smoke-, ни visual-, ни unit-теста.

Существующая тест-инфраструктура зрелая и пригодная: node:test (~1554 теста в 97 файлах), Playwright (config `tests/playwright/playwright.config.js`, два спека — `scanner-smoke.spec.js` + `full-audit.spec.js` с готовым welcome-bypass и error-capture harness'ом), contract-тесты, helper `tests/_helpers/llmStub.js` (`mockState`, `mockLocalStorage`, `mockServices`). **Весь harness уже есть — gantt3 просто не подключён к нему.** Более того: `full-audit.spec.js` (`VIEWS[]`, строка 140) прокликивает 20 секций Призмы, но **`gantt3` в этот список не входит** — даже самый поверхностный «открылась ли вкладка без ошибок» прогон её не задевает.

**Severity-счёт находок:** Blocker 1 · Critical 4 · Major 6 · Minor 4 · Env-caveat 1. Итого 16 (+1 средовой).

Риск-вывод: 472 КБ нетривиальной DOM-логики (drag-drop, граф зависимостей с longest-path, reverse-replay переносов на ползунке, 20 teardown-путей с listener-cleanup) живут **без единой автоматической проверки**. Любой рефактор «вслепую» (а файл уже на грани читаемости человеком) ничем не подстрахован. Это не «надо бы добавить тестов» — это «критичная подсистема вне контура регрессионной защиты».

---

## Находки / пробелы

Severity: **Blocker** — нельзя релизить / разрабатывать вслепую; **Critical** — высокий риск молчаливой регрессии; **Major** — заметный пробел; **Minor** — гигиена; **Env** — артефакт среды, не дефект кода.

### T-01 · Blocker · полное отсутствие тестов на gantt3 / режимы / dependencyGraph
**Location:** весь `views/gantt3.js`, весь `views/dependencyGraph.js`; `tests/` целиком.
**Суть:** `grep -rn "gantt3\|Gantt3View\|dependencyGraph" tests/` → пусто. 6888 + 340 строк, 20 интерактивных режимов, 0 проверок. Файл-форк создавался 25 итерациями (`#38`–`#63` в task-листе), каждая добавляла режим — ни одна не добавила теста.
**Рекомендация:** ввести три слоя (детально в разделе «Harness»): (1) Playwright smoke per-mode «открыть → 0 console-error → ключевой селектор есть → закрыть → 0 утечек»; (2) unit-контракты на выделенную чистую логику; (3) regression-guard «оригинальный Гант не задет». Старт — T-02 + T-03 (дёшево, ловит максимум).

### T-02 · Critical · `gantt3` отсутствует в Playwright full-audit
**Location:** `tests/playwright/full-audit.spec.js:140` — массив `VIEWS[]`.
**Суть:** `full-audit.spec.js` прокликивает 20 секций (`dashboard, metrics, registry, gantt, kanban, timeline, …`) с error-capture (`setupErrorCapture`, строка 49) и скриншотом. Ключа `gantt3` в списке **нет** — притом что оригинальный `gantt` есть (строка 144). Это значит: даже catastrophic-фейл (вкладка падает с throw при открытии) не будет пойман ни одним CI-шагом.
**Рекомендация:** добавить `{ key: 'gantt3', label: 'Гант 3.0' }` в `VIEWS[]` **немедленно** — одна строка, мгновенно даёт «вкладка хотя бы открывается без pageerror». Это самый дешёвый Blocker-mitigation в отчёте.

### T-03 · Critical · ноль покрытия 9 режимов «Виды» + 11 тогглов
**Location:** `_GDT_VIEWS` `views/gantt3.js:3135`; диспетч `_modeOpen` `:3219`; тогглы `_lensToggleMode :1897`, `_diffToggle :3046`, `_burndownToggle :3080`, `_chips* :3637`, `_suggestToggle :3793`, `_annotToggle :3890`, `_northstarToggle :2768`, `_narrativeToggle :2643`, `_cmd* :2305`, `_marquee/_peek/_radial`.
**Суть:** каждый режим — это builder `_mode_<name>(body, data, el)`, вызываемый через try/catch (`:3236`), который при ошибке тихо пишет «Ошибка рендера вида» в body. То есть **сломанный режим не падает — он деградирует молча**, и без теста это вообще не видно. 9 builder'ов + 11 toggle on/off путей = 20 поверхностей × (open + render + interact + close) непокрыты.
**Рекомендация:** Playwright data-driven loop по `_GDT_VIEWS` (пример кода ниже) + отдельный loop по toggle-кнопкам тулбара.

### T-04 · Critical · teardown / listener-leak полностью непроверен
**Location:** `_modeClose :3238` (снимает `onKey`, `onKey2`, `onResize`, `clearInterval(timer)`); `_lensExit :1925` (снимает keydown/scroll/resize/`cancelAnimationFrame`/удаляет overlay+readout); `_narrativeClose :2754`; `_radialClose :3779` (снимает `window scroll` capture); `_peekClose :3022`; scrubber `setInterval` `:3495`.
**Суть:** каждый режим вешает глобальные listener'ы (`document.addEventListener('keydown', …, true)`, `window.addEventListener('scroll', …, true)`) и/или таймеры/RAF/SVG-оверлеи на `document.body`. Корректность teardown'а — это контракт: открыл/закрыл 10 раз → 0 лишних listener'ов, 0 осиротевших `#gdt-*` узлов в `body`, остановлен `setInterval` скраббера. Сейчас это не проверяется ничем; classic-симптом — «Esc в другой вкладке закрывает что-то в Ганте» (от чего код уже защищается через `documentElement.dataset.activeSection !== 'gantt3'`, см. `:1914`, `:2311`, `:2859` — но guard сам по себе непротестирован).
**Рекомендация:** Playwright-тест «open→close N раз, проверить `document.querySelectorAll('[id^=gdt-]').length === 0` и отсутствие активных таймеров»; для scrubber — что после close `setInterval` не тикает (мутирует ли DOM после close).

### T-05 · Critical · дублированная логика графа зависимостей в двух файлах, оба без тестов
**Location:** `views/gantt3.js:1959` `_lensBuildGraph()` **и** `views/dependencyGraph.js:44` `_graph(deps, rows)`.
**Суть:** обе функции независимо реализуют **один и тот же алгоритм**: ancestors/descendants через visited-guard + longest-path (крит-путь) через on-stack cycle-guard с мемоизацией (`upMemo/downMemo` в gantt3 :1979-1988 ≈ `upM/dnM`/`lUp`/`lDn` в depGraph :58-60). Это copy-paste двух нетривиальных рекурсий по графу. Баг, починенный в одной, **не** доедет до другой. Cycle-guard критичен: комментарий сам признаёт «реальные dep-графы ацикличны, но от кривых данных не должно зависать» (`:1957`) — то есть авторы знают про риск зацикливания, но проверки на это нет.
**Рекомендация:** (1) выделить **единый** `buildDepGraph(deps, keys)` в чистый модуль (напр. `views/gantt/depGraphCore.js`), переиспользовать в обоих местах; (2) покрыть unit-тестами: линейная цепь, ромб (diamond), **цикл A→B→A** (не должно зависнуть/переполнить стек), пустой граф, самозависимость A→A, недостающий узел. Это та самая «чистая логика, спрятанная за DOM», которую надо вытащить.

### T-06 · Major · `_collectEpics()` — единый источник данных всех режимов — непротестированный DOM-скрейпер
**Location:** `views/gantt3.js:3146`.
**Суть:** все 9 режимов кормятся из `_collectEpics()`, который **не** читает `state.rows`, а **скрейпит уже отрендеренный DOM** (`#gantt3-wrap .gantt-row[data-epic-key]`, `.gantt-type-pill[data-wt]:not(.gantt-pill-ghost)`, текст из `.gdt-pill-name`, `.gdt-pill-meta`, флаги `.gdt-pill-state-done/active`). Это значит: (а) функцию нельзя протестировать без полного рендера грида; (б) она хрупкая к любому переименованию CSS-класса/структуры пилюли (молчаливо вернёт пустые/кривые данные → все режимы покажут «0 эпиков» без ошибки); (в) инварианты не закреплены: `total === Σ done+active+rest`, `blocks` (`:3190`) — обратные рёбра `deps`, `who` — уникальные исполнители. Парсинг `who` особенно хрупок: `.split('·')[0].trim().replace(/^—$/, '')` (`:3173`).
**Рекомендация:** контрактный тест на инварианты `_collectEpics` поверх замоканного `#gantt3-wrap` (через DOM-стаб как в `settings-view.test.js`), либо — лучше — рефактор: дать `_collectEpics` опциональный data-path из `state.rows` и тестировать его. Минимум — закрепить: «при N эпиках в DOM вернётся N в `out.epics`; `e.total === Object.values(e.cells).flat().length`; `e.blocks` симметричен `deps`».

### T-07 · Major · scrubber reverse-replay переносов — нетривиальная чистая логика без теста
**Location:** `views/gantt3.js:3460` `_mode_scrubber`, ядро `:3479`-`:3489` (`render()`): берёт текущее расположение пилюль `cur`, и для ползунка `k` **откатывает** переносы `[k..N)` в обратном порядке (`for i=N-1; i>=k; i--`), сопоставляя пилюлю по `(col===mv.dst && wt===mv.wt)` и возвращая её в `mv.src`. Затем считает `driftN` (пилюли не на `baseCol`).
**Суть:** это reverse-undo по журналу `ganttArrows` — ровно тот класс логики, где off-by-one и неверное сопоставление пилюль дают молча неверную «историю» (показывает не то расположение). Полностью изолируемо от DOM (вход: `moves[]` + `cur{}`, выход: `work{}` + `driftN`), но сейчас вкомпилировано в DOM-builder и непокрыто.
**Рекомендация:** вытащить ядро в чистую `replayMovesUpTo(cur, moves, k)` и покрыть: `k=N` (всё применено, drift=0 если план = baseCol), `k=0` (старт квартала, всё откатано), `k` в середине, перенос без матчящей пилюли (`if(!pill)` пропуск), две пилюли одного `wt` в одной колонке (риск перепутать). Пример в разделе Harness.

### T-08 · Major · pluralizers и `_wtColor` — 4 копии русской плюрализации + цветовая карта, тривиально тестируемы, но не вынесены/не покрыты
**Location:** `pl()` `views/gantt3.js:50` (module-level); `_plRabot :2647`, `_plPeren :2653`, `_plKomand :2748`, `_plPerenos :3040`, локальный `plw` внутри `_modeEpicCard :3260` — **пять** реализаций одного русского правила (1/2-4/5+); `_wtColor :3249`.
**Суть:** `pl(n, forms)` уже обобщён (`:50`), но рядом живут 5 специализированных копий с тем же `m10/m100`-алгоритмом — DRY-нарушение и 5 мест для одинакового бага на границах (11–14, 21, 111). `_wtColor` — детерминированная карта `wt→CSS var` с нормализацией `toUpperCase().replace(/[^A-ZА-Я]/g,'')` (`:3250`) и fallback. Всё это **чистые функции** — идеальные кандидаты для unit-теста, но ни одна не экспортирована индивидуально (см. T-10) и ни одна не покрыта. Замечу: репо уже имеет `tests/unit/utilsPlural.test.js` — есть готовый паттерн, к которому можно подключиться.
**Рекомендация:** заменить 5 копий на `pl(n, ['работа','работы','работ'])` и т.п.; экспортировать `pl`/`_wtColor` (или вынести в `views/gantt/ganttPureHelpers.js`); покрыть граничные `n ∈ {0,1,2,4,5,11,14,21,22,25,100,111}`. Дёшево, мгновенно зелено.

### T-09 · Major · `_suggestDerive(data)` — почти-чистый генератор наблюдений без теста
**Location:** `views/gantt3.js:3797`.
**Суть:** принимает `data` (из `_collectEpics`) и возвращает массив `{sev,title,why,epicKey}` по 4 правилам: перегруз окна (`n>=4`), риск-без-владельца (`risk && some pill !who` → `sev:'crit'`), частые переезды (`churn`), не начато (`total>0 && active===0 && done===0`, max 3). Это бизнес-логика «умных подсказок» — ровно то, что должно иметь golden-тесты (изменишь порог 4→5 — тест поймает). Вход — простой объект, DOM не нужен.
**Рекомендация:** unit-тест на каждое правило + порядок/severity + пустой результат («план сбалансирован»). Конструируешь `data` руками, вызываешь `Gantt3View._suggestDerive(data)`.

### T-10 · Major · экспорт-поверхность = ровно 1 (`Gantt3View`), чистая логика недоступна для изолированного теста
**Location:** `views/gantt3.js:83` — единственный `export const Gantt3View`. `grep -c "^export" gantt3.js → 1`.
**Суть:** все чистые helper'ы либо module-private (`pl`, `formatLongRange`, `_CHURN_SVG`), либо методы на namespace-объекте. Методы (`_wtColor`, `_plRabot`, `_collectEpics`, `_suggestDerive`, `_mode_*`) технически достижимы как `Gantt3View._wtColor(...)` — но module-private функции (`pl`, `formatLongRange :67`) **не** достижимы извне вообще. Для тестируемости это значит: либо тестировать через namespace (работает для методов), либо вынести чистую логику в отдельный экспортируемый модуль. Сейчас архитектура «один гигантский объект-namespace» максимально враждебна изоляции.
**Рекомендация:** создать `views/gantt/ganttPureHelpers.js` и переэкспортировать туда `pl, formatLongRange, _wtColor, buildDepGraph (T-05), replayMovesUpTo (T-07), deriveSuggestions (T-09)`; `gantt3.js` импортирует их обратно. Это и DRY (T-05/T-08), и делает 6 чистых единиц тестируемыми без DOM.

### T-11 · Major · regression «оригинальный Гант не задет» — общие CSS-префиксы, нет guard-теста
**Location:** общие классы в обоих файлах: `v16-*` (34 уникальных в каждом), `gdt-*` (132 в `gantt.js`, ~302 в `gantt3.js`), и shared grid-контракт `gantt-row` / `gantt-cell` / `gantt-type-pill` (63 вхождения в `gantt.js`, 148 в `gantt3.js`).
**Суть:** изоляция форка заявлена в `index.html:1316` как «свои id (`gantt3-*`), свои ls-ключи (`q2_gantt3_*`), свой EventBus `gantt3-rendered`» — **но не свои CSS-классы**. `gantt3` переиспользует `v16-*`/`gdt-*`/`gantt-*` совместно с оригиналом. Новые mode-only классы (`gf-`/`dc-`/`gpa-`) в `gantt.js` действительно отсутствуют (проверено: `grep -cE "gf-|dc-|gpa-|gdt-mode" gantt.js → 0`) — утечки *новых* классов нет. **Но** правки общих классов в `styles.css` (989 КБ!) затрагивают оба Ганта одновременно, и переключение mode-классов на `document.body` (`gdt-lens-on :1906`, `gdt-cmd-on :2305`, `gdt-chips-on :3637`, `gdt-g3-texture :1444`) — глобально по `<body>`, не scoped к секции gantt3.
**Рекомендация:** (1) regression-тест: открыть `#gantt` (оригинал), снять снапшот/проверить пилюли с текстом и отсутствие mode-классов `gdt-*-on` на `body`; затем посетить `#gantt3`, включить режимы, вернуться на `#gantt` — убедиться, что `body` чист от `gdt-lens-on/gdt-cmd-on/gdt-chips-on/gdt-g3-texture` и оригинал рендерит пилюли. (2) Проверить, что `q2_gantt3_*` ls-ключи не пересекаются с `q2_gantt_*` оригинала (важно для density/mode-persist).

### T-12 · Minor · `try/catch` в `_modeOpen` глушит ошибки рендера — нужен тест на видимость деградации
**Location:** `views/gantt3.js:3236`.
**Суть:** `try { builder(...) } catch(e){ body.innerHTML = 'Ошибка рендера вида: '+message }`. Хорошо для UX (не валит приложение), плохо для CI (ошибка не всплывает как pageerror). Без теста сломанный режим = «пустоватая панель», незаметно.
**Рекомендация:** Playwright-проверка, что body режима НЕ содержит подстроку «Ошибка рендера вида» (это сигнатура пойманного throw). Дёшево, ловит T-03-класс молча.

### T-13 · Minor · empty-state каждого режима не закреплён
**Location:** scrubber empty `:3467` («История переносов пуста…»), zen empty `:3323` («Нет эпиков»), suggest empty `:3813` («План сбалансирован…»), report «Рисков не зафиксировано» `:3389`.
**Суть:** режимы по-разному ведут себя на пустых/нулевых данных (нет переносов, нет рисков, нет эпиков). Это легко регрессирует в «пустой белый прямоугольник» или throw на `epics[0]`. Демо-данные всегда «богатые», поэтому ручное тестирование пустые состояния не ловит.
**Рекомендация:** unit/Playwright с `mockState({rows:[], milestones:[], epicDeps:{}})` → каждый режим показывает осмысленный empty-state, не падает.

### T-14 · Minor · keyboard-nav (roving tabindex) + EventBus `gantt3-rendered` непокрыты
**Location:** `bindKeyboardNav :1243`, подписка на `gantt3-rendered :1292`, эмит `:6767`.
**Суть:** roving-tabindex навигация по пилюлям (←/→/↑/↓, Enter/F2 ctx-menu) и её ре-инициализация через EventBus после каждого `renderChart` — нетривиальный код с историей багов (комментарий `:1281` про снятый monkey-patch). Регрессия здесь = «Tab не ходит по гриду», незаметно без a11y-теста.
**Рекомендация:** Playwright keyboard-тест: focus первую пилюлю → стрелки двигают focus → после re-render roving сохраняется (1 пилюля `tabindex=0`).

### T-15 · Minor · localStorage-персист режимов/density/annot непокрыт
**Location:** `q2_gantt3_mode_v16` (`:1355`,`:1371`,`:5436`), `q2_gantt3_density_v16` (`:1416`,`:1454`,`:1482`), `q2_gantt3_annot_v1` (`:3886`,`:3889`), `q2_gantt3_legend_open_v15` (`:1712`).
**Суть:** mode/density восстанавливаются из ls при `render()` (`applyMode`/`applyDensity` `:1194`-`:1195`). Слой заметок (`_annotStore`) сериализуется в ls и **не** мутирует план (контракт!). Регрессия = «слой заметок протёк в план эпиков» или «density не восстановилась». `mockLocalStorage` helper уже есть.
**Рекомендация:** unit-тест: `_annotSave/_annotStore` round-trip; проверка, что запись заметки НЕ трогает `state.rows`.

### T-ENV · Env-caveat · файлы рабочего дерева cloud-evicted (APFS dataless) — лайв-прогон в этом sandbox невозможен
**Location:** `rowFactory.js` (и потенциально др.) — `ls -laO` → `compressed, dataless`; `file rowFactory.js` → `empty`; `node import('./rowFactory.js')` → только `default` export, отчего `import { EmployeeFactory, RowFactory }` падает в **любом** файле этой цепочки (воспроизведено и на `views/employees.js`, и на `views/gantt3.js`).
**Суть:** это **артефакт среды** (iCloud-эвикция контента, не материализуется без сети), **не дефект кода**. На гидратированном checkout / в CI `rowFactory.js` имеет реальное содержимое и импорт-цепочка целая. Важно для исполнителя: пока файлы dataless, `npm run test:unit` и любой `node --test`, импортирующий view-цепочку, будут красными по `ERR_TEST_FAILURE: Named export 'EmployeeFactory' not found` — это ложный фейл среды. Сначала гидратировать дерево (открыть файлы / `Get Info`/принудительно скачать из iCloud), затем мерить baseline.
**Рекомендация:** перед прогоном harness'а убедиться `wc -c rowFactory.js && head -1 rowFactory.js` отдают реальный контент; иначе цифры baseline недостоверны. Статический аудит (этот документ) на dataless не влияет — `gantt3.js`/`dependencyGraph.js` читались полностью.

---

## Предлагаемый harness

Три слоя, по возрастанию стоимости и убыванию ROI. Всё опирается на **уже существующую** инфраструктуру — ничего нового в `package.json` ставить не нужно (нет jsdom — и не требуется: DOM-тесты в этом репо делаются либо Playwright'ом, либо ручными `globalThis.document`-стабами, как в `settings-view.test.js`/`employeesView.test.js`).

### Слой 0 (5 минут, Blocker-mitigation) — добавить gantt3 в full-audit

```js
// tests/playwright/full-audit.spec.js — в массив VIEWS[] (после строки 144 'gantt')
const VIEWS = [
  // …
  { key: 'gantt',  label: 'Гант' },
  { key: 'gantt3', label: 'Гант 3.0' },   // ← T-02: одна строка = «вкладка открывается без pageerror»
  // …
];
```
Сразу даёт error-capture + скриншот для gantt3 в каждом CI-прогоне `test:visual`.

### Слой 1 (основной) — Playwright per-mode smoke

Новый спек `tests/playwright/gantt3-modes.spec.js`. Переиспользует welcome-bypass из `full-audit.spec.js`. Контракт каждого режима: **открыть → 0 console-error → ключевой селектор отрендерен → нет сигнатуры пойманного throw → закрыть чисто → 0 утечек в body**.

```js
'use strict';
const { test, expect } = require('@playwright/test');

// Реестр режимов «Виды» — зеркалит _GDT_VIEWS (gantt3.js:3135).
// [view-key, ключевой селектор внутри #gdt-mode-body]
const VIEW_MODES = [
  ['split',    '.gdt-msplit .ms-list'],
  ['zen',      '#zen-card'],
  ['datagrid', 'table.gdt-dg'],
  ['report',   '.gdt-rep .gdt-kpis'],
  ['scrubber', '#sc-range'],            // <input range> — ядро T-07
  ['deck',     '.gdt-deck .dk-slide'],
  ['mission',  '.gdt-mission .mg-gantt'],
  ['merge',    '.gdt-merge .mg-conf'],
  ['anatomy',  '.gdt-anatomy-pop, .gm-body'],
];

// Тогглы тулбара — [id кнопки, селектор-признак включённого состояния].
const TOGGLES = [
  ['btn-gantt3-lens',      'body.gdt-lens-on'],
  ['btn-gantt3-cmd',       'body.gdt-cmd-on'],
  ['btn-gantt3-chips',     'body.gdt-chips-on'],
  ['btn-gantt3-narrative', '#gdt-narrative'],
  ['btn-gantt3-northstar', '.gdt-northstar, #gantt3-wrap'],  // toggle-класс
  ['btn-gantt3-suggest',   '#gdt-suggest'],
  ['btn-gantt3-annot',     'body'],                          // _annot.on
  ['btn-gantt3-diff',      '#gantt3-wrap'],
  ['btn-gantt3-burndown',  '#gantt3-wrap'],
];

async function gotoGantt3(page) {
  await page.goto('/');
  await bypassWelcome(page);                       // helper из full-audit.spec.js
  await page.evaluate(() => window.Nav?.goTo?.('gantt3') ?? (location.hash = '#gantt3'));
  await page.waitForSelector('#gantt3-wrap .gantt-row', { timeout: 10_000 });
}

test.describe('Гант 3.0 — режимы «Виды»', () => {
  for (const [view, sel] of VIEW_MODES) {
    test(`режим «${view}»: open → render → close`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

      await gotoGantt3(page);
      // открыть через публичный namespace (надёжнее клика по дропдауну)
      await page.evaluate(v => window.Gantt3View._modeOpen(v), view);

      const body = page.locator('#gdt-mode-body');
      await expect(body).toBeVisible();
      await expect(page.locator(sel).first()).toBeVisible();        // ключевой элемент есть
      await expect(body).not.toContainText('Ошибка рендера вида');  // T-12: throw не проглочен
      await page.screenshot({ path: `tests/playwright/_out/snapshots/g3-mode-${view}.png` });

      // закрыть по Esc и проверить чистый teardown (T-04)
      await page.keyboard.press('Escape');
      await expect(page.locator('#gdt-mode')).toHaveCount(0);
      const orphans = await page.evaluate(() =>
        document.querySelectorAll('#gdt-mode, #gdt-narrative, #gdt-suggest, [id^="gdt-lens"]').length);
      expect(orphans).toBe(0);
      expect(errors, errors.join('\n')).toHaveLength(0);
    });
  }
});

test.describe('Гант 3.0 — тогглы тулбара (on → off идемпотентность)', () => {
  for (const [btnId, onSel] of TOGGLES) {
    test(`тоггл #${btnId}`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await gotoGantt3(page);
      const btn = page.locator('#' + btnId);
      await btn.click();                       // включить
      await page.waitForTimeout(300);
      await btn.click();                       // выключить
      await page.waitForTimeout(300);
      // после off — никаких mode-классов на body (T-11)
      const leaked = await page.evaluate(() =>
        ['gdt-lens-on','gdt-cmd-on','gdt-chips-on','gdt-g3-texture']
          .filter(c => document.body.classList.contains(c)));
      expect(leaked, 'leaked body-classes: ' + leaked).toHaveLength(0);
      expect(errors, errors.join('\n')).toHaveLength(0);
    });
  }
});
```

### Слой 1b — regression «оригинальный Гант не задет» (T-11)

```js
test('оригинальный Гант чист после визита в Гант 3.0', async ({ page }) => {
  await gotoGantt3(page);
  await page.evaluate(() => window.Gantt3View._lensToggleMode());   // включить режим
  await page.evaluate(() => window.Gantt3View._chipsToggle?.());
  // вернуться на оригинал
  await page.evaluate(() => window.Nav?.goTo?.('gantt') ?? (location.hash = '#gantt'));
  await page.waitForSelector('#gantt-wrap .gantt-row', { timeout: 10_000 });
  // body не должен нести mode-классы Ганта 3.0
  const leaked = await page.evaluate(() =>
    ['gdt-lens-on','gdt-cmd-on','gdt-chips-on','gdt-g3-texture']
      .filter(c => document.body.classList.contains(c)));
  expect(leaked).toHaveLength(0);
  // оригинал рендерит пилюли с текстом
  const pillText = await page.locator('#gantt-wrap .gantt-type-pill').first().innerText();
  expect(pillText.trim().length).toBeGreaterThan(0);
});
```

### Слой 2 — контрактные unit-тесты (после рефактора T-10)

Предпосылка: вынести чистую логику в `views/gantt/ganttPureHelpers.js` (T-05/T-07/T-08/T-09/T-10) и `views/gantt/depGraphCore.js`. Тогда тесты не зависят от DOM/cloud-эвикции.

**Плюрализация + `_wtColor` (T-08):**
```js
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe('gantt pure helpers', async () => {
  const { pl, wtColor } = await import('../../views/gantt/ganttPureHelpers.js');
  const RAB = ['работа','работы','работ'];

  test('pl — границы русских окончаний', () => {
    assert.equal(pl(1,  RAB), 'работа');
    assert.equal(pl(2,  RAB), 'работы');
    assert.equal(pl(4,  RAB), 'работы');
    assert.equal(pl(5,  RAB), 'работ');
    assert.equal(pl(11, RAB), 'работ');   // 11–14 → форма 3 несмотря на …1
    assert.equal(pl(14, RAB), 'работ');
    assert.equal(pl(21, RAB), 'работа');
    assert.equal(pl(22, RAB), 'работы');
    assert.equal(pl(111,RAB), 'работ');
    assert.equal(pl(0,  RAB), 'работ');
  });

  test('wtColor — карта дисциплин + нормализация + fallback', () => {
    assert.equal(wtColor('BE'),   'var(--prizma-information)');
    assert.equal(wtColor('be'),   'var(--prizma-information)'); // case-insens
    assert.equal(wtColor('QA'),   'var(--prizma-on-course)');
    assert.equal(wtColor('FE '),  'var(--prizma-insight, #7C5CFF)'); // обрезка не-букв
    assert.equal(wtColor('xyz'),  'var(--prizma-information)'); // fallback
    assert.equal(wtColor(''),     'var(--prizma-information)');
    assert.equal(wtColor(null),   'var(--prizma-information)');
  });
});
```

**Граф зависимостей — cycle-safe + longest-path (T-05):**
```js
const { buildDepGraph } = await import('../../views/gantt/depGraphCore.js');

test('линейная цепь A→B→C: ancestors/descendants/critical-path', () => {
  // epicDeps[from] = [to] означает «from зависит от to» (to — предок)
  const g = buildDepGraph({ A: ['B'], B: ['C'] }, ['A','B','C']);
  assert.deepEqual([...g.ancestorsOf.A].sort(),   ['B','C']);
  assert.deepEqual([...g.descendantsOf.C].sort(), ['A','B']);
  assert.deepEqual(g.criticalPath('A'), ['C','B','A']); // up..self..down
});

test('цикл A→B→A НЕ зависает и не переполняет стек', () => {
  assert.doesNotThrow(() => {
    const g = buildDepGraph({ A: ['B'], B: ['A'] }, ['A','B']);
    g.criticalPath('A');                 // on-stack guard обязан оборвать рекурсию
  });
});

test('самозависимость A→A не даёт A в своих предках', () => {
  const g = buildDepGraph({ A: ['A'] }, ['A']);
  assert.ok(!g.ancestorsOf.A.has('A'));  // self удаляется (gantt3.js:1975 a.delete(k))
});

test('пустой граф', () => {
  const g = buildDepGraph({}, []);
  assert.equal(Object.keys(g.ancestorsOf).length, 0);
});
```

**Scrubber reverse-replay (T-07):**
```js
const { replayMovesUpTo } = await import('../../views/gantt/ganttPureHelpers.js');

// cur — текущее (финальное) расположение; moves — журнал по возрастанию at.
const cur = { 'Epic A': [{ wt:'BE', col:'r122', baseCol:'r122', done:false }] };
const moves = [
  { epic:'Epic A', wt:'BE', src:'r120', dst:'r121', at:'2026-03-01' },
  { epic:'Epic A', wt:'BE', src:'r121', dst:'r122', at:'2026-04-01' },
];

test('k=N: применены все переносы → drift=0 (план == baseCol)', () => {
  const { work, driftN } = replayMovesUpTo(cur, moves, moves.length);
  assert.equal(work['Epic A'][0].col, 'r122');
  assert.equal(driftN, 0);
});

test('k=0: старт квартала → пилюля откатана в самый ранний src', () => {
  const { work, driftN } = replayMovesUpTo(cur, moves, 0);
  assert.equal(work['Epic A'][0].col, 'r120'); // оба переноса отменены в обратном порядке
  assert.equal(driftN, 1);                     // отличается от baseCol r122
});

test('перенос без матчащей пилюли пропускается без throw', () => {
  const orphan = [{ epic:'Ghost', wt:'QA', src:'r120', dst:'r121', at:'2026-03-01' }];
  assert.doesNotThrow(() => replayMovesUpTo(cur, orphan, 0));
});
```

**Smart-suggest правила (T-09) — через namespace, DOM не нужен:**
```js
const { Gantt3View } = await import('../../views/gantt3.js'); // требует гидратации (T-ENV)
const mkData = (over) => ({ teams:[{key:'t1',name:'PAY'}], cols:['r121'],
  colLabel:{r121:'1.21'}, epics:[], ...over });

test('риск без владельца → sev:crit', () => {
  const data = mkData({ epics:[{ epic:'E', key:'k1', teamKey:'t1', risk:true,
    churn:false, total:1, done:0, active:0, cells:{ r121:[{wt:'BE',who:''}] } }]});
  const out = Gantt3View._suggestDerive(data);
  assert.ok(out.some(o => o.sev==='crit' && /владельца/.test(o.title)));
});

test('сбалансированный план → пусто', () => {
  assert.deepEqual(Gantt3View._suggestDerive(mkData({})), []);
});
```

> Примечание: если рефактор T-10 не делается, чистые `_mode_*`/`_suggestDerive`/`_wtColor` всё равно тестируемы как `Gantt3View.<method>` — но это тащит весь импорт-граф gantt3 (и требует гидратации, T-ENV). Вынос в `ganttPureHelpers.js`/`depGraphCore.js` снимает зависимость и от DOM, и от тяжёлой цепочки.

### Слой 3 — снапшоты (опционально)

Playwright `toHaveScreenshot()` по `#gdt-mode-body` для каждого режима на фиксированном демо-датасете (welcome-bypass уже форсит `mode:'demo'`). Хранить baseline'ы в `tests/playwright/_out/snapshots/`. Запускать в `test:visual:ci`. Осторожно: режимы с временем (`mission` обратный отсчёт вех, `scrubber` даты) дадут флаки — для них только smoke, не pixel-snapshot.

---

## Матрица критичных кейсов по режимам

| Режим / тоггл | Builder/toggle (file:line) | Ключевой селектор | Критичные кейсы | Чистая логика для unit | Риск без теста |
|---|---|---|---|---|---|
| **split** | `_mode_split :3301` | `.gdt-msplit .ms-list` | пустой список; клик по `.ms-li` меняет инспектор; `sel(0)` при наличии эпиков | `_modeEpicCard :3257` (детерм. HTML) | средний |
| **zen** | `_mode_zen :3310` | `#zen-card` | ←/→ листают по кругу (`%length`); empty «Нет эпиков» `:3323`; ArrowLeft/Right listener снят при close | step-mod арифметика | средний |
| **datagrid** | `_mode_datagrid :3325` | `table.gdt-dg` | сортировка по каждому столбцу (team/epic/total/ratio/moves/deps/risk + per-col); toggle dir; tfoot ИТОГО суммы верны | sort-comparator `:3333`, агрегаты `:3343` | **высокий** (числовые агрегаты) |
| **report** | `_mode_report :3373` | `.gdt-rep .gdt-kpis` | pct=done/total; «Рисков не зафиксировано»; `window.print()` кнопка; milestones-timeline вкл/выкл | pct/cap расчёт; `_milestonesTimeline :3360` | средний |
| **scrubber** | `_mode_scrubber :3460` | `#sc-range` | **reverse-replay (T-07)**; k=0/k=N/середина; play/pause `setInterval` стоп при close; empty «История пуста» `:3467`; drift-подсветка | **`replayMovesUpTo` :3479-3489** | **высокий** (off-by-one, leak таймера) |
| **deck** | `_mode_deck :3396` | `.gdt-deck .dk-slide` | слайд на команду + риски + обзор; dots-навигация; ←/→ по кругу; пустые риски | slide-сборка | низкий |
| **mission** | `_mode_mission :3420` | `.gdt-mission .mg-gantt` | heatmap ёмкости (color-mix tint по n); top-16 эпиков сорт по risk/total; feed переносов сорт по at; обратный отсчёт вех (past/soon/days) | heat-tint, countdown `:3447`, feed-sort `:3442` | **высокий** (сортировки/даты) |
| **merge** | `_mode_merge :3500` | `.gdt-merge .mg-conf` | radio выбор local/file; skip; счётчики resolved/skipped/undecided; «превью — план не меняется» (контракт!) | decided-агрегация `:3528` | средний (контракт «не мутит план») |
| **anatomy** | `_mode_anatomy :3538` | `.gm-body` | статичный референс; рендерится без данных | — (статика) | низкий |
| **Линза** | `_lensEnter :1901` / `_lensExit :1925` | `body.gdt-lens-on` + `#gdt-lens-wires` | **граф (T-05)**; hover→focus; click→lock; SVG-overlay + readout удаляются при exit; scroll/resize/keydown listener'ы сняты; RAF отменён; Esc-guard по activeSection | **`buildDepGraph` :1959** | **высокий** (граф + leak) |
| **Команда** | `_cmd*` enter `:2305` | `body.gdt-cmd-on` + `.gdt-cmd-bar` | парсинг `team:/release:/risk:/текст`; ↑/↓ по опциям; `/` фокус; подсветка совпадений; Esc-guard | filter-parse, `opts`-список | средний |
| **Фокус** | `_focusLane :101` (toggle) | (re-render грида) | одна команда раскрыта, прочие — сводка нагрузки; клик переключает фокус-команду | сводка нагрузки | средний |
| **Нарратив** | `_narrativeOpen :2701` / close `:2754` | `#gdt-narrative` | абзац на эпик из DOM (`_narrativeEpicHtml :2659`); TOC-якоря скроллят; плюрализация работ/переносов/команд; Esc закрывает | `_narrativeEpicHtml`, `_plRabot/_plPeren/_plKomand` | средний |
| **Курс** | `_northstarShow :2772` / hide `:2778` | toggle-класс на wrap | ось квартала: сегменты релизов + вехи + маркер «сейчас» по DOY% | позиционирование по `data-win-start/end` | низкий |
| **Переносы** | `_diffToggle :3046` | (подсветка пилюль) | подсветка переезжавших пилюль; toast «N переносов в плане» `:3054`; `_plPerenos :3040` | `_plPerenos` | низкий |
| **Burndown** | `_burndownToggle :3080` | (спарклайн в шапках) | мини-спарклайн план vs факт в датированных релизах; повторный клик выключает | расчёт sparkline `:3120` | средний |
| **Чипы** | `_chips* :3637` | `body.gdt-chips-on` | AND-комбинация (риски/в работе/переезды/по релизам); несовпадающее гаснет | filter-AND логика | средний |
| **Подсказки** | `_suggestOpen :3807` | `#gdt-suggest` | **4 правила (T-09)**; пустой «сбалансировано»; «Показать в Ганте» → flash-scroll | **`_suggestDerive` :3797** | **высокий** (бизнес-правила) |
| **Слой** | `_annotToggle :3890` | (маркеры на ячейках) | заметка в `q2_gantt3_annot_v1`; **НЕ мутирует план** (контракт!); round-trip ls | `_annotStore` round-trip | средний (контракт) |
| **Anatomy-popover** | `_anatomy :108` (click) | `.gdt-anatomy-pop` | поповер расшифровки пилюли; outside-click закрывает | — | низкий |
| **Радиал/Peek/Marquee** | `_radialOpen :3709` / `_peekOpen :2962` / `_marquee :113` | `.gdt-radial-*` / peek-pop | radial-menu на пилюле; peek-карточка по клику на лейбл; Shift+рамка → выделение; все закрываются по outside/Esc/scroll | — | средний (leak listener'ов) |

**Сквозные кейсы (ко всем режимам):** (1) open→close ×10 → 0 осиротевших `#gdt-*` узлов и 0 лишних listener'ов (T-04); (2) 0 `console.error`/`pageerror` при open/interact/close (T-03); (3) body НЕ содержит «Ошибка рендера вида» (T-12); (4) empty-state на `rows:[]` без throw (T-13); (5) после возврата на оригинальный `#gantt` — `body` чист от `gdt-*-on`/`gdt-g3-texture` (T-11).

---

## Приоритетный план

**P0 — сегодня, часы (Blocker → дёшево):**
1. **T-02** — добавить `{ key:'gantt3', label:'Гант 3.0' }` в `VIEWS[]` (`full-audit.spec.js:140`). 1 строка → gantt3 попадает в error-capture CI.
2. **T-ENV** — гидратировать рабочее дерево (материализовать cloud-evicted файлы), иначе baseline-цифры `npm run test:unit` ложно-красные. Проверка: `wc -c rowFactory.js` отдаёт ~15 КБ реального текста.
3. Создать `tests/playwright/gantt3-modes.spec.js` (Слой 1) — data-driven loop по `VIEW_MODES` + `TOGGLES`. Закрывает T-03 + T-04 + T-12 одним спеком.

**P1 — эта неделя (Critical/Major, средняя стоимость):**
4. **T-05** — вынести `buildDepGraph(deps, keys)` в `views/gantt/depGraphCore.js`, переиспользовать в `_lensBuildGraph` и `dependencyGraph._graph`; покрыть unit-тестами (цепь/ромб/цикл/self/пусто). Убирает дубль + ловит зацикливание.
5. **T-10 + T-08** — `views/gantt/ganttPureHelpers.js`: `pl`, `wtColor`, заменить 5 копий плюрализации; unit-тесты на границы.
6. **T-07** — вынести `replayMovesUpTo`, покрыть reverse-replay (k=0/N/середина/orphan/дубль-wt).
7. **T-11** — regression-тест «оригинальный Гант не задет» (Слой 1b).

**P2 — следующий спринт (Major/Minor, закрепление):**
8. **T-09** — unit на 4 правила `_suggestDerive` + empty.
9. **T-06** — контракт-инварианты `_collectEpics` (через DOM-стаб либо data-path рефактор).
10. **T-13** — empty-state каждого режима (`mockState({rows:[]})`).
11. **T-14** — Playwright keyboard-nav (roving tabindex сохраняется после re-render).
12. **T-15** — `_annotStore` round-trip + «не мутирует план».

**P3 — опционально:**
13. **Слой 3** — pixel-снапшоты `#gdt-mode-body` для статичных режимов (split/datagrid/report/anatomy); time-зависимые (mission/scrubber) — только smoke.

**Метрика успеха:** после P0–P1 — каждый из 9 режимов и 11 тогглов имеет smoke (open/render/close/no-leak), граф зависимостей и reverse-replay имеют unit-контракты, регрессия в оригинальный Гант ловится. Это переводит gantt3 из «0 % покрытия / релиз вслепую» в «контролируемая поверхность с регрессионной сеткой».
