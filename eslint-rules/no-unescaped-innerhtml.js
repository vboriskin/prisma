'use strict';
/**
 * ESLint rule: no-unescaped-innerhtml
 * --
 * Flags `el.innerHTML = ...` where the right-hand side is a template literal
 * containing at least one interpolation (`${expr}`) that ISN'T already wrapped
 * in a known-safe escaper.
 *
 * Recognised escapers (heuristic):
 *   - esc(...)
 *   - escTop(...) / escTrunc(...) / escAttr(...)
 *   - Utils.escapeHtml(...)
 *   - safeUrl(...)        — also fine for href-like contexts
 *   - any call to *.escapeHtml(...)
 *
 * Plain string literals (`el.innerHTML = '<div>...</div>'`) are allowed —
 * those have no user data.
 *
 * Explicit override: prepend a comment `// eslint-disable-next-line no-unescaped-innerhtml`
 * to the offending line. Use it sparingly and document WHY the input is safe.
 */

const SAFE_NAMES = new Set([
  'esc', 'escTop', 'escTrunc', 'escAttr', 'escapeHtml', 'safeUrl',
]);

// Renderer helpers in views/renderHelpers.js — they internally escape user data
// (audit #1 hardened). Treat their return values as safe HTML.
const SAFE_RENDERERS = new Set([
  'scopeChip', 'workTypeChips', 'riskBadges', 'releaseChips',
  'dirtyBadge', 'doneBadge', 'jiraTagsHtml',
  // Portfolio-Pulse internal renderers (also escape-aware)
  'renderIssueRow', 'renderGroupedByType', 'renderTypeGroup',
  'renderDonut', 'renderBars', 'renderAgeHistogram',
]);

function isSafeCallExpression(node) {
  if (!node) return false;
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  // Direct: esc(x) / escapeHtml(x) / safeUrl(x)
  if (callee.type === 'Identifier' && SAFE_NAMES.has(callee.name)) return true;
  if (callee.type === 'Identifier' && SAFE_RENDERERS.has(callee.name)) return true;
  // Member: Utils.escapeHtml(x), foo.escapeHtml(x), x.escapeHtml(x), RH.scopeChip(x)
  if (callee.type === 'MemberExpression') {
    const prop = callee.property;
    if (prop && prop.name && SAFE_NAMES.has(prop.name)) return true;
    if (prop && prop.name && SAFE_RENDERERS.has(prop.name)) return true;
    if (prop && prop.name === 'escapeHtml') return true;
  }
  return false;
}

// Member-expression suffixes we trust as numeric.
const NUMERIC_PROPS = new Set(['length', 'size', 'count', 'index', 'idx']);

/** True if the expression always produces a number/boolean (safe for HTML). */
function isNumericOrBool(node) {
  if (!node) return false;
  if (node.type === 'Literal' && (typeof node.value === 'number' || typeof node.value === 'boolean')) return true;
  if (node.type === 'BinaryExpression' && ['+','-','*','/','%','**'].includes(node.operator)) {
    return isNumericOrBool(node.left) && isNumericOrBool(node.right);
  }
  if (node.type === 'UnaryExpression' && (node.operator === '-' || node.operator === '+' || node.operator === '!')) {
    return isNumericOrBool(node.argument);
  }
  // x.length / x.size / x.count etc. — always integer.
  if (node.type === 'MemberExpression' && node.property && NUMERIC_PROPS.has(node.property.name)) return true;
  // Math.* / Number.* / parseInt() / Number() calls — numeric.
  if (node.type === 'CallExpression') {
    const c = node.callee;
    if (c.type === 'Identifier' && ['parseInt', 'parseFloat', 'Number', 'Math'].includes(c.name)) return true;
    if (c.type === 'MemberExpression' && c.object && c.object.name === 'Math') return true;
    if (c.type === 'MemberExpression' && c.property
        && ['toFixed','toString'].includes(c.property.name)
        && isNumericOrBool(c.object)) return true;
  }
  return false;
}

// Identifier names that, by convention, hold pre-escaped HTML strings.
// Anything matching these patterns is trusted at usage sites — the producer
// is expected to escape internally.
function isSafeIdentifierName(name) {
  if (!name) return false;
  if (/(^|[a-z])(Html|HTML|Markup)$/.test(name)) return true;
  return false;
}

// Identifier names that, by codebase convention, always hold numeric values.
// Used to suppress false positives in `<div>${count}</div>` scenarios where the
// rule has no scope-tracking. Add new entries when you introduce a new counter.
const NUMERIC_NAME_HINTS = new Set([
  // common counters / sums
  'count', 'total', 'done', 'doneCount', 'sum', 'len', 'length', 'size',
  'progress', 'pct', 'percent', 'percentage',
  'idx', 'i', 'j', 'n', 'k',
  // domain counters used across views
  'blockers', 'risky', 'inScope', 'noRelease', 'overtime', 'ot',
  'noAssignee', 'doneNoDate', 'onTimeDone', 'lateDone', 'slaPct',
  'loadConcentration', 'evenness', 'riskLoad', 'blockerLoad',
  'totalIssues', 'wip', 'notStarted', 'unassigned', 'bugs',
  'commits48h', 'pr48h', 'conf48h',
]);
function isNumericIdentifier(name) { return NUMERIC_NAME_HINTS.has(name); }

