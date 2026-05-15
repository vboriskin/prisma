# Сканнер команд 2.0 — обзорный документ

> AUDIT_SCANNER #42 — entry-point документ для нового LLM-агента / разработчика,
> впервые встречающего раздел «Сканнер команд». Углублённые гайды — по ссылкам.

## Что это

«Сканнер команд» — это HR-операционный экран Призмы для тимлида / руководителя.
Отвечает на вопрос «что у моей команды происходит **сегодня** и где красные
флаги»: разбивает участников по группам **Требует разговора / Под наблюдением /
Движется / Без активности**, показывает срез по Jira / Bitbucket / Confluence.
Не заменяет Portfolio Pulse v1 (тот живёт параллельно), а добавляет HR-первичный
взгляд поверх тех же данных.

## Три подвкладки

Inverted-pyramid UX: верхний уровень — действие сегодня, нижние — для тех, кому
нужен drill-down или тренды.

| Подвкладка | Что показывает | Кому полезно | Статус |
|---|---|---|---|
| **Сегодня** | `renderTeamGlance` — sprint-gauge, top-3 чипа классификации, per-person rows с 24ч dot-strip | Тимлид утром: «кому что сказать на стендапе» | Stable |
| **Глубже** | `renderSleepingDataInsights` — 25+ tile'ов по resolution split, sub-task ratio, worklog, component owner load, fix-version coverage, PR metrics, org-метрики, cross-team, DORA-proxy, bus-factor | SM / тимлид при подготовке к ретро / PI planning | Stable; AUDIT_SCANNER #20 — функция 700 LOC, требует разбиения |
| **Графики** (бывшие «Метрики», «Тренды») | ECharts-дашборд с метриками команд во времени | Руководитель направления, ежеквартальный обзор | Phase 1 — F-DUP-1 переименование visible-label из «Тренды» → «Графики» в registry-shim (`SUB_TAB_REGISTRY`) |

> Внутреннее имя tab'а — `metrics` (DOM-атрибут `data-scanner-tab="metrics"`),
> visible-label варьируется. Не путай с top-level `views/metrics.js` (portfolio-метрики
> по эпикам — другой раздел). См. AUDIT_HOLISTIC O7.

## Hero (визуальный якорь)

«Hero» во вкладке **Сегодня** — это `sprint-gauge` в `renderTopBar`:
полукруговой индикатор активного спринта с % выполнения, тренд-стрелкой WoW,
и `demoBanner` / `staleBanner` поверх. Цель — за 1 секунду показать «команда
успевает / отстаёт / без данных». Под Hero идёт `renderTeamGlance` —
single-line summary с распределением по группам classifyPerson.

## Identity coverage banner

Под топбаром появляется баннер «У X из Y участников нет email / Jira-аккаунта /
BB-логина в Призме». Это означает, что для них **integration-данные не пройдут
identity-deterministic attribution** (контракт V17.2 I1c — никаких fuzzy-name-
matches): сотрудник без `bitbucketLogin` НЕ получит BB-данные. Banner —
актион-кнопка «Выровнять identity → modal с auto-resolve preview». Подробнее
в `docs/state-contracts.md` § Identity-deterministic attribution.

## Куда копать дальше

| Задача | Файл |
|---|---|
| Архитектура раздела + контекст V20 hand-off | [`v20-scanner2-handoff.md`](./v20-scanner2-handoff.md) |
| API endpoints + identity-resolver | [`integrations/team-scanner-v2.md`](./integrations/team-scanner-v2.md) |
| Identity contract (V17.2 I1c) | [`state-contracts.md`](./state-contracts.md) |
| Source of truth — known issues / debt | [`../AUDIT_SCANNER.md`](../AUDIT_SCANNER.md) (общий) и [`../AUDIT_SCANNER_METRICS.md`](../AUDIT_SCANNER_METRICS.md) (метрики-вкладка) |
| Domain glossary (Sigma vs Delta Jira, scope, релизы) | [`domain-glossary.md`](./domain-glossary.md) |

## Известные ограничения / debt

Не дублируем `AUDIT_SCANNER.md`. Самые громкие:

- **#20** — `renderSleepingDataInsights` 700 LOC, в одну функцию, тестировать
  по-tile'но невозможно. Proof-of-pattern: `renderTile_componentLoad`.
- **#01** — sub-tab routing захардкожен в `if (_scannerTab === 'deeper')` switch
  внутри `renderTeamGlance`. Shim — `SUB_TAB_REGISTRY` + `registerScannerSubTab`,
  миграция постепенная.
- **#35** — экспорт PDF только через `window.print()` + минимальный `@media print`.
- **#47** — BB commits/PR popover на jira-key только title-attr, не full popover.
- **F-DUP-1** — visible-label «Графики» применён только в registry; legacy
  tab-bar в `_renderScannerTabBar` рендерит «Тренды» (два источника правды).
