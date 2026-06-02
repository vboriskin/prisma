# Аудит таблицы сотрудников: killer-фичи (превращение roster'а в копилота тимлида)

**Эксперт:** Product strategist, digital tooling. Угол — превращение «отчёта о людях» в инструмент, который тимлид не сможет удалить, потому что он начнёт планировать день вокруг него.
**Дата:** 2026-06-02

## Резюме

Сегодня roster — это **диагностика** (классификация + drill-down). Тимлид использует его утром: «есть ли красное», далее идёт в Jira / Slack — инструмент закрывается. Killer-features превращают его в **рабочую плоскость дня**: 1:1-prep с памятью, draft-handoff для выходных, конфликт-радар «два человека правят один файл», predictive WIP-balance («если возьмёшь ещё PROJ-X — встанешь в стоп»), retention-сигналы с долгим окном, mentor-matching на основе solo-author paths, deep-work protection через learned-rhythm. У всех идей одна общая черта: они используют **уже доступные** в `model` сигналы (changelog, bbItems, blockers, firstLast, soloAuthor, narrative) — нужна только новая компоновка и persistence-слой. Идеи сортированы по reach × wow-фактору: 1-4 — high-conviction, 5-9 — moonshots с обоснованием.

## Находки

### 1. 1:1 Memory Lane — обогащённый prep-блок с историей разговоров

**Описание:** Сейчас `#ts2-detail-spawn-1on1` (`teamScanner2.js:2726`) копирует in-the-moment контекст в буфер. Это «одноразовое» использование. Тимлид через две недели на следующем 1:1 не помнит, о чём договорились, и собирает то же самое заново. В detail panel нужен раздел **«История 1:1»** — простой markdown-журнал с datestamp, где (а) кнопка «1:1 done» закрывает текущий контекст и складывает в журнал, (б) при следующем открытии panel видна предыдущая запись + рекуррентные пункты («второй 1:1 подряд жалуется на CR-load»), (в) рядом prep-block для нового разговора, авто-собранный из delta «что изменилось с прошлого 1:1». Persistence — localStorage с ключом `q2_scanner_1on1_log_${personKey}` (как `q2_scanner_hide_productivity` в `teamScanner2RendererPersonRows.js:240`); опционально server-side если SQLite-WASM включён.
**Зачем чинить:** Closes job «pre-1:1 prep за 90 секунд + следить за выполнением договорённостей». Сейчас тимлиды держат это в Notion/Obsidian — фрагментирует контекст. Roster получает sticky-loop: я зашёл записать → я зашёл прочитать → я зашёл записать.
**Как чинить:** New module `teamScanner2OneOnOneLog.js` + section в `renderEmployeeDetailPanel`. Pseudo:
```js
function renderOneOnOneSection(p) {
  const log = OneOnOneLog.get(p.key); // [{at, summary, agreedActions, observedAt1on1}]
  const prepDiff = buildPrepDiff(p, log[log.length-1]); // что нового vs прошлый раз
  return `<details class="ts2-1on1-section">
    <summary>1:1 с ${esc(p.label)} <span class="ts2-1on1-count">${log.length}</span></summary>
    ${renderPrepCard(prepDiff)}
    ${renderHistoryList(log)}
    <button data-action="1on1-done">Закрыть 1:1 — сохранить итог</button>
  </details>`;
}
```
Diff-блок переиспользует existing `composePersonNarrative` (`teamScanner2Insights.js:955`) + diff между текущим и сохранённым snapshot'ом personMetrics.
**Критичность:** medium (не блокирует, но удерживает в инструменте)
**Сложность:** medium (новый persistence-слой + UI section, ~300 LOC)
**Ценность:** **high** — закрывает дорогой паттерн «менеджер ведёт Notion параллельно с инструментом»

**Sketch:** В detail panel под Narrative — раскрывашка `1:1 с Аней (4)`. Раскрыл — карточка `Prep на сегодня` с буллет-листом: «Прошлый раз договорились снять CR-load → за 2 недели prReviews ▲ 18 → 9 ✓»; «Новое: 2 PR висят >3д»; «Тема: feedback по архитектуре X (она спрашивала)». Под ней — список предыдущих записей, click → раскрыть запись.
**Why it changes things:** Сегодня инструмент видит «сейчас» — это commodity-функция. Инструмент с памятью договорённостей становится **личным журналом тимлида** → личная привязка → ежедневное открытие vs «открываю когда что-то горит».

---

### 2. Async-handoff draft — кнопка «Хочу подменить на выходные»

