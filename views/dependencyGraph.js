'use strict';
/* ============================================================
   DependencyGraphView — i4 (codebase-04 audit).

   SVG-граф зависимостей эпиков с подсветкой critical path.
   Открывается как overlay поверх Ганта (modal-style) — не ломает
   существующий gantt-render.

   Public API:
     · DependencyGraphView.open()   — показать overlay поверх Ганта
     · DependencyGraphView.close()  — скрыть overlay
     · DependencyGraphView.toggle() — переключить
   ============================================================ */

import { state } from '../state.js';
import { buildGraphLayout } from '../dependencyEngine.js';
import { Services } from '../app/services.js';
import { Storage } from '../dataStore.js';

const OVERLAY_ID = 'dep-graph-overlay';

/** Удалить зависимость: `dependent` больше не зависит от `dependency`.
 *  state.epicDeps[dependent] может быть string (legacy) ИЛИ Array<to>. */
function _removeDep(dependent, dependency) {
  const map = { ...(state.epicDeps || {}) };
  const v = map[dependent];
  if (Array.isArray(v)) {
    const next = v.filter(x => String(x) !== String(dependency));
    if (next.length) map[dependent] = next; else delete map[dependent];
  } else if (String(v) === String(dependency)) {
    delete map[dependent];
  }
  state.epicDeps = map;
  try { Storage.save(); } catch (_) {}
}

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/* SVG path для стрелки между двумя узлами с lab→a (b → a). */
function _edgePath(from, to, nodeSize) {
  const x1 = from.x + nodeSize.w;          // right edge of source
  const y1 = from.y + nodeSize.h / 2;
  const x2 = to.x;                          // left edge of target
  const y2 = to.y + nodeSize.h / 2;
  // S-curve через две control-точки.
  const cp = Math.max(40, (x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + cp},${y1} ${x2 - cp},${y2} ${x2},${y2}`;
}

function _nodeHTML(node) {
  const dot = (cls, n) => n > 0 ? `<span class="dep-node-dot ${cls}" title="${cls}: ${n}">${n}</span>` : '';
  return `
    <div class="dep-node" data-epic="${_esc(node.name)}" style="left:${node.x}px;top:${node.y}px">
      <div class="dep-node-title" title="${_esc(node.name)}">${_esc(_truncate(node.name, 24))}</div>
      <div class="dep-node-meta">
        <span>${node.total} зад.</span>
        ${dot('blockers', node.blockers)}
        ${dot('risks', node.risks)}
        ${node.done === node.total && node.total > 0 ? '<span class="dep-node-done">готов</span>' : ''}
      </div>
    </div>`;
}

function _renderOverlay() {
  const layout = buildGraphLayout(state.epicDeps || {}, state.rows || []);
  const { nodes, edges, bounds, nodeSize, critical, hasCycle } = layout;

  // Empty-state.
  if (!nodes.length) {
    return `
      <div class="dep-graph-empty">
        <div class="prizma-card-eyebrow">PRIZMA · ЗАВИСИМОСТИ</div>
        <div class="dep-graph-empty-title">Зависимости не заданы</div>
        <div class="dep-graph-empty-sub">
          Чтобы увидеть граф, задайте связи: в Ганте на строке эпика нажмите иконку зависимостей (узелки) рядом с категорией и отметьте, от каких эпиков он зависит.
        </div>
        <button class="btn btn-outline btn-xs" id="dep-graph-close">Закрыть</button>
      </div>`;
  }

  // SVG defs + edges.
  const nodeByName = new Map(nodes.map(n => [n.name, n]));
  const edgesSvg = edges.map(e => {
    const from = nodeByName.get(e.from);
    const to   = nodeByName.get(e.to);
    if (!from || !to) return '';
    const cls = e.critical ? 'dep-edge dep-edge-critical' : 'dep-edge';
    return `<path class="${cls}" d="${_edgePath(from, to, nodeSize)}" marker-end="url(#dep-arrow${e.critical ? '-critical' : ''})"/>`;
  }).join('');

  // «×» на середине каждого ребра — удалить зависимость. edge.to зависит
  // от edge.from; удаление убирает edge.from из epicDeps[edge.to].
  const edgeDelBtns = edges.map(e => {
    const from = nodeByName.get(e.from);
    const to   = nodeByName.get(e.to);
    if (!from || !to) return '';
    const x1 = from.x + nodeSize.w, y1 = from.y + nodeSize.h / 2;
    const x2 = to.x,                y2 = to.y + nodeSize.h / 2;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const tip = `Удалить зависимость: «${_esc(e.to)}» больше не зависит от «${_esc(e.from)}»`;
    return `<button class="dep-edge-del" data-dependent="${_esc(e.to)}" data-dependency="${_esc(e.from)}" style="left:${mx}px;top:${my}px" title="${tip}" aria-label="${tip}">×</button>`;
  }).join('');

  const nodesHtml = nodes.map(n => {
    const cls = critical.has(n.name) ? 'dep-node-wrap dep-node-critical'
              : n.blockers > 0       ? 'dep-node-wrap dep-node-blocker'
              : n.risks > 0          ? 'dep-node-wrap dep-node-risk'
              :                        'dep-node-wrap';
    return `<div class="${cls}">${_nodeHTML(n)}</div>`;
  }).join('');

  const cycleBanner = hasCycle
    ? `<div class="dep-graph-cycle">Внимание: в графе обнаружен цикл — порядок может быть некорректным.</div>`
    : '';

  return `
    <div class="dep-graph-modal" role="dialog" aria-label="Граф зависимостей эпиков">
      <div class="dep-graph-header">
        <div class="dep-graph-eyebrow">PRIZMA · ЗАВИСИМОСТИ ЭПИКОВ</div>
        <div class="dep-graph-title">Critical path: ${critical.size} ${critical.size === 1 ? 'эпик' : 'эпиков'}</div>
        <div class="dep-graph-actions">
          <button class="btn btn-ghost btn-xs" id="dep-graph-fit" title="К исходному масштабу">Сброс</button>
          <button class="btn btn-ghost btn-xs" id="dep-graph-close" aria-label="Закрыть">Закрыть</button>
        </div>
      </div>
      ${cycleBanner}
      <div class="dep-graph-legend">
        <span class="dep-legend-item"><span class="dep-legend-swatch dep-swatch-critical"></span>Critical path</span>
        <span class="dep-legend-item"><span class="dep-legend-swatch dep-swatch-blocker"></span>Блокер</span>
        <span class="dep-legend-item"><span class="dep-legend-swatch dep-swatch-risk"></span>Риск</span>
        <span class="dep-legend-item"><span class="dep-legend-swatch dep-swatch-done"></span>Готов</span>
      </div>
      <div class="dep-graph-canvas-wrap" id="dep-graph-canvas-wrap">
        <div class="dep-graph-canvas" style="width:${bounds.width}px;height:${bounds.height}px">
          <svg class="dep-graph-svg" width="${bounds.width}" height="${bounds.height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <marker id="dep-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,1 L9,5 L0,9 z" fill="var(--text-3)"/>
              </marker>
              <marker id="dep-arrow-critical" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,1 L9,5 L0,9 z" fill="var(--prizma-critical)"/>
              </marker>
            </defs>
            ${edgesSvg}
          </svg>
          ${nodesHtml}
          ${edgeDelBtns}
        </div>
      </div>
    </div>`;
}

export const DependencyGraphView = {
  isOpen() { return !!document.getElementById(OVERLAY_ID); },
  open() {
    if (DependencyGraphView.isOpen()) return;
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'dep-graph-overlay';
    overlay.innerHTML = _renderOverlay();
    document.body.appendChild(overlay);
    DependencyGraphView._bind(overlay);
    // F10 — отметить рендер.
    try { Services.App?.markRenderedNow?.(); } catch (_) {}
    // Esc — закрыть.
    DependencyGraphView._escHandler = (e) => {
      if (e.key === 'Escape') DependencyGraphView.close();
    };
    document.addEventListener('keydown', DependencyGraphView._escHandler);
  },
  close() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
    if (DependencyGraphView._escHandler) {
      document.removeEventListener('keydown', DependencyGraphView._escHandler);
      DependencyGraphView._escHandler = null;
    }
  },
  toggle() {
    if (DependencyGraphView.isOpen()) DependencyGraphView.close();
    else DependencyGraphView.open();
  },
  _bind(root) {
    root.querySelector('#dep-graph-close')?.addEventListener('click', () => DependencyGraphView.close());
    // Click on backdrop (но не на modal content) — закрыть.
    root.addEventListener('click', (e) => {
      if (e.target === root) DependencyGraphView.close();
    });
    root.querySelector('#dep-graph-fit')?.addEventListener('click', () => {
      const wrap = root.querySelector('#dep-graph-canvas-wrap');
      if (wrap) { wrap.scrollLeft = 0; wrap.scrollTop = 0; }
    });
    // «×» на ребре — удалить зависимость + перерисовать граф.
    root.querySelectorAll('.dep-edge-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dependent  = btn.dataset.dependent;
        const dependency = btn.dataset.dependency;
        if (!window.confirm(`Удалить зависимость?\n«${dependent}» больше не будет зависеть от «${dependency}».`)) return;
        _removeDep(dependent, dependency);
        // Перерисовать overlay на месте (граф мог стать пустым).
        root.innerHTML = _renderOverlay();
        DependencyGraphView._bind(root);
        try { Services.GanttView?.renderChart?.() || window.GanttView?.renderChart?.(); } catch (_) {}
        window.showToast?.('Зависимость удалена', 'success', 1800);
      });
    });

    // Click по узлу — попытаться скроллить в Гант к этому эпику.
    root.querySelectorAll('.dep-node').forEach(node => {
      node.addEventListener('click', () => {
        const epic = node.dataset.epic;
        DependencyGraphView.close();
        try {
          // Простой drill: переход в Гант (если ещё не там) + поиск эпика.
          if (state.activeSection !== 'gantt') Services.Nav?.goTo?.('gantt');
          requestAnimationFrame(() => {
            const target = document.querySelector(`[data-epic="${CSS.escape(epic)}"]`);
            target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
          });
        } catch (_) {}
      });
    });
  },
};

Services.register('DependencyGraphView', DependencyGraphView);
if (typeof window !== 'undefined') window.DependencyGraphView = DependencyGraphView;
