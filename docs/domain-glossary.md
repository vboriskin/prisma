# Domain Glossary

Терминология проекта. Без понимания этих терминов код Реестра / Ганта / интеграций читается некорректно.

Продукт сейчас называется **«Призма»**. Исторически назывался «СБОФ Планирование» («СБОФ» = Сбер Онлайн Финансирование) — это имя ещё встречается в legacy-артефактах: `sbof_*` ключи localStorage, `sbof-planner/1.0` User-Agent, `sbof-jobs` tmp-каталог, npm-имя пакета `sbof-planning-v4`. Переименование этих идентификаторов — отдельная миграция.

## Jira-инстансы

### Delta Jira (основная)

- Источник правды для **Реестра задач** (`state.rows`)
- Хранит обычные задачи команд: epic / story / bug / task
- Адрес и токен — `cfg.jiraBaseUrl` + `cfg.jiraToken`
- Project keys — `cfg.jiraProjectKeys` (CSV: `PAY, SBOF, KYC`)
- Используется в: Portfolio Pulse, TechInfo, Employee Performance, sync строки Реестра

### Sigma Jira (квартальные цели)

- **Отдельный Jira-инстанс**, не та же что Delta
- Хранит **квартальные эпики-цели** (goal epics) — то что должна команда сделать в квартале
- Каждый goal-эпик имеет поле `Domain link` — массив ключей задач из **Delta** Jira (т.е. цель «закрыта» когда покрыта реальной работой в Delta)
- Адрес и токен — `cfg.sigmaJiraBaseUrl` + `cfg.sigmaJiraToken`
- Goal-эпик keys — `cfg.sigmaGoalEpicKeys` (CSV: `GOAL-1, GOAL-2`)
- Используется только в: **Чёрный дашборд** (`integrations/blackDashboard*`)

> **Sigma fields хранятся ВНУТРИ `jira_config.json`** (не отдельный конфиг) — исторический артефакт. Не пытайтесь разносить.

## Окна планирования (релизы)

«Релизы» в этом проекте — **окна планирования**, не релизы в DevOps-смысле:

| Релиз | Что значит | Состояние строки |
|---|---|---|
| `1.20` | окно ближайшего планового релиза (даты в `RELEASE_WINDOWS`) | `row.hasRelease120 === true` |
| `1.21` | следующий за ним релиз | `row.hasRelease121` |
| `1.22` | через один | `row.hasRelease122` |
| `Овертайм` (OT) | «успеем но не в плановое окно» | `row.hasOvertime` |
| `Бэклог` | НЕ запланирована ни в одно окно | `row.isUnassigned === true` |

«Сделано в Овертайме» = команда взяла задачу но понимает что не успеет в плановое окно. Это статус планирования, не статус готовности.

Даты конкретных релизов фиксированы в `constants.js` (`RELEASE_WINDOWS`, `GANTT_RELEASE_BOUNDS`).

## Scope

Поле `row.scopeStatus` — **3-значный** статус (не bool):

| Значение | Смысл |
|---|---|
| `'Да'` | задача подтверждена в scope этого квартала |
| `'Нет'` | задача исключена из scope (не делаем) |
| `'Требует подтверждения'` | scope не зафиксирован — нужна сессия с PM/owner |

`'Требует подтверждения'` — критичный edge case. Есть пресет в фильтрах «Треб. подтв.» → юзер быстро видит сколько таких. Если случайно слил с `'Нет'` — нарушил semantics.

## Эпик vs задача

> Это самое запутанное место — три разных понятия в одной field-name.

| Контекст | Что значит «эпик»/«задача» |
|---|---|
| **Реестр (`state.rows[i]`)** | Одна строка = один **эпик** (поле `row.epic`). У эпика могут быть jira-task'и (`row.tasks` — comma-list ключей). Так что `state.rows[i]` это «эпик с привязанными jira-задачами» |
| **Гант, столбец «Эпик»** | Те же `state.rows[i]` — каждая строка эпика → строка ганта |
| **Гант, ячейка колодца «N задач»** | НЕ jira-задачи. Это **типы работ** (BE / FE / QA / Тестирование / Внедрение / Бизнес аналитика / Миграция данных / Стабилизация / Хотфикс) |
| **Pulse «issues»** | Здесь обратно — Jira issues с любым типом (Story / Task / Bug). `analysePulse` объединяет их вокруг участников |

V17.1 C11+C12 — UI-русификация:
- В строке эпика «5 работ» → «5 задач» (с правильным склонением через `pl()`)
- В team-row «N задач» → «N эпиков» (с правильным склонением)

## Identity-таблица сотрудников (V17.2)

`state.employees[i]` — авторитет для интеграций:

