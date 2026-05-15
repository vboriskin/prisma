# Интеграции — глубокий аудит (Сканнер команд 2.0 + Чёрный дашборд)

> 7 экспертов × ~14 700 LOC × 2026-05-04. Только аналитика, в исходный код изменения не вносились.

## Состав команды

| # | Эксперт | Отчёт | Tally (Cr/H/M/L/P) |
|---|---|---|---|
| 01 | Code & Performance Engineer | [01-code-performance.md](./01-code-performance.md) | 2 / 4 / 9 / 6 / 4 = **25** |
| 02 | QA Functional Lead | [02-qa-functional.md](./02-qa-functional.md) | 1 / 6 / 9 / 7 / 5 = **28** |
| 03 | Brand Designer | [03-brand-design.md](./03-brand-design.md) | 7 / 11 / 9 / 4 / 6 = **37** |
| 04 | Typography & Information Architect | [04-typography-ia.md](./04-typography-ia.md) | 4 / 9 / 11 / 7 / 6 = **37** |
| 05 | Interaction & Motion Designer | [05-interaction-motion.md](./05-interaction-motion.md) | 4 / 7 / 8 / 5 / 4 = **28** |
| 06 | A11y Reviewer (WCAG 2.2 AA) | [06-a11y.md](./06-a11y.md) | 3 / 4 / 5 / 4 / 3 = **19** |
| 07 | Security & Privacy Reviewer | [07-security.md](./07-security.md) | 1 / 2 / 6 / 5 / 3 = **17** |
| | **Итого** | | **22 / 43 / 57 / 38 / 31 = 191** |

## Метод

- **Статика**: чтение всех 14 файлов скоупа (`integrations/teamScanner2*.js` × 11 = ~12 000 LOC, `integrations/blackDashboard.js` 234, `integrations/integrationsRenderer.js` 177, `views/integrationsView.js` 646), CSS-секций `ts2-` (914 правил), `bd-` (235), `int-` (десятки).
- **Брендбук**: `my_prisma-brand/BRAND_BOOK.md` v1.0, все 12 разделов.
- **Контракты**: `docs/state-contracts.md`, `docs/dont-touch.md`, `docs/integrations/auth-and-secrets.md`.
- **Регулярки**: hardcoded hex, эмодзи в литералах строк, `innerHTML` без `escapeHtml`, `linear-gradient`/`radial-gradient`, `@keyframes.*rotate`, `:hover`/`:focus`/`:active` coverage.
- **Тесты не запускались** (это аналитический проход), исходный код не трогался.

---

## Cross-expert критические темы

7 экспертов нашли **22 Critical-находки**, и они кучкуются вокруг 9 повторяющихся тем. Ниже — приоритизация по теме, с указанием всех экспертов, которые её отметили.

### T1 · Эмодзи как icon-system в production UI [Critical]
**Брендбук:** §11 Loaders — «Никогда не круговой спиннер. Это не наш язык» (по аналогии — эмодзи тоже не наш язык; CLAUDE.md прямо запрещает).

**Подтверждено:** 02-QA F4, 03-Brand F4, 04-Typo F3 — всего **71 эмодзи** в production UI. Топбар Сканнера (`📋 Диагностика`, `↻ Обновить`, `❓`, `⚙`, `👥`, `📋`, `💬`, `📋 TG`, `🔗`), 37 фраз loader'а с эмодзи в `loaderPhrases.js`, табы Чёрного дашборда (`🎯 Цели · 🔗 Покрытие · 📈 Метрики`), state-icons (`⚙ 📥 ⚠`).

**Решение без потери функционала:** заменить через уже существующий `Icons.get(...)` SVG-helper на семейство 8-лучевой звезды (`assets/svg/modules/*.svg`) либо Lucide line-glyph 16/16. Цена: M (одна passes по renderer + удаление 71 строки).

---

### T2 · Loader-нарушения брендбука [Critical]
**Брендбук:** §11 — L1 inline pulse / L2 page loader (звезда + breathe + ring) / L3 skeleton; §12 #5 «Без свечения и теней».

