#!/usr/bin/env node
'use strict';
/* ============================================================
   scripts/token-audit.js — AUDIT_HOLISTIC P2 / Идея 10
   --
   Token-coverage gate: считает raw hex (#abc / #aabbcc / #aabbccdd)
   и var(--*) usages в CSS-файлах. Не fail'ит в CI (пока reporting-tool),
   threshold-based — позволяет зафиксировать текущий level и не давать
   ему расти.

   Что считаем:
     · raw hex      — `#[0-9a-fA-F]{3,8}` (filtered by length 3/4/6/8)
     · var-usages   — `var(--…)`
     · ratio        — vars / (vars + raw)  → доля «через токены»
     · per-file     — топ-15 файлов с raw hex для приоритизации миграции

   Запуск: node scripts/token-audit.js
   Через npm: npm run audit:tokens
   Exit: всегда 0 (reporting-only).
   ============================================================ */

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** Файлы / директории, которые сканируем. */
const CSS_TARGETS = [
  'styles.css',
  'theme.css',
  'pz-design-system.css',
  'obsidian',
  'gantt-redesign',
  'design-audit',
];

/** Игнорируем строки с этими substring'ами (комментарии-ссылки на токены). */
const IGNORE_PATTERNS = [
  /sourceMappingURL/i,
];

/** Walk: возвращает массив абсолютных путей до .css файлов. */
function walkCss(absPath) {
  const out = [];
  const stack = [absPath];
  while (stack.length) {
    const p = stack.pop();
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isFile()) {
      if (p.endsWith('.css')) out.push(p);
    } else if (st.isDirectory()) {
      let entries = [];
      try { entries = fs.readdirSync(p); } catch { continue; }
      for (const e of entries) {
        if (e.startsWith('.')) continue;
        if (e === 'node_modules') continue;
        stack.push(path.join(p, e));
      }
    }
  }
  return out;
}

/** Основной regex'и (правильное эскапирование hash). */
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const VAR_RE = /var\(--[a-zA-Z0-9_-]+/g;

/**
 * Сканирует один файл, возвращает {rawHex, vars, hexList, hexUnique}.
 */
function scanFile(absPath) {
  let text;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch {
    return { rawHex: 0, vars: 0, hexList: [], hexUnique: new Set() };
  }
  const hexList = [];
  const hexUnique = new Set();
  let varCount = 0;

  // Per-line scan чтобы фильтровать ignore-patterns.
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    let skip = false;
    for (const re of IGNORE_PATTERNS) { if (re.test(line)) { skip = true; break; } }
    if (skip) continue;

    const hexes = line.match(HEX_RE) || [];
    for (const h of hexes) {
      // Разрешаем только валидные длины: #rgb / #rgba / #rrggbb / #rrggbbaa.
      const len = h.length - 1; // без `#`
      if (len === 3 || len === 4 || len === 6 || len === 8) {
        hexList.push(h.toLowerCase());
        hexUnique.add(h.toLowerCase());
      }
    }
    const vars = line.match(VAR_RE) || [];
    varCount += vars.length;
  }
  return { rawHex: hexList.length, vars: varCount, hexList, hexUnique };
}

function fmtPct(n) {
  if (!Number.isFinite(n)) return 'n/a';
  return (n * 100).toFixed(1) + '%';
}

function relFromRoot(p) {
  return path.relative(ROOT, p) || path.basename(p);
}

function main() {
  const files = [];
  for (const target of CSS_TARGETS) {
    const abs = path.join(ROOT, target);
    if (!fs.existsSync(abs)) continue;
    files.push(...walkCss(abs));
  }
  // Дедупликация (на случай overlap между targets).
  const uniqFiles = [...new Set(files)];

  let totalRaw = 0;
  let totalVars = 0;
  const totalHexUnique = new Set();
  const perFile = []; // { file, rawHex, vars, hexUnique }

  for (const f of uniqFiles) {
    const r = scanFile(f);
    totalRaw  += r.rawHex;
    totalVars += r.vars;
    for (const h of r.hexUnique) totalHexUnique.add(h);
    perFile.push({
      file: relFromRoot(f),
      rawHex: r.rawHex,
      vars: r.vars,
      hexUnique: r.hexUnique.size,
    });
  }

  // Top-N файлов по количеству raw hex.
  const top = perFile
    .filter(x => x.rawHex > 0)
    .sort((a, b) => b.rawHex - a.rawHex)
    .slice(0, 15);

  const ratio = totalRaw + totalVars === 0
    ? 1
    : totalVars / (totalRaw + totalVars);

  // ── Reporting ───────────────────────────────────────────────
  const lines = [];
  lines.push('=== Pz Token-Coverage Audit (AUDIT_HOLISTIC P2) ===');
  lines.push('');
  lines.push(`Files scanned:        ${uniqFiles.length}`);
  lines.push(`Raw hex usages:       ${totalRaw}`);
  lines.push(`Unique raw hex:       ${totalHexUnique.size}`);
  lines.push(`var(--*) usages:      ${totalVars}`);
  lines.push(`Token coverage:       ${fmtPct(ratio)}  (vars / (vars + raw))`);
  lines.push('');
  lines.push('Top files by raw hex:');
  if (top.length === 0) {
    lines.push('  (none — все цвета через токены)');
  } else {
    const w = Math.max(...top.map(x => x.file.length));
    for (const t of top) {
      lines.push(
        '  ' + t.file.padEnd(w, ' ') +
        '  raw=' + String(t.rawHex).padStart(4, ' ') +
        '  uniq=' + String(t.hexUnique).padStart(3, ' ') +
        '  vars=' + String(t.vars).padStart(4, ' ')
      );
    }
  }
  lines.push('');
  lines.push('Threshold (informational, not enforced):');
  lines.push('  · raw hex total: budget 550 (current 503 per AUDIT_HOLISTIC P2)');
  lines.push('  · unique hex:    budget 220 (current 209)');
  lines.push('  · coverage:      target ≥ 75%');
  lines.push('');
  lines.push('Note: reporting-only. Не fail\'ит CI. Migration plan — docs/pz-design-system.md.');

  // Печать (один newline в конце).
  process.stdout.write(lines.join('\n') + '\n');

  // Always succeed (reporting-only).
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { scanFile, walkCss, main };
