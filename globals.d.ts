// Ambient declarations for window-attached globals used across modules.
//
// The codebase intentionally exposes orchestrator objects on `window` to avoid
// circular ES-module imports. This file tells `tsc --checkJs` they exist so
// it doesn't flag every `window.App?.foo()` call as an error.
//
// Add new entries here when you attach something fresh to `window`.
//
// AUDIT_TECH кр.13 — миграция window.* → Services registry (см.
// docs/window-globals-migration.md). Новые service-singletons теперь
// регистрируются через `Services.register()` из `app/services.js`. Window
// продолжает зеркалировать для backward compat. Этот файл описывает оба
// канала.

interface Window {
  /** dataStore.applyBulkAction — exposed for chat/* and views/registry. */
  applyBulkAction: (...args: any[]) => any;
  /** chat/chatReports.takeSnapshot. */
  takeSnapshot: (...args: any[]) => any;

  /** SQLite WASM facade (loaded lazily). */
  SQLiteStore?: {
    init: () => Promise<boolean>;
    isReady: () => boolean;
    isAvailable?: () => Promise<boolean>;
    lastError?: () => string;
    getRows: () => any[];
    saveRows: (rows: any[]) => void;
    persistNow: () => Promise<boolean>;
    exportDump: () => Uint8Array;
    importDump: (bytes: Uint8Array) => void;
    clearAll: () => void;
    size: () => number;
    runRaw: (sql: string, params?: any[]) => any[];
    clearPersistence: () => Promise<void>;
    [k: string]: any;
  };

  /** AppDataStore — V11 unified store facade. */
  AppDataStore?: {
    mode: string;
    setMode: (mode: string) => void;
    init: () => Promise<void>;
    getRows: () => any[];
    saveRows: (rows: any[]) => void;
    migrateFromLocalStorage: () => Promise<{ ok: boolean; rowsCount?: number; error?: string; alreadyMigrated?: boolean }>;
    migrateToLocalStorage:   () => Promise<{ ok: boolean; rowsCount?: number; error?: string }>;
    persist: () => Promise<void>;
    status: () => { mode: string; sqliteReady: boolean; dumpSize: number; migrated: boolean };
    [k: string]: any;
  };

  /** Modules attached by the decomposed app/* files (avoid import cycles). */
  App?: any;
  AppSettings?: any;
  HistoryManager?: any;
  HistoryModule?: any;
  Onboarding?: any;
  ActionLayer?: any;
  ThemeUI?: any;
  RegistryView?: any;
  BulkEditPanel?: any;
  LLMAssistant?: any;
  Nav?: any;
  PortfolioPulse?: any;

  /** UI helpers. */
  showToast?: (msg: string, type?: string, ms?: number) => void;
  showFunnyLoader?: (initialMsg?: string) => { update: (text: string) => void; close: () => void };

  /** Chat-side bridges. */
  executeAction?: (...args: any[]) => any;

  /** Loaders for non-module libs. */
  XLSX?: any;
  initSqlJs?: (config: any) => Promise<any>;
  CSVStreamExporter?: any;

  /** Integrations renderer hooks (set by views/integrationsView). */
  IntegrationsLoadSettings?: () => any;
  IntegrationsRenderModal?: (cfg: any, opts?: any) => string;
  IntegrationsBindModal?: () => void;
}

/** showToast can also carry a debounce-id property (used by the toast queue). */
type ShowToastFn = ((msg: string, type?: string, ms?: number) => void) & { _t?: number };

declare const showToast: ShowToastFn;

/* ────────────────────────────────────────────────────────────
   AUDIT_TECH кр.13 — Services registry + EventBus typing.
   ──
   Services — single namespace для service-singletons (replaces window.X).
   EventBus — pub/sub для эфемерных нотификаций.
   См. docs/window-globals-migration.md.
   ─────────────────────────────────────────────────────────── */

interface ServicesRegistry {
  /** Регистрация сервиса. Идемпотентно. */
  register(name: string, impl: any): void;
  /** Получить зарегистрированный сервис или undefined. */
  get(name: string): any;
  /** Проверить что зарегистрирован. */
  has(name: string): boolean;
  /** Список зарегистрированных имён (для debug). */
  list(): string[];
  /** Любой зарегистрированный сервис: `Services.HistoryManager?.checkpoint(...)` */
  [key: string]: any;
}

interface EventBusType {
  on(event: string, handler: (payload?: any) => void): () => void;
  off(event: string, handler: (payload?: any) => void): void;
  once(event: string, handler: (payload?: any) => void): () => void;
  emit(event: string, payload?: any): void;
  clear(event?: string): void;
}

declare const Services: ServicesRegistry;
declare const EventBus: EventBusType;

interface Window {
  Services?: ServicesRegistry;
  EventBus?: EventBusType;
}
