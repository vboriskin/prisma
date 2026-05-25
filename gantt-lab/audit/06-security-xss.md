# Безопасность (XSS/инъекции) — экспертный аудит Ганта 3.0

> Эксперт: frontend security engineer (XSS / инъекции / утечки PII-секретов).
> Дата: 2026-05-24.
> Что покрыто: **все 69** `innerHTML`/`insertAdjacentHTML` в `views/gantt3.js` (6888 строк) и **все 7** в `views/dependencyGraph.js` (341 строка). Дополнительно прослежены sink-функции вне целевых файлов: `Utils.escapeHtml` (`utils.js:96`), `ToastQueue.show` (`app/uxKit.js:196`), `ConfirmDialog.show` (`app/uxKit.js:47`), `Toast` (`app/toast.js`), статика `GANTT_COL_LABELS`/`PHASE_COLOR_TOKENS` (`constants.js`), `GANTT_LEGEND` (`views/gantt/legendContent.js`), демо-данные (`onboarding/demoData.js`). Проверены доменные источники: имена эпиков, `who`/исполнители, имена команд, deps/blocks, **`transferComments[].text` (свободный текст)**, метки колонок (вкл. кастомные `rel.short`/`rel.label`), `ganttArrows.wt`, milestone labels, cell-notes/cell-risks, annotations.

---

## Резюме (есть ли реальные XSS-дыры?)

**Реальных XSS-дыр (P0/P1) НЕ обнаружено.** Дисциплина экранирования в Ганте 3.0 — образцовая и единообразная: каждый `innerHTML`-sink, в который попадают доменные/пользовательские данные, оборачивает их в `Utils.escapeHtml` (локально как `esc`/`_esc`). Это подтверждено чтением реального кода по каждому из 76 sink-сайтов, а не выборочно.

Ключевые «опасные» каналы проверены индивидуально и **безопасны**:

- **`transferComments[].text`** (свободный текст пользователя, самый опасный) — экранируется во ВСЕХ трёх местах вывода: в `data-tip` маркера-комментария на пилюле (`gantt3.js:4687`), в `data-tip`/`aria-label` самой пилюли (`gantt3.js:4714`→`4751-4752`) и в `data-tip` ghost-пилюли trail-строки (`gantt3.js:4922`). Payload `"><img src=x onerror=alert(1)>` в комментарии переноса рендерится как текст.
- **`style="--wt:" + _wtColor(p.wt)`** — `_wtColor` (`gantt3.js:3249-3253`) приводит `wt` к `toUpperCase().replace(/[^A-ZА-Я]/g,'')`, мапит по фикс-словарю, fallback всегда `var(--prizma-information)`. Произвольный `wt` (напр. `red;}</style><script>…`) НЕ может попасть в style-контекст сырым — наружу выходит только токен `var(...)` либо вайтлист-значение. Подтверждено.
- **`data-tk` / `data-epic-key` / `data-wt` / `data-col` / `data-row-id`** — при записи в HTML экранируются через `esc=Utils.escapeHtml` (кавычки → `&quot;`/`&#39;`), а при чтении назад из `dataset.*` подставляются в CSS-селекторы строго через `CSS.escape` (`cssEsc`/`_esc`). То есть HTML-контекст и селектор-контекст разведены корректно.
- **Кастомные метки релизов** (`rel.short`/`rel.label`/`c.label` — редактируются пользователем, AUDIT-22/23) — экранируются в шапке колодца (`gantt3.js:5042-5043`), в кнопке-«глазе» (`5089`), и во всех mode-видах через `esc(data.colLabel[c])`.

`Utils.escapeHtml` (`utils.js:96-103`) экранирует `& < > " '` — корректен и для текстового, и для атрибутного (в т.ч. одинарные кавычки) контекста.

Счёт находок: **P0 — 0, P1 — 0, P2 — 1, P3 — 3** (всё — hardening/policy, не эксплуатируемые XSS).

---

## Находки

### P2-1 · Clipboard-«Копировать сводку» не проходит `CSV._scrubSecrets`
- **Файл:** `views/gantt3.js:2927-2939` (`_marqueeCopy`), а также radial-«Копир.» `views/gantt3.js:3767`.
- **Суть:** `navigator.clipboard.writeText(text)` экспортирует `epic · wt · rel` (имена эпиков, типы работ, метки релизов), собранные из DOM, **минуя** `CSV._scrubSecrets`. Политика CLAUDE.md: «все экспорты (CSV/JSON/bundle) ОБЯЗАНЫ проходить через `CSV._scrubSecrets`; любой новый export-path без него = security regression».
- **Вектор/пример:** это НЕ XSS (текст идёт в буфер, не в DOM). Реальный риск низкий: в сводку попадают только `epic/wt/rel` — секретов (`Bearer`/`token`/`apiKey`) в этих доменных полях нет, исполнитель (`who`) в marquee-сводку **не** включается, поэтому и PII-утечки нет. Тем не менее clipboard — это export-path, и формально он не покрыт скраббером; если завтра в сводку добавят `who`/комментарий/идентификаторы — регрессия станет реальной без явного гейта.
- **Рекомендация:** пропустить `text`/строку radial-copy через `CSV._scrubSecrets` (или явный мини-скраббер) перед `writeText`, либо задокументировать в коде, что сводка по контракту содержит только не-секретные плановые метки. Дёшево и закрывает policy-gap на будущее.

