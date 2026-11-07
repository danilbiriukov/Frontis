# Сборщик knip

`collectKnip` запускает knip, установленный в проверяемом проекте, с его конфигурацией: `node <bin knip> --reporter json --no-progress` в `projectDir`. Frontis не скачивает knip через `npx`. Разбор поддерживает JSON knip 6 и knip 5.

`data.counts` содержит сводку для оценки с полями, как у `UnusedCodeCounts` из `core/rules.ts`:

| Поле | Категории knip |
| --- | --- |
| `files` | `files` |
| `dependencies` | `dependencies`, `devDependencies`, `optionalPeerDependencies` |
| `exports` | `exports`, `nsExports` |
| `types` | `types`, `nsTypes` |

`data.categories` хранит число находок по каждой категории из ответа, включая `unlisted`, `unresolved`, `duplicates` и прочие. Каждая запись становится находкой с кодом (`unused-export`, `unresolved-import` и т. д.), путём от корня проекта и строкой со столбцом, если knip их выдал. Для категории без описания используется код `knip-<категория>`. Уровень находок `warning`, потому что в JSON-отчёте knip нет уровня правил.

| `status` | `code` | Когда |
| --- | --- | --- |
| `ok` | | knip завершился с кодом 0 или 1 и выдал отчёт, в том числе пустой |
| `no-data` | `knip-not-installed` | knip не находится из `projectDir` |
| `error` | `knip-failed` | Другой код выхода, например ошибка конфигурации. В `reason` первая строка stderr |
| `error` | `invalid-output` | Ответ не JSON или не в формате knip |

При ошибке загрузки конфигурации одного из плагинов knip завершается с кодом 2, но всё равно печатает отчёт. Такой отчёт может быть неполным, поэтому сборщик возвращает `knip-failed`.
