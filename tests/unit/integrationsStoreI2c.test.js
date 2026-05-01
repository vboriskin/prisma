'use strict';
/* ============================================================
   V17.2 I2c — store roundtrip for confluenceSpaceKeys + activityWindowHours
   ============================================================ */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = globalThis.localStorage || {
  _data: new Map(),
  getItem(k) { return this._data.has(k) ? this._data.get(k) : null; },
  setItem(k, v) { this._data.set(k, String(v)); },
  removeItem(k) { this._data.delete(k); },
  clear() { this._data.clear(); },
  key(i) { return [...this._data.keys()][i] || null; },
  get length() { return this._data.size; },
};

const { saveSettings, loadSettings, loadSettingsRaw } = await import('../../integrations/integrationsStore.js');

describe('V17.2 I2c — confluenceSpaceKeys + activityWindowHours', () => {
  test('default activityWindowHours = 72', () => {
    localStorage.clear();
    const s = loadSettings();
    assert.equal(s.activityWindowHours, 72);
  });

  test('default confluenceSpaceKeys = empty string', () => {
    localStorage.clear();
    const s = loadSettings();
    assert.equal(s.confluenceSpaceKeys, '');
  });

  test('saveSettings persists confluenceSpaceKeys', () => {
    localStorage.clear();
    saveSettings({ confluenceSpaceKeys: 'DEV, PAY, SBOF' });
    assert.equal(loadSettings().confluenceSpaceKeys, 'DEV, PAY, SBOF');
    assert.equal(loadSettingsRaw().confluenceSpaceKeys, 'DEV, PAY, SBOF');
  });

  test('saveSettings allows empty confluenceSpaceKeys (= искать везде)', () => {
    localStorage.clear();
    saveSettings({ confluenceSpaceKeys: 'DEV' });
    saveSettings({ confluenceSpaceKeys: '' });
    assert.equal(loadSettings().confluenceSpaceKeys, '');
  });

  test('activityWindowHours clamped to [1, 168] (invalid skipped)', () => {
    localStorage.clear();
    // 0 — invalid (out of range), пропускаем → остаётся default 72
    saveSettings({ activityWindowHours: 0 });
    assert.equal(loadSettings().activityWindowHours, 72);
    // 9999 — clamp to 168 (max)
    saveSettings({ activityWindowHours: 9999 });
    assert.equal(loadSettings().activityWindowHours, 168);
    // 24 — valid, persists
    saveSettings({ activityWindowHours: 24 });
    assert.equal(loadSettings().activityWindowHours, 24);
  });

  test('activityWindowHours rounds float values', () => {
    localStorage.clear();
    saveSettings({ activityWindowHours: 71.7 });
    assert.equal(loadSettings().activityWindowHours, 72);
  });

  test('non-number activityWindowHours ignored (keeps existing)', () => {
    localStorage.clear();
    saveSettings({ activityWindowHours: 48 });
    saveSettings({ activityWindowHours: 'invalid' });
    assert.equal(loadSettings().activityWindowHours, 48);
  });

  test('confluenceSpaceKeys + activityWindowHours coexist independently', () => {
    localStorage.clear();
    saveSettings({ confluenceSpaceKeys: 'DEV, PAY', activityWindowHours: 24 });
    const s = loadSettings();
    assert.equal(s.confluenceSpaceKeys, 'DEV, PAY');
    assert.equal(s.activityWindowHours, 24);
  });
});
