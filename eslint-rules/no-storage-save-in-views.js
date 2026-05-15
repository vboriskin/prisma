'use strict';
/**
 * Custom ESLint rule — no-storage-save-in-views (AUDIT_ARCHITECTURE #2).
 *
 * STATUS: declarative shell. Not yet wired into eslint.config.js.
 *
 * RATIONALE
 * ---------
 * Reactive (reactiveStore.js) auto-flushes on any state mutation —
 * Storage.save() is invoked by the centralized subscriber in app.js.
 * View-layer code calling `Storage.save()` directly is a code-smell:
 *   1. Doubles save calls (one from the manual call, one from Reactive).
 *   2. Hides "I am mutating state" intent — when you save, you imply you
 *      mutated, and that mutation should be visible in the call graph.
 *   3. Breaks the contract that views are pure renderers.
 *
 * RULE
 * ----
 * Forbid `Storage.save(...)` and `dataStore.save(...)` call expressions
 * in any file under `views/`. The fix is to mutate state directly and
 * rely on Reactive's debounced flush.
 *
 * EXCEPTIONS
 * ----------
 * `Storage.flushNow()` (synchronous flush) is allowed — it's intentional
 * (e.g. before navigation away). The rule only flags `.save()`.
 *
 * USAGE (when ready to enable)
 * ----------------------------
 *   const noStorageSaveInViews = require('./eslint-rules/no-storage-save-in-views.js');
 *   // ...
 *   plugins: { local: { rules: { 'no-storage-save-in-views': noStorageSaveInViews } } },
 *   files: ['views/**'],
 *   rules: { 'local/no-storage-save-in-views': 'error' },
 */

module.exports = {
  meta: {
    type:     'problem',
    docs: {
      description:
        'Forbid Storage.save() / dataStore.save() in views/* — rely on Reactive auto-flush instead.',
    },
    schema:   [],
    messages: {
      forbidden:
        'Do not call {{name}} in views/. Mutate state directly and let Reactive flush. ' +
        'AUDIT_ARCHITECTURE #2.',
    },
  },

  create(context) {
    const filename = context.getFilename ? context.getFilename() : (context.filename || '');
    if (!/[\\/]views[\\/]/.test(filename)) {
      return {};
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression') return;
        if (callee.property && callee.property.name === 'save') {
          const obj = callee.object;
          const objName =
            obj && obj.type === 'Identifier'
              ? obj.name
              : null;
          if (objName === 'Storage' || objName === 'dataStore' || objName === 'DataStore') {
            context.report({
              node,
              messageId: 'forbidden',
              data: { name: `${objName}.save()` },
            });
          }
        }
      },
    };
  },
};
