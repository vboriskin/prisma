# Аудит вкладки «Действия» (Action Layer) — V21

**Область:** `app/actionLayer.js`, `index.html` `#section-actions`, CSS `.al-*`, `app/prizmaUI.js`
**Дата:** 2026-05-05
**Эксперты:** Visual / Brand · Frontend / HTML · UX / Product · Domain (квартальное планирование)
**Шкала severity:** **CRIT** — блокирует юзера или ломает инвариант · **HIGH** — заметная потеря качества/доверия · **MED** — раздражает, но обходимо · **LOW** — косметика

---

## Сводка

Action Layer — каталог из 21 массового действия с модалкой выбора scope+параметров. Архитектура аккуратная (CATALOG-driven, scope resolver отдельно), но вкладка осталась в «инженерном» состоянии: дубль page-header, hard-coded хвосты `#fef3c7` мимо токенов, нет focus-trap у модалки, нулевой undo, нет confirm-step для разрушительных действий, не показываются результаты применения, и ряд критичных квартальных операций (move, deadline shift, dependency edit) **не покрыт каталогом** вовсе. Ниже — 16 пунктов с привязкой к `file:line`.

---

## 1. **CRIT · UX/Product** — Нет confirmation-step и нет undo для разрушительных действий
**Где:** `app/actionLayer.js:79-107` (`runAction`) + `:191-206` (`_applyModal`).
**Что:** «Снять все релизы», «Сбросить к базовому», «Снять флаги риска» и «Отметить готовыми» применяются по одному клику «Применить», без summary-confirm («вы собираетесь изменить N задач, продолжить?») и без `Undo`-toast. `state.actionLog` пишется (line 83 и далее), но обратной операции нет. Учитывая что scope=`all` доступен по умолчанию (line 167) и каталог содержит `clear_release` без params — пользователь одним промахом мыши может сбросить релизы у всего реестра.
**Предложение:**
1. Двушаговая модалка для destructive-действий (флаг `destructive: true` в CATALOG-записи): step 1 — параметры, step 2 — preview изменений + чек-бокс «Я понимаю, что отменить можно только из истории».
2. Snapshot перед mutation + `Undo` в toast 10 секунд (через тот же mechanism, что `state.actionLog`, но с обратным diff).
3. Если `state.simMode === false` и `ids.length > 50` — обязательный confirm.

---

## 2. **CRIT · Domain** — В каталоге отсутствуют ключевые квартальные операции
**Где:** `CATALOG` `app/actionLayer.js:27-49`.
**Что:** Для квартального планирования отсутствуют:
- **Bulk move release** (перенос задач из 1.20 → 1.21 при переоценке). Сейчас можно только «Назначить» (добавить), но не переместить — придётся отдельно делать `clear_release` + `assign_release`, что разрывает атомарность и ломает action-log.
- **Deadline shift** (сдвинуть `dueDate` на N дней).
- **Bulk edit blocking dependency** (поставить/убрать `blockingDependency` со ссылкой). Есть только `clear_blocker` (line 40).
- **Bulk reassign по правилу** (например, «переназначить все задачи Иванова на Петрова» — `set_assignee` работает только на уже выбранные).
- **Bulk close + reason** (отметить готовыми с заметкой «отменено в Q2»).
- **Merge duplicate epics** или «применить epic из dropdown к выбранным».
**Предложение:** Добавить в CATALOG минимум: `move_release` (`from`/`to`/`types`), `shift_deadline` (`days` ±), `set_blocker` (`source-id`/`note`), `reassign_from_to` (`from`/`to`), `close_with_reason` (`reason`-textarea).

---

## 3. **HIGH · Frontend/HTML** — Модалка не имеет focus-trap, фокус не возвращается
**Где:** `index.html:1158` (контейнер `#al-modal`) + `app/actionLayer.js:155-165` (`openModal`).
**Что:** При открытии модалки (`modal.classList.remove('hidden')`) фокус не переносится внутрь (стандартный паттерн — на первый интерактивный элемент / `aria-labelledby`-заголовок). Tab-cycle не ограничивается рамками модалки — Tab уводит фокус в подложку. Esc не закрывает (только клик по overlay, line 164). При закрытии фокус не возвращается на ту карточку, с которой открыли. Это нарушает WCAG 2.4.3 / 2.1.2.
**Предложение:**
- Сохранить `document.activeElement` перед `remove('hidden')`, восстановить при закрытии.
- `focus()` на `#al-modal-cancel` либо первый `[name]`-input.
- `keydown` на overlay: `Tab/Shift+Tab` зацикливать через `querySelectorAll('button,input,select,textarea')`; `Esc` → cancel.
- Атрибут `inert` на `#app-root` (или хотя бы `aria-hidden="true"`) пока модалка открыта.

