# ADR: Sigma Jira isolation

**Status:** Accepted
**Date:** 2026-05-03
**Decision-makers:** заказчик + tech-lead
**Related code:** [server.js:gigachatGetToken](../server.js), [integrations/blackDashboard.js](../integrations/blackDashboard.js), [integrations/teamScanner2.js](../integrations/teamScanner2.js) (PR-CL комментарий-маркер), [chat/chatContextBuilder.js](../chat/chatContextBuilder.js)

---

## Context

В коде используются **два инстанса Jira**:

| Jira | Конфиг | Содержимое | Назначение |
|---|---|---|---|
| **Delta** | `jiraBaseUrl`, `jiraToken`, `jiraProjectKeys` | Все обычные задачи команд (тикеты, эпики, спринты) | Реестр, Сканнер 2.0, Метрики, AI-Анализ, AI Чат |
| **Sigma** | `sigmaJiraBaseUrl`, `sigmaJiraToken`, `sigmaGoalEpicKeys` | Только квартальные эпики-цели (`SMENT-9573` «Запустить кредитный конвейер» и т.п.) | **Только Чёрный дашборд** (модуль «Цели») |

Это два разных корпоративных инстанса Jira с разными правами доступа, разными командами-владельцами и разными уровнями конфиденциальности. Sigma — стратегические квартальные цели, обычно ограниченный read-доступ.

## Decision

**Sigma Jira изолирована от всех остальных модулей приложения.** Доступ к Sigma имеет **только** Чёрный дашборд (модуль «Цели» / `goals`). Никакие другие модули, эндпоинты, LLM-payload'ы, логи и экспорты Sigma-данных **не получают**.

## Trust boundaries

```
┌──────────────────────────────────────────────────────────────────┐
│  Frontend (browser)                                              │
│  ┌────────────────────────────┐  ┌──────────────────────────┐   │
│  │ Модуль «Курс»              │  │ Модуль «Цели»             │   │
│  │ Модуль «След пути»         │  │  · Чёрный дашборд        │   │
│  │ Модуль «Команда»           │  │  · AI CEO (use Delta)     │   │
│  │ Модуль «Ритуалы»           │  │                            │   │
│  │  · все используют Delta    │  │                            │   │
│  └────────────┬───────────────┘  └────────────┬─────────────┘   │
│               │                                │                  │
└───────────────┼────────────────────────────────┼──────────────────┘
                │                                │
                ▼                                ▼
   ┌─────────────────────────┐    ┌──────────────────────────────┐
   │  Server endpoints       │    │  Server endpoints             │
   │  /api/integrations/     │    │  /api/integrations/sigma-*    │
   │  · portfolio-pulse      │    │  /api/integrations/           │
   │  · jira-issue           │    │  · black-dashboard            │
   │  · bitbucket-prs        │    │                                │
   │  · confluence-search    │    │  Используют:                  │
   │  · llm/chat             │    │  - sigmaJiraBaseUrl          │
   │  · telemetry            │    │  - sigmaJiraToken             │
   │                          │    │  - sigmaGoalEpicKeys          │
   │  Используют:            │    │                                │
   │  - jiraBaseUrl          │    │  ⚠ НИКОГДА не используют:    │
   │  - jiraToken            │    │   · LLM-цепочка               │
   │  - jiraProjectKeys      │    │   · chatContextBuilder        │
   │                          │    │   · экспорты CSV/JSON/XLSX   │
   │  ⚠ НИКОГДА не получают: │    │                                │
   │   · sigmaJiraToken      │    │                                │
   │   · sigmaGoalEpicKeys   │    │                                │
   └────────────┬─────────────┘    └────────────┬─────────────────┘
                │                                │
                ▼                                ▼
       ╔════════════════╗            ╔══════════════════╗
       ║  Delta Jira    ║            ║   Sigma Jira     ║
       ║  jira.delta... ║            ║   (другой URL)   ║
       ╚════════════════╝            ╚══════════════════╝
```

## Конкретные правила

### Что разрешено

| Кто | Что | Где |
|---|---|---|
| Чёрный дашборд (frontend) | Запрашивать `/api/integrations/black-dashboard/start` | [integrations/blackDashboardApi.js](../integrations/blackDashboardApi.js) |
| Чёрный дашборд (frontend) | Запрашивать `/api/integrations/sigma-verify` | [views/integrationsView.js](../views/integrationsView.js) settings modal |
| Server endpoint Чёрного дашборда | Использовать `cfg.sigmaJiraToken` для запросов к Sigma | [server.js](../server.js) черно-дашбордовские routes |
| Settings UI | Сохранять `sigmaJiraToken` через `/api/jira/config` | [integrations/integrationsStore.js](../integrations/integrationsStore.js) |

### Что запрещено

