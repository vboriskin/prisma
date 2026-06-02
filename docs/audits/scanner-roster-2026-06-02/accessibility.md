# Аудит таблицы сотрудников: Accessibility

**Эксперт:** A11y-инженер, фокус на assistive tech (NVDA, JAWS, VoiceOver) в data-intensive tools.
**Дата:** 2026-06-02

## Резюме

Roster в Scanner-е заявляет о a11y (см. метки `V18.1 P7-S3.1`, P7-S1.5, P7-S1.6, P7-S3.1), но реализация наполовину сломана. Главное: row — это `<div role="button">` с вложенными SVG-иконками, source-chips и тултипами, которые скринридер либо не озвучивает вообще, либо озвучивает мусором («B 2 J 3 C 0»). Focus trap в detail-панели держит фокус, но не блокирует ассистивную навигацию по фону (`inert`/`aria-hidden` не выставлены), Tab «утекает» в кэбаб-меню и в roster под backdrop. Heatmap 72×4 имеет хороший parent-summary, но ось времени промаркирована `aria-hidden`, и пользователь screen-reader-а не получает шкалы. Цветовая контрастность signal-токенов (drift amber `#f59e0b` на белом) проваливает WCAG AA на текстах < 18pt. И, наконец, в коде сидит метка `// «коммиты есть, PR не открывает» как сигнал — judgemental` — но в DOM по-прежнему рендерится строка-стигма «Требует разговора» (`teamScanner2RendererPersonRows.js:34`), которую SR озвучивает дословно каждый раз при заходе в группу.

## Находки

### 1. Row как `<div role="button">` с вложенными ссылками/кнопками = focus и SR-кошмар

**Описание:** `teamScanner2RendererPersonRows.js:296` рендерит:
```html
<div class="ts2-row" tabindex="0" role="button" aria-expanded="..." aria-controls="ts2-panel-main">
  ...счётчики, src-chips, badges...
  <span class="ts2-chev">[SVG icon]</span>
</div>
```
Внутри row сидят чипы (`.ts2-row-src-chip` — div с двумя дочерними span), `data-clickable` counters, иконки-бэйджи. Click-handler делегирован, и `_bindDashboardEvents` (teamScanner2.js:2545) использует `if (e.target.closest('a, button')) return` — но в самой строке нет `<a>`/`<button>`, всё это `<span>` с `title`. SR (NVDA в browse mode) озвучивает: «Иван Иванов, кнопка, свёрнуто, B 2 J 3 C 0 4 в пути 3 PR 5 задач 12 ч, кнопка». 9-10 секунд без структуры.
**Зачем чинить:** WCAG **4.1.2 Name, Role, Value** и **2.4.6 Headings and Labels** — пользователь со SR должен с первого arrow-down получить смысл строки. Сейчас пользователь не может: (а) понять что человек в группе «stop», (б) услышать счётчики как «3 PR» а не «3 PR», (в) пропустить chip'ы, потому что они не aria-hidden и нет grouping.
**Как чинить:**
- Заменить корень на `<button>` или хотя бы дать row `aria-label="Иван Иванов, требует внимания, 3 события сегодня, 5 событий вчера, 4 задачи в работе, 3 PR. Раскрыть детали."` — единый pre-composed string из переменных в renderRow.
- Каждый дочерний `.ts2-row-src-chip`/`.ts2-counter`/`.ts2-badge` пометить `aria-hidden="true"` — они визуальный дубль того, что уже в aria-label.
- `aria-controls="ts2-panel-main"` (строка 296) указывает на элемент, который НЕ существует в DOM пока row не expanded — это IDREF-error. Использовать `aria-expanded` без `aria-controls`, либо рендерить пустой `<div id="ts2-panel-main" hidden>` всегда.

**Критичность:** high. **Сложность:** medium. **Ценность:** high.

---

### 2. Focus trap пробивается, `inert` на фон не ставится

**Описание:** `teamScanner2.js:2617-2628` ловит Tab и силой возвращает фокус через `panel.focus()`:
```js
this._escHandler = (e) => {
  if (e.key === 'Escape') { this._closePanel(); return; }
  if (e.key !== 'Tab') return;
  const active = document.activeElement;
  if (!panel.contains(active)) {
    e.preventDefault();
    panel.focus();
  }
};
```
Проблемы:
- Tab после ✕ перепрыгивает на panel-root (focus уходит на `tabindex=-1` контейнер) → пользователь теряет позицию.
- Shift+Tab от первого focusable элемента не возвращает в конец панели — `panel.focus()` ставит фокус на сам диалог, дальше Tab уходит в browser chrome.
- `.ts2-row[tabindex=0]` и весь roster под backdrop остаются в Tab-цепочке (Tab проходит через них как «мерцание» — focus перепрыгивает, screen reader озвучивает свернутые строки за модалкой).
- VoiceOver Rotor / NVDA в browse mode полностью игнорируют focus-trap и читают весь roster под модалкой.

