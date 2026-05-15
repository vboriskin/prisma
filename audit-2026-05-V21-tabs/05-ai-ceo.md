# Аудит вкладки «AI CEO» — V21

Дата: 2026-05-05
Скоуп: `views/aiCeoView.js`, `ai/aiCeoRenderer.js`, `ai/aiCeoFallback.js`, `index.html#section-ai-ceo`, `styles.css` (`.ceo-*` / `.aiceo-*`).

Эксперты:
1. **Visual / Brand** — сверка с `my_prisma-brand/BRAND_BOOK.md`.
2. **Frontend / HTML** — семантика, layout, edge-cases.
3. **UX / Product** — содержание для тимлида.
4. **AI / LLM** — промпты, отказ, расхождение fallback ↔ LLM.

Severity: **B** (blocker), **H** (high), **M** (medium), **L** (low).

---

## 1. Дублирующий `id="ceo-root"` в DOM-разметке

- **Severity:** M
- **Эксперт:** Frontend / HTML
- **Где:** `index.html:1194-1196` уже содержит `<div id="ceo-root" class="view-root">`, но `views/aiCeoView.js:248,255,259` каждый раз пересобирает `<div id="ceo-root" class="view-root">…</div>` ВНУТРИ `#section-ai-ceo` через `root.innerHTML = …`.
- **Что не так:** статический `ceo-root` в HTML — мёртвый код. После первого рендера он перезаписывается, но в момент `DOMContentLoaded` (до первого goto) присутствует пустой div с тем же id, что в комбинации с `_refreshWithLLM` (там `document.getElementById('ceo-root')`) теоретически отдаёт «не тот» элемент, если кто-то ещё дублирует id где-то в шаблоне.
- **Предложение:** в `index.html` оставить только `<section id="section-ai-ceo" class="app-section hidden"></section>` без внутреннего `ceo-root` — view сама его создаёт. Аналогично делается во `views/dashboardView`.

---

## 2. Gradient в risk-bar — прямое нарушение брендбука «без gradients on surfaces»

- **Severity:** H
- **Эксперт:** Visual / Brand
- **Где:** `styles.css:9016` — `.ceo-risk-bar-fill { background: linear-gradient(90deg, #059669, #22c55e); }`; `styles.css:9021` — `.ceo-risk-proj { background: linear-gradient(90deg, #dc2626, #ef4444); }`.
- **Что не так:** CLAUDE.md «Принципы дизайна (V15 Spine-pill)» прямо запрещает gradients на surfaces; ниже (`9024-9026`) уже введены solid `var(--prizma-off-course/drift/information)`. Получается двойной слой: solid override + неубранные gradient defaults. На состояниях, где growth-class не выставлен, виден legacy-gradient.
- **Предложение:** заменить дефолт на solid `background: var(--prizma-on-course);` и для `.ceo-risk-proj` — `var(--prizma-off-course)`. Убрать линейные градиенты совсем.

---

## 3. Hard-coded HEX-цвета вместо semantic-токенов signal

- **Severity:** H
- **Эксперт:** Visual / Brand
- **Где:** `styles.css:8727-8730` (`--sev-color:#dc2626 / #d97706 / #2563eb / #059669`), `styles.css:8720-8721` (`.ceo-btn-danger background:#dc2626`), `8766-8768` (`border-left: 3px solid #dc2626`), `9016/9021`.
- **Что не так:** брендбук §3 требует `var(--prizma-off-course/drift/information/on-course/insight)`. Сейчас половина файла — semantic, другая — рваные tailwind-HEX'ы из старой темы Сбера. При смене темы dark-mode пересчёт делается отдельным блоком (`8736-8739`), что увеличивает дрейф.
- **Предложение:** перевести `.ceo-sev-*`, `.ceo-btn-danger`, `.ceo-hero-{ok|risk|critical}` на токены `--prizma-*` (включая `--prizma-*-bg` и `--prizma-*-border`). Для dark-mode сами токены уже корректно перевыставлены в `theme.css`.

---

## 4. Эмодзи живут в data-view (preview-modal, explain-titles)