**Подтверждено:** 03-Brand F2 + F5, 05-Motion F1.
- `bd-loader-spinner` — rotate 360deg infinite (явно запрещён).
- `bd-meme-grin` Чёрного дашборда — radial-gradient + drop-shadow + text-shadow + мемная мимика. Двойное нарушение §11 и §12.
- 3 круговых анимации rotate-360°: `pp-spin`, `int-loader-spin`, `funny-spin`.

**Решение:** один компонент `<PrismaLoader level="L1|L2|L3"/>` — звезда 48-64px + breathe 3000ms + ring 2400ms ease-out; L1 — inline pulse 16-24px; L3 — skeleton с shimmer. Удалить все rotate-360°. Цена: M.

---

### T3 · Hardcoded slate/blue палитра (наследие СБОФ) [Critical]
**Брендбук:** §3 — палитра ограничена Night/Twilight/Star/Mist + Signal-цвета; «Hardcoded hex отличный от палитры» = violation.

**Подтверждено:** 03-Brand F1 + F3 + F4.
- 32 правила hex (`#1a2035`, `#93c5fd`, `#3f5284` — Tailwind эпохи СБОФ) в `body.theme-dark .int-*` блоке.
- chips/KPIs Чёрного дашборда на `#dcfce7`/`#dbeafe`/`#16a34a`/`#dc2626` вместо `--prizma-on-course`/`--prizma-drift`/`--prizma-off-course`.

**Решение:** найти все hex в `ts2-*`/`bd-*`/`int-*` правилах, заменить на токены `var(--prizma-*)`. Цена: M (search-replace + visual review).

---

### T4 · Stale banner полностью мёртв [Critical, функциональный регресс]
**Подтверждено:** 02-QA F1.

`isStale` / `cacheAgeMs` собираются в `teamScanner2.js:884-885`, click-handler `#ts2-stale-refresh` зарегистрирован (line 1295), документация в коде описывает фичу — **но соответствующий DOM-элемент НИКОГДА не рендерится** (`renderTopBar:250-291` не читает параметры). Тимлид утром работает с >5-минутным cache без визуального сигнала «данные устарели».

**Решение:** дописать рендер баннера в `renderTopBar` (15-30 строк). Цена: S.

---

### T5 · XSS-векторы и утечки токенов [Critical / High]
**Подтверждено:** 07-Security F1, F2, F3.

- **F1 (Critical):** `e.url` из BB/CF responses без scheme allowlist — `escapeHtml` не блокирует `javascript:`/`data:`. Insider в Bitbucket plugin может вписать URL → clickable XSS в side-panel сканнера. `teamScanner2Renderer.js:3266-3267, 3275-3276`.
- **F2 (High):** токены в DOM `value=""` — 4 поля `<input type="password" value="${esc(s.jiraToken)}">`. Browser-extension с `documentTree` permission читает напрямую. Sigma уже фиксит (placeholder вместо value), Delta/BB/CF — нет.
- **F3 (High):** `data-email-full` хранит полный email в DOM (`teamScanner2Renderer.js:3056-3058`) — mask-on-screen хорош, но screen-share / DevTools = leak.

**Решение F1:** `Utils.safeUrl(...)` (если нет — добавить) — whitelist `https?:`, `mailto:`. Цена: S.
**Решение F2:** убрать `value=""` для всех token-полей, ввести pattern «оставьте пустым чтобы не перезаписывать». Цена: S.
**Решение F3:** хранить `data-employee-id` (jiraAccountId), email подгружать lazy. Цена: M.

---

### T6 · Variable shadowing → Sensitivity Preview всегда показывает 0 → X [Critical, баг скрытый]
**Подтверждено:** 01-Code F1.

В `_openDiagModal` (`teamScanner2.js:1918`) module-level proxy `state` затенён локальным `const state = gatherDiagnosticState(...)` → delta-row sensitivity preview всегда строится с пустым baseline. Тимлид видит «−15 в стопе» как `0 → −15`. Тривиальный rename → `diagState`.

