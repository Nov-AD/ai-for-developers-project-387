# Инструменты контроля качества

Подборка сделана по [Dev Quality Gates](https://github.com/mokevnin/dev-quality-gates) 17 ноября 2026 года. Из списка взяты только инструменты, которые закрывают реальные пробелы этого репозитория. Для каждой задачи выбран один инструмент; уже работающие oxlint, TypeScript, Vitest, `hk` и `mise` сохранены.

## Что выбрано

| Инструмент | Задача | Версия | Почему выбран | Ограничение, важное здесь |
| --- | --- | --- | --- | --- |
| [oxfmt](https://github.com/oxc-project/oxc) | Форматирование | 0.79.0 | Rust-native, Prettier-совместим, один тулчейн с oxlint | Pre-1.0. Версия закреплена точно; сгенерированные файлы исключены |
| [oxlint](https://github.com/oxc-project/oxc) | Линт TypeScript/React | 1.94.0 | Уже использовался; быстрый и один бинарник | По умолчанию выходит 0 на warnings, поэтому в `check` передаётся `--deny-warnings` |
| [TypeScript](https://github.com/microsoft/TypeScript) | Проверка типов | 6.0.3 | Уже использовался, `strict` включён | TypeScript 7.0 не поддерживается dependency-cruiser, поэтому компилятор один — 6.x |
| [Knip](https://github.com/webpro-nl/knip) | Неиспользуемые файлы, экспорты и зависимости | 6.45.1 | В проекте не было проверки мёртвого кода и лишних зависимостей | В монорепо нужен конфиг; сгенерированный SDK и CLI-бинарники перечислены явно; `--fix` не запускается автоматически |
| [syncpack](https://github.com/JamieMason/syncpack) | Единые версии зависимостей | 15.3.3 | В монорепо уже был рассинхрон версий oxlint и TypeScript | Работает только для монорепо; пакетные менеджеры с каталогами снижают пользу |
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | Границы пакетов и циклы | 18.8.0 | Запрещает импорты `apps/*` друг в друга и `packages/*` в приложения | Статический анализ не видит динамические импорты; TypeScript 7.0 не поддерживается |
| [vacuum](https://github.com/daveshanley/vacuum) | Линт OpenAPI | 0.41.0 | Контракт — центральный артефакт; спека генерируется и коммитится | Сообщество меньше Spectral; warnings не валят сборку, поэтому добавлен `--min-score 90` |
| [oasdiff](https://github.com/oasdiff/oasdiff) | Ломающие изменения API | 1.38.0 | Не даёт случайно удалить или изменить часть контракта, на которой держится SDK | Только OpenAPI; проверка идёт на pull request, потому что нужна база сравнения |
| [hk](https://github.com/jdx/hk) | Git-хуки и общий запуск проверок | 2.12.0 | Уже использовался; запускает те же шаги локально и в CI | Хук обходится `--no-verify`, поэтому гейт — CI |
| [Betterleaks](https://github.com/betterleaks/betterleaks) | Поиск секретов | 1.10.1 | Проверяет staged-содержимое в хуке и всю историю в CI | Молодой проект (2026), версия закреплена; recall — заявленный авторами |
| [commitlint](https://github.com/conventional-changelog/commitlint) | Формат сообщений коммитов | 21.2.4 | В репозитории не было проверки Conventional Commits | Проверяет формат, а не смысл; старая история не соответствует, проверяется только новый диапазон |
| [jactionlint](https://github.com/jdx/jactionlint) | Линт GitHub Actions | 2.6.0 | Workflow не проверялись, actions не были запинены на SHA | Молодой инструмент, один мейнтейнер; сгенерированный `hexlet-check.yml` исключён |
| [OSV-Scanner](https://github.com/google/osv-scanner) | Уязвимости в зависимостях | 2.7.1 | Не было проверки lock-файла по базе уязвимостей | Не сканирует образы; нужна сеть, поэтому есть еженедельный запуск |
| [mise](https://github.com/jdx/mise) | Версии инструментов и задачи | 2026.11.8 | Уже использовался; локально и в CI одинаковые версии | Сам по себе ничего не проверяет, только устанавливает и запускает |

Vitest и TypeSpec оставлены без замены: они уже покрывают тесты и контракт.

## Как инструменты подключены

Общая команда:

```bash
mise run check
```

Она ставит зависимости из lock-файла и запускает `pnpm check`, внутри которого по порядку идут lint, lint workflow, проверка форматирования, типы, Knip, syncpack, dependency-cruiser, vacuum и тесты.

Безопасные автоправки собраны отдельно:

```bash
mise run fix
```

Проверки, которым нужна сеть или база сравнения, не входят в герметичный `check`:

```bash
mise run contract:breaking   # на PR: OpenAPI против базовой ветви
mise run secrets             # вся Git-история
mise run audit               # OSV-Scanner по lock-файлам
```

### Три уровня запуска

| Уровень | Что запускается | Когда |
| --- | --- | --- |
| `pre-commit` | oxfmt, oxlint, Betterleaks `--staged`, пробелы, переводы строк, конфликты, большие файлы | На staged-файлах, быстро |
| `commit-msg` | commitlint | На сообщении коммита |
| `pre-push` | `mise run check` | Полная герметичная проверка |
| CI | `mise run check` + генерация артефактов, commitlint по диапазону, секреты, oasdiff, OSV | `ci.yml` — push в `main` и pull request; `push-check.yml` — push в остальные ветки |
| Расписание | OSV-Scanner и Betterleaks | Еженедельно, workflow `security.yml` |

### Гейт сгенерированного кода

CI выполняет `mise run codegen`, затем `git diff --exit-code`. Если OpenAPI, SDK или серверные типы не перегенерированы или изменены руками, сборка падает. Сгенерированные файлы также исключены из oxfmt, oxlint, Knip и dependency-cruiser.

## Что не взято и почему

- **StrykerJS** — мутационное тестирование полезно, но тестов пока мало, а запуск должен быть ограничен изменёнными файлами. Вернёмся, когда появятся доменные сценарии бронирования.
- **diff-cover** — сначала нужно включить отчёты покрытия в Vitest; отдельный шаг.
- **Renovate** — для GitHub-репозитория достаточно Dependabot, а сам бот не является гейтом.
- **lychee, typos, rumdl** — проверки документации не относятся к стеку, хукам и CI; можно добавить отдельным изменением.
- **Stylelint, axe-core, size-limit** — в проекте ещё нет Tailwind, e2e-тестов и бюджета бандла.
- **Hadolint** — Dockerfile пока нет.
- **check-jsonschema** — конфиги уже типизированы через TypeScript и TypeSpec.
- **Buf** — контракт описан не в Protobuf.
- **Trivy/Grype** — образов пока нет.

## Исключения и известные пробелы

- `hexlet-check.yml` не линтуется jactionlint: файл сгенерирован Хекслетом, его запрещено редактировать. Исключение узкое — только этот файл.
- Knip игнорирует CLI-бинарники, которые ставит mise (`jactionlint`, `betterleaks`, `osv-scanner`, `oasdiff`, `vacuum`), `@hey-api/client-fetch` из сгенерированного SDK и `ts-node` из Fastify CLI. Это не отключение правил, а описание того, что инструмент не видит.
- vacuum сейчас показывает 5 warnings: нет примеров ответов и тега операции. Они не блокируют сборку, но минимальный score 90 не даст качеству упасть.
- dependency-cruiser не поддерживает TypeScript 7.0, поэтому весь монорепо использует TypeScript 6.x. Это ограничение инструмента, а не запрет на обновление: при выходе совместимой версии можно вернуться к 7.x.
- commitlint проверяет только новые коммиты: история до внедрения написана без Conventional Commits.
- Исключение [`GHSA-fc5q-39xc-vjpf`](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) (`CVE-2026-112366`, `picomatch`) изначально было добавлено, потому что сборка проекта падала с ошибкой аудита. Удалено 19 ноября 2026 года: GitHub и OSV отозвали advisory 18 ноября 2026 года. Аудит проходит без исключений.

## Как проверялось, что гейты падают

Для каждого добавленного инструмента вручную вносилось нарушение, команда запускалась и должна была завершиться с ненулевым кодом, после чего изменение откатывалось. Все проверки ниже действительно завершились с кодом 1:

| Проверка | Внесённое нарушение | Наблюдаемый результат |
| --- | --- | --- |
| oxlint | `debugger;` в `scripts/*.ts` | `eslint(no-debugger)`, код 1 |
| oxfmt | Файл с неправильными отступами | `Format issues found`, код 1 |
| Knip | Неиспользуемый файл `apps/api/src/unused-probe.ts` | `Unused files (1)`, код 1 |
| syncpack | `typescript ~5.9.0` в `apps/web` против `~6.0.2` в остальных | `DiffersToHighestOrLowestSemver`, код 1 |
| dependency-cruiser | Импорт `apps/api/src/app.ts` из `apps/web/src/App.tsx` | `no-web-to-api`, код 1 |
| vacuum | Удалён `info.description` из OpenAPI | score 83 при пороге 90, код 1 |
| oasdiff | Переименован путь `/health` в OpenAPI | `api-path-removed-without-deprecation`, код 1 |
| Betterleaks | Staged-файл со случайным `ghp_…`-токеном | `leaks found: 1`, код 1 |
| commitlint | Сообщение `bad message` | `subject-empty`, `type-empty`, код 1 |
| jactionlint | Ключ `branch` вместо `branches` в workflow | `workflow-syntax`, код 1 |
| OSV-Scanner | `lodash 4.17.15` в отдельном lock-файле | 5 уязвимостей, код 1 |

Хуки проверены отдельно: `hk install` прописал `hk-pre-commit`, `hk-commit-msg` и `hk-pre-push` в `git config`, а `hk check --all` проходит на текущем дереве.

Важное наблюдение по Betterleaks: низкоэнтропийные строки вида `ghp_0123456789abcdefghijklmnopqrstuvwxyz` инструмент отбрасывает фильтром энтропии. Для проверки гейта нужен токен, похожий на настоящий, поэтому в таблице указан случайный.
