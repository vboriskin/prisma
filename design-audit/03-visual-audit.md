# 03. Визуальный аудит / Art Director

> **Роль**: Art-director / визуальный дизайнер. Смотрю на интерфейс отдельно от его функциональности — что мы говорим формой, и почему это «ровно, аккуратно, но скучно».

## TL;DR

Продукт визуально находится на **«середине B2B-bell-curve»**: он не плохой, он **никакой**. Это интерфейс, который выглядит как **160 других admin-панелей** для корпоративных пользователей: indigo-акцент, gray gradient-free background, system-sans, тонкие тени, плотные таблицы, эмодзи вместо иконок.

Скука — не от уродства, а от **отсутствия позиции**. Продукт ничего не утверждает о себе.

---

## 1. Разбор по элементам — что делает интерфейс «аккуратным, но скучным»

### 1.1 Палитра

**Indigo `#4f46e5`** — это default-выбор Tailwind / Material / shadcn / Linear-tier продуктов. Когда бренд использует indigo — это **функционально, но не дифференцированно**. Глаз не цепляется ни за что.

| Что мы видим | Эффект |
|---|---|
| Индиго-акцент → серо-белый фон | «как все админки» |
| Status-цвета: emerald/amber/red — Tailwind defaults | Знакомо, безличностно |
| Тёмная тема — глубокий navy `#0b1020` | Это уже **интересно**, более характерно. Но в светлом варианте этой смелости нет. |
| **0 декоративных цветов** (вне service palette) | Нет момента, где «вау, это они» |

**Цветовая дисциплина**: всё через CSS-vars, semantic-named, accessibility-respecting → **+1 за инженерию**, но это на пользователя не влияет.

### 1.2 Типографика

**Inter** — самый «нейтральный» из современных sans-serif. Inter специально проектировался как «прозрачное» типо-решение, без характера. Это **сильный** выбор для функциональных интерфейсов и **слабый** — для брендового присутствия.

Иерархия по весу:
- 700 — почти все заголовки и важные числа (используется 195 раз)
- 600 — second tier
- **400 (regular) — только 6 раз!**

Это значит: **весь текст «давит»** уверенными 600-700 weights. Нет «спокойных» мест, где глаз отдыхает на regular-тексте.

Размеры: 10–14px доминируют. **Заголовков 20px+ практически нет** (кроме hero KPI 18px). Нет монументальных моментов, нет «больших цифр», нет editorial-моментов.

### 1.3 Радиусы

`4 / 8 / 12 / 16` — стандартный Tailwind/shadcn-tier. Все скругления **умеренные**. Нет острых углов (что было бы редакционно), нет очень больших (что было бы дружелюбно). Плотный middle-ground.

### 1.4 Тени

`xs / sm / normal / lg` — классическая SaaS-лесенка `0 1px 2px → 0 8px 32px`. Тени **тёмные нейтральные** (`rgba(0,0,0,.05-.12)`). Никакой цветной тени, никаких offset-shadows (как в neo-brutalism), никакого blur-glow. Тени **функциональные, не эмоциональные**.

### 1.5 Воздух (whitespace)

Padding в card 14-16px, между картами gap 12-20px (зависит от блока). Это **B2B-density**: эффективно для опытного пользователя, но **claustrophobic** для нового. Пустые места заполнены данными, не паузами.

Сравните: Linear, Notion, Stripe Dashboard — у всех есть «hero»-моменты с **большим воздухом** вокруг главного блока. Здесь нет ни одного такого момента.

### 1.6 Иконография

**Эмодзи**: 🔧 📊 ⚡ 📋 🔍 💡 🗺 💬 🔄 🚀 …

Эмодзи как icon-system имеют 3 проблемы:
1. **Брендинга нет** — эмодзи рисует Apple/Google, не вы.
2. **Стиль непредсказуем** — на разных платформах эмодзи разные (на Windows 10 они одни, на macOS — другие, на Telegram — третьи).
3. **Размер/выравнивание плавают** — emoji-glyph не line-up с текстом так же чисто, как icon-svg.

Решение через ограничение продукта: webfont-icons нельзя по policy. Но **локально вендорить SVG-иконки** в `libs/icons/` — реально (как сделано с `xlsx.full.min.js`).

### 1.7 Иллюстрации / декоративные элементы

**Их нет.** Empty-states — текст-заглушка. Loading-состояния — spinner или skeleton. Welcome / onboarding — модалки с текстом и кнопкой.

Это **самая дешёвая** вещь, которую можно добавить для «небаналит-эффекта» — даже одна-две иллюстрации в стратегических точках (welcome, empty registry, успешный import) меняют восприятие.

### 1.8 Layout-плотность

Sidebar 200px (фикс), topbar 56px (фикс), section-padding 16-20px. Это **компактный layout**. Нет ни sticky-CTA-блока, ни floating-context-panel — кроме LLM-FAB в правом нижнем.

