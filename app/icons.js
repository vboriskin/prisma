'use strict';
/* ============================================================
   ICONS — line-glyph набор для Призмы (Lucide-derived).
   --
   Принцип: 24x24 viewBox, stroke="currentColor", stroke-width=1.5,
   round caps/joins. Цвет наследуется от родителя (color), размер
   через width/height в CSS / атрибутах.

   Использование:
     import { Icons } from './icons.js';
     element.innerHTML = Icons.get('lock', { size: 16, label: 'Зафиксировать' });

   В HTML (template-literal):
     `<button>${Icons.get('lock', { size:16, label:'Зафиксировать' })}</button>`

   В index.html инициализация — через `[data-icon="lock"]`-атрибут:
     <button data-icon="lock" data-icon-size="16" aria-label="Зафиксировать"></button>
     ICONS_PIPELINE.hydrate(document) после DOMContentLoaded.

   Возвращает HTML-строку: <span class="prizma-icon" role="img" aria-label="...">SVG…</span>
   при наличии `label`. Без `label` — `aria-hidden="true"` (декоративная роль).

   ============================================================ */

/** SVG-path тела иконок. Скопировано из Lucide (https://lucide.dev),
 *  адаптировано stroke 1.5 px (Призма-line-glyph). */
const ICON_PATHS = {
  // ── Действия ────────────────────────────────────────────────
  'lock':              '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'unlock':            '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  'pencil':            '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  'trash':             '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  'settings':          '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'undo':              '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.7 2.95L3 13"/>',
  'redo':              '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6.7 2.95L21 13"/>',
  'rotate-cw':         '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  'rotate-ccw':        '<path d="M3 12a9 9 0 1 0 9-9c-2.52 0-4.93 1-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  'check':             '<polyline points="20 6 9 17 4 12"/>',
  'check-circle':      '<circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/>',
  'x':                 '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  'plus':              '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  'minus':             '<line x1="5" y1="12" x2="19" y2="12"/>',
  'plus-square':       '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
  // V21 audit 08-chatbot §1: filled stop-square для assistant-btn-stop.
  'square':            '<rect x="5" y="5" width="14" height="14" rx="2" ry="2" fill="currentColor"/>',
  'minus-square':      '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="8" y1="12" x2="16" y2="12"/>',
  // ── Навигация / поиск ──────────────────────────────────────
  'search':            '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  'command':           '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>',
  'pin':               '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  'crosshair':         '<circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/>',
  'map':               '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>',
  // ── Тема / симуляция / звезда / молния ───────────────────────
  'moon':              '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  'sun':               '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  'zap':               '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  'sparkles':          '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
  // ── Layout / view modes ────────────────────────────────────
  'layout-grid':       '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  'grid':              '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  'list':              '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  'chevrons-up-down':  '<polyline points="7 15 12 20 17 15"/><polyline points="7 9 12 4 17 9"/>',
  'chevron-left':      '<polyline points="15 18 9 12 15 6"/>',
  'chevron-right':     '<polyline points="9 18 15 12 9 6"/>',
  'chevron-down':      '<polyline points="6 9 12 15 18 9"/>',
  // ── Onboarding / навигация-метафора (П10.8) ────────────────
  // compass — Северная звезда / ориентир в продуктовом туре.
  'compass':           '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  // ── Файлы / экспорт / папки ─────────────────────────────────
  'folder':            '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  'file-text':         '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
  'clipboard':         '<rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  'upload':            '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  'download':          '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  // AUDIT_SCANNER #35 — печать / save-as-PDF (Lucide `printer`).
  'printer':           '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  // ── Чат / сообщения ────────────────────────────────────────
  'message-square':    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  // ── Метрики / графики ──────────────────────────────────────
  'trending-up':       '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  'trending-down':     '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  'bar-chart':         '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  // ── Категории / роли ───────────────────────────────────────
  'user':              '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  'users':             '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'shield':            '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  'tag':               '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  'wrench':            '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  'lightbulb':         '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M2 13a8 8 0 0 1 14.07-5.18 7.96 7.96 0 0 1 .61 8.24 4.79 4.79 0 0 1-1.4 1.6.94.94 0 0 0-.28.7v.64H9v-.64a.94.94 0 0 0-.28-.7c-.55-.46-1.02-1-1.4-1.6A7.96 7.96 0 0 1 2 13z"/>',
  'rocket':            '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15 9 12a14.06 14.06 0 0 1 4-7l5-3 3 5a14.06 14.06 0 0 1-7 4z"/>',
  'calendar':          '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  // ── Алерты ─────────────────────────────────────────────────
  'alert-triangle':    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  // bell — Notification Center (AUDIT_HOLISTIC F4). Lucide-derived,
  // совместим с line-glyph (stroke 1.5px).
  'bell':              '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  'alert-circle':      '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  'flame':             '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  'no-symbol':         '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
  // ── Прочее ─────────────────────────────────────────────────
  'eye':               '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off':           '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>',
  'cpu':               '<rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/><line x1="20" y1="9" x2="22" y2="9"/><line x1="20" y1="14" x2="22" y2="14"/><line x1="2" y1="9" x2="4" y2="9"/><line x1="2" y1="14" x2="4" y2="14"/>',
  // ── Work-type glyphs (V21 P11.35, маппятся через app/prizmaUI.js → workTypeIcon) ──
  'monitor':           '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  'smartphone':        '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  'shield-check':      '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
  'palette':           '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.52-4.48-10-10-10z"/><circle cx="13.5" cy="6.5" r="0.5" fill="currentColor"/><circle cx="17.5" cy="10.5" r="0.5" fill="currentColor"/><circle cx="8.5" cy="7.5" r="0.5" fill="currentColor"/><circle cx="6.5" cy="12.5" r="0.5" fill="currentColor"/>',
  'server':            '<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  'database':          '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  'archive':           '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><line x1="10" y1="13" x2="14" y2="13"/>',
  'hourglass':         '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
  // ── Fullscreen toggles (V21 P11.3) ────────────────────────
  'maximize':          '<path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/>',
  'minimize':          '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
  // ── V22 Brand Phase 2 — integrations (Lucide-derived) ─────
  // Loader-фигура «Призма» — 8-лучевая звезда, brand-glyph (брендбук §11).
  'star':              '<path d="M12 2 L13.7 8.4 L20 7 L15.5 11.5 L20 16 L13.7 15.6 L12 22 L10.3 15.6 L4 16 L8.5 11.5 L4 7 L10.3 8.4 Z"/>',
  // help-circle — кнопка «❓ Как считается»
  'help-circle':       '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  // target — цели Чёрного дашборда
  'target':            '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  // copy — кнопка «📋 копировать»
  'copy':              '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  // send — Telegram-кнопка «📋 TG»
  'send':              '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  // link-2 — связи между сущностями (покрытие)
  'link-2':            '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/>',
  // bar-chart-3 — Метрики
  'bar-chart-3':       '<path d="M3 3v18h18"/><path d="M7 16V8"/><path d="M12 16v-5"/><path d="M17 16v-3"/>',
  // inbox — empty-state «📥 готов к загрузке»
  'inbox':             '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  // play — WIP / «▶ x задач в работе»
  'play':              '<polygon points="5 3 19 12 5 21 5 3"/>',
  // circle (empty) — «☐ todo / x задач не начато»
  'circle':            '<circle cx="12" cy="12" r="10"/>',
  // message-circle — «💬 Обсудить 1:1»
  'message-circle':    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  // line-chart — «📊 События»
  'line-chart':        '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  // circle-dot — Чёрный дашборд header glyph (◯•) и SWITCH-аналоги
  'circle-dot':        '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
  // alert-octagon — STOP / blocker / «🚫»
  'alert-octagon':     '<polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  // user-tag — «👤 1:1» подпись персоны
  'user-tag':          '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  // wrench-2 — «🔧 За 48ч» (отдельно от существующего wrench, но тут используем уже-существующий)
  // (используем уже-существующий 'wrench')
  // UX скв.4 — иконки для замены эмодзи в production UI (Lucide-derived).
  // clock — «⏳/⏰» индикатор loading/queue/long-running (renderSkeleton).
  'clock':             '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  // radio — «📡» Сканнер команд / live-data feed (Portfolio Pulse empty state).
  'radio':             '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>',
  // play-circle — «🎬» демо / посмотреть демо (onboarding empty-state).
  'play-circle':       '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>',
};

