# V18.3 — Post-V18.2 Continuation MASTER PLAN

**Стартовая дата:** 2026-05-02
**Базис:** V18.2 graduate (Scanner 2.0 v2, 649 unit / 18 contract / 0 fail)
**Цель:** закрыть 5 P2 finding'ов из pilot Day-14 + 1 V18 tail (gantt split)
**Effort:** ~30-40ч в 6 шагов
**Status:** kickoff (open questions resolved 2026-05-02)

## Locked-in решения (open questions)

| # | Вопрос | Ответ |
|---|---|---|
| 1 | Per-team config storage | **UI** (settings-modal extension), не JSON-only |
| 2 | Gantt split methodology | **Reconnaissance первый** — час чтения кода → spec → approve → split |
| 3 | Olga fix priority | **Last** — A3→A2→A4→A5→B1→A1. Olga ждёт ~2 недели |
| 4 | Visual regression tests перед B1/D6 | **Не нужны для B1** (manual smoke). D6 откладывается в V19 после D4 |

## Roadmap (6 задач, 6 шагов)

| # | Задача | Effort | Triggered by | Audit-md |
|---|---|---|---|---|
| **A3** | «Ready for QA» dwell-threshold (extension regex) | XS ~30мин | Ilia (QA pilot) | `v18-3-A3-ready-for-qa.md` |
| **A2** | Zephyr Created vs Executed split | S ~2-3ч | Ilia | `v18-3-A2-zephyr-split.md` |
| **A4** | Share-link на сотрудника (URL hash) | S ~3-4ч | Maksim (Platform async) | `v18-3-A4-share-link.md` |
| **A5** | Anchor jump + click-to-filter (team-glance + multi-team) | S ~3-4ч | Anna (PO) | `v18-3-A5-anchor-filter.md` |
| **B1** | `views/gantt.js` 2637 LOC → 4-файла split | L ~10-14ч | V18 tail (= ex-P11) | `v18-3-B1-gantt-split.md` (двухэтапный) |
| **A1** | Per-team config layer (UI extension) | L ~8-10ч | Olga (ML pilot 5/10) | `v18-3-A1-per-team-config.md` |

**Total: ~28-35ч + 2 дня smoke + 1 неделя re-pilot Olga**

## Гарантии (DoD-критерии для каждого шага)

- Tests: ≥649 unit + 18 contract / 0 fail (must hold every commit)
- Manual smoke: scanner2 + intgrations subtab после каждого пункта
- Audit-md per item с шаблоном `что сделано / что не сделано / tests pass / regressions`
- При finalisation V18.3 — общий audit `v18-3-graduation.md` с retrospективой

## Kickoff order и зависимости

```
S1: A3 (30min) ──► A2 (3h) ──► A4 (4h)  ──┐  Sprint 1: ~7-8h, день
                                          ▼
                              S2: A5 (4h) ──► B1 reconnaissance (1h)
                                                              │
                                                              ▼
                                       S3: B1 split (10-13h, 1-2 дня) ── awaiting approve
                                                                          │
                                                                          ▼
                                                    S4: A1 (8-10h, 1.5 дня)
                                                                          │
                                                                          ▼
                                                    Sprint final: re-pilot Olga + ADR
```

Realistic timeline 1-1.5 weeks concentrated, 3-4 weeks streaming с другими задачами.

## Зависимости и risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| B1 reconnaissance показывает что 4-file split неоптимален | Medium | Re-spec → ещё approve. +1-2ч overhead |
| A1 UI требует bigger refactor settings-modal'а | Medium | Если выходит за 12ч → split на 2 шага: backend (config schema) + frontend (UI) |
| Olga psychологически уйдёт за 2 недели pending'а A1 | Low-Medium | Можно прислать ей ETA «А1 готов через 2 недели, держим»  по результатам S1 |
| B1 ломает gantt в production без visual regression | Low | Manual smoke pre-merge: 5 минут pass через все 3 modes (день/нед/месяц) + drag-drop + ctxMenu |
| Cumulative regressions от 6 commits | Low | Pre-merge run всех unit + manual smoke |

## Что НЕ входит в V18.3

- D6 (styles.css cleanup 11k LOC) — V19 после D4
- C-блок Scanner 2.0 V19 follow-ups (sprint goal SP, retention, virtualization, telemetry, hard delete v1) — V19
- E-блок Infrastructure (RBAC, mobile, testRunner retire, structured logging) — V19
- D-блок original V18-deferred (12 items B1-B12) — V19
- W-watchlist — uncommitted

См. [`v18-3-and-v19-roadmap.md`](./v18-3-and-v19-roadmap.md) для полного backlog'а.

## Договорённости

- **Порядок** — последовательно (A3 → A2 → A4 → A5 → B1 → A1), без перепрыгивания
- **Тесты** не должны откатываться: 649/18/0 минимум, добавляться от A1/A5/B1 ожидаются
- **Audit-метки в коде** — формат `V18.3 <key> [(pilot persona)] — <описание>`
- **B1 — двухэтапный:** reconnaissance commit → ⏸ awaiting approve → split commit. Нельзя пропускать stage 1.

---

**Готовность V18.3 к старту:** open questions resolved. Можно приступать к A3.

Suggested first action: `v18-3-A3-ready-for-qa.md` — описать spec (regex для `pickDwellThreshold`) + сделать commit за 30 минут.
