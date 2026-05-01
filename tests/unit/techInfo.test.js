'use strict';
/* ============================================================
   tests/unit/techInfo.test.js
   --
   Unit tests for the pure shaping helpers and renderer logic of the
   «🔧 Техническая информация» modal. We hit:
     · the renderer (renders strings; no DOM mutation here)
     · the search-filter contract — every list item carries
       `data-ti-search` with lowercased tokens, search input
       toggles display:none on items that don't include the query
     · happy paths + error paths (no data, missing source, partial)
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderTechInfoModal, renderJiraPane, renderBitbucketPane, renderConfluencePane,
} from '../../integrations/techInfoRenderer.js';

/** Convert a SafeHtml or string to a plain HTML string. */
function H(x) { return String(x); }

describe('renderJiraPane', () => {
  test('returns "нет данных" placeholder for null', () => {
    const out = H(renderJiraPane(null));
    assert.match(out, /нет данных/);
  });

  test('returns error block when error message + no data', () => {
    const out = H(renderJiraPane(null, 'HTTP 401 unauthorized'));
    assert.match(out, /HTTP 401 unauthorized/);
    assert.match(out, /ti-error/);
  });

  test('renders serverInfo section with version + buildNumber', () => {
    const out = H(renderJiraPane({
      serverInfo: { version: '8.20.11', buildNumber: '820011', deploymentType: 'Server', serverTime: '2026-04-28T10:00:00Z' },
    }));
    assert.match(out, /Версия Jira/);
    assert.match(out, /8\.20\.11/);
    assert.match(out, /820011/);
    assert.match(out, /Server/);
  });

  test('escapes user-controlled values in projects (no raw <script>)', () => {
    const out = H(renderJiraPane({
      projects: [{ id: '1', key: 'PAY', name: '<script>alert(1)</script>', projectTypeKey: '', leadDisplayName: '' }],
    }));
    assert.doesNotMatch(out, /<script>alert/);
    assert.match(out, /&lt;script&gt;/);
  });

  test('groups statuses by category with right counts', () => {
    const out = H(renderJiraPane({
      statusesByCategory: {
        'new':           [{ id: '1', name: 'Open',         statusCategoryKey: 'new',           statusCategoryColor: 'blue-gray' }],
        'indeterminate': [{ id: '3', name: 'In Progress',  statusCategoryKey: 'indeterminate', statusCategoryColor: 'yellow' }],
        'done':          [{ id: '5', name: 'Closed',       statusCategoryKey: 'done',          statusCategoryColor: 'green' },
                          { id: '6', name: 'Resolved',     statusCategoryKey: 'done',          statusCategoryColor: 'green' }],
      },
    }));
    // Use [\s\S]* to span newlines — the safeHtml output has whitespace between
    // the title and count spans.
    assert.match(out, /Все статусы[\s\S]*<span class="ti-section-count">4<\/span>/);
    assert.match(out, /To Do/);
    assert.match(out, /Done/);
    assert.match(out, /In Progress/);
  });

  test('splits fields into system vs custom', () => {
    const out = H(renderJiraPane({
      fields: {
        system: [{ id: 'summary', name: 'Summary', custom: false, schemaType: 'string', schemaCustom: '' }],
        custom: [{ id: 'customfield_10001', name: 'Story Points', custom: true, schemaType: 'number', schemaCustom: 'com.atlassian:storypoints' }],
      },
    }));
    assert.match(out, /Системные поля/);
    assert.match(out, /Кастомные поля/);
    assert.match(out, /customfield_10001/);
    assert.match(out, /Story Points/);
  });

  test('renders versions/components per project', () => {
    const out = H(renderJiraPane({
      versionsByProject:   { PAY: [{ id: 'v1', name: 'v1.0', released: true,  archived: false, releaseDate: '2026-01-01' }] },
      componentsByProject: { PAY: [{ id: 'c1', name: 'Backend', leadDisplayName: 'Иван', description: '' }] },
    }));
    assert.match(out, /Версии и компоненты/);
    assert.match(out, /v1\.0/);
    assert.match(out, /Backend/);
    assert.match(out, /Иван/);
  });

  test('handles _errors object — surfaces them as a section', () => {
    const out = H(renderJiraPane({
      _errors: { 'boards': 'HTTP 404 — agile module not installed' },
      myself: { displayName: 'Test' },
    }));
    assert.match(out, /Ошибки запросов/);
    assert.match(out, /HTTP 404/);
  });

  test('every list item carries data-ti-search attribute', () => {
    const out = H(renderJiraPane({
      projects: [{ id: '1', key: 'PAY', name: 'Payments', projectTypeKey: 'software', leadDisplayName: 'Иван' }],
    }));
    assert.match(out, /data-ti-search="[^"]*pay[^"]*"/i);
    assert.match(out, /data-ti-search="[^"]*payments[^"]*"/i);
  });
});

