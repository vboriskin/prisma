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
  // V22+ Phase 5 — welcome flow многоступенчатый:
  //   Шаг 1: #welcomeOverlay (Призма / Сверить курс / Restore?)
  //   Шаг 2: после dismiss → onboardingUI показывает empty-state c
  //          кнопками #ob-empty-demo «Посмотреть демо» / file-import
  // Чтобы получить богатый dataset, кликаем «Посмотреть демо» (через id'шник).
  // 1. Дождаться welcome overlay
  const overlay = page.locator('#welcomeOverlay');
  if (await overlay.isVisible({ timeout: 1500 }).catch(() => false)) {
    // Если есть restore-button — выбираем «Начать заново»
    const restoreNo = page.locator('#welcomeRestoreNo');
    if (await restoreNo.isVisible({ timeout: 300 }).catch(() => false)) {
      await restoreNo.click();
    } else {
      const cta = page.locator('#welcomeCtaBtn');
      if (await cta.isVisible({ timeout: 300 }).catch(() => false)) {
        await cta.click();
      }
    }
    await page.waitForTimeout(800);
  }
  // 2. После dismiss — есть либо empty-state, либо main UI с overlay'ем «Посмотреть демо».
  //    Жмём на demo-кнопку через ID (надёжнее text-locator).
  for (const sel of ['#ob-empty-demo', '#ob-btn-demo', 'text=Посмотреть демо', 'text=Шаблон демо']) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 600 }).catch(() => false)) {
      await btn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1800);   // дать demo-data загрузиться (loadDemoData)
      break;
    }
  }
  // 3. После загрузки demo стартует onboarding-tour («Это Обсидиан / Маленький наблюдатель»).
  //    Жмём «Пропустить» чтобы освободить main UI для Nav.go().
  for (let i = 0; i < 5; i++) {
    const skip = page.locator('text=Пропустить').first();
    if (await skip.isVisible({ timeout: 500 }).catch(() => false)) {
      await skip.click({ force: true }).catch(() => {});
      await page.waitForTimeout(400);
    } else {
      break;
    }
  }
  // 4. Закрыть любые toast'ы / banner'ы (например «Демо-данные загружены — N задач»)
  const toastClose = page.locator('[aria-label="Закрыть"], .toast button[type="button"]').first();
  if (await toastClose.isVisible({ timeout: 300 }).catch(() => false)) {
    await toastClose.click({ force: true }).catch(() => {});
  }
  await page.waitForTimeout(400);
}

async function gotoSection(page, sectionKey) {
  // V22+ — Nav.goTo (не Nav.go). Тройной fallback:
  //   1. window.Nav.goTo()
  //   2. click по .nav-item[data-section=<key>]
  //   3. location.hash = #<key>
  const ok = await page.evaluate((sec) => {
    if (typeof window.Nav?.goTo === 'function') {
      window.Nav.goTo(sec);
      return 'nav-goto';
    }
    const btn = document.querySelector(`.nav-item[data-section="${sec}"]`);
    if (btn) { btn.click(); return 'nav-click'; }
    location.hash = '#' + sec;
    return 'hash';
  }, sectionKey);
  // eslint-disable-next-line no-console
  if (ok !== 'nav-goto') console.log('[nav] fallback =', ok, 'for', sectionKey);
  await page.waitForTimeout(1500);
}

// V22+ — реальные section-keys из index.html (по data-section)
const VIEWS = [
  { key: 'dashboard',         label: 'Дашборд' },
  { key: 'metrics',           label: 'Метрики' },
  { key: 'registry',          label: 'Реестр' },
  { key: 'gantt',             label: 'Гант' },
  { key: 'kanban',            label: 'Канбан' },
  { key: 'timeline',          label: 'Таймлайн' },
  { key: 'podlozhka',         label: 'Подложка' },
  { key: 'history',           label: 'История' },
  { key: 'employees',         label: 'Сотрудники' },
  { key: 'burnout',           label: 'Перегрузка' },
  { key: 'component-health',  label: 'Здоровье компонентов' },
  { key: 'ai-ceo',            label: 'AI CEO' },
  { key: 'exec',              label: 'CEO-режим' },
  { key: 'actions',           label: 'Действия' },
  { key: 'ai',                label: 'AI Анализ' },
  { key: 'est-calibration',   label: 'Точность оценок' },
  { key: 'doc-debt',          label: 'Документация: долги' },
  { key: 'integrations',      label: 'Интеграции' },
  { key: 'diagnostics',       label: 'Диагностика' },
  { key: 'errors',            label: 'Ошибки' },
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
  test('mascot visible on Scanner (regression «чат не открыть»)', async ({ page }) => {
    // 2026-05-17 — раньше тест проверял что mascot СКРЫТ на Scanner. Это
    // поведение откатили: mascot нужен для открытия чат-ассистента,
    // пользователь не мог открыть чат на Scanner. Скрытие FAB осталось
    // ТОЛЬКО для body.is-ts2-modal-open. Этот тест теперь проверяет
    // обратное — FAB видим на Scanner (без modal'а).
    //
    // Навигация: hash-only смены недостаточно (body.ts2-active не всегда
    // выставляется). Кликаем на Интеграции в nav, чтобы init-script гарантированно
    // повесил scanner-класс — как делает scanner-smoke.spec.js gotoScannerDemo().
    await setupErrorCapture(page, 'Mascot visible');
    await page.goto('/');
    await bypassWelcome(page);
    await page.evaluate(() => { location.hash = '#scanner2/demo'; });
    await page.waitForTimeout(2500);
    const navIntegrations = page.locator('[data-section="integrations"]').first();
    if (await navIntegrations.isVisible({ timeout: 1000 }).catch(() => false)) {
      await navIntegrations.click();
      await page.waitForTimeout(1500);
    }

    const hasModalClass = await page.evaluate(() => document.body.classList.contains('is-ts2-modal-open'));
    const fabDisplay = await page.locator('#assistant-fab').evaluate(
      el => window.getComputedStyle(el).display
    ).catch(() => 'gone');

    // Главное assertion: без modal'а FAB должен быть видим (display !== 'none').
    // body.ts2-active — production-сигнал, в Playwright bypass'е не всегда
    // выставляется, не делаем его блокирующим assertion'ом.
    if (!hasModalClass && fabDisplay === 'none') {
      recordFinding('Mascot visible', 'mascot-hidden-no-modal', `modal=false, но FAB display=none — чат не открыть`);
    }
    if (!hasModalClass) {
      expect(fabDisplay).not.toBe('none');
    }
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