---

## 4. **HIGH · Visual/Brand** — Хардкод цвета `#fef3c7`/`#92400e` мимо signal-палитры
**Где:** `styles.css:5585-5586` (`.al-mass-badge`) и `styles.css:5596` (`.al-log-sim` border `#f59e0b`).
**Что:** Брендбук Призмы (V15+) запрещает gradients и хардкод HEX вне `--prizma-*` токенов. `.al-mass-badge` — амбер из tailwind-палитры, не из signal-палитры. На dark theme сделан override (`.al-log-sim` остался без override → плохой контраст). `--prizma-information` для остальных бейджей — корректно, но «массовая» — это не information, ближе к **drift/warn** semantic.
**Предложение:** Завести `--prizma-warn-bg`/`--prizma-warn` в `tokens/theme.css` (если ещё нет — переиспользовать `--prizma-drift-bg`) и заменить `.al-mass-badge` + `.al-log-sim` на токены с темной поддержкой через единый `--prizma-warn`.

---

## 5. **HIGH · UX/Product** — Дубль page-header и фактически legacy-блок `.al-header`
**Где:** `index.html:1149-1155` (`.al-header` с `<h2>Action Layer</h2>` + sub) и `app/actionLayer.js:114-123` (вставляет `renderPageHeader('actions')` в начало секции).
**Что:** В DOM на `#section-actions` сейчас два заголовка: статический «Action Layer» из HTML и динамический prizma page-header сверху него. Получаем H2 latin без перевода («Action Layer») плюс корректный H1 «Действия» из `getSectionLabel('actions')`. Нарушает heading-iерархию и брендинг (англ. «Layer» в проде).
**Предложение:** Удалить статический `.al-header` блок из `index.html:1150-1153` целиком; sub-текст переехал в `renderPageHeader('actions', { sub })` уже в line 122.

---

## 6. **HIGH · Frontend/HTML** — Карточки действий не tab-доступны и не имеют ARIA-роли
**Где:** `app/actionLayer.js:135` (генерация `<div class="al-action-card">`) + `:153` (`addEventListener('click')` на карточке).
**Что:** `al-action-card` — это `<div>` с `cursor:pointer` и `click`-обработчиком, но без `tabindex`, без `role="button"`, без `keydown` на Enter/Space. Кнопка `.al-run-btn` внутри карточки доступна, но клик по самому ярлыку — только мышью. Скринридер озвучит карточку как обычный текст. Нарушает WCAG 2.1.1 / 4.1.2.
**Предложение:** Либо дать карточке `tabindex="0"` + `role="button"` + `aria-describedby` на `.al-action-desc` + `keydown` на Enter/Space запускающий тот же `openModal`, либо (предпочтительнее) убрать клик с обёртки и оставить **только** `.al-run-btn` как точку входа, а карточку сделать обычным неинтерактивным контейнером (drop `cursor:pointer`).

---

## 7. **HIGH · UX/Product** — Scope `criteria` рассинхронизирован: 4 опции без поля и 4 с полем
**Где:** `app/actionLayer.js:168` (`select#al-criteria-key`) и `:63-76` (`_byCriteria`).
**Что:** Опции `no_release`/`blockers`/`risky`/`review_flag` — boolean-фильтры (значение игнорируется), но input «значение» остаётся видимым и пустым → пользователь не понимает, нужно ли что-то вводить. Опции `release/scope/priority/assignee` — value-required, но без датасета дозволенных значений (свободный текст), что особенно странно для `priority` (всего 3 значения). При пустом value `_byCriteria` возвращает `[]` (line 64), и `runAction` молча покажет toast «Нет задач» (line 105) — без объяснения почему.
**Предложение:**
- Динамически прятать `#al-criteria-val` для boolean-критериев.
- Заменить `<input>` на `<select>` для `priority/scope/release` (значения ровно те же, что в action-params).
- При пустом value у value-критерия — disable «Применить» + inline-validation-message, не toast.

---

## 8. **HIGH · Domain** — `criteria.release` опции «120/121/122/ot» хардкоднуты в трёх местах
**Где:** `app/actionLayer.js:28` (assign_release opts), `:30` (set_release_type opts), `:31` (auto_assign_release opts), `:66` (`_byCriteria` release-проверка).
**Что:** Если завтра появится релиз 1.23 — нужно обновить минимум четыре строки и не забыть `state.rows` поле `release123Types`. Это противоречит V17 контракту «релизы — конфиг, не код». Тесты этого не поймают (нет contract-теста на consistency).
**Предложение:** Завести в `state.js` (или `constants.js`) `RELEASE_KEYS = ['120','121','122','ot']` + helper `getReleaseTypes(row, key) → row[`release${key}Types`] || (key==='ot' ? row.overtimeTypes : null)` и переиспользовать. По факту покроет ещё и `_byCriteria.no_release` (line 70) — там тот же хардкод.

