# Event Bus — `app/eventBus.js`

> AUDIT_HOLISTIC P3 + Идея 1 — единый pub/sub-канал вместо разрозненных
> `window.*` глобалов и неявных cross-module callback'ов.

## Зачем

До P3:
- 50+ `window.*` глобалов (`window.NotifyCenter`, `window.AIPipeline`, ...).
- Каждый модуль сам решал, как уведомлять «другие» — `state.subscribe`,
  `Reactive.subscribe`, ad-hoc callback list внутри NotifyCenter.
- Тесты в изоляции невозможны — модули цепляли DOM / другие синглтоны.

После P3:
- Один singleton `EventBus` (`window.EventBus`).
- Стандартизированные имена событий (`domain.action[.qualifier]` — P7
  telemetry-convention).
- Любой модуль может подписаться без знаний об источнике.

## API

```js
import { EventBus } from './app/eventBus.js';

// Подписка — возвращает unsubscribe
const off = EventBus.on('state-changed', () => { /* ... */ });
// ... позже
off();

// Один раз — авто-отписка после первого срабатывания
EventBus.once('state-saved', () => { /* ... */ });

// Эмит
EventBus.emit('user-changed', { email: 'a@b' });

// Явная отписка
EventBus.off('state-changed', handler);

// Чистка (для тестов)
EventBus.clear();          // все события
EventBus.clear('flags-changed'); // только это
```

### Контракты

- `on(event, handler)` → возвращает `() => void` — unsubscribe.
- `once(event, handler)` — авто-отписка после первого emit (даже если handler бросил).
- `emit(event, payload?)` — синхронный. Throw в одном handler НЕ ломает остальных.
- Imя event'а — non-empty string. Handler — function.
- Один и тот же handler регистрируется один раз (Set semantics).

## Стандартные события

| Имя | Payload | Источник | Назначение |
|---|---|---|---|
| `state-changed` | `undefined` | `reactiveStore.js` flush | Любая реактивная мутация. Без path/value. |
| `state-saved` | `{ key }` | `Storage.save` | После записи в localStorage. |
| `state-restored` | `{ source }` | `Storage.restore` / `loadSettings` | После hydrate из snapshot'а. |
| `user-changed` | `{ email, name }` | sign-in flow | `state.meta.user.*` изменился. |
| `permissions-changed` | `{ action, value }` | admin / server-fetch | `state.meta.permissions.*` изменился. |
| `flags-changed` | `{ name, value }` | `Flags.set()` / `/api/flags` | `state.meta.featureFlags.*`. |
| `permission-denied` | `{ action }` | `Permissions.guard` | Юзер попытался выполнить запрещённое действие. |
| `section-entered` | `{ section }` | `Nav.go()` | Новый активный раздел. |
| `section-left` | `{ section }` | `Nav.go()` | Покинутый раздел. |
| `focus-changed` | `{ focus }` | view-action | `state.meta.focus` (узкий контекст «Утра тимлида»). |
| `ai-update-completed` | `{ source, blockId }` | `AIPipeline` | Конец обновления AI-блока. |
| `notification-added` | `Notification` | `NotifyCenter.add` | Новая запись в Notification Center. |

## Примеры

### Подписка на любые мутации state

```js
EventBus.on('state-changed', () => {
  console.log('state mutated');
});
```

### Реакция на смену пользователя

```js
EventBus.on('user-changed', ({ email }) => {
  Topbar.updateAvatar(email);
});
```

### Использование вместе с feature-flags

```js
import { Flags } from './app/featureFlags.js';

// Прямо через Flags API:
const off = Flags.subscribe('ai', enabled => {
  AISection.setVisible(enabled);
});

// Или через шину (если нужны ВСЕ изменения флагов):
EventBus.on('flags-changed', ({ name, value }) => {
  if (name === 'ai') AISection.setVisible(value);
});
```

### Permissions.guard

```js
import { Permissions } from './app/permissions.js';

button.addEventListener('click', () => {
  Permissions.guard('canBulkEdit', () => {
    BulkPlatform.apply({ kind: 'mark-done', targets: selected });
  });
});

// Или ручной check для disable-state:
button.disabled = !Permissions.can('canBulkEdit');
```

## Что НЕ делает шина

- Никаких приоритетов / порядка / async-ожидания. Хочешь queue — строй на фронте.
- Никакой типизации payload'ов в runtime — контракт описан здесь, а не в коде.
- Никакого «replay» / «late-subscribe-получает-последнее» — handler видит только то, что эмитнули после `on()`.

## Bridges

- `reactiveStore.js` flush → `state-changed`. Lazy: если bus ещё не загружен (Node-tests без импорта app/eventBus.js) — пропуск.
- `app.js` boot → подписывается на `NotifyCenter.subscribe` и эмитит `notification-added` на reason='add'.
- `Flags.set()` → `flags-changed` (внутри `app/featureFlags.js`).
- `Permissions.guard` рефуз → `permission-denied`.
