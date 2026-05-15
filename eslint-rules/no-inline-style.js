'use strict';
/**
 * ESLint rule: no-inline-style
 * --
 * AUDIT_HOLISTIC O10 — Inline `style.X = …` (X ∈ width/height/left/top/right/
 * bottom/color/background/opacity/transform/display) в JS конкурируют с
 * CSS, ломают theme-switch и `prefers-reduced-motion`. Этот файл — STUB
 * (опции / autofix не реализованы), включён в `eslint.config.js` как
 * `"warn"` чтобы не блокировать CI пока легаси не выгребен.
 *
 * Шаблон миграции (см. `docs/spine-pill.md` §8):
 *   ❌ el.style.left = x + 'px';
 *   ✅ el.style.setProperty('--prizma-menu-x', x + 'px');   // + CSS class
 *   ❌ el.style.display = 'none';
 *   ✅ el.classList.add('is-hidden');                       // или [hidden]
 *
 * Допускается inline-style:
 *   - setProperty('--prizma-…', …)              // явный custom-property
 *   - style.cssText = '…' с комментом WHY-not-class (legacy <details>)
 *   - в template-literals для cloned ghost-элементов one-shot animation
 *
 * Explicit override: comment `// eslint-disable-next-line no-inline-style`.
 */

const FORBIDDEN_PROPS = new Set([
  'width', 'height',
  'left', 'top', 'right', 'bottom',
  'color', 'background', 'backgroundColor',
  'opacity', 'transform',
  'display',
  'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
]);

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Forbid `el.style.<dynamic-prop> =` — use CSS custom-properties via setProperty instead.',
    },
    schema: [],
    messages: {
      forbidden:
        'Inline style.{{prop}} = … запрещён (AUDIT_HOLISTIC O10). ' +
        'Замени на el.style.setProperty(\'--prizma-X\', val) + CSS class. ' +
        'См. docs/spine-pill.md §8.',
    },
  },
  create(context) {
    return {
      AssignmentExpression(node) {
        if (node.operator !== '=') return;
        const left = node.left;
        if (!left || left.type !== 'MemberExpression') return;
        // Match `<x>.style.<prop> = …`.
        const obj = left.object;
        if (!obj || obj.type !== 'MemberExpression') return;
        if (!obj.property || obj.property.type !== 'Identifier') return;
        if (obj.property.name !== 'style') return;
        if (!left.property || left.property.type !== 'Identifier') return;
        const prop = left.property.name;
        if (!FORBIDDEN_PROPS.has(prop)) return;
        context.report({
          node: left,
          messageId: 'forbidden',
          data: { prop },
        });
      },
    };
  },
};
