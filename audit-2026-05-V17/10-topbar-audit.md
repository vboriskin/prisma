# Пункт 10 — Аудит «Шапка / Topbar» (полный)

**Команда:** 5 экспертов в фоне:
1. Senior full-stack dev
2. Senior QA tester
3. Senior system analyst
4. Art director
5. Senior product designer (interaction)

**Базис:** 516/11/0.

## I. Консенсус (нашли ≥3 эксперта независимо)

### CONS-1: **Listener leaks / non-idempotent binds в bindFilesDropdown** (BLOCKER)
- *(full-stack C1, designer §2, sys-analyst §5)*
- `bindFilesDropdown` навешивает global `document.addEventListener('click', ...)` на каждый вызов. При re-init (после `Storage.restore`, после demo-load) handler-стек растёт. Каждый клик в документе вызывает все накопленные closures.
- Severity: high (memory + performance).

### CONS-2: **Files-dropdown без a11y / без Esc / без focus-trap** (BLOCKER UX)
- *(full-stack C2, QA §3 a11y, designer §2 dropdown UX, sys-analyst §5 quick-win 6)*
- Нет `aria-haspopup` / `aria-expanded` / `role=menu`. Нет Escape-handler. Tab из triggera улетает в следующий topbar-button мимо открытого меню. Screen-reader не объявляет popover.

### CONS-3: **Sim-mode banner перекрывает topbar** (BLOCKER visual)
- *(QA §1.2, designer §3, art-director §2)*
- `body.sim-mode-active::before` имеет `top: 0; z-index: 9000`. Topbar `z-index: 100`. Banner размещается ПОВЕРХ brand-area. Logo «СБОФ» частично закрыт оранжевой плашкой.

### CONS-4: **Hotkey gap — нет Cmd+S / Cmd+K / Cmd+,** (BLOCKER UX)
- *(QA §3 keyboard, designer §1, sys-analyst §3)*
- Save-кнопка в шапке — единственный путь принудительно зафиксировать данные. Mouse-only. Ctrl/Cmd+S браузер сам пытается сохранить страницу.

### CONS-5: **Filter applied count не отображается** (annoyance)
- *(designer §1, sys-analyst §2, art-director Quick win 4)*
- Кнопка «Фильтры» имеет `aria-expanded="false"` но никогда не показывает СКОЛЬКО фильтров активно. Pill-counter рядом с лейблом (как в Linear / GitHub) — стандарт.

### CONS-6: **Brand → click → no action** (annoyance)
- *(designer §1, sys-analyst §3, art-director §1)*
- «СБОФ Планировщик» — мёртвая надпись. Стандарт SaaS: brand → home/dashboard.

### CONS-7: **logo-pulse animation + linear-gradient — последний Spine-violator** (annoyance)
- *(art-director §1.1, designer §3, sys-analyst косвенно)*
- Все остальные surfaces в V15 ушли на flat neutral. Topbar-logo осталась с `linear-gradient(135deg, accent, #7c3aed)` + 3-секундной pulse-анимацией. Постоянный attention-magnet.

### CONS-8: **🎬 / 📂 emoji в demo-bar** (annoyance)
- *(art-director §1.4, designer §3, full-stack косвенно)*
- На фоне 6 stroke-2 SVG icon-buttons emoji выглядят как наследие 2018-2019.

## II. Уникальные находки (важные)

### Full-stack
- **F-C3** Theme-toggle bind через `addEventListener('click')` без idempotent guard
- **F-C4** В `bindSimMode` нет восстановления визуального состояния из `state.simMode` после init — banner не появляется до клика
- **F-C5** `App.bindImports` делает permanent listeners на label/button — at re-init они дублируются

### QA
- **QA-1.1** «Save» нажимается на пустом `state.rows` → стрелка идёт через forceSave + HistoryLog → spam-row
- **QA-1.2** Sim-mode banner перекрывает кликабельный hamburger при mobile media-query
- **QA-1.3** `ob-btn-load-data` / `ob-btn-back-demo` (demo-toggle) — нет aria-pressed / нет visual-state для текущего режима
- **QA-1.4** SimMode не applyFromState на boot — restored sim=true → серое UI

### System analyst
- **SA-§2** Filter dropdown chevron `▾` — text-glyph, не SVG; на dark-theme плохой contrast
- **SA-§3** `Cmd+S` стандарт у пользователей, но в приложении он улетает в `Save Page As` браузера
- **SA-§4** Theme-toggle бинарный — нет `auto/system` опции (Linear / GitHub / VSCode standard)
- **SA-§5** Quick-win 6: `aria-haspopup=menu` для files-dropdown
- **SA-§5** Quick-win 7: `role=button` + `tabindex=0` для brand если кликабельно

### Art director
- **AD-§1.1** logo-pulse — 3-секундная анимация ВСЕГДА на экране
- **AD-§1.4** demo-bar emoji не выровнены с SVG-icon-buttons (разная visual height)
- **AD-§2** Sim-banner orange solid — perceptual-noisy. Достаточно subtle 3px stripe сверху + текст
- **AD-§3** `topbar-row-count` badge filled accent-light — Spine эталоном должен быть neutral mono

### Designer
- **D-§1** Cmd+K omnibar (Linear-pattern) — отсутствует
- **D-§1** `Filter` toggle button: чевроны не вращаются с aria-expanded sync (есть class .filters-open но не aria)
- **D-§2** files-dropdown: tab-navigation внутри меню работает только до 1-го input — далее tab улетает за пределы
- **D-§3** Нет mobile media-query (≤640px) — кнопки overflow в 2 ряда
- **D-§4** `:focus-visible` стили только на 2 элементах из 9

