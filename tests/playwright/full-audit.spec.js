'use strict';
/* ============================================================
   tests/playwright/full-audit.spec.js — V22+ полный e2e visual audit.

   Прокликивает все основные view'ы Призмы:
     · Реестр (Registry)
     · Гант (Gantt)
     · Чёрный дашборд
     · Метрики
     · Сводная
     · Инсайты
     · Сотрудники (Employees)
     · AI Анализ
     · AI CEO
     · Интеграции — Сканнер команд (demo)
     · Интеграции — Чёрный дашборд
     · Интеграции — Release 2.0
     · Чат-ассистент (FAB)
     · Настройки
     · История
     · Ошибки

   Каждый view:
     · открывается через Nav.go
     · ждёт 1.5с на рендер
     · ловит console.error / page.error
     · скриншот в _out/snapshots/
     · кладёт findings в shared map для итогового отчёта
   ============================================================ */

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const SNAP_DIR = path.resolve(__dirname, '_out', 'snapshots');
const FINDINGS_FILE = path.resolve(__dirname, '_out', 'findings.json');
fs.mkdirSync(SNAP_DIR, { recursive: true });

const findings = [];

function recordFinding(section, kind, detail) {
  findings.push({ section, kind, detail, ts: Date.now() });
}

test.afterAll(() => {
  fs.writeFileSync(FINDINGS_FILE, JSON.stringify(findings, null, 2), 'utf8');
});

async function setupErrorCapture(page, section) {
  page.on('pageerror', err => {
    recordFinding(section, 'pageerror', String(err?.message || err));
  });
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // skip well-known non-issues (CSP report, Promise reject already caught)
      if (/Refused to load|Failed to load resource/.test(text)) return;
      recordFinding(section, 'console-error', text);
    }
  });
  page.on('response', resp => {
    if (resp.status() >= 400 && !resp.url().includes('/api/jira/')) {
      // 4xx на /api/jira/* — нормально без токенов
      recordFinding(section, 'http-' + resp.status(), resp.url());
    }
  });
}

async function bypassWelcome(page) {
  const cta = page.locator('#welcomeCtaBtn');
  if (await cta.isVisible({ timeout: 2000 }).catch(() => false)) {
    await cta.click();
    await page.waitForTimeout(1000);
  }
}

async function gotoSection(page, sectionKey) {
  await page.evaluate((sec) => {
    if (typeof window.Nav?.go === 'function') window.Nav.go(sec);
    else { location.hash = '#' + sec; }
  }, sectionKey);
  await page.waitForTimeout(1500);
}

const VIEWS = [
  { key: 'registry',    label: 'Реестр',          hash: '#registry' },
  { key: 'gantt',       label: 'Гант',            hash: '#gantt' },
  { key: 'dashboard',   label: 'Дашборд',         hash: '#dashboard' },
  { key: 'metrics',     label: 'Метрики',         hash: '#metrics' },
  { key: 'summary',     label: 'Сводная',         hash: '#summary' },
  { key: 'insights',    label: 'Инсайты',         hash: '#insights' },
  { key: 'employees',   label: 'Сотрудники',      hash: '#employees' },
  { key: 'aiAnalysis',  label: 'AI Анализ',       hash: '#aiAnalysis' },
  { key: 'aiCeo',       label: 'AI CEO',          hash: '#aiCeo' },
  { key: 'integrations', label: 'Интеграции',     hash: '#integrations' },
  { key: 'history',     label: 'История',         hash: '#history' },
  { key: 'errors',      label: 'Ошибки',          hash: '#errors' },
  { key: 'settings',    label: 'Настройки',       hash: '#settings' },
];

test.describe.serial('Full audit — пробегаем по всем view', () => {
  for (let i = 0; i < VIEWS.length; i++) {
    const v = VIEWS[i];
    test(`[${String(i + 1).padStart(2, '0')}] ${v.label}`, async ({ page }) => {
      await setupErrorCapture(page, v.label);
      await page.goto('/');
      await bypassWelcome(page);
      await gotoSection(page, v.key);

      // Дополнительный wait если есть spinner
      const spinner = page.locator('.r2-loader-spinner, .ts2-loader, [data-loading]').first();
      if (await spinner.isVisible({ timeout: 500 }).catch(() => false)) {
        await spinner.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
      }

      await page.screenshot({
        path: path.join(SNAP_DIR, `view-${String(i + 1).padStart(2, '0')}-${v.key}.png`),
        fullPage: false,  // viewport-only — full может быть слишком тяжело для 13 views
      });

      // Поверхностный sanity-check — в DOM должен быть какой-то контент
      const bodyText = await page.locator('body').innerText().catch(() => '');
      if (bodyText.length < 50) {
        recordFinding(v.label, 'empty-body', `bodyText.length=${bodyText.length}`);
      }
    });
  }
});

