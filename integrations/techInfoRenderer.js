'use strict';
/* ============================================================
   TECH INFO — RENDERER
   --
   All HTML produced through `safeHtml.html` (auto-escapes every
   interpolation by default; nested templates compose). Pure
   string-output — DOM mutation lives in techInfo.js orchestrator.

   Structure:
     ti-modal-overlay
       └ ti-modal
           ├ ti-header (title + search + refresh + close)
           ├ ti-tabs (Jira / Bitbucket / Confluence)
           └ ti-body (per-tab pane with sections)

   Each list-item carries `data-ti-search` with lowercased
   space-separated tokens — the search input toggles
   `display:none` on items whose data-ti-search doesn't include
   the substring. Aggregated work in techInfo.js.
   ============================================================ */

import { html, unsafe } from '../libs/safeHtml.js';
import { prizmaLoaderMark } from '../app/prizmaUI.js';
// UX скв.4 — Lucide-иконки вместо эмодзи 📋 / ⚠ / ✓ / ✗.
import { Icons } from '../app/icons.js';

/** URL allowlist — same shape as portfolioPulseRenderer.safeUrl. Reused
 *  locally so this module has no cross-renderer dep. */
function safeUrl(u) {
  const s = String(u || '').trim();
  return /^(https?:|mailto:)/i.test(s) ? s : '';
}

/** Build `data-ti-search` attribute value out of a list of strings. */
function searchTokens(...parts) {
  return parts
    .filter(p => p != null && p !== '')
    .map(p => String(p).toLowerCase())
    .join(' ');
}

/* ── Atoms ─────────────────────────────────────────────────── */

/** Copy-button — clipboard write happens via delegated handler in techInfo.js. */
function copyBtn(value) {
  if (!value) return html``;
  // UX скв.4 — эмодзи 📋 заменено на Lucide-иконку 'clipboard'.
  return html`<button class="ti-copy" type="button" data-ti-copy="${value}" title="Скопировать «${value}»">${unsafe(Icons.get('clipboard', { size: 14 }))}</button>`;
}

/** A list item with monospace key + text + copy button. */
function listItem({ key, text, sub, search }) {
  const tokens = search != null ? search : searchTokens(key, text, sub);
  return html`<div class="ti-list-item" data-ti-search="${tokens}">
    ${key ? html`<code class="ti-key">${key}</code>` : ''}
    <span class="ti-text">${text || ''}</span>
    ${sub ? html`<span class="ti-sub">${sub}</span>` : ''}
    ${copyBtn(key || text || '')}
  </div>`;
}

/** Inline section wrapper. Auto-collapses if `total` > 20. */
function section({ title, count, body, subtitle, openByDefault }) {
  const open = openByDefault !== undefined
    ? !!openByDefault
    : (count == null || count <= 20);
  return html`<details class="ti-section" ${open ? unsafe('open') : ''}>
    <summary class="ti-section-header">
      <span class="ti-section-title">${title}</span>
      ${count != null ? html`<span class="ti-section-count">${count}</span>` : ''}
      ${subtitle ? html`<span class="ti-section-subtitle">${subtitle}</span>` : ''}
    </summary>
    <div class="ti-section-body">${body}</div>
  </details>`;
}

/** Empty / error placeholder. */
function emptyBlock(message) {
  return html`<div class="ti-empty">${message}</div>`;
}

function errorBlock(message) {
  // UX скв.4 — эмодзи ⚠ заменено на Lucide-иконку 'alert-triangle'.
  return html`<div class="ti-error">${unsafe(Icons.get('alert-triangle', { size: 14 }))} ${message}</div>`;
}

/* ── Per-source panes ─────────────────────────────────────── */

