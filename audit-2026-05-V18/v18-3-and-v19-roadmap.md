# V18.3 + V19 Roadmap

**Дата:** 2026-05-02 (после V18.2 Scanner 2.0 graduation)
**Контекст:** V18.1 закрыта (Scanner 2.0 P1-P7 + Sprint 1-4 + pilot). Нужно зафиксировать что делаем дальше: V18.3 (immediate continuation) и V19 (structural backlog).

## Принцип организации

3 горизонта, разные обязательства:

```
V18.3 (~2-3 недели) ──► committed: завершение pilot follow-ups + V18 tail
V19.0 (~4-8 недель)  ──► roadmap: structural items, infrastructure
V20+ watchlist       ──► backlog: tracked но not committed
```

Items могут переезжать между горизонтами: V19 → V18.3 если становится острее, V18.3 → V19 если откладывается.

---

## V18.3 — Post-graduation continuation (committed)

**Цель:** закрыть pilot P2 finding'и + один tech-debt пункт V18 tail.

**Effort:** ~2-3 недели потоковой работы. Реалистично растянется на 4-5 недель параллельно фичам.

**Базис:** V18.2 production graduate (Scanner 2.0 v2, 649 unit / 18 contract).

### Block A — Scanner 2.0 P2 polish (5 пунктов из pilot Day-14)

| # | Что | Effort | Triggered by | Notes |
|---|---|---|---|---|
| **A1** | Per-team config layer (research-mode флаг, override dwell-thresholds через UI) | L | Olga (ML pilot 5/10) | Решает false-positive для research-команд. Включает: per-team JSON config в `cfg.scannerTeams[pk]`, settings-modal расширение для UI editing, presets («research» / «hotfix» / «default»). Без этого ML-команды останутся за бортом. |
| **A2** | Zephyr Created vs Executed split (heatmap row + events feed) | S | Ilia (QA pilot) | Сейчас `zephyrTestsCreatedRecent + zephyrTestsExecutedRecent` сливаются в один row Z. Семантически разные: create = QA пишет план, execute = регрессия идёт. Split на 2 sub-rows ИЛИ разный bullet/dot в feed. |
| **A3** | «Ready for QA» dwell-threshold | XS | Ilia (QA pilot) | Расширить `pickDwellThreshold` regex'ом `/ready\s+for\s+qa\|готов(а\|о)?\s+к\s+QA/` → 16ч (тот же порог что `qa`). 30 минут работы. |
| **A4** | Share-link на конкретного человека (для async-команд) | S | Maksim (Platform pilot) | URL hash `#scanner2/employee/<key>`. Auto-open detail panel при загрузке. Кнопка «🔗 Share» в panel header. Для TG/Slack-пингов. |
| **A5** | Anchor jump + click-to-filter в team-glance + multi-team | S | Anna (PO pilot) | Click по «5 движется» → scroll к группе. Click по team-row в multi-view → реальный фильтр participants по pk (сейчас просто toggle вида). |

### Block B — V18 tail (1 пункт из 5 deferred)

V18.1 P9-P10 закрыли частично декомпозицию app.js и server.js. Block C (P11), D (P12-P13), E (P14-P15) откладывались под V18.2/V18.3 разные итерации. Беру **один** пункт под V18.3 — самый очевидный.

| # | Что | Effort | Impact | Notes |
|---|---|---|---|---|
| **B1 (= ex-P11)** | `views/gantt.js` 2637 LOC → разбить на `views/gantt/{render,ctxMenu,dnd,history}.js` | L | High | Самый большой view, читабельность критична. Был отложен под «свежую сессию для careful split». Делается 1-2 рабочих дня. |

**Не входят в V18.3** (остаются V19+):
- ex-P12 `testRunner.js retire` — большой проект (~104 теста миграция), отдельная итерация.
- ex-P13 `coverage expansion` — естественно растёт с features, не самостоятельная цель.
- ex-P14 `structured logging` — нужна инфраструктура (ELK / Sentry), пока нет.
- ex-P15 `styles.css cleanup` (11k LOC) — большой риск visual regression, нужен Percy/snapshot test'ы заранее.

### V18.3 — DoD

- All A1-A5 закрыты.
- B1 (gantt split) завершён, app continues работать без regression в Gantt-view.
- Tests: ≥649 unit + 18 contract / 0 fail (без откатов).
- Документация: `audit-2026-05-V18/v18-3-MASTER_PLAN.md` (создаётся в начале) + per-item audit-md.
- Pilot Olga (ML) перепроверка после A1: would-use-daily verdict ≥ 7/10.

### V18.3 — phase order

Suggested:
1. **A3** (XS, 30 мин) — quick win, закрытие QA-find'инга.
2. **A2** (S) — closely related to A3.
3. **A4** (S) — independent, async-team value.
4. **A5** (S) — UX polish.
5. **B1** (L) — gantt split, требует свежая сессия.
6. **A1** (L) — per-team config, biggest, needs careful design.

