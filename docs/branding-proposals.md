# Призма — концепции бренда (DEPRECATED)

> ⚠️ **DEPRECATED** since 2026-05-03. Заказчик утвердил концепцию из
> [`my_prisma-brand/`](../my_prisma-brand/) (Northstar / 8-лучевая звезда / монохром).
> Этот документ — мой черновик из 22 вариантов от 10 дизайнеров (Saul Bass,
> Jony Ive, Лебедев и т.д.) — оставлен для исторического reference.
> Все варианты ниже **не имплементируются**.
>
> Single source of truth — [`my_prisma-brand/BRAND_BOOK.md`](../my_prisma-brand/BRAND_BOOK.md).
> План редизайна — [`design-audit/redesign-my-prisma/00-PLAN.md`](../design-audit/redesign-my-prisma/00-PLAN.md).

---

Десять дизайнеров (7 классиков + 3 молодых) — каждый по 2-3 концепции.
Метафоры разные: не только призма. Важно — что приложение делает: видеть
команду, замечать кто стоит, превращать хаос данных в ясный сигнал.

---

## 1. Saul Bass

**Стиль:** плоские силуэты, асимметрия, ограниченная палитра, ритм.

### 1.1 «Глаз / диафрагма»

Метафора: камера-обскура, плоский глаз, открывающийся взгляд.

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" fill="#1a1a1a"/>
  <circle cx="32" cy="32" r="22" fill="none" stroke="#f5e9d3" stroke-width="3"/>
  <path d="M32 14 L42 32 L32 50 L22 32 Z" fill="#e63946"/>
  <circle cx="32" cy="32" r="5" fill="#1a1a1a"/>
</svg>
```

- **Слоган:** «Видим команду насквозь.»
- **Палитра:** глубокий чёрный + кремовый + красный акцент.

### 1.2 «Семь полос»

Метафора: спектр / расслоение шума. Семь параллельных линий, разной длины.

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" fill="#0a1628"/>
  <rect x="10" y="14" width="44" height="3" fill="#ff6b6b"/>
  <rect x="10" y="20" width="36" height="3" fill="#ffd166"/>
  <rect x="10" y="26" width="48" height="3" fill="#06d6a0"/>
  <rect x="10" y="32" width="28" height="3" fill="#118ab2"/>
  <rect x="10" y="38" width="40" height="3" fill="#7c3aed"/>
  <rect x="10" y="44" width="32" height="3" fill="#ec4899"/>
  <rect x="10" y="50" width="44" height="3" fill="#f5e9d3"/>
</svg>
```

- **Слоган:** «Шум разложен по полкам.»
- **Палитра:** тёмно-синяя ночь + 7 акцентов спектра.

---

## 2. Jonathan Ive (Jony Ive)

**Стиль:** математическая геометрия, тонкие градиенты, обилие воздуха.

### 2.1 «Squircle с лучом»

Метафора: один луч — один взгляд внутрь.

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ive-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#e2e8f0"/>
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="52" height="52" rx="14" ry="14" fill="url(#ive-bg)" stroke="#cbd5e1" stroke-width="0.5"/>
  <line x1="20" y1="44" x2="44" y2="20" stroke="#1e293b" stroke-width="2" stroke-linecap="round"/>
  <circle cx="44" cy="20" r="2" fill="#1e293b"/>
</svg>
```

- **Слоган:** «Меньше шума. Больше команды.»
- **Палитра:** silver-grey, soft gradients.

### 2.2 «Капля света»

Метафора: одна точка фокуса в безграничном просторе.

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" fill="#fafafa"/>
  <defs>
    <radialGradient id="ive-glow" cx="50%" cy="40%" r="50%">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.9"/>
      <stop offset="60%" stop-color="#3b82f6" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="32" cy="28" r="22" fill="url(#ive-glow)"/>
  <circle cx="32" cy="28" r="3" fill="#1e3a8a"/>
</svg>
```

- **Слоган:** «Только важное.»
- **Палитра:** чистый белый + indigo soft-glow.

---

## 3. Артемий Лебедев (личный взгляд)

**Стиль:** провокация, типографика как лого, «не пытайтесь украсить».

### 3.1 «П.»

Метафора: одна буква, точка как сигнал «всё, дальше уже не надо».

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" fill="#fff"/>
  <text x="32" y="46" font-family="Georgia, serif" font-size="44" font-weight="900" text-anchor="middle" fill="#000">П</text>
  <circle cx="48" cy="46" r="3" fill="#e63946"/>