/** Размер по умолчанию для неуказанного size. */
const DEFAULT_SIZE = 16;

/**
 * Возвращает HTML-строку с inline-SVG.
 *
 * @param {string} name  Имя из ICON_PATHS.
 * @param {object} [opts]
 * @param {number} [opts.size=16]  Размер в px (квадрат).
 * @param {string} [opts.label]    aria-label. Если не указан — иконка декоративная (`aria-hidden="true"`).
 * @param {string} [opts.cls]      Доп. CSS-класс.
 * @param {number} [opts.stroke=1.5]  Stroke-width SVG.
 * @returns {string}  HTML.
 */
function get(name, opts = {}) {
  const size   = opts.size  || DEFAULT_SIZE;
  const stroke = opts.stroke ?? 1.5;
  const path   = ICON_PATHS[name];
  if (!path) {
    // Защита от опечатки — не падаем, рендерим пустой placeholder.
    return `<span class="prizma-icon prizma-icon-missing" data-icon-missing="${name}" aria-hidden="true" title="icon:${name}"></span>`;
  }
  const ariaAttr = opts.label
    ? `role="img" aria-label="${opts.label.replace(/"/g, '&quot;')}"`
    : 'aria-hidden="true"';
  const cls = ['prizma-icon', opts.cls].filter(Boolean).join(' ');
  return `<span class="${cls}" ${ariaAttr}>` +
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="currentColor" stroke-width="${stroke}" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `${path}` +
    `</svg></span>`;
}