---

## 9. **MED · Visual/Brand** — Кнопки категорий (`.al-cat-btn.active`) — filled-фон вместо 3px-stripe
**Где:** `styles.css:5556`.
**Что:** `.al-cat-btn.active { background: var(--prizma-information); color:#fff; }` — это pre-spine-pill стиль (полная заливка). Брендбук V15: «3px stripe-left для активных/выделенных вместо filled background». Карточки уже мигрированы (`.al-action-card:hover` line 5575 — `box-shadow: inset 3px 0 0`), а cat-bar — нет.
**Предложение:** Заменить на `border-left: 3px solid var(--prizma-information)` + `color: var(--prizma-information)` + `background: var(--prizma-information-bg)` (4-6% tint), без сплошной заливки. Альтернатива — pill-стиль с очень бледным фоном, но stripe ближе к стандарту вкладок.

---

## 10. **MED · Frontend/HTML** — Накопительный `setTimeout(…, 0)` + onclick handlers, риск утечки
**Где:** `app/actionLayer.js:189` (`setTimeout(()=>{ … addEventListener … },0)`) и `:162-164` (`document.getElementById('al-modal-apply').onclick = …`).
**Что:** `_bindScopeCounter` навешивает обработчики с задержкой, но при повторном `openModal` они навешиваются **ещё раз** — у одного `#al-scope-type` будет N listeners. Это видно глазами, если открыть модалку → закрыть → открыть несколько раз: scope-preview-update срабатывает кратно. `apply/cancel` через `.onclick = …` (а не `addEventListener`) случайно спасает их, но это разные паттерны в одном файле.
**Предложение:**
- Перед навешиванием в `_bindScopeCounter` клонировать узлы (`replaceWith(cloneNode)`) или использовать делегирование от `#al-modal`.
- Привести `apply/cancel` к `addEventListener` + удалять при закрытии.
- Альтернатива дешевле: `_bindScopeCounter` → `oninput`/`onchange` (заменяемый), не `addEventListener`.

---

## 11. **MED · UX/Product** — Нет результата применения и нет ссылки на «Историю»
**Где:** `app/actionLayer.js:79-107` (`runAction`).
**Что:** После `applyBulkAction` пользователь не видит, сколько именно задач изменилось (для большинства веток нет даже `showToast('применено к N')`). `state.actionLog.unshift(...)` пишется только для 4 mass-действий (lines 83, 89, 95, 101) — для regular `applyBulkAction` (line 106) журнал ведёт сам dataStore, но обратной связи в UI нет. Журнал в Action Layer теперь no-op (line 148, V17.1 I1 «дубль Истории») — значит юзеру некуда смотреть на результат, кроме прогрузки реестра в фоне.
**Предложение:**
- Toast `«Применено к N задач · Открыть в Истории →»` после каждого `runAction`.
- Inline-summary прямо в той же модалке: success-state с кнопками `Закрыть` / `Применить ещё раз` / `Открыть Историю`.
- Передавать `applyBulkAction` actual-count, не полагаться на `ids.length`.

---

## 12. **MED · Domain** — `set_assignee` с типом `assignee`-input — без identity-привязки
**Где:** `app/actionLayer.js:36` + `:175` (датасет `al-assignee-list`).
**Что:** Исполнитель выбирается как **строка имени** (datalist на `state.rows[].assignee`), хотя в проекте есть identity-таблица `state.employees[]` (V17.2 I1c — email/jiraAccountId/bitbucketLogin). Bulk-reassign через имя нарушает «identity-deterministic attribution» из CLAUDE.md контракта №2: новое имя может не совпасть ни с одним сотрудником, и интеграции потеряют связь.
**Предложение:** Заменить `assignee`-input на selector сотрудников из `state.employees`, сохранять в row не имя, а employeeId/email; имя — derived. Если backwards compat обязателен — хотя бы валидировать на `state.employees.find(e => e.fullName === val)` и предупреждать если нет матча.

---

## 13. **MED · Frontend/HTML** — Внешний CSS внутри inline `style=""` в шаблонах
**Где:** `app/actionLayer.js:168` (`style="display:flex;gap:6px;..."`, `style="width:120px"`), `:173` (`style="width:16px;height:16px;cursor:pointer"`).
**Что:** Inline-стили обходят токены (`var(--gap-2)` etc.), не подхватывают темные темы и затрудняют a11y-override (например, `prefers-reduced-motion` не сработает на cursor). Это технический долг, не критика, но в папке Призмы такие хвосты попадаются всё чаще.
**Предложение:** Вынести в `.al-criteria-inline { display:flex; gap:6px; align-items:center; }`, `.al-criteria-val { width: 140px; }`, `.al-param-checkbox`. Размеры в `var(--space-*)`, не px.