В Linear, например, контент-зона **сужена** до ~900-1100px центральной колонки даже на широких мониторах — это даёт читабельность. Здесь контент растягивается на всю доступную ширину минус 200px sidebar.

### 1.9 «Аккуратно» — да. «Запоминающееся» — нет.

**Тест на дифференцированность** (мысленный эксперимент):
> Если убрать лого «СБОФ» в шапке и название «Планировщик», смог бы пользователь Сбера отличить этот UI от Jira / Asana / Monday / Notion?
> **Скорее нет.**

Это и есть «скучно» — отсутствие неповторимых визуальных решений.

---

## 2. Анализ контрастов и акцентов

| Уровень | Что есть | Оценка |
|---|---|---|
| **Primary action** | Indigo solid button + accent-light hover-bg | Достаточно контрастно |
| **Secondary action** | Outline button + accent-text | Норм, но visually слабее |
| **Status indicators** | Emerald/amber/red + light-bg + text | Достаточно дифференцированно |
| **Active state** | `--accent-light` (#eef2ff) — очень светлый | **Слабый сигнал** — нужно вглядываться |
| **Hover** | `--row-hover` (#f3f4f6) | Едва заметен на cool-grey фоне |
| **Disabled** | opacity .5-.6 | Стандартно |

**Главная проблема акцентов**: **active = hover = мягкая подсветка**. Глаз не различает «я сейчас на этом табе» vs «я навожусь на этот таб». Активное состояние должно быть **громче** — например, ярче border-left, или solid-fill, или цветная ring.

---

## 3. Ритм и иерархия

Здесь **самая большая визуальная проблема**.

В UI должна быть **иерархия трёх уровней**:
1. **Hero** — самый важный блок на странице, доминирует
2. **Body** — основной контент, средний вес
3. **Reference** — справочники, сноски, легкие

В текущем дашборде:
- KPI-grid (4 cards) — все одного веса
- Progress-grid (4 cards) — все одного веса
- Risks-panel (1 card) — того же веса, что KPI-cards
- Blocking-detail-card (1 card) — того же веса
- Release-breakdown (4 columns) — того же веса
- Teams-summary-wrap (1 card) — того же веса
- Dashboard-tables-grid (2 cards) — того же веса

= **15 «cards равного достоинства» на одном экране**.

Глаз не знает, куда смотреть в первую очередь. Это и есть «информационный плен».

---

## 4. Что нужно поменять, чтобы перестало быть скучным

### Уровень 1 — лёгкие, эффективные

1. **Сменить акцент** на что-то **не-indigo**. Кандидаты:
   - Тёплый orange/red (`#FF5722` / `#FF6B35` — энергичный, decision-oriented)
   - Холодный teal/cyan (`#0EA5A4` — clean tech)
   - Электрик-blue с зелёным undertone (`#0066FF` — confidence)
   - Брендовый зелёный Сбера (`#21A038`) — но он связан с retail-банкингом, может конфликтовать с identity

2. **Добавить «глубокий» background-цвет** для hero-блоков (не на всю страницу, точечно). Это даёт визуальный отдых от cool-grey всего остального.

3. **Увеличить weight contrast**: 800-900 для главных цифр + 400 для regular text. Сейчас всё «давит» 600-700.

### Уровень 2 — средняя глубина

4. **Сменить или дополнить шрифт**: сейчас Inter — fall-back. Добавить **дисплейный шрифт для главных цифр и заголовков**. См. `05-typography.md` за деталями.

5. **Custom иконки** (vendored SVG, не emoji). 30-40 SVG-иконок покроют 95% emoji-кейсов.

6. **Hero-блок на дашборде**: один большой блок «требует внимания сейчас» с явно бо́льшим воздухом, темнее/контрастнее фон, своя типография.

### Уровень 3 — характер

7. **Иллюстрации/арт** в empty-states, welcome, onboarding. 5-7 штук, custom (можно векторных, простых).

8. **Декоративные элементы**: 
   - Тонкие graphics-mark на дашборде (геометрия / текст в качестве орнамента / цветная плашка)
   - Hero-цвета (deep colors point-применённые)

9. **Motion-character** (см. `06-motion-and-microinteractions.md`): не «всё анимировано», а **сильные** моменты: drag-drop completed, save successful, deal closed.

---

## 5. Анализ против современных стандартов (2025)

| Тренд | Где сейчас | Где могло бы быть |
|---|---|---|
| **Bento-grid layouts** | Нет, всё — равноровные cards | Hero-блок + smaller secondary tiles |
| **Glassmorphism** | Только topbar (subtle blur 12px) | Контекстные overlays / modals — здесь точечно подходит |
| **Soft neo-brutalism** | Нет | Возможный путь для accent-блоков (мини-кнопки с offset-shadow) |
| **Editorial typography** | Нет — везде sans-serif | Mix sans + serif для headlines (даёт характер) |
| **Color depth** (deep colors как hero) | Нет — только cool-grey + indigo | Accent palette с deep navy / forest / merlot для hero-блоков |
| **Illustrations** | Нет | 5-10 custom SVG для key states |
| **Custom icons** | Эмодзи | Vendored SVG-set |
| **Micro-typography** (small caps, tabular nums) | Только tabular-nums в .cell-number | Использовать full feature-set Inter (variable weight, optical sizing) |
| **Subtle gradients** | Только лого `linear-gradient(135deg, var(--accent), #7c3aed)` | Точечно для hero-блоков |
| **Card-stack hover** (with elevation animation) | Минимально (`translateY(-1px)`) | Сильнее, как «карточка отлепляется от стола» |

---

## 6. Референсы для возможных направлений

> Описываю словами + ссылки. Группировка по 3 направлениям (детальнее — в `09-concepts.md`).

### A. «Editorial bold» — печатно-редакционное, с характером

> Большие headlines, mix sans+serif, точечный deep-color, strong type-hierarchy, illustrations.

1. **Linear app** — https://linear.app/ — bold typography, deep colours hero-блоков, subtle motion. Уже устоявшийся reference для product-tools.
2. **Stripe Press** — https://press.stripe.com/ — editorial layout, mix serif+sans, smart white-space.
3. **Pitch** — https://pitch.com/ — playful confident, color-rich.
4. **Things 3** (macOS app) — https://culturedcode.com/things/ — sparse, beautiful, but for serious tasks.
5. **Arc browser** (внутренние UI-моменты) — https://arc.net/ — bold colour application, character.

### B. «Calm tech / Spatial» — спокойный, осязаемый, технологичный

> Воздуха много, типографика тонкая, depth через shadow + colour, motion как опора.

1. **Notion** (главный workspace) — https://notion.so/ — minimal, clear hierarchy, белизна как сила.
2. **Raycast** — https://raycast.com/ — confident dark, focused single-purpose UI.
3. **Cron Calendar** (теперь Notion Calendar) — https://calendar.notion.so/ — hierarchical depth, soft motion, серьёзный тон.
4. **Height** (project-mgmt) — https://height.app/ — clean, plays with grid, спокойный.
5. **Vercel dashboard** — https://vercel.com/dashboard — minimal, but with character through detail.

### C. «Neo-brutalism / Confident industrial» — непугливый, явный, плотный

> Тяжёлые offset-shadows, монохром + 1 яркий цвет, моноширинные акценты, плотная сетка.

1. **Gumroad** (post-2023 redesign) — https://gumroad.com/ — bold colours, monospace accents, raw character.
2. **Brutalist Web Design** examples — https://brutalist-web.design/ — характер через намеренную «неэстетику».
3. **Internet Archive** — https://archive.org/ — функциональный, но запоминающийся.
4. **Hey email** — https://www.hey.com/ — opinion-led design, confident.
5. **Are.na** — https://www.are.na/ — minimal, archival, content-first.

### D. (бонус) «Dataviz-led» — продукт построен вокруг визуализации данных

1. **Datadog** — https://www.datadoghq.com/ — все экраны рассказывают историю через цвет графиков
2. **Grafana** (modern themes) — https://grafana.com/ — данные как hero, цвет как смысл
3. **Plot.ly** chart studio
4. **Observable HQ** — https://observablehq.com/ — типографика + dataviz + character

---

## 7. Что **сохранить** при редизайне

- **4-уровневая текст-иерархия** через `--text-1..4` — она работает, нужна и в новом UI.
- **Status-цвета (emerald/amber/red)** — semantically established, не нужно их «брендировать».
- **Темная тема** существует и неплохая.
- **Tabular-nums** в `.cell-number` — критично для сравнения чисел.
- **Compact rows** в реестре (36px) — нельзя увеличивать, иначе пользователь теряет birds-eye-view над массивом задач.

---

## 8. Резюме визуального аудита

**Текущий продукт** — уверенно сделанный «admin-tier» интерфейс. Аккуратный, систематичный, обслуживающий задачу. **Ноль брендового присутствия** и **ноль unique-моментов**.

**Что мешает быть запоминающимся** (приоритизировано):
1. **Default-tier акцент-цвет** (indigo) — не дифференцируется
2. **Plain Inter без display-pair** — нейтрально-функционально, без характера
3. **Все cards одного веса** — нет иерархии, глаз не направлен
4. **Эмодзи вместо иконок** — отсутствует пластика
5. **Нет иллюстраций** — emptiness не имеет character
6. **Анимация осторожная** — нет моментов «вау»
7. **Тёмная тема смелая, светлая — нет** — два разных продукта

**Что чинить в первую очередь** (high impact / low effort):
- Сменить акцент → не-indigo
- Усилить hero/body/ref hierarchy на дашборде
- Добавить bigger headline-typography (28-40px)
- Custom-иконки SVG vendored
- Hero-блок «что требует внимания» с deep-color background
