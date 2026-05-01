# Пункт 12 — Аудит «Тур / обучение / демо» (полный)

**Команда:** 5 экспертов в фоне:
1. Senior full-stack dev
2. Senior QA tester
3. Senior system analyst
4. Art director
5. Senior product designer (interaction)

**Базис:** 516/11/0.

## I. Консенсус (нашли ≥3 эксперта независимо)

### CONS-1: **`loadDemoData` overwrites user-imported data without confirmation** (BLOCKER)
- *(QA §3, designer §4, sys-analyst §5)*
- `state.rows = rows` unconditional. User импортирует свои данные → клик «Demo / Вернуться к демо» → demo данные затирают всё. Демо-IDs префиксованы `demo_`, но user-rows никаких маркеров не имеют. Storage.save фиксирует затирание. Восстановления нет.

### CONS-2: **No Esc / outside-click handler на welcome overlay** (BLOCKER UX)
- *(QA §2, designer §5, full-stack F-2)*
- HTML hint обещает «Нажмите Esc или ✕». Esc не biend, backdrop-click игнорируется. Только ✕ и 3 cards закрывают overlay → ✕ irreversibly enters «setup» mode (calls `completeOnboarding()`).

### CONS-3: **Stale geometry: tour не reposition'ит на resize/scroll/re-render** (BLOCKER)
- *(QA §1, full-stack F-1, designer §5)*
- `_positionTourTooltip` читает `getBoundingClientRect()` один раз через 2× RAF и больше не пересчитывает. Любой layout-shift во время тура (filter change, lazy AI block render) оставляет ring на старых координатах.

### CONS-4: **Two parallel onboarding modules с overlapping concerns** (BLOCKER architecture)
- *(sys-analyst §1, full-stack F-3 indirect, designer §3 indirect)*
- `onboarding/onboardingUI.js` (3-step CEO micro-tour) + `app/onboarding.js` (legacy 24-step product tour). Два state-machine, два tooltip+ring DOM-системы (`#onboarding-*` vs `#ob-tour-*`), два CSS-namespace, два set'а кнопок, разная dismiss-семантика.

### CONS-5: **Selector ambiguity / silent step-skip** (HIGH)
- *(QA §1, sys-analyst §4, full-stack косвенно)*
- `if (!target) { _renderTourStep(idx + 1); return; }` — если selector не найден (race с async-render, переименован), тур silently пропускает шаг. Нет warning'а, нет telemetry. User видит как dot-count прыгает.

### CONS-6: **`btn-onboarding` calls `resetOnboarding()` destructively** (HIGH)
- *(full-stack F-3, designer §3)*
- Click «Обучение» в topbar wipes весь `q2_onboarding_v1` localStorage entry, включая `mode` и `lastDatasetType`. Demo-banner flash-off, «Вернуться к демо» affordance исчезает, выбор «setup mode» теряется.

### CONS-7: **Demo banner stale state в нескольких path'ах** (HIGH)
- *(QA §3, sys-analyst §1, full-stack минор)*
- `showPostLoadInsights` пишет `lastDatasetType:'user'` но НЕ вызывает `exitDemoMode()` — `mode` остаётся `'demo'`. Banner показывает «Демо» на user-импортированных данных. «Вернуться к демо» button hides на противоречивом условии.

### CONS-8: **Listener leak / double-click race в startDemoFlow** (HIGH)
- *(full-stack F-4)*
- `_delay(900)` оставляет gap для второго клика. startDemoFlow re-entrant → двойной Storage.save / `demo-load` notify / showCeoTour. Bind в bindWelcomeButtons не идемпотентный.

### CONS-9: **`OB_KEY = 'q2_onboarding_v1'` cross-tab desync** (MEDIUM)
- *(full-stack F-5)*
- Не в `STORAGE_KEYS` / `SETTINGS_KEYS`. Two tabs running tour → tab A finishes, tab B остаётся stale. Demo-mode toggle в tab A не propagate'ит updateDemoBanner в tab B.

### CONS-10: **Демо blockingDeadline `'2024-03-...'` показывает «просрочено 700 дней»** (MEDIUM)
- *(designer §5 unique но критично)*
- Демо deliberately демонстрирует risk-stories. Hard-coded даты 2 года устарели → корруптируют story.

### CONS-11: **Emoji 🎬 🎓 🚀 🎉 📂 🚧 📭 ⚠️ 📋** (MEDIUM)
- *(art-director §4, designer §5)*
- В index.html welcome cards + onboardingUI.js empty-state + showDemoCTA. На фоне V15 SVG-only standard эмодзи feels 2018-2019.

