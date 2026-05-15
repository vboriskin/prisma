# П6 — Сканнер команд 2.0: демо-режим (отчёт-план)

> Дата: 2026-05-04. Только отчёт — реализация не вносилась. Файл задаёт roadmap для последующего PR.

**Эксперты-роли:**
- **Senior frontend engineer** — где встраивать toggle, как изолировать demo от реального fetch.
- **QA lead** — что должны проверять тесты в demo-режиме.
- **Product / UX writer** — копия и положение CTA.
- **Security reviewer** — гарантия что demo не уходит на сервер и не пишет в shared state.

## TL;DR

Сканнер команд 2.0 (`integrations/teamScanner2.js`, 2161 LOC) сейчас имеет ровно **один** источник данных — `fetchPulseData()` (`integrations/portfolioPulseApi.js:23`), который ходит в Delta Jira / Bitbucket / Confluence через `/api/integrations/portfolio-pulse/start`. Без токенов, ключей проектов и сети — пользователь видит `renderEmpty('no-config')`. Демо-режим = третий путь: **«загрузить локальный fixture-набор и пройти полный pipeline analysePulse → enrichForScanner2 → renderFull»**, ничего не отправляя на сервер.

## 1. Цели demo-режима

| # | Цель | Метрика «успеха» |
|---|---|---|
| 1 | Новый пользователь без токенов видит, как выглядит сканнер | Переход в раздел «Сканнер команд 2.0» в первый день показывает demo сразу или по нажатию кнопки |
| 2 | Презентации / скриншоты / sales — без подключения к корп. инфраструктуре | Можно открыть локально (`file://` или `localhost`) и сделать скрин любой панели сканнера |
| 3 | Регрессии UI ловятся без сети | E2E-тест может пройти `render → expand → diagnostic → export` без `fetch` mock'ов |
| 4 | Onboarding-tour и документация ссылаются на стабильный набор данных | Шаги тура могут указывать «нажмите на Иванова И.И. → раскроется панель» — фикстура гарантирует этого Иванова |

## 2. Текущая архитектура (что трогать нельзя)

```
TeamScanner2.render(container)
  └─ _readConfig() → { projectKeys, staleDays }
  └─ if (!projectKeys.length) → renderEmpty('no-config')
  └─ if (this._model)        → _renderFull()
  └─ if (pendingShareKey)    → _fetchAndRender()
  └─ else                    → _paintEmptyHero()    (renderEmpty('no-data') — CTA «Загрузить данные»)

_fetchAndRender():
  raw   = await fetchPulseData({ projectKeys, signal, timeoutMs, employees, onJobId })
  pulse = analysePulse({ rows: raw.issues, employees, ... })
  model = enrichForScanner2(pulse, raw, ...)
  this._model = model
  this._renderFull()
```

Контракт `model`:
- `model.participants[]` — список людей с полями `key`, `name`, `email`, `timelineToday[]`, `timelineYesterday[]`, `issuesNow[]`, `blockers[]`, `stale[]`, `badges{reviews,approves,pr48h,commits48h}`, `cfItems[]`, `bbItems[]`, `zephyrTestsCreatedRecent[]`, `zephyrTestsExecutedRecent[]`.
- `model.scannerV2.risks` — `totalOrphans`, `totalOutOfSprint`, `outOfSprintRatio`.
- `model.scannerV2.sprintGoal` — `aggregateProgress`, `aggregatePace`, `sprints[]`.
- `model.fetchedAt`, `model.jiraBaseUrl`, `model.projectKeys[]`.
- `model.scannerV2.teams[]` — для multi-team aggregate.

## 3. Архитектура demo (предложение)

### 3.1. Модуль `integrations/teamScanner2DemoFixture.js` (новый)

Plain-JS module экспортирует:

