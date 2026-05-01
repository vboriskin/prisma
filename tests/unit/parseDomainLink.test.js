'use strict';
/* ============================================================
   tests/unit/parseDomainLink.test.js
   --
   Tests for the server-side `_parseDomainLink` helper. After audit
   #19 decomposition the function now lives in
   `server/integrations/blackDashboard.js` (still not exported), so
   we extract the function source via regex + `new Function(...)`.
   Any drift will produce an extract failure that pinpoints the change.
   ============================================================ */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(here, '..', '..', 'server', 'integrations', 'blackDashboard.js');

let parseDomainLink;

before(() => {
  const src = readFileSync(MODULE_PATH, 'utf8');
  // Match: function _parseDomainLink(raw) { ... } — non-greedy until matching `\n}` at column 0.
  const fn = src.match(/function _parseDomainLink\(raw\)\s*\{[\s\S]*?\n\}/);
  if (!fn) throw new Error('_parseDomainLink not found in server/integrations/blackDashboard.js — did the function rename?');
  // eslint-disable-next-line no-new-func
  parseDomainLink = new Function(`${fn[0]}\nreturn _parseDomainLink;`)();
});

describe('_parseDomainLink — array forms', () => {
  test('plain array of strings', () => {
    assert.deepEqual(parseDomainLink(['PAY-1', 'PAY-2']), ['PAY-1', 'PAY-2']);
  });

  test('array of {value} objects', () => {
    assert.deepEqual(parseDomainLink([{ value: 'PAY-1' }, { value: 'KYC-7' }]), ['PAY-1', 'KYC-7']);
  });

  test('array of {key} objects', () => {
    assert.deepEqual(parseDomainLink([{ key: 'PAY-1' }]), ['PAY-1']);
  });

  test('array of {name} objects', () => {
    assert.deepEqual(parseDomainLink([{ name: 'SBOF-12' }]), ['SBOF-12']);
  });

  test('array of {id} as a fallback', () => {
    assert.deepEqual(parseDomainLink([{ id: 'PAY-9' }]), ['PAY-9']);
  });

  test('mixed shapes in one array', () => {
    assert.deepEqual(
      parseDomainLink(['PAY-1', { value: 'KYC-2' }, { key: 'SBOF-3' }]),
      ['PAY-1', 'KYC-2', 'SBOF-3'],
    );
  });
});

describe('_parseDomainLink — string forms', () => {
  test('comma-separated', () => {
    assert.deepEqual(parseDomainLink('PAY-1, KYC-2, SBOF-3'), ['PAY-1', 'KYC-2', 'SBOF-3']);
  });

  test('semicolon-separated', () => {
    assert.deepEqual(parseDomainLink('PAY-1; KYC-2'), ['PAY-1', 'KYC-2']);
  });

  test('whitespace-separated', () => {
    assert.deepEqual(parseDomainLink('PAY-1   KYC-2  SBOF-3'), ['PAY-1', 'KYC-2', 'SBOF-3']);
  });

  test('JSON-encoded array', () => {
    assert.deepEqual(parseDomainLink('["PAY-1","KYC-2"]'), ['PAY-1', 'KYC-2']);
  });

  test('JSON-encoded array with whitespace and weird quoting', () => {
    assert.deepEqual(parseDomainLink('  ["PAY-1", "KYC-2"]  '), ['PAY-1', 'KYC-2']);
  });

  test('cyrillic key prefix preserved (uppercased)', () => {
    assert.deepEqual(parseDomainLink('ЦЕЛЬ-1'), ['ЦЕЛЬ-1']);
  });
});

describe('_parseDomainLink — null / empty / garbage', () => {
  test('null returns empty array', () => {
    assert.deepEqual(parseDomainLink(null), []);
  });

  test('undefined returns empty array', () => {
    assert.deepEqual(parseDomainLink(undefined), []);
  });

  test('empty array returns empty array', () => {
    assert.deepEqual(parseDomainLink([]), []);
  });

  test('non-array, non-string number returns empty array', () => {
    assert.deepEqual(parseDomainLink(42), []);
  });

  test('garbage strings are filtered out, valid keys kept', () => {
    assert.deepEqual(parseDomainLink(['PAY-1', 'garbage', 'lower-case-key', 'PAY-2']), ['PAY-1', 'PAY-2']);
  });

  test('keys without numeric suffix are filtered', () => {
    assert.deepEqual(parseDomainLink(['PAY']), []);
  });

  test('keys with embedded space are not accepted', () => {
    assert.deepEqual(parseDomainLink(['PAY 1']), []);
  });
});

describe('_parseDomainLink — dedup + uppercase', () => {
  test('duplicates collapsed', () => {
    assert.deepEqual(parseDomainLink(['PAY-1', 'pay-1', 'PAY-1']), ['PAY-1']);
  });

  test('lowercase normalised to upper', () => {
    assert.deepEqual(parseDomainLink(['pay-1']), ['PAY-1']);
  });
});
