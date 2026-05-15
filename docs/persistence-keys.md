# Persistence keys

Единый индекс всех localStorage-ключей проекта. Канонический список — `ALL_LOCALSTORAGE_KEYS` в [`constants.js`](../constants.js).

> AUDIT_ARCHITECTURE #21/#22 (2026-05-08) — раньше ключи были разбросаны: `STORAGE_KEYS`/`SETTINGS_KEYS` в `constants.js`, ad-hoc `q2_last_seen_v1` в `app.js:2033`, scanner-prefs в `integrations/`, mascot-flags в `app/obsidianMascot.js`. Новый разработчик не мог найти полный список. Этот документ + единый реестр в `constants.js` — single source of truth.

## Таблица ключей

| Ключ | Owner | Версия | Migration | Что хранит |
|---|---|---|---|---|
| `q2_plan_v3` | `dataStore.js` | v3 | v1→v2→v3 в `dataStore.js` + `app/migrations.js` | Основные данные плана: rows + employees + customCols + colSettings |
| `q2_plan_v2` | legacy | — | автоматически читается в Storage.load если v3 пустой | Legacy snapshot до V11 |
| `q2_plan` | legacy | — | то же | Самый старый snapshot |
| `q2_settings_v3` | `dataStore.js` | v3 | v1→v2→v3 | colOrder/Widths/Visibility/Types/Labels + theme + planLocked + ganttEditMode |
| `q2_settings_v2` / `q2_settings` | legacy | — | автоматически читается | Старые версии settings |
| `sbof_app_settings_v1` | `app/appSettings.js` | v1 | — | Sidebar/topbar visibility, BLOCKS_PER_SECTION toggle states |
| `q2_action_log_v1` | `historyLog.js` | v1 | — | Audit trail действий пользователя. **AUDIT_TECH 5.1**: rolling cap 2000 entries после фикса. |
| `q2_errors_log_v1` | `errorsLog.js` | v1 | — | Ошибки с stack trace |
| `q2_llm_settings_v1` | `app/llmAssistant.js` | v1 | — | LLM provider config (apiBaseUrl, model, токены если sessionOnly=false) |
| `q2_llm_conv_v1` | `app/llmAssistant.js` | v1 | — | Conversation history с LLM (24h TTL) |
| `q2_chat_prompts_v1` | `chat/chatPrompts.js` | v1 | — | Per-user override prompts |
| `q2_integrations_v1` | `integrations/integrationsStore.js` | v1 | **DEPRECATED** | Integration tokens (server `jira_config.json` теперь source of truth) |
| `q2_scanner2_prefs_v1` | `integrations/teamScanner2.js` | v1 | — | Прежние команды/настройки сканнера |
| `q2_diag_consent_until` | `integrations/teamScanner2.js` | — | TTL 24h | Согласие на отправку diagnostic snapshot'ов |
| `q2_obsidian_emerged_v1` | `app/obsidianMascot.js` | v1 | sessionStorage (не localStorage) | Sessionwise: сыграл ли Emerge маскота |
| `q2_mascot_hidden` | `app/obsidianMascot.js` | — | — | AUDIT_MASCOT 7.1 — пользователь скрыл маскот |
| `q2_mascot_size` | `app/obsidianMascot.js` | — | — | AUDIT_MASCOT 7.2 — auto/sm/md/lg |
| `q2_mascot_hibernate` | `app/obsidianMascot.js` | — | — | AUDIT_MASCOT 7.3 — отключить hibernate |
| `q2_obsidian_last_active` | `app/obsidianMascot.js` | — | heartbeat 60s | AUDIT_MASCOT 2.7 — для «давно не виделись» welcome-back |
| `q2_onboarding_v1` | `onboarding/onboarding.js` | v1 | — | First-run state + selected mode |
| `q2_last_seen_v1` | `app.js:2033` | v1 | — | Personal digest — что юзер уже видел |
| `q2_metricsDeep_period` | `views/metricsDeep/index.js` | — | — | AUDIT_SCANNER_METRICS F-NAV-3 — выбранный period (7d/30d/90d/quarter) |
| `hygiene:snoozed:v1` | планируется (AUDIT_SCANNER §Б) | v1 | — | Snoozed Hygiene Jira violations per-issue |

## Контракты

### Versioning

При bump версии (`_v3` → `_v4`) **обязательно**:

1. Добавить миграцию в `app/migrations.js` через `Migrations.register('v3-to-v4', (oldData) => newData)`.
2. Сохранить старый ключ ещё одну версию (rollback compatibility — см. AUDIT_DEVOPS 6.2).
3. После 1 версии — старый ключ можно delete.

### Quota

localStorage limit обычно 5MB на origin. На больших планах (~3000 rows) можно подойти к limit.

- `Storage.save` ловит `QuotaExceededError` и показывает toast (см. `dataStore.js` + `app/uxKit.js Toast.warning`).
- `historyLog.js` — rolling cap 2000 (AUDIT_TECH 5.1).
- При >5MB — fallback на SQLite-WASM (`appDataStore.js`).

### Cross-tab sync

`window.addEventListener('storage', ...)` в `app.js:2127` — реагирует только на ключи из `STORAGE_KEYS + SETTINGS_KEYS`. На событие — reload через `Reactive.silent` (иначе loop).

### Secrets

`q2_llm_settings_v1` и `q2_integrations_v1` могут содержать токены. CSV/JSON-export должен пройти через `dataStore.CSV._scrubSecrets` — он preserves keys но scrubs token-fields внутри JSON values.

## Roadmap

- **AUDIT_DEVOPS 5.6** — `.profile/heap-snapshot-*` могут содержать токены. Не localStorage, но связанная hygiene.
- **AUDIT_TECH AS.1** — миграция на SQLite-WASM по умолчанию для проектов >1000 rows.
- **AUDIT_TECH AS.7** — long-tail snapshots в IndexedDB (после 20 импортов localStorage теряет старейший).
- **AUDIT_DEVOPS 10.1** — server-side backup (`POST /api/state/snapshot` + cron rotate).
