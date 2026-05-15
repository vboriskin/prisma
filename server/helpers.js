// V22 Stage 8 — bootstrap helpers extracted from server.js.
// Three primitives used widely across server.js + extracted factories:
//   · writeJson(res, code, data)        JSON response shorthand.
//   · readBody(req, limitBytes)         buffered body read with size cap.
//   · isSameOriginRequest(req)          CSRF guard for mutating POSTs.
//   · MAX_BODY                          shared upload cap (8 MiB).
// MIME map stays in server/static.js since it's only used by the static
// handler and we don't want a third tiny module just for one constant.
'use strict';

const { URL } = require('url');

const MAX_BODY = 8 * 1024 * 1024;

function writeJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// QA A16.5 — same-origin guard для мутирующих POST. Без него злонамеренная
// страница на другом origin могла бы POST'нуть на /api/jira/config и
// перезаписать токены (CSRF). curl/Postman работают как и раньше — у них
// нет Origin/Referer, и мы не блокируем такие запросы (они не CSRF).
// CSRF_DISABLED=1 — runtime-escape для интеграционных тестов.
function isSameOriginRequest(req) {
  if (process.env.CSRF_DISABLED === '1') return true;
  const origin  = req.headers.origin  || '';
  const referer = req.headers.referer || '';
  const host    = req.headers.host    || '';
  if (!origin && !referer) return true;     // не браузер — нет CSRF-вектора
  try {
    const src = origin ? new URL(origin) : new URL(referer);
    return src.host === host;
  } catch (_) { return false; }
}

module.exports = { writeJson, readBody, isSameOriginRequest, MAX_BODY };
