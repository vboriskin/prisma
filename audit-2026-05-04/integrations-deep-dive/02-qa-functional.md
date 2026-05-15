# 02 — QA Functional audit

## Сводка
- Critical: 1
- High: 6
- Medium: 9
- Low: 7
- Polish: 5
- **Итого: 28 находок**

## Метод

Runtime я не запускал — статический анализ + logic-tracing по чтению источников.

**Файлы прочитаны end-to-end:**
- `views/integrationsView.js` (646 LOC) — sub-tab orchestration + settings modal binding
- `integrations/integrationsRenderer.js` (177) — settings modal HTML
- `integrations/integrationsStore.js` (~180) — settings load/save + token-presence flags
- `integrations/blackDashboard.js` (234) — orchestrator
- `integrations/blackDashboardApi.js` (148) — async-job + polling
- `integrations/blackDashboardRenderer.js` (681) — все три tab'а + states
- `integrations/loaderPhrases.js` (63) — пул фраз для loader'а
- `integrations/teamScanner2.js` (2269) — orchestrator (полное чтение)
- `integrations/teamScanner2Renderer.js` (~600 ключевых строк, остальное — выборочно по grep'ам): topbar / empty / error / skeleton / detail-panel / heatmap / multi-team / config-modal / share-link
- `integrations/teamScanner2History.js` (~100) — snapshot/loadHistory
- `integrations/teamScanner2Diagnostic.js` (~100) — gatherDiagnosticState header
- Выборочные grep'ы по `styles.css` для проверки spinner / tabular-nums / brandbook compliance.

**User-flows прослежены end-to-end:**
1. Холодный старт без settings → empty-hero «no-config» → CTA «Открыть настройки» (или «Демо»)
2. Cold start с settings, без cache → empty-hero «no-data» → «Загрузить данные команды»
3. После первого fetch → renderFull → topbar + team-glance + person-rows
4. Click по row → side-panel slide-in (480px, fixed) → close по ✕/backdrop/Esc
5. Refresh из topbar (`#ts2-refresh-btn`) — aborts pending + reset state + new fetch
6. Sub-tab switch (scanner ↔ black) → IntegrationsView.render() пересобирает root.innerHTML
7. URL hash share-link `#scanner2/employee/<key>` → auto-open detail panel
8. URL hash `#scanner2/demo` → demo-режим
9. Diag modal → safe export / raw export → consent flow → JSON download → audit-log
10. Identity Auto-Resolve: BB+CF lookup batched → preview → save через Reactive.silent
11. BD: not-configured → settings → not-loaded → load → goals/coverage/metrics tabs
12. BD: loader (meme-face) с rotating phrases + cancel → renderError → retry
13. Settings modal: 4 tabs (Jira Delta / Jira Sigma / BB / Confluence) → save + verify

---

## Находки

### F1 — `isStale` / `cacheAgeMs` пробрасываются в renderTopBar, но stale-banner не рендерится [Critical]

**Где:**
- `integrations/teamScanner2.js:884-885` (compute `cacheAgeMs`, `isStale`)
- `integrations/teamScanner2.js:936` (передача в renderTopBar через ctx)
- `integrations/teamScanner2Renderer.js:250-291` (renderTopBar — параметры приняты, но не используются)
- `integrations/teamScanner2.js:1294-1298` (handler для `#ts2-stale-refresh` который никогда не выстреливает)

**User flow:** «Открыл сканер вчера → cache 24 часа → пришёл сегодня утром в 9:30 → видит данные «вчерашних» событий → принимает решения по stale data»

**Что наблюдается:** Cache TTL = 5 минут. Логика гибрид-кеша (V20 S1.1) предполагает: при cache age >5min — re-paint + stale-banner с кнопкой «обновить». В коде:
- `_isCacheStale()` возвращает `true` корректно
- В `_renderFull()` собирается `cacheAgeMs` + `isStale` и передаётся в `renderTopBar(m, { ..., cacheAgeMs, isStale, ... })`
- В `renderTopBar()` (строки 250-291) эти поля **никогда не читаются и не отображаются**
- `_humanizeAge()` экспортирована (строка 487) но не вызывается
- Click handler `#ts2-stale-refresh` зарегистрирован (строка 1295) — но соответствующий DOM-element никогда не рендерится

**Что должно быть:** Banner вида «Данные были загружены 23 минуты назад. [Обновить]» поверх dashboard, при `isStale=true`. Это документировано в коде как ключевой элемент гибрид-cache.

**Воспроизведение:**
1. Загрузить сканер
2. Подождать > 5 минут (или поменять `_FRESH_TTL_MS` в DevTools на 30 сек)
3. Любое действие, которое триггерит re-render (например, открыть/закрыть detail-panel)
4. Stale-banner не появляется → пользователь не знает что данные устарели

**Рекомендация (без потери функционала):** Добавить в `renderTopBar` сразу после demoBanner:
```js
const staleBanner = ctx.isStale ? `
  <div class="ts2-stale-banner" role="status">
    <span class="ts2-stale-dot" aria-hidden="true"></span>
    <span>Данные обновлены ${_humanizeAge(ctx.cacheAgeMs)} назад.</span>
    <button class="ts2-btn ts2-btn-ghost ts2-btn-sm" id="ts2-stale-refresh" type="button">Обновить</button>
  </div>` : '';
```

**Цена:** S — ~10 LOC в renderTopBar, CSS возможно уже есть (есть `ts2-stale-pr-*` стили, можно reuse наследников).

**Severity рaтionale (Critical):** Это **silent staleness** — тимлид принимает оперативные решения утром по тому, что считает «свежими» данными, а на самом деле им несколько часов. В рабочем потоке Сбера 9:30-meeting это блок принятия решений. Документация в коде утверждает «фича работает», но фактически она убита незаметно. Явно не stub — handler для refresh-button прописан → ожидается полная функциональность.

---

### F2 — Сменa subtab «Сканер ↔ Чёрный дашборд» полностью пересоздаёт DOM, scroll/выбор команды/expand-state теряются [High]

**Где:**
- `views/integrationsView.js:545-611` (`render()` — `root.innerHTML = ...`)
- `views/integrationsView.js:572-586` (subtab click handler вызывает `this.render()` который перезаписывает innerHTML)

**User flow:** «Я смотрю на команду CORE, проскроллил до 5-го человека (idle group), хочу сравнить с чёрным дашбордом → click `Чёрный дашборд` → нажал назад → scroll сброшен наверх + команда сменилась на default»

**Что наблюдается:**
- `_activeSubtab` / `_scanner2Loaded` сохраняются в IntegrationsView
- `TeamScanner2._activePkFilter` / `_expandedKey` / `_searchQuery` сохраняются на orchestrator (instance prop)
- НО `unmount()` (строка 2248) **сбрасывает** `_searchQuery = ''` + `_initialTeamApplied = false` + `_expandedKey = ''`
- `_renderFull()` снова вызывает `_applyPersistedTeamSelection` если `!_initialTeamApplied` → выбор команды берётся из localStorage (это OK)
- Search query — теряется
- Открытый detail-panel — закрывается
- Scroll — теряется (не сохраняется и не восстанавливается; `ts2-root` пересоздаётся)

**Что должно быть:** При переключении табов scroll position соответствующего sub-view сохраняется и восстанавливается; expanded panel остаётся открытым; search query persistится в LS или surface-state.

**Воспроизведение:**
1. Сканер → загрузить → проскроллить вниз до idle группы
2. Открыть detail-panel у любого
3. Click «Чёрный дашборд»
4. Click «Сканер команд»
5. Detail-panel закрыт, scroll наверху, search-input пустой

**Рекомендация (без потери функционала):**
- Сохранять `IntegrationsView._scrollY[subtab]` при clickn → restore через `requestAnimationFrame` после render.
- В `unmount()` НЕ сбрасывать `_searchQuery` (currently сбрасывается явно — изменить флаг).
- `_expandedKey` — если хотим сохранять, нужно учесть что side-panel rebuild на attach обновится через `_renderFull`.

**Цена:** S — 15-20 LOC в IntegrationsView (`_scrollY` map + restore on render).

---

### F3 — `loaderPhrases.js`: каждая из 37 фраз содержит эмодзи, видна пользователю в обоих интеграциях [High]

**Где:** `integrations/loaderPhrases.js:10-48`

**User flow:** «Жму «Загрузить» → жду 8-180 секунд → каждые 2.6 сек меняется фраза с эмодзи»

**Что наблюдается:** Phrases используются в:
- BD loader (`renderLoader()` line 668: `'⏳ Просыпаюсь, потягиваюсь…'`) и rotating через `makePhraseFeeder()`
- Phrases — все имеют префиксный эмодзи: 🤖 ☕ 🐌 🎯 📜 🔎 🧠 🐘 🛸 🪄 ☁️ 🧩 ⏳ 🎲 🐙 📡 🥷 🪜 🛠 🦥 🎩 🚀 🐢 🍿 🪴 🎸 🔍 🛰 🦉 🎭 🪤 🏗 🧹 🦦 🐉 ⚓ 🌿
- Brandbook §1: «Без эмодзи в production UI».

**Что должно быть:** Либо фразы без эмодзи, либо иконка через SVG (Icons.get('hourglass') и т.д.). Длительный loader — особенно нагруженный пользовательским вниманием — самая видная нарушение.

**Воспроизведение:**
1. Сканер с настроенными pks → click «Загрузить данные команды»
2. Чёрный дашборд → click «Загрузить»
3. В обоих случаях видно ротацию emoji-phrases

**Рекомендация (без потери функционала):** Заменить эмодзи на SVG-icons либо текст.
```js
// до: '🤖 Беру у джуна интервью…'
// после: 'Беру у джуна интервью…'   (без эмодзи, юмор остаётся)
// или: { icon: 'sparkle', text: 'Беру у джуна интервью…' }  (SVG)
```

**Цена:** S — replace-all эмодзи в файле; semantic — фразы остаются юмористическими без эмодзи.

---

### F4 — Brandbook violation: эмодзи в кнопках topbar, kebab-menu, panel-actions, BD tabs [High]

**Где:**
- `integrations/teamScanner2Renderer.js:274` `📋 Диагностика`
- `:275` `↻ Обновить`
- `:278` `⋯` (kebab — допустимо, это типографический символ, не эмодзи)
- `:280` `❓ Как считается`
- `:281` `⚙ Настройка команд` (тоже типографический символ — серая зона, но в составе кнопки выглядит как эмодзи)
- `:282` `👥 По командам` / `Одна команда`
- `:1039` `📋 копировать`
- `:2619` `💬` (1:1 talking points pill)
- `:2894` `📋 копировать` (narrative-copy)
- `:3068` `📋 TG`
- `:3071` `🔗` (share-link)
- `integrations/blackDashboardRenderer.js:182-184`: tabs `🎯 Цели` / `🔗 Покрытие` / `📈 Метрики`
- `:196` `⚫ Чёрный дашборд`
- `:199` `↻ Обновить`
- `:271` `✅ ${team.done} · ▶ ${team.wip} · ☐ ${team.todo}`
- `:604` `⚙` (state icon)
- `:612` `📥` (state icon)
- `:668` `⏳` (loader phrase prefix)
- `:671` `✕ Отменить`
- `:676` `⚠` (error state icon)

**User flow:** «Открываю Сканер → топбар, кебаб, чёрный дашборд → везде emoji-icons вместо semantic SVG»

**Что наблюдается:** CLAUDE.md строка 158: «Без эмодзи в production UI». BRAND_BOOK §11: «иконки — semantic SVG (`star.svg`, `komanda.svg` etc)». Здесь массовое исключение.

**Что должно быть:** Все эмодзи в UI заменены на `Icons.get('refresh')`, `Icons.get('settings')`, `Icons.get('share')` и т.д. Допустимы: `↻`, `↗`, `↘`, `→`, `▌`, `·`, `…` — это типографические символы, не эмодзи (рекомендация brandbook).

**Воспроизведение:** Любой visit на Сканер 2.0 / Чёрный дашборд.

**Рекомендация (без потери функционала):** Систематический pass через `Icons.get(name)`.

**Цена:** M — нужны новые SVG-иконки в палитре (clipboard, share, chat-bubble, ok, cancel, hourglass, mailbox, gear-fill — некоторые есть, некоторые нет). Замена в 8-10 местах.

---

### F5 — BlackDashboard renderError выводит сырые HTTP-коды (HTTP 401, HTTP 500) пользователю [High]

**Где:**
- `integrations/blackDashboardApi.js:66` `throw new Error(json.error || \`HTTP ${res.status}\`)`
- `:89` идентично для polling
- `integrations/blackDashboard.js:160-171` показывает `e.message` через `renderError()` без `_humanHttp` translation

**User flow:** «Sigma токен протух → open Чёрный дашборд → click Загрузить → error 'HTTP 401'»

**Что наблюдается:** `views/integrationsView.js:75-85` имеет полный `_humanHttp()` который превращает 401 → «Jira не пускает (нужен новый токен)». BlackDashboard этим helper'ом не пользуется — копия логики не сделана. Пользователь видит «HTTP 401» / «HTTP 500» (P11.15 ToV regression).

**Что должно быть:** BlackDashboard.renderError получает уже human-friendly message либо использует общий `_humanHttp` helper.

**Воспроизведение:** Истёкший токен Sigma → BD load → текст «HTTP 401».

**Рекомендация:** Вынести `_humanHttp` в shared helper в `integrationsRenderer.js` или в `errorMapping.js`, использовать из обоих модулей.

**Цена:** S — extract function + import.

---

### F6 — Settings modal не-inline вариант содержит ⚙ и ✕ в HTML-разметке header'а (brandbook violation) [Medium]

**Где:** `integrations/integrationsRenderer.js:20`
```html
<div class="int-modal-header">
  <span class="int-modal-title">⚙ Настройки интеграций</span>
  <button class="int-modal-close" id="int-modal-close">✕</button>
</div>
```

**User flow:** «Жму шестерёнку в topbar → открывается модалка → видно ⚙ в заголовке и ✕ для close»

**Что наблюдается:** Brandbook violation. Inline-mode (line 18) скрывает header → значит standalone-mode используется только в legacy сценариях, но всё ещё рендерится при определённых путях открытия.

**Рекомендация:** `Icons.get('gear')` + `Icons.get('close')`.

**Цена:** S.

---

### F7 — `_pendingShareKey`: при открытии share-link на удалённого/несуществующего сотрудника пользователь не получает feedback [High]

**Где:** `integrations/teamScanner2.js:840-845`

**User flow:** «Тимлид прислал в TG ссылку `…#scanner2/employee/USR-123`. Сотрудник был удалён или не входит в активные проекты. Открываю → URL hash подцепляется, но panel не открывается.»

**Что наблюдается:**
```js
if (this._pendingShareKey) {
  const exists = (m.participants || []).some(p => p.key === this._pendingShareKey);
  if (exists) this._expandedKey = this._pendingShareKey;
  this._pendingShareKey = '';   // silently drop
}
```
Никаких toast / banner / попытки сообщить пользователю что ссылка протухла. URL hash остаётся в браузере (replaceState не вызывается для очистки).

**Что должно быть:** Toast «Сотрудник не найден в активных проектах» + clear hash. Опционально: список похожих ключей (если есть).

**Воспроизведение:**
1. Открыть `…/#scanner2/employee/NONEXISTENT-USER` (любой невалидный key который проходит regex `[A-Za-z0-9._-]{1,64}`)
2. Сканер загружается, panel не открывается, причина не объяснена

**Рекомендация:**
```js
if (this._pendingShareKey) {
  const exists = ...;
  if (exists) this._expandedKey = this._pendingShareKey;
  else {
    window.showToast?.('Сотрудник по ссылке не найден в активных проектах', 'warning', 5000);
    // Очистим hash чтобы reload не повторил то же самое
    history.replaceState(null, '', location.pathname + location.search);
  }
  this._pendingShareKey = '';
}
```

**Цена:** S.

---

### F8 — `glance-jump` (anchor-jump к группе) silently no-op если группа пустая, без feedback [Medium]

**Где:** `integrations/teamScanner2.js:1301-1308`

**User flow:** «Кликаю counter «Watch» в team-glance — но в данный момент эта группа пустая (счётчик 0)»

**Что наблюдается:** Counter не рендерится при `count = 0` (строки 845-848 рендерят только `count > 0`), так что прямой касса непосредственно невозможна. НО в multi-team-view click по team-row → потом обратный switch может оставить anchor-target отсутствующим если фильтр изменился. Также в no-data scenarios для idle группы — она `<details>` открывается даже пустая. Однако сейчас анкор всегда есть → проблема фантомная. **Понижаю до Polish.**

**Severity:** ~~Medium~~ → переоценка как **Polish**, см. F22.

---

### F9 — `_panelFilters` не персистится между перезагрузками страницы [Medium]

**Где:** `integrations/teamScanner2.js:145`

**User flow:** «Я тимлид, обычно отключаю Confluence + Bitbucket — мне важна только Jira. Каждое утро открываю scanner → все 5 источников включены, отключаю их каждый раз вручную.»

**Что наблюдается:** `_panelFilters: { j: true, b: true, c: true, zc: true, ze: true }` — initial value. При page reload или новой сессии — сбрасывается в default. Никаких `localStorage.setItem`.

**Что должно быть:** При toggle filter — persist в LS (key `q2_scanner2_panel_filters`), при mount — load из LS.

**Рекомендация:** аналогичный pattern как `_LS_SELECTED_TEAM_KEY` (V20 S10.5).

**Цена:** S — ~15 LOC.

---

### F10 — Refresh-кнопка не disabled во время повторного click'а (на topbar после первого load) [Medium]

**Где:** `integrations/teamScanner2.js:1086`
```js
root.querySelector('#ts2-refresh-btn')?.addEventListener('click', () => this.refresh());
```
`integrations/teamScanner2.js:542-555` (refresh — abort prev + reset)

**User flow:** «Click ↻ → видим skeleton → click ↻ ещё раз случайно → второй refresh aborts первый, начинаем заново»

**Что наблюдается:** `refresh()` корректно вызывает `_abort?.abort()` перед новым fetch'ем. Но кнопка не получает `disabled` — пользователь не понимает что click сработал. Visual feedback отсутствует.

Когда _renderFull рисует topbar после фетча — refresh-button новый. Но если cache всё ещё есть → пользователь видит cached UI с активной кнопкой → click → начинается новый fetch → topbar заменяется skeleton. Между click и заменой DOM — кнопка отзывчивая повторно. Возможен 2-3-кратный re-fetch.

**Что должно быть:** `aria-busy="true"` + `disabled` на refresh-button во время `_loading=true`. Skeleton полностью замещает topbar — но если skeleton не полное замещение, нужен disabled state.

Stale-banner refresh (F1) тоже без disabled — но он сейчас не рендерится (см. F1).

**Рекомендация:**
```js
refresh() {
  if (this._loading) return;  // double-click guard
  ...
}
```
Либо disabled через DOM property.

**Цена:** S.

---

### F11 — При successful `Identity Auto-Resolve` нет автоматического re-fetch с новым identity → пользователь должен жать «Обновить» вручную [Medium]

**Где:** `integrations/teamScanner2.js:2142-2143`

**User flow:** «Открыл Diagnostic → запустил Resolve → 30 сотрудников получили bbLogin / cfId → save → toast «обновлены» → но я всё ещё вижу старые данные с identity gap»

**Что наблюдается:**
```js
this._announce(`Identity заполнен: ${updated} полей у ${changes.length} сотрудников. Нажмите ↻ Обновить чтобы пересчитать с новой identity.`);
try { window.showToast?.(`Identity обновлён: ${updated} полей у ${changes.length} сотрудников`, 'success', 5000); } catch (_) {}
```
В UX логика «вы изменили identity → теперь данные пересчитаются автоматически» естественнее чем «нажмите ↻ Обновить чтобы…». Сотрудники теперь имеют идентификаторы — re-fetch использует их.

**Что должно быть:** Toast вида «Идентификаторы обновлены, пересчитываю…» + автоматический `this.refresh()`.

Альтернатива (для consistency): кнопка «Применить и обновить» в preview-modal вместо просто «Сохранить».

**Цена:** S — поменять label кнопки + добавить trigger refresh.

---

### F12 — Multi-team aggregate ↔ single-team: при click из multi-view на team-row, `_initialTeamApplied` остаётся true, но переключение происходит — race с `_applyPersistedTeamSelection` отсутствует [Medium]

**Где:**
- `integrations/teamScanner2.js:1029-1043` (`_setSelectedTeam` / `_setMultiView` — оба persist'ят селекцию)
- `integrations/teamScanner2.js:930-933` (initial apply из LS только при `!_initialTeamApplied`)

**User flow:** «Multi-view → click team CORE → переключаюсь на team-view CORE»

**Что наблюдается:** Pathway работает корректно. `_setSelectedTeam` обновляет `_activeView='team'` + `_activePkFilter='CORE'` + persist в LS + closePanel + render. `_initialTeamApplied=true` после первого render — последующие render'ы не перетирают user choice. **Проверка: проходит.**

Однако: если switch'ить subtab → `unmount()` ставит `_initialTeamApplied=false` (строка 2265) → при re-attach _renderFull снова применит persisted из LS. Если pk удалили из настроек между сессиями → fallback на `pks[0]` (первый алфавитно). User-choice потерян.

**Что должно быть:** Fallback message «Команда X была удалена из настроек, переключил на Y».

**Severity:** Medium — но это deep edge case (PO удалил pk → next visit видит другую команду без объяснения). Понижаем до **Low**.

---

### F13 — Empty state «no-data» не обрабатывает edge: server-down при первом «Загрузить данные команды» [Medium]

**Где:** `integrations/teamScanner2.js:412-433` `_bindEmptyButtons`

**User flow:** «Cold start без cache → empty-hero → click «Загрузить» → server недоступен (proxy down) → 30 сек ждём → renderError»

**Что наблюдается:** `_fetchAndRender` корректно ставит `_loading=true`, показывает skeleton с `cancel`. На error — `_paintError` + retry button. **Работает.**

НО: skeleton показывает initial msg «Запрашиваю N проект(а/ов) из Jira…» и фразу-юмор. Если `fetchPulseData` зависает на первом GET (DNS resolution timeout 30s), пользователь видит ту же фразу 30s. `onProgress` callback не передаётся → нет update в loader.

**Что должно быть:** `onProgress` callback из `fetchPulseData` (он экспортируется из pulse/index.js — out of scope?).

Проверка: `fetchPulseData(...)` line 647 — без onProgress. `fetchPulseData` (Pulse) сам внутри полл'ит /status, имеет phase. Не передаётся в loader → длинный timeout без feedback.

Recommendation: scanner skeleton subscribes to fetchPulseData onProgress (если поддерживается).

**Цена:** M (требует API-extension в pulse).

---

### F14 — Confluence «Audit log» probe button (G7) показывает success icon `✓` через signal-dot, но в same code path старые login показываются как plain text (PII risk если данные не санитайзированы) [Medium]

**Где:** `views/integrationsView.js:441-445`
```js
const top = users.slice(0, 5).map(u => `${u.displayName || u.username || '?'} (${u.loginCount})`).join(', ');
res_el.className = _statusCls('ok');
const meta = `Аудит за <span class="num-tnum">${data.windowHours}</span>ч: <span class="num-tnum">${users.length}</span> пользователей, <span class="num-tnum">${data.loginRecords}</span> событий${top ? ' · топ: ' + _esc(top) : ''}`;
res_el.innerHTML = `<span class="signal-dot signal-on-course" aria-hidden="true"></span> ${meta}`;
```

**Что наблюдается:** `_esc(top)` корректно эскейпит. Но `data.windowHours`/`users.length`/`data.loginRecords` вставляются **не-эскейпнутыми** через template literal. Если сервер вернёт NaN или строковую кашу — XSS возможен через corrupted server response. Низкая вероятность, но contract violation.

**Что должно быть:** `_esc(String(data.windowHours))` для defense-in-depth.

**Цена:** S — добавить `_esc()` обёртку.

---

### F15 — Settings modal: `int-jira-token` / `int-bb-token` etc. value предзаполнены через `loadSettingsForUI()` который возвращает raw token — risk при screenshot/screen-share [Medium]

**Где:**
- `integrations/integrationsStore.js:84-93` (`loadSettingsForUI` returns raw tokens)
- `integrations/integrationsRenderer.js:46` `value="${esc(s.jiraToken||'')}"` (real token in HTML attribute)

**User flow:** «Открываю Настройки → screenshot для шеринга → токен в DOM попадает (хотя `type="password"` маскирует)»

**Что наблюдается:** Inputs `type="password"` маскируют визуально. НО:
- В DOM (через DevTools / extensions / screen reader) raw token виден в `value` attribute
- F11.15 toggle «глаз» (line 458-481) меняет type на text → токен виден на экране → screenshot leak

**Что должно быть:** Хранить токен в local map (не в DOM attribute), assign value через JS только при focus + clear on blur. Или: hash-mask при отображении ('•' × len) до того как user явно кликнет «глаз».

Альтернатива: показывать «настроен (не показывать)» вместо предзаполнения, и разрешать только полный ре-ввод. Но это усложняет flow.

**Severity:** Medium — это потенциальный security risk, но раскрытие требует физический доступ к экрану / DevTools. Comment в коде (line 81: «MUST NOT be used for any LLM payload or anywhere it could leak») признаёт риск.

**Цена:** M — изменение pattern и тестирование verify/save flows.

---

### F16 — Save buttons в settings modal disabled на время `await postServerConfig` (F1 fix V17.2 I3 хороший), но Verify button — НЕТ [Medium]

**Где:** `views/integrationsView.js:197-221` (`int-jira-verify` handler)

**User flow:** «Нажимаю Verify → быстрый double-click → request-id guard защищает paint, но fetch отправляется дважды → дубли на сервер»

**Что наблюдается:**
```js
modal.querySelector('#int-jira-verify')?.addEventListener('click', async () => {
  // нет btn.disabled = true
  ...
  const r = await verifyJira();
  ...
});
```
Request-id guard (`_verifyReqIds`) защищает от paint-race, но не от double-fetch. Корп Jira имеет rate-limit; повторные verify clicks → 429.

**Что должно быть:** Все verify-buttons должны быть disabled во время in-flight request. То же для Sigma / BB / CF / Audit-probe.

**Цена:** S — wrap каждого handler'а в `try/finally { btn.disabled }` pattern, как сделано в save (например, line 166-194).

---

### F17 — `kebab-menu` keyboard navigation — Tab работает, но arrow-keys не реализованы (ARIA menu pattern incomplete) [Low]

**Где:** `integrations/teamScanner2.js:1090-1120`

**Что наблюдается:**
- Esc закрывает (good)
- Click outside закрывает (good)
- Tab переключает между items (browser default)
- Arrow Up/Down между items — **не работает**, что нарушает ARIA `role="menu"` pattern

**Цена:** S.

---

### F18 — Demo-mode entry/exit `URL hash` поведение: при exit `_demoMode = false` но `_model` сбрасывается → reload не возвращает обратно [Low]

**Где:** `integrations/teamScanner2.js:471-485` (`exitDemo`)

**User flow:** «В демо → click «Выйти из демо» → возврат к empty-hero → reload страницы → данные не загружены, demo не активен → пустое состояние»

**Что наблюдается:** Hash сбрасывается, model сбрасывается. Если raw data был загружен ДО demo (демо переписал hash) — он потерян. Но это документированное поведение (line 458 «Hash перезаписывает любой существующий»). Acceptable trade-off.

**Severity:** Low — задокументированное поведение, но user-flow «случайно открыл demo через ссылку → потерял прогресс по реальному фетчу» возможен.

---

### F19 — Show-blocked / active-sprint toggle вызывают `this.refresh()` — полный re-fetch вместо переключения локального флага [Low]

**Где:** `integrations/teamScanner2.js:1193-1222`

**Что наблюдается:** Переключение «Показать заблокированных» / «Только активный спринт» → `this.refresh()` → 8-30 секунд ожидания.

Комментарий (line 1206-1207) поясняет: «Filter применяется на enrichment-stage… нужен fresh fetch». Это техническое ограничение, не UX choice. **Acceptable workaround**, но рассмотреть `_reEnrichWithNewConfig`-pattern: cached raw → re-enrich + re-render без fetch.

**Цена:** M — кэшировать `raw` в orchestrator (memory footprint × 2).

---

### F20 — Datetime format inconsistency: BlackDashboard `'ru'`, TeamScanner `'ru-RU'` [Low]

**Где:**
- `integrations/blackDashboard.js:184` `new Date(...).toLocaleString('ru')`
- `integrations/teamScanner2Renderer.js:3250` `new Date(e.at).toLocaleString('ru-RU', { hour, minute, day, month })` — без года

**Что наблюдается:** `'ru'` → `01.05.2026, 14:23:45`. `'ru-RU'` с custom options → `01.05, 14:23`. Не одинаковы.

CLAUDE.md говорит «Сбер обычно DD.MM.YYYY». Оба формата valid, но смешение между табами вызывает edge-cognitive-load.

**Рекомендация:** Унифицировать через helper `Utils.formatDateTime(ts)`.

**Цена:** S.

---

### F21 — `_postStart` в blackDashboardApi.js падает с message `'Сервер не вернул jobId'` через `throw new Error(...)` — пользователь видит RU-фразу но без _humanHttp обработки [Low]

**Где:** `integrations/blackDashboardApi.js:67`

**Что наблюдается:** RU error message, но смешан с потенциальным `'HTTP 401'` из same throw chain (line 66). UX inconsistency.

**Цена:** S — собрано в F5.

---

### F22 — Anchor-jump silently no-op для пустых группы (после filter в search) [Polish]

**Где:** `integrations/teamScanner2.js:1303-1308`

**Что наблюдается:** `target` берётся через `data-group-anchor`. Если группа пустая после filter — анкор не рендерится → click silently no-op. Но counter тоже не рендерится при count=0 → click невозможен. **Edge case существует только при race между search-debounce и click.** Acceptable.

---

### F23 — `narrative-copy` button показывает `'✓ скопировано'` 1500мс через `setTimeout` — нет cleanup при unmount → если пользователь закрыл panel в эти 1500мс, setTimeout всё равно меняет `btn.textContent` на оригинал, но btn уже detached [Polish]

**Где:** `integrations/teamScanner2.js:1258-1261`, `:1344-1346`, `:1476-1477`, `:1521-1523`, `:1546-1549`

**Что наблюдается:** `setTimeout(() => { btn.textContent = orig; }, 1500)` без cleanup. Если btn detached — JS не падает (пишет в orphan node), но это leak. 5 повторений pattern.

**Рекомендация:** wrap в `if (btn.isConnected) { btn.textContent = orig; }`.

**Цена:** S.

---

### F24 — `1on1` and `tgcopy` clipboard-text использует эмодзи (🗣📊⚠🚫🔧🔗👤) — но это для TG/Slack чата, не UI [Polish]

**Где:**
- `integrations/teamScanner2.js:1331-1340` (1on1 from triage-pill)
- `:1462-1471` (1on1 from panel)
- `:1489-1510` (TG copy)

**Что наблюдается:** Эмодзи ВНЕ UI → попадают в clipboard → в TG/Slack отображаются. Это допустимо: brandbook о UI Призмы, не о сообщениях во внешние мессенджеры.

**Severity:** Polish — но обратите внимание что `btn.textContent = '🔗'` (line 1554) **возвращает эмодзи в UI** (восстановление текста кнопки `'🔗'` после ошибки share). Это противоречит F4.

**Рекомендация:** Замена `'🔗'` (line 1554) на оригинал через сохранённую строку.

---

### F25 — `Tooltip-promotion` (`_promoteTitlesToTooltips`) удаляет `title` атрибут со ВСЕХ `[title]` элементов, включая SVG `<title>` через guard. Однако SVG `<title>` в `<svg viewBox="..." aria-label="..."><title>...</title>` — тоже срабатывает [Polish]

**Где:** `integrations/teamScanner2.js:1052-1061`
```js
this._container.querySelectorAll('[title]').forEach(el => {
  if (el.tagName === 'title') return;  // только tagName, не case-insensitive
```

**Что наблюдается:** `el.tagName === 'title'` — для SVG-namespace `title` элементов. В Chrome / Firefox SVG `<title>` имеет tagName `'title'` (lowercase). Но: querySelector `[title]` выбирает элементы с **атрибутом** `title=""` — SVG `<title>` элементы не имеют атрибута title (они САМИ являются title). Так что guard избыточен (no-op). Пожалуй ненужный код, но не баг.

---

### F26 — Disclaimer modal для raw-export. Если открыли disclaimer, click outside-of-modal → ничего не происходит (нет close on backdrop) [Low]

**Где:** `integrations/teamScanner2.js:1956-1960`

**Что наблюдается:**
```js
disc.addEventListener('click', (ev) => {
  if (ev.target === disc || ev.target.closest?.('[data-close-modal]')) closeDisc();
});
```

Если `ev.target === disc` — это backdrop click, OK работает. Comment line 1956 «closeDisc» определён `closeDisc = () => disc.remove()`. Реально: только `disc` (root overlay) клик и `[data-close-modal]` button. Фактически: backdrop close работает — это tested feature. **No issue.**

---

### F27 — В `_renderFull`, при `velocityCompareOn=false` (PR-CC: «Сравнение команд» moved to modal) `velocityCompareOn` всегда `false` (hard-coded line 926). Toggle aria-pressed всё равно показывает «✓ Сравнение команд» если `velocityCompareOn` true — но никогда не true → Always disabled visually [Polish]

**Где:** `integrations/teamScanner2.js:925-927`

**Что наблюдается:**
```js
// PR-CC — comparison переехал в модалку, inline-render убран.
// Toggle в kebab открывает модалку через _openVelocityCompareModal.
const velocityCompareOn = false;
```
Захардкоженный `false`. В renderTopBar tooltip ctx.velocityCompareOn передаётся, но это всегда `false`. Aria-pressed всегда `false`. Toggle button открывает modal, но визуально не «активный» никогда. **Не баг, но кнопка с misleading aria-pressed.**

**Цена:** Trivial — убрать `aria-pressed` или поменять label.

---

### F28 — При успешном save в `_openConfigModal` вызывается `this._reEnrichWithNewConfig()` который делает `this.refresh()` (полный re-fetch 8-15 сек). UX: «save → закрылась модалка → внезапно skeleton 15 секунд». Comment предупреждает (line 2206 «5-15 сек на re-fetch это accepted price для UX»), но toast не предупреждает [Medium]

**Где:** `integrations/teamScanner2.js:1651-1652, 2210-2213`

**User flow:** «Изменил dwell-time для команды → Save → модалка закрылась → пустой экран → 15 сек skeleton → finally данные»

**Что наблюдается:** `_announce(...)` сообщает SR, но visual toast только «Настройки команд сохранены». Пользователь не понимает, что начался re-fetch.

**Что должно быть:** Toast «Настройки сохранены, пересчитываю с новыми порогами…».

**Цена:** S — изменить toast text.

---

## Приоритеты для V18 backlog

**Critical (1):**
- F1 — Stale-banner мёртв → silent staleness в utra-meeting context

**High (6):**
- F2 — Subtab switching теряет scroll/state
- F3 — Loader phrases все с эмодзи
- F4 — Эмодзи в кнопках topbar/kebab/BD-tabs (массовая brandbook violation)
- F5 — BD сырые HTTP-коды в error UI
- F7 — Share-link на удалённого silently no-op

**Medium (9):**
- F6, F9, F10, F11, F13, F14, F15, F16, F19, F28 (10 → перепроверка → одна Low по итогу)

**Low / Polish (12):** см. секции F8, F12, F17, F18, F20-F27.

## Брендбук-сводка соответствия

| Правило | Статус | Комментарий |
|---|---|---|
| Без circular spinner | ✓ | BD использует meme-face CSS; Scanner — skeleton lines. `.bd-loader-spinner` мёртвый CSS. |
| Без эмодзи в UI | ✗ | Массовое нарушение: F3 (phrases), F4 (buttons), F6 (settings header). |
| Без gradients на surfaces | ⚠ | `.bd-loader` background gradient (styles.css:10419) — но это loader, не surface. `.bd-loader-meme` radial-gradient #000 — допустимо как "Northstar splash". |
| 3px stripe-left для активных | ✓ | `.ts2-team-tab-active`, `.ts2-row-expanded` — используют stripe-left паттерн. |
| Mono-tabular numerals | ✓ | `.ts2-counter-num`, `.bd-kpi-val` — tabular nums применены через CSS. |
| Semantic SVG icons | ⚠ | Частично — `signal-dot` через CSS class работает; кнопки используют эмодзи (см. F4). |