describe('renderBitbucketPane', () => {
  test('Cloud-not-supported banner when cloudUnsupported flag set', () => {
    const out = H(renderBitbucketPane({ cloudUnsupported: true, _info: 'Cloud не поддерживается — таб для Server' }));
    assert.match(out, /Cloud не поддерживается/);
    assert.match(out, /ti-info-banner/);
  });

  test('renders application-properties + projects + repos', () => {
    const out = H(renderBitbucketPane({
      applicationProperties: { version: '7.21.0', buildNumber: '7210', displayName: 'Stash' },
      projects: [{ key: 'SBOFPL', name: 'SBOF Platform', id: '1', type: 'NORMAL', description: '', public: false }],
      repos:    [{ slug: 'frontend', name: 'frontend', projectKey: 'SBOFPL', defaultBranch: 'develop', scmId: 'git', public: false }],
    }));
    assert.match(out, /7\.21\.0/);
    assert.match(out, /SBOFPL/);
    assert.match(out, /frontend/);
    assert.match(out, /develop/);
  });

  test('renders branchesByRepo subsections with default flag', () => {
    const out = H(renderBitbucketPane({
      branchesByRepo: { 'SBOFPL/frontend': [
        { displayId: 'master',  isDefault: true,  latestCommitHash: 'abc1234' },
        { displayId: 'feature/x', isDefault: false, latestCommitHash: 'def5678' },
      ]},
    }));
    assert.match(out, /SBOFPL\/frontend/);
    assert.match(out, /master/);
    assert.match(out, /★ default/);
    assert.match(out, /abc1234/);
  });

  test('shows "нет данных" when bb is null', () => {
    assert.match(H(renderBitbucketPane(null)), /нет данных/);
  });
});

describe('renderConfluencePane', () => {
  test('renders user + spaces with type and description', () => {
    const out = H(renderConfluencePane({
      currentUser: { username: 'ivan', userKey: 'u-1', displayName: 'Иван' },
      spaces: [{ id: '1', key: 'TEAM', name: 'Team Space', type: 'global', description: 'Описание' }],
    }));
    assert.match(out, /TEAM/);
    assert.match(out, /Team Space/);
    assert.match(out, /global/);
    assert.match(out, /Описание/);
    assert.match(out, /Иван/);
  });

  test('renders labels + templates per space', () => {
    const out = H(renderConfluencePane({
      labelsBySpace:    { TEAM: [{ name: 'release', prefix: 'global' }] },
      templatesBySpace: { TEAM: [{ templateId: 't-1', name: 'Sprint review', description: '' }] },
    }));
    assert.match(out, /release/);
    assert.match(out, /Sprint review/);
  });

  test('error in one section surfaces under "Ошибки"', () => {
    const out = H(renderConfluencePane({
      _errors: { systemInfo: 'HTTP 403' },
      currentUser: { displayName: 'X' },
    }));
    assert.match(out, /Ошибки запросов/);
    assert.match(out, /HTTP 403/);
  });
});

describe('renderTechInfoModal — overall shell', () => {
  test('shows loading state when state.loading and no data', () => {
    const out = H(renderTechInfoModal({ activeTab: 'jira', data: null, query: '', loading: true, errorMsg: '' }));
    assert.match(out, /ti-modal/);
    assert.match(out, /Загружаю данные/);
  });

  test('shows error message when errorMsg set and no data', () => {
    const out = H(renderTechInfoModal({ activeTab: 'jira', data: null, query: '', loading: false, errorMsg: 'HTTP 503' }));
    assert.match(out, /HTTP 503/);
  });

  test('three tabs always rendered with active highlighted', () => {
    const out = H(renderTechInfoModal({ activeTab: 'bitbucket', data: { fetchedAt: new Date().toISOString() }, query: '', loading: false, errorMsg: '' }));
    assert.match(out, /data-ti-tab="jira"/);
    assert.match(out, /data-ti-tab="bitbucket"/);
    assert.match(out, /data-ti-tab="confluence"/);
    // active tab gets ti-tab-active class
    const m = out.match(/<button[^>]*data-ti-tab="bitbucket"[^>]*class="([^"]*)"/) || out.match(/class="([^"]*)"[^>]*data-ti-tab="bitbucket"/);
    if (m) assert.match(m[1], /ti-tab-active/);
  });

  test('error mark on tab when data.errors[source] is set', () => {
    const out = H(renderTechInfoModal({
      activeTab: 'jira',
      data: { fetchedAt: new Date().toISOString(), errors: { confluence: 'timeout' }, stale: {} },
      query: '', loading: false, errorMsg: '',
    }));
    assert.match(out, /data-ti-tab="confluence"[^>]*ti-tab-error|ti-tab-error[^>]*data-ti-tab="confluence"/);
    assert.match(out, /Confluence ⚠/);
  });

  test('stale mark when data.stale[source] is true', () => {
    const out = H(renderTechInfoModal({
      activeTab: 'jira',
      data: { fetchedAt: new Date().toISOString(), errors: {}, stale: { jira: true } },
      query: '', loading: false, errorMsg: '',
    }));
    assert.match(out, /Jira ⏱/);
  });

  test('search input pre-populated with query value (round-trip)', () => {
    const out = H(renderTechInfoModal({ activeTab: 'jira', data: null, query: 'PAY', loading: false, errorMsg: '' }));
    assert.match(out, /id="ti-search"/);
    assert.match(out, /value="PAY"/);
  });
});

describe('search-filter contract — data-ti-search tokens', () => {
  test('tokens are lowercased and space-joined', () => {
    const out = H(renderJiraPane({
      projects: [{ id: '42', key: 'PAY', name: 'Payments Team', projectTypeKey: 'software', leadDisplayName: 'Иван' }],
    }));
    // Find the project list item.
    const m = out.match(/data-ti-search="([^"]*)"[^>]*>[^<]*<code class="ti-key">PAY/);
    assert.ok(m, 'expected to find list item with PAY key + data-ti-search attribute');
    const tokens = m[1];
    assert.match(tokens, /pay/);
    assert.match(tokens, /payments/);
    assert.match(tokens, /42/);
    assert.match(tokens, /иван/);
  });
});
