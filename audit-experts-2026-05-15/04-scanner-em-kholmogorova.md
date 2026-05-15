# Алла Холмогорова — Сканнер команд: аудит EM-полезности

> Кто я: Engineering Manager / Director of Engineering Productivity. 10 лет — Google
> (SRE-org, DORA-rollout 2018–2020), Meta (Developer Infrastructure, SPACE-pilot
> 2021), Stripe (Engineering Excellence, DX-framework + Calibration). Делала
> внутренние engineering-dashboards для команд по 200–800 человек, видела как
> хорошие метрики ломают команды и как «грязные» метрики экономят квартал.
>
> Что смотрела: вкладку «Сканнер команд 2.0» — все 16 файлов модуля
> (`integrations/teamScanner2*.js` ≈ 15.7 kLOC, `jiraHygiene.js` 276 LOC),
> docs/scanner2-overview.md, docs/v20-scanner2-handoff.md, NIGHT_2026-05-11_SUMMARY,
> AUDIT_SCANNER, AUDIT_SCANNER_METRICS. Не правила ни строчки кода. Цитирую
> формулы дословно — это единственный способ показать что метрика на самом деле
> измеряет.

---

## TL;DR

1. **Это уже не «дашборд», это полноценный EM-toolkit уровня internal-Stripe.**
   `teamScanner2Enrichment.js` + `teamScanner2Insights.js` дают ~40 метрик, из
   которых ≈12 я бы прямо взяла в production EM-stack (sprint pace+slope+R²,
   blocker dwell с status-aware thresholds, CR-velocity медиан, PR throughput
   с mergeRate flag, Gini CR-load, weekday-adjusted anomaly, zombie multi-source,
   bus-factor на файловом уровне, hygiene-score с 12 правилами, scope churn,
   carry-over rate, sprint confidence). Это не игрушки.

2. **Но в DNA сидят 3 опасных anti-pattern'а, которые в продакшене Сбера
   разорвут команду:** `computeProductivityScore` (Z1) с весовыми
   коэффициентами на коммиты+PR+ревью+закрытия per-person, `burnout flag` с
   weekend/lateNight-ratio per-person и Action Queue top-5 ranked list людей
   с severity score. Все три — классические Goodhart-ловушки в одной коробке.
   Без явного guard'а «нельзя в performance review» эти метрики **гарантированно**
   просочатся в HR-аттестацию через год после деплоя. Я писала такие функции
   в Google в 2017 — мы их выпилили в 2019 после двух кризисов.

3. **Frameworks-консистентность хорошая, но не отрефлексированная.** DORA — есть
   все 4 ключевых метрики как proxy. SPACE — четыре из пяти dimensions покрыты
   (Satisfaction нет совсем — sentiment не считается). DX framework Abi Noda —
   feedback loops / cognitive load / flow state НЕ покрыты, хотя
   `contextSwitches` это ровно flow-state proxy и его никто так не позиционирует.
   Сейчас файл `docs/scanner2-overview.md` НЕ упоминает ни одного фреймворка —
   это означает что метрики собирались интуитивно, и при первом же выезде на
   external benchmark будет конфуз.

4. **Identity-deterministic attribution — это серебряная пуля, которую я нигде
   не видела.** `state.employees[].{email, jiraAccountId, bitbucketLogin,
   confluenceAccountId}` (`CLAUDE.md` §3 контракт V17.2 I1c) + `[X]`-фильтрация
   уволенных в `teamScanner2Enrichment.js:182` через
   `Utils.DEACTIVATED_LABEL_RE` — это уровень data-quality, которого Meta не
   имела пять лет. Это надо беречь как алмаз. Один fuzzy-fallback и весь дашборд
   превращается в политическое оружие.

5. **80/20 — текущий «Глубже» с 25+ tile'ами это перегруз.** EM открывает дашборд
   утром на 90 секунд. Из 40+ метрик действительно ежедневно
   actionable — 6: Sprint pace с R², Action Queue top-5, Zombies, Stale PRs,
   blocker MTTR aggregate, hygiene-score. Остальное — ретро/PI/calibration mode.
   Hide-by-default + persona-разделение («утро» vs «ретро») снизит cognitive
   load и спасёт от метрики-усталости.

---

## Что Сканнер делает правильно (отметить!)

Это важно проговорить — большая часть Сканнера сделана на уровне, который я
вижу у топ-5% engineering-orgs.

### 1. Identity-deterministic attribution с auto-detection of leavers

`integrations/teamScanner2Enrichment.js:182` — `DEACTIVATED_LABEL_RE`,
`_isDeactivatedByLabel` через `[X]`/`[Х]`/`[B]`/`[В]` suffix matching и
service-account detection в `_detectServiceAccountByKey` (regex по `^cab-sa-|sa-|
svc-|bot-|system-`). В Meta мы 18 месяцев потратили на эквивалент —
*People-Engineering merge dedup pipeline*. Здесь это два regex.

Контракт V17.2 I1c прямо запрещает fuzzy-match. Это критически важно — fuzzy
attribution разрушает доверие к дашборду в один скандал.

### 2. Status-aware dwell thresholds — это редкая зрелость

`teamScanner2Enrichment.js:214-220`:

```js
DEFAULT_DWELL_THRESHOLDS = {
  codeReview:  8,   // Code Review > 8ч = блокер
  qa:         16,
  inProgress: 48,
  todo:       72,
  default:    24,
};
```

В большинстве дашбордов «issue в статусе >24ч = blocker». Это враньё:
семантика «In Progress 48ч» и «Code Review 8ч» — разные миры. Здесь это
учтено. Плюс per-team override (`teamThresholds` map, V18.3 A1 — Olga ML
pilot) — для ML-команд CR ходит 2 дня, и это не блокер.

### 3. R² (goodness of fit) рядом со slope

`teamScanner2RendererHero.js:390-401` — sprint slope chip помечается
`is-low-confidence` если R² < 0.5. Это **редкое** качество в дашбордах. Большая
часть инструментов покажет «↗ +3%/день» при R²=0.12 — то есть линейка по
шуму. Здесь явно говорят «низкая статистическая уверенность — возможно шум»
(tooltip `r2Interp`).