**Зачем чинить:** WCAG **2.4.3 Focus Order**, **2.1.2 No Keyboard Trap** (тут наоборот anti-pattern — псевдо-trap), **4.1.2** для роли `dialog`.
**Как чинить:**
- При открытии panel: `mainContent.setAttribute('inert', '')` (на `.ts2-root` без `.ts2-panel`). Это убьёт focus + SR access под backdrop одним атрибутом, поддерживается во всех современных браузерах с 2023.
- Заменить ручной Tab-handler на корректный circular focus loop: собрать `panel.querySelectorAll('[tabindex]:not([tabindex="-1"]), button, [href], input, select')`, на Tab из последнего → first, Shift+Tab из first → last.
- Возвращать фокус на initiating row при close (сейчас фокус остаётся на body после `_closePanel`).
- Backdrop click закрывает модалку без подтверждения — это OK, но SR должен это услышать через `_announce('Детализация закрыта')` (сейчас нет).

**Критичность:** high. **Сложность:** medium. **Ценность:** high.

---

### 3. Source-chips «B 2 / J 3 / C 0» произносятся ассистивом как мусор

**Описание:** `teamScanner2RendererPersonRows.js:223` рендерит:
```html
<span class="ts2-row-src-chip ts2-row-src-b" title="Bitbucket: коммиты / PR / комментарии за 72ч: 2 событий">
  <span class="ts2-row-src-chip-key">B</span>
  <span class="ts2-row-src-chip-num">2</span>
</span>
```
- `title` attr ВЫНУЖДЕННО снят с element-а позже в `_promoteTitlesToTooltips` (teamScanner2.js:2060) — `title` переезжает в `data-tip` для CSS-tooltip. Это значит, SR никогда не услышит расшифровку.
- Сами span'ы — `inline-flex`, без `role`/`aria-label`. NVDA в строчном режиме читает «B 2 J 3 C 0 Z 1». «J⚠» с SVG-иконкой alert-triangle (строка 226) — иконка имеет `aria-label="недоступен"`, но `J` рядом не озвучивается → «недоступен» без контекста.
- В chip'е Jenkins error (J⚠) — `aria-label` сидит на `<span>` (некликабельный, без role) → JAWS его игнорирует, NVDA озвучит непредсказуемо.

**Зачем чинить:** WCAG **1.3.1 Info and Relationships**, **3.3.2 Labels or Instructions** — labels должны быть в accessible name, не в `title`/`data-tip`.
**Как чинить:**
- Дать каждому chip полный aria-label на корневой элемент: `aria-label="Bitbucket: 2 события за 72 часа"`. Дочерние span'ы — `aria-hidden="true"`.
- Для J⚠ chip'а — `aria-label="Jenkins недоступен: <error>. Откройте Диагностику."` — один self-contained string.
- Альтернатива: вместо chip'ов в строке — `<dl>` (description list) с парами source→count, обёрнутыми в `role="group" aria-label="Активность по источникам"`.

**Критичность:** high. **Сложность:** low. **Ценность:** high.

---

### 4. Pulse-animation на `is-pulse-attention` — vestibular trigger при регрессе

**Описание:** `teamScanner2RendererPersonRows.js:286` ставит `is-pulse-attention` на diff-badge при падении группы. CSS (`styles.css:16397-16411`):
```css
.ts2-row-diff.is-pulse-attention::after {
  animation: prizma-pulse-attention 1600ms ease-out 3;
}
```
Анимация — расширяющийся glow box-shadow 0 → 12px, 3 раза × 1600ms = 4.8 секунды. На каждый человек, у которого ухудшение. Тимлид заходит утром в roster, где, скажем, 8 человек съехали — 8 одновременных пульсов 5 секунд.

`prefers-reduced-motion` ставит `animation: none` (styles.css:16412-16416) — это **остановка**, а не альтернатива. Пользователь с reduced-motion теряет сигнал «у этого человека регресс vs вчера» полностью, потому что arrow icon и текст одинаковы для up/down — единственная differentiation — animation.
**Зачем чинить:** WCAG **2.3.3 Animation from Interactions** (AAA, но добровольный SBI compliance), **2.2.2 Pause/Stop/Hide** — auto-playing > 5s requires stop, и здесь 5 одновременных анимаций — это превышение.
**Как чинить:**
- Если `prefers-reduced-motion: reduce` — заменить пульс на статичный border-bold + tooltip "регресс vs вчера", чтобы информация не терялась.
- Ограничить кол-во одновременных пульсов: первые 3 строки группы пульсируют, остальные — статичные `ts2-row-diff-down` с уже существующим border-left=danger.
- 3 пульса × 1600ms → 2 пульса × 1200ms (2.4s total — внутри WCAG 5-second cap).
- vestibular-disorder users: добавить `@media (prefers-reduced-motion: reduce)` правило, которое явно показывает альтернативу, не просто `animation: none`.