export function renderJiraPane(jira, errMsg) {
  if (errMsg && !jira) return errorBlock(errMsg);
  if (!jira) return emptyBlock('— нет данных');

  const sections = [];

  // Server info
  if (jira.serverInfo && Object.keys(jira.serverInfo).length) {
    const si = jira.serverInfo;
    sections.push(section({
      title: 'Версия Jira',
      body: html`<div class="ti-list">
        ${listItem({ key: 'version',        text: si.version || '—' })}
        ${listItem({ key: 'buildNumber',    text: String(si.buildNumber || '—') })}
        ${listItem({ key: 'deploymentType', text: si.deploymentType || '—' })}
        ${listItem({ key: 'serverTime',     text: si.serverTime || '—' })}
        ${listItem({ key: 'baseUrl',        text: si.baseUrl || '—' })}
      </div>`,
    }));
  }

  // Current user
  if (jira.myself && Object.keys(jira.myself).length) {
    const m = jira.myself;
    sections.push(section({
      title: 'Текущий пользователь',
      body: html`<div class="ti-list">
        ${listItem({ key: m.name || '', text: m.displayName || '—', sub: m.emailAddress || '' })}
        ${listItem({
          key: 'active',
          // UX скв.4 — эмодзи ✓/✗ заменены на Lucide-иконки 'check'/'x'.
          text: m.active ? unsafe(Icons.get('check', { size: 14 })) : unsafe(Icons.get('x', { size: 14 })),
          search: m.active ? 'active true yes' : 'active false no',
        })}
      </div>`,
    }));
  }

  // Projects
  const projects = Array.isArray(jira.projects) ? jira.projects : [];
  if (projects.length) {
    sections.push(section({
      title: 'Проекты',
      count: projects.length,
      body: html`<div class="ti-list">
        ${projects.map(p => listItem({
          key: p.key, text: p.name,
          sub: `${p.projectTypeKey || '—'}${p.leadDisplayName ? ' · ' + p.leadDisplayName : ''}`,
          search: searchTokens(p.key, p.name, p.id, p.leadDisplayName),
        }))}
      </div>`,
    }));
  }

  // Issue types
  const issueTypes = Array.isArray(jira.issueTypes) ? jira.issueTypes : [];
  if (issueTypes.length) {
    sections.push(section({
      title: 'Типы задач',
      count: issueTypes.length,
      body: html`<div class="ti-list">
        ${issueTypes.map(t => listItem({
          key: t.id, text: t.name,
          sub: `${t.subtask ? '↳ subtask' : ''}${t.description ? ' · ' + t.description : ''}`,
          search: searchTokens(t.id, t.name, t.description),
        }))}
      </div>`,
    }));
  }

  // Statuses grouped by category
  const sbc = jira.statusesByCategory || {};
  const totalStatuses = Object.values(sbc).reduce((s, arr) => s + (arr?.length || 0), 0);
  if (totalStatuses) {
    const renderCatSection = (label, cat, list) => list?.length ? html`
      <div class="ti-subsection">
        <div class="ti-subsection-title">${label} <span class="ti-section-count">${list.length}</span></div>
        <div class="ti-list">
          ${list.map(s => listItem({
            key: s.id, text: s.name,
            sub: `${cat} · ${s.statusCategoryColor || ''}`,
            search: searchTokens(s.id, s.name, cat),
          }))}
        </div>
      </div>` : '';
    sections.push(section({
      title: 'Все статусы',
      count: totalStatuses,
      body: html`
        ${renderCatSection('To Do (new)',         'new',           sbc['new'])}
        ${renderCatSection('In Progress (indeterminate)', 'indeterminate', sbc['indeterminate'])}
        ${renderCatSection('Done',                'done',          sbc['done'])}
      `,
    }));
  }

  // Per-project statuses (statuses by issue type)
  const sbp = jira.statusesByProject || {};
  const sbpKeys = Object.keys(sbp);
  if (sbpKeys.length) {
    sections.push(section({
      title: 'Статусы по типам / проекту',
      count: sbpKeys.length,
      body: sbpKeys.map(pk => html`
        <details class="ti-subsection">
          <summary class="ti-subsection-title">${pk}</summary>
          <div class="ti-list">
            ${(sbp[pk] || []).map(it => html`
              <div class="ti-list-item" data-ti-search="${searchTokens(pk, it.issueTypeName, ...((it.statuses||[]).map(s=>s.name)))}">
                <code class="ti-key">${it.issueTypeName}${it.subtask ? ' ↳' : ''}</code>
                <span class="ti-text">${(it.statuses || []).map(s => s.name).join(' → ') || '— нет статусов'}</span>
              </div>
            `)}
          </div>
        </details>
      `),
    }));
  }

  // Priorities
  const priorities = Array.isArray(jira.priorities) ? jira.priorities : [];
  if (priorities.length) {
    sections.push(section({
      title: 'Приоритеты',
      count: priorities.length,
      body: html`<div class="ti-list">
        ${priorities.map(p => {
          const url = safeUrl(p.iconUrl);
          return html`<div class="ti-list-item" data-ti-search="${searchTokens(p.id, p.name)}">
            <code class="ti-key">${p.id}</code>
            <span class="ti-text">${p.name}</span>
            ${url ? unsafe(`<img class="ti-icon" src="${url.replace(/"/g, '%22')}" alt="" loading="lazy">`) : ''}
            ${copyBtn(p.id || p.name)}
          </div>`;
        })}
      </div>`,
    }));
  }

  // Resolutions
  const resolutions = Array.isArray(jira.resolutions) ? jira.resolutions : [];
  if (resolutions.length) {
    sections.push(section({
      title: 'Резолюции',
      count: resolutions.length,
      body: html`<div class="ti-list">
        ${resolutions.map(r => listItem({
          key: r.id, text: r.name, sub: r.description,
          search: searchTokens(r.id, r.name, r.description),
        }))}
      </div>`,
    }));
  }

  // Fields — split into system / custom
  const fields = jira.fields || { system: [], custom: [] };
  if (fields.system?.length) {
    sections.push(section({
      title: 'Системные поля',
      count: fields.system.length,
      openByDefault: false,
      body: html`<div class="ti-list">
        ${fields.system.map(f => listItem({
          key: f.id, text: f.name, sub: f.schemaType || '',
          search: searchTokens(f.id, f.name, f.schemaType),
        }))}
      </div>`,
    }));
  }
  if (fields.custom?.length) {
    sections.push(section({
      title: 'Кастомные поля',
      count: fields.custom.length,
      openByDefault: false,
      body: html`<div class="ti-list">
        ${fields.custom.map(f => {
          const opts = (jira.customFieldOptions || {})[f.id] || [];
          return html`<div class="ti-list-item" data-ti-search="${searchTokens(f.id, f.name, f.schemaType, f.schemaCustom)}">
            <code class="ti-key">${f.id}</code>
            <span class="ti-text">${f.name}</span>
            <span class="ti-sub">${f.schemaType || ''}${f.schemaCustom ? ' · ' + f.schemaCustom : ''}${opts.length ? ` · опций: ${opts.length}` : ''}</span>
            ${copyBtn(f.id)}
          </div>`;
        })}
      </div>${jira._truncated?.customFieldOptions ? html`<div class="ti-note">${jira._truncated.customFieldOptions}</div>` : ''}`,
    }));
  }

  // Versions / components per project
  const vbp = jira.versionsByProject   || {};
  const cbp = jira.componentsByProject || {};
  const vbpKeys = [...new Set([...Object.keys(vbp), ...Object.keys(cbp)])];
  if (vbpKeys.length) {
    sections.push(section({
      title: 'Версии и компоненты по проектам',
      count: vbpKeys.length,
      body: vbpKeys.map(pk => {
        const versions = vbp[pk] || [];
        const components = cbp[pk] || [];
        return html`<details class="ti-subsection">
          <summary class="ti-subsection-title">${pk}<span class="ti-section-count">${versions.length} вер · ${components.length} комп</span></summary>
          <div class="ti-subsection-body">
            ${versions.length ? html`<div class="ti-subsection-label">Версии</div><div class="ti-list">
              ${versions.map(v => listItem({
                key: v.id, text: v.name,
                sub: `${v.released ? '✓ released' : ''}${v.archived ? ' · 🗄 archived' : ''}${v.releaseDate ? ' · ' + v.releaseDate : ''}`,
                search: searchTokens(v.id, v.name, v.description, pk),
              }))}
            </div>` : ''}
            ${components.length ? html`<div class="ti-subsection-label">Компоненты</div><div class="ti-list">
              ${components.map(c => listItem({
                key: c.id, text: c.name,
                sub: `${c.leadDisplayName ? c.leadDisplayName + ' · ' : ''}${c.description || ''}`,
                search: searchTokens(c.id, c.name, c.description, c.leadDisplayName, pk),
              }))}
            </div>` : ''}
          </div>
        </details>`;
      }),
    }));
  }

  // Boards + sprints
  const boards = Array.isArray(jira.boards) ? jira.boards : [];
  if (boards.length) {
    const sbb = jira.sprintsByBoard || {};
    sections.push(section({
      title: 'Доски и спринты (Agile)',
      count: boards.length,
      body: html`<div class="ti-list">
        ${boards.map(b => {
          const sprints = sbb[b.id] || [];
          return html`<details class="ti-subsection ti-list-item-block" data-ti-search="${searchTokens(b.id, b.name, b.type, ...sprints.map(s=>s.name))}">
            <summary class="ti-subsection-title">
              <code class="ti-key">${b.id}</code>
              <span class="ti-text">${b.name}</span>
              <span class="ti-sub">${b.type}${sprints.length ? ' · спринтов: ' + sprints.length : ''}</span>
            </summary>
            ${sprints.length ? html`<div class="ti-list">
              ${sprints.map(s => listItem({
                key: String(s.id), text: s.name,
                sub: `${s.state}${s.startDate ? ' · ' + s.startDate.slice(0,10) : ''}${s.endDate ? '…' + s.endDate.slice(0,10) : ''}`,
                search: searchTokens(s.id, s.name, s.state),
              }))}
            </div>` : html`<div class="ti-empty-mini">— нет активных/будущих спринтов</div>`}
          </details>`;
        })}
      </div>`,
    }));
  }

  if (jira._errors && Object.keys(jira._errors).length) {
    const errs = jira._errors;
    sections.push(section({
      title: 'Ошибки запросов (частичные)',
      count: Object.keys(errs).length,
      openByDefault: false,
      body: html`<div class="ti-list">
        ${Object.entries(errs).map(([k, v]) => listItem({ key: k, text: String(v) }))}
      </div>`,
    }));
  }

  if (!sections.length) return emptyBlock('— Jira ничего не вернула');
  return html`${sections}`;
}

