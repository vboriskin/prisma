# 05 — Interaction & Motion audit

## Сводка

- Critical: 4
- High: 7
- Medium: 8
- Low: 5
- Polish: 4

Итого: 28 находок.

## Метод

Прошёл по in-scope файлам:

- `integrations/teamScanner2.js` (2269 LOC), `integrations/teamScanner2Renderer.js` (4587 LOC),
  `integrations/blackDashboard.js` (234), `integrations/blackDashboardRenderer.js`,
  `integrations/integrationsRenderer.js` (177), `views/integrationsView.js` (646)
- `styles.css` 18116 строк — фильтрация по `.ts2-`, `.bd-`, `.int-`, `.intg-`
- `theme.css` 214 строк — глобальные motion-токены и `prefers-reduced-motion`

Грепы дали профиль:

- ~432 `@keyframes`/`animation`/`transition:` в `styles.css`
- ~89 `:hover|:focus|:focus-visible|:active|cursor:` в скоупе → 71 hover, **12** focus-visible, **0** active
- 17 случаев `transition: all` антипаттерна в файле (минимум 4 в скоупе ts2/bd/int)
- 23 блока `prefers-reduced-motion` глобально, **0** покрывают `.ts2-*`/`.bd-*`/`.int-*`/`.intg-*` (полагаются на theme.css `*` override, что валит только duration, но в общем работает — детали в F5)
- 6 круговых спиннеров (`rotate(360deg) infinite`) в проекте, минимум 3 в скоупе: `.bd-loader-spinner`, `.int-loader-spinner`, `.ep-loader-spinner` (employeePerformance — соседний int-модуль)
- 6 `ts2-*-modal-overlay`, ни один не в `:has()` body-scroll-lock списке
- L1 inline pulse реализован (`.ts2-demo-banner-dot` использует `prizma-loader-inline` 1800ms — близко к спеку 1400ms)
- L3 skeleton реализован (`.ts2-skeleton`/`ts2-skel-shimmer 1.4s`) — но без star-маркера и градиент slightly off-spec

---

## Находки

### F1 — круговые спиннеры в Чёрном дашборде и int-loader [Critical]

**Где:**
- `styles.css:10423-10428` — `.bd-loader-spinner` (`width:56px;height:56px;border-radius:50%; border-top-color:...; animation:pp-spin .9s linear infinite`)
- `styles.css:10864-10872` — `.int-loader-spinner` (`width:26px;height:26px;border-top-color:...; animation:int-loader-spin .9s linear infinite; @keyframes int-loader-spin { to {transform:rotate(360deg);}}`)
- `styles.css:10387` — `.pp-loader-spinner` (Portfolio Pulse — соседний модуль, не in-scope, но идентичный паттерн)
- `integrations/blackDashboardRenderer.js:631` — `renderLoader()` рендерит `.bd-loader.bd-loader-meme` (Cheshire-cat face) — **вне brand vocabulary полностью**

**Брендбук:** §11 «Никогда не круговой спиннер. Это не наш язык.» §12 #5 «Без свечения и теней». `bd-meme-grin` использует `feGaussianBlur` filter glow — двойное нарушение.

**Текущее:** Чёрный дашборд при `_fetchAndRender` показывает мем-лицо «Cheshire-cat в темноте» с `bd-meme-blink` (5.3s eyes), `bd-meme-grin-breath` (4.2s рот) и `bd-meme-sway` (5.5s покачивание). Дополнительно — `.int-loader-spinner` (где-то ещё, маркап в коде не нашёл при greps; вероятно legacy — селектор живёт только в CSS).

**Должно быть:** L2 page loader из §11 — звезда 48–64px по центру + breathe 3000ms loop + ring 2400ms ease-out (`r:4→30; opacity:0.6→0`) + caption «УСТАНАВЛИВАЕМ КУРС» (или «СВЕРЯЕМ КУРС · SIGMA + DELTA» — TOV §7). Звезда уже есть как inline SVG asset (`assets/svg/logo/star.svg` 120×120 viewBox).

**Цена:** M — нужен новый компонент `<PrizmaLoader L2>` (~50 LOC HTML+CSS). Bd-meme заменить полностью; phrase-rotator/cancel-button можно оставить как ниже-расположенные слои.

---

### F2 — focus отсутствует у большинства интерактивных элементов [Critical]

**Где:** В скоупе только **12** `:focus-visible` правил против **71** `:hover` (см. `styles.css` lines 13079, 13655, 14321, 14335, 14462, 14780, 14897, 14956, 16655 + 3 базовых input). Без focus-state остаются:

