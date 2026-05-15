'use strict';
/* ============================================================
   shared/secrets.js — V22 holistic-P4 (AUDIT_HOLISTIC.md §1 #12 / §7 P4)
   --
   Единый scrubber для секретов в structured-объектах (CSV/JSON export,
   localStorage bundle, telemetry payload, log records).

   Сейчас в проекте паттерн зеркалится в трёх местах:

     · client  CSV._scrubSecrets       (dataStore.js) — recursive whitelist
                                        по `_SECRET_FIELD_NAMES`
     · client  scrubChatSecrets        (app/llmAssistant.js) — text-only
     · server  redactSecretsInText     (server/integrations/authHelpers.js)

   Этот модуль — single source of truth для object-scrub. Pattern: dual UMD
   IIFE — работает в браузере (window.Secrets) и в Node (module.exports)
   без бандлера.

   API:
     Secrets.SECRET_FIELD_NAMES  → readonly Array<string>
     Secrets.scrubObject(obj, opts?)    → object без secret-полей
     Secrets.scrubHeaders(headers)      → object/Map без Authorization/X-API-Key
     Secrets.scrubFormulaPrefix(value)  → string с ZWSP-prefix, защита от Excel-injection
     Secrets.isSecretFieldName(name)    → boolean

   Контракт совместимости:
     · Включает все поля старой `CSV._SECRET_FIELD_NAMES` (см. dataStore.js:311).
     · `scrubObject` совместим с `CSV._scrubSecrets` — если на месте старого callsite
       подставить новый — поведение не меняется.
     · `scrubFormulaPrefix` зеркало `escape()` из dataStore.js:1332 (без quote-обрамления).

   TODO(holistic-P4 phase-2): мигрировать 30+ callsites
     · CSV._scrubSecrets               (~5 callsites — dataStore.js)
     · scrubChatSecrets                (~4 callsites — app/llmAssistant.js)
     · server `_authHelpers.redactSecretsInText` (server.js, server/integrations/*)
     на этот модуль. См. grep-list в audit-2026-* / holistic-P4-callsites.md.
   ============================================================ */

const Secrets = (function () {
  // Зеркало `CSV._SECRET_FIELD_NAMES` (dataStore.js:311). Расширяется новыми
  // именами — добавлять только в нижний регистр, проверка через `lower.includes(s)`.
  const SECRET_FIELD_NAMES = Object.freeze([
    'token', 'jiratoken', 'bitbuckettoken', 'confluencetoken', 'sigmatoken',
    'gigachatauthkey', 'authkey', 'apikey', 'password', 'secret', 'bearer',
    // V22 holistic-P4 — добавили `accesstoken`, `refreshtoken` (OAuth path),
    // `clientsecret` (GigaChat client_id/client_secret pair). Эти имена ранее
    // не были в _SECRET_FIELD_NAMES — потенциально утекали через bundle export.
    'accesstoken', 'refreshtoken', 'clientsecret', 'privatekey', 'session',
  ]);

  // Заголовки HTTP, которые ВСЕГДА нужно скрыть в логах/диагностиках.
  const SECRET_HEADER_NAMES = Object.freeze([
    'authorization', 'cookie', 'x-api-key', 'x-auth-token', 'proxy-authorization',
    'set-cookie',
  ]);

  // Excel/Numbers/LibreOffice formula-injection prefixes. CSV-экспорт ОБЯЗАН
  // префиксовать ZWSP перед этими символами иначе значение начинающееся с '='
  // может быть интерпретировано как `=HYPERLINK(...)` при открытии в Excel.
  const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;
  const ZWSP = '​';

  /**
   * Проверка имени поля на «секретность» — case-insensitive includes-match
   * по SECRET_FIELD_NAMES. Обратите внимание: substring-match («myToken123»
   * matches на «token»). Это сознательно — шире false-positive чем leak.
   * @param {*} name
   * @returns {boolean}
   */
  function isSecretFieldName(name) {
    if (name == null) return false;
    const lower = String(name).toLowerCase();
    for (let i = 0; i < SECRET_FIELD_NAMES.length; i++) {
      if (lower.includes(SECRET_FIELD_NAMES[i])) return true;
    }
    return false;
  }

  /**
   * Recursive scrub: удаляет ключи, имена которых matches isSecretFieldName.
   * Совместим с `CSV._scrubSecrets` (dataStore.js).
   *
   * @param {*} obj
   * @param {{maxDepth?: number, redactInsteadOfDelete?: boolean, formulaPrefix?: boolean}} [opts]
   *        - maxDepth: anti-cycle (default 12)
   *        - redactInsteadOfDelete: вместо delete ставить '***' (default false — delete,
   *          совместимость с CSV._scrubSecrets)
   *        - formulaPrefix: применить scrubFormulaPrefix к строкам (для CSV-export pipeline)
   * @returns {*}
   */
  function scrubObject(obj, opts) {
    const maxDepth = (opts && typeof opts.maxDepth === 'number') ? opts.maxDepth : 12;
    const redact = !!(opts && opts.redactInsteadOfDelete);
    const formulaPrefix = !!(opts && opts.formulaPrefix);
    function _walk(v, depth) {
      if (depth > maxDepth) return redact ? '[max-depth]' : null;
      if (v == null) return v;
      if (typeof v === 'string') {
        return formulaPrefix ? scrubFormulaPrefix(v) : v;
      }
      if (typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.map(x => _walk(x, depth + 1));
      const out = {};
      const keys = Object.keys(v);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (isSecretFieldName(k)) {
          if (redact) out[k] = '***';
          // else: skip (delete-style — совместимо с CSV._scrubSecrets).
          continue;
        }
        out[k] = _walk(v[k], depth + 1);
      }
      return out;
    }
    return _walk(obj, 0);
  }

  /**
   * Scrub HTTP headers — удаляет Authorization, Cookie etc. Принимает
   * plain object либо Map либо Headers (но мы не делаем instanceof check
   * чтобы не зависеть от browser-only Headers API на сервере).
   *
   * @param {*} headers — object либо array of [key, value]
   * @returns {object} новый object без secret-headers (значения '***' если
   *                  было что-то), либо пустой object для invalid input.
   */
  function scrubHeaders(headers) {
    if (!headers) return {};
    const entries = (typeof headers.entries === 'function')
      ? Array.from(headers.entries())
      : (Array.isArray(headers) ? headers : Object.entries(headers));
    const out = {};
    for (const [k, v] of entries) {
      const lower = String(k || '').toLowerCase();
      if (SECRET_HEADER_NAMES.includes(lower)) {
        out[k] = '***';
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  /**
   * CSV formula-injection guard. Префиксует ZWSP перед `= + - @ \t \r`.
   * Зеркало `escape()` из exportSelectedCSV (dataStore.js:1332) без quote-wrap
   * (caller сам wrap'ит в double-quotes).
   *
   * @param {*} value
   * @returns {string}
   */
  function scrubFormulaPrefix(value) {
    const s = String(value == null ? '' : value);
    if (s && FORMULA_PREFIX_RE.test(s)) return ZWSP + s;
    return s;
  }

  return {
    SECRET_FIELD_NAMES,
    SECRET_HEADER_NAMES,
    isSecretFieldName,
    scrubObject,
    scrubHeaders,
    scrubFormulaPrefix,
  };
})();

// Dual UMD: Node CommonJS + browser global.
if (typeof module !== 'undefined' && module.exports) module.exports = Secrets;
if (typeof window !== 'undefined') window.Secrets = Secrets;
