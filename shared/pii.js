'use strict';
/* ============================================================
   shared/pii.js — V22 holistic-P4 (AUDIT_HOLISTIC.md §1 #12 / §7 P4)
   --
   Единый PII-scrubber для текста, попадающего в LLM payload, telemetry,
   server logs, error toasts. Сейчас в проекте 3 параллельные реализации:

     · client  — `Utils.scrubPiiInText` (utils.js)
     · client  — `scrubChatSecrets`     (app/llmAssistant.js, secrets-only)
     · server  — `redactSecretsInText`  (server/integrations/authHelpers.js,
                                         secrets-only — без email/phones/СНИЛС)

   Этот модуль — single source of truth. Pattern: dual UMD IIFE — работает
   в браузере (window.PII) и в Node (module.exports) без бандлера.

   API:
     PII.scrubString(text, maxLen?)   → string
        Маскирует email/phone/СНИЛС/паспорт + secrets (Bearer, Authorization,
        token=, secret=, password=, apiKey=, authKey=). Truncates до maxLen.

     PII.scrubObject(obj, opts?)      → object
        Recursive: scrubString для строк, обход массивов/объектов.
        opts: { maxLen?: number, maxDepth?: number }

     PII.isLikelyPii(text)            → boolean
        Эвристика — содержит ли строка PII (email/phone/СНИЛС/паспорт).
        Для heuristics в логировании / debug-warnings.

     PII.maskEmail(email)             → string
        ivanov@sber.ru → i*****@sber.ru. Для diagnostic exports
        где домен полезен, а локальная часть — нет.

   Контракт совместимости:
     · Включает все паттерны старых функций — это drop-in replacement.
     · `scrubString` ⊇ `Utils.redactSecretsInText` ∪ `Utils.scrubPiiInText`
     · `Utils.scrubPiiInText` остаётся как thin wrapper для backward-compat
       (см. phase-2 миграцию ниже).

   TODO(holistic-P4 phase-2): мигрировать 30+ callsites
     · Utils.scrubPiiInText        (~5 callsites — app/llmAssistant.js)
     · Utils.redactSecretsInText   (~8 callsites — integrations/*)
     · server redactSecretsInText  (~10 callsites — server.js, server/*)
     · scrubChatSecrets            (~4 callsites — app/llmAssistant.js)
     на этот модуль. Полный grep-list в audit-2026-* / holistic-P4-callsites.md.
   ============================================================ */

