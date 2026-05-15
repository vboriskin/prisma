'use strict';
/* ============================================================
   RENDER HELPERS — v11_0 ES module
   --
   SECURITY: all user-controlled input is HTML-escaped automatically
   via the `html` tagged template (libs/safeHtml.js). XLSX/CSV imports
   may carry `<script>` or `"` in any text field — the template's
   default escape is the audit-#1 XSS defence.

   Each helper returns a SafeHtml object. Callers can either:
     · use it inside another `html\`\`` template (composes naturally), or
     · interpolate via legacy string-template — `.toString()` coercion gives
       back the HTML string with all data already escaped.

   Class names are whitelist-driven (not user input) so they're literals.
   URL schemes are validated via `safeUrl` to block `javascript:` /
   `data:` injections through user-pasted Jira links.
   ============================================================ */

import { Utils } from '../utils.js';
import { RISK_FLAGS, WT_CLS } from '../constants.js';
import { html, unsafe } from '../libs/safeHtml.js';

// Whitelist URL schemes for jira-tag links — never let a user-supplied URL
// inject `javascript:` or `data:` payloads.
const safeUrl = (u) => {
  const s = String(u || '').trim();
  return /^(https?:|mailto:)/i.test(s) ? s : '';
};

export const RH = {
  scopeChip(s) {
    if (!s) return html`<span class="chip chip-gray">—</span>`;
    const m = { 'Да': 'chip chip-green', 'Нет': 'chip chip-gray', 'Требует подтверждения': 'chip chip-yellow' };
    const cls   = m[s] || 'chip chip-gray';     // class is whitelist-driven, not user input → safe in attribute
    const label = s === 'Требует подтверждения' ? 'Треб.' : s;
    return html`<span class="${unsafe(cls)}">${label}</span>`;
  },
  workTypeChips(types) {
    if (!types || !types.length) return html`<span class="text-muted text-sm">—</span>`;
    return html`${types.map(t => html`<span class="wt-tag ${unsafe(WT_CLS[t] || 'wt-other')}">${t}</span>`)}`;
  },
  riskBadges(flags) {
    if (!flags || !flags.length) return html``;
    return html`${flags.map(f => {
      const cls = f === 'BLOCKING_NEAR_RELEASE' ? 'risk-badge risk-badge-danger' : 'risk-badge';
      const title = RISK_FLAGS[f] || f;
      return html`<span class="${unsafe(cls)}" title="${title}"><span class="signal-dot signal-drift" role="img" aria-label="Внимание"></span></span>`;
    })}`;
  },
  dirtyBadge(d) { return d ? html`<span class="chip chip-dirty">${unsafe('<span class="prizma-icon" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></span>')}</span>` : html``; },
  doneBadge(d)  { return d ? html`<span class="chip chip-done"><span class="signal-dot signal-on-course" role="img" aria-label="Сделано"></span></span>`  : html``; },
  jiraTagsHtml(raw) {
    const links = Utils.parseJiraLinks(raw);
    if (!links.length) {
      return html`<span class="tasks-cell-raw">${Utils.truncate(raw, 40)}</span>`;
    }
    return html`${links.map(l => {
      const href = safeUrl(l.url);
      if (href) {
        // E6 fix (codebase-03 audit §12 no-emoji) — `🔗` убран; используется
        // CSS-decorator (`.jira-tag::before`) или просто текстовый key.
        return html`<a class="jira-tag" href="${href}" target="_blank" rel="noopener" title="${href}">${l.key}</a>`;
      }
      return html`<span class="jira-tag" title="${l.key}">${l.key}</span>`;
    })}`;
  },
  releaseChips(row) {
    const chips = [];
    if (row.hasRelease120) chips.push(html`<span class="chip chip-indigo">1.20</span>`);
    if (row.hasRelease121) chips.push(html`<span class="chip chip-green">1.21</span>`);
    if (row.hasRelease122) chips.push(html`<span class="chip chip-yellow">1.22</span>`);
    if (row.hasOvertime)   chips.push(html`<span class="chip chip-red">OT</span>`);
    return chips.length ? html`${chips}` : html`<span class="chip chip-gray">—</span>`;
  },
};
