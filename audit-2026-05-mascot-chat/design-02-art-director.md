# Design — art-director (brandbook + composition verdict)

> Жёсткое ревью композиции и соответствия §13.10 для интеграции маскота.
> Дата: 2026-05-07

## 1. §13.10 compliance — чек-листом

| # | Запрет | Статус | Комментарий |
|---|---|---|---|
| 1 | L4 jewel в продукте | ✅ OK | В DOM используется `#obs-base` (L1). Ни `#obs-L4-jewel`, ни inline-jewel-разметки нет. |
| 2 | Цветной маскот / градиенты / акценты на теле | ✅ OK | `.assistant-fab` `background:transparent`, без обводок и градиентов. Цвет тела через `--obs-body / --obs-feature`. |
| 3 | Произвольные позы вне библиотеки | ✅ OK | Контроллер использует только канонические классы из `STATE_CLASSES` (`obsidianMascot.js:24-37`). |
| 4 | Звезда внутри L0–L3 | ✅ OK | На FAB и avatar — чистый `#obs-base`, звезды нет. |
| 5 | Маскот без Breathe | ✅ OK | Init ставит `obs--breathe`, `_playOnce` всегда возвращает в `obs--breathe`. Защита есть. |
| 6 | Tier 1 на обычные события | ✅ OK | Emerge — только при `sessionStorage.q2_obsidian_emerged_v1 !== '1'`. Hibernate не используется автоматически (легко добавить idle-trigger). |
| 7 | ls-stop/ls-error без предшествующего streaming | ⚠️ RISK | `setChatPhase('error')` может попасть и до первого `streaming` (если запрос упал на этапе `thinking`). Семантически допустимо, но прямо §13.9 не нарушает — однако чистый `'stop'` вне streaming — нонсенс. Защиты в контроллере нет. |
| 8 | Маскот рядом с логотипом Призмы | ✅ OK | На FAB логотипа нет, в шапке чата только Обсидиан + текст «Помощник по планированию», лого Призмы там нет. |
| 9 | Анимации на reduced-motion | ✅ OK | `obsidianMascot.js:81-84` + `obsidian.css:943` глобальный media-guard. Emerge при reduced-motion заменяется на сразу-Breathe. |
| 10 | Эмодзи / доп. элементы рядом с маскотом | ⚠️ PARTIAL | Рядом с FAB элементов нет. **В шапке чата рядом с avatar 32×32 идёт текст, и в правом крае шапки сидит кнопка `assistant-btn-clear` с `data-icon="sparkles"`** — SVG-icon ≠ эмодзи, формально не нарушение, но «искра» рядом с маскотом который сам несёт звезду внутри — серая зона. |

## 2. Нарушения именно в новой mascot-интеграции

### M1 (MED, §13.9 stacking)
В `_playEmergeIfFirstSession` Emerge ставится через `setTimeout(2400ms)` без отметки «t1-active». Если пользователь успеет открыть чат за эти 2.4с, `llmAssistant` вызовет `setChatPhase('thinking')` → на **chat-avatar** заиграет `obs--ls-thinking`, а на **FAB** ещё догорает `obs--emerge`. Формально это два разных DOM-элемента, поэтому stacking «на одном маскоте» не нарушен. Но семантически — два режима одного объекта одновременно (FAB при открытом чате скрывается через opacity, не display).

Чтобы быть строгим: в `setFabVisible(false)` не сбрасывается `obs--emerge` → если Emerge ещё идёт, он крутится «вслепую» под opacity 0.

### M2 (LOW)
`_wireFabHover` блокирует Curious только если идёт `obs--emerge` или `obs--alert`. Между mouseenter (Curious 2200ms loop через `_setLoop`!) и mouseleave: `_setLoop` ставит **loop**, но `obs--cur` в `obsidian.css:194` объявлен как `both` (one-shot). Curious отыгрывает 2.2с и **застревает в end-state** до mouseleave — нет «возврата к Breathe» если курсор не уходит. Также при mouseleave посреди анимации `_setLoop(_, 'obs--breathe')` мгновенно сбрасывает классы → **возможен микро-jump** (тело/глаза телепортируются из конечной позы Curious в neutral).

### M3 (LOW) — прямой §13.10 п.5
`setChatPhase('error')` → `_playOnce(avatar, 'obs--ls-error', 'obs--concerned')`. После `'error'` базовое состояние **`obs--concerned`** — это Tier 2 one-shot класс, объявленный как `both` в `obsidian.css:465-469`, **не loop**. Маскот зависнет в финальном кадре Concerned → нарушение §13.10 п.5 «маскот без breathe выглядит мёртвым».

