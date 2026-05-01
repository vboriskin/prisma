'use strict';
/* ============================================================
   DEPENDENCY ENGINE — v8_0 ES module
   ============================================================ */

import { state } from './state.js';

export function detectCycles(deps) {
  // deps is {targetEpic: sourceEpic, ...}
  const visited = new Set(), inStack = new Set();
  function dfs(node) {
    if (inStack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node); inStack.add(node);
    const dep = deps[node];
    if (dep && dfs(dep)) return true;
    inStack.delete(node);
    return false;
  }
  return Object.keys(deps).some(n => dfs(n));
}

export function getCriticalPath(deps, geometry) {
  // Returns array of epic names in dependency order
  const result = [], visited = new Set();
  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    const dep = deps[name];
    if (dep) visit(dep);
    result.push(name);
  }
  Object.keys(deps).forEach(visit);
  return result;
}