</svg>
```

- **Слоган:** «Призма. Чтобы было видно.»
- **Палитра:** монохром + один красный акцент-сигнал.

### 3.2 «Треугольник, который врёт»

Метафора: невозможный треугольник Пенроуза — данные обманчивы, но всё равно понятно.

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" fill="#fff"/>
  <path d="M32 12 L52 48 L12 48 Z" fill="none" stroke="#000" stroke-width="3" stroke-linejoin="miter"/>
  <path d="M32 22 L46 46 L22 46 Z" fill="#000"/>
  <path d="M22 46 L42 38" stroke="#fff" stroke-width="3"/>
</svg>
```

- **Слоган:** «Данные кривые. Картина прямая.»
- **Палитра:** чисто чёрно-белый.

---

## 4. Студия Артемия Лебедева

**Стиль:** профессиональная монограмма, харизматичная типографика, играет с буквами.

### 4.1 «П как трекер»

Метафора: буква П, в которой левая нога — это вертикальный таймлайн / бар-чарт.

```svg
<svg viewBox="0 0 120 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="120" height="64" fill="#fff"/>
  <rect x="14" y="14" width="6" height="36" fill="#1f2937"/>
  <rect x="14" y="14" width="32" height="6" fill="#1f2937"/>
  <rect x="40" y="14" width="6" height="36" fill="#1f2937"/>
  <!-- маленькие маркеры активности на левой ноге -->
  <rect x="9"  y="20" width="3" height="2" fill="#22c55e"/>
  <rect x="9"  y="26" width="3" height="2" fill="#f59e0b"/>
  <rect x="9"  y="32" width="3" height="2" fill="#ef4444"/>
  <rect x="9"  y="40" width="3" height="2" fill="#22c55e"/>
  <text x="58" y="44" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="600" fill="#1f2937">ризма</text>
</svg>
```

- **Слоган:** «Команда без догадок.»

### 4.2 «Лента команды»

Метафора: горизонтальная лента-таймлайн как подложка под wordmark — каждый человек = отрезок.

```svg
<svg viewBox="0 0 160 48" xmlns="http://www.w3.org/2000/svg">
  <rect width="160" height="48" fill="#fff"/>
  <text x="6" y="22" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="700" fill="#0f172a">ПРИЗМА</text>
  <!-- timeline-strip -->
  <rect x="6"   y="30" width="22" height="6" rx="1" fill="#22c55e"/>
  <rect x="30"  y="30" width="14" height="6" rx="1" fill="#f59e0b"/>
  <rect x="46"  y="30" width="34" height="6" rx="1" fill="#22c55e"/>
  <rect x="82"  y="30" width="10" height="6" rx="1" fill="#94a3b8"/>
  <rect x="94"  y="30" width="26" height="6" rx="1" fill="#22c55e"/>
  <rect x="122" y="30" width="8"  height="6" rx="1" fill="#ef4444"/>
  <rect x="132" y="30" width="22" height="6" rx="1" fill="#22c55e"/>
</svg>
```

- **Слоган:** «Видно по часам, не по слухам.»

---

## 5. Frog Design

**Стиль:** soft curves, organic-meets-digital, дружелюбный.

### 5.1 «Концентрические волны»

Метафора: рябь от события — каждая команда отзывается своей волной.

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" fill="#fff8f0"/>
  <circle cx="32" cy="34" r="6"  fill="none" stroke="#0ea5e9" stroke-width="2"/>
  <circle cx="32" cy="34" r="13" fill="none" stroke="#0ea5e9" stroke-width="1.5" opacity="0.7"/>
  <circle cx="32" cy="34" r="20" fill="none" stroke="#0ea5e9" stroke-width="1"   opacity="0.4"/>
  <circle cx="32" cy="34" r="3"  fill="#f97316"/>
</svg>
```

- **Слоган:** «Чувствуйте пульс команды.»
- **Палитра:** молочно-кремовый + sky-blue + mango.

### 5.2 «Лист-сенсор»

Метафора: тонкий лист, прожилки которого сходятся в точку — как сенсор тепла команды.

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" fill="#fff"/>
  <path d="M32 8 C 18 22, 14 40, 32 56 C 50 40, 46 22, 32 8 Z" fill="#10b981" opacity="0.18"/>
  <line x1="32" y1="14" x2="32" y2="50" stroke="#10b981" stroke-width="1.5"/>
  <line x1="32" y1="22" x2="22" y2="32" stroke="#10b981" stroke-width="1"/>
  <line x1="32" y1="22" x2="42" y2="32" stroke="#10b981" stroke-width="1"/>
  <line x1="32" y1="34" x2="20" y2="44" stroke="#10b981" stroke-width="1"/>
  <line x1="32" y1="34" x2="44" y2="44" stroke="#10b981" stroke-width="1"/>
  <circle cx="32" cy="50" r="3" fill="#059669"/>
</svg>
```

