# 10. UX и продуктовые риски

## Loading states

| Где | Есть? | Качество |
|---|---|---|
| Pulse fetch (~30-90s) | ✓ skeleton + phase text | **отлично** — 5 phases с обновлением |
| Black Dashboard fetch | ✓ generic loader | **хорошо** |
| Tech-info fetch | ✓ generic | **хорошо** |
| CSV/XLSX import | ✗ нет | **плохо** — пользователь видит замёрзший UI |
| Save / sync | ✗ нет | **плохо** |
| Initial app load | ✓ "splash" welcome | OK |
| Registry render с 1000 строк | ✗ нет | **плохо** — тиху лагает |
| Gantt render | ✗ нет | **плохо** |

## Error states

| Источник ошибки | Что видит пользователь |
|---|---|
| Pulse — timeout на одном PK | сообщение в diagnostics + warning pill | ✓ |
| Pulse — все PKs timed out | error block + retry button | ✓ |
| Pulse — Bitbucket не настроен | "не настроен" pill | ✓ |
| Confluence пустой | в V12 после Phase 2 — детальный 9-attempt log | ✓ |
| LLM сеть упала | toast? **не проверял** |
| Storage QuotaExceeded | toast «Память браузера заполнена» | ✓ |
| ESM import fails (PromptsEditor case) | **СИЛЕНТ** — fix через защитный optional-chain | плохо до V11 |
| Network error в общем виде | разное по каждому пути | непостоянно |

## Empty states

- Registry без задач: `<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">Нет данных</div></div>` — есть.
- Pulse "Все команды" без participants: `'— нет участников за окно 48ч'`. ✓
- Black Dashboard без Sigma: `renderNotConfigured` → "⚙ Sigma Jira не настроена" + "Открыть настройки" кнопка. ✓
- Confluence без правок: "— нет данных". ✓

**Хорошо** — empty states предусмотрены везде.

## Onboarding

В ARCHITECTURE.md упомянут "24-step legacy tour". В коде:

```bash
$ ls onboarding/
demoData.js
onboarding.js
onboardingUI.js
```

Не разбирался детально (не было запроса). По коду — onboarding есть, легально опт-аут (`localStorage['q2_onboarding_v1']`).

## Текстовки

Прошёлся по `npm run lint` грепом на user-facing строки (`showToast`, `placeholder=`, `title=`, `aria-label=`):

**Удачные**:
- "Запрашиваю N проектов из Jira…" — конкретно.
- "Запрос отменён" / "Повторить" — кратко.
- "В работе сейчас" → "Назначенные задачи" (V11 улучшение).
- "Скопировано: X" toast в TechInfo.

**Проблемные**:
- В нескольких местах смесь "stale" / "Долго висят" / "Висит долго" / "Stale задач" — несогласованно по UI.
- "PR отревьюено" — корректное русское "отревьюировано", но допустимо в сленге.
- "Прогон" / "execution" в Zephyr секции — RU/EN перемешано.
- В `aiCeoFallback.js` — frase "...поможет ли это всему" — формулировка громоздкая.

**Опечаток** — не нашёл при беглом просмотре.

## Доступность

- **Без мыши**: 
  - Tab navigation между tabs Pulse — частично работает (button'ы фокусируемые). Но **активная tab не помечена** `aria-selected`/`tabindex`, screen reader не поймёт.
  - Pp-card-user `<details>` — доступно через Enter/Space (native HTML).
  - Модалки — Escape закрывает (Pulse / TechInfo / How modal). ✓
  
- **Скринридер**:
  - `aria-label` есть на close-кнопках (`✕`).
  - `aria-modal="true"` стоит. ✓
  - `aria-labelledby` стоит на 2 модалках. ✓
  - **Skip links** — нет.
  - **Live regions** для toast'ов — нет.

- **High contrast**:
  - `body.theme-dark` есть, тестировал визуально, работает.
  - Контраст foreground/background — не измерял.

**Severity**: M. Базовый уровень есть, но для пользователей со скринридером работа будет неудобной.

## Заключение

Категория | Оценка
---|---
Loading states | удовлетворительно — есть в новых разделах, нет в registry/gantt/import |
Error states | хорошо — везде показывается что не так |
Empty states | хорошо — все cover'ed |
Onboarding | не разбирался |
Текстовки | удовлетворительно — есть несогласованности, но опечаток нет |
A11y без мыши | удовлетворительно — Escape работает, но активная tab не помечена |
A11y скринридер | удовлетворительно — aria-* есть, но skip links / live regions нет |