### P3-1 · `_esc` в dependencyGraph.js не экранирует одинарную кавычку
- **Файл:** `views/dependencyGraph.js:23-25`.
- **Суть:** локальный `_esc` экранирует `& < > "`, но НЕ `'`. Сейчас безопасно, т.к. все атрибуты в файле — на двойных кавычках (`data-epic="…"`, `data-rm-dep="…"`, `title="…"`), а `"` экранируется. Это «висячая» хрупкость: любой будущий атрибут на одинарных кавычках станет инъектируемым через имя эпика типа `' onmouseover='alert(1)`.
- **Рекомендация:** добавить `.replace(/'/g,'&#39;')` для паритета с `Utils.escapeHtml`, либо импортировать `Utils.escapeHtml` напрямую.

### P3-2 · `summary` с сырым именем эпика уходит в кросс-модульные модалки
- **Файл:** `views/gantt3.js:5874, 6305, 6335, 6363` (передаётся в `Services.App.openGanttAddTargetModal({summary})` / `requireMoveComment`).
- **Суть:** `summary = \`${row.epic||…}: …\`` строится без `esc` и уходит в модалку, определённую вне аудируемых файлов (`Services.App`, исторически из `views/gantt.js:2890` — паттерн дотатирует Ганта 3.0). Это НЕ sink в gantt3.js (в DOM здесь не пишется), но это реальный data-flow наружу.
- **Рекомендация:** отдельно подтвердить, что рендер `openGanttAddTargetModal`/`requireMoveComment` экранирует `summary`/`message` (как это делает `ConfirmDialog.show`, `uxKit.js:55-66`). Если модалка строит `innerHTML` из `summary` без esc — это будет P1 уже в app-слое. Вне периметра данного аудита (gantt3.js/dependencyGraph.js), помечено как требующее проверки.

### P3-3 · Сырой `wt` в тексте тоста (defense-in-depth, не дыра)
- **Файл:** `views/gantt3.js:3777` (`_radialSimilar`), `2398` (catalog `.sub`).
- **Суть:** `wt` подставляется в строку тоста / в `.sub` каталога без локального `esc`. **Эксплуатации нет:** тост экранирует `& < >` на своём слое (`uxKit.js:230` `safeText`), а `.sub` каталога экранируется при рендере меню (`esc(o.sub)`, `gantt3.js:2455`). Помечаю только как стилистический разнобой — экранирование происходит «вдалеке» от места конкатенации, что усложняет ревью.
- **Рекомендация:** опционально — экранировать на месте формирования строки, чтобы инвариант был локально очевиден.

---

## Подтверждённо безопасные места (выборочно)