- **Слоган:** «Здоровье команды видно.»
- **Палитра:** emerald + cream.

---

## 6. MetaLab

**Стиль:** modern SaaS, гибкая геометрия, smooth gradients.

### 6.1 «Стек слайдов»

Метафора: 3 пластины — каждая своя метрика, наложенные параллаксом.

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ml-1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#a855f7"/><stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
    <linearGradient id="ml-2" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0ea5e9"/><stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>
    <linearGradient id="ml-3" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f59e0b"/><stop offset="100%" stop-color="#fbbf24"/>
    </linearGradient>
  </defs>
  <rect x="10" y="34" width="44" height="14" rx="3" fill="url(#ml-3)" opacity="0.95"/>
  <rect x="14" y="22" width="44" height="14" rx="3" fill="url(#ml-2)" opacity="0.95"/>
  <rect x="18" y="10" width="44" height="14" rx="3" fill="url(#ml-1)" opacity="0.95"/>
</svg>
```

- **Слоган:** «Все слои команды — за один клик.»

### 6.2 «Точка-капля»

Метафора: одна большая точка собирает в себе радиальный поток данных (squircle + trail).

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ml-d" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#22d3ee"/>
      <stop offset="100%" stop-color="#3b82f6"/>
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="52" height="52" rx="16" fill="#0f172a"/>
  <path d="M14 50 Q 32 30, 50 14" stroke="url(#ml-d)" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <circle cx="50" cy="14" r="4" fill="#22d3ee"/>
  <circle cx="40" cy="22" r="2" fill="#3b82f6" opacity="0.7"/>
  <circle cx="30" cy="32" r="1.5" fill="#3b82f6" opacity="0.5"/>
</svg>
```

- **Слоган:** «От события — к решению.»

---

## 7. Clay

**Стиль:** editorial, premium serif, sophisticated.

### 7.1 «Гримировальная маска / lens»

Метафора: классическая editorial-monocle, акцент на «видеть тонко».

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" fill="#1a1a1a"/>
  <circle cx="26" cy="32" r="14" fill="none" stroke="#d4af37" stroke-width="1.5"/>
  <line x1="36"  y1="42" x2="50" y2="56" stroke="#d4af37" stroke-width="1.5"/>
  <text x="26" y="36" font-family="Georgia, serif" font-size="14" font-style="italic" text-anchor="middle" fill="#d4af37">П</text>
</svg>
```

- **Слоган:** «Хороший взгляд на команду.»
- **Палитра:** черный + золото.

### 7.2 «Монограмма с серифным двоеточием»

Метафора: editorial-style — буква П с двоеточием как маркер «всегда есть продолжение».

```svg
<svg viewBox="0 0 160 48" xmlns="http://www.w3.org/2000/svg">
  <rect width="160" height="48" fill="#fafaf7"/>
  <text x="6"   y="34" font-family="Georgia, 'Playfair Display', serif" font-size="28" font-weight="500" letter-spacing="2" fill="#0d0a08">Призма</text>
  <text x="118" y="34" font-family="Georgia, serif" font-size="28" font-weight="700" fill="#a8783b">·</text>
  <text x="124" y="32" font-family="Georgia, serif" font-size="11" font-style="italic" fill="#5a4a3a">видеть команду</text>
</svg>
```

- **Слоган:** «Призма · видеть команду.»
- **Палитра:** off-white + ink + brass.

---

## 8. Молодой дизайнер 1 — **Maya Chen** (brutalism / type-first)

**Стиль:** monospace fonts, рубленые формы, единственный акцент.

### 8.1 «Bracket-cursor»

Метафора: команда как фрагмент кода — выделяемый, индексируемый, считываемый.

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" fill="#0a0a0a"/>
  <text x="10" y="42" font-family="ui-monospace, 'SF Mono', monospace" font-size="32" font-weight="800" fill="#f5f5f4">[</text>
  <text x="44" y="42" font-family="ui-monospace, 'SF Mono', monospace" font-size="32" font-weight="800" fill="#f5f5f4">]</text>
  <rect x="28" y="22" width="2" height="22" fill="#ff4500">
    <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/>
  </rect>
</svg>
```

- **Слоган:** `prisma_team --watch`
- **Палитра:** ink + paper-white + неоновый orange-cursor.

