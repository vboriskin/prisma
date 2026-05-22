'use strict';
/* ============================================================
   DEPENDENCY ENGINE — v22 (i4, codebase-04 audit)
   --
   Расширен из 35-LOC заглушки до полноценного graph-engine для
   dependency-overlay поверх Ганта.

   Public API:
     · detectCycles(deps)              — true если в графе есть цикл
     · getCriticalPath(deps, weights)  — массив имён эпиков с suggested
                                          порядком (или цепочкой crit-path)
     · buildGraphLayout(deps, rows)    — { nodes, edges, layers, critical }
                                          для Sugiyama-style layered render
     · weighEpic(epicName, rows)       — суммарный вес эпика для ранжирования
                                          (число задач, blocking flag, и т.д.)

   Формат входа `deps`: `{ "Epic A": "Epic B", ... }` где `Epic A`
   зависит от `Epic B` (т.е. B → A, A не может стартовать пока B не готов).
   ============================================================ */

import { state } from './state.js';
import { Services } from './app/services.js';

/* ── Cycle detection ──────────────────────────────────────── */
/** #11 — multi-deps adapter: epicDeps[from] может быть string ИЛИ Array<to>.
 *  Возвращает массив pairs `[[from, to], ...]` для итерации. */
function _depsPairs(deps) {
  const pairs = [];
  for (const [a, v] of Object.entries(deps || {})) {
    if (!a || v == null) continue;
    const arr = Array.isArray(v) ? v : [v];
    for (const b of arr) {
      if (b) pairs.push([a, String(b)]);
    }
  }
  return pairs;
}

export function detectCycles(deps) {
  const visited = new Set(), inStack = new Set();
  function dfs(node) {
    if (inStack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node); inStack.add(node);
    const dep = deps[node];
    const arr = Array.isArray(dep) ? dep : (dep ? [dep] : []);
    for (const d of arr) { if (d && dfs(d)) return true; }
    inStack.delete(node);
    return false;
  }
  return Object.keys(deps).some(n => dfs(n));
}

/* ── Topological sort ─────────────────────────────────────── */
function topoSort(nodes, adjOut) {
  const indeg = new Map(); nodes.forEach(n => indeg.set(n, 0));
  for (const [, succ] of adjOut.entries()) for (const t of succ) indeg.set(t, (indeg.get(t) || 0) + 1);
  const q = [], result = [];
  for (const n of nodes) if (indeg.get(n) === 0) q.push(n);
  while (q.length) {
    const n = q.shift(); result.push(n);
    for (const t of (adjOut.get(n) || [])) {
      indeg.set(t, indeg.get(t) - 1);
      if (indeg.get(t) === 0) q.push(t);
    }
  }
  return result.length === nodes.length ? result : null;
}

/* ── Critical path ────────────────────────────────────────── */
export function getCriticalPath(deps, weights) {
  // Сильнейший longest path с учётом весов (по умолчанию все 1).
  const nodes = new Set();
  _depsPairs(deps).forEach(([a, b]) => { nodes.add(a); nodes.add(b); });
  const adjOut = new Map();
  for (const n of nodes) adjOut.set(n, []);
  _depsPairs(deps).forEach(([a, b]) => {
    if (!adjOut.has(b)) adjOut.set(b, []);
    adjOut.get(b).push(a); // b → a (a depends on b)
  });
  const order = topoSort([...nodes], adjOut);
  if (!order) return Object.keys(deps);   // cycle → fall back to keys
  const dist = new Map(); const prev = new Map();
  for (const n of order) dist.set(n, weights?.[n] ?? 1);
  for (const n of order) {
    for (const t of (adjOut.get(n) || [])) {
      const cand = (dist.get(n) || 0) + (weights?.[t] ?? 1);
      if (cand > (dist.get(t) || 0)) { dist.set(t, cand); prev.set(t, n); }
    }
  }
  // Restore longest chain.
  let end = order[0]; let max = -Infinity;
  for (const n of order) if ((dist.get(n) || 0) > max) { max = dist.get(n); end = n; }
  const chain = [];
  let cur = end;
  while (cur !== undefined) { chain.unshift(cur); cur = prev.get(cur); }
  return chain;
}

/* ── Epic weight ──────────────────────────────────────────── */
export function weighEpic(epicName, rows) {
  // Простая heuristic: число задач + штрафы за блокеры/риски.
  const r = (rows || []).filter(row => (row.epic || '') === epicName);
  if (!r.length) return 1;
  const tasks = r.length;
  const blockers = r.filter(x => x.blockingDependency).length;
  const risks = r.filter(x => (x.riskFlags || []).length).length;
  return tasks + blockers * 2 + risks;
}