**Описание:** В roster каждая строка содержит достаточно сигналов чтобы автоматически собрать **handoff-документ для коллеги, который подхватит на отпуск/больничный**: WIP (issuesNow), blockers, активные PR (bbItems с kind='pr'), solo-author paths (`detectSoloAuthorFiles`, `teamScanner2Insights.js:577`), последний commit. Сейчас, если человек уходит — менеджер вручную составляет это в Telegram. Сценарий: правый клик на строке → «Сгенерировать handoff» → модалка с draft-markdown'ом (можно отредактировать) → кнопка «Скопировать» + поле «Кому передаём» (autocomplete по команде, использует skillTags из совпадений по compomentов / repo). Bonus: подсветка «непокрытых» узлов — задач без обозначенного buddy в команде.
**Зачем чинить:** Closes острый job «уходить в отпуск без чувства вины». В банке отпуск — это формальное дело с handover-документом. Сейчас он составляется вручную, со страхом «что-то забуду». Инструмент знает больше чем сам сотрудник: solo-files, in-flight PR, dwell-сигналы.
**Как чинить:** В kebab-меню строки roster (нет сейчас — добавить) пункт «Подготовить handoff». Открывает overlay, который рендерит markdown по шаблону:
```js
function composeHandoffDraft(p, model) {
  return [
    `# Handoff: ${p.label} → ${buddy.label}`,
    `## In flight`,
    ...p.issuesNow.map(it => `- ${it.key} «${it.summary}» — статус ${it.status}, ${dwellHours(it)}ч в текущем`),
    `## Открытые PR`,
    ...p.bbItems.filter(it => it.kind === 'pr' && (it.state === 'OPEN')).map(...),
    `## Где я единственный знаток`,
    ...soloPathsFor(p.key).map(f => `- ${f.path}`),
    `## Зависшие 24ч+`,
    ...p.blockers.map(b => `- ${b.key} «${b.summary}» — ▌${b.dwellHours}ч в "${b.status}"`),
    `## Контекст последнего дня`,
    composePersonNarrative(p).sentences.join(' '),
  ].join('\n');
}
```
Persistence — копия в localStorage `q2_scanner_handoff_${personKey}_${date}` чтобы при возврате из отпуска reverse-handoff («что произошло без меня») собрался автоматически diff'ом с момента handoff'а.
**Критичность:** medium
**Сложность:** medium (~250 LOC, переиспользует существующие insights)
**Ценность:** **high** — closes тревожный job

**Sketch:** В строке roster при hover появляется ⋮ → «Подготовить handoff». Модалка 600×800, левая колонка — draft markdown (editable), правая — checklist «Кому передаём» (с auto-suggest на основе сопоставления issuesNow.epicKey / labels к topic-fingerprint других в команде). Внизу — Copy и Send-to-TG. После copy — toast «Handoff сохранён; при возврате я покажу reverse-handoff».
**Why it changes things:** Roster выходит за пределы дня и становится инструментом **рабочих переходов** (отпуск, sick day, переключение проекта). Это уникальный moat — никакой Jira/BB этого не сделает потому что у них нет cross-источниковой identity.

---

### 3. Conflict Radar — predictive «двое правят один файл / один эпик»

**Описание:** В `detectSoloAuthorFiles` (`teamScanner2Insights.js:577`) уже считаем authors-per-file. Симметричная фича — **multi-author files за окно**: два человека за последние 48ч коммитили в один файл. На уровне Jira: два человека active в одной эпике с overlapping sub-tasks. Это **классический предвестник merge-conflict / rework**. На roster level — мини-badge `⇄` рядом с именем + tooltip «Пересекаешься с Ваней на 3 файлах». В team-view (header section выше roster) — секция «Risk of collision» с подсветкой пар. Stretch: если оба правят файл out-of-the-blue (не было предыдущей истории) — alert «незапланированное пересечение».
**Зачем чинить:** Closes job «избегать неожиданных rebase-войн». В моб-платформе с monolith-репами это реальная боль. Сейчас единственный способ узнать — merge-conflict в PR.
**Как чинить:** Pure-function на `bbItems`:
```js
function detectCollisionPairs(model) {
  const filePeople = new Map(); // path → Set<personKey>
  const window = Date.now() - 48 * HOUR;
  for (const p of model.participants) {
    for (const it of (p.bbItems || [])) {
      if (Date.parse(it.at) < window) continue;
      for (const f of (it.files || [])) {
        if (!filePeople.has(f)) filePeople.set(f, new Set());
        filePeople.get(f).add(p.key);
      }
    }
  }
  // Build pair-overlap
  const pairs = new Map(); // "a|b" → {files: [], hot: bool}
  for (const [path, ppl] of filePeople) {
    if (ppl.size < 2) continue;
    const arr = [...ppl];
    for (let i = 0; i < arr.length; i++) for (let j = i+1; j < arr.length; j++) {
      const key = arr[i] < arr[j] ? `${arr[i]}|${arr[j]}` : `${arr[j]}|${arr[i]}`;
      if (!pairs.has(key)) pairs.set(key, {files: [], people: [arr[i], arr[j]]});
      pairs.get(key).files.push(path);
    }
  }
  return [...pairs.values()].filter(p => p.files.length >= 2);
}
```
В row рендерится `⇄2` badge — клик подсвечивает second person в roster (синяя обводка).
**Критичность:** medium-high (реальная боль в моно-репах)
**Сложность:** medium (зависит от наличия `bbItems[].files` — нужна проверка/enrichment)
**Ценность:** **high** — предотвращает rework

**Sketch:** В строке Ани мелкий badge `⇄ Иван 3 файла` (синего цвета, не red — это не «плохо», это «к сведению»). Click → roster autoscroll на строку Ивана, между строками рисуется тонкая линия (CSS curve), в panel'и при открытии Аниного detail добавляется секция «Пересечения за 48ч».
**Why it changes things:** Превращает roster из «лестницы сверху-вниз» в **граф взаимодействий** — социальная плоскость. Тимлид впервые видит команду не как 12 строк, а как сеть.

---

### 4. Workload Balance Forecast — «если возьмёшь ещё одну — встанешь в стоп»

**Описание:** Текущий WIP-counter в row показывает факт. Killer-расширение — **прогноз**: при наведении на чужую строку из контекста «я хочу назначить новую задачу» (например, в Jira-assign dropdown за пределами Сканнера) видеть «после назначения этот человек уйдёт из moving в watch» (overload-предсказание). Внутри Сканнера это работает иначе: рядом с WIP counter — **headroom-bar** (мини-progress) — сколько ещё WIP человек может потянуть до классификации в watch (порог `wip >= 3`, `teamScanner2Classifier.js:91`). Color-coded: зелёный — есть запас 2+, амбер — 1, красный — уже на пороге. В detail panel это разворачивается в **«Кому отдать?»** — ranked list альтернатив (зелёный headroom + матч по эпике/labels из issuesNow).
**Зачем чинить:** Closes job «equitable distribution». Сейчас тимлид угадывает «у Ани вроде поменьше задач» — иногда ошибается потому что не учитывает blockers/CR-load. Headroom-bar = одно-секундное решение.
**Как чинить:**
```js
function headroomFor(p) {
  const wip = (p.issuesNow || []).length;
  const blockerWeight = (p.blockers || []).filter(b => b.dwellHours >= 24).length;
  const reviewLoad = p.badges?.prReviews48h || 0;
  const adjusted = wip + blockerWeight * 0.5 + reviewLoad * 0.3;
  const threshold = 3; // = watch
  return {
    used: Math.round(adjusted * 10) / 10,
    free: Math.max(0, threshold - adjusted),
    rank: adjusted < 2 ? 'spacious' : adjusted < 3 ? 'tight' : 'full',
  };
}
```
В row — мини-bar после WIP counter:
```
WIP 2 [ ████░░ ] есть запас
```
Click — открывает panel'у с расширением «Что назначать?» — фильтр open-issues по labels/components где у sotrudnika уже был опыт.
**Критичность:** medium (полезно для распределения)
**Сложность:** medium (форму бар; recommendation-engine сложнее, можно итерировать)
**Ценность:** **high** — превращает roster в **planning surface**, не только status

**Sketch:** В каждой row рядом с WIP appears horizontal bar 30px wide, 4 сегмента. Заполненные = busy units. При hover — tooltip «3.5 unit'а / 3 unit-предел. Перегрузка на 0.5» с разбивкой. У моих senior'ов 4-5 unit'ов, у джунов 2-3 — кастомизируется в profile.
**Why it changes things:** Roster становится **predictive**: «что будет если». Это другой тип инструмента — не зеркало, а советник.

---

### 5. Deep Work Protector — анти-«дерг», learned-rhythm + protection score

**Описание:** В `personMetrics.firstLast` (`teamScanner2PersonMetrics.js`) уже считается `first/last activity` за 24ч. Накопив 14+ дней (через snapshot/history) можно построить **personal rhythm chart** для каждого сотрудника — когда у него «час дикой продуктивности» (cluster commits) vs «дробный day». В row появляется бэйдж `🛡 deep-block 10-12` — индикация «не дёргай в эти часы». В team-view (поверх roster) — temporal heatmap «когда в команде кто залип»; тимлид видит «сейчас 11:00 — 5 человек в deep block, не назначай stand-up». 
**Зачем чинить:** Closes job «как тимлид я случайно дроблю людям день». Прерывание стоит 23 минуты recovery (Mark/González 2008). Инструмент знающий ritmы превращается в **уважительный** к команде.
**Как чинить:** Новый insight `detectPersonalRhythms(history)`:
```js
function detectPersonalRhythms(person, history /* last 14 days */) {
  const hourActivity = new Array(24).fill(0); // accumulate commits/events per hour
  for (const snap of history) {
    const p = snap.participantsByKey?.[person.key];
    for (const e of (p?.timeline72h || [])) {
      const h = new Date(e.at).getHours();
      hourActivity[h]++;
    }
  }
  // Cluster: find 2-3 hour windows of high activity vs baseline
  const baseline = mean(hourActivity);
  const peaks = findPeakWindows(hourActivity, baseline);
  return peaks.map(w => ({startHour: w.start, endHour: w.end, intensity: w.peak / baseline}));
}
```
В row — мини-strip над 24-dot today-strip с подсветкой deep-block hours; при hover — «12-14 — обычно deep-work, лучше не назначать meeting».
**Критичность:** low-medium (мягкая фича, не tier-1)
**Сложность:** medium (нужно accumulate history; уже есть `teamScanner2History.js`)
**Ценность:** medium-high — closes humane-tool positioning

**Sketch:** В strip-today over the 24-dot dot-strip — тонкая полоска снизу, где outline highlights `deep-block 11-13`. В team-view header — sparkline «сколько людей сейчас в deep-block» как live-counter.
**Why it changes things:** Roster уходит от «менеджер контролирует» в сторону «инструмент защищает команду» — заметный shift в этосе, противоядие к репутации «watchdog». Это меняет восприятие инструмента самими разработчиками («о, он же ещё и за меня заступается»).

---

### 6. Mentor-Mentee Auto-Match — на основе solo-author paths и onboarding ramp

**Описание:** В `detectSoloAuthorFiles` уже считаем bus-factor-1 файлы. В `computeOnboardingRamp` (`teamScanner2Insights.js:607`) — кто новичок. Кросс-факт: **если в команде есть solo-author по `RegistryEditor.js` и есть новичок на 30 day onboarding — предложить парную работу**. В detail panel новичка — секция «Кого взять в наставники по областям, которые ты тронул» (matching ranked по: (а) solo-author overlap с issuesNow, (б) частота review-pair'инга с этим автором, (в) similar tenure profile). В detail panel senior'а — «Кого можешь подтянуть» (новички с пересечением component'ов).
**Зачем чинить:** Closes job «как тимлид я не вижу bus-factor-1 риски пока кто-то не уволится». Инструмент видит код-граф (через bbItems.files), знает кто новичок (onboardingStartDate) — мэтч в two-click.
**Как чинить:**
```js
function suggestMentorPairs(model) {
  const solo = detectSoloAuthorFiles(model); // [{path, author}]
  const newbies = computeOnboardingRamp(model); // [{key, tenureDays}]
  const matches = [];
  for (const nb of newbies) {
    const nbFiles = filesTouched(nb.key, model); // pull from bbItems
    const candidates = solo.filter(s => nbFiles.some(f => sharePrefix(f, s.path)));
    if (candidates.length === 0) continue;
    matches.push({newbie: nb.key, mentor: candidates[0].author, overlap: candidates.length});
  }
  return matches;
}
```
В detail panel — секция «Mentor-suggestion» с кнопкой «Запланировать парную сессию» (открывает draft в clipboard).
**Критичность:** low-medium (long-tail value; не тушит пожар, но строит команду)
**Сложность:** medium (нужны file-paths в bbItems — проверить shape)
**Ценность:** medium-high — strategic moat

**Sketch:** В detail panel новичка под Narrative — секция `Возможные наставники` со списком из 2-3 senior'ов и одной строкой «совпадение по: `module/payments/*`, `auth/`». В detail panel senior'а — секция `Зоны где ты единственный знаток (риск bus-factor)` со списком файлов + предложение «Иван (онбордится 28 день) уже трогал `payments/cards.js` — попарьтесь».
**Why it changes things:** Roster становится инструментом **роста команды**, не только мониторинга. Это HR-партнёр в одном клике. И — это уникальный сигнал, которого нет ни в Jira, ни в Confluence, ни в BB.

---

### 7. Retention Radar — длинно-окночная аномалия настроения

**Описание:** Есть `burnoutChip` (composite weekend/late-night/WIP), но он binary (на месяц назад человек уже выгорел). Нужен **early-warning sensor**: тренды за 4-8 недель по комбинации сигналов — постепенное снижение firstLast.span (короче день), рост switchEvents/h, исчезновение CF-активности (перестал документировать), увеличение dwell-time на одной задаче (frustration), пропадание после-обеденных активностей (мотивация ▼). Не «red flag сейчас», а **тренд-strip** в row — 8 точек, цвет если есть значимое drift вниз. Click — секция «Что в этом тренде» в panel с разложением.
**Зачем чинить:** Closes job «как тимлид я узнаю об увольнении за неделю». Кивок на «у нас нет 1:1-системы». Инструмент видит цифровой след за 6 недель — может намекнуть «у Ивана 5 недель подряд снижается deep-block длительность, 3 недели нет CF-активности».
**Как чинить:** Через `teamScanner2History` уже копится daily-snapshot. Нужен новый insight:
```js
function detectRetentionDrift(person, history /* last 60 days */) {
  const series = history.map(snap => snap.participantsByKey?.[person.key]?.personMetrics).filter(Boolean);
  if (series.length < 30) return null;
  const span = series.map(m => m.firstLast?.span || 0);
  const cf = series.map(m => m.cfCount || 0);
  // Linear regression slopes:
  const spanSlope = linearSlope(span);
  const cfSlope = linearSlope(cf);
  const signals = [];
  if (spanSlope < -0.05) signals.push({kind: 'work-day-shrinking', slope: spanSlope});
  if (cfSlope < -0.1) signals.push({kind: 'docs-vanishing', slope: cfSlope});
  // …
  if (signals.length >= 2) return {confidence: 'medium', signals};
}
```
В row — тонкий 8-точечный спарклайн справа от burnoutBadge; цвет — синий обычно, амбер если drift.
**Критичность:** medium (slow-burn problem)
**Сложность:** high (нужно robust history + per-person snapshot enrichment)
**Ценность:** **high** — закрывает $200k+ проблему (стоимость потери senior'а)

**Sketch:** В строке — крошечная 8-точечная sparkline `▁▁▂▃▃▄▄▄` справа от burnout-chip. Цвет — приглушённый. Hover — «4 недели подряд: рабочий день укорачивается, CF-активность снижается, дольше задерживаешься на одной задаче — стоит спросить как дела». В panel — секция «Long-term signals» с 6-line chart.
**Why it changes things:** Roster впервые работает с **длинным горизонтом** (60 дней vs 72ч). Это меняет временной масштаб инструмента — теперь у него «своё мнение об эпохе», а не только о дне.

---

### 8. Ambient Background Mode — pinned tab who whispers

**Описание:** Roster открывается утром, через 30 минут закрывается. Невидимая фича — **ambient mode**: если выставить scanner в pinned tab режиме, он молча работает в фоне, **показывает изменения через favicon-индикатор** (`(2)` если 2 человека сдрейфовали moving→stop), при mouseover на pinned tab — preview-tooltip top-3 событий. Можно подписаться на конкретного сотрудника / триггер — push notification в OS (с разрешения) только когда **state change**, не сырая телеметрия.
**Зачем чинить:** Closes job «not invasive monitoring». Тимлиды не любят постоянное оповещение про команду — это watchdog vibe. Но критичные state-changes (stop alert на senior'е, новый блокер >24ч) — хотят знать сразу.
**Как чинить:** Service worker + favicon dynamic-render. Триггер — diff между last snapshot и текущим polling. Уведомления настраиваются в Сканнер settings — какие людские роли / какие группы.
```js
// poll every 15 min; compare classifyPerson; emit Notification если drop
async function ambientCheck() {
  const fresh = await fetchModel();
  const drifts = computeDrifts(prevSnap, fresh);
  if (drifts.length === 0) return;
  updateFavicon(drifts.length);
  if (Notification.permission === 'granted') {
    for (const d of drifts.filter(d => d.severity > 70)) {
      new Notification(`${d.person} → ${d.toGroup}`, {body: d.reason});
    }
  }
}
```
**Критичность:** low-medium (premium-feature; не для всех)
**Сложность:** medium-high (service worker + Notification flow)
**Ценность:** medium — превращает тулу в **always-present companion**

**Sketch:** В pinned tab появляется красная точка над favicon если есть критичный drift. Hover — нативный tab title «Призма Сканнер · 2 новых в Стопе». Click → разворачивается на конкретного. Settings «Ambient»: чекбоксы «уведомления о senior drift», «новый blocker >48ч», и т.п.
**Why it changes things:** Roster становится **resident** в браузере, не «task-mode page». Это меняет частоту использования с 1×/день на 5-10×/день — без увеличения cognitive load.

---

### 9. «Команда вчера» — auto-stand-up replacement (mortal-shot, не moonshot)

**Описание:** В team-view выше roster добавить блок **«Стенд-ап-черновик»** — авто-собранный markdown для копирования в Slack/TG `daily-stand-up` чат. Каждый member team автоматически имеет 2-3 буллета: «Вчера: [event-выжимка из timelineYesterday]», «Сегодня план: [WIP top-2 + commitments из 1:1 log]», «Блокеры: [топ блокер если есть, иначе —]». Тимлид редактирует, копирует. Для членов команды, у которых **0 событий** — generated «без активности» с гипотезой «возможно отпуск/больничный».
**Зачем чинить:** Closes daily job «standup собирается в Slack/TG как pile of текстов». Это 15-минутный ритуал для команды 10 человек × 200 рабочих дней = 30 человеко-часов в год. Auto-draft → 3 минуты обсуждения вместо 15.
**Как чинить:** Reuses `composePersonNarrative`. Аггрегирует по команде:
```js
function composeStandupDraft(model) {
  return model.participants.map(p => {
    const narrative = composePersonNarrative(p);
    return `*${p.label}*\n` +
      `_Вчера_: ${pickYesterdaySentence(narrative)}\n` +
      `_Сегодня_: ${pickTodaySentence(narrative)} (WIP: ${p.issuesNow.slice(0,2).map(i=>i.key).join(', ')})\n` +
      `_Блокеры_: ${pickBlockerSentence(narrative) || '—'}`;
  }).join('\n\n');
}
```
**Критичность:** medium (рутина team-уровня)
**Сложность:** low (reusing existing primitives)
**Ценность:** **high** — кардинально снижает time-to-value инструмента команды

**Sketch:** Под counters в team header — раскрывашка `Stand-up draft (12)`. Раскрыл — preview markdown с возможностью отредактировать перед копированием. Кнопка «Copy as Slack» / «Copy as TG». Pre-meeting — копируется, вставляется в чат за 5 секунд.
**Why it changes things:** Sсанер встраивается в **существующий ритуал команды**, а не предлагает новый. Это тот тип фичи который скейлится не от тимлида, а от **всей команды** (они начинают использовать draft как format-standard).

---

### 10. Sentiment-Aware Empty States — заменить generic-формулировки на адаптивные

**Описание:** Empty-state в narrative: «Возможно отпуск, больничный или вне рабочих часов» (`composePersonNarrative` line 989). Это нейтрально, но скучно. Killer-вариант — **смотреть на контекст календарного дня + history**: если пятница вечер → «Закончил рано — пятница, возможно дип-блок утром сделал»; если 5 дней подряд → «5-й день тишины — точно отпуск, проверь календарь»; если только сегодня но вчера активно → «Внезапная тишина — стоит спросить»; если он впервые в month сидит молча → «Похоже, переключился на проект вне нашего трекинга». Это **меняет тон** инструмента с robotic-info на **caring-observation**.
**Зачем чинить:** Closes UX-проблему «инструмент выглядит как watchdog». Empty-state — самое emotional-laden место (нет данных = инструмент додумывает).
**Как чинить:** Расширить `composePersonNarrative` empty-branch проверками:
```js
const dow = new Date().getDay(); // 5 = Fri
const consecutiveEmptyDays = countConsecutiveEmptyFromHistory(p, history);
if (consecutiveEmptyDays >= 5) {
  return {sentences: ['Тихо уже 5 дней подряд.'], hypothesis: 'Похоже на отпуск. Проверь календарь Outlook.'};
}
if (dow === 5 && now.getHours() >= 16) {
  return {sentences: ['Сегодня тихо с обеда.'], hypothesis: 'Пятница — возможно ранний deep-block сделал утром, посмотри события 8-12ч.'};
}
// …
```
**Критичность:** low (косметика)
**Сложность:** low (50-100 LOC)
**Ценность:** medium — tone-shift, important for adoption

**Sketch:** Открыл detail Ивана, в Narrative вместо «За 48ч активности нет. Возможно отпуск.» — «5-й рабочий день в тишине. Это не похоже на обычный паттерн — посмотри календарь / напиши в личку».
**Why it changes things:** Меняет **emotional register** инструмента — он перестаёт быть холодным dashboard'ом, становится «вторым мозгом тимлида». Этот shift не виден метриками, но виден в retention.

---

### 11. Roster Time Machine — «покажи мне неделю назад»

**Описание:** В detail panel и roster добавить **time-slider** (date picker, default = today) который проигрывает roster на момент N дней назад (из history snapshots). Тимлид может перемотать «как мы выглядели в среду» — увидеть, что Аня уже была в watch, я просто не открывал. Это **forensic mode** для разбора post-incident («как мы это пропустили»).
**Зачем чинить:** Closes job «retrospective с цифрами». Сейчас в ретро мы говорим «казалось, всё было ок» — потому что нет легкого способа посмотреть прошлое.
**Как чинить:** Уже есть `teamScanner2History.js`. Нужно UI:
```js
function renderTimeSlider() {
  return `<input type="range" min="0" max="${history.length-1}" value="${history.length-1}"
                 class="ts2-time-slider" data-time-rewind>`;
}
// onChange → restore snapshot → re-render roster with frozen data
```
Snapshot data уже сериализуется. Single-team view рендерит данные of that day.
**Критичность:** medium
**Сложность:** medium (history-based snapshot replay)
**Ценность:** **high** — для ретро и для понимания trends

**Sketch:** В header roster слева — slider с тиками за last 14 days. Перемещаешь — roster плавно перестраивается на тот день (приглушённый цвет — индикатор «это прошлое»). Click на person → detail с panel на тот момент. Кнопка «Сравнить с сегодня» — split view.
**Why it changes things:** Roster обретает **четвёртое измерение** — время. Это меняет use case с «прямо сейчас» на «как мы развиваемся». Тимлиды смогут увидеть рисунок: «команда деградирует во вторую неделю спринта — что мы делаем не так».

---

### 12. Quick-Action Sidebar — «pull this into action» от строки

**Описание:** Сейчас каждое interaction с строкой → click → открыть panel → искать кнопки. Высокочастотные операции должны быть в row (right-click context menu или hover-quick-actions). Список (от частоты): «Запланировать 1:1», «Создать handoff», «Подсветить блокеры в Jira», «Скопировать TG-сводку», «Назначить на новую задачу», «Снять с задач (overload-relief)». Сейчас 1 из 6 есть в panel (TG copy), остальные требуют переключения tab. Row-level quick actions = **5х faster workflow**.
**Зачем чинить:** Closes job «scan → act без drill-down». Тимлид утром перебирает 12 строк за 30 секунд; click → panel → button = 5 секунд × 12 = минута; quick-action menu = 5 секунд на всё.
**Как чинить:** Right-click handler на `.ts2-row`:
```js
row.addEventListener('contextmenu', e => {
  e.preventDefault();
  showQuickMenu(e.clientX, e.clientY, [
    {label: 'Запланировать 1:1', action: () => createCalendarDraft(p)},
    {label: 'Подготовить handoff', action: () => openHandoffDialog(p)},
    {label: 'Скопировать TG-сводку', action: () => copyTgSummary(p)},
    {label: 'Открыть в Jira (assigned issues)', action: () => openJira(p)},
  ]);
});
```
Aria: announce «context menu доступно» на focus.
**Критичность:** medium (productivity-feature)
**Сложность:** low-medium (~150 LOC + UX-thought на меню)
**Ценность:** **high** — converts row from passive to interactive

**Sketch:** Right-click на Аниной строке → popup-menu 200×220px с 6 пунктами + иконки. Esc — закрыть. Запоминает «последний использованный action» — pinning top.
**Why it changes things:** Roster становится **command surface**, не view. Это conversion из «инструмент про команду» в «инструмент управления командой».

---

### 13. Risk Replays — «что было полчаса до того как ушло в стоп»

**Описание:** Когда тимлид открывает detail panel человека в **stop**, верх panel'и дополняется блоком **«Что случилось»** — последняя цепочка событий **перед** stop'ом + triggers. Например: «Транзишн → 'Code Review' 26ч назад → 2 PR-comment'а на свой PR → 8ч молчания → assignee-change на стороннюю задачу → 14ч молчания → попал в stop». Это **storyline of decline**. Помогает на 1:1 не спрашивать «что случилось», а **показывать**.
**Зачем чинить:** Closes job «найти первопричину stuck». Сегодня тимлид видит блокеры в Jira, но не видит «как мы туда пришли». События есть в timeline72h — нужно отфильтровать и нарисовать.
**Как чинить:** Pure-function:
```js
function buildStoryOfDecline(p, classifyChain) {
  // classifyChain — массив [{day, group}] из history (per-person)
  const driftDay = findDriftPoint(classifyChain); // когда стал stop
  const eventsAround = p.timeline72h.filter(e =>
    Date.parse(e.at) >= driftDay - 12*HOUR && Date.parse(e.at) <= driftDay + 24*HOUR);
  return summarizeStory(eventsAround); // sequence with severity
}
```
В panel — collapsible «История падения в стоп» с 4-7 строками, последняя — «затем тишина».
**Критичность:** medium
**Сложность:** medium-high (нужны history snapshots с per-person group; classifyChain нужно постоянно сохранять)
**Ценность:** medium-high — диагностический superpower

**Sketch:** В panel верх (под counters) — раскрытый блок:
```
История падения в стоп
↦ 24.05 14:00 → начал PROJ-456
↦ 25.05 11:00 → попросил review
↦ 25.05 18:00 → получил 3 коммента (request changes)
↦ 26.05 09:00 → попытка вернуться, 2 коммита
↦ 26.05 13:00 → переключился на PROJ-501 (внешняя задача)
↦ затем тишина 17ч (Stop)
```
**Why it changes things:** Roster даёт **причинно-следственное объяснение** — самый дорогой insight в HR/management. Тимлид перестаёт спрашивать «что у тебя» и переходит к «давай разберём почему ты застрял на review-step».

---

### 14. Voice Note Stitch — приватные заметки тимлида прямо на сотруднике

**Описание:** В detail panel — расширение «Мои заметки»: rich-textarea для приватных заметок (только локально, не отправляются в LLM/server). Заметки timestamped и **связаны с автоматическими событиями**: «25.05: договорились дать неделю на PROJ-X. Реалити-чек 02.06 — закрыл? [autocheck шоу: статус «Done» 30.05 ✓]». Тимлид прячет под локальный пароль (если PIN установлен).
**Зачем чинить:** Closes job «личный journal на каждого». Сегодня тимлид ведёт это в Notion → раскорреляция с реальными данными. Локальные заметки на person = единый контекст.
**Как чинить:** localStorage `q2_scanner_notes_${personKey}` → encrypted JSON (Web Crypto API, PIN-based). UI: <details> внизу panel с textarea + timeline-render предыдущих заметок.
**Критичность:** low-medium (personal organization)
**Сложность:** medium (encryption + UI)
**Ценность:** medium-high — sticky-loop

**Sketch:** Внизу panel — секция `Мои заметки (приватно)` с textarea и предыдущими записями. У записи рядом — auto-check «договорились о PR-rebalance → за 2 недели prReviews 12→7 ✓». PIN-protected (один PIN на всю tool, в Settings → Privacy).
**Why it changes things:** Roster становится **глубоко личным** — это не shared tool с N тимлидами с одинаковым view, а **мой** инструмент с моей памятью.

---

### 15. Smart-Compare — bisect against another team or against your past self

**Описание:** В top-bar roster добавить переключатель **«Сравнить с»**: (а) другой командой (среднее по N командам той же зоны), (б) моей командой 30 дней назад. Каждый counter, badge получает delta — например, WIP medianоn сегодня 2.4, по 12-team-avg 1.9 — chip «×1.26 от платформы». Идея: тимлид впервые видит **как мы выглядим относительно**.
**Зачем чинить:** Closes job «как мы относительно других / относительно себя». Сегодня данные insular. С compare-toggle команда видит «у нас 4.2 dwell-hours в среднем, по платформе 2.8 — мы медленнее всех».
**Как чинить:** Aggregate metrics уже считаются (`scannerV2.codeReviewVelocity`, `prThroughput`). Нужен новый dataset — `platformBenchmarks` (по N teams), либо `historicalSelf` (own 30d ago). Toggle меняет рендер counters.
**Критичность:** medium (positioning + benchmarking)
**Сложность:** high (нужна cross-team aggregation; политически чувствительно — «вы хуже team X»)
**Ценность:** medium — power-feature, но не daily

**Sketch:** В top-bar чекбокс `Compare to: [my team 30d ago | platform avg]`. Под roster — appears in row: counter с дельтой `WIP 2 (▼1 vs 30d)`, header — `Team relative health: middle of pack, 8 of 12`.
**Why it changes things:** Roster становится **benchmarking surface** — единственный legit способ для тимлида сказать «я веду команду выше среднего» или «нам нужны ресурсы». В банке это политический инструмент.

---

## Если бы мне дали 2 недели на это — что бы я сделал в первую очередь

Топ-3 в порядке роста сложности / уверенности:

1. **#1 1:1 Memory Lane** + **#9 Stand-up draft** — это **самые дешёвые с high reach**. Используют existing primitives (`composePersonNarrative`, `composeTgSummary`), persistence — localStorage. ~3-4 дня. Эффект — sticky-loop появляется сразу, тимлиды начинают открывать инструмент ежедневно не для «pожарного контроля», а для **подготовки разговоров**.

2. **#4 Workload Balance Forecast (headroom-bar)** + **#12 Quick-Action Sidebar (right-click menu)** — это **conversion из view в command surface**. Технически просто (UI + 2-3 pure functions), эффект на perceived utility огромен. ~5-6 дней. После этого инструмент перестаёт быть «отчётом» и становится **рабочей плоскостью**.

3. **#3 Conflict Radar (collision detection)** — это **wow-feature** для демо. Тимлиды на демонстрации видят `⇄ Иван 3 файла` и спрашивают «как вы это узнаете?!» Это поднимает воспринимаемую глубину инструмента (он видит код, не только Jira). Зависит от наличия `bbItems[].files` — нужна проверка. ~3-4 дня если данные есть.

Остаток времени — на **#2 Async-handoff draft** как «приятный сюрприз перед отпускным сезоном» (июнь-август в Сбере как раз бьёт).

**Что бы я НЕ начал в 2-недельном спринте:**
- **#7 Retention Radar**, **#11 Time Machine** — нужно robust history (60d+), сейчас history shape не подходит для per-person time-series. Это foundation-проект на 4-6 недель.
- **#15 Smart-Compare** — нужна cross-team aggregation infra, политически чувствительно.
- **#8 Ambient Mode** — service worker + browser permissions, отдельный flow. Заслуживает spin-off.

## Альтернативный sketch — «инвертированный» roster

Mini-moonshot, который не попал в нумерованные находки: **roster как chat-feed**. Сегодня roster — это таблица. Альтернативный mental model — **timeline команды по времени дня**: 09:30 → Аня commit, 10:15 → Иван PR review, 10:45 → Маша open задача, и т.д. Тимлид утром листает «вчерашний день команды» как Twitter-feed. Каждое событие — клик на face → drill-down. Это другой инструмент, но возможно ТОТ ЖЕ продукт под капотом. Worth exploring как separate view-mode (toggle `Roster | Timeline` в header) — но это 8-week effort, не 2-week, и нужно тестирование на 3-5 тимлидах прежде.
