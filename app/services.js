'use strict';
/* ============================================================
   SERVICES REGISTRY — TECH кр.13 / AUDIT_TECH «window.* (50+) → DI»
   --
   Цель: заменить разрозненные `window.X` глобалы (51 PascalCase + 17
   lowercase utility) единым namespace'ом `Services.X` с явным
   register/get API. Не ломает существующие callsite'ы — модули
   ОДНОВРЕМЕННО регистрируются и в `Services`, и в `window` (backward
   compat). Постепенная миграция: новые consumer'ы зовут `Services.X`
   (или import из ES-модуля напрямую — предпочтительно), старые
   `window.X` callsite'ы продолжают работать.

   Pattern (для нового модуля):
     import { Services } from '../app/services.js';
     export const MyView = { render() {...} };
     Services.register('MyView', MyView);          // явная регистрация
     // backward compat — оставить если есть legacy window.X consumer'ы:
     if (typeof window !== 'undefined') window.MyView = MyView;

   Pattern (для consumer'а):
     import { Services } from '../app/services.js';
     // вместо: window.HistoryManager?.checkpoint(...)
     Services.HistoryManager?.checkpoint(...);
     // ещё лучше — direct ES import если нет cycle:
     import { HistoryManager } from '../app/historyManager.js';

   Зачем не сразу прямые import'ы:
     · Cross-cycle отношения (App ↔ views ↔ chat ↔ ai) — circular import
       hell в vanilla ES без bundler'а. Registry — escape hatch.
     · `Services.X` лучше типизируется через globals.d.ts (имя одно
       место) чем `window.X`.
     · ESLint-rule может запретить `window.[A-Z]X` для новых файлов
       (без блокировки legacy).

   Контракты:
     · `register(name, impl)` — идемпотентно: повторный register с тем
       же name заменяет (и пишет debug-warn если значение поменялось).
     · `get(name)` — возвращает зарегистрированный объект или undefined.
       Не throw — consumer должен сам проверять (как и `window.X?.foo()`).
     · `Services` сам — Proxy: `Services.X` = `Services.get('X')`.
     · `Services.has(name)` — для тестов / lazy-init checks.
     · `Services.list()` — debug: какие services уже зарегистрированы.

   Связь с EventBus:
     · Services — для long-lived объектов (singletons, views, stores).
     · EventBus — для эфемерных нотификаций (state-changed, section-entered).
     · Не дублируют друг друга. См. docs/window-globals-migration.md.
   ============================================================ */

const _registry = new Map();

function register(name, impl) {
  if (typeof name !== 'string' || !name) {
    throw new TypeError('Services.register: name must be non-empty string');
  }
  const prev = _registry.get(name);
  if (prev !== undefined && prev !== impl) {
    // Не throw — повторная регистрация (например, hot-reload в dev) валидна.
    try { console.warn(`[services] register('${name}') overwriting existing implementation`); } catch (_) {}
  }
  _registry.set(name, impl);
  // Mirror в window для backward compat — постепенно убирать когда
  // все consumer'ы переедут на Services.X. Не делаем если уже есть
  // и совпадает, чтобы не триггерить window setter'ы.
  if (typeof window !== 'undefined') {
    if (window[name] !== impl) window[name] = impl;
  }
}

/* Window-fallback: тестовые fixtures и legacy bootstrap могут
   присваивать `window.X = mock` без `register()`. В этом случае
   `Services.X` всё равно должен вернуть значение — иначе тесты
   и старый код, мигрированный на Services.X, ломаются.
   Production registration через `register()` имеет приоритет. */
function _resolve(name) {
  if (_registry.has(name)) return _registry.get(name);
  if (typeof window !== 'undefined') return window[name];
  return undefined;
}

function get(name) { return _resolve(name); }
function has(name) {
  if (_registry.has(name)) return true;
  if (typeof window !== 'undefined') return window[name] !== undefined;
  return false;
}
function list()    { return Array.from(_registry.keys()).sort(); }

/* Proxy для удобного `Services.X` доступа без get(). Свойства метод'ов
   (register/get/has/list) приоритетнее — они на самом target'е. */
const _target = Object.freeze({ register, get, has, list });
export const Services = new Proxy(_target, {
  get(t, prop) {
    if (prop in t) return t[prop];
    if (typeof prop === 'string') return _resolve(prop);
    return undefined;
  },
  has(t, prop) {
    if (prop in t) return true;
    if (typeof prop !== 'string') return false;
    if (_registry.has(prop)) return true;
    if (typeof window !== 'undefined') return window[prop] !== undefined;
    return false;
  },
  // Запрещаем set — используйте Services.register() явно.
  set() {
    try { console.warn('[services] direct assignment forbidden — use Services.register(name, impl)'); } catch (_) {}
    return false;
  },
});

if (typeof window !== 'undefined') window.Services = Services;