- `.bd-tab` (line 11685) — sub-tabs Чёрного дашборда (Цели/Покрытие/Метрики)
- `.bd-chip-*`, `.bd-issue-row`, `.bd-goal-key`, `.bd-issue-key` (links)
- `.int-stab` (line 11123) — Settings tabs (Jira Delta/Sigma/Bitbucket/Confluence)
- `.int-btn`, `.int-btn-primary`, `.int-btn-ghost` (line 9426) — все кнопки модалки
- `.int-link-btn`, `.int-registry-link`, `.int-cross-item`, `.int-table-row`
- `.ts2-btn`, `.ts2-btn-ghost`, `.ts2-btn-primary` (line 13784, 13793, 13795) — все кнопки сканнера
- `.ts2-team-tab` имеет focus-visible — но `.ts2-vc-tab` (line 14061), `.ts2-sd-tab-btn` (12952), `.ts2-counter[data-clickable]`, `.ts2-action-queue-name`, `.ts2-zombie-summary-toggle`, `.ts2-stale-pr-summary`, `.ts2-narrative-copy`, `.ts2-glance-help-item`, `.ts2-triage-pill-item`, `.ts2-kebab-item`, `.ts2-sankey-node`, `.ts2-pm-chip-burnout-*`, `.ts2-sh-*` toggles — нет

**Брендбук:** не явно про focus, но §7 ToV «уважает время», §a11y по-умолчанию (V21 Wave-3 уже подняла contrast).

**Текущее:** клавиатурный пользователь не видит fокус. Tab-навигация по сканнеру/дашборду = слепой режим.

**Должно быть:** Базовое CSS-правило для всех интерактивных классов скоупа:
```css
.ts2-btn:focus-visible, .bd-tab:focus-visible, .int-btn:focus-visible, .int-stab:focus-visible /* и т.д. */ {
  outline: 2px solid var(--prizma-information);
  outline-offset: 2px;
}
```
Через `:where()` или единый shared-class. Альтернатива — глобальный `.app-section button:focus-visible, .app-section [role=button]:focus-visible {…}`.

**Цена:** S — 1 CSS-блок ~30 строк. Часть уже шаблон есть для `ts2-team-tab`, нужно расширить.

---

### F3 — `.int-field-input:focus { outline: none }` без замены [Critical]

**Где:** `styles.css:11169` — `.int-field-input:focus { outline: none; border-color: var(--prizma-information); }`. Бордер 1px меняет цвет — на тёмной теме (information=`#6EC1E4`) контраст с border `rgba(255,255,255,0.08)` ОК, но на полях это не achieves a11y indicator (border меняется и при `:hover` соседних элементов). При `prefers-reduced-motion` transition обнуляется — в момент tab'а скачок цвета без анимации, но всё равно мало.

**Брендбук:** safety §a11y default.

**Текущее:** Tab по форме настроек — focus теряется в полях с тонкими бордерами (особенно когда поле и окружение оба тёмные).

**Должно быть:** `outline: 2px solid var(--prizma-information); outline-offset: 1px;` либо `box-shadow: 0 0 0 2px var(--prizma-information-bg);`. То же самое с `.ts2-diag-sens-input input:focus` (15417) и `.ts2-team-search:focus` (12412 — имеет `border-color` но нет outline).

**Цена:** XS.

---

### F4 — `ts2-*-modal-overlay` не блокируют скролл body [Critical]

**Где:** `styles.css:2833-2840` — `:has()` scroll-lock покрывает `.modal-overlay`, `.int-modal-overlay`, `.ceo-modal-overlay`, `.gdt-jump-overlay`, `.funny-loader`, `#onboarding-overlay`, `.ob-welcome-overlay`, `.ob-loading-overlay`. **Не покрывает:**

- `.ts2-panel-backdrop` (line 14684) — детализация по сотруднику + PR-CN modal
- `.ts2-diag-modal-overlay` (15171) — диагностика
- `.ts2-resolve-modal-overlay` (15441) — Identity Auto-Resolve
- `.ts2-crv-modal-overlay` (13564) — CR drill-down
- `.ts2-anomaly-modal-overlay` (13527) — sparkline modal
- `.ts2-how-modal-overlay` (15099) — «Как считается»
- `.ts2-config-modal` overlay (через `.modal-overlay` класс — возможно покрыт, нужно подтвердить в renderer)
- `.ts2-diag-disclaimer-overlay` (15536)

**Брендбук:** не явно, UX consensus.

