'use strict';
/* ============================================================
   METRICS DEEP — shared helpers (V21 audit cluster)

   `esc` — HTML-escape для tooltip-formatter callback'ов. ECharts
   `formatter`-callback'и возвращают строки, вставляемые как innerHTML.
   Если в данных есть `<script>` или `&lt;` (Jira-import может протащить
   что угодно), без escape — XSS. Брендбук CLAUDE.md §security:
   «HTML вставка в DOM — только через escapeHtml».
   ============================================================ */

const _MAP = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&#39;',
};

export function esc(value) {
  if (value == null) return '';
  return String(value).replace(/[<>&"']/g, c => _MAP[c]);
}

/** Sanitize seed для детерминированного «random» (V21 audit R6).
 *  Возвращает функцию, которая на одних и тех же аргументах даёт одинаковый
 *  результат — чарты не будут дёргаться при повторном mount.
 *  Mulberry32 — компактный хэш-PRNG, достаточный для визуальных синтетик. */
export function seededRandom(seed) {
  let a = seed | 0;
  return function() {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