### 8.2 «ASCII-волна»

Метафора: dot-strip как мини-визуализация утра команды.

```svg
<svg viewBox="0 0 200 48" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="48" fill="#0a0a0a"/>
  <text x="6" y="32" font-family="ui-monospace, monospace" font-size="20" font-weight="700" fill="#f5f5f4">PRISMA</text>
  <text x="92" y="32" font-family="ui-monospace, monospace" font-size="20" fill="#22c55e">█</text>
  <text x="104" y="32" font-family="ui-monospace, monospace" font-size="20" fill="#22c55e">█</text>
  <text x="116" y="32" font-family="ui-monospace, monospace" font-size="20" fill="#f59e0b">▌</text>
  <text x="128" y="32" font-family="ui-monospace, monospace" font-size="20" fill="#22c55e">█</text>
  <text x="140" y="32" font-family="ui-monospace, monospace" font-size="20" fill="#94a3b8">·</text>
  <text x="152" y="32" font-family="ui-monospace, monospace" font-size="20" fill="#22c55e">█</text>
  <text x="164" y="32" font-family="ui-monospace, monospace" font-size="20" fill="#ef4444">█</text>
  <text x="176" y="32" font-family="ui-monospace, monospace" font-size="20" fill="#22c55e">█</text>
</svg>
```

- **Слоган:** «Команда. Декодирована.»

---

## 9. Молодой дизайнер 2 — **Tomás Reyes** (generative / soft-tech)

**Стиль:** generative geometry, smooth interpolation, mid-century palette.

### 9.1 «Орбита»

Метафора: люди как точки в орбите вокруг общей цели.

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" fill="#fef3c7"/>
  <ellipse cx="32" cy="32" rx="22" ry="10" fill="none" stroke="#92400e" stroke-width="1" opacity="0.5"/>
  <ellipse cx="32" cy="32" rx="22" ry="10" fill="none" stroke="#92400e" stroke-width="1" opacity="0.5" transform="rotate(60 32 32)"/>
  <ellipse cx="32" cy="32" rx="22" ry="10" fill="none" stroke="#92400e" stroke-width="1" opacity="0.5" transform="rotate(120 32 32)"/>
  <circle cx="32" cy="32" r="4" fill="#dc2626"/>
  <circle cx="54" cy="32" r="2" fill="#92400e"/>
  <circle cx="22" cy="14" r="2" fill="#92400e"/>
  <circle cx="22" cy="50" r="2" fill="#92400e"/>
  <circle cx="42" cy="50" r="2" fill="#92400e"/>
</svg>
```

- **Слоган:** «Орбита. Не хаос.»
- **Палитра:** mustard + crimson + ink.

### 9.2 «Радар-blip»

Метафора: классический радар, момент сканирования — sweep + единый blip.

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="rad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="#10b981" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#10b981" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" fill="#0c1f1c"/>
  <circle cx="32" cy="32" r="22" fill="none" stroke="#10b981" stroke-width="0.5" opacity="0.5"/>
  <circle cx="32" cy="32" r="14" fill="none" stroke="#10b981" stroke-width="0.5" opacity="0.5"/>
  <circle cx="32" cy="32" r="6"  fill="none" stroke="#10b981" stroke-width="0.5" opacity="0.5"/>
  <path d="M32 32 L 32 10 A 22 22 0 0 1 52 24 Z" fill="url(#rad)"/>
  <circle cx="44" cy="20" r="2" fill="#fef08a"/>
</svg>
```

- **Слоган:** «Сигнал найден.»
- **Палитра:** dark forest + lime + pale yellow.

---

## 10. Молодой дизайнер 3 — **Sasha Volkov** (post-soviet / honest)

**Стиль:** прямой, простой, вдохновлённый русским конструктивизмом + современной швейцарской школой.

### 10.1 «Семафор»

Метафора: три точки — стоп / внимание / движется. Прямой UX-перевод.

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" fill="#f4f1ec"/>
  <rect x="22" y="8" width="20" height="48" rx="4" fill="#1a1a1a"/>
  <circle cx="32" cy="20" r="5" fill="#ef4444"/>
  <circle cx="32" cy="32" r="5" fill="#facc15"/>
  <circle cx="32" cy="44" r="5" fill="#22c55e"/>