export function renderBitbucketPane(bb, errMsg) {
  if (errMsg && !bb) return errorBlock(errMsg);
  if (!bb) return emptyBlock('— нет данных');
  if (bb.cloudUnsupported) {
    return html`<div class="ti-info-banner">
      ☁️ ${bb._info || 'Bitbucket Cloud не поддерживается в этом разделе'}
    </div>`;
  }

  const sections = [];

  // App properties
  if (bb.applicationProperties && Object.keys(bb.applicationProperties).length) {
    const a = bb.applicationProperties;
    sections.push(section({
      title: 'Версия Bitbucket',
      body: html`<div class="ti-list">
        ${listItem({ key: 'version',     text: a.version || '—' })}
        ${listItem({ key: 'buildNumber', text: a.buildNumber || '—' })}
        ${listItem({ key: 'displayName', text: a.displayName || '—' })}
      </div>`,
    }));
  }

  // Projects
  const bp = Array.isArray(bb.projects) ? bb.projects : [];
  if (bp.length) {
    sections.push(section({
      title: 'Проекты',
      count: bp.length,
      subtitle: bb._truncated?.projects || '',
      body: html`<div class="ti-list">
        ${bp.map(p => listItem({
          key: p.key, text: p.name,
          sub: `${p.type || ''}${p.public ? ' · public' : ''}${p.description ? ' · ' + p.description : ''}`,
          search: searchTokens(p.key, p.name, p.description, p.type),
        }))}
      </div>`,
    }));
  }

  // Repos
  const repos = Array.isArray(bb.repos) ? bb.repos : [];
  if (repos.length) {
    sections.push(section({
      title: 'Репозитории',
      count: repos.length,
      subtitle: bb._truncated?.repos || '',
      openByDefault: repos.length <= 30,
      body: html`<div class="ti-list">
        ${repos.map(r => listItem({
          key: `${r.projectKey}/${r.slug}`, text: r.name,
          sub: `${r.scmId || ''}${r.defaultBranch ? ' · default: ' + r.defaultBranch : ''}`,
          search: searchTokens(r.slug, r.name, r.projectKey, r.defaultBranch),
        }))}
      </div>`,
    }));
  }

  // Branches per top repo
  const bbr = bb.branchesByRepo || {};
  const bbrKeys = Object.keys(bbr);
  if (bbrKeys.length) {
    sections.push(section({
      title: 'Ветки топ-репозиториев',
      count: bbrKeys.length,
      body: bbrKeys.map(id => {
        const branches = bbr[id] || [];
        const trunc = bb._truncated?.[`branches/${id}`];
        return html`<details class="ti-subsection">
          <summary class="ti-subsection-title">
            <code class="ti-key">${id}</code>
            <span class="ti-section-count">${branches.length}${trunc ? ' (' + trunc + ')' : ''}</span>
          </summary>
          <div class="ti-list">
            ${branches.map(b => listItem({
              key: b.displayId, text: '',
              sub: `${b.isDefault ? '★ default · ' : ''}${b.latestCommitHash || ''}`,
              search: searchTokens(b.displayId, id, b.latestCommitHash),
            }))}
          </div>
        </details>`;
      }),
    }));
  }

  if (bb._errors && Object.keys(bb._errors).length) {
    const errs = bb._errors;
    sections.push(section({
      title: 'Ошибки запросов (частичные)',
      count: Object.keys(errs).length,
      openByDefault: false,
      body: html`<div class="ti-list">
        ${Object.entries(errs).map(([k, v]) => listItem({ key: k, text: String(v) }))}
      </div>`,
    }));
  }

  if (!sections.length) return emptyBlock('— Bitbucket ничего не вернул');
  return html`${sections}`;
}

