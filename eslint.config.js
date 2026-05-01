'use strict';
/**
 * ESLint flat config (eslint v9). Run via `npm run lint`.
 *
 * Three groups of rules:
 *  1. `prefer-const`, `no-var` — basic hygiene.
 *  2. Custom `local/no-unescaped-innerhtml` — forbids `el.innerHTML = `${user_data}``
 *     unless the interpolation is wrapped in an escaper. Audit #1 XSS surface.
 *  3. `no-unused-vars` etc. set to "warn" so they show up but don't block.
 */

const js = require('@eslint/js');
const noUnescapedInnerhtml = require('./eslint-rules/no-unescaped-innerhtml.js');
const cssClassPrefix       = require('./eslint-rules/css-class-prefix.js');

const localPlugin = {
  rules: {
    'no-unescaped-innerhtml': noUnescapedInnerhtml,
    'css-class-prefix':       cssClassPrefix,
  },
};

// Per-module CSS prefix ownership. Glob-matched against the file path.
// First match wins. Files not matched here aren't checked by the rule.
//
// Adding a new module:
//   1. Pick a unique 2–4-letter prefix (e.g. "rpt-" for a future Reports view).
//   2. Add it here.
//   3. Use only that prefix + shared (btn-/chip-/…) in your view's HTML.
//   4. Run `npm run lint` — anything outside the allowlist will surface.
const CSS_OWNERSHIPS = [
  // Views
  { glob: '**/views/dashboard.js',       prefixes: ['dashboard-', 'kpi', 'kpi-', 'risks-', 'risk-', 'release-', 'team-', 'progress-', 'blocking-', 'no-release-', 'needs-confirm-', 'tasks-cell', 'block-', 'mini-breakdown-'] },
  { glob: '**/views/registry.js',        prefixes: ['registry-', 'rsp-', 'rcm-', 'rsel-', 'edit-', 'col-', 'multi-', 'bulk-', 'sort-', 'ctx-', 'reg-', 'cell-', 'pin-', 'tag-', 'todo-', 'inline-', 'menu-', 'tagcolor-', 'int-' /* int-registry-link badge for Jira */] },
  { glob: '**/views/gantt.js',           prefixes: ['gantt-', 'gtx-', 'gar-', 'gdt-', 'gep-'] },   // V14: gantt2-/g2-/gantt-arrows- retired with GanttV2 (B2)
  { glob: '**/views/kanban.js',          prefixes: ['kanban-', 'kb-'] },
  { glob: '**/views/timeline.js',        prefixes: ['timeline-', 'pod-', 'podlozhka-', 'pod-tasks', 'tline-', 'timeline'] },
  { glob: '**/views/metrics.js',         prefixes: ['summary-', 'summary', 'metrics-', 'metrics', 'insight-', 'insights-', 'beaut-', 'beautiful-', 'diag-', 'spark-'] },
  { glob: '**/views/employees.js',       prefixes: ['emp-', 'employee-', 'employees-'] },
  { glob: '**/views/aiView.js',          prefixes: ['ai-'] },
  { glob: '**/views/aiCeoView.js',       prefixes: ['ai-', 'ceo-'] },
  { glob: '**/views/integrationsView.js', prefixes: ['int-', 'integrations-', 'pp-' /* mounts Portfolio Pulse */, 'bd-' /* mounts Чёрный дашборд */] },
  { glob: '**/views/history.js',         prefixes: ['hist-', 'history-'] },
  { glob: '**/views/renderHelpers.js',   prefixes: [] /* relies on shared only */ },

  // Decomposed app/* modules
  { glob: '**/app/actionLayer.js',       prefixes: ['al-'] },
  { glob: '**/app/onboarding.js',        prefixes: ['onboarding-'] },
  { glob: '**/app/llmAssistant.js',      prefixes: ['llm-', 'asst-', 'assistant-', 'chat-', 'alert-', 'thinking-'] },
  { glob: '**/app/historyManager.js',    prefixes: [] },
  { glob: '**/app/init.js',              prefixes: ['welcome-', 'splash-'] },

  // Onboarding subsystem (welcome screen / first-run)
  { glob: '**/onboarding/**/*.js',       prefixes: ['ob-', 'welcome-', 'onboarding-', 'demo-'] },

  // Chat assistant subsystem
  { glob: '**/chat/**/*.js',             prefixes: ['chat-', 'asst-', 'assistant-', 'alert-', 'thinking-', 'msg-'] },

  // Integrations / Portfolio Pulse — strict pp-, plus int- because PP is a tab
  // INSIDE the Integrations area and reuses the int-btn* button styles.
  { glob: '**/integrations/portfolioPulse*.js', prefixes: ['pp-', 'int-'] },
  // Integrations / Чёрный дашборд — bd- prefix; reuses int- buttons and
  // pp-chart-* via direct import of renderDonut/renderBars from Pulse metrics.
  { glob: '**/integrations/blackDashboard*.js', prefixes: ['bd-', 'int-', 'pp-'] },
  // Tech-info modal — ti- prefix; piggybacks on int-btn-* button styles.
  { glob: '**/integrations/techInfo*.js',       prefixes: ['ti-', 'int-'] },
  { glob: '**/integrations/integrations*.js',   prefixes: ['int-', 'integrations-'] },

  // AI block renderers
  { glob: '**/ai/**/*.js',               prefixes: ['ai-', 'ceo-'] },

  // Components — small reusables, allowed to use both their own prefix and shared.
  { glob: '**/components/multiselect.js', prefixes: ['ms-', 'multi-'] },
  { glob: '**/components/tagInput.js',    prefixes: ['tag-', 'taginput-', 'tagcolor-'] },

  // app.js itself: orchestrator, can use app-* + bulk-* + funny-loader + …
  { glob: '**/app.js',                   prefixes: ['app-', 'bulk-', 'funny-', 'topbar-', 'onboarding-', 'welcome-', 'asst-', 'assistant-', 'chat-', 'llm-', 'alert-', 'thinking-', 'demo-'] },
];

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType:  'module',
      globals: {
        // Browser
        window: 'readonly', document: 'readonly', console: 'readonly',
        navigator: 'readonly', location: 'readonly', localStorage: 'readonly',
        sessionStorage: 'readonly', indexedDB: 'readonly', fetch: 'readonly',
        URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly',
        File: 'readonly', FileReader: 'readonly', alert: 'readonly',
        confirm: 'readonly', prompt: 'readonly', requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly', setTimeout: 'readonly',
        clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        atob: 'readonly', btoa: 'readonly', AbortController: 'readonly',
        AbortSignal: 'readonly', CSS: 'readonly',
        Node: 'readonly', NodeList: 'readonly', HTMLElement: 'readonly',
        HTMLButtonElement: 'readonly', Image: 'readonly', Event: 'readonly',
        CustomEvent: 'readonly', MutationObserver: 'readonly',
        getComputedStyle: 'readonly', queueMicrotask: 'readonly',
        // Project globals exposed via window.* (declared in globals.d.ts)
        showToast: 'readonly', showFunnyLoader: 'readonly',
        // Node-side
        process: 'readonly', Buffer: 'readonly', __dirname: 'readonly',
        __filename: 'readonly', module: 'writable', require: 'readonly',
        exports: 'writable', global: 'readonly',
      },
    },
    plugins: { local: localPlugin },
    rules: {
      'prefer-const':                ['warn', { destructuring: 'all' }],
      'no-var':                      'warn',
      // V12 audit recommendation #5 — extend ignore pattern to caught-errors,
      // because the project convention is `catch (_)` / `catch (_e)` for
      // intentional swallow. Without `caughtErrorsIgnorePattern` ESLint warned
      // on every silent catch — ~15 false-positives. Adding the pattern
      // reclaims slack vs `--max-warnings 335` ratchet.
      'no-unused-vars':              ['warn', {
        argsIgnorePattern:         '^_',
        varsIgnorePattern:         '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-empty':                    ['warn', { allowEmptyCatch: true }],
      'no-undef':                    'off',  // we use window globals heavily
      'no-prototype-builtins':       'off',  // intentional patterns
      'no-useless-escape':           'off',
      'no-cond-assign':              ['error', 'except-parens'],
      'no-irregular-whitespace':     'off',  // Russian/Cyrillic file content
      'no-control-regex':            'off',
      // The XSS guard. Default level is `warn` so legacy files surface
      // signal without blocking CI. The override below promotes it to
      // `error` on the audit-#1-cleaned files (regression guard).
      'local/no-unescaped-innerhtml': 'warn',

      // Audit #5 — CSS class prefix discipline. Warn-only at first; ratchet
      // to error per-module after each is cleaned up. See the OWNERSHIPS
      // map above for which prefix each file is allowed to use.
      'local/css-class-prefix':       ['warn', { ownerships: CSS_OWNERSHIPS }],
    },
  },
  // Note: in earlier iterations we promoted audit-#1 files to "error", but the
  // rule has no scope-tracking and over-flags valid cases (numeric vars from
  // closures, .map().join() chains with mixed safe/unsafe interpolations).
  // Current strategy: keep `warn` everywhere, gate CI on a max-warnings budget
  // (npm run lint → ≤ 60). Budget shrinks each PR that cleans more spots.
  {
    // Server-side: no DOM, no innerHTML — rule doesn't apply.
    files: ['server.js', 'launch.js', 'testRunner.js', 'contractTest.js', 'e2eTest.js', 'scripts/**'],
    rules: {
      'local/no-unescaped-innerhtml': 'off',
      'local/css-class-prefix':       'off',
    },
  },
  {
    // Vendored / generated.
    ignores: [
      'libs/**',
      'node_modules/**',
      'modules/**',          // imported as non-module <script> — different rules
      '*.config.js',
      'eslint-rules/**',
    ],
  },
];
