'use strict';
//
// types.js — JSDoc-only typedefs for the core domain models.
//
// This module exports NOTHING at runtime — it exists purely to give
// `tsc --checkJs` and IDE IntelliSense a single source of truth for
// the domain shapes.
//
// Reference these types from any module via:
//   @typedef {import('./types').Row} Row
//
// Or annotate functions directly:
//   @param {Row[]} rows
//   @returns {number}
//
// Updated whenever a field is added to RowFactory.create().
//

// =====================================================================
// Row — primary task record. One per row in the registry table.
// =====================================================================

/**
 * Risk flags that the RiskEngine attaches to a row.
 * @typedef {(
 *   | 'CONFIRMATION_IN_RELEASE'
 *   | 'IN_SCOPE_WITHOUT_RELEASE'
 *   | 'BLOCKING_NEAR_RELEASE'
 *   | 'OVERDUE_DEADLINE'
 *   | 'CUSTOM_RISK'
 * )} RiskFlag
 */

/** @typedef {('Да' | 'Нет' | 'Требует подтверждения' | '')} ScopeStatus */

/**
 * Work-type identifiers used across release columns.
 * Free-form strings in storage but typically one of these:
 * @typedef {(
 *   | 'backend' | 'frontend'
 *   | 'аналитика' | 'бизнес аналитика'
 *   | 'тестирование' | 'внедрение'
 *   | 'миграция данных' | 'стабилизация' | 'хотфикс'
 *   | string  // forward-compat: any user-defined work type
 * )} WorkType
 */

/**
 * One row in the registry. Mirrors RowFactory.create().
 * Every field added to the factory MUST be reflected here, otherwise
 * tsc --checkJs will lose track and emit false positives downstream.
 *
 * @typedef {Object} Row
 *
 * --- identity & origin ---
 * @property {string} id                   stable client-side ID
 * @property {string} sourceType           'manual' / 'csv' / 'xlsx' / 'jira' / …
 * @property {string} sourceSheet          original sheet name when imported from XLSX
 *
 * --- core fields ---
 * @property {string} team
 * @property {string} category
 * @property {string} epic
 * @property {string} tasks                free-text — may contain Jira keys
 * @property {string} taskComment
 * @property {string} teamDependency
 * @property {string} risks
 *
 * --- estimates ---
 * @property {string} backend
 * @property {string} frontend
 * @property {string} analytics_estimate
 * @property {string} testing_estimate
 * @property {string} total_estimate
 *
 * --- release windows (typed arrays + raw mirror string for legacy paths) ---
 * @property {string}      release120Raw
 * @property {string}      release121Raw
 * @property {string}      release122Raw
 * @property {string}      overtimeRaw
 * @property {WorkType[]}  release120Types
 * @property {WorkType[]}  release121Types
 * @property {WorkType[]}  release122Types
 * @property {WorkType[]}  overtimeTypes
 *
 * --- derived booleans (computed by RowFactory.updateDerived) ---
 * @property {boolean} hasRelease120
 * @property {boolean} hasRelease121
 * @property {boolean} hasRelease122
 * @property {boolean} hasOvertime
 * @property {boolean} isUnassigned       no release windows at all
 *
 * --- ownership / status ---
 * @property {ScopeStatus} scopeStatus
 * @property {string}      role
 * @property {string}      assignee
 * @property {string}      rowColor
 *
 * --- blocking dependency ---
 * @property {boolean} blockingDependency
 * @property {string}  blockingDeadline   ISO date or ''
 *
 * --- counterparty commit ---
 * @property {boolean} commitToCounterparty
 * @property {string}  commitDate          ISO date or ''
 *
 * --- done state ---
 * @property {boolean} isDone
 * @property {string}  doneDate            ISO date or ''
 *
 * --- backlog / Gantt extras ---
 * @property {WorkType[]} backlogTypes
 * @property {Object<string, boolean>} donePills    "{srcCol}__{wt}" → done
 * @property {Array<{ wt: string, srcCol: string, dstCol: string }>} ganttArrows
 *
 * --- work period (overtime / planned) ---
 * @property {string} workPeriodStart      ISO date or ''
 * @property {string} workPeriodEnd        ISO date or ''
 *
 * --- meta ---
 * @property {string}     comment
 * @property {boolean}    dirty            true if mutated since last Save
 * @property {RiskFlag[]} riskFlags
 * @property {string}     createdAt        ISO datetime
 * @property {string}     updatedAt        ISO datetime
 *
 * --- integrations enrichment (added lazily) ---
 * @property {string}  [jiraKey]
 * @property {string}  [jiraStatus]
 * @property {string}  [jiraAssignee]
 * @property {string}  [prUrl]
 * @property {string}  [prStatus]
 * @property {string}  [docUrl]
 * @property {string}  [docTitle]
 *
 * --- AI / scoring extras ---
 * @property {number}  [riskScore]
 * @property {('high'|'medium'|'low')} [priority]
 * @property {number}  [businessValue]
 * @property {boolean} [_reviewFlag]
 */

