# 07. Сводный список найденных проблем

Severity: **C**=critical, **H**=high, **M**=medium, **L**=low.
Тип: **bug**=runtime баг, **smell**=архитектурный/тестовый смрад, **gap**=отсутствие функциональности, **doc**=документация.

## Не починенные с V12 audit

| ID | Sev | Тип | Заголовок | Файл |
|---|---|---|---|---|
| NEW-3 | M | bug | `Storage.save` глушит non-Quota ошибки | `dataStore.js:35-37, 55-57` |
| NEW-4 | H | bug | `notify()` глушит exceptions подписчиков | `state.js:178-180` |
| NEW-5 | M | bug | Tech Info cache stampede | `server/integrations/techInfo.js:103-110` |
| NEW-6 | L | bug | `_jiraSprintFieldIdCache` не invalidated на config change | `server.js:497-520` |
| NEW-7 | L | bug | Path traversal TOCTOU между realpath и readFile | `server.js:1700-1711` |
| NEW-8 | M | bug | Review-activity stream неполный для PR из dev-status | `server.js:743-757` (область) |
| NEW-9 | L | smell | `q2_plan_v2`/`q2_plan` legacy keys никогда не очищаются | `constants.js` |
| NEW-10 | L | bug | CSV-импорт не валидирует count колонок в строке | `dataStore.js:283-310` (область) |
| NEW-11 | L | bug | `_AUTO_RERENDER_GRACE_MS=250` не покрывает медленный Gantt | `app.js:1875` |
| NEW-14 | L | smell | `new Function(...)` в `parseDomainLink.test.js` | tests |
| NEW-15 | H | bug | `_reactiveBooted` не выставляется при синхронном крахе App.init | `app.js:1891-1897` |
| NEW-16 | L | smell | `'use strict'` не во всех новых модулях | tests/fixtures |
| NEW-17 | L | bug | Confluence url'ы — safeUrl применён точечно | `server.js:1387-1395` (область) |
| NEW-18 | L | gap | Bitbucket repo-walk silently truncates `.slice(0, 10)` | `server.js:704` (область) |

**Итого с V12**: 14 unfixed bugs/smells (4 H, 4 M, 6 L).

## Новое в V13 (NEW-V13-*)

| ID | Sev | Тип | Заголовок | Файл |
|---|---|---|---|---|
| NEW-V13-1 | H | bug | SSRF surface через config POST (нет URL/IP-class валидации) | `server.js:1266-1290`, `jiraForward` |
| NEW-V13-2 | H | smell | testRunner.js — 104 inline-mirror теста, не тестируют реальный код | `testRunner.js` |
| NEW-V13-3 | H | gap | `tests/contract/` пустая директория, `npm run test:contract` молчаливо проходит с 0 тестами | `package.json`, `contractTest.js` |
| NEW-V13-4 | M | doc | ARCHITECTURE.md устарел: заголовок V12, нет V13 секций | `ARCHITECTURE.md` |
| NEW-V13-5 | M | gap | chat-activity handler без unit-тестов (243 LOC, 6 веток) | `chat/chatActivityHandler.js` |
| NEW-V13-6 | M | bug | `jiraWriteConfig` — НЕ атомарная запись (нет write-temp+rename) | `server.js:353-356` |
| NEW-V13-7 | M | bug | `jiraReadConfig`/`Write`Sync блокируют event loop в request handler | `server.js:349, 354` |
| NEW-V13-8 | M | bug | `proxyChat` без idle-timeout на upstream stream | `server.js:207-326` |
| NEW-V13-9 | M | bug | `_jiraSprintFieldIdCache` race condition — нет single-flight | `server.js:497-520` |
| NEW-V13-10 | M | smell | `handleIntegrationsApi` — gigantic switch (380 LOC) | `server.js:1311-1690` |
| NEW-V13-11 | M | gap | `jiraSanitizeAreas` — нет cap на `areas.length` (DoS-amp) | `server.js:357-365` |
| NEW-V13-12 | M | gap | `coverage` не запускается в CI | `package.json` |
| NEW-V13-13 | M | gap | Focus management в модалках отсутствует (NEW для аудита) | `app/llmAssistant.js`, etc |
| NEW-V13-14 | L | smell | activity handler возвращает misleading clarification при отсутствии Pulse | `chat/chatActivityHandler.js`, `chat/chatEngine.js:658` |
| NEW-V13-15 | L | smell | `chatEngine.process()` лезет в `window.PortfolioPulse._model` (нарушение DI) | `chat/chatEngine.js:658` |
| NEW-V13-16 | L | gap | `jiraForward` не валидирует scheme (только http/https) | `server.js:392` |
| NEW-V13-17 | L | gap | `Reactive.flushNow` / `Storage.flushNow` не вызываются на `beforeunload` | — |
| NEW-V13-18 | L | smell | `q2_action_log_v1` в bundle ALLOWED_BUNDLE_KEYS — historylog в импорте лишний | `dataStore.js:334` |
| NEW-V13-19 | L | smell | E2E не тестирует happy-path tech-info (только rate-limit) | `e2eTest.js` |
| NEW-V13-20 | L | smell | testRunner.js test:contract path не работает | (см. NEW-V13-3) |
| NEW-V13-21 | L | smell | Inline `onclick="event.stopPropagation()"` в renderers (CSP `unsafe-inline` justification) | `integrations/*Renderer.js` |
| NEW-V13-22 | L | gap | `cfg.allowInsecureTls` глобальный (не per-service) | `server.js:398` |

