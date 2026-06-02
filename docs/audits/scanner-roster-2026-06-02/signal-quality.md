# Аудит таблицы сотрудников: качество сигналов (signal-to-noise)

**Эксперт:** Data analyst, фокус на signal-to-noise в человеческих метриках. Числа активности — proxy, не ground truth.
**Дата:** 2026-06-02

## Резюме

Скан читается как «панель управления реактором», но 12 из 14 видимых на строке сигналов — это **счётчики событий из чужих систем без знания контекста**. Reactor — workflow Bitbucket/Jira, не «продуктивность». Главные слабости: (1) `classifyPerson` принимает решение по чистому object-stuck без проверки `lastActiveAt` (single source of truth — `changelog`, не «когда заглядывали в задачу»), (2) `pr48h`/`commits48h` агрегируются на любой PR-операции — без разделения «опубликовал свой» / «потрогал чужой» — это и есть «коммиты есть, PR не открывает» false-positive (rebase, force-push, squash, draft), (3) «Задач затронуто 72ч» считается через `e.issue.key` по timeline, включая worklog/transition/comment — review-разговор и mentoring не отображаются нигде, (4) heatmap'ы и dot-strip в строке UPC: `bucketByHour` использует **environment-local** `Date.getHours()`, а `computeHeatmap` принимает `tzOffsetMin`, но строкам времени никогда его не передаёт — две разных TZ в одном UI, (5) `closedToday` в productivity-score читается через regex по русскому/английскому тексту transition'а (`/done|закрыт|готов|resolved/i`) — даёт false-negative на «Готов к QA», «Awaiting deploy», и любых кастомных workflow.

Что НЕ измеряется и должно: real review-conversation (Jira comment threads, BB inline-comments), pair/mob, design-review-meetings, on-call, документация-проверка как кросс-функция, «убрал чужой блокер». Что измеряется и **не должно вылезать как row-level сигнал**: switches/72h (legitimate code-review focus), maxDwell на статусах типа Awaiting-Stakeholder/Blocked-External (нерабочая дельта).

## Находки

### 1. `classifyPerson` решает «stop» по отсутствию `timelineToday`, но `timelineToday` — это **только events на issues**, где человек был автором/assignee/worklogger