/**
 * Hydrate шаг — для иконок в `index.html` через `data-icon` атрибут.
 * Сканирует root и заменяет `<button data-icon="lock" data-icon-size="16">текст</button>`
 * на текст + svg. Существующий innerHTML сохраняется, SVG добавляется первым.
 *
 * Используется на DOMContentLoaded для топбара / тулбара.
 */
function hydrate(root = document) {
  const targets = root.querySelectorAll('[data-icon]:not([data-icon-hydrated])');
  for (const el of targets) {
    const name = el.dataset.icon;
    const size = parseInt(el.dataset.iconSize, 10) || DEFAULT_SIZE;
    const label = el.getAttribute('aria-label') || el.title || '';
    // Для кнопок с текстом: SVG + space + existing text.
    // Для glyph-only: только SVG (текст уже пустой / зачищается).
    const existing = el.innerHTML.trim();
    const svg = get(name, { size, label: label || undefined });
    el.innerHTML = svg + (existing ? ' ' + existing : '');
    el.dataset.iconHydrated = '1';
  }
}

/** Возвращает «сырой» SVG-фрагмент без span-обёртки и aria-атрибутов.
 *  Полезно для вставки в self-contained экспорт (`views/ganttHtmlExport.js`),
 *  где нужно избежать лишних `<span>` в строгих HTML-парсерах. */
function rawSvg(name, opts = {}) {
  const size   = opts.size  || DEFAULT_SIZE;
  const stroke = opts.stroke ?? 1.5;
  const path   = ICON_PATHS[name];
  if (!path) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="currentColor" stroke-width="${stroke}" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `${path}</svg>`;
}

/**
 * Brand-loader helper (V22 §11 Loaders).
 * Заменяет круговой spinner / meme-grin / эмодзи-фразы на единый
 * 8-лучевой Призма-glyph + ring/skeleton/inline-pulse состояния.
 *
 * Уровни:
 *   L1 — inline (per-button), маленькая «дышащая» звезда
 *   L2 — page-level (тяжёлый рефреш), звезда + крутящееся кольцо + caption
 *   L3 — skeleton-плашка (для списков / карточек)
 *
 * CSS-классы (.prizma-loader-L*, .prizma-loader-star, .prizma-loader-ring,
 * .prizma-loader-caption, .prizma-loader-skeleton) — Brand-CSS-агент.
 *
 * @param {'L1'|'L2'|'L3'} [level='L2']
 * @param {string} [caption='Сверяем курс']
 * @returns {string} HTML
 */
function renderPrismaLoader(level = 'L2', caption = 'Сверяем курс') {
  if (level === 'L1') {
    return `<span class="prizma-loader prizma-loader-L1" role="status" aria-live="polite">${rawSvg('star', { size: 16 })}</span>`;
  }
  if (level === 'L3') {
    return `<div class="prizma-loader-skeleton" role="status" aria-live="polite" style="width:100%;height:1em"></div>`;
  }
  // L2 default — page-level
  const safeCap = String(caption ?? 'Сверяем курс').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  return (
    `<div class="prizma-loader prizma-loader-L2" role="status" aria-live="polite">` +
      `<div class="prizma-loader-figure">` +
        `${rawSvg('star', { size: 48 })}` +
        `<span class="prizma-loader-ring" aria-hidden="true"></span>` +
      `</div>` +
      `<div class="prizma-loader-caption">${safeCap}</div>` +
    `</div>`
  );
}

export const Icons = { get, hydrate, rawSvg, renderPrismaLoader, ICON_PATHS };

// TECH кр.13 — pilot-migration на Services registry. Теперь модуль виден
// через `Services.Icons` И через `window.Icons` (backward compat).
// Новые consumer'ы предпочитают ES import; circular-cycle случаи —
// через Services.X.
import { Services } from './services.js';
Services.register('Icons', Icons);
// Backward-compat (Services.register уже зеркалит на window). Оставлено
// явно — signal что модуль ОЖИДАЕТ window.Icons mirror; будет удалено
// когда все ad-hoc innerHTML callsite'ы (`${window.Icons.get(...)}`)
// мигрируют на ES import.
if (typeof window !== 'undefined') window.Icons = Icons;