**Критичность:** medium. **Сложность:** low. **Ценность:** medium.

---

### 5. Heatmap 72×4: ось времени `aria-hidden`, SR не получает шкалы

**Описание:** `teamScanner2Renderer.js:1609`:
```js
const ariaSummary = `Heatmap активности 72 часа × 4 источника (Jira/Bitbucket/Confluence/Zephyr). Всего ${totalEvents} событий за 72ч. ${peakHint}.`;
```
Это хорошо как summary, но:
- Тут жёстко указано «4 источника», а с V18.3 A2 их **5** (Zephyr split на Zc/Ze).
- Сама ось времени (1615-1620: «−72ч / −48ч / −24ч / сейчас») — `aria-hidden="true"` на родителе. SR не получает шкалы → знание «пик 23ч назад» бесполезно без понимания «23ч назад это вчерашняя пятница ночью или сегодня утром».
- Каждая клетка `aria-hidden="true"` (что правильно), но row-label «J / B / C / Zc / Ze» (`teamScanner2Renderer.js:1599`) — простые span без role. SR прыгает на row total «5» без контекста «5 событий в Jira».
- 72×5 = 360 элементов без structural markup (`<table>` / `role="grid"`) — это не grid, не img, всё в одном `role="img"` с одним summary. drill-down невозможен.

**Зачем чинить:** WCAG **1.1.1 Non-text Content** (текстовая альтернатива должна быть равноценна по информации), **1.3.1 Info and Relationships** (структура heatmap скрыта от AT).
**Как чинить:**
- `ariaSummary` динамически: `4 → ${h.grid.length} источников` и перечислить SRC_NAMES[].
- Добавить ось времени в summary: «период −72ч до сейчас». Или сделать ось `role="presentation"` с visually-hidden labels.
- Альтернатива: рендерить SR-only `<table>` рядом с heatmap (`<table class="ts2-sr-only">` с `<th scope="col">−72ч … сейчас</th>` и `<th scope="row">Jira</th>`). Это требует ~30 LOC, но даёт реальный drill-down для SR.
- Минимум: дать каждому `.ts2-hrow` `aria-label="Jira: 47 событий, пик 23 часа назад"`.

**Критичность:** medium. **Сложность:** medium. **Ценность:** medium.

---

### 6. «Требует разговора» / «Требует внимания» — стигматизирующий label SR озвучивает дословно

**Описание:** `teamScanner2RendererPersonRows.js:34`:
```js
stop: { label: 'Требует внимания', desc: 'Висят без движения — нужен разговор сегодня' },
```
В `renderGroup` (teamScanner2RendererPersonRows.js:131) этот label рендерится в `<span class="ts2-group-label">${esc(meta.label)}</span>`, и `desc` уходит в `title` — потом снимается в `data-tip`. SR в browse mode читает: «Требует внимания, 12, Иван Иванов, кнопка, свёрнуто, ...».

Само по себе «требует внимания» нейтрально (V22 это уже смягчили из исходного «Стоп»), НО:
- Каждый человек в этой группе при SR-навигации (arrow-up/down) озвучивается с пометкой «требует внимания» **не как контекст**, а как часть accessible name строки — потому что `ts2-group-head` стоит в DOM-структуре через `display: flex`, и live region не указан. NVDA в browse mode произнесёт label каждые 10 строк, JAWS — для каждой строки.
- Текст `desc` («нужен разговор сегодня») — единственное место в UI где явно говорится про «разговор». Сейчас он скрыт в `data-tip`, SR его не получит, но если data-tip переедет назад в `title` (или будет добавлен в aria-describedby) — SR будет произносить «Иван Иванов, требует внимания, нужен разговор сегодня». Для коллеги Ивана, который пользуется SR на standup'е — это унижение из браузера.
- Та же логика применима к `idle: 'Без активности'` — для сотрудников в отпуске.

**Зачем чинить:** WCAG **3.3.2 Labels or Instructions** (labels должны быть descriptive, не judgemental), GDPR/корп. этика (отображение «нужен разговор» при shared screen). Это не строго WCAG, но a11y-этический red flag.
**Как чинить:**
- Убрать `desc` про «разговор» из user-visible слоя — оставить как internal comment.
- Group-label оставить, но добавить `role="group" aria-label="Группа: <label>, <N> сотрудников"` на `.ts2-group`, чтобы SR не дублировал label на каждой строке.
- Альтернативный label set: «Низкая активность / Стандартная активность / Высокая активность / Нет данных» — operational, без judgment. (Это пересечение с Product/UX-углом, но я фиксирую именно SR-impact: то, что SR произносит вслух, должно быть neutral.)
- Если сотрудник делится screen с SR-озвучкой включённой — group-label не должен раскрывать классификацию коллег.

