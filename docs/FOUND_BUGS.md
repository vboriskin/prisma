# Найденные баги

Список багов и неконсистентностей, обнаруженных в процессе написания тестов.
**НЕ ИСПРАВЛЯЮ САМ** — фиксирую для разбора.

---

## 1. `formatHrs(0)` возвращает `'0h'` (латинская h), а ненулевые значения возвращают `'ч'` (кириллица)

**Файл**: `integrations/portfolioPulseUtils.js:135-140`

```js
export function formatHrs(sec) {
  if (!sec) return '0h';                                    // ← латинская "h"
  const h = sec / 3600;
  if (h < 1) return Math.round(sec / 60) + 'м';
  return Math.round(h * 10) / 10 + 'ч';                     // ← кириллическая "ч"
}
```

**Проявление**: в UI рядом с `5.5ч` могут появиться `0h`, что выглядит как глюк локализации.

**Воспроизведение**:
```js
formatHrs(0)    // → '0h'   ← ОЖИДАЛОСЬ '0ч'
formatHrs(3600) // → '1ч'
```

**Severity**: косметика, но видна пользователю.

---

## 2. Один и тот же человек в `assignee` и `changelog.author` может попасть в `participants` **дважды**

**Файл**: `integrations/portfolioPulseModel.js`, функция `ensureUser` + `userKey`

**Корень**: `userKey(u)` берёт первое непустое из `accountId / key / name / emailAddress / displayName`. Если в одном месте Jira даёт `{displayName, emailAddress}`, а в другом `{displayName}` (без email) — `userKey` вернёт разные значения, и создадутся два participant'а с одинаковым именем.

**Воспроизведение**:
```js
analysePulse({
  reports: [{
    projectKey: 'PAY',
    issues: [{
      key: 'PAY-1',
      fields: {
        status:    { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        assignee:  { displayName: 'Иван Иванов', emailAddress: 'ivan@x' },
      },
      changelog: { histories: [{
        created: '2026-04-28T03:00:00Z',
        author:  { displayName: 'Иван Иванов' },           // ← без email
        items:   [{ field: 'status', toString: 'Done' }],
      }]},
    }],
    sprintKeys: [], inProgressKeys: ['PAY-1'], backlogKeys: [],
  }],
});
// → model.participants.length === 2 (Иван с email и Иван без email)
```

**Severity**: средняя — дубли в карточках сотрудников, неверные счётчики, бьёт сводку.

**Возможная починка**: после сборки `userMap` пройтись и слить ключи с одинаковым `displayName`, перенося тайм-лайны.

---

## 3. `typeBucket('Epic')` → `'other'`, не `'story'`

**Файл**: `integrations/portfolioPulseUtils.js:112-119`

Регексп ловит `'эпик'` (кириллица), но не `'epic'` (английский). Хотя `'feature'` ловится, `'epic'` — нет.

```js
typeBucket('Epic')    // → 'other'
typeBucket('эпик')    // → 'story'
typeBucket('feature') // → 'story'
```

**Severity**: низкая — но эпики попадают не в ту группу в карточках/метриках.

**Починка**: добавить `t.includes('epic')` в условие story-bucket'а.

---

## 4. Кросс-скриптовый matching имён не работает (Bitbucket vs Jira)

**Файл**: `integrations/portfolioPulseModel.js`, функция `_ppFindByPartial`

Bitbucket иногда отдаёт автора в латинской транслитерации (`Ivanov Ivan`), Jira — кириллицей (`Иван Иванов`). Текущий fuzzy-match сравнивает токены через `Set.has()` — лексически разные строки ('ivan' vs 'иван') не пересекаются.

**Воспроизведение**: в смешанной команде (русский Jira + латинский Bitbucket) badges `commits48h` и `pr48h` остаются нулевыми у части participants, при этом в pill'е в шапке Pulse показывается «+N от авторов вне команды».

**Severity**: средняя в средах с двуязычными именами.

