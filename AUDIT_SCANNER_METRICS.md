# AUDIT_SCANNER_METRICS — sub-tab «Метрики» внутри Сканнера команд

**Этап 11 / 14.** Аудит подвкладки «Метрики» (третья кнопка tab-bar после «Сегодня» и «Глубже»). Не путать с верхнеуровневым разделом «Метрики» из `views/metrics.js` — см. §0.

Дата: 2026-05-07.

---

## 0. Разграничение: top-level «Метрики» vs sub-tab «Метрики» внутри Сканнера

| | Top-level «Метрики» (раздел №2) | Sub-tab «Метрики» внутри Сканнера |
|---|---|---|
| Файл | `views/metrics.js` | `views/metricsDeep/index.js` + `categories/*.js` (6 файлов) |
| HTML host | `index.html` `#section-metrics` | `#ts2-metrics-mount` (внутри Сканнера) |
| Источник данных | `FilterEngine.getFiltered()` → `state.rows` (Реестр Призмы) | `model.participants` + `state.rows` через `dataAdapter.adaptModelToData()` |
| Уровень анализа | портфельный — релизы 1.20/1.21/1.22, SLA, нагрузка по командам/ролям | команда + люди — velocity, нагрузка, ревью, активность |
| Tech | inline-SVG sparkline + CSS conic-gradient | ECharts ESM (~1MB lazy import) — 60 чартов в 6 категориях |
| Точка входа | переход в раздел «Метрики» из главной навигации | `_scannerTab === 'metrics'` (`teamScanner2Renderer.js:1088`) + mount в `teamScanner2.js:1273-1289` |
| Модель данных | Жирная: rows проходят через все engines (`metricsEngine`, `riskEngine`) | Тонкая: ECharts чарты получают raw `{rows, participants, scanner, history}` |

**Семантическое пересечение есть**, и оно неприятное:
- Оба показывают «Распределение по релизам» (`views/metrics.js` pieStops vs `velocity-bar` стек).
- Оба показывают «Нагрузка/прогресс по командам» (`views/metrics.js` teams.map vs `quality-bugs-column` + `people-load-treemap`).
- Оба показывают «Топ-исполнители» (`views/metrics.js` assignees vs `people-wip-bar`).

**Это [F-DUP-1] — ниже в находках.** Если задумывалось как единое — это технический долг архитектуры. Если разное (1=стратегия, 2=team-tactics) — нужно явно разделить копирайтом и перестать дублировать pies/bars.

---

## Часть А — Текущее состояние подвкладки «Метрики» внутри Сканнера

### A1. Что показывается сейчас

Подвкладка рендерит scaffold с **6 категориями × 10 чартов = 60 ECharts** (см. `views/metricsDeep/index.js:67`):

1. **Темп и курс** (`velocity.js`, 10 чартов): bar готово/wip, burnup за квартал, combo, area capacity-vs-commitment, timeseries 6 спринтов, streamgraph типов работ, sankey scope churn, funnel pipeline, histogram lead-time, calendar heatmap.
2. **Качество** (`quality.js`, 10): doughnut статусы, doughnut scope, column риски, bubble severity×age, treemap эпиков, heatmap dwell, polar блокеров, radar 6 осей, bar точность спринта, wordcloud тегов.
3. **Команды и люди** (`people.js`, 10): WIP bar, treemap нагрузки, sunburst команда→эпик→FIO, polar OT по неделям, bubble wip×total×ot, treegraph команда→FIO, force graph соавторства, dependency wheel cross-team, heatmap ревью, subplot 4×1.
4. **Зависимости** (`dependencies.js`, 10): sankey cross-team, dep wheel, force graph блокеров, temporal graph 30→7→0, treegraph epic→sub→blocker, bubble возраст блокеров, funnel разрешения рисков, 3D risk×release×team, pairwise heatmap, deadline alerts.
5. **Активность** (`activity.js`, 10): timeline по часам, calendar квартал, git heatmap, час×день, streamgraph переходов, timeseries 30д, weekday bar, trend line 60д, area status 14д, histogram сессий.
6. **Здоровье** (`health.js`, 10): gauge здоровья, gauge уверенности, polar 5 компонентов, KPI bar (5 показателей), flame team×epic, flame person×signal, alerts active, alerts today, subplot 2×2, wordcloud зон риска.

Каждый чарт — `{id, title, sub, hint, build(data, palette)}`.

### A2. Откуда данные

`dataAdapter.adaptModelToData(model)` (`views/metricsDeep/dataAdapter.js`):

```
{
  rows:         window.state.rows                    // task-registry
  participants: model.participants                   // Scanner participants
  scanner:      { sprintGoal, spaces, fetchedAt, jiraBaseUrl }
  history:      window.state.metricsHistory          // ВСЕГДА ПУСТО (см. F-FAKE-3)
  hasReal:      participants.length > 0 || rows.length > 0
}
```

### A3. Что реально полезно