**Текущее:** При открытии любой `ts2-*-modal` пользователь может скроллить дашборд под модалкой колесом мыши — это особенно заметно на side-panel'е (фиксированный 480px справа, dashboard прокручивается).

**Должно быть:** Расширить `:has()` rule (line 2833) еще на 7 селекторов либо вынести в общий класс `.modal-locks-scroll`.

**Цена:** XS.

---

### F5 — `transition: all .15s` антипаттерн [High]

**Где (в скоупе):**
- `styles.css:11482` — `.int-cross-item` (cursor:pointer transition:all .15s)
- `styles.css:11529` — какой-то `int-*` элемент
- `styles.css:11688` — `.bd-tab` (border-bottom + color + cursor → transition:all)
- Вне скоупа но в проекте: 17 точек

**Брендбук:** §9 «Спокойствие важнее эффектов»; принцип конкретности — должны транзишниться только нужные свойства.

**Текущее:** `.bd-tab` транзишнит все свойства, включая `cursor` (no-op) и `border-bottom-color` + `color`. При смене layout (например font-weight=600 на active) это даёт jitter — `font-weight` не должен анимироваться.

**Должно быть:** `transition: color 240ms ease-out, border-bottom-color 240ms ease-out;`

**Цена:** S — 17 точек, полчаса замены + визуальная регрессия.

---

### F6 — длительности transition не соответствуют брендбуку (240ms ease-out) [High]

**Где:** В `theme.css:140-150` глобальный `transition: 240ms ease-out` для bg/border/color/fill — это match брендбуку.

В `styles.css` массово используются короче и с разными easing в скоупе:
- `.ts2-btn` (13789): `transition: background .15s, color .15s, border-color .15s` — 150ms (не 240)
- `.ts2-team-tab` (13075): `transition: color .12s, background .12s` — 120ms
- `.ts2-vc-tab` (14069): 120ms
- `.ts2-sd-tab-btn`: 120ms
- `.bd-tab` (11688): 150ms
- `.int-stab` (11133): `var(--motion-fast)` — может 140-180ms (см. tokens)
- `.int-modal-close` (11105): `var(--motion-fast)`
- `.ts2-row` (14441): `transition: background .15s` — 150ms
- `.ts2-config-input`, `.ts2-counter`, `.ts2-issue-link`, etc. — 150ms

Только глобальный CSS-token `--motion-mid` (где определён?) приближен к 240. Локальные значения нарушают.

**Брендбук:** §8 «один transition 240ms ease-out для всех тематических переходов»; §9 общий принцип «спокойствие».

**Текущее:** Микро-transitions слишком быстрые (120-150ms vs ожидаемые 240ms), что даёт «дёрганый» feel против заявленного «спокойного».

**Должно быть:** Единый CSS-токен `--prizma-motion-state: 240ms` + `--prizma-ease: var(--prizma-ease-decel)` (theme.css:158 `ease-out`). Все state-transitions должны его использовать.

**Цена:** M — search/replace но требует визуальной QA, что 240ms не «too slow» для tab-switch.

---

### F7 — Active state отсутствует на ВСЕХ интерактивных элементах скоупа [High]

**Где:** Поиск `:active` в `styles.css` filtered to ts2/bd/int/intg = **0 правил**. Все кнопки (`.ts2-btn`, `.bd-tab`, `.int-btn`, `.int-stab`, `.ts2-row`, `.ts2-team-tab`, `.bd-issue-row`) не имеют `:active` feedback.

**Брендбук:** §9 motion vocabulary не покрывает explicitly, но click-affordance стандарт.

**Текущее:** Click → нет визуального ответа (кроме того что hover-bg сохраняется на mouseup). На клавиатуре Enter/Space → 0 feedback. Ощущение «клик не зарегистрирован» — пользователь жмёт повторно.

**Должно быть:** Глобальное правило для скоупа:
```css
.ts2-btn:active, .bd-tab:active, .int-btn:active, .ts2-row:active /* … */ {
  transform: scale(0.97);
}
@media (prefers-reduced-motion: reduce) {
  /* opacity feedback вместо scale */
  …:active { opacity: 0.7; }
}
```
Шаблон уже есть в проекте (line 16770 «П10.24 — :active press feedback (scale 0.96, reduced-motion safe)») — но не применён к скоупу.

**Цена:** S.

---

### F8 — Hit-target большинства кнопок < 32px (десктоп-минимум) [High]