</svg>
```

- **Слоган:** «Кто стоит. Кто едет.»
- **Палитра:** kraft + signal-red + signal-amber + signal-green.

### 10.2 «Каркас»

Метафора: 4×4 grid — каждый сотрудник = ячейка, статус = заливка. Простая правда.

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" fill="#fff"/>
  <!-- 4×4 grid -->
  <rect x="8"  y="8"  width="11" height="11" fill="#22c55e"/>
  <rect x="22" y="8"  width="11" height="11" fill="#22c55e"/>
  <rect x="36" y="8"  width="11" height="11" fill="#facc15"/>
  <rect x="50" y="8"  width="11" height="11" fill="#22c55e"/>

  <rect x="8"  y="22" width="11" height="11" fill="#ef4444"/>
  <rect x="22" y="22" width="11" height="11" fill="#22c55e"/>
  <rect x="36" y="22" width="11" height="11" fill="#22c55e"/>
  <rect x="50" y="22" width="11" height="11" fill="#94a3b8"/>

  <rect x="8"  y="36" width="11" height="11" fill="#22c55e"/>
  <rect x="22" y="36" width="11" height="11" fill="#facc15"/>
  <rect x="36" y="36" width="11" height="11" fill="#22c55e"/>
  <rect x="50" y="36" width="11" height="11" fill="#22c55e"/>

  <rect x="8"  y="50" width="11" height="11" fill="#22c55e"/>
  <rect x="22" y="50" width="11" height="11" fill="#22c55e"/>
  <rect x="36" y="50" width="11" height="11" fill="#22c55e"/>
  <rect x="50" y="50" width="11" height="11" fill="#94a3b8"/>
</svg>
```

- **Слоган:** «16 человек. Одна клетка.»

---

## Сводная таблица — лучшее «по случаю»

| Случай | Кого взять | Почему |
|---|---|---|
| Внутрикорп Сбер, formal | Студия Лебедева 4.2 / Clay 7.2 | Профессиональная типографика, читается без объяснений |
| Молодой стартап, energetic | MetaLab 6.2 / Maya 8.2 | Современный SaaS-look, сразу узнаваем |
| Internal-tool с характером | Лебедев 3.1 / Sasha 10.1 | Минимум, ирония, нулевая претенциозность |
| Editorial / blog / talks | Saul Bass 1.1 / Tomás 9.2 | Запоминается, выделяется на конференциях |
| Print + 1-цветная печать | Лебедев 3.1 / Sasha 10.1 / Maya 8.1 | Надёжно работает в монохроме |

---

## Слоганы (короткий список)

| # | Слоган | Тон |
|---|---|---|
| 1 | Видим команду насквозь | прямой |
| 2 | Шум разложен по полкам | descriptive |
| 3 | Меньше шума. Больше команды. | iv'ish |
| 4 | Только важное. | minimalist |
| 5 | Чтобы было видно. | лебедев |
| 6 | Данные кривые. Картина прямая. | лебедев |
| 7 | Команда без догадок. | studio Лебедев |
| 8 | Видно по часам, не по слухам. | studio Лебедев |
| 9 | Чувствуйте пульс команды. | frog |
| 10 | Здоровье команды видно. | frog |
| 11 | Все слои команды — за один клик. | metalab |
| 12 | От события — к решению. | metalab |
| 13 | Хороший взгляд на команду. | clay |
| 14 | Призма · видеть команду. | clay |
| 15 | `prisma_team --watch` | tech-y |
| 16 | Команда. Декодирована. | brutalist |
| 17 | Орбита. Не хаос. | generative |
| 18 | Сигнал найден. | radar |
| 19 | Кто стоит. Кто едет. | post-soviet |
| 20 | 16 человек. Одна клетка. | constructivist |

---

## Рекомендация (мой выбор)

| Где | Что | Почему |
|---|---|---|
| **Лого / wordmark** | **Студия Лебедева 4.2** «Лента команды» — горизонтальный wordmark + строка-лента под ним | Узнаваемо за 0.3 сек, объясняет суть без слов |
| **Иконка / favicon (1 знак)** | **Sasha Volkov 10.1** «Семафор» 3 точки | Работает на 16×16, мгновенно понятен, ничей PR-CB не сломает |
| **Слоган-основной** | **«Видно по часам, не по слухам.»** (4.2) | Ровный ru, не смешной, передаёт суть SCANNER → 1:1 |
| **Slogan-tagline для релиз-нот** | **«Команда без догадок.»** (4.1) | Альтернатива для писем / changelog'ов |

Эту тройку рекомендую как baseline. Она работает и в Сбер-formal, и в pilot internal, и в release notes. Не нужно переключать стилистику между каналами.

---

**Дата:** 2026-05-03
**Статус:** черновик, для презентации тимлидам пилота
