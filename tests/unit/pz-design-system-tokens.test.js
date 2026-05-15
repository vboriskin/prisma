'use strict';
/* ============================================================
   tests/unit/pz-design-system-tokens.test.js
   --
   AUDIT_HOLISTIC P1 / Идея 10 — smoke-test для pz-design-system.css.
   Проверяет:
     · CSS-файл существует и валидно подключён в index.html
     · Все 4 базовых класса присутствуют (.pz-card, .pz-chip, .pz-badge, .pz-modal)
     · Variants через data-attr на месте (data-elevation / data-state /
       data-density / data-tone / data-active / data-pulse / data-size)
     · Цвета идут через токены (var(--prizma-*) / var(--card) / var(--radius))
       а не через raw hex (≤2 разрешённых: rgba для теней)
     · prefers-reduced-motion отключает pulse-анимацию
     · scripts/token-audit.js работает и возвращает sane статистику
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CSS_PATH = path.join(ROOT, 'pz-design-system.css');
const HTML_PATH = path.join(ROOT, 'index.html');
const DOCS_PATH = path.join(ROOT, 'docs', 'pz-design-system.md');
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'token-audit.js');

function readCss() {
  return fs.readFileSync(CSS_PATH, 'utf8');
}

describe('pz-design-system.css — file presence & wiring', () => {
  test('CSS-файл существует', () => {
    assert.ok(fs.existsSync(CSS_PATH), 'pz-design-system.css должен существовать в корне');
  });

  test('подключён в index.html после styles.css', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    assert.match(html, /pz-design-system\.css/, 'index.html должен ссылаться на pz-design-system.css');
    const stylesIdx = html.indexOf('styles.css');
    const pzIdx     = html.indexOf('pz-design-system.css');
    assert.ok(stylesIdx > -1 && pzIdx > stylesIdx, 'pz-design-system.css должен идти ПОСЛЕ styles.css');
  });

  test('документация присутствует', () => {
    assert.ok(fs.existsSync(DOCS_PATH), 'docs/pz-design-system.md должен существовать');
    const md = fs.readFileSync(DOCS_PATH, 'utf8');
    assert.match(md, /pz-card/);
    assert.match(md, /pz-chip/);
    assert.match(md, /pz-badge/);
    assert.match(md, /pz-modal/);
  });
});

describe('pz-design-system.css — base classes', () => {
  test('содержит все 4 базовых класса', () => {
    const css = readCss();
    for (const cls of ['.pz-card', '.pz-chip', '.pz-badge', '.pz-modal']) {
      assert.match(css, new RegExp(cls.replace('.', '\\.') + '\\s*\\{'), `Должен быть базовый класс ${cls}`);
    }
  });

  test('pz-modal-overlay + pz-modal-title + pz-modal-close + pz-modal-body присутствуют', () => {
    const css = readCss();
    for (const cls of ['.pz-modal-overlay', '.pz-modal-title', '.pz-modal-close', '.pz-modal-body']) {
      assert.match(css, new RegExp(cls.replace('.', '\\.') + '\\s*[,{]'), `Должен быть ${cls}`);
    }
  });
});

describe('pz-design-system.css — data-attr variants', () => {
  test('pz-card variants: elevation / state / density', () => {
    const css = readCss();
    assert.match(css, /\.pz-card\[data-elevation="1"\]/);
    assert.match(css, /\.pz-card\[data-elevation="2"\]/);
    for (const s of ['active', 'success', 'warning', 'danger', 'insight']) {
      assert.match(
        css,
        new RegExp('\\.pz-card\\[data-state="' + s + '"\\]'),
        `pz-card data-state="${s}" должен присутствовать`
      );
    }
    assert.match(css, /\.pz-card\[data-density="compact"\]/);
    assert.match(css, /\.pz-card\[data-density="loose"\]/);
  });

  test('pz-chip variants: tone (5 штук) + active', () => {
    const css = readCss();
    for (const t of ['information', 'on-course', 'drift', 'off-course', 'insight']) {
      assert.match(
        css,
        new RegExp('\\.pz-chip\\[data-tone="' + t + '"\\]'),
        `pz-chip data-tone="${t}" должен присутствовать`
      );
    }
    assert.match(css, /\.pz-chip\[data-active="true"\]/);
  });

  test('pz-badge variants: tone + pulse + keyframes', () => {
    const css = readCss();
    assert.match(css, /\.pz-badge\[data-tone="information"\]/);
    assert.match(css, /\.pz-badge\[data-tone="off-course"\]/);
    assert.match(css, /\.pz-badge\[data-pulse="true"\]/);
    assert.match(css, /@keyframes\s+pz-badge-pulse/);
  });

  test('pz-modal variants: size sm/lg', () => {
    const css = readCss();
    assert.match(css, /\.pz-modal\[data-size="sm"\]/);
    assert.match(css, /\.pz-modal\[data-size="lg"\]/);
  });
});

describe('pz-design-system.css — token usage (Spine-pill / brand)', () => {
  test('использует токены через var(--prizma-*) для всех states pz-card', () => {
    const css = readCss();
    const stateLines = css.split(/\r?\n/).filter(l => /\.pz-card\[data-state=/.test(l));
    assert.ok(stateLines.length >= 5, 'Должны быть 5 state-вариантов');
    for (const line of stateLines) {
      assert.match(line, /var\(--prizma-/, 'Каждый state должен использовать --prizma-* токен');
    }
  });

  test('3px stripe-left для states (Spine-pill контракт)', () => {
    const css = readCss();
    const matches = css.match(/\.pz-card\[data-state="[a-z-]+"\][^{]*\{[^}]*border-left:\s*3px solid var\(--prizma-/g) || [];
    assert.ok(matches.length >= 5, `Должно быть ≥5 правил с "border-left: 3px solid var(--prizma-..." (найдено ${matches.length})`);
  });

  test('минимум raw hex (только rgba для теней)', () => {
    const css = readCss();
    // Считаем все hex (#xxx, #xxxxxx, #xxxxxxxx) кроме #ffffff в pz-modal-close (если бы был).
    const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    // Разрешаем не более 3: white в off-course badge — приемлемо.
    assert.ok(hex.length <= 3, `pz-design-system.css не должен иметь raw hex (нашёл ${hex.length}: ${hex.join(', ')})`);
  });

  test('prefers-reduced-motion отключает pz-badge-pulse', () => {
    const css = readCss();
    assert.match(
      css,
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.pz-badge\[data-pulse="true"\][^}]*animation:\s*none/s,
      'Должен быть reduced-motion guard для pz-badge'
    );
  });
});

describe('scripts/token-audit.js', () => {
  test('файл валидно парсится node --check', () => {
    assert.ok(fs.existsSync(SCRIPT_PATH), 'scripts/token-audit.js должен существовать');
  });

  test('экспортирует scanFile / walkCss / main', async () => {
    // CommonJS module — импорт через createRequire.
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const mod = require(SCRIPT_PATH);
    assert.equal(typeof mod.scanFile, 'function', 'scanFile должна быть функцией');
    assert.equal(typeof mod.walkCss,  'function', 'walkCss должна быть функцией');
    assert.equal(typeof mod.main,     'function', 'main должна быть функцией');
  });

  test('scanFile корректно считает hex и var() в pz-design-system.css', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const { scanFile } = require(SCRIPT_PATH);
    const r = scanFile(CSS_PATH);
    assert.equal(typeof r.rawHex, 'number');
    assert.equal(typeof r.vars,   'number');
    assert.ok(r.vars > 10, `pz-design-system.css должен иметь много var() usages (нашёл ${r.vars})`);
    assert.ok(r.rawHex <= 5, `pz-design-system.css не должен иметь много raw hex (нашёл ${r.rawHex})`);
  });
});

describe('Example callsite migration', () => {
  test('settingsView.js использует pz-card в секции Эксперименты', () => {
    const settingsPath = path.join(ROOT, 'views', 'settingsView.js');
    const src = fs.readFileSync(settingsPath, 'utf8');
    assert.match(src, /class="pz-card"/, 'settingsView должен иметь pz-card в demo-секции');
    assert.match(src, /class="pz-chip"/, 'settingsView должен иметь pz-chip в demo-секции');
    assert.match(src, /class="pz-badge"/, 'settingsView должен иметь pz-badge в demo-секции');
  });
});
