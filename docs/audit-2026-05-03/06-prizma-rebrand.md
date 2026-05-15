# Audit 06 — Призма Rebrand

**Авторы:** 6 экспертов — Brand Strategist, Senior Visual Designer, UX Lead + 3 user-персоны (Team Lead, Product Owner, Senior Developer).

---

## TL;DR — Brand decisions

1. **Имя «Призма» — утвердить**, кириллица первична
2. **Английская форма — «Prizma»** через Z (развести с Prisma ORM, Palo Alto Prisma Cloud)
3. **Метафора «один свет → много граней» — продуктовая, не маркетинговая** — реализуется в UX переключения views
4. **Sub-brands модулей по оптической логике:** Спектр (Реестр) / Плоскость (Планирование) / Обзор (Dashboard) / Грань (Канбан) / Ось (Гант) / Фокус (AI) / Луч (Сканнер)
5. **Сохранить «Луч» за Сканнером 2.0** — преемственность с текущей терминологией
6. **Палитра — 7 лучей радуги** + ночной синий как основа; indigo расширяется до `ray.*` namespace, не заменяется
7. **Logo направление: Triad** (треугольник + спектр), не «П»-monogram (latin lock-in проблема)
8. **Typography не трогаем** (Inter / SB Sans, JetBrains Mono для чисел)
9. **Spine-pill сохраняется** + extension через spectrum accent
10. **Pre-launch checklist:** проверка коллизий в Сбере + регистрация внутреннего бренда + гайдлайны до анонса

---

## A. Brand strategy

**Brand essence:** «Один план — все грани работы команды»

**Brand personality:**
1. **Прозрачный** — ничего не скрыто, всё видно под нужным углом
2. **Точный** — инженерная аккуратность, без размытости
3. **Многогранный** — один источник, множество ракурсов
4. **Спокойный** — не кричит, а структурирует
5. **Современный** — AI-native, без «корпоративной пыли»

**Tone of voice:** лаконичный, уважительный к времени тимлида. Без канцелярита («осуществить планирование» → «спланировать»). Без хайпа и эмодзи. Допускается лёгкая инженерная ирония в release notes.

**Brand promise:** «Видеть работу команды под любым углом — без переключения между десятком инструментов».

---

## B. Naming system

### Главное имя «Призма» — коннотации
- **Positive:** свет, ясность, наука, оптика, аккуратность, Pink Floyd / Dark Side (культурный якорь), школьная физика → знакомо всем
- **Neutral:** геометрия, кристалл, минералогия
- **Negative:** «призма власти/восприятия» (философский штамп), Adobe Prisma (фоторедактор), Palo Alto Prisma Cloud, Prisma ORM

### Sub-brands модулей

| Модуль | Brand Strategist предложил | UX Lead альтернатива | Финальная рекомендация |
|---|---|---|---|
| Реестр эпиков | **Спектр** | Призма Реестр | **Спектр** (приживётся, метафора чистая) |
| Гант | **Ось** | Призма Гант | **Ось** или сохранить «Гант» (technical familiarity) |
| Канбан | **Грань** | Призма Канбан | оставить «Канбан», sub-brand избыточен |
| Сканнер 2.0 | **Луч** | Призма Сканер | **Луч** (преемственность с Spotlight-метафорой) |
| AI-чат | **Фокус** | Призма AI | **Фокус** (метафора «собирает рассеянный свет в точку») |
| Dashboard | **Обзор** | Призма Дашборд | **Обзор** (менее манерно чем «Свет») |
| Квартальное планирование | **Плоскость** | Призма Поток | **Поток** или **Плоскость** (PO предпочёл «Поток» — capacity planning) |

**От PO:** Naming hierarchy критична — заложить с дня один: «Призма Реестр», «Призма Гант», «Призма Сканер». Иначе через год будут «СБОФ-2», «новый СБОФ».

---

## C. Visual identity

### Logo — 3 directions

**1. «Triad» (РЕКОМЕНДУЕТСЯ)** — треугольная призма, луч входит слева белым, выходит справа спектром. Equilateral triangle, weight 1.5px. Метафора: один поток → N use-cases. Adaptability: favicon = только треугольник 16×16; signature = mark + «Призма» Inter SemiBold; app-icon = треугольник на indigo-950 fill.

**2. «Aperture»** — hexagonal aperture (6 граней), каждая = slot для модуля. Метафора: призма как контейнер. Минус: теряет читаемость <24px.

**3. «Refract-P»** — буква «П» (П-rism), правая ножка расщеплена на 3 луча. Минус: latin lock-in (signatures, GitHub).

**Выбор: Triad** — масштабируется, метафора читается за 200ms, работает в 16px.

### Palette

