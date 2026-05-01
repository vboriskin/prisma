# 04. Frontend

## FE-1 [M] 95 raw-innerHTML lint warnings — миграция на `safeHtml`/`esc()` всё ещё не завершена

**Уже разобрано в `01-security.md`** (SEC-3) с security угла. Здесь — quality-of-code угол.

`safeHtml.js` существует с V11 (audit #1, lit-html-API совместимый ~50 LOC). Используется частично. 95 мест по-прежнему на `template literal` без эскейпа. Распределение:

| Файл | Warnings | Комментарий |
|---|---|---|
| `views/metrics.js` | 40 | self-contained widgets, нет user-input |
| `app.js` | 32 | mostly settings UI |
| `views/gantt.js` | 19 | rendering hot path — performance важна |
| `views/registry.js` | 12 | inline-edit + cell rendering |
| `app/storageSettings.js` | 12 | **новый файл** — все warnings унаследованы из inline-кода V12 |
| `app/llmAssistant.js` | 11 | chat output rendering |

**Severity**: M (мутный — большинство мест безопасны, но требуется триаж).

**Рекомендация** (повторно из 01-security.md):
1. Триаж 95 warnings по 3 категориям (статика / Jira-content / user-input).
2. Для безопасных — `// eslint-disable-line` + комментарий.
3. Для остальных — обернуть в `esc()`.
4. После triage: `--max-warnings 110` (95 - 95 = ~110 от unused-vars), потом понижать.

---

## FE-2 [M] Focus management в модалках отсутствует

**Файлы**: `app/llmAssistant.js`, `integrations/portfolioPulse.js`, `integrations/techInfo.js`, settings modals

Сейчас:
- `Escape` закрывает (есть, audit #26 частично сделан)
- Focus НЕ возвращается на trigger-button после закрытия
- Focus трапится внутри модалки только в LLM input, в остальных — нет

**Эффект**: keyboard-only пользователи теряются — после `Escape` фокус не там, где должен быть.

Поиск показал 0 совпадений на `previousActiveElement`/`previouslyFocused`/`restoreFocus`.

**Severity**: M (a11y).

**Рекомендация**: создать `app/utils/focusTrap.js` со стандартной реализацией:
```js
export function withFocusTrap(modal, onClose) {
  const prev = document.activeElement;
  const focusable = modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  // ... Tab/Shift+Tab cycle inside, Escape → close, return focus to prev
}
```

И применить в 4-5 местах. Изначально оценка #26 — M-effort.

---

## FE-3 [M] `subscribe(reason => {...})` глобальный — анти-паттерн для нормальной де-инициализации

**Файл**: `app.js:1801, 1876`

Два глобальных subscribe вешаются на module-load, никогда не отписываются. Для SPA это OK (live до конца сессии), но:

- При HMR / тестах с jsdom — leaks.
- Subscribe сейчас никто не тестирует напрямую (нет mock'а DOM).
- `App.refreshAll()` внутри обоих handler'ов — тяжёлая операция, никаких throttle'ов / RAF.

**Severity**: M (architectural smell, не runtime-баг).

**Рекомендация**: при `npm run test:e2e` через jsdom (audit #20) дополнительно проверить что `Reactive._subscriberCount() <= 2` после bootstrap'а.

---

## FE-4 [L] Inline `onclick="event.stopPropagation()"` — артефакт hardcoded-HTML рендеринга

**Файлы**: `integrations/blackDashboardRenderer.js:73, 102, 177`, `integrations/portfolioPulseRenderer.js:96, 749, 776, 790`

Все эти места — `<a href="..." onclick="event.stopPropagation()">` чтобы клик по link'у внутри row не раскрывал детали. Решение через `event.target.closest('a')` в parent listener убрало бы 7 inline-handlers.

**Severity**: L. Но мешает SEC-2 (CSP).

**Рекомендация**: единый делегат на parent:
```js
container.addEventListener('click', (e) => {
  if (e.target.closest('a[data-no-bubble]')) e.stopPropagation();
});
```
Затем заменить `onclick="..."` на `data-no-bubble`. Бонус: сможет включиться `script-src 'self'` без `'unsafe-inline'`.

---

## FE-5 [L] CSS — оптимизация V13 неполная (audit #27 «закрыт» условно)

**Файл**: `styles.css` (343 KB, 8 939 строк)

**Сделано в V13**:
- 4 семантические vars (`--surface-header`, `--surface-input`, `--row-hover`, `--border-strong`)
- 4 «фантомных» var promoted (`--bg-secondary`, `--surface`, `--accent-strong`, `--font-mono`)
- 416 защитных fallback'ов удалено
- 12+ light-rules переведены на var()
- ≈26 dark-overrides удалены

**Не сделано** (audit-цель была -30%):
- `body.theme-dark` блок 403 правил (было 429) — большинство имеют 2-3 свойства, удалить целиком нельзя.
- 5 разрозненных «Dark theme» блоков (lines 2010, 2173, 4452, 7254) — не унифицированы.
- Дублирование между «main dark» и «Dark hotfix pass» (rsp-pin-btn, employee-act-btn, gtx-row-offtrack) частично удалено, но не полностью.
- Утилитарные CSS-классы (`.btn-outline`, `.btn-ghost`, `.btn-sm` ...) не вычленены в отдельный layer.

**Severity**: L (бюджет на 93%, ещё впритык).

**Рекомендация**:
- Audit #27 переименовать в **«CSS-vars + dedup, V1»** (сделано) и **«полная декомпозиция styles.css на 4-5 файлов через `@import`»** (V2, новая задача XL).
- Для V2: разрезать на `styles/base.css`, `styles/components.css`, `styles/views.css`, `styles/dark.css`. Через `<link>` в head — браузер кэширует независимо.

---

## FE-6 [L] `app.js` всё ещё 1897 LOC — `AppSettings` и orchestrator не разделены

**Файл**: `app.js`

V13 декомпозиция вынесла `StorageSettings`, `PromptsEditor`, `Nav`. Но **`AppSettings` (~600 LOC)** остался, и `App` orchestrator тоже там. Из 2186 → 1897 = -13%, цель #18 была «~1000 LOC».

Из исходного списка #18: `BulkEditPanel`, `SidebarUI`, `ThemeUI`, `FiltersUI`, `AppSettings`, `App` — **только Nav / StorageSettings / PromptsEditor вынесены**.

**Severity**: L (декомпозиция — постоянная работа, не one-shot).

**Рекомендация**: следующий sprint декомпозиции — `AppSettings` (largest residual ~600 LOC), потом `BulkEditPanel`, `SidebarUI`, `ThemeUI`. Целевой LOC `app.js` 800-1000.

---

## FE-7 [L] V13 chat-activity — `pulseModel?._model` через window — antipattern для тестируемости

**Файл**: `chat/chatEngine.js:658`

```js
const pulseModel = (typeof window !== 'undefined' && window.PortfolioPulse?._model) || null;
```

Тестируется `chatEngine.process()` снаружи через DI? **Нет** — engine лезет в `window` напрямую.

**Эффект**: если когда-нибудь захочется тестировать `chatEngine.process()` в jsdom — придётся mock'ать `window.PortfolioPulse._model`. Не невозможно, но грязно.

**Severity**: L.

**Рекомендация**: `process(userText, opts = { pulseModel })` — `opts.pulseModel`, и call-site (`app/llmAssistant.js`) передаёт `window.PortfolioPulse?._model`. Engine остаётся pure.

---

## Что **хорошо** про frontend в V13

✅ **Reactive proxy** — глобальная единая точка, автосейв работает.
✅ **`silent()` + `_reactiveBooted` + 250ms render-grace** — всё руками построено, без deps. Аккуратно.
✅ **`safeHtml`** существует, частично используется.
✅ **`aria-live="polite"` для toast** (audit #25 ✓).
✅ **`role="region"`, `aria-label`, `aria-expanded` на топбаре** — базовый ARIA уровень есть.
✅ **`Escape` для закрытия модалок** — есть в основных местах.
✅ **`Multiselect` компонент** — единая точка для tagged inputs, не дублируется.
✅ **`HistoryManager` — undo/redo** работает на snapshot'ах.
✅ **CSS-vars** — на 95% правильный layer (после V13 cleanup).
✅ **safeUrl** утилита (audit #3 ✓) применяется в render-functions.
✅ **`Utils.escapeCSV`** правильно обрабатывает запятые/кавычки/CR-LF.