Должно быть `'obs--breathe'` (а concerned — кратко поверх перед возвратом, через alive-stack).

### M4 (LOW)
Theme-switch посреди Alert/Emerge. Ни `pulseAlertOnFab`, ни Emerge не подписаны на `prefers-color-scheme` / `[data-theme]` change. CSS-vars `--obs-body / --obs-feature` сменятся мгновенно, но если в этот же кадр сработает `animationend` от Alert — сброс классов и ничего страшного. Однако в `_playOnce` есть safety `setTimeout(3500)` без `clearTimeout` при «нормальном» finish — таймер всё равно стрельнёт ещё раз и повторно вернёт в Breathe (двойной reset).

### M5 (LOW)
В `styles.css:4613` блоке `.assistant-fab` нет `overflow: visible` — а `obsidian.css:63` ставит его на `.obs`. Проверка: Alert ring (`obs--alert .obs-ring`) рисуется в SVG `viewBox="-60 -60 120 120"`, т.е. внутри своих 56×56 — но pulse расширяется до радиуса 70+ единиц SVG. В пиксельном пространстве FAB 56×56 с `overflow:visible` на child, button по умолчанию overflow:visible — не клипится. Здесь всё хорошо, **но стоит зафиксировать в комментарии**.

### M6 (UX recommendation)
**Нет caps-eyebrow** под bubble-сообщениями (типа «PRIZMA · СВЕРЯЕТ КУРС» с reference-скриншотов). В проекте есть готовый стиль `.prizma-card-eyebrow` / `.prizma-page-eyebrow` (`styles.css:538, 699`) с правильным CAPS 11/1.5. Чат-bubble его не использует.

## 3. Топ-5 art-direction рекомендаций

1. **Emerge guard с глобальным флагом.** В контроллере добавить `this._t1Active = true` на старте Emerge и `false` в `finally`. Любой `setChatPhase` / `_setLoop` в это время → no-op + queue. Это закроет M1 строго по §13.9.

2. **Curious — настоящий loop или fade-back.** Либо переделать `obs--cur` на бесконечный loop (3-act с restart), либо добавить в JS `transitionend`-bridge: на mouseleave сначала плавный 200ms `transform-origin` reset, потом класс. Сейчас визуально возможен jump.

3. **Error → Breathe, не Concerned.** В `setChatPhase('error')` правильно: `_playOnce(avatar, 'obs--ls-error', 'obs--breathe')`. Если нужна «грусть» — стакать через `.obs--alive` Concerned поверх Breathe, но не возвращать в чистый Concerned (он не loop).

4. **Caps-eyebrow «PRIZMA · …» под avatar в шапке чата.** Заменить subtitle `Контекст: текущий вид` на двух-уровневую конструкцию: `<div class="prizma-card-eyebrow">PRIZMA · ПОМОЩНИК</div>` + сам режим контекста ниже. Это даст вкус эталонных макетов и встаёт в существующий бренд-токен без нового CSS.

5. **«Sparkles» в шапке чата отнести от avatar.** Кнопка «Новый» с `data-icon="sparkles"` физически прилегает к avatar через flexbox шапки. По §13.10 п.10 — серая зона. Перенести action-кнопки в правый край или заменить glyph на `plus` / `refresh` — нейтральнее семантически.

## 4. Финальный verdict

**Требуется 3 правки** перед выкаткой:
- **M1** (Emerge guard / interaction lock на 2.4с) — обязательно.
- **M3** (error → breathe в `setChatPhase('error')`) — обязательно, прямой §13.10 п.5.
- **M2** (Curious end-state jump) — желательно до выкатки, без него визуально «рваный» hover.

Остальное (M4–M6, рекомендации 4–5) — follow-up в тот же спринт. **Базовая дисциплина §13.10 (1–4, 6, 8, 9) выдержана корректно**; transparent-wrapper FAB без surface на 24px от края — соответствует reference-композиции от заказчика, маскот **не теряется** именно из-за «дыхания» Breathe + facet-edges, дающих ему собственный визуальный вес без подложки.

### Ключевые файлы
- `app/obsidianMascot.js` (`_playEmergeIfFirstSession` 106-122, `setChatPhase` 184-212, `_wireFabHover` 124-141)
- `styles.css:4613-4665` (FAB + chat-avatar)
- `index.html:1329-1343` (FAB + avatar markup), 1359-1361 (sparkles рядом)
- `obsidian/obsidian.css:194` (Curious `both`), `:465-469` (Concerned `both`), `:500-509` (Emerge), `:943` (reduced-motion)
- `app/llmAssistant.js:1058,1122,1131,1169,1178` (phase wiring)
