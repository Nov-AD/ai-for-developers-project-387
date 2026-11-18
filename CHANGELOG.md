# Changelog

## [0.3.2](https://github.com/Nov-AD/ai-for-developers-project-387/compare/v0.3.1...v0.3.2) (2026-11-18)


### Bug Fixes

* allow five PR agent attempts ([#25](https://github.com/Nov-AD/ai-for-developers-project-387/issues/25)) ([0219219](https://github.com/Nov-AD/ai-for-developers-project-387/commit/02192196f58271c6e515110c0b6c779bf37eb8ba))
* attach bounded full PR review context ([#27](https://github.com/Nov-AD/ai-for-developers-project-387/issues/27)) ([5eff8f8](https://github.com/Nov-AD/ai-for-developers-project-387/commit/5eff8f82bafe9f977fada534d23593abf7606e95))
* передавать полный ограниченный контекст авторевью ([#27](https://github.com/Nov-AD/ai-for-developers-project-387/issues/27)) ([51e8e38](https://github.com/Nov-AD/ai-for-developers-project-387/commit/51e8e3890858b80b6b1bf788a83b117df61fe7ab))
* пять попыток агента на PR ([#25](https://github.com/Nov-AD/ai-for-developers-project-387/issues/25)) ([ad6b494](https://github.com/Nov-AD/ai-for-developers-project-387/commit/ad6b494eac146c336975dab1b705c71600cac9af))

## [0.3.1](https://github.com/Nov-AD/ai-for-developers-project-387/compare/v0.3.0...v0.3.1) (2026-11-18)


### Bug Fixes

* prevent OpenCode ticket publication hangs ([#14](https://github.com/Nov-AD/ai-for-developers-project-387/issues/14)) ([e09bc39](https://github.com/Nov-AD/ai-for-developers-project-387/commit/e09bc39702f923e8d1ddd8eb3df783261c752c27))
* use V1 permissions in OpenCode GitHub Action ([#17](https://github.com/Nov-AD/ai-for-developers-project-387/issues/17)) ([4ef9cb1](https://github.com/Nov-AD/ai-for-developers-project-387/commit/4ef9cb1cf2619c64627e3a92ef219eb59b505877))
* совместимая политика прав для OpenCode GitHub Action ([#17](https://github.com/Nov-AD/ai-for-developers-project-387/issues/17)) ([c6549a5](https://github.com/Nov-AD/ai-for-developers-project-387/commit/c6549a52db1e8d7a53d4d8f648e5daeefd6d2a55))
* устранить зависание OpenCode при публикации тикетов ([#14](https://github.com/Nov-AD/ai-for-developers-project-387/issues/14)) ([f18147b](https://github.com/Nov-AD/ai-for-developers-project-387/commit/f18147b4a17d5548c13da1f82755ee9405e1429e))

## [0.3.0](https://github.com/Nov-AD/ai-for-developers-project-387/compare/v0.2.1...v0.3.0) (2026-11-18)


### Features

* connect guest meeting type list ([#9](https://github.com/Nov-AD/ai-for-developers-project-387/issues/9)) ([8d0bf72](https://github.com/Nov-AD/ai-for-developers-project-387/commit/8d0bf72371295ffd7cf9f0c44b6bcfae5e2ed12c))
* containerize calendar and prepare Render deployment ([#17](https://github.com/Nov-AD/ai-for-developers-project-387/issues/17)) ([18dbc4d](https://github.com/Nov-AD/ai-for-developers-project-387/commit/18dbc4d81f0cad82db3d5c177adf98df3ff4dd52))
* create bookings without overlaps ([#13](https://github.com/Nov-AD/ai-for-developers-project-387/issues/13)) ([f39f1fc](https://github.com/Nov-AD/ai-for-developers-project-387/commit/f39f1fc4e7acd5f22306da701eb9105346981cb4))
* Docker и деплой календаря на Render ([#17](https://github.com/Nov-AD/ai-for-developers-project-387/issues/17)) ([7d738d6](https://github.com/Nov-AD/ai-for-developers-project-387/commit/7d738d68bf912b6b1e13dc872041df614f87e384))
* establish design-first calendar contract ([#8](https://github.com/Nov-AD/ai-for-developers-project-387/issues/8)) ([5fadb51](https://github.com/Nov-AD/ai-for-developers-project-387/commit/5fadb5131dc09f6d416d696275aa08653c83cd4b))
* let guest pick an available slot ([#12](https://github.com/Nov-AD/ai-for-developers-project-387/issues/12)) ([528ef3f](https://github.com/Nov-AD/ai-for-developers-project-387/commit/528ef3fa53d124b1f5d4ae2ff1133e38e2451e2d))
* let owner create meeting types ([#10](https://github.com/Nov-AD/ai-for-developers-project-387/issues/10)) ([e4dfd89](https://github.com/Nov-AD/ai-for-developers-project-387/commit/e4dfd891192324819f9809f7c79817404fd493f0))
* release the call calendar ([#7](https://github.com/Nov-AD/ai-for-developers-project-387/issues/7)) ([68ab3d6](https://github.com/Nov-AD/ai-for-developers-project-387/commit/68ab3d689650482e2ca7ecfcb16404e8dce67865))
* show upcoming bookings to the owner ([#14](https://github.com/Nov-AD/ai-for-developers-project-387/issues/14)) ([c24a194](https://github.com/Nov-AD/ai-for-developers-project-387/commit/c24a194d3b50e512d1d8e56f49b6fd26dd712760))


### Bug Fixes

* compact mobile calendar and owner notice ([#22](https://github.com/Nov-AD/ai-for-developers-project-387/issues/22)) ([08ae10d](https://github.com/Nov-AD/ai-for-developers-project-387/commit/08ae10d06d7f2c7abbcad5a5eaa7de46a3f3b22d))
* use patched static server and verify deployed behavior ([#17](https://github.com/Nov-AD/ai-for-developers-project-387/issues/17)) ([3d8d876](https://github.com/Nov-AD/ai-for-developers-project-387/commit/3d8d876636af2b09a3aa0f9b0ba0d770dcda90f9))
* компактные мобильные экраны календаря ([#22](https://github.com/Nov-AD/ai-for-developers-project-387/issues/22)) ([3648038](https://github.com/Nov-AD/ai-for-developers-project-387/commit/3648038c67b8b70158e5310cd98dff406b8cb5d4))


### Reverts

* undo accidental release 0.3.0 ([#2](https://github.com/Nov-AD/ai-for-developers-project-387/issues/2)) ([a9563db](https://github.com/Nov-AD/ai-for-developers-project-387/commit/a9563db1025e42f22ef089ff0ba8a4185308469b))

## [0.2.1](https://github.com/Nov-AD/ai-for-developers-project-386/compare/v0.2.0...v0.2.1) (2026-11-18)


### Bug Fixes

* compact mobile calendar and owner notice ([#22](https://github.com/Nov-AD/ai-for-developers-project-386/issues/22)) ([08ae10d](https://github.com/Nov-AD/ai-for-developers-project-386/commit/08ae10d06d7f2c7abbcad5a5eaa7de46a3f3b22d))
* компактные мобильные экраны календаря ([#22](https://github.com/Nov-AD/ai-for-developers-project-386/issues/22)) ([3648038](https://github.com/Nov-AD/ai-for-developers-project-386/commit/3648038c67b8b70158e5310cd98dff406b8cb5d4))

## [0.2.0](https://github.com/Nov-AD/ai-for-developers-project-386/compare/v0.1.0...v0.2.0) (2026-11-17)


### Features

* connect guest meeting type list ([#9](https://github.com/Nov-AD/ai-for-developers-project-386/issues/9)) ([8d0bf72](https://github.com/Nov-AD/ai-for-developers-project-386/commit/8d0bf72371295ffd7cf9f0c44b6bcfae5e2ed12c))
* containerize calendar and prepare Render deployment ([#17](https://github.com/Nov-AD/ai-for-developers-project-386/issues/17)) ([18dbc4d](https://github.com/Nov-AD/ai-for-developers-project-386/commit/18dbc4d81f0cad82db3d5c177adf98df3ff4dd52))
* create bookings without overlaps ([#13](https://github.com/Nov-AD/ai-for-developers-project-386/issues/13)) ([f39f1fc](https://github.com/Nov-AD/ai-for-developers-project-386/commit/f39f1fc4e7acd5f22306da701eb9105346981cb4))
* Docker и деплой календаря на Render ([#17](https://github.com/Nov-AD/ai-for-developers-project-386/issues/17)) ([7d738d6](https://github.com/Nov-AD/ai-for-developers-project-386/commit/7d738d68bf912b6b1e13dc872041df614f87e384))
* establish design-first calendar contract ([#8](https://github.com/Nov-AD/ai-for-developers-project-386/issues/8)) ([5fadb51](https://github.com/Nov-AD/ai-for-developers-project-386/commit/5fadb5131dc09f6d416d696275aa08653c83cd4b))
* let guest pick an available slot ([#12](https://github.com/Nov-AD/ai-for-developers-project-386/issues/12)) ([528ef3f](https://github.com/Nov-AD/ai-for-developers-project-386/commit/528ef3fa53d124b1f5d4ae2ff1133e38e2451e2d))
* let owner create meeting types ([#10](https://github.com/Nov-AD/ai-for-developers-project-386/issues/10)) ([e4dfd89](https://github.com/Nov-AD/ai-for-developers-project-386/commit/e4dfd891192324819f9809f7c79817404fd493f0))
* release the call calendar ([#7](https://github.com/Nov-AD/ai-for-developers-project-386/issues/7)) ([68ab3d6](https://github.com/Nov-AD/ai-for-developers-project-386/commit/68ab3d689650482e2ca7ecfcb16404e8dce67865))
* show upcoming bookings to the owner ([#14](https://github.com/Nov-AD/ai-for-developers-project-386/issues/14)) ([c24a194](https://github.com/Nov-AD/ai-for-developers-project-386/commit/c24a194d3b50e512d1d8e56f49b6fd26dd712760))


### Bug Fixes

* use patched static server and verify deployed behavior ([#17](https://github.com/Nov-AD/ai-for-developers-project-386/issues/17)) ([3d8d876](https://github.com/Nov-AD/ai-for-developers-project-386/commit/3d8d876636af2b09a3aa0f9b0ba0d770dcda90f9))
