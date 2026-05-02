# Сканнер команд v2.0 — graduation ADR

**Дата:** 2026-05-02
**Versions:** V18.1 P1-P7 → V18.2 production
**Tests:** 645 unit / 18 contract / 0 fail
**Эпохи:** P1 (scaffold) → P2 (groups) → P3 (enrichment) → P4 (server endpoint) → P5 (side-panel) → P6 (soft retirement v1) → P7 (pre-release audit + 3 sprints)

## Решение

«Сканнер команд 2.0» (subtab `scanner2`, отдельный orchestrator + renderer + enrichment) graduate из preview-режима в production. v1 PortfolioPulse (subtab `pulse`) сохранён как `[legacy]` fallback.

## Контекст

Pre-V18.1 «Сканнер команд» = v1 PortfolioPulse, ~5300 LOC, 1374 LOC только в renderer'е. Получил критику от 4-панельной expert team (HR/manager/тимлид/SM/PO/full-stack/art-director/designer):

1. Лента активности вместо доски тимлида.
2. Эмодзи как data-индикаторы, противоречит V15 Spine-pill.
3. 11+ карточек со свёрнутыми `<details>` — не сканируется за 30 сек.
4. Нет Sprint Goal Progress (главный сигнал PO).
5. Нет дифференциальных порогов dwell — Code Review tail невидим.
6. Filled-bg badges конфликтуют со Spine-pill stripe-left.
7. Watchdog-vкус: «Активность за минуты», нули как обвинение.

Вместо полного рефактора v1 (рискованно — 1374 LOC живой кодовой базы) команда выбрала **co-existence стратегию**: новый subtab `scanner2` с чистого листа, изолированный namespace `.ts2-*`, отдельные файлы. После стабилизации — soft-retirement v1.

## Что построено (P1-P7)

### Phase 1 (V18.1 P1-P6, ~17 commits) — initial implementation

| P | Что | Commit |
|---|---|---|
| P1 | Subtab + scaffold + per-person rows + dot-strips | `2daecbc` |
| P2 | Группы Стоп / Под наблюдением / Движется / Idle + classifier | `4ba5301` |
| P3 | Enrichment data-layer: heatmap, contextSwitches, blockers, timeline72h | `e9e60c5` |
| P4 | Server endpoint `POST /portfolio-pulse/employee-detail` + lazy drill-down | `bcf5514` |
| P5 | Slide-in side-panel 480px + heatmap 72×4 + sparkline + filters | `8ab8ac4` |
| P6 | Graduate v2 → default subtab; v1 → `[legacy]` pill (soft retire) | `52f9dfb` |
| Hotfix | `jiraProjectKeys` в orchestrator (читал не то поле из localStorage) | `5d6e8f1` |
| Hotfix | Unified timeline + Confluence info visible (P3 missed) | `bef22b1` |

После P6 — independent expert review (4 panels: people, process, tech+perf, visual+QA+a11y).

### Phase 2 (V18.1 P7, 18 commits) — pre-release audit + 3 sprints

**Sprint 1 — 6 P0 critical fixes (1 неделя):**

| S | Fix | Commit |
|---|---|---|
| S1.1 | `_escHandler` orphan unmount + IntegrationsView hook | `f70476c` |
| S1.2 | `/employee-detail` rate-limit (30 req/min) + result cache (5 min TTL) | `a8c8d48` |
| S1.3 | Reviewer-heavy роли больше не выпадают в idle | `a2f844c` |
| S1.4 | Кликабельные issue.key (Jira /browse, BB url, CF url) | `97c438e` |
| S1.5 | Keyboard activation rows (Enter/Space) — WCAG 2.1.1 | `909eaaf` |
| S1.6 | `aria-pressed` на filter-pills — WCAG 4.1.2 | `909eaaf` |

**Sprint 2 — 6 P1 operational signals (~1.5 недели):**

