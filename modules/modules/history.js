'use strict';

(function initHistoryModule(globalScope){
  function safeClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function safeObject(value) {
    return value && typeof value === 'object' ? value : {};
  }

  function buildSnapshot(state) {
    return safeClone({
      rows: safeArray(state.rows),
      employees: safeArray(state.employees),
      customCols: safeArray(state.customCols),
      colOrder: safeArray(state.colOrder),
      colWidths: safeObject(state.colWidths),
      colVisibility: safeObject(state.colVisibility),
      colLabels: safeObject(state.colLabels),
      colTypes: safeObject(state.colTypes),
      pinnedCols: safeArray(state.pinnedCols),
      rowHeight: state.rowHeight,
      sort: safeObject(state.sort),
      lastClickedRowId: state.lastClickedRowId || null,
      epicDeps: safeObject(state.epicDeps),
      _idCounter: Number(state._idCounter) || 1,
      _dataVersion: Number(state._dataVersion) || 0,
    });
  }

  function applySnapshot(state, snapshot) {
    state.rows = safeArray(snapshot.rows);
    state.employees = safeArray(snapshot.employees);
    state.customCols = safeArray(snapshot.customCols);
    state.colOrder = safeArray(snapshot.colOrder);
    state.colWidths = safeObject(snapshot.colWidths);
    state.colVisibility = safeObject(snapshot.colVisibility);
    state.colLabels = safeObject(snapshot.colLabels);
    state.colTypes = safeObject(snapshot.colTypes);
    state.pinnedCols = safeArray(snapshot.pinnedCols);
    state.rowHeight = Number(snapshot.rowHeight) || 36;
    state.sort = safeObject(snapshot.sort);
    state.lastClickedRowId = snapshot.lastClickedRowId || null;
    state.epicDeps = safeObject(snapshot.epicDeps);
    state._idCounter = Number(snapshot._idCounter) || 1;
    state._dataVersion = Number(snapshot._dataVersion) || 0;
  }

  function fingerprint(snapshot) {
    try {
      const rowsLen = Array.isArray(snapshot.rows) ? snapshot.rows.length : 0;
      const employeesLen = Array.isArray(snapshot.employees) ? snapshot.employees.length : 0;
      const payload = JSON.stringify(snapshot);
      return rowsLen + ':' + employeesLen + ':' + payload.length + ':' + payload.slice(0, 180);
    } catch (_) {
      return String(Date.now());
    }
  }

  globalScope.HistoryModule = {
    buildSnapshot,
    applySnapshot,
    fingerprint,
  };
})(window);