export function renderConfluencePane(cf, errMsg) {
  if (errMsg && !cf) return errorBlock(errMsg);
  if (!cf) return emptyBlock('— нет данных');

  const sections = [];

  if (cf.systemInfo && Object.keys(cf.systemInfo).length) {
    const si = cf.systemInfo;
    sections.push(section({
      title: 'Версия Confluence',
      body: html`<div class="ti-list">
        ${listItem({ key: 'version',     text: si.version || '—' })}
        ${listItem({ key: 'buildNumber', text: String(si.buildNumber || '—') })}
        ${si.databaseExampleLatency != null ? listItem({ key: 'dbLatency', text: String(si.databaseExampleLatency) + 'ms' }) : ''}
      </div>`,
    }));
  }

  if (cf.currentUser && Object.keys(cf.currentUser).length) {
    const u = cf.currentUser;
    sections.push(section({
      title: 'Текущий пользователь',
      body: html`<div class="ti-list">
        ${listItem({ key: u.username || u.userKey || '', text: u.displayName || '—' })}
      </div>`,
    }));
  }

  const spaces = Array.isArray(cf.spaces) ? cf.spaces : [];
  if (spaces.length) {
    sections.push(section({
      title: 'Пространства',
      count: spaces.length,
      subtitle: cf._truncated?.spaces || '',
      openByDefault: spaces.length <= 30,
      body: html`<div class="ti-list">
        ${spaces.map(s => listItem({
          key: s.key, text: s.name,
          sub: `${s.type || ''}${s.description ? ' · ' + s.description : ''}`,
          search: searchTokens(s.key, s.name, s.description, s.type),
        }))}
      </div>`,
    }));
  }

  const lbs = cf.labelsBySpace || {};
  const lbsKeys = Object.keys(lbs);
  if (lbsKeys.length) {
    sections.push(section({
      title: 'Метки по топ-пространствам',
      count: lbsKeys.length,
      body: lbsKeys.map(key => {
        const labels = lbs[key] || [];
        return html`<details class="ti-subsection">
          <summary class="ti-subsection-title">
            <code class="ti-key">${key}</code>
            <span class="ti-section-count">${labels.length}</span>
          </summary>
          <div class="ti-list">
            ${labels.map(l => listItem({ key: l.prefix || '', text: l.name, search: searchTokens(l.name, l.prefix, key) }))}
          </div>
        </details>`;
      }),
    }));
  }

  const tbs = cf.templatesBySpace || {};
  const tbsKeys = Object.keys(tbs);
  if (tbsKeys.length) {
    sections.push(section({
      title: 'Шаблоны страниц',
      count: tbsKeys.length,
      openByDefault: false,
      body: tbsKeys.map(key => {
        const tpls = tbs[key] || [];
        return html`<details class="ti-subsection">
          <summary class="ti-subsection-title">
            <code class="ti-key">${key}</code>
            <span class="ti-section-count">${tpls.length}</span>
          </summary>
          <div class="ti-list">
            ${tpls.map(t => listItem({
              key: t.templateId, text: t.name, sub: t.description,
              search: searchTokens(t.templateId, t.name, t.description, key),
            }))}
          </div>
        </details>`;
      }),
    }));
  }

  if (cf._errors && Object.keys(cf._errors).length) {
    const errs = cf._errors;
    sections.push(section({
      title: 'Ошибки запросов (частичные)',
      count: Object.keys(errs).length,
      openByDefault: false,
      body: html`<div class="ti-list">
        ${Object.entries(errs).map(([k, v]) => listItem({ key: k, text: String(v) }))}
      </div>`,
    }));
  }

  if (!sections.length) return emptyBlock('— Confluence ничего не вернул');
  return html`${sections}`;
}

