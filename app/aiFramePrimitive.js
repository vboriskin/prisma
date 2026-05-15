'use strict';
/* ============================================================
   app/aiFramePrimitive.js — AUDIT_ARTDIRECTION #20.

   AI-frame primitive: единый визуальный «шов» для AI-разделов
   (AI CEO, AI Анализ). Цель — дать ощущение «думающей системы»,
   а не «отчёт rule-based».

   3 элемента primitive'а:
     1. Insight-glow — однократный 800ms pulse box-shadow на корневом
        hero-элементе при поступлении свежих AI-данных. Цвет —
        --prizma-insight (брендбук §3 Signal: Insight #B084CC dark /
        #6B4488 light). Не gradient, не animation infinite —
        одноразовая «вспышка осознания».

     2. Mascot state — переключение fab/avatar маскота (или маскота
        в указанной области) в `obs--ls-thinking` пока fetch'ятся
        AI-данные, потом `obs--success` (1.5s), потом обратно в
        default `obs--breathe`.

     3. AI-only stripe — карточки, которые получили данные ОТ AI
        (а не fallback rule-based), помечаются data-ai-only="true";
        runtime CSS вешает 3px stripe-left цветом --prizma-insight
        (брендбук §3 «3px stripe для активных»).

   Никаких gradients, никаких эмодзи, никаких infinite-glow.
   Все эффекты кратковременные (≤2s) — не отвлекают от данных.

   Контракт data:
     - aiFallbackEngine / aiCeoFallback кладут `source: 'ai'` или
       `source: 'rule-based'` на каждый верхнеуровневый блок.
     - markAiOnlyCard(el) — DOM-side маркер, читается CSS.
   ============================================================ */

import { ObsidianMascot } from './obsidianMascot.js';
import { Services } from './services.js';

/* ── ID для runtime style-блока (одноразовая инжекция) ───────── */
const RUNTIME_STYLE_ID = 'audit-art-aiFrame-style';

/* ── Inject runtime CSS один раз на загрузку. ───────────────── */
function _ensureRuntimeStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(RUNTIME_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = RUNTIME_STYLE_ID;
  style.textContent = `
    /* AUDIT-ART #20 — Insight-glow keyframes (одноразовый pulse).
       4-token spread: 0 → 4px → 8px → исчезает за 800ms. */
    @keyframes prizma-insight-glow {
      0%   { box-shadow: 0 0 0 0 rgba(176, 132, 204, 0); }
      30%  { box-shadow: 0 0 0 4px rgba(176, 132, 204, 0.35); }
      70%  { box-shadow: 0 0 0 8px rgba(176, 132, 204, 0.18); }
      100% { box-shadow: 0 0 0 12px rgba(176, 132, 204, 0); }
    }
    body.theme-light .prizma-insight-glow {
      animation: prizma-insight-glow-light 800ms ease-out 1;
    }
    @keyframes prizma-insight-glow-light {
      0%   { box-shadow: 0 0 0 0 rgba(107, 68, 136, 0); }
      30%  { box-shadow: 0 0 0 4px rgba(107, 68, 136, 0.30); }
      70%  { box-shadow: 0 0 0 8px rgba(107, 68, 136, 0.14); }
      100% { box-shadow: 0 0 0 12px rgba(107, 68, 136, 0); }
    }
    .prizma-insight-glow {
      animation: prizma-insight-glow 800ms ease-out 1;
    }

    /* AUDIT-ART #20 — AI-only stripe.
       Spine-pill §3: 3px stripe-left для accent-state. Insight-токен —
       AI-зарезервирован. На карточках с data-ai-only="true" stripe
       заменяет любой существующий border-left. */
    [data-ai-only="true"] {
      border-left: 3px solid var(--prizma-insight, #B084CC) !important;
    }
    body.theme-light [data-ai-only="true"] {
      border-left-color: var(--prizma-insight, #6B4488) !important;
    }

    /* AUDIT-ART #20 — AI-frame корневой контейнер: тонкий accent-hint
       что вся область — AI-driven (без gradient). */
    .prizma-ai-frame {
      position: relative;
    }
  `;
  document.head.appendChild(style);
}

/* ── Apply AI-frame: добавляет .prizma-ai-frame + data-ai-frame. ─ */
/**
 * @param {HTMLElement} element  — обычно hero-элемент или page-root.
 * @param {object}     [opts]
 * @param {string}     [opts.source]  — 'ai' | 'rule-based'.
 *   При source='ai' карточка помечается data-ai-only="true" — CSS повесит stripe.
 */
export function applyAiFrame(element, opts = {}) {
  if (!element) return;
  _ensureRuntimeStyle();
  element.classList.add('prizma-ai-frame');
  if (opts.source) {
    element.dataset.aiFrameSource = String(opts.source);
  }
}

