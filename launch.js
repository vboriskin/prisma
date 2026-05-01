#!/usr/bin/env node
'use strict';
/* ============================================================
   launch.js — one-click launcher.
   --
   What it does:
     1. Finds a free TCP port starting from 8080 (8081, 8082… up to 8090).
     2. Spawns `node server.js <port>` and forwards its stdout/stderr.
     3. When the server prints `LISTENING:<port>`, opens the user's default
        browser at http://localhost:<port>.
     4. Keeps running until the user closes the terminal window or the
        server process exits.

   Used by:
     · `Запустить (Mac).command`   — double-click on macOS
     · `Запустить (Windows).bat`   — double-click on Windows
     · `npm start`                 — terminal users
   ============================================================ */

const { spawn } = require('child_process');
const net       = require('net');
const path      = require('path');
const os        = require('os');

const ROOT     = __dirname;
const FROM     = parseInt(process.argv[2], 10) || 8080;
const TO       = FROM + 9;
const NODE     = process.execPath;

function isPortFree(port) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

async function findFreePort() {
  for (let p = FROM; p <= TO; p++) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(p)) return p;
  }
  return null;
}

function openInBrowser(url) {
  const platform = os.platform();
  let cmd, args;
  if (platform === 'darwin') { cmd = 'open';      args = [url]; }
  else if (platform === 'win32') { cmd = 'cmd';   args = ['/c', 'start', '""', url]; }
  else /* linux / unknown */     { cmd = 'xdg-open'; args = [url]; }
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    console.warn('[launch] не удалось открыть браузер автоматически:', e.message);
    console.warn('[launch] откройте вручную:', url);
  }
}

(async () => {
  console.log('СБОФ Планирование v11 — запуск…');
  const port = await findFreePort();
  if (!port) {
    console.error(`Все порты ${FROM}–${TO} заняты. Закройте старый запуск или укажите другой порт: node launch.js 9000`);
    process.exit(1);
  }
  if (port !== FROM) {
    console.log(`Порт ${FROM} занят, использую ${port}.`);
  }

  const child = spawn(NODE, [path.join(ROOT, 'server.js'), String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env:  process.env,
  });

  let opened = false;
  const handleOutput = (data) => {
    const text = data.toString();
    process.stdout.write(text);
    if (!opened && /LISTENING:/.test(text)) {
      opened = true;
      const url = `http://localhost:${port}`;
      console.log(`\n  Открываю в браузере: ${url}`);
      console.log('  Чтобы остановить — закройте это окно или нажмите Ctrl+C.\n');
      // Tiny delay so the user sees the message before the browser steals focus.
      setTimeout(() => openInBrowser(url), 250);
    }
  };
  child.stdout.on('data', handleOutput);
  child.stderr.on('data', d => process.stderr.write(d));
  child.on('exit',  (code) => {
    console.log(`\nСервер остановлен (код ${code}).`);
    process.exit(code || 0);
  });
  child.on('error', (e) => {
    console.error('[launch] не удалось запустить server.js:', e.message);
    process.exit(1);
  });

  // Forward Ctrl+C / window-close to the child so it shuts down cleanly.
  const shutdown = (sig) => { try { child.kill(sig); } catch(_) {} };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
})();
