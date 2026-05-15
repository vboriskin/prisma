# `docs/` — навигация

> Это **index** документации Призмы. LLM-агенту читать в порядке:
> 1. [`../CLAUDE.md`](../CLAUDE.md) — точка входа (3 контракта, доменный словарь, маршруты)
> 2. [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — high-level архитектура
> 3. Этот файл — куда копать дальше
>
> **Каноническая документация:** этот `docs/`. Аудит-папки (`audit-2026-*`) —
> read-only ADR-history, см. [`audits-index.md`](./audits-index.md).

---

## 1. Вход в проект (онбординг)

| Файл | Зачем |
|---|---|
| [`../CLAUDE.md`](../CLAUDE.md) | Первое что читает LLM. 3 контракта, как читать audit-метки, доменный словарь. |
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | High-level data flow, module boundaries, security defaults. |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Как сделать PR. ESLint / тесты / commits. |
| [`running.md`](./running.md) | Как запустить локально (включая корп-proxy с MITM TLS). |
| [`v20-scanner2-handoff.md`](./v20-scanner2-handoff.md) | Контекст для агента, продолжающего «Сканнер команд 2.0». |

## 2. Контракты и инварианты (must-read)

| Файл | Зачем |
|---|---|
| [`state-contracts.md`](./state-contracts.md) | 3 неочевидных контракта: Reactive.silent, identity-deterministic attribution, `_scrubSecrets`. |
| [`state-shape.md`](./state-shape.md) | Shape `state` / `Row` / `Employee` + invariants. Сгенерируется из JSDoc в P8 phase-2. |
| [`dont-touch.md`](./dont-touch.md) | Места «выглядит как баг, но это сознательный компромисс». |
| [`sigma-isolation.md`](./sigma-isolation.md) | ADR: Sigma Jira как отдельный инстанс. |

## 3. Tone of voice / Brand

| Файл | Зачем |
|---|---|
| [`tone-of-voice.md`](./tone-of-voice.md) | TOV stub (BRAND_BOOK §7). Расширяется AU5 middleware. |
| [`brand.md`](./brand.md) | Brand reference для разработчиков (минимум чтоб не сломать дизайн). |
| [`spine-pill.md`](./spine-pill.md) | Дизайн-система V15+ — 3px stripe, mono numerals, CAPS sub-headers. |
| [`branding-proposals.md`](./branding-proposals.md) | **DEPRECATED** ранние концепции бренда. |
| [`../my_prisma-brand/BRAND_BOOK.md`](../my_prisma-brand/BRAND_BOOK.md) | Полный brandbook (концепция, типографика, motion, splash, loaders). |

## 4. State / Migrations

| Файл | Зачем |
|---|---|
| [`state-shape.md`](./state-shape.md) | Top-level state + Row + Employee shape. |
| [`state-contracts.md` § Migration policy](./state-contracts.md) | Когда bump'ать `q2_*_v3` версию. |
| [`version-history.md`](./version-history.md) | Карта эпох V11→V17.2 (расшифровка `// V14 (B2)` меток). |

## 5. Domain glossary

| Файл | Зачем |
|---|---|
| [`glossary.md`](./glossary.md) | Алиас + алфавитный индекс. |
| [`domain-glossary.md`](./domain-glossary.md) | Полный словарь: Delta/Sigma Jira, релизы, scope, эпик-vs-задача, identity-таблица, Risk Engine, plan-lock. |

## 6. Тестирование / QA

| Файл | Зачем |
|---|---|
| [`testing.md`](./testing.md) | Уровни тестов: testRunner / unit / contract / e2e. |
| [`FOUND_BUGS.md`](./FOUND_BUGS.md) | Список найденных багов в процессе тестирования. |
| [`REFACTOR_SUGGESTIONS.md`](./REFACTOR_SUGGESTIONS.md) | Места, тяжело тестируемые из-за архитектуры. |

## 7. Интеграции

| Файл | Зачем |
|---|---|
| [`integrations/README.md`](./integrations/) | Обзор + Pulse pipeline. |
| [`integrations/api-endpoints.md`](./integrations/) | Таблица всех `/api/integrations/*`. |
| [`integrations/auth-and-secrets.md`](./integrations/) | Token flow + scrub policy. |

## 8. Audit-эры

| Файл | Зачем |
|---|---|
| [`audits-index.md`](./audits-index.md) | Полный индекс аудит-папок V14 → V21 + holistic. |
| [`v21-rollout-cadence.md`](./v21-rollout-cadence.md) | Ступенчатый rollout пилота 109 чел → организация. |
| [`audit-2026-05-pilot-review.md`](./audit-2026-05-pilot-review.md) | V21 Pilot Review. |
| [`audit-2026-05-tech-deep-dive.md`](./audit-2026-05-tech-deep-dive.md) | Технический deep-dive (~50 KLOC). |
| [`audit-2026-05-03/`](./audit-2026-05-03/) | Ранний пилот V21 (12 отчётов). |

---

## 9. Документ-генератор (P8 phase-1)

[`../scripts/docgen.js`](../scripts/docgen.js) — minimal Node-script, который:

- Сканирует `state.js` + `rowFactory.js` JSDoc → пишет `docs/state-shape.md`.
- Читает MAP-блок из `CLAUDE.md` → копирует в `docs/architecture-map.md`.

Запуск: `npm run docs:gen` (не в CI; phase-2).

---

## Куда писать новые документы

| Тема | Куда |
|---|---|
| Контракт state / persistence | extends [`state-contracts.md`](./state-contracts.md) |
| Новая интеграция | новый файл в [`integrations/`](./integrations/) |
| ADR / решение | как audit-папка `audit-2026-MM-<topic>/` (read-only после merge) |
| Brand / tone правило | extends [`tone-of-voice.md`](./tone-of-voice.md) или [`spine-pill.md`](./spine-pill.md) |
| LLM-onboarding fact | extends [`../CLAUDE.md`](../CLAUDE.md) |

## Что НЕ держать здесь

- Корневые `AUDIT_*.md` (2026-05-07/08) — финальный пасс, не дублировать.
- `audit-2026-*/` папки в корне — read-only ADR.
- Auto-generated reports — кладут в `.gitignore`-папку.