**Описание:**
В `teamScanner2Classifier.js:84-89`:
```js
if (today === 0 && yest === 0 && wip === 0 && stuck === 0
    && prs48 === 0 && com48 === 0 && !anyOtherSig) return 'idle';
if (stuck > 0 && today === 0) return 'stop';
```
`timelineToday` собирается в `portfolioPulseModel.js` через walk по `issue.changelog.histories` + `worklog.worklogs` + `comments`. Не попадает: **time spent in Jira UI без транзишена** (просмотр чужого issue, чтение треда), **inline-comments в BB на PR** (учитывается отдельно как `bbItems` с kind=`review` если PR-owner — другой человек), **общение в Slack/MM-каналах/звонки** (вне scope, но это и есть основной канал для tech-lead'а).

Senior, который полдня делал code-review через звонок и оставил «approve» в конце — попадёт в `stop` если ему не назначен blocker. Tech-lead, разбирающий чужой долгий блокер, — `idle` если он не commit'ил/assignee.

**Зачем чинить:** «Stop / Идёт разговор сегодня» — самый высокоранговый CTA в roster. False-positive здесь дороже, чем тишина — он провоцирует ненужный 1:1 с senior'ом, у которого продуктивный день вне Jira.

**Как чинить:**
- Добавить `signal:'reviewer-on-someone-else-pr'` в bbItems с `kind:'review'` где `prAuthor !== p.key` — текущая логика этот сигнал агрегирует в `badges.prReviews48h`, но **classifier его смотрит только через `anyOtherSig` для idle**. Нужно также в `stop`-rule: `if (stuck > 0 && today === 0 && reviewSig === 0) return 'stop'`.
- Добавить пассивный сигнал «issue ранкинг в Jira» через `viewed_at` если Jira это отдаёт (Sber Delta — не отдаёт; для них fallback: `assignee.commented_in_thread_today` — comment где p — не автор issue).
- Отдельный класс `'review-focus'` (или `'mentoring'`) если: `reviewSig + cfComments + bbItems(kind=review on others) >= 3` И `commits48h <= 1` — это другая шкала, не stop/moving/idle.

**Критичность:** high. **Сложность:** medium. **Ценность:** high.

---

### 2. «Коммиты есть, PR не открывает» как `emptyDayLanguage` — judgemental label на legitimate workflow

**Описание:**
`teamScanner2RendererCommon.js:243`:
```js
if (commits > 0 && prs === 0)    return 'Коммиты без транзишенов';
```
Текст показывается **в строке roster** вместо dot-strip когда `timelineToday` пуст. Случаи когда это норма:
- Trunk-based dev: коммит идёт прямо в main, PR не нужен.
- Squash workflow: автор merge'ит на «зелёный CI» один раз в день — много коммитов, ноль open-PR за час.
- Force-push на свой open-PR (rebase) — `commits48h` тикает, новый PR не создаётся.
- Vendor-bump бот, у которого identity-mapping смерджен к человеку.
- Working alone на feature-flag (TBD): commits → main под flag, PR будет когда flag поднимется.

**Зачем чинить:** Label «без транзишенов» звучит обвиняюще («хорошо/плохо?»), а семантически нейтральная ситуация (коммитит как обычно).

**Как чинить:**
- Различать **own-PR** vs **PRs где p — reviewer** в `bbItems`. Сейчас `prs = badges.pr48h` это **все PR-events на любую сторону**.
- Если `kind:'commit'` есть и `kind:'pr'(author=p)` нет — это **нейтральный сигнал «работа в репо, PR ещё впереди»**, не отдельная категория.
- Заменить текст: `«Работа в репо: ${commits} коммитов»` (без транзишена-стигмы).
- Лучше: добавить отдельный сигнал `silentDay` — explicit пометка тимлида (через UI) что «знаю, чувак на исследовании / меня заметили, не паникуй».

**Критичность:** medium. **Сложность:** low. **Ценность:** high (legitimacy перевешивает).

---

### 3. `bucketByHour` (dot-strip в строке) и `computeHeatmap` (panel) используют **разные TZ-стратегии**

**Описание:**
`teamScanner2RendererCommon.js:141`: `const h = d.getHours();` — браузерное локальное время, без tz-offset overrride.
`teamScanner2Enrichment.js:238-246` `getLocalHour(iso, tzOffsetMin)`: если `tzOffsetMin` передан — корректирует UTC; если `null` — fallback на `d.getHours()`.

Sber-сервер `analysePulse` бежит в k8s (обычно UTC), `enrichForScanner2` запускается **там же** (server-side prefetch для employee-detail). Browser потом дочитывает model через `/employee-detail` и **renderer вызывает `bucketByHour` НА КЛИЕНТЕ** — то есть для row dot-strip TZ = browser, для panel heatmap = server (или browser если client-only режим).

Результат: для МСК-команды на UTC-сервере dot-strip показывает корректное «11-19», панель heatmap72×4 — «8-16», и тимлид не понимает, какому графику верить.

**Зачем чинить:** Tech-lead в первое утро видит inconsistency, теряет доверие ко всему сканеру. Доверие хуже починять, чем не уронить.

**Как чинить:**
- В `bucketByHour` принять `tzOffsetMin` как 2-й параметр и пробросить из `renderRow → renderPersonRows → ctx`.
- В `setRenderContext({ tzOffsetMin })` уже есть инфраструктура `_renderContext` (см. `teamScanner2RendererCommon.js:174-178`). Используем.
- Зафиксировать: **обе** функции работают в «user's display TZ», server-local timestamp идёт в `computeHeatmap72x4` через `hoursAgo` (нет TZ-завязки, ок), а в `computeHeatmap` (24×3) — в локали юзера через единый offset.

**Критичность:** high. **Сложность:** low. **Ценность:** high.

---

### 4. `contextSwitches.switchEvents` штрафует за code-review-фокус как за «переключения»

**Описание:**
`teamScanner2Enrichment.js:538-580`. `switchEvents` = пары соседних events с разными `issue.key` и gap <30 мин. Каждый comment/transition/worklog в **чужой issue** (как ревьюер!) попадает в timeline. Senior, который последовательно открыл 5 PR-issues за 40 минут для review-сессии, получит `switchEvents.length = 4..5`, → ↻N badge (за productivity-флагом).

Badge скрывается через `q2_scanner_hide_productivity` (есть, ок), но **switch-score участвует в Z3** (`teamScanner2PersonMetrics.js:111-126`) и доступен в LLM-промпте и diagnostic.

**Зачем чинить:** Reviewer-фокус — это **противоположное** контекст-свитчингу как когнитивной проблеме, но метрика их слепливает.

**Как чинить:**
- Разделять events по `actorRole`: `author` / `reviewer` / `commenter` / `worklogger`. Switch только если author (или worklogger) сменил issue в author-роли. Reviewer-сессия — это **один контекст** (review backlog), даже если issues разные.
- Для этого в `portfolioPulseModel.js` walk-чейне нужно ещё одно поле в event'е (`role`). Простое extension.
- Альтернатива (cheaper): если за окно `>=70%` event'ов — comment/review/approve на issues где `assignee !== p`, switch-score обнуляется и заменяется на `review-focus-mode`.

**Критичность:** medium. **Сложность:** medium. **Ценность:** high.

---

### 5. «Задач затронуто 72ч» (counter в строке) — манипуляция выглядит как productivity

**Описание:**
`teamScanner2RendererPersonRows.js:188`:
```js
const tasksTouchN = (p.contextSwitches?.distinctIssueKeys ?? new Set([...].map(e => e?.issue?.key)).size);
```
«Затронуто» включает: commented-once, worklog 5 минут, transition другим человеком на issue где p assignee (sic — transitions appear в timeline для assignee даже когда actor другой). 1 коммент на чужую issue = +1 «задача».

В строке этот counter сосед `WIP / PR / часов`. Контракт пользователя: бóльшее число = «больше работает». Это **миф productivity**: для архитектора «1 issue по которой 5ч сидит» лучше «12 issues по которым 5 мин потрогал».

**Зачем чинить:** Метрика inverse-correlated с deep-work. Подкрепляет неправильную модель «активность = ценность».

**Как чинить:**
- Заменить «задач 5» → **«фокус-issue / разбросанность»** через `Gini coefficient` от распределения событий по `issue.key`. Низкий Gini = ровный спред (плохо для deep-work), высокий = есть «главная задача» (хорошо).
- Альтернатива: показывать `top1 issue: PROJ-123 (12 событий)` — это actionable, тимлид сразу видит «чем человек реально занят».
- Хотя бы: hide когда `distinctIssueKeys >= 8` (порог разрыва между normal и noise) и заменять на pill «много мелких касаний — посмотри детально».

**Критичность:** medium. **Сложность:** low (Gini — 5 LOC). **Ценность:** high.

---

### 6. `maxDwell` ≥24ч (▌Nh badge) не учитывает статус-семантику для «не зависит от человека»

**Описание:**
`computeBlockers` (Enrichment:1069+) фильтрует только `isTerminalStatus`. Не-terminal статусы типа `«Awaiting Stakeholder»`, `«Blocked-External»`, `«Ready for Release»` — все попадают в blockers с порогом `default=24h`. Pilot finding в коде уже признаёт: `_UNKNOWN_DWELL_STATUSES` (`Enrichment:256`) — surface для диагностики, но в roster всё ещё бьёт по сотруднику.

Пример: задача PROJ-1 в статусе `Awaiting Stakeholder` 72h. ▌3д висит на разработчике. Но это **stakeholder тормозит**, не разработчик. Карточка показывает «стоит без движения», тимлид зовёт разработчика — не туда.

**Зачем чинить:** Атрибуция dwell-time не на actor'а, а на ситуацию.

**Как чинить:**
- Добавить в `pickDwellThreshold` 4-ю категорию `'externallyBlocked'` с `threshold=Infinity` (то есть — никогда не считать blocker'ом для assignee).
- Распознавать статусы: regex `/awaiting|blocked|external|stakeholder|on hold|внешн|ожидан/i`.
- В UI на такие issues отдельный pill «внешн. блок» в blockers-shelf — это **информация**, не сигнал к разговору.

**Критичность:** high. **Сложность:** low. **Ценность:** high.

---

### 7. `closedToday` в Z1 productivity-score читает текст транзишена regex'ом — не state-machine

**Описание:**
`teamScanner2PersonMetrics.js:49-51`:
```js
const closedToday = (p?.timelineToday || []).filter(e =>
  e?.kind === 'transition' && /done|закрыт|готов|resolved/i.test(e?.text || '')
).length;
```
`e.text` — это **строка отображения** (`«Переведено: Open → Done»`), форматируется в `portfolioPulseModel.js`. Не распознаёт: «Closed», «Resolved as Won't Fix» (тоже закрыт, но `won't` не в regex), «Готов к деплою» (matches `готов`, но это НЕ closed — false-positive), «In Done Queue», «Cancelled», «Rejected».

Кроме того, Z1 умножает на 5.0 — самый высокий вес. Один false-positive «Готов к QA» = +5 productivity.

**Зачем чинить:** Score, используемый в LLM-сводке и потенциально в bullet-charts (V2 brief), считает «закрытые» неверно. Тимлид видит «Иванов закрыл 4» — а реально 0.

**Как чинить:**
- В `portfolioPulseModel.js` при формировании transition-event добавить explicit поле `terminalDestination: boolean` через `isTerminalStatus(toStatus, toCategory)`. Уже есть `isTerminalStatus` (импорт в Enrichment).
- В Z1 фильтровать `e.kind === 'transition' && e.terminalDestination === true`.
- Side-benefit: убирает зависимость от русского/английского текста статусов.

**Критичность:** high. **Сложность:** low. **Ценность:** high.

---

### 8. Heatmap 72×4 нормировка — `peakCell` ловит **глобальный** max, искажает baseline для тихих ролей

**Описание:**
`teamScanner2Enrichment.js:923-972`. `peakCell` — единственная клетка с max events. На команде где Bitbucket-актив (1 человек) делает 80 PR-событий за 72ч, его heatmap красная. Все остальные — почти прозрачные (sqrt normalize по rowMax строки, но `peakCell` reporting + UI saturation в panel идёт по абсолюту).

Архитектор, у которого 12 событий за 72ч (всё — CF + reviews) выглядит на heatmap как «почти ноль». Это **противоположно** тому, что должно быть: для архитектора 12 событий — это «нормальный темп», для DevOps-инженера 12 событий = тихо.

**Зачем чинить:** Нормировка по команде усиливает выбросы, скрывает медианных performers и пугает тихими ролями.

**Как чинить:**
- Нормировать по **роли** (`p.role` если есть в registry) или по **персональному baseline** (median per-person за 14 дней) — этот сигнал доступен через `history`.
- Альтернатива: dual-render — раскраска row относительно `rowMax` (текущая) **И** относительно `personMedian` (z-score стиль). Saturation по второй шкале.
- На `peakCell` — не репортить если `count < 3` (просто `peakHour: null`).

**Критичность:** medium. **Сложность:** medium. **Ценность:** medium.

---

### 9. WIP (issuesNow) считается без учёта watcher/reporter-role и draft-статусов

**Описание:**
`portfolioPulseModel.js`: `issuesNow` собирается как «issues где p — assignee и status не-terminal». В Sber Jira workflow часто есть статусы `Discovery` / `Sprint Backlog` / `Refinement` — это не WIP, это **inbox**. Reporter-роль не считается вообще.

Tech-lead обычно reporter на 20 issues за квартал — WIP=0, но он несёт ответственность. С другой стороны, junior assignee на 6 spike-ticket'ов в `Discovery` — WIP=6 (amber ≥4), but это just inbox.

**Зачем чинить:** WIP — основной счётчик «загрузки», который тимлид видит. Сейчас он шумит в обе стороны.

**Как чинить:**
- Делить `issuesNow` на «active» (статусы matching `inProgress|review|qa|testing`) и «inbox» (статусы matching `todo|new|open|discovery|refinement`).
- В UI counter показывать **active**, а полное число как hover.
- Альтернатива: add `recentlyTouched` filter (статус был изменён p за 7 дней) — это «реально на тебе сейчас».

**Критичность:** medium. **Сложность:** low. **Ценность:** medium.

---

### 10. `composePersonNarrative` склеивает rolling-24h, но `cutoff48h - cutoff24h` для «вчера» — это **окно недостоверное** для не-рабочих дней

**Описание:**
`teamScanner2Insights.js:961-973`. Pred используется как «вчера было». Понедельник 10:00 → cutoff48h = пт 10:00. «Вчера» = воскресенье 10:00 — пн 10:00. Если человек не работал в вс — narrative заявит «вчера тишина» при нормальной пятнице.

Аналогично — «отпуск пн-вт» с возвратом в ср: ср 10:00 narrative «вчера тишина (вт)». Нормально, но «3 дня назад» (понедельник до отпуска) не отображается.

**Зачем чинить:** Narrative — основная фраза в panel'и, на которую смотрит тимлид. Пн утром она **систематически** говорит «вчера тишина» для здоровых команд.

**Как чинить:**
- Заменить rolling-cutoff на **рабочие дни** через `getDay()` маску (skip 0/6). На вс события не ожидаются — следовательно «previous working day» = пт.
- Альтернатива: показывать **timestamp** последней значимой активности явно: «Последняя активность: пт 17:42». Это исключает интерпретационный шум.
- Hook на календарь отпусков (если есть в Реестре сотрудников) — если человек в отпуске, narrative показывает «В отпуске до 2026-06-10», а не «тишина».

**Критичность:** medium. **Сложность:** low (working-day skip), high (отпуска через registry). **Ценность:** high.

---

### 11. `crv` (Code Review Velocity) — медиана по reviewer'у, но **opened-PR** ищется в `bbItems` всех participants

**Описание:**
`teamScanner2Enrichment.js:1143-1184`. `prOpenedAt = Map<prId, earliestAt>` строится из всех `bbItems(kind='pr')`. Если автор PR — **service-account** (отфильтрован S4) или **deactivated** (S10.1 фильтр), либо просто не в команде (cross-team review), его PR в map'е **нет** — `openedTs === undefined` → review откидывается из подсчёта медианы.

Senior, который последние 14 дней делал review на 30 PR из соседней команды — `crv.count = 0..3`. Метрика выглядит как «он не делает review», хотя факт обратный.

**Зачем чинить:** CR-velocity — это **скрытая** оптимизация (нет в строке без `count>=2`), но в panel она показывается как `CR Xч`. Систематический недосчёт.

**Как чинить:**
- В `prOpenedAt` использовать **server-side aggregator** который видит ВСЕ PR за окно (а не только attributed к participants). У нас уже есть `ppFetchBitbucketActivity` (см. `portfolioPulseModel.js:880+`) — он возвращает `byAuthor` map. Расширить ответом всех PR без author-filter (или хотя бы с `openedAt` per `prId`).
- Альтернатива: считать review-velocity через `(reviewTs - cutoffStart-or-rolling-7d-min-PR-age)` — менее точная, но не теряет cross-team.
- В UI ослабить `count >= 2` до `count >= 1` с suffix `(based on ${count})`.

**Критичность:** medium. **Сложность:** medium. **Ценность:** medium.

---

### 12. `prThroughput` понимает только `MERGED|DECLINED|OPEN` — теряет `IN_REVIEW`/`DRAFT`

**Описание:**
`teamScanner2Enrichment.js:1197-1225`. `merged/declined` distinct, всё остальное (включая DRAFT, IN_REVIEW, ABANDONED) попадает только в `opened`. PR который сидит в `DRAFT` 5 дней — `opened=1, merged=0, mergeRate=0` → флаг `'stalled'` (mergeRate<0.4) → плохой сигнал.

DRAFT — это **намеренно не для review**. ABANDONED после редизайна тоже не «тонет в правках».

**Зачем чинить:** PR Throughput badge в строке (`N↗ Z% prT-flag`) показывает stalled/overload — это видимый бэйдж и LLM им оперирует. False-positive ведёт к «зачем-то этот человек тонет», хотя реально DRAFT — намеренно.

**Как чинить:**
- Считать `relevantOpened = opened - draft - abandoned`. `mergeRate = merged / relevantOpened`.
- В UI tooltip разворачивать: `7 opened (2 draft, 1 abandoned, 4 review-eligible — 2 merged → 50%)`.
- Flag `overload` triggers только если `relevantOpened > threshold`.

**Критичность:** medium. **Сложность:** low. **Ценность:** medium.

---

### 13. `pulse-attention` (3 пульса) на регресс — без cooldown и без weekend-skipping

**Описание:**
`teamScanner2RendererPersonRows.js:266-287`. `is-pulse-attention` ставится когда `currentGroup` хуже `prevGroup`. Prev snapshot — это `ctx.prev`, обычно вчерашний.

Понедельник: пт `moving`, пн `stop` (за вс не было активности — естественно). Пульс. Каждый понедельник у всей команды.

Аналогично — после отпуска: возврат в ср, прошлый snapshot — пт перед отпуском (`moving`), сегодня `stop` (нет blocker'ов, нет today, есть stuck) — пульс.

**Зачем чинить:** Pulse дезориентирует на ожидаемые transitions. Если каждый понедельник вся команда пульсирует, тимлид «отключает зрение» на этом сигнале.

**Как чинить:**
- Skip pulse если `now - prevSnapshotAt > 36h` (т.е. был выходной/отпуск).
- Skip pulse если `dayOfWeek === 1` (Monday) и `prevSnapshot.dayOfWeek === 5`.
- Cooldown: пульс не повторяется для того же `p.key` чаще раза в 24h (localStorage `q2_pulse_seen_${key}_${date}`).

**Критичность:** medium. **Сложность:** low. **Ценность:** medium.

---

### 14. Worklog-based hours (`loggedTodaySec`) — это **подмножество** реальных часов

**Описание:**
`portfolioPulseModel.js:537-555`. Walk через `worklog.worklogs`. У большинства Sber-команд worklog **не заполняется системно** (он нужен бухгалтерии, не разработчикам). Pilot data типично: 5-15% разработчиков логируют worklog регулярно.

В строке: `0 ч` для большинства людей — выглядит как «человек ничего не сделал», а реально просто `worklog` пуст. Метрика медианы команды (`tm.hours`) — медиана от мусорного распределения.

**Зачем чинить:** Один из 4 counter'ов в строке. Систематически вводит в заблуждение.

**Как чинить:**
- В UI: hide counter `0 ч` если `team.medianHours === 0` (вся команда не логирует — counter бессмысленный для всех).
- Per-team detection: если `worklogCoverage = sum(loggedSec) / sum(events) < threshold` — баннер «команда не использует worklog систематически — счётчик «часов» не репрезентативен».
- Долгосрочно: заменить worklog часом на **proxy через events**: оценка active hours = `lastEvent - firstEvent - gaps>2h`. Pomodoro-style.

**Критичность:** high (counter в каждой строке вводит в заблуждение). **Сложность:** low (hide), medium (proxy). **Ценность:** high.

---

### 15. Что НЕ измеряется и должно: real-time communication / pairing

**Описание:**
В Сбере **звонок/Slack-обсуждение/обсуждение в Teams** — это основной канал на 30-50% рабочего дня senior'а. Нет ни одного сигнала об этом в Сканнере.

Senior, который полдня менторит junior'а по vidcall — `idle` или `stop` в роли.

**Зачем чинить:** Систематическая slepота для самой ценной работы senior'ов и tech-lead'ов.

**Как чинить:**
- Признать прямо в UI: badge «Communication-only signal-poor» если у человека `role === 'senior'/'lead'/'architect'` (из registry) и `(events < median * 0.3)`.
- Hook на корпоративный календарь / Teams API (если когда-нибудь будет доступ): events с тегом «1:1 / mentoring / arch review» добавляются как `kind:'meeting'` в timeline.
- Альтернатива (cheap): self-reported «что я делал» через quick-action в person panel: button `Я провёл ${X}ч на ${type}`, кэшируется и отображается в narrative.

**Критичность:** medium. **Сложность:** high (real integration), low (self-report). **Ценность:** high.

---

### 16. `_filterParticipantBySprintKeys` молча выкидывает activity на issues без `issueKey` в commit-msg — даёт **рассинхрон counter'ов**

**Описание:**
`teamScanner2Enrichment.js:123-157`. Комментарий уже признаёт: коммиты без issueKey в commit-message остаются в `bbItems`, но `badges.commits48h` пересчитывается по тому же sprint-filter в другом месте (или не пересчитывается). Pilot finding явно: `«badges.commits48h > 0 при пустом bbItems»` (diag.js:853).

**Зачем чинить:** Badge `B 5` в строке + пустая `bb`-секция в panel = тимлид теряет доверие к данным. Это уже flag'ed в diagnostic как warn, но **не починен**.

**Как чинить:**
- При `activeSprintOnly=true` пересчитывать badges:
  ```js
  p.badges.commits48h = (p.bbItems || []).filter(it => it.kind === 'commit').length;
  p.badges.pr48h      = (p.bbItems || []).filter(it => it.kind === 'pr').length;
  ```
  после фильтра.
- ИЛИ: badges остаются raw (текущее поведение), но в UI рядом с chip'ом badge `B 5*` со звёздочкой и tooltip «5 коммитов, но не все привязаны к активному спринту».

**Критичность:** high (внутренняя противоречивость данных). **Сложность:** low. **Ценность:** high.

---

### 17. `pickDwellThreshold` fuzzy-regex не покрывает много реальных Sber-статусов

**Описание:**
`teamScanner2Enrichment.js:257-269`. Coverage:
- `codeReview`: ловит `code review|peer review|на ревью|ревью кода`. **Не ловит**: `Code Review WIP`, `Awaiting Reviewer`, `PR Approved`.
- `qa`: `qa|test|тестирован|ready for qa`. **Не ловит**: `Ready for Smoke`, `Acceptance`, `UAT`.
- `inProgress`: `in progress|working|doing|в работе|разработ`. **Не ловит**: `Active`, `Development`, `Coding`.
- Custom: `Awaiting Stakeholder`, `Blocked-Tech`, `Hold` — все попадают в `default=24` и стают blocker'ом.

`_UNKNOWN_DWELL_STATUSES` есть для диагностики, но **rule не self-tunes**.

**Зачем чинить:** False-positive blocker'ов = false-positive `stop`-классификации = ненужные тимлид-разговоры.

**Как чинить:**
- Регулярно (раз в неделю) экспортировать `_UNKNOWN_DWELL_STATUSES` в config — собирать список всех custom-статусов в Sber Delta.
- Per-team threshold override (`teamThresholds` в API уже есть) — задействовать через registry «эта команда использует BPMN workflow, поставь Awaiting → 168h».
- В UI: пилотный режим diagnostic: показать тимлиду «вот 5 статусов которые я не понимаю — скажи мне их семантику» (выбор из dropdown `[codeReview | qa | inProgress | externalBlock | inbox]`).

**Критичность:** medium. **Сложность:** medium. **Ценность:** medium.

---

### 18. `team-medians` (used в tooltip «×1.5 от среднего») берут **median по всей команде**, включая `stop`+`idle` участников

**Описание:**
`teamScanner2RendererPersonRows.js:98-111`. `_median([1, 2, 0, 0, 0, 0, 0])` = 0. Если в команде 10 человек и 7 idle (типично для отпускного периода), median = 0. Tooltip: «×Infinity от среднего» или просто «×3» (для активных). Распределение **не нормальное**, median не имеет смысла.

**Зачем чинить:** Tooltip обещает meaningful сравнение, отдаёт мусор.

**Как чинить:**
- Median только по `moving + watch` (active). Эти люди — peer-baseline.
- Если активных < 3 — hide tooltip-сравнение вовсе («слишком мало данных для сравнения»).
- Альтернатива: median по historical 14-day rolling — стабильнее, не дёргается на сегодняшние отпуска.

**Критичность:** medium. **Сложность:** low. **Ценность:** medium.

---

## Опциональный блок: новые метрики/сигналы, которые стоит добавить

Список — не «всё сразу», а **банк альтернатив** для замены текущих низкокачественных:

| Заменить | На |
|---|---|
| `tasksTouchN` (counter «задач») | Gini-coefficient распределения events по issue.key, или `top1: PROJ-123 (12 событий)` |
| `closedToday` regex | `e.terminalDestination` boolean из portfolioPulseModel |
| WIP (issuesNow) — flat count | WIP active vs inbox (по статус-bucket) |
| `loggedTodaySec` | active hours proxy: `lastEvent - firstEvent − gaps>2h` |
| `↻N switches` | `focus-coefficient = top1_issue_events / total_events` |
| pulse-attention | pulse только если `prev snapshot ≤ 36h` назад И `prev !== Sunday` |
| `crv` median | Server-side full PR pool, не client-attributed только |
| `prThroughput` flag | Exclude DRAFT + ABANDONED из knownopened |
| `composePersonNarrative` rolling-24h | Working-day-aware: пятница как «вчера» в понедельник |
| stop-classification | Add 'review-focus' class когда reviewSig доминирует |
| `team-medians` | Median только по `moving+watch`, или 14-day rolling |
| heatmap saturation | Personal baseline (per-person median) vs team-wide max |

## Если бы мне дали 2 недели на это — что бы я сделал в первую очередь

**Неделя 1 — починить откровенно ложные сигналы (high crit + low cost):**

1. **День 1-2:** Findings 3 (TZ unification), 7 (terminalDestination bool вместо regex), 16 (badges vs bbItems sync при sprint-filter).
   Это инфраструктурные точки — починка освобождает от false-positive в *множестве* downstream сигналов.

2. **День 3-4:** Findings 6 (externally-blocked status carve-out из blockers) и 1 (classifier учитывает reviewSig для stop-rule).
   Это меняет **классификацию**, которая определяет UI-приоритизацию. Самый высокоранговый CTA — больше не врёт.

3. **День 5:** Finding 14 (worklog-hours hide когда team не использует) и 18 (median только по active). Tooltip честный.

**Неделя 2 — изменить метрики, не показатели:**

4. **День 1-2:** Finding 2 (`emptyDayLanguage` — заменить «Коммиты без транзишенов» на нейтральный текст) и 5 (`tasksTouchN` → Gini / focus-coefficient). UX-level cleanup, требует CSS/copy review.

5. **День 3-4:** Finding 10 (working-day-aware narrative) и 13 (pulse cooldown + weekend skip). Это закрывает «понедельничный шум».

6. **День 5:** Finding 4 (reviewer-focus в switch-score) — изменение в pipeline, нужны unit-tests на demo-fixture.

**Заведомо отложить:**
- Finding 11 (server-side full PR pool) — требует серверного endpoint refactor, отдельный спринт.
- Finding 15 (real communication signal) — нужны integration discussions, политика.
- Finding 17 (auto-tune dwell-thresholds) — нужен registry config UI.

**Что НЕ делать в эти 2 недели:**
- НЕ добавлять новые метрики до починки существующих. Иначе тимлид перестаёт верить вообще всему.
- НЕ трогать heatmap nornalization (finding 8) — это перцептивный спор, нужен пилот-feedback.
- НЕ убирать productivity-chips (это другой угол — ethics, не signal-quality).
