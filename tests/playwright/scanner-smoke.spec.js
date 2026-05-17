'use strict';
/* ============================================================
   Scanner + Release 2.0 smoke — Sprint C/D visual verification.

   Demo-режим Сканнера: #scanner2/demo + клик #welcomeCtaBtn для bypass'а
   welcome-splash. teamScanner2DemoFixture даёт 4 команды (DEMO/ANL/QA/FE),
   18 участников, 4 поведенческих класса, 5 sprint goals.
   ============================================================ */

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const SNAP_DIR = path.resolve(__dirname, '_out', 'snapshots');
fs.mkdirSync(SNAP_DIR, { recursive: true });

async function bypassWelcome(page) {
  const cta = page.locator('#welcomeCtaBtn');
  if (await cta.isVisible({ timeout: 2000 }).catch(() => false)) {
    await cta.click();
    await page.waitForTimeout(1200);
  }
}

async function gotoScannerDemo(page) {
  await page.goto('/');
  await bypassWelcome(page);
  await page.evaluate(() => { location.hash = '#scanner2/demo'; });
  await page.waitForTimeout(2500);
  // Ensure we're on Integrations section
  const navIntegrations = page.locator('[data-section="integrations"]').first();
  if (await navIntegrations.isVisible({ timeout: 1000 }).catch(() => false)) {
    await navIntegrations.click();
    await page.waitForTimeout(1500);
  }
}

test.describe('Сканнер команд — V22+ Phase 5.2', () => {
  test('hero + teams overview', async ({ page }) => {
    await gotoScannerDemo(page);
    // Soft check — hero должен быть отрисован
    const heroExists = await page.locator('.ts2-glance').count() > 0;
    // eslint-disable-next-line no-console
    console.log('[check] hero rendered:', heroExists);
    await page.screenshot({
      path: path.join(SNAP_DIR, '01-scanner-overview.png'),
      fullPage: true,
    });
  });

  test('person row expand', async ({ page }) => {
    await gotoScannerDemo(page);
    const firstRow = page.locator('.ts2-row').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await page.waitForTimeout(800);
    }
    await page.screenshot({
      path: path.join(SNAP_DIR, '02-scanner-person-card.png'),
      fullPage: true,
    });
  });

  test('mascot hide check', async ({ page }) => {
    await gotoScannerDemo(page);
    const hasClass = await page.evaluate(() => document.body.classList.contains('ts2-active'));
    const fabDisplay = await page.locator('#assistant-fab').evaluate(
      el => window.getComputedStyle(el).display
    ).catch(() => 'gone');
    // eslint-disable-next-line no-console
    console.log('[check] body.ts2-active =', hasClass, '| fab.display =', fabDisplay);
    if (hasClass) {
      expect(fabDisplay).toBe('none');
    }
    await page.screenshot({
      path: path.join(SNAP_DIR, '03-mascot-check.png'),
      fullPage: true,
    });
  });

  test('Глубже tab — person detail page', async ({ page }) => {
    await gotoScannerDemo(page);
    // Кликаем «Глубже» tab
    const glubzheTab = page.locator('text=Глубже').first();
    if (await glubzheTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await glubzheTab.click();
      await page.waitForTimeout(1000);
    }
    await page.screenshot({
      path: path.join(SNAP_DIR, '04-scanner-glubzhe.png'),
      fullPage: true,
    });
  });
});