/* ── Modal shell ──────────────────────────────────────────── */

/**
 * @param {object} state
 * @param {'jira'|'bitbucket'|'confluence'} state.activeTab
 * @param {object|null} state.data       — full payload from server
 * @param {string} state.query           — search filter string
 * @param {boolean} state.loading
 * @param {string} state.errorMsg        — top-level fetch error (no data at all)
 */
export function renderTechInfoModal(state) {
  const { activeTab, data, query, loading, errorMsg } = state;
  const fetchedAtLabel = (() => {
    try { return data?.fetchedAt ? new Date(data.fetchedAt).toLocaleString('ru') : '—'; }
    catch { return '—'; }
  })();

  const tabs = [
    { id: 'jira',       label: 'Jira',       error: data?.errors?.jira,       stale: data?.stale?.jira },
    { id: 'bitbucket',  label: 'Bitbucket',  error: data?.errors?.bitbucket,  stale: data?.stale?.bitbucket },
    { id: 'confluence', label: 'Confluence', error: data?.errors?.confluence, stale: data?.stale?.confluence },
  ];

  // The pane-body content depends on tab + state.
  let paneBody;
  if (loading && !data) {
    // V21 — ⏳ emoji + plain text заменены на brand L2 loader (mark + caption).
    paneBody = html`<div class="ti-loading">${unsafe(prizmaLoaderMark())}<div class="ti-loading-caption">Загружаю данные из Jira / Bitbucket / Confluence…</div></div>`;
  } else if (errorMsg && !data) {
    paneBody = html`<div class="ti-error">⚠ ${errorMsg}</div>`;
  } else if (data) {
    const errFor = data.errors?.[activeTab];
    if (activeTab === 'jira')        paneBody = renderJiraPane(data.jira, errFor);
    else if (activeTab === 'bitbucket') paneBody = renderBitbucketPane(data.bitbucket, errFor);
    else                              paneBody = renderConfluencePane(data.confluence, errFor);
  } else {
    paneBody = html`<div class="ti-empty">— нет данных</div>`;
  }

  return html`<div class="ti-modal-overlay" id="ti-modal-overlay">
    <div class="ti-modal" role="dialog" aria-modal="true" aria-labelledby="ti-title">
      <div class="ti-header">
        <div class="ti-header-row">
          <h3 class="ti-title" id="ti-title">🔧 Техническая информация</h3>
          <input class="ti-search" id="ti-search" type="search" placeholder="Поиск по ключу/имени/id…" value="${query || ''}" autocomplete="off">
          <button class="ti-close" id="ti-close" type="button" aria-label="Закрыть">✕</button>
        </div>
        <div class="ti-header-row ti-header-meta">
          <span class="ti-fetched">Обновлено: ${fetchedAtLabel}${loading ? ' · загружается…' : ''}</span>
          <button class="int-btn int-btn-ghost int-btn-sm" id="ti-export-json" type="button" ${loading || !data ? 'disabled' : ''} title="Скачать всю информацию из этой модалки одним JSON-файлом">⤓ JSON</button>
          <button class="int-btn int-btn-ghost int-btn-sm" id="ti-refresh" type="button" ${loading ? 'disabled' : ''}>↻ Обновить</button>
        </div>
      </div>
      <div class="ti-tabs">
        ${tabs.map(t => html`<button
          class="ti-tab ${activeTab === t.id ? 'ti-tab-active' : ''} ${t.error ? 'ti-tab-error' : ''} ${t.stale ? 'ti-tab-stale' : ''}"
          data-ti-tab="${t.id}"
          type="button"
          title="${t.error ? 'Ошибка: ' + t.error : (t.stale ? 'Данные могут быть устаревшими' : '')}"
        >${t.label}${t.error ? ' ⚠' : ''}${t.stale ? ' ⏱' : ''}</button>`)}
      </div>
      <div class="ti-body">${paneBody}</div>
    </div>
  </div>`;
}
