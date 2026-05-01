'use strict';
/* ============================================================
   safeHtml.js — tiny lit-html-API-compatible tagged template.
   --
   Drop-in for the common subset of lit-html we actually use:
      import { html, render, unsafe } from '../libs/safeHtml.js';
      el.innerHTML = html`<div>${userInput}</div>`;
      // or:
      render(el, html`<div>${userInput}</div>`);

   Behaviour:
   · Every interpolated value is HTML-escaped by default — `&<>"'` get
     replaced. This is the audit-#1 XSS-defence-by-default.
   · `null` / `undefined` interpolations render as ''.
   · Arrays of (string | SafeHtml | nested template) are joined.
   · Booleans / numbers pass through verbatim (no XSS surface).
   · `unsafe('<b>x</b>')` opts out — for callers who already produced
     trusted HTML (e.g. another `html\`\`` result, or a renderHelper).
   · Nested `html\`\`` results compose: outer escape NOT applied.

   Why a custom shim instead of full lit-html?
   · lit-html (~6 KB gzipped) is built around incremental DOM diffing
     and directives. We always re-render whole sections via innerHTML
     assignment, so 95% of lit-html code is dead weight here.
   · Our shim is ~50 LOC, fully understood, no upstream CVE exposure.
   · The API surface (`html`, `render`, `unsafe`) matches lit-html so
     a future swap to the real thing is `import` change + nothing else.

   Sized at <2 KB raw / <1 KB gzipped. Performance-budget friendly.
   ============================================================ */

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESCAPE_RX  = /[&<>"']/g;

/** @param {unknown} v */
function escape(v) {
  return String(v == null ? '' : v).replace(ESCAPE_RX, (c) => ESCAPE_MAP[c]);
}

/** Marker type — anything wrapped in this is treated as already-safe HTML.
 *  Tag templates and `unsafe()` results are SafeHtml instances. */
class SafeHtml {
  /** @param {string} htmlStr */
  constructor(htmlStr) { this.__html = htmlStr; }
  /** Implicit string coercion (used when assigned to innerHTML). */
  toString() { return this.__html; }
  // Used by inner array joining — same shape as lit-html's `_$litType$` marker
  // but kept simple for our needs.
  get isSafeHtml() { return true; }
}

/** Render one interpolated value into a string segment of HTML. */
function renderValue(v) {
  if (v == null || v === false) return '';
  if (v instanceof SafeHtml)    return v.__html;
  if (Array.isArray(v))         return v.map(renderValue).join('');
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return escape(v);
}

/**
 * Tagged-template html builder. Returns a SafeHtml object whose `.toString()`
 * yields the assembled HTML string. Every `${value}` is HTML-escaped unless
 * the value is itself a SafeHtml (nested template, or `unsafe(...)`).
 *
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {SafeHtml}
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += renderValue(values[i]);
    out += strings[i + 1];
  }
  return new SafeHtml(out);
}

/**
 * Escape hatch for already-trusted HTML strings — e.g. the output of an
 * older renderHelper (RH.scopeChip). Use sparingly. Documented at every
 * call site WHY the input is trusted.
 *
 * @param {string} htmlStr
 * @returns {SafeHtml}
 */
export function unsafe(htmlStr) {
  return new SafeHtml(String(htmlStr == null ? '' : htmlStr));
}

/**
 * Render a SafeHtml (or string) into a DOM target. Same shape as lit-html's
 * `render(target, content)` so future migration is import-only.
 *
 * @param {Element} target
 * @param {SafeHtml|string|null} content
 */
export function render(target, content) {
  if (!target) return;
  target.innerHTML = content instanceof SafeHtml ? content.__html : escape(content);
}

/**
 * Stringify a SafeHtml. Useful for tests + for callers that need a raw string
 * (legacy `el.innerHTML = ...` paths during incremental migration).
 *
 * @param {SafeHtml|string|null} content
 * @returns {string}
 */
export function renderToString(content) {
  return content instanceof SafeHtml ? content.__html : escape(content);
}

// Browser-side global for inline-event-handler use cases (non-module scripts).
// Module imports are the canonical path.
if (typeof window !== 'undefined') {
  window.safeHtml = { html, render, renderToString, unsafe };
}
