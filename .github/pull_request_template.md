<!--
  PR template для СБОФ Планирование v17.
  Удали неиспользуемые секции; те что оставил — заполни.
-->

## Что меняется

<!-- 1-2 строки: что и зачем. Если есть audit-отчёт — ссылка на него. -->

## Как тестировал

<!-- Команды + результат. Пример:
- `npm test` → 534 unit / 11 contract / 0 fail
- Ручная проверка: открыл Реестр → нажал бесплатный фильтр → ОК
- Скриншот / GIF если визуальное изменение
-->

## Documentation impact

Если PR меняет одно из ниже — обнови соответствующую доку. Отметь чекбокс ✓ когда сделал.
**Если ничего из перечисленного не применимо — поставь N/A в конце и пропусти секцию.**

### Контракты state и persistence

- [ ] Изменён один из 3 контрактов (`Reactive.silent` / Identity / `_scrubSecrets`) → **обновить** [`docs/state-contracts.md`](../docs/state-contracts.md)
- [ ] Bump версии localStorage key (`q2_*_v3` → `q2_*_v4`) или migration → **обновить** `state-contracts.md` § Migration policy
- [ ] Новое поле в `state` → проверить shape-комментарий в `state.js` + при необходимости [`docs/domain-glossary.md`](../docs/domain-glossary.md)

### Доменная логика

- [ ] Новый scope-status / релиз / тип-работы / роль identity → **обновить** [`docs/domain-glossary.md`](../docs/domain-glossary.md)
- [ ] Изменён risk-engine (`riskEngine.js` rules) → **обновить** § Risk Engine в `domain-glossary.md`
- [ ] Demo-данные (`onboarding/demoData.js`) меняются → проверить first-run experience и `audit-2026-05-V17/12-tour-audit.md`

### Интеграции

- [ ] Новый `/api/integrations/*` endpoint или изменение существующего → **обновить** [`docs/integrations/api-endpoints.md`](../docs/integrations/api-endpoints.md)
- [ ] Новая интеграция (Jira / BB / CF / etc) → пройти [security checklist](../docs/integrations/auth-and-secrets.md#контрольный-чек-лист-безопасности) + обновить [`docs/integrations/README.md`](../docs/integrations/README.md)
- [ ] Token / secret handling изменилось → **обновить** [`docs/integrations/auth-and-secrets.md`](../docs/integrations/auth-and-secrets.md)
- [ ] Новый identity-поле в `EmployeeFactory` → шаги в `state-contracts.md` § Identity и `domain-glossary.md` § Identity

### Запуск / конфиг

- [ ] Новая env-переменная → **обновить** таблицу env в [`docs/running.md`](../docs/running.md)
- [ ] Новое поле в `jira_config.json` → **обновить** § «Где живёт конфиг» в `running.md`
- [ ] Меняется `npm run *` команда → **обновить** [`docs/running.md`](../docs/running.md) + [`docs/testing.md`](../docs/testing.md) + `CLAUDE.md` § Команды

### Тесты

- [ ] Новый тестовый pattern / fixture / runner → **обновить** [`docs/testing.md`](../docs/testing.md)
- [ ] Изменился `--max-warnings 215` budget → отметь в `package.json` + объясни в PR description
- [ ] Покрытие модуля резко упало или вырос новый weak-spot → **обновить** § «Что слабо покрыто» в `testing.md`

### Visual / UX

- [ ] Visual change (новый компонент / стили surface) → пройти [Spine-pill checklist](../docs/spine-pill.md#visual-review-checklist)
- [ ] Новый design-токен в `:root` → **обновить** § «Дизайн-токены» в `spine-pill.md`
- [ ] Anti-pattern найден и зафиксен → **добавить** в § «Анти-паттерны» в `spine-pill.md`
- [ ] Эмодзи появились в data-view → **запретить** или явно пометить как onboarding-only исключение

### Архитектура / эволюция

- [ ] Декомпозиция модуля (вынос из `app.js` / `server.js`) → **обновить** `ARCHITECTURE.md` § Decomposition status
- [ ] Что-то retired (фича / API / поле) → **обновить** [`docs/version-history.md`](../docs/version-history.md) § «Что retired»
- [ ] Найдена «осознанная кривизна» (legacy / антипаттерн которое надо защитить от «починки») → **добавить** в [`docs/dont-touch.md`](../docs/dont-touch.md)
- [ ] Закрыта V-эпоха (V17.3, V18, ...) → **обновить** `docs/version-history.md` + создать `audit-202X-XX/MASTER_PLAN.md`

### Audit-метки в коде

Если добавлены `// V17.3 Xy ...` или подобные ярлыки:

- [ ] Соответствующая audit-папка (`audit-202X-XX/`) создана с `MASTER_PLAN.md`
- [ ] Метка имеет формат `V<version> <group-id> [(<expert> §<section>)] — <короткое описание>`
- [ ] В `docs/version-history.md` добавлена строка эпохи

---

## Чек-лист перед merge

- [ ] `npm test` зелёное (укажи числа: `534 / 11 / 0`)
- [ ] `npm run typecheck` без ошибок
- [ ] `npm run lint` без новых warnings (`--max-warnings 215` не превышен)
- [ ] Smoke-test: `node server.js 19099 &` + `curl /health` отвечает
- [ ] Если visual change — скриншот в PR description (light + dark theme)
- [ ] Documentation impact выше отмечен или N/A

<!-- Если N/A — напиши прямо: «Documentation impact: N/A — фикс опечатки/typo, без поведенческих изменений». -->