### 4. Weekday-adjusted anomaly detection

`teamScanner2Insights.js:477-501` (`weekdayAdjustedAnomaly`) — заменили flat
Z-score, который давал 60-70% false-positives «понедельник всегда anomaly».
Это конкретный feedback-loop fix, и комментарий в коде честно так и пишет.
В Stripe мы пришли к этому через полгода жалоб.

### 5. Multi-source zombie detection

`teamScanner2Insights.js:69-110` — старая логика «no transition 30 days =
zombie» ловила ложно живые задачи где коммиты идут без Jira move-status'а.
Новая логика проверяет BB-commits / CF-edits по `KEY_RX = /\b([A-Z][A-Z0-9_]*-\d+)\b/g`
из commit titles. Это правильный multi-signal pattern.

### 6. Gini CR load + bus-factor file-level

`teamScanner2Insights.js:913` (`computeCrLoadGini`) — distribution of code-review
load across reviewers. Gini=0 равномерно, Gini=1 один человек всё ревьюит. Plus
tooltip переводит на человеческий «критически узкий, рекомендуется
knowledge-share». **Это уровень Google's Code Health Team.** 99% дашбордов
просто покажут «топ-1 reviewer» без contexta.

И в `teamScanner2RendererInsights.js:902-927` (Hot files + Bus-factor) —
агрегат `bf1Count / totalHotFiles` с threshold-зонами. Это рабочий
truck-factor proxy, а не «список топ-комитеров».

### 7. Hygiene Engine — это PM/data-quality layer которого я нигде не видела

`integrations/jiraHygiene.js` — 12 pure-rule checks (D-01..D-12), каждое
правило weighted, score=100−Σweight·count/teamSize, capped. Reproduce'ит
работу Atlassian Compass + добавляет 6 правил которых в Compass нет
(scope-flip, sprint-hopping → ловятся в `analyzeChangelogPatterns`).

Особенно хорошо: `weight` нормализован по teamSize (`Math.max(10, team)`),
т.е. большая команда не «лучше» только за счёт массы.

### 8. Active-sprint-only с честным fail-open

`teamScanner2Enrichment.js:336-353` — `failOpenReason` различает три состояния:
`'no-sprint'` (нормально, между спринтами), `'api-error'` (данные неполные),
`'ok'`. Это разница между «команда отдыхает» и «фильтр сломался». В большинстве
дашбордов один error message «нет данных» и EM сам гадает что произошло.

### 9. Per-team threshold presets (default / research / hotfix)

`teamScanner2Config.js:49-57` — Olga (ML) сразу получила свой профиль.
Подобный механизм в FAANG появляется как реакция на жалобы 6 месяцев спустя.
Здесь это вшито в архитектуру с самого начала.

### 10. Cache + epoch invalidation для classifyPerson

`teamScanner2Classifier.js:59-106` — WeakMap кэш + явный `bumpClassifyEpoch`.
3× ускорение per-render на 109-person команде. Plus epoch-based invalidation
вместо timestamp — устойчиво к clock-skew. Хорошая инженерия.

---

## Critical — опасные метрики / anti-pattern'ы

### C1. `computeProductivityScore` (Z1) — встроенный Goodhart-генератор

**Где:** `integrations/teamScanner2PersonMetrics.js:39-61`

```js
const score = Math.round(
  commits * 1.0 + prs * 3.0 + conf * 1.5
  + reviewsDone * 2.0 + testsCreated * 2.0 + testsExecuted * 1.0
  + closedToday * 5.0
);
```

**Почему критично:**

1. **Это per-person линейный score из linear combination of inputs.** В сообществе
   engineering-productivity 15 лет известно: любой такой score под давлением
   менеджмента превращается в KPI, который превращается в gaming. PR×3.0 →
   люди дробят PR на мелкие. Conf×1.5 → люди создают мусорные страницы.
   testsExecuted×1.0 → люди прогоняют один тест 50 раз.

2. **Веса подобраны эмпирически (см. комментарий: «Веса подобраны эмпирически:
   PR-merge дороже коммита»).** Эмпирически — означает «один человек придумал».
   Любые веса в such score должны быть либо результатом валидации против
   independent outcome (delivery, retention, satisfaction), либо отсутствовать.
   Иначе это псевдо-наука.

3. **Заявленный guard «видит только тимлид, нет self-view» (комментарий в
   :11-16) НЕ enforced на уровне scrub policy.** Productivity score попадает
   в `p.personMetrics` (`teamScanner2PersonMetrics.js:290`) и оттуда — в
   diagnostic export через `prepareDiagnosticExport`. Если кто-то форкнёт
   diagnostic JSON через chat — это PII утечка на performance grade.

4. **closedToday detection через regex** (`/done|закрыт|готов|resolved/i.test`)
   — `:49-51`. Один PR auto-merge bot который пишет в title «Resolved
   automerge» добавит +5 score человеку который этого PR не открывал.

**Что должно быть:**
- Если оставлять — **только team-level aggregate** («команда: 47 closed
  today, 12 PR merged»). Без per-person ranking, без `score` числа.
- Per-person метрика productivity — anti-pattern в дашборде доступном
  тимлиду. У EM нет рабочего сценария где «Иванов: 23, Петров: 18» полезно.
  Есть сценарий «давайте посмотрим что Иванов делал» — это **drill-down,
  не ranking**.
- Если оставлять числа — называть «activity index» (не productivity!) и
  ставить banner «не использовать для аттестации».