**Критичность:** medium. **Сложность:** low. **Ценность:** high.

---

### 7. Контраст signal-цветов на light: drift `#f59e0b` (amber) проваливает WCAG AA на normal text

**Описание:** Токены в `styles.css`:
- `--prizma-drift: #f59e0b` (warning amber) — используется в `.ts2-badge-prT-slow`, `.ts2-counter-amber .ts2-counter-num`, `.ts2-row-diff-up`, `.ts2-hyg-rule-warn`.
- `--prizma-on-course: #16a34a` (green success) — `.ts2-badge-crv-ok`, `.ts2-counter`.
- `--prizma-off-course: #dc2626` (red danger) — `.ts2-counter-warn .ts2-counter-num`, dwell-badge.

На белом фоне `--card: #ffffff`:
- `#f59e0b` vs `#ffffff` = **2.16:1** — fail WCAG 2.1 AA (требует 4.5:1 для text, 3:1 для UI components).
- `#16a34a` vs `#ffffff` = 3.40:1 — fail для normal text (но pass для bold ≥18px).
- `#dc2626` vs `#ffffff` = 4.97:1 — pass AA, fail AAA.

Affected:
- Counter numbers в строке (`.ts2-counter-amber/-warn`) — это **13px, font-weight 700** (`styles.css:16711`). amber на белом — фактически невидим для пользователей с low vision.
- `.ts2-badge-prT-slow` — orange chip с цифрой «3↗ 25%» на белом chip background. Combined contrast ratio chip-vs-row + text-on-chip оба провальные.
- В dark theme — те же токены, но фон `#1A1A22` → меняется character.

**Зачем чинить:** WCAG **1.4.3 Contrast (Minimum)** AA, **1.4.11 Non-text Contrast** для UI элементов.
**Как чинить:**
- Использовать darker variants для text: `--prizma-drift-text: #b45309` (4.51:1 vs white) — отдельный токен для текста, оставить `--prizma-drift` для borders/backgrounds.
- Все text-on-white варианты cross-проверить через axe-core/contrast checker:
  - amber text → `#b45309` или `#92400e`
  - green text → `#15803d` (4.54:1)
  - red text → `#b91c1c` (5.94:1) — pass AAA для нормального текста
- Для chip'ов с цветным фоном (`.ts2-badge-prT-overload`) — combined ratio chip-vs-row × text-on-chip; usually нужно идти на text `#1f2937` (dark gray) с цветной плашкой, а не цветной текст.

**Критичность:** high. **Сложность:** medium. **Ценность:** high.

---

### 8. Empty state strip «—» / «Сегодня —» не озвучивается смыслово

**Описание:** `teamScanner2RendererPersonRows.js:179-183`:
```js
const todayBlock = todayN > 0
  ? dotStrip(hToday, `Сегодня: ${todayN} событий`)
  : `<span class="ts2-strip-empty">${esc(emptyDayLanguage(p, 'today'))}</span>`;

const yestBlock = yestN > 0
  ? dotStrip(hYest, `Вчера: ${yestN} событий`)
  : `<span class="ts2-strip-empty ts2-strip-empty-y">—</span>`;
```
Если у человека нет событий вчера — span со знаком «—». SR читает «тире» или «минус» — бессмысленно.

Также `emptyDayLanguage(p, 'today')` (в Common) возвращает «Фокус на код-ревью» / «Документация» / «Возможно в отпуске» — продукт-language, но эти строки рендерятся без context-label «Активность сегодня:» → SR в browse mode наскочит на «Возможно в отпуске» как часть row string без структуры.

`.ts2-strip-label` (`teamScanner2Renderer.js: dot-strip`) даёт визуальный label «Сегодня», но он `font-size: 10px` и `color: var(--text-3) .8 opacity` — для SR это не differentiated structurally.

**Зачем чинить:** WCAG **1.1.1 Non-text Content** (decorative «—» должен быть aria-hidden), **3.3.2 Labels or Instructions**.
**Как чинить:**
- Empty yesterday span — `aria-hidden="true"` + reader-only sibling: `<span class="ts2-sr-only">Вчера: нет активности</span>`.
- Empty today — обёртка с `aria-label="Сегодня: ${emptyDayLanguage(...)}"`, не оставлять product-language без context-label.
- `.ts2-strip-label` сделать `<span aria-hidden="true">Сегодня</span>` + содержимое strip обернуть в `<span role="img" aria-label="Сегодня: 5 событий">` (сейчас label идёт в dotStrip, но он не связан с visual label).