test.describe('Integration sub-tabs', () => {
  test('Сканнер команд demo', async ({ page }) => {
    await setupErrorCapture(page, 'Сканнер демо');
    await page.goto('/');
    await bypassWelcome(page);
    await page.evaluate(() => { location.hash = '#scanner2/demo'; });
    await page.waitForTimeout(3000);
    await page.screenshot({
      path: path.join(SNAP_DIR, 'integrations-scanner-demo.png'),
      fullPage: true,
    });
  });

  test('Чёрный дашборд sub-tab', async ({ page }) => {
    await setupErrorCapture(page, 'Чёрный дашборд (sub-tab)');
    await page.goto('/');
    await bypassWelcome(page);
    await gotoSection(page, 'integrations');
    await page.waitForTimeout(1000);
    const blackTab = page.locator('text=Чёрный дашборд').first();
    if (await blackTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await blackTab.click();
      await page.waitForTimeout(2500);
    }
    await page.screenshot({
      path: path.join(SNAP_DIR, 'integrations-black-dashboard.png'),
      fullPage: true,
    });
  });

  test('Release 2.0 sub-tab', async ({ page }) => {
    await setupErrorCapture(page, 'Release 2.0 (sub-tab)');
    await page.goto('/');
    await bypassWelcome(page);
    await gotoSection(page, 'integrations');
    await page.waitForTimeout(1000);
    const r2tab = page.locator('text=Release 2.0').first();
    if (await r2tab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await r2tab.click();
      await page.waitForTimeout(3000);
    }
    await page.screenshot({
      path: path.join(SNAP_DIR, 'integrations-release2.png'),
      fullPage: true,
    });
  });
});

test.describe('Chat assistant', () => {
  test('FAB opens panel', async ({ page }) => {
    await setupErrorCapture(page, 'Chat FAB');
    await page.goto('/');
    await bypassWelcome(page);
    await page.waitForTimeout(800);

    const fab = page.locator('#assistant-fab');
    if (await fab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await fab.click();
      await page.waitForTimeout(1000);
      await page.screenshot({
        path: path.join(SNAP_DIR, 'chat-assistant-open.png'),
        fullPage: false,
      });
      // Должна появиться панель ассистента
      const panel = page.locator('#assistant-panel, .assistant-panel').first();
      const opened = await panel.isVisible({ timeout: 1000 }).catch(() => false);
      if (!opened) {
        recordFinding('Chat FAB', 'fab-click-no-panel', 'panel did not appear after click');
      }
    } else {
      recordFinding('Chat FAB', 'fab-not-visible', 'assistant-fab не найден');
    }
  });
});

test.describe('Sanity checks', () => {
  test('mascot hide on Scanner', async ({ page }) => {
    await setupErrorCapture(page, 'Mascot hide');
    await page.goto('/');
    await bypassWelcome(page);
    await page.evaluate(() => { location.hash = '#scanner2/demo'; });
    await page.waitForTimeout(2500);

    const hasClass = await page.evaluate(() => document.body.classList.contains('ts2-active'));
    const fabDisplay = await page.locator('#assistant-fab').evaluate(
      el => window.getComputedStyle(el).display
    ).catch(() => 'gone');

    if (hasClass && fabDisplay !== 'none') {
      recordFinding('Mascot hide', 'mascot-not-hidden', `body.ts2-active=true но FAB display=${fabDisplay}`);
    }
    expect(hasClass).toBe(true);
  });

  test('no welcome blocking after first visit', async ({ page }) => {
    await setupErrorCapture(page, 'Welcome');
    await page.goto('/');
    await page.waitForTimeout(500);
    const cta = page.locator('#welcomeCtaBtn');
    const welcomeVisible = await cta.isVisible({ timeout: 1500 }).catch(() => false);
    if (welcomeVisible) {
      // Это first-run путь — нормально. Просто фиксируем.
      recordFinding('Welcome', 'first-run-splash', 'welcomeCtaBtn visible на /');
    }
  });
});
