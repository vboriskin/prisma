// V22 Stage 8 — static-file handler extracted from server.js.
// Single-purpose module: serves files from `ROOT` with security headers
// (CSP / X-Frame-Options / nosniff) + symlink-aware path-traversal guard
// (V12 audit recommendation #8). MIME map lives here too — only callsite.
//
// ROOT is passed per-call instead of being captured at require time so
// the module stays state-free (matches pattern used by other extracted
// factories — easier to test, no module-level config drift).
'use strict';

const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv':  'text/csv; charset=utf-8',
  // V15 fix (errors-log report 2026-04-30): without this MIME the browser
  // rejects WebAssembly streaming compile with "Unexpected response MIME
  // type. Expected 'application/wasm'", forcing fallback to ArrayBuffer
  // instantiation — which then trips the CSP `wasm-unsafe-eval` block.
  '.wasm': 'application/wasm',
  // Fonts (in case any get re-vendored locally later — harmless extras).
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
};

function serveStatic(req, res, ROOT) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);

  // V12 audit recommendation #8 (FOUND_BUGS NEW-7) — `path.resolve` does
  // NOT follow symlinks, so a symlink in ROOT pointing outside (e.g. to
  // /etc) would let `GET /symlink/passwd` slip past the prefix check.
  // `fs.realpath` resolves symlinks; we then re-check the prefix.
  // We use sync API because serveStatic is already synchronous up to fs.readFile.
  let resolvedFile;
  try {
    resolvedFile = fs.realpathSync(filePath);
  } catch (_e) {
    // ENOENT — file not found, continue to readFile to produce 404.
    resolvedFile = path.resolve(filePath);
  }
  if (!resolvedFile.startsWith(ROOT + path.sep) && resolvedFile !== ROOT) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Not Found: ${urlPath}`);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Server Error');
      }
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    // V12 audit recommendation #6 — defense-in-depth security headers.
    // CSP is intentionally permissive (`'self' 'unsafe-inline'` for inline
    // styles and event handlers we already use throughout); tightening to
    // strict-CSP would require a significant rewrite of the inline-render
    // pattern. Even permissive CSP blocks classic stored-XSS via the 234
    // raw-innerHTML lint warnings — script src must be 'self'.
    //
    // X-Frame-Options=DENY guards against clickjacking from external pages.
    // X-Content-Type-Options=nosniff prevents MIME-sniff confusion attacks.
    // Referrer-Policy=same-origin keeps token-bearing referrers from leaving
    // the app. The intra-corporate use case doesn't need HSTS (no public TLS).
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // V15 fix (errors-log report 2026-04-30): added 'wasm-unsafe-eval'
      // to script-src — without it the browser refused to compile the
      // sql.js WebAssembly module and SQLiteStore silently fell back to
      // localStorage. The keyword is narrowly scoped to WASM compilation;
      // it does NOT re-enable classic eval()/Function() of strings.
      'Content-Security-Policy':
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https:; " +
        "connect-src 'self'; " +
        "font-src 'self' data:; " +
        "frame-ancestors 'none'",
      'X-Frame-Options':        'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy':        'same-origin',
      'Permissions-Policy':     'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    });
    res.end(data);
  });
}

module.exports = { serveStatic, MIME };