---

## 14. **MED · Visual/Brand** — Иконка карточки на hover красится в `--prizma-information`, но badge внутри той же карточки уже информационного цвета — двойная информационная окраска
**Где:** `styles.css:5579` + `:5584`.
**Что:** При hover карточки вся иконка + бейдж + stripe — одного синего тона. Получается «всё кричит одновременно», а пользователю важнее увидеть **категорию** (badge несёт смысловую нагрузку про релизы/риски/команда). Брендбук Призмы: «accent — semantic only».
**Предложение:** На hover менять цвет иконки на `--text-1` (нейтральный, темнее), не на information; stripe остаётся information; badge оставить как есть. Альтернатива — окрашивать иконку **в цвет своей категории** (releases→information, risks→drift, scope→on-course и т.д.) — это сильно повышает скан-ридабильность каталога из 21 элемента.

---

## 15. **LOW · UX/Product** — Не сохраняется последний выбранный фильтр категорий между визитами
**Где:** `app/actionLayer.js:25` (`_activeCat: 'all'`).
**Что:** При каждом возврате на вкладку сбрасывается на «Все». Для повторяющихся работ (типичный сценарий — релиз-планирование за 5 минут до планёрки, на одной и той же категории) это лишний клик.
**Предложение:** Сохранять в `localStorage.prizmaActionLayerCat`, либо в `state.uiPrefs.actionLayerCat` (учитывая `Reactive.silent` контракт). Восстанавливать в `init()`.

---

## 16. **LOW · Frontend/HTML** — `select` категорий «по критерию» без `aria-expanded`, бейдж «массовая» без объяснения
**Где:** `app/actionLayer.js:135` (`<span class="al-mass-badge">массовая</span>`) и `:170-176` (param fields).
**Что:**
- `массовая` — без `title=`/`aria-label`. Юзер не знает, что бейдж означает «игнорирует scope, всегда применяется ко всему реестру».
- `<select>`/`<input>`-поля в `_renderParams` без `aria-describedby` на `.al-modal-desc`, scope-preview без `role="status" aria-live="polite"` (line 169) — изменение количества задач не озвучивается.
- `multicheck` чекбоксы (line 172) без `<fieldset>`/`<legend>` — нет группового SR-объявления.
**Предложение:**
- `title="Игнорирует выбранную область — выполняется по всему реестру"` на `.al-mass-badge`.
- `<span class="al-scope-preview" id="al-scope-preview" role="status" aria-live="polite">`.
- Обернуть `multicheck` в `<fieldset class="al-multicheck-fs"><legend class="al-param-label">…</legend>…</fieldset>`.

---

## Приложение — quick wins (1-2 строки кода)

| # | Где | Изменение |
|---|---|---|
| QW1 | `app/actionLayer.js:135` | Добавить `title="${a.mass ? 'Игнорирует область — применяется ко всему реестру' : ''}"` на `.al-mass-badge` |
| QW2 | `app/actionLayer.js:169` | `<span ... role="status" aria-live="polite">` |
| QW3 | `index.html:1150-1153` | Удалить статический `.al-header` (см. п.5) |
| QW4 | `app/actionLayer.js:135` | Заменить `<div class="al-action-card">` на `<button class="al-action-card">` (дешёвый way получить tab-доступ + Enter, см. п.6) |
| QW5 | `styles.css:5585` | Заменить `#fef3c7`/`#92400e` на `var(--prizma-drift-bg)`/`var(--prizma-drift)` (или новые `--prizma-warn-*`) |
| QW6 | `app/actionLayer.js:155-165` | Добавить `Esc`-handler: `modal.addEventListener('keydown', e=>{if(e.key==='Escape')close();})` |

---

## Резюме по приоритетам

- **Сейчас (этап 1):** п.1 (confirm + undo), п.3 (focus-trap + Esc), п.5 (двойной header), QW1-QW6 — низкая стоимость, высокая ценность.
- **Этап 2:** п.2 (расширить CATALOG до полного квартального набора), п.7 (criteria UX), п.12 (identity-привязка assignee).
- **Этап 3 (косметика и долг):** п.4, п.9, п.10, п.13, п.14, п.15, п.16.

Action Layer — потенциально самый мощный инструмент для PMO: 21 действие, scope-preview, массовый режим. Но без undo и confirm он сейчас «оружие массового сбоя». Закрыв п.1-3, получим продакт-grade-вкладку.