## III. Применённые фиксы (top-11)

| # | Фикс | Файл | Severity |
|---|---|---|---|
| **F1** | Cmd/Ctrl+S hotkey + empty-state guard для bindSave; idempotent flag `_q2SaveHotkeyBound`; skip когда фокус в input/textarea/contentEditable | `app.js` `bindSave` | High (UX gap) |
| **F2** | Files-dropdown: `aria-haspopup=menu` / `aria-expanded` sync на каждом toggle; `role=menu`; Escape closes + returns focus to trigger; idempotent guard `_q2FilesDropdownBound` | `app.js` `bindFilesDropdown` | **Critical (a11y + leak)** |
| **F3** | Sim-mode banner `top: 0` → `top: var(--topbar-h)` (clear topbar) | `styles.css` `.sim-mode-active::before` | **Critical (visual overlap)** |
| **F4** | `SimMode.applyFromState()` — отдельный method для DOM-sync без toast/log; вызов в `App.init` после `bindSimMode` для boot-restore | `app.js` SimMode + App.init | High (sim=true silent) |
| **F5** | `getActiveCount()` в FilterEngine + `topbar-filter-count` pill в кнопке «Фильтры»; auto-update в `updateTopbarBadge` | `filters.js` + `app.js` + `index.html` + `styles.css` | High (UX visibility) |
| **F6** | Brand → click/Enter → `App.renderSection('dashboard')`; `role=button` + `tabindex=0` + `:hover` / `:focus-visible` стили; idempotent flag `_q2BrandBound` | `app.js` App.init + `index.html` + `styles.css` | Medium (standard SaaS) |
| **F7** | `aria-label` на 6 icon-only topbar-buttons (save / files / sim / theme / settings / onboarding); `aria-pressed=false` на sim-mode | `index.html` | Medium (a11y) |
| **F8** | 🎬 / 📂 emoji → SVG (camera + folder stroke-2); aria-label на demo-bar; aria-hidden на decorative SVG | `index.html` | cosmetic (Spine consistency) |
| **F9** | logo-pulse animation + linear-gradient → solid `var(--accent)` без анимации; убран `box-shadow: 0 0 14px` в dark-theme | `styles.css` `.topbar-logo` | cosmetic (last Spine violator) |
| **F10** | Idempotent guards: `document._q2FilesDropdownBound`, `document._q2SaveHotkeyBound`, `brand._q2BrandBound` | `app.js` | High (leak prevention) |
| **F11** | `role=menu` на files-dropdown-menu (улучшение SR-навигации) | `app.js` `bindFilesDropdown` | Medium (a11y) |

## IV. Тесты

516 unit / 11 contract / 0 fail. Регрессий нет.

## V. TODO для отдельных итераций

| # | Severity | Откуда | Effort |
|---|---|---|---|
| TODO-P10-N1 | High | designer §1 — Cmd+K omnibar (Linear-pattern: search + section-jump + bulk-actions) | L |
| TODO-P10-N2 | High | sys-analyst §4 — theme `auto/system` опция (matchMedia prefers-color-scheme) | M |
| TODO-P10-N3 | Medium | designer §3 — mobile media-query (≤640px) для topbar overflow | M |
| TODO-P10-N4 | Medium | art-director §2 — sim-banner от orange solid → 3px stripe сверху + subtle text | S |
| TODO-P10-N5 | Medium | art-director §3 — `topbar-row-count` filled → mono-tabular neutral pill | S |
| TODO-P10-N6 | Medium | QA §1.3 — `aria-pressed` на demo-toggle (load-data / back-demo) sync | S |
| TODO-P10-N7 | Medium | full-stack F-C3 — idempotent guard на theme-toggle | S |
| TODO-P10-N8 | Medium | full-stack F-C5 — idempotent guards на все bindImports labels/buttons | M |
| TODO-P10-N9 | Low | sys-analyst §2 — chevron `▾` text-glyph → SVG для consistency на dark-theme | S |
| TODO-P10-N10 | Low | designer §2 — focus-trap внутри files-dropdown (Tab loop) | M |
| TODO-P10-N11 | Low | designer §4 — `:focus-visible` стили на оставшиеся 7 элементов | S |
| TODO-P10-N12 | Low | sys-analyst §3 — Cmd+, для open-settings (mac standard) | S |
| TODO-P10-N13 | Low | art-director §1.4 — demo-bar SVG-vertical-align с icon-buttons (sub-pixel) | S |
| TODO-P10-N14 | Low | designer §1 — chevron + `aria-expanded` sync для filter-toggle (visual ↔ semantic) | S |

## VI. Резюме

Применил **11 фиксов** (3 critical: a11y+leak в files-dropdown / sim-banner overlap / cmd+s hotkey gap, 8 высокоprior visual + UX + state). Регрессий нет.

Главное что НЕ сделал в этой итерации:
- Cmd+K omnibar (архитектурное решение по поиску + регистрации команд)
- `auto/system` тема (matchMedia listener + persistence-policy)
- Mobile media-queries (пересмотр всего breakpoint-стека)
- Sim-banner от solid → 3px stripe (синхронизация с art-director стилем sim-icon)

14 TODO с severity + effort для следующих спринтов.
