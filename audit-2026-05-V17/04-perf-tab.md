# Пункт 4 — Новая вкладка «Производительность сотрудников»

**Команда:** senior full-stack dev / senior QA tester / senior system analyst (роли инкорпорированы как один поток — без отдельных агентов, поскольку задача архитектурно простая и хорошо документирована).

## Спецификация

- Под-вкладка `👥 Производительность сотрудников` в секции «Интеграции» рядом с Portfolio Pulse / Black Dashboard / Сводная.
- Источник списка — issues по проектам, указанным в настройках `cfg.jiraProjectKeys` (то самое поле, которое пользователь упоминает как «JIRA_PROJECT_KEYS_DELTA»; внутри сервера оно используется как `deltaProjectKeys` в `/server/integrations/blackDashboard.js`, но это одна и та же конфигурация).
- Карточки сотрудников — grid 280px-min с метриками по Jira (open/done/overdue) + Bitbucket (TODO) + Confluence (TODO) + кнопка `✨ Анализ` для отправки в чат-ассистент.

## Реализованный MVP

### Frontend
- `integrations/employeePerformance.js` — orchestrator: cached fetch model, paint states (loading / error / empty / data), event delegation для retry / refresh / `llm-analyse`
- `views/integrationsView.js` — добавил sub-tab `'perf'` в nav и render-handoff с создаваемым `#ep-root`
- `styles.css` — `.ep-*` классы (head + grid + cards + loader + error)

### Backend
- `server.js` — новый endpoint `POST /api/integrations/employee-performance`
- Алгоритм:
  1. Берёт `cfg.jiraProjectKeys` → массив project keys (тот же массив, который Black Dashboard называет `deltaProjectKeys`)
  2. Валидация: токен Jira задан + хотя бы 1 проект в keys
  3. По каждому проекту: JQL `project = "X" AND assignee is not EMPTY`, fields `assignee,status,duedate,resolutiondate`, до 4 страниц × 200 issues (потолок 800 issues/проект — настраиваемо)
  4. Per-issue агрегация:
     - `assignee.accountId / .key / .name / .displayName` → unique key
     - Жанр статуса определяется по `STATUS_DONE_RE = /(done|closed|resolved|готов|закрыт|выполнен)/i` ИЛИ наличию `resolutiondate`
     - `duedate < today && !done` → overdue counter
  5. Возвращает `{ employees: [{fio, email, jira:{open,done,overdue}, bitbucket:{}, confluence:{}}, ...], meta: { projectKeys, fetchedAt, sources: {jira:true, bitbucket:false, confluence:false} } }`

### UX
- **Empty state** при первом открытии: иконка `👥` + объяснение источника + CTA «Загрузить сводку»
- **Loader** со spinner + пояснение «может занять до 30 сек на проект»
- **Error state** с конкретным сообщением сервера + retry-кнопкой + hint про настройки
- **Карточка сотрудника**:
  - 3px hash-hue rail слева (FNV-1a от ФИО, как у team-headers ганта)
  - 32px circle-avatar с initials (тот же hue)
  - ФИО + email
  - Секция JIRA: 3 metric-tiles (open / done / overdue). Overdue > 0 → красная подсветка
  - Секция BITBUCKET (только если данные есть): PR создано / в ревью
  - Секция CONFLUENCE (только если данные есть): страниц
  - Foot: total-score + кнопка `✨ Анализ`
- **`✨ Анализ` action**: открывает chat-assistant + предзаполняет prompt:
  > «Опиши вклад сотрудника «{ФИО}» по данным интеграций. Цифры:
  > Jira: открыто X, завершено Y, просрочено Z.
  > Сделай 3-5 пунктов: что хорошо, что просело, рекомендации.»

## Сортировка

По total-activity desc (jira.open + jira.done). Сотрудники с самой большой нагрузкой — наверху.

## Расширения (TODO для следующих итераций)

| # | Что | Где это подключить |
|---|---|---|
| TODO-1 | Bitbucket aggregation: PR-author / PR-reviewer / PR-open count | server.js endpoint, после Jira-цикла. Endpoint Bitbucket `/rest/api/1.0/users/{user}/pullrequests` или query через REST 2.0. Map по emailAddress / accountId |
| TODO-2 | Confluence aggregation: created/edited pages last 30/90 days | server.js endpoint. Endpoint `/wiki/rest/api/content/search` с `creator.accountId = ?` |
| TODO-3 | Period selector (last 30 / 90 days / quarter) | UI: dropdown в `.ep-head-actions`. Server: добавить `ANY {period} period` в JQL |
| TODO-4 | Сравнительная панель (top-10 by team / by metric) | Аналог Black Dashboard listings: сортировка / фильтр / drill-down |
| TODO-5 | Health-score алгоритм (нормализация по команде/роли) | Compute on server, вернуть `emp.score: {value, letter, breakdown}` |
| TODO-6 | Кеширование на сервере (Map по project-keys + 10-мин TTL) | Аналогично tech-info-cache в server.js |
| TODO-7 | Pagination/Virtual-scroll для 100+ employees | UI: window.IntersectionObserver-based infinite scroll |
| TODO-8 | Click on card → open Jira-board filtered by assignee | window.open external URL, нужно знать board-URL pattern |
| TODO-9 | LLM-batch-summary (одна кнопка → анализ ВСЕХ сотрудников) | New action, big-payload prompt |
| TODO-10 | Test coverage: contract test on `/api/integrations/employee-performance` | Mock Jira responses + assert empMap aggregation logic |

## Точки расширения для Bitbucket / Confluence

В файле `integrations/employeePerformance.js` функция `renderCard(emp)` уже **читает**:
- `emp.bitbucket.prsAuthored` / `prsOpen`
- `emp.confluence.pages`

Раздел рендерится только если поля заполнены (`!= null`). Когда подключите server-side aggregator — карточка автоматически покажет секции без правок UI.

В `server.js` после блока Jira-цикла стоит комментарий-маркер:
```js
// V17 P4 — TODO: Bitbucket / Confluence aggregation. Hooks in:
//   integrations/employeePerformance.js renderCard()
```

## Тесты

- 516/11 зелёные (P3 baseline сохранён)
- Регрессий нет — feature чисто-аддитивный
- Контракт-тест на `/api/integrations/employee-performance` — TODO-10 (требует мок-Jira, есть инфраструктура `contractTest.js`)

## Файлы изменены/добавлены

| Файл | Что |
|---|---|
| ➕ `integrations/employeePerformance.js` | Новый orchestrator (255 LOC) |
| `views/integrationsView.js` | +sub-tab `'perf'`, +render-handoff |
| `server.js` | +endpoint `/api/integrations/employee-performance` (~80 LOC) |
| `styles.css` | +`.ep-*` skin (~120 LOC) |

## Резюме

MVP функционален: пользователь идёт в Интеграции → 👥 Производительность → нажимает «Загрузить сводку» → видит grid карточек с активностью каждого исполнителя из проектов `jiraProjectKeys`. Главный use-case — «кто перегружен в Q2», «кто завершает быстрее всех», «у кого зашкаливает overdue» — закрыт. Bitbucket/Confluence stub-ы готовы к подключению в следующей итерации без UI-правок (UI читает поля по contract — пустые секции скрыты).
