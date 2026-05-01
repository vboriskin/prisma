# V18 P1 — `git init`

**Дата:** 2026-05-01
**Tests:** 534 / 11 / 0 (без изменений — pure infrastructure setup)
**Initial commit:** `ee1580c`

## Контекст

До V18 проект существовал **без git-контроля**: все 60+ файлов корневой директории жили только локально, история итераций V11→V17.2 фиксировалась через audit-папки + ярлыки в коде, но не через VCS-историю.

Это блокировало:
- PR-template (создан в V17.2 фаза документирования) — без git некому его читать
- Code review pipeline
- Откат на конкретную версию
- Работу нескольких разработчиков

**P1 = первый пункт V18**, потому что без него остальные 14 пунктов теряют половину смысла.

## Что сделано

### 1. Audit на наличие токенов

Перед `git init` проверил что в файлах не валяются hardcoded секреты:

```bash
# Hardcoded Bearer / API keys в исходниках
grep -rEn "Bearer\s+[A-Za-z0-9]{20,}|sk_(live|test)_|api[_-]?key.*=.*['\"]\w{20,}|token.*=.*['\"]\w{20,}" \
  --include="*.js" --include="*.html" --include="*.json" --include="*.md" \
  --exclude-dir=node_modules --exclude-dir=audit-* .

# .env files
find . -name ".env*" -not -path "./node_modules/*"
```

**Результат:** чисто. Никаких токенов в исходниках или в .env.

Существующий `jira_config.json` содержит test-token (от контракт-тестовой Jira на `127.0.0.1:19200`), но он защищён `.gitignore:12`:

```bash
$ git check-ignore -v jira_config.json
.gitignore:12:jira_config.json    jira_config.json
```

### 2. `git init -b main`

Initialized empty Git repository in `/Users/vaceslavboriskin/q2_parse/v17_0/.git/`.
Default branch — `main`.

### 3. Staged audit

```bash
$ git add -A
$ git diff --cached --stat | grep -iE "jira_config|\.env|secret|token"
docs/integrations/auth-and-secrets.md  | 270 +
```

Единственное упоминание «token» в staged — `auth-and-secrets.md` (документация о token-handling, не сами токены). Безопасно.

### 4. Initial commit

```
ee1580c chore: initial commit (V17.2 baseline + V18 roadmap)

213 files changed, 69969 insertions(+)
```

Сообщение коммита (полное) содержит:
- Описание baseline (V17.2 — что закрывает)
- Краткие release notes V17 → V17.1 → V17.2 → V18
- Ссылку на документацию (CLAUDE.md + 10 docs/ файлов)
- Резюме по security policy (.gitignore, scrubSecrets, formula injection guard)

### 5. Verification

```bash
$ git status --short
(empty — clean working tree)

$ git log --oneline -1
ee1580c chore: initial commit (V17.2 baseline + V18 roadmap)
```

## Что НЕ сделано (явно)

- **Push в удалённый репо** — у проекта нет remote. При появлении remote (corporate GitLab / Bitbucket / GitHub Enterprise) — `git remote add origin <url> && git push -u origin main`.
- **Подписание коммита** — `git config commit.gpgsign` не трогаю (зависит от персонального dev-setup'а; делается по желанию автора, не на уровне репо).
- **Branch protection rules** — настраиваются на стороне сервера хостинга после push.
- **Удаление старых audit-папок** — все они в инициальном коммите, что правильно (история проекта не теряется). Через 12+ месяцев можно консолидировать в один CHANGELOG (см. backlog B6 в MASTER_PLAN.md).
- **Pre-commit hooks** — `husky` или подобное добавляется отдельно, в P3 (CONTRIBUTING.md) или P4 (CI gate).

## Что обнаружено по ходу

- **Размер initial commit: 213 файлов, ~70k строк.** Большой, но это норма для проекта который полгода жил без VCS. История итераций восстанавливается через audit-папки.
- **Файлы с кириллицей в именах** (`Запустить (Mac).command`, `КАК-ЗАПУСТИТЬ.md`, `Разблокировать на Mac.txt`) корректно закомичены — git показывает их через octal-escape но содержимое сохранено.
- `node_modules/` отсутствует на момент init — `npm install` для dev ещё не делался. `.gitignore` готов к нему.
- В корне `package-lock.json` отсутствует — будет создан при первом `npm install`.

## Следующий шаг (P2)

`P2 — test:contract config fix` (XS effort, Low impact).

Сейчас в `package.json`:
```json
"test:contract": "node --test --test-reporter=spec 'tests/contract/**/*.test.js'"
```
Но `tests/contract/` — пустая папка. Реальные contract-тесты живут в `contractTest.js` (root) и запускаются через `node contractTest.js` в `npm test`.

Решение: либо переместить логику из `contractTest.js` в `tests/contract/integrations.test.js` (правильнее), либо обновить script на `node contractTest.js` (быстрее).

## Резюме

```
Tests: 534 / 11 / 0
Commits: ee1580c (initial)
Working tree: clean
.gitignore: protects jira_config.json + .env* + *.pem/.key
```

V18 P1 закрыт. Можно переходить к P2.
