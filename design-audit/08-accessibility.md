# 08. Accessibility-аудит

> **Роль**: a11y-эксперт. Что **уже** есть, что **проседает**, и что нельзя ломать в редизайне.

## 1. Контекст применимости

Продукт — внутренний корпоративный инструмент. Однако:
- Сбер как организация имеет **обязательства WCAG 2.1 AA** по внутренним сервисам (директивы инклюзии, Госуслуги-параллель).
- Сотрудники с low-vision / неполным цветовосприятием — есть. Внутренний софт обязан их поддерживать наравне с публичным.
- В B2B-контексте «accessibility = usability for the tired». Любой контраст-фикс одинаково помогает и слепому, и менеджеру в 18:30 на 8-м часу работы.

Критерий минимума для редизайна: **WCAG 2.1 AA + reduced-motion + focus-visible**.

---

## 2. Текущее состояние — оценка

### 2.1 Контраст (WCAG 1.4.3 / AA = 4.5:1 для body, 3:1 для large text)

Тест ключевых пар (Light theme):

| Foreground / Background | Contrast | WCAG AA | Используется в |
|---|---|---|---|
| `--text-1` `#111827` / `--bg` `#f0f2f7` | 16.7:1 | ✅ AAA | Body на фоне страницы |
| `--text-2` `#374151` / `--card` `#ffffff` | 11.6:1 | ✅ AAA | Body в cards |
| `--text-3` `#6b7280` / `--card` `#ffffff` | 5.8:1 | ✅ AA | Captions, labels |
| `--text-4` `#9ca3af` / `--card` `#ffffff` | 3.4:1 | ⚠️ AA only for large text (18px+ или 14px+ bold) | Используется в 11px labels — **fail!** |
| `--accent` `#4f46e5` / `--card` `#ffffff` (text) | 7.5:1 | ✅ AAA | Links, primary buttons text |
| `--text-1` / `--accent-light` `#eef2ff` | 15:1 | ✅ AAA | Active states |

**Проблема найдена**: `--text-4 #9ca3af` (3.4:1) используется в 11px-микро-метках типа `.employees-table th`, `.kpi-label`. Это **WCAG 1.4.3 fail** для текста меньше 18px. На светлой теме — это ниже AA.

| Foreground / Background | Contrast | WCAG AA | Используется в |
|---|---|---|---|
| `--text-1` `#e5e7eb` / `--bg` `#0b1020` (dark) | 13.5:1 | ✅ AAA | Body |
| `--text-3` `#94a3b8` / `--card` `#121a2f` (dark) | 4.8:1 | ✅ AA | Captions |
| `--text-4` `#64748b` / `--card` `#121a2f` (dark) | 3.2:1 | ⚠️ Fail для 11px | **Та же проблема в dark** |

**Где ещё проседает контраст**:

- **Active nav-item bg** `--accent-light` `#eef2ff` против `--bg` `#f0f2f7` — разница ~2:1. Активный таб **визуально слабо** отличается от фона. Доступности это не нарушает (текст внутри читается), но **юзабилити** — да.
- **Hover row** `--row-hover` `#f3f4f6` против `--card` `#ffffff` — еле различимо. Не влияет на содержимое, но «hover-feedback» слабый.
- **Postpone-arrows** в Ганте: красная dashed-line `#dc2626`, толщина 2.4px, на сером фоне ячейки. Контраст 4.7:1 ✅, но при **диплопии или red-green color blindness** информация о «переносе» теряется (это и стрелка, и красный цвет — но если цвет не виден, форма «пунктирная стрелка» всё равно читается). ✅ Удалось пройти 1.4.1 «Use of Color».

### 2.2 Фокус (WCAG 2.4.7 — Focus Visible)

```bash
grep -n ":focus" styles.css | wc -l
# 21
```

**Состояние**: фокус-стили **есть**, но не везде последовательны:
- `.filter-input:focus`, `.cell-input:focus`, `.btn-outline:focus` — есть border-color shift на `--accent`.
- `.ti-search:focus { outline: 2px solid var(--accent); outline-offset: -1px; }` — хорошо.
- На `nav-item`, `.preset-btn`, многих clickable cards — **нет явного focus-state**. Tab-навигация теряет след.
- На `<details><summary>` (используется в Tech Info, Black Dashboard) — focus есть (default browser ring), но на тёмной теме default outline `#000` практически невидим.

