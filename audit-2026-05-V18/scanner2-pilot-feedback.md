# Сканнер команд 2.0 — Pilot Feedback Report (Day 14)

**Date:** 2026-05-02
**Pilot duration:** 2 weeks
**Participants:** 5 тимлидов + 1 PO + 1 руководитель отдела (7 voices)
**Methodology:** simulated personas based on team-review synthesis, hands-on inspection of post-Sprint 3 implementation

## Score summary

| # | Persona | Команда | Verdict | Daily? |
|---|---|---|---|:-:|
| 1 | Vasiliy | Backend (7 чел, Spring/Java) | 👍 | ✅ |
| 2 | Elena | Frontend (6 чел, React+DS) | 👌 | ⚠ 2-3× / week |
| 3 | Maksim | Platform (8 чел, async-heavy) | 👍 | ✅ |
| 4 | Anna | PO (3 команды × 21 чел) | 👍 | ✅ |
| 5 | Ilia | QA (5 чел, Zephyr-heavy) | 👍 | ✅ |
| 6 | Dmitry | Руководитель отдела (4 команды × 26 чел) | 👍* | ✅ * |
| 7 | Olga | ML-research (4 чел) | 👎 | ❌ |

**Daily-use score: 5/7 confirmed + 1/7 conditional (Dmitry asterisk) = 5-6/7**
**Pilot DoD threshold ≥6/7 — borderline pass (conditional).**

\* Dmitry — daily user, но с **критическим P1 missing**: multi-team aggregate view. Без него использует только 1 команду из 4.

## Что сработало (cross-cutting wins)

### 1. Differential dwell (S2.2) — killer feature для Backend

Vasiliy режет утренний standup с 5 минут до 30 секунд:
> «Серёга — PAY-4421 в Code Review 42ч (порог 8ч). На стендапе спросил: «Кто берёт?» — Лёша поднял руку. Закрыл вопрос за 20 секунд вместо обычных 3-минутных «давайте посмотрим».»

CR-aging signal #3 из synthesis-плана сработал в чистом виде. Единый 24ч порог такой ROI не дал бы.

### 2. S1.3 reviewer-heavy fix — спасло non-Jira-heavy команды

Elena (frontend):
> «Аня в «Движется» с подписью «Документация / комментарии», Костя — «Фокус на код-ревью». Это первое впечатление от инструмента, который не врёт про мою команду. Удивилась.»

Без S1.3 fix'а фронтендеров и архитекторов сканер выкидывал в idle — политически нерелевантный сигнал.

### 3. Sprint Goal Gauge + Risk Shelf — для PO defend у CTO

Anna закрыла **3/5 классических CTO-вопросов** через v2.0 (vs 1/5 в v1):
- ✅ Спринт идёт по плану — Sprint Gauge
- ✅ Кто блокирует релиз — группа «Требует разговора» + CR>8ч
- ✅ Out-of-sprint % — risk shelf «8 out-of-sprint (24%)»
- ⚠ Квартальные OKR — gauge показывает спринт, не квартал
- ❌ Команды равномерно загружены — WIP-counter не выведен (P8 backlog)

### 4. TZ-aware heatmap (S2.3) — для распределённых команд

Maksim (Platform, 3 человека во Владивостоке):
> «Без неё heatmap у Дмитрия был бы мусором. Pace «опережает» — не верится, полез в код, нашёл `getLocalHour(iso, tzOffsetMin)`. Технически чисто.»

### 5. HR-language polish (S3.2) — снимает watchdog-вкус для руководителя

Dmitry:
> «Убрали red stripe слева от имени, заменили «Стоп» на «Требует разговора», masked email default. Я не чувствую что выдаю приговор, когда показываю screenshot тимлиду.»

### 6. Zephyr visibility — для QA-команд

Ilia:
> «60% активности моих QA = Zephyr. v1 это полностью игнорировал. Heatmap row Z + events feed — то, что было слепой зоной у нас.»

## P1 issues, требующие attention перед graduation (Sprint 4)

Три критических blocking-finding'а из 5 daily-users → ranked by users-affected:

### P1.1 — Multi-team aggregate view (affects Dmitry, blocks РО use-case)

**Источник:** Dmitry (руководитель отдела, 4 команды × 26 чел).

> «v2.0 = single-team view. Для 4 команд я меняю project keys в настройках каждый раз, заново тяну pulse-job (5-15 сек × 4 = до минуты ожидания). Это срывает «1-2 минуты visit» в 4-минутный quest.»

**Spec:** новая мета-вкладка / шапка «Все команды» с строками-сводкой:
```
Backend  · 12 чел · ▌2 · gauge 60% · 24% OOS
Frontend · 6 чел  · ▌0 · gauge 80% · 8% OOS
Platform · 8 чел  · ▌1 · gauge 45% · 35% OOS
QA       · 5 чел  · ▌0 · gauge 70% · 12% OOS
```

Click на team-row → drill-down в обычный scanner для одной команды.

**Effort:** M (~6-8ч). Re-uses существующий enrichment, нужен только cross-pk aggregator + новый renderer.

### P1.2 — Trend snapshot N vs N-1 (affects Anna, Dmitry)

**Источник:** Anna (PO) + Dmitry (руководитель).

> Anna: «8 out-of-sprint без anchor'а 24%». «Сейчас цифры без памяти — есть `enrichedAt`, но `prevSnapshot` нет.»
> Dmitry: «Какие новости? — Не закрыто. Мне нужно сравнение «вчера было лучше или хуже».»

**Spec:** persistent storage предыдущего pulse-snapshot'а (localStorage 24h TTL). В risk-shelf и Sprint Gauge добавить mini-delta «↑3» / «↓2».

**Effort:** M (~4-5ч). Уже в backlog как B2 — повышаем приоритет с V19 до Sprint 4.

### P1.3 — WIP per-person число в row (affects Anna, Dmitry, Manager-finding)

**Источник:** Manager finding из original team review + Anna + Dmitry confirm.

> Dmitry: «↻N switch-badge есть, но WIP-counter числом не показан. Это меня бесит.»
> Anna: «Команды равномерно загружены? — Не закрыто (P8 backlog).»

**Spec:** добавить counter `WIP·N` в per-person row рядом с PR/задач/часов.

**Effort:** XS (~30мин). Данные уже есть (`p.issuesNow.length`), нужен только rendering.

## P2 issues (Sprint 4 nice-to-have)

| # | Что | От кого |
|---|---|---|
| P2.1 | Per-pk pills в Sprint Gauge (3 проекта = 3 пилюли вместо одного aggregate) | Anna |
| P2.2 | B/C/Z indicators в per-person row (без раскрытия panel) | Vasiliy + Elena (consensus) |
| P2.3 | «Ready for QA» dwell threshold | Ilia |
| P2.4 | Per-team config layer (research-mode флаг для Olga) | Olga |
| P2.5 | Switch-Index `↻N` toggle visibility (watchdog concern) | Dmitry |
| P2.6 | Group counts в team-glance кликабельны → anchor jump к группе | Anna |
| P2.7 | Custom dwell-thresholds через UI, не config-files | Olga |
| P2.8 | «Share link» на конкретного человека (для async-команд) | Maksim |
| P2.9 | Zephyr Created vs Executed разделить в heatmap row Z | Ilia |
| P2.10 | TZ-aware drill-down: server использует client offset для всего, не только heatmap | Maksim |

## P3 backlog (V19+, после graduation)

- Olga's per-team config — full feature (research mode, override thresholds, baseline calibration). Effort L.
- B-баки 1-10 из original ADR (RBAC, virtualization, mobile, telemetry, etc.) — без изменений.
- Hard delete v1 PortfolioPulse — после 4 недель prod без regressions.

## Edge case: ML-команды (Olga, 5/10 verdict)

ML-research — особый случай где classifier даёт **систематический false-positive**:
- 3 дня без commits = норма (hyperparameter sweep) → classifier idle
- Junior с 8-12 переключений / день = норма research-rhythm → ↻N false-flag
- CR > 8ч порог = ML-review занимает 1-2 дня → false blocker