**Критичность:** medium. **Сложность:** low. **Ценность:** medium.

---

### 9. Tooltip-only labels: action-кнопки имеют только title, который снимается

**Описание:** `_promoteTitlesToTooltips` (`teamScanner2.js:2060-2069`) ВСЕ `title=` на ВСЕХ элементах сваливает в `data-tip`:
```js
this._container.querySelectorAll('[title]').forEach(el => {
  if (el.tagName === 'title') return;
  const t = el.getAttribute('title');
  if (!t) return;
  el.setAttribute('data-tip', t);
  el.removeAttribute('title');
});
```

Это критично: tooltip отображается на hover/`data-tip` через CSS, но SR полностью теряет доступ к этим текстам.

Затронуто:
- Counter `title="Активные задачи в пути. Норма ≤2, перегрузка ≥3. Медиана команды: 3"` (`teamScanner2RendererPersonRows.js:305`) → SR теряет полную интерпретацию числа.
- Source chip detailed tooltips (Bitbucket, Confluence, Zephyr).
- Diff badge `title="Вчера: moving → Сегодня: stop"` — SR не получает diff'а.
- `.ts2-name title="${p.label}"` (для truncated имён через ellipsis) — SR не получает full name если имя длинное.
- Heatmap каждая cell `title="Jira · 23ч назад · 5 событий"` — снимаются, заменяются только parent summary.
- `data-tip` уже custom CSS-only attribute, не accessible.

**Зачем чинить:** WCAG **1.3.1**, **4.1.2** — accessible name должен оставаться в name computation, не в `data-*`.
**Как чинить:**
- Для interactive elements (buttons, focusable rows) — `aria-label` или `aria-describedby` вместо `title`.
- Для visual-only tooltips — оставить `title` (SR в browse mode читает их), `data-tip` — дополнительно для красивого CSS-tooltip, не вместо.
- Перед promoting проверять `el.getAttribute('aria-label') || el.getAttribute('aria-describedby')` — если уже есть accessible name, можно снимать `title`. Если нет — оставить.
- Альтернатива: вместо `_promoteTitlesToTooltips` — CSS `[title]:hover::after { content: attr(title); ... }` (browser-native title даёт ~700ms delay; если delay критичен, всё равно проще сделать `aria-describedby` указывающее на скрытый `<span class="ts2-sr-only">`).

**Критичность:** high. **Сложность:** medium. **Ценность:** high.

---

### 10. Русский UI без `lang="ru"` → SR произносит русский текст английской фонетикой