| Чарт | Что измеряет | Полезность |
|---|---|---|
| `quality-status-doughnut` | done/wip/blocked/todo по rows | Полезно — пересчитываются из state.rows. |
| `quality-scope-doughnut` | scope=Да/Нет/Требует | Полезно — реальные данные из контракта. |
| `quality-bugs-column` | риски и done по командам | Полезно — agg по `riskFlags`. |
| `people-wip-bar` | wip per ФИО (top-16) | Полезно — приоритет participants → realtime данные. |
| `people-load-treemap` | задачи по командам | Полезно. |
| `people-sunburst` | команда → эпик → исполнитель | Условно полезно (показывает структуру, но не «здоровье»). |
| `dep-deadline-alerts` | задачи отсортированные по близости deadline | Полезно. |
| `health-team-gauge` | произвольный 0-100 score | Условно — формула `((done-blocked)/total)*100 + 60` фактически attractive-but-meaningless. |
| `health-alerts-active` | блокеры/без assignee/OT/scope-required | Полезно. |
| `health-alerts-today` | сегодня/неделя дедлайн, без assignee, без даты | Полезно. |

### A4. Что декоративно

| Чарт | Почему декоративно |
|---|---|
| `velocity-burnup` | Y-ось `actual` синтезируется через **сигмоид** `1/(1+exp(-6*(t-0.5)))` от текущего done count. Это не реальный burnup. |
| `velocity-combo` | daily distribution = `doneTotal/days + sin(i*0.7)*0.4*base`. Сину-синтетика. |
| `velocity-area` | capacity = `avg*1.1`, commitment = `avg + sin(i*0.5)*0.3*avg`. Синтетика. |
| `velocity-timeseries` | 6 спринтов = `target * (0.7 + i*0.06 + sin(i)*0.1)`. Синтетика. |
| `velocity-streamgraph` | type-классификация делается через **regex по строке** — `back/be → BE`, всё прочее → `Analytics` (см. `velocity.js:236-241`). Шум. |
| `velocity-calendar` | Если `counts.size < 5` → fallback на `2 + sin(i*0.3)*2 + random()` за 90 дней. |
| `quality-bugs-bubble` | `t.age = max(t.age, days)` если есть createdAt, иначе `Math.random()*30+10`. |
| `quality-dwell-heatmap` | Все ячейки — synthesized: `heat * (rows/5) + Math.random()*2`. Полностью fake. |
| `quality-blockers-polar` | реален. |
| `quality-estimate-bar` | «Точность спринта» = `done/total*100`. Это **не точность оценок**, а progress %. Намеренное введение в заблуждение. |
| `quality-tags-wordcloud` | bubble layout через scatter — нет реального wordcloud-алгоритма. |
| `people-ot-polar` | weekly distribution = `otCount/weeks + sin(i*0.6)*0.5`. Синтетика. |
| `people-cross-team-wheel` | если `links.length === 0` → **синтезирует случайные** связи `Math.random() > 0.5`. |
| `people-review-heatmap` | reviewer×author значения — `Math.abs(sin(i*0.7+j*0.5))*8`. Полностью fake. |
| `people-subplot` | 4 sparkline'а из rows, реальное; но `quality` = «без рисков», что инвертировано против ожиданий. |
| `dep-sankey` | links между командами = `Math.cos(i*0.7+j*0.5)*8+1`. Полностью fake. |
| `dep-temporal-graph` | snapshots = берёт `blockers.slice(0, factor)` от текущих, синтезирует «эволюцию». Вводит в заблуждение. |
| `dep-blocker-bubble` | если нет `blockingDeadline` — `5 + sin(i)*10`. release = `i % 4`. |
| `dep-resolve-funnel` | flagged → triaged 70%, escalation 40%, resolved 25% — **hardcoded коэффициенты**, не данные. |
| `dep-3d-risk` | весь массив сгенерирован через `sin/cos`. Полностью fake. |
| `dep-pairwise-heatmap` | values = `sin(i*0.7+j*0.5)*6`. Fake. |
| `dep-deadline-alerts` | если нет deadlines — fallback `i*2-4`. |
| `activity-timeline` | distribution = `exp(-(i-14)²/18)*12`. Fake. |
| `activity-calendar` | `sin(i*0.2)*8 + random()*3` за 4 квартала. Fake. |
| `activity-git-heatmap` | 53×7 матрица `random()`. Fake. |
| `activity-timeline-heatmap` | час×день с rule «10-18 ПН-ПТ» × sin × random. Fake. |
| `activity-streamgraph` | переходы между статусами синтезированы. Fake. |
| `activity-timeseries` | events = `15 + sin(i*0.4)*8 + random()*4`. Fake. |
| `activity-weekday-bar` | `40 + cos(i*0.4)*8`. Fake. |
| `activity-trend-line` | 60 точек = `40 + i*0.4 + sin*10`. Fake. |
| `activity-area-status` | 14 дней × 4 статуса синтез. Fake. |
| `activity-session-histogram` | hardcoded `[4,22,38,28,16,9,3]`. Fake. |
| `health-flame-team`/`person` | реальное (агрегаты по rows). |
| `health-kpi-bar` | KPI «В срок=64» и «WIP=72» — **hardcoded**, не вычисляются. |
| `health-conf-gauge` | `planned/total*100` — где planned = `!isUnassigned`. Семантика «уверенность» некорректна (показывает заполненность поля релиз). |
| `health-team-gauge` | формула `((done-blocked)/total)*100 + 60` — `+60` это сдвиг чтобы выглядело прилично. |

