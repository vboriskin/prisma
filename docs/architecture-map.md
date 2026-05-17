# Architecture Map

> Извлечено из [`CLAUDE.md`](../CLAUDE.md) секции «Карта в 30 секунд».
> Дата актуализации: 2026-05-17 (V22+ Phase 5.2 / Sprint A+B+C / Playwright).

```
/
├── server.js             ← Node-сервер: статика + /api/* proxy для интеграций
├── server/               ← extracted: jira-api / integrations-api / pulse-runner / logger / blackDashboard / techInfo / zephyr
├── app.js                ← orchestrator: bootstrap, navigation, reactive flush
├── app/                  ← decomposed: nav, init, services, llmAssistant, storageSettings, bulkEditPanel, onboarding, …
├── state.js              ← единый mutable state (Proxy-обёрнут — см. контракты!)
├── dataStore.js          ← persistence (localStorage + SQLite-WASM optional)
├── rowFactory.js         ← фабрики Row + Employee (включая identity-поля)
├── filters.js            ← FilterEngine (cache, getFiltered, getActiveCount)
├── reactiveStore.js      ← Reactive proxy + silent guard
├── views/                ← per-section render: registry, gantt, dashboard, employees, …
├── integrations/
│   ├── portfolioPulseModel.js   ← Pulse (BB/CF) analyse
│   ├── teamScanner2*.js          ← Scanner team v2 (16k LOC)
│   ├── blackDashboard.js         ← Sigma goal-coverage
│   ├── techInfo.js               ← Jira metadata discovery
│   ├── employeePerformance.js    ← per-employee BB/CF metrics
│   └── release2/                 ← V22+ Phase 5 — Release 2.0 sub-tab
│       ├── release2Fields.js     ← 56 custom-fields taxonomy
│       ├── release2Model.js      ← analyseRelease2 + diffRelease2Lists
│       ├── release2Api.js        ← /api/integrations/release2-{fetch,related}
│       ├── release2State.js      ← localStorage 'r2_state_v1'
│       ├── release2Renderer.js   ← HTML string builder
│       └── release2.js           ← orchestrator + Multiselect mount
├── chat/                 ← LLM-чат + meta-navigator (Scanner / Чёрный / Гант queries)
├── ai/                   ← AI-Анализ + AI-CEO views (analytics, не chat)
├── components/           ← Multiselect (V21), TagInput
├── tests/unit/           ← node:test (~1613 tests)
├── tests/contract/       ← contract tests (fake-Jira + server.js)
├── tests/playwright/     ← V22+ Sprint C — visual smoke
│   ├── playwright.config.js
│   ├── scanner-smoke.spec.js     ← 4 теста (Scanner demo)
│   └── full-audit.spec.js        ← 30 тестов (все 20 main views + sub-tabs + chat)
├── libs/                 ← vendored xlsx + sql-wasm
└── docs/                 ← каноническая документация
```

Для high-level data-flow diagram см. [`../ARCHITECTURE.md`](../ARCHITECTURE.md).
