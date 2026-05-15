# DEPRECATED — Editorial Operator + 6 лучей

**Status:** `deprecated` since 2026-05-03
**Replaced by:** [`my_prisma-brand/`](../../my_prisma-brand/) (Northstar / 8-лучевая звезда / 5 модулей)
**Plan:** [`design-audit/redesign-my-prisma/00-PLAN.md`](../redesign-my-prisma/00-PLAN.md)

---

## Что было в этом пакете

Editorial-Operator концепция бренда «Призма» с 6 цветными лучами (Indigo Ink, Amber Forge, Deep Iris, Spruce, Slate, Brass) и правилом «один луч на экран». Авторы: Анна Володина, Дмитрий Кравцов, Мария Левина, Игорь Тен, Сергей Поляков.

## Почему отзываем

Заказчик утвердил **другую концепцию** — `my_prisma-brand/` (Northstar, 8-лучевая звезда, монохром, 5 модулей). Две концепции взаимоисключающи:
- Mark: spectrum-line vs 8-pointed star
- Палитра: 6 цветных лучей vs монохром + 5 signal
- IA: 17 разделов в 6 лучей vs 17 разделов в 5 модулей
- Шрифты: Plus Jakarta + EB Garamond vs SF Pro + JetBrains Mono

Невозможно «склеить» — пришлось бы отказаться от структуры одной из них.

## Что взять отсюда (если применимо к новому плану)

| Из этого пакета | Где использовать в новом плане |
|---|---|
| Метод «карта изменений по файлам код-базы» (00-overview §3) | Применён в [`redesign-my-prisma/00-PLAN.md` §12](../redesign-my-prisma/00-PLAN.md) |
| Метрики успеха через 3 месяца (01 §7) | Применены в [`redesign-my-prisma/00-PLAN.md` §3.5](../redesign-my-prisma/00-PLAN.md) |
| Anti-pattern'ы для code-review (00 §5pattern) | Адаптированы в [`redesign-my-prisma/00-PLAN.md` §14](../redesign-my-prisma/00-PLAN.md) |
| 3-этапная миграция токенов (shim → revalue → rename) (05) | Применена в [`redesign-my-prisma/00-PLAN.md` §7](../redesign-my-prisma/00-PLAN.md) |
| Page-template (header / toolbar / body) (04 §1) | Адаптирован под brandbook в [`redesign-my-prisma/00-PLAN.md` §6.1](../redesign-my-prisma/00-PLAN.md) |

## Когда удалить

В Волне 3 редизайна (Sprint 5-6, ~6 недель от 2026-05-03), когда основная имплементация завершится и точно станет ясно, что pivot не понадобится.

До удаления — этот файл `DEPRECATED.md` стоит наверху пакета, остальные 6 файлов (00-overview через 05-design-tokens) остаются read-only для исторического reference.

## Что нельзя делать

- ❌ Не имплементировать spectrum-line mark из 6 сегментов
- ❌ Не вводить 6 цветных `--ray-*` токенов
- ❌ Не использовать Plus Jakarta Sans или EB Garamond
- ❌ Не группировать sidebar в 6 лучей с CAPS-разделителями
- ❌ Не использовать `[data-active-ray]` каскад

## Что делать вместо

См. [`redesign-my-prisma/00-PLAN.md`](../redesign-my-prisma/00-PLAN.md). Single source of truth для бренда — [`my_prisma-brand/BRAND_BOOK.md`](../../my_prisma-brand/BRAND_BOOK.md).

---

**Maintainer:** удалить эту папку в Волне 3 (`rm -rf design-audit/prisma-brand/`) после подтверждения что pilot-данные не показывают потребности в pivot к Editorial-концепции.