**Что Google/Meta/Stripe делают:**
Google в 2019 убрал per-developer productivity scores из engprod-дашбордов
после трёх инцидентов. Сейчас они показывают per-team aggregate + per-person
только в self-view (developer сам видит свои number'а). Meta — то же самое,
но шире (Stride pulses, без linear scores). Stripe — отказался от
productivity metrics в пользу DX-Index (опрос).

---

### C2. `computeBurnoutFlag` (Z10) — социальная мина

**Где:** `integrations/teamScanner2PersonMetrics.js:217-280`

```js
if (weekendRatio > 0.25) signals.push({ kind: 'weekend',   ... });
if (lateRatio    > 0.15) signals.push({ kind: 'late-night', ... });
if (wipNow       >= 4)   signals.push({ kind: 'wip-overload', value: wipNow });
if (daysSinceLastCommit ≥ 5 && all.length ≥ 10) {
  signals.push({ kind: 'recent-slowdown', ... });
}
let level = 'none';
if (signals.length >= 2) level = 'high';
else if (signals.length === 1) level = 'medium';
```

**Почему критично:**

1. **Per-person mental-health classification без opt-in consent.** Burnout —
   это медицинское состояние. Любой алгоритм который ставит человеку метку
   `level: 'high'` на основании weekend timestamps **должен** иметь:
   (a) явное согласие сотрудника, (b) data steward review, (c) запрет на
   использование в HR-решениях. Здесь только комментарий в коде «не показывать
   в self-view» (см. `:11-16`) — это **не** technical control.

2. **Confounders массивно искажают signal:**
   - **TZ skew.** `getHours()` берёт server-local time. Если сотрудник в
     Калининграде (UTC+2), а server в Москве (UTC+3) — все его 22:00 commits
     становятся 21:00. ML-сотрудник с partner-визитом в США отмечается
     `late-night`. Чем больше распределённая команда — тем шумнее метрика.
   - **Bot-commits через identity.** Если бот sbt-issue-managment-user
     попал под personal identity (рекурсивный edge case) — он коммитит
     круглосуточно и человеку ставится `late-night: 100%`. Service-account
     фильтр `_detectServiceAccountByKey` это закрывает на pre-enrichment этапе,
     но если бот *владеет* PR-веткой человека через approval forward — счётчик
     поднимется.
   - **One-off launch / on-call.** Один dev который раз в полгода в release-
     night работает — попадает в `high`. Это не burnout, это on-call.
   - **Recent slowdown** при `≥10 events` — отпуск даёт false-positive.
     Реально, после двух недель отпуска: `bbItems` собирается за 28 дней,
     последний коммит = 14 дней назад → `daysSinceLastCommit = 14 ≥ 5` →
     +1 signal. Если ещё накануне отпуска человек работал в субботу
     (weekendRatio>25%) — это два signal → `high`.

3. **threshold 0.25 weekend / 0.15 lateNight — без validation against ground
   truth.** Эмпирически выбранные пороги. В Stripe мы валидировали burnout
   proxy против стандартизированной шкалы MBI (Maslach Burnout Inventory)
   — корреляция была ~0.3, недостаточно для individual prediction. Это
   значит, что для команды из 10 человек метрика даст ~3 false positives.
   Тимлид который пойдёт «спросить как дела» к ложному positive — ОК.
   Но если эти данные просочатся в performance discussion — катастрофа.

4. **Метрика «burnout» создаёт стигму даже если EM аккуратен.** Сам факт
   что в дашборде есть лейбл «high burnout» рядом с фамилией — это уже
   PII-чувствительность. Запросы прокурора / HR на «выгрузку» этой метрики
   за прошлый год становятся возможны.

**Что должно быть:**
- **Не показывать level per-person.** Показывать только **team aggregate**:
  «3/12 показывают сигналы перегрузки» с тултипом «рассмотрите 1:1 с командой».
- **Удалить из diagnostic JSON.** Сейчас `applyPersonMetrics` пишет
  `p.personMetrics.burnout` (`teamScanner2PersonMetrics.js:297`), и
  `prepareDiagnosticExport` его не очищает (`teamScanner2Diagnostic.js:507`+).
  Это потенциальный data-leak на ровном месте.
- **Конвертировать в «load signal»**, не «burnout». «У Иванова 4 active WIP,
  3 коммита в выходные» — это факты. «Burnout: high» — это медицинский
  диагноз.

**Что Google/Meta/Stripe делают:**
Никто не показывает per-person burnout flag на public-to-manager dashboard.
Burnout детектируется через **self-report** (Stride at Meta, internal pulse
at Google). Late-night/weekend signals доступны developer'у самому в self-
view, не менеджеру.

---

### C3. `buildActionQueue` (I2) — ranked list людей с severity score

**Где:** `integrations/teamScanner2Insights.js:147-195`

```js
if (grp === 'stop') {
  severity = 100;
  reason = `Стоп · ${blockers.length} ${...} · макс ${Math.round(maxDwell)}ч`;
  action = '1:1 разговор — что мешает';
} else if (burnoutLevel === 'high') {
  severity = 90;
  ...
}
queue.sort((a, b) => b.severity - a.severity);
return queue.slice(0, 5);
```

**Почему опасно:**

1. **Это ranked list людей.** Severity 100/90/70/60/40 — это число прямо
   рядом с фамилией. Любой EM при стрессе берёт этот список и идёт по нему
   по порядку.

2. **Severity 90 (burnout) > severity 70 (WIP overload).** EM получает
   message: «burnout-человек важнее перегруженного». Это спорное упорядочение
   без validation. В реальности burnout flag — false-positive до 30%, а
   WIP=4 — это hard fact.

3. **Inheritance из C2 (burnout per-person).** Если C2 — мина, то C3 —
   minefield с подсвеченным маршрутом.

4. **«1:1 разговор — что мешает» текст в `action` поле** — это уже
   прескриптивный coaching-совет от инструмента. Если у EM нет
   соответствующей подготовки, он буквально это и скажет, превращая инструмент
   в скрипт.

**Что должно быть:**
- **Action queue из задач, не из людей.** Список блокеров с dwell-time и
  owner — `Топ-5 задач которые висят` — это actionable без personal ranking.
  Тимлид сам решит с кем 1:1.
- Если оставлять list людей — **без severity score** (ranking), без
  prescriptive `action`. Просто список «у этих людей сегодня есть signals,
  посмотрите внимательнее».

---

### C4. `composePersonNarrative` отдаёт human-readable текст про человека

**Где:** `integrations/teamScanner2Insights.js:955-1056`

Возвращает narrative типа `«Сегодня: в работе PROJ-X, трогал PROJ-Y. Блокер:
по REL-456 нет движения 18ч.»`.

И `composeNarrativeMarkdown` рядом на :1062-1071 готовит **clipboard payload
для копирования в TG/Slack**.

**Почему опасно:**
EM нажимает «copy» → текст «Иванов: вчера 0 коммитов, сегодня тишина в
Jira/BB» падает в чат с PM. PM или другой EM читает — и формируется
narrative «Иванов плохо работает». Через месяц у Иванова performance review
с этим текстом. Это **прямая** дорожка от dashboard signal к HR-decision,
без involvement Ивана.

**Что должно быть:**
- Copy-paste для personal narrative должен быть **с тёмным consent-banner'ом**
  (см. `teamScanner2.js` уже есть consent flow для diagnostic — переиспользовать).
- В narrative — **больше про задачи, меньше про человека**. Авторы кода это
  уже делают (комментарий `N5: фокус на задачах`), но «Сегодня тишина в
  Jira/BB» — это всё ещё personal characterization.

---

### C5. WIP-counter с цветовым ranking (≥3 amber, ≥4 warn)

**Где:** `integrations/teamScanner2RendererPersonRows.js:197-198`

```js
const wipCls = wipN >= 4 ? 'ts2-counter ts2-counter-warn' :
               (wipN >= 3 ? 'ts2-counter ts2-counter-amber' : 'ts2-counter');
```

**Почему смущает:**
WIP=4 amber — на индивидуальном уровне это **слишком жёстко** для senior /
архитектора / тимлида. У senior'а нормально иметь 5-7 issues в активном
состоянии (часть в review, часть в QA, часть в planning). Метка «overload»
неуместна.

Threshold должен зависеть от role/tenure либо считаться против median по
команде (что уже частично сделано в tooltip — «×1.5 от среднего» комментарий
в `:303`). Но цветовая метка `warn` фиксированная на абсолютном 4.

**Что должно быть:**
- WIP threshold относительный (`> p75 команды`) или role-aware (если есть
  data).
- Или: показывать WIP без цвета, оставить **только** в team-level (median
  команды overload? — да).

---

### C6. Insufficient sample size — нет блокировки рендера

Несколько метрик `теневые` (silently zero) при малом sample size:

- `computeEmaWoW` `:1349-1357` — при <8 точках возвращает
  `wowDelta: 0, insufficientHistory: true`. Renderer проверяет флаг —
  хорошо. Но **не везде**.
- `computeZScore` `:1313-1314` — при <4 точках `mean: 0, ..., anomalous: false`.
  Если кто-то вызовет ZScore на series.length=2 — получит «ничего не
  происходит». Это silent confounder.
- `computeFirstResponseTime` `:194` — `count<3 → low signal`, рекомендуется
  не показывать. Но рекомендация — не контракт.
- `weekdayAdjustedAnomaly` `:486-488` — при <4 same-weekday точках:
  `confidence: 'low'`. Renderer должен это учитывать; не всегда учитывает.

**Что должно быть:**
- На уровне data-contract: каждая метрика должна возвращать `{value, n,
  confidence: 'low'|'medium'|'high', shouldRender}`. Renderer проверяет
  `shouldRender` — это hard gate.

---

## High — метрики которые врут или вводят в заблуждение

### H1. `computeLocDelta` (Z6) — оставлено в коде «потому что пользователь попросил»

**Где:** `teamScanner2PersonMetrics.js:138-159`

Сам комментарий в коде честно пишет:
> NB: LOC — гадкая метрика (поощряет шум, наказывает рефакторинг). Делаем
> по запросу пользователя; рекомендуется к закрытию через config-flag в
> production.

И при отсутствии real diff stats fallback: `commits * 50`. То есть, человек
который зафиксил `if(x)` → typo и сделал коммит «fix» — получает +50 LOC
delta.

**Что должно быть:**
- Либо удалить полностью, либо за feature-flag по умолчанию выключенным.
- Если оставлять — называть «code velocity proxy» с массивным disclaimer'ом
  и НЕ ranking-list, а scatter plot (где видно corner cases).
- Никогда LOC не должен попадать в Z1 productivity score — сейчас не
  попадает (`commits` идёт, не `loc`), но рукой подать.

### H2. `computeBlockerMTTR` — не MTTR, а snapshot dwell mean

**Где:** `teamScanner2Insights.js:642-662`

```js
// Approximation: для open blockers — текущий dwellHours; для closed —
// нет данных в model.
```

То есть берётся mean dwell **открытых** блокеров. Это не MTTR (mean **time
to resolution**) — это «среднее текущее время в блокировке». Метрика растёт
просто оттого что блокер ещё открыт; в момент когда он закроется — он
пропадёт из выборки.

**Confounder:** селекция выживаемости. Если все «лёгкие» блокеры быстро
закрываются, в выборке остаются «тяжёлые» — MTTR кажется высоким, хотя
реально команда работает хорошо.

**Что должно быть:**
- Либо реально считать time-to-resolution через persisted history (для
  closed blockers — `closedAt - createdAt`). Это требует расширения
  snapshot shape в `teamScanner2History.js`.
- Либо переименовать в «среднее открытое время блокеров» (Open Blocker
  Mean Age). DORA это `mean time to recovery` — не путать.

### H3. `computeCarryOverRate` — не carry-over, а identity overlap

**Где:** `teamScanner2Insights.js:357-384`

Берёт snapshot >7 дней назад, сравнивает sprintIssueKeys. Если sprint name
ещё тот же — return null (правильно). Если другой sprint — `carried = new
keys ∩ old keys` / `current total`.

**Проблема:** если EM запустил Сканнер 5 дней назад, потом не открывал, и
запустил снова — snapshot 5 дней не подходит (cutoff 7), вернёт null.
Если запускает каждый день — snapshot 7 дней назад может быть **тот же
самый спринт** (cycle 2 weeks) — тоже null.

Carry-over работает только если spринт <7 дней, то есть короткий цикл.
Для двухнедельного спринта — никогда.

**Что должно быть:**
- Cutoff = `sprint.startMs` (если есть), не fixed 7 дней.
- Альтернативно — отслеживать `previousSprint.keys` явно в snapshot.

### H4. Sprint Goal Progress без story-point fallback

**Где:** `teamScanner2Enrichment.js:684`

```js
const done = sprintIssues.filter(it => isTerminalStatus(...)).length;
const progressPct = total > 0 ? Math.round((done / total) * 1000) / 10 : 0;
```

Это **count-based**, не SP-based. Один task=1pt, один epic=21pt — одинаково
весят. Команда с одним недозакрытым 21SP epic-ом на 10 done 1SP-tasks
покажет 91% — но в реальности они закрыли 32% scope'а.

Комментарий в коде это признаёт (`:672`: «Without SP-fields fallback... MVP»),
но в production-данных Сбера это будет неверно говорить о темпе.

**Что должно быть:**
- Если у issue есть `storyPoints` — взвешивать по ним. Если нет — взвешивать
  по equal. Renderer должен показывать basis: «20/35 SP (57%, на story-point
  основе)» vs «12/22 issues (54%, count basis)».
- Сейчас в `sprintGoal` уже есть `sprintMeanProgress` (sprint-weighted mean,
  `:773`) — это отлично для multi-sprint. Нужно ещё SP-weighted.

### H5. DORA proxy у которого две из четырёх метрик — фантомы

**Где:** `integrations/portfolioPulseModel.js:1503-1507`

```js
tm.dora = {
  deployFreqPer7d: mergedPrs,     // merged PRs ≠ deployments
  leadTimeMs:      ...cycleTimeMs, // PR open→merged ≠ lead time
  mttrHours:       sprintMetrics.blockerTime.avgHours,  // dwell != MTTR
  changeFailRate:  revertCommits / totalCommits,         // OK proxy
};
```

**deployFreqPer7d = merged PRs** — это **не** deploy frequency. В монорепо
один deploy → 30 PRs мерджатся в pre-deploy batch. Метрика покажет 30, deploy
было 1.

**leadTimeMs = PR cycle time** — это lead time for **review**, не lead time
**for changes** (тот считается от issue.created до production-deploy).

**mttrHours = blockerTime.avgHours** — см. H2 выше. Snapshot dwell ≠ recovery time.

**Что должно быть:**
- Либо подключать Jenkins/Jira release-version data для real DORA (есть `jenkins.summary.deployFreqPer7d` в `teamScanner2RendererInsights.js:988` — там
  уже proxy через build events, лучше использовать его).
- Либо переименовать в **«DORA-like signals»** с явным disclaimer'ом про
  proxy-nature каждой.
- Сейчас в UI пишут «DORA proxy (7д)» (`teamScanner2RendererInsights.js:456`) — лучше
  чем ничего, но недостаточно. EM который покажет эти числа CTO как DORA —
  получит позор.

### H6. CRV (Code Review Velocity) ignores reviewer load

**Где:** `teamScanner2Enrichment.js:1131-1172` (`computeCodeReviewVelocity`)

Считает median time-to-first-review per reviewer. Если у Иванова mean 18ч — он
«slow». Но если у Иванова **5 open PRs одновременно** и Иванов is busy с
release — это не его проблема, это о allocation.

Threshold (`crvSlowHours: 24`, `crvWarnHours: 8`) — fixed.

**Что должно быть:**
- Adjusted CRV: `medianHours / sqrt(parallelReviews)`. Или хотя бы surface
  parallel-load в tooltip.
- Сейчас Gini CR load (`computeCrLoadGini` — отличная метрика, см. ★ выше)
  частично compensates на team-aggregate уровне. Но per-reviewer chip всё
  ещё может вешать ярлык slow.

### H7. `analyzeChangelogPatterns` — pattern severity hard-coded

**Где:** `teamScanner2Insights.js:1125-1192`

```js
'churn-frequent-reassign': severity: 60
'sprint-hopping':          severity: 50
'scope-flip':              severity: 70
'severity-downgrade':      severity: 40
```

Severity-100-scale без validation. `scope-flip` (70) > `frequent-reassign`
(60) — почему? Эти числа влияют на сортировку, на выбор top-15, и EM может
делать decisions на их основе.

**Что должно быть:**
- Либо явная rubric (документировать почему scope-flip=70).
- Либо убрать severity и сортировать chronologically или по count.

### H8. PR throughput: статус MERGED определяется из upper-case `it.status`

**Где:** `teamScanner2Enrichment.js:1185-1213`

```js
const st = String(it.status || '').toUpperCase();
if (st === 'MERGED')        merged++;
else if (st === 'DECLINED') declined++;
```

Sber Bitbucket Stash возвращает state в разных API endpoints разный case
(`merged`, `MERGED`, `Merged`). Если case mismatch — `merged=0`, `mergeRate=0`,
`flag='stalled'`. Один глаз пропустит — все авторы в красном.

**Что должно быть:**
- Использовать `regex /merged/i.test(st)` для устойчивости.

---

## Medium — пробелы по frameworks

EM-практика последних 6 лет крутится вокруг 3 фреймворков. Сканнер
**неявно** реализует часть их, но не позиционирует — это слабость для
buy-in от engineering directors.

### M1. DORA — три из четырёх metrik present как proxy, нет нормальной grouping

DORA (Forsgren-Humble-Kim 2018) — четыре метрики, объединённые в `Elite /
High / Medium / Low` буckets (Accelerate, 2018; State of DevOps reports).

| DORA метрика | В Сканнере | Где |
|---|---|---|
| Deploy frequency | ✅ proxy через `mergedPrs` / `jenkins.summary.deployFreqPer7d` | `portfolioPulseModel.js:1504`, `teamScanner2RendererInsights.js:988` |
| Lead time for changes | ✅ proxy через PR cycle time | `:1505`, `computePrCycleTime` |
| Change failure rate | ✅ proxy через revert/total commits | `:1507` |
| Mean time to recovery | ⚠️ misleading proxy через `blockerTime.avgHours` | `:1506` (см. H2 + H5) |

**Что не хватает:**
- Нет **bucketing** (`Elite/High/Medium/Low`). EM смотрит на «leadTime
  p50=12h, p90=72h» — это что? Elite или? Без bucket нельзя сравниться с
  industry benchmark.
- Нет **trend по DORA** (DORA value over 30/60/90 days). У вас есть
  `computeSprintGoalSlope` для sprint progress — нужен такой же для DORA.
- Нет **failure recovery** (mean time between deploy failures vs recovery).

### M2. SPACE — четыре из пяти dimensions покрыты, но не named

SPACE (Forsgren-Storey-Maddila-Zimmermann 2021) — Satisfaction, Performance,
Activity, Communication, Efficiency.

| SPACE dim | В Сканнере | Где |
|---|---|---|
| **S** Satisfaction | ❌ не считается. Sentiment / pulse — нет. | — |
| **P** Performance | ⚠ partial — `Sprint goal progress`, `closedToday` (но per-person опасно) | `sprintGoal`, `Z1` |
| **A** Activity | ✅ полно — `heatmap72x4`, `timeline72h`, `bbItems/cfItems/zephyr counts` | enrichment.js heat-section |
| **C** Communication | ⚠ partial — `reciprocity`, `mentorScores`, `crDepth` есть, но в multi-only | `teamScanner2RendererInsights.js:660-679` |
| **E** Efficiency / Flow | ✅ implicit — `contextSwitches`, `switchScore`, `blockers dwell` | `computeContextSwitches` |

**Что не хватает:**
- **S вообще не существует.** Это нормально для proxy-tool, но это — самая
  важная dimension по самим авторам SPACE. Решение: либо integrate pulse
  survey (хотя бы embedded link → 3-question Google Form), либо явно
  написать в overview «we do not measure satisfaction; complement with
  pulse».
- **Communication metrics в multi-team only** (`_showMultiTiles` guard,
  `teamScanner2RendererInsights.js:324`). Для single-team scanner — не видно
  reciprocity / mentorship. Это потеря.

### M3. DX framework (Abi Noda 2024) — Feedback Loops + Cognitive Load — НЕ покрыты

DX framework (Noda + Forsgren 2024, ACM Queue): три pillars — Feedback
Loops, Cognitive Load, Flow State.

| DX pillar | В Сканнере | Где |
|---|---|---|
| **Feedback Loops** (test/build/PR review time) | ⚠ partial — CRV есть, build time нет | `computeCodeReviewVelocity` |
| **Cognitive Load** (codebase complexity, unfamiliar areas) | ❌ нет | — |
| **Flow State** (deep work time, interruptions) | ⚠ partial — `contextSwitches` есть, но не позиционировано как flow | `computeContextSwitches` |

**Что не хватает:**
- **Build feedback time** — есть только `jenkins.summary` aggregate, не
  per-PR. Это deal-breaker для DX-mature org. Если build fails 40 мин —
  developer теряет flow.
- **Test feedback time** — нет.
- **Cognitive Load proxy** — Gini knowledge breadth (`specialistGini` в
  `teamScanner2RendererInsights.js:702-718`) частично закрывает; формально
  не назван DX.
- **Flow state** — context switches есть, но название `productivity-tracking`
  + skipped optional через localStorage flag `q2_scanner_hide_productivity`
  показывает что команда сама не знает что это flow signal, не productivity.
  **Переименовать в `flow-state` / `focus-score`** — это переворачивает
  smell. Tracking ≠ measuring flow.

### M4. Нет HRT / Team Health framework на team-level

Westrum org culture model + Google's «Project Aristotle» Team Effectiveness
(Psychological Safety, Dependability, Structure & Clarity, Meaning, Impact)
— это team-level, не individual.

В Сканнере **есть** `computeTeamHealthScore`
(`teamScanner2Insights.js:679-728`) — отличный аналог, но composite опирается
на: sprint+blockers+stop+activity+PR+zombies+churn+burnout. Это
**operational health**, не **psychological health**.

Это нормально — пусть будет «Operational Team Health». Но в overview
надо это явно прописать, чтобы EM не путал с Aristotle.

### M5. Reliance на proxy without ground truth validation

Все эти метрики — proxy. У вас нет ни одного места где proxy валидируется
против outcomes: retention (кто уволился), promotion (кто получил
повышение), incident-rate (где случались sev1). Это значит — нет петли
обратной связи между метрикой и реальностью. Через 6-12 месяцев нужна
calibration session.

**Что делать:**
- В history snapshot добавить outcome-events (когда employee leaves, когда
  была incident на проекте, когда был promo). Тогда через год можно
  посчитать correlation `burnout_flag` ↔ `attrition` — и понять, ловит ли
  burnout-метрика реальное явление или это шум.

---

## Low — мелочи

### L1. `MEAN_LOC_PER_COMMIT = 50` — magic number без validation

`teamScanner2PersonMetrics.js:138`. Backend на Java часто 100-300 LOC commit.
Mobile с тестами — 30-60. ML notebook commits — иногда 0 (новый ipynb +
data file). 50 — мифический dev. См. H1.

### L2. `confidence: 'high'` при `all.length >= 30`

`teamScanner2PersonMetrics.js:278`. 30 events за 28 дней — это ровно 1
event/day. На самом деле для time-of-day distribution нужно >100 events
(один за раз ничего не говорит). Threshold слишком слабый.

### L3. Heatmap 72×4 hardcoded на 5 sources

`teamScanner2Enrichment.js:928-934` — 5 фиксированных rows. Если завтра
добавят GitLab — нужно перебирать. Должна быть array sources.

### L4. `extractTrendSeries` через dotted path

`teamScanner2History.js:186-197` — `metricKey.split('.')`. Если ключ
включает точку (custom field `version.1.0`) — ломается. Edge case, но.

### L5. Productivity-toggle через localStorage flag

`teamScanner2RendererPersonRows.js:236-239`:

```js
localStorage.getItem('q2_scanner_hide_productivity') === '1'
```

Спрятано в localStorage без UI toggle. Pilot finding (Dmitry: «↻N
выглядит как watchdog»). Но это **должен** быть UI toggle в Sсаннер
settings, не «знай secret key». EM не должен лазить в DevTools.

### L6. `analyzeChangelogPatterns` — pattern severity `40-70`, не нормировано к Hygiene severity

`jiraHygiene.js` weight 2-8, `analyzeChangelogPatterns` severity 40-70.
Разные scales для concept'a одного и того же «насколько плохо». Когда
выводишь рядом — путаница.

### L7. `composeDailyBriefMarkdown` — без consent banner

`teamScanner2Insights.js:733-749`. Готовит копи-пейст для TG, включающий
имена. См. C4 — нужен consent.

---

## Killer features / новые идеи

Что я бы добавила, основываясь на том что Meta/Stripe/Google делают, а здесь
ещё нет. По убыванию ROI для EM:

### K1. Pulse-survey integration (closing SPACE/S gap)

3-question embedded survey раз в 2 недели:
- «Насколько комфортно работалось на этой неделе?» (1-5)
- «Что мешало больше всего?» (free text, optional)
- «Кому хочешь сказать спасибо?» (recognition signal)

Render: `<details>` блок в hero. Результат — team-level aggregate (без
per-person), plus heatmap по 6 неделям. **Это закрывает Satisfaction
dimension SPACE, без которой инструмент не считается серьёзным EM-toolkit.**

Stripe это сделал в 2020 (DX-Index). У Google внутренний «gPulse» с 2018.

### K2. Engineer 1-week ramp-up tracker (closing onboarding gap)

`computeOnboardingRamp` уже есть (`teamScanner2Insights.js:607-631`). Сделать
из него **hero-tile для команды с новичками**: «Иванов, 23 дня в команде,
первый commit на 5 день, первый PR на 11 день — норма по команде 7/14». Не
ranking, а **calibration**: новый человек видит «я норм», ментор видит «надо
помочь с PR-флоу».

В Stripe это называется «Time-to-1st-PR» — KPI Engineering Leadership
quarterly.

### K3. DORA buckets + industry benchmark

```
Deploy Frequency:  ┌──────────────────────────┐
                   │  ELITE      < 1 day      │
                   │  HIGH      < 1 week      │  ← вы здесь (3.2/week)
                   │  MEDIUM    < 1 month     │
                   │  LOW        > 1 month    │
                   └──────────────────────────┘
```

Просто, заметно, immediately actionable. State of DevOps report публикует
эти buckets ежегодно — благодарны разработчики.

### K4. Cycle time histogram (вместо p50/p90)

Сейчас показывают `p50 / p90` — две точки. Histogram (8 bins) показывает
distribution: bimodal? long tail? outliers? Это меняет ответы на
вопросы. Stripe сделал в 2021 — улучшил decisions по PR-process.

### K5. Code review pair-matrix

Кто кому ревьюит. Реципрокность (`recip.reciprocal/pairs` уже считается,
`teamScanner2RendererInsights.js:660-679`). Surface как **matrix** (X-axis
authors, Y-axis reviewers, color = count). Откроет:
- Знаниевые «доверы» (один человек один reviewer всегда → mentorship gap
  или bus-factor risk).
- Isolated dev (никто не ревьюит → flagging onboarding issue).

В Meta мы это называли **«Review Pair Graph»**, использовалось ежеквартально.

### K6. Investment categorization (Feature / Maintenance / Tech Debt / Incident)

У вас есть `om.innovationRatio` (`teamScanner2RendererInsights.js:400-403`)
— F/M/D ratio. Сделать из него **hero-blok**: «команда тратит 67%
feature, 23% maintenance, 10% tech debt, 0% incident» — это PI-planning input.

Google делает это через Atlassian-tag, Meta через issue-labels. У вас уже
есть infrastructure (labels, components) — surface это.

### K7. PR readability score (`<files,lines,description-quality>`)

PR size distribution есть (`bbGovernance.distribution`,
`teamScanner2RendererInsights.js:763-772`). Добавить **PR review-readability
score**:
- files ≤ 5 → +1
- lines ≤ 200 → +1
- description ≥ 50 char → +1
- linked Jira ≠ null → +1

Score 0-4 per PR. Aggregate по команде. Это **directly correlates** с CR
cycle time (Google internal study 2019).

### K8. Calibration mode — separate dashboard for performance review prep

Спрятать опасные метрики (productivity, burnout) за **отдельный «Calibration»
sub-tab**, который:
- Доступен только в `calibration-mode` (явный toggle, audit-logged).
- Требует acknowledgement «эти метрики ПРОКСИ, не используйте как
  single-source».
- Показывает longitudinal trends (90 дней), не point-in-time.
- Аннотирован context'ом (отпуска, on-call, release-window).

В Meta мы выпилили per-person metrics из daily view и оставили **только**
в «Calibration Dashboard» который EM открывает раз в полгода. Полностью
изменило поведение менеджеров.

### K9. «Quiet days» — explicit reduce noise

Команда в release-week, в decembre, на корпоративе — все метрики падают.
Сейчас это видит pace='behind', stop count поднимается. EM при первом
просмотре думает «команда сдохла». **Quiet day annotator:** EM ставит
banner «27 дек–10 янв — праздники» — карточки соответствующих дней
visually faded, slope-расчёт исключает этот период.

Это маленькая фича, но я видела как её отсутствие испортило 5 отношений
EM↔team в Meta-2022.

### K10. Drift-alert prediction (early warning system)

С учётом slope + R² + history, predict «команда скорее всего не достигнет
sprint-goal через 5 дней». Сейчас `computeSprintConfidence` это считает —
**добавить explicit alert** через email/Slack daily-digest. Stripe внутренний
tool `Burndown Alarmer` присылает 8:00 утра «вам надо посмотреть».

### K11. PR-size heatmap по командам

В benchmarks tab (`_renderCrossTeamBenchmarks`) добавить PR-size column.
Это **самый предсказательный signal** PR-flow здоровья (Meta internal
research 2020).

### K12. Bus factor с graph visualization

Сейчас `busFactor=1` показан как list. Сделать **dependency graph**: ноды
= файлы, edges = co-authorship. Кластеры sole-owner files подсвечены.
Stripe сделал в 2022 для security review — оказалось полезно для tech-debt
planning тоже.

### K13. Sprint retro auto-prep

В конце спринта (close detection) — auto-generate ретро-prep:
- «Что улучшилось vs прошлый спринт?» (delta metrics)
- «Что замедлилось?» (slope negative)
- «Top-3 stuck issues» (carry-over candidates)
- «Top-3 unsung heroes» (mentorScores с asymmetry)

Положить в clipboard для PM / SM. Один из самых used Stripe-tools был
именно auto-retro-prep.

### K14. EM-action-log (separate from diagnostic log)

Каждое action которое EM делает через дашборд («открыл 1:1 prep»,
«copied narrative», «applied filter») — логировать с timestamp. Через
3 месяца EM видит свой usage pattern. **Это закрывает loop**: dashboard
показывает signal → EM acts → action logged → можно мерить effectiveness
самого dashboard'а.

В Meta это сделали для Stride — позволило выпилить 40% метрик которые
никто не открывал.

---

## Что бы я сделала в первую очередь

3 шага, по убыванию impact / по возрастанию усилия.

### Шаг 1 (1-2 дня): Закрыть Goodhart-минное поле (C1, C2, C3, C4)

**Action:**
1. **Удалить per-person `productivity score` число.** Оставить только
   aggregate breakdown в drill-down panel. Renaming `productivity` →
   `activity_index` если оставлять числа.
2. **Burnout level → перенести в «load signal»**: показывать только
   team-aggregate («3/12 показывают сигналы перегрузки»), не per-person
   chip. Удалить `level` поле из diagnostic export.
3. **Action Queue → перевести с per-person ranking на per-issue ranking**.
   «Топ-5 застрявших задач» + owner — info, но без severity score.
4. **Person narrative copy-to-TG → добавить consent disclaimer** перед
   copy + audit-log в `audit.json`.

**Файлы:**
- `integrations/teamScanner2PersonMetrics.js:39-280`
- `integrations/teamScanner2Insights.js:147-273`
- `integrations/teamScanner2Renderer.js:1296-1305` (burnoutChip)

**ROI:** убирает 90% **HR/legal risk** Сканнера. Без этого его нельзя
показывать в Сбере на org-wide rollout.

### Шаг 2 (3-5 дней): Framework-grounding + ground-truth pipeline

**Action:**
1. **Написать `docs/scanner2-frameworks.md`** где явно прописать: какие
   метрики покрывают DORA / SPACE / DX, какие — нет, что в кругозоре,
   что нет. Это даёт EM-buy-in для defending перед CTO.
2. **DORA bucketing**: добавить `Elite/High/Medium/Low` классификатор
   рядом с `tm.dora` (`portfolioPulseModel.js:1503`). Hero-chip «Команда:
   High performer по DORA».
3. **Honest renames:**
   - `computeBlockerMTTR` → `computeOpenBlockerMeanAge` + признаться в
     selection bias.
   - `dora.leadTimeMs` → `dora.prCycleTimeMs` (proxy, не настоящий
     leadTime).
   - `dora.deployFreq` → `dora.mergeFreq` if not using Jenkins build
     events; if using — use them.
4. **Ground-truth events** в history snapshot:
   ```js
   outcomes: {
     leavers:    [{key, day}],
     promotions: [{key, level, day}],
     incidents:  [{key, severity, day}],
   }
   ```
   Не считаем correlation сейчас — но через 6 месяцев данные **будут**.

**ROI:** превращает proxy-инструмент в credible toolkit. Открывает
benchmarking + calibration.

### Шаг 3 (1-2 недели): Hero-моде разделение «утро» vs «ретро» (80/20 fix)

**Action:**
1. Двух-pile hero на топе:
   - **«Утро» (default open):** Sprint pace+slope+R², Action queue (по
     задачам), 3 zombie cards, 1 stale-PR card. ≤ 90 sec scan.
   - **«Ретро» (collapsed):** carry-over rate, scope churn, sprint velocity
     6 спринтов, bug injection. Доступно явным click'ом.
2. **Calibration mode (за toggle):** burnout-aggregate, knowledge-spread
   (Gini), mentorship signals, individual longitudinals. Audit-logged.
3. **«Quiet days» annotator** (см. K9): EM может пометить периоды как
   non-counted.

**ROI:** снижает cognitive load на 60%+, делает Сканнер ежедневным
инструментом, а не «открою раз в спринт».

---

## Финальная мета-заметка

Сканнер 2.0 — это **редко** хорошая работа. Я бы взяла половину его
функций в Stripe production tomorrow. Но именно из-за качества — он на
грани превращения в **performance-management tool** без явного консенсуса.

Три красные кнопки, которые я бы выключила или загнала в calibration-mode
до org-wide rollout:

1. `computeProductivityScore` (Z1) — `teamScanner2PersonMetrics.js:39`
2. `computeBurnoutFlag` (Z10) — `teamScanner2PersonMetrics.js:217`
3. `buildActionQueue` ranking — `teamScanner2Insights.js:147`

Они вместе превращают инструмент с 90% помогающей пользой в инструмент
с 50% помогающей и 50% разрушающей. В FAANG мы такие функции писали и
выпиливали. Знаю как выглядит «после» — лучше не повторять путь.

Всё остальное — добавлять, документировать, framework-grounding,
education для тимлидов.

— Алла Холмогорова, 2026-05-15
