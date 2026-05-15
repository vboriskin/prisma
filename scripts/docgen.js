#!/usr/bin/env node
'use strict';
/* ============================================================
   docgen.js — minimal documentation generator (AUDIT_HOLISTIC P8 phase-1)
   --
   Не запускается в CI. Опт-ин через `npm run docs:gen`.
   --
   Что делает:
   1) Сканирует `state.js` + `rowFactory.js` JSDoc → собирает stub
      `docs/state-shape.generated.md` (пишется рядом с state-shape.md, не
      перезаписывая его). Финальный merge — задача phase-2.
   2) Извлекает MAP-блок (```...```) из `CLAUDE.md` секции "Карта в 30 секунд"
      → пишет `docs/architecture-map.md`.

   Контракт: НЕ перезаписывает существующие docs (`state-shape.md` /
   `tone-of-voice.md` / `glossary.md`). Только пишет `*.generated.md` и
   `architecture-map.md` (последний — derivative MAP-снимка).
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

function read(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; }
}

function write(p, body) {
  fs.writeFileSync(p, body, 'utf8');
  console.log(`[docgen] wrote ${path.relative(ROOT, p)} (${body.length} bytes)`);
}

/* ---- 1. state-shape.generated.md ---- */

function collectJsDocBlocks(src) {
  // Очень простой block-parser: ищем /** ... */ перед key: или function name.
  const blocks = [];
  const re = /\/\*\*([\s\S]*?)\*\/\s*([A-Za-z_$][\w$.]*)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const body = m[1].split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean).join('\n');
    blocks.push({ name: m[2], doc: body });
  }
  return blocks;
}

function buildStateShape() {
  const stateSrc = read(path.join(ROOT, 'state.js'));
  const rowSrc = read(path.join(ROOT, 'rowFactory.js'));
  const stateBlocks = collectJsDocBlocks(stateSrc);
  const rowBlocks = collectJsDocBlocks(rowSrc);

  // Top-level keys из _rawState.
  const rawMatch = stateSrc.match(/_rawState\s*=\s*\{([\s\S]*?)\n\}\s*;/);
  const topLevelKeys = [];
  if (rawMatch) {
    const lines = rawMatch[1].split('\n');
    for (const line of lines) {
      const km = line.match(/^\s*([a-zA-Z_$][\w$]*)\s*:/);
      if (km) topLevelKeys.push(km[1]);
    }
  }

  const md = [];
  md.push('# State Shape (auto-generated)');
  md.push('');
  md.push('> Сгенерировано из `state.js` + `rowFactory.js` через `scripts/docgen.js`.');
  md.push('> Для финального документа смотри [`state-shape.md`](./state-shape.md).');
  md.push(`> Дата: ${new Date().toISOString().slice(0, 10)}`);
  md.push('');
  md.push('## Top-level keys (из `_rawState`)');
  md.push('');
  md.push(topLevelKeys.length
    ? topLevelKeys.map(k => `- \`state.${k}\``).join('\n')
    : '_Не удалось распарсить `_rawState`._');
  md.push('');
  md.push(`## JSDoc blocks: state.js (${stateBlocks.length})`);
  md.push('');
  for (const b of stateBlocks) {
    md.push(`### \`${b.name}\``);
    md.push('');
    md.push(b.doc);
    md.push('');
  }
  md.push(`## JSDoc blocks: rowFactory.js (${rowBlocks.length})`);
  md.push('');
  for (const b of rowBlocks) {
    md.push(`### \`${b.name}\``);
    md.push('');
    md.push(b.doc);
    md.push('');
  }
  return md.join('\n');
}

/* ---- 2. architecture-map.md ---- */

function buildArchMap() {
  const claude = read(path.join(ROOT, 'CLAUDE.md'));
  // Section "Карта в 30 секунд" + первый ```...``` после неё.
  const idx = claude.indexOf('Карта в 30 секунд');
  let block = '';
  if (idx !== -1) {
    const after = claude.slice(idx);
    const cb = after.match(/```([\s\S]*?)```/);
    if (cb) block = cb[1];
  }
  const md = [];
  md.push('# Architecture Map (auto-generated from CLAUDE.md)');
  md.push('');
  md.push('> Извлечено из `CLAUDE.md` секции «Карта в 30 секунд» через `scripts/docgen.js`.');
  md.push(`> Дата: ${new Date().toISOString().slice(0, 10)}`);
  md.push('');
  md.push('```');
  md.push(block.trim() || '(MAP block not found)');
  md.push('```');
  md.push('');
  md.push('Для high-level diagram (data-flow) см. [`../ARCHITECTURE.md`](../ARCHITECTURE.md).');
  return md.join('\n');
}

/* ---- main ---- */

function main() {
  if (!fs.existsSync(DOCS)) {
    console.error(`[docgen] FATAL: ${DOCS} does not exist`);
    process.exit(1);
  }
  write(path.join(DOCS, 'state-shape.generated.md'), buildStateShape());
  write(path.join(DOCS, 'architecture-map.md'), buildArchMap());
  console.log('[docgen] done.');
}

if (require.main === module) main();

module.exports = { buildStateShape, buildArchMap, collectJsDocBlocks };
