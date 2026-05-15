# Scanner 2.0 — Classifier (canonical)

> Файл: `integrations/teamScanner2Classifier.js`
> Контекст: V20 S8 #15 — single source of truth для 4-group classification
> участников Сканнера команды.

## Что это

Pure-модуль без зависимостей на renderer / state / DOM. Принимает participant
(duck-typed) и возвращает одну из 4 групп: `stop` / `watch` / `moving` / `idle`.

Public API:

```js
import {
  classifyPerson,    // (p) → 'stop' | 'watch' | 'moving' | 'idle'
  stuckListOf,       // (p) → Array (blockers OR stale fallback)
  statusOfPerson,    // (p) → 'blocker' | 'today' | 'idle' (для UI ▌-индикатора)
  bumpClassifyEpoch, // () — invalidate WeakMap cache
} from '../integrations/teamScanner2Classifier.js';
```

`classifyPerson` — pure-функция (см. `teamScanner2Classifier.js:98`), правила
описаны в JSDoc к `_classifyPersonImpl` (`teamScanner2Classifier.js:66`).

## Кэширование

Под капотом — `WeakMap<participant, { epoch, value }>` + monotonic epoch
(см. `teamScanner2Classifier.js:59-64`). Логика:

- Cache hit, если participant-объект тот же и epoch совпадает.
- При `refresh()` orchestrator вызывает `bumpClassifyEpoch()` чтобы
  инвалидировать кэш — partial-update модели может сохранять ссылки на старые
  participant-объекты, но семантика classification могла измениться.

Зачем: `classifyPerson` вызывается ~3× на одного participant за рендер
(`renderPersonRows` + `renderTeamGlance` + insights). Без кэша — пере-вычисление
всех сигналов (timeline / blockers / badges / cfItems / bbItems / zephyr).

## Когда переиспользовать

- Любой новый view, которому нужна та же group-classification participant'ов
  (например, future widget'ы в metricsDeep или AI-Анализе).
- НЕ дублировать inline в renderer — `teamScanner2History.js` раньше имел
  свою копию, и при добавлении нового сигнала history отставал, а snapshot
  day N classified как `idle`, day N+1 как `moving` без изменения данных
  (только из-за рассинхронизации).

## Простой пример

```js
import { classifyPerson, bumpClassifyEpoch } from
  './integrations/teamScanner2Classifier.js';

// Где-то после refresh() модели:
bumpClassifyEpoch();

const groups = { stop: [], watch: [], moving: [], idle: [] };
for (const p of model.participants) {
  groups[classifyPerson(p)].push(p);
}

// Использовать в widget'е:
console.log(`Stuck: ${groups.stop.length}, Active: ${groups.moving.length}`);
```

## Контракт participant

Используются поля (всё опционально, classifier defensive к null/undefined):

- `timelineToday`, `timelineYesterday` — массивы Jira-транзишенов
- `issuesNow`, `blockers`, `stale` — массивы issue-keys
- `badges` — `{ pr48h, commits48h, reviews, approves }` счётчики
- `cfItems`, `bbItems` — Confluence / Bitbucket активность
- `zephyrTestsCreatedRecent`, `zephyrTestsExecutedRecent` — Zephyr-тесты

Любой новый сигнал — менять в `_classifyPersonImpl`, не в callers.
