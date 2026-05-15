# ESLint rule — `no-direct-window-service`

> AUDIT_TECH кр.13 — ADR для запрета `window.X` access после полной миграции на Services registry.
>
> **Сейчас не активирован** — backward-compat fase. Планируется активация в Phase 6 (см. `docs/window-globals-migration.md`).

## Что должно проверяться

Запретить:

```js
// ❌ Новые consumer'ы
window.HistoryManager?.checkpoint(...);
window.RegistryView.render();
window.LLMAssistant?.openChat();
```

Разрешить:

```js
// ✓ ES direct import
import { HistoryManager } from '../app/historyManager.js';
HistoryManager.checkpoint(...);

// ✓ Services registry
import { Services } from '../app/services.js';
Services.HistoryManager?.checkpoint(...);

// ✓ Browser APIs (исключения)
window.addEventListener(...);
window.fetch(...);
window.confirm(...);

// ✓ Регистрация (только в module-владельце)
window.HistoryManager = HistoryManager;  // в app/historyManager.js
```

## Implementation skeleton

```js
// eslint-rules/no-direct-window-service.js
'use strict';

const SERVICE_NAMES = new Set([
  'App', 'AppSettings', 'HistoryManager', 'Onboarding', 'ActionLayer',
  'RegistryView', 'BulkEditPanel', 'LLMAssistant', 'Nav', 'PortfolioPulse',
  'ConfirmDialog', 'FocusTrap', 'ToastQueue', 'Icons', 'NotifyCenter',
  'PromptsEditor', 'Permissions', 'Flags', 'Reactive', 'Migrations',
  'EventBus', 'Services',
  // ... другие из docs/window-globals-migration.md секция «Services / Singletons»
]);

const BROWSER_APIS = new Set([
  'addEventListener', 'removeEventListener', 'fetch', 'confirm',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback',
  'matchMedia', 'getComputedStyle', 'innerWidth', 'innerHeight',
  'location', 'history', 'document', 'navigator', 'localStorage',
  'sessionStorage', 'crypto', 'performance', 'console',
  'onerror', 'onload', 'onbeforeunload',
]);

module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'forbid direct window.X access for service-globals' },
    messages: {
      useImport: "Don't access `window.{{name}}` directly. Use ES import `import {{ {{name}} }} from '...'` or `Services.{{name}}` from app/services.js. See docs/window-globals-migration.md.",
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (node.object?.type !== 'Identifier' || node.object.name !== 'window') return;
        if (node.property?.type !== 'Identifier') return;
        const name = node.property.name;
        if (BROWSER_APIS.has(name)) return;
        if (!SERVICE_NAMES.has(name)) return;
        // Allow assignment (registration) — это паттерн владельца модуля.
        if (node.parent?.type === 'AssignmentExpression' && node.parent.left === node) return;
        context.report({ node, messageId: 'useImport', data: { name } });
      },
    };
  },
};
```

## Активация (Phase 6 в migration roadmap)

```js
// eslint.config.js
import noDirectWindowService from './eslint-rules/no-direct-window-service.js';

export default [
  {
    rules: {
      'local/no-direct-window-service': ['error'],
    },
    plugins: {
      local: { rules: { 'no-direct-window-service': noDirectWindowService } },
    },
  },
];
```

## Когда активировать

✅ **После выполнения**:
1. Все 51 services зарегистрированы в Services (Phase 2-3 в migration guide)
2. Все callsite'ы мигрированы на ES import / `Services.X` (Phase 5)
3. Прогон ESLint в warning-mode даёт 0 hits

❌ **НЕ активировать пока**:
- Активны legacy `window.X` callsite'ы (будет breaking change)
- Не все services зарегистрированы (rule пропустит unregistered)
- Нет миграционного PR в работе
