# 12. Рекомендации

Приоритизированный список. Сортировка: эффект ÷ сложность.

| # | Что сделать | Зачем | Сложность | Эффект | Риск регресса |
|---|---|---|---|---|---|
| 1 | Добавить `storage` event listener для синхронизации вкладок | Защищает от перезаписи user data (NEW-1) | S | high | low |
| 2 | Добавить ротацию `q2_action_log_v1` (cap 1000 entries) | Защищает от QuotaExceeded (NEW-2) | S | high | low |
| 3 | Извлечь `safeUrl` в `utils.js` (3 копии → 1) | DRY + единая точка для security review | S | medium | low |
| 4 | Извлечь `Utils.jiraIssueUrl(base, key)` (3 hardcoded) | Меньше дублирования | S | low | none |
| 5 | Добавить `caughtErrorsIgnorePattern: '^_'` в ESLint config | Снимет ~10 пустых warnings, slack +10 | S | medium | none |
| 6 | Включить CSP / X-Frame-Options / X-Content-Type-Options headers | Defense in depth (см. 02) | S | high | low |
| 7 | Вынести bundle-CSV import за whitelist token-полей (NEW-13) | Закрыть token theft vector | S | critical | low |
| 8 | Добавить `fs.realpath` к path-traversal проверке (NEW-7) | Закрыть symlink obstacle | S | medium | none |
| 9 | Не логировать в `proxyChat` без timeout-cap | Закрыть NEW-12 hang | S | medium | low |
| 10 | Добавить retry on 502/503/504 в `jiraRequest` | Robust к flaky сетям корпоратива | S | high | low |
| 11 | Извлечь `pLimit` в shared helper (3 копии в server.js) | DRY | S | low | none |
| 12 | Покрыть `chat/chatEngine.js` тестами (700 LOC, 0% сейчас) | Регрессии в orchestrator'е | M | high | medium |
| 13 | Покрыть `chat/chatActions.js` тестами | Action mutations критичны | M | high | medium |
| 14 | Покрыть `ai/aiCeoFallback.js` тестами (650 LOC, 0%) | CEO-блоки не валидируются | M | high | medium |
| 15 | Добавить полную пагинацию для Bitbucket (PR & commits) | Полнота данных Pulse | M | medium | low |
| 16 | Реализовать GigaChat token refresh (NEW-12) | UX без manual re-save | M | high | low |
| 17 | Cleanup `dataStore.js` manual `Storage.save()` calls — переход на чисто Reactive | Один path вместо двух | M | medium | high |
| 18 | Декомпозировать `app.js` (вынести StorageSettings, PromptsEditor, Nav, AppSettings) | Снизить file size 2148 → ~1000 LOC | L | medium | medium |
| 19 | Декомпозировать `server.js` (3-4 модуля по area) | Снизить file size 2612 → ~600 LOC × 4 | L | medium | medium |
| 20 | Покрыть `views/registry.js`, `views/gantt.js` тестами (jsdom) | Защита от UI регрессий | XL | high | medium |
| 21 | Запуск Coverage в CI (`--experimental-test-coverage`) | Видимость метрики | S | medium | none |
| 22 | Обновить ARCHITECTURE.md под V12 | Документация актуальна | S | low | none |
| 23 | Опт-ин `// @ts-check` на 5-10 простых модулей | Постепенная типизация | M | medium | low |
| 24 | Добавить `aria-selected` / `tabindex` к Pulse / TechInfo tabs | A11y для скринридеров | S | medium | low |
| 25 | Добавить `aria-live="polite"` для showToast | A11y для скринридеров | S | low | none |
| 26 | Добавить focus management в модалки (focus trap) | A11y без мыши | M | medium | low |
| 27 | Сократить styles.css 339KB → ~250KB через CSS variables | Запас бюджета | L | medium | medium |
| 28 | Refactor `analysePulse` 298 LOC на под-функции | Тестируемость, читаемость | L | high | high |
| 29 | Опт-ин `dependency-cruiser` в CI | Защита от циклов и нарушений слоёв | S | low | none |
| 30 | Bundle size watch — fail на превышение | Не уйти за лимит автоматически | S | medium | none |

## Топ-10 по соотношению эффект/сложность

1. **#7 Whitelist bundle-CSV** — критично для security, S сложность.
2. **#1 storage event listener** — high эффект, S, NEW-1 баг.
3. **#2 action_log ротация** — high эффект, S, NEW-2 баг.
4. **#10 retry на 5xx** — high эффект, S.
5. **#6 Security headers** — high эффект, S.
6. **#8 fs.realpath** — closes symlink hole, S.
7. **#16 GigaChat refresh** — high UX, M.
8. **#5 caughtErrorsIgnorePattern** — снимет 10 warnings, S.
9. **#3 + #4 DRY (safeUrl + jiraIssueUrl)** — S, low risk.
10. **#21 coverage в CI** — S, видимость.

## Не рекомендую делать

- **Полная миграция на TypeScript** — XL объём, средний эффект, высокий риск регресса. Лучше точечный `// @ts-check` (#23).
- **Замена vanilla на React/Vue** — противоречит документированному выбору архитектуры (см. ARCHITECTURE.md «Why Vanilla?»). Преимущества несоразмерны с риском.
- **Установка husky / Renovate / dependabot** — нарушает "no new deps" политику. У нас 3 dev-deps, обновлять руками раз в полгода нормально.
- **Полный re-rewrite testRunner.js → node:test** — XL объём, low value (104 теста уже работают). Лучше дописывать новые тесты в `tests/unit/` и постепенно дублировать старые.
- **Упрощение ai/* блоков (13 → 5)** — каждый блок имеет своё бизнес-значение для CEO. Без user research упрощать нельзя.
- **Полная замена Reactive proxy на explicit save+refresh** — это пол-шага назад от audit #6. Лучше дочистить дубль (#17), оставив один путь.
- **Гранулярные DOM updates вместо innerHTML** — vanilla без VDOM это много кода. Современные браузеры на innerHTML быстрые. Лучше — virtual scrolling в registry/gantt (это #20 уже).

## Рекомендуемая последовательность работ

**Спринт 1 (security + bug fixes)** — 1 день:
- #7, #1, #2, #6, #8, #10

**Спринт 2 (DRY + tooling)** — 1 день:
- #3, #4, #5, #21, #22

**Спринт 3 (chat coverage)** — 2 дня:
- #12, #13

**Спринт 4 (a11y)** — 1 день:
- #24, #25, #26

**Спринт 5 (token refresh + pagination)** — 2 дня:
- #15, #16

**Спринт 6 (decomposition)** — 3-5 дней:
- #18, #19, #28

**Долгосрочно**:
- #20 (UI tests), #27 (CSS reduction)