Если время поджимает — A3+A2+B1 минимум, остальное в V19.

---

## V19.0 — Structural roadmap (4-8 недель)

**Цель:** структурный долг + инфраструктура. Не committed как V18.3, но ranked + scoped.

### Block C — Scanner 2.0 V19 follow-ups (5 items)

| # | Что | Effort | Origin | Rationale |
|---|---|---|---|---|
| **C1** | Sprint Goal через Story Points | M | Anna (PO pilot) | Сейчас fallback на `count(done)/count(total)`. PO попросит когда SP-фоле настроены везде. Нужна field-discovery (custom field id) per Jira instance. |
| **C2** | Persistent retention (history past 30 min) | L | Anna + Dmitry | Нужно для retro «cycle-time квартал», тренд «спринт N vs N-1» (sprint-level, не day-level как S4.2). Требует storage choice (SQLite-WASM на client'е? Server LiteFS?). |
| **C3** | Heatmap virtualization (200+ чел) | M | Tech panel | 50→200 чел = 9600 SPAN'ов. IntersectionObserver-driven render. До тех пор current — OK. |
| **C4** | Telemetry / usage analytics | M | Tech + PO | Нет инфраструктуры в проекте. Можно начать с lightweight: log usage events в server-side log + ELK позже. Без этого не понятно как используется v2.0. |
| **C5** | Hard delete v1 PortfolioPulse | S | V18.4 anyway | Условия: ≥4 недели в production без regressions, telemetry ≤5% юзеров на legacy subtab. Удаление 5 файлов + ~300 LOC из `integrationsView.js`. |

### Block D — Originally V18-deferred (12 items from MASTER_PLAN B1-B12)

Эти 12 пунктов были зафиксированы в V18 MASTER_PLAN как «отложено в V19+». Перенесены without re-scoping.

| # | Что | Effort | Why now? |
|---|---|---|---|
| **D1** | DTO-схемы между frontend ↔ server | M | Preventive — нет regressions, но contract-tests проверяют только shape; с DTO-схемой у нас будет typed validation. |
| **D2** | `state.rows[i]` терминологический долг (epic/task/row) | L | Cosmetic, не блокирует работу. Если делать — отдельный sprint, осторожно. |
| **D3** | Pulse pipeline 5-файловый объединить в `integrations/pulse/index.js` фасад | S | Чисто после `integrations/README.md` documenting. Естественная следующая итерация. |
| **D4** | Visual regression tests (CSS snapshots / Percy) | L | Нужно перед B1 (gantt split V18.3) и тяжёлым D6 (styles.css cleanup) — иначе никак не отслеживать regression. P0 если делаем D6/B1. |
| **D5** | Migration telemetry для localStorage versions | S | После C4 (telemetry) — естественный sub-step. |
| **D6 (= ex-P15)** | `styles.css` 11k LOC + 433KB → audit dead-code (V15 leftovers) + split на `styles/{base,views,integrations,onboarding}.css` через `<link>` теги | L | V18 deferred. Нужен D4 first. |
| **D7** | Sigma fields миграция в отдельный `sigma_config.json` | M | Breaking change без триггера. Подождать пока кто-то жалоба. |
| **D8** | `gantt2*` migration cleanup | S | После 12+ месяцев в проде, уже почти. |
| **D9** | `_ppFindByPartial` retire дата | XS | Через 6 месяцев от V17.2 — пора, но low impact. |
| **D10** | Demo-mode lifecycle FSM | M | Если ещё всплывёт — пока не всплыл. |
| **D11** | Onboarding fragmentation (24-step + CEO tour два engine'а) | L | Большой DX-проект, отдельная итерация V19.x. |
| **D12** | Shared fixture library (помимо jiraPulseResponse) | M | Естественно вырастёт в P12 (testRunner retire) если делаем. |

### Block E — Infrastructure / Ops (4 items)

Вышло из обсуждений Sprint 1-4 как «accepted risk» без явного backlog'а:

| # | Что | Effort | Notes |
|---|---|---|---|
| **E1** | RBAC между командами для drill-down | L | Currently corp perimeter защищает (anyone with server access имеет full Jira-token visibility). Если когда-то v2.0 уйдёт за внешний reverse-proxy — обязательно. |
| **E2** | Mobile responsive (<720px) | M | Internal tool, desktop-only assumption. Если CEO попросит «можно с iPad'а» — надо. |
| **E3** | testRunner.js legacy retire (= ex-P12) | L | ~104 unit-теста миграция в `tests/unit/*.test.js`. После — удалить testRunner.js (~900 LOC). Самостоятельная итерация. |
| **E4** | Structured logging on server (= ex-P14) | M | log levels (debug/info/warn/error) + log rotation + JSON output. Нужна для C4 (telemetry). |

### V19.0 — DoD

V19 — открытый roadmap, не атомарная итерация. DoD per-block:
- C-блок: после V18.3 + 4 недель prod monitoring v2.0.
- D-блок: ranked, выполняем по необходимости (D4 = unlock для D6/B1; D3 = после documentation; etc.).
- E-блок: реактивно (если кто-то попросит).

---

## V20+ Watchlist (tracked but uncommitted)

Items to watch, but no scheduled work:

| # | Что | Trigger |
|---|---|---|
| W1 | Push-уведомления о blockers (v2.0) | Если ≥3 пользователей попросят — вернуть в V19 как F-блок |
| W2 | Slack/MS-Teams integration | Если CEO попросит, или Slack-bot стандарт в компании |
| W3 | AI-assistant интеграция со Сканнером (chat → «кто застрял в Backend?») | После C4 telemetry — может оказаться natural follow-up |
| W4 | Per-employee personal-view (employee видит сам себя без shared screens) | Если HR попросит — privacy-first feature |
| W5 | Sprint-velocity prediction (если N тасков done, expected end of sprint) | Если PO попросит после C2 (persistent retention) |
| W6 | Multi-tenancy / multi-product (Сканнер для двух разных продуктов) | Если другой продукт захочет переиспользовать |
| W7 | Custom plugin SDK для расширений Сканнера | После 6 месяцев в проде, если accumulated patterns показывают reusable code |

---

## Sprint structure proposal — V18.3

V18.3 = ~5 спринтов по A/B-блокам. Realistic timeline:

| Sprint | Items | Effort | Cumulative tests |
|---|---|---|---|
| V18.3-S1 | A3 + A2 + A4 | XS+S+S = ~6-8ч | +5 unit |
| V18.3-S2 | A5 + A1 (start) | S+L = ~10-12ч | +8 unit |
| V18.3-S3 | A1 (finish) | L | +5 unit |
| V18.3-S4 | B1 (gantt split) | L | +0-5 unit |
| V18.3-S5 | Audit + ADR + close V18.3 | S | — |

**Total: ~30-40 рабочих часов = 1-1.5 недели concentrated, или 3-4 недели в потоке.**

---

## Decision-tree для приоритизации

**«Что делать первым после V18.2 deploy?»**

```
Olga ML feedback после Sprint 4? ────► YES, all'right ───► A1 first (per-team config)
                              │
                              └─► NO, ML team OK as-is ──► A3+A2 first (QA polish)

Big Q1 release coming? ──► YES ─► B1 (gantt split) приоритет
                       └─► NO  ─► A-блок целиком

Need V19 telemetry urgently? ──► YES ─► C4 в V18.3 как extra
                              └─► NO  ─► defer to V19 как planned
```

Default-recommendation: **A3 + A2 + B1** (3 closeable items за 1 неделю), потом A1 как S2.

---

## Open questions для V18.3 kickoff

1. **A1 per-team config — UI или config-file only?**
   - UI = совместимо с jira_config.json approach (текущий settings-modal).
   - Config-file only = быстрее (~2ч), но пользователи не любят редактировать JSON.
   - **Рекомендация:** UI с JSON fallback. ~6-8ч effort.

2. **B1 gantt split — какие 4 файла?**
   - Текущая декомпозиция: `views/gantt/{render,ctxMenu,dnd,history}.js`. Spec в P11 audit-md (V18 P11) — но он не написан, отложено.
   - Нужна свежая 30-минутная разведка перед split'ом, чтобы понять реальные boundary'и.

3. **Pilot follow-up Olga — когда?**
   - После A1 (per-team config) — она самый явный stakeholder.
   - Если задержка >2 недели — Olga может уйти от инструмента совсем.

4. **D4 (visual regression) — sequencing с B1/D6?**
   - D4 — обязательный pre-requisite для **safe** B1 (gantt split) и D6 (styles.css cleanup).
   - Или принимаем риск visual regression и делаем без D4? Pre-pilot v18.2 не было таких тестов.
   - **Рекомендация:** для B1 — manual smoke OK (gantt isolated view). Для D6 — D4 обязателен.

---

## Cross-reference

- V18.2 graduation: [`scanner2-graduation.md`](./scanner2-graduation.md)
- V18.1 P7 retro: [`scanner2-pilot-feedback.md`](./scanner2-pilot-feedback.md)
- Original V18 plan (block C/D/E deferred): [`MASTER_PLAN.md`](./MASTER_PLAN.md)
- Operations doc: [`../docs/integrations/team-scanner-v2.md`](../docs/integrations/team-scanner-v2.md)

---

## Кто owner'ит V18.3 / V19?

- **V18.3 А-блок** (Scanner 2.0 polish) — pilot stakeholders как stakeholders продолжают: Anna PO, Dmitry, Ilia, Olga, Maksim.
- **V18.3 B-блок** (gantt split) — нужна review от team-lead'а кто реально пишет в gantt.js. Без этого — accepted-risk merge.
- **V19** — без формального owner'ства, реактивно.
