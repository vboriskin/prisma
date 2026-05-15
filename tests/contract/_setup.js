'use strict';
/* ============================================================
   Contract test infrastructure — fake Jira + real server.js
   --
   Раньше эта логика жила в `contractTest.js` (root) с самописным
   pass()/fail() runner'ом. V18 P2 — переехала в `tests/contract/_setup.js`
   (экспортируется как helper) + тесты в `tests/contract/integrations.test.js`
   запускаются через `node:test` стандартный раннер.
   --
   Имя файла начинается с `_` чтобы node:test НЕ подхватил его как тестовый
   (он ищет `*.test.js`).
   ============================================================ */

const { spawn } = require('child_process');
const http     = require('http');
const path     = require('path');

const FAKE_PORT = 19200;     // canned-response Jira
const APP_PORT  = 19201;     // real server.js under test

let appProc = null;
let fakeServer = null;
let _fakeJiraServerInfoHits = 0;

const FAKE_ISSUES = [
  {
    key: 'TEST-1',
    fields: {
      summary: 'Fix login flow',
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      assignee: { displayName: 'Иван Иванов', name: 'i.ivanov', emailAddress: 'i.ivanov@test.ru' },
      reporter: { displayName: 'Петр Петров' },
      updated: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      created: '2026-04-25T10:00:00.000Z',
      priority: { name: 'High' },
      issuetype: { name: 'Story', subtask: false },
      labels: [], duedate: null,
      timetracking: {}, timeoriginalestimate: 0, aggregatetimespent: 0,
      worklog: { worklogs: [] }, comment: { comments: [] },
      parent: null, subtasks: [],
      resolution: null, resolutiondate: null,
      customfield_10020: [{ name: 'Sprint 42', state: 'active', startDate: '2026-04-20T00:00:00Z', endDate: '2026-05-04T00:00:00Z' }],
    },
    changelog: { histories: [
      { author: { displayName: 'Иван Иванов' }, created: new Date(Date.now() - 4*3600*1000).toISOString(),
        items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }] },
    ]},
  },
];

function startFakeJira() {
  return new Promise((resolve, reject) => {
    fakeServer = http.createServer((req, res) => {
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const url = req.url || '';
      if (url.startsWith('/rest/api/2/myself'))     return send(200, { displayName: 'Test User', name: 'test.user', emailAddress: 'tu@test.ru', active: true });
      if (url.startsWith('/rest/api/2/search'))     return send(200, { issues: FAKE_ISSUES, total: FAKE_ISSUES.length, startAt: 0, maxResults: 100 });
      if (url.startsWith('/rest/api/2/issue/'))     return send(200, FAKE_ISSUES[0]);
      if (url.startsWith('/rest/api/2/serverInfo')) { _fakeJiraServerInfoHits++; return send(200, { version: '9.99.0', buildNumber: 999000, deploymentType: 'Server', serverTime: '2026-04-28T10:00:00Z', baseUrl: 'http://fake' }); }
      if (url.startsWith('/rest/api/2/project/TEST/statuses'))  return send(200, [{ id: '10000', name: 'Story', subtask: false, statuses: [{ id: '1', name: 'Open', statusCategory: { key: 'new' } }] }]);
      if (url.match(/^\/rest\/api\/2\/project\/[^/]+\/versions/))   return send(200, [{ id: 'v1', name: '1.0', released: true, archived: false }]);
      if (url.match(/^\/rest\/api\/2\/project\/[^/]+\/components/)) return send(200, [{ id: 'c1', name: 'Backend', description: '' }]);
      if (url.startsWith('/rest/api/2/project'))    return send(200, [{ id: '10001', key: 'TEST', name: 'Test Project', projectTypeKey: 'software', lead: { displayName: 'Lead' } }]);
      if (url.startsWith('/rest/api/2/issuetype'))  return send(200, [{ id: '1', name: 'Story', subtask: false, description: '' }]);
      if (url.startsWith('/rest/api/2/status'))     return send(200, [{ id: '1', name: 'Open', statusCategory: { key: 'new', name: 'To Do', colorName: 'blue-gray' } }]);
      if (url.startsWith('/rest/api/2/priority'))   return send(200, [{ id: '1', name: 'High',  iconUrl: 'http://fake/icon.png' }]);
      if (url.startsWith('/rest/api/2/resolution')) return send(200, [{ id: '1', name: 'Done',  description: 'Work resolved' }]);
      if (url.startsWith('/rest/api/2/field'))      return send(200, [
        { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string' } },
        { id: 'customfield_10001', name: 'Story Points', custom: true, schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
      ]);
      if (url.startsWith('/rest/api/2/customField/')) return send(200, []);
      if (url.startsWith('/rest/agile/1.0/board/')) return send(200, { values: [] });
      if (url.startsWith('/rest/agile/1.0/board'))  return send(200, { values: [{ id: 1, name: 'TEST board', type: 'scrum' }] });
      send(404, { error: 'fake jira: not implemented ' + url });
    });
    fakeServer.listen(FAKE_PORT, '127.0.0.1', () => resolve());
    fakeServer.on('error', reject);
  });
}
function stopFakeJira() { if (fakeServer) try { fakeServer.close(); } catch(_) {} }

function startApp() {
  return new Promise((resolve, reject) => {
    const root = path.resolve(__dirname, '..', '..');
    appProc = spawn('node', [path.join(root, 'server.js'), String(APP_PORT)], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, RATE_LIMIT_PER_MIN: '500', INTEGRATION_ALLOW_LOOPBACK: '1' },
    });
    let booted = false;
    appProc.stdout.on('data', (d) => { if (!booted && /LISTENING:/.test(d.toString())) { booted = true; resolve(); } });
    appProc.stderr.on('data', () => {});
    appProc.on('exit', (code) => { if (!booted) reject(new Error('server exit ' + code)); });
    setTimeout(() => { if (!booted) reject(new Error('server boot timeout')); }, 5000);
  });
}
function stopApp() { if (appProc && !appProc.killed) try { appProc.kill('SIGTERM'); } catch(_) {} }

function req(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({
      hostname: '127.0.0.1', port: APP_PORT, path: pathname, method,
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      const cs = []; res.on('data', c => cs.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(cs).toString('utf8') }));
    });
    r.on('error', reject);
    r.setTimeout(8000, () => r.destroy(new Error('req timeout')));
    if (body !== undefined) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}
function j(s) { try { return JSON.parse(s); } catch(_) { return null; } }

function getServerInfoHits() { return _fakeJiraServerInfoHits; }

module.exports = {
  FAKE_PORT, APP_PORT,
  startFakeJira, stopFakeJira,
  startApp, stopApp,
  req, j,
  getServerInfoHits,
};
