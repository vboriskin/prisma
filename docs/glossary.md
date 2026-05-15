# Glossary (alias)

> Это **алиас** для `docs/domain-glossary.md` (исторический). По контракту
> AUDIT_HOLISTIC P8 каноническое имя — `docs/glossary.md`. Чтобы не ломать
> существующие ссылки из CLAUDE.md / state-contracts.md, сам файл живёт в
> `domain-glossary.md`, а здесь — навигационный stub + быстрый алфавитный
> индекс терминов.

См. полный документ: [`domain-glossary.md`](./domain-glossary.md).

---

## Алфавитный индекс (быстрый поиск)

| Термин | Раздел в `domain-glossary.md` |
|---|---|
| **ADR** | Сокращения · audit-папки = ADR-history |
| **Бэклог** | Окна планирования · `row.isUnassigned === true` |
| **Delta Jira** | Jira-инстансы — основная (`state.rows`) |
| **Demo-mode** | `onboarding/demoData.js` — first-run experience |
| **Эпик** | Эпик vs задача — три разных смысла |
| **Identity-таблица** | `state.employees[]` V17.2 |
| **JQL / CQL** | Сокращения |
| **Курс / дрейф / off-course** | Tone of voice — словарь Призмы (см. [`tone-of-voice.md`](./tone-of-voice.md)) |
| **Маскот Обсидиан** | Брендированный персонаж-FAB ([`brand.md`](./brand.md), [`spine-pill.md`](./spine-pill.md)) |
| **Овертайм / OT** | Окно «успеем но не в плановое окно» (`row.hasOvertime`) |
| **Plan-lock (V14)** | `state.planLocked` + `state.ganttEditMode` |
| **Призма** | Главный продукт. Был «СБОФ Планирование» (legacy `sbof_*`) |
| **Релизы 1.20 / 1.21 / 1.22** | Окна планирования (не DevOps-релизы) |
| **Risk Engine** | `riskEngine.js` — score + flags |
| **Scope** | `'Да' / 'Нет' / 'Требует подтверждения'` (3-значный) |
| **Sigma Jira** | Отдельный инстанс для квартальных goal-эпиков (Чёрный дашборд) |
| **Sigma fields** | Хранятся ВНУТРИ `jira_config.json` (исторический артефакт) |
| **Spine-pill** | Дизайн-система V15+ — 3px stripe вместо filled fill ([`spine-pill.md`](./spine-pill.md)) |
| **WORK_TYPES** | BE/FE/QA/Аналитика/Внедрение/... — типы работ в Ганте |
| **`[Х]/[X]/[В]/[B]` суффикс** | Заблокированный (уволенный) сотрудник; исключается из identity/coverage |

См. [`state-shape.md`](./state-shape.md) для shape объектов state / row / employee.

См. [`audits-index.md`](./audits-index.md) для расшифровки V11→V21 эпох.
