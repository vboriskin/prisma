# ADR — no-direct-pulse-import (AUDIT_ARCHITECTURE #14)

## Status

PENDING — `pulse/index.js` facade does not yet exist. This file documents
the intended ESLint policy so that when the facade is introduced, the rule
can be enforced mechanically.

## Context

`integrations/portfolioPulse*.js` (model, renderer, metrics, …) is a
multi-file subsystem. Outside the `integrations/` boundary, any import
of `from '../integrations/portfolioPulse...js'` couples the caller to
internal Pulse layout. Refactoring Pulse internals (splitting/merging
files) becomes a breaking change for unrelated callers.

## Decision

Once `pulse/index.js` is created as a public facade, all callers OUTSIDE
`integrations/` MUST import from the facade only. ESLint flat-config rule:

```js
{
  files: ['**/*.js'],
  ignores: ['integrations/**', 'pulse/index.js'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        {
          group: ['**/integrations/portfolioPulse*', '**/portfolioPulse*'],
          message:
            'Import Pulse exports through the facade: ' +
            "from '../pulse/index.js' (or './pulse/index.js'). " +
            'AUDIT_ARCHITECTURE #14.'
        }
      ]
    }]
  }
}
```

## TODO

1. Create `pulse/index.js` facade re-exporting:
   - `mountPulse`, `renderPortfolioPulse` from `portfolioPulseRenderer.js`
   - `loadPulseSnapshot`, `savePulseSnapshot` from `portfolioPulseModel.js`
   - any other public symbol consumed by `views/integrationsView.js` /
     `app/llmAssistant.js`.
2. Migrate existing callsites incrementally to import from the facade.
3. Add the ESLint rule above to `eslint.config.js`.
4. Promote from warning to error after first clean PR.

## Why not enforce now

Adding the rule before the facade exists would either (a) break the build
or (b) require an empty allowlist that produces no signal. Better to flag
the work and defer until the facade lands.