| S | Fix | Commit |
|---|---|---|
| S2.1 | Sprint Goal Progress gauge в topbar (#1 синтез-плана) | `ef0a334` |
| S2.1.5 | Out-of-sprint + Orphan-risks shelf (#6, #7) | `f3d6930` |
| S2.2 | Differential dwell-thresholds (CR>8 / QA>16 / IP>48) | `57326c7` |
| S2.3 | TZ-aware heatmap (browser tzOffsetMin → server) | `ab6d1d2` |
| S2.4 | Partial re-render для filter-click (~150мс → ~30мс) | `875a0a5` |
| S2.5 | Removed sparkline (1:1 dup heatmap.colTotals) → peak hint | `393d0cf` |

**Sprint 3 — 5 P1+P2 polish (~1 неделя):**

| S | Fix | Commit |
|---|---|---|
| S3.1 | A11y compliance pack (WCAG AA): role=img, focus-trap, aria-live | `48e5fb3` |
| S3.2 | HR-language polish: «Стоп» → «Требует разговора», blockers <details> | `344bc24` |
| S3.3 | V15 visual: filter-pill stripe, source monochrome, density rebalance, renderEmpty CTA | `1e5bac3` |
| S3.4 | Coverage gap closure: 17 renderer/integration tests | `2dd18fd` |
| S3.5 | Email PII masking (default mask + click reveal) | `3bffb97` |

## Финальный score

| Domain | Pre-Sprint 1 | Post-Sprint 3 |
|---|---|---|
| 7 операционных сигналов закрыто | 2 (29%) | 6 (86%) |
| WCAG AA pass | ❌ | ✅ |
| Performance budgets | ⚠ filter-click 150мс | ✅ ~30мс |
| Security perimeter | ❌ DoS-vector | ✅ rate-limit + cache |
| Visual V15 compliance | ⚠ filter-pill 16px radius, эмодзи в src | ✅ stripe-left, monochrome |
| HR-frame consistency | ⚠ red row-stripe + filled-bg | ✅ |
| Test coverage | 49 unit / 16 contract | 645 unit / 18 contract |

## Decisions / trade-offs

### 1. Co-existence vs full v1 rewrite

Выбрали **co-existence**. Стоимость: новый namespace, дублирование некоторых rendering-функций. Benefit: zero-risk пилот, A/B-сравнение для пользователей, rollback за 30 секунд (subtab default change).

### 2. Server-side enrichment via dynamic ESM import

Server.js — CJS. enrichForScanner2 — ESM. Используем `await import(...)` — Node auto-reparse работает, ESM module cache persistent. Альтернативы (re-implement в CJS, .mjs extension) — отклонены как over-engineering.

### 3. Email masking в HTML

Полный email присутствует в `data-email-full` атрибуте. F12 inspect раскроет. **Accepted risk** для internal corp tool: альтернатива (server-fetch на toggle reveal) — overkill, увеличивает latency. Если приоритет PII усилится — server toggle endpoint + audit log в V19.

### 4. Differential dwell-thresholds через fuzzy regex

Status name matching через lowercase regex `/code\s*review|на\s+ревью|...`. **Accepted limitation**: если кастомный статус не попадает в regex'ы — fallback default 24ч. Override через `cfg.pulseDwellThresholds` config map. Production-ready при первой жалобе тимлида о неправильной классификации.

### 5. Single 24h cache TTL для `/employee-detail`

Соответствует pulse-job TTL 30 мин (5 мин detail-cache внутри 30-min job-cache). Backward-compat при rollback просто отключения cache — endpoint работает, просто медленнее.

### 6. Sprint Goal без Story Points

Fallback на `count(done)/count(total)`. SP-поле требует custom-field discovery, не везде настроено. **PO accepted**: count'ы достаточны для пилота. SP integration — V19 task если PO попросит.

### 7. WIP-per-person — не выведен числом в UI

`classifyPerson` использует `wip ≥ 3` для классификации, но число WIP не показывается в row. Manager flagged. **Backlog P8** — не блокирует graduation.

## Rollback procedure (≤5 минут)

При обнаружении critical regression в production:

### Option A — soft rollback (предпочтительный, ~30 sec)

```bash
# 1. revert default subtab back to pulse (legacy v1)
cd $REPO
git revert 52f9dfb -m 1   # P6 commit
# OR manual edit:
# views/integrationsView.js: _activeSubtab: 'scanner2' → 'pulse'

# 2. deploy
npm run build  # no-op (no bundler)
# refresh users' browsers — they land on v1 by default
```

scanner2 остаётся доступен как 5й subtab, но не дефолт. v1 продолжает работать как раньше.

### Option B — hard rollback (~3 мин, если scanner2 поломал что-то фундаментальное)

```bash
# 1. revert ВСЕ scanner2-commits в обратном порядке
git revert 2dd18fd 3bffb97 48e5fb3 1e5bac3 344bc24 \
           ef0a334 f3d6930 875a0a5 ab6d1d2 57326c7 393d0cf \
           a8c8d48 a2f844c 97c438e f70476c 909eaaf \
           bef22b1 5d6e8f1 \
           52f9dfb 8ab8ac4 bcf5514 e9e60c5 4ba5301 2daecbc

# 2. удалить файлы
rm -rf integrations/teamScanner2*.js tests/unit/teamScanner2*.test.js \
       docs/integrations/team-scanner-v2.md \
       audit-2026-05-V18/scanner2-graduation.md

# 3. server.js — revert /employee-detail endpoint (строки 1927-2010 ish)
# 4. integrations/portfolioPulseApi.js — revert fetchEmployeeDetail
# 5. views/integrationsView.js — revert subtab + _scanner2Loaded
# 6. styles.css — revert .ts2-* блок (~250 LOC) + .int-subtab-legacy

npm test  # должен пройти как до P1: 534 unit / 11 contract
```

### Option C — feature flag (V19 add)

Currently no feature flag infra. Если возникнет необходимость частого toggle — добавить в V19 backlog: `cfg.scanner2Enabled` boolean, скрывает subtab при false без code change.

## Что отложено в backlog (V19+)

| # | Что | Приоритет |
|---|---|---|
| B1 | WIP-per-person counter в row | P2 (Manager finding) |
| B2 | Тренд «спринт N vs N-1» | P1 (PO для retro) |
| B3 | RBAC между командами | P3 (corp perimeter защищает сейчас) |
| B4 | Heatmap virtualization (200+ чел) | P3 (current scale OK) |
| B5 | Sprint Goal через Story Points | P2 (PO request) |
| B6 | Hard delete v1 PortfolioPulse | После 4 недель prod без regressions |
| B7 | Mobile responsive (<720px) | P3 (desktop-only assumption) |
| B8 | Telemetry / usage analytics | P2 (нет infra) |
| B9 | Persistent retention (history past 30 min) | P3 (нет storage) |
| B10 | Push-уведомления о blockers | P3 (нет WS/email infra) |

## Production-readiness checklist

| Категория | Проверка | Результат |
|---|---|---|
| Tests | 645 unit / 18 contract / 0 fail | ✅ |
| Security | Token leakage grep (`bearer\|authorization\|password`) в `.ts2-*` | ✅ Clean |
| Security | Rate-limit DoS-test через ab-style | ⏳ Manual smoke |
| A11y | axe-core CLI или manual axe DevTools | ⏳ Manual smoke |
| A11y | Keyboard-only прохождение | ⏳ Manual smoke |
| Performance | filter-click ≤ 50мс на dev-mode | ✅ ~30мс |
| Performance | initial fetch ≤ 30s на 50 чел | ✅ 5-15s |
| Visual V15 | grep `linear-gradient(`, `border-radius: ≥12px`, эмодзи в `.ts2-*` | ✅ Clean |
| Documentation | `docs/integrations/team-scanner-v2.md` | ✅ Written |
| ADR | `audit-2026-05-V18/scanner2-graduation.md` | ✅ This file |
| Rollback procedure | Documented (Option A: 30 sec, Option B: 3 min) | ✅ |
| Pilot feedback | 5 тимлидов / 1 PO / 1 руководитель ≥ 6/7 thumbs-up | ⏳ TODO Sprint 4 |

**Manual smoke + pilot feedback** — последний шаг перед production deploy. Automated DoD пройдена полностью.

## Итог

Сканнер команд 2.0 готов к graduation в production V18.2 после прохождения pilot-feedback (1 неделя на 5+ юзерах). Вся automated checklist пройдена. v1 сохранён в `[legacy]` режиме для безопасного rollback.

Команда экспертов рекомендует **deploy с monitoring** — telemetry instrument'ировать в первый месяц, hard-delete v1 — после 4 недель без жалоб (V18.4 или позже).
