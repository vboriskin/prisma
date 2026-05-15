# Architecture Map (auto-generated from CLAUDE.md)

> Извлечено из `CLAUDE.md` секции «Карта в 30 секунд» через `scripts/docgen.js`.
> Дата: 2026-05-08

```
/
├── server.js             ← один Node-сервер: статика + /api/* proxy для интеграций
├── app.js                ← orchestrator: bootstrap, navigation, reactive flush
├── state.js              ← единый mutable state (Proxy-обёрнут — см. контракты!)
├── dataStore.js          ← persistence (localStorage + SQLite-WASM optional)
├── rowFactory.js         ← фабрики Row + Employee (включая identity-поля для интеграций)
├── filters.js            ← FilterEngine (cache, getFiltered, getActiveCount)
├── reactiveStore.js      ← Reactive proxy + silent guard
├── views/                ← per-section render: registry, gantt, dashboard, employees, ...
├── integrations/         ← Portfolio Pulse, Black Dashboard, TechInfo, EmployeePerformance
├── chat/                 ← LLM-чат (отдельный AI-ассистент, не путать с aiView)
├── ai/                   ← AI-Анализ + AI-CEO views (analytics, не chat)
├── components/           ← переиспользуемые: Multiselect, TagInput
├── tests/unit/           ← 27 файлов, node:test
├── audit-2026-*/         ← read-only ADR-history (см. `docs/version-history.md`)
└── libs/                 ← vendored xlsx + sql-wasm
```

Для high-level diagram (data-flow) см. [`../ARCHITECTURE.md`](../ARCHITECTURE.md).