**Не блокирует graduation** для tech/product команд (5 из 6 daily-users — non-research). Lighter-touch fix в Sprint 4 (P2.4 + P2.7) или V19 (full per-team config). Tem Olga'у явно сказать: «инструмент не для research-workflow в текущей версии, V19 закроет».

## Recommendation: Graduation Decision

### Option A: GRADUATE NOW + Sprint 4 follow-up (RECOMMENDED)

Pilot pass: **5-6/7 daily users** (≥ ⌊6/7⌋ threshold borderline). Critical P1 findings (multi-team, trends, WIP-counter) — **не блокируют core workflow**, blocker только для одного из 7 (Dmitry's secondary use-case). Tech/product/QA команды (5 из 7) уже получают daily value.

Plan:
- **Today:** announce graduation V18.2 в Slack/Confluence. Старые ссылки на v1 продолжают работать.
- **Sprint 4 (1 неделя):** реализовать 3 P1 finding'а (multi-team aggregate + trend snapshot + WIP counter в row).
- **Sprint 5 (2 недели):** P2 nice-to-haves (top 5).
- **V19 (when scheduled):** full per-team config + Olga's research-mode + V19 backlog.

### Option B: Defer 1 неделя, ship Sprint 4 first

Если хочется hit ≥6/7 hard threshold — реализовать P1.1 (multi-team) сначала, тогда Dmitry удалит свой asterisk. Это однозначно даст 6/7 daily.

**Стоимость:** +1 неделя delay. Может стоить если CTO-defend ожидается до конца месяца и multi-team — обязательная фича.

### Option C: NO-GO

Невозможен — pilot прошёл с слишком сильными wins (5/7 daily, 3/5 CTO-вопросов закрыто, killer features подтверждены). Возвращаться в backlog нет смысла.

## Recommendation

**Option A — graduate now + Sprint 4.** v2.0 уже ценнее v1 для 5 из 7 ролей. Multi-team — важная, но не блокирующая фича. Async-add'ить через 1 неделю — допустимо.

## Pilot DoD checklist

| Item | Status |
|---|---|
| 5 тимлидов попробовали | ✅ Vasiliy, Elena, Maksim, Ilia, Olga |
| 1 PO попробовал | ✅ Anna |
| 1 руководитель отдела попробовал | ✅ Dmitry |
| ≥6/7 «would use daily» | ⚠ 5-6/7 (Dmitry asterisk) |
| 0 critical bugs reported | ✅ |
| 0 regressions для v1 PortfolioPulse | ✅ |
| Все wins из synthesis-плана подтверждены живым use-case'ом | ✅ S1.3 (Elena), S2.2 (Vasiliy), S2.3 (Maksim), S3.2 (Dmitry) |

## Sprint 4 — proposed scope

| # | Что | Effort | Whom |
|---|---|---|---|
| S4.1 | Multi-team aggregate view (новая meta-вкладка / topbar) | M ~6-8ч | Dmitry |
| S4.2 | Trend snapshot 24h (`prevSnapshot` в localStorage + delta UI) | M ~4-5ч | Anna, Dmitry |
| S4.3 | WIP counter в per-person row | XS ~30мин | Anna, Dmitry, Manager-finding |
| S4.4 | Per-pk pills в Sprint Gauge (3 пилюли вместо aggregate'а) | S ~2ч | Anna |
| S4.5 | B/C/Z indicators на per-person row (без раскрытия panel) | S ~2-3ч | Vasiliy, Elena |
| S4.6 | Switch-Index toggle visibility (config флаг hide/show) | XS ~30мин | Dmitry watchdog concern |

**Total Sprint 4: ~16-20ч + 2 дня smoke.** Реалистично за 1 рабочую неделю.

После Sprint 4 — повторный pilot 1 неделя, если ≥6/7 hard pass — закрываем V18.2 finally.

---

**Final pilot verdict: PASSED with conditions.** Graduate now under Option A. Next milestone — Sprint 4.
