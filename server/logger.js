'use strict';
/* ============================================================
   STRUCTURED LOGGER  (V19 E4, originally deferred V18 P14)

   Цель: заменить ad-hoc `console.log` на structured JSON output
   для будущего шипа в ELK / Sentry / любой aggregator. Также
   prerequisite для V19 C4 (telemetry events).

   Format (newline-delimited JSON, по строке на entry):
     {"ts":"2026-05-02T14:00:00.123Z","level":"info","msg":"…","reqId":"r-1234","field1":"value"}

   Levels (по убыванию severity):
     error → warn → info → debug

   Configuration via env vars:
     LOG_LEVEL  = 'debug' | 'info' (default) | 'warn' | 'error'
     LOG_FORMAT = 'json' (default, prod-like) | 'pretty' (dev human-readable)
     LOG_TS     = 'iso' (default) | 'epoch' (ms since 1970)

   Public API:
     logger.error(msg, data?)
     logger.warn(msg, data?)
     logger.info(msg, data?)
     logger.debug(msg, data?)
     logger.withReqId(id) → child logger с reqId-tag во всех записях
     logger.event(eventName, data?)  — для V19 C4 telemetry; level=info
     logger.timeStart(label) / logger.timeEnd(label, data?)
                                — measure latency, emit info entry

   Defensive: НЕ должен бросать. Всё в try/catch.
   PII-safe: caller сам решает что логировать; logger не делает scrub'ing.
   ============================================================ */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const DEFAULT_LEVEL  = 'info';
const DEFAULT_FORMAT = 'json';
const DEFAULT_TS     = 'iso';

function _readConfig() {
  const env = process.env || {};
  const lvlName = String(env.LOG_LEVEL || DEFAULT_LEVEL).toLowerCase();
  const fmt     = String(env.LOG_FORMAT || DEFAULT_FORMAT).toLowerCase();
  const tsFmt   = String(env.LOG_TS || DEFAULT_TS).toLowerCase();
  return {
    minLevel: LEVELS[lvlName] ?? LEVELS.info,
    format:   fmt === 'pretty' ? 'pretty' : 'json',
    tsFormat: tsFmt === 'epoch' ? 'epoch' : 'iso',
  };
}

let _config = _readConfig();

/** Allow runtime override (testing). */
function configure(over = {}) {
  _config = { ..._config, ..._readConfig(), ...over };
}

function _ts() {
  const now = new Date();
  return _config.tsFormat === 'epoch' ? now.getTime() : now.toISOString();
}

/** Pretty-format для dev: «2026-05-02T14:00:00 [INFO] msg | k=v k=v». */
function _formatPretty(entry) {
  const { ts, level, msg, ...rest } = entry;
  const fields = Object.keys(rest).length
    ? ' | ' + Object.entries(rest).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ')
    : '';
  return `${ts} [${level.toUpperCase()}] ${msg}${fields}`;
}

