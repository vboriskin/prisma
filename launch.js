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
const fs        = require('fs');
const net       = require('net');
const path      = require('path');
const os        = require('os');

const ROOT     = __dirname;
// V21 BR (audit-05 §F #2, §E #10) — версию читаем из package.json.
// Раньше hardcoded "v11" → рассинхрон с реальностью v21.
let APP_VERSION = '?.?';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  APP_VERSION = `v${pkg.version || '?.?'}`;
} catch (_) {}
const APP_NAME = 'Призма';
// V22 — `--profile` режим: пишем CPU-profile + memory snapshot сервера в
// файл по таймеру, плюс эмитит heap stats каждые 30 сек в stdout. Запуск:
//   node launch.js --profile        (default port)
//   node launch.js 8080 --profile
// Profile-файлы сохраняются в .profile/ рядом с launch.js и переписываются
// между запусками (последний — актуальный).
const PROFILE_FLAG = process.argv.includes('--profile');
const PORT_ARG     = process.argv.find(a => /^\d+$/.test(a));
const FROM     = parseInt(PORT_ARG, 10) || 8080;
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

/* V22 — profile mode helpers (codebase-04 audit §5 tooling). */
function _setupProfileMode() {
  const profDir = path.join(ROOT, '.profile');
  try { fs.mkdirSync(profDir, { recursive: true }); } catch (_) {}
  const profPath = path.join(profDir, 'cpu-profile.cpuprofile');
  const heapPath = path.join(profDir, 'heap-snapshot.heapsnapshot');
  // Включаем V8 inspector и пишем CPU/heap snapshots по сигналу.
  // Через --inspect-brk нельзя — блокирует старт сервера. Используем
  // child_process с NODE_OPTIONS=--cpu-prof и --heap-prof.
  console.log(`[launch:profile] enabled — output: ${profDir}/`);
  console.log(`  cpu-profile: ${profPath}`);
  console.log(`  heap-snapshot: ${heapPath} (на SIGUSR2)`);
  return {
    profDir,
    extraEnv: {
      NODE_OPTIONS: [
        process.env.NODE_OPTIONS || '',
        `--cpu-prof`,
        `--cpu-prof-dir=${profDir}`,
        `--cpu-prof-name=cpu-profile.cpuprofile`,
        `--heap-prof`,
        `--heap-prof-dir=${profDir}`,
        `--heap-prof-name=heap-profile.heapprofile`,
      ].filter(Boolean).join(' '),
    },
  };
}

function _startMemoryReporter(child) {
  // Каждые 30 сек — print heap usage из child через V8 SIGUSR2 (heap-snap)
  // + сразу print parent's RSS как proxy. Не блокируем event-loop.
  const intervalMs = 30000;
  const id = setInterval(() => {
    const used = process.memoryUsage();
    const fmt = (n) => Math.round(n / 1024 / 1024) + 'MB';
    console.log(`[launch:profile] mem rss=${fmt(used.rss)} heap=${fmt(used.heapUsed)}/${fmt(used.heapTotal)} ext=${fmt(used.external)}`);
    // Triggers child heap dump (v8.writeHeapSnapshot via SIGUSR2 hook).
    try { if (!child.killed) child.kill('SIGUSR2'); } catch (_) {}
  }, intervalMs);
  return () => clearInterval(id);
}

/* V22 (2026-05-11) — pretty startup banner.
   Скрывает технические маркеры (`LISTENING:<port>`, JSON-логи `Prisma started`)
   из child stdout, пишет вместо них единый banner с версией/URL/временем. */
function _renderBanner({ name, version, port, profile }) {
  const url = `http://localhost:${port}`;
  const now = new Date().toLocaleString('ru-RU', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const title = `   ${name} ${version}${profile ? ' · profile' : ''}`;
  const titleLen = [...title].length;
  const width = Math.max(titleLen + 4, 50);
  const top = '┌' + '─'.repeat(width - 2) + '┐';
  const mid = '│' + title + ' '.repeat(width - 2 - titleLen) + '│';
  const bot = '└' + '─'.repeat(width - 2) + '┘';
  return [
    '',
    top,
    mid,
    bot,
    '',
    `   →  URL:        ${url}`,
    `   →  Запущено:   ${now}`,
    `   →  Остановка:  Ctrl+C  (или закройте это окно)`,
    `   →  Логи:       LOG_LEVEL=debug node launch.js — подробный вывод`,
    '',
  ].join('\n');
}

/* Фильтр child-stdout: глотает технические маркеры, остальное пропускает.
   `LISTENING:<n>` — внутренний синхро-токен, не для юзера.
   `{"ts":"…","msg":"Prisma started",…}` — дублирует banner.
   В debug-режиме (LOG_LEVEL=debug) — всё пропускаем как есть. */
function _filterChildOutput(text) {
  if (process.env.LOG_LEVEL === 'debug') return text;
  return text
    .split('\n')
    .filter(line => {
      if (/^LISTENING:\d+\s*$/.test(line)) return false;
      if (/^\{"ts":".+","level":"info","msg":"Prisma started"/.test(line)) return false;
      return true;
    })
    .join('\n');
}

(async () => {
  const port = await findFreePort();
  if (!port) {
    console.error(`\n  ⚠  Все порты ${FROM}–${TO} заняты.\n  Закройте старый запуск или укажите другой порт:  node launch.js 9000\n`);
    process.exit(1);
  }
  if (port !== FROM) {
    console.log(`\n  i  Порт ${FROM} занят, использую ${port}.`);
  }

  const profile = PROFILE_FLAG ? _setupProfileMode() : null;
  const env = profile ? { ...process.env, ...profile.extraEnv, PRIZMA_PROFILE: '1' } : process.env;

  const child = spawn(NODE, [path.join(ROOT, 'server.js'), String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });

  const stopMemReporter = profile ? _startMemoryReporter(child) : null;

  let opened = false;
  const handleOutput = (data) => {
    const text = data.toString();
    process.stdout.write(_filterChildOutput(text));
    if (!opened && /LISTENING:/.test(text)) {
      opened = true;
      const url = `http://localhost:${port}`;
      console.log(_renderBanner({
        name: APP_NAME,
        version: APP_VERSION,
        port,
        profile: PROFILE_FLAG,
      }));
      // Tiny delay so the user sees the banner before the browser steals focus.
      setTimeout(() => openInBrowser(url), 250);
    }
  };
  child.stdout.on('data', handleOutput);
  child.stderr.on('data', d => process.stderr.write(d));
  child.on('exit',  (code) => {
    if (stopMemReporter) stopMemReporter();
    if (profile) {
      console.log(`\n[launch:profile] CPU/heap profiles в ${profile.profDir}/`);
      console.log(`  Загрузить в Chrome DevTools → Performance/Memory → Load profile`);
    }
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
