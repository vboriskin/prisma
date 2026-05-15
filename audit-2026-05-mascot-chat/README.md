# Аудит: Маскот Обсидиан + Чат + Кодовая база

> Серия из 13 экспертных аудитов после интеграции маскота Обсидиан в продукт Призма.
> Дата: 2026-05-07.

## Состав команды

- **Чат — 5 экспертов**: senior LLM-инженер, performance engineer, UX-дизайнер, full-stack engineer (sections × actions × integrations), product strategist.
- **Кодовая база — 5 экспертов**: defects/optimisation reviewer, performance engineer, UX/brandbook auditor, product strategist, **screen-jump root-cause specialist** (отдельный анализ «дёргания» при кликах).
- **Дизайн / арт-дирекция — 3 эксперта**: senior product designer (vs reference screenshots), art-director (brandbook + verdict), motion-designer (Tier-stacking, particles, hibernate).

## Оглавление

### Чат (5 файлов)
- [chat-01-llm-prompts-streaming.md](./chat-01-llm-prompts-streaming.md) — prompt-injection, streaming robustness, OAuth retry. **13 находок (1 CRIT, 4 HIGH, 5 MED, 4 LOW)**
- [chat-02-performance.md](./chat-02-performance.md) — render perf, memory, debounce. **12 находок (2 HIGH, 3 MED, 7 LOW/OK)**
- [chat-03-ux-visual.md](./chat-03-ux-visual.md) — empty/loading/error states, mobile, a11y, brandbook. **20 находок**
- [chat-04-sections-actions.md](./chat-04-sections-actions.md) — взаимодействие со вкладками + **Чат × Интеграции** (отдельный раздел) + 5 product-предложений
- [chat-05-improvements.md](./chat-05-improvements.md) — топ-10 product improvements, multi-turn, proactive suggestions, 3 tool-use, onboarding tour, voice, slash-commands

### Кодовая база (5 файлов)
- [codebase-01-defects.md](./codebase-01-defects.md) — defects + optimisation. **1 CRIT + 3 HIGH + 5 MED + 3 LOW**
- [codebase-02-performance.md](./codebase-02-performance.md) — Registry без виртуализации (5k rows = 1.5с jank), xlsx sync на boot. **2 CRIT + 3 HIGH + 4 MED + 4 LOW**
- [codebase-03-ux-visual-brandbook.md](./codebase-03-ux-visual-brandbook.md) — 28 нарушений §3.3/§11/§12. **2 CRIT + 9 HIGH + 10 MED**
- [codebase-04-improvements.md](./codebase-04-improvements.md) — топ-15 product improvements, architecture bottlenecks, SQLite migration plan
- [codebase-05-screen-jump.md](./codebase-05-screen-jump.md) — **«экран дёргается»** — root cause + топ-3 фикса дают 80% эффекта

### Дизайн / арт-дирекция (3 файла)
- [design-01-product-designer.md](./design-01-product-designer.md) — сравнение с reference screenshots. Главное расхождение: **per-message avatar в чате, а не один в шапке**; toast/error без маскота; onboarding tour без ls-move
- [design-02-art-director.md](./design-02-art-director.md) — brandbook §13.10 compliance чек-лист + **verdict: «требуется 3 правки» (M1 emerge guard, M3 error→breathe, M2 curious jank)**
- [design-03-motion-choreography.md](./design-03-motion-choreography.md) — **Tier 3+2 stacking сломан** (CRIT-fix есть код), particles missing, hibernate-trigger не реализован

---

## TL;DR — Топ-15 фикс-приоритетов через все аудиты

