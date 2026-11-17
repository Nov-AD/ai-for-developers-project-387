# AGENTS.md

Короткие правила для агентов. Установка, генерация, проверки и запуск описаны в README; при расхождении верь `mise.toml`, `package.json` и CI.

- Перед завершением запусти `mise run check` — это тот же гейт, что в CI и `pre-push`. Сетевые проверки (`secrets`, `audit`, `contract:breaking`) в него не входят.
- API-контракт задаётся только в `packages/contract/main.tsp`. Сгенерированное не редактируй: `packages/contract/tsp-output/`, `packages/sdk/src/`, `apps/api/src/generated/`. После правки контракта — `mise run codegen`; CI падает, если после генерации остаётся diff.
- Fastify автозагружает `apps/api/src/routes/*.ts` и `plugins/*.ts`. Новый эндпоинт = операция в TypeSpec + файл маршрута, иначе `contract.test.ts` упадёт.
- Тесты есть только в `apps/api`; один файл: `pnpm --filter @calendar/api exec vitest run <path>`.
- oxlint настраивается только корневым `.oxlintrc.json`; пакетных конфигов нет. Не отключай правила и не снижай пороги проверок, чтобы пройти.
- TypeScript 6.x — намеренно: dependency-cruiser не поддерживает 7.x.
- Границы: `apps/*` не импортируют друг друга, `packages/*` не импортируют `apps/*`.
- Новые коммиты — Conventional Commits.
- Коммит реализации ссылается на тикет, который он закрывает, например `feat: запись на свободный слот (#12)`. GitHub превращает номер в ссылку, и по истории видно, какой коммит какую задачу делал.
- `.github/workflows/hexlet-check.yml` сгенерирован Хекслетом: не редактируй.

## Agent skills

### GitHub Actions

При запросе через `/oc` или `/opencode` сначала прочитай `docs/agents/opencode.md`: загрузка проектных скиллов и продолжение обсуждения Issue/PR между сессиями.

### Issue tracker

Задачи и спеки этого репозитория живут в GitHub Issues, работа через `gh` CLI. См. `docs/agents/issue-tracker.md`.

### Triage labels

Канонические роли triage используют одноимённые лейблы: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. См. `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` и `docs/adr/` в корне репозитория. См. `docs/agents/domain.md`.