```js
export const SCANNER2_DEMO_FIXTURE = Object.freeze({
  meta: {
    fetchedAt: '2026-05-04T09:00:00+03:00',
    jiraBaseUrl: 'https://jira.example.local',
    projectKeys: ['DEMO', 'CORE'],
    isDemo: true,                    // ←  ключевой маркер
  },
  participants: [
    { key: 'ivanov.ii', name: 'Иванов Иван', email: 'ivanov@example.local',
      timelineToday: [{key:'DEMO-101', summary:'PR review', when:'09:42'}, …],
      timelineYesterday: [...],
      issuesNow: [...], blockers:[...], stale:[...],
      badges: { reviews:3, approves:1, pr48h:2, commits48h:5 },
      cfItems: [...], bbItems: [...],
      zephyrTestsCreatedRecent: [], zephyrTestsExecutedRecent: [],
      // identity для resolveIdentitiesByEmail():
      jiraAccountId: 'demo-ivanov', bitbucketLogin: 'ivanov.ii', confluenceAccountId: 'demo-cf-ivanov',
    },
    // ещё 6-9 человек, минимум по одному «idle / moving / watch / stop» классу:
  ],
  scannerV2: {
    risks: { totalOrphans: 4, totalOutOfSprint: 8, outOfSprintRatio: 0.16 },
    sprintGoal: {
      aggregateProgress: 0.42, aggregatePace: 'on-track',
      sprints: [
        { pk:'DEMO', name:'Sprint 24', startDate:'2026-04-22', endDate:'2026-05-06',
          progress: 0.42, pace:'on-track', plannedHours: 320, doneHours: 134 },
      ],
    },
    teams: [
      { name:'Платформа', members:['ivanov.ii','petrov.pp', …], paceClass:'on-track' },
      { name:'Аналитика', members:['sidorova.ss','gorin.gg', …],  paceClass:'drift' },
    ],
  },
});
```

Размер фикстуры: **~10 человек × 8-12 связанных issues = ~150 KB JSON**. Должен жить в JS (а не в отдельном `.json`), чтобы:
1. не ходить за ним по сети (`fetch /demo.json` — лишний request);
2. tree-shake не вырезал (нет бандлера, но импорт делает зависимость явной);
3. его можно `Object.freeze` для защиты от accidental write.

### 3.2. Включение demo-режима

Три способа активации (все три должны сосуществовать):

| Триггер | Источник | UX |
|---|---|---|
| Кнопка «Посмотреть демо» в empty-hero | `renderEmpty('no-config')` + `renderEmpty('no-data')` | Под основным CTA — secondary `«👁 Посмотреть демо»` (без эмодзи в финале — см. П5) |
| URL-hash `#scanner2/demo` | `_consumeShareLink` расширить | Открывает раздел сразу в demo |
| Глобальный флаг `state.scanner2DemoMode = true` | Settings → Debug → toggle | Пилот-функция, скрыта под Debug-tab |

### 3.3. Изменения в коде (для будущего PR)

**Файл `integrations/teamScanner2.js`:**

```js
// near imports:
import { SCANNER2_DEMO_FIXTURE } from './teamScanner2DemoFixture.js';

// — в TeamScanner2 объекте:
_demoMode: false,

async loadDemo() {
  this._demoMode = true;
  this._cancelled = false;
  this._errorMsg = '';
  // skip fetchPulseData entirely
  const raw = SCANNER2_DEMO_FIXTURE;
  // analysePulse и enrichForScanner2 ожидают тот же формат —
  // фикстура должна уже быть в shape `model`. Если фикстура — это raw,
  // то прогоняем через те же analysePulse + enrichForScanner2.
  const pulse = analysePulse({ rows: raw.issues || [], employees: state.employees || [] });
  const model = enrichForScanner2(pulse, raw, { isDemo: true });
  // важно: _jobId оставляем '' — это блокирует fetchDetail (как сейчас).
  this._model = model;
  this._renderFull();
  telemetryEmit('scanner2.demo_load', { participants: raw.participants.length });
},

// в render(): добавить ветку для demo
async render(container) {
  this._container = container;
  if (this._demoMode || /* флаг из state */ state.scanner2DemoMode) {
    this.loadDemo();
    return;
  }
  // … существующее поведение
},
```

**Файл `integrations/teamScanner2Renderer.js` — `renderEmpty()`:**

Добавить вторую кнопку в empty-state режимах `'no-config'` и `'no-data'`:

```html
<div class="ts2-empty-secondary">
  <button class="ts2-btn ts2-btn-ghost" id="ts2-load-demo" type="button">
    Посмотреть демо
  </button>
  <button class="ts2-btn ts2-btn-ghost" id="ts2-empty-how-btn" …>Как считается</button>
  <button class="ts2-btn ts2-btn-ghost" id="ts2-empty-diag-btn" …>Диагностика</button>
</div>
```

В `_paintEmptyHero()`:

```js
this._container.querySelector('#ts2-load-demo')?.addEventListener('click', () => {
  telemetryEmit('scanner2.demo_load_click', { from: 'empty' });
  this.loadDemo();
});
```

**Файл `app/appSettings.js` — Debug-tab:**