### Сразу (CRIT)
1. **screen-jump #1** ([codebase-05](./codebase-05-screen-jump.md)): `html { scrollbar-gutter: stable }` — одна строка, 80% жалоб «дёргается». **S effort, CRIT impact.**
2. **F1** ([codebase-01](./codebase-01-defects.md)): mass-mutations в `dataStore.normalizeAssignees`/`batchRiskRecompute` без `Reactive.silent()`. **CRIT.**
3. **L1** ([chat-01](./chat-01-llm-prompts-streaming.md)): `trimApiHistory(20)` интерпретирует 20 как **token budget** (~70 символов) — вся беседа выкидывается. **CRIT.**
4. **G1** ([codebase-03](./codebase-03-ux-visual-brandbook.md)): rainbow gradient `linear-gradient(red→amber→green)` в `.ai-quality-bar-fill` — нарушение §3.3. **CRIT brandbook.**
5. **P1** ([codebase-02](./codebase-02-performance.md)): registry без виртуализации — 5k rows = 1.5с blocking. **CRIT.**
6. **M1** ([design-03](./design-03-motion-choreography.md)): Tier 3+2 stacking сломан — Breathe пропадает на hover/streaming. **CRIT brandbook §13.9.**
7. **A** ([design-01](./design-01-product-designer.md)): per-message avatar в чате (главное расхождение с reference). **CRIT UX.**

### Скоро (HIGH)
8. **P3** ([codebase-02](./codebase-02-performance.md)): xlsx sync на boot ~952KB → +300-800ms до интерактива.
9. **C2** ([chat-03](./chat-03-ux-visual.md)): «Новый» очищает чат БЕЗ confirm. **HIGH UX**.
10. **C3** ([chat-03](./chat-03-ux-visual.md)): sticky auto-scroll ломает чтение длинных ответов.
11. **L2** ([chat-01](./chat-01-llm-prompts-streaming.md)): payload вставляется сырым `JSON.stringify` без anti-inject в legacy path. **HIGH security**.
12. **screen-jump #2** ([codebase-05](./codebase-05-screen-jump.md)): `animateSection()` бьёт «волну» на каждый refreshAll вместо смены секции.
13. **D** ([design-01](./design-01-product-designer.md)): Toast/Error без маскота — нужно `Toast.show({ mascot:'concerned' })`.
14. **M3** ([design-03](./design-03-motion-choreography.md)): `setChatPhase('error')` возвращает в Concerned (не loop) → маскот «застывает». §13.10 п.5.
15. **M7** ([design-03](./design-03-motion-choreography.md)): particles в ls-streaming отсутствуют (нет `obs-emit-*` в SVG sprite) — §13.6 не выполнен.

---

## Что уже сделано по интеграции маскота

✅ Sprite инлайн в `<body>`, CSS подключён  
✅ FAB 56×56 в правом нижнем углу с `obs obs--breathe`  
✅ Emerge once per session (`sessionStorage`)  
✅ Hover на FAB → Curious; leave → Breathe  
✅ Click → открывает чат, FAB скрывается  
✅ Avatar 32×32 в шапке чата  
✅ Chat phases подключены: thinking/streaming/complete/stop/error/tool  
✅ При закрытом чате на stream-end вызывается `pulseAlertOnFab`  
✅ Reduced-motion работает  
✅ Светлая/тёмная тема через `--obs-body`/`--obs-feature`  
✅ Все 1021/1021 unit-тестов pass

## Изменённые файлы по интеграции маскота

- `index.html` — link на obsidian.css, инлайн sprite, FAB → маскот, аватар в шапке чата
- `styles.css` — `.assistant-fab` 56×56 transparent + `.assistant-fab-mascot` + `.assistant-chat-avatar` 32×32
- `app.js` — импорт + init `ObsidianMascot`
- `app/obsidianMascot.js` — **новый** контроллер
- `app/llmAssistant.js` — wired chat phases при send/delta/complete/stop/error
- `obsidian/obsidian.css` + `obsidian/obsidian-sprite.svg` — скопированы в `prisma_new_design_v2/obsidian/`

## Что нужно доработать перед production-выкаткой

Согласно **art-director verdict** ([design-02](./design-02-art-director.md)):
- **M1**: Emerge guard / interaction lock на 2.4с
- **M3**: `setChatPhase('error')` → возвращать в Breathe, не Concerned
- **M2**: Curious end-state jump на mouseleave

Дополнительно по **motion-чека** ([design-03](./design-03-motion-choreography.md)):
- **Tier 3+2 stacking fix** — переписать `_clearStates` через `EXCLUSIVE_CLASSES` / `AMBIENT_CLASSES` сплит (код-fix готов в файле)

Per-message avatar в чате ([design-01](./design-01-product-designer.md)) — **самое важное расхождение с reference**, требует переработки `chatUIRenderer.js` + новый CSS-блок (готовый набросок в файле).
