# Spine-Pill Design Language (V15+)

Дизайн-система проекта. Применяется ко **всем** data-views: Реестр, Гант, Дашборд, Метрики, Сводная, Инсайты, AI Анализ, AI CEO, Сотрудники, Настройки.

> **Не применяется к:** onboarding tour (one-time UX, эмодзи там OK) и в emoji-палитре (если есть).

## Базовые правила

### 1. Без эмодзи в data-surfaces

❌ `🚧 5 блокеров` / `📭 13 без релиза` / `⚠️ высокий риск`
✅ `5 блокеров` / `13 без релиза` / `высокий риск` (цветовое кодирование тоста / класса несёт ту же семантику)

Где исключения OK:
- Onboarding tour (`app/onboarding.js` 24-step)
- Some legacy ctx-menus в Ганте (постепенно мигрируют)

### 2. Без gradients

❌ `background: linear-gradient(135deg, #4f46e5, #7c3aed)`
✅ `background: var(--accent)` или `background: var(--card)` + accent-stripe

Что было / стало (примеры из V17.1):
- FAB чата (V17.1 A2): был `linear-gradient(135deg, #4f46e5, #7c3aed)` + 3-сек pulse → стал solid `var(--accent)` без анимации
- Topbar logo (V17 P10 F9): был `linear-gradient(135deg, accent, #7c3aed)` + `animation: logo-pulse 3s` → solid + no animation
- AI CEO `.summary-super-hero`, `.metrics-hero`, `.ceo-hero-ok/-risk/-critical` — radial+linear gradients удалены

### 3. 3px stripe-left для активных/выделенных

Вместо filled-background использовать тонкую цветную полосу слева:

```css
/* ❌ Было — filled chip */
.toggle-chip:has(input:checked) {
  background: var(--accent-light);
  color: var(--accent);
  border: 1px solid var(--accent);
}

/* ✅ Должно быть — Spine-pill */
.toggle-chip:has(input:checked) {
  background: transparent;
  border-left: 3px solid var(--accent);
  color: var(--accent);
}
```

Применено в:
- Pulse pills в Ганте (V15 redesign)
- Bulk-panel surface (V17 P9 F10) — был `var(--accent-light) + 1.5px solid` → `var(--card) + 1px border + 3px accent stripe слева`
- Эпик-row left-stripe (V16 A3) — dominant work-type определяет цвет

### 4. Mono-tabular numerals

Все числовые данные должны выравниваться колонкой:

```css
.registry-table {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;  /* для KPI / dates / id */
}

/* Или через CSS feature-settings */
.summary-metric {
  font-feature-settings: "tnum" 1, "lnum" 1;
}
```

Применено везде где числа важны: Реестр (id, dates, count-badge), Дашборд (KPI), Чёрный дашборд, Sparkline meta, Plural counters в Ганте.

### 5. CAPS sub-headers

Маленькие заголовки секций — UPPERCASE с letter-spacing:

```css
.section-eyebrow {
  font-size: 9-10px;
  font-weight: 700;
  letter-spacing: .6-.7px;
  text-transform: uppercase;
  color: var(--text-3);
}
```

Применено в:
- Все sticky-thead (V17 P9 F7): `11px/600 letter-spacing .3px → 10px/700 letter-spacing .7px` (Spine eyebrow)
- ctx-menu sub-headers («Статус», «Положение», «Параметры»)
- Settings tab labels

### 6. SVG icons вместо emoji там где они должны быть

В Шапке (topbar): все 6 кнопок (save / files / sim / theme / settings / onboarding) — `<svg>` stroke-2 outline.

```html
<!-- ❌ Было -->
<span id="ob-demo-bar">🎬 Демо</span>
<button>📂 Свои данные</button>

<!-- ✅ V17 P10 F8 -->
<span id="ob-demo-bar">
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
  Демо
</span>
```

Стандартные настройки SVG:
- `viewBox="0 0 24 24"`
- `fill="none" stroke="currentColor" stroke-width="2"`
- Размер: 14-16px в кнопке-icon-only, 12-14px в badge

### 7. Color только для семантики

