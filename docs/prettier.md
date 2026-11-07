# Сборщик Prettier

`collectPrettier` загружает Prettier 3 из `node_modules` проверяемого проекта и проверяет формат через его API, не изменяя файлы. Результат совпадает с `prettier --check .` в корне проекта:

- обход начинается с `projectDir`, каталоги `node_modules`, `.git`, `.hg`, `.jj`, `.sl` и `.svn` пропускаются, символические ссылки не проверяются;
- исключения берутся из `.gitignore` и `.prettierignore` в корне проекта;
- проверяются файлы, для которых Prettier определяет парсер с учётом плагинов из настроек;
- настройки каждого файла берутся из `resolveConfig` с учётом `.editorconfig`.

`data.checkedFiles` содержит число проверенных файлов, `data.unformatted` — отсортированные пути от корня проекта, которым нужно форматирование. Каждый такой путь даёт находку `unformatted-file` уровня `warning`. Файл, который Prettier не смог разобрать, попадает в `data.errors` и даёт находку `prettier-error` уровня `error`. Отформатированным он не считается.

| `status` | `code` | Когда |
| --- | --- | --- |
| `ok` | | Проверен хотя бы один файл, в том числе без нарушений |
| `no-data` | `prettier-not-installed` | Prettier не находится из `projectDir` |
| `no-data` | `prettier-unsupported` | Установлен Prettier ниже 3 |
| `no-data` | `no-prettier-config` | Нет `.prettierrc`, `prettier.config.*` или поля `prettier` в `package.json` |
| `no-data` | `no-files` | После исключений не осталось файлов для проверки |
| `error` | `prettier-failed` | Не удалось загрузить Prettier или прочитать настройки |