// V21 BP (audit-05 §E #1, §H #1) — PII / secret scrub перед emit.
// 152-ФЗ compliance: email/phone/СНИЛС/паспорт + Bearer/Authorization/token
// маскируются. Применяется ко всему JSON-payload'у рекурсивно.
const _PII_PATTERNS = [
  // Bearer / token / api-key / cookie / Authorization / X-API-Key.
  { re: /(authorization|x-api-key|cookie)\s*[:=]\s*[^\s,;]+/gi, repl: '$1: ***' },
  { re: /Bearer\s+[A-Za-z0-9\-_=.]+/gi, repl: 'Bearer ***' },
  { re: /(token|secret|password|apiKey|authKey)\s*[:=]\s*[^\s,;"]+/gi, repl: '$1: ***' },
  // Email.
  { re: /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, repl: '[email]' },
  // СНИЛС: «123-456-789 12».
  { re: /\b\d{3}-\d{3}-\d{3}\s?\d{2}\b/g, repl: '[snils]' },
  // Паспорт РФ.
  { re: /\b\d{4}\s?\d{6}\b/g, repl: '[passport]' },
  // Phones (best-effort: +7 / 8 / международные).
  { re: /(?:\+?\d{1,3}[\s\-]?)?\(?\d{3,4}\)?[\s\-]?\d{2,3}[\s\-]?\d{2}[\s\-]?\d{2}/g, repl: '[phone]' },
];
const _PII_KEY_DENYLIST = new Set(['displayName', 'fio', 'email', 'phone', 'snils', 'passport']);

function _scrubString(s) {
  let out = String(s);
  for (const { re, repl } of _PII_PATTERNS) out = out.replace(re, repl);
  return out;
}
function _scrubValue(v, depth = 0) {
  if (depth > 6) return '[depth-cap]';
  if (v == null) return v;
  if (typeof v === 'string') return _scrubString(v);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(x => _scrubValue(x, depth + 1));
  if (typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (_PII_KEY_DENYLIST.has(k)) {
        out[k] = '[redacted]';
        continue;
      }
      out[k] = _scrubValue(val, depth + 1);
    }
    return out;
  }
  return v;
}

function _emit(level, msg, data) {
  try {
    if (LEVELS[level] < _config.minLevel) return;
    const entry = {
      ts: _ts(),
      level,
      msg: _scrubString(String(msg ?? '')),
      ...(data && typeof data === 'object' ? _scrubValue(data) : {}),
    };
    const line = _config.format === 'pretty'
      ? _formatPretty(entry)
      : JSON.stringify(entry);
    // Stream by severity: error → stderr, остальное → stdout.
    // Это позволяет k8s/docker отделять error-stream от noise.
    const stream = (level === 'error') ? process.stderr : process.stdout;
    stream.write(line + '\n');
  } catch (_) {
    // Defensive: logger никогда не должен бросать. Fallback на console.
    try { console.error('[logger] emit failed for level=' + level); } catch (__) {}
  }
}

/**
 * Returns child logger, который ко всем записям добавляет {reqId, ...extra}.
 * Caller использует для request-correlation: одна request → одна reqId.
 */
function _makeChild(extras) {
  return {
    error: (msg, data) => _emit('error', msg, { ...extras, ...(data || {}) }),
    warn:  (msg, data) => _emit('warn',  msg, { ...extras, ...(data || {}) }),
    info:  (msg, data) => _emit('info',  msg, { ...extras, ...(data || {}) }),
    debug: (msg, data) => _emit('debug', msg, { ...extras, ...(data || {}) }),
    event: (event, data) => _emit('info', `[event] ${event}`, { event, ...extras, ...(data || {}) }),
    withReqId: (reqId) => _makeChild({ ...extras, reqId }),
    withFields: (fields) => _makeChild({ ...extras, ...(fields || {}) }),
    timeStart, timeEnd,
  };
}

/* ── timeStart / timeEnd для measure latency ───────── */
const _timers = new Map();   // label → startMs

function timeStart(label) {
  if (!label) return;
  _timers.set(label, Date.now());
}

function timeEnd(label, data) {
  if (!label) return null;
  const startMs = _timers.get(label);
  if (startMs == null) return null;
  _timers.delete(label);
  const latencyMs = Date.now() - startMs;
  _emit('info', `[time] ${label}`, { latencyMs, ...(data || {}) });
  return latencyMs;
}

/* ── Public root logger ──────────────────────────── */
const logger = {
  error: (msg, data) => _emit('error', msg, data),
  warn:  (msg, data) => _emit('warn',  msg, data),
  info:  (msg, data) => _emit('info',  msg, data),
  debug: (msg, data) => _emit('debug', msg, data),
  /** V19 C4 — telemetry event. level=info, добавляет field `event`. */
  event: (eventName, data) => _emit('info', `[event] ${eventName}`, { event: eventName, ...(data || {}) }),
  /** Returns child logger с reqId-tag. */
  withReqId: (reqId) => _makeChild({ reqId }),
  /** Returns child logger с произвольными extra-полями. */
  withFields: (fields) => _makeChild(fields || {}),
  timeStart,
  timeEnd,
  configure,
  /** For tests — read current config. */
  _getConfig: () => ({ ..._config }),
};

module.exports = logger;
