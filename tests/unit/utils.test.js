'use strict';
/* ============================================================
   tests/unit/utils.test.js
   --
   Tests for utils.js Utils.* helpers. Pure functions; covers escape,
   CSV parsing (RFC 4180 quirks), date normalisation, Jira link
   extraction, scope-from-raw mapping.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// state.js touches localStorage during module init via bare property reads.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };

const { Utils, nextId } = await import('../../utils.js');

describe('Utils.escapeHtml', () => {
  test('escapes the canonical 5 chars', () => {
    assert.equal(Utils.escapeHtml('<a href="x">y\'</a>&'), '&lt;a href=&quot;x&quot;&gt;y&#39;&lt;/a&gt;&amp;');
  });

  test('null / undefined → empty string', () => {
    assert.equal(Utils.escapeHtml(null), '');
    assert.equal(Utils.escapeHtml(undefined), '');
  });

  test('numbers cast to string verbatim (no escape needed)', () => {
    assert.equal(Utils.escapeHtml(42), '42');
  });
});

describe('Utils.toBool', () => {
  test('truthy strings (RU + EN)', () => {
    for (const v of ['true', '1', 'yes', 'on', 'да', 'y', 'ok', 'TRUE', 'Да']) {
      assert.equal(Utils.toBool(v), true, `expected true for "${v}"`);
    }
  });

  test('falsy strings (RU + EN)', () => {
    for (const v of ['false', '0', 'no', 'off', 'нет', 'n', '']) {
      assert.equal(Utils.toBool(v), false, `expected false for "${v}"`);
    }
  });

  test('boolean / number passthrough', () => {
    assert.equal(Utils.toBool(true), true);
    assert.equal(Utils.toBool(false), false);
    assert.equal(Utils.toBool(1), true);
    assert.equal(Utils.toBool(0), false);
  });

  test('unknown value uses fallback', () => {
    assert.equal(Utils.toBool('garbage', true), true);
    assert.equal(Utils.toBool('garbage', false), false);
  });
});

describe('Utils.parseCSVLine', () => {
  test('plain comma-separated', () => {
    assert.deepEqual(Utils.parseCSVLine('a,b,c'), ['a', 'b', 'c']);
  });

  test('quoted fields preserve commas', () => {
    assert.deepEqual(Utils.parseCSVLine('"a,b","c"'), ['a,b', 'c']);
  });

  test('escaped double-quote inside field ("")', () => {
    assert.deepEqual(Utils.parseCSVLine('"He said ""hi"""'), ['He said "hi"']);
  });

  test('empty fields preserved', () => {
    assert.deepEqual(Utils.parseCSVLine('a,,c'), ['a', '', 'c']);
  });

  test('trailing comma adds empty field', () => {
    assert.deepEqual(Utils.parseCSVLine('a,b,'), ['a', 'b', '']);
  });
});

describe('Utils.parseFullCSV', () => {
  test('splits multiple lines', () => {
    const r = Utils.parseFullCSV('a,b\nc,d\n');
    assert.equal(r.length, 2);
    assert.deepEqual(r[0], ['a','b']);
    assert.deepEqual(r[1], ['c','d']);
  });

  test('CRLF line endings handled', () => {
    const r = Utils.parseFullCSV('a,b\r\nc,d');
    assert.equal(r.length, 2);
  });

  test('quoted field with newline does not split', () => {
    const r = Utils.parseFullCSV('"a\nb",c');
    assert.equal(r.length, 1);
    assert.deepEqual(r[0], ['a\nb', 'c']);
  });
});

describe('Utils.escapeCSV', () => {
  test('null → empty', () => {
    assert.equal(Utils.escapeCSV(null), '');
  });

  test('value with comma → wrapped in quotes', () => {
    assert.equal(Utils.escapeCSV('a,b'), '"a,b"');
  });

  test('value with quote → escaped + wrapped', () => {
    assert.equal(Utils.escapeCSV('he said "hi"'), '"he said ""hi"""');
  });

  test('plain string passes through', () => {
    assert.equal(Utils.escapeCSV('plain'), 'plain');
  });
});

describe('Utils.parseDateish', () => {
  test('ISO date kept as-is', () => {
    assert.equal(Utils.parseDateish('2026-04-28'), '2026-04-28');
  });

  test('Russian dd.mm.yyyy → ISO', () => {
    assert.equal(Utils.parseDateish('28.04.2026'), '2026-04-28');
  });

  test('dd/mm/yyyy → ISO', () => {
    assert.equal(Utils.parseDateish('28/04/2026'), '2026-04-28');
  });

  test('two-digit year → 20XX', () => {
    assert.equal(Utils.parseDateish('28.04.26'), '2026-04-28');
  });

  test('garbage → empty string', () => {
    assert.equal(Utils.parseDateish('not a date'), '');
    assert.equal(Utils.parseDateish(''), '');
    assert.equal(Utils.parseDateish(null), '');
  });
});

describe('Utils.scopeFromRaw', () => {
  test('"да"/"yes"/"+"/"1" → "Да"', () => {
    for (const v of ['да', 'Да', 'YES', '+', '1']) {
      assert.equal(Utils.scopeFromRaw(v), 'Да');
    }
  });

  test('"нет"/"no"/"-"/"0" → "Нет"', () => {
    for (const v of ['нет', 'NO', '-', '0']) {
      assert.equal(Utils.scopeFromRaw(v), 'Нет');
    }
  });

  test('contains "подтвержд" → "Требует подтверждения"', () => {
    assert.equal(Utils.scopeFromRaw('подтверждение'), 'Требует подтверждения');
    assert.equal(Utils.scopeFromRaw('требует уточнения'), 'Требует подтверждения');
  });

  test('empty → ""', () => {
    assert.equal(Utils.scopeFromRaw(''), '');
    assert.equal(Utils.scopeFromRaw(null), '');
  });

  test('arbitrary value → capitalised first letter', () => {
    assert.equal(Utils.scopeFromRaw('возможно'), 'Возможно');
  });
});

describe('Utils.parsePipe / serializePipe', () => {
  test('pipe-separated to array, trims and drops empty', () => {
    assert.deepEqual(Utils.parsePipe('a | b | | c'), ['a', 'b', 'c']);
  });

  test('null/empty → []', () => {
    assert.deepEqual(Utils.parsePipe(null), []);
    assert.deepEqual(Utils.parsePipe(''), []);
  });

  test('serializePipe inverse', () => {
    assert.equal(Utils.serializePipe(['a','b','c']), 'a|b|c');
    assert.equal(Utils.serializePipe(null), '');
    assert.equal(Utils.serializePipe('not array'), '');
  });
});

describe('Utils.truncate', () => {
  test('long string gets ellipsis', () => {
    assert.equal(Utils.truncate('hello world', 5), 'hello…');
  });

  test('short string passes through', () => {
    assert.equal(Utils.truncate('hi', 10), 'hi');
  });

  test('null/undefined → empty', () => {
    assert.equal(Utils.truncate(null, 10), '');
    assert.equal(Utils.truncate(undefined, 10), '');
  });
});

describe('Utils.parseJiraLinks', () => {
  test('extracts standalone keys', () => {
    const r = Utils.parseJiraLinks('Fixed PAY-123 and KYC-7');
    assert.equal(r.length, 2);
    assert.equal(r[0].key, 'PAY-123');
    assert.equal(r[0].url, null);
  });

  test('extracts key + URL from full /browse/ links', () => {
    const r = Utils.parseJiraLinks('https://jira.example.com/browse/PAY-123');
    assert.equal(r.length, 1);
    assert.equal(r[0].key, 'PAY-123');
    assert.equal(r[0].url, 'https://jira.example.com/browse/PAY-123');
  });

  test('falls back to plain text when neither URLs nor keys', () => {
    const r = Utils.parseJiraLinks('  random text  ');
    assert.equal(r.length, 1);
    assert.equal(r[0].key, 'random text');
    assert.equal(r[0].url, null);
  });

  test('null/empty → []', () => {
    assert.deepEqual(Utils.parseJiraLinks(null), []);
    assert.deepEqual(Utils.parseJiraLinks(''), []);
  });
});

describe('Utils.hexToRgba', () => {
  test('valid 6-char hex', () => {
    assert.equal(Utils.hexToRgba('#ff0080', 0.5), 'rgba(255,0,128,0.5)');
  });

  test('without # prefix also works', () => {
    assert.equal(Utils.hexToRgba('00ff00', 1), 'rgba(0,255,0,1)');
  });

  test('invalid hex → empty string', () => {
    assert.equal(Utils.hexToRgba('xyz'), '');
    assert.equal(Utils.hexToRgba('#fff'), '');     // 3-char shorthand not supported
  });
});

describe('Utils.normalizeHeader / mapHeader', () => {
  test('normalizeHeader strips zero-width + collapses whitespace + lowercases', () => {
    assert.equal(Utils.normalizeHeader(' ​SUMMARY\n  '), 'summary');
  });

  test('mapHeader returns canonical names for Russian column titles', () => {
    assert.equal(Utils.mapHeader('категория'), 'category');
    assert.equal(Utils.mapHeader('теги'), 'tags');
    assert.equal(Utils.mapHeader('задачи'), 'tasks');
    assert.equal(Utils.mapHeader('эпик'), 'epic');
  });

  test('unknown header → null', () => {
    assert.equal(Utils.mapHeader('nope'), null);
  });
});

describe('nextId', () => {
  test('produces unique IDs even when called rapidly', () => {
    const a = nextId(), b = nextId();
    assert.notEqual(a, b);
    assert.match(a, /^r_/);
  });
});