**Где:**
- `.ts2-btn` (13784): padding `5px 10px`, font 12px → ~24-26px высота
- `.ts2-team-tab` (13066): тоже ~24px
- `.ts2-vc-tab` (14062): padding `4px 10px` font 11px → ~22px
- `.ts2-sd-tab-btn` (12953): padding `5px 11px` font 12px → ~24px
- `.ts2-filter-pill` (14882): padding `4px 10px 4px 8px` font 11px → ~22px
- `.ts2-sprint-filter-chip` (12372): padding `4px 10px` font 11px → ~22px
- `.bd-chip` (11755): padding `2px 8px` font 10.5px → ~16px (статусные чипы — **слишком мелко** даже для desktop)
- `.int-modal-close` (11096): 28×28 — ниже 32×32 desktop minimum
- `.ts2-pk-filter-clear` (14315): 18×18 — далеко ниже
- `.ts2-config-reset` / chevrons — нет min-size

**Брендбук:** не явно (mobile guideline 44×44 = §6 «mobile first principle»), но 32 минимум — стандарт WCAG 2.5.5 для desktop.

**Текущее:** На trackpad/touch screen промахи. На «ts2-pk-filter-clear» 18×18 кнопка — реальный pain.

**Должно быть:** min-height: 32px для interactive controls (44px touch). Padding можно оставить тонким, но добавить `min-height: 32px` + `inline-flex; align-items: center;`.

**Цена:** S, но требует регрессионного теста density (пользователь привык к dense).

---

### F9 — Tab switching без align-жеста [High]

**Где:**
- `integrations/teamScanner2.js:1238` — `tabBtns.forEach(b => b.classList.toggle('ts2-sd-tab-active', b.dataset.sdTab === tab));` — мгновенное переключение
- `integrations/blackDashboard.js:209` — `this._activeTab = b.dataset.bdTab; this._renderFull();` — `innerHTML` rerender, никакой анимации
- `views/integrationsView.js:101` — settings-modal sub-tabs: classList.toggle, без motion

**Брендбук:** §9 #4 Align — «смена контекста (модуль, команда, проект)» 1600ms spring. Sub-tabs Чёрного дашборда (Цели → Покрытие → Метрики) — это смена контекста.

**Текущее:** Мгновенный flash из-за `innerHTML` rebuild. Пользователь теряет ориентир «куда я перешёл».

**Должно быть:** Минимум — 240ms ease-out fade-cross на teaching containers при tab switch. Идеально для bd-tab (3 раздела одной страницы) — applied-align жест на соответствующей module-icon в topbar (1600ms spring rotate -12°→2°→0°). Для ts2-sd-tab-btn (вложенный sub-tab) — 240ms cross-fade достаточно.

**Цена:** M — добавить animation classes + transitionend-handler.

---

### F10 — Demo mode toggle без motion-сигнала [High]

**Где:**
- `integrations/teamScanner2.js:440` `loadDemo()` — `this._demoMode = true; this._renderFull();`
- `integrations/teamScanner2.js:471` `exitDemo()` — аналогично
- `styles.css:15650` `.ts2-demo-banner` — статичный banner с `border-left:3px information`, `prizma-loader-inline` 1800ms на dot (L1 pulse). 

**Брендбук:** §9 #4 Align — смена контекста = demo↔real. §11 demo-tag = caption micro.

**Текущее:** `loadDemo()` рендерит весь дашборд заново через `innerHTML` — пользователь видит мгновенный flash, банер появляется без entry-анимации.

**Должно быть:**
- Demo banner: emerge-fade-down 240ms ease-out при появлении
- При exit: align-жест 1600ms spring на topbar-индикаторе модуля (прозрачно отметить «вернулись в реальный курс»)
- Demo-tag в h1 (`.ts2-demo-tag` line 15680) — pulse-ring 1600ms каждые 8s как ambient reminder («ты всё ещё в demo»)

**Цена:** S-M.

---

### F11 — Toast: showToast используется без guarantees [Medium]

**Где:** `integrations/teamScanner2.js:2143` — `try { window.showToast?.(`Identity обновлён…`, 'success', 5000); } catch (_) {}`.
`views/integrationsView.js:185, 247, 312, 389` — `window.showToast?.(...)`.

**Брендбук:** §9 Pulse — «пришла нотификация, обнаружен дрейф». Toast’ы должны иметь pulse-glance.

**Текущее:** `showToast` глобал — undefined fallback (silent fail). Toast appears (см. styles.css:736 `prizma-toast-in 200ms ease-out`) но без pulse-ring вокруг иконки. Очередь toast'ов есть в проекте (grep V21 P queue) но не доказан в скоупе. Закрытие — не нашёл UI swipe (mobile).

