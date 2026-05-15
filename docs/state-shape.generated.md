# State Shape (auto-generated)

> Сгенерировано из `state.js` + `rowFactory.js` через `scripts/docgen.js`.
> Для финального документа смотри [`state-shape.md`](./state-shape.md).
> Дата: 2026-05-08

## Top-level keys (из `_rawState`)

- `state.rows`
- `state.employees`
- `state.filters`
- `state.search`
- `state.onlyBlocking`
- `state.activeSection`
- `state.diagnostics`
- `state.sources`
- `state.registryCount`
- `state.sort`
- `state.ganttMode`
- `state.ganttEpicsWell`
- `state.epicDeps`
- `state.planLocked`
- `state.ganttEditMode`
- `state.lastClickedRowId`
- `state.timelineMode`
- `state.podlozhkaGroup`
- `state.podlozhkaMode`
- `state.presetsCollapsed`
- `state.theme`
- `state.colVisibility`
- `state.colOrder`
- `state.colWidths`
- `state.colLabels`
- `state.pinnedCols`
- `state.rowHeight`
- `state.customCols`
- `state.colTypes`
- `state.sidebarCollapsed`
- `state._idCounter`
- `state._dataVersion`
- `state.llm`
- `state.simMode`
- `state.bulkSelected`
- `state.actionLog`
- `state.notifications`

## JSDoc blocks: state.js (0)

## JSDoc blocks: rowFactory.js (3)

### `detectBlocked`

Заблокированные пользователи помечаются в ФИО суффиксом [Х]/[X]/[В]/[B].
Примеры: «Иванов И.И. [Х]», «Петров П.П.[X]», «Сидоров С.С. [В]».
Возвращает true если такой маркер есть.

### `detectServiceAccount`

V20 S4 — Pattern-based service account detection.
Эвристики (упорядочено по уверенности):
1) jiraKey начинается на cab-sa-, sbt-, sa-, out-, svc-, bot-, system-
2) jiraKey содержит -sa- / -bot- / -svc- / -api- (e.g. user-api-1)
3) email пустой И roles пустой И fio пустой/общий — служебный
Не использует ФИО для match'а — иначе сломаем V17.2 I1c contract.
@returns {boolean}

### `detectGhost`

V21 ghost-detect (diagnostic 2026-05-07) — auto-created employees
без identity-полей и без ФИО. Это «призраки» в реестре: попали через
auto-create из Jira participants (S5.1), но displayName был пустой
или равнялся accountId, а email/bb/cf не подтянулись.
Критерии (все одновременно):
1) inRegistry (есть в state.employees) — auto-create уже произошёл
2) НЕТ ни одного identity-канала: !email && !bitbucketLogin && !confluenceAccountId
3) ФИО пустой ИЛИ совпадает с jiraAccountId/key (factory fallback)
4) НЕ service-account (там критерии другие)
5) НЕ blocked (с [Х]/[X] — это уволенные, у них могут быть пустые поля)
Используется в Сканнере для исключения из counts + UI-фильтра.
