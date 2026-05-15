# Pz Design System — `pz-card / pz-chip / pz-badge / pz-modal`

> AUDIT_HOLISTIC P1 / Идея 10. Базовые классы дизайн-системы Призмы.
> Заменяют 120+ `*-card`, 71 `*-chip`, 63 `*-badge`, 59 `*-modal` уникальных классов
> при будущей миграции — постепенно, не destructive.

CSS живёт в одном файле: [`pz-design-system.css`](../pz-design-system.css).
Подключён в `index.html` после `theme.css` + `styles.css`.

Контракты:
- Все цвета через токены (`--prizma-*`, `--card`, `--radius`, `--motion-fast`, `--ease-standard`).
- 3px stripe-left для `data-state` — Spine-pill (`docs/spine-pill.md` §3).
- Без эмодзи и gradients.
- Dark/light parity через `theme.css` — токены сами свапаются.
- `prefers-reduced-motion: reduce` отключает декоративный pulse у `pz-badge`.

---

## API

### `.pz-card`

Универсальная surface. База — `var(--card)`, `1px` border, `var(--radius)`, padding `16px`.

| data-атрибут | Значения | Эффект |
|---|---|---|
| `data-elevation` | `1`, `2` | `box-shadow` (1 = subtle, 2 = floating) |
| `data-state` | `active`, `success`, `warning`, `danger`, `insight` | `border-left: 3px solid …` (Spine-pill) |
| `data-density` | `compact`, `loose` | `padding: 8/12` или `24/32` |

```html
<div class="pz-card" data-elevation="1" data-state="success">
  Эпик закрыт по плану.
</div>

<div class="pz-card" data-elevation="2" data-density="loose">
  Hero-блок с тенью и большим padding.
</div>
```

State → CSS-токен:
- `active`  → `--prizma-information`
- `success` → `--prizma-on-course`
- `warning` → `--prizma-drift`
- `danger`  → `--prizma-off-course`
- `insight` → `--prizma-insight`

### `.pz-chip`

Inline-индикатор. Compact, мини-pill `4px 10px`, `font-size 12px`.

| data-атрибут | Значения | Эффект |
|---|---|---|
| `data-tone` | `information`, `on-course`, `drift`, `off-course`, `insight` | `color` + tinted `border-color` |
| `data-active` | `true` | `background: --prizma-bg-tertiary` + `border-color: currentColor` |

```html
<span class="pz-chip" data-tone="information">Beta</span>
<span class="pz-chip" data-tone="off-course" data-active="true">3 блокера</span>
```

### `.pz-badge`

Маленький numeric/status counter (notification count, новые сообщения).
Min-width `18px`, height `18px`, `border-radius 9px`, monospace numerals.

| data-атрибут | Значения | Эффект |
|---|---|---|
| `data-tone` | `information`, `off-course` | смена `background` |
| `data-pulse` | `true` | scale-pulse 1600ms (отключается в reduced-motion) |

```html
<span class="pz-badge">12</span>
<span class="pz-badge" data-tone="off-course" data-pulse="true">!</span>
```

### `.pz-modal` + `.pz-modal-overlay`

Overlay + dialog. Используются вместе.

| data-атрибут | Значения | Эффект |
|---|---|---|
| `data-size` (на `.pz-modal`) | `sm`, `lg` | `max-width 400/900` + scaled padding |

```html
<div class="pz-modal-overlay">
  <div class="pz-modal" data-size="sm" role="dialog" aria-modal="true">
    <h2 class="pz-modal-title">Подтверждение</h2>
    <button class="pz-modal-close" aria-label="Закрыть">&times;</button>
    <div class="pz-modal-body">
      Применить изменения к 12 эпикам?
    </div>
  </div>
</div>
```

---

## Migration guide (для будущих callsites)

**НЕ делать массовый codemod.** Замена точечная, при правке соседнего кода.

| Existing класс | Замена |
|---|---|
| `.kpi-card.kpi-card-success` | `<div class="pz-card" data-elevation="1" data-state="success">` |
| `.dashboard-card` (clickable) | `<div class="pz-card" data-elevation="1" data-state="active">` |
| `.team-card-hero` | `<div class="pz-card" data-elevation="2" data-density="loose">` |
| `.scope-chip` (active) | `<span class="pz-chip" data-tone="information" data-active="true">` |
| `.health-chip-warn` | `<span class="pz-chip" data-tone="drift">` |
| `.notify-badge` (red dot) | `<span class="pz-badge" data-tone="off-course">` |
| `.app-settings-modal` | `<div class="pz-modal-overlay"><div class="pz-modal" data-size="lg">…</div></div>` |

Шаги:
1. Найди один callsite (обычно в `views/*.js` или inline-HTML).
2. Замени класс + конвертируй boolean-варианты в `data-attr`.
3. Прогон `npm run audit:tokens` — убедись, что raw hex не выросли.
4. Прогон `node --test tests/unit/pz-design-system-tokens.test.js`.

## Token-coverage gate (P2)

`npm run audit:tokens` — reporting-only. Считает:
- Total raw hex (`#abc / #aabbcc / #aabbccdd`).
- Unique hex.
- `var(--*)` usages.
- Coverage ratio.
- Top-15 файлов с самым большим количеством raw hex.

Threshold (informational): raw ≤ 550, uniq ≤ 220, coverage ≥ 75%.
Не fail'ит CI. Используй как baseline для будущей token-миграции.

## Где использовано (callsites)

Демо в `views/settingsView.js` → секция «Эксперименты»: `pz-card[data-state="insight"]`
+ `pz-chip[data-tone="information"]` + `pz-badge`. Existing `prizma-settings-*`
классы остаются нетронутыми в остальных секциях.