// =====================================================================
// Settings — user-configurable preferences (saved to localStorage).
// =====================================================================

/**
 * Application-level UI settings. Persisted under `sbof_app_settings_v1`.
 * @typedef {Object} AppSettings
 * @property {string[]}                  hiddenSections   nav keys that are hidden
 * @property {string[]}                  sectionOrder     custom nav order ([] = default)
 * @property {Object<string, string>}    sectionLabels    custom labels by nav key
 * @property {string[]}                  dividerAfter     nav keys that show a divider after them
 * @property {string[]}                  hiddenBlocks     element IDs hidden on render
 * @property {boolean}                   debugMode        unlocks Подложка / Диагностика
 */

/**
 * LLM assistant settings. Persisted under `q2_llm_settings_v1`.
 * @typedef {Object} LLMSettings
 * @property {string}  apiMode            'gigachat' | 'openai' | 'proxy'
 * @property {string}  apiBase
 * @property {string}  proxyUrl
 * @property {string}  model
 * @property {string}  token              raw API key (never sent to UI in token-readback paths)
 * @property {string}  systemPrompt
 * @property {number}  temperature
 * @property {number}  maxTokens
 * @property {string}  contextMode        'summary' | 'currentView' | 'fullRegistry' | 'custom' | 'none'
 * @property {boolean} streaming
 */

/**
 * Integrations endpoint config. Persisted server-side (jira-config.json).
 * @typedef {Object} IntegrationsSettings
 * @property {string}  jiraBaseUrl
 * @property {string}  jiraToken                 (write-only from UI)
 * @property {string}  jiraProjectKeys           comma-separated
 * @property {string}  bitbucketBaseUrl
 * @property {string}  bitbucketToken            (write-only from UI)
 * @property {string}  bitbucketProjectKeys
 * @property {string}  confluenceBaseUrl
 * @property {string}  confluenceToken           (write-only from UI)
 * @property {string}  sinceDate                 ISO yyyy-mm-dd lower bound
 * @property {boolean} allowInsecureTls
 * @property {number}  pulseStaleDays
 * @property {number}  pulseWipMax
 */

// =====================================================================
// Participant — Portfolio Pulse view of a single contributor.
// =====================================================================

/**
 * Slim representation of a Jira issue used by Portfolio Pulse cards.
 * @typedef {Object} SlimIssue
 * @property {string}  key
 * @property {string}  pk                 project key
 * @property {string}  summary
 * @property {string}  status
 * @property {string}  statusCat          'new' | 'indeterminate' | 'done'
 * @property {string}  type
 * @property {string}  priority
 * @property {string}  assignee
 * @property {string}  parentKey
 * @property {string}  created
 * @property {string}  updated
 * @property {string}  duedate
 * @property {string}  description
 * @property {string[]} labels
 */

/**
 * Aggregated activity for one person in the 48-hour window.
 * @typedef {Object} Participant
 * @property {string}    key                    normalized identity key (lowercased displayName/email)
 * @property {string}    label                  display name
 * @property {string}    avatar                 URL or ''
 * @property {string[]}  projects               list of PKs they touched
 * @property {SlimIssue[]} issuesNow            currently in-progress
 * @property {SlimIssue[]} doneYesterday
 * @property {SlimIssue[]} doneDayBefore
 * @property {SlimIssue[]} stale                idle longer than `staleDays`
 * @property {Array<{issue:SlimIssue,text:string,at:string}>} commentsRecent
 * @property {Array<{issue:SlimIssue,text:string,at:string}>} confluenceEdits
 * @property {Array<{kind:string,issue:SlimIssue,at:string,text?:string}>} timelineYesterday
 * @property {Array<{kind:string,issue:SlimIssue,at:string,text?:string}>} timelinePrev
 * @property {number}    loggedYesterdaySec
 * @property {number}    loggedDayBeforeSec
 * @property {{commits48h:number, pr48h:number, conf48h:number}} badges
 */

// =====================================================================
// Insight — single signal produced by the rule-based or LLM analyzers.
// =====================================================================

/** @typedef {('high'|'medium'|'low'|'info'|'warning'|'success')} InsightSeverity */

/**
 * One insight card. Used by both /views/metrics InsightsView and
 * portfolioPulseInsights.js.
 * @typedef {Object} Insight
 * @property {InsightSeverity}      severity
 * @property {string}               title
 * @property {string}               explanation
 * @property {number}               count
 * @property {(SlimIssue|Row)[]}    items                 affected entities (may be empty for headline-only)
 * @property {(string|null)}        target                project key / team / null
 * @property {string}               scope                 e.g. PK or 'all'
 * @property {('rule'|'llm')}       [origin]              who produced it
 * @property {string}               [actionId]            optional Action Layer hook
 */

// Marker export so this file is treated as a module — typedefs above
// are imported via /** @typedef {import("./types").Row} Row */ syntax.
export {};