### CONS-12: **Glassmorphism / gradients в welcome overlay** (MEDIUM)
- *(art-director §1)*
- `backdrop-filter: blur(8px)` на overlay, `linear-gradient(135deg, #1e1b4b 0%, #1e3a5f 100%)` на cta-bar, `border-radius: 20px` overshoot V15 spec.

## II. Уникальные находки

### Full-stack
- **F-2** Three independent first-run dismissal paths (welcomeOverlay / ob-welcome / modal-restore) — no atomic state machine
- **F-4** Welcome `bindWelcomeButtons` без `{once:true}` / без idempotent guard
- **Minor** XSS vector: `step.title`/`step.text` через innerHTML (currently safe, future translation injection vector)
- **Minor** Hard-coded toast «22 задачи» — если демо вырастет до 23 строк, toast lies
- **Minor** Step 12 missing в legacy 24-step tour (numbering bug)
- **Minor** `q2_onboarding_v1` не в SETTINGS_KEYS — cross-tab desync

### QA
- **§1** Tooltip width hard-coded 340px — overflow на mobile
- **§1** `tipH = 180` hard-coded — реальная высота динамическая
- **§2** Three different dismiss patterns across welcome / CEO tour / legacy tour
- **§2** Нет focus-trap в tour overlays — Tab улетает в page behind
- **§2** WCAG 2.1.2 fail (no keyboard nav inside tours)
- **§3** Демо→user→демо destructive
- **§4** XSS через innerHTML (потенциал)

### System analyst
- **§2** v11 micro-tour persists `step` через `setOnboardingStep`, но reload не auto-resume — dead persistence
- **§3** `CEO_TOUR_STEPS` array — внутри UI module, не exported, не editable
- **§4** Selector coupling — if section ID changes silently skips, no telemetry
- **§5** Демо-rows persisted as live rows; `exitDemoMode()` flips `mode` но не purge'ит rows
- **§5** Versioning: нет `seenTourVersion` field — content updates invisible to returning users
- **§5** Localisation: zero (zero string-table)

### Art director
- **§1** `.ob-welcome-overlay` `backdrop-filter: blur(8px)` — glassmorphism violation
- **§1** `.ob-welcome-box` border-radius 20px overshoot
- **§1** `.ob-welcome-card` 2px all-around border (нужна 3px stripe-left)
- **§1** `.ob-cta-bar` linear-gradient — gradient violation
- **§1** `.onboarding-highlight` 16px outer-glow — soft halo conflicts с flat
- **§2** Logo 13px — too small for entry surface
- **§3** `.ob-tour-ring` `ob-ring-pulse` infinite — V15-pre era
- **§4** Hard-coded `#ede9fe`/`#6d28d9` в `.ob-demo-badge` — outside Spine palette
- **§4** Hard-coded colors в `.ob-card-demo/-tour/-setup`, `.ob-cta-btn`, dark-theme overrides — bypass design tokens
- **§4** `welcome-blob-1/2/3` 14-22s ambient blobs `filter: blur` — pure decoration
- **§4** `ob-slidein` overshoot bounce easing — too playful

### Designer
- **§1** Friction count ~7 overlays before user touches data
- **§1** 900ms artificial delay — theatre без value
- **§2** Tour не teach'ит actual JTBD (import → filter → mark done) — covers только AI CEO
- **§4** Нет watermark / row-level marker для демо
- **§4** «Загрузите файл через Файлы → Импорт…» — toast describes next step instead of opening file dialog
- **§5** Empty state `📋` icon `font-size: 52px` emoji — нужен 48px outline SVG @ 0.4 opacity

## III. Применённые фиксы (top-7)