/* ── Layered layout (Sugiyama-lite) ───────────────────────── */
/**
 * @param {Object} deps      `{ targetEpic: sourceEpic }`
 * @param {Array}  rows      `state.rows` для weighting
 * @returns {{
 *   nodes: Array<{name, layer, idxInLayer, weight, x, y, blockers, risks, total}>,
 *   edges: Array<{from, to, critical}>,
 *   layers: Array<Array<string>>,    // names by layer
 *   critical: Set<string>,           // node names на critical path
 *   hasCycle: boolean
 * }}
 */
export function buildGraphLayout(deps, rows) {
  const dependsOn = deps || {};
  const allNames = new Set();
  _depsPairs(dependsOn).forEach(([a, b]) => { allNames.add(a); allNames.add(b); });
  // Также добавим эпики которые упомянуты в rows но не в deps (orphan).
  const orphans = new Set();
  for (const r of (rows || [])) {
    const e = String(r.epic || '').trim();
    if (e && !allNames.has(e)) orphans.add(e);
  }
  // Orphan-эпики ставим в отдельный «layer 0» только если их немного (≤8),
  // иначе перегружаем граф.
  const showOrphans = orphans.size > 0 && orphans.size <= 8;
  if (showOrphans) for (const o of orphans) allNames.add(o);

  if (!allNames.size) {
    return { nodes: [], edges: [], layers: [], critical: new Set(), hasCycle: false };
  }

  // adjOut: node → [successors]. Edge a depends on b == b → a.
  const adjOut = new Map(); const adjIn = new Map();
  for (const n of allNames) { adjOut.set(n, []); adjIn.set(n, []); }
  _depsPairs(dependsOn).forEach(([a, b]) => {
    if (allNames.has(a) && allNames.has(b)) {
      adjOut.get(b).push(a);
      adjIn.get(a).push(b);
    }
  });

  const hasCycle = detectCycles(dependsOn);

  // Layer assignment: longest-path from any source.
  const layer = new Map();
  function depth(n, seen = new Set()) {
    if (layer.has(n)) return layer.get(n);
    if (seen.has(n)) return 0;          // cycle guard
    seen.add(n);
    const ins = adjIn.get(n) || [];
    if (!ins.length) { layer.set(n, 0); return 0; }
    const d = 1 + Math.max(...ins.map(p => depth(p, seen)));
    layer.set(n, d);
    return d;
  }
  for (const n of allNames) depth(n);

  // Group by layer; sort within layer by weight (desc) для стабильного layout.
  const layers = [];
  for (const n of allNames) {
    const l = layer.get(n) || 0;
    while (layers.length <= l) layers.push([]);
    layers[l].push(n);
  }
  const weights = {};
  for (const n of allNames) weights[n] = weighEpic(n, rows);
  for (const lay of layers) lay.sort((a, b) => (weights[b] || 0) - (weights[a] || 0));

  // Critical path (наибольший суммарный вес).
  const cp = getCriticalPath(dependsOn, weights);
  const critSet = new Set(cp);

  // Coordinates: x по layer'у, y равномерно внутри layer.
  const NODE_W = 180, NODE_H = 56, GAP_X = 70, GAP_Y = 24, MARGIN = 24;
  const nodes = [];
  layers.forEach((lay, lIdx) => {
    lay.forEach((name, idx) => {
      const r = (rows || []).filter(row => (row.epic || '') === name);
      nodes.push({
        name,
        layer: lIdx,
        idxInLayer: idx,
        weight: weights[name] || 1,
        x: MARGIN + lIdx * (NODE_W + GAP_X),
        y: MARGIN + idx * (NODE_H + GAP_Y),
        total: r.length,
        blockers: r.filter(x => x.blockingDependency).length,
        risks: r.filter(x => (x.riskFlags || []).length).length,
        done: r.filter(x => x.isDone).length,
      });
    });
  });

  const edges = [];
  _depsPairs(dependsOn).forEach(([a, b]) => {
    if (!allNames.has(a) || !allNames.has(b)) return;
    edges.push({
      from: b, to: a,
      critical: critSet.has(a) && critSet.has(b),
    });
  });

  return {
    nodes, edges, layers, critical: critSet, hasCycle,
    bounds: {
      width:  MARGIN * 2 + Math.max(1, layers.length) * (NODE_W + GAP_X) - GAP_X,
      height: MARGIN * 2 + Math.max(1, ...layers.map(l => l.length)) * (NODE_H + GAP_Y) - GAP_Y,
    },
    nodeSize: { w: NODE_W, h: NODE_H },
  };
}

const DependencyEngine = { detectCycles, getCriticalPath, buildGraphLayout, weighEpic };
Services.register('DependencyEngine', DependencyEngine);
if (typeof window !== 'undefined') {
  window.DependencyEngine = DependencyEngine;
}
