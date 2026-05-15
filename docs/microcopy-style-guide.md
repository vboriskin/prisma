# Microcopy style guide — Призма (2026-05-11)

> Единый стиль текстов в UI. Использовать при добавлении нового message'а,
> error'а, empty-state'а или tooltip'а.

## Принципы

### 1. Voice
- **Passive** для system states: «Связь потеряна», «Данные обновлены 2 минуты назад»
- **Active imperative** для user actions: «Откройте Настройки», «Обновите токен»

### 2. Tone
- Neutral, professional, не judgmental
- Никогда не accusatory к user'у или сотруднику: ❌ «Иванов не работал» → ✅ «Без активности у Иванова»
- HR-safe: фокус на задачах/процессе, не на личности

### 3. Tense
- **Past simple** для completed events: «Скан выполнен», «Привязка сохранена»
- **Present continuous** для in-flight: «Сканирую…», «Загружаю историю»
- **Future imperative** для CTA: «Откройте» (не «Будет открыто»)

### 4. Person/number agreement (RU)
- Использовать `Utils.plural(n, [1, 2, 5])` — НЕ hardcoded forms
- Excellent: `${count} ${plural(count, ['блокер', 'блокера', 'блокеров'])}`
- Bad: `${count} блокер(ов)`, `${count} блокеров`

### 5. Numbers in copy
- Mono font на численных значениях (`var(--font-mono)`)
- Tabular nums: `font-feature-settings: "tnum"` для столбцов
- Threshold context: «3 блокера (12% от команды)» вместо просто «3»

## Canonical wording

| Использовать | НЕ использовать |
|---|---|
| «Без активности» | «Нет следа в Jira / BB / CF», «Молчит» |
| «Требует разговора» | «Стоп», «Заблокирован», «Не работает» |
| «Под наблюдением» | «Watch», «Внимание» |
| «Движется» | «Active», «Работает» |
| «Закрыто» | «Done», «Resolved» |
| «В работе» | «In Progress», «WIP» |
| «На ревью» | «Review», «In Review» |
| «Открыть Диагностику» | «Открыть Diag», «Открыть logs» |
| «Обновите токен» | «Refresh token», «Token expired» |
| «Связь потеряна» | «Network error», «Connection refused» |
| «Токен истёк» | «401», «Authorization failed» |
| «Нет прав» | «403», «Forbidden» |
| «Сервис недоступен» | «5xx», «Server error» |

## Error messages

| HTTP / тех | Человеческий перевод |
|---|---|
| `HTTP 401` | «Токен истёк — обновите в Настройках → ${interface}» |
| `HTTP 403` | «Нет прав. Запросите у админа доступ к ${resource}» |
| `HTTP 5xx` | «${Сервис} временно недоступен. Попробуйте через 5 минут.» |
| `ECONNREFUSED` | «Сервис не отвечает. Проверьте URL в Настройках или VPN.» |
| `Timeout` | «Запрос дольше N сек — возможно медленная сеть.» |

## Empty states

Не показывать просто `—`. Использовать:
- **Time estimate**: «Появится через 24ч»
- **Action hint**: «Нажмите «Обновить» чтобы пересчитать»
- **Diagnostic link**: «Если не появилось — откройте Диагностику»

## Hedging language

Когда сигнал неполный — explicitly say so:
- «Возможно burnout — 25% событий в выходные за 4 недели»
- «Тренд предварительный — R²=0.3, статистическая уверенность низкая»
- «Approximation: …» для DORA-proxy метрик

## Examples — где править

### ❌ До
```
title="Bug injection rate: ${bugInj.count} баг(ов) создано в ходе спринта. Сигнал качества DoD."
```
### ✅ После
```
title="Bug injection rate: ${bugInj.count} ${plural(bugInj.count, ['баг', 'бага', 'багов'])} создан${bugInj.count === 1 ? '' : 'о'} в ходе спринта. Сигнал качества DoD."
```

## Audit checklist при ревью PR

- [ ] Все числа через `plural()` или явный count + label
- [ ] HTTP-коды переведены в человеческий язык
- [ ] Empty-states имеют actionable hint
- [ ] HR-safe wording (не accusatory)
- [ ] Consistent terminology (см. canonical wording выше)
- [ ] Tabular nums на columns со numerics
- [ ] Mono font на счётчиках