**Должно быть:** Pulse-ring (1600ms, scale 0.4→1.6 opacity 0.8→0) на error/warning toast (когда «Дрейф обнаружен» сюжет). Success — без ring (тише). + visible close X (сейчас `.toast` styles не показывают видимую X) + swipe-to-dismiss.

**Цена:** M.

---

### F12 — Anchor-jump (V18.3 A5) без подсветки target [Medium]

**Где:** `integrations/teamScanner2.js:1307` — `target.scrollIntoView({ behavior: 'smooth', block: 'start' })` после клика по `.ts2-glance-jump`. Target — `<details>` группа, открывается if closed.

**Брендбук:** §9 Pulse — сигнал внимания.

**Текущее:** Smooth scroll работает (не мгновенный — ✓). Но target после прокрутки **не подсвечивается** — пользователь видит общий список, не понимает «какую группу мне открыли».

**Должно быть:** На target после scroll — pulse-ring 1.6s либо 1-2s `box-shadow` highlight (как `.ts2-btn-flash` уже есть в коде, line 14285 `ts2-flash-attention 1s ease-out 2`). Шаблон: `requestAnimationFrame(() => target.classList.add('ts2-flash-attention')); setTimeout(() => target.classList.remove('ts2-flash-attention'), 2000);`.

**Цена:** XS — паттерн уже есть.

---

### F13 — Filter chip toggle без feedback [Medium]

**Где:**
- `.ts2-filter-pill` (14882) — has hover, has focus-visible, но click → `_panelFilters[f] = !..; _renderPanelOnly()` — partial rebuild, без visual click-glance.
- `.ts2-sprint-filter-chip` (12372) — не нашёл `cursor:pointer`, на самом деле `details > summary` (не chip-button), плохая семантика.
- `.ts2-pm-chip-burnout-high`, `.ts2-counter[data-clickable]` (13124-13125) — has cursor + hover, но нет click-feedback.

**Брендбук:** §9 §11 — pulse 1600ms для важного, для filter — 200ms ripple/glow.

**Текущее:** Click → resync data, но визуально pill просто меняет border-color — feedback на уровне «выглядит так же, чуть-чуть».

**Должно быть:** При click — 200ms scale `1 → 0.96 → 1.02 → 1` (mini-ripple), затем устанавливается active-state. Либо `box-shadow: 0 0 0 4px information-bg` на 200ms.

**Цена:** S.

---

### F14 — Disabled state визуально слабо отличим [Medium]

**Где:**
- `.ts2-btn[disabled]` (15532) — `opacity: .5; cursor: not-allowed;` — OK, но `text-decoration: line-through` отсутствует, `pointer-events: none` нет (event может пройти на child).
- `.int-btn:disabled` (9427) — `opacity: .45; cursor: default;` — `cursor: default` неправильно (должно быть `not-allowed`).
- `.bd-tab:disabled` — не определено вообще, btn без `disabled` styles.

**Брендбук:** не явно, UX standard.

**Текущее:** Disabled-кнопки выглядят как «слабый hover» — пользователь жмёт.

**Должно быть:** `opacity: .5; cursor: not-allowed; pointer-events: none;` единообразно.

**Цена:** XS.

---

### F15 — Modal lifecycle: focus-trap есть, но focus-return частичный [Medium]

**Где:**
- `integrations/teamScanner2.js:1421-1432` — focus-trap для panel: tabbing вне panel → `panel.focus()`. ✓
- `integrations/teamScanner2.js:2227-2229` — `_closePanel` восстанавливает focus на `.ts2-row[data-key="${focusKey}"]`. ✓
- `_openConfigModal`, `_openHowModal`, `_openDiagModal`, `_openResolveModal`, `_openCrvModal`, `_openAnomalyModal`, `_openVelocityModal` (lines 1586, 1727, 1746, 1772, 1796, 1822, 2085) — НЕ сохраняют `previouslyFocusedElement`, НЕ возвращают focus на trigger после close. Только Esc-handler removeListener.
- `integrations/blackDashboard.js` — нет фокус-менеджмента в модалках совсем.
- `views/integrationsView.js:106-110` — settings modal: close через X-кнопку или backdrop, НИКОГДА не возвращает focus.

**Брендбук:** §a11y default + UX standard.

**Текущее:** Открыл диагностику — закрыл — focus теряется (на body), Tab начинает с начала страницы. Для пользователя на клавиатуре это поломка flow.

