# Базовая информация о проекте

`collectProjectInfo` читает корневой `package.json`, lock-файлы и Git в `projectDir`. В монорепозитории читается только корневой манифест. Сборщик ничего не оценивает и всегда возвращает пустой список находок.

| Поле | Значение |
| --- | --- |
| `name`, `version` | Из `package.json`, `null` при отсутствии |
| `packageManager` | `npm`, `pnpm` или `yarn`, источник и версия, `null` если не определён |
| `lockFiles` | Все найденные lock-файлы в порядке приоритета |
| `git` | Ветка и последний коммит (`hash`, `date`, `message`), `null` вне Git |
| `runtime.node` | Версия Node.js, в которой запущен Frontis. Требования проекта проверяются отдельно в [#27](https://github.com/danilbiriukov/Frontis/issues/27) |

Менеджер пакетов выбирается так:

1. Поле `packageManager` из `package.json`, например `pnpm@9.1.0`. Его же использует Corepack.
2. Иначе первый найденный lock-файл в порядке `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `npm-shrinkwrap.json`. Если найдено несколько, все они перечислены в `lockFiles`.

Внутри Git, но без коммитов, `git.commit` равен `null`. При отсоединённом HEAD `git.branch` равен `null`. Если Git не установлен или каталог не входит в репозиторий, `git` равен `null`, а остальные поля доступны. В `Report` в этом случае `commit: null` по решению [#39](code-pushup-compatibility/README.md).

| `status` | `code` | Когда |
| --- | --- | --- |
| `no-data` | `no-package-json` | В `projectDir` нет `package.json` |
| `error` | `invalid-package-json` | Некорректный JSON или не объект |
| `error` | `package-json-unreadable` | Файл есть, но прочитать его не удалось |
