#!/usr/bin/env node
'use strict';
/* ============================================================
   bumpVersion.js — bump APP_VERSION + добавить release entry
   --
   Usage:
     node scripts/bumpVersion.js <major|minor|patch> "Title" "note text|type" ["note2|type" ...]

   Примеры:
     node scripts/bumpVersion.js patch "Toast в центр + LLM hint" \
       "Toast queue centered with z-index 99999|fix" \
       "LLM apiBaseUrl hint в settings|feature"

     node scripts/bumpVersion.js minor "Jenkins integration" \
       "Phase 1+2+3 — full pipeline|feature"

   Что делает:
     1) Читает APP_VERSION из app/version.js
     2) Инкрементит по semver (major/minor/patch)
     3) Добавляет новый ReleaseEntry в RELEASES (вверху массива)
     4) Обновляет APP_VERSION + RELEASE_DATE
     5) Синхронизирует package.json#version

   Контракт note.type ∈ 'major' | 'feature' | 'fix' | 'chore'.
   Если type не указан после `|` — fallback к 'chore'.
   ============================================================ */

const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '..');
const VERSION_JS = path.join(ROOT, 'app', 'version.js');
const PACKAGE_JS = path.join(ROOT, 'package.json');

const ALLOWED_TYPES = new Set(['major', 'feature', 'fix', 'chore']);

function fail(msg) {
  process.stderr.write('[bumpVersion] ' + msg + '\n');
  process.exit(1);
}

function bumpSemver(version, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || '').trim());
  if (!m) fail('Bad semver in version.js: ' + version);
  let [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if      (kind === 'major') { maj += 1; min = 0; pat = 0; }
  else if (kind === 'minor') { min += 1; pat = 0; }
  else if (kind === 'patch') { pat += 1; }
  else fail('bump kind must be major|minor|patch, got: ' + kind);
  return `${maj}.${min}.${pat}`;
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseNotes(args) {
  return args.map((raw) => {
    const i = raw.lastIndexOf('|');
    let text = raw, type = 'chore';
    if (i >= 0) {
      text = raw.slice(0, i).trim();
      type = raw.slice(i + 1).trim().toLowerCase();
    }
    if (!ALLOWED_TYPES.has(type)) type = 'chore';
    if (!text) fail('Empty note text in arg: ' + raw);
    return { type, text };
  });
}

function readCurrentVersion(src) {
  const m = /export\s+const\s+APP_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(src);
  if (!m) fail('APP_VERSION not found in ' + VERSION_JS);
  return m[1];
}

function updateVersionJs(src, { newVersion, newDate, entryLiteral }) {
  let out = src;
  out = out.replace(
    /export\s+const\s+APP_VERSION\s*=\s*['"][^'"]+['"]\s*;/,
    `export const APP_VERSION = '${newVersion}';`,
  );
  out = out.replace(
    /export\s+const\s+RELEASE_DATE\s*=\s*['"][^'"]+['"]\s*;/,
    `export const RELEASE_DATE = '${newDate}';`,
  );
  // Insert новый entry после `export const RELEASES = [`.
  const anchor = /export\s+const\s+RELEASES\s*=\s*\[\s*\n/;
  if (!anchor.test(out)) fail('RELEASES array marker not found in version.js');
  out = out.replace(anchor, (m) => m + entryLiteral);
  return out;
}

function buildEntryLiteral({ version, date, title, notes }) {
  const escapeStr = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const noteLines = notes.map((n) => {
    const typeField = `'${n.type}',`.padEnd(10, ' ');
    return `      { type: ${typeField} text: '${escapeStr(n.text)}' },`;
  }).join('\n');
  return (
    `  {\n` +
    `    version: '${version}',\n` +
    `    date: '${date}',\n` +
    `    title: '${escapeStr(title)}',\n` +
    `    notes: [\n${noteLines}\n    ],\n` +
    `  },\n`
  );
}

function updatePackageJson(srcJson, newVersion) {
  const pkg = JSON.parse(srcJson);
  pkg.version = newVersion;
  return JSON.stringify(pkg, null, 2) + '\n';
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 3) {
    fail(
      'Usage: node scripts/bumpVersion.js <major|minor|patch> "Title" "note|type" ["note2|type" ...]',
    );
  }
  const [kind, title, ...noteArgs] = argv;
  if (!noteArgs.length) fail('At least one note is required');

  const versionSrc = fs.readFileSync(VERSION_JS, 'utf8');
  const pkgSrc     = fs.readFileSync(PACKAGE_JS, 'utf8');

  const currentVersion = readCurrentVersion(versionSrc);
  const newVersion = bumpSemver(currentVersion, kind);
  const newDate    = todayIso();
  const notes      = parseNotes(noteArgs);

  const entryLiteral = buildEntryLiteral({
    version: newVersion,
    date: newDate,
    title,
    notes,
  });

  const newVersionSrc = updateVersionJs(versionSrc, {
    newVersion,
    newDate,
    entryLiteral,
  });
  const newPkgSrc = updatePackageJson(pkgSrc, newVersion);

  fs.writeFileSync(VERSION_JS, newVersionSrc);
  fs.writeFileSync(PACKAGE_JS, newPkgSrc);

  process.stdout.write(
    `[bumpVersion] ${currentVersion} -> ${newVersion} (${kind}); date ${newDate}; ` +
    `${notes.length} note(s) added.\n`,
  );
}

main();