**Итог А4:** ~**40 из 60 чартов (66%)** содержат синтетические данные через sin/cos/random или hardcoded числа. Это «графики ради графиков» — UI-демонстрация ECharts, не аналитика.

### A5. Что вводит в заблуждение

1. Тимлид смотрит «velocity 6 спринтов» — видит красивый график с tendline. Реально это `target*(0.7+i*0.06+sin(i)*0.1)`. Решение, принятое на этом графике, ошибочно.
2. «Точность спринта по командам» (`quality-estimate-bar`) подписан как «Точность» но считает done%. У Сканнера в `renderEstimateAccuracy` есть **настоящая** estimate accuracy (`computeEstimateAccuracy`) — она в подвкладке «Сегодня → Операции», не в «Метрики».
3. «Воронка разрешения рисков» (`dep-resolve-funnel`) показывает шаги триаж/эскалация/resolved, которых в системе **не существует** (нет таких статусов).
4. «Эволюция блокеров 30→7→0» (`dep-temporal-graph`) подразумевает временное измерение, но снимки синтезированы из текущего набора `blockers.slice(...factor)`.
5. «Здоровье команды» gauge с +60 сдвигом — у одной и той же команды без багов и без OT может быть 60-90, что выглядит как «всё хорошо», даже когда reality flat.
6. «Активность» вся категория (10 чартов) **полностью отвязана от данных** — git heatmap, timeline по часам, weekday bar, длительность сессий. Тимлид может принять это за «когда команда работает», но это шум.

### A6. Качество данных, пропуски, выбросы

- `metricsHistory` (`window.state.metricsHistory`) — **никем не пишется** в проекте. `dataAdapter` его читает, но всегда получает `[]`. История трендов отсутствует.
- `participants[].issuesNow`, `.activeIssuesCount`, `.blockedCount` — приходят из enrichment, но не валидируются на NaN. В `_byAssignee` (`people.js:21`) `wip = (issuesNow || []).length` — ок, но `done = max(0, activeIssuesCount - issuesNow.length)` — это не «done», а просто остаток. Семантика искажена.
- `rows[].riskFlags` — есть в registry, но в Сканнере у `participants` его нет — поэтому радар (`buildTeamRadar`) и flame (`buildFlamePerson`) работают только если открыт Реестр.
- `rows[].blockingDependency` — обычно булев флаг; используется как boolean везде, но `quality-blockers-polar` считает это просто `length` от `riskFlags`.
- Выбросы — никаких guard'ов на `Infinity`/NaN; например `commits * 50` в LOC не имеет cap.
- `people-network-graph` строит O(N²) edges по эпикам (`people.js:248-251`); при больших командах +10k edges → ECharts падает.

### A7. Производительность

- **ECharts весит 1MB** lazy-loaded (`views/metricsDeep/index.js:94`) — хорошо, но на первом hit на вкладку — задержка.
- `_initChart` инициализирует 60 чартов **батчами по 8** (`index.js:120-138`) с `requestIdleCallback`. Раньше — 60 sync init = ~400ms jank. Сейчас приемлемо, но всё ещё ~10 батчей = 1.2s до конца mount.
- `unmount()` корректно dispose'ит instance'ы (`index.js:194-217`) + снимает resize listener — после V21 audit A1/A4 fix.
- В `teamScanner2.js:1266` `MetricsDeep.unmount(this._container)` вызывается **на каждом scanner re-paint** (search keystroke, refresh) — это правильно, но означает что 60 instance'ов create/dispose цикл работает на каждый keystroke в search box. Дорого.
- Кешируется только `_quarterDayLabelsCache` (1 запрос/день). Все остальные чарты пересчитывают agg (rows.filter цепочки) с нуля на каждый mount. На 5k rows × 6 категорий × 10 чартов = `O(rows × charts)` = ~300k операций filter каждый раз.
- `IntersectionObserver` упомянут в комментарии (`index.js:8, 88`) но **на самом деле не применяется** — `processBatch` инициализирует все 60 чартов сразу, без IO. Mount-комментарий говорит «init только когда виден», но код это не делает. Расхождение реализации и доки.
- `people-network-graph` (`people.js:241-269`) edges = O(epics × FIO²). При 50 эпиках × 10 FIO в каждом = 25k edges → `ECharts.graph` falls.

---

## Часть Б — Какие метрики команды реально стоит показывать

### Throughput
- **Velocity (issue-count)** скользящее за 6 спринтов: реальная медиана + 25/75 percentiles. Не среднее (экстремумы искажают).
- **Throughput штук в неделю**: `done events / week` — стабильнее velocity (не зависит от story points).
- **Lead time** distribution: createdAt → doneDate. P50, P75, P90.
- **Cycle time** distribution: workStartDate → doneDate. P50, P75, P90.
- **Кумулятивный flow diagram (CFD)**: stacked area по статусам за 30/60/90 дней. Один из самых ценных аналитических чартов.