**Проблема**: пользователь, который привык tab-навигировать (часто люди с motor-impairments или power-users) потеряет ориентацию, особенно на nav-items и presets.

### 2.3 Размеры и hit-targets (WCAG 2.5.5 — AA: target ≥ 44×44px)

- **Кнопки** `.btn-sm` имеют `padding: 6-8px` и font 12-13px → effective ~28-30px height. **Fail** vs 44×44 для AA. (Это типично для admin-tools, но WCAG строг.)
- **Nav-items** в sidebar — height ~40px. Близко, но не 44px.
- **Inline-edit cells** — высота `--row-h: 36px`. Кликбельная зона достаточная (вся ячейка), но визуально малое.

В **WCAG 2.2 AAA** требование 24×24, в 2.1 AA — 44×44 (Touch). Для desktop-mouse это менее критично, но если кто-то использует touch-laptop / external touch — это проблема.

### 2.4 Reduced motion (WCAG 2.3.3 — AAA)

```bash
grep -n "prefers-reduced-motion" styles.css
# (no results)
```

**Полное отсутствие**. Все анимации (toast, modal, FAB pulse, section enter, drag-drop motion) запускаются вне зависимости от `prefers-reduced-motion: reduce`. Для пользователей с vestibular disorders это **вызывает дискомфорт** (голавкружение, тошноту).

**Ожидаемое решение**:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Это **бесплатный** добавок, ставится в начало `styles.css`, занимает ~150 байт.

### 2.5 ARIA / семантика

```bash
grep -nE "aria-" index.html | wc -l
# 32
```