/** Returns the inner template literal of a `.map(fn).join(...)` chain, if any.
 *  Used to recurse into array-builder patterns and verify their pieces are safe. */
function unwrapMapJoin(node) {
  // Pattern: <chain>.join(<sep>)
  if (node && node.type === 'CallExpression'
      && node.callee && node.callee.type === 'MemberExpression'
      && node.callee.property && node.callee.property.name === 'join') {
    return unwrapMapJoin(node.callee.object);
  }
  // Pattern: <chain>.map(fn) | <chain>.flatMap(fn)
  if (node && node.type === 'CallExpression'
      && node.callee && node.callee.type === 'MemberExpression'
      && node.callee.property
      && (node.callee.property.name === 'map' || node.callee.property.name === 'flatMap')) {
    return node.arguments[0];   // the callback fn
  }
  return null;
}

/** Walk down ternary / logical / parenthesised exprs to find the template literals. */
function collectTemplates(node, out) {
  if (!node) return;
  if (node.type === 'TemplateLiteral') { out.push(node); return; }
  if (node.type === 'ConditionalExpression') {
    collectTemplates(node.consequent, out); collectTemplates(node.alternate, out); return;
  }
  if (node.type === 'LogicalExpression') {
    collectTemplates(node.left, out); collectTemplates(node.right, out); return;
  }
}

function isCallbackSafe(cb) {
  if (!cb) return false;
  if (cb.type !== 'ArrowFunctionExpression' && cb.type !== 'FunctionExpression') return false;
  // Arrow with concise body returning a template literal directly:  r => `…`
  let body = cb.body;
  if (body.type === 'BlockStatement') {
    // Look for the (single) return statement.
    const rets = body.body.filter(s => s.type === 'ReturnStatement');
    if (rets.length !== 1) return false;
    body = rets[0].argument;
  }
  // Body may be a template literal (or a chain of them in ternary).
  const tpls = [];
  collectTemplates(body, tpls);
  if (!tpls.length) return false;
  // Every interpolation in every template must itself be safe (recursive check).
  return tpls.every(tpl => tpl.expressions.every(isObviouslySafe));
}

/** True if the expression is "obviously safe" (numeric, boolean, ternary of safe, etc.). */
function isObviouslySafe(node) {
  if (!node) return false;
  if (isSafeCallExpression(node)) return true;
  if (isNumericOrBool(node)) return true;
  // Convention: identifiers whose name ends with Html/HTML/Markup are trusted
  // to hold pre-escaped strings at the producer side.
  if (node.type === 'Identifier' && isSafeIdentifierName(node.name)) return true;
  if (node.type === 'MemberExpression' && node.property && isSafeIdentifierName(node.property.name)) return true;
  // Convention: identifier names like `count`, `progress`, `blockers` always
  // hold numeric values in this codebase.
  if (node.type === 'Identifier' && isNumericIdentifier(node.name)) return true;
  if (node.type === 'ConditionalExpression') {
    return isObviouslySafe(node.consequent) && isObviouslySafe(node.alternate);
  }
  if (node.type === 'LogicalExpression' && (node.operator === '||' || node.operator === '??' || node.operator === '&&')) {
    return isObviouslySafe(node.left) && isObviouslySafe(node.right);
  }
  // Whitelisted array-builder pattern: arr.map(r => `<safe>`).join('')
  // (also .filter(...).map(...).join(...), nested .slice/.sort permitted via .map identity).
  const cb = unwrapMapJoin(node);
  if (cb && isCallbackSafe(cb)) return true;
  // Tagged template / direct template returning string: `${safe}…${safe}`
  if (node.type === 'TemplateLiteral') {
    return node.expressions.every(isObviouslySafe);
  }
  return false;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid unescaped interpolation in innerHTML assignments — the audit-#1 XSS surface.',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      unescaped: 'innerHTML interpolation must be wrapped in esc() / Utils.escapeHtml() / safeUrl(). Audit #1: stored XSS via XLSX import.',
    },
    schema: [],
  },
  create(context) {
    return {
      AssignmentExpression(node) {
        // Catch:  *.innerHTML = `…${expr}…`
        if (node.operator !== '=') return;
        const left = node.left;
        if (left.type !== 'MemberExpression') return;
        if (!left.property || left.property.name !== 'innerHTML') return;

        const right = node.right;
        if (right.type !== 'TemplateLiteral') return;

        for (const expr of right.expressions) {
          if (!isObviouslySafe(expr)) {
            context.report({ node: expr, messageId: 'unescaped' });
          }
        }
      },
    };
  },
};