### Качество
- **Bug rate**: `bugs created / done issue` за период. Тренд up = качество падает.
- **Escaped defects**: bugs зарегистрированные после закрытия release / done.
- **Reopen rate**: `transitions Done → reopened / done count`. Из `bigMetrics.reopenRate` — уже считается.
- **% задач требующих доработки** (re-estimation, scope-change после старта).
- **Defect age**: P50 от bug.created до bug.done.

### Предсказуемость
- **Estimate accuracy** (`computeEstimateAccuracy` уже существует): planned hours vs actual logged. Distribution ratio вокруг 1.0.
- **Sprint commit accuracy**: `closed in sprint / committed at start of sprint`. Live data.
- **Sprint goal slope** (есть `computeSprintGoalSlope`): тренд burndown в реальных днях.
- **Carry-over rate** (`computeCarryOverRate` есть): доля issues перешедших в следующий sprint.
- **Deadline hit rate**: % задач сделанных <= commitDate.

### Здоровье
- **WIP per assignee**: топ-K с overlay порога (>4 → flag). Существует в `people-wip-bar` с реальными данными. Доработать выделение порогов.
- **Context switches per person** (`computeContextSwitches` есть): реальное число issue-keys за 72ч окно.
- **Параллельные задачи** = WIP, но с отметкой high-priority.
- **After-hours ratio** (Z10 burnout сигнал): доля events ночь/выходные.
- **Days since last commit / activity** per person.
- **Knowledge breadth**: число уникальных файлов/эпиков/компонентов которыми занимался человек за 30 дней. Низкий = bus-factor risk.

### Распределение нагрузки
- **Gini coefficient WIP**: 0=равномерно, 1=один человек везде. Считается из `_byAssignee` за 1 пас.
- **Bus-factor задач**: % задач где `unique authors of related commits ≤ 1`. Уже есть `detectSoloAuthorFiles`.
- **Cross-team load**: % cross-team PRs (есть `participant.crossTeam.ratio`).

### Ревью
- **Time to first review** (TFR): median часов от opened до first review comment. Есть `computePrCycleTime` / `computeCodeReviewVelocity`.
- **Time to merge**: median opened → merged.
- **Review depth**: avg comments на PR. Низкий = rubber-stamp ревью.
- **PR size distribution**: lines changed buckets `<10/10-50/50-200/>200`. Большие PR коррелируют с багами.
- **Review queue depth**: открытые PR сейчас vs throughput. Если queue растёт → reviewer-bottleneck.

### Связь с бизнесом
- **% времени bugfix vs feature vs tech debt vs ops**: классификация по `category`/labels.
- **Эпик throughput**: задачи закрыты per epic per week — кто из эпиков движется, кто завис.
- **Scope churn rate** (`buildScopeChurnDetail` есть): % rows где scope менялся в этом sprint.
- **Onboarding ramp** (`computeOnboardingRamp` есть): время от joinDate до first done.

---

## Часть В — Дизайн обновлённой подвкладки

### B1. Иерархия

```
┌─ HERO (всегда виден, 1-line) ──────────────────────────────────┐
│ Health 78  ·  Confidence 64%  ·  Velocity ↗+12%  ·  WIP ▲4    │
└────────────────────────────────────────────────────────────────┘

3 главных графика (visible-by-default):
┌─ CFD (cumulative flow) 90д  ─────┐ ┌─ Throughput 12 wk ───────┐
│ stacked todo/wip/review/done    │ │ bar + 4-week median line │
└──────────────────────────────────┘ └──────────────────────────┘
┌─ Lead time histogram + P50/P90 ──────────────────────────────┐
│ buckets <3д / 3-7 / 1-2н / 2-4 / >4н ; маркеры P50, P90      │
└──────────────────────────────────────────────────────────────┘

«Глубже» секции (collapsed by default):
▶ Качество — bug rate, reopen, escaped, defect age (5 чартов)
▶ Предсказуемость — estimate accuracy, sprint commit, carry-over (4)
▶ Команда и нагрузка — WIP per FIO, gini, after-hours, switches (5)
▶ Ревью — TFR, time-to-merge, PR size, queue depth (4)
▶ Бизнес-микс — bugfix/feature/debt, эпик throughput (3)
```

**Итого 21 чарт вместо 60.** Каждый — реальные данные.

### B2. Способы визуализации

| Метрика | Тип | Почему |
|---|---|---|
| KPI hero | большая цифра + delta | Беглый взгляд утром. |
| Velocity, throughput | bar + line (median) | Тренд + центральная тенденция. |
| Lead/cycle time | histogram + P50/P90 markers | Distribution важнее среднего. |
| CFD | stacked area | Канонический способ увидеть flow проблемы. |
| Bug rate | line за 12 недель | Тренд видно мгновенно. |
| WIP per person | bar + threshold (4) line | Кто перегружен. |
| Gini | gauge 0-1 | Один номер. |
| After-hours | sparkline + ratio number | Trend тут ценнее моментального snapshot. |
| TFR / time-to-merge | box plot или dual-line P50/P90 | Variance важнее среднего. |
| Бизнес-микс | stacked bar (% по неделям) | Доли видны. |