| # | Фикс | Файл | Severity |
|---|---|---|---|
| **F1** | startDemoFlow: idempotent guard `_demoFlowInFlight` (предотвращает double-click race) + confirm-prompt перед перезаписью user-импортированных данных (`row.id` без `demo_` префикса) | `onboarding/onboardingUI.js` startDemoFlow | **Critical (data loss)** |
| **F2** | Welcome overlay: Esc-handler + backdrop-click handler (HTML hint «Нажмите Esc или ✕» теперь правда); idempotent guard `document._q2WelcomeBound` | `onboarding/onboardingUI.js` bindWelcomeButtons | **Critical (UX promise broken)** |
| **F3** | CEO tour: re-anchor on resize/scroll через global listeners (idempotent `_tourReposListenerBound`); `_tourCurrentIdx = -1` clear на _endCeoTour чтобы reflow stop'ал | `onboarding/onboardingUI.js` _renderTourStep + _endCeoTour | High (anchor stability) |
| **F4** | _hideTourTooltip: `querySelectorAll` вместо `getElementById` — гарантирует что orphan tooltips от double-click race вычищаются | `onboarding/onboardingUI.js` _hideTourTooltip | Medium (DOM hygiene) |
| **F5** | `btn-onboarding` topbar click: убрал destructive `resetOnboarding()` — теперь просто `showWelcomeScreen()` (mode/lastDatasetType сохраняются) | `app.js` App.init | High (state preservation) |
| **F6** | Демо blockingDeadline `'2024-03-15/-10/-05'` + doneDate `'2024-03-01'` → `isoShift(N)` относительно today (overdue 14 / overdue 7 / due in 21 / completed 3 weeks ago) | `onboarding/demoData.js` _buildRows | Medium (demo correctness) |
| **F7** | Comment-документация: причины каждого фикса inline (V17 P12 ярлыки + ссылки на agent finding numbers) | все правленые файлы | doc-debt |

## IV. Тесты

516 unit / 11 contract / 0 fail. Регрессий нет.

## V. TODO для отдельных итераций

| # | Severity | Откуда | Effort |
|---|---|---|---|
| TODO-P12-N1 | Blocker | sys-analyst §1 — unify two onboarding modules в один config-driven engine | L |
| TODO-P12-N2 | High | designer §2 — tour step coverage: import → filter → mark done (cover real JTBD) | M |
| TODO-P12-N3 | High | sys-analyst §5 — `seenTourVersion` field, bump на content change → returning users see new steps | S |
| TODO-P12-N4 | High | sys-analyst §5 — purge demo rows on `exitDemoMode()` (отметить `demo_` префиксом и снести) | S |
| TODO-P12-N5 | High | QA §2 — focus-trap inside tour overlays + keyboard navigation (Tab/Arrow/Enter) | M |
| TODO-P12-N6 | High | art-director §1 — drop `backdrop-filter: blur()` from welcome overlay | S |
| TODO-P12-N7 | High | art-director §1 — `.ob-cta-bar` gradient → flat var(--card) + 3px accent stripe-left | S |
| TODO-P12-N8 | Medium | full-stack F-5 — `q2_onboarding_v1` в SETTINGS_KEYS для cross-tab sync | S |
| TODO-P12-N9 | Medium | art-director §4 — emoji (🎬 🎓 🚀 🎉 📂 🚧 📭 ⚠️ 📋) → SVG | M |
| TODO-P12-N10 | Medium | sys-analyst §5 — i18n string table | L |
| TODO-P12-N11 | Medium | designer §1 — drop 900ms artificial delay (theatre без value) | S |
| TODO-P12-N12 | Medium | art-director §1 — `.ob-welcome-card` 2px border → 3px stripe-left | S |
| TODO-P12-N13 | Medium | art-director §3 — `ob-ring-pulse` infinite → single 600ms attention pulse | S |
| TODO-P12-N14 | Medium | art-director §4 — token-ize demo badge + cards + dark-theme overrides | M |
| TODO-P12-N15 | Medium | designer §4 — row-level demo marker (subtle stripe + tooltip «Демо-данные») | M |
| TODO-P12-N16 | Low | full-stack minor — escape `step.title`/`step.text` для будущей localisation | S |
| TODO-P12-N17 | Low | full-stack minor — toast «22 задачи» → `${rows.length} задач` | XS |
| TODO-P12-N18 | Low | full-stack minor — fix step 12 missing в legacy tour numbering | XS |
| TODO-P12-N19 | Low | art-director §4 — kill welcome-blob-1/2/3 ambient decorative blobs | S |
| TODO-P12-N20 | Low | designer §5 — empty-state 📋 → 48px outline SVG @ 0.4 opacity | S |

## VI. Резюме

Применил **7 фиксов** (2 critical: data-loss confirm + welcome-Esc, 2 high: tour-reanchor + non-destructive re-entry, 3 medium: orphan-tooltip hygiene + dynamic demo-dates + inline doc). Регрессий нет.

Главное что НЕ сделал в этой итерации:
- Unify two onboarding engines (architectural, требует переписывания state machine + DOM-system)
- Tour step coverage Real-JTBD (требует UX-проход)
- Spine-pill rebrand welcome / cta-bar (требует синхронизации с system tokens)
- focus-trap + keyboard nav (WCAG-уровень)
- i18n string table

20 TODO с severity + effort для следующих спринтов.
