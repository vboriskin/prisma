'use strict';
/* ============================================================
   server/integrations/authHelpers.js — V18.1 P10 (extracted from server.js)

   Pure helpers — no I/O, no fs, no http. Used by every integration
   endpoint and by Pulse aggregators.

   Public:
     makeAuthHeader(token)        → 'Bearer …' | 'Basic …' | ''
     keyForAuthor(name, email)    → lowercased identity key
     redactSecretsInText(text, maxLen=200)
                                  → safe-for-log/UI string
                                    (regex removes Bearer/Authorization/
                                    token/secret/password/apiKey/authKey)

   Mirrors the frontend `Utils.redactSecretsInText` (utils.js, V18 P6) so
   server-side and client-side error sanitisation use the same canonical
   regex set. If you change one, change the other.
   ============================================================ */

function makeAuthHeader(token) {
  if (!token) return '';
  return token.includes(':')
    ? 'Basic ' + Buffer.from(token).toString('base64')
    : 'Bearer ' + token;
}

function keyForAuthor(name, email) {
  return String(name || email || '').trim().toLowerCase();
}

function redactSecretsInText(text, maxLen = 200) {
  return String(text == null ? '' : text).slice(0, maxLen)
    .replace(/Bearer\s+[A-Za-z0-9\-_=.]+/gi, 'Bearer ***')
    .replace(/(Authorization|X-API-Key)\s*[:=]\s*[^\s,;]+/gi, '$1: ***')
    .replace(/(token|secret|password|apiKey|authKey)\s*[:=]\s*[^\s,;"]+/gi, '$1: ***');
}

module.exports = { makeAuthHeader, keyForAuthor, redactSecretsInText };