**Починка**: добавить транслитерационный нормализатор перед сравнением (например, минимальную таблицу RU↔EN для имён сотрудников или `cyrillic-to-latin` библиотеку).

---

## 5. `PromptsEditor` не экспортирован — ломает init на F5 (УЖЕ ИСПРАВЛЕНО в этой сессии, фиксирую для истории)

**Файл**: `app/llmAssistant.js:527`, `app.js:368`

`PromptsEditor` определён как `const PromptsEditor = {...}` в `app.js` (модульная переменная). `app/llmAssistant.js` — отдельный ES-модуль, не имеет к нему доступа. Бросал `ReferenceError`, ронявший `App.init()` — из-за чего `Storage.load()` никогда не вызывался, и пользователь видел пустой портал на F5.

**Починка** (применена): экспорт `window.PromptsEditor = PromptsEditor` в `app.js` + defensive `window.PromptsEditor?.init?.()` в `llmAssistant.js`.

**Урок**: тесты на `App.init()` поймали бы это сразу. **TODO**: добавить smoke-test "App.init() runs to completion without throwing".

---

## 6. `Storage.save()` использует 400ms debounce без `flushNow()` — данные могут потеряться при F5 в окне < 400 ms после изменения

**Файл**: `dataStore.js:19-52`

При импорте CSV последний `Storage.save()` вызывается, ставит таймер на 400 мс. Если пользователь успевает нажать F5 до того, как таймер сработает — `localStorage.setItem` не выполняется, данные теряются.

**Severity**: низкая (нужен очень быстрый F5), но воспроизводимая.

**Починка**: добавить `Storage.flushNow()` (синхронный setItem без таймера) и вызывать в конце `CSV.import` / `XLSXImporter.import`.

---

## 7. `parseIntentCategory` не работает для русских команд из-за `\b` в not-Unicode regex

**Файл**: `chat/chatIntentParser.js:476-517`

Регулярки CATEGORY_RULES используют `\b` без флага `u`. В JavaScript без `u` `\b` — это ASCII word-boundary, кириллические буквы НЕ относятся к `\w`. Поэтому `/^\s*(перенеси|удали|...)\b/i` **никогда не матчит** русское `перенеси PAY-1` — после `перенеси` идёт пробел, но границы между "и" и пробелом ASCII-regex не видит как boundary в кириллице.

**Воспроизведение**:
```js
/^\s*(перенеси|удали)\b/i.test('перенеси PAY-1')  // false
/^\s*(перенеси|удали)/i.test('перенеси PAY-1')    // true (без \b)
```

**Эффект**: для русскоязычного пользователя `parseIntentCategory` возвращает `'general'/'fallback'` для большинства команд — action/planning/explain/report/search/analysis категории фактически мёртвые. LLM всегда получает `general`-промпт.

**Severity**: средняя — снижает качество классификации запросов на ~80% (русский — основной язык интерфейса).

**Починка**: добавить флаг `u` к каждой regex (`/.../iu`) и заменить `\b` на `(?=\s|$|[^а-яА-ЯёЁa-zA-Z0-9])` или `(?<=^|[\s.,;:!?])` (Unicode-aware). Альтернатива — просто убрать `\b` (см. ниже строки в free-text rules — большинство правил уже не требуют точной границы).

---

## 8. `parseIntent` не распознаёт винительный падеж русских триггер-слов

**Файл**: `chat/chatIntentParser.js:34-46`

`EXECUTIVE_SUMMARY` ловит `/сводк[аи]/i` — только Им./Род. падеж. «Дай **сводку**» (винительный) не матчит.

**Воспроизведение**:
```js
parseIntent('Дай сводку')  // → { intent: 'generic' }
parseIntent('сводки')       // → { intent: 'executive_summary' }
```

**Severity**: низкая — но кейсы вида «Дай сводку», «опиши сводку» теряются.

**Починка**: расширить класс символов до `[аиуeё]` или использовать стеммер вроде `сводк`-prefix.

---

*Файл генерируется автоматически в процессе написания тестов. Каждая запись содержит файл/функцию, воспроизведение и severity.*
