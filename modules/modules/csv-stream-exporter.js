'use strict';

(function initCSVStreamExporter(globalScope){
  async function buildBlob(options) {
    const opts = options || {};
    const bom = opts.bom || '\uFEFF';
    const header = opts.header || '';
    const rows = Array.isArray(opts.rows) ? opts.rows : [];
    const rowToLine = typeof opts.rowToLine === 'function' ? opts.rowToLine : (r => String(r || ''));
    const tailLines = Array.isArray(opts.tailLines) ? opts.tailLines : [];
    const batchSize = Math.max(100, Math.min(2500, Number(opts.batchSize) || 700));
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const parts = [bom, header, '\n'];

    for (let i = 0; i < rows.length; i++) {
      parts.push(rowToLine(rows[i], i), '\n');
      if ((i + 1) % batchSize === 0) {
        if (onProgress) onProgress(i + 1, rows.length);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    if (onProgress) onProgress(rows.length, rows.length);

    tailLines.forEach(line => {
      parts.push(String(line || ''), '\n');
    });

    return new Blob(parts, { type: 'text/csv;charset=utf-8;' });
  }

  globalScope.CSVStreamExporter = {
    buildBlob,
  };
})(window);
