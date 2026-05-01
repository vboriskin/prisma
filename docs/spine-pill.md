# Spine-Pill Design Language (V15+)

Дизайн-система проекта. Применяется ко **всем** data-views: Реестр, Гант, Дашборд, Метрики, Сводная, Инсайты, AI Анализ, AI CEO, Сотрудники, Настройки.

> **Не применяется к:** onboarding tour (one-time UX, эмодзи там OK) и в emoji-палитре (если есть).

## Базовые правила

### 1. Без эмодзи в data-surfaces

❌ `🚧 5 блокеров` / `📭 13 без релиза` / `⚠️ высокий риск`
✅ `5 блокеров` / `13 без релиза` / `высокий риск` (цветовое кодирование тоста / класса несёт ту же семантику)

Где исключения OK:
- Onboarding tour (`app/onboarding.js` 24-step)
- Some legacy ctx-menus в Ганте (постепенно мигрируют — см. Spine TODO в `audit-2026-05-V17`)

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

Padding / gap / margin должны быть из `4 / 8 / 12 / 16 / 24 / 32`. Не `5 / 7 / 11 / 18`. См. lapses в `audit-2026-05-V17/11-filters-audit.md` art-director §4.

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

## Audit-источники

- `design-audit/01-art-director.md` — design language manifesto
- `design-audit/02-designer.md` — interaction patterns
- `audit-2026-05-V17/08-dashboard-tabs-audit.md` — Spine применение к dashboard
- `audit-2026-05-V17/09-registry-audit.md` — Spine в Реестре
- `audit-2026-05-V17/10-topbar-audit.md` — Spine в Шапке
- `audit-2026-05-V17/11-filters-audit.md` — Spine в Фильтрах

Если делаешь визуальный change — пройди по этим док-ам, проверь что не нарушаешь зафиксированные ранее решения.

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