**Должно быть:** В каждом `_open*Modal`:
```js
const trigger = document.activeElement;
// ... open + bind close ...
const close = () => {
  overlay.remove();
  document.removeEventListener('keydown', onEsc);
  trigger?.focus();  // ← вернуть focus
};
```

**Цена:** S — паттерн на 7 модалках. Простая правка.

---

### F16 — `_openConfigModal` re-open сразу после reset, без animation [Medium]

**Где:** `integrations/teamScanner2.js:1622-1623` — `close(); this._openConfigModal();   // re-open чтобы UI обновился`.

**Брендбук:** §9 #3 «Одна анимация за раз».

**Текущее:** Reset → `remove()` → `insertAdjacentHTML('beforeend', html)` мгновенно → animation `ts2-modal-in .18s` запускается заново. Пользователь видит flicker (модалка моргнула).

**Должно быть:** Partial DOM update — обновить input values без re-mount всей модалки, или добавить class `ts2-modal-resetting` который рендерит без `ts2-modal-in` второй раз.

**Цена:** S.

---

### F17 — `bd-meme-blink`, `bd-meme-grin-breath`, `bd-meme-sway` нарушают §12 #5 (без свечения) [Medium]

**Где:** `styles.css:10481-10530` + `integrations/blackDashboardRenderer.js:648-665`.

```html
<filter id="bd-meme-grin-glow" x="-25%" y="-25%" width="150%" height="150%">
  <feGaussianBlur stdDeviation="1.6" result="b"/>
  <feMerge> ... </feMerge>
</filter>
<path filter="url(#bd-meme-grin-glow)"/>
```

**Брендбук:** §12 #5 «Без свечения и теней. Знак — плоская графика. Никаких glow, drop-shadow, neon.» Это применяется и к loader-anim и к asset face overall.

**Текущее:** Cheshire-cat grin имеет SVG `feGaussianBlur` glow filter. Глаза blink на 5.3s, рот колышется на 4.2s, лицо качается на 5.5s — три одновременные анимации = §9 #3 нарушение.

**Должно быть:** Удалить весь face-asset, заменить на L2 page loader (см. F1).

**Цена:** см. F1 (объединить).

---

### F18 — `funny-loader-spinner`, `ob-spin`, `ep-spin` — серия круговых спиннеров вне скоупа но рядом [High]

**Где:**
- `styles.css:7729` `.funny-loader-spinner` (`funny-spin 1s linear infinite`)
- `styles.css:9583` `.ep-loader-spinner` (Employee Performance — соседний int-модуль)
- `styles.css:11406` `.ob-loader-spinner` (Onboarding)
- `styles.css:10387` `.pp-loader-spinner` (Portfolio Pulse)

**Брендбук:** §11 «никогда круговой спиннер».

**Текущее:** 5 разных круговых спиннеров — pp/bd/ep/ob/funny + int. Все нарушают §11.

**Должно быть:** Единый компонент `<PrizmaLoader level="L1|L2|L3">` — заменяет все 5.

**Цена:** L (новый shared компонент + 5 миграций).

---

### F19 — `prefers-reduced-motion` НЕ обнуляет ts2-* анимации напрямую [High]

**Где:** В `theme.css:206-214` глобальный override:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Это работает для duration/count, но **не выключает** loop animations с infinite — они продолжают «играться» каждые 0.01ms (CPU-burn). И для `bd-meme-*` это означает что `infinite` всё ещё рендерит каждый frame.

**Брендбук:** §9 #2 «Уважать prefers-reduced-motion. Breathe и pulse останавливаются.»

**Текущее:** `ts2-skel-shimmer 1.4s ease-in-out infinite` (15011), `bd-meme-blink 5.3s … infinite` (10507), `bd-meme-grin-breath 4.2s … infinite` (10527), `prizma-loader-inline 1800ms … infinite` (15668), `ts2-tip-in 140ms 60ms ease-out forwards` — последний forward, окей.

`infinite` count после override = 1 + duration 0.01ms — но animation property всё ещё активирован, paint не stops.

**Должно быть:** В `prefers-reduced-motion` блоке явно:
```css
.bd-meme-eye, .bd-meme-grin, .bd-meme-face,
.ts2-demo-banner-dot, .ts2-skel-line {
  animation: none !important;
}
```

**Цена:** S.

---

### F20 — Modal overlay `ts2-config-modal` использует общий `.modal-overlay` класс — но в `_openConfigModal` создаётся через `insertAdjacentHTML('beforeend')` [Medium]

**Где:** `integrations/teamScanner2.js:1591` — `document.body.insertAdjacentHTML('beforeend', html);` где `html` начинается с `<div class="modal-overlay" id="ts2-config-modal">` (renderer line 2379, 2423).