**Итого V13**: 22 новых пунктов (3 H, 8 M, 11 L). 

## Закрытые в V12, проверены в V13 — статус

| ID | Заголовок | V13 status |
|---|---|---|
| #1 (V11) | `formatHrs(0)` — латинская/кириллическая | ✅ закрыт |
| #2 (V11) | participant двойник через userKey | ✅ закрыт |
| #3 (V11) | typeBucket `Epic` → 'other' | ✅ закрыт |
| #4 (V11) | cross-script name match | ✅ закрыт |
| #5 (V11) | `PromptsEditor` ReferenceError | ✅ закрыт (export) |
| #6 (V11) | `Storage.flushNow` — sync flush | ✅ закрыт |
| #7 (V11) | bundle-CSV token theft | ✅ закрыт (allowlist) |
| #8 (V11) | chat-intent regex Cyrillic boundaries | ✅ закрыт |
| NEW-1 | storage event listener | ✅ закрыт |
| NEW-2 | historyLog ротация | ✅ закрыт |
| NEW-12 | GigaChat token refresh | ✅ закрыт (retry on 401) |
| NEW-13 | bundle-CSV ALLOWLIST | ✅ закрыт |

**Итого закрытых**: 12. Всё прошлое успешно мигрировало.

## Сводная таблица severity

| Severity | V12-неподвинутые | V13-новые | Total |
|---|---|---|---|
| C | 0 | 0 | **0** |
| H | 4 | 3 | **7** |
| M | 4 | 8 | **12** |
| L | 6 | 11 | **17** |
| **Итого** | **14** | **22** | **36** |

Большинство — L (architectural / nice-to-have). Critical нет. Active-exploit риска нет — все H требуют либо специфических условий (race, timing), либо контроля над конфигом (admin-controlled).

## Что приоритезировать в первую очередь

В порядке убывания **risk × ease-of-fix**:

1. **NEW-V13-2** (testRunner.js inline-mirror): H severity, S effort. Просто переписать на реальные импорты.
2. **NEW-V13-3** (tests/contract/ empty): H severity, S. Поправить script или перенести.
3. **NEW-15** (reactive booted on init crash): H, S. try/catch + showToast.
4. **NEW-4** (notify swallow exceptions): H, XS. Заменить empty catch на console.error.
5. **NEW-V13-1** (SSRF): H, M. Нужно валидировать URL scheme + IP class. По крайней мере — задокументировать as design choice.
6. **NEW-V13-6** (атомарная запись config): M, S. write-temp + rename.
7. **NEW-V13-4** (ARCHITECTURE.md): M, S. Просто обновить.
8. **NEW-V13-9** (sprint cache stampede): M, S. Single-flight pattern.
9. **NEW-V13-7** (sync IO в handler): M, S. Memory-cache cfg.
10. **NEW-V13-13** (focus management): M, M. Single utility + 4-5 mounts.