**Решение:** rename, цена S. Связан с F2 (typo `_teamThresholds` vs `teamThresholds`) → `perTeam: null` в JSON-export всегда.

---

### T7 · Контраст FAIL (WCAG) [Critical]
**Подтверждено:** 06-A11y F1.

`--prizma-text-tertiary` `#5A5A64` на Night → 2.96:1 (FAIL для small-text везде где `--text-3`/`--text-4` — `bd-fetched`, `bd-team-mini`, `int-field-hint`, `bd-cov-pk`, `bd-state-sub`, ~30+ classов 10-12.5px). Light-mode tertiary `#B5B5BC` ещё хуже (1.97:1).

**Решение:** в `theme.css:26` поднять `--prizma-text-tertiary: #5A5A64` → `#8A8A92` (даёт 4.6:1 на Night). Light-mode tertiary → `#5A5A64`. Цена: XS — одна правка токена.

---

### T8 · Subtab switch разрушает state [High → пользовательский pain-point]
**Подтверждено:** 02-QA F2.

Переключение Сканнер ↔ Чёрный дашборд в `IntegrationsView:569` пересоздаёт DOM через `root.innerHTML=...` — теряются scroll, search-query (явно сбрасывается в `unmount()`:2267), expanded panel. UX-регрессия для тимлида при cross-checking.

**Решение:** хранить state per-subtab (object); при switch — detach DOM, не destroy. Цена: M.

---

### T9 · Двойной H1 + потеря языка Призмы [Critical IA + High Voice]
**Подтверждено:** 04-Typo F2 + F28.

- F2: снаружи `renderPageHeader('integrations')` рисует `.prizma-page-h1` (28/300), внутри субтабов появляются второй и третий «H1» — `.ts2-h1` 18/700 «Сканнер команд» + `<h3 class="bd-title">⚫ Чёрный дашборд</h3>` 18/700. Иерархия Headline / Subtitle нарушена.
- F28: ноль слов «курс / дрейф / траектория / ориентир» в обоих интеграциях. Сканнер позиционируется как «компас команды», но говорит технарским языком («Action queue», «Sprint health», «Pace: behind»).

**Решение:** один H1 на странице (внешний), внутренние — Subtitle. Micro-copy pass через словарь Призмы (отчёт 04 §F-блок даёт конкретные замены). Цена: S (CSS) + S (текст).

---

## Roadmap фикса

### P0 — Critical / Security / Broken (1-2 дня работы)
| ID | Тема | Где | Цена | Owner |
|---|---|---|---|---|
| P0.1 | T5/F1 — `safeUrl` для `e.url` (XSS) | `teamScanner2Renderer.js:3266-3276` | S | Sec/Front |
| P0.2 | T5/F2 — убрать `value=""` для токенов | `integrationsRenderer.js:23-127` | S | Sec |
| P0.3 | T6/F1 — rename `state` → `diagState` | `teamScanner2.js:1918` | XS | Front |
| P0.4 | T6/F2 — fix `_teamThresholds` → `teamThresholds` typo | `teamScanner2Diagnostic.js:750` | XS | Front |
| P0.5 | T7 — поднять `--prizma-text-tertiary` | `theme.css:26` | XS | Brand |
| P0.6 | T4 — реанимировать stale-banner | `teamScanner2.js:250-291` | S | Front |

### P1 — Brand alignment + A11y фундамент (3-5 дней)
| ID | Тема | Цена |
|---|---|---|
| P1.1 | T1 — заменить 71 эмодзи на `Icons.get(...)` SVG | M |
| P1.2 | T2 — единый `<PrismaLoader>` (L1/L2/L3), удалить все rotate-360° | M |
| P1.3 | T3 — выкинуть hardcoded slate/blue, заменить на `var(--prizma-*)` | M |
| P1.4 | 06-A11y F2 — `<label for>` для 14 form-fields settings | S |
| P1.5 | 06-A11y F3 — `role="dialog" aria-modal aria-labelledby` + Escape + focus-trap для settings-modal | S |
| P1.6 | 05-Motion F2 — добавить `:focus-visible` на 60+ интерактивных классов (12 → 70+) | M |
| P1.7 | 05-Motion F4 — расширить `:has()` scroll-lock на 6 ts2-overlay'ев | XS |

