'use strict';
/* ============================================================
   integrations/release2/release2State.js — V22+ (Release 2.0)

   In-memory state для view + persist в localStorage:
     · groupBy: 'project' | 'status' | 'flat' | 'owner'
     · filters: { projectKeys[], statuses[], types[], risks[], searchText, smartPreset }
     · expandedKeys: Set<jiraKey>          — какие релизы развёрнуты
     · expandedTab:  Map<jiraKey, tabId>    — какой таб открыт внутри expand
     · sort:          'priority' | 'planProdEnd' | 'updated' | 'status'
     · relatedCache:  Map<jiraKey, {ts, items[]}>  — кэш lazy-fetch
     · prevList:      previous fetched list (для diff)

   Persist в localStorage (key='r2_state_v1'): только UI-state, не данные.
   ============================================================ */

const LS_KEY = 'r2_state_v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

function _emptyState() {
  return {
    groupBy: 'project',
    sort: 'priority',
    filters: {
      projectKeys: [],
      statuses: [],
      types: [],
      risks: [],
      searchText: '',
      phase: '',        // V22+ Phase 5.1 — toggle-фильтр из phase-bar / stat-bar
                        // ('' | 'creation' | 'stabilize' | 'uat' | 'approve' | 'deploy' | 'cancel')
      smartPreset: '',  // legacy, для backward-compat (не используется UI после Phase 5.1)
    },
    expandedKeys: [],
    expandedTab: {},  // { key: tabId }
    diffDismissed: null,  // { fetchedAt } — для какого fetch'а banner закрыт
    diffHistory: [],      // V22+ Phase 5.1 — last 7 fetches {fetchedAt, added, changed, removed}
  };
}

const DIFF_HISTORY_MAX = 7;

class Release2State {
  constructor() {
    this._loaded = false;
    this._state = _emptyState();
    this._relatedCache = new Map();
    this._lastList = null;
    this._prevList = null;
    this._isLoading = false;
    this._errorMsg = null;
    this._abortController = null;
  }

  _ensureLoaded() {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(LS_KEY) : null;
      if (raw) {
        const stored = JSON.parse(raw);
        if (stored && typeof stored === 'object') {
          this._state = { ..._emptyState(), ...stored };
          if (!this._state.filters) this._state.filters = _emptyState().filters;
          else this._state.filters = { ..._emptyState().filters, ...this._state.filters };
        }
      }
    } catch (_) { /* corrupt — defaults */ }
  }

  _save() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(LS_KEY, JSON.stringify(this._state));
    } catch (_) { /* quota / storage off — silent */ }
  }

  /* ── public state accessors ─────────────────────────────── */

  get state() { this._ensureLoaded(); return this._state; }
  get groupBy() { return this.state.groupBy; }
  get sort() { return this.state.sort; }
  get filters() { return this.state.filters; }
  get expandedKeys() { this._ensureLoaded(); return new Set(this._state.expandedKeys); }
  get isLoading() { return this._isLoading; }
  get errorMsg() { return this._errorMsg; }
  get lastList() { return this._lastList; }
  get prevList() { return this._prevList; }

  /* ── mutations ──────────────────────────────────────────── */

  setGroupBy(v) { this.state.groupBy = v; this._save(); }
  setSort(v)    { this.state.sort = v; this._save(); }
  setFilter(key, value) { this.state.filters[key] = value; this._save(); }
  resetFilters() {
    this._state.filters = _emptyState().filters;
    this._save();
  }

  toggleExpand(key) {
    this._ensureLoaded();
    const set = new Set(this._state.expandedKeys);
    if (set.has(key)) set.delete(key); else set.add(key);
    this._state.expandedKeys = Array.from(set);
    this._save();
  }
  isExpanded(key) { return this.expandedKeys.has(key); }

  getExpandedTab(key) {
    this._ensureLoaded();
    return this._state.expandedTab?.[key] || 'attrs';
  }
  setExpandedTab(key, tab) {
    this._ensureLoaded();
    if (!this._state.expandedTab) this._state.expandedTab = {};
    this._state.expandedTab[key] = tab;
    this._save();
  }

  /* ── diff-banner dismiss ────────────────────────────────── */

  /** Узнать, dismissed ли banner для текущего fetched-at (или для последнего). */
  isDiffDismissedFor(fetchedAt) {
    this._ensureLoaded();
    const d = this._state.diffDismissed;
    if (!d || !d.fetchedAt) return false;
    return d.fetchedAt === fetchedAt;
  }
  /** Закрыть banner для конкретного fetched-at. */
  dismissDiffFor(fetchedAt) {
    this._ensureLoaded();
    this._state.diffDismissed = { fetchedAt };
    this._save();
  }

  /* ── diff history (Доп #22 — 7-day sparkline) ──────────── */

  /** Дописать одну запись в history (ringbuffer 7 элементов). */
  appendDiffHistory(diff, fetchedAt) {
    this._ensureLoaded();
    if (!Array.isArray(this._state.diffHistory)) this._state.diffHistory = [];
    const entry = {
      fetchedAt,
      added:   diff?.added?.length || 0,
      changed: diff?.changed?.length || 0,
      removed: diff?.removed?.length || 0,
    };
    // Дедуплицируем по fetchedAt — если уже есть запись, обновляем.
    const idx = this._state.diffHistory.findIndex(h => h.fetchedAt === fetchedAt);
    if (idx >= 0) this._state.diffHistory[idx] = entry;
    else this._state.diffHistory.push(entry);
    // Trim до DIFF_HISTORY_MAX последних.
    if (this._state.diffHistory.length > DIFF_HISTORY_MAX) {
      this._state.diffHistory = this._state.diffHistory.slice(-DIFF_HISTORY_MAX);
    }
    this._save();
  }
  getDiffHistory() {
    this._ensureLoaded();
    return Array.isArray(this._state.diffHistory) ? this._state.diffHistory.slice() : [];
  }

  /* ── fetch lifecycle ────────────────────────────────────── */

  startLoading() {
    this._isLoading = true;
    this._errorMsg = null;
    // Создаём новый AbortController (отменяя предыдущий fetch если есть)
    if (this._abortController) {
      try { this._abortController.abort(new DOMException('Manual restart', 'AbortError')); } catch (_) {}
    }
    this._abortController = new AbortController();
    return this._abortController.signal;
  }
  finishLoading(result) {
    this._isLoading = false;
    this._errorMsg = null;
    this._prevList = this._lastList;
    this._lastList = result;
    this._abortController = null;
  }
  failLoading(err) {
    this._isLoading = false;
    this._errorMsg = String(err?.message || err || 'Ошибка загрузки');
    this._abortController = null;
  }
  cancelLoading() {
    if (this._abortController) {
      try { this._abortController.abort(new DOMException('Cancelled', 'AbortError')); } catch (_) {}
    }
    this._isLoading = false;
    this._abortController = null;
  }

  /* ── related-issues cache ───────────────────────────────── */

  getRelated(key) {
    const e = this._relatedCache.get(key);
    if (!e) return null;
    if (Date.now() - e.ts > CACHE_TTL_MS) {
      this._relatedCache.delete(key);
      return null;
    }
    return e.items;
  }
  setRelated(key, items) {
    this._relatedCache.set(key, { ts: Date.now(), items: items || [] });
  }
  clearRelatedCache() {
    this._relatedCache.clear();
  }
}

export const release2State = new Release2State();