**Брендбук:** не явно.

**Текущее:** Хорошо, что используется `.modal-overlay` — он покрыт scroll-lock (line 2833) и общий fade-in animation (`modal-overlay-in var(--motion-mid) var(--ease-standard)`, line 2842). НО — `_openHowModal`, `_openDiagModal`, `_openResolveModal`, `_openCrvModal`, `_openAnomalyModal`, `_openVelocityModal` используют **свои** overlay-классы (`ts2-how-modal-overlay` etc.) которые НЕ покрыты общим scroll-lock и НЕ имеют общей entry-анимации.

**Должно быть:** Унифицировать. Все модалки → класс `.modal-overlay` + дополнительный модификатор. Или — добавить `.ts2-how-modal-overlay`, `.ts2-diag-modal-overlay`, etc. в scroll-lock list (см. F4).

**Цена:** S.

---

### F21 — Sankey hover transition не задано [Low]

**Где:** `styles.css:13163-13169`:
```css
.ts2-sankey:hover .ts2-sankey-link { fill-opacity: .14; }
.ts2-sankey:hover .ts2-sankey-link:hover { fill-opacity: .92; }
.ts2-sankey-node:hover { filter: drop-shadow(0 2px 5px rgba(15, 23, 42, .25)); }
```

**Брендбук:** §12 #5 — без drop-shadow. Sankey-node hover нарушает.

**Текущее:** Filter drop-shadow на hover — flat-graphics policy violation, плюс нет `transition` → snap.

**Должно быть:** `box-shadow: inset 0 0 0 2px var(--prizma-information)` или просто `stroke: var(--prizma-information)` + `transition: stroke 240ms ease-out`. Без drop-shadow.

**Цена:** XS.

---

### F22 — `ts2-narrative-copy:hover` использует filter brightness [Low]

**Где:** `styles.css:12719` (нужно подтвердить — но grep показал hover) и `styles.css:13525` `button.ts2-glance-anomaly:hover { filter: brightness(0.95); }`.

**Брендбук:** §12 #5 не явно покрывает filter brightness, но «без эффектов» в §9.

**Текущее:** brightness — не motion-vocab brand, и зависит от рендера ОС (LCD subpixel issues).

**Должно быть:** Прямое изменение background или color через `var(--prizma-information-bg)` как везде в скоупе.

**Цена:** XS.

---

### F23 — Tooltip `ts2-tip-in` 140ms 60ms ease-out — слишком быстро для «спокойствия» [Low]

**Где:** `styles.css:13218, 13231` — `animation: ts2-tip-in 140ms 60ms ease-out forwards`.

**Брендбук:** §9 «спокойствие». 240ms — стандарт. Tooltip — appearance не state-change, можно быстрее, но 60ms delay + 140ms duration = 200ms total — близко к 240, но fade idiom.

**Текущее:** OK на грани.

**Должно быть:** Если оставить 200ms total — норм. Унификация с другими fade-in (например `prizma-fade-in 180ms ease-out` line 751) была бы лучше.

**Цена:** XS.

---

### F24 — `.bd-issue-row:hover` использует tinted background без transition [Low]

**Где:** `styles.css:11746` — `.bd-issue-row:hover { background: rgba(99,102,241,.06); }` — нет transition.

**Текущее:** Snap-feedback при hover (резкий цветовой скачок).

**Должно быть:** `transition: background 240ms ease-out` на `.bd-issue-row` базовом правиле.

**Цена:** XS.

---

### F25 — `.ts2-flash-attention` (V18.3 — refresh button после save config) → 2 раза 1s [Low]

**Где:** `styles.css:14286` `animation: ts2-flash-attention 1s ease-out 2;`.

**Брендбук:** §9 Pulse 1600ms loop, ease-out, scale 0.4→1.6 opacity 0.8→0. Это ring вокруг звезды.

**Текущее:** flash-attention использует `box-shadow: 0 0 0 0 var(--prizma-information) → 0 0 0 6px rgba(99,102,241,.25) → 0 0 0 0` — близко к pulse-ring но с другими пропорциями (6px max не достигает scale 1.6) и duration 1s × 2 = 2s, не 1.6s × N.

**Должно быть:** Унифицировать с `prizma-pulse-ring` (theme.css:181) — `0% { transform: scale(0.4); opacity: 0.8; } 100% { transform: scale(1.6); opacity: 0; }`. Длительность 1600ms × 1 повторение (один pulse, не два — спокойнее).

**Цена:** XS.