### P2 — Performance + IA + Voice (1 неделя)
| ID | Тема | Цена |
|---|---|---|
| P2.1 | 01-Code F5 — listener-cleanup в kebab/modals (removeEventListener) | M |
| P2.2 | 01-Code F6 — debounce + memoize search → не делать `_renderFull` на каждый keystroke | M |
| P2.3 | 01-Code F3 — кэшировать `classifyPerson` (тройной вызов на participant) | S |
| P2.4 | T8 — per-subtab state preservation в IntegrationsView | M |
| P2.5 | T9/F2 — иерархия H1: один внешний, внутренние Subtitle | S |
| P2.6 | T9/F28 — micro-copy pass через словарь Призмы (курс/дрейф) | S-M |
| P2.7 | 02-QA F5 — `_humanHttp` для BD raw 401/500 errors | S |
| P2.8 | 02-QA F7 — share-link на удалённого: показать «сотрудник не найден» вместо silent no-op | S |

### P3 — Polish (по случаю)
- Унификация MonoNumber 24/300 — свести 6 разных «больших чисел» к одному `.prizma-num-mono` (04-Typo)
- Inverted pyramid layout: Hero → Today → Operations (свёрнуто) → Trends → Sleeping (отд. таб) (04-Typo)
- Coverage-bar как single-hue градусник + Signal-tag справа (03-Brand)
- Loader с реальным прогрессом (Sigma → Delta → coverage), без emoji-фраз (03-Brand)
- Align-жест 1600ms spring при смене team-tab (`.is-aligning` уже в CSS) (05-Motion)
- Anchor-scroll с target-highlight через готовый `.ts2-btn-flash` (05-Motion)
- 07-Sec F6 — `noreferrer` дополнительно к `noopener` в BD (5 мест)

---

## Что в порядке (не нашли проблем)

Для контекста и чтобы не «починять» работающее:

- **Reactive.silent контракт** — соблюдён в 2-х mass-mutation paths Сканнера (01-Code).
- **TTL cheat-sheet + abort discipline** на refresh — корректны (01-Code).
- **Identity-deterministic attribution** — lookup через `email`/`jiraAccountId`, без fuzzy-name; `_consumeShareLink` валидирует key-regex (07-Sec).
- **`_scrubSecrets` в diagnostic export** — корректен (07-Sec).
- **CSP / X-Frame / X-Content-Type / Referrer-Policy** headers присутствуют в `server.js` (07-Sec).
- **Service-account и `[X]`-deactivated фильтры** — на месте (07-Sec).
- **ts2 modal pattern** (`role="tab"`, `aria-modal`, focus-trap, Escape) — образцовая семантика (06-A11y); расхождение только в settings-modal и black-dashboard tabs.
- **Brandbook §3 APCA**: BD-color-chips `#dcfce7`/`#14532d` etc. проходят 7+:1 контраст (06-A11y).
- **`prefers-reduced-motion`** через global `*` selector работает правильно (06-A11y).
- **stripe-left, tabular-nums, splash-screen radial-gradient** — соответствуют брендбуку (02-QA, 03-Brand).

---

## Идеи улучшения UX/визуала без потери функционала

Сводный список из всех 7 отчётов (по 5-10 у каждого, без дублей):

### Информационная архитектура
1. **Inverted pyramid layout** Сканнера: Hero (3 числа курса) → Today (Daily brief + Action queue, открыто) → Operations (sprint/churn/stale/onboarding, свёрнуто) → Trends → Sleeping data (отдельный субтаб). Сейчас 13+ блоков подряд под team-glance — тимлид скроллит 12+ экранов утром.
2. **Coverage-bar как градусник одной hue** в Чёрном дашборде — заменить trio green/yellow/red на единый Information с насыщенностью по % + Signal-тэгом справа. Bar несёт величину, цифра — статус.
3. **Один H1 на странице** — «Интеграции» снаружи, внутренние субтабы — Subtitle 18/500.

