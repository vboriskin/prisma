'use strict';
/* ============================================================
   INSIGHT ENGINE — v8_0 ES module
   ============================================================ */

import { FilterEngine } from './filters.js';
import { computeLoad } from './metricsEngine.js';

export function parseLLMCommand(text) {
  const t = text.toLowerCase().trim();
  const rows = FilterEngine.getFiltered();

  if (/назнач|распредел/.test(t) && /без.*релиз|нераспредел|unassigned/.test(t)) {
    const rel = /1\.21/.test(t) ? '121' : /1\.22/.test(t) ? '122' : '120';
    const targets = rows.filter(r => r.isUnassigned && r.scopeStatus === 'Да');
    return { intent: 'assign_unassigned_to_release', targets, payload: { release: rel }, description: `Назначить ${targets.length} нераспределённых задач в релиз 1.${rel}` };
  }
  if (/убер|удал|сним/.test(t) && /риск|блокер/.test(t)) {
    const targets = rows.filter(r => r.blockingDependency);
    return { intent: 'remove_risks', targets, payload: {}, description: `Снять блокер с ${targets.length} задач` };
  }
  if (/перегруж|нагруз/.test(t)) {
    const load = computeLoad(rows);
    const overloaded = Object.entries(load).filter(([,v]) => v.total >= 6).map(([name]) => name);
    return { intent: 'show_overloaded', targets: [], payload: { overloaded }, description: `Перегруженные исполнители: ${overloaded.join(', ') || 'нет'}` };
  }
  return null;
}
