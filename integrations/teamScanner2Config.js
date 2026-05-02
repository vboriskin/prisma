'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — PER-TEAM CONFIG  (V18.3 A1)

   Pilot finding (Olga, ML-research, 5/10 verdict):
   «Code Review > 8ч threshold не подходит для ML — у нас review
    занимает 1-2 дня. ↻N false-positive при research-rhythm. Out-of-
    sprint ratio для research команд горит постоянно».

   Решение: per-team override dwell-thresholds через UI. Storage —
   localStorage (per-browser; ничего persistent на сервере чтобы не
   усложнять migration). Защищено от corruption через try/catch +
   schema validation.

   Public API:
     loadTeamConfig() → { [pk]: { dwellHours: {...}, mode? } }
     saveTeamConfig(config)
     getTeamThresholds(pk, fallback)  — returns per-pk thresholds или fallback
     applyPreset(pk, preset)          — 'default' | 'research' | 'hotfix'
   ============================================================ */

import { DEFAULT_DWELL_THRESHOLDS } from './teamScanner2Enrichment.js';

const LS_KEY = 'q2_scanner2_team_config';

// V20 S8.5 #2 — METRIC_THRESHOLDS живёт в Enrichment (там же где используется),
// здесь re-export для consumers которым удобно из Config (UI / tests).
export { METRIC_THRESHOLDS } from './teamScanner2Enrichment.js';

/** Pre-defined preset thresholds — Olga's «research» mode + «hotfix». */
export const PRESET_THRESHOLDS = {
  default: { ...DEFAULT_DWELL_THRESHOLDS },
  // Research mode: code review занимает 1-2 дня (peer review papers,
  // numbers verification). In-progress 3 дня = норма ML-цикла.
  research: { codeReview: 24, qa: 24, inProgress: 96, todo: 168, default: 48 },
  // Hotfix mode: всё гуляет быстрее, blocker-сигнал появляется через
  // несколько часов вместо суток.
  hotfix:   { codeReview: 4,  qa: 6,  inProgress: 12, todo: 24,  default: 8 },
};

/** Load full team config from localStorage. Defensive: returns {} on any error. */
export function loadTeamConfig() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return {};
    return obj;
  } catch (_) { return {}; }
}

export function saveTeamConfig(config) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(config || {}));
    return true;
  } catch (_) { return false; }
}

/**
 * Returns thresholds map для конкретной pk. Если pk имеет custom config —
 * возвращает его. Иначе возвращает fallback (global default).
 */
export function getTeamThresholds(pk, fallback = DEFAULT_DWELL_THRESHOLDS) {
  if (!pk) return fallback;
  const config = loadTeamConfig();
  const teamCfg = config[pk];
  if (!teamCfg || !teamCfg.dwellHours) return fallback;
  // Merge с fallback чтобы partial override не привёл к undefined ключам.
  return { ...fallback, ...teamCfg.dwellHours };
}

/**
 * Apply preset to a team. Mutates the config and persists.
 * @returns updated config
 */
export function applyPreset(pk, presetName) {
  const config = loadTeamConfig();
  const preset = PRESET_THRESHOLDS[presetName] || PRESET_THRESHOLDS.default;
  config[pk] = {
    ...config[pk],
    mode: presetName,
    dwellHours: { ...preset },
  };
  saveTeamConfig(config);
  return config;
}

/** Reset team config (use global defaults). Removes pk from config map. */
export function resetTeam(pk) {
  const config = loadTeamConfig();
  delete config[pk];
  saveTeamConfig(config);
  return config;
}

/**
 * Build a teamThresholds map для enrichForScanner2:
 * Map<pk, threshold-map>. Только команды с custom config попадают —
 * остальные используют global default через fallback в enrichment.
 */
export function buildTeamThresholdsMap() {
  const config = loadTeamConfig();
  const out = {};
  for (const [pk, cfg] of Object.entries(config)) {
    if (cfg?.dwellHours) {
      out[pk] = { ...DEFAULT_DWELL_THRESHOLDS, ...cfg.dwellHours };
    }
  }
  return out;
}