const PII = (function () {
  // ── Regex bank ──────────────────────────────────────────────
  // Каждый паттерн с пояснением — будут эволюционировать,
  // важно понимать ЗАЧЕМ они в этом виде.

  // Email: стандартный inet-address pattern. Без unicode-домен'ов
  // (cyrillic TLD редкий, добавим если нужно).
  const RE_EMAIL = /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

  // СНИЛС: «123-456-789 12» (3-3-3 + 2 контрольные).
  // Word-boundaries чтобы не поймать «1234-5678-90 12» внутри trace.
  const RE_SNILS = /\b\d{3}-\d{3}-\d{3}\s?\d{2}\b/g;

  // Паспорт РФ: 4 цифры + 6 цифр (с пробелом, дефисом или без).
  const RE_PASSPORT = /\b\d{4}\s?\d{6}\b/g;

  // Phone: +7/8/+XX-formatted, минимум 10 цифр всего.
  // Опасно: pattern может зацепить serial numbers / IDs. Применяем после
  // СНИЛС/паспорт чтобы не съесть их.
  const RE_PHONE = /(?:\+?\d{1,3}[\s\-]?)?\(?\d{3,4}\)?[\s\-]?\d{2,3}[\s\-]?\d{2}[\s\-]?\d{2}/g;

  // ── Secrets bank (зеркало shared/secrets.js — оба модуля стрипают
  //    эти паттерны из текстовых полей; PII делает это потому что
  //    был echo-leak от LLM proxy с Bearer token в response body).
  const RE_BEARER = /Bearer\s+[A-Za-z0-9\-_=.]+/gi;
  const RE_AUTH_HDR = /(Authorization|X-API-Key)\s*[:=]\s*[^\s,;]+/gi;
  const RE_GENERIC_SECRET = /(token|secret|password|apiKey|authKey)\s*[:=]\s*[^\s,;"]+/gi;
  // Sber Jira identity-leak (QD16) — userKey/accountId/sessionId echo'ed.
  const RE_INTERNAL_ID = /(userKey|accountId|username|userName|sessionId|cookieId|JSESSIONID)\s*[:=]\s*[^\s,;"&]+/gi;
  // JWT triple-segment.
  const RE_JWT = /eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g;

  /**
   * Scrub PII + secrets из строки. Truncates до maxLen.
   * Order matters: secrets first (могут содержать `:` который ломает phone-regex),
   * потом structured-PII (СНИЛС/паспорт), последним — phone (greedy).
   * @param {*} text — anything stringifiable
   * @param {number} [maxLen=200]
   * @returns {string}
   */
  function scrubString(text, maxLen = 200) {
    let s = String(text == null ? '' : text);
    if (typeof maxLen === 'number' && maxLen > 0) s = s.slice(0, maxLen);
    return s
      // Secrets first — иначе `Authorization: Bearer eyJ...` → email/phone могут
      // случайно зацепить кусок токена.
      .replace(RE_BEARER, 'Bearer ***')
      .replace(RE_AUTH_HDR, '$1: ***')
      .replace(RE_GENERIC_SECRET, '$1: ***')
      .replace(RE_INTERNAL_ID, '$1: ***')
      .replace(RE_JWT, '***JWT***')
      // PII paterns.
      .replace(RE_EMAIL, '[email]')
      .replace(RE_SNILS, '[snils]')
      .replace(RE_PASSPORT, '[passport]')
      .replace(RE_PHONE, '[phone]');
  }

  /**
   * Recursive scrub object — strings прогоняются через scrubString,
   * arrays/objects обходятся, primitives (number/bool/null) проходят насквозь.
   * Защита от cycle-graphs через maxDepth (default 8).
   * @param {*} obj
   * @param {{maxLen?: number, maxDepth?: number}} [opts]
   * @returns {*}
   */
  function scrubObject(obj, opts) {
    const maxLen = (opts && typeof opts.maxLen === 'number') ? opts.maxLen : 500;
    const maxDepth = (opts && typeof opts.maxDepth === 'number') ? opts.maxDepth : 8;
    function _walk(v, depth) {
      if (depth > maxDepth) return '[max-depth]';
      if (v == null) return v;
      if (typeof v === 'string') return scrubString(v, maxLen);
      if (typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.map(x => _walk(x, depth + 1));
      const out = {};
      for (const k of Object.keys(v)) out[k] = _walk(v[k], depth + 1);
      return out;
    }
    return _walk(obj, 0);
  }

  /**
   * Эвристика — содержит ли строка PII. Не использует scrub чтобы избежать
   * двойной работы; одна regex-проверка на каждый pattern.
   * @param {*} text
   * @returns {boolean}
   */
  function isLikelyPii(text) {
    const s = String(text == null ? '' : text);
    if (!s) return false;
    // Re-create non-global versions для test() (global state issues).
    return /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(s)
      || /\b\d{3}-\d{3}-\d{3}\s?\d{2}\b/.test(s)
      || /\b\d{4}\s?\d{6}\b/.test(s)
      || /(?:\+?\d{1,3}[\s\-]?)?\(?\d{3,4}\)?[\s\-]?\d{2,3}[\s\-]?\d{2}[\s\-]?\d{2}/.test(s);
  }

  /**
   * Mask email сохраняя домен. Совместим с Utils.maskEmail (utils.js V20 S2).
   *   ivanov.ii@sber.ru → i******@sber.ru
   *   x@a.b             → x@a.b   (1-symbol local — не маскируем)
   *   bad-input         → ***
   * @param {*} email
   * @returns {string}
   */
  function maskEmail(email) {
    if (!email || typeof email !== 'string') return '';
    const at = email.indexOf('@');
    if (at < 1 || at === email.length - 1) return '***';
    const local = email.slice(0, at);
    const domain = email.slice(at);
    if (local.length <= 1) return email;
    return local[0] + '*'.repeat(Math.max(1, local.length - 1)) + domain;
  }

  return { scrubString, scrubObject, isLikelyPii, maskEmail };
})();

// Dual UMD: Node CommonJS + browser global.
if (typeof module !== 'undefined' && module.exports) module.exports = PII;
if (typeof window !== 'undefined') window.PII = PII;