- **Severity:** H
- **Эксперт:** Visual / Brand
- **Где:**
  - `ai/aiCeoRenderer.js:393-401` — `typeLabel = { set_scope: '🔕 Убрать…', remove_from_scope: '🗑 Снять…', move_to_overtime: '⏭ В overtime', assign_owner: '👤 Назначить…', assign_assignee: '✍️ Назначить…', escalate: '🆙 Эскалировать' }` — рендерится в preview-modal как заголовок группы.
  - `ai/aiCeoRenderer.js:449-455` — `titles = { health: '🧠 Project Health Brain', inc: '⏳…', truths: '🪞…', feed: '⚡…' }` + `📌 ${section}` для default — все эмодзи выводятся в `.ceo-modal-title`.
- **Что не так:** CLAUDE.md прямо: «без эмодзи в production UI». В видимых view-блоках (`renderHero`, `renderHardTruths`, `renderActionFeed`) эмодзи уже маппятся через `emojiToBrandIcon`, но preview/explain — забыли.
- **Предложение:** заменить keys на пары `{ icon: 'archive-x'|'trash-2'|'fast-forward'|'user-plus'|'edit-3'|'arrow-up-right' , label }` через `Icons.get(...)`; для explain — на signal-dot + текст без эмодзи.

---

## 5. Кнопка-крестик ✕ (U+2715) в модалках вместо SVG-иконки

- **Severity:** M
- **Эксперт:** Visual / Brand
- **Где:** `ai/aiCeoRenderer.js:426` (`<button class="ceo-modal-close">✕</button>`), `:513` (то же самое в explain-modal).
- **Что не так:** unicode-глиф рендерится разным fallback-fontом на разных OS (на Windows получается «×» в SimSun), не tabular, без aria-label. У нас в `Icons` зарегистрирован `x` / `close`.
- **Предложение:** `${Icons.get('x', { size: 14 })}` + `aria-label="Закрыть"`; убрать текстовую X.

---

## 6. Нет `loading` state — `renderCeoLoading` написан, но никогда не вызывается

- **Severity:** M
- **Эксперт:** Frontend / HTML + UX
- **Где:** `ai/aiCeoRenderer.js:86-97` экспортирует `renderCeoLoading`, в `views/aiCeoView.js:14` импортируется, но ни разу не используется. При нажатии «Обновить с AI» (`_refreshWithLLM`) показывается `showPageLoader` (overlay поверх всей страницы) и `inlinePulseLoader` в кнопке. Сами 5 карточек продолжают показывать **старые** данные fallback, а через 25 секунд резко переписываются.
- **Что не так:** UX-неконсистентность: пользователь не понимает, что часть карточек скоро обновится, и читает потенциально устаревшие выводы. На длинных запросах (25s timeout) — это огромное время.
- **Предложение:** при `_refreshWithLLM` помечать карточки `<div class="ceo-card aiceo-refreshing" aria-busy="true">` (плюс skeleton-overlay через `renderCeoLoading`-стиль) — снимать после mergeLLM или при ошибке.

---

## 7. Нет error-state для LLM-отказа в самой ленте

- **Severity:** M
- **Эксперт:** AI / LLM
- **Где:** `views/aiCeoView.js:330-342` — единственный сигнал об ошибке/отказе LLM это toast «AI недоступен — показан rule-based анализ». Сами карточки никак не показывают, что «AI-enhance» не сработал.
- **Что не так:** тимлид смотрит на CEO-страницу через 30 минут и не понимает, AI это или fallback (бейдж «aiEnhanced» из `mergeLLMData` нигде в renderer не выводится). Если LLM падает каждый раз — это незаметно.
- **Предложение:**
  - В hero добавить chip «AI-данные · обновлено 14:32» / «Rule-based · AI недоступен» (читать `data.aiEnhanced` + last-refresh timestamp).
  - При повторных ошибках `_refreshWithLLM` — fallback-banner с причиной (timeout / 401 / parse error из `parseLLMJsonResponse`).

---

## 8. `parseLLMJsonResponse` принимает любой JSON где `health.score` — number, не валидируя структуру

- **Severity:** H
- **Эксперт:** AI / LLM
- **Где:** `views/aiCeoView.js:106` — `parseLLMJsonResponse(text, p => p?.health && typeof p.health.score === 'number')`. Дальше `mergeLLMData:115` делает `merge` без schema-validation.
- **Что не так:** если LLM вернёт `actionFeed: [{title:"..."}]` без `severity/icon/explanation`, рендер `renderActionFeed` падёт на пустом `severity` (`sevClass(undefined)` отдаёт `info` — ок), но `item.affectedCount` строкой выведется как «undefined задач»; `item.filter` без try/catch — кликабельная кнопка-сюрприз. У `health.causes`/`hardTruths.suspicious` структура тоже не валидируется.
- **Предложение:** ввести `validateCeoSchema(p)` (10-15 строк): проверять массивы существуют, severity ∈ enum, score 0..100, projectedDays > 0. При отказе — отбросить LLM-результат и оставить fallback (как сейчас при `ok=false`).