---

### F26 — `ts2-fade-in` 180ms vs `ts2-modal-in` 180ms vs `ts2-slide-in` 220ms — несогласованные durations [Polish]

**Где:** `styles.css:14688, 14704, 14716` — три разных duration на похожие entry-эффекты.

**Брендбук:** §9 общий принцип one-vocabulary.

**Текущее:** Полу-хаос.

**Должно быть:** Один токен `--prizma-motion-modal: 240ms` для всех modal entries.

**Цена:** XS.

---

### F27 — Backdrop click для modal: проверить что НЕ закрывает modal со state с unsaved changes [Polish]

**Где:** `_openConfigModal` (line 1601-1605):
```js
overlay?.addEventListener('click', (ev) => {
  if (ev.target === overlay || ev.target.closest?.('[data-close-modal]')) close();
});
```

Закрывается без confirmation, даже если пользователь поправил threshold-input'ы и не нажал Save.

**Брендбук:** §7 ToV «уважает время» = не теряет работу пользователя.

**Текущее:** Случайный backdrop-click → потеря изменений.

**Должно быть:** При наличии modified `.ts2-config-input` отвести с confirm dialog, либо игнорировать backdrop click и оставить только Esc + ✕.

**Цена:** S.

---

### F28 — Cursor pointer не на всех `[role="button"]` [Polish]

**Где:** `.ts2-row` (line 14440) имеет `cursor: pointer` ✓. Но `.ts2-counter[data-clickable]` (13124) задан условно — если HTML не получил атрибут, cursor дефолтный. `.ts2-glance-jump` (14327) ✓. `.bd-issue-row` — не нашёл cursor.

**Брендбук:** не явно.

**Текущее:** Inconsistent — некоторые clickable не показывают «можно кликнуть» при наведении.

**Должно быть:** `[role="button"], [tabindex]:not([tabindex="-1"]) { cursor: pointer }` глобально (применить осторожно, не задеть `<details>`).

**Цена:** XS.

---

## Идеи улучшения micro-interactions

1. **Star-marker на L3 skeleton.** §11 спецификация: «маленькая звезда в углу как маркер бренда» — у `.ts2-skeleton` (15002) сейчас нет звёзды, не отличается от generic skeleton.

2. **Pulse-ring на «Дрейф обнаружен» banner.** Когда `.ts2-glance-help-item` появляется (помощь нужна), задействовать §9 Pulse — 1600ms ring вокруг счётчика. Сейчас просто красный фон — pull-to-attention слабый.

3. **Breathe на star-icon в demo-tag.** `.ts2-demo-tag` (15680) сейчас статичный uppercase-badge. Добавить мини-звезду 8px рядом с текстом «DEMO» с `prizma-breathe 4s` — постоянный subtle reminder.

4. **Align-жест при смене team-tab.** Когда юзер кликает `.ts2-team-tab` (один из 5 команд), на topbar-module-icon (`.topbar-module-indicator`) трактовать это как «смена контекста» = align 1600ms spring rotate. Уже есть готовый класс `is-aligning` (styles.css:318) — wire в `_handleTeamTabClick`.

5. **Smooth team-row reorder при sort.** Когда sort меняется, `.ts2-row` сейчас просто переvыстраивается через `innerHTML`. Добавить FLIP animation (240ms ease-out) на translate каждой row на новый Y — даёт ощущение «команда движется по карте».

6. **Click-feedback на `ts2-issue-link`.** Сейчас hover меняет border-bottom на dashed→solid. На click (перед открытием Jira) — мгновенный flash-glow (200ms) чтобы пользователь понял «открываю в новом табе».

7. **Anchor-scroll: lift-up animation для target.** Когда `target.scrollIntoView` (line 1307), помимо подсветки (см. F12) — приподнять target на 4px (`transform: translateY(-4px)`) на 240ms, затем вернуть. Лёгкий «тут!» эффект.

8. **Refresh action: emerge-жест на star.** Когда `_fetchAndRender` начинается, на topbar-star-icon применить emerge 1100ms (§9 #1) — «звезда заново собирается, курс пересверяется».

9. **Toast queue motion: stack-lift.** Если приходят 2+ toast'а подряд, текущий должен слегка подниматься (translate-Y -8px, 240ms) уступая место новому. Стопка из 3 — fluid, не jumpy.

10. **Sub-tab indicator: line slide.** В `.bd-tabs` (11684) активная вкладка имеет `border-bottom-color`. При смене tab — 240ms ease-out slide линии слева-направо/наоборот вместо мгновенной смены.
