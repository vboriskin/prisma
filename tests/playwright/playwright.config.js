'use strict';
/* ============================================================
   Playwright config — visual smoke tests for V22+ Scanner / Release 2.0
   ============================================================ */
const { defineConfig, devices } = require('@playwright/test');
const path = require('node:path');

// Внутри зарезервированного диапазона приложения 5470–5489. 5481 — отдельно
// от dev-сервера (5470) и его скан-диапазона (5470–5479), чтобы visual-тесты
// и запущенный dev-сервер не конфликтовали.
const PORT = 5481;

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: process.env.CI
    ? [['list'], ['json', { outputFile: path.resolve(__dirname, '..', '..', 'playwright-report.json') }]]
    : [['list']],
  outputDir: path.join(__dirname, '_out'),
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: { mode: 'only-on-failure', fullPage: true },
    trace: 'retain-on-failure',
    // Bypass welcome-splash + force light theme через initial localStorage seed.
    storageState: {
      cookies: [],
      origins: [{
        origin: `http://127.0.0.1:${PORT}`,
        localStorage: [
          { name: 'welcomeShown',      value: '1' },
          // isFirstRun() === false when completed===true (onboarding.js:27)
          { name: 'q2_onboarding_v1',  value: JSON.stringify({ completed: true, mode: 'demo', step: 0, lastDatasetType: null }) },
        ],
      }],
    },
  },
  webServer: {
    command: `node server.js ${PORT}`,
    cwd: path.resolve(__dirname, '..', '..'),
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