**Описание:** Главный документ Призмы — `<html>` без `lang` attr (по результату беглой grep'a в всех integration files); если он есть в index.html — он не наследуется в shadow DOM или iframe? Нужно проверить `index.html`. Но даже если `<html lang="ru">` есть, проблема в нескольких местах:
- LLM-assistant content (`.ts2-assistant-block-content`) может содержать смесь языков — markdown с английскими ключами и русским body. Без `lang="ru"`/`lang="en"` overrides SR-голос выбирает один TTS-engine.
- Source-keys типа «B / J / C / Zc / Ze» — это латиница в русском контексте, NVDA читает «Б Й Ц» (если document lang=ru) или «бэ джей си» (если en) — оба варианта misleading.
- Tooltip строки типа `"merged из ${myPrT.opened} opened за 7 дней"` — смешанный язык.

`_printScanner` (teamScanner2Renderer.js:221) выгружает PDF с `<html>` БЕЗ `lang` — print-version totally inaccessible.

**Зачем чинить:** WCAG **3.1.1 Language of Page** (A level — обязательно), **3.1.2 Language of Parts** (AA).
**Как чинить:**
- Убедиться что root document имеет `<html lang="ru">`.
- На latin-only текст (source keys, kebab команды типа «commit/merge») оборачивать `<span lang="en">B</span>` или давать pre-composed aria-label на ru: `aria-label="Bitbucket"`.
- `_printScanner` HTML — `<html lang="ru">`.
- LLM-блоки помечать `lang="ru"` явно (`renderAssistantSection`, panel narrative).

**Критичность:** medium. **Сложность:** low. **Ценность:** medium.

---

### 11. Чип «PROD» / «BURNOUT» / «АКТИВ» — productivity tracking без accessible alternative

**Описание:** `teamScanner2Renderer.js:1267-1336` рендерит productivity chips за `localStorage.q2_scanner_show_productivity` флагом. Чип PROD например:
```html
<span class="ts2-pm-chip ts2-pm-chip-prod" data-pm-formula="...сложная формула..." title="Клик — полная формула">
  <span class="ts2-pm-chip-key">PROD</span>
  <span class="ts2-pm-chip-num">${prod.score}</span>
</span>
```
- `title` снимается, формула в `data-pm-formula` (SR не видит).
- Popover (`_bindPanelEvents` строки 2691-2697) создаётся ad-hoc как `<div role="dialog" aria-label="...">` со своей кнопкой закрытия. Внутри popover нет focus management — focus остаётся на chip, SR не объявляет открытие popover'а.
- BURNOUT chip с label «ВЫСОКИЙ»/«СРЕДНИЙ» — это **stigmatizing label SR произносит дословно** при заходе в panel другого сотрудника. Если burnout chip есть — он часть panel header, не свернутая. Тимлид с SR должен слышать «BURNOUT ВЫСОКИЙ 3 сигнала» каждый раз когда открывает panel — это эмоционально тяжёлый use case если у тебя на team такие чипы.
- За флагом — но default state (`hide_productivity` not set) показывает PROD-chip всем.

**Зачем чинить:** WCAG **4.1.2** + WCAG **2.4.7 Focus Visible** для popover, и ethical (если burnout chip — операционный сигнал, его надо защитить от случайного screen-share).
**Как чинить:**
- Chip popover при открытии — focus на popover, на close — return focus на chip. Trap focus в popover (как полноценный dialog).
- BURNOUT chip — переименовать в нейтральное «Нагрузка: высокая» в aria-label (visual может остаться, но SR-читаемая версия должна быть operational).
- PROD chip aria-label — concrete: «Productivity score 87 за 48 часов, формула: commits×1 + PR×3 + ...». Никаких label-only без числа в name.
- Default flag — сделать `show_productivity` opt-in, не opt-out, чтобы новые тимлиды не видели PROD при первом запуске.

**Критичность:** medium. **Сложность:** medium. **Ценность:** medium.

---

### 12. Click-to-expand events в feed: hidden attr без announcement

**Описание:** `renderEventLine` (teamScanner2Renderer.js:1862-1872):
```html
<li class="ts2-recent-li ts2-recent-expandable" data-event-idx="0">
  ... event text ...
  <span class="ts2-recent-chevron" aria-hidden="true">›</span>
  <div class="ts2-recent-detail" hidden>... diff details ...</div>
</li>
```
Handler (`teamScanner2.js:2650-2666`) toggles `hidden` attribute. Никаких `aria-expanded`, `role="button"`, или role на `<li>` — это просто кликабельный `<li>`. SR в browse mode:
- Не озвучивает что li кликабельный (нет cursor:pointer не достаточно).
- Не знает что есть expand/collapse state.
- chevron `aria-hidden="true"` — корректно само по себе, но всё equivalent inform для SR теряется.
- При expand — детали появляются в DOM, но нет `aria-live` объявления.

**Зачем чинить:** WCAG **4.1.2 Name, Role, Value**, **2.1.1 Keyboard** (нет Tab access на li, только mouse).
**Как чинить:**
- `<li>` → внутри `<button class="ts2-recent-li-toggle" aria-expanded="false" aria-controls="ts2-event-${idx}">`.
- Detail div — `id="ts2-event-${idx}"`, без `hidden` (но `aria-hidden` управляется через `aria-expanded` parent).
- Click handler — также toggle `aria-expanded`, announce через aria-live: `Развёрнуто. Было: <from>. Стало: <to>.`
- Keyboard handler — Enter/Space на button (browser default), Escape → collapse.

**Критичность:** medium. **Сложность:** low. **Ценность:** medium.

---

### 13. Counter в строке с tooltip «Медиана команды: 3 (×1.5 от среднего)» — SR теряет comparative context

**Описание:** `teamScanner2RendererPersonRows.js:305`:
```html
<span class="${wipCls}" title="Активные задачи в пути. Норма ≤2, перегрузка ≥3. Медиана команды: 3 (×1.5 от среднего).">
  <span class="ts2-counter-num">4</span>
  <span class="ts2-counter-lab">в пути</span>
</span>
```
В amber state «×1.5 от среднего» — это критическая info: «у этого человека WIP в 1.5 раза больше среднего по команде». Title снимается → SR получит «4 в пути» без comparative context. Цветовая дифференциация (amber vs default) — единственный сигнал для зрячего; для SR — ничего.

**Зачем чинить:** WCAG **1.4.1 Use of Color** (color cannot be the only means), **1.3.1**.
**Как чинить:**
- Counter aria-label включает comparative: `aria-label="4 задачи в работе, медиана команды 3, в 1.5 раза выше среднего"`.
- При amber state — additional `aria-describedby` указывающее на скрытый `<span class="ts2-sr-only">Перегрузка</span>`.
- Или вообще counter становится `<button>` (если он клик-открывает drill-down) с full accessible name.

**Критичность:** medium. **Сложность:** low. **Ценность:** medium.

---

### 14. ARIA-live announcement: один общий, без priority/role

**Описание:** `teamScanner2.js:1879`:
```html
<div class="ts2-aria-live" aria-live="polite" aria-atomic="true" id="ts2-aria-live"></div>
```
Один live region для ВСЕХ announcement'ов: open panel, close panel, copy success, search result, error.

Problems:
- `aria-atomic="true"` означает SR прочитает ВЕСЬ content при любом изменении. Если announcement приходят quickly back-to-back, последний выигрывает (`_announce` clear-then-set паттерн помогает, но не всегда).
- Нет `role="status"` или `role="alert"` — assertive vs polite разница важна (error должен быть assertive).
- Когда panel открывается + происходит refresh — два announcement collides.
- Live region внутри `.ts2-aria-live` — должен быть на top-level body, не внутри `_container` (если container унесли при re-render — live region пересоздаётся, screen reader может потерять связь).

**Зачем чинить:** WCAG **4.1.3 Status Messages**.
**Как чинить:**
- Два live regions: `#ts2-live-polite` + `#ts2-live-assertive` (`role="status"` / `role="alert"`).
- В `_announce` принимать priority параметр.
- Live region выносить на top-level (не внутри container который re-rendered'ится).
- Error states (`renderError`) — `role="alert"` + явное focus management.

**Критичность:** low. **Сложность:** low. **Ценность:** medium.

---

### 15. Skip link / keyboard nav в большой roster (>50 человек)

**Описание:** Roster может быть длинным (pilot finding в коде: «79 строк stop без приоритизации» — `teamScanner2RendererPersonRows.js:82`). Keyboard navigation:
- Tab проходит **все** row'ы по очереди (каждая `tabindex="0"`). Для 80 человек — 80 Tab'ов до того, как добраться до контент-areas под roster.
- Нет skip link «К сводке / К панели управления».
- Group counts в team-glance (`teamScanner2Renderer.js:_setupGlanceJumpButtons`) кликабельные, но это buttons над roster, не keyboard shortcut для прыжка к группе.

**Зачем чинить:** WCAG **2.4.1 Bypass Blocks** — должна быть возможность пропустить большой блок повторяющегося контента.
**Как чинить:**
- Перед roster — `<a href="#ts2-roster-end" class="ts2-sr-only">Пропустить таблицу сотрудников</a>` с `:focus { position: static; }` который делает skip-link visible.
- Group-heads (Требует внимания / Под наблюдением / Движется / Без активности) — сделать `role="heading" aria-level="3"`, чтобы SR пользователь мог прыгать H3-навигацией.
- Keyboard shortcuts (уже есть `/` для search per teamScanner2.js:2294) — добавить `g s` / `g w` / `g m` / `g i` для jump в группу (gist-style). Документировать в `/?` help.
- Roster под backdrop при открытой panel — `inert` (см. находку #2) автоматически уберёт его из Tab cycle.

**Критичность:** medium. **Сложность:** medium. **Ценность:** medium.

---

### 16. Detail panel: breadcrumb «← Назад» имеет конфликтующую роль

**Описание:** `teamScanner2Renderer.js:1448`:
```html
<button class="ts2-panel-back" type="button" data-close-modal aria-label="Назад к Сканнеру">← Назад</button>
```
- Текст кнопки «← Назад» с ASCII arrow — SR озвучит «стрелка влево Назад» или «Назад» (depending TTS). aria-label «Назад к Сканнеру» — overrides text, но это не дополнительный context, а замена.
- `data-close-modal` — это data-attr для CSS/JS, не accessible signal. Кнопка функционально = ✕ close button. Дублирование.
- Стрелка `←` не имеет `aria-hidden`, не обёрнута в span.

**Зачем чинить:** WCAG **2.4.6 Headings and Labels** (clear and descriptive), **4.1.2**.
**Как чинить:**
- Wrap `←` в `<span aria-hidden="true">←</span>`.
- Если есть и «Назад» и ✕ — они должны иметь distinct labels: «Назад» = move focus to previous view; ✕ = close modal entirely. Сейчас оба зовут `_closePanel`. Если поведение одинаковое — оставить одну кнопку и убрать другую.
- `data-close-modal` — это implementation detail, не attr для name.

**Критичность:** low. **Сложность:** low. **Ценность:** low.

---

## WCAG критерии (сводка)

| # | Находка | WCAG | Уровень |
|---|---------|------|---------|
| 1 | Row role/structure | 4.1.2, 2.4.6 | A, AA |
| 2 | Focus trap & `inert` | 2.4.3, 2.1.2, 4.1.2 | A |
| 3 | Source-chips labels | 1.3.1, 3.3.2 | A |
| 4 | Pulse animation | 2.3.3, 2.2.2 | AAA, A |
| 5 | Heatmap structure | 1.1.1, 1.3.1 | A |
| 6 | Стигматизирующий label | 3.3.2 | AA |
| 7 | Контраст signal-цветов | 1.4.3, 1.4.11 | AA |
| 8 | Empty-state «—» | 1.1.1, 3.3.2 | A, AA |
| 9 | Title→data-tip | 1.3.1, 4.1.2 | A |
| 10 | `lang="ru"` | 3.1.1, 3.1.2 | A, AA |
| 11 | PROD/BURNOUT chip | 4.1.2, 2.4.7 | A, AA |
| 12 | Click-to-expand events | 4.1.2, 2.1.1 | A |
| 13 | Counter context | 1.4.1, 1.3.1 | A |
| 14 | ARIA-live | 4.1.3 | AA |
| 15 | Skip link | 2.4.1 | A |
| 16 | Breadcrumb back | 2.4.6, 4.1.2 | AA, A |

---

## Impact (на кого)

- **Слепые / низкое зрение, использующие SR**: находки 1, 2, 3, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16. Roster по факту неюзабелен в browse mode — нужно для каждой строки слушать набор слов без структуры.
- **Vestibular disorders / motion sensitivity**: находка 4. 5+ одновременных pulse animations при заходе в roster утром.
- **Color-blind (deuteranopia/protanopia)**: amber vs red в counters (`.ts2-counter-amber/-warn`) — основная differentiation цвет. Нужны иконки или text labels.
- **Low vision без SR**: находка 7. Amber `#f59e0b` на белом — менее 2.2:1, фактически невидим.
- **Keyboard-only users (RSI/motor)**: находки 2, 12, 15. Tab проходит весь roster, focus-trap пробивается, click-to-expand не имеет keyboard access.
- **Cognitive load / non-native ru speakers**: находка 10 (`lang` attrs влияют на SR voice selection).
- **Этический impact**: находка 6 (стигматизация), 11 (BURNOUT label) — even users без AT могут случайно показать screen у которого SR озвучивает «требует разговора» / «BURNOUT высокий» для коллег.

---

## Если бы мне дали 2 недели на это — что бы я сделал в первую очередь

**Неделя 1: критичные фикс блоки (high criticality, high value).**

День 1-2: **Контраст токенов (находка 7).** Добавить `--prizma-*-text` variants для текстов, заменить все usage в counters/badges. Запустить axe-core на demo fixture в Playwright, fail-fast на violations.

День 3-4: **Focus trap через `inert` (находка 2).** Заменить ручной Tab-handler на `inert` на main content + circular focus loop в panel. Полный flow: open row → focus в panel → close → focus return на row. E2e test на это.

День 5-7: **Row labels (находки 1, 3).** Pre-compose accessible name для каждой row в renderRow: ФИО + группа + ключевые счётчики + state. aria-hidden на все decorative chips. Source-chips → group с aria-label. Это самый большой rewrite, но он решает проблему «10 секунд на одну строку».

**Неделя 2: structural и UX.**

День 8: **Title → ARIA migration (находка 9).** Patch `_promoteTitlesToTooltips` — если у элемента есть `aria-label`/`aria-describedby`, можно снимать title; иначе оставить или конвертировать в `aria-describedby`. SR-friendly.

День 9: **Group headings + skip link (находки 6, 15).** Сделать `.ts2-group-head` heading-level h3. Заменить «Требует внимания» → operational alternative в обоих visible и aria-label. Skip-link перед roster.

День 10-11: **Heatmap + click-to-expand events (находки 5, 12).** SR-only `<table>` рядом с heatmap для drill-down. Events `<li>` → `<button aria-expanded>`.

День 12: **`lang` attrs + pulse alternative (находки 4, 10).** В `prefers-reduced-motion` — статический visual cue вместо `animation: none`. Latin-only текст обернуть `<span lang="en">`.

День 13: **Polish**: ARIA-live split (polite + assertive), counter aria-labels с comparative context, breadcrumb cleanup.

День 14: **Verification.** Полное Playwright + axe прогон на demo fixture. Manual NVDA/VoiceOver pass: navigate roster, open panel, fill filter, expand event. Fix regressions.

**Что я бы НЕ делал в эти 2 недели:**
- Не переделывал productivity chips (находка 11) — это пересекается с Product/UX-углом «токсичность», a11y-фикс там — добавление aria-label, но если чипы вообще надо удалить как product decision, инженерия впустую.
- Не трогал бы Скваль's brief-export `_printScanner` — отдельный pipeline, его a11y фикс отдельная задача.
- Не делал бы full chunk-by-chunk SR test всех modals (config / how-modal / diag) — сначала roster + panel, остальные в отдельный sprint.