**Антипаттерны визуализации (явно убрать):**
- **3D scatter** для риск × release × team — глаз не считает 3D. Заменить heatmap.
- **Wordcloud** тегов — не аналитический инструмент, decoration.
- **Sunburst** команда→эпик→FIO — clicky-clicky drilldown лучше как table.
- **Streamgraph** transitions → CFD читается лучше.
- **Funnel** для триаж/escalation — нет таких статусов в системе.
- **Polar bar** для блокеров/OT — углы не читаются как количества.

### B3. Сравнения

Для каждого чарта три «сравнительных режима»:

1. **vs прошлый период** — сегодняшнее значение vs 7/30 дней назад (delta + sparkline).
2. **vs другие команды** — отдельный вид «team comparison» с одной осью на команду.
3. **vs цель** — порог (например WIP ≤ 4) показан как horizontal line.

Использовать `metricsHistory` (которая сейчас не пишется — см. F-FAKE-3) с rolling 90 дней snapshots.

### B4. Drill-down

Каждый чарт click → таблица issues которые в него вошли. Технически:
- ECharts `click` event → emit `metricsDeep:drilldown` с `{chartId, dimension, value}`.
- Глобальный handler открывает существующую panel со списком issues, фильтрованных по dimension.

Сейчас drill-down **не реализован**.

### B5. Объяснимость

Сейчас `hint` показывает 1 строку под чартом. Этого мало.

Каждая метрика должна иметь:

1. **Что значит** — 1-2 предложения human-readable.
2. **Как считается** — формула простыми словами.
3. **Что делать** если показатель плохой — 2-3 actionable шага.
4. **LLM-объяснение** — кнопка «Объясни эти данные» → GigaChat запрос с контекстом данных + рекомендации.

Реализация: per-chart `<details>` под графиком с meta. `__meta__` блок в registry:
```
{ id, title, sub, hint,
  build, meta: { what, how, action_if_bad, llm_prompt_template } }
```

### B6. Антипаттерны метрик (из engineering-management practice)

Эти метрики **категорически нельзя** показывать в team-dashboard:

| Антипаттерн | Почему плохо | Сейчас в коде? |
|---|---|---|
| **Individual velocity / story points per person** | Поощряет inflation оценок, ломает team estimation | НЕТ (v22 audit S2 убрал hardcoded fallback ФИО) |
| **Lines of code per person** | Поощряет шум, наказывает refactor/удаление | ДА: Z6 `computeLocDelta` (помечено «гадкая метрика, рекомендуется к закрытию через config-flag») — см. `teamScanner2PersonMetrics.js:135-159`. Сейчас не отображается в metricsDeep, но в person-panel всё ещё видна. |
| **Hours logged per person ranking** | Поощряет «sitting time», не output | ДА: Z8 `computeHoursLogged` — отдельный per-person chip. |
| **Productivity score** (composite throughput) | Compress'ит сложный output до одной цифры, gamification → harm | ДА: Z1 `computeProductivityScore` — `commits×1 + pr×3 + conf×1.5 + reviews×2 + tests×2 + closed×5`. Magic weights. См. `teamScanner2PersonMetrics.js:39-61`. |
| **Burnout flag per person** (видно тимлиду) | HR-чувствительно, может быть предвзято | ДА: Z10 — labeled «Manager-only». Этично-сомнительно. |
| **% времени за компьютером / late-night ratio** sub-метрика | Surveillance | ДА: компонент Z10. |
| **Code review «качество ревью»** через depth | Поощряет nitpicking comments | Полу-да: comments-per-PR в `prMetrics`. |
| **Number of bugs per developer** | «Кто меньше багов нашёл» — поощряет hide | Не явно, но `health-flame-person` показывает per-person blocked/risks. |
| **Closed-tickets count ranking без context** | Игнорирует сложность | Полу-да: `people-wip-bar` сортирует по wip-count. |

---

## Топ-10 метрик которые точно стоит иметь

1. **Throughput (issues/week)** — простая counted метрика без story points. Стабильный baseline.
2. **Lead time distribution + P50/P90** — реально показывает «сколько занимает задача от начала до конца». P90 раннее предупреждение о застрявших.
3. **Cycle time distribution + P50/P90** — то же без waiting time. Выявляет проблемы execution.
4. **Cumulative Flow Diagram 90д** — самый информативный one-liner про flow. Бутылочные горлышки видны мгновенно (тонкая полоса = bottleneck).
5. **WIP per assignee + threshold 4** — единственный способ увидеть перегруз без surveillance.
6. **Estimate accuracy** (planned vs actual ratio distribution вокруг 1.0) — главная метрика предсказуемости.
7. **Reopen rate / escaped defect rate** — главные quality сигналы. `bigMetrics.reopenRate` уже считается.
8. **Time to first review (TFR) P50** — рост → bottleneck в ревью. Существует `computeCodeReviewVelocity`.
9. **Bug rate trend** (bugs created / total issues created) за 12 недель — single-number health индикатор.
10. **Bus-factor / solo-author files count** — критичная organizational risk metric. `detectSoloAuthorFiles` существует.