```js
{ id:'app-settings-scanner2-demo', label:'Сканнер: демо-режим',
  description:'Использовать локальные демо-данные вместо запроса в Jira/BB/CF', persistKey:'scanner2DemoMode' }
```

При сохранении настроек — выставить `state.scanner2DemoMode = !!checked` через `Reactive.silent`.

### 3.4. Demo-banner

Когда `model.meta.isDemo === true`, в шапке сканнера (`renderTopBar` `integrations/teamScanner2Renderer.js:250`) показать ленту:

```
┌──────────────────────────────────────────────────────────────────────┐
│ 👁 Демо-режим — данные синтетические, в Jira ничего не отправляется │
│   [Выйти из демо]                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

Класс `.ts2-demo-banner` — `--prizma-bg-tertiary` + `--prizma-information` 3px stripe-left + caps-сабтекст. Без эмодзи в финальной версии (П5 заменит «👁» на SVG).

«Выйти из демо» снимает `_demoMode` и возвращает empty-hero.

### 3.5. Запреты в demo-режиме

| Действие | Поведение |
|---|---|
| `fetchDetail(employeeKey)` | throw `'Demo: drill-down недоступен'` (на UI — disabled-state на кнопке + tooltip) |
| `_performExport()` (CSV / JSON) | разрешить, в файле — `{ "demo": true, ... }` префикс |
| `runConnectionProbe()` | сделать static-pass, возвращать «Демо-режим: подключение не проверяется» |
| `simulateThresholds()` | работает на фикстуре (не сети) — OK |
| `saveDailySnapshot()` | НЕ сохранять (фикстура одна и та же → засорит history); вместо этого `localStorage.setItem('q2_scanner2_history:DEMO', singleEntry)` |
| `_saveSnapshot` | НЕ сохранять (см. выше) |
| Telemetry | сохранить, добавить `demo: true` в каждом событии — отделимо в analytics |

### 3.6. Какие fixtures нужны

| Фикстура | Минимум полей | Зачем |
|---|---|---|
| 10 участников | 4 классов поведения (idle/moving/watch/stop), 2-3 с blockers, 1 без активности 7+ дней | покрывает классификатор `_classifyPerson` |
| 2 команды | разные `paceClass` (`on-track`/`drift`) | multi-team aggregate view (V20 S10.5) |
| 1 sprint goal | `progress: 0.42`, `pace: 'on-track'` | sprint-gauge рендер |
| 8 timelineToday + 6 yesterday | разные `kind` (issue / pr / commit / review / cf / bb / zephyr) | `renderTimelineDelta` |
| 4 stale issues | возраст 3 / 7 / 14 / 30+ дней | risk-pills |
| 2 «out of sprint» | для `outOfSprintRatio` | risks-block |
| Identity | `jiraAccountId`, `bitbucketLogin`, `confluenceAccountId` | `resolveIdentitiesByEmail` отрабатывает |

### 3.7. Поведение сначала-открыл (без settings)

Сейчас `if (!projectKeys.length) renderEmpty('no-config')` — пользователь видит «Нужны проектные ключи». В demo-режим:

```js
if (!projectKeys.length && !this._demoMode) {
  // Показываем НЕ только «нужны проектные ключи», а добавляем CTA «Посмотреть демо»
  container.innerHTML = renderEmpty('no-config-with-demo');
  return;
}
```

`renderEmpty('no-config-with-demo')` — новый режим `renderEmpty()` (третий) с обоими CTA: открыть настройки **и** посмотреть демо.

## 4. Acceptance criteria

| # | Сценарий | Ожидаемый результат |
|---|---|---|
| 1 | Свежий браузер, нет токенов, открыть «Сканнер команд 2.0» | Видна empty-hero с CTA «Открыть настройки» **и** «Посмотреть демо» |
| 2 | Нажать «Посмотреть демо» | За <300ms отрисовывается полный сканнер с 10 людьми и 2 командами; `fetch` НЕ вызывался (проверка через DevTools network → 0 запросов на `/api/integrations/portfolio-pulse/*`) |
| 3 | Кликнуть на участника | Раскрывается panel с timelineToday/Yesterday, issuesNow, blockers — все из фикстуры |
| 4 | Нажать «как считается» | Modal открывается с теми же текстами что в боевом режиме |
| 5 | Нажать «диагностика» | `gatherDiagnosticState` срабатывает на demo-model; показывает `isDemo: true` в шапке |
| 6 | Нажать «обновить» (refresh) | Demo перезагружает фикстуру (почти мгновенно), banner остаётся |
| 7 | Нажать «выйти из демо» | Возврат в empty-hero; `_demoMode = false`; URL hash очищен |
| 8 | URL `?demo=1` или `#scanner2/demo` | Demo поднимается автоматически на mount |
| 9 | Settings → Debug → toggle демо | После save — следующий заход в раздел сразу в demo |
| 10 | Export JSON в demo | Файл скачивается с префиксом `demo: true`, не содержит токенов / fingerprint реальной сети |

## 5. Тесты

Новый файл `tests/unit/teamScanner2.demo.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCANNER2_DEMO_FIXTURE } from '../../integrations/teamScanner2DemoFixture.js';

test('demo fixture: shape contract', () => {
  const f = SCANNER2_DEMO_FIXTURE;
  assert.equal(f.meta.isDemo, true);
  assert.ok(f.participants.length >= 8);
  for (const p of f.participants) {
    assert.ok(p.key && p.name && p.email);
    assert.ok(Array.isArray(p.timelineToday));
    assert.ok(p.badges);
    assert.ok(p.jiraAccountId);
  }
  assert.ok(f.scannerV2.risks);
  assert.ok(f.scannerV2.sprintGoal.sprints.length >= 1);
});

test('demo fixture: classifier coverage', () => {
  // как минимум 1 idle, 1 moving, 1 watch, 1 stop
  // (классы вычисляются по timeline + blockers + wip — см. _extractSnapshot)
});
```

Contract-test: `tests/contract/scanner2-demo.contract.test.js` — гарантия что fixture совместима с `analysePulse` + `enrichForScanner2`.

## 6. Риски и митигации

| Риск | Митигация |
|---|---|
| Фикстура устаревает после изменений в shape `model` | Contract-test (см. выше) валидирует shape; CI ловит |
| Пользователи путают demo с реальными данными | Banner всегда виден; export файл префиксован; telemetry разделена |
| Demo делает live-fetch (баг) | `fetchPulseData` не вызывается при `_demoMode === true` — easy unit-test |
| Demo-fixture попадает в production-bundle | Vanilla-JS, нет бандлера → файл всегда грузится. Но он должен **только импортироваться при активации demo**. Решение: `await import('./teamScanner2DemoFixture.js')` в `loadDemo()` (lazy import) |
| State `scanner2DemoMode` пишется в localStorage и забывается | После toggle через Debug — toast «Демо-режим включён, перезайдите в раздел». Banner тоже постоянно напоминает |
| `historyLog`/`actionLog` засоряются demo-действиями | в `loadDemo()` — `HistoryLog.settings('scanner2_demo', 'Demo-режим')` 1 раз; внутренние действия в demo НЕ логировать |

## 7. Объём работы (оценка)

| Этап | Срок |
|---|---|
| Фикстура (10 участников + sprint + risks) | 0.5 дня (в JS вручную или через скрипт сгенерировать из реальных данных + анонимизировать) |
| `loadDemo()` + integration в `render()` + `loadDemo` toggle | 0.5 дня |
| Banner `.ts2-demo-banner` + CSS | 0.25 дня |
| Запреты на drill-down/save/probe в demo + UX-tooltip | 0.5 дня |
| Settings Debug-toggle + URL hash | 0.25 дня |
| Тесты (unit + contract) | 0.5 дня |
| Документация: `docs/scanner-demo.md` + ссылка из tour onboarding | 0.25 дня |
| Code review + полировка | 0.25 дня |
| **Итого** | **~3 человеко-дня** |

## 8. Не входит в demo (намеренно)

- Симуляция «времени идёт» (fixture статичен — это снимок, не симулятор).
- Возможность редактировать demo-данные через UI (read-only — иначе сложность экспоненциальная).
- Multi-language i18n demo-копии (только ru, в проекте только ru).
- Live-обновление через WebSocket (нет потока).

## 9. Расширения (P2-P3, не сейчас)

- «Demo + ваши настройки» — взять структуру демо, но naming команд из настроек пользователя.
- «Сценарии» — несколько фикстур (`stable / risky / pre-deadline`) переключаемых из меню.
- «Generate demo from snapshot» — экспорт текущей реальной модели в фикстуру (пред-анонимизация).

---

**Резюме:** demo-режим = lazy-loaded `SCANNER2_DEMO_FIXTURE` + flag `_demoMode` + 3 точки активации (CTA / URL / Debug-toggle) + banner + запреты на live-actions. Изменения изолированы, риск регрессии низкий, ~3 дня работы. Для текущего этапа — **только этот отчёт-план**, реализация не вносится.
