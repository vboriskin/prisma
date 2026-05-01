# 11. Реальные баги

Список багов, обнаруженных по ходу аудита. Часть совпадает с уже существующим `docs/FOUND_BUGS.md` (8 багов исправлены в V12), новые помечены **NEW**. Серьёзность: **C** — критично, **H** — высоко, **M** — средне, **L** — низко.

---

## NEW-1 [H] Race condition: одновременное открытие двух вкладок → перезапись настроек

**Файл**: `dataStore.js:19-60`, `reactiveStore.js`
**Воспроизведение**:
1. Открыть приложение в двух вкладках (одна сессия localStorage).
2. В вкладке A — поменять колонки реестра. В вкладке B — то же самое.
3. Вкладка B при `Storage.save()` перезапишет настройки A без слияния.

**Эффект**: пользователь теряет работу одной из вкладок. Нет `storage` event listener'а для синхронизации.

**Severity**: H. Воспроизводится за 30 секунд.

---

## NEW-2 [H] `historyLog` растёт без ротации

**Файл**: `historyLog.js`, search localStorage `q2_action_log_v1`
**Доказательство**: в одном дампе пользователя из текущей сессии было ~3 KB `q2_action_log_v1`, накапливается линейно без ограничения.

**Эффект**: при долгом использовании localStorage приближается к лимиту 5-10 MB. На грани — `QuotaExceededError` ловится в `Storage.save`, но прочие writes (LLM conversation, prompts) не защищены.

**Severity**: H.

**Воспроизведение**: импортировать CSV 100 раз → action log распухнет на ~600 событий.

---

## NEW-3 [H] `Storage.save` молча проглатывает ВСЕ ошибки кроме QuotaExceeded

**Файл**: `dataStore.js:48-50, 57-58`
```js
} catch(e){
  if (e && e.name === 'QuotaExceededError') window.showToast?.('...');
}
```
Любой `SecurityError` (Safari Private Mode), `InvalidAccessError` (страница в iframe без cookies), `JSON.stringify` фейл (циклическая ссылка) — теряется без сообщения.

**Severity**: H — пользователь думает что сохранилось, а на самом деле нет.

---

## NEW-4 [H] `notify('reason')` глушит исключения подписчиков

**Файл**: `state.js:178-180`
```js
export function notify(reason='') {
  _listeners.forEach(fn => { try { fn(reason); } catch(e) {} });
}
```
Если subscribe-handler в `app.js:2071` бросает (например, `App.refreshAll` крашится из-за data corruption) — ошибка проглатывается, UI замораживается без diagnostics.

**Severity**: H. Поймал в текущей сессии при `PromptsEditor` ReferenceError — пользователь видел пустой портал без сообщения.

---

## NEW-5 [M] `_techInfoCache` cache-stampede при параллельных запросах

**Файл**: `server.js:1118-1124, 1499-1538`
Если 5 пользователей открывают модалку «Техническая информация» одновременно после рестарта сервера — все 5 параллельно идут в Jira/BB/CF, заполняя кэш одновременно. Нет single-flight семантики.

**Severity**: M — реальная нагрузка ×5 на корпоративный Jira.

---

## NEW-6 [M] `_jiraSprintFieldIdCache` — нет invalidation при смене base URL

**Файл**: `server.js:487-516`
Кэш привязан к `cfg.jiraBaseUrl`, но если admin поменяет URL (новая Jira instance с теми же кредами), за TTL=30мин будет использоваться старый sprint-field-id. На новом инстансе он может не существовать → пустой Sprint в Pulse.

**Severity**: M — редкий, но reproducible.

---

## NEW-7 [M] Path traversal защита через `startsWith(ROOT + path.sep)` — не покрывает symlink

**Файл**: `server.js:2462-2466`
```js
if (!path.resolve(filePath).startsWith(ROOT + path.sep) && path.resolve(filePath) !== ROOT) {
  res.writeHead(403, ...);
  return;
}
```
`path.resolve` не следует за symlink'ами в filesystem. Если в `ROOT` есть symlink на `/tmp` (или admin случайно создал) — клиент через `GET /symlink/etc/passwd` может прочитать файлы вне ROOT.

**Severity**: M — требует наличия symlink в ROOT (нестандартно), но простой обход.

**Починка**: использовать `fs.realpath` перед сравнением.

---

## NEW-8 [M] PR-activity stream запускает HTTP fetch для PR'ов, найденных через `bbActivity` — но не для тех, что найдены через `devStatus`

**Файл**: `server.js:743-757` (bbActivity push в `_prsForActivity[]`)
Wave 4d добавил review-activity fetch только для PR из repo-walk. PR'ы, найденные через Jira dev-status (Phase 1), в `_prsForActivity` не попадают. Review-метрики неполные.

**Severity**: M. Незаметно если у вас всё в одном репо.

---

## NEW-9 [L] `LegacyKeys` в `STORAGE_KEYS = [STORAGE_KEY, 'q2_plan_v2', 'q2_plan']`

**Файл**: `constants.js:9`
Старые ключи всё ещё считываются в `Storage.load()`, но никогда не очищаются. У старых пользователей мёртвые байты в localStorage.

**Severity**: L. Можно жить десятилетиями.

---

## NEW-10 [L] CSV-импорт не валидирует количество колонок в строке

**Файл**: `dataStore.js:283-310`
Если в CSV строки разной длины (например, лишняя запятая в одной строке) — `cells[idx]` для отсутствующих столбцов = undefined. RowFactory `... ov={}` глотает undefined без проверки. Тихий data loss.

