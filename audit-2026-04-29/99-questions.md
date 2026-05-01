# 99. Вопросы для разработчика

Что не успел / не смог проверить за время аудита.

## Не разбирался глубоко

### LLM proxy / SSE streaming
**`server.js:91-200` — `proxyChat`**:
- Есть ли таймаут на upstream connection к GigaChat? Не нашёл.
- Что происходит если client отвалился на середине stream'а? Сервер закрывает upstream?
- Что происходит при истечении OAuth token'а посреди stream'а?

**Зачем спрашиваю**: NEW-12 (token expiry) и потенциальный hung connection — security + reliability.

### Onboarding
- Используется ли реально 24-step tour? Если нет — кандидат на удаление (~300 LOC в `onboarding/`).
- Есть ли метрики использования (но без analytics это сложно).

### SQLite — реальные пользователи
- Кто-нибудь реально включает SQLite-mode? Если нет — ~550 LOC `sqliteStore.js` + ~180 LOC `appDataStore.js` под вопросом.
- Если да — какой максимум данных в production?

### `views/registry.js`, `views/gantt.js` — пользовательские объёмы
- Сколько строк типичный реестр? 100? 1000? 5000?
- Влияет ли на perf (рендер innerHTML)?

### Chat — реальное использование
- Какой % запросов идёт через rule-based vs LLM?
- Какие категории intent'ов наиболее частые?

### Bundle / SPLA
- Замечают ли пользователи 1.1 MB JS на load? Это ~3 секунды на 4G.
- На каком оборудовании работают пользователи (Sberbank внутренние ноуты)?

## Не было доступа

- Реальные данные в Jira/BB/Confluence для проверки edge-cases (не имею токенов).
- История commits — git нет, не могу оценить velocity.
- Логи сервера в production — для определения реальных rate-limit hits / timeout patterns.

## Решения, требующие user input

### Storage strategy
- Куда мы движемся? localStorage forever? SQLite по умолчанию? Server-side persistence?

### Цели V13+
- Чат с активностью сотрудников (упомянут в task user'а) — это сменит фокус с прошлых волн или дополнит?
- Какие приоритеты на следующий квартал?

### Acceptable security baseline
- Готовы ли потерять время разработки на CSP / token encryption / proper auth flow?
- Допустим ли уровень "intra-corporate, low-risk" или ужесточаем?

### Coverage цель
- 60% по unit OK или нужно 80%+?
- Включать UI rendering в coverage (jsdom/Playwright) или нет?

## Что желал бы увидеть в следующем рассмотрении

1. Размеры production deploy'ов (сколько rows у самого активного user'а).
2. Сетевая статистика (latency к Jira/BB/CF из корпоративной сети).
3. Топ-5 user complaints по UX за последний месяц.
4. Список фичей V13/V14 в roadmap'е.