| Узел | Файл:строка | Чем защищено |
|---|---|---|
| Командная палитра «Прыжок» (epic/team/task) | `gantt3.js:1597-1636` | `esc=Utils.escapeHtml` на `label/sub/key/kind/rowId`; jump через `cssEscape` |
| Pill-anatomy popover (вкл. `cmtTip` из `data-tip`) | `gantt3.js:2584-2591` | `esc()` на name/epic/who/relLabel/period/cmtTip |
| Фокус-дорожка (sidebar + lane) | `gantt3.js:2243-2262` | `esc()` на team.name/key, epic, p.wt, p.who; `wc()` в `--wt` |
| Нарратив (абзацы + TOC + track) | `gantt3.js:2682-2734` | `esc()` на epic/who/wt/lbl/teamName/mv.label |
| North-star / Компас (сегменты + вехи) | `gantt3.js:2816-2837` | `esc(headTxt)`, `esc(lbl)`, milestone label экранирован; позиции `.toFixed()` |
| Peek-quicklook | `gantt3.js:2982-3000` | `esc()` на rel/wt/epic/team/statusV |
| Burndown SVG | `gantt3.js:3116-3123` | только числовые координаты + токены |
| `_modeEpicCard` (split/zen карточка) | `gantt3.js:3262-3296` | `esc()` на colLabel/wt/who/dep/blocks/team/epic; `wc()` в style |
| Data-grid (таблица + сортировка) | `gantt3.js:3331-3353` | `esc()` на label/wt/who/team/epic/deps; ширины `Math.round` |
| Report / Deck / Mission / Scrubber / Merge | `gantt3.js:3389-3521` | `esc()` на epic/team/wt/colLabel/ms.label; числа/токены в style |
| Radial-меню (SVG секторы) | `gantt3.js:3736-3740` | `esc(s.label/wt/rel)`; координаты `.toFixed()`; `data-key` — литерал |
| Smart-suggest | `gantt3.js:3812-3818` | `esc(title/why)`, `esc(epicKey)`; `_esc=CSS.escape` только в селекторе (`3822`) |
| Annotations popover | `gantt3.js:3927` | `Utils.escapeHtml(cur)` в `<textarea>`; `.title` через DOM-prop (`3905`); `_esc=CSS.escape` только в селекторе (`3901`) |
| **Pill builder** (главный hot-path) | `gantt3.js:4664-4760` | `esc()` на wt/row.id/colKey/assignee/period/**cmt.text**/initials; `aria-label`/`data-tip` экранированы целиком |
| Epic-row + deps-badge + churn-badge | `gantt3.js:4540-4595` | `esc()` на cat/epicKey/`_depsTooltip`(список deps)/churnTip |
| Team-header (rail/mono/spark/bucket) | `gantt3.js:4463-4519` | `esc()` на tk/team/tMono/col.key/wt; spark height `.toFixed(0)%` |
| Trail-строки переносов | `gantt3.js:4937-4961` | `esc()` на wt/row.id/srcCol/dstCol/`a.at`/dt/`_trailFullText`/cmt.text |
| Header колодцев (today-pill/flow/dist) | `gantt3.js:5033-5116` | `esc()` на todayLabel/subPretty/`c.label`(вкл. кастом)/wt; ширины `.toFixed(2)%` |
| Финальная сборка `wrap.innerHTML` | `gantt3.js:5157` | склейка уже-экранированных фрагментов; milestone-lines `5154` экранированы |
| Add-type picker | `gantt3.js:5848-5862` | `esc(t)` в value и тексте |
| KB-drag / drop-feedback селекторы | `gantt3.js:5492,5613,5726` | `_esc=CSS.escape` — корректный селектор-контекст, НЕ HTML |
| Lens-wires SVG | `gantt3.js:2123-2133` | числовые координаты + токены; роли через `.textContent` (`2098`) |
| DependencyGraph: карточки/команды/readout/chips | `dependencyGraph.js:165-273` | `_esc()` на epic/team/rel/`_short(c)`/`data-rm-dep`; ConfirmDialog экранирует message |
| DependencyGraph wires/redraw | `dependencyGraph.js:251-256, 331` | числовые координаты + токены |

Доп. инфраструктура: `Utils.escapeHtml` корректен (`utils.js:96`); `ToastQueue.show` экранирует `msg`/`subText` (`uxKit.js:230-231`); `ConfirmDialog.show` экранирует title/message/labels (`uxKit.js:55-71`); `demoData.js` — благонадёжные демо-строки без payload-ов (источник формы данных, не вектор).

---

## Приоритетный план

1. **P2-1 — Clipboard scrub (10 минут).** Прогнать строку из `_marqueeCopy` (`gantt3.js:2937`) и radial-copy (`3767`) через `CSV._scrubSecrets` ИЛИ зафиксировать в коде контракт «только не-секретные плановые метки». Закрывает единственный формальный policy-gap до того, как в сводку добавят `who`/комментарии.
2. **P3-1 — Паритет `_esc` (2 минуты).** В `dependencyGraph.js:23-25` добавить экранирование `'` (или заменить на `Utils.escapeHtml`). Снимает «висячую» хрупкость для будущих single-quote атрибутов.
3. **P3-2 — Кросс-модульная проверка модалок (вне периметра).** Подтвердить экранирование `summary`/`message` в `Services.App.openGanttAddTargetModal` и `requireMoveComment`. Если там сырой `innerHTML` — эскалация до P1 в app-слое.
4. **P3-3 — Косметика (опц.).** Локализовать `esc(wt)` в `_radialSimilar`/`_cmdCatalog`, чтобы инвариант экранирования читался на месте конкатенации.

**Вывод:** Гант 3.0 в части XSS/инъекций — в хорошем состоянии. Контракт «HTML только через `Utils.escapeHtml`» соблюдён сплошняком по всем 76 sink-сайтам; разделение HTML-контекста (`escapeHtml`) и селектор-контекста (`CSS.escape`) выдержано; самый опасный свободный текст (`transferComments.text`) экранирован везде. Остаются только hardening/policy-мелочи (P2/P3), не являющиеся эксплуатируемыми уязвимостями.