❌ Decorative gradient «потому что красиво»
✅ Цвет = носитель смысла:
- Accent (фиолетовый) — primary action, current state
- Red — danger / critical / blocker
- Amber — warning / risk / overtime
- Green — success / ok / done
- Neutral grays — default text, borders

### 8. Spacing на 4/8 grid

Padding / gap / margin должны быть из `4 / 8 / 12 / 16 / 24 / 32`. Не `5 / 7 / 11 / 18`.

### 9. Inline `style.X = …` → CSS custom-property (AUDIT_HOLISTIC O10)

**Проблема.** `el.style.left = x + 'px'` / `el.style.display = 'none'` / `el.style.opacity = '.4'` ×120+ в `views/gantt.js`, `views/registry.js`, `views/gantt/aux.js`, `integrations/teamScanner2.js`. Inline-style:
- конкурирует с CSS-rule на той же property (важнее по специфичности → ломает theme-switch);
- невидим для `prefers-reduced-motion` media-query (`transition` / `transform` ставятся напрямую);
- невозможно перекрыть из dark-theme или a11y-overrides без `!important` гонки.

**Паттерн миграции.**

```js
// ❌ Было — inline px
el.style.left = x + 'px';
el.style.top  = y + 'px';

// ✅ Стало — custom-property + CSS rule
el.dataset.pos = '1';
el.style.setProperty('--prizma-menu-x', x + 'px');
el.style.setProperty('--prizma-menu-y', y + 'px');
```

```css
/* styles.css */
.registry-ctx-menu[data-pos] {
  left: var(--prizma-menu-x, 0);
  top:  var(--prizma-menu-y, 0);
}
```

**Bool-видимость → class-toggle.**

```js
// ❌ Было
rowEl.style.display = collapsed ? 'none' : 'grid';

// ✅ Стало
rowEl.classList.toggle('is-team-collapsed', collapsed);
```
```css
.gantt-row.is-team-collapsed { display: none !important; }
```

**Animation transform → class + custom-properties.**

```js
// ❌ Было — transform inline, prefers-reduced-motion не работает
ghost.style.transform = `translate(${dx}px, ${dy}px) scale(1.15)`;

// ✅ Стало
ghost.classList.add('gdt-drop-ghost');
ghost.style.setProperty('--prizma-ghost-tx', dx + 'px');
ghost.style.setProperty('--prizma-ghost-ty', dy + 'px');
```
```css
.gdt-drop-ghost {
  transform: translate(var(--prizma-ghost-tx, 0), var(--prizma-ghost-ty, 0)) scale(var(--prizma-ghost-scale, 1));
}
@media (prefers-reduced-motion: reduce) {
  .gdt-drop-ghost { transform: none; transition: none; }
}
```

**Когда оставить inline-style.**
- `setProperty('--prizma-…', …)` — это единственная допустимая форма «динамической записи».
- One-shot ghost-элементы для flight-animation, где css-text задаётся целиком при создании (см. `gantt.js#dragend → ghost.style.cssText`); их CSS-rule всё равно бесполезен (элемент уничтожается через 700 ms).
- `style.cssText = '…'` с комментарием «WHY-not-class» — допустимо для legacy details-элементов, но новые callsite'ы должны идти через class.

**Lint.** `eslint-rules/no-inline-style.js` (stub, warn-only) ловит `el.style.<prop> = …` для `width / height / left / top / right / bottom / color / background / opacity / transform / display / minWidth / maxWidth`. `setProperty('--prizma-*', …)` — не считается. Override через `// eslint-disable-next-line no-inline-style` с пояснением.

**Затронуто в первом pass'е (после AUDIT_HOLISTIC O10):**
- `views/registry.js` — column-resize live width (×3 callsite), sticky-pin-left, ctx-menu position, `.cell-input width:100%` снят (уже в .cell-input rule), textarea autosize → `--prizma-textarea-h` (≈8 замен).
- `views/gantt.js` — team-collapse display-toggle (1), pill drag-opacity (2), ctx-menu position (2), drop-ghost transform (1) (≈6 замен).
- `views/gantt/aux.js` — fast-tooltip позиция и видимость переехали в `.gdt-fasttip` rule (≈4 замены).
- `styles.css` — добавлены 10 правил под секцией «AUDIT_HOLISTIC O10».