/* ── Однократный insight-glow pulse на корневом элементе. ────── */
/**
 * Вызывать на каждое поступление свежих AI-данных. CSS-animation
 * однократная (800ms), потом класс снимается чтобы повторный вызов
 * рестартовал animation (force reflow паттерн).
 *
 * @param {HTMLElement} element
 */
export function triggerInsightGlow(element) {
  if (!element) return;
  _ensureRuntimeStyle();
  // Reduced-motion guard — пользователь явно сказал «без анимаций».
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
  } catch (_) {}
  element.classList.remove('prizma-insight-glow');
  // Force reflow чтобы повторный add рестартовал animation.
  void element.offsetWidth;
  element.classList.add('prizma-insight-glow');
  // Снять класс по завершению animation чтобы не оставлять его в DOM.
  const cleanup = () => {
    element.classList.remove('prizma-insight-glow');
    element.removeEventListener('animationend', cleanup);
  };
  element.addEventListener('animationend', cleanup);
  // Safety-net: если animationend не срабатывает (display:none и т.п.).
  setTimeout(() => element.classList.remove('prizma-insight-glow'), 1200);
}

/* ── Set mascot state in given area (или global FAB если area=null). */
/**
 * Состояния:
 *   'thinking' — obs--ls-thinking (loop, пока ждём AI).
 *   'success'  — obs--success (once → breathe), 1.5s.
 *   'idle'     — снять exclusive, вернуться в breathe.
 *
 * Если area указано и в нём НЕТ маскота — fallback на глобальный FAB
 * через ObsidianMascot.setChatPhase / pulseAlertOnFab.
 *
 * @param {HTMLElement|null} area
 * @param {'thinking'|'success'|'idle'} state
 */
export function setMascotState(area, state) {
  if (typeof document === 'undefined') return;
  // Найти первый маскот-элемент в указанной области.
  let target = null;
  if (area) {
    target = area.querySelector?.('.obs');
  }
  // Fallback на глобальный FAB маскота. Используем публичный API
  // ObsidianMascot.setChatPhase — он сам обрабатывает hydrate / animationend.
  if (!target) {
    if (state === 'thinking') {
      Services.ObsidianMascot?.setChatPhase?.('thinking');
    } else if (state === 'success') {
      // Глобальный FAB не имеет 'success' phase (это Tier 2 outside chat).
      // Используем publicly-available concerned->breathe pattern? нет — успех
      // = breathe возврат после loading. Просто вернём в idle.
      Services.ObsidianMascot?.setChatPhase?.('complete');
      // через 1.5s гарантированно обратно в idle
      setTimeout(() => { Services.ObsidianMascot?.setChatPhase?.('idle'); }, 1500);
    } else if (state === 'idle') {
      Services.ObsidianMascot?.setChatPhase?.('idle');
    }
    return;
  }
  // Локальный target — управляем через ObsidianMascot.setChatPhase(target).
  // Hydrate если ещё не hydrated.
  try { Services.ObsidianMascot?.hydrate?.(target); } catch (_) {}
  if (state === 'thinking') {
    Services.ObsidianMascot?.setChatPhase?.('thinking', target);
  } else if (state === 'success') {
    Services.ObsidianMascot?.setChatPhase?.('complete', target);
    setTimeout(() => { Services.ObsidianMascot?.setChatPhase?.('idle', target); }, 1500);
  } else if (state === 'idle') {
    Services.ObsidianMascot?.setChatPhase?.('idle', target);
  }
}

/* ── Помечает карту как «AI-only» — CSS повесит insight stripe. ─ */
/**
 * @param {HTMLElement} element
 */
export function markAiOnlyCard(element) {
  if (!element) return;
  _ensureRuntimeStyle();
  element.dataset.aiOnly = 'true';
}

/* ── Убирает AI-only маркер (когда рендер пере-используется в rule-mode). */
export function unmarkAiOnlyCard(element) {
  if (!element) return;
  delete element.dataset.aiOnly;
}

/* ── Convenience: пометить все элементы с data-source="ai" в области. */
/**
 * Сканирует область, ищет все [data-source="ai"] и применяет markAiOnlyCard.
 * Используется renderer'ами после полного rerender.
 *
 * @param {HTMLElement} root
 */
export function syncAiOnlyMarkers(root) {
  if (!root || !root.querySelectorAll) return;
  _ensureRuntimeStyle();
  root.querySelectorAll('[data-source="ai"]').forEach(el => markAiOnlyCard(el));
  root.querySelectorAll('[data-source="rule-based"]').forEach(el => unmarkAiOnlyCard(el));
}

// Совместимость с inline-вызовами без import (на случай ad-hoc использования).
const PrizmaAiFrame = {
  applyAiFrame,
  triggerInsightGlow,
  setMascotState,
  markAiOnlyCard,
  unmarkAiOnlyCard,
  syncAiOnlyMarkers,
};
Services.register('PrizmaAiFrame', PrizmaAiFrame);
if (typeof window !== 'undefined') {
  window.PrizmaAiFrame = PrizmaAiFrame;
}