---

## 9. Контекст для LLM содержит срез без меток приватности

- **Severity:** M
- **Эксперт:** AI / LLM + Security
- **Где:** `views/aiCeoView.js:53-91` — `buildCeoContext` отдаёт LLM `assignee` (имя сотрудника, slice 30), `team`, имена эпиков. CLAUDE.md «Безопасность по умолчанию» требует `_scrubSecrets` для **экспортов**, но LLM-payload — это тоже исходящий канал.
- **Что не так:** имена сотрудников и identity-таблица улетают в GigaChat/любой настроенный LLM-endpoint, без явного opt-in пользователя и без маркировки «PII».
- **Предложение:** через `state.llm.settings.allowPII` (новый флаг) опционально хешировать имена (`assignee → A_xxx`); по умолчанию отдавать только agg-метрики и id'шники задач, без `assignee`.

---

## 10. `renderHardTruths` строит UI из 3 вложенных групп, но семантически это не списки

- **Severity:** M
- **Эксперт:** Frontend / HTML (a11y)
- **Где:** `ai/aiCeoRenderer.js:226-237` — `truthGroup` рендерит `<div class="ceo-truth-group"><div class="ceo-truth-group-title">…</div><div class="ceo-truth-item">…</div>…</div>`.
- **Что не так:** для скринридера это flat-блок div-ов, тогда как смысл — три категоризированных списка. Кликабельный `ceo-truth-item` имеет `style="cursor:pointer"`, но не имеет `role="button"` / `tabindex` (в отличие от `aiceo-action-feed-item`, где это поправлено в P11.12). Клавиатурная навигация по «жёсткой правде» отсутствует.
- **Предложение:** обернуть items в `<ul role="list">/<li>`, а кликабельные — `<button class="ceo-truth-item" data-ceo-action="filter">…</button>` (или `role="button" tabindex="0"` + onkeydown Enter/Space).

---

## 11. «Применить изменения» в preview-modal — кнопка-обманка

- **Severity:** H
- **Эксперт:** UX / Product
- **Где:** `views/aiCeoView.js:218-227` — `confirmBtn` показывает toast «Функция прямого применения требует ревью…» и редиректит в `goTo('actions')`, не передавая никаких данных о выбранном сценарии.
- **Что не так:** тимлид нажал «Применить изменения», получил уведомление и оказался на пустой Actions-странице без контекста сценария. Это — нарушение mental model: кнопка «применить» не должна перенаправлять без передачи payload'а.
- **Предложение:**
  - Либо переименовать кнопку в «Перейти к Action Layer» (честно сказать что это deeplink).
  - Либо реально пробрасывать `scenario.changes` в `state.actions.pendingScenario` и в Action-Layer показывать «Выбран сценарий: Балансированный — N изменений (предпросмотр)».

---

## 12. `renderIfNothingChanges` падёт при отсутствии `firstToBreak` / `affectedReleases` если они не массивы

- **Severity:** M
- **Эксперт:** Frontend / HTML (edge-case)
- **Где:** `ai/aiCeoRenderer.js:167,176` — `inc.firstToBreak.length` / `inc.affectedReleases.length` без `?.`. После `mergeLLMData` LLM может прислать `ifNothingChanges: { headline, consequences }` без этих ключей.
- **Что не так:** `Cannot read properties of undefined (reading 'length')` ломает весь рендер CEO-страницы; а errors мы показываем только консолью.
- **Предложение:** `(inc.firstToBreak||[]).length`, `(inc.affectedReleases||[]).length`; либо в `mergeLLMData` нормализовать результат к схеме, заполняя пропуски пустыми массивами.

---

## 13. Hero-блок не показывает trend / историю health-score

- **Severity:** M
- **Эксперт:** UX / Product
- **Где:** `ai/aiCeoRenderer.js:130-148` (`renderCeoHero`) — выводит только текущий `health.score%`. `state.history` и `historyLog.js` хранят исторические снимки, но trend здесь не используется.
- **Что не так:** для CEO-сводки самое ценное — «вырос или упал курс с прошлой недели». Один процент без контекста — это watermark, а не нарратив.
- **Предложение:** добавить `Δ` под score-ring: `+3% · 7д` со стрелкой trending-up/down (signal-color). Брать из `state.history` или сохранять `state.aiCeo.lastSnapshot` после каждого refresh.

