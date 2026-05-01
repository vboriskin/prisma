# V18 P8 — BB bucket separation

**Дата:** 2026-05-01
**Tests:** 534 unit / 11 contract / 0 fail (без регрессий)
**Effort:** S

## Проблема

Bitbucket-данные приходят на сервер из **двух разных источников**:

1. **Repo-walk** (`ppFetchBitbucketActivity`) — юзер настроил `bitbucketBaseUrl + bitbucketToken`, мы напрямую опрашиваем PR / commits через Bitbucket REST API.
2. **Jira dev-status panel** (`ppFetchDevStatusForIssues`) — Jira сама знает какие PR / commits связаны с задачами через Bitbucket connector. Опрашиваем без Bitbucket-credentials.

До V18 эти два источника **сливались** в один `bitbucket.authors` через `_ppMergeAuthorMaps`. Это уровни доверия разные — repo-walk authoritative (юзер сам настроил); dev-status — supplementary (Jira может вернуть entries без email/login). V17.2 I1d добавил defensive фильтр на email/login для dev-status entries, но merge всё равно стирал provenance.

Phase 3 audit bullet **I5**: «BB bucket separation: `bitbucket.repoAuthors` + `bitbucket.devStatusAuthors` отдельно. UI решает что показывать.»

## Решение

### Server: возвращаем оба bucket'а отдельно

```js
const bitbucket = {
  authors:           mergedAuthors,                  // legacy — backward-compat
  repoAuthors:       bitbucketRepoWalk.authors || {}, // V18 P8 — pure repo-walk
  devStatusAuthors:  _devStatusAuthorsFiltered,       // V18 P8 — pure dev-info
  // ...rest of bitbucket meta
};
```

`authors` (merged) **сохранён** для backward-compat — текущий frontend пока его читает. Когда renderer переедет на raw bucket'ы — merged можно удалить (TODO для V18.1+).

### Frontend: priority-based attribution

`integrations/portfolioPulseModel.js#analysePulse` теперь:

1. Если есть `repoAuthors` (юзер настроил BB) → ищет автора **только в нём**, потом fallback на `devStatusAuthors`. Никаких merged.
2. Если raw bucket'ов нет (legacy server response) → fallback на merged `authors`.

`p.bbSource` — новое поле в участнике с provenance: `'repo' | 'devStatus' | 'merged' | 'fuzzy'`. Renderer пока его не использует, но UI может в будущем показать badge «PR прошёл через настроенный BB» vs «замечен только через Jira dev-info» (это два разных уровня доверия для пользователя).

### Helper: `_resolveBbAuthor(key, email)`

Инкапсулирует priority logic в один helper:
```js
const _resolveBbAuthor = (key, email) => {
  if (Object.keys(bbRepoAuthors).length) {
    // repo-walk был → строго через него + dev-status secondary
    const v = (k && bbRepoLookup.byKey.get(k)) || (e && bbRepoLookup.byEmail.get(e));
    if (v) return { entry: v, source: 'repo' };
    const d = (k && bbDevStatusLookup.byKey.get(k)) || (e && bbDevStatusLookup.byEmail.get(e));
    if (d) return { entry: d, source: 'devStatus' };
    return null;
  }
  // Legacy server (нет raw bucket'ов) — merged
  const v = (k && bbLookup.byKey.get(k)) || (e && bbLookup.byEmail.get(e));
  return v ? { entry: v, source: 'merged' } : null;
};
```

`_buildAuthorLookups` получил null-safety: если raw bucket пустой, возвращает empty lookup (вместо краш).

## Что НЕ сделано (явно)

- **Renderer не использует `bbSource`** — provenance прокинут в модель, но UI пока не показывает badge. Добавить в P9 (app.js decomposition) когда будет переделываться `portfolioPulseRenderer`.
- **Merged `authors` retire** — оставлен для backward-compat. Сейчас frontend читает оба, но backward-compat код можно удалить когда уверены что новый сервер всегда отдаёт raw bucket'ы. Отдельный TODO для V18.1.
- **Тесты на provenance** — `bbSource: 'repo' | 'devStatus' | 'merged'` не покрыт unit-тестом. В V17.2 тестах есть identity-match через `bbLookup`, но без проверки source. Добавить тест в P13 (coverage expansion).

## Что закрыто из аудита

P8 закрывает Phase 3 audit Bullet **I5** — «Bitbucket bucket separation: repoAuthors + devStatusAuthors отдельно».

## Тесты

```
534 unit / 11 contract / 0 fail
```

Без регрессий. `tests/unit/portfolioPulseModel.test.js` проходит — поведение в legacy-mode (когда server возвращает только merged `authors` без raw bucket'ов) сохранено.

## Метрика

```
Backend:  +6 LOC (raw bucket'ы добавлены в bitbucket payload)
Frontend: +28 LOC (_resolveBbAuthor helper) / -10 LOC (упрощённая ветвь)
          + bbSource provenance во всех bbResolved entries
```

## Резюме

```
✓ server.js: bitbucket.{repoAuthors, devStatusAuthors} раздельные bucket'ы
✓ portfolioPulseModel.js: _resolveBbAuthor с priority logic
✓ p.bbSource: 'repo' | 'devStatus' | 'merged' | 'fuzzy' (новое поле)
✓ Backward-compat: legacy `authors` оставлен; null-safety в _buildAuthorLookups
✓ Tests: 534 / 11 / 0
```

V18 P8 закрыт. **Block B полностью завершён** (P5+P6+P7+P8).

Дальше — Block C (decomposition: P9 app.js + P10 server.js + P11 gantt.js).