### Визуальное и брендовое
4. **Все эмодзи** → Lucide line-glyphs или иконки семьи 8-лучевой звезды. 71 строка станет одним const map.
5. **Loader из 3-х шагов** с реальным прогрессом (Sigma load → Delta expand → coverage compute), галочка `signal-on-course` после каждого. Убираются 37 emoji-фраз.
6. **Унификация MonoNumber 24/300** — свести 6 разных «больших чисел» (`.ts2-hero-num` 36/800, `.bd-kpi-val` 28/800, `.bd-cov-stats` 11.5/700) к каноничному `.prizma-num-mono`.
7. **Stripe-left 3px** на активных команд-табах вместо filled background (часть уже сделано — расширить).

### Voice & micro-copy
8. **Словарь Призмы** в обеих интеграциях: «Сводка дня» → «Сверка курса», «Кому помочь сегодня» → «Кто отклонился от курса», «pace: behind» → «Дрейф», «WIP» → «В пути», «Stale» → «Без сигнала».
9. **Empty-states** дружелюбные: «Нет данных» → «Сверим курс — как только подгрузим Sigma» (с иконкой + retry).
10. **Глагольные кнопки**: «Обновление» → «Обновить», «Refresh» → «Сверить заново».

### Micro-interactions
11. **Align-жест** при смене team-tab — готовый класс `.is-aligning` уже в CSS, нужен только wire в click-handler. Контекст «меняется» — спокойный 1600ms spring.
12. **Anchor-scroll target-highlight** через `.ts2-btn-flash` (1s ease-out 2x) — после `scrollIntoView` подсветить target. Пользователь видит «куда меня привели».
13. **Pulse-жест** на Signal-чипах когда статус сменился с «На курсе» → «Дрейф» (не более 3 пульсов, потом затухает).

### A11y quick-wins
14. `<label for>` для 14 form-полей settings — 14 строк HTML.
15. `role="dialog" aria-modal aria-labelledby` + Escape + focus-trap для settings-modal — 30 строк.
16. `:focus-visible` outline 2px var(--prizma-info-dark) для всех `.ts2-btn`/`.bd-tab`/`.int-stab` — единый класс, 5 строк.

### Performance
17. **Debounce search** 200ms + memoize по `participants × searchQuery` ключу — `_renderFull` не вызывается на каждый keystroke.
18. **`classifyPerson` cache** в WeakMap — сейчас тройной вызов на participant за рендер.
19. **WeakRef + AbortController** для kebab-listener'ов — предотвращает leak при close без destroy.

---

## Что НЕ менять (повторим, важно)

- `Reactive.silent` обвязки в `Storage.save / restore / syncColumnSettings` — без них infinite loop (CLAUDE.md, dont-touch.md).
- `_ppFindByPartial` в Pulse-моделе — out of scope.
- Vendored `libs/xlsx.full.min.js`, `libs/sql-wasm.*` — обновлять только через security review.
- Splash-screen radial-gradient (Northstar Emerge §9-10) — это исключение, оставить.
- 36px row-density Реестра, compact pills Ганта, drag-and-drop в Ганте — out of scope, но напоминание.

---

## Следующий шаг

Аудит готов. Возможные сценарии:
- **«Делай P0»** — 6 задач, цена ≈ 1 день, риск регрессии минимальный (security + 1 critical bug + contrast token + dead banner).
- **«Делай P0 + P1»** — 13 задач, цена ≈ 5-7 дней, риск средний (потребует regression-pass всех saved snapshots + a11y check).
- **«Прочитай конкретный отчёт»** — назови 01-07.
- **«Расшифруй конкретную находку»** — `Fxx` из любого отчёта.

Все находки в файлах рядом с этим README.