---

## Топ-5 метрик от которых лучше отказаться (есть в текущей версии)

1. **«Velocity 6 спринтов»** (`velocity-timeseries`) — синтетический tendline через `target*(0.7+i*0.06+sin(i)*0.1)`. Тимлид принимает решения по cos-функции. **Удалить или заменить настоящей серией из `metricsHistory`.**
2. **«Точность спринта по командам»** (`quality-estimate-bar`) — labeled «точность», но считает progress %. Замена: использовать `computeEstimateAccuracy` (он уже есть в Сканнере, но в другой подвкладке).
3. **«Эволюция блокеров 30→7→0»** (`dep-temporal-graph`) — синтезирует историю из текущих блокеров через `factor`. Невозможно использовать для решений. **Удалить целиком до появления реальной истории.**
4. **«Voronka разрешения рисков»** (`dep-resolve-funnel`) — `triaged 70%, escalation 40%, resolved 25%` — hardcoded. Нет таких процессов в системе. **Удалить.**
5. **Productivity score** Z1 (`computeProductivityScore`) — composite с magic weights, surveillance-tier. Вводит в заблуждение, может оптимизироваться (Goodhart's law). **Удалить или сделать opt-in feature flag manager-only с big warning.**

Дополнительно: вся категория **«Активность» (10 чартов)** — все 10 синтетические. Удалить целиком до появления реальных event timestamp данных.

---

## Находки

Формат: `раздел | файл:строка | severity | проблема | решение | трудозатраты`

| # | Раздел | Файл:строка | Severity | Проблема | Решение | Трудозатраты |
|---|---|---|---|---|---|---|
| F-FAKE-1 | velocity | `views/metricsDeep/categories/velocity.js:106-111` | critical | `velocity-burnup` actual = sigmoid от текущего done count. Это не реальный burnup. | Использовать `metricsHistory` или Jira changelog. До тех пор — empty-state «требуется ≥2 daily snapshot». | M |
| F-FAKE-2 | velocity | `velocity.js:140-144,173,196,242-256,409-411` | critical | 5 чартов из 10 в категории «Темп» используют sin/cos/random. | Удалить combo, area, timeseries, streamgraph, calendar fallback — оставить только bar/burnup/funnel/histogram которые на real rows. | M |
| F-FAKE-3 | data-source | `views/metricsDeep/dataAdapter.js:43-44` | critical | `metricsHistory` читается, но **нигде в проекте не пишется** — `grep` показал 0 writers. История трендов всегда пуста. | Добавить snapshot writer (1/день) — agg от `state.rows + scanner model` в `state.metricsHistory`, persist через `dataStore`. | L |
| F-FAKE-4 | activity | `categories/activity.js:17,42-46,73-79,99-104,128-130,148-149,170,187-188,213-214,229-230` | critical | **Вся категория** «Активность» (10 чартов) — синтетика, нет ни одного real-data extractor'а. | Удалить категорию целиком до появления реальных event timestamps. ECharts чарты доступны 60→50, но честнее. | S |
| F-FAKE-5 | dependencies | `dependencies.js:24-31,113-141,236-244,261-272` | critical | dep-sankey / dep-temporal / dep-3d / dep-pairwise — все генерируют связи через sin/cos. | Заменить на real-data из `participant.teamDependency`/`crossTeam`/`computeCrossTeamDependencies`. Где данных нет — null → empty-state. | M |
| F-FAKE-6 | quality | `quality.js:166-181,289-293,331-340` | high | `quality-dwell-heatmap`, `quality-estimate-bar`, `quality-tags-wordcloud` — synthesized. | dwell-heatmap → `participant.dwell` agg реально; estimate-bar → `computeEstimateAccuracy`; wordcloud → удалить. | M |
| F-FAKE-7 | people | `people.js:140-146,290-294,326-335` | high | `people-ot-polar`, `people-cross-team-wheel` (random links), `people-review-heatmap` — synthesized. | ot-polar: agg по `participant.timelinePrev` worklog ts; review-heatmap: реальное из `bb.prItems[i].reviewers`. cross-team: убрать synthetic fallback. | M |
| F-FAKE-8 | health | `health.js:15` | high | gauge формула `((done-blocked)/total)*100 + 60` — magic +60 чтобы выглядело прилично. | Composite explicit: 4 компонента × вес, правильно нормализован, без сдвига. Использовать `computeTeamHealthScore` который уже есть. | S |
| F-FAKE-9 | health | `health.js:102,105,106` | high | `health-kpi-bar` hardcoded values «В срок=64», «WIP=72», «Снятие блоков=78». | Брать из `computeBlockerMTTR`, `bigMetrics.sprintCommit`, etc. — все эти данные уже есть в Insights. | S |
| F-LIE-1 | quality | `quality.js:282-309` | critical | `quality-estimate-bar` подписан «Точность спринта», считает progress%. Введение в заблуждение. | Заменить на `computeEstimateAccuracy` (уже существует в `teamScanner2Insights.js`). | S |
| F-LIE-2 | dependencies | `dependencies.js:206-232` | critical | `dep-resolve-funnel` имитирует процесс triage→escalation→resolved которого нет в проекте. | Удалить чарт. | XS |
| F-LIE-3 | dependencies | `dependencies.js:113-142` | critical | `dep-temporal-graph` создаёт иллюзию истории через `blockers.slice(...factor)`. | Удалить или заменить на real history snapshots (после F-FAKE-3). | S |
| F-LIE-4 | health | `health.js:45-67` | high | `health-conf-gauge` подписан «Уверенность», считает `!isUnassigned/total` — это заполненность поля релиз. | Использовать `computeSprintConfidence` (уже есть). | S |
| F-DUP-1 | architecture | `views/metrics.js` vs `views/metricsDeep/` | high | Pie релизов и treemap команд дублируют топ-уровень «Метрики» и sub-tab «Метрики» Сканнера. | Чёткое разделение по копирайту: top-level = strategy/portfolio, sub-tab = team tactics. Убрать ре-rendering pie релизов в Сканнере. | M |
| F-DUP-2 | views | `quality-status-doughnut` (quality.js) vs `health-subplot` 2x2 (health.js) | low | Оба показывают done/wip/blocked/ot. Дубль. | Оставить только `health-subplot` (4 числа крупно), удалить doughnut. | XS |
| F-DUP-3 | views | `velocity-burnup` vs `renderBurnupSparkline` | medium | Inline SVG burnup в «Сегодня» tab + ECharts burnup в «Метрики» — два независимых рендера. | Унифицировать data source через `buildBurnupData` (единственный). | S |
| F-PERF-1 | mount | `views/metricsDeep/index.js:88` (комментарий vs реализация) | medium | Комментарий говорит про IntersectionObserver, но реализация `processBatch` инициализирует все 60 чартов сразу. Расхождение doc vs code. | Либо реально использовать IO (init when visible), либо удалить misleading комментарий. | S |
| F-PERF-2 | mount | `teamScanner2.js:1266` | high | `MetricsDeep.unmount()` вызывается на **каждый** scanner re-paint (search keystroke, refresh). 60 instance'ов create/dispose цикл на каждый ввод символа. | Не unmount если `_scannerTab !== 'metrics'`. Если активна tab — `inst.setOption(opt)` вместо dispose+init. | M |
| F-PERF-3 | charts | `velocity.js`, `quality.js`, `people.js` | medium | Каждый extractor делает 4-8 `rows.filter()` цепочек. На 5k rows × 60 чартов = ~300k filter passes на mount. | Один agg-проход по rows на категорию, передавать в build'еры. | M |
| F-PERF-4 | charts | `people.js:241-269` (network-graph) | high | edges = O(epics × FIO²). При 50 эпиках × 10 FIO в каждом = 25k edges → ECharts падает или фризит. | Cap edges <= 200 (sample); отдельный «expand» button. | S |
| F-PERF-5 | charts | `quality.js:316-360` (wordcloud) | low | Bubble layout через scatter — нет реального wordcloud-алгоритма, при множестве тегов — overlap. | Удалить (см. Top-5). Если оставить — использовать `echarts-wordcloud`. | XS |
| F-A11Y-1 | charts | все category-файлы | medium | Чарты не имеют `aria-label`. Screen reader не читает. | `option.aria = { enabled: true, decal: { show: true } }`. | S |
| F-A11Y-2 | colour | все category-файлы | medium | Цвета через индексы palette[0-4]; нет проверки контраста ECharts theme. | Использовать `buildPrizmaEchartsTheme` уже есть, но нужен audit для colour-blind. | S |
| F-EXPL-1 | UX | `views/metricsDeep/index.js:48-55` | medium | Hint строка под графиком 1-line. Нет «как считается», нет «что делать». | `<details>` per-chart с {what, how, action_if_bad}. | M |
| F-EXPL-2 | UX | везде | medium | Нет drill-down: клик по столбцу → таблица issues. | Добавить ECharts `click` → emit drilldown event → existing detail panel. | L |
| F-ETHIC-1 | privacy | `teamScanner2PersonMetrics.js:39-61` (Z1) | high | Productivity score composite. Magic weights, surveillance-tier. Goodhart's law (можно оптимизировать). | Удалить или сделать opt-in feature flag manager-only с big warning. | S |
| F-ETHIC-2 | privacy | `teamScanner2PersonMetrics.js:135-159` (Z6) | high | LOC delta — «гадкая метрика» (комментарий автора). Поощряет шум. | Удалить или скрыть за config-flag (комментарий уже это говорит — выполнить). | S |
| F-ETHIC-3 | privacy | `teamScanner2PersonMetrics.js:217-280` (Z10 burnout) | medium | Burnout flag per person — HR-чувствительно. weekend/late-night/wip/slowdown — surveillance. | Оставить только agg на team-level (avg ratio across team), убрать per-person view (или явный consent). | M |
| F-ETHIC-4 | privacy | `teamScanner2PersonMetrics.js:169-178` (Z8) | medium | Hours logged per person — поощряет «sitting time». | Скрыть в team-aggregate, не показывать ranking. | S |
| F-DATA-1 | data | `people.js:21` | medium | `done = max(0, activeIssuesCount - issuesNow.length)` — это не done, а residual. Семантика искажена. | Использовать реальный `closedToday`/`donePillCount`. | S |
| F-DATA-2 | data | `dataAdapter.js:43-44` | medium | `metricsHistory` без guard на shape — может быть array of arbitrary objects. | Schema validate before use. | S |
| F-DATA-3 | data | `views/metricsDeep/index.js:165-170` | low | `data.hasReal` = `participants.length > 0 || rows.length > 0` — слишком слабо. Один participant = «реальные данные» для всех 60 чартов. | Per-chart guard: `requiredFields = [...]`. | S |
| F-NAV-1 | UX | `teamScanner2Renderer.js:50-66` | low | tab-bar 3 кнопки, «Метрики» = 60 чартов сразу. Нет суб-навигации внутри. | Добавить категорийные suntabs внутри metrics: `Темп / Качество / Команда / Зависимости / Ревью`. | S |
| F-NAV-2 | UX | `views/metricsDeep/index.js:74-79` | low | 6 секций раскрыты по умолчанию = большая страница. | По умолчанию открыты только «Темп» и «Здоровье»; остальные `<details>` свёрнуты. | XS |
| F-NAV-3 | UX | везде | medium | Нет фильтра по периоду (7д/30д/90д/quarter). | Глобальный селектор period вверху + проброс в data adapter. | M |
| F-COPY-1 | i18n | `categories/*.js` | low | Подписи серий — Mix RU/EN: «velocity», «commitment», «engagement», «Triaged», «Resolved». | Перевести на русский (брендбук §4). | XS |
| F-COPY-2 | i18n | `velocity.js:469` | low | `'Pipeline'+"'"+'а'` — escape сломан. | Просто строка. | XS |
| F-TEST-1 | tests | нет файла | medium | Нет unit-тестов на extractor'ы (`buildVelocityBar`, etc.) — нельзя гарантировать что замена sin/cos на real data не сломает чарты. | Snapshot tests на ECharts option output для 5 ключевых чартов. | M |
| F-DOC-1 | docs | `views/metricsDeep/index.js:8` | low | Комментарий обещает IntersectionObserver, реализация — batch processing. | Привести в соответствие. | XS |

**Итого: 36 находок** (5 critical, 9 high, 13 medium, 9 low).

---

## Сводка приоритетов

### Critical (исправить срочно — сейчас вводит в заблуждение)

- F-FAKE-1, F-FAKE-2 (velocity 5/10 синтетика)
- F-FAKE-3 (`metricsHistory` пуст, тренды невозможны)
- F-FAKE-4 (вся «Активность» fake)
- F-FAKE-5 (4/10 dependency charts fake)
- F-LIE-1, F-LIE-2, F-LIE-3 (estimate-bar, resolve-funnel, temporal-graph — врут о смысле)

### High (искажают данные или влияют на perf)

- F-FAKE-6, F-FAKE-7, F-FAKE-8, F-FAKE-9
- F-LIE-4
- F-DUP-1
- F-PERF-2, F-PERF-4
- F-ETHIC-1, F-ETHIC-2

### Medium (UX / a11y / explainability)

- F-PERF-1, F-PERF-3
- F-A11Y-1, F-A11Y-2
- F-EXPL-1, F-EXPL-2
- F-ETHIC-3, F-ETHIC-4
- F-DATA-1, F-DATA-2
- F-NAV-3
- F-TEST-1

### Low (косметика, доки)

- F-DUP-2
- F-PERF-5
- F-DATA-3
- F-NAV-1, F-NAV-2
- F-COPY-1, F-COPY-2
- F-DOC-1
- F-DUP-3 (medium-low)

---

## Финальная рекомендация

Подвкладка «Метрики» на 2026-05-07 — **демонстрационная витрина ECharts, а не аналитический инструмент**. ~66% чартов содержат синтетику через sin/cos/random. Тимлид, принимающий решения по этим графикам, оперирует на cos-функциях и hardcoded коэффициентах.

Минимальный план рефакторинга:

1. **Сначала включить `metricsHistory`** (F-FAKE-3, L-effort) — без истории все trend-чарты невозможны.
2. **Удалить категорию «Активность» целиком** (F-FAKE-4, S-effort) — никаких потерь, только честность.
3. **Заменить velocity-fakes на real burnup из history** (F-FAKE-1/2, M).
4. **Заменить confused chart titles на правильные** (F-LIE-1..4, S).
5. **Удалить ethical metrics** (Z1 productivity, Z6 LOC) или сделать manager-only opt-in (F-ETHIC-1/2, S).
6. **Сократить с 60 до 21 чарта** по дизайну B1.
7. **Добавить drill-down + per-chart explainability** (F-EXPL-1/2, M+L).

После шагов 1-5 (~3-5 дней работы) подвкладка станет honest. После 6-7 (~2 недели) — реально полезной для тимлида.