```js
{
  id: 'emp_...',
  fio: 'Иванов Иван Иванович',
  roles: 'BE|QA',                           // pipe-separated
  teams: 'Платежи|Каталог',
  overtimeDays: ['2026-05-04', ...],        // ISO dates
  weekdayReady: true,
  weekdayComment: 'после релиза|совещание',

  // V17.2 I1c — identity для интеграций.
  // Если эти поля пустые — сотрудник НЕ получает данные из соответствующего источника.
  email:               'ivanov@company.com',
  jiraAccountId:       '5b10a2844c20165700ede21g',  // Cloud accountId или username Server
  bitbucketLogin:      'i.ivanov',                   // username в Bitbucket
  confluenceAccountId: '5b10a2844c20165700ede21g',   // обычно совпадает с Jira

  sourceType: 'manual'|'csv'|...,
  createdAt, updatedAt
}
```

См. [`state-contracts.md` § Identity](./state-contracts.md) для контракта атрибуции.

## Risk Engine

`riskEngine.js` (56 строк) — простой rule-based scorer на каждой строке. Ставит:

- `row.riskScore` (0-100) — числовой риск
- `row.riskFlags` — массив строк-причин (`'Без assignee в scope'`, `'Блокирующая зависимость'`, `'Поздняя дата deadline'`)

Используется:
- Реестр: pill «Risky» в меню фильтров
- Дашборд: «Высокий риск» count
- Pulse: agregated risk per team
- AI Анализ: входной сигнал для блока «Здоровье проекта»

Что повышает score:
- `blockingDependency === true` (+20)
- `scopeStatus === 'Требует подтверждения'` (+10)
- `isUnassigned && scopeStatus === 'Да'` (+15) — задача в scope но без релиза
- `blockingDeadline` в прошлом (+30)
- `hasOvertime` (+10) — самовоспринятый риск команды
- (комбинации могут давать больше; см. `RiskEngine.computeAll`)

Что НЕ влияет: `isDone === true` обнуляет `riskScore` (даже с флагами).

Если меняешь правила:
1. Тесты в `tests/unit/riskEngine.test.js`
2. Run `RiskEngine.computeAll()` после миграции — иначе старые данные останутся со старыми scores

## История / журнал

Два разных «журнала»:

| | Где | Что |
|---|---|---|
| `HistoryManager` | `app/historyManager.js` | Undo/Redo стек на bulk-actions (`checkpoint(label)` фиксирует точку) |
| `HistoryLog` | `historyLog.js` | Аудит-журнал событий (data/ai/integrations/settings/view/system категории), persists в localStorage `q2_action_log_v1`, retention 30 дней |

Не путать. UI вкладка «История» рисует `HistoryLog`. Кнопки Undo/Redo (Cmd+Z / Cmd+Shift+Z) — `HistoryManager`.

V17.1 C9 — модалка «История изменений Ганта» в Ганте берёт записи из `HistoryLog` и фильтрует по domain=gantt patterns.

## Demo-mode

`onboarding/demoData.js` генерит ~22 fixture-строки на старте (если юзер выбрал «Демо»). Не для разработки — это **first-run experience** для конечного юзера.

V17 P12 F6 — `blockingDeadline` теперь `isoShift(N)` относительно today (раньше hardcoded `'2024-03-...'` → демо показывал «просрочено 700 дней»).

## Plan-lock (V14)

`state.planLocked` + `state.ganttEditMode` — фиксация плана:

- `planLocked = { at: ISO, by: 'user' }` → план зафиксирован, любой перенос pill в Ганте требует комментария
- `ganttEditMode = true` → временный bypass комментария (юзер режет режим вручную)

UI: кнопки «🔒 Зафиксировать план» / «✏ Режим редактирования» / «🔓 Снять фиксацию» в section-header Ганта.

## Команда / Team

`row.team` — строка (одна команда на эпик). Список команд — `Utils.unique(state.rows.map(r=>r.team))`.

Команда — UI-grouping в Ганте (rows группируются под team-header) и в фильтрах. Не Jira-понятие.

## SCOPE_OPTIONS / WORK_TYPES / PHASE_COLORS

Константы в `constants.js`:

- `SCOPE_OPTIONS = ['Да', 'Нет', 'Требует подтверждения']` — единственный allowed-list для `row.scopeStatus`
- `WORK_TYPES` — список типов работ (BE/FE/QA/...). Используется в Ганте (выбор типа в pill-picker), фильтрах, риск-engine
- `PHASE_COLORS` — цветовая палитра типов работ (стрипа на pill в Ганте)

При добавлении нового типа работ — обнови ВСЕ три места.

---

## Сокращения

| Сокращение | Расшифровка |
|---|---|
| СБОФ | Сбер Онлайн Финансирование. Историческое имя продукта — «СБОФ Планирование»; сейчас продукт называется «Призма» |
| ОТ / OT | Overtime (овертайм-окно) |
| BE / FE / QA | Backend / Frontend / Quality Assurance (типы работ) |
| PK | Project Key (Jira) |
| CQL | Confluence Query Language |
| JQL | Jira Query Language |
| TLS | Transport Layer Security |
| MITM | Man-in-the-middle (про корп-proxy с собственным CA) |
| ADR | Architecture Decision Record (наши audit-папки) |
| PR | Pull Request |
