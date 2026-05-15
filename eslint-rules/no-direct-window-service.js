'use strict';
/**
 * Custom ESLint rule — no-direct-window-service (AUDIT_TECH кр.13).
 *
 * Forbid direct `window.<RegisteredService>` access for service-globals
 * that are now exposed via `Services` registry (`app/services.js`).
 *
 * Status: WARN-mode initially (Phase 6 of migration roadmap). After
 * remaining hits drop to 0, promote to ERROR per docs/window-globals-migration.md.
 *
 * ALLOWED patterns
 *   import { X } from '...';                 // ES direct import
 *   import { Services } from '../app/services.js';
 *   Services.X?.foo();                       // registry access
 *   window.X = X;                            // owner-side registration assignment
 *   window.addEventListener(...)             // browser API (whitelisted)
 *
 * FORBIDDEN
 *   window.HistoryManager?.checkpoint(...);  // → Services.HistoryManager?.checkpoint(...)
 *   window.RegistryView.render();            // → Services.RegistryView?.render()
 *
 * NOT FLAGGED
 *   window.<unknownName>                     // not in SERVICE_NAMES
 *   window.<browserAPI>                      // whitelisted in BROWSER_APIS
 *   window.X = ...                           // assignment (owner pattern)
 *   typeof window.X / 'X' in window          // existence checks (different semantics)
 */

// Service names that are registered via Services.register() — keep in sync
// with `Services.register(...)` callsites + docs/window-globals-migration.md.
const SERVICE_NAMES = new Set([
  // Phase 1 pilots
  'Icons', 'ConfirmDialog', 'FocusTrap', 'ToastQueue',
  'createPrismaDialog', 'attachBackdropClose',
  // Phase 2 utility helpers
  'ActionLayer', 'PrizmaAiFrame', 'BulkPlatform', 'ExplainScreen',
  'SlideDeck', 'Flags', 'Focus', 'HistoryManager', 'LLMAssistant',
  'Migrations', 'Nav', 'NotifyCenter', 'ObsidianMascot', 'Onboarding',
  'Permissions', 'PromptsEditor', 'Router', 'Toast', 'AppDataStore',
  'DependencyEngine', 'ErrorsLog', 'Reactive', 'SQLiteStore',
  // Phase 3 views/integrations
  'DependencyGraphView', 'ExecView', 'HistoryView',
  'IntegrationsLoadSettings', 'IntegrationsRenderModal', 'IntegrationsBindModal',
  'SettingsView', 'BlackDashboard', 'PortfolioPulse', 'TeamScanner2',
  'TechInfo', 'AutoSummary',
  // Phase 4 orchestrator
  'App', 'AppSettings', 'ThemeUI', 'RegistryView', 'BulkEditPanel',
]);

// Standard browser/host APIs accessed via `window.X` — never flag.
const BROWSER_APIS = new Set([
  'addEventListener', 'removeEventListener', 'fetch', 'confirm', 'alert', 'prompt',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback',
  'matchMedia', 'getComputedStyle', 'innerWidth', 'innerHeight',
  'outerWidth', 'outerHeight', 'devicePixelRatio',
  'location', 'history', 'document', 'navigator',
  'localStorage', 'sessionStorage', 'crypto', 'performance', 'console',
  'onerror', 'onload', 'onbeforeunload', 'onresize', 'onscroll',
  'scrollTo', 'scroll', 'scrollX', 'scrollY', 'open', 'close',
  'screen', 'frames', 'parent', 'top', 'self', 'opener',
  'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FormData',
  'Headers', 'Request', 'Response', 'WebSocket', 'Worker', 'SharedWorker',
  'Notification', 'IntersectionObserver', 'MutationObserver',
  'ResizeObserver', 'PerformanceObserver', 'AbortController', 'AbortSignal',
  'MessageChannel', 'DOMParser', 'XMLHttpRequest',
  'HTMLElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeList',
  'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'PointerEvent',
  'TouchEvent', 'History', 'Image',
  'Promise', 'Map', 'Set', 'Array', 'Object', 'JSON', 'Math', 'Date',
  'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'URIError', 'ReferenceError', 'EvalError',
  'CSS', 'queueMicrotask', 'atob', 'btoa', 'isSecureContext',
]);

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Forbid direct window.<Service> access for services registered via Services registry. ' +
        'Use ES import or Services.<Name> instead. AUDIT_TECH кр.13.',
    },
    schema: [],
    messages: {
      useImport:
        "Avoid `window.{{name}}` — service is registered in Services. " +
        "Use `import { {{name}} } from '...'` (preferred) or `Services.{{name}}?.…` " +
        "(import { Services } from app/services.js). " +
        "See docs/window-globals-migration.md.",
    },
  },

  create(context) {
    return {
      MemberExpression(node) {
        // Match `window.X`
        if (!node.object || node.object.type !== 'Identifier' || node.object.name !== 'window') return;
        if (!node.property || node.property.type !== 'Identifier') return;

        const name = node.property.name;
        if (BROWSER_APIS.has(name)) return;
        if (!SERVICE_NAMES.has(name)) return;

        // Allow assignment (registration): `window.X = ...` — owner pattern.
        const parent = node.parent;
        if (parent && parent.type === 'AssignmentExpression' && parent.left === node) return;

        // Allow `typeof window.X` — different semantics (existence check).
        if (parent && parent.type === 'UnaryExpression' && parent.operator === 'typeof') return;

        // Allow `delete window.X` (cleanup).
        if (parent && parent.type === 'UnaryExpression' && parent.operator === 'delete') return;

        context.report({
          node,
          messageId: 'useImport',
          data: { name },
        });
      },
    };
  },
};