Что есть:
- `<header id="topbar">` — semantic ✓
- `<aside id="sidebar">` — semantic ✓
- `<button class="nav-item" data-section="..." aria-expanded="false">` — частично
- `aria-live="polite"` на `#toast` (audit V12 #25) ✓
- `role="dialog" aria-modal="true" aria-labelledby="ti-title"` на Tech Info ✓
- `role="region" aria-label="Фильтры"` на global-filters-bar ✓

Что **отсутствует**:
- На большинстве модалок (LLM settings, App settings, Action layer) — нет `role="dialog"` / `aria-modal`.
- Динамически создаваемые dropdowns / pickers (gdt-add-picker, gdt-ctx-menu) не имеют `role="menu"` / `role="menuitem"`.
- Таблицы `.registry-table`, `.data-table` — обычные `<table>`, но **нет `<caption>`** для screen-readers, хотя h2 есть рядом.
- Status-cells (done / dirty / risky) — цветовая индикация без `aria-label="Статус: выполнено"` (или подобного). Screen-reader пользователь не получит этой информации.

### 2.6 Клавиатура

- **Escape** закрывает модалки (Tech Info, App settings, registry-fullscreen, LLM panel, gdt-ctx-menu) ✓
- **Tab-нав** работает по умолчанию, но **focus order** иногда странный (модалка → focus сначала на закрывающую кнопку, потом на body — нелогично).
- **Cmd/Ctrl+K** для command palette — **отсутствует** (есть в большинстве современных tools, ожидается power-users).
- **Drag-and-drop в Ганте** — **только мышью**. Нет клавиатурной альтернативы для перемещения pill (например, выделить + Cmd+→ для перехода в следующую колонку).
- **Inline-edit** — Tab выходит из cell без сохранения? Нет, Tab сохраняет (хорошо). Но Enter — некоторые cells принимают Enter, другие — нет (непоследовательно).

### 2.7 Размер шрифта (WCAG 1.4.4 — Resize text)

`html { font-size: 14px }` — фиксировано в pixels. **Не reflows** при браузерном zoom-in 200% — но pixel-based works fine с `Ctrl+/+`. ✅

Однако `--text-3xs: 10px`, `--text-2xs: 11px` — **fail для AAA** (1.4.8 «Visual Presentation», требует ≥ 14pt body). Для AA — допустимо.

---

## 3. Что **не должно потеряться** при редизайне

### Сохранить однозначно

✅ **4-уровневая текст-иерархия** через `--text-1..4` (после редизайна — `--text-primary..--text-disabled`).
✅ **Status-цвета** (emerald/amber/red) — semantically established, screen-reader-friendly when paired с `aria-label`.
✅ **Focus styles** на inputs — даже если их улучшать, не убирать.
✅ **Aria-live на toast** — единственный способ для screen-readers узнать о save/error.
✅ **Escape закрывает** — universal pattern.
✅ **Tab-нав по nav-items** — пусть через стрелки или Tab, но работает.
✅ **Темная тема** — некоторым low-vision пользователям нужна для снижения eye-strain.

### Улучшить при редизайне (не оставлять как есть)

⚠️ Контраст `--text-4` (3.4:1) — должен стать ≥ 4.5:1 для всех text < 18px.
⚠️ Hover/active state на nav-items — должно быть **видимо** (≥ 3:1 разница).
⚠️ Focus-visible на каждом interactive element.
⚠️ `prefers-reduced-motion` поддержка.
⚠️ Hit-target size — для всех важных кнопок ≥ 32×32 (компромисс между admin-density и 44×44 AA).
⚠️ ARIA на все модалки + popovers + dropdowns.

---

## 4. Конкретные исправления — checklist для редизайна

### Контраст и цвет

- [ ] Заменить `--text-4` `#9ca3af` (light) на ≥ 4.5:1 — например, `#6b7280` (`text-3` shade). Усиление позволит использовать его в 11px micro-метках.
- [ ] В тёмной теме `--text-4` `#64748b` → `#94a3b8` (`text-3` shade в темной).
- [ ] Active nav-item — вместо `--accent-light` (#eef2ff) bg, использовать **видимую** комбинацию: ярче bg (`--brand-100`) + bold left-border `3px solid --brand-500`.
- [ ] Hover на rows — увеличить разницу с base (например, `--surface-row-hover` темнее на ~3-5%).
- [ ] Не передавать смысл **только цветом**: status-cells должны иметь icon ИЛИ текст-метку рядом с цветом.

### Focus & клавиатура

- [ ] Глобальный `:focus-visible` style — 2px solid `--border-focus` + offset 2px на всех interactive (`button`, `a`, `input`, `select`, `[tabindex]`).
- [ ] **Нативный `:focus` без `:focus-visible`** убрать (чтобы клик не показывал ring, а Tab показывал).
- [ ] На модалках — **focus trap**: при открытии focus → first-focusable, Tab cycles, Shift+Tab cycles back, Escape closes + returns focus to trigger. (Сейчас focus-trap отсутствует, см. audit V13 FE-2.)
- [ ] `tabindex="0"` на nav-items, presets-buttons — чтобы они входили в Tab-flow.
- [ ] Cmd/Ctrl+K command palette — для power-users.

### Motion

- [ ] `@media (prefers-reduced-motion: reduce)` — глобальный override.
- [ ] Все decorative animations (FAB pulse, KPI fill, gantt arrow flow) — auto-disable через prefers-reduced.
- [ ] Functional animations (drag-drop confirmation, toast) — **сократить до 50ms**, не убирать совсем.

### ARIA / Семантика

- [ ] Все модалки — `role="dialog" aria-modal="true" aria-labelledby="..." aria-describedby="..."` где возможно.
- [ ] Dropdowns / context menus — `role="menu"` + items `role="menuitem"`.
- [ ] Status-cells / status-pills — `aria-label="Статус: <name>"`.
- [ ] Иконки-кнопки (✕, 📋, ↻, ⚙) — `aria-label="..."`.
- [ ] Tables — `<caption class="sr-only">` если нет видимого `h2` рядом.
- [ ] `<nav>` для sidebar (вместо просто `<aside>` или дополнительно с role).
- [ ] LLM streaming — `aria-live="polite"` на сообщениях ассистента.
- [ ] Live-region для бек-данных, изменяемых асинхронно (Pulse, Dashboard) — опционально, не делает hurt.

### Размер и плотность

- [ ] Минимум 32×32 на всех **главных** action-buttons (primary CTA в headers, FAB) — компромисс между admin-density и WCAG AA.
- [ ] Inline-edit cells — оставить 36px row, но **обязательно** tab/enter/escape behaviour одинаковый везде.
- [ ] Nav-item — увеличить до 44px height (сейчас ~40px) — это +1 строка кода, но closer to WCAG AA touch target.

---

## 5. Тестирование — что прогонять перед каждым релизом

| Что | Инструмент | Уровень |
|---|---|---|
| Контрастные пары | **axe DevTools** (Chrome ext, free) | Auto, в CI |
| Keyboard-only navigation | Manual: пройти все базовые сценарии без мыши | Manual, перед релизом |
| Screen-reader smoke | NVDA (Win) или VoiceOver (Mac) — открыть Дашборд / Реестр / Гант | Manual, раз в релиз |
| Reduced motion | Browser DevTools → Rendering → Emulate reduced motion | Manual, перед релизом |
| Zoom 200% reflow | Browser zoom in 2x — проверить layout не разваливается | Manual |
| Color blindness | **Stark** plugin (Figma/Chrome) или Chrome DevTools → Vision deficiencies | Auto/Manual |

---

## 6. Что **критично** в каждом из 3 направлений редизайна

### A. Calm Operator

**Главный риск**: тонкая типографика (regular weight, light colours) → **низкий контраст**.

**Контр-меры**:
- Body weight 400, но size минимум 13px (не меньше)
- `--text-secondary` (subdued) — должен оставаться 4.5:1 contrast
- Light theme: deep-grey текст на off-white — пройдено
- Dark theme: subtle gray text на navy — нужно протестировать

### B. Editorial Bold

**Главный риск**: bold colours, large headlines, mix sans+serif → **focus styles могут «потеряться»** в визуально насыщенной композиции.

**Контр-меры**:
- Focus-style должен быть **очень видим** (3px ring brand-500, не 2px)
- На coloured backgrounds — focus white + accent-shadow
- Подходит для headlines с tabular-nums; нужен testing на mobile-readers

### C. Workshop / Brutalist

**Главный риск**: плотные monospace, hard borders, no shadows → **screen-readers плохо разбирают densely-packed информацию**.

**Контр-меры**:
- Жёсткая semantic-разметка (h1/h2/h3, table caption, ul/ol)
- ARIA-labels на все compact mono-elements (например, status-codes типа `[01/12 LOADING]` нужен `aria-label="Loaded 1 of 12"`)
- Прямой контраст black-on-white упрощает screen-reader read-flow ✅

---

## 7. Сводная оценка (текущее состояние)

| Категория | Оценка | Комментарий |
|---|---|---|
| Контраст | **B** | Большинство пар — AAA, но `--text-4` fail для small text |
| Focus visibility | **C** | Есть, но непоследовательно; nav-items пропадают |
| Keyboard navigation | **B** | Базово работает; нет Cmd+K, нет focus-trap |
| Motion accessibility | **F** | Нет `prefers-reduced-motion` |
| ARIA semantic | **B-** | aria-live на toast; модалки и menus частично |
| Hit-target size | **C** | sm-buttons ниже AA (44×44) |
| Color independence | **B** | Status-цвета semantic, но нет fallback-icons на cells |
| Screen-reader compat | **C+** | Базово работает, но dynamic-content не announced |

**Средняя оценка**: **B-** — приемлемо для внутреннего инструмента 2024 года, но **значительно ниже** того, что должно быть для современного 2025-tier продукта.

---

## 8. Если а11y становится фокусом ремонта (отдельно от редизайна)

**Дешёвый набор improvements** (1-2 дня работы), который **поднимает оценку с B- до A-** без редизайна:

1. Глобальный `@media (prefers-reduced-motion: reduce)` — F → A в motion-категории.
2. Глобальный `:focus-visible` 2px ring — C → A в focus-категории.
3. ARIA на все модалки (5-7 штук) — B- → A в semantic.
4. `--text-4` поднять до контрастного значения — B → A в contrast.
5. `aria-label` на все icon-кнопки — добавит ~30 атрибутов в HTML, ~15 минут работы.

Эти 5 пунктов — **низкий риск, высокий эффект**, могут идти ортогонально любым другим планам.
