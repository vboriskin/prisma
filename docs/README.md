# `docs/` — навигация

> Это **index** документации Призмы. LLM-агенту читать в порядке:
> 1. [`../CLAUDE.md`](../CLAUDE.md) — точка входа (3 контракта, доменный словарь, маршруты)
> 2. [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — high-level архитектура
> 3. Этот файл — куда копать дальше
>
> Audit-папки V14→V21 удалены (commit `afeb858`). История находится через
> `git log --grep="V17.2 I1c"` или `git log --since=2026-05-01`.

---

## 1. Вход в проект (онбординг)

| Файл | Зачем |
|---|---|
| [`../CLAUDE.md`](../CLAUDE.md) | Первое что читает LLM. 3 контракта, доменный словарь, V22+ актуальное. |
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | High-level data flow, module boundaries, security defaults. |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Как сделать PR. ESLint / тесты / commits. |
| [`running.md`](./running.md) | Как запустить локально (включая корп-proxy с MITM TLS). |

## 2. Контракты и инварианты (must-read)

| Файл | Зачем |
|---|---|
| [`state-contracts.md`](./state-contracts.md) | 3 неочевидных контракта: Reactive.silent, identity-deterministic attribution, `_scrubSecrets`. |
| [`state-shape.md`](./state-shape.md) | Shape `state` / `Row` / `Employee` + invariants. |
| [`dont-touch.md`](./dont-touch.md) | Места «выглядит как баг, но это сознательный компромисс». |
| [`sigma-isolation.md`](./sigma-isolation.md) | ADR: Sigma Jira как отдельный инстанс. |

## 3. Tone of voice / Brand

| Файл | Зачем |
|---|---|
| [`tone-of-voice.md`](./tone-of-voice.md) | TOV stub (BRAND_BOOK §7). |
| [`brand.md`](./brand.md) | Brand reference для разработчиков. |
| [`spine-pill.md`](./spine-pill.md) | Дизайн-система V15+ — 3px stripe, mono numerals, CAPS sub-headers. |
| [`pz-design-system.md`](./pz-design-system.md) | Токены/палитра/типографика. |
| [`microcopy-style-guide.md`](./microcopy-style-guide.md) | Микрокопия (Birman-style). |
| [`branding-proposals.md`](./branding-proposals.md) | **DEPRECATED** ранние концепции бренда. |

## 4. State / Migrations

| Файл | Зачем |
|---|---|
| [`state-shape.md`](./state-shape.md) | Top-level state + Row + Employee shape. |
| [`state-contracts.md` § Migration policy](./state-contracts.md) | Когда bump'ать `q2_*_v3` версию. |
| [`persistence-keys.md`](./persistence-keys.md) | Список всех `localStorage` ключей. |
| [`version-history.md`](./version-history.md) | Карта эпох V11→V22+ (расшифровка `// V14 (B2)` меток). |
| [`window-globals-migration.md`](./window-globals-migration.md) | window.X → Services-pattern. |

## 5. Domain glossary

| Файл | Зачем |
|---|---|
| [`glossary.md`](./glossary.md) | Алиас + алфавитный индекс. |
| [`domain-glossary.md`](./domain-glossary.md) | Полный словарь: Delta/Sigma Jira, релизы, scope, эпик-vs-задача, identity-таблица, Risk Engine, plan-lock. |

## 6. Тестирование / QA

| Файл | Зачем |
|---|---|
| [`testing.md`](./testing.md) | Уровни тестов: testRunner / unit / contract / e2e / Playwright. |
| [`FOUND_BUGS.md`](./FOUND_BUGS.md) | Список найденных багов в процессе тестирования. |
| [`REFACTOR_SUGGESTIONS.md`](./REFACTOR_SUGGESTIONS.md) | Места, тяжело тестируемые из-за архитектуры. |

## 7. Интеграции

| Файл | Зачем |
|---|---|
| [`integrations/README.md`](./integrations/) | Обзор + Pulse pipeline. |
| [`integrations/api-endpoints.md`](./integrations/) | Таблица всех `/api/integrations/*`. |
| [`integrations/auth-and-secrets.md`](./integrations/) | Token flow + scrub policy. |
| [`integrations/release2.md`](./integrations/release2.md) | **V22+ Phase 5** — Release 2.0 sub-tab (56 custom-fields, lazy-loading, expand-panel). |
| [`integrations/scanner2-overview.md`](./integrations/scanner2-overview.md) | Сканнер команд 2.0 — model + render + retention. |
| [`integrations/team-scanner-v2.md`](./integrations/team-scanner-v2.md) | Scanner v2 — detail design. |
| [`integrations/scanner2-classifier.md`](./integrations/scanner2-classifier.md) | classifyPerson правила. |

---

## Текущая итерация (V22+)

См. `git log --oneline -20` для коммитов последней эпохи. Главное:

- **Phase 4** — chat-bot meta-navigator (CEO-update, Smart suggestions, Explain-engine)
- **Phase 5** — Release 2.0 sub-tab + visual grooming Phase 5.1 / 5.2
- **Sprint A/B/C** — Scanner visual refactor (brand / microcopy / density encoding)
- **Playwright** — `tests/playwright/{scanner-smoke,full-audit}.spec.js` + CI `visual` job

---

## Куда писать новые документы

| Тема | Куда |
|---|---|
| Контракт state / persistence | extends [`state-contracts.md`](./state-contracts.md) |
| Новая интеграция | новый файл в [`integrations/`](./integrations/) |
| Architectural decision | новый файл в этой папке с префиксом-эпохой (`V22-<topic>.md`) |
| Brand / tone правило | extends [`tone-of-voice.md`](./tone-of-voice.md) или [`spine-pill.md`](./spine-pill.md) |
| LLM-onboarding fact | extends [`../CLAUDE.md`](../CLAUDE.md) |

## Что НЕ держать здесь

- Top-level `AUDIT_*.md` (удалены commit `afeb858` — read-only ADR)
- `audit-2026-*` папки (удалены commit `afeb858`)
- Auto-generated reports — кладут в `.gitignore`-папку