---

## 14. Нет «когда обновлено» на странице

- **Severity:** L
- **Эксперт:** UX / Product
- **Где:** `views/aiCeoView.js:237-261` — render не пишет timestamp.
- **Что не так:** при работе в нескольких вкладках непонятно, какая давность данных. Если фильтры были изменены 2 часа назад в другой вкладке, hero-цифра 56% — устарела.
- **Предложение:** в `prizma-page-sub` дописать «Обновлено в 14:32 · фильтр: всё» (читать `state.filters.activeCount`).

---

## 15. `bindModalClose` дублирует логику `showPreviewModal`

- **Severity:** L
- **Эксперт:** Frontend / HTML
- **Где:** `views/aiCeoView.js:193-199` (`bindModalClose`) и `:212-216` (тот же код inline в `showPreviewModal`).
- **Что не так:** два пути закрытия — баг-бесплатный риск; для preview-modal никогда не прокидывается `bindModalClose`.
- **Предложение:** вынести в один `attachModalClose(modal)`, вызывать из обоих мест. Заодно зарегистрировать `Esc` — сейчас закрытие только клик-вне/X.

---

## 16. `_bindEvents` на `root.onclick` теряет существующие обработчики секции

- **Severity:** M
- **Эксперт:** Frontend / HTML
- **Где:** `views/aiCeoView.js:267` — `root.onclick = async e => …` (root === `#section-ai-ceo`).
- **Что не так:** комментарий выше ссылается на `aiView._bindEvents` ratiionale, но `#section-ai-ceo` — это **section**, не специально созданный root. Если кто-то ещё повесит handler на section через `addEventListener('click')`, он будет жить параллельно; если через `.onclick` — затрётся. Лучше вешать на внутренний `#ceo-page`.
- **Предложение:** `const page = root.querySelector('#ceo-page'); page.onclick = …`. Это совпадает с реальным root рендера и не конфликтует со scroll-обвязкой section'а.

---

## 17. Action-Feed item имеет `role="button"`, но 2 кнопки внутри — nested interactive

- **Severity:** M
- **Эксперт:** Frontend / HTML (a11y)
- **Где:** `ai/aiCeoRenderer.js:357-374` — `<div role="button" tabindex="0">…<button>Показать</button><button>Объяснить</button>…</div>`.
- **Что не так:** WAI-ARIA prohibited — interactive внутри interactive. Скринридеры читают как «кнопка, кнопка, кнопка» три раза. Сам родитель `role="button"` не имеет click-handler-а, который бы что-то делал отдельно от внутренних кнопок.
- **Предложение:** убрать `role="button" tabindex="0"` с item-обёртки — это просто карточка. Focus-visible outline можно дать `:has(:focus-visible)` или непосредственно кнопкам.

---

## 18. Preview-modal не показывает `before → after` для каждой задачи

- **Severity:** M
- **Эксперт:** UX / Product
- **Где:** `ai/aiCeoRenderer.js:413-417` — `<span class="ceo-preview-task">${c.task}</span><span class="ceo-preview-reason">${c.reason}</span>`.
- **Что не так:** «Балансированный сценарий, 47 изменений» — но что именно меняется? Есть только название задачи + причина. Тимлид нажмёт «применить» вслепую.
- **Предложение:** для каждого `change` показывать pill `before` (сейчас scope=Да) → `after` (move_to_overtime) с цветом diff-row (off-course для удаления, drift для подтверждения).

---

## Итог

- **Brand violations** (B-priority): 4 пункта (#2, #3, #4, #5).
- **A11y / HTML** (frontend): 4 пункта (#1, #10, #16, #17).
- **UX / Product** (содержание): 5 пунктов (#11, #13, #14, #18, частично #6/7).
- **AI / LLM** (отказ, валидация, PII): 3 пункта (#7, #8, #9).
- **Edge-cases / robustness**: 2 пункта (#12, #15).

**Топ-3 must-fix:** #2 (gradient — ломает брендбук на видимом risk-bar), #11 (preview-кнопка-обманка — UX-blocker для CEO-флоу), #8 (LLM schema validation — runtime-крэш на «творческом» ответе модели).