Остаётся ~20 inline-style sites (см. `grep -rnE 'style\.(width|height|left|top|right|bottom|color|background|opacity|transform|display)\s*=' views/ integrations/`) для phase-2.

## Анти-паттерны (обновляемый список)

| Анти-паттерн | Найдено в | Решение |
|---|---|---|
| `linear-gradient(135deg, ..., ...)` | удалить, см. examples выше | solid + accent stripe |
| `🚧 / 📭 / ⚠️` в data-toast'ах | V17.2 fix in `onboardingUI.js#showPostLoadInsights` | удалить emoji, доверять class-окрашиванию toast |
| `box-shadow: 0 0 0 3px rgba(79,70,229,.1)` (focus glow) | filter inputs, multiselect | solid 1.5px accent border на :focus-visible |
| `border-radius: 20px` для chips | `.preset-btn`, `.toggle-chip` | `var(--radius-sm)` (~6-8px) |
| Hardcoded `#fff` / `#fafbfd` в light-only | `.tag-input-wrap`, `.preset-source-group` | через design tokens |
| Letter-spacing inconsistency `.3px / .4px / .5px` | filter labels | унифицировать на `.6px` |
| `.btn-reset-filters` dashed border | (живое в Filters) | ghost text-button |

## Дизайн-токены

Основные CSS-переменные (из `styles.css` `:root`):

| Токен | Назначение |
|---|---|
| `--accent` (`#4f46e5`) | Primary action color |
| `--accent-light` | Subtle accent surface (используется СДЕРЖАННО — не везде!) |
| `--card` | Default surface (white in light, dark-blue in dark) |
| `--bg-1, --bg-2, --bg-3` | Уровни background |
| `--text-1, --text-2, --text-3, --text-4` | Текст по убыванию контраста |
| `--border, --border-light` | Границы |
| `--radius-xs, --radius-sm, --radius, --radius-lg` | Скругления (4 / 6 / 8 / 12-16) |
| `--motion-fast, --motion-mid` | Длительности анимаций (140ms / 240ms) |
| `--ease-standard, --ease-emphasis` | Easing functions |
| `--topbar-h` (56px) | Высота шапки |
| `--sidebar-w` | Ширина sidebar |

## Dark theme parity

Каждое новое правило **должно** иметь `body.theme-dark` override если default-цвет не работает в тёмной теме:

```css
.my-new-thing { background: #ffffff; color: #1c1917; }
body.theme-dark .my-new-thing { background: var(--card); color: var(--text-1); }
```

V17 P10 F9 история: `topbar-logo` имел `linear-gradient(135deg, #a78bfa, #ec4899)` в `body.theme-dark` — выглядело норм в dark, но V15 ban gradients → удалили.

V17.1 K2 история: `.ceo-sev-*` имел fixed light hex для `--sev-bg` (`#fef2f2`, `#fffbeb`...) → на dark theme получался почти-белый фон. Фикс — переопределение токенов в dark на полупрозрачные `rgba(...)`.

## Историческая справка

Spine-pill manifesto родился в V15 design-audit. Применение к разделам
(Реестр / Дашборд / Шапка / Фильтры / Гант) — V17 P9-P11. Все детали
поднимаются через `git log --grep="V15 Spine"` или `git log -S "spine-pill"`.

V22+ Phase 5.2 + Sprint A — последняя массовая ревизия compliance
(Release 2.0 sub-tab и Scanner team) — детали `git log --grep="V22+ Sprint A"`.

## Visual review checklist

Перед PR с visual change:
- [ ] Никаких gradient'ов на новых surfaces
- [ ] Activity-state — 3px stripe-left, не filled
- [ ] Числа — `tabular-nums` если их можно сравнивать
- [ ] CAPS sub-headers с letter-spacing если есть section labels
- [ ] Никаких эмодзи в data-views (chat / onboarding tour OK)
- [ ] Spacing на 4/8 grid
- [ ] Dark theme проверен
- [ ] focus-visible — solid 1.5px accent border, не glow
- [ ] Все цвета через токены, не hex