**Severity**: L. Реальный кейс: пользователь редактировал CSV в Excel и где-то Excel вставил лишнюю запятую.

---

## NEW-11 [L] `App._lastRenderAt` race window 250ms — не покрывает медленный рендер большого Gantt

**Файл**: `app.js:2118-2125`
Окно 250ms между «handler уже отрисовал» и Reactive auto-flush. Если рендер Gantt'а на 1000+ задачах занимает >250ms (рендер innerHTML ~500ms на старом ноутбуке), guard не сработает → второй render всё равно запустится.

**Severity**: L. У большинства пользователей рендер успевает в 250ms.

---

## NEW-12 [M] GigaChat token expiry не обрабатывается

**Файл**: `server.js:194-220` (`proxyChat`) — не нашёл retry-on-401-after-refresh
GigaChat OAuth-токен живёт ~30 минут. Когда истекает, любой LLM-запрос даст 401. Сейчас нет refresh-token логики.

**Severity**: M. Пользователь должен заново сохранить настройки.

---

## NEW-13 [M] CSV-импорт через `bundle:` инжектирует данные напрямую в localStorage, минуя validation

**Файл**: `dataStore.js:271-296`
В CSV-файле зарезервирован специальный prefix `__BUNDLE__:` который читает JSON и пишет КАЖДЫЙ ключ в localStorage без валидации (включая токены `q2_integrations_v1`).

**Эффект**: вредоносный CSV-файл перезаписывает токены пользователя на свои.

**Severity**: M-H — требует социальной инженерии (открыть присланный CSV), но эффект — perfect token theft.

**Починка**: whitelist'ить только реестр-ключи, отфильтровывать токеновые поля.

---

## NEW-14 [M] `eval`-shape: `new Function(...)` в parseDomainLink test использует РЕАЛЬНЫЙ источник server.js

**Файл**: `tests/unit/parseDomainLink.test.js:24`
Тест извлекает функцию через `new Function`. Если в проекте появится недоверенный коммит в server.js — test runner выполнит arbitrary code.

**Severity**: L (тест-only path), но `new Function` это плохая практика которую стоит зафиксировать.

---

## NEW-15 [M] `_reactiveBooted = true` не сбрасывается при ошибках в App.init

**Файл**: `app.js:2104`
Если App.init завершился (даже с partial errors), guard выставляется. Но если App.init крашнулся ДО `_reactiveBooted = true`, флаг навсегда остаётся false. Пользователю кажется что приложение работает, но `Storage.save` через Reactive не идёт.

**Severity**: M. Теоретически возможно, на практике редко.

---

## NEW-16 [L] `useStrict` декларация не во всех новых модулях

**Файл**: `tests/unit/*.test.js` — есть, но `tests/fixtures/*.js` — нет.
Безопасности не угрожает (ESM по умолчанию strict), но непоследовательно.

**Severity**: L.

---

## NEW-17 [M] `confluencePages` — `safeUrl()` применяется только к `_links.webui`, но не ко всем URL из ответа

**Файл**: `server.js:1387-1395`
```js
url: p._links?.webui ? `${urlBase}${p._links.webui}` : '',
```
Если злоумышленник админ Confluence сможет влиять на возвращаемые `webui` URL'ы — потенциально javascript:URL пробрасывается во frontend (там safeUrl'им снова, так что spec не пробьётся).

**Severity**: L — defense in depth.

---

## NEW-18 [L] Bitbucket repo-walk кап `expanded.slice(0, 10)` — пользователь не видит что репо-листа усечён

**Файл**: `server.js:704`
Если в проекте 100 репо, мы тянем только первые 10. В диагностике это не видно — `tried[]` показывает только тронутые.

**Severity**: L. Documented limitation.

---

## NEW-19 [M] Нет CSP header'а

**Файл**: `server.js:2500-2540` (serveStatic)
В response не выставляются: `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`. Нет защиты от clickjacking, MIME-sniffing.

**Severity**: M — для intra-corporate приложения это допустимо, но best-practice требует.

---

## NEW-20 [L] `metricsEngine.computeProgress` mutates row.riskScore — побочка

**Файл**: `metricsEngine.js` (косвенно через `RiskEngine.computeAll(rows)` в dataStore.js:308)
`RiskEngine.computeRiskScore(row)` пишет `row.riskScore = ...`. Это mutation, что норм, но через Reactive proxy → marks dirty → может создать ещё один цикл если внутри save риски пересчитываются. Wrap'ы Reactive.silent защищают, но хрупко.

**Severity**: L — поведение работает, но архитектурно слабое.

---

## Закрытые в V12 (для трассировки)

| # | Описание | Источник | Статус |
|---|---|---|---|
| 1 | `formatHrs(0)` → `0h` (latin) | `portfolioPulseUtils.js:155` | ✅ V12 |
| 2 | Дубль participant через assignee/changelog mismatch | `portfolioPulseModel.js:81-96` | ✅ V12 |
| 3 | `typeBucket('Epic')` → `'other'` | `portfolioPulseUtils.js:115` | ✅ V12 |
| 4 | Cross-script matching не работает | `portfolioPulseModel.js:785-799` | ✅ V12 |
| 5 | `PromptsEditor` не экспортирован | `app.js:368`, `app/llmAssistant.js:527` | ✅ V11 |
| 6 | `Storage.save` 400ms debounce без flushNow | `dataStore.js:19-60` | ✅ V12 |
| 7 | `parseIntentCategory` Cyrillic `\b` regex | `chat/chatIntentParser.js:478-517` | ✅ V12 |
| 8 | `parseIntent` accusative case | `chat/chatIntentParser.js:36` | ✅ V12 |