| Что | Почему |
|---|---|
| Использовать `cfg.sigmaJiraToken` в `gigachatGetToken` или любом LLM-запросе | LLM не должен видеть стратегические цели — это external API call |
| Включать sigma-данные в `chatContextBuilder.buildContextPayload()` | Контекст для LLM формируется только из Delta-данных + state.rows + scanner model |
| Включать sigma-данные в любой экспорт (CSV/JSON/XLSX) | `_scrubSecrets` не различает токены — потенциальная утечка |
| Логировать `sigmaJiraToken` или `sigmaGoalEpicKeys` в `server/logger.js` | Уже покрыто PII-scrub'ом, но дополнительно проверять при code-review |
| Любой модуль кроме «Цели» обращается к sigma-endpoint'ам | Architecturally-incorrect — ловим на code-review |

## Enforcement

### Текущие гарантии

1. [PR-CL](../integrations/teamScanner2.js) — комментарий-маркер в `teamScanner2.js`:
   > «Sigma Jira (`sigmaJiraBaseUrl`, `sigmaJiraToken`, `sigmaGoalEpicKeys`) — отдельный инстанс Jira для квартальных эпиков-целей и обслуживается ИСКЛЮЧИТЕЛЬНО `blackDashboard.js` + endpoints `/api/integrations/sigma-*`. Сканнер 2.0 + portfolioPulse работают только с Delta Jira.»

2. [server/logger.js](../server/logger.js) `_PII_KEY_DENYLIST` — токены маскируются автоматически в любых логах.

3. [PR-CV diagnostic](../server.js) — Reviewer-stats endpoint не использует sigma.

### Что добавить в Волне 1 редизайна

- [ ] **Contract test** `tests/contract/sigma-isolation.test.js`:
  - Stubbed sigma-endpoint, проверка что `/api/llm/chat` не получает sigma-данных в payload (никакие keys из `sigmaGoalEpicKeys` не появляются в LLM messages)
  - Stubbed sigma-endpoint, проверка что `/api/integrations/portfolio-pulse` не вызывает sigma-URL
  - Проверка что `chatContextBuilder.buildContextPayload()` не содержит sigma-related fields

- [ ] **Code-review checklist** добавить в `CLAUDE.md`:
  ```
  ## Sigma isolation (см. docs/sigma-isolation.md)
  При добавлении любого нового endpoint'а или contextBuilder'а — проверить:
  - Не использует ли cfg.sigmaJiraToken вне blackDashboard*?
  - Не включает ли sigmaGoalEpicKeys в LLM payload?
  Если PR трогает эти места — обязательно ссылка на ADR.
  ```

- [ ] **Eslint rule** (опционально, если станет проблемой) — запрет импорта `blackDashboardApi` в файлах вне `integrations/blackDashboard*` и `views/blackDashboard*`.

## Consequences

### Положительные

- Compliance: Sigma stratégические данные изолированы — снимает HR-чувствительные риски, упрощает разрешение от security-команды на интеграцию с LLM (GigaChat).
- Простота review: новый разработчик при добавлении features в LLM знает чёткое правило «sigma не трогать».
- Надёжность: если завтра Sigma Jira лежит — ломается только модуль «Цели», все остальные продолжают работать.

### Отрицательные

- **Когнитивная нагрузка** на разработчиков: нужно помнить что в проекте две Jira'ы.
- **Дублирование кода:** `jiraResolveProjectId`, `jiraSearchAll`, `jiraRequest` приходится либо параметризовать (передавать `jiraBaseUrl/Token` как arg) либо иметь дубль для sigma. Сейчас принят первый подход.
- **«AI CEO» (модуль Цели)** использует Delta-данные, но описывает sigma-цели — есть риск что в будущем появится соблазн «подсосать» sigma-данные в AI CEO для richer narrative. **Запрещено**.

## Alternatives considered

1. **Объединить Delta + Sigma в один токен.** Отклонено: разные команды-владельцы, разные ACL, разные SLA в банке.
2. **Не изолировать, передавать sigma в LLM.** Отклонено: GigaChat — внешний API, передача стратегических целей наружу — compliance risk.
3. **Вынести Sigma в отдельный микросервис.** Отклонено: оверинжиниринг для текущего масштаба (1 sigma-endpoint, 1 frontend-модуль).

## References

- [`my_prisma-brand/BRAND_BOOK.md`](../my_prisma-brand/BRAND_BOOK.md) — модуль «Цели» в IA
- [`design-audit/redesign-my-prisma/00-PLAN.md`](../design-audit/redesign-my-prisma/00-PLAN.md) §5.2 — почему Чёрный дашборд → модуль Цели
- [PR-CL комментарий в `integrations/teamScanner2.js`](../integrations/teamScanner2.js)
- [PR-DB contract tests](../tests/contract/llm.test.js) — частично покрывает LLM isolation

## Дата ревью

Этот ADR пересматривается:
- При добавлении 2-го sigma-эндпоинта (если появится)
- При предложении использовать sigma вне модуля «Цели»
- Через 6 месяцев (2026-11-03) — sanity check что правила работают на практике