**Primary anchors:**
- Сохраняется `--indigo-600 #4F46E5` (equity Spine-pill)
- Добавляется **Prism-Ink #0B0F1A** или **#0B1E3F** (ночной синий — фон, перед которым спектр читается)
- Сберовские elements (зелёный #21A038) — обязательны для PO-comfort, в `Призма Sber`-co-branding режиме

**Secondary spectrum (7 цветов = 7 use-cases):**

| Token | Hex (light) | Use-case |
|---|---|---|
| `ray.focus` | #4F46E5 | Активный фокус, primary actions |
| `ray.analytics` | #0EA5E9 | Аналитика, дашборды |
| `ray.register` | #14B8A6 | Реестр, данные |
| `ray.scanner` | #A855F7 | Сканнер, поиск |
| `ray.ai` | #F59E0B | AI / agents |
| `ray.signal` | #EF4444 | Errors, critical |
| `ray.calm` | #64748B | Inactive, archived |

**Naming:** `ray.фокуса`, `ray.аналитики`. **Каждый view = один dominant ray**, остальные mute до 12% opacity. Никакой rainbow-каши.

**Расширение:** при добавлении нового модуля — новый промежуточный оттенок (метафора масштабируется бесплатно).

### Typography
- **Stack:** Inter var + system fallback
- **Mono:** JetBrains Mono с `font-feature-settings: "tnum" 1, "zero" 1`
- **Wordmark:** единственное кастомное касание — засечка-«грань» в букве «р»
- Никаких variable weights ниже 400 в UI

### Iconography
- Line, 1.5px stroke, 24px grid, square caps, round joins
- **Refraction-themed accents** только для brand-уровня (logo, splash) — не для UI
- Sub-brand icons содержат микро-треугольник 4×4px в углу — visual signature
- Size scale: 12 / 16 / 20 / 24 / 32

### Motion identity
**Refraction motion:** входящий элемент сплошной → split на 2-3 цветных слоя с offset 4-8px → re-converge. Длительность 240-320ms, easing `cubic-bezier(0.2, 0.8, 0.2, 1)`.

- **Когда:** route transitions (раз за навигацию), AI-response reveal, splash
- **НЕ применять:** hover, focus, repeated lists. Reduced-motion → fade 120ms

---

## D. Application metaphor в UX

«Один свет → много граней» упаковывается так:

1. **Single source of truth:** план квартала = «входящий луч». Один объект, который Призма преломляет.
2. **Views = facets:** Гант, Канбан, Дашборд, Реестр — это не разные данные, а разные углы преломления одного плана. Переключатель view визуально оформлен как поворот призмы (микроанимация 200ms).
3. **Расширение:** при добавлении нового use-case (OKR-модуль) появляется новый «луч» нового цвета — и в onboarding, и в иконографии.
4. **AI Фокус** визуально «собирает» рассеянные лучи обратно в точку — обратное преломление = синтез контекста.

---

## E. User feedback (3 персоны)

### Тимлид
- **«Призма»** — сразу Adobe Prisma + школьная физика. Адекватно
- **«СБОФ»** — путаю с СБОЛ, СОФТ, СБП. Стыдно произносить с внешними партнёрами
- Pronunciation страх **есть** — закрепить один вариант (кириллица в чате)
- Объяснение коллеге: «Это Призма. План квартала по платформе — фичи, баги, ресурсы. Я смотрю как Gantt, PM-ка как kanban, финансы как табличку. Один источник, разные view»
- **Боюсь:** rebrand закрасит обложку без починки внутри
- Метафора лучей **понятна сразу**, школьная физика. **Не перегружайте маркетинг словами** «дисперсия задач по спектру приоритетов»

### Product Owner
- «Призма» работает на C-level — метафора «один свет → все грани» легко ложится в narrative «единый план — множество разрезов»
- System of record для quarterly planning, **не «инструмент тимлидов»**
- Tagline: «Призма. Видеть план целиком» — нужен активный глагол, иначе пассивно
- **Top-3 must-have от PO:**
  1. **Модульный naming** (Призма + Реестр/Гант/Сканер) с дня один
  2. **Disambiguation от Palo Alto Prisma** — латинская форма «Prizma», официальная позиция в comms
  3. **Dual-naming период минимум 1 квартал** — иначе срыв adoption

### Senior Developer
- **«Призма» > «СБОФ Планирование»** без вариантов
- Знаю про Prisma ORM, gugla collision будет, но **в рабочем контексте пофиг**
- **Call-name:** будут говорить «призма», писать «пр» в slug-ах. Если префикс задач — `PRZ` или `PRISM`
- **НЕ должно сломаться:** старые URL (301 redirect 12 мес), Bookmark-и, ссылки в Jira/Confluence/чатиках, search aliases, API эндпоинты, Cmd+ хоткеи, расположение кнопок
- **Не важно:** logo, цвета, animations
- **Важно:** скорость (<1с открытие), поиск (`/`→ввод→enter), связь с Jira двусторонняя, deep-link, keyboard shortcuts
- **Метафора лучей:** marketing-fluff. На лендинге для топов — ок. **Внутри продукта тултипы «разложите задачу на лучи!» — раздражает**

---

## F. UX Migration plan (6 месяцев)

### Phase 1 — Soft introduction (M1-M2)
- Имя «Призма» появляется в footer, splash screen, email-уведомлениях
- UI не меняется
- Цель: фонетическое привыкание у 109 тимлидов без cognitive load

### Phase 2 — Visual refresh (M3-M4)
- Logo (Triad: треугольная призма + спектр)
- Палитра (`ray.*` namespace + Prism-Ink)
- Favicon
- Spine-pill сохраняется, добавлен spectrum accent
- **Co-branding** «СБОФ Планирование v17 · Призма» 3 месяца минимум
- Pilot subgroup 10 чел тестирует за 2 недели до общего rollout

### Phase 3 — Full rebrand (M5-M6)
- URL-redirect `sbof.sber/*` → `prizma.sber/*` (301, 6 мес параллельно, лучше 12)
- Internal docs, Confluence, Jira project key
- Старое имя — только в changelog
- Bot-замена упоминаний в Confluence с пометкой «ранее СБОФ»

### Сохранить vs Переделать

| Элемент | Решение | Почему |
|---|---|---|
| Sidebar IA | **Сохранить структуру**, переименовать секции | 109 тимлидов в muscle memory; reorg = adoption killer |
| Spine-pill DS | **Keep + extend**: spectrum accent на active state | DS зрелая, ломать = регресс |
| Iconography | **Не заменять полностью**, refresh stroke + 5-7 brand-новых | Replacement = retraining 109 чел |
| URL | **Long redirect** (12 мес минимум) | Bookmark/links survival |

### Onboarding для existing users
**Однократный 4-step tour** при первом логине после Phase 2:
1. «Знакомьтесь — Призма» (logo reveal, 1 экран)
2. **«Ваши данные не изменились»** (показать знакомый dashboard) — главное сообщение
3. «Что нового: грани и лучи» (термины + tooltips)
4. «Что отметить: быстрее на 12%, новый focus mode» — celebrate

**Skip-кнопка обязательна. Tour ≤90 сек.**

### New brand-aligned features
- **«Найти грань»** = global search (Cmd+K) — ✓ метафора рабочая (только для hero-фич!)
- **Focus mode** = «Фокус луча» (не «Ослепить лучи» — негативная коннотация)
- **Не называть «Сохранить» → «Закристаллизовать»** — brand-имена только для 2-3 hero-фич, не для всех actions

---

## G. Risks

1. **Prisma ORM** — мировой бренд (prisma.io). Внутренний продукт Сбера → юр-конфликта нет, но при любой внешней публикации будет SEO-путаница. **Mitigation:** «Призма» кириллицей; англоязычная форма — **Prizma** через Z
2. **Palo Alto Prisma Cloud / Prisma Access** — узнаваемые в IT-аудитории Сбера. **Disambiguation:** «Sber Prizma» в латинской документации
3. **Коллизии в Сбере:** проверить SberWorks, Pulse, GigaChat, SberIDE через бренд-комитет до анонса
4. **152-ФЗ / compliance** — при работе с ПДн нужен апдейт ОРД и согласований ИБ. Юр. имя в реестре ПО Сбера менять — это 2-3 месяца
5. **Adoption friction** — Phased rollout + opt-in preview за 2 нед до Phase 2
6. **Performance regression** от новых assets — Budget: +0 KB JS, +15 KB CSS max
7. **Backward compat URLs** — 301 redirect 12 мес минимум
8. **Marketing съест продукт** — красивые слайды про «грани света», а баг с фильтром по спринту висит полгода. **Rebrand = повод починить, не закрасить**

---

## H. Top-15 brand decisions

1. **Имя «Призма»** утвердить, кириллица первична
2. **Английская форма Prizma** через Z
3. **Метафора реализуется в UX** (поворот призмы при view-switch), не как слоганы
4. **Sub-brands модулей** (Спектр/Ось/Грань/Фокус/Луч/Обзор/Поток)
5. **Сохранить «Луч»** за Сканнером 2.0
6. **Палитра — 7 лучей** + ночной синий, indigo extends to `ray.focus`
7. **Logo direction: Triad** (рекомендуется)
8. **Typography stays** (Inter / SB Sans / JetBrains Mono)
9. **Co-branding 3 мес минимум** «СБОФ · Призма»
10. **Pilot subgroup 10 чел** тестирует Phase 2 за 2 нед до общего
11. **Brand-имена только для 2-3 hero-фич** (поиск, фокус, dashboard)
12. **Iconography refresh, не replace**
13. **301 redirect 12 мес минимум**
14. **Tour ≤90 сек** + skip + акцент «ничего не сломалось»
15. **Pre-launch:** проверка коллизий в Сбере + регистрация внутр. ТЗ + гайдлайны (Figma+Notion) до анонса

---

## I. 5 must-have features при rebrand

1. **Global search «Найти грань»** (Cmd+K) — flagship feature, оправдывает rebrand
2. **Focus mode «Фокус луча»** — productivity win, celebrate в tour
3. **Spectrum theming** (light/dark/auto) — визуальная метафора призмы работает
4. **Migration banner** с changelog и feedback-каналом — снижает friction
5. **Legacy URL redirect + bookmark migration tool** — техническая необходимость, без неё adoption падает на 20-30%

**Итого:** evolution, не revolution. 109 пилотных тимлидов — слишком ценный feedback loop, чтобы рисковать radical redesign. **Призма = новый смысл поверх знакомой механики.**
